import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { TICK_RATE, TILE_SIZE } from '../src/sim/constants';
import { islandWith } from './helpers';
import { UNITS } from '../src/data/units';
import { angleTo, normalizeAngle, rotateLocalOffset } from '../src/core/math';
import { muzzleHeight, muzzleWorldOffset } from '../src/sim/hardpoints';
import { turretModelMatrix } from '../src/render/unitTransform';
import type { Entity, Projectile } from '../src/sim/types';

function newGame(): Game {
  // Naval fixtures; the landing force no longer starts with corvettes.
  return new Game(
    islandWith({
      units: [
        { defId: 'corvette', owner: 0, x: 9, z: 42 },
        { defId: 'corvette', owner: 1, x: 66, z: 48 },
      ],
    }),
    { enableAI: false },
  );
}

function unit(game: Game, defId: string, owner: number): Entity {
  return game.state.entities.find((e) => e.kind === 'unit' && e.defId === defId && e.owner === owner)!;
}

function place(e: Entity, tileX: number, tileZ: number): void {
  e.x = tileX * TILE_SIZE;
  e.z = tileZ * TILE_SIZE;
}

/**
 * Advance until the given unit fires, returning its first projectile. Filtering
 * by shooter matters: nearby friendlies auto-engage and fill the projectile
 * list in the same ticks.
 */
function firstShot(
  game: Game,
  shooterId: number,
  limit = 400,
): { shot: Projectile; shooter: Entity } {
  for (let i = 0; i < limit; i++) {
    const seq = game.state.eventSeq;
    game.tick();
    // Detect the shot on the tick it was fired, so the shooter's turret angle
    // is still the one used to lay the barrel.
    const fired = game.state.events.some(
      (e) => e.seq >= seq && e.type === 'shot' && e.entityId === shooterId,
    );
    if (!fired) continue;
    const shot = game.state.projectiles.find((p) => p.shooterId === shooterId);
    if (shot) {
      const shooter = game.getEntity(shot.shooterId)!;
      return { shot, shooter };
    }
  }
  throw new Error('no projectile was fired');
}

/**
 * The projectile has already advanced one tick by the time a test can read it,
 * so step it back along its own flight line to recover the spawn point.
 */
function projectileOrigin(p: Projectile): { x: number; y: number; z: number } {
  const dx = p.tx - p.x;
  const dy = p.ty - p.y;
  const dz = p.tz - p.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  const step = (p.speed * TILE_SIZE) / TICK_RATE;
  return { x: p.x - (dx / d) * step, y: p.y - (dy / d) * step, z: p.z - (dz / d) * step };
}

/** Position on the matrix of turretModelMatrix (column-major). */
function matrixPoint(m: Float32Array): { x: number; y: number; z: number } {
  return { x: m[12], y: m[13], z: m[14] };
}

describe('local hardpoint transforms', () => {
  it('rotates an asymmetric offset correctly at every cardinal heading', () => {
    const forward = 3;
    const lateral = 1;
    const cases: Array<[number, number, number]> = [
      [0, 3, 1],
      [Math.PI / 2, -1, 3],
      [Math.PI, -3, -1],
      [(Math.PI * 3) / 2, 1, -3],
    ];
    for (const [heading, x, z] of cases) {
      const p = rotateLocalOffset(forward, lateral, heading);
      expect(p.x).toBeCloseTo(x, 10);
      expect(p.z).toBeCloseTo(z, 10);
    }
  });

  it('rotates correctly at an intermediate angle', () => {
    const p = rotateLocalOffset(2, 1, Math.PI / 4);
    expect(p.x).toBeCloseTo((2 - 1) / Math.SQRT2, 10);
    expect(p.z).toBeCloseTo((2 + 1) / Math.SQRT2, 10);
  });

  it('does not mirror the offset when the body turns', () => {
    const at0 = rotateLocalOffset(4.7, 0, 0);
    const at90 = rotateLocalOffset(4.7, 0, Math.PI / 2);
    expect(at0.z).toBeCloseTo(0, 10);
    // The bow point swings to +Z for a +90° heading; a mirrored transform would
    // put it at -Z, which is the defect this test locks down.
    expect(at90.x).toBeCloseTo(0, 10);
    expect(at90.z).toBeCloseTo(4.7, 10);
  });
});

describe('turret mount matrices', () => {
  it('keeps the turret attached to the hull at cardinal headings', () => {
    const offset: [number, number, number] = [4.7, 1.5, 0];
    const scale = 0.42;
    for (const facing of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
      const m = turretModelMatrix(10, 2, 20, facing, 0, offset, scale, scale);
      const mount = matrixPoint(m);
      const expected = rotateLocalOffset(offset[0], offset[2], facing);
      // The matrix is Float32, so compare at single-precision tolerance.
      expect(mount.x).toBeCloseTo(10 + expected.x * scale, 3);
      expect(mount.z).toBeCloseTo(20 + expected.z * scale, 3);
      expect(mount.y).toBeCloseTo(2 + offset[1] * scale, 3);
    }
  });

  it('rotates the turret about its mount, not about the hull origin', () => {
    const offset: [number, number, number] = [2, 1, 1];
    const m = turretModelMatrix(5, 0, 5, Math.PI / 2, 0, offset, 1, 1);
    const mount = matrixPoint(m);
    const expected = rotateLocalOffset(offset[0], offset[2], Math.PI / 2);
    expect(mount.x).toBeCloseTo(5 + expected.x, 10);
    expect(mount.z).toBeCloseTo(5 + expected.z, 10);
  });
});

describe('muzzle hardpoints', () => {
  it('follows the turret for turreted weapons and the hull otherwise', () => {
    const tank = UNITS.tank;
    const facingEast = muzzleWorldOffset(tank, 0, Math.PI / 2);
    // Turret laid south while the hull faces east.
    expect(facingEast.x).toBeCloseTo(0, 10);
    expect(facingEast.z).toBeCloseTo(tank.muzzle!.forward, 10);

    const rifle = UNITS.rifle;
    const hullOnly = muzzleWorldOffset(rifle, Math.PI / 2, -Math.PI / 2);
    expect(hullOnly.x).toBeCloseTo(0, 10);
    expect(hullOnly.z).toBeCloseTo(rifle.muzzle!.forward, 10);
  });

  it('reports the authored barrel height', () => {
    expect(muzzleHeight(UNITS.tank)).toBeCloseTo(UNITS.tank.muzzle!.height, 10);
    expect(muzzleHeight(undefined)).toBe(1.5);
  });
});

describe('turret aiming state', () => {
  it('lays the turret on an ordered target in each cardinal direction', () => {
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const game = newGame();
      const tank = unit(game, 'tank', 0);
      const enemy = unit(game, 'tank', 1);
      place(tank, 26, 38);
      place(enemy, 26 + dx * 3, 38 + dz * 3);
      game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
      game.advance(30);
      const bearing = angleTo(tank.x, tank.z, enemy.x, enemy.z);
      expect(Math.abs(normalizeAngle(tank.turretFacing - bearing))).toBeLessThan(0.02);
      expect(tank.aimTargetId).toBe(enemy.id);
    }
  });

  it('turns the short way across the ±π wraparound', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 0);
    const enemy = unit(game, 'tank', 1);
    place(tank, 30, 38);
    place(enemy, 26, 38);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
    // Aim just short of straight west; the shot bearing is just past -π.
    tank.turretFacing = 3.1;
    const before = tank.turretFacing;
    game.tick();
    const step = normalizeAngle(tank.turretFacing - before);
    expect(step).toBeGreaterThan(0);
    expect(Math.abs(step)).toBeLessThan(0.2);
    expect(Math.abs(tank.turretFacing)).toBeGreaterThan(3.1);
  });

  it('keeps tracking a target while the hull turns', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 0);
    const enemy = unit(game, 'tank', 1);
    place(tank, 26, 38);
    place(enemy, 32, 38);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
    game.advance(20);
    const bearing = angleTo(tank.x, tank.z, enemy.x, enemy.z);
    expect(Math.abs(normalizeAngle(tank.turretFacing - bearing))).toBeLessThan(0.05);
    tank.facing = Math.PI;
    game.advance(20);
    const bearingAfter = angleTo(tank.x, tank.z, enemy.x, enemy.z);
    expect(Math.abs(normalizeAngle(tank.turretFacing - bearingAfter))).toBeLessThan(0.05);
  });

  it('swings to a new target on the other side of the hull', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 0);
    const east = unit(game, 'tank', 1);
    const second = game.state.entities.filter((e) => e.kind === 'unit' && e.defId === 'tank' && e.owner === 1)[1];
    place(tank, 26, 38);
    place(east, 30, 38);
    place(second, 22, 38);
    second.hp = 9999;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: east.id });
    game.advance(10);
    expect(tank.aimTargetId).toBe(east.id);
    expect(Math.abs(normalizeAngle(tank.turretFacing - 0))).toBeLessThan(0.1);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: second.id });
    game.tick();
    expect(tank.aimTargetId).toBe(second.id);
    // It turns toward a bearing just short of ±π rather than the long way round.
    const step = Math.abs(normalizeAngle(tank.turretFacing));
    expect(step).toBeGreaterThan(0.1);
    game.advance(40);
    const bearing = angleTo(tank.x, tank.z, second.x, second.z);
    expect(Math.abs(normalizeAngle(tank.turretFacing - bearing))).toBeLessThan(0.05);
  });

  it('limits traverse to the authored turret rate', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 0);
    const enemy = unit(game, 'tank', 1);
    place(tank, 26, 38);
    place(enemy, 26, 42);
    tank.facing = 0;
    tank.turretFacing = 0;
    // Hold fire so the traverse limit is measured between shots; a shot itself
    // always leaves the barrel exactly on bearing.
    tank.cooldown = 30;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
    game.tick();
    const step = Math.abs(normalizeAngle(tank.turretFacing));
    expect(step).toBeLessThanOrEqual(UNITS.tank.turretRate! / 20 + 1e-9);
    expect(step).toBeGreaterThan(0);
  });

  it('clears aim state when the unit is stopped', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 0);
    const enemy = unit(game, 'tank', 1);
    place(tank, 26, 38);
    place(enemy, 32, 38);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
    game.advance(5);
    expect(tank.aimTargetId).toBe(enemy.id);
    game.enqueueCommand({ type: 'stop', team: 0, ids: [tank.id] });
    game.tick();
    expect(tank.aimTargetId).toBe(0);
  });

  it('drops the old aim when given a new move order', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 0);
    const enemy = unit(game, 'tank', 1);
    place(tank, 26, 38);
    place(enemy, 32, 38);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
    game.advance(5);
    expect(tank.aimTargetId).toBe(enemy.id);
    game.enqueueCommand({ type: 'move', team: 0, ids: [tank.id], x: tank.x + 8, z: tank.z });
    game.tick();
    expect(tank.aimTargetId).toBe(0);
    game.advance(40);
    expect(Math.abs(normalizeAngle(tank.turretFacing - tank.facing))).toBeLessThan(0.1);
  });

  it('clears aim state and returns to the hull heading when the target dies', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 0);
    const enemy = unit(game, 'tank', 1);
    place(tank, 26, 38);
    place(enemy, 32, 38);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
    game.advance(20);
    expect(tank.aimTargetId).toBe(enemy.id);
    enemy.hp = 0;
    game.tick();
    expect(tank.aimTargetId).toBe(0);
    tank.facing = Math.PI / 2;
    game.advance(40);
    expect(Math.abs(normalizeAngle(tank.turretFacing - tank.facing))).toBeLessThan(0.05);
  });
});

describe('muzzle origins in the real firing path', () => {
  it('spawns tank rounds at the barrel tip for every cardinal bearing', () => {
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const game = newGame();
      const tank = unit(game, 'tank', 0);
      const enemy = unit(game, 'tank', 1);
      place(tank, 26, 38);
      place(enemy, 26 + dx * 4, 38 + dz * 4);
      game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
      const { shot, shooter } = firstShot(game, tank.id);
      const origin = projectileOrigin(shot);
      const hp = UNITS.tank.muzzle!;
      const offset = rotateLocalOffset(hp.forward, 0, shooter.turretFacing);
      expect(origin.x).toBeCloseTo(shooter.x + offset.x, 5);
      expect(origin.z).toBeCloseTo(shooter.z + offset.z, 5);
      expect(origin.y).toBeCloseTo(game.heightAt(shooter.x, shooter.z) + hp.height, 5);
      // The round leaves along the turret's own line, whatever the target did
      // after the shot: origin direction == turret heading.
      expect(
        Math.abs(normalizeAngle(angleTo(shooter.x, shooter.z, origin.x, origin.z) - shooter.turretFacing)),
      ).toBeLessThan(1e-6);
    }
  });

  it('fires from the turret when it is laid away from the hull', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 0);
    const enemy = unit(game, 'tank', 1);
    place(tank, 26, 38);
    place(enemy, 22, 34);
    tank.facing = 0;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
    const { shot, shooter } = firstShot(game, tank.id);
    const origin = projectileOrigin(shot);
    const hp = UNITS.tank.muzzle!;
    const hullOffset = rotateLocalOffset(hp.forward, 0, shooter.facing);
    const turretOffset = rotateLocalOffset(hp.forward, 0, shooter.turretFacing);
    expect(origin.x).toBeCloseTo(shooter.x + turretOffset.x, 5);
    expect(origin.z).toBeCloseTo(shooter.z + turretOffset.z, 5);
    // Guard against the old behaviour: the hull-nose origin differs materially.
    expect(Math.hypot(turretOffset.x - hullOffset.x, turretOffset.z - hullOffset.z)).toBeGreaterThan(1);
  });

  it('keeps fixed-forward weapons on the hull nose', () => {
    const game = newGame();
    const rifle = unit(game, 'rifle', 0);
    const enemy = unit(game, 'rifle', 1);
    place(rifle, 26, 38);
    // Keep the target beyond one tick of bullet travel (60 tiles/s at 20 Hz)
    // so the projectile is still alive when the shot is inspected.
    place(enemy, 30, 38);
    // Fixed-forward weapons fire on the hull bearing, so line the hull up
    // first; otherwise the shot can leave mid-turn by a fraction of a degree.
    const aim = Math.atan2(enemy.z - rifle.z, enemy.x - rifle.x);
    rifle.facing = aim;
    // Auto-engagement fires from a standing start; an explicit attack order
    // would walk the rifleman while it shoots and move the origin under test.
    const { shot, shooter } = firstShot(game, rifle.id);
    const origin = projectileOrigin(shot);
    const hp = UNITS.rifle.muzzle!;
    const offset = rotateLocalOffset(hp.forward, 0, aim);
    expect(origin.x).toBeCloseTo(shooter.x + offset.x, 5);
    expect(origin.z).toBeCloseTo(shooter.z + offset.z, 5);
    expect(origin.y).toBeCloseTo(game.heightAt(shooter.x, shooter.z) + hp.height, 5);
  });

  it('spawns a hit shot on the target and reports the muzzle height in the event', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 0);
    const enemy = unit(game, 'tank', 1);
    place(tank, 26, 38);
    place(enemy, 30, 38);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
    let hit: Projectile | null = null;
    let firedAt = -1;
    for (let i = 0; i < 400 && !hit; i++) {
      game.tick();
      const p = game.state.projectiles.find((s) => s.targetId !== 0 && s.shooterId === tank.id);
      if (p) {
        hit = p;
        firedAt = game.state.tick;
      }
    }
    expect(hit).not.toBeNull();
    if (!hit) return;
    expect(hit.tx).toBeCloseTo(enemy.x, 6);
    expect(hit.tz).toBeCloseTo(enemy.z, 6);
    const shotEvent = game.state.events.find(
      (e) => e.type === 'shot' && e.entityId === tank.id && e.tick === firedAt,
    )!;
    expect(shotEvent.y).toBeDefined();
    expect(shotEvent.y!).toBeCloseTo(projectileOrigin(hit).y, 6);
  });
});

describe('aim state persistence', () => {
  it('round-trips turret and aim target through a save', () => {
    const game = newGame();
    const tank = unit(game, 'tank', 0);
    const enemy = unit(game, 'tank', 1);
    place(tank, 26, 38);
    place(enemy, 32, 38);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: enemy.id });
    game.advance(12);
    const restored = Game.fromSave(game.toSave());
    const savedTank = restored.getEntity(tank.id)!;
    expect(savedTank.turretFacing).toBeCloseTo(tank.turretFacing, 10);
    expect(savedTank.aimTargetId).toBe(tank.aimTargetId);
    expect(savedTank.facing).toBeCloseTo(tank.facing, 10);
  });
});

describe('hardpoint data integrity', () => {
  it('gives every turreted hardpoint a traverse rate', () => {
    for (const def of Object.values(UNITS)) {
      if (def.muzzle?.turreted) {
        expect(def.turretRate, `${def.id} needs a turretRate`).toBeGreaterThan(0);
      }
    }
  });

  it('only fights from a hardpoint on armed units', () => {
    for (const def of Object.values(UNITS)) {
      const armed = def.weapons.length > 0;
      expect(!!def.muzzle, `${def.id} muzzle`).toBe(armed);
    }
  });
});

describe('naval weapon geometry', () => {
  it('keeps the corvette gun mount on the bow as the hull turns', () => {
    const game = newGame();
    const ship = unit(game, 'corvette', 0);
    const offset = [4.7, 1.5, 0] as [number, number, number];
    const scale = 0.42;
    for (const facing of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
      const m = turretModelMatrix(ship.x, 0, ship.z, facing, facing, offset, scale, scale);
      const mount = matrixPoint(m);
      const expected = rotateLocalOffset(offset[0], offset[2], facing);
      expect(mount.x).toBeCloseTo(ship.x + expected.x * scale, 3);
      expect(mount.z).toBeCloseTo(ship.z + expected.z * scale, 3);
      // The mount stays forward of the hull centre, never behind it.
      expect((mount.x - ship.x) * Math.cos(facing) + (mount.z - ship.z) * Math.sin(facing)).toBeGreaterThan(0);
    }
  });

  it('fires the corvette from its bow hardpoint while the hull faces elsewhere', () => {
    const game = newGame();
    const ship = unit(game, 'corvette', 0);
    const enemy = unit(game, 'corvette', 1);
    // Open sea south of the island.
    ship.x = 20 * TILE_SIZE;
    ship.z = 60 * TILE_SIZE;
    ship.facing = 0;
    ship.ammo = ship.maxAmmo;
    enemy.x = 23 * TILE_SIZE;
    enemy.z = 62 * TILE_SIZE;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [ship.id], targetId: enemy.id });
    const { shot, shooter } = firstShot(game, ship.id, 600);
    const origin = projectileOrigin(shot);
    const hp = UNITS.corvette.muzzle!;
    const offset = rotateLocalOffset(hp.forward, 0, shooter.turretFacing);
    expect(origin.x).toBeCloseTo(shooter.x + offset.x, 5);
    expect(origin.z).toBeCloseTo(shooter.z + offset.z, 5);
    expect(origin.y).toBeCloseTo(game.heightAt(shooter.x, shooter.z) + hp.height, 5);
    expect(
      Math.abs(normalizeAngle(angleTo(shooter.x, shooter.z, origin.x, origin.z) - shooter.turretFacing)),
    ).toBeLessThan(1e-4);
  });
});
