import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmptyScenario } from '../src/data/scenarios';
import { UNITS } from '../src/data/units';
import { CommandGate } from '../src/multiplayer/commandGate';
import { createTeamState } from '../src/multiplayer/projection';
import { Game } from '../src/sim/game';
import { TILE_SIZE } from '../src/sim/constants';
import { Terrain, tileIndex } from '../src/sim/terrain';
import type { Entity, TransportDef } from '../src/sim/types';
import { twoSeats } from './phase1-helpers';

/**
 * A test-only carrier. It is registered for this file and removed afterwards,
 * so the shipped roster, build data and every national list stay untouched.
 * The simulation must never need to know this id: it only reads `transport`.
 */
const TEST_CARRIER = 'testCarrier';
const TEST_TRANSPORT: TransportDef = {
  capacity: 2,
  mobile: true,
  boardingRadius: 2,
  onDestroyed: 'kill',
};

type UnitSpawn = { defId: string; owner: number; x: number; z: number };
type StructureSpawn = { defId: string; owner: number; x: number; z: number };

beforeAll(() => {
  const base = UNITS.ifv;
  if (!base) throw new Error('The IFV definition is required as a carrier base.');
  UNITS[TEST_CARRIER] = {
    ...base,
    id: TEST_CARRIER,
    name: 'Test Carrier',
    weapons: [],
    canGarrison: false,
    transport: { ...TEST_TRANSPORT },
  };
});

afterAll(() => {
  delete UNITS[TEST_CARRIER];
});

function scenarioWith(
  units: UnitSpawn[],
  structures: StructureSpawn[] = [],
  fog = false,
): Game {
  const scenario = createEmptyScenario(48, 40);
  scenario.settings.startingMats = 0;
  scenario.settings.startingReq = 0;
  scenario.settings.fog = fog;
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
  return new Game(scenario, { enableAI: false });
}

function carrierGame(extra: UnitSpawn[] = [], fog = false): Game {
  return scenarioWith(
    [{ defId: TEST_CARRIER, owner: 0, x: 24, z: 12 }, ...extra],
    [],
    fog,
  );
}

function carrier(game: Game): Entity {
  return game.entitiesOf(0, 'unit').find((e) => e.defId === TEST_CARRIER)!;
}

function rifles(game: Game, owner = 0): Entity[] {
  return game.entitiesOf(owner, 'unit').filter((e) => e.defId === 'rifle');
}

function board(game: Game, unit: Entity, target: Entity): void {
  game.enqueueCommand({ type: 'garrison', team: unit.owner, ids: [unit.id], targetId: target.id });
}

describe('shared container occupancy', () => {
  it('boards infantry and keeps the same entity, id and veterancy', () => {
    const game = carrierGame([{ defId: 'rifle', owner: 0, x: 25, z: 12 }]);
    const apc = carrier(game);
    const rifle = rifles(game)[0];
    rifle.xp = 240;
    board(game, rifle, apc);
    game.advance(2);

    expect(rifle.garrisonId).toBe(apc.id);
    expect(rifle.state).toBe('garrisoned');
    expect(game.getEntity(rifle.id)).toBe(rifle);
    expect(rifle.xp).toBe(240);
    expect(game.containerOccupants(apc.id).map((u) => u.id)).toEqual([rifle.id]);
  });

  it('enforces capacity in deterministic id order', () => {
    const game = carrierGame([
      { defId: 'rifle', owner: 0, x: 24, z: 11 },
      { defId: 'rifle', owner: 0, x: 24, z: 13 },
      { defId: 'rifle', owner: 0, x: 25, z: 13 },
    ]);
    const apc = carrier(game);
    const all = rifles(game).sort((a, b) => a.id - b.id);
    game.enqueueCommand({ type: 'garrison', team: 0, ids: all.map((u) => u.id), targetId: apc.id });
    game.advance(20);

    const inside = game.containerOccupants(apc.id);
    expect(inside).toHaveLength(2);
    expect(inside.map((u) => u.id)).toEqual([all[0].id, all[1].id]);
    expect(all[2].garrisonId).toBe(0);
  });

  it('lets one passenger hold one seat only', () => {
    const game = carrierGame([{ defId: 'rifle', owner: 0, x: 25, z: 12 }]);
    const apc = carrier(game);
    const rifle = rifles(game)[0];
    board(game, rifle, apc);
    game.advance(2);
    board(game, rifle, apc);
    game.advance(2);
    expect(game.containerOccupants(apc.id)).toHaveLength(1);
    expect(rifle.garrisonId).toBe(apc.id);
  });

  it('rejects another side’s infantry and another side’s carrier', () => {
    const game = carrierGame([{ defId: 'rifle', owner: 1, x: 25, z: 12 }]);
    const apc = carrier(game);
    const enemy = rifles(game, 1)[0];
    board(game, enemy, apc);
    game.advance(2);
    expect(enemy.garrisonId).toBe(0);
    expect(
      game.state.events.some(
        (e) => e.type === 'orderFailed' && /transport from your side/i.test(e.text),
      ),
    ).toBe(true);
  });
});

describe('embarked passengers are not battlefield units', () => {
  it('follows the carrier and ignores an independent move order', () => {
    const game = carrierGame([{ defId: 'rifle', owner: 0, x: 25, z: 12 }]);
    const apc = carrier(game);
    const rifle = rifles(game)[0];
    board(game, rifle, apc);
    game.advance(2);
    const startX = apc.x;

    game.enqueueCommand({ type: 'move', team: 0, ids: [apc.id], x: 16 * TILE_SIZE, z: 12 * TILE_SIZE });
    game.advance(20 * 8);
    expect(apc.x).toBeLessThan(startX - 2 * TILE_SIZE);
    expect(rifle.x).toBe(apc.x);
    expect(rifle.z).toBe(apc.z);

    game.enqueueCommand({ type: 'move', team: 0, ids: [rifle.id], x: 4 * TILE_SIZE, z: 30 * TILE_SIZE });
    game.advance(20 * 3);
    expect(rifle.x).toBe(apc.x);
    expect(rifle.z).toBe(apc.z);
    expect(
      game.state.events.some(
        (e) => e.type === 'orderFailed' && /Garrisoned infantry must exit/.test(e.text),
      ),
    ).toBe(true);
  });

  it('does not fire from a carrier that grants no firing positions', () => {
    const game = carrierGame([
      { defId: 'rifle', owner: 0, x: 25, z: 12 },
      { defId: 'rifle', owner: 1, x: 27, z: 12 },
    ]);
    const apc = carrier(game);
    const passenger = rifles(game, 0)[0];
    const enemy = rifles(game, 1)[0];
    enemy.maxHp = 100000;
    enemy.hp = 100000;
    board(game, passenger, apc);
    game.advance(20 * 4);

    expect(passenger.garrisonId).toBe(apc.id);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('contributes no independent vision and is not projected to the enemy', () => {
    const game = carrierGame(
      [
        { defId: 'rifle', owner: 0, x: 25, z: 12 },
        { defId: 'rifle', owner: 1, x: 27, z: 12 },
      ],
      true,
    );
    const apc = carrier(game);
    const passenger = rifles(game)[0];
    board(game, passenger, apc);
    game.advance(20);

    const enemyView = createTeamState(game, 1);
    expect(enemyView.entities.some((e) => e.id === apc.id)).toBe(true);
    expect(enemyView.entities.some((e) => e.id === passenger.id)).toBe(false);

    const ownView = createTeamState(game, 0);
    expect(ownView.entities.some((e) => e.id === passenger.id)).toBe(true);
  });

  it('is destroyed with its carrier exactly once', () => {
    const game = carrierGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'rifle', owner: 0, x: 25, z: 12 },
    ]);
    const apc = carrier(game);
    const all = rifles(game);
    game.enqueueCommand({ type: 'garrison', team: 0, ids: all.map((u) => u.id), targetId: apc.id });
    game.advance(4);
    expect(game.containerOccupants(apc.id)).toHaveLength(2);

    apc.hp = 0;
    game.advance(2);
    for (const unit of all) expect(game.getEntity(unit.id)).toBeUndefined();
    // Only the two passengers pass through the casualty path here: the carrier
    // was zeroed directly instead of being destroyed by a weapon, so its own
    // loss was never recorded. What matters is that the passengers are counted
    // once and the cleanup pass does not count them again.
    expect(game.player(0)?.stats.unitsLost).toBe(2);
    game.advance(4);
    expect(game.player(0)?.stats.unitsLost).toBe(2);
    expect(game.containerOccupants(apc.id)).toHaveLength(0);
  });
});

describe('unloading', () => {
  it('returns passengers to distinct walkable tiles and lets them move again', () => {
    const game = carrierGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'rifle', owner: 0, x: 25, z: 12 },
    ]);
    const apc = carrier(game);
    const all = rifles(game);
    game.enqueueCommand({ type: 'garrison', team: 0, ids: all.map((u) => u.id), targetId: apc.id });
    game.advance(4);
    expect(game.containerOccupants(apc.id)).toHaveLength(2);

    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [apc.id] });
    game.advance(2);
    expect(game.containerOccupants(apc.id)).toHaveLength(0);
    expect(new Set(all.map((u) => `${u.x.toFixed(2)},${u.z.toFixed(2)}`)).size).toBe(2);
    for (const unit of all) {
      const tx = Math.floor(unit.x / TILE_SIZE);
      const tz = Math.floor(unit.z / TILE_SIZE);
      expect(game.state.map.terrain[tileIndex(game.state.map.width, tx, tz)]).not.toBe(
        Terrain.DeepWater,
      );
    }
    const start = all[0].x;
    game.enqueueCommand({ type: 'move', team: 0, ids: [all[0].id], x: start - 6 * TILE_SIZE, z: all[0].z });
    game.advance(20 * 3);
    expect(all[0].x).toBeLessThan(start - TILE_SIZE);
  });

  it('refuses to unload when every exit is deep water', () => {
    const game = carrierGame([{ defId: 'rifle', owner: 0, x: 25, z: 12 }]);
    const apc = carrier(game);
    const rifle = rifles(game)[0];
    board(game, rifle, apc);
    game.advance(2);

    for (let z = 4; z <= 20; z++) {
      for (let x = 16; x <= 32; x++) {
        if (x === 24 && z === 12) continue;
        game.state.map.terrain[tileIndex(game.state.map.width, x, z)] = Terrain.DeepWater;
      }
    }
    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [apc.id] });
    game.advance(2);
    expect(rifle.garrisonId).toBe(apc.id);
    expect(game.containerOccupants(apc.id)).toHaveLength(1);
    expect(game.state.events.some((e) => /No safe exit/.test(e.text))).toBe(true);
  });
});

describe('persistence and reconciliation', () => {
  it('restores the exact passenger relationship and keeps simulation state equal', () => {
    const game = carrierGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'rifle', owner: 0, x: 25, z: 12 },
    ]);
    const apc = carrier(game);
    const all = rifles(game);
    game.enqueueCommand({ type: 'garrison', team: 0, ids: all.map((u) => u.id), targetId: apc.id });
    game.advance(4);

    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    const restoredCarrier = restored.state.entities.find((e) => e.defId === TEST_CARRIER)!;
    expect(restored.containerOccupants(restoredCarrier.id).map((u) => u.id)).toEqual(
      game.containerOccupants(apc.id).map((u) => u.id),
    );
    for (const unit of all) {
      const copy = restored.state.entities.find((e) => e.id === unit.id)!;
      expect(copy.garrisonId).toBe(restoredCarrier.id);
    }
    game.advance(20 * 3);
    restored.advance(20 * 3);
    expect(restored.stateHash()).toBe(game.stateHash());
  });

  it('clears an orphaned reference and trims an over-full container', () => {
    const game = carrierGame([
      { defId: 'rifle', owner: 0, x: 23, z: 12 },
      { defId: 'rifle', owner: 0, x: 25, z: 12 },
      { defId: 'rifle', owner: 0, x: 26, z: 12 },
    ]);
    const all = rifles(game).sort((a, b) => a.id - b.id);

    const save = JSON.parse(JSON.stringify(game.toSave()));
    const entities = save.state.entities as Array<Record<string, unknown>>;
    const savedCarrier = entities.find((e) => e.defId === TEST_CARRIER)!;
    entities.find((e) => e.id === all[0].id)!.garrisonId = savedCarrier.id;
    entities.find((e) => e.id === all[1].id)!.garrisonId = savedCarrier.id;
    entities.find((e) => e.id === all[2].id)!.garrisonId = savedCarrier.id;
    entities.find((e) => e.id === all[0].id)!.state = 'garrisoned';

    const restored = Game.fromSave(save, { enableAI: false });
    const inside = restored.containerOccupants(savedCarrier.id as number);
    expect(inside).toHaveLength(2);
    expect(inside.map((u) => u.id)).toEqual([all[0].id, all[1].id]);

    const orphanSave = JSON.parse(JSON.stringify(game.toSave()));
    const orphanUnits = orphanSave.state.entities as Array<Record<string, unknown>>;
    const orphan = orphanUnits.find((e) => e.id === all[1].id)!;
    orphan.garrisonId = 999999;
    const recovered = Game.fromSave(orphanSave, { enableAI: false });
    expect(recovered.state.entities.find((e) => e.id === all[1].id)!.garrisonId).toBe(0);
  });
});

describe('authoritative command gate', () => {
  it('accepts friendly boarding and rejects a forged enemy boarding', () => {
    const game = carrierGame([
      { defId: 'rifle', owner: 0, x: 25, z: 12 },
      { defId: 'rifle', owner: 1, x: 26, z: 13 },
    ]);
    const apc = carrier(game);
    const own = rifles(game, 0)[0];
    const enemy = rifles(game, 1)[0];
    const gate = new CommandGate(game, twoSeats());

    const forged = gate.submit(
      1,
      { v: 1, command: { type: 'garrison', ids: [enemy.id], targetId: apc.id } },
      0,
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.code).toBe('friendly-target');

    const accepted = gate.submit(
      0,
      { v: 1, command: { type: 'garrison', ids: [own.id], targetId: apc.id } },
      1000,
    );
    expect(accepted.ok).toBe(true);

    const stolen = gate.submit(1, { v: 1, command: { type: 'ungarrison', ids: [apc.id] } }, 2000);
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.code).toBe('not-your-entity');
  });
});
