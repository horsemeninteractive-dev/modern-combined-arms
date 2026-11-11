/**
 * Hedgehog validation.
 *
 * Phase 6B found the Hungarian Hedgehog AT team to be the strongest apparent
 * efficiency outlier: 175 material for a team that destroyed a 540 HP main
 * battle tank in one duel, while the 200-material shared ATGM gunner did not.
 * A single favourable duel is not a verdict, so these tests widen the fixture:
 * multiple seeds, lighter targets, infantry it cannot answer, indirect fire it
 * cannot out-range, cost-equivalent groups, and the counterplay it is meant to
 * have.
 */
import { describe, expect, it } from 'vitest';
import { runDuel } from './combatBench';
import { runMixed } from './mixedBench';
import { UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';

const price = (id: string): number => UNITS[id].cost.mats;

describe('hedgehog anti-armour role', () => {
  it('damages a main battle tank on every seed, and kills it on some', () => {
    const rows = [11, 202, 3033, 4044].map((seed) => {
      const duel = runDuel('hedgehogTeam', 'tank', { tiles: 8, seconds: 45, seed });
      return {
        seed,
        damage: duel.damageDealt,
        destroyed: duel.destroyed,
        secondsToKill: duel.secondsToKill,
        survivedHp: duel.attackerHp,
      };
    });
    for (const row of rows) console.log('[hg-seed]', JSON.stringify(row));
    for (const row of rows) expect(row.damage).toBeGreaterThan(0);
    // The measured finding: this is not a guaranteed tank killer. It lands two
    // to four missiles and dies to the return fire on most seeds, which is what
    // a 175-material infantry team should do to a 720-material MBT.
    const kills = rows.filter((r) => r.destroyed).length;
    console.log('[hg-kills]', JSON.stringify({ kills, of: rows.length }));
    expect(kills).toBeGreaterThanOrEqual(1);
    expect(kills).toBeLessThan(rows.length);
  });

  it('out-ranges the tank gun it is bought to answer, but only by half a tile', () => {
    // The decisive geometry, not a damage number: 8 tiles of missile reach
    // against the MBT's 7.5-tile gun. Both get the same one-tile firing slack,
    // so the team fires first and the tank answers as it closes.
    expect(WEAPONS.hedgehogAtgm.range).toBeGreaterThan(WEAPONS.tankGun.range);
    expect(WEAPONS.hedgehogAtgm.range - WEAPONS.tankGun.range).toBeLessThanOrEqual(1);
    const atEight = runDuel('hedgehogTeam', 'tank', { tiles: 8, seconds: 30 });
    expect(atEight.damageDealt).toBeGreaterThan(0);
  });

  it('can hurt light vehicles but is not an anti-infantry answer', () => {
    const light = runDuel('hedgehogTeam', 'recon', { tiles: 7, seconds: 20 });
    const infantry = runDuel('hedgehogTeam', 'rifle', { tiles: 6, seconds: 20 });
    console.log('[hg-targets]', JSON.stringify({
      light: { damage: light.damageDealt, destroyed: light.destroyed },
      infantry: { damage: infantry.damageDealt, destroyed: infantry.destroyed },
    }));
    expect(light.damageDealt).toBeGreaterThan(0);
    // 0.2 multiplier against infantry: a full team is worse than a rifleman.
    expect(infantry.damageDealt).toBeLessThan(WEAPONS.hedgehogAtgm.damage * 2);
  });

  it('must close on indirect fire, taking the first hits to do it', () => {
    // A battery at fourteen tiles out-ranges the team, so the team has to walk
    // in. It is not helpless — it closes and fires — but it eats the opening
    // salvo, which is the intended counterplay rather than immunity.
    expect(WEAPONS.hedgehogAtgm.range).toBeLessThan(WEAPONS.howitzer.range);
    const duel = runDuel('hedgehogTeam', 'spg', { tiles: 14, seconds: 30 });
    console.log('[hg-vs-artillery]', JSON.stringify(duel));
    expect(duel.attackerDamageTaken).toBeGreaterThan(0);
  });

  it('compares cost-equivalent groups instead of one favourable duel', () => {
    const oneHedgehog = runDuel('hedgehogTeam', 'tank', { tiles: 8, seconds: 45, seed: 202 });
    const oneAtgm = runDuel('atgm', 'tank', { tiles: 8, seconds: 45, seed: 202 });
    const twoHedgehogs = runMixed({
      attacker: ['hedgehogTeam', 'hedgehogTeam'],
      defender: ['tank'],
      tiles: 8,
      seconds: 30,
    });
    const twoAtgm = runMixed({
      attacker: ['atgm', 'atgm'],
      defender: ['tank'],
      tiles: 8,
      seconds: 30,
    });
    console.log('[hg-cost]', JSON.stringify({
      hedgehog: { price: price('hedgehogTeam'), damage: oneHedgehog.damageDealt, destroyed: oneHedgehog.destroyed },
      atgm: { price: price('atgm'), damage: oneAtgm.damageDealt, destroyed: oneAtgm.destroyed },
      pairHedgehog: { damage: twoHedgehogs.damageDealt, lost: twoHedgehogs.attackerLost },
      pairAtgm: { damage: twoAtgm.damageDealt, lost: twoAtgm.attackerLost },
    }));
    expect(twoHedgehogs.damageDealt).toBeGreaterThan(0);
    expect(twoAtgm.damageDealt).toBeGreaterThan(0);
  });

  it('supports infantry without replacing them', () => {
    const supported = runMixed({
      attacker: ['hedgehogTeam', 'rifle', 'rifle'],
      defender: ['tank'],
      tiles: 7,
      seconds: 30,
    });
    const alone = runMixed({ attacker: ['hedgehogTeam'], defender: ['tank'], tiles: 7, seconds: 30 });
    console.log('[hg-support]', JSON.stringify({
      supported: { damage: supported.damageDealt, lost: supported.attackerLost },
      alone: { damage: alone.damageDealt, lost: alone.attackerLost },
    }));
    expect(supported.damageDealt).toBeGreaterThanOrEqual(alone.damageDealt);
  });

  it('is answered by a section that reaches its dead zone', () => {
    const result = runMixed({
      attacker: ['rifle', 'rifle', 'rifle'],
      defender: ['hedgehogTeam'],
      tiles: 6,
      seconds: 25,
    });
    console.log('[hg-counterplay]', JSON.stringify(result));
    expect(result.damageTaken).toBeGreaterThan(0);
  });

  it('is the most efficient anti-armour team per material, and that is the finding', () => {
    const dps = (dmg: number, mult: number, acc: number, cd: number): number => (dmg * mult * acc) / cd;
    const hedge = WEAPONS.hedgehogAtgm;
    const shared = WEAPONS.atgm;
    const hedgehog =
      dps(hedge.damage, hedge.multipliers.heavy ?? 1, hedge.accuracy, hedge.cooldown) /
      price('hedgehogTeam');
    const sharedGunner =
      dps(shared.damage, shared.multipliers.heavy ?? 1, shared.accuracy, shared.cooldown) /
      price('atgm');
    console.log('[hg-efficiency]', JSON.stringify({
      hedgehogPerMaterial: Math.round(hedgehog * 10000) / 10000,
      sharedAtgmPerMaterial: Math.round(sharedGunner * 10000) / 10000,
      ratio: Math.round((hedgehog / sharedGunner) * 100) / 100,
      hedgehogHp: UNITS.hedgehogTeam.hp,
      sharedHp: UNITS.atgm.hp,
      hedgehogRange: hedge.range,
      sharedRange: shared.range,
      hedgehogReload: hedge.cooldown,
      sharedReload: shared.cooldown,
    }));
    // Recorded, not acted on: 54% more damage per material buys two tiles less
    // reach and the same infantry vulnerability. With one kill in four seeds it
    // is not the guaranteed tank-killer the isolated duel suggested.
    expect(hedgehog).toBeGreaterThan(sharedGunner);
  });
});
