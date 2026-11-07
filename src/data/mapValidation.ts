import type { ScenarioEntry } from './scenarioCatalog';
import { SCENARIOS } from './scenarioCatalog';
import { rotatePoint } from './competitiveMaps';
import { BUILDINGS } from './buildings';
import {
  validateScenario,
  reachableFrom,
  structureTiles,
  type Scenario,
  type ScenarioProp,
  type ScenarioStructure,
} from '../sim/scenario';
import {
  TERRAIN,
  Terrain,
  canStandOn,
  inBounds,
  moveCost,
  tileBuildable,
  tileIndex,
  type TerrainId,
} from '../sim/terrain';
import type { MoveClass } from '../sim/types';

/**
 * Reusable verification for competitive battlefields.
 *
 * This module deliberately re-derives four-way symmetry from the finished
 * scenario instead of trusting the fact that the maps were stamped from one
 * quadrant: if somebody later paints a rock in a single corner, the audit
 * fails. It also reports measurable balance diagnostics (travel distances,
 * accessible area, ore and objective distribution) without pretending those
 * numbers prove a map is balanced.
 */

export interface MapProblem {
  code: string;
  message: string;
}

export interface MapDiagnostics {
  id: string;
  width: number;
  height: number;
  slots: Array<{ x: number; z: number }>;
  /** Tile distance from each slot to the map centre. */
  startToCentre: number[];
  /** Ore tiles reachable by a tracked hull from each slot. */
  orePerSlot: number[];
  /** Neutral strategic sites reachable from each slot. */
  sitesPerSlot: number[];
  /** Passable tiles within the whole map, per movement class. */
  areaByClass: Record<'foot' | 'wheeled' | 'tracked', number>;
  /** Of those, the tiles reachable from the first slot. */
  reachByClass: Record<'foot' | 'wheeled' | 'tracked', number>;
  /** Tiles of each terrain kind that shape the fight. */
  terrain: { forest: number; rock: number; urban: number; road: number; water: number };
  /** Passable tiles touching the centre block: the direct approaches. */
  centreApproaches: { foot: number; wheeled: number; tracked: number };
  /**
   * Cheapest movement cost from each slot to the centre, per movement class.
   * Uses the simulation's own `moveCost`, so the extra a wheeled column pays
   * for forest or sand is visible as a number instead of a claim.
   */
  travelCost: Record<'foot' | 'wheeled' | 'tracked', number[]>;
}

export interface MapReport {
  /** Empty when the map passes every structural, symmetry and access check. */
  problems: MapProblem[];
  diagnostics: MapDiagnostics;
}

const CLASSES: Array<'foot' | 'wheeled' | 'tracked'> = ['foot', 'wheeled', 'tracked'];

function terrainBlocked(scenario: Scenario): Uint8Array {
  return new Uint8Array(scenario.width * scenario.height);
}

function compareTerrain(scenario: Scenario, k: 1 | 2 | 3, problems: MapProblem[]): void {
  const { width, height, tiles } = scenario;
  let reported = 0;
  for (let z = 0; z < height && reported < 4; z++) {
    for (let x = 0; x < width && reported < 4; x++) {
      const target = rotatePoint(width, k, x, z);
      const a = tiles[tileIndex(width, x, z)];
      const b = tiles[tileIndex(width, target.x, target.z)];
      // The surface layer is part of what shapes play, so it is audited with
      // the base terrain: a crop field in one quadrant and bare ground in the
      // next is an asymmetry even though every terrain id matches.
      if (a.t !== b.t || a.e !== b.e || a.o !== b.o || (a.v ?? 0) !== (b.v ?? 0)) {
        problems.push({
          code: 'asymmetric-terrain',
          message: `Tile ${x},${z} and its ${k * 90}° rotation ${target.x},${target.z} differ (t ${a.t}/${b.t}, e ${a.e}/${b.e}, o ${a.o}/${b.o}, v ${a.v ?? 0}/${b.v ?? 0}).`,
        });
        reported++;
      }
    }
  }
}

/**
 * Covered tiles, keyed by defId, so a check can rotate a footprint's *cells*
 * rather than its origin. Origin arithmetic depends on the rotation of the
 * footprint, which is exactly the thing under test.
 */
function coveredCells(
  structures: ScenarioStructure[],
  width: number,
  problems: MapProblem[],
  label: string,
): void {
  const cover = new Map<number, Set<string>>();
  for (const s of structures) {
    for (const tile of structureTiles(s)) {
      if (!inBounds(width, width, tile.x, tile.z)) continue;
      const i = tileIndex(width, tile.x, tile.z);
      const set = cover.get(i) ?? new Set<string>();
      set.add(s.defId);
      cover.set(i, set);
    }
  }
  for (const s of structures) {
    for (const k of [1, 2, 3] as const) {
      const missing = structureTiles(s).find((tile) => {
        if (!inBounds(width, width, tile.x, tile.z)) return false;
        const p = rotatePoint(width, k, tile.x, tile.z);
        return !cover.get(tileIndex(width, p.x, p.z))?.has(s.defId);
      });
      if (missing) {
        problems.push({
          code: `asymmetric-${label}`,
          message: `${s.defId} at ${s.x},${s.z} covers ${missing.x},${missing.z}, which has no ${s.defId} at its ${k * 90}° position.`,
        });
        break;
      }
    }
  }
}

function compareNeutralStructures(scenario: Scenario, problems: MapProblem[]): void {
  coveredCells(
    scenario.structures.filter((s) => s.owner === -1),
    scenario.width,
    problems,
    'objective',
  );
}

/**
 * Owned content is only invariant under a half turn, with ownership swapped:
 * a quarter turn would map seat 0's base into an empty quadrant, which is the
 * correct layout for a 1v1 on four-way ground.
 */
function compareOwnedContent(scenario: Scenario, problems: MapProblem[]): void {
  const owned = scenario.structures.filter((s) => s.owner >= 0);
  for (const seat of [0, 1]) {
    const mine = owned.filter((s) => s.owner === seat);
    const theirs = owned.filter((s) => s.owner !== seat);
    const cover = new Set<string>();
    for (const s of theirs) {
      for (const tile of structureTiles(s)) cover.add(`${tile.x},${tile.z},${s.defId}`);
    }
    for (const s of mine) {
      const missing = structureTiles(s).find((tile) => {
        const p = rotatePoint(scenario.width, 2, tile.x, tile.z);
        return !cover.has(`${p.x},${p.z},${s.defId}`);
      });
      if (missing) {
        problems.push({
          code: 'asymmetric-base',
          message: `Seat ${seat} ${s.defId} at ${s.x},${s.z} covers ${missing.x},${missing.z}, which has no opposing ${s.defId}.`,
        });
      }
    }
  }
  const units = scenario.units.filter((u) => u.owner >= 0);
  for (const u of units) {
    const p = rotatePoint(scenario.width, 2, u.x, u.z);
    const match = units.some((o) => o.defId === u.defId && o.owner !== u.owner && o.x === p.x && o.z === p.z);
    if (!match) {
      problems.push({
        code: 'asymmetric-force',
        message: `Unit ${u.defId} for seat ${u.owner} at ${u.x},${u.z} has no opposite counterpart at ${p.x},${p.z}.`,
      });
    }
  }
}

/**
 * Authored set dressing must be four-way symmetric too.
 *
 * A prop is cosmetic, but the roster's promise is that all four quadrants are
 * the same map. A bush placed in one quadrant without its rotations is either a
 * slip or a deliberate asymmetry, and both are worth reporting.
 */
function compareProps(scenario: Scenario, problems: MapProblem[]): void {
  const props: ScenarioProp[] = scenario.props ?? [];
  if (props.length === 0) return;
  const present = new Set(props.map((prop) => `${prop.kind}@${prop.x},${prop.z}`));
  for (const prop of props) {
    for (const k of [1, 2, 3] as const) {
      const p = rotatePoint(scenario.width, k, prop.x, prop.z);
      if (present.has(`${prop.kind}@${p.x},${p.z}`)) continue;
      problems.push({
        code: 'asymmetric-prop',
        message: `Prop ${prop.kind} at ${prop.x},${prop.z} has no counterpart at ${p.x},${p.z}.`,
      });
      return;
    }
  }
}

function checkSlots(entry: ScenarioEntry, scenario: Scenario, problems: MapProblem[]): void {
  const slots = scenario.slots ?? [];
  if (slots.length !== 4) {
    problems.push({ code: 'slots-missing', message: `Expected four declared starts, found ${slots.length}.` });
    return;
  }
  const expected = [0, 1, 2, 3].map((k) => rotatePoint(scenario.width, k as 0 | 1 | 2 | 3, slots[0].x, slots[0].z));
  expected.forEach((want, k) => {
    if (slots[k].x !== want.x || slots[k].z !== want.z) {
      problems.push({
        code: 'slot-not-rotated',
        message: `Slot ${k} is ${slots[k].x},${slots[k].z}; a quarter turn of slot 0 is ${want.x},${want.z}.`,
      });
    }
  });
  if (slots[0].x === slots[2].x && slots[0].z === slots[2].z) {
    problems.push({ code: 'slot-duplicate', message: 'The 1v1 pair shares a tile.' });
  }
  for (const [index, slot] of slots.entries()) {
    const tile = scenario.tiles[tileIndex(scenario.width, slot.x, slot.z)];
    if (TERRAIN[tile.t as TerrainId].water) {
      problems.push({ code: 'slot-water', message: `Slot ${index} is on water.` });
    }
    if (!tileBuildable(tile.t, tile.v ?? 0)) {
      problems.push({ code: 'slot-unbuildable', message: `Slot ${index} is on ${TERRAIN[tile.t as TerrainId].name}, not deployment ground.` });
    }
  }
  const [blue, red] = scenario.players;
  if (blue.startX !== slots[0].x || blue.startZ !== slots[0].z) {
    problems.push({ code: 'seat-slot-mismatch', message: 'Seat 0 does not deploy on slot 0.' });
  }
  if (red.startX !== slots[2].x || red.startZ !== slots[2].z) {
    problems.push({ code: 'seat-slot-mismatch', message: 'Seat 1 does not deploy on the opposite slot.' });
  }
  if (entry.start) {
    if (entry.start[0] !== slots[0].x || entry.start[1] !== slots[0].z) {
      problems.push({ code: 'catalogue-start-mismatch', message: 'Catalogue start does not match the scenario slot.' });
    }
  }
}

/** Tile distance, used only for reporting travel times. */
function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

/**
 * Cheapest route cost from a start tile to the centre block, in movement
 * points. The same eight-way neighbours and `moveCost` the pathfinder uses,
 * so a class pays for terrain and elevation exactly as it would in a match.
 * Returns `Infinity` when the centre cannot be reached at all.
 */
function cheapestRoute(
  scenario: Scenario,
  start: { x: number; z: number },
  cls: 'foot' | 'wheeled' | 'tracked',
): number {
  const { width, height, tiles } = scenario;
  const terrain = new Uint8Array(tiles.length);
  const elevation = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    terrain[i] = tiles[i].t;
    elevation[i] = tiles[i].e;
  }
  // Goals are the tiles within 1.5 tiles of the geometric centre. Measuring
  // from the centre *point* rather than from a rounded tile keeps the target
  // set invariant under a quarter turn, so all four slots are compared on the
  // same objective.
  const centre = width / 2;
  const goals = new Set<number>();
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if (Math.abs(x + 0.5 - centre) > 1.5 || Math.abs(z + 0.5 - centre) > 1.5) continue;
      const i = tileIndex(width, x, z);
      if (canStandOn(width, height, terrain, i, cls)) goals.add(i);
    }
  }
  const startIndex = tileIndex(width, start.x, start.z);
  if (!goals.size || !canStandOn(width, height, terrain, startIndex, cls)) return Infinity;

  const best = new Float64Array(tiles.length).fill(Infinity);
  const heap = new CostHeap();
  best[startIndex] = 0;
  heap.push(startIndex, 0);
  while (heap.size) {
    const [index, cost] = heap.pop();
    if (cost > best[index]) continue;
    if (goals.has(index)) return cost;
    const cx = index % width;
    const cz = (index / width) | 0;
    for (const [dx, dz, diag] of NEIGHBOUR_STEPS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!inBounds(width, height, nx, nz)) continue;
      const ni = tileIndex(width, nx, nz);
      const step = moveCost(width, height, terrain, elevation, nx, nz, cx, cz, cls);
      if (!Number.isFinite(step)) continue;
      const next = cost + step * diag;
      if (next < best[ni]) {
        best[ni] = next;
        heap.push(ni, next);
      }
    }
  }
  return Infinity;
}

const NEIGHBOUR_STEPS: Array<[number, number, number]> = [
  [1, 0, 1],
  [0, 1, 1],
  [-1, 0, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Minimal binary heap keyed by route cost; small enough to keep local. */
class CostHeap {
  private readonly items: Array<[number, number]> = [];

  get size(): number {
    return this.items.length;
  }

  push(index: number, cost: number): void {
    const items = this.items;
    items.push([index, cost]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][1] <= items[i][1]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): [number, number] {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left][1] < items[smallest][1]) smallest = left;
        if (right < items.length && items[right][1] < items[smallest][1]) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

function countReach(reach: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < reach.length; i++) if (reach[i]) n++;
  return n;
}

export function auditCompetitiveMap(entry: ScenarioEntry, scenario: Scenario = entry.create()): MapReport {
  const problems: MapProblem[] = [];

  // 1. Structural validity, using the same strict validator the game loads with.
  for (const issue of validateScenario(scenario)) {
    if (issue.severity === 'error') {
      problems.push({ code: `scenario-${issue.code}`, message: issue.message });
    }
  }
  if (scenario.width !== scenario.height) {
    problems.push({ code: 'not-square', message: 'A four-way map must be square to rotate.' });
  }
  if (scenario.width !== entry.width || scenario.height !== entry.height) {
    problems.push({ code: 'catalogue-size-mismatch', message: 'Catalogue footprint disagrees with the scenario.' });
  }

  // 2. Four-way symmetry of everything that shapes play.
  for (const k of [1, 2, 3] as const) compareTerrain(scenario, k, problems);
  compareNeutralStructures(scenario, problems);
  compareOwnedContent(scenario, problems);
  compareProps(scenario, problems);

  // 3. Starts.
  checkSlots(entry, scenario, problems);

  // 4. Accessibility. Buildings are excluded here on purpose: a base exists in
  //    two quadrants only, so including its footprint would compare unlike
  //    ground. Terrain access is the map-level property under test.
  //    Bridge decks are the one structure that *is* ground: a span carries the
  //    road over water, so reachability is measured on the decked map, exactly
  //    as the simulation's navigation layer lays it out.
  const decked = withDecks(scenario);
  const free = terrainBlocked(scenario);
  const slots = scenario.slots ?? scenario.players.map((p) => ({ x: p.startX, z: p.startZ }));
  const reachBySlot = {} as Record<'foot' | 'wheeled' | 'tracked', Uint8Array[]>;
  for (const cls of CLASSES) {
    reachBySlot[cls] = slots.map((slot) => reachableFrom(decked, [slot], cls as MoveClass, free));
    const counts = reachBySlot[cls].map(countReach);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    if ((max - min) / Math.max(1, max) > 0.01) {
      problems.push({
        code: `access-unbalanced-${cls}`,
        message: `${cls} reachable area differs between slots (${counts.join(' / ')}).`,
      });
    }
  }

  // Strategic sites and ore must be reachable from every slot by every class.
  const sites = scenario.structures.filter((s) => s.owner === -1);
  for (const cls of CLASSES) {
    for (let index = 0; index < slots.length; index++) {
      const reach = reachBySlot[cls][index];
      for (const site of sites) {
        const centre = {
          x: site.x + Math.floor((BUILDINGS[site.defId]?.footprint.w ?? 1) / 2),
          z: site.z + Math.floor((BUILDINGS[site.defId]?.footprint.h ?? 1) / 2),
        };
        const near = reach[tileIndex(scenario.width, centre.x, centre.z)];
        if (!near) {
          problems.push({
            code: `site-unreachable-${cls}`,
            message: `${site.defId} at ${site.x},${site.z} is unreachable on ${cls} from slot ${index}.`,
          });
          break;
        }
      }
    }
  }
  for (const cls of CLASSES) {
    let reachableOre = 0;
    const reach = reachBySlot[cls][0];
    for (let i = 0; i < scenario.tiles.length; i++) {
      if (scenario.tiles[i].o > 0 && reach[i]) reachableOre++;
    }
    if (reachableOre === 0) {
      problems.push({ code: `no-ore-${cls}`, message: `No ore is reachable on ${cls} from slot 0.` });
    }
  }

  // Half-turn ownership: each seat must command the same force.
  const forceOf = (owner: number): string =>
    scenario.units
      .filter((u) => u.owner === owner)
      .map((u) => u.defId)
      .sort()
      .join(',');
  if (forceOf(0) !== forceOf(1)) {
    problems.push({ code: 'force-mismatch', message: 'The two seats do not start with the same force.' });
  }
  for (const owner of [0, 1]) {
    if (!scenario.structures.some((s) => s.owner === owner && BUILDINGS[s.defId]?.commandPost)) {
      problems.push({ code: 'base-missing', message: `Seat ${owner} has no Command Post.` });
    }
  }

  // 5. Diagnostics. Reported, never turned into a pass/fail verdict.
  const centre = (scenario.width - 1) / 2;
  const centreApproaches = { foot: 0, wheeled: 0, tracked: 0 };
  for (const cls of CLASSES) {
    let count = 0;
    for (let z = Math.floor(centre) - 2; z <= Math.ceil(centre) + 2; z++) {
      for (let x = Math.floor(centre) - 2; x <= Math.ceil(centre) + 2; x++) {
        if (!inBounds(scenario.width, scenario.height, x, z)) continue;
        const i = tileIndex(scenario.width, x, z);
        if (Math.abs(x - centre) <= 1 && Math.abs(z - centre) <= 1) continue;
        if (Number.isFinite(TERRAIN[scenario.tiles[i].t as TerrainId].costs[cls])) count++;
      }
    }
    centreApproaches[cls] = count;
  }

  let forest = 0;
  let rock = 0;
  let urban = 0;
  let road = 0;
  let water = 0;
  for (const tile of scenario.tiles) {
    if (tile.t === Terrain.Forest) forest++;
    else if (tile.t === Terrain.Rock) rock++;
    else if (tile.t === Terrain.Urban) urban++;
    else if (tile.t === Terrain.Road) road++;
    else if (tile.t === Terrain.DeepWater || tile.t === Terrain.ShallowWater) water++;
  }

  let orePerSlot = slots.map(() => 0);
  let sitesPerSlot = slots.map(() => 0);
  const trackedReach = reachBySlot.tracked;
  for (const [index, reach] of trackedReach.entries()) {
    let ore = 0;
    for (let i = 0; i < scenario.tiles.length; i++) if (scenario.tiles[i].o > 0 && reach[i]) ore++;
    orePerSlot[index] = ore;
    let siteCount = 0;
    for (const site of sites) {
      const cx = site.x + Math.floor((BUILDINGS[site.defId]?.footprint.w ?? 1) / 2);
      const cz = site.z + Math.floor((BUILDINGS[site.defId]?.footprint.h ?? 1) / 2);
      if (reach[tileIndex(scenario.width, cx, cz)]) siteCount++;
    }
    sitesPerSlot[index] = siteCount;
  }

  const travelCost = {
    foot: slots.map((slot) => Math.round(cheapestRoute(decked, slot, 'foot') * 10) / 10),
    wheeled: slots.map((slot) => Math.round(cheapestRoute(decked, slot, 'wheeled') * 10) / 10),
    tracked: slots.map((slot) => Math.round(cheapestRoute(decked, slot, 'tracked') * 10) / 10),
  };

  return {
    problems,
    diagnostics: {
      id: entry.id,
      width: scenario.width,
      height: scenario.height,
      slots: slots.map((slot) => ({ ...slot })),
      startToCentre: slots.map((slot) => Math.round(distance(slot.x, slot.z, centre, centre) * 10) / 10),
      orePerSlot,
      sitesPerSlot,
      areaByClass: {
        foot: countPassable(scenario, 'foot'),
        wheeled: countPassable(scenario, 'wheeled'),
        tracked: countPassable(scenario, 'tracked'),
      },
      reachByClass: {
        foot: countReach(reachBySlot.foot[0]),
        wheeled: countReach(reachBySlot.wheeled[0]),
        tracked: countReach(reachBySlot.tracked[0]),
      },
      terrain: { forest, rock, urban, road, water },
      centreApproaches,
      travelCost,
    },
  };
}

/**
 * The map as ground units meet it: every standing bridge deck laid over the
 * water it spans, at the height of the banks it lands on.
 *
 * This mirrors the simulation's navigation layer. Auditing the raw tiles would
 * call every anchor span unreachable water, and the crossing it exists to
 * provide would be reported as a flaw instead of a feature.
 */
function withDecks(scenario: Scenario): Scenario {
  const spans = scenario.structures.filter((s) => BUILDINGS[s.defId]?.walkable);
  if (spans.length === 0) return scenario;
  const tiles = scenario.tiles.map((tile) => ({ ...tile }));
  for (const span of spans) {
    const def = BUILDINGS[span.defId];
    const { w, h } = def.footprint;
    let level = 0;
    for (let dz = -1; dz <= h; dz++) {
      for (let dx = -1; dx <= w; dx++) {
        const x = span.x + dx;
        const z = span.z + dz;
        if (!inBounds(scenario.width, scenario.height, x, z)) continue;
        const tile = scenario.tiles[tileIndex(scenario.width, x, z)];
        if (TERRAIN[tile.t as TerrainId].water) continue;
        if (tile.e > level) level = tile.e;
      }
    }
    for (const cell of structureTiles(span)) {
      if (!inBounds(scenario.width, scenario.height, cell.x, cell.z)) continue;
      const tile = tiles[tileIndex(scenario.width, cell.x, cell.z)];
      tile.t = Terrain.Road;
      tile.e = level;
      tile.v = undefined;
    }
  }
  return { ...scenario, tiles };
}

function countPassable(scenario: Scenario, cls: 'foot' | 'wheeled' | 'tracked'): number {
  let count = 0;
  for (const tile of scenario.tiles) {
    if (Number.isFinite(TERRAIN[tile.t as TerrainId].costs[cls])) count++;
  }
  return count;
}

/** Audit every competitive map in the catalogue. */
export function auditCompetitiveRoster(): MapReport[] {
  return SCENARIOS.filter((entry) => entry.modes.includes('multiplayer')).map((entry) =>
    auditCompetitiveMap(entry),
  );
}
