import { createIslandAssault } from './scenarios';
import { createFoundryDistrict, createKestrelStraits, createRustValley } from './maps';
import {
  createBlackwaterFens,
  createContactZone,
  createCrossingPoint,
  createDrylands,
  createHedgerowVale,
  createHighGround,
  createIronworks,
  createLittoral,
  createOpenFront,
  createThornScrub,
  createWoodlandDivide,
  rotatePoint,
} from './competitiveMaps';
import {
  createAshcrossSprawl,
  createFreightYards,
  createGraniteSteps,
  createSaffronErg,
  createSiltDelta,
} from './expansionMaps';
import { createCormorantIsle } from './islandMap';
import type { Scenario, ScenarioSlot } from '../sim/scenario';

/**
 * The single scenario catalogue.
 *
 * One entry per battlefield, with the modes it is authored for. Menus, the
 * skirmish deck and the multiplayer lobby all read this catalogue, so map
 * availability is metadata here rather than a list repeated in each screen.
 * Nothing else may define a "playable map" set.
 */

export type GameMode = 'campaign' | 'skirmish' | 'multiplayer';

export const GAME_MODES: readonly GameMode[] = ['campaign', 'skirmish', 'multiplayer'];

export interface ScenarioEntry {
  /** Stable identifier: the only thing a save, a lobby or a URL may carry. */
  id: string;
  name: string;
  description: string;
  /** One-word theatre tag shown on the skirmish card. */
  focus: string;
  /** Strategic focus, shown as tags under the brief. */
  tags: readonly string[];
  /** Domains the battlefield actually supports, for the briefing. */
  domains: string;
  targetSize: 'small' | 'medium' | 'large';
  /** Authored footprint, available without generating the tiles. */
  width: number;
  height: number;
  /** Player counts the ground is authored for. */
  playerCounts: readonly number[];
  /** Modes this battlefield is available in. */
  modes: readonly GameMode[];
  /**
   * First-quadrant start tile on a four-way map. The other three slots are
   * pure rotations of it, so 1v1 can pick the opposite pair from metadata
   * alone without generating the map.
   */
  start?: readonly [number, number];
  create: () => Scenario;
}

const CAMPAIGN_ONLY: readonly GameMode[] = ['campaign'];
const COMPETITIVE: readonly GameMode[] = ['skirmish', 'multiplayer'];

/**
 * The four original theatres are reserved for the campaign. Their layouts,
 * names and starting forces are unchanged; they are simply no longer offered
 * as skirmish or multiplayer ground.
 */
const CAMPAIGN_SCENARIOS: ScenarioEntry[] = [
  {
    id: 'island-assault',
    name: 'Island Assault — Kestrel Bay',
    description: 'The vertical-slice island battle: beachhead, ridge, bay and enemy base.',
    focus: 'Combined',
    tags: ['campaign', 'beachhead', 'combined-arms'],
    domains: 'Ground · Air · Naval',
    targetSize: 'medium',
    width: 96,
    height: 72,
    playerCounts: [2],
    modes: CAMPAIGN_ONLY,
    create: createIslandAssault,
  },
  {
    id: 'rust-valley',
    name: 'Rust Valley',
    description: 'Landlocked armour country split by a central massif and two wide passes.',
    focus: 'Armour',
    tags: ['campaign', 'armour', 'passes'],
    domains: 'Ground · Air',
    targetSize: 'medium',
    width: 112,
    height: 80,
    playerCounts: [2],
    modes: CAMPAIGN_ONLY,
    create: createRustValley,
  },
  {
    id: 'kestrel-straits',
    name: 'Kestrel Straits',
    description: 'Two coasts across a deep strait, with two contested islands between them.',
    focus: 'Naval',
    tags: ['campaign', 'naval', 'strait'],
    domains: 'Ground · Air · Naval',
    targetSize: 'small',
    width: 88,
    height: 64,
    playerCounts: [2],
    modes: CAMPAIGN_ONLY,
    create: createKestrelStraits,
  },
  {
    id: 'foundry-district',
    name: 'Foundry District',
    description:
      'Two field bases on the open outskirts, facing off across a dense city core of warehouses, offices and tenements.',
    focus: 'Urban',
    tags: ['campaign', 'urban', 'city'],
    domains: 'Ground · Air',
    targetSize: 'medium',
    width: 104,
    height: 76,
    playerCounts: [2],
    modes: CAMPAIGN_ONLY,
    create: createFoundryDistrict,
  },
];

/**
 * The competitive roster: seventeen four-way battlefields, available to
 * skirmish and multiplayer and invisible to the campaign until a mission names
 * one.
 *
 * Eight are the original roster, reworked with the expanded terrain catalogue;
 * eight are new grounds built for the new terrain types; the seventeenth is the
 * island, whose ring of water makes naval play a real option rather than
 * scenery. Every one is square, four-way rotationally symmetric, declares four
 * start slots and is audited by `auditCompetitiveMap` in the test suite.
 */
const COMPETITIVE_SCENARIOS: ScenarioEntry[] = [
  {
    id: 'open-front',
    name: 'Open Front',
    description:
      'Temperate countryside: open rolling ground, cultivated fields and hedgerow banks around two low ridges. The reference competitive map.',
    focus: 'Combined',
    tags: ['balanced', 'farmland', 'objectives'],
    domains: 'Ground · Air',
    targetSize: 'medium',
    width: 84,
    height: 84,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [14, 14],
    create: createOpenFront,
  },
  {
    id: 'woodland-divide',
    name: 'Woodland Divide',
    description:
      'Overlapping woodland and scrub split the quadrants into clearings, churned tracks and ambush lines.',
    focus: 'Woodland',
    tags: ['concealment', 'ambush', 'scrub'],
    domains: 'Ground · Air',
    targetSize: 'medium',
    width: 88,
    height: 88,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [13, 13],
    create: createWoodlandDivide,
  },
  {
    id: 'drylands',
    name: 'Drylands',
    description:
      'Large sand basins split by long ridges, dune seas either side of the lanes, and the richest ore out in the open.',
    focus: 'Armour',
    tags: ['manoeuvre', 'long-range', 'dunes'],
    domains: 'Ground · Air',
    targetSize: 'large',
    width: 112,
    height: 112,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [16, 16],
    create: createDrylands,
  },
  {
    id: 'ironworks',
    name: 'Ironworks',
    description:
      'An industrial district of concrete yards, warehouses, rubble and tenement blocks over streets built for vehicles.',
    focus: 'Forge',
    tags: ['industrial', 'urban', 'close-quarters'],
    domains: 'Ground · Air',
    targetSize: 'medium',
    width: 80,
    height: 80,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [13, 13],
    create: createIronworks,
  },
  {
    id: 'crossing-point',
    name: 'Crossing Point',
    description:
      'A river diamond closes the centre; every side has one bridge and one ford, and reed marsh lines the inner bank.',
    focus: 'River',
    tags: ['chokepoints', 'crossings', 'marsh'],
    domains: 'Ground · Air',
    targetSize: 'medium',
    width: 96,
    height: 96,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [16, 16],
    create: createCrossingPoint,
  },
  {
    id: 'high-ground',
    name: 'High Ground',
    description:
      'A terraced massif over the centre, ringed by forest, rocky scree and cultivated lowland, with ramps shared by both sides.',
    focus: 'Elevation',
    tags: ['artillery', 'height', 'rocky'],
    domains: 'Ground · Air',
    targetSize: 'large',
    width: 104,
    height: 104,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [16, 16],
    create: createHighGround,
  },
  {
    id: 'littoral',
    name: 'Littoral',
    description:
      'Coastal plains with a sheltered sea in each outer corner, dune belts and salt marsh behind the beaches.',
    focus: 'Coastal',
    tags: ['coast', 'dunes', 'flanking'],
    domains: 'Ground · Air · Naval',
    targetSize: 'large',
    width: 120,
    height: 120,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [42, 18],
    create: createLittoral,
  },
  {
    id: 'contact-zone',
    name: 'Contact Zone',
    description:
      'A compact city core of dense blocks and industrial yards with short approaches and three ways round the centre relay.',
    focus: 'Assault',
    tags: ['fast', 'small', 'urban'],
    domains: 'Ground · Air',
    targetSize: 'small',
    width: 64,
    height: 64,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [16, 16],
    create: createContactZone,
  },
  {
    id: 'blackwater-fens',
    name: 'Blackwater Fens',
    description:
      'Reed beds and shallow channels split every approach. Vehicles can cross the fen, but they pay for it; infantry that uses the reeds arrives unseen.',
    focus: 'Wetland',
    tags: ['marsh', 'reeds', 'concealment'],
    domains: 'Ground · Air',
    targetSize: 'small',
    width: 72,
    height: 72,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [12, 12],
    create: createBlackwaterFens,
  },
  {
    id: 'hedgerow-vale',
    name: 'Hedgerow Vale',
    description:
      'Cultivated fields divided by hedgerows: every bank breaks a sight line and gives cover, and armour is funnelled along the lanes between them.',
    focus: 'Bocage',
    tags: ['farmland', 'hedgerows', 'infantry'],
    domains: 'Ground · Air',
    targetSize: 'medium',
    width: 100,
    height: 100,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [14, 14],
    create: createHedgerowVale,
  },
  {
    id: 'thorn-scrub',
    name: 'Thorn Scrub',
    description:
      'Close, brush-covered ground where almost every tile hides infantry and no sight line runs far. Ambushes are cheap and scouting is hard.',
    focus: 'Scrub',
    tags: ['brush', 'ambush', 'small'],
    domains: 'Ground · Air',
    targetSize: 'small',
    width: 76,
    height: 76,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [12, 12],
    create: createThornScrub,
  },
  {
    id: 'granite-steps',
    name: 'Granite Steps',
    description:
      'Granite ridges cut the ground into three terraces. Worn rock punishes wheels in the passes, and the upper step sees and shells the ones below.',
    focus: 'Uplands',
    tags: ['rocky', 'passes', 'tracks'],
    domains: 'Ground · Air',
    targetSize: 'large',
    width: 108,
    height: 108,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [16, 16],
    create: createGraniteSteps,
  },
  {
    id: 'saffron-erg',
    name: 'Saffron Erg',
    description:
      'One of the widest battlefields in the pool: dune crests for observation, wide sand basins for manoeuvre, and room for reconnaissance to decide a battle.',
    focus: 'Desert',
    tags: ['dunes', 'open', 'reconnaissance'],
    domains: 'Ground · Air',
    targetSize: 'large',
    width: 128,
    height: 128,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [18, 18],
    create: createSaffronErg,
  },
  {
    id: 'ashcross-sprawl',
    name: 'Ashcross Sprawl',
    description:
      'A dense city grid. Infantry holds the blocks, the streets are the only armour routes, and every intersection is a fight.',
    focus: 'City',
    tags: ['dense-urban', 'streets', 'garrison'],
    domains: 'Ground · Air',
    targetSize: 'medium',
    width: 92,
    height: 92,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [14, 14],
    create: createAshcrossSprawl,
  },
  {
    id: 'freight-yards',
    name: 'Freight Yards',
    description:
      'Concrete rail yards and hardstanding: the fastest ground in the pool, with freight buildings for cover and yards open to forward expansion.',
    focus: 'Industry',
    tags: ['hardstanding', 'mobility', 'expansion'],
    domains: 'Ground · Air',
    targetSize: 'large',
    width: 116,
    height: 116,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [16, 16],
    create: createFreightYards,
  },
  {
    id: 'silt-delta',
    name: 'Silt Delta',
    description:
      'Braided shallow channels between silt islands and reed banks. Every crossing is wadeable — and every crossing is slow, exposed and easy to ambush.',
    focus: 'Delta',
    tags: ['channels', 'crossings', 'reeds'],
    domains: 'Ground · Air',
    targetSize: 'large',
    width: 136,
    height: 136,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [18, 18],
    create: createSiltDelta,
  },
  {
    id: 'cormorant-isle',
    name: 'Cormorant Isle',
    description:
      'One island in open water: a level beach ring for harbours, four deep bays that let hulls reach inland, and a rocky centre the land routes must cross.',
    focus: 'Island',
    tags: ['island', 'coast', 'naval'],
    domains: 'Ground · Air · Naval',
    targetSize: 'large',
    width: 132,
    height: 132,
    playerCounts: [2, 4],
    modes: COMPETITIVE,
    start: [40, 40],
    create: createCormorantIsle,
  },
];

/** Every authored battlefield, campaign first, then the competitive roster. */
export const SCENARIOS: readonly ScenarioEntry[] = [...CAMPAIGN_SCENARIOS, ...COMPETITIVE_SCENARIOS];

export const CAMPAIGN_SCENARIO_IDS: readonly string[] = CAMPAIGN_SCENARIOS.map((entry) => entry.id);
export const COMPETITIVE_SCENARIO_IDS: readonly string[] = COMPETITIVE_SCENARIOS.map((entry) => entry.id);

/**
 * The map a mode falls back to. A skirmish defaults to the reference
 * competitive map; the lobby defaults to the same one so a fresh room is
 * always legal.
 */
export const DEFAULT_MULTIPLAYER_SCENARIO_ID = 'open-front';
export const DEFAULT_SKIRMISH_SCENARIO_ID = 'open-front';

export function listScenarios(): readonly ScenarioEntry[] {
  return SCENARIOS;
}

export function scenarioById(id: string): ScenarioEntry | undefined {
  return SCENARIOS.find((entry) => entry.id === id);
}

/** Lookup that refuses an unknown id instead of silently substituting one. */
export function requireScenario(id: string): ScenarioEntry {
  const entry = scenarioById(id);
  if (!entry) throw new Error(`Unknown scenario "${id}".`);
  return entry;
}

export function scenariosForMode(mode: GameMode): ScenarioEntry[] {
  return SCENARIOS.filter((entry) => entry.modes.includes(mode));
}

export function isScenarioAvailable(id: unknown, mode: GameMode): boolean {
  return typeof id === 'string' && scenariosForMode(mode).some((entry) => entry.id === id);
}

export function defaultScenarioId(mode: GameMode): string {
  if (mode === 'multiplayer') return DEFAULT_MULTIPLAYER_SCENARIO_ID;
  if (mode === 'skirmish') return DEFAULT_SKIRMISH_SCENARIO_ID;
  return CAMPAIGN_SCENARIOS[0].id;
}

/**
 * The four declared start positions of a four-way map, derived from the
 * authored first slot. Empty for a campaign map, whose two `players` carry
 * their own starts.
 */
export function scenarioSlots(entry: ScenarioEntry): ScenarioSlot[] {
  if (!entry.start) return [];
  return [0, 1, 2, 3].map((k) => rotatePoint(entry.width, k as 0 | 1 | 2 | 3, entry.start![0], entry.start![1]));
}

/**
 * Seat starts for a 1v1 on a four-way map: opposite slots, chosen
 * deterministically. Slot 0 and slot 2 are 180 degrees apart, so neither side
 * gets the shorter line to the centre.
 */
export function duelStartSlots(entry: ScenarioEntry): [ScenarioSlot, ScenarioSlot] | null {
  const slots = scenarioSlots(entry);
  if (slots.length < 4) return null;
  return [slots[0], slots[2]];
}

/**
 * Seat starts for a future 2v2: adjacent teammates (0 and 1) against the
 * opposite pair (2 and 3). Explicit and deterministic, not "whatever four-way
 * symmetry implies".
 */
export function teamStartSlots(entry: ScenarioEntry): { team0: ScenarioSlot[]; team1: ScenarioSlot[] } | null {
  const slots = scenarioSlots(entry);
  if (slots.length < 4) return null;
  return { team0: [slots[0], slots[1]], team1: [slots[2], slots[3]] };
}

/** Display metadata without building the tiles. */
export function scenarioSummary(entry: ScenarioEntry): {
  id: string;
  name: string;
  description: string;
  focus: string;
  tags: readonly string[];
  size: string;
  width: number;
  height: number;
  playerCounts: readonly number[];
  modes: readonly GameMode[];
  slots: number;
} {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    focus: entry.focus,
    tags: entry.tags,
    size: `${entry.width}×${entry.height}`,
    width: entry.width,
    height: entry.height,
    playerCounts: entry.playerCounts,
    modes: entry.modes,
    slots: entry.start ? 4 : 2,
  };
}
