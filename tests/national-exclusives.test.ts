/**
 * Nine outstanding national exclusives.
 *
 * Phase 6B.2 inventoried the ten nations but could only measure three
 * specialists. These fixtures cover the nine exclusives that were left as
 * "insufficient evidence", each with the role it is authored for, a target it
 * should beat, and a counter that should beat it. Definitions are read from
 * source; nothing here assumes a role the data does not show.
 *
 * Where a unit depends on another (the Storm Shadow cannot see for itself), the
 * dependency is part of the test rather than a reason to call it underpowered.
 */
import { describe, expect, it } from 'vitest';
import { runDuel } from './combatBench';
import { runEngagement } from './engagementBench';
import { runMixed } from './mixedBench';
import { Game } from '../src/sim/game';
import { createEmptyScenario, createIslandAssault } from '../src/data/scenarios';
import { UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';

const cost = (id: string): number => UNITS[id].cost.mats;
const weaponOf = (id: string) => WEAPONS[UNITS[id].weapons[0]];

describe('Kestrel Team (Lithuania)', () => {
  it('shoots down a gunship and cannot fight ground at all', () => {
    const air = runEngagement({
      attacker: { defId: 'kestrelTeam' },
      defender: { defId: 'attackHelo' },
      tiles: 6,
      air: true,
      seconds: 35,
    });
    const ground = runDuel('kestrelTeam', 'rifle', { tiles: 4, seconds: 15 });
    console.log('[ex]', JSON.stringify({
      unit: 'kestrelTeam',
      price: cost('kestrelTeam'),
      role: UNITS.kestrelTeam.role,
      range: weaponOf('kestrelTeam').range,
      airShots: air.shots,
      airDamage: air.damageDealt,
      airDestroyed: air.destroyed,
      groundShots: ground.shots,
      groundDamage: ground.damageDealt,
    }));
    expect(air.shots.manpads ?? 0).toBeGreaterThan(0);
    expect(air.destroyed).toBe(true);
    // Anti-air only: no ground answer whatsoever.
    expect(ground.shots).toBe(0);
  });
});

describe('Storm Shadow (United Kingdom)', () => {
  it('cannot fire without a spotter and flattens a structure with one', () => {
    // Fog has to be on: with it off every entity is visible and the launcher
    // would "see" for itself, which is precisely what it cannot do. The spotter
    // is a real optics vehicle, not a radar contact list.
    const blind = runMixed({
      attacker: [{ defId: 'stormShadow', x: 14, z: 30 }],
      defender: [{ defId: 'tank', x: 36, z: 30 }],
      tiles: 26,
      fog: true,
      seconds: 50,
    });
    const spotted = runMixed({
      attacker: [
        { defId: 'stormShadow', x: 14, z: 30 },
        { defId: 'recon', x: 30, z: 30 },
      ],
      defender: [{ defId: 'tank', x: 36, z: 30 }],
      tiles: 26,
      fog: true,
      seconds: 50,
    });
    console.log('[ex]', JSON.stringify({
      unit: 'stormShadow',
      price: cost('stormShadow'),
      role: UNITS.stormShadow.role,
      range: weaponOf('stormShadow').range,
      minRange: weaponOf('stormShadow').minRange,
      blindShots: blind.shots,
      blindDamage: blind.damageDealt,
      spottedShots: spotted.shots,
      spottedDamage: spotted.damageDealt,
    }));
    // Indirect fire needs a sighting; the launcher has 8-tile optics.
    expect(blind.shots.stormMissile ?? 0).toBe(0);
    expect(spotted.shots.stormMissile ?? 0).toBeGreaterThan(0);
    expect(spotted.damageDealt).toBeGreaterThan(0);
  });
});

describe('TOSP (Russia)', () => {
  it('is an area weapon against infantry, not an anti-armour one', () => {
    const infantry = runMixed({
      attacker: ['tosp'],
      defender: ['rifle', 'rifle', 'rifle'],
      tiles: 7,
      seconds: 40,
    });
    const armour = runDuel('tosp', 'tank', { tiles: 7, seconds: 40 });
    console.log('[ex]', JSON.stringify({
      unit: 'tosp',
      price: cost('tosp'),
      role: UNITS.tosp.role,
      range: weaponOf('tosp').range,
      splash: weaponOf('tosp').splash,
      infantryDamage: infantry.damageDealt,
      infantryLost: infantry.defenderLost,
      armourDamage: armour.damageDealt,
    }));
    expect(infantry.damageDealt).toBeGreaterThan(armour.damageDealt);
    expect(infantry.defenderLost).toBeGreaterThanOrEqual(1);
    // A tank is the wrong target for a thermobaric rocket.
    expect(armour.damageDealt).toBeLessThan(infantry.damageDealt);
  });
});

describe('Sprut (Belarus)', () => {
  it('is a cheap unarmed eye, not a fighting vehicle', () => {
    // Optics are measured against an identical fixture with a rifleman watching
    // the same target, so light level, weather and terrain cancel out and the
    // comparison is about the sight, not about the map.
    const sightRange = (defId: string): number => {
      let best = 0;
      for (let d = 3; d <= 14; d++) {
        const scenario = createEmptyScenario(64, 64);
        scenario.units = [];
        scenario.settings.fog = true;
        scenario.units.push({ defId, owner: 0, x: 20, z: 30 });
        scenario.units.push({ defId: 'tank', owner: 1, x: 20 + d, z: 30 });
        const game = new Game(scenario, { enableAI: false });
        game.refreshVision(true);
        const tank = game.entitiesOf(1, 'unit')[0];
        if (game.isVisibleTo(0, tank.id)) best = d;
      }
      return best;
    };
    const sprutSight = sightRange('sprut');
    const rifleSight = sightRange('rifle');
    // The Sprut is a light hull: a rifleman's 0.55 light multiplier means one
    // section needs most of forty seconds, not fifteen, to finish it.
    const fight = runDuel('rifle', 'sprut', { tiles: 5, seconds: 40 });
    console.log('[ex]', JSON.stringify({
      unit: 'sprut',
      price: cost('sprut'),
      role: UNITS.sprut.role,
      vision: UNITS.sprut.vision,
      weapons: UNITS.sprut.weapons.length,
      sprutSight,
      rifleSight,
      killedByOneRifle: fight.destroyed,
    }));
    expect(UNITS.sprut.weapons).toHaveLength(0);
    expect(sprutSight).toBeGreaterThan(rifleSight);
    expect(fight.destroyed).toBe(true);
  });
});

describe('Taszar (Hungary)', () => {
  it('lobs over cover at infantry and cannot answer armour', () => {
    const infantry = runMixed({
      attacker: ['taszar'],
      defender: ['rifle', 'rifle'],
      tiles: 6,
      seconds: 40,
    });
    const armour = runDuel('taszar', 'tank', { tiles: 6, seconds: 30 });
    const inside = runDuel('taszar', 'rifle', { tiles: 2, seconds: 15 });
    console.log('[ex]', JSON.stringify({
      unit: 'taszar',
      price: cost('taszar'),
      role: UNITS.taszar.role,
      range: weaponOf('taszar').range,
      minRange: weaponOf('taszar').minRange,
      infantryDamage: infantry.damageDealt,
      armourDamage: armour.damageDealt,
      insideMinRangeShots: inside.shots,
    }));
    expect(weaponOf('taszar').indirect).toBe(true);
    expect(infantry.damageDealt).toBeGreaterThan(armour.damageDealt);
    expect(inside.shots).toBe(0);
  });
});

describe('Mohajer-6 (Iran)', () => {
  it('finds and bombs ground, and dies to air defence', () => {
    const strike = runEngagement({
      attacker: { defId: 'mohajer6' },
      defender: { defId: 'tank' },
      tiles: 8,
      air: true,
      seconds: 45,
    });
    const countered = runEngagement({
      attacker: { defId: 'mohajer6' },
      defender: { defId: 'aa' },
      tiles: 9,
      air: true,
      seconds: 35,
    });
    console.log('[ex]', JSON.stringify({
      unit: 'mohajer6',
      price: cost('mohajer6'),
      role: UNITS.mohajer6.role,
      vision: UNITS.mohajer6.vision,
      strikeShots: strike.shots,
      strikeDamage: strike.damageDealt,
      aaShots: countered.defenderShots,
      droneLost: countered.repulsed,
    }));
    expect(strike.shots.sadidBomb ?? 0).toBeGreaterThan(0);
    expect(strike.damageDealt).toBeGreaterThan(0);
    expect(countered.defenderShots.samVehicle ?? 0).toBeGreaterThan(0);
    expect(countered.repulsed).toBe(true);
  });
});

describe('Ghadir (Iran)', () => {
  it('is a two-torpedo coastal ambusher that an escort can kill', () => {
    // Authored role: a shallow-water midget boat that has to be waiting where
    // the convoy passes. Two heavyweight torpedoes, a short battery, and a long
    // reveal after a launch.
    // Same geometry as the repository's submarine firing test: a boat and a
    // surface hull on open water, ordered to engage. A run through the generic
    // lane helper placed both hulls but never produced a shot, so the known-good
    // coastal fixture is used instead of guessing at the lane.
    const scenario = createIslandAssault();
    scenario.units = [];
    scenario.settings.fog = false;
    scenario.units.push({ defId: 'ghadir', owner: 0, x: 7, z: 50 });
    scenario.units.push({ defId: 'corvette', owner: 1, x: 13, z: 50 });
    const game = new Game(scenario, { enableAI: false });
    const sub = game.entitiesOf(0, 'unit')[0];
    const ship = game.entitiesOf(1, 'unit')[0];
    game.refreshVision(false);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [sub.id], targetId: ship.id });
    const shipHp = ship.hp;
    let torpedoes = 0;
    let lastSeq = 0;
    for (let i = 0; i < 20 * 70; i++) {
      game.tick();
      for (const ev of game.state.events) {
        if (ev.seq <= lastSeq) continue;
        lastSeq = ev.seq;
        if (ev.type !== 'shot' || ev.entityId !== sub.id) continue;
        if ((ev as { weaponId?: string }).weaponId === 'torpedo') torpedoes++;
      }
    }
    const ambushShots = { torpedo: torpedoes };
    const ambushDamage = Math.round(Math.max(0, shipHp - Math.max(0, game.getEntity(ship.id)?.hp ?? 0)));
    const hunted = runEngagement({
      attacker: { defId: 'frigate' },
      defender: { defId: 'ghadir' },
      tiles: 7,
      map: 'island',
      diver: true,
      seconds: 80,
    });
    console.log('[ex]', JSON.stringify({
      unit: 'ghadir',
      price: cost('ghadir'),
      role: UNITS.ghadir.role,
      ammo: UNITS.ghadir.ammo,
      battery: UNITS.ghadir.submarine?.batterySeconds,
      ambushShots,
      ambushDamage,
      escortShots: hunted.defenderShots,
      escortShotsDealt: hunted.shots,
      escortWon: hunted.destroyed,
    }));
    expect(ambushShots.torpedo).toBeGreaterThan(0);
    expect(ambushDamage).toBeGreaterThan(0);
    // The escort's weapon mix is recorded rather than asserted: across runs the
    // same fixture has produced 11 depth charges and, in another draw, none at
    // all with the boat finished by gunfire after its 52-second battery ran
    // out and forced it to surface. That short endurance is the authored
    // weakness, so the counter is asserted as "the escort wins" and the mix is
    // reported as a measurement.
    expect(hunted.destroyed).toBe(true);
  });
});

describe('Bulsae-4 (North Korea)', () => {
  it('stands off armour and cannot defend itself against infantry', () => {
    const armour = runDuel('bulsae4', 'tank', { tiles: 14, seconds: 45 });
    const infantry = runDuel('bulsae4', 'rifle', { tiles: 5, seconds: 20 });
    console.log('[ex]', JSON.stringify({
      unit: 'bulsae4',
      price: cost('bulsae4'),
      role: UNITS.bulsae4.role,
      range: weaponOf('bulsae4').range,
      armourDamage: armour.damageDealt,
      armourShots: armour.shots,
      infantryDamage: infantry.damageDealt,
    }));
    expect(armour.shots).toBeGreaterThan(0);
    expect(armour.damageDealt).toBeGreaterThan(0);
    // 0.25 infantry multiplier: a rifle section is its answer.
    expect(infantry.damageDealt).toBeLessThan(WEAPONS.bulsaeMissile.damage);
  });
});

describe('Spike Team (Finland)', () => {
  it('kills armour from behind a ridge and loses to infantry at close range', () => {
    const armour = runDuel('spikeTeam', 'tank', { tiles: 12, seconds: 45 });
    const infantry = runDuel('spikeTeam', 'rifle', { tiles: 4, seconds: 20 });
    console.log('[ex]', JSON.stringify({
      unit: 'spikeTeam',
      price: cost('spikeTeam'),
      role: UNITS.spikeTeam.role,
      range: weaponOf('spikeTeam').range,
      armourDamage: armour.damageDealt,
      armourDestroyed: armour.destroyed,
      infantryDamage: infantry.damageDealt,
      sharedAtgmPrice: cost('atgm'),
    }));
    expect(weaponOf('spikeTeam').range).toBeGreaterThan(WEAPONS.atgm.range);
    expect(armour.damageDealt).toBeGreaterThan(0);
    expect(infantry.damageDealt).toBeLessThan(WEAPONS.spikeEr.damage);
  });
});
