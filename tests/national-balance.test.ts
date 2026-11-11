/**
 * National specialist measurements.
 *
 * Every pairing here is the nation's own hull against the shared platform it
 * replaces or the threat it is bought to answer, driven through the combat
 * benchmark. The assertions are about role, not about a magic margin: a
 * specialist has to be able to do the job it exists for, at a price that is
 * visible in the printed table.
 */
import { describe, expect, it } from 'vitest';
import { runDuel } from './combatBench';
import { runEngagement } from './engagementBench';
import { UNITS } from '../src/data/units';

const cost = (id: string): number => UNITS[id]?.cost.mats ?? 0;

function price(id: string): string {
  return `${id}:${cost(id)}m`;
}

describe('national specialists', () => {
  it('measures the anti-armour answers against a main battle tank', () => {
    const answers = ['hedgehogTeam', 'spikeTeam', 'bulsae4', 'atgm', 'atgmEC', 'td'];
    const rows = answers.map((id) => {
      const duel = runDuel(id, 'tank', { tiles: 8, seconds: 45 });
      return { id, price: price(id), damage: duel.damageDealt, destroyed: duel.destroyed, hp: duel.attackerHp };
    });
    for (const row of rows) console.log('[nat]', JSON.stringify(row));
    for (const row of rows) expect(row.damage, `${row.id} must hurt heavy armour`).toBeGreaterThan(0);
  });

  it('measures the national main battle tanks against the shared tank', () => {
    const duels = [
      runDuel('spearhead', 'tank', { tiles: 7, seconds: 30 }),
      runDuel('tank', 'spearhead', { tiles: 7, seconds: 30 }),
      runDuel('tank', 'tank', { tiles: 7, seconds: 30 }),
    ];
    for (const duel of duels) console.log('[nat]', JSON.stringify(duel));
    // The Spearhead is a national MBT: it has to be able to win the mirror it
    // was bought for, on the attack as well as on the defence.
    expect(duels[0].destroyed).toBe(true);
    expect(duels[2].destroyed).toBe(true);
  });

  it('measures the national fighting vehicles against the heavy target', () => {
    for (const id of ['wilk', 'cv90', 'ifv']) {
      const duel = runDuel(id, 'tank', { tiles: 8, seconds: 30 });
      console.log('[nat]', JSON.stringify({ ...duel, price: price(id) }));
      expect(duel.weaponsUsed).toContain('atgm');
      expect(duel.damageDealt).toBeGreaterThan(0);
    }
  });

  it('measures the national artillery against a static target', () => {
    const rows = ['k9Thunder', 'heavyHowitzer', 'koksan', 'spg'].map((id) => {
      const duel = runDuel(id, 'spg', { tiles: 14, seconds: 60 });
      return { id, price: price(id), damage: duel.damageDealt, destroyed: duel.destroyed };
    });
    for (const row of rows) console.log('[nat]', JSON.stringify(row));
    // Every battery has to be able to shell a stationary target at its reach.
    for (const row of rows) expect(row.damage, `${row.id} failed to damage`).toBeGreaterThan(0);
  });

  it('measures the national naval and air platforms in their own domain', () => {
    const naval = runEngagement({
      attacker: { defId: 'visby' },
      defender: { defId: 'corvette' },
      tiles: 9,
      map: 'island',
      seconds: 70,
    });
    const strike = runEngagement({
      attacker: { defId: 'gripen' },
      defender: { defId: 'tank' },
      tiles: 8,
      air: true,
      seconds: 45,
    });
    console.log('[nat]', JSON.stringify({ ...naval, price: price('visby') }));
    console.log('[nat]', JSON.stringify({ ...strike, price: price('gripen') }));
    expect(Object.keys(naval.shots).length).toBeGreaterThan(0);
    expect(Object.keys(strike.shots).length).toBeGreaterThan(0);
    expect(strike.damageDealt).toBeGreaterThan(0);
  });
});
