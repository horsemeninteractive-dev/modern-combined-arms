import { describe, expect, it } from 'vitest';
import { ALLIANCES } from '../src/data/factions';
import { UNITS } from '../src/data/units';
import { RESEARCH, requiredTechnologiesForUnit, type ResearchCatalog, type UnitUpgradeDef } from '../src/data/research';
import { createEmptyScenario } from '../src/data/scenarios';
import { CommandGate } from '../src/multiplayer/commandGate';
import { createTeamSnapshot } from '../src/multiplayer/projection';
import { Game } from '../src/sim/game';
import { TICK_RATE, TILE_SIZE } from '../src/sim/constants';
import {
  containerAcceptsPassenger,
  containerAllowsPassengerFire,
  containerBoardingReady,
  containerFiringSlots,
  containerRequiresLanding,
} from '../src/sim/containers';
import { canStandOn, Terrain, tileIndex } from '../src/sim/terrain';
import { contextOrderFor, isTransportTarget } from '../src/ui/orderIntent';
import type { Entity } from '../src/sim/types';
import { completeResearch } from './helpers';
import { twoSeats } from './phase1-helpers';

type UnitSpawn = { defId: string; owner: number; x: number; z: number };
type StructureSpawn = { defId: string; owner: number; x: number; z: number };

function scenarioWith(
  units: UnitSpawn[] = [],
  structures: StructureSpawn[] = [],
  factions: [string, string] = ['lithuania', 'russia'],
  researched = true,
  research?: ResearchCatalog,
  teamOne = 1,
): Game {
  const scenario = createEmptyScenario(64, 64);
  scenario.settings.startingMats = 6_000;
  scenario.settings.startingReq = 2_000;
  scenario.settings.fog = false;
  scenario.players[0].factionId = factions[0];
  scenario.players[1].factionId = factions[1];
  scenario.players[1].team = teamOne;
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].startX = 54;
  scenario.players[1].startZ = 54;
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'commandPost', owner: 1, x: 60, z: 60 },
    ...structures,
  ];
  scenario.units = units;
  const game = new Game(scenario, { enableAI: false, ...(research ? { research } : {}) });
  if (researched) completeResearch(game, 0);
  game.player(0)!.mats = 20_000;
  game.player(0)!.req = 20_000;
  return game;
}

function heloGame(
  extra: UnitSpawn[] = [],
  research?: ResearchCatalog,
  teamOne = 1,
): Game {
  return scenarioWith(
    [{ defId: 'transportHelo', owner: 0, x: 12, z: 12 }, ...extra],
    [{ defId: 'heliport', owner: 0, x: 12, z: 12 }],
    ['lithuania', 'russia'],
    true,
    research,
    teamOne,
  );
}

function unit(game: Game, defId: string, owner = 0): Entity {
  return game.entitiesOf(owner, 'unit').find((e) => e.defId === defId)!;
}

function units(game: Game, defId: string, owner = 0): Entity[] {
  return game.entitiesOf(owner, 'unit')
    .filter((e) => e.defId === defId)
    .sort((a, b) => a.id - b.id);
}

function board(game: Game, helo: Entity, passengers: Entity[], owner = 0): void {
  game.enqueueCommand({
    type: 'garrison',
    team: owner,
    ids: passengers.map((p) => p.id),
    targetId: helo.id,
  });
}

/** Advance whole seconds until the predicate holds or the budget runs out. */
function until(game: Game, seconds: number, predicate: () => boolean): boolean {
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    if (predicate()) return true;
    game.advance(1);
  }
  return predicate();
}

function loadedGame(
  count = 4,
  research?: ResearchCatalog,
): { game: Game; helo: Entity; passengers: Entity[] } {
  const game = heloGame(
    Array.from({ length: count }, (_, i) => ({
      defId: i % 2 === 0 ? 'rifle' : 'atgm',
      owner: 0,
      x: 27 + (i % 2),
      z: 28 + i,
    })),
    research,
  );
  const helo = unit(game, 'transportHelo');
  const passengers = game.entitiesOf(0, 'unit').filter((e) => e.defId !== 'transportHelo');
  board(game, helo, passengers);
  const boarded = until(game, 40, () => game.containerOccupants(helo.id).length === count);
  expect(boarded).toBe(true);
  expect(helo.aircraft?.landed).toBe(true);
  expect(helo.aircraft?.roll).toBeUndefined();
  return { game, helo, passengers };
}

describe('transport helicopter registry and production', () => {
  it('is a shared, unarmed, four-seat air-domain container', () => {
    const def = UNITS.transportHelo;
    expect(def).toBeDefined();
    expect(def.domain).toBe('air');
    expect(def.moveClass).toBe('air');
    expect(def.rotary).toBe(true);
    expect(def.weapons).toEqual([]);
    expect(def.transport).toMatchObject({
      capacity: 4,
      mobile: true,
      onDestroyed: 'kill',
      canFireEmbarked: false,
      firingSlots: 0,
      passenger: 'infantry',
    });
    expect(def.speed).toBeGreaterThan(UNITS.apc.speed);
    expect(def.speed).toBeLessThan(UNITS.attackHelo.speed);
    expect(def.cost.mats).toBeGreaterThan(UNITS.apc.cost.mats);
    expect(def.hp).toBeLessThan(UNITS.apc.hp);
    expect(def.hp).toBeLessThan(UNITS.attackHelo.hp);
    expect(ALLIANCES.defender.baseline.units).toContain('transportHelo');
    expect(ALLIANCES.eastern.baseline.units).toContain('transportHelo');
  });

  it('is built by the heliport for both alliances under the existing rotary unlock', () => {
    const heliport: StructureSpawn = { defId: 'heliport', owner: 0, x: 24, z: 24 };
    for (const faction of ['lithuania', 'russia'] as const) {
      const game = scenarioWith([], [heliport], [faction, faction === 'russia' ? 'lithuania' : 'russia']);
      const port = game.entitiesOf(0, 'building').find((e) => e.defId === 'heliport')!;
      expect(game.productionEntries(0, 'heliport')).toContain('transportHelo');
      expect(game.productionStatus(0, port.id, 'transportHelo').ok, faction).toBe(true);
    }
    const locked = scenarioWith([], [heliport], ['lithuania', 'russia'], false);
    const lockedPort = locked.entitiesOf(0, 'building').find((e) => e.defId === 'heliport')!;
    // Authored structures grant the technology that unlocks their slot at
    // scenario start. Clear that authoring convenience so this case measures
    // the production gate itself rather than the fixture's starting grant.
    locked.player(0)!.research.completed = [];
    const status = locked.productionStatus(0, lockedPort.id, 'transportHelo');
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('Air Superiority');
    expect(requiredTechnologiesForUnit('transportHelo').map((tech) => tech.id)).toEqual(['air2']);
  });

  it('shares the heliport two-berth limit with gunships and never uses the airfield pad to build', () => {
    const game = scenarioWith(
      [
        { defId: 'attackHelo', owner: 0, x: 24, z: 24 },
        { defId: 'attackHelo', owner: 0, x: 25, z: 24 },
      ],
      [
        { defId: 'heliport', owner: 0, x: 24, z: 24 },
        { defId: 'airfield', owner: 0, x: 40, z: 24 },
      ],
    );
    const port = game.entitiesOf(0, 'building').find((e) => e.defId === 'heliport')!;
    const field = game.entitiesOf(0, 'building').find((e) => e.defId === 'airfield')!;
    const full = game.productionStatus(0, port.id, 'transportHelo');
    expect(full.ok).toBe(false);
    expect(full.reason).toContain('No free helicopter position (2/2)');
    expect(game.productionStatus(0, field.id, 'transportHelo').ok).toBe(false);
    expect(game.dockStatus(field.id)?.helo).toMatchObject({
      used: 0,
      capacity: 1,
      temporary: true,
    });
  });
});

describe('transport helicopter boarding', () => {
  it('requires the helicopter to land before any infantry boards', () => {
    const game = heloGame([
      { defId: 'rifle', owner: 0, x: 28, z: 28 },
      { defId: 'medic', owner: 0, x: 29, z: 28 },
    ]);
    const helo = unit(game, 'transportHelo');
    const passengers = [unit(game, 'rifle'), unit(game, 'medic')];
    expect(containerBoardingReady(helo)).toBe(true);
    board(game, helo, passengers);
    game.tick();

    expect(helo.aircraft?.fieldLanding?.purpose).toBe('board');
    expect(passengers.every((p) => p.garrisonId === 0)).toBe(true);
    const boarded = until(game, 40, () => game.containerOccupants(helo.id).length === 2);
    expect(boarded).toBe(true);
    expect(containerBoardingReady(helo)).toBe(true);
    expect(containerRequiresLanding(helo)).toBe(true);
  });

  it('boards four individual infantry, refuses a fifth and filters ineligible units', () => {
    const game = heloGame([
      ...Array.from({ length: 5 }, (_, i) => ({
        defId: 'rifle',
        owner: 0,
        x: 26 + (i % 3),
        z: 27 + i,
      })),
      { defId: 'tank', owner: 0, x: 24, z: 30 },
      { defId: 'engineer', owner: 0, x: 24, z: 32 },
      { defId: 'apc', owner: 0, x: 24, z: 34 },
    ]);
    const helo = unit(game, 'transportHelo');
    const all = units(game, 'rifle');
    board(game, helo, [
      ...all,
      unit(game, 'tank'),
      unit(game, 'engineer'),
      unit(game, 'apc'),
    ]);
    const boarded = until(game, 45, () => game.containerOccupants(helo.id).length === 4);
    expect(boarded).toBe(true);
    expect(all.slice(0, 4).every((p) => p.garrisonId === helo.id)).toBe(true);
    expect(all[4].garrisonId).toBe(0);
    expect(unit(game, 'tank').garrisonId).toBe(0);
    expect(unit(game, 'engineer').garrisonId).toBe(0);
    expect(containerFiringSlots(helo)).toBe(0);
    expect(containerAllowsPassengerFire(helo)).toBe(false);
  });

  it('re-plans a waiting infantryman after the helicopter lands at a field zone', () => {
    const game = heloGame([{ defId: 'rifle', owner: 0, x: 30, z: 30 }]);
    const helo = unit(game, 'transportHelo');
    const rifle = unit(game, 'rifle');
    // The hull is airborne next to the squad so the boarding order has to wait
    // for a real landing instead of boarding from the air.
    helo.aircraft!.landed = false;
    helo.aircraft!.climb = 1;
    helo.x = 32 * TILE_SIZE;
    helo.z = 32 * TILE_SIZE;
    board(game, helo, [rifle]);
    game.tick();
    expect(rifle.garrisonId).toBe(0);
    expect(rifle.order?.type).toBe('garrison');

    const boarded = until(game, 30, () => rifle.garrisonId === helo.id);
    expect(boarded).toBe(true);
    expect(game.state.events.some((e) => /landing zone to pick up/.test(e.text))).toBe(true);
  });

  it('lands on an explicit order and then accepts passengers', () => {
    const game = heloGame([{ defId: 'rifle', owner: 0, x: 18, z: 12 }]);
    const helo = unit(game, 'transportHelo');
    const rifle = unit(game, 'rifle');
    const ac = helo.aircraft!;
    const lz = helo.x + TILE_SIZE * 6;
    game.enqueueCommand({ type: 'land', team: 0, ids: [helo.id], x: lz, z: helo.z });
    game.tick();

    expect(ac.fieldLanding?.purpose).toBe('idle');
    expect(game.state.events.some((e) => /landing at the chosen zone/.test(e.text))).toBe(true);
    const landed = until(game, 40, () => ac.landed && !ac.roll);
    expect(landed).toBe(true);
    expect(containerBoardingReady(helo)).toBe(true);

    // The point of the order: a hull that is down can take infantry on, which a
    // hovering transport cannot.
    board(game, helo, [rifle]);
    const boarded = until(game, 30, () => rifle.garrisonId === helo.id);
    expect(boarded).toBe(true);
  });

  it('rejects enemy boarding and recognises a friendly transport as a context target', () => {
    const game = heloGame([
      { defId: 'rifle', owner: 0, x: 28, z: 28 },
      { defId: 'tank', owner: 0, x: 30, z: 30 },
    ]);
    const helo = unit(game, 'transportHelo');
    const own = unit(game, 'rifle');
    const enemyRifle = unit(game, 'tank'); // ineligible by type, checked separately
    expect(containerAcceptsPassenger(helo, own)).toBe(true);
    expect(containerAcceptsPassenger(helo, enemyRifle)).toBe(false);
    expect(isTransportTarget(helo, 0)).toBe(true);
    expect(contextOrderFor(helo, [own], 0, false)).toBe('garrison');
    expect(contextOrderFor(unit(game, 'tank'), [own], 0, false)).toBe('move');
  });

  it('lets allied infantry board and lets the helicopter owner unload them', () => {
    const game = heloGame([{ defId: 'rifle', owner: 1, x: 28, z: 28 }], undefined, 0);
    const helo = unit(game, 'transportHelo');
    const ally = unit(game, 'rifle', 1);
    game.enqueueCommand({ type: 'garrison', team: 1, ids: [ally.id], targetId: helo.id });
    const boarded = until(game, 30, () => ally.garrisonId === helo.id);
    expect(boarded).toBe(true);
    expect(ally.owner).toBe(1);

    // The command gate must allow the carrier owner to order the unload even
    // though no passenger has that player's owner id.
    const gate = new CommandGate(game, [
      { seatId: 0, playerId: 0, team: 0, active: true },
      { seatId: 1, playerId: 1, team: 0, active: true },
    ]);
    const unloadOrder = gate.submit(
      0,
      { v: 1, command: { type: 'ungarrison', ids: [helo.id] } },
      1000,
    );
    expect(unloadOrder.ok).toBe(true);

    // A passenger owner cannot command the aircraft's landing/unload
    // transaction; only the carrier owner controls it.
    const passengerOrder = gate.submit(
      1,
      { v: 1, command: { type: 'ungarrison', ids: [helo.id] } },
      1100,
    );
    expect(passengerOrder.ok).toBe(false);
    if (!passengerOrder.ok) expect(passengerOrder.code).toBe('not-your-entity');

    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [helo.id] });
    const unloaded = until(game, 20, () => game.containerOccupants(helo.id).length === 0);
    expect(unloaded).toBe(true);
    expect(ally.owner).toBe(1);
    expect(ally.garrisonId).toBe(0);
  });
});

describe('transport helicopter flight and unloading', () => {
  it('carries passengers through normal movement without ejecting them', () => {
    const { game, helo, passengers } = loadedGame(3);
    const before = game.containerOccupants(helo.id).map((p) => p.id);
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [helo.id],
      x: 42 * TILE_SIZE,
      z: 42 * TILE_SIZE,
    });
    const airborne = until(game, 20, () => helo.aircraft?.landed === false);
    expect(airborne).toBe(true);
    game.advance(TICK_RATE * 4);
    expect(game.containerOccupants(helo.id).map((p) => p.id)).toEqual(before);
    for (const passenger of passengers) {
      expect(passenger.garrisonId).toBe(helo.id);
      expect(passenger.state).toBe('garrisoned');
    }
    expect(helo.aircraft?.fieldLanding).toBeUndefined();
  });

  it('does not land on an occupied position or outside the map footprint', () => {
    const game = heloGame([
      { defId: 'rifle', owner: 0, x: 30, z: 30 },
      { defId: 'tank', owner: 0, x: 31, z: 30 },
    ]);
    const helo = unit(game, 'transportHelo');
    const tank = unit(game, 'tank');
    board(game, helo, [unit(game, 'rifle')]);
    const boarded = until(game, 60, () => game.containerOccupants(helo.id).length === 1);
    expect(boarded).toBe(true);
    expect(helo.aircraft?.landed).toBe(true);
    expect(Math.hypot(helo.x - tank.x, helo.z - tank.z)).toBeGreaterThanOrEqual(
      (UNITS.transportHelo.radius + UNITS.tank.radius) * 0.7 - 0.01,
    );
    expect(helo.x).toBeGreaterThan(0);
    expect(helo.z).toBeGreaterThan(0);
    expect(helo.x).toBeLessThan(game.state.map.width * TILE_SIZE);
    expect(helo.z).toBeLessThan(game.state.map.height * TILE_SIZE);
  });

  it('keeps the whole landing footprint inside the map at the edge', () => {
    const game = heloGame([{ defId: 'rifle', owner: 0, x: 0, z: 20 }]);
    const helo = unit(game, 'transportHelo');
    board(game, helo, [unit(game, 'rifle')]);
    const boarded = until(game, 60, () => game.containerOccupants(helo.id).length === 1);
    expect(boarded).toBe(true);
    const reach = Math.ceil(UNITS.transportHelo.radius / TILE_SIZE);
    const tx = Math.floor(helo.x / TILE_SIZE);
    const tz = Math.floor(helo.z / TILE_SIZE);
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        expect(tx + dx).toBeGreaterThanOrEqual(0);
        expect(tz + dz).toBeGreaterThanOrEqual(0);
        expect(tx + dx).toBeLessThan(game.state.map.width);
        expect(tz + dz).toBeLessThan(game.state.map.height);
      }
    }
  });

  it('reports an unusable landing zone once and leaves infantry independent', () => {
    const game = heloGame([{ defId: 'rifle', owner: 0, x: 30, z: 30 }]);
    const helo = unit(game, 'transportHelo');
    const rifle = unit(game, 'rifle');
    // No tile can take a landing footprint, so the request must fail cleanly
    // rather than loop or force a landing into deep water.
    for (let i = 0; i < game.state.map.terrain.length; i++) {
      game.state.map.terrain[i] = Terrain.DeepWater;
    }
    board(game, helo, [rifle]);
    game.tick();
    expect(helo.aircraft?.fieldLanding).toBeUndefined();
    expect(rifle.garrisonId).toBe(0);
    const failures = () =>
      game.state.events.filter((event) => /No clear landing zone/.test(event.text)).length;
    expect(failures()).toBe(1);
    game.advance(TICK_RATE * 3);
    expect(failures()).toBe(1);
    expect(rifle.garrisonId).toBe(0);
  });

  it('takes off from a field landing with its permanent berth intact', () => {
    const { game, helo } = loadedGame(2);
    const homeId = helo.aircraft!.homeId;
    const berth = helo.aircraft!.berth;
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [helo.id],
      x: 44 * TILE_SIZE,
      z: 44 * TILE_SIZE,
    });
    const airborne = until(game, 20, () => helo.aircraft?.landed === false);
    expect(airborne).toBe(true);
    expect(helo.aircraft?.homeId).toBe(homeId);
    expect(helo.aircraft?.berth).toBe(berth);

    game.enqueueCommand({ type: 'return', team: 0, ids: [helo.id] });
    const returned = until(
      game,
      60,
      () => helo.aircraft?.landed === true && !helo.aircraft?.roll,
    );
    expect(returned).toBe(true);
    expect(helo.aircraft?.homeId).toBe(homeId);
    expect(helo.aircraft?.berth).toBe(berth);
  });

  it('lands before unloading and places every passenger on distinct walkable ground', () => {
    const { game, helo, passengers } = loadedGame(4);
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [helo.id],
      x: 44 * TILE_SIZE,
      z: 44 * TILE_SIZE,
    });
    until(game, 20, () => helo.aircraft?.landed === false);
    game.advance(TICK_RATE * 3);
    expect(helo.aircraft?.landed).toBe(false);

    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [helo.id] });
    game.tick();
    expect(game.containerOccupants(helo.id)).toHaveLength(4);
    expect(helo.aircraft?.fieldLanding?.purpose).toBe('unload');

    const unloaded = until(game, 20, () => game.containerOccupants(helo.id).length === 0);
    expect(unloaded).toBe(true);
    expect(helo.aircraft?.landed).toBe(true);
    expect(helo.aircraft?.roll).toBeUndefined();
    const positions = new Set(passengers.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`));
    expect(positions.size).toBe(4);
    for (const passenger of passengers) {
      expect(passenger.garrisonId).toBe(0);
      const tx = Math.floor(passenger.x / TILE_SIZE);
      const tz = Math.floor(passenger.z / TILE_SIZE);
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
  });

  it('retains all passengers when no safe landing or exit exists', () => {
    const { game, helo, passengers } = loadedGame(2);
    // A single dry tile under the hull and deep water everywhere the exit ring
    // searches. The unload must change nothing rather than dropping anyone.
    const keep = tileIndex(
      game.state.map.width,
      Math.floor(helo.x / TILE_SIZE),
      Math.floor(helo.z / TILE_SIZE),
    );
    for (let i = 0; i < game.state.map.terrain.length; i++) {
      if (i !== keep) game.state.map.terrain[i] = Terrain.DeepWater;
    }
    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [helo.id] });
    game.advance(TICK_RATE * 2);

    expect(game.containerOccupants(helo.id)).toHaveLength(2);
    for (const passenger of passengers) expect(passenger.garrisonId).toBe(helo.id);
    expect(game.state.events.some((e) => /No safe exit/.test(e.text))).toBe(true);
  });

  it('preserves passenger identity, health, veterancy and upgrades across unload and save/load', () => {
    // No live infantry upgrade exists in the content catalogue yet, so the
    // persistence path is exercised with a test-only kit that is legal for a
    // rifleman. The loader validates against the match's own catalogue.
    const rifleKit: UnitUpgradeDef = {
      id: 'rifleFieldKit',
      name: 'Rifle Field Kit',
      description: 'Test-only infantry upgrade fixture.',
      eligibleSlots: ['rifle'],
      kind: 'passive',
      cost: { mats: 0, req: 0 },
      icon: 'rifle',
    };
    const catalog: ResearchCatalog = {
      ...RESEARCH,
      upgrades: [...RESEARCH.upgrades, rifleKit],
    };
    const { game, passengers } = loadedGame(2, catalog);
    passengers[0].hp = 41;
    passengers[0].xp = 190;
    passengers[0].upgrades = ['rifleFieldKit'];
    passengers[1].hp = 37;
    passengers[1].xp = 160;

    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), {
      enableAI: false,
      research: catalog,
    });
    const restoredHelo = restored.state.entities.find((e) => e.defId === 'transportHelo')!;
    expect(restored.containerOccupants(restoredHelo.id)).toHaveLength(2);
    expect(restoredHelo.aircraft?.fieldLanding).toBeDefined();

    restored.enqueueCommand({ type: 'ungarrison', team: 0, ids: [restoredHelo.id] });
    restored.advance(TICK_RATE * 2);
    expect(restored.containerOccupants(restoredHelo.id)).toHaveLength(0);
    const restoredPassengers = restored.state.entities.filter((e) =>
      passengers.some((p) => p.id === e.id),
    );
    expect(restoredPassengers).toHaveLength(2);
    const first = restoredPassengers.find((e) => e.id === passengers[0].id)!;
    const second = restoredPassengers.find((e) => e.id === passengers[1].id)!;
    expect(first.hp).toBe(41);
    expect(first.xp).toBe(190);
    expect(first.upgrades).toEqual(['rifleFieldKit']);
    expect(second.hp).toBe(37);
    expect(second.xp).toBe(160);
  });

  it('kills every passenger exactly once when the helicopter is destroyed', () => {
    const { game, helo, passengers } = loadedGame(3);
    const lost = game.player(0)!.stats.unitsLost;
    helo.hp = 0;
    game.advance(TICK_RATE * 3);

    expect(game.getEntity(helo.id)).toBeUndefined();
    for (const passenger of passengers) expect(game.getEntity(passenger.id)).toBeUndefined();
    expect(game.player(0)!.stats.unitsLost).toBe(lost + 3);
    expect(game.containerOccupants(helo.id)).toHaveLength(0);
    game.advance(TICK_RATE * 5);
    expect(game.player(0)!.stats.unitsLost).toBe(lost + 3);
  });
});

describe('transport helicopter multiplayer projection', () => {
  it('ships public landing state while hiding passenger identities from the enemy', () => {
    const { game, helo, passengers } = loadedGame(2);
    expect(helo.aircraft?.landed).toBe(true);
    const own = createTeamSnapshot(game, 0);
    const enemy = createTeamSnapshot(game, 1);
    const ownHelo = own.entities.find((e) => e.id === helo.id)!;
    expect(ownHelo.aircraft?.landed).toBe(true);
    expect(ownHelo.aircraft?.fieldLanding).toBeDefined();
    for (const passenger of passengers) {
      expect(own.entities.some((e) => e.id === passenger.id)).toBe(true);
      expect(enemy.entities.some((e) => e.id === passenger.id)).toBe(false);
    }
    expect(enemy.entities.some((e) => e.id === helo.id)).toBe(true);
    expect(() => game.assertContainerIntegrity()).not.toThrow();
  });

  it('authorises a boarding command and rejects an enemy trying to board', () => {
    const game = heloGame([
      { defId: 'rifle', owner: 0, x: 28, z: 28 },
      { defId: 'rifle', owner: 1, x: 30, z: 30 },
    ]);
    const helo = unit(game, 'transportHelo');
    const own = unit(game, 'rifle', 0);
    const enemy = unit(game, 'rifle', 1);
    const gate = new CommandGate(game, twoSeats());

    const accepted = gate.submit(
      0,
      { v: 1, command: { type: 'garrison', ids: [own.id], targetId: helo.id } },
      0,
    );
    expect(accepted.ok).toBe(true);

    const rejected = gate.submit(
      1,
      { v: 1, command: { type: 'garrison', ids: [enemy.id], targetId: helo.id } },
      1000,
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe('friendly-target');
  });
});
