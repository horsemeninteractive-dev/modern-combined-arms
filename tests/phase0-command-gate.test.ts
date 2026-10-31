import { describe, expect, it } from 'vitest';
import { createIslandAssault } from '../src/data/scenarios';
import { Game } from '../src/sim/game';
import { gateCommand, type Seat } from '../phase0/commandGate';

function gameWith(fog = true): Game {
  const scenario = createIslandAssault();
  scenario.settings.fog = fog;
  return new Game(scenario, { enableAI: false });
}

function ownUnit(game: Game, team: number) {
  const unit = game.state.entities.find(
    (entity) => entity.kind === 'unit' && entity.hp > 0 && game.teamOf(entity.owner) === team,
  );
  if (!unit) throw new Error(`no unit for team ${team}`);
  return unit;
}

function enemyUnit(game: Game, team: number, visible: boolean) {
  const unit = game.state.entities.find(
    (entity) =>
      entity.kind === 'unit' &&
      entity.hp > 0 &&
      game.teamOf(entity.owner) !== team &&
      game.isVisibleTo(team, entity.id) === visible,
  );
  if (!unit) throw new Error(`no ${visible ? 'visible' : 'hidden'} enemy unit`);
  return unit;
}

const seatZero: Seat = { seat: 0, team: 0 };

describe('phase-0 command gate', () => {
  it('ignores a forged team and substitutes the seat team', () => {
    const game = gameWith();
    const unit = ownUnit(game, 0);
    const result = gateCommand(game, seatZero, {
      type: 'stop',
      team: 1,
      ids: [unit.id],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command).toEqual({ type: 'stop', team: 0, ids: [unit.id] });
  });

  it('rejects ids owned by the other team', () => {
    const game = gameWith();
    const enemy = enemyUnit(game, 0, false);
    const result = gateCommand(game, seatZero, {
      type: 'move',
      ids: [enemy.id],
      x: 10,
      z: 10,
    });
    expect(result).toEqual({ ok: false, reason: 'not-your-unit' });
  });

  it('rejects a hidden attack target', () => {
    const game = gameWith(true);
    const unit = ownUnit(game, 0);
    const hidden = enemyUnit(game, 0, false);
    const result = gateCommand(game, seatZero, {
      type: 'attack',
      ids: [unit.id],
      targetId: hidden.id,
    });
    expect(result).toEqual({ ok: false, reason: 'target-hidden' });
  });

  it('accepts a visible attack target', () => {
    const game = gameWith(false);
    const unit = ownUnit(game, 0);
    const visible = enemyUnit(game, 0, true);
    const result = gateCommand(game, seatZero, {
      type: 'attack',
      ids: [unit.id],
      targetId: visible.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command).toEqual({
      type: 'attack',
      team: 0,
      ids: [unit.id],
      targetId: visible.id,
    });
  });

  it('rejects out-of-bounds and non-finite movement', () => {
    const game = gameWith();
    const unit = ownUnit(game, 0);
    const outside = gateCommand(game, seatZero, {
      type: 'move',
      ids: [unit.id],
      x: game.state.map.width * 4 + 1,
      z: 10,
    });
    expect(outside).toEqual({ ok: false, reason: 'out-of-bounds' });
    const nan = gateCommand(game, seatZero, {
      type: 'move',
      ids: [unit.id],
      x: Number.NaN,
      z: 10,
    });
    expect(nan).toEqual({ ok: false, reason: 'out-of-bounds' });
  });

  it('rejects unknown command types and malformed id lists', () => {
    const game = gameWith();
    const unit = ownUnit(game, 0);
    expect(
      gateCommand(game, seatZero, { type: 'produce', ids: [unit.id], buildingId: unit.id, defId: 'rifle' }),
    ).toEqual({ ok: false, reason: 'command-not-allowed' });
    expect(gateCommand(game, seatZero, { type: 'stop', ids: [] })).toEqual({
      ok: false,
      reason: 'invalid-ids',
    });
    expect(gateCommand(game, seatZero, { type: 'stop', ids: [unit.id, unit.id] }).ok).toBe(true);
  });
});
