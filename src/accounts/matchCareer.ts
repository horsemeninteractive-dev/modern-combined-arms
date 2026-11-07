/**
 * Authoritative multiplayer career rewards.
 *
 * The room service owns the simulation, so it also owns the facts of a finished
 * match: who played, which team won, how long it ran and what each side did. The
 * account Worker recomputes XP from those facts with `mpReward` and never reads a
 * value the client supplied. This module is the single definition of what a
 * completed online match is worth, imported by the room (to report the result),
 * the account Worker (to award it) and the tests.
 *
 * The formula is additive and capped so it is explainable in one line:
 *
 *   xp = round( (120 participation
 *              + 40 completion
 *              + min(60, minutes played)
 *              + min(30, 5 × strategic sites captured)
 *              + min(25, units destroyed / 8)) × outcome )
 *
 * with outcome 1.0 victory, 0.6 draw, 0.4 defeat, and a hard ceiling of 300.
 * A defeat pays less than a victory but never nothing: abandoning a losing match
 * must not be better than finishing it.
 *
 * Guard rails against trivial farming, in order of strength:
 *   - a match must have run at least three minutes and seen some activity;
 *   - only the first `MP_MAX_DAILY_REWARDS` eligible matches of a UTC day pay,
 *     which is far above real play and far below automation;
 *   - duration and performance components are capped, so one long or one busy
 *     match cannot dwarf normal progression.
 * There is deliberately no collusion detection: the caps above bound the damage
 * and a hidden rating belongs to a later phase.
 */

export const MP_REWARD_VERSION = 1;
export const MP_MIN_DURATION_SECONDS = 180;
export const MP_MAX_DAILY_REWARDS = 12;
export const MP_MAX_XP = 300;
export const MP_MAX_STAT = 5_000;

const BASE_PARTICIPATION = 120;
const COMPLETION_BONUS = 40;
const MAX_DURATION_BONUS = 60;
const OBJECTIVE_STEP = 5;
const MAX_OBJECTIVE_BONUS = 30;
const PERFORMANCE_DIVISOR = 8;
const MAX_PERFORMANCE_BONUS = 25;

export type MpOutcome = 'victory' | 'defeat' | 'draw';
export type MpRewardStatus = 'awarded' | 'capped' | 'ineligible';

export interface MpPlayerStats {
  unitsDestroyed: number;
  unitsLost: number;
  structuresDestroyed: number;
  structuresLost: number;
  structuresBuilt: number;
  sitesCaptured: number;
  superweaponsUsed: number;
  objectivesCompleted: number;
}

export interface MpPlayerResult {
  accountId: string | null;
  team: number;
  nation: string | null;
  callsign: string | null;
  avatar: string | null;
  stats: MpPlayerStats;
}

export interface MpMatchResult {
  /** `mp:<roomId>:<startedAtMs>` — stable, unique and derived from the room. */
  matchId: string;
  roomId: string;
  mapId: string | null;
  startedAtMs: number;
  finishedAtMs: number;
  winnerTeam: number | null;
  players: MpPlayerResult[];
}

export interface RewardBreakdown {
  version: number;
  status: MpRewardStatus;
  base: number;
  completion: number;
  duration: number;
  objectives: number;
  performance: number;
  outcomeFactor: number;
  subtotal: number;
  xp: number;
  /** Human-readable reason for a `capped` or `ineligible` outcome. */
  reason: string | null;
}

const MATCH_ID_PATTERN = /^mp:[A-Za-z0-9_-]{1,64}:\d{1,16}$/;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAP_ID_PATTERN = /^[a-z0-9_-]{1,48}$/;
const NATION_PATTERN = /^[a-z0-9-]{1,32}$/;
const MAX_MATCH_SECONDS = 8 * 60 * 60;

export function matchIdFor(roomId: string, startedAtMs: number): string {
  return `mp:${roomId}:${Math.max(0, Math.floor(startedAtMs))}`;
}

export function isMatchId(value: unknown): value is string {
  return typeof value === 'string' && MATCH_ID_PATTERN.test(value);
}

function integer(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  if (rounded < 0) return 0;
  return Math.min(max, rounded);
}

function statValue(value: unknown): number {
  return integer(value, 0, MP_MAX_STAT);
}

export function emptyStats(): MpPlayerStats {
  return {
    unitsDestroyed: 0,
    unitsLost: 0,
    structuresDestroyed: 0,
    structuresLost: 0,
    structuresBuilt: 0,
    sitesCaptured: 0,
    superweaponsUsed: 0,
    objectivesCompleted: 0,
  };
}

/**
 * Bounded statistics from a locally played match. These are presentation data
 * for the service record; XP for local play never depends on them.
 */
export function parseExtraStats(raw: unknown): MpPlayerStats {
  if (typeof raw !== 'object' || raw === null) return emptyStats();
  const record = raw as Record<string, unknown>;
  return {
    unitsDestroyed: statValue(record.unitsDestroyed),
    unitsLost: statValue(record.unitsLost),
    structuresDestroyed: statValue(record.structuresDestroyed),
    structuresLost: statValue(record.structuresLost),
    structuresBuilt: statValue(record.structuresBuilt),
    sitesCaptured: statValue(record.sitesCaptured),
    superweaponsUsed: statValue(record.superweaponsUsed),
    objectivesCompleted: statValue(record.objectivesCompleted),
  };
}

export type MpParseResult =
  | { ok: true; value: MpMatchResult }
  | { ok: false; message: string };

/**
 * Validate a result body posted by the room service.
 *
 * Everything is bounded: the ids, the two seats, the timestamps and every
 * statistic. A body that fails here is refused outright rather than trimmed into
 * something plausible, because a malformed result is evidence of a bug or a
 * forgery, not of a slightly unusual match.
 */
export function parseMpResult(raw: unknown, now: number): MpParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'A result must be an object.' };
  }
  const body = raw as Record<string, unknown>;
  const matchId = body.matchId;
  if (!isMatchId(matchId)) return { ok: false, message: 'Match id is not valid.' };
  const roomId = body.roomId;
  if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) {
    return { ok: false, message: 'Room id is not valid.' };
  }
  if (!matchId.startsWith(`mp:${roomId}:`)) {
    return { ok: false, message: 'Match id does not belong to that room.' };
  }
  let mapId: string | null = null;
  if (body.mapId !== undefined && body.mapId !== null) {
    if (typeof body.mapId !== 'string' || !MAP_ID_PATTERN.test(body.mapId)) {
      return { ok: false, message: 'Map id is not valid.' };
    }
    mapId = body.mapId;
  }
  const startedAtMs = integer(body.startedAtMs, -1);
  if (startedAtMs <= 0) return { ok: false, message: 'Match start time is not valid.' };
  const finishedAtMs = integer(body.finishedAtMs, -1);
  if (finishedAtMs <= 0) return { ok: false, message: 'Match finish time is not valid.' };
  if (finishedAtMs < startedAtMs) {
    return { ok: false, message: 'Match finishes before it starts.' };
  }
  // The match id embeds the start time; a mismatch means the two halves of the
  // report came from different matches.
  if (matchId !== matchIdFor(roomId, startedAtMs)) {
    return { ok: false, message: 'Match id disagrees with the reported start time.' };
  }
  const durationSeconds = Math.round((finishedAtMs - startedAtMs) / 1000);
  if (durationSeconds > MAX_MATCH_SECONDS) {
    return { ok: false, message: 'Match duration is not credible.' };
  }
  if (finishedAtMs > now + 10 * 60_000) {
    return { ok: false, message: 'Match finish time is in the future.' };
  }
  let winnerTeam: number | null = null;
  if (body.winnerTeam !== undefined && body.winnerTeam !== null) {
    const winner = integer(body.winnerTeam, -1);
    if (winner !== 0 && winner !== 1) return { ok: false, message: 'Winner team is not valid.' };
    winnerTeam = winner;
  }
  if (!Array.isArray(body.players) || body.players.length !== 2) {
    return { ok: false, message: 'A 1v1 result must report both seats.' };
  }
  const players: MpPlayerResult[] = [];
  const seen = new Set<string>();
  const teams = new Set<number>();
  for (const entry of body.players) {
    if (typeof entry !== 'object' || entry === null) return { ok: false, message: 'A seat is not valid.' };
    const seat = entry as Record<string, unknown>;
    const team = integer(seat.team, -1);
    if (team !== 0 && team !== 1) return { ok: false, message: 'Seat team is not valid.' };
    teams.add(team);
    let accountId: string | null = null;
    if (seat.accountId !== undefined && seat.accountId !== null) {
      if (typeof seat.accountId !== 'string' || !ID_PATTERN.test(seat.accountId)) {
        return { ok: false, message: 'Seat account is not valid.' };
      }
      if (seen.has(seat.accountId)) return { ok: false, message: 'The same account occupies both seats.' };
      seen.add(seat.accountId);
      accountId = seat.accountId;
    }
    let nation: string | null = null;
    if (seat.nation !== undefined && seat.nation !== null) {
      if (typeof seat.nation !== 'string' || !NATION_PATTERN.test(seat.nation)) {
        return { ok: false, message: 'Seat nation is not valid.' };
      }
      nation = seat.nation;
    }
    const rawStats = (seat.stats ?? {}) as Record<string, unknown>;
    players.push({
      accountId,
      team,
      nation,
      callsign: typeof seat.callsign === 'string' ? seat.callsign.slice(0, 32) : null,
      avatar: typeof seat.avatar === 'string' ? seat.avatar.slice(0, 16) : null,
      stats: {
        unitsDestroyed: statValue(rawStats.unitsDestroyed),
        unitsLost: statValue(rawStats.unitsLost),
        structuresDestroyed: statValue(rawStats.structuresDestroyed),
        structuresLost: statValue(rawStats.structuresLost),
        structuresBuilt: statValue(rawStats.structuresBuilt),
        sitesCaptured: statValue(rawStats.sitesCaptured),
        superweaponsUsed: statValue(rawStats.superweaponsUsed),
        objectivesCompleted: statValue(rawStats.objectivesCompleted),
      },
    });
  }
  if (teams.size !== 2) return { ok: false, message: 'Both seats must be on opposite teams.' };
  return {
    ok: true,
    value: { matchId, roomId, mapId, startedAtMs, finishedAtMs, winnerTeam, players },
  };
}

export function matchDurationSeconds(result: MpMatchResult): number {
  return Math.max(0, Math.round((result.finishedAtMs - result.startedAtMs) / 1000));
}

export function outcomeFor(result: MpMatchResult, team: number): MpOutcome {
  if (result.winnerTeam === null) return 'draw';
  return result.winnerTeam === team ? 'victory' : 'defeat';
}

/**
 * The gameplay bar a match must clear before it can pay anything. The result is
 * still recorded when it fails: the service record should show the match, only
 * without a reward.
 */
export function eligibilityReason(
  result: MpMatchResult,
  player: MpPlayerResult,
): string | null {
  if (!player.accountId) return 'No signed-in account occupied that seat.';
  if (matchDurationSeconds(result) < MP_MIN_DURATION_SECONDS) {
    return `Matches shorter than ${MP_MIN_DURATION_SECONDS / 60} minutes do not award career XP.`;
  }
  const activity =
    player.stats.unitsDestroyed +
    player.stats.structuresBuilt +
    player.stats.objectivesCompleted +
    player.stats.sitesCaptured;
  if (activity === 0) return 'No gameplay activity was recorded for that seat.';
  return null;
}

export interface RewardInput {
  outcome: MpOutcome;
  durationSeconds: number;
  stats: MpPlayerStats;
  /** Eligible authoritative matches already rewarded for this account today. */
  rewardedToday: number;
  ineligibleReason?: string | null;
}

/**
 * XP for one authoritative match. Pure and deterministic: the same report always
 * produces the same award, which is what makes a replay safe to reconcile.
 */
export function mpReward(input: RewardInput): RewardBreakdown {
  const durationSeconds = Math.max(0, Math.floor(input.durationSeconds));
  const outcomeFactor = input.outcome === 'victory' ? 1 : input.outcome === 'draw' ? 0.6 : 0.4;
  const base = BASE_PARTICIPATION;
  const completion = COMPLETION_BONUS;
  const duration = Math.min(MAX_DURATION_BONUS, Math.floor(durationSeconds / 60));
  const objectives = Math.min(
    MAX_OBJECTIVE_BONUS,
    Math.max(0, Math.floor(input.stats.sitesCaptured)) * OBJECTIVE_STEP,
  );
  const performance = Math.min(
    MAX_PERFORMANCE_BONUS,
    Math.floor(Math.max(0, Math.floor(input.stats.unitsDestroyed)) / PERFORMANCE_DIVISOR),
  );
  const subtotal = base + completion + duration + objectives + performance;
  const breakdown: RewardBreakdown = {
    version: MP_REWARD_VERSION,
    status: 'awarded',
    base,
    completion,
    duration,
    objectives,
    performance,
    outcomeFactor,
    subtotal,
    xp: Math.min(MP_MAX_XP, Math.max(0, Math.round(subtotal * outcomeFactor))),
    reason: null,
  };
  if (input.ineligibleReason) {
    return { ...breakdown, status: 'ineligible', xp: 0, reason: input.ineligibleReason };
  }
  if (input.rewardedToday >= MP_MAX_DAILY_REWARDS) {
    return {
      ...breakdown,
      status: 'capped',
      xp: 0,
      reason: `The first ${MP_MAX_DAILY_REWARDS} online matches each day award career XP.`,
    };
  }
  return breakdown;
}

/** The reward summary a post-match screen renders from the stored decision. */
export interface MatchRewardSummary {
  xp: number;
  status: MpRewardStatus;
  reason: string | null;
  breakdown: RewardBreakdown | null;
  xpBefore: number;
  xpAfter: number;
}
