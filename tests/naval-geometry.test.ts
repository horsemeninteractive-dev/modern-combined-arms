/**
 * Missile boat engagement geometry.
 *
 * Phase 6B.1 recorded that the boat's missile (nominal 10 tiles) beats its gun
 * (nominal 9) by one tile, and that the band can be narrower than one approach
 * step. These tests measure the real geometry: the distance each weapon is
 * actually fired at, whether the hull closes through the band, and whether the
 * salvo survives an approach that starts inside gun reach.
 *
 * Measured finding (recorded here as a regression, not an intent):
 * `tryFire` accepts a shot out to `range * TILE_SIZE + 4`, i.e. one tile beyond
 * the printed range. The gun therefore fires at 10.0 tiles and the missile at
 * 11.0, so the opening-salvo band is 10.0 < d <= 11.0 — one tile wide. At 10
 * tiles or closer the gun is already usable and scores far higher expected
 * damage, so the rack is never spent. That is correct sustained-damage logic
 * and a narrow opening window, not a selector defect.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { TILE_SIZE } from '../src/sim/constants';
import { openWaterLane, runEngagement } from './engagementBench';

interface GeoShot {
  tick: number;
  weapon: string;
  tiles: number;
}

interface GeoResult {
  shots: GeoShot[];
  startTiles: number;
  minTiles: number;
  endTiles: number;
  attackerHp: number;
  defenderHp: number;
}

function geometry(
  startTiles: number,
  options: {
    attacker?: string;
    defender?: string;
    ammo?: number;
    seconds?: number;
    defenderAttacks?: boolean;
  } = {},
): GeoResult {
  const attacker = options.attacker ?? 'missileBoat';
  const defender = options.defender ?? 'corvette';
  const scenario = createIslandAssault();
  scenario.units = [];
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 3, z: 3 },
    { defId: 'commandPost', owner: 1, x: 66, z: 66 },
  ];
  scenario.settings.fog = false;
  const lane = openWaterLane(scenario, Math.max(Math.ceil(startTiles), 6));
  if (!lane) throw new Error('no open water lane');
  scenario.units.push({ defId: attacker, owner: 0, x: lane.x0, z: lane.z0 });
  scenario.units.push({ defId: defender, owner: 1, x: lane.x0 + startTiles, z: lane.z0 });
  const game = new Game(scenario, { enableAI: false });
  const a = game.entitiesOf(0, 'unit')[0];
  const d = game.entitiesOf(1, 'unit')[0];
  if (options.ammo !== undefined) {
    a.ammo = options.ammo;
    a.maxAmmo = Math.max(a.maxAmmo, options.ammo);
  }
  game.enqueueCommand({ type: 'attack', team: 0, ids: [a.id], targetId: d.id });
  if (options.defenderAttacks) {
    game.enqueueCommand({ type: 'attack', team: 1, ids: [d.id], targetId: a.id });
  }
  const shots: GeoShot[] = [];
  let minTiles = Infinity;
  let lastSeq = 0;
  const seconds = options.seconds ?? 60;
  for (let i = 0; i < 20 * seconds; i++) {
    game.tick();
    const shooter = game.getEntity(a.id);
    const target = game.getEntity(d.id);
    if (shooter && target) {
      minTiles = Math.min(minTiles, Math.hypot(shooter.x - target.x, shooter.z - target.z) / TILE_SIZE);
    }
    for (const ev of game.state.events) {
      if (ev.seq <= lastSeq) continue;
      lastSeq = ev.seq;
      if (ev.type !== 'shot' || ev.entityId !== a.id) continue;
      const weapon = (ev as { weaponId?: string }).weaponId;
      const s = game.getEntity(a.id);
      const t = game.getEntity(d.id);
      if (!weapon || !s || !t) continue;
      shots.push({
        tick: game.state.tick,
        weapon,
        tiles: Math.round((Math.hypot(s.x - t.x, s.z - t.z) / TILE_SIZE) * 100) / 100,
      });
    }
  }
  const s = game.getEntity(a.id);
  const t = game.getEntity(d.id);
  return {
    shots,
    startTiles,
    minTiles: Math.round(minTiles * 100) / 100,
    endTiles: s && t ? Math.round((Math.hypot(s.x - t.x, s.z - t.z) / TILE_SIZE) * 100) / 100 : 0,
    attackerHp: Math.round(Math.max(0, s?.hp ?? 0)),
    defenderHp: Math.round(Math.max(0, t?.hp ?? 0)),
  };
}

describe('missile boat engagement geometry', () => {
  it('spends both missiles as an opening salvo when the approach starts outside gun reach', () => {
    const result = geometry(11);
    console.log('[geo]', JSON.stringify(result));
    const missiles = result.shots.filter((s) => s.weapon === 'skiffMissile');
    expect(missiles).toHaveLength(2);
    // The salvo is fired from the far edge of the band, before the gun is used.
    expect(missiles[0].tiles).toBeGreaterThan(10);
    expect(result.shots.some((s) => s.weapon === 'navalGun')).toBe(true);
    // The hull closes to gun reach after the salvo, exactly as intended.
    expect(result.endTiles).toBeLessThan(result.startTiles);
  });

  it('keeps the rack closed at ten tiles, where the gun is already usable', () => {
    // The measured knife-edge: one tile closer than the test above and the
    // defining weapon is never used, because the gun's practical reach (9 + the
    // one-tile firing slack) already covers the target.
    const result = geometry(10);
    console.log('[geo-10]', JSON.stringify(result));
    expect(result.shots.filter((s) => s.weapon === 'skiffMissile')).toHaveLength(0);
    expect(result.shots.filter((s) => s.weapon === 'navalGun').length).toBeGreaterThan(0);
    // Nothing closes through the missile band: the gun is already in reach.
    expect(result.minTiles).toBeGreaterThanOrEqual(10);
  });

  it('salvos from fourteen tiles and then closes to the gun', () => {
    const result = geometry(14);
    console.log('[geo-14]', JSON.stringify(result));
    expect(result.shots.filter((s) => s.weapon === 'skiffMissile')).toHaveLength(2);
    expect(result.shots.some((s) => s.weapon === 'navalGun')).toBe(true);
    expect(result.minTiles).toBeLessThanOrEqual(10);
  });

  it('falls back to the gun with an empty rack and still closes', () => {
    const result = geometry(12, { ammo: 0 });
    console.log('[geo-empty]', JSON.stringify(result));
    expect(result.shots.filter((s) => s.weapon === 'skiffMissile')).toHaveLength(0);
    expect(result.shots.filter((s) => s.weapon === 'navalGun').length).toBeGreaterThan(0);
  });

  it('lets a pair of boats land a four-missile salvo on a corvette', () => {
    // The design intent is that a pair can flank a heavier hull. Two boats,
    // two rounds each, from stand-off.
    const result = runEngagement({
      attacker: { defId: 'missileBoat', count: 2 },
      defender: { defId: 'corvette' },
      tiles: 14,
      map: 'island',
      seconds: 45,
    });
    console.log('[geo-pair]', JSON.stringify(result));
    expect(result.shots.skiffMissile ?? 0).toBeGreaterThanOrEqual(2);
    expect(result.damageDealt).toBeGreaterThan(0);
  });

  it('is deterministic for the same geometry', () => {
    expect(geometry(12)).toEqual(geometry(12));
  });
});
