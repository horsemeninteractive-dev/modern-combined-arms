import {
  MAP_FORMAT,
  MAP_FORMAT_VERSION,
  TILE_SIZE,
} from '../sim/constants';
import { Terrain, inBounds, tileIndex, type TerrainId } from '../sim/terrain';
import { reachableFrom, type Scenario, type ScenarioTile } from '../sim/scenario';
import { defaultSettings } from '../sim/scenario';

const W = 96;
const H = 72;

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * "Kestrel Bay" — a representative island battlefield.
 *
 * West: Baltic beachhead, refinery, airfield and port.
 * Centre: a ridge with one road pass and a forested northern flank, a village
 * and a contested signals relay.
 * East: the expeditionary corps base on a low plateau.
 * South: open sea and a deep bay that reaches the enemy's coastal flank.
 */
export function createIslandAssault(): Scenario {
  const rand = mulberry(0x1d0e);
  const tiles: ScenarioTile[] = new Array(W * H);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const plateau = x >= 62 && z <= 40;
      tiles[tileIndex(W, x, z)] = {
        t: Terrain.Grass,
        e: plateau ? 2 : 1,
        o: 0,
      };
    }
  }
  const set = (x: number, z: number, t: number, e?: number, o?: number) => {
    if (!inBounds(W, H, x, z)) return;
    const tile = tiles[tileIndex(W, x, z)];
    tile.t = t;
    if (e !== undefined) tile.e = e;
    if (o !== undefined) tile.o = o;
  };
  const get = (x: number, z: number): ScenarioTile => tiles[tileIndex(W, x, z)];

  // Landmass with an irregular outline. Everything else becomes sea.
  const isLand = (x: number, z: number): boolean => {
    if (x < 12 || x > 88 || z < 6 || z > 52) return false;
    // North coast headlands.
    if (z < 8 && (x < 22 || x > 64)) return false;
    // Southwest cove near the player port.
    if (x < 15 && z > 46) return false;
    // The deep bay cutting into the enemy's coastal flank.
    if (x >= 60 && x <= 72 && z >= 43) return false;
    // A small eastern cove.
    if (x > 84 && z > 44) return false;
    return true;
  };
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (!isLand(x, z)) set(x, z, Terrain.DeepWater, 0);
    }
  }

  // Shallow margins + beaches.
  const landNeighbour = (x: number, z: number): boolean => {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (!inBounds(W, H, nx, nz)) continue;
        const t = get(nx, nz).t as TerrainId;
        if (t !== Terrain.DeepWater && t !== Terrain.ShallowWater) return true;
      }
    }
    return false;
  };
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const tile = get(x, z);
      if (tile.t === Terrain.DeepWater && landNeighbour(x, z)) {
        tile.t = Terrain.ShallowWater;
      }
    }
  }
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const tile = get(x, z);
      if ((tile.t === Terrain.Grass || tile.t === Terrain.Rock) && landNeighbour(x, z)) {
        tile.t = Terrain.Sand;
      }
    }
  }

  // The central ridge: an unbroken wall except for the road pass and a long
  // forested northern flank.
  for (let z = 17; z <= 47; z++) {
    for (let x = 48; x <= 58; x++) {
      const edge = x === 48 || x === 58;
      const core = x === 52 || x === 53 || x === 54;
      if (z >= 33 && z <= 38) continue; // pass
      if (z < 21 && !core) continue;
      if (edge && rand() < 0.28) continue;
      set(x, z, Terrain.Rock, core ? 3 : 2);
    }
  }
  // The pass itself: a mountain road.
  for (let z = 33; z <= 38; z++) {
    for (let x = 47; x <= 59; x++) {
      set(x, z, Terrain.Road, 2);
    }
  }

  // Northern forest belt (the long flanking route).
  for (let z = 8; z <= 20; z++) {
    for (let x = 27; x <= 59; x++) {
      const lake = x >= 40 && x <= 45 && z >= 13 && z <= 16;
      if (lake) {
        set(x, z, Terrain.ShallowWater, 0);
        continue;
      }
      const edge = z === 20 || x === 59;
      if (edge && rand() < 0.35) continue;
      if (get(x, z).t === Terrain.Grass) set(x, z, Terrain.Forest, get(x, z).e);
    }
  }
  // Forest screens on the southern approach and east of the village.
  for (let z = 39; z <= 48; z++) {
    for (let x = 31; x <= 43; x++) {
      if (rand() < 0.68) set(x, z, Terrain.Forest, 1);
    }
  }
  for (let z = 22; z <= 27; z++) {
    for (let x = 64; x <= 71; x++) {
      if (rand() < 0.55) set(x, z, Terrain.Forest, 2);
    }
  }

  // Village at the eastern mouth of the pass.
  for (let z = 29; z <= 36; z++) {
    for (let x = 42; x <= 48; x++) {
      if (get(x, z).t === Terrain.Road) continue;
      if (rand() < 0.8) set(x, z, Terrain.Urban, 1);
    }
  }

  // Roads.
  const road = (x0: number, z0: number, x1: number, z1: number) => {
    let x = x0;
    let z = z0;
    while (x !== x1 || z !== z1) {
      if (get(x, z).t !== Terrain.DeepWater && get(x, z).t !== Terrain.ShallowWater) {
        set(x, z, Terrain.Road, get(x, z).e);
      }
      if (x !== x1) x += Math.sign(x1 - x);
      if (z !== z1) z += Math.sign(z1 - z);
      if (get(x, z).t !== Terrain.DeepWater && get(x, z).t !== Terrain.ShallowWater) {
        set(x, z, Terrain.Road, get(x, z).e);
      }
    }
  };
  road(27, 36, 47, 36);
  road(47, 36, 71, 32);
  road(71, 32, 77, 29);
  road(19, 38, 15, 38);
  road(53, 36, 53, 33);
  road(53, 33, 66, 26);
  road(66, 26, 77, 24);
  road(77, 30, 84, 37);
  road(76, 34, 71, 40);
  road(66, 26, 60, 18);
  road(30, 34, 36, 24);

  // Ore fields. Keep them clear of roads, urban tiles and buildings.
  const oreField = (cx: number, cz: number, rx: number, rz: number, amount: number) => {
    for (let dz = -rz; dz <= rz; dz++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if (dx * dx + dz * dz > rx * rx + rz * rz + 1) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (!inBounds(W, H, x, z)) continue;
        const tile = get(x, z);
        const terrain = tile.t as TerrainId;
        if (terrain === Terrain.Road || terrain === Terrain.Urban || terrain === Terrain.Forest) continue;
        if (terrain === Terrain.DeepWater || terrain === Terrain.ShallowWater || terrain === Terrain.Rock) continue;
        tile.o = amount;
      }
    }
  };
  oreField(33, 34, 3, 2, 300);
  oreField(14, 29, 2, 2, 260);
  oreField(39, 23, 2, 2, 340);
  oreField(55, 44, 2, 1, 280);
  oreField(68, 20, 2, 2, 320);
  oreField(82, 18, 2, 2, 320);

  // A few visual rock outcrops away from routes.
  const outcrop = (cx: number, cz: number, r: number) => {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (!inBounds(W, H, x, z)) continue;
        const tile = get(x, z);
        if (tile.t === Terrain.Sand || tile.t === Terrain.Grass || tile.t === Terrain.Forest) {
          if (rand() > 0.35) set(x, z, Terrain.Rock, tile.e + 1);
        }
      }
    }
  };
  outcrop(45, 44, 2);
  outcrop(28, 20, 1);
  outcrop(63, 12, 2);

  const scenario: Scenario = {
    format: MAP_FORMAT,
    version: MAP_FORMAT_VERSION,
    meta: {
      id: 'island-assault',
      name: 'Island Assault — Kestrel Bay',
      description:
        'A Baltic task force holds a narrow western beachhead on Kestrel Island. The 11th Expeditionary Corps controls the eastern plateau and the deep-water bay. Break the ridge line, contest the relays and destroy the enemy command post.',
      author: 'MCA scenario team',
      created: '2026-10-23',
      targetSize: 'medium',
    },
    width: W,
    height: H,
    tiles,
    players: [
      {
        id: 0,
        name: 'Baltic Task Force',
        factionId: 'baltic',
        team: 0,
        isAI: false,
        startX: 18,
        startZ: 37,
      },
      {
        id: 1,
        name: '11th Expeditionary Corps',
        factionId: 'expeditionary',
        team: 1,
        isAI: true,
        startX: 76,
        startZ: 29,
      },
    ],
    structures: [
      // Both battlegroups land with a command post and nothing else.
      { defId: 'commandPost', owner: 0, x: 16, z: 32 },
      { defId: 'commandPost', owner: 1, x: 74, z: 24 },
      // Neutral objectives. The depot sits in the village at the eastern
      // mouth of the pass, where both battlegroups can contest it without
      // blocking the road itself.
      { defId: 'relay', owner: -1, x: 44, z: 30 },
      { defId: 'relay', owner: -1, x: 69, z: 41 },
      { defId: 'supplyDepot', owner: -1, x: 44, z: 32 },
      // Neutral urban cover on the two approaches to the central objectives.
      // A tenement faces the western village road; a ruin covers the eastern
      // exit from the pass.
      { defId: 'tenement', owner: -1, x: 39, z: 29 },
      { defId: 'ruin', owner: -1, x: 62, z: 33 },
    ],
    units: [
      // Player landing force: engineer, two MBTs and five riflemen.
      { defId: 'engineer', owner: 0, x: 22, z: 37 },
      { defId: 'tank', owner: 0, x: 25, z: 38 },
      { defId: 'tank', owner: 0, x: 26, z: 34 },
      { defId: 'rifle', owner: 0, x: 17, z: 36 },
      { defId: 'rifle', owner: 0, x: 18, z: 38 },
      { defId: 'rifle', owner: 0, x: 19, z: 40 },
      { defId: 'rifle', owner: 0, x: 21, z: 35 },
      { defId: 'rifle', owner: 0, x: 24, z: 41 },
      // Enemy landing force, matching composition.
      { defId: 'engineer', owner: 1, x: 77, z: 28 },
      { defId: 'tank', owner: 1, x: 78, z: 34 },
      { defId: 'tank', owner: 1, x: 80, z: 34 },
      { defId: 'rifle', owner: 1, x: 73, z: 28 },
      { defId: 'rifle', owner: 1, x: 73, z: 29 },
      { defId: 'rifle', owner: 1, x: 72, z: 31 },
      { defId: 'rifle', owner: 1, x: 75, z: 32 },
      { defId: 'rifle', owner: 1, x: 72, z: 33 },
    ],
    objectives: [
      'Destroy the 11th Expeditionary Corps Command Post.',
      'Capture the signals relays to sustain advanced production.',
      'Seize the forward supply depot in the village for supplementary materials.',
      'Keep your own Command Post operational.',
    ],
    settings: {
      ...defaultSettings(),
      seed: 773311,
      startingMats: 3000,
      startingReq: 180,
      fog: true,
      victory: 'destroyHQ',
      weather: 'clear',
      timeOfDay: 'day',
    },
  };

  // Sanity: starting naval units must be on water, ground units on land.
  return scenario;
}

export const BUILTIN_SCENARIOS = [
  {
    id: 'island-assault',
    name: 'Island Assault — Kestrel Bay',
    description: 'The vertical-slice island battle: beachhead, ridge, bay and enemy base.',
    create: createIslandAssault,
  },
];

export function createEmptyScenario(width = 64, height = 48): Scenario {
  const tiles: ScenarioTile[] = new Array(width * height);
  for (let i = 0; i < tiles.length; i++) tiles[i] = { t: Terrain.Grass, e: 1, o: 0 };
  return {
    format: MAP_FORMAT,
    version: MAP_FORMAT_VERSION,
    meta: {
      id: `custom-${Date.now().toString(36)}`,
      name: 'New scenario',
      description: '',
      author: 'Scenario Editor',
      created: new Date().toISOString().slice(0, 10),
      targetSize: width >= 128 ? 'large' : width >= 80 ? 'medium' : 'small',
    },
    width,
    height,
    tiles,
    players: [
      {
        id: 0,
        name: 'Blue Force',
        factionId: 'baltic',
        team: 0,
        isAI: false,
        startX: Math.floor(width * 0.25),
        startZ: Math.floor(height * 0.5),
      },
      {
        id: 1,
        name: 'Red Force',
        factionId: 'expeditionary',
        team: 1,
        isAI: true,
        startX: Math.floor(width * 0.75),
        startZ: Math.floor(height * 0.5),
      },
    ],
    structures: [],
    units: [],
    objectives: ['Destroy the enemy Command Post.'],
    settings: defaultSettings(),
  };
}

/** Tile-centre world position for a tile coordinate. */
export function tileWorld(x: number, z: number): { x: number; z: number } {
  return { x: (x + 0.5) * TILE_SIZE, z: (z + 0.5) * TILE_SIZE };
}

/** Quick reachability summary used by the menu screen. */
export function scenarioOverview(scenario: Scenario): {
  landTiles: number;
  waterTiles: number;
  oreTiles: number;
  groundReachFromStart: number;
} {
  let land = 0;
  let water = 0;
  let ore = 0;
  for (const t of scenario.tiles) {
    if (t.t === Terrain.DeepWater || t.t === Terrain.ShallowWater) water++;
    else land++;
    if (t.o > 0) ore++;
  }
  const start = scenario.players[0];
  const reach = reachableFrom(scenario, [{ x: start.startX, z: start.startZ }], 'tracked');
  let count = 0;
  for (const v of reach) if (v) count++;
  return { landTiles: land, waterTiles: water, oreTiles: ore, groundReachFromStart: count };
}
