/**
 * The account control in the main menu header, and the account screen it opens.
 *
 * The chip on the far right of the topbar shows standing first (rank insignia,
 * rank, level), then the provider avatar and identity. It is a route, not a
 * popover: clicking it opens the account screen in the deck, with its sections
 * as tabs in the left rail exactly like Settings or Skirmish. The service
 * record is one of those tabs, so it never opens a second dialog.
 *
 * Guest play is always one click away ("Continue as guest"), no screen is gated
 * behind sign-in, and this class is the only place that starts an OAuth round
 * trip. Nothing here decides authorization: every action is a request the
 * account service validates, and every rendered field is escaped.
 */
import {
  AccountApiError,
  type AccountState,
  type AccountView,
  HttpAccountApi,
} from '../accounts/client';
import type { ProviderId } from '../accounts/types';
import type { CareerService, CareerSnapshot } from '../accounts/careerService';
import { careerHistoryMarkup, careerSummaryMarkup, serviceRecordMarkup } from './careerView';
import { rankInsigniaSvg } from './rankInsignia';
import { RANKS, rankForXp } from '../accounts/ranks';
import {
  guestMigrationRequest,
  markGuestMigrated,
  type GuestProfile,
  type GuestStorage,
} from '../accounts/guest';

export interface AccountPanelOptions {
  api: HttpAccountApi;
  guest: GuestProfile | null;
  storage: GuestStorage | null;
  /** Career reads and writes; the panel only renders what it returns. */
  career?: CareerService;
  notify?: (message: string, level: 'info' | 'warning' | 'critical' | 'success') => void;
  /**
   * Ask the menu shell to show or leave the account screen. The shell owns the
   * deck navigation, so the panel never sets a menu view itself.
   */
  navigate?: (view: 'account' | null) => void;
}

type Notice = { level: 'info' | 'warning' | 'critical' | 'success'; text: string };

/** The sections of the account screen, in rail order. */
type AccountTab = 'account' | 'record';

const PROVIDER_LABEL: Record<ProviderId, string> = { google: 'Google', discord: 'Discord' };

const ERROR_TEXT: Record<string, string> = {
  cancelled: 'Sign-in was cancelled. Nothing changed.',
  'state-mismatch': 'That sign-in link had expired or did not match. Try again.',
  'identity-in-use': 'That login already belongs to another MCA account. Nothing was merged.',
  unauthorized: 'Your session expired. Sign in again.',
  'account-suspended': 'This account cannot sign in.',
  'provider-error': 'The sign-in provider refused the request. Try again in a moment.',
  'provider-not-configured': 'That sign-in method is not available on this deployment.',
  'rate-limited': 'Too many attempts. Wait a few minutes and try again.',
  'guest-already-migrated': 'This device’s guest profile is already linked to a different account.',
  'account-already-migrated': 'This account has already imported a guest profile.',
  'migration-conflict': 'This guest profile changed since it was linked, so nothing was imported.',
  'last-identity': 'Link another sign-in method before removing your only one.',
  'identity-not-linked': 'That sign-in method is not linked to this account.',
  network: 'The account service could not be reached. Guest play still works.',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initialFor(name: string): string {
  const letter = name.trim().charAt(0);
  return letter ? letter.toUpperCase() : '?';
}

/**
 * Provider avatars are remote images; only https is worth rendering, and a
 * relative path is never trusted as one. Anything else falls back to the
 * initial, so a corrupt or hostile URL cannot point at a local resource.
 */
function safeAvatarUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function messageFor(error: unknown): string {
  if (error instanceof AccountApiError) {
    return ERROR_TEXT[error.code] ?? error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export class AccountPanel {
  private readonly options: AccountPanelOptions;
  private root: HTMLElement | null = null;
  private trigger: HTMLButtonElement | null = null;
  private head: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private tabs: HTMLButtonElement[] = [];
  private state: AccountState | null = null;
  private careerSnapshot: CareerSnapshot | null = null;
  private notice: Notice | null = null;
  private busy = false;
  private pendingAction: 'revoke-all' | 'migrate' | null = null;
  /** Which section the screen is showing. */
  private view: AccountTab = 'account';
  private disposed = false;

  constructor(options: AccountPanelOptions) {
    this.options = options;
  }

  mount(): void {
    this.root = document.getElementById('menu-account');
    this.trigger = document.getElementById('menu-account-trigger') as HTMLButtonElement | null;
    this.head = document.getElementById('account-view-head');
    this.body = document.getElementById('menu-account-body');
    this.tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-account-tab]'));
    if (!this.root || !this.trigger || !this.head || !this.body) return;
    this.trigger.addEventListener('click', () => {
      this.options.navigate?.('account');
    });
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => {
        const target = tab.dataset.accountTab;
        if (target !== 'account' && target !== 'record') return;
        this.view = target;
        this.render();
      });
    }
    this.body.addEventListener('click', (event) => void this.onBodyClick(event));
    this.render();
    void this.refresh();
  }

  destroy(): void {
    this.disposed = true;
  }

  /** Called by the shell when the account screen becomes visible. */
  show(): void {
    this.render();
    void this.refresh();
  }

  /** Called on returning to the menu, so a session ended elsewhere is noticed. */
  async refresh(): Promise<void> {
    try {
      this.state = await this.options.api.state();
    } catch (error) {
      this.state = null;
      if (!(error instanceof AccountApiError) || error.status !== 503) {
        this.notice = { level: 'warning', text: messageFor(error) };
      }
    }
    if (this.options.career) {
      this.careerSnapshot = await this.options.career.load();
    }
    if (!this.disposed) this.render();
  }

  /** Report the result of an OAuth round trip, then re-read the session. */
  async handleAuthOutcome(outcome: 'signed-in' | 'linked' | 'error', code: string | null): Promise<void> {
    if (outcome === 'error') {
      const text = (code && ERROR_TEXT[code]) ?? 'Sign-in did not complete.';
      this.notice = { level: 'critical', text };
      this.options.notify?.(text, 'critical');
    } else {
      const text = outcome === 'linked' ? 'Sign-in method linked to your account.' : 'Signed in to your MCA account.';
      this.notice = { level: 'success', text };
      this.options.notify?.(text, 'success');
    }
    await this.refresh();
    // A failed round trip is worth showing where it can be acted on.
    if (this.notice?.level === 'critical') {
      this.view = 'account';
      this.options.navigate?.('account');
      this.render();
    }
  }

  private get account(): AccountView | null {
    return this.state?.authenticated ? this.state.account : null;
  }

  private get providers(): ProviderId[] {
    return this.state?.providers ?? [];
  }

  private get name(): string {
    const account = this.account;
    return account ? (account.displayName ?? 'Commander') : (this.options.guest?.callsign ?? 'Guest');
  }

  private get detail(): string {
    const account = this.account;
    if (!account) return this.state ? 'Local guest profile' : 'Account service unavailable';
    return account.identities.map((identity) => PROVIDER_LABEL[identity.provider]).join(' · ') || 'MCA account';
  }

  private render(): void {
    if (!this.root || !this.head || !this.body) return;
    const account = this.account;
    this.root.dataset.state = account ? 'account' : this.state ? 'guest' : 'offline';

    // The chip: standing, then the provider portrait, then the name.
    const avatar = this.root.querySelector<HTMLElement>('#menu-account-avatar');
    if (avatar) {
      const url = safeAvatarUrl(account?.avatarUrl ?? null);
      if (url) {
        avatar.innerHTML = `<img src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
      } else {
        avatar.textContent = initialFor(this.name);
      }
    }
    const nameEl = this.root.querySelector<HTMLElement>('#menu-account-name');
    if (nameEl) nameEl.textContent = this.name;
    const detailEl = this.root.querySelector<HTMLElement>('#menu-account-detail');
    if (detailEl) detailEl.textContent = this.detail;
    this.renderStanding();

    this.head.innerHTML = this.renderHead();
    this.body.innerHTML = this.renderBody();
    this.body.setAttribute('aria-labelledby', `account-tab-${this.view}`);
    for (const tab of this.tabs) {
      const active = tab.dataset.accountTab === this.view;
      tab.classList.toggle('on', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    }
  }

  /**
   * Standing on the chip: insignia, short rank and ladder level, ahead of the
   * avatar. It is hidden only when no career could be read at all, so the chip
   * never claims a rank it cannot back up.
   */
  private renderStanding(): void {
    if (!this.root) return;
    const wrap = this.root.querySelector<HTMLElement>('#menu-account-standing');
    const insignia = this.root.querySelector<HTMLElement>('#menu-account-insignia');
    const rankEl = this.root.querySelector<HTMLElement>('#menu-account-rank');
    const levelEl = this.root.querySelector<HTMLElement>('#menu-account-level');
    const snapshot = this.careerSnapshot;
    if (!wrap || !insignia || !rankEl || !levelEl || !snapshot) {
      if (wrap) wrap.hidden = true;
      return;
    }
    const rank = snapshot.view.rank;
    const level = rankForXp(snapshot.view.totals.xp).index + 1;
    wrap.hidden = false;
    insignia.innerHTML = rankInsigniaSvg(rank, { label: `${rank.name} insignia` });
    rankEl.textContent = rank.abbreviation;
    levelEl.textContent = `LV ${level}`;
    levelEl.title = `Level ${level} of ${RANKS.length} — ${rank.name} (${rank.grade})`;
  }

  /**
   * The identity block at the top of the screen. The full name is shown here,
   * at full size: the header chip has to truncate, this does not.
   */
  private renderHead(): string {
    const account = this.account;
    const url = safeAvatarUrl(account?.avatarUrl ?? null);
    const picture = url
      ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : escapeHtml(initialFor(this.name));
    const snapshot = this.careerSnapshot;
    const standing = snapshot
      ? (() => {
          const rank = snapshot.view.rank;
          const level = rankForXp(snapshot.view.totals.xp).index + 1;
          return `<div class="account-head-standing">
            <span class="account-head-insignia">${rankInsigniaSvg(rank, { label: `${rank.name} insignia` })}</span>
            <div class="account-head-standing-text">
              <b>${escapeHtml(rank.name)}</b>
              <small>LEVEL ${level} OF ${RANKS.length} · ${snapshot.view.totals.xp.toLocaleString()} XP</small>
            </div>
          </div>`;
        })()
      : '';
    return `
      <p class="eyebrow">COMMAND IDENTITY</p>
      <div class="account-head-row">
        <span class="account-head-avatar" data-state="${account ? 'account' : this.state ? 'guest' : 'offline'}" aria-hidden="true">${picture}</span>
        <div class="account-head-text">
          <h2>${escapeHtml(this.name)}</h2>
          <p>${escapeHtml(this.detail)}</p>
        </div>
        ${standing}
      </div>`;
  }

  private renderNotice(): string {
    if (!this.notice) return '';
    return `<p class="account-notice" role="${this.notice.level === 'critical' ? 'alert' : 'status'}" data-level="${this.notice.level}">${escapeHtml(this.notice.text)}</p>`;
  }

  private renderBody(): string {
    if (this.view === 'record') {
      return `<div class="account-record-view">
        ${this.renderNotice()}
        ${serviceRecordMarkup(this.careerSnapshot)}
      </div>`;
    }
    const account = this.account;
    const guest = this.options.guest;
    const parts: string[] = [];
    if (this.busy) parts.push('<p class="account-loading" role="status">Contacting account service…</p>');
    if (this.state === null && !this.busy) {
      parts.push(
        `<p class="account-note">Accounts are unavailable right now. Guest play and your local saves are unaffected.</p>`,
      );
    }
    parts.push(this.renderNotice());

    if (!account) {
      parts.push(
        `<p class="account-lede">Sign in to keep one career across devices. You can keep playing as a guest at any time.</p>`,
      );
      const providerButtons = (['google', 'discord'] as ProviderId[])
        .map((provider) => {
          const available = this.providers.includes(provider);
          return `<button type="button" class="account-provider" data-account-action="signin-${provider}"
            ${available ? '' : 'disabled aria-disabled="true"'}
            ${available ? '' : `title="Not configured on this deployment"`}>
            <span class="account-provider-mark" aria-hidden="true">${provider === 'google' ? 'G' : 'D'}</span>
            <span>Sign in with ${PROVIDER_LABEL[provider]}</span>
            ${available ? '' : '<small>Unavailable</small>'}
          </button>`;
        })
        .join('');
      parts.push(`<div class="account-providers">${providerButtons}</div>`);
      parts.push(
        `<div class="account-guest">
          <p class="account-guest-name">${escapeHtml(guest?.callsign ?? 'Guest')}</p>
          <p class="account-note">Your identity on this device. Saves, settings and campaign progress stay here.</p>
          <button type="button" class="account-secondary" data-account-action="leave">Continue as guest</button>
        </div>`,
      );
      parts.push(this.renderCareer());
      return parts.join('');
    }

    const identities = account.identities;
    const unlinkable = identities.length > 1;
    const rows = identities
      .map((identity) => {
        const label = PROVIDER_LABEL[identity.provider];
        const remove = unlinkable
          ? `<button type="button" class="account-link-action" data-account-action="unlink-${identity.provider}">Remove</button>`
          : `<span class="account-link-hint" title="Link another method first">Only sign-in method</span>`;
        return `<li class="account-identity">
          <span class="account-provider-mark" aria-hidden="true">${identity.provider === 'google' ? 'G' : 'D'}</span>
          <span class="account-identity-name">${label}<small>${escapeHtml(identity.displayName ?? 'Linked')}</small></span>
          ${remove}
        </li>`;
      })
      .join('');

    parts.push(`<ul class="account-identities" aria-label="Linked sign-in methods">${rows}</ul>`);
    const linkable = (['google', 'discord'] as ProviderId[]).filter(
      (provider) => this.providers.includes(provider) && !identities.some((identity) => identity.provider === provider),
    );
    if (linkable.length > 0) {
      parts.push(
        `<div class="account-link-row">${linkable
          .map(
            (provider) =>
              `<button type="button" class="account-secondary" data-account-action="link-${provider}">Link ${PROVIDER_LABEL[provider]}</button>`,
          )
          .join('')}</div>`,
      );
    }

    parts.push(this.renderGuestImport(account));
    parts.push(this.renderCareer());

    if (this.pendingAction === 'revoke-all') {
      parts.push(
        `<div class="account-confirm" role="group" aria-label="Confirm sign out everywhere">
          <p>Sign out of every device? This ends all sessions for this account.</p>
          <button type="button" class="account-danger" data-account-action="confirm-revoke-all">Sign out everywhere</button>
          <button type="button" class="account-secondary" data-account-action="cancel">Cancel</button>
        </div>`,
      );
    } else {
      parts.push(
        `<div class="account-session-actions">
          <button type="button" class="account-secondary" data-account-action="signout">Sign out</button>
          <button type="button" class="account-secondary" data-account-action="revoke-all">Sign out everywhere</button>
        </div>`,
      );
    }
    parts.push(
      `<p class="account-fineprint">Account id ${escapeHtml(account.id.slice(0, 8))}… · career XP, rank and match history are stored with this account.</p>`,
    );
    return parts.join('');
  }

  private renderCareer(): string {
    if (!this.options.career) return '';
    return `<section class="account-career" aria-label="Service record">
      ${careerSummaryMarkup(this.careerSnapshot)}
      ${careerHistoryMarkup(this.careerSnapshot, 4)}
      <button type="button" class="account-secondary" data-account-action="record">Open service record</button>
    </section>`;
  }

  private renderGuestImport(account: AccountView): string {
    const guest = this.options.guest;
    if (!guest || !this.options.storage) return '';
    if (guest.migratedAccountId === account.id) {
      return `<p class="account-note account-migrated">This device’s guest profile is linked to your account.</p>`;
    }
    if (guest.migratedAccountId && guest.migratedAccountId !== account.id) {
      return `<p class="account-notice" role="status" data-level="warning">This device’s guest profile is linked to a different account. Nothing will be merged automatically.</p>`;
    }
    if (this.pendingAction === 'migrate') {
      return `<div class="account-confirm" role="group" aria-label="Confirm guest import">
        <p>Import <b>${escapeHtml(guest.callsign)}</b> into this account? Your local saves stay on this device.</p>
        <button type="button" class="account-primary" data-account-action="confirm-migrate">Import guest profile</button>
        <button type="button" class="account-secondary" data-account-action="cancel">Cancel</button>
      </div>`;
    }
    return `<div class="account-guest">
      <p class="account-guest-name">${escapeHtml(guest.callsign)}</p>
      <p class="account-note">This device still has a guest profile. Import it so future career progress is attached to your account.</p>
      <button type="button" class="account-secondary" data-account-action="migrate">Import guest profile</button>
    </div>`;
  }

  private async onBodyClick(event: MouseEvent): Promise<void> {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-account-action]');
    if (!target) return;
    const action = target.dataset.accountAction ?? '';
    if (action === 'leave') {
      this.options.navigate?.(null);
      return;
    }
    if (action === 'record') {
      this.view = 'record';
      this.render();
      return;
    }
    if (action === 'signin-google' || action === 'signin-discord') {
      const provider: ProviderId = action === 'signin-google' ? 'google' : 'discord';
      window.location.assign(this.options.api.signInUrl(provider));
      return;
    }
    if (action === 'link-google' || action === 'link-discord') {
      const provider: ProviderId = action === 'link-google' ? 'google' : 'discord';
      window.location.assign(this.options.api.linkUrl(provider));
      return;
    }
    if (action === 'migrate') {
      this.pendingAction = 'migrate';
      this.render();
      return;
    }
    if (action === 'revoke-all') {
      this.pendingAction = 'revoke-all';
      this.render();
      return;
    }
    if (action === 'cancel') {
      this.pendingAction = null;
      this.render();
      return;
    }
    await this.runAction(action, target);
  }

  private async runAction(action: string, target: HTMLElement): Promise<void> {
    const account = this.account;
    if (!account && action !== 'confirm-revoke-all') return;
    target.setAttribute('aria-busy', 'true');
    this.busy = true;
    this.notice = null;
    this.render();
    try {
      if (action === 'signout') {
        await this.options.api.logout();
        this.notice = { level: 'info', text: 'Signed out. You are playing as a guest.' };
      } else if (action === 'confirm-revoke-all') {
        const revoked = await this.options.api.revokeAll();
        this.notice = { level: 'info', text: `Signed out of ${revoked} session${revoked === 1 ? '' : 's'}.` };
      } else if (action === 'unlink-google' || action === 'unlink-discord') {
        const provider: ProviderId = action === 'unlink-google' ? 'google' : 'discord';
        await this.options.api.unlink(provider);
        this.notice = { level: 'success', text: `${PROVIDER_LABEL[provider]} unlinked.` };
      } else if (action === 'confirm-migrate') {
        const guest = this.options.guest;
        const storage = this.options.storage;
        if (!guest || !storage) return;
        const result = await this.options.api.migrateGuest({
          ...(await guestMigrationRequest(guest)),
          career: this.options.career?.guestPayload() ?? [],
        });
        const updated = markGuestMigrated(storage, guest, account!.id);
        this.options.guest = updated;
        this.notice = {
          level: 'success',
          text:
            result.status === 'migrated'
              ? `Guest profile imported.${result.importedXp > 0 ? ` ${result.importedXp.toLocaleString()} career XP transferred.` : ''}`
              : 'Guest profile was already imported; nothing was duplicated.',
        };
      }
      this.pendingAction = null;
    } catch (error) {
      this.notice = { level: 'critical', text: messageFor(error) };
      this.pendingAction = null;
    } finally {
      this.busy = false;
      target.removeAttribute('aria-busy');
      await this.refresh();
      if (this.notice) this.options.notify?.(this.notice.text, this.notice.level);
    }
  }
}
