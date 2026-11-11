import { describe, expect, it } from 'vitest';
import {
  CAMO_TINTS,
  COSMETICS,
  cosmeticsByCategory,
  cosmeticById,
  camoTintFor,
  isCosmeticUnlocked,
} from '../src/identity/cosmetics';
import { FlagStore, readFlagState, type FlagStorage } from '../src/identity/flagStore';
import {
  documentSubmission,
  parseFlagSubmission,
  parseFlagSyncDocument,
  stateFromDocument,
} from '../src/identity/flagSync';
import { defaultComposition } from '../src/identity/flag';
import { cosmeticsInventoryMarkup } from '../src/ui/cosmeticsInventory';
import { AccountHarness } from './accounts-harness';

const PROGRESS = {
  xp: 9_000,
  matches: 30,
  wins: 30,
  achievements: ['campaign-complete'],
};

function memoryStorage(): FlagStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function design(id = 'flag-one') {
  return { id, name: 'First flag', composition: defaultComposition(), createdAt: 10, updatedAt: 10 };
}

describe('cosmetic catalogue', () => {
  it('ships unit camos as a real category with unique ids', () => {
    const camos = cosmeticsByCategory('camo');
    expect(camos.length).toBeGreaterThanOrEqual(5);
    const ids = COSMETICS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const camo of camos) {
      expect(camo.render in CAMO_TINTS).toBe(true);
      expect(camo.version).toBe(1);
    }
  });

  it('earns every camo from play, never from a purchase', () => {
    for (const camo of cosmeticsByCategory('camo')) {
      expect(['xp', 'matches', 'wins', 'achievement']).toContain(camo.unlock.kind);
    }
  });

  it('maps camo ids to tints and refuses other categories', () => {
    expect(camoTintFor('camo-woodland')).toEqual(CAMO_TINTS.woodland);
    expect(camoTintFor('frame-brass')).toBeNull();
    expect(camoTintFor('camo-not-real')).toBeNull();
    expect(camoTintFor(null)).toBeNull();
  });

  it('keeps a camo locked until its rule is met', () => {
    const camo = cosmeticById('camo-urban');
    expect(camo).not.toBeNull();
    expect(isCosmeticUnlocked(camo!, { ...PROGRESS, matches: 19 })).toBe(false);
    expect(isCosmeticUnlocked(camo!, PROGRESS)).toBe(true);
  });
});

describe('equipping a camo', () => {
  it('stores a earned camo and survives a reload', () => {
    const storage = memoryStorage();
    const store = new FlagStore(storage, () => 1000);
    const result = store.equip('camo', 'camo-woodland', { ...PROGRESS, matches: 3, wins: 0, achievements: [] });
    expect(result.ok).toBe(true);
    expect(store.state.equipped.camo).toBe('camo-woodland');

    const reloaded = new FlagStore(storage, () => 2000);
    expect(reloaded.state.equipped.camo).toBe('camo-woodland');
    expect(readFlagState(storage).equipped.camo).toBe('camo-woodland');
  });

  it('refuses a camo the player has not earned', () => {
    const store = new FlagStore(memoryStorage(), () => 1000);
    const result = store.equip('camo', 'camo-desert', { xp: 0, matches: 0, wins: 0, achievements: [] });
    expect(result.ok).toBe(false);
    expect(store.state.equipped.camo).toBeNull();
  });

  it('removes a camo and keeps the rest of the presentation', () => {
    const store = new FlagStore(memoryStorage(), () => 1000);
    store.equip('frame', 'frame-steel', PROGRESS);
    store.equip('camo', 'camo-woodland', PROGRESS);
    expect(store.equip('camo', null, PROGRESS).ok).toBe(true);
    expect(store.state.equipped).toEqual({ frame: 'frame-steel', background: null, camo: null });
  });
});

describe('camo document validation', () => {
  it('round-trips the equipped camo through the wire document', () => {
    const document = parseFlagSyncDocument(
      { designs: [design()], activeId: 'flag-one', equipped: { camo: 'camo-woodland' }, revision: 4 },
      1000,
    );
    expect(document.equipped.camo).toBe('camo-woodland');
    expect(document.equipped.frame).toBeNull();
    const state = stateFromDocument(document, 1000, 'account-1');
    expect(state.equipped.camo).toBe('camo-woodland');
    const body = documentSubmission(state, 4);
    expect((body.equipped as { camo: string | null }).camo).toBe('camo-woodland');
  });

  it('rejects a camo the server cannot see in the ledger', () => {
    const locked = parseFlagSubmission(
      {
        designs: [design()],
        activeId: 'flag-one',
        equipped: { frame: null, background: null, camo: 'camo-night' },
        expectedRevision: 0,
      },
      { xp: 0, matches: 0, wins: 0, achievements: [] },
      1000,
    );
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.issues.join(' ')).toMatch(/unlocked/);
  });

  it('rejects an unknown camo id outright', () => {
    const parsed = parseFlagSubmission(
      {
        designs: [design()],
        activeId: 'flag-one',
        equipped: { frame: null, background: null, camo: 'camo-invisible' },
        expectedRevision: 0,
      },
      PROGRESS,
      1000,
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.join(' ')).toMatch(/Unknown cosmetic/);
  });

  it('accepts an earned camo', () => {
    const parsed = parseFlagSubmission(
      {
        designs: [design()],
        activeId: 'flag-one',
        equipped: { frame: null, background: null, camo: 'camo-woodland' },
        expectedRevision: 0,
      },
      PROGRESS,
      1000,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.submission.equipped.camo).toBe('camo-woodland');
  });
});

describe('cosmetics inventory markup', () => {
  it('renders every section with counts and the equipped state', () => {
    const markup = cosmeticsInventoryMarkup({
      progress: PROGRESS,
      equipped: { frame: 'frame-brass', background: 'bg-deep', camo: 'camo-woodland' },
      achievementNames: { 'campaign-complete': 'Campaign Service' },
    });
    expect(markup).toContain('Avatar frames');
    expect(markup).toContain('Player card backgrounds');
    expect(markup).toContain('Unit camos');
    expect(markup).toContain('Flag emblems');
    // The worn strip names what is on, including items outside the visible
    // section; the portrait itself belongs to the page head.
    expect(markup).toContain('Brass frame');
    expect(markup).toContain('Deep water');
    expect(markup).toContain('EQUIPPED');
    expect(markup).not.toContain('Player card preview');
    expect(markup).toContain('Woodland mottle');
    expect(markup).toContain('Everything here is earned by playing');
    expect(markup).not.toContain('price');
    expect(markup).not.toContain('purchase');
  });

  it('offers an equip action for an owned item and a lock for an unearned one', () => {
    const markup = cosmeticsInventoryMarkup({
      progress: { ...PROGRESS, achievements: [] },
      equipped: { frame: null, background: null, camo: null },
      achievementNames: { 'campaign-complete': 'Campaign Service' },
    });
    expect(markup).toContain('data-cosmetic-equip="background:bg-deep"');
    expect(markup).toContain('data-cosmetic-equip="camo:camo-woodland"');
    expect(markup).toContain('LOCKED');
    expect(markup).toContain('Coastal grey');
    expect(markup).toContain('Campaign Service');
  });

  it('filters to one section without dropping the summary', () => {
    const markup = cosmeticsInventoryMarkup({
      progress: PROGRESS,
      equipped: { frame: null, background: null, camo: null },
      filter: 'camo',
    });
    expect(markup).toContain('Unit camos');
    // The filter row names every category; only the section itself is filtered.
    expect(markup).not.toContain('The wash behind your name and portrait');
    expect(markup).not.toContain('data-cosmetic-equip="background:bg-deep"');
    expect(markup).toContain('cosmetics unlocked');
  });

  it('escapes a hostile award name in a lock requirement', () => {
    const markup = cosmeticsInventoryMarkup({
      progress: { ...PROGRESS, achievements: [] },
      equipped: { frame: null, background: null, camo: null },
      achievementNames: { 'campaign-complete': '<img src=x onerror=alert(1)>' },
    });
    expect(markup).not.toContain('<img src=x');
    expect(markup).toContain('&lt;img');
  });
});

describe('account camo API', () => {
  it('refuses a camo the account has not earned', async () => {
    const harness = await AccountHarness.create();
    const { cookie } = await harness.signInGoogle('camo-forged');
    const response = await harness.request('/flags', {
      method: 'POST',
      cookie: `mca_session=${cookie}`,
      body: {
        designs: [design()],
        activeId: 'flag-one',
        equipped: { frame: null, background: null, camo: 'camo-woodland' },
        expectedRevision: 0,
      },
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: { message?: string } };
    expect(payload.error?.message ?? '').toMatch(/unlocked/);
  });

  it('never echoes a camo the client did not send', async () => {
    const harness = await AccountHarness.create();
    const { cookie } = await harness.signInGoogle('camo-absent');
    const saved = await harness.request('/flags', {
      method: 'POST',
      cookie: `mca_session=${cookie}`,
      body: {
        designs: [design()],
        activeId: 'flag-one',
        equipped: { frame: 'frame-steel', background: null },
        expectedRevision: 0,
      },
    });
    expect(saved.status).toBe(200);
    const payload = (await saved.json()) as { flags?: { equipped?: { camo?: unknown } } };
    expect(payload.flags?.equipped?.camo).toBeNull();
    expect(readFlagState(memoryStorage()).equipped.camo).toBeNull();
  });
});
