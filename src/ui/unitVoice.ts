import { UNITS } from '../data/units';
import type { SimEvent } from '../sim/types';

/**
 * Unit response barks.
 *
 * These are presentation-only lines keyed by the authoritative unit definition
 * (`defId`), including the five national variants, each of which has its own
 * cast entry. The simulation never knows that a clip exists: it only publishes
 * ordinary order acknowledgements and refusals, and this module decides whether
 * the local commander hears one.
 */

export type UnitVoiceCue = 'select' | 'move' | 'attack' | 'unableToComply';

export interface UnitVoiceRequest {
  cue: UnitVoiceCue;
  defId: string;
}

const CUE_FILE: Record<UnitVoiceCue, string> = {
  select: 'select.mp3',
  move: 'move.mp3',
  attack: 'attack.mp3',
  unableToComply: 'unableToComply.mp3',
};

const VOICE_ROOT = '/audio/unit-voice/';

/** Battlefield barks are short; move, attack and refusal are the loudest. */
const CUE_PRIORITY: Record<UnitVoiceCue, number> = {
  select: 20,
  move: 35,
  attack: 45,
  unableToComply: 55,
};

const CUE_COOLDOWN_MS: Record<UnitVoiceCue, number> = {
  select: 2600,
  move: 1400,
  attack: 1600,
  unableToComply: 1600,
};

/** Two different units clicked within one gesture should not talk over each other. */
const GLOBAL_GAP_MS = 160;
/** A media element that never reports completion must not hold the channel forever. */
const MAX_LINE_MS = 6000;

/** Absolute path for a bark, or null when the definition has no unit voice. */
export function unitVoicePath(defId: string, cue: UnitVoiceCue): string | null {
  if (!Object.prototype.hasOwnProperty.call(UNITS, defId)) return null;
  return `${VOICE_ROOT}${defId}/${CUE_FILE[cue]}`;
}

/**
 * Map one simulation event to a local bark. Only events emitted by the local
 * commander's own order path are eligible; enemy orders are never voiced.
 *
 * `orderFailed` is deliberately broad: any refused direct order is an
 * "unable to comply" moment. Production failures carry a `code` and are left to
 * the strategic announcer, which has its own queue-specific line.
 */
export function unitVoiceForEvent(
  ev: SimEvent,
  localTeam: number,
): UnitVoiceRequest | null {
  if (ev.team !== localTeam) return null;
  if (!ev.defId || !Object.prototype.hasOwnProperty.call(UNITS, ev.defId)) return null;
  if (ev.type === 'orderAck') {
    if (ev.code === 'moveOrder') return { cue: 'move', defId: ev.defId };
    if (ev.code === 'attackOrder') return { cue: 'attack', defId: ev.defId };
    return null;
  }
  if (ev.type === 'orderFailed' && !ev.code) {
    return { cue: 'unableToComply', defId: ev.defId };
  }
  return null;
}

export interface UnitVoicePlayback {
  play(src: string, done: () => void): void;
  stop(): void;
}

export interface UnitVoiceOptions {
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

interface ActiveLine {
  cue: UnitVoiceCue;
  defId: string;
  priority: number;
  token: number;
}

/**
 * One shared bark channel. The newest, highest-priority line wins: selection is
 * quietest, refusals interrupt acknowledgements. Per-cue and per-unit cooldowns
 * keep rapid clicking or a stream of refused orders from becoming a stutter.
 */
export class UnitVoice {
  private active: ActiveLine | null = null;
  private token = 0;
  private timer: unknown = null;
  private readonly lastAt = new Map<string, number>();
  private lastAnyAt = -Infinity;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(
    private readonly playback: UnitVoicePlayback,
    options: UnitVoiceOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.schedule = options.schedule ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.cancel =
      options.cancel ??
      ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get currentCue(): UnitVoiceCue | null {
    return this.active?.cue ?? null;
  }

  get currentDefId(): string | null {
    return this.active?.defId ?? null;
  }

  /** True when a line is currently holding the channel. */
  get busy(): boolean {
    return this.active !== null;
  }

  /** Returns true when the bark started immediately. */
  speak(defId: string, cue: UnitVoiceCue): boolean {
    const src = unitVoicePath(defId, cue);
    if (!src) return false;
    const t = this.now();
    const key = `${defId}:${cue}`;
    const last = this.lastAt.get(key);
    if (last !== undefined && t - last < CUE_COOLDOWN_MS[cue]) return false;
    if (t - this.lastAnyAt < GLOBAL_GAP_MS) return false;

    const priority = CUE_PRIORITY[cue];
    if (this.active) {
      if (priority <= this.active.priority) return false;
      this.stopActive();
    }
    this.start(src, defId, cue, priority, t, key);
    return true;
  }

  private start(
    src: string,
    defId: string,
    cue: UnitVoiceCue,
    priority: number,
    t: number,
    key: string,
  ): void {
    this.lastAt.set(key, t);
    this.lastAnyAt = t;
    const token = ++this.token;
    this.active = { cue, defId, priority, token };
    // Arm the watchdog before playback: a media element can report completion
    // synchronously, which must clear the timer it just created.
    this.timer = this.schedule(() => this.finish(token), MAX_LINE_MS);
    try {
      this.playback.play(src, () => this.finish(token));
    } catch {
      this.finish(token);
    }
  }

  private finish(token: number): void {
    if (!this.active || this.active.token !== token) return;
    this.clearTimer();
    this.active = null;
  }

  private stopActive(): void {
    this.token++;
    this.active = null;
    this.clearTimer();
    this.playback.stop();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
  }

  /** Cut the current line without forgetting cooldowns (announcer interruption). */
  stop(): void {
    this.stopActive();
  }

  /** Battle teardown/restart: stop playback and clear all cooldown state. */
  reset(): void {
    this.stopActive();
    this.lastAt.clear();
    this.lastAnyAt = -Infinity;
  }
}
