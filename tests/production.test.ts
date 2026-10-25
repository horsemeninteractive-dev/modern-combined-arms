import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { TILE_SIZE } from '../src/sim/constants';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS, BUILDABLE_BY_PLAYER } from '../src/data/buildings';
import { UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';
import { structureTab } from '../src/ui/hudLayout';
import type { Entity } from '../src/sim/types';

function newGame(withFactory = false): Game {
  const scenario = createIslandAssault();
  if (withFactory) scenario.structures.push({ defId: 'factory', owner: 0, x: 30, z: 34 });
  return new Game(scenario, { enableAI: false });
}

function commandPost(game: Game): Entity {
  return game.entitiesOf(0, 'building').find((e) => e.defId === 'commandPost')!;
}

function engineers(game: Game): number {
  return game.entitiesOf(0, 'unit').filter((e) => e.defId === 'engineer').length;
}

describe('engineer production fallback', () => {
  it('trains engineers at the command post while no factory stands', () => {
    const game = newGame();
    const hq = commandPost(game);
    const status = game.productionStatus(0, hq.id, 'engineer');
    expect(status.ok).toBe(true);

    game.enqueueCommand({ type: 'produce', team: 0, buildingId: hq.id, defId: 'engineer' });
    game.advance(20 * 14);
    expect(engineers(game)).toBe(2);
  });

  it('hands engineer production to an operational factory', () => {
    const game = newGame(true);
    const hq = commandPost(game);
    const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
    expect(game.productionStatus(0, hq.id, 'engineer').ok).toBe(false);
    expect(game.productionStatus(0, factory.id, 'engineer').ok).toBe(true);
  });

  it('reopens the command post fallback when the factory is destroyed', () => {
    const game = newGame(true);
    const hq = commandPost(game);
    const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
    expect(game.productionStatus(0, hq.id, 'engineer').ok).toBe(false);
    factory.hp = 0;
    game.advance(1);
    expect(game.productionStatus(0, hq.id, 'engineer').ok).toBe(true);
  });
});

describe('production queue priority', () => {
  it('moves every queued copy of a type ahead of its target without cost or progress loss', () => {
    const game = newGame(true);
    const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
    const player = game.player(0)!;
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: 'tank' });
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: 'engineer' });
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: 'engineer' });
    game.advance(1);
    expect(factory.queue.map((item) => item.defId)).toEqual(['tank', 'engineer', 'engineer']);

    const tankItem = factory.queue[0];
    const engineerItem = factory.queue[1];
    game.advance(20);
    const tankRemaining = tankItem.remaining;
    const materials = player.mats;

    game.enqueueCommand({
      type: 'reorderProduction',
      team: 0,
      buildingId: factory.id,
      defId: 'engineer',
      beforeDefId: 'tank',
    });
    game.advance(1);

    expect(factory.queue.map((item) => item.defId)).toEqual(['engineer', 'engineer', 'tank']);
    expect(factory.queue[0]).toBe(engineerItem);
    expect(factory.queue[2]).toBe(tankItem);
    expect(tankItem.remaining).toBe(tankRemaining);
    expect(player.mats).toBe(materials);
  });

  it('rejects foreign or missing targets and leaves the queue untouched', () => {
    const game = newGame(true);
    const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: 'tank' });
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: 'engineer' });
    game.advance(1);
    const before = factory.queue.map((item) => item.defId);

    game.enqueueCommand({
      type: 'reorderProduction',
      team: 1,
      buildingId: factory.id,
      defId: 'engineer',
      beforeDefId: 'tank',
    });
    game.enqueueCommand({
      type: 'reorderProduction',
      team: 0,
      buildingId: factory.id,
      defId: 'engineer',
      beforeDefId: 'recon',
    });
    game.advance(1);

    expect(factory.queue.map((item) => item.defId)).toEqual(before);
  });
});

describe('requisition is reserved for advanced assets', () => {
  it('keeps core units material-only', () => {
    expect(UNITS.rifle.cost.req).toBe(0);
    expect(UNITS.engineer.cost.req).toBe(0);
    expect(UNITS.tank.cost.req).toBe(0);
    expect(UNITS.recon.cost.req).toBe(0);
    expect(UNITS.harvester.cost.req).toBe(0);
  });

  it('charges requisition for specialist units', () => {
    expect(UNITS.atgm.cost.req).toBeGreaterThan(0);
    expect(UNITS.aa.cost.req).toBeGreaterThan(0);
    expect(UNITS.fighter.cost.req).toBeGreaterThan(0);
    expect(UNITS.corvette.cost.req).toBeGreaterThan(0);
  });

  it('leaves the core factory material-only and keeps advanced facilities gated', () => {
    expect(BUILDINGS.factory.cost.req).toBe(0);
    expect(BUILDINGS.barracks.cost.req).toBe(0);
    expect(BUILDINGS.refinery.cost.req).toBe(0);
    expect(BUILDINGS.powerPlant.cost.req).toBe(0);
    expect(BUILDINGS.samBattery.cost.req).toBeGreaterThan(0);
    expect(BUILDINGS.airfield.cost.req).toBeGreaterThan(0);
    expect(BUILDINGS.shipyard.cost.req).toBeGreaterThan(0);
  });
});

describe('static ground defences', () => {
  it('sites anti-infantry and anti-armour emplacements under the defence tab', () => {
    for (const id of ['mgNest', 'atTurret', 'samBattery', 'radar']) {
      expect(BUILDABLE_BY_PLAYER.some((b) => b.id === id)).toBe(true);
    }
    expect(structureTab(!!BUILDINGS.mgNest.weapons?.length)).toBe('defence');
    expect(structureTab(!!BUILDINGS.atTurret.weapons?.length)).toBe('defence');
    expect(BUILDINGS.mgNest.turretRate).toBeGreaterThan(0);
    expect(BUILDINGS.atTurret.turretRate).toBeGreaterThan(0);
    expect(BUILDINGS.radar.radar).toBe(true);
  });

  it('keeps their weapons specialised instead of duplicating the SAM role', () => {
    expect(WEAPONS.heavyMg.targets).toEqual(['ground']);
    expect(WEAPONS.heavyMg.multipliers.infantry).toBeGreaterThan(1.5);
    expect(WEAPONS.heavyMg.multipliers.heavy).toBeLessThan(0.1);
    expect(WEAPONS.atTurretGun.targets).toContain('ground');
    expect(WEAPONS.atTurretGun.targets).not.toContain('air');
    expect(WEAPONS.atTurretGun.multipliers.heavy).toBeGreaterThan(1.5);
  });

  it('fires on the ground target its role is designed for', () => {
    const scenario = createIslandAssault();
    scenario.structures.push({ defId: 'mgNest', owner: 0, x: 34, z: 30 });
    scenario.units.push({ defId: 'tank', owner: 1, x: 34, z: 34 });
    const game = new Game(scenario, { enableAI: false });
    const target = game.state.entities
      .filter((e) => e.defId === 'tank' && e.owner === 1)
      .at(-1)!;
    const nest = game.state.entities.find((e) => e.defId === 'mgNest' && e.owner === 0)!;
    const targetHp = target.hp;
    game.advance(20 * 3);
    expect(target.hp).toBeLessThan(targetHp);
    // The target is due south of the mount, so the turret has traversed off east.
    expect(Math.abs(Math.cos(nest.turretFacing))).toBeLessThan(0.15);
  });

  it('accepts an explicit target order and does not chase other contacts', () => {
    const scenario = createIslandAssault();
    scenario.structures.push({ defId: 'atTurret', owner: 0, x: 34, z: 30 });
    scenario.units.push(
      { defId: 'tank', owner: 1, x: 34, z: 34 },
      { defId: 'tank', owner: 1, x: 40, z: 30 },
    );
    const game = new Game(scenario, { enableAI: false });
    const turret = game.entitiesOf(0, 'building').find((e) => e.defId === 'atTurret')!;
    const tanks = game
      .entitiesOf(1, 'unit')
      .filter((e) => e.defId === 'tank' && e.x < 50 * TILE_SIZE);
    const chosen = tanks.reduce((a, b) => (a.x > b.x ? a : b));
    const ignored = tanks.reduce((a, b) => (a.x < b.x ? a : b));
    const chosenHp = chosen.hp;
    const x = turret.x;
    const z = turret.z;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [turret.id], targetId: chosen.id });
    game.advance(20 * 5);
    expect(turret.order).toEqual({ type: 'attack', targetId: chosen.id });
    expect(turret.aimTargetId).toBe(chosen.id);
    expect(chosen.hp).toBeLessThan(chosenHp);
    // The closer auto-acquisition candidate is not the ordered target.
    expect(ignored.id).not.toBe(chosen.id);
    expect(turret.x).toBe(x);
    expect(turret.z).toBe(z);
  });

  it('engages armour and structures with the anti-tank gun', () => {
    const scenario = createIslandAssault();
    scenario.structures.push({ defId: 'atTurret', owner: 0, x: 34, z: 34 });
    scenario.units.push({ defId: 'tank', owner: 1, x: 38, z: 34 });
    const game = new Game(scenario, { enableAI: false });
    const tank = game.state.entities
      .filter((e) => e.defId === 'tank' && e.owner === 1)
      .at(-1)!;
    const tankHp = tank.hp;
    game.advance(20 * 14);
    expect(tank.hp < tankHp || !game.getEntity(tank.id)).toBe(true);
  });
});

describe('facility rally points', () => {
  it('builds units on the apron and walks them to the rally point', () => {
    const game = newGame(true);
    const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
    const player = game.player(0)!;
    player.mats = 6000;
    player.req = 400;
    const rallyX = factory.x + 10 * TILE_SIZE;
    const rallyZ = factory.z;
    factory.rallyX = rallyX;
    factory.rallyZ = rallyZ;
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: 'tank' });

    let spawned: Entity | null = null;
    let apronDistance = 0;
    for (let i = 0; i < 20 * 45 && !spawned; i++) {
      const before = new Set(game.entitiesOf(0, 'unit').map((e) => e.id));
      game.tick();
      const fresh = game.entitiesOf(0, 'unit').find((e) => !before.has(e.id));
      if (fresh) {
        spawned = fresh;
        apronDistance = Math.hypot(fresh.x - factory.x, fresh.z - factory.z);
      }
    }
    expect(spawned).not.toBeNull();
    // Beside the structure, not on the footprint and not at the rally point.
    expect(apronDistance).toBeGreaterThan(BUILDINGS.factory.footprint.w * TILE_SIZE * 0.4);
    expect(apronDistance).toBeLessThan(6 * TILE_SIZE);
    expect(spawned!.order?.type).toBe('move');

    game.advance(20 * 15);
    expect(Math.hypot(spawned!.x - rallyX, spawned!.z - rallyZ)).toBeLessThan(3 * TILE_SIZE);
  });
});
