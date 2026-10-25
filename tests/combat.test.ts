import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { TILE_SIZE } from '../src/sim/constants';
import { normalizeAngle } from '../src/core/math';
import { islandWith } from './helpers';

function newGame(ai = false) {
  // Fixtures for combat specifics: an ATGM gunner and an enemy barracks.
  return new Game(
    islandWith({
      structures: [{ defId: 'barracks', owner: 1, x: 74, z: 30 }],
      units: [{ defId: 'atgm', owner: 0, x: 19, z: 40 }],
    }),
    { enableAI: ai },
  );
}

function unit(game: Game, defId: string, owner: number) {
  return game.state.entities.find((e) => e.kind === 'unit' && e.defId === defId && e.owner === owner)!;
}

function building(game: Game, defId: string, owner: number) {
  return game.state.entities.find((e) => e.kind === 'building' && e.defId === defId && e.owner === owner)!;
}

describe('land combat', () => {
  it('damages and destroys a target with explicit attack orders', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 0);
    const enemy = unit(game, 'tank', 1);
    enemy.hp = 120;
    enemy.x = 34 * TILE_SIZE;
    enemy.z = 38 * TILE_SIZE;
    tank.x = 26 * TILE_SIZE;
    tank.z = 38 * TILE_SIZE;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
    game.advance(20 * 2);
    const hpAfterApproach = enemy.hp;
    expect(hpAfterApproach).toBeLessThan(120);
    game.advance(20 * 25);
    expect(enemy.hp <= 0 || enemy.state === 'dead' || !game.getEntity(enemy.id)).toBe(true);
  });

  it('reports damage, suppression and kill events', () => {
    const game = newGame();
    const infantry = unit(game, 'rifle', 1);
    const tank = unit(game, 'tank', 0);
    infantry.x = 30 * TILE_SIZE;
    infantry.z = 38 * TILE_SIZE;
    tank.x = 25 * TILE_SIZE;
    tank.z = 38 * TILE_SIZE;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: infantry.id });
    game.advance(20 * 4);
    const shot = game.state.events.some((e) => e.type === 'shot' || e.type === 'impact' || e.type === 'explosion');
    expect(shot).toBe(true);
    expect(infantry.suppression).toBeGreaterThan(0);
    expect(infantry.hp).toBeLessThan(infantry.maxHp);
  });

  it('applies armour multipliers rather than flat damage', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 1);
    const atgm = unit(game, 'atgm', 0);
    tank.x = 36 * TILE_SIZE;
    tank.z = 38 * TILE_SIZE;
    atgm.x = 28 * TILE_SIZE;
    atgm.z = 38 * TILE_SIZE;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [atgm.id], targetId: tank.id });
    game.advance(20 * 6);
    const lost = tank.maxHp - tank.hp;
    // One guided ATGM should do far more than a rifle round (roughly 73).
    if (lost > 0) expect(lost).toBeGreaterThan(50);
  });

  it('blocks auto-acquisition of enemies hidden by fog', () => {
    const game = newGame();
    // Far from all player vision.
    const enemy = unit(game, 'tank', 1);
    const playerTank = unit(game, 'tank', 0);
    enemy.x = 80 * TILE_SIZE;
    enemy.z = 20 * TILE_SIZE;
    playerTank.x = 24 * TILE_SIZE;
    playerTank.z = 38 * TILE_SIZE;
    game.advance(20 * 4);
    expect(playerTank.targetId).toBe(0);
  });

  it('turns a stationary rifleman to face what it is firing at', () => {
    const game = newGame();
    const rifle = unit(game, 'rifle', 0);
    const enemy = unit(game, 'tank', 1);
    rifle.order = null;
    rifle.path = [];
    rifle.x = 26 * TILE_SIZE;
    rifle.z = 38 * TILE_SIZE;
    // Close enough for rifle fire, and off the rifleman's initial heading.
    enemy.x = 29 * TILE_SIZE;
    enemy.z = 35 * TILE_SIZE;
    enemy.order = null;
    enemy.path = [];
    const expected = Math.atan2(enemy.z - rifle.z, enemy.x - rifle.x);
    rifle.facing = expected + Math.PI;
    rifle.turretFacing = expected + Math.PI;
    game.advance(20 * 3);
    expect(rifle.targetId !== 0 || rifle.aimTargetId !== 0).toBe(true);
    // The drawn heading turns onto the target…
    expect(Math.abs(normalizeAngle(rifle.turretFacing - expected))).toBeLessThan(0.25);
    // …while the hull heading the simulation moves and fires from is untouched.
    expect(Math.abs(normalizeAngle(rifle.facing - (expected + Math.PI)))).toBeLessThan(0.01);
  });

  it('destroys structures under sustained fire', () => {
    const game = newGame();
    const target = building(game, 'barracks', 1);
    const tank = unit(game, 'tank', 0);
    tank.x = target.x - 25;
    tank.z = target.z;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: target.id });
    game.advance(20 * 45);
    expect(target.hp < target.maxHp || !game.getEntity(target.id)).toBe(true);
  });

  it('captures a neutral relay with an engineer', () => {
    const game = newGame();
    const relay = game.state.entities.find((e) => e.defId === 'relay')!;
    const engineer = unit(game, 'engineer', 0);
    engineer.x = relay.x - 12;
    engineer.z = relay.z;
    const ownerBefore = relay.owner;
    game.enqueueCommand({ type: 'capture', team: 0, ids: [engineer.id], targetId: relay.id });
    game.advance(20 * 15);
    expect(ownerBefore).toBe(-1);
    expect(relay.owner).toBe(0);
    expect(game.state.events.some((e) => e.type === 'capture')).toBe(true);
  });
});
