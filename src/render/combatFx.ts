import { clamp01, rotateLocalOffset } from '../core/math';
import { TILE_SIZE } from '../sim/constants';
import type { Game } from '../sim/game';
import type { SimEvent } from '../sim/types';
import { WEAPONS } from '../data/weapons';
import type { Vec3 } from './math';
import { buildingStyle } from './buildingMeshes';

/**
 * Combat presentation classes. The simulation still reports projectile kind
 * and weapon id; this layer only decides how loudly that round should read on
 * screen. Keeping the mapping here means the renderer and its tests agree on
 * what a rifle, a tank gun and an ATGM look like without changing weapon data.
 */
export type WeaponFxClass = 'smallArms' | 'cannon' | 'missile' | 'artillery' | 'antiAir' | 'unknown';

export interface WeaponFxProfile {
  class: WeaponFxClass;
  label: string;
  /** Multiplier for the muzzle flash billboard. */
  muzzleScale: number;
  /** Puffs of propellant smoke at the muzzle; zero for small arms. */
  muzzleSmoke: number;
  /** Additive trail length behind the projectile, in world units. */
  tracerLength: number;
  tracerWidth: number;
  tracerSegments: number;
  tracerColor: [number, number, number];
  projectileSize: number;
  /** Scale for a non-explosive impact spark or dust burst. */
  impactScale: number;
  hitSparkScale: number;
  /** Scale for the primary impact explosion; zero means the round never explodes. */
  explosionScale: number;
  /** Camera shake at the impact point before distance falloff. */
  shake: number;
  /** Whether the projectile should leave a propellant smoke trail. */
  trailSmoke: boolean;
}

const SMALL_ARMS: WeaponFxProfile = {
  class: 'smallArms',
  label: 'small arms',
  muzzleScale: 0.6,
  muzzleSmoke: 0,
  // Overlapping tail dots read as one short tracer. Three widely spaced dots
  // looked like floating sparks at battle zoom, with no readable direction.
  tracerLength: 1.6,
  tracerWidth: 0.085,
  tracerSegments: 6,
  tracerColor: [1, 0.9, 0.55],
  projectileSize: 0.18,
  impactScale: 0.5,
  hitSparkScale: 0.8,
  explosionScale: 0,
  shake: 0,
  trailSmoke: false,
};

const CANNON: WeaponFxProfile = {
  class: 'cannon',
  label: 'direct-fire cannon',
  muzzleScale: 1.0,
  muzzleSmoke: 1,
  tracerLength: 2.8,
  tracerWidth: 0.19,
  tracerSegments: 7,
  tracerColor: [1, 0.62, 0.24],
  projectileSize: 0.38,
  impactScale: 0.9,
  hitSparkScale: 1.2,
  // A direct hit must not read smaller than a ground miss. The old 0.78
  // fireball was below the 0.9 miss puff at the same range.
  explosionScale: 1.0,
  shake: 0.05,
  trailSmoke: false,
};

const MISSILE: WeaponFxProfile = {
  class: 'missile',
  label: 'guided missile',
  muzzleScale: 1.35,
  muzzleSmoke: 2,
  tracerLength: 3.4,
  tracerWidth: 0.22,
  tracerSegments: 8,
  tracerColor: [1, 0.82, 0.5],
  projectileSize: 0.36,
  impactScale: 1.05,
  hitSparkScale: 1.35,
  explosionScale: 1.15,
  shake: 0.07,
  trailSmoke: true,
};

const ARTILLERY: WeaponFxProfile = {
  class: 'artillery',
  label: 'artillery',
  muzzleScale: 1.7,
  muzzleSmoke: 3,
  tracerLength: 3.6,
  tracerWidth: 0.24,
  tracerSegments: 8,
  tracerColor: [1, 0.55, 0.18],
  projectileSize: 0.42,
  impactScale: 1.3,
  hitSparkScale: 1.5,
  explosionScale: 1.4,
  shake: 0.12,
  trailSmoke: false,
};

const ANTI_AIR: WeaponFxProfile = {
  class: 'antiAir',
  label: 'air-defence missile',
  muzzleScale: 1.1,
  muzzleSmoke: 1,
  tracerLength: 2.4,
  tracerWidth: 0.16,
  tracerSegments: 6,
  tracerColor: [0.72, 0.95, 1],
  projectileSize: 0.3,
  impactScale: 0.95,
  hitSparkScale: 1.0,
  explosionScale: 1.05,
  shake: 0.04,
  trailSmoke: true,
};

const UNKNOWN: WeaponFxProfile = {
  class: 'unknown',
  label: 'unspecified weapon',
  muzzleScale: 0.8,
  muzzleSmoke: 1,
  tracerLength: 2,
  tracerWidth: 0.15,
  tracerSegments: 6,
  tracerColor: [1, 0.85, 0.6],
  projectileSize: 0.3,
  impactScale: 0.75,
  hitSparkScale: 1,
  explosionScale: 0.75,
  shake: 0.03,
  trailSmoke: false,
};

const SMALL_ARMS_IDS = new Set(['rifle', 'heavyMg', 'autocannon']);
const CANNON_IDS = new Set(['tankGun', 'atTurretGun', 'spearheadGun', 'navalGun']);
const MISSILE_IDS = new Set(['atgm', 'strikeMissile', 'navalMissile', 'coastalMissile']);
const ARTILLERY_IDS = new Set(['howitzer', 'mlrsRocket', 'heavyShell']);
const ANTI_AIR_IDS = new Set(['samVehicle', 'samBattery', 'airMissile']);

/**
 * Gameplay fog, not the renderer's fog-texture toggle, decides whether a world
 * point is visible to the local player. A spectator with no team sees the whole
 * field. This is the shared presentation gate for effects, trails and audio.
 */
export function pointVisibleToLocal(game: Game, x: number, z: number): boolean {
  if (!game.state.scenario.settings.fog) return true;
  const team = game.teamOf(game.localPlayerId);
  if (team < 0) return true;
  return game.fogAt(team, Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)) === 2;
}

/**
 * The one visibility rule shared by combat visuals and combat audio. Friendly
 * events are always visible: they are the player's own battle, not hidden
 * information. Enemy events follow gameplay vision.
 */
export function eventVisibleToLocal(game: Game, ev: SimEvent): boolean {
  if (ev.team === game.localPlayerId) return true;
  return pointVisibleToLocal(game, ev.x, ev.z);
}

/**
 * A projectile is hidden only when it is hostile and its current ground tile is
 * unseen. An own-team shell crossing fog is not hidden information, and hiding
 * it made long artillery arcs disappear mid-flight while their firing event
 * and audio stayed visible.
 */
export function projectileVisibleToLocal(
  game: Game,
  owner: number,
  x: number,
  z: number,
): boolean {
  if (game.teamOf(owner) === game.teamOf(game.localPlayerId)) return true;
  return pointVisibleToLocal(game, x, z);
}

export function weaponFxClass(weaponId?: string): WeaponFxClass {
  if (!weaponId) return 'unknown';
  if (SMALL_ARMS_IDS.has(weaponId)) return 'smallArms';
  if (CANNON_IDS.has(weaponId)) return 'cannon';
  if (MISSILE_IDS.has(weaponId)) return 'missile';
  if (ARTILLERY_IDS.has(weaponId)) return 'artillery';
  if (ANTI_AIR_IDS.has(weaponId)) return 'antiAir';
  return 'unknown';
}

export function weaponFxProfile(weaponId?: string): WeaponFxProfile {
  // A missing definition is a presentation fallback, not a simulation error:
  // old saves and test fixtures may name a weapon this build no longer has.
  if (weaponId && !WEAPONS[weaponId]) return UNKNOWN;
  switch (weaponFxClass(weaponId)) {
    case 'smallArms':
      return SMALL_ARMS;
    case 'cannon':
      return CANNON;
    case 'missile':
      return MISSILE;
    case 'artillery':
      return ARTILLERY;
    case 'antiAir':
      return ANTI_AIR;
    default:
      return UNKNOWN;
  }
}

export interface ProjectileSample {
  x: number;
  y: number;
  z: number;
}

export interface VisualWreck {
  defId: string;
  x: number;
  y: number;
  z: number;
  facing: number;
  /** Seconds since the hull was created; drives how long it actively burns. */
  age?: number;
  smokeTimer?: number;
  fireTimer?: number;
}

/** Hard ceiling for persistent hulls; they are presentation-only, so bounded. */
export const MAX_VISUAL_WRECKS = 24;

/**
 * Bounded list of charred hulls. No entity, collision, picking or save entry:
 * the store only ever holds enough data to redraw an existing unit body.
 */
export class WreckStore {
  private list: VisualWreck[] = [];

  get wrecks(): readonly VisualWreck[] {
    return this.list;
  }

  get length(): number {
    return this.list.length;
  }

  push(wreck: VisualWreck): void {
    this.list.push({
      age: 0,
      smokeTimer: 0.55,
      fireTimer: 0.15,
      ...wreck,
    });
    while (this.list.length > MAX_VISUAL_WRECKS) this.list.shift();
  }

  clear(): void {
    this.list.length = 0;
  }
}

/** Linear interpolation between the last two rendered simulation positions. */
export function sampleProjectile(
  previous: ProjectileSample,
  current: ProjectileSample,
  alpha: number,
): ProjectileSample {
  const t = clamp01(alpha);
  return {
    x: previous.x + (current.x - previous.x) * t,
    y: previous.y + (current.y - previous.y) * t,
    z: previous.z + (current.z - previous.z) * t,
  };
}

const TURRET_TIPS = new Map<string, Vec3 | null>();

/**
 * The forward-most point of a traversing weapon, in the turret's local frame.
 * Building turrets are all authored around a pintle with the barrel on local
 * +X, so the outer cap centre is the muzzle. Averaging the cap vertices keeps
 * twin launchers centred between their rails instead of picking one.
 */
function turretTip(defId: string): Vec3 | null {
  if (TURRET_TIPS.has(defId)) return TURRET_TIPS.get(defId) ?? null;
  const style = buildingStyle(defId);
  if (!style?.turret) {
    TURRET_TIPS.set(defId, null);
    return null;
  }
  const positions = style.turret.positions;
  let maxX = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] > maxX) maxX = positions[i];
  }
  if (!Number.isFinite(maxX)) {
    TURRET_TIPS.set(defId, null);
    return null;
  }
  const cut = maxX - 0.06;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < cut) continue;
    sx += positions[i];
    sy += positions[i + 1];
    sz += positions[i + 2];
    n++;
  }
  if (n === 0) {
    TURRET_TIPS.set(defId, null);
    return null;
  }
  const tip: Vec3 = [sx / n, sy / n, sz / n];
  TURRET_TIPS.set(defId, tip);
  return tip;
}

export interface MuzzleAnchor {
  x: number;
  y: number;
  z: number;
}

/**
 * World-space muzzle for a static weapon. The simulation reports the centre
 * of a building at +3.5, which floats above a low AT gun or below a raised
 * coastal rail. This resolves the same turret transform the renderer draws,
 * so the flash sits at the barrel without touching the gameplay hardpoint.
 */
export function staticMuzzleAnchor(
  defId: string,
  x: number,
  baseY: number,
  z: number,
  facing: number,
  turretFacing: number,
): MuzzleAnchor | null {
  const style = buildingStyle(defId);
  if (!style?.turret) return null;
  const tip = turretTip(defId);
  if (!tip) return null;
  const offset = style.turretOffset ?? [0, 0, 0];
  const mount = rotateLocalOffset(offset[0], offset[2], facing);
  const barrel = rotateLocalOffset(tip[0], tip[2], turretFacing);
  return {
    x: x + mount.x + barrel.x,
    y: baseY + offset[1] + tip[1],
    z: z + mount.z + barrel.z,
  };
}
