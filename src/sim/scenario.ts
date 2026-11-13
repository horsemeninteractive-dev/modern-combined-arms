import { MAP_FORMAT, MAP_FORMAT_VERSION, PLAYER } from './constants';
import {
  ELEVATION_STEP,
  OVERLAY_BYTE_MAX,
  OVERLAYS,
  TERRAIN,
  TERRAIN_ID_MAX,
  Terrain,
  canStandOn,
  inBounds,
  isNavigable,
  moveCost,
  overlayAllowedOn,
  overlayIdOf,
  overlayLabel,
  tileBuildable,
  tileIndex,
  type TerrainId,
} from './terrain';
import type { MoveClass } from './types';
import { BUILDINGS } from '../data/buildings';
import { PROPS, isPropKind, type PropKind } from '../data/props';
import { dist2 } from '../core/math';
import { UNITS, unitFamily } from '../data/units';
import { TECHS } from '../data/research';
import { identityLabel, isKnownFactionId, tryIdentityDef } from '../data/factions';
import {
  DEFAULT_DAY_LENGTH_MINUTES,
  PHASE_START_HOURS,
  configFromPhase,
  normaliseDayLength,
  normaliseStartHour,
} from './dayNight';
import { isWeatherKind, type WeatherKind } from './weather';
import { MissionFormatError, parseMission, validateMission, isMissionId } from '../mission';
import type { MissionDoc } from '../mission';

export interface ScenarioTile {
  /** Base terrain id. */
  t: number;
  e: number;
  /** Remaining material in this tile (0 = none). */
  o: number;
  /**
   * Packed surface/vegetation overlay (0 or absent = none). The base terrain is
   * never replaced by an overlay, so "farmland + crops" stays one tile with one
   * buildability answer and one movement cost.
   */
  v?: number;
}

/**
 * Per-commander limits for one battle.
 *
 * A campaign operation is fought with the force that was actually landed, not
 * the whole roster: the technology tree is trimmed to what the operation
 * supports, and a platform the theatre cannot sustain is refused even where a
 * granted technology would normally open it. Absent means "no limits", which is
 * what every skirmish and multiplayer scenario still means.
 *
 * The lists name canonical slots or concrete definitions; the simulation
 * resolves a concrete definition through its family, so locking `tank` also
 * locks a national tank replacement.
 */
export interface ScenarioRestrictions {
  /** Unit ids the commander may not field in this battle. */
  units?: string[];
  /** Structure ids the commander may not construct in this battle. */
  buildings?: string[];
  /** Technology ids the commander may not research in this battle. */
  technologies?: string[];
}

export interface ScenarioPlayer {
  id: number;
  name: string;
  factionId: string;
  team: number;
  isAI: boolean;
  /**
   * Authored AI commander for this player, when one is chosen. Optional and
   * absent everywhere it is not used, so existing scenarios and saves keep their
   * exact file shape and their seeded AI behaviour. The identity must belong to
   * this player's nation; the simulation resolves it through the catalogue and
   * falls back to the seeded profile when it cannot.
   */
  commanderId?: string;
  /** Player start tile (used for deployment validation and editor markers). */
  startX: number;
  startZ: number;
  /**
   * Technologies granted at match start. Scenario authoring uses this instead
   * of a separate unlock path; the same effect resolution runs as research.
   * Pre-placed structures and units also grant the technology they imply.
   */
  technologies?: string[];
  /**
   * Optional team tint chosen in skirmish setup (`#rrggbb`). Absent on authored
   * maps and legacy saves, where the faction identity supplies the colour. It
   * is presentation only: team masks, ownership and visibility still use `team`.
   */
  color?: string;
  /** Authored roster limits for this battle; absent means the full roster. */
  restrictions?: ScenarioRestrictions;
}

export interface ScenarioStructure {
  defId: string;
  owner: number;
  /**
   * Stable authored identity for this placement (mission references, named
   * assets). Optional: an ordinary skirmish placement has no key and behaves
   * exactly as before.
   */
  key?: string;
  /** Top-left tile of the footprint. */
  x: number;
  z: number;
  /**
   * Yaw in radians. Absent means 0, and a water-dependent structure without it
   * is turned toward its harbour when the battle starts. The editor writes it
   * so an authored coastline keeps its slipway facing.
   */
  facing?: number;
}

export interface ScenarioUnit {
  defId: string;
  owner: number;
  /** Stable authored identity; see `ScenarioStructure.key`. */
  key?: string;
  /** Centre tile. */
  x: number;
  z: number;
}

/**
 * One authored prop: an individual piece of set dressing on a tile.
 *
 * Absent from a scenario that has none, so every map authored before props
 * existed keeps its exact file shape. `x`/`z` are tiles; the renderer draws the
 * prop in the middle of its tile, which is where the Forge's cursor put it.
 */
export interface ScenarioProp {
  kind: PropKind;
  x: number;
  z: number;
  /** Yaw in radians; absent means 0. Authored props snap to 45° steps. */
  rotation?: number;
  /** Size multiplier applied to the catalogue's own scale; absent means 1. */
  scale?: number;
  /**
   * Nudge within the prop's own tile, in tile fractions (-0.5..0.5). Absent
   * means the middle of the tile, which is where every prop authored before
   * this field stood. The tile itself never changes: a prop stays inside the
   * cell it was placed in, so the authored tile keeps naming its ground.
   */
  offsetX?: number;
  offsetZ?: number;
}

export type VictoryType = 'destroyHQ' | 'annihilation';

export interface ScenarioSettings {
  seed: number;
  startingMats: number;
  startingReq: number;
  fog: boolean;
  victory: VictoryType;
  timeLimitSec: number | null;
  weather: WeatherKind;
  /** Legacy phase label: still the authored intent, and the default start hour. */
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night';
  /**
   * Authoritative start hour, 0..24. `timeOfDay` seeds it when absent, so an
   * older scenario keeps the time it was authored for.
   */
  startHour: number;
  /** Real minutes per in-game day; 0 freezes the clock at `startHour`. */
  dayLengthMinutes: number;
  /**
   * Whether national strategic superweapons may be built and called in. Absent
   * means enabled: existing skirmish and competitive maps keep their behaviour,
   * and a campaign theatre that wants them off says so explicitly.
   */
  superweapons?: boolean;
}

export interface ScenarioCampaignRef {
  campaignId: string;
  missionId: string;
}

/**
 * One declared starting position.
 *
 * Competitive maps declare four, one per 90-degree rotation of the map. A 1v1
 * uses the opposite pair; a future 2v2 uses adjacent pairs. Campaign and
 * editor scenarios leave `slots` out and rely on `players[].startX/startZ`, so
 * this is additive metadata on the single shared scenario format rather than a
 * second map system.
 */
export interface ScenarioSlot {
  x: number;
  z: number;
}

export interface Scenario {
  format: typeof MAP_FORMAT;
  version: number;
  meta: {
    id: string;
    name: string;
    description: string;
    author: string;
    created: string;
    targetSize: 'small' | 'medium' | 'large';
    /**
     * Set only on a scenario launched from the campaign deck. It lets a saved
     * campaign battle unlock the next operation after a reload; ordinary
     * skirmish and editor scenarios leave it undefined.
     */
    campaign?: ScenarioCampaignRef;
  };
  width: number;
  height: number;
  tiles: ScenarioTile[];
  players: ScenarioPlayer[];
  structures: ScenarioStructure[];
  units: ScenarioUnit[];
  /** Individually authored set dressing; absent on a map with none. */
  props?: ScenarioProp[];
  objectives: string[];
  settings: ScenarioSettings;
  /** Four rotated starts on competitive maps; absent elsewhere. */
  slots?: ScenarioSlot[];
  /**
   * Optional mission document. A skirmish scenario has none and behaves exactly
   * as it did before missions existed. The mission is parsed and validated here
   * so nothing downstream can hold a malformed one.
   */
  mission?: MissionDoc;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  /** Tile coordinate the issue refers to, when applicable. */
  x?: number;
  z?: number;
  entityRef?: string;
}

export class ScenarioFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioFormatError';
  }
}

/**
 * Default settings for an in-code scenario, with the start hour taken from the
 * authored phase. A builder that only knows it wants daylight gets noon, not
 * whatever the neutral default happens to be.
 */
export function phaseSettings(timeOfDay: ScenarioSettings['timeOfDay']): ScenarioSettings {
  return { ...defaultSettings(), timeOfDay, ...configFromPhase(timeOfDay) };
}

export function defaultSettings(): ScenarioSettings {
  return {
    seed: 1337,
    startingMats: 2600,
    startingReq: 120,
    fog: true,
    victory: 'destroyHQ',
    timeLimitSec: null,
    weather: 'clear',
    // A neutral scenario is a daylight battle; authors ask for anything else.
    timeOfDay: 'day',
    startHour: PHASE_START_HOURS.day,
    dayLengthMinutes: DEFAULT_DAY_LENGTH_MINUTES,
  };
}

export function createScenario(width: number, height: number, name = 'Untitled scenario'): Scenario {
  const tiles: ScenarioTile[] = new Array(width * height);
  for (let i = 0; i < tiles.length; i++) tiles[i] = { t: Terrain.Grass, e: 1, o: 0 };
  return {
    format: MAP_FORMAT,
    version: MAP_FORMAT_VERSION,
    meta: {
      id: `scenario-${Date.now().toString(36)}`,
      name,
      description: '',
      author: 'Scenario Editor',
      created: new Date().toISOString().slice(0, 10),
      targetSize: width >= 128 ? 'large' : width >= 80 ? 'medium' : 'small',
    },
    width,
    height,
    tiles,
    players: [],
    structures: [],
    units: [],
    objectives: ['Destroy the enemy Command Post.'],
    settings: defaultSettings(),
  };
}

/* ------------------------------------------------------------------ */
/* Parsing & serialisation                                             */
/* ------------------------------------------------------------------ */

function fail(path: string, expected: string): never {
  throw new ScenarioFormatError(`Invalid scenario at ${path}: expected ${expected}`);
}

function asNumber(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `number in [${min}, ${max}]`);
  }
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'string');
  return value;
}

function asBool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'boolean');
  return value;
}

/** Authored placement keys share the mission identifier alphabet. */
function asAuthoredKey(value: unknown, path: string): string {
  const key = asString(value, path);
  if (!isMissionId(key)) fail(path, 'a letter-first identifier of at most 64 characters');
  return key;
}

/** Accept an object (from JSON or localStorage) and return a typed, checked scenario. */
export function parseScenario(
  raw: unknown,
  /** Draft recovery only; see `parseMission`. Everything else stays strict. */
  options: { allowInvalidMission?: boolean } = {},
): Scenario {
  if (!raw || typeof raw !== 'object') fail('scenario', 'object');
  const r = raw as Record<string, unknown>;
  if (r.format !== MAP_FORMAT) fail('format', MAP_FORMAT);
  if (r.version !== MAP_FORMAT_VERSION) {
    throw new ScenarioFormatError(
      `Unsupported scenario version ${String(r.version)}. This build supports version ${MAP_FORMAT_VERSION}.`,
    );
  }
  const width = asNumber(r.width, 'width', 16, 256);
  const height = asNumber(r.height, 'height', 16, 256);
  const tilesRaw = r.tiles;
  if (!Array.isArray(tilesRaw) || tilesRaw.length !== width * height) {
    fail('tiles', `${width * height} tile entries`);
  }
  const tiles: ScenarioTile[] = tilesRaw.map((v, i) => {
    if (!v || typeof v !== 'object') fail(`tiles[${i}]`, 'object');
    const t = v as Record<string, unknown>;
    const terrain = asNumber(t.t, `tiles[${i}].t`, 0, TERRAIN_ID_MAX);
    const e = asNumber(t.e, `tiles[${i}].e`, 0, 4);
    const o = asNumber(t.o ?? 0, `tiles[${i}].o`, 0, 65535);
    // Overlays are optional: a tile without one is the format every earlier
    // scenario already used, so nothing has to be migrated.
    const overlay = t.v === undefined ? 0 : asNumber(t.v, `tiles[${i}].v`, 0, OVERLAY_BYTE_MAX);
    return overlay > 0 ? { t: terrain, e, o, v: overlay } : { t: terrain, e, o };
  });
  const metaRaw = (r.meta ?? {}) as Record<string, unknown>;
  // Campaign provenance is optional metadata, not a second scenario format.
  // Preserving it here means a campaign battle saved mid-operation still
  // knows which operation it belongs to when it is loaded again.
  const campaignRaw = metaRaw.campaign;
  let campaign: ScenarioCampaignRef | undefined;
  if (campaignRaw && typeof campaignRaw === 'object') {
    const ref = campaignRaw as Record<string, unknown>;
    campaign = {
      campaignId: asString(ref.campaignId, 'meta.campaign.campaignId'),
      missionId: asString(ref.missionId, 'meta.campaign.missionId'),
    };
  }
  const settingsRaw = (r.settings ?? {}) as Record<string, unknown>;
  const playersRaw = Array.isArray(r.players) ? r.players : fail('players', 'array');
  const players: ScenarioPlayer[] = playersRaw.map((p, i) => {
    const pr = p as Record<string, unknown>;
    const factionId = asString(pr.factionId, `players[${i}].factionId`);
    if (!isKnownFactionId(factionId)) fail(`players[${i}].factionId`, 'known faction');
    // A custom tint is optional; when present it must be a full hex colour.
    const color =
      pr.color === undefined
        ? undefined
        : /^#[0-9a-f]{6}$/i.test(asString(pr.color, `players[${i}].color`))
          ? (pr.color as string)
          : fail(`players[${i}].color`, 'hex colour');
    const technologies: string[] | undefined =
      pr.technologies === undefined
        ? undefined
        : Array.isArray(pr.technologies)
          ? pr.technologies.map((id, index) => {
              const techId = asString(id, `players[${i}].technologies[${index}]`);
              if (!TECHS[techId]) fail(`players[${i}].technologies[${index}]`, 'known technology');
              return techId;
            })
          : fail(`players[${i}].technologies`, 'array');
    // Roster limits are optional: a scenario authored before them, or one whose
    // theatre fields the whole roster, carries no restrictions at all.
    const restrictionsRaw = pr.restrictions;
    let restrictions: ScenarioRestrictions | undefined;
    if (restrictionsRaw !== undefined && restrictionsRaw !== null) {
      if (typeof restrictionsRaw !== 'object' || Array.isArray(restrictionsRaw)) {
        fail(`players[${i}].restrictions`, 'object');
      }
      const rr = restrictionsRaw as Record<string, unknown>;
      const list = (key: 'units' | 'buildings' | 'technologies', known: (id: string) => boolean) => {
        const value = rr[key];
        if (value === undefined) return undefined;
        if (!Array.isArray(value)) fail(`players[${i}].restrictions.${key}`, 'array');
        const ids = value.map((entry, index) => {
          const id = asString(entry, `players[${i}].restrictions.${key}[${index}]`);
          if (!known(id)) fail(`players[${i}].restrictions.${key}[${index}]`, 'known id');
          return id;
        });
        // Duplicates are harmless for a deny list, but a repeated id in an
        // authored file is always a copy-paste slip worth reporting.
        if (new Set(ids).size !== ids.length) {
          fail(`players[${i}].restrictions.${key}`, 'unique ids');
        }
        return ids.length > 0 ? ids : undefined;
      };
      const units = list('units', (id) => Boolean(UNITS[id]));
      const buildings = list('buildings', (id) => Boolean(BUILDINGS[id]));
      const technologies = list('technologies', (id) => Boolean(TECHS[id]));
      if (units || buildings || technologies) {
        restrictions = {
          ...(units ? { units } : {}),
          ...(buildings ? { buildings } : {}),
          ...(technologies ? { technologies } : {}),
        };
      }
    }
    return {
      id: asNumber(pr.id, `players[${i}].id`, 0, 7),
      name: asString(pr.name, `players[${i}].name`),
      factionId,
      team: asNumber(pr.team, `players[${i}].team`, 0, 7),
      isAI: asBool(pr.isAI ?? false, `players[${i}].isAI`),
      startX: asNumber(pr.startX, `players[${i}].startX`, 0, width - 1),
      startZ: asNumber(pr.startZ, `players[${i}].startZ`, 0, height - 1),
      ...(color ? { color } : {}),
      ...(technologies && technologies.length > 0 ? { technologies } : {}),
      ...(restrictions ? { restrictions } : {}),
    };
  });
  const structures: ScenarioStructure[] = (Array.isArray(r.structures) ? r.structures : []).map(
    (s, i) => {
      const sr = s as Record<string, unknown>;
      const defId = asString(sr.defId, `structures[${i}].defId`);
      if (!BUILDINGS[defId]) fail(`structures[${i}].defId`, 'known building');
      return {
        defId,
        owner: asNumber(sr.owner, `structures[${i}].owner`, -1, 7),
        ...(sr.key === undefined ? {} : { key: asAuthoredKey(sr.key, `structures[${i}].key`) }),
        x: asNumber(sr.x, `structures[${i}].x`, 0, width - 1),
        z: asNumber(sr.z, `structures[${i}].z`, 0, height - 1),
        // Authored orientation (yards face their harbour) survives a reload.
        facing:
          sr.facing === undefined
            ? undefined
            : asNumber(sr.facing, `structures[${i}].facing`, -Math.PI, Math.PI),
      };
    },
  );
  const units: ScenarioUnit[] = (Array.isArray(r.units) ? r.units : []).map((u, i) => {
    const ur = u as Record<string, unknown>;
    const defId = asString(ur.defId, `units[${i}].defId`);
    if (!UNITS[defId]) fail(`units[${i}].defId`, 'known unit');
    return {
      defId,
      owner: asNumber(ur.owner, `units[${i}].owner`, -1, 7),
      ...(ur.key === undefined ? {} : { key: asAuthoredKey(ur.key, `units[${i}].key`) }),
      x: asNumber(ur.x, `units[${i}].x`, 0, width - 1),
      z: asNumber(ur.z, `units[${i}].z`, 0, height - 1),
    };
  });
  // Authored props are optional in the same way: a map that places scenery by
  // hand carries the list, every other map carries nothing.
  const props: ScenarioProp[] = (Array.isArray(r.props) ? r.props : []).map((p, i) => {
    const pr = p as Record<string, unknown>;
    const kind = asString(pr.kind, `props[${i}].kind`);
    if (!isPropKind(kind)) fail(`props[${i}].kind`, 'known prop');
    return {
      kind,
      x: asNumber(pr.x, `props[${i}].x`, 0, width - 1),
      z: asNumber(pr.z, `props[${i}].z`, 0, height - 1),
      ...(pr.rotation === undefined
        ? {}
        : { rotation: asNumber(pr.rotation, `props[${i}].rotation`, -Math.PI, Math.PI) }),
      ...(pr.scale === undefined
        ? {}
        : { scale: asNumber(pr.scale, `props[${i}].scale`, 0.25, 3) }),
      ...(pr.offsetX === undefined
        ? {}
        : { offsetX: asNumber(pr.offsetX, `props[${i}].offsetX`, -0.5, 0.5) }),
      ...(pr.offsetZ === undefined
        ? {}
        : { offsetZ: asNumber(pr.offsetZ, `props[${i}].offsetZ`, -0.5, 0.5) }),
    };
  });
  // Authored keys are the identity mission references resolve against, so they
  // are unique across both placement lists, not merely within one of them.
  const authoredKeys = new Map<string, string>();
  structures.forEach((s, i) => {
    if (!s.key) return;
    const owner = authoredKeys.get(s.key);
    if (owner) fail(`structures[${i}].key`, `a unique authored key (already used by ${owner})`);
    authoredKeys.set(s.key, `structures[${i}]`);
  });
  units.forEach((u, i) => {
    if (!u.key) return;
    const owner = authoredKeys.get(u.key);
    if (owner) fail(`units[${i}].key`, `a unique authored key (already used by ${owner})`);
    authoredKeys.set(u.key, `units[${i}]`);
  });
  const fog = asBool(settingsRaw.fog ?? true, 'settings.fog');
  const victory = settingsRaw.victory ?? 'destroyHQ';
  if (victory !== 'destroyHQ' && victory !== 'annihilation') fail('settings.victory', 'known victory type');
  // A file written before storms and snow existed keeps the weather it named;
  // an unknown value is a hard failure rather than a silent clear day.
  const weather = settingsRaw.weather ?? 'clear';
  if (!isWeatherKind(weather)) fail('settings.weather', 'known weather');
  const timeOfDay = settingsRaw.timeOfDay ?? 'dusk';
  if (!['dawn', 'day', 'dusk', 'night'].includes(timeOfDay as string)) fail('settings.timeOfDay', 'known time');
  // Start hour and cycle length are the authoritative clock; the phase label is
  // retained as authored intent and as the fallback when a file predates them.
  const phaseDefaults = configFromPhase(timeOfDay as string, DEFAULT_DAY_LENGTH_MINUTES);
  const settings: ScenarioSettings = {
    seed: asNumber(settingsRaw.seed ?? 1337, 'settings.seed', 0, 0xffffffff),
    startingMats: asNumber(settingsRaw.startingMats ?? 2600, 'settings.startingMats', 0, 1000000),
    startingReq: asNumber(settingsRaw.startingReq ?? 120, 'settings.startingReq', 0, 1000000),
    fog,
    victory,
    timeLimitSec:
      settingsRaw.timeLimitSec == null
        ? null
        : asNumber(settingsRaw.timeLimitSec, 'settings.timeLimitSec', 10, 7200),
    weather: weather as ScenarioSettings['weather'],
    timeOfDay: timeOfDay as ScenarioSettings['timeOfDay'],
    startHour: normaliseStartHour(settingsRaw.startHour, phaseDefaults.startHour),
    dayLengthMinutes: normaliseDayLength(
      settingsRaw.dayLengthMinutes,
      phaseDefaults.dayLengthMinutes,
    ),
    ...(settingsRaw.superweapons === undefined
      ? {}
      : { superweapons: asBool(settingsRaw.superweapons, 'settings.superweapons') }),
  };
  // A mission is optional, but when present it is parsed and validated rather
  // than passed through: an unknown condition kind or a dangling trigger
  // reference must not reach the simulation as a half-typed object.
  let mission: MissionDoc | undefined;
  if (r.mission !== undefined) {
    try {
      mission = parseMission(
        r.mission,
        {
          width,
          height,
          entityKeys: new Set(authoredKeys.keys()),
        },
        { allowInvalid: options.allowInvalidMission === true },
      );
    } catch (error) {
      if (error instanceof MissionFormatError) {
        throw new ScenarioFormatError(`Invalid scenario at mission — ${error.message}`);
      }
      throw error;
    }
  }
  const slots: ScenarioSlot[] | undefined = Array.isArray(r.slots)
    ? r.slots.map((value, i) => {
        const slot = value as Record<string, unknown>;
        return {
          x: asNumber(slot?.x, `slots[${i}].x`, 0, width - 1),
          z: asNumber(slot?.z, `slots[${i}].z`, 0, height - 1),
        };
      })
    : undefined;
  return {
    format: MAP_FORMAT,
    version: MAP_FORMAT_VERSION,
    meta: {
      id: asString(metaRaw.id ?? 'scenario', 'meta.id'),
      name: asString(metaRaw.name ?? 'Untitled', 'meta.name'),
      description: asString(metaRaw.description ?? '', 'meta.description'),
      author: asString(metaRaw.author ?? '', 'meta.author'),
      created: asString(metaRaw.created ?? '', 'meta.created'),
      targetSize: (metaRaw.targetSize as Scenario['meta']['targetSize']) ?? 'medium',
      ...(campaign ? { campaign } : {}),
    },
    width,
    height,
    tiles,
    players,
    structures,
    units,
    ...(props.length > 0 ? { props } : {}),
    objectives: Array.isArray(r.objectives)
      ? r.objectives.filter((o): o is string => typeof o === 'string')
      : [],
    settings,
    ...(slots ? { slots } : {}),
    ...(mission ? { mission } : {}),
  };
}

export function scenarioToJson(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2);
}

export function cloneScenario(s: Scenario): Scenario {
  return parseScenario(JSON.parse(JSON.stringify(s)));
}

/* ------------------------------------------------------------------ */
/* Reachability                                                        */
/* ------------------------------------------------------------------ */

const NEIGHBOURS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function reachableFrom(
  scenario: Scenario,
  starts: Array<{ x: number; z: number }>,
  moveClass: MoveClass,
  blocked?: Uint8Array,
): Uint8Array {
  const { width, height, tiles } = scenario;
  const terrain = new Uint8Array(tiles.length);
  const elevation = new Uint8Array(tiles.length);
  const overlay = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    terrain[i] = tiles[i].t;
    elevation[i] = tiles[i].e;
    overlay[i] = tiles[i].v ?? 0;
  }
  const seen = new Uint8Array(tiles.length);
  const queue: number[] = [];
  for (const start of starts) {
    if (!inBounds(width, height, start.x, start.z)) continue;
    const i = tileIndex(width, start.x, start.z);
    if (blocked?.[i]) continue;
    if (!canStandOn(width, height, terrain, i, moveClass)) continue;
    if (!seen[i]) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % width;
    const cz = (cur / width) | 0;
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!inBounds(width, height, nx, nz)) continue;
      const ni = tileIndex(width, nx, nz);
      if (seen[ni] || blocked?.[ni]) continue;
      if (Math.abs(elevation[ni] - elevation[cur]) > ELEVATION_STEP[moveClass]) continue;
      const cost = moveCost(width, height, terrain, elevation, nx, nz, cx, cz, moveClass, overlay);
      if (!Number.isFinite(cost)) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return seen;
}

export function structureTiles(s: ScenarioStructure): Array<{ x: number; z: number }> {
  const def = BUILDINGS[s.defId];
  const out: Array<{ x: number; z: number }> = [];
  if (!def) return out;
  for (let dz = 0; dz < def.footprint.h; dz++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      out.push({ x: s.x + dx, z: s.z + dz });
    }
  }
  return out;
}

/**
 * Yaw that turns a water-dependent structure's slipway (its local +Z, where the
 * gate is built) toward the sea. The face with the most navigable water wins;
 * ties resolve +Z, +X, -Z, -X so a placement always looks the same.
 */
export function waterFacingFor(scenario: Scenario, s: ScenarioStructure): number {
  const def = BUILDINGS[s.defId];
  if (!def) return 0;
  const { w, h } = def.footprint;
  const faces: Array<{ dx: number; dz: number; facing: number; count: number }> = [
    { dx: 0, dz: 1, facing: 0, count: 0 },
    { dx: 1, dz: 0, facing: -Math.PI / 2, count: 0 },
    { dx: 0, dz: -1, facing: Math.PI, count: 0 },
    { dx: -1, dz: 0, facing: Math.PI / 2, count: 0 },
  ];
  const isWater = (x: number, z: number): boolean => {
    if (!inBounds(scenario.width, scenario.height, x, z)) return false;
    return isNavigable(scenario.tiles[tileIndex(scenario.width, x, z)].t);
  };
  for (const f of faces) {
    if (f.dx === 0) {
      const z = f.dz > 0 ? s.z + h : s.z - 1;
      for (let x = s.x; x < s.x + w; x++) if (isWater(x, z)) f.count++;
    } else {
      const x = f.dx > 0 ? s.x + w : s.x - 1;
      for (let z = s.z; z < s.z + h; z++) if (isWater(x, z)) f.count++;
    }
  }
  let best = faces[0];
  for (const f of faces) if (f.count > best.count) best = f;
  if (best.count > 0) return best.facing;
  // Water can be diagonal to the footprint (a yard on a spit or a pier corner).
  // No face sees it, so aim the gate at the nearest water tile rather than
  // leaving the slipway pointing inland.
  return facingTowardNearestWater(scenario, s);
}

/**
 * Facing that points the slipway at the nearest navigable tile when none of the
 * four footprint faces touch water. Falls back to +Z when the structure has no
 * water in its 8-neighbourhood at all (i.e. an incomplete placement).
 */
function facingTowardNearestWater(scenario: Scenario, s: ScenarioStructure): number {
  const def = BUILDINGS[s.defId];
  if (!def) return 0;
  const water = adjacentWater(scenario, s);
  if (water.length === 0) return 0;
  const cx = s.x + def.footprint.w / 2;
  const cz = s.z + def.footprint.h / 2;
  const best = [...water].sort((a, b) => {
    const da = dist2(a.x + 0.5, a.z + 0.5, cx, cz);
    const db = dist2(b.x + 0.5, b.z + 0.5, cx, cz);
    return da - db || a.z - b.z || a.x - b.x;
  })[0];
  const dx = best.x + 0.5 - cx;
  const dz = best.z + 0.5 - cz;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? -Math.PI / 2 : Math.PI / 2;
  return dz >= 0 ? 0 : Math.PI;
}

/** Adjacent water tiles (8-neighbourhood) around a building footprint. */
export function adjacentWater(
  scenario: Scenario,
  s: ScenarioStructure,
): Array<{ x: number; z: number }> {
  const def = BUILDINGS[s.defId];
  if (!def) return [];
  const water: Array<{ x: number; z: number }> = [];
  for (let z = s.z - 1; z <= s.z + def.footprint.h; z++) {
    for (let x = s.x - 1; x <= s.x + def.footprint.w; x++) {
      if (x >= s.x && x < s.x + def.footprint.w && z >= s.z && z < s.z + def.footprint.h) continue;
      if (!inBounds(scenario.width, scenario.height, x, z)) continue;
      const tile = scenario.tiles[tileIndex(scenario.width, x, z)];
      if (isNavigable(tile.t)) water.push({ x, z });
    }
  }
  return water;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Structures cannot be mined: a harvester that targets a deposit under a
 * footprint drives to the nearest open ground, never gets within mining reach,
 * and waits there forever. Ore and structures are authored separately, so every
 * assembled scenario passes through here and any tile inside a footprint loses
 * its material. Returns the number of tiles cleared.
 *
 * Structure coordinates are the top-left tile of the footprint, exactly as
 * `stampFootprint` reads them when the game builds its blocking grid.
 */
export function clearOreUnderStructures(scenario: Scenario): number {
  const { width, height, tiles } = scenario;
  let cleared = 0;
  for (const s of scenario.structures) {
    const footprint = BUILDINGS[s.defId]?.footprint;
    if (!footprint) continue;
    for (let dz = 0; dz < footprint.h; dz++) {
      for (let dx = 0; dx < footprint.w; dx++) {
        const x = s.x + dx;
        const z = s.z + dz;
        if (!inBounds(width, height, x, z)) continue;
        const i = tileIndex(width, x, z);
        if (tiles[i].o <= 0) continue;
        tiles[i].o = 0;
        cleared++;
      }
    }
  }
  return cleared;
}

export function validateScenario(scenario: Scenario): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (
    severity: ValidationIssue['severity'],
    code: string,
    message: string,
    x?: number,
    z?: number,
    entityRef?: string,
  ) => issues.push({ severity, code, message, x, z, entityRef });

  if (scenario.width < 16 || scenario.height < 16) {
    add('error', 'size-too-small', 'Map must be at least 16×16 tiles.');
  }
  if (scenario.players.length < 2) {
    add('error', 'players-missing', 'Add at least two players so the battle has an opponent.');
  }
  const teams = new Set(scenario.players.map((p) => p.team));
  if (scenario.players.length >= 2 && teams.size < 2) {
    add('error', 'teams-conflict', 'Both players are on the same team; no valid opponent exists.');
  }

  // Authored set dressing. A prop is decoration, so a misplaced one is a
  // warning rather than a refusal to load: the author is told where it is wrong,
  // and the battle still runs.
  if ((scenario.props ?? []).length > 0) {
    const paved = new Uint8Array(scenario.width * scenario.height);
    for (const structure of scenario.structures) {
      const def = BUILDINGS[structure.defId];
      if (!def) continue;
      for (let dz = 0; dz < def.footprint.h; dz++) {
        for (let dx = 0; dx < def.footprint.w; dx++) {
          const x = structure.x + dx;
          const z = structure.z + dz;
          if (inBounds(scenario.width, scenario.height, x, z)) {
            paved[tileIndex(scenario.width, x, z)] = 1;
          }
        }
      }
    }
    for (const prop of scenario.props ?? []) {
      const def = PROPS[prop.kind];
      if (!def) {
        add('warning', 'prop-unknown', `Unknown prop ${String(prop.kind)} will not be drawn.`);
        continue;
      }
      if (!inBounds(scenario.width, scenario.height, prop.x, prop.z)) {
        add('error', 'prop-out-of-bounds', `${def.name} is outside the map.`, prop.x, prop.z);
        continue;
      }
      const i = tileIndex(scenario.width, prop.x, prop.z);
      if (def.ground === 'land' && TERRAIN[scenario.tiles[i].t as TerrainId].water) {
        add(
          'warning',
          'prop-on-water',
          `${def.name} stands in water; place it on land or use reeds.`,
          prop.x,
          prop.z,
        );
      }
      if (paved[i]) {
        add(
          'warning',
          'prop-on-structure',
          `${def.name} stands on a structure's ground and will be hidden by it.`,
          prop.x,
          prop.z,
        );
      }
    }
  }

  // Player starts
  for (const p of scenario.players) {
    if (!inBounds(scenario.width, scenario.height, p.startX, p.startZ)) {
      add('error', 'start-out-of-bounds', `${p.name}'s start is outside the map.`, p.startX, p.startZ);
      continue;
    }
    const i = tileIndex(scenario.width, p.startX, p.startZ);
    const tile = scenario.tiles[i];
    if (TERRAIN[tile.t as TerrainId].water) {
      add('error', 'start-on-water', `${p.name}'s start is on water.`, p.startX, p.startZ);
    }
    if (
      tile.t === Terrain.Rock ||
      tile.t === Terrain.Forest ||
      tile.t === Terrain.Marsh ||
      tile.t === Terrain.Rocks ||
      tile.t === Terrain.Dune
    ) {
      add(
        'warning',
        'start-obstructed',
        `${p.name}'s start is on ${TERRAIN[tile.t as TerrainId].name.toLowerCase()} — deployment may be cramped.`,
        p.startX,
        p.startZ,
      );
    }
    const hq = scenario.structures.some((s) => s.owner === p.id && BUILDINGS[s.defId]?.commandPost);
    if (!hq) {
      add(
        'error',
        'hq-missing',
        `${p.name} has no Command Post. The destroy-HQ victory condition would end instantly.`,
      );
    }
    if (!scenario.units.some((u) => u.owner === p.id)) {
      add('warning', 'force-empty', `${p.name} has no starting units.`, p.startX, p.startZ);
    }
    const identity = tryIdentityDef(p.factionId);
    for (const techId of p.technologies ?? []) {
      const tech = TECHS[techId];
      if (!tech) {
        add(
          'error',
          'unknown-technology',
          `${p.name} is granted unknown technology "${techId}".`,
          p.startX,
          p.startZ,
        );
        continue;
      }
      if (tech.alliances && (!identity || !tech.alliances.includes(identity.allianceId))) {
        add(
          'error',
          'technology-alliance',
          `${tech.name} is not available to ${p.name}'s alliance.`,
          p.startX,
          p.startZ,
        );
      }
      if (tech.nations && !tech.nations.includes(p.factionId)) {
        add(
          'error',
          'technology-nation',
          `${tech.name} is not available to ${p.name}'s nation.`,
          p.startX,
          p.startZ,
        );
      }
    }
    // An operation that grants a technology it also forbids is an authoring
    // contradiction: the launch would either honour the grant or the limit, and
    // either answer silently overrules the file.
    const restrictedTechs = new Set(p.restrictions?.technologies ?? []);
    for (const techId of p.technologies ?? []) {
      if (restrictedTechs.has(techId)) {
        add(
          'error',
          'restriction-grant-conflict',
          `${p.name} is granted "${techId}" but the operation forbids it.`,
          p.startX,
          p.startZ,
        );
      }
    }
    // A restricted platform that is already on the map is legal but almost
    // always unintended, so it is reported rather than refused.
    const restrictedUnits = new Set(p.restrictions?.units ?? []);
    if (restrictedUnits.size > 0) {
      for (const unit of scenario.units) {
        if (unit.owner !== p.id) continue;
        if (!restrictedUnits.has(unit.defId) && !restrictedUnits.has(unitFamily(unit.defId))) {
          continue;
        }
        add(
          'warning',
          'restriction-placed-unit',
          `${p.name} starts with ${UNITS[unit.defId]?.name ?? unit.defId}, which the operation restricts.`,
          unit.x,
          unit.z,
        );
      }
    }
  }

  // Declared slots are authored start positions, not players: a competitive
  // map declares four so 1v1 and a future 2v2 read the same ground truth.
  scenario.slots?.forEach((slot, index) => {
    if (!inBounds(scenario.width, scenario.height, slot.x, slot.z)) {
      add('error', 'slot-out-of-bounds', `Start slot ${index} is outside the map.`, slot.x, slot.z);
      return;
    }
    const tile = scenario.tiles[tileIndex(scenario.width, slot.x, slot.z)];
    if (TERRAIN[tile.t as TerrainId].water) {
      add('error', 'slot-on-water', `Start slot ${index} is on water.`, slot.x, slot.z);
    }
  });

  // Structures: footprint validity, overlap, water requirements
  const occupied = new Int32Array(scenario.width * scenario.height).fill(-1);
  scenario.structures.forEach((s, si) => {
    const def = BUILDINGS[s.defId];
    if (!def) {
      add('error', 'unknown-building', `Unknown building "${s.defId}".`, s.x, s.z, `structures[${si}]`);
      return;
    }
    if (!inBounds(scenario.width, scenario.height, s.x, s.z)) {
      add('error', 'building-out-of-bounds', `${def.name} starts outside the map.`, s.x, s.z);
      return;
    }
    const tiles = structureTiles(s);
    let roadTiles = 0;
    for (const t of tiles) {
      if (!inBounds(scenario.width, scenario.height, t.x, t.z)) {
        add('error', 'building-overflow', `${def.name} extends beyond the map edge.`, s.x, s.z);
        continue;
      }
      const idx = tileIndex(scenario.width, t.x, t.z);
      const tile = scenario.tiles[idx];
      if (occupied[idx] >= 0) {
        add(
          'error',
          'building-overlap',
          `${def.name} overlaps another structure.`,
          t.x,
          t.z,
          `structures[${si}]`,
        );
      }
      occupied[idx] = si;
      if (tile.t === Terrain.Road) roadTiles++;
      if (def.walkable) {
        // A deck is laid across whatever the crossing runs over: channel, mud,
        // towpath or bank. Only its abutments need to be ground, and those are
        // the map's business, not a placement error.
      } else if (TERRAIN[tile.t as TerrainId].water) {
        // A span is authored over the channel it bridges: water under it is the
        // point, not a placement mistake.
        if (!def.waterStructure) {
          add('error', 'building-water', `${def.name} is placed on water.`, t.x, t.z);
        }
      } else if (!tileBuildable(tile.t, tile.v ?? 0)) {
        add(
          'error',
          'building-terrain',
          `${def.name} is on ${TERRAIN[tile.t as TerrainId].name.toLowerCase()}${overlayLabel(tile.v)}, which cannot be built on.`,
          t.x,
          t.z,
        );
      }
      if (tile.o > 0 && !def.walkable) {
        add(
          'warning',
          'building-on-ore',
          `${def.name} is covering a material deposit; that income will be unavailable.`,
          t.x,
          t.z,
        );
      }
    }
    if (def.garrison && roadTiles > 0) {
      add(
        'warning',
        'garrison-blocks-road',
        `${def.name} covers a road tile; check that the route remains passable and its garrison can be approached.`,
        s.x,
        s.z,
        `structures[${si}]`,
      );
    }
    if (def.requiresWater) {
      const water = adjacentWater(scenario, s);
      if (water.length === 0) {
        add(
          'error',
          'shipyard-water',
          `${def.name} has no adjacent navigable water. Place it against a deep-water coast.`,
          s.x,
          s.z,
          `structures[${si}]`,
        );
      } else {
        const reach = reachableFrom(scenario, water, 'naval');
        let navigableCount = 0;
        for (const v of reach) if (v) navigableCount++;
        if (navigableCount < 12) {
          add(
            'warning',
            'shipyard-isolated',
            `${def.name}'s adjacent water connects to only ${navigableCount} navigable tiles.`,
            s.x,
            s.z,
          );
        }
      }
    }
    const owner = scenario.players.find((p) => p.id === s.owner);
    if (!owner && s.owner !== -1) {
      add('warning', 'building-owner', `${def.name} is owned by unknown player ${s.owner}.`, s.x, s.z);
    }
  });

  // Strategic objective and garrison access. Reaching the approach tile is
  // what matters: a depot in a walled pocket is still capturable on paper but
  // useless in play.
  const structureBlocked = new Uint8Array(occupied.length);
  for (let i = 0; i < occupied.length; i++) structureBlocked[i] = occupied[i] >= 0 ? 1 : 0;
  const groundStarts = scenario.players.map((p) => ({ x: p.startX, z: p.startZ }));
  const trackedReach = reachableFrom(scenario, groundStarts, 'tracked', structureBlocked);
  const footReach = reachableFrom(scenario, groundStarts, 'foot', structureBlocked);
  const hasApproach = (s: { defId: string; x: number; z: number }, reach: Uint8Array): boolean => {
    const def = BUILDINGS[s.defId];
    if (!def) return false;
    for (let z = s.z - 1; z <= s.z + def.footprint.h; z++) {
      for (let x = s.x - 1; x <= s.x + def.footprint.w; x++) {
        const inside =
          x >= s.x && x < s.x + def.footprint.w && z >= s.z && z < s.z + def.footprint.h;
        if (inside) continue;
        if (!inBounds(scenario.width, scenario.height, x, z)) continue;
        if (reach[tileIndex(scenario.width, x, z)]) return true;
      }
    }
    return false;
  };
  scenario.structures.forEach((s, si) => {
    const def = BUILDINGS[s.defId];
    if (!def) return;
    if (def.capturable && !hasApproach(s, trackedReach)) {
      add(
        'warning',
        'objective-unreachable',
        `${def.name} has no tracked approach from any player start; Combat Engineers cannot capture it.`,
        s.x,
        s.z,
        `structures[${si}]`,
      );
    }
    if (def.garrison && !hasApproach(s, footReach)) {
      add(
        'warning',
        'garrison-inaccessible',
        `${def.name} has no reachable infantry entrance; its garrison cannot be used.`,
        s.x,
        s.z,
        `structures[${si}]`,
      );
    }
  });

  // Units
  const unitTiles = new Map<number, number>();
  scenario.units.forEach((u, ui) => {
    const def = UNITS[u.defId];
    if (!def) {
      add('error', 'unknown-unit', `Unknown unit "${u.defId}".`, u.x, u.z);
      return;
    }
    if (!inBounds(scenario.width, scenario.height, u.x, u.z)) {
      add('error', 'unit-out-of-bounds', `${def.name} starts outside the map.`, u.x, u.z);
      return;
    }
    const idx = tileIndex(scenario.width, u.x, u.z);
    if (occupied[idx] >= 0) {
      add('error', 'unit-in-building', `${def.name} spawns inside a structure.`, u.x, u.z);
    }
    if (unitTiles.has(idx)) {
      add('warning', 'unit-overlap', `${def.name} shares a tile with another starting unit.`, u.x, u.z);
    }
    unitTiles.set(idx, ui);
    const tile = scenario.tiles[idx];
    const standable = TERRAIN[tile.t as TerrainId].costs[def.moveClass];
    if (!Number.isFinite(standable)) {
      add(
        'error',
        'unit-terrain',
        `${def.name} cannot occupy ${TERRAIN[tile.t as TerrainId].name.toLowerCase()}.`,
        u.x,
        u.z,
      );
    }
    if (!scenario.players.some((p) => p.id === u.owner) && u.owner !== -1) {
      add('warning', 'unit-owner', `${def.name} is owned by unknown player ${u.owner}.`, u.x, u.z);
    }
  });

  // Victory feasibility
  for (const p of scenario.players) {
    const hq = scenario.structures.filter(
      (s) => s.owner === p.id && BUILDINGS[s.defId]?.commandPost,
    );
    if (hq.length > 1) {
      add('warning', 'hq-multiple', `${p.name} has ${hq.length} Command Posts.`);
    }
    if (p.isAI && hq.length === 0) {
      add('error', 'ai-hq-missing', `${p.name} (AI) needs a Command Post to be a valid opponent.`);
    }
  }
  if (scenario.settings.victory === 'destroyHQ') {
    const teamsWithHq = new Set(
      scenario.structures
        .filter((s) => {
          const def = BUILDINGS[s.defId];
          const player = scenario.players.find((p) => p.id === s.owner);
          return def?.commandPost && player;
        })
        .map((s) => scenario.players.find((p) => p.id === s.owner)!.team),
    );
    for (const team of teams) {
      if (!teamsWithHq.has(team)) {
        add('error', 'victory-impossible', `Team ${team} cannot win: no destructible Command Post.`);
      }
    }
  }
  if (scenario.settings.timeLimitSec !== null && scenario.settings.timeLimitSec < 60) {
    add('warning', 'time-limit-short', 'Time limit under 60 seconds is likely unwinnable.');
  }

  // Geography
  if (groundStarts.length >= 2) {
    const first = groundStarts[0];
    const reach = reachableFrom(scenario, [first], 'tracked');
    const others = groundStarts.slice(1);
    const allGroundConnected = others.every((s) => reach[tileIndex(scenario.width, s.x, s.z)]);
    if (!allGroundConnected) {
      const shipYards = scenario.structures.filter((s) => BUILDINGS[s.defId]?.requiresWater);
      let anyNaval = false;
      for (const sy of shipYards) {
        const water = adjacentWater(scenario, sy);
        const navalReach = reachableFrom(scenario, water, 'naval');
        for (let i = 0; i < navalReach.length; i++) if (navalReach[i]) anyNaval = true;
        if (anyNaval) break;
      }
      add(
        'warning',
        'starts-not-connected',
        anyNaval
          ? 'Player starts are not connected by land. Naval and air routes are required to engage.'
          : 'Player starts are not connected by land or usable water. Only aircraft could cross.',
      );
    }
  }

  // Ore reachability (from any refinery or player start, tracked/foot)
  const oreTiles: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < scenario.height; z++) {
    for (let x = 0; x < scenario.width; x++) {
      if (scenario.tiles[tileIndex(scenario.width, x, z)].o > 0) oreTiles.push({ x, z });
    }
  }
  if (oreTiles.length === 0) {
    add('warning', 'no-ore', 'There are no material deposits. The economy cannot grow.');
  } else {
    const refineryStarts = scenario.structures
      .filter((s) => BUILDINGS[s.defId]?.refinery || BUILDINGS[s.defId]?.commandPost)
      .map((s) => ({ x: s.x, z: s.z }));
    if (refineryStarts.length === 0) {
      add('warning', 'no-refinery', 'No refinery or Command Post: harvesters have nowhere to deliver.');
    } else {
      const reach = reachableFrom(scenario, refineryStarts, 'tracked');
      const reachableOre = oreTiles.filter((o) => reach[tileIndex(scenario.width, o.x, o.z)]).length;
      if (reachableOre === 0) {
        add('error', 'ore-unreachable', 'No material deposit is reachable from any refinery by ground.');
      } else if (reachableOre < oreTiles.length * 0.5) {
        add(
          'warning',
          'ore-partial',
          `Only ${reachableOre} of ${oreTiles.length} ore tiles are reachable by harvesters from refineries.`,
        );
      }
    }
  }

  // Strategic objectives
  const relays = scenario.structures.filter((s) => s.defId === 'relay');
  if (relays.length === 0) {
    add('info', 'no-relay', 'No signals relay: requisition will come only from command posts.');
  }
  const objectives = scenario.structures.filter((s) => BUILDINGS[s.defId]?.capturable);
  for (const objective of objectives) {
    if (objective.owner !== -1) {
      add(
        'warning',
        'objective-owned',
        `${BUILDINGS[objective.defId]?.name ?? 'Objective'} starts owned; objective sites usually begin neutral.`,
        objective.x,
        objective.z,
      );
    }
  }
  const depots = objectives.filter((s) => BUILDINGS[s.defId]?.matsPerSec);
  const radarStations = objectives.filter((s) => BUILDINGS[s.defId]?.scanRadius);
  if (depots.length > 0) {
    add(
      'info',
      'supply-depots',
      `${depots.length} forward supply depot${depots.length === 1 ? ' provides' : 's provide'} secondary materials when captured.`,
    );
  }
  if (radarStations.length > 0) {
    add(
      'info',
      'radar-stations',
      `${radarStations.length} radar station${radarStations.length === 1 ? ' provides' : 's provide'} reconnaissance when captured and powered.`,
    );
  }

  // Surface layer. An overlay that does not belong on its base terrain is a
  // design slip rather than a broken map, so it is a warning and reported once
  // per overlay/terrain pair instead of once per tile.
  const mismatched = new Map<string, { terrain: number; overlay: number; count: number }>();
  for (const tile of scenario.tiles) {
    const overlay = tile.v ?? 0;
    if (overlay <= 0) continue;
    if (overlayAllowedOn(overlay, tile.t)) continue;
    const key = `${tile.t}:${overlay}`;
    const entry = mismatched.get(key);
    if (entry) entry.count++;
    else mismatched.set(key, { terrain: tile.t, overlay, count: 1 });
  }
  for (const entry of mismatched.values()) {
    add(
      'warning',
      'overlay-unsupported',
      `${TERRAIN[entry.terrain as TerrainId].name} carries ${OVERLAYS[overlayIdOf(entry.overlay)].name.toLowerCase()} on ${entry.count} tile${entry.count === 1 ? '' : 's'}; that ground does not support it.`,
    );
  }

  // Authored placement keys are the identities mission documents resolve
  // against. Parse rejects duplicates in a JSON scenario; this pass also covers
  // scenarios assembled in code (the editor's working copy, fixtures).
  const entityKeys = new Set<string>();
  const keyOwner = new Map<string, string>();
  const claimKey = (key: string | undefined, path: string, x: number, z: number) => {
    if (!key) return;
    const prior = keyOwner.get(key);
    if (prior) {
      add(
        'error',
        'duplicate-authored-key',
        `Authored key "${key}" is used by both ${prior} and ${path}.`,
        x,
        z,
        path,
      );
      return;
    }
    keyOwner.set(key, path);
    entityKeys.add(key);
  };
  scenario.structures.forEach((s, i) => claimKey(s.key, `structures[${i}]`, s.x, s.z));
  scenario.units.forEach((u, i) => claimKey(u.key, `units[${i}]`, u.x, u.z));

  // Mission findings are reported with the map's own, tagged with the document
  // path. Parse already rejects error-severity mission problems; this pass exists
  // so authored warnings are visible where missions are validated and edited.
  if (scenario.mission) {
    for (const issue of validateMission(scenario.mission, {
      width: scenario.width,
      height: scenario.height,
      entityKeys,
    })) {
      add(
        issue.severity,
        `mission-${issue.code}`,
        `${issue.message} (${issue.path})`,
        undefined,
        undefined,
        issue.path,
      );
    }
  }

  return issues;
}

export function issuesBySeverity(issues: ValidationIssue[]): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
} {
  return {
    errors: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity === 'warning'),
    info: issues.filter((i) => i.severity === 'info'),
  };
}

/** Whether a scenario is safe to launch. */
export function canLaunch(scenario: Scenario): boolean {
  return !validateScenario(scenario).some((i) => i.severity === 'error');
}

/* ------------------------------------------------------------------ */
/* Placement checks (shared by editor previews and battle)             */
/* ------------------------------------------------------------------ */

export interface PlacementCheck {
  ok: boolean;
  code: string;
  reason: string;
}

/**
 * Terrain / overlap rules for buildings. Ownership, cost and build-radius
 * rules are simulation concerns and are layered on top by Game.
 */
export function checkPlacement(
  scenario: Scenario,
  defId: string,
  tileX: number,
  tileZ: number,
  occupied?: Uint8Array,
  /**
   * Live deposit amounts. The simulation passes its runtime ore field, because
   * a harvested tile stays an ore tile in the authored scenario forever and
   * would otherwise block building on ground the player has already cleared.
   * Authored checks (editor, scenario validation) omit it and read the tiles.
   */
  ore?: ArrayLike<number>,
): PlacementCheck {
  const def = BUILDINGS[defId];
  if (!def) return { ok: false, code: 'unknown', reason: 'Unknown structure type.' };
  let minElevation = 99;
  let maxElevation = 0;
  let waterCount = 0;
  for (let dz = 0; dz < def.footprint.h; dz++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const x = tileX + dx;
      const z = tileZ + dz;
      if (!inBounds(scenario.width, scenario.height, x, z)) {
        return { ok: false, code: 'bounds', reason: 'The footprint extends outside the map.' };
      }
      const i = tileIndex(scenario.width, x, z);
      if (occupied?.[i]) {
        return { ok: false, code: 'occupied', reason: 'A unit or structure already occupies this ground.' };
      }
      const tile = scenario.tiles[i];
      // A bridge deck is laid across whatever the crossing runs over — channel,
      // towpath, muddy bank — so its footprint is not held to buildable ground.
      if (def.walkable) {
        if (TERRAIN[tile.t as TerrainId].water) waterCount++;
        continue;
      }
      if (TERRAIN[tile.t as TerrainId].water) {
        waterCount++;
        if (!def.waterStructure) {
          return {
            ok: false,
            code: 'water',
            reason: 'This structure cannot be built on water. Move it inland or onto a suitable coast.',
          };
        }
      } else if (!tileBuildable(tile.t, tile.v ?? 0)) {
        return {
          ok: false,
          code: 'terrain',
          reason: `${TERRAIN[tile.t as TerrainId].name}${overlayLabel(tile.v)} cannot support this structure.`,
        };
      }
      if ((ore ? (ore[i] ?? 0) : tile.o) > 0) {
        return { ok: false, code: 'ore', reason: 'Clear the material deposit before building here.' };
      }
      minElevation = Math.min(minElevation, tile.e);
      maxElevation = Math.max(maxElevation, tile.e);
    }
  }
  // A deck spans banks that are not level by definition; every other structure
  // needs a flat foundation.
  if (!def.walkable && minElevation !== maxElevation) {
    return { ok: false, code: 'slope', reason: 'The foundation must be level; flatten this terrain first.' };
  }
  if (waterCount > 0 && !def.waterStructure) {
    return { ok: false, code: 'water', reason: 'The footprint overlaps water.' };
  }
  if (def.requiresWater) {
    const fake: ScenarioStructure = { defId, owner: 0, x: tileX, z: tileZ };
    if (adjacentWater(scenario, fake).length === 0) {
      return {
        ok: false,
        code: 'water-access',
        reason: 'Shipyards need navigable water directly alongside the footprint.',
      };
    }
  }
  return { ok: true, code: 'ok', reason: 'Placement valid.' };
}

/** Human-readable victory text for the HUD. */
export function victoryDescription(scenario: Scenario, playerId = PLAYER): string {
  if (scenario.settings.victory === 'annihilation') {
    return 'Destroy every enemy unit and structure.';
  }
  const enemy = scenario.players.find((p) => p.id !== playerId && p.team !== scenario.players[playerId]?.team);
  return enemy
    ? `Destroy the ${identityLabel(enemy.factionId) || 'enemy'} Command Post.`
    : 'Destroy the enemy Command Post.';
}
