/**
 * Shared harness for the account tests.
 *
 * It builds a real router against the in-memory store, a fixed clock and a fake
 * provider transport that speaks Google's and Discord's actual response shapes.
 * Provider identity tokens are signed with a throwaway RSA key generated here,
 * so token validation is exercised for real and no credentials are needed.
 */
import { base64urlEncode } from '../src/accounts/crypto';
import { decodeOAuthState, resetJwksCache } from '../src/accounts/oauth';
import type { AccountConfig, AccountEnv } from '../src/accounts/config';
import { resolveConfig } from '../src/accounts/config';
import { MemoryAccountStore } from '../src/accounts/memoryStore';
import { handleAccountRequest, type AccountDeps } from '../src/accounts/router';
import type { ProviderId } from '../src/accounts/types';

export const APP_ORIGIN = 'https://app.test';
export const GOOGLE_CLIENT_ID = 'google-client-id.apps.googleusercontent.com';
export const DISCORD_CLIENT_ID = 'discord-client-id';
export const TICKET_SECRET = 'test-ticket-secret-0123456789abcdef';

export interface GoogleSigningKey {
  privateKey: CryptoKey;
  jwk: { kty: string; kid: string; n: string; e: string; alg: string; use: string };
}

export async function createGoogleSigningKey(): Promise<GoogleSigningKey> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    jwk: {
      kty: 'RSA',
      kid: 'test-key',
      n: String(jwk.n),
      e: String(jwk.e),
      alg: 'RS256',
      use: 'sig',
    },
  };
}

export async function signJwt(
  key: GoogleSigningKey,
  claims: Record<string, unknown>,
  options: { kid?: string; alg?: string } = {},
): Promise<string> {
  const header = { alg: options.alg ?? 'RS256', typ: 'JWT', kid: options.kid ?? 'test-key' };
  const encode = (value: unknown): string => base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = response.headers.get('set-cookie');
  return raw ? [raw] : [];
}

export function cookieHeader(response: Response, name: string): string | null {
  for (const cookie of setCookies(response)) {
    if (!cookie.startsWith(`${name}=`)) continue;
    const pair = cookie.split(';')[0];
    return pair.slice(name.length + 1);
  }
  return null;
}

export function fullCookie(response: Response, name: string): string | null {
  return setCookies(response).find((cookie) => cookie.startsWith(`${name}=`)) ?? null;
}

export interface HarnessOptions {
  google?: boolean;
  discord?: boolean;
  ticketSecret?: string | null;
  devMode?: boolean;
}

export class AccountHarness {
  readonly store = new MemoryAccountStore();
  readonly config: AccountConfig;
  readonly key: GoogleSigningKey;
  private readonly clockRef: { value: number };

  /** Provider transport knobs, per test. */
  googleTokenStatus = 200;
  googleJwksStatus = 200;
  discordTokenStatus = 200;
  discordUserStatus = 200;
  discordUser: Record<string, unknown> = {
    id: '123456789012345678',
    username: 'east.cmd',
    global_name: 'East Command',
    avatar: null,
  };
  readonly urls: string[] = [];
  /** Nonce from the most recent authorisation start, echoed by the fake token endpoint. */
  private pendingNonce: string | null = null;
  private pendingProvider: ProviderId | null = null;
  private pendingSubject: string | null = null;

  private constructor(key: GoogleSigningKey, config: AccountConfig, clockRef: { value: number }) {
    this.key = key;
    this.config = config;
    this.clockRef = clockRef;
  }

  static async create(options: HarnessOptions = {}): Promise<AccountHarness> {
    resetJwksCache();
    const key = await createGoogleSigningKey();
    const clockRef = { value: 1_700_000_000_000 };
    const env: AccountEnv = {
      APP_ORIGIN: APP_ORIGIN,
      ...(options.devMode ? { ACCOUNT_DEV_MODE: '1' } : {}),
      ...(options.google === false
        ? {}
        : { GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: 'google-secret' }),
      ...(options.discord === false
        ? {}
        : { DISCORD_CLIENT_ID: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET: 'discord-secret' }),
      ...(options.ticketSecret === null ? {} : { MCA_IDENTITY_TICKET_SECRET: options.ticketSecret ?? TICKET_SECRET }),
    };
    // The config reads the shared clock, so advancing it changes expiry
    // behaviour without rebuilding the service.
    return new AccountHarness(key, resolveConfig(env, () => clockRef.value), clockRef);
  }

  get now(): number {
    return this.clockRef.value;
  }

  get clock(): number {
    return this.clockRef.value;
  }

  set clock(value: number) {
    this.clockRef.value = value;
  }

  advance(ms: number): void {
    this.clockRef.value += ms;
  }

  deps(): AccountDeps {
    return {
      store: this.store,
      config: this.config,
      fetch: (input) => this.provider(input),
    };
  }

  private async provider(input: string): Promise<Response> {
    this.urls.push(input);
    if (input.includes('googleapis.com/oauth2/v3/certs')) {
      return jsonResponse(
        this.googleJwksStatus === 200 ? { keys: [this.key.jwk] } : { error: 'unavailable' },
        this.googleJwksStatus,
      );
    }
    if (input.includes('oauth2.googleapis.com/token')) {
      if (this.googleTokenStatus !== 200) return jsonResponse({ error: 'invalid_grant' }, this.googleTokenStatus);
      return jsonResponse({
        id_token: await this.googleIdToken({
          ...(this.pendingProvider === 'google' && this.pendingNonce ? { nonce: this.pendingNonce } : {}),
          ...(this.pendingSubject ? { sub: this.pendingSubject } : {}),
        }),
      });
    }
    if (input.includes('discord.com/api/oauth2/token')) {
      if (this.discordTokenStatus !== 200) return jsonResponse({ error: 'invalid_grant' }, this.discordTokenStatus);
      return jsonResponse({ access_token: 'discord-access-token', token_type: 'Bearer' });
    }
    if (input.includes('discord.com/api/users/@me')) {
      if (this.discordUserStatus !== 200) return jsonResponse({ message: 'Unauthorized' }, this.discordUserStatus);
      return jsonResponse(this.discordUser);
    }
    throw new Error(`unexpected provider request: ${input}`);
  }

  googleIdToken(
    claims: Record<string, unknown> = {},
    signOptions?: { kid?: string; alg?: string },
  ): Promise<string> {
    return signJwt(
      this.key,
      {
        iss: 'https://accounts.google.com',
        aud: GOOGLE_CLIENT_ID,
        sub: 'google-sub-default',
        email: 'commander@example.com',
        email_verified: true,
        name: 'Commander Hale',
        picture: 'https://lh3.googleusercontent.com/a/test',
        iat: Math.floor(this.now / 1000),
        exp: Math.floor(this.now / 1000) + 3600,
        ...claims,
      },
      signOptions,
    );
  }

  async request(
    path: string,
    init: {
      method?: string;
      cookie?: string | null;
      body?: unknown;
      origin?: string | null;
      url?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Response> {
    const headers = new Headers();
    if (init.origin !== null) headers.set('Origin', init.origin ?? APP_ORIGIN);
    if (init.cookie) headers.set('Cookie', init.cookie);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    for (const [key, value] of Object.entries(init.headers ?? {})) headers.set(key, value);
    return handleAccountRequest(
      new Request(init.url ?? `${APP_ORIGIN}/api/account${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      this.deps(),
    );
  }

  async start(
    provider: ProviderId,
    options: { mode?: 'signin' | 'link'; cookie?: string | null } = {},
  ): Promise<{ response: Response; oauthCookie: string | null; state: string | null; nonce: string | null }> {
    const suffix = options.mode === 'link' ? '?mode=link' : '';
    const response = await this.request(`/auth/${provider}/start${suffix}`, { cookie: options.cookie ?? null });
    const oauthCookie = cookieHeader(response, 'mca_oauth');
    const decoded = oauthCookie ? decodeOAuthState(oauthCookie) : null;
    this.pendingNonce = decoded?.nonce ?? null;
    this.pendingProvider = decoded?.provider ?? null;
    return {
      response,
      oauthCookie,
      state: decoded?.state ?? null,
      nonce: decoded?.nonce ?? null,
    };
  }

  async callback(
    provider: ProviderId,
    options: { state: string | null; oauthCookie: string | null; cookie?: string | null; code?: string },
  ): Promise<Response> {
    const query = new URLSearchParams();
    query.set('code', options.code ?? 'auth-code');
    if (options.state) query.set('state', options.state);
    const cookie = [options.oauthCookie ? `mca_oauth=${options.oauthCookie}` : '', options.cookie ?? '']
      .filter(Boolean)
      .join('; ');
    return this.request(`/auth/${provider}/callback?${query.toString()}`, { cookie });
  }

  /** Complete a Google sign-in and return the session cookie. */
  async signInGoogle(
    sub: string,
    options: { cookie?: string | null; claims?: Record<string, unknown> } = {},
  ): Promise<{ cookie: string; accountId: string | null; response: Response }> {
    this.pendingSubject = sub;
    const started = await this.start('google', { cookie: options.cookie ?? null });
    const response = await this.callback('google', {
      state: started.state,
      oauthCookie: started.oauthCookie,
      cookie: options.cookie ?? null,
    });
    const cookie = cookieHeader(response, 'mca_session');
    return { cookie: cookie ?? '', accountId: await this.accountIdForCookie(cookie), response };
  }

  async signInDiscord(options: { cookie?: string | null } = {}): Promise<{ cookie: string; accountId: string | null; response: Response }> {
    const started = await this.start('discord', { cookie: options.cookie ?? null });
    const response = await this.callback('discord', {
      state: started.state,
      oauthCookie: started.oauthCookie,
      cookie: options.cookie ?? null,
    });
    const cookie = cookieHeader(response, 'mca_session');
    return { cookie: cookie ?? '', accountId: await this.accountIdForCookie(cookie), response };
  }

  /** Link another provider to the account the given session belongs to. */
  async link(
    provider: ProviderId,
    cookie: string,
  ): Promise<{ response: Response; cookie: string | null }> {
    const started = await this.start(provider, { mode: 'link', cookie });
    const response = await this.callback(provider, {
      state: started.state,
      oauthCookie: started.oauthCookie,
      cookie,
    });
    return { response, cookie: cookieHeader(response, 'mca_session') };
  }

  async accountIdForCookie(cookie: string | null): Promise<string | null> {
    if (!cookie) return null;
    const me = await this.request('/me', { cookie: `mca_session=${cookie}` });
    const body = (await me.json()) as { account?: { id?: string } };
    return body.account?.id ?? null;
  }

  async me(cookie: string | null): Promise<Record<string, unknown>> {
    const response = await this.request('/me', { cookie: cookie ? `mca_session=${cookie}` : null });
    return (await response.json()) as Record<string, unknown>;
  }
}

