import { describe, expect, it } from 'vitest';
import {
  checkPlacement,
  createScenario,
  parseScenario,
  scenarioToJson,
  structureTiles,
  waterFacingFor,
} from '../src/sim/scenario';
import { Terrain, isNavigable, tileIndex } from '../src/sim/terrain';
import { TILE_SIZE } from '../src/sim/constants';
import { rotateLocalOffset } from '../src/core/math';
import { createIslandAssault } from '../src/data/scenarios';
import { Game } from '../src/sim/game';
import type { Entity } from '../src/sim/types';

function fillWater(x0: number, z0: number, x1: number, z1: number) {
  const s = createScenario(16, 16, 'Facing fixture');
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      s.tiles[tileIndex(s.width, x, z)].t = Terrain.DeepWater;
    }
  }
  return s;
}

/** Direction the slipway (local +Z) points once the yard is turned by `facing`. */
function gateDirection(facing: number): { x: number; z: number } {
  return rotateLocalOffset(0, 1, facing);
}

describe('shipyard slipway orientation', () => {
  it('turns the gate toward the side with open water', () => {
    const yard = { defId: 'shipyard', owner: 0, x: 4, z: 4 };
    // Water to the east.
    const east = fillWater(9, 0, 15, 15);
    const facingEast = waterFacingFor(east, yard);
    let dir = gateDirection(facingEast);
    expect(dir.x).toBeGreaterThan(0.99);
    expect(Math.abs(dir.z)).toBeLessThan(0.01);

    // Water to the south (+Z).
    const south = fillWater(0, 9, 15, 15);
    dir = gateDirection(waterFacingFor(south, yard));
    expect(dir.z).toBeGreaterThan(0.99);
    expect(Math.abs(dir.x)).toBeLessThan(0.01);

    // Water to the north (-Z).
    const north = fillWater(0, 0, 15, 3);
    dir = gateDirection(waterFacingFor(north, yard));
    expect(dir.z).toBeLessThan(-0.99);
    expect(Math.abs(dir.x)).toBeLessThan(0.01);

    // Water to the west.
    const west = fillWater(0, 0, 3, 15);
    dir = gateDirection(waterFacingFor(west, yard));
    expect(dir.x).toBeLessThan(-0.99);
    expect(Math.abs(dir.z)).toBeLessThan(0.01);
  });

  it('prefers the face with the most water and breaks ties southward', () => {
    const yard = { defId: 'shipyard', owner: 0, x: 4, z: 4 };
    // Five water tiles along the full east face beat two on the south face.
    const s = fillWater(9, 4, 9, 8);
    for (let x = 4; x <= 5; x++) s.tiles[tileIndex(s.width, x, 9)].t = Terrain.DeepWater;
    expect(gateDirection(waterFacingFor(s, yard)).x).toBeGreaterThan(0.99);

    // Filling the south face makes it a tie, and ties resolve southward.
    for (let x = 4; x <= 8; x++) s.tiles[tileIndex(s.width, x, 9)].t = Terrain.DeepWater;
    expect(waterFacingFor(s, yard)).toBe(0);
  });

  it('aims the gate at diagonal water when no face touches it', () => {
    // Footprint 4..8 covers the 5x5 yard; (9, 9) touches only its corner.
    const s = fillWater(9, 9, 9, 9);
    const facing = waterFacingFor(s, { defId: 'shipyard', owner: 0, x: 4, z: 4 });
    const dir = gateDirection(facing);
    // The gate points at the corner water rather than inland.
    expect(dir.z * 1 + dir.x * 1).toBeGreaterThan(0.9);
  });

  it('leaves land-locked structures facing their default side', () => {
    const s = fillWater(0, 0, 0, 0);
    // Reclaim the single water tile: nothing is adjacent to water now.
    s.tiles[tileIndex(s.width, 0, 0)].t = Terrain.Grass;
    expect(waterFacingFor(s, { defId: 'shipyard', owner: 0, x: 4, z: 4 })).toBe(0);
  });
});

describe('shipyard in battle', () => {
  it('spawns facing its harbour with a berth on the gate side', () => {
    const scenario = createIslandAssault();
    const occupied = new Uint8Array(scenario.width * scenario.height);
    for (const s of scenario.structures) {
      for (const t of structureTiles(s)) occupied[tileIndex(scenario.width, t.x, t.z)] = 1;
    }
    let spot: { x: number; z: number } | null = null;
    for (let z = 1; z < scenario.height - 6 && !spot; z++) {
      for (let x = 1; x < scenario.width - 6 && !spot; x++) {
        if (checkPlacement(scenario, 'shipyard', x, z, occupied).ok) spot = { x, z };
      }
    }
    expect(spot).not.toBeNull();
    const structure = { defId: 'shipyard', owner: 0, x: spot!.x, z: spot!.z };
    scenario.structures.push(structure);
    const game = new Game(scenario, { enableAI: false });
    game.tick();
    const yard = game.entitiesOf(0, 'building').find((e) => e.defId === 'shipyard') as Entity;
    expect(yard).toBeDefined();
    expect(yard.facing).toBeCloseTo(waterFacingFor(scenario, structure), 6);

    // The berth lies along the gate direction and is navigable water.
    const dir = gateDirection(yard.facing);
    const toBerth = { x: yard.rallyX - yard.x, z: yard.rallyZ - yard.z };
    expect(dir.x * toBerth.x + dir.z * toBerth.z).toBeGreaterThan(0);
    const rx = Math.floor(yard.rallyX / TILE_SIZE);
    const rz = Math.floor(yard.rallyZ / TILE_SIZE);
    expect(isNavigable(scenario.tiles[tileIndex(scenario.width, rx, rz)].t)).toBe(true);
  });

  it('turns the yard as the player places it during a battle', () => {
    const scenario = createIslandAssault();
    scenario.units.push({ defId: 'engineer', owner: 0, x: 18, z: 37 });
    // The shipyard is a factory-tier structure now; this test is about its
    // facing, so the vehicle factory is authored rather than built.
    scenario.structures.push({ defId: 'factory', owner: 0, x: 24, z: 32 });
    const game = new Game(scenario, { enableAI: false });
    let spot: { x: number; z: number } | null = null;
    for (let z = 1; z < scenario.height - 6 && !spot; z++) {
      for (let x = 1; x < scenario.width - 6 && !spot; x++) {
        const status = game.placementStatus(0, 'shipyard', x, z);
        if (status.ok) spot = { x, z };
      }
    }
    expect(spot).not.toBeNull();
    game.enqueueCommand({ type: 'placeBuilding', team: 0, defId: 'shipyard', tileX: spot!.x, tileZ: spot!.z });
    game.tick();
    const yard = game.entitiesOf(0, 'building').find((e) => e.defId === 'shipyard') as Entity;
    expect(yard).toBeDefined();
    expect(yard.construction).toBe(true);
    expect(yard.facing).toBeCloseTo(
      waterFacingFor(scenario, { defId: 'shipyard', owner: 0, x: spot!.x, z: spot!.z }),
      6,
    );
    const dir = gateDirection(yard.facing);
    const toBerth = { x: yard.rallyX - yard.x, z: yard.rallyZ - yard.z };
    expect(dir.x * toBerth.x + dir.z * toBerth.z).toBeGreaterThan(0);
    const rx = Math.floor(yard.rallyX / TILE_SIZE);
    const rz = Math.floor(yard.rallyZ / TILE_SIZE);
    expect(isNavigable(scenario.tiles[tileIndex(scenario.width, rx, rz)].t)).toBe(true);
  });

  it('keeps an authored facing through a scenario round trip', () => {
    const scenario = createScenario(16, 16, 'Authored');
    scenario.structures.push({ defId: 'shipyard', owner: 0, x: 2, z: 2, facing: -Math.PI / 2 });
    const round = parseScenario(JSON.parse(scenarioToJson(scenario)));
    expect(round.structures[0].facing).toBeCloseTo(-Math.PI / 2, 6);
  });
});
