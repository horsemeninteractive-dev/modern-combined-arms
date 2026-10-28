import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/sim/game';
import { TILE_SIZE } from '../src/sim/constants';
import { ParticleSystem } from '../src/render/particles';
import {
  sampleProjectile,
  staticMuzzleAnchor,
  weaponFxClass,
  weaponFxProfile,
} from '../src/render/combatFx';
import { islandWith } from './helpers';

describe('combat presentation profiles', () => {
  it('separates rifle, ATGM and tank-gun signatures', () => {
    expect(weaponFxClass('rifle')).toBe('smallArms');
    expect(weaponFxClass('atgm')).toBe('missile');
    expect(weaponFxClass('tankGun')).toBe('cannon');

    const rifle = weaponFxProfile('rifle');
    const atgm = weaponFxProfile('atgm');
    const tank = weaponFxProfile('tankGun');

    expect(rifle.explosionScale).toBe(0);
    expect(tank.explosionScale).toBeGreaterThan(0);
    expect(atgm.tracerLength).toBeGreaterThan(rifle.tracerLength);
    expect(atgm.tracerLength).toBeGreaterThan(tank.tracerLength);
    expect(tank.tracerWidth).toBeGreaterThan(rifle.tracerWidth);
    expect(atgm.muzzleSmoke).toBeGreaterThan(tank.muzzleSmoke);
    expect(atgm.trailSmoke).toBe(true);
    expect(rifle.trailSmoke).toBe(false);
  });

  it('falls back safely for a weapon this build does not know', () => {
    expect(weaponFxClass('missing-weapon')).toBe('unknown');
    const fallback = weaponFxProfile('missing-weapon');
    expect(fallback.class).toBe('unknown');
    expect(fallback.explosionScale).toBeGreaterThan(0);
    expect(fallback.tracerSegments).toBeGreaterThan(0);
  });

  it('interpolates a projectile between the last two simulation positions', () => {
    const previous = { x: 0, y: 1, z: 0 };
    const current = { x: 3, y: 1, z: 6 };
    expect(sampleProjectile(previous, current, 0)).toEqual(previous);
    expect(sampleProjectile(previous, current, 0.5)).toEqual({ x: 1.5, y: 1, z: 3 });
    expect(sampleProjectile(previous, current, 2)).toEqual(current);
  });
});

describe('static weapon muzzle anchors', () => {
  it('puts the anti-tank gun flash at the end of its barrel', () => {
    const anchor = staticMuzzleAnchor('atTurret', 100, 2, 50, 0, 0);
    expect(anchor).not.toBeNull();
    expect(anchor!.x).toBeGreaterThan(103);
    expect(anchor!.y).toBeGreaterThan(2.5);
    expect(Math.abs(anchor!.z - 50)).toBeLessThan(0.2);
  });

  it('keeps the coastal launcher flash above and ahead of its deck', () => {
    const anchor = staticMuzzleAnchor('coastalBattery', 100, 2, 50, 0, 0);
    expect(anchor).not.toBeNull();
    expect(anchor!.x).toBeGreaterThan(102);
    expect(anchor!.y).toBeGreaterThan(4);
    expect(Math.abs(anchor!.z - 50)).toBeLessThan(0.2);
  });

  it('rotates the anchor with the turret instead of leaving it at the centre', () => {
    const turned = staticMuzzleAnchor('atTurret', 100, 2, 50, 0, Math.PI / 2);
    expect(turned).not.toBeNull();
    expect(Math.abs(turned!.x - 100)).toBeLessThan(0.2);
    expect(turned!.z - 50).toBeGreaterThan(3);
  });

  it('returns no anchor for a building without a traversing weapon', () => {
    expect(staticMuzzleAnchor('factory', 100, 2, 50, 0, 0)).toBeNull();
  });
});

describe('combat event metadata', () => {
  it('carries weapon and impact information to the renderer', () => {
    const game = new Game(
      islandWith({
        units: [{ defId: 'atgm', owner: 0, x: 28, z: 38 }],
      }),
      { enableAI: false },
    );
    const atgm = game.state.entities.find((e) => e.kind === 'unit' && e.defId === 'atgm')!;
    const target = game.state.entities.find(
      (e) => e.kind === 'unit' && e.defId === 'tank' && e.owner === 1,
    )!;
    target.x = 33 * TILE_SIZE;
    target.z = 38 * TILE_SIZE;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [atgm.id], targetId: target.id });
    game.advance(20 * 8);

    const shot = game.state.events.find((e) => e.type === 'shot' && e.weaponId === 'atgm');
    expect(shot).toBeDefined();
    expect(typeof shot!.y).toBe('number');

    const impact = game.state.events.find(
      (e) => (e.type === 'impact' || e.type === 'explosion') && e.weaponId === 'atgm',
    );
    expect(impact).toBeDefined();
    expect(typeof impact!.y).toBe('number');
    expect(impact!.surface).toBeDefined();
    expect(['ground', 'water', 'armour', 'structure', 'air']).toContain(impact!.surface);
  });
});

describe('destruction feedback', () => {
  it('uses a bounded wreck rather than a second full explosion', () => {
    const particles = new ParticleSystem();
    particles.explosion(0, 0, 0, 1);
    const explosionCount = particles.particles.length;
    const explosionMaxSize = Math.max(...particles.particles.map((p) => p.size1));

    particles.clear();
    particles.wreck(0, 0, 0, 1, true);
    const wreckCount = particles.particles.length;
    const wreckMaxSize = Math.max(...particles.particles.map((p) => p.size1));

    expect(wreckCount).toBeLessThan(explosionCount);
    expect(wreckMaxSize).toBeLessThan(explosionMaxSize);
  });

  it('does not reveal projectiles when the fog texture is turned off', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = renderer.indexOf('for (const pr of this.game.state.projectiles)');
    const end = renderer.indexOf('gl.enable(gl.BLEND)', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = renderer.slice(start, end);
    expect(block).toContain('pointVisible');
    expect(block).not.toContain('showFog');
  });
});
