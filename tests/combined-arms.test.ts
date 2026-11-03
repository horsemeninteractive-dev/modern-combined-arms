import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { TILE_SIZE } from '../src/sim/constants';
import { hasLineOfSight } from '../src/sim/combat';
import { Terrain } from '../src/sim/terrain';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS, BUILDING_LIST, BUILDABLE_BY_PLAYER } from '../src/data/buildings';
import { UNITS, UNIT_LIST, unitFamily } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';
import { completeResearch, islandWith } from './helpers';
import type { Entity } from '../src/sim/types';

function lastUnit(game: Game, owner: number, defId: string): Entity {
  return game.state.entities.filter((e) => e.kind === 'unit' && e.owner === owner && e.defId === defId).at(-1)!;
}

function lastBuilding(game: Game, owner: number, defId: string): Entity {
  return game.state.entities
    .filter((e) => e.kind === 'building' && e.owner === owner && e.defId === defId)
    .at(-1)!;
}

function retireOtherUnits(game: Game, owner: number, keep: string[]): void {
  for (const e of game.state.entities) {
    if (e.owner === owner && e.kind === 'unit' && !keep.includes(e.defId)) e.hp = 0;
  }
}

describe('combined-arms baseline content', () => {
  it('registers every production reference and exposes the new roles', () => {
    for (const building of BUILDING_LIST) {
      for (const unitId of building.productionList ?? []) {
        expect(UNITS[unitId], `${building.id} produces ${unitId}`).toBeDefined();
      }
    }
    for (const unit of UNIT_LIST) {
      for (const buildingId of unit.producedBy) {
        expect(BUILDINGS[buildingId], `${unit.id} produced by ${buildingId}`).toBeDefined();
      }
    }

    expect(UNITS.spg.role).toBe('Indirect fire');
    expect(UNITS.recovery.repair).toBeDefined();
    expect(UNITS.interceptor.weapons).toEqual(['airMissile']);
    expect(UNITS.uav.weapons).toEqual([]);
    expect(BUILDINGS.coastalBattery.requiresWater).toBe(true);
    expect(BUILDABLE_BY_PLAYER.some((b) => b.id === 'coastalBattery')).toBe(true);
    expect(BUILDINGS.factory.productionList).toEqual(
      expect.arrayContaining(['spg', 'recovery']),
    );
    expect(BUILDINGS.airfield.productionList).toEqual(
      expect.arrayContaining(['interceptor', 'uav']),
    );
  });

  it('offers each new unit through a legitimate production facility', () => {
    const game = new Game(
      islandWith({
        structures: [
          { defId: 'factory', owner: 0, x: 30, z: 34 },
          { defId: 'airfield', owner: 0, x: 24, z: 24 },
        ],
      }),
      { enableAI: false },
    );
    game.player(0)!.mats = 6000;
    game.player(0)!.req = 500;
    // The facility list, not the research gate, is what this test measures.
    completeResearch(game, 0);
    const factory = lastBuilding(game, 0, 'factory');
    const airfield = lastBuilding(game, 0, 'airfield');
    for (const defId of ['spg', 'recovery']) {
      expect(game.productionStatus(0, factory.id, defId).ok, defId).toBe(true);
    }
    for (const defId of ['interceptor', 'uav']) {
      expect(game.productionStatus(0, airfield.id, defId).ok, defId).toBe(true);
    }
  });

  it('keeps the new weapons in their intended target lanes', () => {
    expect(WEAPONS.howitzer.indirect).toBe(true);
    expect(WEAPONS.howitzer.minRange).toBeGreaterThan(0);
    expect(WEAPONS.howitzer.targets).not.toContain('air');
    expect(WEAPONS.airMissile.targets).toEqual(['air']);
    expect(WEAPONS.strikeMissile.targets).not.toContain('air');
    expect(WEAPONS.coastalMissile.targets).toEqual(['naval']);
  });
});

describe('indirect fire', () => {
  it('lobs shells over a forest wall using radar visibility, not line of sight', () => {
    const scenario = islandWith({
      structures: [{ defId: 'radarStation', owner: 0, x: 20, z: 34 }],
      units: [
        { defId: 'spg', owner: 0, x: 28, z: 42 },
        { defId: 'tank', owner: 1, x: 40, z: 42 },
      ],
    });
    for (let x = 33; x <= 36; x++) {
      const i = 42 * scenario.width + x;
      scenario.tiles[i].t = Terrain.Forest;
      scenario.tiles[i].e = 1;
    }
    const game = new Game(scenario, { enableAI: false });
    const spg = lastUnit(game, 0, 'spg');
    const tank = lastUnit(game, 1, 'tank');
    const hp = tank.hp;

    expect(hasLineOfSight(game.state.map, spg.x, spg.z, tank.x, tank.z)).toBe(false);
    expect(game.isVisibleTo(0, tank.id)).toBe(true);

    let sawLob = false;
    for (let i = 0; i < 400 && !sawLob; i++) {
      game.tick();
      if (game.state.projectiles.some((p) => p.lob)) sawLob = true;
    }
    expect(sawLob).toBe(true);

    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), {
      enableAI: false,
    });
    expect(restored.stateHash()).toBe(game.stateHash());

    game.advance(20 * 20);
    restored.advance(20 * 20);
    expect(restored.stateHash()).toBe(game.stateHash());
    expect(tank.hp).toBeLessThan(hp);
  });

  it('does not fire inside its minimum range', () => {
    const game = new Game(
      islandWith({
        units: [
          { defId: 'spg', owner: 0, x: 28, z: 42 },
          { defId: 'recovery', owner: 1, x: 30, z: 42 },
        ],
      }),
      { enableAI: false },
    );
    retireOtherUnits(game, 0, ['spg']);
    const target = lastUnit(game, 1, 'recovery');
    const hp = target.hp;
    game.advance(20 * 8);
    expect(target.hp).toBe(hp);
  });
});

describe('field recovery', () => {
  it('repairs a nearby vehicle at material cost, but not infantry', () => {
    const game = new Game(
      islandWith({
        units: [
          { defId: 'recovery', owner: 0, x: 28, z: 42 },
          { defId: 'tank', owner: 0, x: 30, z: 42 },
          { defId: 'rifle', owner: 0, x: 28, z: 44 },
        ],
      }),
      { enableAI: false },
    );
    retireOtherUnits(game, 0, ['recovery', 'tank', 'rifle']);
    const recovery = lastUnit(game, 0, 'recovery');
    const tank = lastUnit(game, 0, 'tank');
    const rifle = lastUnit(game, 0, 'rifle');
    tank.hp = tank.maxHp * 0.4;
    rifle.hp = rifle.maxHp * 0.5;
    const tankHp = tank.hp;
    const rifleHp = rifle.hp;
    game.player(0)!.mats = 5000;
    const mats = game.player(0)!.mats;

    game.advance(20 * 5);

    expect(tank.hp).toBeGreaterThan(tankHp);
    expect(rifle.hp).toBe(rifleHp);
    expect(game.player(0)!.mats).toBeLessThan(mats);
    expect(recovery.state).toBe('repairing');

    const saved = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), {
      enableAI: false,
    });
    expect(saved.stateHash()).toBe(game.stateHash());
  });
});

describe('air superiority and reconnaissance aviation', () => {
  it('intercepts hostile aircraft with air-to-air missiles', () => {
    const game = new Game(
      islandWith({
        structures: [{ defId: 'airfield', owner: 0, x: 24, z: 24 }],
        units: [
          { defId: 'interceptor', owner: 0, x: 24, z: 24 },
          { defId: 'fighter', owner: 1, x: 32, z: 28 },
        ],
      }),
      { enableAI: false },
    );
    const interceptor = lastUnit(game, 0, 'interceptor');
    const fighter = lastUnit(game, 1, 'fighter');
    fighter.aircraft!.landed = false;
    fighter.order = null;
    const hp = fighter.hp;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [interceptor.id], targetId: fighter.id });
    game.advance(20 * 18);
    expect(fighter.hp < hp || !game.getEntity(fighter.id)).toBe(true);
  });

  it('uses the drone to reveal ground far beyond the land scout', () => {
    const game = new Game(
      islandWith({
        structures: [{ defId: 'airfield', owner: 0, x: 24, z: 24 }],
        units: [
          { defId: 'uav', owner: 0, x: 24, z: 24 },
          { defId: 'tank', owner: 1, x: 36, z: 30 },
        ],
      }),
      { enableAI: false },
    );
    const uav = lastUnit(game, 0, 'uav');
    const tank = lastUnit(game, 1, 'tank');
    expect(UNITS.uav.vision).toBeGreaterThan(UNITS.recon.vision);
    uav.x = 24 * TILE_SIZE;
    uav.z = 30 * TILE_SIZE;
    uav.aircraft!.landed = false;
    uav.order = null;
    uav.path = [];
    game.refreshVision(true);
    expect(game.isVisibleTo(0, tank.id)).toBe(true);
  });
});

describe('coastal defence', () => {
  it('engages ships from a shore battery but cannot fire at ground targets', () => {
    const game = new Game(
      islandWith({
        structures: [{ defId: 'coastalBattery', owner: 0, x: 12, z: 40 }],
        units: [
          { defId: 'corvette', owner: 1, x: 9, z: 48 },
          { defId: 'recovery', owner: 1, x: 12, z: 42 },
        ],
      }),
      { enableAI: false },
    );
    retireOtherUnits(game, 0, []);
    const ship = lastUnit(game, 1, 'corvette');
    const ground = lastUnit(game, 1, 'recovery');
    const shipHp = ship.hp;
    const groundHp = ground.hp;
    game.advance(20 * 10);
    expect(ship.hp).toBeLessThan(shipHp);
    expect(ground.hp).toBe(groundHp);
  });
});

describe('AI use of the completed baseline', () => {
  it('fields interceptors and a reconnaissance drone when hostile air appears', () => {
    const scenario = createIslandAssault();
    scenario.structures.push(
      { defId: 'airfield', owner: 1, x: 66, z: 22 },
      { defId: 'factory', owner: 1, x: 68, z: 30 },
      { defId: 'refinery', owner: 1, x: 66, z: 34 },
    );
    scenario.units.push({ defId: 'fighter', owner: 0, x: 72, z: 30 });
    const game = new Game(scenario, { enableAI: true, aiSeed: 12 });
    game.player(1)!.mats = 10000;
    game.player(1)!.req = 3000;
    game.advance(20 * 90);
    // The AI writes demand in canonical slots, so it fields whichever platform
    // its alliance brings to that slot.
    const units = game.entitiesOf(1, 'unit').map((e) => unitFamily(e.defId));
    expect(units).toContain('interceptor');
    expect(units).toContain('uav');
  });

  it('fields artillery and recovery support against a fortified contact', () => {
    const scenario = createIslandAssault();
    // This test measures support-arm employment, so the artillery branch is
    // granted the way an authored scenario grants it rather than researched.
    scenario.players[1].technologies = ['fires1'];
    scenario.structures.push(
      { defId: 'factory', owner: 1, x: 68, z: 30 },
      { defId: 'barracks', owner: 1, x: 78, z: 34 },
      { defId: 'refinery', owner: 1, x: 66, z: 34 },
      { defId: 'barracks', owner: 0, x: 74, z: 32 },
      { defId: 'mgNest', owner: 0, x: 74, z: 36 },
    );
    scenario.units.push({ defId: 'tank', owner: 1, x: 70, z: 35 });
    const game = new Game(scenario, { enableAI: true, aiSeed: 12 });
    game.player(1)!.mats = 10000;
    game.player(1)!.req = 2000;
    const tank = game.entitiesOf(1, 'unit').find((e) => unitFamily(e.defId) === 'tank')!;
    tank.hp = tank.maxHp * 0.6;
    game.advance(20 * 90);
    const units = game.entitiesOf(1, 'unit').map((e) => unitFamily(e.defId));
    expect(units).toContain('spg');
    expect(units).toContain('recovery');
  });
});
