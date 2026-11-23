import { describe, expect, it } from 'vitest';
import { AccountHarness } from './accounts-harness';

/**
 * The Outbreak board is the one part of the mode that is not simulated: a
 * finished run is reported by the client, so the service's job is to validate
 * the envelope, bind the run to the signed-in account, and keep the best run
 * rather than the latest one. These tests exercise that through the real router
 * against the in-memory store.
 */
function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'solo',
    difficulty: 'normal',
    wave: 12,
    wavesCompleted: 11,
    zombiesKilled: 410,
    durationSeconds: 2_210,
    structuresLost: 2,
    unitsLost: 14,
    nations: ['lithuania'],
    ...overrides,
  };
}

async function signedIn(harness: AccountHarness, sub: string): Promise<string> {
  const { cookie } = await harness.signInGoogle(sub);
  return `mca_session=${cookie}`;
}

interface BoardBody {
  ok: boolean;
  improved?: boolean;
  mode: string;
  map: string;
  difficulty: string;
  you?: boolean;
  signedIn: boolean;
  entries: Array<{
    rank: number;
    callsign: string;
    mode: string;
    wave: number;
    wavesCompleted: number;
    zombiesKilled: number;
    players: number;
    you: boolean;
  }>;
  own: { rank: number; wave: number; callsign: string } | null;
  error?: { code: string; message: string };
}

async function board(body: Response): Promise<BoardBody> {
  return (await body.json()) as BoardBody;
}

describe('Outbreak leaderboards', () => {
  it('records a signed-in run and ranks it on a readable board', async () => {
    const harness = await AccountHarness.create();
    const cookie = await signedIn(harness, 'outbreak-first');

    const posted = await harness.request('/outbreak/runs', {
      method: 'POST',
      cookie,
      body: run(),
    });
    expect(posted.status).toBe(200);
    const afterPost = await board(posted);
    expect(afterPost.improved).toBe(true);
    expect(afterPost.entries).toHaveLength(1);
    expect(afterPost.entries[0].rank).toBe(1);
    expect(afterPost.entries[0].wave).toBe(12);
    expect(afterPost.entries[0].you).toBe(true);
    expect(afterPost.own?.rank).toBe(1);

    // A guest may read the board; it carries a callsign, never an account id.
    const guest = await board(await harness.request('/outbreak/leaderboard?mode=solo&difficulty=normal'));
    expect(guest.signedIn).toBe(false);
    expect(guest.own).toBeNull();
    expect(guest.entries).toHaveLength(1);
    expect(guest.entries[0]).not.toHaveProperty('accountId');
    expect(guest.entries[0].callsign).toMatch(/\S/);

    const signed = await board(
      await harness.request('/outbreak/leaderboard?mode=solo&difficulty=normal', { cookie }),
    );
    expect(signed.signedIn).toBe(true);
    expect(signed.own?.rank).toBe(1);
  });

  it('keeps the better run when a worse one finishes later', async () => {
    const harness = await AccountHarness.create();
    const cookie = await signedIn(harness, 'outbreak-best');

    await harness.request('/outbreak/runs', {
      method: 'POST',
      cookie,
      body: run({ wave: 21, wavesCompleted: 20, zombiesKilled: 900, durationSeconds: 3_600 }),
    });
    const worse = await board(
      await harness.request('/outbreak/runs', {
        method: 'POST',
        cookie,
        body: run({ wave: 7, wavesCompleted: 6, zombiesKilled: 120, durationSeconds: 900 }),
      }),
    );
    expect(worse.improved).toBe(false);
    expect(worse.entries).toHaveLength(1);
    expect(worse.entries[0].wave).toBe(21);
    expect(worse.own?.wave).toBe(21);
  });

  it('separates solo, duo and difficulty into their own boards', async () => {
    const harness = await AccountHarness.create();
    const solo = await signedIn(harness, 'outbreak-solo-seat');
    const duo = await signedIn(harness, 'outbreak-duo-seat');

    await harness.request('/outbreak/runs', {
      method: 'POST',
      cookie: solo,
      body: run({ wave: 18, wavesCompleted: 17, durationSeconds: 3_100 }),
    });
    await harness.request('/outbreak/runs', {
      method: 'POST',
      cookie: duo,
      body: run({ mode: 'coop', wave: 9, wavesCompleted: 8, nations: ['lithuania', 'poland'] }),
    });

    const duoBoard = await board(
      await harness.request('/outbreak/leaderboard?mode=coop&difficulty=normal'),
    );
    expect(duoBoard.entries).toHaveLength(1);
    expect(duoBoard.entries[0].wave).toBe(9);
    expect(duoBoard.entries[0].players).toBe(2);

    const soloBoard = await board(
      await harness.request('/outbreak/leaderboard?mode=solo&difficulty=normal'),
    );
    expect(soloBoard.entries).toHaveLength(1);
    expect(soloBoard.entries[0].wave).toBe(18);

    const hardBoard = await board(
      await harness.request('/outbreak/leaderboard?mode=solo&difficulty=hard'),
    );
    expect(hardBoard.entries).toHaveLength(0);
  });

  it('orders the board by the wave held, then kills and time', async () => {
    const harness = await AccountHarness.create();
    const first = await signedIn(harness, 'outbreak-rank-one');
    const second = await signedIn(harness, 'outbreak-rank-two');

    await harness.request('/outbreak/runs', {
      method: 'POST',
      cookie: first,
      body: run({ wave: 15, wavesCompleted: 14, zombiesKilled: 500, durationSeconds: 2_600 }),
    });
    await harness.request('/outbreak/runs', {
      method: 'POST',
      cookie: second,
      body: run({ wave: 15, wavesCompleted: 14, zombiesKilled: 640, durationSeconds: 2_900 }),
    });

    const ranked = await board(
      await harness.request('/outbreak/leaderboard?mode=solo&difficulty=normal'),
    );
    expect(ranked.entries.map((entry) => entry.rank)).toEqual([1, 2]);
    expect(ranked.entries[0].zombiesKilled).toBe(640);
    expect(ranked.entries[1].zombiesKilled).toBe(500);
  });

  it('refuses runs whose figures contradict each other', async () => {
    const harness = await AccountHarness.create();
    const cookie = await signedIn(harness, 'outbreak-invalid');

    const tooManyWaves = await board(
      await harness.request('/outbreak/runs', {
        method: 'POST',
        cookie,
        body: run({ wave: 8, wavesCompleted: 9 }),
      }),
    );
    expect(tooManyWaves.error?.message).toMatch(/contradict/);

    const tooQuick = await board(
      await harness.request('/outbreak/runs', {
        method: 'POST',
        cookie,
        body: run({ wave: 20, wavesCompleted: 19, durationSeconds: 40, zombiesKilled: 300 }),
      }),
    );
    expect(tooQuick.error?.message).toMatch(/shorter/);

    const impossibleKills = await board(
      await harness.request('/outbreak/runs', {
        method: 'POST',
        cookie,
        body: run({ wave: 2, wavesCompleted: 1, zombiesKilled: 90_000, durationSeconds: 120 }),
      }),
    );
    expect(impossibleKills.error?.message).toMatch(/horde/);

    const unchanged = await board(
      await harness.request('/outbreak/leaderboard?mode=solo&difficulty=normal', { cookie }),
    );
    expect(unchanged.entries).toHaveLength(0);
    expect(unchanged.own).toBeNull();
  });

  it('gives every map its own board', async () => {
    const harness = await AccountHarness.create();
    const cookie = await signedIn(harness, 'outbreak-map-boards');

    // The same commander, mode and difficulty, on two different battlefields:
    // these are two boards, not one board with a filter.
    await harness.request('/outbreak/runs', {
      method: 'POST',
      cookie,
      body: run({ map: 'outbreak-relay-basin', wave: 9, wavesCompleted: 8, durationSeconds: 1_800 }),
    });
    await harness.request('/outbreak/runs', {
      method: 'POST',
      cookie,
      body: run({ map: 'outbreak-civic-square', wave: 14, wavesCompleted: 13, durationSeconds: 2_600 }),
    });

    const basin = await board(
      await harness.request(
        '/outbreak/leaderboard?mode=solo&difficulty=normal&map=outbreak-relay-basin',
        { cookie },
      ),
    );
    const city = await board(
      await harness.request(
        '/outbreak/leaderboard?mode=solo&difficulty=normal&map=outbreak-civic-square',
        { cookie },
      ),
    );
    expect(basin.entries).toHaveLength(1);
    expect(basin.entries[0].wave).toBe(9);
    expect(city.entries).toHaveLength(1);
    expect(city.entries[0].wave).toBe(14);
    expect(basin.map).toBe('outbreak-relay-basin');
    expect(city.map).toBe('outbreak-civic-square');

    // A board with no map named is the basin: that is where every run was
    // fought before the maps shipped, and where an older client still posts.
    const legacy = await board(
      await harness.request('/outbreak/leaderboard?mode=solo&difficulty=normal'),
    );
    expect(legacy.map).toBe('outbreak-relay-basin');
    expect(legacy.entries).toHaveLength(1);

    const unknownBoard = await harness.request(
      '/outbreak/leaderboard?mode=solo&difficulty=normal&map=outbreak-nowhere',
    );
    expect(unknownBoard.status).toBe(400);

    const unknownRun = await board(
      await harness.request('/outbreak/runs', {
        method: 'POST',
        cookie,
        body: run({ map: 'outbreak-nowhere' }),
      }),
    );
    expect(unknownRun.error?.message).toMatch(/battlefield/);
  });

  it('requires a session to post and refuses an unknown board', async () => {
    const harness = await AccountHarness.create();
    const anonymous = await harness.request('/outbreak/runs', { method: 'POST', body: run() });
    expect(anonymous.status).toBe(401);

    const wrongBoard = await harness.request('/outbreak/leaderboard?mode=free-for-all');
    expect(wrongBoard.status).toBe(400);

    const wrongMethod = await harness.request('/outbreak/leaderboard', { method: 'POST' });
    expect(wrongMethod.status).toBe(405);
  });
});
