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
  GuestMigrationRecord,
  IdentityRecord,
  MigrationState,
  NewIdentity,
  ProviderId,
  SessionRecord,
  WriteOutcome,
} from './types';

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

  async careerMatches(accountId: string, limit: number): Promise<CareerMatchRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT match_ref, mode, outcome, difficulty, nation, duration_seconds,
                kills, units_lost, xp, provenance, recorded_at
           FROM career_matches WHERE account_id = ?
          ORDER BY recorded_at DESC, match_ref ASC LIMIT ?`,
      )
      .bind(accountId, Math.max(1, Math.min(200, Math.floor(limit))))
      .all<CareerRow>();
    return (result.results ?? []).map(toCareerMatch);
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
