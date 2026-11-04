import { describe, expect, it } from 'vitest';
import { careerXp } from '../src/accounts/career';
import { AccountHarness } from './accounts-harness';

const match = {
  ref: 'skirmish:0123abcd-0001',
  mode: 'skirmish',
  outcome: 'victory',
  difficulty: 'veteran',
  durationSeconds: 600,
  nation: 'uk',
  kills: 14,
  unitsLost: 3,
} as const;

interface CareerBody {
  totals: { xp: number; matches: number; victories: number; defeats: number };
  rank: { id: string; name: string };
  next: { id: string; xpRequired: number } | null;
  progress: number;
  matches: Array<{ ref: string; xp: number; provenance: string }>;
}

async function career(response: Response): Promise<CareerBody> {
  const body = (await response.json()) as { career: CareerBody };
  return body.career;
}

async function signedIn(): Promise<{ harness: AccountHarness; cookie: string }> {
  const harness = await AccountHarness.create();
  const signIn = await harness.signInGoogle('career-officer');
  return { harness, cookie: `mca_session=${signIn.cookie}` };
}

describe('career reads', () => {
  it('requires a session', async () => {
    const harness = await AccountHarness.create();
    const response = await harness.request('/career');
    expect(response.status).toBe(401);
  });

  it('starts a new account at Private with no matches', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/career', { cookie });
    expect(response.status).toBe(200);
    const view = await career(response);
    expect(view.totals.xp).toBe(0);
    expect(view.totals.matches).toBe(0);
    expect(view.rank.id).toBe('private');
    expect(view.next?.id).toBe('corporal');
    expect(view.matches).toEqual([]);
  });
});

describe('recording a match', () => {
  it('recomputes XP on the server and returns the new standing', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/matches', { method: 'POST', cookie, body: match });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      recorded: boolean;
      award: { xp: number };
      career: CareerBody;
    };
    expect(body.recorded).toBe(true);
    expect(body.award.xp).toBe(careerXp({ ...match, mode: 'skirmish', outcome: 'victory', difficulty: 'veteran' }));
    expect(body.career.totals.xp).toBe(body.award.xp);
    expect(body.career.totals.matches).toBe(1);
    expect(body.career.totals.victories).toBe(1);
    expect(body.career.matches[0].provenance).toBe('local');
  });

  it('ignores an XP value supplied by the client', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/matches', {
      method: 'POST',
      cookie,
      body: { ...match, xp: 999_999 },
    });
    const body = (await response.json()) as { award: { xp: number } };
    expect(body.award.xp).toBe(110);
  });

  it('pays once for a repeated reference', async () => {
    const { harness, cookie } = await signedIn();
    const first = await harness.request('/matches', { method: 'POST', cookie, body: match });
    expect(first.status).toBe(200);
    const second = await harness.request('/matches', { method: 'POST', cookie, body: match });
    const body = (await second.json()) as { recorded: boolean; award: { xp: number }; career: CareerBody };
    expect(body.recorded).toBe(false);
    expect(body.award.xp).toBe(0);
    expect(body.career.matches).toHaveLength(1);
    expect(body.career.totals.matches).toBe(1);
  });

  it('accumulates outcomes and totals', async () => {
    const { harness, cookie } = await signedIn();
    await harness.request('/matches', { method: 'POST', cookie, body: match });
    await harness.request('/matches', {
      method: 'POST',
      cookie,
      body: { ...match, ref: 'campaign:baltic:op-1', mode: 'campaign', outcome: 'defeat', durationSeconds: 1_200 },
    });
    const response = await harness.request('/career', { cookie });
    const view = await career(response);
    expect(view.totals.matches).toBe(2);
    expect(view.totals.victories).toBe(1);
    expect(view.totals.defeats).toBe(1);
    expect(view.totals.xp).toBe(
      110 + careerXp({ ...match, mode: 'campaign', outcome: 'defeat', durationSeconds: 1_200 }),
    );
  });

  it.each([
    ['unknown mode', { ...match, mode: 'survival' }],
    ['missing ref', { ...match, ref: '' }],
    ['negative duration', { ...match, durationSeconds: -1 }],
    ['unsafe nation', { ...match, nation: '../uk' }],
  ])('rejects %s', async (_label, body) => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/matches', { method: 'POST', cookie, body });
    expect(response.status).toBe(400);
  });

  it('refuses a client claiming authoritative provenance', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/matches', {
      method: 'POST',
      cookie,
      body: { ...match, provenance: 'authoritative' },
    });
    expect(response.status).toBe(400);
    const view = await career(await harness.request('/career', { cookie }));
    expect(view.totals.matches).toBe(0);
  });

  it('refuses multiplayer results from a client', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/matches', {
      method: 'POST',
      cookie,
      body: { ...match, mode: 'multiplayer' },
    });
    expect(response.status).toBe(400);
  });

  it('refuses a cross-origin submission', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/matches', {
      method: 'POST',
      cookie,
      body: match,
      origin: 'https://evil.test',
    });
    expect(response.status).toBe(403);
  });

  it('stops a scripted flood at the daily budget', async () => {
    const { harness, cookie } = await signedIn();
    for (let i = 0; i < 60; i++) {
      const response = await harness.request('/matches', {
        method: 'POST',
        cookie,
        body: { ...match, ref: `skirmish:flood-${i.toString().padStart(4, '0')}` },
      });
      expect(response.status).toBe(200);
    }
    const blocked = await harness.request('/matches', {
      method: 'POST',
      cookie,
      body: { ...match, ref: 'skirmish:flood-9999' },
    });
    expect(blocked.status).toBe(429);
  });
});

describe('guest career import', () => {
  const guestId = 'g'.repeat(22);
  const migration = {
    guestId,
    migrationKey: 'k'.repeat(20),
    profileDigest: 'a'.repeat(64),
  };

  it('imports the guest ledger once and reports the carried XP', async () => {
    const { harness, cookie } = await signedIn();
    const imported = [
      { ...match, ref: 'skirmish:guest-0001' },
      { ...match, ref: 'skirmish:guest-0002', outcome: 'defeat', durationSeconds: 300 },
    ];
    const response = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie,
      body: { ...migration, career: imported },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { importedXp: number; career: CareerBody };
    const expected =
      careerXp({ ...match, mode: 'skirmish', outcome: 'victory', difficulty: 'veteran' }) +
      careerXp({ ...match, mode: 'skirmish', outcome: 'defeat', difficulty: 'veteran', durationSeconds: 300 });
    expect(body.importedXp).toBe(expected);
    expect(body.career.totals.xp).toBe(expected);
    expect(body.career.matches.every((entry) => entry.provenance === 'guest')).toBe(true);
  });

  it('stays idempotent on a repeated migration', async () => {
    const { harness, cookie } = await signedIn();
    const body = { ...migration, career: [{ ...match, ref: 'skirmish:guest-0001' }] };
    await harness.request('/migrate/guest', { method: 'POST', cookie, body });
    const repeat = await harness.request('/migrate/guest', { method: 'POST', cookie, body });
    const parsed = (await repeat.json()) as { status: string; importedXp: number; career: CareerBody };
    expect(parsed.status).toBe('already-migrated');
    expect(parsed.importedXp).toBe(0);
    expect(parsed.career.totals.matches).toBe(1);
    expect(parsed.career.totals.xp).toBe(110);
  });

  it('rejects an invalid guest career without importing anything', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie,
      body: { ...migration, career: [{ ...match, ref: 'skirmish:guest-0001', mode: 'survival' }] },
    });
    expect(response.status).toBe(400);
    const view = await career(await harness.request('/career', { cookie }));
    expect(view.totals.matches).toBe(0);
  });

  it('rejects a guest career containing multiplayer results', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie,
      body: { ...migration, career: [{ ...match, ref: 'skirmish:guest-0001', mode: 'multiplayer' }] },
    });
    expect(response.status).toBe(400);
  });

  it('accepts a migration with no career, as Stage 1 did', async () => {
    const { harness, cookie } = await signedIn();
    const response = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie,
      body: migration,
    });
    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { importedXp: number };
    expect(parsed.importedXp).toBe(0);
  });
});

describe('career isolation', () => {
  it("keeps two accounts' careers separate", async () => {
    const harness = await AccountHarness.create();
    const first = await harness.signInGoogle('officer-one');
    const second = await harness.signInGoogle('officer-two');
    await harness.request('/matches', {
      method: 'POST',
      cookie: `mca_session=${first.cookie}`,
      body: match,
    });
    const other = await career(await harness.request('/career', { cookie: `mca_session=${second.cookie}` }));
    expect(other.totals.matches).toBe(0);
    expect(other.totals.xp).toBe(0);
  });

  it('refuses the career once the session is revoked', async () => {
    const { harness, cookie } = await signedIn();
    await harness.request('/logout', { method: 'POST', cookie });
    const response = await harness.request('/career', { cookie });
    expect(response.status).toBe(401);
  });
});
