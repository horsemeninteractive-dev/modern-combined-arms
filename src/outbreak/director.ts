/**
 * The wave director.
 *
 * One deterministic state machine owns the rhythm of an Outbreak run: when the
 * next wave is announced, what it is made of, which approach each group takes,
 * how fast it arrives, and when the wave is over. It never touches a renderer, a
 * clock or `Math.random` — the host supplies the simulation tick and the spawn
 * call, and the director's own seeded stream supplies the variation.
 *
 * That split is what makes both requirements true at once: a co-op room runs the
 * same machine on the authoritative host, and a test can drive it with a fake
 * host and a fixed seed.
 */
import { TICK_RATE } from '../sim/constants';
import type { OutbreakDifficulty } from '../sim/scenario';
import { planWave, spawnOrder, type OutbreakDifficultyConfig } from './config';
import { Rng } from '../core/rng';
import type {
  OutbreakDirectorState,
  OutbreakEntryRegion,
  OutbreakPhase,
  OutbreakScenarioConfig,
  WavePlan,
  ZombieKind,
} from './types';

/** What the director may ask of the match it drives. */
export interface WaveHost {
  /** Living infected on the field right now. */
  aliveInfected: number;
  /** Place one infected. False means the ground refused it; it stays pending. */
  spawn(kind: ZombieKind, region: OutbreakEntryRegion): boolean;
  /** The approaches this battlefield offers. */
  regions: readonly OutbreakEntryRegion[];
}

export type DirectorEventKind =
  | 'preparation'
  | 'warning'
  | 'assault'
  | 'wave-cleared'
  | 'wave-complete';

export interface DirectorEvent {
  kind: DirectorEventKind;
  wave: number;
  /** Seconds until the assault begins, for the preparation and warning beats. */
  secondsToAssault: number;
}

/** Quiet beat between the last body falling and the next preparation clock. */
const COMPLETE_PAUSE_SECONDS = 3;

export class OutbreakDirector {
  readonly difficulty: OutbreakDifficulty;
  readonly mode: OutbreakScenarioConfig['mode'];
  readonly config: OutbreakDifficultyConfig;
  private readonly rng: Rng;
  private state: OutbreakDirectorState;
  private readonly listeners: Array<(event: DirectorEvent) => void> = [];
  /** Ticks per second of the host clock, from the simulation's own constant. */
  readonly tickRate = TICK_RATE;

  constructor(
    difficulty: OutbreakDifficulty,
    config: OutbreakDifficultyConfig,
    scenario: OutbreakScenarioConfig,
    seed: number,
    private readonly regions: readonly OutbreakEntryRegion[],
  ) {
    this.difficulty = difficulty;
    this.mode = scenario.mode;
    this.config = config;
    this.rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
    this.state = {
      wave: scenario.startWave ?? 1,
      phase: 'preparation',
      phaseTicks: 0,
      pending: [],
      spawned: 0,
      spawnTimer: 0,
      plan: null,
      rngState: this.rng.getState(),
    };
    this.beginWave(this.state.wave);
    this.emit('preparation');
  }

  onEvent(listener: (event: DirectorEvent) => void): void {
    this.listeners.push(listener);
  }

  /** Snapshot for the HUD and for a save file. */
  get snapshot(): Readonly<OutbreakDirectorState> {
    return {
      ...this.state,
      pending: this.state.pending.map((entry) => ({ ...entry })),
      plan: this.state.plan ? { ...this.state.plan, composition: { ...this.state.plan.composition } } : null,
    };
  }

  get wave(): number {
    return this.state.wave;
  }

  get phase(): OutbreakPhase {
    return this.state.phase;
  }

  get plan(): WavePlan | null {
    return this.state.plan;
  }

  /** How many of this wave are still to walk onto the field. */
  get unspawned(): number {
    return Math.max(0, this.state.pending.length - this.state.spawned);
  }

  /**
   * Seconds until the assault opens: the preparation clock plus the warning
   * beat that follows it. Zero once the wave is already arriving.
   */
  get secondsToAssault(): number {
    const plan = this.state.plan;
    if (!plan) return 0;
    if (this.state.phase === 'preparation') {
      const elapsed = this.state.phaseTicks / this.tickRate;
      return Math.max(0, plan.prepSeconds - elapsed);
    }
    if (this.state.phase === 'warning') {
      const elapsed = this.state.phaseTicks / this.tickRate;
      return Math.max(0, this.config.warningSeconds - elapsed);
    }
    return 0;
  }

  /**
   * Advance one authoritative tick.
   *
   * Batches are sized so a wave arrives over roughly eighteen beats rather than
   * one body at a time, while never exceeding `plan.maxAlive` on the field. If
   * the cap is reached the remaining bodies wait, which is why the HUD can show
   * an honest "still to come" count instead of zombies vanishing.
   */
  update(host: WaveHost, dt: number): void {
    const plan = this.state.plan;
    if (!plan) return;
    this.state.phaseTicks++;
    switch (this.state.phase) {
      case 'preparation': {
        if (this.secondsToAssault <= this.config.warningSeconds) {
          this.state.phase = 'warning';
          this.state.phaseTicks = 0;
          this.emit('warning');
        }
        return;
      }
      case 'warning': {
        if (this.state.phaseTicks / this.tickRate >= this.config.warningSeconds) {
          this.state.phase = 'assault';
          this.state.phaseTicks = 0;
          this.state.spawnTimer = 0;
          this.emit('assault');
        }
        return;
      }
      case 'assault': {
        this.state.spawnTimer += dt;
        const perBatch = Math.max(1, Math.ceil(plan.total / 18));
        while (
          this.state.spawnTimer >= plan.spawnIntervalSeconds &&
          this.state.spawned < this.state.pending.length
        ) {
          this.state.spawnTimer -= plan.spawnIntervalSeconds;
          if (host.aliveInfected >= plan.maxAlive) {
            // The field is full: keep the rhythm, spend no bodies.
            break;
          }
          const room = Math.max(0, plan.maxAlive - host.aliveInfected);
          let placed = 0;
          while (
            placed < Math.min(perBatch, room) &&
            this.state.spawned < this.state.pending.length
          ) {
            const entry = this.state.pending[this.state.spawned];
            const region = this.regionFor(entry.regionId, host);
            if (!regionsKnown(host) || !region) break;
            if (!host.spawn(entry.kind, region)) break;
            this.state.spawned++;
            placed++;
          }
          if (placed === 0) break;
        }
        if (this.state.spawned >= this.state.pending.length) {
          this.state.phase = 'cleanup';
          this.state.phaseTicks = 0;
          this.emit('wave-cleared');
        }
        return;
      }
      case 'cleanup': {
        if (host.aliveInfected === 0) {
          this.state.phase = 'complete';
          this.state.phaseTicks = 0;
          this.emit('wave-complete');
        }
        return;
      }
      case 'complete': {
        if (this.state.phaseTicks / this.tickRate >= COMPLETE_PAUSE_SECONDS) {
          this.state.wave++;
          this.beginWave(this.state.wave);
          this.state.phase = 'preparation';
          this.state.phaseTicks = 0;
          this.emit('preparation');
        }
        return;
      }
    }
  }

  /** Persist the director exactly, including its own random stream. */
  toState(): OutbreakDirectorState {
    return { ...this.state, rngState: this.rng.getState() };
  }

  restore(state: OutbreakDirectorState): void {
    this.state = { ...state, pending: state.pending.map((entry) => ({ ...entry })) };
    this.rng.setState(state.rngState);
  }

  /* ---------------------------------------------------------------- */

  private beginWave(wave: number): void {
    const plan = planWave(wave, this.config, this.rng);
    this.state.plan = plan;
    this.state.pending = spawnOrder(
      plan,
      this.regions.map((region) => region.id),
      this.rng,
    );
    this.state.spawned = 0;
    this.state.spawnTimer = 0;
    this.state.rngState = this.rng.getState();
  }

  private regionFor(id: string, host: WaveHost): OutbreakEntryRegion | undefined {
    return host.regions.find((region) => region.id === id) ?? host.regions[0];
  }

  private emit(kind: DirectorEventKind): void {
    const event: DirectorEvent = {
      kind,
      wave: this.state.wave,
      secondsToAssault: this.secondsToAssault,
    };
    for (const listener of this.listeners) listener(event);
  }
}

function regionsKnown(host: WaveHost): boolean {
  return host.regions.length > 0;
}
