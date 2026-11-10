import { describe, expect, it } from 'vitest';
import { createEmptyScenario } from '../src/data/scenarios';
import { UNITS } from '../src/data/units';
import { AIController, initialAIState } from '../src/sim/ai';
import { TICK_RATE, TILE_SIZE } from '../src/sim/constants';
import { Game } from '../src/sim/game';
import { Terrain, tileIndex } from '../src/sim/terrain';
import {
  coastalStagingPoint,
  lineCrossesWater,
  transportDemand,
  transportKindOf,
} from '../src/sim/transportAI';
import type { AIControlState, Entity } from '../src/sim/types';

type UnitSpawn = { defId: string; owner: number; x: number; z: number };
type StructureSpawn = { defId: string; owner: number; x: number; z: number };

/**
 * Two landmasses divided by a navigable strait.
 *
 * Deep water runs from x=18 to x=23, with shallow water on both lips, so a
 * landing craft has a real beach on either side and infantry on foot cannot
 * cross. The AI base sits on the eastern shore and the objective on the western
 * one, which is exactly the situation a transport is for.
 */
function straitGame(units: UnitSpawn[] = [], structures: StructureSpawn[] = []): Game {
  const scenario = createEmptyScenario(48, 40);
  scenario.settings.startingMats = 50_000;
  scenario.settings.startingReq = 50_000;
  scenario.settings.fog = false;
  scenario.players[0].factionId = 'lithuania';
  scenario.players[1].factionId = 'russia';
  scenario.players[0].startX = 2;
  scenario.players[0].startZ = 20;
  scenario.players[1].startX = 34;
  scenario.players[1].startZ = 20;
  for (let z = 0; z < scenario.height; z++) {
    for (let x = 0; x < scenario.width; x++) {
      const idx = tileIndex(scenario.width, x, z);
      scenario.tiles[idx].t =
        x >= 18 && x < 24
          ? Terrain.DeepWater
          : x === 18 || x === 24
            ? Terrain.ShallowWater
            : Terrain.Grass;
    }
  }
  // The two headquarters stand outside the AI's 34-tile threat radius: an
  // enemy command post on the horizon is a strategic target, not a raid, and a
  // commander under threat rightly defers transport work.
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 2, z: 20 },
    { defId: 'commandPost', owner: 1, x: 40, z: 20 },
    ...structures,
  ];
  scenario.units = units;
  const game = new Game(scenario, { enableAI: false });
  game.player(1)!.mats = 50_000;
  game.player(1)!.req = 50_000;
  return game;
}

function flatGame(units: UnitSpawn[] = []): Game {
  const scenario = createEmptyScenario(60, 40);
  scenario.settings.fog = false;
  scenario.settings.startingMats = 50_000;
  scenario.settings.startingReq = 50_000;
  scenario.players[1].startX = 46;
  scenario.players[1].startZ = 20;
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 4, z: 20 },
    { defId: 'commandPost', owner: 1, x: 50, z: 20 },
  ];
  scenario.units = units;
  const game = new Game(scenario, { enableAI: false });
  game.player(1)!.mats = 50_000;
  game.player(1)!.req = 50_000;
  return game;
}

function target(state: AIControlState, game: Game, tileX: number, tileZ: number): void {
  state.targetKnown = true;
  state.targetBaseX = (tileX + 0.5) * TILE_SIZE;
  state.targetBaseZ = (tileZ + 0.5) * TILE_SIZE;
  state.lastContactTick = game.state.tick;
}

/**
 * Run the commander the way the battle loop does: one think per simulated
 * second, and a re-stated contact so the target does not decay during a test.
 */
function runAI(
  game: Game,
  state: AIControlState,
  seconds: number,
  until?: () => boolean,
): boolean {
  const controller = new AIController();
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    if (until?.()) return true;
    if (game.state.tick % 20 === 0) {
      state.targetKnown = true;
      state.lastContactTick = game.state.tick;
      controller.update(game, 1, state);
    }
    game.advance(1);
  }
  return until?.() === true;
}

function aiUnit(game: Game, defId: string): Entity | undefined {
  return game.entitiesOf(1, 'unit').find((e) => e.defId === defId);
}

describe('transport planning', () => {
  it('classifies each carrier by arm and leaves every other unit alone', () => {
    expect(transportKindOf('apc')).toBe('land');
    expect(transportKindOf('transportHelo')).toBe('air');
    expect(transportKindOf('landingCraft')).toBe('naval');
    expect(transportKindOf('tank')).toBeNull();
    expect(transportKindOf('rifle')).toBeNull();
  });

  it('reads separation from the existing terrain grid', () => {
    const map = straitGame().state.map;
    expect(lineCrossesWater(map, 34 * TILE_SIZE, 20 * TILE_SIZE, 4 * TILE_SIZE, 20 * TILE_SIZE)).toBe(
      true,
    );
    expect(lineCrossesWater(map, 30 * TILE_SIZE, 20 * TILE_SIZE, 40 * TILE_SIZE, 20 * TILE_SIZE)).toBe(
      false,
    );
  });

  it('finds a foot-standable shore tile on both coasts', () => {
    const map = straitGame().state.map;
    const east = coastalStagingPoint(map, 30 * TILE_SIZE, 20 * TILE_SIZE, 14);
    const west = coastalStagingPoint(map, 4 * TILE_SIZE, 20 * TILE_SIZE, 26);
    expect(east).not.toBeNull();
    expect(west).not.toBeNull();
    // Deep water is never a staging point: both shores are dry ground.
    expect(Math.floor(east!.x / TILE_SIZE)).toBe(25);
    expect(Math.floor(west!.x / TILE_SIZE)).toBe(17);
  });

  it('asks for a landing craft only when water actually separates the objective', () => {
    const game = straitGame();
    const base = {
      tick: 20 * 200,
      map: game.state.map,
      baseX: 34 * TILE_SIZE,
      baseZ: 20 * TILE_SIZE,
      targetKnown: true,
      targetX: 4 * TILE_SIZE,
      targetZ: 20 * TILE_SIZE,
      hasWater: true,
      counts: { shipyard: 1, heliport: 0, airfield: 0, factory: 0, barracks: 0 },
      infantry: 3,
      transports: { land: 0, air: 0, naval: 0 },
      combat: 4,
      ticksSinceTransport: 20 * 200,
    };
    expect(transportDemand(base).kind).toBe('naval');
    // No yard, no hull.
    expect(
      transportDemand({ ...base, counts: { ...base.counts, shipyard: 0 } }).kind,
    ).toBeNull();
    // An existing hull answers the need.
    expect(
      transportDemand({ ...base, transports: { land: 0, air: 0, naval: 1 } }).kind,
    ).toBeNull();
    // No objective, and not enough infantry, are both refusals.
    expect(transportDemand({ ...base, targetKnown: false }).kind).toBeNull();
    expect(transportDemand({ ...base, infantry: 2 }).kind).toBeNull();
    // A target on the same landmass is a walk, not an amphibious assault.
    expect(
      transportDemand({ ...base, targetX: 44 * TILE_SIZE, targetZ: 20 * TILE_SIZE }).kind,
    ).toBeNull();
    // And the same map with no water at all never produces a naval transport.
    expect(transportDemand({ ...base, hasWater: false }).kind).toBeNull();
  });

  it('keeps the cooldown, so a lost transport is not replaced instantly', () => {
    const game = straitGame();
    const decision = transportDemand({
      tick: 20 * 200,
      map: game.state.map,
      baseX: 34 * TILE_SIZE,
      baseZ: 20 * TILE_SIZE,
      targetKnown: true,
      targetX: 4 * TILE_SIZE,
      targetZ: 20 * TILE_SIZE,
      hasWater: true,
      counts: { shipyard: 1, heliport: 0, airfield: 0, factory: 0, barracks: 0 },
      infantry: 4,
      transports: { land: 0, air: 0, naval: 0 },
      combat: 5,
      ticksSinceTransport: 20 * 5,
    });
    expect(decision.kind).toBeNull();
  });
});

describe('amphibious operation lifecycle', () => {
  it('stages infantry, crosses the strait and lands them on the far shore', () => {
    const game = straitGame([
      { defId: 'landingCraft', owner: 1, x: 21, z: 14 },
      { defId: 'rifle', owner: 1, x: 28, z: 18 },
      { defId: 'rifle', owner: 1, x: 28, z: 20 },
      { defId: 'atgm', owner: 1, x: 28, z: 22 },
    ]);
    const state = initialAIState(4242, 'veteran');
    target(state, game, 4, 20);
    const craft = aiUnit(game, 'landingCraft')!;
    const squad = game
      .entitiesOf(1, 'unit')
      .filter((e) => e.defId !== 'landingCraft')
      .map((e) => e.id);

    const started = runAI(game, state, 90, () => (state.transportOps?.length ?? 0) > 0);
    expect(started).toBe(true);
    const op = state.transportOps![0];
    expect(op.kind).toBe('naval');
    expect(op.transportId).toBe(craft.id);

    const boarded = runAI(game, state, 120, () => game.containerOccupants(craft.id).length === 3);
    expect(boarded).toBe(true);

    const landed = runAI(
      game,
      state,
      300,
      () =>
        game.containerOccupants(craft.id).length === 0 &&
        squad.every((id) => {
          const unit = game.getEntity(id);
          return !!unit && unit.hp > 0 && !unit.garrisonId;
        }),
    );
    expect(landed).toBe(true);
    // One more think retires the finished operation.
    runAI(game, state, 3);
    // Every passenger survived the crossing and now stands on the western
    // landmass, which no infantryman can reach on foot.
    for (const id of squad) {
      const unit = game.getEntity(id)!;
      expect(unit.hp).toBeGreaterThan(0);
      expect(unit.x).toBeLessThan(18 * TILE_SIZE);
    }
    // The operation finished rather than lingering.
    expect(state.transportOps ?? []).toHaveLength(0);
  });

  it('kills every embarked passenger exactly once when the carrier is destroyed', () => {
    const game = straitGame([
      { defId: 'landingCraft', owner: 1, x: 21, z: 14 },
      { defId: 'rifle', owner: 1, x: 28, z: 18 },
      { defId: 'rifle', owner: 1, x: 28, z: 20 },
      { defId: 'rifle', owner: 1, x: 28, z: 22 },
    ]);
    const state = initialAIState(777, 'veteran');
    target(state, game, 4, 20);
    const started = runAI(game, state, 60, () => (state.transportOps?.length ?? 0) > 0);
    expect(started).toBe(true);
    const craft = aiUnit(game, 'landingCraft')!;
    const boarded = runAI(game, state, 120, () => game.containerOccupants(craft.id).length === 3);
    expect(boarded).toBe(true);
    const crew = game
      .entitiesOf(1, 'unit')
      .filter((e) => e.defId === 'rifle' || e.defId === 'atgm');
    expect(crew).toHaveLength(3);
    const losses = game.player(1)!.stats.unitsLost;
    craft.hp = 0;
    runAI(game, state, 4);
    // One destruction event, one loss per passenger, and no operation or
    // dangling reference left behind.
    expect(state.transportOps ?? []).toHaveLength(0);
    expect(game.getEntity(craft.id)).toBeUndefined();
    for (const unit of crew) expect(game.getEntity(unit.id)).toBeUndefined();
    expect(game.player(1)!.stats.unitsLost).toBe(losses + 3);
    expect(game.containerOccupants(craft.id)).toHaveLength(0);
  });

  it('never orders an attack with an unarmed transport', () => {
    const game = straitGame([
      { defId: 'landingCraft', owner: 1, x: 21, z: 14 },
      { defId: 'rifle', owner: 1, x: 28, z: 18 },
      { defId: 'rifle', owner: 1, x: 28, z: 20 },
    ]);
    const state = initialAIState(99, 'veteran');
    target(state, game, 4, 20);
    const craft = aiUnit(game, 'landingCraft')!;
    for (let i = 0; i < 20 * 60; i++) {
      if (game.state.tick % 20 === 0) {
        state.targetKnown = true;
        state.lastContactTick = game.state.tick;
        new AIController().update(game, 1, state);
      }
      game.advance(1);
      expect(craft.targetId).toBe(0);
    }
  });
});

describe('land transport operation', () => {
  it('uses an APC for a long advance and unloads onto open ground', () => {
    const game = flatGame([
      { defId: 'apc', owner: 1, x: 42, z: 20 },
      { defId: 'rifle', owner: 1, x: 42, z: 18 },
      { defId: 'rifle', owner: 1, x: 43, z: 20 },
      { defId: 'rifle', owner: 1, x: 42, z: 22 },
    ]);
    const state = initialAIState(1234, 'veteran');
    target(state, game, 6, 20);
    const apc = aiUnit(game, 'apc')!;
    const started = runAI(game, state, 60, () => (state.transportOps?.length ?? 0) > 0);
    expect(started).toBe(true);
    expect(state.transportOps![0].kind).toBe('land');
    const boarded = runAI(game, state, 90, () => game.containerOccupants(apc.id).length === 3);
    expect(boarded).toBe(true);
    const delivered = runAI(
      game,
      state,
      360,
      () =>
        game.containerOccupants(apc.id).length === 0 &&
        game.entitiesOf(1, 'unit').filter((e) => e.defId === 'rifle' && !e.garrisonId).length === 3,
    );
    expect(delivered).toBe(true);
    runAI(game, state, 3);
    expect(state.transportOps ?? []).toHaveLength(0);
  });

  it('does not load a squad that can simply walk to the objective', () => {
    const game = flatGame([
      { defId: 'apc', owner: 1, x: 42, z: 20 },
      { defId: 'rifle', owner: 1, x: 42, z: 18 },
      { defId: 'rifle', owner: 1, x: 43, z: 20 },
      { defId: 'rifle', owner: 1, x: 42, z: 22 },
    ]);
    const state = initialAIState(2468, 'veteran');
    // Six tiles away: an ordinary walk, so no operation is planned.
    target(state, game, 48, 20);
    runAI(game, state, 40);
    expect(state.transportOps ?? []).toHaveLength(0);
    expect(game.containerOccupants(aiUnit(game, 'apc')!.id)).toHaveLength(0);
  });
});

/** One think, without advancing the battle: exact geometry, no drift. */
function think(game: Game, state: AIControlState): void {
  state.nextThinkTick = 0;
  state.targetKnown = true;
  state.lastContactTick = game.state.tick;
  new AIController().update(game, 1, state);
}

/** A hostile placed mid-test, cloned from a real unit so every field is valid. */
function injectHostile(game: Game, defId: string, x: number, z: number): Entity {
  const template = game.state.entities.find((e) => e.kind === 'unit' && e.owner === 1)!;
  const def = UNITS[defId];
  const enemy: Entity = {
    ...template,
    id: 9000 + game.state.entities.length,
    owner: 0,
    defId,
    x,
    z,
    hp: def.hp,
    maxHp: def.hp,
    garrisonId: 0,
    targetId: 0,
  };
  game.state.entities.push(enemy);
  return enemy;
}

/** A naval operation that has already loaded three infantry and is under way. */
function loadedCrossing(seed = 4242) {
  const game = straitGame([
    { defId: 'landingCraft', owner: 1, x: 21, z: 14 },
    { defId: 'rifle', owner: 1, x: 28, z: 18 },
    { defId: 'rifle', owner: 1, x: 28, z: 20 },
    { defId: 'rifle', owner: 1, x: 28, z: 22 },
  ]);
  const state = initialAIState(seed, 'veteran');
  target(state, game, 4, 20);
  const craft = aiUnit(game, 'landingCraft')!;
  const started = runAI(game, state, 90, () => (state.transportOps?.length ?? 0) > 0);
  const boarded = runAI(game, state, 120, () => game.containerOccupants(craft.id).length === 3);
  return { game, state, craft, started, boarded };
}

describe('cancel and passenger recovery', () => {
  it('returns embarked infantry home when the carrier is damaged', () => {
    const { game, state, craft, started, boarded } = loadedCrossing();
    expect(started && boarded).toBe(true);
    craft.hp = craft.maxHp * 0.35;
    think(game, state);
    // The assault is abandoned, but the operation and its passengers remain
    // under command instead of being orphaned aboard an idle hull.
    expect(state.transportOps).toHaveLength(1);
    expect(state.transportOps![0].stage).toBe('recover');
    expect(game.containerOccupants(craft.id)).toHaveLength(3);

    const recovered = runAI(
      game,
      state,
      600,
      () =>
        game.containerOccupants(craft.id).length === 0 && (state.transportOps ?? []).length === 0,
    );
    expect(recovered).toBe(true);
    for (const unit of game.entitiesOf(1, 'unit').filter((e) => e.defId === 'rifle')) {
      expect(unit.hp).toBeGreaterThan(0);
      expect(unit.garrisonId).toBeFalsy();
    }
    // No passenger was lost to the abandoned assault.
    expect(game.player(1)!.stats.unitsLost).toBe(0);
  });

  it('removes an operation that never loaded anyone, without loss', () => {
    const game = straitGame([
      { defId: 'landingCraft', owner: 1, x: 21, z: 14 },
      { defId: 'rifle', owner: 1, x: 28, z: 18 },
      { defId: 'rifle', owner: 1, x: 28, z: 20 },
      { defId: 'rifle', owner: 1, x: 28, z: 22 },
    ]);
    const state = initialAIState(31337, 'veteran');
    target(state, game, 4, 20);
    const craft = aiUnit(game, 'landingCraft')!;
    expect(runAI(game, state, 60, () => (state.transportOps?.length ?? 0) > 0)).toBe(true);
    craft.hp = craft.maxHp * 0.2;
    think(game, state);
    expect(state.transportOps ?? []).toHaveLength(0);
    expect(game.containerOccupants(craft.id)).toHaveLength(0);
    expect(game.entitiesOf(1, 'unit').filter((e) => e.defId === 'rifle')).toHaveLength(3);
  });

  it('keeps a healthy carrier on its assault above the retreat threshold', () => {
    const { game, state, craft, started, boarded } = loadedCrossing(5150);
    expect(started && boarded).toBe(true);
    craft.hp = craft.maxHp * 0.36;
    think(game, state);
    expect(state.transportOps![0].stage).not.toBe('recover');
    expect(game.containerOccupants(craft.id)).toHaveLength(3);
  });
});

describe('threat assessment', () => {
  it('ignores an unarmed hostile near the carrier', () => {
    const { game, state, craft, started, boarded } = loadedCrossing(8080);
    expect(started && boarded).toBe(true);
    injectHostile(game, 'harvester', craft.x + 4 * TILE_SIZE, craft.z);
    think(game, state);
    expect(state.transportOps![0].stage).not.toBe('recover');
  });

  it('treats an armed hostile just inside nine tiles as a threat and outside it as none', () => {
    const far = loadedCrossing(9090);
    expect(far.started && far.boarded).toBe(true);
    injectHostile(far.game, 'rifle', far.craft.x + 9.5 * TILE_SIZE, far.craft.z);
    think(far.game, far.state);
    expect(far.state.transportOps![0].stage).not.toBe('recover');

    const near = loadedCrossing(9091);
    expect(near.started && near.boarded).toBe(true);
    injectHostile(near.game, 'rifle', near.craft.x + 8 * TILE_SIZE, near.craft.z);
    think(near.game, near.state);
    expect(near.state.transportOps![0].stage).toBe('recover');
    expect(near.game.containerOccupants(near.craft.id)).toHaveLength(3);
  });

  it('reassesses once the hostile is gone and can still deliver its passengers', () => {
    const { game, state, craft, started, boarded } = loadedCrossing(7070);
    expect(started && boarded).toBe(true);
    const enemy = injectHostile(game, 'rifle', craft.x + 6 * TILE_SIZE, craft.z);
    think(game, state);
    expect(state.transportOps![0].stage).toBe('recover');
    enemy.hp = 0;
    const recovered = runAI(
      game,
      state,
      600,
      () =>
        game.containerOccupants(craft.id).length === 0 && (state.transportOps ?? []).length === 0,
    );
    expect(recovered).toBe(true);
    expect(game.entitiesOf(1, 'unit').filter((e) => e.defId === 'rifle')).toHaveLength(3);
  });
});

describe('escort lifecycle', () => {
  it('escorts with a few units, not the army, and releases them afterwards', () => {
    const roster = [
      { defId: 'apc', owner: 1, x: 42, z: 20 },
      { defId: 'rifle', owner: 1, x: 42, z: 18 },
      { defId: 'rifle', owner: 1, x: 43, z: 20 },
      { defId: 'rifle', owner: 1, x: 42, z: 22 },
      { defId: 'tank', owner: 1, x: 39, z: 16 },
      { defId: 'tank', owner: 1, x: 38, z: 24 },
      { defId: 'tank', owner: 1, x: 37, z: 20 },
    ];
    const game = flatGame(roster);
    const state = initialAIState(6161, 'veteran');
    target(state, game, 6, 20);
    const apc = aiUnit(game, 'apc')!;
    expect(runAI(game, state, 60, () => (state.transportOps?.length ?? 0) > 0)).toBe(true);
    expect(runAI(game, state, 90, () => game.containerOccupants(apc.id).length === 3)).toBe(true);
    // Let the boarding complete and the operation enter its transit stage.
    runAI(game, state, 3);
    const op = state.transportOps![0];
    expect(op.stage).toBe('transit');
    // The transit move is re-issued every five seconds; make this the think that
    // is due one, at the start of a ten-second escort window, then execute the
    // queued orders with a single tick so nothing can overwrite them.
    runAI(game, state, 10, () => game.state.tick % 200 === 0);
    op.lastOrderTick = 0;
    think(game, state);
    game.advance(1);
    const tanks = game.entitiesOf(1, 'unit').filter((e) => e.defId === 'tank');
    const escorting = tanks.filter((tank) => {
      return tank.order?.type === 'attackMove';
    });
    expect(escorting).toHaveLength(2);
    // Two hulls guard the route; the rest of the armour keeps its own work.
    expect(tanks.length - escorting.length).toBeGreaterThanOrEqual(1);

    const delivered = runAI(
      game,
      state,
      360,
      () => game.containerOccupants(apc.id).length === 0 && (state.transportOps ?? []).length === 0,
    );
    expect(delivered).toBe(true);
    // Escorts are ordinary entities again: none is left harnessed to a stale
    // operation, and none is stranded inside a container.
    for (const tank of game.entitiesOf(1, 'unit').filter((e) => e.defId === 'tank')) {
      expect(tank.garrisonId).toBeFalsy();
      expect(tank.hp).toBeGreaterThan(0);
    }
    expect(state.transportOps ?? []).toHaveLength(0);
  });
});

describe('helicopter operation lifecycle', () => {
  function heloGame(): Game {
    const game = flatGame([
      { defId: 'transportHelo', owner: 1, x: 42, z: 20 },
      { defId: 'rifle', owner: 1, x: 42, z: 18 },
      { defId: 'rifle', owner: 1, x: 43, z: 20 },
      { defId: 'rifle', owner: 1, x: 42, z: 22 },
    ]);
    return game;
  }

  it('flies an assault squad end to end and lands the infantry on the objective', () => {
    const game = heloGame();
    const state = initialAIState(3456, 'veteran');
    target(state, game, 6, 20);
    const helo = aiUnit(game, 'transportHelo')!;
    expect(helo.aircraft?.landed).toBe(true);
    expect(runAI(game, state, 60, () => (state.transportOps?.length ?? 0) > 0)).toBe(true);
    expect(state.transportOps![0].kind).toBe('air');
    const boarded = runAI(game, state, 90, () => game.containerOccupants(helo.id).length === 3);
    expect(boarded).toBe(true);
    // Boarding is only legal on the ground; the hull is still landed here.
    expect(helo.aircraft?.landed).toBe(true);

    const delivered = runAI(
      game,
      state,
      420,
      () =>
        game.containerOccupants(helo.id).length === 0 && (state.transportOps ?? []).length === 0,
    );
    expect(delivered).toBe(true);
    for (const unit of game.entitiesOf(1, 'unit').filter((e) => e.defId === 'rifle')) {
      expect(unit.hp).toBeGreaterThan(0);
      expect(unit.garrisonId).toBeFalsy();
      // Delivered to the western end of the map, not walked there.
      expect(unit.x).toBeLessThan(20 * TILE_SIZE);
    }
    // The hull flies home and lands there, then is free for its next task.
    expect(runAI(game, state, 300, () => helo.aircraft?.landed === true)).toBe(true);
    expect(helo.garrisonId).toBeFalsy();
  });

  it('keeps a temporary field landing out of the aircraft berth state', () => {
    const game = heloGame();
    const state = initialAIState(3457, 'veteran');
    target(state, game, 6, 20);
    const helo = aiUnit(game, 'transportHelo')!;
    runAI(game, state, 60, () => (state.transportOps?.length ?? 0) > 0);
    runAI(game, state, 90, () => game.containerOccupants(helo.id).length === 3);
    runAI(game, state, 240, () => helo.aircraft?.fieldLanding !== undefined);
    // A field landing is temporary recovery, never a home berth: the state is
    // held on the aircraft, and the hull is still free of any building slot.
    expect(helo.aircraft?.fieldLanding).toBeDefined();
    expect(helo.aircraft?.landed).toBe(true);
  });
});

describe('operation persistence', () => {
  it('restores an operation with its passengers aboard after a save', () => {
    const { game, state, started, boarded } = loadedCrossing(2024);
    expect(started && boarded).toBe(true);
    // One think turns the completed boarding into the transit stage.
    runAI(game, state, 3);
    game.state.ai = state;
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    const op = restored.state.ai.transportOps?.[0];
    expect(op).toBeDefined();
    expect(op!.stage).toBe('transit');
    expect(op!.passengerIds).toHaveLength(3);
    const restoredCraft = restored.state.entities.find((e) => e.defId === 'landingCraft')!;
    expect(restored.containerOccupants(restoredCraft.id)).toHaveLength(3);
  });

  it('restores a recovery in progress and still lands its passengers', () => {
    const { game, state, craft, started, boarded } = loadedCrossing(2025);
    expect(started && boarded).toBe(true);
    craft.hp = craft.maxHp * 0.3;
    think(game, state);
    game.state.ai = state;
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(restored.state.ai.transportOps?.[0]?.stage).toBe('recover');
    const restoredState = restored.state.ai;
    const restoredCraft = restored.state.entities.find((e) => e.defId === 'landingCraft')!;
    const recovered = runAI(
      restored,
      restoredState,
      600,
      () =>
        restored.containerOccupants(restoredCraft.id).length === 0 &&
        (restoredState.transportOps ?? []).length === 0,
    );
    expect(recovered).toBe(true);
    expect(restored.entitiesOf(1, 'unit').filter((e) => e.defId === 'rifle')).toHaveLength(3);
  });
});
