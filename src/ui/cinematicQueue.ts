/**
 * Cinematic chain scheduling.
 *
 * Playback shows one scene at a time, but the game queues chains: a launch is
 * opening then briefing, an accepted result is ending then intermission then
 * the campaign scene, a deck replay is every scene in one framing context.
 *
 * Each chain owns its follow-up, which runs when that chain's last scene ends.
 * It is deliberately not a single shared hand-off slot: a second chain queued
 * while the first was still on screen used to overwrite that slot, stranding
 * the earlier deployment or result card behind a scene that had already
 * finished. Stamping the hand-off onto the chain's own last scene makes the
 * first chain's follow-up survivable no matter what is queued after it.
 *
 * This module owns only that bookkeeping. Starting a scene, deciding whether a
 * context is switched on and running the follow-up all belong to the caller,
 * so the queue can be tested without a renderer, a clock or storage.
 */
import type { MissionCinematicContext, MissionCinematicDoc } from '../mission/types';

/** One scene waiting for the frame. */
export interface QueuedCinematic {
  doc: MissionCinematicDoc;
  context: MissionCinematicContext;
  eyebrow: string;
  title: string;
  /** Runs when this scene ends, before anything queued behind it starts. */
  after?: () => void;
  /** A manual preview plays regardless of the player's per-context switches. */
  force?: boolean;
}

/** The part of the host a queue needs. Kept small so tests can stub it. */
export interface CinematicQueueHost {
  /** Document id of the scene on screen, or null when the frame is free. */
  playingId(): string | null;
  /** Whether the player's preferences allow this context to play. */
  enabled(context: MissionCinematicContext): boolean;
  /**
   * Take the frame with one scene.
   *
   * False means it could not start: the preference changed since it was queued,
   * or another scene took the frame first.
   */
  play(item: QueuedCinematic): boolean;
}

export class CinematicChainQueue {
  private items: QueuedCinematic[] = [];

  constructor(private readonly host: CinematicQueueHost) {}

  /** Scenes waiting behind the one on screen. */
  get pendingCount(): number {
    return this.items.length;
  }

  /**
   * Drop everything waiting.
   *
   * Their follow-ups do not run: clearing the queue is how a battle launch or a
   * return to the menu discards a stale deck hand-off on purpose.
   */
  clear(): void {
    this.items = [];
  }

  /**
   * Queue a group of scenes as one chain.
   *
   * Either the whole chain is queued or, when nothing in it may play, none of
   * it is and the follow-up runs immediately. The follow-up is attached to the
   * chain's last scene rather than held in a shared slot, and an authored
   * per-scene follow-up is never replaced by the chain's.
   */
  chain(
    items: readonly QueuedCinematic[],
    onDone: (() => void) | null = null,
    force = false,
  ): boolean {
    const playable = items
      .filter(
        (item) =>
          item.doc.steps.length > 0 && (force || this.host.enabled(item.context)),
      )
      .map((item) => (force ? { ...item, force: true } : { ...item }));
    if (playable.length === 0) {
      onDone?.();
      return false;
    }
    if (onDone) {
      const last = playable.length - 1;
      playable[last] = { ...playable[last], after: playable[last].after ?? onDone };
    }
    this.items.push(...playable);
    if (this.host.playingId() === null) this.drain();
    return true;
  }

  /** Queue a single scene behind whatever is waiting; duplicates are refused. */
  push(item: QueuedCinematic): boolean {
    if (
      this.host.playingId() === item.doc.id ||
      this.items.some((entry) => entry.doc.id === item.doc.id)
    ) {
      return false;
    }
    this.items.push(item);
    if (this.host.playingId() === null) this.drain();
    return true;
  }

  /**
   * Start the next waiting scene, running each chain's hand-off as it drains.
   *
   * A scene that cannot start still owns its chain's follow-up, so that runs
   * here before the next chain is considered.
   */
  drain(): void {
    while (this.items.length > 0) {
      if (this.host.playingId() !== null) return;
      const next = this.items.shift()!;
      if (this.host.play(next)) return;
      next.after?.();
    }
  }
}
