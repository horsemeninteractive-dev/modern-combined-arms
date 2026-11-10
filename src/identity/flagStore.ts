/**
 * Persistence for personal command flags and equipped cosmetics.
 *
 * The saved designs, the active design and the equipped frame/background form
 * one small document in the same local storage the rest of the game uses. It is
 * written whole on every change because it is only a few kilobytes; a partial
 * update scheme would be more code for less safety.
 *
 * Guest-to-account merge is deterministic and additive: account designs are
 * never overwritten, guest designs arrive with fresh ids only when they are not
 * already present, and the account's active design wins. A player can always
 * find an imported guest design in the strip, renamed rather than discarded.
 */
import {
  MAX_FLAG_BYTES,
  MAX_FLAG_DESIGNS,
  MAX_FLAG_NAME_LENGTH,
  compositionBytes,
  defaultComposition,
  parseFlagComposition,
  type FlagComposition,
  type FlagDesign,
} from './flag';
import { validateEquip, type CosmeticCategory } from './cosmetics';

export const FLAG_STORAGE_KEY = 'mca.command-flags.v1';
export const FLAG_STORE_VERSION = 1 as const;

export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface EquippedCosmetics {
  frame: string | null;
  background: string | null;
  /** Unit hull camo; presentation only, never read by the simulation. */
  camo: string | null;
}

export interface FlagStoreState {
  version: typeof FLAG_STORE_VERSION;
  designs: FlagDesign[];
  activeId: string | null;
  equipped: EquippedCosmetics;
  updatedAt: number;
  /** Account these local designs were last synchronised with, if any. */
  accountId: string | null;
  /** Server revision this local document is based on, once hydrated. */
  revision?: number | null;
  /** A local change has not been acknowledged by the account yet. */
  pending?: boolean;
}

export interface FlagWriteResult {
  ok: boolean;
  error: string | null;
}

export interface FlagMutationResult<T> extends FlagWriteResult {
  value: T | null;
}

export function emptyFlagState(now = 0): FlagStoreState {
  return {
    version: FLAG_STORE_VERSION,
    designs: [],
    activeId: null,
    equipped: { frame: null, background: null, camo: null },
    updatedAt: now,
    accountId: null,
    revision: null,
    pending: false,
  };
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max).trim() : '';
}

export function sanitiseFlagName(raw: unknown): string {
  return text(raw, MAX_FLAG_NAME_LENGTH) || 'Command flag';
}

function randomSuffix(): string {
  return Math.floor(Math.random() * 0xfffffff).toString(36).padStart(5, '0');
}

export function newFlagId(now: number, taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = `flag-${now.toString(36)}-${randomSuffix()}`;
    if (!taken.has(id)) return id;
  }
  return `flag-${now.toString(36)}-${Date.now().toString(36)}`;
}

function parseDesign(raw: unknown): FlagDesign | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = text(record.id, 64);
  if (!id) return null;
  const parsed = parseFlagComposition(record.composition);
  if (!parsed.ok) return null;
  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : 0;
  return {
    id,
    name: sanitiseFlagName(record.name),
    composition: parsed.composition,
    createdAt,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : createdAt,
    schemaVersion: parsed.composition.version,
  };
}

function equippedFrom(raw: unknown): EquippedCosmetics {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    frame: text(record.frame, 64) || null,
    background: text(record.background, 64) || null,
    camo: text(record.camo, 64) || null,
  };
}

/**
 * Read the stored state. A corrupt or partial document never throws: readable
 * designs are kept, unreadable ones are dropped and the player keeps working.
 */
export function readFlagState(storage: FlagStorage, now = 0): FlagStoreState {
  let raw: string | null = null;
  try {
    raw = storage.getItem(FLAG_STORAGE_KEY);
  } catch {
    return emptyFlagState(now);
  }
  if (!raw) return emptyFlagState(now);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyFlagState(now);
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyFlagState(now);
  const record = parsed as Record<string, unknown>;
  const designs = Array.isArray(record.designs)
    ? record.designs
        .slice(0, MAX_FLAG_DESIGNS)
        .map(parseDesign)
        .filter((design): design is FlagDesign => design !== null)
    : [];
  const ids = new Set(designs.map((design) => design.id));
  const activeId = typeof record.activeId === 'string' && ids.has(record.activeId) ? record.activeId : null;
  const accountId = typeof record.accountId === 'string' ? record.accountId : null;
  const rawRevision = record.revision;
  const revision =
    accountId !== null &&
    typeof rawRevision === 'number' &&
    Number.isFinite(rawRevision) &&
    rawRevision >= 0
      ? Math.round(rawRevision)
      : null;
  return {
    version: FLAG_STORE_VERSION,
    designs,
    activeId,
    equipped: equippedFrom(record.equipped),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : now,
    accountId,
    revision,
    pending: accountId !== null && record.pending === true,
  };
}

export function writeFlagState(storage: FlagStorage, state: FlagStoreState): FlagWriteResult {
  try {
    storage.setItem(FLAG_STORAGE_KEY, JSON.stringify(state));
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Command flags could not be saved on this device: ${error.message}`
          : 'Command flags could not be saved on this device.',
    };
  }
}

function compositionProblem(composition: FlagComposition): string | null {
  if (compositionBytes(composition) > MAX_FLAG_BYTES) {
    return 'That design is larger than a command flag may be.';
  }
  return null;
}

/**
 * A store over one storage object. Mutations write through immediately and
 * return a result so the UI can show a real failure instead of claiming a save.
 */
export class FlagStore {
  private current: FlagStoreState;
  private lastError: string | null = null;
  private listeners = new Set<() => void>();
  private mutations = 0;

  constructor(
    private readonly storage: FlagStorage,
    private readonly now: () => number = Date.now,
  ) {
    this.current = readFlagState(storage, now());
  }

  get state(): FlagStoreState {
    return this.current;
  }

  get error(): string | null {
    return this.lastError;
  }

  get designs(): FlagDesign[] {
    return this.current.designs;
  }

  design(id: string | null): FlagDesign | null {
    if (!id) return null;
    return this.current.designs.find((design) => design.id === id) ?? null;
  }

  activeDesign(): FlagDesign | null {
    return this.design(this.current.activeId);
  }

  /** The composition every surface renders for this player. */
  activeComposition(): FlagComposition {
    return this.activeDesign()?.composition ?? defaultComposition();
  }

  reload(): void {
    this.current = readFlagState(this.storage, this.now());
  }

  /** Count of local, player-driven commits. Server refreshes do not count. */
  get mutationCount(): number {
    return this.mutations;
  }

  /**
   * Observe successful local commits. A silent replace (account hydration or
   * save acknowledgement) deliberately does not notify, so a sync cannot
   * mistake its own server document for a new local edit.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replace the whole document, e.g. after an account read or a merge. */
  replace(state: FlagStoreState, options: { silent?: boolean } = {}): FlagWriteResult {
    return this.commit(state, options.silent === true);
  }

  create(name: string, composition: FlagComposition): FlagMutationResult<FlagDesign> {
    const problem = compositionProblem(composition);
    if (problem) return this.fail(problem);
    if (this.current.designs.length >= MAX_FLAG_DESIGNS) {
      return this.fail(`You can keep ${MAX_FLAG_DESIGNS} saved flags. Delete one to make room.`);
    }
    const timestamp = this.now();
    const design: FlagDesign = {
      id: newFlagId(timestamp, new Set(this.current.designs.map((entry) => entry.id))),
      name: sanitiseFlagName(name),
      composition: parseFlagComposition(composition).ok ? composition : defaultComposition(),
      createdAt: timestamp,
      updatedAt: timestamp,
      schemaVersion: composition.version,
    };
    const result = this.commit({
      ...this.current,
      designs: [...this.current.designs, design],
      updatedAt: timestamp,
    });
    return result.ok ? { ...result, value: design } : { ...result, value: null };
  }

  update(id: string, name: string, composition: FlagComposition): FlagMutationResult<FlagDesign> {
    const problem = compositionProblem(composition);
    if (problem) return this.fail(problem);
    const existing = this.design(id);
    if (!existing) return this.fail('That saved flag no longer exists.');
    const updated: FlagDesign = {
      ...existing,
      name: sanitiseFlagName(name),
      composition,
      updatedAt: this.now(),
      schemaVersion: composition.version,
    };
    const result = this.commit({
      ...this.current,
      designs: this.current.designs.map((design) => (design.id === id ? updated : design)),
      updatedAt: this.now(),
    });
    return result.ok ? { ...result, value: updated } : { ...result, value: null };
  }

  rename(id: string, name: string): FlagMutationResult<FlagDesign> {
    const existing = this.design(id);
    if (!existing) return this.fail('That saved flag no longer exists.');
    return this.update(id, name, existing.composition);
  }

  duplicate(id: string): FlagMutationResult<FlagDesign> {
    const source = this.design(id);
    if (!source) return this.fail('That saved flag no longer exists.');
    return this.create(`${source.name} copy`, source.composition);
  }

  remove(id: string): FlagWriteResult {
    if (!this.design(id)) return this.fail('That saved flag no longer exists.');
    const designs = this.current.designs.filter((design) => design.id !== id);
    return this.commit({
      ...this.current,
      designs,
      activeId: this.current.activeId === id ? null : this.current.activeId,
      updatedAt: this.now(),
    });
  }

  setActive(id: string | null): FlagWriteResult {
    if (id !== null && !this.design(id)) return this.fail('That saved flag no longer exists.');
    return this.commit({ ...this.current, activeId: id, updatedAt: this.now() });
  }

  equip(
    category: CosmeticCategory,
    id: string | null,
    progress: Parameters<typeof validateEquip>[2],
  ): FlagWriteResult {
    const problem = validateEquip(category, id, progress);
    if (problem) return this.fail(problem);
    const equipped = { ...this.current.equipped };
    if (category === 'frame') equipped.frame = id;
    else if (category === 'background') equipped.background = id;
    else if (category === 'camo') equipped.camo = id;
    else return this.fail('Emblems are worn by a flag design, not equipped on the profile.');
    return this.commit({ ...this.current, equipped, updatedAt: this.now() });
  }

  private commit(next: FlagStoreState, silent = false): FlagWriteResult {
    const state: FlagStoreState = {
      ...next,
      revision: next.revision ?? null,
      // A server acknowledgement is explicitly clean; a player-driven commit
      // on an owned document leaves work the account still has to receive.
      pending: silent ? next.pending === true : next.accountId !== null,
    };
    const written = writeFlagState(this.storage, state);
    this.lastError = written.error;
    if (written.ok) {
      this.current = state;
      if (!silent) {
        this.mutations += 1;
        for (const listener of this.listeners) listener();
      }
    }
    return written;
  }

  private fail<T>(error: string): FlagMutationResult<T> {
    this.lastError = error;
    return { ok: false, error, value: null };
  }
}

/**
 * Merge a guest document into an account document.
 *
 * Account content always wins: its designs keep their ids and names, its active
 * design stays active, its equipped cosmetics stay equipped. Guest designs are
 * appended with new ids while there is room, skipping designs whose composition
 * is already present. If the account had no active design, the guest's active
 * design (if it survived) becomes active. Running the merge twice is stable
 * because the second run finds every guest composition already present.
 */
/**
 * Rebase a local mutation onto a newer account document.
 *
 * Unlike the guest import, this must not deduplicate by composition: two saved
 * account designs may legitimately share artwork under different names. Local
 * designs win their ids (so edits and deletions stand), and remote designs this
 * device has never seen are appended with their account ids intact.
 */
export function mergeRemoteDesigns(
  local: FlagStoreState,
  remote: FlagStoreState,
  now: number,
): { state: FlagStoreState; imported: number; skipped: number } {
  const designs = [...local.designs];
  const known = new Set(designs.map((design) => design.id));
  let imported = 0;
  let skipped = 0;
  for (const design of remote.designs) {
    if (known.has(design.id)) continue;
    if (designs.length >= MAX_FLAG_DESIGNS) {
      skipped += 1;
      continue;
    }
    designs.push({ ...design, updatedAt: now });
    known.add(design.id);
    imported += 1;
  }
  const activeId =
    local.activeId && known.has(local.activeId)
      ? local.activeId
      : remote.activeId && known.has(remote.activeId)
        ? remote.activeId
        : null;
  return {
    state: {
      version: FLAG_STORE_VERSION,
      designs,
      activeId,
      equipped: local.equipped,
      updatedAt: now,
      accountId: local.accountId,
      revision: local.revision ?? null,
      pending: local.pending === true,
    },
    imported,
    skipped,
  };
}

export function mergeGuestFlags(
  account: FlagStoreState,
  guest: FlagStoreState,
  now: number,
): { state: FlagStoreState; imported: number; skipped: number } {
  const designs = [...account.designs];
  const seen = new Set(designs.map((design) => JSON.stringify(design.composition)));
  const guestActive = guest.activeId;
  let importedDesignId: string | null = null;
  let imported = 0;
  let skipped = 0;

  for (const design of guest.designs) {
    const signature = JSON.stringify(design.composition);
    if (seen.has(signature) || designs.length >= MAX_FLAG_DESIGNS) {
      skipped += 1;
      continue;
    }
    const id = newFlagId(now + imported, new Set(designs.map((entry) => entry.id)));
    const copy: FlagDesign = {
      ...design,
      id,
      name: sanitiseFlagName(design.name),
      createdAt: now,
      updatedAt: now,
    };
    designs.push(copy);
    seen.add(signature);
    imported += 1;
    if (design.id === guestActive) importedDesignId = id;
  }

  const activeId =
    account.activeId && designs.some((design) => design.id === account.activeId)
      ? account.activeId
      : importedDesignId;

  return {
    state: {
      version: FLAG_STORE_VERSION,
      designs,
      activeId,
      equipped: account.equipped,
      updatedAt: now,
      accountId: account.accountId,
      revision: account.revision ?? null,
      pending: account.pending === true,
    },
    imported,
    skipped,
  };
}
