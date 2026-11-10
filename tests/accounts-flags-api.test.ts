import { describe, expect, it } from 'vitest';
import { AccountHarness, TICKET_SECRET } from './accounts-harness';
import { verifyTicket } from '../src/accounts/tickets';
import { defaultComposition, type FlagComposition } from '../src/identity/flag';
import { parseFlagSyncDocument, type FlagSyncDocument } from '../src/identity/flagSync';

function design(id: string, name: string, composition: FlagComposition = defaultComposition()) {
  return { id, name, composition, createdAt: 100, updatedAt: 100 };
}

function body(
  overrides: {
    designs?: ReturnType<typeof design>[];
    activeId?: string | null;
    equipped?: { frame: string | null; background: string | null };
    expectedRevision?: number;
  } = {},
) {
  return {
    designs: overrides.designs ?? [design('flag-one', 'First flag')],
    activeId: overrides.activeId === undefined ? 'flag-one' : overrides.activeId,
    equipped: overrides.equipped ?? { frame: 'frame-steel', background: null },
    expectedRevision: overrides.expectedRevision ?? 0,
  };
}

async function flagsOf(response: Response): Promise<{ status: number; flags: FlagSyncDocument | null; error: string | null }> {
  const payload = (await response.json()) as {
    ok?: boolean;
    flags?: unknown;
    error?: { code?: string; message?: string };
  };
  return {
    status: response.status,
    flags: payload.flags ? parseFlagSyncDocument(payload.flags, 5000) : null,
    error: payload.error?.message ?? null,
  };
}

async function signedIn(harness: AccountHarness, sub: string): Promise<string> {
  const { cookie } = await harness.signInGoogle(sub);
  return `mca_session=${cookie}`;
}

describe('account flag API', () => {
  it('accepts an entitled document and returns the authoritative revision', async () => {
    const harness = await AccountHarness.create();
    const cookie = await signedIn(harness, 'flags-entitled');

    const initial = await harness.request('/flags', { cookie });
    expect(initial.status).toBe(200);
    expect((await flagsOf(initial)).flags?.revision).toBe(0);

    const saved = await flagsOf(
      await harness.request('/flags', { method: 'POST', cookie, body: body() }),
    );
    expect(saved.status).toBe(200);
    expect(saved.flags?.revision).toBe(1);
    expect(saved.flags?.designs[0].name).toBe('First flag');
    expect(saved.flags?.equipped.frame).toBe('frame-steel');
  });

  it('rejects a locked emblem submitted directly inside a composition', async () => {
    const harness = await AccountHarness.create();
    const cookie = await signedIn(harness, 'flags-locked-emblem');
    const composition = JSON.parse(JSON.stringify(defaultComposition())) as FlagComposition;
    composition.emblem = { ...composition.emblem!, id: 'wing' };

    const response = await harness.request('/flags', {
      method: 'POST',
      cookie,
      body: body({ designs: [design('flag-one', 'Locked', composition)] }),
    });
    expect(response.status).toBe(400);
    expect((await flagsOf(response)).error).toMatch(/unlocked/);
  });

  it('rejects client-forged ownership and progress claims for cosmetics', async () => {
    const harness = await AccountHarness.create();
    const cookie = await signedIn(harness, 'flags-forged');
    const response = await harness.request('/flags', {
      method: 'POST',
      cookie,
      body: {
        ...body({ equipped: { frame: 'frame-laurel', background: null } }),
        xp: 999_999,
        wins: 999,
        owned: ['frame-laurel'],
      },
    });
    expect(response.status).toBe(400);
    expect((await flagsOf(response)).error).toMatch(/unlocked/);
  });

  it('signs the equipped frame and background into the multiplayer ticket', async () => {
    const harness = await AccountHarness.create();
    const cookie = await signedIn(harness, 'flags-ticket');
    const saved = await harness.request('/flags', {
      method: 'POST',
      cookie,
      body: body({ equipped: { frame: 'frame-steel', background: 'bg-deep' } }),
    });
    expect(saved.status).toBe(200);

    const ticketResponse = await harness.request('/multiplayer/ticket', {
      method: 'POST',
      cookie,
    });
    expect(ticketResponse.status).toBe(200);
    const value = (await ticketResponse.json()) as { ticket: string };
    const verified = await verifyTicket(TICKET_SECRET, value.ticket, harness.now);
    expect(verified?.identity?.frame).toBe('frame-steel');
    expect(verified?.identity?.background).toBe('bg-deep');
  });

  it('rejects unknown cosmetic ids', async () => {
    const harness = await AccountHarness.create();
    const cookie = await signedIn(harness, 'flags-unknown-cosmetic');
    const response = await harness.request('/flags', {
      method: 'POST',
      cookie,
      body: body({ equipped: { frame: 'frame-not-real', background: null } }),
    });
    expect(response.status).toBe(400);
    expect((await flagsOf(response)).error).toMatch(/Unknown cosmetic/);
  });

  it('refuses a stale save without changing the previous document', async () => {
    const harness = await AccountHarness.create();
    const cookie = await signedIn(harness, 'flags-stale');
    await harness.request('/flags', { method: 'POST', cookie, body: body() });

    const stale = await flagsOf(
      await harness.request('/flags', {
        method: 'POST',
        cookie,
        body: body({
          designs: [design('flag-two', 'Stale write')],
          activeId: 'flag-two',
          equipped: { frame: null, background: null },
        }),
      }),
    );
    expect(stale.status).toBe(409);
    expect(stale.flags?.designs.map((entry) => entry.id)).toEqual(['flag-one']);

    const read = await flagsOf(await harness.request('/flags', { cookie }));
    expect(read.flags?.revision).toBe(1);
    expect(read.flags?.designs[0].name).toBe('First flag');
  });

  it('cannot split designs from the active selection under a concurrent save', async () => {
    const harness = await AccountHarness.create();
    const cookie = await signedIn(harness, 'flags-concurrent');
    await harness.request('/flags', {
      method: 'POST',
      cookie,
      body: body({
        designs: [design('flag-one', 'First flag'), design('flag-two', 'Second flag')],
        activeId: 'flag-one',
      }),
    });

    const deleteSecond = body({
      designs: [design('flag-one', 'First flag')],
      activeId: 'flag-one',
      expectedRevision: 1,
    });
    const renameFirst = body({
      designs: [design('flag-one', 'Renamed'), design('flag-two', 'Second flag')],
      activeId: 'flag-one',
      expectedRevision: 1,
    });
    const [first, second] = await Promise.all([
      harness.request('/flags', { method: 'POST', cookie, body: deleteSecond }),
      harness.request('/flags', { method: 'POST', cookie, body: renameFirst }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);

    const read = await flagsOf(await harness.request('/flags', { cookie }));
    const ids = read.flags!.designs.map((entry) => entry.id);
    expect(read.flags?.revision).toBe(2);
    expect(ids.length === 1 || ids.length === 2).toBe(true);
    expect(ids).toContain('flag-one');
    if (read.flags?.activeId !== null) {
      expect(ids).toContain(read.flags!.activeId!);
    }
  });
});
