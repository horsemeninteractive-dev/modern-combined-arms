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
import {
  identityBannerMarkup,
  matchDetailMarkup,
  serviceRecordMarkup,
} from './careerView';
import { AVATARS, CALLSIGN_CHANGES_PER_DAY } from '../accounts/identity';
import type { MatchHistoryItem } from '../accounts/client';
import { commanderLegacyMarkup } from './commanderLegacy';
import { rankInsigniaSvg } from './rankInsignia';
import { levelForXp } from '../accounts/levels';
import {
  guestMigrationRequest,
  markGuestMigrated,
  type GuestProfile,
  type GuestStorage,
} from '../accounts/guest';
import { FlagStore } from '../identity/flagStore';
import {
  cosmeticById,
  EMPTY_PROGRESS,
  type CosmeticCategory,
  type CosmeticProgress,
} from '../identity/cosmetics';
import { cosmeticsInventoryMarkup } from './cosmeticsInventory';
import { commandFlagSvg } from './commandFlag';
import { openFlagEditor } from './flagEditor';
import { pushFlags as pushAccountFlags, syncFlags as hydrateAccountFlags } from '../identity/sync';

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
  /** Open Commander Legacy from an award notification. */
  openLegacy?: () => void;
}

type Notice = { level: 'info' | 'warning' | 'critical' | 'success'; text: string };

/** The sections of the account screen, in rail order. */
type AccountTab = 'account' | 'record' | 'legacy' | 'cosmetics';

/** Swap one equipped cosmetic class, removing any the element already carries. */
function applyCosmeticClass(element: HTMLElement, prefix: string, token: string | null): void {
  for (const name of Array.from(element.classList)) {
    if (name.startsWith(prefix)) element.classList.remove(name);
  }
  if (token) element.classList.add(`${prefix}${token}`);
}

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
  /** Cosmetics category currently being browsed. */
  private cosmeticFilter: CosmeticCategory | 'all' = 'all';
  private disposed = false;
  /** Paged service record, newest first. Empty until the record is opened. */
  private history: { items: MatchHistoryItem[]; hasMore: boolean } = { items: [], hasMore: false };
  private historyLoading = false;
  /** Draft identity while the player edits it. */
  private identityDraft: { callsign: string; avatar: string } | null = null;
  /** Open the showcase from a notification, wherever the player is. */
  private openLegacyOption(): void {
    this.showLegacy();
    this.options.navigate?.('account');
  }

  /** The equipped cosmetics that belong to this identity, never another's. */
  private equippedCosmetics(): { frame: string | null; background: string | null; camo: string | null } {
    const store = this.flagStore();
    if (!store) return { frame: null, background: null, camo: null };
    const owner = this.account?.id ?? null;
    if (store.state.accountId !== owner) return { frame: null, background: null, camo: null };
    return store.state.equipped;
  }

  /** Local command flags and equipped cosmetics. Created on first use. */
  private flags: FlagStore | null = null;
  /** Account whose flags have already been merged this session. */
  private flagsSyncedFor: string | null = null;
  /** Revision last acknowledged by the account service. */
  private flagRevision = 0;
  /** A local mutation has not been accepted by the account yet. */
  private flagDirty = false;
  private flagSyncing = false;
  private flagSyncTimer: number | null = null;
  private unsubscribeFlags: (() => void) | null = null;

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
        if (target !== 'account' && target !== 'record' && target !== 'legacy' && target !== 'cosmetics') return;
        this.view = target;
        this.render();
      });
    }
    this.body.addEventListener('click', (event) => void this.onBodyClick(event));
    // An award notification can appear anywhere, including a result card, so
    // its route to the showcase is delegated from the document rather than
    // requiring every caller to know about this panel.
    document.addEventListener('click', this.onLegacyLink);
    window.addEventListener('online', this.onOnline);
    this.render();
    void this.refresh();
  }

  destroy(): void {
    this.disposed = true;
    this.unsubscribeFlags?.();
    this.unsubscribeFlags = null;
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('click', this.onLegacyLink);
    if (this.flagSyncTimer !== null) {
      window.clearTimeout(this.flagSyncTimer);
      this.flagSyncTimer = null;
    }
  }

  /** Called by the shell when the account screen becomes visible. */
  show(): void {
    this.render();
    void this.refresh();
  }

  /** Open the account screen on the Commander Legacy tab. */
  showLegacy(): void {
    this.view = 'legacy';
    this.render();
    void this.refresh();
  }

  /** Open the account screen on the cosmetics inventory. */
  showCosmetics(): void {
    this.view = 'cosmetics';
    this.render();
    void this.refresh();
  }

  private onLegacyLink = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-career-legacy]');
    if (!target) return;
    event.preventDefault();
    if (this.options.openLegacy) this.options.openLegacy();
    else this.openLegacyOption();
  };

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
    await this.syncFlags();
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

    // The chip: standing, then the provider portrait, then the name. It wears
    // the equipped frame and background like every other profile surface, so
    // an equip is visible here the moment the store changes.
    const equipped = this.equippedCosmetics();
    const frame = cosmeticById(equipped.frame);
    const background = cosmeticById(equipped.background);
    const avatar = this.root.querySelector<HTMLElement>('#menu-account-avatar');
    if (avatar) {
      const url = safeAvatarUrl(account?.avatarUrl ?? null);
      if (url) {
        avatar.innerHTML = `<img src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
      } else {
        avatar.textContent = initialFor(this.name);
      }
      applyCosmeticClass(avatar, 'identity-frame-', frame?.category === 'frame' ? frame.render : null);
    }
    if (this.trigger) {
      applyCosmeticClass(
        this.trigger,
        'identity-bg-',
        background?.category === 'background' ? background.render : null,
      );
    }
    const nameEl = this.root.querySelector<HTMLElement>('#menu-account-name');
    if (nameEl) nameEl.textContent = this.name;
    const detailEl = this.root.querySelector<HTMLElement>('#menu-account-detail');
    if (detailEl) detailEl.textContent = this.detail;
    this.renderStanding();

    this.head.innerHTML = this.renderHead();
    // The page head is a profile surface like the chip: it wears the equipped
    // frame and background, so an equip is visible on every tab at once.
    const headAvatar = this.head.querySelector<HTMLElement>('.account-head-avatar');
    if (headAvatar) {
      applyCosmeticClass(headAvatar, 'identity-frame-', frame?.category === 'frame' ? frame.render : null);
    }
    const headRow = this.head.querySelector<HTMLElement>('.account-head-row');
    if (headRow) {
      applyCosmeticClass(headRow, 'identity-bg-', background?.category === 'background' ? background.render : null);
    }
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
    const level = snapshot.view.level ?? levelForXp(snapshot.view.totals.xp);
    wrap.hidden = false;
    insignia.innerHTML = rankInsigniaSvg(rank, { label: `${rank.name} insignia` });
    rankEl.textContent = rank.abbreviation;
    levelEl.textContent = `LV ${level.level.number}`;
    levelEl.title = `Service level ${level.level.number} of 50 — ${rank.name} (${rank.grade})`;
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
    const store = this.flagStore();
    const snapshot = this.careerSnapshot;
    const standing = snapshot
      ? (() => {
          const rank = snapshot.view.rank;
          const level = snapshot.view.level ?? levelForXp(snapshot.view.totals.xp);
          return `<div class="account-head-standing">
            <span class="account-head-insignia">${rankInsigniaSvg(rank, { label: `${rank.name} insignia` })}</span>
            <div class="account-head-standing-text">
              <b>${escapeHtml(rank.name)}</b>
              <small>LEVEL ${level.level.number} OF 50 · ${snapshot.view.totals.xp.toLocaleString()} XP</small>
            </div>
          </div>`;
        })()
      : '';
    // Rank progress belongs here too: every tab then states the standing once,
    // and the record and legacy screens do not repeat it.
    const progress = snapshot
      ? (() => {
          const view = snapshot.view;
          const percent = Math.round(view.progress * 100);
          const next = view.next
            ? `${view.xpInto.toLocaleString()} / ${(view.xpSpan ?? 0).toLocaleString()} XP to ${view.next.name}`
            : 'Top of the rank ladder — every rank held';
          return `<div class="account-head-progress">
            <div class="career-progress" role="progressbar" aria-label="Progress to next rank"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>
            <p class="career-next">${escapeHtml(next)}</p>
          </div>`;
        })()
      : '';
    return `
      <p class="eyebrow">COMMAND IDENTITY</p>
      <div class="account-head-row">
        <span class="account-head-flag">${store ? commandFlagSvg(store.activeComposition(), { size: 96, title: 'Command flag' }) : ''}</span>
        <span class="account-head-avatar" data-state="${account ? 'account' : this.state ? 'guest' : 'offline'}" aria-hidden="true">${picture}</span>
        <div class="account-head-text">
          <h2>${escapeHtml(this.name)}</h2>
          <p>${escapeHtml(this.detail)}</p>
        </div>
        ${standing}
      </div>
      ${progress}`;
  }

  private renderNotice(): string {
    if (!this.notice) return '';
    return `<p class="account-notice" role="${this.notice.level === 'critical' ? 'alert' : 'status'}" data-level="${this.notice.level}">${escapeHtml(this.notice.text)}</p>`;
  }

  private renderBody(): string {
    if (this.view === 'legacy') {
      return `<div class="account-legacy-view">
        ${this.renderNotice()}
        ${commanderLegacyMarkup({ snapshot: this.careerSnapshot })}
      </div>`;
    }
    if (this.view === 'cosmetics') {
      const achievementNames: Record<string, string> = {};
      for (const award of this.careerSnapshot?.view.achievements ?? []) {
        achievementNames[award.id] = award.name;
      }
      return `<div class="account-cosmetics-view">
        ${this.renderNotice()}
        ${cosmeticsInventoryMarkup({
          progress: this.cosmeticProgress(),
          equipped: this.equippedCosmetics(),
          filter: this.cosmeticFilter,
          signedIn: this.account !== null,
          achievementNames,
        })}
      </div>`;
    }
    if (this.view === 'record') {
      return `<div class="account-record-view">
        ${this.renderNotice()}
        ${serviceRecordMarkup(this.careerSnapshot, {
          stats: this.careerSnapshot?.view.stats ?? null,
          history: this.history.items.length > 0 ? this.history.items : null,
          hasMore: this.history.hasMore,
        })}
        ${this.historyLoading ? '<p class="account-loading" role="status">Reading match history…</p>' : ''}
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
      const guestStore = this.flagStore();
      const guestEquipped = guestStore?.state.equipped ?? { frame: null, background: null };
      const guestRank = this.careerSnapshot?.view.rank;
      parts.push(
        `<div class="account-guest">
          ${identityBannerMarkup(
            { callsign: guest?.callsign ?? 'Guest', avatar: 'insignia' },
            guestRank?.name ?? 'Guest',
            guestRank?.grade ?? 'Local profile',
            this.careerSnapshot?.view.totals.xp ?? 0,
            {
              flagHtml: guestStore
                ? commandFlagSvg(guestStore.activeComposition(), {
                    size: 148,
                    title: 'Local command flag',
                  })
                : undefined,
              frame: guestEquipped.frame,
              background: guestEquipped.background,
            },
          )}
          <p class="account-note">Your identity on this device. Saves, settings and campaign progress stay here.</p>
          <button type="button" class="account-secondary" data-account-action="leave">Continue as guest</button>
        </div>`,
      );
      parts.push(this.renderCommandFlag());
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

    parts.push(this.renderIdentityEditor());
    parts.push(this.renderGuestImport(account));

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

  /**
   * Callsign and avatar editing.
   *
   * The draft lives in the panel so choosing an avatar does not discard a
   * half-typed callsign; only Save writes, and the server re-validates every
   * field including uniqueness and the daily rename budget.
   */
  private renderIdentityEditor(): string {
    if (!this.account) return '';
    const current = this.identityDraft ?? {
      callsign: this.state?.identity?.callsign ?? '',
      avatar: this.state?.identity?.avatar ?? 'insignia',
    };
    const avatars = AVATARS.map(
      (avatar) =>
        `<button type="button" class="avatar-choice${avatar.id === current.avatar ? ' on' : ''}"
          data-account-action="avatar" data-avatar="${avatar.id}"
          aria-pressed="${avatar.id === current.avatar ? 'true' : 'false'}">
          <span aria-hidden="true">${avatar.glyph}</span><small>${avatar.label}</small>
        </button>`,
    ).join('');
    // The page head already shows the callsign, flag, frame and background;
    // this editor only edits, so it opens on the fields themselves.
    return `<section class="account-identity-editor" aria-label="Player identity">
      <label class="account-field"><span>CALLSIGN</span>
        <input id="account-callsign" type="text" maxlength="20" minlength="3"
          autocomplete="off" spellcheck="false" value="${escapeHtml(current.callsign)}" />
      </label>
      <div class="account-avatars" role="group" aria-label="Avatar">${avatars}</div>
      ${this.renderCommandFlag()}
      <button type="button" class="account-primary" data-account-action="save-identity">Save identity</button>
      <p class="account-note">Your callsign is how opponents see you in a lobby: 3–20 letters, digits, spaces, hyphens or underscores, up to ${CALLSIGN_CHANGES_PER_DAY} changes a day.</p>
    </section>`;
  }

  /**
   * The command-flag row, shown to guests and accounts alike.
   *
   * A guest design lives in this browser; signing in later merges it into the
   * account, so the editor must never be gated behind an account.
   */
  private renderCommandFlag(): string {
    const store = this.flagStore();
    return `<div class="account-flag-row">
      <div class="account-flag-copy">
        <span class="account-field-label">PERSONAL COMMAND FLAG</span>
        <p class="account-note">Your own identity, separate from the national flag your force flies in a match. ${store ? 'The active flag flies on your profile; designs are chosen here.' : 'This browser has blocked the local storage flags need.'}</p>
        <button type="button" class="account-secondary" data-account-action="flags">Edit command flag</button>
      </div>
    </div>`;
  }

  /**
   * The local command-flag store, created on first use.
   *
   * A browser with blocked storage still plays: the store reports the failure
   * on save and the panel says so rather than pretending the design was kept.
   */
  private flagStore(): FlagStore | null {
    if (this.flags) return this.flags;
    try {
      if (typeof localStorage === 'undefined') return null;
      this.flags = new FlagStore(localStorage);
      this.unsubscribeFlags = this.flags.subscribe(() => this.onFlagMutation());
      return this.flags;
    } catch {
      return null;
    }
  }

  /**
   * Career progress that decides cosmetic unlocks.
   *
   * The same numbers the service record shows: XP, recorded matches and wins.
   * A guest has local totals; an account has server totals. Locked items stay
   * visible with the step that opens them, so the ladder is legible.
   */
  private cosmeticProgress(): CosmeticProgress {
    const view = this.careerSnapshot?.view;
    if (!view) return EMPTY_PROGRESS;
    return {
      xp: view.totals.xp,
      matches: view.totals.matches,
      wins: view.totals.victories,
      achievements: (view.achievements ?? []).filter((entry) => entry.complete).map((entry) => entry.id),
    };
  }

  private openFlags(): void {
    const store = this.flagStore();
    if (!store) {
      this.notice = {
        level: 'warning',
        text: 'Command flags need local storage, which this browser has blocked. Guest play still works.',
      };
      this.render();
      return;
    }
    openFlagEditor({
      store,
      progress: () => this.cosmeticProgress(),
      onChange: () => this.render(),
    });
  }

  /**
   * Reconcile this browser's flags with the account once per signed-in session.
   *
   * A guest profile is merged additively. A document owned by this same account
   * that still has pending edits is pushed as updates, so an edit made after the
   * session expired keeps its design id instead of arriving as a duplicate. A
   * clean cache adopts the account document. A failed read leaves local designs
   * untouched and says nothing, because guest play must stay silent and useful
   * without an account.
   */
  private async syncFlags(): Promise<void> {
    const account = this.account;
    const store = this.flagStore();
    if (!account || !store) {
      // Signing out ends the account session. The local document keeps its
      // owner, so signing back into the same account can still import guest
      // edits, while a different account adopts its own document instead.
      if (this.flagsSyncedFor !== null) {
        this.flagsSyncedFor = null;
        this.flagRevision = 0;
        this.flagDirty = false;
        if (this.flagSyncTimer !== null) {
          window.clearTimeout(this.flagSyncTimer);
          this.flagSyncTimer = null;
        }
      }
      return;
    }
    if (this.flagsSyncedFor === account.id) {
      if (this.flagDirty) await this.flushFlagChanges();
      return;
    }
    this.flagsSyncedFor = account.id;
    this.flagRevision = 0;
    this.flagDirty = false;
    const mutations = store.mutationCount;
    const result = await hydrateAccountFlags(store, this.options.api, Date.now(), account.id);
    if (this.account?.id !== account.id) {
      // The session changed while the read was in flight. Re-hydrate for the
      // account that is signed in now rather than keeping the old document.
      this.flagsSyncedFor = null;
      void this.syncFlags();
      return;
    }
    if (result.status === 'offline') {
      // A failed hydration is not a completed one: retry on the next refresh.
      this.flagsSyncedFor = null;
      this.flagDirty = store.state.pending === true || store.mutationCount !== mutations;
      return;
    }
    this.flagRevision = result.revision;
    this.flagDirty = store.state.pending === true || store.mutationCount !== mutations;
    if (this.flagDirty) this.scheduleFlagPush();
    if (result.status === 'merged' || result.status === 'pushed') {
      this.notice = {
        level: 'success',
        text:
          result.imported > 0
            ? `${result.imported} local flag design${result.imported === 1 ? '' : 's'} added to your account.`
            : 'Command flags synchronised.',
      };
    }
  }

  private onFlagMutation = (): void => {
    if (!this.account) return;
    this.flagDirty = true;
    this.scheduleFlagPush();
  };

  private onOnline = (): void => {
    if (this.flagDirty) this.scheduleFlagPush();
  };

  /** Coalesce a burst of editor changes into one account write. */
  private scheduleFlagPush(): void {
    if (typeof window === 'undefined' || !this.flagDirty) return;
    if (this.flagSyncTimer !== null) window.clearTimeout(this.flagSyncTimer);
    this.flagSyncTimer = window.setTimeout(() => {
      this.flagSyncTimer = null;
      void this.flushFlagChanges();
    }, 400);
  }

  /**
   * Send the current local document to the signed-in account.
   *
   * A failed write keeps the document dirty, so the next edit, refresh or
   * reconnect retries it. A write that finishes while the player has made a
   * newer local edit is followed immediately by another, so the latest state
   * wins instead of being replaced by the acknowledged older one.
   */
  private async flushFlagChanges(): Promise<void> {
    const account = this.account;
    const store = this.flagStore();
    if (!account || !store || this.flagSyncing || !this.flagDirty) return;
    if (store.state.accountId !== null && store.state.accountId !== account.id) return;
    this.flagSyncing = true;
    const mutations = store.mutationCount;
    let succeeded = false;
    try {
      const result = await pushAccountFlags(
        store,
        this.options.api,
        Date.now(),
        account.id,
        store.state.revision ?? this.flagRevision,
      );
      if (this.account?.id !== account.id) {
        this.flagsSyncedFor = null;
        void this.syncFlags();
        return;
      }
      if (result.status === 'offline') {
        this.flagDirty = true;
        this.notice = {
          level: 'warning',
          text: result.error
            ? `Command flags are saved on this device, but your account did not accept the change: ${result.error}`
            : 'Command flags are saved on this device but could not reach your account yet. They will retry.',
        };
      } else {
        succeeded = true;
        this.flagRevision = result.revision;
        this.flagDirty = store.state.pending === true || store.mutationCount !== mutations;
      }
    } finally {
      this.flagSyncing = false;
    }
    if (succeeded && this.flagDirty) this.scheduleFlagPush();
    if (!this.disposed) this.render();
  }

  /**
   * Wear or remove one cosmetic.
   *
   * The local store applies the same ownership rule the account service
   * enforces, so a locked item is refused here with the reason rather than
   * being sent and refused later. A signed-in player's change is pushed by the
   * store subscription, exactly like a flag edit.
   */
  private equipCosmetic(category: CosmeticCategory, id: string | null): void {
    const store = this.flagStore();
    if (!store) {
      this.notice = {
        level: 'warning',
        text: 'Cosmetics need local storage, which this browser has blocked.',
      };
      this.render();
      return;
    }
    const result = store.equip(category, id, this.cosmeticProgress());
    if (!result.ok) {
      this.notice = { level: 'warning', text: result.error ?? 'That cosmetic cannot be equipped.' };
      this.render();
      return;
    }
    this.notice = {
      level: 'success',
      text: id === null ? 'Cosmetic removed.' : 'Cosmetic equipped.',
    };
    this.render();
  }

  private async loadHistory(reset: boolean): Promise<void> {
    if (!this.account || this.historyLoading) return;
    this.historyLoading = true;
    if (reset) this.history = { items: [], hasMore: false };
    this.render();
    try {
      const page = await this.options.api.history(reset ? 0 : this.history.items.length);
      const seen = new Set(this.history.items.map((item) => item.match.ref));
      const items = reset
        ? page.items
        : [...this.history.items, ...page.items.filter((item) => !seen.has(item.match.ref))];
      this.history = { items, hasMore: page.hasMore };
    } catch (error) {
      this.notice = { level: 'warning', text: messageFor(error) };
    } finally {
      this.historyLoading = false;
      this.render();
    }
  }

  private openMatchDetail(ref: string): void {
    const box = this.body?.querySelector<HTMLElement>('#account-match-detail');
    const item = this.history.items.find((entry) => entry.match.ref === ref);
    if (!box || !item) return;
    box.innerHTML = matchDetailMarkup(item);
    box.scrollIntoView?.({ block: 'nearest' });
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
    const clicked = (event.target as HTMLElement | null) ?? null;
    const filter = clicked?.closest<HTMLElement>('[data-account-filter]');
    if (filter) {
      const value = filter.dataset.accountFilter ?? 'all';
      this.cosmeticFilter =
        value === 'frame' || value === 'background' || value === 'camo' || value === 'emblem'
          ? value
          : 'all';
      this.render();
      return;
    }
    const equip = clicked?.closest<HTMLElement>('[data-cosmetic-equip]');
    if (equip) {
      const [category, ...rest] = (equip.dataset.cosmeticEquip ?? '').split(':');
      if (category === 'frame' || category === 'background' || category === 'camo') {
        this.equipCosmetic(category, rest.join(':') || null);
      }
      return;
    }
    const target = clicked?.closest<HTMLElement>('[data-account-action]');
    if (!target) return;
    const action = target.dataset.accountAction ?? '';
    if (action === 'leave') {
      this.options.navigate?.(null);
      return;
    }
    if (action === 'account') {
      this.view = 'account';
      this.render();
      return;
    }
    if (action === 'legacy') {
      this.view = 'legacy';
      this.render();
      return;
    }
    if (action === 'cosmetics') {
      this.view = 'cosmetics';
      this.render();
      return;
    }
    if (action === 'record') {
      this.view = 'record';
      this.render();
      void this.loadHistory(true);
      return;
    }
    if (action === 'history-more') {
      void this.loadHistory(false);
      return;
    }
    if (action === 'match') {
      this.openMatchDetail(target.dataset.matchRef ?? '');
      return;
    }
    if (action === 'avatar') {
      const callsign =
        this.body?.querySelector<HTMLInputElement>('#account-callsign')?.value ??
        this.state?.identity?.callsign ??
        '';
      this.identityDraft = { callsign, avatar: target.dataset.avatar ?? 'insignia' };
      this.render();
      return;
    }
    if (action === 'flags') {
      this.openFlags();
      return;
    }
    if (action === 'save-identity') {
      this.identityDraft = {
        callsign:
          this.body?.querySelector<HTMLInputElement>('#account-callsign')?.value ??
          this.identityDraft?.callsign ??
          '',
        avatar: this.identityDraft?.avatar ?? this.state?.identity?.avatar ?? 'insignia',
      };
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
      } else if (action === 'save-identity') {
        const draft = this.identityDraft;
        if (!draft) return;
        await this.options.api.updateIdentity({ callsign: draft.callsign, avatar: draft.avatar });
        this.identityDraft = null;
        this.notice = { level: 'success', text: 'Identity saved.' };
        await this.refresh();
        return;
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
