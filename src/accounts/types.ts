/**
 * Account domain vocabulary and the store port.
 *
 * The port is deliberately narrow and synchronous-shaped (promises only, no
 * SQL, no Cloudflare types): the D1 implementation lives beside it, and the
 * tests use an in-memory implementation of exactly the same contract. That is
 * what lets the OAuth, session and migration rules be exercised for real rather
 * than against a mock of HTTP.
 */

import type { CareerMatchRecord, CareerMode, CareerTotals } from './career';
import type { AvatarId } from './identity';
import type { MatchRewardSummary, MpRewardStatus } from './matchCareer';
import type {
  OutbreakBoardDifficulty,
  OutbreakBoardMode,
  OutbreakRunRecord,
} from './outbreakBoard';
import type { StatGroupRow } from './stats';

export type ProviderId = 'google' | 'discord';
export type AccountStatus = 'active' | 'suspended' | 'deleted';
export type MigrationState = 'pending' | 'complete' | 'conflict';

export const PROVIDERS: readonly ProviderId[] = ['google', 'discord'];

export interface AccountRecord {
  id: string;
  createdAt: number;
  status: AccountStatus;
  lastAuthAt: number | null;
}

export interface IdentityRecord {
  accountId: string;
  provider: ProviderId;
  subject: string;
  displayName: string | null;
  avatarUrl: string | null;
  linkedAt: number;
}

export interface SessionRecord {
  id: string;
  accountId: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface GuestMigrationRecord {
  guestId: string;
  accountId: string;
  state: MigrationState;
  migrationKey: string;
  profileDigest: string;
  createdAt: number;
  completedAt: number | null;
}

/** A player's presentable identity. The account id remains the stable key. */
export interface PlayerProfileRecord {
  accountId: string;
  callsign: string;
  /** Folded, unique form of the callsign. */
  callsignKey: string;
  avatar: AvatarId;
  createdAt: number;
  updatedAt: number;
  callsignChangedAt: number | null;
}

/**
 * The match report behind one ledger row. Extended statistics are separate from
 * the XP ledger because they are presentation and audit data, not currency: the
 * ledger alone decides a career's XP and rank.
 */
export interface MatchReportRecord {
  ref: string;
  mode: 'campaign' | 'skirmish' | 'multiplayer';
  mapId: string | null;
  opponentAccountId: string | null;
  opponentCallsign: string | null;
  opponentNation: string | null;
  durationSeconds: number;
  unitsDestroyed: number;
  unitsLost: number;
  structuresDestroyed: number;
  structuresLost: number;
  structuresBuilt: number;
  sitesCaptured: number;
  superweaponsUsed: number;
  objectivesCompleted: number;
  rewardVersion: number;
  rewardStatus: 'awarded' | 'capped' | 'ineligible' | 'local';
  breakdown: MatchRewardSummary['breakdown'];
  xpBefore: number;
  xpAfter: number;
  recordedAt: number;
}

/** One player's side of an authoritative result, kept for audit. */
export interface MpResultPlayerRecord {
  matchId: string;
  accountId: string;
  roomId: string;
  team: number;
  outcome: 'victory' | 'defeat' | 'draw';
  nation: string | null;
  rewardVersion: number;
  xpAwarded: number;
  status: MpRewardStatus;
  processedAt: number;
}

/**
 * Everything one completed match writes: the ledger row that pays, the report
 * that explains it and the audit row that proves the room said so. They are one
 * write on purpose, so a crash cannot leave XP without its report.
 */
/** One saved command-flag design, exactly as the account stores it. */
export interface PlayerFlagRecord {
  accountId: string;
  designId: string;
  name: string;
  /** Validated composition, serialised. Parsed again on every read. */
  composition: string;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
}

/** The active flag plus equipped profile cosmetics, one row per account. */
export interface PlayerPresentationRecord {
  accountId: string;
  activeDesignId: string | null;
  frame: string | null;
  background: string | null;
  camo: string | null;
  revision: number;
  updatedAt: number;
}

/**
 * The complete player-identity document: saved designs, active design and
 * equipped cosmetics with one revision. It is persisted as a single row so a
 * concurrent writer can never split designs from the selection that names them.
 */
export interface PlayerIdentityDocument {
  designs: PlayerFlagRecord[];
  activeDesignId: string | null;
  frame: string | null;
  background: string | null;
  camo: string | null;
  revision: number;
  updatedAt: number;
}

export interface CareerEntryWrite {
  accountId: string;
  record: CareerMatchRecord;
  report: MatchReportRecord | null;
  audit: MpResultPlayerRecord | null;
}

/** One earned commendation. Unique on `(accountId, achievementId)`. */
export interface CareerAchievementRecord {
  accountId: string;
  achievementId: string;
  awardedAt: number;
  matchRef: string | null;
}

export interface AchievementAwardWrite {
  achievementId: string;
  awardedAt: number;
  matchRef: string | null;
}

/** A campaign is complete only once; the unique key is account + campaign. */
export interface CareerCampaignRecord {
  accountId: string;
  campaignId: string;
  completedAt: number;
}

export interface NewIdentity {
  accountId: string;
  provider: ProviderId;
  subject: string;
  displayName: string | null;
  avatarUrl: string | null;
  now: number;
}

/** Every write either succeeded or lost a uniqueness race. Never a throw. */
export type WriteOutcome = 'ok' | 'conflict';

/**
 * One account store. Implementations must enforce uniqueness on
 * `(provider, subject)`, `token_hash`, `guest_id` and `account_id` in the
 * migration ledger; the routes additionally pre-check so the common case is a
 * clean error rather than a caught constraint violation.
 */
export interface AccountStore {
  createAccount(input: { id: string; now: number }): Promise<void>;
  account(id: string): Promise<AccountRecord | null>;
  touchAccountAuth(id: string, now: number): Promise<void>;
  attachIdentity(identity: NewIdentity): Promise<WriteOutcome>;
  identity(provider: ProviderId, subject: string): Promise<IdentityRecord | null>;
  identities(accountId: string): Promise<IdentityRecord[]>;
  detachIdentity(accountId: string, provider: ProviderId): Promise<boolean>;

  createSession(session: {
    id: string;
    accountId: string;
    tokenHash: string;
    createdAt: number;
    expiresAt: number;
  }): Promise<void>;
  sessionByHash(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(id: string, lastSeenAt: number, expiresAt: number): Promise<void>;
  revokeSession(id: string, now: number): Promise<void>;
  revokeAllSessions(accountId: string, now: number): Promise<number>;

  guestMigration(guestId: string): Promise<GuestMigrationRecord | null>;
  guestMigrationForAccount(accountId: string): Promise<GuestMigrationRecord | null>;
  recordGuestMigration(record: GuestMigrationRecord): Promise<WriteOutcome>;
  /**
   * Flip a reserved (`pending`) migration to `complete` after its import has
   * finished. `conflict` means the reservation is no longer this account's.
   */
  completeGuestMigration(
    guestId: string,
    accountId: string,
    completedAt: number,
  ): Promise<WriteOutcome>;

  /**
   * Append one career match. `conflict` means this account already has a match
   * with the same `ref`: the caller reports the existing career, never a second
   * award.
   */
  recordCareerMatch(accountId: string, record: CareerMatchRecord): Promise<WriteOutcome>;
  /** Newest first, capped by the caller so a huge history cannot be requested. */
  careerMatches(accountId: string, limit: number, offset?: number): Promise<CareerMatchRecord[]>;
  /** One ledger row, for an idempotent result read. */
  careerMatch(accountId: string, ref: string): Promise<CareerMatchRecord | null>;
  /** Aggregated from the ledger, never a separately maintained balance. */
  careerTotals(accountId: string): Promise<CareerTotals>;
  /**
   * Ledger rows of one mode that paid XP at or after `since`. Daily award caps
   * count what was actually paid, so a zero-XP run never consumes a slot.
   */
  careerPaidMatchesSince(accountId: string, since: number, mode: CareerMode): Promise<number>;

  profile(accountId: string): Promise<PlayerProfileRecord | null>;
  profileByCallsignKey(callsignKey: string): Promise<PlayerProfileRecord | null>;
  /** `conflict` means the callsign key is taken. */
  createProfile(record: PlayerProfileRecord): Promise<WriteOutcome>;
  /** `conflict` means another account already uses that callsign key. */
  updateProfile(
    accountId: string,
    patch: {
      callsign: string;
      callsignKey: string;
      avatar: AvatarId;
      updatedAt: number;
      callsignChangedAt: number | null;
    },
  ): Promise<WriteOutcome>;

  /** One canonical identity document, or null before the first save. */
  playerIdentityDocument(accountId: string): Promise<PlayerIdentityDocument | null>;
  /**
   * Atomically replace designs, active selection and equipped cosmetics at
   * `expectedRevision + 1`. `conflict` means another device wrote first: not a
   * single design or presentation field may have changed.
   */
  savePlayerIdentityDocument(
    accountId: string,
    document: PlayerIdentityDocument,
    expectedRevision: number,
  ): Promise<WriteOutcome>;

  /**
   * Record a completed match and its report as one write. `conflict` means this
   * account already has the reference: report the existing award, never a
   * second one.
   */
  recordCareerEntry(entry: CareerEntryWrite): Promise<WriteOutcome>;
  /** Idempotent on `(accountId, ref)`; a retried report never duplicates. */
  recordMatchReport(accountId: string, report: MatchReportRecord): Promise<void>;
  matchReport(accountId: string, ref: string): Promise<MatchReportRecord | null>;
  /** Grouped statistics for the service record. */
  careerStatRows(accountId: string): Promise<StatGroupRow[]>;

  /** Every commendation this account has earned, oldest first. */
  awardedAchievements(accountId: string): Promise<CareerAchievementRecord[]>;
  /** Awards attached to one authoritative match, for the result screen. */
  achievementsForMatch(accountId: string, matchRef: string): Promise<CareerAchievementRecord[]>;
  /** Insert-only and idempotent on `(accountId, achievementId)`. */
  recordAchievements(
    accountId: string,
    awards: readonly AchievementAwardWrite[],
  ): Promise<number>;

  /** Idempotent completion record for a full campaign. */
  recordCampaignCompletion(accountId: string, campaignId: string, completedAt: number): Promise<WriteOutcome>;
  /** Completed campaigns, oldest first. */
  careerCampaigns(accountId: string): Promise<CareerCampaignRecord[]>;

  /** Idempotent audit row for one player's side of an authoritative match. */
  recordMpResultPlayer(record: MpResultPlayerRecord): Promise<void>;
  /** Rewarded authoritative matches at or after `since`, for the daily cap. */
  mpResultsSince(accountId: string, since: number): Promise<number>;

  /** One account's best run on one board, or null before its first finish. */
  outbreakRun(
    accountId: string,
    mode: OutbreakBoardMode,
    difficulty: OutbreakBoardDifficulty,
    map: string,
  ): Promise<OutbreakRunRecord | null>;
  /**
   * Upsert the account's best run on that board. `conflict` means the stored run
   * is still the better one: a leaderboard keeps the best, never the latest.
   */
  saveOutbreakRun(record: OutbreakRunRecord): Promise<WriteOutcome>;
  /** Top runs for one board, best first. A board is a map, mode and difficulty. */
  outbreakLeaderboard(
    mode: OutbreakBoardMode,
    difficulty: OutbreakBoardDifficulty,
    map: string,
    limit: number,
  ): Promise<OutbreakRunRecord[]>;
  /** 1-based position of a stored run among its board's best runs. */
  outbreakRank(run: OutbreakRunRecord): Promise<number>;

  /**
   * Increment one fixed-window counter and return the new value. A window is a
   * monotonic bucket index (`floor(now / windowMs)`), so no cleanup is needed
   * for correctness; old rows are pruned opportunistically.
   */
  countRateLimit(bucket: string, windowStart: number): Promise<number>;
}

export interface RateLimitRule {
  windowMs: number;
  limit: number;
}

/**
 * Endpoint budgets. Generous enough that a real person never notices, tight
 * enough that token guessing and callback spam are pointless.
 */
export const RATE_LIMITS = Object.freeze({
  authStart: { windowMs: 10 * 60_000, limit: 30 } as RateLimitRule,
  authCallback: { windowMs: 10 * 60_000, limit: 60 } as RateLimitRule,
  sessionRead: { windowMs: 60_000, limit: 120 } as RateLimitRule,
  mutate: { windowMs: 60_000, limit: 30 } as RateLimitRule,
  ticket: { windowMs: 60_000, limit: 20 } as RateLimitRule,
  guestMigration: { windowMs: 60 * 60_000, limit: 10 } as RateLimitRule,
  // A completed match is a rare event; the window is a UTC day and the budget
  // is far above what a person can play, so it only stops scripted farming.
  matchSubmit: { windowMs: 24 * 60 * 60_000, limit: 60 } as RateLimitRule,
  // An Outbreak run is equally rare, and the same reasoning applies: the budget
  // exists to stop a script posting boards of runs, not to throttle players.
  outbreakSubmit: { windowMs: 60 * 60_000, limit: 30 } as RateLimitRule,
});

export type AccountErrorCode =
  | 'invalid-request'
  | 'invalid-callsign'
  | 'callsign-reserved'
  | 'method-not-allowed'
  | 'not-found'
  | 'unauthorized'
  | 'forbidden-origin'
  | 'rate-limited'
  | 'provider-error'
  | 'provider-not-configured'
  | 'state-mismatch'
  | 'account-suspended'
  | 'identity-in-use'
  | 'identity-not-linked'
  | 'last-identity'
  | 'guest-already-migrated'
  | 'account-already-migrated'
  | 'migration-conflict'
  | 'stale-write'
  | 'server-error';

export class AccountError extends Error {
  readonly code: AccountErrorCode;
  readonly status: number;

  constructor(code: AccountErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
    this.status = status;
  }
}
