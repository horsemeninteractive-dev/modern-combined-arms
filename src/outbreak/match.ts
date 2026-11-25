/**
 * One Outbreak run, attached to a live `Game`.
 *
 * This is the bridge between the deterministic wave director and MCA's
 * simulation. It does three things and nothing else:
 *   1. feeds the director the field counts and places the bodies it asks for,
 *   2. points the horde at targets worth attacking, using the same order queue
 *      every player command travels through,
 *   3. turns the match's own events into survival statistics.
 *
 * It never moves a zombie by hand, never applies damage itself and never
 * decides an outcome: movement, combat, destruction and the defeat rule remain
 * the simulation's. That is what keeps solo and co-op identical and what makes
 * the mode compatible with the authoritative room.
 */
import type { Game } from '../sim/game';
import type { Entity } from '../sim/types';
import { TICK_RATE, TILE_SIZE } from '../sim/constants';
import { Rng } from '../core/rng';
import { zombieDefId, zombieKindOf, INFECTED_FACTION_ID } from '../data/zombies';
import { isCaptureObjective } from '../data/buildings';
import { outbreakDifficulty } from './config';
import {
  PICKUP_LIFETIME_SECONDS,
  collectPickup,
  rollPickup,
  type Pickup,
} from './pickups';
import { OutbreakDirector, type DirectorEvent, type WaveHost } from './director';
import type {
  OutbreakEntryRegion,
  OutbreakHudPickup,
  OutbreakHudState,
  OutbreakResult,
  OutbreakPhase,
  OutbreakScenarioConfig,
  OutbreakStats,
  ZombieKind,
} from './types';
import { ZOMBIE_KINDS } from './types';

/** How often one zombie reconsiders what it is walking at, in ticks. */
const RETARGET_TICKS = 24;
/** Zombies this close to a soldier will always prefer it to concrete. */
const LOCAL_UNIT_RADIUS = 11 * TILE_SIZE;
/** Beyond this, a structure is not "on the way" — the Command Post is the goal. */
const STRUCTURE_SEARCH_RADIUS = 34 * TILE_SIZE;
/** How far a mark may drift before a marching body needs a fresh route. */
const MARCH_TOLERANCE = 2 * TILE_SIZE;
/**
 * How long a body may stand with no route and nothing to attack before the host
 * takes it off the field.
 *
 * The pathfinder refuses ground it cannot cross; the simulation then clears the
 * order and leaves the body standing where it is. Waiting longer cannot help —
 * it holds no route to run and no target to fight, so it will never arrive and
 * never die — and until it goes it counts against `maxAlive` and taxes the
 * cleanup of every later wave. The grace is far longer than a re-plan or a jam
 * takes to clear, so only a genuinely stranded body is ever removed.
 */
export const STRANDED_DESPAWN_SECONDS = 20;
/** Ticks between stranded sweeps: four a second, over the whole field. */
const STRANDED_SWEEP_TICKS = 5;
/** Inside this distance of its march, a body has arrived rather than been refused. */
const ARRIVED_TOLERANCE = 2 * TILE_SIZE;

export interface OutbreakSaveState {
  director: ReturnType<OutbreakDirector['toState']>;
  stats: OutbreakStats;
  eventSeq: number;
  rngState: number;
  /** Drops still lying on the field when the match was written. */
  pickups?: Pickup[];
  nextPickupId?: number;
}

export class OutbreakMatch implements WaveHost {
  readonly config: OutbreakScenarioConfig;
  readonly director: OutbreakDirector;
  readonly infectedOwner: number;
  private readonly rng: Rng;
  private readonly announcements: DirectorEvent[] = [];
  private lastEventSeq: number;
  private stats: OutbreakStats;
  private commandPostLost = false;
  /** Tick at which each body was first seen with no route and no target. */
  private readonly strandedSince = new Map<number, number>();
  /** Drops on the field that nobody has walked over yet. */
  private pickups: Pickup[] = [];
  private nextPickupId = 1;

  constructor(
    readonly game: Game,
    scenario: OutbreakScenarioConfig,
    seed: number,
  ) {
    this.config = scenario;
    const tuning = outbreakDifficulty(scenario.difficulty);
    this.director = new OutbreakDirector(
      scenario.difficulty,
      tuning,
      scenario,
      seed,
      scenario.entryRegions,
    );
    this.director.onEvent((event) => this.announcements.push(event));
    this.rng = new Rng((seed ^ 0x5bf03635) >>> 0);
    const infected = game.state.scenario.players.find(
      (player) => player.factionId === INFECTED_FACTION_ID,
    );
    this.infectedOwner = infected?.id ?? -1;
    this.lastEventSeq = game.state.eventSeq;
    const defenders = game.state.players.filter((player) => player.id !== this.infectedOwner);
    this.stats = {
      wave: this.director.wave,
      wavesCompleted: 0,
      zombiesKilled: 0,
      killsByKind: { shambler: 0, runner: 0, brute: 0, bloater: 0, crawler: 0, flyer: 0 },
      structuresLost: 0,
      unitsLost: 0,
      matsGathered: 0,
      durationSeconds: 0,
      difficulty: scenario.difficulty,
      mode: scenario.mode,
      players: scenario.mode === 'coop' ? 2 : 1,
      nations: defenders.map((player) => player.factionId),
    };
  }

  /* ---------------------------------------------------------------- */
  /* WaveHost                                                          */
  /* ---------------------------------------------------------------- */

  get regions(): readonly OutbreakEntryRegion[] {
    return this.config.entryRegions;
  }

  get aliveInfected(): number {
    let alive = 0;
    for (const entity of this.game.state.entities) {
      if (entity.kind === 'unit' && entity.hp > 0 && entity.owner === this.infectedOwner) alive++;
    }
    return alive;
  }

  spawn(kind: ZombieKind, region: OutbreakEntryRegion): boolean {
    const defId = zombieDefId(kind);
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = this.rng.next() * Math.PI * 2;
      const radius = Math.sqrt(this.rng.next()) * region.radius;
      const x = (region.x + Math.cos(angle) * radius + 0.5) * TILE_SIZE;
      const z = (region.z + Math.sin(angle) * radius + 0.5) * TILE_SIZE;
      const entity = this.game.spawnInfected(defId, x, z, this.infectedOwner);
      if (entity) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* Tick                                                              */
  /* ---------------------------------------------------------------- */

  /** One authoritative tick: director first, then orders, then statistics. */
  update(dt: number): void {
    const post = this.commandPost();
    if (!post) {
      // The Command Post is the run. Once it is gone there is nothing left for
      // the director to schedule; the simulation's own defeat rule ends it.
      this.commandPostLost = true;
      return;
    }
    this.director.update(this, dt);
    this.issueOrders();
    this.sweepStranded();
    this.updatePickups();
    this.collectStats();
  }

  /**
   * Claims, expiry and the readout the renderer draws.
   *
   * A drop is only claimable a few ticks after it falls, so the beacon is on the
   * ground for a moment rather than being swallowed by the unit that happened to
   * be standing over the kill.
   */
  private updatePickups(): void {
    if (this.pickups.length === 0) return;
    const tick = this.game.state.tick;
    const lifetime = PICKUP_LIFETIME_SECONDS * this.director.tickRate;
    const kept: Pickup[] = [];
    for (const pickup of this.pickups) {
      const age = tick - pickup.tick;
      if (age > lifetime) continue;
      if (age > 3 && collectPickup(this.game, pickup, this.infectedOwner)) continue;
      kept.push(pickup);
    }
    this.pickups = kept;
  }

  /** Drops still on the field, for the renderer's beacons. */
  get activePickups(): readonly Pickup[] {
    return this.pickups;
  }

  /** Roll a death for a drop. Deaths are rare sources, so most roll nothing. */
  private dropFor(x: number, z: number): void {
    const drop = rollPickup(this.rng, x, z, this.game.state.tick, this.nextPickupId);
    if (!drop) return;
    this.nextPickupId++;
    this.pickups.push(drop);
  }

  /**
   * Point the horde at the base.
   *
   * Each zombie reconsiders every `RETARGET_TICKS` ticks, staggered by id, so a
   * field of 150 bodies costs a handful of target scans per tick rather than
   * 150. A soldier close by outranks concrete; otherwise the nearest player
   * structure inside the search radius is the objective, and the Command Post is
   * the fallback. That is what stops the horde hugging a wall it cannot path
   * around and what makes a forward bunker a real tripwire.
   */
  private issueOrders(): void {
    const game = this.game;
    const tick = game.state.tick;
    const team = game.teamOf(this.infectedOwner);
    const defenders = game.state.players.filter((player) => player.id !== this.infectedOwner);
    const defenderIds = new Set(defenders.map((player) => player.id));
    const post = this.commandPost();
    let batch: number[] = [];
    let batchX = 0;
    let batchZ = 0;
    let batchKey = '';
    const flush = (): void => {
      if (batch.length === 0) return;
      game.enqueueCommand({
        type: 'move',
        team,
        ids: batch,
        x: batchX,
        z: batchZ,
        attackMove: true,
      });
      batch = [];
    };
    for (const zombie of game.state.entities) {
      if (zombie.kind !== 'unit' || zombie.hp <= 0) continue;
      if (zombie.owner !== this.infectedOwner) continue;
      if ((tick + zombie.id) % RETARGET_TICKS !== 0) continue;
      if (zombie.order && zombie.order.type === 'attack' && tick % (RETARGET_TICKS * 2) !== 0) {
        continue;
      }
      const target = this.chooseTarget(zombie, defenderIds, post);
      if (!target) continue;
      // Re-issuing the same march would re-plan the same route: a body already
      // walking at this mark is only reconsidered so the director can notice
      // that the mark moved under it. This is what keeps a 500-body horde from
      // paying for 500 fresh path searches every second.
      const marching = zombie.path.length > 0 && zombie.blockedTicks === 0;
      if (
        marching &&
        (zombie.order?.type === 'attackMove' || zombie.order?.type === 'move') &&
        Math.hypot(zombie.destX - target.x, zombie.destZ - target.z) <= MARCH_TOLERANCE
      ) {
        continue;
      }
      const key = `t:${target.id}`;
      const gx = target.x;
      const gz = target.z;
      if (key !== batchKey) {
        flush();
        batchKey = key;
        batchX = gx;
        batchZ = gz;
      }
      batch.push(zombie.id);
    }
    flush();
  }

  private chooseTarget(
    zombie: Entity,
    defenderIds: ReadonlySet<number>,
    post: Entity | null,
  ): Entity | null {
    let bestUnit: Entity | null = null;
    let bestUnitDistance = LOCAL_UNIT_RADIUS;
    let bestStructure: Entity | null = null;
    let bestStructureDistance = STRUCTURE_SEARCH_RADIUS;
    for (const candidate of this.game.state.entities) {
      if (candidate.hp <= 0 || !defenderIds.has(candidate.owner)) continue;
      if (candidate.kind === 'unit' && candidate.garrisonId) continue;
      const distance = Math.hypot(candidate.x - zombie.x, candidate.z - zombie.z);
      if (candidate.kind === 'unit') {
        if (distance < bestUnitDistance) {
          bestUnitDistance = distance;
          bestUnit = candidate;
        }
        continue;
      }
      // Capture-only objectives are not targets. A relay or a supply depot
      // cannot be destroyed, so a horde sent at one arrives, attacks masonry
      // that will never fall and stops being a wave; those buildings are taken
      // by an engineer, never by a claw. A seizable emplacement — a bunker, a gun
      // pit — is ordinary concrete and stays on the list: once a defender crews
      // it, it is a position the wave has to reduce.
      if (isCaptureObjective(candidate.defId)) continue;
      // Structures are scored by role: a turret or production building is a
      // better target than a wall segment, and the Command Post is best of all.
      const bias = candidate === post ? 0.45 : isDefence(candidate.defId) ? 0.6 : 1;
      const score = distance * bias;
      if (score < bestStructureDistance) {
        bestStructureDistance = score;
        bestStructure = candidate;
      }
    }
    if (bestUnit) return bestUnit;
    return bestStructure ?? post;
  }

  /**
   * Take bodies the pathfinder has given up on off the field.
   *
   * `issueOrders` asks for a route every second or so; where the ground has no
   * answer the simulation clears the order and leaves the body standing. Such a
   * body is left alone for `STRANDED_DESPAWN_SECONDS` first, so one waiting on
   * its next order, or on a jam that clears, is never removed for a pause — and
   * then it is despawned, not killed: no `unitLost` is emitted, so the survival
   * tally scores nothing and no drop is rolled.
   */
  private sweepStranded(): void {
    if (this.game.state.tick % STRANDED_SWEEP_TICKS !== 0) return;
    const tick = this.game.state.tick;
    const window = STRANDED_DESPAWN_SECONDS * TICK_RATE;
    const living = new Set<number>();
    for (const entity of this.game.state.entities) {
      if (entity.kind !== 'unit' || entity.hp <= 0 || entity.owner !== this.infectedOwner) continue;
      living.add(entity.id);
      if (!isStranded(entity)) {
        this.strandedSince.delete(entity.id);
        continue;
      }
      const since = this.strandedSince.get(entity.id);
      if (since === undefined) {
        this.strandedSince.set(entity.id, tick);
        continue;
      }
      if (tick - since < window) continue;
      this.strandedSince.delete(entity.id);
      this.game.despawn(entity);
    }
    for (const id of this.strandedSince.keys()) if (!living.has(id)) this.strandedSince.delete(id);
  }

  private commandPost(): Entity | null {
    const defenderIds = new Set(
      this.game.state.players
        .filter((player) => player.id !== this.infectedOwner)
        .map((player) => player.id),
    );
    for (const entity of this.game.state.entities) {
      if (entity.kind !== 'building' || entity.hp <= 0) continue;
      if (!defenderIds.has(entity.owner)) continue;
      if (entity.defId === 'commandPost') return entity;
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Statistics                                                        */
  /* ---------------------------------------------------------------- */

  private collectStats(): void {
    const game = this.game;
    const events = game.eventsAfter(this.lastEventSeq);
    for (const event of events) {
      this.lastEventSeq = Math.max(this.lastEventSeq, event.seq);
      if (event.type === 'unitLost') {
        const kind = event.defId ? zombieKindOf(event.defId) : null;
        if (kind) {
          this.stats.zombiesKilled++;
          this.stats.killsByKind[kind]++;
          this.dropFor(event.x, event.z);
        } else if (event.team !== game.teamOf(this.infectedOwner)) {
          this.stats.unitsLost++;
        }
      } else if (event.type === 'buildingLost') {
        if (event.team !== game.teamOf(this.infectedOwner)) this.stats.structuresLost++;
        if (event.defId === 'commandPost') this.commandPostLost = true;
      }
    }
    // One defending army, in both modes: an Outbreak scenario has the defender
    // at id 0 and the Infected at id 1, and a co-op room seats both commanders
    // on that same player. So this is the pair's gathered total, not one seat's
    // share, and there is no second pool to add.
    const defender = game.player(0);
    if (defender) this.stats.matsGathered = defender.stats.matsGathered;
    // The simulation's own clock, not a second one: the rest of the engine
    // converts ticks with TICK_RATE, and a hard-coded 30 made every survival
    // card and leaderboard entry report two thirds of the time actually held.
    this.stats.durationSeconds = game.state.tick / TICK_RATE;
    this.stats.wave = this.director.wave;
    // A wave counts as completed only once its own cleanup beat has ended: the
    // director's phase is the only clock that knows the field is clear and the
    // recovery has begun.
    this.stats.wavesCompleted =
      this.director.phase === 'complete' ? this.director.wave : Math.max(0, this.director.wave - 1);
  }

  /** Wave announcements the presentation layer has not shown yet. */
  drainAnnouncements(): DirectorEvent[] {
    return this.announcements.splice(0, this.announcements.length);
  }

  /** Seconds until the next assault opens, or 0 during one. */
  get secondsToAssault(): number {
    return this.director.secondsToAssault;
  }

  get phase(): OutbreakPhase {
    return this.director.phase;
  }

  get wave(): number {
    return this.director.wave;
  }

  get unspawned(): number {
    return this.director.unspawned;
  }

  get statistics(): Readonly<OutbreakStats> {
    return { ...this.stats, killsByKind: { ...this.stats.killsByKind } };
  }

  /**
   * The readout a remote seat renders. A networked client ticks no simulation,
   * so this is the only place its wave panel and survival card can come from.
   */
  hudState(): OutbreakHudState {
    const stats = this.statistics;
    return {
      wave: this.wave,
      phase: this.phase,
      secondsToAssault: Math.max(0, Math.round(this.secondsToAssault)),
      unspawned: this.unspawned,
      aliveInfected: this.aliveInfected,
      prepSeconds: this.director.plan?.prepSeconds ?? 0,
      wavesCompleted: stats.wavesCompleted,
      zombiesKilled: stats.zombiesKilled,
      killsByKind: { ...stats.killsByKind },
      structuresLost: stats.structuresLost,
      unitsLost: stats.unitsLost,
      matsGathered: Math.round(stats.matsGathered),
      durationSeconds: Math.round(stats.durationSeconds),
      difficulty: stats.difficulty,
      mode: stats.mode,
      players: stats.players,
      nations: [...stats.nations],
      pickups: this.pickups.map((pickup) => ({
        id: pickup.id,
        kind: pickup.kind,
        x: pickup.x,
        z: pickup.z,
      })),
    };
  }

  /**
   * Adopt the room's drops on a networked seat.
   *
   * A remote seat ticks no simulation of its own, so it never rolls a drop and
   * never walks a unit onto one. The room publishes the list with the rest of
   * the survival readout, and this puts it where the renderer already looks, so
   * a co-op player sees the same crates and beacons the host does.
   */
  applyRemotePickups(pickups: readonly OutbreakHudPickup[]): void {
    this.pickups = pickups.map((pickup) => ({
      id: pickup.id,
      kind: pickup.kind,
      x: pickup.x,
      z: pickup.z,
      tick: 0,
    }));
  }

  /** The result card's data. Only meaningful once the Command Post has fallen. */
  result(): OutbreakResult {
    return {
      ...this.statistics,
      ended: true,
      commandPostLost: this.commandPostLost || this.commandPost() === null,
    };
  }

  /** Serialisable state, so a future save path can restore the wave rhythm. */
  toSave(): OutbreakSaveState {
    return {
      director: this.director.toState(),
      stats: this.statistics,
      eventSeq: this.lastEventSeq,
      rngState: this.rng.getState(),
      pickups: this.pickups.map((pickup) => ({ ...pickup })),
      nextPickupId: this.nextPickupId,
    };
  }

  restore(save: OutbreakSaveState): void {
    this.pickups = (save.pickups ?? []).map((pickup) => ({ ...pickup }));
    this.nextPickupId = save.nextPickupId ?? 1;
    this.director.restore(save.director);
    this.stats = { ...save.stats, killsByKind: { ...save.stats.killsByKind } };
    this.lastEventSeq = save.eventSeq;
    this.rng.setState(save.rngState);
  }
}

/**
 * True when the field has nothing for this body: no route to run, no target to
 * fight, and no march it is close enough to count as having arrived at. A body
 * that reached the point it was sent to is quiet, not stranded, and is left be.
 */
function isStranded(zombie: Entity): boolean {
  if (zombie.path.length > 0) return false;
  if (zombie.targetId !== 0 || zombie.aimTargetId !== 0) return false;
  const order = zombie.order;
  if (!order) return true;
  if (order.type !== 'move' && order.type !== 'attackMove') return false;
  // A march without a mark cannot be judged against one: leave it to the sim.
  if (order.x === undefined || order.z === undefined) return false;
  return Math.hypot(order.x - zombie.x, order.z - zombie.z) > ARRIVED_TOLERANCE;
}

/** Defensive emplacements the horde should treat as obstacles worth clearing. */
const DEFENCE_IDS = new Set([
  'mgNest',
  'atTurret',
  'samBattery',
  'coastalBattery',
  'entrenchedAtGun',
  'bunker',
  'watchtower',
  'forwardPost',
]);

function isDefence(defId: string): boolean {
  return DEFENCE_IDS.has(defId);
}

/** Every archetype, for validation and the results table. */
export const OUTBREAK_KINDS = ZOMBIE_KINDS;
