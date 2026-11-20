/**
 * The authored soundtrack catalogue.
 *
 * The menu theme is deliberately not in this list: it is a separate soundtrack
 * element with its own lifecycle. Everything else is either selectable battle
 * music or a mode's own score. Adding a track means adding one entry; the
 * playlist editor and the playback controller both read this list instead of
 * keeping their own copies.
 */

import { isLocalMusicId, localMusicTrack } from './localMusic';

export interface MusicTrackDef {
  /** Stable id persisted in settings. Never derive this from the title. */
  id: string;
  title: string;
  /** Public URL of the authored MP3, or an object URL for a local file. */
  src: string;
  /** Short descriptive line shown under the title in the editor. */
  subtitle: string;
  /** Broad mood/role classification, kept structured for future grouping. */
  mood: string;
  /** Optional attribution for a commissioned track. */
  attribution?: string;
  /** Optional length in seconds, when a reliable value is available. */
  durationSeconds?: number;
  /** Included in a fresh player's playlist. */
  defaultEnabled: boolean;
  /**
   * Owned by one mode's score rather than by the playlist. The mode plays it
   * itself, and the playlist editor never offers it.
   */
  modeOnly?: 'outbreak';
  /** A file the player added from this device. */
  local?: boolean;
}

const MUSIC_ROOT = '/audio/music/';

/** The menu theme shares the audio folder but is never part of the playlist. */
export const MAIN_THEME_SRC = `${MUSIC_ROOT}menu-theme.mp3`;

/**
 * The deck's Outbreak cue. It is menu music, not battle music: the mode plays
 * it while its route is armed and swaps back to the standard theme elsewhere.
 */
export const OUTBREAK_MENU_THEME_SRC = `${MUSIC_ROOT}DAY_0.mp3`;

/** The single track Outbreak is scored with. */
export const OUTBREAK_MUSIC_TRACK_ID = 'mechanical-ticks';

export const MUSIC_TRACKS: readonly MusicTrackDef[] = [
  {
    id: 'theatre-of-operations',
    title: 'Theatre of Operations',
    src: `${MUSIC_ROOT}Theatre of Operations.mp3`,
    subtitle: 'Command overview · measured',
    mood: 'Command',
    defaultEnabled: true,
  },
  {
    id: 'forward-command',
    title: 'Forward Command',
    src: `${MUSIC_ROOT}Forward Command.mp3`,
    subtitle: 'Advance under pressure · purposeful',
    mood: 'Advance',
    defaultEnabled: true,
  },
  {
    id: 'night-watch',
    title: 'Night Watch',
    src: `${MUSIC_ROOT}Night Watch.mp3`,
    subtitle: 'Low visibility · watchful',
    mood: 'Night',
    defaultEnabled: true,
  },
  {
    id: 'silent-front',
    title: 'Silent Front',
    src: `${MUSIC_ROOT}Silent Front.mp3`,
    subtitle: 'Held line · sparse',
    mood: 'Tension',
    defaultEnabled: true,
  },
  {
    id: 'contested-ground',
    title: 'Contested Ground',
    src: `${MUSIC_ROOT}Contested Ground.mp3`,
    subtitle: 'Shifting contact · deliberate',
    mood: 'Contact',
    defaultEnabled: true,
  },
  {
    id: OUTBREAK_MUSIC_TRACK_ID,
    title: 'Mechanical Ticks',
    src: `${MUSIC_ROOT}Mechanical Ticks.mp3`,
    subtitle: 'Outbreak score · relentless',
    mood: 'Outbreak',
    defaultEnabled: false,
    modeOnly: 'outbreak',
  },
];

/** The tracks the standard battle playlist can offer, in authored order. */
export const PLAYLIST_MUSIC_TRACKS: readonly MusicTrackDef[] = MUSIC_TRACKS.filter(
  (track) => !track.modeOnly,
);

export const MUSIC_TRACK_IDS: readonly string[] = PLAYLIST_MUSIC_TRACKS.map((track) => track.id);

export const MUSIC_TRACKS_BY_ID: ReadonlyMap<string, MusicTrackDef> = new Map(
  MUSIC_TRACKS.map((track) => [track.id, track]),
);

export const DEFAULT_MUSIC_TRACK_IDS: readonly string[] = PLAYLIST_MUSIC_TRACKS.filter(
  (track) => track.defaultEnabled,
).map((track) => track.id);

/** A saved playlist id: an authored track, a mode-only track or a local file. */
export function isMusicTrackId(value: unknown): value is string {
  return typeof value === 'string' && (MUSIC_TRACKS_BY_ID.has(value) || isLocalMusicId(value));
}

/** Resolve any playable id, including tracks the player added from their device. */
export function musicTrack(id: unknown): MusicTrackDef | undefined {
  if (typeof id !== 'string') return undefined;
  return MUSIC_TRACKS_BY_ID.get(id) ?? localMusicTrack(id);
}
