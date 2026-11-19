import { TILE_SIZE } from '../sim/constants';
import type { Game } from '../sim/game';
import type {
  ContactRecord,
  Entity,
  FieldLandingState,
  NavalLandingState,
  PlayerState,
  Projectile,
  QueueItem,
  SimEvent,
  SmokeCloud,
} from '../sim/types';
import { evaluateMatchResult, type NeutralMatchResult } from './matchResult';
import type { OutbreakHudState } from '../outbreak/types';


/**
 * Default-deny team projection for the room transport.
 *
 * The snapshot is built from the authoritative Game, never from a client
 * replica. It includes the recipient team's own fog/contacts/charted memory and
 * omits the opposing team's memory, resources, queues, AI state and hidden
 * entities. Remembered structures keep their static identity and position but
 * carry no live integrity, queue or combat state.
 */

export interface ProjectedMap {
  width: number;
  height: number;
  tileSize: number;
  terrain: number[];
  elevation: number[];
  ore: number[];
  /**
   * Packed surface/vegetation layer per tile (0 = bare). Optional so a sync
   * from a build without the layer stays valid; a recipient that receives it
   * paints the same ground the server is fighting over instead of bare terrain.
   */
  overlay?: number[];
}

export interface ProjectedPlayer {
  id: number;
  name: string;
  factionId: string;
  team: number;
  mats: number;
  req: number;
  stats: PlayerState['stats'];
  defeated: boolean;
  relayCount: number;
  /**
   * The seat's own research only. An opponent's completed technologies would
   * reveal its entire build plan, so the team projection never carries them.
   */
  research?: PlayerState['research'];
  /** The team's own strategic state; never projected for an opponent. */
  superweapon?: PlayerState['superweapon'];
}

/**
 * A hauler's working state. Mining is a per-tick action, so without the phase,
 * the cargo and the seam the client can draw a stopped hull but never the dust,
 * the cargo bar or the MINING readout: in a room every hauler looked idle at the
 * deposit even while the server was filling it.
 */
export interface ProjectedHarvester {
  phase: 'seek' | 'toOre' | 'mining' | 'toRefinery' | 'unloading';
  ore: number;
  oreTileX: number;
  oreTileZ: number;
}

export interface ProjectedEntity {
  id: number;
  kind: Entity['kind'];
  defId: string;
  owner: number;
  team: number;
  x: number;
  z: number;
  facing: number;
  turretFacing: number;
  hp: number | null;
  maxHp: number | null;
  state: Entity['state'] | null;
  stance?: Entity['stance'];
  buildProgress: number | null;
  construction: boolean | null;
  /**
   * Veterancy experience. Visible on both sides: chevrons on an enemy crew are
   * what the eye reads across the map, not hidden bookkeeping. Omitted on a
   * remembered silhouette, which carries no live state at all.
   */
  xp?: number;
  /** True only for a structure the team charted but cannot currently see. */
  remembered?: true;
  /** Own/allied entities only. */
  queue?: QueueItem[];
  rallyX?: number;
  rallyZ?: number;
  targetId?: number;
  garrisonId?: number;
  /** Own entities only: upgrades this hull has taken. */
  upgrades?: string[];
  /** Own entities only: modules installed on this structure. */
  modules?: string[];
  /** A visible hauler's work state, so mining reads on the client. */
  harvester?: ProjectedHarvester;
  /**
   * Own/allied units only: the objective being worked and how far it has got.
   * The control meter is drawn from these two fields, so withholding them left
   * every relay reading "NEUTRAL · UNCLAIMED" while it was being taken.
   */
  captureTargetId?: number;
  captureProgress?: number;
  /**
   * Own entities only: seconds left on a sale. The countdown is the player's
   * own commitment, not combat information about an opponent.
   */
  deconstruct?: { remaining: number; total: number };
  /**
   * Own entities only: per-ability reload clocks. An opponent's remaining
   * cooldown is combat information the projection does not hand over.
   */
  cooldowns?: Record<string, number>;
  /**
   * Own entities only: timed abilities still running. Same rule as a reload
   * clock — an opponent's posture and its remaining seconds are combat
   * information, not something the projection hands over.
   */
  effects?: Record<string, number>;
  /**
   * Public airframe state. Passenger identities stay on their own redacted
   * garrison references; this only lets the client draw a landed transport,
   * an approach to a field landing zone, and its altitude share correctly.
   */
  aircraft?: {
    landed: boolean;
    returningHome: boolean;
    climb?: number;
    fieldLanding?: FieldLandingState;
  };
  /**
   * Public shore approach of a landing craft. This is what lets both clients
   * draw a beached hull and exposes its boarding readiness without revealing
   * any passenger identity.
   */
  navalLanding?: NavalLandingState;
}

export interface ProjectedTeamResult {
  team: number;
  playerIds: number[];
  defeated: boolean;
  /** Own team only; an opponent's exact remaining HP is hidden information. */
  score: number | null;
}

export interface ProjectedMatchResult {
  phase: NeutralMatchResult['phase'];
  winnerTeam: number | null;
  reason: NeutralMatchResult['reason'];
  teams: ProjectedTeamResult[];
  tick: number;
}

export interface ProjectedProjectile {
  id: number;
  owner: number;
  shooterId: number;
  weaponId: string;
  kind: Projectile['kind'];
  x: number;
  y: number;
  z: number;
}

/**
 * The map is immutable for the life of a room. It is built once and shipped
 * only in a full synchronisation, never in a 10 Hz delta.
 */
export function projectMap(game: Game): ProjectedMap {
  const map = game.state.map;
  return {
    width: map.width,
    height: map.height,
    tileSize: TILE_SIZE,
    terrain: Array.from(map.terrain),
    elevation: Array.from(map.elevation),
    ore: Array.from(map.ore),
    // The surface layer is part of the battlefield, not a client-side decal:
    // crops, reeds and hedgerows change what a tile looks like on both seats.
    overlay: Array.from(map.overlay ?? new Uint8Array(map.width * map.height)),
  };
}

/** Everything a team may receive that can change during a match. */
export interface ProjectedTeamState {
  tick: number;
  team: number;
  /** This team's own fog only: 0 unexplored, 1 explored, 2 visible. */
  fog?: number[];
  /** This team's remembered contacts only; never the opponent's. */
  contacts: ContactRecord[];
  /** Structures this team has charted, including currently hidden ones. */
  charted: number[];
  players: ProjectedPlayer[];
  entities: ProjectedEntity[];
  /**
   * Authoritative smoke the recipient may draw. Its own clouds always; a
   * hostile cloud only where the team's fog can actually see the ground it sits
   * on, so a screen does not broadcast a hidden hull's position.
   */
  smoke: SmokeCloud[];
  projectiles: ProjectedProjectile[];
  events: SimEvent[];
  result: ProjectedMatchResult;
  /**
   * The room's survival readout. Present only on an Outbreak room: a networked
   * seat runs no director of its own, so this is what its wave panel and
   * survival card render. Optional so a skirmish room stays unchanged.
   */
  outbreak?: OutbreakHudState;
}

export interface TeamSnapshot extends ProjectedTeamState {
  type: 'snapshot';
  v: 2;
  protocol: 2;
  map: ProjectedMap;
  /** A sync always carries the complete fog array. */
  fog: number[];
}

function projectPlayer(player: PlayerState): ProjectedPlayer {
  return {
    id: player.id,
    name: player.name,
    factionId: player.factionId,
    team: player.team,
    mats: player.mats,
    req: player.req,
    stats: { ...player.stats },
    defeated: player.defeated,
    relayCount: player.relayCount,
    research: {
      completed: [...player.research.completed],
      project: player.research.project ? { ...player.research.project } : null,
    },
    superweapon: {
      cooldowns: { ...player.superweapon.cooldowns },
      active: player.superweapon.active ? { ...player.superweapon.active } : null,
      ewUntilTick: player.superweapon.ewUntilTick,
      defence: player.superweapon.defence ? { ...player.superweapon.defence } : null,
    },
  };
}

function liveEntity(game: Game, entity: Entity, team: number, own: boolean): ProjectedEntity {
  const projected: ProjectedEntity = {
    id: entity.id,
    kind: entity.kind,
    defId: entity.defId,
    owner: entity.owner,
    team: game.teamOf(entity.owner),
    x: entity.x,
    z: entity.z,
    facing: entity.facing,
    turretFacing: entity.turretFacing,
    hp: entity.hp,
    maxHp: entity.maxHp,
    state: entity.state,
    buildProgress: entity.buildProgress,
    construction: entity.construction,
    xp: entity.xp ?? 0,
  };
  // A hull that is currently working already shows the work on its own model,
  // so the phase and the seam are no more secret than the exhaust. The cargo is
  // read from the same vehicle, and both sides may see it.
  if (entity.harvester) {
    projected.harvester = {
      phase: entity.harvester.phase,
      ore: entity.harvester.ore,
      oreTileX: entity.harvester.oreTileX,
      oreTileZ: entity.harvester.oreTileZ,
    };
  }
  if (entity.aircraft) {
    projected.aircraft = {
      landed: entity.aircraft.landed,
      returningHome: entity.aircraft.returningHome,
      climb: entity.aircraft.climb,
      ...(entity.aircraft.fieldLanding
        ? { fieldLanding: { ...entity.aircraft.fieldLanding } }
        : {}),
    };
  }
  if (entity.navalLanding) projected.navalLanding = { ...entity.navalLanding };
  if (!own) return projected;
  projected.stance = entity.stance;
  projected.queue = entity.queue.map((item) => ({ ...item }));
  projected.rallyX = entity.rallyX;
  projected.rallyZ = entity.rallyZ;
  // An own unit can keep a target id after the enemy slips back into fog.
  // Redact it rather than shipping a hidden entity id with an otherwise legal
  // own-unit record.
  projected.targetId =
    entity.targetId && game.isVisibleTo(team, entity.targetId) ? entity.targetId : 0;
  projected.garrisonId =
    entity.garrisonId && game.isKnownTo(team, entity.garrisonId) ? entity.garrisonId : 0;
  // The same redaction as targetId: an engineer can hold a structure id after
  // the enemy slips back into fog, and the projection never ships that id.
  if (entity.captureTargetId && game.isKnownTo(team, entity.captureTargetId)) {
    projected.captureTargetId = entity.captureTargetId;
    projected.captureProgress = entity.captureProgress;
  }
  if (entity.upgrades && entity.upgrades.length > 0) projected.upgrades = [...entity.upgrades];
  if (entity.modules && entity.modules.length > 0) projected.modules = [...entity.modules];
  if (entity.cooldowns && Object.keys(entity.cooldowns).length > 0) {
    projected.cooldowns = { ...entity.cooldowns };
  }
  if (entity.effects && Object.keys(entity.effects).length > 0) {
    projected.effects = { ...entity.effects };
  }
  if (entity.deconstruct) projected.deconstruct = { ...entity.deconstruct };
  return projected;
}

function rememberedEntity(game: Game, entity: Entity): ProjectedEntity {
  return {
    id: entity.id,
    kind: entity.kind,
    defId: entity.defId,
    owner: entity.owner,
    team: game.teamOf(entity.owner),
    x: entity.x,
    z: entity.z,
    facing: entity.facing,
    turretFacing: entity.turretFacing,
    hp: null,
    maxHp: null,
    state: null,
    buildProgress: null,
    construction: null,
    remembered: true,
  };
}

/**
 * An enemy event is visible only when its entity is visible or its world point
 * is in the recipient's visible fog. Hidden ids are stripped even from own
 * events, because an own shot can name a remembered enemy position.
 */
export function projectEvent(game: Game, team: number, event: SimEvent): SimEvent | null {
  const ownEvent = game.teamOf(event.team) === team;
  const visibleEntity =
    event.entityId !== undefined && game.isVisibleTo(team, event.entityId);
  const hasPoint =
    Number.isFinite(event.x) &&
    Number.isFinite(event.z) &&
    (event.x !== 0 || event.z !== 0);
  const visiblePoint =
    hasPoint &&
    game.fogAt(
      team,
      Math.floor(event.x / TILE_SIZE),
      Math.floor(event.z / TILE_SIZE),
    ) === 2;
  if (!ownEvent && !visibleEntity && !visiblePoint) return null;

  let projected = event;
  if (event.entityId !== undefined && !game.isVisibleTo(team, event.entityId)) {
    projected = { ...projected };
    delete projected.entityId;
  }
  if (event.targetId !== undefined && !game.isVisibleTo(team, event.targetId)) {
    projected = { ...projected };
    delete projected.targetId;
  }
  // The simulation emits a few notices with the *local* player id, which on the
  // authoritative room is -1. The wire is team-relative, so a server-wide notice
  // is stamped with the recipient's team instead of being rejected downstream.
  if (projected.team < 0) projected = { ...projected, team };
  return projected;
}

function projectResult(result: NeutralMatchResult, team: number): ProjectedMatchResult {
  return {
    phase: result.phase,
    winnerTeam: result.winnerTeam,
    reason: result.reason,
    tick: result.tick,
    teams: result.teams.map((entry) => ({
      team: entry.team,
      playerIds: [...entry.playerIds],
      defeated: entry.defeated,
      score: entry.team === team ? entry.score : null,
    })),
  };
}

function projectileVisible(game: Game, team: number, projectile: Projectile): boolean {
  if (game.teamOf(projectile.owner) === team) return true;
  if (projectile.shooterId && game.isVisibleTo(team, projectile.shooterId)) return true;
  return (
    game.fogAt(
      team,
      Math.floor(projectile.x / TILE_SIZE),
      Math.floor(projectile.z / TILE_SIZE),
    ) === 2
  );
}

/**
 * Build one team's complete changing state. The object is freshly allocated and
 * contains no reference to `state.ai`, `state.scenario`, the opposing player
 * rows, opposing fog/contacts or hidden live entity state. The immutable map is
 * deliberately absent: callers either send it once or use `projectMap`.
 */
/**
 * `includeFog` exists for the 10 Hz delta path: the server already holds the
 * team's fog bytes and diffs them tile by tile, so materialising 13,824 JS
 * numbers per update would be wasted work. Syncs always include the full array.
 */
export function createTeamState(
  game: Game,
  team: number,
  sinceSeq = 0,
  result?: NeutralMatchResult,
  includeFog = true,
): ProjectedTeamState {
  if (!Number.isInteger(team) || team < 0) throw new RangeError(`Unsupported team ${team}.`);
  const teamExists = game.state.players.some((player) => player.team === team);
  if (!teamExists) throw new RangeError(`Team ${team} is not in this match.`);

  const entities: ProjectedEntity[] = [];
  const knownIds = new Set<number>();
  for (const entity of game.state.entities) {
    if (entity.hp <= 0) continue;
    const ownerTeam = game.teamOf(entity.owner);
    const own = ownerTeam === team;
    if (own) {
      entities.push(liveEntity(game, entity, team, true));
      knownIds.add(entity.id);
      continue;
    }
    // An embarked passenger is never projected to the opposing side, even
    // when a coarse visibility test matches its carrier's tile. Its identity,
    // seat and cargo state stay with its owner.
    if (entity.garrisonId) continue;
    if (game.isVisibleTo(team, entity.id)) {
      entities.push(liveEntity(game, entity, team, false));
      knownIds.add(entity.id);
    }
  }

  // Charted structures remain on the map as silhouettes. Their coordinates
  // are public history; their current hp, queue and combat state are not.
  for (const chart of game.state.charted) {
    if (chart.team !== team || knownIds.has(chart.entityId)) continue;
    const entity = game.getEntity(chart.entityId);
    if (!entity || entity.hp <= 0 || entity.kind !== 'building') continue;
    entities.push(rememberedEntity(game, entity));
    knownIds.add(entity.id);
  }

  const projectiles: ProjectedProjectile[] = [];
  for (const projectile of game.state.projectiles) {
    if (!projectileVisible(game, team, projectile)) continue;
    projectiles.push({
      id: projectile.id,
      owner: projectile.owner,
      shooterId: game.isVisibleTo(team, projectile.shooterId) ? projectile.shooterId : 0,
      weaponId: projectile.weaponId,
      kind: projectile.kind,
      x: projectile.x,
      y: projectile.y,
      z: projectile.z,
    });
  }

  const events: SimEvent[] = [];
  for (const event of game.eventsAfter(sinceSeq)) {
    const projected = projectEvent(game, team, event);
    if (projected) events.push(projected);
  }

  const smoke: SmokeCloud[] = [];
  for (const cloud of game.state.smoke) {
    const own = game.teamOf(cloud.owner) === team;
    if (!own && game.fogAt(team, Math.floor(cloud.x / TILE_SIZE), Math.floor(cloud.z / TILE_SIZE)) !== 2) {
      continue;
    }
    smoke.push({ ...cloud });
  }

  const map = game.state.map;
  const fog = game.state.fog[team] ?? new Uint8Array(map.width * map.height);
  return {
    tick: game.state.tick,
    team,
    ...(includeFog ? { fog: Array.from(fog) } : {}),
    contacts: game.state.contacts
      .filter((contact) => contact.team === team)
      .map((contact) => ({ ...contact })),
    charted: game.state.charted
      .filter((chart) => chart.team === team)
      .map((chart) => chart.entityId),
    players: game.state.players
      .filter((player) => player.team === team)
      .map(projectPlayer),
    entities,
    smoke,
    projectiles,
    events,
    result: projectResult(result ?? evaluateMatchResult(game), team),
    ...(game.outbreak ? { outbreak: game.outbreak.hudState() } : {}),
  };
}

/** Full wire snapshot: dynamic state plus the immutable map, for sync only. */
export function createTeamSnapshot(
  game: Game,
  team: number,
  sinceSeq = 0,
  result?: NeutralMatchResult,
  map?: ProjectedMap,
): TeamSnapshot {
  // Cross-entity occupancy is checked before the wire shape is built. A
  // passenger's row only carries its container id, so an invalid association
  // (dead carrier, alien transport, fifth seat) must not leave the server.
  game.assertContainerIntegrity();
  const state = createTeamState(game, team, sinceSeq, result, true);
  if (!state.fog) throw new Error('A full team snapshot requires the fog array.');
  return {
    ...state,
    type: 'snapshot',
    v: 2,
    protocol: 2,
    map: map ?? projectMap(game),
    fog: state.fog,
  };
}
