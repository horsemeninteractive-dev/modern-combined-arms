/**
 * Authoritative multiplayer results, end to end.
 *
 * The room is the only source of an online match, so these tests drive the
 * account service's intake exactly as the room does: a shared secret, a match
 * reference derived from the room and its start time, and two seats. They check
 * that XP is computed server-side, that a retry cannot pay twice, that a short
 * match is recorded without a reward, and that the result card can read the
 * award through the player's own session.
 */
import { describe, expect, it } from 'vitest';
import { matchIdFor } from '../src/accounts/matchCareer';
import { rankForXp } from '../src/accounts/ranks';
import { verifyTicket } from '../src/accounts/tickets';
import { AccountHarness, RESULT_TOKEN, TICKET_SECRET } from './accounts-harness';

const ROOM_ID = 'room-alpha';

function session(cookie: string): string {
  return `mca_session=${cookie}`;
}

function seat(
  team: number,
  accountId: string | null,
  overrides: Partial<Record<string, number>> = {},
): Record<string, unknown> {
  return {
    team,
    accountId,
    nation: team === 0 ? 'poland' : 'russia',
    callsign: team === 0 ? 'Sable' : 'Vesper',
    avatar: 'insignia',
    stats: {
      unitsDestroyed: 18,
      unitsLost: 4,
      structuresDestroyed: 2,
      structuresLost: 1,
      structuresBuilt: 6,
      sitesCaptured: 2,
      superweaponsUsed: 0,
      objectivesCompleted: 0,
      ...overrides,
    },
  };
}

async function postResult(
  h: AccountHarness,
  body: Record<string, unknown>,
  token: string = RESULT_TOKEN,
): Promise<Response> {
  return h.request('/internal/mp-result', {
    method: 'POST',
    body,
    headers: { 'X-MCA-Result-Token': token },
  });
}

describe('authoritative multiplayer career results', () => {
  it('awards both seats once and exposes the award to the post-match screen', async () => {
    const h = await AccountHarness.create();
    const first = await h.signInGoogle('google-sable');
    const second = await h.signInGoogle('google-vesper');
    expect(first.accountId).not.toBeNull();
    expect(second.accountId).not.toBeNull();

    const startedAtMs = h.now - 10 * 60_000;
    const matchId = matchIdFor(ROOM_ID, startedAtMs);
    const body = {
      matchId,
      roomId: ROOM_ID,
      mapId: 'kestrel-bay',
      startedAtMs,
      finishedAtMs: h.now,
      winnerTeam: 0,
      players: [seat(0, first.accountId), seat(1, second.accountId)],
    };

    const response = await postResult(h, body);
    expect(response.status).toBe(200);
    const bodyOut = (await response.json()) as {
      ok: boolean;
      players: Array<{ seat: number; recorded: boolean; xp: number; status: string }>;
    };
    expect(bodyOut.ok).toBe(true);
    expect(bodyOut.players).toHaveLength(2);
    const winner = bodyOut.players.find((player) => player.seat === 0);
    const loser = bodyOut.players.find((player) => player.seat === 1);
    expect(winner?.recorded).toBe(true);
    expect(winner?.status).toBe('awarded');
    expect(winner?.xp ?? 0).toBeGreaterThan(0);
    // A defeat still pays, so leaving a losing match is never the better choice.
    expect(loser?.recorded).toBe(true);
    expect(loser?.xp ?? 0).toBeGreaterThan(0);
    expect(loser?.xp ?? 0).toBeLessThan(winner?.xp ?? 0);

    // A room retry after an ambiguous timeout cannot pay a second time.
    const retry = await postResult(h, body);
    expect(retry.status).toBe(200);
    const retryOut = (await retry.json()) as {
      players: Array<{ recorded: boolean; xp: number }>;
    };
    expect(retryOut.players.every((player) => player.recorded === false)).toBe(true);
    expect(retryOut.players.every((player) => player.xp === 0)).toBe(true);

    const careerResponse = await h.request('/career', { cookie: session(first.cookie) });
    expect(careerResponse.status).toBe(200);
    const career = (await careerResponse.json()) as {
      career: {
        totals: { xp: number; matches: number };
        stats: {
          modes: {
            multiplayer: { matches: number; victories: number };
            skirmish: { matches: number };
          };
          nations: Array<{ nation: string; matches: number }>;
        };
        matches: Array<{ ref: string; mode: string }>;
      };
    };
    expect(career.career.totals.matches).toBe(1);
    expect(career.career.totals.xp).toBe(winner?.xp);
    expect(career.career.stats.modes.multiplayer.matches).toBe(1);
    expect(career.career.stats.modes.multiplayer.victories).toBe(1);
    expect(career.career.stats.modes.skirmish.matches).toBe(0);
    expect(career.career.stats.nations[0]?.nation).toBe('poland');
    expect(career.career.stats.nations[0]?.matches).toBe(1);
    expect(career.career.matches[0]?.ref).toBe(matchId);
    expect(career.career.matches[0]?.mode).toBe('multiplayer');

    const resultResponse = await h.request(`/career/results/${encodeURIComponent(matchId)}`, {
      cookie: session(first.cookie),
    });
    expect(resultResponse.status).toBe(200);
    const result = (await resultResponse.json()) as {
      status: string;
      award: {
        xp: number;
        xpBefore: number;
        xpAfter: number;
        rankBefore: { name: string };
        rankAfter: { name: string };
        promoted: boolean;
      };
      match: { outcome: string };
    };
    expect(result.status).toBe('recorded');
    expect(result.match.outcome).toBe('victory');
    expect(result.award.xp).toBe(winner?.xp);
    expect(result.award.xpBefore).toBe(0);
    expect(result.award.xpAfter).toBe(winner?.xp);
    expect(result.award.rankBefore.name).toBe(rankForXp(0).rank.name);
    expect(result.award.rankAfter.name).toBe(rankForXp(winner?.xp ?? 0).rank.name);
    expect(result.award.promoted).toBe(false);
  });

  it('records a match that is too short without awarding XP', async () => {
    const h = await AccountHarness.create();
    const first = await h.signInGoogle('google-brief');
    const startedAtMs = h.now - 60_000;
    const matchId = matchIdFor('room-brief', startedAtMs);
    const response = await postResult(h, {
      matchId,
      roomId: 'room-brief',
      mapId: 'kestrel-bay',
      startedAtMs,
      finishedAtMs: h.now,
      winnerTeam: 0,
      players: [seat(0, first.accountId), seat(1, null)],
    });
    expect(response.status).toBe(200);
    const out = (await response.json()) as {
      players: Array<{ status: string; xp: number; recorded: boolean }>;
    };
    expect(out.players[0]).toMatchObject({ status: 'ineligible', xp: 0, recorded: true });
    // A guest seat is supported and simply pays nobody.
    expect(out.players[1]).toMatchObject({ status: 'guest', xp: 0 });

    const detail = await h.request(`/career/matches/${encodeURIComponent(matchId)}`, {
      cookie: session(first.cookie),
    });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      match: { xp: number; mode: string };
      report: { rewardStatus: string; breakdown: { reason: string } | null };
    };
    expect(body.match.xp).toBe(0);
    expect(body.report.rewardStatus).toBe('ineligible');
    expect(body.report.breakdown?.reason).toContain('3 minutes');
  });

  it('refuses a forged intake token and any client-authored multiplayer result', async () => {
    const h = await AccountHarness.create();
    const first = await h.signInGoogle('google-forger');
    const startedAtMs = h.now - 10 * 60_000;
    const matchId = matchIdFor('room-forged', startedAtMs);
    const forged = await postResult(
      h,
      {
        matchId,
        roomId: 'room-forged',
        startedAtMs,
        finishedAtMs: h.now,
        winnerTeam: 0,
        players: [seat(0, first.accountId), seat(1, null)],
      },
      'not-the-result-token',
    );
    expect(forged.status).toBe(401);

    const clientSubmit = await h.request('/matches', {
      method: 'POST',
      cookie: session(first.cookie),
      body: {
        ref: 'mp:room-forged:1',
        mode: 'multiplayer',
        outcome: 'victory',
        difficulty: 'veteran',
        durationSeconds: 600,
        kills: 10,
        unitsLost: 0,
      },
    });
    expect(clientSubmit.status).toBe(400);
    const body = (await clientSubmit.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid-request');
  });

  it('signs the earned rank into a seat ticket and never the client-chosen one', async () => {
    const h = await AccountHarness.create();
    const first = await h.signInGoogle('google-ranked');
    const startedAtMs = h.now - 10 * 60_000;
    const matchId = matchIdFor('room-rank', startedAtMs);
    await postResult(h, {
      matchId,
      roomId: 'room-rank',
      startedAtMs,
      finishedAtMs: h.now,
      winnerTeam: 0,
      players: [seat(0, first.accountId), seat(1, null)],
    });

    const career = (await (await h.request('/career', { cookie: session(first.cookie) })).json()) as {
      career: { totals: { xp: number } };
    };
    const ticketResponse = await h.request('/multiplayer/ticket', {
      method: 'POST',
      cookie: session(first.cookie),
    });
    expect(ticketResponse.status).toBe(200);
    const ticket = (await ticketResponse.json()) as { ticket: string };
    const verified = await verifyTicket(TICKET_SECRET, ticket.ticket, h.now);
    expect(verified).not.toBeNull();
    expect(verified?.identity?.rank).toBe(rankForXp(career.career.totals.xp).rank.id);
    expect(verified?.identity?.callsign).toMatch(/^Commander-/);
  });
});
