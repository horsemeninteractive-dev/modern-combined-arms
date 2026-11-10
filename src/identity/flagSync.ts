/**
 * The wire format for personal command flags.
 *
 * Shared by the account Worker and the browser client so a submission cannot be
 * shaped one way and read another. The server validates every field with this
 * module; the client uses the same parser to reject a malformed reply instead of
 * rendering it.
 */
import {
  MAX_FLAG_BYTES,
  MAX_FLAG_DESIGNS,
  MAX_FLAG_DOCUMENT_BYTES,
  MAX_FLAG_NAME_LENGTH,
  compositionBytes,
  parseFlagComposition,
  type FlagComposition,
  type FlagDesign,
} from './flag';
import { unlockedEmblemIds, validateEquip, type CosmeticProgress } from './cosmetics';
import type { FlagStoreState } from './flagStore';

export interface FlagSyncDocument {
  designs: FlagDesign[];
  activeId: string | null;
  equipped: { frame: string | null; background: string | null; camo: string | null };
  revision: number;
}

export interface FlagSubmission extends FlagSyncDocument {
  /** The revision the client last read; the server refuses a stale write. */
  expectedRevision: number;
}

const DESIGN_ID = /^[A-Za-z0-9_-]{3,64}$/;
const MAX_REVISION = 1_000_000;

function asText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function asTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : fallback;
}

/**
 * Parse a design as submitted. The composition is validated with the same
 * parser the renderer uses, so an unknown colour or emblem is a refusal rather
 * than a silently different flag.
 */
export function parseFlagDesign(raw: unknown, now: number): { design: FlagDesign | null; issue: string | null } {
  if (typeof raw !== 'object' || raw === null) return { design: null, issue: 'A flag design must be an object.' };
  const record = raw as Record<string, unknown>;
  const id = asText(record.id, 64);
  if (!DESIGN_ID.test(id)) return { design: null, issue: 'A flag design id must be 3–64 letters, digits, hyphens or underscores.' };
  const name = asText(record.name, MAX_FLAG_NAME_LENGTH);
  if (!name) return { design: null, issue: `A flag design needs a name of at most ${MAX_FLAG_NAME_LENGTH} characters.` };
  const parsed = parseFlagComposition(record.composition);
  if (!parsed.ok) {
    return { design: null, issue: `Flag ${id}: ${parsed.issues[0]?.message ?? 'invalid composition'}` };
  }
  if (compositionBytes(parsed.composition) > MAX_FLAG_BYTES) {
    return { design: null, issue: `Flag ${id} is larger than a command flag may be.` };
  }
  return {
    design: {
      id,
      name,
      composition: parsed.composition,
      createdAt: asTimestamp(record.createdAt, now),
      updatedAt: asTimestamp(record.updatedAt, now),
      schemaVersion: parsed.composition.version,
    },
    issue: null,
  };
}

export type FlagSubmissionResult =
  | { ok: true; submission: FlagSubmission }
  | { ok: false; issues: string[] };

/**
 * Validate a save request in full before anything is written.
 *
 * The equipped cosmetics are checked against progress the server computed from
 * its own ledger, so a client cannot equip an item it has not earned by editing
 * the request or its local state.
 */
export function parseFlagSubmission(
  raw: unknown,
  progress: CosmeticProgress,
  now: number,
): FlagSubmissionResult {
  const issues: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, issues: ['A flag document must be an object.'] };
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.designs)) {
    return { ok: false, issues: ['A flag document needs a designs array.'] };
  }
  if (record.designs.length > MAX_FLAG_DESIGNS) {
    issues.push(`At most ${MAX_FLAG_DESIGNS} flag designs can be stored.`);
  }
  const designs: FlagDesign[] = [];
  const ids = new Set<string>();
  for (const entry of record.designs.slice(0, MAX_FLAG_DESIGNS)) {
    const parsed = parseFlagDesign(entry, now);
    if (parsed.issue) {
      issues.push(parsed.issue);
      continue;
    }
    const design = parsed.design!;
    if (ids.has(design.id)) {
      issues.push(`Flag design "${design.id}" appears twice.`);
      continue;
    }
    ids.add(design.id);
    designs.push(design);
  }

  // Ownership is checked inside each design, not just for equipped cosmetics:
  // a modified client must not be able to submit a valid but locked emblem by
  // editing the composition directly.
  const unlockedEmblems = new Set(unlockedEmblemIds(progress));
  for (const design of designs) {
    const emblemId = design.composition.emblem?.id;
    if (emblemId && !unlockedEmblems.has(emblemId)) {
      issues.push(`Flag "${design.name}" uses an emblem that has not been unlocked.`);
    }
  }

  const activeId = record.activeId === null || record.activeId === undefined ? null : asText(record.activeId, 64);
  if (activeId !== null && !ids.has(activeId)) {
    issues.push('The active design is not one of the submitted designs.');
  }

  const equippedRaw = typeof record.equipped === 'object' && record.equipped !== null
    ? (record.equipped as Record<string, unknown>)
    : {};
  const frame = equippedRaw.frame === null || equippedRaw.frame === undefined ? null : asText(equippedRaw.frame, 64);
  const background =
    equippedRaw.background === null || equippedRaw.background === undefined
      ? null
      : asText(equippedRaw.background, 64);
  const frameProblem = validateEquip('frame', frame, progress);
  if (frameProblem) issues.push(frameProblem);
  const backgroundProblem = validateEquip('background', background, progress);
  if (backgroundProblem) issues.push(backgroundProblem);
  const camo =
    equippedRaw.camo === null || equippedRaw.camo === undefined ? null : asText(equippedRaw.camo, 64);
  // Unit camo is earned the same way as a frame: the server checks it against
  // progress it derived from its own ledger, never against the request.
  const camoProblem = validateEquip('camo', camo, progress);
  if (camoProblem) issues.push(camoProblem);

  // Only the explicit expected revision is accepted: falling back to a document
  // revision would let a stale client claim it had read the newest write.
  const expectedRevision = record.expectedRevision;
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > MAX_REVISION) {
    issues.push('A flag write needs the revision it was based on.');
  }

  // The per-design cap does not stop eight maximal designs being submitted
  // together, so the whole document has its own ceiling.
  const documentBytes = new TextEncoder().encode(JSON.stringify(designs)).length;
  if (documentBytes > MAX_FLAG_DOCUMENT_BYTES) {
    issues.push('That flag document is larger than the account can store.');
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    submission: {
      designs,
      activeId,
      equipped: { frame, background, camo },
      revision: 0,
      expectedRevision: Number(expectedRevision),
    },
  };
}

/** Read a stored or returned document without applying ownership rules. */
export function parseFlagSyncDocument(raw: unknown, now: number): FlagSyncDocument {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const designs: FlagDesign[] = [];
  for (const entry of Array.isArray(record.designs) ? record.designs.slice(0, MAX_FLAG_DESIGNS) : []) {
    const parsed = parseFlagDesign(entry, now);
    if (parsed.design) designs.push(parsed.design);
  }
  const ids = new Set(designs.map((design) => design.id));
  const active = asText(record.activeId, 64);
  const equippedRaw = typeof record.equipped === 'object' && record.equipped !== null
    ? (record.equipped as Record<string, unknown>)
    : {};
  return {
    designs,
    activeId: ids.has(active) ? active : null,
    equipped: {
      frame: asText(equippedRaw.frame, 64) || null,
      background: asText(equippedRaw.background, 64) || null,
      camo: asText(equippedRaw.camo, 64) || null,
    },
    revision: typeof record.revision === 'number' && Number.isFinite(record.revision) ? Math.max(0, Math.round(record.revision)) : 0,
  };
}

/** The browser store's view of a server document. */
export function stateFromDocument(
  document: FlagSyncDocument,
  now: number,
  accountId: string | null = null,
): FlagStoreState {
  return {
    version: 1,
    designs: document.designs,
    activeId: document.activeId,
    equipped: document.equipped,
    updatedAt: now,
    accountId,
    revision: accountId === null ? null : document.revision,
    pending: false,
  };
}

/** The request body for a save. Extra document fields are not sent. */
export function documentSubmission(
  state: Pick<FlagStoreState, 'designs' | 'activeId' | 'equipped'>,
  expectedRevision: number,
): Record<string, unknown> {
  return {
    designs: state.designs,
    activeId: state.activeId,
    equipped: state.equipped,
    expectedRevision,
  };
}

/** A composition that could not be parsed is never rendered from storage. */
export function usableComposition(value: unknown): FlagComposition | null {
  const parsed = parseFlagComposition(value);
  return parsed.ok ? parsed.composition : null;
}
