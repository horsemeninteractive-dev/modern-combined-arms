/**
 * In-memory account store.
 *
 * It is a faithful implementation of the same contract as D1, including the
 * uniqueness rules, so route, OAuth and migration behaviour is tested against
 * real semantics instead of a stub that always agrees with the caller. Tests use
 * it directly; it is not wired into the Worker.
 */
import type { CareerMatchRecord, CareerTotals } from './career';
import { EMPTY_CAREER, summariseCareer } from './career';
import type {
  AccountRecord,
  AccountStore,
  GuestMigrationRecord,
  IdentityRecord,
  NewIdentity,
  ProviderId,
  SessionRecord,
  WriteOutcome,
} from './types';

export class MemoryAccountStore implements AccountStore {
  private accounts = new Map<string, AccountRecord>();
  private identityRows = new Map<string, IdentityRecord>();
  private sessions = new Map<string, SessionRecord>();
  private sessionsByHash = new Map<string, string>();
  private migrations = new Map<string, GuestMigrationRecord>();
  private limits = new Map<string, number>();
  private career = new Map<string, CareerMatchRecord[]>();

  /** Test hook: change an account's status without going through a route. */
  setStatus(accountId: string, status: AccountRecord['status']): void {
    const account = this.accounts.get(accountId);
    if (account) account.status = status;
  }

  async createAccount(input: { id: string; now: number }): Promise<void> {
    if (this.accounts.has(input.id)) throw new Error('account id already exists');
    this.accounts.set(input.id, { id: input.id, createdAt: input.now, status: 'active', lastAuthAt: null });
  }

  async account(id: string): Promise<AccountRecord | null> {
    const account = this.accounts.get(id);
    return account ? { ...account } : null;
  }

  async touchAccountAuth(id: string, now: number): Promise<void> {
    const account = this.accounts.get(id);
    if (account) account.lastAuthAt = now;
  }

  async attachIdentity(identity: NewIdentity): Promise<WriteOutcome> {
    const key = `${identity.provider}:${identity.subject}`;
    if (this.identityRows.has(key)) return 'conflict';
    this.identityRows.set(key, {
      accountId: identity.accountId,
      provider: identity.provider,
      subject: identity.subject,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      linkedAt: identity.now,
    });
    return 'ok';
  }

  async identity(provider: ProviderId, subject: string): Promise<IdentityRecord | null> {
    const identity = this.identityRows.get(`${provider}:${subject}`);
    return identity ? { ...identity } : null;
  }

  async identities(accountId: string): Promise<IdentityRecord[]> {
    return [...this.identityRows.values()]
      .filter((identity) => identity.accountId === accountId)
      .sort((left, right) => left.linkedAt - right.linkedAt || left.provider.localeCompare(right.provider))
      .map((identity) => ({ ...identity }));
  }

  async detachIdentity(accountId: string, provider: ProviderId): Promise<boolean> {
    for (const [key, identity] of this.identityRows) {
      if (identity.accountId === accountId && identity.provider === provider) {
        this.identityRows.delete(key);
        return true;
      }
    }
    return false;
  }

  async createSession(session: {
    id: string;
    accountId: string;
    tokenHash: string;
    createdAt: number;
    expiresAt: number;
  }): Promise<void> {
    if (this.sessionsByHash.has(session.tokenHash)) throw new Error('session token already stored');
    const record: SessionRecord = {
      id: session.id,
      accountId: session.accountId,
      tokenHash: session.tokenHash,
      createdAt: session.createdAt,
      lastSeenAt: session.createdAt,
      expiresAt: session.expiresAt,
      revokedAt: null,
    };
    this.sessions.set(session.id, record);
    this.sessionsByHash.set(session.tokenHash, session.id);
  }

  async sessionByHash(tokenHash: string): Promise<SessionRecord | null> {
    const id = this.sessionsByHash.get(tokenHash);
    const session = id ? this.sessions.get(id) : undefined;
    return session ? { ...session } : null;
  }

  async touchSession(id: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    session.lastSeenAt = lastSeenAt;
    session.expiresAt = expiresAt;
  }

  async revokeSession(id: string, now: number): Promise<void> {
    const session = this.sessions.get(id);
    if (session && session.revokedAt === null) session.revokedAt = now;
  }

  async revokeAllSessions(accountId: string, now: number): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.accountId === accountId && session.revokedAt === null) {
        session.revokedAt = now;
        count++;
      }
    }
    return count;
  }

  async guestMigration(guestId: string): Promise<GuestMigrationRecord | null> {
    const record = this.migrations.get(guestId);
    return record ? { ...record } : null;
  }

  async guestMigrationForAccount(accountId: string): Promise<GuestMigrationRecord | null> {
    for (const record of this.migrations.values()) {
      if (record.accountId === accountId) return { ...record };
    }
    return null;
  }

  async recordGuestMigration(record: GuestMigrationRecord): Promise<WriteOutcome> {
    for (const existing of this.migrations.values()) {
      if (existing.accountId === record.accountId) return 'conflict';
    }
    if (this.migrations.has(record.guestId)) return 'conflict';
    this.migrations.set(record.guestId, { ...record });
    return 'ok';
  }

  async recordCareerMatch(accountId: string, record: CareerMatchRecord): Promise<WriteOutcome> {
    const rows = this.career.get(accountId) ?? [];
    if (rows.some((existing) => existing.ref === record.ref)) return 'conflict';
    rows.push({ ...record });
    this.career.set(accountId, rows);
    return 'ok';
  }

  async careerMatches(accountId: string, limit: number): Promise<CareerMatchRecord[]> {
    const rows = this.career.get(accountId) ?? [];
    return [...rows]
      .sort((left, right) => right.recordedAt - left.recordedAt || left.ref.localeCompare(right.ref))
      .slice(0, Math.max(1, Math.min(200, Math.floor(limit))))
      .map((record) => ({ ...record }));
  }

  async careerTotals(accountId: string): Promise<CareerTotals> {
    const rows = this.career.get(accountId);
    return rows && rows.length > 0 ? summariseCareer(rows) : { ...EMPTY_CAREER };
  }

  async countRateLimit(bucket: string, windowStart: number): Promise<number> {
    const key = `${bucket}:${windowStart}`;
    const next = (this.limits.get(key) ?? 0) + 1;
    this.limits.set(key, next);
    return next;
  }

  /** Test hook: every stored session, for asserting rotation and revocation. */
  allSessions(): SessionRecord[] {
    return [...this.sessions.values()].map((session) => ({ ...session }));
  }
}
