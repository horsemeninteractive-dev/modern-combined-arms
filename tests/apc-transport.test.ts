import { describe, expect, it } from 'vitest';
import { createEmptyScenario } from '../src/data/scenarios';
import { ALLIANCES } from '../src/data/factions';
import { UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';
import type { ResearchCatalog, UnitUpgradeDef } from '../src/data/research';
import { CommandGate } from '../src/multiplayer/commandGate';
import { createTeamSnapshot } from '../src/multiplayer/projection';
import { Game } from '../src/sim/game';
import {
  containerAcceptsPassenger,
  containerAllowsPassengerFire,
  containerFiringSlots,
} from '../src/sim/containers';
import { TILE_SIZE } from '../src/sim/constants';
import { canStandOn, Terrain, tileIndex } from '../src/sim/terrain';
import { contextOrderFor, isTransportTarget } from '../src/ui/orderIntent';
import type { Entity } from '../src/sim/types';
import { fourSeats, twoSeats } from './phase1-helpers';

type UnitSpawn = { defId: string; owner: number; x: number; z: number };
type StructureSpawn = { defId: string; owner: number; x: number; z: number };

const FIELD_KIT: UnitUpgradeDef = {
  id: 'rifleFieldKit',
  name: 'Rifle Field Kit',
  description: 'Test fixture: a per-soldier upgrade that must survive a save.',
  eligibleSlots: ['rifle', 'atgm'],
  kind: 'active',
  cost: { mats: 0, req: 0 },
  cooldownSeconds: 1,
  durationSeconds: 1,
  icon: 'medic',
};
const FIELD_KIT_CATALOG: ResearchCatalog = {
  techs: [],
  upgrades: [FIELD_KIT],
  modules: [],
};

function scenarioWith(
  units: UnitSpawn[],
  structures: StructureSpawn[] = [],
  factions: [string, string] = ['lithuania', 'russia'],
  research?: ResearchCatalog,
): Game {
  const scenario = createEmptyScenario(48, 40);
  scenario.settings.startingMats = 2_000;
  scenario.settings.startingReq = 300;
  scenario.settings.fog = false;
  scenario.players[0].factionId = factions[0];
  scenario.players[1].factionId = factions[1];
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].startX = 38;
  scenario.players[1].startZ = 30;
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'commandPost', owner: 1, x: 42, z: 34 },
    ...structures,
  ];
  scenario.units = units;
  return new Game(scenario, { enableAI: false, research });
}

function apcGame(
  extra: UnitSpawn[] = [],
  structures: StructureSpawn[] = [],
  factions?: [string, string],
  research?: ResearchCatalog,
): Game {
  return scenarioWith(
    [{ defId: 'apc', owner: 0, x: 24, z: 12 }, ...extra],
    structures,
    factions,
    research,
  );
}

function teammateGame(): Game {
  const scenario = createEmptyScenario(48, 40);
  scenario.settings.startingMats = 2_000;
  scenario.settings.startingReq = 300;
  scenario.settings.fog = false;
  scenario.players.push({
    ...scenario.players[0],
    id: 2,
    name: 'Allied Task Force',
    startX: 12,
    startZ: 12,
  });
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'commandPost', owner: 1, x: 42, z: 34 },
  ];
  scenario.units = [
    { defId: 'apc', owner: 2, x: 24, z: 12 },
    { defId: 'rifle', owner: 0, x: 23, z: 12 },
    { defId: 'apc', owner: 1, x: 30, z: 12 },
    { defId: 'rifle', owner: 1, x: 31, z: 12 },
  ];
  return new Game(scenario, { enableAI: false });
}

function unit(game: Game, defId: string, owner = 0): Entity {
  return game.entitiesOf(owner, 'unit').find((e) => e.defId === defId)!;
}

function units(game: Game, defId: string, owner = 0): Entity[] {
  return game.entitiesOf(owner, 'unit')
    .filter((e) => e.defId === defId)
    .sort((a, b) => a.id - b.id);
}

function board(game: Game, apc: Entity, passengers: Entity[], owner = 0): void {
  game.enqueueCommand({
    type: 'garrison',
    team: owner,
    ids: passengers.map((p) => p.id),
    targetId: apc.id,
  });
}

describe('shared APC registry and production', () => {
  it('is one shared baseline vehicle with a four-seat mobile container', () => {
    const apc = UNITS.apc;
    expect(apc).toBeDefined();
    expect(apc.domain).toBe('land');
    expect(apc.moveClass).toBe('wheeled');
    expect(apc.transport).toMatchObject({
      capacity: 4,
      mobile: true,
      onDestroyed: 'kill',
      canFireEmbarked: false,
      firingSlots: 0,
      passenger: 'infantry',
    });
    expect(ALLIANCES.defender.baseline.units).toContain('apc');
    expect(ALLIANCES.eastern.baseline.units).toContain('apc');
    expect(apc.producedBy).toEqual(['factory']);
  });

  it('is produced by the existing factory for both alliances without research', () => {
    const factory: StructureSpawn = { defId: 'factory', owner: 0, x: 9, z: 2 };
    const defender = apcGame([], [factory], ['lithuania', 'russia']);
    const defenderFactory = defender.state.entities.find(
      (e) => e.kind === 'building' && e.defId === 'factory',
    )!;
    expect(defender.productionEntries(0, 'factory')).toContain('apc');
    expect(defender.productionStatus(0, defenderFactory.id, 'apc').ok).toBe(true);

    const eastern = apcGame([], [factory], ['russia', 'lithuania']);
    const easternFactory = eastern.state.entities.find(
      (e) => e.kind === 'building' && e.defId === 'factory',
    )!;
    expect(eastern.productionEntries(0, 'factory')).toContain('apc');
    expect(eastern.productionStatus(0, easternFactory.id, 'apc').ok).toBe(true);
  });

  it('keeps the APC a transport rather than an IFV or tank', () => {
    const apc = UNITS.apc;
    expect(apc.speed).toBeGreaterThan(UNITS.tank.speed);
    expect(apc.speed).toBeLessThan(UNITS.recon.speed);
    expect(apc.hp).toBeLessThan(UNITS.ifv.hp);
    expect(apc.cost.mats).toBeLessThan(UNITS.ifv.cost.mats);
    expect(apc.weapons).not.toContain('atgm');
    expect(apc.weapons).not.toContain('autocannon');
    const mg = WEAPONS.apcMg;
    expect(mg.targets).not.toContain('air');
    expect(mg.multipliers.heavy).toBeLessThan(0.1);
    expect(mg.range).toBeLessThan(WEAPONS.autocannon.range);
    expect(mg.damage / mg.cooldown).toBeLessThan(WEAPONS.autocannon.damage / WEAPONS.autocannon.cooldown);
  });
});

describe('APC passenger eligibility and boarding', () => {
  it('accepts individual line infantry but not vehicles, engineers or another APC', () => {
    const game = apcGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'medic', owner: 0, x: 25, z: 12 },
      { defId: 'tank', owner: 0, x: 22, z: 12 },
      { defId: 'engineer', owner: 0, x: 26, z: 12 },
      { defId: 'apc', owner: 0, x: 27, z: 12 },
    ]);
    const apc = unit(game, 'apc');
    expect(containerAcceptsPassenger(apc, unit(game, 'rifle'))).toBe(true);
    expect(containerAcceptsPassenger(apc, unit(game, 'medic'))).toBe(true);
    expect(containerAcceptsPassenger(apc, unit(game, 'tank'))).toBe(false);
    expect(containerAcceptsPassenger(apc, unit(game, 'engineer'))).toBe(false);
    const secondApc = game.entitiesOf(0, 'unit').filter((e) => e.defId === 'apc')[1];
    expect(containerAcceptsPassenger(apc, secondApc)).toBe(false);
  });

  it('boards exactly four and leaves the fifth outside with feedback', () => {
    const game = apcGame(
      Array.from({ length: 5 }, (_, i) => ({
        defId: 'rifle',
        owner: 0,
        x: 23 + (i % 2),
        z: 10 + i,
      })),
    );
    const apc = unit(game, 'apc');
    const all = units(game, 'rifle');
    board(game, apc, all);
    game.advance(120);

    const inside = game.containerOccupants(apc.id);
    expect(inside).toHaveLength(4);
    expect(inside.map((u) => u.id)).toEqual(all.slice(0, 4).map((u) => u.id));
    expect(all[4].garrisonId).toBe(0);
    expect(game.state.events.some((e) => /room for 4/.test(e.text))).toBe(true);
  });

  it('sends only eligible infantry from a mixed selection', () => {
    const game = apcGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'atgm', owner: 0, x: 25, z: 12 },
      { defId: 'tank', owner: 0, x: 22, z: 12 },
      { defId: 'engineer', owner: 0, x: 26, z: 12 },
    ]);
    const apc = unit(game, 'apc');
    const rifle = unit(game, 'rifle');
    const atgm = unit(game, 'atgm');
    const tank = unit(game, 'tank');
    const engineer = unit(game, 'engineer');
    board(game, apc, [rifle, atgm, tank, engineer]);
    game.advance(30);

    expect(game.containerOccupants(apc.id).map((u) => u.id)).toEqual([rifle.id, atgm.id]);
    expect(tank.garrisonId).toBe(0);
    expect(engineer.garrisonId).toBe(0);
  });

  it('does not let one passenger duplicate a seat or an enemy board', () => {
    const game = apcGame([
      { defId: 'rifle', owner: 0, x: 24, z: 11 },
      { defId: 'rifle', owner: 1, x: 25, z: 12 },
    ]);
    const apc = unit(game, 'apc');
    const own = unit(game, 'rifle', 0);
    const enemy = unit(game, 'rifle', 1);
    board(game, apc, [own]);
    game.advance(2);
    board(game, apc, [own]);
    game.advance(2);
    expect(game.containerOccupants(apc.id)).toHaveLength(1);

    board(game, apc, [enemy], 1);
    game.advance(2);
    expect(enemy.garrisonId).toBe(0);
    expect(game.state.events.some((e) => /transport from your side/.test(e.text))).toBe(true);
  });

  it('re-plans a boarding route after the carrier moves, then boards when it stops', () => {
    const game = apcGame([{ defId: 'rifle', owner: 0, x: 24, z: 14 }]);
    const apc = unit(game, 'apc');
    const rifle = unit(game, 'rifle');
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [apc.id],
      x: 18 * TILE_SIZE,
      z: 12 * TILE_SIZE,
    });
    game.advance(30);
    board(game, apc, [rifle]);
    game.enqueueCommand({ type: 'stop', team: 0, ids: [apc.id] });
    game.advance(400);

    expect(rifle.garrisonId).toBe(apc.id);
    expect(game.containerOccupants(apc.id)).toHaveLength(1);
  });

  it('resolves a full transport before creating a boarding order', () => {
    const game = apcGame(
      Array.from({ length: 5 }, (_, i) => ({
        defId: 'rifle',
        owner: 0,
        x: 24,
        z: 10 + i,
      })),
    );
    const apc = unit(game, 'apc');
    const all = units(game, 'rifle');
    board(game, apc, all.slice(0, 4));
    game.advance(20);
    expect(game.containerOccupants(apc.id)).toHaveLength(4);

    board(game, apc, [all[4]]);
    game.advance(2);
    expect(all[4].garrisonId).toBe(0);
    expect(game.state.events.some((e) => /full \(4\/4\)/.test(e.text))).toBe(true);
  });
});

describe('APC contextual orders', () => {
  it('recognises a friendly APC but not an enemy one or an ordinary vehicle', () => {
    const game = apcGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'tank', owner: 0, x: 22, z: 12 },
      { defId: 'apc', owner: 1, x: 30, z: 12 },
    ]);
    const apc = unit(game, 'apc');
    const rifle = unit(game, 'rifle');
    const tank = unit(game, 'tank');
    expect(isTransportTarget(apc, 0)).toBe(true);
    expect(contextOrderFor(apc, [rifle], 0, false)).toBe('garrison');
    expect(contextOrderFor(apc, [tank], 0, false)).toBe('move');
    const enemyApc = game.entitiesOf(1, 'unit').find((e) => e.defId === 'apc')!;
    expect(isTransportTarget(enemyApc, 0)).toBe(false);
    expect(contextOrderFor(enemyApc, [rifle], 0, true)).toBe('attack');
    expect(contextOrderFor(tank, [rifle], 0, false)).toBe('move');
  });
});

describe('allied APC boarding', () => {
  it('lets infantry board, save/load and unload from a teammate APC', () => {
    const game = teammateGame();
    const apc = unit(game, 'apc', 2);
    const rifle = unit(game, 'rifle', 0);

    board(game, apc, [rifle], 0);
    game.advance(20);
    expect(rifle.garrisonId).toBe(apc.id);
    expect(game.containerOccupants(apc.id).map((u) => u.id)).toEqual([rifle.id]);
    expect(() => game.assertContainerIntegrity()).not.toThrow();
    expect(() => createTeamSnapshot(game, 0)).not.toThrow();

    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), {
      enableAI: false,
    });
    const restoredApc = restored.entitiesOf(2, 'unit').find((e) => e.defId === 'apc')!;
    expect(restored.containerOccupants(restoredApc.id).map((u) => u.id)).toEqual([rifle.id]);

    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [apc.id] });
    game.advance(2);
    expect(rifle.garrisonId).toBe(0);
    expect(game.containerOccupants(apc.id)).toHaveLength(0);
  });

  it('lets the carrier owner unload an allied passenger from a teammate APC', () => {
    const game = teammateGame();
    const apc = unit(game, 'apc', 2);
    const rifle = unit(game, 'rifle', 0);

    board(game, apc, [rifle], 0);
    game.advance(20);
    expect(rifle.garrisonId).toBe(apc.id);

    game.enqueueCommand({ type: 'ungarrison', team: 2, ids: [apc.id] });
    game.advance(2);
    expect(rifle.garrisonId).toBe(0);
    expect(game.containerOccupants(apc.id)).toHaveLength(0);
  });

  it('resolves a teammate APC as friendly for context and gate, but not an enemy APC', () => {
    const game = teammateGame();
    const apc = unit(game, 'apc', 2);
    const rifle = unit(game, 'rifle', 0);
    const enemyApc = unit(game, 'apc', 1);

    expect(isTransportTarget(apc, 0, true)).toBe(true);
    expect(isTransportTarget(apc, 0)).toBe(false);
    expect(contextOrderFor(apc, [rifle], 0, false)).toBe('garrison');
    expect(contextOrderFor(enemyApc, [rifle], 0, true)).toBe('attack');

    const gate = new CommandGate(game, fourSeats());
    const accepted = gate.submit(
      0,
      { v: 1, command: { type: 'garrison', ids: [rifle.id], targetId: apc.id } },
      0,
    );
    expect(accepted.ok).toBe(true);
    const rejected = gate.submit(
      0,
      { v: 1, command: { type: 'garrison', ids: [rifle.id], targetId: enemyApc.id } },
      1000,
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe('friendly-target');
  });

  it('rejects and reconciles a passenger associated with an enemy transport', () => {
    const game = teammateGame();
    const apc = unit(game, 'apc', 2);
    const enemy = unit(game, 'rifle', 1);
    enemy.garrisonId = apc.id;

    expect(() => game.assertContainerIntegrity()).toThrow(/not on the transport's side/);
    game.reconcileContainers();
    expect(enemy.garrisonId).toBe(0);
    expect(() => game.assertContainerIntegrity()).not.toThrow();
  });
});

describe('APC unloading', () => {
  function loadedGame(count = 4): { game: Game; apc: Entity; passengers: Entity[] } {
    const game = apcGame(
      Array.from({ length: count }, (_, i) => ({
        defId: 'rifle',
        owner: 0,
        x: 23 + (i % 2),
        z: 10 + i,
      })),
    );
    const apc = unit(game, 'apc');
    const passengers = units(game, 'rifle');
    board(game, apc, passengers);
    game.advance(30);
    expect(game.containerOccupants(apc.id)).toHaveLength(count);
    return { game, apc, passengers };
  }

  it('unloads every passenger to a distinct, walkable, in-bounds position', () => {
    const { game, apc, passengers } = loadedGame();
    for (const [index, passenger] of passengers.entries()) {
      passenger.hp = 40 + index;
      passenger.xp = 100 + index;
      passenger.upgrades = ['rifleFieldKit'];
    }
    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [apc.id] });
    game.advance(2);

    expect(game.containerOccupants(apc.id)).toHaveLength(0);
    const positions = new Set(passengers.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`));
    expect(positions.size).toBe(4);
    for (const [index, passenger] of passengers.entries()) {
      expect(passenger.garrisonId).toBe(0);
      expect(passenger.hp).toBe(40 + index);
      expect(passenger.xp).toBe(100 + index);
      expect(passenger.upgrades).toEqual(['rifleFieldKit']);
      expect(Number.isInteger(passenger.id)).toBe(true);
      const tx = Math.floor(passenger.x / TILE_SIZE);
      const tz = Math.floor(passenger.z / TILE_SIZE);
      expect(tx).toBeGreaterThanOrEqual(0);
      expect(tz).toBeGreaterThanOrEqual(0);
      expect(tx).toBeLessThan(game.state.map.width);
      expect(tz).toBeLessThan(game.state.map.height);
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
    for (let i = 0; i < passengers.length; i++) {
      for (let j = i + 1; j < passengers.length; j++) {
        const a = passengers[i];
        const b = passengers[j];
        const min = (UNITS[a.defId].radius + UNITS[b.defId].radius) * 0.7;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it('retains everyone aboard when there is no safe exit', () => {
    const { game, apc, passengers } = loadedGame(2);
    for (let z = 1; z < 30; z++) {
      for (let x = 4; x < 40; x++) {
        if (x === 24 && z === 12) continue;
        game.state.map.terrain[tileIndex(game.state.map.width, x, z)] = Terrain.DeepWater;
      }
    }
    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [apc.id] });
    game.advance(2);

    expect(game.containerOccupants(apc.id)).toHaveLength(2);
    for (const passenger of passengers) expect(passenger.garrisonId).toBe(apc.id);
    expect(game.state.events.some((e) => /No safe exit/.test(e.text))).toBe(true);
  });

  it('stops a moving carrier before placing passengers', () => {
    const { game, apc, passengers } = loadedGame(2);
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [apc.id],
      x: 16 * TILE_SIZE,
      z: 12 * TILE_SIZE,
    });
    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [apc.id] });
    game.advance(2);

    expect(apc.state).toBe('idle');
    expect(apc.path).toHaveLength(0);
    expect(apc.destX).toBe(apc.x);
    expect(apc.destZ).toBe(apc.z);
    expect(game.containerOccupants(apc.id)).toHaveLength(0);
    for (const passenger of passengers) {
      expect(Math.abs(passenger.x - apc.x)).toBeLessThanOrEqual(2 * TILE_SIZE);
      expect(Math.abs(passenger.z - apc.z)).toBeLessThanOrEqual(2 * TILE_SIZE);
    }
  });
});

describe('APC combat, destruction and persistence', () => {
  it('cannot fire passengers or expose them to the enemy projection', () => {
    const game = apcGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'rifle', owner: 0, x: 25, z: 12 },
      { defId: 'rifle', owner: 1, x: 27, z: 12 },
    ]);
    const apc = unit(game, 'apc');
    const passengers = units(game, 'rifle', 0);
    board(game, apc, passengers);
    game.advance(20);

    expect(containerFiringSlots(apc)).toBe(0);
    expect(containerAllowsPassengerFire(apc)).toBe(false);
    const enemyView = createTeamSnapshot(game, 1);
    expect(enemyView.entities.some((e) => e.id === apc.id)).toBe(true);
    for (const passenger of passengers) {
      expect(enemyView.entities.some((e) => e.id === passenger.id)).toBe(false);
    }
    const ownView = createTeamSnapshot(game, 0);
    for (const passenger of passengers) {
      expect(ownView.entities.some((e) => e.id === passenger.id)).toBe(true);
    }
  });

  it('kills every passenger exactly once when the APC is destroyed', () => {
    const game = apcGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'rifle', owner: 0, x: 25, z: 12 },
    ]);
    const apc = unit(game, 'apc');
    const passengers = units(game, 'rifle');
    board(game, apc, passengers);
    game.advance(20);
    const lost = game.player(0)!.stats.unitsLost;

    apc.hp = 0;
    game.advance(3);
    expect(game.getEntity(apc.id)).toBeUndefined();
    for (const passenger of passengers) expect(game.getEntity(passenger.id)).toBeUndefined();
    expect(game.player(0)!.stats.unitsLost).toBe(lost + 2);
    expect(game.containerOccupants(apc.id)).toHaveLength(0);
    game.advance(5);
    expect(game.player(0)!.stats.unitsLost).toBe(lost + 2);
  });

  it('preserves occupancy, ids, health, upgrades and veterancy through save/load', () => {
    const game = apcGame(
      [
        { defId: 'rifle', owner: 0, x: 23, z: 12 },
        { defId: 'atgm', owner: 0, x: 25, z: 12 },
      ],
      [],
      undefined,
      FIELD_KIT_CATALOG,
    );
    const apc = unit(game, 'apc');
    const passengers = [unit(game, 'rifle'), unit(game, 'atgm')];
    for (const passenger of passengers) {
      passenger.hp = 35;
      passenger.xp = 180;
      passenger.upgrades = ['rifleFieldKit'];
    }
    board(game, apc, passengers);
    game.advance(20);

    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), {
      enableAI: false,
      research: FIELD_KIT_CATALOG,
    });
    const restoredApc = restored.state.entities.find((e) => e.defId === 'apc')!;
    const restoredInside = restored.containerOccupants(restoredApc.id);
    expect(restoredInside.map((u) => u.id).sort((a, b) => a - b)).toEqual(
      passengers.map((u) => u.id).sort((a, b) => a - b),
    );
    for (const passenger of restoredInside) {
      expect(passenger.hp).toBe(35);
      expect(passenger.xp).toBe(180);
      expect(passenger.upgrades).toEqual(['rifleFieldKit']);
      expect(passenger.garrisonId).toBe(restoredApc.id);
    }
  });

  it('rejects an over-capacity occupancy graph before a full snapshot leaves', () => {
    const game = apcGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'rifle', owner: 0, x: 25, z: 12 },
      { defId: 'rifle', owner: 0, x: 24, z: 11 },
      { defId: 'rifle', owner: 0, x: 24, z: 13 },
      { defId: 'rifle', owner: 0, x: 24, z: 14 },
    ]);
    const apc = unit(game, 'apc');
    const all = units(game, 'rifle');
    board(game, apc, all.slice(0, 4));
    game.advance(20);
    expect(game.containerOccupants(apc.id)).toHaveLength(4);

    all[4].garrisonId = apc.id;
    expect(() => createTeamSnapshot(game, 0)).toThrow(/capacity/);
    all[4].garrisonId = 0;
    expect(() => createTeamSnapshot(game, 0)).not.toThrow();
  });

  it('authorises friendly boarding and rejects forged occupancy or enemy boarding', () => {
    const game = apcGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'rifle', owner: 0, x: 24, z: 12 },
      { defId: 'rifle', owner: 0, x: 25, z: 12 },
      { defId: 'rifle', owner: 0, x: 24, z: 11 },
      { defId: 'rifle', owner: 0, x: 24, z: 13 },
      { defId: 'rifle', owner: 1, x: 26, z: 13 },
    ]);
    const apc = unit(game, 'apc');
    const own = units(game, 'rifle', 0);
    const enemy = unit(game, 'rifle', 1);
    const gate = new CommandGate(game, twoSeats());

    const enemyAttempt = gate.submit(
      1,
      { v: 1, command: { type: 'garrison', ids: [enemy.id], targetId: apc.id } },
      0,
    );
    expect(enemyAttempt.ok).toBe(false);
    if (!enemyAttempt.ok) expect(enemyAttempt.code).toBe('friendly-target');

    board(game, apc, own.slice(0, 4));
    game.advance(20);
    const fullAttempt = gate.submit(
      0,
      { v: 1, command: { type: 'garrison', ids: [own[4].id], targetId: apc.id } },
      500,
    );
    expect(fullAttempt.ok).toBe(false);
    if (!fullAttempt.ok) expect(fullAttempt.code).toBe('target-not-attackable');

    const steal = gate.submit(1, { v: 1, command: { type: 'ungarrison', ids: [apc.id] } }, 1000);
    expect(steal.ok).toBe(false);
    if (!steal.ok) expect(steal.code).toBe('not-your-entity');

    const unload = gate.submit(0, { v: 1, command: { type: 'ungarrison', ids: [apc.id] } }, 1500);
    expect(unload.ok).toBe(true);
  });

  it('filters a mixed gate selection to eligible infantry', () => {
    const game = apcGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'tank', owner: 0, x: 22, z: 12 },
    ]);
    const apc = unit(game, 'apc');
    const rifle = unit(game, 'rifle');
    const tank = unit(game, 'tank');
    const gate = new CommandGate(game, twoSeats());
    const result = gate.submit(
      0,
      { v: 1, command: { type: 'garrison', ids: [rifle.id, tank.id], targetId: apc.id } },
      0,
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.command.type === 'garrison') {
      expect(result.command.ids).toEqual([rifle.id]);
    }
  });
});
