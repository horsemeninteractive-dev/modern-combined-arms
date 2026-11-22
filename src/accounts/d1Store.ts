/**
 * D1 implementation of the account store.
 *
 * Thin by design: every rule lives in the router, and every statement here is
 * parameterised. Uniqueness is left to the database constraints — a concurrent
 * request that loses the race is reported as `conflict`, never as a server error.
 */
import type {
  CareerMatchRecord,
  CareerMode,
  CareerOutcome,
  CareerProvenance,
  CareerDifficulty,
  CareerTotals,
} from './career';
import { EMPTY_CAREER } from './career';
import type {
  AccountRecord,
  AccountStore,
  AccountStatus,
  AchievementAwardWrite,
  CareerAchievementRecord,
  CareerCampaignRecord,
  CareerEntryWrite,
  GuestMigrationRecord,
  IdentityRecord,
  MatchReportRecord,
  MigrationState,
  MpResultPlayerRecord,
  NewIdentity,
  PlayerIdentityDocument,
  PlayerProfileRecord,
  ProviderId,
  SessionRecord,
  WriteOutcome,
} from './types';
import { DEFAULT_AVATAR, isAvatarId, type AvatarId } from './identity';
import type { MatchRewardSummary } from './matchCareer';
import {
  isOutbreakBoardDifficulty,
  isOutbreakBoardMode,
  type OutbreakBoardDifficulty,
  type OutbreakBoardMode,
  type OutbreakRunRecord,
} from './outbreakBoard';
import type { StatGroupRow } from './stats';

/** The subset of the D1 binding this service uses. */
export interface D1ResultLike<T> {
  results?: T[];
  meta?: { changes?: number };
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1ResultLike<unknown>>;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
  /**
   * Optional atomic batch. D1 runs one in a single implicit transaction, which
   * is what makes a match, its report and its audit row inseparable.
   */
  batch?(statements: D1StatementLike[]): Promise<D1ResultLike<unknown>[]>;
}

function changed(result: D1ResultLike<unknown>): number {
  const value = result.meta?.changes;
  return typeof value === 'number' ? value : 0;
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|constraint failed/i.test(message);
}

interface AccountRow {
  id: string;
  created_at: number;
  status: string;
  last_auth_at: number | null;
}

interface IdentityRow {
  account_id: string;
  provider: string;
  provider_subject: string;
  display_name: string | null;
  avatar_url: string | null;
  linked_at: number;
}

interface SessionRow {
  id: string;
  account_id: string;
  token_hash: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
}

interface CareerRow {
  match_ref: string;
  mode: string;
  outcome: string;
  difficulty: string;
  nation: string | null;
  duration_seconds: number;
  kills: number;
  units_lost: number;
  xp: number;
  provenance: string;
  recorded_at: number;
}

interface CareerTotalsRow {
  xp: number | null;
  matches: number | null;
  victories: number | null;
  defeats: number | null;
  draws: number | null;
  kills: number | null;
  units_lost: number | null;
  play_seconds: number | null;
}

interface ProfileRow {
  account_id: string;
  callsign: string;
  callsign_key: string;
  avatar: string;
  created_at: number;
  updated_at: number;
  callsign_changed_at: number | null;
}

interface MatchReportRow {
  match_ref: string;
  mode: string;
  map_id: string | null;
  opponent_account_id: string | null;
  opponent_callsign: string | null;
  opponent_nation: string | null;
  duration_seconds: number;
  units_destroyed: number;
  units_lost: number;
  structures_destroyed: number;
  structures_lost: number;
  structures_built: number;
  sites_captured: number;
  superweapons_used: number;
  objectives_completed: number;
  reward_version: number;
  reward_status: string;
  reward_breakdown: string | null;
  xp_before: number;
  xp_after: number;
  recorded_at: number;
}

interface AchievementRow {
  account_id: string;
  achievement_id: string;
  awarded_at: number;
  match_ref: string | null;
}

interface CampaignRow {
  account_id: string;
  campaign_id: string;
  completed_at: number;
}

interface StatRow {
  mode: string;
  nation: string | null;
  matches: number | null;
  victories: number | null;
  defeats: number | null;
  draws: number | null;
  play_seconds: number | null;
  xp: number | null;
  units_destroyed: number | null;
  units_lost: number | null;
  structures_destroyed: number | null;
  structures_lost: number | null;
  structures_built: number | null;
  sites_captured: number | null;
  superweapons_used: number | null;
  objectives_completed: number | null;
}

interface MigrationRow {
  guest_id: string;
  account_id: string;
  state: string;
  migration_key: string;
  profile_digest: string;
  created_at: number;
  completed_at: number | null;
}

function status(value: string): AccountStatus {
  return value === 'suspended' || value === 'deleted' ? value : 'active';
}

function provider(value: string): ProviderId {
  return value === 'discord' ? 'discord' : 'google';
}

function migrationState(value: string): MigrationState {
  return value === 'pending' || value === 'conflict' ? value : 'complete';
}

interface OutbreakRunRow {
  account_id: string;
  mode: string;
  difficulty: string;
  wave: number;
  waves_completed: number;
  zombies_killed: number;
  duration_seconds: number;
  structures_lost: number;
  units_lost: number;
  players: number;
  nations: string;
  callsign: string | null;
  recorded_at: number;
}

/**
 * One stored run, or null for a row this build cannot read.
 *
 * The check constraints already bound mode and difficulty, but a row written by
 * a newer build must degrade to "not on this board" rather than poison the
 * table with an unknown label.
 */
function toOutbreakRun(row: OutbreakRunRow): OutbreakRunRecord | null {
  if (!isOutbreakBoardMode(row.mode) || !isOutbreakBoardDifficulty(row.difficulty)) return null;
  let nations: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.nations);
    if (Array.isArray(parsed)) {
      nations = parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, 2);
    }
  } catch {
    nations = [];
  }
  return {
    accountId: row.account_id,
    mode: row.mode,
    difficulty: row.difficulty,
    wave: row.wave,
    wavesCompleted: row.waves_completed,
    zombiesKilled: row.zombies_killed,
    durationSeconds: row.duration_seconds,
    structuresLost: row.structures_lost,
    unitsLost: row.units_lost,
    players: row.players,
    nations,
    callsign: row.callsign ?? 'Commander',
    recordedAt: row.recorded_at,
  };
}

export class D1AccountStore implements AccountStore {
  private readonly db: D1DatabaseLike;

  constructor(db: D1DatabaseLike) {
    this.db = db;
  }

  async createAccount(input: { id: string; now: number }): Promise<void> {
    await this.db
      .prepare("INSERT INTO accounts (id, created_at, status, last_auth_at) VALUES (?, ?, 'active', NULL)")
      .bind(input.id, input.now)
      .run();
  }

  async account(id: string): Promise<AccountRecord | null> {
    const row = await this.db
      .prepare('SELECT id, created_at, status, last_auth_at FROM accounts WHERE id = ?')
      .bind(id)
      .first<AccountRow>();
    if (!row) return null;
    return { id: row.id, createdAt: row.created_at, status: status(row.status), lastAuthAt: row.last_auth_at };
  }

  async touchAccountAuth(id: string, now: number): Promise<void> {
    await this.db.prepare('UPDATE accounts SET last_auth_at = ? WHERE id = ?').bind(now, id).run();
  }

  async attachIdentity(identity: NewIdentity): Promise<WriteOutcome> {
    try {
      await this.db
        .prepare(
          `INSERT INTO account_identities
             (account_id, provider, provider_subject, display_name, avatar_url, linked_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          identity.accountId,
          identity.provider,
          identity.subject,
          identity.displayName,
          identity.avatarUrl,
          identity.now,
        )
        .run();
      return 'ok';
    } catch (error) {
      if (isUniqueViolation(error)) return 'conflict';
      throw error;
    }
  }

  async identity(providerId: ProviderId, subject: string): Promise<IdentityRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT account_id, provider, provider_subject, display_name, avatar_url, linked_at
           FROM account_identities WHERE provider = ? AND provider_subject = ?`,
      )
      .bind(providerId, subject)
      .first<IdentityRow>();
    return row ? toIdentity(row) : null;
  }

  async identities(accountId: string): Promise<IdentityRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT account_id, provider, provider_subject, display_name, avatar_url, linked_at
           FROM account_identities WHERE account_id = ? ORDER BY linked_at ASC, provider ASC`,
      )
      .bind(accountId)
      .all<IdentityRow>();
    return (result.results ?? []).map(toIdentity);
  }

  async detachIdentity(accountId: string, providerId: ProviderId): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM account_identities WHERE account_id = ? AND provider = ?')
      .bind(accountId, providerId)
      .run();
    return changed(result) > 0;
  }

  async createSession(session: {
    id: string;
    accountId: string;
    tokenHash: string;
    createdAt: number;
    expiresAt: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO account_sessions
           (id, account_id, token_hash, created_at, last_seen_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(session.id, session.accountId, session.tokenHash, session.createdAt, session.createdAt, session.expiresAt)
      .run();
  }

  async sessionByHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT id, account_id, token_hash, created_at, last_seen_at, expires_at, revoked_at
           FROM account_sessions WHERE token_hash = ?`,
      )
      .bind(tokenHash)
      .first<SessionRow>();
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.account_id,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  async touchSession(id: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    await this.db
      .prepare('UPDATE account_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .bind(lastSeenAt, expiresAt, id)
      .run();
  }

  async revokeSession(id: string, now: number): Promise<void> {
    await this.db
      .prepare('UPDATE account_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .bind(now, id)
      .run();
  }

  async revokeAllSessions(accountId: string, now: number): Promise<number> {
    const result = await this.db
      .prepare('UPDATE account_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL')
      .bind(now, accountId)
      .run();
    return changed(result);
  }

  async guestMigration(guestId: string): Promise<GuestMigrationRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT guest_id, account_id, state, migration_key, profile_digest, created_at, completed_at
           FROM guest_migration_records WHERE guest_id = ?`,
      )
      .bind(guestId)
      .first<MigrationRow>();
    return row ? toMigration(row) : null;
  }

  async guestMigrationForAccount(accountId: string): Promise<GuestMigrationRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT guest_id, account_id, state, migration_key, profile_digest, created_at, completed_at
           FROM guest_migration_records WHERE account_id = ?`,
      )
      .bind(accountId)
      .first<MigrationRow>();
    return row ? toMigration(row) : null;
  }

  async recordGuestMigration(record: GuestMigrationRecord): Promise<WriteOutcome> {
    try {
      await this.db
        .prepare(
          `INSERT INTO guest_migration_records
             (guest_id, account_id, state, migration_key, profile_digest, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.guestId,
          record.accountId,
          record.state,
          record.migrationKey,
          record.profileDigest,
          record.createdAt,
          record.completedAt,
        )
        .run();
      return 'ok';
    } catch (error) {
      if (isUniqueViolation(error)) return 'conflict';
      throw error;
    }
  }

  async completeGuestMigration(
    guestId: string,
    accountId: string,
    completedAt: number,
  ): Promise<WriteOutcome> {
    const result = await this.db
      .prepare(
        `UPDATE guest_migration_records
            SET state = 'complete', completed_at = ?
          WHERE guest_id = ? AND account_id = ? AND state = 'pending'`,
      )
      .bind(completedAt, guestId, accountId)
      .run();
    return changed(result) > 0 ? 'ok' : 'conflict';
  }

  async recordCareerMatch(accountId: string, record: CareerMatchRecord): Promise<WriteOutcome> {
    const result = await this.db
      .prepare(
        `INSERT INTO career_matches
           (account_id, match_ref, mode, outcome, difficulty, nation,
            duration_seconds, kills, units_lost, xp, provenance, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (account_id, match_ref) DO NOTHING`,
      )
      .bind(
        accountId,
        record.ref,
        record.mode,
        record.outcome,
        record.difficulty,
        record.nation,
        record.durationSeconds,
        record.kills,
        record.unitsLost,
        record.xp,
        record.provenance,
        record.recordedAt,
      )
      .run();
    return changed(result) > 0 ? 'ok' : 'conflict';
  }

  async careerMatches(accountId: string, limit: number, offset = 0): Promise<CareerMatchRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT match_ref, mode, outcome, difficulty, nation, duration_seconds,
                kills, units_lost, xp, provenance, recorded_at
           FROM career_matches WHERE account_id = ?
          ORDER BY recorded_at DESC, match_ref ASC LIMIT ? OFFSET ?`,
      )
      .bind(
        accountId,
        Math.max(1, Math.min(200, Math.floor(limit))),
        Math.max(0, Math.floor(offset)),
      )
      .all<CareerRow>();
    return (result.results ?? []).map(toCareerMatch);
  }

  async careerMatch(accountId: string, ref: string): Promise<CareerMatchRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT match_ref, mode, outcome, difficulty, nation, duration_seconds,
                kills, units_lost, xp, provenance, recorded_at
           FROM career_matches WHERE account_id = ? AND match_ref = ?`,
      )
      .bind(accountId, ref)
      .first<CareerRow>();
    return row ? toCareerMatch(row) : null;
  }

  async profile(accountId: string): Promise<PlayerProfileRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT account_id, callsign, callsign_key, avatar, created_at, updated_at,
                callsign_changed_at
           FROM account_profiles WHERE account_id = ?`,
      )
      .bind(accountId)
      .first<ProfileRow>();
    return row ? toProfile(row) : null;
  }

  async profileByCallsignKey(callsignKey: string): Promise<PlayerProfileRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT account_id, callsign, callsign_key, avatar, created_at, updated_at,
                callsign_changed_at
           FROM account_profiles WHERE callsign_key = ?`,
      )
      .bind(callsignKey)
      .first<ProfileRow>();
    return row ? toProfile(row) : null;
  }

  async createProfile(record: PlayerProfileRecord): Promise<WriteOutcome> {
    const result = await this.db
      .prepare(
        `INSERT INTO account_profiles
           (account_id, callsign, callsign_key, avatar, created_at, updated_at, callsign_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        record.accountId,
        record.callsign,
        record.callsignKey,
        record.avatar,
        record.createdAt,
        record.updatedAt,
        record.callsignChangedAt,
      )
      .run();
    return changed(result) > 0 ? 'ok' : 'conflict';
  }

  async updateProfile(
    accountId: string,
    patch: {
      callsign: string;
      callsignKey: string;
      avatar: AvatarId;
      updatedAt: number;
      callsignChangedAt: number | null;
    },
  ): Promise<WriteOutcome> {
    try {
      const result = await this.db
        .prepare(
          `UPDATE account_profiles
              SET callsign = ?, callsign_key = ?, avatar = ?, updated_at = ?,
                  callsign_changed_at = COALESCE(?, callsign_changed_at)
            WHERE account_id = ?`,
        )
        .bind(patch.callsign, patch.callsignKey, patch.avatar, patch.updatedAt, patch.callsignChangedAt, accountId)
        .run();
      return changed(result) > 0 ? 'ok' : 'conflict';
    } catch (error) {
      if (isUniqueViolation(error)) return 'conflict';
      throw error;
    }
  }

  /**
   * Read the canonical identity document.
   *
   * Rows written before migration 0005 have no `document` column value; those
   * are assembled from the original two tables so no existing profile is lost.
   * A document read never validates compositions — that belongs to the route,
   * which can drop an unrenderable design without hiding the rest.
   */
  async playerIdentityDocument(accountId: string): Promise<PlayerIdentityDocument | null> {
    const row = await this.db
      .prepare(
        `SELECT account_id, active_design_id, frame, background, camo, revision, updated_at, document
           FROM player_presentation WHERE account_id = ?`,
      )
      .bind(accountId)
      .first<{
        account_id: string;
        active_design_id: string | null;
        frame: string | null;
        background: string | null;
        camo: string | null;
        revision: number;
        updated_at: number;
        document: string | null;
      }>();
    if (!row) return null;
    if (row.document) {
      try {
        const stored = JSON.parse(row.document) as Partial<PlayerIdentityDocument>;
        if (Array.isArray(stored.designs)) {
          return {
            designs: stored.designs,
            activeDesignId: typeof stored.activeDesignId === 'string' ? stored.activeDesignId : null,
            frame: typeof stored.frame === 'string' ? stored.frame : null,
            background: typeof stored.background === 'string' ? stored.background : null,
            camo: typeof stored.camo === 'string' ? stored.camo : null,
            revision: row.revision,
            updatedAt: row.updated_at,
          };
        }
      } catch {
        // A damaged document falls back to the legacy tables below rather than
        // silently presenting an empty profile.
      }
    }
    const legacy = await this.db
      .prepare(
        `SELECT account_id, design_id, name, composition, schema_version, created_at, updated_at
           FROM player_flags WHERE account_id = ? ORDER BY created_at ASC`,
      )
      .bind(accountId)
      .all<{
        account_id: string;
        design_id: string;
        name: string;
        composition: string;
        schema_version: number;
        created_at: number;
        updated_at: number;
      }>();
    return {
      designs: (legacy.results ?? []).map((flag) => ({
        accountId: flag.account_id,
        designId: flag.design_id,
        name: flag.name,
        composition: flag.composition,
        schemaVersion: flag.schema_version,
        createdAt: flag.created_at,
        updatedAt: flag.updated_at,
      })),
      activeDesignId: row.active_design_id,
      frame: row.frame,
      background: row.background,
      camo: row.camo,
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Persist the complete identity document as one atomic revision-guarded row
   * write. The old sequence deleted designs, upserted them one by one and only
   * then checked the presentation revision; two devices could both pass the
   * check and one would erase the other's designs. A single conditional
   * statement makes the whole document win or lose together.
   */
  async savePlayerIdentityDocument(
    accountId: string,
    document: PlayerIdentityDocument,
    expectedRevision: number,
  ): Promise<WriteOutcome> {
    const payload = JSON.stringify(document);
    if (expectedRevision > 0) {
      const result = await this.db
        .prepare(
          `UPDATE player_presentation
              SET document = ?, active_design_id = ?, frame = ?, background = ?, camo = ?,
                  revision = ?, updated_at = ?
            WHERE account_id = ? AND revision = ?`,
        )
        .bind(
          payload,
          document.activeDesignId,
          document.frame,
          document.background,
          document.camo,
          expectedRevision + 1,
          document.updatedAt,
          accountId,
          expectedRevision,
        )
        .run();
      return changed(result) > 0 ? 'ok' : 'conflict';
    }
    const result = await this.db
      .prepare(
        `INSERT INTO player_presentation
           (account_id, active_design_id, frame, background, camo, revision, updated_at, document)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (account_id) DO NOTHING`,
      )
      .bind(
        accountId,
        document.activeDesignId,
        document.frame,
        document.background,
        document.camo,
        document.updatedAt,
        payload,
      )
      .run();
    return changed(result) > 0 ? 'ok' : 'conflict';
  }

  async recordCareerEntry(entry: CareerEntryWrite): Promise<WriteOutcome> {
    // The report is written before the ledger row so its XP-before subquery
    // reads the career *without* this match. `DO NOTHING` on every statement
    // makes a retried report harmless, and the ledger's changes count is what
    // decides whether this call actually paid.
    const statements: D1StatementLike[] = [];
    if (entry.report) statements.push(this.reportStatement(entry.accountId, entry.report));
    if (entry.audit) statements.push(this.auditStatement(entry.audit));
    statements.push(this.ledgerStatement(entry.accountId, entry.record));

    if (this.db.batch) {
      const results = await this.db.batch(statements);
      const ledger = results[results.length - 1];
      return changed(ledger) > 0 ? 'ok' : 'conflict';
    }
    let ledgerChanges = 0;
    for (const statement of statements) {
      const result = await statement.run();
      ledgerChanges = changed(result);
    }
    return ledgerChanges > 0 ? 'ok' : 'conflict';
  }

  private reportStatement(accountId: string, report: MatchReportRecord): D1StatementLike {
    return this.db
      .prepare(
        `INSERT INTO career_match_details
           (account_id, match_ref, mode, map_id, opponent_account_id, opponent_callsign,
            opponent_nation, duration_seconds, units_destroyed, units_lost,
            structures_destroyed, structures_lost, structures_built, sites_captured,
            superweapons_used, objectives_completed, reward_version, reward_status,
            reward_breakdown, xp_before, xp_after, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 (SELECT COALESCE(SUM(xp), 0) FROM career_matches WHERE account_id = ?),
                 (SELECT COALESCE(SUM(xp), 0) FROM career_matches WHERE account_id = ?) + ?,
                 ?)
         ON CONFLICT (account_id, match_ref) DO NOTHING`,
      )
      .bind(
        accountId,
        report.ref,
        report.mode,
        report.mapId,
        report.opponentAccountId,
        report.opponentCallsign,
        report.opponentNation,
        report.durationSeconds,
        report.unitsDestroyed,
        report.unitsLost,
        report.structuresDestroyed,
        report.structuresLost,
        report.structuresBuilt,
        report.sitesCaptured,
        report.superweaponsUsed,
        report.objectivesCompleted,
        report.rewardVersion,
        report.rewardStatus,
        report.breakdown ? JSON.stringify(report.breakdown) : null,
        accountId,
        accountId,
        report.xpAfter - report.xpBefore,
        report.recordedAt,
      );
  }

  private auditStatement(audit: MpResultPlayerRecord): D1StatementLike {
    return this.db
      .prepare(
        `INSERT INTO mp_result_players
           (match_id, account_id, room_id, team, outcome, nation, reward_version,
            xp_awarded, status, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (match_id, account_id) DO NOTHING`,
      )
      .bind(
        audit.matchId,
        audit.accountId,
        audit.roomId,
        audit.team,
        audit.outcome,
        audit.nation,
        audit.rewardVersion,
        audit.xpAwarded,
        audit.status,
        audit.processedAt,
      );
  }

  private ledgerStatement(accountId: string, record: CareerMatchRecord): D1StatementLike {
    return this.db
      .prepare(
        `INSERT INTO career_matches
           (account_id, match_ref, mode, outcome, difficulty, nation,
            duration_seconds, kills, units_lost, xp, provenance, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (account_id, match_ref) DO NOTHING`,
      )
      .bind(
        accountId,
        record.ref,
        record.mode,
        record.outcome,
        record.difficulty,
        record.nation,
        record.durationSeconds,
        record.kills,
        record.unitsLost,
        record.xp,
        record.provenance,
        record.recordedAt,
      );
  }

  async recordMatchReport(accountId: string, report: MatchReportRecord): Promise<void> {
    await this.reportStatement(accountId, report).run();
  }

  async matchReport(accountId: string, ref: string): Promise<MatchReportRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT match_ref, mode, map_id, opponent_account_id, opponent_callsign,
                opponent_nation, duration_seconds, units_destroyed, units_lost,
                structures_destroyed, structures_lost, structures_built, sites_captured,
                superweapons_used, objectives_completed, reward_version, reward_status,
                reward_breakdown, xp_before, xp_after, recorded_at
           FROM career_match_details WHERE account_id = ? AND match_ref = ?`,
      )
      .bind(accountId, ref)
      .first<MatchReportRow>();
    return row ? toMatchReport(row) : null;
  }

  async awardedAchievements(accountId: string): Promise<CareerAchievementRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT account_id, achievement_id, awarded_at, match_ref
           FROM career_achievements WHERE account_id = ?
          ORDER BY awarded_at ASC, achievement_id ASC`,
      )
      .bind(accountId)
      .all<AchievementRow>();
    return (result.results ?? []).map(toAchievement);
  }

  async achievementsForMatch(accountId: string, matchRef: string): Promise<CareerAchievementRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT account_id, achievement_id, awarded_at, match_ref
           FROM career_achievements WHERE account_id = ? AND match_ref = ?
          ORDER BY awarded_at ASC, achievement_id ASC`,
      )
      .bind(accountId, matchRef)
      .all<AchievementRow>();
    return (result.results ?? []).map(toAchievement);
  }

  async recordAchievements(accountId: string, awards: readonly AchievementAwardWrite[]): Promise<number> {
    let inserted = 0;
    for (const award of awards) {
      const result = await this.db
        .prepare(
          `INSERT INTO career_achievements (account_id, achievement_id, awarded_at, match_ref)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (account_id, achievement_id) DO NOTHING`,
        )
        .bind(accountId, award.achievementId, award.awardedAt, award.matchRef)
        .run();
      inserted += changed(result);
    }
    return inserted;
  }

  async recordCampaignCompletion(accountId: string, campaignId: string, completedAt: number): Promise<WriteOutcome> {
    const result = await this.db
      .prepare(
        `INSERT INTO career_campaigns (account_id, campaign_id, completed_at)
         VALUES (?, ?, ?)
         ON CONFLICT (account_id, campaign_id) DO NOTHING`,
      )
      .bind(accountId, campaignId, completedAt)
      .run();
    return changed(result) > 0 ? 'ok' : 'conflict';
  }

  async careerCampaigns(accountId: string): Promise<CareerCampaignRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT account_id, campaign_id, completed_at
           FROM career_campaigns WHERE account_id = ?
          ORDER BY completed_at ASC, campaign_id ASC`,
      )
      .bind(accountId)
      .all<CampaignRow>();
    return (result.results ?? []).map(toCampaign);
  }

  async outbreakRun(
    accountId: string,
    mode: OutbreakBoardMode,
    difficulty: OutbreakBoardDifficulty,
  ): Promise<OutbreakRunRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT r.account_id, r.mode, r.difficulty, r.wave, r.waves_completed, r.zombies_killed,
                r.duration_seconds, r.structures_lost, r.units_lost, r.players, r.nations,
                COALESCE(p.callsign, r.callsign) AS callsign, r.recorded_at
           FROM outbreak_runs r
           LEFT JOIN account_profiles p ON p.account_id = r.account_id
          WHERE r.account_id = ? AND r.mode = ? AND r.difficulty = ?`,
      )
      .bind(accountId, mode, difficulty)
      .first<OutbreakRunRow>();
    return row ? toOutbreakRun(row) : null;
  }

  /**
   * Upsert a run only when it beats the stored one.
   *
   * The comparison lives in the statement, not in a read-then-write: two
   * devices finishing at once may both submit, and the board must keep the
   * better run rather than whichever write landed last. A no-op update reports
   * zero changed rows, which is exactly the `conflict` answer.
   */
  async saveOutbreakRun(record: OutbreakRunRecord): Promise<WriteOutcome> {
    const result = await this.db
      .prepare(
        `INSERT INTO outbreak_runs (
           account_id, mode, difficulty, wave, waves_completed, zombies_killed,
           duration_seconds, structures_lost, units_lost, players, nations, callsign, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (account_id, mode, difficulty) DO UPDATE SET
           wave = excluded.wave,
           waves_completed = excluded.waves_completed,
           zombies_killed = excluded.zombies_killed,
           duration_seconds = excluded.duration_seconds,
           structures_lost = excluded.structures_lost,
           units_lost = excluded.units_lost,
           players = excluded.players,
           nations = excluded.nations,
           callsign = excluded.callsign,
           recorded_at = excluded.recorded_at
         WHERE excluded.wave > outbreak_runs.wave
            OR (excluded.wave = outbreak_runs.wave AND excluded.waves_completed > outbreak_runs.waves_completed)
            OR (excluded.wave = outbreak_runs.wave AND excluded.waves_completed = outbreak_runs.waves_completed
                AND excluded.zombies_killed > outbreak_runs.zombies_killed)
            OR (excluded.wave = outbreak_runs.wave AND excluded.waves_completed = outbreak_runs.waves_completed
                AND excluded.zombies_killed = outbreak_runs.zombies_killed
                AND excluded.duration_seconds > outbreak_runs.duration_seconds)`,
      )
      .bind(
        record.accountId,
        record.mode,
        record.difficulty,
        record.wave,
        record.wavesCompleted,
        record.zombiesKilled,
        record.durationSeconds,
        record.structuresLost,
        record.unitsLost,
        record.players,
        JSON.stringify(record.nations),
        record.callsign,
        record.recordedAt,
      )
      .run();
    return changed(result) > 0 ? 'ok' : 'conflict';
  }

  async outbreakLeaderboard(
    mode: OutbreakBoardMode,
    difficulty: OutbreakBoardDifficulty,
    limit: number,
  ): Promise<OutbreakRunRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT r.account_id, r.mode, r.difficulty, r.wave, r.waves_completed, r.zombies_killed,
                r.duration_seconds, r.structures_lost, r.units_lost, r.players, r.nations,
                COALESCE(p.callsign, r.callsign) AS callsign, r.recorded_at
           FROM outbreak_runs r
           LEFT JOIN account_profiles p ON p.account_id = r.account_id
          WHERE r.mode = ? AND r.difficulty = ?
          ORDER BY r.wave DESC, r.waves_completed DESC, r.zombies_killed DESC,
                   r.duration_seconds DESC, r.recorded_at ASC
          LIMIT ?`,
      )
      .bind(mode, difficulty, limit)
      .all<OutbreakRunRow>();
    return (result.results ?? [])
      .map(toOutbreakRun)
      .filter((run): run is OutbreakRunRecord => run !== null);
  }

  /** Rows ahead of this run on its board, plus one. Ties do not move a row. */
  async outbreakRank(run: OutbreakRunRecord): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS ahead FROM outbreak_runs
          WHERE mode = ? AND difficulty = ?
            AND (wave > ?
              OR (wave = ? AND waves_completed > ?)
              OR (wave = ? AND waves_completed = ? AND zombies_killed > ?)
              OR (wave = ? AND waves_completed = ? AND zombies_killed = ? AND duration_seconds > ?))`,
      )
      .bind(
        run.mode,
        run.difficulty,
        run.wave,
        run.wave,
        run.wavesCompleted,
        run.wave,
        run.wavesCompleted,
        run.zombiesKilled,
        run.wave,
        run.wavesCompleted,
        run.zombiesKilled,
        run.durationSeconds,
      )
      .first<{ ahead: number }>();
    return (row?.ahead ?? 0) + 1;
  }

  async careerStatRows(accountId: string): Promise<StatGroupRow[]> {
    const result = await this.db
      .prepare(
        `SELECT m.mode AS mode, m.nation AS nation,
                COUNT(*) AS matches,
                COALESCE(SUM(CASE WHEN m.outcome = 'victory' THEN 1 ELSE 0 END), 0) AS victories,
                COALESCE(SUM(CASE WHEN m.outcome = 'defeat' THEN 1 ELSE 0 END), 0) AS defeats,
                COALESCE(SUM(CASE WHEN m.outcome = 'draw' THEN 1 ELSE 0 END), 0) AS draws,
                COALESCE(SUM(m.duration_seconds), 0) AS play_seconds,
                COALESCE(SUM(m.xp), 0) AS xp,
                COALESCE(SUM(m.kills), 0) AS units_destroyed,
                COALESCE(SUM(m.units_lost), 0) AS units_lost,
                COALESCE(SUM(d.structures_destroyed), 0) AS structures_destroyed,
                COALESCE(SUM(d.structures_lost), 0) AS structures_lost,
                COALESCE(SUM(d.structures_built), 0) AS structures_built,
                COALESCE(SUM(d.sites_captured), 0) AS sites_captured,
                COALESCE(SUM(d.superweapons_used), 0) AS superweapons_used,
                COALESCE(SUM(d.objectives_completed), 0) AS objectives_completed
           FROM career_matches m
           LEFT JOIN career_match_details d
                  ON d.account_id = m.account_id AND d.match_ref = m.match_ref
          WHERE m.account_id = ?
          GROUP BY m.mode, m.nation`,
      )
      .bind(accountId)
      .all<StatRow>();
    return (result.results ?? []).map(toStatRow);
  }

  async recordMpResultPlayer(record: MpResultPlayerRecord): Promise<void> {
    await this.auditStatement(record).run();
  }

  async mpResultsSince(accountId: string, since: number): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM mp_result_players
          WHERE account_id = ? AND status = 'awarded' AND processed_at >= ?`,
      )
      .bind(accountId, since)
      .first<{ count: number | null }>();
    return Number(row?.count ?? 0);
  }

  async careerTotals(accountId: string): Promise<CareerTotals> {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(xp), 0) AS xp,
                COUNT(*) AS matches,
                COALESCE(SUM(CASE WHEN outcome = 'victory' THEN 1 ELSE 0 END), 0) AS victories,
                COALESCE(SUM(CASE WHEN outcome = 'defeat' THEN 1 ELSE 0 END), 0) AS defeats,
                COALESCE(SUM(CASE WHEN outcome = 'draw' THEN 1 ELSE 0 END), 0) AS draws,
                COALESCE(SUM(kills), 0) AS kills,
                COALESCE(SUM(units_lost), 0) AS units_lost,
                COALESCE(SUM(duration_seconds), 0) AS play_seconds
           FROM career_matches WHERE account_id = ?`,
      )
      .bind(accountId)
      .first<CareerTotalsRow>();
    if (!row) return { ...EMPTY_CAREER };
    return {
      xp: Number(row.xp ?? 0),
      matches: Number(row.matches ?? 0),
      victories: Number(row.victories ?? 0),
      defeats: Number(row.defeats ?? 0),
      draws: Number(row.draws ?? 0),
      kills: Number(row.kills ?? 0),
      unitsLost: Number(row.units_lost ?? 0),
      playSeconds: Number(row.play_seconds ?? 0),
    };
  }

  async countRateLimit(bucket: string, windowStart: number): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO auth_rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(bucket, windowStart)
      .first<{ count: number }>();
    // Opportunistic pruning: cheap, bounded and never on the critical path.
    if (Math.random() < 0.02) {
      await this.db
        .prepare('DELETE FROM auth_rate_limits WHERE window_start < ?')
        .bind(windowStart - 64)
        .run()
        .catch(() => undefined);
    }
    return typeof row?.count === 'number' ? row.count : 1;
  }
}

function toIdentity(row: IdentityRow): IdentityRecord {
  return {
    accountId: row.account_id,
    provider: provider(row.provider),
    subject: row.provider_subject,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    linkedAt: row.linked_at,
  };
}

function toCareerMatch(row: CareerRow): CareerMatchRecord {
  const mode: CareerMode = row.mode === 'campaign' || row.mode === 'multiplayer' ? row.mode : 'skirmish';
  const outcome: CareerOutcome =
    row.outcome === 'victory' || row.outcome === 'draw' ? row.outcome : 'defeat';
  const difficulty: CareerDifficulty =
    row.difficulty === 'recruit' || row.difficulty === 'elite' ? row.difficulty : 'veteran';
  const provenance: CareerProvenance =
    row.provenance === 'guest' || row.provenance === 'authoritative' ? row.provenance : 'local';
  return {
    ref: row.match_ref,
    mode,
    outcome,
    difficulty,
    durationSeconds: row.duration_seconds,
    nation: row.nation,
    kills: row.kills,
    unitsLost: row.units_lost,
    xp: row.xp,
    provenance,
    recordedAt: row.recorded_at,
  };
}

function toProfile(row: ProfileRow): PlayerProfileRecord {
  return {
    accountId: row.account_id,
    callsign: row.callsign,
    callsignKey: row.callsign_key,
    avatar: isAvatarId(row.avatar) ? row.avatar : DEFAULT_AVATAR,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    callsignChangedAt: row.callsign_changed_at,
  };
}

function toMatchReport(row: MatchReportRow): MatchReportRecord {
  const mode: CareerMode = row.mode === 'campaign' || row.mode === 'multiplayer' ? row.mode : 'skirmish';
  const rewardStatus: MatchReportRecord['rewardStatus'] =
    row.reward_status === 'capped' || row.reward_status === 'ineligible' || row.reward_status === 'local'
      ? row.reward_status
      : 'awarded';
  return {
    ref: row.match_ref,
    mode,
    mapId: row.map_id,
    opponentAccountId: row.opponent_account_id,
    opponentCallsign: row.opponent_callsign,
    opponentNation: row.opponent_nation,
    durationSeconds: row.duration_seconds,
    unitsDestroyed: row.units_destroyed,
    unitsLost: row.units_lost,
    structuresDestroyed: row.structures_destroyed,
    structuresLost: row.structures_lost,
    structuresBuilt: row.structures_built,
    sitesCaptured: row.sites_captured,
    superweaponsUsed: row.superweapons_used,
    objectivesCompleted: row.objectives_completed,
    rewardVersion: row.reward_version,
    rewardStatus,
    breakdown: parseBreakdown(row.reward_breakdown),
    xpBefore: row.xp_before,
    xpAfter: row.xp_after,
    recordedAt: row.recorded_at,
  };
}

function parseBreakdown(raw: string | null): MatchRewardSummary['breakdown'] {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as MatchRewardSummary['breakdown'];
    return value && typeof value === 'object' ? value : null;
  } catch {
    // A corrupt audit blob must not break the service record; the ledger row is
    // still the authority for what was paid.
    return null;
  }
}

function toStatRow(row: StatRow): StatGroupRow {
  const mode: CareerMode = row.mode === 'campaign' || row.mode === 'multiplayer' ? row.mode : 'skirmish';
  return {
    mode,
    nation: row.nation,
    matches: Number(row.matches ?? 0),
    victories: Number(row.victories ?? 0),
    defeats: Number(row.defeats ?? 0),
    draws: Number(row.draws ?? 0),
    playSeconds: Number(row.play_seconds ?? 0),
    xp: Number(row.xp ?? 0),
    unitsDestroyed: Number(row.units_destroyed ?? 0),
    unitsLost: Number(row.units_lost ?? 0),
    structuresDestroyed: Number(row.structures_destroyed ?? 0),
    structuresLost: Number(row.structures_lost ?? 0),
    structuresBuilt: Number(row.structures_built ?? 0),
    sitesCaptured: Number(row.sites_captured ?? 0),
    superweaponsUsed: Number(row.superweapons_used ?? 0),
    objectivesCompleted: Number(row.objectives_completed ?? 0),
  };
}

function toCampaign(row: CampaignRow): CareerCampaignRecord {
  return {
    accountId: row.account_id,
    campaignId: row.campaign_id,
    completedAt: Number(row.completed_at ?? 0),
  };
}

function toAchievement(row: AchievementRow): CareerAchievementRecord {
  return {
    accountId: row.account_id,
    achievementId: row.achievement_id,
    awardedAt: Number(row.awarded_at ?? 0),
    matchRef: row.match_ref,
  };
}

function toMigration(row: MigrationRow): GuestMigrationRecord {
  return {
    guestId: row.guest_id,
    accountId: row.account_id,
    state: migrationState(row.state),
    migrationKey: row.migration_key,
    profileDigest: row.profile_digest,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
