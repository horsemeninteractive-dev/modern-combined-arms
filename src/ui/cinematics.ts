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
  MissionCinematicStep,
} from '../mission';
import { TILE_SIZE } from '../sim/constants';
import { briefingText, type BriefingCommander } from './missionBriefing';

export interface CinematicCameraState {
  cx: number;
  cz: number;
  zoom: number;
}

/** The part of `Camera` a sequence needs. Kept small so tests can stub it. */
export interface CinematicCamera extends CinematicCameraState {
  centerOn(x: number, z: number): void;
  setZoom(halfHeight: number): void;
  setFraming(cx: number, cz: number, zoom: number): void;
  setScreenLift(pixels: number, horizontalPixels?: number): void;
}

export interface CinematicWorld {
  camera: CinematicCamera;
  /** World position of an authored entity, or null when it is gone. */
  resolveEntity(key: string): { x: number; z: number } | null;
  /** Restore the exact framing and HUD lift captured when the scene started. */
  restoreCamera(state: CinematicCameraState): void;
  /** Honour the operating system's reduced-motion preference. */
  reducedMotion?: boolean;
}

export interface CinematicFrame {
  speaker: string | null;
  line: string | null;
  notice: string | null;
  stepIndex: number;
  /** Overall progress, 0..1. */
  progress: number;
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
  return step.durationSeconds ?? 2.5;
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

export function interpolateCamera(
  from: CinematicCameraState,
  to: CinematicCameraState,
  t: number,
): CinematicCameraState {
  const eased = cinematicEase(t);
  return {
    cx: from.cx + (to.cx - from.cx) * eased,
    cz: from.cz + (to.cz - from.cz) * eased,
    zoom: from.zoom + (to.zoom - from.zoom) * eased,
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
  private from: CinematicCameraState;
  private to: CinematicCameraState;
  private caption: { speaker: string; text: string; seconds: number } | null = null;
  private notice: string | null = null;
  private noticeSeconds = 0;

  constructor(
    doc: MissionCinematicDoc,
    world: CinematicWorld,
    onFinish: (() => void) | null = null,
  ) {
    this.doc = doc;
    this.world = world;
    this.onFinish = onFinish;
    const camera = world.camera;
    this.original = { cx: camera.cx, cz: camera.cz, zoom: camera.zoom };
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

  get totalSeconds(): number {
    return cinematicSeconds(this.doc);
  }

  get frame(): CinematicFrame {
    const total = Math.max(0.001, this.totalSeconds);
    return {
      speaker: this.caption?.speaker ?? null,
      line: this.caption?.text ?? null,
      notice: this.notice,
      stepIndex: Math.min(this.index, Math.max(0, this.doc.steps.length - 1)),
      progress: Math.max(0, Math.min(1, this.elapsed / total)),
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
    if (this.done) return;
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
    this.caption = null;
    this.notice = null;
    this.noticeSeconds = 0;
  }

  private beginStep(): void {
    const step = this.doc.steps[this.index];
    if (!step) return;
    this.clearTransient();
    if (step.kind === 'camera') {
      const camera = this.world.camera;
      this.from = { cx: camera.cx, cz: camera.cz, zoom: camera.zoom };
      this.to = this.resolveTarget(step, this.from);
      if (this.world.reducedMotion && step.durationSeconds > 0) {
        // Reduced motion keeps the authored timing but cuts the move.
        this.applyCameraAt(1);
      }
    } else if (step.kind === 'line') {
      this.caption = {
        speaker: step.speaker,
        text: step.text,
        seconds: step.durationSeconds,
      };
    } else {
      this.notice = step.text;
      this.noticeSeconds = step.durationSeconds ?? 2.5;
    }
  }

  private resolveTarget(
    step: Extract<MissionCinematicStep, { kind: 'camera' }>,
    fallback: CinematicCameraState,
  ): CinematicCameraState {
    const zoom = step.zoom ?? fallback.zoom;
    if (step.target.kind === 'position') {
      const point = cinematicWorldPoint(step.target.x, step.target.z);
      return { cx: point.x, cz: point.z, zoom };
    }
    const entity = this.world.resolveEntity(step.target.entity);
    // A destroyed or unplaced entity holds the previous framing rather than
    // snapping the camera to the world origin.
    if (!entity) return { ...fallback, zoom };
    return { cx: entity.x, cz: entity.z, zoom };
  }

  private apply(): void {
    const step = this.doc.steps[this.index];
    if (!step) return;
    if (step.kind === 'camera') {
      const total = Math.max(0, step.durationSeconds);
      const t = this.world.reducedMotion && total > 0 ? 1 : total === 0 ? 1 : this.elapsed / total;
      this.applyCameraAt(Math.min(1, t));
    } else if (step.kind === 'line') {
      if (this.caption && this.elapsed >= this.caption.seconds) this.caption = null;
    } else {
      if (this.notice && this.elapsed >= this.noticeSeconds) this.notice = null;
    }
  }

  private applyCameraAt(t: number): void {
    const state = interpolateCamera(this.from, this.to, t);
    this.world.camera.setFraming(state.cx, state.cz, state.zoom);
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.clearTransient();
    this.world.camera.setScreenLift(this.originalLift.pixels, this.originalLift.horizontal);
    this.world.restoreCamera(this.original);
    this.onFinish?.();
  }
}
