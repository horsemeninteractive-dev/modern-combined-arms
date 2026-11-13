import type { AllianceDef, FactionDef, FactionIdentity, NationDef, RosterDef } from '../sim/types';
import { BUILDING_LIST } from './buildings';
import { UNIT_LIST } from './units';

/**
 * Canonical unit slot → Eurasian Pact platform.
 *
 * A slot absent from this map is a utility role both alliances field the same
 * way (engineer, harvester, recovery, medic). Keeping the selection here means
 * an alliance baseline is a choice over the canonical slots rather than a
 * second roster: no definition is cloned, and the variant chain still resolves
 * the slot for production, AI demand and saves.
 */
const EASTERN_PLATFORMS: Readonly<Record<string, string>> = Object.freeze({
  rifle: 'rifleEC',
  atgm: 'atgmEC',
  recon: 'reconEC',
  ifv: 'ifvEC',
  tank: 'tankEC',
  td: 'tdEC',
  spg: 'spgEC',
  rocketArtillery: 'rocketArtilleryEC',
  aa: 'aaEC',
  uav: 'uavEC',
  interceptor: 'interceptorEC',
  fighter: 'fighterEC',
  attackHelo: 'attackHeloEC',
  missileBoat: 'missileBoatEC',
  corvette: 'corvetteEC',
  frigate: 'frigateEC',
  submarine: 'submarineEC',
  navalSupport: 'navalSupportEC',
});

/** Structures are shared: only equipment defines an alliance. */
const BUILDING_BASELINE: readonly string[] = Object.freeze(
  BUILDING_LIST.map((building) => building.id),
);

/**
 * The Atlantic Accord baseline. Its canonical ids double as its platforms,
 * so the coalition fields the original lineage plus the five platforms added
 * for the slots the old shared baseline did not have. The arrays are frozen so
 * a caller cannot edit the canonical content.
 */
const DEFENDER_BASELINE: RosterDef = Object.freeze({
  units: Object.freeze(UNIT_LIST.map((unit) => unit.id)),
  buildings: BUILDING_BASELINE,
});

/**
 * The Eurasian Pact baseline: the same canonical slots, fielded as this
 * alliance's own equipment. A nation's differences are still declared as
 * substitutions in NATION_DATA rather than by editing the baseline.
 */
const EASTERN_BASELINE: RosterDef = Object.freeze({
  units: Object.freeze(UNIT_LIST.map((unit) => EASTERN_PLATFORMS[unit.id] ?? unit.id)),
  buildings: BUILDING_BASELINE,
});

/**
 * The two launch alliances. Their names are working labels: the GDD only calls
 * the sides "defender-aligned" and "Russia-aligned", so narrative naming is a
 * later decision and must not be treated as established canon.
 */
const DEFENDER_ALLIANCE: AllianceDef = Object.freeze({
  id: 'defender',
  name: 'Atlantic Accord',
  shortName: 'AA',
  color: '#37b6e0',
  accent: '#a8ecff',
  blurb:
    'The defender-aligned nations holding the Baltic and Scandinavian approach. Lithuania, Poland, the United Kingdom, Finland and Sweden field the coalition baseline — accurate guns, thermal optics and survivable hulls — and differ from each other through national specialisations.',
  baseline: DEFENDER_BASELINE,
});

const EASTERN_ALLIANCE: AllianceDef = Object.freeze({
  id: 'eastern',
  name: 'Eurasian Pact',
  shortName: 'EP',
  color: '#ef6a4a',
  accent: '#ffc19e',
  blurb:
    'The Russia-aligned nations pressing the eastern campaign. Russia, Belarus, Hungary, Iran and North Korea field the coalition baseline — cheaper hulls, heavier salvoes and longer reach — and differ from each other through national specialisations.',
  baseline: EASTERN_BASELINE,
});

export const ALLIANCE_LIST: readonly AllianceDef[] = Object.freeze([
  DEFENDER_ALLIANCE,
  EASTERN_ALLIANCE,
]);

export const ALLIANCES: Readonly<Record<string, AllianceDef>> = Object.freeze(
  Object.fromEntries(ALLIANCE_LIST.map((alliance) => [alliance.id, alliance])),
);

/**
 * The ten playable nations: five per coalition. Each nation inherits its
 * alliance baseline and then carries three differences: one replacement of an
 * existing slot, one exclusive unit and one building variant. The data contract
 * supports additions, exclusions and further substitutions, but the approved
 * design keeps one of each so a national identity stays legible. Sweden and Iran
 * additionally field a national naval hull (see §24 of the roster and technology
 * specification): their fleet identity needed a ship, not only a yard variant.
 * Colours are provisional presentation values, not national canon.
 *
 * This is an alternate-history conflict. Coalition membership here is fiction
 * and is not a statement about real-world alliances; see §23 of the roster and
 * technology specification for the escalation that brings each nation in.
 */
const NATION_DATA: readonly NationDef[] = [
  {
    id: 'lithuania',
    name: 'Lithuania',
    shortName: 'LITHUANIA',
    allianceId: 'defender',
    color: '#37b6e0',
    accent: '#a8ecff',
    doctrine: 'Reconnaissance screen',
    superweapon: 'ew',
    blurb:
      'Front-line defender in the opening Baltic crisis. Fields the unarmed Pathfinder scout for cheap long-range optics, the Kestrel air team for air denial that can hide in a building, and a cheaper Forward Observation Post in place of the shared radar array.',
    roster: {
      replaceUnits: { recon: 'pathfinder' },
      addUnits: ['kestrelTeam'],
      replaceBuildings: { radar: 'forwardPost' },
    },
  },
  {
    id: 'poland',
    name: 'Poland',
    shortName: 'POLAND',
    allianceId: 'defender',
    color: '#4f9ad8',
    accent: '#b9dcff',
    doctrine: 'Armoured spearhead',
    superweapon: 'drone',
    blurb:
      'Major regional military actor and the coalition\'s armoured weight. Fields the harder-hitting Spearhead MBT, the Wilk heavy IFV that can fight tanks, and an Armoured Workshop that keeps its vehicle line alive under fire.',
    roster: {
      replaceUnits: { tank: 'spearhead' },
      addUnits: ['wilk'],
      replaceBuildings: { factory: 'armourWorks' },
    },
  },
  {
    id: 'uk',
    name: 'United Kingdom',
    shortName: 'UK',
    allianceId: 'defender',
    color: '#6f8fce',
    accent: '#c7d8ff',
    doctrine: 'Saturation fires',
    superweapon: 'saturation',
    blurb:
      'Expeditionary specialist contribution. Fields the long-reach Rocket Battery, the Storm Shadow deep-strike launcher that breaks a position from beyond sight, and a cheap Expeditionary Airfield that is easier to lose.',
    roster: {
      replaceUnits: { spg: 'mlrs' },
      addUnits: ['stormShadow'],
      replaceBuildings: { airfield: 'expeditionaryAirfield' },
    },
  },
  {
    id: 'finland',
    name: 'Finland',
    shortName: 'FINLAND',
    allianceId: 'defender',
    color: '#4a86b8',
    accent: '#cfe6ff',
    doctrine: 'Territorial defence',
    superweapon: 'dew',
    blurb:
      'Northern anchor of the coalition line. Fields the long-reaching K9 Thunder howitzer, the Spike ER team that kills armour from behind a ridge, and a cheap Garrison Barracks so every sector can raise its own infantry.',
    roster: {
      replaceUnits: { spg: 'k9Thunder' },
      addUnits: ['spikeTeam'],
      replaceBuildings: { barracks: 'garrisonBarracks' },
    },
  },
  {
    id: 'sweden',
    name: 'Sweden',
    shortName: 'SWEDEN',
    allianceId: 'defender',
    color: '#3b6ea8',
    accent: '#ffd76a',
    doctrine: 'Mobile combined arms',
    superweapon: 'hypersonic',
    blurb:
      'Technologically advanced northern contributor. Fields the fast, long-sighted CV90, the Gripen multirole fighter that carries both an air-to-air and a strike missile, the Visby-class corvette that outruns anything else afloat, and a hardened Kockums Shipyard on the coast.',
    roster: {
      replaceUnits: { ifv: 'cv90' },
      addUnits: ['gripen', 'visby'],
      replaceBuildings: { shipyard: 'kockumsYard' },
    },
  },
  {
    id: 'russia',
    name: 'Russia',
    shortName: 'RUSSIA',
    allianceId: 'eastern',
    color: '#ef6a4a',
    accent: '#ffc19e',
    doctrine: 'Siege artillery',
    superweapon: 'hypersonic',
    blurb:
      'Principal aggressor in the opening crisis; broad conventional capabilities. Fields the devastating Heavy Howitzer, the short-range TOSP thermobaric launcher for clearing positions, and a Long-Range SAM site that reaches further than the shared battery.',
    roster: {
      replaceUnits: { spgEC: 'heavyHowitzer' },
      addUnits: ['tosp'],
      replaceBuildings: { samBattery: 'longRangeSam' },
    },
  },
  {
    id: 'belarus',
    name: 'Belarus',
    shortName: 'BELARUS',
    allianceId: 'eastern',
    color: '#d97a4a',
    accent: '#ffd0ad',
    doctrine: 'Deep surveillance',
    superweapon: 'ew',
    blurb:
      'Closely integrated with Russia in this timeline. Fields the thirty-tile Deep Recon UAV, cheap Sprint recon buggies to saturate the map with eyes, and a Signals Bureau that runs national research a fifth faster than the shared centre at the cost of survivability.',
    roster: {
      replaceUnits: { uavEC: 'deepReconUAV' },
      addUnits: ['sprut'],
      replaceBuildings: { researchCentre: 'signalsBureau' },
    },
  },
  {
    id: 'hungary',
    name: 'Hungary',
    shortName: 'HUNGARY',
    allianceId: 'eastern',
    color: '#d4724f',
    accent: '#ffcdb4',
    doctrine: 'Fortified defence',
    superweapon: 'dew',
    blurb:
      'Limited specialist involvement; politically significant, but not an equal mass conventional force. Fields the fast-reloading Hedgehog AT team, the Taszar mortar team — indirect fire that fits in a building — and the Reinforced Bunker.',
    roster: {
      replaceUnits: { atgmEC: 'hedgehogTeam' },
      addUnits: ['taszar'],
      replaceBuildings: { mgNest: 'bunker' },
    },
  },
  {
    id: 'iran',
    name: 'Iran',
    shortName: 'IRAN',
    allianceId: 'eastern',
    color: '#c0503f',
    accent: '#ffc9bd',
    doctrine: 'Unmanned strike',
    superweapon: 'drone',
    blurb:
      'Unmanned-systems specialist of the eastern coalition. Fields the long-reaching 3rd Khordad SAM vehicle, the Mohajer-6 armed drone that finds a position and then bombs it, the Ghadir midget submarine that ambushes from shallow water, and cheap dispersed Noor coast launchers.',
    roster: {
      replaceUnits: { aaEC: 'khordadSam' },
      addUnits: ['mohajer6', 'ghadir'],
      replaceBuildings: { coastalBattery: 'noorBattery' },
    },
  },
  {
    id: 'northKorea',
    name: 'North Korea',
    shortName: 'N. KOREA',
    allianceId: 'eastern',
    color: '#b8433c',
    accent: '#ffd3c9',
    doctrine: 'Siege fires',
    superweapon: 'saturation',
    blurb:
      'Siege-fire specialist pressing the eastern front. Replaces its assault gun with the Bulsae-4 missile carrier that stands off fourteen tiles, adds the 170mm Koksan that out-ranges every tube in the game beside the shared howitzer, and builds an Entrenched AT Gun meant to be assaulted.',
    roster: {
      replaceUnits: { tdEC: 'bulsae4' },
      addUnits: ['koksan'],
      replaceBuildings: { atTurret: 'entrenchedAtGun' },
    },
  },
];

export const NATION_LIST: readonly NationDef[] = Object.freeze(
  NATION_DATA.map((nation) => Object.freeze({ ...nation })),
);

export const NATIONS: Readonly<Record<string, NationDef>> = Object.freeze(
  Object.fromEntries(NATION_LIST.map((nation) => [nation.id, nation])),
);

/**
 * Legacy alliance-level presets used by the built-in maps, existing saves and
 * the current HUD. They remain valid faction ids and resolve to their alliance
 * baseline. New content should name a nation, not add another preset here.
 */
export const FACTIONS: Readonly<Record<string, FactionDef>> = Object.freeze({
  baltic: Object.freeze({
    id: 'baltic',
    name: 'Baltic Task Force',
    shortName: 'BALTIC',
    color: '#37b6e0',
    accent: '#a8ecff',
    blurb:
      'A Lithuanian-led multinational battlegroup holding the western beachhead. Balanced armour, strong infantry anti-tank teams and coalition air support.',
    allianceId: 'defender',
    units: DEFENDER_BASELINE.units,
    buildings: DEFENDER_BASELINE.buildings,
  }),
  expeditionary: Object.freeze({
    id: 'expeditionary',
    name: '11th Expeditionary Corps',
    shortName: '11th CORPS',
    color: '#ef6a4a',
    accent: '#ffc19e',
    blurb:
      'A reinforced Russian corps group dug in across the island. Heavy armour, layered air defence and a coastal missile corvette.',
    allianceId: 'eastern',
    units: EASTERN_BASELINE.units,
    buildings: EASTERN_BASELINE.buildings,
  }),
});

/** Country/coalition display identity for a legacy preset. */
export function factionDef(id: string): FactionDef {
  return Object.hasOwn(FACTIONS, id) ? FACTIONS[id] : FACTIONS.baltic;
}

/**
 * Display identity for any id a scenario or player slot can hold: one of the
 * ten nations, or one of the two legacy presets. The simulation and every UI
 * surface read identity through this shape so a nation is never a fallback.
 */
export interface IdentityDef extends FactionIdentity {
  readonly allianceId: string;
  /** True for the ten playable nations. */
  readonly playable: boolean;
  /** True for the legacy `baltic` / `expeditionary` alliance presets. */
  readonly legacy: boolean;
  /** Battlefield identity for a playable nation; absent on legacy presets. */
  readonly doctrine?: string;
}

/** A nation record, or a clear error for a typo or a campaign-only identity. */
export function nationDef(id: string): NationDef {
  if (!Object.hasOwn(NATIONS, id)) throw new Error(`Unknown nation definition: ${id}`);
  return NATIONS[id];
}

/** An alliance record, or a clear error for an unknown id. */
export function allianceDef(id: string): AllianceDef {
  if (!Object.hasOwn(ALLIANCES, id)) throw new Error(`Unknown alliance definition: ${id}`);
  return ALLIANCES[id];
}

/**
 * Identity for a nation or a legacy preset, or `undefined` for an unknown id.
 * Render paths use this so a corrupt save cannot crash a frame; the scenario
 * and save boundaries use `identityDef` and fail loudly instead.
 */
const identityCache = new Map<string, IdentityDef>();

export function tryIdentityDef(id: string): IdentityDef | undefined {
  const cached = identityCache.get(id);
  if (cached) return cached;
  let identity: IdentityDef | undefined;
  if (Object.hasOwn(NATIONS, id)) {
    const nation = NATIONS[id];
    identity = Object.freeze({
      ...nation,
      playable: true,
      legacy: false,
      doctrine: nation.doctrine,
    });
  } else if (Object.hasOwn(FACTIONS, id)) {
    identity = Object.freeze({ ...FACTIONS[id], playable: false, legacy: true });
  }
  // Presentation calls this per entity per frame; a shared frozen record keeps
  // the render path allocation-free.
  if (identity) identityCache.set(id, identity);
  return identity;
}

/** Identity for a nation or a legacy preset; throws on an unknown id. */
export function identityDef(id: string): IdentityDef {
  const identity = tryIdentityDef(id);
  if (!identity) throw new Error(`Unknown faction or nation definition: ${id}`);
  return identity;
}

/** The alliance a nation or legacy preset belongs to. */
export function identityAlliance(id: string): AllianceDef {
  return allianceDef(identityDef(id).allianceId);
}

/** Short registry label for any identity; the raw id if it is unknown. */
export function identityLabel(id: string): string {
  const identity = tryIdentityDef(id);
  return identity ? identity.shortName || identity.name : id;
}

/** The playable nation ids, in registry order. */
export const PLAYABLE_NATION_IDS: readonly string[] = Object.freeze(
  NATION_LIST.map((nation) => nation.id),
);

/**
 * The first playable nation of an alliance. This is the default identity for a
 * side and the opponent a nation faces when the player has not picked one.
 */
export function defaultNationFor(allianceId: string): NationDef {
  const nation = NATION_LIST.find((entry) => entry.allianceId === allianceId);
  if (!nation) throw new Error(`Alliance "${allianceId}" has no playable nation.`);
  return nation;
}

/** The alliance a nation or preset opposes; the two launch sides are exclusive. */
export function opposingAllianceId(allianceId: string): string {
  const other = ALLIANCE_LIST.find((alliance) => alliance.id !== allianceId);
  if (!allianceDef(allianceId) || !other) throw new Error(`No opposing alliance for "${allianceId}".`);
  return other.id;
}

/**
 * The nation the AI commands against a player nation. Deterministic and
 * registry-driven: it is the first nation of the opposing alliance, so a
 * Lithuanian commander faces Russia and a Russian commander faces Lithuania.
 */
export function defaultOpponentNation(nationOrPresetId: string): NationDef {
  return defaultNationFor(opposingAllianceId(identityDef(nationOrPresetId).allianceId));
}

/**
 * Every playable nation, in registry order. Skirmish setup is free-choice:
 * any nation can fight any other, including a mirror match.
 */
export function playableNations(): readonly NationDef[] {
  return NATION_LIST;
}

/**
 * Resolve the opponent for a deployment. Any playable nation is legal, so a
 * mirror match is a valid pick; a stale or unknown id falls back to the
 * deterministic other-alliance default.
 */
export function resolveOpponentNation(nationOrPresetId: string, chosenId?: string): NationDef {
  const chosen = chosenId ? tryIdentityDef(chosenId) : undefined;
  if (chosen?.playable) return chosen as NationDef;
  return defaultOpponentNation(nationOrPresetId);
}

/**
 * Ids a scenario may name today: the ten nations plus the two legacy presets.
 * Alliances are content buckets, not player identities, so they are excluded.
 * `Object.hasOwn` keeps prototype keys such as `toString` out of the registry.
 */
export function isKnownFactionId(id: string): boolean {
  return Object.hasOwn(NATIONS, id) || Object.hasOwn(FACTIONS, id);
}
