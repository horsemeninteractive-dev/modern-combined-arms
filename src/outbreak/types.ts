/**
 * Outbreak — shared vocabulary for the survival mode.
 *
 * These are the types that cross module boundaries: the authored scenario
 * block, the wave plan the director hands to the spawner, the live phase state
 * and the result record. They are deliberately free of `Game` imports so the
 * scenario catalogue and the HUD can name an Outbreak match without pulling the
 * simulation into their graph.
 */
import type { OutbreakDifficulty } from '../sim/scenario';

/** How many commanders share the defence. Co-op is one force, two seats. */
export type OutbreakMode = 'solo' | 'coop';

/** The authored archetypes. Ordering is presentation order. */
export type ZombieKind = 'shambler' | 'runner' | 'brute' | 'bloater' | 'crawler' | 'flyer';

export const ZOMBIE_KINDS: readonly ZombieKind[] = Object.freeze([
  'shambler',
  'runner',
  'brute',
  'bloater',
  'crawler',
  'flyer',
]);

/**
 * One direction the horde can come from.
 *
 * Authored on the map rather than derived from the perimeter, because the point
 * of an entry region is that it is a road, a gap or a ford with its own
 * defensive problem. `radius` is in tiles.
 */
export interface OutbreakEntryRegion {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
}

/** The Outbreak block carried on `scenario.meta.outbreak`. */
export interface OutbreakScenarioConfig {
  difficulty: OutbreakDifficulty;
  mode: OutbreakMode;
  /** Where the horde enters. At least one; a map authors several. */
  entryRegions: OutbreakEntryRegion[];
  /** First wave number, so a test or a challenge run can start later. */
  startWave?: number;
}

export type OutbreakPhase =
  | 'preparation'
  | 'warning'
  | 'assault'
  | 'cleanup'
  | 'complete';

/**
 * One horde drop as the room publishes it.
 *
 * World coordinates and a kind, nothing else: a remote seat draws the crate and
 * its beacon from this and never claims it, because the authority is the one
 * that walks a unit over it and pays out.
 */
export interface OutbreakHudPickup {
  id: number;
  kind: 'mats' | 'req' | 'veterancy' | 'speed';
  x: number;
  z: number;
}

/**
 * The survival readout, exactly as the authoritative room publishes it.
 *
 * A networked seat runs no simulation of its own, so its wave clock, hostile
 * count and kill tally have to arrive from the room. This small record is the
 * whole of that handover: presentation only, and the room decides every value.
 */
export interface OutbreakHudState {
  wave: number;
  phase: OutbreakPhase;
  /** Whole seconds until the next assault, as of the sending tick. */
  secondsToAssault: number;
  unspawned: number;
  aliveInfected: number;
  prepSeconds: number;
  /**
   * The survival record. A remote seat fights the same run, so its end card
   * has to be the room's numbers, not a local tally that never ticked.
   */
  wavesCompleted: number;
  zombiesKilled: number;
  killsByKind: Record<ZombieKind, number>;
  structuresLost: number;
  unitsLost: number;
  matsGathered: number;
  durationSeconds: number;
  difficulty: OutbreakDifficulty;
  mode: OutbreakMode;
  players: number;
  nations: string[];
  /**
   * Drops still on the field. A remote seat rolls none of its own, so the room
   * has to name them or the crates and their beacons exist only on the host's
   * screen. Optional: a skirmish projection and older rooms carry no drops.
   */
  pickups?: OutbreakHudPickup[];
}

/**
 * How a wave arrives, as distinct from how many bodies it brings.
 *
 * `steady` is the original trickle: one batch every `spawnIntervalSeconds`.
 * `sprint` keeps that schedule and multiplies the fast archetypes' share of the
 * mix, so the horde reads as a charge rather than a walk. `push` keeps the mix
 * and changes the arrival: a stretch of trickle, then a held block that lands in
 * a single instant, then a short tail.
 *
 * A shape never touches a zombie's hit points. It decides which bodies turn up,
 * in what proportion, and when — nothing else.
 */
export type WaveShape = 'steady' | 'sprint' | 'push';

/** One wave, as the director plans it. Pure data: no live entities. */
export interface WavePlan {
  wave: number;
  total: number;
  composition: Record<ZombieKind, number>;
  /** Assault groups; each group takes its own entry region. */
  groups: number;
  /** Seconds between spawn batches inside the assault. */
  spawnIntervalSeconds: number;
  /** Seconds of preparation before this wave's warning. */
  prepSeconds: number;
  /** Hard cap on simultaneously living zombies for this wave. */
  maxAlive: number;
  /** Arrival pattern beyond the body count. */
  shape: WaveShape;
  /**
   * Index into the spawn order where a push wave's wall opens, 0 when the wave
   * has none: everything before it trickles, then `pushSize` arrive together.
   */
  pushAt: number;
  /** Bodies released in one instant when the push opens; 0 when there is none. */
  pushSize: number;
}

/** Live, serialisable wave state. Saved with the match so a reload keeps rhythm. */
export interface OutbreakDirectorState {
  wave: number;
  phase: OutbreakPhase;
  /** Ticks elapsed inside the current phase. */
  phaseTicks: number;
  /** Zombies still to spawn this wave, in spawn order. */
  pending: Array<{ kind: ZombieKind; regionId: string }>;
  /** Next spawn index into `pending`. */
  spawned: number;
  /** Ticks until the next batch, inside an assault. */
  spawnTimer: number;
  /**
   * Whether this wave's push has already been released. Persisted with the rest
   * of the wave state: a reload must not land the same wall a second time.
   */
  pushOpen: boolean;
  /** The plan for the active wave, or the one being prepared for. */
  plan: WavePlan | null;
  /** RNG state for wave planning, kept apart from the simulation's own stream. */
  rngState: number;
  /**
   * Lowest living count seen since the assault ended. Cleanup is bounded on this
   * floor rather than on elapsed time, so a slow kill still counts as progress.
   */
  stallFloor: number;
  /** Ticks the living count has stayed at or above `stallFloor`. */
  stallTicks: number;
}

/** Everything the result card and a future leaderboard read. */
export interface OutbreakStats {
  wave: number;
  wavesCompleted: number;
  zombiesKilled: number;
  killsByKind: Record<ZombieKind, number>;
  structuresLost: number;
  unitsLost: number;
  matsGathered: number;
  durationSeconds: number;
  difficulty: OutbreakDifficulty;
  mode: OutbreakMode;
  players: number;
  nations: string[];
}

export interface OutbreakResult extends OutbreakStats {
  /** True once the Command Post has fallen. */
  ended: true;
  commandPostLost: boolean;
}
