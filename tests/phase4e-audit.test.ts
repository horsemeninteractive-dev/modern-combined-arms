import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AccountHarness } from './accounts-harness';
import { MP_MIN_DURATION_SECONDS } from '../src/accounts/matchCareer';

/**
 * Phase 4E audit regressions.
 *
 * Two defects found while auditing the shipped configuration and the guest
 * migration path:
 *
 * 1. Both room Worker configs defaulted a match to 60 seconds while the career
 *    reward refuses anything under three minutes, so a room created without an
 *    explicit duration could never pay. The default now matches the client's
 *    ten minutes; this test pins both config files to the reward floor.
 * 2. Guest migration imported the career before recording the migration, so two
 *    accounts presenting the same guest profile could both copy its career.
 *    The guest is now reserved as `pending` first, and the import resumes.
 */

function configNumber(file: string, name: string): number {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const match = new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`).exec(text);
  if (!match) throw new Error(`${name} is missing from ${file}`);
  return Number(match[1]);
}

const GUEST_ID = 'g'.repeat(22);
const MIGRATION_KEY = 'k'.repeat(20);
const PROFILE_DIGEST = 'a'.repeat(64);

const careerEntry = {
  ref: 'skirmish:phase4e-resume',
  mode: 'skirmish' as const,
  outcome: 'victory' as const,
  difficulty: 'veteran' as const,
  durationSeconds: 600,
  nation: 'lithuania',
  kills: 3,
  unitsLost: 1,
};

async function signedIn(subject: string) {
  const harness = await AccountHarness.create();
  const signIn = await harness.signInGoogle(subject);
  if (!signIn.accountId) throw new Error('Sign-in did not create an account.');
  return { harness, cookie: `mca_session=${signIn.cookie}`, accountId: signIn.accountId };
}

describe('Phase 4E room duration configuration', () => {
  it('keeps every room config default above the career reward floor', () => {
    for (const file of ['mp-room-wrangler.jsonc', 'mp-room-wrangler.live.jsonc']) {
      const fallback = configNumber(file, 'MP_DEFAULT_MATCH_SECONDS');
      const max = configNumber(file, 'MP_MAX_MATCH_SECONDS');
      expect(fallback, `${file} default`).toBeGreaterThanOrEqual(MP_MIN_DURATION_SECONDS);
      expect(fallback, `${file} default`).toBeLessThanOrEqual(max);
      expect(max, `${file} maximum`).toBeLessThanOrEqual(30 * 60);
    }
  });
});

describe('Phase 4E guest migration reservation', () => {
  it('refuses to import a guest profile another account has reserved', async () => {
    const { harness, cookie: ownerCookie, accountId: owner } = await signedIn('phase4e-owner');
    const intruder = await harness.signInGoogle('phase4e-intruder');
    const intruderCookie = `mca_session=${intruder.cookie}`;

    // Simulate the owner's interrupted migration: the reservation exists, the
    // import never finished.
    expect(
      await harness.store.recordGuestMigration({
        guestId: GUEST_ID,
        accountId: owner,
        state: 'pending',
        migrationKey: MIGRATION_KEY,
        profileDigest: PROFILE_DIGEST,
        createdAt: harness.now,
        completedAt: null,
      }),
    ).toBe('ok');

    const refused = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie: intruderCookie,
      body: {
        guestId: GUEST_ID,
        migrationKey: MIGRATION_KEY,
        profileDigest: PROFILE_DIGEST,
        career: [careerEntry],
      },
    });
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { code: string } };
    expect(body.error.code).toBe('guest-already-migrated');

    // The intruder's ledger stayed empty: a refused claim imports nothing.
    const career = await harness.request('/career', { cookie: intruderCookie });
    const careerBody = (await career.json()) as { career: { totals: { matches: number } } };
    expect(careerBody.career.totals.matches).toBe(0);

    // The owner can still finish their own migration.
    const resumed = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        guestId: GUEST_ID,
        migrationKey: MIGRATION_KEY,
        profileDigest: PROFILE_DIGEST,
        career: [careerEntry],
      },
    });
    expect(resumed.status).toBe(200);
  });

  it('resumes a pending import once and records no duplicate match', async () => {
    const { harness, cookie, accountId } = await signedIn('phase4e-resume');
    await harness.store.recordGuestMigration({
      guestId: GUEST_ID,
      accountId,
      state: 'pending',
      migrationKey: MIGRATION_KEY,
      profileDigest: PROFILE_DIGEST,
      createdAt: harness.now,
      completedAt: null,
    });

    const first = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie,
      body: {
        guestId: GUEST_ID,
        migrationKey: MIGRATION_KEY,
        profileDigest: PROFILE_DIGEST,
        career: [careerEntry],
      },
    });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { status: string; importedXp: number };
    expect(body.status).toBe('migrated');
    expect(body.importedXp).toBeGreaterThan(0);

    const repeat = await harness.request('/migrate/guest', {
      method: 'POST',
      cookie,
      body: {
        guestId: GUEST_ID,
        migrationKey: MIGRATION_KEY,
        profileDigest: PROFILE_DIGEST,
        career: [careerEntry],
      },
    });
    expect(repeat.status).toBe(200);
    expect(((await repeat.json()) as { status: string }).status).toBe('already-migrated');

    const career = await harness.request('/career', { cookie });
    const careerBody = (await career.json()) as { career: { totals: { matches: number } } };
    expect(careerBody.career.totals.matches).toBe(1);
    expect((await harness.store.guestMigration(GUEST_ID))?.state).toBe('complete');
  });
});
