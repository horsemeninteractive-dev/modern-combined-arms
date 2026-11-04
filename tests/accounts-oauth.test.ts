import { describe, expect, it } from 'vitest';
import { base64urlEncode, pkceChallenge, sha256Base64url } from '../src/accounts/crypto';
import {
  beginAuthorization,
  completeDiscord,
  completeGoogle,
  decodeOAuthState,
  encodeOAuthState,
  OAUTH_STATE_MAX_AGE_MS,
  resetJwksCache,
  verifyState,
} from '../src/accounts/oauth';
import { AccountError } from '../src/accounts/types';
import {
  AccountHarness,
  createGoogleSigningKey,
  DISCORD_CLIENT_ID,
  GOOGLE_CLIENT_ID,
  jsonResponse,
  signJwt,
} from './accounts-harness';

function providerOf(harness: AccountHarness, provider: 'google' | 'discord') {
  const config = harness.config.providers[provider];
  if (!config) throw new Error(`${provider} is not configured in the harness`);
  return config;
}

async function expectAccountError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AccountError);
  await promise.catch((error: AccountError) => expect(error.code).toBe(code));
}

describe('authorisation start', () => {
  it('builds a PKCE Google authorisation URL bound to a fresh state and nonce', async () => {
    const harness = await AccountHarness.create();
    const started = await beginAuthorization(harness.config, 'google', 'signin', undefined);
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(GOOGLE_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/api/account/auth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(await pkceChallenge(started.record.verifier));
    expect(url.searchParams.get('state')).toBe(started.record.state);
    expect(url.searchParams.get('nonce')).toBe(started.record.nonce);
    expect(started.record.state).not.toBe(started.record.nonce);
    expect(started.record.verifier.length).toBeGreaterThanOrEqual(32);
  });

  it('carries the account for a link and never puts a secret in the URL', async () => {
    const harness = await AccountHarness.create();
    const started = await beginAuthorization(harness.config, 'discord', 'link', 'account-1234567890');
    const url = new URL(started.url);
    expect(url.searchParams.get('client_id')).toBe(DISCORD_CLIENT_ID);
    expect(url.searchParams.get('scope')).toBe('identify');
    expect(started.record.mode).toBe('link');
    expect(started.record.accountId).toBe('account-1234567890');
    expect(url.toString()).not.toContain('discord-secret');
  });

  it('round-trips the state cookie and rejects anything altered', async () => {
    const harness = await AccountHarness.create();
    const started = await beginAuthorization(harness.config, 'google', 'signin', undefined);
    const encoded = encodeOAuthState(started.record);
    expect(decodeOAuthState(encoded)?.state).toBe(started.record.state);
    expect(decodeOAuthState('not-base64url-json')).toBeNull();
    expect(decodeOAuthState(base64urlEncode(new TextEncoder().encode('{"v":2}')))).toBeNull();
  });
});

describe('state validation', () => {
  it('accepts the matching state cookie and refuses every mismatch', async () => {
    const harness = await AccountHarness.create();
    const started = await beginAuthorization(harness.config, 'google', 'signin', undefined);
    const cookie = encodeOAuthState(started.record);
    expect(verifyState(cookie, started.record.state, 'google', harness.now).state).toBe(started.record.state);

    expect(() => verifyState(null, started.record.state, 'google', harness.now)).toThrow(AccountError);
    expect(() => verifyState(cookie, 'another-state', 'google', harness.now)).toThrow(AccountError);
    expect(() => verifyState(cookie, started.record.state, 'discord', harness.now)).toThrow(AccountError);
    expect(() =>
      verifyState(cookie, started.record.state, 'google', harness.now + OAUTH_STATE_MAX_AGE_MS + 1),
    ).toThrow(AccountError);
  });
});

describe('Google identity tokens', () => {
  it('accepts a correctly signed, correctly scoped token', async () => {
    const harness = await AccountHarness.create();
    const identity = await completeGoogle(
      providerOf(harness, 'google'),
      'code',
      'verifier',
      'expected-nonce',
      async (input) =>
        input.includes('certs')
          ? jsonResponse({ keys: [harness.key.jwk] })
          : jsonResponse({ id_token: await harness.googleIdToken({ nonce: 'expected-nonce' }) }),
      harness.now,
    );
    expect(identity).toMatchObject({
      provider: 'google',
      subject: 'google-sub-default',
      displayName: 'Commander Hale',
      email: 'commander@example.com',
    });
  });

  it('sends the PKCE verifier and code to the token endpoint, never the secret to the browser', async () => {
    const harness = await AccountHarness.create();
    const bodies: string[] = [];
    await completeGoogle(
      providerOf(harness, 'google'),
      'the-code',
      'the-verifier',
      'nonce',
      (input, init) => {
        if (input.includes('certs')) {
          return Promise.resolve(jsonResponse({ keys: [harness.key.jwk] }));
        }
        bodies.push(String(init?.body));
        return harness.googleIdToken({ nonce: 'nonce' }).then((id_token) => jsonResponse({ id_token }));
      },
      harness.now,
    );
    const body = new URLSearchParams(bodies[0]);
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe(providerOf(harness, 'google').redirectUri);
    expect(body.get('client_secret')).toBe('google-secret');
  });

  it('rejects a token from the wrong issuer, audience, or a stale clock', async () => {
    const harness = await AccountHarness.create();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ iss: 'https://evil.test' }, 'provider-error'],
      [{ aud: 'another-client' }, 'provider-error'],
      [{ exp: Math.floor(harness.now / 1000) - 600 }, 'provider-error'],
      [{ iat: Math.floor(harness.now / 1000) + 600 }, 'provider-error'],
      [{ nonce: 'someone-elses-nonce' }, 'state-mismatch'],
    ];
    for (const [claims, code] of cases) {
      resetJwksCache();
      const token = await harness.googleIdToken({ nonce: 'expected-nonce', ...claims });
      await expectAccountError(
        completeGoogle(
          providerOf(harness, 'google'),
          'code',
          'verifier',
          'expected-nonce',
          (input) =>
            input.includes('certs')
              ? Promise.resolve(jsonResponse({ keys: [harness.key.jwk] }))
              : Promise.resolve(jsonResponse({ id_token: token })),
          harness.now,
        ),
        code,
      );
    }
  });

  it('rejects a forged signature, an unknown key id, and algorithm substitution', async () => {
    const harness = await AccountHarness.create();
    const other = await createGoogleSigningKey();
    const serve = (token: string) => (input: string) =>
      input.includes('certs')
        ? Promise.resolve(jsonResponse({ keys: [harness.key.jwk] }))
        : Promise.resolve(jsonResponse({ id_token: token }));

    const foreignToken = await signJwt(other, {
      nonce: 'expected-nonce',
      iss: 'https://accounts.google.com',
      aud: GOOGLE_CLIENT_ID,
      sub: 'x',
      exp: Math.floor(harness.now / 1000) + 60,
    });
    const unknownKeyToken = await harness.googleIdToken({ nonce: 'expected-nonce' }, { kid: 'not-published' });
    const unsignedToken = await harness.googleIdToken({ nonce: 'expected-nonce' }, { alg: 'none' });

    await expectAccountError(
      completeGoogle(providerOf(harness, 'google'), 'c', 'v', 'expected-nonce', serve(foreignToken), harness.now),
      'provider-error',
    );
    await expectAccountError(
      completeGoogle(providerOf(harness, 'google'), 'c', 'v', 'expected-nonce', serve(unknownKeyToken), harness.now),
      'provider-error',
    );
    await expectAccountError(
      completeGoogle(providerOf(harness, 'google'), 'c', 'v', 'expected-nonce', serve(unsignedToken), harness.now),
      'provider-error',
    );
  });

  it('fails cleanly when the provider is unreachable or publishes no keys', async () => {
    const harness = await AccountHarness.create();
    await expectAccountError(
      completeGoogle(providerOf(harness, 'google'), 'c', 'v', 'n', () => Promise.reject(new Error('offline')), harness.now),
      'provider-error',
    );
    resetJwksCache();
    await expectAccountError(
      completeGoogle(
        providerOf(harness, 'google'),
        'c',
        'v',
        'n',
        () => Promise.resolve(jsonResponse({ keys: [] })),
        harness.now,
      ),
      'provider-error',
    );
  });

  it('requires an identity token to be present at all', async () => {
    const harness = await AccountHarness.create();
    await expectAccountError(
      completeGoogle(providerOf(harness, 'google'), 'c', 'v', 'n', () => Promise.resolve(jsonResponse({})), harness.now),
      'provider-error',
    );
  });
});

describe('Discord identity', () => {
  it('reads the stable user id and builds avatar metadata without requiring email', async () => {
    const harness = await AccountHarness.create();
    harness.discordUser = {
      id: '223456789012345678',
      username: 'east.cmd',
      global_name: 'East Command',
      avatar: 'abc123',
    };
    const identity = await completeDiscord(
      providerOf(harness, 'discord'),
      'code',
      'verifier',
      (input) => harness.deps().fetch(input),
    );
    expect(identity.subject).toBe('223456789012345678');
    expect(identity.displayName).toBe('East Command');
    expect(identity.email).toBeNull();
    expect(identity.avatarUrl).toBe(
      'https://cdn.discordapp.com/avatars/223456789012345678/abc123.png?size=128',
    );
  });

  it('falls back to the username and a null avatar when Discord omits details', async () => {
    const harness = await AccountHarness.create();
    harness.discordUser = { id: '323456789012345678', username: 'plain.callsign', avatar: null };
    const identity = await completeDiscord(providerOf(harness, 'discord'), 'c', 'v', (input) =>
      harness.deps().fetch(input),
    );
    expect(identity.displayName).toBe('plain.callsign');
    expect(identity.avatarUrl).toBeNull();
  });

  it('refuses a response with no usable stable id', async () => {
    const harness = await AccountHarness.create();
    harness.discordUser = { id: 'not-a-snowflake', username: 'x' };
    await expectAccountError(
      completeDiscord(providerOf(harness, 'discord'), 'c', 'v', (input) => harness.deps().fetch(input)),
      'provider-error',
    );
  });

  it('maps a refused token exchange and a refused profile read to provider-error', async () => {
    const harness = await AccountHarness.create();
    harness.discordTokenStatus = 400;
    await expectAccountError(
      completeDiscord(providerOf(harness, 'discord'), 'c', 'v', (input) => harness.deps().fetch(input)),
      'provider-error',
    );
    harness.discordTokenStatus = 200;
    harness.discordUserStatus = 401;
    await expectAccountError(
      completeDiscord(providerOf(harness, 'discord'), 'c', 'v', (input) => harness.deps().fetch(input)),
      'provider-error',
    );
  });
});

describe('PKCE helpers', () => {
  it('produces the S256 challenge of the verifier', async () => {
    const verifier = 'a'.repeat(64);
    expect(await pkceChallenge(verifier)).toBe(await sha256Base64url(verifier));
  });
});
