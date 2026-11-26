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
 *
 * Version 2 adds the accomplishment counters the guest achievement evaluator
 * needs (objectives, sites, superweapons, structures). A version 1 ledger is
 * read as-is with those counters at zero, so an upgrade loses no history.
 */
import {
  careerRecord,
  isCareerDifficulty,
  isCareerMode,
  parseCareerMatch,
  summariseCareer,
  MAX_GUEST_IMPORT_MATCHES,
  type CareerAccomplishments,
  type CareerMatchInput,
  type CareerMatchRecord,
  type CareerTotals,
} from './career';

export const CAREER_STORAGE_KEY = 'mca.career.v1';
export const CAREER_STORAGE_VERSION = 2 as const;
/** The document version that predates accomplishment counters. */
export const CAREER_STORAGE_VERSION_LEGACY = 1 as const;

/** A ledger row: the career record plus what the operation accomplished. */
export type LocalCareerEntry = CareerMatchRecord & { accomplishments?: CareerAccomplishments };

/** The slice of Web Storage this module needs. */
export interface CareerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredCareer {
  version: typeof CAREER_STORAGE_VERSION;
  matches: LocalCareerEntry[];
}

const ACCOMPLISHMENT_FIELDS = [
  'objectivesCompleted',
  'sitesCaptured',
  'superweaponsUsed',
  'structuresDestroyed',
  'structuresBuilt',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Only bounded non-negative integers are kept; anything else is dropped. */
function parseAccomplishments(value: unknown): CareerAccomplishments | undefined {
  if (!isRecord(value)) return undefined;
  const parsed: CareerAccomplishments = {};
  let any = false;
  for (const field of ACCOMPLISHMENT_FIELDS) {
    const raw = value[field];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) continue;
    parsed[field] = Math.min(10_000, Math.floor(raw));
    any = true;
  }
  return any ? parsed : undefined;
}

/**
 * Rebuild one stored row through the same validation a submission goes through.
 * Unknown modes, out-of-range durations and free-form text are dropped rather
 * than rendered.
 */
function reviveMatch(value: unknown): LocalCareerEntry | null {
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
  const record: LocalCareerEntry = careerRecord(parsed.value, { provenance, now: recordedAt });
  const accomplishments = parseAccomplishments(value.accomplishments);
  if (accomplishments) record.accomplishments = accomplishments;
  return record;
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
  if (!isRecord(parsed) || !Array.isArray(parsed.matches)) {
    return { version: CAREER_STORAGE_VERSION, matches: [] };
  }
  // Accept the legacy document as well: it is the same shape without
  // accomplishments, and dropping it would erase a guest's played history.
  if (parsed.version !== CAREER_STORAGE_VERSION && parsed.version !== CAREER_STORAGE_VERSION_LEGACY) {
    return { version: CAREER_STORAGE_VERSION, matches: [] };
  }
  const matches = parsed.matches
    .map(reviveMatch)
    .filter((match): match is LocalCareerEntry => match !== null)
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

/** Every match the local ledger holds, newest first. */
export function localCareerAllMatches(storage: CareerStorage): LocalCareerEntry[] {
  return readLocalCareer(storage).matches;
}

/**
 * Add one match to the guest ledger. `duplicate` means this reference is already
 * recorded, which is what makes a double-clicked end screen harmless.
 */
export function recordLocalMatch(
  storage: CareerStorage,
  input: CareerMatchInput,
  now: number = Date.now(),
  accomplishments?: CareerAccomplishments,
): { record: LocalCareerEntry; duplicate: boolean } {
  const career = readLocalCareer(storage);
  const existing = career.matches.find((match) => match.ref === input.ref);
  const record: LocalCareerEntry = careerRecord(input, { provenance: 'local', now });
  const parsed = parseAccomplishments(accomplishments);
  if (parsed) record.accomplishments = parsed;
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
  const payload: CareerMatchInput[] = [];
  for (const match of readLocalCareer(storage).matches.slice(0, MAX_GUEST_IMPORT_MATCHES)) {
    // Every local row was validated on the way in, so these checks never drop a
    // real match; they exist because the ledger type also admits a survival run,
    // which is never submitted through the match endpoint.
    if (!isCareerMode(match.mode) || !isCareerDifficulty(match.difficulty)) continue;
    payload.push({
      ref: match.ref,
      mode: match.mode,
      outcome: match.outcome,
      difficulty: match.difficulty,
      durationSeconds: match.durationSeconds,
      nation: match.nation,
      kills: match.kills,
      unitsLost: match.unitsLost,
    });
  }
  return payload;
}
