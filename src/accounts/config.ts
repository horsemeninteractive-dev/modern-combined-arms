/**
 * Account Worker configuration, resolved once per request from bindings.
 *
 * A deployment with no OAuth client ids is a legal deployment: guest play works,
 * the account UI reports which providers are unavailable, and the start route
 * refuses cleanly instead of redirecting to a provider with an empty client id.
 */
import type { ProviderId } from './types';
import { PROVIDERS } from './types';

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  /** Exact redirect URI registered at the provider. */
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
}

export interface AccountConfig {
  appOrigin: string;
  /** Origins allowed to make state-changing calls. Always includes appOrigin. */
  allowedOrigins: readonly string[];
  devMode: boolean;
  cookieSecure: boolean;
  /** Idle session lifetime. Activity refreshes it at most once a day. */
  sessionTtlMs: number;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  ticketSecret: string | null;
  now: () => number;
}

export interface AccountEnv {
  DB?: unknown;
  APP_ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
  ACCOUNT_DEV_MODE?: string;
  SESSION_TTL_DAYS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_REDIRECT_URI?: string;
  MCA_IDENTITY_TICKET_SECRET?: string;
}

export const DEFAULT_SESSION_TTL_DAYS = 30;
const MAX_SESSION_TTL_DAYS = 90;

function splitOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function normaliseOrigin(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

function sessionTtlMs(raw: string | undefined): number {
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) return DEFAULT_SESSION_TTL_DAYS * 86_400_000;
  return Math.min(days, MAX_SESSION_TTL_DAYS) * 86_400_000;
}

/**
 * Provider configuration. The redirect URI defaults to the app's own proxy
 * path, which is the only address that works with first-party cookies; an
 * explicit value still has to be an absolute https (or loopback) URL, so a
 * misconfiguration cannot silently send credentials somewhere unexpected.
 */
export function resolveConfig(env: AccountEnv, now: () => number = Date.now): AccountConfig {
  const devMode = env.ACCOUNT_DEV_MODE === '1';
  const appOrigin = normaliseOrigin(env.APP_ORIGIN, devMode ? 'http://127.0.0.1:5173' : 'https://moderncombinedarms.pages.dev');
  const allowed = new Set<string>([appOrigin, ...splitOrigins(env.ALLOWED_ORIGINS)]);
  if (devMode) {
    allowed.add('http://127.0.0.1:5173');
    allowed.add('http://localhost:5173');
  }

  const providers: Partial<Record<ProviderId, ProviderConfig>> = {};
  const googleId = env.GOOGLE_CLIENT_ID?.trim();
  const googleSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (googleId && googleSecret) {
    providers.google = {
      clientId: googleId,
      clientSecret: googleSecret,
      redirectUri: env.GOOGLE_REDIRECT_URI?.trim() || `${appOrigin}/api/account/auth/google/callback`,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
    };
  }
  const discordId = env.DISCORD_CLIENT_ID?.trim();
  const discordSecret = env.DISCORD_CLIENT_SECRET?.trim();
  if (discordId && discordSecret) {
    providers.discord = {
      clientId: discordId,
      clientSecret: discordSecret,
      redirectUri: env.DISCORD_REDIRECT_URI?.trim() || `${appOrigin}/api/account/auth/discord/callback`,
      authorizeUrl: 'https://discord.com/oauth2/authorize',
      tokenUrl: 'https://discord.com/api/oauth2/token',
      scope: 'identify',
    };
  }

  return {
    appOrigin,
    allowedOrigins: [...allowed],
    devMode,
    // A Secure cookie is mandatory outside development: without it the session
    // would travel over plain HTTP on any downgrade.
    cookieSecure: !devMode,
    sessionTtlMs: sessionTtlMs(env.SESSION_TTL_DAYS),
    providers,
    ticketSecret: env.MCA_IDENTITY_TICKET_SECRET?.trim() || null,
    now,
  };
}

export function configuredProviders(config: AccountConfig): ProviderId[] {
  return PROVIDERS.filter((provider) => Boolean(config.providers[provider]));
}
