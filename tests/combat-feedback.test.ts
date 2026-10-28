import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/sim/game';
import { TILE_SIZE } from '../src/sim/constants';
import { ParticleSystem } from '../src/render/particles';
import {
  eventVisibleToLocal,
  MAX_VISUAL_WRECKS,
  pointVisibleToLocal,
  projectileVisibleToLocal,
  sampleProjectile,
  staticMuzzleAnchor,
  weaponFxClass,
  weaponFxProfile,
  WreckStore,
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

  it('overlaps tracer tail dots so a shot reads as a streak', () => {
    for (const id of ['rifle', 'atgm', 'tankGun', 'howitzer', 'samVehicle', 'missing-weapon']) {
      const profile = weaponFxProfile(id);
      const gap = profile.tracerLength / profile.tracerSegments - profile.tracerWidth * 2;
      // A gap wider than ~1 px at battle zoom turns the tail into flying dots.
      expect(gap, id).toBeLessThan(0.1);
    }
  });

  it('makes a direct hit at least as prominent as a near miss', () => {
    for (const id of ['tankGun', 'atgm', 'samVehicle', 'howitzer']) {
      const profile = weaponFxProfile(id);
      expect(profile.explosionScale, id).toBeGreaterThanOrEqual(profile.impactScale);
    }
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

describe('combat visibility gate', () => {
  const shot = (game: Game, team: number, tx: number, tz: number) => {
    game.emit('shot', {
      team,
      x: tx * TILE_SIZE,
      z: tz * TILE_SIZE,
      text: '',
      weaponId: 'rifle',
    });
    return game.state.events[game.state.events.length - 1];
  };

  it('hides an enemy event beyond gameplay vision regardless of the fog texture', () => {
    const game = new Game(islandWith({}), { enableAI: false });
    expect(game.fogAt(0, 70, 20)).not.toBe(2);
    const hidden = shot(game, 1, 70, 20);
    expect(eventVisibleToLocal(game, hidden)).toBe(false);

    // The renderer's fog toggle is presentation only; the helper has no such
    // input, so turning the texture off cannot reveal the contact.
    game.state.scenario.settings.fog = false;
    expect(eventVisibleToLocal(game, shot(game, 1, 70, 20))).toBe(true);
  });

  it('shows an enemy event inside vision and always shows friendly fire', () => {
    const game = new Game(islandWith({}), { enableAI: false });
    expect(game.fogAt(0, 18, 34)).toBe(2);
    expect(eventVisibleToLocal(game, shot(game, 1, 18, 34))).toBe(true);
    expect(eventVisibleToLocal(game, shot(game, 0, 70, 20))).toBe(true);
  });

  it('never hides an own-team projectile over unseen ground', () => {
    const game = new Game(islandWith({}), { enableAI: false });
    expect(pointVisibleToLocal(game, 70 * TILE_SIZE, 20 * TILE_SIZE)).toBe(false);
    // A shell fired by the local player stays drawn while it crosses fog; its
    // launch event and audio were already visible/audible by rule.
    expect(projectileVisibleToLocal(game, 0, 70 * TILE_SIZE, 20 * TILE_SIZE)).toBe(true);
    // Hostile projectiles keep the gameplay-vision gate.
    expect(projectileVisibleToLocal(game, 1, 70 * TILE_SIZE, 20 * TILE_SIZE)).toBe(false);
    expect(projectileVisibleToLocal(game, 1, 18 * TILE_SIZE, 34 * TILE_SIZE)).toBe(true);

    // With gameplay fog off, hostile projectiles are visible everywhere.
    game.state.scenario.settings.fog = false;
    expect(projectileVisibleToLocal(game, 1, 70 * TILE_SIZE, 20 * TILE_SIZE)).toBe(true);
  });

  it('handles malformed projectile positions without throwing', () => {
    const game = new Game(islandWith({}), { enableAI: false });
    expect(projectileVisibleToLocal(game, 0, Number.NaN, Number.NaN)).toBe(true);
    expect(() => projectileVisibleToLocal(game, 1, -1000, -1000)).not.toThrow();
    expect(() => pointVisibleToLocal(game, Number.NaN, Number.NaN)).not.toThrow();
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

describe('visual wreck store', () => {
  it('drops the oldest hull at the cap and clears without simulation state', () => {
    const store = new WreckStore();
    for (let i = 0; i < 30; i++) {
      store.push({ defId: 'tank', x: i, y: 0, z: 0, facing: 0 });
    }
    expect(MAX_VISUAL_WRECKS).toBe(24);
    expect(store.length).toBe(24);
    expect(store.wrecks[0].x).toBe(6);
    expect(store.wrecks[23].x).toBe(29);
    // A stored hull starts its own burn timers; these are presentation-only.
    expect(store.wrecks[23].age).toBe(0);
    expect(store.wrecks[23].smokeTimer).toBeGreaterThan(0);
    expect(store.wrecks[23].fireTimer).toBeGreaterThan(0);
    store.clear();
    expect(store.length).toBe(0);
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

  it('gives a burning hull a small repeated flame, not a second explosion', () => {
    const particles = new ParticleSystem();
    particles.wreckFlame(0, 1, 0, 1);
    expect(particles.particles).toHaveLength(1);
    const flame = particles.particles[0];
    expect(flame.additive).toBe(true);
    expect(flame.size1).toBeLessThan(flame.size0);
    expect(flame.life).toBeLessThan(0.5);
  });

  it('keeps persistent wreck smoke fog-gated and behind the effects switch', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = renderer.indexOf('private updateWreckEffects');
    const end = renderer.indexOf('private drawWrecks', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = renderer.slice(start, end);
    expect(block).toContain('if (!this.settings.effects) return');
    expect(block).toContain('pointVisible(game, wreck.x, wreck.z)');
    expect(block).toContain('this.particles.smoke');
    expect(block).toContain('this.particles.wreckFlame');
  });

  it('does not reveal projectiles when the fog texture is turned off', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = renderer.indexOf('for (const pr of this.game.state.projectiles)');
    const end = renderer.indexOf('gl.enable(gl.BLEND)', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = renderer.slice(start, end);
    // The gate is the shared gameplay-vision helper, never the visual toggle.
    expect(block).toContain('projectileVisibleToLocal');
    expect(block).not.toContain('showFog');
  });
});
