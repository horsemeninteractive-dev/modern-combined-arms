import { BUILDINGS, buildingFamily } from './buildings';
import { ALLIANCES, NATIONS } from './factions';
import { SUPERWEAPON_FAMILY_LIST } from './superweapons';
import { UNITS, unitFamily } from './units';
import type { Cost } from '../sim/types';

/**
 * Research data and the pure resolvers built on it.
 *
 * The simulation owns research *progress*; this module owns the catalogue and
 * the rules for turning a set of completed technology ids into availability.
 * Keeping the resolution pure means the HUD, the AI and a test all ask the same
 * question of the same data, and a save only needs to carry ids.
 *
 * One technology may grant several effects. Effects are a tagged union rather
 * than a bag of booleans so a later category (a passive weapon refit, a
 * building capability) can be added without changing the shape of every entry.
 */

export type ResearchBranch = 'manoeuvre' | 'fires' | 'air' | 'naval';

export const RESEARCH_BRANCHES: readonly ResearchBranch[] = Object.freeze([
  'manoeuvre',
  'fires',
  'air',
  'naval',
]);

export const BRANCH_NAMES: Readonly<Record<ResearchBranch, string>> = Object.freeze({
  manoeuvre: 'Manoeuvre',
  fires: 'Fires',
  air: 'Air',
  naval: 'Naval',
});

/** Canonical unit slots that need no technology. */
export const TIER_ZERO_UNITS: readonly string[] = Object.freeze([
  'engineer',
  'harvester',
  'rifle',
  'atgm',
  'medic',
  'recon',
  'aa',
  'recovery',
]);

/** Canonical structure slots that need no technology. */
export const TIER_ZERO_BUILDINGS: readonly string[] = Object.freeze([
  'commandPost',
  'barracks',
  'factory',
  'refinery',
  'powerPlant',
  'mgNest',
  'atTurret',
  'radar',
  'researchCentre',
  // Strategic coordination is gated by its structure prerequisites and by the
  // four-research authority chain, not by a technology that unlocks the slot.
  'strategicOps',
  // The design table omits these two, but both were buildable before research
  // and no technology claims them. Tier 0 means "unchanged from today", so they
  // stay available rather than becoming permanently unreachable.
  'samBattery',
  'coastalBattery',
]);

/**
 * National exclusives are extra roster options rather than variants of a
 * canonical slot, so they cannot inherit an unlock through `unitFamily`. The
 * specification ties each exclusive to the branch tier that equips its family;
 * `null` means tier 0. Keying the requirement here keeps the exception in one
 * place instead of teaching production and the AI about six special cases.
 */
export const EXCLUSIVE_UNIT_TECH: Readonly<Record<string, string | null>> = Object.freeze({
  kestrelTeam: 'manoeuvre1',
  wilk: 'manoeuvre2',
  stormShadow: 'fires2',
  tosp: 'fires2',
  sprut: null,
  taszar: 'fires1',
  // Expansion nations. The gate is the branch tier that equips the capability,
  // not a national technology: a Finnish long-range anti-tank team rides on the
  // anti-armour tier, an armed reconnaissance drone on the air-recon tier, and
  // a multirole fighter or a stand-off missile carrier on the heavier tier of
  // its own branch.
  spikeTeam: 'fires1',
  gripen: 'air2',
  mohajer6: 'air1',
  // The Koksan is an extra siege battery beside the shared howitzer, not a
  // replacement for it, so it needs its own gate on the heavier fires tier.
  koksan: 'fires2',
  // National naval hulls. Sweden's littoral corvette rides on the tier that
  // opens the shipyard and the missile corvette, because it is a corvette-class
  // hull rather than a new capability. Iran's midget boat sits on the heavier
  // tier instead: it would be a submarine no escort could answer before the
  // tier-2 frigate's sonar exists.
  visby: 'naval1',
  ghadir: 'naval2',
});

/** Required technology for a national exclusive, or undefined for a normal unit. */
export function exclusiveUnitTech(defId: string): string | null | undefined {
  return Object.prototype.hasOwnProperty.call(EXCLUSIVE_UNIT_TECH, defId)
    ? EXCLUSIVE_UNIT_TECH[defId]
    : undefined;
}

export type ResearchEffect =
  /** Unlock a canonical unit slot; national replacements inherit the unlock. */
  | { kind: 'unlockUnit'; slot: string }
  /** Unlock a canonical structure slot; national variants inherit the unlock. */
  | { kind: 'unlockBuilding'; slot: string }
  /** Make a unit upgrade available to every eligible owned unit. */
  | { kind: 'grantUnitUpgrade'; upgrade: string }
  /** Make a building module available for purchase on eligible structures. */
  | { kind: 'grantBuildingModule'; module: string };

export interface TechDef {
  id: string;
  /** Defender display name. */
  name: string;
  /** Eastern display name for the same doctrine. */
  easternName: string;
  branch: ResearchBranch;
  tier: 1 | 2;
  cost: Cost;
  /** Base research time in seconds at a standard centre. */
  seconds: number;
  /** Technology ids that must be complete first. */
  requires: readonly string[];
  effects: readonly ResearchEffect[];
  /**
   * A strategic authority node.
   *
   * These publish no unlock of their own: four of them together authorise a
   * national superweapon, coordinated from the Strategic Operations Centre. The
   * marker exists so the catalogue validator can tell a deliberate authority
   * node from a technology somebody forgot to give an effect, and so it can
   * check that every one of them belongs to exactly one capability chain.
   */
  strategic?: boolean;
  /** Alliance ids that may research it; absent means both alliances. */
  alliances?: readonly string[];
  /** Nation ids that may research it; absent means every nation in the alliance. */
  nations?: readonly string[];
  description: string;
  icon: string;
}

/**
 * A capability researched once and then taken by individual units.
 *
 * `kind` is descriptive: the research layer only records that a unit has taken
 * it. Cooldown, duration and cost are authored here so the later action layer
 * does not hard-code them, but Stage 4A deliberately does not run an ability.
 */
export type UnitUpgradeKind = 'passive' | 'active' | 'toggle';

export interface UnitUpgradeDef {
  id: string;
  name: string;
  description: string;
  /** Canonical unit slots this upgrade can be fitted to. */
  eligibleSlots: readonly string[];
  kind: UnitUpgradeKind;
  /** Materials and requisition charged when a unit takes the upgrade. */
  cost: Cost;
  cooldownSeconds?: number;
  durationSeconds?: number;
  icon: string;
}

/** A capability researched once and then bought for an individual structure. */
export type ModuleEffect =
  | { kind: 'power'; amount: number }
  | { kind: 'researchSpeed'; multiplier: number }
  | { kind: 'capability'; capability: string };

export interface BuildingModuleDef {
  id: string;
  name: string;
  description: string;
  /** Canonical structure slots this module can be installed on. */
  eligibleSlots: readonly string[];
  cost: Cost;
  /** Modules one structure may hold at once; absent means one. */
  capacity?: number;
  effects: readonly ModuleEffect[];
  icon: string;
}

export interface ResearchCatalog {
  readonly techs: readonly TechDef[];
  readonly upgrades: readonly UnitUpgradeDef[];
  readonly modules: readonly BuildingModuleDef[];
}

const TECH_LIST: readonly TechDef[] = Object.freeze([
  {
    id: 'manoeuvre1',
    name: 'Manoeuvre Doctrine',
    easternName: 'Motorised Assault',
    branch: 'manoeuvre',
    tier: 1,
    cost: { mats: 300, req: 40 },
    seconds: 45,
    requires: [],
    effects: [
      { kind: 'unlockUnit', slot: 'tank' },
      { kind: 'unlockUnit', slot: 'ifv' },
      // Recon smoke is a manoeuvre-doctrine capability: the screen a recce troop
      // lays for the formation it is leading. It rides on the tier-1 node rather
      // than a ninth technology so the approved eight-node tree is unchanged.
      { kind: 'grantUnitUpgrade', upgrade: 'reconSmokescreen' },
      // The Advanced Turbine retrofit is the same kind of grant: a capability the
      // commander buys per structure once the doctrine is studied. The approved
      // node list has no industrial branch, and the brief for Stage 4C.3 forbids
      // adding one, so the tier-1 manoeuvre node — already the tree's capability
      // node — carries it. Changing the granting node is a data edit here only.
      { kind: 'grantBuildingModule', module: 'advancedTurbine' },
    ],
    description:
      'Armoured and mechanised doctrine: main battle tanks, infantry fighting vehicles, smoke dischargers for reconnaissance and the Advanced Turbine retrofit for power plants.',
    icon: 'tank',
  },
  {
    id: 'manoeuvre2',
    name: 'Advanced Armour',
    easternName: 'Assault Gun Doctrine',
    branch: 'manoeuvre',
    tier: 2,
    cost: { mats: 600, req: 90 },
    seconds: 80,
    requires: ['manoeuvre1'],
    effects: [{ kind: 'unlockUnit', slot: 'td' }],
    description: 'Purpose-built anti-armour hulls and the tactics that keep them alive.',
    icon: 'td',
  },
  {
    id: 'fires1',
    name: 'Indirect Fire Control',
    easternName: 'Massed Fires',
    branch: 'fires',
    tier: 1,
    cost: { mats: 300, req: 40 },
    seconds: 45,
    requires: [],
    effects: [{ kind: 'unlockUnit', slot: 'spg' }],
    description: 'Observed artillery fire: self-propelled guns and the fire-control chain behind them.',
    icon: 'spg',
  },
  {
    id: 'fires2',
    name: 'Saturation Fires',
    easternName: 'Rocket Troops',
    branch: 'fires',
    tier: 2,
    cost: { mats: 600, req: 90 },
    seconds: 80,
    requires: ['fires1'],
    effects: [{ kind: 'unlockUnit', slot: 'rocketArtillery' }],
    description: 'Area saturation with rocket artillery, bought at the price of accuracy and reload.',
    icon: 'mrl',
  },
  {
    id: 'air1',
    name: 'Air Operations',
    easternName: 'Frontal Aviation',
    branch: 'air',
    tier: 1,
    cost: { mats: 350, req: 60 },
    seconds: 55,
    requires: [],
    effects: [
      { kind: 'unlockBuilding', slot: 'airfield' },
      { kind: 'unlockUnit', slot: 'uav' },
      { kind: 'unlockUnit', slot: 'interceptor' },
    ],
    description: 'An operational airfield, reconnaissance drones and point air defence.',
    icon: 'airfield',
  },
  {
    id: 'air2',
    name: 'Air Superiority',
    easternName: 'Strike Aviation',
    branch: 'air',
    tier: 2,
    cost: { mats: 700, req: 110 },
    seconds: 90,
    requires: ['air1'],
    effects: [
      { kind: 'unlockUnit', slot: 'fighter' },
      { kind: 'unlockUnit', slot: 'attackHelo' },
    ],
    description: 'Strike fighters and attack helicopters: reach beyond the forward line.',
    icon: 'fighter',
  },
  {
    id: 'naval1',
    name: 'Naval Operations',
    easternName: 'Coastal Fleet',
    branch: 'naval',
    tier: 1,
    cost: { mats: 350, req: 60 },
    seconds: 55,
    requires: [],
    effects: [
      { kind: 'unlockBuilding', slot: 'shipyard' },
      { kind: 'unlockUnit', slot: 'missileBoat' },
      { kind: 'unlockUnit', slot: 'corvette' },
    ],
    description: 'A shipyard, missile boats and corvettes for coastal control.',
    icon: 'shipyard',
  },
  {
    id: 'naval2',
    name: 'Blue Water',
    easternName: 'Oceanic Strike',
    branch: 'naval',
    tier: 2,
    cost: { mats: 700, req: 110 },
    seconds: 90,
    requires: ['naval1'],
    effects: [
      { kind: 'unlockUnit', slot: 'frigate' },
      { kind: 'unlockUnit', slot: 'submarine' },
      { kind: 'unlockUnit', slot: 'navalSupport' },
    ],
    description: 'Ocean-going frigates, submarines and offshore support for a fleet that can hold open water.',
    icon: 'frigate',
  },
  /* ------------------------------------------------------------------ */
  /* Strategic prerequisites                                             */
  /*                                                                     */
  /* Two nodes per superweapon family. They unlock nothing on their own: */
  /* the capability is coordinated from the Strategic Operations Centre  */
  /* and these four completed technologies are its authority chain. The  */
  /* nation gate keeps a shared branch node from advertising a national   */
  /* capability the player cannot field.                                  */
  /* ------------------------------------------------------------------ */
  {
    id: 'hypersonicGlide',
    name: 'Hypersonic Glide Vehicle',
    easternName: 'Hypersonic Glide Vehicle',
    branch: 'fires',
    tier: 2,
    cost: { mats: 950, req: 130 },
    seconds: 80,
    requires: ['fires1'],
    effects: [],
    strategic: true,
    nations: ['sweden', 'russia'],
    description: 'A manoeuvring glide body and its carrier release: the vehicle half of a theatre hypersonic strike.',
    icon: 'target',
  },
  {
    id: 'terminalSeeker',
    name: 'Terminal Seeker Suite',
    easternName: 'Terminal Seeker Suite',
    branch: 'air',
    tier: 2,
    cost: { mats: 850, req: 120 },
    seconds: 75,
    requires: ['air1'],
    effects: [],
    strategic: true,
    nations: ['sweden', 'russia'],
    description: 'Millimetre-wave and imaging seekers that can pick one hardened aim point out of a cluttered picture.',
    icon: 'scope',
  },
  {
    id: 'salvoControl',
    name: 'Salvo Coordination',
    easternName: 'Battery Coordination',
    branch: 'fires',
    tier: 2,
    cost: { mats: 700, req: 90 },
    seconds: 55,
    requires: ['fires1'],
    effects: [],
    strategic: true,
    nations: ['uk', 'northKorea'],
    description: 'Time-on-target scheduling that lets separate batteries arrive together as one barrage.',
    icon: 'mrl',
  },
  {
    id: 'penetrationAids',
    name: 'Penetration Aids',
    easternName: 'Penetration Aids',
    branch: 'air',
    tier: 2,
    cost: { mats: 650, req: 85 },
    seconds: 50,
    requires: ['air1'],
    effects: [],
    strategic: true,
    nations: ['uk', 'northKorea'],
    description: 'Decoys and route shaping that make a missile salvo harder to sort out and intercept.',
    icon: 'target',
  },
  {
    id: 'spectrumDenial',
    name: 'Spectrum Denial',
    easternName: 'Spectrum Denial',
    branch: 'air',
    tier: 2,
    cost: { mats: 600, req: 80 },
    seconds: 50,
    requires: ['air1'],
    effects: [],
    strategic: true,
    nations: ['lithuania', 'belarus'],
    description: 'Wideband jamming and false-target injection against a theatre command net.',
    icon: 'radarstation',
  },
  {
    id: 'emitterMapping',
    name: 'Emitter Mapping',
    easternName: 'Emitter Mapping',
    branch: 'manoeuvre',
    tier: 2,
    cost: { mats: 550, req: 75 },
    seconds: 45,
    requires: ['manoeuvre1'],
    effects: [],
    strategic: true,
    nations: ['lithuania', 'belarus'],
    description: 'Finding and fixing the emitters a jamming operation has to suppress first.',
    icon: 'recon',
  },
  {
    id: 'swarmControl',
    name: 'Swarm Control',
    easternName: 'Swarm Control',
    branch: 'air',
    tier: 2,
    cost: { mats: 700, req: 95 },
    seconds: 55,
    requires: ['air1'],
    effects: [],
    strategic: true,
    nations: ['poland', 'iran'],
    description: 'Datalinks and formation logic that keep a package of loitering munitions coordinated without a pilot.',
    icon: 'uav',
  },
  {
    id: 'autonomousStrike',
    name: 'Autonomous Strike Logic',
    easternName: 'Autonomous Strike Logic',
    branch: 'manoeuvre',
    tier: 2,
    cost: { mats: 800, req: 110 },
    seconds: 65,
    requires: ['manoeuvre1'],
    effects: [],
    strategic: true,
    nations: ['poland', 'iran'],
    description: 'Target classification and terminal autonomy that let a drone select a vehicle rather than a patch of ground.',
    icon: 'uav',
  },
  {
    id: 'directedEnergyPower',
    name: 'Directed-Energy Power',
    easternName: 'Directed-Energy Power',
    branch: 'manoeuvre',
    tier: 2,
    cost: { mats: 750, req: 100 },
    seconds: 60,
    requires: ['manoeuvre1'],
    effects: [],
    strategic: true,
    nations: ['finland', 'hungary'],
    description: 'Compact generation and cooling for a ground-based beam emitter that has to fire repeatedly.',
    icon: 'power',
  },
  {
    id: 'beamTargeting',
    name: 'Beam Targeting',
    easternName: 'Beam Targeting',
    branch: 'air',
    tier: 2,
    cost: { mats: 850, req: 120 },
    seconds: 70,
    requires: ['air1'],
    effects: [],
    strategic: true,
    nations: ['finland', 'hungary'],
    description: 'Fast tracking and atmospheric compensation for a directed-energy defence network.',
    icon: 'scope',
  },
]);

/**
 * Purchasable capabilities. Both are granted by an approved technology (see
 * `manoeuvre1`), so the catalogue and the tree agree: research makes the
 * capability available everywhere, and the player still buys it per unit or
 * per structure. A future technology only has to add a `grantUnitUpgrade` or
 * `grantBuildingModule` effect; nothing else reads this list.
 */
const UPGRADE_LIST: readonly UnitUpgradeDef[] = Object.freeze([
  {
    id: 'reconSmokescreen',
    name: 'Recon Smokescreen',
    description:
      'A smoke discharger on a reconnaissance vehicle. Research fits one to every owned recon hull; each crew fires and reloads its own.',
    eligibleSlots: ['recon'],
    kind: 'active',
    cost: { mats: 60, req: 10 },
    cooldownSeconds: 45,
    durationSeconds: 8,
    icon: 'eyeOff',
  },
]);

/** Every runtime effect carried by a set of installed module ids. */
export interface ResolvedModuleEffects {
  /** Net grid contribution: positive supply, negative draw. */
  power: number;
  /** Multiplier applied to a structure's base research speed. */
  researchSpeed: number;
  capabilities: Set<string>;
}

/**
 * Resolve installed modules into the effects the simulation applies.
 *
 * Module state is a list of ids on the individual structure. This is the one
 * place that turns those ids into numbers, so the grid, the research clock and a
 * later module panel cannot disagree about what an installed module does.
 */
export function installedModuleEffects(
  moduleIds: readonly string[],
  catalog: ResearchCatalog = RESEARCH,
): ResolvedModuleEffects {
  const resolved: ResolvedModuleEffects = {
    power: 0,
    researchSpeed: 1,
    capabilities: new Set(),
  };
  for (const id of moduleIds) {
    const module = buildingModuleDef(id, catalog);
    if (!module) continue;
    for (const effect of module.effects) {
      if (effect.kind === 'power') resolved.power += effect.amount;
      else if (effect.kind === 'researchSpeed') resolved.researchSpeed *= effect.multiplier;
      else if (effect.kind === 'capability') resolved.capabilities.add(effect.capability);
    }
  }
  return resolved;
}

const MODULE_LIST: readonly BuildingModuleDef[] = Object.freeze([
  {
    id: 'advancedTurbine',
    name: 'Advanced Turbine',
    description:
      'A higher-output turbine core for one plant. Research makes it available on every eligible plant; the player buys it per structure.',
    /** Granted by `manoeuvre1`; see the effect list on that node. */
    eligibleSlots: ['powerPlant'],
    cost: { mats: 450, req: 25 },
    capacity: 1,
    effects: [{ kind: 'power', amount: 30 }],
    icon: 'power',
  },
]);

export const RESEARCH: ResearchCatalog = Object.freeze({
  techs: TECH_LIST,
  upgrades: UPGRADE_LIST,
  modules: MODULE_LIST,
});

const techIndex = new Map(TECH_LIST.map((tech) => [tech.id, tech]));
const upgradeIndex = new Map(UPGRADE_LIST.map((upgrade) => [upgrade.id, upgrade]));
const moduleIndex = new Map(MODULE_LIST.map((module) => [module.id, module]));

export const TECHS: Readonly<Record<string, TechDef>> = Object.freeze(
  Object.fromEntries(TECH_LIST.map((tech) => [tech.id, tech])),
);
export const UNIT_UPGRADES: Readonly<Record<string, UnitUpgradeDef>> = Object.freeze(
  Object.fromEntries(UPGRADE_LIST.map((upgrade) => [upgrade.id, upgrade])),
);
export const BUILDING_MODULES: Readonly<Record<string, BuildingModuleDef>> = Object.freeze(
  Object.fromEntries(MODULE_LIST.map((module) => [module.id, module])),
);

export function techDef(id: string, catalog: ResearchCatalog = RESEARCH): TechDef | undefined {
  if (catalog === RESEARCH) return techIndex.get(id);
  return catalog.techs.find((tech) => tech.id === id);
}

export function unitUpgradeDef(
  id: string,
  catalog: ResearchCatalog = RESEARCH,
): UnitUpgradeDef | undefined {
  if (catalog === RESEARCH) return upgradeIndex.get(id);
  return catalog.upgrades.find((upgrade) => upgrade.id === id);
}

export function buildingModuleDef(
  id: string,
  catalog: ResearchCatalog = RESEARCH,
): BuildingModuleDef | undefined {
  if (catalog === RESEARCH) return moduleIndex.get(id);
  return catalog.modules.find((module) => module.id === id);
}

export function isTierZeroUnit(slot: string): boolean {
  return TIER_ZERO_UNITS.includes(slot);
}

export function isTierZeroBuilding(slot: string): boolean {
  return TIER_ZERO_BUILDINGS.includes(slot);
}

/** Every effect a set of completed technologies grants, resolved once. */
export interface ResearchUnlocks {
  unitSlots: Set<string>;
  buildingSlots: Set<string>;
  upgrades: Set<string>;
  modules: Set<string>;
}

export function resolveResearchUnlocks(
  completed: readonly string[],
  catalog: ResearchCatalog = RESEARCH,
): ResearchUnlocks {
  const unlocks: ResearchUnlocks = {
    unitSlots: new Set(),
    buildingSlots: new Set(),
    upgrades: new Set(),
    modules: new Set(),
  };
  const done = new Set(completed);
  for (const tech of catalog.techs) {
    if (!done.has(tech.id)) continue;
    for (const effect of tech.effects) {
      if (effect.kind === 'unlockUnit') unlocks.unitSlots.add(effect.slot);
      else if (effect.kind === 'unlockBuilding') unlocks.buildingSlots.add(effect.slot);
      else if (effect.kind === 'grantUnitUpgrade') unlocks.upgrades.add(effect.upgrade);
      else if (effect.kind === 'grantBuildingModule') unlocks.modules.add(effect.module);
    }
  }
  return unlocks;
}

/** Whether a canonical unit slot is available with this research. */
export function unitSlotAvailable(
  completed: readonly string[],
  slot: string,
  catalog: ResearchCatalog = RESEARCH,
): boolean {
  return isTierZeroUnit(slot) || resolveResearchUnlocks(completed, catalog).unitSlots.has(slot);
}

/**
 * Whether a concrete unit definition is available with this research. A
 * national replacement inherits its canonical slot; an exclusive carries its
 * own branch-tier requirement from `EXCLUSIVE_UNIT_TECH`.
 */
export function unitDefinitionAvailable(
  completed: readonly string[],
  defId: string,
  catalog: ResearchCatalog = RESEARCH,
): boolean {
  if (!UNITS[defId]) return false;
  const exclusive = exclusiveUnitTech(defId);
  if (exclusive !== undefined) {
    return exclusive === null || completed.includes(exclusive);
  }
  return unitSlotAvailable(completed, unitFamily(defId), catalog);
}

/** Whether a canonical structure slot is available with this research. */
export function buildingSlotAvailable(
  completed: readonly string[],
  slot: string,
  catalog: ResearchCatalog = RESEARCH,
): boolean {
  return (
    isTierZeroBuilding(slot) || resolveResearchUnlocks(completed, catalog).buildingSlots.has(slot)
  );
}

/** Technologies whose effects remain unresolved for this completion set. */
export function nextTechnologies(
  completed: readonly string[],
  catalog: ResearchCatalog = RESEARCH,
): TechDef[] {
  const done = new Set(completed);
  return catalog.techs.filter(
    (tech) => !done.has(tech.id) && tech.requires.every((id) => done.has(id)),
  );
}

/** Upgrades researched globally and still legal for this canonical unit slot. */
export function upgradesForSlot(
  completed: readonly string[],
  unitSlot: string,
  catalog: ResearchCatalog = RESEARCH,
): UnitUpgradeDef[] {
  const unlocks = resolveResearchUnlocks(completed, catalog);
  return catalog.upgrades.filter(
    (upgrade) => unlocks.upgrades.has(upgrade.id) && upgrade.eligibleSlots.includes(unitSlot),
  );
}

/** Modules researched globally and still legal for this canonical building slot. */
export function modulesForSlot(
  completed: readonly string[],
  buildingSlot: string,
  catalog: ResearchCatalog = RESEARCH,
): BuildingModuleDef[] {
  const unlocks = resolveResearchUnlocks(completed, catalog);
  return catalog.modules.filter(
    (module) => unlocks.modules.has(module.id) && module.eligibleSlots.includes(buildingSlot),
  );
}

/** Cost of a technology in one currency pair, or null for an unknown id. */
export function techCost(id: string, catalog: ResearchCatalog = RESEARCH): Cost | null {
  return techDef(id, catalog)?.cost ?? null;
}

/** The doctrine name the selected alliance would actually read in its tree. */
export function techDisplayName(tech: TechDef, allianceId?: string): string {
  return allianceId === 'eastern' ? tech.easternName : tech.name;
}

/**
 * Every technology that must be completed before one concrete unit is
 * available. National replacements resolve through their canonical slot, while
 * an exclusive uses its explicit `EXCLUSIVE_UNIT_TECH` entry. This is read by
 * both the production reason and the research panel, so they cannot disagree
 * about which node opens a platform.
 */
export function requiredTechnologiesForUnit(
  defId: string,
  catalog: ResearchCatalog = RESEARCH,
): TechDef[] {
  if (!UNITS[defId]) return [];
  const exclusive = exclusiveUnitTech(defId);
  if (exclusive !== undefined) {
    if (exclusive === null) return [];
    const tech = techDef(exclusive, catalog);
    return tech ? [tech] : [];
  }
  const slot = unitFamily(defId);
  return catalog.techs.filter((tech) =>
    tech.effects.some((effect) => effect.kind === 'unlockUnit' && effect.slot === slot),
  );
}

/** Every technology that must be completed before one concrete structure is available. */
export function requiredTechnologiesForBuilding(
  defId: string,
  catalog: ResearchCatalog = RESEARCH,
): TechDef[] {
  if (!BUILDINGS[defId]) return [];
  const slot = buildingFamily(defId);
  return catalog.techs.filter((tech) =>
    tech.effects.some((effect) => effect.kind === 'unlockBuilding' && effect.slot === slot),
  );
}

const MAX_TECH_DEPTH = 8;

export interface ResearchIssue {
  code: string;
  message: string;
  techId?: string;
  upgradeId?: string;
  moduleId?: string;
}

/**
 * Validate a catalogue. The default catalogue is checked by the suite, and the
 * simulation's injected catalogues go through the same function, so an invalid
 * fixture fails with a readable diagnostic instead of silently unlocking
 * nothing.
 */
export function validateResearchCatalog(catalog: ResearchCatalog = RESEARCH): ResearchIssue[] {
  const issues: ResearchIssue[] = [];
  const techIds = new Set<string>();
  const techs = new Map<string, TechDef>();
  // One canonical slot has one unlock owner. Two technologies unlocking the
  // same platform is harmless at runtime but almost always an authoring error,
  // so it is reported instead of resolved by catalogue order.
  const unitOwners = new Map<string, string>();
  const buildingOwners = new Map<string, string>();
  const upgradeOwners = new Map<string, string>();
  const moduleOwners = new Map<string, string>();

  if (catalog.techs.length === 0) {
    issues.push({ code: 'empty', message: 'The research catalog has no technologies.' });
  }

  for (const tech of catalog.techs) {
    if (!tech.id || !/^[A-Za-z][A-Za-z0-9]*$/.test(tech.id)) {
      issues.push({ code: 'tech-id', message: `Invalid technology id "${tech.id}".`, techId: tech.id });
    }
    if (techIds.has(tech.id)) {
      issues.push({ code: 'duplicate-tech', message: `Duplicate technology id "${tech.id}".`, techId: tech.id });
    }
    techIds.add(tech.id);
    techs.set(tech.id, tech);
    if (!RESEARCH_BRANCHES.includes(tech.branch)) {
      issues.push({
        code: 'branch',
        message: `Technology "${tech.id}" names unknown branch "${tech.branch}".`,
        techId: tech.id,
      });
    }
    if (tech.tier !== 1 && tech.tier !== 2) {
      issues.push({ code: 'tier', message: `Technology "${tech.id}" has tier ${tech.tier}.`, techId: tech.id });
    }
    if (!Number.isInteger(tech.cost.mats) || tech.cost.mats < 0) {
      issues.push({ code: 'cost', message: `Technology "${tech.id}" has invalid material cost.`, techId: tech.id });
    }
    if (!Number.isInteger(tech.cost.req) || tech.cost.req < 0) {
      issues.push({ code: 'cost', message: `Technology "${tech.id}" has invalid requisition cost.`, techId: tech.id });
    }
    if (!Number.isFinite(tech.seconds) || tech.seconds <= 0) {
      issues.push({ code: 'duration', message: `Technology "${tech.id}" has invalid duration.`, techId: tech.id });
    }
    if (tech.effects.length === 0 && !tech.strategic) {
      issues.push({ code: 'effect', message: `Technology "${tech.id}" grants no effect.`, techId: tech.id });
    }
    // An authority node that also unlocks something would be counted twice: once
    // as an ordinary branch tier and once as part of a capability chain.
    if (tech.strategic && tech.effects.length > 0) {
      issues.push({
        code: 'strategic-effect',
        message: `Strategic authority node "${tech.id}" also grants an unlock.`,
        techId: tech.id,
      });
    }
    for (const allianceId of tech.alliances ?? []) {
      if (!Object.hasOwn(ALLIANCES, allianceId)) {
        issues.push({
          code: 'alliance-restriction',
          message: `Technology "${tech.id}" names unknown alliance "${allianceId}".`,
          techId: tech.id,
        });
      }
    }
    for (const nationId of tech.nations ?? []) {
      if (!Object.hasOwn(NATIONS, nationId)) {
        issues.push({
          code: 'nation-restriction',
          message: `Technology "${tech.id}" names unknown nation "${nationId}".`,
          techId: tech.id,
        });
      }
    }
    if (tech.alliances && tech.alliances.length === 0) {
      issues.push({
        code: 'alliance-restriction',
        message: `Technology "${tech.id}" has an empty alliance restriction.`,
        techId: tech.id,
      });
    }
    if (tech.nations && tech.nations.length === 0) {
      issues.push({
        code: 'nation-restriction',
        message: `Technology "${tech.id}" has an empty nation restriction.`,
        techId: tech.id,
      });
    }
    for (const effect of tech.effects) {
      if (effect.kind === 'unlockUnit') {
        if (!UNITS[effect.slot]) {
          issues.push({
            code: 'missing-unit',
            message: `Technology "${tech.id}" unlocks unknown unit "${effect.slot}".`,
            techId: tech.id,
          });
        } else if (unitFamily(effect.slot) !== effect.slot) {
          issues.push({
            code: 'unit-slot',
            message: `Technology "${tech.id}" unlocks "${effect.slot}", which is not a canonical unit slot.`,
            techId: tech.id,
          });
        } else if (unitOwners.has(effect.slot)) {
          issues.push({
            code: 'duplicate-unlock',
            message: `Unit slot "${effect.slot}" is already unlocked by "${unitOwners.get(effect.slot)}".`,
            techId: tech.id,
          });
        } else {
          unitOwners.set(effect.slot, tech.id);
        }
      } else if (effect.kind === 'unlockBuilding') {
        if (!BUILDINGS[effect.slot]) {
          issues.push({
            code: 'missing-building',
            message: `Technology "${tech.id}" unlocks unknown building "${effect.slot}".`,
            techId: tech.id,
          });
        } else if (buildingFamily(effect.slot) !== effect.slot) {
          issues.push({
            code: 'building-slot',
            message: `Technology "${tech.id}" unlocks "${effect.slot}", which is not a canonical structure slot.`,
            techId: tech.id,
          });
        } else if (buildingOwners.has(effect.slot)) {
          issues.push({
            code: 'duplicate-unlock',
            message: `Structure slot "${effect.slot}" is already unlocked by "${buildingOwners.get(effect.slot)}".`,
            techId: tech.id,
          });
        } else {
          buildingOwners.set(effect.slot, tech.id);
        }
      } else if (effect.kind === 'grantUnitUpgrade') {
        const upgrade = catalog.upgrades.find((entry) => entry.id === effect.upgrade);
        if (!upgrade) {
          issues.push({
            code: 'missing-upgrade',
            message: `Technology "${tech.id}" grants unknown upgrade "${effect.upgrade}".`,
            techId: tech.id,
          });
        } else if (upgradeOwners.has(effect.upgrade)) {
          issues.push({
            code: 'duplicate-unlock',
            message: `Upgrade "${effect.upgrade}" is already granted by "${upgradeOwners.get(effect.upgrade)}".`,
            techId: tech.id,
          });
        } else {
          upgradeOwners.set(effect.upgrade, tech.id);
        }
      } else if (effect.kind === 'grantBuildingModule') {
        const module = catalog.modules.find((entry) => entry.id === effect.module);
        if (!module) {
          issues.push({
            code: 'missing-module',
            message: `Technology "${tech.id}" grants unknown module "${effect.module}".`,
            techId: tech.id,
          });
        } else if (moduleOwners.has(effect.module)) {
          issues.push({
            code: 'duplicate-unlock',
            message: `Module "${effect.module}" is already granted by "${moduleOwners.get(effect.module)}".`,
            techId: tech.id,
          });
        } else {
          moduleOwners.set(effect.module, tech.id);
        }
      } else {
        issues.push({
          code: 'effect-kind',
          message: `Technology "${tech.id}" has an unknown effect.`,
          techId: tech.id,
        });
      }
    }
  }

  for (const tech of catalog.techs) {
    for (const required of tech.requires) {
      const prerequisite = techs.get(required);
      if (!prerequisite) {
        issues.push({
          code: 'missing-prerequisite',
          message: `Technology "${tech.id}" requires unknown "${required}".`,
          techId: tech.id,
        });
        continue;
      }
      if (prerequisite.branch !== tech.branch) {
        issues.push({
          code: 'cross-branch',
          message: `Technology "${tech.id}" requires "${required}" from another branch.`,
          techId: tech.id,
        });
      }
      if (prerequisite.tier >= tech.tier) {
        issues.push({
          code: 'prerequisite-tier',
          message: `Technology "${tech.id}" requires "${required}", which is not a lower tier.`,
          techId: tech.id,
        });
      }
    }
    if (tech.tier === 2 && tech.requires.length !== 1) {
      issues.push({
        code: 'tier2-requires',
        message: `Technology "${tech.id}" is tier 2 but does not require exactly one tier-1 node.`,
        techId: tech.id,
      });
    }
  }

  // Depth- and cycle-guarded walk. A cycle must be reported, not recursed into.
  for (const tech of catalog.techs) {
    const seen = new Map<string, number>();
    let current: TechDef | undefined = tech;
    let depth = 0;
    while (current) {
      const previous = seen.get(current.id);
      if (previous !== undefined) {
        issues.push({
          code: 'cycle',
          message: `Prerequisite cycle through "${current.id}".`,
          techId: tech.id,
        });
        break;
      }
      seen.set(current.id, depth);
      if (depth > MAX_TECH_DEPTH) {
        issues.push({
          code: 'depth',
          message: `Prerequisite chain from "${tech.id}" is deeper than ${MAX_TECH_DEPTH}.`,
          techId: tech.id,
        });
        break;
      }
      const next: string | undefined = current.requires[0];
      current = next ? techs.get(next) : undefined;
      depth++;
    }
  }

  // Strategic authority chains. A capability names exactly four completed
  // technologies, and every authority node belongs to exactly one chain: a node
  // no capability claims is a dead end somebody meant to wire up, and a node
  // claimed twice would make two capabilities share part of a chain.
  const strategicNodeIds = new Set(
    catalog.techs.filter((tech) => tech.strategic).map((tech) => tech.id),
  );
  if (strategicNodeIds.size > 0) {
    const claimed = new Map<string, string>();
    for (const family of SUPERWEAPON_FAMILY_LIST) {
      if (family.requires.length !== 4) {
        issues.push({
          code: 'strategic-chain',
          message: `Capability "${family.id}" names ${family.requires.length} prerequisites; exactly four are required.`,
        });
      }
      let authorityNodes = 0;
      for (const id of family.requires) {
        const tech = techs.get(id);
        if (!tech) {
          issues.push({
            code: 'missing-prerequisite',
            message: `Capability "${family.id}" requires unknown technology "${id}".`,
            techId: id,
          });
          continue;
        }
        // Shared branch work may appear in several chains: a commander who has
        // studied the strike tier has studied it for every capability that
        // rides on it. A dedicated authority node belongs to one chain only.
        if (!tech.strategic) continue;
        authorityNodes++;
        const owner = claimed.get(id);
        if (owner) {
          issues.push({
            code: 'strategic-chain',
            message: `Authority node "${id}" is claimed by both "${owner}" and "${family.id}".`,
            techId: id,
          });
          continue;
        }
        claimed.set(id, family.id);
      }
      // Two dedicated nodes beside two branch tiers is the documented shape of
      // a four-research chain; a family with a different split is an authoring
      // slip rather than a design choice.
      if (authorityNodes !== 2) {
        issues.push({
          code: 'strategic-chain',
          message: `Capability "${family.id}" names ${authorityNodes} dedicated authority nodes; exactly two are required beside two branch tiers.`,
        });
      }
    }
    for (const id of strategicNodeIds) {
      if (!claimed.has(id)) {
        issues.push({
          code: 'strategic-unused',
          message: `Strategic authority node "${id}" belongs to no capability chain.`,
          techId: id,
        });
      }
    }
  }

  for (const upgrade of catalog.upgrades) {
    if (catalog.upgrades.filter((entry) => entry.id === upgrade.id).length > 1) {
      issues.push({
        code: 'duplicate-upgrade',
        message: `Duplicate unit upgrade id "${upgrade.id}".`,
        upgradeId: upgrade.id,
      });
    }
    if (upgrade.eligibleSlots.length === 0) {
      issues.push({
        code: 'upgrade-targets',
        message: `Upgrade "${upgrade.id}" names no eligible unit slot.`,
        upgradeId: upgrade.id,
      });
    }
    for (const slot of upgrade.eligibleSlots) {
      if (!UNITS[slot] || unitFamily(slot) !== slot) {
        issues.push({
          code: 'upgrade-target',
          message: `Upgrade "${upgrade.id}" targets "${slot}", which is not a canonical unit slot.`,
          upgradeId: upgrade.id,
        });
      }
    }
    if (upgrade.cost.mats < 0 || upgrade.cost.req < 0) {
      issues.push({
        code: 'upgrade-cost',
        message: `Upgrade "${upgrade.id}" has a negative cost.`,
        upgradeId: upgrade.id,
      });
    }
  }

  for (const module of catalog.modules) {
    if (catalog.modules.filter((entry) => entry.id === module.id).length > 1) {
      issues.push({
        code: 'duplicate-module',
        message: `Duplicate building module id "${module.id}".`,
        moduleId: module.id,
      });
    }
    if (module.eligibleSlots.length === 0) {
      issues.push({
        code: 'module-targets',
        message: `Module "${module.id}" names no eligible structure slot.`,
        moduleId: module.id,
      });
    }
    for (const slot of module.eligibleSlots) {
      if (!BUILDINGS[slot] || buildingFamily(slot) !== slot) {
        issues.push({
          code: 'module-target',
          message: `Module "${module.id}" targets "${slot}", which is not a canonical structure slot.`,
          moduleId: module.id,
        });
      }
    }
    if (module.cost.mats < 0 || module.cost.req < 0) {
      issues.push({
        code: 'module-cost',
        message: `Module "${module.id}" has a negative cost.`,
        moduleId: module.id,
      });
    }
    if (module.capacity !== undefined && (!Number.isInteger(module.capacity) || module.capacity < 1)) {
      issues.push({
        code: 'module-capacity',
        message: `Module "${module.id}" has an invalid capacity.`,
        moduleId: module.id,
      });
    }
  }

  return issues;
}
