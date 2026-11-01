import { phaseSettings, createScenario, type Scenario } from '../sim/scenario';
import { TILE_SIZE } from '../sim/constants';
import { Terrain, inBounds, tileIndex } from '../sim/terrain';
import { identityAlliance } from './factions';

/**
 * A hand-authored training lane, not a skirmish map.
 *
 * The layout is deliberately sparse: one friendly base, one isolated aggressor
 * engineer, a marked construction pad and a road that leads the player from the
 * refinery to the assembly point. Every teaching beat happens inside the opening
 * frame, so the tutorial never has to hide a step behind a cross-map march.
 */
export const TUTORIAL_SCENARIO_ID = 'training-grounds';

/** Top-left tile of the 3x3 barracks pad painted into the scenario. */
export const TUTORIAL_BUILD_SITE = { x: 18, z: 15 };

/** Tile the squad is asked to reach before the live-fire beat. */
export const TUTORIAL_ASSEMBLY_TILE = { x: 22, z: 16 };

/**
 * Tile occupied by the isolated aggressor engineer. The target sits beyond the
 * rifle's auto-acquire tolerance from the assembly point, so the squad does not
 * silently finish the attack lesson before the player gives the order.
 */
export const TUTORIAL_TARGET_TILE = { x: 32, z: 16 };

/** World-space positions derived once, shared by the overlay and the director. */
export const TUTORIAL_BUILD_POINT = {
  x: (TUTORIAL_BUILD_SITE.x + 1.5) * TILE_SIZE,
  z: (TUTORIAL_BUILD_SITE.z + 1.5) * TILE_SIZE,
};
export const TUTORIAL_ASSEMBLY_POINT = {
  x: (TUTORIAL_ASSEMBLY_TILE.x + 0.5) * TILE_SIZE,
  z: (TUTORIAL_ASSEMBLY_TILE.z + 0.5) * TILE_SIZE,
};

/** Brief used by the loading screen before the battle exists. */
export const TUTORIAL_BRIEF = {
  id: TUTORIAL_SCENARIO_ID,
  name: 'Training Grounds',
  description:
    'A quiet coastal training lane. An instructor walks a new commander through selection, construction, production, movement and a first live-fire engagement.',
  focus: 'Guided training',
  domains: 'Ground',
  width: 44,
  height: 30,
} as const;

export function createTutorialScenario(): Scenario {
  const W = 44;
  const H = 30;
  const scenario = createScenario(W, H, TUTORIAL_BRIEF.name);
  scenario.meta.id = TUTORIAL_SCENARIO_ID;
  scenario.meta.description = TUTORIAL_BRIEF.description;
  scenario.meta.author = 'Training Cadre';
  scenario.meta.targetSize = 'small';

  const set = (x: number, z: number, terrain: number, ore = 0) => {
    if (!inBounds(W, H, x, z)) return;
    const tile = scenario.tiles[tileIndex(W, x, z)];
    tile.t = terrain;
    tile.e = 1;
    tile.o = ore;
  };

  // A belt of forest frames the lane and keeps the eye on the marked ground.
  for (let x = 0; x < W; x++) {
    set(x, 0, Terrain.Forest);
    set(x, 1, Terrain.Forest);
  }
  for (let z = 0; z < H; z++) {
    set(0, z, Terrain.Forest);
    set(1, z, Terrain.Forest);
    set(W - 2, z, Terrain.Forest);
    set(W - 1, z, Terrain.Forest);
  }
  for (let z = 7; z <= 10; z++) {
    for (let x = 7; x <= 11; x++) set(x, z, Terrain.Forest);
  }
  for (let z = 4; z <= 6; z++) {
    for (let x = 24; x <= 27; x++) set(x, z, Terrain.Forest);
  }
  for (let z = 20; z <= 23; z++) {
    for (let x = 32; x <= 35; x++) set(x, z, Terrain.Forest);
  }

  // The service road runs the length of the lane; the construction pad is a
  // paved apron beside the base and reads as deliberate ground, not a spawn.
  for (let x = 4; x <= 40; x++) {
    set(x, 20, Terrain.Road);
    set(x, 21, Terrain.Road);
  }
  for (let z = TUTORIAL_BUILD_SITE.z; z < TUTORIAL_BUILD_SITE.z + 3; z++) {
    for (let x = TUTORIAL_BUILD_SITE.x; x < TUTORIAL_BUILD_SITE.x + 3; x++) {
      set(x, z, Terrain.Road);
    }
  }
  for (let z = 18; z <= 19; z++) {
    set(19, z, Terrain.Road);
    set(20, z, Terrain.Road);
  }

  // A small deposit gives the validator and the economy a real anchor without
  // asking the trainee to manage harvesters during the lesson.
  for (let z = 9; z <= 10; z++) {
    for (let x = 22; x <= 23; x++) set(x, z, Terrain.Grass, 400);
  }

  scenario.players = [
    {
      id: 0,
      name: 'Baltic Training Cadre',
      factionId: 'lithuania',
      team: 0,
      isAI: false,
      startX: 6,
      startZ: 18,
      color: identityAlliance('lithuania').color,
    },
    {
      id: 1,
      name: 'Aggressor Detachment',
      factionId: 'russia',
      team: 1,
      isAI: false,
      startX: 39,
      startZ: 9,
      color: identityAlliance('russia').color,
    },
  ];

  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 4, z: 13 },
    { defId: 'refinery', owner: 0, x: 10, z: 13 },
    { defId: 'powerPlant', owner: 0, x: 15, z: 12 },
    { defId: 'commandPost', owner: 1, x: 38, z: 4 },
  ];

  scenario.units = [
    { defId: 'engineer', owner: 0, x: 11, z: 18 },
    { defId: 'rifle', owner: 0, x: 14, z: 20 },
    { defId: 'rifle', owner: 0, x: 16, z: 18 },
    { defId: 'engineer', owner: 1, x: TUTORIAL_TARGET_TILE.x, z: TUTORIAL_TARGET_TILE.z },
  ];

  scenario.objectives = [
    'Complete the training lanes.',
    'Build a Field Barracks and train a rifleman.',
    'Move your squad to the assembly point and destroy the aggressor.',
  ];
  scenario.settings = {
    ...phaseSettings('day'),
    seed: 0x7a1e,
    startingMats: 1800,
    startingReq: 80,
    fog: false,
    victory: 'destroyHQ',
    timeLimitSec: null,
    weather: 'clear',
    timeOfDay: 'day',
  };
  return scenario;
}
