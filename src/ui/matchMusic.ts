/**
 * In-match soundtrack rotation.
 *
 * The three tracks are an authored set, so this deliberately stays a small
 * cycle rather than a general playlist framework. Playback, volume and media
 * lifecycle belong to AudioEngine; this class owns only which track should be
 * heard next and guarantees that a track is never repeated back-to-back.
 */

export const MATCH_TRACKS = [
  '/audio/in-game-theme1.mp3',
  '/audio/in-game-theme2.mp3',
  '/audio/in-game-theme3.mp3',
] as const;

export interface MatchMusicOutput {
  /** Start one track. Exactly one completion/error callback follows. */
  playTrack(
    src: string,
    handlers: { onEnded: () => void; onError: () => void },
  ): void;
  stop(): void;
}

export interface MatchMusicOptions {
  /** Injectable for deterministic tests; a fresh order is drawn per match. */
  random?: () => number;
}

export class MatchMusic {
  private queue: string[] = [];
  private failed = new Set<string>();
  private last: string | null = null;
  private current: string | null = null;
  private active = false;
  private generation = 0;
  private readonly random: () => number;

  constructor(
    private readonly output: MatchMusicOutput,
    options: MatchMusicOptions = {},
  ) {
    this.random = options.random ?? Math.random;
  }

  get running(): boolean {
    return this.active;
  }

  get currentTrack(): string | null {
    return this.current;
  }

  /** Begin a match. Repeated lifecycle notifications are deliberately inert. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.failed.clear();
    this.queue = [];
    this.playNext();
  }

  /** End the match and make every outstanding callback stale. */
  stop(): void {
    if (!this.active && this.current === null) {
      this.output.stop();
      return;
    }
    this.active = false;
    this.generation++;
    this.queue = [];
    this.current = null;
    this.output.stop();
  }

  private playNext(): void {
    if (!this.active) return;
    // Every track is attempted at most once per match. A persistent load
    // failure must not become a retry loop.
    while (this.failed.size < MATCH_TRACKS.length) {
      if (this.queue.length === 0) this.queue = this.buildCycle();
      const track = this.queue.shift();
      if (!track || this.failed.has(track)) continue;
      this.current = track;
      const generation = ++this.generation;
      let settled = false;
      const finish = (failed: boolean): void => {
        if (settled || !this.active || generation !== this.generation) return;
        settled = true;
        if (failed) {
          this.failed.add(track);
          this.current = null;
        } else {
          this.last = track;
        }
        this.playNext();
      };
      try {
        this.output.playTrack(track, {
          onEnded: () => finish(false),
          onError: () => finish(true),
        });
      } catch {
        finish(true);
      }
      return;
    }
    this.active = false;
    this.current = null;
  }

  /** One shuffled pass over all three tracks. */
  private buildCycle(): string[] {
    const cycle = [...MATCH_TRACKS];
    for (let i = cycle.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [cycle[i], cycle[j]] = [cycle[j], cycle[i]];
    }
    // The previous match's last track is not the first track of this one.
    if (cycle.length > 1 && cycle[0] === this.last) {
      [cycle[0], cycle[1]] = [cycle[1], cycle[0]];
    }
    return cycle;
  }
}
