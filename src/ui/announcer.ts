import type { SimEvent } from '../sim/types';
import {
  DEFAULT_NARRATOR,
  narratorAssetPath,
  type NarratorId,
} from '../data/narrators';

/**
 * Strategic voice announcer.
 *
 * The simulation already emits ordered, presentation-neutral events. This
 * module is the only place that knows which event becomes which voice line,
 * how important it is and how often it may repeat. Gameplay code never loads an
 * MP3 or calls an audio element directly.
 */

export type AnnouncementId =
  | 'constructionComplete'
  | 'buildingUnderConstruction'
  | 'buildingSold'
  | 'structureLost'
  | 'unitReady'
  | 'productionUnderway'
  | 'productionCancelled'
  | 'queueFull'
  | 'reinforcementsAvailable'
  | 'upgradeComplete'
  | 'siteSecured'
  | 'siteContested'
  | 'siteLost'
  | 'powerRestored'
  | 'technologyUnlocked'
  | 'baseUnderAttack'
  | 'forcesUnderAttack'
  | 'unitLost'
  | 'enemyDetected'
  | 'unitPromoted'
  | 'rallyPointSet'
  | 'battlefieldEstablished'
  | 'victory';

export interface VoiceCue {
  /**
   * Filename only. The narrator catalogue owns the directory, so both narrators
   * share one cue table and a new voice is a new folder, not a new manifest.
   */
  file: string;
  /** Higher priority lines may interrupt lower ones. */
  priority: number;
  /** Minimum time between two plays of this cue. */
  cooldownMs: number;
  /** Mission-state cues must never replay within one battle. */
  once?: boolean;
  label: string;
}

/**
 * Path of one cue for a named narrator.
 *
 * Kept pure so the cue-to-asset contract can be asserted without a browser, and
 * so no trigger site ever builds a URL of its own.
 */
export function narratorVoicePath(narrator: NarratorId, id: AnnouncementId): string {
  return narratorAssetPath(narrator, VOICE_MANIFEST[id].file);
}

/**
 * One table for playback, tests and future additions. The five cues at the end
 * that have no simulation mechanic yet remain registered but are not mapped to
 * events until that mechanic exists.
 */
export const VOICE_MANIFEST: Record<AnnouncementId, VoiceCue> = {
  victory: { file: 'victory.mp3', priority: 100, cooldownMs: 0, once: true, label: 'Victory' },
  baseUnderAttack: { file: 'baseunderattack.mp3', priority: 90, cooldownMs: 15000, label: 'Base under attack' },
  structureLost: { file: 'structurelost.mp3', priority: 85, cooldownMs: 10000, label: 'Structure lost' },
  siteLost: { file: 'sitelost.mp3', priority: 80, cooldownMs: 8000, label: 'Site lost' },
  unitLost: { file: 'unitlost.mp3', priority: 75, cooldownMs: 5000, label: 'Unit lost' },
  siteSecured: { file: 'sitesecured.mp3', priority: 70, cooldownMs: 8000, label: 'Site secured' },
  forcesUnderAttack: { file: 'forcesunderattack.mp3', priority: 65, cooldownMs: 12000, label: 'Forces under attack' },
  enemyDetected: { file: 'enemydetected.mp3', priority: 60, cooldownMs: 12000, label: 'Enemy detected' },
  constructionComplete: { file: 'constructioncomplete.mp3', priority: 45, cooldownMs: 5000, label: 'Construction complete' },
  queueFull: { file: 'queuefull.mp3', priority: 45, cooldownMs: 4000, label: 'Production queue full' },
  powerRestored: { file: 'powerrestored.mp3', priority: 40, cooldownMs: 8000, label: 'Power restored' },
  upgradeComplete: { file: 'upgradecomplete.mp3', priority: 40, cooldownMs: 6000, label: 'Upgrade complete' },
  technologyUnlocked: { file: 'technologyunlocked.mp3', priority: 40, cooldownMs: 6000, label: 'Technology unlocked' },
  unitReady: { file: 'unitready.mp3', priority: 35, cooldownMs: 5000, label: 'Unit ready' },
  productionUnderway: { file: 'productionunderway.mp3', priority: 30, cooldownMs: 5000, label: 'Production underway' },
  productionCancelled: { file: 'productioncancelled.mp3', priority: 30, cooldownMs: 4000, label: 'Production cancelled' },
  reinforcementsAvailable: { file: 'reinforcementsavailable.mp3', priority: 30, cooldownMs: 8000, label: 'Reinforcements available' },
  buildingUnderConstruction: { file: 'buildingunderconstruction.mp3', priority: 25, cooldownMs: 5000, label: 'Building under construction' },
  buildingSold: { file: 'buildingsold.mp3', priority: 25, cooldownMs: 5000, label: 'Building sold' },
  siteContested: { file: 'sitecontested.mp3', priority: 65, cooldownMs: 10000, label: 'Site contested' },
  battlefieldEstablished: {
    file: 'battlefieldestablished.mp3',
    priority: 55,
    cooldownMs: 0,
    once: true,
    label: 'Battlefield established',
  },
  unitPromoted: { file: 'unitpromoted.mp3', priority: 40, cooldownMs: 4000, label: 'Unit promoted' },
  rallyPointSet: { file: 'rallypointset.mp3', priority: 25, cooldownMs: 2500, label: 'Rally point set' },
};

export const ANNOUNCEMENT_IDS = Object.keys(VOICE_MANIFEST) as AnnouncementId[];

/** Default-narrator path; the active voice is chosen per battle. */
export function voicePath(id: AnnouncementId): string {
  return narratorVoicePath(DEFAULT_NARRATOR, id);
}

/**
 * Map one simulation event to one voice cue. This is deliberately pure so the
 * event-to-asset contract can be tested without a browser or a running game.
 */
export function announcementForEvent(ev: SimEvent, localPlayerId: number): AnnouncementId | null {
  const local = ev.team === localPlayerId;

  // Loss of a site is emitted with the capturer's team, so this code must be
  // checked before the local-team gate.
  if (ev.code === 'siteLost') return 'siteLost';

  switch (ev.type) {
    case 'buildingPlaced':
      return local ? 'buildingUnderConstruction' : null;
    case 'buildingComplete':
      return local ? 'constructionComplete' : null;
    case 'unitBuilt':
      return local ? 'unitReady' : null;
    case 'buildingLost':
      return local ? 'structureLost' : null;
    case 'unitLost':
      return local ? 'unitLost' : null;
    case 'capture':
      return local ? 'siteSecured' : null;
    case 'victory':
      return local ? 'victory' : null;
    case 'orderFailed':
      return local && ev.code === 'queueFull' ? 'queueFull' : null;
    case 'orderAck':
      if (!local) return null;
      if (ev.code === 'productionStarted') return 'productionUnderway';
      if (ev.code === 'productionCancelled') return 'productionCancelled';
      if (ev.code === 'rallySet') return 'rallyPointSet';
      return null;
    case 'notice':
      if (!local) return null;
      if (ev.code === 'powerRestored') return 'powerRestored';
      if (ev.code === 'enemyDetected') return 'enemyDetected';
      if (ev.code === 'unitPromoted') return 'unitPromoted';
      return null;
    case 'alert':
      if (!local) return null;
      if (ev.code === 'baseUnderAttack') return 'baseUnderAttack';
      if (ev.code === 'forcesUnderAttack') return 'forcesUnderAttack';
      return null;
    default:
      return null;
  }
}

export interface VoicePlayback {
  play(src: string, done: () => void): void;
  stop(): void;
}

export interface AnnouncerOptions {
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** A stuck media element must not silence the rest of the battle. */
const MAX_LINE_MS = 12000;
/** A queued low-priority line is stale after this long. */
const PENDING_TTL_MS = 4000;
/** Below this priority, a lower-priority line may wait for the current one. */
const CRITICAL_PRIORITY = 60;

/**
 * One voice channel with priority interruption, per-cue cooldown and one
 * bounded pending slot. It is intentionally independent of Web Audio and the
 * DOM so tests can drive it without sound hardware.
 */
export class Announcer {
  private active: { id: AnnouncementId; priority: number; token: number; startedAt: number } | null = null;
  private pending: { id: AnnouncementId; at: number } | null = null;
  private token = 0;
  private lastAt = new Map<AnnouncementId, number>();
  private oncePlayed = new Set<AnnouncementId>();
  private timer: unknown = null;
  private narrator: NarratorId = DEFAULT_NARRATOR;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(
    private readonly playback: VoicePlayback,
    options: AnnouncerOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.schedule = options.schedule ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.cancel = options.cancel ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get currentId(): AnnouncementId | null {
    return this.active?.id ?? null;
  }

  /** The voice currently reporting for the local commander. */
  get narratorId(): NarratorId {
    return this.narrator;
  }

  /**
   * Switch the reporting voice. Called once per battle, after the seat's
   * faction is known, so no trigger site needs to know about factions.
   *
   * A line already in flight is cut rather than finished: parts of a sentence
   * in the previous faction's voice would read as two commanders talking. The
   * pending slot is cleared for the same reason; cooldowns and `once` bookkeeping
   * are deliberately untouched, because those describe the battle, not the voice.
   */
  setNarrator(id: NarratorId): void {
    if (id === this.narrator) return;
    this.stopActive();
    this.pending = null;
    this.narrator = id;
  }

  /** Returns true when the cue started immediately, false when suppressed or queued. */
  announce(id: AnnouncementId): boolean {
    const cue = VOICE_MANIFEST[id];
    if (!cue) return false;
    const t = this.now();
    if (cue.once && this.oncePlayed.has(id)) return false;
    const last = this.lastAt.get(id);
    if (last !== undefined && t - last < cue.cooldownMs) return false;

    if (!this.active) {
      this.start(id, t);
      return true;
    }

    if (cue.priority > this.active.priority) {
      this.stopActive();
      this.pending = null;
      this.start(id, t);
      return true;
    }

    // Equal priority means two sources produced the same class of report in
    // the same moment; one is enough. Lower priority never interrupts, but a
    // single informational line may wait behind a non-critical line.
    if (cue.priority === this.active.priority) return false;
    if (this.active.priority >= CRITICAL_PRIORITY || this.pending) return false;
    this.pending = { id, at: t };
    return false;
  }

  private start(id: AnnouncementId, t: number): void {
    const cue = VOICE_MANIFEST[id];
    this.pending = null;
    this.lastAt.set(id, t);
    if (cue.once) this.oncePlayed.add(id);
    const token = ++this.token;
    this.active = { id, priority: cue.priority, token, startedAt: t };
    // Arm the watchdog first: a media element may report completion
    // synchronously, and that must clear the timer it just created.
    this.timer = this.schedule(() => this.finish(token), MAX_LINE_MS);
    try {
      this.playback.play(narratorVoicePath(this.narrator, id), () => this.finish(token));
    } catch {
      this.finish(token);
    }
  }

  private finish(token: number): void {
    if (!this.active || this.active.token !== token) return;
    this.clearTimer();
    this.active = null;
    const next = this.pending;
    this.pending = null;
    if (next && this.now() - next.at <= PENDING_TTL_MS) {
      this.start(next.id, this.now());
    }
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

  /** Battle teardown/restart: stop playback and clear stale once/cooldown state. */
  reset(): void {
    this.stopActive();
    this.pending = null;
    this.lastAt.clear();
    this.oncePlayed.clear();
  }
}
