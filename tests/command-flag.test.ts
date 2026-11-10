import { describe, expect, it } from 'vitest';
import {
  FLAG_EMBLEM_IDS,
  FLAG_FORMAT,
  MAX_FLAG_BYTES,
  MAX_FLAG_DECORATIONS,
  MAX_FLAG_DESIGNS,
  cloneComposition,
  compositionBytes,
  compositionEqual,
  defaultComposition,
  parseFlagComposition,
  type FlagComposition,
} from '../src/identity/flag';
import {
  FlagStore,
  emptyFlagState,
  mergeGuestFlags,
  readFlagState,
  type FlagStorage,
} from '../src/identity/flagStore';
import { History } from '../src/identity/history';
import {
  EMPTY_PROGRESS,
  PROFILE_BACKGROUNDS,
  PROFILE_FRAMES,
  cosmeticById,
  cosmeticsByCategory,
  isCosmeticUnlocked,
  unlockedEmblemIds,
  validateEquip,
} from '../src/identity/cosmetics';
import { commandFlagSvg } from '../src/ui/commandFlag';

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

function compositionWith(patch: Record<string, unknown>): FlagComposition {
  return { ...(defaultComposition() as unknown as Record<string, unknown>), ...patch } as unknown as FlagComposition;
}

describe('flag composition schema', () => {
  it('accepts its own default and round-trips it unchanged', () => {
    const parsed = parseFlagComposition(defaultComposition());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(compositionEqual(parsed.composition, defaultComposition())).toBe(true);
    expect(parsed.composition.format).toBe(FLAG_FORMAT);
    expect(compositionBytes(parsed.composition)).toBeLessThan(MAX_FLAG_BYTES);
  });

  it('rejects an unknown emblem instead of substituting one', () => {
    const parsed = parseFlagComposition(
      compositionWith({ emblem: { id: 'skull-and-crossbones', color: 'bone' } }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.some((issue) => issue.path === 'emblem.id')).toBe(true);
  });

  it('rejects colours outside the curated palette', () => {
    const parsed = parseFlagComposition(compositionWith({ background: { kind: 'solid', primary: '#ff00ff' } }));
    expect(parsed.ok).toBe(false);
  });

  it('clamps numeric extremes and caps ornaments', () => {
    const parsed = parseFlagComposition(
      compositionWith({
        emblem: { id: 'star', color: 'bone', scale: 99, x: 500, y: -500, rotate: 45 },
        decorations: Array.from({ length: 6 }, () => ({ id: 'dot', color: 'gold', scale: 99, x: 999 })),
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.composition.emblem?.scale).toBe(1.8);
    expect(parsed.composition.emblem?.x).toBe(30);
    expect(parsed.composition.emblem?.y).toBe(-20);
    expect(parsed.composition.emblem?.rotate).toBe(0);
    expect(parsed.composition.decorations).toHaveLength(MAX_FLAG_DECORATIONS);
    expect(parsed.composition.decorations[0].scale).toBe(1.6);
  });

  it('refuses a document from a different format', () => {
    const parsed = parseFlagComposition({ ...defaultComposition(), format: 'something-else' });
    expect(parsed.ok).toBe(false);
  });
});

describe('command flag renderer', () => {
  it('renders the palette colour, emblem and border of a design', () => {
    const svg = commandFlagSvg(defaultComposition(), { size: 300, title: 'Command flag' });
    expect(svg).toContain('fill="#16324a"');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('<title>Command flag</title>');
    expect(svg).toContain('viewBox="0 0 300 200"');
  });

  it('is deterministic for the same composition', () => {
    const composition = cloneComposition(defaultComposition());
    expect(commandFlagSvg(composition)).toBe(commandFlagSvg(composition));
  });

  it('renders a gradient when the background asks for one', () => {
    const composition = cloneComposition(defaultComposition());
    composition.background = { kind: 'gradient', primary: 'navy', secondary: 'gold' };
    const svg = commandFlagSvg(composition);
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('stop-color="rgb(22,50,74)"');
    expect(svg).toContain('stop-color="rgb(201,163,95)"');
  });

  it('never emits unescaped markup from the accessible title', () => {
    const svg = commandFlagSvg(defaultComposition(), { title: '<script>alert(1)</script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

describe('undo history', () => {
  it('undoes, redoes and drops the redo branch on a new edit', () => {
    const history = new History<number>(3);
    let current = 1;
    history.push(current);
    current = 2;
    history.push(current);
    current = 3;

    expect(history.undo(current)).toBe(2);
    expect(history.undo(2)).toBe(1);
    expect(history.canUndo).toBe(false);
    expect(history.redo(1)).toBe(2);
    expect(history.canRedo).toBe(true);

    history.push(2);
    expect(history.canRedo).toBe(false);
  });

  it('keeps only the most recent steps up to its limit', () => {
    const history = new History<number>(2);
    history.push(1);
    history.push(2);
    history.push(3);
    expect(history.depth).toBe(2);
    expect(history.undo(3)).toBe(3);
    expect(history.undo(3)).toBe(2);
    expect(history.canUndo).toBe(false);
  });
});

describe('flag store', () => {
  it('saves, renames, duplicates, activates and deletes designs', () => {
    const storage = new MemoryStorage();
    const store = new FlagStore(storage, () => 1000);
    const created = store.create('  First flag  ', defaultComposition());
    expect(created.ok).toBe(true);
    const design = created.value!;
    expect(design.name).toBe('First flag');

    expect(store.setActive(design.id).ok).toBe(true);
    expect(store.activeDesign()?.id).toBe(design.id);

    const renamed = store.rename(design.id, 'Renamed');
    expect(renamed.value?.name).toBe('Renamed');

    const copy = store.duplicate(design.id);
    expect(copy.ok).toBe(true);
    expect(copy.value?.id).not.toBe(design.id);
    expect(copy.value?.name).toBe('Renamed copy');

    // Reloading from the same storage returns the saved document.
    const reloaded = new FlagStore(storage, () => 2000);
    expect(reloaded.designs).toHaveLength(2);
    expect(reloaded.state.activeId).toBe(design.id);

    expect(store.remove(design.id).ok).toBe(true);
    expect(store.activeDesign()).toBeNull();
    expect(store.designs).toHaveLength(1);
  });

  it('enforces the saved-design limit and keeps names short', () => {
    const storage = new MemoryStorage();
    const store = new FlagStore(storage, () => 1000);
    for (let i = 0; i < MAX_FLAG_DESIGNS; i++) {
      expect(store.create(`Flag ${i}`, defaultComposition()).ok).toBe(true);
    }
    const overflow = store.create('One too many', defaultComposition());
    expect(overflow.ok).toBe(false);
    expect(store.designs).toHaveLength(MAX_FLAG_DESIGNS);

    const longName = store.create('x'.repeat(80), defaultComposition());
    expect(longName.ok).toBe(false);
    const trimmed = store.rename(store.designs[0].id, 'y'.repeat(80));
    expect(trimmed.value?.name.length).toBeLessThanOrEqual(28);
  });

  it('survives corrupt storage instead of throwing', () => {
    const storage = new MemoryStorage();
    storage.map.set('mca.command-flags.v1', '{not json');
    const store = new FlagStore(storage, () => 1);
    expect(store.designs).toEqual([]);
    expect(store.state.activeId).toBeNull();
  });

  it('rejects an unknown cosmetic and accepts an unlocked one', () => {
    const store = new FlagStore(new MemoryStorage(), () => 1);
    expect(store.equip('frame', 'not-a-frame', EMPTY_PROGRESS).ok).toBe(false);
    expect(store.equip('frame', 'frame-brass', EMPTY_PROGRESS).ok).toBe(false);
    expect(store.equip('frame', 'frame-steel', EMPTY_PROGRESS).ok).toBe(true);
    expect(store.state.equipped.frame).toBe('frame-steel');
    expect(store.equip('frame', null, EMPTY_PROGRESS).ok).toBe(true);
    expect(store.state.equipped.frame).toBeNull();
  });
});

describe('guest to account merge', () => {
  it('keeps the account active design and imports distinct guest designs once', () => {
    const storage = new MemoryStorage();
    const account = new FlagStore(storage, () => 1000);
    const accountDesign = account.create('Account flag', defaultComposition()).value!;
    account.setActive(accountDesign.id);

    const guestState = emptyFlagState(1);
    const guestComposition = cloneComposition(defaultComposition());
    guestComposition.background.primary = 'crimson';
    guestState.designs = [
      {
        id: 'guest-a',
        name: 'Guest flag',
        composition: guestComposition,
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: 1,
      },
      // Identical to the account design: it must not be duplicated.
      {
        id: 'guest-b',
        name: 'Same as account',
        composition: cloneComposition(defaultComposition()),
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: 1,
      },
    ];
    guestState.activeId = 'guest-a';

    const merged = mergeGuestFlags(account.state, guestState, 5000);
    expect(merged.imported).toBe(1);
    expect(merged.skipped).toBe(1);
    expect(merged.state.activeId).toBe(accountDesign.id);
    expect(merged.state.designs.map((entry) => entry.name)).toEqual(['Account flag', 'Guest flag']);

    const second = mergeGuestFlags(merged.state, guestState, 6000);
    expect(second.imported).toBe(0);
    expect(second.state.designs).toHaveLength(2);
  });

  it('adopts the guest design when the account had no active flag', () => {
    const guestState = emptyFlagState(1);
    guestState.designs = [
      {
        id: 'guest-a',
        name: 'Guest flag',
        composition: defaultComposition(),
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: 1,
      },
    ];
    guestState.activeId = 'guest-a';
    const merged = mergeGuestFlags(emptyFlagState(1), guestState, 5000);
    expect(merged.state.activeId).not.toBeNull();
    expect(merged.state.activeId).not.toBe('guest-a');
    expect(merged.state.designs).toHaveLength(1);
  });
});

describe('cosmetic catalogue', () => {
  it('gives every renderable emblem an explicit catalogue definition', () => {
    const emblems = cosmeticsByCategory('emblem');
    expect(new Set(emblems.map((item) => item.render))).toEqual(new Set(FLAG_EMBLEM_IDS));
    for (const emblem of FLAG_EMBLEM_IDS) {
      const item = emblems.find((entry) => entry.render === emblem);
      expect(item, emblem).toBeDefined();
      expect(item!.unlock.kind, emblem).toMatch(/^(free|xp|matches|wins)$/);
    }
    // The eagle used to have no catalogue entry and was silently free by
    // omission. It must be free because the catalogue says so.
    expect(unlockedEmblemIds(EMPTY_PROGRESS)).toContain('eagle');
  });

  it('keeps frame and background cosmetics in step with their renderers', () => {
    for (const frame of cosmeticsByCategory('frame')) {
      expect(PROFILE_FRAMES).toContain(frame.render);
    }
    for (const background of cosmeticsByCategory('background')) {
      expect(PROFILE_BACKGROUNDS).toContain(background.render);
    }
    expect(new Set(cosmeticsByCategory('frame').map((item) => item.render)).size).toBe(
      PROFILE_FRAMES.length,
    );
    expect(new Set(cosmeticsByCategory('background').map((item) => item.render)).size).toBe(
      PROFILE_BACKGROUNDS.length,
    );
  });

  it('has unique ids and only renderable categories', () => {
    const ids = new Set<string>();
    for (const item of cosmeticsByCategory('emblem')) {
      expect(item.category).toBe('emblem');
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
    }
    expect(cosmeticById('emblem-star')?.name).toBe('Star');
  });

  it('derives ownership from career progress', () => {
    const bolt = cosmeticById('emblem-bolt')!;
    expect(isCosmeticUnlocked(bolt, EMPTY_PROGRESS)).toBe(false);
    expect(isCosmeticUnlocked(bolt, { xp: 1500, matches: 0, wins: 0 })).toBe(true);

    const crown = cosmeticById('emblem-crown')!;
    expect(isCosmeticUnlocked(crown, { xp: 0, matches: 99, wins: 24 })).toBe(false);
    expect(isCosmeticUnlocked(crown, { xp: 0, matches: 99, wins: 25 })).toBe(true);

    const compass = cosmeticById('emblem-compass')!;
    expect(isCosmeticUnlocked(compass, { xp: 9999, matches: 9, wins: 99 })).toBe(false);
    expect(isCosmeticUnlocked(compass, { xp: 0, matches: 10, wins: 0 })).toBe(true);
  });

  it('offers only unlocked emblems to the editor', () => {
    expect(unlockedEmblemIds(EMPTY_PROGRESS)).toContain('star');
    expect(unlockedEmblemIds(EMPTY_PROGRESS)).not.toContain('laurel');
    expect(unlockedEmblemIds({ xp: 6000, matches: 0, wins: 0 })).toContain('laurel');
  });

  it('rejects an equip request for the wrong slot or an unearned item', () => {
    expect(validateEquip('frame', 'emblem-star', EMPTY_PROGRESS)).toBeTruthy();
    expect(validateEquip('frame', 'frame-brass', EMPTY_PROGRESS)).toMatch(/unlocked/);
    expect(validateEquip('frame', 'frame-steel', EMPTY_PROGRESS)).toBeNull();
    expect(validateEquip('frame', null, EMPTY_PROGRESS)).toBeNull();
  });
});

describe('flag fallback', () => {
  it('re-reads a stored document and drops unreadable designs', () => {
    const storage = new MemoryStorage();
    storage.map.set(
      'mca.command-flags.v1',
      JSON.stringify({
        version: 1,
        designs: [
          { id: 'good', name: 'Good', composition: defaultComposition(), createdAt: 1, updatedAt: 1 },
          { id: 'bad', name: 'Bad', composition: { version: 1 }, createdAt: 1, updatedAt: 1 },
        ],
        activeId: 'bad',
        equipped: { frame: null, background: null },
        updatedAt: 1,
      }),
    );
    const state = readFlagState(storage);
    expect(state.designs.map((design) => design.id)).toEqual(['good']);
    expect(state.activeId).toBeNull();
  });
});
