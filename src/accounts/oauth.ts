/**
 * Google and Discord authorisation-code flows.
 *
 * Both are PKCE authorisation-code flows with server-side code exchange. Google
 * returns an OIDC ID token, which is verified against Google's published keys
 * before any claim is trusted. Discord is not an OIDC provider, so its identity
 * is read from the authenticated `/users/@me` endpoint with the exchanged
 * access token — the access token is used once and never stored.
 *
 * Nothing in this module decides who the player is in MCA terms: it returns a
 * provider identity, and the router decides whether it is a sign-in or a link.
 */
import { AccountError, type ProviderId } from './types';
import type { AccountConfig, ProviderConfig } from './config';
import { base64urlDecode, base64urlEncode, pkceChallenge, randomToken, safeEqual, verifyRs256Jwt, type JwkKey } from './crypto';

export const OAUTH_STATE_MAX_AGE_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 120_000;

export interface OAuthStateRecord {
  v: 1;
  provider: ProviderId;
  state: string;
  nonce: string;
  verifier: string;
  mode: 'signin' | 'link';
  /** Present only for `mode: 'link'`: the account the caller is already signed in as. */
  accountId?: string;
  createdAt: number;
}

export function encodeOAuthState(record: OAuthStateRecord): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(record)));
}

export function decodeOAuthState(value: string): OAuthStateRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64urlDecode(value)));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1) return null;
  if (record.provider !== 'google' && record.provider !== 'discord') return null;
  if (record.mode !== 'signin' && record.mode !== 'link') return null;
  for (const field of ['state', 'nonce', 'verifier'] as const) {
    if (typeof record[field] !== 'string' || (record[field] as string).length < 16) return null;
  }
  if (typeof record.createdAt !== 'number') return null;
  if (record.accountId !== undefined && typeof record.accountId !== 'string') return null;
  return {
    v: 1,
    provider: record.provider,
    state: record.state as string,
    nonce: record.nonce as string,
    verifier: record.verifier as string,
    mode: record.mode,
    ...(record.accountId ? { accountId: record.accountId as string } : {}),
    createdAt: record.createdAt,
  };
}

export interface AuthorizeStart {
  url: string;
  record: OAuthStateRecord;
}

export async function beginAuthorization(
  config: AccountConfig,
  providerId: ProviderId,
  mode: 'signin' | 'link',
  accountId: string | undefined,
): Promise<AuthorizeStart> {
  const provider = config.providers[providerId];
  if (!provider) {
    throw new AccountError('provider-not-configured', `${providerId} sign-in is not configured.`, 503);
  }
  const record: OAuthStateRecord = {
    v: 1,
    provider: providerId,
    state: randomToken(32),
    nonce: randomToken(32),
    verifier: randomToken(32),
    mode,
    ...(mode === 'link' && accountId ? { accountId } : {}),
    createdAt: config.now(),
  };
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', provider.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', record.state);
  url.searchParams.set('code_challenge', await pkceChallenge(record.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  if (providerId === 'google') {
    // `nonce` is an OIDC claim; Discord has no equivalent and ignores it.
    url.searchParams.set('nonce', record.nonce);
    url.searchParams.set('prompt', 'select_account');
  }
  return { url: url.toString(), record };
}

/**
 * Compare the callback against the cookie. A mismatch is a hard failure: it
 * means the response did not originate from a flow this browser started, which
 * is the login-CSRF case the state parameter exists for.
 */
export function verifyState(
  cookieValue: string | null,
  queryState: string | null,
  providerId: ProviderId,
  now: number,
): OAuthStateRecord {
  if (!cookieValue) throw new AccountError('state-mismatch', 'This sign-in link has expired. Start again.', 400);
  const record = decodeOAuthState(cookieValue);
  if (!record) throw new AccountError('state-mismatch', 'This sign-in link is not valid. Start again.', 400);
  if (record.provider !== providerId) {
    throw new AccountError('state-mismatch', 'This sign-in link belongs to another provider.', 400);
  }
  if (!queryState || !safeEqual(record.state, queryState)) {
    throw new AccountError('state-mismatch', 'This sign-in response does not match the request. Start again.', 400);
  }
  if (now - record.createdAt > OAUTH_STATE_MAX_AGE_MS) {
    throw new AccountError('state-mismatch', 'This sign-in link has expired. Start again.', 400);
  }
  return record;
}

export interface ProviderIdentity {
  provider: ProviderId;
  /** The provider's stable identifier: Google `sub`, Discord user id. */
  subject: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface JwksCacheEntry {
  keys: JwkKey[];
  fetchedAt: number;
}

const JWKS_TTL_MS = 60 * 60_000;
const jwksCache = new Map<string, JwksCacheEntry>();

async function fetchJson(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new AccountError('provider-error', 'The identity provider could not be reached.', 502);
  }
  if (!response.ok) {
    throw new AccountError('provider-error', `The identity provider refused the request (${response.status}).`, 502);
  }
  try {
    return await response.json();
  } catch {
    throw new AccountError('provider-error', 'The identity provider returned an unreadable response.', 502);
  }
}

async function googleKeys(fetchImpl: FetchLike): Promise<JwkKey[]> {
  const url = 'https://www.googleapis.com/oauth2/v3/certs';
  const cached = jwksCache.get(url);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const body = (await fetchJson(fetchImpl, url)) as { keys?: unknown };
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((key): key is JwkKey => typeof key === 'object' && key !== null && (key as JwkKey).kty === 'RSA')
    : [];
  if (keys.length === 0) {
    // A provider that answers 200 with no usable key must not be treated as a
    // valid signer; fail rather than fall back to the stale set silently.
    throw new AccountError('provider-error', 'The identity provider published no signing keys.', 502);
  }
  jwksCache.set(url, { keys, fetchedAt: now });
  return keys;
}

/** Test seam: drop the JWKS cache so a suite can supply its own key set. */
export function resetJwksCache(): void {
  jwksCache.clear();
}

async function exchangeCode(
  fetchImpl: FetchLike,
  provider: ProviderConfig,
  code: string,
  verifier: string,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: provider.redirectUri,
    code_verifier: verifier,
  });
  const token = await fetchJson(fetchImpl, provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (typeof token !== 'object' || token === null) {
    throw new AccountError('provider-error', 'The identity provider returned no token.', 502);
  }
  return token as Record<string, unknown>;
}

function stringClaim(claims: Record<string, unknown>, key: string): string | null {
  const value = claims[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function completeGoogle(
  provider: ProviderConfig,
  code: string,
  verifier: string,
  expectedNonce: string,
  fetchImpl: FetchLike,
  now: number,
): Promise<ProviderIdentity> {
  const token = await exchangeCode(fetchImpl, provider, code, verifier);
  const idToken = typeof token.id_token === 'string' ? token.id_token : null;
  if (!idToken) throw new AccountError('provider-error', 'Google returned no identity token.', 502);

  const claims = await verifyRs256Jwt(idToken, await googleKeys(fetchImpl));
  if (!claims) throw new AccountError('provider-error', 'Google identity token signature is not valid.', 502);

  const issuer = stringClaim(claims, 'iss');
  if (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') {
    throw new AccountError('provider-error', 'Google identity token issuer is not recognised.', 502);
  }
  const audience = claims.aud;
  const audiences = Array.isArray(audience) ? audience.filter((value): value is string => typeof value === 'string') : [];
  const audMatches = typeof audience === 'string' ? audience === provider.clientId : audiences.includes(provider.clientId);
  if (!audMatches) {
    throw new AccountError('provider-error', 'Google identity token was issued for another client.', 502);
  }
  const expiry = claims.exp;
  if (typeof expiry !== 'number' || expiry * 1000 + CLOCK_SKEW_MS <= now) {
    throw new AccountError('provider-error', 'Google identity token has expired.', 502);
  }
  const issuedAt = claims.iat;
  if (typeof issuedAt === 'number' && issuedAt * 1000 - CLOCK_SKEW_MS > now) {
    throw new AccountError('provider-error', 'Google identity token is not valid yet.', 502);
  }
  const nonce = stringClaim(claims, 'nonce');
  if (!nonce || !safeEqual(nonce, expectedNonce)) {
    throw new AccountError('state-mismatch', 'Google returned a response for another request.', 400);
  }
  const subject = stringClaim(claims, 'sub');
  if (!subject) throw new AccountError('provider-error', 'Google returned no account subject.', 502);

  return {
    provider: 'google',
    subject,
    displayName: stringClaim(claims, 'name') ?? stringClaim(claims, 'email'),
    avatarUrl: stringClaim(claims, 'picture'),
    email: stringClaim(claims, 'email'),
  };
}

export async function completeDiscord(
  provider: ProviderConfig,
  code: string,
  verifier: string,
  fetchImpl: FetchLike,
): Promise<ProviderIdentity> {
  const token = await exchangeCode(fetchImpl, provider, code, verifier);
  const accessToken = typeof token.access_token === 'string' ? token.access_token : null;
  if (!accessToken) throw new AccountError('provider-error', 'Discord returned no access token.', 502);

  // `identify` is the only scope requested, so this is the whole profile: no
  // email is assumed, and a missing avatar is normal rather than an error.
  const user = (await fetchJson(fetchImpl, 'https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })) as Record<string, unknown>;

  const subject = typeof user.id === 'string' && /^\d{5,32}$/.test(user.id) ? user.id : null;
  if (!subject) throw new AccountError('provider-error', 'Discord returned no stable account id.', 502);

  const globalName = stringClaim(user, 'global_name');
  const username = stringClaim(user, 'username');
  const avatar = stringClaim(user, 'avatar');
  return {
    provider: 'discord',
    subject,
    displayName: globalName ?? username,
    avatarUrl: avatar ? `https://cdn.discordapp.com/avatars/${subject}/${avatar}.png?size=128` : null,
    email: stringClaim(user, 'email'),
  };
}
