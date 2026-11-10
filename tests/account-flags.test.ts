import { describe, expect, it } from 'vitest';
import {
  defaultComposition,
  type FlagComposition,
  type FlagDesign,
} from '../src/identity/flag';
import {
  parseFlagSubmission,
  parseFlagSyncDocument,
  type FlagSyncDocument,
} from '../src/identity/flagSync';
import { MemoryAccountStore } from '../src/accounts/memoryStore';
import { FlagStore, mergeGuestFlags, type FlagStorage } from '../src/identity/flagStore';
import { pushFlags, syncFlags, type FlagSyncApi } from '../src/identity/sync';
import { EMPTY_PROGRESS, type CosmeticProgress } from '../src/identity/cosmetics';

class MemoryStorage implements FlagStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function design(overrides: Partial<FlagDesign> = {}): FlagDesign {
  return {
    id: 'flag-one',
    name: 'First flag',
    composition: defaultComposition(),
    createdAt: 100,
    updatedAt: 100,
    schemaVersion: 1,
    ...overrides,
  };
}

function document(overrides: Partial<FlagSyncDocument> = {}): FlagSyncDocument {
  return {
    designs: [design()],
    activeId: 'flag-one',
    equipped: { frame: null, background: null, camo: null },
    revision: 0,
    ...overrides,
  };
}

const freeProgress: CosmeticProgress = { ...EMPTY_PROGRESS };

describe('flag submission validation', () => {
  it('accepts a document whose design and cosmetics are valid', () => {
    const parsed = parseFlagSubmission(
      { ...document(), expectedRevision: 0, equipped: { frame: 'frame-steel', background: null } },
      freeProgress,
      500,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.submission.designs).toHaveLength(1);
    expect(parsed.submission.equipped.frame).toBe('frame-steel');
    expect(parsed.submission.expectedRevision).toBe(0);
  });

  it('rejects an unknown emblem inside a composition', () => {
    const composition = JSON.parse(JSON.stringify(defaultComposition())) as FlagComposition;
    composition.emblem = { ...composition.emblem!, id: 'not-an-emblem' };
    const parsed = parseFlagSubmission(
      { ...document(), designs: [design({ composition })], expectedRevision: 0 },
      freeProgress,
      500,
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects more designs than the shared limit', () => {
    const designs = Array.from({ length: 9 }, (_, index) =>
      design({ id: `flag-${index + 1}0`, name: `Flag ${index}` }),
    );
    const parsed = parseFlagSubmission(
      { ...document(), designs, activeId: designs[0].id, expectedRevision: 0 },
      freeProgress,
      500,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.join(' ')).toMatch(/At most 8/);
  });

  it('rejects a cosmetic the player has not earned', () => {
    const parsed = parseFlagSubmission(
      { ...document(), expectedRevision: 0, equipped: { frame: 'frame-laurel', background: null } },
      freeProgress,
      500,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.join(' ')).toMatch(/unlocked/);
  });

  it('rejects a locked emblem submitted inside a design', () => {
    const composition = JSON.parse(JSON.stringify(defaultComposition())) as FlagComposition;
    composition.emblem = { ...composition.emblem!, id: 'wing' };
    const parsed = parseFlagSubmission(
      { ...document(), designs: [design({ composition })], expectedRevision: 0 },
      freeProgress,
      500,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.join(' ')).toMatch(/unlocked/);
  });

  it('accepts a locked emblem once authoritative progress earns it', () => {
    const composition = JSON.parse(JSON.stringify(defaultComposition())) as FlagComposition;
    composition.emblem = { ...composition.emblem!, id: 'wing' };
    const parsed = parseFlagSubmission(
      { ...document(), designs: [design({ composition })], expectedRevision: 0 },
      { xp: 0, matches: 0, wins: 50 },
      500,
    );
    expect(parsed.ok).toBe(true);
  });

  it('treats the eagle as explicitly free rather than a missing catalogue entry', () => {
    const composition = JSON.parse(JSON.stringify(defaultComposition())) as FlagComposition;
    composition.emblem = { ...composition.emblem!, id: 'eagle' };
    const parsed = parseFlagSubmission(
      { ...document(), designs: [design({ composition })], expectedRevision: 0 },
      freeProgress,
      500,
    );
    expect(parsed.ok).toBe(true);
  });

  it('rejects unowned and unknown profile cosmetics', () => {
    for (const equipped of [
      { frame: null, background: 'bg-parade' },
      { frame: 'frame-not-real', background: null },
      { frame: null, background: 'bg-not-real' },
    ]) {
      const parsed = parseFlagSubmission(
        { ...document(), expectedRevision: 0, equipped },
        freeProgress,
        500,
      );
      expect(parsed.ok, JSON.stringify(equipped)).toBe(false);
    }
  });

  it('ignores client-supplied progress or ownership claims', () => {
    const parsed = parseFlagSubmission(
      {
        ...document(),
        expectedRevision: 0,
        equipped: { frame: 'frame-laurel', background: null },
        xp: 999999,
        wins: 999,
        owned: ['frame-laurel'],
      },
      freeProgress,
      500,
    );
    expect(parsed.ok).toBe(false);
  });

  it('rejects an active design that is not submitted', () => {
    const parsed = parseFlagSubmission(
      { ...document(), activeId: 'flag-missing', expectedRevision: 0 },
      freeProgress,
      500,
    );
    expect(parsed.ok).toBe(false);
  });

  it('requires a revision to base the write on', () => {
    const parsed = parseFlagSubmission(document(), freeProgress, 500);
    expect(parsed.ok).toBe(false);
  });

  it('rejects duplicate design ids and oversized names', () => {
    const duplicate = parseFlagSubmission(
      { ...document(), designs: [design(), design()], expectedRevision: 0 },
      freeProgress,
      500,
    );
    expect(duplicate.ok).toBe(false);

    const longName = parseFlagSubmission(
      { ...document(), designs: [design({ name: 'x'.repeat(80) })], expectedRevision: 0 },
      freeProgress,
      500,
    );
    // The name is trimmed to the limit rather than rejected.
    expect(longName.ok).toBe(true);
    if (!longName.ok) return;
    expect(longName.submission.designs[0].name.length).toBeLessThanOrEqual(28);
  });
});

describe('server document reads', () => {
  it('drops a design this build cannot render and clears its active flag', () => {
    const parsed = parseFlagSyncDocument(
      {
        designs: [
          { ...design(), composition: defaultComposition() },
          { ...design({ id: 'flag-broken' }), composition: { version: 99 } },
        ],
        activeId: 'flag-broken',
        equipped: { frame: null, background: null },
        revision: 3,
      },
      500,
    );
    expect(parsed.designs.map((entry) => entry.id)).toEqual(['flag-one']);
    expect(parsed.activeId).toBeNull();
    expect(parsed.revision).toBe(3);
  });
});

describe('account identity document store', () => {
  function record(id: string, name = 'First flag') {
    return {
      accountId: 'acct',
      designId: id,
      name,
      composition: JSON.stringify(defaultComposition()),
      schemaVersion: 1,
      createdAt: 100,
      updatedAt: 200,
    };
  }

  function identity(overrides: Partial<Parameters<MemoryAccountStore['savePlayerIdentityDocument']>[1]> = {}) {
    return {
      designs: [record('flag-one')],
      activeDesignId: 'flag-one',
      frame: 'frame-steel',
      background: null,
      camo: null,
      revision: 1,
      updatedAt: 200,
      ...overrides,
    };
  }

  it('round-trips designs, the active flag and equipped cosmetics as one document', async () => {
    const store = new MemoryAccountStore();
    await store.createAccount({ id: 'acct', now: 1 });
    expect(await store.savePlayerIdentityDocument('acct', identity(), 0)).toBe('ok');
    const saved = await store.playerIdentityDocument('acct');
    expect(saved?.revision).toBe(1);
    expect(saved?.activeDesignId).toBe('flag-one');
    expect(saved?.frame).toBe('frame-steel');
    expect(saved?.designs[0].name).toBe('First flag');
  });

  it('rejects a stale complete document without changing any part of the old one', async () => {
    const store = new MemoryAccountStore();
    await store.createAccount({ id: 'acct', now: 1 });
    expect(await store.savePlayerIdentityDocument('acct', identity(), 0)).toBe('ok');
    const replacement = identity({
      designs: [record('flag-one', 'Renamed'), record('flag-two', 'Second')],
      frame: null,
      background: 'bg-deep',
      revision: 2,
    });
    expect(await store.savePlayerIdentityDocument('acct', replacement, 0)).toBe('conflict');
    const saved = await store.playerIdentityDocument('acct');
    expect(saved?.designs).toHaveLength(1);
    expect(saved?.designs[0].name).toBe('First flag');
    expect(saved?.frame).toBe('frame-steel');
    expect(saved?.revision).toBe(1);
    expect(await store.savePlayerIdentityDocument('acct', replacement, 1)).toBe('ok');
  });

  it('cannot lose designs when two devices save against the same revision', async () => {
    const store = new MemoryAccountStore();
    await store.createAccount({ id: 'acct', now: 1 });
    await store.savePlayerIdentityDocument('acct', identity(), 0);
    const deleteSecond = identity({ designs: [record('flag-one')], revision: 2 });
    const renameFirst = identity({
      designs: [record('flag-one', 'Renamed'), record('flag-two', 'Second')],
      revision: 2,
    });
    expect(await store.savePlayerIdentityDocument('acct', deleteSecond, 1)).toBe('ok');
    expect(await store.savePlayerIdentityDocument('acct', renameFirst, 1)).toBe('conflict');
    const saved = await store.playerIdentityDocument('acct');
    expect(saved?.revision).toBe(2);
    expect(saved?.designs.map((design) => design.designId)).toEqual(['flag-one']);
    expect(saved?.activeDesignId).toBe('flag-one');
  });

  it('keeps the active selection valid when a delete races a rename', async () => {
    const store = new MemoryAccountStore();
    await store.createAccount({ id: 'acct', now: 1 });
    await store.savePlayerIdentityDocument(
      'acct',
      identity({
        designs: [record('flag-one'), record('flag-two')],
        activeDesignId: 'flag-one',
      }),
      0,
    );
    const deleteActive = identity({
      designs: [record('flag-two')],
      activeDesignId: null,
      revision: 2,
    });
    const renameActive = identity({
      designs: [record('flag-one', 'Renamed'), record('flag-two')],
      activeDesignId: 'flag-one',
      revision: 2,
    });
    expect(await store.savePlayerIdentityDocument('acct', deleteActive, 1)).toBe('ok');
    expect(await store.savePlayerIdentityDocument('acct', renameActive, 1)).toBe('conflict');
    const saved = await store.playerIdentityDocument('acct');
    expect(saved?.designs.map((design) => design.designId)).toEqual(['flag-two']);
    expect(saved?.activeDesignId).toBeNull();
    expect(saved?.revision).toBe(2);
  });
});

describe('sign-in merge', () => {
  function fakeApi(initial: FlagSyncDocument): FlagSyncApi & { saved: FlagSyncDocument[]; remote: FlagSyncDocument } {
    const api = {
      remote: initial,
      saved: [] as FlagSyncDocument[],
      async flags(): Promise<FlagSyncDocument> {
        return JSON.parse(JSON.stringify(api.remote)) as FlagSyncDocument;
      },
      async saveFlags(body: Record<string, unknown>): Promise<FlagSyncDocument> {
        if (body.expectedRevision !== api.remote.revision) {
          throw Object.assign(new Error('stale'), { code: 'stale-write' });
        }
        const next = parseFlagSyncDocument(
          {
            designs: body.designs,
            activeId: body.activeId,
            equipped: body.equipped,
            revision: api.remote.revision + 1,
          },
          Date.now(),
        );
        api.remote = next;
        api.saved.push(next);
        return next;
      },
    };
    return api;
  }

  it('imports local designs into an empty account and keeps them active', async () => {
    const storage = new MemoryStorage();
    const store = new FlagStore(storage, () => 1000);
    const local = store.create('Local flag', defaultComposition()).value!;
    store.setActive(local.id);
    const api = fakeApi(document({ designs: [], activeId: null, revision: 0 }));

    const result = await syncFlags(store, api, 5000);
    expect(result.status).toBe('merged');
    expect(result.imported).toBe(1);
    expect(api.remote.designs).toHaveLength(1);
    expect(store.state.designs).toHaveLength(1);
    expect(store.state.activeId).toBe(store.state.designs[0].id);
  });

  it('adopts an existing account document without touching it', async () => {
    const storage = new MemoryStorage();
    const store = new FlagStore(storage, () => 1000);
    const api = fakeApi(document({ designs: [design()], activeId: 'flag-one', revision: 4 }));

    const result = await syncFlags(store, api, 5000);
    expect(result.status).toBe('synced');
    expect(api.saved).toHaveLength(0);
    expect(store.state.designs.map((entry) => entry.id)).toEqual(['flag-one']);
    expect(store.state.activeId).toBe('flag-one');
  });

  it('never overwrites an account design with a local one of the same name', async () => {
    const storage = new MemoryStorage();
    const store = new FlagStore(storage, () => 1000);
    store.create('Account flag', defaultComposition());
    const api = fakeApi(
      document({ designs: [design({ id: 'acct-design', name: 'Account flag' })], activeId: 'acct-design', revision: 2 }),
    );
    await syncFlags(store, api, 5000);
    expect(api.remote.designs).toHaveLength(1);
    expect(api.remote.designs[0].id).toBe('acct-design');
    expect(store.state.designs[0].id).toBe('acct-design');
  });

  it('reports an unreachable account service without losing local flags', async () => {
    const storage = new MemoryStorage();
    const store = new FlagStore(storage, () => 1000);
    store.create('Local flag', defaultComposition());
    const api: FlagSyncApi = {
      async flags() {
        throw new Error('offline');
      },
      async saveFlags() {
        throw new Error('offline');
      },
    };
    const result = await syncFlags(store, api, 5000);
    expect(result.status).toBe('offline');
    expect(store.state.designs).toHaveLength(1);
  });

  it('re-reads and retries when another device wrote first', async () => {
    const storage = new MemoryStorage();
    const store = new FlagStore(storage, () => 1000);
    store.create('Local flag', defaultComposition());
    let calls = 0;
    const remote = document({ designs: [], activeId: null, revision: 1 });
    const api: FlagSyncApi = {
      async flags() {
        calls += 1;
        return JSON.parse(JSON.stringify(remote)) as FlagSyncDocument;
      },
      async saveFlags(body) {
        if (calls === 1) throw Object.assign(new Error('stale'), { code: 'stale-write' });
        return parseFlagSyncDocument(
          {
            designs: body.designs,
            activeId: body.activeId,
            equipped: body.equipped,
            revision: 2,
          },
          0,
        );
      },
    };
    const result = await syncFlags(store, api, 5000);
    expect(calls).toBe(2);
    expect(result.status).toBe('merged');
    expect(store.state.designs).toHaveLength(1);
  });

  it('keeps the merge deterministic when run twice', async () => {
    const storage = new MemoryStorage();
    const store = new FlagStore(storage, () => 1000);
    store.create('Local flag', defaultComposition());
    const api = fakeApi(document({ designs: [], activeId: null, revision: 0 }));
    await syncFlags(store, api, 5000);
    const before = JSON.stringify(api.remote.designs);
    const second = await syncFlags(store, api, 6000);
    expect(second.imported).toBe(0);
    expect(JSON.stringify(api.remote.designs)).toBe(before);
    expect(mergeGuestFlags(store.state, store.state, 7000).imported).toBe(0);
  });
});

describe('incremental synchronisation', () => {
  function apiFor(initial: FlagSyncDocument) {
    const api = {
      remote: initial,
      saves: [] as Record<string, unknown>[],
      failNext: false,
      async flags(): Promise<FlagSyncDocument> {
        return JSON.parse(JSON.stringify(api.remote)) as FlagSyncDocument;
      },
      async saveFlags(body: Record<string, unknown>): Promise<FlagSyncDocument> {
        if (api.failNext) {
          api.failNext = false;
          throw new Error('network down');
        }
        if (body.expectedRevision !== api.remote.revision) {
          throw Object.assign(new Error('stale'), { code: 'stale-write' });
        }
        api.saves.push(body);
        api.remote = parseFlagSyncDocument(
          {
            designs: body.designs,
            activeId: body.activeId,
            equipped: body.equipped,
            revision: api.remote.revision + 1,
          },
          Date.now(),
        );
        return api.remote;
      },
    };
    return api;
  }

  it('pushes a mutation made after the initial hydration', async () => {
    const storage = new MemoryStorage();
    const store = new FlagStore(storage, () => 1000);
    const api = apiFor(document({ designs: [design()], activeId: 'flag-one', revision: 2 }));
    const hydrate = await syncFlags(store, api, 5000, 'acct-a');
    expect(hydrate.revision).toBe(2);
    expect(store.state.accountId).toBe('acct-a');

    const renamed = store.rename('flag-one', 'Renamed flag');
    expect(renamed.ok).toBe(true);
    const pushed = await pushFlags(store, api, 6000, 'acct-a', 2);

    expect(pushed.status).toBe('pushed');
    expect(pushed.revision).toBe(3);
    expect(api.remote.designs[0].name).toBe('Renamed flag');
    expect(store.state.designs[0].name).toBe('Renamed flag');
    expect(store.state.accountId).toBe('acct-a');
    expect(new FlagStore(storage, () => 7000).state.accountId).toBe('acct-a');
  });

  it('keeps a pending same-account edit across reload and updates it in place on re-login', async () => {
    const storage = new MemoryStorage();
    const store = new FlagStore(storage, () => 1000);
    const api = apiFor(document({ designs: [design()], activeId: 'flag-one', revision: 2 }));
    await syncFlags(store, api, 5000, 'acct-a');

    // The session can expire and the page can reload before the next sign-in.
    store.rename('flag-one', 'Pending rename');
    const reloaded = new FlagStore(storage, () => 2000);
    expect(reloaded.state.accountId).toBe('acct-a');
    expect(reloaded.state.revision).toBe(2);
    expect(reloaded.state.pending).toBe(true);

    const result = await syncFlags(reloaded, api, 6000, 'acct-a');
    expect(result.status).toBe('pushed');
    expect(api.remote.designs).toHaveLength(1);
    expect(api.remote.designs[0].id).toBe('flag-one');
    expect(api.remote.designs[0].name).toBe('Pending rename');
    expect(reloaded.state.designs).toHaveLength(1);
    expect(reloaded.state.pending).toBe(false);
  });

  it('rebases a pending edit over a newer account document without duplicating the design', async () => {
    const store = new FlagStore(new MemoryStorage(), () => 1000);
    const api = apiFor(document({ designs: [design()], activeId: 'flag-one', revision: 2 }));
    await syncFlags(store, api, 5000, 'acct-a');
    store.rename('flag-one', 'Pending rename');

    // Another device saved while this browser was signed out.
    api.remote = document({
      designs: [design({ name: 'Server rename' }), design({ id: 'flag-two', name: 'Other device flag' })],
      activeId: 'flag-one',
      revision: 3,
    });

    const result = await syncFlags(store, api, 6000, 'acct-a');
    expect(result.status).toBe('merged');
    expect(api.remote.designs.map((entry) => entry.name)).toEqual(['Pending rename', 'Other device flag']);
    expect(api.remote.designs).toHaveLength(2);
    expect(new Set(api.remote.designs.map((entry) => entry.id)).size).toBe(2);
  });

  it('adopts a clean same-owner document instead of importing a stale local copy', async () => {
    const store = new FlagStore(new MemoryStorage(), () => 1000);
    const api = apiFor(document({ designs: [design()], activeId: 'flag-one', revision: 2 }));
    await syncFlags(store, api, 5000, 'acct-a');

    api.remote = document({ designs: [design({ name: 'Remote edit' })], activeId: 'flag-one', revision: 3 });
    const result = await syncFlags(store, api, 6000, 'acct-a');

    expect(result.status).toBe('synced');
    expect(result.revision).toBe(3);
    expect(api.saves).toHaveLength(0);
    expect(store.state.designs).toHaveLength(1);
    expect(store.state.designs[0].name).toBe('Remote edit');
  });

  it('sends the latest state when several edits happen before one push', async () => {
    const store = new FlagStore(new MemoryStorage(), () => 1000);
    const api = apiFor(document({ designs: [design()], activeId: 'flag-one', revision: 1 }));
    await syncFlags(store, api, 5000, 'acct-a');
    store.rename('flag-one', 'First rename');
    store.create('Second design', defaultComposition());
    const active = store.designs[1].id;
    store.setActive(active);

    const pushed = await pushFlags(store, api, 6000, 'acct-a', 1);
    expect(pushed.status).toBe('pushed');
    expect(api.remote.designs.map((entry) => entry.name)).toEqual(['First rename', 'Second design']);
    expect(api.remote.activeId).toBe(active);
  });

  it('keeps local edits when the write fails and succeeds on retry', async () => {
    const store = new FlagStore(new MemoryStorage(), () => 1000);
    const api = apiFor(document({ designs: [design()], activeId: 'flag-one', revision: 1 }));
    await syncFlags(store, api, 5000, 'acct-a');
    store.rename('flag-one', 'Survives offline');
    api.failNext = true;

    const failed = await pushFlags(store, api, 6000, 'acct-a', 1);
    expect(failed.status).toBe('offline');
    expect(store.state.designs[0].name).toBe('Survives offline');
    expect(api.remote.designs[0].name).toBe('First flag');

    const retried = await pushFlags(store, api, 7000, 'acct-a', 1);
    expect(retried.status).toBe('pushed');
    expect(api.remote.designs[0].name).toBe('Survives offline');
  });

  it('rebases an edit over another device’s new design instead of overwriting it', async () => {
    const store = new FlagStore(new MemoryStorage(), () => 1000);
    const api = apiFor(document({ designs: [design()], activeId: 'flag-one', revision: 1 }));
    await syncFlags(store, api, 5000, 'acct-a');

    // Another device saves a new design before this mutation arrives.
    api.remote = document({
      designs: [design(), design({ id: 'flag-two', name: 'Other device flag' })],
      activeId: 'flag-one',
      revision: 2,
    });
    store.rename('flag-one', 'Local rename');

    const pushed = await pushFlags(store, api, 6000, 'acct-a', 1);
    expect(pushed.status).toBe('merged');
    expect(api.remote.designs.map((entry) => entry.name)).toEqual(['Local rename', 'Other device flag']);
    expect(pushed.revision).toBe(3);
  });

  it('does not send account A’s designs into account B', async () => {
    const store = new FlagStore(new MemoryStorage(), () => 1000);
    const apiA = apiFor(document({ designs: [design()], activeId: 'flag-one', revision: 1 }));
    await syncFlags(store, apiA, 5000, 'acct-a');
    store.create('Only for A', defaultComposition());
    expect(store.state.accountId).toBe('acct-a');

    const apiB = apiFor(
      document({ designs: [design({ id: 'flag-b', name: 'B flag' })], activeId: 'flag-b', revision: 7 }),
    );
    const switched = await syncFlags(store, apiB, 6000, 'acct-b');
    expect(switched.status).toBe('synced');
    expect(switched.revision).toBe(7);
    expect(store.state.accountId).toBe('acct-b');
    expect(store.state.designs.map((entry) => entry.name)).toEqual(['B flag']);
    expect(apiB.saves).toHaveLength(0);
  });

  it('refuses to push designs owned by another account', async () => {
    const store = new FlagStore(new MemoryStorage(), () => 1000);
    const api = apiFor(document({ designs: [design()], activeId: 'flag-one', revision: 1 }));
    await syncFlags(store, api, 5000, 'acct-a');
    const pushed = await pushFlags(store, api, 6000, 'acct-b', 1);
    expect(pushed.status).toBe('offline');
    expect(api.saves).toHaveLength(0);
  });

  it('never trusts guest-equipped cosmetics when merging into an account', async () => {
    const store = new FlagStore(new MemoryStorage(), () => 1000);
    const guest = store.create('Guest flag', defaultComposition()).value!;
    store.setActive(guest.id);
    expect(store.equip('frame', 'frame-steel', { xp: 0, matches: 0, wins: 0 }).ok).toBe(true);
    const api = apiFor(document({ designs: [], activeId: null, revision: 0 }));

    await syncFlags(store, api, 5000, 'acct-a');
    expect(api.remote.equipped.frame).toBeNull();
    expect(store.state.equipped.frame).toBeNull();
  });
});
