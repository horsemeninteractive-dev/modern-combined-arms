/**
 * Scenario Forge draft persistence.
 *
 * The Forge already had an autosave slot in S6; this module is that slot with a
 * recorded recovery point, not a second authoring model. The draft is the
 * scenario JSON exactly as authored, including documents that do not validate,
 * because losing an invalid draft is precisely how authors lose work.
 *
 * Three recovery points exist and stay independent:
 *
 * - the draft (`iron-tide.editor.autosave.v1` + metadata), written on every
 *   edit regardless of validation;
 * - the saved library copy, written only by an explicit save;
 * - the last-valid library snapshot, kept by `library.ts`.
 *
 * Nothing here throws: autosave is best effort, and a failure is reported so
 * the UI can stop claiming that work is stored.
 */
import { parseScenario, scenarioToJson, type Scenario } from '../sim/scenario';
import {
  captureRecoveries,
  describeStorageFailure,
  type LibraryErrorCode,
  type LibraryStorage,
} from './library';

/** Kept from S6 so existing drafts keep loading. */
export const EDITOR_AUTOSAVE_KEY = 'iron-tide.editor.autosave.v1';
export const EDITOR_DRAFT_META_KEY = 'iron-tide.editor.draft-meta.v1';
export const EDITOR_DRAFT_VERSION = 1;

export interface EditorDraftInfo {
  /** Library identity this draft belongs to, when it is anchored to one. */
  entryId?: string | null;
  missionId?: string | null;
  errorCount?: number;
  warningCount?: number;
}

export interface EditorDraftMeta {
  version: number;
  savedAt: string;
  entryId: string | null;
  missionId: string | null;
  errorCount: number;
  warningCount: number;
  bytes: number;
}

export interface EditorDraftState {
  scenario: Scenario | null;
  meta: EditorDraftMeta | null;
  /** Why the draft cannot be used, when it cannot. */
  error: string | null;
  /** True when the slot holds something, even if it is unreadable. */
  present: boolean;
}

export interface EditorDraftWrite {
  ok: boolean;
  error: string | null;
  code: LibraryErrorCode | null;
  meta: EditorDraftMeta | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normaliseMeta(raw: unknown): EditorDraftMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const meta = raw as Partial<EditorDraftMeta>;
  if (typeof meta.savedAt !== 'string') return null;
  return {
    version: typeof meta.version === 'number' ? meta.version : EDITOR_DRAFT_VERSION,
    savedAt: meta.savedAt,
    entryId: typeof meta.entryId === 'string' ? meta.entryId : null,
    missionId: typeof meta.missionId === 'string' ? meta.missionId : null,
    errorCount: typeof meta.errorCount === 'number' ? meta.errorCount : 0,
    warningCount: typeof meta.warningCount === 'number' ? meta.warningCount : 0,
    bytes: typeof meta.bytes === 'number' ? meta.bytes : 0,
  };
}

/**
 * Read the draft without throwing.
 *
 * An unreadable draft is quarantined first, so a later autosave cannot destroy
 * the only copy of the damaged text.
 */
export function readEditorDraft(storage: LibraryStorage): EditorDraftState {
  let text: string | null = null;
  try {
    text = storage.getItem(EDITOR_AUTOSAVE_KEY);
  } catch (error) {
    return {
      scenario: null,
      meta: null,
      error: describeStorageFailure(error).message,
      present: false,
    };
  }
  const meta = (() => {
    try {
      const raw = storage.getItem(EDITOR_DRAFT_META_KEY);
      return raw ? normaliseMeta(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  })();
  if (!text) return { scenario: null, meta, error: null, present: false };
  let scenario: Scenario;
  try {
    // An incomplete document is exactly the draft worth keeping, so mission
    // validation is deferred: the workbench reports it, storage never accepts it.
    scenario = parseScenario(JSON.parse(text), { allowInvalidMission: true });
  } catch (error) {
    captureRecoveries(storage, [
      {
        category: 'corrupt-archive',
        reason: `The Scenario Forge draft is unreadable: ${messageOf(error)}`,
        raw: text,
        source: EDITOR_AUTOSAVE_KEY,
      },
    ]);
    return {
      scenario: null,
      meta,
      error: `The draft could not be read: ${messageOf(error)}. Its original text has been preserved in the mission library recovery area.`,
      present: true,
    };
  }
  return { scenario, meta, error: null, present: true };
}

/**
 * Write the draft and its metadata.
 *
 * The scenario is stored first: the metadata describes what is already on disk,
 * so a failed metadata write can never claim a draft that was not stored.
 */
export function writeEditorDraft(
  storage: LibraryStorage,
  scenario: Scenario,
  info: EditorDraftInfo = {},
  now = nowIso(),
): EditorDraftWrite {
  const json = scenarioToJson(scenario);
  try {
    storage.setItem(EDITOR_AUTOSAVE_KEY, json);
  } catch (error) {
    const described = describeStorageFailure(error);
    return { ok: false, error: described.message, code: described.code, meta: null };
  }
  const meta: EditorDraftMeta = {
    version: EDITOR_DRAFT_VERSION,
    savedAt: now,
    entryId: info.entryId ?? null,
    missionId: info.missionId ?? scenario.mission?.id ?? null,
    errorCount: info.errorCount ?? 0,
    warningCount: info.warningCount ?? 0,
    bytes: json.length,
  };
  try {
    storage.setItem(EDITOR_DRAFT_META_KEY, JSON.stringify(meta));
  } catch {
    // The draft itself is stored; only the timestamp is missing.
    return { ok: true, error: null, code: null, meta: null };
  }
  return { ok: true, error: null, code: null, meta };
}

/** Remove the draft. Only used by explicit user actions. */
export function clearEditorDraft(storage: LibraryStorage): void {
  for (const key of [EDITOR_AUTOSAVE_KEY, EDITOR_DRAFT_META_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      /* Nothing else to do: the caller reports the outcome. */
    }
  }
}

/** Export helper so a draft can always be taken out of the browser. */
export function draftExportJson(scenario: Scenario): string {
  return `${scenarioToJson(scenario)}\n`;
}
