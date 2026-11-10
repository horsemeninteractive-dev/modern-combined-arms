import { describe, expect, it } from 'vitest';
import { ALLIANCES } from '../src/data/factions';
import { UNITS } from '../src/data/units';
import { requiredTechnologiesForUnit } from '../src/data/research';
import { createEmptyScenario } from '../src/data/scenarios';
import { CommandGate } from '../src/multiplayer/commandGate';
import { createTeamSnapshot } from '../src/multiplayer/projection';
import { Game } from '../src/sim/game';
import { TICK_RATE, TILE_SIZE } from '../src/sim/constants';
import {
  containerAllowsPassengerFire,
  containerBoardingReady,
  containerFiringSlots,
  containerRequiresBeaching,
} from '../src/sim/containers';
import { canStandOn, Terrain, tileIndex } from '../src/sim/terrain';
import type { Entity } from '../src/sim/types';
import { completeResearch, harbourWith } from './helpers';
import { twoSeats } from './phase1-helpers';

type UnitSpawn = { defId: string; owner: number; x: number; z: number };
type StructureSpawn = { defId: string; owner: number; x: number; z: number };

function coastalGame(extra: UnitSpawn[] = [], structures: StructureSpawn[] = []): Game {
  const scenario = createEmptyScenario(48, 40);
  scenario.settings.startingMats = 20_000;
  scenario.settings.startingReq = 20_000;
  scenario.settings.fog = false;
  scenario.players[0].factionId = 'lithuania';
  scenario.players[1].factionId = 'russia';
  scenario.players[0].startX = 12;
  scenario.players[0].startZ = 20;
  scenario.players[1].startX = 44;
  scenario.players[1].startZ = 36;
  // A straight coast: deep water west of the beach, shallow water at x=8 and
  // dry, walkable land from x=9 eastward.
  for (let z = 0; z < scenario.height; z++) {
    for (let x = 0; x < scenario.width; x++) {
      scenario.tiles[tileIndex(scenario.width, x, z)].t = x < 8
        ? Terrain.DeepWater
        : x === 8
          ? Terrain.ShallowWater
          : Terrain.Grass;
    }
  }
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 20, z: 20 },
    { defId: 'commandPost', owner: 1, x: 44, z: 36 },
    ...structures,
  ];
  scenario.units = [{ defId: 'landingCraft', owner: 0, x: 6, z: 20 }, ...extra];
  const game = new Game(scenario, { enableAI: false });
  game.player(0)!.mats = 20_000;
  game.player(0)!.req = 20_000;
  return game;
}

function unit(game: Game, defId: string, owner = 0): Entity {
  return game.entitiesOf(owner, 'unit').find((e) => e.defId === defId)!;
}

function rifles(game: Game, owner = 0): Entity[] {
  return game.entitiesOf(owner, 'unit')
    .filter((e) => e.defId === 'rifle')
    .sort((a, b) => a.id - b.id);
}

function board(game: Game, craft: Entity, passengers: Entity[], team = 0): void {
  game.enqueueCommand({
    type: 'garrison',
    team,
    ids: passengers.map((passenger) => passenger.id),
    targetId: craft.id,
  });
}

function until(game: Game, seconds: number, predicate: () => boolean): boolean {
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    if (predicate()) return true;
    game.advance(1);
  }
  return predicate();
}

function loadedGame(count = 4): { game: Game; craft: Entity; passengers: Entity[] } {
  const game = coastalGame(
    Array.from({ length: count }, (_, i) => ({
      defId: i % 2 === 0 ? 'rifle' : 'atgm',
      owner: 0,
      x: 11 + (i % 2),
      z: 19 + i,
    })),
  );
  const craft = unit(game, 'landingCraft');
  const passengers = game.entitiesOf(0, 'unit')
    .filter((e) => e.defId !== 'landingCraft')
    .sort((a, b) => a.id - b.id);
  board(game, craft, passengers);
  const boarded = until(game, 45, () => game.containerOccupants(craft.id).length === count);
  expect(boarded).toBe(true);
  expect(containerBoardingReady(craft)).toBe(true);
  return { game, craft, passengers };
}

describe('naval landing craft registry, roster and production', () => {
  it('is a shared, unarmed, four-seat naval container in both alliance baselines', () => {
    const def = UNITS.landingCraft;
    expect(def).toBeDefined();
    expect(def.domain).toBe('naval');
    expect(def.moveClass).toBe('naval');
    expect(def.weapons).toEqual([]);
    expect(def.transport).toMatchObject({
      capacity: 4,
      mobile: true,
      onDestroyed: 'kill',
      canFireEmbarked: false,
      firingSlots: 0,
      passenger: 'infantry',
    });
    expect(def.hp).toBeGreaterThan(UNITS.apc.hp);
    expect(def.hp).toBeLessThan(UNITS.corvette.hp);
    expect(def.cost.mats).toBeGreaterThan(UNITS.apc.cost.mats);
    expect(def.buildTime).toBeGreaterThan(UNITS.apc.buildTime);
    expect(ALLIANCES.defender.baseline.units).toContain('landingCraft');
    expect(ALLIANCES.eastern.baseline.units).toContain('landingCraft');
    expect(requiredTechnologiesForUnit('landingCraft').map((tech) => tech.id)).toContain('naval1');
  });

  it('builds at the shared and national shipyards for both alliances', () => {
    for (const faction of ['lithuania', 'russia'] as const) {
      const game = new Game(harbourWith(faction), { enableAI: false });
      completeResearch(game, 0);
      const yard = game.entitiesOf(0, 'building').find((e) => e.defId === 'shipyard')!;
      expect(game.productionEntries(0, 'shipyard'), faction).toContain('landingCraft');
      expect(game.productionStatus(0, yard.id, 'landingCraft').ok, faction).toBe(true);
    }
    const sweden = new Game(harbourWith('sweden'), { enableAI: false });
    completeResearch(sweden, 0);
    const yard = sweden.entitiesOf(0, 'building').find((e) => e.defId === 'shipyard')!;
    expect(sweden.productionEntries(0, 'kockumsYard')).toContain('landingCraft');
    expect(sweden.productionStatus(0, yard.id, 'landingCraft').ok).toBe(true);
  });

  it('produces a hull only into navigable water', () => {
    const game = new Game(harbourWith('lithuania'), { enableAI: false });
    completeResearch(game, 0);
    game.player(0)!.mats = 20_000;
    game.player(0)!.req = 20_000;
    const yard = game.entitiesOf(0, 'building').find((e) => e.defId === 'shipyard')!;
    const before = new Set(game.entitiesOf(0, 'unit').map((e) => e.id));
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: yard.id, defId: 'landingCraft' });
    const launched = until(game, 60, () =>
      game.entitiesOf(0, 'unit').some((e) => e.defId === 'landingCraft' && !before.has(e.id)),
    );
    expect(launched).toBe(true);
    const craft = game.entitiesOf(0, 'unit').find((e) => e.defId === 'landingCraft' && !before.has(e.id))!;
    const idx = tileIndex(
      game.state.map.width,
      Math.floor(craft.x / TILE_SIZE),
      Math.floor(craft.z / TILE_SIZE),
    );
    expect([Terrain.DeepWater, Terrain.ShallowWater]).toContain(game.state.map.terrain[idx]);
  });
});

describe('naval landing craft embarkation', () => {
  it('beaches itself, boards four independent infantry and rejects ineligible cargo', () => {
    const game = coastalGame([
      ...Array.from({ length: 5 }, (_, i) => ({
        defId: 'rifle' as const,
        owner: 0,
        x: 11 + (i % 2),
        z: 18 + i,
      })),
      { defId: 'tank', owner: 0, x: 13, z: 25 },
      { defId: 'engineer', owner: 0, x: 14, z: 25 },
      { defId: 'apc', owner: 0, x: 15, z: 25 },
    ]);
    const craft = unit(game, 'landingCraft');
    const all = rifles(game);
    board(game, craft, [...all, unit(game, 'tank'), unit(game, 'engineer'), unit(game, 'apc')]);
    const boarded = until(game, 45, () => game.containerOccupants(craft.id).length === 4);
    expect(boarded).toBe(true);
    expect(craft.navalLanding?.beached).toBe(true);
    expect(containerRequiresBeaching(craft)).toBe(true);
    expect(game.containerOccupants(craft.id).map((e) => e.id)).toEqual(
      all.slice(0, 4).map((e) => e.id),
    );
    expect(all[4].garrisonId).toBe(0);
    expect(unit(game, 'tank').garrisonId).toBe(0);
    expect(unit(game, 'engineer').garrisonId).toBe(0);
    expect(unit(game, 'apc').garrisonId).toBe(0);
    expect(containerFiringSlots(craft)).toBe(0);
    expect(containerAllowsPassengerFire(craft)).toBe(false);
  });

  it('allows allied infantry to board without changing ownership', () => {
    const scenario = createEmptyScenario(48, 40);
    scenario.settings.fog = false;
    for (let z = 0; z < scenario.height; z++) {
      for (let x = 0; x < scenario.width; x++) {
        scenario.tiles[tileIndex(scenario.width, x, z)].t = x < 8
          ? Terrain.DeepWater
          : x === 8
            ? Terrain.ShallowWater
            : Terrain.Grass;
      }
    }
    scenario.players.push({
      ...scenario.players[0],
      id: 2,
      name: 'Allied Task Force',
      startX: 12,
      startZ: 18,
    });
    scenario.units = [
      { defId: 'landingCraft', owner: 0, x: 6, z: 20 },
      { defId: 'rifle', owner: 2, x: 11, z: 20 },
    ];
    scenario.structures = [
      { defId: 'commandPost', owner: 0, x: 20, z: 20 },
      { defId: 'commandPost', owner: 1, x: 44, z: 36 },
    ];
    const game = new Game(scenario, { enableAI: false });
    const craft = unit(game, 'landingCraft');
    // An allied carrier is already at the shore: its owner controls movement,
    // so the ally cannot order it to beach itself.
    craft.x = 8.5 * TILE_SIZE;
    craft.z = 20.5 * TILE_SIZE;
    craft.navalLanding = { x: craft.x, z: craft.z, purpose: 'idle', beached: true };
    const ally = game.entitiesOf(2, 'unit').find((e) => e.defId === 'rifle')!;
    board(game, craft, [ally], 2);
    expect(until(game, 45, () => ally.garrisonId === craft.id)).toBe(true);
    expect(ally.owner).toBe(2);

    // The carrier owner opens the carrier-wide transaction; the allied
    // passenger keeps its original ownership when it steps ashore.
    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [craft.id] });
    expect(until(game, 10, () => ally.garrisonId === 0)).toBe(true);
    expect(ally.owner).toBe(2);
  });

  it('rejects enemy boarding and infantry without a reachable shore', () => {
    const enemyGame = coastalGame([{ defId: 'rifle', owner: 1, x: 11, z: 20 }]);
    const enemyCraft = unit(enemyGame, 'landingCraft');
    const enemy = unit(enemyGame, 'rifle', 1);
    board(enemyGame, enemyCraft, [enemy], 1);
    enemyGame.advance(4);
    expect(enemy.garrisonId).toBe(0);
    expect(enemyGame.state.events.some((e) => /transport from your side/i.test(e.text))).toBe(true);

    const dry = coastalGame([{ defId: 'rifle', owner: 0, x: 11, z: 20 }]);
    for (let i = 0; i < dry.state.map.terrain.length; i++) {
      dry.state.map.terrain[i] = Terrain.DeepWater;
    }
    const dryCraft = unit(dry, 'landingCraft');
    const rifle = unit(dry, 'rifle');
    board(dry, dryCraft, [rifle]);
    dry.tick();
    expect(rifle.garrisonId).toBe(0);
    expect(dryCraft.navalLanding).toBeUndefined();
    expect(dry.state.events.some((e) => /No usable beach/.test(e.text))).toBe(true);
  });
});

describe('naval movement and beaching', () => {
  it('carries passengers over navigable water and unloads onto distinct land tiles', () => {
    const { game, craft, passengers } = loadedGame(4);
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [craft.id],
      x: 4 * TILE_SIZE,
      z: 20 * TILE_SIZE,
    });
    game.advance(TICK_RATE * 6);
    expect(craft.x / TILE_SIZE).toBeLessThan(8);
    for (const passenger of passengers) {
      expect(passenger.garrisonId).toBe(craft.id);
      expect(passenger.x).toBe(craft.x);
      expect(passenger.z).toBe(craft.z);
    }

    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [craft.id] });
    const unloaded = until(game, 30, () => game.containerOccupants(craft.id).length === 0);
    expect(unloaded).toBe(true);
    expect(craft.navalLanding?.beached).toBe(true);
    const positions = new Set(passengers.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`));
    expect(positions.size).toBe(4);
    for (const passenger of passengers) {
      expect(passenger.garrisonId).toBe(0);
      const tx = Math.floor(passenger.x / TILE_SIZE);
      const tz = Math.floor(passenger.z / TILE_SIZE);
      expect(game.state.map.terrain[tileIndex(game.state.map.width, tx, tz)]).not.toBe(
        Terrain.DeepWater,
      );
      expect(
        canStandOn(
          game.state.map.width,
          game.state.map.height,
          game.state.map.terrain,
          tileIndex(game.state.map.width, tx, tz),
          'foot',
        ),
      ).toBe(true);
    }

    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [craft.id],
      x: 3 * TILE_SIZE,
      z: 20 * TILE_SIZE,
    });
    game.advance(TICK_RATE * 5);
    expect(craft.navalLanding).toBeUndefined();
    expect(craft.x / TILE_SIZE).toBeLessThan(6);
  });

  it('keeps every passenger aboard when no safe beach or exit exists', () => {
    const { game, craft, passengers } = loadedGame(2);
    for (let i = 0; i < game.state.map.terrain.length; i++) {
      game.state.map.terrain[i] = Terrain.DeepWater;
    }
    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [craft.id] });
    game.advance(TICK_RATE * 3);
    expect(game.containerOccupants(craft.id)).toHaveLength(2);
    for (const passenger of passengers) expect(passenger.garrisonId).toBe(craft.id);
    expect(game.state.events.some((e) => /No usable beach|No safe exit/.test(e.text))).toBe(true);
  });
});

describe('naval landing craft lifecycle and authority', () => {
  it('kills every passenger exactly once when the carrier is destroyed', () => {
    const { game, craft, passengers } = loadedGame(3);
    const lost = game.player(0)!.stats.unitsLost;
    craft.hp = 0;
    game.advance(TICK_RATE * 4);
    expect(game.getEntity(craft.id)).toBeUndefined();
    for (const passenger of passengers) expect(game.getEntity(passenger.id)).toBeUndefined();
    expect(game.player(0)!.stats.unitsLost).toBe(lost + 3);
    expect(game.containerOccupants(craft.id)).toHaveLength(0);
    game.advance(TICK_RATE * 4);
    expect(game.player(0)!.stats.unitsLost).toBe(lost + 3);
  });

  it('preserves occupancy, ownership, health and veterancy through save/load', () => {
    const { game, passengers } = loadedGame(2);
    passengers[0].hp = 41;
    passengers[0].xp = 180;
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), {
      enableAI: false,
    });
    const restoredCraft = restored.state.entities.find((e) => e.defId === 'landingCraft')!;
    const restoredInside = restored.containerOccupants(restoredCraft.id);
    expect(restoredInside.map((e) => e.id)).toEqual(passengers.map((e) => e.id));
    expect(restoredCraft.navalLanding?.beached).toBe(true);
    expect(restoredInside.every((e) => e.garrisonId === restoredCraft.id)).toBe(true);
    expect(restoredInside[0].hp).toBe(41);
    expect(restoredInside[0].xp).toBe(180);
    expect(() => restored.assertContainerIntegrity()).not.toThrow();
  });

  it('keeps passenger identities private from the enemy and validates unloading server-side', () => {
    const { game, craft, passengers } = loadedGame(3);
    const enemyView = createTeamSnapshot(game, 1);
    const ownView = createTeamSnapshot(game, 0);
    expect(enemyView.entities.some((e) => e.id === craft.id)).toBe(true);
    for (const passenger of passengers) {
      expect(enemyView.entities.some((e) => e.id === passenger.id)).toBe(false);
      expect(ownView.entities.some((e) => e.id === passenger.id)).toBe(true);
    }
    expect(enemyView.entities.find((e) => e.id === craft.id)?.navalLanding?.beached).toBe(true);

    const gate = new CommandGate(game, twoSeats());
    const steal = gate.submit(1, { v: 1, command: { type: 'ungarrison', ids: [craft.id] } }, 100);
    expect(steal.ok).toBe(false);
    if (!steal.ok) expect(steal.code).toBe('not-your-entity');
    const own = gate.submit(0, { v: 1, command: { type: 'ungarrison', ids: [craft.id] } }, 200);
    expect(own.ok).toBe(true);
  });
});
