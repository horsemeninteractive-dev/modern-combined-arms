/**
 * Strategic superweapon catalogue.
 *
 * A superweapon is not a unit, a structure weapon or a projectile the player
 * aims by hand: it is a national capability, coordinated from a Strategic
 * Operations Centre and executed by off-map assets. This module owns the
 * catalogue — who has which capability, what it costs, what research it needs,
 * how it targets and what its effect data is. The simulation owns progress,
 * cooldowns and resolution, and the UI reads both through the same definitions.
 *
 * Adding a nation is a data change (`NationDef.superweapon`); adding a third
 * faction needs no runtime branch because presentation is keyed by alliance id
 * and the mechanics are keyed by the family. Adding a sixth family means one
 * entry here, its four prerequisite technologies, and one effect branch in
 * `src/sim/superweapons.ts` — no new command or networking path.
 */
import type { Cost } from '../sim/types';

export type SuperweaponFamilyId =
  | 'hypersonic'
  | 'saturation'
  | 'ew'
  | 'drone'
  | 'dew';

/**
 * How a capability chooses its target.
 *
 * - `enemyStructure` — one visible hostile structure.
 * - `enemyArea` — a visible point where hostile ground is engaged.
 * - `enemyNetwork` — a visible enemy area that must actually contain a target.
 * - `friendlyArea` — a point on the commander's own side of the map.
 */
export type SuperweaponTargeting =
  | 'enemyStructure'
  | 'enemyArea'
  | 'enemyNetwork'
  | 'friendlyArea';

export type SuperweaponEffect =
  | {
      readonly kind: 'hypersonic';
      readonly damage: number;
      readonly splash: number;
      readonly flightSpeed: number;
    }
  | {
      readonly kind: 'saturation';
      readonly munitions: number;
      readonly damage: number;
      readonly splash: number;
      readonly spreadTiles: number;
      readonly intervalSeconds: number;
    }
  | {
      readonly kind: 'ew';
      readonly radiusTiles: number;
      readonly durationSeconds: number;
      /** Vision multiplier for affected ground units (1 = unaffected). */
      readonly vision: number;
      /** Extra vision loss for autonomous air systems. */
      readonly airVision: number;
      /** Engagement-range multiplier for affected units. */
      readonly range: number;
    }
  | {
      readonly kind: 'drone';
      readonly drones: number;
      readonly damage: number;
      readonly splash: number;
      readonly spreadTiles: number;
      readonly intervalSeconds: number;
    }
  | {
      readonly kind: 'dew';
      readonly radiusTiles: number;
      readonly durationSeconds: number;
      /** Strategic munitions the field can stop in one simulation second. */
      readonly capacityPerSecond: number;
    };

export interface SuperweaponFamilyDef {
  readonly id: SuperweaponFamilyId;
  /** Shared short label; the alliance variant supplies the field name. */
  readonly name: string;
  readonly role: string;
  readonly icon: string;
  /** Defender-facing field name and description. */
  readonly defenderName: string;
  readonly defenderDescription: string;
  /** Eastern-facing implementation name and description. */
  readonly easternName: string;
  readonly easternDescription: string;
  readonly targeting: SuperweaponTargeting;
  /** Exactly four completed technologies, in addition to the centre. */
  readonly requires: readonly [string, string, string, string];
  readonly cost: Cost;
  readonly cooldownSeconds: number;
  /** Time between authorisation and execution; the response window. */
  readonly warningSeconds: number;
  readonly effect: SuperweaponEffect;
}

/** The four researches each capability needs, two of them existing branch work. */
export const SUPERWEAPON_REQUISITES = Object.freeze({
  hypersonic: ['fires2', 'air2', 'hypersonicGlide', 'terminalSeeker'] as const,
  saturation: ['fires1', 'air1', 'salvoControl', 'penetrationAids'] as const,
  ew: ['air1', 'manoeuvre1', 'spectrumDenial', 'emitterMapping'] as const,
  drone: ['air1', 'manoeuvre2', 'swarmControl', 'autonomousStrike'] as const,
  dew: ['manoeuvre1', 'air2', 'directedEnergyPower', 'beamTargeting'] as const,
});

const FAMILIES: readonly SuperweaponFamilyDef[] = Object.freeze([
  {
    id: 'hypersonic',
    name: 'Hypersonic Strike',
    role: 'Precision strategic strike',
    icon: 'target',
    defenderName: 'Kestrel-9 Hypersonic Strike',
    defenderDescription:
      'A coalition glide vehicle released from a high-altitude carrier and terminally guided onto one high-value structure. The warning is measured in seconds, not minutes: the defence has to already be looking.',
    easternName: 'Tsirkon-E Theatre Strike',
    easternDescription:
      'A corps hypersonic round fired from a road-mobile launcher beyond the map edge. One hardened target, one very short warning, and no second attempt before the launcher reloads.',
    targeting: 'enemyStructure',
    requires: SUPERWEAPON_REQUISITES.hypersonic,
    cost: { mats: 1400, req: 220 },
    cooldownSeconds: 180,
    warningSeconds: 3,
    effect: { kind: 'hypersonic', damage: 820, splash: 1.4, flightSpeed: 70 },
  },
  {
    id: 'saturation',
    name: 'Saturation Missile Strike',
    role: 'Area missile barrage',
    icon: 'mrocket',
    defenderName: 'Salvo Saturation Barrage',
    defenderDescription:
      'A coordinated battery launch that puts a spread of missiles onto one grid square. Air defence can thin the salvo, but only a layered net stops it; what lands is resolved weapon by weapon.',
    easternName: 'Blanket Missile Strike',
    easternDescription:
      'Corps rocket and cruise batteries firing together at a prepared aim point. The barrage is slow enough to see coming and heavy enough that moving is often better than shooting.',
    targeting: 'enemyArea',
    requires: SUPERWEAPON_REQUISITES.saturation,
    cost: { mats: 1100, req: 180 },
    cooldownSeconds: 150,
    warningSeconds: 12,
    effect: {
      kind: 'saturation',
      munitions: 18,
      damage: 95,
      splash: 2.2,
      spreadTiles: 4.5,
      intervalSeconds: 0.18,
    },
  },
  {
    id: 'ew',
    name: 'Electronic Warfare Offensive',
    role: 'Theatre electronic attack',
    icon: 'radarstation',
    defenderName: 'Spectrum Denial Operation',
    defenderDescription:
      'A coalition electronic-attack package floods the enemy picture with noise. Optics still work; the datalinks that turn sightings into a shared picture do not, so units see less and engage shorter for a short window.',
    easternName: 'Emitter Suppression Offensive',
    easternDescription:
      'Corps jamming detachments locate and suppress the opposing sensor net. Static optics keep working, but mobile formations lose reach and the air picture degrades worst of all.',
    targeting: 'enemyNetwork',
    requires: SUPERWEAPON_REQUISITES.ew,
    cost: { mats: 900, req: 160 },
    cooldownSeconds: 140,
    warningSeconds: 6,
    effect: {
      kind: 'ew',
      radiusTiles: 15,
      durationSeconds: 35,
      vision: 0.65,
      airVision: 0.45,
      range: 0.85,
    },
  },
  {
    id: 'drone',
    name: 'Autonomous Drone Swarm',
    role: 'Coordinated loitering attack',
    icon: 'uav',
    defenderName: 'Swarm Strike Package',
    defenderDescription:
      'A container-launched package of semi-autonomous loitering munitions. They arrive over several seconds, spread across the aim area and are slow enough for gun and missile defences to work them down.',
    easternName: 'Coordinated Shahed Swarm',
    easternDescription:
      'A wave of one-way attack drones released from a forward battery. Numbers and persistence are the weapon; air defence, jamming and cover are the answer.',
    targeting: 'enemyArea',
    requires: SUPERWEAPON_REQUISITES.drone,
    cost: { mats: 1000, req: 170 },
    cooldownSeconds: 160,
    warningSeconds: 10,
    effect: {
      kind: 'drone',
      drones: 24,
      damage: 38,
      splash: 0.8,
      spreadTiles: 6,
      intervalSeconds: 0.45,
    },
  },
  {
    id: 'dew',
    name: 'Directed Energy Defence Network',
    role: 'Area defensive field',
    icon: 'hold',
    defenderName: 'Beam Defence Net',
    defenderDescription:
      'A ground-based directed-energy network establishes a defensive envelope over one sector. It burns down incoming strategic munitions — drones worst of all — but it covers one area, holds for a limited time and cannot stop ordinary gunfire.',
    easternName: 'Aegis-Lattice Defence',
    easternDescription:
      'A corps laser lattice protects a command sector against precision munitions and loitering drones. Coverage is local, endurance is finite and a saturation attack can still overwhelm the emitters.',
    targeting: 'friendlyArea',
    requires: SUPERWEAPON_REQUISITES.dew,
    cost: { mats: 850, req: 150 },
    cooldownSeconds: 130,
    warningSeconds: 4,
    effect: { kind: 'dew', radiusTiles: 13, durationSeconds: 22, capacityPerSecond: 6 },
  },
]);

export const SUPERWEAPON_FAMILIES: Readonly<Record<SuperweaponFamilyId, SuperweaponFamilyDef>> =
  Object.freeze(
    Object.fromEntries(FAMILIES.map((family) => [family.id, family])) as Record<
      SuperweaponFamilyId,
      SuperweaponFamilyDef
    >,
  );

export const SUPERWEAPON_FAMILY_LIST: readonly SuperweaponFamilyDef[] = FAMILIES;

export const SUPERWEAPON_IDS: readonly SuperweaponFamilyId[] = FAMILIES.map(
  (family) => family.id,
);

export function isSuperweaponFamilyId(value: unknown): value is SuperweaponFamilyId {
  return typeof value === 'string' && value in SUPERWEAPON_FAMILIES;
}

/** The field name and copy the given alliance would read. */
export function superweaponPresentation(
  family: SuperweaponFamilyDef,
  allianceId: string | undefined,
): { name: string; description: string } {
  return allianceId === 'eastern'
    ? { name: family.easternName, description: family.easternDescription }
    : { name: family.defenderName, description: family.defenderDescription };
}

/** Cooldown and countdown formatting shared by the panel and the HUD chip. */
export function formatSuperweaponClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `${rest}s`;
}
