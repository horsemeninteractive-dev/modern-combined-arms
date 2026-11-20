import {
  DEFAULT_MUSIC_TRACK_IDS,
  MUSIC_TRACK_IDS,
  isMusicTrackId,
} from './musicCatalogue';
import { isLocalMusicId, localMusicTracks } from './localMusic';

/**
 * Pure playlist vocabulary and persistence normalisation.
 *
 * The live controller and the settings UI both use these helpers so a stale or
 * hand-edited localStorage blob cannot introduce duplicate tracks, unknown ids
 * or a repeat mode the player cannot choose.
 */

export type MusicRepeatMode = 'off' | 'all' | 'one';

export const MUSIC_REPEAT_MODES: readonly MusicRepeatMode[] = ['off', 'all', 'one'] as const;

export const MUSIC_REPEAT_LABELS: Record<MusicRepeatMode, string> = {
  off: 'Off',
  all: 'Repeat playlist',
  one: 'Repeat track',
};

export interface MusicPlaylistPreferences {
  /** Every catalogue track, in the player's chosen order (including disabled). */
  order: string[];
  /** Tracks included in battle playback. */
  enabled: string[];
  /** Shuffle each pass; false follows `order`. */
  shuffle: boolean;
  repeat: MusicRepeatMode;
}

function normaliseRepeat(value: unknown): MusicRepeatMode {
  return MUSIC_REPEAT_MODES.includes(value as MusicRepeatMode)
    ? (value as MusicRepeatMode)
    : 'all';
}

function knownUnique(ids: unknown, isKnown: (id: string) => boolean): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of ids) {
    if (typeof value !== 'string' || !isKnown(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Turn anything from storage into a usable playlist.
 *
 * Missing ids are ignored. Catalogue tracks that are not mentioned yet are
 * appended to the order but are not enabled, so a newly shipped track never
 * silently joins a player's custom playlist. A missing playlist gets the
 * authored default.
 */
export function normaliseMusicPlaylist(
  value: unknown,
  catalogueIds: readonly string[] = MUSIC_TRACK_IDS,
  defaultEnabledIds: readonly string[] = DEFAULT_MUSIC_TRACK_IDS,
): MusicPlaylistPreferences {
  const known = new Set(catalogueIds);
  // A local id is kept even before its file has been read back from storage, so
  // a reload never prunes the player's own tracks from their saved playlist.
  const isKnown = (id: string): boolean => known.has(id) || isLocalMusicId(id);
  const localIds = localMusicTracks().map((track) => track.id);
  const raw =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

  if (!raw) {
    const order = [...catalogueIds, ...localIds];
    return {
      order,
      enabled: order.filter((id) => defaultEnabledIds.includes(id)),
      shuffle: true,
      repeat: 'all',
    };
  }

  const order = knownUnique(raw.order, isKnown);
  // An enabled list without an order still places its tracks first rather than
  // losing them at the end of a default order.
  for (const id of knownUnique(raw.enabled, isKnown)) {
    if (!order.includes(id)) order.push(id);
  }
  for (const id of catalogueIds) {
    if (known.has(id) && !order.includes(id)) order.push(id);
  }
  // A local file stays listed (excluded, or still enabled) even when a saved
  // order predates it, so the editor can always reach it again.
  for (const id of localIds) {
    if (!order.includes(id)) order.push(id);
  }

  const enabledSource = Array.isArray(raw.enabled)
    ? knownUnique(raw.enabled, isKnown)
    : defaultEnabledIds.filter((id) => known.has(id));
  const enabledSet = new Set(enabledSource);
  // Keep enabled ids in playlist order so the persisted value is deterministic.
  const enabled = order.filter((id) => enabledSet.has(id));

  return {
    order,
    enabled,
    shuffle: typeof raw.shuffle === 'boolean' ? raw.shuffle : true,
    repeat: normaliseRepeat(raw.repeat),
  };
}

export function defaultMusicPlaylist(): MusicPlaylistPreferences {
  return normaliseMusicPlaylist(null);
}

/** Stable comparison key; avoids restarting playback for an identical change. */
export function musicPlaylistKey(preferences: MusicPlaylistPreferences): string {
  return [
    preferences.order.join(','),
    preferences.enabled.join(','),
    preferences.shuffle ? '1' : '0',
    preferences.repeat,
  ].join('|');
}

export function enabledMusicTrackIds(preferences: MusicPlaylistPreferences): string[] {
  const enabled = new Set(preferences.enabled);
  return preferences.order.filter((id) => enabled.has(id));
}

export function setMusicTrackEnabled(
  preferences: MusicPlaylistPreferences,
  id: string,
  enabled: boolean,
): MusicPlaylistPreferences {
  if (!isMusicTrackId(id)) return normaliseMusicPlaylist(preferences);
  const base = normaliseMusicPlaylist(preferences);
  const next = new Set(base.enabled);
  if (enabled) next.add(id);
  else next.delete(id);
  return normaliseMusicPlaylist({ ...base, enabled: [...next] });
}

export function moveMusicTrack(
  preferences: MusicPlaylistPreferences,
  id: string,
  direction: -1 | 1,
): MusicPlaylistPreferences {
  const base = normaliseMusicPlaylist(preferences);
  const from = base.order.indexOf(id);
  if (from < 0) return base;
  const to = Math.max(0, Math.min(base.order.length - 1, from + direction));
  if (to === from) return base;
  const order = [...base.order];
  [order[from], order[to]] = [order[to], order[from]];
  return normaliseMusicPlaylist({ ...base, order });
}

export function setMusicShuffle(
  preferences: MusicPlaylistPreferences,
  shuffle: boolean,
): MusicPlaylistPreferences {
  return { ...normaliseMusicPlaylist(preferences), shuffle };
}

export function setMusicRepeat(
  preferences: MusicPlaylistPreferences,
  repeat: MusicRepeatMode,
): MusicPlaylistPreferences {
  return { ...normaliseMusicPlaylist(preferences), repeat: normaliseRepeat(repeat) };
}

export function restoreDefaultMusicPlaylist(): MusicPlaylistPreferences {
  return defaultMusicPlaylist();
}
