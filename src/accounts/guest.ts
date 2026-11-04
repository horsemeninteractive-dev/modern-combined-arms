/**
 * Local guest identity.
 *
 * A guest is a local profile, not a server account. It is created on demand,
 * stored in the same `localStorage` the game already uses, and never causes a
 * network request. The id and callsign are stable for the life of the browser
 * profile, which is what a future XP ledger will key on until the player links
 * an account.
 */
import { randomToken, sha256Hex } from './crypto';

export const GUEST_STORAGE_KEY = 'mca.guest.v1';
export const GUEST_VERSION = 1 as const;

export interface GuestProfile {
  version: typeof GUEST_VERSION;
  /** Opaque 128-bit local identity. Never sent anywhere until migration. */
  id: string;
  /** Display label derived from the id, e.g. `GUEST-9F2C`. */
  callsign: string;
  createdAt: number;
  /** Stable random key for idempotent migration retries. */
  migrationKey: string;
  /** Set once this profile has been imported into an account. */
  migratedAccountId: string | null;
}

/** The slice of Web Storage this module needs, so tests can supply a map. */
export interface GuestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function guestCallsign(id: string): string {
  const tail = id.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase();
  return tail.length === 4 ? `GUEST-${tail}` : 'GUEST';
}

export function createGuestProfile(now: number, id: string = randomToken(16)): GuestProfile {
  return {
    version: GUEST_VERSION,
    id,
    callsign: guestCallsign(id),
    createdAt: now,
    migrationKey: randomToken(24),
    migratedAccountId: null,
  };
}

function isGuestProfile(value: unknown): value is GuestProfile {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === GUEST_VERSION &&
    typeof record.id === 'string' &&
    /^[A-Za-z0-9_-]{22,64}$/.test(record.id) &&
    typeof record.callsign === 'string' &&
    typeof record.createdAt === 'number' &&
    typeof record.migrationKey === 'string' &&
    /^[A-Za-z0-9_-]{16,64}$/.test(record.migrationKey) &&
    (record.migratedAccountId === null || typeof record.migratedAccountId === 'string')
  );
}

export function readGuestProfile(storage: GuestStorage): GuestProfile | null {
  let raw: string | null;
  try {
    raw = storage.getItem(GUEST_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isGuestProfile(parsed) ? parsed : null;
}

/**
 * Read the local guest profile, creating and persisting one if this browser has
 * none. A corrupt or partial record is replaced rather than crashing the boot.
 */
export function ensureGuestProfile(storage: GuestStorage, now: number = Date.now()): GuestProfile {
  const existing = readGuestProfile(storage);
  if (existing) return existing;
  const created = createGuestProfile(now);
  try {
    storage.setItem(GUEST_STORAGE_KEY, JSON.stringify(created));
  } catch {
    /* a full or blocked storage still yields a usable in-memory profile */
  }
  return created;
}

/**
 * Digest of the guest profile as it will be submitted for migration.
 *
 * Deliberately excludes `migratedAccountId`: marking a profile as migrated must
 * not change its digest, or a retry would look like a conflict. Fields are
 * written in a fixed order so the same profile always hashes identically.
 */
export async function guestProfileDigest(profile: GuestProfile): Promise<string> {
  const canonical = JSON.stringify({
    version: profile.version,
    id: profile.id,
    callsign: profile.callsign,
    createdAt: profile.createdAt,
    migrationKey: profile.migrationKey,
  });
  return sha256Hex(canonical);
}

export function markGuestMigrated(
  storage: GuestStorage,
  profile: GuestProfile,
  accountId: string,
): GuestProfile {
  const next: GuestProfile = { ...profile, migratedAccountId: accountId };
  try {
    storage.setItem(GUEST_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* the local flag is an optimisation; the server record is the authority */
  }
  return next;
}

export interface GuestMigrationRequest {
  guestId: string;
  migrationKey: string;
  profileDigest: string;
}

export async function guestMigrationRequest(profile: GuestProfile): Promise<GuestMigrationRequest> {
  return {
    guestId: profile.id,
    migrationKey: profile.migrationKey,
    profileDigest: await guestProfileDigest(profile),
  };
}
