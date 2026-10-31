/**
 * Authoritative lobby configuration for a human 1v1 room.
 *
 * This is the pre-match counterpart to `RoomSnapshot`: it is small, versioned,
 * lives in the room's durable metadata, and is the only input used to build the
 * authoritative `Game` when the host starts the match. Nothing here is derived
 * from a client beyond validated identifiers: a client may name a map, a nation
 * and a colour, and each is checked against the catalogue the simulation itself
 * uses, never against a client-supplied definition.
 *
 * Phase 2B.1 deliberately keeps the editing API out of scope. The model exists
 * so the lifecycle can persist, validate and consume a configuration, and so
 * the next phase has a contract to edit rather than invent.
 */
import { BUILTIN_SCENARIOS, builtinScenario } from '../data/scenarios';
import {
  PLAYABLE_NATION_IDS,
  defaultNationFor,
  isKnownFactionId,
  tryIdentityDef,
} from '../data/factions';
import type { Scenario } from '../sim/scenario';

export const LOBBY_CONFIG_VERSION = 1 as const;

/**
 * The lobby window is real capacity time: a room holds a reservation from
 * creation, so the wait before the host starts is spent out of the same
 * allowance. A match may only start when the whole configured duration still
 * fits inside the reservation's hard deadline.
 */
export const MIN_MATCH_DURATION_MS = 60_000;
export const MAX_MATCH_DURATION_MS = 30 * 60 * 1000;
export const DEFAULT_MATCH_DURATION_MS = 10 * 60 * 1000;

/**
 * Supported player colours. These are presentation identities only; the room
 * validates membership so a browser cannot introduce an arbitrary colour, and
 * requires the two seats to differ so the minimap and unit tint stay readable.
 */
export const LOBBY_COLORS = [
  '#3f8fd2',
  '#c8503f',
  '#4fae72',
  '#d8a63f',
  '#8f6ad8',
  '#3fb6b0',
  '#c85a9e',
  '#9aa3ab',
] as const;

export type LobbyColor = (typeof LOBBY_COLORS)[number];

export interface LobbySeatConfig {
  /** Playable nation identifier from the authoritative faction catalogue. */
  nation: string;
  /** Display colour from `LOBBY_COLORS`. */
  color: string;
  ready: boolean;
}

export interface LobbyConfigV1 {
  version: typeof LOBBY_CONFIG_VERSION;
  mapId: string;
  matchDurationMs: number;
  /** Indexed by seat id, so seat 0 is always the host's own configuration. */
  seats: LobbySeatConfig[];
}

export type LobbyErrorCode =
  | 'invalid-lobby'
  | 'unsupported-lobby-version'
  | 'invalid-map'
  | 'invalid-duration'
  | 'invalid-nation'
  | 'invalid-colour'
  | 'duplicate-colour';

export interface LobbyProblem {
  code: LobbyErrorCode;
  message: string;
}

export type LobbyParseResult =
  | { ok: true; config: LobbyConfigV1 }
  | { ok: false; problem: LobbyProblem };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPlayableMapId(mapId: unknown): mapId is string {
  return typeof mapId === 'string' && BUILTIN_SCENARIOS.some((entry) => entry.id === mapId);
}

export function isLobbyColor(value: unknown): value is LobbyColor {
  return typeof value === 'string' && (LOBBY_COLORS as readonly string[]).includes(value);
}

export function isLobbyNation(value: unknown): value is string {
  return typeof value === 'string' && isKnownFactionId(value);
}

export function isValidMatchDuration(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_MATCH_DURATION_MS &&
    value <= MAX_MATCH_DURATION_MS
  );
}

/**
 * A seat always starts on a *nation*, never on an alliance preset. Built-in
 * maps still declare their sides as presets (`baltic`, `expeditionary`), which
 * are legal faction ids but not something a player can pick in the lobby, so a
 * preset is resolved to the first nation of its alliance. A default lobby is
 * therefore both legal and displayable on every map.
 */
function playableNationId(factionId: string | undefined, fallback: string): string {
  if (factionId && (PLAYABLE_NATION_IDS as readonly string[]).includes(factionId)) return factionId;
  const identity = factionId ? tryIdentityDef(factionId) : undefined;
  if (identity) {
    const nation = defaultNationFor(identity.allianceId);
    if (nation) return nation.id;
  }
  return fallback;
}

function defaultNations(mapId: string): [string, string] {
  const scenario = builtinScenario(mapId).create();
  return [
    playableNationId(scenario.players[0]?.factionId, 'lithuania'),
    playableNationId(scenario.players[1]?.factionId, 'russia'),
  ];
}

/**
 * A room is created with a duration from its capacity reservation. The lobby
 * default is that duration when it is legal, otherwise the standard default, so
 * a room never starts life with a configuration the validator would reject.
 */
export function defaultLobbyConfig(
  mapId: string = BUILTIN_SCENARIOS[0].id,
  matchDurationMs: number = DEFAULT_MATCH_DURATION_MS,
): LobbyConfigV1 {
  const safeMap = isPlayableMapId(mapId) ? mapId : BUILTIN_SCENARIOS[0].id;
  const duration = isValidMatchDuration(matchDurationMs)
    ? matchDurationMs
    : DEFAULT_MATCH_DURATION_MS;
  const [hostNation, guestNation] = defaultNations(safeMap);
  return {
    version: LOBBY_CONFIG_VERSION,
    mapId: safeMap,
    matchDurationMs: duration,
    seats: [
      { nation: hostNation, color: LOBBY_COLORS[0], ready: false },
      { nation: guestNation, color: LOBBY_COLORS[1], ready: false },
    ],
  };
}

/** Strict parse. Invalid configuration is rejected, never silently repaired. */
export function validateLobbyConfig(raw: unknown): LobbyParseResult {
  if (!isRecord(raw)) {
    return { ok: false, problem: { code: 'invalid-lobby', message: 'Lobby configuration is not an object.' } };
  }
  if (raw.version !== LOBBY_CONFIG_VERSION) {
    return {
      ok: false,
      problem: {
        code: 'unsupported-lobby-version',
        message: `Unsupported lobby configuration version ${String(raw.version)}.`,
      },
    };
  }
  if (!isPlayableMapId(raw.mapId)) {
    return { ok: false, problem: { code: 'invalid-map', message: 'Selected map is not in the multiplayer catalogue.' } };
  }
  if (!isValidMatchDuration(raw.matchDurationMs)) {
    return { ok: false, problem: { code: 'invalid-duration', message: 'Match duration is outside the allowed range.' } };
  }
  if (!Array.isArray(raw.seats) || raw.seats.length !== 2) {
    return { ok: false, problem: { code: 'invalid-lobby', message: 'Lobby must describe exactly two seats.' } };
  }
  const seats: LobbySeatConfig[] = [];
  for (let index = 0; index < 2; index++) {
    const seat = raw.seats[index];
    if (!isRecord(seat)) {
      return { ok: false, problem: { code: 'invalid-lobby', message: `Seat ${index} is malformed.` } };
    }
    if (!isLobbyNation(seat.nation)) {
      return { ok: false, problem: { code: 'invalid-nation', message: `Seat ${index} nation is not playable.` } };
    }
    if (!isLobbyColor(seat.color)) {
      return { ok: false, problem: { code: 'invalid-colour', message: `Seat ${index} colour is not in the supported palette.` } };
    }
    if (typeof seat.ready !== 'boolean') {
      return { ok: false, problem: { code: 'invalid-lobby', message: `Seat ${index} readiness is malformed.` } };
    }
    seats.push({ nation: seat.nation, color: seat.color, ready: seat.ready });
  }
  if (seats[0].color === seats[1].color) {
    return { ok: false, problem: { code: 'duplicate-colour', message: 'Both seats cannot use the same colour.' } };
  }
  return {
    ok: true,
    config: {
      version: LOBBY_CONFIG_VERSION,
      mapId: raw.mapId,
      matchDurationMs: raw.matchDurationMs,
      seats,
    },
  };
}

/** Convenience for `validatePersistedMeta`, which reports a string. */
export function lobbyConfigProblem(raw: unknown): string | null {
  const parsed = validateLobbyConfig(raw);
  return parsed.ok ? null : `${parsed.problem.code}: ${parsed.problem.message}`;
}

/**
 * Build the authoritative scenario for the match. This runs only after the host
 * has asked to start and every condition has passed; it reads nothing from a
 * client beyond the already-validated lobby configuration.
 */
export function buildLobbyScenario(config: LobbyConfigV1): Scenario {
  const scenario = builtinScenario(config.mapId).create();
  scenario.settings.fog = true;
  // The authoritative deadline is derived from this duration at start; the
  // scenario's own timer is kept consistent with it so a saved match and a live
  // match agree about how long they are.
  scenario.settings.timeLimitSec = Math.max(1, Math.ceil(config.matchDurationMs / 1000));
  for (let index = 0; index < scenario.players.length && index < 2; index++) {
    const player = scenario.players[index];
    player.isAI = false;
    const seat = config.seats[index];
    player.factionId = seat.nation;
    player.color = seat.color;
  }
  return scenario;
}

export interface StartCondition {
  code: string;
  message: string;
}

export interface StartConditionInput {
  /** The two seats, in seat order: whether each has joined and is connected now. */
  seats: Array<{ joined: boolean; connected: boolean }>;
  config: LobbyConfigV1 | null;
  /** Reservation hard deadline, or null when the reservation is not usable. */
  hardDeadlineAt: number | null;
  /** True once the reservation has been released. */
  released: boolean;
  now: number;
}

/**
 * Every precondition for an explicit start, in check order. The first failure
 * is the response code, so each check is independently testable. Occupancy and
 * connectivity are separate: a seat that has never joined cannot start a match
 * even if a socket is somehow open, and a joined seat that is offline blocks the
 * start while reconnection is still possible.
 */
export function startConditions(input: StartConditionInput): StartCondition[] {
  const problems: StartCondition[] = [];
  if (input.released) {
    problems.push({ code: 'reservation-inactive', message: 'This room no longer holds a capacity reservation.' });
  }
  if (!input.config) {
    problems.push({ code: 'lobby-invalid', message: 'The room has no valid lobby configuration.' });
  }
  if (!input.seats[0]?.joined || !input.seats[1]?.joined) {
    problems.push({ code: 'seat-empty', message: 'Both seats must be occupied before the match can start.' });
  }
  // An empty seat is already reported above; this is specifically a player who
  // has claimed a seat and is offline right now.
  if (input.seats.some((seat) => seat.joined && !seat.connected)) {
    problems.push({ code: 'seat-disconnected', message: 'Both players must be connected to start.' });
  }
  if (input.config && (!input.config.seats[0].ready || !input.config.seats[1].ready)) {
    problems.push({ code: 'not-ready', message: 'Both players must be ready.' });
  }
  if (input.config) {
    const parsed = validateLobbyConfig(input.config);
    if (!parsed.ok) problems.push({ code: parsed.problem.code, message: parsed.problem.message });
    else if (input.hardDeadlineAt !== null) {
      // A lobby holds capacity time: the whole match must still fit inside the
      // reservation, or the room would run past its guaranteed window.
      if (input.now + parsed.config.matchDurationMs > input.hardDeadlineAt) {
        problems.push({
          code: 'match-window-expired',
          message: 'Not enough reserved time remains for the selected match duration.',
        });
      }
    }
  }
  return problems;
}
