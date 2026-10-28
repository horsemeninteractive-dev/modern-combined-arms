import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';
import { UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';
import { TILE_SIZE } from '../src/sim/constants';
import { normalizeAngle } from '../src/core/math';
import { unitBodyHeading } from '../src/render/unitTransform';
import type { Scenario } from '../src/sim/scenario';
import type { ArmourClass } from '../src/sim/types';

type Structure = { defId: string; owner: number; x: number; z: number };
type Unit = { defId: string; owner: number; x: number; z: number };

function scenarioWith(structures: Structure[] = [], units: Unit[] = []): Scenario {
  const scenario = createEmptyScenario(48, 40);
  scenario.settings.startingMats = 0;
  scenario.settings.startingReq = 0;
  scenario.settings.fog = false;
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].startX = 38;
  scenario.players[1].startZ = 30;
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'commandPost', owner: 1, x: 42, z: 34 },
    ...structures,
  ];
  scenario.units = units;
  return scenario;
}

function unit(game: Game, defId: string, owner = 0) {
  return game.entitiesOf(owner, 'unit').find((e) => e.defId === defId)!;
}

function secondsToKill(weaponId: string, armour: ArmourClass, hp: number): number {
  const weapon = WEAPONS[weaponId];
  const dps = (weapon.damage * (weapon.multipliers[armour] ?? 1) * weapon.accuracy) / weapon.cooldown;
  return hp / dps;
}

describe('support durability', () => {
  it('classes working vehicles as support rather than fighting armour', () => {
    expect(UNITS.engineer.armour).toBe('support');
    expect(UNITS.harvester.armour).toBe('support');
    expect(UNITS.tank.armour).toBe('heavy');
  });

  it('keeps a tank from deleting an economy vehicle in a few shells', () => {
    expect(secondsToKill('tankGun', 'support', UNITS.harvester.hp)).toBeGreaterThan(25);
    expect(secondsToKill('tankGun', 'support', UNITS.engineer.hp)).toBeGreaterThan(12);
    expect(secondsToKill('autocannon', 'support', UNITS.engineer.hp)).toBeGreaterThan(8);
  });

  it('makes direct fire work for a structure, without displacing siege artillery', () => {
    expect(secondsToKill('tankGun', 'structure', BUILDINGS.barracks.hp)).toBeGreaterThan(45);
    expect(secondsToKill('howitzer', 'structure', BUILDINGS.barracks.hp)).toBeGreaterThan(40);
    // Artillery's siege advantage is reach and splash, not raw single-target DPS.
    expect(WEAPONS.howitzer.multipliers.structure ?? 0).toBeGreaterThan(
      WEAPONS.tankGun.multipliers.structure ?? 1,
    );
    expect(WEAPONS.howitzer.range).toBeGreaterThan(WEAPONS.tankGun.range);
    expect(WEAPONS.howitzer.splash ?? 0).toBeGreaterThan(WEAPONS.tankGun.splash ?? 1);
  });

  it('defines a support multiplier for every ground-capable weapon', () => {
    for (const weapon of Object.values(WEAPONS)) {
      if (!weapon.targets.includes('ground')) continue;
      expect(typeof weapon.multipliers.support, weapon.id).toBe('number');
    }
  });
});

describe('infantry and engineer control', () => {
  it('lets a medic take cover in a garrisonable building', () => {
    const game = new Game(
      scenarioWith([{ defId: 'tenement', owner: -1, x: 24, z: 12 }], [
        { defId: 'medic', owner: 0, x: 22, z: 13 },
      ]),
      { enableAI: false },
    );
    const house = game.state.entities.find((e) => e.defId === 'tenement')!;
    const medic = unit(game, 'medic');
    game.enqueueCommand({ type: 'garrison', team: 0, ids: [medic.id], targetId: house.id });
    game.advance(30);
    expect(medic.garrisonId).toBe(house.id);
    expect(medic.state).toBe('garrisoned');
  });

  it('lets an engineer repair a shelter its infantry are holding', () => {
    const game = new Game(
      scenarioWith([{ defId: 'tenement', owner: -1, x: 24, z: 12 }], [
        { defId: 'rifle', owner: 0, x: 22, z: 13 },
        { defId: 'engineer', owner: 0, x: 19, z: 15 },
      ]),
      { enableAI: false },
    );
    const house = game.state.entities.find((e) => e.defId === 'tenement')!;
    const rifle = unit(game, 'rifle');
    const engineer = unit(game, 'engineer');
    game.enqueueCommand({ type: 'garrison', team: 0, ids: [rifle.id], targetId: house.id });
    game.advance(30);
    expect(rifle.garrisonId).toBe(house.id);

    house.hp = house.maxHp * 0.5;
    house.lastHitTick = -9999;
    game.enqueueCommand({ type: 'repair', team: 0, ids: [engineer.id], targetId: house.id });
    game.advance(20 * 8);
    expect(house.hp).toBeGreaterThan(house.maxHp * 0.5);
  });

  it('still refuses to repair a neutral shelter nobody holds', () => {
    const game = new Game(
      scenarioWith([{ defId: 'tenement', owner: -1, x: 24, z: 12 }], [
        { defId: 'engineer', owner: 0, x: 22, z: 14 },
      ]),
      { enableAI: false },
    );
    const house = game.state.entities.find((e) => e.defId === 'tenement')!;
    house.hp = house.maxHp * 0.5;
    game.enqueueCommand({ type: 'repair', team: 0, ids: [unit(game, 'engineer').id], targetId: house.id });
    game.advance(4);
    expect(house.hp).toBe(house.maxHp * 0.5);
    expect(game.state.events.some((e) => /shelter your infantry hold/.test(e.text))).toBe(true);
  });
});

describe('harvester and unit movement', () => {
  it('keeps a manual harvester move instead of re-seeking ore next tick', () => {
    const game = new Game(scenarioWith([], [{ defId: 'harvester', owner: 0, x: 10, z: 10 }]), {
      enableAI: false,
    });
    const harvester = unit(game, 'harvester');
    const startX = harvester.x;
    const destX = 26 * TILE_SIZE;
    const destZ = 20 * TILE_SIZE;
    game.enqueueCommand({ type: 'move', team: 0, ids: [harvester.id], x: destX, z: destZ });
    game.advance(8);
    expect(harvester.order?.type).toBe('move');
    expect(harvester.destX).toBe(destX);
    expect(harvester.destZ).toBe(destZ);
    expect(harvester.x).toBeGreaterThan(startX);
  });

  it('never displaces an idle unit when an enemy drives into it', () => {
    const game = new Game(
      scenarioWith([], [
        { defId: 'rifle', owner: 0, x: 20, z: 20 },
        { defId: 'tank', owner: 1, x: 14, z: 20 },
      ]),
      { enableAI: false },
    );
    const rifle = unit(game, 'rifle');
    const tank = unit(game, 'tank', 1);
    const x = rifle.x;
    const z = rifle.z;
    game.enqueueCommand({ type: 'move', team: 1, ids: [tank.id], x: 26 * TILE_SIZE, z: 20 * TILE_SIZE });
    game.advance(20 * 8);
    expect(rifle.x).toBe(x);
    expect(rifle.z).toBe(z);
  });

  it('does not shove an idle friendly unit out of a vehicle\'s lane', () => {
    const game = new Game(
      scenarioWith([], [
        { defId: 'rifle', owner: 0, x: 20, z: 20 },
        { defId: 'tank', owner: 0, x: 14, z: 20 },
      ]),
      { enableAI: false },
    );
    const rifle = unit(game, 'rifle');
    const tank = unit(game, 'tank');
    const x = rifle.x;
    const z = rifle.z;
    game.enqueueCommand({ type: 'move', team: 0, ids: [tank.id], x: 26 * TILE_SIZE, z: 20 * TILE_SIZE });
    game.advance(20 * 8);
    expect(rifle.x).toBe(x);
    expect(rifle.z).toBe(z);
  });

  it('turns an aircraft onto its flight heading instead of leaving it fixed', () => {
    const game = new Game(scenarioWith([], [{ defId: 'fighter', owner: 0, x: 10, z: 10 }]), {
      enableAI: false,
    });
    const fighter = unit(game, 'fighter');
    fighter.facing = Math.PI;
    fighter.turretFacing = Math.PI;
    game.enqueueCommand({ type: 'move', team: 0, ids: [fighter.id], x: 30 * TILE_SIZE, z: 10 * TILE_SIZE });
    game.advance(30);
    expect(Math.abs(normalizeAngle(fighter.facing))).toBeLessThan(0.35);
    // The airframe is drawn on that heading, not on a stale turret angle.
    expect(unitBodyHeading(false, true, fighter.facing, Math.PI)).toBe(fighter.facing);
    expect(unitBodyHeading(false, false, 1.2, 0.3)).toBe(0.3);
    expect(unitBodyHeading(true, false, 1.2, 0.3)).toBe(1.2);
  });

  it('drives along the hull heading rather than sliding sideways', () => {
    const game = new Game(scenarioWith([], [{ defId: 'tank', owner: 0, x: 10, z: 10 }]), {
      enableAI: false,
    });
    const tank = unit(game, 'tank');
    tank.facing = Math.PI; // face west, then order east
    game.enqueueCommand({ type: 'move', team: 0, ids: [tank.id], x: 30 * TILE_SIZE, z: 10 * TILE_SIZE });
    for (let i = 0; i < 24; i++) {
      const x = tank.x;
      const z = tank.z;
      game.tick();
      const dx = tank.x - x;
      const dz = tank.z - z;
      if (Math.hypot(dx, dz) < 0.001) continue;
      const travel = Math.atan2(dz, dx);
      // Every metre covered points along the nose; the hull never crabs.
      expect(Math.abs(normalizeAngle(travel - tank.facing))).toBeLessThan(0.001);
    }
  });
});
