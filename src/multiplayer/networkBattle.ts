/**
 * Client-side battle view for a networked match.
 *
 * The room is authoritative and the client owns no simulation. What it owns is
 * a *display shell*: a real `Game` built from the same scenario the room built,
 * whose entities, players, fog, projectiles and result are replaced on every
 * update from the team-visible projection. Everything that already knows how to
 * draw a battle — the renderer, the HUD, selection and the order intents — keeps
 * working unchanged, and nothing here can invent state the server did not send.
 *
 * Two deliberate presentation rules:
 *
 * - Positions arrive at the snapshot rate, not the frame rate, so each entity
 *   is smoothed toward its authoritative transform. A jump larger than a few
 *   tiles (a resync, a reconnect or a teleporting hull) is snapped instead, so
 *   the client never slides a unit across the map.
 * - Fog, charted structures and contacts come from the projection. The client
 *   never derives visibility from hidden truth, because it does not have any.
 */
import { BUILDINGS } from '../data/buildings';
import { TILE_SIZE } from '../sim/constants';
import { UNITS } from '../data/units';
import type { Game } from '../sim/game';
import type {
  Command,
  ContactRecord,
  Entity,
  EntityState,
  PlayerState,
  Projectile,
  SimEvent,
  Stance,
  VictoryState,
} from '../sim/types';
import type { ProjectedEntity, ProjectedMatchResult, ProjectedProjectile, TeamSnapshot } from './projection';

/** World units of error tolerated before a transform is snapped, not eased. */
const SNAP_DISTANCE = TILE_SIZE * 3;
/** Higher converges faster; this is presentation only and never authoritative. */
const SMOOTHING_PER_SECOND = 14;

const ENTITY_STATES = new Set<string>([
  'idle',
  'moving',
  'attacking',
  'harvesting',
  'delivering',
  'rearming',
  'grounded',
  'takingOff',
  'returning',
  'capturing',
  'constructing',
  'building',
  'repairing',
  'healing',
  'garrisoned',
  'dead',
]);

const STANCES = new Set<string>(['aggressive', 'defensive', 'hold']);

function entityState(value: ProjectedEntity['state']): EntityState {
  return value && ENTITY_STATES.has(value) ? (value as EntityState) : 'idle';
}

function stanceOf(value: ProjectedEntity['stance']): Stance {
  return value && STANCES.has(value) ? (value as Stance) : 'aggressive';
}

function victoryFor(result: ProjectedMatchResult, team: number): VictoryState {
  if (result.phase !== 'finished') return 'playing';
  if (result.winnerTeam === null) return 'draw';
  return result.winnerTeam === team ? 'victory' : 'defeat';
}

function maxHpFor(entity: ProjectedEntity): number {
  if (entity.kind === 'unit') return UNITS[entity.defId]?.hp ?? entity.maxHp ?? 100;
  return BUILDINGS[entity.defId]?.hp ?? entity.maxHp ?? 1000;
}

/**
 * Build the presentation entity for one projected record.
 *
 * Fields the projection deliberately omits (path, cooldown, ammo, AI identity)
 * are filled with inert defaults: the shell is drawn, never ticked, so they can
 * never change behaviour. What the renderer actually reads — kind, def, owner,
 * position, facing, hp, state, construction, garrison, and the air/naval flags
 * that decide altitude and submersion — is carried over exactly.
 */
function createEntity(projected: ProjectedEntity, x: number, z: number): Entity {
  const maxHp = projected.maxHp ?? maxHpFor(projected);
  const state = entityState(projected.state);
  // Only units have a domain: a structure never flies and never dives.
  const def = projected.kind === 'unit' ? UNITS[projected.defId] : undefined;
  const domain = def?.domain;
  const remembered = projected.remembered === true;
  // A remembered structure is a silhouette: it carries no live integrity, so
  // show it intact rather than at zero health.
  const hp = remembered ? maxHp : (projected.hp ?? maxHp);
  const entity: Entity = {
    id: projected.id,
    kind: projected.kind,
    defId: projected.defId,
    owner: projected.owner,
    x,
    z,
    hp,
    maxHp,
    facing: projected.facing,
    turretFacing: projected.turretFacing,
    state: remembered ? 'idle' : state,
    order: null,
    path: [],
    pathIndex: 0,
    cooldown: 0,
    targetId: projected.targetId ?? 0,
    ammo: 0,
    maxAmmo: 0,
    fuel: 0,
    maxFuel: 0,
    stance: stanceOf(projected.stance),
    suppression: 0,
    lastHitTick: 0,
    kills: 0,
    xp: projected.xp ?? 0,
    buildProgress: projected.buildProgress ?? 1,
    construction: projected.construction ?? false,
    queue: (projected.queue ?? []).map((item) => ({ ...item })),
    rallyX: projected.rallyX ?? x,
    rallyZ: projected.rallyZ ?? z,
    homeId: 0,
    destX: x,
    destZ: z,
    guardX: x,
    guardZ: z,
    blockedTicks: 0,
    aimTargetId: 0,
    captureTargetId: 0,
    captureProgress: 0,
    healTargetId: 0,
    buildTargetId: 0,
    garrisonId: projected.garrisonId ?? 0,
    repairTargetId: 0,
    aiGroup: 0,
    aiRole: '',
  };
  if (domain === 'air') {
    // The server's airframe state wins. The old state-derived fallback remains
    // for a snapshot from a build that predates the aircraft projection.
    const landed =
      projected.aircraft?.landed ??
      (remembered || state === 'grounded' || state === 'rearming');
    entity.aircraft = {
      homeId: 0,
      landed,
      serviceTimer: 0,
      serviceTotal: 0,
      returningHome: projected.aircraft?.returningHome ?? state === 'returning',
      climb: projected.aircraft?.climb,
      ...(projected.aircraft?.fieldLanding
        ? { fieldLanding: { ...projected.aircraft.fieldLanding } }
        : {}),
    };
  }
  if (projected.navalLanding) entity.navalLanding = { ...projected.navalLanding };
  if (domain === 'naval' && def?.id === 'submarine') {
    entity.submarine = {
      dived: state !== 'attacking' && state !== 'idle',
      battery: 1,
      maxBattery: 1,
      revealTimer: 0,
      revealed: state === 'attacking',
    };
  }
  // The projection ships reload clocks for own hulls only, which is exactly
  // what the selection box needs to draw a disabled ability button.
  if (projected.cooldowns) entity.cooldowns = { ...projected.cooldowns };
  // The same rule for a running posture: the client draws the badge from the
  // authoritative remaining time, never from a local timer.
  if (projected.effects) entity.effects = { ...projected.effects };
  // The room ships the hauler's work state, so the client draws the same dust,
  // cargo bar and MINING label the simulation is actually producing. A build
  // that predates the field still gets a plausible idle hull rather than none.
  if (projected.harvester) {
    entity.harvester = {
      phase: projected.harvester.phase,
      ore: projected.harvester.ore,
      timer: 0,
      oreTileX: projected.harvester.oreTileX,
      oreTileZ: projected.harvester.oreTileZ,
      refineId: 0,
    };
  } else if (projected.kind === 'unit' && projected.defId === 'harvester') {
    entity.harvester = {
      phase: state === 'delivering' ? 'toRefinery' : 'seek',
      ore: 0,
      timer: 0,
      oreTileX: 0,
      oreTileZ: 0,
      refineId: 0,
    };
  }
  // Own units only: what the engineer is taking and how far it has got. The
  // relay meter reads exactly these two fields.
  if (projected.captureTargetId) entity.captureTargetId = projected.captureTargetId;
  if (projected.captureProgress !== undefined) entity.captureProgress = projected.captureProgress;
  return entity;
}

/** A projectile the client can draw; it carries presentation fields only. */
function createProjectile(projected: ProjectedProjectile): Projectile {
  return {
    id: projected.id,
    owner: projected.owner,
    shooterId: projected.shooterId,
    weaponId: projected.weaponId,
    x: projected.x,
    y: projected.y,
    z: projected.z,
    // The projection ships where a shell is, never where it is going: hidden
    // impact points would leak the opponent's aim. The renderer draws the
    // round in flight from its position alone.
    tx: projected.x,
    ty: projected.y,
    tz: projected.z,
    targetId: 0,
    speed: 0,
    splash: 0,
    kind: projected.kind,
    homing: false,
    damage: 0,
    armourMul: {},
    suppression: 0,
    seed: projected.id,
  };
}

function updatePlayer(row: PlayerState, projected: TeamSnapshot['players'][number]): void {
  row.name = row.name || projected.name;
  row.factionId = projected.factionId;
  row.mats = projected.mats;
  row.req = projected.req;
  row.stats = { ...projected.stats };
  row.defeated = projected.defeated;
  row.relayCount = projected.relayCount;
  // The projection only carries the seat's own research, so assigning it here
  // cannot reveal an opponent's plan.
  if (projected.research) row.research = projected.research;
  // Strategic cooldowns and the committed operation are the seat's own state,
  // projected only to its team; the client HUD reads them like the server's.
  if (projected.superweapon) row.superweapon = projected.superweapon;
}

/** A command as it goes on the wire: intent only, never authority. */
export type WireCommand = Record<string, unknown>;

/**
 * Strip the fields that would let a client claim its own authority.
 *
 * The local simulation needs `team` on every order, so the UI builds commands
 * that carry it. A room derives the team from the authenticated seat instead,
 * and its gate rejects any command that names `team`, `playerId`, `owner` or
 * `seat` — sending those would turn every order into a refusal.
 */
export function wireCommand(command: Command): WireCommand {
  const wire: WireCommand = { ...command };
  delete wire.team;
  delete wire.playerId;
  delete wire.owner;
  delete wire.seat;
  return wire;
}

export interface NetworkBattleOptions {
  /** The display shell: a real Game that is never ticked. */
  game: Game;
  /** The seat's team, used for the result and for the visible set. */
  team: number;
  /** Transport for a validated command. Returns false when it could not send. */
  send: (command: WireCommand) => boolean;
}

export interface NetworkBattleStatus {
  tick: number;
  updates: number;
  commandsSent: number;
  entities: number;
  /** Milliseconds since the last applied update, for the HUD link readout. */
  ageMs: number;
}

export class NetworkBattle {
  readonly team: number;
  private readonly game: Game;
  private readonly sendUpstream: (command: WireCommand) => boolean;
  private readonly entities = new Map<number, Entity>();
  private readonly targets = new Map<number, { x: number; z: number; facing: number; turretFacing: number }>();
  private latest: TeamSnapshot | null = null;
  private receivedAt = 0;
  private commandsSent = 0;
  private updates = 0;
  private rejectedCommands = 0;

  constructor(options: NetworkBattleOptions) {
    this.game = options.game;
    this.team = options.team;
    this.sendUpstream = options.send;
    this.game.localPlayerId = this.team;
  }

  /** The current authoritative tick the client is showing. */
  get tick(): number {
    return this.latest?.tick ?? this.game.state.tick;
  }

  get result(): ProjectedMatchResult | null {
    return this.latest?.result ?? null;
  }

  status(now = Date.now()): NetworkBattleStatus {
    return {
      tick: this.tick,
      updates: this.updates,
      commandsSent: this.commandsSent,
      entities: this.game.state.entities.length,
      ageMs: this.receivedAt === 0 ? 0 : now - this.receivedAt,
    };
  }

  /** Remember how many commands the room refused, for the end-of-match summary. */
  noteCommandRejection(): void {
    this.rejectedCommands++;
  }

  get commandRejections(): number {
    return this.rejectedCommands;
  }

  /**
   * Adopt one authoritative team snapshot.
   *
   * Structural state (which entities exist, who owns what, fog, result) is
   * applied immediately; transforms are recorded as targets and eased in by
   * `sync` so movement is smooth between the room's updates.
   */
  apply(snapshot: TeamSnapshot): void {
    if (snapshot.team !== this.team) return;
    this.latest = snapshot;
    this.receivedAt = Date.now();
    this.updates++;

    const seen = new Set<number>();
    const entities: Entity[] = [];
    const visible: number[] = [];
    for (const projected of snapshot.entities) {
      const existing = this.entities.get(projected.id);
      const reusable =
        existing && existing.kind === projected.kind && existing.defId === projected.defId;
      const entity = reusable ? existing : createEntity(projected, projected.x, projected.z);
      seen.add(projected.id);
      this.entities.set(projected.id, entity);
      this.targets.set(projected.id, {
        x: projected.x,
        z: projected.z,
        facing: projected.facing,
        turretFacing: projected.turretFacing,
      });
      if (reusable) {
        // Refresh everything except the eased transform, which `sync` owns.
        // Ownership changes mid-match: an engineer takes a relay or supply
        // depot and it changes hands on the authoritative tick. Without this
        // the replica keeps the old owner, so a captured objective still reads
        // neutral, its meter never claims, and its tint never changes — the
        // capture looks like it never happened on the player's screen.
        entity.owner = projected.owner;
        entity.hp = projected.remembered ? entity.maxHp : (projected.hp ?? entity.maxHp);
        entity.maxHp = projected.maxHp ?? entity.maxHp;
        entity.state = projected.remembered ? 'idle' : entityState(projected.state);
        entity.stance = stanceOf(projected.stance);
        entity.construction = projected.construction ?? false;
        entity.buildProgress = projected.buildProgress ?? entity.buildProgress;
        entity.queue = (projected.queue ?? []).map((item) => ({ ...item }));
        entity.garrisonId = projected.garrisonId ?? 0;
        // A remembered silhouette carries no experience: the replica keeps the
        // rank it last knew rather than inventing one.
        entity.xp = projected.remembered === true ? entity.xp ?? 0 : projected.xp ?? entity.xp ?? 0;
        entity.targetId = projected.targetId ?? 0;
        // Mining and capture are per-tick work, so a reused replica adopts the
        // fresh figures instead of keeping the ones it was created with.
        if (projected.harvester) {
          entity.harvester = {
            phase: projected.harvester.phase,
            ore: projected.harvester.ore,
            timer: 0,
            oreTileX: projected.harvester.oreTileX,
            oreTileZ: projected.harvester.oreTileZ,
            refineId: entity.harvester?.refineId ?? 0,
          };
        }
        entity.captureTargetId = projected.captureTargetId ?? 0;
        entity.captureProgress = projected.captureProgress ?? 0;
        if (projected.cooldowns) entity.cooldowns = { ...projected.cooldowns };
        else delete entity.cooldowns;
        if (projected.effects) entity.effects = { ...projected.effects };
        else delete entity.effects;
        if (entity.aircraft) {
          if (projected.aircraft) {
            entity.aircraft.landed = projected.aircraft.landed;
            entity.aircraft.returningHome = projected.aircraft.returningHome;
            entity.aircraft.climb = projected.aircraft.climb;
            if (projected.aircraft.fieldLanding) {
              entity.aircraft.fieldLanding = { ...projected.aircraft.fieldLanding };
            } else {
              delete entity.aircraft.fieldLanding;
            }
          } else {
            entity.aircraft.landed =
              projected.remembered === true ||
              entity.state === 'grounded' ||
              entity.state === 'rearming';
            entity.aircraft.returningHome = entity.state === 'returning';
          }
        }
        if (projected.navalLanding) entity.navalLanding = { ...projected.navalLanding };
        else delete entity.navalLanding;
        if (entity.submarine) {
          entity.submarine.dived = entity.state !== 'attacking' && entity.state !== 'idle';
          entity.submarine.revealed = entity.state === 'attacking';
        }
      }
      // A sale can begin between snapshots, or the structure can arrive in a
      // sync mid-dismantle, so the replica adopts the timer every time.
      if (projected.deconstruct) entity.deconstruct = { ...projected.deconstruct };
      else delete entity.deconstruct;
      entities.push(entity);
      // Remembered structures are charted, not seen: they are excluded from the
      // visible set so the renderer draws them as silhouettes.
      if (projected.remembered !== true) visible.push(projected.id);
    }
    for (const id of [...this.entities.keys()]) {
      if (seen.has(id)) continue;
      this.entities.delete(id);
      this.targets.delete(id);
    }

    const rowById = new Map(this.game.state.players.map((row) => [row.id, row]));
    const players: PlayerState[] = snapshot.players.map((projected) => {
      const row =
        rowById.get(projected.id) ??
        ({
          id: projected.id,
          name: projected.name,
          factionId: projected.factionId,
          team: projected.team,
          isAI: false,
          mats: projected.mats,
          req: projected.req,
          stats: { ...projected.stats },
          incomeHistory: new Array(60).fill(0),
          defeated: projected.defeated,
          relayCount: projected.relayCount,
          research: projected.research ?? { completed: [], project: null },
          superweapon: projected.superweapon ?? {
            cooldowns: {},
            active: null,
            ewUntilTick: 0,
            defence: null,
          },
        } satisfies PlayerState);
      updatePlayer(row, projected);
      return row;
    });

    const contacts: ContactRecord[] = snapshot.contacts.map((contact) => ({ ...contact }));
    const charted = snapshot.charted.map((entityId) => ({ team: this.team, entityId }));
    const events: SimEvent[] = snapshot.events.map((event) => ({ ...event }));

    this.game.adoptNetworkView({
      entities,
      players,
      projectiles: snapshot.projectiles.map(createProjectile),
      contacts,
      charted,
      smoke: snapshot.smoke.map((cloud) => ({ ...cloud })),
      fog: Uint8Array.from(snapshot.fog),
      tick: snapshot.tick,
      victory: victoryFor(snapshot.result, this.team),
      events,
      visibleIds: visible,
    });
    // A first update is placed, never eased in from wherever the shell started.
    if (this.updates === 1) this.snapTransforms();
  }

  /** Ease the display toward the last authoritative transforms. */
  sync(dt: number): void {
    if (this.updates === 0) return;
    const blend = 1 - Math.exp(-Math.max(0, dt) * SMOOTHING_PER_SECOND);
    for (const entity of this.game.state.entities) {
      const target = this.targets.get(entity.id);
      if (!target) continue;
      const dx = target.x - entity.x;
      const dz = target.z - entity.z;
      if (Math.hypot(dx, dz) > SNAP_DISTANCE) {
        entity.x = target.x;
        entity.z = target.z;
        entity.facing = target.facing;
        entity.turretFacing = target.turretFacing;
        continue;
      }
      entity.x += dx * blend;
      entity.z += dz * blend;
      entity.facing = approachAngle(entity.facing, target.facing, blend);
      entity.turretFacing = approachAngle(entity.turretFacing, target.turretFacing, blend);
    }
  }

  /**
   * Send one command to the room.
   *
   * The client sends intent only. Nothing is applied locally and nothing is
   * predicted: the next authoritative update is the truth, and the room's own
   * CommandGate decides whether the order was legal for this seat.
   */
  send(command: Command): boolean {
    if (this.game.state.victory !== 'playing') return false;
    const sent = this.sendUpstream(wireCommand(command));
    if (sent) this.commandsSent++;
    return sent;
  }

  private snapTransforms(): void {
    for (const entity of this.game.state.entities) {
      const target = this.targets.get(entity.id);
      if (!target) continue;
      entity.x = target.x;
      entity.z = target.z;
      entity.facing = target.facing;
      entity.turretFacing = target.turretFacing;
    }
  }
}

/** Shortest-path angular approach, so a hull never spins the long way round. */
export function approachAngle(current: number, target: number, blend: number): number {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * blend;
}
