import { describe, expect, it } from 'vitest';
import {
  ALLIANCES,
  ALLIANCE_LIST,
  FACTIONS,
  NATION_LIST,
  allianceDef,
  factionDef,
  isKnownFactionId,
  nationDef,
} from '../src/data/factions';
import { mergeRoster, resolveRoster, validateRosterRegistry } from '../src/data/roster';
import { BUILDINGS, BUILDING_LIST } from '../src/data/buildings';
import { UNITS, UNIT_LIST, unitFamily } from '../src/data/units';
import { createIslandAssault } from '../src/data/scenarios';
import { parseScenario, type Scenario } from '../src/sim/scenario';
import { Game } from '../src/sim/game';
import type { NationRosterModifications } from '../src/sim/types';

const EXPECTED_NATIONS = [
  ['lithuania', 'defender'],
  ['poland', 'defender'],
  ['uk', 'defender'],
  ['finland', 'defender'],
  ['sweden', 'defender'],
  ['russia', 'eastern'],
  ['belarus', 'eastern'],
  ['hungary', 'eastern'],
  ['iran', 'eastern'],
  ['northKorea', 'eastern'],
] as const;

function nationScenario(): Scenario {
  const scenario = createIslandAssault();
  scenario.players[0].factionId = 'lithuania';
  scenario.players[1].factionId = 'russia';
  return scenario;
}

describe('faction content registry', () => {
  it('defines the ten playable nations with one alliance each', () => {
    expect(NATION_LIST.map((nation) => nation.id)).toEqual(
      EXPECTED_NATIONS.map(([id]) => id),
    );
    for (const [id, allianceId] of EXPECTED_NATIONS) {
      expect(nationDef(id).allianceId).toBe(allianceId);
      expect(nationDef(id).name.length).toBeGreaterThan(0);
      expect(nationDef(id).shortName.length).toBeGreaterThan(0);
    }
  });

  it('defines two launch alliances over the same slots with distinct equipment', () => {
    expect(ALLIANCE_LIST.map((alliance) => alliance.id)).toEqual(['defender', 'eastern']);
    const expectedBuildings = BUILDING_LIST.map((building) => building.id);
    // The coalition fields the canonical lineage, so its baseline is the
    // canonical unit list itself.
    expect([...ALLIANCES.defender.baseline.units]).toEqual(UNIT_LIST.map((unit) => unit.id));
    // The eastern baseline covers the same slots in the same order.
    expect(ALLIANCES.eastern.baseline.units.length).toBe(ALLIANCES.defender.baseline.units.length);
    for (const alliance of ALLIANCE_LIST) {
      expect([...alliance.baseline.buildings]).toEqual(expectedBuildings);
    }
    const shared = ALLIANCES.defender.baseline.units.filter(
      (id, index) => id === ALLIANCES.eastern.baseline.units[index],
    );
    const distinct = ALLIANCES.defender.baseline.units.filter(
      (id, index) => id !== ALLIANCES.eastern.baseline.units[index],
    );
    // The four utility roles, the APC and the shared transport helicopter are
    // common equipment; every combat slot differs.
    expect(shared.sort()).toEqual([
      'apc',
      'engineer',
      'harvester',
      'landingCraft',
      'medic',
      'recovery',
      'transportHelo',
    ]);
    expect(distinct.length).toBe(21);
    // Neither alliance may borrow the other's platform, and both resolve each
    // slot on the same canonical root.
    for (let index = 0; index < ALLIANCES.defender.baseline.units.length; index += 1) {
      const defender = ALLIANCES.defender.baseline.units[index];
      const eastern = ALLIANCES.eastern.baseline.units[index];
      expect(unitFamily(defender)).toBe(unitFamily(eastern));
      if (defender !== eastern) {
        expect(ALLIANCES.eastern.baseline.units).not.toContain(defender);
        expect(ALLIANCES.defender.baseline.units).not.toContain(eastern);
      }
    }
  });

  it('keeps both legacy presets resolvable and tied to their alliance', () => {
    expect(Object.keys(FACTIONS).sort()).toEqual(['baltic', 'expeditionary']);
    const baltic = factionDef('baltic');
    const expeditionary = factionDef('expeditionary');
    expect(baltic.allianceId).toBe('defender');
    expect(expeditionary.allianceId).toBe('eastern');
    expect(baltic.units).toBe(ALLIANCES.defender.baseline.units);
    expect(expeditionary.units).toBe(ALLIANCES.eastern.baseline.units);
    expect(factionDef('missing')).toBe(FACTIONS.baltic);
  });

  it('accepts legacy presets and nations as faction ids, but not alliances', () => {
    for (const [id] of EXPECTED_NATIONS) expect(isKnownFactionId(id)).toBe(true);
    expect(isKnownFactionId('baltic')).toBe(true);
    expect(isKnownFactionId('expeditionary')).toBe(true);
    expect(isKnownFactionId('defender')).toBe(false);
    expect(isKnownFactionId('eastern')).toBe(false);
    expect(isKnownFactionId('atlantis')).toBe(false);
    // Prototype keys must not leak through `in` checks.
    expect(isKnownFactionId('toString')).toBe(false);
    expect(isKnownFactionId('constructor')).toBe(false);
  });

  it('passes its own integrity check and keeps the canonical baseline frozen', () => {
    expect(() => validateRosterRegistry()).not.toThrow();
    expect(Object.isFrozen(ALLIANCES.defender.baseline)).toBe(true);
    expect(Object.isFrozen(ALLIANCES.defender.baseline.units)).toBe(true);
    expect(Object.isFrozen(ALLIANCES.eastern.baseline.buildings)).toBe(true);
  });
});

describe('roster resolution', () => {
  it('resolves every nation to its alliance baseline plus its declared specialisation', () => {
    for (const nation of NATION_LIST) {
      const baseUnits = ALLIANCES[nation.allianceId].baseline.units;
      const baseBuildings = ALLIANCES[nation.allianceId].baseline.buildings;
      const roster = resolveRoster(nation.id);
      const replacedUnits = nation.roster?.replaceUnits ?? {};
      const replacedBuildings = nation.roster?.replaceBuildings ?? {};

      // Every baseline entry is retained unless the nation explicitly swapped
      // that slot; the substitute takes its place rather than appending.
      for (const id of baseUnits) {
        const expected = replacedUnits[id] ?? id;
        if (replacedUnits[id]) expect(roster.units).not.toContain(id);
        expect(roster.units).toContain(expected);
      }
      for (const id of baseBuildings) {
        const expected = replacedBuildings[id] ?? id;
        if (replacedBuildings[id]) expect(roster.buildings).not.toContain(id);
        expect(roster.buildings).toContain(expected);
      }

      expect(new Set(roster.units).size).toBe(roster.units.length);
      expect(new Set(roster.buildings).size).toBe(roster.buildings.length);
      // A roster entry is either baseline content, a variant of a canonical
      // slot, or a national exclusive. An exclusive deliberately declares no
      // variantOf: it is an extra option rather than a second definition in a
      // slot, so it must never displace the platform a production list names.
      expect(
        roster.units.every(
          (id) =>
            id in UNITS &&
            (UNIT_LIST.some((unit) => unit.id === id) ||
              !!UNITS[id].variantOf ||
              UNITS[id].national === true),
        ),
      ).toBe(true);
      expect(
        roster.buildings.every(
          (id) =>
            id in BUILDINGS &&
            (BUILDING_LIST.some((building) => building.id === id) || !!BUILDINGS[id].variantOf),
        ),
      ).toBe(true);
    }
  });

  it('resolves legacy presets to the same content as their alliance', () => {
    for (const legacy of Object.values(FACTIONS)) {
      const roster = resolveRoster(legacy.id);
      expect(roster.units).toEqual(ALLIANCES[legacy.allianceId].baseline.units);
      expect(roster.buildings).toEqual(ALLIANCES[legacy.allianceId].baseline.buildings);
    }
  });

  it('is deterministic, cached and immutable', () => {
    const first = resolveRoster('lithuania');
    expect(resolveRoster('lithuania')).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.units)).toBe(true);
    expect(Object.isFrozen(first.buildings)).toBe(true);
    expect(() => (first.units as string[]).push('tank')).toThrow();
    expect(() => (first.buildings as string[]).push('barracks')).toThrow();
  });

  it('fails clearly for an unknown nation or faction', () => {
    expect(() => resolveRoster('atlantis')).toThrow(/Unknown faction or nation/);
    expect(() => resolveRoster('toString')).toThrow(/Unknown faction or nation/);
    expect(() => nationDef('atlantis')).toThrow(/Unknown nation definition/);
    expect(() => nationDef('toString')).toThrow(/Unknown nation definition/);
    expect(() => allianceDef('atlantis')).toThrow(/Unknown alliance definition/);
    expect(factionDef('toString')).toBe(FACTIONS.baltic);
  });

  it('applies future additions, exclusions and substitutions without mutating the baseline', () => {
    const base = {
      units: ['rifle', 'tank'],
      buildings: ['barracks', 'factory'],
    };
    const merged = mergeRoster(
      base,
      {
        addUnits: ['medic'],
        removeUnits: ['tank'],
        replaceBuildings: { factory: 'airfield' },
      },
      'fixture',
    );
    expect(merged.units).toEqual(['rifle', 'medic']);
    expect(merged.buildings).toEqual(['barracks', 'airfield']);
    expect(Object.isFrozen(merged)).toBe(true);
    expect(base.units).toEqual(['rifle', 'tank']);
    expect(base.buildings).toEqual(['barracks', 'factory']);
  });

  it('keeps a replacement in the baseline slot', () => {
    const merged = mergeRoster(
      { units: ['rifle', 'tank', 'recon'], buildings: [] },
      { replaceUnits: { tank: 'atgm' } },
      'fixture',
    );
    expect(merged.units).toEqual(['rifle', 'atgm', 'recon']);
  });
});

describe('roster integrity failures', () => {
  const base = { units: ['rifle'], buildings: ['barracks'] };
  const invalid: Array<[string, NationRosterModifications, RegExp]> = [
    ['an unknown added unit', { addUnits: ['ghost'] }, /unknown added unit/],
    ['a duplicate addition', { addUnits: ['medic', 'medic'] }, /duplicate addition/],
    ['an addition already in the roster', { addUnits: ['rifle'] }, /duplicates an existing/],
    ['removing a missing unit', { removeUnits: ['tank'] }, /cannot remove unit/],
    ['replacing a missing unit', { replaceUnits: { tank: 'recon' } }, /not in the baseline/],
    ['replacing with an unknown unit', { replaceUnits: { rifle: 'ghost' } }, /unknown replacement/],
    [
      'removing and replacing the same unit',
      { removeUnits: ['rifle'], replaceUnits: { rifle: 'tank' } },
      /both removed and replaced/,
    ],
  ];

  for (const [label, changes, error] of invalid) {
    it(`rejects ${label}`, () => {
      expect(() => mergeRoster(base, changes, 'fixture')).toThrow(error);
    });
  }

  it('rejects unknown and duplicate baseline ids', () => {
    expect(() => mergeRoster({ units: ['ghost'], buildings: [] }, {}, 'fixture')).toThrow(
      /unknown unit/,
    );
    expect(() => mergeRoster({ units: ['toString'], buildings: [] }, {}, 'fixture')).toThrow(
      /unknown unit/,
    );
    expect(() =>
      mergeRoster({ units: ['rifle', 'rifle'], buildings: [] }, {}, 'fixture'),
    ).toThrow(/duplicate unit/);
    expect(() =>
      mergeRoster({ units: [], buildings: ['barracks', 'barracks'] }, {}, 'fixture'),
    ).toThrow(/duplicate building/);
  });

  it('rejects a replacement whose target is removed', () => {
    expect(() =>
      mergeRoster(
        { units: ['rifle', 'tank'], buildings: [] },
        { removeUnits: ['tank'], replaceUnits: { rifle: 'tank' } },
        'fixture',
      ),
    ).toThrow(/which is removed/);
  });

  it('rejects a replacement that collides with another roster entry', () => {
    expect(() =>
      mergeRoster(
        { units: ['rifle', 'tank'], buildings: [] },
        { replaceUnits: { tank: 'rifle' } },
        'fixture',
      ),
    ).toThrow(/duplicate unit/);
  });
});

describe('scenario compatibility', () => {
  it('parses a scenario that names nations and preserves the ids', () => {
    const parsed = parseScenario(JSON.parse(JSON.stringify(nationScenario())));
    expect(parsed.players[0].factionId).toBe('lithuania');
    expect(parsed.players[1].factionId).toBe('russia');
  });

  it('still parses the legacy built-in map', () => {
    const parsed = parseScenario(JSON.parse(JSON.stringify(createIslandAssault())));
    expect(parsed.players.map((player) => player.factionId)).toEqual(['baltic', 'expeditionary']);
  });

  it('rejects an unknown faction id', () => {
    const scenario = nationScenario();
    scenario.players[0].factionId = 'atlantis';
    expect(() => parseScenario(JSON.parse(JSON.stringify(scenario)))).toThrow(/known faction/);
    scenario.players[0].factionId = 'toString';
    expect(() => parseScenario(JSON.parse(JSON.stringify(scenario)))).toThrow(/known faction/);
  });

  it('does not change starting forces when a scenario names nations', () => {
    const legacyGame = new Game(createIslandAssault(), { enableAI: false });
    const nationGame = new Game(nationScenario(), { enableAI: false });
    expect(nationGame.player(0)?.factionId).toBe('lithuania');
    expect(nationGame.player(1)?.factionId).toBe('russia');
    expect(nationGame.entitiesOf(0, 'unit').length).toBe(legacyGame.entitiesOf(0, 'unit').length);
    expect(nationGame.entitiesOf(1, 'building').length).toBe(
      legacyGame.entitiesOf(1, 'building').length,
    );
    const hq = nationGame.entitiesOf(0, 'building').find((e) => e.defId === 'commandPost')!;
    const legacyHq = legacyGame.entitiesOf(0, 'building').find((e) => e.defId === 'commandPost')!;
    expect(nationGame.productionStatus(0, hq.id, 'engineer')).toEqual(
      legacyGame.productionStatus(0, legacyHq.id, 'engineer'),
    );
  });
});
