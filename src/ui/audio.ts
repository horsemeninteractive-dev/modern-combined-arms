import { Announcer, type AnnouncementId } from './announcer';
import type { NarratorId } from '../data/narrators';
import { MAIN_THEME_SRC } from './musicCatalogue';
import { MatchMusic, type MatchMusicSnapshot } from './matchMusic';
import { UnitVoice, type UnitVoiceCue } from './unitVoice';

/**
 * Weapons, UI and ambience are synthesised at runtime. The menu theme, match
 * soundtrack and strategic voice lines are authored assets. Music streams
 * through a media channel per context, and voice uses one dedicated channel so
 * the announcer can interrupt a lower-priority line without touching the Web
 * Audio graph.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  /** Temporary per-cue trim, used to attenuate visible distant combat. */
  private playGain = 1;
  private ambient: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
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

  constructor() {
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
    const minGap = name === 'rifle' ? 55 : name === 'cannon' ? 70 : name === 'explosion' ? 60 : 35;
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
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
