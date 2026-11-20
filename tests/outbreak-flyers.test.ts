import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { TICK_RATE, TILE_SIZE } from '../src/sim/constants';
import { createOutbreakScenario } from '../src/outbreak/scenario';
import { ZOMBIE_DEF_IDS, ZOMBIE_UNITS } from '../src/data/zombies';
import { ALL_UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';
import { BUILDINGS } from '../src/data/buildings';
import { canWeaponTarget, computeDamage, entityArmour } from '../src/sim/combat';
import { Rng } from '../src/core/rng';
import {
  PICKUP_DROP_CHANCE,
  PICKUP_VALUES,
  collectPickup,
  rollPickup,
  type Pickup,
  type PickupKind,
} from '../src/outbreak/pickups';
import { waveComposition, outbreakDifficulty } from '../src/outbreak/config';

/** Eight seconds of simulation, enough for a body to close a tile or two. */
const EIGHT_SECONDS = 8 * TICK_RATE;

function outbreakGame(): Game {
  const scenario = createOutbreakScenario({
    difficulty: 'normal',
    mode: 'solo',
    nationId: 'poland',
    seed: 9111,
  });
  return new Game(scenario, { enableAI: false });
}

function tick(game: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) game.tick();
}

describe('the flying mutant', () => {
  it('is an air-domain body with no airfield behind it', () => {
    const def = ALL_UNITS[ZOMBIE_DEF_IDS.flyer];
    expect(def).toBeTruthy();
    expect(def.domain).toBe('air');
    expect(def.moveClass).toBe('air');
    expect(def.flier).toBe(true);
    expect(def.targetClass).toBe('air');
    // Nothing builds it: the director is the only source of a body.
    expect(def.producedBy).toEqual([]);
  });

  it('is met by anti-air fire as an aircraft, never as light armour', () => {
    const game = outbreakGame();
    const flyer = game.spawnInfected(ZOMBIE_DEF_IDS.flyer, 40 * TILE_SIZE, 40 * TILE_SIZE, 1)!;
    // Damage is keyed on armour class: a dedicated SAM carries its whole
    // multiplier on `air` and nothing at all on `light`.
    expect(entityArmour(flyer)).toBe('air');
    expect(canWeaponTarget(WEAPONS.samVehicle, flyer)).toBe(true);
    expect(canWeaponTarget(WEAPONS.autocannon, flyer)).toBe(true);
    // Small arms cannot pick it out of the sky, which is what anti-air is for.
    expect(canWeaponTarget(WEAPONS.rifle, flyer)).toBe(false);
    expect(
      computeDamage(WEAPONS.samVehicle.damage, WEAPONS.samVehicle.multipliers, entityArmour(flyer)),
    ).toBeGreaterThan(0);
    expect(
      computeDamage(
        WEAPONS.autocannon.damage,
        WEAPONS.autocannon.multipliers,
        entityArmour(flyer),
      ),
    ).toBeGreaterThan(0);
  });

  it('spawns aloft instead of being walked onto a free tile', () => {
    const game = outbreakGame();
    const x = 40 * TILE_SIZE;
    const z = 40 * TILE_SIZE;
    const flyer = game.spawnInfected(ZOMBIE_DEF_IDS.flyer, x, z, 1)!;
    expect(flyer).toBeTruthy();
    // Placed where the horde asked for it, not snapped to the nearest open
    // ground tile.
    expect(Math.abs(flyer.x - x)).toBeLessThan(TILE_SIZE);
    expect(Math.abs(flyer.z - z)).toBeLessThan(TILE_SIZE);
    // No berth, no fuel clock: the aircraft recovery cycle never sees it.
    expect(flyer.aircraft).toBeUndefined();
    expect(flyer.maxFuel).toBe(0);
  });

  it('keeps flying — it is not parked or recalled by the recovery cycle', () => {
    const game = outbreakGame();
    const flyer = game.spawnInfected(ZOMBIE_DEF_IDS.flyer, 40 * TILE_SIZE, 40 * TILE_SIZE, 1)!;
    game.enqueueCommand({
      type: 'move',
      team: game.teamOf(1),
      ids: [flyer.id],
      x: 48 * TILE_SIZE,
      z: 48 * TILE_SIZE,
      attackMove: true,
    });
    tick(game, EIGHT_SECONDS);
    expect(flyer.hp).toBe(flyer.maxHp);
    expect(flyer.state).not.toBe('grounded');
    expect(flyer.x).toBeGreaterThan(40 * TILE_SIZE);
  });

  it('hunts on its own and rakes what it finds from the air', () => {
    const game = outbreakGame();
    const rifle = game.state.entities.find((e) => e.kind === 'unit' && e.owner === 0 && e.hp > 0)!;
    const flyer = game.spawnInfected(ZOMBIE_DEF_IDS.flyer, rifle.x + 2.5 * TILE_SIZE, rifle.z, 1)!;
    game.enqueueCommand({
      type: 'move',
      team: game.teamOf(1),
      ids: [flyer.id],
      x: rifle.x,
      z: rifle.z,
      attackMove: true,
    });
    tick(game, 10 * TICK_RATE);
    // An aircraft would decline to engage without an attack order; a flier
    // closes and hits, which is what makes anti-air fire worth buying.
    expect(rifle.hp).toBeLessThan(rifle.maxHp);
  });

  it('appears in the late waves rather than from the opening', () => {
    const normal = outbreakDifficulty('normal');
    const early = waveComposition(1, normal, 40);
    expect(early.flyer).toBe(0);
    const late = waveComposition(24, normal, 200);
    expect(late.flyer).toBeGreaterThan(0);
  });
});


describe('the horde and indestructible objectives', () => {
  it('leaves a player-owned relay alone', () => {
    const game = outbreakGame();
    const relay = game.state.entities.find((e) => e.kind === 'building' && e.defId === 'relay')!;
    expect(relay).toBeTruthy();
    expect(BUILDINGS.relay.capturable).toBe(true);
    // An engineer captured it: the horde now sees a player structure that no
    // amount of clawing can ever remove.
    relay.owner = 0;
    const startHp = relay.hp;
    const zombie = game.spawnInfected(ZOMBIE_DEF_IDS.shambler, relay.x + TILE_SIZE, relay.z, 1)!;
    tick(game, 12 * TICK_RATE);
    expect(relay.hp).toBe(startHp);
    expect(zombie.hp).toBeGreaterThan(0);
  });

  it('still goes after a structure it can actually destroy', () => {
    const game = outbreakGame();
    const sandbag = game.state.entities.find(
      (e) => e.kind === 'building' && e.defId === 'sandbags' && e.owner === 0,
    );
    // The outbreak map opens with MG nests and sandbags; either is a real target.
    const target = sandbag ?? game.state.entities.find((e) => e.kind === 'building' && e.owner === 0)!;
    game.spawnInfected(ZOMBIE_DEF_IDS.shambler, target.x + TILE_SIZE, target.z, 1);
    tick(game, 12 * TICK_RATE);
    expect(target.hp).toBeLessThan(target.maxHp);
  });
});

describe('horde drops', () => {
  it('falls only rarely', () => {
    const rng = new Rng(1234);
    let drops = 0;
    const seen = new Set<PickupKind>();
    for (let i = 0; i < 600; i++) {
      const drop = rollPickup(rng, 0, 0, i, i);
      if (!drop) continue;
      drops++;
      seen.add(drop.kind);
    }
    // Roughly one death in fourteen leaves something behind.
    const rate = drops / 600;
    expect(rate).toBeGreaterThan(PICKUP_DROP_CHANCE * 0.5);
    expect(rate).toBeLessThan(PICKUP_DROP_CHANCE * 1.6);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('pays materials to the commander whose unit walked over it', () => {
    const game = outbreakGame();
    const rifle = game.state.entities.find(
      (e) => e.kind === 'unit' && e.owner === 0 && e.hp > 0,
    )!;
    const player = game.player(0)!;
    const before = player.mats;
    const drop: Pickup = { id: 1, kind: 'mats', x: rifle.x, z: rifle.z, tick: 0 };
    const text = collectPickup(game, drop, 1);
    expect(text).toContain('materials');
    expect(player.mats).toBe(before + PICKUP_VALUES.mats);
  });

  it('promotes the crews around a field manual', () => {
    const game = outbreakGame();
    const rifle = game.state.entities.find((e) => e.kind === 'unit' && e.owner === 0 && e.hp > 0)!;
    const drop: Pickup = { id: 2, kind: 'veterancy', x: rifle.x, z: rifle.z, tick: 0 };
    expect(collectPickup(game, drop, 1)).toBeTruthy();
    expect(rifle.xp).toBeGreaterThan(0);
  });

  it('gives a squad battle speed that runs on the simulation clock', () => {
    const game = outbreakGame();
    const rifle = game.state.entities.find((e) => e.kind === 'unit' && e.owner === 0 && e.hp > 0)!;
    const drop: Pickup = { id: 3, kind: 'speed', x: rifle.x, z: rifle.z, tick: 0 };
    expect(collectPickup(game, drop, 1)).toContain('battle speed');
    expect(rifle.effects?.emergencyPower).toBe(PICKUP_VALUES.speedSeconds);
    tick(game, TICK_RATE);
    expect(rifle.effects?.emergencyPower).toBeCloseTo(PICKUP_VALUES.speedSeconds - 1, 1);
  });

  it('is not claimed by a unit standing somewhere else', () => {
    const game = outbreakGame();
    const rifle = game.state.entities.find((e) => e.kind === 'unit' && e.owner === 0 && e.hp > 0)!;
    const drop: Pickup = { id: 4, kind: 'req', x: rifle.x + 40, z: rifle.z + 40, tick: 0 };
    expect(collectPickup(game, drop, 1)).toBeNull();
  });

  it('leaves the infected unable to claim their own dead', () => {
    const game = outbreakGame();
    const zombie = game.spawnInfected(ZOMBIE_DEF_IDS.shambler, 40 * TILE_SIZE, 40 * TILE_SIZE, 1)!;
    const drop: Pickup = { id: 5, kind: 'mats', x: zombie.x, z: zombie.z, tick: 0 };
    expect(collectPickup(game, drop, 1)).toBeNull();
  });
});

describe('the outbreak ground', () => {
  it('carries enough ore for more than two lanes of income', () => {
    const scenario = createOutbreakScenario({
      difficulty: 'normal',
      mode: 'solo',
      nationId: 'poland',
      seed: 7,
    });
    const seams = scenario.tiles.filter((t) => (t.o ?? 0) > 0).length;
    const total = scenario.tiles.reduce((sum, t) => sum + (t.o ?? 0), 0);
    // The map opened with ten deposits on four lanes; the ring now carries
    // seams on every approach and every diagonal.
    expect(seams).toBeGreaterThan(140);
    expect(total).toBeGreaterThan(40000);
  });

  it('keeps every infected archetype registered exactly once', () => {
    const ids = ZOMBIE_UNITS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(ZOMBIE_DEF_IDS.flyer);
  });
});
