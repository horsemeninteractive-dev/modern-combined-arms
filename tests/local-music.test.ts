import { afterEach, describe, expect, it } from 'vitest';
import {
  addLocalMusicFiles,
  forgetLocalMusicTrack,
  isLocalMusicId,
  localMusicTracks,
} from '../src/ui/localMusic';
import { musicTrack } from '../src/ui/musicCatalogue';
import {
  normaliseMusicPlaylist,
  setMusicTrackEnabled,
} from '../src/ui/musicPlaylist';

/**
 * jsdom has neither object URLs nor IndexedDB, which is exactly the session-only
 * case: the library must still hand playback a usable track.
 */
let urls = 0;
Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: () => `blob:local/${++urls}`,
});
Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });

afterEach(() => {
  for (const track of localMusicTracks()) forgetLocalMusicTrack(track.id);
});

describe('local battle tracks', () => {
  it('accepts audio files as catalogue entries and refuses everything else', async () => {
    const added = await addLocalMusicFiles([
      new File([new Uint8Array([1, 2, 3])], 'My Track.mp3', { type: 'audio/mpeg' }),
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    ]);
    expect(added).toHaveLength(1);
    expect(isLocalMusicId(added[0].id)).toBe(true);
    expect(added[0].title).toBe('My Track');
    expect(added[0].local).toBe(true);
    expect(musicTrack(added[0].id)?.src).toMatch(/^blob:local\//);
  });

  it('keeps a local track in the saved playlist but does not enable it by default', async () => {
    const [track] = await addLocalMusicFiles([
      new File([new Uint8Array([4])], 'holds_the_line.wav', { type: 'audio/wav' }),
    ]);
    const playlist = normaliseMusicPlaylist(null);
    expect(playlist.order).toContain(track.id);
    expect(playlist.enabled).not.toContain(track.id);
    expect(track.title).toBe('holds the line');

    const enabled = setMusicTrackEnabled(playlist, track.id, true);
    expect(enabled.enabled).toContain(track.id);
    // It survives a round trip through stored preferences.
    expect(normaliseMusicPlaylist(JSON.parse(JSON.stringify(enabled))).enabled).toContain(track.id);
  });

  it('drops an id whose file is gone when the library is reconciled', async () => {
    const [track] = await addLocalMusicFiles([
      new File([new Uint8Array([5])], 'gone.ogg', { type: 'audio/ogg' }),
    ]);
    const playlist = setMusicTrackEnabled(normaliseMusicPlaylist(null), track.id, true);
    forgetLocalMusicTrack(track.id);
    const reconciled = normaliseMusicPlaylist(playlist).order.filter(
      (id) => !isLocalMusicId(id) || !!musicTrack(id),
    );
    expect(reconciled).not.toContain(track.id);
  });
});
