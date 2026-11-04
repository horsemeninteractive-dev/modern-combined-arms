import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/ui/audio';
import { MAIN_THEME_SRC } from '../src/ui/musicCatalogue';

/**
 * The theme is a streamed audio element, not synthesis, so it can be exercised
 * without a Web Audio context: stand a fake element in for `Audio` and drive the
 * fades with fake timers.
 */
class FakeAudio {
  src: string;
  loop = false;
  preload = '';
  volume = 1;
  paused = true;
  playCalls = 0;
  constructor(src?: string) {
    this.src = src ?? '';
  }
  play(): Promise<void> {
    this.playCalls++;
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

function stubAudio(): FakeAudio[] {
  const created: FakeAudio[] = [];
  class Constructed extends FakeAudio {
    constructor(src?: string) {
      super(src);
      created.push(this);
    }
  }
  vi.stubGlobal('Audio', Constructed);
  return created;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('menu music', () => {
  it('streams and loops the authored theme at the music volume', async () => {
    vi.useFakeTimers();
    const created = stubAudio();
    const audio = new AudioEngine();
    audio.setMusicVolume(0.5);
    audio.playMenuMusic();

    expect(created).toHaveLength(1);
    expect(created[0].src).toBe(MAIN_THEME_SRC);
    expect(created[0].loop).toBe(true);
    expect(created[0].playCalls).toBe(1);

    // The fade starts silently and reaches the configured volume.
    expect(created[0].volume).toBe(0);
    await Promise.resolve();
    vi.advanceTimersByTime(1600);
    expect(created[0].volume).toBeCloseTo(0.5, 2);
    expect(created[0].paused).toBe(false);
  });

  it('fades out and pauses away from the menu, then resumes when raised', async () => {
    vi.useFakeTimers();
    const created = stubAudio();
    const audio = new AudioEngine();
    audio.setMusicVolume(0.6);
    audio.playMenuMusic();
    await Promise.resolve();
    vi.advanceTimersByTime(1600);

    audio.stopMenuMusic();
    vi.advanceTimersByTime(1000);
    expect(created[0].paused).toBe(true);
    expect(created[0].volume).toBe(0);

    // Returning to the menu resumes the track at the current volume.
    audio.setMusicVolume(0.4);
    audio.playMenuMusic();
    await Promise.resolve();
    expect(created[0].playCalls).toBe(2);
    vi.advanceTimersByTime(400);
    expect(created[0].paused).toBe(false);
    expect(created[0].volume).toBeGreaterThan(0);
  });

  it('keeps the theme silent at a zero music volume and never creates it twice', async () => {
    vi.useFakeTimers();
    const created = stubAudio();
    const audio = new AudioEngine();
    audio.setMusicVolume(0);
    audio.playMenuMusic();
    await Promise.resolve();
    vi.advanceTimersByTime(1600);
    expect(created[0].volume).toBe(0);
    expect(created[0].paused).toBe(true);

    audio.playMenuMusic();
    expect(created).toHaveLength(1);
  });
});
