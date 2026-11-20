import type { MusicTrackDef } from './musicCatalogue';

/**
 * Player-supplied battle music.
 *
 * A local track is an audio file the player picked from their own device. The
 * bytes are kept in IndexedDB and never leave the machine; a fresh object URL
 * is minted whenever the library loads, because an object URL does not survive
 * a reload. The catalogue stays the single lookup every other module uses, so
 * `musicTrack()` falls through to this registry and playback, the editor and
 * the saved playlist all treat local tracks like authored ones.
 */

export const LOCAL_MUSIC_ID_PREFIX = 'local-';

const DB_NAME = 'mca-local-music';
const DB_VERSION = 1;
const STORE = 'tracks';
/** A single file larger than this is refused: this is a browser tab, not a jukebox. */
const MAX_LOCAL_TRACK_BYTES = 80 * 1024 * 1024;
const AUDIO_EXTENSIONS = [
  '.mp3',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.webm',
] as const;

interface StoredLocalTrack {
  id: string;
  title: string;
  fileName: string;
  blob: Blob;
  addedAt: number;
}

const registry = new Map<string, MusicTrackDef>();

/** True for an id this module minted, whether or not its file is loaded yet. */
export function isLocalMusicId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(LOCAL_MUSIC_ID_PREFIX);
}

export function localMusicTracks(): MusicTrackDef[] {
  return [...registry.values()];
}

export function localMusicTrack(id: unknown): MusicTrackDef | undefined {
  return typeof id === 'string' ? registry.get(id) : undefined;
}

function localTrackId(): string {
  let id = '';
  do {
    id = `${LOCAL_MUSIC_ID_PREFIX}${Date.now().toString(36)}${Math.floor(
      Math.random() * 0x100000,
    ).toString(36)}`;
  } while (registry.has(id));
  return id;
}

function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
  return (base || 'Local track').slice(0, 60);
}

function isPlayableFile(file: File): boolean {
  if (!file || file.size <= 0 || file.size > MAX_LOCAL_TRACK_BYTES) return false;
  if (typeof file.type === 'string' && file.type.startsWith('audio/')) return true;
  const name = file.name.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function objectUrlFor(blob: Blob): string | null {
  try {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function defineLocalTrack(record: StoredLocalTrack, src: string): MusicTrackDef {
  return {
    id: record.id,
    title: record.title,
    src,
    subtitle: 'Your file · stored on this device',
    mood: 'Local',
    defaultEnabled: false,
    local: true,
  };
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    // Private mode, a blocked upgrade or a refused quota all mean "no library":
    // the playlist still accepts files for this session rather than breaking.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/** Run one request in its own transaction; null means storage was unavailable. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      let transaction: IDBTransaction;
      let request: IDBRequest<T> | null = null;
      try {
        transaction = db.transaction(STORE, mode);
        request = run(transaction.objectStore(STORE));
      } catch {
        resolve(null);
        return;
      }
      let value: T | null = null;
      let settled = false;
      const settle = (result: T | null): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      if (request) {
        request.onsuccess = () => {
          value = request!.result;
        };
        request.onerror = () => settle(null);
      }
      transaction.oncomplete = () => settle(value);
      transaction.onerror = () => settle(null);
      transaction.onabort = () => settle(null);
    });
  } finally {
    db.close();
  }
}

/** Load the stored library and mint a playable source for each file. */
export async function restoreLocalMusic(): Promise<number> {
  const records = await withStore<StoredLocalTrack[]>('readonly', (store) => store.getAll());
  if (!records) return 0;
  let restored = 0;
  for (const record of records) {
    if (!record || !isLocalMusicId(record.id) || !record.blob) continue;
    if (registry.has(record.id)) continue;
    const src = objectUrlFor(record.blob);
    if (!src) continue;
    registry.set(record.id, defineLocalTrack(record, src));
    restored++;
  }
  return restored;
}

/** Accept the player's chosen files and return the tracks that can be played. */
export async function addLocalMusicFiles(files: readonly File[]): Promise<MusicTrackDef[]> {
  const added: MusicTrackDef[] = [];
  for (const file of files) {
    if (!isPlayableFile(file)) continue;
    const src = objectUrlFor(file);
    if (!src) continue;
    const record: StoredLocalTrack = {
      id: localTrackId(),
      title: titleFromFileName(file.name),
      fileName: file.name,
      blob: file,
      addedAt: Date.now(),
    };
    const track = defineLocalTrack(record, src);
    registry.set(track.id, track);
    added.push(track);
    // A file that cannot be stored still plays this session; the next load
    // simply will not list it.
    await withStore('readwrite', (store) => store.put(record));
  }
  return added;
}

/** Drop a local track from this session, releasing its object URL. */
export function forgetLocalMusicTrack(id: string): void {
  const track = registry.get(id);
  if (track) {
    try {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(track.src);
      }
    } catch {
      /* A stale object URL is harmless. */
    }
  }
  registry.delete(id);
}

/** Delete the stored copy; call after the playlist no longer references it. */
export async function deleteLocalMusicTrack(id: string): Promise<void> {
  forgetLocalMusicTrack(id);
  await withStore('readwrite', (store) => store.delete(id));
}
