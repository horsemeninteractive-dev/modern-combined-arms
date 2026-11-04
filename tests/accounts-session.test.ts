import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/accounts/crypto';
import {
  clearCookie,
  parseCookies,
  SESSION_COOKIE,
  SESSION_TOUCH_INTERVAL_MS,
  SessionService,
  serializeCookie,
} from '../src/accounts/session';
import { AccountHarness } from './accounts-harness';

describe('account cookies', () => {
  it('parses a cookie header without trusting duplicates or junk', () => {
    const cookies = parseCookies('mca_session=abc; mca_session=def; broken; =empty; mca_oauth=xyz');
    expect(cookies.get('mca_session')).toBe('abc');
    expect(cookies.get('mca_oauth')).toBe('xyz');
    expect(cookies.get('broken')).toBeUndefined();
    expect(parseCookies(null).size).toBe(0);
  });

  it('issues an HttpOnly, Secure, SameSite=Lax session cookie', () => {
    const cookie = serializeCookie(SESSION_COOKIE, 'token-value', {
      secure: true,
      sameSite: 'Lax',
      maxAgeSeconds: 60,
    });
    expect(cookie).toContain('mca_session=token-value');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=60');
  });

  it('clears with an expired Max-Age and keeps the same scope', () => {
    const cookie = clearCookie(SESSION_COOKIE, { secure: true });
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
  });

  it('omits Secure only when a deployment explicitly runs in development', () => {
    const cookie = serializeCookie(SESSION_COOKIE, 'value', { secure: false });
    expect(cookie).not.toContain('Secure');
    expect(cookie).toContain('HttpOnly');
  });
});

describe('session lifecycle', () => {
  it('stores only a hash of the token and resolves the raw token once', async () => {
    const harness = await AccountHarness.create();
    const sessions = new SessionService(harness.store, harness.config);
    await harness.store.createAccount({ id: 'account-1', now: harness.now });
    const issued = await sessions.issue('account-1');

    const stored = harness.store.allSessions()[0];
    expect(stored.tokenHash).not.toBe(issued.token);
    expect(stored.tokenHash).toBe(await sha256Hex(issued.token));
    expect(JSON.stringify(stored)).not.toContain(issued.token);

    const resolved = await sessions.resolve(issued.token);
    expect(resolved?.account.id).toBe('account-1');
    expect(resolved?.session.id).toBe(issued.session.id);
    expect(await sessions.resolve(`${issued.token}x`)).toBeNull();
    expect(await sessions.resolve(null)).toBeNull();
  });

  it('rejects an expired session and a revoked session', async () => {
    const harness = await AccountHarness.create();
    const sessions = new SessionService(harness.store, harness.config);
    await harness.store.createAccount({ id: 'account-1', now: harness.now });

    const expired = await sessions.issue('account-1');
    harness.advance(harness.config.sessionTtlMs + 1);
    expect(await sessions.resolve(expired.token)).toBeNull();

    const revoked = await sessions.issue('account-1');
    const resolved = await sessions.resolve(revoked.token);
    expect(resolved).not.toBeNull();
    await sessions.revoke(resolved!.session);
    expect(await sessions.resolve(revoked.token)).toBeNull();
  });

  it('refreshes the idle deadline at most once a day', async () => {
    const harness = await AccountHarness.create();
    const sessions = new SessionService(harness.store, harness.config);
    await harness.store.createAccount({ id: 'account-1', now: harness.now });
    const issued = await sessions.issue('account-1');
    const initial = harness.store.allSessions()[0];

    harness.advance(SESSION_TOUCH_INTERVAL_MS - 1000);
    await sessions.resolve(issued.token);
    expect(harness.store.allSessions()[0].expiresAt).toBe(initial.expiresAt);

    harness.advance(2000);
    await sessions.resolve(issued.token);
    const refreshed = harness.store.allSessions()[0];
    expect(refreshed.expiresAt).toBeGreaterThan(initial.expiresAt);
    expect(refreshed.lastSeenAt).toBe(harness.now);
  });

  it('refuses a session whose account is no longer active', async () => {
    const harness = await AccountHarness.create();
    const sessions = new SessionService(harness.store, harness.config);
    await harness.store.createAccount({ id: 'account-1', now: harness.now });
    const issued = await sessions.issue('account-1');
    harness.store.setStatus('account-1', 'suspended');
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  it('revokes every session for an account', async () => {
    const harness = await AccountHarness.create();
    const sessions = new SessionService(harness.store, harness.config);
    await harness.store.createAccount({ id: 'account-1', now: harness.now });
    const first = await sessions.issue('account-1');
    const second = await sessions.issue('account-1');
    expect(await sessions.revokeAll('account-1')).toBe(2);
    expect(await sessions.resolve(first.token)).toBeNull();
    expect(await sessions.resolve(second.token)).toBeNull();
  });
});
