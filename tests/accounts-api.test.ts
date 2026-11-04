import { describe, expect, it } from 'vitest';
import { TICKET_TTL_MS, verifyTicket } from '../src/accounts/tickets';
import {
  AccountHarness,
  APP_ORIGIN,
  cookieHeader,
  fullCookie,
  GOOGLE_CLIENT_ID,
  TICKET_SECRET,
} from './accounts-harness';

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function errorCode(value: Record<string, unknown>): string | null {
  const error = value.error as Record<string, unknown> | undefined;
  return typeof error?.code === 'string' ? error.code : null;
}

function location(response: Response): string {
  return response.headers.get('Location') ?? '';
}

describe('account API surface', () => {
  it('reports health and the providers this deployment can actually use', async () => {
    const harness = await AccountHarness.create({ discord: false });
    const health = await body(await harness.request('/health'));
    expect(health.ok).toBe(true);
    expect(health.providers).toEqual(['google']);
  });

  it('answers an anonymous /me without a session and never sets a cookie', async () => {
    const harness = await AccountHarness.create();
    const response = await harness.request('/me');
    const value = await body(response);
    expect(value.authenticated).toBe(false);
    expect(value.account).toBeNull();
    expect(value.providers).toEqual(['google', 'discord']);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('rejects unknown routes and wrong methods', async () => {
    const harness = await AccountHarness.create();
    expect((await harness.request('/nope')).status).toBe(404);
    expect((await harness.request('/logout')).status).toBe(405);
    expect((await harness.request('/me', { method: 'POST' })).status).toBe(405);
  });
});

describe('Google sign-in', () => {
  it('creates one account, issues a hardened session, and reports it', async () => {
    const harness = await AccountHarness.create();
    const signedIn = await harness.signInGoogle('google-sub-1');
    expect(signedIn.response.status).toBe(302);
    expect(location(signedIn.response)).toBe(`${APP_ORIGIN}/?auth=signed-in`);

    const cookie = fullCookie(signedIn.response, 'mca_session');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(signedIn.accountId).not.toBeNull();

    const me = await harness.me(signedIn.cookie);
    expect(me.authenticated).toBe(true);
    const account = me.account as Record<string, unknown>;
    expect(account.displayName).toBe('Commander Hale');
    expect(account.identities).toEqual([
      expect.objectContaining({ provider: 'google', displayName: 'Commander Hale' }),
    ]);
    // The provider subject and email are external identifiers the browser does
    // not need, so they are not returned.
    expect(JSON.stringify(me)).not.toContain('google-sub-1');
    expect(JSON.stringify(me)).not.toContain('commander@example.com');
  });

  it('resolves the same provider identity to the same account instead of duplicating it', async () => {
    const harness = await AccountHarness.create();
    const first = await harness.signInGoogle('google-sub-1');
    const second = await harness.signInGoogle('google-sub-1');
    expect(second.accountId).toBe(first.accountId);
    expect(harness.store.allSessions()).toHaveLength(2);
  });

  it('refuses a callback whose state does not match the cookie', async () => {
    const harness = await AccountHarness.create();
    const started = await harness.start('google');
    const response = await harness.callback('google', {
      state: 'forged-state',
      oauthCookie: started.oauthCookie,
    });
    expect(location(response)).toContain('auth=error');
    expect(location(response)).toContain('state-mismatch');
    expect(cookieHeader(response, 'mca_session')).toBeNull();
  });

  it('reports a provider cancellation as a cancellation, not an error 500', async () => {
    const harness = await AccountHarness.create();
    const response = await harness.request('/auth/google/callback?error=access_denied');
    expect(response.status).toBe(302);
    expect(location(response)).toContain('code=cancelled');
  });

  it('refuses to start a provider it has no credentials for', async () => {
    const harness = await AccountHarness.create({ google: false });
    const response = await harness.request('/auth/google/start');
    const value = await body(response);
    expect(response.status).toBe(503);
    expect(errorCode(value)).toBe('provider-not-configured');
  });

  it('does not accept a pre-authentication session as the new session', async () => {
    const harness = await AccountHarness.create();
    const existing = await harness.signInGoogle('google-sub-1');
    const rotated = await harness.signInGoogle('google-sub-2', { cookie: `mca_session=${existing.cookie}` });
    expect(rotated.cookie).not.toBe(existing.cookie);
    expect(await harness.accountIdForCookie(existing.cookie)).toBeNull();
    expect(await harness.accountIdForCookie(rotated.cookie)).toBe(rotated.accountId);
  });
});

describe('provider linking', () => {
  it('links a second provider and rotates the session that authorised it', async () => {
    const harness = await AccountHarness.create();
    const google = await harness.signInGoogle('google-sub-1');
    const started = await harness.start('discord', {
      mode: 'link',
      cookie: `mca_session=${google.cookie}`,
    });
    const response = await harness.callback('discord', {
      state: started.state,
      oauthCookie: started.oauthCookie,
      cookie: `mca_session=${google.cookie}`,
    });
    expect(location(response)).toBe(`${APP_ORIGIN}/?auth=linked`);
    const rotated = cookieHeader(response, 'mca_session');
    expect(rotated).not.toBeNull();
    expect(rotated).not.toBe(google.cookie);

    const me = await harness.me(rotated);
    const account = me.account as Record<string, unknown>;
    expect((account.identities as Array<unknown>).length).toBe(2);
    expect(await harness.accountIdForCookie(google.cookie)).toBeNull();
    expect(await harness.accountIdForCookie(rotated)).toBe(google.accountId);
  });

  it('refuses to absorb a login that belongs to another account', async () => {
    const harness = await AccountHarness.create();
    const owner = await harness.signInGoogle('google-shared');
    const other = await harness.signInDiscord();
    expect(other.accountId).not.toBe(owner.accountId);

    const started = await harness.start('google', { mode: 'link', cookie: `mca_session=${other.cookie}` });
    const response = await harness.callback('google', {
      state: started.state,
      oauthCookie: started.oauthCookie,
      cookie: `mca_session=${other.cookie}`,
    });
    expect(location(response)).toContain('identity-in-use');

    // Neither account changed hands.
    expect(await harness.accountIdForCookie(other.cookie)).toBe(other.accountId);
    expect(await harness.accountIdForCookie(owner.cookie)).toBe(owner.accountId);
    const identities = await harness.store.identities(owner.accountId!);
    expect(identities).toHaveLength(1);
  });

  it('requires a session to start a link', async () => {
    const harness = await AccountHarness.create();
    const response = await harness.request('/auth/google/start?mode=link');
    expect(response.status).toBe(401);
    expect(errorCode(await body(response))).toBe('unauthorized');
  });

  it('unlinks only while another sign-in method remains', async () => {
    const harness = await AccountHarness.create();
    const google = await harness.signInGoogle('google-sub-1');
    const linked = await harness.link('discord', `mca_session=${google.cookie}`);
    expect(linked.response.status).toBe(302);
    expect(linked.cookie).not.toBeNull();
    const session = `mca_session=${linked.cookie}`;

    const removed = await harness.request('/providers/google/unlink', { method: 'POST', cookie: session });
    expect(removed.status).toBe(200);
    const rotated = cookieHeader(removed, 'mca_session');
    expect(rotated).not.toBeNull();
    expect(rotated).not.toBe(linked.cookie);

    const last = await harness.request('/providers/discord/unlink', {
      method: 'POST',
      cookie: `mca_session=${rotated}`,
    });
    expect(last.status).toBe(409);
    expect(errorCode(await body(last))).toBe('last-identity');
  });

  it('reports a method that is not linked', async () => {
    const harness = await AccountHarness.create();
    const google = await harness.signInGoogle('google-sub-1');
    const response = await harness.request('/providers/discord/unlink', {
      method: 'POST',
      cookie: `mca_session=${google.cookie}`,
    });
    expect(response.status).toBe(404);
    expect(errorCode(await body(response))).toBe('identity-not-linked');
  });
});

describe('sessions', () => {
  it('revokes the current session on logout and clears the cookie', async () => {
    const harness = await AccountHarness.create();
    const signedIn = await harness.signInGoogle('google-sub-1');
    const response = await harness.request('/logout', {
      method: 'POST',
      cookie: `mca_session=${signedIn.cookie}`,
    });
    expect(response.status).toBe(200);
    expect(fullCookie(response, 'mca_session')).toContain('Max-Age=0');
    expect(await harness.accountIdForCookie(signedIn.cookie)).toBeNull();
  });

  it('signs out every session on request', async () => {
    const harness = await AccountHarness.create();
    const first = await harness.signInGoogle('google-sub-1');
    const second = await harness.signInGoogle('google-sub-1');
    const response = await harness.request('/sessions/revoke-all', {
      method: 'POST',
      cookie: `mca_session=${first.cookie}`,
    });
    expect(response.status).toBe(200);
    expect((await body(response)).revoked).toBe(2);
    expect(await harness.accountIdForCookie(first.cookie)).toBeNull();
    expect(await harness.accountIdForCookie(second.cookie)).toBeNull();
  });

  it('ignores a client-supplied account id and only affects the session’s own account', async () => {
    const harness = await AccountHarness.create();
    const victim = await harness.signInGoogle('google-victim');
    const attacker = await harness.signInDiscord();

    const response = await harness.request('/sessions/revoke-all', {
      method: 'POST',
      cookie: `mca_session=${attacker.cookie}`,
      body: { accountId: victim.accountId },
    });
    expect(response.status).toBe(200);
    expect((await body(response)).revoked).toBe(1);
    expect(await harness.accountIdForCookie(victim.cookie)).toBe(victim.accountId);
  });

  it('stops resolving a session once the account is suspended', async () => {
    const harness = await AccountHarness.create();
    const signedIn = await harness.signInGoogle('google-sub-1');
    harness.store.setStatus(signedIn.accountId!, 'suspended');
    expect((await harness.me(signedIn.cookie)).authenticated).toBe(false);
  });
});

describe('guest migration', () => {
  const guest = {
    guestId: 'guest-identifier-0123456789',
    migrationKey: 'migration-key-0123456789',
    profileDigest: 'a'.repeat(64),
  };

  it('records the import, then confirms a retry without duplicating it', async () => {
    const harness = await AccountHarness.create();
    const signedIn = await harness.signInGoogle('google-sub-1');
    const cookie = `mca_session=${signedIn.cookie}`;

    const first = await harness.request('/migrate/guest', { method: 'POST', cookie, body: guest });
    expect(first.status).toBe(200);
    expect((await body(first)).status).toBe('migrated');

    const retry = await harness.request('/migrate/guest', { method: 'POST', cookie, body: guest });
    expect(retry.status).toBe(200);
    expect((await body(retry)).status).toBe('already-migrated');
    expect((await harness.store.guestMigration(guest.guestId))?.accountId).toBe(signedIn.accountId);
  });

  it('refuses a guest already linked to another account instead of merging', async () => {
    const harness = await AccountHarness.create();
    const owner = await harness.signInGoogle('google-sub-1');
    const other = await harness.signInDiscord();
    await harness.request('/migrate/guest', {
      method: 'POST',
      cookie: `mca_session=${owner.cookie}`,
      body: guest,
    });

    const response = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie: `mca_session=${other.cookie}`,
      body: guest,
    });
    expect(response.status).toBe(409);
    expect(errorCode(await body(response))).toBe('guest-already-migrated');
    expect((await harness.store.guestMigration(guest.guestId))?.accountId).toBe(owner.accountId);
  });

  it('refuses a second guest profile on the same account', async () => {
    const harness = await AccountHarness.create();
    const signedIn = await harness.signInGoogle('google-sub-1');
    const cookie = `mca_session=${signedIn.cookie}`;
    await harness.request('/migrate/guest', { method: 'POST', cookie, body: guest });
    const response = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie,
      body: { ...guest, guestId: 'another-guest-identifier-1234' },
    });
    expect(response.status).toBe(409);
    expect(errorCode(await body(response))).toBe('account-already-migrated');
  });

  it('reports a changed profile as a conflict rather than overwriting it', async () => {
    const harness = await AccountHarness.create();
    const signedIn = await harness.signInGoogle('google-sub-1');
    const cookie = `mca_session=${signedIn.cookie}`;
    await harness.request('/migrate/guest', { method: 'POST', cookie, body: guest });
    const response = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie,
      body: { ...guest, profileDigest: 'b'.repeat(64) },
    });
    expect(response.status).toBe(409);
    expect(errorCode(await body(response))).toBe('migration-conflict');
  });

  it('validates every field before writing', async () => {
    const harness = await AccountHarness.create();
    const signedIn = await harness.signInGoogle('google-sub-1');
    const cookie = `mca_session=${signedIn.cookie}`;
    const cases: Array<Record<string, unknown>> = [
      { ...guest, guestId: 'short' },
      { ...guest, migrationKey: 'tiny' },
      { ...guest, profileDigest: 'not-a-digest' },
      {},
    ];
    for (const value of cases) {
      const response = await harness.request('/migrate/guest', { method: 'POST', cookie, body: value });
      expect(response.status).toBe(400);
      expect(errorCode(await body(response))).toBe('invalid-request');
    }
    expect(await harness.store.guestMigration(guest.guestId)).toBeNull();
  });

  it('requires a session', async () => {
    const harness = await AccountHarness.create();
    const response = await harness.request('/migrate/guest', { method: 'POST', body: guest });
    expect(response.status).toBe(401);
  });
});

describe('multiplayer identity ticket', () => {
  it('issues a ticket only to a signed-in caller and it verifies for the room', async () => {
    const harness = await AccountHarness.create();
    const signedIn = await harness.signInGoogle('google-sub-1');
    const response = await harness.request('/multiplayer/ticket', {
      method: 'POST',
      cookie: `mca_session=${signedIn.cookie}`,
    });
    expect(response.status).toBe(200);
    const value = await body(response);
    expect(typeof value.ticket).toBe('string');
    expect(value.expiresAt).toBe(harness.now + TICKET_TTL_MS);
    const verified = await verifyTicket(TICKET_SECRET, String(value.ticket), harness.now);
    expect(verified?.accountId).toBe(signedIn.accountId);

    const anonymous = await harness.request('/multiplayer/ticket', { method: 'POST' });
    expect(anonymous.status).toBe(401);
  });

  it('refuses to issue a ticket when the deployment has no shared secret', async () => {
    const harness = await AccountHarness.create({ ticketSecret: null });
    const signedIn = await harness.signInGoogle('google-sub-1');
    const response = await harness.request('/multiplayer/ticket', {
      method: 'POST',
      cookie: `mca_session=${signedIn.cookie}`,
    });
    expect(response.status).toBe(503);
  });
});

describe('request hardening', () => {
  it('rejects a state-changing request from a foreign origin', async () => {
    const harness = await AccountHarness.create();
    const signedIn = await harness.signInGoogle('google-sub-1');
    const response = await harness.request('/logout', {
      method: 'POST',
      cookie: `mca_session=${signedIn.cookie}`,
      origin: 'https://evil.test',
    });
    expect(response.status).toBe(403);
    expect(errorCode(await body(response))).toBe('forbidden-origin');
    expect(await harness.accountIdForCookie(signedIn.cookie)).toBe(signedIn.accountId);
  });

  it('rejects a cross-site fetch even when the origin header looks acceptable', async () => {
    const harness = await AccountHarness.create();
    const response = await harness.request('/logout', {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors' },
    });
    expect(response.status).toBe(403);
  });

  it('rejects a request addressed to a host this service does not serve', async () => {
    const harness = await AccountHarness.create();
    const response = await harness.request('/me', { url: 'https://evil.test/api/account/me' });
    expect(response.status).toBe(403);
    expect(errorCode(await body(response))).toBe('forbidden-origin');
  });

  it('rate-limits repeated authorisation starts', async () => {
    const harness = await AccountHarness.create();
    let last: Response | null = null;
    for (let index = 0; index < 31; index++) {
      last = await harness.request('/auth/google/start');
    }
    expect(last?.status).toBe(429);
    expect(errorCode(await body(last!))).toBe('rate-limited');
  });

  it('rejects a malformed body without touching the store', async () => {
    const harness = await AccountHarness.create();
    const signedIn = await harness.signInGoogle('google-sub-1');
    const response = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie: `mca_session=${signedIn.cookie}`,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(400);
    expect(await harness.store.identities(signedIn.accountId!)).toHaveLength(1);
  });

  it('does not leak a provider id or secret when the provider refuses', async () => {
    const harness = await AccountHarness.create();
    harness.googleTokenStatus = 400;
    const started = await harness.start('google');
    const response = await harness.callback('google', {
      state: started.state,
      oauthCookie: started.oauthCookie,
    });
    expect(location(response)).toContain('code=provider-error');
    expect(location(response)).not.toContain(GOOGLE_CLIENT_ID);
    expect(location(response)).not.toContain('google-secret');
    expect(cookieHeader(response, 'mca_session')).toBeNull();
  });
});
