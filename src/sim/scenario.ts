import { MAP_FORMAT, MAP_FORMAT_VERSION, PLAYER } from './constants';
import {
  ELEVATION_STEP,
  TERRAIN,
  Terrain,
  canStandOn,
  inBounds,
  isNavigable,
  moveCost,
  tileIndex,
  type TerrainId,
} from './terrain';
import type { MoveClass } from './types';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { FACTIONS } from '../data/factions';

export interface ScenarioTile {
  t: number;
  e: number;
  /** Remaining material in this tile (0 = none). */
  o: number;
}

export interface ScenarioPlayer {
  id: number;
  name: string;
  factionId: string;
  team: number;
  isAI: boolean;
  /** Player start tile (used for deployment validation and editor markers). */
  startX: number;
  startZ: number;
}

export interface ScenarioStructure {
  defId: string;
  owner: number;
  /** Top-left tile of the footprint. */
  x: number;
  z: number;
}

export interface ScenarioUnit {
  defId: string;
  owner: number;
  /** Centre tile. */
  x: number;
  z: number;
}

export type VictoryType = 'destroyHQ' | 'annihilation';

export interface ScenarioSettings {
  seed: number;
  startingMats: number;
  startingReq: number;
  fog: boolean;
  victory: VictoryType;
  timeLimitSec: number | null;
  weather: 'clear' | 'overcast' | 'rain';
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night';
}

export interface Scenario {
  format: typeof MAP_FORMAT;
  version: number;
  meta: {
    id: string;
    name: string;
    description: string;
    author: string;
    created: string;
    targetSize: 'small' | 'medium' | 'large';
  };
  width: number;
  height: number;
  tiles: ScenarioTile[];
  players: ScenarioPlayer[];
  structures: ScenarioStructure[];
  units: ScenarioUnit[];
  objectives: string[];
  settings: ScenarioSettings;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  /** Tile coordinate the issue refers to, when applicable. */
  x?: number;
  z?: number;
  entityRef?: string;
}

export class ScenarioFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioFormatError';
  }
}

export function defaultSettings(): ScenarioSettings {
  return {
    seed: 1337,
    startingMats: 2600,
    startingReq: 120,
    fog: true,
    victory: 'destroyHQ',
    timeLimitSec: null,
    weather: 'clear',
    timeOfDay: 'dusk',
  };
}

export function createScenario(width: number, height: number, name = 'Untitled scenario'): Scenario {
  const tiles: ScenarioTile[] = new Array(width * height);
  for (let i = 0; i < tiles.length; i++) tiles[i] = { t: Terrain.Grass, e: 1, o: 0 };
  return {
    format: MAP_FORMAT,
    version: MAP_FORMAT_VERSION,
    meta: {
      id: `scenario-${Date.now().toString(36)}`,
      name,
      description: '',
      author: 'Scenario Editor',
      created: new Date().toISOString().slice(0, 10),
      targetSize: width >= 128 ? 'large' : width >= 80 ? 'medium' : 'small',
    },
    width,
    height,
    tiles,
    players: [],
    structures: [],
    units: [],
    objectives: ['Destroy the enemy Command Post.'],
    settings: defaultSettings(),
  };
}

/* ------------------------------------------------------------------ */
/* Parsing & serialisation                                             */
/* ------------------------------------------------------------------ */

function fail(path: string, expected: string): never {
  throw new ScenarioFormatError(`Invalid scenario at ${path}: expected ${expected}`);
}

function asNumber(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `number in [${min}, ${max}]`);
  }
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'string');
  return value;
}

function asBool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'boolean');
  return value;
}

/** Accept an object (from JSON or localStorage) and return a typed, checked scenario. */
export function parseScenario(raw: unknown): Scenario {
  if (!raw || typeof raw !== 'object') fail('scenario', 'object');
  const r = raw as Record<string, unknown>;
  if (r.format !== MAP_FORMAT) fail('format', MAP_FORMAT);
  if (r.version !== MAP_FORMAT_VERSION) {
    throw new ScenarioFormatError(
      `Unsupported scenario version ${String(r.version)}. This build supports version ${MAP_FORMAT_VERSION}.`,
    );
  }
  const width = asNumber(r.width, 'width', 16, 256);
  const height = asNumber(r.height, 'height', 16, 256);
  const tilesRaw = r.tiles;
  if (!Array.isArray(tilesRaw) || tilesRaw.length !== width * height) {
    fail('tiles', `${width * height} tile entries`);
  }
  const tiles: ScenarioTile[] = tilesRaw.map((v, i) => {
    if (!v || typeof v !== 'object') fail(`tiles[${i}]`, 'object');
    const t = v as Record<string, unknown>;
    const terrain = asNumber(t.t, `tiles[${i}].t`, 0, 7);
    const e = asNumber(t.e, `tiles[${i}].e`, 0, 4);
    const o = asNumber(t.o ?? 0, `tiles[${i}].o`, 0, 65535);
    return { t: terrain, e, o };
  });
  const metaRaw = (r.meta ?? {}) as Record<string, unknown>;
  const settingsRaw = (r.settings ?? {}) as Record<string, unknown>;
  const playersRaw = Array.isArray(r.players) ? r.players : fail('players', 'array');
  const players: ScenarioPlayer[] = playersRaw.map((p, i) => {
    const pr = p as Record<string, unknown>;
    const factionId = asString(pr.factionId, `players[${i}].factionId`);
    if (!FACTIONS[factionId]) fail(`players[${i}].factionId`, 'known faction');
    return {
      id: asNumber(pr.id, `players[${i}].id`, 0, 7),
      name: asString(pr.name, `players[${i}].name`),
      factionId,
      team: asNumber(pr.team, `players[${i}].team`, 0, 7),
      isAI: asBool(pr.isAI ?? false, `players[${i}].isAI`),
      startX: asNumber(pr.startX, `players[${i}].startX`, 0, width - 1),
      startZ: asNumber(pr.startZ, `players[${i}].startZ`, 0, height - 1),
    };
  });
  const structures: ScenarioStructure[] = (Array.isArray(r.structures) ? r.structures : []).map(
    (s, i) => {
      const sr = s as Record<string, unknown>;
      const defId = asString(sr.defId, `structures[${i}].defId`);
      if (!BUILDINGS[defId]) fail(`structures[${i}].defId`, 'known building');
      return {
        defId,
        owner: asNumber(sr.owner, `structures[${i}].owner`, -1, 7),
        x: asNumber(sr.x, `structures[${i}].x`, 0, width - 1),
        z: asNumber(sr.z, `structures[${i}].z`, 0, height - 1),
      };
    },
  );
  const units: ScenarioUnit[] = (Array.isArray(r.units) ? r.units : []).map((u, i) => {
    const ur = u as Record<string, unknown>;
    const defId = asString(ur.defId, `units[${i}].defId`);
    if (!UNITS[defId]) fail(`units[${i}].defId`, 'known unit');
    return {
      defId,
      owner: asNumber(ur.owner, `units[${i}].owner`, -1, 7),
      x: asNumber(ur.x, `units[${i}].x`, 0, width - 1),
      z: asNumber(ur.z, `units[${i}].z`, 0, height - 1),
    };
  });
  const fog = asBool(settingsRaw.fog ?? true, 'settings.fog');
  const victory = settingsRaw.victory ?? 'destroyHQ';
  if (victory !== 'destroyHQ' && victory !== 'annihilation') fail('settings.victory', 'known victory type');
  const weather = settingsRaw.weather ?? 'clear';
  if (!['clear', 'overcast', 'rain'].includes(weather as string)) fail('settings.weather', 'known weather');
  const timeOfDay = settingsRaw.timeOfDay ?? 'dusk';
  if (!['dawn', 'day', 'dusk', 'night'].includes(timeOfDay as string)) fail('settings.timeOfDay', 'known time');
  const settings: ScenarioSettings = {
    seed: asNumber(settingsRaw.seed ?? 1337, 'settings.seed', 0, 0xffffffff),
    startingMats: asNumber(settingsRaw.startingMats ?? 2600, 'settings.startingMats', 0, 1000000),
    startingReq: asNumber(settingsRaw.startingReq ?? 120, 'settings.startingReq', 0, 1000000),
    fog,
    victory,
    timeLimitSec:
      settingsRaw.timeLimitSec == null
        ? null
        : asNumber(settingsRaw.timeLimitSec, 'settings.timeLimitSec', 10, 7200),
    weather: weather as ScenarioSettings['weather'],
    timeOfDay: timeOfDay as ScenarioSettings['timeOfDay'],
  };
  return {
    format: MAP_FORMAT,
    version: MAP_FORMAT_VERSION,
    meta: {
      id: asString(metaRaw.id ?? 'scenario', 'meta.id'),
      name: asString(metaRaw.name ?? 'Untitled', 'meta.name'),
      description: asString(metaRaw.description ?? '', 'meta.description'),
      author: asString(metaRaw.author ?? '', 'meta.author'),
      created: asString(metaRaw.created ?? '', 'meta.created'),
      targetSize: (metaRaw.targetSize as Scenario['meta']['targetSize']) ?? 'medium',
    },
    width,
    height,
    tiles,
    players,
    structures,
    units,
    objectives: Array.isArray(r.objectives)
      ? r.objectives.filter((o): o is string => typeof o === 'string')
      : [],
    settings,
  };
}

export function scenarioToJson(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2);
}

export function cloneScenario(s: Scenario): Scenario {
  return parseScenario(JSON.parse(JSON.stringify(s)));
}

/* ------------------------------------------------------------------ */
/* Reachability                                                        */
/* ------------------------------------------------------------------ */

const NEIGHBOURS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function reachableFrom(
  scenario: Scenario,
  starts: Array<{ x: number; z: number }>,
  moveClass: MoveClass,
  blocked?: Uint8Array,
): Uint8Array {
  const { width, height, tiles } = scenario;
  const terrain = new Uint8Array(tiles.length);
  const elevation = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    terrain[i] = tiles[i].t;
    elevation[i] = tiles[i].e;
  }
  const seen = new Uint8Array(tiles.length);
  const queue: number[] = [];
  for (const start of starts) {
    if (!inBounds(width, height, start.x, start.z)) continue;
    const i = tileIndex(width, start.x, start.z);
    if (blocked?.[i]) continue;
    if (!canStandOn(width, height, terrain, i, moveClass)) continue;
    if (!seen[i]) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % width;
    const cz = (cur / width) | 0;
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!inBounds(width, height, nx, nz)) continue;
      const ni = tileIndex(width, nx, nz);
      if (seen[ni] || blocked?.[ni]) continue;
      if (Math.abs(elevation[ni] - elevation[cur]) > ELEVATION_STEP[moveClass]) continue;
      const cost = moveCost(width, height, terrain, elevation, nx, nz, cx, cz, moveClass);
      if (!Number.isFinite(cost)) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return seen;
}

export function structureTiles(s: ScenarioStructure): Array<{ x: number; z: number }> {
  const def = BUILDINGS[s.defId];
  const out: Array<{ x: number; z: number }> = [];
  if (!def) return out;
  for (let dz = 0; dz < def.footprint.h; dz++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      out.push({ x: s.x + dx, z: s.z + dz });
    }
  }
  return out;
}

/** Adjacent water tiles (8-neighbourhood) around a building footprint. */
export function adjacentWater(
  scenario: Scenario,
  s: ScenarioStructure,
): Array<{ x: number; z: number }> {
  const def = BUILDINGS[s.defId];
  if (!def) return [];
  const water: Array<{ x: number; z: number }> = [];
  for (let z = s.z - 1; z <= s.z + def.footprint.h; z++) {
    for (let x = s.x - 1; x <= s.x + def.footprint.w; x++) {
      if (x >= s.x && x < s.x + def.footprint.w && z >= s.z && z < s.z + def.footprint.h) continue;
      if (!inBounds(scenario.width, scenario.height, x, z)) continue;
      const tile = scenario.tiles[tileIndex(scenario.width, x, z)];
      if (isNavigable(tile.t)) water.push({ x, z });
    }
  }
  return water;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export function validateScenario(scenario: Scenario): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (
    severity: ValidationIssue['severity'],
    code: string,
    message: string,
    x?: number,
    z?: number,
    entityRef?: string,
  ) => issues.push({ severity, code, message, x, z, entityRef });

  if (scenario.width < 16 || scenario.height < 16) {
    add('error', 'size-too-small', 'Map must be at least 16×16 tiles.');
  }
  if (scenario.players.length < 2) {
    add('error', 'players-missing', 'Add at least two players so the battle has an opponent.');
  }
  const teams = new Set(scenario.players.map((p) => p.team));
  if (scenario.players.length >= 2 && teams.size < 2) {
    add('error', 'teams-conflict', 'Both players are on the same team; no valid opponent exists.');
  }

  // Player starts
  for (const p of scenario.players) {
    if (!inBounds(scenario.width, scenario.height, p.startX, p.startZ)) {
      add('error', 'start-out-of-bounds', `${p.name}'s start is outside the map.`, p.startX, p.startZ);
      continue;
    }
    const i = tileIndex(scenario.width, p.startX, p.startZ);
    const tile = scenario.tiles[i];
    if (TERRAIN[tile.t as TerrainId].water) {
      add('error', 'start-on-water', `${p.name}'s start is on water.`, p.startX, p.startZ);
    }
    if (tile.t === Terrain.Rock || tile.t === Terrain.Forest) {
      add(
        'warning',
        'start-obstructed',
        `${p.name}'s start is on ${TERRAIN[tile.t as TerrainId].name.toLowerCase()} — deployment may be cramped.`,
        p.startX,
        p.startZ,
      );
    }
    const hq = scenario.structures.some((s) => s.owner === p.id && BUILDINGS[s.defId]?.commandPost);
    if (!hq) {
      add(
        'error',
        'hq-missing',
        `${p.name} has no Command Post. The destroy-HQ victory condition would end instantly.`,
      );
    }
    if (!scenario.units.some((u) => u.owner === p.id)) {
      add('warning', 'force-empty', `${p.name} has no starting units.`, p.startX, p.startZ);
    }
  }

  // Structures: footprint validity, overlap, water requirements
  const occupied = new Int32Array(scenario.width * scenario.height).fill(-1);
  scenario.structures.forEach((s, si) => {
    const def = BUILDINGS[s.defId];
    if (!def) {
      add('error', 'unknown-building', `Unknown building "${s.defId}".`, s.x, s.z, `structures[${si}]`);
      return;
    }
    if (!inBounds(scenario.width, scenario.height, s.x, s.z)) {
      add('error', 'building-out-of-bounds', `${def.name} starts outside the map.`, s.x, s.z);
      return;
    }
    const tiles = structureTiles(s);
    let roadTiles = 0;
    for (const t of tiles) {
      if (!inBounds(scenario.width, scenario.height, t.x, t.z)) {
        add('error', 'building-overflow', `${def.name} extends beyond the map edge.`, s.x, s.z);
        continue;
      }
      const idx = tileIndex(scenario.width, t.x, t.z);
      const tile = scenario.tiles[idx];
      if (occupied[idx] >= 0) {
        add(
          'error',
          'building-overlap',
          `${def.name} overlaps another structure.`,
          t.x,
          t.z,
          `structures[${si}]`,
        );
      }
      occupied[idx] = si;
      if (tile.t === Terrain.Road) roadTiles++;
      if (TERRAIN[tile.t as TerrainId].water) {
        add('error', 'building-water', `${def.name} is placed on water.`, t.x, t.z);
      } else if (!TERRAIN[tile.t as TerrainId].buildable) {
        add(
          'error',
          'building-terrain',
          `${def.name} is on ${TERRAIN[tile.t as TerrainId].name.toLowerCase()}, which cannot be built on.`,
          t.x,
          t.z,
        );
      }
      if (tile.o > 0) {
        add(
          'warning',
          'building-on-ore',
          `${def.name} is covering a material deposit; that income will be unavailable.`,
          t.x,
          t.z,
        );
      }
    }
    if (def.garrison && roadTiles > 0) {
      add(
        'warning',
        'garrison-blocks-road',
        `${def.name} covers a road tile; check that the route remains passable and its garrison can be approached.`,
        s.x,
        s.z,
        `structures[${si}]`,
      );
    }
    if (def.requiresWater) {
      const water = adjacentWater(scenario, s);
      if (water.length === 0) {
        add(
          'error',
          'shipyard-water',
          `${def.name} has no adjacent navigable water. Place it against a deep-water coast.`,
          s.x,
          s.z,
          `structures[${si}]`,
        );
      } else {
        const reach = reachableFrom(scenario, water, 'naval');
        let navigableCount = 0;
        for (const v of reach) if (v) navigableCount++;
        if (navigableCount < 12) {
          add(
            'warning',
            'shipyard-isolated',
            `${def.name}'s adjacent water connects to only ${navigableCount} navigable tiles.`,
            s.x,
            s.z,
          );
        }
      }
    }
    const owner = scenario.players.find((p) => p.id === s.owner);
    if (!owner && s.owner !== -1) {
      add('warning', 'building-owner', `${def.name} is owned by unknown player ${s.owner}.`, s.x, s.z);
    }
  });

  // Strategic objective and garrison access. Reaching the approach tile is
  // what matters: a depot in a walled pocket is still capturable on paper but
  // useless in play.
  const structureBlocked = new Uint8Array(occupied.length);
  for (let i = 0; i < occupied.length; i++) structureBlocked[i] = occupied[i] >= 0 ? 1 : 0;
  const groundStarts = scenario.players.map((p) => ({ x: p.startX, z: p.startZ }));
  const trackedReach = reachableFrom(scenario, groundStarts, 'tracked', structureBlocked);
  const footReach = reachableFrom(scenario, groundStarts, 'foot', structureBlocked);
  const hasApproach = (s: { defId: string; x: number; z: number }, reach: Uint8Array): boolean => {
    const def = BUILDINGS[s.defId];
    if (!def) return false;
    for (let z = s.z - 1; z <= s.z + def.footprint.h; z++) {
      for (let x = s.x - 1; x <= s.x + def.footprint.w; x++) {
        const inside =
          x >= s.x && x < s.x + def.footprint.w && z >= s.z && z < s.z + def.footprint.h;
        if (inside) continue;
        if (!inBounds(scenario.width, scenario.height, x, z)) continue;
        if (reach[tileIndex(scenario.width, x, z)]) return true;
      }
    }
    return false;
  };
  scenario.structures.forEach((s, si) => {
    const def = BUILDINGS[s.defId];
    if (!def) return;
    if (def.capturable && !hasApproach(s, trackedReach)) {
      add(
        'warning',
        'objective-unreachable',
        `${def.name} has no tracked approach from any player start; Combat Engineers cannot capture it.`,
        s.x,
        s.z,
        `structures[${si}]`,
      );
    }
    if (def.garrison && !hasApproach(s, footReach)) {
      add(
        'warning',
        'garrison-inaccessible',
        `${def.name} has no reachable infantry entrance; its garrison cannot be used.`,
        s.x,
        s.z,
        `structures[${si}]`,
      );
    }
  });

  // Units
  const unitTiles = new Map<number, number>();
  scenario.units.forEach((u, ui) => {
    const def = UNITS[u.defId];
    if (!def) {
      add('error', 'unknown-unit', `Unknown unit "${u.defId}".`, u.x, u.z);
      return;
    }
    if (!inBounds(scenario.width, scenario.height, u.x, u.z)) {
      add('error', 'unit-out-of-bounds', `${def.name} starts outside the map.`, u.x, u.z);
      return;
    }
    const idx = tileIndex(scenario.width, u.x, u.z);
    if (occupied[idx] >= 0) {
      add('error', 'unit-in-building', `${def.name} spawns inside a structure.`, u.x, u.z);
    }
    if (unitTiles.has(idx)) {
      add('warning', 'unit-overlap', `${def.name} shares a tile with another starting unit.`, u.x, u.z);
    }
    unitTiles.set(idx, ui);
    const tile = scenario.tiles[idx];
    const standable = TERRAIN[tile.t as TerrainId].costs[def.moveClass];
    if (!Number.isFinite(standable)) {
      add(
        'error',
        'unit-terrain',
        `${def.name} cannot occupy ${TERRAIN[tile.t as TerrainId].name.toLowerCase()}.`,
        u.x,
        u.z,
      );
    }
    if (!scenario.players.some((p) => p.id === u.owner) && u.owner !== -1) {
      add('warning', 'unit-owner', `${def.name} is owned by unknown player ${u.owner}.`, u.x, u.z);
    }
  });

  // Victory feasibility
  for (const p of scenario.players) {
    const hq = scenario.structures.filter(
      (s) => s.owner === p.id && BUILDINGS[s.defId]?.commandPost,
    );
    if (hq.length > 1) {
      add('warning', 'hq-multiple', `${p.name} has ${hq.length} Command Posts.`);
    }
    if (p.isAI && hq.length === 0) {
      add('error', 'ai-hq-missing', `${p.name} (AI) needs a Command Post to be a valid opponent.`);
    }
  }
  if (scenario.settings.victory === 'destroyHQ') {
    const teamsWithHq = new Set(
      scenario.structures
        .filter((s) => {
          const def = BUILDINGS[s.defId];
          const player = scenario.players.find((p) => p.id === s.owner);
          return def?.commandPost && player;
        })
        .map((s) => scenario.players.find((p) => p.id === s.owner)!.team),
    );
    for (const team of teams) {
      if (!teamsWithHq.has(team)) {
        add('error', 'victory-impossible', `Team ${team} cannot win: no destructible Command Post.`);
      }
    }
  }
  if (scenario.settings.timeLimitSec !== null && scenario.settings.timeLimitSec < 60) {
    add('warning', 'time-limit-short', 'Time limit under 60 seconds is likely unwinnable.');
  }

  // Geography
  if (groundStarts.length >= 2) {
    const first = groundStarts[0];
    const reach = reachableFrom(scenario, [first], 'tracked');
    const others = groundStarts.slice(1);
    const allGroundConnected = others.every((s) => reach[tileIndex(scenario.width, s.x, s.z)]);
    if (!allGroundConnected) {
      const shipYards = scenario.structures.filter((s) => BUILDINGS[s.defId]?.requiresWater);
      let anyNaval = false;
      for (const sy of shipYards) {
        const water = adjacentWater(scenario, sy);
        const navalReach = reachableFrom(scenario, water, 'naval');
        for (let i = 0; i < navalReach.length; i++) if (navalReach[i]) anyNaval = true;
        if (anyNaval) break;
      }
      add(
        'warning',
        'starts-not-connected',
        anyNaval
          ? 'Player starts are not connected by land. Naval and air routes are required to engage.'
          : 'Player starts are not connected by land or usable water. Only aircraft could cross.',
      );
    }
  }

  // Ore reachability (from any refinery or player start, tracked/foot)
  const oreTiles: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < scenario.height; z++) {
    for (let x = 0; x < scenario.width; x++) {
      if (scenario.tiles[tileIndex(scenario.width, x, z)].o > 0) oreTiles.push({ x, z });
    }
  }
  if (oreTiles.length === 0) {
    add('warning', 'no-ore', 'There are no material deposits. The economy cannot grow.');
  } else {
    const refineryStarts = scenario.structures
      .filter((s) => BUILDINGS[s.defId]?.refinery || BUILDINGS[s.defId]?.commandPost)
      .map((s) => ({ x: s.x, z: s.z }));
    if (refineryStarts.length === 0) {
      add('warning', 'no-refinery', 'No refinery or Command Post: harvesters have nowhere to deliver.');
    } else {
      const reach = reachableFrom(scenario, refineryStarts, 'tracked');
      const reachableOre = oreTiles.filter((o) => reach[tileIndex(scenario.width, o.x, o.z)]).length;
      if (reachableOre === 0) {
        add('error', 'ore-unreachable', 'No material deposit is reachable from any refinery by ground.');
      } else if (reachableOre < oreTiles.length * 0.5) {
        add(
          'warning',
          'ore-partial',
          `Only ${reachableOre} of ${oreTiles.length} ore tiles are reachable by harvesters from refineries.`,
        );
      }
    }
  }

  // Strategic objectives
  const relays = scenario.structures.filter((s) => s.defId === 'relay');
  if (relays.length === 0) {
    add('info', 'no-relay', 'No signals relay: requisition will come only from command posts.');
  }
  const objectives = scenario.structures.filter((s) => BUILDINGS[s.defId]?.capturable);
  for (const objective of objectives) {
    if (objective.owner !== -1) {
      add(
        'warning',
        'objective-owned',
        `${BUILDINGS[objective.defId]?.name ?? 'Objective'} starts owned; objective sites usually begin neutral.`,
        objective.x,
        objective.z,
      );
    }
  }
  const depots = objectives.filter((s) => BUILDINGS[s.defId]?.matsPerSec);
  const radarStations = objectives.filter((s) => BUILDINGS[s.defId]?.scanRadius);
  if (depots.length > 0) {
    add(
      'info',
      'supply-depots',
      `${depots.length} forward supply depot${depots.length === 1 ? ' provides' : 's provide'} secondary materials when captured.`,
    );
  }
  if (radarStations.length > 0) {
    add(
      'info',
      'radar-stations',
      `${radarStations.length} radar station${radarStations.length === 1 ? ' provides' : 's provide'} reconnaissance when captured and powered.`,
    );
  }

  return issues;
}

export function issuesBySeverity(issues: ValidationIssue[]): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
} {
  return {
    errors: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity === 'warning'),
    info: issues.filter((i) => i.severity === 'info'),
  };
}

/** Whether a scenario is safe to launch. */
export function canLaunch(scenario: Scenario): boolean {
  return !validateScenario(scenario).some((i) => i.severity === 'error');
}

/* ------------------------------------------------------------------ */
/* Placement checks (shared by editor previews and battle)             */
/* ------------------------------------------------------------------ */

export interface PlacementCheck {
  ok: boolean;
  code: string;
  reason: string;
}

/**
 * Terrain / overlap rules for buildings. Ownership, cost and build-radius
 * rules are simulation concerns and are layered on top by Game.
 */
export function checkPlacement(
  scenario: Scenario,
  defId: string,
  tileX: number,
  tileZ: number,
  occupied?: Uint8Array,
): PlacementCheck {
  const def = BUILDINGS[defId];
  if (!def) return { ok: false, code: 'unknown', reason: 'Unknown structure type.' };
  let minElevation = 99;
  let maxElevation = 0;
  let waterCount = 0;
  for (let dz = 0; dz < def.footprint.h; dz++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const x = tileX + dx;
      const z = tileZ + dz;
      if (!inBounds(scenario.width, scenario.height, x, z)) {
        return { ok: false, code: 'bounds', reason: 'The footprint extends outside the map.' };
      }
      const i = tileIndex(scenario.width, x, z);
      if (occupied?.[i]) {
        return { ok: false, code: 'occupied', reason: 'A unit or structure already occupies this ground.' };
      }
      const tile = scenario.tiles[i];
      if (TERRAIN[tile.t as TerrainId].water) {
        waterCount++;
        if (!def.waterStructure) {
          return {
            ok: false,
            code: 'water',
            reason: 'This structure cannot be built on water. Move it inland or onto a suitable coast.',
          };
        }
      } else if (!TERRAIN[tile.t as TerrainId].buildable) {
        return {
          ok: false,
          code: 'terrain',
          reason: `${TERRAIN[tile.t as TerrainId].name} cannot support this structure.`,
        };
      }
      if (tile.o > 0) {
        return { ok: false, code: 'ore', reason: 'Clear the material deposit before building here.' };
      }
      minElevation = Math.min(minElevation, tile.e);
      maxElevation = Math.max(maxElevation, tile.e);
    }
  }
  if (minElevation !== maxElevation) {
    return { ok: false, code: 'slope', reason: 'The foundation must be level; flatten this terrain first.' };
  }
  if (waterCount > 0 && !def.waterStructure) {
    return { ok: false, code: 'water', reason: 'The footprint overlaps water.' };
  }
  if (def.requiresWater) {
    const fake: ScenarioStructure = { defId, owner: 0, x: tileX, z: tileZ };
    if (adjacentWater(scenario, fake).length === 0) {
      return {
        ok: false,
        code: 'water-access',
        reason: 'Shipyards need navigable water directly alongside the footprint.',
      };
    }
  }
  return { ok: true, code: 'ok', reason: 'Placement valid.' };
}

/** Human-readable victory text for the HUD. */
export function victoryDescription(scenario: Scenario, playerId = PLAYER): string {
  if (scenario.settings.victory === 'annihilation') {
    return 'Destroy every enemy unit and structure.';
  }
  const enemy = scenario.players.find((p) => p.id !== playerId && p.team !== scenario.players[playerId]?.team);
  return enemy
    ? `Destroy the ${FACTIONS[enemy.factionId]?.shortName ?? 'enemy'} Command Post.`
    : 'Destroy the enemy Command Post.';
}
