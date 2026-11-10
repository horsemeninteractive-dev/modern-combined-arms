/**
 * Short-lived multiplayer identity tickets.
 *
 * A browser holds a session cookie for the Pages origin; the room Worker lives
 * on another origin and never sees it. A ticket is the only thing that crosses:
 * an HMAC over an account id, an issue time and the player's presentable
 * identity, signed with a secret both Workers hold. The room verifies it
 * locally, so no per-request call to the account service sits in the matchmaking
 * path, and the browser cannot forge or extend one.
 *
 * v2 adds the callsign and avatar so the lobby can show a real opponent without
 * asking the account service mid-match, and now also the equipped command flag.
 * The identity is inside the signed message, so a seat cannot edit its own name
 * or flag by editing the ticket. The optional flag keeps older v2 tickets
 * readable: a ticket without one simply has no flag to show.
 *
 * v1 tickets are still accepted for the remainder of their two-minute life: a
 * room that was open when the account service was updated must not fail to
 * verify a ticket it was about to use.
 */
import { base64urlDecode, base64urlEncode, hmacSha256Base64url, hmacSha256Verify } from './crypto';
import { identitySnapshot, type IdentitySnapshot } from './identity';

export const TICKET_VERSION = 'v1';
export const TICKET_VERSION_V2 = 'v2';
export const TICKET_TTL_MS = 2 * 60_000;
const AUDIENCE = 'mca.room-identity';
// A flag composition is bounded at 4 KiB, and base64 adds a third. The limit
// stays far below anything a URL or header cannot carry.
const MAX_IDENTITY_BYTES = 8192;

function message(version: string, accountId: string, issuedAt: number, identity: string | null): string {
  return identity === null
    ? `${AUDIENCE}|${version}|${accountId}|${issuedAt}`
    : `${AUDIENCE}|${version}|${accountId}|${issuedAt}|${identity}`;
}

function encodeIdentity(identity: IdentitySnapshot): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(identity)));
}

function decodeIdentity(raw: string): IdentitySnapshot | null {
  if (raw.length > 12000) return null;
  try {
    const bytes = base64urlDecode(raw);
    if (bytes.length > MAX_IDENTITY_BYTES) return null;
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return identitySnapshot(parsed);
  } catch {
    return null;
  }
}

export async function issueTicket(
  secret: string,
  accountId: string,
  now: number,
  identity?: IdentitySnapshot | null,
): Promise<{ ticket: string; expiresAt: number }> {
  if (!identity) {
    const signature = await hmacSha256Base64url(secret, message(TICKET_VERSION, accountId, now, null));
    return {
      ticket: `${TICKET_VERSION}.${accountId}.${now}.${signature}`,
      expiresAt: now + TICKET_TTL_MS,
    };
  }
  // Re-validate rather than trusting the caller: an identity that would be
  // refused by the lobby must never be sealed into a ticket.
  const safe = identitySnapshot(identity);
  if (!safe) {
    const signature = await hmacSha256Base64url(secret, message(TICKET_VERSION, accountId, now, null));
    return {
      ticket: `${TICKET_VERSION}.${accountId}.${now}.${signature}`,
      expiresAt: now + TICKET_TTL_MS,
    };
  }
  const encoded = encodeIdentity(safe);
  const signature = await hmacSha256Base64url(
    secret,
    message(TICKET_VERSION_V2, accountId, now, encoded),
  );
  return {
    ticket: `${TICKET_VERSION_V2}.${accountId}.${now}.${encoded}.${signature}`,
    expiresAt: now + TICKET_TTL_MS,
  };
}

export interface VerifiedTicket {
  accountId: string;
  issuedAt: number;
  /** Present for a v2 ticket; a v1 ticket has no identity to offer. */
  identity?: IdentitySnapshot;
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
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [version, accountId, issuedRaw, ...rest] = parts;
  if (version !== TICKET_VERSION && version !== TICKET_VERSION_V2) return null;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(accountId)) return null;
  if (!/^\d{1,16}$/.test(issuedRaw)) return null;
  const issuedAt = Number(issuedRaw);
  if (issuedAt > now + 30_000) return null;
  if (now - issuedAt > ttlMs) return null;

  if (version === TICKET_VERSION) {
    if (rest.length !== 1) return null;
    const valid = await hmacSha256Verify(
      secret,
      message(TICKET_VERSION, accountId, issuedAt, null),
      rest[0],
    );
    return valid ? { accountId, issuedAt } : null;
  }

  if (rest.length !== 2) return null;
  const [encodedIdentity, signature] = rest;
  if (!/^[A-Za-z0-9_-]{1,12000}$/.test(encodedIdentity)) return null;
  const valid = await hmacSha256Verify(
    secret,
    message(TICKET_VERSION_V2, accountId, issuedAt, encodedIdentity),
    signature,
  );
  if (!valid) return null;
  const identity = decodeIdentity(encodedIdentity);
  if (!identity) return null;
  return { accountId, issuedAt, identity };
}
