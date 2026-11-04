/**
 * Multiplayer identity foundation: signed tickets, the room Worker's edge
 * verification, and the additive seat field the Durable Object now persists.
 */
import { describe, expect, it } from 'vitest';
import { issueTicket, TICKET_TTL_MS, verifyTicket } from '../src/accounts/tickets';
import { validatePersistedMeta } from '../src/multiplayer/roomDurableObject';
import { withVerifiedIdentity } from '../src/multiplayer/roomIdentity';
import { LobbyClient } from '../src/multiplayer/lobbyClient';

const SECRET = 'identity-test-secret-0123456789';
const ACCOUNT = 'account-identifier-0123456789';

describe('identity tickets', () => {
  it('round-trips an account id and expires on time', async () => {
    const now = 1_700_000_000_000;
    const { ticket, expiresAt } = await issueTicket(SECRET, ACCOUNT, now);
    expect(expiresAt).toBe(now + TICKET_TTL_MS);
    expect(await verifyTicket(SECRET, ticket, now)).toEqual({ accountId: ACCOUNT, issuedAt: now });
    expect(await verifyTicket(SECRET, ticket, now + TICKET_TTL_MS + 1)).toBeNull();
  });

  it('refuses a tampered account, a foreign signature, and a future issue time', async () => {
    const now = 1_700_000_000_000;
    const { ticket } = await issueTicket(SECRET, ACCOUNT, now);
    const parts = ticket.split('.');
    const forged = [parts[0], 'otheraccountidentifier12', parts[2], parts[3]].join('.');
    expect(await verifyTicket(SECRET, forged, now)).toBeNull();
    expect(await verifyTicket('another-secret-0123456789abcdef', ticket, now)).toBeNull();
    expect(await verifyTicket(SECRET, ticket, now - 120_000)).toBeNull();
    expect(await verifyTicket(SECRET, 'garbage', now)).toBeNull();
    expect(await verifyTicket(SECRET, 'v2.x.1.y', now)).toBeNull();
  });
});

describe('room metadata', () => {
  const validMeta = () => ({
    version: 1,
    roomId: 'identity-room',
    mode: '1v1',
    seats: [
      { seatId: 0, playerId: 0, team: 0, token: 'seat-zero-token-000000000000' },
      { seatId: 1, playerId: 1, team: 1, token: 'seat-one-token-0000000000000' },
    ],
    reservation: { status: 'active', hardDeadlineAt: 601_000 },
    createdAt: 1000,
    matchDurationMs: 600_000,
    started: true,
    startedAtMs: 1000,
    finishedAtMs: null,
    totalTicks: 20,
    closed: false,
    closedReason: null,
    closedAt: null,
    finalResult: null,
  });

  it('accepts a verified seat account and a guest seat', () => {
    expect(validatePersistedMeta(validMeta(), 'identity-room')).toBeNull();
    const withAccount = validMeta();
    withAccount.seats[0] = { ...withAccount.seats[0], accountId: ACCOUNT } as (typeof withAccount.seats)[0];
    expect(validatePersistedMeta(withAccount, 'identity-room')).toBeNull();
  });

  it('rejects a stored account that could not have come from a ticket', () => {
    const bad = validMeta();
    bad.seats[0] = { ...bad.seats[0], accountId: 'not an account id' } as (typeof bad.seats)[0];
    expect(validatePersistedMeta(bad, 'identity-room')).toMatch(/seat account is invalid/);
  });
});

function openRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://rooms.test/api/multiplayer/rooms/identity-room/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ roomId: 'identity-room', mode: '1v1', matchDurationMs: 600_000 }),
  });
}

describe('room identity edge', () => {
  it('forwards a verified account and removes the ticket', async () => {
    const { ticket } = await issueTicket(SECRET, ACCOUNT, Date.now());
    const result = await withVerifiedIdentity(openRequest({ 'X-MCA-Identity-Ticket': ticket }), SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accountId).toBe(ACCOUNT);
    expect(result.request.headers.get('X-MCA-Verified-Account')).toBe(ACCOUNT);
    expect(result.request.headers.get('X-MCA-Identity-Ticket')).toBeNull();
  });

  it('strips a spoofed trusted header from an unauthenticated caller', async () => {
    const result = await withVerifiedIdentity(
      openRequest({ 'X-MCA-Verified-Account': ACCOUNT }),
      SECRET,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accountId).toBeNull();
    expect(result.request.headers.get('X-MCA-Verified-Account')).toBeNull();
  });

  it('refuses a forged ticket instead of downgrading to a guest seat', async () => {
    const result = await withVerifiedIdentity(
      openRequest({ 'X-MCA-Identity-Ticket': 'v1.account-identifier-0123456789.1.forged' }),
      SECRET,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(401);
    expect(result.code).toBe('invalid-identity');
  });

  it('keeps guest play working, and refuses a ticket when unconfigured', async () => {
    const guest = await withVerifiedIdentity(openRequest(), SECRET);
    expect(guest.ok).toBe(true);
    if (guest.ok) expect(guest.accountId).toBeNull();

    const { ticket } = await issueTicket(SECRET, ACCOUNT, Date.now());
    const refused = await withVerifiedIdentity(
      openRequest({ 'X-MCA-Identity-Ticket': ticket }),
      undefined,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.status).toBe(503);
  });
});

describe('lobby client identity', () => {
  function client(ticket: (() => Promise<string | null>) | undefined, captured: Array<Record<string, string>>) {
    return new LobbyClient({
      origin: 'https://rooms.test',
      onChange: () => undefined,
      identityTicket: ticket,
      createSocket: () => ({
        readyState: 0,
        send: () => undefined,
        close: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as never,
      fetch: (async (input: string, init?: RequestInit) => {
        captured.push(Object.fromEntries(new Headers(init?.headers).entries()));
        if (input.endsWith('/open') || input.endsWith('/join')) {
          return new Response(
            JSON.stringify({ ok: true, seat: 0, token: 'seat-token-000000000000', joinCode: 'ABCDEFGH' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch,
    });
  }

  it('presents a ticket when opening a room and never on ordinary actions', async () => {
    const captured: Array<Record<string, string>> = [];
    const lobby = client(async () => 'ticket-value', captured);
    await lobby.createRoom(600_000, 'identity-room');
    await lobby.startMatch();
    expect(captured[0]['x-mca-identity-ticket']).toBe('ticket-value');
    expect(captured[1]?.['x-mca-identity-ticket']).toBeUndefined();
  });

  it('opens a guest seat when the account service cannot issue a ticket', async () => {
    const captured: Array<Record<string, string>> = [];
    const lobby = client(async () => {
      throw new Error('offline');
    }, captured);
    await lobby.createRoom(600_000, 'identity-room');
    expect(captured[0]['x-mca-identity-ticket']).toBeUndefined();
    expect(captured[0]['content-type']).toBe('application/json');
  });

  it('sends no identity header at all when the player is a guest', async () => {
    const captured: Array<Record<string, string>> = [];
    const lobby = client(undefined, captured);
    await lobby.createRoom(600_000, 'identity-room');
    expect(captured[0]['x-mca-identity-ticket']).toBeUndefined();
  });
});
