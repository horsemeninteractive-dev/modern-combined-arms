import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { completeResearch } from './helpers';
import type { Scenario } from '../src/sim/scenario';
import { BUILDING_LIST } from '../src/data/buildings';
import { UNIT_LIST } from '../src/data/units';
import {
  ALLIANCES,
  ALLIANCE_LIST,
  FACTIONS,
  NATION_LIST,
  PLAYABLE_NATION_IDS,
  defaultNationFor,
  defaultOpponentNation,
  identityAlliance,
  identityDef,
  identityLabel,
  isKnownFactionId,
  opposingAllianceId,
  playableNations,
  resolveOpponentNation,
  tryIdentityDef,
} from '../src/data/factions';
import { mergeRoster, resolveRoster, rosterIncludes } from '../src/data/roster';
import { cloneScenario, parseScenario, scenarioToJson } from '../src/sim/scenario';

/** The island with both player slots stamped with explicit nation ids. */
function nationScenario(playerNation: string, opponentNation = defaultOpponentNation(playerNation).id): Scenario {
  const scenario = createIslandAssault();
  scenario.settings.seed = 90210;
  scenario.players[0].factionId = playerNation;
  scenario.players[1].factionId = opponentNation;
  return scenario;
}

describe('nation identity registry', () => {
  it('exposes the ten playable nations and keeps legacy presets resolvable', () => {
    expect(PLAYABLE_NATION_IDS).toHaveLength(10);
    expect(new Set(PLAYABLE_NATION_IDS).size).toBe(10);

    for (const nation of NATION_LIST) {
      const identity = identityDef(nation.id);
      expect(identity.playable).toBe(true);
      expect(identity.legacy).toBe(false);
      expect(identity.name).toBe(nation.name);
      expect(identity.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(identity.allianceId).toBe(nation.allianceId);
      expect(identityAlliance(nation.id).id).toBe(nation.allianceId);
    }

    for (const preset of Object.values(FACTIONS)) {
      const identity = identityDef(preset.id);
      expect(identity.playable).toBe(false);
      expect(identity.legacy).toBe(true);
      expect(identity.allianceId).toBe(preset.allianceId);
      expect(isKnownFactionId(preset.id)).toBe(true);
    }

    expect(tryIdentityDef('atlantis')).toBeUndefined();
    expect(() => identityDef('atlantis')).toThrow(/Unknown faction or nation/);
    expect(() => identityAlliance('atlantis')).toThrow(/Unknown faction or nation/);
  });

  it('derives each nation from exactly one alliance', () => {
    for (const nation of NATION_LIST) {
      const alliance = identityAlliance(nation.id);
      expect(ALLIANCE_LIST.some((entry) => entry.id === alliance.id)).toBe(true);
      expect(nation.allianceId).toBe(alliance.id);
    }
    expect(defaultNationFor('defender').allianceId).toBe('defender');
    expect(defaultNationFor('eastern').allianceId).toBe('eastern');
    expect(() => defaultNationFor('nobody')).toThrow();
    expect(opposingAllianceId('defender')).toBe('eastern');
    expect(opposingAllianceId('eastern')).toBe('defender');
  });

  it('offers every playable nation as an opponent, mirror matches included', () => {
    expect(playableNations().map((nation) => nation.id)).toEqual([...PLAYABLE_NATION_IDS]);
    expect(resolveOpponentNation('uk', 'uk').id).toBe('uk');
    expect(resolveOpponentNation('russia', 'russia').id).toBe('russia');
    expect(resolveOpponentNation('lithuania', 'poland').id).toBe('poland');
    for (const nation of NATION_LIST) {
      for (const option of playableNations()) {
        expect(resolveOpponentNation(nation.id, option.id).id).toBe(option.id);
      }
    }
  });

  it('falls back to the other-alliance default for empty, unknown or legacy picks', () => {
    for (const nation of NATION_LIST) {
      const fallback = defaultOpponentNation(nation.id).id;
      expect(resolveOpponentNation(nation.id).id).toBe(fallback);
      expect(resolveOpponentNation(nation.id, '').id).toBe(fallback);
      expect(resolveOpponentNation(nation.id, 'atlantis').id).toBe(fallback);
      expect(resolveOpponentNation(nation.id, 'baltic').id).toBe(fallback);
    }
  });

  it('assigns a deterministic opponent from the other alliance', () => {
    for (const nation of NATION_LIST) {
      const opponent = defaultOpponentNation(nation.id);
      expect(opponent.allianceId).not.toBe(nation.allianceId);
      expect(PLAYABLE_NATION_IDS).toContain(opponent.id);
      expect(defaultOpponentNation(nation.id).id).toBe(opponent.id);
      expect(identityLabel(opponent.id)).toBe(opponent.shortName);
    }
    // The opposing side is the same for every nation of one alliance: the
    // pairing is a side rule, not a per-nation grudge match.
    expect(defaultOpponentNation('lithuania').id).toBe(defaultOpponentNation('poland').id);
    expect(defaultOpponentNation('russia').id).toBe(defaultOpponentNation('belarus').id);
  });
});

describe('nation identity in scenario and battle state', () => {
  it('round-trips every nation through scenario serialisation', () => {
    for (const nation of NATION_LIST) {
      const opponent = defaultOpponentNation(nation.id);
      const scenario = nationScenario(nation.id, opponent.id);
      const parsed = parseScenario(JSON.parse(scenarioToJson(scenario)));
      expect(parsed.players[0].factionId).toBe(nation.id);
      expect(parsed.players[1].factionId).toBe(opponent.id);
      // Cloning is the deploy path; it must not collapse a nation to a preset.
      const copy = cloneScenario(scenario);
      expect(copy.players[0].factionId).toBe(nation.id);
      expect(copy.players[1].factionId).toBe(opponent.id);
    }
  });

  it('keeps the selected nation through game initialisation, including the AI', () => {
    for (const nation of NATION_LIST) {
      const opponent = defaultOpponentNation(nation.id);
      const game = new Game(nationScenario(nation.id, opponent.id), { enableAI: false });
      expect(game.player(0)?.factionId).toBe(nation.id);
      expect(game.player(1)?.factionId).toBe(opponent.id);
      expect(game.player(1)?.isAI).toBe(true);
      expect(game.state.scenario.players[0].factionId).toBe(nation.id);
    }
  });

  it('rejects an unknown faction id at the scenario boundary', () => {
    const raw = JSON.parse(scenarioToJson(nationScenario('lithuania'))) as Record<string, unknown>;
    const players = raw.players as Array<Record<string, unknown>>;
    players[0].factionId = 'atlantis';
    expect(() => parseScenario(raw)).toThrow(/factionId/);
  });

  it('uses each player nation as the resolved roster source', () => {
    for (const nation of NATION_LIST) {
      const game = new Game(nationScenario(nation.id), { enableAI: false });
      expect(game.rosterFor(0)).toEqual(resolveRoster(nation.id));
      expect(game.rosterFor(1)).toEqual(resolveRoster(defaultOpponentNation(nation.id).id));
    }
    const legacy = new Game(nationScenario('baltic', 'expeditionary'), { enableAI: false });
    expect(legacy.rosterFor(0)).toEqual(resolveRoster('baltic'));
    expect(legacy.rosterFor(1)).toEqual(resolveRoster('expeditionary'));
  });
});

describe('production and construction follow the resolved roster', () => {
  /** A nation game with one factory and one airfield ready to produce. */
  function facilityGame(nation: string): Game {
    const scenario = nationScenario(nation);
    scenario.structures.push(
      { defId: 'factory', owner: 0, x: 30, z: 34 },
      { defId: 'airfield', owner: 0, x: 40, z: 40 },
    );
    const game = new Game(scenario, { enableAI: false });
    const player = game.player(0)!;
    player.mats = 6000;
    player.req = 1000;
    // This suite asks where each nation's equipment is built, not whether the
    // tree is open; the research suites own the gate.
    completeResearch(game, 0);
    return game;
  }

  it('lets every nation reach every baseline role through its resolved roster', () => {
    for (const nation of NATION_LIST) {
      const game = facilityGame(nation.id);
      for (const unit of UNIT_LIST) {
        const actual = game.unitIdFor(0, unit.id);
        expect(actual, `${nation.id} has no ${unit.id} slot`).toBeTruthy();
        expect(game.canProduce(0, actual!), `${nation.id} ${actual}`).toBe(true);
      }
      for (const building of BUILDING_LIST) {
        const actual = game.buildingIdFor(0, building.id);
        expect(actual, `${nation.id} has no ${building.id} slot`).toBeTruthy();
        expect(game.canBuild(0, actual!), `${nation.id} ${actual}`).toBe(true);
      }
      expect(game.canProduce(0, 'notAUnit')).toBe(false);
      expect(game.canBuild(0, 'notABuilding')).toBe(false);
    }
  });

  it('lets every nation field the Phase 2 roles through their real facilities', () => {
    for (const nation of NATION_LIST) {
      const game = facilityGame(nation.id);
      const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
      const airfield = game.entitiesOf(0, 'building').find((e) => e.defId === 'airfield')!;
      for (const slot of ['spg', 'recovery']) {
        const id = game.unitIdFor(0, slot)!;
        expect(game.productionStatus(0, factory.id, id).ok, `${nation} ${id}`).toBe(true);
      }
      for (const slot of ['interceptor', 'uav']) {
        const id = game.unitIdFor(0, slot)!;
        expect(game.productionStatus(0, airfield.id, id).ok, `${nation} ${id}`).toBe(true);
      }
      // Coastal defence is nationalised for Iran, so ask the roster what this
      // nation builds in that slot rather than naming the shared id.
      const coastal = game.buildingIdFor(0, 'coastalBattery')!;
      expect(game.canBuild(0, coastal), `${nation} ${coastal}`).toBe(true);
    }
  });

  it('actually produces a national roster unit through the simulation', () => {
    const game = facilityGame('poland');
    const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: 'spg' });
    game.advance(1);
    expect(factory.queue.map((item) => item.defId)).toEqual(['spg']);
    game.advance(20 * 20);
    expect(game.entitiesOf(0, 'unit').some((e) => e.defId === 'spg')).toBe(true);
  });

  it('rejects a definition the facility cannot produce even without the UI', () => {
    const game = facilityGame('uk');
    const hq = game.entitiesOf(0, 'building').find((e) => e.defId === 'commandPost')!;
    const status = game.productionStatus(0, hq.id, 'tank');
    expect(status.ok).toBe(false);
    expect(status.reason).toMatch(/cannot produce/);
    // A direct command that skips the UI is refused the same way.
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: hq.id, defId: 'tank' });
    game.advance(1);
    expect(hq.queue).toHaveLength(0);
  });

  it('gates membership through the same resolver the registry exposes', () => {
    const reduced = mergeRoster(
      { units: resolveRoster('lithuania').units, buildings: resolveRoster('lithuania').buildings },
      { removeUnits: ['tank'] },
    );
    expect(rosterIncludes(reduced, 'unit', 'tank')).toBe(false);
    expect(rosterIncludes(reduced, 'unit', 'spg')).toBe(true);
    expect(rosterIncludes(reduced, 'building', 'factory')).toBe(true);
  });

  it('keeps legacy presets on the shared baseline while nations substitute', () => {
    const run = (playerFaction: string, enemyFaction: string) => {
      const scenario = nationScenario(playerFaction, enemyFaction);
      const game = new Game(scenario, { enableAI: false });
      game.advance(20 * 30);
      return game.stateHash();
    };
    // Legacy presets resolve to their own alliance baseline and stay
    // deterministic. They are no longer the same roster: each preset fields the
    // equipment of the coalition it belongs to.
    expect(run('baltic', 'expeditionary')).toBe(run('baltic', 'expeditionary'));
    expect(resolveRoster('baltic')).toEqual(ALLIANCES.defender.baseline);
    expect(resolveRoster('expeditionary')).toEqual(ALLIANCES.eastern.baseline);
    expect(resolveRoster('baltic')).not.toEqual(resolveRoster('expeditionary'));
  });
});

describe('nation identity survives save and load', () => {
  it('round-trips a nation battle for every nation', () => {
    for (const nation of NATION_LIST) {
      const opponent = defaultOpponentNation(nation.id);
      const game = new Game(nationScenario(nation.id, opponent.id), { enableAI: false });
      game.advance(40);
      const saved = game.toSave();
      const loaded = Game.fromSave(JSON.parse(JSON.stringify(saved)), { enableAI: false });
      expect(loaded.player(0)?.factionId).toBe(nation.id);
      expect(loaded.player(1)?.factionId).toBe(opponent.id);
      expect(loaded.state.scenario.players[0].factionId).toBe(nation.id);
      expect(loaded.rosterFor(0)).toEqual(resolveRoster(nation.id));
      expect(loaded.stateHash()).toBe(game.stateHash());
    }
  });

  it('keeps legacy baltic and expeditionary saves loadable', () => {
    const game = new Game(nationScenario('baltic', 'expeditionary'), { enableAI: false });
    game.advance(20);
    const loaded = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(loaded.player(0)?.factionId).toBe('baltic');
    expect(loaded.player(1)?.factionId).toBe('expeditionary');
    expect(loaded.stateHash()).toBe(game.stateHash());
  });

  it('rejects a save whose player faction no longer exists', () => {
    const game = new Game(nationScenario('lithuania'), { enableAI: false });
    const raw = JSON.parse(JSON.stringify(game.toSave())) as {
      state: { players: Array<{ factionId: string }> };
    };
    raw.state.players[0].factionId = 'atlantis';
    expect(() => Game.fromSave(raw, { enableAI: false })).toThrow(/unknown faction or nation/);
  });
});
