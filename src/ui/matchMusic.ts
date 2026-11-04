import {
  MUSIC_TRACKS_BY_ID,
  musicTrack,
} from './musicCatalogue';
import {
  enabledMusicTrackIds,
  musicPlaylistKey,
  normaliseMusicPlaylist,
  type MusicPlaylistPreferences,
} from './musicPlaylist';

/**
 * Battle soundtrack playback.
 *
 * AudioEngine still owns the single reusable media element; this controller
 * owns the player's playlist, the order of a pass, previews, and the choice of
 * what should be heard after a track ends. It is deliberately independent of
 * the menu theme and of the simulation.
 */

export interface MatchMusicSnapshot {
  trackId: string | null;
  title: string | null;
  src: string | null;
  /** A match is active, even if the playlist is currently empty. */
  running: boolean;
  playing: boolean;
  paused: boolean;
  /** This track was started from the editor as an audition. */
  preview: boolean;
  enabledCount: number;
}

export interface MatchMusicOutput {
  /** Start one track. Exactly one completion/error callback follows. */
  playTrack(
    src: string,
    handlers: { onEnded: () => void; onError: () => void },
    options?: { fade?: boolean },
  ): void;
  stop(): void;
  pause(): void;
  /** Returns false when there is no media to resume. */
  resume(): boolean;
}

export interface MatchMusicOptions {
  /** Injectable for deterministic tests; a fresh order is drawn per pass. */
  random?: () => number;
  /** Initial playlist, primarily for tests and previews before settings load. */
  preferences?: unknown;
}

export class MatchMusic {
  private prefs: MusicPlaylistPreferences;
  private playlistKey: string;
  private queue: string[] = [];
  private history: string[] = [];
  private failed = new Set<string>();
  private currentId: string | null = null;
  private active = false;
  private playing = false;
  private paused = false;
  private previewing = false;
  private cycleHasPlayed = false;
  private lastPlayed: string | null = null;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly random: () => number;

  constructor(
    private readonly output: MatchMusicOutput,
    options: MatchMusicOptions = {},
  ) {
    this.random = options.random ?? Math.random;
    this.prefs = normaliseMusicPlaylist(options.preferences ?? null);
    this.playlistKey = musicPlaylistKey(this.prefs);
  }

  get running(): boolean {
    return this.active;
  }

  get currentTrack(): string | null {
    return this.currentId ? (musicTrack(this.currentId)?.src ?? null) : null;
  }

  get currentTrackId(): string | null {
    return this.currentId;
  }

  get preferences(): MusicPlaylistPreferences {
    return {
      ...this.prefs,
      order: [...this.prefs.order],
      enabled: [...this.prefs.enabled],
    };
  }

  get snapshot(): MatchMusicSnapshot {
    const track = this.currentId ? musicTrack(this.currentId) : undefined;
    return {
      trackId: this.currentId,
      title: track?.title ?? null,
      src: track?.src ?? null,
      running: this.active,
      playing: this.playing,
      paused: this.paused,
      preview: this.previewing,
      enabledCount: this.prefs.enabled.length,
    };
  }

  onStateChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Begin a match. Duplicate lifecycle notifications are deliberately inert. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.failed.clear();
    this.queue = [];
    this.history = [];
    this.currentId = null;
    this.previewing = false;
    this.playing = false;
    this.paused = false;
    this.cycleHasPlayed = false;
    this.generation++;
    this.output.stop();
    this.playNext({ auto: false, fade: false });
  }

  /** End the match and make every outstanding callback stale. */
  stop(): void {
    if (!this.active && this.currentId === null) {
      this.output.stop();
      return;
    }
    this.active = false;
    this.generation++;
    this.queue = [];
    this.history = [];
    this.currentId = null;
    this.previewing = false;
    this.playing = false;
    this.paused = false;
    this.output.stop();
    this.notify();
  }

  /** Apply persisted settings. An unchanged playlist is a no-op. */
  setPreferences(value: unknown): void {
    const next = normaliseMusicPlaylist(value);
    const nextKey = musicPlaylistKey(next);
    if (nextKey === this.playlistKey) return;

    const before = this.prefs;
    const orderChanged = next.order.join(',') !== before.order.join(',');
    const shuffleChanged = next.shuffle !== before.shuffle;
    const previouslyEnabled = new Set(before.enabled);

    this.prefs = next;
    this.playlistKey = nextKey;
    for (const id of next.enabled) {
      // A track re-enabled by the player gets another chance after a load error.
      if (!previouslyEnabled.has(id)) this.failed.delete(id);
    }
    if (orderChanged || shuffleChanged) {
      this.queue = [];
      this.cycleHasPlayed = false;
    } else {
      this.queue = this.queue.filter((id) => this.isEligible(id));
    }

    const currentEligible = this.currentId ? this.isEligible(this.currentId) : false;
    if (this.currentId && !currentEligible) {
      // Removing the current track (or disabling it) hands playback to the next
      // eligible track instead of leaving a stale source running.
      this.currentId = null;
      this.previewing = false;
      this.playing = false;
      this.paused = false;
      if (this.active) {
        this.queue = [];
        this.playNext({ auto: false, fade: true });
      } else {
        this.output.stop();
        this.notify();
      }
      return;
    }

    if (this.active && !this.currentId) {
      // The playlist was empty and a track has just been enabled again.
      this.queue = [];
      this.playNext({ auto: false, fade: false });
      return;
    }
    this.notify();
  }

  /** Audition any catalogue track without changing the saved playlist. */
  preview(id: string): void {
    const track = musicTrack(id);
    if (!track) return;
    this.failed.delete(id);
    if (this.active && this.currentId && !this.previewing && this.currentId !== id) {
      this.history.push(this.currentId);
      this.trimHistory();
    }
    this.playId(id, { preview: true, fade: true, fromPlaylist: false });
  }

  next(): void {
    const eligible = this.eligibleIds();
    if (eligible.length === 0) return;

    if (!this.active) {
      const current = this.currentId ? eligible.indexOf(this.currentId) : -1;
      this.preview(eligible[(current + 1) % eligible.length]);
      return;
    }

    const leaving = this.currentId;
    if (leaving && !this.previewing) {
      this.history.push(leaving);
      this.trimHistory();
      this.lastPlayed = leaving;
    }
    this.currentId = null;
    this.previewing = false;
    this.playing = false;
    this.paused = false;
    this.playNext({ auto: false, fade: true });
  }

  previous(): void {
    const eligible = this.eligibleIds();
    if (eligible.length === 0) return;

    const leaving = this.currentId;
    let target = this.history.pop();
    if (!target || !eligible.includes(target)) {
      const current = leaving ? eligible.indexOf(leaving) : 0;
      target = eligible[(current - 1 + eligible.length) % eligible.length];
    }

    // Returning to the previous track must not lose the track we just left, or
    // the following "next" would skip it.
    if (this.active && leaving && !this.previewing && leaving !== target) {
      this.queue.unshift(leaving);
    }

    this.currentId = null;
    this.playing = false;
    this.paused = false;
    this.previewing = !this.active;
    this.playId(target, { preview: !this.active, fade: true, fromPlaylist: false });
  }

  togglePause(): void {
    if (!this.currentId) {
      if (this.active) {
        this.playNext({ auto: false, fade: false });
      } else {
        const eligible = this.eligibleIds();
        if (eligible.length > 0) this.preview(eligible[0]);
      }
      return;
    }
    if (this.playing) {
      this.output.pause();
      this.playing = false;
      this.paused = true;
      this.notify();
      return;
    }
    if (!this.output.resume()) return;
    this.playing = true;
    this.paused = false;
    this.notify();
  }

  private isEligible(id: string): boolean {
    return (
      this.prefs.enabled.includes(id) &&
      MUSIC_TRACKS_BY_ID.has(id) &&
      !this.failed.has(id)
    );
  }

  private eligibleIds(): string[] {
    return enabledMusicTrackIds(this.prefs).filter((id) => this.isEligible(id));
  }

  private trimHistory(): void {
    if (this.history.length > 50) this.history.shift();
  }

  private playNext(options: { auto: boolean; fade: boolean }): void {
    if (!this.active) return;
    const eligible = this.eligibleIds();
    if (eligible.length === 0) {
      // An empty playlist keeps the match running so enabling a track resumes
      // it. If tracks are enabled but every one has failed to load, the pass is
      // over and the controller stops cleanly instead of retrying forever.
      this.stopPlayback(enabledMusicTrackIds(this.prefs).length > 0);
      return;
    }

    if (options.auto && this.prefs.repeat === 'one' && this.currentId && !this.previewing) {
      this.playId(this.currentId, { preview: false, fade: false, fromPlaylist: false });
      return;
    }

    // Repeat off plays one pass of the current playlist and then rests. A manual
    // Next still starts another pass, and enabling a track later resumes.
    if (
      options.auto &&
      this.prefs.repeat === 'off' &&
      this.cycleHasPlayed &&
      this.queue.length === 0
    ) {
      this.stopPlayback(false);
      return;
    }

    if (this.queue.length === 0) this.queue = this.buildCycle();
    while (this.queue.length > 0) {
      const id = this.queue.shift();
      if (!id || !this.isEligible(id)) continue;
      this.playId(id, { preview: false, fade: options.fade, fromPlaylist: true });
      return;
    }
    this.stopPlayback(enabledMusicTrackIds(this.prefs).length > 0);
  }

  private buildCycle(): string[] {
    const cycle = this.eligibleIds();
    if (!this.prefs.shuffle) return cycle;
    for (let i = cycle.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [cycle[i], cycle[j]] = [cycle[j], cycle[i]];
    }
    // Do not open a new shuffled pass with the track that just finished.
    if (cycle.length > 1 && cycle[0] === this.lastPlayed) {
      [cycle[0], cycle[1]] = [cycle[1], cycle[0]];
    }
    return cycle;
  }

  private playId(
    id: string,
    options: { preview: boolean; fade: boolean; fromPlaylist: boolean },
  ): void {
    const track = musicTrack(id);
    if (!track) {
      this.failed.add(id);
      this.currentId = null;
      this.previewing = false;
      this.playing = false;
      this.paused = false;
      if (this.active) this.playNext({ auto: true, fade: false });
      else this.output.stop();
      this.notify();
      return;
    }

    this.currentId = id;
    this.previewing = options.preview;
    this.playing = true;
    this.paused = false;
    if (options.fromPlaylist) this.cycleHasPlayed = true;

    const generation = ++this.generation;
    let settled = false;
    const finish = (failed: boolean): void => {
      if (settled || generation !== this.generation) return;
      settled = true;
      this.playing = false;
      this.paused = false;

      if (failed) {
        this.failed.add(id);
        if (this.currentId === id) this.currentId = null;
        this.previewing = false;
        if (this.active) this.playNext({ auto: true, fade: false });
        else {
          this.output.stop();
          this.notify();
        }
        return;
      }

      // A preview outside a match ends quietly. Inside a match it hands back to
      // the playlist rather than replacing the player's saved configuration.
      if (!this.active) {
        if (this.currentId === id) this.currentId = null;
        this.previewing = false;
        this.output.stop();
        this.notify();
        return;
      }
      if (this.previewing) {
        this.previewing = false;
        this.currentId = null;
        this.playNext({ auto: false, fade: false });
        return;
      }

      this.lastPlayed = id;
      if (this.prefs.repeat !== 'one') {
        this.history.push(id);
        this.trimHistory();
      }
      if (this.prefs.repeat === 'one') {
        this.playId(id, { preview: false, fade: false, fromPlaylist: false });
        return;
      }
      this.currentId = null;
      this.playNext({ auto: true, fade: false });
    };

    try {
      this.output.playTrack(
        track.src,
        { onEnded: () => finish(false), onError: () => finish(true) },
        { fade: options.fade },
      );
    } catch {
      finish(true);
    }
    this.notify();
  }

  private stopPlayback(endMatch = false): void {
    this.currentId = null;
    this.previewing = false;
    this.playing = false;
    this.paused = false;
    this.queue = [];
    if (endMatch) this.active = false;
    this.output.stop();
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A settings panel must never be able to break audio playback.
      }
    }
  }
}
