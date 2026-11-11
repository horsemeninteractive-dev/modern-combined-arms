import { describe, expect, it } from 'vitest';
import { runEngagement } from './engagementBench';

describe('naval engagements', () => {
  it('resolves a corvette mirror with the deck gun and a survivable winner', () => {
    const result = runEngagement({
      attacker: { defId: 'corvette' },
      defender: { defId: 'corvette' },
      tiles: 9,
      map: 'island',
      seconds: 70,
    });
    console.log('[eng]', JSON.stringify(result));
    expect(result.destroyed).toBe(true);
    expect(result.attackerHp).toBeGreaterThan(0);
    // Measured behaviour, not intent: both hulls close to gun range and fight
    // there. The stand-off missile is not used at nine tiles because the crew
    // closes to the range its preferred weapon needs.
    expect(result.shots.navalGun ?? 0).toBeGreaterThan(0);
  });

  it('sinks a dived submarine with depth charges and no surface gun', () => {
    const result = runEngagement({
      attacker: { defId: 'frigate' },
      defender: { defId: 'submarine' },
      tiles: 7,
      map: 'island',
      diver: true,
      seconds: 90,
    });
    console.log('[eng]', JSON.stringify(result));
    expect(result.shots.depthCharge ?? 0).toBeGreaterThan(0);
    expect(result.shots.navalGun ?? 0).toBe(0);
    expect(result.shots.navalMissile ?? 0).toBe(0);
    expect(result.destroyed).toBe(true);
  });

  it('cannot answer a dived boat with a surface-only escort', () => {
    const result = runEngagement({
      attacker: { defId: 'corvette' },
      defender: { defId: 'submarine' },
      tiles: 7,
      map: 'island',
      diver: true,
      seconds: 45,
    });
    expect(result.destroyed).toBe(false);
    expect(Object.keys(result.shots)).toHaveLength(0);
  });
});

describe('air engagements', () => {
  it('hunts armour with the gunship missile and stays out of the tank gun', () => {
    const result = runEngagement({
      attacker: { defId: 'attackHelo' },
      defender: { defId: 'tank' },
      tiles: 8,
      air: true,
      seconds: 45,
    });
    console.log('[eng]', JSON.stringify(result));
    expect(result.shots.atgm ?? 0).toBeGreaterThan(0);
    expect(result.destroyed).toBe(true);
    // A tank has no anti-air weapon: the gunship is not answered here.
    expect(result.damageTaken).toBe(0);
  });

  it('answers a gunship with mobile air defence', () => {
    const result = runEngagement({
      attacker: { defId: 'aa' },
      defender: { defId: 'attackHelo' },
      tiles: 9,
      air: true,
      seconds: 30,
    });
    console.log('[eng]', JSON.stringify(result));
    expect(result.shots.samVehicle ?? 0).toBeGreaterThan(0);
    expect(result.destroyed).toBe(true);
    expect(result.damageTaken).toBe(0);
  });
});

describe('force engagements', () => {
  it('does not let a rifle section defeat armour with small arms', () => {
    const result = runEngagement({
      attacker: { defId: 'rifle', count: 4 },
      defender: { defId: 'tank', count: 2 },
      tiles: 6,
      seconds: 40,
    });
    console.log('[eng]', JSON.stringify(result));
    expect(result.repulsed).toBe(true);
    // Rifles cannot hurt a heavy hull; the tanks shrug the whole engagement off.
    expect(result.damageDealt).toBeLessThan(100);
  });

  it('is reproducible on the same seed', () => {
    const options = {
      attacker: { defId: 'ifv', count: 2 },
      defender: { defId: 'tank', count: 1 },
      tiles: 6,
      seconds: 30,
      seed: 991,
    };
    expect(runEngagement(options)).toEqual(runEngagement(options));
  });
});
