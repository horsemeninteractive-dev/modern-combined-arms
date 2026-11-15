import { Announcer, type AnnouncementId } from './announcer';
import type { NarratorId } from '../data/narrators';
import { MAX_AMBIENCE_VOICES, type AmbienceKind, type AmbienceVoice } from './ambience';
import {
  AMBIENCE_AUDIO_ROOT,
  LOOP_SEAM_SECONDS,
  MAX_LOOP_SECONDS,
  RECORDED_AMBIENCE_ENABLED,
  loopRate,
  parseAmbienceManifest,
  type AmbienceStepsSpec,
} from './ambienceSamples';
import { MAIN_THEME_SRC } from './musicCatalogue';
import { MatchMusic, type MatchMusicSnapshot } from './matchMusic';
import { UnitVoice, type UnitVoiceCue } from './unitVoice';

/**
 * How one bed voice is built.
 *
 * The oscillator is the machinery, the noise layer the air it moves, and the
 * modulation oscillator whatever makes it uneven: bootfalls, track clatter,
 * rotor chop. A jeep is a bright petrol buzz, a main battle tank a low rumble
 * under heavy links, infantry filtered hiss that pulses with a stride — three
 * different recipes, not one engine transposed.
 */
interface BedRecipe {
  osc: OscillatorType;
  oscFreq: number;
  oscGain: number;
  filterType: BiquadFilterType;
  filterFreq: number;
  noiseGain: number;
  /** Modulation rate in Hz: strides, links or blades. 0 for steady machinery. */
  modHz: number;
  /** Depth of the modulation as a share of the noise layer, 0..1. */
  modDepth: number;
}

const BED_RECIPES: Record<AmbienceKind, BedRecipe> = {
  // Boots: a filtered hiss that pulses, with almost no engine tone at all.
  foot: { osc: 'sine', oscFreq: 120, oscGain: 0.1, filterType: 'bandpass', filterFreq: 780, noiseGain: 0.5, modHz: 2.1, modDepth: 0.95 },
  // Light petrol scout: bright, fast and small.
  buggy: { osc: 'triangle', oscFreq: 108, oscGain: 0.4, filterType: 'bandpass', filterFreq: 1200, noiseGain: 0.34, modHz: 7, modDepth: 0.25 },
  // Laden wheeled hull: heavy diesel, a slow load beat.
  truck: { osc: 'sawtooth', oscFreq: 44, oscGain: 0.55, filterType: 'lowpass', filterFreq: 330, noiseGain: 0.5, modHz: 5.5, modDepth: 0.2 },
  // Light tracks: mid diesel with a fast link clatter on top.
  trackedLight: { osc: 'sawtooth', oscFreq: 62, oscGain: 0.5, filterType: 'lowpass', filterFreq: 430, noiseGain: 0.52, modHz: 9.5, modDepth: 0.3 },
  // Main battle tank: deep, slow and heavy, with slower links.
  trackedHeavy: { osc: 'sawtooth', oscFreq: 37, oscGain: 0.62, filterType: 'lowpass', filterFreq: 200, noiseGain: 0.6, modHz: 6.2, modDepth: 0.22 },
  // A rotor is mostly chopped air: a mid band of noise over a faint turbine.
  rotor: { osc: 'sawtooth', oscFreq: 118, oscGain: 0.16, filterType: 'bandpass', filterFreq: 640, noiseGain: 0.72, modHz: 12, modDepth: 0.5 },
  // Fixed wing: a high turbine whine with a fast shimmer, no clatter.
  jet: { osc: 'sawtooth', oscFreq: 240, oscGain: 0.22, filterType: 'bandpass', filterFreq: 1900, noiseGain: 0.62, modHz: 28, modDepth: 0.12 },
  // Ships: deep diesel through a hull, wash rather than machinery.
  naval: { osc: 'sawtooth', oscFreq: 30, oscGain: 0.6, filterType: 'lowpass', filterFreq: 150, noiseGain: 0.55, modHz: 3.2, modDepth: 0.18 },
  facility: { osc: 'sine', oscFreq: 96, oscGain: 0.5, filterType: 'bandpass', filterFreq: 880, noiseGain: 0.26, modHz: 0, modDepth: 0 },
  // A fuel pump beside a hull on turnaround: a low throb under the wet hiss of
  // fuel moving through the hose, uneven at the pump's own stroke rate.
  servicing: { osc: 'sine', oscFreq: 58, oscGain: 0.5, filterType: 'bandpass', filterFreq: 460, noiseGain: 0.44, modHz: 1.9, modDepth: 0.7 },
};

/** Per-kind trim so one recipe never buries the others in the ambient bus. */
const BED_TRIM: Record<AmbienceKind, number> = {
  foot: 0.3,
  buggy: 0.34,
  truck: 0.48,
  trackedLight: 0.5,
  trackedHeavy: 0.56,
  rotor: 0.4,
  jet: 0.4,
  naval: 0.5,
  // Small machinery, close to the ear: audible over a fuselage's idle without
  // competing with the structures behind it.
  servicing: 0.44,
  // A base's turbine should sit behind the engines crossing it, not over them.
  facility: 0.32,
};

/** What every bed voice owns, however it makes its noise. */
interface BedVoiceBase {
  id: number;
  kind: AmbienceKind;
  gain: GainNode;
  panner: StereoPannerNode | null;
  /** Last gain asked for, used to pick the cheapest loop to retune. */
  gainTarget: number;
  /** Last plan motion, so the engine hears the edge into and out of travel. */
  motion: number;
  /** Wall clocks of the last catch and wind-down, kept apart so a short hop
   * still sounds like one start and one stop instead of losing its tail. */
  lastSpoolUp: number;
  lastSpoolDown: number;
  /**
   * True until the voice has played one frame for its owner. A newly adopted
   * loop fades in from silence on its own, and a camera pan that hands a slot
   * to the next hull must not fire a catch every time it does so.
   */
  fresh: boolean;
}

/** A family the game still synthesises: oscillator, air, clatter. */
interface SynthBedVoice extends BedVoiceBase {
  sample: null;
  osc: OscillatorNode;
  oscGain: GainNode;
  noise: AudioBufferSourceNode;
  noiseGain: GainNode;
  filter: BiquadFilterNode;
  /** Stride / link / blade modulation into the noise layer. */
  mod: OscillatorNode;
  modDepth: GainNode;
}

/**
 * A family with a recording behind it.
 *
 * The recording is the machinery and the filter is the air around it: motion
 * stretches the recording's rate and opens the filter together, and distance
 * closes it, so the same file reads as parked, rolling, near or far.
 */
interface RecordedBedVoice extends BedVoiceBase {
  sample: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  /** Level trim over the family's own bed trim. */
  trim: number;
  /** Rate at rest and under way, before the plan's own pitch. */
  idleRate: number;
  moveRate: number;
  /** Last rate asked for, so a catch can ramp back to the right speed. */
  rate: number;
  /** Context time until which a catch or wind-down owns the rate parameter. */
  spoolUntil: number;
}

type BedVoice = SynthBedVoice | RecordedBedVoice;

/** Lowpass a recorded voice starts from before motion and distance shape it. */
const SAMPLE_FILTER_HZ = 2400;

/**
 * Construction options.
 *
 * `recordedAmbience` selects the recorded bed over the synthesised one. It
 * defaults to {@link RECORDED_AMBIENCE_ENABLED}, which is off; the option exists
 * so the recorded plumbing stays testable while the shipped files are replaced.
 */
export interface AudioEngineOptions {
  recordedAmbience?: boolean;
}

/** A decoded recording, ready to be claimed by a bed slot. */
interface AmbienceSample {
  buffer: AudioBuffer;
  trim: number;
  idleRate: number;
  moveRate: number;
}

/**
 * Weapons, UI and ambience are synthesised at runtime. The menu theme, match
 * soundtrack and strategic voice lines are authored assets. Music streams
 * through a media channel per context, and voice uses one dedicated channel so
 * the announcer can interrupt a lower-priority line without touching the Web
 * Audio graph.
 *
 * The battlefield bed is a small pool of looping voices — engines, working
 * structures — steered once per frame from the app's ambience plan. They live
 * on the ambient bus, so the Ambient volume setting owns them.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  /** Temporary per-cue trim, used to attenuate visible distant combat. */
  private playGain = 1;
  private ambient: GainNode | null = null;
  /** Bed loops are mixed above the wind bed so a close engine reads clearly. */
  private bedBus: GainNode | null = null;
  private bedVoices: BedVoice[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  /** Recorded loops by family; a family absent here stays synthesised. */
  private ambienceSamples = new Map<AmbienceKind, AmbienceSample>();
  /** Whether this engine may play (and fetch) the recorded beds at all. */
  private readonly recordedAmbience: boolean;
  private ambienceLoading = false;
  private ambienceLoaded = false;
  private started = false;
  private lastPlayed = new Map<string, number>();
  /** Per-cue stereo bus; null means the cue is centred straight into sfx. */
  private cueBus: AudioNode | null = null;
  private cueCleanup = new Set<ReturnType<typeof setTimeout>>();
  private music: HTMLAudioElement | null = null;
  private musicWanted = false;
  private musicFade: number | null = null;
  private musicRetryBound = false;
  private voiceElement: HTMLAudioElement | null = null;
  private unitVoiceElement: HTMLAudioElement | null = null;
  private matchElement: HTMLAudioElement | null = null;
  private matchHandlers: { onEnded: () => void; onError: () => void } | null = null;
  private matchFade: number | null = null;
  /** Brief fade-out before a manual track change swaps the source. */
  private matchTransition: ReturnType<typeof setTimeout> | null = null;
  private matchDucked = false;
  private matchRetryHandler: (() => void) | null = null;
  /** A menu theme was faded out for an in-menu audition and should return. */
  private menuPausedForMatch = false;
  private readonly matchMusic: MatchMusic;
  readonly announcer: Announcer;
  readonly unitBarks: UnitVoice;
  masterVolume = 0.7;
  sfxVolume = 0.8;
  ambientVolume = 0.35;
  musicVolume = 0.45;
  voiceVolume = 0.8;
  unitVoiceVolume = 0.7;
  muted = false;

  constructor(options: AudioEngineOptions = {}) {
    this.recordedAmbience = options.recordedAmbience ?? RECORDED_AMBIENCE_ENABLED;
    this.announcer = new Announcer({
      play: (src, done) => this.playVoice(src, done),
      stop: () => this.stopVoice(),
    });
    this.unitBarks = new UnitVoice({
      play: (src, done) => this.playUnitVoice(src, done),
      stop: () => this.stopUnitVoiceElement(),
    });
    this.matchMusic = new MatchMusic({
      playTrack: (src, handlers, options) => this.playMatchTrack(src, handlers, options),
      stop: () => this.stopMatchTrack(),
      pause: () => this.pauseMatchTrack(),
      resume: () => this.resumeMatchTrack(),
    });
  }

  /** Begin the match soundtrack exactly once. */
  startMatchMusic(): void {
    this.matchMusic.start();
  }

  /** Stop and release the match soundtrack; safe to call repeatedly. */
  stopMatchMusic(): void {
    this.matchMusic.stop();
    this.clearMatchRetry();
    this.matchDucked = false;
    if (this.matchFade !== null) {
      clearInterval(this.matchFade);
      this.matchFade = null;
    }
    if (this.matchTransition !== null) {
      clearTimeout(this.matchTransition);
      this.matchTransition = null;
    }
  }

  /** Apply a persisted battle playlist without restarting an eligible track. */
  setMusicPlaylist(preferences: unknown): void {
    this.matchMusic.setPreferences(preferences);
  }

  get matchMusicState(): MatchMusicSnapshot {
    return this.matchMusic.snapshot;
  }

  onMatchMusicChange(listener: () => void): () => void {
    return this.matchMusic.onStateChange(listener);
  }

  /** Audition a track from the settings editor. */
  previewMatchTrack(id: string): void {
    this.matchMusic.preview(id);
  }

  nextMatchTrack(): void {
    this.matchMusic.next();
  }

  previousMatchTrack(): void {
    this.matchMusic.previous();
  }

  toggleMatchPause(): void {
    this.matchMusic.togglePause();
  }

  get currentMatchTrack(): string | null {
    return this.matchMusic.currentTrack;
  }

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
      this.bedBus = this.ctx.createGain();
      // Measured against the cue bus: at 2.2 the bed sat within 3dB of a rifle
      // burst, which buried the guns. 0.5 puts a full bed (a base plus seven
      // hulls in frame) about 12dB under a nearby cannon and 17dB under an
      // explosion; a rifle burst is level with the bed on average but 7dB above
      // it at the transient, so shots read while the machinery stays a bed.
      this.bedBus.gain.value = 0.5;
      this.bedBus.connect(this.ambient);
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
      // Recordings arrive in the background: the bed is already playing, and a
      // family whose file is slow, missing or undecodable simply keeps its
      // synthesised voice. While the switch is off nothing is even fetched, so
      // every family builds the recipe it had before the recordings existed.
      if (this.recordedAmbience) void this.loadAmbienceSamples();
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

  /**
   * Steer the battlefield bed toward this frame's plan.
   *
   * Called from the frame loop, never per cue: each voice is a looping
   * oscillator plus a filtered noise layer, so the whole bed costs a handful of
   * nodes regardless of how many hulls are on the map. A voice that drops out
   * of the plan is faded rather than stopped, which is what lets a tank roll off
   * the edge of frame and back without clicking.
   */
  updateAmbience(plan: readonly AmbienceVoice[]): void {
    const ctx = this.ctx;
    if (!this.started || !ctx || !this.bedBus) return;
    const now = ctx.currentTime;
    const used = new Set<BedVoice>();
    for (const voice of plan) {
      const target = this.bedVoiceFor(voice.kind, voice.id, used);
      if (!target) continue;
      used.add(target);
      const recipe = BED_RECIPES[voice.kind];
      const recorded = target.sample !== null;
      const level =
        Math.max(0, Math.min(1, voice.gain)) *
        BED_TRIM[voice.kind] *
        (recorded ? target.trim : 1);
      target.gainTarget = level;
      target.gain.gain.setTargetAtTime(level, now, 0.16);
      if (target.panner) {
        target.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, voice.pan)), now, 0.16);
      }
      const muffle = Math.max(0, Math.min(1, voice.muffle ?? 0));
      const motion = Math.max(0, Math.min(1, voice.motion ?? 0.5));
      // Motion is audible as timbre: a closed filter and no clatter at rest, an
      // open one and the family's stride, links or blades once under way.
      // Distance then dulls whatever is left, as a far-off engine loses its top.
      const brightness = (0.5 + 0.55 * motion) * (0.85 + 0.2 * voice.pitch) * (1 - 0.55 * muffle);
      if (target.sample) {
        // A recording carries its own detail, so motion stretches its speed
        // rather than only filtering it. A catch owns the rate while it plays.
        target.rate = loopRate(target, motion, voice.pitch);
        if (now >= target.spoolUntil) {
          target.sample.playbackRate.setTargetAtTime(target.rate, now, 0.3);
        }
        target.filter.frequency.setTargetAtTime(SAMPLE_FILTER_HZ * brightness, now, 0.25);
      } else {
        target.osc.frequency.setTargetAtTime(recipe.oscFreq * voice.pitch, now, 0.3);
        target.filter.frequency.setTargetAtTime(recipe.filterFreq * brightness, now, 0.25);
        const rolling = recipe.modHz > 0 && motion > 0.06;
        const modHz = rolling ? recipe.modHz * voice.pitch * (0.6 + 0.5 * motion) : 0.22;
        const modDepthBase = rolling ? recipe.modDepth * motion : 0.16;
        target.mod.frequency.setTargetAtTime(Math.max(0.2, modHz), now, 0.25);
        target.modDepth.gain.setTargetAtTime(
          recipe.noiseGain * modDepthBase * (1 - 0.4 * muffle),
          now,
          0.25,
        );
      }
      // Crossing into and out of travel gets its own short mechanical event: an
      // engine that just applies power catches and swells, and one that stops
      // winds down instead of simply getting quieter.
      const spool = performance.now();
      // Rotors already carry some motion while hovering, so the catch starts
      // from a little higher than a grounded hull's rest state.
      const startsMoving = motion >= 0.5 && target.motion < 0.4;
      const stopsMoving = motion <= 0.2 && target.motion >= 0.5;
      const lastSpool = startsMoving ? target.lastSpoolUp : target.lastSpoolDown;
      if (target.fresh) {
        target.fresh = false;
      } else if (
        (startsMoving || stopsMoving) &&
        // `0` is the never-spooled sentinel, not a real timestamp: the first
        // catch must not depend on how long the page has been running.
        (lastSpool === 0 || spool - lastSpool > 350)
      ) {
        if (startsMoving) target.lastSpoolUp = spool;
        else target.lastSpoolDown = spool;
        if (target.sample) this.spoolSample(target, startsMoving);
        else this.spool(voice.kind, voice.pan, level, startsMoving);
      }
      target.motion = motion;
    }
    for (const voice of this.bedVoices) {
      if (used.has(voice)) continue;
      voice.gainTarget = 0;
      voice.gain.gain.setTargetAtTime(0, now, 0.2);
    }
  }

  /**
   * The swell of an engine taking up load, or the tail of one winding down.
   *
   * Built from the same recipe as the loop it belongs to — same oscillator
   * shape, same filter — so a tank's catch sounds like a tank and a jeep's like
   * a jeep. It is routed through its own panner onto the bed bus, which means
   * it arrives from the hull's position and obeys the Ambient volume. Infantry
   * and structures are silent here: boots and turbines do not spool.
   */
  private spool(kind: AmbienceKind, pan: number, level: number, rising: boolean): void {
    const ctx = this.ctx;
    const bus = this.bedBus;
    if (!ctx || !bus) return;
    if (kind === 'foot' || kind === 'facility' || kind === 'servicing') return;
    const recipe = BED_RECIPES[kind];
    const now = ctx.currentTime;
    const duration = rising ? 0.42 : 0.55;
    const peak = Math.max(0.008, Math.min(0.5, level * 0.85));
    try {
      const osc = ctx.createOscillator();
      osc.type = recipe.osc;
      const fromHz = recipe.oscFreq * (rising ? 0.4 : 1.05);
      const toHz = recipe.oscFreq * (rising ? 1.05 : 0.35);
      osc.frequency.setValueAtTime(fromHz, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(10, toHz), now + duration);
      const oscGain = ctx.createGain();
      oscGain.gain.value = recipe.oscGain * 0.8;
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = recipe.filterType;
      filter.frequency.setValueAtTime(recipe.filterFreq * (rising ? 0.55 : 1.2), now);
      filter.frequency.exponentialRampToValueAtTime(
        recipe.filterFreq * (rising ? 1.7 : 0.45),
        now + duration,
      );
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = recipe.noiseGain * (rising ? 0.8 : 0.45);
      // A fast catch then a tail: the envelope is the swell, not the loop's fade.
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(peak, now + (rising ? 0.09 : 0.04));
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      let panner: StereoPannerNode | null = null;
      if (typeof ctx.createStereoPanner === 'function') {
        panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        panner.connect(bus);
        env.connect(panner);
      } else {
        env.connect(bus);
      }
      osc.connect(oscGain);
      oscGain.connect(env);
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(env);
      osc.start();
      noise.start();
      osc.stop(now + duration + 0.02);
      noise.stop(now + duration + 0.02);
      osc.onended = () => {
        osc.disconnect();
        oscGain.disconnect();
        noise.disconnect();
        filter.disconnect();
        noiseGain.disconnect();
        env.disconnect();
        panner?.disconnect();
      };
    } catch {
      // A context refusing a source simply has no swell.
    }
  }

  /** Silence the bed without tearing its graph down; it fades back in later. */
  stopAmbience(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const voice of this.bedVoices) {
      voice.gainTarget = 0;
      voice.gain.gain.setTargetAtTime(0, now, 0.15);
    }
  }

  /**
   * Claim a loop for one source: its own, a free slot, or the quietest loop
   * this frame has not already asked for. Retuning is cheaper than rebuilding a
   * voice, and at seven slots a busy map is always asking for more than fits.
   */
  private bedVoiceFor(kind: AmbienceKind, id: number, used: Set<BedVoice>): BedVoice | null {
    const existing = this.bedVoices.find((v) => v.id === id && v.kind === kind);
    if (existing) {
      if (this.sampleVoice(existing, kind)) return existing;
      // The family gained a recording while this hull was already sounding, or
      // lost one: the two graphs share no nodes, so the slot is rebuilt rather
      // than retuned. Only ever happens once, when the files finish loading.
      return this.replaceBedVoice(existing, kind, id);
    }
    if (this.bedVoices.length < MAX_AMBIENCE_VOICES) return this.createBedVoice(kind, id);
    let victim: BedVoice | null = null;
    for (const voice of this.bedVoices) {
      if (used.has(voice)) continue;
      if (!victim || voice.gainTarget < victim.gainTarget) victim = voice;
    }
    if (!victim) return null;
    return this.retuneBedVoice(victim, kind, id);
  }

  /** Whether this voice's machinery already matches the family's current source. */
  private sampleVoice(voice: BedVoice, kind: AmbienceKind): boolean {
    const recorded = this.recordedAmbience && this.ambienceSamples.has(kind);
    return (voice.sample !== null) === recorded;
  }

  /** Swap a slot onto the other kind of graph, keeping its place in the pool. */
  private replaceBedVoice(voice: BedVoice, kind: AmbienceKind, id: number): BedVoice | null {
    const index = this.bedVoices.indexOf(voice);
    this.releaseBedVoice(voice);
    const rebuilt = this.buildBedVoice(kind, id);
    if (!rebuilt) {
      if (index >= 0) this.bedVoices.splice(index, 1);
      return null;
    }
    if (index >= 0) this.bedVoices[index] = rebuilt;
    else this.bedVoices.push(rebuilt);
    return rebuilt;
  }

  private createBedVoice(kind: AmbienceKind, id: number): BedVoice | null {
    const voice = this.buildBedVoice(kind, id);
    if (voice) this.bedVoices.push(voice);
    return voice;
  }

  private buildBedVoice(kind: AmbienceKind, id: number): BedVoice | null {
    const ctx = this.ctx;
    const bus = this.bedBus;
    if (!ctx || !bus) return null;
    const recipe = BED_RECIPES[kind];
    try {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let panner: StereoPannerNode | null = null;
      if (typeof ctx.createStereoPanner === 'function') {
        panner = ctx.createStereoPanner();
        gain.connect(panner);
        panner.connect(bus);
      } else {
        gain.connect(bus);
      }
      const base = {
        id,
        kind,
        gain,
        panner,
        gainTarget: 0,
        motion: 0,
        lastSpoolUp: 0,
        lastSpoolDown: 0,
        fresh: true,
      };
      const sample = this.recordedAmbience ? this.ambienceSamples.get(kind) : undefined;
      if (sample) {
        // A recording is the machinery. The filter after it is the air: motion
        // opens it, distance closes it, and nothing else is needed.
        const source = ctx.createBufferSource();
        source.buffer = sample.buffer;
        source.loop = true;
        source.playbackRate.setValueAtTime(sample.idleRate, ctx.currentTime);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(SAMPLE_FILTER_HZ, ctx.currentTime);
        source.connect(filter);
        filter.connect(gain);
        source.start();
        return {
          ...base,
          sample: source,
          filter,
          trim: sample.trim,
          idleRate: sample.idleRate,
          moveRate: sample.moveRate,
          rate: sample.idleRate,
          spoolUntil: 0,
        };
      }
      const osc = ctx.createOscillator();
      osc.type = recipe.osc;
      osc.frequency.setValueAtTime(recipe.oscFreq, ctx.currentTime);
      const oscGain = ctx.createGain();
      oscGain.gain.value = recipe.oscGain;
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = recipe.filterType;
      filter.frequency.setValueAtTime(recipe.filterFreq, ctx.currentTime);
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = recipe.noiseGain;
      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.setValueAtTime(Math.max(0.2, recipe.modHz), ctx.currentTime);
      const modDepth = ctx.createGain();
      modDepth.gain.value = recipe.noiseGain * recipe.modDepth;
      osc.connect(oscGain);
      oscGain.connect(gain);
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(gain);
      // The modulator rides on the noise layer's own gain, so a clatter scales
      // with the voice instead of keeping a fixed amplitude when it is quiet.
      mod.connect(modDepth);
      modDepth.connect(noiseGain.gain);
      osc.start();
      noise.start();
      mod.start();
      return {
        ...base,
        sample: null,
        osc,
        oscGain,
        noise,
        noiseGain,
        filter,
        mod,
        modDepth,
      };
    } catch {
      // A context that refuses more sources simply carries a smaller bed.
      return null;
    }
  }

  private retuneBedVoice(voice: BedVoice, kind: AmbienceKind, id: number): BedVoice | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (!this.sampleVoice(voice, kind)) return this.replaceBedVoice(voice, kind, id);
    // A recorded slot cannot change its file: an AudioBufferSourceNode takes a
    // buffer once, and every family has its own. Handing the slot to another
    // family means new machinery, not a retuned one.
    if (voice.sample) return this.replaceBedVoice(voice, kind, id);
    const recipe = BED_RECIPES[kind];
    voice.id = id;
    voice.kind = kind;
    voice.gainTarget = 0;
    voice.motion = 0;
    voice.fresh = true;
    voice.gain.gain.setValueAtTime(0, ctx.currentTime);
    voice.osc.type = recipe.osc;
    voice.osc.frequency.setValueAtTime(recipe.oscFreq, ctx.currentTime);
    voice.oscGain.gain.setValueAtTime(recipe.oscGain, ctx.currentTime);
    voice.filter.type = recipe.filterType;
    voice.filter.frequency.setValueAtTime(recipe.filterFreq, ctx.currentTime);
    voice.noiseGain.gain.setValueAtTime(recipe.noiseGain, ctx.currentTime);
    voice.mod.frequency.setValueAtTime(Math.max(0.2, recipe.modHz), ctx.currentTime);
    voice.modDepth.gain.setValueAtTime(recipe.noiseGain * recipe.modDepth, ctx.currentTime);
    return voice;
  }

  /** Stop and disconnect one bed voice; the caller decides what replaces it. */
  private releaseBedVoice(voice: BedVoice): void {
    try {
      if (voice.sample) voice.sample.stop();
      else {
        voice.osc.stop();
        voice.noise.stop();
        voice.mod.stop();
        voice.osc.disconnect();
        voice.noise.disconnect();
        voice.mod.disconnect();
        voice.modDepth.disconnect();
        voice.oscGain.disconnect();
        voice.noiseGain.disconnect();
      }
      if (voice.sample) voice.sample.disconnect();
      voice.filter.disconnect();
      voice.gain.disconnect();
      voice.panner?.disconnect();
    } catch {
      /* A closed context has already released its nodes. */
    }
  }

  private releaseBed(): void {
    for (const voice of this.bedVoices) this.releaseBedVoice(voice);
    this.bedVoices = [];
    this.bedBus = null;
  }

  /**
   * Fetch and decode the recorded bed.
   *
   * One attempt per session: the loops are shared by every hull of a family,
   * and a failure must not be retried on every camera pan. Nothing here throws —
   * a missing, slow or undecodable file costs that family its recording and
   * leaves the synthesised voice playing.
   */
  private async loadAmbienceSamples(): Promise<void> {
    if (this.ambienceLoading || this.ambienceLoaded) return;
    const ctx = this.ctx;
    if (!ctx) return;
    this.ambienceLoading = true;
    try {
      const response = await fetch(`${AMBIENCE_AUDIO_ROOT}manifest.json`);
      if (!response.ok) return;
      const manifest = parseAmbienceManifest(await response.json());
      for (const loop of manifest.loops) {
        const decoded = await this.decodeAmbience(ctx, loop.src);
        if (!decoded) continue;
        const prepared = this.prepareAmbienceLoop(ctx, decoded);
        if (!prepared) continue;
        this.ambienceSamples.set(loop.kind, {
          buffer: prepared,
          trim: loop.gain,
          idleRate: loop.idleRate,
          moveRate: loop.moveRate,
        });
      }
      if (manifest.steps) {
        const stride = await this.buildStrideLoop(ctx, manifest.steps);
        if (stride) {
          // Boots are the one recording that has to be assembled: footfalls are
          // one-shots, and an assembled stride loops like any other engine.
          this.ambienceSamples.set('foot', {
            buffer: stride,
            trim: manifest.steps.gain,
            idleRate: 0.92,
            moveRate: 1.05,
          });
        }
      }
    } catch {
      // The bed keeps its synthesised voices.
    } finally {
      this.ambienceLoading = false;
      this.ambienceLoaded = true;
    }
  }

  private async decodeAmbience(ctx: AudioContext, src: string): Promise<AudioBuffer | null> {
    try {
      const response = await fetch(`${AMBIENCE_AUDIO_ROOT}${src}`);
      if (!response.ok) return null;
      return await ctx.decodeAudioData(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  /**
   * Turn a field recording into a loop the bed can hold.
   *
   * Long takes are cut to the loop window, channels are summed to mono (the
   * voice is panned anyway), and the join is smoothed: the head is blended with
   * the tail over an equal-power window, so a recording that ends mid-swell does
   * not click once per revolution.
   */
  private prepareAmbienceLoop(ctx: AudioContext, buffer: AudioBuffer): AudioBuffer | null {
    try {
      const rate = buffer.sampleRate;
      // A buffer without a usable rate cannot be folded into a loop at all.
      if (!Number.isFinite(rate) || rate <= 0) return null;
      const channels = Math.max(1, buffer.numberOfChannels);
      const frames = Math.min(buffer.length, Math.floor(MAX_LOOP_SECONDS * rate));
      if (frames < 64) return null;
      const mono = new Float32Array(frames);
      for (let channel = 0; channel < channels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < frames; i += 1) mono[i] += data[i] / channels;
      }
      const seam = Math.min(Math.floor(LOOP_SEAM_SECONDS * rate), Math.floor(frames / 4));
      // The tail is folded into the head and then dropped: the loop is shorter
      // than the recording by exactly the seam, so the join carries on forward
      // from the last sample into the first instead of jumping backwards.
      const length = frames - seam;
      const out = ctx.createBuffer(1, length, rate);
      const data = out.getChannelData(0);
      data.set(mono.subarray(0, length));
      for (let i = 0; i < seam; i += 1) {
        const t = i / seam;
        data[i] = mono[i] * Math.sqrt(t) + mono[length + i] * Math.sqrt(1 - t);
      }
      return out;
    } catch {
      return null;
    }
  }

  /**
   * Assemble bootfalls into a marching stride.
   *
   * Two takes are never identical, so the assembled loop alternates variants and
   * nudges each one's rate: a section on the move should sound like people, not
   * a metronome. The takes are normalised on the way in, because a recorded boot
   * peaks far below an engine.
   */
  private async buildStrideLoop(
    ctx: AudioContext,
    spec: AmbienceStepsSpec,
  ): Promise<AudioBuffer | null> {
    try {
      const steps: AudioBuffer[] = [];
      for (const src of spec.src) {
        const decoded = await this.decodeAmbience(ctx, src);
        if (decoded) steps.push(decoded);
      }
      if (steps.length < 2) return null;
      const Ctor =
        window.OfflineAudioContext ??
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
      if (!Ctor) return null;
      const rate = ctx.sampleRate;
      const stride = Math.max(0.2, Math.min(1.5, spec.strideSeconds));
      const footfalls = 4;
      const frames = Math.max(1, Math.round(stride * footfalls * rate));
      let peak = 0;
      for (const step of steps) {
        const data = step.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
      }
      const normalise = Math.min(6, 0.5 / Math.max(0.01, peak));
      const offline = new Ctor(1, frames, rate);
      for (let i = 0; i < footfalls; i += 1) {
        const source = offline.createBufferSource();
        source.buffer = steps[i % steps.length];
        source.playbackRate.value = 0.95 + 0.03 * (i % 3);
        const trim = offline.createGain();
        trim.gain.value = normalise;
        source.connect(trim);
        trim.connect(offline.destination);
        source.start(i * stride + (i % 2) * 0.005);
      }
      return await offline.startRendering();
    } catch {
      return null;
    }
  }

  /**
   * The catch and wind-down, played by the recording itself.
   *
   * A recorded hull needs no synthetic sweep over it: speeding the file up and
   * letting it settle *is* an engine taking load. The plan resumes control of
   * the rate when the gesture ends.
   */
  private spoolSample(voice: RecordedBedVoice, rising: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const duration = rising ? 0.42 : 0.55;
    const settled = Math.max(0.4, Math.min(2.4, voice.rate || voice.moveRate || 1));
    const from = rising ? settled * 0.55 : Math.min(2.4, settled * 1.08);
    try {
      const rate = voice.sample.playbackRate;
      if (typeof rate.cancelScheduledValues === 'function') rate.cancelScheduledValues(now);
      rate.setValueAtTime(from, now);
      rate.linearRampToValueAtTime(settled, now + duration);
      voice.spoolUntil = now + duration;
    } catch {
      // A context refusing a ramp simply has no swell.
    }
  }

  /**
   * Menu theme. This one is an authored track rather than synthesis: it is
   * streamed through an audio element, looped, and faded with the Music volume
   * setting. Browsers refuse playback until a gesture, so a refusal waits for
   * the next click or key instead of dropping the theme for the session.
   */
  playMenuMusic(): void {
    this.musicWanted = true;
    if (this.muted) return;
    const el = this.music ?? this.createMusic();
    if (!el) return;
    if (!el.paused) {
      this.fadeMusic(this.musicVolume, 0.25);
      return;
    }
    el.volume = 0;
    const started = el.play();
    if (!started) return;
    started
      .then(() => this.fadeMusic(this.musicVolume, 1.4))
      .catch(() => this.retryMusicOnGesture());
  }

  stopMenuMusic(): void {
    this.musicWanted = false;
    if (!this.music) return;
    this.fadeMusic(0, 0.7);
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.matchFade !== null) {
      clearInterval(this.matchFade);
      this.matchFade = null;
    }
    this.applyMatchVolume();
    const el = this.music;
    if (!el) return;
    // Turning the slider back up after silence should bring the theme back,
    // unless a battle/audition is deliberately holding it down.
    if (this.musicWanted && !this.menuPausedForMatch && el.paused && this.musicVolume > 0.001) {
      this.playMenuMusic();
    } else if (!el.paused) {
      this.fadeMusic(this.musicVolume, 0.25);
    }
  }

  private createMusic(): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null;
    const el = new Audio(MAIN_THEME_SRC);
    el.loop = true;
    el.preload = 'none';
    el.volume = 0;
    this.music = el;
    return el;
  }

  private fadeMusic(target: number, seconds: number): void {
    const el = this.music;
    if (!el) return;
    if (this.musicFade !== null) clearInterval(this.musicFade);
    const from = el.volume;
    const steps = Math.max(1, Math.round(seconds * 25));
    let step = 0;
    this.musicFade = setInterval(() => {
      step++;
      const k = Math.min(1, step / steps);
      el.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k < 1) return;
      if (this.musicFade !== null) clearInterval(this.musicFade);
      this.musicFade = null;
      if (target <= 0.001) el.pause();
    }, 40);
  }

  private retryMusicOnGesture(): void {
    if (this.musicRetryBound) return;
    this.musicRetryBound = true;
    const retry = (): void => {
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('keydown', retry);
      this.musicRetryBound = false;
      if (this.musicWanted) this.playMenuMusic();
    };
    window.addEventListener('pointerdown', retry, { once: true });
    window.addEventListener('keydown', retry, { once: true });
  }

  setVolumes(master: number, sfx: number, ambient: number): void {
    this.masterVolume = master;
    this.sfxVolume = sfx;
    this.ambientVolume = ambient;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : master, this.ctx.currentTime, 0.05);
    if (this.sfx && this.ctx) this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    if (this.ambient && this.ctx) this.ambient.gain.setTargetAtTime(ambient * 0.4, this.ctx.currentTime, 0.05);
    this.syncVoiceVolume();
    this.syncUnitVoiceVolume();
  }

  setUnitVoiceVolume(volume: number): void {
    this.unitVoiceVolume = Math.max(0, Math.min(1, volume));
    if (this.unitVoiceVolume <= 0.001) {
      this.stopUnitVoiceElement();
      this.unitBarks.reset();
      return;
    }
    this.syncUnitVoiceVolume();
  }

  setVoiceVolume(volume: number): void {
    this.voiceVolume = Math.max(0, Math.min(1, volume));
    if (this.voiceVolume <= 0.001) {
      this.stopVoice();
      this.announcer.reset();
      return;
    }
    this.syncVoiceVolume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : this.masterVolume, this.ctx.currentTime, 0.05);
    if (muted) {
      this.stopVoice();
      this.announcer.reset();
      this.stopUnitVoiceElement();
      this.unitBarks.reset();
      this.fadeMusic(0, 0.15);
    } else {
      this.syncVoiceVolume();
      if (this.musicWanted && !this.menuPausedForMatch) this.playMenuMusic();
    }
    this.applyMatchVolume();
  }

  /**
   * Report as the given faction narrator. Presentation only: the choice is
   * stamped onto the announcer's asset directory and never reaches the game.
   */
  setNarrator(id: NarratorId): void {
    this.announcer.setNarrator(id);
  }

  get narratorId(): NarratorId {
    return this.announcer.narratorId;
  }

  /** The announcer respects master mute/volume and its own persisted volume. */
  announce(id: AnnouncementId): void {
    if (!this.started || this.muted || this.voiceVolume <= 0.001) return;
    this.announcer.announce(id);
  }

  /**
   * Unit barks share one channel with the announcer but have their own volume.
   * They are presentation-only and never run while a command-level line is up.
   */
  speakUnit(cue: UnitVoiceCue, defId: string): void {
    if (!this.started || this.muted || this.unitVoiceVolume <= 0.001) return;
    if (this.voiceElement || this.announcer.currentId) return;
    this.unitBarks.speak(defId, cue);
  }

  /** Battle teardown/restart: drop any stale line and clear cooldown state. */
  resetAnnouncer(): void {
    this.announcer.reset();
    this.stopVoice();
    this.unitBarks.reset();
    this.stopUnitVoiceElement();
  }

  private syncVoiceVolume(): void {
    if (this.voiceElement) {
      this.voiceElement.volume = Math.max(0, Math.min(1, this.masterVolume * this.voiceVolume));
    }
  }

  private syncUnitVoiceVolume(): void {
    if (this.unitVoiceElement) {
      this.unitVoiceElement.volume = Math.max(
        0,
        Math.min(1, this.masterVolume * this.unitVoiceVolume),
      );
    }
  }

  private playUnitVoice(src: string, done: () => void): void {
    if (!this.started || this.muted || this.unitVoiceVolume <= 0.001 || typeof Audio === 'undefined') {
      done();
      return;
    }
    // The announcer owns the single voice channel while it speaks.
    if (this.voiceElement || this.announcer.currentId) {
      done();
      return;
    }
    let el: HTMLAudioElement;
    try {
      el = new Audio(src);
    } catch {
      done();
      return;
    }
    el.preload = 'auto';
    el.volume = Math.max(0, Math.min(1, this.masterVolume * this.unitVoiceVolume));
    this.unitVoiceElement = el;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      el.removeEventListener('ended', finish);
      el.removeEventListener('error', finish);
      if (this.unitVoiceElement === el) this.unitVoiceElement = null;
      done();
    };
    el.addEventListener('ended', finish);
    el.addEventListener('error', finish);
    try {
      const started = el.play();
      if (started && typeof started.catch === 'function') started.catch(finish);
    } catch {
      finish();
    }
  }

  private stopUnitVoiceElement(): void {
    const el = this.unitVoiceElement;
    this.unitVoiceElement = null;
    if (!el) return;
    el.pause();
    try {
      el.currentTime = 0;
    } catch {
      /* A failed media element may reject seeking; pausing is sufficient. */
    }
  }

  private playVoice(src: string, done: () => void): void {
    if (!this.started || this.muted || this.voiceVolume <= 0.001 || typeof Audio === 'undefined') {
      done();
      return;
    }
    // One voice channel only. A command-level line pre-empts unit barks; the
    // bark channel's stop also pauses its media element.
    this.unitBarks.stop();
    // The announcer has already stopped the previous line when it chose to
    // interrupt, but pause here as a defensive measure.
    this.voiceElement?.pause();
    // Duck the soundtrack while a command-level line is speaking. The music
    // keeps its position; only its volume moves.
    this.duckMatchMusic(true);
    let el: HTMLAudioElement;
    try {
      el = new Audio(src);
    } catch {
      this.duckMatchMusic(false);
      done();
      return;
    }
    el.preload = 'auto';
    el.volume = Math.max(0, Math.min(1, this.masterVolume * this.voiceVolume));
    this.voiceElement = el;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      el.removeEventListener('ended', finish);
      el.removeEventListener('error', finish);
      if (this.voiceElement === el) this.voiceElement = null;
      this.duckMatchMusic(false);
      done();
    };
    el.addEventListener('ended', finish);
    el.addEventListener('error', finish);
    try {
      const started = el.play();
      if (started && typeof started.catch === 'function') started.catch(finish);
    } catch {
      finish();
    }
  }

  private stopVoice(): void {
    const el = this.voiceElement;
    this.voiceElement = null;
    this.duckMatchMusic(false);
    if (!el) return;
    el.pause();
    try {
      el.currentTime = 0;
    } catch {
      /* A failed media element may reject seeking; pausing is sufficient. */
    }
  }

  private matchVolume(): number {
    if (this.muted) return 0;
    return Math.max(0, Math.min(1, this.musicVolume * (this.matchDucked ? 0.32 : 1)));
  }

  private applyMatchVolume(): void {
    // An explicit volume/mute change supersedes any in-flight duck fade.
    if (this.matchFade !== null) {
      clearInterval(this.matchFade);
      this.matchFade = null;
    }
    if (this.matchElement) this.matchElement.volume = this.matchVolume();
  }

  private duckMatchMusic(ducked: boolean): void {
    if (this.matchDucked === ducked) return;
    this.matchDucked = ducked;
    if (this.matchElement) this.fadeMatchVolume(this.matchVolume(), 0.18);
  }

  private fadeMatchVolume(target: number, seconds: number): void {
    const el = this.matchElement;
    if (!el) return;
    if (this.matchFade !== null) {
      clearInterval(this.matchFade);
      this.matchFade = null;
    }
    const from = el.volume;
    if (seconds <= 0 || Math.abs(from - target) < 0.001) {
      el.volume = target;
      return;
    }
    const steps = Math.max(1, Math.round(seconds * 25));
    let step = 0;
    this.matchFade = setInterval(() => {
      step++;
      const k = Math.min(1, step / steps);
      el.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k < 1) return;
      if (this.matchFade !== null) clearInterval(this.matchFade);
      this.matchFade = null;
    }, 40);
  }  private playMatchTrack(
    src: string,
    handlers: { onEnded: () => void; onError: () => void },
    options: { fade?: boolean } = {},
  ): void {
    if (typeof Audio === 'undefined') {
      handlers.onError();
      return;
    }
    const el = this.matchElement ?? (this.matchElement = new Audio());

    this.clearMatchRetry();
    this.matchHandlers = handlers;
    if (this.matchTransition !== null) {
      clearTimeout(this.matchTransition);
      this.matchTransition = null;
    }
    // A preview opened from the menu deck shares this channel. Fade the menu
    // theme out first; stopMatchTrack brings it back when the audition ends.
    this.pauseMenuForMatch();

    const canFade = options.fade && !!el.src && !el.paused && el.volume > 0.001;
    if (!canFade) {
      this.startMatchSource(el, src, handlers, false);
      return;
    }

    // Short fade through silence before the source swap. The controller has
    // already changed its now-playing row; the audio follows 180 ms later.
    el.onended = null;
    el.onerror = null;
    this.matchHandlers = null;
    this.fadeMatchVolume(0, 0.18);
    this.matchTransition = setTimeout(() => {
      this.matchTransition = null;
      if (!this.matchElement || this.matchElement !== el) return;
      this.matchHandlers = handlers;
      this.startMatchSource(el, src, handlers, true);
    }, 200);
  }

  private startMatchSource(
    el: HTMLAudioElement,
    src: string,
    handlers: { onEnded: () => void; onError: () => void },
    fadeIn: boolean,
  ): void {
    if (this.matchFade !== null) {
      clearInterval(this.matchFade);
      this.matchFade = null;
    }
    el.pause();
    el.onended = null;
    el.onerror = null;
    el.loop = false;
    el.preload = 'auto';
    el.src = src;
    el.volume = fadeIn ? 0 : this.matchVolume();
    el.onended = (): void => {
      if (this.matchElement !== el || this.matchHandlers !== handlers) return;
      this.matchHandlers = null;
      handlers.onEnded();
    };
    el.onerror = (): void => {
      if (this.matchElement !== el || this.matchHandlers !== handlers) return;
      this.matchHandlers = null;
      handlers.onError();
    };
    try {
      const started = el.play();
      if (started && typeof started.catch === 'function') {
        started
          .then(() => {
            if (fadeIn && this.matchHandlers === handlers) {
              this.fadeMatchVolume(this.matchVolume(), 0.4);
            }
          })
          .catch((error: unknown) => {
            if (this.matchHandlers !== handlers) return;
            const name = (error as { name?: string } | null)?.name;
            // A policy rejection is recoverable after a gesture and is not a bad
            // file. Do not skip the track or retry it in a loop.
            if (name === 'NotAllowedError') {
              this.armMatchRetry();
              return;
            }
            if (name === 'AbortError') return;
            this.matchHandlers = null;
            handlers.onError();
          });
      } else if (fadeIn) {
        this.fadeMatchVolume(this.matchVolume(), 0.4);
      }
    } catch {
      this.matchHandlers = null;
      handlers.onError();
    }
  }

  private pauseMenuForMatch(): void {
    if (!this.musicWanted || !this.music || this.music.paused) return;
    this.menuPausedForMatch = true;
    this.fadeMusic(0, 0.3);
  }

  private pauseMatchTrack(): void {
    this.clearMatchRetry();
    this.matchElement?.pause();
  }

  private resumeMatchTrack(): boolean {
    const el = this.matchElement;
    const handlers = this.matchHandlers;
    if (!el || !handlers) return false;
    this.clearMatchRetry();
    try {
      const started = el.play();
      if (started && typeof started.catch === 'function') {
        started.catch((error: unknown) => {
          if (this.matchHandlers !== handlers) return;
          const name = (error as { name?: string } | null)?.name;
          if (name === 'NotAllowedError') this.armMatchRetry();
          else if (name !== 'AbortError') {
            this.matchHandlers = null;
            handlers.onError();
          }
        });
      }
    } catch {
      this.matchHandlers = null;
      handlers.onError();
    }
    return true;
  }

  private stopMatchTrack(): void {
    const el = this.matchElement;
    this.matchHandlers = null;
    if (this.matchTransition !== null) {
      clearTimeout(this.matchTransition);
      this.matchTransition = null;
    }
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    if (this.menuPausedForMatch) {
      this.menuPausedForMatch = false;
      if (this.musicWanted) this.playMenuMusic();
    }
  }

  private armMatchRetry(): void {
    if (typeof window === 'undefined' || this.matchRetryHandler) return;
    const retry = (): void => {
      this.clearMatchRetry();
      this.retryMatchPlayback();
    };
    this.matchRetryHandler = retry;
    window.addEventListener('pointerdown', retry, { once: true });
    window.addEventListener('keydown', retry, { once: true });
  }

  private clearMatchRetry(): void {
    const retry = this.matchRetryHandler;
    if (!retry) return;
    this.matchRetryHandler = null;
    window.removeEventListener('pointerdown', retry);
    window.removeEventListener('keydown', retry);
  }

  private retryMatchPlayback(): void {
    const el = this.matchElement;
    const handlers = this.matchHandlers;
    if (!el || !handlers || !this.matchMusic.running) return;
    try {
      const started = el.play();
      if (started && typeof started.catch === 'function') {
        started.catch((error: unknown) => {
          if (this.matchHandlers !== handlers) return;
          const name = (error as { name?: string } | null)?.name;
          if (name === 'NotAllowedError') {
            this.armMatchRetry();
          } else if (name !== 'AbortError') {
            this.matchHandlers = null;
            handlers.onError();
          }
        });
      }
    } catch {
      this.matchHandlers = null;
      handlers.onError();
    }
  }

  private tone(freq: number, duration: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    const out = this.cueBus ?? this.sfx;
    if (!this.ctx || !out) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + duration);
    g.gain.setValueAtTime(gain * this.playGain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private noise(duration: number, gain: number, lowpass: number, delay = 0): void {
    const out = this.cueBus ?? this.sfx;
    if (!this.ctx || !out || !this.noiseBuffer) return;
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
    g.gain.setValueAtTime(gain * this.playGain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + duration + 0.03);
  }

  /**
   * One synthesised cue. `pan` is the stereo position in -1..1; the path stays
   * through the existing sfx/master gains, so mute and volume are unchanged.
   */
  play(name: string, gain = 1, pan = 0): void {
    if (!this.started || this.muted) return;
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? 0;
    // Dense cues keep a tighter gap than interface feedback: a firefight is
    // meant to blur into one sound, while a burst of clicks must stay legible.
    const minGap =
      name === 'rifle' || name === 'cannon' || name === 'explosion'
        ? 55
        : name === 'select'
          ? 40
          : name === 'order'
            ? 55
            : name === 'place' || name === 'build'
              ? 70
              : 35;
    if (now - last < minGap) return;
    this.lastPlayed.set(name, now);
    this.playGain = gain < 0 ? 0 : gain > 1 ? 1 : gain;
    this.cueBus = this.createCueBus(pan);
    try {
      this.emitCue(name);
    } finally {
      this.cueBus = null;
      this.playGain = 1;
    }
  }

  /**
   * A StereoPannerNode per positioned cue. Its sources are short, so the node
   * is disconnected after they have finished rather than accumulating in the
   * graph for the life of the match. Centred and unsupported cues use the
   * direct sfx path and allocate nothing.
   */
  private createCueBus(pan: number): AudioNode | null {
    const ctx = this.ctx;
    const sfx = this.sfx;
    if (!ctx || !sfx || !Number.isFinite(pan) || Math.abs(pan) < 0.01) return null;
    if (typeof ctx.createStereoPanner !== 'function') return null;
    try {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      panner.connect(sfx);
      const timer = setTimeout(() => {
        this.cueCleanup.delete(timer);
        try {
          panner.disconnect();
        } catch {
          /* The context may already be closed; nothing is left to release. */
        }
      }, 1500);
      this.cueCleanup.add(timer);
      return panner;
    } catch {
      // A context without pan support still gets the mono cue.
      return null;
    }
  }

  private emitCue(name: string): void {
    switch (name) {
      // Small arms are three layers: the supersonic crack, the case thump and
      // the report that rolls back off the ground. One layer alone read as a
      // typewriter, which is what a firefight used to sound like.
      case 'rifle': {
        const pitch = detune(0.07);
        this.noise(0.05, 0.18, 5200 * pitch);
        this.tone(150 * pitch, 0.06, 'triangle', 0.04, 70, 0.004);
        this.noise(0.17, 0.055, 620, 0.02);
        break;
      }
      case 'cannon': {
        const pitch = detune(0.05);
        this.noise(0.16, 0.34, 1500 * pitch);
        this.tone(72 * pitch, 0.34, 'sine', 0.2, 36);
        this.noise(0.6, 0.1, 300, 0.03);
        break;
      }
      // A missile is heard as launch, motor and pass-by rather than one whoosh.
      case 'missile': {
        this.noise(0.12, 0.2, 1800);
        this.noise(0.46, 0.12, 1100, 0.04);
        this.tone(220, 0.42, 'sawtooth', 0.045, 640, 0.03);
        break;
      }
      case 'sam': {
        const pitch = detune(0.05);
        this.noise(0.2, 0.15, 2600 * pitch);
        this.tone(460 * pitch, 0.22, 'sawtooth', 0.04, 1200);
        this.tone(690 * pitch, 0.18, 'sine', 0.02, 1800, 0.045);
        break;
      }
      // The blast carries a sub thump and a debris tail: the low end is what
      // sells the size of it, the tail is what tells you the shot landed.
      case 'explosion': {
        const pitch = detune(0.06);
        this.noise(0.1, 0.28, 2400);
        this.noise(0.55, 0.42, 700 * pitch);
        this.tone(52 * pitch, 0.65, 'sine', 0.24, 24);
        this.noise(0.9, 0.09, 210, 0.05);
        break;
      }
      case 'impact':
        this.noise(0.1, 0.14, 2600);
        this.tone(140, 0.05, 'square', 0.02, 90);
        break;
      // Interface feedback is a transient tick, not a musical note: a short
      // band of noise under a tiny pitch drop reads as a control, not a beep.
      case 'ui':
        this.noise(0.026, 0.035, 3200);
        this.tone(880, 0.02, 'square', 0.012, 720);
        break;
      /** A unit or structure taking the selection. */
      case 'select':
        this.tone(560, 0.03, 'triangle', 0.022, 780);
        this.noise(0.02, 0.02, 4200);
        break;
      /** An accepted order: two radio-band chirps, up on the second. */
      case 'order':
        this.tone(1180, 0.035, 'sine', 0.018, 1180);
        this.tone(1480, 0.04, 'sine', 0.012, 1480, 0.045);
        this.noise(0.02, 0.014, 5200);
        break;
      /** Footprint laid: a mechanical thunk under a short servo. */
      case 'place':
        this.noise(0.14, 0.16, 720);
        this.tone(96, 0.16, 'sine', 0.1, 58);
        this.tone(300, 0.1, 'triangle', 0.016, 460, 0.03);
        break;
      /** A cancelled mode or a dismissed panel. */
      case 'cancel':
        this.tone(360, 0.06, 'triangle', 0.02, 250);
        break;
      case 'queue':
        this.tone(640, 0.04, 'triangle', 0.024, 640);
        this.tone(880, 0.045, 'triangle', 0.02, 880, 0.04);
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
        this.tone(320, 0.12, 'triangle', 0.02, 440);
        this.noise(0.09, 0.04, 1400, 0.02);
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
      /**
       * The bowser's beacon sweeping over an apron: two short notes falling in
       * pitch, sizzled by a click of air. Pitched above the pump so it carries
       * through the bed without being turned up, and panned to the hull that
       * owns it — a flight line works by ear, not by a bell over the whole map.
       */
      case 'serviceBeacon':
        this.tone(1180, 0.06, 'sine', 0.05, 1240);
        this.tone(920, 0.09, 'sine', 0.032, 900, 0.075);
        this.noise(0.02, 0.012, 5200);
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
    this.musicWanted = false;
    for (const timer of this.cueCleanup) clearTimeout(timer);
    this.cueCleanup.clear();
    this.cueBus = null;
    this.music?.pause();
    if (this.musicFade !== null) clearInterval(this.musicFade);
    this.musicFade = null;
    this.music = null;
    this.clearMatchRetry();
    this.matchDucked = false;
    this.stopMatchTrack();
    this.announcer.reset();
    this.stopVoice();
    this.unitBarks.reset();
    this.stopUnitVoiceElement();
    this.releaseBed();
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}

/** A few percent of pitch spread, so a firefight never sounds like one sample. */
function detune(spread = 0.06): number {
  return 1 + (Math.random() * 2 - 1) * spread;
}
