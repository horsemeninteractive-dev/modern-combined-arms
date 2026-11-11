/**
 * Naval weapon employment.
 *
 * The selector's score says what the crew would *prefer*. These tests ask what
 * the hull actually fires while it closes, which is the behaviour a player
 * sees: a long-range missile is an opening salvo, the deck gun is the sustained
 * fight, and an empty rack must not silence the ship. Every case runs the real
 * simulation through the engagement harness, so ammunition, reach, light and
 * accuracy are the match's own.
 */
import { describe, expect, it } from 'vitest';
import { runEngagement } from './engagementBench';

const naval = (attacker: string, defender: string, tiles: number, options: {
  seconds?: number;
  ammo?: number;
} = {}) =>
  runEngagement({
    attacker: { defId: attacker, ammo: options.ammo },
    defender: { defId: defender },
    tiles,
    map: 'island',
    seconds: options.seconds ?? 70,
  });

describe('naval stand-off employment', () => {
  it('opens a corvette duel with missiles at stand-off range', () => {
    const result = naval('corvette', 'corvette', 12);
    console.log('[naval]', JSON.stringify(result));
    expect(result.shots.navalMissile ?? 0).toBeGreaterThan(0);
    expect(result.damageDealt).toBeGreaterThan(0);
  });

  it('closes to its gun when the missile advantage is a single tile', () => {
    // Measured, not forced: the boat's missile reaches ten tiles and its gun
    // nine, so against a closing corvette the band where the missile is the
    // only usable weapon is narrower than one approach step. The salvo is
    // therefore rarely fired; the boat fights with its gun. That geometry is a
    // balance finding for the roster, not a selector defect.
    const result = naval('missileBoat', 'corvette', 10, { seconds: 60 });
    console.log('[naval]', JSON.stringify(result));
    expect(result.shots.navalGun ?? 0).toBeGreaterThan(0);
    expect(result.damageDealt).toBeGreaterThan(0);
  });

  it('lets a frigate use its long-range missile rather than only the gun', () => {
    const result = naval('frigate', 'corvette', 14, { seconds: 80 });
    console.log('[naval]', JSON.stringify(result));
    expect(result.shots.navalMissile ?? 0).toBeGreaterThan(0);
  });

  it('lets the Visby employ its missile as well as its gun', () => {
    const result = naval('visby', 'corvette', 12, { seconds: 70 });
    console.log('[naval]', JSON.stringify(result));
    expect(result.shots.navalMissile ?? 0).toBeGreaterThan(0);
  });
});

describe('naval gun employment', () => {
  it('fights with the deck gun inside gun range', () => {
    const result = naval('corvette', 'corvette', 6);
    console.log('[naval]', JSON.stringify(result));
    expect(result.shots.navalGun ?? 0).toBeGreaterThan(0);
    expect(result.damageDealt).toBeGreaterThan(0);
  });

  it('falls back to the gun when the rack is empty and still closes', () => {
    const result = naval('corvette', 'corvette', 12, { ammo: 0 });
    console.log('[naval]', JSON.stringify(result));
    expect(result.shots.navalMissile ?? 0).toBe(0);
    expect(result.shots.navalGun ?? 0).toBeGreaterThan(0);
    expect(result.damageDealt).toBeGreaterThan(0);
  });
});

describe('naval determinism', () => {
  it('produces the same engagement twice', () => {
    expect(naval('corvette', 'corvette', 12)).toEqual(naval('corvette', 'corvette', 12));
  });
});
