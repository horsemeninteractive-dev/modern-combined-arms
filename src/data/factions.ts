import type { AllianceDef, FactionDef, FactionIdentity, NationDef, RosterDef } from '../sim/types';
import { BUILDING_LIST } from './buildings';
import { UNIT_LIST } from './units';

/**
 * The shared launch baseline. Both alliances field this roster; a nation's
 * differences are declared as substitutions in NATION_DATA rather than by
 * editing the baseline. The arrays are frozen so a caller cannot accidentally
 * edit the canonical content.
 */
const SHARED_BASELINE: RosterDef = Object.freeze({
  units: Object.freeze(UNIT_LIST.map((unit) => unit.id)),
  buildings: Object.freeze(BUILDING_LIST.map((building) => building.id)),
});

/**
 * The two launch alliances. Their names are working labels: the GDD only calls
 * the sides "defender-aligned" and "Russia-aligned", so narrative naming is a
 * later decision and must not be treated as established canon.
 */
const DEFENDER_ALLIANCE: AllianceDef = Object.freeze({
  id: 'defender',
  name: 'Defender Coalition',
  shortName: 'DEFENDER',
  color: '#37b6e0',
  accent: '#a8ecff',
  blurb:
    'The defender-aligned nations holding the Baltic approach. Lithuania, Poland and the United Kingdom share a launch baseline and differ through national specialisations.',
  baseline: SHARED_BASELINE,
});

const EASTERN_ALLIANCE: AllianceDef = Object.freeze({
  id: 'eastern',
  name: 'Eastern Coalition',
  shortName: 'EASTERN',
  color: '#ef6a4a',
  accent: '#ffc19e',
  blurb:
    'The Russia-aligned nations pressing the eastern campaign. Russia, Belarus and Hungary share a launch baseline and differ through national specialisations.',
  baseline: SHARED_BASELINE,
});

export const ALLIANCE_LIST: readonly AllianceDef[] = Object.freeze([
  DEFENDER_ALLIANCE,
  EASTERN_ALLIANCE,
]);

export const ALLIANCES: Readonly<Record<string, AllianceDef>> = Object.freeze(
  Object.fromEntries(ALLIANCE_LIST.map((alliance) => [alliance.id, alliance])),
);

/**
 * The six playable launch nations from GDD §5.1. Each nation inherits its
 * alliance baseline and replaces one slot with a registered national variant;
 * additions, exclusions and further substitutions are supported by the same
 * data contract. Colours are provisional presentation values, not national
 * canon.
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
    blurb:
      'Front-line defender in the opening Baltic crisis. Fields the unarmed Pathfinder scout: far better optics for less money, but its recon must be escorted.',
    roster: { replaceUnits: { recon: 'pathfinder' } },
  },
  {
    id: 'poland',
    name: 'Poland',
    shortName: 'POLAND',
    allianceId: 'defender',
    color: '#4f9ad8',
    accent: '#b9dcff',
    doctrine: 'Armoured spearhead',
    blurb:
      'Major regional military actor and the coalition\'s armoured weight. Fields the Spearhead MBT: a harder-hitting, tougher tank with slower hull and turret.',
    roster: { replaceUnits: { tank: 'spearhead' } },
  },
  {
    id: 'uk',
    name: 'United Kingdom',
    shortName: 'UK',
    allianceId: 'defender',
    color: '#6f8fce',
    accent: '#c7d8ff',
    doctrine: 'Saturation fires',
    blurb:
      'Expeditionary specialist contribution. Fields the Rocket Battery: the longest reach in the coalition, paid for with inaccurate rockets and a fragile hull.',
    roster: { replaceUnits: { spg: 'mlrs' } },
  },
  {
    id: 'russia',
    name: 'Russia',
    shortName: 'RUSSIA',
    allianceId: 'eastern',
    color: '#ef6a4a',
    accent: '#ffc19e',
    doctrine: 'Siege artillery',
    blurb:
      'Principal aggressor in the opening crisis; broad conventional capabilities. Fields the Heavy Howitzer: fewer, devastating shells from a slow, expensive hull.',
    roster: { replaceUnits: { spg: 'heavyHowitzer' } },
  },
  {
    id: 'belarus',
    name: 'Belarus',
    shortName: 'BELARUS',
    allianceId: 'eastern',
    color: '#d97a4a',
    accent: '#ffd0ad',
    doctrine: 'Deep surveillance',
    blurb:
      'Closely integrated with Russia in this timeline. Fields the Deep Recon UAV: thirty-tile optics and long endurance, but no weapon and a higher price.',
    roster: { replaceUnits: { uav: 'deepReconUAV' } },
  },
  {
    id: 'hungary',
    name: 'Hungary',
    shortName: 'HUNGARY',
    allianceId: 'eastern',
    color: '#c98f5a',
    accent: '#f2d6b3',
    doctrine: 'Fortified defence',
    blurb:
      'Limited specialist involvement; politically significant, but not an equal mass conventional force. Fields the Reinforced Bunker: fewer, tougher anti-infantry positions.',
    roster: { replaceBuildings: { mgNest: 'bunker' } },
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
    units: SHARED_BASELINE.units,
    buildings: SHARED_BASELINE.buildings,
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
    units: SHARED_BASELINE.units,
    buildings: SHARED_BASELINE.buildings,
  }),
});

/** Country/coalition display identity for a legacy preset. */
export function factionDef(id: string): FactionDef {
  return Object.hasOwn(FACTIONS, id) ? FACTIONS[id] : FACTIONS.baltic;
}

/**
 * Display identity for any id a scenario or player slot can hold: one of the
 * six nations, or one of the two legacy presets. The simulation and every UI
 * surface read identity through this shape so a nation is never a fallback.
 */
export interface IdentityDef extends FactionIdentity {
  readonly allianceId: string;
  /** True for the six playable launch nations. */
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
 * Ids a scenario may name today: the six nations plus the two legacy presets.
 * Alliances are content buckets, not player identities, so they are excluded.
 * `Object.hasOwn` keeps prototype keys such as `toString` out of the registry.
 */
export function isKnownFactionId(id: string): boolean {
  return Object.hasOwn(NATIONS, id) || Object.hasOwn(FACTIONS, id);
}
