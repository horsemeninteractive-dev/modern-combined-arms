import { illuminatorActive, sensorFor } from '../sim/sensors';
import { TILE_SIZE } from '../sim/constants';
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
 *
 * Nothing here burns without supply. A structure draws its lamps from its
 * owner's grid, so a browned-out compound is dark — including its window glass,
 * which the shader lights from the owner's power status. An ownerless site has no
 * grid at all, so it stands dark until someone crews it.
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
  /**
   * Seconds of battle view time. Searchlights sweep on it; every other lamp
   * ignores it. Absent means t=0, which is a valid still frame.
   */
  time?: number;
}

/** Beam reach in world units. A tile is four units, so this is about six and a half. */
const HEADLAMP_LENGTH = 13;
const SEARCHLIGHT_LENGTH = 26;
/** A corner wall lamp is a searchlight: it clears the bastion and sweeps. */
const WALL_LAMP_LENGTH = 24;
/** Air-defence beams are thrown at the sky and reach further than a ground sweep. */
const SKY_BEAM_LENGTH = 30;

/**
 * How far off its mount a searchlight swings, how fast it works, and how many
 * lamps one crew is drawing on.
 *
 * A searchlight that holds still is a floodlight with a different label; what
 * reads as a crew hunting the dark is the beam crossing its arc and coming back.
 * Two lamps per emplacement, each on its own phase, is what makes a perimeter
 * read as several crews searching rather than one lamp dragged from roof to
 * roof. The sweep is presentation only: the gameplay light the simulation knows
 * about is the pool around the position, not the beam angle.
 */
const SEARCHLIGHT_ARC = 0.62;
const SEARCHLIGHT_RATE = 0.36;
const SEARCHLIGHT_LAMPS = 2;

/** Discs that make up one sky beam, and the most beams drawn in a frame. */
const SKY_BEAM_STEPS = 12;
const MAX_SKY_BEAMS = 6;

/** A stable 0..1 value per entity and salt; ids are not evenly spread. */
function idNoise(id: number, salt: number): number {
  const value = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** Where a searchlight is pointing this frame, without a target to hold. */
function sweptFacing(id: number, time: number, index: number): number {
  const phase = idNoise(id, index + 1) * Math.PI * 2;
  const rate = SEARCHLIGHT_RATE * (0.8 + idNoise(id, 7) * 0.5);
  return Math.sin(time * rate + phase) * SEARCHLIGHT_ARC;
}

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
 * whose owner draws nothing (a lone headquarters) has no deficit to share and
 * keeps its glow.
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
 * `null` means there is no grid to feed the glass — an ownerless site — so it is
 * dark, exactly like a blacked-out compound. Capture is what brings a site onto
 * a grid and its windows to life.
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
  if (!state.power) return 0;
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
  /**
   * Ground-glow weight. A seam of five nodes pays for one pool, so all but its
   * anchor node carry 0; anything without a weight is treated as one pool.
   */
  glow?: number;
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
    const weight = ore.glow ?? 1;
    if (weight <= 0) continue;
    const dx = ore.x - eye[0];
    const dz = ore.z - eye[2];
    if (dx * dx + dz * dz > rangeSq) continue;
    if (!lit(ore.x, ore.z)) continue;
    out.push({
      x: ore.x,
      y: ore.y + 0.06,
      z: ore.z,
      radius: ORE_POOL_RADIUS * (ore.scale ?? 1) * weight,
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
  const time = input.time ?? 0;

  // Lock-on lookups and wall corners are built only when a beam actually needs
  // them, so a night with nothing aiming and no walls pays for neither.
  let byId: Map<number, Entity> | null = null;
  const targetOf = (e: Entity): Entity | null => {
    // `aimTargetId` is what a crew is actually shooting at (it is set when the
    // gun traverses and fires); `targetId` is an explicit order's target.
    const id = e.aimTargetId || e.targetId;
    if (!id) return null;
    if (!byId) {
      byId = new Map<number, Entity>();
      for (const other of entities) byId.set(other.id, other);
    }
    const target = byId.get(id);
    return target && target.hp > 0 ? target : null;
  };
  let wallTiles: Set<string> | null = null;
  const wallsAt = (e: Entity): boolean => {
    if (!wallTiles) {
      wallTiles = new Set<string>();
      for (const other of entities) {
        if (other.kind !== 'building' || other.hp <= 0) continue;
        if (other.defId !== 'concreteWall') continue;
        wallTiles.add(`${Math.round(other.x / TILE_SIZE)},${Math.round(other.z / TILE_SIZE)}`);
      }
    }
    const tx = Math.round(e.x / TILE_SIZE);
    const tz = Math.round(e.z / TILE_SIZE);
    const along = wallTiles.has(`${tx + 1},${tz}`) || wallTiles.has(`${tx - 1},${tz}`);
    const across = wallTiles.has(`${tx},${tz + 1}`) || wallTiles.has(`${tx},${tz - 1}`);
    return along && across;
  };
  let skyBeams = 0;

  for (const e of entities) {
    if (out.length >= limit) break;
    if (e.hp <= 0) continue;
    if (e.kind === 'unit' && e.garrisonId) continue;
    if (input.visible && !input.visible(e)) continue;
    const profile = sensorFor(e);
    const kind = profile.illuminator;

    if (e.kind === 'building') {
      // A structure being sold for parts is no longer a working base: its
      // floodlights go out with its windows as soon as the sale starts. An
      // ownerless site has no grid, so it stands dark like any blackout.
      if (!powered(e.owner) || e.construction || e.deconstruct) continue;
      const pose = input.pose?.(e) ?? { x: e.x, z: e.z, facing: e.facing };

      // A concrete run turns its own corners: a lamp on the corner segment is
      // what makes a walled compound read as a perimeter rather than a line of
      // slabs in the dark.
      if (e.defId === 'concreteWall') {
        if (wallsAt(e) && out.length + 2 <= limit) {
          pushCornerWallLight(out, pose, gain * strength, groundY, time, e.id);
        }
        continue;
      }

      if (kind === 'none') continue;
      if (profile.sky) {
        if (skyBeams < MAX_SKY_BEAMS) {
          pushSkyBeam(out, e, pose, gain * strength, groundY, time, targetOf(e), limit);
          skyBeams++;
        }
        continue;
      }
      pushStructureLights(out, e, pose, kind, gain * strength, groundY, limit, time, targetOf(e));
      continue;
    }

    // An air-defence hull sweeps the sky whether it is moving or not: a parked
    // launcher is still watching, and an aircraft does not wait for it to drive.
    if (profile.sky && skyBeams < MAX_SKY_BEAMS) {
      const pose = input.pose?.(e) ?? { x: e.x, z: e.z, facing: e.facing };
      pushSkyBeam(out, e, pose, gain * strength, groundY, time, targetOf(e), limit);
      skyBeams++;
    }

    if (kind === 'none') continue;
    const moving =
      e.state === 'moving' ||
      e.state === 'attacking' ||
      e.order?.type === 'move' ||
      e.order?.type === 'attackMove';
    if (!illuminatorActive(e, profile, dayNight, moving)) continue;
    const pose = input.pose?.(e) ?? { x: e.x, z: e.z, facing: e.facing };
    pushVehicleLights(out, e, pose, kind, gain * strength, groundY, time);
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
  time: number,
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
    (kind === 'searchlight'
      ? pushSearchlight(out, x, z, pose.facing + sweptFacing(e.id, time, i), anchor.height, gain, groundY)
      : pushHeadlamp(out, x, z, pose.facing, anchor.height, gain, groundY));
  }
}

/**
 * A lamp's light, projected analytically onto the ground.
 *
 * A beam drawn as geometry is a flat decal: on rising ground its far half sinks
 * into the slope, over a crest it is painted through the hill, and chopping it
 * into steps merely trades one artefact for banding at the seams. No geometry is
 * laid down for the beam any more. The lamp is handed to the terrain shader,
 * which evaluates the cone per fragment against the surface it actually hit, so
 * the light follows every slope exactly, has no boundary to clip, and cannot
 * disaggregate from the ground it falls on.
 */
function pushProjectedLamp(
  out: GpuLight[],
  x: number,
  z: number,
  facing: number,
  lampHeight: number,
  groundY: LightViewInput['groundY'],
  length: number,
  color: [number, number, number],
  intensity: number,
  lensRadius: number,
  lensLift: number,
  tilt: number,
): void {
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const y = groundY(x, z) + 0.08 + lampHeight + lensLift;
  const norm = Math.hypot(1, tilt);
  out.push({
    x,
    y,
    z,
    radius: lensRadius,
    rotation: 0,
    stretch: 1,
    glow: 1,
    cone: 0,
    color,
    intensity: intensity * 0.8,
    spot: {
      x,
      y,
      z,
      dirX: cos / norm,
      dirY: -tilt / norm,
      dirZ: sin / norm,
      range: length,
      cosOuter: Math.cos(0.58),
      color,
      intensity,
    },
  });
}

function pushHeadlamp(
  out: GpuLight[],
  x: number,
  z: number,
  facing: number,
  lampHeight: number,
  gain: number,
  groundY: LightViewInput['groundY'],
): void {
  // Warm lane light, narrow at the bumper and reaching about three tiles. The
  // 0.22 tilt is what brings a lamp mounted at hull height down onto the road.
  pushProjectedLamp(out, x, z, facing, lampHeight, groundY, HEADLAMP_LENGTH, [1.0, 0.93, 0.74], gain * 1.1, 0.18, 0, 0.22);
}

function pushSearchlight(
  out: GpuLight[],
  x: number,
  z: number,
  facing: number,
  lampHeight: number,
  gain: number,
  groundY: LightViewInput['groundY'],
): void {
  pushProjectedLamp(out, x, z, facing, lampHeight, groundY, SEARCHLIGHT_LENGTH, [0.93, 0.97, 1.0], gain * 1.7, 0.34, 0.35, 0.2);
}

/** A lamp bolted to a corner segment of a concrete run. */
function pushCornerWallLight(
  out: GpuLight[],
  pose: { x: number; z: number; facing: number },
  gain: number,
  groundY: LightViewInput['groundY'],
  time: number,
  id: number,
): void {
  // The corner tile is drawn as a bastion, so the lamp is mounted on its roof
  // and sweeps like the emplacements' crews do: a walled compound is a lit
  // perimeter, not a ring of dark slabs.
  const base = idNoise(id, 5) * Math.PI * 2;
  const facing = base + sweptFacing(id, time, 0) * 1.2;
  pushProjectedLamp(
    out, pose.x, pose.z, facing, 2.5, groundY,
    WALL_LAMP_LENGTH, [0.94, 0.97, 1.0], gain * 1.25, 0.26, 0.2, 0.24,
  );
}

/**
 * One air-defence beam, thrown into the sky.
 *
 * A ground spot cannot describe a beam that never meets the ground, so the sky
 * beam is a short chain of additive glows along its own axis: overlapping discs
 * that widen and fade with height. It is presentation only, and capped both per
 * beam and per frame, because an army of launchers must not grow the pass.
 *
 * With a target the beam is held on it — azimuth to the aircraft, elevation to
 * its altitude; otherwise it searches its sector like the ground lamps do.
 */
function pushSkyBeam(
  out: GpuLight[],
  e: Entity,
  pose: { x: number; z: number; facing: number },
  gain: number,
  groundY: LightViewInput['groundY'],
  time: number,
  target: Entity | null,
  limit: number,
): void {
  if (out.length + SKY_BEAM_STEPS + 2 > limit) return;
  const anchor = e.kind === 'building' ? structureAnchor(e.defId) : null;
  const baseY = groundY(pose.x, pose.z) + (anchor ? Math.max(1.8, anchor.height * 0.88) : 2.4);
  const phase = idNoise(e.id, 9) * Math.PI * 2;
  let azimuth: number;
  let elevation: number;
  if (target) {
    const dx = target.x - pose.x;
    const dz = target.z - pose.z;
    const flat = Math.hypot(dx, dz);
    azimuth = Math.atan2(dz, dx);
    // An aircraft is held up at the altitude the simulation flies it at; a
    // ground target is held just above the horizon.
    const altitude = target.kind === 'unit' && target.aircraft ? 13 : 2;
    elevation = Math.max(0.32, Math.min(1.3, Math.atan2(altitude - baseY, Math.max(4, flat))));
  } else {
    azimuth = pose.facing + (idNoise(e.id, 4) - 0.5) * 1.2 + Math.sin(time * 0.5 + phase) * 1.0;
    elevation = 0.78 + 0.26 * Math.sin(time * 0.33 + phase * 1.7);
  }
  const cosEl = Math.cos(elevation);
  const dirX = Math.cos(azimuth) * cosEl;
  const dirY = Math.sin(elevation);
  const dirZ = Math.sin(azimuth) * cosEl;
  const originX = pose.x;
  const originZ = pose.z;

  // The lamp head and the patch of apron it washes, so the emitter is visible.
  out.push({
    x: originX,
    y: baseY + 0.3,
    z: originZ,
    radius: 0.36,
    rotation: 0,
    stretch: 1,
    glow: 1,
    cone: 0,
    color: [0.92, 0.97, 1.0],
    intensity: gain * 0.95,
  });
  out.push({
    x: originX,
    y: groundY(originX, originZ) + 0.07,
    z: originZ,
    radius: 3.2,
    rotation: 0,
    stretch: 1,
    glow: 0,
    cone: 0,
    color: [0.9, 0.95, 1.0],
    intensity: gain * 0.2,
  });

  for (let i = 1; i <= SKY_BEAM_STEPS; i++) {
    const t = i / SKY_BEAM_STEPS;
    const reach = t * SKY_BEAM_LENGTH;
    out.push({
      x: originX + dirX * reach,
      y: baseY + dirY * reach,
      z: originZ + dirZ * reach,
      // Overlapping discs: each is wider than the gap to the next, so the shaft
      // is continuous instead of a string of beads.
      radius: 0.7 + t * 1.9,
      rotation: 0,
      stretch: 1,
      glow: 1,
      cone: 0,
      color: [0.9, 0.96, 1.0],
      intensity: gain * 0.15 * (1 - t * 0.72),
    });
  }
}

function pushStructureLights(
  out: GpuLight[],
  e: Entity,
  pose: { x: number; z: number; facing: number },
  kind: 'headlights' | 'searchlight' | 'beacon' | 'floodlight' | 'windows',
  gain: number,
  groundY: LightViewInput['groundY'],
  limit: number,
  time: number,
  target: Entity | null,
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

  if (kind === 'searchlight') {
    // A defensive emplacement works its own approach: two lamps on the roof,
    // each on its own swing, with the lens drawn where the beam comes from so
    // the sweep has a visible source. A crew with a target on its gunbook holds
    // both beams on it instead of searching, which is what makes an engaged
    // nest read as engaged.
    const lampLift = Math.max(1.8, anchor.height * 0.84);
    const spacing = Math.min(hz * 0.8, 1.5);
    const aimed = target
      ? Math.atan2(target.z - pose.z, target.x - pose.x)
      : null;
    const aimedLength = target
      ? Math.min(SEARCHLIGHT_LENGTH * 1.5, Math.max(10, Math.hypot(target.x - pose.x, target.z - pose.z) * 1.1))
      : SEARCHLIGHT_LENGTH;
    for (let i = 0; i < SEARCHLIGHT_LAMPS; i++) {
      if (out.length + 2 > limit) return;
      const side = (i - (SEARCHLIGHT_LAMPS - 1) / 2) * spacing;
      const lamp = place(0, side);
      // Without a target each lamp is given its own standing direction as well
      // as its own phase, so a line of emplacements is not one beam repeated.
      const idle = pose.facing + (idNoise(e.id, 3) - 0.5) * 1.9;
      const facing = aimed === null
        ? idle + sweptFacing(e.id, time, i)
        : aimed;
      pushProjectedLamp(
        out, lamp.x, lamp.z, facing, lampLift, groundY,
        aimedLength, [0.93, 0.97, 1.0], gain * 1.9, 0.34, 0.4, 0.24,
      );
      out.push({
        x: lamp.x,
        y: groundY(lamp.x, lamp.z) + lampLift + 0.52,
        z: lamp.z,
        radius: 0.36,
        rotation: 0,
        stretch: 1,
        glow: 1,
        cone: 0,
        color: [0.92, 0.97, 1.0],
        // A slight beat, as the arc motor works: bright when it faces this way.
        intensity: gain * (1.0 + 0.18 * Math.cos(time * 2.1 + e.id + i)),
      });
    }
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
