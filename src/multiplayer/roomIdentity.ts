/**
 * Account identity at the room edge.
 *
 * A browser can set any header it likes, so the room Worker treats identity as
 * untrusted input: the ticket header is removed from every request, verified
 * against the shared secret, and only then re-added as a trusted header for the
 * Durable Object. Absence of a ticket means guest, which is a supported state,
 * not a failure.
 *
 * Kept out of `roomWorker.ts` so the rules are testable without the Worker's
 * virtual browser-module imports.
 */
import { verifyTicket } from '../accounts/tickets';

export type RoomIdentityResult =
  | { ok: true; request: Request; accountId: string | null }
  | { ok: false; status: number; code: string; message: string };

/**
 * Rebuild a request with new headers, preserving its body.
 *
 * A stream body needs `duplex: 'half'` in the fetch standard, which Workers
 * accept and Node requires; the DOM type does not name it, so it is added
 * explicitly rather than asserted away.
 */
function rebuild(request: Request, headers: Headers): Request {
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    body: request.body,
  };
  if (request.body) init.duplex = 'half';
  return new Request(request.url, init);
}

/** Remove both identity headers, including a spoofed trusted one. */
export function stripIdentityHeaders(request: Request): Request {
  if (!request.headers.has('X-MCA-Verified-Account') && !request.headers.has('X-MCA-Identity-Ticket')) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.delete('X-MCA-Verified-Account');
  headers.delete('X-MCA-Identity-Ticket');
  return rebuild(request, headers);
}

export async function withVerifiedIdentity(
  request: Request,
  secret: string | undefined,
  now: number = Date.now(),
): Promise<RoomIdentityResult> {
  const ticket = request.headers.get('X-MCA-Identity-Ticket');
  const stripped = stripIdentityHeaders(request);
  if (!ticket) return { ok: true, request: stripped, accountId: null };

  if (!secret) {
    return {
      ok: false,
      status: 503,
      code: 'identity-unavailable',
      message: 'Verified account identity is not configured for this room service.',
    };
  }
  const verified = await verifyTicket(secret, ticket, now);
  if (!verified) {
    return {
      ok: false,
      status: 401,
      code: 'invalid-identity',
      message: 'The account identity ticket is not valid.',
    };
  }
  const headers = new Headers(stripped.headers);
  headers.set('X-MCA-Verified-Account', verified.accountId);
  return { ok: true, accountId: verified.accountId, request: rebuild(stripped, headers) };
}
