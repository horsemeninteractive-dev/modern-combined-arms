/**
 * Phase 6C.1 — infrastructure modules measured in practice.
 *
 * Phase 6C verified that these modules resolve to the right numbers. This file
 * asks the harder question: does the resolved number change what the player can
 * see, detect or build?
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario, createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';
import { BUILDING_MODULES } from '../src/data/research';
import { TERRAIN } from '../src/sim/terrain';
import type { TerrainId } from '../src/sim/terrain';
import { buildStructure, fund, siteFor } from './economyBench';

describe('Radar Relay Net', () => {
  it('extends what the array actually sees under fog', () => {
    const maxSight = (modules: string[]): number => {
      let best = 0;
      for (let d = 8; d <= 24; d++) {
        const scenario = createEmptyScenario(64, 64);
        scenario.settings.fog = true;
        scenario.units = [{ defId: 'rifle', owner: 1, x: 28 + d, z: 30 }];
        scenario.structures = [
          { defId: 'radar', owner: 0, x: 28, z: 30 },
          { defId: 'powerPlant', owner: 0, x: 22, z: 34 },
        ];
        const game = new Game(scenario, { enableAI: false });
        const radar = game.entitiesOf(0, 'building').find((e) => e.defId === 'radar')!;
        radar.modules = modules;
        game.refreshVision(true);
        const enemy = game.entitiesOf(1, 'unit')[0];
        if (game.isVisibleTo(0, enemy.id)) best = d;
      }
      return best;
    };
    const base = maxSight([]);
    const upgraded = maxSight(['fireControlNet']);
    console.log('[mod]', JSON.stringify({
      kind: 'radar-relay',
      base,
      upgraded,
      gained: upgraded - base,
      authoredVision: BUILDINGS.radar.vision,
      moduleVision: 4,
      cost: BUILDING_MODULES.fireControlNet.cost,
    }));
    expect(base).toBeGreaterThan(0);
    expect(upgraded).toBeGreaterThan(base);
    expect(upgraded - base).toBe(4);
  });
});

describe('Advanced Turbine', () => {
  it('trades material efficiency for footprint and time', () => {
    // A builder is required: an empty scenario has no engineer, and a site with
    // nobody on it never finishes.
    const oneScenario = createEmptyScenario(64, 64);
    oneScenario.units = [{ defId: 'engineer', owner: 0, x: 40, z: 40 }];
    oneScenario.structures = [
      { defId: 'commandPost', owner: 0, x: 6, z: 6 },
      { defId: 'commandPost', owner: 1, x: 56, z: 56 },
    ];
    const one = new Game(oneScenario, { enableAI: false });
    fund(one, 0, 20000, 4000);
    const first = buildStructure(one, 0, 'powerPlant', { site: siteFor(one, 0, 'powerPlant') });
    first.structure.modules = ['advancedTurbine'];
    const onePower = one.powerStatus(0);

    const twoScenario = createEmptyScenario(64, 64);
    twoScenario.units = [{ defId: 'engineer', owner: 0, x: 40, z: 40 }];
    twoScenario.structures = [
      { defId: 'commandPost', owner: 0, x: 6, z: 6 },
      { defId: 'commandPost', owner: 1, x: 56, z: 56 },
    ];
    const two = new Game(twoScenario, { enableAI: false });
    fund(two, 0, 20000, 4000);
    const avoided: Array<{ x: number; z: number }> = [];
    let twoSeconds = 0;
    for (let i = 0; i < 2; i++) {
      const site = siteFor(two, 0, 'powerPlant', avoided);
      avoided.push(site);
      const built = buildStructure(two, 0, 'powerPlant', { site });
      twoSeconds += built.seconds;
    }
    const twoPower = two.powerStatus(0);
    const plant = BUILDINGS.powerPlant;
    const turbine = BUILDING_MODULES.advancedTurbine;
    const report = {
      kind: 'turbine-vs-plant',
      module: {
        power: onePower.supply,
        mats: plant.cost.mats + turbine.cost.mats,
        req: turbine.cost.req,
        seconds: first.seconds,
        footprintTiles: plant.footprint.w * plant.footprint.h,
      },
      secondPlant: {
        power: twoPower.supply,
        mats: plant.cost.mats * 2,
        req: 0,
        seconds: Math.round(twoSeconds * 10) / 10,
        footprintTiles: plant.footprint.w * plant.footprint.h,
      },
    };
    console.log('[mod]', JSON.stringify(report));
    expect(onePower.supply).toBe(50 + plant.power! + 30);
    expect(twoPower.supply).toBe(50 + plant.power! * 2);
    // The module is more expensive per point of power; it is not cheaper.
    expect(report.module.mats / 30).toBeGreaterThan((plant.cost.mats * 2) / (plant.power! * 2));
  });
});

describe('Flightline Maintenance', () => {
  /** Send a depleted fighter home and time the servicing run to full stores. */
  function sortie(modules: string[]): { seconds: number; serviced: boolean } {
    const scenario = createEmptyScenario(64, 64);
    scenario.settings.fog = false;
    scenario.units = [{ defId: 'fighter', owner: 0, x: 40, z: 40 }];
    scenario.structures = [
      { defId: 'commandPost', owner: 0, x: 6, z: 6 },
      { defId: 'commandPost', owner: 1, x: 56, z: 56 },
      { defId: 'airfield', owner: 0, x: 40, z: 40 },
      { defId: 'powerPlant', owner: 0, x: 34, z: 44 },
    ];
    const game = new Game(scenario, { enableAI: false });
    const field = game.entitiesOf(0, 'building').find((e) => e.defId === 'airfield')!;
    field.modules = modules;
    const jet = game.entitiesOf(0, 'unit').find((e) => e.defId === 'fighter')!;
    jet.ammo = 0;
    jet.hp = Math.max(1, jet.maxHp * 0.5);
    game.enqueueCommand({ type: 'return', team: 0, ids: [jet.id] });
    let seconds = 0;
    while (jet.ammo < jet.maxAmmo && seconds < 150) {
      game.advance(20);
      seconds += 1;
    }
    return { seconds, serviced: jet.ammo >= jet.maxAmmo };
  }

  it('shortens a real servicing run, not just the multiplier', () => {
    const base = sortie([]);
    const upgraded = sortie(['flightlineMaintenance']);
    console.log('[mod]', JSON.stringify({
      kind: 'flightline',
      base,
      upgraded,
      cost: BUILDING_MODULES.flightlineMaintenance.cost,
      authoredMultiplier: 1.3,
    }));
    expect(base.serviced).toBe(true);
    expect(upgraded.serviced).toBe(true);
    // 1.3x servicing must actually return the airframe sooner.
    expect(upgraded.seconds).toBeLessThan(base.seconds);
  });
});

describe('Harbour Sonar Suite', () => {
  /** Water and land on the island map, for a shipyard and a dived boat. */
  function coast(): { land: { x: number; z: number }; sea: { x: number; z: number }; scenario: ReturnType<typeof createIslandAssault> } {
    const scenario = createIslandAssault();
    const width = scenario.width;
    const water = (x: number, z: number): boolean => {
      const tile = scenario.tiles[z * width + x];
      return !!tile && TERRAIN[tile.t as TerrainId]?.water === true;
    };
    for (let z = 8; z < scenario.height - 8; z++) {
      for (let x = 8; x < width - 8; x++) {
        if (water(x, z)) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (!water(x + dx, z + dz)) continue;
          for (let d = 4; d <= 10; d++) {
            const sx = x + dx * d;
            const sz = z + dz * d;
            if (water(sx, sz)) return { land: { x, z }, sea: { x: sx, z: sz }, scenario };
          }
        }
      }
    }
    throw new Error('no coast');
  }

  function detects(modules: string[]): boolean {
    const spot = coast();
    const scenario = spot.scenario;
    scenario.units = [];
    scenario.structures = [
      { defId: 'shipyard', owner: 0, x: spot.land.x, z: spot.land.z },
      { defId: 'powerPlant', owner: 0, x: spot.land.x - 2, z: spot.land.z + 2 },
    ];
    scenario.settings.fog = true;
    scenario.units.push({ defId: 'ghadir', owner: 1, x: spot.sea.x, z: spot.sea.z });
    const game = new Game(scenario, { enableAI: false });
    const yard = game.entitiesOf(0, 'building').find((e) => e.defId === 'shipyard')!;
    yard.modules = modules;
    const boat = game.entitiesOf(1, 'unit')[0];
    boat.submarine!.dived = true;
    game.refreshVision(true);
    return game.isVisibleTo(0, boat.id);
  }

  it('finds a dived boat the harbour cannot otherwise see', () => {
    const without = detects([]);
    const withModule = detects(['harbourSonar']);
    console.log('[mod]', JSON.stringify({
      kind: 'harbour-sonar',
      without,
      withModule,
      cost: BUILDING_MODULES.harbourSonar.cost,
      radius: 12,
    }));
    expect(withModule).toBe(true);
    // The suite has to be the difference; a harbour that already sees the boat
    // would make this test meaningless.
    expect(without).toBe(false);
  });
});
