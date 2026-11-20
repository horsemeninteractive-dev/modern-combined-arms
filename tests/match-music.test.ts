import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/ui/audio';
import {
  DEFAULT_MUSIC_TRACK_IDS,
  MAIN_THEME_SRC,
  MUSIC_TRACKS,
  MUSIC_TRACK_IDS,
  OUTBREAK_MENU_THEME_SRC,
  OUTBREAK_MUSIC_TRACK_ID,
  PLAYLIST_MUSIC_TRACKS,
} from '../src/ui/musicCatalogue';
import {
  defaultMusicPlaylist,
  enabledMusicTrackIds,
  moveMusicTrack,
  normaliseMusicPlaylist,
  restoreDefaultMusicPlaylist,
  setMusicRepeat,
  setMusicShuffle,
  setMusicTrackEnabled,
} from '../src/ui/musicPlaylist';
import {
  MatchMusic,
  type MatchMusicOutput,
} from '../src/ui/matchMusic';

class FakeOutput implements MatchMusicOutput {
  plays: string[] = [];
  stops = 0;
  pauses = 0;
  resumes = 0;
  active: string | null = null;
  private handlers: { onEnded: () => void; onError: () => void } | null = null;

  get pending(): { onEnded: () => void; onError: () => void } | null {
    return this.handlers;
  }

  playTrack(src: string, handlers: { onEnded: () => void; onError: () => void }): void {
    this.plays.push(src);
    this.handlers = handlers;
    this.active = src;
  }

  stop(): void {
    this.stops++;
    this.handlers = null;
    this.active = null;
  }

  pause(): void {
    this.pauses++;
  }

  resume(): boolean {
    this.resumes++;
    return this.active !== null;
  }

  end(): void {
    const handlers = this.handlers;
    this.handlers = null;
    this.active = null;
    handlers?.onEnded();
  }

  fail(): void {
    const handlers = this.handlers;
    this.handlers = null;
    this.active = null;
    handlers?.onError();
  }
}

const sequential = (enabled = [...MUSIC_TRACK_IDS], repeat: 'off' | 'all' | 'one' = 'all') =>
  normaliseMusicPlaylist({
    order: [...MUSIC_TRACK_IDS],
    enabled,
    shuffle: false,
    repeat,
  });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('music catalogue', () => {
  it('has unique stable ids and the authored five-track default', () => {
    expect(PLAYLIST_MUSIC_TRACKS).toHaveLength(5);
    expect(MUSIC_TRACKS).toHaveLength(6);
    expect(new Set(MUSIC_TRACK_IDS).size).toBe(MUSIC_TRACK_IDS.length);
    // Outbreak's score is in the catalogue for playback, never in a playlist.
    expect(MUSIC_TRACK_IDS).not.toContain(OUTBREAK_MUSIC_TRACK_ID);
    expect(DEFAULT_MUSIC_TRACK_IDS).toEqual(MUSIC_TRACK_IDS);
    expect(defaultMusicPlaylist().enabled).toEqual([...MUSIC_TRACK_IDS]);
    expect(defaultMusicPlaylist().order).toEqual([...MUSIC_TRACK_IDS]);
  });

  it('does not put the menu theme or the retired themes in the playlist', () => {
    for (const track of MUSIC_TRACKS) {
      expect(track.src).not.toBe(MAIN_THEME_SRC);
      expect(track.src).not.toContain('in-game-theme');
      expect(track.title.toLowerCase()).not.toContain('menu theme');
    }
  });

  it('ships a real asset for every selectable track and for the menu theme', () => {
    for (const path of [
      ...MUSIC_TRACK_IDS.map((id) => MUSIC_TRACKS.find((t) => t.id === id)!.src),
      MUSIC_TRACKS.find((t) => t.id === OUTBREAK_MUSIC_TRACK_ID)!.src,
      MAIN_THEME_SRC,
    ]) {
      expect(existsSync(new URL(`../public${path}`, import.meta.url)), path).toBe(true);
    }
  });
});

describe('playlist preferences', () => {
  it('normalises duplicates, unknown ids and a missing enabled list', () => {
    const prefs = normaliseMusicPlaylist({
      order: [MUSIC_TRACK_IDS[2], MUSIC_TRACK_IDS[2], 'gone'],
      enabled: [MUSIC_TRACK_IDS[2], MUSIC_TRACK_IDS[2], 'gone'],
      shuffle: 'yes',
      repeat: 'sometimes',
    });
    expect(prefs.order).toEqual([
      MUSIC_TRACK_IDS[2],
      ...MUSIC_TRACK_IDS.filter((id) => id !== MUSIC_TRACK_IDS[2]),
    ]);
    expect(prefs.enabled).toEqual([MUSIC_TRACK_IDS[2]]);
    expect(prefs.shuffle).toBe(true);
    expect(prefs.repeat).toBe('all');
  });

  it('preserves custom order and appends new catalogue tracks without enabling them', () => {
    const ids = [...MUSIC_TRACK_IDS];
    const future = [...ids, 'future-track'];
    const prefs = normaliseMusicPlaylist(
      { order: [ids[1], ids[0]], enabled: [ids[1]], shuffle: false, repeat: 'one' },
      future,
    );
    expect(prefs.order).toEqual([ids[1], ids[0], ...ids.slice(2), 'future-track']);
    expect(prefs.enabled).toEqual([ids[1]]);
    expect(prefs.shuffle).toBe(false);
    expect(prefs.repeat).toBe('one');
  });

  it('keeps enabled ids in playlist order and supports enable/disable/move', () => {
    const base = normaliseMusicPlaylist({
      order: [MUSIC_TRACK_IDS[3], MUSIC_TRACK_IDS[1], MUSIC_TRACK_IDS[4], MUSIC_TRACK_IDS[0], MUSIC_TRACK_IDS[2]],
      enabled: [...MUSIC_TRACK_IDS],
    });
    expect(enabledMusicTrackIds(base)).toEqual(base.order);

    const off = setMusicTrackEnabled(base, MUSIC_TRACK_IDS[4], false);
    expect(off.enabled).not.toContain(MUSIC_TRACK_IDS[4]);
    expect(off.order).toEqual(base.order);

    const on = setMusicTrackEnabled(off, MUSIC_TRACK_IDS[4], true);
    expect(on.enabled).toEqual(base.order);

    const moved = moveMusicTrack(base, MUSIC_TRACK_IDS[2], -1);
    expect(moved.order.indexOf(MUSIC_TRACK_IDS[2])).toBe(base.order.indexOf(MUSIC_TRACK_IDS[2]) - 1);
    expect(moveMusicTrack(base, MUSIC_TRACK_IDS[3], -1).order).toEqual(base.order);
  });

  it('restores the authored default and validates shuffle/repeat choices', () => {
    const custom = setMusicRepeat(setMusicShuffle(sequential([MUSIC_TRACK_IDS[0]], 'off'), false), 'one');
    expect(custom.shuffle).toBe(false);
    expect(custom.repeat).toBe('one');
    const restored = restoreDefaultMusicPlaylist();
    expect(restored).toEqual(defaultMusicPlaylist());
    expect(restored.enabled).toEqual([...DEFAULT_MUSIC_TRACK_IDS]);
    expect(restored.shuffle).toBe(true);
    expect(restored.repeat).toBe('all');
  });

  it('handles an empty playlist without invalid ids', () => {
    const empty = sequential([], 'off');
    expect(empty.enabled).toEqual([]);
    expect(empty.order).toEqual([...MUSIC_TRACK_IDS]);
  });
});

describe('match soundtrack controller', () => {
  it('starts once and ignores duplicate lifecycle notifications', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { preferences: sequential(), random: () => 0 });
    music.start();
    music.start();
    expect(output.plays).toHaveLength(1);
    expect(music.running).toBe(true);
  });

  it('follows the player order in sequential playback and wraps with repeat all', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { preferences: sequential(), random: () => 0 });
    music.start();
    for (let i = 0; i < MUSIC_TRACK_IDS.length; i++) output.end();
    expect(output.plays.slice(0, MUSIC_TRACK_IDS.length)).toEqual(
      MUSIC_TRACK_IDS.map((id) => MUSIC_TRACKS.find((track) => track.id === id)!.src),
    );
    expect(output.plays[MUSIC_TRACK_IDS.length]).toBe(output.plays[0]);
  });

  it('plays every eligible track once per shuffled pass without adjacent repeats', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { preferences: sequential(), random: () => 0 });
    music.setPreferences(setMusicShuffle(sequential(), true));
    music.start();
    for (let i = 0; i < 24; i++) output.end();
    const first = output.plays.slice(0, MUSIC_TRACK_IDS.length);
    expect(new Set(first).size).toBe(MUSIC_TRACK_IDS.length);
    for (let i = 1; i < output.plays.length; i++) {
      expect(output.plays[i]).not.toBe(output.plays[i - 1]);
    }
  });

  it('stops cleanly on an empty playlist and resumes when a track is enabled', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { preferences: sequential(), random: () => 0 });
    music.start();
    const before = output.plays.length;

    music.setPreferences(sequential([], 'off'));
    expect(music.running).toBe(true);
    expect(music.snapshot.trackId).toBeNull();
    expect(music.snapshot.playing).toBe(false);
    expect(output.stops).toBeGreaterThan(0);

    music.setPreferences(sequential());
    expect(output.plays.length).toBeGreaterThan(before);
    expect(music.snapshot.trackId).not.toBeNull();
    expect(music.snapshot.playing).toBe(true);
  });

  it('transitions off the current track when it is disabled', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { preferences: sequential(), random: () => 0 });
    music.start();
    const current = music.currentTrackId;
    expect(current).not.toBeNull();

    music.setPreferences(sequential(MUSIC_TRACK_IDS.filter((id) => id !== current)));
    expect(music.currentTrackId).not.toBe(current);
    expect(music.currentTrackId).not.toBeNull();
    expect(music.snapshot.playing).toBe(true);
  });

  it('skips a failed track and tries every remaining track only once', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { preferences: sequential(), random: () => 0 });
    music.start();
    for (let i = 0; i < MUSIC_TRACK_IDS.length; i++) output.fail();
    expect(output.plays).toHaveLength(MUSIC_TRACK_IDS.length);
    expect(music.running).toBe(false);
    expect(music.currentTrackId).toBeNull();
  });

  it('supports next and previous without losing the track in between', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { preferences: sequential(), random: () => 0 });
    music.start();
    const first = music.currentTrackId;
    music.next();
    const second = music.currentTrackId;
    expect(second).not.toBe(first);
    music.previous();
    expect(music.currentTrackId).toBe(first);
    music.next();
    expect(music.currentTrackId).toBe(second);
  });

  it('repeats the current track or rests after a pass according to repeat mode', () => {
    const one = new FakeOutput();
    const repeatOne = new MatchMusic(one, {
      preferences: sequential([...MUSIC_TRACK_IDS], 'one'),
      random: () => 0,
    });
    repeatOne.start();
    const first = one.plays[0];
    one.end();
    expect(one.plays[1]).toBe(first);

    const off = new FakeOutput();
    const repeatOff = new MatchMusic(off, {
      preferences: sequential([...MUSIC_TRACK_IDS], 'off'),
      random: () => 0,
    });
    repeatOff.start();
    for (let i = 0; i < MUSIC_TRACK_IDS.length; i++) off.end();
    expect(off.plays).toHaveLength(MUSIC_TRACK_IDS.length);
    expect(repeatOff.snapshot.trackId).toBeNull();
    expect(repeatOff.running).toBe(true);
  });

  it('previews any track without changing the configured playlist', () => {
    const output = new FakeOutput();
    const prefs = sequential([MUSIC_TRACK_IDS[1]], 'off');
    const music = new MatchMusic(output, { preferences: prefs, random: () => 0 });
    const before = music.preferences;

    music.preview(MUSIC_TRACK_IDS[3]);
    expect(music.currentTrackId).toBe(MUSIC_TRACK_IDS[3]);
    expect(music.snapshot.preview).toBe(true);
    expect(output.plays.at(-1)).toBe(
      MUSIC_TRACKS.find((track) => track.id === MUSIC_TRACK_IDS[3])!.src,
    );
    expect(music.preferences).toEqual(before);
    output.end();
    expect(music.currentTrackId).toBeNull();
    expect(music.preferences).toEqual(before);
  });

  it('returns to the playlist after a preview inside a match', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { preferences: sequential(), random: () => 0 });
    music.start();
    const expected = MUSIC_TRACK_IDS[1];
    music.preview(MUSIC_TRACK_IDS[4]);
    expect(music.snapshot.preview).toBe(true);
    output.end();
    expect(music.snapshot.preview).toBe(false);
    expect(music.currentTrackId).toBe(expected);
  });

  it('pauses and resumes the current source without starting another', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { preferences: sequential(), random: () => 0 });
    music.start();
    const plays = output.plays.length;
    music.togglePause();
    expect(music.snapshot.paused).toBe(true);
    expect(output.pauses).toBe(1);
    music.togglePause();
    expect(music.snapshot.playing).toBe(true);
    expect(output.resumes).toBe(1);
    expect(output.plays).toHaveLength(plays);
  });

  it('does not put partial media responses in the runtime cache', () => {
    const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
    expect(sw).toContain('response.status === 206');
  });
});

class FakeMedia {
  static created: FakeMedia[] = [];
  static playImpl: (() => Promise<void>) | null = null;
  src = '';
  volume = 1;
  preload = '';
  loop = false;
  paused = true;
  playCalls = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<() => void>>();

  constructor(src?: string) {
    if (src !== undefined) this.src = src;
    FakeMedia.created.push(this);
  }

  play(): Promise<void> {
    this.playCalls++;
    this.paused = false;
    return FakeMedia.playImpl ? FakeMedia.playImpl() : Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  addEventListener(type: string, fn: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  removeAttribute(): void {
    this.src = '';
  }

  load(): void {}

  emit(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
}

function stubAudio(): void {
  FakeMedia.created = [];
  FakeMedia.playImpl = null;
  class Constructed extends FakeMedia {
    constructor(src?: string) {
      super(src);
    }
  }
  vi.stubGlobal('Audio', Constructed);
}

function startedEngine(): AudioEngine {
  const audio = new AudioEngine();
  (audio as unknown as { started: boolean }).started = true;
  return audio;
}

const matchSrcSet = new Set(
  MUSIC_TRACKS.map((track) => track.src),
);
const isMatch = (el: FakeMedia) => matchSrcSet.has(el.src);

describe('match soundtrack playback', () => {
  it('starts one catalogue track and reuses the media element', async () => {
    stubAudio();
    const audio = startedEngine();
    audio.setMusicVolume(0.5);
    (audio as unknown as { started: boolean }).started = true;
    audio.startMatchMusic();
    const element = FakeMedia.created.find(isMatch)!;
    expect(element).toBeDefined();
    expect(element.playCalls).toBe(1);
    expect(element.volume).toBeCloseTo(0.5, 5);
    expect(element.loop).toBe(false);

    const first = element.src;
    element.onended?.();
    expect(element.playCalls).toBe(2);
    expect(element.src).not.toBe(first);
    expect(FakeMedia.created.filter(isMatch)).toHaveLength(1);
    audio.stopMatchMusic();
    expect(element.paused).toBe(true);
    expect(element.src).toBe('');
  });

  it('skips a broken track and continues with another', () => {
    stubAudio();
    const audio = startedEngine();
    audio.startMatchMusic();
    const element = FakeMedia.created.find(isMatch)!;
    const broken = element.src;
    element.onerror?.();
    expect(element.src).not.toBe(broken);
    expect(element.playCalls).toBe(2);
    expect(FakeMedia.created.filter(isMatch)).toHaveLength(1);
    audio.stopMatchMusic();
  });

  it('applies music volume and mute to the active track immediately', () => {
    stubAudio();
    const audio = startedEngine();
    audio.setMusicVolume(0.6);
    audio.startMatchMusic();
    const element = FakeMedia.created.find(isMatch)!;
    expect(element.volume).toBeCloseTo(0.6, 5);

    audio.setMusicVolume(0.2);
    expect(element.volume).toBeCloseTo(0.2, 5);
    audio.setMuted(true);
    expect(element.volume).toBe(0);
    audio.setMuted(false);
    expect(element.volume).toBeCloseTo(0.2, 5);
    audio.stopMatchMusic();
  });

  it('ducks for a voice line without restarting the track', () => {
    vi.useFakeTimers();
    stubAudio();
    const audio = startedEngine();
    audio.setMusicVolume(0.5);
    audio.startMatchMusic();
    const match = FakeMedia.created.find(isMatch)!;
    expect(match.playCalls).toBe(1);

    audio.announce('victory');
    const voice = FakeMedia.created.find((el) => el.src.includes('/audio/narrator/defender/'))!;
    expect(voice).toBeDefined();
    if (voice) {
      vi.advanceTimersByTime(250);
      expect(match.volume).toBeCloseTo(0.5 * 0.32, 4);
      expect(match.playCalls).toBe(1);
      voice.emit('ended');
      vi.advanceTimersByTime(250);
      expect(match.volume).toBeCloseTo(0.5, 4);
      expect(match.playCalls).toBe(1);
    }
    audio.stopMatchMusic();
  });

  it('previews from the menu, ducking the theme and restoring it afterwards', async () => {
    vi.useFakeTimers();
    stubAudio();
    const audio = startedEngine();
    audio.setMusicVolume(0.5);
    audio.playMenuMusic();
    await Promise.resolve();
    vi.advanceTimersByTime(1600);
    const menu = FakeMedia.created.find((el) => el.src === MAIN_THEME_SRC)!;
    expect(menu.paused).toBe(false);

    audio.previewMatchTrack(MUSIC_TRACK_IDS[0]);
    const preview = FakeMedia.created.find(isMatch)!;
    expect(preview).toBeDefined();
    vi.advanceTimersByTime(500);
    expect(menu.paused).toBe(true);

    audio.stopMatchMusic();
    await Promise.resolve();
    vi.advanceTimersByTime(500);
    expect(menu.paused).toBe(false);
    expect(menu.playCalls).toBeGreaterThanOrEqual(2);
    audio.stopMenuMusic();
    vi.advanceTimersByTime(1000);
  });

  it('does not spin when autoplay is blocked and recovers on the next gesture', async () => {
    vi.useFakeTimers();
    stubAudio();
    FakeMedia.playImpl = () =>
      Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    const handlers = new Map<string, () => void>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: () => void) => handlers.set(type, fn),
      removeEventListener: (type: string) => handlers.delete(type),
    });

    const audio = startedEngine();
    audio.startMatchMusic();
    const element = FakeMedia.created.find(isMatch)!;
    await Promise.resolve();
    await Promise.resolve();
    expect(element.playCalls).toBe(1);
    expect(handlers.has('pointerdown')).toBe(true);
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(element.playCalls).toBe(1);

    handlers.get('pointerdown')?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(element.playCalls).toBe(2);
    expect(handlers.has('pointerdown')).toBe(true);
    audio.stopMatchMusic();
    expect(handlers.size).toBe(0);
  });

  it('stops music when leaving a match and does not leak into the menu path', () => {
    stubAudio();
    const audio = startedEngine();
    audio.startMatchMusic();
    const element = FakeMedia.created.find(isMatch)!;
    audio.stopMatchMusic();
    expect(element.paused).toBe(true);
    expect(audio.currentMatchTrack).toBeNull();
    audio.stopMatchMusic();
    expect(element.playCalls).toBe(1);
  });
});

describe('deck themes', () => {
  it('moves the menu soundtrack to the Outbreak cue and back again', async () => {
    vi.useFakeTimers();
    stubAudio();
    const audio = startedEngine();
    audio.setMusicVolume(0.5);
    audio.playMenuMusic();
    await Promise.resolve();
    vi.advanceTimersByTime(1600);
    const menu = FakeMedia.created.find((el) => el.src === MAIN_THEME_SRC)!;
    expect(menu.paused).toBe(false);

    audio.setMenuTheme(OUTBREAK_MENU_THEME_SRC);
    await Promise.resolve();
    expect(menu.src).toBe(OUTBREAK_MENU_THEME_SRC);
    expect(menu.paused).toBe(false);

    audio.setMenuTheme(MAIN_THEME_SRC);
    await Promise.resolve();
    expect(menu.src).toBe(MAIN_THEME_SRC);
    // One element, one deck theme: nothing was layered on top.
    expect(FakeMedia.created.filter((el) => el.src === OUTBREAK_MENU_THEME_SRC)).toHaveLength(
      0,
    );
    audio.stopMenuMusic();
    vi.advanceTimersByTime(1000);
  });

  it('remembers a route chosen before the first gesture creates the element', () => {
    stubAudio();
    const audio = new AudioEngine();
    audio.setMenuTheme(OUTBREAK_MENU_THEME_SRC);
    audio.playMenuMusic();
    expect(FakeMedia.created.some((el) => el.src === OUTBREAK_MENU_THEME_SRC)).toBe(true);
    audio.stopMenuMusic();
  });
});

describe('outbreak score', () => {
  const outbreakSrc = MUSIC_TRACKS.find((track) => track.id === OUTBREAK_MUSIC_TRACK_ID)!.src;

  it('plays the one mode track on repeat and lets nothing take it over', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { preferences: sequential() });
    music.startFixedTrack(OUTBREAK_MUSIC_TRACK_ID);
    expect(output.plays).toEqual([outbreakSrc]);
    expect(music.snapshot.trackId).toBe(OUTBREAK_MUSIC_TRACK_ID);

    output.end();
    expect(output.plays).toEqual([outbreakSrc, outbreakSrc]);

    // The playlist, its next/previous controls and previews are inert while a
    // mode's own score is running.
    music.next();
    music.previous();
    music.preview(MUSIC_TRACK_IDS[0]);
    expect(output.plays).toEqual([outbreakSrc, outbreakSrc]);

    music.setPreferences({ ...sequential([MUSIC_TRACK_IDS[0]]), shuffle: false });
    expect(output.plays).toEqual([outbreakSrc, outbreakSrc]);
    expect(music.snapshot.trackId).toBe(OUTBREAK_MUSIC_TRACK_ID);
    music.stop();
  });

  it('leaves the battle silent instead of falling back to the playlist', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { preferences: sequential() });
    music.startFixedTrack(OUTBREAK_MUSIC_TRACK_ID);
    output.fail();
    expect(output.plays).toEqual([outbreakSrc]);
    expect(output.active).toBeNull();
    expect(music.snapshot.trackId).toBeNull();
    music.stop();
  });
});
