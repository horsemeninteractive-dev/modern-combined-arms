/**
 * Short-lived multiplayer identity tickets.
 *
 * A browser holds a session cookie for the Pages origin; the room Worker lives
 * on another origin and never sees it. A ticket is the only thing that crosses:
 * an HMAC over an account id and an issue time, signed with a secret both
 * Workers hold. The room verifies it locally, so no per-request call to the
 * account service sits in the matchmaking path, and the browser cannot forge or
 * extend one.
 *
 * The account id is opaque and scoped to this purpose through the signed
 * message, so a ticket can never be replayed as a session or vice versa.
 */
import { hmacSha256Base64url, hmacSha256Verify } from './crypto';

export const TICKET_VERSION = 'v1';
export const TICKET_TTL_MS = 2 * 60_000;
const AUDIENCE = 'mca.room-identity';

function message(accountId: string, issuedAt: number): string {
  return `${AUDIENCE}|${TICKET_VERSION}|${accountId}|${issuedAt}`;
}

export async function issueTicket(
  secret: string,
  accountId: string,
  now: number,
): Promise<{ ticket: string; expiresAt: number }> {
  const signature = await hmacSha256Base64url(secret, message(accountId, now));
  return {
    ticket: `${TICKET_VERSION}.${accountId}.${now}.${signature}`,
    expiresAt: now + TICKET_TTL_MS,
  };
}

export interface VerifiedTicket {
  accountId: string;
  issuedAt: number;
}

/**
 * Verify a ticket. Returns null for a malformed, forged, expired or
 * future-dated ticket — the caller must treat all of those identically.
 */
export async function verifyTicket(
  secret: string,
  ticket: string,
  now: number,
  ttlMs: number = TICKET_TTL_MS,
): Promise<VerifiedTicket | null> {
  const parts = ticket.split('.');
  if (parts.length !== 4) return null;
  const [version, accountId, issuedRaw, signature] = parts;
  if (version !== TICKET_VERSION) return null;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(accountId)) return null;
  if (!/^\d{1,16}$/.test(issuedRaw)) return null;
  const issuedAt = Number(issuedRaw);
  if (issuedAt > now + 30_000) return null;
  if (now - issuedAt > ttlMs) return null;
  const valid = await hmacSha256Verify(secret, message(accountId, issuedAt), signature);
  return valid ? { accountId, issuedAt } : null;
}
