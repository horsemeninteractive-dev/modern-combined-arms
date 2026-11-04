import { describe, expect, it } from 'vitest';
import {
  createGuestProfile,
  ensureGuestProfile,
  guestCallsign,
  guestMigrationRequest,
  guestProfileDigest,
  GUEST_STORAGE_KEY,
  markGuestMigrated,
  readGuestProfile,
  type GuestStorage,
} from '../src/accounts/guest';

class MemoryStorage implements GuestStorage {
  readonly data = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.data.set(key, value);
  }
}

describe('guest profile', () => {
  it('creates one stable local identity and never contacts a server', () => {
    const storage = new MemoryStorage();
    const first = ensureGuestProfile(storage, 1000);
    const second = ensureGuestProfile(storage, 2000);
    expect(second.id).toBe(first.id);
    expect(second.migrationKey).toBe(first.migrationKey);
    expect(second.createdAt).toBe(1000);
    expect(storage.data.has(GUEST_STORAGE_KEY)).toBe(true);
    expect(first.id.length).toBeGreaterThanOrEqual(22);
    expect(first.callsign).toMatch(/^GUEST-[A-Z0-9]{4}$/);
  });

  it('derives the callsign from the id without exposing the whole identifier', () => {
    expect(guestCallsign('abcdefghijklmnopqrstuv')).toBe('GUEST-STUV');
    expect(guestCallsign('short')).toBe('GUEST-HORT');
  });

  it('replaces a corrupt record instead of throwing', () => {
    const storage = new MemoryStorage();
    storage.data.set(GUEST_STORAGE_KEY, '{"version":1,"id":"too-short"}');
    expect(readGuestProfile(storage)).toBeNull();
    const created = ensureGuestProfile(storage, 500);
    expect(created.id.length).toBeGreaterThanOrEqual(22);
    expect(readGuestProfile(storage)?.id).toBe(created.id);
  });

  it('still returns a usable profile when local storage refuses writes', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const profile = ensureGuestProfile(storage, 1000);
    expect(profile.id.length).toBeGreaterThanOrEqual(22);
  });

  it('has a digest that is stable, canonical and independent of migration state', async () => {
    const profile = createGuestProfile(1000, 'guest-identifier-0123456789');
    const digest = await guestProfileDigest(profile);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(await guestProfileDigest({ ...profile })).toBe(digest);

    const storage = new MemoryStorage();
    const migrated = markGuestMigrated(storage, profile, 'account-1');
    expect(migrated.migratedAccountId).toBe('account-1');
    expect(await guestProfileDigest(migrated)).toBe(digest);
    expect(readGuestProfile(storage)?.migratedAccountId).toBe('account-1');
  });

  it('changes the digest when the local identity changes', async () => {
    const base = createGuestProfile(1000, 'guest-identifier-0123456789');
    const other = { ...base, migrationKey: 'different-migration-key-000' };
    expect(await guestProfileDigest(base)).not.toBe(await guestProfileDigest(other));
  });

  it('builds a migration request with the id, key and digest the API validates', async () => {
    const profile = createGuestProfile(1000, 'guest-identifier-0123456789');
    const request = await guestMigrationRequest(profile);
    expect(request.guestId).toBe(profile.id);
    expect(request.migrationKey).toBe(profile.migrationKey);
    expect(request.profileDigest).toBe(await guestProfileDigest(profile));
  });
});
