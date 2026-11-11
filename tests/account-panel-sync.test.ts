// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountState, HttpAccountApi } from '../src/accounts/client';
import { defaultComposition, type FlagDesign } from '../src/identity/flag';
import { FlagStore } from '../src/identity/flagStore';
import type { FlagSyncDocument } from '../src/identity/flagSync';
import { AccountPanel } from '../src/ui/accountPanel';

const ACCOUNT_ID = 'acct-alpha';
const INITIAL_REVISION = 4;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function signedInState(): AccountState {
  return {
    authenticated: true,
    account: {
      id: ACCOUNT_ID,
      createdAt: 1,
      status: 'active',
      lastAuthAt: 1,
      displayName: 'Alpha',
      avatarUrl: null,
      identities: [{ provider: 'google', displayName: 'Alpha', linkedAt: 1 }],
    },
    providers: ['google', 'discord'],
    identity: { callsign: 'Alpha', avatar: 'insignia' },
  };
}

function signedOutState(): AccountState {
  return { authenticated: false, account: null, providers: ['google', 'discord'], identity: null };
}

function emptyDocument(): FlagSyncDocument {
  return {
    designs: [],
    activeId: null,
    equipped: { frame: null, background: null, camo: null },
    revision: INITIAL_REVISION,
  };
}

/**
 * The panel talks to the account API through these two flag calls. Keeping the
 * fake at that seam means the test exercises the real hydration, debounce,
 * revision and sign-out wiring, not a second implementation of it.
 */
class FakeAccountApi {
  stateData: AccountState = signedInState();
  remote: FlagSyncDocument = emptyDocument();
  saves: Record<string, unknown>[] = [];
  flagReads = 0;
  failSaves = false;

  async state(): Promise<AccountState> {
    return clone(this.stateData);
  }

  async flags(): Promise<FlagSyncDocument> {
    this.flagReads += 1;
    return clone(this.remote);
  }

  async saveFlags(body: Record<string, unknown>): Promise<FlagSyncDocument> {
    this.saves.push(clone(body));
    if (this.failSaves) throw new Error('network down');

    const designs = Array.isArray(body.designs) ? (body.designs as FlagDesign[]) : [];
    const equipped =
      (body.equipped as FlagSyncDocument['equipped'] | undefined) ?? { frame: null, background: null, camo: null };
    this.remote = {
      designs: clone(designs),
      activeId: typeof body.activeId === 'string' ? body.activeId : null,
      equipped: clone(equipped),
      revision: Number(body.expectedRevision) + 1,
    };
    return clone(this.remote);
  }

  async logout(): Promise<void> {
    this.stateData = signedOutState();
  }
}

let api: FakeAccountApi;
let panel: AccountPanel | null = null;

function mountShell(): void {
  document.body.innerHTML = `
    <div id="menu-account">
      <button id="menu-account-trigger" type="button">Account</button>
      <span id="menu-account-avatar"></span>
      <span id="menu-account-name"></span>
      <span id="menu-account-detail"></span>
      <div id="menu-account-standing">
        <span id="menu-account-insignia"></span>
        <span id="menu-account-rank"></span>
        <span id="menu-account-level"></span>
      </div>
    </div>
    <header id="account-view-head"></header>
    <div id="menu-account-body"></div>
    <button type="button" data-account-tab="account"></button>
    <button type="button" data-account-tab="record"></button>
  `;
}

function activePanel(): AccountPanel {
  if (!panel) throw new Error('The account panel was not mounted.');
  return panel;
}

function flagStoreOf(target: AccountPanel): FlagStore {
  const store = (target as unknown as { flags: FlagStore | null }).flags;
  if (!store) throw new Error('The panel did not create its flag store.');
  return store;
}

/** Let the mount/refresh promise chain finish under fake timers. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  for (let index = 0; index < 6; index++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  mountShell();
  api = new FakeAccountApi();
  panel = new AccountPanel({
    api: api as unknown as HttpAccountApi,
    guest: null,
    storage: null,
    notify: vi.fn(),
  });
  panel.mount();
  await settle();
});

afterEach(() => {
  panel?.destroy();
  panel = null;
  vi.useRealTimers();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('AccountPanel flag sync', () => {
  it('coalesces rapid flag mutations into one debounced save', async () => {
    const store = flagStoreOf(activePanel());
    expect(store.state.accountId).toBe(ACCOUNT_ID);
    expect(api.flagReads).toBe(1);

    expect(store.create('First', defaultComposition()).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(399);
    expect(api.saves).toHaveLength(0);

    expect(store.create('Second', defaultComposition()).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(399);
    expect(api.saves).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(api.saves).toHaveLength(1);
    const body = api.saves[0];
    expect(body.expectedRevision).toBe(INITIAL_REVISION);
    expect((body.designs as FlagDesign[]).map((design) => design.name)).toEqual(['First', 'Second']);
    expect(api.remote.revision).toBe(INITIAL_REVISION + 1);

    await settle();
    expect(store.state.designs).toHaveLength(2);
  });

  it('flushes a pending mutation on refresh and does not repeat the timer push', async () => {
    const store = flagStoreOf(activePanel());
    expect(store.create('Refresh', defaultComposition()).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(api.saves).toHaveLength(0);

    await activePanel().refresh();
    await settle();
    expect(api.saves).toHaveLength(1);
    expect(api.saves[0].expectedRevision).toBe(INITIAL_REVISION);
    expect(api.remote.revision).toBe(INITIAL_REVISION + 1);

    // The debounce timer from the mutation still exists; firing it must see a
    // clean panel and send nothing a second time.
    await vi.advanceTimersByTimeAsync(500);
    expect(api.saves).toHaveLength(1);
  });

  it('keeps a failed push dirty and retries it on refresh', async () => {
    const store = flagStoreOf(activePanel());
    api.failSaves = true;
    expect(store.create('Retry', defaultComposition()).ok).toBe(true);

    await vi.advanceTimersByTimeAsync(400);
    expect(api.saves).toHaveLength(1);
    expect(store.state.designs).toHaveLength(1);
    expect(api.remote.revision).toBe(INITIAL_REVISION);

    api.failSaves = false;
    await activePanel().refresh();
    await settle();
    expect(api.saves).toHaveLength(2);
    expect(api.saves[1].expectedRevision).toBe(INITIAL_REVISION);
    expect(api.remote.revision).toBe(INITIAL_REVISION + 1);
    expect(api.remote.designs[0]?.name).toBe('Retry');
  });

  it('updates an existing design after an auth-expiry edit and re-login', async () => {
    const store = flagStoreOf(activePanel());
    const created = store.create('Before expiry', defaultComposition()).value!;
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(api.remote.designs).toHaveLength(1);

    expect(store.rename(created.id, 'After expiry').ok).toBe(true);
    expect(store.state.pending).toBe(true);

    // The session expires before the debounced rename is sent.
    api.stateData = signedOutState();
    await activePanel().refresh();
    await settle();
    expect(store.state.pending).toBe(true);

    // Signing back into the same account sends the edit as an update.
    api.stateData = signedInState();
    await activePanel().refresh();
    await settle();
    expect(api.remote.designs).toHaveLength(1);
    expect(api.remote.designs[0].id).toBe(created.id);
    expect(api.remote.designs[0].name).toBe('After expiry');
    expect(store.state.pending).toBe(false);
  });

  it('cancels a pending push and keeps local designs on sign-out', async () => {
    const store = flagStoreOf(activePanel());
    expect(store.create('Pending', defaultComposition()).ok).toBe(true);

    const signout = document.querySelector<HTMLButtonElement>(
      '#menu-account-body [data-account-action="signout"]',
    );
    expect(signout).not.toBeNull();
    signout!.click();

    await settle();
    await settle();
    expect(api.stateData.authenticated).toBe(false);
    expect(
      document.querySelector('#menu-account-body [data-account-action="signin-google"]'),
    ).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saves).toHaveLength(0);
    expect(store.state.designs).toHaveLength(1);
  });

  it('wears an equipped frame and background on the menu chip', () => {
    const target = activePanel();
    target.showCosmetics();
    const chip = document.getElementById('menu-account-avatar')!;
    const trigger = document.getElementById('menu-account-trigger')!;
    expect(chip.classList.contains('identity-frame-steel')).toBe(false);

    const equipFrame = document.querySelector<HTMLButtonElement>(
      '#menu-account-body [data-cosmetic-equip="frame:frame-steel"]',
    );
    expect(equipFrame).not.toBeNull();
    equipFrame!.click();
    expect(chip.classList.contains('identity-frame-steel')).toBe(true);

    const equipBackground = document.querySelector<HTMLButtonElement>(
      '#menu-account-body [data-cosmetic-equip="background:bg-deep"]',
    );
    expect(equipBackground).not.toBeNull();
    equipBackground!.click();
    expect(trigger.classList.contains('identity-bg-deep')).toBe(true);

    // Removing swaps the class off rather than leaving the old frame behind.
    const removeFrame = document.querySelector<HTMLButtonElement>(
      '#menu-account-body [data-cosmetic-equip="frame:"]',
    );
    expect(removeFrame).not.toBeNull();
    removeFrame!.click();
    expect(chip.classList.contains('identity-frame-steel')).toBe(false);
    expect(trigger.classList.contains('identity-bg-deep')).toBe(true);
  });
});
