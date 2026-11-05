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
  linearRampToValueAtTime(value: number): void {
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
  readonly playbackRate = new FakeParam();
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
const sources: FakeSource[] = [];
const oscillators: FakeOscillator[] = [];

class FakeContext {
  readonly destination = new FakeNode();
  readonly currentTime = 0;
  readonly sampleRate = 8000;
  readonly state = 'running';
  createGain(): FakeGain {
    return new FakeGain();
  }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    // One array per buffer: a loop prepared here is read back by the test.
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    sources.push(source);
    return source;
  }
  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    oscillators.push(osc);
    return osc;
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

type BedPlan = Parameters<AudioEngine['updateAmbience']>[0];

function hull(kind: 'trackedHeavy' | 'foot', motion: number, id = 3): BedPlan {
  return [{ id, kind, gain: 0.8, pan: 0.2, pitch: 0.9, muffle: 0.1, motion }];
}

describe('engine spool', () => {
  afterEach(() => {
    panners.length = 0;
    sources.length = 0;
    oscillators.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('catches when a hull takes up travel and winds down when it stops', () => {
    vi.useFakeTimers();
    installAudioContext(FakeContext);
    const audio = new AudioEngine();
    audio.init();
    vi.advanceTimersByTime(1000);
    const ctx = (audio as unknown as { ctx: FakeContext }).ctx;
    // Every spool builds its own oscillator, so this counts the effects that
    // are not part of the steady loop.
    let created = 0;
    const original = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      created += 1;
      return original();
    };

    audio.updateAmbience(hull('trackedHeavy', 0));
    const parked = created;
    audio.updateAmbience(hull('trackedHeavy', 1));
    expect(created).toBeGreaterThan(parked);

    // A hull already rolling does not stack swells frame after frame.
    const rolling = created;
    audio.updateAmbience(hull('trackedHeavy', 1));
    expect(created).toBe(rolling);

    vi.advanceTimersByTime(600);
    audio.updateAmbience(hull('trackedHeavy', 0));
    expect(created).toBeGreaterThan(rolling);
  });

  it('keeps the wind-down after a short hop', () => {
    vi.useFakeTimers();
    installAudioContext(FakeContext);
    const audio = new AudioEngine();
    audio.init();
    vi.advanceTimersByTime(1000);
    const ctx = (audio as unknown as { ctx: FakeContext }).ctx;
    let created = 0;
    const original = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      created += 1;
      return original();
    };
    audio.updateAmbience(hull('trackedHeavy', 0));
    audio.updateAmbience(hull('trackedHeavy', 1));
    const caught = created;
    // A hull ordered to stop 400ms after it set off still gets its tail: the
    // two directions are throttled separately.
    vi.advanceTimersByTime(400);
    audio.updateAmbience(hull('trackedHeavy', 0));
    expect(created).toBeGreaterThan(caught);
  });

  it('gives the swell the hull’s own side of the frame', () => {
    vi.useFakeTimers();
    installAudioContext(FakeContext);
    const audio = new AudioEngine();
    audio.init();
    vi.advanceTimersByTime(1000);
    const before = panners.length;
    // The first frame only adopts the loop; the catch follows on the next one.
    audio.updateAmbience([{ id: 9, kind: 'trackedLight', gain: 0.7, pan: -0.55, pitch: 1, muffle: 0, motion: 0 }]);
    expect(panners.length).toBe(before + 1);
    audio.updateAmbience([{ id: 9, kind: 'trackedLight', gain: 0.7, pan: -0.55, pitch: 1, muffle: 0, motion: 1 }]);
    // One panner for the loop, one for the catch.
    expect(panners.length).toBe(before + 2);
    expect(panners[panners.length - 1].pan.value).toBeCloseTo(-0.55, 5);
  });

  it('leaves infantry and structures without a spool', () => {
    vi.useFakeTimers();
    installAudioContext(FakeContext);
    const audio = new AudioEngine();
    audio.init();
    vi.advanceTimersByTime(1000);
    const ctx = (audio as unknown as { ctx: FakeContext }).ctx;
    let created = 0;
    const original = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      created += 1;
      return original();
    };

    audio.updateAmbience(hull('foot', 0, 4));
    const parked = created;
    audio.updateAmbience(hull('foot', 1, 4));
    expect(created).toBe(parked);

    audio.updateAmbience([{ id: 5, kind: 'facility', gain: 0.5, pan: 0, pitch: 1.18, muffle: 0, motion: 0 }]);
    const plant = created;
    audio.updateAmbience([{ id: 5, kind: 'facility', gain: 0.5, pan: 0, pitch: 1.18, muffle: 0, motion: 1 }]);
    expect(created).toBe(plant);
  });
});

describe('AudioEngine stereo placement', () => {
  afterEach(() => {
    panners.length = 0;
    sources.length = 0;
    oscillators.length = 0;
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

/** A decoded recording, as the engine stores it once the file has arrived. */
function fakeBuffer(seconds = 1): AudioBuffer {
  const frames = Math.floor(8000 * seconds);
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) data[i] = Math.sin(i / 20) * 0.4;
  return {
    length: frames,
    numberOfChannels: 1,
    sampleRate: 8000,
    duration: seconds,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

type EngineInternals = {
  ctx: FakeContext;
  ambienceSamples: Map<string, { buffer: AudioBuffer; trim: number; idleRate: number; moveRate: number }>;
};

describe('recorded ambience', () => {
  afterEach(() => {
    panners.length = 0;
    sources.length = 0;
    oscillators.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function engineWith(samples: Record<string, { idleRate: number; moveRate: number }>): {
    audio: AudioEngine;
    internals: EngineInternals;
  } {
    installAudioContext(FakeContext);
    const audio = new AudioEngine();
    audio.init();
    const internals = audio as unknown as EngineInternals;
    for (const [kind, rates] of Object.entries(samples)) {
      internals.ambienceSamples.set(kind, {
        buffer: fakeBuffer(),
        trim: 1,
        idleRate: rates.idleRate,
        moveRate: rates.moveRate,
      });
    }
    return { audio, internals };
  }

  it('plays a family’s recording instead of building an oscillator for it', () => {
    const { audio, internals } = engineWith({ trackedHeavy: { idleRate: 0.9, moveRate: 1.1 } });
    const before = { sources: sources.length, oscillators: oscillators.length };
    audio.updateAmbience(hull('trackedHeavy', 1));
    const adopted = sources.slice(before.sources).filter((source) => source.loop);
    expect(adopted).toHaveLength(1);
    expect(adopted[0].buffer).toBe(internals.ambienceSamples.get('trackedHeavy')!.buffer);
    // A recording is the machinery: no oscillator, no noise layer, no clatter.
    expect(oscillators).toHaveLength(before.oscillators);
  });

  it('stretches the recording with motion instead of only filtering it', () => {
    const { audio } = engineWith({ buggy: { idleRate: 0.8, moveRate: 1.2 } });
    audio.updateAmbience([{ id: 4, kind: 'buggy', gain: 0.7, pan: 0, pitch: 1, muffle: 0, motion: 0 }]);
    const source = sources.filter((entry) => entry.loop).at(-1)!;
    const parked = source.playbackRate.value;
    audio.updateAmbience([{ id: 4, kind: 'buggy', gain: 0.7, pan: 0, pitch: 1, muffle: 0, motion: 1 }]);
    expect(source.playbackRate.value).toBeCloseTo(1.2, 4);
    expect(source.playbackRate.value).toBeGreaterThan(parked);
  });

  it('gives a recorded hull its catch by ramping the file’s own rate', () => {
    const { audio } = engineWith({ trackedHeavy: { idleRate: 0.9, moveRate: 1.1 } });
    audio.updateAmbience(hull('trackedHeavy', 0));
    const source = sources.filter((entry) => entry.loop).at(-1)!;
    const ramp = vi.spyOn(source.playbackRate, 'linearRampToValueAtTime');
    audio.updateAmbience(hull('trackedHeavy', 1));
    // The settled rate is where the catch lands: a swell, not a jump.
    expect(ramp).toHaveBeenCalled();
    expect(ramp.mock.calls[0][0]).toBeCloseTo(0.9 * 1.1, 3);
  });

  it('keeps synthesising a family that has no recording', () => {
    const { audio } = engineWith({ trackedHeavy: { idleRate: 0.9, moveRate: 1.1 } });
    const before = oscillators.length;
    audio.updateAmbience([{ id: 9, kind: 'jet', gain: 0.6, pan: 0, pitch: 1, muffle: 0, motion: 0.8 }]);
    expect(oscillators.length).toBeGreaterThan(before);
  });

  it('folds the loop seam forward instead of jumping back a window', () => {
    installAudioContext(FakeContext);
    const audio = new AudioEngine();
    audio.init();
    const internals = audio as unknown as { ctx: FakeContext; prepareAmbienceLoop: (ctx: FakeContext, b: unknown) => { getChannelData: (n: number) => Float32Array } };
    const frames = 8000;
    // A tone whose length is not a whole number of cycles: the worst case for a
    // recording that was never looped in an editor.
    const data = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) data[i] = Math.sin(i * 0.0137) * 0.5;
    const source = {
      length: frames,
      numberOfChannels: 1,
      sampleRate: 8000,
      duration: frames / 8000,
      getChannelData: () => data,
    };
    const rawJump = Math.abs(data[frames - 1] - data[0]);

    const looped = internals.prepareAmbienceLoop(internals.ctx, source);
    const out = looped.getChannelData(0);
    // The seam is taken out of the length, not blended over it.
    expect(out.length).toBeLessThan(frames);
    let step = 0;
    for (let i = 1; i < out.length; i += 1) step += Math.abs(out[i] - out[i - 1]);
    const typical = step / (out.length - 1);
    const join = Math.abs(out[out.length - 1] - out[0]);
    // The join carries on at the recording's own pace instead of restarting it.
    expect(join).toBeLessThan(typical * 3);
    expect(join).toBeLessThan(rawJump);
  });

  it('rebuilds a recorded slot handed to another recorded family', () => {
    const { audio } = engineWith({
      trackedHeavy: { idleRate: 0.9, moveRate: 1.1 },
      buggy: { idleRate: 0.8, moveRate: 1.2 },
    });
    type VoiceInternals = {
      bedVoices: Array<{ kind: string; id: number; sample: FakeSource | null }>;
      retuneBedVoice: (v: unknown, kind: string, id: number) => { sample: FakeSource | null; kind: string; id: number };
    };
    const internals = audio as unknown as VoiceInternals;
    audio.updateAmbience(hull('trackedHeavy', 0.6));
    const voice = internals.bedVoices.find((entry) => entry.kind === 'trackedHeavy')!;
    const source = voice.sample!;
    // A buffer source takes its buffer once, so handing the slot to a family
    // with its own file has to mean new machinery.
    const retune = internals.retuneBedVoice.bind(audio);
    const rebuilt = retune(voice, 'buggy', 12);
    expect(rebuilt.sample).not.toBe(source);
    expect(source.disconnected).toBe(true);
    expect(rebuilt.kind).toBe('buggy');
    expect(rebuilt.id).toBe(12);
    // The slot keeps its place in the pool rather than growing it.
    expect(internals.bedVoices).toHaveLength(1);
  });

  it('rebuilds a slot that is already sounding when its recording arrives', () => {
    installAudioContext(FakeContext);
    const audio = new AudioEngine();
    audio.init();
    // The hull starts while the files are still on the wire.
    audio.updateAmbience(hull('trackedHeavy', 0.7));
    const internals = audio as unknown as EngineInternals;
    internals.ambienceSamples.set('trackedHeavy', {
      buffer: fakeBuffer(),
      trim: 1,
      idleRate: 0.9,
      moveRate: 1.1,
    });
    const beat = { sources: sources.length, oscillators: oscillators.length };
    audio.updateAmbience(hull('trackedHeavy', 0.7));
    expect(sources.slice(beat.sources).some((entry) => entry.loop)).toBe(true);
    expect(oscillators).toHaveLength(beat.oscillators);
  });
});
