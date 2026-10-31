import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/ui/audio';
import {
  MATCH_TRACKS,
  MatchMusic,
  type MatchMusicOutput,
} from '../src/ui/matchMusic';

class FakeOutput implements MatchMusicOutput {
  plays: string[] = [];
  stops = 0;
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('match soundtrack rotation', () => {
  it('registers all three authored tracks and only those tracks', () => {
    expect(MATCH_TRACKS).toEqual([
      '/audio/in-game-theme1.mp3',
      '/audio/in-game-theme2.mp3',
      '/audio/in-game-theme3.mp3',
    ]);
    for (const path of MATCH_TRACKS) {
      expect(existsSync(new URL(`../public${path}`, import.meta.url))).toBe(true);
    }
  });

  it('does not put a partial media response in the runtime cache', () => {
    const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
    expect(sw).toContain('response.status === 206');
  });

  it('starts once and ignores duplicate lifecycle notifications', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { random: () => 0 });
    music.start();
    music.start();
    expect(output.plays).toHaveLength(1);
    expect(music.running).toBe(true);
  });

  it('advances on completion and never repeats a track back-to-back', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { random: () => 0 });
    music.start();
    for (let i = 0; i < 12; i++) output.end();

    expect(output.plays).toHaveLength(13);
    const firstCycle = output.plays.slice(0, 3);
    expect(new Set(firstCycle).size).toBe(3);
    for (let i = 1; i < output.plays.length; i++) {
      expect(output.plays[i]).not.toBe(output.plays[i - 1]);
    }
    // Every track remains eligible after repeated cycles.
    for (const track of MATCH_TRACKS) {
      expect(output.plays.filter((p) => p === track).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('randomises the opening order between matches', () => {
    const first = new FakeOutput();
    const second = new FakeOutput();
    new MatchMusic(first, { random: () => 0 }).start();
    new MatchMusic(second, { random: () => 0.999 }).start();
    expect(first.plays[0]).not.toBe(second.plays[0]);
  });

  it('does not start a new cycle with the track that just finished', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { random: () => 0.999 });
    music.start();
    for (let i = 0; i < 2; i++) output.end();
    output.end();
    const firstCycle = output.plays.slice(0, 3);
    expect(new Set(firstCycle).size).toBe(3);
    // Fourth selection is the next match cycle opening, not a repeat of #3.
    expect(output.plays[3]).not.toBe(output.plays[2]);
  });

  it('ignores duplicate callbacks from a track that already finished', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { random: () => 0.999 });
    music.start();
    const first = output.pending!;
    first.onEnded();
    expect(output.plays).toHaveLength(2);
    first.onEnded();
    first.onError();
    expect(output.plays).toHaveLength(2);
    expect(output.active).toBe(output.plays[1]);
    expect(music.running).toBe(true);
  });

  it('skips a failed track and never retries it in a loop', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { random: () => 0.999 });
    music.start();
    expect(output.plays).toHaveLength(1);
    output.fail();
    expect(output.plays).toHaveLength(2);
    expect(music.running).toBe(true);
    expect(output.plays[1]).not.toBe(output.plays[0]);
  });

  it('stops safely when every track is unavailable', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { random: () => 0.999 });
    music.start();
    output.fail();
    output.fail();
    output.fail();
    expect(output.plays).toHaveLength(3);
    expect(music.running).toBe(false);
    expect(music.currentTrack).toBeNull();
  });

  it('ignores late completion after stop and restarts without overlap', () => {
    const output = new FakeOutput();
    const music = new MatchMusic(output, { random: () => 0 });
    music.start();
    const stale = output.pending!;
    music.stop();
    expect(output.stops).toBe(1);
    expect(music.running).toBe(false);
    expect(music.currentTrack).toBeNull();
    // A completion that was already queued when the match ended is stale.
    stale.onEnded();
    stale.onError();
    expect(output.plays).toHaveLength(1);

    music.start();
    expect(output.plays).toHaveLength(2);
    expect(output.active).toBe(output.plays[1]);
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

describe('match soundtrack playback', () => {
  it('starts one media track and reuses the element across transitions', async () => {
    stubAudio();
    const audio = startedEngine();
    audio.setMusicVolume(0.5);
    audio.startMatchMusic();
    const element = FakeMedia.created.find((el) => el.src.includes('in-game-theme'))!;
    expect(element).toBeDefined();
    expect(element.playCalls).toBe(1);
    expect(element.volume).toBeCloseTo(0.5, 5);
    expect(element.loop).toBe(false);

    const first = element.src;
    element.onended?.();
    expect(element.playCalls).toBe(2);
    expect(element.src).not.toBe(first);
    expect(FakeMedia.created.filter((el) => el.src.includes('in-game-theme'))).toHaveLength(1);
    audio.stopMatchMusic();
    expect(element.paused).toBe(true);
    expect(element.src).toBe('');
  });

  it('starts only once despite duplicate match notifications', () => {
    stubAudio();
    const audio = startedEngine();
    audio.startMatchMusic();
    audio.startMatchMusic();
    const elements = FakeMedia.created.filter((el) => el.src.includes('in-game-theme'));
    expect(elements).toHaveLength(1);
    expect(elements[0].playCalls).toBe(1);
    audio.stopMatchMusic();
  });

  it('skips a broken track and continues with another', () => {
    stubAudio();
    const audio = startedEngine();
    audio.startMatchMusic();
    const element = FakeMedia.created.find((el) => el.src.includes('in-game-theme'))!;
    const broken = element.src;
    element.onerror?.();
    expect(element.src).not.toBe(broken);
    expect(element.playCalls).toBe(2);
    expect(FakeMedia.created.filter((el) => el.src.includes('in-game-theme'))).toHaveLength(1);
    audio.stopMatchMusic();
  });

  it('applies music volume and mute to the active track immediately', () => {
    stubAudio();
    const audio = startedEngine();
    audio.setMusicVolume(0.6);
    audio.startMatchMusic();
    const element = FakeMedia.created.find((el) => el.src.includes('in-game-theme'))!;
    expect(element.volume).toBeCloseTo(0.6, 5);

    audio.setMusicVolume(0.2);
    expect(element.volume).toBeCloseTo(0.2, 5);
    audio.setMuted(true);
    expect(element.volume).toBe(0);
    audio.setMuted(false);
    expect(element.volume).toBeCloseTo(0.2, 5);
    audio.stopMatchMusic();
  });

  it('ducks the track for a voice line and restores it without restarting', async () => {
    vi.useFakeTimers();
    stubAudio();
    const audio = startedEngine();
    audio.setMusicVolume(0.5);
    audio.startMatchMusic();
    const match = FakeMedia.created.find((el) => el.src.includes('in-game-theme'))!;
    expect(match.playCalls).toBe(1);

    audio.announce('victory');
    const voice = FakeMedia.created.find((el) => el.src.includes('/audio/battlesys/'))!;
    expect(voice).toBeDefined();
    vi.advanceTimersByTime(250);
    expect(match.volume).toBeCloseTo(0.5 * 0.32, 4);
    expect(match.playCalls).toBe(1);

    voice.emit('ended');
    vi.advanceTimersByTime(250);
    expect(match.volume).toBeCloseTo(0.5, 4);
    expect(match.playCalls).toBe(1);
    expect(match.paused).toBe(false);
    audio.stopMatchMusic();
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
    const element = FakeMedia.created.find((el) => el.src.includes('in-game-theme'))!;
    await Promise.resolve();
    await Promise.resolve();
    expect(element.playCalls).toBe(1);
    expect(handlers.has('pointerdown')).toBe(true);
    expect(handlers.has('keydown')).toBe(true);

    // No frame or timer retry: only a real interaction asks again.
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(element.playCalls).toBe(1);

    handlers.get('pointerdown')?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(element.playCalls).toBe(2);
    // Another refusal re-arms a single gesture retry rather than looping.
    expect(handlers.has('pointerdown')).toBe(true);

    audio.stopMatchMusic();
    expect(handlers.size).toBe(0);
  });

  it('is wired into match start, load, end and exit lifecycle points', () => {
    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    // Three entry points start match music: a local battle, a networked battle
    // handed over by the lobby, and resuming a paused battle.
    expect(app.match(/this\.audio\.startMatchMusic\(\)/g)).toHaveLength(3);
    expect(app.match(/this\.audio\.stopMatchMusic\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    const start = app.slice(app.indexOf('async startBattle'), app.indexOf('async restart'));
    expect(start).toContain('this.audio.stopMatchMusic()');
    expect(start).toContain('this.audio.startMatchMusic()');
    const victory = app.slice(app.indexOf('private checkVictory'), app.indexOf('private hudSignatureOf'));
    expect(victory).toContain('this.audio.stopMatchMusic()');
    const menu = app.slice(app.indexOf('private showMenu'), app.indexOf('async startBattle'));
    expect(menu).toContain('this.audio.stopMatchMusic()');
    const load = app.slice(app.indexOf('loadFromSlot'), app.indexOf('private pauseForModal'));
    expect(load).toContain('this.audio.startMatchMusic()');
    expect(load).toContain('this.audio.stopMatchMusic()');
    const network = app.slice(
      app.indexOf('private startNetworkBattle'),
      app.indexOf('private dispatchCommand'),
    );
    expect(network).toContain('this.audio.startMatchMusic()');
    expect(network).toContain('this.audio.stopMenuMusic()');
  });

  it('applies global mute to the menu theme as well as match music', async () => {
    vi.useFakeTimers();
    stubAudio();
    const audio = startedEngine();
    audio.setMusicVolume(0.5);
    audio.playMenuMusic();
    await Promise.resolve();
    vi.advanceTimersByTime(1600);
    const menu = FakeMedia.created.find((el) => el.src.includes('menu-theme'))!;
    expect(menu.paused).toBe(false);

    audio.setMuted(true);
    vi.advanceTimersByTime(250);
    expect(menu.paused).toBe(true);
    expect(menu.volume).toBe(0);

    audio.setMuted(false);
    await Promise.resolve();
    expect(menu.playCalls).toBe(2);
    vi.advanceTimersByTime(300);
    expect(menu.paused).toBe(false);
    expect(menu.volume).toBeGreaterThan(0);
    audio.stopMenuMusic();
    vi.advanceTimersByTime(1000);
  });

  it('stops music when leaving a match and does not leak into the menu path', () => {
    stubAudio();
    const audio = startedEngine();
    audio.startMatchMusic();
    const element = FakeMedia.created.find((el) => el.src.includes('in-game-theme'))!;
    audio.stopMatchMusic();
    expect(element.paused).toBe(true);
    expect(audio.currentMatchTrack).toBeNull();
    audio.stopMatchMusic();
    expect(element.playCalls).toBe(1);
  });
});
