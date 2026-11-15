import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { MAX_QUEUED_ORDERS, SAVE_FORMAT, SAVE_FORMAT_VERSION, TILE_SIZE } from '../sim/constants';
import { Game } from '../sim/game';
import { parseScenario, type Scenario } from '../sim/scenario';
import type { SaveData, SerializedGameState } from '../sim/save';
import type { Entity, Projectile, VictoryState } from '../sim/types';
import { evaluateMatchResult, type NeutralMatchResult } from './matchResult';
import { identitySnapshot, type IdentitySnapshot } from '../accounts/identity';

/**
 * A room snapshot is the server's recovery record, not a client save.
 *
 * The outer envelope is separate from the single-player save format and has its
 * own version. The inner `simulation` payload deliberately reuses the existing
 * save codec so state serialisation is not forked; no multiplayer field is
 * added to SaveData or to the single-player scenario/state schemas.
 *
 * This schema check is not authentication. Only the authoritative room object
 * may call restoreRoomSnapshot(); clients receive projected snapshots, never
 * this full state.
 */

export const ROOM_SNAPSHOT_FORMAT = 'mca-room-snapshot';
/** Current recovery schema. Version 1 snapshots are migrated on load. */
export const ROOM_SNAPSHOT_VERSION = 2;
export const LEGACY_ROOM_SNAPSHOT_VERSION = 1;
/**
 * Version 1 did not persist sync generations. A client from that schema can
 * have observed at most one increment per connect, resync or checkpoint, all
 * bounded by the 30-minute match and per-seat message limits. Starting the
 * migrated stream far above that range guarantees a strictly newer epoch
 * without resetting an occupied seat to zero. This is an explicit one-time
 * schema migration, not a normal epoch value.
 */
export const LEGACY_EPOCH_FLOOR = 100_000_000;

export interface RoomSeatSnapshot {
  seatId: number;
  playerId: number;
  team: number;
  /** Snapshot-time socket state. Always false again after a runtime restart. */
  connected: boolean;
  abandoned: boolean;
  /** True if this seat has connected at least once in the room's lifetime. */
  everConnected: boolean;
  /** Durable disconnect time, or null while connected/never connected. */
  disconnectedAt: number | null;
  /** Monotonic sync generation issued to this seat. */
  epoch: number;
  /** Last sequence issued on this seat's stream. */
  seq: number;
}

export interface RoomTimingSnapshot {
  /** Wall-clock start of the first authoritative tick, or null before it starts. */
  startedAtMs: number | null;
  /** Wall-clock completion time for a finished match, or null while playing. */
  finishedAtMs: number | null;
}

export interface RoomSnapshotV2 {
  format: typeof ROOM_SNAPSHOT_FORMAT;
  version: typeof ROOM_SNAPSHOT_VERSION;
  source: 'server-authoritative';
  roomId: string;
  createdAt: string;
  tick: number;
  timing: RoomTimingSnapshot;
  seats: RoomSeatSnapshot[];
  /**
   * Frozen match-start identity presentation, one entry per seat. Optional so
   * snapshots written before Phase 4B still restore; when present it is the
   * only identity a reconnect or result may display.
   */
  identities?: RoomSeatIdentitySnapshot[];
  result: NeutralMatchResult;
  simulation: SaveData;
}

export interface RoomSeatIdentitySnapshot {
  seatId: number;
  identity: IdentitySnapshot | null;
}

/** The pre-2A.11 envelope, retained only as an explicit migration input. */
export interface RoomSnapshotV1 {
  format: typeof ROOM_SNAPSHOT_FORMAT;
  version: typeof LEGACY_ROOM_SNAPSHOT_VERSION;
  source: 'server-authoritative';
  roomId: string;
  createdAt: string;
  tick: number;
  seats: Array<{
    seatId: number;
    playerId: number;
    team: number;
    connected: boolean;
    abandoned: boolean;
  }>;
  result: NeutralMatchResult;
  simulation: SaveData;
}

export type RoomSnapshot = RoomSnapshotV2;

export type RoomSnapshotErrorCode =
  | 'not-an-object'
  | 'unsupported-format'
  | 'unsupported-version'
  | 'invalid-source'
  | 'invalid-room'
  | 'invalid-tick'
  | 'invalid-timing'
  | 'invalid-seats'
  | 'invalid-identities'
  | 'invalid-scenario'
  | 'invalid-save'
  | 'invalid-map'
  | 'invalid-players'
  | 'invalid-entities'
  | 'invalid-projectiles'
  | 'invalid-references'
  | 'invalid-result'
  | 'result-mismatch';

export class RoomSnapshotError extends Error {
  constructor(
    readonly code: RoomSnapshotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoomSnapshotError';
  }
}

export interface RoomSnapshotRestoreOptions {
  now?: number;
  matchDeadlineAt?: number;
  matchDurationMs?: number;
  /** Durable metadata fallback for a snapshot written before its first start check. */
  startedAtMs?: number | null;
  finishedAtMs?: number | null;
}

export interface CreateRoomSnapshotOptions {
  roomId: string;
  seats: readonly RoomSeatSnapshot[];
  timing?: RoomTimingSnapshot;
  now?: number;
  result?: NeutralMatchResult;
  identities?: readonly RoomSeatIdentitySnapshot[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function fail(code: RoomSnapshotErrorCode, message: string): never {
  throw new RoomSnapshotError(code, message);
}

function validateSeatIdentity(
  value: unknown,
  players: readonly { id: number; team: number }[],
  seen: Set<number>,
): { seatId: number; playerId: number; team: number; connected: boolean; abandoned: boolean } {
  if (!isRecord(value)) fail('invalid-seats', 'Seat entry is malformed.');
  if (!integer(value.seatId) || value.seatId < 0 || value.seatId > 3 || seen.has(value.seatId)) {
    fail('invalid-seats', 'Seat ids must be unique and between 0 and 3.');
  }
  if (
    !integer(value.playerId) ||
    !integer(value.team) ||
    typeof value.connected !== 'boolean' ||
    typeof value.abandoned !== 'boolean'
  ) {
    fail('invalid-seats', 'Seat entry is malformed.');
  }
  const player = players.find((entry) => entry.id === value.playerId);
  if (!player || player.team !== value.team) {
    fail('invalid-seats', 'Seat player/team does not match the saved player table.');
  }
  seen.add(value.seatId);
  return {
    seatId: value.seatId,
    playerId: value.playerId,
    team: value.team,
    connected: value.connected,
    abandoned: value.abandoned,
  };
}

function validateSeats(
  value: unknown,
  players: readonly { id: number; team: number }[],
): RoomSeatSnapshot[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    fail('invalid-seats', 'Room snapshot must contain two to four seats.');
  }
  const seen = new Set<number>();
  const seats: RoomSeatSnapshot[] = [];
  for (const raw of value) {
    const identity = validateSeatIdentity(raw, players, seen);
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.everConnected !== 'boolean' ||
      (entry.disconnectedAt !== null && !integer(entry.disconnectedAt)) ||
      !integer(entry.epoch) ||
      entry.epoch < 0 ||
      entry.epoch > 0x7fffffff ||
      !integer(entry.seq) ||
      entry.seq < 0 ||
      entry.seq > 0x7fffffff
    ) {
      fail('invalid-seats', 'Seat recovery state is malformed.');
    }
    const everConnected = entry.everConnected;
    const disconnectedAt = entry.disconnectedAt as number | null;
    const epoch = entry.epoch as number;
    const seq = entry.seq as number;
    if (identity.connected && !everConnected) {
      fail('invalid-seats', 'A connected seat must have connected before.');
    }
    if (identity.connected && disconnectedAt !== null) {
      fail('invalid-seats', 'A connected seat cannot have a disconnect timestamp.');
    }
    if (identity.abandoned && !everConnected) {
      fail('invalid-seats', 'An abandoned seat must have connected before.');
    }
    if (everConnected && epoch === 0) {
      fail('invalid-seats', 'An occupied seat cannot restore at epoch zero.');
    }
    if (!everConnected && (epoch !== 0 || seq !== 0 || disconnectedAt !== null)) {
      fail('invalid-seats', 'A never-connected seat has recovery state.');
    }
    if (epoch > 0 && seq === 0) {
      fail('invalid-seats', 'A seat with a sync generation must have a sequence.');
    }
    seats.push({
      ...identity,
      everConnected,
      disconnectedAt,
      epoch,
      seq,
    });
  }
  return seats;
}

/**
 * Validate the optional match-start identity table. It must cover every seat,
 * so a malformed or partial table cannot make a reconnect display ambiguous
 * ownership. Identity fields are sanitised through the same account validator
 * used by the ticket edge, which drops unknown frames and backgrounds.
 */
function validateMatchIdentities(
  value: unknown,
  seats: readonly RoomSeatSnapshot[],
): RoomSeatIdentitySnapshot[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== seats.length) {
    fail('invalid-identities', 'Match identity table must cover every seat.');
  }
  const seatIds = new Set(seats.map((seat) => seat.seatId));
  const seen = new Set<number>();
  const identities: RoomSeatIdentitySnapshot[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) fail('invalid-identities', 'Match identity entry is malformed.');
    if (!integer(raw.seatId) || !seatIds.has(raw.seatId) || seen.has(raw.seatId)) {
      fail('invalid-identities', 'Match identity seat is invalid or duplicated.');
    }
    if (raw.identity !== null && !isRecord(raw.identity)) {
      fail('invalid-identities', 'Match identity presentation is malformed.');
    }
    const identity = raw.identity === null ? null : identitySnapshot(raw.identity);
    if (raw.identity !== null && !identity) {
      fail('invalid-identities', 'Match identity presentation is invalid.');
    }
    seen.add(raw.seatId);
    identities.push({ seatId: raw.seatId, identity });
  }
  return identities;
}

/**
 * Version 1 had no epoch, sequence, ever-connected or disconnect time. The
 * migration never assigns epoch zero to a seat that may have held a socket;
 * it starts the stream in a new generation range above any legal v1 counter.
 */
function migrateLegacySeats(
  value: unknown,
  players: readonly { id: number; team: number }[],
  createdAt: string,
  active: boolean,
): RoomSeatSnapshot[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    fail('invalid-seats', 'Room snapshot must contain two to four seats.');
  }
  const seen = new Set<number>();
  const snapshotCreatedAt = Date.parse(createdAt);
  const seats: RoomSeatSnapshot[] = [];
  for (const raw of value) {
    const identity = validateSeatIdentity(raw, players, seen);
    // A started match implies both seats held a socket when it began, even if
    // one had disconnected again before this snapshot was written.
    const everConnected = identity.connected || identity.abandoned || active;
    seats.push({
      ...identity,
      everConnected,
      disconnectedAt:
        !identity.connected && everConnected ? snapshotCreatedAt : null,
      epoch: everConnected ? LEGACY_EPOCH_FLOOR : 0,
      // Version 1 persisted no sequence counter. A migrated occupied seat
      // starts at a positive sequence so the restored baseline is valid; the
      // first restored sync replaces this value before any client sees it.
      seq: everConnected ? 1 : 0,
    });
  }
  return seats;
}

function validateTiming(
  value: unknown,
  result: NeutralMatchResult,
): RoomTimingSnapshot {
  if (!isRecord(value)) fail('invalid-timing', 'Room snapshot timing is missing.');
  const startedAtMs = value.startedAtMs;
  const finishedAtMs = value.finishedAtMs;
  if (startedAtMs !== null && (!integer(startedAtMs) || startedAtMs < 0)) {
    fail('invalid-timing', 'Saved match start time is invalid.');
  }
  if (finishedAtMs !== null && (!integer(finishedAtMs) || finishedAtMs < 0)) {
    fail('invalid-timing', 'Saved match finish time is invalid.');
  }
  if (startedAtMs !== null && finishedAtMs !== null && finishedAtMs < startedAtMs) {
    fail('invalid-timing', 'Saved match finish precedes its start.');
  }
  if (result.phase === 'playing' && finishedAtMs !== null) {
    fail('invalid-timing', 'A playing room snapshot cannot have a finish time.');
  }
  if (result.phase === 'finished' && finishedAtMs === null) {
    fail('invalid-timing', 'A finished room snapshot needs a finish time.');
  }
  return { startedAtMs: startedAtMs as number | null, finishedAtMs: finishedAtMs as number | null };
}

function migrateLegacyTiming(
  result: NeutralMatchResult,
  createdAt: string,
): RoomTimingSnapshot {
  return {
    startedAtMs: null,
    finishedAtMs: result.phase === 'finished' ? Date.parse(createdAt) : null,
  };
}

function validateMap(state: Record<string, unknown>, scenario: Scenario): void {
  const map = state.map;
  if (!isRecord(map) || map.width !== scenario.width || map.height !== scenario.height) {
    fail('invalid-map', 'Saved map dimensions do not match the scenario.');
  }
  const tiles = scenario.width * scenario.height;
  for (const key of ['terrain', 'elevation', 'ore', 'maxOre']) {
    if (!Array.isArray(map[key]) || map[key].length !== tiles) {
      fail('invalid-map', `Saved map ${key} is not the expected size.`);
    }
  }
}

function validatePlayers(state: Record<string, unknown>): Array<{ id: number; team: number }> {
  if (!Array.isArray(state.players) || state.players.length < 2 || state.players.length > 4) {
    fail('invalid-players', 'Saved state must contain two to four players.');
  }
  const players: Array<{ id: number; team: number }> = [];
  const ids = new Set<number>();
  for (const raw of state.players) {
    if (!isRecord(raw) || !integer(raw.id) || raw.id < 0 || raw.id > 7 || ids.has(raw.id)) {
      fail('invalid-players', 'Saved player ids are malformed.');
    }
    if (raw.team !== 0 && raw.team !== 1) fail('invalid-players', 'Saved player team is invalid.');
    if (typeof raw.factionId !== 'string' || !Array.isArray(raw.incomeHistory)) {
      fail('invalid-players', 'Saved player identity is incomplete.');
    }
    ids.add(raw.id);
    players.push({ id: raw.id, team: raw.team === 1 ? 1 : 0 });
  }
  return players;
}

function validateEntities(
  state: Record<string, unknown>,
  players: readonly { id: number }[],
  scenario: Scenario,
): Entity[] {
  if (!Array.isArray(state.entities)) fail('invalid-entities', 'Saved entities are not an array.');
  const ids = new Set<number>();
  const playerIds = new Set(players.map((player) => player.id));
  const entities: Entity[] = [];
  for (const raw of state.entities) {
    if (!isRecord(raw) || !integer(raw.id) || raw.id <= 0 || ids.has(raw.id)) {
      fail('invalid-entities', 'Saved entity id is malformed or duplicated.');
    }
    if (raw.kind !== 'unit' && raw.kind !== 'building') fail('invalid-entities', 'Saved entity kind is invalid.');
    if (typeof raw.defId !== 'string' || (!UNITS[raw.defId] && !BUILDINGS[raw.defId])) {
      fail('invalid-entities', 'Saved entity definition is not installed.');
    }
    if (!integer(raw.owner) || (raw.owner >= 0 && !playerIds.has(raw.owner)) || raw.owner < -1) {
      fail('invalid-entities', 'Saved entity owner is invalid.');
    }
    if (
      !finite(raw.x) ||
      !finite(raw.z) ||
      raw.x < 0 ||
      raw.z < 0 ||
      raw.x > scenario.width * TILE_SIZE ||
      raw.z > scenario.height * TILE_SIZE
    ) {
      fail('invalid-entities', 'Saved entity position is outside the map.');
    }
    if (!finite(raw.hp) || raw.hp < 0 || !finite(raw.maxHp) || raw.maxHp <= 0) {
      fail('invalid-entities', 'Saved entity integrity is invalid.');
    }
    if (!finite(raw.buildProgress) || raw.buildProgress < 0 || raw.buildProgress > 1) {
      fail('invalid-entities', 'Saved entity construction progress is invalid.');
    }
    if (typeof raw.construction !== 'boolean' || !Array.isArray(raw.queue)) {
      fail('invalid-entities', 'Saved entity construction state is incomplete.');
    }
    if (raw.orderQueue !== undefined) {
      if (!Array.isArray(raw.orderQueue) || raw.orderQueue.length > MAX_QUEUED_ORDERS) {
        fail('invalid-entities', 'Saved entity waypoint queue is malformed or too long.');
      }
      for (const order of raw.orderQueue) {
        if (!isRecord(order) || (order.type !== 'move' && order.type !== 'attackMove')) {
          fail('invalid-entities', 'Saved entity waypoint type is invalid.');
        }
        if (
          !finite(order.x) ||
          !finite(order.z) ||
          order.x < 0 ||
          order.z < 0 ||
          order.x > scenario.width * TILE_SIZE ||
          order.z > scenario.height * TILE_SIZE
        ) {
          fail('invalid-entities', 'Saved entity waypoint is outside the map.');
        }
      }
    }
    ids.add(raw.id);
    entities.push(raw as unknown as Entity);
  }
  return entities;
}

function validateProjectiles(state: Record<string, unknown>, players: readonly { id: number }[]): Projectile[] {
  if (!Array.isArray(state.projectiles)) fail('invalid-projectiles', 'Saved projectiles are not an array.');
  const ids = new Set<number>();
  const playerIds = new Set(players.map((player) => player.id));
  const projectiles: Projectile[] = [];
  for (const raw of state.projectiles) {
    if (!isRecord(raw) || !integer(raw.id) || raw.id <= 0 || ids.has(raw.id)) {
      fail('invalid-projectiles', 'Saved projectile id is malformed or duplicated.');
    }
    if (!integer(raw.owner) || !playerIds.has(raw.owner)) {
      fail('invalid-projectiles', 'Saved projectile owner is invalid.');
    }
    if (!finite(raw.x) || !finite(raw.y) || !finite(raw.z)) {
      fail('invalid-projectiles', 'Saved projectile position is invalid.');
    }
    ids.add(raw.id);
    projectiles.push(raw as unknown as Projectile);
  }
  return projectiles;
}

function validateReferences(
  state: Record<string, unknown>,
  entities: readonly Entity[],
): void {
  const entityIds = new Set(entities.map((entity) => entity.id));
  const requireEntity = (id: unknown, field: string): void => {
    if (id === undefined || id === 0) return;
    if (!integer(id) || id < 0 || !entityIds.has(id)) {
      fail('invalid-references', `Saved ${field} references an unknown entity.`);
    }
  };
  for (const entity of entities) {
    if (entity.targetId) requireEntity(entity.targetId, 'targetId');
    if (entity.aimTargetId) requireEntity(entity.aimTargetId, 'aimTargetId');
    if (entity.captureTargetId) requireEntity(entity.captureTargetId, 'captureTargetId');
    if (entity.buildTargetId) requireEntity(entity.buildTargetId, 'buildTargetId');
    if (entity.healTargetId) requireEntity(entity.healTargetId, 'healTargetId');
    if (entity.repairTargetId) requireEntity(entity.repairTargetId, 'repairTargetId');
    if (entity.garrisonId) requireEntity(entity.garrisonId, 'garrisonId');
    if (entity.homeId) requireEntity(entity.homeId, 'homeId');
    if (entity.order?.targetId) requireEntity(entity.order.targetId, 'order.targetId');
    for (const order of entity.orderQueue ?? []) {
      if (order.targetId) requireEntity(order.targetId, 'orderQueue.targetId');
    }
  }
  if (!Array.isArray(state.contacts) || !Array.isArray(state.charted)) {
    fail('invalid-references', 'Saved fog memory is incomplete.');
  }
  for (const contact of state.contacts) {
    if (!isRecord(contact) || !integer(contact.entityId) || !entityIds.has(contact.entityId)) {
      fail('invalid-references', 'Saved contact references an unknown entity.');
    }
    if (contact.team !== 0 && contact.team !== 1) {
      fail('invalid-references', 'Saved contact team is invalid.');
    }
    // Contact confidence is part of the remembered picture, so a stored state or
    // band must be one of the known values rather than a free-form string.
    if (
      contact.state !== undefined &&
      contact.state !== 'confirmed' &&
      contact.state !== 'detected' &&
      contact.state !== 'last-known'
    ) {
      fail('invalid-references', 'Saved contact state is invalid.');
    }
    if (
      contact.band !== undefined &&
      !['infantry', 'armour', 'air', 'naval', 'structure'].includes(contact.band as string)
    ) {
      fail('invalid-references', 'Saved contact band is invalid.');
    }
  }
  for (const chart of state.charted) {
    if (!isRecord(chart) || !integer(chart.entityId) || !entityIds.has(chart.entityId)) {
      fail('invalid-references', 'Saved charted structure references an unknown entity.');
    }
    const entity = entities.find((entry) => entry.id === chart.entityId);
    if (!entity || entity.kind !== 'building' || (chart.team !== 0 && chart.team !== 1)) {
      fail('invalid-references', 'Saved charted structure is invalid.');
    }
  }
}

function validateResult(value: unknown, tick: number): NeutralMatchResult {
  if (!isRecord(value)) fail('invalid-result', 'Saved match result is missing.');
  if (value.phase !== 'playing' && value.phase !== 'finished') {
    fail('invalid-result', 'Saved match result phase is invalid.');
  }
  if (value.winnerTeam !== null && (value.winnerTeam !== 0 && value.winnerTeam !== 1)) {
    fail('invalid-result', 'Saved match winner is invalid.');
  }
  if (
    value.reason !== null &&
    value.reason !== 'elimination' &&
    value.reason !== 'time-limit' &&
    value.reason !== 'draw' &&
    value.reason !== 'abandoned'
  ) {
    fail('invalid-result', 'Saved match reason is invalid.');
  }
  if (!Array.isArray(value.teams) || !integer(value.tick) || value.tick !== tick) {
    fail('invalid-result', 'Saved match result is inconsistent.');
  }
  for (const team of value.teams) {
    if (
      !isRecord(team) ||
      (team.team !== 0 && team.team !== 1) ||
      !Array.isArray(team.playerIds) ||
      typeof team.defeated !== 'boolean' ||
      !finite(team.score) ||
      team.score < 0
    ) {
      fail('invalid-result', 'Saved team result is malformed.');
    }
  }
  if (
    value.winnerTeam !== null &&
    !value.teams.some((team) => isRecord(team) && team.team === value.winnerTeam)
  ) {
    fail('invalid-result', 'Saved winner is not in the team table.');
  }
  return value as unknown as NeutralMatchResult;
}

/**
 * Validate the complete envelope. This is intentionally strict: a malformed
 * recovery record must fail closed rather than load a half-valid world.
 */
export function validateRoomSnapshot(
  raw: unknown,
  options: RoomSnapshotRestoreOptions = {},
): RoomSnapshotV2 {
  if (!isRecord(raw)) fail('not-an-object', 'Room snapshot is not an object.');
  if (raw.format !== ROOM_SNAPSHOT_FORMAT) fail('unsupported-format', 'Not a room snapshot.');
  const legacy = raw.version === LEGACY_ROOM_SNAPSHOT_VERSION;
  if (!legacy && raw.version !== ROOM_SNAPSHOT_VERSION) {
    fail('unsupported-version', `Unsupported room snapshot version ${String(raw.version)}.`);
  }
  if (raw.source !== 'server-authoritative') fail('invalid-source', 'Room snapshot is not server-authored.');
  if (typeof raw.roomId !== 'string' || raw.roomId.length === 0 || raw.roomId.length > 128) {
    fail('invalid-room', 'Room snapshot has no valid room id.');
  }
  if (typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))) {
    fail('invalid-room', 'Room snapshot has no valid creation time.');
  }
  if (!integer(raw.tick) || raw.tick < 0) fail('invalid-tick', 'Room snapshot tick is invalid.');

  const simulation = raw.simulation;
  if (!isRecord(simulation) || simulation.format !== SAVE_FORMAT) {
    fail('invalid-save', 'Room snapshot has no compatible simulation payload.');
  }
  if (!integer(simulation.version) || simulation.version < 1 || simulation.version > SAVE_FORMAT_VERSION) {
    fail('invalid-save', 'Room snapshot simulation version is unsupported.');
  }
  if (!isRecord(simulation.scenario) || !isRecord(simulation.state)) {
    fail('invalid-save', 'Room snapshot simulation is incomplete.');
  }

  let scenario: Scenario;
  try {
    scenario = parseScenario(simulation.scenario);
  } catch (error) {
    fail('invalid-scenario', error instanceof Error ? error.message : 'Scenario is invalid.');
  }
  const state = simulation.state;
  validateMap(state, scenario);
  const players = validatePlayers(state);
  const entities = validateEntities(state, players, scenario);
  const projectiles = validateProjectiles(state, players);
  validateReferences(state, entities);

  if (!integer(state.tick) || state.tick !== raw.tick) {
    fail('invalid-tick', 'Room snapshot tick does not match its simulation state.');
  }
  if (!integer(state.nextEntityId) || !integer(state.nextProjectileId)) {
    fail('invalid-save', 'Room snapshot id counters are invalid.');
  }
  if (entities.some((entity) => entity.id >= (state.nextEntityId as number))) {
    fail('invalid-entities', 'Saved entity id counter is behind the entity table.');
  }
  if (projectiles.some((projectile) => projectile.id >= (state.nextProjectileId as number))) {
    fail('invalid-projectiles', 'Saved projectile id counter is behind the projectile table.');
  }
  if (!Array.isArray(state.fog) || state.fog.length !== 2) {
    fail('invalid-map', 'Saved fog state is incomplete.');
  }
  for (const fog of state.fog) {
    if (!Array.isArray(fog) || fog.length !== scenario.width * scenario.height) {
      fail('invalid-map', 'Saved fog array is not the expected size.');
    }
  }
  const victory = state.victory;
  if (victory !== 'playing' && victory !== 'victory' && victory !== 'defeat' && victory !== 'draw') {
    fail('invalid-save', 'Saved victory state is invalid.');
  }
  if (!isRecord(state.ai)) fail('invalid-save', 'Saved AI state is missing.');

  const result = validateResult(raw.result, raw.tick);
  if (result.teams.some((team) => !players.some((player) => player.team === team.team))) {
    fail('invalid-result', 'Saved result contains a team that is not in the player table.');
  }
  const seats = legacy
    ? migrateLegacySeats(
        raw.seats,
        players,
        raw.createdAt,
        result.phase === 'finished' || raw.tick > 0,
      )
    : validateSeats(raw.seats, players);
  const identities = legacy ? undefined : validateMatchIdentities(raw.identities, seats);
  const timing = legacy ? migrateLegacyTiming(result, raw.createdAt) : validateTiming(raw.timing, result);

  // A started match must carry a durable start. The only permitted missing
  // case is an active v1 record, where the Durable Object can reconstruct the
  // planned start from its reservation deadline and fixed match duration.
  const startedAtMs = timing.startedAtMs ?? options.startedAtMs ?? null;
  if (!legacy && startedAtMs === null && (result.phase === 'finished' || raw.tick > 0)) {
    fail('invalid-timing', 'Saved match started without a durable start time.');
  }
  if (startedAtMs !== null && !integer(startedAtMs)) {
    fail('invalid-timing', 'Saved match start time is invalid.');
  }
  if (
    startedAtMs !== null &&
    options.matchDeadlineAt !== undefined &&
    startedAtMs > options.matchDeadlineAt
  ) {
    fail('invalid-timing', 'Saved match start is after its durable deadline.');
  }

  return {
    format: ROOM_SNAPSHOT_FORMAT,
    version: ROOM_SNAPSHOT_VERSION,
    source: 'server-authoritative',
    roomId: raw.roomId,
    createdAt: raw.createdAt,
    tick: raw.tick,
    timing: { ...timing, startedAtMs },
    seats,
    ...(identities ? { identities } : {}),
    result,
    simulation: simulation as unknown as SaveData,
  };
}

export function createRoomSnapshot(game: Game, options: CreateRoomSnapshotOptions): RoomSnapshotV2 {
  if (!options.roomId || options.roomId.length > 128) {
    throw new RoomSnapshotError('invalid-room', 'Room id is invalid.');
  }
  const seats = validateSeats(options.seats, game.state.players);
  const identities = validateMatchIdentities(options.identities, seats);
  const abandonedTeams = seats.filter((seat) => seat.abandoned).map((seat) => seat.team);
  const simulation = game.toSave();
  const now = options.now ?? Date.now();
  const result = options.result ?? evaluateMatchResult(game, { abandonedTeams });
  const timing = validateTiming(options.timing ?? { startedAtMs: null, finishedAtMs: null }, result);
  return {
    format: ROOM_SNAPSHOT_FORMAT,
    version: ROOM_SNAPSHOT_VERSION,
    source: 'server-authoritative',
    roomId: options.roomId,
    createdAt: new Date(now).toISOString(),
    tick: game.state.tick,
    timing,
    seats,
    ...(identities ? { identities } : {}),
    result,
    simulation,
  };
}

/**
 * Restore server authoritative state. The restored Game has no local player
 * and no AI controller; the room alone owns the clock and command ingress.
 */
export function restoreRoomSnapshot(
  raw: unknown,
  options: RoomSnapshotRestoreOptions = {},
): Game {
  const snapshot = validateRoomSnapshot(raw, options);
  let game: Game;
  try {
    game = Game.fromSave(snapshot.simulation, {
      localPlayerId: -1,
      enableAI: false,
    });
  } catch (error) {
    fail('invalid-save', error instanceof Error ? error.message : 'Simulation could not be restored.');
  }
  game.localPlayerId = -1;
  game.ai = null;
  return game;
}

/** Narrow helper for callers that need the saved victory value without a Game. */
export function savedVictory(raw: unknown): VictoryState {
  const snapshot = validateRoomSnapshot(raw);
  return (snapshot.simulation.state as SerializedGameState).victory;
}
