import { TILE_SIZE } from './constants';
import { inBounds, tileCover, tileIndex, tileSight } from './terrain';
import { BUILDINGS, isIndestructibleStructure } from '../data/buildings';
import { ALL_UNITS } from '../data/units';
import { WEAPONS } from '../data/weapons';
import type { ArmourClass, Entity, RuntimeMap, TargetClass, WeaponDef } from './types';

/**
 * Whether a weapon can meaningfully hurt a target. A rifle technically can
 * scratch concrete through its 0.08 structure multiplier, but an order that
 * walks a rifle squad into a building is a suicide run, not an attack, so the
 * order handler has to distinguish a real weapon answer from a peashooter.
 */
export function weaponCanHurt(weapon: WeaponDef, target: Entity): boolean {
  if (!canWeaponTarget(weapon, target)) return false;
  const mul = weapon.multipliers[entityArmour(target)] ?? 1;
  return weapon.damage * mul >= 1.5;
}

export function entityArmour(e: Entity): ArmourClass {
  if (e.kind === 'building') return BUILDINGS[e.defId]?.armour ?? 'structure';
  return ALL_UNITS[e.defId]?.armour ?? 'light';
}

export function entityTargetClass(e: Entity): TargetClass {
  if (e.kind === 'building') return 'structure';
  return ALL_UNITS[e.defId]?.targetClass ?? 'ground';
}

export function entityVision(e: Entity): number {
  if (e.kind === 'building') return BUILDINGS[e.defId]?.vision ?? 6;
  return ALL_UNITS[e.defId]?.vision ?? 6;
}

export function entityName(e: Entity): string {
  if (e.kind === 'building') return BUILDINGS[e.defId]?.name ?? e.defId;
  return ALL_UNITS[e.defId]?.name ?? e.defId;
}

export function canWeaponTarget(weapon: WeaponDef, target: Entity): boolean {
  // Capture-only objectives (relays, forward supply depots) are not targets:
  // they change hands only through an engineer's capture order.
  if (isIndestructibleStructure(target.defId)) return false;
  const submerged = target.kind === 'unit' && !!target.submarine?.dived;
  // Depth charges only reach a boat that is actually under the surface; they
  // are not a second short-range anti-ship gun.
  if (weapon.asw) return submerged && weapon.targets.includes(entityTargetClass(target));
  // A dived boat is not a gunnery target until a launch datum exposes it.
  if (submerged && !target.submarine?.revealed) return false;
  return weapon.targets.includes(entityTargetClass(target));
}

/** Weapons available to an entity definition (without ammo considerations). */
export function entityWeapons(e: Entity): WeaponDef[] {
  const ids = e.kind === 'building' ? BUILDINGS[e.defId]?.weapons : ALL_UNITS[e.defId]?.weapons;
  if (!ids) return [];
  return ids.map((id) => WEAPON_CACHE[id]).filter(Boolean);
}

const WEAPON_CACHE: Record<string, WeaponDef> = WEAPONS;

/** Whether a weapon is the entity's primary ammunition-limited system. */
export function usesPrimaryAmmo(e: Entity, weapon: WeaponDef): boolean {
  const def = ALL_UNITS[e.defId];
  if (!def?.ammo) return false;
  return def.weapons[0] === weapon.id && e.kind === 'unit';
}

/**
 * Tile-based line of sight. Ridges block; dense forest blocks beyond close
 * range. This is intentionally simple and consistent with the editor previews.
 */
export function hasLineOfSight(
  map: RuntimeMap,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  let x0 = Math.floor(ax / TILE_SIZE);
  let z0 = Math.floor(az / TILE_SIZE);
  const x1 = Math.floor(bx / TILE_SIZE);
  const z1 = Math.floor(bz / TILE_SIZE);
  if (!inBounds(map.width, map.height, x0, z0) || !inBounds(map.width, map.height, x1, z1)) {
    return true;
  }
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  const startElevation = map.elevation[tileIndex(map.width, x0, z0)];
  const endElevation = map.elevation[tileIndex(map.width, x1, z1)];
  const ridgeCeiling = Math.max(startElevation, endElevation) + 0.4;
  // Running soft obscuration along the line; three soft tiles close it.
  let obscured = 0;
  let guard = 0;
  while (guard++ < 500) {
    if (x0 === x1 && z0 === z1) break;
    const e2 = 2 * err;
    if (e2 > -dz) {
      err -= dz;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      z0 += sz;
    }
    if ((x0 === x1 && z0 === z1) || !inBounds(map.width, map.height, x0, z0)) break;
    const i = tileIndex(map.width, x0, z0);
    if (map.elevation[i] > ridgeCeiling) return false;
    // Obscuration is data-driven: a tile either hard-blocks the line, or adds
    // its soft cost to the running total. Canopy, scrub, boulder fields, crop
    // rows, reeds and hedgerows all feed the same accounting, so a new terrain
    // cannot forget to be seen through.
    const obscuration = tileSight(map.terrain[i], map.overlay?.[i] ?? 0);
    if (obscuration >= 2) return false;
    obscured += obscuration;
    if (obscured >= 3) return false;
  }
  return true;
}

/**
 * Terrain cover on the tile an entity stands on, in 0..1.
 *
 * Cover is physical protection: masonry, boulders, a hedgerow bank, a scrape.
 * Crops and reeds add concealment, never cover, so standing in a field makes a
 * unit harder to find but no harder to kill. Indirect fire arcs over field
 * cover, so only direct-fire weapons are reduced.
 */
export function coverFactor(
  map: RuntimeMap,
  x: number,
  z: number,
  weapon: { indirect?: boolean } | undefined,
): number {
  if (weapon?.indirect) return 0;
  const tx = Math.floor(x / TILE_SIZE);
  const tz = Math.floor(z / TILE_SIZE);
  if (!inBounds(map.width, map.height, tx, tz)) return 0;
  const i = tileIndex(map.width, tx, tz);
  return tileCover(map.terrain[i], map.overlay?.[i] ?? 0);
}

/** Damage after armour multipliers, rounded to one decimal for stability. */
export function computeDamage(
  base: number,
  multipliers: Partial<Record<ArmourClass, number>>,
  targetArmour: ArmourClass,
): number {
  const mul = multipliers[targetArmour] ?? 1;
  return Math.max(0, Math.round(base * mul * 10) / 10);
}
