/**
 * The account HTTP API.
 *
 * Stateless by construction: it receives a request, a store and a resolved
 * configuration, and returns a response. That is what allows every rule here —
 * origin checks, rate limits, rotation, migration idempotency, link conflicts —
 * to be tested without Wrangler, a network or a real OAuth provider.
 */
import {
  careerRecord,
  careerViewFrom,
  parseCareerMatch,
  MAX_GUEST_IMPORT_MATCHES,
  type CareerMatchInput,
} from './career';
import {
  CALLSIGN_CHANGES_PER_DAY,
  DEFAULT_AVATAR,
  callsignKey,
  defaultCallsign,
  validateAvatar,
  validateCallsign,
  type PlayerIdentity,
} from './identity';
import {
  MP_REWARD_VERSION,
  eligibilityReason,
  matchDurationSeconds,
  mpReward,
  outcomeFor,
  parseExtraStats,
  parseMpResult,
  type MpMatchResult,
  type MpPlayerResult,
} from './matchCareer';
import { buildCareerStats } from './stats';
import type { CareerEntryWrite, MatchReportRecord, MpResultPlayerRecord, PlayerProfileRecord } from './types';
import { rankForXp } from './ranks';
import { safeEqual } from './crypto';
import { randomToken } from './crypto';
import {
  beginAuthorization,
  completeDiscord,
  completeGoogle,
  encodeOAuthState,
  OAUTH_STATE_MAX_AGE_MS,
  verifyState,
} from './oauth';
import type { AccountConfig } from './config';
import { configuredProviders } from './config';
import { OAUTH_COOKIE, SESSION_COOKIE, SessionService, clearCookie, parseCookies, serializeCookie } from './session';
import { issueTicket } from './tickets';
import {
  AccountError,
  PROVIDERS,
  RATE_LIMITS,
  type AccountStore,
  type GuestMigrationRecord,
  type IdentityRecord,
  type ProviderId,
  type RateLimitRule,
} from './types';

export interface AccountDeps {
  store: AccountStore;
  config: AccountConfig;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/** How many ledger rows a service-record page asks for. */
const HISTORY_PAGE_SIZE = 20;
const MAX_HISTORY_PAGE_SIZE = 50;

const MAX_BODY_BYTES = 8 * 1024;

function baseHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

export function jsonResponse(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(error: AccountError): Response {
  return jsonResponse({ ok: false, error: { code: error.code, message: error.message } }, error.status);
}

function redirectResponse(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ ...baseHeaders(), Location: location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function providerFrom(value: string | undefined): ProviderId {
  if (value === 'google' || value === 'discord') return value;
  throw new AccountError('not-found', 'That sign-in provider is not supported.', 404);
}

function clientIp(request: Request): string {
  const direct = request.headers.get('CF-Connecting-IP');
  if (direct && /^[0-9a-fA-F:.]{3,45}$/.test(direct)) return direct;
  const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  if (forwarded && /^[0-9a-fA-F:.]{3,45}$/.test(forwarded)) return forwarded;
  return 'unknown';
}

function allowedHosts(config: AccountConfig): Set<string> {
  const hosts = new Set<string>();
  const add = (origin: string): void => {
    try {
      hosts.add(new URL(origin).host);
    } catch {
      /* ignore a malformed configured origin */
    }
  };
  add(config.appOrigin);
  for (const origin of config.allowedOrigins) add(origin);
  return hosts;
}

/**
 * Reject a request addressed to a host this service was not configured for.
 *
 * A proxied request keeps the Pages host, so this is a real check rather than a
 * formality: a Worker reached directly on its `workers.dev` hostname with an
 * unexpected Host cannot be used to mint a session for another site.
 */
function assertHost(request: Request, config: AccountConfig): void {
  let host: string;
  try {
    host = new URL(request.url).host;
  } catch {
    throw new AccountError('invalid-request', 'Request URL is not valid.', 400);
  }
  const hosts = allowedHosts(config);
  for (const allowed of hosts) {
    if (host === allowed) return;
  }
  // Development serves the Worker directly as well as through the dev-server
  // proxy, and both are loopback. This is gated on the explicit dev flag, so a
  // production deployment still accepts only its configured hosts.
  if (config.devMode && /^(127\.0\.0\.1|localhost)(:\d{2,5})?$/.test(host)) return;
  throw new AccountError('forbidden-origin', 'Request host is not allowed.', 403);
}

/**
 * CSRF defence for state-changing routes.
 *
 * The session cookie is `SameSite=Lax`, which already blocks it on cross-site
 * POSTs. This is the second lock: the browser must declare an allowed `Origin`,
 * and a cross-site fetch metadata hint is refused outright. Requests with no
 * Origin (native clients, tests) still need a valid session cookie, which a
 * cross-site page cannot send.
 */
function assertStateChangeOrigin(request: Request, config: AccountConfig): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === 'cross-site') {
    throw new AccountError('forbidden-origin', 'Cross-site requests are not permitted.', 403);
  }
  const origin = request.headers.get('Origin');
  if (!origin) return;
  if (!config.allowedOrigins.includes(origin)) {
    throw new AccountError('forbidden-origin', 'Request origin is not allowed.', 403);
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new AccountError('invalid-request', 'Request body is too large.', 413);
  if (text.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AccountError('invalid-request', 'Request body is not valid JSON.', 400);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AccountError('invalid-request', 'Request body must be an object.', 400);
  }
  return parsed as Record<string, unknown>;
}

async function enforceRateLimit(
  deps: AccountDeps,
  bucket: string,
  rule: RateLimitRule,
  request: Request,
  subject: string,
): Promise<void> {
  const windowStart = Math.floor(deps.config.now() / rule.windowMs);
  const count = await deps.store.countRateLimit(`${bucket}:${subject}:${clientIp(request)}`, windowStart);
  if (count > rule.limit) {
    throw new AccountError('rate-limited', 'Too many attempts. Wait a moment and try again.', 429);
  }
}

export interface AccountSummary {
  id: string;
  createdAt: number;
  status: string;
  lastAuthAt: number | null;
  displayName: string | null;
  avatarUrl: string | null;
  identities: Array<{ provider: ProviderId; displayName: string | null; linkedAt: number }>;
}

function summarise(
  account: { id: string; createdAt: number; status: string; lastAuthAt: number | null },
  identities: IdentityRecord[],
): AccountSummary {
  const primary = identities[0] ?? null;
  return {
    id: account.id,
    createdAt: account.createdAt,
    status: account.status,
    lastAuthAt: account.lastAuthAt,
    displayName: primary?.displayName ?? null,
    avatarUrl: primary?.avatarUrl ?? null,
    // Linked providers are listed by name only; the provider subject is an
    // external identifier the browser has no use for.
    identities: identities.map((identity) => ({
      provider: identity.provider,
      displayName: identity.displayName,
      linkedAt: identity.linkedAt,
    })),
  };
}

class Router {
  private readonly deps: AccountDeps;
  private readonly sessions: SessionService;

  constructor(deps: AccountDeps) {
    this.deps = deps;
    this.sessions = new SessionService(deps.store, deps.config);
  }

  private get config(): AccountConfig {
    return this.deps.config;
  }

  private get now(): number {
    return this.config.now();
  }

  private sessionToken(request: Request): string | null {
    return parseCookies(request.headers.get('Cookie')).get(SESSION_COOKIE) ?? null;
  }

  private async currentSession(request: Request) {
    return this.sessions.resolve(this.sessionToken(request));
  }

  private async requireSession(request: Request) {
    const resolved = await this.currentSession(request);
    if (!resolved) throw new AccountError('unauthorized', 'Sign in to use this feature.', 401);
    return resolved;
  }

  async handle(request: Request): Promise<Response> {
    assertHost(request, this.config);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/account\/?/, '').replace(/\/+$/, '');
    const segments = path.length === 0 ? [] : path.split('/');
    assertStateChangeOrigin(request, this.config);

    if (segments.length === 0 || (segments.length === 1 && segments[0] === 'health')) {
      if (request.method !== 'GET' && segments.length !== 0) {
        throw new AccountError('method-not-allowed', 'Use GET for this endpoint.', 405);
      }
      if (segments.length === 1) {
        return jsonResponse({
          ok: true,
          service: 'mca-accounts',
          version: 1,
          providers: configuredProviders(this.config),
          devMode: this.config.devMode,
        });
      }
      throw new AccountError('not-found', 'Unknown account endpoint.', 404);
    }

    if (segments[0] === 'me' && segments.length === 1) {
      if (request.method !== 'GET') throw new AccountError('method-not-allowed', 'Use GET for this endpoint.', 405);
      await enforceRateLimit(this.deps, 'me', RATE_LIMITS.sessionRead, request, 'any');
      const resolved = await this.currentSession(request);
      if (!resolved) {
        return jsonResponse({
          ok: true,
          authenticated: false,
          account: null,
          providers: configuredProviders(this.config),
        });
      }
      const identities = await this.deps.store.identities(resolved.account.id);
      return jsonResponse({
        ok: true,
        authenticated: true,
        account: summarise(resolved.account, identities),
        providers: configuredProviders(this.config),
        identity: this.identityView(await this.identityFor(resolved.account.id)),
      });
    }

    if (segments[0] === 'auth' && segments.length >= 3) {
      const provider = providerFrom(segments[1]);
      if (segments[2] === 'start' && segments.length === 3) {
        if (request.method !== 'GET') throw new AccountError('method-not-allowed', 'Use GET for this endpoint.', 405);
        return this.start(request, provider, url);
      }
      if (segments[2] === 'callback' && segments.length === 3) {
        if (request.method !== 'GET') throw new AccountError('method-not-allowed', 'Use GET for this endpoint.', 405);
        return this.callback(request, provider, url);
      }
    }

    if (segments[0] === 'logout' && segments.length === 1) {
      if (request.method !== 'POST') throw new AccountError('method-not-allowed', 'Use POST for this endpoint.', 405);
      await enforceRateLimit(this.deps, 'logout', RATE_LIMITS.mutate, request, 'any');
      const resolved = await this.currentSession(request);
      if (resolved) await this.sessions.revoke(resolved.session);
      return jsonResponse({ ok: true }, 200, [this.sessions.clearedSessionCookie()]);
    }

    if (segments[0] === 'sessions' && segments[1] === 'revoke-all' && segments.length === 2) {
      if (request.method !== 'POST') throw new AccountError('method-not-allowed', 'Use POST for this endpoint.', 405);
      const resolved = await this.requireSession(request);
      await enforceRateLimit(this.deps, 'revoke-all', RATE_LIMITS.mutate, request, resolved.account.id);
      const revoked = await this.sessions.revokeAll(resolved.account.id);
      return jsonResponse({ ok: true, revoked }, 200, [this.sessions.clearedSessionCookie()]);
    }

    if (segments[0] === 'providers' && segments[2] === 'unlink' && segments.length === 3) {
      if (request.method !== 'POST') throw new AccountError('method-not-allowed', 'Use POST for this endpoint.', 405);
      const provider = providerFrom(segments[1]);
      const resolved = await this.requireSession(request);
      await enforceRateLimit(this.deps, 'unlink', RATE_LIMITS.mutate, request, resolved.account.id);
      return this.unlink(resolved, provider);
    }

    if (segments[0] === 'migrate' && segments[1] === 'guest' && segments.length === 2) {
      if (request.method !== 'POST') throw new AccountError('method-not-allowed', 'Use POST for this endpoint.', 405);
      const resolved = await this.requireSession(request);
      await enforceRateLimit(this.deps, 'migrate', RATE_LIMITS.guestMigration, request, resolved.account.id);
      return this.migrateGuest(request, resolved.account.id);
    }

    if (segments[0] === 'career' && segments.length === 1) {
      if (request.method !== 'GET') throw new AccountError('method-not-allowed', 'Use GET for this endpoint.', 405);
      await enforceRateLimit(this.deps, 'career-read', RATE_LIMITS.sessionRead, request, 'any');
      const resolved = await this.requireSession(request);
      const limit = Math.min(
        MAX_HISTORY_PAGE_SIZE,
        Math.max(1, Math.floor(Number(url.searchParams.get('limit') ?? HISTORY_PAGE_SIZE) || HISTORY_PAGE_SIZE)),
      );
      return jsonResponse({ ok: true, career: await this.careerView(resolved.account.id, limit) });
    }

    if (segments[0] === 'career' && segments[1] === 'matches') {
      if (request.method !== 'GET') throw new AccountError('method-not-allowed', 'Use GET for this endpoint.', 405);
      if (segments.length === 2) return this.matchHistory(request, url);
      if (segments.length === 3) return this.matchDetail(request, decodeURIComponent(segments[2]));
    }

    if (segments[0] === 'career' && segments[1] === 'results' && segments.length === 3) {
      if (request.method !== 'GET') throw new AccountError('method-not-allowed', 'Use GET for this endpoint.', 405);
      return this.matchResult(request, decodeURIComponent(segments[2]));
    }

    if (segments[0] === 'identity' && segments.length === 1) {
      if (request.method !== 'POST') throw new AccountError('method-not-allowed', 'Use POST for this endpoint.', 405);
      return this.updateIdentity(request);
    }

    if (segments[0] === 'players' && segments.length === 2) {
      if (request.method !== 'GET') throw new AccountError('method-not-allowed', 'Use GET for this endpoint.', 405);
      return this.publicProfile(request, segments[1]);
    }

    if (segments[0] === 'internal' && segments[1] === 'mp-result' && segments.length === 2) {
      if (request.method !== 'POST') throw new AccountError('method-not-allowed', 'Use POST for this endpoint.', 405);
      return this.ingestMpResult(request);
    }

    if (segments[0] === 'matches' && segments.length === 1) {
      if (request.method !== 'POST') throw new AccountError('method-not-allowed', 'Use POST for this endpoint.', 405);
      return this.recordMatch(request);
    }

    if (segments[0] === 'multiplayer' && segments[1] === 'ticket' && segments.length === 2) {
      if (request.method !== 'POST') throw new AccountError('method-not-allowed', 'Use POST for this endpoint.', 405);
      const resolved = await this.requireSession(request);
      await enforceRateLimit(this.deps, 'ticket', RATE_LIMITS.ticket, request, resolved.account.id);
      if (!this.config.ticketSecret) {
        throw new AccountError('server-error', 'Multiplayer identity is not configured.', 503);
      }
      // The room cannot call back into this service, so the identity it shows
      // in the lobby travels inside the signed ticket it already verifies. The
      // rank is read from this account's ledger here, which is the only place
      // that can say what it is: neither the room nor the browser may choose it.
      const profile = await this.identityFor(resolved.account.id);
      const totals = await this.deps.store.careerTotals(resolved.account.id);
      const ticket = await issueTicket(
        this.config.ticketSecret,
        resolved.account.id,
        this.now,
        { ...this.identityView(profile), rank: rankForXp(totals.xp).rank.id },
      );
      return jsonResponse({ ok: true, ...ticket });
    }

    throw new AccountError('not-found', 'Unknown account endpoint.', 404);
  }

  private authCookie(value: string, maxAgeSeconds: number): string {
    return serializeCookie(OAUTH_COOKIE, value, {
      secure: this.config.cookieSecure,
      sameSite: 'Lax',
      maxAgeSeconds,
    });
  }

  private clearedAuthCookie(): string {
    return clearCookie(OAUTH_COOKIE, { secure: this.config.cookieSecure, sameSite: 'Lax' });
  }

  private appRedirect(params: Record<string, string>): string {
    const url = new URL('/', this.config.appOrigin);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }

  private errorRedirect(code: string): Response {
    return redirectResponse(this.appRedirect({ auth: 'error', code }), [this.clearedAuthCookie()]);
  }

  private async start(request: Request, provider: ProviderId, url: URL): Promise<Response> {
    await enforceRateLimit(this.deps, 'auth-start', RATE_LIMITS.authStart, request, provider);
    if (!this.config.providers[provider]) {
      throw new AccountError('provider-not-configured', `${provider} sign-in is not configured.`, 503);
    }
    const mode = url.searchParams.get('mode') === 'link' ? 'link' : 'signin';
    let accountId: string | undefined;
    if (mode === 'link') {
      const resolved = await this.requireSession(request);
      accountId = resolved.account.id;
    }
    const started = await beginAuthorization(this.config, provider, mode, accountId);
    return redirectResponse(started.url, [
      this.authCookie(encodeOAuthState(started.record), OAUTH_STATE_MAX_AGE_MS / 1000),
    ]);
  }

  private async callback(request: Request, provider: ProviderId, url: URL): Promise<Response> {
    await enforceRateLimit(this.deps, 'auth-callback', RATE_LIMITS.authCallback, request, provider);
    const query = url.searchParams;
    if (query.get('error')) {
      // The player pressed cancel, or the provider refused. Both end here, and
      // neither is treated as a server error.
      return this.errorRedirect('cancelled');
    }
    const code = query.get('code');
    if (!code || code.length > 4096) return this.errorRedirect('invalid-request');

    let record;
    try {
      record = verifyState(
        parseCookies(request.headers.get('Cookie')).get(OAUTH_COOKIE) ?? null,
        query.get('state'),
        provider,
        this.now,
      );
    } catch {
      return this.errorRedirect('state-mismatch');
    }

    const providerConfig = this.config.providers[provider];
    if (!providerConfig) return this.errorRedirect('provider-not-configured');

    let identity;
    try {
      identity =
        provider === 'google'
          ? await completeGoogle(providerConfig, code, record.verifier, record.nonce, this.deps.fetch, this.now)
          : await completeDiscord(providerConfig, code, record.verifier, this.deps.fetch);
    } catch (error) {
      if (error instanceof AccountError) return this.errorRedirect(error.code);
      return this.errorRedirect('provider-error');
    }

    if (record.mode === 'link') {
      return this.completeLink(request, record.accountId ?? null, identity);
    }

    try {
      const resolvedAccount = await this.resolveSignIn(provider, identity);
      const issued = await this.sessions.issue(resolvedAccount);
      // A session presented by the browser before sign-in is discarded, so a
      // pre-set cookie cannot survive authentication as the live session.
      const previous = this.sessionToken(request);
      if (previous) {
        const stale = await this.sessions.resolve(previous);
        if (stale && stale.account.id !== resolvedAccount) await this.sessions.revoke(stale.session);
      }
      await this.deps.store.touchAccountAuth(resolvedAccount, this.now);
      return redirectResponse(this.appRedirect({ auth: 'signed-in' }), [
        this.sessions.sessionCookie(issued.token),
        this.clearedAuthCookie(),
      ]);
    } catch (error) {
      if (error instanceof AccountError) return this.errorRedirect(error.code);
      return this.errorRedirect('server-error');
    }
  }

  private async resolveSignIn(
    provider: ProviderId,
    identity: { subject: string; displayName: string | null; avatarUrl: string | null },
  ): Promise<string> {
    const existing = await this.deps.store.identity(provider, identity.subject);
    if (existing) {
      const account = await this.deps.store.account(existing.accountId);
      if (!account) throw new AccountError('server-error', 'The account record is missing.', 500);
      if (account.status !== 'active') {
        throw new AccountError('account-suspended', 'This account cannot sign in.', 403);
      }
      return account.id;
    }
    const accountId = randomToken(16);
    await this.deps.store.createAccount({ id: accountId, now: this.now });
    const attached = await this.deps.store.attachIdentity({
      accountId,
      provider,
      subject: identity.subject,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      now: this.now,
    });
    if (attached === 'conflict') {
      // Two callbacks for the same new provider identity raced. The loser
      // resolves to the winner's account rather than creating a second one.
      const winner = await this.deps.store.identity(provider, identity.subject);
      if (winner) return winner.accountId;
      throw new AccountError('server-error', 'The account could not be linked.', 500);
    }
    return accountId;
  }

  private async completeLink(
    request: Request,
    expectedAccountId: string | null,
    identity: { provider: ProviderId; subject: string; displayName: string | null; avatarUrl: string | null },
  ): Promise<Response> {
    const resolved = await this.currentSession(request);
    if (!resolved) return this.errorRedirect('unauthorized');
    if (!expectedAccountId || expectedAccountId !== resolved.account.id) {
      return this.errorRedirect('state-mismatch');
    }
    const existing = await this.deps.store.identity(identity.provider, identity.subject);
    if (existing && existing.accountId !== resolved.account.id) {
      // Explicit refusal: linking must never absorb another account's login.
      return this.errorRedirect('identity-in-use');
    }
    if (!existing) {
      const attached = await this.deps.store.attachIdentity({
        accountId: resolved.account.id,
        provider: identity.provider,
        subject: identity.subject,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        now: this.now,
      });
      if (attached === 'conflict') return this.errorRedirect('identity-in-use');
    }
    // Linking is a sensitive change to how the account is entered, so the
    // session that authorised it is rotated.
    const issued = await this.sessions.issue(resolved.account.id);
    await this.sessions.revoke(resolved.session);
    return redirectResponse(this.appRedirect({ auth: 'linked' }), [
      this.sessions.sessionCookie(issued.token),
      this.clearedAuthCookie(),
    ]);
  }

  private async unlink(
    resolved: { session: { id: string; accountId: string; tokenHash: string; createdAt: number; lastSeenAt: number; expiresAt: number; revokedAt: number | null }; account: { id: string } },
    provider: ProviderId,
  ): Promise<Response> {
    const identities = await this.deps.store.identities(resolved.account.id);
    if (!identities.some((identity) => identity.provider === provider)) {
      throw new AccountError('identity-not-linked', 'That sign-in method is not linked to this account.', 404);
    }
    if (identities.length <= 1) {
      throw new AccountError(
        'last-identity',
        'Link another sign-in method before removing your only one.',
        409,
      );
    }
    await this.deps.store.detachIdentity(resolved.account.id, provider);
    const issued = await this.sessions.issue(resolved.account.id);
    await this.sessions.revoke(resolved.session);
    const account = await this.deps.store.account(resolved.account.id);
    const remaining = await this.deps.store.identities(resolved.account.id);
    return jsonResponse(
      { ok: true, account: account ? summarise(account, remaining) : null },
      200,
      [this.sessions.sessionCookie(issued.token)],
    );
  }

  /**
   * The career view. Totals are aggregated from the ledger on every read, so
   * the rank shown is always the sum of the matches below it.
   */
  private async careerView(
    accountId: string,
    limit = HISTORY_PAGE_SIZE,
    offset = 0,
  ): Promise<unknown> {
    const [totals, matches, rows, profile] = await Promise.all([
      this.deps.store.careerTotals(accountId),
      this.deps.store.careerMatches(accountId, limit, offset),
      this.deps.store.careerStatRows(accountId),
      this.identityFor(accountId),
    ]);
    return {
      ...careerViewFrom(totals, matches),
      // XP and rank come from the ledger above; every other figure is grouped
      // from the same ledger, so a profile cannot disagree with its history.
      stats: buildCareerStats(rows),
      identity: this.identityView(profile),
      page: { limit, offset },
    };
  }

  /**
   * The player's presentable identity, created on first use.
   *
   * Accounts predate profiles, so a read may be the first time a name exists.
   * Creation is a single idempotent insert: two concurrent reads cannot produce
   * two profiles, and a lost uniqueness race re-reads the winner.
   */
  private async identityFor(accountId: string): Promise<PlayerProfileRecord> {
    const existing = await this.deps.store.profile(accountId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 4; attempt++) {
      const callsign = defaultCallsign();
      const record: PlayerProfileRecord = {
        accountId,
        callsign,
        callsignKey: callsignKey(callsign),
        avatar: DEFAULT_AVATAR,
        createdAt: this.now,
        updatedAt: this.now,
        callsignChangedAt: null,
      };
      const written = await this.deps.store.createProfile(record);
      if (written === 'ok') return record;
      const raced = await this.deps.store.profile(accountId);
      if (raced) return raced;
    }
    throw new AccountError('server-error', 'A player identity could not be created.', 500);
  }

  private identityView(profile: PlayerProfileRecord): PlayerIdentity {
    return { callsign: profile.callsign, avatar: profile.avatar };
  }

  /**
   * Record one completed PvE match.
   *
   * The client supplies the facts of the match, never its value: XP is
   * recomputed here from validated fields, the reference makes the write
   * idempotent, and the server alone chooses `provenance`. A multiplayer result
   * is refused because only the room service may vouch for one.
   */
  private async recordMatch(request: Request): Promise<Response> {
    const resolved = await this.requireSession(request);
    await enforceRateLimit(this.deps, 'career-submit', RATE_LIMITS.matchSubmit, request, resolved.account.id);
    const body = await readJsonBody(request);
    if (body.provenance !== undefined && body.provenance !== 'local') {
      throw new AccountError('invalid-request', 'That result provenance cannot be claimed by a client.', 400);
    }
    const parsed = parseCareerMatch(body);
    if (!parsed.ok) throw new AccountError(parsed.code, parsed.message, 400);
    if (parsed.value.mode === 'multiplayer') {
      throw new AccountError('invalid-request', 'Multiplayer results are recorded by the room service.', 400);
    }
    const record = careerRecord(parsed.value, { provenance: 'local', now: this.now });
    const stats = parseExtraStats(body.stats);
    const report: MatchReportRecord = {
      ref: record.ref,
      mode: record.mode,
      mapId: this.mapId(body.mapId),
      opponentAccountId: null,
      opponentCallsign: null,
      opponentNation: null,
      durationSeconds: record.durationSeconds,
      unitsDestroyed: record.kills,
      unitsLost: record.unitsLost,
      structuresDestroyed: stats.structuresDestroyed,
      structuresLost: stats.structuresLost,
      structuresBuilt: stats.structuresBuilt,
      sitesCaptured: stats.sitesCaptured,
      superweaponsUsed: stats.superweaponsUsed,
      objectivesCompleted: stats.objectivesCompleted,
      rewardVersion: 0,
      rewardStatus: 'local',
      breakdown: null,
      xpBefore: 0,
      xpAfter: 0,
      recordedAt: this.now,
    };
    const outcome = await this.deps.store.recordCareerEntry({
      accountId: resolved.account.id,
      record,
      report,
      audit: null,
    });
    return jsonResponse({
      ok: true,
      recorded: outcome === 'ok',
      award: { xp: outcome === 'ok' ? record.xp : 0 },
      career: await this.careerView(resolved.account.id),
    });
  }

  private mapId(raw: unknown): string | null {
    return typeof raw === 'string' && /^[a-z0-9_-]{1,48}$/.test(raw) ? raw : null;
  }

  /**
   * Edit the presentable identity.
   *
   * A rename is rate-limited and must win the callsign key it proposes, so the
   * lobby can never show two identical names. The account id is untouched, which
   * is why match history and seat ownership survive the change.
   */
  private async updateIdentity(request: Request): Promise<Response> {
    const resolved = await this.requireSession(request);
    await enforceRateLimit(this.deps, 'identity', RATE_LIMITS.mutate, request, resolved.account.id);
    const body = await readJsonBody(request);
    const profile = await this.identityFor(resolved.account.id);
    let callsign = profile.callsign;
    let changedCallsign = false;
    if (body.callsign !== undefined) {
      const parsed = validateCallsign(body.callsign);
      if (!parsed.ok) throw new AccountError(parsed.code, parsed.message, 400);
      if (callsignKey(parsed.callsign) !== profile.callsignKey) {
        const taken = await this.deps.store.profileByCallsignKey(callsignKey(parsed.callsign));
        if (taken && taken.accountId !== resolved.account.id) {
          throw new AccountError('identity-in-use', 'That callsign is already in use.', 409);
        }
        const attempts = await this.deps.store.countRateLimit(
          `callsign-change:${resolved.account.id}`,
          Math.floor(this.now / 86_400_000),
        );
        if (attempts > CALLSIGN_CHANGES_PER_DAY) {
          throw new AccountError('rate-limited', 'Too many callsign changes today.', 429);
        }
        callsign = parsed.callsign;
        changedCallsign = true;
      }
    }
    let avatar = profile.avatar;
    if (body.avatar !== undefined) {
      const parsed = validateAvatar(body.avatar);
      if (!parsed) throw new AccountError('invalid-request', 'That avatar is not available.', 400);
      avatar = parsed;
    }
    const written = await this.deps.store.updateProfile(resolved.account.id, {
      callsign,
      callsignKey: callsignKey(callsign),
      avatar,
      updatedAt: this.now,
      callsignChangedAt: changedCallsign ? this.now : null,
    });
    if (written === 'conflict') {
      throw new AccountError('identity-in-use', 'That callsign is already in use.', 409);
    }
    return jsonResponse({
      ok: true,
      identity: this.identityView(await this.identityFor(resolved.account.id)),
    });
  }

  /**
   * A deliberately small public profile.
   *
   * Reachable only with a session, addressed by callsign rather than account id,
   * and carrying no provider, email or session information. It is what an
   * opponent's name in the lobby opens.
   */
  private async publicProfile(request: Request, rawCallsign: string): Promise<Response> {
    await this.requireSession(request);
    const key = callsignKey(decodeURIComponent(rawCallsign));
    const profile = await this.deps.store.profileByCallsignKey(key);
    if (!profile) throw new AccountError('not-found', 'No player uses that callsign.', 404);
    const [totals, rows] = await Promise.all([
      this.deps.store.careerTotals(profile.accountId),
      this.deps.store.careerStatRows(profile.accountId),
    ]);
    const stats = buildCareerStats(rows);
    const standing = rankForXp(totals.xp);
    return jsonResponse({
      ok: true,
      player: {
        callsign: profile.callsign,
        avatar: profile.avatar,
        rank: standing.rank,
        xp: totals.xp,
        progress: standing.progress,
        matches: stats.overall.matches,
        winRate: stats.overall.winRate,
        playSeconds: stats.overall.playSeconds,
        multiplayer: stats.modes.multiplayer,
        nations: stats.nations,
      },
    });
  }

  /** Paged service-record history, newest first. */
  private async matchHistory(request: Request, url: URL): Promise<Response> {
    const resolved = await this.requireSession(request);
    await enforceRateLimit(this.deps, 'history', RATE_LIMITS.sessionRead, request, 'any');
    const limit = Math.min(
      MAX_HISTORY_PAGE_SIZE,
      Math.max(1, Math.floor(Number(url.searchParams.get('limit') ?? HISTORY_PAGE_SIZE) || HISTORY_PAGE_SIZE)),
    );
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset') ?? 0) || 0));
    const records = await this.deps.store.careerMatches(resolved.account.id, limit, offset);
    const items = await Promise.all(
      records.map(async (match) => ({
        match,
        report: await this.deps.store.matchReport(resolved.account.id, match.ref),
      })),
    );
    return jsonResponse({
      ok: true,
      items,
      page: { limit, offset, hasMore: records.length === limit },
    });
  }

  private async matchDetail(request: Request, ref: string): Promise<Response> {
    const resolved = await this.requireSession(request);
    const match = await this.deps.store.careerMatch(resolved.account.id, ref);
    if (!match) throw new AccountError('not-found', 'That match is not in your record.', 404);
    return jsonResponse({
      ok: true,
      match,
      report: await this.deps.store.matchReport(resolved.account.id, ref),
    });
  }

  /**
   * The career outcome of one match, for the post-match screen.
   *
   * `pending` is a first-class answer: the room may report its result a moment
   * after the client sees the scoreboard, so the screen must be able to say
   * "still synchronising" instead of showing a guessed reward.
   */
  private async matchResult(request: Request, ref: string): Promise<Response> {
    const resolved = await this.requireSession(request);
    if (!/^[A-Za-z0-9:_-]{8,96}$/.test(ref)) {
      throw new AccountError('invalid-request', 'Match reference is not valid.', 400);
    }
    const match = await this.deps.store.careerMatch(resolved.account.id, ref);
    if (!match) return jsonResponse({ ok: true, status: 'pending', matchRef: ref });
    const report = await this.deps.store.matchReport(resolved.account.id, ref);
    const xpBefore = report?.xpBefore ?? Math.max(0, (await this.deps.store.careerTotals(resolved.account.id)).xp - match.xp);
    const xpAfter = report?.xpAfter ?? xpBefore + match.xp;
    const before = rankForXp(xpBefore);
    const after = rankForXp(xpAfter);
    return jsonResponse({
      ok: true,
      status: 'recorded',
      matchRef: ref,
      match,
      award: {
        xp: match.xp,
        status: report?.rewardStatus ?? 'awarded',
        reason: report?.breakdown?.reason ?? null,
        breakdown: report?.breakdown ?? null,
        xpBefore,
        xpAfter,
        rankBefore: before.rank,
        rankAfter: after.rank,
        promoted: after.index > before.index,
      },
    });
  }

  /**
   * Authoritative result intake from the room service.
   *
   * The caller is a service, not a browser: it presents a shared secret, and the
   * request carries no client identity to trust. For each seated account the
   * award is recomputed here from the reported facts, written in one entry with
   * its report and audit row, and deduplicated by the match reference, so a
   * retry or a reconnect can only ever return the award that already exists.
   */
  private async ingestMpResult(request: Request): Promise<Response> {
    const secret = this.config.mpResultToken;
    if (!secret) throw new AccountError('server-error', 'Result intake is not configured.', 503);
    const presented = request.headers.get('X-MCA-Result-Token') ?? '';
    if (!presented || !safeEqual(presented, secret)) {
      throw new AccountError('unauthorized', 'Result intake credentials are not valid.', 401);
    }
    const body = await readJsonBody(request);
    const parsed = parseMpResult(body, this.now);
    if (!parsed.ok) throw new AccountError('invalid-request', parsed.message, 400);
    const result: MpMatchResult = parsed.value;
    const dayStart = Math.floor(this.now / 86_400_000) * 86_400_000;
    const players: unknown[] = [];
    for (const player of result.players) {
      if (!player.accountId) {
        players.push({ seat: player.team, accountId: null, status: 'guest', xp: 0 });
        continue;
      }
      const accountId = player.accountId;
      const account = await this.deps.store.account(accountId);
      if (!account || account.status !== 'active') {
        players.push({ seat: player.team, accountId, status: 'ineligible', xp: 0 });
        continue;
      }
      const outcome = outcomeFor(result, player.team);
      const durationSeconds = matchDurationSeconds(result);
      const rewardedToday = await this.deps.store.mpResultsSince(accountId, dayStart);
      const breakdown = mpReward({
        outcome,
        durationSeconds,
        stats: player.stats,
        rewardedToday,
        ineligibleReason: eligibilityReason(result, player),
      });
      // The standing before this match is read from the ledger, not guessed:
      // the result card and the service record both show the same two numbers.
      const standingBefore = await this.deps.store.careerTotals(accountId);
      const record = careerRecord(
        {
          ref: result.matchId,
          mode: 'multiplayer',
          outcome,
          // Multiplayer has no AI difficulty; the field is part of the ledger's
          // checks and a neutral value is the honest one.
          difficulty: 'veteran',
          durationSeconds,
          nation: player.nation,
          kills: player.stats.unitsDestroyed,
          unitsLost: player.stats.unitsLost,
        },
        { provenance: 'authoritative', now: this.now },
      );
      // The ledger's own XP formula covers local play; for an authoritative
      // match the reward above is the decision, so it replaces the estimate.
      record.xp = breakdown.xp;
      const opponent = result.players.find((other) => other.team !== player.team) ?? null;
      const report = this.mpReport(
        result,
        player,
        opponent,
        record.xp,
        breakdown,
        durationSeconds,
        standingBefore.xp,
      );
      const audit: MpResultPlayerRecord = {
        matchId: result.matchId,
        accountId,
        roomId: result.roomId,
        team: player.team,
        outcome,
        nation: player.nation,
        rewardVersion: MP_REWARD_VERSION,
        xpAwarded: breakdown.xp,
        status: breakdown.status,
        processedAt: this.now,
      };
      const entry: CareerEntryWrite = { accountId, record, report, audit };
      const written = await this.deps.store.recordCareerEntry(entry);
      players.push({
        seat: player.team,
        accountId,
        status: breakdown.status,
        xp: written === 'ok' ? breakdown.xp : 0,
        recorded: written === 'ok',
        matchRef: result.matchId,
      });
    }
    return jsonResponse({ ok: true, matchId: result.matchId, players });
  }

  private mpReport(
    result: MpMatchResult,
    player: MpPlayerResult,
    opponent: MpPlayerResult | null,
    xp: number,
    breakdown: ReturnType<typeof mpReward>,
    durationSeconds: number,
    xpBefore: number,
  ): MatchReportRecord {
    return {
      ref: result.matchId,
      mode: 'multiplayer',
      mapId: result.mapId,
      opponentAccountId: opponent?.accountId ?? null,
      opponentCallsign: opponent?.callsign ?? null,
      opponentNation: opponent?.nation ?? null,
      durationSeconds,
      unitsDestroyed: player.stats.unitsDestroyed,
      unitsLost: player.stats.unitsLost,
      structuresDestroyed: player.stats.structuresDestroyed,
      structuresLost: player.stats.structuresLost,
      structuresBuilt: player.stats.structuresBuilt,
      sitesCaptured: player.stats.sitesCaptured,
      superweaponsUsed: player.stats.superweaponsUsed,
      objectivesCompleted: player.stats.objectivesCompleted,
      rewardVersion: MP_REWARD_VERSION,
      rewardStatus: breakdown.status,
      breakdown,
      xpBefore,
      xpAfter: xpBefore + xp,
      recordedAt: this.now,
    };
  }

  private async migrateGuest(request: Request, accountId: string): Promise<Response> {
    const body = await readJsonBody(request);
    const guestId = typeof body.guestId === 'string' ? body.guestId : '';
    const migrationKey = typeof body.migrationKey === 'string' ? body.migrationKey : '';
    const profileDigest = typeof body.profileDigest === 'string' ? body.profileDigest : '';
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(guestId)) {
      throw new AccountError('invalid-request', 'Guest identifier is not valid.', 400);
    }
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(migrationKey)) {
      throw new AccountError('invalid-request', 'Migration key is not valid.', 400);
    }
    if (!/^(?:[A-Fa-f0-9]{64}|[A-Za-z0-9_-]{43})$/.test(profileDigest)) {
      throw new AccountError('invalid-request', 'Guest profile digest is not valid.', 400);
    }

    const existing = await this.deps.store.guestMigration(guestId);
    if (existing) {
      if (existing.accountId !== accountId) {
        throw new AccountError(
          'guest-already-migrated',
          'This guest profile is already linked to a different account.',
          409,
        );
      }
      if (existing.profileDigest !== profileDigest || existing.migrationKey !== migrationKey) {
        throw new AccountError(
          'migration-conflict',
          'This guest profile has changed since it was first linked.',
          409,
        );
      }
      return jsonResponse({
        ok: true,
        status: 'already-migrated',
        migratedAt: existing.completedAt,
        importedXp: 0,
        career: await this.careerView(accountId),
      });
    }

    const other = await this.deps.store.guestMigrationForAccount(accountId);
    if (other) {
      throw new AccountError(
        'account-already-migrated',
        'This account has already imported a guest profile.',
        409,
      );
    }

    const record: GuestMigrationRecord = {
      guestId,
      accountId,
      state: 'complete',
      migrationKey,
      profileDigest,
      createdAt: this.now,
      completedAt: this.now,
    };
    // Career import is idempotent per match reference, so a retry after a
    // partial failure cannot duplicate a match. XP is recomputed here; a guest
    // ledger cannot assert its own values.
    const guestMatches = this.guestCareer(body.career);
    let importedXp = 0;
    for (const input of guestMatches) {
      const imported = careerRecord(input, { provenance: 'guest', now: this.now });
      const write = await this.deps.store.recordCareerMatch(accountId, imported);
      if (write === 'ok') importedXp += imported.xp;
    }

    const outcome = await this.deps.store.recordGuestMigration(record);
    if (outcome === 'conflict') {
      // A concurrent migration won. Report the state that is now true instead
      // of pretending the write succeeded.
      const winner = await this.deps.store.guestMigration(guestId);
      if (winner && winner.accountId === accountId && winner.profileDigest === profileDigest) {
        return jsonResponse({
          ok: true,
          status: 'already-migrated',
          migratedAt: winner.completedAt,
          importedXp: 0,
          career: await this.careerView(accountId),
        });
      }
      throw new AccountError('migration-conflict', 'A migration for this profile was already recorded.', 409);
    }
    return jsonResponse({
      ok: true,
      status: 'migrated',
      migratedAt: record.completedAt,
      importedXp,
      career: await this.careerView(accountId),
    });
  }

  /**
   * Validate a guest career payload. Absent means "no progress to import",
   * which is the Stage 1 shape and stays valid.
   */
  private guestCareer(raw: unknown): CareerMatchInput[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new AccountError('invalid-request', 'Guest career must be a list of matches.', 400);
    }
    if (raw.length > MAX_GUEST_IMPORT_MATCHES) {
      throw new AccountError('invalid-request', 'Guest career has too many matches to import.', 400);
    }
    const parsed: CareerMatchInput[] = [];
    for (const entry of raw) {
      const result = parseCareerMatch(entry);
      if (!result.ok) throw new AccountError(result.code, result.message, 400);
      if (result.value.mode === 'multiplayer') {
        throw new AccountError('invalid-request', 'A guest career cannot contain multiplayer results.', 400);
      }
      parsed.push(result.value);
    }
    return parsed;
  }
}

export async function handleAccountRequest(request: Request, deps: AccountDeps): Promise<Response> {
  try {
    return await new Router(deps).handle(request);
  } catch (error) {
    if (error instanceof AccountError) return errorResponse(error);
    // Never surface an internal message: it can contain SQL, an id or a secret
    // fragment. The code is enough for the client, and Cloudflare logs the rest.
    console.error('account-request-failed', error instanceof Error ? error.message : 'unknown');
    return errorResponse(new AccountError('server-error', 'The account service could not complete that request.', 500));
  }
}

export { PROVIDERS };
