/**
 * Weapon selection.
 *
 * The order a unit's weapons are authored in decides nothing. A crew picks the
 * system that actually hurts the thing in front of it, from the same numbers
 * its projectile will use: damage, armour multiplier, accuracy and reload.
 *
 * The score is expected damage per second against the target's armour class,
 * lifted by the stand-off a longer-ranged weapon keeps. That is what stops a
 * missile being spent on a rifleman (armour multiplier 0.22), an autocannon
 * being the answer to a main battle tank (0.32), and a gun beating a missile
 * only because its barrel is closer to the target.
 */
import type { ArmourClass, WeaponDef } from './types';

/**
 * Expected damage per second of one weapon against one armour class.
 *
 * `damageFactor` and `cooldownFactor` carry the crew's veterancy, so the choice
 * the crew makes matches the shot it will actually fire.
 */
export function weaponDps(
  weapon: WeaponDef,
  armour: ArmourClass,
  damageFactor = 1,
  cooldownFactor = 1,
): number {
  const multiplier = weapon.multipliers[armour] ?? 1;
  const damage = Math.max(0, weapon.damage * multiplier * damageFactor);
  const cooldown = Math.max(0.05, weapon.cooldown * cooldownFactor);
  return (damage * weapon.accuracy) / cooldown;
}

/**
 * Score a usable weapon for a target `distanceTiles` away.
 *
 * Reach beyond the current distance is worth having: it is the difference
 * between firing from cover and driving into the answer. The bonus is capped at
 * twelve tiles and four percent a tile, so it can break a close call but can
 * never let a peashooter outrank a weapon that does ten times the damage.
 */
export function weaponScore(
  weapon: WeaponDef,
  armour: ArmourClass,
  distanceTiles: number,
  damageFactor = 1,
  cooldownFactor = 1,
): number {
  const dps = weaponDps(weapon, armour, damageFactor, cooldownFactor);
  const standoff = Math.max(0, Math.min(12, weapon.range - distanceTiles));
  return dps * (1 + standoff * 0.04);
}

export interface WeaponCandidate {
  weapon: WeaponDef;
  score: number;
}

/**
 * Highest score wins. Equal scores keep the earlier weapon in the loadout, so
 * two identical systems never swap from tick to tick and the result is stable
 * across a save and reload.
 */
export function pickBestWeapon(candidates: readonly WeaponCandidate[]): WeaponDef | null {
  let best: WeaponCandidate | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best ? best.weapon : null;
}
