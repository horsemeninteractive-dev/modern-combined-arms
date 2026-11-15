import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';
import { ALLIANCES, FACTIONS, NATION_LIST, NATIONS } from '../src/data/factions';
import {
  buildingSlotId,
  productionEntries,
  resolveRoster,
  rosterIncludes,
  unitSlotId,
} from '../src/data/roster';
import { UNITS, unitFamily } from '../src/data/units';
import { resolveVariantChain } from '../src/data/variant';
import { completeResearch } from './helpers';
import type { Scenario } from '../src/sim/scenario';

/**
 * Distinct alliance baselines.
 *
 * The two coalitions cover the same canonical slots with different equipment.
 * These tests pin that distinction, the two-level replacement chain it enables,
 * and the fact that production, AI resolution and legacy presets still answer
 * the same questions they did when both alliances shared one roster.
 */

const COMBAT_SLOTS = [
  'rifle',
  'atgm',
  'recon',
  'ifv',
  'tank',
  'td',
  'manpadsTeam',
  'ewVehicle',
  'spg',
  'rocketArtillery',
  'aa',
  'uav',
  'interceptor',
  'fighter',
  'attackHelo',
  'loiteringMunition',
  'missileBoat',
  'corvette',
  'frigate',
  'submarine',
  'navalSupport',
] as const;

const UTILITY_SLOTS = ['engineer', 'harvester', 'recovery', 'medic'] as const;

// Shared transports are not combat slots: both alliances field the same hulls
// and neither has a national replacement chain for them.
const SHARED_TRANSPORT_SLOTS = ['apc', 'transportHelo', 'landingCraft'] as const;

function arena(playerNation: string, enemyNation = 'poland'): Scenario {
  const size = 48;
  const scenario = createEmptyScenario(size, size);
  scenario.meta.id = 'alliance-baseline-test';
  scenario.settings.seed = 909;
  scenario.settings.startingMats = 6000;
  scenario.settings.startingReq = 1000;
  scenario.players[0].factionId = playerNation;
  scenario.players[0].startX = 6;
  scenario.players[0].startZ = 6;
  scenario.players[1].factionId = enemyNation;
  scenario.players[1].startX = size - 7;
  scenario.players[1].startZ = size - 7;
  scenario.players[1].isAI = false;
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 6, z: 6 },
    { defId: 'factory', owner: 0, x: 16, z: 6 },
    { defId: 'airfield', owner: 0, x: 16, z: 16 },
    { defId: 'heliport', owner: 0, x: 26, z: 16 },
    { defId: 'commandPost', owner: 1, x: size - 9, z: size - 9 },
  );
  return scenario;
}

function withFacilities(nation: string): Game {
  const game = new Game(arena(nation), { enableAI: false });
  game.player(0)!.mats = 10000;
  game.player(0)!.req = 4000;
  // Platform resolution is the subject here; the research gate is measured in
  // the research suites.
  completeResearch(game, 0);
  return game;
}

describe('alliance baselines', () => {
  it('fields distinct equipment in all 21 combat slots, shares the 4 utility roles and all transports', () => {
    const defender = ALLIANCES.defender.baseline.units;
    const eastern = ALLIANCES.eastern.baseline.units;
    expect(defender.length).toBe(28);
    expect(eastern.length).toBe(28);

    for (const slot of COMBAT_SLOTS) {
      expect(unitSlotId(ALLIANCES.defender.baseline, slot)).toBeTruthy();
      expect(unitSlotId(ALLIANCES.eastern.baseline, slot)).toBeTruthy();
      expect(unitSlotId(ALLIANCES.defender.baseline, slot)).not.toBe(
        unitSlotId(ALLIANCES.eastern.baseline, slot),
      );
    }
    for (const slot of UTILITY_SLOTS) {
      expect(unitSlotId(ALLIANCES.defender.baseline, slot)).toBe(slot);
      expect(unitSlotId(ALLIANCES.eastern.baseline, slot)).toBe(slot);
    }
    for (const slot of SHARED_TRANSPORT_SLOTS) {
      expect(defender).toContain(slot);
      expect(eastern).toContain(slot);
      expect(unitFamily(slot)).toBe(slot);
      expect(UNITS[slot].transport?.capacity).toBe(4);
    }
  });

  it('keeps structures common and every slot pointing at one definition', () => {
    expect([...ALLIANCES.eastern.baseline.buildings]).toEqual([
      ...ALLIANCES.defender.baseline.buildings,
    ]);
    for (const roster of [ALLIANCES.defender.baseline, ALLIANCES.eastern.baseline]) {
      const slots = roster.units.map((id) => unitFamily(id));
      expect(new Set(slots).size).toBe(slots.length);
      expect(slots.sort()).toEqual([...COMBAT_SLOTS, ...UTILITY_SLOTS, ...SHARED_TRANSPORT_SLOTS].sort());
    }
  });

  it('registers every alliance platform as a variant of its canonical slot', () => {
    for (const roster of [ALLIANCES.defender.baseline, ALLIANCES.eastern.baseline]) {
      for (const id of roster.units) {
        const def = UNITS[id];
        expect(def, `${id} is registered`).toBeDefined();
        if (COMBAT_SLOTS.includes(unitFamily(id) as (typeof COMBAT_SLOTS)[number])) {
          const chain = resolveVariantChain(UNITS, id);
          expect(chain.error).toBeUndefined();
          expect(chain.root).toBe(unitFamily(id));
          expect(chain.path.at(-1)).toBe(unitFamily(id));
          expect(chain.path.length).toBeGreaterThanOrEqual(1);
          expect(chain.path.length).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('gives both alliances a working production route for every slot', () => {
    const facilities = new Set<string>();
    for (const building of Object.values(BUILDINGS)) {
      if (building.productionList) facilities.add(building.id);
    }
    for (const roster of [ALLIANCES.defender.baseline, ALLIANCES.eastern.baseline]) {
      for (const id of roster.units) {
        expect(UNITS[id].producedBy.length, `${id} has a facility`).toBeGreaterThan(0);
        for (const facility of UNITS[id].producedBy) {
          expect(facilities.has(facility), `${id} → ${facility}`).toBe(true);
        }
      }
    }
  });
});

describe('national replacements through an alliance platform', () => {
  it('resolves the eastern artillery chain slot → platform → replacement', () => {
    const roster = resolveRoster('russia');
    expect(roster.units).toContain('heavyHowitzer');
    expect(roster.units).not.toContain('spgEC');
    expect(unitSlotId(roster, 'spg')).toBe('heavyHowitzer');
    expect(resolveVariantChain(UNITS, 'heavyHowitzer').path).toEqual([
      'heavyHowitzer',
      'spgEC',
      'spg',
    ]);
  });

  it('resolves the eastern drone chain the same way', () => {
    const roster = resolveRoster('belarus');
    expect(unitSlotId(roster, 'uav')).toBe('deepReconUAV');
    expect(resolveVariantChain(UNITS, 'deepReconUAV').path).toEqual([
      'deepReconUAV',
      'uavEC',
      'uav',
    ]);
  });

  it('leaves the coalition one-hop replacements working', () => {
    expect(unitSlotId(resolveRoster('poland'), 'tank')).toBe('spearhead');
    expect(unitSlotId(resolveRoster('lithuania'), 'recon')).toBe('pathfinder');
    expect(unitSlotId(resolveRoster('uk'), 'spg')).toBe('mlrs');
    expect(buildingSlotId(resolveRoster('hungary'), 'mgNest')).toBe('bunker');
  });

  it('keeps every national variant inside its own nation', () => {
    const national = ['pathfinder', 'spearhead', 'mlrs', 'heavyHowitzer', 'deepReconUAV'];
    for (const id of national) {
      const owners = NATION_LIST.filter((nation) => resolveRoster(nation.id).units.includes(id));
      expect(owners).toHaveLength(1);
    }
    const bunkerOwners = NATION_LIST.filter((nation) =>
      resolveRoster(nation.id).buildings.includes('bunker'),
    );
    expect(bunkerOwners.map((nation) => nation.id)).toEqual(['hungary']);
  });

  it('never leaks one alliance platform into the other roster', () => {
    for (const nation of NATION_LIST) {
      const roster = resolveRoster(nation.id);
      const other = ALLIANCES[nation.allianceId === 'defender' ? 'eastern' : 'defender'];
      for (const id of other.baseline.units) {
        if (ALLIANCES.defender.baseline.units.includes(id)) continue; // shared utility
        expect(roster.units, `${nation.id} must not field ${id}`).not.toContain(id);
      }
    }
  });

  it('resolves every nation through the baseline of its own alliance', () => {
    for (const nation of NATION_LIST) {
      const roster = resolveRoster(nation.id);
      const baseline = ALLIANCES[nation.allianceId].baseline;
      // A nation is its alliance baseline plus its exclusive unit; a
      // replacement swaps in place and does not change the count. Sweden and
      // Iran also field a national naval hull, recorded in their `addUnits`.
      const hulls = (NATIONS[nation.id].roster?.addUnits ?? []).filter(
        (id) => UNITS[id]?.domain === 'naval',
      ).length;
      expect(roster.units.length).toBe(baseline.units.length + 1 + hulls);
      const families = roster.units.map((id) => unitFamily(id));
      expect(new Set(families).size).toBe(families.length);
    }
  });

  it('keeps both legacy presets resolvable and distinct', () => {
    for (const preset of Object.values(FACTIONS)) {
      const roster = resolveRoster(preset.id);
      expect(roster.units).toEqual(ALLIANCES[preset.allianceId].baseline.units);
    }
    expect(resolveRoster('baltic').units).not.toEqual(resolveRoster('expeditionary').units);
  });
});

describe('production and AI resolution', () => {
  it('produces the coalition platform for a coalition nation', () => {
    const game = withFacilities('poland');
    const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
    for (const slot of ['tank', 'ifv', 'td', 'spg', 'rocketArtillery'] as const) {
      const actual = game.unitIdFor(0, slot)!;
      expect(actual).toBeTruthy();
      expect(game.productionStatus(0, factory.id, actual).ok, `${slot} → ${actual}`).toBe(true);
    }
    // Rotary aviation is a heliport product: the airfield's pad recovers a
    // damaged gunship but cannot build one.
    const airfield = game.entitiesOf(0, 'building').find((e) => e.defId === 'airfield')!;
    const heliport = game.entitiesOf(0, 'building').find((e) => e.defId === 'heliport')!;
    const helo = game.unitIdFor(0, 'attackHelo')!;
    expect(game.productionStatus(0, heliport.id, helo).ok).toBe(true);
    expect(game.productionStatus(0, airfield.id, helo).ok).toBe(false);
  });

  it('produces the eastern platform for an eastern nation', () => {
    const game = withFacilities('russia');
    const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
    expect(game.unitIdFor(0, 'tank')).toBe('tankEC');
    expect(game.unitIdFor(0, 'ifv')).toBe('ifvEC');
    // Russia's national replacement is two levels down its own chain.
    expect(game.unitIdFor(0, 'spg')).toBe('heavyHowitzer');
    for (const id of ['tankEC', 'ifvEC', 'heavyHowitzer', 'rocketArtilleryEC']) {
      expect(game.productionStatus(0, factory.id, id).ok, id).toBe(true);
    }
  });

  it('refuses the other alliance platform even through a direct command', () => {
    const game = withFacilities('russia');
    expect(game.canProduce(0, 'tank')).toBe(false);
    expect(game.canProduce(0, 'tankEC')).toBe(true);
    expect(rosterIncludes(resolveRoster('russia'), 'unit', 'tank')).toBe(false);
    expect(rosterIncludes(resolveRoster('russia'), 'unit', 'tankEC')).toBe(true);
  });

  it('lists the resolved platform on the production cards', () => {
    const poland = resolveRoster('poland');
    const russia = resolveRoster('russia');
    const polishFactory = productionEntries(poland, 'factory');
    const russianFactory = productionEntries(russia, 'factory');
    expect(polishFactory).toContain('spearhead');
    expect(polishFactory).not.toContain('tank');
    expect(polishFactory).toContain('ifv');
    expect(polishFactory).toContain('rocketArtillery');
    expect(russianFactory).toContain('tankEC');
    expect(russianFactory).toContain('heavyHowitzer');
    expect(russianFactory).not.toContain('tank');
    expect(productionEntries(russia, 'heliport')).toContain('attackHeloEC');
    expect(productionEntries(poland, 'heliport')).toContain('attackHelo');
    expect(productionEntries(russia, 'heliport')).toContain('transportHelo');
    expect(productionEntries(poland, 'heliport')).toContain('transportHelo');
    expect(productionEntries(russia, 'airfield')).not.toContain('attackHeloEC');
    expect(productionEntries(russia, 'airfield')).not.toContain('transportHelo');
  });

  it('marks only nation-specific definitions as national', () => {
    for (const nation of NATION_LIST) {
      const roster = resolveRoster(nation.id);
      for (const id of roster.units) {
        const def = UNITS[id];
        const isBaselinePlatform = ALLIANCES[nation.allianceId].baseline.units.includes(id);
        expect(!!def.national, `${nation.id} ${id}`).toBe(!isBaselinePlatform);
      }
    }
    expect(NATIONS.poland.name).toBe('Poland');
  });
});
