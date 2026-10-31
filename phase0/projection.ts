import { TILE_SIZE } from '../src/sim/constants';
import type { Game } from '../src/sim/game';
import type { Entity, Projectile, SimEvent } from '../src/sim/types';

/**
 * Phase-0 network projection.
 *
 * This deliberately sends less than the renderer needs. Its job is to prove the
 * information boundary: a client receives its own team, enemies that are
 * actually visible to that team, no scenario, no AI state, no contacts and no
 * fog arrays. The production projection can grow fields once a transport and a
 * replica renderer exist, but it must keep this default-deny shape.
 */

export interface SnapshotEntity {
  id: number;
  kind: Entity['kind'];
  defId: string;
  owner: number;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  facing: number;
  state: Entity['state'];
  buildProgress: number;
  construction: boolean;
}

export interface SnapshotProjectile {
  id: number;
  owner: number;
  shooterId: number;
  weaponId: string;
  x: number;
  y: number;
  z: number;
}

export interface SnapshotPlayer {
  id: number;
  name: string;
  factionId: string;
  team: number;
  mats: number;
  req: number;
  defeated: boolean;
  relayCount: number;
}

export type SnapshotResult = 'playing' | 'victory' | 'defeat' | 'draw';

export interface Phase0Snapshot {
  type: 'snapshot';
  v: 1;
  tick: number;
  team: number;
  map: { width: number; height: number; tileSize: number };
  players: SnapshotPlayer[];
  entities: SnapshotEntity[];
  projectiles: SnapshotProjectile[];
  events: SimEvent[];
  result: SnapshotResult;
}

function projectEntity(entity: Entity): SnapshotEntity {
  return {
    id: entity.id,
    kind: entity.kind,
    defId: entity.defId,
    owner: entity.owner,
    x: entity.x,
    z: entity.z,
    hp: entity.hp,
    maxHp: entity.maxHp,
    facing: entity.facing,
    state: entity.state,
    buildProgress: entity.buildProgress,
    construction: entity.construction,
  };
}

function projectPlayer(player: Game['state']['players'][number]): SnapshotPlayer {
  return {
    id: player.id,
    name: player.name,
    factionId: player.factionId,
    team: player.team,
    mats: player.mats,
    req: player.req,
    defeated: player.defeated,
    relayCount: player.relayCount,
  };
}

/**
 * Own-team events are always permitted. Enemy events are permitted only when
 * the entity is visible to this team, or the event's ground point is in visible
 * fog. If only the point is visible, ids are redacted so a hidden entity id
 * cannot ride along with an otherwise visible explosion.
 */
export function eventVisibleToTeam(game: Game, team: number, event: SimEvent): SimEvent | null {
  const ownEvent = game.teamOf(event.team) === team;
  const visibleEntity =
    event.entityId !== undefined && game.isVisibleTo(team, event.entityId);
  const positioned = Number.isFinite(event.x) && Number.isFinite(event.z) && (event.x !== 0 || event.z !== 0);
  const tx = Math.floor(event.x / TILE_SIZE);
  const tz = Math.floor(event.z / TILE_SIZE);
  const visiblePoint = positioned && game.fogAt(team, tx, tz) === 2;
  if (!ownEvent && !visibleEntity && !visiblePoint) return null;

  // Even an own-team event can name an entity the team cannot see (a shot
  // toward a remembered position, for example). Strip every hidden id before
  // the payload leaves the server; the event's visible position may remain.
  let redacted = event;
  if (event.entityId !== undefined && !game.isVisibleTo(team, event.entityId)) {
    redacted = { ...redacted };
    delete redacted.entityId;
  }
  if (event.targetId !== undefined && !game.isVisibleTo(team, event.targetId)) {
    redacted = { ...redacted };
    delete redacted.targetId;
  }
  return redacted;
}

function resultForTeam(game: Game, team: number): SnapshotResult {
  if (game.state.victory === 'playing') return 'playing';
  const own = game.state.players.filter((p) => p.team === team);
  const enemies = game.state.players.filter((p) => p.team !== team);
  if (own.length > 0 && own.every((p) => p.defeated)) return 'defeat';
  if (enemies.length > 0 && enemies.every((p) => p.defeated)) return 'victory';
  return 'draw';
}

function visibleProjectile(game: Game, team: number, projectile: Projectile): boolean {
  if (game.teamOf(projectile.owner) === team) return true;
  if (projectile.shooterId && game.isVisibleTo(team, projectile.shooterId)) return true;
  return game.fogAt(
    team,
    Math.floor(projectile.x / TILE_SIZE),
    Math.floor(projectile.z / TILE_SIZE),
  ) === 2;
}

/**
 * Build one team's complete view. This is a fresh object; it never serialises
 * `GameState`, `Scenario`, `ai`, `contacts`, `charted` or `fog`.
 */
export function projectForTeam(game: Game, team: number, sinceSeq = 0): Phase0Snapshot {
  if (team !== 0 && team !== 1) {
    throw new RangeError(`unsupported team ${team}`);
  }

  const entities: SnapshotEntity[] = [];
  for (const entity of game.state.entities) {
    if (entity.hp <= 0) continue;
    const ownerTeam = game.teamOf(entity.owner);
    if (ownerTeam === team) {
      entities.push(projectEntity(entity));
      continue;
    }
    // Enemy and neutral entities exist in the payload only while this team
    // currently sees them. Remembered structures are intentionally omitted.
    if (game.isVisibleTo(team, entity.id)) entities.push(projectEntity(entity));
  }

  const projectiles: SnapshotProjectile[] = [];
  for (const projectile of game.state.projectiles) {
    if (!visibleProjectile(game, team, projectile)) continue;      projectiles.push({
        id: projectile.id,
        owner: projectile.owner,
        // A projectile can pass through a visible tile while its shooter stays
        // hidden. The visible round is fair; the hidden shooter's id is not.
        shooterId: game.isVisibleTo(team, projectile.shooterId) ? projectile.shooterId : 0,
        weaponId: projectile.weaponId,
        x: projectile.x,
        y: projectile.y,
        z: projectile.z,
      });
  }

  const events: SimEvent[] = [];
  for (const event of game.eventsAfter(sinceSeq)) {
    const projected = eventVisibleToTeam(game, team, event);
    if (projected) events.push(projected);
  }

  const map = game.state.map;
  return {
    type: 'snapshot',
    v: 1,
    tick: game.state.tick,
    team,
    map: { width: map.width, height: map.height, tileSize: TILE_SIZE },
    players: game.state.players.filter((p) => p.team === team).map(projectPlayer),
    entities,
    projectiles,
    events,
    result: resultForTeam(game, team),
  };
}
