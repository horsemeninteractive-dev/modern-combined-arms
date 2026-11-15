import { describe, expect, it } from 'vitest';
import { createEmptyScenario } from '../src/data/scenarios';
import { CommandGate } from '../src/multiplayer/commandGate';
import { TILE_SIZE } from '../src/sim/constants';
import { Game } from '../src/sim/game';
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
  scenario.units.push(
    { defId: 'tank', owner: 0, x: 12, z: 12 },
    { defId: 'rifle', owner: 0, x: 12, z: 18 },
  );
  return new Game(scenario, { enableAI: false });
}

function units(game: Game) {
  const target = game.entitiesOf(0, 'unit').find((entity) => entity.defId === 'tank');
  const guard = game.entitiesOf(0, 'unit').find((entity) => entity.defId === 'rifle');
  if (!target || !guard) throw new Error('Guard fixture units are missing.');
  return { target, guard };
}

describe('Phase 1 guard command', () => {
  it('follows a friendly unit that moves away', () => {
    const game = openGame();
    const { target, guard } = units(game);
    const startX = guard.x;
    game.enqueueCommand({
      type: 'guard',
      team: 0,
      ids: [guard.id],
      targetId: target.id,
    });
    game.tick();
    expect(guard.order).toMatchObject({ type: 'guard', targetId: target.id });

    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [target.id],
      x: 26 * TILE_SIZE,
      z: 12 * TILE_SIZE,
    });
    game.advance(2_400);

    expect(guard.order?.type).toBe('guard');
    expect(guard.order?.targetId).toBe(target.id);
    expect(guard.x).toBeGreaterThan(startX + 4 * TILE_SIZE);
    expect(Math.hypot(guard.x - target.x, guard.z - target.z)).toBeLessThan(6 * TILE_SIZE);
  });

  it('releases the guard when the protected unit is destroyed', () => {
    const game = openGame();
    const { target, guard } = units(game);
    game.enqueueCommand({
      type: 'guard',
      team: 0,
      ids: [guard.id],
      targetId: target.id,
    });
    game.tick();
    target.hp = 0;
    game.tick();
    expect(guard.order).toBeNull();
    expect(guard.state).toBe('idle');
  });

  it('round-trips the guard target through a save', () => {
    const game = openGame();
    const { target, guard } = units(game);
    game.enqueueCommand({
      type: 'guard',
      team: 0,
      ids: [guard.id],
      targetId: target.id,
    });
    game.tick();
    game.advance(40);

    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), {
      enableAI: false,
    });
    expect(restored.stateHash()).toBe(game.stateHash());
    const restoredGuard = restored.entitiesOf(0, 'unit').find((entity) => entity.id === guard.id)!;
    expect(restoredGuard.order).toMatchObject({ type: 'guard', targetId: target.id });
  });

  it('accepts a friendly guard target at the gate and rejects invalid ones', () => {
    const game = serverGame();
    const gate = new CommandGate(game, twoSeats());
    const units = game.entitiesOf(0, 'unit');
    const target = units[0];
    const guard = units[1];

    const accepted = gate.submit(
      0,
      { v: 1, command: { type: 'guard', ids: [guard.id], targetId: target.id } },
      1_000,
    );
    expect(accepted).toMatchObject({ ok: true, command: { type: 'guard', targetId: target.id } });

    const onlyTarget = gate.submit(
      0,
      { v: 1, command: { type: 'guard', ids: [target.id], targetId: target.id } },
      1_200,
    );
    expect(onlyTarget).toMatchObject({ ok: false, code: 'no-controllable-entity' });

    const building = game.entitiesOf(0, 'building')[0];
    const wrongKind = gate.submit(
      0,
      { v: 1, command: { type: 'guard', ids: [guard.id], targetId: building.id } },
      1_400,
    );
    expect(wrongKind).toMatchObject({ ok: false, code: 'wrong-entity-type' });

    const enemy = ownUnit(game, 1);
    const hostile = gate.submit(
      0,
      { v: 1, command: { type: 'guard', ids: [guard.id], targetId: enemy.id } },
      1_600,
    );
    expect(hostile.ok).toBe(false);
  });
});
