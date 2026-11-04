/**
 * Account domain vocabulary and the store port.
 *
 * The port is deliberately narrow and synchronous-shaped (promises only, no
 * SQL, no Cloudflare types): the D1 implementation lives beside it, and the
 * tests use an in-memory implementation of exactly the same contract. That is
 * what lets the OAuth, session and migration rules be exercised for real rather
 * than against a mock of HTTP.
 */

import type { CareerMatchRecord, CareerTotals } from './career';

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
   * Append one career match. `conflict` means this account already has a match
   * with the same `ref`: the caller reports the existing career, never a second
   * award.
   */
  recordCareerMatch(accountId: string, record: CareerMatchRecord): Promise<WriteOutcome>;
  /** Newest first, capped by the caller so a huge history cannot be requested. */
  careerMatches(accountId: string, limit: number): Promise<CareerMatchRecord[]>;
  /** Aggregated from the ledger, never a separately maintained balance. */
  careerTotals(accountId: string): Promise<CareerTotals>;

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
});

export type AccountErrorCode =
  | 'invalid-request'
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
