import { describe, expect, it } from 'vitest';
import { createEmptyScenario } from '../src/data/scenarios';
import { MAX_QUEUED_ORDERS, SAVE_FORMAT_VERSION, TILE_SIZE } from '../src/sim/constants';
import { Game } from '../src/sim/game';
import { migrateSave } from '../src/sim/saveMigrations';
import { CommandGate } from '../src/multiplayer/commandGate';
import { ownUnit, serverGame, twoSeats } from './phase1-helpers';

function openGame(): Game {
  const scenario = createEmptyScenario(48, 48);
  scenario.settings.fog = false;
  scenario.settings.startingMats = 0;
  scenario.settings.startingReq = 0;
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[0].isAI = false;
  scenario.players[1].startX = 40;
  scenario.players[1].startZ = 40;
  scenario.players[1].isAI = false;
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 8, z: 8 },
    { defId: 'commandPost', owner: 1, x: 40, z: 40 },
  );
  // One hull, well clear of both command posts, on open grass.
  scenario.units.push({ defId: 'tank', owner: 0, x: 12, z: 12 });
  return new Game(scenario, { enableAI: false });
}

function onlyTank(game: Game) {
  const tank = game.entitiesOf(0, 'unit').find((entity) => entity.defId === 'tank');
  if (!tank) throw new Error('Fixture tank is missing.');
  return tank;
}

describe('Phase 1 patrol and queued waypoints', () => {
  it('keeps the current move and starts the queued leg on arrival', () => {
    const game = openGame();
    const tank = onlyTank(game);
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: 18 * TILE_SIZE,
      z: 12 * TILE_SIZE,
    });
    game.tick();
    expect(tank.order?.type).toBe('move');
    const firstX = tank.order?.x ?? 0;

    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: 26 * TILE_SIZE,
      z: 12 * TILE_SIZE,
      queue: true,
    });
    game.tick();
    expect(tank.order?.x).toBe(firstX);
    expect(tank.orderQueue).toHaveLength(1);
    expect(tank.orderQueue?.[0].type).toBe('move');

    game.advance(1_200);
    expect(tank.orderQueue).toBeUndefined();
    expect(Math.hypot(tank.x - 26 * TILE_SIZE, tank.z - 12 * TILE_SIZE)).toBeLessThan(
      2 * TILE_SIZE,
    );
  });

  it('replaces the old queue with a fresh move and refuses beyond the cap', () => {
    const game = openGame();
    const tank = onlyTank(game);
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: 18 * TILE_SIZE,
      z: 12 * TILE_SIZE,
    });
    game.tick();

    for (let i = 0; i < MAX_QUEUED_ORDERS + 1; i++) {
      game.enqueueCommand({
        type: 'move',
        team: 0,
        ids: [tank.id],
        x: (20 + i) * TILE_SIZE,
        z: 12 * TILE_SIZE,
        queue: true,
      });
      game.tick();
    }
    expect(tank.orderQueue).toHaveLength(MAX_QUEUED_ORDERS);

    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: 30 * TILE_SIZE,
      z: 18 * TILE_SIZE,
    });
    game.tick();
    expect(tank.orderQueue).toBeUndefined();
    expect(tank.patrolX).toBeUndefined();
    expect(tank.patrolZ).toBeUndefined();
  });

  it('patrols between the clicked point and the ground it started from', () => {
    const game = openGame();
    const tank = onlyTank(game);
    const originX = tank.x;
    const originZ = tank.z;
    const targetX = 22 * TILE_SIZE;
    const targetZ = 12 * TILE_SIZE;

    game.enqueueCommand({
      type: 'patrol',
      team: 0,
      ids: [tank.id],
      x: targetX,
      z: targetZ,
    });
    game.tick();
    expect(tank.order?.type).toBe('patrol');
    expect(tank.patrolX).toBeCloseTo(originX, 4);
    expect(tank.patrolZ).toBeCloseTo(originZ, 4);

    // Advance in slices until the first leg completes and the endpoints swap;
    // a single long advance could make the whole round trip and hide the turn.
    for (let i = 0; i < 40 && (tank.patrolX ?? originX) <= originX + 4 * TILE_SIZE; i++) {
      game.advance(30);
    }
    expect(tank.order?.type).toBe('patrol');
    expect(Math.hypot(tank.x - targetX, tank.z - targetZ)).toBeLessThan(2 * TILE_SIZE);
    expect(tank.patrolX).toBeGreaterThan(originX + 4 * TILE_SIZE);
    expect(tank.order?.x).toBeCloseTo(originX, 4);

    for (let i = 0; i < 40 && (tank.patrolX ?? originX) > originX + 4 * TILE_SIZE; i++) {
      game.advance(30);
    }
    expect(Math.hypot(tank.x - originX, tank.z - originZ)).toBeLessThan(2 * TILE_SIZE);
    expect(tank.order?.x).toBeCloseTo(targetX, 4);
  });

  it('round-trips queued waypoints and patrol endpoints through a save', () => {
    const game = openGame();
    const tank = onlyTank(game);
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: 18 * TILE_SIZE,
      z: 12 * TILE_SIZE,
    });
    game.tick();
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [tank.id],
      x: 24 * TILE_SIZE,
      z: 12 * TILE_SIZE,
      attackMove: true,
      queue: true,
    });
    game.tick();

    const saved = JSON.parse(JSON.stringify(game.toSave()));
    const restored = Game.fromSave(saved, { enableAI: false });
    expect(restored.stateHash()).toBe(game.stateHash());
    const restoredTank = onlyTank(restored);
    expect(restoredTank.orderQueue).toHaveLength(1);
    expect(restoredTank.orderQueue?.[0].type).toBe('attackMove');
    expect(restoredTank.orderQueue?.[0].x).toBeCloseTo(24 * TILE_SIZE, 4);
  });

  it('migrates a v3 save into the v4 waypoint schema and caps a hostile queue', () => {
    const game = openGame();
    const tank = onlyTank(game);
    const save = JSON.parse(JSON.stringify(game.toSave()));
    save.version = 3;
    const raw = save.state.entities.find(
      (entity: { id: number }) => entity.id === tank.id,
    ) as Record<string, unknown>;
    raw.orderQueue = Array.from({ length: MAX_QUEUED_ORDERS + 2 }, (_, index) => ({
      type: index === 0 ? 'teleport' : 'move',
      x: (14 + index) * TILE_SIZE,
      z: 12 * TILE_SIZE,
    }));

    const migrated = migrateSave(save)!;
    expect(migrated.version).toBe(SAVE_FORMAT_VERSION);
    const migratedRaw = (migrated.state as { entities: Record<string, unknown>[] }).entities.find(
      (entity) => entity.id === tank.id,
    )!;
    expect(migratedRaw.orderQueue).toHaveLength(MAX_QUEUED_ORDERS);
    expect(
      (migratedRaw.orderQueue as Array<{ type: string }>).every(
        (order) => order.type === 'move',
      ),
    ).toBe(true);
  });

  it('accepts patrol and queued moves at the gate and rejects a full queue', () => {
    const game = serverGame();
    const gate = new CommandGate(game, twoSeats());
    const unit = ownUnit(game);

    const patrol = gate.submit(
      0,
      { v: 1, command: { type: 'patrol', ids: [unit.id], x: unit.x + TILE_SIZE, z: unit.z } },
      1_000,
    );
    expect(patrol.ok).toBe(true);
    if (patrol.ok) expect(patrol.command.type).toBe('patrol');

    const queued = gate.submit(
      0,
      {
        v: 1,
        command: { type: 'move', ids: [unit.id], x: unit.x + TILE_SIZE, z: unit.z, queue: true },
      },
      1_200,
    );
    expect(queued.ok).toBe(true);
    if (queued.ok) expect(queued.command).toMatchObject({ type: 'move', queue: true });

    unit.orderQueue = Array.from({ length: MAX_QUEUED_ORDERS }, (_, index) => ({
      type: 'move' as const,
      x: unit.x + (index + 1) * TILE_SIZE,
      z: unit.z,
    }));
    const full = gate.submit(
      0,
      {
        v: 1,
        command: { type: 'move', ids: [unit.id], x: unit.x + TILE_SIZE, z: unit.z, queue: true },
      },
      1_400,
    );
    expect(full).toMatchObject({ ok: false, code: 'queue-full' });
  });
});
