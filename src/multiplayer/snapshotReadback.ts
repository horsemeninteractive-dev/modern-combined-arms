/**
 * Staging-only, read-only inspection of a room's persisted snapshot.
 *
 * This module exists so an operator can prove what is actually on disk: it
 * takes the raw values read from Durable Object storage, assembles them exactly
 * as stored, and passes the assembled text through the same strict schema and
 * reference validation that a restore uses. It never builds a snapshot, never
 * normalises one, and never touches a Game, a RoomMatch, a lease or a timer.
 *
 * The persisted index carries no checksum, so the SHA-256 reported here is
 * computed from the assembled bytes and is labelled as such. It is not a
 * comparison against a stored digest.
 */
import { RoomSnapshotError, validateRoomSnapshot, type RoomSnapshotRestoreOptions, type RoomSnapshotV2 } from './roomSnapshot';

export const SNAPSHOT_READBACK_VERSION = 1;
export const SNAPSHOT_READBACK_MAX_CHUNKS = 128;
/** Keeps the optional raw-text echo bounded. The writer enforces the same cap. */
export const SNAPSHOT_READBACK_MAX_CHARS = SNAPSHOT_READBACK_MAX_CHUNKS * 48_000;

export interface SnapshotIndexShape {
  version: 1;
  generation: string;
  chunks: number;
  length: number;
  tick: number;
  updatedAt: number;
}

/** The lifecycle facts the reader compares the snapshot against. */
export interface ReadbackMetaShape {
  roomId: string;
  closed: boolean;
  closedReason: string | null;
  closedAt: number | null;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  totalTicks: number | null;
  hardDeadlineAt: number | null;
  finalResult: unknown;
}

export interface SnapshotReadbackSuccess {
  ok: true;
  code: 'snapshot-readback';
  version: typeof SNAPSHOT_READBACK_VERSION;
  roomId: string;
  readback: {
    indexVersion: number;
    generation: string;
    chunksExpected: number;
    chunksRead: number;
    /** Chunk keys are `generation:index`, so a duplicate reference cannot exist. */
    chunkKeyShape: 'generation:index';
    duplicateChunkReferences: 0;
    missingIndex: false;
    storedLength: number;
    assembledLength: number;
    byteLength: number;
    byteLengthMethod: 'utf8-encoded-assembled-text';
    sha256: string;
    hashSource: 'computed-from-assembled-bytes';
    indexCarriesHash: false;
    indexTick: number;
    indexUpdatedAt: number;
    textIncluded: boolean;
    textUtf16Length: number;
    /** The exact assembled text, present only when explicitly requested. */
    text?: string;
  };
  lifecycle: {
    metaClosed: boolean;
    metaClosedReason: string | null;
    metaClosedAt: number | null;
    metaStartedAtMs: number | null;
    metaFinishedAtMs: number | null;
    metaTotalTicks: number | null;
    hardDeadlineAt: number | null;
    snapshotPhase: string;
    snapshotStartedAtMs: number | null;
    snapshotFinishedAtMs: number | null;
    finishedAtMatchesMeta: boolean;
    resultMatchesMeta: boolean;
    roomMatchesMeta: boolean;
    /** True when the persisted envelope and the snapshot tell one story. */
    consistent: boolean;
    playingSnapshotHasFinishTime: boolean;
    finishedSnapshotHasFinishTime: boolean;
  };
  snapshot: {
    format: string;
    version: number;
    tick: number;
    createdAt: string;
    seats: Array<{
      seatId: number;
      team: number;
      epoch: number;
      seq: number;
      connected: boolean;
      abandoned: boolean;
    }>;
    result: {
      phase: string;
      winnerTeam: number | null;
      reason: string | null;
      tick: number;
      teams: unknown;
    };
    simulation: {
      version: number;
      entities: number;
      projectiles: number;
      contacts: number;
      charted: number;
    };
  };
  validation: {
    strict: true;
    function: 'validateRoomSnapshot';
    ok: true;
    options: { startedAtMs: number | null; matchDeadlineAt: number | null };
  };
}

export interface SnapshotReadbackFailure {
  ok: false;
  code: string;
  message: string;
  stage: 'index' | 'chunks' | 'assembly' | 'parse' | 'validate' | 'meta';
  problems: string[];
  status: number;
}

export type SnapshotReadbackResult = SnapshotReadbackSuccess | SnapshotReadbackFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Validate the index envelope without trusting any of its fields. */
export function checkSnapshotIndex(value: unknown): { ok: true; index: SnapshotIndexShape } | { ok: false; problem: string } {
  if (!isRecord(value)) return { ok: false, problem: 'snapshot index is missing or not an object' };
  if (value.version !== 1) return { ok: false, problem: `snapshot index version ${String(value.version)} is unsupported` };
  if (typeof value.generation !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(value.generation)) {
    return { ok: false, problem: 'snapshot index generation is invalid' };
  }
  if (!isInteger(value.chunks) || value.chunks < 1 || value.chunks > SNAPSHOT_READBACK_MAX_CHUNKS) {
    return { ok: false, problem: 'snapshot index chunk count is invalid' };
  }
  if (!isInteger(value.length) || value.length < 1 || value.length > SNAPSHOT_READBACK_MAX_CHARS) {
    return { ok: false, problem: 'snapshot index length is invalid' };
  }
  if (!isInteger(value.tick) || value.tick < 0) return { ok: false, problem: 'snapshot index tick is invalid' };
  if (!isInteger(value.updatedAt) || value.updatedAt < 0) {
    return { ok: false, problem: 'snapshot index update time is invalid' };
  }
  return {
    ok: true,
    index: {
      version: 1,
      generation: value.generation,
      chunks: value.chunks,
      length: value.length,
      tick: value.tick,
      updatedAt: value.updatedAt,
    },
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a standalone ArrayBuffer so the digest covers exactly these bytes
  // and the buffer type is not a SharedArrayBuffer view.
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  const view = new Uint8Array(digest);
  let hex = '';
  for (const byte of view) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function resultSummary(result: unknown): {
  phase: string;
  winnerTeam: number | null;
  reason: string | null;
  tick: number;
  teams: unknown;
} | null {
  if (!isRecord(result)) return null;
  return {
    phase: String(result.phase),
    winnerTeam: isInteger(result.winnerTeam) ? (result.winnerTeam as number) : null,
    reason: typeof result.reason === 'string' ? (result.reason as string) : null,
    tick: isInteger(result.tick) ? (result.tick as number) : -1,
    teams: result.teams ?? null,
  };
}

function sameResult(left: unknown, right: unknown): boolean {
  const a = resultSummary(left);
  const b = resultSummary(right);
  if (!a || !b) return false;
  return (
    a.phase === b.phase &&
    a.winnerTeam === b.winnerTeam &&
    a.reason === b.reason &&
    a.tick === b.tick &&
    JSON.stringify(a.teams) === JSON.stringify(b.teams)
  );
}

export interface InspectStoredSnapshotInput {
  roomId: string;
  meta: ReadbackMetaShape;
  /** Raw value read from the snapshot index key; validated here, never trusted. */
  index: unknown;
  /** Raw values read from each expected chunk key, in index order. */
  parts: readonly unknown[];
  includeText?: boolean;
}

/**
 * Assemble and strictly validate the stored snapshot.
 *
 * The only transformation is concatenation of the stored chunk strings, which
 * is exactly how the writer split them. Anything else — length, tick, parse,
 * schema, references, lifecycle agreement — is verified and reported.
 */
export async function inspectStoredSnapshot(
  input: InspectStoredSnapshotInput,
): Promise<SnapshotReadbackResult> {
  const checked = checkSnapshotIndex(input.index);
  if (!checked.ok) {
    return {
      ok: false,
      code: 'snapshot-index-invalid',
      message: checked.problem,
      stage: 'index',
      problems: [checked.problem],
      status: 500,
    };
  }
  const index = checked.index;

  const problems: string[] = [];
  const missing: number[] = [];
  for (let chunk = 0; chunk < index.chunks; chunk++) {
    if (typeof input.parts[chunk] !== 'string') missing.push(chunk);
  }
  if (missing.length) {
    return {
      ok: false,
      code: 'snapshot-chunk-missing',
      message: 'One or more snapshot chunks are missing from storage.',
      stage: 'chunks',
      problems: missing.map((chunk) => `chunk ${chunk} is missing or is not a string`),
      status: 500,
    };
  }

  const parts = input.parts.slice(0, index.chunks) as string[];
  const text = parts.join('');
  if (text.length !== index.length) {
    return {
      ok: false,
      code: 'snapshot-length-mismatch',
      message: 'Assembled snapshot length does not match the stored index.',
      stage: 'assembly',
      problems: [
        `index length ${index.length}`,
        `assembled length ${text.length}`,
        `chunks ${index.chunks}`,
      ],
      status: 500,
    };
  }

  const bytes = new TextEncoder().encode(text);
  const sha256 = await sha256Hex(bytes);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      code: 'snapshot-parse-failed',
      message: error instanceof Error ? error.message : 'Stored snapshot is not valid JSON.',
      stage: 'parse',
      problems: [`byteLength ${bytes.length}`, `sha256 ${sha256}`],
      status: 500,
    };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      code: 'snapshot-parse-failed',
      message: 'Stored snapshot is not a JSON object.',
      stage: 'parse',
      problems: [`byteLength ${bytes.length}`, `sha256 ${sha256}`],
      status: 500,
    };
  }
  if (parsed.tick !== index.tick) {
    return {
      ok: false,
      code: 'snapshot-tick-mismatch',
      message: 'Stored snapshot tick does not match its index.',
      stage: 'parse',
      problems: [`index tick ${index.tick}`, `snapshot tick ${String(parsed.tick)}`, `sha256 ${sha256}`],
      status: 500,
    };
  }

  let snapshot: RoomSnapshotV2;
  const options: RoomSnapshotRestoreOptions = { startedAtMs: input.meta.startedAtMs };
  // Mirror the room's own restore call: the deadline is supplied when known so
  // the start-after-deadline check is exercised on the stored bytes too.
  if (input.meta.hardDeadlineAt !== null) options.matchDeadlineAt = input.meta.hardDeadlineAt;
  try {
    // Same call, same options, and therefore the same strictness a restore
    // applies. This is the whole point of the action: the bytes are validated
    // as they are stored, not rebuilt first.
    snapshot = validateRoomSnapshot(parsed, options);
  } catch (error) {
    const code = error instanceof RoomSnapshotError ? error.code : 'snapshot-invalid';
    return {
      ok: false,
      code: `validation-${code}`,
      message: error instanceof Error ? error.message : 'Stored snapshot failed strict validation.',
      stage: 'validate',
      problems: [`byteLength ${bytes.length}`, `sha256 ${sha256}`, `validation code ${code}`],
      status: 500,
    };
  }

  const result = resultSummary(snapshot.result);
  const finishedAtMatchesMeta =
    (snapshot.timing.finishedAtMs ?? null) === (input.meta.finishedAtMs ?? null);
  const resultMatchesMeta = input.meta.finalResult === null
    ? result?.phase === 'playing'
    : sameResult(snapshot.result, input.meta.finalResult);
  const roomMatchesMeta = snapshot.roomId === input.meta.roomId;
  if (!roomMatchesMeta) problems.push('snapshot room id does not match the persisted metadata');
  if (!finishedAtMatchesMeta) {
    problems.push(
      `snapshot finish time ${String(snapshot.timing.finishedAtMs)} does not match metadata ${String(input.meta.finishedAtMs)}`,
    );
  }
  if (!resultMatchesMeta) problems.push('snapshot result does not match the persisted final result');

  const playingSnapshotHasFinishTime =
    result?.phase === 'playing' && snapshot.timing.finishedAtMs !== null;
  const finishedSnapshotHasFinishTime =
    result?.phase === 'finished' && snapshot.timing.finishedAtMs !== null;

  const includeText = input.includeText === true;
  return {
    ok: true,
    code: 'snapshot-readback',
    version: SNAPSHOT_READBACK_VERSION,
    roomId: input.roomId,
    readback: {
      indexVersion: index.version,
      generation: index.generation,
      chunksExpected: index.chunks,
      chunksRead: parts.length,
      chunkKeyShape: 'generation:index',
      duplicateChunkReferences: 0,
      missingIndex: false,
      storedLength: index.length,
      assembledLength: text.length,
      byteLength: bytes.length,
      byteLengthMethod: 'utf8-encoded-assembled-text',
      sha256,
      hashSource: 'computed-from-assembled-bytes',
      indexCarriesHash: false,
      indexTick: index.tick,
      indexUpdatedAt: index.updatedAt,
      textIncluded: includeText,
      textUtf16Length: text.length,
      ...(includeText ? { text } : {}),
    },
    lifecycle: {
      metaClosed: input.meta.closed,
      metaClosedReason: input.meta.closedReason,
      metaClosedAt: input.meta.closedAt,
      metaStartedAtMs: input.meta.startedAtMs,
      metaFinishedAtMs: input.meta.finishedAtMs,
      metaTotalTicks: input.meta.totalTicks,
      hardDeadlineAt: input.meta.hardDeadlineAt,
      snapshotPhase: result?.phase ?? 'unknown',
      snapshotStartedAtMs: snapshot.timing.startedAtMs,
      snapshotFinishedAtMs: snapshot.timing.finishedAtMs,
      finishedAtMatchesMeta,
      resultMatchesMeta,
      roomMatchesMeta,
      consistent: problems.length === 0,
      playingSnapshotHasFinishTime,
      finishedSnapshotHasFinishTime,
    },
    snapshot: {
      format: snapshot.format,
      version: snapshot.version,
      tick: snapshot.tick,
      createdAt: snapshot.createdAt,
      seats: snapshot.seats.map((seat) => ({
        seatId: seat.seatId,
        team: seat.team,
        epoch: seat.epoch,
        seq: seat.seq,
        connected: seat.connected,
        abandoned: seat.abandoned,
      })),
      result: {
        phase: result?.phase ?? 'unknown',
        winnerTeam: result?.winnerTeam ?? null,
        reason: result?.reason ?? null,
        tick: result?.tick ?? -1,
        teams: result?.teams ?? null,
      },
      simulation: {
        version: Number((snapshot.simulation as { version?: unknown }).version ?? -1),
        entities: Array.isArray(snapshot.simulation.state.entities)
          ? snapshot.simulation.state.entities.length
          : 0,
        projectiles: Array.isArray(snapshot.simulation.state.projectiles)
          ? snapshot.simulation.state.projectiles.length
          : 0,
        contacts: Array.isArray(snapshot.simulation.state.contacts)
          ? snapshot.simulation.state.contacts.length
          : 0,
        charted: Array.isArray(snapshot.simulation.state.charted)
          ? snapshot.simulation.state.charted.length
          : 0,
      },
    },
    validation: {
      strict: true,
      function: 'validateRoomSnapshot',
      ok: true,
      options: {
        startedAtMs: input.meta.startedAtMs,
        matchDeadlineAt: input.meta.hardDeadlineAt,
      },
    },
  };
}

/** Read the durable envelope into the shape the inspector compares against. */
export function readbackMeta(meta: Record<string, unknown>, roomId: string): ReadbackMetaShape {
  const reservation = isRecord(meta.reservation) ? meta.reservation : {};
  return {
    roomId,
    closed: meta.closed === true,
    closedReason: typeof meta.closedReason === 'string' ? meta.closedReason : null,
    closedAt: isInteger(meta.closedAt) ? meta.closedAt : null,
    startedAtMs: isInteger(meta.startedAtMs) ? meta.startedAtMs : null,
    finishedAtMs: isInteger(meta.finishedAtMs) ? meta.finishedAtMs : null,
    totalTicks: isInteger(meta.totalTicks) ? meta.totalTicks : null,
    hardDeadlineAt: isInteger(reservation.hardDeadlineAt) ? reservation.hardDeadlineAt : null,
    finalResult: meta.finalResult ?? null,
  };
}
