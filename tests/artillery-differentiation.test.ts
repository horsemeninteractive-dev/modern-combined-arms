/**
 * Artillery differentiation.
 *
 * Phase 6B's fixture put one 280 HP target at fourteen tiles and every battery
 * killed it in one shot, which established nothing. These measurements use
 * reach, sustained output, area effect, structure damage and minimum range to
 * ask whether the four systems have distinct jobs.
 *
 * Note on method: `runDuel` gives the attacker an attack order, so it drives
 * into its own reach. That is correct for measuring damage but useless for
 * measuring reach, which is a property of the gun. Reach is therefore asserted
 * from the definitions and everything else is measured in an engagement.
 */
import { describe, expect, it } from 'vitest';
import { runDuel } from './combatBench';
import { runMixed } from './mixedBench';
import { UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';

const SYSTEMS = ['spg', 'heavyHowitzer', 'k9Thunder', 'koksan'] as const;

function shellOf(id: string) {
  const weaponId = UNITS[id].weapons[0];
  return WEAPONS[weaponId];
}

function sustainedDps(id: string, armour: 'heavy' | 'infantry' | 'structure'): number {
  const w = shellOf(id);
  const mult = w.multipliers[armour] ?? 1;
  return (w.damage * mult * w.accuracy) / w.cooldown;
}

describe('artillery roles', () => {
  it('prints the defining numbers for each system', () => {
    for (const id of SYSTEMS) {
      const w = shellOf(id);
      console.log('[art]', JSON.stringify({
        id,
        price: UNITS[id].cost.mats,
        req: UNITS[id].cost.req,
        range: w.range,
        minRange: w.minRange ?? 0,
        reload: w.cooldown,
        shell: w.damage,
        splash: w.splash ?? 0,
        accuracy: w.accuracy,
        speed: UNITS[id].speed,
        hp: UNITS[id].hp,
        antiArmourDps: Math.round(sustainedDps(id, 'heavy') * 100) / 100,
        antiInfantryDps: Math.round(sustainedDps(id, 'infantry') * 100) / 100,
        antiStructureDps: Math.round(sustainedDps(id, 'structure') * 100) / 100,
        dpsPerMaterial: Math.round((sustainedDps(id, 'heavy') / UNITS[id].cost.mats) * 10000) / 10000,
      }));
    }
  });

  it('orders the four systems by reach and by dead zone', () => {
    const ranges = SYSTEMS.map((id) => ({
      id,
      range: shellOf(id).range,
      minRange: shellOf(id).minRange ?? 0,
    }));
    for (const row of ranges) console.log('[art-range]', JSON.stringify(row));
    // The Koksan is the siege piece: longest reach, deepest dead zone.
    expect(shellOf('koksan').range).toBeGreaterThan(shellOf('k9Thunder').range);
    expect(shellOf('koksan').minRange ?? 0).toBeGreaterThan(shellOf('k9Thunder').minRange ?? 0);
    // The two 155/203mm NATO-class tubes reach further than the shared gun.
    expect(shellOf('k9Thunder').range).toBeGreaterThan(shellOf('spg').range);
    expect(shellOf('heavyHowitzer').range).toBeGreaterThan(shellOf('spg').range);
  });

  it('measures sustained output at a common distance', () => {
    const atFourteen = SYSTEMS.map((id) => {
      const duel = runDuel(id, 'tank', { tiles: 14, seconds: 60 });
      return { id, damage: duel.damageDealt, shots: duel.shots };
    });
    for (const row of atFourteen) console.log('[art-dps]', JSON.stringify(row));
    for (const row of atFourteen) expect(row.damage).toBeGreaterThan(0);
    // The Koksan fires the biggest shell and reloads for eleven seconds: at a
    // common distance it lands fewer shells than the quick-firing K9.
    const k9 = atFourteen.find((r) => r.id === 'k9Thunder')!;
    const koksan = atFourteen.find((r) => r.id === 'koksan')!;
    expect(k9.shots).toBeGreaterThan(koksan.shots);
    expect(sustainedDps('k9Thunder', 'heavy')).toBeGreaterThan(sustainedDps('koksan', 'heavy'));
    expect(shellOf('koksan').damage).toBeGreaterThan(shellOf('k9Thunder').damage);
  });

  it('separates them by area effect against a cluster', () => {
    const cluster = SYSTEMS.map((id) => {
      const result = runMixed({
        attacker: [id],
        defender: ['rifle', 'rifle', 'rifle'],
        tiles: 14,
        seconds: 40,
      });
      return {
        id,
        damage: result.damageDealt,
        lost: result.defenderLost,
        shots: Object.values(result.shots).reduce((a, b) => a + b, 0),
      };
    });
    for (const row of cluster) console.log('[art-area]', JSON.stringify(row));
    for (const row of cluster) expect(row.damage).toBeGreaterThan(0);
    // Wider patterns belong to the heavy tubes, not the shared gun.
    expect(shellOf('heavyHowitzer').splash ?? 0).toBeGreaterThan(shellOf('spg').splash ?? 0);
    expect(shellOf('koksan').splash ?? 0).toBeGreaterThan(shellOf('spg').splash ?? 0);
  });

  it('separates them by structure damage', () => {
    // Structure damage is a property of the shell, so it is asserted from the
    // definitions; the engagement fixture below is a sanity check that the
    // rounds actually land on a defended position.
    const rows = SYSTEMS.map((id) => ({
      id,
      structureMultiplier: shellOf(id).multipliers.structure ?? 1,
      antiStructureDps: Math.round(sustainedDps(id, 'structure') * 100) / 100,
    }));
    for (const row of rows) console.log('[art-structure]', JSON.stringify(row));
    for (const row of rows) expect(row.structureMultiplier).toBeGreaterThan(1);
    // The Koksan is an alpha-strike siege piece, not a sustained siege battery:
    // one shell does more than the K9's, while its sustained output is the
    // lowest of the four. The per-shell figure is the role.
    const perShell = (id: string): number => {
      const w = shellOf(id);
      return w.damage * (w.multipliers.structure ?? 1) * w.accuracy;
    };
    console.log('[art-alpha]', JSON.stringify({
      koksanPerShell: Math.round(perShell('koksan') * 10) / 10,
      k9PerShell: Math.round(perShell('k9Thunder') * 10) / 10,
      spgPerShell: Math.round(perShell('spg') * 10) / 10,
    }));
    expect(perShell('koksan')).toBeGreaterThan(perShell('k9Thunder'));

    const bombard = runMixed({
      attacker: ['spg'],
      defender: ['rifle'],
      defenderStructures: [{ defId: 'commandPost', x: 36, z: 30 }],
      tiles: 15,
      seconds: 40,
    });
    console.log('[art-bombard]', JSON.stringify({ damage: bombard.damageDealt, shots: bombard.shots }));
    expect(Object.values(bombard.shots).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('holds every system inside its own minimum range', () => {
    for (const id of SYSTEMS) {
      const min = shellOf(id).minRange ?? 0;
      expect(min).toBeGreaterThan(0);
      const duel = runDuel(id, 'tank', { tiles: Math.max(1, min - 2), seconds: 15 });
      expect(duel.shots, `${id} must not fire inside ${min} tiles`).toBe(0);
    }
  });

  it('pays for mobility and armour where it claims to', () => {
    expect(UNITS.koksan.speed).toBeLessThan(UNITS.spg.speed);
    expect(UNITS.heavyHowitzer.speed).toBeLessThan(UNITS.spg.speed);
    expect(UNITS.k9Thunder.speed).toBeGreaterThan(UNITS.spg.speed);
    expect(UNITS.k9Thunder.cost.mats).toBeGreaterThan(UNITS.spg.cost.mats);
  });
});
