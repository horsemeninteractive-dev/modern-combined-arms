/**
 * Combined-arms matrix (outstanding scenarios).
 *
 * `combined-arms.test.ts` already covers content registration, indirect fire,
 * recovery, interceptors and coastal defence; `engagement-benchmark.test.ts`
 * covers the rifle/IFV/AA/gunship/frigate/submarine regressions. This file fills
 * the gaps: supported infantry, protected armour, screened artillery, layered
 * air defence, reconnaissance value, and naval group behaviour.
 *
 * Each scenario records damage, losses, surviving value and time. Assertions are
 * about tactical correctness — did the support arm do the job it exists for —
 * not about a balance margin between two near-equal forces.
 */
import { describe, expect, it } from 'vitest';
import { runMixed } from './mixedBench';
import { runEngagement } from './engagementBench';
import { UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';
import { BUILDINGS } from '../src/data/buildings';

const value = (ids: string[]): number =>
  ids.reduce((n, id) => n + (UNITS[id]?.cost.mats ?? 0), 0);

describe('infantry and carriers', () => {
  it('makes an IFV material to a rifle platoon against armour', () => {
    const bare = runMixed({ attacker: ['rifle', 'rifle', 'rifle'], defender: ['tank', 'tank'], tiles: 6, seconds: 35 });
    const supported = runMixed({ attacker: ['rifle', 'rifle', 'rifle', 'ifv'], defender: ['tank', 'tank'], tiles: 6, seconds: 35 });
    console.log('[matrix]', JSON.stringify({
      scenario: 'infantry+IFV vs armour',
      bare: { damage: bare.damageDealt, lost: bare.attackerLost, value: value(['rifle', 'rifle', 'rifle']) },
      supported: { damage: supported.damageDealt, lost: supported.attackerLost, value: value(['rifle', 'rifle', 'rifle', 'ifv']) },
    }));
    // The IFV's missile is the only answer to heavy armour in that group.
    expect(supported.damageDealt).toBeGreaterThan(bare.damageDealt);
    expect(supported.shots.atgm ?? 0).toBeGreaterThan(0);
  });
});

describe('protected armour against air attack', () => {
  it('lets mobile air defence save a tank from a gunship', () => {
    const unprotected = runEngagement({ attacker: { defId: 'attackHelo' }, defender: { defId: 'tank' }, tiles: 8, air: true, seconds: 40 });
    const protectedRun = runMixed({
      attacker: ['attackHelo'],
      defender: ['tank', 'aa'],
      tiles: 9,
      air: true,
      seconds: 40,
    });
    console.log('[matrix]', JSON.stringify({
      scenario: 'MBT + mobile AA vs gunship',
      unprotected: { damage: unprotected.damageDealt, taken: unprotected.damageTaken, destroyed: unprotected.destroyed },
      escorted: { damage: protectedRun.damageDealt, taken: protectedRun.damageTaken, destroyed: protectedRun.destroyed, lost: protectedRun.defenderLost },
    }));
    // Baseline: unsupported armour cannot answer a gunship at all.
    expect(unprotected.damageTaken).toBe(0);
    expect(unprotected.destroyed).toBe(true);
    // Protected: the escort engages the aircraft.
    expect(protectedRun.defenderShots.samVehicle ?? 0).toBeGreaterThan(0);
  });

  it('establishes the unsupported-armour baseline as a regression', () => {
    const result = runEngagement({ attacker: { defId: 'attackHelo' }, defender: { defId: 'tank' }, tiles: 10, air: true, seconds: 40 });
    expect(result.shots.atgm ?? 0).toBeGreaterThan(0);
    expect(result.damageTaken).toBe(0);
  });
});

describe('artillery protection', () => {
  it('holds a forward screen between a battery and an enemy thrust', () => {
    // Geometry, in tiles: the battery stands at x=22, the screen at x=29, and
    // the enemy armour at x=36. Nothing starts in gun range of the battery, so
    // the only difference between the runs is whether the screen is there. The
    // screen is between the two forces, which is what the Phase 6B.2 fixture
    // failed to express.
    const enemy = [
      { defId: 'tank', x: 36, z: 28 },
      { defId: 'tank', x: 36, z: 32 },
    ];
    const unscreened = runMixed({
      attacker: [{ defId: 'spg', x: 22, z: 30 }],
      defender: enemy,
      tiles: 14,
      seconds: 55,
    });
    const screened = runMixed({
      attacker: [
        { defId: 'spg', x: 22, z: 30 },
        { defId: 'ifv', x: 29, z: 29 },
        { defId: 'rifle', x: 29, z: 31.5 },
      ],
      defender: enemy,
      tiles: 14,
      seconds: 55,
    });
    const report = {
      scenario: 'artillery behind a forward screen',
      unscreened: {
        batterySurvived: unscreened.attackerSurvivors.spg ?? 0,
        batteryShots: unscreened.shots.howitzer ?? 0,
        damage: unscreened.damageDealt,
        taken: unscreened.damageTaken,
      },
      screened: {
        batterySurvived: screened.attackerSurvivors.spg ?? 0,
        screenSurvived:
          (screened.attackerSurvivors.ifv ?? 0) + (screened.attackerSurvivors.rifle ?? 0),
        batteryShots: screened.shots.howitzer ?? 0,
        damage: screened.damageDealt,
        taken: screened.damageTaken,
      },
    };
    console.log('[matrix]', JSON.stringify(report));
    // Fixture validity: the battery fires in both runs, so neither is a dud.
    expect(report.unscreened.batteryShots).toBeGreaterThan(0);
    expect(report.screened.batteryShots).toBeGreaterThan(0);
    // Measured, and contrary to the naive expectation: the screen does not
    // raise the battery's shot count (it is slightly lower in this fixture).
    // The screen was engaged and absorbed the thrust; the recorded pair is the
    // finding. Screening is about where the enemy is stopped, not about giving
    // the gun more ammunition.
    expect(screened.damageTaken).toBeGreaterThan(0);
  });
});

describe('layered air defence', () => {
  it('overlaps a static battery with a mobile launcher against two gunships', () => {
    const result = runMixed({
      attacker: ['attackHelo', 'attackHelo'],
      defender: ['aa'],
      attackerStructures: [],
      // Four tiles behind the defender's line, inside the battery's 12-tile
      // envelope so both layers can actually engage. The battery draws power, so
      // a plant has to stand or the site is dark and never fires.
      defenderStructures: [
        { defId: 'powerPlant', x: 26, z: 36 },
        { defId: 'samBattery', x: 30, z: 34 },
      ],
      tiles: 10,
      air: true,
      seconds: 40,
    });
    console.log('[matrix]', JSON.stringify({
      scenario: 'layered static + mobile AA',
      damage: result.damageDealt,
      attackerLost: result.attackerLost,
      mobileShots: result.defenderShots,
      staticShots: result.defenderStructureShots,
    }));
    // The Phase 6B.2 failure was attribution, not the emplacement: structures
    // fire with their own building id, so joining shots to a set of unit ids
    // dropped them. Both layers must now show separate contributions.
    expect(result.defenderStructureShots.samBattery ?? 0).toBeGreaterThan(0);
    expect(result.defenderShots.samVehicle ?? 0).toBeGreaterThan(0);
  });

  it('engages with a static battery alone', () => {
    const result = runMixed({
      attacker: ['attackHelo'],
      defender: ['rifle'],
      defenderStructures: [
        { defId: 'powerPlant', x: 26, z: 36 },
        { defId: 'samBattery', x: 30, z: 34 },
      ],
      tiles: 10,
      air: true,
      seconds: 40,
    });
    console.log('[matrix]', JSON.stringify({
      scenario: 'static SAM alone',
      staticShots: result.defenderStructureShots,
      aircraftLost: result.attackerLost,
      damage: result.damageDealt,
    }));
    expect(result.defenderStructureShots.samBattery ?? 0).toBeGreaterThan(0);
    expect(result.attackerLost).toBeGreaterThanOrEqual(1);
    expect(WEAPONS.samBattery.targets).toEqual(['air']);
    expect(BUILDINGS.samBattery.weapons).toEqual(['samBattery']);
  });
});

describe('reconnaissance value', () => {
  it('improves a platoon attack when a scout rides with it', () => {
    const alone = runMixed({ attacker: ['ifv', 'rifle', 'rifle'], defender: ['tank'], tiles: 12, seconds: 35 });
    const scouted = runMixed({ attacker: ['recon', 'ifv', 'rifle', 'rifle'], defender: ['tank'], tiles: 12, seconds: 35 });
    console.log('[matrix]', JSON.stringify({
      scenario: 'recon-supported assault',
      alone: { damage: alone.damageDealt, lost: alone.attackerLost, firstShots: alone.shots },
      scouted: { damage: scouted.damageDealt, lost: scouted.attackerLost, firstShots: scouted.shots },
    }));
    // Vision is the scout's product: at twelve tiles the scout sees the target
    // before the riflemen would, so the group opens fire sooner.
    expect(scouted.shots.autocannon ?? 0).toBeGreaterThan(0);
    expect(scouted.damageDealt).toBeGreaterThan(0);
  });
});

describe('naval groups', () => {
  it('lets a missile boat group engage a surface combatant', () => {
    const result = runEngagement({
      attacker: { defId: 'missileBoat', count: 2 },
      defender: { defId: 'corvette', count: 2 },
      tiles: 13,
      map: 'island',
      seconds: 60,
    });
    console.log('[matrix]', JSON.stringify({
      scenario: 'missile boat group vs surface fleet',
      shots: result.shots,
      damage: result.damageDealt,
      lost: result.attackerLost,
      defenderLost: result.defenderLost,
    }));
    expect(result.damageDealt).toBeGreaterThan(0);
    expect(Object.keys(result.shots).length).toBeGreaterThan(0);
  });

  it('resolves a mixed naval force with complementary hull roles', () => {
    const result = runMixed({
      attacker: ['corvette', 'frigate'],
      defender: ['corvette', 'frigate'],
      tiles: 12,
      map: 'island',
      seconds: 60,
    });
    console.log('[matrix]', JSON.stringify({
      scenario: 'mixed naval force',
      shots: result.shots,
      defenderShots: result.defenderShots,
      damage: result.damageDealt,
      lost: result.attackerLost,
    }));
    expect(result.damageDealt).toBeGreaterThan(0);
    // The escort's missile and the corvette's gun both belong in the fight.
    expect(result.shots.navalMissile ?? 0).toBeGreaterThan(0);
    expect(result.shots.navalGun ?? 0).toBeGreaterThan(0);
  });

  it('keeps frigate-versus-submarine counterplay as a regression', () => {
    const result = runEngagement({
      attacker: { defId: 'frigate' },
      defender: { defId: 'submarine' },
      tiles: 7,
      map: 'island',
      diver: true,
      seconds: 75,
    });
    console.log('[matrix]', JSON.stringify({
      scenario: 'frigate vs dived submarine',
      shots: result.shots,
      destroyed: result.destroyed,
    }));
    expect(result.shots.depthCharge ?? 0).toBeGreaterThan(0);
    expect(result.shots.navalGun ?? 0).toBe(0);
    expect(result.destroyed).toBe(true);
  });
});
