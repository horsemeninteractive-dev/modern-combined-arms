/**
 * In-engine cinematic playback (Stage S5).
 *
 * This is a presentation clock, not a simulation. It reads an authored mission
 * cinematic, drives the camera and reports the subtitle that should be on
 * screen. It never mutates mission state, campaign progress or the command
 * queue, so a malformed sequence can delay a scene but cannot decide a battle.
 *
 * Timing is advanced by the render frame's delta (a passed-in number), not by
 * `setTimeout`: the player can be paused, skipped and tested deterministically
 * by calling `update(dt)` with fixed steps.
 */
import type {
  MissionCinematicContext,
  MissionCinematicDoc,
  MissionCinematicEffectKind,
  MissionCinematicStep,
  MissionCinematicTarget,
} from '../mission';
import { TILE_SIZE } from '../sim/constants';
import { briefingText, type BriefingCommander } from './missionBriefing';

export interface CinematicCameraState {
  cx: number;
  cz: number;
  zoom: number;
  /** Absolute orbit yaw in radians. Optional for older camera stubs. */
  yaw?: number;
}

/** The part of `Camera` a sequence needs. Kept small so tests can stub it. */
export interface CinematicCamera extends CinematicCameraState {
  centerOn(x: number, z: number): void;
  setZoom(halfHeight: number): void;
  setFraming(cx: number, cz: number, zoom: number, yaw?: number): void;
  setScreenLift(pixels: number, horizontalPixels?: number): void;
}

function captureCamera(camera: CinematicCamera): CinematicCameraState {
  return {
    cx: camera.cx,
    cz: camera.cz,
    zoom: camera.zoom,
    ...(camera.yaw !== undefined && Number.isFinite(camera.yaw) ? { yaw: camera.yaw } : {}),
  };
}

export interface CinematicActorPoint {
  x: number;
  z: number;
  facing: number;
  alpha: number;
}

/** Presentation overrides for one entity. Nothing here reaches the simulation. */
export interface CinematicActorStage {
  x?: number;
  z?: number;
  facing?: number;
  alpha?: number;
  /** `null` clears a procedural pose without discarding the staged transform. */
  pose?: 'idle' | 'walk' | null;
}

export interface CinematicWorld {
  camera: CinematicCamera;
  /** World position of an authored entity, or null when it is gone. */
  resolveEntity(key: string): { x: number; z: number } | null;
  /** Live facing and opacity for an actor beat, when the host can provide it. */
  resolveActor?(key: string): CinematicActorPoint | null;
  /** Apply a presentation-only transform to one live entity. */
  stageActor?(key: string, stage: CinematicActorStage): void;
  /** Drop every staged actor at scene end; the simulation never changed. */
  clearActors?(): void;
  /** Fire a presentation-only muzzle flash, tracer and impact. */
  fire?(fromX: number, fromZ: number, toX: number, toZ: number, scale: number): void;
  /** Restore the exact framing and HUD lift captured when the scene started. */
  restoreCamera(state: CinematicCameraState): void;
  /** Honour the operating system's reduced-motion preference. */
  reducedMotion?: boolean;
  /** Pulse the existing camera shake; 0..1. */
  shake?(amount: number): void;
  /** Fire one existing particle effect. */
  effect?(kind: MissionCinematicEffectKind, x: number, z: number, scale: number): void;
  /** Play one authored voice clip through the existing voice channel. */
  playVoice?(src: string): void;
  /** Stop the voice channel this player started. */
  stopVoice?(): void;
  /** Fire an existing synthesised sound cue without adding an audio path. */
  sound?(cue: string, gain: number): void;
  /** Start one authored catalogue track as a scene cue. */
  playMusic?(track: string): void;
}

/** One authorable chapter card as the overlay receives it. */
export interface CinematicCardFrame {
  heading: string;
  subheading: string | null;
  body: string | null;
}

export interface CinematicFrame {
  speaker: string | null;
  line: string | null;
  notice: string | null;
  /** Optional kicker above a notice. */
  noticeHeading: string | null;
  /** A chapter card, shown as a centred title rather than a subtitle. */
  card: CinematicCardFrame | null;
  /**
   * Black coverage from the scene's authored edge transitions, 0..1.
   *
   * The overlay paints this over the frame, so a chain of scenes reads as one
   * continuous presentation instead of cutting hard between them.
   */
  veil: number;
  /** Optional portrait for the current line. */
  portrait: string | null;
  /** True while the current line is presented as a radio transmission. */
  radio: boolean;
  stepIndex: number;
  /** Overall progress, 0..1. */
  progress: number;
  paused: boolean;
}

/**
 * Opening, intermission and ending sequences frame the campaign rather than a
 * live battle, so the simulation must not advance behind them. In-mission
 * dialogue and camera moves are live: the fight continues.
 */
export function cinematicPausesSimulation(kind: MissionCinematicContext): boolean {
  return kind !== 'inMission';
}

/**
 * Every context locks gameplay commands while the sequence plays. A cinematic
 * camera move is not an order, and a click on a skip control is not a selection.
 */
export function cinematicLocksInput(_kind: MissionCinematicContext): boolean {
  return true;
}

/** Duration of one timeline beat in seconds. */
export function cinematicStepSeconds(step: MissionCinematicStep): number {
  if (step.kind === 'camera') return step.durationSeconds + (step.holdSeconds ?? 0);
  if (step.kind === 'line') return step.durationSeconds + (step.pauseSeconds ?? 0);
  if (step.kind === 'actor') return step.durationSeconds;
  if (step.kind === 'sound') return step.durationSeconds ?? 0;
  if (step.kind === 'card') return step.durationSeconds;
  if (step.kind === 'music') return step.durationSeconds ?? 0;
  return step.durationSeconds ?? 2.5;
}

/** Interpolation curve for a camera move. */
export function cinematicCameraEase(
  t: number,
  ease: 'smooth' | 'linear' | 'cut' = 'smooth',
): number {
  if (ease === 'cut') return 1;
  const clamped = Math.max(0, Math.min(1, t));
  return ease === 'linear' ? clamped : cinematicEase(clamped);
}

/** Total authored duration, used for progress display and test expectations. */
export function cinematicSeconds(doc: MissionCinematicDoc): number {
  return doc.steps.reduce((total, step) => total + cinematicStepSeconds(step), 0);
}

/** Smoothstep: no velocity discontinuity at either end of a camera move. */
export function cinematicEase(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Shortest signed angular difference, so a 350° turn goes 10° backwards. */
function angleDelta(target: number, from: number): number {
  return Math.atan2(Math.sin(target - from), Math.cos(target - from));
}

export function interpolateCamera(
  from: CinematicCameraState,
  to: CinematicCameraState,
  t: number,
): CinematicCameraState {
  const eased = cinematicEase(t);
  const yaw =
    from.yaw !== undefined && to.yaw !== undefined
      ? from.yaw + angleDelta(to.yaw, from.yaw) * eased
      : (to.yaw ?? from.yaw);
  return {
    cx: from.cx + (to.cx - from.cx) * eased,
    cz: from.cz + (to.cz - from.cz) * eased,
    zoom: from.zoom + (to.zoom - from.zoom) * eased,
    ...(yaw !== undefined ? { yaw } : {}),
  };
}

/** Tile coordinates to world units, using the simulation's own tile size. */
export function cinematicWorldPoint(x: number, z: number): { x: number; z: number } {
  return { x: (x + 0.5) * TILE_SIZE, z: (z + 0.5) * TILE_SIZE };
}

const MAX_ZERO_LENGTH_STEPS = 64;

/**
 * Resolve the authored commander tokens in dialogue and notices.
 *
 * Playback receives a copy, so the mission document remains the immutable
 * authored source and a different commander profile renders different words.
 */
export function localiseCinematic(
  doc: MissionCinematicDoc,
  commander: BriefingCommander,
): MissionCinematicDoc {
  if (!commander) return doc;
  const steps = doc.steps.map((step) =>
    step.kind === 'line'
      ? { ...step, speaker: briefingText(step.speaker, commander), text: briefingText(step.text, commander) }
      : step.kind === 'notify'
        ? { ...step, text: briefingText(step.text, commander) }
        : step.kind === 'card'
          ? {
              ...step,
              heading: briefingText(step.heading, commander),
              ...(step.subheading !== undefined
                ? { subheading: briefingText(step.subheading, commander) }
                : {}),
              ...(step.body !== undefined ? { body: briefingText(step.body, commander) } : {}),
            }
          : step,
  );
  return {
    ...doc,
    steps,
    dialogue: doc.dialogue.map((line) => ({
      speaker: briefingText(line.speaker, commander),
      line: briefingText(line.line, commander),
    })),
  };
}

/**
 * Plays one authored sequence.
 *
 * The caller owns the loop: it calls `update(dt)` while the scene is on screen
 * and `skip()` when the player asks to leave. `onFinish` fires exactly once,
 * including after a skip, which is what makes campaign hand-offs safe.
 */
export class CinematicPlayer {
  readonly doc: MissionCinematicDoc;
  private readonly world: CinematicWorld;
  private readonly onFinish: (() => void) | null;
  private readonly original: CinematicCameraState;
  private readonly originalLift: { pixels: number; horizontal: number };
  private index = 0;
  private elapsed = 0;
  private started = false;
  private done = false;
  private paused = false;
  private from: CinematicCameraState;
  private to: CinematicCameraState;
  private caption: {
    speaker: string;
    text: string;
    seconds: number;
    portrait: string | null;
    radio: boolean;
  } | null = null;
  private notice: string | null = null;
  private noticeHeading: string | null = null;
  private noticeSeconds = 0;
  private card: CinematicCardFrame | null = null;
  private cardSeconds = 0;
  private voicePlaying = false;
  /** Presentation transforms held across beats until the scene ends. */
  private actorStages = new Map<string, CinematicActorStage>();
  private actorMotion: {
    key: string;
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    fromFacing: number;
    toFacing: number;
    fromAlpha: number;
    toAlpha: number;
    move: boolean;
    turn: boolean;
    fade: boolean;
    ease: 'smooth' | 'linear' | 'cut';
  } | null = null;

  constructor(
    doc: MissionCinematicDoc,
    world: CinematicWorld,
    onFinish: (() => void) | null = null,
  ) {
    this.doc = doc;
    this.world = world;
    this.onFinish = onFinish;
    const camera = world.camera;
    this.original = captureCamera(camera);
    this.originalLift = {
      pixels: (camera as CinematicCamera & { screenLift?: number }).screenLift ?? 0,
      horizontal:
        (camera as CinematicCamera & { screenLiftX?: number }).screenLiftX ?? 0,
    };
    this.from = { ...this.original };
    this.to = { ...this.original };
  }

  get finished(): boolean {
    return this.done;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get totalSeconds(): number {
    return cinematicSeconds(this.doc);
  }

  /** Presentation time played so far, including every finished beat. */
  private elapsedSeconds(): number {
    let total = 0;
    for (let i = 0; i < this.index && i < this.doc.steps.length; i++) {
      total += cinematicStepSeconds(this.doc.steps[i]);
    }
    return total + this.elapsed;
  }

  /**
   * Black coverage for the authored edge transitions, 0..1.
   *
   * A fade in starts fully black and clears over its duration; a fade out
   * darkens the last authored seconds. Reduced motion skips the dip rather than
   * holding a black frame, so the scene stays watchable without the effect.
   */
  private veil(): number {
    const transition = this.doc.transition;
    if (!transition || this.world.reducedMotion) return 0;
    const elapsed = this.elapsedSeconds();
    let veil = 0;
    const fadeIn = transition.in;
    if (fadeIn?.kind === 'fade' && fadeIn.durationSeconds > 0 && elapsed < fadeIn.durationSeconds) {
      veil = Math.max(veil, 1 - elapsed / fadeIn.durationSeconds);
    }
    const fadeOut = transition.out;
    if (fadeOut?.kind === 'fade' && fadeOut.durationSeconds > 0) {
      const start = Math.max(0, this.totalSeconds - fadeOut.durationSeconds);
      if (elapsed > start) {
        veil = Math.max(veil, Math.min(1, (elapsed - start) / fadeOut.durationSeconds));
      }
    }
    return Math.max(0, Math.min(1, veil));
  }

  get stepIndex(): number {
    return this.index;
  }

  get frame(): CinematicFrame {
    const total = Math.max(0.001, this.totalSeconds);
    return {
      speaker: this.caption?.speaker ?? null,
      line: this.caption?.text ?? null,
      notice: this.notice,
      noticeHeading: this.noticeHeading,
      card: this.card,
      veil: this.veil(),
      portrait: this.caption?.portrait ?? null,
      radio: this.caption?.radio ?? false,
      stepIndex: Math.min(this.index, Math.max(0, this.doc.steps.length - 1)),
      progress: Math.max(0, Math.min(1, this.elapsed / total)),
      paused: this.paused,
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // The frame is a clean cinematic shot: persistent HUD columns must not
    // shift the authored composition. The caller restores the lift on finish.
    this.world.camera.setScreenLift(0);
    this.beginStep();
    this.apply();
  }

  update(dt: number): void {
    if (this.done || this.paused) return;
    this.start();
    let remaining = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    let guard = 0;
    while (remaining > 0 && !this.done) {
      const step = this.doc.steps[this.index];
      if (!step) {
        this.finish();
        break;
      }
      const total = cinematicStepSeconds(step);
      const left = total - this.elapsed;
      if (remaining < left) {
        this.elapsed += remaining;
        remaining = 0;
      } else {
        remaining -= Math.max(0, left);
        this.elapsed = total;
        // A camera beat must land on its exact framing before the next beat
        // starts from it; otherwise the final frame of the move is lost.
        if (step.kind === 'camera') this.applyCameraAt(1);
        this.advanceStep();
        guard++;
        if (guard > MAX_ZERO_LENGTH_STEPS) {
          // A document of thousands of zero-length beats cannot hang a frame.
          this.finish();
          break;
        }
      }
    }
    if (!this.done) this.apply();
  }

  /** Hold the scene clock without losing its position. */
  pause(): void {
    if (this.done) return;
    this.paused = true;
  }

  /** Resume a paused scene; a finished scene stays finished. */
  resume(): void {
    if (this.done) return;
    this.paused = false;
  }

  togglePause(): boolean {
    if (this.done) return false;
    this.paused = !this.paused;
    return this.paused;
  }

  /**
   * Jump to the start of one authored beat.
   *
   * Camera framing is reconstructed from the scene's original view through the
   * preceding camera beats, so a jump is deterministic and does not depend on
   * how long the preview happened to be playing before it.
   */
  seekToStep(target: number): boolean {
    if (this.done || this.doc.steps.length === 0) return false;
    const next = Math.max(0, Math.min(this.doc.steps.length - 1, Math.floor(target)));
    this.stopVoice();
    this.clearTransient();
    this.world.clearActors?.();
    this.actorStages.clear();
    this.actorMotion = null;
    this.index = 0;
    this.elapsed = 0;
    this.from = { ...this.original };
    this.to = { ...this.original };
    this.started = true;
    this.world.camera.setScreenLift(0);
    this.world.camera.setFraming(
      this.original.cx,
      this.original.cz,
      this.original.zoom,
      this.original.yaw,
    );
    for (let i = 0; i < next; i++) {
      const step = this.doc.steps[i];
      if (step.kind === 'camera') {
        const from = captureCamera(this.world.camera);
        const to = this.resolveTarget(step, from);
        this.world.camera.setFraming(to.cx, to.cz, to.zoom, to.yaw);
      } else if (step.kind === 'actor') {
        this.replayActorStep(step);
      }
    }
    this.index = next;
    this.beginStep();
    this.apply();
    return true;
  }

  /**
   * Leave the scene. The finish callback still runs once.
   *
   * `force` is used by the skip-all preference: choosing never to see sequences
   * again also ends the one on screen, even when the author marked it
   * unskippable.
   */
  skip(force = false): boolean {
    if (this.done) return false;
    if (!this.doc.skippable && !force) return false;
    this.finish();
    return true;
  }

  private advanceStep(): void {
    this.endActorStep();
    this.clearTransient();
    this.index += 1;
    if (this.index >= this.doc.steps.length) {
      this.finish();
      return;
    }
    this.elapsed = 0;
    this.beginStep();
  }

  private clearTransient(): void {
    this.stopVoice();
    this.caption = null;
    this.notice = null;
    this.noticeHeading = null;
    this.noticeSeconds = 0;
    this.card = null;
    this.cardSeconds = 0;
  }

  private stopVoice(): void {
    if (!this.voicePlaying) return;
    this.voicePlaying = false;
    this.world.stopVoice?.();
  }

  private beginStep(): void {
    const step = this.doc.steps[this.index];
    if (!step) return;
    this.clearTransient();
    if (step.kind === 'camera') {
      const camera = this.world.camera;
      this.from = captureCamera(camera);
      this.to = this.resolveTarget(step, this.from);
      if (step.shake !== undefined && step.shake > 0) this.world.shake?.(step.shake);
      if (this.world.reducedMotion && step.durationSeconds > 0) {
        // Reduced motion keeps the authored timing but cuts the move.
        this.applyCameraAt(1);
      }
    } else if (step.kind === 'line') {
      this.caption = {
        speaker: step.speaker,
        text: step.text,
        seconds: step.durationSeconds,
        portrait: step.portrait ?? null,
        radio: step.radio === true,
      };
      if (step.voice && this.world.playVoice) {
        this.voicePlaying = true;
        this.world.playVoice(step.voice);
      }
    } else if (step.kind === 'notify') {
      this.notice = step.text;
      this.noticeHeading = step.heading ?? null;
      this.noticeSeconds = step.durationSeconds ?? 2.5;
    } else if (step.kind === 'card') {
      this.card = {
        heading: step.heading,
        subheading: step.subheading ?? null,
        body: step.body ?? null,
      };
      this.cardSeconds = step.durationSeconds;
    } else if (step.kind === 'music') {
      this.world.playMusic?.(step.track);
    } else if (step.kind === 'effect') {
      const point = this.resolveEffectPoint(step.target);
      if (point) this.world.effect?.(step.effect, point.x, point.z, step.scale ?? 1);
    } else if (step.kind === 'actor') {
      this.beginActorStep(step);
    } else {
      this.world.sound?.(step.cue, step.gain ?? 0.8);
    }
  }

  /**
   * Start one presentation-only staging beat.
   *
   * The actor must already exist in the live scene: cinema cannot conjure a
   * mesh the renderer does not have, and it must never create a simulation
   * entity. Missing actors therefore make the beat a no-op rather than an
   * error in the middle of playback.
   */
  private beginActorStep(step: Extract<MissionCinematicStep, { kind: 'actor' }>): void {
    const base = this.actorPoint(step.entity);
    if (!base) return;
    if (step.action === 'animate') {
      this.stageActorState(step.entity, { pose: step.pose });
      return;
    }
    if (step.action === 'fire') {
      const target = this.resolveEffectPoint(step.target);
      if (target) {
        this.world.fire?.(base.x, base.z, target.x, target.z, step.scale ?? 1);
      }
      return;
    }
    if (step.action === 'enter' || step.action === 'leave') {
      const structure = this.world.resolveEntity(step.structure);
      if (!structure) return;
      const point =
        step.action === 'enter'
          ? { x: structure.x, z: structure.z }
          : cinematicWorldPoint(step.x, step.z);
      this.actorMotion = {
        key: step.entity,
        fromX: step.action === 'enter' ? base.x : structure.x,
        fromZ: step.action === 'enter' ? base.z : structure.z,
        toX: point.x,
        toZ: point.z,
        fromFacing: base.facing,
        toFacing: base.facing,
        fromAlpha: step.action === 'enter' ? base.alpha : 0,
        toAlpha: step.action === 'enter' ? 0 : 1,
        move: true,
        turn: false,
        fade: true,
        ease: 'smooth',
      };
      this.applyActorAt(0);
      return;
    }
    if (step.action === 'appear' || step.action === 'disappear') {
      this.actorMotion = {
        key: step.entity,
        fromX: base.x,
        fromZ: base.z,
        toX: base.x,
        toZ: base.z,
        fromFacing: base.facing,
        toFacing: base.facing,
        fromAlpha: step.action === 'appear' ? 0 : base.alpha,
        toAlpha: step.action === 'appear' ? 1 : 0,
        move: false,
        turn: false,
        fade: true,
        ease: 'smooth',
      };
      this.applyActorAt(0);
      return;
    }
    if (step.action === 'turn') {
      const target = (step.facingDegrees * Math.PI) / 180;
      this.actorMotion = {
        key: step.entity,
        fromX: base.x,
        fromZ: base.z,
        toX: base.x,
        toZ: base.z,
        fromFacing: base.facing,
        toFacing: base.facing + angleDelta(target, base.facing),
        fromAlpha: base.alpha,
        toAlpha: base.alpha,
        move: false,
        turn: true,
        fade: false,
        ease: step.ease ?? 'smooth',
      };
      this.applyActorAt(0);
      return;
    }
    if (step.action !== 'move') return;
    const point = cinematicWorldPoint(step.x, step.z);
    this.actorMotion = {
      key: step.entity,
      fromX: base.x,
      fromZ: base.z,
      toX: point.x,
      toZ: point.z,
      fromFacing: base.facing,
      toFacing: base.facing,
      fromAlpha: base.alpha,
      toAlpha: base.alpha,
      move: true,
      turn: false,
      fade: false,
      ease: step.ease ?? 'smooth',
    };
    this.applyActorAt(0);
  }

  private actorPoint(key: string): CinematicActorPoint | null {
    const live =
      this.world.resolveActor?.(key) ??
      (() => {
        const point = this.world.resolveEntity(key);
        return point ? { ...point, facing: 0, alpha: 1 } : null;
      })();
    if (!live) return null;
    const staged = this.actorStages.get(key);
    return {
      x: staged?.x ?? live.x,
      z: staged?.z ?? live.z,
      facing: staged?.facing ?? live.facing,
      alpha: staged?.alpha ?? live.alpha,
    };
  }

  private stageActorState(key: string, patch: CinematicActorStage): void {
    const next = { ...this.actorStages.get(key), ...patch };
    this.actorStages.set(key, next);
    this.world.stageActor?.(key, next);
  }

  private applyActorAt(t: number): void {
    const motion = this.actorMotion;
    if (!motion) return;
    const eased = cinematicCameraEase(t, motion.ease);
    this.stageActorState(motion.key, {
      ...(motion.move
        ? {
            x: motion.fromX + (motion.toX - motion.fromX) * eased,
            z: motion.fromZ + (motion.toZ - motion.fromZ) * eased,
          }
        : {}),
      ...(motion.turn
        ? { facing: motion.fromFacing + (motion.toFacing - motion.fromFacing) * eased }
        : {}),
      ...(motion.fade
        ? { alpha: motion.fromAlpha + (motion.toAlpha - motion.fromAlpha) * eased }
        : {}),
    });
  }

  /** Land the exact final staged pose before the next beat starts. */
  private endActorStep(): void {
    const step = this.doc.steps[this.index];
    if (step?.kind === 'actor') {
      if (this.actorMotion) this.applyActorAt(1);
      if (step.action === 'animate') this.stageActorState(step.entity, { pose: null });
    }
    this.actorMotion = null;
  }

  /** Reconstruct a preceding actor beat when the preview seeks forward. */
  private replayActorStep(step: Extract<MissionCinematicStep, { kind: 'actor' }>): void {
    const base = this.actorPoint(step.entity);
    if (!base) return;
    if (step.action === 'move') {
      const point = cinematicWorldPoint(step.x, step.z);
      this.stageActorState(step.entity, { x: point.x, z: point.z });
    } else if (step.action === 'turn') {
      this.stageActorState(step.entity, { facing: (step.facingDegrees * Math.PI) / 180 });
    } else if (step.action === 'animate') {
      this.stageActorState(step.entity, { pose: step.pose });
    } else if (step.action === 'enter' || step.action === 'leave') {
      const structure = this.world.resolveEntity(step.structure);
      if (!structure) return;
      if (step.action === 'enter') {
        this.stageActorState(step.entity, { x: structure.x, z: structure.z, alpha: 0 });
      } else {
        const point = cinematicWorldPoint(step.x, step.z);
        this.stageActorState(step.entity, { x: point.x, z: point.z, alpha: 1 });
      }
    } else if (step.action === 'appear') {
      this.stageActorState(step.entity, { alpha: 1 });
    } else if (step.action === 'disappear') {
      this.stageActorState(step.entity, { alpha: 0 });
    }
  }

  private resolveEffectPoint(target: MissionCinematicTarget): { x: number; z: number } | null {
    if (target.kind === 'position') return cinematicWorldPoint(target.x, target.z);
    if (target.kind === 'entity') {
      const actor = this.actorPoint(target.entity);
      return actor ? { x: actor.x, z: actor.z } : null;
    }
    return { x: this.original.cx, z: this.original.cz };
  }

  private resolveTarget(
    step: Extract<MissionCinematicStep, { kind: 'camera' }>,
    fallback: CinematicCameraState,
  ): CinematicCameraState {
    const zoom = step.zoom ?? fallback.zoom;
    const yaw =
      step.rotationDegrees !== undefined
        ? (step.rotationDegrees * Math.PI) / 180
        : step.target.kind === 'restore'
          ? this.original.yaw
          : fallback.yaw;
    const withYaw = yaw !== undefined ? { yaw } : {};
    if (step.target.kind === 'restore') {
      return {
        cx: this.original.cx,
        cz: this.original.cz,
        zoom: step.zoom ?? this.original.zoom,
        ...withYaw,
      };
    }
    if (step.target.kind === 'position') {
      const point = cinematicWorldPoint(step.target.x, step.target.z);
      return { cx: point.x, cz: point.z, zoom, ...withYaw };
    }
    const entity = this.actorPoint(step.target.entity);
    // A destroyed or unplaced entity holds the previous framing rather than
    // snapping the camera to the world origin.
    if (!entity) return { ...fallback, zoom, ...withYaw };
    return { cx: entity.x, cz: entity.z, zoom, ...withYaw };
  }

  private apply(): void {
    const step = this.doc.steps[this.index];
    if (!step) return;    if (step.kind === 'camera') {
      // Tracking re-resolves the authored entity every frame, so a moving
      // column stays under the camera instead of being framed once at the cut.
      if (step.track && step.target.kind === 'entity') {
        this.to = this.resolveTarget(step, this.from);
      }
      const total = Math.max(0, step.durationSeconds);
      const t = this.world.reducedMotion || total === 0 ? 1 : this.elapsed / total;
      this.applyCameraAt(Math.min(1, t));
    } else if (step.kind === 'line') {
      if (this.caption && this.elapsed >= this.caption.seconds) this.caption = null;
    } else if (step.kind === 'notify') {
      if (this.notice && this.elapsed >= this.noticeSeconds) this.notice = null;
    } else if (step.kind === 'card') {
      if (this.card && this.elapsed >= this.cardSeconds) this.card = null;
    } else if (step.kind === 'actor') {
      const total = Math.max(0, step.durationSeconds);
      const t = this.world.reducedMotion || total === 0 ? 1 : this.elapsed / total;
      this.applyActorAt(Math.min(1, t));
    }
  }

  private applyCameraAt(t: number): void {
    const step = this.doc.steps[this.index];
    const ease = step?.kind === 'camera' ? step.ease : 'smooth';
    const eased = cinematicCameraEase(t, ease);
    const yaw =
      this.from.yaw !== undefined && this.to.yaw !== undefined
        ? this.from.yaw + angleDelta(this.to.yaw, this.from.yaw) * eased
        : (this.to.yaw ?? this.from.yaw);
    const state = {
      cx: this.from.cx + (this.to.cx - this.from.cx) * eased,
      cz: this.from.cz + (this.to.cz - this.from.cz) * eased,
      zoom: this.from.zoom + (this.to.zoom - this.from.zoom) * eased,
    };
    this.world.camera.setFraming(state.cx, state.cz, state.zoom, yaw);
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.clearTransient();
    this.actorStages.clear();
    this.actorMotion = null;
    this.world.clearActors?.();
    this.world.camera.setScreenLift(this.originalLift.pixels, this.originalLift.horizontal);
    this.world.restoreCamera(this.original);
    this.onFinish?.();
  }
}
