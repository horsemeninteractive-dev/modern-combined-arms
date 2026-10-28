import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/ui/audio';
import { combatMix, panForOffset, type ListenerGroundFrame } from '../src/ui/audioSpatial';

const listener: ListenerGroundFrame = {
  x: 100,
  z: 100,
  rightX: 1,
  rightZ: 0,
  reach: 50,
};

describe('combat stereo mix', () => {
  it('pans a source left or right of the camera focus', () => {
    const left = combatMix(80, 100, listener, false);
    const right = combatMix(120, 100, listener, false);
    expect(left.pan).toBeLessThan(-0.3);
    expect(right.pan).toBeGreaterThan(0.3);
    expect(left.pan).toBeCloseTo(-right.pan, 5);
  });

  it('keeps sources on the view axis centred', () => {
    expect(combatMix(100, 130, listener, false).pan).toBeCloseTo(0, 6);
    expect(combatMix(100, 70, listener, true).pan).toBeCloseTo(0, 6);
  });

  it('rotates panning with the camera instead of using world X', () => {
    const turned: ListenerGroundFrame = { ...listener, rightX: 0, rightZ: 1 };
    expect(combatMix(100, 130, turned, false).pan).toBeGreaterThan(0.3);
    expect(combatMix(130, 100, turned, false).pan).toBeCloseTo(0, 6);
  });

  it('clamps the pan and never hard-pans a cue', () => {
    expect(panForOffset(10_000, 50)).toBeLessThanOrEqual(0.9);
    expect(panForOffset(-10_000, 50)).toBeGreaterThanOrEqual(-0.9);
    expect(panForOffset(0, 0)).toBe(0);
    expect(panForOffset(Number.NaN, 50)).toBe(0);
  });

  it('attenuates enemy fire without letting panning raise its gain', () => {
    const near = combatMix(110, 100, listener, false);
    const far = combatMix(140, 100, listener, false);
    const beside = combatMix(100, 140, listener, false);
    expect(near.gain).toBeGreaterThan(far.gain);
    // Same distance, different bearing: pan changes, gain does not.
    expect(beside.gain).toBeCloseTo(far.gain, 6);

    expect(near.gain).toBeLessThanOrEqual(0.55);
    expect(far.gain).toBeGreaterThanOrEqual(0.12 * 0.55);
  });

  it('leaves friendly fire at full gain and centres malformed positions', () => {
    expect(combatMix(100, 100, listener, true)).toEqual({ gain: 1, pan: 0 });
    expect(combatMix(Number.NaN, 100, listener, true)).toEqual({ gain: 1, pan: 0 });
    expect(combatMix(Number.NaN, 100, listener, false)).toEqual({ gain: 0.55, pan: 0 });
    expect(combatMix(100, 100, { ...listener, reach: 0 }, true)).toEqual({ gain: 1, pan: 0 });
    expect(combatMix(100, 100, { ...listener, x: Number.NaN }, false)).toEqual({ gain: 0.55, pan: 0 });
  });
});

class FakeParam {
  value = 0;
  setValueAtTime(value: number): void {
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number): void {
    this.value = value;
  }
  setTargetAtTime(value: number): void {
    this.value = value;
  }
}

class FakeNode {
  readonly connections: FakeNode[] = [];
  disconnected = false;
  connect(node: FakeNode): FakeNode {
    this.connections.push(node);
    return node;
  }
  disconnect(): void {
    this.connections.length = 0;
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  start(): void {}
  stop(): void {}
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam();
  start(): void {}
  stop(): void {}
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam();
}

class FakePanner extends FakeNode {
  readonly pan = new FakeParam();
}

const panners: FakePanner[] = [];

class FakeContext {
  readonly destination = new FakeNode();
  readonly currentTime = 0;
  readonly sampleRate = 8000;
  readonly state = 'running';
  createGain(): FakeGain {
    return new FakeGain();
  }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource(): FakeSource {
    return new FakeSource();
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator();
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter();
  }
  createStereoPanner(): FakePanner {
    const panner = new FakePanner();
    panners.push(panner);
    return panner;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

class MonoContext extends FakeContext {
  override createStereoPanner = undefined as unknown as () => FakePanner;
}

function installAudioContext(Ctor: typeof FakeContext): void {
  vi.stubGlobal('window', {
    AudioContext: Ctor,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

describe('AudioEngine stereo placement', () => {
  afterEach(() => {
    panners.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('routes a positioned cue through a panner with the requested side', () => {
    vi.useFakeTimers();
    installAudioContext(FakeContext);
    const audio = new AudioEngine();
    audio.init();
    // Fake timers start performance.now() at zero; step past the per-cue gap.
    vi.advanceTimersByTime(1000);
    audio.play('rifle', 0.8, -0.6);
    audio.play('cannon', 0.9, 0.45);

    expect(panners).toHaveLength(2);
    expect(panners[0].pan.value).toBeCloseTo(-0.6, 5);
    expect(panners[1].pan.value).toBeCloseTo(0.45, 5);
  });

  it('keeps centred cues on the direct sfx path', () => {
    vi.useFakeTimers();
    installAudioContext(FakeContext);
    const audio = new AudioEngine();
    audio.init();
    vi.advanceTimersByTime(1000);
    audio.play('ui');
    audio.play('queue', 1, 0);
    audio.play('rifle', 1, Number.NaN);
    expect(panners).toHaveLength(0);
  });

  it('still plays a mono cue when StereoPannerNode is unavailable', () => {
    vi.useFakeTimers();
    installAudioContext(MonoContext);
    const audio = new AudioEngine();
    audio.init();
    vi.advanceTimersByTime(1000);
    expect(() => audio.play('rifle', 1, -0.8)).not.toThrow();
    expect(panners).toHaveLength(0);
  });

  it('preserves mute and the effects-volume path', () => {
    vi.useFakeTimers();
    installAudioContext(FakeContext);
    const audio = new AudioEngine();
    audio.init();
    vi.advanceTimersByTime(1000);
    audio.setVolumes(0.7, 0.25, 0.3);
    const sfx = (audio as unknown as { sfx: FakeGain }).sfx;
    expect(sfx.gain.value).toBeCloseTo(0.25, 5);

    audio.play('rifle', 1, 0.5);
    expect(panners).toHaveLength(1);
    expect(panners[0].connections[0]).toBe(sfx);

    audio.setMuted(true);
    expect((audio as unknown as { master: FakeGain }).master.gain.value).toBe(0);
    audio.play('cannon', 1, -0.5);
    expect(panners).toHaveLength(1);
  });

  it('disconnects the short-lived panner and clears it on dispose', () => {
    vi.useFakeTimers();
    installAudioContext(FakeContext);
    const audio = new AudioEngine();
    audio.init();
    vi.advanceTimersByTime(1000);
    audio.play('explosion', 1, 0.7);
    expect(panners[0].disconnected).toBe(false);
    vi.advanceTimersByTime(1600);
    expect(panners[0].disconnected).toBe(true);

    audio.play('cannon', 1, -0.7);
    expect(panners).toHaveLength(2);
    audio.dispose();
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
  });
});
