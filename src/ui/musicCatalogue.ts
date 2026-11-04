/**
 * The authored soundtrack catalogue.
 *
 * The menu theme is deliberately not in this list: it is a separate soundtrack
 * element with its own lifecycle. Everything here is selectable battle music.
 * Adding a track means adding one entry; the playlist editor and the playback
 * controller both read this list instead of keeping their own copies.
 */

export interface MusicTrackDef {
  /** Stable id persisted in settings. Never derive this from the title. */
  id: string;
  title: string;
  /** Public URL of the authored MP3. */
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
}

const MUSIC_ROOT = '/audio/music/';

/** The menu theme shares the audio folder but is never part of the playlist. */
export const MAIN_THEME_SRC = `${MUSIC_ROOT}menu-theme.mp3`;

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
];

export const MUSIC_TRACK_IDS: readonly string[] = MUSIC_TRACKS.map((track) => track.id);

export const MUSIC_TRACKS_BY_ID: ReadonlyMap<string, MusicTrackDef> = new Map(
  MUSIC_TRACKS.map((track) => [track.id, track]),
);

export const DEFAULT_MUSIC_TRACK_IDS: readonly string[] = MUSIC_TRACKS.filter(
  (track) => track.defaultEnabled,
).map((track) => track.id);

export function isMusicTrackId(value: unknown): value is string {
  return typeof value === 'string' && MUSIC_TRACKS_BY_ID.has(value);
}

export function musicTrack(id: unknown): MusicTrackDef | undefined {
  return typeof id === 'string' ? MUSIC_TRACKS_BY_ID.get(id) : undefined;
}
