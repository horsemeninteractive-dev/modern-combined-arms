import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAIN_THEME_SRC,
  MUSIC_TRACKS,
  MUSIC_TRACK_IDS,
} from '../src/ui/musicCatalogue';
import {
  defaultMusicPlaylist,
  setMusicTrackEnabled,
} from '../src/ui/musicPlaylist';
import { musicPanelMarkup } from '../src/ui/musicSettings';
import type { MatchMusicSnapshot } from '../src/ui/matchMusic';

const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');

const idle: MatchMusicSnapshot = {
  trackId: null,
  title: null,
  src: null,
  running: false,
  playing: false,
  paused: false,
  preview: false,
  enabledCount: MUSIC_TRACK_IDS.length,
};

describe('music playlist editor', () => {
  it('renders one row for every catalogue track in the saved order', () => {
    const prefs = defaultMusicPlaylist();
    const markup = musicPanelMarkup(prefs, idle);
    expect(markup.match(/data-music-track=/g)).toHaveLength(MUSIC_TRACKS.length);
    for (const track of MUSIC_TRACKS) {
      expect(markup).toContain(`data-music-track="${track.id}"`);
      expect(markup).toContain(track.title);
      expect(markup).toContain(track.subtitle);
    }
    // The menu theme is not an in-game playlist row or preview control.
    expect(markup).not.toContain(MAIN_THEME_SRC);
    expect(markup).not.toContain('menu-theme');
  });

  it('distinguishes enabled, excluded and currently playing tracks in text, not colour alone', () => {
    const prefs = defaultMusicPlaylist();
    const playing: MatchMusicSnapshot = {
      ...idle,
      trackId: MUSIC_TRACK_IDS[2],
      title: MUSIC_TRACKS[2].title,
      src: MUSIC_TRACKS[2].src,
      running: true,
      playing: true,
      enabledCount: prefs.enabled.length,
    };
    const markup = musicPanelMarkup(prefs, playing);
    expect(markup).toContain('Current · playing');
    expect(markup).toContain('In playlist');
    expect(markup).toContain(MUSIC_TRACKS[2].title);
    expect(markup).toContain('aria-current="true"');

    const disabled = setMusicTrackEnabled(prefs, MUSIC_TRACK_IDS[4], false);
    const excluded = musicPanelMarkup(disabled, idle);
    expect(excluded).toContain('Excluded');
    expect(excluded).toContain('4 of 5 enabled');
  });

  it('shows an explicit empty state and disables transport when every track is off', () => {
    const empty = { ...defaultMusicPlaylist(), enabled: [] };
    const markup = musicPanelMarkup(empty, { ...idle, enabledCount: 0 });
    expect(markup).toContain('All tracks are excluded');
    expect(markup).toContain('0 of 5 enabled');
    expect(markup).toContain('data-music-transport="toggle"');
    expect(markup).toMatch(/data-music-transport="next"[^>]*disabled/);
  });

  it('exposes a labelled switch, preview and accessible reorder controls per row', () => {
    const markup = musicPanelMarkup(defaultMusicPlaylist(), idle);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-label="Move Theatre of Operations up"');
    expect(markup).toContain('aria-label="Move Contested Ground down"');
    expect(markup).toContain('aria-label="Preview Night Watch"');
    expect(markup).toContain('data-music-mode="sequential"');
    expect(markup).toContain('data-music-mode="shuffle"');
    expect(markup).toContain('aria-label="Repeat mode"');
    expect(markup).toContain('data-music-defaults');
  });

  it('is wired into the shared settings markup and controller actions', () => {
    expect(app).toContain("import { musicPanelMarkup, syncMusicPanel }");
    expect(app).toContain("const musicRows = musicPanelMarkup(s.musicPlaylist, this.audio.matchMusicState)");
    expect(app).toContain("panel('music', musicRows)");
    expect(app).toContain('data-music-toggle');
    expect(app).toContain('data-music-preview');
    expect(app).toContain('data-music-transport');
    expect(app).toContain('setMusicTrackEnabled');
    expect(app).toContain('setMusicShuffle');
    expect(app).toContain('setMusicRepeat');
    expect(app).toContain('restoreDefaultMusicPlaylist');
    expect(app).toContain('this.audio.setMusicPlaylist(this.settings.musicPlaylist)');
  });

  it('has a compact desktop list and a wrapping mobile row', () => {
    expect(styles).toContain('.music-panel');
    expect(styles).toContain('max-height: clamp(188px, 28vh, 280px)');
    expect(styles).toContain('@media (max-width: 620px)');
    expect(styles).toContain('.music-track-preview { grid-column: 2 / 4');
    expect(styles).toContain('min-height: 32px');
  });

  it('respects reduced motion for the new transitions', () => {
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.music-track, \.music-transport button[\s\S]*transition: none/,
    );
  });
});
