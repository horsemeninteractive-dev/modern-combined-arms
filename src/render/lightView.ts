import { illuminatorActive, sensorFor } from '../sim/sensors';
import { headlampAnchor, structureAnchor } from './lightAnchors';
import type { DayNightState } from '../sim/dayNight';
import type { Entity } from '../sim/types';
import type { GpuLight } from './lightGpu';

/**
 * Presentation lights, rebuilt every frame from live entities.
 *
 * The simulation keeps its own bounded light list for detection, refreshed on
 * the vision cadence because that is a gameplay quantity. Presentation must not
 * inherit that cadence: a vehicle at full speed would leave its headlights half a
 * second behind. This builder therefore reads entity positions, facings and
 * states directly each frame and lays out the same lights the simulation
 * recognises — it can never invent one the simulation would not have, because it
 * applies the same profiles, power and emission rules.
 *
 * It is also where the visual detail lives: two headlamps per vehicle instead of
 * one blob, a cone beam aimed along the hull, corner work-lamps on structures so a
 * base reads as a lit compound rather than a dark roof, and window rows on the
 * facades that face the camera.
 */

export interface LightViewInput {
  entities: readonly Entity[];
  dayNight: DayNightState;
  /** Additive intensity multiplier from the graphics settings. */
  bloom: number;
  /** Effects off softens the whole pass; it never removes a light. */
  effects: boolean;
  /** Whether an owner's grid is up; a browned-out compound goes dark. */
  powered: (owner: number) => boolean;
  /** Camera position, used to face glows toward the viewer. */
  eye: readonly [number, number, number];
  /** Terrain surface height in world units at a world position. */
  groundY: (x: number, z: number) => number;
  /**
   * Where the entity is actually being drawn. The renderer eases meshes toward
   * the simulation position, so a lamp must sit on the drawn hull rather than on
   * the raw tick position, or the beam visibly slides out from under the
   * vehicle while it drives.
   */
  pose?: (entity: Entity) => { x: number; z: number; facing: number } | null;
  /**
   * Whether the local team can currently see an entity. Night is lit for the
   * player, not for the map: a compound in the fog must not advertise itself
   * with wall lamps, and an unseen vehicle must not cast headlights.
   */
  visible?: (entity: Entity) => boolean;
  /** Hard ceiling on instances; the pass is one draw call either way. */
  maxLights?: number;
}

/** Beam reach in world units. A tile is four units, so this is about 3 tiles. */
const HEADLAMP_LENGTH = 13;
const SEARCHLIGHT_LENGTH = 18;

/**
 * How brightly a structure's own window glass glows, 0 by day.
 *
 * The models already carry their glazing, so lit windows are the model's own
 * geometry made emissive rather than a separate billboard: the pane that glows
 * is the pane that is in the wall.
 */
export function windowGlow(dayNight: DayNightState, nightLights: boolean): number {
  const dark = Math.min(1, dayNight.darkness * 1.15);
  if (dark <= 0) return 0;
  return nightLights ? dark : dark * 0.35;
}

/**
 * Window glow cut by the owner's grid.
 *
 * Glazing is part of a compound's own electrical load, so it follows the same
 * rule the wall lamps already use: a browned-out base dims its windows with its
 * production, and a grid with no supply at all leaves them dark. A structure
 * whose owner draws nothing (a neutral site, a lone headquarters) has no deficit
 * to share and keeps its glow.
 */
export function poweredWindowGlow(glow: number, power: { demand: number; ratio: number }): number {
  if (glow <= 0) return 0;
  if (!(power.demand > 0)) return glow;
  const ratio = Number.isFinite(power.ratio) ? power.ratio : 1;
  return glow * Math.max(0, Math.min(1, ratio));
}

/**
 * The single rule for how bright one structure's glass is drawn.
 *
 * Daylight and a site still under construction leave nothing lit. A structure
 * the team has only charted is drawn from memory, and memory does not carry
 * whether the lights are on, so it stays dark until it is seen again rather than
 * advertising itself through the fog. Everything else follows the owner's grid:
 * `null` means no grid applies (a neutral site), otherwise the supply ratio cuts
 * the glow.
 */
export function structureWindowGlow(
  glow: number,
  state: {
    construction: boolean;
    remembered: boolean;
    power: { demand: number; ratio: number } | null;
  },
): number {
  if (glow <= 0) return 0;
  if (state.construction || state.remembered) return 0;
  if (!state.power) return glow;
  return poweredWindowGlow(glow, state.power);
}

export const MAX_VIEW_LIGHTS = 900;

/** Crystal seams allowed to light their own ground in one frame. */
export const ORE_LIGHT_LIMIT = 96;
const ORE_LIGHT_RANGE = 120;
const ORE_POOL_RADIUS = 2.6;

export interface OreGlowInstance {
  x: number;
  y: number;
  z: number;
  scale?: number;
}

/**
 * A cyan pool under each material deposit, so a seam is a landmark after dark
 * rather than just a bright prop standing in the dark. Only deposits near the
 * camera pay for a light, and the list is capped so a large ore field cannot
 * grow the light pass without bound.
 */
export function oreGlowLights(
  instances: readonly OreGlowInstance[],
  glow: number,
  eye: readonly [number, number, number],
  /** Visibility test for a world position; a seam in the fog stays dark. */
  lit: (x: number, z: number) => boolean = () => true,
  limit = ORE_LIGHT_LIMIT,
  range = ORE_LIGHT_RANGE,
): GpuLight[] {
  const out: GpuLight[] = [];
  if (glow <= 0.01) return out;
  const rangeSq = range * range;
  for (const ore of instances) {
    if (out.length >= limit) break;
    const dx = ore.x - eye[0];
    const dz = ore.z - eye[2];
    if (dx * dx + dz * dz > rangeSq) continue;
    if (!lit(ore.x, ore.z)) continue;
    out.push({
      x: ore.x,
      y: ore.y + 0.06,
      z: ore.z,
      radius: ORE_POOL_RADIUS * (ore.scale ?? 1),
      rotation: 0,
      stretch: 1,
      glow: 0,
      cone: 0,
      color: [0.2, 0.85, 1.0],
      intensity: glow * 0.24,
    });
  }
  return out;
}

export function buildLightView(input: LightViewInput): GpuLight[] {
  const { entities, dayNight, bloom, effects, powered, groundY } = input;
  const out: GpuLight[] = [];
  if (dayNight.darkness <= 0) return out;
  const limit = input.maxLights ?? MAX_VIEW_LIGHTS;
  const gain = Math.max(0, Math.min(2, bloom)) * (effects ? 1 : 0.6);
  if (gain <= 0.01) return out;
  const strength = dayNight.darkness;

  for (const e of entities) {
    if (out.length >= limit) break;
    if (e.hp <= 0) continue;
    if (e.kind === 'unit' && e.garrisonId) continue;
    if (input.visible && !input.visible(e)) continue;
    const profile = sensorFor(e);
    const kind = profile.illuminator;
    if (kind === 'none') continue;

    if (e.kind === 'building') {
      if (e.owner >= 0 && (!powered(e.owner) || e.construction)) continue;
      const pose = input.pose?.(e) ?? { x: e.x, z: e.z, facing: e.facing };
      pushStructureLights(out, e, pose, kind, gain * strength, groundY, limit);
      continue;
    }

    const moving =
      e.state === 'moving' ||
      e.state === 'attacking' ||
      e.order?.type === 'move' ||
      e.order?.type === 'attackMove';
    if (!illuminatorActive(e, profile, dayNight, moving)) continue;
    const pose = input.pose?.(e) ?? { x: e.x, z: e.z, facing: e.facing };
    pushVehicleLights(out, e, pose, kind, gain * strength, groundY);
  }
  return out;
}

function pushVehicleLights(
  out: GpuLight[],
  e: Entity,
  pose: { x: number; z: number; facing: number },
  kind: 'headlights' | 'searchlight' | 'beacon' | 'floodlight' | 'windows',
  gain: number,
  groundY: LightViewInput['groundY'],
): void {
  if (kind === 'beacon') {
    out.push({
      x: pose.x,
      y: groundY(pose.x, pose.z) + 4.2,
      z: pose.z,
      radius: 0.4,
      rotation: 0,
      stretch: 1,
      glow: 1,
      cone: 0,
      color: [1, 0.3, 0.22],
      intensity: gain * 0.8,
    });
    return;
  }
  const anchor = headlampAnchor(e.defId);
  if (!anchor) return;
  const cos = Math.cos(pose.facing);
  const sin = Math.sin(pose.facing);
  // Two lamps, offset to the hull's left and right, both aimed along its facing.
  const lampCount = kind === 'headlights' ? 2 : 1;
  for (let i = 0; i < lampCount; i++) {
    const side = lampCount === 2 ? (i === 0 ? -anchor.lateral : anchor.lateral) : 0;
    const x = pose.x + cos * anchor.forward - sin * side;
    const z = pose.z + sin * anchor.forward + cos * side;
    const y = groundY(x, z) + 0.08;
    (kind === 'searchlight'
      ? pushSearchlight(out, x, y, z, pose.facing, anchor.height, gain)
      : pushHeadlamp(out, x, y, z, pose.facing, anchor.height, gain));
  }
}

function pushHeadlamp(
  out: GpuLight[],
  x: number,
  y: number,
  z: number,
  facing: number,
  lampHeight: number,
  gain: number,
): void {
  // Half-width and half-length of the beam quad, in world units. The quad is
  // stretched along the hull's facing, and its centre sits one half-length
  // ahead of the lamp, so the near edge starts at the bumper and nothing is
  // ever painted behind the vehicle.
  const halfWidth = 2.2;
  const halfLength = HEADLAMP_LENGTH * 0.5;
  out.push({
    x: x + Math.cos(facing) * halfLength,
    y,
    z: z + Math.sin(facing) * halfLength,
    radius: halfWidth,
    rotation: facing,
    stretch: halfLength / halfWidth,
    glow: 0,
    cone: 1,
    color: [1.0, 0.93, 0.74],
    intensity: gain * 0.42,
  });
  // The lens itself, at the height the model mounts it: a small warm bloom so
  // the lamp is visible on the bodywork, not only as a pool on the ground.
  out.push({
    x,
    y: y + lampHeight,
    z,
    radius: 0.18,
    rotation: 0,
    stretch: 1,
    glow: 1,
    cone: 0,
    color: [1.0, 0.95, 0.82],
    intensity: gain * 0.8,
  });
}

function pushSearchlight(
  out: GpuLight[],
  x: number,
  y: number,
  z: number,
  facing: number,
  lampHeight: number,
  gain: number,
): void {
  const halfWidth = 2.4;
  const halfLength = SEARCHLIGHT_LENGTH * 0.5;
  out.push({
    x: x + Math.cos(facing) * halfLength,
    y,
    z: z + Math.sin(facing) * halfLength,
    radius: halfWidth,
    rotation: facing,
    stretch: halfLength / halfWidth,
    glow: 0,
    cone: 1,
    color: [0.93, 0.97, 1.0],
    intensity: gain * 0.45,
  });
  out.push({
    x,
    y: y + lampHeight + 0.35,
    z,
    radius: 0.22,
    rotation: 0,
    stretch: 1,
    glow: 1,
    cone: 0,
    color: [0.96, 0.99, 1.0],
    intensity: gain * 0.8,
  });
}

function pushStructureLights(
  out: GpuLight[],
  e: Entity,
  pose: { x: number; z: number; facing: number },
  kind: 'headlights' | 'searchlight' | 'beacon' | 'floodlight' | 'windows',
  gain: number,
  groundY: LightViewInput['groundY'],
  limit: number,
): void {
  // Walls, not the data footprint: a corner lamp has to sit on the model it
  // belongs to, or it hangs in the air beside it.
  const anchor = structureAnchor(e.defId);
  const hx = anchor.halfX;
  const hz = anchor.halfZ;
  const ground = groundY(pose.x, pose.z);
  const cos = Math.cos(pose.facing);
  const sin = Math.sin(pose.facing);
  // Rotate a hull-local offset onto the structure's own heading.
  const place = (lx: number, lz: number): { x: number; z: number } => ({
    x: pose.x + cos * lx - sin * lz,
    z: pose.z + sin * lx + cos * lz,
  });

  if (kind === 'beacon') {
    // A mast light at the height the model actually reaches, plus a low wash.
    out.push({
      x: pose.x,
      y: ground + 0.07,
      z: pose.z,
      radius: Math.min(6, Math.max(2.4, hz * 1.2)),
      rotation: 0,
      stretch: 1,
      glow: 0,
      cone: 0,
      color: [1.0, 0.3, 0.24],
      intensity: gain * 0.24,
    });
    const mast = place(0, 0);
    out.push({
      x: mast.x,
      y: ground + anchor.height * 0.94,
      z: mast.z,
      radius: 0.34,
      rotation: 0,
      stretch: 1,
      glow: 1,
      cone: 0,
      color: [1.0, 0.34, 0.26],
      intensity: gain * 0.95,
    });
    return;
  }

  // Wall lamps at the model's four corners, standing just off the wall so the
  // apron catches the light and the lamp head is not buried in the facade.
  const corners: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [-hx, hz],
    [hx, hz],
  ];
  const poolRadius = Math.min(9, Math.max(3.2, Math.min(hx, hz) * 1.05));
  const lampY = ground + Math.max(1.6, anchor.height * 0.62);
  for (const [cx, cz] of corners) {
    if (out.length + 2 > limit) return;
    // Outward diagonal of that corner, used for the lamp's stand-off.
    const normal = Math.hypot(cx, cz) || 1;
    const unitX = cx / normal;
    const unitZ = cz / normal;
    // The lamp head sits on the corner, a hand's width clear of the wall; the
    // pool is pushed out past it so the apron is lit rather than the roof.
    const poolAt = place(cx + unitX * 1.4, cz + unitZ * 1.4);
    out.push({
      x: poolAt.x,
      y: groundY(poolAt.x, poolAt.z) + 0.07,
      z: poolAt.z,
      radius: poolRadius,
      rotation: 0,
      stretch: 1,
      glow: 0,
      cone: 0,
      color: [1.0, 0.9, 0.68],
      intensity: gain * 0.62,
    });
    const lampAt = place(cx + unitX * 0.3, cz + unitZ * 0.3);
    out.push({
      x: lampAt.x,
      y: lampY,
      z: lampAt.z,
      radius: 0.3,
      rotation: 0,
      stretch: 1,
      glow: 1,
      cone: 0,
      color: [1.0, 0.9, 0.7],
      intensity: gain * 0.95,
    });
  }
}
