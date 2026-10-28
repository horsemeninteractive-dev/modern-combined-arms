import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { TILE_SIZE } from '../src/sim/constants';
import { BUILDINGS, BUILDING_LIST } from '../src/data/buildings';
import { UNIT_LIST, UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';
import { FACTIONS, NATION_LIST, defaultOpponentNation } from '../src/data/factions';
import { resolveRoster } from '../src/data/roster';
import { computeDamage } from '../src/sim/combat';
import { AIController, initialAIState } from '../src/sim/ai';
import type { Scenario } from '../src/sim/scenario';

/** Identity of every shipped national substitution, in registry order. */
const SUBSTITUTIONS = [
  { nation: 'lithuania', kind: 'unit' as const, slot: 'recon', variant: 'pathfinder', facility: 'factory' },
  { nation: 'poland', kind: 'unit' as const, slot: 'tank', variant: 'spearhead', facility: 'factory' },
  { nation: 'uk', kind: 'unit' as const, slot: 'spg', variant: 'mlrs', facility: 'factory' },
  { nation: 'russia', kind: 'unit' as const, slot: 'spg', variant: 'heavyHowitzer', facility: 'factory' },
  { nation: 'belarus', kind: 'unit' as const, slot: 'uav', variant: 'deepReconUAV', facility: 'airfield' },
  { nation: 'hungary', kind: 'building' as const, slot: 'mgNest', variant: 'bunker', facility: '' },
] as const;

/**
 * A bare 48x48 arena. Both command posts sit in opposite corners so no test
 * accidentally wins or loses while it measures something else.
 */
function arena(playerNation: string, enemyNation = 'lithuania'): Scenario {
  const size = 48;
  const scenario = createEmptyScenario(size, size);
  scenario.meta.id = 'national-specialisation-test';
  scenario.settings.seed = 4242;
  scenario.settings.startingMats = 6000;
  scenario.settings.startingReq = 1000;
  scenario.settings.fog = true;
  scenario.players[0].factionId = playerNation;
  scenario.players[0].startX = 6;
  scenario.players[0].startZ = 6;
  scenario.players[1].factionId = enemyNation;
  scenario.players[1].startX = size - 7;
  scenario.players[1].startZ = size - 7;
  // Settlement is driven by the tests that care about it.
  scenario.players[1].isAI = false;
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 6, z: 6 },
    { defId: 'commandPost', owner: 1, x: size - 9, z: size - 9 },
  );
  return scenario;
}

function unit(game: Game, defId: string, owner = 0) {
  return game.state.entities.find(
    (e) => e.kind === 'unit' && e.defId === defId && e.owner === owner && e.hp > 0,
  )!;
}

/** A player with one complete factory and one complete airfield. */
function facilityGame(nation: string): Game {
  const scenario = arena(nation);
  scenario.structures.push(
    { defId: 'factory', owner: 0, x: 14, z: 6 },
    { defId: 'airfield', owner: 0, x: 14, z: 14 },
  );
  return new Game(scenario, { enableAI: false });
}

describe('national roster substitutions', () => {
  it('gives each nation exactly one substitution and leaves every other nation on the baseline', () => {
    expect(SUBSTITUTIONS).toHaveLength(NATION_LIST.length);
    for (const entry of SUBSTITUTIONS) {
      const roster = resolveRoster(entry.nation);
      const list = entry.kind === 'unit' ? roster.units : roster.buildings;
      expect(list).toContain(entry.variant);
      expect(list).not.toContain(entry.slot);
      const def = entry.kind === 'unit' ? UNITS[entry.variant] : BUILDINGS[entry.variant];
      expect(def.variantOf).toBe(entry.slot);

      for (const other of NATION_LIST) {
        if (other.id === entry.nation) continue;
        const otherRoster = resolveRoster(other.id);
        const otherList = entry.kind === 'unit' ? otherRoster.units : otherRoster.buildings;
        expect(otherList, `${other.id} must not inherit ${entry.variant}`).not.toContain(
          entry.variant,
        );
      }
    }
  });

  it('keeps the shared baseline and the legacy presets free of national variants', () => {
    for (const preset of Object.values(FACTIONS)) {
      const roster = resolveRoster(preset.id);
      for (const entry of SUBSTITUTIONS) {
        const list = entry.kind === 'unit' ? roster.units : roster.buildings;
        expect(list).not.toContain(entry.variant);
        expect(list).toContain(entry.slot);
      }
    }
  });

  it('keeps each replacement producible from the same facility family as its slot', () => {
    for (const entry of SUBSTITUTIONS) {
      if (entry.kind !== 'unit') continue;
      const slot = UNITS[entry.slot];
      const variant = UNITS[entry.variant];
      expect(variant.producedBy).toContain(entry.facility);
      expect(slot.producedBy).toContain(entry.facility);
    }
  });

  it('trades one axis for another rather than raising raw power', () => {
    // Lithuania: longer optics and a lower price for losing the autocannon.
    expect(UNITS.pathfinder.weapons).toEqual([]);
    expect(UNITS.pathfinder.vision).toBeGreaterThan(UNITS.recon.vision);
    expect(UNITS.pathfinder.cost.mats).toBeLessThan(UNITS.recon.cost.mats);
    expect(UNITS.pathfinder.hp).toBeLessThan(UNITS.recon.hp);

    // Poland: tougher and harder-hitting, but slower in hull and turret.
    expect(computeDamage(72, WEAPONS.spearheadGun.multipliers, 'heavy')).toBeGreaterThan(
      computeDamage(60, WEAPONS.tankGun.multipliers, 'heavy'),
    );
    expect(WEAPONS.spearheadGun.range).toBeGreaterThan(WEAPONS.tankGun.range);
    expect(UNITS.spearhead.speed).toBeLessThan(UNITS.tank.speed);
    expect(UNITS.spearhead.turretRate!).toBeLessThan(UNITS.tank.turretRate!);
    expect(UNITS.spearhead.hp).toBeGreaterThan(UNITS.tank.hp);

    // UK: more reach and a wider beaten zone, paid for with dispersion, a
    // larger dead zone and a light hull.
    expect(WEAPONS.mlrsRocket.range).toBeGreaterThan(WEAPONS.howitzer.range);
    expect(WEAPONS.mlrsRocket.accuracy).toBeLessThan(WEAPONS.howitzer.accuracy);
    expect(WEAPONS.mlrsRocket.minRange!).toBeGreaterThan(WEAPONS.howitzer.minRange!);
    expect(UNITS.mlrs.hp).toBeLessThan(UNITS.spg.hp);

    // Russia: fewer, heavier shells with a longer reload and a slower hull.
    expect(computeDamage(WEAPONS.heavyShell.damage, WEAPONS.heavyShell.multipliers, 'structure'))
      .toBeGreaterThan(computeDamage(WEAPONS.howitzer.damage, WEAPONS.howitzer.multipliers, 'structure'));
    expect(WEAPONS.heavyShell.cooldown).toBeGreaterThan(WEAPONS.howitzer.cooldown);
    expect(UNITS.heavyHowitzer.speed).toBeLessThan(UNITS.spg.speed);

    // Belarus: the best optics in the game, still unarmed and slower to replace.
    expect(UNITS.deepReconUAV.weapons).toEqual([]);
    expect(UNITS.deepReconUAV.vision).toBeGreaterThan(UNITS.uav.vision);
    expect(UNITS.deepReconUAV.fuel!).toBeGreaterThan(UNITS.uav.fuel!);
    expect(UNITS.deepReconUAV.speed).toBeLessThan(UNITS.uav.speed);

    // Hungary: fewer, tougher positions with the same anti-infantry weapon.
    expect(BUILDINGS.bunker.hp).toBeGreaterThan(BUILDINGS.mgNest.hp);
    expect(BUILDINGS.bunker.weapons).toEqual(BUILDINGS.mgNest.weapons);
    expect(BUILDINGS.bunker.cost.mats).toBeGreaterThan(BUILDINGS.mgNest.cost.mats);
    expect(BUILDINGS.bunker.buildTime).toBeGreaterThan(BUILDINGS.mgNest.buildTime);
    // The bunker is still an anti-infantry position: armour is the answer to it.
    expect(computeDamage(6, WEAPONS.heavyMg.multipliers, 'infantry')).toBeGreaterThan(
      computeDamage(6, WEAPONS.heavyMg.multipliers, 'heavy') * 10,
    );
  });
});

describe('national production and construction', () => {
  it('shows and accepts exactly the national unit in the family production slot', () => {
    for (const entry of SUBSTITUTIONS) {
      if (entry.kind !== 'unit') continue;
      const game = facilityGame(entry.nation);
      const facility = game
        .entitiesOf(0, 'building')
        .find((e) => e.defId === entry.facility)!;
      const entries = game.productionEntries(0, facility.defId);
      expect(entries, `${entry.nation} facility list`).toContain(entry.variant);
      expect(entries).not.toContain(entry.slot);
      expect(game.productionStatus(0, facility.id, entry.variant).ok).toBe(true);
      // A request that skips the UI still cannot buy a definition outside the
      // resolved roster.
      expect(game.productionStatus(0, facility.id, entry.slot).ok).toBe(false);
    }
  });

  it('produces the national variant through the simulation', () => {
    const game = facilityGame('lithuania');
    const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
    game.enqueueCommand({
      type: 'produce',
      team: 0,
      buildingId: factory.id,
      defId: 'pathfinder',
    });
    game.advance(20 * 15);
    expect(game.entitiesOf(0, 'unit').some((e) => e.defId === 'pathfinder')).toBe(true);
    expect(game.entitiesOf(0, 'unit').some((e) => e.defId === 'recon')).toBe(false);
  });

  it('lets the owning nation build its national structure and rejects it elsewhere', () => {
    const scenario = arena('hungary');
    scenario.units.push({ defId: 'engineer', owner: 0, x: 10, z: 8 });
    const game = new Game(scenario, { enableAI: false });
    const engineer = unit(game, 'engineer');
    expect(game.canBuild(0, 'bunker')).toBe(true);
    expect(game.canBuild(0, 'mgNest')).toBe(false);
    expect(game.placementStatus(0, 'mgNest', 12, 6, engineer.id).ok).toBe(false);
    expect(game.placementStatus(0, 'bunker', 12, 6, engineer.id).ok).toBe(true);

    game.enqueueCommand({
      type: 'placeBuilding',
      team: 0,
      builderId: engineer.id,
      defId: 'bunker',
      tileX: 12,
      tileZ: 6,
    });
    game.advance(20 * 30);
    const bunker = game.entitiesOf(0, 'building').find((e) => e.defId === 'bunker');
    expect(bunker).toBeDefined();
    expect(bunker!.construction).toBeFalsy();

    const outsider = new Game(arena('lithuania'), { enableAI: false });
    expect(outsider.canBuild(0, 'bunker')).toBe(false);
    expect(outsider.placementStatus(0, 'bunker', 12, 6).code).toBe('roster');
  });
});

describe('national capabilities in the simulation', () => {
  it('gives Lithuania longer real vision than the shared recon vehicle', () => {
    const make = (nation: string, scout: string, x: number) => {
      const scenario = arena(nation);
      scenario.units.push(
        { defId: scout, owner: 0, x, z: 20 },
        { defId: 'tank', owner: 1, x: 20, z: 20 },
      );
      const game = new Game(scenario, { enableAI: false });
      game.advance(2);
      return game;
    };
    // 15 tiles: inside the Pathfinder's 16-tile optics, outside the 12.5-tile
    // shared scout's.
    const pathfinder = make('lithuania', 'pathfinder', 5);
    const recon = make('baltic', 'recon', 5);
    const pathfinderTarget = pathfinder.state.entities.find((e) => e.owner === 1 && e.defId === 'tank')!;
    const reconTarget = recon.state.entities.find((e) => e.owner === 1 && e.defId === 'tank')!;
    expect(pathfinder.isVisibleTo(0, pathfinderTarget.id)).toBe(true);
    expect(recon.isVisibleTo(0, reconTarget.id)).toBe(false);
  });

  it('lets the MLRS fire from beyond shared artillery range but not inside its dead zone', () => {
    const scenario = arena('uk');
    scenario.settings.fog = false;
    scenario.structures.push(
      { defId: 'barracks', owner: 1, x: 26, z: 20 },
      { defId: 'barracks', owner: 1, x: 10, z: 23 },
    );
    scenario.units.push({ defId: 'mlrs', owner: 0, x: 10, z: 20 });
    const game = new Game(scenario, { enableAI: false });
    const far = game.state.entities.find(
      (e) => e.kind === 'building' && e.defId === 'barracks' && e.x > 20 * TILE_SIZE,
    )!;
    const near = game.state.entities.find(
      (e) => e.kind === 'building' && e.defId === 'barracks' && e.x < 20 * TILE_SIZE,
    )!;
    const farHp = far.hp;
    const nearHp = near.hp;
    // Auto-acquisition, no move order: the battery shoots what it can reach.
    game.advance(20 * 20);
    expect(far.hp).toBeLessThan(farHp);
    expect(near.hp).toBe(nearHp);

    // The shared howitzer cannot reach the same 16-tile target.
    const baseline = arena('baltic');
    baseline.settings.fog = false;
    baseline.structures.push({ defId: 'barracks', owner: 1, x: 26, z: 20 });
    baseline.units.push({ defId: 'spg', owner: 0, x: 10, z: 20 });
    const baseGame = new Game(baseline, { enableAI: false });
    const baseTarget = baseGame.state.entities.find((e) => e.kind === 'building' && e.defId === 'barracks')!;
    const baseHp = baseTarget.hp;
    baseGame.advance(20 * 20);
    expect(baseTarget.hp).toBe(baseHp);
  });

  it('gives Russia a heavier shell than the shared howitzer', () => {
    const scenario = arena('russia');
    scenario.settings.fog = false;
    scenario.structures.push({ defId: 'barracks', owner: 1, x: 25, z: 20 });
    scenario.units.push({ defId: 'heavyHowitzer', owner: 0, x: 10, z: 20 });
    const game = new Game(scenario, { enableAI: false });
    const target = game.state.entities.find((e) => e.kind === 'building' && e.defId === 'barracks')!;
    const hp = target.hp;
    game.advance(20 * 25);
    expect(target.hp).toBeLessThan(hp);
  });

  it('gives Belarus a longer-eyed but still unarmed drone', () => {
    const make = (nation: string, drone: string) => {
      const scenario = arena(nation);
      scenario.units.push(
        { defId: drone, owner: 0, x: 6, z: 20 },
        { defId: 'tank', owner: 1, x: 32, z: 20 },
      );
      const game = new Game(scenario, { enableAI: false });
      game.advance(1);
      return game;
    };
    // 26 tiles: inside the Deep Recon UAV's 30-tile optics, outside the 22-tile
    // shared drone's.
    const deep = make('belarus', 'deepReconUAV');
    const shared = make('baltic', 'uav');
    const deepTarget = deep.state.entities.find((e) => e.owner === 1 && e.defId === 'tank')!;
    const sharedTarget = shared.state.entities.find((e) => e.owner === 1 && e.defId === 'tank')!;
    expect(deep.isVisibleTo(0, deepTarget.id)).toBe(true);
    expect(shared.isVisibleTo(0, sharedTarget.id)).toBe(false);
    expect(UNITS.deepReconUAV.weapons).toEqual([]);
  });
});

describe('national rosters for the AI', () => {
  function aiArena(nation: string, extra?: 'fortified' | 'threat'): Game {
    const scenario = arena('lithuania', nation);
    scenario.players[1].isAI = true;
    scenario.players[1].startX = 40;
    scenario.players[1].startZ = 24;
    scenario.structures.push(
      { defId: 'factory', owner: 1, x: 36, z: 20 },
      { defId: 'barracks', owner: 1, x: 36, z: 26 },
      { defId: 'refinery', owner: 1, x: 32, z: 24 },
      { defId: 'airfield', owner: 1, x: 40, z: 32 },
    );
    scenario.units.push(
      { defId: 'engineer', owner: 1, x: 39, z: 22 },
      { defId: 'harvester', owner: 1, x: 34, z: 24 },
    );
    // A sighted enemy position gives the AI the trigger its national role
    // responds to: fortified targets call for artillery, a nearby threat calls
    // for a defensive position.
    if (extra === 'fortified') {
      scenario.structures.push({ defId: 'mgNest', owner: 0, x: 31, z: 20 });
    }
    if (extra === 'threat') {
      scenario.units.push({ defId: 'rifle', owner: 0, x: 33, z: 24 });
    }
    return new Game(scenario, { enableAI: false });
  }

  function runAI(nation: string, seconds: number, extra?: 'fortified' | 'threat'): Set<string> {
    const game = aiArena(nation, extra);
    const ai = new AIController();
    const state = initialAIState(7, 'elite');
    const seen = new Set<string>();
    for (let i = 0; i < 20 * seconds && game.state.victory === 'playing'; i++) {
      game.tick();
      ai.update(game, 1, state);
      for (const building of game.entitiesOf(1, 'building')) {
        seen.add(building.defId);
        for (const item of building.queue) seen.add(item.defId);
      }
      for (const e of game.entitiesOf(1, 'unit')) seen.add(e.defId);
    }
    return seen;
  }

  it('buys the national armour instead of the shared tank', () => {
    const seen = runAI('poland', 60);
    expect(seen.has('spearhead')).toBe(true);
    expect(seen.has('tank')).toBe(false);
  });

  it('buys the national drone instead of the shared UAV', () => {
    const seen = runAI('belarus', 60);
    expect(seen.has('deepReconUAV')).toBe(true);
    expect(seen.has('uav')).toBe(false);
  });

  it('buys national artillery when a fortified target is known', () => {
    const seen = runAI('uk', 120, 'fortified');
    expect(seen.has('mlrs')).toBe(true);
    expect(seen.has('spg')).toBe(false);
  });

  it('builds its national defensive structure when the base is threatened', () => {
    const seen = runAI('hungary', 150, 'threat');
    expect(seen.has('bunker')).toBe(true);
    expect(seen.has('mgNest')).toBe(false);
  });

  it('keeps human and AI eligibility on the same resolved roster', () => {
    const scenario = arena('lithuania', 'russia');
    scenario.players[1].isAI = true;
    const game = new Game(scenario, { enableAI: false });
    expect(game.rosterFor(0)).toEqual(resolveRoster('lithuania'));
    expect(game.rosterFor(1)).toEqual(resolveRoster('russia'));
    for (const variant of ['mlrs', 'spearhead', 'pathfinder', 'deepReconUAV']) {
      expect(game.canProduce(1, variant)).toBe(false);
    }
  });
});

describe('national identity and determinism', () => {
  it('restores the national roster and its units after a reload', () => {
    const scenario = arena('poland');
    scenario.units.push({ defId: 'spearhead', owner: 0, x: 10, z: 14 });
    const game = new Game(scenario, { enableAI: false });
    game.advance(40);
    const loaded = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(loaded.player(0)?.factionId).toBe('poland');
    expect(loaded.rosterFor(0)).toEqual(resolveRoster('poland'));
    expect(loaded.unitIdFor(0, 'tank')).toBe('spearhead');
    expect(loaded.state.entities.some((e) => e.owner === 0 && e.defId === 'spearhead')).toBe(true);
    expect(loaded.stateHash()).toBe(game.stateHash());
  });

  it('keeps national battles deterministic across identical saves', () => {
    const make = () => {
      const scenario = arena('russia', 'uk');
      scenario.units.push(
        { defId: 'heavyHowitzer', owner: 0, x: 10, z: 20 },
        { defId: 'mlrs', owner: 1, x: 34, z: 20 },
      );
      const game = new Game(scenario, { enableAI: false });
      const target = game.state.entities.find((e) => e.owner === 1 && e.defId === 'commandPost')!;
      const artillery = unit(game, 'heavyHowitzer');
      game.enqueueCommand({ type: 'attack', team: 0, ids: [artillery.id], targetId: target.id });
      game.advance(20 * 20);
      return game.stateHash();
    };
    expect(make()).toBe(make());
    // Both rosters resolve from the same shared baseline and remain valid.
    for (const nation of NATION_LIST) {
      const roster = resolveRoster(nation.id);
      expect(roster.units.length).toBe(UNIT_LIST.length);
      expect(roster.buildings.length).toBe(BUILDING_LIST.length);
      expect(defaultOpponentNation(nation.id).allianceId).not.toBe(nation.allianceId);
    }
  });
});
