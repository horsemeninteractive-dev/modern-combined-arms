import { TILE_SIZE } from './constants';
import { illuminatorActive, sensorFor } from './sensors';
import type { IlluminatorKind } from '../data/sensors';
import type { DayNightState } from './dayNight';
import { inBounds, tileIndex } from './terrain';
import type { Entity } from './types';

/**
 * Battlefield illumination.
 *
 * Lights are a bounded, deterministic set derived from authoritative entities:
 * no client invents a light, and the simulation and the renderer read the same
 * profile. A floodlit yard therefore means the same thing on screen and in the
 * detection model, and an unlit one cannot be conjured by a graphics setting.
 *
 * Illumination is not a sensor. It raises the local light level, which helps
 * optical observers and reveals a vehicle running with its lights on; it never
 * grants vision to a unit that cannot see that far, and it never reclassifies a
 * hidden unit on the client.
 */

export interface LightProfile {
  /** Radius in tiles. */
  radius: number;
  /** Peak illumination 0..1. */
  intensity: number;
  /** Additive colour for the presentation pass. */
  color: [number, number, number];
  /** Ground pools sit low; window and beacon glows sit on the structure. */
  vertical: 'ground' | 'facade' | 'beacon';
  /** Vehicle beams are stretched along the heading instead of round. */
  beam: boolean;
}

export const LIGHT_PROFILES: Record<Exclude<IlluminatorKind, 'none'>, LightProfile> = {
  // Radii are the pool the light actually throws, in tiles. A vehicle's lamps
  // reach roughly three tiles ahead, which is also how far the renderer draws
  // its beam, so what a player sees lit is what the detection model uses.
  headlights: {
    radius: 4,
    intensity: 0.55,
    color: [1.0, 0.9, 0.68],
    vertical: 'ground',
    beam: true,
  },
  searchlight: {
    // Matches the drawn beam: a searchlight throws its pool about six and a
    // half tiles, so what a crew can see is what the lamp actually reaches.
    radius: 7,
    intensity: 0.8,
    color: [0.92, 0.96, 1.0],
    vertical: 'ground',
    beam: true,
  },
  floodlight: {
    radius: 6,
    intensity: 0.75,
    color: [1.0, 0.86, 0.6],
    vertical: 'ground',
    beam: false,
  },
  windows: {
    radius: 3.5,
    intensity: 0.45,
    color: [1.0, 0.78, 0.44],
    vertical: 'facade',
    beam: false,
  },
  beacon: {
    radius: 2.5,
    intensity: 0.5,
    color: [1.0, 0.24, 0.2],
    vertical: 'beacon',
    beam: false,
  },
};

/** Hard ceiling: beyond this the oldest lights are dropped, never sorted. */
export const MAX_LIGHTS = 180;

export interface LightSource {
  entityId: number;
  owner: number;
  kind: Exclude<IlluminatorKind, 'none'>;
  x: number;
  /** World height, for the presentation pass. */
  y: number;
  z: number;
  /** Facing in radians, used by beams. */
  facing: number;
  radius: number;
  intensity: number;
  color: [number, number, number];
  vertical: LightProfile['vertical'];
  beam: boolean;
}

/**
 * Every light currently burning. Buildings need power; units need to be moving
 * (or holding a searchlight on a target) and alive. `powered` answers for one
 * owner, because a browned-out base is dark.
 */
export function collectLightSources(
  entities: readonly Entity[],
  dayNight: DayNightState,
  powered: (owner: number) => boolean,
): LightSource[] {
  if (dayNight.darkness <= 0) return [];
  const strength = dayNight.darkness;
  const out: LightSource[] = [];
  for (const e of entities) {
    if (out.length >= MAX_LIGHTS) break;
    if (e.hp <= 0) continue;
    if (e.kind === 'unit' && e.garrisonId) continue;
    const profile = sensorFor(e);
    const kind = profile.illuminator;
    if (kind === 'none') continue;
    if (e.kind === 'building') {
      // Every structure draws its fittings from its owner's grid. An ownerless
      // site has no grid, and a construction site has no fittings yet.
      if (!powered(e.owner) || e.construction) continue;
    }
    const moving =
      e.state === 'moving' ||
      e.order?.type === 'move' ||
      e.order?.type === 'attackMove' ||
      e.state === 'attacking';
    if (!illuminatorActive(e, profile, dayNight, moving)) continue;
    const light = LIGHT_PROFILES[kind];
    out.push({
      entityId: e.id,
      owner: e.owner,
      kind,
      x: e.x,
      y: e.kind === 'building' ? light.vertical === 'beacon' ? 6.4 : 2.2 : 1.1,
      z: e.z,
      facing: e.facing,
      radius: light.radius,
      intensity: light.intensity * strength,
      color: light.color,
      vertical: light.vertical,
      beam: light.beam,
    });
  }
  return out;
}

/**
 * Illumination per tile, 0..1, clamped at 1. Recomputed on the vision cadence
 * rather than per tick, which is what keeps a nighttime base affordable.
 */
export function illuminationGrid(
  width: number,
  height: number,
  lights: readonly LightSource[],
): Float32Array {
  const grid = new Float32Array(width * height);
  for (const light of lights) {
    const cx = light.x / TILE_SIZE;
    const cz = light.z / TILE_SIZE;
    const r = light.radius;
    const r2 = r * r;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(width - 1, Math.ceil(cx + r));
    const minZ = Math.max(0, Math.floor(cz - r));
    const maxZ = Math.min(height - 1, Math.ceil(cz + r));
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dz = z + 0.5 - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const falloff = 1 - d2 / r2;
        const i = tileIndex(width, x, z);
        grid[i] = Math.min(1, grid[i] + light.intensity * falloff * falloff);
      }
    }
  }
  return grid;
}

/** Illumination at a world point, in tiles, clamped to the map. */
export function illuminationAt(
  grid: Float32Array,
  width: number,
  height: number,
  worldX: number,
  worldZ: number,
): number {
  const x = Math.floor(worldX / TILE_SIZE);
  const z = Math.floor(worldZ / TILE_SIZE);
  if (!inBounds(width, height, x, z)) return 0;
  return grid[tileIndex(width, x, z)];
}

/**
 * How much easier a lit target is to pick out: an optical observer gains up to
 * this fraction of extra reach against something standing in a floodlit pool.
 */
export const ILLUMINATED_TARGET_BONUS = 0.4;
