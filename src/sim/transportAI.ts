import { ALL_UNITS } from '../data/units';
import { TILE_SIZE } from './constants';
import { TERRAIN, canStandOn, tileIndex, type TerrainId } from './terrain';
import type { Entity, RuntimeMap } from './types';

/**
 * Transport planning shared by the AI and its tests.
 *
 * Everything here is a pure reading of the map and the commander's own state:
 * no entity is ordered, no `garrisonId` is written and no second coastline
 * database exists. The authoritative boarding, beaching and unloading
 * transactions remain in `Game`, so an operation planned here can still be
 * refused there and the passengers stay where they are.
 */

export type TransportKind = 'land' | 'air' | 'naval';

/** Which arm a mobile container belongs to, or null for every other unit. */
export function transportKindOf(defId: string): TransportKind | null {
  const def = ALL_UNITS[defId];
  if (!def?.transport) return null;
  if (def.domain === 'naval') return 'naval';
  if (def.domain === 'air') return 'air';
  return 'land';
}

/** A live unit that can carry passengers. */
export function isTransportEntity(entity: Entity | null | undefined): boolean {
  return !!entity && entity.kind === 'unit' && entity.hp > 0 && transportKindOf(entity.defId) !== null;
}

function waterAt(map: RuntimeMap, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= map.width || z >= map.height) return false;
  return TERRAIN[map.terrain[tileIndex(map.width, x, z)] as TerrainId].water;
}

/**
 * Whether a straight line between two points crosses water.
 *
 * This is the one land-vs-sea question the planner needs: an objective that is
 * only reachable across a strait is what makes a landing craft worth building,
 * and an objective on the same landmass is not. It samples the existing terrain
 * grid rather than inventing a second classification, and a line that merely
 * clips a lake is still treated as separated — the commander reconnoitres, it
 * does not survey.
 */
export function lineCrossesWater(
  map: RuntimeMap,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const length = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(2, Math.ceil(length / (TILE_SIZE * 0.5)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor((ax + (bx - ax) * t) / TILE_SIZE);
    const z = Math.floor((az + (bz - az) * t) / TILE_SIZE);
    if (waterAt(map, x, z)) return true;
  }
  return false;
}

/**
 * The nearest foot-standable land tile that touches navigable water.
 *
 * This is where infantry wait for a landing craft, and where the craft aims
 * when it unloads: a beach is a land tile beside water, never a water tile.
 * Occupancy, structures and hull clearance are deliberately not checked here —
 * `Game.navalLandingAvailable` validates those against the live world, and this
 * function only answers the terrain question both sides share.
 */
export function coastalStagingPoint(
  map: RuntimeMap,
  centerX: number,
  centerZ: number,
  reachTiles = 16,
): { x: number; z: number } | null {
  const cx = Math.floor(centerX / TILE_SIZE);
  const cz = Math.floor(centerZ / TILE_SIZE);
  for (let ring = 0; ring <= reachTiles; ring++) {
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
        const tx = cx + dx;
        const tz = cz + dz;
        if (tx < 1 || tz < 1 || tx >= map.width - 1 || tz >= map.height - 1) continue;
        const idx = tileIndex(map.width, tx, tz);
        if (waterAt(map, tx, tz)) continue;
        if (!canStandOn(map.width, map.height, map.terrain, idx, 'foot')) continue;
        let shore = false;
        for (const [sx, sz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const wx = tx + sx;
          const wz = tz + sz;
          if (!waterAt(map, wx, wz)) continue;
          if (!canStandOn(map.width, map.height, map.terrain, tileIndex(map.width, wx, wz), 'naval')) continue;
          shore = true;
          break;
        }
        if (!shore) continue;
        return { x: (tx + 0.5) * TILE_SIZE, z: (tz + 0.5) * TILE_SIZE };
      }
    }
  }
  return null;
}

/**
 * Navigable water beside a landing point, where a hull waits before beaching.
 * A move order to a land tile is not a naval order, so the approach is water.
 */
export function waterApproachTo(
  map: RuntimeMap,
  landX: number,
  landZ: number,
  reachTiles = 12,
): { x: number; z: number } | null {
  const cx = Math.floor(landX / TILE_SIZE);
  const cz = Math.floor(landZ / TILE_SIZE);
  if (waterAt(map, cx, cz)) {
    if (canStandOn(map.width, map.height, map.terrain, tileIndex(map.width, cx, cz), 'naval')) {
      return { x: (cx + 0.5) * TILE_SIZE, z: (cz + 0.5) * TILE_SIZE };
    }
    return null;
  }
  for (let ring = 1; ring <= reachTiles; ring++) {
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
        const tx = cx + dx;
        const tz = cz + dz;
        if (!waterAt(map, tx, tz)) continue;
        if (!canStandOn(map.width, map.height, map.terrain, tileIndex(map.width, tx, tz), 'naval')) continue;
        return { x: (tx + 0.5) * TILE_SIZE, z: (tz + 0.5) * TILE_SIZE };
      }
    }
  }
  return null;
}

export interface TransportDemandSignals {
  /** Battle clock. A transport is a mid-game tool, never an opening purchase. */
  tick: number;
  map: RuntimeMap;
  baseX: number;
  baseZ: number;
  targetKnown: boolean;
  targetX: number;
  targetZ: number;
  hasWater: boolean;
  counts: {
    shipyard: number;
    heliport: number;
    airfield: number;
    factory: number;
    barracks: number;
  };
  /** Eligible, ungarrisoned infantry the commander could load today. */
  infantry: number;
  /** Hulls and aircraft already owned or queued, by arm. */
  transports: Record<TransportKind, number>;
  combat: number;
  /** Ticks since the commander last committed or lost a transport. */
  ticksSinceTransport: number;
}

export interface TransportDemandDecision {
  kind: TransportKind | null;
  reason: string;
}

/**
 * Whether one more transport is worth producing, and which arm.
 *
 * The rules are deliberately narrow. A commander that cannot say which of its
 * objectives is separated from its army by water, or that already owns a hull
 * for the job, has no reason to spend materials on another one — a transport
 * that is built because it exists starves the line it was meant to serve.
 */
export function transportDemand(signals: TransportDemandSignals): TransportDemandDecision {
  // The opening belongs to the base and its first line. A hull bought while the
  // perimeter is still being laid out is paid for twice: once in materials and
  // once in the defence that was never sited.
  if (signals.tick < 20 * 150) return { kind: null, reason: 'opening — the base comes first' };
  if (!signals.targetKnown) return { kind: null, reason: 'no objective to reach' };
  if (signals.infantry < 3) return { kind: null, reason: 'no infantry to lift' };

  const distance = Math.hypot(signals.targetX - signals.baseX, signals.targetZ - signals.baseZ);
  const separated = lineCrossesWater(
    signals.map,
    signals.baseX,
    signals.baseZ,
    signals.targetX,
    signals.targetZ,
  );

  if (
    separated &&
    signals.hasWater &&
    signals.counts.shipyard > 0 &&
    signals.transports.naval === 0 &&
    signals.ticksSinceTransport >= 20 * 40
  ) {
    // Both ends must offer a shore: a hull with no beach at the objective is a
    // ferry to nowhere, and one with no beach at home can never load.
    const home = coastalStagingPoint(signals.map, signals.baseX, signals.baseZ, 18);
    const far = coastalStagingPoint(signals.map, signals.targetX, signals.targetZ, 24);
    if (home && far) return { kind: 'naval', reason: 'objective lies across water' };
    return { kind: null, reason: 'no usable beach on the route' };
  }

  if (
    signals.counts.heliport > 0 &&
    signals.transports.air === 0 &&
    signals.combat >= 6 &&
    distance >= 25 * TILE_SIZE &&
    signals.ticksSinceTransport >= 20 * 40
  ) {
    return { kind: 'air', reason: 'long approach over ground the army cannot cross quickly' };
  }

  if (
    signals.counts.factory > 0 &&
    signals.counts.barracks > 0 &&
    signals.transports.land === 0 &&
    // A carrier is a formation asset: a base still assembling its first line
    // buys the line. Committing infantry to a hull before the army exists both
    // spends the hull's price twice and leaves the perimeter short.
    signals.combat >= 8 &&
    distance >= 22 * TILE_SIZE &&
    signals.ticksSinceTransport >= 20 * 30
  ) {
    return { kind: 'land', reason: 'infantry advance across exposed ground' };
  }

  return { kind: null, reason: 'transport already answers the need' };
}
