import { describe, expect, it } from 'vitest';
import { runDuel, multiWeaponUnits } from './combatBench';
import { UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';
import { pickBestWeapon, weaponScore } from '../src/sim/weaponChoice';
import type { TargetClass } from '../src/sim/types';

describe('combat benchmark', () => {
  it('engages a main battle tank with the IFV missile, not the autocannon', () => {
    // The IFV is a light hull: it trades missiles with a tank and loses the
    // exchange. What this measures is that its missiles are the weapon it uses.
    const result = runDuel('ifv', 'tank', { tiles: 8, seconds: 20 });
    console.log('[duel]', JSON.stringify(result));
    expect(result.weaponsUsed).toEqual(['atgm']);
    expect(result.damageDealt).toBeGreaterThan(0);
    expect(result.shots).toBeGreaterThan(0);
  });

  it('uses the autocannon on infantry and keeps the missile in the rack', () => {
    const result = runDuel('ifv', 'rifle', { tiles: 4, seconds: 12 });
    expect(result.weaponsUsed).toEqual(['autocannon']);
    expect(result.destroyed).toBe(true);
  });

  it('measures the national IFVs against the same heavy target', () => {
    const wilk = runDuel('wilk', 'tank', { tiles: 8, seconds: 45 });
    const cv90 = runDuel('cv90', 'tank', { tiles: 8, seconds: 45 });
    console.log('[duel]', JSON.stringify(wilk));
    console.log('[duel]', JSON.stringify(cv90));
    expect(wilk.weaponsUsed[0]).toBe('atgm');
    expect(cv90.weaponsUsed[0]).toBe('atgm');
    expect(wilk.damageDealt).toBeGreaterThan(0);
    expect(cv90.damageDealt).toBeGreaterThan(0);
  });

  it('resolves a main battle tank mirror as a genuine exchange', () => {
    const result = runDuel('tank', 'tank', { tiles: 7, seconds: 30 });
    console.log('[duel]', JSON.stringify(result));
    expect(result.shots).toBeGreaterThan(0);
    expect(result.damageDealt).toBeGreaterThan(0);
    expect(result.attackerDamageTaken).toBeGreaterThan(0);
  });

  it('is reproducible for the same seed', () => {
    const a = runDuel('ifv', 'tank', { tiles: 8, seconds: 20, seed: 4242 });
    const b = runDuel('ifv', 'tank', { tiles: 8, seconds: 20, seed: 4242 });
    expect(b).toEqual(a);
  });
});

describe('multi-weapon roster audit', () => {
  const classes: TargetClass[] = ['ground', 'air', 'naval', 'structure'];
  const armourFor: Record<TargetClass, 'infantry' | 'light' | 'heavy' | 'support' | 'structure' | 'naval' | 'air'> = {
    ground: 'heavy',
    air: 'air',
    naval: 'naval',
    structure: 'structure',
  };

  it('finds the multi-weapon definitions in the working tree', () => {
    const ids = multiWeaponUnits();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(UNITS[id].weapons!.length).toBeGreaterThan(1);
  });

  it('has a selectable weapon for every class each multi-weapon unit can engage', () => {
    for (const id of multiWeaponUnits()) {
      const def = UNITS[id];
      for (const targetClass of classes) {
        const compatible = def.weapons!
          .map((weaponId) => WEAPONS[weaponId])
          .filter((weapon) => weapon && weapon.targets.includes(targetClass) && !weapon.asw);
        if (compatible.length === 0) continue;
        for (const distance of [3, 6, 9]) {
          const candidates = compatible.map((weapon) => ({
            weapon,
            score: weaponScore(weapon, armourFor[targetClass], distance),
          }));
          const picked = pickBestWeapon(candidates);
          expect(picked, `${id} has no answer to ${targetClass} at ${distance}`).not.toBeNull();
          expect(picked!.targets).toContain(targetClass);
        }
      }
    }
  });
});
