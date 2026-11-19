/**
 * The Outbreak battlefield.
 *
 * One purpose-built theatre, authored around a central defence rather than two
 * mirrored starts: the Command Post sits on the exact centre tile of a 96×96
 * basin, four roads run in from the edges, and the ground between them is broken
 * by forest, rock and height so each approach asks a different question.
 *
 * Resource and objective placement is deliberately outside the opening apron.
 * A player can hold the centre with the starting force, but cannot grow the base
 * without walking an engineer and a hauler out to the ring — which is the point
 * at which the next wave is already on its way.
 */
import { MAP_FORMAT, MAP_FORMAT_VERSION } from '../sim/constants';
import {
  clearOreUnderStructures,
  phaseSettings,
  type Scenario,
  type ScenarioPlayer,
  type ScenarioStructure,
  type ScenarioTile,
  type ScenarioUnit,
} from '../sim/scenario';
import { Terrain, inBounds, tileIndex, type TerrainId } from '../sim/terrain';
import type { OutbreakDifficulty } from '../sim/scenario';
import { BUILDINGS } from '../data/buildings';
import { NATIONS } from '../data/factions';
import { INFECTED_FACTION_ID } from '../data/zombies';
import { outbreakDifficulty } from './config';
import type { OutbreakEntryRegion, OutbreakMode } from './types';

export const OUTBREAK_MAP_ID = 'outbreak-relay-basin';
export const OUTBREAK_MAP_SIZE = 96;
/** Tiles from the map edge to the centre line. */
const CENTRE = OUTBREAK_MAP_SIZE / 2;

export interface OutbreakSetup {
  difficulty: OutbreakDifficulty;
  mode: OutbreakMode;
  /** The defending nation. Every playable nation is eligible. */
  nationId: string;
  seed?: number;
  startWave?: number;
}

/** Where the horde walks in. Two per road end on the basin's four approaches. */
export const OUTBREAK_ENTRY_REGIONS: readonly OutbreakEntryRegion[] = Object.freeze([
  { id: 'north-road', name: 'North road', x: CENTRE, z: 5, radius: 5 },
  { id: 'east-road', name: 'East road', x: OUTBREAK_MAP_SIZE - 5, z: CENTRE, radius: 5 },
  { id: 'south-road', name: 'South road', x: CENTRE, z: OUTBREAK_MAP_SIZE - 5, radius: 5 },
  { id: 'west-road', name: 'West road', x: 5, z: CENTRE, radius: 5 },
  { id: 'north-east-gap', name: 'North-east gap', x: 78, z: 18, radius: 4 },
  { id: 'south-west-gap', name: 'South-west gap', x: 18, z: 78, radius: 4 },
]);

interface Draft {
  tiles: ScenarioTile[];
  structures: ScenarioStructure[];
  units: ScenarioUnit[];
}

function blank(size: number): Draft {
  const tiles: ScenarioTile[] = new Array(size * size);
  for (let i = 0; i < tiles.length; i++) tiles[i] = { t: Terrain.Grass, e: 1, o: 0 };
  return { tiles, structures: [], units: [] };
}

class Painter {
  constructor(readonly draft: Draft, readonly size: number) {}

  set(x: number, z: number, terrain: TerrainId, elevation?: number, ore?: number): void {
    if (!inBounds(this.size, this.size, x, z)) return;
    const tile = this.draft.tiles[tileIndex(this.size, x, z)];
    tile.t = terrain;
    if (elevation !== undefined) tile.e = elevation;
    if (ore !== undefined) tile.o = ore;
  }

  rect(x0: number, z0: number, x1: number, z1: number, terrain: TerrainId, elevation?: number): void {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) this.set(x, z, terrain, elevation);
    }
  }

  /** A road band, only replacing ground that is not rock or water. */
  road(x0: number, z0: number, x1: number, z1: number): void {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!inBounds(this.size, this.size, x, z)) continue;
        const tile = this.draft.tiles[tileIndex(this.size, x, z)];
        if (tile.t === Terrain.DeepWater || tile.t === Terrain.ShallowWater) continue;
        tile.t = Terrain.Road;
      }
    }
  }

  ore(cx: number, cz: number, radius: number, amount: number): void {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (!inBounds(this.size, this.size, x, z)) continue;
        const tile = this.draft.tiles[tileIndex(this.size, x, z)];
        if (tile.t !== Terrain.Grass) continue;
        tile.o = amount;
      }
    }
  }

  border(): void {
    for (let x = 0; x < this.size; x++) {
      for (const z of [0, 1, this.size - 2, this.size - 1]) this.set(x, z, Terrain.Rock, 3);
    }
    for (let z = 0; z < this.size; z++) {
      for (const x of [0, 1, this.size - 2, this.size - 1]) this.set(x, z, Terrain.Rock, 3);
    }
  }

  structure(defId: string, owner: number, x: number, z: number): void {
    // Every structure stands on its own hardstanding: a depot dropped on a
    // ridge or in a stand of trees would be an authored error, so the map
    // grades a pad under each footprint before placing it.
    const footprint = BUILDINGS[defId]?.footprint ?? { w: 1, h: 1 };
    for (let dz = 0; dz < footprint.h; dz++) {
      for (let dx = 0; dx < footprint.w; dx++) {
        this.set(x + dx, z + dz, Terrain.Industrial, 1, 0);
      }
    }
    this.draft.structures.push({ defId, owner, x, z });
  }

  unit(defId: string, owner: number, x: number, z: number): void {
    this.draft.units.push({ defId, owner, x, z });
  }
}

/**
 * Tile the defensive basin.
 *
 * The centre is left open: a 4×4 Command Post placed at tile 46,46 has its
 * footprint centred on tile centre 48.0 — the exact middle of the map — and the
 * apron around it has room for the first ring of emplacements. Four roads meet
 * the apron; the diagonals carry rock and forest, which is what makes the roads
 * the fast way in and the diagonals the slow, covered way.
 */
function paintBasin(p: Painter): void {
  p.border();
  const size = p.size;

  // The apron: open, fast ground the base grows into.
  p.rect(34, 34, 61, 61, Terrain.Grass, 1);
  // A concrete hardstanding under the command area, so the base reads as a base.
  p.rect(42, 42, 53, 53, Terrain.Industrial, 1);

  // Four approaches, seven tiles wide, straight from the map edge.
  p.road(CENTRE - 3, 2, CENTRE + 3, 36);
  p.road(CENTRE - 3, size - 37, CENTRE + 3, size - 3);
  p.road(2, CENTRE - 3, 36, CENTRE + 3);
  p.road(size - 37, CENTRE - 3, size - 3, CENTRE + 3);

  // Rock shoulders on the roads: the lane is wide enough for a horde and narrow
  // enough that a pair of turrets can cover it.
  for (const z of [22, 30, 66, 74]) {
    p.rect(CENTRE - 8, z, CENTRE - 5, z + 2, Terrain.Rock, 2);
    p.rect(CENTRE + 5, z, CENTRE + 8, z + 2, Terrain.Rock, 2);
  }
  for (const x of [22, 30, 66, 74]) {
    p.rect(x, CENTRE - 8, x + 2, CENTRE - 5, Terrain.Rock, 2);
    p.rect(x, CENTRE + 5, x + 2, CENTRE + 8, Terrain.Rock, 2);
  }

  // Diagonal belts: the slow, covered routes into the base.
  p.rect(12, 12, 26, 20, Terrain.Forest, 1);
  p.rect(16, 20, 22, 30, Terrain.Forest, 1);
  p.rect(70, 12, 84, 20, Terrain.Forest, 2);
  p.rect(74, 20, 80, 30, Terrain.Forest, 2);
  p.rect(12, 76, 26, 84, Terrain.Forest, 1);
  p.rect(16, 66, 22, 76, Terrain.Forest, 1);
  p.rect(70, 76, 84, 84, Terrain.Forest, 2);
  p.rect(74, 66, 80, 76, Terrain.Forest, 2);

  // High ground at the four corners of the inner ring: worth holding, awkward
  // to hold, and never on the shortest path to the Command Post.
  p.rect(30, 30, 33, 33, Terrain.Rocks, 3);
  p.rect(62, 30, 65, 33, Terrain.Rocks, 3);
  p.rect(30, 62, 33, 65, Terrain.Rocks, 3);
  p.rect(62, 62, 65, 65, Terrain.Rocks, 3);

  // Scrub and broken ground inside the apron: cover for infantry, no obstacle
  // for a horde, and a reason not to fight everything in the open.
  p.rect(38, 38, 41, 40, Terrain.Scrub, 1);
  p.rect(54, 38, 57, 40, Terrain.Scrub, 1);
  p.rect(38, 55, 41, 57, Terrain.Scrub, 1);
  p.rect(54, 55, 57, 57, Terrain.Scrub, 1);

  // Deposits outside the opening perimeter, on the four quarter-lines.
  p.ore(20, CENTRE, 3, 320);
  p.ore(size - 21, CENTRE, 3, 320);
  p.ore(CENTRE, 20, 3, 320);
  p.ore(CENTRE, size - 21, 3, 320);
  // A second, richer seam beside each road further out. It sits off the lane
  // itself, so a hauler can work it without parking the convoy in the traffic
  // the horde uses: two hauls per approach instead of one.
  p.ore(12, CENTRE + 6, 2, 300);
  p.ore(size - 13, CENTRE + 6, 2, 300);
  p.ore(CENTRE + 6, 12, 2, 300);
  p.ore(CENTRE + 6, size - 13, 2, 300);
  p.ore(26, 26, 2, 260);
  p.ore(size - 27, 26, 2, 260);
  p.ore(26, size - 27, 2, 260);
  p.ore(size - 27, size - 27, 2, 260);
  // The diagonal quarter-lines: out of the horde's way but a real walk from the
  // apron, which is where an expansion-minded player is already stretched.
  p.ore(29, 21, 2, 280);
  p.ore(size - 30, 21, 2, 280);
  p.ore(29, size - 22, 2, 280);
  p.ore(size - 30, size - 22, 2, 280);
  // Contested mid-ring deposits, close enough to reach in wave one and exposed
  // enough that holding one is a decision rather than a formality.
  p.ore(CENTRE, 34, 2, 240);
  p.ore(CENTRE, size - 35, 2, 240);
  p.ore(34, CENTRE + 6, 2, 240);
  p.ore(size - 35, CENTRE + 6, 2, 240);
}

/**
 * Meaningful ground to fight over: two supply depots, two relays, two bunkers
 * and ruins on the approaches. None of them is required to survive; all of them
 * are worth a squad, which is what turns "expand" into a decision.
 */
function paintObjectives(p: Painter): void {
  const neutral = -1;
  p.structure('supplyDepot', neutral, 24, 40);
  p.structure('supplyDepot', neutral, 66, 52);
  p.structure('relay', neutral, CENTRE + 2, 24);
  p.structure('relay', neutral, CENTRE - 5, 68);
  p.structure('bunker', neutral, 40, 24);
  p.structure('bunker', neutral, 52, 68);
  p.structure('warehouse', neutral, 20, 54);
  p.structure('warehouse', neutral, 72, 38);
  p.structure('ruin', neutral, 34, 30);
  p.structure('ruin', neutral, 60, 62);
  p.structure('watchtower', neutral, 30, 46);
  p.structure('watchtower', neutral, 64, 47);
}

function paintStart(p: Painter, nationId: string): void {
  // The Command Post: footprint top-left such that its centre is the map centre.
  const post = BUILDINGS.commandPost?.footprint ?? { w: 4, h: 4 };
  const postX = CENTRE - post.w / 2;
  const postZ = CENTRE - post.h / 2;
  p.structure('commandPost', 0, postX, postZ);
  // The opening force: enough to hold the apron for two waves, not enough to
  // hold the ring. One engineer, one hauler, a squad and a single tank.
  p.unit('engineer', 0, CENTRE + 4, CENTRE + 1);
  p.unit('harvester', 0, CENTRE + 5, CENTRE + 4);
  p.unit('rifle', 0, CENTRE - 4, CENTRE - 4);
  p.unit('rifle', 0, CENTRE - 2, CENTRE - 4);
  p.unit('rifle', 0, CENTRE, CENTRE - 4);
  p.unit('rifle', 0, CENTRE + 2, CENTRE - 4);
  p.unit('rifle', 0, CENTRE - 4, CENTRE + 4);
  p.unit('tank', 0, CENTRE + 1, CENTRE + 5);
  // A first defensive pair: an MG nest and a sandbag line, so the opening is
  // about learning the angles rather than surviving with nothing.
  p.structure('mgNest', 0, CENTRE - 7, CENTRE - 2);
  p.structure('mgNest', 0, CENTRE + 6, CENTRE + 1);
  void nationId;
}

function playerFor(nationId: string): ScenarioPlayer {
  const nation = NATIONS[nationId] ? NATIONS[nationId] : NATIONS[NATION_LIST_DEFAULT];
  return {
    id: 0,
    name: `${nation.name} Defence Force`,
    factionId: nation.id,
    team: 0,
    isAI: false,
    startX: CENTRE - 2,
    startZ: CENTRE - 2,
  };
}

const NATION_LIST_DEFAULT = 'lithuania';

function infectedPlayer(): ScenarioPlayer {
  return {
    id: 1,
    name: 'The Infected',
    factionId: INFECTED_FACTION_ID,
    team: 1,
    // The director commands them; they are never a scripted skirmish opponent.
    isAI: false,
    startX: 2,
    startZ: 2,
    color: '#8fae4a',
  };
}

/**
 * Build the Outbreak scenario for one run.
 *
 * Deterministic for a given setup: the terrain is authored, the seed is carried
 * on the scenario, and the wave director derives everything else from it. Two
 * peers given the same setup therefore build byte-identical ground.
 */
export function createOutbreakScenario(setup: OutbreakSetup): Scenario {
  const size = OUTBREAK_MAP_SIZE;
  const draft = blank(size);
  const p = new Painter(draft, size);
  paintBasin(p);
  paintObjectives(p);
  paintStart(p, setup.nationId);

  const config = outbreakDifficulty(setup.difficulty);
  const scenario: Scenario = {
    format: MAP_FORMAT,
    version: MAP_FORMAT_VERSION,
    meta: {
      id: OUTBREAK_MAP_ID,
      name: 'Relay Basin',
      description:
        'A fortified basin around a single Command Post. Four roads, four slow approaches and a ring of supplies outside the wire. Hold the centre for as long as the horde allows.',
      author: 'MCA scenario team',
      created: '2026-11-18',
      targetSize: 'large',
      outbreak: {
        difficulty: setup.difficulty,
        mode: setup.mode,
        entryRegions: OUTBREAK_ENTRY_REGIONS.map((region) => ({ ...region })),
        ...(setup.startWave !== undefined ? { startWave: setup.startWave } : {}),
      },
    },
    width: size,
    height: size,
    tiles: draft.tiles,
    players: [playerFor(setup.nationId), infectedPlayer()],
    structures: draft.structures,
    units: draft.units,
    objectives: [
      'Hold the Command Post at the centre of the basin.',
      'Survive as many waves as possible.',
      'Keep the supply ring outside the wire working.',
      'Losing the Command Post ends the run.',
    ],
    settings: {
      ...phaseSettings('dusk'),
      seed: (setup.seed ?? 20261118) >>> 0,
      startingMats: config.startingMats,
      startingReq: config.startingReq,
      fog: true,
      // The Command Post is the only defeat condition. There is no opposing
      // headquarters to destroy and no annihilation rule to satisfy.
      victory: 'destroyHQ',
      timeLimitSec: null,
      weather: 'clear',
      timeOfDay: 'dusk',
      // Strategic weapons stay available: they are part of the national
      // identity the mode promises to keep, and their long cooldowns make them
      // a between-wave decision rather than a wave-winner.
      superweapons: true,
    },
  };
  clearOreUnderStructures(scenario);
  return scenario;
}

/** Whether a loaded scenario is an Outbreak run. */
export function isOutbreakScenario(scenario: Scenario): boolean {
  return Boolean(scenario.meta.outbreak);
}
