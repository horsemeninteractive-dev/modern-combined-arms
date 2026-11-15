import type { Game } from './game';
import { BUILDINGS, buildingFamily, isIndestructibleStructure } from '../data/buildings';
import { UNITS, unitFamily } from '../data/units';
import {
  COMMANDER_PROFILE_VERSION,
  COMMANDER_TARGET_CATEGORIES,
  NEUTRAL_TACTICAL,
  commanderById,
  resolveCommander,
  tacticalProfileFor,
  type CommanderTargetCategory,
  type TacticalProfile,
} from '../data/commanders';
import {
  RESEARCH_BRANCHES,
  buildingModuleDef,
  exclusiveUnitTech,
  techDef,
  unitUpgradeDef,
  type ResearchBranch,
  type TechDef,
} from '../data/research';
import {
  UNIT_ABILITIES,
  isGuidedWeapon,
  upgradePlayable,
  type UnitAbilityDef,
} from '../data/abilities';
import { REPAIR_SUPPRESSION_TICKS, TILE_SIZE } from './constants';
import { dist } from '../core/math';
import { Terrain, canStandOn, tileIndex } from './terrain';
import { canWeaponTarget, entityWeapons } from './combat';
import { containerAcceptsPassenger, containerBoardingReady } from './containers';
import {
  coastalStagingPoint,
  lineCrossesWater,
  transportDemand,
  transportKindOf,
  waterApproachTo,
} from './transportAI';
import type {
  AIControlState,
  AIDifficulty,
  AIStrategy,
  BuildingDef,
  Entity,
  PlayerState,
  TransportOperation,
} from './types';

/**
 * Whether an entity may influence the strategic score of a construction site.
 *
 * Crowding is a planning signal, so it has to come from knowledge the commander
 * actually has: its own force, its allies, authored map objects, and enemies the
 * team has really seen — currently or, for a structure that cannot move, when it
 * was charted. A remembered unit contact is deliberately not counted: it is a
 * stale position, and a tank that has driven away must not keep its old site
 * reserved. Physical placement is a separate question and stays authoritative in
 * `placementStatus`, which reads the real world.
 */
export function knownForCrowding(game: Game, aiId: number, e: Entity): boolean {
  if (e.owner < 0) return true;
  if (e.owner === aiId) return true;
  const team = game.teamOf(aiId);
  if (game.teamOf(e.owner) === team) return true;
  // `isKnownTo` is the Phase 12 boundary itself: seen now, or a structure this
  // team has charted. Unit contacts are stale by design and stay excluded.
  return game.isKnownTo(team, e.id);
}

export interface ScoutedForceMix {
  /** Armed land vehicles, including light scouts and AA carriers. */
  armour: number;
  /** Armed foot units. */
  infantry: number;
}

/**
 * What an opponent appears to be investing in, inferred only from contacts the
 * commander has identified. Every class is something the existing planner can
 * already answer; none of them require information the AI does not legitimately
 * hold.
 */
export type OpponentTendency =
  | 'armour'
  | 'infantry'
  | 'antiArmour'
  | 'artillery'
  | 'air'
  | 'naval'
  | 'fortified'
  | 'economy';

export const OPPONENT_TENDENCIES: readonly OpponentTendency[] = Object.freeze([
  'armour',
  'infantry',
  'antiArmour',
  'artillery',
  'air',
  'naval',
  'fortified',
  'economy',
]);

/**
 * A bounded, decaying reading of the opponent.
 *
 * `mass` is the strength of the evidence: a decaying sum of identified contacts,
 * so a column seen once fades instead of colouring the rest of the match. `scores`
 * are the same decay applied per class. Confidence is evidence strength times how
 * far ahead the leading class is, so one unusual unit can never dominate.
 */
export interface OpponentRead {
  tendency: OpponentTendency | null;
  confidence: number;
  mass: number;
  scores: Record<OpponentTendency, number>;
  tick: number;
  /** Identified contacts counted this think, before decay. */
  observed: number;
  /**
   * Everything with meaningful evidence, strongest first, as a share of the
   * classified score. A supported armoured force with supporting artillery is
   * two answers, not one winner and a discarded runner-up.
   */
  tendencies: { tendency: OpponentTendency; share: number }[];
}

export type DefenceKind = 'atTurret' | 'mgNest';
export type DefenceCounts = Record<DefenceKind, number>;

/** Count the hostile land units the AI has actually seen or remembers. */
export function scoutedForceMix(game: Game, aiId: number): ScoutedForceMix {
  const mix: ScoutedForceMix = { armour: 0, infantry: 0 };
  const seen = new Set<number>();
  const count = (entityId: number, defId: string): void => {
    if (seen.has(entityId)) return;
    seen.add(entityId);
    const def = UNITS[defId];
    // Unarmed engineers and harvesters do not change which perimeter gun is
    // useful, and aircraft/naval units are outside the MG/AT remit.
    if (!def || def.domain !== 'land' || def.weapons.length === 0) return;
    if (def.armour === 'infantry') mix.infantry++;
    else if (def.armour === 'heavy' || def.armour === 'light' || def.armour === 'support') mix.armour++;
  };
  for (const e of game.visibleEnemies(aiId)) {
    if (e.kind === 'unit') count(e.id, e.defId);
  }
  for (const c of game.contactsFor(aiId)) {
    // A detected or last-known contact has lost its classification, so the
    // scouting report counts only what the commander actually identified.
    if (c.kind === 'unit' && c.defId) count(c.entityId, c.defId);
  }
  return mix;
}

/**
 * Two of the scouted force's dominant arm, one answer to the other. With no
 * scouting report the balanced pair is retained, anti-armour first.
 */
export function defenceTargets(mix: ScoutedForceMix): DefenceCounts {
  return {
    atTurret: mix.armour > mix.infantry ? 2 : 1,
    mgNest: mix.infantry > mix.armour ? 2 : 1,
  };
}

/** Next emplacement to site, or null once the scouted mix is answered. */
export function nextDefenceBuild(
  mix: ScoutedForceMix,
  counts: DefenceCounts,
): DefenceKind | null {
  const targets = defenceTargets(mix);
  const needAt = counts.atTurret < targets.atTurret;
  const needMg = counts.mgNest < targets.mgNest;
  // Build the answer to the larger scouted force first. A tie, or no contact,
  // keeps the original anti-armour opening.
  if (mix.armour > mix.infantry && needAt) return 'atTurret';
  if (mix.infantry > mix.armour && needMg) return 'mgNest';
  if (needAt) return 'atTurret';
  if (needMg) return 'mgNest';
  return null;
}

/* -------------------------------------------------------------------------- */
/* Personality and force planning                                             */
/* -------------------------------------------------------------------------- */

export interface AIProfile {
  /** Selected opponent strength, fixed for the match. */
  difficulty: AIDifficulty;
  /** The opening this commander is trying to execute. */
  strategy: AIStrategy;
  /** Higher commits earlier and keeps a smaller reserve. */
  aggression: number;
  /** Higher values refineries, harvesters and power headroom. */
  economy: number;
  /** Higher values air/naval branches. */
  tech: number;
  /** Higher sites more static defences and answers threats sooner. */
  defence: number;
  /** Relative size of the army it plans and commits. */
  armyScale: number;
  /** Ticks between decisions. A slower commander reacts later to everything. */
  reactionTicks: number;
  /** How far it bends its fixed doctrine toward the force it has scouted. */
  responseWeight: number;
  /**
   * Share of the desired army a commander insists on before it attacks. A low
   * share means units are fed in as they finish; a high share means one
   * concentrated wave.
   */
  commitShare: number;
  /** Combat units kept at home while a wave is away. */
  reserve: number;
  /**
   * Whether a commander pulls a committed wave home when its own base is
   * attacked. A recruit does not: its army walks on while its base burns.
   */
  recall: boolean;
  /**
   * Whether a commander pulls its haulers out of the line of fire.
   *
   * A truck is worth more than the load it carries: it mines for the rest of the
   * match, and a base that loses its haulers to the first raider never earns the
   * income that would have answered the raid. A recruit leaves its trucks to work
   * until they burn, which is why a novice's economy never recovers from its
   * first scrape.
   */
  protectEconomy: boolean;
  /**
   * Whether a commander uses the tactical abilities its units have.
   *
   * Smoke, hull-down, breaking contact and the rest are crew drills: they have
   * to be ordered at the right moment and a novice simply does not. A recruit
   * therefore fights with the plain weapon and nothing else, while a veteran
   * spends a discharger to break a sight line and an elite does it half a second
   * sooner. This is the one part of the ladder that is about tactical skill
   * rather than economy management.
   */
  abilities: boolean;
}

/** Every commander picks one of these from the match seed. */
export const AI_STRATEGIES: AIStrategy[] = [
  'armour',
  'infantry',
  'air',
  'economy',
  'pressure',
];

const STRATEGY_BIAS: Record<
  AIStrategy,
  { aggression: number; economy: number; tech: number; defence: number }
> = {
  armour: { aggression: 0.07, economy: -0.02, tech: 0.02, defence: 0.02 },
  infantry: { aggression: 0.02, economy: -0.04, tech: -0.06, defence: 0.05 },
  air: { aggression: -0.02, economy: 0.02, tech: 0.18, defence: 0.02 },
  economy: { aggression: -0.12, economy: 0.16, tech: 0.04, defence: 0.06 },
  pressure: { aggression: 0.2, economy: -0.08, tech: -0.04, defence: -0.04 },
};

/** Opening weights, not a fixed sequence: utility decides what is built next. */
const STRATEGY_OPENING: Record<
  AIStrategy,
  { factory: number; refinery: number; barracks: number; air: number; naval: number }
> = {
  armour: { factory: 225, refinery: 190, barracks: 140, air: 8, naval: 4 },
  infantry: { factory: 200, refinery: 180, barracks: 225, air: 2, naval: 0 },
  air: { factory: 218, refinery: 184, barracks: 144, air: 34, naval: 10 },
  economy: { factory: 205, refinery: 235, barracks: 150, air: 4, naval: 8 },
  pressure: { factory: 205, refinery: 180, barracks: 230, air: 0, naval: 0 },
};

/** Army composition the commander naturally favours. */
const STRATEGY_ARMY: Record<AIStrategy, ArmyWeights> = {
  armour: { armour: 0.52, antiArmour: 0.28, infantry: 0.2 },
  infantry: { armour: 0.18, antiArmour: 0.24, infantry: 0.58 },
  air: { armour: 0.36, antiArmour: 0.3, infantry: 0.34 },
  economy: { armour: 0.38, antiArmour: 0.3, infantry: 0.32 },
  pressure: { armour: 0.3, antiArmour: 0.26, infantry: 0.44 },
};

const clamp01 = (value: number): number => Math.max(0.05, Math.min(0.95, value));

/**
 * How strongly a commander's authored doctrine bends one decision.
 *
 * Bounded on purpose. A preference is a thumb on the scale, never a veto: the
 * planner still decides what is legal, affordable and necessary, so a commander
 * that loves artillery still answers a brownout and still builds the economy its
 * plan needs. With no commander the weight is exactly 1, which is what keeps the
 * legacy path byte-identical rather than merely similar.
 */
function commanderWeight(
  commanderId: string | undefined,
  kind: 'production' | 'build',
  slotId: string,
): number {
  if (!commanderId) return 1;
  const entry = commanderById(commanderId);
  if (!entry) return 1;
  const table =
    kind === 'production' ? entry.productionWeights : (entry.buildWeights ?? {});
  const raw = table[slotId];
  if (raw === undefined) return 1;
  return Math.max(0.7, Math.min(1.7, raw));
}

/** A listed research priority lifts that node; the first choice lifts it most. */
function commanderResearchBoost(commanderId: string | undefined, techId: string): number {
  if (!commanderId) return 1;
  const entry = commanderById(commanderId);
  if (!entry) return 1;
  const index = entry.research.indexOf(techId);
  if (index < 0) return 1;
  return index === 0 ? 1.4 : index === 1 ? 1.25 : 1.15;
}

function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function unitHash(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const value of values) h = mix32(h ^ (value | 0));
  return h / 0xffffffff;
}

/**
 * How close to the command post an attacker has to be before a commander that
 * watches its own base calls the wave home. Small on purpose: it is the base
 * under fire, not contact anywhere on the map, that cancels an assault.
 */
const RECALL_RING = 18;
/** A wave further out than this cannot return in time and keeps pressing. */
const RECALL_RANGE = 45;
/**
 * How much better a new contact has to score before a commanded AI abandons the
 * one it is already marching on. Enough to stop two comparable targets from
 * swapping places every think, small enough that a genuinely better target is
 * still taken.
 */
const TARGET_SWITCH_MARGIN = 1.08;

/**
 * Execution quality: what a level adds to a decided doctrine.
 *
 * This is judgement, not power. A recruit mis-reads the value of a contact by a
 * deterministic fraction and answers the nearest raid rather than the most
 * dangerous one; an elite reads contacts accurately, weighs which threat would
 * actually hurt, and refuses a wave that is outmatched. Nothing here touches
 * vision, income, prices or combat stats, and none of it is random: the error is
 * a hash of the entity id, so a fixed scenario replays exactly.
 */
interface ExecutionProfile {
  /** Deterministic error applied to a contact's value. 0 is perfect reading. */
  targetNoise: number;
  /** Evidence mass needed before an opponent tendency is accepted. */
  recognitionMass: number;
  /** How far the leading class must lead the runner-up, as a ratio. */
  recognitionLead: number;
  /** Half-life, in seconds, of what the commander remembers. */
  memoryHalfLife: number;
  /** How long a committed wave is given before its outcome is judged. */
  assaultReviewTicks: number;
  /** Consecutive failed waves needed before the commander changes its approach. */
  setbackTolerance: number;
  /** Whether a raid is ranked by the damage it can do instead of pure distance. */
  dangerFocus: boolean;
  /** Whether the launch gate accounts for the force actually scouted. */
  readsReadiness: boolean;
}

const EXECUTION: Record<AIDifficulty, ExecutionProfile> = {
  recruit: {
    targetNoise: 0.22,
    dangerFocus: false,
    readsReadiness: false,
    recognitionMass: 14,
    recognitionLead: 1.6,
    memoryHalfLife: 30,
    assaultReviewTicks: 20 * 45,
    setbackTolerance: 99,
  },
  // Veteran is the reference reading: it evaluates a contact correctly. Its
  // weaker judgement, relative to elite, is in which threat it answers and in
  // how it weighs a wave against the scouted force, not in misvaluing targets.
  veteran: {
    targetNoise: 0,
    dangerFocus: false,
    readsReadiness: false,
    recognitionMass: 7,
    recognitionLead: 1.35,
    memoryHalfLife: 15,
    assaultReviewTicks: 20 * 30,
    setbackTolerance: 2,
  },
  elite: {
    targetNoise: 0,
    dangerFocus: true,
    readsReadiness: true,
    recognitionMass: 4,
    recognitionLead: 1.25,
    memoryHalfLife: 10,
    assaultReviewTicks: 20 * 22,
    setbackTolerance: 1,
  },
};

const NEUTRAL_EXECUTION: ExecutionProfile = Object.freeze({
  targetNoise: 0,
  dangerFocus: false,
  readsReadiness: false,
  recognitionMass: Number.POSITIVE_INFINITY,
  recognitionLead: Number.POSITIVE_INFINITY,
  memoryHalfLife: 15,
  assaultReviewTicks: 20 * 30,
  setbackTolerance: Number.POSITIVE_INFINITY,
});

/** What answering each recognised tendency does to the existing production plan. */
const ADAPT_PRODUCTION: Partial<
  Record<OpponentTendency, Readonly<Record<string, number>>>
> = Object.freeze({
  armour: { atgm: 1.25, td: 1.15 },
  infantry: { rifle: 1.2, apc: 1.1 },
  antiArmour: { rifle: 1.1, tank: 1.1 },
  artillery: { recon: 1.2, td: 1.1 },
  air: { aa: 1.3, manpadsTeam: 1.2, fighter: 1.15 },
  naval: { submarine: 1.2, frigate: 1.15 },
  fortified: { spg: 1.25, rocketArtillery: 1.2 },
  economy: { recon: 1.15 },
});

/** What answering each recognised tendency does to target preference. */
const ADAPT_TARGETS: Partial<
  Record<OpponentTendency, Partial<Record<CommanderTargetCategory, number>>>
> = Object.freeze({
  armour: { combat: 1.1 },
  infantry: { combat: 1.05 },
  antiArmour: { support: 1.1 },
  artillery: { fireSupport: 1.15 },
  air: { air: 1.1 },
  naval: { naval: 1.1 },
  fortified: { defence: 1.2 },
  economy: { economy: 1.2 },
});

/**
 * The classes that may move a decision, strongest first.
 *
 * A read carries every class with real evidence, so an armoured push covered by
 * artillery is answered as two problems rather than one. Saves written before
 * this field existed fall back to their single primary tendency.
 */
function supportedTendencies(read: OpponentRead): { tendency: OpponentTendency; share: number }[] {
  if (read.tendencies?.length) return read.tendencies;
  return read.tendency ? [{ tendency: read.tendency, share: 1 }] : [];
}

/**
 * Bounded adaptation on top of the commander's own weights.
 *
 * Each supported class contributes in proportion to its share of the evidence,
 * so a close split produces a mild answer instead of a coin-flip winner. The
 * whole term is clamped, which is what keeps a recognised opponent from
 * outweighing the commander who is doing the recognising.
 */
export function adaptProduction(read: OpponentRead | undefined, slotId: string): number {
  if (!read) return 1;
  let total = 1;
  for (const { tendency, share } of supportedTendencies(read)) {
    const weight = ADAPT_PRODUCTION[tendency]?.[slotId];
    if (weight === undefined) continue;
    total += (weight - 1) * share * read.confidence;
  }
  return Math.max(0.85, Math.min(1.3, total));
}

function adaptTarget(
  read: OpponentRead | undefined,
  category: CommanderTargetCategory,
): number {
  if (!read) return 1;
  let total = 1;
  for (const { tendency, share } of supportedTendencies(read)) {
    const weight = ADAPT_TARGETS[tendency]?.[category];
    if (weight === undefined) continue;
    // Half strength on purpose. Target classes sit much closer together than
    // production slots (100 against 95 against 70), so the same nudge that is
    // proportionate on a build priority would decide the campaign for the
    // commander. Recognition sharpens the reading; it does not choose it.
    total += (weight - 1) * share * read.confidence * 0.5;
  }
  return Math.max(0.9, Math.min(1.2, total));
}

/** Which class of investment an identified contact represents, if any. */
function opponentTendencyOf(enemy: KnownEnemy): OpponentTendency | null {
  if (enemy.kind === 'building') {
    const def = BUILDINGS[enemy.defId];
    if (!def) return null;
    if (def.refinery) return 'economy';
    if (!def.produces && !def.commandPost) return 'fortified';
    return null;
  }
  const def = UNITS[enemy.defId];
  if (!def) return null;
  if (def.domain === 'air') return 'air';
  if (def.domain === 'naval') return 'naval';
  const family = unitFamily(enemy.defId);
  if (family === 'harvester') return 'economy';
  if (family === 'atgm' || family === 'td') return 'antiArmour';
  if (family === 'spg' || family === 'rocketArtillery' || family === 'mlrs') return 'artillery';
  if (def.armour === 'infantry') return 'infantry';
  if (def.weapons.length > 0) return 'armour';
  return null;
}

/**
 * Which preference class a known contact belongs to.
 *
 * Reads the same definitions the scorer already reads, so the categories cannot
 * drift from what the simulation considers a production building or an
 * anti-armour vehicle. Unknown definitions fall back to `combat`, which is the
 * neutral class for anything armed.
 */
function contactCategory(enemy: KnownEnemy): CommanderTargetCategory {
  if (enemy.kind === 'building') {
    const def = BUILDINGS[enemy.defId];
    if (def?.commandPost) return 'command';
    if (def?.produces) return 'production';
    if (def?.refinery) return 'economy';
    return 'defence';
  }
  const def = UNITS[enemy.defId];
  if (!def) return 'combat';
  if (def.domain === 'air') return 'air';
  if (def.domain === 'naval') return 'naval';
  const family = unitFamily(enemy.defId);
  if (family === 'harvester') return 'economy';
  if (family === 'recon' || family === 'uav' || family === 'pathfinder') return 'recon';
  if (family === 'aa') return 'airDefence';
  if (family === 'spg' || family === 'rocketArtillery' || family === 'mlrs') return 'fireSupport';
  if (family === 'engineer' || family === 'medic' || family === 'recovery') return 'support';
  return 'combat';
}

/**
 * How much a raider actually threatens the base.
 *
 * Armament dominates, damage it has already taken counts for less, and distance
 * is a tiebreak rather than the whole answer. Used only when a level ranks
 * threats by consequence; the default reading stays nearest-first.
 */
function threatDanger(entity: Entity, baseX: number, baseZ: number): number {
  const armed = entityWeapons(entity).length > 0 ? 40 : 0;
  const hurt = entity.maxHp > 0 ? 1 - entity.hp / entity.maxHp : 0;
  return armed + hurt * 25 - dist(entity.x, entity.z, baseX, baseZ) / TILE_SIZE * 1.5;
}

const DIFFICULTY_BIAS: Record<
  AIDifficulty,
  {
    aggression: number;
    economy: number;
    tech: number;
    defence: number;
    armyScale: number;
    reactionTicks: number;
    responseWeight: number;
    commitShare: number;
    reserve: number;
    recall: boolean;
    protectEconomy: boolean;
    abilities: boolean;
  }
> = {
  // Same planner, same resources and vision: a level changes judgement, never
  // income. A recruit decides every four and a half seconds, runs the thinnest
  // economy, never expands it and never fortifies, presses early with a small
  // army that ignores what it scouted, and never turns that wave around: its
  // base is on its own. A veteran is the baseline —
  // it decides every second, counters what it scouted and recalls a committed
  // wave when its command post itself comes under fire. An elite decides more
  // than twice a second, keeps two units on station, spends its economy bias on
  // units rather than static guns and commits a coordinated wave sooner.
  //
  // The recall (and the elite guard) exist because the ladder used to be decided
  // by knockouts: no level could answer a strike force once its wave had left,
  // so a recruit-level rush lifted a veteran command post in half its matches
  // and the measured gap collapsed to a coin flip. With both higher levels
  // defending, the margin has to come from judgement again — which is why the
  // elite's economy and defence biases are small here: on a 600-second arena
  // every material spent on infrastructure the veteran does not buy is tempo
  // given away, and an elite that invests like a turtle loses the attrition war
  // it should win.
  recruit: {
    aggression: 0.16,
    economy: -0.4,
    tech: -0.24,
    defence: -0.12,
    armyScale: 0.65,
    reactionTicks: 90,
    responseWeight: 0.15,
    commitShare: 0.35,
    reserve: 0,
    recall: false,
    protectEconomy: false,
    // A novice fights with the plain weapon: smoke, hull-down and breaking
    // contact are drills that have to be ordered at the right moment.
    abilities: false,
  },
  veteran: {
    aggression: 0,
    economy: 0,
    tech: 0,
    defence: 0,
    armyScale: 1,
    reactionTicks: 20,
    responseWeight: 0.55,
    commitShare: 1,
    reserve: 0,
    recall: true,
    protectEconomy: true,
    abilities: true,
  },
  elite: {
    aggression: 0,
    economy: 0.15,
    tech: 0.2,
    defence: 0.05,
    armyScale: 1.15,
    reactionTicks: 8,
    responseWeight: 0.95,
    commitShare: 0.85,
    reserve: 2,
    recall: true,
    protectEconomy: true,
    abilities: true,
  },
};

/**
 * Seeded personality: a different match seed fields a different commander.
 *
 * An explicitly chosen commander replaces the seed-selected temperament with its
 * authored scalars, and the difficulty level is then applied on top exactly as
 * it is for the seeded path: the level still owns cadence, scouting response,
 * commit share, recall and abilities, so one commander is recognisable at every
 * level while the level remains the measure of execution quality.
 *
 * No `commanderId` means the legacy path, unchanged and seed-deterministic.
 */
export function aiProfile(
  seed: number,
  difficulty: AIDifficulty = 'veteran',
  commanderId?: string,
): AIProfile {
  const level = DIFFICULTY_BIAS[difficulty] ?? DIFFICULTY_BIAS.veteran;
  const authored = commanderId ? resolveCommander(undefined, commanderId) : undefined;
  if (authored) {
    const clamp25 = (value: number): number => Math.max(0.5, Math.min(1.25, value));
    return {
      difficulty,
      strategy: authored.strategy,
      aggression: clamp01(authored.aggression + level.aggression),
      economy: clamp01(authored.economy + level.economy),
      tech: clamp01(authored.tech + level.tech),
      defence: clamp01(authored.defence + level.defence),
      armyScale: clamp25(authored.armyScale * level.armyScale),
      reactionTicks: Math.max(4, Math.round(level.reactionTicks * authored.tempoFactor)),
      responseWeight: clamp01(level.responseWeight * authored.responseFactor),
      commitShare: clamp01(level.commitShare * authored.commitFactor),
      reserve: Math.min(6, authored.reserve + level.reserve),
      // The level still has the last word: a recruit commander does not recall its
      // wave or protect its haulers even when its personality normally would.
      recall: level.recall && authored.recall,
      protectEconomy: level.protectEconomy && authored.protectEconomy,
      abilities: level.abilities && authored.abilities,
    };
  }
  const h = mix32(seed ^ 0x51ed270b);
  const strategy = AI_STRATEGIES[mix32(seed ^ 0x2b7e1516) % AI_STRATEGIES.length];
  const bias = STRATEGY_BIAS[strategy];
  return {
    difficulty,
    strategy,
    aggression: clamp01(
      0.36 + ((h & 0xff) / 255) * 0.46 + bias.aggression + level.aggression,
    ),
    economy: clamp01(
      0.36 + (((h >>> 8) & 0xff) / 255) * 0.46 + bias.economy + level.economy,
    ),
    tech: clamp01(
      0.34 + (((h >>> 16) & 0xff) / 255) * 0.46 + bias.tech + level.tech,
    ),
    defence: clamp01(
      0.32 + (((h >>> 24) & 0xff) / 255) * 0.46 + bias.defence + level.defence,
    ),
    armyScale: level.armyScale,
    reactionTicks: level.reactionTicks,
    responseWeight: level.responseWeight,
    commitShare: level.commitShare,
    reserve: level.reserve,
    recall: level.recall,
    protectEconomy: level.protectEconomy,
    abilities: level.abilities,
  };
}

/** Opposing army size raises the reserve; aggression lowers the gate. */
export function desiredArmySize(
  enemyMilitary: number,
  wave: number,
  aggression: number,
  armyScale = 1,
): number {
  const threat = Math.min(10, enemyMilitary * 0.5);
  const drive = (Math.max(0, Math.min(1, aggression)) - 0.5) * 6;
  const base = 6 + threat + Math.min(4, wave * 0.5) - drive;
  return Math.max(4, Math.min(20, Math.round(base * Math.max(0.5, Math.min(1.25, armyScale)))));
}

export interface ArmyWeights {
  armour: number;
  antiArmour: number;
  infantry: number;
}

/** Responsive composition floor rather than fixed unit counts. */
export function armyWeights(mix: ScoutedForceMix): ArmyWeights {
  const total = mix.armour + mix.infantry;
  if (total <= 0) return { armour: 0.34, antiArmour: 0.28, infantry: 0.38 };
  const armourShare = mix.armour / total;
  const infantryShare = mix.infantry / total;
  const raw = {
    armour: 0.26 + armourShare * 0.28,
    antiArmour: 0.2 + armourShare * 0.38,
    infantry: 0.22 + infantryShare * 0.34,
  };
  const sum = raw.armour + raw.antiArmour + raw.infantry;
  return {
    armour: raw.armour / sum,
    antiArmour: raw.antiArmour / sum,
    infantry: raw.infantry / sum,
  };
}

/** Blend the commander's preference with the force actually being scouted. */
function blendWeights(base: ArmyWeights, response: ArmyWeights, responseWeight = 0.55): ArmyWeights {
  const w = Math.max(0, Math.min(1, responseWeight));
  const raw = {
    armour: base.armour * (1 - w) + response.armour * w,
    antiArmour: base.antiArmour * (1 - w) + response.antiArmour * w,
    infantry: base.infantry * (1 - w) + response.infantry * w,
  };
  const sum = raw.armour + raw.antiArmour + raw.infantry || 1;
  return {
    armour: raw.armour / sum,
    antiArmour: raw.antiArmour / sum,
    infantry: raw.infantry / sum,
  };
}

/* -------------------------------------------------------------------------- */
/* Research policy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Everything the research planner is allowed to know.
 *
 * Every field is derived from the commander's own state or from contacts it has
 * actually identified — its own units and structures, its bank, the force it has
 * scouted and the match clock. There is no opponent bank, no fogged unit and no
 * opposing research here, so a technology cannot be chosen from information the
 * AI could not have observed.
 */
export interface ResearchSignals {
  /** Match seed: selects the commander's per-branch bias. */
  seed: number;
  tick: number;
  /** Authored match limit, or null when the match has none. */
  timeLimitSec: number | null;
  /** Technologies this commander has already finished. */
  completed: readonly string[];
  /** Owned units by canonical family. */
  unitCounts: ReadonlyMap<string, number>;
  /** Complete structures by canonical family. */
  buildingCounts: ReadonlyMap<string, number>;
  /** Canonical unit families this nation's roster actually fields. */
  rosterUnits: ReadonlySet<string>;
  /** Technology ids this nation's national exclusives need, if any. */
  exclusiveTechs: ReadonlySet<string>;
  profile: AIProfile;
  strategy: AIStrategy;
  /** Hostile force the commander has identified. */
  mix: ScoutedForceMix;
  enemyAir: number;
  enemyNaval: number;
  /** Known enemy structures that shoot or shelter infantry. */
  fortified: number;
  hasWater: boolean;
  /**
   * The commander's own grid is short enough that a retrofit would pay off.
   * Optional so a caller that only cares about units can leave it out; absent
   * reads as "no strain", which is the conservative answer.
   */
  gridStrain?: boolean;
  /**
   * Technologies that gate this commander's national strategic capability.
   * Empty for a nation with none, and for a battle that forbids them, so this
   * never becomes a reason to study a node the match has switched off.
   */
  superweaponTechs?: readonly string[];
  /**
   * Branches this commander has already opened, counted as completed nodes that
   * grant a structure. Zero means the only study behind it is the branch it
   * started the match with, which is exactly when a second tier is worth less
   * than a first one.
   */
  openedBranches?: number;
}

export interface ResearchOption {
  techId: string;
  score: number;
  /** Short human-readable justification, also used for the AI decision line. */
  reason: string;
}

/**
 * A technology is worth queueing above this score. The scale is deliberately
 * small and readable: a `1.0` node fills one clear battlefield need for a
 * commander that values the branch, so the floor sits below that and above
 * noise.
 */
export const RESEARCH_MIN_SCORE = 0.55;

/** Doctrine fit per branch: what the commander naturally invests in. */
const BRANCH_FIT: Record<AIStrategy, Record<ResearchBranch, number>> = {
  armour: { manoeuvre: 1.25, fires: 1.0, air: 0.8, naval: 0.8 },
  infantry: { manoeuvre: 0.9, fires: 1.1, air: 0.85, naval: 0.8 },
  air: { manoeuvre: 0.95, fires: 0.95, air: 1.3, naval: 0.85 },
  economy: { manoeuvre: 1.05, fires: 1.0, air: 1.0, naval: 1.0 },
  pressure: { manoeuvre: 1.1, fires: 1.15, air: 0.85, naval: 0.75 },
};

/** Base demand per canonical unit slot before the battlefield adjusts it. */
const SLOT_BASE: Readonly<Record<string, number>> = Object.freeze({
  tank: 1.0,
  ifv: 0.5,
  td: 0.55,
  manpadsTeam: 0.12,
  ewVehicle: 0.1,
  // A howitzer is a first-line arm of a combined-arms battlegroup, not only an
  // answer to a bunker. At 0.6 the branch lost every comparison to an airfield
  // on an open map — nothing had been fortified yet, so indirect fire was never
  // studied and the national artillery kits never reached the field. It still
  // trails the tank, which is what a commander builds its line around.
  spg: 0.8,
  rocketArtillery: 0.55,
  uav: 0.45,
  interceptor: 0.35,
  fighter: 0.4,
  attackHelo: 0.35,
  loiteringMunition: 0.12,
  missileBoat: 0.3,
  corvette: 0.35,
  frigate: 0.3,
  submarine: 0.3,
  navalSupport: 0.25,
});

/** Slots that only exist once an airfield stands. */
const AIR_SLOTS: ReadonlySet<string> = new Set([
  'interceptor',
  'fighter',
  'attackHelo',
  'loiteringMunition',
]);

/** Slots that only make sense on a map with water. */
const NAVAL_SLOTS: ReadonlySet<string> = new Set([
  'missileBoat',
  'corvette',
  'frigate',
  'submarine',
  'navalSupport',
]);

/** Stable per-commander branch bias, so two seeds do not open identically. */
function branchAffinity(seed: number, branch: ResearchBranch): number {
  const index = RESEARCH_BRANCHES.indexOf(branch);
  return 0.9 + unitHash(seed, 0x7265 + index) * 0.2;
}

/** How badly the commander wants one unit role, given what it has seen. */
function slotDemand(slot: string, signals: ResearchSignals): number {
  if (!signals.rosterUnits.has(slot)) return 0;
  if (NAVAL_SLOTS.has(slot) && !signals.hasWater) return 0;
  const base = SLOT_BASE[slot] ?? 0.25;
  const scouted = signals.mix.armour + signals.mix.infantry;
  const armourShare = scouted > 0 ? signals.mix.armour / scouted : 0.5;
  let demand = base;
  switch (slot) {
    case 'tank':
      demand += 0.25 * armourShare;
      break;
    case 'td':
      demand += 0.7 * armourShare;
      break;
    case 'attackHelo':
      demand += 0.45 * armourShare;
      break;
    case 'spg':
      demand += signals.fortified > 0 ? 0.5 : 0.15;
      break;
    case 'rocketArtillery':
      demand += signals.fortified > 0 ? 0.4 : 0;
      demand += signals.mix.infantry >= 4 ? 0.2 : 0;
      break;
    case 'interceptor':
    case 'fighter':
      demand += 0.6 * Math.min(1, signals.enemyAir / 2);
      break;
    case 'manpadsTeam':
      // Organic air defence follows the air threat but never replaces the
      // vehicle-mounted umbrella; it is the cheap answer that can hide forward.
      demand += 0.45 * Math.min(1, signals.enemyAir / 2);
      break;
    case 'ewVehicle':
      // A jammer is worth most against a commander that is actually fielding
      // sensors and aircraft, and is otherwise a support hull with a machine gun.
      demand += 0.3 * Math.min(1, signals.enemyAir / 2);
      break;
    case 'loiteringMunition':
      // One-way attack is a tool for cracking prepared positions and armour;
      // without a target worth the airframe the commander still keeps a token
      // handful for opportunistic tasking.
      demand += signals.fortified > 0 ? 0.35 : 0.1;
      break;
    case 'uav':
      demand += (signals.unitCounts.get('recon') ?? 0) === 0 ? 0.2 : 0;
      break;
    case 'missileBoat':
    case 'corvette':
    case 'frigate':
    case 'submarine':
    case 'navalSupport':
      demand += 0.6 * Math.min(1, signals.enemyNaval / 2);
      break;
    default:
      break;
  }
  // A facility the commander already paid for is a sunk investment: the aircraft
  // or hull it can launch is worth more than one the commander would have to
  // build the facility for first. This is what makes an airfield turn into a
  // strike wing instead of a warehouse with a radar dish on it. A helicopter
  // counts a heliport as its own facility — an airfield only recovers one.
  if (
    AIR_SLOTS.has(slot) &&
    ((signals.buildingCounts.get('airfield') ?? 0) > 0 ||
      (signals.buildingCounts.get('heliport') ?? 0) > 0)
  ) {
    demand *= 1.35;
  }
  if (NAVAL_SLOTS.has(slot) && (signals.buildingCounts.get('shipyard') ?? 0) > 0) {
    demand *= 1.35;
  }
  // A role the army already fields in numbers is worth less than an empty one.
  const owned = signals.unitCounts.get(slot) ?? 0;
  return demand * Math.max(0.35, 1 - owned / 8);
}

/** Demand for a structure unlock, which is a facility rather than a unit. */
function buildingDemand(slot: string, signals: ResearchSignals): number {
  const owned = signals.buildingCounts.get(slot) ?? 0;
  if (slot === 'shipyard') {
    if (!signals.hasWater) return 0;
    // A fleet is an answer to a fleet first and a coastal option second. With
    // nothing hostile on the water, the yard is a hedge against an enemy that may
    // never appear — so it queues behind the artillery that fights the land battle
    // the commander is actually in. A sighted hull, or several, puts it ahead.
    return (0.32 + 0.35 * Math.min(1, signals.enemyNaval)) * (owned > 0 ? 0.3 : 1);
  }
  if (slot === 'airfield') {
    return (0.5 + (signals.enemyAir > 0 ? 0.3 : 0)) * (owned > 0 ? 0.3 : 1);
  }
  return owned > 0 ? 0 : 0.3;
}

/**
 * How much of a project's value survives the match that is left.
 *
 * With an authored limit the planner compares the remaining clock to the
 * research time, so a 90-second project ordered in the last minute is worth
 * little. Without one it decays gently after ten minutes, when either side is
 * usually close to a decision.
 */
function researchTimeFactor(tech: TechDef, signals: ResearchSignals): number {
  const elapsed = signals.tick / 20;
  if (signals.timeLimitSec !== null) {
    const remaining = signals.timeLimitSec - elapsed;
    if (remaining <= 0) return 0;
    return Math.max(0.2, Math.min(1, remaining / Math.max(1, tech.seconds * 1.2)));
  }
  if (elapsed <= 600) return 1;
  return Math.max(0.6, 1 - (elapsed - 600) / 2400);
}

/**
 * What a researched *ability* is worth to this commander.
 *
 * An upgrade is only worth studying if it has a working gameplay pathway — the
 * same question the selection box asks — and if the army holds hulls that could
 * use it. Two of them make it a habit rather than a novelty, and an identified
 * armoured force is exactly what a smoke screen is for.
 */
function upgradeDemand(upgradeId: string, signals: ResearchSignals): number {
  if (!upgradePlayable(upgradeId)) return 0;
  const upgrade = unitUpgradeDef(upgradeId);
  if (!upgrade) return 0;
  const slots = upgrade.eligibleSlots.filter((slot) => signals.rosterUnits.has(slot));
  if (slots.length === 0) return 0;
  let owned = 0;
  for (const slot of slots) owned += signals.unitCounts.get(slot) ?? 0;
  let demand = 0.5;
  if (owned >= 2) demand += 0.25;
  if (signals.mix.armour > 0) demand += 0.2 * Math.min(1, signals.mix.armour / 4);
  return demand;
}

/**
 * Modules with a working purchase path. A module the player cannot install is
 * worth nothing to study, for the same reason an unimplemented ability is: the
 * research would buy a capability nothing can use.
 */
const PLAYABLE_MODULES: ReadonlySet<string> = new Set([
  'advancedTurbine',
  'assemblyLine',
  'fireControlNet',
  'flightlineMaintenance',
  'harbourSonar',
]);

/**
 * What a researched *module* is worth to this commander.
 *
 * A retrofit only pays for itself where the grid is the limiter and the
 * commander already owns something to fit it to. A healthy grid makes the
 * technology worthless to study: the same materials buy another hull.
 */
function moduleDemand(moduleId: string, signals: ResearchSignals): number {
  if (!PLAYABLE_MODULES.has(moduleId)) return 0;
  const module = buildingModuleDef(moduleId);
  if (!module) return 0;
  const slots = module.eligibleSlots.filter((slot) => (signals.buildingCounts.get(slot) ?? 0) > 0);
  if (slots.length === 0) return 0;
  // A generation retrofit only pays where the grid is the limiter. The rest are
  // capability purchases with their own value: a second servicing crew at a
  // flightline the commander already operates, a sonar suite under a yard on a
  // coastal map, a production line in an existing factory. None of them need a
  // brownout to be worth studying, and none of them are bought before the
  // structure they fit exists.
  if (module.effects.some((effect) => effect.kind === 'power' && effect.amount > 0)) {
    return signals.gridStrain ? 0.6 : 0;
  }
  if (module.effects.some((effect) => effect.kind === 'sonar')) {
    if (!signals.hasWater) return 0;
    // A sonar suite is worth studying when there is something under the water to
    // find. On a coast nobody has contested it is a harbour fitting, not a reason
    // to open the naval branch ahead of the artillery.
    return signals.enemyNaval > 0 ? 0.45 : 0.2;
  }
  if (module.effects.some((effect) => effect.kind === 'serviceSpeed')) return 0.35;
  if (module.effects.some((effect) => effect.kind === 'productionSpeed')) return 0.3;
  if (module.effects.some((effect) => effect.kind === 'vision')) return 0.2;
  return 0;
}

/**
 * Score one technology for this commander, or return zero with a reason.
 *
 * The model is a product of three readable parts:
 *   demand — what the unlock is worth to the army the commander actually has;
 *   fit    — how well the branch matches doctrine, this seed and this level;
 *   time   — whether the project can still pay off, including its duration.
 *
 * Affordability, the army reserve and the single-project rule are decisions
 * about *when* to start, so they live in the controller rather than in the
 * score. A technology whose only effects are an unimplemented unit upgrade or a
 * building module still scores zero on purpose: there is nothing the commander
 * could do with the capability, and `upgradeDemand` refuses the same way.
 */
export function researchOptionScore(
  tech: TechDef,
  signals: ResearchSignals,
): ResearchOption {
  if (signals.completed.includes(tech.id)) {
    return { techId: tech.id, score: 0, reason: 'already researched' };
  }
  if (tech.requires.some((id) => !signals.completed.includes(id))) {
    return { techId: tech.id, score: 0, reason: 'prerequisite incomplete' };
  }
  let demand = 0;
  let unusable = 0;
  const reasons: string[] = [];
  for (const effect of tech.effects) {
    if (effect.kind === 'unlockUnit') {
      const value = slotDemand(effect.slot, signals);
      if (value > 0) {
        demand += value;
        reasons.push(effect.slot);
      }
    } else if (effect.kind === 'unlockBuilding') {
      const value = buildingDemand(effect.slot, signals);
      if (value > 0) {
        demand += value;
        reasons.push(effect.slot);
      }
    } else if (effect.kind === 'grantUnitUpgrade') {
      // An upgrade the commander cannot fire is worth nothing, whatever the
      // catalogue says: Stage 4A published the data, but only an implemented
      // ability is a reason to spend materials on research.
      const value = upgradeDemand(effect.upgrade, signals);
      if (value > 0) {
        demand += value;
        reasons.push(unitUpgradeDef(effect.upgrade)?.name ?? effect.upgrade);
      } else {
        unusable++;
      }
    } else if (effect.kind === 'grantBuildingModule') {
      // Same test for a retrofit: Stage 4C.3 gave the module a purchase path, so
      // it is worth studying when the grid is short and a plant stands to fit
      // it to — and worth nothing in any other situation.
      const value = moduleDemand(effect.module, signals);
      if (value > 0) {
        demand += value;
        reasons.push(buildingModuleDef(effect.module)?.name ?? effect.module);
      } else {
        unusable++;
      }
    } else {
      unusable++;
    }
  }
  // The four nodes behind a national strategic capability publish no unlock of
  // their own, so their value is the capability they unlock together. This is
  // read before the zero check below, because a node with no effects would
  // otherwise look worthless. The demand is real but modest: a commander still
  // wants an army before it wants an authority chain, and the last node is what
  // actually earns the call-in.
  if ((signals.superweaponTechs ?? []).includes(tech.id)) {
    const remaining = (signals.superweaponTechs ?? []).filter(
      (id) => !signals.completed.includes(id),
    ).length;
    demand += remaining <= 1 ? 0.9 : 0.5;
    reasons.push('strategic authority');
  }
  if (demand <= 0) {
    return {
      techId: tech.id,
      score: 0,
      reason: unusable > 0 ? 'no playable effect' : 'no battlefield need',
    };
  }
  // A national exclusive is a capability the shared tree cannot give, so it
  // raises the branch tier that equips it for this nation only.
  if (signals.exclusiveTechs.has(tech.id)) demand += 0.3;
  const fit =
    BRANCH_FIT[signals.strategy][tech.branch] *
    branchAffinity(signals.seed, tech.branch) *
    (0.85 + signals.profile.tech * 0.3);
  const duration = 1 - Math.min(0.2, tech.seconds / 900);
  // Study is breadth-first until the commander has two arms to fight with. A
  // tier-two node deepens a branch the commander already has — often the one it
  // started the match with — while artillery, aviation and the fleet are still
  // a technology away. The kit probe showed what that costs: the first project
  // after the research centre was the second tier of the opening branch, so a
  // national kit reached the field only if the match ran long enough for a third
  // study, and the artillery, airframes and hulls the nations are built around
  // never appeared at all inside ten minutes. A commander therefore opens two
  // branches — the airfield and the yard, or the guns and the airfield — before
  // it deepens either of them.
  const breadth = tech.requires.length > 0 && (signals.openedBranches ?? 0) < 2 ? 0.35 : 1;
  const score = demand * fit * researchTimeFactor(tech, signals) * duration * breadth;
  return {
    techId: tech.id,
    score: Math.round(score * 100) / 100,
    reason: reasons.slice(0, 2).join('+'),
  };
}

/* -------------------------------------------------------------------------- */
/* Controller                                                                 */
/* -------------------------------------------------------------------------- */

/** Fresh controller state for one AI player; shared by Game and matchups. */
export function initialAIState(
  aiSeed: number,
  difficulty: AIDifficulty = 'veteran',
  commanderId?: string,
): AIControlState {
  return {
    nextThinkTick: 10,
    phase: 'opening',
    attackWave: 0,
    lastWaveTick: 0,
    targetBaseX: 0,
    targetBaseZ: 0,
    targetKnown: false,
    groupCounter: 1,
    desiredArmy: 4,
    lastDecision: 'initialising',
    nextBuildTick: 0,
    scouted: false,
    aiSeed,
    aiRng: aiSeed,
    strategy: aiProfile(aiSeed, difficulty, commanderId).strategy,
    difficulty,
    ...(commanderId
      ? { commanderId, commanderProfileVersion: COMMANDER_PROFILE_VERSION }
      : {}),
    lastContactTick: 0,
    lastScoutTick: 0,
    activeSiteId: 0,
    activeSiteProgress: 0,
    activeSiteTick: 0,
  };
}

interface KnownEnemy {
  id: number;
  kind: Entity['kind'];
  defId: string;
  x: number;
  z: number;
  visible: boolean;
  tick: number;
}

interface BuildOption {
  defId: string;
  score: number;
  reason: string;
  /** Essential options may pause unit spending while the AI saves. */
  essential: boolean;
  /**
   * A facility the commander has researched towards. Once most of its price is
   * in hand, unit production leaves the rest of it alone so the unlock it just
   * paid for turns into something on the ground. It never outranks an essential
   * structure, and it does nothing at all until 70% of the price is banked.
   */
  planned?: boolean;
  /**
   * Economy infrastructure — the next drop-off on a saturated field.
   *
   * Waiting for spare cash never gets there: a commander with a field army to
   * replace spends its income the moment it arrives, so the bank never holds
   * enough for the structure that would have doubled it. An economy build is
   * therefore funded by splitting the income, not by waiting for a surplus, and
   * it is the one plan allowed to take a fixed share of every material while a
   * saturated economy is the thing holding the army back.
   */
  economy?: boolean;
}

interface UnitDemand {
  defId: string;
  priority: number;
  deficit: number;
  /** Hulls still missing, the count behind the fractional deficit. */
  short?: number;
  /**
   * Material price to hold back for a planned support arm. Only a demand that
   * carries this field can pause general production while it saves, and only
   * once the bank is already most of the way there.
   */
  saveFor?: number;
}

interface AIContext {
  game: Game;
  aiId: number;
  player: PlayerState;
  st: AIControlState;
  team: number;
  own: Entity[];
  buildings: Entity[];
  complete: Entity[];
  counts: Map<string, number>;
  unitCounts: Map<string, number>;
  engineer?: Entity;
  baseX: number;
  baseZ: number;
  visible: Entity[];
  known: KnownEnemy[];
  threats: Entity[];
  /**
   * The commander's tactical reading, or the neutral profile when it has no
   * authored identity. Resolved once per think, never inside a target loop.
   */
  tactical: TacticalProfile;
  /** Difficulty's contribution to judgement. Neutral on the seeded path. */
  execution: ExecutionProfile;
  /** Decaying read of the opponent, when a commander is observing one. */
  read?: OpponentRead;
  mix: ScoutedForceMix;
  profile: AIProfile;
  strategy: AIStrategy;
  power: ReturnType<Game['powerStatus']>;
  hasWater: boolean;
  combat: Entity[];
  enemyAir: number;
  enemyNaval: number;
  /**
   * Every own hauler is standing in `seek` with an empty hopper while a
   * completed drop-off exists: nothing the commander owns is turning ore into
   * materials right now. Derived from own units only — the same hauler state the
   * HUD shows — so it adds no knowledge the commander does not already have.
   *
   * This is evidence of idle hauling, not proof that the map is exhausted. The
   * income history must also have been zero for three seconds, so the one-tick
   * `seek` after an unload cannot fire it. It is used only to withhold
   * *expansion* demands; it never cancels an order or pauses combat production.
   */
  haulingIdle: boolean;
}

/**
 * A state-driven skirmish opponent. It is given a match seed, never the
 * opponent's position: every target comes from vision or from a remembered
 * contact. The seed selects a commander temperament (armour, infantry, air,
 * economy or pressure) and the planner scores the legal options against its
 * own economy, power grid, scouting report, damage and terrain each second.
 *
 * There is no build-order list. Two matches with different seeds open
 * differently, and the same seed replays exactly because the AI's random
 * stream is part of saved state.
 */
export interface AIControllerOptions {
  /**
   * Stand an assault wave off any blocked destination before ordering it. On by
   * default; the diagnostic tools turn it off to reconstruct the pre-Phase-11
   * aim inside the same build, so an A/B comparison holds every other variable
   * fixed. It is not a gameplay setting and is not saved.
   */
  resolveApproach?: boolean;
}

export class AIController {
  private claimed = new Set<number>();
  private waterCache: boolean | null = null;

  constructor(private readonly options: AIControllerOptions = {}) {}

  update(game: Game, ownerId?: number, controlState?: AIControlState): void {
    this.claimed.clear();
    const ai =
      ownerId === undefined
        ? game.state.players.find((p) => p.isAI && !p.defeated)
        : game.player(ownerId);
    if (!ai || ai.defeated || game.state.victory !== 'playing') return;
    const st = controlState ?? game.state.ai;
    // Older saves do not carry the AI's own seed or strategy. Adopt the match
    // seed once, then keep it in state so save/load replays the same commander.
    st.aiSeed = st.aiSeed ?? game.state.seed;
    st.aiRng = st.aiRng || mix32(st.aiSeed ^ 0x9e3779b9);
    const difficulty: AIDifficulty = DIFFICULTY_BIAS[st.difficulty]
      ? st.difficulty
      : 'veteran';
    st.difficulty = difficulty;
    // Authored commander when one was chosen, seeded temperament otherwise.
    const profile = aiProfile(st.aiSeed, difficulty, st.commanderId);
    // Reaction time is the controller's, not the caller's: the battle loop and
    // the matchup harness both hand it every tick and it decides when to think.
    // A recruit therefore recognises a raid or an empty factory queue later.
    if (game.state.tick < st.nextThinkTick) return;
    const strategy: AIStrategy = STRATEGY_OPENING[st.strategy] ? st.strategy : profile.strategy;
    st.strategy = strategy;

    // A dormant mission group is on the map but not under command yet: it must
    // not be counted, spent, or ordered by the commander until the mission
    // releases it.
    const own = game.entitiesOf(ai.id).filter((e) => e.hp > 0 && !e.missionHold);
    const buildings = own.filter((e) => e.kind === 'building');
    const complete = buildings.filter((e) => !e.construction);
    const hq = complete.find((e) => BUILDINGS[e.defId]?.commandPost);
    const scenarioPlayer = game.state.scenario.players.find((p) => p.id === ai.id);
    const baseX = hq?.x ?? (scenarioPlayer ? (scenarioPlayer.startX + 0.5) * TILE_SIZE : 0);
    const baseZ = hq?.z ?? (scenarioPlayer ? (scenarioPlayer.startZ + 0.5) * TILE_SIZE : 0);

    // Counts are keyed by baseline family, so a national variant answers the
    // same question as the shared unit it replaced ("how many tanks do I have?").
    const counts = new Map<string, number>();
    for (const b of complete) {
      const family = buildingFamily(b.defId);
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    const unitCounts = new Map<string, number>();
    for (const u of own) {
      if (u.kind !== 'unit') continue;
      const family = unitFamily(u.defId);
      unitCounts.set(family, (unitCounts.get(family) ?? 0) + 1);
    }

    const visible = game
      .visibleEnemies(ai.id)
      .filter((e) => e.defId !== 'relay' && !(e.kind === 'unit' && e.garrisonId));
    const known = this.knownEnemies(game, ai.id, visible);
    // How much of the map a commander treats as "my base is under threat". The
    // list is still only what its own units can see; the radius is judgement,
    // not vision, so a wider horizon never reveals a hidden unit.
    const tactical = tacticalProfileFor(st.commanderId) ?? NEUTRAL_TACTICAL;
    const threats = visible.filter(
      (e) => dist(e.x, e.z, baseX, baseZ) < 34 * tactical.threatRadius * TILE_SIZE,
    );
    const engineer = own.find((e) => e.kind === 'unit' && e.defId === 'engineer');
    if (this.waterCache === null) {
      this.waterCache = game.state.scenario.tiles.some(
        (t) => t.t === Terrain.DeepWater || t.t === Terrain.ShallowWater,
      );
    }

    const combat = own.filter((e) => {
      if (e.kind !== 'unit' || e.hp <= 0) return false;
      const family = unitFamily(e.defId);
      if (
        family === 'harvester' ||
        family === 'engineer' ||
        family === 'medic' ||
        family === 'recovery'
      ) {
        return false;
      }
      return (UNITS[e.defId]?.weapons.length ?? 0) > 0;
    });

    // The harvester already scans for a reachable deposit every time it seeks;
    // this reads only the result on the commander's own units. A completed
    // drop-off plus a hauler used to be treated as a working economy even when
    // every hauler was idling on an empty map, which let the planner spend on
    // more haulers and saturation refineries that could never produce. No new
    // state is stored: this is recomputed from the same phase the HUD shows.
    const haulers = own.filter(
      (e) => e.kind === 'unit' && e.hp > 0 && unitFamily(e.defId) === 'harvester',
    );
    const hasDropOff = complete.some((b) => BUILDINGS[b.defId]?.refinery);
    // Confirm with the HUD's existing income history before calling hauling
    // idle: a hauler is in `seek` for one tick after every unload, and acting on
    // that transition would let a momentary post-unload state choose a different
    // production item. Six samples are three seconds at the 0.5 s sample rate —
    // short enough to react to a real stop, long enough to span the unload
    // transition and the controller's think cadence. The history is existing
    // player telemetry, not new state, and it also covers a captured depot.
    const noRecentIncome = ai.incomeHistory.slice(-6).every((v) => v === 0);
    const haulingIdle =
      hasDropOff &&
      haulers.length > 0 &&
      noRecentIncome &&
      haulers.every((e) => {
        const h = e.harvester;
        return !!h && h.phase === 'seek' && h.ore === 0;
      });

    const ctx: AIContext = {
      game,
      aiId: ai.id,
      player: ai,
      st,
      team: game.teamOf(ai.id),
      own,
      buildings,
      complete,
      counts,
      unitCounts,
      engineer,
      baseX,
      baseZ,
      visible,
      known,
      threats,
      tactical,
      // A commanded match gets the level's judgement; the seeded path keeps the
      // behaviour the historical ladder measures.
      execution: st.commanderId ? EXECUTION[difficulty] : NEUTRAL_EXECUTION,
      mix: scoutedForceMix(game, ai.id),
      profile,
      strategy,
      power: game.powerStatus(ai.id),
      hasWater: this.waterCache,
      combat,
      enemyAir: known.filter((e) => UNITS[e.defId]?.domain === 'air').length,
      enemyNaval: known.filter((e) => UNITS[e.defId]?.domain === 'naval').length,
      haulingIdle,
    };
    // Opponent recognition is a commanded behaviour: the seeded path keeps the
    // decisions the historical ladder measures, and never applies adaptation.
    if (st.commanderId) {
      this.updateOpponentRead(ctx);
      ctx.read = st.opponentRead as OpponentRead | undefined;
      this.reviewAssault(ctx);
    }

    this.updateTarget(ctx);
    // A squad staging for a beach has already been committed to that job, so
    // transport tasking runs before shelters and assaults can claim it.
    this.manageTransports(ctx);
    // Reserve a few infantry for nearby cover before general defence tasking
    // claims every combat unit for a direct counter-attack.
    this.manageGarrison(ctx);
    this.defend(ctx);
    this.protectHaulers(ctx);
    this.scout(ctx);
    this.scoutAir(ctx);
    const budget = this.manageConstruction(ctx);
    const afterResearch = this.manageResearch(ctx, budget);
    // Retrofits come after study and before the army: a grid that is already
    // short will throttle the production the budget is about to buy.
    this.manageModules(ctx);
    this.manageProduction(ctx, afterResearch);
    this.manageNaval(ctx);
    this.manageAir(ctx);
    this.captureObjective(ctx);
    // Spent before the assault tasking claims hulls, so a recon troop that is
    // breaking contact still gets its screen away.
    this.useAbilities(ctx);
    // A national capability is spent before the assault tasking, so a strike
    // that is already ready can shape the ground the army is about to cross.
    this.manageSuperweapon(ctx);
    this.offensive(ctx);
    // Scheduled after the think so the decision sees the same clock state that
    // the old fixed-cadence loop exposed.
    st.nextThinkTick = game.state.tick + profile.reactionTicks;
  }

  /* ---------------------------------------------------------------------- */
  /* Abilities                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Situational use of researched unit abilities.
   *
   * Smoke exists to break a sight line, so the commander spends it on a recon
   * troop that is actually in trouble: damaged, with a hostile inside its own
   * engagement envelope, and not already standing in a cloud. Every other case
   * keeps the discharger loaded, and the hull's own reload stops it being used
   * twice. Nothing here reads hidden state — `visible` is the same sighting list
   * the rest of the planner uses — and the order goes through the ordinary
   * command queue, so the simulation still decides whether it was legal.
   */
  private useAbilities(ctx: AIContext): void {
    if (!ctx.profile.abilities) return;
    const abilityIds = Object.keys(UNIT_ABILITIES);
    if (abilityIds.length === 0 || ctx.visible.length === 0) return;
    for (const unit of ctx.own) {
      if (unit.kind !== 'unit' || unit.hp <= 0) continue;
      for (const abilityId of abilityIds) {
        const def = UNIT_ABILITIES[abilityId];
        if (!def) continue;
        // A running effect is not re-cast. Asking the simulation is cheaper than
        // teaching the planner a second copy of every duration.
        if (ctx.game.effectRemaining(unit.id, abilityId) > 0) continue;
        const status = ctx.game.abilityStatus(ctx.aiId, unit.id, abilityId);
        if (!status.ok) continue;
        if (!this.wantsAbility(ctx, unit, def)) continue;
        ctx.game.enqueueCommand({
          type: 'useAbility',
          team: ctx.team,
          unitId: unit.id,
          abilityId,
        });
        // One capability per hull per think: a crew that has just committed is
        // not asked to commit again on the same tick.
        break;
      }
    }
  }

  /**
   * Whether the tactical picture justifies one specific ability.
   *
   * Every test reads `ctx.visible`, the same sighting list the rest of the
   * planner uses, so the AI never buys an effect with information it has not
   * earned. Each catalogue entry names its own condition, which keeps the smoke
   * behaviour exactly as it was while the new capabilities get equally narrow
   * triggers rather than a generic "use whatever is off cooldown".
   */
  private wantsAbility(ctx: AIContext, unit: Entity, def: UnitAbilityDef): boolean {
    const near = (e: Entity, tiles: number): boolean =>
      e.hp > 0 && dist(e.x, e.z, unit.x, unit.z) <= tiles * TILE_SIZE;
    const hurt = unit.hp <= unit.maxHp * 0.55;
    const engaged = unit.hp <= unit.maxHp * 0.6;
    const weapons = entityWeapons(unit);
    const reach = weapons.reduce((best, weapon) => Math.max(best, weapon.range), 0);
    switch (def.ai) {
      case 'screenContact':
        // Smoke exists to break a sight line, so the commander spends it on a
        // hull that is actually in trouble and not already under its own cloud.
        if (!hurt) return false;
        if (ctx.game.smokeCoversPoint(unit.x, unit.z)) return false;
        return ctx.visible.some((enemy) => near(enemy, 9));
      case 'holdPosition':
        // Hull-down is a commitment to a position, so a moving hull does not
        // take it, and a hull nobody is shooting at has no reason to accept the
        // loss of mobility.
        if (unit.state === 'moving') return false;
        if (ctx.game.state.tick - unit.lastHitTick > 60) return false;
        return ctx.visible.some((enemy) => near(enemy, 12));
      case 'breakContact':
        if (!engaged) return false;
        return ctx.visible.some((enemy) => near(enemy, 8));
      case 'missileThreat':
        // Only a guided launcher already in range is worth the hard-kill burst.
        return ctx.visible.some(
          (enemy) =>
            near(enemy, 14) && entityWeapons(enemy).some((weapon) => isGuidedWeapon(weapon)),
        );
      case 'airThreat':
        return ctx.visible.some(
          (enemy) => near(enemy, 16) && entityWeapons(enemy).some((weapon) => !!weapon.antiAir),
        );
      case 'subHunt':
        // A surface escort pings when hostile hulls are about; the sweep is the
        // answer to a boat it cannot see yet, which is exactly why it is spent
        // on a suspected contact rather than a confirmed one.
        if ((UNITS[unit.defId]?.sonar ?? 0) <= 0) return false;
        return ctx.visible.some(
          (enemy) => near(enemy, 20) && UNITS[enemy.defId]?.domain === 'naval',
        );
      case 'firesOnTarget': {
        // A battery that is already moving is not laid; it needs a target inside
        // its own reach to have anything to prepare for.
        if (unit.state === 'moving') return false;
        if (reach <= 0) return false;
        return ctx.visible.some((enemy) => near(enemy, reach));
      }
      default:
        return false;
    }
  }

  /**
   * Spend a ready national capability on something worth its price.
   *
   * The gates, the cost and the cooldown are the simulation's answer, not a
   * second copy: if `superweaponStatus` says no, nothing is queued. The target
   * is chosen from what the commander can actually see, and only a target the
   * simulation would also accept is sent, so a refused order never burns a
   * national reload.
   */
  private manageSuperweapon(ctx: AIContext): void {
    const status = ctx.game.superweaponStatus(ctx.aiId);
    const family = status.family;
    if (!status.ok || !family) return;
    // An army comes first. A commander that cannot hold the field has no use
    // for an expensive strike, and spending the bank on one leaves it naked.
    if (ctx.combat.length < Math.max(4, Math.round(ctx.st.desiredArmy * 0.5))) return;
    const reserve = Math.min(this.researchReserve(ctx).mats, 400);
    if (ctx.player.mats - family.cost.mats < reserve) return;
    const aim = this.superweaponAim(ctx, family.targeting, family.effect.kind === 'ew' || family.effect.kind === 'dew' ? family.effect.radiusTiles : family.effect.kind === 'saturation' || family.effect.kind === 'drone' ? family.effect.spreadTiles : 3);
    if (!aim) return;
    if (
      !ctx.game.superweaponTargetStatus(ctx.aiId, family.id, aim.x, aim.z, aim.targetId || undefined)
        .ok
    ) {
      return;
    }
    ctx.game.enqueueCommand({
      type: 'superweapon',
      team: ctx.team,
      familyId: family.id,
      x: aim.x,
      z: aim.z,
      ...(aim.targetId ? { targetId: aim.targetId } : {}),
    });
    ctx.st.lastDecision = `strategic operation — ${family.id}`;
  }

  /**
   * A worthwile aim point for one targeting mode, or null.
   *
   * Precision strikes look for one exposed high-value structure. Area attacks
   * look for the densest seen cluster of hostiles, because that is what a
   * barrage or a swarm is for. An electronic attack wants a fielded network, and
   * a defensive field is laid over the commander's own concentration instead.
   */
  private superweaponAim(
    ctx: AIContext,
    targeting: string,
    radiusTiles: number,
  ): { x: number; z: number; targetId: number } | null {
    const reach = Math.max(2, radiusTiles) * TILE_SIZE;
    const hostiles = ctx.visible.filter(
      (e) => e.hp > 0 && e.owner >= 0 && ctx.game.isHostile(ctx.aiId, e.owner),
    );
    if (targeting === 'enemyStructure') {
      const structures = hostiles
        .filter(
          (e) =>
            e.kind === 'building' &&
            !e.construction &&
            !isIndestructibleStructure(e.defId),
        )
        .sort(
          (a, b) =>
            (BUILDINGS[b.defId]?.cost.mats ?? 0) - (BUILDINGS[a.defId]?.cost.mats ?? 0) ||
            b.hp - a.hp ||
            a.id - b.id,
        );
      const best = structures[0];
      // A relay or a lone truck is not a strategic target: the round costs more
      // than the thing it lands on.
      if (!best || (BUILDINGS[best.defId]?.cost.mats ?? 0) < 400) return null;
      return { x: best.x, z: best.z, targetId: best.id };
    }
    if (targeting === 'friendlyArea') {
      const own = ctx.combat.filter((e) => e.hp > 0);
      if (own.length < 3) return null;
      let cx = 0;
      let cz = 0;
      for (const unit of own) {
        cx += unit.x;
        cz += unit.z;
      }
      return { x: cx / own.length, z: cz / own.length, targetId: 0 };
    }
    if (hostiles.length === 0) return null;
    if (targeting === 'enemyNetwork') {
      // Only a position that still holds a fielded network is worth jamming: a
      // patch of ground with a single lorry on it is not a network.
      const networks = hostiles.filter((e) => {
        if (e.kind === 'building') {
          const def = BUILDINGS[e.defId];
          return !!def?.radar || !!def?.scanRadius || (def?.weapons?.length ?? 0) > 0;
        }
        // An aircraft or a scout hull is a node in the picture the attack is
        // aimed at, so its sight radius stands in for 'fielded network'.
        const unit = UNITS[e.defId];
        return !!unit && (unit.vision ?? 0) >= 11;
      });
      if (networks.length === 0) return null;
      const seed = networks[0];
      return { x: seed.x, z: seed.z, targetId: 0 };
    }
    // Area attack: the densest seen cluster, averaged over the rounds it would
    // catch. A single distant unit is not worth a salvo.
    let best: { x: number; z: number; count: number } | null = null;
    for (const anchor of hostiles) {
      let count = 0;
      let cx = 0;
      let cz = 0;
      for (const other of hostiles) {
        if (dist(other.x, other.z, anchor.x, anchor.z) > reach) continue;
        count++;
        cx += other.x;
        cz += other.z;
      }
      if (count < 3) continue;
      if (!best || count > best.count) best = { x: cx / count, z: cz / count, count };
    }
    return best ? { x: best.x, z: best.z, targetId: 0 } : null;
  }

  /* ---------------------------------------------------------------------- */
  /* Intelligence                                                           */
  /* ---------------------------------------------------------------------- */

  private knownEnemies(game: Game, aiId: number, visible: Entity[]): KnownEnemy[] {
    const known: KnownEnemy[] = [];
    const seen = new Set<number>();
    for (const e of visible) {
      if (e.owner < 0 || e.defId === 'relay') continue;
      seen.add(e.id);
      known.push({
        id: e.id,
        kind: e.kind,
        defId: e.defId,
        x: e.x,
        z: e.z,
        visible: true,
        tick: game.state.tick,
      });
    }
    for (const c of game.contactsFor(aiId)) {
      if (seen.has(c.entityId) || c.defId === 'relay') continue;
      // Without a confirmed identification there is no defId or kind to reason
      // about; the commander keeps the position in memory but not as a target
      // class, so a detected contact never drives counters or targeting.
      if (!c.defId || !c.kind) continue;
      seen.add(c.entityId);
      known.push({
        id: c.entityId,
        kind: c.kind,
        defId: c.defId,
        x: c.x,
        z: c.z,
        visible: false,
        tick: c.tick,
      });
    }
    return known;
  }

  /** Next pseudorandom draw in the AI's saved stream. */
  private random(ctx: AIContext): number {
    const st = ctx.st;
    const current = st.aiRng || mix32(st.aiSeed ^ 0x9e3779b9);
    const next = (Math.imul(current, 1664525) + 1013904223) >>> 0;
    st.aiRng = next;
    return next / 4294967296;
  }

  /**
   * Update the commander's decaying reading of what the opponent is building.
   *
   * Only identified contacts are counted, each entity once, so a remembered
   * sighting cannot be mistaken for a second sighting. The mass and the class
   * scores both decay with a fifteen-second half-life: a column that has been
   * destroyed or has left stops colouring the reading instead of inflating it
   * for the rest of the match.
   */
  private updateOpponentRead(ctx: AIContext): void {
    const st = ctx.st;
    const prior = st.opponentRead as OpponentRead | undefined;
    const tick = ctx.game.state.tick;
    const seen = new Set<number>();
    const observedScores = {} as Record<OpponentTendency, number>;
    for (const tendency of OPPONENT_TENDENCIES) observedScores[tendency] = 0;
    let observed = 0;
    const halfLife = ctx.execution.memoryHalfLife;
    for (const enemy of ctx.known) {
      if (seen.has(enemy.id)) continue;
      seen.add(enemy.id);
      const tendency = opponentTendencyOf(enemy);
      if (!tendency) continue;
      // Freshness, not mere presence. A contact still under the commander's own
      // eyes is worth a full observation; a remembered one is worth what is left
      // of its memory. Without this, a stale contact in the list would re-add
      // full evidence on every think and never fade.
      const age = Math.max(0, tick - enemy.tick);
      const freshness = enemy.visible ? 1 : Math.pow(0.5, age / (20 * halfLife));
      if (freshness <= 0.02) continue;
      observedScores[tendency] += freshness;
      observed += freshness;
    }
    const decay = Math.pow(0.5, Math.max(0, tick - (prior?.tick ?? tick)) / (20 * halfLife));
    const scores = {} as Record<OpponentTendency, number>;
    for (const tendency of OPPONENT_TENDENCIES) {
      scores[tendency] = (prior?.scores?.[tendency] ?? 0) * decay + observedScores[tendency];
    }
    const mass = (prior?.mass ?? 0) * decay + observed;
    const ranked = [...OPPONENT_TENDENCIES].sort(
      (a, b) => scores[b] - scores[a] || a.localeCompare(b),
    );
    const leader = ranked[0]!;
    const leadScore = scores[leader];
    const previous = (prior?.tendency as OpponentTendency | null | undefined) ?? null;
    const runnerUp = Math.max(
      scores[ranked[1]!] ?? 0,
      previous ? (scores[previous] ?? 0) : 0,
    );
    const { recognitionMass, recognitionLead } = ctx.execution;
    let tendency: OpponentTendency | null = previous;
    let confidence = 0;
    if (leadScore <= 0) {
      // Nothing identified: the reading empties rather than freezing on a guess.
      tendency = null;
    } else if (mass >= recognitionMass) {
      const lead = leadScore / Math.max(1e-6, runnerUp);
      if (lead >= recognitionLead || leader === previous) tendency = leader;
      confidence =
        Math.min(1, mass / recognitionMass) * Math.min(1, lead / recognitionLead);
    } else {
      // The evidence has aged out below the level's own bar: the commander stops
      // claiming to know what the opponent is doing rather than acting on a
      // memory it can no longer support.
      tendency = null;
    }
    const totalScore = OPPONENT_TENDENCIES.reduce((sum, t) => sum + scores[t], 0);
    const tendencies = OPPONENT_TENDENCIES.filter(
      (t) => totalScore > 0 && scores[t] / totalScore >= 0.15,
    )
      .map((t) => ({ tendency: t, share: scores[t] / Math.max(1e-6, totalScore) }))
      .sort((a, b) => b.share - a.share || a.tendency.localeCompare(b.tendency));
    st.opponentRead = {
      tendency: mass >= recognitionMass ? tendency : null,
      confidence: mass >= recognitionMass ? confidence : 0,
      mass,
      scores,
      tick,
      observed,
      tendencies: mass >= recognitionMass ? tendencies : [],
    };
  }

  /**
   * Judge the wave that was sent, from the simulation's own counters and the
   * positions of the units it committed.
   *
   * There is no per-battle event log to read, so the assessment is deliberately
   * coarse: kills and losses are real counters, the objective is a position the
   * commander chose, and "reached" means a committed hull is standing on it.
   * A wave is reviewed once, after the level's own observation window.
   */
  private reviewAssault(ctx: AIContext): void {
    // Tactical judgement belongs to the commander layer; the classic AI keeps
    // its exact Phase 5 behaviour.
    if (!ctx.st.commanderId) return;
    const battle = ctx.st.battle;
    if (!battle) return;
    if (battle.lastOutcomeTick !== undefined && battle.lastOutcomeTick >= battle.startTick) return;
    const tick = ctx.game.state.tick;
    if (tick - battle.startTick < ctx.execution.assaultReviewTicks) return;
    const kills = ctx.player.stats.kills - battle.startKills;
    const losses = ctx.player.stats.unitsLost - battle.startLosses;
    const alive = new Set(ctx.own.filter((e) => e.kind === 'unit').map((e) => e.id));
    const survivors = battle.ids.filter((id) => alive.has(id)).length;
    const destroyed = Math.max(0, battle.startCount - survivors);
    const reached = ctx.own.some(
      (e) =>
        e.kind === 'unit' &&
        battle.ids.includes(e.id) &&
        dist(e.x, e.z, battle.x, battle.z) < 8 * TILE_SIZE,
    );
    // "Reached" only counts as progress if the point the wave was sent to lies
    // toward the target. A staging point beside the base is not an objective,
    // and a wave that never left must not be scored as a success.
    const forward = dist(battle.x, battle.z, ctx.st.targetBaseX, ctx.st.targetBaseZ) < 20 * TILE_SIZE;
    // Standing on the objective is not enough if the enemy is still holding it:
    // the ground only counts when nothing the commander can see remains there.
    const cleared = !ctx.known.some(
      (e) => e.visible && dist(e.x, e.z, battle.x, battle.z) < 15 * TILE_SIZE,
    );
    let outcome: 'success' | 'failure' | 'inconclusive' = 'inconclusive';
    if ((reached && forward && cleared) || kills >= losses + 2) outcome = 'success';
    else if (
      (destroyed >= Math.max(2, Math.ceil(battle.startCount * 0.6)) && kills <= losses) ||
      losses >= kills + 3
    ) {
      outcome = 'failure';
    }
    // A wave still walking to its objective has not failed yet. Keep watching
    // it until something decisive happens, or until the same generous window
    // runs out and it is recorded as inconclusive rather than judged blind.
    if (outcome === 'inconclusive' && tick - battle.startTick < 20 * 60) return;
    const setbacks = outcome === 'failure' ? (battle.setbacks ?? 0) + 1 : outcome === 'success' ? 0 : (battle.setbacks ?? 0);
    ctx.st.battle = {
      ...battle,
      lastOutcome: outcome,
      lastOutcomeTick: tick,
      setbacks,
      setbackUntil: outcome === 'failure' ? tick + 20 * 45 : battle.setbackUntil,
    };
    ctx.st.lastDecision =
      `wave ${battle.wave} ${outcome} — ${kills} kills, ${destroyed} of ${battle.startCount} lost`;
  }

  /**
   * How much a run of failed waves slows the next one down.
   *
   * The level sets how many failures it takes to doubt the approach, and the
   * commander's own aggression bends that: a pressing commander keeps attacking
   * the same way for longer, a careful one changes its approach sooner. The
   * multiplier is small and expires; nothing here makes a commander passive.
   */
  private assaultCaution(ctx: AIContext): { gate: number; cooldown: number } {
    const battle = ctx.st.battle;
    const setbacks = battle?.setbacks ?? 0;
    if (setbacks <= 0 || ctx.game.state.tick > (battle?.setbackUntil ?? 0)) {
      return { gate: 1, cooldown: 1 };
    }
    const tolerance = Math.max(
      1,
      Math.round(ctx.execution.setbackTolerance + (ctx.profile.aggression - 0.5) * 2),
    );
    if (setbacks < tolerance) return { gate: 1, cooldown: 1 };
    const strength = Math.min(2, setbacks);
    return { gate: 1 + 0.12 * strength, cooldown: 1 + 0.5 * strength };
  }

  private contactValue(
    enemy: KnownEnemy,
    baseX: number,
    baseZ: number,
    bias: Readonly<Record<CommanderTargetCategory, number>> = NEUTRAL_TACTICAL.targetBias,
    noise = 0,
  ): number {
    let value = 30;
    if (enemy.kind === 'building') {
      const def = BUILDINGS[enemy.defId];
      if (def?.commandPost) value = 160;
      else if (def?.produces) value = 100;
      else if (def?.refinery) value = 95;
      else value = 70;
      if (def?.airfield || def?.shipyard) value += 20;
    } else {
      const def = UNITS[enemy.defId];
      if (def?.weapons.length) value = 42;
      if (enemy.defId === 'harvester') value = 58;
      if (enemy.defId === 'engineer') value = 34;
      if (def?.domain === 'air') value = 64;
      if (def?.domain === 'naval') value = 54;
    }
    // A commander's preference reweights the same value the planner already
    // computed; distance decay stays untouched so a preference can never make a
    // distant target look closer than a nearer one of the same class.
    value *= bias[contactCategory(enemy)];
    if (noise > 0) {
      // A level's mis-reading of a contact, keyed to the contact itself so the
      // same commander values the same target the same way on every think.
      value *= 1 + (unitHash(enemy.id, 0x5f356495) * 2 - 1) * noise;
    }
    return value - dist(enemy.x, enemy.z, baseX, baseZ) / TILE_SIZE * 0.35;
  }

  private updateTarget(ctx: AIContext): void {
    const st = ctx.st;
    // Remembered contacts are the only source of enemy coordinates. At tick
    // zero the AI has no idea where the human landing force is.
    if (ctx.known.length === 0) {
      if (st.targetKnown && ctx.game.state.tick - (st.lastContactTick ?? 0) > 20 * 40) {
        // The trail is cold. Stop assaulting a remembered point and scout again.
        st.targetKnown = false;
        st.scouted = false;
        st.phase = 'build';
        st.lastDecision = 'contact lost — resuming reconnaissance';
      }
      return;
    }
    st.lastContactTick = ctx.game.state.tick;
    const baseBias = ctx.tactical.targetBias;
    const bias = ctx.read?.tendency
      ? (Object.fromEntries(
          COMMANDER_TARGET_CATEGORIES.map((category) => [
            category,
            // Same rule as production: the combined value stays inside the
            // commander's own bias band, so a recognised economic opponent
            // cannot turn an assault commander into an economy raider.
            Math.max(0.75, Math.min(1.4, baseBias[category] * adaptTarget(ctx.read, category))),
          ]),
        ) as Record<CommanderTargetCategory, number>)
      : baseBias;
    const noise = ctx.execution.targetNoise;
    let best = [...ctx.known].sort(
      (a, b) =>
        this.contactValue(b, ctx.baseX, ctx.baseZ, bias, noise) -
          this.contactValue(a, ctx.baseX, ctx.baseZ, bias, noise) || a.id - b.id,
    )[0];
    if (!best) return;
    // Re-targeting every think makes a commander with two comparable contacts
    // walk its army back and forth. A commanded AI only switches when the new
    // contact is meaningfully better; the seeded path keeps its original rule so
    // the historical ladder still measures the same AI.
    if (ctx.st.commanderId && st.targetKnown) {
      const current = ctx.known.find(
        (e) => e.x === st.targetBaseX && e.z === st.targetBaseZ,
      );
      if (current && current.id !== best.id) {
        const currentScore = this.contactValue(current, ctx.baseX, ctx.baseZ, bias, noise);
        const nextScore = this.contactValue(best, ctx.baseX, ctx.baseZ, bias, noise);
        if (nextScore < currentScore * TARGET_SWITCH_MARGIN) best = current;
      }
    }
    st.targetKnown = true;
    st.scouted = true;
    st.targetBaseX = best.x;
    st.targetBaseZ = best.z;
  }

  private claim(entity: Entity): void {
    this.claimed.add(entity.id);
  }

  private free(entity: Entity): boolean {
    // Occupants are not free line units: they must be ordered out first.
    return !entity.order && !entity.garrisonId && !this.claimed.has(entity.id);
  }

  private order(ctx: AIContext, unit: Entity, command: Parameters<Game['enqueueCommand']>[0]): boolean {
    if (!this.free(unit)) return false;
    this.claim(unit);
    ctx.game.enqueueCommand(command);
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Defence and scouting                                                   */
  /* ---------------------------------------------------------------------- */

  private defend(ctx: AIContext): void {
    if (ctx.threats.length === 0) return;
    // Nearest first is the baseline reading. A level that reads the situation
    // properly answers the raider that can actually hurt the base: a tank is a
    // worse problem than a scout that happens to stand a tile closer.
    const target = ctx.execution.dangerFocus
      ? ctx.threats.reduce((best, e) =>
          threatDanger(e, ctx.baseX, ctx.baseZ) > threatDanger(best, ctx.baseX, ctx.baseZ)
            ? e
            : best,
        )
      : ctx.threats.reduce((best, e) =>
          dist(e.x, e.z, ctx.baseX, ctx.baseZ) < dist(best.x, best.z, ctx.baseX, ctx.baseZ)
            ? e
            : best,
        );
    ctx.st.phase = 'defend';
    // A wave already on its way out is not `free`, so without this nothing can
    // be called back: the whole army walks on while a strike force dismantles
    // the base, and a commander that never defends loses to any level that
    // pushes early. Only an attacker standing in the base itself is an
    // emergency, and only a level that watches its own base calls the wave home,
    // so a commander keeps pressing while its base is safe and turns around when
    // it is not.
    // Recall is for a base in danger, not for every hull that wanders into the
    // ring. Pulling a committed wave home for a lone scout turned a defence into
    // a yo-yo: the army spent the match marching back and forth while the
    // attacker's next raid was already on the way, and constant pressure beat a
    // commander that answered all of it. A raid becomes an emergency once there
    // are enough raiders to hurt the base, or once one has actually hit it.
    const raiders = ctx.threats.filter(
      (e) =>
        dist(e.x, e.z, ctx.baseX, ctx.baseZ) <
        RECALL_RING * ctx.tactical.recallMargin * TILE_SIZE,
    );
    const baseHit = ctx.game.state.entities.some(
      (e) =>
        e.owner === ctx.aiId &&
        e.kind === 'building' &&
        e.hp < e.maxHp &&
        ctx.game.state.tick - e.lastHitTick < 20 * 10,
    );
    const emergency =
      ctx.profile.recall && (raiders.length >= 2 || baseHit) && raiders.length > 0;
    let ordered = 0;
    let recalled = 0;
    for (const unit of ctx.own) {
      if (unit.kind !== 'unit' || unit.garrisonId || this.claimed.has(unit.id)) continue;
      const committed = !!unit.order;
      if (committed) {
        // Already shooting the thing that is attacking the base.
        if (unit.order!.type === 'attack' && unit.order!.targetId === target.id) continue;
        if (!emergency) continue;
        // A wave that has crossed the map cannot get back in time to save the
        // base, and abandoning a winning assault only feeds one unit at a time.
        if (dist(unit.x, unit.z, ctx.baseX, ctx.baseZ) > RECALL_RANGE * TILE_SIZE) continue;
      }
      const family = unitFamily(unit.defId);
      if (
        family === 'harvester' ||
        family === 'engineer' ||
        family === 'medic' ||
        family === 'recovery'
      ) {
        continue;
      }
      const weapons = entityWeapons(unit);
      if (weapons.length === 0) continue;
      // Only a unit whose actual weapon can engage this target answers it:
      // ground guns ignore aircraft and interceptors ignore tanks.
      if (!weapons.some((weapon) => canWeaponTarget(weapon, target))) continue;
      if (dist(unit.x, unit.z, ctx.baseX, ctx.baseZ) > 60 * TILE_SIZE) continue;
      // Reaching here with an order means the unit is being recalled, which
      // `order()` would refuse; the claim keeps the rest of the tick off it.
      this.claim(unit);
      ctx.game.enqueueCommand({
        type: 'attack',
        team: ctx.aiId,
        ids: [unit.id],
        targetId: target.id,
      });
      ordered++;
      if (committed) recalled++;
    }
    if (ordered > 0) {
      ctx.st.lastDecision =
        recalled > 0
          ? `recalling ${recalled} units to defend base against ${target.defId}`
          : `defending base against ${target.defId}`;
    }
  }

  /**
   * Pull a hauler out of the line of fire.
   *
   * Trucks are the most valuable thing a base owns per material spent, and they
   * are also the softest: a single raider that reaches the ore line can delete an
   * income that took two minutes to build. So a hauler that has been shot at, or
   * that has a hostile inside a raider's reach, drives back to the command post
   * and waits out the raid. Loading pauses — that is the cost — and the truck
   * survives to mine again, which a recruit's trucks do not.
   */
  private protectHaulers(ctx: AIContext): void {
    if (!ctx.profile.protectEconomy) return;
    if (ctx.threats.length === 0) return;
    const tick = ctx.game.state.tick;
    for (const hauler of ctx.own) {
      if (hauler.kind !== 'unit' || hauler.hp <= 0 || !hauler.harvester) continue;
      // Already driving somewhere (a retreat, or a player-style move order).
      if (hauler.order) continue;
      if (this.claimed.has(hauler.id)) continue;
      const danger = ctx.threats.some((enemy) => {
        if (dist(enemy.x, enemy.z, hauler.x, hauler.z) > 7 * TILE_SIZE) return false;
        const weapons = entityWeapons(enemy);
        return weapons.length > 0;
      });
      const shelled = tick - hauler.lastHitTick < 20 * 3;
      if (!danger && !shelled) continue;
      // Fall back on the command post: the one structure every base has, and the
      // place the garrison is already standing.
      if (
        this.order(ctx, hauler, {
          type: 'move',
          team: ctx.aiId,
          ids: [hauler.id],
          x: ctx.baseX,
          z: ctx.baseZ,
        })
      ) {
        ctx.st.lastDecision = 'haulers pulling back under fire';
      }
    }
  }

  private scout(ctx: AIContext): void {
    const reconId = ctx.game.unitIdFor(ctx.aiId, 'recon');
    const recon = ctx.own.find((e) => e.kind === 'unit' && e.defId === reconId);
    if (!recon) return;
    // An unarmed scout is flown differently from an armed one: it keeps the
    // edge of the army's reach instead of ranging alone, and a nearby combat
    // unit walks the same route. Its optics are unchanged; only its exposure is.
    const unarmed = (UNITS[recon.defId]?.weapons.length ?? 1) === 0;
    // Breaking contact is checked every think, including while a patrol order
    // is still running, so a sighting does not have to wait out the patrol.
    if (unarmed && this.withdrawScout(ctx, recon)) return;
    if (!this.free(recon)) return;
    const tick = ctx.game.state.tick;
    // A fresh report does not need a new patrol every second.
    if (tick - (ctx.st.lastScoutTick ?? 0) < 20 * 6) return;
    let point: { x: number; z: number } | null = null;
    if (ctx.st.targetKnown) {
      // Sweep around the last contact to keep it fresh without walking into it.
      // An unarmed hull stops inside its own optics rather than inside the
      // range of whatever is holding the position.
      const angle = this.random(ctx) * Math.PI * 2;
      const radius = (unarmed ? 11 + this.random(ctx) * 4 : 10 + this.random(ctx) * 8) * TILE_SIZE;
      point = {
        x: ctx.st.targetBaseX + Math.cos(angle) * radius,
        z: ctx.st.targetBaseZ + Math.sin(angle) * radius,
      };
      if (!this.standable(ctx, point.x, point.z)) point = null;
    }
    if (!point) point = this.chooseScoutPoint(ctx);
    if (!point) return;
    if (unarmed) {
      point = this.screenPoint(ctx, point);
      this.escortScout(ctx, recon, point);
    }
    if (
      this.order(ctx, recon, {
        type: 'move',
        team: ctx.aiId,
        ids: [recon.id],
        x: point.x,
        z: point.z,
      })
    ) {
      ctx.st.lastScoutTick = tick;
      ctx.st.lastDecision = ctx.st.targetKnown
        ? 'reconnaissance sweep around last contact'
        : 'reconnaissance push into uncharted ground';
    }
  }

  /**
   * The reconnaissance drone is a second, independent scout. It can cross
   * terrain the wheeled scout cannot, and its long optics make it the natural
   * spotter for artillery. It is deliberately sent to different ground than
   * the land scout rather than trailing it.
   */
  private scoutAir(ctx: AIContext): void {
    const uavId = ctx.game.unitIdFor(ctx.aiId, 'uav');
    const uav = ctx.own.find(
      (e) => e.kind === 'unit' && e.defId === uavId && e.hp > 0 && this.free(e),
    );
    if (!uav) return;
    const tick = ctx.game.state.tick;
    if (tick - (ctx.st.lastAirScoutTick ?? 0) < 20 * 9) return;
    let point: { x: number; z: number } | null = null;
    if (ctx.st.targetKnown) {
      // Orbit at the edge of the drone's own optics rather than close over the
      // position: a recon aircraft survives by seeing further than the air
      // defence shoots, and a deep-recon airframe earns its larger orbit.
      const angle = this.random(ctx) * Math.PI * 2;
      const standoff = Math.max(12, (UNITS[uav.defId]?.vision ?? 20) * 0.8);
      const radius = (standoff + this.random(ctx) * 4) * TILE_SIZE;
      point = {
        x: ctx.st.targetBaseX + Math.cos(angle) * radius,
        z: ctx.st.targetBaseZ + Math.sin(angle) * radius,
      };
    }
    point ??= this.chooseScoutPoint(ctx);
    if (!point) return;
    if (
      this.order(ctx, uav, {
        type: 'move',
        team: ctx.aiId,
        ids: [uav.id],
        x: point.x,
        z: point.z,
      })
    ) {
      ctx.st.lastAirScoutTick = tick;
      ctx.st.lastDecision = 'drone reconnaissance sortie';
    }
  }

  /**
   * An unarmed scout that has seen an armed enemy inside its reaction distance
   * breaks contact instead of finishing the patrol. The order is issued even
   * while the patrol order is still running: withdrawing is the one case where
   * a fresh order is worth more than a completed route.
   */
  private withdrawScout(ctx: AIContext, scout: Entity): boolean {
    let threat: Entity | undefined;
    let threatRange = 12 * TILE_SIZE;
    for (const enemy of ctx.visible) {
      if (enemy.owner < 0 || enemy.kind !== 'unit' || enemy.hp <= 0) continue;
      if (entityWeapons(enemy).length === 0) continue;
      const d = dist(scout.x, scout.z, enemy.x, enemy.z);
      if (d < threatRange) {
        threatRange = d;
        threat = enemy;
      }
    }
    if (!threat) return false;
    // Only a friendly combat unit physically beside the scout makes standing
    // worthwhile: it can return fire immediately. Armour merely in the same
    // postcode does not stop the scout being the closest target.
    const covered = ctx.combat.some(
      (unit) =>
        unit.id !== scout.id && dist(unit.x, unit.z, scout.x, scout.z) <= 6 * TILE_SIZE,
    );
    if (covered) return false;
    const dx = scout.x - threat.x;
    const dz = scout.z - threat.z;
    const len = Math.hypot(dx, dz) || 1;
    const x = scout.x + (dx / len) * 9 * TILE_SIZE;
    const z = scout.z + (dz / len) * 9 * TILE_SIZE;
    ctx.game.enqueueCommand({
      type: 'move',
      team: ctx.aiId,
      ids: [scout.id],
      x,
      z,
    });
    ctx.st.lastDecision = `unarmed scout withdrawing from ${threat.defId}`;
    return true;
  }

  /**
   * Pull an unarmed scout's patrol point back to the edge of the nearest
   * friendly ground combat unit: close enough that the armour can answer what
   * the optics find, far enough that the scout still looks past the line.
   */
  private screenPoint(ctx: AIContext, point: { x: number; z: number }): { x: number; z: number } {
    let anchorX = ctx.baseX;
    let anchorZ = ctx.baseZ;
    let lead = 24 * TILE_SIZE;
    let best = Number.POSITIVE_INFINITY;
    for (const unit of ctx.combat) {
      if (UNITS[unit.defId]?.domain !== 'land') continue;
      const d = dist(unit.x, unit.z, point.x, point.z);
      if (d < best) {
        best = d;
        anchorX = unit.x;
        anchorZ = unit.z;
        lead = 9 * TILE_SIZE;
      }
    }
    if (best <= lead) return point;
    const dx = point.x - anchorX;
    const dz = point.z - anchorZ;
    const len = Math.hypot(dx, dz) || 1;
    // Walk back toward the anchor until the point is ground the scout can use;
    // if the whole approach is blocked the original point is kept so scouting
    // never stops entirely.
    for (let back = lead; back >= 4 * TILE_SIZE; back -= 2 * TILE_SIZE) {
      const x = anchorX + (dx / len) * back;
      const z = anchorZ + (dz / len) * back;
      if (this.standable(ctx, x, z)) return { x, z };
    }
    return point;
  }

  /**
   * Walk one nearby combat unit along the unarmed scout's route. The enemy
   * engages the escort instead of the optics, so the report arrives with a unit
   * that can survive being found.
   */
  private escortScout(ctx: AIContext, scout: Entity, point: { x: number; z: number }): void {
    if (ctx.threats.length > 0) return;
    let escort: Entity | undefined;
    let best = 22 * TILE_SIZE;
    for (const unit of ctx.combat) {
      if (unit.id === scout.id || !this.free(unit)) continue;
      if (UNITS[unit.defId]?.domain !== 'land') continue;
      const d = dist(unit.x, unit.z, scout.x, scout.z);
      if (d < best) {
        best = d;
        escort = unit;
      }
    }
    if (!escort) return;
    if (
      this.order(ctx, escort, {
        type: 'move',
        team: ctx.aiId,
        ids: [escort.id],
        x: point.x,
        z: point.z,
        attackMove: true,
      })
    ) {
      ctx.st.lastDecision = `${escort.defId} escorting the ${UNITS[scout.defId]?.shortName ?? 'scout'}`;
    }
  }

  private standable(ctx: AIContext, x: number, z: number): boolean {
    const map = ctx.game.state.map;
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    if (tx < 1 || tz < 1 || tx >= map.width - 1 || tz >= map.height - 1) return false;
    const idx = tileIndex(map.width, tx, tz);
    return canStandOn(map.width, map.height, map.terrain, idx, 'wheeled');
  }

  /**
   * Open ground beside the remembered contact that this group can be ordered
   * to. A remembered structure reports its own centre, which the command layer
   * refuses, so the aim walks back toward the base until the formation fits.
   * `null` means nothing on that line is usable: hold rather than announce a
   * wave that cannot move.
   */
  private approachPoint(ctx: AIContext, ids: number[]): { x: number; z: number } | null {
    const x = ctx.st.targetBaseX;
    const z = ctx.st.targetBaseZ;
    if (this.options.resolveApproach === false) return { x, z };
    return ctx.game.groupApproach(ctx.aiId, ids, x, z, ctx.baseX, ctx.baseZ);
  }

  private tileLabel(ctx: AIContext): string {
    const tx = Math.round(ctx.st.targetBaseX / TILE_SIZE);
    const tz = Math.round(ctx.st.targetBaseZ / TILE_SIZE);
    return `${tx},${tz}`;
  }

  private chooseScoutPoint(ctx: AIContext): { x: number; z: number } | null {
    const map = ctx.game.state.map;
    const centerX = (map.width * TILE_SIZE) / 2;
    const centerZ = (map.height * TILE_SIZE) / 2;
    let best: { x: number; z: number; score: number } | null = null;
    for (let z = 2; z < map.height - 2; z += 3) {
      for (let x = 2; x < map.width - 2; x += 3) {
        const fog = ctx.game.fogAt(ctx.team, x, z);
        if (fog === 2) continue;
        const idx = tileIndex(map.width, x, z);
        if (!canStandOn(map.width, map.height, map.terrain, idx, 'wheeled')) continue;
        const wx = (x + 0.5) * TILE_SIZE;
        const wz = (z + 0.5) * TILE_SIZE;
        const d = dist(wx, wz, ctx.baseX, ctx.baseZ) / TILE_SIZE;
        if (d < 10 || d > 72) continue;
        const towardCenter = dist(wx, wz, centerX, centerZ) / TILE_SIZE;
        const score =
          (fog === 0 ? 18 : 6) -
          Math.abs(d - 30) * 0.5 -
          towardCenter * 0.2 +
          unitHash(ctx.game.state.seed, ctx.st.nextThinkTick, x, z) * 8 +
          this.random(ctx) * 4;
        if (!best || score > best.score) best = { x: wx, z: wz, score };
      }
    }
    if (best) return { x: best.x, z: best.z };
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Economy and construction                                               */
  /* ---------------------------------------------------------------------- */

  private buildOptions(ctx: AIContext): BuildOption[] {
    const options: BuildOption[] = [];
    // Facilities that may still be sited while a base is rebuilding its haulers:
    // the factory that produces the hull, the drop-off that banks its load and
    // the plant that keeps both running.
    const rescueFacilities = new Set(['factory', 'refinery', 'powerPlant']);
    const add = (
      slotId: string,
      score: number,
      reason: string,
      essential = false,
      planned = false,
      economy = false,
    ): void => {
      // Build the actual structure this nation fields for the slot. A roster
      // that excludes it returns undefined, so the option simply disappears.
      const defId = ctx.game.buildingIdFor(ctx.aiId, slotId);
      if (!defId) return;
      // A structure it cannot legally place is not a build option. Two separate
      // locks apply: the facility requirements (`missingTech`) and the research
      // that opens the slot. Leaving either in the list would let a high scorer
      // reserve materials, and — worse — stall every other option, because the
      // planner tries the affordable list in order and a site search that can
      // never succeed consumes the whole think.
      if (ctx.game.missingTech(ctx.aiId, defId).length > 0) return;
      if (!ctx.game.buildingSlotUnlocked(ctx.aiId, buildingFamily(defId))) return;
      // Economic rescue. With no working hauler and a drop-off standing, the next
      // material belongs to the replacement hull, so a capability structure must
      // not consume it. The rescue does not freeze the base: the facilities that
      // produce and bank the hull stay available, and a live threat still buys a
      // defensive position, because a raid at the gate cannot wait for an economy.
      // A viable route needs both halves: a drop-off to bank a load and a
      // factory to produce the hull. With either missing there is nothing to
      // protect the bank for, so the base must keep building — otherwise a lost
      // factory would lock it into rescue-only construction for the rest of the
      // match.
      const rescuing =
        (ctx.unitCounts.get('harvester') ?? 0) === 0 &&
        (ctx.counts.get('refinery') ?? 0) > 0 &&
        (ctx.counts.get('factory') ?? 0) > 0;
      if (
        rescuing &&
        !rescueFacilities.has(defId) &&
        !(essential && ctx.threats.length > 0)
      ) {
        return;
      }
      // Doctrine bends the construction plan, it never replaces it: legal,
      // affordable and prerequisite checks have all run above, and the weight is
      // clamped, so a commander that loves bunkers still raises an economy and a
      // production maximalist still answers a brownout.
      score *= commanderWeight(ctx.st.commanderId, 'build', slotId);
      options.push({ defId, score, reason, essential, planned, economy });
    };
    const counts = ctx.counts;
    const factory = counts.get('factory') ?? 0;
    const refinery = counts.get('refinery') ?? 0;
    const barracks = counts.get('barracks') ?? 0;
    const airfield = counts.get('airfield') ?? 0;
    const shipyard = counts.get('shipyard') ?? 0;
    const harvesters = ctx.unitCounts.get('harvester') ?? 0;
    const bank = ctx.player.mats;
    const powerGap = ctx.power.supply - ctx.power.demand;
    // Look one facility ahead: 24 points is about what the next structure draws,
    // so the commander buys a plant before the airfield or shipyard browns the
    // base out rather than after. It is anticipation, not stockpiling.
    const powerHeadroom = 24;
    const threat = ctx.threats.length > 0;
    const damaged = ctx.complete.some((b) => b.hp < b.maxHp * 0.85);
    const opening = STRATEGY_OPENING[ctx.strategy];
    const jitter = (): number => this.random(ctx) * 12;

    // Structural prerequisites are scored, not scheduled. A brownout outranks
    // a new facility because every later construction is slowed by it.
    if (ctx.power.brownout) {
      add('powerPlant', 260 + jitter(), 'grid deficit', true);
    } else if (powerGap < powerHeadroom && powerGap >= 0 && harvesters >= 2) {
      // Headroom is optional infrastructure: buy it once the economy is crewed,
      // not out of the first two haulers' budget. A brownout still outranks
      // everything through the branch above, so waiting never strands the base.
      add('powerPlant', 96 + ctx.profile.economy * 24 + jitter(), 'grid headroom');
    }

    if (!factory) add('factory', opening.factory + jitter(), 'vehicle production', true);
    else if (factory < 2 && ctx.profile.economy > 0.68 && bank > 2400) {
      add('factory', 52 + ctx.profile.economy * 26 + jitter(), 'second production line');
    }

    if (!refinery) add('refinery', opening.refinery + jitter(), 'material drop-off', true);
    else if (!ctx.haulingIdle) {
      // Another drop-off only shortens round trips while a deposit is actually
      // being worked. With every hauler idle it would raise the hauler target
      // and buy more of them, so the demand is withheld until hauling resumes.
      const saturation = harvesters / Math.max(1, refinery);
      // One drop-off is enough for a recruit: expanding the economy is a
      // judgement about round-trip time, and a novice keeps feeding the same
      // mouth instead of compounding its income.
      if (ctx.profile.difficulty !== 'recruit' && refinery < 3 && saturation >= 1.75) {
        // A saturated economy is where a second drop-off pays for itself many
        // times over, so it is a plan rather than an impulse: once most of the
        // price is in hand the planner withholds the rest, and the field army
        // stops eating every material the moment it arrives. Requiring the whole
        // price up front meant a commander that kept producing units never got
        // there at all — it spent its income as fast as it earned it, and only a
        // level that happened to bank (because its army was capped) compounded
        // its economy. Economy is a judgement call, so it belongs in the plan.
        add(
          'refinery',
          58 + ctx.profile.economy * 30 + jitter(),
          'saturated harvester round trips',
          false,
          true,
          true,
        );
      }
    }

    if (!barracks) add('barracks', opening.barracks + jitter(), 'infantry production', true);
    else if (barracks < 2 && ctx.strategy === 'infantry' && bank > 1600) {
      add('barracks', 48 + jitter(), 'second infantry queue');
    }

    // A perimeter is an investment in a base nobody has attacked yet, and a
    // recruit does not make it: it spends every material on the field army and
    // leaves its structures to the garrison. That is the difference a raid is
    // meant to find on the easy setting, and it is why a recruit's expansions
    // are the first things to burn.
    const defenceNeed =
      ctx.profile.difficulty === 'recruit'
        ? null
        : nextDefenceBuild(ctx.mix, {
            atTurret: counts.get('atTurret') ?? 0,
            mgNest: counts.get('mgNest') ?? 0,
          });
    if (defenceNeed) {
      const scouted = ctx.mix.armour + ctx.mix.infantry > 0;
      const pressure =
        (scouted ? 38 : 0) +
        (threat ? 55 : 0) +
        (damaged ? 35 : 0) +
        ctx.profile.defence * 28;
      // While the core is incomplete, the perimeter waits unless something has
      // actually been seen or hit.
      const coreReady = factory > 0 && refinery > 0 && barracks > 0;
      // A base with no perimeter at all and a landing already reported answers
      // the report before the next piece of concrete. The report is the only
      // warning a commander gets, and a brownout power plant was taking the one
      // construction slot the base had, so the nest the scouts had just called
      // for was still unaffordable when the first wave arrived. Scoring higher
      // was not enough: essentials are placed ahead of everything by score, so
      // the perimeter joins that programme while the base is undefended and the
      // force has actually been seen. Once a gun stands it competes on its
      // ordinary score again.
      const undefended =
        (counts.get('mgNest') ?? 0) + (counts.get('atTurret') ?? 0) === 0;
      if (coreReady || scouted || threat || damaged) {
        add(
          defenceNeed,
          (coreReady ? 78 : 40) + pressure + jitter(),
          defenceNeed === 'atTurret'
            ? `anti-armour perimeter (${ctx.mix.armour} vehicles scouted)`
            : `anti-infantry perimeter (${ctx.mix.infantry} foot scouted)`,
          undefended && scouted,
        );
      }
    }

    if (!airfield) {
      // An airfield is the only way to field the roster's reconnaissance drone.
      // A long-range eye is worth a structure the shared jet alone does not
      // justify once the base is complete; how much depends on the optics the
      // roster actually fields, so a nation without a drone slot earns nothing.
      const coreReady =
        (counts.get('factory') ?? 0) > 0 &&
        (counts.get('refinery') ?? 0) > 0 &&
        (counts.get('barracks') ?? 0) > 0;
      const droneId = ctx.game.unitIdFor(ctx.aiId, 'uav');
      const droneReach = droneId ? (UNITS[droneId]?.vision ?? 0) : 0;
      const reconWorth = coreReady && droneReach >= 20 ? 44 + (droneReach - 20) * 2 : 0;
      // Air Operations is what unlocked this option. A commander that has paid
      // for the branch follows through: the field is worth more than a second
      // refinery or a radar, otherwise the study buys nothing it can fly.
      const branchPaid = ctx.game.buildingSlotUnlocked(ctx.aiId, 'airfield') ? 40 : 0;
      // A nation that actually fields airframes wants somewhere to base them.
      // Shared deadlock: neither commander buys a strip because neither sees
      // hostile air, so no airframe ever reaches a land battle and the air half
      // of every national kit is dead weight. Reading the roster rather than
      // the enemy breaks it without teaching the AI anything it could not know.
      const rosterAir = ctx.game
        .rosterFor(ctx.aiId)
        .units.some((id) => UNITS[id]?.domain === 'air');
      const score =
        (ctx.strategy === 'air' ? 148 : ctx.profile.tech > 0.58 ? 52 + ctx.profile.tech * 50 : 0) +
        opening.air +
        reconWorth +
        branchPaid +
        (rosterAir ? 20 : 0) +
        (ctx.enemyAir > 0 ? 24 : 0);
      if (score > 0) {
        add(
          'airfield',
          score + jitter(),
          reconWorth > 0 ? 'reconnaissance aviation' : 'air operations',
          false,
          true,
        );
      }
    }
    else {
      // A flight line is a hard cap now, not a parking count: four airframes
      // assigned to a strip means the queue refuses a fifth even while the
      // first four are in the air. A commander that still wants air power lays
      // another strip instead of leaving a researched branch with nowhere to
      // fly from. Three is the practical ceiling; beyond that the army pays for
      // concrete it will never fill.
      const strips = ctx.complete.filter((b) => buildingFamily(b.defId) === 'airfield');
      const full =
        strips.length > 0 &&
        strips.every((b) => {
          const dock = ctx.game.dockStatus(b.id);
          return !!dock && dock.fixedWing.used >= dock.fixedWing.capacity;
        });
      const wantsAir = ctx.strategy === 'air' || ctx.enemyAir > 0 || ctx.profile.tech > 0.58;
      if (full && wantsAir && strips.length < 3 && bank > 1000) {
        add('airfield', 78 + jitter(), 'flight line at capacity', false, true);
      }
    }
    // A helicopter force needs its own facility: an airfield's pad recovers a
    // damaged gunship but can neither base nor build one. The commander studies
    // the node that grants the heliport, then follows through with the structure,
    // because a researched rotary branch with nowhere to base it buys nothing.
    // The rotary branch is force expansion, not an opening: a commander that
    // spends its first bank on a heliport has no army to escort the gunships it
    // would build there. The structure is weighed once the ground force exists
    // and the bank can absorb it, the same way a second production line is.
    if (
      (counts.get('heliport') ?? 0) === 0 &&
      ctx.combat.length >= 6 &&
      bank > 1100 &&
      ctx.game.buildingSlotUnlocked(ctx.aiId, 'heliport')
    ) {
      const heloId = ctx.game.unitIdFor(ctx.aiId, 'attackHelo');
      if (heloId) {
        const score =
          76 +
          ctx.profile.tech * 26 +
          (ctx.strategy === 'air' ? 48 : 0) +
          (ctx.mix.armour > 0 ? 18 : 0) +
          jitter();
        add('heliport', score, 'rotary aviation', false, true);
      }
    }
    else {
      // Two pads per port is the same hard cap, so a rotary commander that has
      // filled its first heliport opens a second one rather than sitting on two
      // airframes for the rest of the match.
      const ports = ctx.complete.filter((b) => buildingFamily(b.defId) === 'heliport');
      const full =
        ports.length > 0 &&
        ports.every((b) => {
          const dock = ctx.game.dockStatus(b.id);
          return !!dock && dock.helo.used >= dock.helo.capacity;
        });
      if (full && ports.length < 2 && ctx.combat.length >= 6 && bank > 1400) {
        add('heliport', 64 + jitter(), 'rotary bays at capacity', false, true);
      }
    }
    if (!shipyard && ctx.hasWater) {
      const branchPaid = ctx.game.buildingSlotUnlocked(ctx.aiId, 'shipyard') ? 35 : 0;
      // Same reasoning as the flight line: a nation whose roster carries hulls
      // deserves a yard on a map with water even before an enemy fleet has been
      // sighted.
      const rosterNaval = ctx.game
        .rosterFor(ctx.aiId)
        .units.some((id) => UNITS[id]?.domain === 'naval');
      const score =
        44 + ctx.profile.tech * 34 + opening.naval + branchPaid +
        (rosterNaval ? 20 : 0) +
        (ctx.known.some((e) => UNITS[e.defId]?.domain === 'naval') ? 36 : 0) +
        (ctx.strategy === 'economy' ? 10 : 0);
      // No bank gate: the option already requires the naval branch to be open,
      // and the planner's facility save is what buys it. A 900-material entry
      // test meant the yard was never even considered by the commanders that
      // spend their bank every think — which is every commander — so the branch
      // was studied and the hulls never reached the water.
      add('shipyard', score + jitter(), 'coastal production', false, true);
    }
    if ((counts.get('samBattery') ?? 0) === 0) {
      // A flight line is the threat, not only an airframe already overhead: a
      // hostile strip is a strike wing that has not launched yet, and a
      // commander that waits for the first sortie to buy its battery answers it
      // one raid late. The commander's own strip earns one too — air power
      // invites counter-air.
      const enemyStrip = ctx.known.some(
        (e) => e.kind === 'building' && !!BUILDINGS[e.defId]?.airfield,
      );
      const ownStrip = ctx.complete.some((b) => !!BUILDINGS[b.defId]?.airfield);
      if (ctx.enemyAir > 0) add('samBattery', 178 + jitter(), 'hostile air contact', false, true);
      else if (enemyStrip) add('samBattery', 96 + jitter(), 'hostile flight line', false, true);
      // Owning a strip is a reason to want a battery in the sky, not a reason to
      // buy one before the economy that pays for it: the threat is a strike wing
      // that has not launched yet, so the battery waits behind a drop-off or a
      // radar and is bought on the next quiet bank. A sighted flight line above
      // keeps the higher score, because that is a wing that exists.
      else if (ownStrip) add('samBattery', 40 + jitter(), 'counter-air for own strip', false, true);
      else if (bank > 2200 && ctx.profile.tech > 0.5) add('samBattery', 38 + jitter(), 'air defence hedge');
    }
    if (
      ctx.hasWater &&
      (counts.get('coastalBattery') ?? 0) === 0 &&
      ctx.enemyNaval > 0
    ) {
      add('coastalBattery', 164 + jitter(), 'hostile naval contact');
    }
    if ((counts.get('radar') ?? 0) === 0 && bank > 1400 && ctx.profile.economy > 0.55) {
      // Vision is an economy: a radar keeps contacts fresh so the army is not
      // repeatedly sent at stale coordinates.
      add('radar', 34 + ctx.profile.economy * 22 + jitter(), 'battlefield surveillance');
    }

    // The Research Centre is a strategic investment, not another utility. It is
    // considered once the economy, a production line and a barracks stand — and
    // only when the tree holds something this commander still wants that its
    // bank can cover afterwards. A centre is skipped entirely while one is
    // already standing or being built: the match allows exactly one, and the
    // placement command would refuse a second foundation.
    const centreUnderConstruction = ctx.buildings.some(
      (b) => buildingFamily(b.defId) === 'researchCentre',
    );
    if ((counts.get('researchCentre') ?? 0) === 0 && !centreUnderConstruction) {
      const coreReady = factory > 0 && refinery > 0 && barracks > 0;
      const wanted = this.researchOptions(ctx)[0];
      if (
        coreReady &&
        wanted &&
        wanted.score >= RESEARCH_MIN_SCORE &&
        bank >= 250 &&
        ctx.player.req >= 40
      ) {
        // A thin grid margin does not forbid the centre, it only postpones it:
        // the brownout power plant above outranks everything while the deficit
        // lasts. The draw is 30, which is why the margin is read here at all.
        const powerFactor = powerGap >= 30 ? 1 : powerGap >= 15 ? 0.7 : 0.4;
        // The centre is the gate every later tier stands behind: the artillery, the
        // flight line and the yard all sit behind it. Scored as one more optional
        // facility it was outbid by a 200-material nest on every think, so no
        // technology past the opening was ever studied in a live match. It is
        // core programme instead, and weighted to be laid ahead of optional
        // concrete once it is funded.
        const score =
          (240 + ctx.profile.tech * 60 + Math.min(40, wanted.score * 22)) * powerFactor;
        // Planned, not merely scored: a centre is the only route to every
        // branch tier, and an economy that spends its bank to zero every think
        // never accumulated the price on its own. Holding the last third of the
        // cost is what turns "someday" into a standing facility, and the army
        // still buys until the bank is nearly there.
        // Core infrastructure, not a late luxury. Every branch tier — the
        // artillery, the flight line, the yard — sits behind this one building,
        // so it belongs to the base programme the commander saves for rather
        // than to the optional list a spending army never reaches. It is still
        // gated on the core standing, a wanted project and enough of the price
        // to be a plan instead of a hole in the bank.
        add(
          'researchCentre',
          score + jitter(),
          `research capability (${wanted.reason})`,
          true,
          true,
        );
      }
    }

    // The Strategic Operations Centre is the last piece of infrastructure, not
    // an early one: it is considered once a Research Centre stands and the
    // authority chain is at least under way. A commander that has finished all
    // four technologies wants it now; one still studying wants it shortly.
    const family = ctx.game.superweaponEnabled()
      ? ctx.game.superweaponFamilyFor(ctx.aiId)
      : null;
    const opsUnderConstruction = ctx.buildings.some(
      (b) => buildingFamily(b.defId) === 'strategicOps',
    );
    const opsId = family ? ctx.game.buildingIdFor(ctx.aiId, 'strategicOps') : undefined;
    if (
      family &&
      opsId &&
      !opsUnderConstruction &&
      (counts.get('strategicOps') ?? 0) === 0 &&
      (counts.get('researchCentre') ?? 0) > 0 &&
      // Same late-war rule as the research planner: the centre follows the
      // branches it coordinates, never displaces them.
      (counts.get('airfield') ?? 0) > 0 &&
      (!ctx.hasWater || (counts.get('shipyard') ?? 0) > 0) &&
      !ctx.game.buildingRestrictedByOperation(ctx.aiId, opsId)
    ) {
      const done = new Set(ctx.game.completedTechnologies(ctx.aiId));
      const remaining = family.requires.filter((id) => !done.has(id)).length;
      const cost = BUILDINGS[opsId]?.cost.mats ?? 1200;
      if (remaining === 0) {
        if (bank >= cost) add('strategicOps', 128 + jitter(), 'national strategic call-in', false, true);
        else add('strategicOps', 96 + jitter(), 'national strategic call-in', false, true);
      } else if (remaining <= 2 && bank >= cost) {
        add('strategicOps', 44 + jitter(), 'strategic infrastructure', false, true);
      }
    }

    return options.sort((a, b) => b.score - a.score || a.defId.localeCompare(b.defId));
  }

  /**
   * Materials production must leave alone while it waits for an essential
   * structure. Normally that is the shortfall to the price, so ordinary play
   * keeps its army. With no drop-off at all the economy is dead until one
   * stands, so the whole price is held back: every material the base still has
   * — or still trickles in — belongs to the building that restores income.
   */
  private savingReserve(ctx: AIContext, def: BuildingDef): number {
    const refineryId = ctx.game.buildingIdFor(ctx.aiId, 'refinery');
    // A refinery already under construction counts: income is on its way, so
    // ordinary production continues. Only a base with none at all — and none
    // being built — holds the whole price back.
    const anyDropOff =
      refineryId === undefined ||
      ctx.buildings.some((b) => b.hp > 0 && b.defId === refineryId);
    if (!anyDropOff && def.id === refineryId) return def.cost.mats;
    return Math.max(0, def.cost.mats - ctx.player.mats);
  }

  /**
   * The engineer is the only unit that restores construction, and construction
   * is the only route back into income once the last drop-off is gone. Without
   * one the commander cannot spend on anything that recovers the base, so the
   * whole price is held back until the replacement is affordable — the same
   * rule the drop-off uses, one level up. The reserve releases the moment an
   * engineer exists or is queued, when no facility can train it, or when the
   * bank already covers it (the engineer is the first demand, so it then buys
   * itself). It never runs beside the drop-off reserve: that one requires an
   * engineer, this one requires the absence of an engineer.
   *
   * It is gated on a *broken* economy, not merely a missing engineer: a base
   * with a completed drop-off and a hauler still earns, so buying the engineer
   * costs seconds and the army should not pause. The states held for are the
   * ones where the one-per-second lifeline is the only income left: no drop-off
   * (or only an unfinished site, which itself needs the engineer), or a
   * drop-off with no hauler to feed it.
   */
  private engineerReserve(ctx: AIContext): number {
    if (ctx.engineer) return 0;
    const refineries = ctx.counts.get('refinery') ?? 0;
    const haulers = ctx.unitCounts.get('harvester') ?? 0;
    if (refineries > 0 && haulers > 0) return 0;
    const engineerId = ctx.game.unitIdFor(ctx.aiId, 'engineer');
    const def = engineerId ? UNITS[engineerId] : undefined;
    if (!engineerId || !def) return 0;
    // A replacement already in a queue is the recovery, not a reason to stop.
    if ((this.queuedCounts(ctx).get(engineerId) ?? 0) > 0) return 0;
    // `productionStatus` folds affordability into `ok`, which is exactly the
    // state this reserve exists for, so ask the roster and the facility only.
    // The command post hands the engineer slot back while a factory stands.
    const facility = ctx.complete.some((b) => {
      if (!ctx.game.productionEntries(ctx.aiId, b.defId).includes(engineerId)) return false;
      if (b.defId === 'commandPost' && ctx.complete.some((o) => o.defId === 'factory')) {
        return false;
      }
      return true;
    });
    if (!facility) return 0;
    // Without the requisition there is no legal purchase to hold for; spending
    // it on the army is strictly better than freezing production forever.
    if (ctx.player.req < def.cost.req) return 0;
    return def.cost.mats;
  }

  /**
   * The hauler half of the same rule.
   *
   * A base with a drop-off and no hauler is an absorbing state: nothing it owns
   * can earn, so the lifeline is the only income left. A rifleman's 130 arrives
   * long before a hauler's 500, and without this reserve production spends the
   * lifeline on the army a few seconds at a time while the economy stays dead —
   * the trap the ladder showed an early raid could put a commander into.
   *
   * The reserve is paid only while the base can actually train a hauler (the
   * vehicle factory, or the headquarters fallback once the factory is gone),
   * only with a drop-off standing to tip into, and it releases the moment a
   * hauler exists or is queued. A base with no drop-off is the drop-off and
   * engineer reserves' problem, and it holds nothing here.
   */
  private haulerReserve(ctx: AIContext): number {
    if ((ctx.unitCounts.get('harvester') ?? 0) > 0) return 0;
    if ((ctx.counts.get('refinery') ?? 0) === 0) return 0;
    // A drained map is not a broken economy: the lifeline keeps paying with a
    // hauler standing, so hoarding for one that has nothing left to mine would
    // hold the bank hostage for the rest of the match.
    if (!ctx.game.hasRemainingOre()) return 0;
    const harvesterId = ctx.game.unitIdFor(ctx.aiId, 'harvester');
    const def = harvesterId ? UNITS[harvesterId] : undefined;
    if (!harvesterId || !def) return 0;
    if ((this.queuedCounts(ctx).get(harvesterId) ?? 0) > 0) return 0;
    const factory = ctx.complete.some((b) => b.defId === 'factory');
    const facility = ctx.complete.some((b) => {
      if (!ctx.game.productionEntries(ctx.aiId, b.defId).includes(harvesterId)) return false;
      // The command post hands the hauler slot back while a factory stands, so
      // asking it would only produce a refused order.
      if (b.defId === 'commandPost' && factory) return false;
      return true;
    });
    if (!facility) return 0;
    if (ctx.player.req < def.cost.req) return 0;
    return def.cost.mats;
  }

  private manageConstruction(ctx: AIContext): { mats: number; req: number } {
    const site = ctx.buildings.find((e) => e.construction);
    if (site) {
      this.watchConstruction(ctx, site);
      return { mats: ctx.player.mats, req: ctx.player.req };
    }
    ctx.st.activeSiteId = 0;
    ctx.st.activeSiteProgress = 0;

    if (!ctx.engineer) {
      ctx.st.lastDecision = 'no engineer — scheduling replacement';
      return { mats: ctx.player.mats, req: ctx.player.req };
    }
    if (ctx.engineer.order) return { mats: ctx.player.mats, req: ctx.player.req };

    // A structure below 60% is a liability: patch it before laying new concrete.
    if (this.repairStructures(ctx, 0.6)) {
      return { mats: ctx.player.mats, req: ctx.player.req };
    }

    const options = this.buildOptions(ctx);
    if (options.length === 0) return { mats: ctx.player.mats, req: ctx.player.req };
    const affordable = options
      .filter((option) => {
        const def = BUILDINGS[option.defId];
        return !!def && ctx.player.mats >= def.cost.mats && ctx.player.req >= def.cost.req;
      })
      // Core programme first: a facility the base cannot work without — a
      // plant, a drop-off, the research centre — is placed ahead of optional
      // concrete even when the optional building scores higher. Ordering by
      // score alone let a cheap nest take the bank the commander had just
      // finished saving for, so the centre was never laid.
      .sort((a, b) => Number(b.essential) - Number(a.essential) || b.score - a.score);
    const top = options[0];
    // The next drop-off comes out of the income as it arrives, and that decision
    // is taken before the "nothing is affordable" exit below: that exit is
    // exactly where a commander with a field army to replace spends the rest of
    // its bank, and it is where a second refinery used to die. A saturated field
    // means the army is already as large as the economy can carry, so half of
    // every material goes to the yard while the other half still buys hulls.
    // Nothing is withheld while the base is under attack.
    const plannedEconomy = options.find(
      (option) =>
        option.economy && !affordable.some((other) => other.defId === option.defId),
    );
    // A planned drop-off may hold the bank, but only while it is the best thing
    // the commander could actually do. It used to pre-empt the affordable list
    // outright, so a saturating economy froze 35% of every bank — including the
    // research centre and flight line that outranked it and were already paid
    // for. Anything affordable above it is a better use of the same materials.
    // Only something that actually plans better outranks the drop-off. The
    // check used to be "anything affordable", so a cheap optional nest that
    // scored below the refinery vetoed the hold and the bank was spent on it.
    const outranksEconomy = affordable.find(
      (option) => option.defId !== plannedEconomy?.defId,
    );
    if (plannedEconomy && !top?.essential && !outranksEconomy) {
      const def = BUILDINGS[plannedEconomy.defId];
      if (def) {
        const shortfall = Math.max(0, def.cost.mats - ctx.player.mats);
        // A site that cannot be found must not become a savings account: holding
        // for a drop-off the engineer has nowhere to lay would starve the army
        // for the rest of the match. Under attack the share drops rather than
        // vanishing — the point is progress, not a freeze.
        const site = shortfall > 0 ? this.findBuildSite(ctx, ctx.engineer!, plannedEconomy.defId) : null;
        // Spending pauses for the drop-off, the way a player stops buying hulls
        // to raise a refinery. Holding a share of the bank never got there: a
        // commander with a full army plan to replace spends faster than it earns,
        // so a share of nearly nothing is nearly nothing. It keeps a garrison's
        // worth of production under fire, and never past the price it is saving.
        const baseThreat = ctx.threats.some(
          (e) => dist(e.x, e.z, ctx.baseX, ctx.baseZ) < 10 * TILE_SIZE,
        );
        const pause = !baseThreat && ctx.combat.length >= 3;
        const held =
          shortfall > 0 && site
            ? pause
              ? Math.min(shortfall, ctx.player.mats)
              : Math.floor(ctx.player.mats * 0.35)
            : 0;
        if (held > 0) {
          ctx.st.lastDecision = `saving for ${plannedEconomy.defId} — ${plannedEconomy.reason}`;
          // Remember that the bank is being held for this drop-off. The build
          // order below finishes such a plan when the price arrives; without
          // the marker it would also jump ahead of the queue for any drop-off
          // the base simply happens to be able to afford.
          ctx.st.economyPlanTick = ctx.game.state.tick;
          return {
            mats: Math.max(0, ctx.player.mats - held),
            req: ctx.player.req,
          };
        }
      }
    }
    if (affordable.length === 0) {
      // Nothing can be built. Put the engineer to work patching the base while
      // the bank recovers instead of idling next to a damaged structure.
      if (this.repairStructures(ctx)) return { mats: ctx.player.mats, req: ctx.player.req };
      if (top?.essential) {
        const def = BUILDINGS[top.defId];
        const reserve = def ? this.savingReserve(ctx, def) : 0;
        ctx.st.lastDecision = `saving for ${top.defId} — ${top.reason}`;
        return {
          mats: Math.max(0, ctx.player.mats - reserve),
          req: ctx.player.req,
        };
      }
      return { mats: ctx.player.mats, req: ctx.player.req };
    }

    // A researched facility the commander is saving towards holds the last third
    // of its price. It is checked after the essential branch so a missing
    // factory or drop-off always wins the bank, and the reserve is only the
    // shortfall, so the army keeps spending until the price is nearly in hand.
    // Only a plan the engineer can actually lay is worth saving for. A flight
    // line with no legal strip left on the map used to hold the bank forever —
    // and because the hold returns before the rest of the list, it starved every
    // other facility behind it, including the yard the commander had also
    // researched. A candidate without a site is skipped, not funded.
    let planned: (typeof options)[number] | undefined;
    for (const candidate of options) {
      if (!candidate.planned) continue;
      if (affordable.some((other) => other.defId === candidate.defId)) continue;
      if (!this.findBuildSite(ctx, ctx.engineer!, candidate.defId)) continue;
      planned = candidate;
      break;
    }
    if (planned && !top?.essential) {
      const def = BUILDINGS[planned.defId];
      if (def) {
        // A branch facility is the structure the commander already researched
        // towards: an airfield, a shipyard, a heliport or the research centre
        // itself. Waiting until seven tenths of its price is banked meant it was
        // never saved for at all — the army drained the bank every think and the
        // branch stayed a technology with nothing on the field to show for it.
        // Such a facility starts holding its shortfall at four tenths, which is
        // still a plan rather than a freeze: cheaper purchases continue with the
        // rest until the concrete is poured.
        const branchFacility = !!(def.airfield || def.shipyard || def.researchSpeed);
        const threshold = branchFacility ? 0.4 : 0.7;
        const nearlyThere =
          ctx.player.mats >= def.cost.mats * threshold &&
          ctx.player.req >= def.cost.req * threshold;
        const held = nearlyThere ? Math.max(0, def.cost.mats - ctx.player.mats) : 0;
        if (held > 0) {
          ctx.st.lastDecision = `saving for ${planned.defId} — ${planned.reason}`;
          return {
            mats: Math.max(0, ctx.player.mats - held),
            req: ctx.player.req,
          };
        }
      }
    }

    // Do not spend the bank on a cheap optional building while an essential
    // one is close to affordable.
    if (top?.essential && !affordable.some((o) => o.defId === top.defId)) {
      if (this.repairStructures(ctx)) return { mats: ctx.player.mats, req: ctx.player.req };
      const def = BUILDINGS[top.defId];
      const reserve = def ? this.savingReserve(ctx, def) : 0;
      ctx.st.lastDecision = `saving for ${top.defId} — ${top.reason}`;
      return {
        mats: Math.max(0, ctx.player.mats - reserve),
        req: ctx.player.req,
      };
    }

    // A standing centre with a chosen project outranks optional concrete. The
    // bank has to reach the study price, and fifteen affordable nests — one per
    // think — were exactly what kept it from ever getting there, so a commander
    // that has already paid for the laboratory never studied anything in it.
    const pendingStudy =
      (ctx.counts.get('researchCentre') ?? 0) > 0 && !ctx.player.research.project
        ? this.researchOptions(ctx)[0]
        : undefined;
    const pendingTech = pendingStudy ? techDef(pendingStudy.techId, ctx.game.research) : undefined;
    if (
      pendingTech &&
      (ctx.player.mats < pendingTech.cost.mats || ctx.player.req < pendingTech.cost.req) &&
      !affordable.some((option) => option.essential)
    ) {
      ctx.st.lastDecision = `holding the bank for ${pendingTech.id}`;
      return { mats: ctx.player.mats, req: ctx.player.req };
    }
    // A drop-off the commander has been saving for is finished before other
    // concrete as soon as the price is in hand. The research centre and the
    // headroom plant both win the essential-first sort, so a base that reached
    // the 600-material price spent it on them instead and never expanded: the
    // bank crossed the price, lost it, and crossed it again. Only a drop-off
    // the commander actually set materials aside for is finished this way, and
    // only while the bank is just enough for it — a funded base plans normally.
    const planAge =
      ctx.st.economyPlanTick === undefined
        ? Number.POSITIVE_INFINITY
        : ctx.game.state.tick - ctx.st.economyPlanTick;
    const finishingEconomy =
      planAge <= 20 * 60
        ? affordable.find((option) => {
            if (!option.economy) return false;
            const cost = BUILDINGS[option.defId]?.cost.mats ?? 0;
            return ctx.player.mats < cost + 300;
          })
        : undefined;
    for (const option of finishingEconomy ? [finishingEconomy, ...affordable] : affordable) {
      // A pending rebuild reserve owns the bank while the bank is still short
      // of it. The reserves exist so the lifeline can buy the hauler or engineer
      // that earns; letting an optional structure dip into that same shortfall
      // is the starvation one level up (a 380-material radar placed at 401
      // materials delayed the 500-material hauler by minutes). Essential
      // structures are the other half of the same recovery and are still
      // placed, and a funded bank is never held back.
      // The engineer is the first link in the chain, so its reserve takes
      // precedence rather than the larger of the two.
      const rebuildReserve = this.engineerReserve(ctx) || this.haulerReserve(ctx);
      const price = BUILDINGS[option.defId]?.cost.mats ?? 0;
      if (
        !option.essential &&
        rebuildReserve > 0 &&
        ctx.player.mats - price < rebuildReserve
      ) {
        ctx.st.lastDecision = 'holding the bank for a replacement economy unit';
        continue;
      }
      const siteChoice = this.findBuildSite(ctx, ctx.engineer, option.defId);
      if (!siteChoice) continue;
      const def = BUILDINGS[option.defId];
      if (!def) continue;
      const issued = this.order(ctx, ctx.engineer, {
        type: 'placeBuilding',
        team: ctx.aiId,
        builderId: ctx.engineer.id,
        defId: option.defId,
        tileX: siteChoice.x,
        tileZ: siteChoice.z,
      });
      if (!issued) return { mats: ctx.player.mats, req: ctx.player.req };
      ctx.st.activeSiteId = 0;
      ctx.st.activeSiteTick = ctx.game.state.tick;
      ctx.st.lastDecision = `building ${option.defId} — ${option.reason}`;
      if (option.economy) delete ctx.st.economyPlanTick;
      return {
        mats: Math.max(0, ctx.player.mats - def.cost.mats),
        req: Math.max(0, ctx.player.req - def.cost.req),
      };
    }
    return { mats: ctx.player.mats, req: ctx.player.req };
  }

  /** Repair the worst local damage while construction is not the priority. */
  private repairStructures(ctx: AIContext, threshold = 0.85): boolean {
    const engineer = ctx.engineer;
    if (!engineer || !this.free(engineer)) return false;
    const worst = ctx.complete
      .filter(
        (b) =>
          b.hp < b.maxHp * threshold &&
          // A crew cannot work under shellfire, so an engineer sent to an
          // actively bombarded structure would simply stand there. Let it build
          // or repair something else until the firing lapses.
          ctx.game.state.tick - b.lastHitTick >= REPAIR_SUPPRESSION_TICKS &&
          dist(b.x, b.z, engineer.x, engineer.z) < 70 * TILE_SIZE,
      )
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!worst) return false;
    const issued = this.order(ctx, engineer, {
      type: 'repair',
      team: ctx.aiId,
      ids: [engineer.id],
      targetId: worst.id,
    });
    if (issued) ctx.st.lastDecision = `repairing ${worst.defId} at ${Math.round((worst.hp / worst.maxHp) * 100)}%`;
    return issued;
  }

  /**
   * One stalled site is enough to freeze an opening. Watch measurable progress,
   * release the site after 45 seconds, and let the planner choose a different
   * site instead of retrying the same unreachable approach forever.
   */
  private watchConstruction(ctx: AIContext, site: Entity): void {
    const st = ctx.st;
    if (st.activeSiteId !== site.id) {
      st.activeSiteId = site.id;
      st.activeSiteProgress = site.buildProgress;
      st.activeSiteTick = ctx.game.state.tick;
      return;
    }
    if (site.buildProgress > st.activeSiteProgress + 0.0005) {
      st.activeSiteProgress = site.buildProgress;
      st.activeSiteTick = ctx.game.state.tick;
      return;
    }
    if (ctx.game.state.tick - st.activeSiteTick <= 20 * 45) return;
    // A crew still walking to the foundation is not a stall. Only a crew that
    // has arrived and still cannot move the work, or has been called away and
    // left it, says the site is dead — and reclaiming a site the platoon was
    // about to reach threw away half its price, after which the commander
    // re-sited the same facility elsewhere and stalled that one too.
    const crewWalking =
      !!ctx.engineer && !ctx.engineer.order && ctx.engineer.state === 'moving';
    if (crewWalking) {
      st.activeSiteTick = ctx.game.state.tick;
      return;
    }
    const abandoned = ctx.game.abandonConstruction(ctx.aiId, site.id, 0.5);
    st.activeSiteId = 0;
    st.activeSiteProgress = 0;
    if (abandoned) {
      st.lastDecision = `abandoned stalled ${site.defId}; reclaiming half the cost`;
    }
  }

  private findBuildSite(
    ctx: AIContext,
    engineer: Entity,
    defId: string,
  ): { x: number; z: number } | null {
    const def = BUILDINGS[defId];
    if (!def) return null;
    const map = ctx.game.state.map;
    const cx = Math.floor(ctx.baseX / TILE_SIZE);
    const cz = Math.floor(ctx.baseZ / TILE_SIZE);
    const preferred = def.weapons?.length
      ? 9
      : def.airfield
        ? 11
        : def.shipyard
          ? 12
          : def.refinery
            ? 6
            : 6.5;
    let best: { x: number; z: number; score: number } | null = null;
    for (let radius = 2; radius <= 16; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (!ctx.game.placementStatus(ctx.aiId, defId, x, z, engineer.id, true).ok) continue;
          const wx = (x + def.footprint.w / 2) * TILE_SIZE;
          const wz = (z + def.footprint.h / 2) * TILE_SIZE;
          const fromBase = dist(wx, wz, ctx.baseX, ctx.baseZ) / TILE_SIZE;
          let score = -Math.abs(fromBase - preferred) * 1.4;
          score -= dist(wx, wz, engineer.x, engineer.z) / TILE_SIZE * 0.8;
          if (def.refinery) {
            let ore = 0;
            for (let oz = -7; oz <= 7; oz++) {
              for (let ox = -7; ox <= 7; ox++) {
                const tx = x + ox;
                const tz = z + oz;
                if (tx < 0 || tz < 0 || tx >= map.width || tz >= map.height) continue;
                const amount = map.ore[tileIndex(map.width, tx, tz)];
                if (amount > 0) ore += 1 + (7 - Math.max(Math.abs(ox), Math.abs(oz))) * 0.2;
              }
            }
            score += Math.min(40, ore) * (0.7 + ctx.profile.economy * 0.5);
          }
          if (def.weapons?.length) {
            // Site the perimeter between the base and the reported threat,
            // otherwise spread it around the base rather than stacking it.
            const threat = ctx.threats[0];
            if (threat) {
              const toThreat = dist(wx, wz, threat.x, threat.z) / TILE_SIZE;
              score += Math.max(0, 14 - Math.abs(toThreat - 9)) * 1.1;
              score -= dist(wx, wz, threat.x, threat.z) / TILE_SIZE * 0.05;
            } else {
              const angle = Math.atan2(wz - ctx.baseZ, wx - ctx.baseX);
              score += Math.abs(Math.sin(angle * 2)) * 2.5;
            }
          }
          if (def.shipyard) score += 4;
          if (def.airfield) score += 3;
          // Avoid crowding the same approach with units and structures the
          // commander knows about. Hidden enemies must not push a site away.
          let crowd = 0;
          for (const e of ctx.game.state.entities) {
            if (e.hp <= 0) continue;
            if (!knownForCrowding(ctx.game, ctx.aiId, e)) continue;
            if (dist(wx, wz, e.x, e.z) < (Math.max(def.footprint.w, def.footprint.h) * TILE_SIZE) / 2 + 3 * TILE_SIZE) {
              crowd++;
            }
          }
          score -= crowd * 1.1;
          score += this.random(ctx) * 2.2;
          if (!best || score > best.score) best = { x, z, score };
        }
      }
    }
    return best ? { x: best.x, z: best.z } : null;
  }

  /* ---------------------------------------------------------------------- */
  /* Production                                                             */
  /* ---------------------------------------------------------------------- */

  private queuedCounts(ctx: AIContext): Map<string, number> {
    const queued = new Map<string, number>();
    for (const building of ctx.complete) {
      for (const item of building.queue) {
        queued.set(item.defId, (queued.get(item.defId) ?? 0) + 1);
      }
    }
    return queued;
  }

  private desiredUnits(ctx: AIContext): UnitDemand[] {
    const queued = this.queuedCounts(ctx);
    const entries: UnitDemand[] = [];
    // Demand is written against baseline slots. Resolution turns a slot into the
    // nation's actual unit, so a replacement is bought instead of the excluded
    // baseline id, and an excluded ability is simply not requested.
    const need = (slotId: string, target: number, priority: number, saveFor?: number): void => {
      const defId = ctx.game.unitIdFor(ctx.aiId, slotId);
      if (!defId) return;
      const count = (ctx.unitCounts.get(slotId) ?? 0) + (queued.get(defId) ?? 0);
      if (count < target) {
        // Doctrine and adaptation are clamped together, not separately: two
        // individually modest multipliers still combine into a priority the
        // authored profile never asked for. The clamp is the doctrine's own
        // band, so recognition can sharpen a commander but never replace it.
        const doctrine = Math.max(
          0.7,
          Math.min(
            1.7,
            commanderWeight(ctx.st.commanderId, 'production', slotId) *
              adaptProduction(ctx.read, slotId),
          ),
        );
        entries.push({
          defId,
          priority: priority * doctrine,
          deficit: (target - count) / Math.max(1, target),
          short: target - count,
          saveFor,
        });
      }
    };

    const refineries = ctx.counts.get('refinery') ?? 0;
    if (!ctx.engineer) need('engineer', 1, 240);
    if (refineries > 0 && !ctx.haulingIdle) {
      // Economy difficulty is a crewing decision, not a resource multiplier:
      // a recruit keeps one hauler per refinery, elite saturates the drop-offs.
      const haulerTarget =
        ctx.profile.difficulty === 'recruit'
          ? Math.min(2, refineries)
          : ctx.profile.difficulty === 'elite'
            ? Math.min(5, refineries + 2)
            : Math.min(3, refineries + 1);
      need('harvester', haulerTarget, 190);
    }

    // Scouting is a requirement while the enemy is missing, not a fixed two.
    // An unarmed scout is not a screen: three of them range into the open and
    // die one at a time, so the unarmed substitution is bought as a single
    // protected eye instead of a triad of free kills.
    const reconId = ctx.game.unitIdFor(ctx.aiId, 'recon');
    const reconUnarmed = reconId !== undefined && (UNITS[reconId]?.weapons.length ?? 0) === 0;
    const reconTarget = ctx.st.targetKnown ? 1 : reconUnarmed ? 1 : 3;
    need('recon', reconTarget, 168);

    if (ctx.enemyAir > 0) need('aa', Math.min(3, 1 + ctx.enemyAir), 152);
    if ((ctx.counts.get('airfield') ?? 0) > 0) {
      need('fighter', 1, 142);
      // The drone is the cheapest way to keep the map lit and to spot for
      // artillery. It is a planned purchase once the field army exists, and the
      // bank is only held for it when the price is already most of the way
      // saved — a drone shot down while the army is short of tanks is not
      // replaced by starving the army.
      const uavPrice = UNITS[ctx.game.unitIdFor(ctx.aiId, 'uav') ?? '']?.cost.mats;
      const dronePlanned =
        ctx.st.desiredArmy >= 6 && ctx.threats.length === 0 && (ctx.unitCounts.get('harvester') ?? 0) >= 2;
      need('uav', 1, dronePlanned ? 106 : 78, dronePlanned ? uavPrice : undefined);
      // One-way attack is a munition, not the wing's core: it is bought after
      // the fighter and the eye, so it can never crowd a reusable airframe out
      // of a four-position flight line.
      if ((ctx.unitCounts.get('fighter') ?? 0) >= 1) need('loiteringMunition', 1, 88);
      // Interceptors are a counter, not a blind opening purchase. Build them
      // once hostile air has actually been seen or remembered.
      if (ctx.enemyAir > 0) need('interceptor', Math.min(2, 1 + ctx.enemyAir), 148);
    }
    if ((ctx.counts.get('heliport') ?? 0) > 0) {
      // A gunship is a counter to armour, and its two positions are the only
      // place it can be produced or based, so the commander keeps one on hand.
      need('attackHelo', 1, 132);
    }
    if ((ctx.counts.get('shipyard') ?? 0) > 0) {
      // The corvette is the long-range core. A missile boat is a cheap second
      // hull that gives the yard something to do before the bank supports a
      // capital ship; the frigate is a reaction to hostile air or a hostile
      // submarine, not an opening purchase, because its SAM/ASW box is
      // expensive insurance. A submarine the commander has actually seen is
      // the one case where an escort is worth buying before enemy aircraft.
      need('corvette', 1, 136);
      need('missileBoat', 1, 118);
      // A boat only earns its price against an enemy who actually has a fleet;
      // blind submarine purchases starve the land army for no target.
      if (ctx.enemyNaval > 0) need('submarine', 1, 124);
      if (ctx.enemyNaval > 0 && ctx.player.mats > 850) need('frigate', 1, 144);
      if (ctx.enemyAir > 0 && ctx.player.mats > 900) need('frigate', 1, 150);
    }
    // Transport demand is driven by terrain and distance, not by the roster. A
    // commander buys one hull only when an objective is genuinely separated from
    // its army, and stops asking as soon as it owns or has queued one: a second
    // empty carrier is a hull the line needed instead.
    const transportCounts: Record<'land' | 'air' | 'naval', number> = { land: 0, air: 0, naval: 0 };
    for (const unit of ctx.own) {
      if (unit.kind !== 'unit') continue;
      const kind = transportKindOf(unit.defId);
      if (kind) transportCounts[kind]++;
    }
    for (const [defId, waiting] of queued) {
      const kind = transportKindOf(defId);
      if (kind) transportCounts[kind] += waiting;
    }
    const liftable = ctx.own.filter((unit) => {
      if (unit.kind !== 'unit' || unit.hp <= 0 || unit.garrisonId) return false;
      const def = UNITS[unit.defId];
      return !!def && def.armour === 'infantry' && def.canGarrison === true;
    }).length;
    const transportNeed = transportDemand({
      tick: ctx.game.state.tick,
      map: ctx.game.state.map,
      baseX: ctx.baseX,
      baseZ: ctx.baseZ,
      targetKnown: ctx.st.targetKnown,
      targetX: ctx.st.targetBaseX,
      targetZ: ctx.st.targetBaseZ,
      hasWater: ctx.hasWater,
      counts: {
        shipyard: ctx.counts.get('shipyard') ?? 0,
        heliport: ctx.counts.get('heliport') ?? 0,
        airfield: ctx.counts.get('airfield') ?? 0,
        factory: ctx.counts.get('factory') ?? 0,
        barracks: ctx.counts.get('barracks') ?? 0,
      },
      infantry: liftable,
      transports: transportCounts,
      combat: ctx.combat.length,
      ticksSinceTransport: ctx.game.state.tick - (ctx.st.lastTransportTick ?? -20 * 120),
    });
    if (transportNeed.kind === 'naval') need('landingCraft', 1, 107);
    else if (transportNeed.kind === 'air') need('transportHelo', 1, 105);
    else if (transportNeed.kind === 'land') need('apc', 1, 96);
    if ((ctx.counts.get('barracks') ?? 0) > 0 && (ctx.unitCounts.get('rifle') ?? 0) >= 4) {
      need('medic', 1, 84);
    }
    if ((ctx.counts.get('barracks') ?? 0) > 0 && ctx.enemyAir > 0) {
      // The shoulder team is the forward hedge: cheaper than the AA vehicle and
      // able to hide in a building, but not a replacement for the vehicle's
      // longer envelope. One or two are enough beside the shared launcher.
      need('manpadsTeam', Math.min(2, ctx.enemyAir), 78);
    }
    // Field recovery is a response to attrition, not an opening purchase. A
    // commander buys it after an actual vehicle has been damaged, so the bay is
    // not spent before there is anything to recover.
    if ((ctx.counts.get('factory') ?? 0) > 0) {
      const damagedVehicle = ctx.own.some((e) => {
        if (e.kind !== 'unit' || e.hp <= 0 || e.hp >= e.maxHp * 0.8) return false;
        const def = UNITS[e.defId];
        return def?.domain === 'land' && def.armour !== 'infantry';
      });
      if (damagedVehicle) need('recovery', 1, 72);
      // Indirect fire is planned, not only discovered. A battery is worth
      // having before an enemy bunker is in sight — but only once a field army
      // exists to escort it, the refineries are crewed and the base is quiet.
      // Seeing a fortified position makes it urgent instead of planned.
      const fortified = ctx.known.some((e) => {
        if (e.kind !== 'building') return false;
        const def = BUILDINGS[e.defId];
        return !!def?.garrison || (def?.weapons?.length ?? 0) > 0;
      });
      const coreForce =
        (ctx.unitCounts.get('tank') ?? 0) +
        (ctx.unitCounts.get('atgm') ?? 0) +
        (ctx.unitCounts.get('rifle') ?? 0);
      // A battery is a formation asset: it joins a field army of real size,
      // not a fixed share of whatever wave the commander is currently planning.
      // The absolute gate keeps a cautious, large-army commander from being the
      // last to receive fire support.
      const armyFormed = coreForce >= 6;
      const economyCrewed = (ctx.unitCounts.get('harvester') ?? 0) >= 2;
      // A mobile jammer is a support hull for a formed army: it blinds the
      // defence the armour is about to cross, but it is never the opening buy.
      if (armyFormed && economyCrewed) need('ewVehicle', 1, 58);
      const spgPrice = UNITS[ctx.game.unitIdFor(ctx.aiId, 'spg') ?? '']?.cost.mats;
      // A compact map puts both armies in contact from the opening, so a plan
      // sized for open ground is never whole there: the front is the whole
      // battlefield. The required line therefore shrinks with the map, and a
      // small map gets a fallback clock, because the army it is waiting for
      // is the one the map itself prevents from forming.
      const extent = Math.max(ctx.game.state.map.width, ctx.game.state.map.height);
      const compact = extent <= 80;
      const slack = Math.max(0, Math.min(4, Math.round((96 - extent) / 8)));
      const lineWhole =
        ctx.threats.length === 0 ||
        ctx.combat.length >= Math.max(3, ctx.st.desiredArmy - slack) ||
        (compact && ctx.game.state.tick >= 20 * 150);
      if (fortified) need('spg', 1, 128, spgPrice);
      // A quiet base was the wrong condition for the one arm that answers a
      // defended position: the commander that needs indirect fire most is the
      // one being held at the wire. Under fire it qualifies once the line is
      // whole instead — a battery is fire support for an army, never a
      // substitute for the hulls that are holding the perimeter.
      else if (
        economyCrewed &&
        ((armyFormed && lineWhole) ||
          // A compact battlefield is all front line: the army this measures is
          // whatever survived the last push, so the battery waits for a force
          // the map never lets form. A crewed economy and a running clock are
          // the only gates a small map can actually satisfy.
          (compact && ctx.game.state.tick >= 20 * 120))
      ) {
        need('spg', 1, 112, spgPrice);
      }
      // The heavier battery is a second purchase, not the first one repeated:
      // it lands once a howitzer is already on the field, so the saturation
      // tier reaches play without displacing the observed-fire tier.
      const rockets = ctx.game.unitIdFor(ctx.aiId, 'rocketArtillery');
      const rocketPrice = rockets ? UNITS[rockets]?.cost.mats : undefined;
      if (rockets && armyFormed && economyCrewed && (ctx.unitCounts.get('spg') ?? 0) >= 1) {
        need('rocketArtillery', 1, 116, rocketPrice);
      }
      // A tank destroyer is a second anti-armour answer, not a second tank: the
      // gun is casemated, so it belongs behind the line the turrets are holding.
      // One per army, like the battery — several would simply replace the armour
      // that can manoeuvre. A nation whose roster swaps this hull (North Korea's
      // Bulsae-4 over the shared assault gun) fields its own version on the same
      // order, which is the only order that puts that kit on the field at all.
      const tankDestroyer = ctx.game.unitIdFor(ctx.aiId, 'td');
      const tdPrice = tankDestroyer ? UNITS[tankDestroyer]?.cost.mats : undefined;
      if (
        tankDestroyer &&
        armyFormed &&
        economyCrewed &&
        // A casemate gun is a formation asset like the battery: it joins once
        // the line is nearly whole, or immediately against armour that has been
        // reported. Waiting for a full plan meant a commander in contact never
        // reached it at all, because contact grows the plan faster than the army.
        (ctx.mix.armour > 0 || ctx.combat.length >= Math.max(3, ctx.st.desiredArmy - 2))
      ) {
        // Below the drone: an eye on the battlefield is worth more than one more
        // gun, and a commander that bought the gun first could not see what to
        // shoot at.
        need('td', 1, 102, tdPrice);
      }
      // The infantry fighting vehicle is the mechanised escort, and it is bought
      // against an infantry line rather than in place of one: a hull with nobody
      // to carry is a tank without a turret. Sweden's CV90 replaces the shared
      // IFV, so this is likewise the order that fields a national kit.
      const ifv = ctx.game.unitIdFor(ctx.aiId, 'ifv');
      const ifvPrice = ifv ? UNITS[ifv]?.cost.mats : undefined;
      if (ifv && armyFormed && economyCrewed && (ctx.unitCounts.get('rifle') ?? 0) >= 3) {
        need('ifv', 1, 96, ifvPrice);
      }
      // Air defence is planned as well as reactive. A commander that only
      // answers aircraft it has already sighted is unarmed against the first
      // strike, and air is the one arm that reaches a base without crossing the
      // perimeter. One launcher is the hedge; hostile air raises the target
      // above. Iran's 3rd Khordad replaces the shared AA vehicle on this slot,
      // so this is also the order that puts that kit on the field. It reserves
      // nothing and sits below the drone: a hedge queued behind the army must
      // never hold the bank or displace the eye that finds targets for it.
      const aaId = ctx.game.unitIdFor(ctx.aiId, 'aa');
      if (aaId && armyFormed && economyCrewed && ctx.enemyAir === 0) {
        need('aa', 1, 74);
      }
    }

    const enemyMilitary = ctx.known.filter(
      (e) =>
        e.kind === 'unit' &&
        UNITS[e.defId]?.domain === 'land' &&
        (UNITS[e.defId]?.weapons.length ?? 0) > 0,
    ).length;
    const targetArmy = desiredArmySize(
      enemyMilitary,
      ctx.st.attackWave,
      ctx.profile.aggression,
      ctx.profile.armyScale,
    );
    let weights = blendWeights(
      STRATEGY_ARMY[ctx.strategy],
      armyWeights(ctx.mix),
      ctx.profile.responseWeight,
    );
    // A commander's doctrine also shapes the three core arms, not only the
    // support purchases. The scaled shares are renormalised, so the plan still
    // asks for the same total army: this changes what the army is made of, not
    // how big it is.
    if (ctx.st.commanderId) {
      const armour = commanderWeight(ctx.st.commanderId, 'production', 'tank');
      const antiArmour = commanderWeight(ctx.st.commanderId, 'production', 'atgm');
      const infantry = commanderWeight(ctx.st.commanderId, 'production', 'rifle');
      const total = weights.armour * armour + weights.antiArmour * antiArmour + weights.infantry * infantry;
      if (total > 0) {
        weights = {
          armour: (weights.armour * armour) / total,
          antiArmour: (weights.antiArmour * antiArmour) / total,
          infantry: (weights.infantry * infantry) / total,
        };
      }
    }
    // Support is counted in the target: a 6-unit army with two harvesters is
    // not six bayonets. The floor keeps at least one of each arm.
    need('tank', Math.max(1, Math.round(targetArmy * weights.armour)), 104);
    need('atgm', Math.max(1, Math.round(targetArmy * weights.antiArmour)), 108);
    need('rifle', Math.max(1, Math.round(targetArmy * weights.infantry)), 100);
    // National exclusives declare no canonical slot, so no `need()` above can
    // name one. Buy the nation's own extra option once the field army exists
    // and the base is quiet, at a priority below every core arm: an exclusive
    // is a capability the commander adds, never the plan it substitutes for.
    // A nation without one simply has nothing to push, so this cannot produce
    // another nation's equipment.
    //
    // "The field army exists" is read from units on the ground, not from the
    // planned size: a fixed 6-unit plan gate went silently dead when the elite
    // plan was retuned to 5, and the commander then never fielded its national
    // equipment at all. Half the planned army, and never fewer than four
    // bayonets, is the same intent at any scale.
    const fieldArmy = Math.max(4, Math.round(ctx.st.desiredArmy * 0.5));
    if (ctx.combat.length >= fieldArmy && ctx.threats.length === 0) {
      for (const defId of ctx.game.rosterFor(ctx.aiId).units) {
        const def = UNITS[defId];
        if (!def?.national || def.variantOf !== undefined) continue;
        const buildable = ctx.complete.some(
          (b) => ctx.game.productionStatus(ctx.aiId, b.id, defId).ok,
        );
        if (!buildable) continue;
        const count = (ctx.unitCounts.get(defId) ?? 0) + (queued.get(defId) ?? 0);
        if (count >= 1) continue;
        // Doctrine decides how urgently the capability is wanted, inside a band
        // that keeps it a capability rather than a substitute for the plan:
        // never above the emergency lines (air defence, recon, replacements)
        // and never so low that a commander stops considering it at all. With
        // no commander the weight is 1 and the priority is the historical 94.
        const weight = commanderWeight(ctx.st.commanderId, 'production', defId);
        const priority = Math.max(70, Math.min(110, 94 * weight));
        entries.push({ defId, priority, deficit: 1, saveFor: def.cost.mats });
      }
    }
    return entries.sort(
      (a, b) => b.priority - a.priority || b.deficit - a.deficit || a.defId.localeCompare(b.defId),
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Research                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Everything the planner may reason about, derived from the commander's own
   * state and its identified contacts. Nothing here reads the opponent's bank,
   * its research or anything currently under fog.
   */
  private researchSignals(ctx: AIContext): ResearchSignals {
    const roster = ctx.game.rosterFor(ctx.aiId);
    const rosterUnits = new Set(roster.units.map((id) => unitFamily(id)));
    const exclusiveTechs = new Set<string>();
    for (const defId of roster.units) {
      const required = exclusiveUnitTech(defId);
      if (required) exclusiveTechs.add(required);
    }
    // A branch counts as open once a node that grants a structure is done. The
    // starting node is not one: it hands out an upgrade, so a commander still
    // holds zero here and the planner studies breadth-first.
    const completed = ctx.game.completedTechnologies(ctx.aiId);
    const done = new Set(completed);
    const openedBranches = ctx.game.research.techs.filter(
      (tech) => done.has(tech.id) && tech.effects.some((effect) => effect.kind === 'unlockBuilding'),
    ).length;
    // A structure the commander has seen and can identify is a reason to want
    // indirect fire; a remembered silhouette is not, so this counts only what is
    // currently visible or confirmed.
    const fortified = ctx.known.filter((e) => {
      if (e.kind !== 'building' || !e.defId) return false;
      const def = BUILDINGS[e.defId];
      return !!def?.garrison || (def?.weapons?.length ?? 0) > 0;
    }).length;
    return {
      seed: ctx.st.aiSeed,
      tick: ctx.game.state.tick,
      timeLimitSec: ctx.game.state.scenario.settings.timeLimitSec,
      completed,
      openedBranches,
      unitCounts: ctx.unitCounts,
      buildingCounts: ctx.counts,
      rosterUnits,
      exclusiveTechs,
      profile: ctx.profile,
      strategy: ctx.strategy,
      mix: ctx.mix,
      enemyAir: ctx.enemyAir,
      enemyNaval: ctx.enemyNaval,
      fortified,
      hasWater: ctx.hasWater,
      // The retrofit only pays off where the grid is the limiter, which is the
      // same condition the installer uses. Read from the commander's own supply
      // and demand, never from anything it has not built.
      gridStrain: ctx.power.brownout || ctx.power.demand > ctx.power.supply * 0.8,
      // The capability's own gate list, read from the catalogue rather than
      // copied here, so a new family needs no AI change to be studied towards.
      superweaponTechs: this.superweaponTechs(ctx),
    };
  }

  /**
   * The authority chain behind this commander's national capability.
   *
   * Read from the catalogue and the match rule, so a nation without one, or a
   * battle that forbids them, simply returns nothing and the research planner
   * never learns a preference it cannot act on.
   */
  private superweaponTechs(ctx: AIContext): readonly string[] {
    if (!ctx.game.superweaponEnabled()) return [];
    const family = ctx.game.superweaponFamilyFor(ctx.aiId);
    if (!family) return [];
    // A strategic call-in is a late-war investment. A commander establishes its
    // air branch first and, on a coastal map, its fleet: studying the authority
    // chain before the field army and its support exist is how a base loses to
    // hulls it never built. The chain is offered once those branches stand.
    if ((ctx.counts.get('airfield') ?? 0) === 0) return [];
    if (ctx.hasWater && (ctx.counts.get('shipyard') ?? 0) === 0) return [];
    return family.requires;
  }

  /**
   * Eligible technologies, best first.
   *
   * Eligibility is the catalogue's, not a second copy of it: prerequisites are
   * read from the definition and alliance/nation restrictions come from
   * `Game.techEligibility`, the same method the command handler uses.
   */
  private researchOptions(ctx: AIContext): ResearchOption[] {
    const signals = this.researchSignals(ctx);
    const options: ResearchOption[] = [];
    for (const tech of ctx.game.research.techs) {
      if (!ctx.game.techEligibility(ctx.aiId, tech.id).ok) continue;
      const option = researchOptionScore(tech, signals);
      // Authored priority, not a new branch: a listed node is simply worth more
      // to this commander than the generic score says.
      option.score *= commanderResearchBoost(ctx.st.commanderId, tech.id);
      if (option.score <= 0) continue;
      options.push(option);
    }
    return options.sort((a, b) => b.score - a.score || a.techId.localeCompare(b.techId));
  }

  /**
   * What the commander wants left in the bank before it commits to research.
   *
   * Research competes with the army, so the reserve rises while the army is
   * under strength or the base is under threat and falls away once the field
   * force exists. Requisition is held only when an anti-armour gunner still has
   * to be paid for, because that is the one routine purchase that needs it.
   */
  private researchReserve(ctx: AIContext): { mats: number; req: number } {
    const want = Math.max(1, ctx.st.desiredArmy);
    const fill = ctx.combat.length / want;
    let mats = 120;
    if (ctx.threats.length > 0) mats += 200;
    if (fill < 0.75) mats += 250;
    const atgmDeficit =
      (ctx.unitCounts.get('atgm') ?? 0) < Math.max(1, Math.round(want * 0.28));
    return { mats: Math.min(800, mats), req: atgmDeficit ? 25 : 0 };
  }

  /**
   * Start one project when it is worth it, through the authoritative command.
   *
   * The planner never cancels: a project survives a lost centre and resumes
   * when one is rebuilt, and thrashing between nodes would waste the committed
   * cost for nothing. The returned budget has the price subtracted, because the
   * queued command does not reach the simulation until the next tick and
   * production in this same think must not spend materials already promised.
   */
  private manageResearch(
    ctx: AIContext,
    budget: { mats: number; req: number },
  ): { mats: number; req: number } {
    if (ctx.player.research.project) return budget;
    const centreId = ctx.game.researchCentreId(ctx.aiId);
    if (centreId === null) return budget;
    // Study is what a commander does with a field army, not instead of one. A
    // base missing most of its line answers that first; the technology keeps.
    // The gate is a small standing force rather than a share of the plan: a
    // commander under constant contact rarely sits near its planned strength,
    // and a percentage gate that assumes it does means the branch never opens at
    // all — so its artillery, airframes and hulls never reach the field.
    const standing = Math.max(2, Math.round(ctx.st.desiredArmy * 0.35));
    if (ctx.combat.length < standing) {
      ctx.st.lastDecision = `research deferred — army ${ctx.combat.length}/${ctx.st.desiredArmy}`;
      return budget;
    }
    const best = this.researchOptions(ctx)[0];
    if (!best || best.score < RESEARCH_MIN_SCORE) {
      if (best) ctx.st.lastDecision = `research not worth it — ${best.reason}`;
      return budget;
    }
    const tech = techDef(best.techId, ctx.game.research);
    if (!tech) return budget;
    const reserve = this.researchReserve(ctx);
    // The reserve is a floor under the army, not a second price. Adding all of
    // it to the study meant a 300-material branch needed 870 in the bank, and a
    // commander in contact never has that: the centre stood and nothing was
    // ever studied in it. A garrison's worth of materials is what the army
    // actually needs to keep replacing hulls while the project runs.
    const target = tech.cost.mats + Math.min(reserve.mats, 150);
    if (budget.mats < target) {
      // A project the commander has chosen is a plan, not a wish. Once two
      // fifths of the price is banked the shortfall is held back from the army
      // for a few seconds. Without this the study never began: the production
      // line bought a hull every time the bank covered one, so the surplus the
      // planner waited for never appeared, and a branch it had already decided
      // on stayed a technology with nothing on the field to show for it.
      // Only a line that is nearly whole saves for a project. A commander
      // several hulls short spends on the line first — a laboratory is not a
      // replacement for the army that protects it.
      const lineWhole = ctx.st.desiredArmy - ctx.combat.length <= 2;
      const saving = lineWhole && budget.mats >= tech.cost.mats * 0.2;
      if (saving) {
        // A share, never the whole bank: the field army is still being replaced
        // while the project saves, so a commander short of hulls is not left
        // waiting on a laboratory. This is the same reason the drop-off save is
        // capped at a share rather than the full shortfall.
        const held = Math.min(target - budget.mats, Math.floor(budget.mats * 0.6));
        ctx.st.lastDecision = `saving ${Math.ceil(held)} mats for ${tech.id}`;
        return { mats: Math.max(0, budget.mats - held), req: budget.req };
      }
      ctx.st.lastDecision = `saving for ${tech.id} — army reserve ${reserve.mats}`;
      return budget;
    }
    // Authority is the scarce half of a study: requisition trickles in and the
    // army spends it on every gunner it replaces. Reserving the whole army
    // reserve on top of the price kept the project waiting for authority it
    // never saw, so only a garrison's worth is held back.
    const reqReserve = Math.min(reserve.req, 10);
    if (budget.req - tech.cost.req < reqReserve) {
      // Requisition is the scarce half of a project, not the material half: the
      // commander has the bank, so the only thing standing between it and the
      // branch is authority. Production spends requisition the moment it has it
      // — an anti-armour gunner, a medic — so a project the planner has already
      // chosen never accumulated the 60–110 it needs. Holding the shortfall is
      // the same rule the material save uses, one resource over, and it is what
      // lets a researched branch reach the field inside the match.
      const shortfall = Math.max(0, tech.cost.req + reqReserve - budget.req);
      ctx.st.lastDecision = `saving requisition for ${tech.id}`;
      return { mats: budget.mats, req: Math.max(0, budget.req - shortfall) };
    }
    // The same status the command handler will apply, so an order this
    // controller believes in cannot be refused a tick later.
    if (!ctx.game.researchStatus(ctx.aiId, centreId, tech.id).ok) return budget;
    ctx.game.enqueueCommand({
      type: 'research',
      team: ctx.aiId,
      buildingId: centreId,
      techId: tech.id,
    });
    ctx.st.lastDecision = `researching ${tech.id} — ${best.reason}`;
    return {
      mats: Math.max(0, budget.mats - tech.cost.mats),
      req: Math.max(0, budget.req - tech.cost.req),
    };
  }

  /**
   * Buy a researched retrofit for a structure when the grid is the limiter.
   *
   * A module competes with the army for the same bank, so the decision is
   * deliberately narrow: only when the grid is actually short (a brownout, or
   * demand within a fifth of supply), only with a field army behind it, and only
   * when the purchase leaves the reserve the research policy already holds
   * intact. A healthy grid buys hulls instead — an extra turbine is not a status
   * symbol, it is headroom the commander does not currently need.
   *
   * The order is the same `installModule` command a player sends, so the
   * simulation's own status call decides. Once a structure is at capacity
   * `availableModules` stops offering it, so a successful purchase is never
   * re-issued; a refused one cannot happen either, because the same status is
   * checked first.
   */
  private manageModules(ctx: AIContext): void {
    const want = Math.max(1, ctx.st.desiredArmy);
    if (ctx.combat.length / want < 0.6) {
      ctx.st.lastDecision = `retrofit deferred — army ${ctx.combat.length}/${want}`;
      return;
    }
    // A build programme owns the bank first. A capability retrofit waits for a
    // finished build programme and a full-strength army: it is an investment in
    // a base that is already standing, and it must not outbid the structure
    // that makes it pay. A generation module is the exception, because it is
    // the answer to the strain that brought the commander here at all.
    const underConstruction = ctx.buildings.length > ctx.complete.length;
    const reserve = this.researchReserve(ctx);
    const strained = ctx.power.brownout || ctx.power.demand > ctx.power.supply * 0.8;
    for (const building of ctx.complete) {
      const available = ctx.game.availableModules(ctx.aiId, building.id);
      for (const module of available) {
        const generation = module.effects.some(
          (effect) => effect.kind === 'power' && effect.amount > 0,
        );
        if (generation) {
          // Headroom is only worth buying when the grid is actually short.
          if (!strained) continue;
        } else {
          if (underConstruction) continue;
          if (ctx.combat.length < want) continue;
          if (ctx.player.mats < module.cost.mats * 2) continue;
        }
        if (ctx.player.mats - module.cost.mats < reserve.mats) continue;
        if (ctx.player.req - module.cost.req < reserve.req) continue;
        if (!ctx.game.moduleStatus(ctx.aiId, building.id, module.id).ok) continue;
        ctx.game.enqueueCommand({
          type: 'installModule',
          team: ctx.aiId,
          buildingId: building.id,
          moduleId: module.id,
        });
        ctx.st.lastDecision =
          `installing ${module.name} — grid ${ctx.power.supply} supply / ${ctx.power.demand} demand`;
        return;
      }
    }
  }

  private manageProduction(ctx: AIContext, budget: { mats: number; req: number }): void {
    const desired = this.desiredUnits(ctx);
    // With no engineer the base cannot build its way out of a dead economy, so
    // every material below the replacement's price belongs to it, not the army.
    // The reserve is zero whenever the engineer exists, is queued, or cannot be
    // produced, so healthy bases and unrecoverable ones keep their old spending.
    const engineerReserve = this.engineerReserve(ctx);
    const haulerReserve = engineerReserve > 0 ? 0 : this.haulerReserve(ctx);
    // The rebuild reserve is a claim on the bank, not on whatever the
    // construction budget has left after its own plans. Asking the trimmed
    // budget was a deadlock: a base saving for a power plant handed production
    // 499 of its 600 materials every think, so the 500-material hauler was
    // *always* one material short and nothing was ever bought. When the bank
    // covers the reserve the purchase is made here, ahead of every other line.
    const rebuildReserve = engineerReserve > 0 ? engineerReserve : haulerReserve;
    if (rebuildReserve > 0) {
      const slot = engineerReserve > 0 ? 'engineer' : 'harvester';
      const label = slot === 'engineer' ? 'engineer' : 'harvester';
      if (ctx.player.mats < rebuildReserve) {
        ctx.st.lastDecision = `holding ${Math.ceil(rebuildReserve - ctx.player.mats)} mats for a replacement ${label}`;
        return;
      }
      const defId = ctx.game.unitIdFor(ctx.aiId, slot);
      const facility = defId
        ? ctx.complete.find((b) => ctx.game.productionStatus(ctx.aiId, b.id, defId).ok)
        : undefined;
      if (defId && facility) {
        ctx.game.enqueueCommand({
          type: 'produce',
          team: ctx.aiId,
          buildingId: facility.id,
          defId,
        });
        ctx.st.lastDecision = `replacing the lost ${label}`;
        return;
      }
    }
    const saving = desired.find((item) => (item.saveFor ?? 0) > 0);
    if (saving) {
      // Hulls short, not the sum of the fractional deficits: those are shares
      // of each arm's target and can never total more than three, so a hull
      // allowance compared against them was always satisfied and the battery
      // held the bank on every compact map, even with the line several vehicles
      // short. The allowance only means what it says when it counts vehicles.
      const coreShortfall = desired
        .filter(
          (item) =>
            item.defId !== saving.defId &&
            ['tank', 'atgm', 'rifle'].includes(unitFamily(item.defId)),
        )
        .reduce((n, item) => n + (item.short ?? Math.ceil(item.deficit)), 0);
      // A recruit does not ration its bank against the line: it keeps setting
      // materials aside for the support arm its plan wants and fields fewer
      // hulls while it does, which is exactly the handicap the difficulty is
      // for. Higher levels count the hulls actually missing and stop banking the
      // moment the line is short. The economy fixes are untouched either way:
      // this only decides which purchase the bank is held for.
      const corePressure = ctx.profile.difficulty === 'recruit' ? 0 : coreShortfall;
      const def = UNITS[saving.defId];
      // Holding for a battery the base cannot train is a freeze, not a plan:
      // the facility was destroyed or never built, and the line starved behind
      // a purchase that could never arrive.
      const canTrainIt = ctx.complete.some((b) =>
        ctx.game.productionEntries(ctx.aiId, b.defId).includes(saving.defId),
      );
      const price = saving.saveFor ?? 0;
      // A compact map never lets the core line come whole, so the ordinary
      // "save only once the line is met" rule could never apply there: the
      // battery was demanded from t+80 and still never bought at a 10 000
      // start. On those maps the commander rations from half the price and
      // tolerates a line several hulls short, because indirect fire is the one
      // purchase that can break a 64-tile stalemate.
      const extent = Math.max(ctx.game.state.map.width, ctx.game.state.map.height);
      const compact = extent <= 80;
      const coreAllowance = compact ? 4 : 2;
      const readyShare = compact ? 0.5 : 0.85;
      if (
        def &&
        canTrainIt &&
        corePressure <= coreAllowance &&
        budget.mats < def.cost.mats &&
        budget.mats >= price * readyShare &&
        budget.req >= def.cost.req &&
        (ctx.unitCounts.get('harvester') ?? 0) > 0
      ) {
        ctx.st.lastDecision = `holding ${Math.round(def.cost.mats - budget.mats)} mats for ${def.name}`;
        return;
      }
    }
    for (const item of desired) {
      const def = UNITS[item.defId];
      if (!def) continue;
      if (def.cost.mats > budget.mats || def.cost.req > budget.req) continue;
      const facility = ctx.complete.find(
        (b) => ctx.game.productionStatus(ctx.aiId, b.id, item.defId).ok,
      );
      if (!facility) continue;
      ctx.game.enqueueCommand({
        type: 'produce',
        team: ctx.aiId,
        buildingId: facility.id,
        defId: item.defId,
      });
      ctx.st.lastDecision = `producing ${item.defId} (${ctx.strategy} plan)`;
      return;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Transport operations                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Run transport operations: pick a hull, stage infantry, drive the carrier
   * and unload it.
   *
   * Nothing here writes `garrisonId`, moves a passenger or chooses a beach. Each
   * step is an ordinary command (`garrison`, `move`, `ungarrison`) that the
   * simulation validates exactly as it validates a player's, which is also why a
   * refused operation never strands anyone: the passengers simply stay aboard
   * or on foot while this commander abandons the plan.
   */
  private manageTransports(ctx: AIContext): void {
    const st = ctx.st;
    const ops = (st.transportOps ??= []);
    for (const op of [...ops]) {
      const carrier = ctx.game.getEntity(op.transportId);
      if (!carrier || carrier.hp <= 0) {
        this.cancelTransport(ctx, op, 'carrier lost');
        continue;
      }
      // A carrier used as a passenger is a bug, not a transport; release it.
      if (carrier.garrisonId) {
        this.cancelTransport(ctx, op, 'carrier embarked elsewhere');
        continue;
      }
      this.driveTransport(ctx, op, carrier);
    }
    if ((st.transportOps?.length ?? 0) > 0) return;
    const tick = ctx.game.state.tick;
    if (tick - (st.lastTransportTick ?? -20 * 120) < 20 * 30) return;
    if (!st.targetKnown || ctx.threats.length > 0) return;

    const targetX = st.targetBaseX;
    const targetZ = st.targetBaseZ;
    const acrossWater =
      ctx.hasWater && lineCrossesWater(ctx.game.state.map, ctx.baseX, ctx.baseZ, targetX, targetZ);
    const candidates: Array<{ carrier: Entity; kind: 'land' | 'air' | 'naval'; score: number }> = [];
    for (const unit of ctx.own) {
      if (unit.kind !== 'unit' || unit.hp <= 0 || unit.garrisonId) continue;
      const kind = transportKindOf(unit.defId);
      if (!kind) continue;
      const distance = Math.hypot(targetX - unit.x, targetZ - unit.z) / TILE_SIZE;
      if (kind === 'naval') {
        if (!acrossWater) continue;
        candidates.push({ carrier: unit, kind, score: 3 + distance * 0.02 });
      } else if (kind === 'air') {
        candidates.push({ carrier: unit, kind, score: 2 + distance * 0.02 });
      } else {
        // A carrier is worth loading only when walking would be the slower and
        // more exposed way to arrive; a short hop on foot is not an operation.
        if (distance < 18) continue;
        candidates.push({ carrier: unit, kind, score: 1 + distance * 0.005 });
      }
    }
    if (candidates.length === 0) return;
    candidates.sort((a, b) => b.score - a.score || a.carrier.id - b.carrier.id);

    for (const candidate of candidates) {
      const carrier = candidate.carrier;
      if (ctx.game.containerOccupants(carrier.id).length > 0) continue;
      const passengers = ctx.own
        .filter(
          (unit) =>
            unit.kind === 'unit' &&
            this.free(unit) &&
            containerAcceptsPassenger(carrier, unit),
        )
        .sort((a, b) => a.id - b.id);
      if (passengers.length < 2) continue;
      const capacity = Math.max(1, ctx.game.containerCapacity(carrier));
      const squad = passengers.slice(0, capacity);
      const centerX = squad.reduce((sum, unit) => sum + unit.x, 0) / squad.length;
      const centerZ = squad.reduce((sum, unit) => sum + unit.z, 0) / squad.length;
      const staging =
        candidate.kind === 'naval'
          ? coastalStagingPoint(ctx.game.state.map, centerX, centerZ, 14)
          : { x: centerX, z: centerZ };
      if (!staging) continue;
      const landing =
        candidate.kind === 'naval'
          ? coastalStagingPoint(ctx.game.state.map, targetX, targetZ, 26)
          : { x: targetX, z: targetZ };
      if (!landing) continue;
      // The pick-up and the drop-off are both validated before anyone is
      // ordered: a hull that cannot beach at either end is not a plan.
      if (candidate.kind === 'naval') {
        if (!ctx.game.navalLandingAvailable(carrier.id, staging.x, staging.z, 1)) continue;
        if (!ctx.game.navalLandingAvailable(carrier.id, landing.x, landing.z, squad.length)) continue;
      }
      if (candidate.kind === 'air') {
        if (!ctx.game.transportLandingAvailable(carrier.id, staging.x, staging.z)) continue;
        if (!ctx.game.transportLandingAvailable(carrier.id, landing.x, landing.z)) continue;
      }
      const op: TransportOperation = {
        id: st.groupCounter++,
        kind: candidate.kind,
        transportId: carrier.id,
        passengerIds: squad.map((unit) => unit.id),
        stage: 'embark',
        targetX: landing.x,
        targetZ: landing.z,
        stageX: staging.x,
        stageZ: staging.z,
        startedTick: tick,
        lastOrderTick: 0,
        refusals: 0,
      };
      st.transportOps.push(op);
      st.lastTransportTick = tick;
      st.lastDecision = `${candidate.kind} transport operation — ${squad.length} infantry staged`;
      return;
    }
  }

  /** Advance one operation by exactly one step per think. */
  private driveTransport(ctx: AIContext, op: TransportOperation, carrier: Entity): void {
    const tick = ctx.game.state.tick;
    const occupants = ctx.game.containerOccupants(carrier.id);
    const recovering = op.stage === 'recover' || op.stage === 'recoverUnload';
    const hurt = carrier.hp <= carrier.maxHp * 0.35;
    const threatened = ctx.visible.some(
      (enemy) =>
        enemy.owner >= 0 &&
        ctx.game.isHostile(ctx.aiId, enemy.owner) &&
        (UNITS[enemy.defId]?.weapons.length ?? 0) > 0 &&
        dist(enemy.x, enemy.z, carrier.x, carrier.z) < 9 * TILE_SIZE,
    );
    if (!recovering && (hurt || (threatened && op.stage !== 'unload'))) {
      this.cancelTransport(ctx, op, hurt ? 'transport damaged' : 'landing under fire');
      return;
    }
    // An amphibious run is legitimately long: staging, a shore approach and a
    // crossing can occupy minutes, so the ceiling only catches an operation
    // that is genuinely stuck, not one that is simply still at sea.
    if (!recovering && tick - op.startedTick > 20 * 420) {
      this.cancelTransport(ctx, op, 'operation timed out');
      return;
    }
    op.passengerIds = op.passengerIds.filter((id) => {
      const unit = ctx.game.getEntity(id);
      if (!unit || unit.hp <= 0) return false;
      return unit.garrisonId === carrier.id || !unit.garrisonId;
    });
    if (op.passengerIds.length === 0 && occupants.length === 0) {
      this.cancelTransport(ctx, op, 'passengers lost');
      return;
    }

    if (recovering) {
      this.recoverTransport(ctx, op, carrier, occupants);
      return;
    }

    if (op.stage === 'embark') {
      const aboard = op.passengerIds.every((id) => occupants.some((unit) => unit.id === id));
      if (aboard && occupants.length > 0) {
        op.stage = 'transit';
        op.refusals = 0;
        op.lastOrderTick = tick;
        ctx.st.lastDecision = `${this.transportName(carrier)} loaded with ${occupants.length} infantry`;
        return;
      }
      if (tick - op.startedTick > 20 * 75) {
        this.cancelTransport(ctx, op, 'infantry could not reach the carrier');
        return;
      }
      if (op.kind === 'naval' && !ctx.game.navalLandingAvailable(carrier.id, op.stageX, op.stageZ, 1)) {
        this.cancelTransport(ctx, op, 'no embarkation beach');
        return;
      }
      if (op.kind === 'air' && !ctx.game.transportLandingAvailable(carrier.id, op.stageX, op.stageZ)) {
        this.cancelTransport(ctx, op, 'no landing zone at the staging point');
        return;
      }
      if (tick - op.lastOrderTick < 20 * 4) return;
      const ready = op.passengerIds.filter((id) => {
        const unit = ctx.game.getEntity(id);
        return !!unit && unit.hp > 0 && !unit.garrisonId;
      });
      // The squad is counted whole: two men already in the hold plus the last
      // one walking to the ramp is a full lift, not an empty one.
      if (ready.length + occupants.length < 2) {
        this.cancelTransport(ctx, op, 'not enough infantry left to lift');
        return;
      }
      for (const id of ready) {
        const unit = ctx.game.getEntity(id);
        if (unit) this.claim(unit);
      }
      this.claim(carrier);
      ctx.game.enqueueCommand({
        type: 'garrison',
        team: ctx.aiId,
        ids: ready,
        targetId: carrier.id,
      });
      op.lastOrderTick = tick;
      ctx.st.lastDecision = `staging ${ready.length} infantry for ${this.transportName(carrier)}`;
      return;
    }

    if (op.stage === 'transit') {
      if (occupants.length === 0) {
        this.cancelTransport(ctx, op, 'passengers lost in transit');
        return;
      }
      const destination =
        op.kind === 'naval'
          ? waterApproachTo(ctx.game.state.map, op.targetX, op.targetZ, 12)
          : { x: op.targetX, z: op.targetZ };
      if (!destination) {
        this.cancelTransport(ctx, op, 'no water approach to the landing area');
        return;
      }
      if (dist(carrier.x, carrier.z, destination.x, destination.z) <= 5 * TILE_SIZE) {
        op.stage = 'unload';
        op.refusals = 0;
        op.lastOrderTick = tick - 20 * 10;
        return;
      }
      if (tick - op.lastOrderTick < 20 * 5) return;
      this.claim(carrier);
      this.escortTransport(ctx, carrier, destination, tick);
      ctx.game.enqueueCommand({
        type: 'move',
        team: ctx.aiId,
        ids: [carrier.id],
        x: destination.x,
        z: destination.z,
      });
      op.lastOrderTick = tick;
      ctx.st.lastDecision = `${this.transportName(carrier)} approaching the landing area`;
      return;
    }

    if (occupants.length === 0) {
      this.finishTransport(ctx, op, carrier);
      return;
    }
    // The shore is the authoritative decision: the unload command finds the
    // beach, beaches the hull and runs the shared exit transaction. A second
    // attempt against an already beached hull that still holds troops means the
    // ground is blocked, so the passengers stay aboard and the plan is dropped.
    const atShore = containerBoardingReady(carrier);
    if (atShore && op.refusals > 0) {
      this.cancelTransport(ctx, op, 'unload blocked at the shore');
      return;
    }
    if (tick - op.lastOrderTick < 20 * 10) return;
    this.claim(carrier);
    ctx.game.enqueueCommand({ type: 'ungarrison', team: ctx.aiId, ids: [carrier.id] });
    op.lastOrderTick = tick;
    if (atShore) op.refusals++;
    ctx.st.lastDecision = `${this.transportName(carrier)} unloading ${occupants.length} infantry`;
  }

  /** Release the hull and give the landed infantry their follow-up task. */
  private finishTransport(ctx: AIContext, op: TransportOperation, carrier: Entity): void {
    const released = op.passengerIds.filter((id) => {
      const unit = ctx.game.getEntity(id);
      return !!unit && unit.hp > 0 && !unit.garrisonId;
    });
    ctx.st.transportOps = (ctx.st.transportOps ?? []).filter((entry) => entry.id !== op.id);
    ctx.st.lastTransportTick = ctx.game.state.tick;
    if (released.length > 0) {
      // The landed section becomes an ordinary attack group aimed at the same
      // objective the carrier was committed to. No new formation exists: these
      // are individual infantry entities with one move order, as any player's.
      ctx.game.enqueueCommand({
        type: 'move',
        team: ctx.aiId,
        ids: released,
        x: op.targetX,
        z: op.targetZ,
        attackMove: true,
      });
      ctx.st.lastDecision = `${released.length} infantry landed and advancing`;
    }
    // The hull goes home through an ordinary move, which is also what clears a
    // beached hull's shore state.
    const home =
      op.kind === 'naval'
        ? waterApproachTo(ctx.game.state.map, ctx.baseX, ctx.baseZ, 20)
        : { x: ctx.baseX, z: ctx.baseZ };
    if (carrier.hp > 0 && home && dist(carrier.x, carrier.z, home.x, home.z) > 10 * TILE_SIZE) {
      ctx.game.enqueueCommand({
        type: 'move',
        team: ctx.aiId,
        ids: [carrier.id],
        x: home.x,
        z: home.z,
      });
    }
  }

  /**
   * Abandon an assault, keeping any embarked passengers under command.
   *
   * An abandoned assault and a transport's passenger lifecycle are not the same
   * thing: deleting the operation while troops are still aboard would leave a
   * loaded hull that nothing owns and nobody unloads. When the hold is empty the
   * operation is removed as before; when it is not, the same operation becomes a
   * recovery run so the passengers keep exactly one owner.
   */
  private cancelTransport(ctx: AIContext, op: TransportOperation, reason: string): void {
    const carrier = ctx.game.getEntity(op.transportId);
    const aboard =
      carrier && carrier.hp > 0 && !carrier.garrisonId
        ? ctx.game.containerOccupants(carrier.id)
        : [];
    if (carrier && aboard.length > 0) {
      op.stage = 'recover';
      op.refusals = 0;
      op.lastOrderTick = 0;
      ctx.st.lastDecision = `transport operation abandoned — ${reason}; recovering ${aboard.length} infantry`;
      return;
    }
    ctx.st.transportOps = (ctx.st.transportOps ?? []).filter((entry) => entry.id !== op.id);
    ctx.st.lastTransportTick = ctx.game.state.tick;
    ctx.st.lastDecision = `transport operation abandoned — ${reason}`;
  }

  /**
   * Bring a loaded carrier home after its assault was abandoned.
   *
   * Recovery is a stage of the operation, not a second system: the passengers
   * never lose their single owner. It waits for a valid beach or landing zone
   * instead of forcing one, and if none opens it holds the state and reports the
   * blockade rather than deleting the operation. No passenger is moved, killed
   * or unloaded except by the authoritative unload command.
   */
  private recoverTransport(
    ctx: AIContext,
    op: TransportOperation,
    carrier: Entity,
    occupants: Entity[],
  ): void {
    const tick = ctx.game.state.tick;
    if (occupants.length === 0) {
      this.finishRecovery(ctx, op);
      return;
    }
    if (op.kind === 'naval') {
      const landing = coastalStagingPoint(ctx.game.state.map, ctx.baseX, ctx.baseZ, 22);
      const approach = landing
        ? waterApproachTo(ctx.game.state.map, landing.x, landing.z, 14)
        : null;
      if (!landing || !approach) {
        ctx.st.lastDecision = `recovering ${occupants.length} infantry — no home beach yet`;
        return;
      }
      op.targetX = landing.x;
      op.targetZ = landing.z;
      if (op.stage === 'recover') {
        if (dist(carrier.x, carrier.z, approach.x, approach.z) <= 5 * TILE_SIZE) {
          op.stage = 'recoverUnload';
          op.refusals = 0;
          op.lastOrderTick = tick - 20 * 10;
          return;
        }
        if (tick - op.lastOrderTick < 20 * 5) return;
        this.claim(carrier);
        ctx.game.enqueueCommand({
          type: 'move',
          team: ctx.aiId,
          ids: [carrier.id],
          x: approach.x,
          z: approach.z,
        });
        op.lastOrderTick = tick;
        ctx.st.lastDecision = `${this.transportName(carrier)} returning ${occupants.length} infantry home`;
        return;
      }
    } else {
      const home = op.kind === 'air' ? this.airRecoveryPoint(ctx, carrier) : { x: ctx.baseX, z: ctx.baseZ };
      if (!home) {
        ctx.st.lastDecision = `recovering ${occupants.length} infantry — no landing zone at home`;
        return;
      }
      if (op.stage === 'recover') {
        if (dist(carrier.x, carrier.z, home.x, home.z) <= 5 * TILE_SIZE) {
          op.stage = 'recoverUnload';
          op.refusals = 0;
          op.lastOrderTick = tick - 20 * 10;
          return;
        }
        if (tick - op.lastOrderTick < 20 * 5) return;
        this.claim(carrier);
        ctx.game.enqueueCommand({
          type: 'move',
          team: ctx.aiId,
          ids: [carrier.id],
          x: home.x,
          z: home.z,
        });
        op.lastOrderTick = tick;
        ctx.st.lastDecision = `${this.transportName(carrier)} returning ${occupants.length} infantry home`;
        return;
      }
    }
    // The authoritative unload finds the exit. Refusals are retried at a walking
    // pace; after several the operation is held — still owned, still reported —
    // rather than deleted with troops inside.
    if (op.refusals >= 8) {
      ctx.st.lastDecision = `recovering ${occupants.length} infantry — waiting for a clear landing`;
      return;
    }
    if (tick - op.lastOrderTick < 20 * 10) return;
    this.claim(carrier);
    ctx.game.enqueueCommand({ type: 'ungarrison', team: ctx.aiId, ids: [carrier.id] });
    op.lastOrderTick = tick;
    op.refusals++;
    ctx.st.lastDecision = `${this.transportName(carrier)} unloading ${occupants.length} infantry at home`;
  }

  /** A field landing near the base, clear of the buildings around it. */
  private airRecoveryPoint(ctx: AIContext, carrier: Entity): { x: number; z: number } | null {
    for (const [dx, dz] of [
      [0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [10, 0], [-10, 0], [0, 10], [0, -10],
      [14, 0], [-14, 0], [0, 14], [0, -14],
    ] as const) {
      const x = ctx.baseX + dx * TILE_SIZE;
      const z = ctx.baseZ + dz * TILE_SIZE;
      if (ctx.game.transportLandingAvailable(carrier.id, x, z)) return { x, z };
    }
    return null;
  }

  /** Release the hull once its passengers are safely off; no assault follow-up. */
  private finishRecovery(ctx: AIContext, op: TransportOperation): void {
    const released = op.passengerIds.filter((id) => {
      const unit = ctx.game.getEntity(id);
      return !!unit && unit.hp > 0 && !unit.garrisonId;
    });
    ctx.st.transportOps = (ctx.st.transportOps ?? []).filter((entry) => entry.id !== op.id);
    ctx.st.lastTransportTick = ctx.game.state.tick;
    ctx.st.lastDecision = `${released.length} infantry recovered from an abandoned transport operation`;
  }

  /**
   * Put a small escort on the carrier's route while it runs.
   *
   * Two hulls, not the army: a transport that drags the whole line across the
   * map to guard itself is worse than one that risks the crossing. The escort is
   * only drawn from units that are free, so a unit already holding the perimeter
   * keeps its post.
   */
  private escortTransport(
    ctx: AIContext,
    carrier: Entity,
    destination: { x: number; z: number },
    tick: number,
  ): void {
    if (ctx.threats.length > 0) return;
    if (tick % (20 * 10) >= 20 * 2) return;
    // Units already marching on the same objective are the natural escort: they
    // are re-tasked to the carrier's route rather than waiting for an idle unit
    // the AI almost never has. Two at most, and never a unit holding a container
    // or already claimed this think.
    const escorts = ctx.combat
      .filter(
        (unit) =>
          unit.hp > 0 &&
          !unit.garrisonId &&
          !this.claimed.has(unit.id) &&
          UNITS[unit.defId]?.domain !== 'air' &&
          dist(unit.x, unit.z, carrier.x, carrier.z) < 30 * TILE_SIZE,
      )
      .sort(
        (a, b) =>
          dist(a.x, a.z, carrier.x, carrier.z) - dist(b.x, b.z, carrier.x, carrier.z) || a.id - b.id,
      )
      .slice(0, 2);
    for (const escort of escorts) {
      this.claim(escort);
      ctx.game.enqueueCommand({
        type: 'move',
        team: ctx.aiId,
        ids: [escort.id],
        x: destination.x,
        z: destination.z,
        attackMove: true,
      });
    }
  }

  private transportName(carrier: Entity): string {
    return UNITS[carrier.defId]?.name ?? 'transport';
  }

  /* ---------------------------------------------------------------------- */
  /* Air, naval, relays and the ground offensive                            */
  /* ---------------------------------------------------------------------- */

  private visibleTargets(ctx: AIContext, kinds: Array<(e: Entity) => boolean>): Entity[] {
    return ctx.visible.filter((e) => kinds.some((kind) => kind(e)));
  }

  private manageAir(ctx: AIContext): void {
    for (const plane of ctx.own) {
      if (plane.kind !== 'unit' || plane.hp <= 0) continue;
      const def = UNITS[plane.defId];
      if (def?.domain !== 'air' || def.weapons.length === 0) continue;
      if (!this.free(plane) || plane.aircraft?.returningHome) continue;
      const landed = plane.aircraft?.landed ?? false;
      if (!landed && plane.maxAmmo > 0 && plane.ammo <= 0) continue;
      const weapons = entityWeapons(plane);
      const target = this.visibleTargets(ctx, [
        (e) => e.kind === 'building',
        (e) => unitFamily(e.defId) === 'tank',
        (e) => unitFamily(e.defId) === 'harvester',
        (e) => !!UNITS[e.defId],
      ])
        .filter((e) => weapons.some((weapon) => canWeaponTarget(weapon, e)))
        .sort(
          (a, b) =>
            this.contactValue(this.toKnown(a), ctx.baseX, ctx.baseZ) -
            this.contactValue(this.toKnown(b), ctx.baseX, ctx.baseZ) ||
            a.id - b.id,
        )[0];
      if (!target) continue;
      if (
        this.order(ctx, plane, {
          type: 'attack',
          team: ctx.aiId,
          ids: [plane.id],
          targetId: target.id,
        })
      ) {
        ctx.st.lastDecision = `${def.name} sortie against ${target.defId}`;
      }
    }
  }

  private manageNaval(ctx: AIContext): void {
    for (const ship of ctx.own) {
      if (ship.kind !== 'unit' || UNITS[ship.defId]?.domain !== 'naval') continue;
      const isSub = !!UNITS[ship.defId]?.submarine;
      const sub = ship.submarine;
      if (isSub && sub) {
        // Dive while a hostile warship is near; surface when the coast is clear
        // so the battery recharges instead of forcing a dead boat to the yard.
        const threat = ctx.visible.some(
          (e) =>
            e.kind === 'unit' &&
            UNITS[e.defId]?.domain === 'naval' &&
            dist(ship.x, ship.z, e.x, e.z) < 16 * TILE_SIZE,
        );
        const wantDive = threat && sub.battery > 10;
        if (wantDive !== sub.dived) {
          ctx.game.enqueueCommand({
            type: 'dive',
            team: ctx.aiId,
            ids: [ship.id],
            dive: wantDive,
          });
        }
      }
      // A boat already executing an attack keeps its order; only the free
      // hulls below receive a new target.
      if (!this.free(ship)) continue;
      // An escort with a sonar set treats a submerged contact as its first
      // problem. This is a deliberate hunt: the order may be a long approach,
      // not just a shot at something already inside depth-charge range.
      const shipWeapons = entityWeapons(ship);
      const aswWeapon = isSub ? undefined : shipWeapons.find((w) => w.asw);
      if (aswWeapon) {
        const contact = ctx.visible
          .filter(
            (e) =>
              e.kind === 'unit' &&
              e.submarine?.dived &&
              e.owner !== -1 &&
              canWeaponTarget(aswWeapon, e) &&
              dist(ship.x, ship.z, e.x, e.z) < 24 * TILE_SIZE,
          )
          .sort(
            (a, b) =>
              dist(ship.x, ship.z, a.x, a.z) - dist(ship.x, ship.z, b.x, b.z) || a.id - b.id,
          )[0];
        if (contact) {
          if (
            this.order(ctx, ship, {
              type: 'attack',
              team: ctx.aiId,
              ids: [ship.id],
              targetId: contact.id,
            })
          ) {
            ctx.st.lastDecision = `${UNITS[ship.defId]?.name ?? 'Escort'} hunting a submerged contact`;
          }
          continue;
        }
      }
      const target = ctx.visible
        .filter((e) => e.owner !== -1)
        .filter((e) =>
          isSub
            ? UNITS[e.defId]?.domain === 'naval'
            : UNITS[e.defId]?.domain === 'naval' || BUILDINGS[e.defId]?.commandPost,
        )
        .filter((e) => dist(ship.x, ship.z, e.x, e.z) < 34 * TILE_SIZE)
        .sort((a, b) => {
          if (!isSub) return a.id - b.id;
          // A submarine captain prefers a fat merchant or corvette to the
          // escort whose whole job is to kill him; the sonar hull is discounted
          // rather than banned so a lonely frigate is still a legal target.
          const score = (e: Entity) =>
            (UNITS[e.defId]?.hp ?? 0) - ((UNITS[e.defId]?.sonar ?? 0) > 0 ? 800 : 0);
          return score(b) - score(a) || a.id - b.id;
        })[0];
      if (!target) continue;
      if (
        this.order(ctx, ship, { type: 'attack', team: ctx.aiId, ids: [ship.id], targetId: target.id })
      ) {
        ctx.st.lastDecision = `${UNITS[ship.defId]?.name ?? 'Warship'} engaging ${target.defId}`;
      }
    }
  }

  /**
   * Seize neutral or enemy-held strategic infrastructure when the engineer is
   * free and the base is not under threat. The commander values the objective
   * that answers its current shortage rather than following a fixed list.
   */
  private captureObjective(ctx: AIContext): void {
    const engineer = ctx.engineer;
    if (!engineer || !this.free(engineer)) return;
    // A construction push is more valuable than a long capture walk; threats
    // keep the engineer at home. Both checks are cheap and state-driven.
    if (ctx.buildings.some((e) => e.construction)) return;
    if (ctx.threats.length > 0) return;
    const tick = ctx.game.state.tick;
    if (tick < (ctx.st.lastObjectiveTick ?? 0) + 20 * 15) return;
    const candidates = ctx.game.state.entities.filter(
      (e) =>
        e.kind === 'building' &&
        e.hp > 0 &&
        !e.construction &&
        !!BUILDINGS[e.defId]?.capturable &&
        e.owner !== ctx.aiId &&
        // A structure the enemy built has to be found before it can be walked
        // to. Authored objectives (`owner -1`) are part of the map itself —
        // they are counted on the objective line whether or not they are in
        // sight — so those stay eligible without a scouting report.
        (e.owner < 0 || ctx.game.isKnownTo(ctx.team, e.id)) &&
        dist(engineer.x, engineer.z, e.x, e.z) < 48 * TILE_SIZE,
    );
    if (candidates.length === 0) return;
    const owned = ctx.complete.filter((e) => !!BUILDINGS[e.defId]?.capturable);
    const owns = (defId: string): boolean => owned.some((e) => e.defId === defId);
    const harvesters = ctx.unitCounts.get('harvester') ?? 0;
    const passiveMats = ctx.game.passiveMatsRate(ctx.aiId);
    const reqRate = ctx.game.reqRate(ctx.aiId);
    const score = (e: Entity): number => {
      const def = BUILDINGS[e.defId];
      let value = 30;
      if (def?.reqPerSec) value = reqRate < 2 ? 120 : 45;
      if (def?.matsPerSec) value = harvesters < 2 || passiveMats < 1.5 ? 140 : 55;
      if (def?.scanRadius) value = tick > 20 * 90 && !owns('radarStation') ? 85 : 25;
      return value - dist(engineer.x, engineer.z, e.x, e.z) / TILE_SIZE;
    };
    const target = [...candidates].sort((a, b) => score(b) - score(a) || a.id - b.id)[0];
    if (!target) return;
    if (
      this.order(ctx, engineer, {
        type: 'capture',
        team: ctx.aiId,
        ids: [engineer.id],
        targetId: target.id,
      })
    ) {
      ctx.st.lastObjectiveTick = tick;
      ctx.st.lastDecision = `engineer moving to capture ${BUILDINGS[target.defId]?.name ?? 'objective'}`;
    }
  }

  /**
   * Occupy nearby cover while defending, and release the occupants when the
   * commander switches to the attack or the shelter is about to fall.
   */
  private manageGarrison(ctx: AIContext): void {
    const tick = ctx.game.state.tick;
    // Neutral shelters are authored assets, not part of the AI's own building
    // list, so scan the battlefield for any usable cover.
    const ownedShelters = ctx.game.state.entities.filter(
      (e) =>
        e.kind === 'building' &&
        e.hp > 0 &&
        !e.construction &&
        !!BUILDINGS[e.defId]?.garrison &&
        (e.owner === ctx.aiId || e.owner === -1),
    );
    const occupied = ownedShelters.filter(
      (e) => ctx.game.garrisonOccupants(e.id).length > 0,
    );
    const shouldLeave =
      ctx.st.phase === 'assault' ||
      occupied.some((e) => e.hp < e.maxHp * 0.4);
    if (shouldLeave) {
      const last = ctx.st.lastGarrisonTick;
      if (last !== undefined && tick < last + 20 * 8) return;
      const leave = occupied.filter(
        (e) =>
          ctx.game.garrisonOccupants(e.id).some((u) => u.owner === ctx.aiId) &&
          (e.hp < e.maxHp * 0.4 || ctx.st.phase === 'assault'),
      );
      if (leave.length === 0) return;
      ctx.game.enqueueCommand({
        type: 'ungarrison',
        team: ctx.aiId,
        ids: leave.map((e) => e.id),
      });
      ctx.st.lastGarrisonTick = tick;
      ctx.st.lastDecision = `releasing ${leave.length} garrison${leave.length === 1 ? '' : 's'} for the attack`;
      return;
    }
    if (ctx.threats.length === 0 && ctx.st.phase !== 'defend') return;
    const lastGarrison = ctx.st.lastGarrisonTick;
    if (lastGarrison !== undefined && tick < lastGarrison + 20 * 8) return;
    const infantry = ctx.own
      .filter(
        (e) =>
          e.kind === 'unit' &&
          e.hp > 0 &&
          !e.garrisonId &&
          !!UNITS[e.defId]?.canGarrison &&
          // Medics may take cover by hand, but the commander keeps unarmed
          // support outside so it can keep treating the line.
          (UNITS[e.defId]?.weapons.length ?? 0) > 0 &&
          this.free(e),
      )
      .sort((a, b) => a.id - b.id);
    if (infantry.length === 0) return;
    const scored = ownedShelters
      .map((building) => {
        const cfg = BUILDINGS[building.defId]?.garrison;
        if (!cfg) return null;
        const inside = ctx.game.garrisonOccupants(building.id);
        if (inside.some((u) => ctx.game.isHostile(ctx.aiId, u.owner))) return null;
        const room = cfg.capacity - inside.length;
        if (room <= 0) return null;
        const nearest = Math.min(
          ...infantry.map((u) => dist(u.x, u.z, building.x, building.z)),
        );
        if (nearest > 18 * TILE_SIZE) return null;
        const threatened = ctx.threats.some(
          (t) => dist(t.x, t.z, building.x, building.z) < 20 * TILE_SIZE,
        );
        if (!threatened && ctx.st.phase !== 'defend') return null;
        return { building, room, nearest, protection: cfg.protection };
      })
      .filter((v): v is { building: Entity; room: number; nearest: number; protection: number } => !!v)
      .sort(
        (a, b) =>
          b.protection - a.protection ||
          a.nearest - b.nearest ||
          a.building.id - b.building.id,
      );
    let assigned = 0;
    for (const candidate of scored) {
      if (assigned >= 2) break;
      const building = candidate.building;
      const available = infantry
        .filter((u) => this.free(u))
        .sort(
          (a, b) =>
            dist(a.x, a.z, building.x, building.z) -
            dist(b.x, b.z, building.x, building.z),
        );
      const chosen = available.slice(0, candidate.room);
      if (chosen.length === 0) continue;
      for (const unit of chosen) this.claim(unit);
      ctx.game.enqueueCommand({
        type: 'garrison',
        team: ctx.aiId,
        ids: chosen.map((u) => u.id),
        targetId: building.id,
      });
      assigned++;
    }
    if (assigned > 0) {
      ctx.st.lastGarrisonTick = tick;
      ctx.st.lastDecision = `infantry occupying ${assigned} shelter${assigned === 1 ? '' : 's'}`;
    }
  }

  private offensive(ctx: AIContext): void {
    const enemyMilitary = ctx.known.filter(
      (e) =>
        e.kind === 'unit' &&
        UNITS[e.defId]?.domain === 'land' &&
        (UNITS[e.defId]?.weapons.length ?? 0) > 0,
    ).length;
    ctx.st.desiredArmy = desiredArmySize(
      enemyMilitary,
      ctx.st.attackWave,
      ctx.profile.aggression,
      ctx.profile.armyScale,
    );

    if (ctx.threats.length > 0) {
      ctx.st.phase = 'defend';
      return;
    }
    // Reflect claims made by air, naval, capture and garrison tasking this
    // tick; the snapshot taken at the start of update is already stale.
    // A hull cannot assault an inland objective. Left in the group it makes the
    // shared approach point unsatisfiable for every unit in it — no tile is
    // legal for a tank and a corvette at once — and the wave silently never
    // launches. Naval tasking owns the fleet; the offensive owns the land.
    const idle = ctx.combat.filter(
      (e) => this.free(e) && UNITS[e.defId]?.domain !== 'naval',
    );
    // A commander that keeps a home guard does not lose its base to a
    // counter-attack while its army is across the map. The guard is simply not
    // committed; it still answers a threat through the defence pass. At least
    // one unit always remains eligible to attack.
    const keepHome = Math.min(ctx.profile.reserve, Math.max(0, idle.length - 1));
    const ready = keepHome > 0 ? idle.slice(0, idle.length - keepHome) : idle;
    if (!ctx.st.targetKnown || ctx.known.length === 0) {
      ctx.st.phase = 'build';
      ctx.st.lastDecision =
        idle.length > 0
          ? `holding ${idle.length}/${ctx.st.desiredArmy} units — scouting for contact`
          : 'reconnaissance screen has no contact yet';
      return;
    }

    const tick = ctx.game.state.tick;
    // Aggressive commanders commit a smaller force; cautious ones wait for
    // most of the desired army. The level's commitShare then scales that gate:
    // a recruit leaves with a fraction of it, an elite insists on more than the
    // nominal army. A wave also has a real cooldown so an unreachable order
    // cannot re-fire every second.
    const planned = Math.round(
      ctx.st.desiredArmy *
        ctx.profile.commitShare *
        (0.55 + (1 - ctx.profile.aggression) * 0.35),
    );
    // Readiness judgement: a level that reads the scouted force holds a wave
    // back when it is outnumbered and releases it sooner when it clearly is not.
    // Bounded either way, so the commander's own risk tolerance still decides
    // what "ready" means; this only sharpens the estimate.
    const readiness = ctx.execution.readsReadiness
      ? Math.max(
          0.9,
          Math.min(1.2, 1 + (enemyMilitary / Math.max(1, ctx.combat.length) - 1) * 0.08),
        )
      : 1;
    const caution = ctx.st.commanderId
      ? this.assaultCaution(ctx)
      : { gate: 1, cooldown: 1 };
    const gate = Math.max(3, Math.round(planned * readiness * caution.gate));
    const cooldown = 20 * Math.round((10 + (1 - ctx.profile.aggression) * 8) * caution.cooldown);
    // If production cannot lift the army to the gate — a stalled economy, a
    // lost factory, a scouted force larger than expected — commit the trained
    // force rather than parking it at the base for the rest of the match.
    const overdue = tick - ctx.st.lastWaveTick > 20 * 40;
    const committed = ready.length >= gate || (overdue && ready.length >= 4);
    if (committed && tick - ctx.st.lastWaveTick >= cooldown) {
      const ids = ready.map((e) => e.id);
      const point = this.approachPoint(ctx, ids);
      if (!point) {
        // The remembered point has no reachable ground beside it. Holding is
        // the honest outcome: a wave that cannot be ordered is not a wave, and
        // counting it would both hide the failure and start the cooldown.
        ctx.st.phase = 'build';
        ctx.st.lastDecision = `no approach to ${this.tileLabel(ctx)} — holding ${ids.length} units`;
        return;
      }
      for (const unit of ready) this.claim(unit);
      ctx.game.enqueueCommand({
        type: 'move',
        team: ctx.aiId,
        ids,
        x: point.x,
        z: point.z,
        attackMove: true,
      });
      ctx.st.attackWave++;
      ctx.st.lastWaveTick = tick;
      // Snapshot what the wave is and what it is costing, so the next review can
      // judge it against the counters as they were when it left.
      ctx.st.battle = {
        wave: ctx.st.attackWave,
        startTick: tick,
        startKills: ctx.player.stats.kills,
        startLosses: ctx.player.stats.unitsLost,
        startCount: ids.length,
        // The point the wave was actually sent to, not the target beyond it:
        // that is the ground the commander can reasonably expect to hold.
        x: point.x,
        z: point.z,
        ids,
        setbacks: ctx.st.battle?.setbacks ?? 0,
        setbackUntil: ctx.st.battle?.setbackUntil,
      };
      ctx.st.phase = 'assault';
      ctx.st.lastDecision = `assault wave ${ctx.st.attackWave} with ${ids.length} units`;
      return;
    }

    if (
      ctx.st.phase === 'assault' &&
      ready.length >= 2 &&
      tick - ctx.st.lastWaveTick > 20 * 15
    ) {
      const ids = ready.map((e) => e.id);
      const point = this.approachPoint(ctx, ids);
      if (!point) {
        ctx.st.phase = 'pressure';
        ctx.st.lastDecision = `no approach to ${this.tileLabel(ctx)} — regrouping`;
        return;
      }
      for (const unit of ready) this.claim(unit);
      ctx.game.enqueueCommand({
        type: 'move',
        team: ctx.aiId,
        ids,
        x: point.x,
        z: point.z,
        attackMove: true,
      });
      ctx.st.lastWaveTick = tick;
      ctx.st.lastDecision = `pressing toward last known contact at ${Math.round(ctx.st.targetBaseX / TILE_SIZE)},${Math.round(ctx.st.targetBaseZ / TILE_SIZE)}`;
      return;
    }

    ctx.st.phase = ready.length > 0 ? 'build' : 'pressure';
    ctx.st.lastDecision =
      ready.length > 0
        ? `massing ${ready.length}/${gate} units at base`
        : 'forces committed; supporting economy';
  }

  private toKnown(entity: Entity): KnownEnemy {
    return {
      id: entity.id,
      kind: entity.kind,
      defId: entity.defId,
      x: entity.x,
      z: entity.z,
      visible: true,
      tick: 0,
    };
  }
}
