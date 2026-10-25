import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { TILE_SIZE } from '../src/sim/constants';
import { createIslandAssault } from '../src/data/scenarios';
import { UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';

function gameWithAiOff(scenario = createIslandAssault()): Game {
  return new Game(scenario, { enableAI: false });
}

function secondsToKill(game: Game, target: { hp: number; id: number }, limit: number): number {
  const start = game.state.tick;
  while (game.state.tick - start < 20 * limit) {
    game.tick();
    const alive = game.getEntity(target.id);
    if (!alive || alive.hp <= 0) return (game.state.tick - start) / 20;
  }
  return Infinity;
}

describe('combat timing balance', () => {
  it('resolves a main-battle-tank duel in a decisive window', () => {
    const game = gameWithAiOff();
    const player = game.entitiesOf(0, 'unit').find((e) => e.defId === 'tank')!;
    const enemy = game.entitiesOf(1, 'unit').find((e) => e.defId === 'tank')!;
    player.x = 30 * TILE_SIZE;
    player.z = 38 * TILE_SIZE;
    enemy.x = 36 * TILE_SIZE;
    enemy.z = 38 * TILE_SIZE;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [player.id], targetId: enemy.id });
    const seconds = secondsToKill(game, enemy, 30);
    expect(Number.isFinite(seconds)).toBe(true);
    // A 540 hp MBT must not soak half a minute of 120mm fire.
    expect(seconds).toBeLessThan(24);
  });

  it('makes the anti-tank gun a real answer to a single MBT', () => {
    const scenario = createIslandAssault();
    scenario.structures.push({ defId: 'atTurret', owner: 0, x: 34, z: 34 });
    scenario.units.push({ defId: 'tank', owner: 1, x: 38, z: 34 });
    const game = gameWithAiOff(scenario);
    const gun = game.entitiesOf(0, 'building').find((e) => e.defId === 'atTurret')!;
    const tank = game.state.entities.find(
      (e) =>
        e.kind === 'unit' &&
        e.defId === 'tank' &&
        e.owner === 1 &&
        e.x < 50 * TILE_SIZE,
    )!;
    const seconds = secondsToKill(game, tank, 24);
    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeLessThan(18);
    expect(gun.hp).toBeGreaterThan(0);
  });

  it('keeps the stat-derived tank duel out of the old attrition band', () => {
    const gun = WEAPONS.tankGun;
    const dps = (gun.damage * (gun.multipliers.heavy ?? 1) * gun.accuracy) / gun.cooldown;
    expect(UNITS.tank.hp / dps).toBeLessThan(18);
    expect(WEAPONS.atTurretGun.multipliers.heavy ?? 0).toBeGreaterThan(1.5);
  });
});
