/**
 * The guest career.
 *
 * A guest plays the same missions as a signed-in player and earns the same XP,
 * so the record has to exist somewhere before an account does. It lives in
 * `localStorage` beside the guest profile, is validated on every read (a
 * hand-edited ledger must not crash the menu), and is the payload imported when
 * the player links an account.
 *
 * The ledger keeps the most recent matches only; a career is summarised by its
 * totals, and a bounded history is all the UI shows. The server recomputes XP
 * for each imported row, so this file is never trusted for value.
 */
import {
  careerRecord,
  parseCareerMatch,
  summariseCareer,
  MAX_GUEST_IMPORT_MATCHES,
  type CareerMatchInput,
  type CareerMatchRecord,
  type CareerTotals,
} from './career';

export const CAREER_STORAGE_KEY = 'mca.career.v1';
export const CAREER_STORAGE_VERSION = 1 as const;

/** The slice of Web Storage this module needs. */
export interface CareerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredCareer {
  version: typeof CAREER_STORAGE_VERSION;
  matches: CareerMatchRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Rebuild one stored row through the same validation a submission goes through.
 * Unknown modes, out-of-range durations and free-form text are dropped rather
 * than rendered.
 */
function reviveMatch(value: unknown): CareerMatchRecord | null {
  if (!isRecord(value)) return null;
  const parsed = parseCareerMatch(value);
  if (!parsed.ok) return null;
  const recordedAt = typeof value.recordedAt === 'number' && Number.isFinite(value.recordedAt)
    ? value.recordedAt
    : 0;
  const provenance = value.provenance === 'guest' || value.provenance === 'authoritative'
    ? value.provenance
    : 'local';
  // XP is recomputed from the shared rules; a stored value is only a cache and
  // disagreement is resolved in favour of the rules.
  return careerRecord(parsed.value, { provenance, now: recordedAt });
}

export function readLocalCareer(storage: CareerStorage): StoredCareer {
  let raw: string | null;
  try {
    raw = storage.getItem(CAREER_STORAGE_KEY);
  } catch {
    return { version: CAREER_STORAGE_VERSION, matches: [] };
  }
  if (!raw) return { version: CAREER_STORAGE_VERSION, matches: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { version: CAREER_STORAGE_VERSION, matches: [] };
  }
  if (!isRecord(parsed) || parsed.version !== CAREER_STORAGE_VERSION || !Array.isArray(parsed.matches)) {
    return { version: CAREER_STORAGE_VERSION, matches: [] };
  }
  const matches = parsed.matches
    .map(reviveMatch)
    .filter((match): match is CareerMatchRecord => match !== null)
    .slice(0, MAX_GUEST_IMPORT_MATCHES);
  return { version: CAREER_STORAGE_VERSION, matches };
}

function writeLocalCareer(storage: CareerStorage, career: StoredCareer): void {
  try {
    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(career));
  } catch {
    /* a blocked store leaves the in-memory result usable for this session */
  }
}

/**
 * Add one match to the guest ledger. `duplicate` means this reference is already
 * recorded, which is what makes a double-clicked end screen harmless.
 */
export function recordLocalMatch(
  storage: CareerStorage,
  input: CareerMatchInput,
  now: number = Date.now(),
): { record: CareerMatchRecord; duplicate: boolean } {
  const career = readLocalCareer(storage);
  const existing = career.matches.find((match) => match.ref === input.ref);
  const record = careerRecord(input, { provenance: 'local', now });
  if (existing) return { record: existing, duplicate: true };
  const matches = [record, ...career.matches].slice(0, MAX_GUEST_IMPORT_MATCHES);
  writeLocalCareer(storage, { version: CAREER_STORAGE_VERSION, matches });
  return { record, duplicate: false };
}

export function localCareerTotals(storage: CareerStorage): CareerTotals {
  return summariseCareer(readLocalCareer(storage).matches);
}

export function localCareerMatches(storage: CareerStorage, limit = 20): CareerMatchRecord[] {
  return readLocalCareer(storage).matches.slice(0, Math.max(1, limit));
}

/**
 * The payload for a migration request: no `xp` and no provenance, because the
 * server decides both. Newest first, so a truncated import keeps the matches
 * that best reflect the career.
 */
export function guestCareerPayload(storage: CareerStorage): CareerMatchInput[] {
  return readLocalCareer(storage).matches.slice(0, MAX_GUEST_IMPORT_MATCHES).map((match) => ({
    ref: match.ref,
    mode: match.mode,
    outcome: match.outcome,
    difficulty: match.difficulty,
    durationSeconds: match.durationSeconds,
    nation: match.nation,
    kills: match.kills,
    unitsLost: match.unitsLost,
  }));
}

