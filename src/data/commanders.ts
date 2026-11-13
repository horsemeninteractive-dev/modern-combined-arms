/**
 * Commander catalogue — Phase 2 of the Adaptive Commander AI programme.
 *
 * Authored identity and doctrine for the thirty commanders specified in
 * `docs/ADAPTIVE_COMMANDER_AI_PHASE_1_NATIONAL_DOCTRINE.md`. This module is
 * **data plus validation only**: nothing here decides anything at runtime.
 * `aiProfile()` in `src/sim/ai.ts` is the single consumer, and only when a
 * commander is named explicitly.
 *
 * Design rules enforced by `validateCommanderCatalog()`:
 *   - a commander belongs to exactly one playable nation;
 *   - every signature unit and building resolves through that nation's roster
 *     (`resolveRoster`), never through the shared catalogue alone, because
 *     national equipment is deliberately absent from `UNIT_LIST`;
 *   - every research reference names a real technology;
 *   - every production-slot weight names a canonical slot the nation fields;
 *   - every scalar is finite and inside the range the existing AI profile uses.
 *
 * Determinism: definitions are frozen literals. Resolution is a pure function of
 * (commander id, difficulty) — no clock, no `Math.random`, no mutable state.
 */
import { NATIONS } from './factions';
import { resolveRoster, unitSlotId, buildingSlotId } from './roster';
import { TECHS } from './research';
import type { AIStrategy } from '../sim/types';

/** Profile schema version; persists beside the commander id in a save. */
export const COMMANDER_PROFILE_VERSION = 1;

/**
 * The five openings the shipped planner understands. Declared here rather than
 * imported from `ai.ts` to keep the data module free of a circular import;
 * `tests/commanders.test.ts` asserts the two lists agree.
 */
export const COMMANDER_STRATEGIES: readonly AIStrategy[] = Object.freeze([
  'armour',
  'infantry',
  'air',
  'economy',
  'pressure',
]);

/**
 * Capability vocabulary. A tag is a claim about what a commander leans on, and
 * each one names the canonical slots or technology that make it possible, so a
 * tag cannot be invented for equipment the game does not have.
 */
const CAPABILITY_SOURCES: Readonly<Record<string, { slots?: readonly string[]; tech?: string }>> =
  Object.freeze({
    'air-defence': { slots: ['aa', 'samBattery'] },
    'air-strike': { slots: ['fighter', 'attackHelo'] },
    armour: { slots: ['tank', 'ifv'] },
    'anti-armour': { slots: ['atgm', 'td'] },
    artillery: { slots: ['spg'] },
    fortification: { slots: ['mgNest', 'atTurret', 'bunker'] },
    'indirect-fire': { slots: ['spg', 'rocketArtillery'] },
    logistics: { slots: ['recovery', 'apc'] },
    naval: { slots: ['corvette', 'missileBoat', 'submarine'] },
    reconnaissance: { slots: ['recon', 'uav'] },
    'rocket-artillery': { slots: ['rocketArtillery'] },
    'superweapon-ew': { tech: 'manoeuvre1' },
    'superweapon-saturation': { tech: 'fires2' },
    transport: { slots: ['apc', 'transportHelo', 'landingCraft'] },
    unmanned: { slots: ['uav'] },
  });

export const COMMANDER_CAPABILITY_TAGS: readonly string[] = Object.freeze(
  Object.keys(CAPABILITY_SOURCES).sort(),
);

/**
 * What a commander is willing to spend an assault on.
 *
 * Deliberately coarse: each category is a class the existing target scorer
 * already recognises, so a preference reweights the scorer instead of adding a
 * parallel targeting system. `command` is separated from `production` because
 * the command post ends a match and is never a preference, only a target.
 */
export const COMMANDER_TARGET_CATEGORIES = Object.freeze([
  'command',
  'production',
  'economy',
  'defence',
  'fireSupport',
  'airDefence',
  'air',
  'naval',
  'combat',
  'recon',
  'support',
] as const);

export type CommanderTargetCategory = (typeof COMMANDER_TARGET_CATEGORIES)[number];

/**
 * The tactical half of a commander: how it reads a battlefield, not what it
 * builds. Derived from the authored scalars and capability tags so the 30
 * profiles cannot drift into contradictory target lists, and so a new
 * commander needs no second data entry to behave coherently.
 *
 * Neutral values are exactly 1. With no commander the AI uses the neutral
 * profile, which is why the legacy path is unchanged rather than merely close.
 */
export interface TacticalProfile {
  /** Bounded 0.75–1.4 multiplier per target class. */
  targetBias: Readonly<Record<CommanderTargetCategory, number>>;
  /** Bounded 0.85–1.3 scale on the radius that makes a contact a base threat. */
  threatRadius: number;
  /** Bounded 0.85–1.3 scale on the ring that makes a raid a recall emergency. */
  recallMargin: number;
}

/** Authored numeric identity. Offsets are added to the difficulty bias. */
export interface CommanderScalars {
  /** Opening this commander executes; validated against `COMMANDER_STRATEGIES`. */
  strategy: AIStrategy;
  /** Absolute base 0.05–0.95, exactly like the seeded profile's own range. */
  aggression: number;
  economy: number;
  tech: number;
  defence: number;
  /** Base army size, multiplied by the difficulty level's own scale. */
  armyScale: number;
  /** Multipliers on the difficulty level's execution values (0.7–1.25). */
  responseFactor: number;
  commitFactor: number;
  tempoFactor: number;
  /** Extra units held at home on top of the level's own reserve. */
  reserve: number;
  recall: boolean;
  protectEconomy: boolean;
  abilities: boolean;
}

export interface CommanderProfile extends CommanderScalars {
  /** Stable id, lower camel case, unique across all thirty. */
  id: string;
  nationId: string;
  name: string;
  callsign: string;
  /** One or two sentences; presentation only. */
  biography: string;
  primaryDoctrine: string;
  secondaryDoctrine: string;
  traits: readonly string[];
  /** Relative production weights per canonical slot; absent means neutral. */
  productionWeights: Readonly<Record<string, number>>;
  /** Relative construction weights per canonical structure slot. */
  buildWeights?: Readonly<Record<string, number>>;
  signatureUnits: readonly string[];
  signatureBuildings: readonly string[];
  /** Technology ids the commander prioritises, in order. */
  research: readonly string[];
  capabilityTags: readonly string[];
  doctrineTags: readonly string[];
  strengths: readonly string[];
  weaknesses: readonly string[];
  counters: readonly string[];
  /** Equipment the commander deliberately builds rarely or not at all. */
  underuses: readonly string[];
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

/**
 * A definition helper that freezes the arrays as well as the record, so a
 * caller cannot mutate the catalogue through a resolved reference. It performs
 * no validation: `validateCommanderCatalog()` is the single gate.
 */
function commander(profile: CommanderProfile): CommanderProfile {
  return freeze({
    ...profile,
    traits: Object.freeze([...profile.traits]),
    productionWeights: freeze({ ...profile.productionWeights }),
    buildWeights: freeze({ ...(profile.buildWeights ?? {}) }),
    signatureUnits: Object.freeze([...profile.signatureUnits]),
    signatureBuildings: Object.freeze([...profile.signatureBuildings]),
    research: Object.freeze([...profile.research]),
    capabilityTags: Object.freeze([...profile.capabilityTags]),
    doctrineTags: Object.freeze([...profile.doctrineTags]),
    strengths: Object.freeze([...profile.strengths]),
    weaknesses: Object.freeze([...profile.weaknesses]),
    counters: Object.freeze([...profile.counters]),
    underuses: Object.freeze([...profile.underuses]),
  }) as CommanderProfile;
}

export const COMMANDERS: readonly CommanderProfile[] = Object.freeze([
  /* ------------------------------------------------------------------ */
  /* Lithuania                                                          */
  /* ------------------------------------------------------------------ */
  commander({
    id: 'rasaVilkas',
    nationId: 'lithuania',
    name: 'Rasa Vilkas',
    callsign: 'Sietas',
    biography:
      'A territorial reconnaissance officer who ran border observation before the war and trusts a sighting more than a plan.',
    primaryDoctrine: 'Reconnaissance screen',
    secondaryDoctrine: 'Air denial',
    traits: ['watchful', 'frugal', 'stubborn'],
    strategy: 'infantry',
    aggression: 0.34,
    economy: 0.44,
    tech: 0.46,
    defence: 0.56,
    armyScale: 1,
    responseFactor: 1.05,
    commitFactor: 0.9,
    tempoFactor: 1,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { recon: 1.6, aa: 1.3, rifle: 1.2, tank: 0.6, spg: 0.7, kestrelTeam: 1.5 },
    signatureUnits: ['pathfinder', 'kestrelTeam', 'recon'],
    signatureBuildings: ['forwardPost'],
    research: ['manoeuvre1', 'air1'],
    capabilityTags: ['reconnaissance', 'air-defence', 'fortification'],
    doctrineTags: ['screen', 'information'],
    strengths: ['cheapest complete picture', 'punishes air-heavy opponents'],
    weaknesses: ['cannot break a fortified line', 'a massed armoured thrust ignores the screen'],
    counters: ['mass armour', 'blind-fire artillery'],
    underuses: ['tank', 'airfield'],
  }),
  commander({
    id: 'tomasBerzas',
    nationId: 'lithuania',
    name: 'Tomas Beržas',
    callsign: 'Stiklas',
    biography:
      'A signals and counter-battery specialist who treats the battlefield as a sensor grid and every hostile battery as a solved problem.',
    primaryDoctrine: 'Sensor grid',
    secondaryDoctrine: 'Observed fires',
    traits: ['methodical', 'analytical', 'detached'],
    strategy: 'economy',
    aggression: 0.4,
    economy: 0.62,
    tech: 0.55,
    defence: 0.5,
    armyScale: 0.95,
    responseFactor: 1.1,
    commitFactor: 1,
    tempoFactor: 0.95,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { spg: 1.6, recon: 1.5, tank: 0.7 },
    buildWeights: { radar: 1.4 },
    signatureUnits: ['pathfinder', 'spg', 'uav'],
    signatureBuildings: ['forwardPost', 'radar'],
    research: ['fires1', 'manoeuvre1'],
    capabilityTags: ['reconnaissance', 'indirect-fire', 'artillery'],
    doctrineTags: ['sensor-grid', 'counter-battery'],
    strengths: ['best counter-battery behaviour in the coalition', 'punishes static opponents'],
    weaknesses: ['the grid is fragile', 'fast manoeuvre outruns the fire mission'],
    counters: ['deep strike', 'fast armour'],
    underuses: ['tank', 'attackHelo', 'navy'],
  }),
  commander({
    id: 'aisteNarusyte',
    nationId: 'lithuania',
    name: 'Aistė Narušytė',
    callsign: 'Vėjas',
    biography:
      'A light-infantry raider who learned to fight in forests with borrowed transport and has never trusted a fixed position since.',
    primaryDoctrine: 'Raid and withdraw',
    secondaryDoctrine: 'Air-mobile harassment',
    traits: ['bold', 'improvisational', 'impatient'],
    strategy: 'pressure',
    aggression: 0.72,
    economy: 0.36,
    tech: 0.4,
    defence: 0.24,
    armyScale: 0.9,
    responseFactor: 0.85,
    commitFactor: 0.8,
    tempoFactor: 0.8,
    reserve: 0,
    recall: false,
    protectEconomy: false,
    abilities: true,
    productionWeights: { recon: 1.7, apc: 1.5, rifle: 1.2, tank: 0.4, spg: 0.4, kestrelTeam: 1.6 },
    signatureUnits: ['pathfinder', 'apc', 'kestrelTeam', 'transportHelo'],
    signatureBuildings: ['forwardPost'],
    research: ['manoeuvre1', 'air1'],
    capabilityTags: ['reconnaissance', 'transport', 'air-defence'],
    doctrineTags: ['raid', 'harassment'],
    strengths: ['can end a match early', 'punishes greedy economies'],
    weaknesses: ['loses to anyone who fortifies and keeps a reserve', 'a failed raid leaves nothing'],
    counters: ['fortified lines', 'reserves'],
    underuses: ['artillery', 'tank', 'fortification'],
  }),

  /* ------------------------------------------------------------------ */
  /* Poland                                                             */
  /* ------------------------------------------------------------------ */
  commander({
    id: 'krzysztofZawadzki',
    nationId: 'poland',
    name: 'Krzysztof Zawadzki',
    callsign: 'Młot',
    biography:
      'A pre-war armoured brigade commander who believes the decisive fight is a single massed blow and has no patience for anything else.',
    primaryDoctrine: 'Armoured breakthrough',
    secondaryDoctrine: 'Attrition',
    traits: ['decisive', 'impatient', 'fearless'],
    strategy: 'armour',
    aggression: 0.78,
    economy: 0.5,
    tech: 0.48,
    defence: 0.28,
    armyScale: 1.1,
    responseFactor: 0.85,
    commitFactor: 0.85,
    tempoFactor: 0.9,
    reserve: 0,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { tank: 1.9, ifv: 1.2, recon: 0.7, rifle: 0.7, wilk: 1.6 },
    signatureUnits: ['spearhead', 'wilk'],
    signatureBuildings: ['armourWorks'],
    research: ['manoeuvre1', 'manoeuvre2'],
    capabilityTags: ['armour', 'anti-armour'],
    doctrineTags: ['breakthrough', 'concentration'],
    strengths: ['most direct route to a knockout', 'punishes unprepared opponents'],
    weaknesses: ['predictable axis', 'deep strike and attrition ruin the wave'],
    counters: ['deep strike', 'prepared anti-tank lines', 'siege artillery'],
    underuses: ['recon', 'fighter', 'fortification'],
  }),
  commander({
    id: 'martaZielinska',
    nationId: 'poland',
    name: 'Marta Zielińska',
    callsign: 'Pancerna',
    biography:
      'A mechanised infantry officer who argues that tanks without infantry are targets, and has the casualty figures to prove it.',
    primaryDoctrine: 'Mechanised combined arms',
    secondaryDoctrine: 'Layered assault',
    traits: ['balanced', 'patient', 'pragmatic'],
    strategy: 'armour',
    aggression: 0.52,
    economy: 0.52,
    tech: 0.5,
    defence: 0.46,
    armyScale: 1.05,
    responseFactor: 1.05,
    commitFactor: 1.05,
    tempoFactor: 1,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { ifv: 1.6, tank: 1.3, rifle: 1.1, medic: 1.2, recovery: 1.2, wilk: 1.4 },
    signatureUnits: ['wilk', 'spearhead', 'apc', 'recovery'],
    signatureBuildings: ['armourWorks'],
    research: ['manoeuvre1', 'fires1'],
    capabilityTags: ['armour', 'anti-armour', 'logistics'],
    doctrineTags: ['combined-arms', 'formation'],
    strengths: ['most consistent Polish commander', 'hard to counter with one arm'],
    weaknesses: ['slow to exploit a collapse', 'a fast raider can out-tempo the formation'],
    counters: ['fast light forces', 'raiding'],
    underuses: ['fighter', 'navy'],
  }),
  commander({
    id: 'piotrGrabowski',
    nationId: 'poland',
    name: 'Piotr Grabowski',
    callsign: 'Bastion',
    biography:
      'A defensive armour commander who fights from prepared positions and counter-attacks over the wreckage of the first wave.',
    primaryDoctrine: 'Armoured defence',
    secondaryDoctrine: 'Counter-punch',
    traits: ['cautious', 'disciplined', 'ruthless'],
    strategy: 'armour',
    aggression: 0.34,
    economy: 0.64,
    tech: 0.48,
    defence: 0.74,
    armyScale: 1,
    responseFactor: 1.15,
    commitFactor: 1.1,
    tempoFactor: 1.05,
    reserve: 2,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { tank: 1.5, td: 1.5, rifle: 1.1 },
    buildWeights: { atTurret: 1.3 },
    signatureUnits: ['spearhead', 'td'],
    signatureBuildings: ['armourWorks', 'atTurret'],
    research: ['manoeuvre2', 'fires1'],
    capabilityTags: ['armour', 'anti-armour', 'fortification'],
    doctrineTags: ['defence', 'counter-attack'],
    strengths: ['punishes aggressive commanders', 'very hard to break with a first wave'],
    weaknesses: ['gives up the initiative', 'loses to an opponent who simply out-economies him'],
    counters: ['economic play', 'siege'],
    underuses: ['fighter', 'rocketArtillery'],
  }),

  /* ------------------------------------------------------------------ */
  /* United Kingdom                                                     */
  /* ------------------------------------------------------------------ */
  commander({
    id: 'eleanorHayes',
    nationId: 'uk',
    name: 'Eleanor Hayes',
    callsign: 'Barrage',
    biography:
      'A gunnery officer who came up through rocket troops and still believes volume of fire beats precision of aim.',
    primaryDoctrine: 'Saturation fires',
    secondaryDoctrine: 'Area denial',
    traits: ['aggressive', 'gregarious', 'overconfident'],
    strategy: 'pressure',
    aggression: 0.66,
    economy: 0.62,
    tech: 0.52,
    defence: 0.34,
    armyScale: 1,
    responseFactor: 0.9,
    commitFactor: 0.9,
    tempoFactor: 0.95,
    reserve: 0,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { rocketArtillery: 1.8, spg: 1.4, rifle: 0.8, tank: 0.6 },
    signatureUnits: ['mlrs', 'rocketArtillery'],
    signatureBuildings: ['factory'],
    research: ['fires1', 'fires2'],
    capabilityTags: ['indirect-fire', 'rocket-artillery', 'artillery'],
    doctrineTags: ['saturation', 'area-denial'],
    strengths: ['deletes static defence and infantry armies', 'forces movement'],
    weaknesses: ['poor against dispersed targets', 'a fast push reaches the launchers'],
    counters: ['mobile warfare', 'air strike'],
    underuses: ['tank', 'infantry', 'navy'],
  }),
  commander({
    id: 'jamesAshcroft',
    nationId: 'uk',
    name: 'James Ashcroft',
    callsign: 'Longbow',
    biography:
      'A deep-strike planner who treats enemy production as the real front line and considers a battle a failure of timing.',
    primaryDoctrine: 'Deep strike',
    secondaryDoctrine: 'Decapitation',
    traits: ['patient', 'manipulative', 'perfectionist'],
    strategy: 'economy',
    aggression: 0.44,
    economy: 0.7,
    tech: 0.72,
    defence: 0.36,
    armyScale: 0.85,
    responseFactor: 1.15,
    commitFactor: 1.1,
    tempoFactor: 1.1,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { uav: 1.6, recon: 1.4, fighter: 1.2, tank: 0.5, rifle: 0.6, stormShadow: 1.6 },
    signatureUnits: ['stormShadow', 'uav', 'recon'],
    signatureBuildings: ['expeditionaryAirfield'],
    research: ['air1', 'fires1'],
    capabilityTags: ['air-strike', 'reconnaissance', 'indirect-fire'],
    doctrineTags: ['deep-strike', 'decapitation'],
    strengths: ['can win without a decisive battle', 'best answer to turtle economies'],
    weaknesses: ['useless at close range', 'losing the airfield blinds him'],
    counters: ['fast pushes', 'dispersed bases'],
    underuses: ['infantry', 'tank', 'fortification'],
  }),
  commander({
    id: 'nadiaOkoro',
    nationId: 'uk',
    name: 'Nadia Okoro',
    callsign: 'Bridgehead',
    biography:
      'An expeditionary logistics officer who fights with whatever arrives first and treats a fixed plan as a liability.',
    primaryDoctrine: 'Expeditionary tempo',
    secondaryDoctrine: 'Air-land manoeuvre',
    traits: ['flexible', 'calm', 'opportunistic'],
    strategy: 'air',
    aggression: 0.62,
    economy: 0.5,
    tech: 0.6,
    defence: 0.4,
    armyScale: 1,
    responseFactor: 1,
    commitFactor: 0.95,
    tempoFactor: 0.85,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { fighter: 1.4, attackHelo: 1.5, apc: 1.3, rifle: 1.1, tank: 0.7 },
    signatureUnits: ['fighter', 'attackHelo', 'apc'],
    signatureBuildings: ['expeditionaryAirfield'],
    research: ['air1', 'manoeuvre1'],
    capabilityTags: ['air-strike', 'transport', 'air-defence'],
    doctrineTags: ['expeditionary', 'tempo'],
    strengths: ['fast and flexible', 'exploits an undefended flank'],
    weaknesses: ['the airfield is the plan', 'heavy SAM coverage ends it'],
    counters: ['long-range SAM', 'layered air defence'],
    underuses: ['tank', 'rocketArtillery', 'fortification'],
  }),

  /* ------------------------------------------------------------------ */
  /* Finland                                                            */
  /* ------------------------------------------------------------------ */
  commander({
    id: 'ainoKorhonen',
    nationId: 'finland',
    name: 'Aino Korhonen',
    callsign: 'Linja',
    biography:
      'A territorial commander who mobilised the north and has not given a metre of it back since.',
    primaryDoctrine: 'Territorial defence',
    secondaryDoctrine: 'Infantry attrition',
    traits: ['stubborn', 'practical', 'protective'],
    strategy: 'infantry',
    aggression: 0.26,
    economy: 0.52,
    tech: 0.42,
    defence: 0.8,
    armyScale: 1,
    responseFactor: 1.1,
    commitFactor: 1.15,
    tempoFactor: 1.05,
    reserve: 2,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { rifle: 1.8, atgm: 1.2, medic: 1.3, tank: 0.5, spg: 0.6, spikeTeam: 1.4 },
    signatureUnits: ['rifle', 'atgm', 'spikeTeam'],
    signatureBuildings: ['garrisonBarracks'],
    research: ['manoeuvre1', 'fires1'],
    capabilityTags: ['fortification', 'anti-armour', 'air-defence'],
    doctrineTags: ['territorial', 'attrition'],
    strengths: ['extremely hard to knock out', 'best commander at holding a narrow front'],
    weaknesses: ['cannot exploit a win', 'loses to an opponent who takes the whole map'],
    counters: ['siege artillery', 'deep strike'],
    underuses: ['tank', 'fighter', 'navy'],
  }),
  commander({
    id: 'juhaniRautio',
    nationId: 'finland',
    name: 'Juhani Rautio',
    callsign: 'Kaukopartio',
    biography:
      'A pre-war artillery observer who believes the fight is decided at twelve tiles and has arranged his army accordingly.',
    primaryDoctrine: 'Stand-off killing',
    secondaryDoctrine: 'Observed fire',
    traits: ['exacting', 'patient', 'vain'],
    strategy: 'economy',
    aggression: 0.36,
    economy: 0.68,
    tech: 0.58,
    defence: 0.54,
    armyScale: 0.95,
    responseFactor: 1.1,
    commitFactor: 1.05,
    tempoFactor: 1,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { spg: 1.7, atgm: 1.4, recon: 1.3, tank: 0.5, spikeTeam: 1.2 },
    signatureUnits: ['k9Thunder', 'spikeTeam', 'spg', 'uav'],
    signatureBuildings: ['factory'],
    research: ['fires1', 'air1'],
    capabilityTags: ['artillery', 'anti-armour', 'reconnaissance'],
    doctrineTags: ['stand-off', 'observed-fire'],
    strengths: ['most efficient killer of armour in the coalition', 'punishes slow pushes'],
    weaknesses: ['blind without observers', 'fast light forces close inside the minimum range'],
    counters: ['recon suppression', 'air raids'],
    underuses: ['tank', 'attackHelo', 'navy'],
  }),
  commander({
    id: 'sannaLahti',
    nationId: 'finland',
    name: 'Sanna Lahti',
    callsign: 'Motti',
    biography:
      'A light-infantry officer who fights in packets and cuts roads, and considers a fair fight a planning error.',
    primaryDoctrine: 'Encirclement',
    secondaryDoctrine: 'Interdiction',
    traits: ['cunning', 'impatient', 'gregarious'],
    strategy: 'pressure',
    aggression: 0.74,
    economy: 0.4,
    tech: 0.4,
    defence: 0.3,
    armyScale: 0.9,
    responseFactor: 0.85,
    commitFactor: 0.8,
    tempoFactor: 0.85,
    reserve: 0,
    recall: false,
    protectEconomy: false,
    abilities: true,
    productionWeights: { apc: 1.6, rifle: 1.4, atgm: 1.2, tank: 0.4, spikeTeam: 1.3 },
    signatureUnits: ['apc', 'spikeTeam', 'rifle'],
    signatureBuildings: ['garrisonBarracks'],
    research: ['manoeuvre1', 'fires1'],
    capabilityTags: ['transport', 'anti-armour', 'reconnaissance'],
    doctrineTags: ['encirclement', 'interdiction'],
    strengths: ['punishes columns and greedy expansions', 'creates chaos cheaply'],
    weaknesses: ['cannot fight a set-piece battle', 'a concentrated opponent defeats the packets'],
    counters: ['bunker lines', 'massed infantry'],
    underuses: ['tank', 'artillery', 'fighter'],
  }),

  /* ------------------------------------------------------------------ */
  /* Sweden                                                             */
  /* ------------------------------------------------------------------ */
  commander({
    id: 'elinSjoberg',
    nationId: 'sweden',
    name: 'Elin Sjöberg',
    callsign: 'Rörlig',
    biography:
      'A mechanised brigade commander who thinks in terms of who arrives second and has never lost that race on purpose.',
    primaryDoctrine: 'Mobile combined arms',
    secondaryDoctrine: 'Tempo',
    traits: ['energetic', 'adaptable', 'impatient'],
    strategy: 'armour',
    aggression: 0.68,
    economy: 0.5,
    tech: 0.5,
    defence: 0.34,
    armyScale: 1.05,
    responseFactor: 1,
    commitFactor: 0.9,
    tempoFactor: 0.78,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { ifv: 1.8, apc: 1.4, rifle: 1.1, tank: 0.8, spg: 0.6 },
    signatureUnits: ['cv90', 'apc', 'ifv'],
    signatureBuildings: ['factory'],
    research: ['manoeuvre1', 'manoeuvre2'],
    capabilityTags: ['armour', 'transport', 'reconnaissance'],
    doctrineTags: ['tempo', 'mobile'],
    strengths: ['best tempo commander in the game', 'forces the opponent to react'],
    weaknesses: ['thin hulls and short magazines', 'a sustained fight goes badly'],
    counters: ['heavy armour', 'fortified lines'],
    underuses: ['fortification', 'artillery', 'navy'],
  }),
  commander({
    id: 'magnusAkesson',
    nationId: 'sweden',
    name: 'Magnus Åkesson',
    callsign: 'Skärgård',
    biography:
      'A coastal flotilla commander who believes the sea decides the flank and has been waiting for someone to notice.',
    primaryDoctrine: 'Littoral control',
    secondaryDoctrine: 'Flanking',
    traits: ['patient', 'contrarian', 'detail-obsessed'],
    strategy: 'air',
    aggression: 0.52,
    economy: 0.66,
    tech: 0.62,
    defence: 0.44,
    armyScale: 0.95,
    responseFactor: 1.05,
    commitFactor: 1,
    tempoFactor: 1,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { corvette: 1.6, missileBoat: 1.4, landingCraft: 1.3, transportHelo: 1.2, visby: 1.6 },
    signatureUnits: ['visby', 'missileBoat', 'landingCraft', 'submarine'],
    signatureBuildings: ['kockumsYard'],
    research: ['naval1', 'naval2', 'air1'],
    capabilityTags: ['naval', 'transport', 'air-defence'],
    doctrineTags: ['littoral', 'flanking'],
    strengths: ['can open a second front', 'strong on naval maps'],
    weaknesses: ['expensive and map-dependent', 'useless on landlocked maps'],
    counters: ['coastal defence', 'submarines'],
    underuses: ['tank', 'fortification'],
  }),
  commander({
    id: 'toveLindqvist',
    nationId: 'sweden',
    name: 'Tove Lindqvist',
    callsign: 'Syl',
    biography:
      'A fighter squadron commander who flies the strike herself in her own head and does not accept a wasted sortie.',
    primaryDoctrine: 'Air-mobile precision',
    secondaryDoctrine: 'Strike',
    traits: ['bold', 'exacting', 'proud'],
    strategy: 'air',
    aggression: 0.64,
    economy: 0.6,
    tech: 0.72,
    defence: 0.32,
    armyScale: 0.95,
    responseFactor: 1.1,
    commitFactor: 0.95,
    tempoFactor: 0.85,
    reserve: 0,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { fighter: 1.7, uav: 1.5, interceptor: 1.2, tank: 0.6, gripen: 1.7 },
    signatureUnits: ['gripen', 'uav', 'interceptor'],
    signatureBuildings: ['airfield'],
    research: ['air1', 'manoeuvre1'],
    capabilityTags: ['air-strike', 'reconnaissance', 'air-defence'],
    doctrineTags: ['air', 'precision'],
    strengths: ['can decapitate a static opponent', 'best use of the Gripen dual role'],
    weaknesses: ['five rounds and short fuel', 'a layered SAM net ends the campaign'],
    counters: ['long-range SAM', 'layered air defence'],
    underuses: ['tank', 'infantry', 'navy'],
  }),

  /* ------------------------------------------------------------------ */
  /* Russia                                                             */
  /* ------------------------------------------------------------------ */
  commander({
    id: 'viktorSokolov',
    nationId: 'russia',
    name: 'Viktor Sokolov',
    callsign: 'Molot',
    biography:
      'A siege artillery commander from the first campaign, convinced the war is won one building at a time.',
    primaryDoctrine: 'Siege fires',
    secondaryDoctrine: 'Position reduction',
    traits: ['methodical', 'relentless', 'unimaginative'],
    strategy: 'economy',
    aggression: 0.48,
    economy: 0.7,
    tech: 0.52,
    defence: 0.6,
    armyScale: 0.95,
    responseFactor: 1,
    commitFactor: 1.1,
    tempoFactor: 1.15,
    reserve: 2,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { spg: 1.9, rifle: 0.8, tank: 0.8, aa: 1.1 },
    signatureUnits: ['heavyHowitzer', 'spg'],
    signatureBuildings: ['longRangeSam'],
    research: ['fires1', 'fires2'],
    capabilityTags: ['artillery', 'indirect-fire', 'air-defence'],
    doctrineTags: ['siege', 'reduction'],
    strengths: ['best structure-killer in the game', 'grinds fortified maps down'],
    weaknesses: ['slow to react', 'a mobile opponent never sits in the beaten zone'],
    counters: ['tempo', 'deep strike'],
    underuses: ['tank', 'fighter', 'navy'],
  }),
  commander({
    id: 'irinaVolkova',
    nationId: 'russia',
    name: 'Irina Volkova',
    callsign: 'Ešelon',
    biography:
      'A deep-battle staff officer who plans in echelons and reserves, and considers a single attack a waste of a plan.',
    primaryDoctrine: 'Deep battle',
    secondaryDoctrine: 'Echeloned pressure',
    traits: ['calculating', 'patient', 'controlling'],
    strategy: 'pressure',
    aggression: 0.62,
    economy: 0.52,
    tech: 0.5,
    defence: 0.46,
    armyScale: 1.1,
    responseFactor: 1.05,
    commitFactor: 1.05,
    tempoFactor: 0.95,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { tank: 1.5, rifle: 1.3, spg: 1.2, aa: 1.1, tosp: 1.6 },
    signatureUnits: ['tosp', 'tank', 'rocketArtillery'],
    signatureBuildings: ['longRangeSam'],
    research: ['fires1', 'manoeuvre1'],
    capabilityTags: ['armour', 'artillery', 'rocket-artillery'],
    doctrineTags: ['echelon', 'deep-battle'],
    strengths: ['sustains pressure better than any other Russian commander', 'hard to stop with one defensive success'],
    weaknesses: ['needs a deep economy', 'early disruption hurts badly'],
    counters: ['early raiding', 'economic strangulation'],
    underuses: ['fortification', 'navy'],
  }),
  commander({
    id: 'sergeiMarkov',
    nationId: 'russia',
    name: 'Sergei Markov',
    callsign: 'Redut',
    biography:
      'A defensive specialist who believes the attack should break on the line and has arranged his army to make that happen.',
    primaryDoctrine: 'Fortified attrition',
    secondaryDoctrine: 'Counter-attack',
    traits: ['disciplined', 'conservative', 'stubborn'],
    strategy: 'infantry',
    aggression: 0.32,
    economy: 0.66,
    tech: 0.54,
    defence: 0.82,
    armyScale: 1.05,
    responseFactor: 1.2,
    commitFactor: 1.15,
    tempoFactor: 1.1,
    reserve: 2,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { td: 1.6, rifle: 1.3, spg: 1.1, tosp: 1.5 },
    buildWeights: { atTurret: 1.3 },
    signatureUnits: ['tosp', 'td'],
    signatureBuildings: ['longRangeSam', 'atTurret'],
    research: ['manoeuvre2', 'fires1'],
    capabilityTags: ['anti-armour', 'fortification', 'air-defence'],
    doctrineTags: ['defence', 'attrition'],
    strengths: ['very hard to break', 'best Russian commander against armoured pushes'],
    weaknesses: ['concedes tempo to an economic opponent', 'cannot chase a retreat'],
    counters: ['economic play', 'siege'],
    underuses: ['spg', 'fighter', 'navy'],
  }),

  /* ------------------------------------------------------------------ */
  /* Belarus                                                            */
  /* ------------------------------------------------------------------ */
  commander({
    id: 'andreiKazlou',
    nationId: 'belarus',
    name: 'Andrei Kazlou',
    callsign: 'Radar',
    biography:
      'A surveillance officer who ran the national listening service and treats a technology lead as a military objective.',
    primaryDoctrine: 'Deep surveillance',
    secondaryDoctrine: 'Technological edge',
    traits: ['analytical', 'patient', 'secretive'],
    strategy: 'economy',
    aggression: 0.48,
    economy: 0.72,
    tech: 0.76,
    defence: 0.48,
    armyScale: 0.9,
    responseFactor: 1.15,
    commitFactor: 1.1,
    tempoFactor: 1,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { uav: 1.8, recon: 1.4, tank: 0.8, aa: 1.2 },
    signatureUnits: ['deepReconUAV', 'recon'],
    signatureBuildings: ['signalsBureau'],
    research: ['air1', 'fires1'],
    capabilityTags: ['reconnaissance', 'unmanned', 'indirect-fire'],
    doctrineTags: ['surveillance', 'technology'],
    strengths: ['strongest information position in the game', 'a technology lead compounds'],
    weaknesses: ['the UAVs are unarmed', 'the bureau is fragile'],
    counters: ['deep strike', 'air campaign'],
    underuses: ['tank', 'fortification', 'navy'],
  }),
  commander({
    id: 'volhaMaroz',
    nationId: 'belarus',
    name: 'Volha Maroz',
    callsign: 'Roj',
    biography:
      'A reconnaissance troop commander who saturates a map with cheap eyes and strikes whatever they leave undefended.',
    primaryDoctrine: 'Reconnaissance saturation',
    secondaryDoctrine: 'Map control',
    traits: ['energetic', 'irreverent', 'opportunistic'],
    strategy: 'pressure',
    aggression: 0.76,
    economy: 0.38,
    tech: 0.42,
    defence: 0.26,
    armyScale: 0.88,
    responseFactor: 0.85,
    commitFactor: 0.8,
    tempoFactor: 0.8,
    reserve: 0,
    recall: false,
    protectEconomy: false,
    abilities: true,
    productionWeights: { recon: 1.9, apc: 1.3, rifle: 1.1, tank: 0.4, sprut: 1.5 },
    signatureUnits: ['sprut', 'recon', 'apc'],
    signatureBuildings: ['factory'],
    research: ['manoeuvre1', 'air1'],
    capabilityTags: ['reconnaissance', 'transport'],
    doctrineTags: ['saturation', 'map-control'],
    strengths: ['cheapest complete map picture', 'excellent at finding the undefended base'],
    weaknesses: ['no staying power', 'loses every set-piece fight'],
    counters: ['concentrated defence', 'fortification'],
    underuses: ['artillery', 'tank', 'navy'],
  }),
  commander({
    id: 'mikalaiBarys',
    nationId: 'belarus',
    name: 'Mikalai Barys',
    callsign: 'Maskirovka',
    biography:
      'A deception officer who treats every visible position as bait and every enemy plan as something to be read.',
    primaryDoctrine: 'Deception',
    secondaryDoctrine: 'Ambush defence',
    traits: ['cunning', 'patient', 'theatrical'],
    strategy: 'infantry',
    aggression: 0.36,
    economy: 0.54,
    tech: 0.56,
    defence: 0.72,
    armyScale: 0.95,
    responseFactor: 1.15,
    commitFactor: 1.1,
    tempoFactor: 1.05,
    reserve: 2,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { rifle: 1.5, atgm: 1.4, tank: 0.7, sprut: 1.4 },
    buildWeights: { mgNest: 1.3 },
    signatureUnits: ['rifle', 'atgm', 'sprut'],
    signatureBuildings: ['mgNest'],
    research: ['manoeuvre1', 'fires1'],
    capabilityTags: ['fortification', 'anti-armour', 'superweapon-ew'],
    doctrineTags: ['deception', 'ambush'],
    strengths: ['punishes predictable opponents', 'very efficient trades'],
    weaknesses: ['cannot hold open ground', 'a methodical attacker who clears systematically wins'],
    counters: ['systematic clearing', 'artillery'],
    underuses: ['tank', 'fighter', 'navy'],
  }),

  /* ------------------------------------------------------------------ */
  /* Hungary                                                            */
  /* ------------------------------------------------------------------ */
  commander({
    id: 'balintFarkas',
    nationId: 'hungary',
    name: 'Bálint Farkas',
    callsign: 'Sánc',
    biography:
      'A combat engineer who built the eastern line and still considers it unfinished.',
    primaryDoctrine: 'Fortified line',
    secondaryDoctrine: 'Positional defence',
    traits: ['methodical', 'stubborn', 'blunt'],
    strategy: 'infantry',
    aggression: 0.24,
    economy: 0.54,
    tech: 0.44,
    defence: 0.86,
    armyScale: 1,
    responseFactor: 1.15,
    commitFactor: 1.2,
    tempoFactor: 1.1,
    reserve: 2,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { rifle: 1.6, atgm: 1.4, tank: 0.4 },
    buildWeights: { mgNest: 1.8, bunker: 1.2 },
    signatureUnits: ['hedgehogTeam', 'rifle'],
    signatureBuildings: ['bunker', 'mgNest'],
    research: ['manoeuvre1', 'fires1'],
    capabilityTags: ['fortification', 'anti-armour'],
    doctrineTags: ['line', 'positional'],
    strengths: ['cheapest unbreakable line in the game', 'excellent on defensive maps'],
    weaknesses: ['cannot counter-attack far', 'siege artillery and deep strike beat it'],
    counters: ['siege artillery', 'deep strike'],
    underuses: ['tank', 'fighter', 'navy'],
  }),
  commander({
    id: 'zsofiaNemeth',
    nationId: 'hungary',
    name: 'Zsófia Németh',
    callsign: 'Akna',
    biography:
      'An indirect-fire officer who put tubes where nobody expects them and has been proved right twice.',
    primaryDoctrine: 'Indirect defence',
    secondaryDoctrine: 'Fire from cover',
    traits: ['patient', 'inventive', 'detached'],
    strategy: 'infantry',
    aggression: 0.5,
    economy: 0.56,
    tech: 0.58,
    defence: 0.62,
    armyScale: 0.95,
    responseFactor: 1.05,
    commitFactor: 1,
    tempoFactor: 1,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { rifle: 1.4, atgm: 1.3, spg: 0.9, tank: 0.6, taszar: 1.6 },
    signatureUnits: ['taszar', 'hedgehogTeam'],
    signatureBuildings: ['bunker'],
    research: ['fires1', 'manoeuvre1'],
    capabilityTags: ['indirect-fire', 'fortification', 'anti-armour'],
    doctrineTags: ['indirect-defence', 'urban'],
    strengths: ['only commander who brings indirect fire into a building', 'very strong in urban fights'],
    weaknesses: ['short range', 'no answer to armour at distance'],
    counters: ['fast armour', 'counter-battery'],
    underuses: ['tank', 'fighter', 'navy'],
  }),
  commander({
    id: 'gergelyToth',
    nationId: 'hungary',
    name: 'Gergely Tóth',
    callsign: 'Tartalék',
    biography:
      'A reserve officer who keeps his best unit uncommitted and considers that the whole point of a reserve.',
    primaryDoctrine: 'Defence in depth',
    secondaryDoctrine: 'Mobile counter-attack',
    traits: ['patient', 'flexible', 'calculating'],
    strategy: 'armour',
    aggression: 0.52,
    economy: 0.6,
    tech: 0.5,
    defence: 0.66,
    armyScale: 1.05,
    responseFactor: 1.1,
    commitFactor: 1,
    tempoFactor: 1,
    reserve: 3,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { tank: 1.4, atgm: 1.2, rifle: 1.1 },
    buildWeights: { bunker: 1.2 },
    signatureUnits: ['tank', 'hedgehogTeam'],
    signatureBuildings: ['bunker'],
    research: ['manoeuvre1', 'manoeuvre2'],
    capabilityTags: ['armour', 'fortification', 'anti-armour'],
    doctrineTags: ['depth', 'counter-attack'],
    strengths: ['punishes overextension better than any other Hungarian commander'],
    weaknesses: ['a patient attacker beats him on economy'],
    counters: ['economic play', 'siege'],
    underuses: ['spg', 'fighter'],
  }),

  /* ------------------------------------------------------------------ */
  /* Iran                                                               */
  /* ------------------------------------------------------------------ */
  commander({
    id: 'rezaFarhadi',
    nationId: 'iran',
    name: 'Reza Farhadi',
    callsign: 'Saya',
    biography:
      'A drone unit commander who came up through signals intelligence and prefers to remove a position without ever committing a soldier.',
    primaryDoctrine: 'Unmanned strike',
    secondaryDoctrine: 'Persistent observation',
    traits: ['patient', 'curious', 'unassuming'],
    strategy: 'air',
    aggression: 0.54,
    economy: 0.66,
    tech: 0.7,
    defence: 0.4,
    armyScale: 0.9,
    responseFactor: 1.1,
    commitFactor: 1.05,
    tempoFactor: 1,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { uav: 1.9, fighter: 1.2, rifle: 0.8, tank: 0.5, mohajer6: 1.6 },
    signatureUnits: ['mohajer6', 'uav', 'khordadSam'],
    signatureBuildings: ['airfield'],
    research: ['air1', 'manoeuvre1'],
    capabilityTags: ['unmanned', 'air-strike', 'air-defence'],
    doctrineTags: ['drone', 'observation'],
    strengths: ['cheapest way to remove static defences', 'superb against turtling opponents'],
    weaknesses: ['four bombs and a thin airframe', 'layered SAM coverage ends it'],
    counters: ['long-range SAM', 'concentrated AA'],
    underuses: ['tank', 'infantry', 'navy'],
  }),
  commander({
    id: 'leilaSadeghi',
    nationId: 'iran',
    name: 'Leila Sadeghi',
    callsign: 'Ghadir',
    biography:
      'A coastal flotilla officer who trained for one ambush her whole career and intends to get it right.',
    primaryDoctrine: 'Coastal ambush',
    secondaryDoctrine: 'Sea denial',
    traits: ['bold', 'calculating', 'proud'],
    strategy: 'air',
    aggression: 0.56,
    economy: 0.64,
    tech: 0.6,
    defence: 0.5,
    armyScale: 0.9,
    responseFactor: 1.05,
    commitFactor: 1,
    tempoFactor: 1,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { submarine: 1.7, missileBoat: 1.4, rifle: 0.8, ghadir: 1.5 },
    buildWeights: { coastalBattery: 1.5, shipyard: 1.2 },
    signatureUnits: ['ghadir', 'missileBoat', 'khordadSam'],
    signatureBuildings: ['noorBattery', 'shipyard'],
    research: ['naval1', 'naval2'],
    capabilityTags: ['naval', 'air-defence'],
    doctrineTags: ['coastal', 'ambush'],
    strengths: ['dominant on naval maps', 'best trade economy in the game'],
    weaknesses: ['irrelevant inland', 'the submarine is unforgiving'],
    counters: ['ASW screens', 'fast corvettes'],
    underuses: ['armour', 'infantry', 'fighter'],
  }),
  commander({
    id: 'omidRahimi',
    nationId: 'iran',
    name: 'Omid Rahimi',
    callsign: 'Tufan',
    biography:
      'An air-defence officer who believes the sky is the decisive flank and has over-prepared for it.',
    primaryDoctrine: 'Area denial',
    secondaryDoctrine: 'Air and coastal screens',
    traits: ['vigilant', 'reactive', 'perfectionist'],
    strategy: 'infantry',
    aggression: 0.3,
    economy: 0.58,
    tech: 0.62,
    defence: 0.8,
    armyScale: 0.95,
    responseFactor: 1.2,
    commitFactor: 1.15,
    tempoFactor: 1.1,
    reserve: 2,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { aa: 1.7, rifle: 1.2, tank: 0.6 },
    buildWeights: { coastalBattery: 1.4, samBattery: 1.3 },
    signatureUnits: ['khordadSam', 'aa', 'missileBoat'],
    signatureBuildings: ['noorBattery', 'samBattery'],
    research: ['air1', 'naval1'],
    capabilityTags: ['air-defence', 'naval', 'fortification'],
    doctrineTags: ['denial', 'screens'],
    strengths: ['strongest counter to air- and naval-heavy commanders'],
    weaknesses: ['spends the match reacting', 'a pure ground push beats him'],
    counters: ['mass armour', 'siege'],
    underuses: ['tank', 'uav', 'artillery'],
  }),

  /* ------------------------------------------------------------------ */
  /* North Korea                                                        */
  /* ------------------------------------------------------------------ */
  commander({
    id: 'hanCholsu',
    nationId: 'northKorea',
    name: 'Han Chol-su',
    callsign: 'Koksan',
    biography:
      'A corps artillery commander who has never fought a mobile battle and does not intend to start.',
    primaryDoctrine: 'Siege fires',
    secondaryDoctrine: 'Counter-battery',
    traits: ['forceful', 'direct', 'inflexible'],
    strategy: 'economy',
    aggression: 0.5,
    economy: 0.68,
    tech: 0.5,
    defence: 0.64,
    armyScale: 1,
    responseFactor: 1,
    commitFactor: 1.15,
    tempoFactor: 1.2,
    reserve: 2,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { spg: 2, rifle: 0.8, tank: 0.6, koksan: 1.7 },
    buildWeights: { atTurret: 1.1 },
    signatureUnits: ['koksan', 'spg'],
    signatureBuildings: ['factory', 'atTurret'],
    research: ['fires1', 'fires2'],
    capabilityTags: ['artillery', 'indirect-fire', 'fortification'],
    doctrineTags: ['siege', 'counter-battery'],
    strengths: ['longest reach in the game', 'wins artillery duels outright'],
    weaknesses: ['immobile and blind', 'a fast push reaches the battery'],
    counters: ['tempo', 'deep strike'],
    underuses: ['tank', 'fighter', 'navy'],
  }),
  commander({
    id: 'riSolmi',
    nationId: 'northKorea',
    name: 'Ri Sol-mi',
    callsign: 'Yŏksa',
    biography:
      'A fortification engineer who treats every hill as a permanent position and every withdrawal as a defeat.',
    primaryDoctrine: 'Entrenched defence',
    secondaryDoctrine: 'Anti-armour strongpoints',
    traits: ['disciplined', 'patient', 'severe'],
    strategy: 'infantry',
    aggression: 0.22,
    economy: 0.54,
    tech: 0.44,
    defence: 0.88,
    armyScale: 1,
    responseFactor: 1.2,
    commitFactor: 1.25,
    tempoFactor: 1.15,
    reserve: 2,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { atgm: 1.4, rifle: 1.5, tank: 0.4 },
    buildWeights: { atTurret: 1.7, entrenchedAtGun: 1.4 },
    signatureUnits: ['bulsae4', 'atgm'],
    signatureBuildings: ['entrenchedAtGun', 'atTurret'],
    research: ['manoeuvre2', 'fires1'],
    capabilityTags: ['anti-armour', 'fortification'],
    doctrineTags: ['strongpoint', 'defence'],
    strengths: ['toughest anti-armour line in the game'],
    weaknesses: ['no reach beyond the position', 'siege artillery beats fortifications'],
    counters: ['siege artillery', 'deep strike'],
    underuses: ['tank', 'fighter', 'navy'],
  }),
  commander({
    id: 'kangDaesung',
    nationId: 'northKorea',
    name: 'Kang Dae-sung',
    callsign: "Ch'ong",
    biography:
      'A missile-carrier commander who fights in ambushes from fourteen tiles and leaves before the answer arrives.',
    primaryDoctrine: 'Stand-off ambush',
    secondaryDoctrine: 'Anti-armour manoeuvre',
    traits: ['cunning', 'impatient', 'daring'],
    strategy: 'armour',
    aggression: 0.68,
    economy: 0.5,
    tech: 0.5,
    defence: 0.4,
    armyScale: 0.95,
    responseFactor: 0.95,
    commitFactor: 0.9,
    tempoFactor: 0.9,
    reserve: 1,
    recall: true,
    protectEconomy: true,
    abilities: true,
    productionWeights: { td: 1.8, recon: 1.2, apc: 1.1, rifle: 0.8 },
    signatureUnits: ['bulsae4', 'recon', 'apc'],
    signatureBuildings: ['factory'],
    research: ['manoeuvre1', 'fires1'],
    capabilityTags: ['anti-armour', 'reconnaissance', 'transport'],
    doctrineTags: ['stand-off', 'ambush'],
    strengths: ['best armour-killer per material in the game', 'punishes tank-heavy commanders'],
    weaknesses: ['cannot fight infantry', 'eight rounds then a long drive home'],
    counters: ['infantry swarms', 'air strike'],
    underuses: ['spg', 'infantry', 'navy'],
  }),
]);

/* -------------------------------------------------------------------------- */
/* Registry and resolution                                                     */
/* -------------------------------------------------------------------------- */

const BY_ID: Readonly<Record<string, CommanderProfile>> = Object.freeze(
  Object.fromEntries(COMMANDERS.map((entry) => [entry.id, entry])),
);

/** Every commander for one nation, in catalogue order. */
export function commandersForNation(nationId: string): readonly CommanderProfile[] {
  return COMMANDERS.filter((entry) => entry.nationId === nationId);
}

/** A commander by id, or undefined for an unknown id (never throws). */
export function commanderById(id: string): CommanderProfile | undefined {
  return Object.hasOwn(BY_ID, id) ? BY_ID[id] : undefined;
}

const neutralTargetBias = (): Record<CommanderTargetCategory, number> => {
  const bias = {} as Record<CommanderTargetCategory, number>;
  for (const category of COMMANDER_TARGET_CATEGORIES) bias[category] = 1;
  return bias;
};

const clampBias = (value: number): number => Math.max(0.75, Math.min(1.4, value));
const clampMargin = (value: number): number => Math.max(0.85, Math.min(1.3, value));

/**
 * Derive the tactical reading from authored identity.
 *
 * The rules are evaluative, not prescriptive: a field or tag moves a category
 * a little, and the clamp keeps every commander able to engage anything. This
 * is why two commanders of one nation differ tactically without needing
 * different target lists, and why a commander whose doctrine names a capability
 * it cannot field still behaves sensibly.
 */
function deriveTactical(entry: CommanderProfile): TacticalProfile {
  const bias = neutralTargetBias();
  const tags = new Set(entry.capabilityTags);
  // Risk tolerance: a pressing commander values field targets and the enemy's
  // means of production; a careful one values the position it must break.
  bias.combat += (entry.aggression - 0.5) * 0.3;
  bias.production += (entry.aggression - 0.5) * 0.2;
  bias.defence += (entry.defence - 0.5) * 0.28;
  bias.economy += (entry.economy - 0.5) * 0.34;
  if (tags.has('artillery') || tags.has('indirect-fire') || tags.has('rocket-artillery')) {
    // Fire support wants the enemy's guns and the positions that shelter them.
    bias.fireSupport += 0.18;
    bias.defence += 0.12;
    bias.combat -= 0.06;
  }
  if (tags.has('reconnaissance') || tags.has('unmanned')) {
    bias.recon += 0.24;
    bias.support += 0.1;
  }
  if (tags.has('air-strike')) bias.air += 0.2;
  if (tags.has('air-defence')) bias.airDefence += 0.24;
  if (tags.has('anti-armour') || tags.has('armour')) bias.combat += 0.12;
  if (tags.has('fortification')) bias.defence += 0.14;
  if (tags.has('naval')) bias.naval += 0.26;
  if (tags.has('transport') || tags.has('logistics')) bias.support += 0.12;
  if (tags.has('superweapon-saturation')) bias.defence += 0.1;
  if (tags.has('superweapon-ew')) bias.airDefence += 0.12;
  // The command post ends a match; no doctrine discounts it.
  bias.command = 1;
  for (const category of COMMANDER_TARGET_CATEGORIES) bias[category] = clampBias(bias[category]);
  return Object.freeze({
    targetBias: Object.freeze(bias),
    threatRadius: clampMargin(
      1 + (entry.defence - 0.5) * 0.5 + (entry.protectEconomy ? 0.05 : 0),
    ),
    recallMargin: clampMargin(
      1 + (entry.defence - 0.5) * 0.4 - (entry.aggression - 0.5) * 0.3,
    ),
  });
}

/** The neutral profile a seeded (commander-less) AI uses. */
export const NEUTRAL_TACTICAL: TacticalProfile = Object.freeze({
  targetBias: Object.freeze(neutralTargetBias()),
  threatRadius: 1,
  recallMargin: 1,
});

const tacticalCache = new Map<string, TacticalProfile>();

/**
 * Cached tactical profile for a commander id, or undefined when there is no
 * authored commander. Derived once per id: the planner calls this every think
 * and must not rebuild a record per call.
 */
export function tacticalProfileFor(
  commanderId: string | null | undefined,
): TacticalProfile | undefined {
  if (!commanderId) return undefined;
  const cached = tacticalCache.get(commanderId);
  if (cached) return cached;
  const entry = commanderById(commanderId);
  if (!entry) return undefined;
  const derived = deriveTactical(entry);
  tacticalCache.set(commanderId, derived);
  return derived;
}

/**
 * Resolve an authored commander for a nation. Returns undefined when the id is
 * unknown or belongs to another nation: an assignment is never silently
 * reinterpreted, so callers fall back to the seeded legacy profile instead.
 */
export function resolveCommander(
  nationId: string | undefined,
  commanderId: string | null | undefined,
): CommanderProfile | undefined {
  if (!commanderId) return undefined;
  const found = commanderById(commanderId);
  if (!found) return undefined;
  if (nationId && found.nationId !== nationId) return undefined;
  return found;
}

/**
 * Configuration issues for an explicit assignment. Empty when the id is absent
 * (legacy behaviour), unknown, or wrong-nation: absence is legal, and the other
 * two degrade to the seeded profile rather than crashing a save.
 */
export function commanderAssignmentIssues(
  nationId: string | undefined,
  commanderId: string | null | undefined,
): string[] {
  if (!commanderId) return [];
  const found = commanderById(commanderId);
  if (!found) return [`Unknown commander id "${commanderId}"`];
  if (nationId && found.nationId !== nationId) {
    return [`Commander "${commanderId}" belongs to ${found.nationId}, not ${nationId}`];
  }
  return [];
}

const scalarIn = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max;

/**
 * Validate the shipped catalogue against the shipped data. Throws on the first
 * group of problems, naming the commander and the field, so a bad edit fails a
 * test rather than a match. Exported because the tests assert on it directly.
 */
export function validateCommanderCatalog(): void {
  const problems: string[] = [];
  const fail = (where: string, message: string): void => {
    problems.push(`${where}: ${message}`);
  };

  if (COMMANDERS.length !== 30) fail('catalogue', `expected 30 commanders, found ${COMMANDERS.length}`);

  const seen = new Set<string>();
  const perNation = new Map<string, number>();
  for (const entry of COMMANDERS) {
    const where = `commander "${entry.id}"`;
    if (seen.has(entry.id)) fail(where, 'duplicate id');
    seen.add(entry.id);
    if (!/^[a-z][A-Za-z0-9]*$/.test(entry.id)) fail(where, 'id must be lowerCamelCase');
    if (!Object.hasOwn(NATIONS, entry.nationId)) fail(where, `unknown nation "${entry.nationId}"`);
    perNation.set(entry.nationId, (perNation.get(entry.nationId) ?? 0) + 1);

    if (!entry.name || !entry.callsign) fail(where, 'name and callsign are required');
    if (!entry.biography.trim()) fail(where, 'biography is required');
    if (!entry.primaryDoctrine || !entry.secondaryDoctrine) fail(where, 'both doctrines are required');
    if (entry.primaryDoctrine === entry.secondaryDoctrine) fail(where, 'doctrines must differ');
    if (entry.traits.length === 0) fail(where, 'at least one trait is required');
    if (entry.strengths.length === 0 || entry.weaknesses.length === 0) {
      fail(where, 'strengths and weaknesses are required');
    }

    if (!COMMANDER_STRATEGIES.includes(entry.strategy)) fail(where, `unknown strategy "${entry.strategy}"`);
    if (!scalarIn(entry.aggression, 0.05, 0.95)) fail(where, 'aggression out of range');
    if (!scalarIn(entry.economy, 0.05, 0.95)) fail(where, 'economy out of range');
    if (!scalarIn(entry.tech, 0.05, 0.95)) fail(where, 'tech out of range');
    if (!scalarIn(entry.defence, 0.05, 0.95)) fail(where, 'defence out of range');
    if (!scalarIn(entry.armyScale, 0.5, 1.25)) fail(where, 'armyScale out of range');
    if (!scalarIn(entry.responseFactor, 0.7, 1.25)) fail(where, 'responseFactor out of range');
    if (!scalarIn(entry.commitFactor, 0.7, 1.25)) fail(where, 'commitFactor out of range');
    if (!scalarIn(entry.tempoFactor, 0.7, 1.3)) fail(where, 'tempoFactor out of range');
    if (!Number.isInteger(entry.reserve) || entry.reserve < 0 || entry.reserve > 4) {
      fail(where, 'reserve must be an integer 0..4');
    }

    // Equipment must resolve through this nation's roster, not the shared list.
    const roster = resolveRoster(entry.nationId);
    for (const ref of entry.signatureUnits) {
      if (!unitSlotId(roster, ref)) fail(where, `signature unit "${ref}" is not fielded by ${entry.nationId}`);
    }
    for (const ref of entry.signatureBuildings) {
      if (!buildingSlotId(roster, ref)) fail(where, `signature building "${ref}" is not buildable by ${entry.nationId}`);
    }
    for (const tech of entry.research) {
      if (!Object.hasOwn(TECHS, tech)) fail(where, `unknown research "${tech}"`);
    }
    for (const slot of Object.keys(entry.productionWeights)) {
      const weight = entry.productionWeights[slot];
      if (!Number.isFinite(weight) || weight < 0) fail(where, `weight for "${slot}" is not a finite non-negative number`);
      // A national exclusive declares no canonical slot, so its own id is the
      // key it is weighted by. Roster membership is what keeps a commander from
      // weighting equipment its nation cannot field.
      if (!unitSlotId(roster, slot) && !roster.units.includes(slot)) {
        fail(where, `production slot "${slot}" is not fielded by ${entry.nationId}`);
      }
    }
    for (const [slot, weight] of Object.entries(entry.buildWeights ?? {})) {
      if (!Number.isFinite(weight) || weight < 0) fail(where, `build weight for "${slot}" is not finite and non-negative`);
      if (!buildingSlotId(roster, slot)) fail(where, `build slot "${slot}" is not buildable by ${entry.nationId}`);
    }
    const tactical = tacticalProfileFor(entry.id);
    if (!tactical) {
      fail(where, 'tactical profile did not resolve');
    } else {
      for (const category of COMMANDER_TARGET_CATEGORIES) {
        const value = tactical.targetBias[category];
        if (!scalarIn(value, 0.75, 1.4)) {
          fail(where, `target bias "${category}" is outside 0.75–1.4`);
        }
      }
      if (!scalarIn(tactical.threatRadius, 0.85, 1.3)) {
        fail(where, 'threat radius is outside 0.85–1.3');
      }
      if (!scalarIn(tactical.recallMargin, 0.85, 1.3)) {
        fail(where, 'recall margin is outside 0.85–1.3');
      }
    }
    for (const tag of entry.capabilityTags) {
      const source = CAPABILITY_SOURCES[tag];
      if (!source) {
        fail(where, `unknown capability tag "${tag}"`);
        continue;
      }
      if (source.tech && !Object.hasOwn(TECHS, source.tech)) fail(where, `capability "${tag}" names missing tech`);
      if (source.slots && !source.slots.some((slot) => unitSlotId(roster, slot) || buildingSlotId(roster, slot))) {
        fail(where, `capability "${tag}" has no fielded source`);
      }
    }
    if (entry.doctrineTags.length === 0) fail(where, 'at least one doctrine tag is required');
    if (entry.underuses.length === 0) fail(where, 'underused equipment must be stated');
  }

  for (const nationId of Object.keys(NATIONS)) {
    if ((perNation.get(nationId) ?? 0) !== 3) {
      fail(`nation "${nationId}"`, `expected 3 commanders, found ${perNation.get(nationId) ?? 0}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Commander catalogue is invalid:\n  ${problems.join('\n  ')}`);
  }
}
