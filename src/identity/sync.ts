/**
 * Flag synchronisation.
 *
 * Two operations, deliberately separate:
 *
 * - `syncFlags` reconciles a browser on sign-in. A clean cache for the signed-in
 *   account adopts the account document; a cache with pending local edits is
 *   pushed as updates, so a rename keeps its design id. A guest cache is imported
 *   additively, and a browser last used by a different account adopts that
 *   account's document instead of carrying one player's designs into another.
 * - `pushFlags` sends a local mutation. The local document is authoritative, so
 *   deleting a design actually reaches the account; a stale write is reconciled
 *   by keeping the local document as the base and appending designs another
 *   device added in the meantime.
 *
 * A push never discards local state on failure. Callers keep the document dirty
 * and retry on the next refresh, reconnect or edit.
 */
import {
  mergeGuestFlags,
  mergeRemoteDesigns,
  type FlagStore,
  type FlagStoreState,
} from './flagStore';
import { documentSubmission, stateFromDocument, type FlagSyncDocument } from './flagSync';

export interface FlagSyncApi {
  flags(): Promise<FlagSyncDocument>;
  saveFlags(body: Record<string, unknown>): Promise<FlagSyncDocument>;
}

export interface FlagSyncResult {
  status: 'synced' | 'merged' | 'pushed' | 'offline';
  imported: number;
  error: string | null;
  /** Revision of the server document this result leaves the local store on. */
  revision: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isStale(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'stale-write'
  );
}

function documentsDiffer(local: FlagStoreState, remote: FlagStoreState): boolean {
  if (local.activeId !== remote.activeId) return true;
  if (JSON.stringify(local.designs) !== JSON.stringify(remote.designs)) return true;
  return (
    local.equipped.frame !== remote.equipped.frame ||
    local.equipped.background !== remote.equipped.background ||
    local.equipped.camo !== remote.equipped.camo
  );
}

function offline(error: unknown, revision: number): FlagSyncResult {
  return { status: 'offline', imported: 0, error: messageOf(error), revision };
}

/**
 * Hydrate this browser from the account document.
 *
 * `accountId` is the signed-in account, so the store records who its designs
 * belong to. Without it (guest play, tests) the merge behaves as before.
 */
export async function syncFlags(
  store: FlagStore,
  api: FlagSyncApi,
  now: number,
  accountId: string | null = null,
): Promise<FlagSyncResult> {
  const owner = store.state.accountId;
  if (accountId !== null && owner === accountId && store.state.pending === true) {
    // The browser already belongs to this account and holds edits made while
    // the session was unavailable. Send them as updates, not as guest imports:
    // a rename keeps its design id and a stale write is rebased in pushFlags.
    return pushFlags(store, api, now, accountId, store.state.revision ?? 0);
  }

  let remoteDocument: FlagSyncDocument;
  try {
    remoteDocument = await api.flags();
  } catch (error) {
    return offline(error, 0);
  }

  if (accountId !== null && owner !== null && owner !== accountId) {
    // This device last belonged to another player. Adopt the signed-in
    // account's document instead of importing the previous player's designs.
    store.replace(stateFromDocument(remoteDocument, now, accountId), { silent: true });
    return { status: 'synced', imported: 0, error: null, revision: remoteDocument.revision };
  }

  if (accountId !== null && owner === accountId) {
    // This is a clean cache for the account, not a guest profile. Adopt the
    // server document so a remote rename cannot be imported as a second design
    // carrying the stale local composition.
    store.replace(stateFromDocument(remoteDocument, now, accountId), { silent: true });
    return { status: 'synced', imported: 0, error: null, revision: remoteDocument.revision };
  }

  const remoteState = stateFromDocument(remoteDocument, now, accountId);
  const merged = mergeGuestFlags(remoteState, store.state, now);
  const changed = documentsDiffer(merged.state, remoteState);

  if (!changed) {
    store.replace({ ...merged.state, accountId }, { silent: true });
    return { status: 'synced', imported: 0, error: null, revision: remoteDocument.revision };
  }

  try {
    const saved = await api.saveFlags(documentSubmission(merged.state, remoteDocument.revision));
    store.replace(stateFromDocument(saved, now, accountId), { silent: true });
    return {
      status: merged.imported > 0 ? 'merged' : 'pushed',
      imported: merged.imported,
      error: null,
      revision: saved.revision,
    };
  } catch (error) {
    if (!isStale(error)) return offline(error, remoteDocument.revision);
  }

  // Another device wrote first. Merge against its document and try once more.
  try {
    const fresh = await api.flags();
    const retry = mergeGuestFlags(stateFromDocument(fresh, now, accountId), store.state, now);
    const saved = await api.saveFlags(documentSubmission(retry.state, fresh.revision));
    store.replace(stateFromDocument(saved, now, accountId), { silent: true });
    return { status: 'merged', imported: retry.imported, error: null, revision: saved.revision };
  } catch (error) {
    return offline(error, remoteDocument.revision);
  }
}

/**
 * Push a local mutation to the account.
 *
 * The local document is the base, not an import: an edit, rename, delete or
 * active selection is the player's current intent. On a stale write the newest
 * server document is merged in as additions only, so another device's new
 * designs survive without resurrecting designs this player deleted.
 */
export async function pushFlags(
  store: FlagStore,
  api: FlagSyncApi,
  now: number,
  accountId: string,
  expectedRevision: number,
): Promise<FlagSyncResult> {
  const owner = store.state.accountId;
  if (owner !== null && owner !== accountId) {
    return {
      status: 'offline',
      imported: 0,
      error: 'This device’s local command flags belong to another account.',
      revision: expectedRevision,
    };
  }

  try {
    const saved = await api.saveFlags(documentSubmission(store.state, expectedRevision));
    store.replace(stateFromDocument(saved, now, accountId), { silent: true });
    return { status: 'pushed', imported: 0, error: null, revision: saved.revision };
  } catch (error) {
    if (!isStale(error)) return offline(error, expectedRevision);
  }

  // A newer server revision must not be overwritten. Rebase the local document
  // on it, importing only designs this device does not already have, then retry
  // once with the fresh revision.
  try {
    const fresh = await api.flags();
    const merged = mergeRemoteDesigns(
      { ...store.state, accountId },
      stateFromDocument(fresh, now, accountId),
      now,
    );
    const saved = await api.saveFlags(documentSubmission(merged.state, fresh.revision));
    store.replace(stateFromDocument(saved, now, accountId), { silent: true });
    return {
      status: merged.imported > 0 ? 'merged' : 'pushed',
      imported: merged.imported,
      error: null,
      revision: saved.revision,
    };
  } catch (error) {
    return offline(error, expectedRevision);
  }
}
