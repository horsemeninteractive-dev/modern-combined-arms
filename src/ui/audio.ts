/**
 * All audio is synthesised at runtime, so the slice ships with no external
 * asset dependency. Critical events always have a visual equivalent in the HUD.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambient: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private started = false;
  private lastPlayed = new Map<string, number>();
  masterVolume = 0.7;
  sfxVolume = 0.8;
  ambientVolume = 0.35;
  muted = false;

  init(): void {
    if (this.started) {
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.ambient = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfx.connect(this.master);
      this.ambient.connect(this.master);
      this.master.gain.value = this.muted ? 0 : this.masterVolume;
      this.sfx.gain.value = this.sfxVolume;
      this.ambient.gain.value = this.ambientVolume * 0.4;
      const length = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
      this.started = true;
      this.startAmbience();
    } catch {
      this.started = false;
    }
  }

  private startAmbience(): void {
    if (!this.ctx || !this.ambient || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 360;
    const gain = ctx.createGain();
    gain.gain.value = 0.16;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambient);
    source.start();
    lfo.start();
    // A faint, slow drone keeps the battlefield from feeling silent.
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 48;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.035;
    drone.connect(droneGain);
    droneGain.connect(this.ambient);
    drone.start();
    const drone2 = ctx.createOscillator();
    drone2.type = 'triangle';
    drone2.frequency.value = 72.5;
    const drone2Gain = ctx.createGain();
    drone2Gain.gain.value = 0.012;
    drone2.connect(drone2Gain);
    drone2Gain.connect(this.ambient);
    drone2.start();
  }

  setVolumes(master: number, sfx: number, ambient: number): void {
    this.masterVolume = master;
    this.sfxVolume = sfx;
    this.ambientVolume = ambient;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : master, this.ctx.currentTime, 0.05);
    if (this.sfx && this.ctx) this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    if (this.ambient && this.ctx) this.ambient.gain.setTargetAtTime(ambient * 0.4, this.ctx.currentTime, 0.05);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : this.masterVolume, this.ctx.currentTime, 0.05);
  }

  private tone(freq: number, duration: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    if (!this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g);
    g.connect(this.sfx);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private noise(duration: number, gain: number, lowpass: number, delay = 0): void {
    if (!this.ctx || !this.sfx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(lowpass, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, lowpass * 0.25), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfx);
    src.start(t);
    src.stop(t + duration + 0.03);
  }

  play(name: string): void {
    if (!this.started || this.muted) return;
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? 0;
    const minGap = name === 'rifle' ? 55 : name === 'cannon' ? 70 : name === 'explosion' ? 60 : 35;
    if (now - last < minGap) return;
    this.lastPlayed.set(name, now);
    switch (name) {
      case 'rifle':
        this.noise(0.07, 0.14, 2600);
        this.tone(180, 0.05, 'square', 0.03, 90);
        break;
      case 'cannon':
        this.noise(0.22, 0.32, 900);
        this.tone(80, 0.25, 'sine', 0.16, 42);
        break;
      case 'missile':
        this.noise(0.35, 0.18, 1400);
        this.tone(220, 0.28, 'sawtooth', 0.05, 900);
        break;
      case 'sam':
        this.noise(0.22, 0.14, 2400);
        this.tone(420, 0.25, 'sawtooth', 0.04, 1300);
        break;
      case 'explosion':
        this.noise(0.55, 0.4, 620);
        this.tone(55, 0.5, 'sine', 0.22, 28);
        break;
      case 'impact':
        this.noise(0.12, 0.12, 2200);
        break;
      case 'ui':
        this.tone(1200, 0.03, 'square', 0.02, 900);
        break;
      case 'queue':
        this.tone(720, 0.05, 'triangle', 0.025, 960);
        break;
      case 'denied':
        this.tone(220, 0.08, 'square', 0.035, 160);
        this.tone(165, 0.09, 'square', 0.025, 130, 0.08);
        break;
      case 'alert':
        this.tone(660, 0.08, 'triangle', 0.04, 660);
        this.tone(880, 0.08, 'triangle', 0.025, 880, 0.1);
        break;
      case 'build':
        this.tone(320, 0.12, 'triangle', 0.02, 420);
        break;
      case 'complete':
        this.tone(440, 0.1, 'triangle', 0.03, 440);
        this.tone(660, 0.12, 'triangle', 0.03, 660, 0.1);
        this.tone(880, 0.18, 'triangle', 0.025, 880, 0.2);
        break;
      case 'ready':
        this.tone(540, 0.08, 'sine', 0.03, 760);
        break;
      case 'capture':
        for (let i = 0; i < 4; i++) this.tone(420 + i * 140, 0.12, 'triangle', 0.025, undefined, i * 0.07);
        break;
      case 'deposit':
        this.tone(520, 0.05, 'triangle', 0.02, 620);
        break;
      case 'land':
        this.noise(0.4, 0.1, 800);
        this.tone(110, 0.3, 'triangle', 0.03, 70);
        break;
      case 'start':
        this.tone(180, 0.5, 'sine', 0.05, 240);
        this.tone(270, 0.7, 'sine', 0.025, 320, 0.12);
        break;
      case 'victory':
        this.tone(392, 0.4, 'triangle', 0.04, 392);
        this.tone(523, 0.5, 'triangle', 0.04, 523, 0.16);
        this.tone(659, 0.7, 'triangle', 0.035, 659, 0.32);
        break;
      case 'defeat':
        this.tone(220, 0.5, 'sine', 0.05, 110);
        this.tone(165, 0.7, 'sine', 0.035, 82, 0.15);
        break;
      default:
        this.tone(600, 0.04, 'triangle', 0.02);
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
