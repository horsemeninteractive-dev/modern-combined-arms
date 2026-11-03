import { afterAll, describe, expect, it } from 'vitest';
import { BUILDINGS, buildingFamily } from '../src/data/buildings';
import {
  assertSameVariantSlot,
  buildingSlotId,
  productionEntries,
  resolveRoster,
  unitSlotId,
  validateVariantChains,
} from '../src/data/roster';
import { UNITS, unitFamily } from '../src/data/units';
import { MAX_VARIANT_DEPTH, resolveVariantChain } from '../src/data/variant';
import type { BuildingDef, UnitDef } from '../src/sim/types';

/**
 * Multi-level roster variants.
 *
 * The shipped content is deliberately still one level deep, so the resolver is
 * exercised against synthetic chains: the point of this stage is that
 * "canonical slot → alliance platform → national replacement" resolves to the
 * canonical slot, and that a broken chain is rejected instead of guessed at.
 */

type Registry = Record<string, { variantOf?: string } | undefined>;

/* Synthetic definitions live in the shipped registries so the real slot
 * helpers (`unitSlotId`, `assertSameVariantSlot`) can be exercised against
 * them. They are deleted afterwards and never reach gameplay. */
const addedUnits: string[] = [];
const addedBuildings: string[] = [];

function addUnit(id: string, variantOf?: string): void {
  UNITS[id] = { id, variantOf } as unknown as UnitDef;
  addedUnits.push(id);
}

function addBuilding(id: string, variantOf?: string): void {
  BUILDINGS[id] = { id, variantOf } as unknown as BuildingDef;
  addedBuildings.push(id);
}

afterAll(() => {
  for (const id of addedUnits) delete UNITS[id];
  for (const id of addedBuildings) delete BUILDINGS[id];
});

describe('resolveVariantChain', () => {
  it('treats a canonical definition as its own slot', () => {
    const chain = resolveVariantChain({ slot: {} }, 'slot');
    expect(chain).toEqual({ root: 'slot', path: ['slot'] });
  });

  it('resolves a single-level variant to the canonical slot', () => {
    const chain = resolveVariantChain({ slot: {}, platform: { variantOf: 'slot' } }, 'platform');
    expect(chain.root).toBe('slot');
    expect(chain.path).toEqual(['platform', 'slot']);
    expect(chain.error).toBeUndefined();
  });

  it('resolves a two-level chain to the canonical slot', () => {
    const registry: Registry = {
      slot: {},
      platform: { variantOf: 'slot' },
      national: { variantOf: 'platform' },
    };
    const chain = resolveVariantChain(registry, 'national');
    expect(chain.root).toBe('slot');
    expect(chain.path).toEqual(['national', 'platform', 'slot']);
  });

  it('resolves a three-level chain to the canonical slot', () => {
    const registry: Registry = {
      slot: {},
      platform: { variantOf: 'slot' },
      subplatform: { variantOf: 'platform' },
      national: { variantOf: 'subplatform' },
    };
    expect(resolveVariantChain(registry, 'national').root).toBe('slot');
  });

  it('reports an unknown definition without inventing a slot', () => {
    const chain = resolveVariantChain({ slot: {} }, 'ghost');
    expect(chain.root).toBe('ghost');
    expect(chain.error).toMatch(/unknown definition/);
  });

  it('rejects a missing variantOf target and keeps the queried id as the root', () => {
    const chain = resolveVariantChain({ platform: { variantOf: 'ghost' } }, 'platform');
    expect(chain.root).toBe('platform');
    expect(chain.error).toMatch(/unknown definition/);
    expect(chain.error).toContain('platform → ghost');
  });

  it('rejects a self-referencing variant', () => {
    const chain = resolveVariantChain({ a: { variantOf: 'a' } }, 'a');
    expect(chain.root).toBe('a');
    expect(chain.error).toMatch(/variantOf itself/);
  });

  it('rejects a two-definition cycle', () => {
    const chain = resolveVariantChain({ a: { variantOf: 'b' }, b: { variantOf: 'a' } }, 'a');
    expect(chain.root).toBe('a');
    expect(chain.error).toMatch(/circular/);
  });

  it('rejects a longer cycle', () => {
    const registry: Registry = {
      a: { variantOf: 'b' },
      b: { variantOf: 'c' },
      c: { variantOf: 'a' },
    };
    const chain = resolveVariantChain(registry, 'a');
    expect(chain.error).toMatch(/circular/);
    expect(chain.error).toContain('a → b → c → a');
  });

  it('rejects an invalid variantOf value in the middle of a chain', () => {
    const registry = { a: { variantOf: 'b' }, b: { variantOf: 7 as unknown as string } };
    const chain = resolveVariantChain(registry, 'a');
    expect(chain.root).toBe('a');
    expect(chain.error).toMatch(/invalid variantOf/);
  });

  it('rejects a chain deeper than the defensive bound', () => {
    const registry: Registry = {};
    for (let index = 0; index <= MAX_VARIANT_DEPTH + 2; index += 1) {
      registry[`n${index}`] = { variantOf: `n${index + 1}` };
    }
    registry[`n${MAX_VARIANT_DEPTH + 3}`] = {};
    const chain = resolveVariantChain(registry, 'n0');
    expect(chain.root).toBe('n0');
    expect(chain.error).toMatch(new RegExp(`longer than ${MAX_VARIANT_DEPTH}`));
  });

  it('is deterministic for the same registry', () => {
    const registry: Registry = { slot: {}, platform: { variantOf: 'slot' } };
    expect(resolveVariantChain(registry, 'platform')).toEqual(
      resolveVariantChain(registry, 'platform'),
    );
  });
});

describe('shipped families', () => {
  it('keeps one-level variants reporting their canonical slot', () => {
    expect(resolveVariantChain(UNITS, 'pathfinder')).toEqual({
      root: 'recon',
      path: ['pathfinder', 'recon'],
    });
    expect(unitFamily('spearhead')).toBe('tank');
    expect(unitFamily('mlrs')).toBe('spg');
    expect(unitFamily('heavyHowitzer')).toBe('spg');
    expect(unitFamily('deepReconUAV')).toBe('uav');
    expect(buildingFamily('bunker')).toBe('mgNest');
  });

  it('returns the id itself for canonical and unknown definitions', () => {
    expect(unitFamily('tank')).toBe('tank');
    expect(unitFamily('not-a-unit')).toBe('not-a-unit');
    expect(buildingFamily('barracks')).toBe('barracks');
    expect(buildingFamily('not-a-building')).toBe('not-a-building');
  });

  it('validates every registered chain at load time', () => {
    expect(() => validateVariantChains()).not.toThrow();
  });
});

describe('slot resolution through alliance and national levels', () => {
  addUnit('__canonTank');
  addUnit('__platTank', '__canonTank');
  addUnit('__natTank', '__platTank');
  addBuilding('__canonNest');
  addBuilding('__platNest', '__canonNest');
  addBuilding('__natNest', '__platNest');

  it('finds an alliance platform by canonical slot', () => {
    expect(unitSlotId({ units: ['__platTank'], buildings: [] }, '__canonTank')).toBe('__platTank');
  });

  it('finds a national replacement two levels down by canonical slot', () => {
    const roster = { units: ['__natTank'], buildings: [] };
    const resolved = unitSlotId(roster, '__canonTank');
    expect(resolved).toBe('__natTank');
    expect(unitFamily(resolved!)).toBe('__canonTank');
  });

  it('prefers an exact canonical match when the slot itself is present', () => {
    expect(unitSlotId({ units: ['__canonTank'], buildings: [] }, '__canonTank')).toBe(
      '__canonTank',
    );
  });

  it('returns undefined when the roster holds no definition in the slot', () => {
    expect(unitSlotId({ units: ['rifle'], buildings: [] }, '__canonTank')).toBeUndefined();
  });

  it('resolves buildings through the same chain', () => {
    expect(buildingSlotId({ units: [], buildings: ['__natNest'] }, '__canonNest')).toBe(
      '__natNest',
    );
    expect(buildingFamily('__natNest')).toBe('__canonNest');
  });

  it('resolves shipped building substitutions in both directions', () => {
    expect(buildingSlotId(resolveRoster('hungary'), 'mgNest')).toBe('bunker');
    expect(buildingSlotId(resolveRoster('poland'), 'mgNest')).toBe('mgNest');
  });
});

describe('assertSameVariantSlot', () => {
  addUnit('__canonRecon');
  addUnit('__platRecon', '__canonRecon');
  addUnit('__natRecon', '__platRecon');
  addUnit('__bareUnit');

  it('accepts a national replacement of an alliance platform', () => {
    expect(() => assertSameVariantSlot('unit', '__platTank', '__natTank', 'test')).not.toThrow();
  });

  it('accepts a direct replacement of the canonical slot', () => {
    expect(() => assertSameVariantSlot('unit', '__canonTank', '__platTank', 'test')).not.toThrow();
  });

  it('rejects a variant that resolves to a different canonical slot', () => {
    expect(() => assertSameVariantSlot('unit', '__platTank', '__natRecon', 'test')).toThrow(
      /resolves to slot "__canonRecon", but "__platTank" occupies "__canonTank"/,
    );
  });

  it('rejects a replacement that declares no variantOf', () => {
    expect(() => assertSameVariantSlot('unit', '__platTank', '__bareUnit', 'test')).toThrow(
      /must declare variantOf/,
    );
  });

  it('rejects an unknown replacement', () => {
    expect(() => assertSameVariantSlot('unit', '__platTank', '__ghostUnit', 'test')).toThrow(
      /unknown replacement unit/,
    );
  });

  it('applies the same rule to buildings', () => {
    expect(() => assertSameVariantSlot('building', '__platNest', '__natNest', 'test')).not.toThrow();
    expect(() => assertSameVariantSlot('building', '__platNest', '__canonTank', 'test')).toThrow(
      /unknown replacement building/,
    );
  });
});

describe('shipped roster behaviour is unchanged', () => {
  it('keeps each nation on its baseline plus its single substitution', () => {
    const poland = resolveRoster('poland');
    expect(poland.units).toContain('spearhead');
    expect(poland.units).not.toContain('tank');
    expect(resolveRoster('lithuania').units).toContain('pathfinder');
    expect(resolveRoster('russia').units).toContain('heavyHowitzer');
    expect(resolveRoster('hungary').buildings).toContain('bunker');
  });

  it('keeps production entries pointing at the resolved platform', () => {
    expect(productionEntries(resolveRoster('poland'), 'factory')).toContain('spearhead');
    expect(productionEntries(resolveRoster('poland'), 'factory')).not.toContain('tank');
    expect(productionEntries(resolveRoster('uk'), 'factory')).toContain('mlrs');
    expect(productionEntries(resolveRoster('lithuania'), 'factory')).toContain('pathfinder');
  });

  it('resolves each legacy preset to its own alliance baseline', () => {
    expect(resolveRoster('baltic').units).toContain('tank');
    expect(resolveRoster('baltic').units).not.toContain('spearhead');
    // The eastern preset now fields the eastern platform for that slot.
    expect(resolveRoster('expeditionary').units).toContain('tankEC');
    expect(resolveRoster('expeditionary').units).not.toContain('tank');
    expect(resolveRoster('baltic').units).not.toEqual(resolveRoster('expeditionary').units);
  });

  it('keeps national variants out of every other nation', () => {
    expect(resolveRoster('poland').units).not.toContain('pathfinder');
    expect(resolveRoster('lithuania').units).not.toContain('spearhead');
    expect(resolveRoster('russia').units).not.toContain('mlrs');
  });
});
