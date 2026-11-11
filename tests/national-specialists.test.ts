/**
 * Ten-nation specialist assessment (source-audited portion).
 *
 * The prose assessment lives with the phase report; this file holds the parts a
 * machine can settle: that every national replacement resolves to a canonical
 * slot, that every exclusive is registered but absent from the shared baseline,
 * and that each replacement actually differs from the platform it replaces
 * rather than being a rename.
 */
import { describe, expect, it } from 'vitest';
import {
  UNITS,
  UNIT_LIST,
  NATIONAL_UNIT_LIST,
  unitFamily,
} from '../src/data/units';
import { BUILDINGS, BUILDING_LIST, buildingFamily } from '../src/data/buildings';
import { WEAPONS } from '../src/data/weapons';
import type { UnitDef } from '../src/sim/types';

/** Every registered structure that declares itself national. */
const nationalBuildingList = Object.values(BUILDINGS).filter((b) => b.national);

function differsFrom(a: UnitDef, b: UnitDef): string[] {
  const axes: string[] = [];
  if (a.cost.mats !== b.cost.mats) axes.push('cost');
  if ((a.cost.req ?? 0) !== (b.cost.req ?? 0)) axes.push('requisition');
  if (a.hp !== b.hp) axes.push('health');
  if (a.speed !== b.speed) axes.push('speed');
  if (a.vision !== b.vision) axes.push('vision');
  if (a.armour !== b.armour) axes.push('armour');
  if (JSON.stringify(a.weapons) !== JSON.stringify(b.weapons)) axes.push('weapons');
  if (a.buildTime !== b.buildTime) axes.push('build time');
  return axes;
}

describe('national roster integrity', () => {
  it('registers every national replacement against a shared baseline slot', () => {
    const replacements = NATIONAL_UNIT_LIST.filter((u) => u.variantOf);
    const exclusives = NATIONAL_UNIT_LIST.filter((u) => !u.variantOf);
    console.log('[nation-counts]', JSON.stringify({
      roster: UNIT_LIST.length,
      registered: Object.keys(UNITS).length,
      national: NATIONAL_UNIT_LIST.length,
      replacements: replacements.length,
      exclusives: exclusives.length,
      baselineBuildings: BUILDING_LIST.length,
      registeredBuildings: Object.keys(BUILDINGS).length,
      nationalBuildings: nationalBuildingList.length,
      nationalBuildingsExpected: Object.values(BUILDINGS).filter((b) => b.national && b.variantOf).length,
    }));
    expect(replacements.length).toBeGreaterThan(0);
    expect(exclusives.length).toBeGreaterThan(0);
    for (const unit of replacements) {
      const slot = unitFamily(unit.id);
      expect(UNIT_LIST.some((b) => b.id === slot), `${unit.id} -> ${slot}`).toBe(true);
      expect(unit.national, `${unit.id} must be marked national`).toBe(true);
    }
    for (const unit of exclusives) {
      expect(unit.national, `${unit.id} must be marked national`).toBe(true);
      // An exclusive is an extra option, never a baseline entry.
      expect(UNIT_LIST.some((b) => b.id === unit.id)).toBe(false);
    }
  });

  it('makes every replacement materially different from the platform it replaces', () => {
    const rows: Array<{ id: string; slot: string; axes: string[] }> = [];
    for (const unit of NATIONAL_UNIT_LIST.filter((u) => u.variantOf)) {
      const base = UNITS[unitFamily(unit.id)];
      const axes = differsFrom(unit, base);
      rows.push({ id: unit.id, slot: base.id, axes });
    }
    for (const row of rows) console.log('[nation-replacement]', JSON.stringify(row));
    for (const row of rows) {
      expect(row.axes.length, `${row.id} is a rename of ${row.slot}`).toBeGreaterThan(0);
    }
  });

  it('resolves every national structure to a shared baseline slot', () => {
    for (const building of nationalBuildingList) {
      const slot = buildingFamily(building.id);
      expect(BUILDING_LIST.some((b) => b.id === slot), `${building.id} -> ${slot}`).toBe(true);
      expect(building.national).toBe(true);
      const base = BUILDINGS[slot];
      const axes = [
        base.cost.mats !== building.cost.mats ? 'cost' : null,
        base.hp !== building.hp ? 'health' : null,
        base.vision !== building.vision ? 'vision' : null,
        JSON.stringify(base.weapons ?? []) !== JSON.stringify(building.weapons ?? []) ? 'weapons' : null,
        base.buildTime !== building.buildTime ? 'build time' : null,
        (base.researchSpeed ?? 1) !== (building.researchSpeed ?? 1) ? 'research' : null,
      ].filter(Boolean);
      console.log('[nation-building]', JSON.stringify({ id: building.id, slot, axes }));
      expect(axes.length, `${building.id} is a rename of ${slot}`).toBeGreaterThan(0);
    }
  });

  it('keeps every national weapon inside an existing mechanical family', () => {
    // A national weapon must be a trade on a shared mechanic, not a new system:
    // every one of them names a projectile the engine already resolves.
    const known = new Set(['bullet', 'shell', 'missile', 'sam', 'torpedo']);
    for (const unit of NATIONAL_UNIT_LIST) {
      for (const weaponId of unit.weapons) {
        expect(known.has(WEAPONS[weaponId].projectile), `${weaponId}`).toBe(true);
      }
    }
  });
});
