/**
 * Session issuing, resolution and cookie handling.
 *
 * The token exists exactly twice: in the browser's HttpOnly cookie and in the
 * raw form for the instant it is hashed for storage. D1 only ever holds the
 * hash, so a database leak does not hand an attacker live sessions.
 */
import { randomToken, sha256Hex } from './crypto';
import type { AccountRecord, AccountStore, SessionRecord } from './types';
import type { AccountConfig } from './config';

export const SESSION_COOKIE = 'mca_session';
export const OAUTH_COOKIE = 'mca_oauth';
/** Activity refreshes the idle deadline at most this often. */
export const SESSION_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name || cookies.has(name)) continue;
    cookies.set(name, value);
  }
  return cookies;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  secure: boolean;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`, `Path=${options.path ?? '/'}`];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  if (options.httpOnly === false) {
    /* explicit opt-out only; HTTP-only is the default for every auth cookie */
  } else {
    parts.push('HttpOnly');
  }
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, options: CookieOptions): string {
  return serializeCookie(name, '', { ...options, maxAgeSeconds: 0 });
}

export interface IssuedSession {
  token: string;
  session: SessionRecord;
}

export interface ResolvedSession {
  session: SessionRecord;
  account: AccountRecord;
}

export class SessionService {
  private readonly store: AccountStore;
  private readonly config: AccountConfig;

  constructor(store: AccountStore, config: AccountConfig) {
    this.store = store;
    this.config = config;
  }

  async issue(accountId: string): Promise<IssuedSession> {
    const now = this.config.now();
    const token = randomToken();
    const session: SessionRecord = {
      id: randomToken(16),
      accountId,
      tokenHash: await sha256Hex(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.config.sessionTtlMs,
      revokedAt: null,
    };
    await this.store.createSession({
      id: session.id,
      accountId,
      tokenHash: session.tokenHash,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    });
    return { token, session };
  }

  /**
   * Resolve a raw cookie token to a live session and an active account.
   *
   * Every failure — unknown token, revoked, expired, suspended account — returns
   * null, so the caller cannot accidentally distinguish which one happened.
   */
  async resolve(token: string | null | undefined): Promise<ResolvedSession | null> {
    if (!token) return null;
    const session = await this.store.sessionByHash(await sha256Hex(token));
    if (!session) return null;
    const now = this.config.now();
    if (session.revokedAt !== null) return null;
    if (session.expiresAt <= now) return null;
    const account = await this.store.account(session.accountId);
    if (!account || account.status !== 'active') return null;
    if (now - session.lastSeenAt >= SESSION_TOUCH_INTERVAL_MS) {
      const expiresAt = now + this.config.sessionTtlMs;
      await this.store.touchSession(session.id, now, expiresAt);
      session.lastSeenAt = now;
      session.expiresAt = expiresAt;
    }
    return { session, account };
  }

  async revoke(session: SessionRecord): Promise<void> {
    await this.store.revokeSession(session.id, this.config.now());
  }

  async revokeAll(accountId: string): Promise<number> {
    return this.store.revokeAllSessions(accountId, this.config.now());
  }

  sessionCookie(token: string): string {
    return serializeCookie(SESSION_COOKIE, token, {
      secure: this.config.cookieSecure,
      sameSite: 'Lax',
      maxAgeSeconds: Math.floor(this.config.sessionTtlMs / 1000),
    });
  }

  clearedSessionCookie(): string {
    return clearCookie(SESSION_COOKIE, { secure: this.config.cookieSecure, sameSite: 'Lax' });
  }
}
