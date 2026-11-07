/**
 * Runtime abilities granted by researched unit upgrades.
 *
 * Stage 4A defined what research *unlocks*; this module defines what an
 * unlocked upgrade actually *does* when a unit uses it. An upgrade listed here
 * is playable: the selection box can offer it, the simulation can resolve it and
 * the AI may pay to research it. An upgrade absent from here is still only a
 * catalogue entry, which is why `upgradePlayable` exists — the research
 * evaluator asks that same question instead of keeping its own list.
 *
 * Balance numbers live here rather than in the simulation so a smoke cloud's
 * geometry has one home. Cost, duration and cooldown stay on the upgrade
 * definition in `research.ts`: research already publishes them, and a second
 * copy would let the panel and the simulation disagree. The *effect* of an
 * ability — how much speed, vision, reload or protection it buys — is not a
 * research question, so it lives here.
 *
 * Cost model: every ability in the game is limited by its reload and by the
 * trade-off it imposes, not by a resource charge. That is the rule the shipped
 * Recon Smokescreen established (its authored upgrade cost is the one-off price
 * of fitting the discharger, not a cost per use), and the whole catalogue keeps
 * it so the selection box never implies a purchase the simulation does not make.
 */
import { unitUpgradeDef } from './research';

export interface SmokeAbilityDef {
  readonly kind: 'smoke';
  /** Researched upgrade that makes this ability available. */
  readonly upgradeId: string;
  readonly name: string;
  readonly icon: string;
  /** Cloud radius in tiles. */
  readonly radius: number;
  /** How long the cloud persists, in seconds. */
  readonly durationSeconds: number;
  /** Minimum time before the same hull may fire again. */
  readonly cooldownSeconds: number;
  /** One-line trade-off shown in the selection box. */
  readonly note: string;
  readonly ai: AbilityAiUse;
}

/**
 * Which weapons an active protection effect answers. `direct` is every
 * non-indirect shot, `missile` is guided ordnance (missiles, SAMs, torpedoes)
 * and `antiAir` is anything with an anti-aircraft director.
 */
export type AbilityVersus = 'direct' | 'missile' | 'antiAir';

/**
 * A timed, self-centred ability.
 *
 * Everything it changes is expressed as a multiplier the simulation reads while
 * the effect is live: movement, vision, the reload a crew sets after firing, and
 * incoming damage against a class of weapon. Keeping the whole effect in one
 * small record is what lets the sim, the selection box and a save file agree
 * without a per-ability code path.
 */
export interface TimedAbilityDef {
  readonly kind: 'timed';
  readonly upgradeId: string;
  readonly name: string;
  readonly icon: string;
  readonly durationSeconds: number;
  readonly cooldownSeconds: number;
  /** Movement multiplier while active. 0 pins the hull in place. */
  readonly speedMult: number;
  /** Own vision multiplier while active. */
  readonly visionMult: number;
  /** Multiplier on the reload set after firing while active. */
  readonly reloadMult: number;
  /** Incoming damage multiplier, applied to weapons matching `versus`. */
  readonly damageMult?: number;
  readonly versus?: AbilityVersus;
  /** Radius, in tiles, whose dived hostile boats are exposed on activation. */
  readonly revealSubsRadius?: number;
  /** One-line trade-off shown in the selection box. */
  readonly note: string;
  readonly ai: AbilityAiUse;
}

export type UnitAbilityDef = SmokeAbilityDef | TimedAbilityDef;

/**
 * What the AI has to see before it will spend an ability. The planner maps each
 * hint to a sighting test against its own visible list, so no ability is fired
 * on a timer or on hidden information.
 */
export type AbilityAiUse =
  | 'screenContact'
  | 'holdPosition'
  | 'breakContact'
  | 'missileThreat'
  | 'airThreat'
  | 'subHunt'
  | 'firesOnTarget';

/**
 * Smoke geometry.
 *
 * A recon vehicle sees 12.5 tiles, so a 5-tile cloud blanks roughly a fifth of
 * that hull's own reach: enough to break a sight line and cover a withdrawal,
 * not enough to be an area denial field. Because the same radius is what the
 * vision refresh tests, the visual cloud and the gameplay obstruction are the
 * same size by construction.
 */
export const SMOKE_RADIUS_TILES = 5;

function smokeDef(): SmokeAbilityDef | null {
  const upgrade = unitUpgradeDef('reconSmokescreen');
  if (!upgrade) return null;
  return {
    kind: 'smoke',
    upgradeId: upgrade.id,
    name: upgrade.name,
    icon: upgrade.icon,
    radius: SMOKE_RADIUS_TILES,
    durationSeconds: upgrade.durationSeconds ?? 8,
    cooldownSeconds: upgrade.cooldownSeconds ?? 45,
    note: 'Hides what is inside the cloud from anyone outside it; indirect fire still arcs over.',
    ai: 'screenContact',
  };
}

/** The effect half of one timed ability, keyed by the upgrade that grants it. */
interface TimedSpec {
  upgradeId: string;
  speedMult: number;
  visionMult: number;
  reloadMult: number;
  damageMult?: number;
  versus?: AbilityVersus;
  revealSubsRadius?: number;
  note: string;
  ai: AbilityAiUse;
}

const TIMED_SPECS: readonly TimedSpec[] = Object.freeze([
  {
    upgradeId: 'hullDown',
    // A hull behind cover is a smaller target; an indirect round arcs over the
    // ramp it is hiding behind, which is why the effect names direct fire only.
    speedMult: 0,
    visionMult: 1,
    reloadMult: 1,
    damageMult: 0.5,
    versus: 'direct',
    note: 'Half damage from direct fire; the hull cannot move until it breaks position.',
    ai: 'holdPosition',
  },
  {
    upgradeId: 'emergencyPower',
    // The engine is pushed to its governed limit: faster, but no tougher and no
    // more accurate, so it is an escape or a repositioning tool, not a buff.
    speedMult: 1.45,
    visionMult: 1,
    reloadMult: 1,
    note: 'Battle speed for a short burst; guns, armour and vision are unchanged.',
    ai: 'breakContact',
  },
  {
    upgradeId: 'apsBurst',
    // Hard-kill protection answers guided ordnance, not a tank round.
    speedMult: 1,
    visionMult: 1,
    reloadMult: 1,
    damageMult: 0.3,
    versus: 'missile',
    note: 'Intercepts most guided hits; rifles, guns and shells still bite.',
    ai: 'missileThreat',
  },
  {
    upgradeId: 'countermeasures',
    speedMult: 1,
    visionMult: 1,
    reloadMult: 1,
    damageMult: 0.4,
    versus: 'antiAir',
    note: 'Flares and chaff cut anti-aircraft fire; another fighter is unaffected.',
    ai: 'airThreat',
  },
  {
    upgradeId: 'sonarSweep',
    // Active sonar reaches past the passive set and gives the ship a firing
    // picture; it exposes dived boats, so it is the counter to a silent approach.
    speedMult: 1,
    visionMult: 1.5,
    reloadMult: 1,
    revealSubsRadius: 14,
    note: 'Exposes dived boats around the ship and extends her own picture; the boat still has to be engaged.',
    ai: 'subHunt',
  },
  {
    upgradeId: 'firePreparation',
    // The battery works its guns faster for one engagement.
    speedMult: 1,
    visionMult: 1,
    reloadMult: 0.6,
    note: 'Faster follow-up fire for one engagement; the battery is no harder to kill.',
    ai: 'firesOnTarget',
  },
]);

function timedDef(spec: TimedSpec): TimedAbilityDef | null {
  const upgrade = unitUpgradeDef(spec.upgradeId);
  if (!upgrade) return null;
  return {
    kind: 'timed',
    upgradeId: upgrade.id,
    name: upgrade.name,
    icon: upgrade.icon,
    durationSeconds: upgrade.durationSeconds ?? 6,
    cooldownSeconds: upgrade.cooldownSeconds ?? 45,
    speedMult: spec.speedMult,
    visionMult: spec.visionMult,
    reloadMult: spec.reloadMult,
    ...(spec.damageMult === undefined ? {} : { damageMult: spec.damageMult }),
    ...(spec.versus === undefined ? {} : { versus: spec.versus }),
    ...(spec.revealSubsRadius === undefined ? {} : { revealSubsRadius: spec.revealSubsRadius }),
    note: spec.note,
    ai: spec.ai,
  };
}

const SMOKE = smokeDef();
const TIMED = TIMED_SPECS.map(timedDef).filter((def): def is TimedAbilityDef => def !== null);

/** Every upgrade with a working gameplay pathway, keyed by upgrade id. */
export const UNIT_ABILITIES: Readonly<Record<string, UnitAbilityDef>> = Object.freeze(
  Object.fromEntries([...(SMOKE ? [SMOKE] : []), ...TIMED].map((def) => [def.upgradeId, def])),
);

/** The runtime ability an upgrade grants, or undefined when it is not playable. */
export function abilityForUpgrade(upgradeId: string): UnitAbilityDef | undefined {
  return UNIT_ABILITIES[upgradeId];
}

/**
 * Whether a researched upgrade has anything a unit could actually do with it.
 * The AI and the selection box must answer this from the same place.
 */
export function upgradePlayable(upgradeId: string): boolean {
  return UNIT_ABILITIES[upgradeId] !== undefined;
}

/**
 * Whether a weapon is one an active-protection effect answers.
 *
 * Guided ordnance runs on a seeker a hard-kill system can spoof or shoot down;
 * a rifle bullet and a tank round do not. The classes here are the projectile
 * kinds the roster already declares, so no new weapon data is required.
 */
export function isGuidedWeapon(weapon: { projectile: string }): boolean {
  return (
    weapon.projectile === 'missile' ||
    weapon.projectile === 'sam' ||
    weapon.projectile === 'torpedo'
  );
}
