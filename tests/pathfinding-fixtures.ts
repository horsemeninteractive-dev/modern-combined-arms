import type { NavGrid } from '../src/sim/pathfinding';
import { Terrain } from '../src/sim/terrain';
import type { MoveClass } from '../src/sim/types';

export interface PathFixtureCase {
  name: string;
  nav: NavGrid;
  startX: number;
  startZ: number;
  goalX: number;
  goalZ: number;
  maxNodes?: number;
}

function grid(
  width: number,
  height: number,
  moveClass: MoveClass = 'foot',
): { nav: NavGrid; fill: (terrain: number) => void } {
  const terrain = new Uint8Array(width * height).fill(Terrain.Grass);
  const elevation = new Uint8Array(width * height);
  const nav: NavGrid = {
    width,
    height,
    terrain,
    elevation,
    moveClass,
    occupied: new Uint8Array(width * height),
  };
  return { nav, fill: (value) => terrain.fill(value) };
}

function block(nav: NavGrid, x: number, z: number): void {
  if (x >= 0 && z >= 0 && x < nav.width && z < nav.height) {
    nav.occupied![z * nav.width + x] = 1;
  }
}

function paint(nav: NavGrid, x: number, z: number, terrain: number): void {
  if (x >= 0 && z >= 0 && x < nav.width && z < nav.height) {
    nav.terrain[z * nav.width + x] = terrain;
  }
}

function openCase(): PathFixtureCase {
  const { nav } = grid(12, 10);
  return { name: 'open-terrain', nav, startX: 1, startZ: 1, goalX: 10, goalZ: 8 };
}

function obstacleGapCase(): PathFixtureCase {
  const { nav } = grid(14, 11);
  for (let z = 0; z < nav.height; z++) {
    if (z !== 3 && z !== 4) block(nav, 7, z);
  }
  return { name: 'obstacle-with-gap', nav, startX: 1, startZ: 5, goalX: 12, goalZ: 5 };
}

function diagonalCornerCase(): PathFixtureCase {
  const { nav } = grid(10, 10);
  block(nav, 5, 5);
  return { name: 'diagonal-corner-block', nav, startX: 4, startZ: 4, goalX: 6, goalZ: 6 };
}

function corridorCase(): PathFixtureCase {
  const { nav } = grid(14, 11);
  for (let z = 0; z < nav.height; z++) {
    if (z < 4 || z > 6) {
      block(nav, 6, z);
      block(nav, 8, z);
    }
  }
  return { name: 'narrow-corridor', nav, startX: 2, startZ: 5, goalX: 12, goalZ: 5 };
}

function unreachableCase(): PathFixtureCase {
  const { nav } = grid(12, 10);
  for (let z = 0; z < nav.height; z++) block(nav, 6, z);
  return { name: 'unreachable-wall', nav, startX: 1, startZ: 5, goalX: 10, goalZ: 5 };
}

function equalCostCase(): PathFixtureCase {
  const { nav } = grid(12, 12);
  for (let z = 4; z <= 7; z++) {
    for (let x = 4; x <= 7; x++) block(nav, x, z);
  }
  return { name: 'equal-cost-detour', nav, startX: 1, startZ: 6, goalX: 10, goalZ: 6 };
}

function terrainProfileCases(): PathFixtureCase[] {
  const foot = grid(13, 10, 'foot');
  for (let z = 3; z <= 6; z++) {
    for (let x = 3; x <= 9; x++) paint(foot.nav, x, z, Terrain.Forest);
  }
  const tracked = grid(13, 10, 'tracked');
  for (let z = 3; z <= 6; z++) {
    for (let x = 3; x <= 9; x++) paint(tracked.nav, x, z, Terrain.Forest);
  }
  const road = grid(13, 10, 'wheeled');
  for (let x = 1; x <= 11; x++) paint(road.nav, x, 5, Terrain.Road);
  return [
    { name: 'terrain-forest-foot', nav: foot.nav, startX: 1, startZ: 5, goalX: 11, goalZ: 5 },
    { name: 'terrain-forest-tracked', nav: tracked.nav, startX: 1, startZ: 5, goalX: 11, goalZ: 5 },
    { name: 'terrain-road-wheeled', nav: road.nav, startX: 1, startZ: 5, goalX: 11, goalZ: 5 },
  ];
}

function navalCase(): PathFixtureCase {
  const { nav } = grid(14, 10, 'naval');
  for (let z = 0; z < nav.height; z++) {
    for (let x = 0; x < nav.width; x++) {
      paint(nav, x, z, x < 4 ? Terrain.Grass : x < 7 ? Terrain.ShallowWater : Terrain.DeepWater);
    }
  }
  return { name: 'naval-shallow-to-deep', nav, startX: 4, startZ: 5, goalX: 12, goalZ: 5 };
}

function dynamicTrafficCase(): PathFixtureCase {
  const { nav } = grid(14, 11);
  nav.soft = new Uint8Array(nav.width * nav.height);
  // A moving column on the direct line: passable, but expensive enough that a
  // deterministic A* should prefer the open northern lane.
  for (let x = 2; x <= 11; x++) nav.soft[5 * nav.width + x] = 2;
  for (let x = 4; x <= 8; x++) nav.soft[4 * nav.width + x] = 1;
  return { name: 'dynamic-traffic', nav, startX: 1, startZ: 5, goalX: 12, goalZ: 5 };
}

function blockedGoalCase(): PathFixtureCase {
  const { nav } = grid(10, 10);
  for (let z = 4; z <= 6; z++) {
    for (let x = 4; x <= 6; x++) block(nav, x, z);
  }
  return { name: 'blocked-goal-nearest', nav, startX: 1, startZ: 1, goalX: 5, goalZ: 5 };
}

function sameStartGoalCase(): PathFixtureCase {
  const { nav } = grid(8, 8);
  return { name: 'start-equals-goal', nav, startX: 3, startZ: 3, goalX: 3, goalZ: 3 };
}

function maxNodesCase(): PathFixtureCase {
  const { nav } = grid(20, 20);
  return { name: 'node-limit', nav, startX: 1, startZ: 1, goalX: 18, goalZ: 18, maxNodes: 1 };
}

export function pathFixtureCases(): PathFixtureCase[] {
  return [
    openCase(),
    obstacleGapCase(),
    diagonalCornerCase(),
    corridorCase(),
    unreachableCase(),
    equalCostCase(),
    ...terrainProfileCases(),
    navalCase(),
    dynamicTrafficCase(),
    blockedGoalCase(),
    sameStartGoalCase(),
    maxNodesCase(),
  ];
}
