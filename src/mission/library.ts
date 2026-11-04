/**
 * Local mission library.
 *
 * Storage is deliberately separate from battle saves and campaign progress: a
 * library entry is an authored document, never runtime state. The current app
 * persistence layer is localStorage, so the library uses the same mechanism
 * rather than introducing a second storage technology for the browser.
 *
 * A stored entry is a complete Scenario with its embedded MissionDoc. That is
 * the same round-trip the game and the campaign use, and it keeps authored
 * placement keys and entity references intact.
 *
 * Reliability rules (S7):
 *
 * - Nothing authored is destroyed just because it cannot be read. Entries that
 *   fail to normalise are carried through every later write verbatim, and a
 *   damaged or future-version archive is copied into a separate recovery key
 *   before anything may overwrite it.
 * - A write is only reported as successful after the value has been read back.
 * - A failed write leaves the previously persisted archive untouched, because
 *   the new payload is built entirely in memory before `setItem` is called.
 * - The library envelope is versioned. A newer archive is shown read-only
 *   instead of being silently downgraded; an older one is migrated by
 *   normalisation, which never rewrites mission or scenario content.
 */
import { MAP_FORMAT } from '../sim/constants';
import {
  parseScenario,
  scenarioToJson,
  validateScenario,
  type Scenario,
  type ValidationIssue,
} from '../sim/scenario';
import {
  MISSION_FORMAT,
  MissionFormatError,
  type MissionDoc,
  type MissionIssue,
} from './types';
import { parseMission } from './parse';
import { validateMission } from './validate';
import { duplicateMissionDoc, uniqueMissionId } from './authoring';

/** Storage slot kept from S6 so existing libraries keep loading. */
export const MISSION_LIBRARY_KEY = 'iron-tide.mission-library.v1';
/** Quarantine for anything the library could not read. Never written by gameplay. */
export const MISSION_RECOVERY_KEY = 'iron-tide.mission-library.recovery.v1';
/** Tiny key used only to prove the storage slot accepts writes. */
export const MISSION_STORAGE_PROBE_KEY = 'iron-tide.mission-library.probe';
/**
 * Envelope format.
 *
 * v1 was the S6 layout. v2 adds `lastValidAt`, which records when a snapshot
 * actually validated, so "restore last valid" can tell a validated copy from a
 * never-checked baseline. Entry content is identical between the two.
 */
export const MISSION_LIBRARY_VERSION = 2;
export const MAX_RECOVERY_RECORDS = 32;

export interface MissionLibraryEntry {
  /** Stable library identity. Renaming a mission never changes it. */
  id: string;
  missionId: string;
  title: string;
  /** Non-null means the document was authored for a campaign and is protected. */
  campaignId: string | null;
  formatVersion: number;
  updatedAt: string;
  /** Canonical Scenario + MissionDoc JSON. */
  scenarioJson: string;
  /** Older snapshot that validated cleanly, used as a fallback recovery point. */
  lastValidScenarioJson: string | null;
  /** When `lastValidScenarioJson` was validated, or null for an unverified baseline. */
  lastValidAt: string | null;
}

export interface MissionLibraryDoc {
  version: number;
  entries: MissionLibraryEntry[];
}

export interface LibraryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LibraryErrorCode =
  | 'no-mission'
  | 'invalid'
  | 'storage'
  | 'quota'
  | 'unavailable'
  /** The stored archive was written by a newer build; writes are refused. */
  | 'future-version'
  | 'unrecognised'
  | 'parse'
  | 'missing'
  | 'campaign-protected';

export class MissionLibraryError extends Error {
  readonly code: LibraryErrorCode;
  constructor(code: LibraryErrorCode, message: string) {
    super(message);
    this.name = 'MissionLibraryError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Recovery records                                                    */
/* ------------------------------------------------------------------ */

export type RecoveryCategory =
  | 'corrupt-archive'
  | 'unreadable-archive'
  | 'future-version'
  | 'unparseable-entry'
  | 'invalid-metadata'
  | 'invalid-document'
  | 'duplicate-entry';

export const RECOVERY_CATEGORY_LABEL: Record<RecoveryCategory, string> = {
  'corrupt-archive': 'Damaged archive',
  'unreadable-archive': 'Archive unreadable',
  'future-version': 'Newer library format',
  'unparseable-entry': 'Unreadable entry',
  'invalid-metadata': 'Bad entry metadata',
  'invalid-document': 'Invalid document',
  'duplicate-entry': 'Duplicate identity',
};

export interface LibraryRecoveryRecord {
  /** Deterministic identity derived from the raw payload and category. */
  id: string;
  capturedAt: string;
  category: RecoveryCategory;
  reason: string;
  source: string;
  entryId: string | null;
  missionId: string | null;
  title: string | null;
  /** Exact original text, byte-for-byte. Never transformed. */
  raw: string;
}

interface RecoveryInput {
  category: RecoveryCategory;
  reason: string;
  raw: string;
  source?: string;
  entryId?: string | null;
  missionId?: string | null;
  title?: string | null;
}

export interface RecoveryReadResult {
  records: LibraryRecoveryRecord[];
  error: string | null;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(36)}${value.length.toString(36)}`;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function normaliseRecoveryRecord(raw: unknown): LibraryRecoveryRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<LibraryRecoveryRecord>;
  if (typeof record.id !== 'string' || typeof record.raw !== 'string') return null;
  if (!(record.category && record.category in RECOVERY_CATEGORY_LABEL)) return null;
  return {
    id: record.id,
    capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt : nowIso(),
    category: record.category,
    reason: typeof record.reason === 'string' ? record.reason : 'Unreadable library data.',
    source: typeof record.source === 'string' ? record.source : MISSION_LIBRARY_KEY,
    entryId: asString(record.entryId),
    missionId: asString(record.missionId),
    title: asString(record.title),
    raw: record.raw,
  };
}

/** Read the quarantine. Tolerant: a damaged quarantine never breaks the library. */
export function readLibraryRecoveries(storage: LibraryStorage): RecoveryReadResult {
  let text: string | null = null;
  try {
    text = storage.getItem(MISSION_RECOVERY_KEY);
  } catch (error) {
    return { records: [], error: `Recovery store could not be read: ${messageOf(error)}` };
  }
  if (!text) return { records: [], error: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { records: [], error: `Recovery store is not valid JSON: ${messageOf(error)}` };
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { records?: unknown }).records)
      ? (raw as { records: unknown[] }).records
      : [];
  const records: LibraryRecoveryRecord[] = [];
  for (const item of list) {
    const record = normaliseRecoveryRecord(item);
    if (record) records.push(record);
  }
  return { records, error: null };
}

/**
 * Copy raw payloads into the quarantine.
 *
 * Deduplicated by category and payload hash, so repeated reads of the same
 * damaged archive do not grow the store. Best effort: a failure is reported,
 * never thrown, and callers use it to decide whether an overwrite is safe.
 */
export function captureRecoveries(
  storage: LibraryStorage,
  inputs: readonly RecoveryInput[],
): { created: LibraryRecoveryRecord[]; error: string | null } {
  if (inputs.length === 0) return { created: [], error: null };
  const existing = readLibraryRecoveries(storage);
  const ids = new Set(existing.records.map((record) => record.id));
  const created: LibraryRecoveryRecord[] = [];
  for (const input of inputs) {
    const id = `${input.category}-${hashText(input.raw)}`;
    if (ids.has(id)) continue;
    ids.add(id);
    created.push({
      id,
      capturedAt: nowIso(),
      category: input.category,
      reason: input.reason,
      source: input.source ?? MISSION_LIBRARY_KEY,
      entryId: input.entryId ?? null,
      missionId: input.missionId ?? null,
      title: input.title ?? null,
      raw: input.raw,
    });
  }
  if (created.length === 0) return { created: [], error: existing.error };
  const records = [...existing.records, ...created].slice(-MAX_RECOVERY_RECORDS);
  try {
    storage.setItem(
      MISSION_RECOVERY_KEY,
      JSON.stringify({ version: 1, records }),
    );
  } catch (error) {
    return { created: [], error: messageOf(error) };
  }
  return { created, error: null };
}

/** Human label for a recovery record, derived without trusting its content. */
export function describeRecovery(record: LibraryRecoveryRecord): {
  label: string;
  detail: string;
} {
  const identity = record.title ?? record.missionId ?? record.entryId ?? 'unknown document';
  const parts: string[] = [];
  if (record.missionId) parts.push(`mission ${record.missionId}`);
  if (record.entryId) parts.push(`library ${record.entryId}`);
  parts.push(`${record.raw.length.toLocaleString()} characters preserved`);
  return {
    label: `${identity} · ${RECOVERY_CATEGORY_LABEL[record.category]}`,
    detail: parts.join(' · '),
  };
}

/* ------------------------------------------------------------------ */
/* Envelope helpers                                                    */
/* ------------------------------------------------------------------ */

function emptyLibrary(): MissionLibraryDoc {
  return { version: MISSION_LIBRARY_VERSION, entries: [] };
}

function nowIso(): string {
  return new Date().toISOString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function newLibraryEntryId(now = Date.now()): string {
  return `lib-${now.toString(36)}`;
}

/** The store cannot accept writes at all (private mode, blocked cookies, …). */
function storageErrorKind(error: unknown): 'quota' | 'unavailable' | 'storage' {
  const name = error instanceof Error ? error.name : '';
  const message = messageOf(error);
  const code = (error as { code?: number } | null)?.code;
  if (/quota/i.test(name) || /quota/i.test(message) || code === 22 || code === 1014) {
    return 'quota';
  }
  if (/security/i.test(name) || /security/i.test(message) || /denied/i.test(message)) {
    return 'unavailable';
  }
  return 'storage';
}

/** An actionable sentence, not a raw exception string. */
export function describeStorageFailure(error: unknown): { code: LibraryErrorCode; message: string } {
  const kind = storageErrorKind(error);
  if (kind === 'quota') {
    return {
      code: 'quota',
      message:
        'Browser storage is full. The document is still open and exportable: export it, delete unused library entries, then save again. Nothing already stored was overwritten.',
    };
  }
  if (kind === 'unavailable') {
    return {
      code: 'unavailable',
      message:
        'Browser storage is unavailable in this browsing mode. Export the document to keep your work; the library cannot be written until storage is allowed.',
    };
  }
  return {
    code: 'storage',
    message: `Storage refused the write (${messageOf(error)}). Nothing already stored was overwritten.`,
  };
}

function storageFailure(error: unknown, operation: string): MissionLibraryError {
  const described = describeStorageFailure(error);
  return new MissionLibraryError(
    described.code,
    `Mission library could not be written during ${operation}: ${described.message}`,
  );
}

export interface LibraryEnvelopeInfo {
  status: 'ok' | 'empty' | 'malformed' | 'unreadable' | 'future-version';
  version: number | null;
  raw: string | null;
  message: string | null;
  /** True when the original archive text is safely held in the quarantine. */
  preserved: boolean;
  migratedFrom: number | null;
}

export interface MissionLibraryReadResult {
  doc: MissionLibraryDoc;
  /** Entries not loaded into `doc` (corrupt or superseded duplicates). */
  discarded: number;
  /** Raw entries that must be re-emitted verbatim by later writes. */
  unreadable: unknown[];
  /** Records quarantined by this read. */
  recoveries: LibraryRecoveryRecord[];
  envelope: LibraryEnvelopeInfo;
}

interface ParsedEnvelope {
  version: number | null;
  entries: unknown[];
}

function parseEnvelope(raw: unknown): ParsedEnvelope | null {
  // S6 accepted a bare array; read it as the unversioned (v0) legacy layout so
  // migration can be reported and re-applied idempotently.
  if (Array.isArray(raw)) return { version: 0, entries: raw };
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { version?: unknown; entries?: unknown };
  if (!Array.isArray(record.entries)) return null;
  return {
    version: typeof record.version === 'number' && Number.isFinite(record.version) ? record.version : null,
    entries: record.entries,
  };
}

/** Validation context for an authored scenario. */
function contextFor(scenario: Scenario) {
  return {
    width: scenario.width,
    height: scenario.height,
    entityKeys: new Set(
      [...scenario.structures, ...scenario.units]
        .map((placement) => placement.key)
        .filter((key): key is string => Boolean(key)),
    ),
  };
}

/** Blocking error count for a stored document, used to label validity. */
export function scenarioErrorCount(scenario: Scenario): number {
  const issues = [
    ...validateScenario(scenario),
    ...(scenario.mission ? validateMission(scenario.mission, contextFor(scenario)) : []),
  ];
  return issues.filter((issue) => issue.severity === 'error').length;
}

/* ------------------------------------------------------------------ */
/* Entry normalisation and migration                                   */
/* ------------------------------------------------------------------ */

type NormalisedEntry =
  | { kind: 'entry'; entry: MissionLibraryEntry }
  | { kind: 'raw'; category: RecoveryCategory; reason: string; identity: Partial<MissionLibraryEntry> };

function scenarioJsonIfReadable(text: string): string | null {
  try {
    const scenario = parseScenario(JSON.parse(text));
    return scenario.mission ? scenarioToJson(scenario) : null;
  } catch {
    return null;
  }
}

/**
 * Turn one stored record into a canonical entry, or classify why it cannot be.
 *
 * All metadata except the timestamps is derived from the parsed document, so a
 * header field can never disagree with the content it describes.
 */
function normaliseEntry(raw: unknown): NormalisedEntry {
  if (!raw || typeof raw !== 'object') {
    return {
      kind: 'raw',
      category: 'unparseable-entry',
      reason: 'Entry is not an object.',
      identity: {},
    };
  }
  const entry = raw as Partial<MissionLibraryEntry>;
  const id = asString(entry.id);
  const identity = {
    id: id ?? undefined,
    missionId: asString(entry.missionId) ?? undefined,
    title: asString(entry.title) ?? undefined,
  };
  if (!id) {
    return {
      kind: 'raw',
      category: 'invalid-metadata',
      reason: 'Entry has no library identity.',
      identity,
    };
  }
  if (typeof entry.scenarioJson !== 'string' || entry.scenarioJson.trim() === '') {
    return {
      kind: 'raw',
      category: 'invalid-metadata',
      reason: 'Entry has no scenario document.',
      identity,
    };
  }
  let scenario: Scenario;
  try {
    scenario = parseScenario(JSON.parse(entry.scenarioJson));
  } catch (error) {
    return {
      kind: 'raw',
      category: 'unparseable-entry',
      reason: `Stored document does not parse: ${messageOf(error)}`,
      identity,
    };
  }
  if (!scenario.mission) {
    return {
      kind: 'raw',
      category: 'invalid-document',
      reason: 'Stored scenario carries no mission document.',
      identity,
    };
  }
  const mission = scenario.mission;
  const scenarioJson = scenarioToJson(scenario);
  const updatedAt = asString(entry.updatedAt) ?? nowIso();
  const lastValidJson =
    typeof entry.lastValidScenarioJson === 'string'
      ? scenarioJsonIfReadable(entry.lastValidScenarioJson)
      : null;
  const lastValidAt =
    typeof entry.lastValidAt === 'string'
      ? entry.lastValidAt
      : lastValidJson
        ? scenarioErrorCount(scenario) === 0
          ? updatedAt
          : null
        : null;
  return {
    kind: 'entry',
    entry: {
      id,
      missionId: mission.id,
      title: mission.title,
      campaignId: mission.campaign?.campaignId ?? null,
      formatVersion: mission.version,
      updatedAt,
      scenarioJson,
      lastValidScenarioJson: lastValidJson,
      lastValidAt,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

/**
 * Read the library, recovering entry by entry.
 *
 * A partially written or hand-edited record never takes the whole library down
 * and is never thrown away: it is excluded from `doc.entries`, kept in
 * `unreadable` so the next write re-emits it unchanged, and copied into the
 * quarantine so it survives even if the archive is later rewritten.
 */
export function readMissionLibrary(
  storage: LibraryStorage,
  options: { capture?: boolean } = {},
): MissionLibraryReadResult {
  const captureEnabled = options.capture !== false;
  const base = {
    doc: emptyLibrary(),
    discarded: 0,
    unreadable: [] as unknown[],
    recoveries: [] as LibraryRecoveryRecord[],
  };
  let text: string | null = null;
  try {
    text = storage.getItem(MISSION_LIBRARY_KEY);
  } catch (error) {
    return {
      ...base,
      envelope: {
        status: 'unreadable',
        version: null,
        raw: null,
        message: describeStorageFailure(error).message,
        preserved: false,
        migratedFrom: null,
      },
    };
  }
  if (!text || text.trim() === '') {
    return {
      ...base,
      envelope: { status: 'empty', version: null, raw: null, message: null, preserved: true, migratedFrom: null },
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const captured = captureEnabled
      ? captureRecoveries(storage, [
          {
            category: 'corrupt-archive',
            reason: `The library archive is not valid JSON: ${messageOf(error)}`,
            raw: text,
          },
        ])
      : { created: [], error: null };
    const message = `The library archive is not valid JSON: ${messageOf(error)}`;
    return {
      ...base,
      discarded: 1,
      recoveries: captured.created,
      envelope: {
        status: 'malformed',
        version: null,
        raw: text,
        message,
        preserved: captured.error === null,
        migratedFrom: null,
      },
    };
  }

  const parsedEnvelope = parseEnvelope(raw);
  if (!parsedEnvelope) {
    const captured = captureEnabled
      ? captureRecoveries(storage, [
          {
            category: 'corrupt-archive',
            reason: 'The library archive has no entries list.',
            raw: text,
          },
        ])
      : { created: [], error: null };
    return {
      ...base,
      discarded: 1,
      recoveries: captured.created,
      envelope: {
        status: 'malformed',
        version: null,
        raw: text,
        message: 'The library archive has no entries list.',
        preserved: captured.error === null,
        migratedFrom: null,
      },
    };
  }

  const version = parsedEnvelope.version;
  const future = version !== null && version > MISSION_LIBRARY_VERSION;
  const migratedFrom =
    !future && version !== null && version < MISSION_LIBRARY_VERSION ? version : null;

  const pending: RecoveryInput[] = [];
  if (future) {
    pending.push({
      category: 'future-version',
      reason: `Archive format v${version} is newer than this build (v${MISSION_LIBRARY_VERSION}). It is shown read-only.`,
      raw: text,
    });
  }

  const byId = new Map<string, MissionLibraryEntry>();
  const unreadable: unknown[] = [];
  let discarded = 0;
  for (const item of parsedEnvelope.entries) {
    const result = normaliseEntry(item);
    if (result.kind === 'raw') {
      discarded++;
      unreadable.push(item);
      pending.push({
        category: result.category,
        reason: result.reason,
        raw: safeStringify(item),
        entryId: result.identity.id ?? null,
        missionId: result.identity.missionId ?? null,
        title: result.identity.title ?? null,
      });
      continue;
    }
    const entry = result.entry;
    const prior = byId.get(entry.id);
    if (!prior) {
      byId.set(entry.id, entry);
      continue;
    }
    discarded++;
    // Keep the newest copy, preserve the superseded one verbatim.
    const loser = prior.updatedAt <= entry.updatedAt ? prior : entry;
    byId.set(entry.id, prior.updatedAt <= entry.updatedAt ? entry : prior);
    unreadable.push(item);
    pending.push({
      category: 'duplicate-entry',
      reason: `Another record already used library identity "${entry.id}" with a later timestamp.`,
      raw: safeStringify(loser),
      entryId: loser.id,
      missionId: loser.missionId,
      title: loser.title,
    });
  }

  const captured = captureEnabled && pending.length > 0
    ? captureRecoveries(storage, pending)
    : { created: [], error: null };

  const entries = [...byId.values()].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title),
  );
  return {
    doc: { version: MISSION_LIBRARY_VERSION, entries },
    discarded,
    unreadable,
    recoveries: captured.created,
    envelope: {
      status: future ? 'future-version' : 'ok',
      version,
      raw: text,
      message: future
        ? `This library was written by a newer build (format v${version}). It is read-only here so nothing is overwritten.`
        : null,
      // A future archive only stops being "at risk" once its text is copied.
      preserved: future ? captured.error === null : true,
      migratedFrom,
    },
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

export interface LibraryWriteOptions {
  /** Raw entries carried through from the read this write is based on. */
  unreadable?: readonly unknown[];
  /** Envelope state of that read; used to refuse unsafe overwrites. */
  read?: MissionLibraryReadResult;
}

/**
 * Persist the library.
 *
 * The payload is fully built before the store is touched, so a throw cannot
 * leave a half-written archive. The value is read back afterwards: a save is
 * only reported when the store really holds it, and an unverified write is
 * reported as a failure rather than as success.
 */
export function writeMissionLibrary(
  storage: LibraryStorage,
  entries: readonly MissionLibraryEntry[],
  options: LibraryWriteOptions = {},
): void {
  const read = options.read;
  if (read?.envelope.status === 'future-version') {
    throw new MissionLibraryError(
      'future-version',
      `This library uses a newer format (v${read.envelope.version}). It is read-only in this build so nothing is overwritten or downgraded. Export the documents you need instead.`,
    );
  }
  if (read && (read.envelope.status === 'malformed' || read.envelope.status === 'unreadable') && !read.envelope.preserved) {
    throw new MissionLibraryError(
      'storage',
      'The existing library archive could not be read or backed up, so it will not be overwritten. Export a copy, free some storage, then try again.',
    );
  }
  const payload = JSON.stringify({
    version: MISSION_LIBRARY_VERSION,
    entries: [...entries, ...(options.unreadable ?? [])],
  });
  try {
    storage.setItem(MISSION_LIBRARY_KEY, payload);
  } catch (error) {
    throw storageFailure(error, 'save');
  }
  let back: string | null = null;
  try {
    back = storage.getItem(MISSION_LIBRARY_KEY);
  } catch {
    back = null;
  }
  if (back !== payload) {
    throw new MissionLibraryError(
      'storage',
      'Mission library could not be verified after writing: the browser did not return the value that was just stored. Treat this save as failed and export the document.',
    );
  }
}

/* ------------------------------------------------------------------ */
/* Storage health                                                      */
/* ------------------------------------------------------------------ */

export interface LibraryStorageProbe {
  available: boolean;
  full: boolean;
  message: string | null;
}

/** Prove the slot accepts writes without touching any other key. */
export function probeLibraryStorage(storage: LibraryStorage): LibraryStorageProbe {
  try {
    storage.setItem(MISSION_STORAGE_PROBE_KEY, '1');
    storage.removeItem(MISSION_STORAGE_PROBE_KEY);
    return { available: true, full: false, message: null };
  } catch (error) {
    const described = describeStorageFailure(error);
    return {
      available: described.code !== 'unavailable',
      full: described.code === 'quota',
      message: described.message,
    };
  }
}

/** Approximate bytes held by the library and its quarantine. */
export function libraryUsageBytes(storage: LibraryStorage): number {
  let total = 0;
  for (const key of [MISSION_LIBRARY_KEY, MISSION_RECOVERY_KEY]) {
    try {
      total += (storage.getItem(key) ?? '').length;
    } catch {
      /* Unreadable storage contributes nothing measurable. */
    }
  }
  return total;
}

/** Compact size label. Deliberately approximate: the browser quota is not fixed. */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface LibraryHealth {
  status: 'ok' | 'damaged' | 'read-only' | 'unavailable' | 'full';
  label: string;
  detail: string;
  bytes: number;
  entries: number;
  unreadable: number;
  recoveries: LibraryRecoveryRecord[];
  envelope: LibraryEnvelopeInfo;
  canWrite: boolean;
}

/**
 * Summarise the library for the UI.
 *
 * `probe` writes and removes a private key, so it is opt-in: routine list
 * rendering does not touch storage beyond reading.
 */
export function libraryHealth(
  storage: LibraryStorage,
  options: { probe?: boolean } = {},
): LibraryHealth {
  const read = readMissionLibrary(storage);
  const recovery = readLibraryRecoveries(storage);
  const probe = options.probe ? probeLibraryStorage(storage) : null;
  const bytes = libraryUsageBytes(storage);
  const base = {
    bytes,
    entries: read.doc.entries.length,
    unreadable: read.unreadable.length,
    recoveries: recovery.records,
    envelope: read.envelope,
  };
  if (read.envelope.status === 'unreadable' || probe?.available === false) {
    return {
      ...base,
      status: 'unavailable',
      label: 'STORAGE UNAVAILABLE',
      detail: probe?.message ?? read.envelope.message ?? 'Browser storage cannot be read in this mode.',
      canWrite: false,
    };
  }
  if (probe?.full) {
    return {
      ...base,
      status: 'full',
      label: 'STORAGE FULL',
      detail: probe.message ?? 'Browser storage is full.',
      canWrite: false,
    };
  }
  if (read.envelope.status === 'future-version') {
    return {
      ...base,
      status: 'read-only',
      label: 'READ-ONLY ARCHIVE',
      detail: read.envelope.message ?? 'This library uses a newer format.',
      canWrite: false,
    };
  }
  if (read.envelope.status === 'malformed' || read.unreadable.length > 0 || recovery.error) {
    return {
      ...base,
      status: 'damaged',
      label: 'RECOVERY NEEDED',
      detail:
        read.envelope.message ??
        recovery.error ??
        `${read.unreadable.length} record${read.unreadable.length === 1 ? '' : 's'} could not be read. The original data is preserved for export.`,
      canWrite: read.envelope.preserved !== false,
    };
  }
  return {
    ...base,
    status: 'ok',
    label: 'STORAGE HEALTHY',
    detail: `${read.doc.entries.length} document${read.doc.entries.length === 1 ? '' : 's'} stored locally.`,
    canWrite: true,
  };
}

/* ------------------------------------------------------------------ */
/* Entry construction and mutation                                     */
/* ------------------------------------------------------------------ */

/** Build a canonical entry from a scenario that already carries a mission. */
export function entryFromScenario(
  scenario: Scenario,
  options: {
    id?: string;
    now?: string;
    /** Stored entry this save replaces, used to keep the last valid snapshot. */
    previous?: MissionLibraryEntry;
  } = {},
): MissionLibraryEntry {
  if (!scenario.mission) {
    throw new MissionLibraryError('no-mission', 'This scenario has no mission document to store.');
  }
  const json = scenarioToJson(scenario);
  let canonical: Scenario;
  try {
    canonical = parseScenario(JSON.parse(json));
  } catch (error) {
    throw new MissionLibraryError(
      'invalid',
      `The mission cannot be stored until it validates: ${messageOf(error)}`,
    );
  }
  const mission = canonical.mission!;
  const scenarioJson = scenarioToJson(canonical);
  const stamp = options.now ?? nowIso();
  const previous = options.previous;
  const clean = scenarioErrorCount(canonical) === 0;

  let lastValidScenarioJson: string | null;
  let lastValidAt: string | null;
  if (!clean) {
    // An invalid document may never overwrite a validated snapshot.
    lastValidScenarioJson = previous?.lastValidScenarioJson ?? scenarioJson;
    lastValidAt = previous?.lastValidAt ?? null;
  } else if (previous && previous.scenarioJson !== scenarioJson) {
    // Step the previous saved version in as the fallback recovery point.
    lastValidScenarioJson = previous.scenarioJson;
    lastValidAt = previous.lastValidAt ?? previous.updatedAt;
  } else if (previous) {
    lastValidScenarioJson = previous.lastValidScenarioJson ?? scenarioJson;
    lastValidAt = previous.lastValidAt ?? previous.updatedAt;
  } else {
    // First save: nothing to fall back to yet.
    lastValidScenarioJson = scenarioJson;
    lastValidAt = stamp;
  }

  return {
    id: options.id ?? newLibraryEntryId(),
    missionId: mission.id,
    title: mission.title,
    campaignId: mission.campaign?.campaignId ?? null,
    formatVersion: mission.version,
    updatedAt: stamp,
    scenarioJson,
    lastValidScenarioJson,
    lastValidAt,
  };
}

/**
 * Save or replace one library entry. A refused document never overwrites one.
 *
 * The write re-emits unreadable records from the same read, so saving an
 * unrelated document cannot quietly erase a corrupt one that might still be
 * recoverable by hand.
 */
export function saveScenarioToLibrary(
  storage: LibraryStorage,
  scenario: Scenario,
  options: { id?: string; now?: string } = {},
): MissionLibraryEntry {
  const read = readMissionLibrary(storage);
  if (read.envelope.status === 'unreadable') {
    throw new MissionLibraryError(
      'unavailable',
      read.envelope.message ?? 'Browser storage cannot be read, so the library cannot be updated.',
    );
  }
  const previous = options.id
    ? read.doc.entries.find((existing) => existing.id === options.id)
    : undefined;
  const entry = entryFromScenario(scenario, { id: options.id, now: options.now, previous });
  const entries = read.doc.entries.filter((existing) => existing.id !== entry.id);
  const other = entries.find((existing) => existing.missionId === entry.missionId);
  if (other) {
    throw new MissionLibraryError(
      'invalid',
      `Mission id "${entry.missionId}" is already stored by "${other.title}". Duplicate it or change the mission id before saving.`,
    );
  }
  entries.unshift(entry);
  writeMissionLibrary(storage, entries, { unreadable: read.unreadable, read });
  return entry;
}

export function deleteLibraryEntry(storage: LibraryStorage, entryId: string): boolean {
  const read = readMissionLibrary(storage);
  const entries = read.doc.entries.filter((entry) => entry.id !== entryId);
  if (entries.length === read.doc.entries.length) return false;
  writeMissionLibrary(storage, entries, { unreadable: read.unreadable, read });
  return true;
}

/**
 * Duplicate an entry with a new library identity and a new mission id.
 *
 * The copy is detached from its campaign: a user-authored copy must never
 * masquerade as an official operation. Document content is parsed fresh from
 * the stored JSON, so the two entries never share mutable objects.
 */
export function duplicateLibraryEntry(
  storage: LibraryStorage,
  entryId: string,
  options: { now?: string } = {},
): MissionLibraryEntry {
  const read = readMissionLibrary(storage);
  const source = read.doc.entries.find((entry) => entry.id === entryId);
  if (!source) throw new MissionLibraryError('missing', 'That library document no longer exists.');
  const scenario = parseScenario(JSON.parse(source.scenarioJson));
  if (!scenario.mission) throw new MissionLibraryError('no-mission', 'Stored scenario has no mission.');
  const taken = new Set(read.doc.entries.map((entry) => entry.missionId));
  scenario.mission = duplicateMissionDoc(scenario.mission, taken);
  scenario.meta.id = `${scenario.meta.id}-copy`.slice(0, 64);
  scenario.meta.name = `${scenario.meta.name} (Copy)`;
  delete scenario.meta.campaign;
  const entry = entryFromScenario(scenario, { now: options.now });
  const entries = [entry, ...read.doc.entries];
  writeMissionLibrary(storage, entries, { unreadable: read.unreadable, read });
  return entry;
}

/** Whether an entry has a fallback snapshot that actually differs from the saved copy. */
export function canRestoreLastValid(entry: MissionLibraryEntry | null | undefined): boolean {
  return Boolean(
    entry?.lastValidScenarioJson && entry.lastValidScenarioJson !== entry.scenarioJson,
  );
}

/**
 * Turn a preserved raw payload back into a scenario document.
 *
 * Accepts a whole archive, a library entry, a scenario document or (with a host
 * map) a mission-only document. Nothing is invented: if the payload cannot be
 * parsed by the canonical parser, the caller gets a diagnostic instead.
 */
export function scenarioFromRecoveryRaw(raw: string, host?: Scenario): Scenario {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new MissionLibraryError(
      'parse',
      `The preserved record is not valid JSON: ${messageOf(error)}`,
    );
  }
  const candidate = coerceRecoveryCandidate(parsed, host, 0);
  if (!candidate) {
    throw new MissionLibraryError(
      'invalid',
      'No readable mission document could be recovered from this record. Export the raw data for manual inspection.',
    );
  }
  if (!candidate.mission) {
    throw new MissionLibraryError('no-mission', 'Recovered scenario has no mission document.');
  }
  return candidate;
}

function coerceRecoveryCandidate(value: unknown, host: Scenario | undefined, depth: number): Scenario | null {
  if (!value || typeof value !== 'object' || depth > 2) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.scenarioJson === 'string') {
    let nested: unknown;
    try {
      nested = JSON.parse(record.scenarioJson);
    } catch (error) {
      throw new MissionLibraryError(
        'parse',
        `The stored document inside this record is not valid JSON: ${messageOf(error)}`,
      );
    }
    return coerceRecoveryCandidate(nested, host, depth + 1);
  }
  if (Array.isArray(record.entries)) {
    const found: Scenario[] = [];
    for (const item of record.entries) {
      try {
        const scenario = coerceRecoveryCandidate(item, host, depth + 1);
        if (scenario?.mission) found.push(scenario);
      } catch {
        /* Skip unreadable members; the count below explains the rest. */
      }
    }
    if (found.length === 1) return found[0];
    if (found.length > 1) {
      throw new MissionLibraryError(
        'invalid',
        `This archive holds ${found.length} readable documents. Export it and recover them one at a time.`,
      );
    }
    return null;
  }
  if (record.format === MISSION_FORMAT) {
    if (!host) {
      throw new MissionLibraryError(
        'invalid',
        'This record carries a mission without a map. Open a scenario first, then recover it.',
      );
    }
    const mission = parseMission(record, contextFor(host));
    return scenarioForImportedMission(host, mission);
  }
  if (record.format === MAP_FORMAT) {
    return parseScenario(record);
  }
  return null;
}

/**
 * Recover one preserved record as a new library copy.
 *
 * Always a copy: a recovered document can never replace a valid entry, and it
 * is detached from any campaign.
 */
export function recoverLibraryRecord(
  storage: LibraryStorage,
  record: LibraryRecoveryRecord,
  options: { host?: Scenario; now?: string } = {},
): MissionLibraryEntry {
  const base = scenarioFromRecoveryRaw(record.raw, options.host);
  const read = readMissionLibrary(storage);
  const taken = new Set(read.doc.entries.map((entry) => entry.missionId));
  const copy = copyOfImportedScenario(base, taken);
  const entry = saveScenarioToLibrary(storage, copy, { now: options.now });
  return entry;
}

/** Filename for exporting a preserved record exactly as captured. */
export function recoveryFilename(record: LibraryRecoveryRecord): string {
  return `library-recovery-${record.category}-${record.id.slice(0, 16)}.json`;
}

/* ------------------------------------------------------------------ */
/* Inspection                                                          */
/* ------------------------------------------------------------------ */

/** Re-validate a stored entry for the library list. */
export function inspectEntry(entry: MissionLibraryEntry): {
  scenario: Scenario | null;
  mission: MissionDoc | null;
  issues: ValidationIssue[];
  missionIssues: MissionIssue[];
  error: string | null;
} {
  try {
    const scenario = parseScenario(JSON.parse(entry.scenarioJson));
    if (!scenario.mission) {
      return {
        scenario,
        mission: null,
        issues: [],
        missionIssues: [],
        error: 'Stored scenario has no mission.',
      };
    }
    return {
      scenario,
      mission: scenario.mission,
      issues: validateScenario(scenario),
      missionIssues: validateMission(scenario.mission, contextFor(scenario)),
      error: null,
    };
  } catch (error) {
    return {
      scenario: null,
      mission: null,
      issues: [],
      missionIssues: [],
      error: messageOf(error),
    };
  }
}

export function libraryIssueCounts(issues: readonly { severity: string }[]): {
  errors: number;
  warnings: number;
} {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  };
}

export function searchLibrary(
  entries: readonly MissionLibraryEntry[],
  query: string,
): MissionLibraryEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter(
    (entry) =>
      entry.title.toLowerCase().includes(needle) ||
      entry.missionId.toLowerCase().includes(needle) ||
      (entry.campaignId ?? '').toLowerCase().includes(needle),
  );
}

export type LibrarySort = 'recent' | 'title' | 'mission';

export function sortLibrary(
  entries: readonly MissionLibraryEntry[],
  sort: LibrarySort,
): MissionLibraryEntry[] {
  const copy = [...entries];
  if (sort === 'title') return copy.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === 'mission') return copy.sort((a, b) => a.missionId.localeCompare(b.missionId));
  return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type ImportKind = 'mission' | 'scenario';

export interface ImportPreview {
  kind: ImportKind;
  mission: MissionDoc;
  scenario: Scenario | null;
  issues: MissionIssue[];
  errors: number;
  warnings: number;
}

/**
 * Classify and parse an import without writing anything.
 *
 * The canonical parser is always used. A document that parses but carries
 * warning-level findings is shown to the author rather than silently stored.
 */
export function previewImport(
  raw: unknown,
  context: { width: number; height: number; entityKeys: Set<string>; scenario?: Scenario },
): ImportPreview {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MissionLibraryError('unrecognised', 'The file is not a scenario or mission document.');
  }
  const record = raw as Record<string, unknown>;
  try {
    if (record.format === MISSION_FORMAT) {
      const mission = parseMission(record, {
        width: context.width,
        height: context.height,
        entityKeys: context.entityKeys,
      });
      const issues = validateMission(mission, context);
      return {
        kind: 'mission',
        mission,
        scenario: null,
        issues,
        errors: issues.filter((issue) => issue.severity === 'error').length,
        warnings: issues.filter((issue) => issue.severity === 'warning').length,
      };
    }
    if (record.format === MAP_FORMAT) {
      const scenario = parseScenario(record);
      if (!scenario.mission) {
        throw new MissionLibraryError(
          'no-mission',
          'That scenario parses, but it has no mission document to import.',
        );
      }
      const issues = validateMission(scenario.mission, contextFor(scenario));
      return {
        kind: 'scenario',
        mission: scenario.mission,
        scenario,
        issues,
        errors: issues.filter((issue) => issue.severity === 'error').length,
        warnings: issues.filter((issue) => issue.severity === 'warning').length,
      };
    }
  } catch (error) {
    if (error instanceof MissionLibraryError) throw error;
    if (error instanceof MissionFormatError) {
      throw new MissionLibraryError('parse', error.message);
    }
    throw new MissionLibraryError('parse', messageOf(error));
  }
  throw new MissionLibraryError(
    'unrecognised',
    `Unrecognised document format "${String(record.format)}". Expected a mission or scenario document.`,
  );
}

/** Attach an imported mission to a copy of the supplied scenario. */
export function scenarioForImportedMission(scenario: Scenario, mission: MissionDoc): Scenario {
  const copy = structuredClone(scenario);
  copy.mission = structuredClone(mission);
  return copy;
}

/** Copy a scenario import with a fresh mission identity and no campaign link. */
export function copyOfImportedScenario(scenario: Scenario, taken: ReadonlySet<string>): Scenario {
  if (!scenario.mission) {
    throw new MissionLibraryError('no-mission', 'Imported scenario has no mission.');
  }
  const copy = structuredClone(scenario);
  copy.mission = duplicateMissionDoc(scenario.mission, taken);
  copy.meta.name = `${copy.meta.name} (Copy)`;
  copy.meta.id = `${copy.meta.id}-copy`.slice(0, 64);
  delete copy.meta.campaign;
  return copy;
}

/** A filename that is safe on every desktop platform. */
export function libraryFilename(title: string, suffix: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'mission'}-${suffix}.json`;
}

export function missionJson(mission: MissionDoc): string {
  return `${JSON.stringify(mission, null, 2)}\n`;
}

export function scenarioJsonForExport(scenario: Scenario): string {
  return `${scenarioToJson(scenario)}\n`;
}

/** Keep the id namespace check available to callers without importing validate.ts. */
export function missionIdTaken(entries: readonly MissionLibraryEntry[], id: string): boolean {
  return entries.some((entry) => entry.missionId === id);
}

export function nextMissionIdForScenario(scenario: Scenario, entries: readonly MissionLibraryEntry[]): string {
  const taken = new Set(entries.map((entry) => entry.missionId));
  return uniqueMissionId(scenario.meta.id || scenario.meta.name, taken);
}

export function isCampaignMission(entry: MissionLibraryEntry): boolean {
  return entry.campaignId !== null;
}
