import { BUILDINGS, isIndestructibleStructure } from '../data/buildings';
import { ALL_UNITS } from '../data/units';
import { containerAcceptsPassenger, containerSpec } from '../sim/containers';
import { entityWeapons, usesPrimaryAmmo, weaponCanHurt } from '../sim/combat';
import { MAX_QUEUED_ORDERS, TILE_SIZE } from '../sim/constants';
import type { Game } from '../sim/game';
import type { Command, Entity, Stance } from '../sim/types';

/**
 * Phase 1 command boundary.
 *
 * This module is intentionally server-only and transport-independent. The
 * caller supplies a trusted seat authority derived from its own session/room
 * table. Nothing in the wire command can select a player, team or owner.
 */

export interface SeatAuthority {
  /** Stable within one room. Never taken from the payload. */
  seatId: number;
  /** The only player this seat may command. */
  playerId: number;
  /** Cached from the authoritative player table and checked again on submit. */
  team: number;
  /** False after surrender, kick, disconnect grace expiry or room shutdown. */
  active: boolean;
}

export type CommandGateRejectionCode =
  | 'seat-inactive'
  | 'seat-mismatch'
  | 'player-unavailable'
  | 'player-defeated'
  | 'match-ended'
  | 'rate-limited'
  | 'payload-too-large'
  | 'malformed-envelope'
  | 'unsupported-version'
  | 'malformed-command'
  | 'forbidden-field'
  | 'command-not-allowed'
  | 'unknown-field'
  | 'invalid-ids'
  | 'too-many-ids'
  | 'entity-unavailable'
  | 'not-your-entity'
  | 'wrong-entity-type'
  | 'entity-garrisoned'
  | 'invalid-coordinate'
  | 'out-of-bounds'
  | 'invalid-target'
  | 'target-hidden'
  | 'friendly-target'
  | 'target-not-hostile'
  | 'target-not-attackable'
  | 'target-garrisoned'
  | 'no-capable-attacker'
  | 'invalid-stance'
  | 'invalid-definition'
  | 'invalid-building'
  | 'invalid-index'
  | 'production-unavailable'
  | 'research-unavailable'
  | 'upgrade-unavailable'
  | 'superweapon-unavailable'
  | 'module-unavailable'
  | 'placement-invalid'
  | 'no-builder'
  | 'rally-invalid'
  | 'not-submarine'
  | 'battery-too-low'
  | 'no-return-capable'
  | 'queue-full'
  | 'no-controllable-entity';

export interface GateRejection {
  ok: false;
  code: CommandGateRejectionCode;
  /** Safe for the client. Never contains a hidden entity name or coordinate. */
  message: string;
  /** Optional stable sub-code for own-base validation, such as `tech` or `mats`. */
  detail?: string;
}

export interface GateAcceptance {
  ok: true;
  command: Command;
  /** The gate has already put this command into the authoritative queue. */
  queued: true;
}

export type GateResult = GateAcceptance | GateRejection;

export interface CommandGateOptions {
  minCommandIntervalMs?: number;
  maxPayloadBytes?: number;
  maxIds?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 100;
const DEFAULT_MAX_PAYLOAD_BYTES = 4096;
const DEFAULT_MAX_IDS = 64;
const TRUSTED_FIELDS = new Set(['team', 'playerId', 'owner', 'seat']);

type CommandType = Command['type'];

const ALLOWED_FIELDS: Record<CommandType, readonly string[]> = {
  move: ['type', 'ids', 'x', 'z', 'attackMove', 'queue'],
  patrol: ['type', 'ids', 'x', 'z'],
  guard: ['type', 'ids', 'targetId'],
  land: ['type', 'ids', 'x', 'z'],
  attack: ['type', 'ids', 'targetId'],
  stop: ['type', 'ids'],
  hold: ['type', 'ids'],
  stance: ['type', 'ids', 'stance'],
  return: ['type', 'ids'],
  dive: ['type', 'ids', 'dive'],
  capture: ['type', 'ids', 'targetId'],
  repair: ['type', 'ids', 'targetId'],
  garrison: ['type', 'ids', 'targetId'],
  ungarrison: ['type', 'ids'],
  produce: ['type', 'buildingId', 'defId'],
  cancelProduction: ['type', 'buildingId', 'index'],
  reorderProduction: ['type', 'buildingId', 'defId', 'beforeDefId'],
  placeBuilding: ['type', 'builderId', 'defId', 'tileX', 'tileZ', 'facing'],
  sellBuilding: ['type', 'buildingId'],
  setRally: ['type', 'buildingId', 'x', 'z'],
  research: ['type', 'buildingId', 'techId'],
  cancelResearch: ['type', 'buildingId'],
  installModule: ['type', 'buildingId', 'moduleId'],
  activateUpgrade: ['type', 'unitId', 'upgradeId'],
  useAbility: ['type', 'unitId', 'abilityId'],
  superweapon: ['type', 'familyId', 'x', 'z', 'targetId'],
};

const COMMAND_TYPES = new Set<string>(Object.keys(ALLOWED_FIELDS));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function readCoordinate(value: unknown, max: number): number | null {
  if (!isFiniteNumber(value) || value < 0 || value > max) return null;
  return value;
}

function readDefId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null;
  return /^[A-Za-z][A-Za-z0-9]*$/.test(value) ? value : null;
}

function reject(
  code: CommandGateRejectionCode,
  message: string,
  detail?: string,
): GateRejection {
  return detail === undefined ? { ok: false, code, message } : { ok: false, code, message, detail };
}

/**
 * Validate and enqueue commands for one authoritative room.
 *
 * `submit()` is the only method that can put a command into `game.pending`.
 * Every rejection happens before that call, so an invalid payload never gets
 * a chance to be interpreted by a permissive simulation handler.
 */
export class CommandGate {
  private readonly seats = new Map<number, SeatAuthority>();
  private readonly lastAttemptAt = new Map<number, number>();
  private readonly minIntervalMs: number;
  private readonly maxPayloadBytes: number;
  private readonly maxIds: number;
  private ended = false;

  constructor(
    readonly game: Game,
    seats: readonly SeatAuthority[],
    options: CommandGateOptions = {},
  ) {
    for (const seat of seats) {
      if (this.seats.has(seat.seatId)) throw new Error(`Duplicate seat ${seat.seatId}.`);
      this.seats.set(seat.seatId, { ...seat });
    }
    this.minIntervalMs = options.minCommandIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.maxIds = options.maxIds ?? DEFAULT_MAX_IDS;
  }

  /** Final, server-owned match end. Commands after this point are rejected. */
  endMatch(): void {
    this.ended = true;
  }

  /** Whether the room has closed command ingress. */
  get matchEnded(): boolean {
    return this.ended;
  }

  /**
   * Transport entry point. The transport is responsible for its own socket
   * authentication, but it must pass the raw text here so the byte cap is
   * measured before JSON parsing.
   */
  submitText(seatId: number, text: string, nowMs = Date.now()): GateResult {
    const prepared = this.prepare(seatId, nowMs);
    if (!prepared.ok) return prepared;

    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > this.maxPayloadBytes) {
      return reject('payload-too-large', 'Command payload is too large.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return reject('malformed-envelope', 'Command payload is not valid JSON.');
    }
    return this.gate(prepared.seat, parsed);
  }

  /** Direct object entry point for tests and non-WebSocket server adapters. */
  submit(seatId: number, raw: unknown, nowMs = Date.now()): GateResult {
    const prepared = this.prepare(seatId, nowMs);
    if (!prepared.ok) return prepared;
    return this.gate(prepared.seat, raw);
  }

  private prepare(
    seatId: number,
    nowMs: number,
  ): { ok: true; seat: SeatAuthority } | GateRejection {
    const seat = this.seats.get(seatId);
    if (!seat || !seat.active) return reject('seat-inactive', 'This seat is not active.');

    const player = this.game.player(seat.playerId);
    if (!player) return reject('player-unavailable', 'This player is not in the match.');
    if (player.team !== seat.team) return reject('seat-mismatch', 'This seat is out of date.');

    if (this.ended || this.game.state.victory !== 'playing') {
      return reject('match-ended', 'The match has already ended.');
    }
    if (player.defeated) return reject('player-defeated', 'This player has been defeated.');

    if (!Number.isFinite(nowMs)) return reject('seat-inactive', 'Invalid command clock.');
    const last = this.lastAttemptAt.get(seatId);
    if (last !== undefined && nowMs - last < this.minIntervalMs) {
      return reject('rate-limited', 'Commands are arriving too quickly.');
    }
    this.lastAttemptAt.set(seatId, nowMs);
    return { ok: true, seat };
  }

  private gate(seat: SeatAuthority, raw: unknown): GateResult {
    if (!isRecord(raw)) return reject('malformed-envelope', 'Command envelope is not an object.');
    for (const key of Object.keys(raw)) {
      if (key !== 'v' && key !== 'command') {
        return reject('unknown-field', 'Command envelope has an unknown field.');
      }
    }
    if (raw.v !== 1) {
      return reject(
        typeof raw.v === 'number' ? 'unsupported-version' : 'malformed-envelope',
        'Unsupported command protocol version.',
      );
    }
    const command = raw.command;
    if (!isRecord(command)) return reject('malformed-command', 'Command body is not an object.');
    if (typeof command.type !== 'string' || !COMMAND_TYPES.has(command.type)) {
      return reject('command-not-allowed', 'That command is not allowed.');
    }

    const type = command.type as CommandType;
    const allowed = new Set(ALLOWED_FIELDS[type]);
    for (const key of Object.keys(command)) {
      if (TRUSTED_FIELDS.has(key)) {
        return reject('forbidden-field', 'The command may not select its own authority.');
      }
      if (!allowed.has(key)) return reject('unknown-field', 'The command has an unknown field.');
    }

    const parsed = this.parse(type, command, seat);
    if (!parsed.ok) return parsed;
    this.game.enqueueCommand(parsed.command);
    return { ok: true, command: parsed.command, queued: true };
  }

  private parse(
    type: CommandType,
    raw: Record<string, unknown>,
    seat: SeatAuthority,
  ): { ok: true; command: Command } | GateRejection {
    if (type === 'produce' || type === 'cancelProduction' || type === 'reorderProduction') {
      return this.parseProduction(type, raw, seat);
    }
    if (type === 'placeBuilding' || type === 'setRally' || type === 'sellBuilding') {
      if (type === 'placeBuilding') return this.parsePlaceBuilding(raw, seat);
      if (type === 'setRally') return this.parseSetRally(raw, seat);
      return this.parseSellBuilding(raw, seat);
    }
    if (type === 'research' || type === 'cancelResearch') {
      return this.parseResearch(type, raw, seat);
    }
    if (type === 'installModule') return this.parseModule(raw, seat);
    if (type === 'activateUpgrade') return this.parseUpgrade(raw, seat);
    if (type === 'useAbility') return this.parseAbility(raw, seat);
    if (type === 'superweapon') return this.parseSuperweapon(raw, seat);

    const idsResult = this.readIds(raw.ids);
    if (!idsResult.ok) return idsResult;
    const ids = idsResult.ids;

    switch (type) {
      case 'move': {
        const entities = this.requireOwned(ids, seat, 'unit');
        if (!entities.ok) return entities;
        if (entities.entities.some((entity) => entity.garrisonId)) {
          return reject('entity-garrisoned', 'Garrisoned infantry cannot receive a move order.');
        }
        const x = readCoordinate(raw.x, this.game.state.map.width * TILE_SIZE);
        const z = readCoordinate(raw.z, this.game.state.map.height * TILE_SIZE);
        if (x === null || z === null) return reject('out-of-bounds', 'Destination is outside the map.');
        if (raw.attackMove !== undefined && typeof raw.attackMove !== 'boolean') {
          return reject('malformed-command', 'attackMove must be a boolean.');
        }
        if (raw.queue !== undefined && typeof raw.queue !== 'boolean') {
          return reject('malformed-command', 'queue must be a boolean.');
        }
        if (
          raw.queue === true &&
          entities.entities.some((entity) => (entity.orderQueue?.length ?? 0) >= MAX_QUEUED_ORDERS)
        ) {
          return reject('queue-full', 'The waypoint queue is full.');
        }
        const command: Command = { type: 'move', team: seat.team, ids, x, z };
        if (raw.attackMove === true) command.attackMove = true;
        if (raw.queue === true) command.queue = true;
        return { ok: true, command };
      }

      case 'patrol': {
        const entities = this.requireOwned(ids, seat, 'unit');
        if (!entities.ok) return entities;
        if (entities.entities.some((entity) => entity.garrisonId)) {
          return reject('entity-garrisoned', 'Garrisoned infantry cannot receive a patrol order.');
        }
        const x = readCoordinate(raw.x, this.game.state.map.width * TILE_SIZE);
        const z = readCoordinate(raw.z, this.game.state.map.height * TILE_SIZE);
        if (x === null || z === null) return reject('out-of-bounds', 'Patrol point is outside the map.');
        return { ok: true, command: { type: 'patrol', team: seat.team, ids, x, z } };
      }

      case 'guard': {
        const selected = this.requireOwned(ids, seat, 'unit');
        if (!selected.ok) return selected;
        if (selected.entities.some((entity) => entity.garrisonId)) {
          return reject('entity-garrisoned', 'Garrisoned infantry cannot receive a guard order.');
        }
        const targetId = this.readTargetId(raw.targetId);
        if (targetId === null) return reject('invalid-target', 'Target is not valid.');
        const target = this.game.getEntity(targetId);
        // Missing and hidden targets share one code, so the gate cannot be used
        // to enumerate entities the seat is not allowed to see.
        if (!target || target.hp <= 0 || !this.game.isVisibleTo(seat.team, target.id)) {
          return reject('target-hidden', 'Target is not visible.');
        }
        if (target.kind !== 'unit') {
          return reject('wrong-entity-type', 'Only a friendly unit can be guarded.');
        }
        if (target.garrisonId) {
          return reject('target-garrisoned', 'That unit is inside a structure.');
        }
        if (target.owner < 0 || this.game.teamOf(target.owner) !== seat.team) {
          return reject('friendly-target', 'That is not a friendly unit.');
        }
        if (selected.entities.every((entity) => entity.id === targetId)) {
          return reject('no-controllable-entity', 'Select another unit to guard that one.');
        }
        return { ok: true, command: { type: 'guard', team: seat.team, ids, targetId } };
      }

      case 'land': {
        const selected = this.requireOwned(ids, seat, 'unit');
        if (!selected.ok) return selected;
        if (selected.entities.some((entity) => entity.garrisonId)) {
          return reject('entity-garrisoned', 'Garrisoned infantry cannot receive a landing order.');
        }
        if (
          !selected.entities.some(
            (entity) =>
              !!entity.aircraft &&
              !!ALL_UNITS[entity.defId]?.transport &&
              ALL_UNITS[entity.defId]?.domain === 'air',
          )
        ) {
          return reject('wrong-entity-type', 'No selected unit can land on open ground.');
        }
        const x = readCoordinate(raw.x, this.game.state.map.width * TILE_SIZE);
        const z = readCoordinate(raw.z, this.game.state.map.height * TILE_SIZE);
        if (x === null || z === null) {
          return reject('out-of-bounds', 'Landing zone is outside the map.');
        }
        return { ok: true, command: { type: 'land', team: seat.team, ids, x, z } };
      }

      case 'attack': {
        const selected = this.requireOwned(ids, seat);
        if (!selected.ok) return selected;
        for (const entity of selected.entities) {
          if (entity.kind === 'unit' && entity.garrisonId) {
            return reject('entity-garrisoned', 'Garrisoned infantry cannot receive an attack order.');
          }
          if (entity.kind === 'building' && (entity.construction || entityWeapons(entity).length === 0)) {
            return reject('wrong-entity-type', 'That structure cannot attack.');
          }
        }
        const targetId = this.readTargetId(raw.targetId);
        if (targetId === null) return reject('invalid-target', 'Target is not valid.');
        const target = this.game.getEntity(targetId);
        // A missing id and an existing but hidden target must be
        // indistinguishable: otherwise a client can enumerate hidden entities
        // by comparing rejection codes.
        if (!target || target.hp <= 0 || !this.game.isVisibleTo(seat.team, target.id)) {
          return reject('target-hidden', 'Target is not visible.');
        }
        if (isIndestructibleStructure(target.defId)) {
          return reject('target-not-attackable', 'That objective cannot be attacked.');
        }
        if (target.kind === 'unit' && target.garrisonId) {
          return reject('target-garrisoned', 'That infantry is inside a structure.');
        }
        if (target.owner >= 0 && this.game.teamOf(target.owner) === seat.team) {
          return reject('friendly-target', 'That is a friendly target.');
        }
        if (target.owner < 0) {
          // A neutral shelter is attackable only while hostile infantry hold it;
          // the simulation's isAttackable() rule is the authority here too.
          const occupants = this.game.garrisonOccupants(target.id);
          const hostileOccupant = occupants.some((occupant) =>
            this.game.isHostile(seat.playerId, occupant.owner),
          );
          if (
            target.kind !== 'building' ||
            !BUILDINGS[target.defId]?.garrison ||
            !hostileOccupant
          ) {
            return reject('target-not-hostile', 'That is not a hostile target.');
          }
        }
        const capable = selected.entities.some((entity) =>
          entityWeapons(entity).some(
            (weapon) =>
              weaponCanHurt(weapon, target) &&
              (!usesPrimaryAmmo(entity, weapon) || entity.ammo > 0),
          ),
        );
        if (!capable) return reject('no-capable-attacker', 'Selected forces cannot attack that target.');
        return { ok: true, command: { type: 'attack', team: seat.team, ids, targetId } };
      }

      case 'stop':
      case 'hold': {
        const selected = this.requireOwned(ids, seat);
        if (!selected.ok) return selected;
        if (selected.entities.every((entity) => entity.garrisonId)) {
          return reject('no-controllable-entity', 'No selected entity can receive that order.');
        }
        return { ok: true, command: { type, team: seat.team, ids } };
      }

      case 'stance': {
        const selected = this.requireOwned(ids, seat);
        if (!selected.ok) return selected;
        const stance = raw.stance;
        if (stance !== 'aggressive' && stance !== 'defensive' && stance !== 'hold') {
          return reject('invalid-stance', 'Unknown stance.');
        }
        return { ok: true, command: { type: 'stance', team: seat.team, ids, stance: stance as Stance } };
      }

      case 'return': {
        const selected = this.requireOwned(ids, seat, 'unit');
        if (!selected.ok) return selected;
        if (selected.entities.some((entity) => entity.garrisonId)) {
          return reject('entity-garrisoned', 'Garrisoned infantry cannot return to base.');
        }
        const capable = selected.entities.some(
          (entity) =>
            entity.harvester ||
            ALL_UNITS[entity.defId]?.domain === 'air' ||
            ALL_UNITS[entity.defId]?.domain === 'naval',
        );
        if (!capable) return reject('no-return-capable', 'No selected unit can return to base.');
        return { ok: true, command: { type: 'return', team: seat.team, ids } };
      }

      case 'dive': {
        const selected = this.requireOwned(ids, seat, 'unit');
        if (!selected.ok) return selected;
        if (raw.dive !== true && raw.dive !== false) {
          return reject('malformed-command', 'dive must be a boolean.');
        }
        if (selected.entities.some((entity) => !entity.submarine || !ALL_UNITS[entity.defId]?.submarine)) {
          return reject('not-submarine', 'Only submarines can dive.');
        }
        if (
          raw.dive === true &&
          selected.entities.some(
            (entity) => !!entity.submarine && entity.submarine.battery < entity.submarine.maxBattery * 0.2,
          )
        ) {
          return reject('battery-too-low', 'A selected submarine has too little battery to dive.');
        }
        return { ok: true, command: { type: 'dive', team: seat.team, ids, dive: raw.dive } };
      }

      case 'capture': {
        const selected = this.requireOwned(ids, seat, 'unit');
        if (!selected.ok) return selected;
        if (selected.entities.some((entity) => entity.garrisonId)) {
          return reject('entity-garrisoned', 'Garrisoned infantry cannot capture.');
        }
        if (
          !selected.entities.some((entity) => !!ALL_UNITS[entity.defId]?.canCapture)
        ) {
          return reject('wrong-entity-type', 'Select a unit that can capture.');
        }
        const targetId = this.readTargetId(raw.targetId);
        if (targetId === null) return reject('invalid-target', 'Target is not valid.');
        const target = this.game.getEntity(targetId);
        // Unknown and nonexistent targets share one response, so an id cannot
        // be used to discover a hidden enemy structure.
        if (
          !target ||
          target.hp <= 0 ||
          target.kind !== 'building' ||
          !this.game.isKnownTo(seat.team, target.id)
        ) {
          return reject('target-hidden', 'Target is not known.');
        }
        if (!BUILDINGS[target.defId]?.capturable || target.construction) {
          return reject('target-not-attackable', 'That structure cannot be captured.');
        }
        if (target.owner >= 0 && this.game.teamOf(target.owner) === seat.team) {
          return reject('friendly-target', 'That structure is already friendly.');
        }
        return { ok: true, command: { type: 'capture', team: seat.team, ids, targetId } };
      }

      case 'repair': {
        const selected = this.requireOwned(ids, seat, 'unit');
        if (!selected.ok) return selected;
        if (!selected.entities.some((entity) => !!ALL_UNITS[entity.defId]?.canBuild)) {
          return reject('wrong-entity-type', 'Select a unit that can repair.');
        }
        const targetId = this.readTargetId(raw.targetId);
        if (targetId === null) return reject('invalid-target', 'Target is not valid.');
        const target = this.game.getEntity(targetId);
        if (
          !target ||
          target.hp <= 0 ||
          !this.game.isKnownTo(seat.team, target.id)
        ) {
          return reject('target-hidden', 'Target is not known.');
        }
        if (!this.isRepairable(seat, target)) {
          return reject('target-not-attackable', 'That structure cannot be repaired.');
        }
        return { ok: true, command: { type: 'repair', team: seat.team, ids, targetId } };
      }

      case 'garrison': {
        const selected = this.requireOwned(ids, seat, 'unit');
        if (!selected.ok) return selected;
        const targetId = this.readTargetId(raw.targetId);
        if (targetId === null) return reject('invalid-target', 'Target is not valid.');
        const target = this.game.getEntity(targetId);
        if (!target || target.hp <= 0 || !this.game.isKnownTo(seat.team, target.id)) {
          return reject('target-hidden', 'Target is not known.');
        }
        const spec = containerSpec(target);
        if (!spec) return reject('target-not-attackable', 'That entity cannot be garrisoned.');
        // A mixed selection sends only its eligible infantry. The simulation
        // filters again, so an invalid member can never hold a seat or make the
        // whole order fail for the soldiers who can board.
        const eligible = selected.entities.filter(
          (entity) =>
            entity.kind === 'unit' &&
            !entity.garrisonId &&
            !!ALL_UNITS[entity.defId]?.canGarrison &&
            containerAcceptsPassenger(target, entity),
        );
        if (eligible.length === 0) {
          return reject('wrong-entity-type', 'Only exposed infantry can board or garrison.');
        }
        if (spec.mobile) {
          // A carrier is not a neutral shelter: only its own side may board it.
          // The seat's player and a teammate may use the same transport, but an
          // enemy owner is rejected here and again by the simulation hook.
          if (target.owner < 0 || this.game.isHostile(seat.playerId, target.owner)) {
            return reject('friendly-target', 'That transport belongs to another side.');
          }
          if (target.kind !== 'unit') {
            return reject('target-not-attackable', 'That entity is not a transport.');
          }
        } else {
          if (target.kind !== 'building') {
            return reject('target-not-attackable', 'That structure cannot be garrisoned.');
          }
          if (this.game.isHostile(seat.playerId, target.owner)) {
            return reject('friendly-target', 'That structure is held by the enemy.');
          }
          if (target.hp / target.maxHp <= 0.25) {
            return reject('target-not-attackable', 'That structure is too damaged to garrison.');
          }
        }
        const occupants = this.game.containerOccupants(target.id);
        if (spec.mobile) {
          if (occupants.some((occupant) => this.game.isHostile(seat.playerId, occupant.owner))) {
            return reject('target-not-attackable', 'That transport already carries another side.');
          }
        } else if (occupants.some((occupant) => this.game.isHostile(seat.playerId, occupant.owner))) {
          return reject('target-not-attackable', 'Hostile infantry hold that structure.');
        }
        if (occupants.length >= spec.capacity) {
          return reject('target-not-attackable', 'That structure is full.');
        }
        return {
          ok: true,
          command: { type: 'garrison', team: seat.team, ids: eligible.map((entity) => entity.id), targetId },
        };
      }

      case 'ungarrison': {
        if (ids.length === 0) return reject('invalid-ids', 'Select an entity to ungarrison.');
        let valid = false;
        for (const id of ids) {
          const entity = this.game.getEntity(id);
          // Foreign, dead and nonexistent ids share this response. Inspecting
          // an ungarrison id must not confirm that a hidden entity exists.
          if (!entity || entity.hp <= 0) {
            return reject('not-your-entity', 'That entity is not under this player\u2019s command.');
          }
          if (entity.kind === 'unit' && entity.garrisonId) {
            if (entity.owner !== seat.playerId) {
              return reject('not-your-entity', 'That unit is not garrisoned under this player.');
            }
            valid = true;
          } else if (containerSpec(entity)) {
            // A building, or a transport, that currently holds a friendly
            // passenger. The same order unloads either kind of container. A
            // mobile carrier's owner may unload everyone aboard; a passenger
            // owner may unload only their own infantry from a ground carrier.
            const air = entity.kind === 'unit' && ALL_UNITS[entity.defId]?.domain === 'air';
            const naval =
              entity.kind === 'unit' &&
              ALL_UNITS[entity.defId]?.domain === 'naval' &&
              !!ALL_UNITS[entity.defId]?.transport;
            const ownsCarrier = entity.owner === seat.playerId;
            if ((air || naval) && !ownsCarrier) {
              return reject(
                'not-your-entity',
                'Only the transport owner can order this transport to unload.',
              );
            }
            if (!ownsCarrier && !this.game.containerOccupants(entity.id).some((unit) => unit.owner === seat.playerId)) {
              return reject('not-your-entity', 'No friendly infantry occupy that container.');
            }
            valid = true;
          } else {
            return reject('not-your-entity', 'That entity is not under this player\u2019s command.');
          }
        }
        if (!valid) return reject('no-controllable-entity', 'Nothing can be ungarrisoned.');
        return { ok: true, command: { type: 'ungarrison', team: seat.team, ids } };
      }

      default:
        return reject('command-not-allowed', 'That command is not allowed.');
    }
  }

  /**
   * Research and its cancellation.
   *
   * The seat is derived from the session, never from the payload, and the
   * centre must belong to that seat's player. Technology and prerequisite rules
   * are answered by the simulation's own status call, so the gate and the tick
   * cannot disagree about what is legal.
   */
  private parseResearch(
    type: 'research' | 'cancelResearch',
    raw: Record<string, unknown>,
    seat: SeatAuthority,
  ): { ok: true; command: Command } | GateRejection {
    const buildingId = this.readTargetId(raw.buildingId);
    if (buildingId === null) return reject('invalid-building', 'Research centre is not valid.');
    const centre = this.game.getEntity(buildingId);
    if (
      !centre ||
      centre.hp <= 0 ||
      centre.kind !== 'building' ||
      centre.owner !== seat.playerId
    ) {
      return reject('not-your-entity', 'That research centre does not belong to this player.');
    }
    if (type === 'cancelResearch') {
      const status = this.game.cancelResearchStatus(seat.playerId, buildingId);
      if (!status.ok) {
        return reject('research-unavailable', 'Research cannot be cancelled.', status.reason);
      }
      return { ok: true, command: { type, team: seat.team, buildingId } };
    }
    const techId = readDefId(raw.techId);
    if (techId === null) return reject('invalid-definition', 'Technology is not valid.');
    const status = this.game.researchStatus(seat.playerId, buildingId, techId);
    if (!status.ok) {
      return reject('research-unavailable', 'That project cannot be started.', status.reason);
    }
    return { ok: true, command: { type, team: seat.team, buildingId, techId } };
  }

  /** Buying a researched module for one owned structure. */
  private parseModule(
    raw: Record<string, unknown>,
    seat: SeatAuthority,
  ): { ok: true; command: Command } | GateRejection {
    const buildingId = this.readTargetId(raw.buildingId);
    if (buildingId === null) return reject('invalid-building', 'Structure is not valid.');
    const building = this.game.getEntity(buildingId);
    if (
      !building ||
      building.hp <= 0 ||
      building.kind !== 'building' ||
      building.owner !== seat.playerId
    ) {
      return reject('not-your-entity', 'That structure does not belong to this player.');
    }
    const moduleId = readDefId(raw.moduleId);
    if (moduleId === null) return reject('invalid-definition', 'Module is not valid.');
    const status = this.game.moduleStatus(seat.playerId, buildingId, moduleId);
    if (!status.ok) return reject('module-unavailable', 'That module cannot be installed.', status.reason);
    return { ok: true, command: { type: 'installModule', team: seat.team, buildingId, moduleId } };
  }

  /** Applying a researched upgrade to one owned unit. */
  private parseUpgrade(
    raw: Record<string, unknown>,
    seat: SeatAuthority,
  ): { ok: true; command: Command } | GateRejection {
    const unitId = this.readTargetId(raw.unitId);
    if (unitId === null) return reject('invalid-target', 'Unit is not valid.');
    const unit = this.game.getEntity(unitId);
    if (!unit || unit.hp <= 0 || unit.kind !== 'unit' || unit.owner !== seat.playerId) {
      return reject('not-your-entity', 'That unit does not belong to this player.');
    }
    const upgradeId = readDefId(raw.upgradeId);
    if (upgradeId === null) return reject('invalid-definition', 'Upgrade is not valid.');
    const status = this.game.upgradeStatus(seat.playerId, unitId, upgradeId);
    if (!status.ok) {
      return reject('upgrade-unavailable', 'That upgrade cannot be applied.', status.reason);
    }
    return { ok: true, command: { type: 'activateUpgrade', team: seat.team, unitId, upgradeId } };
  }

  /**
   * Using a researched ability on one owned unit.
   *
   * Ownership, eligibility, research and the hull's own reload are all answered
   * by the simulation's status call, so the gate and the tick cannot disagree
   * about whether a cloud is legal. The command carries no position: the smoke is
   * centred on the hull, so a client cannot ask for one elsewhere.
   */
  private parseAbility(
    raw: Record<string, unknown>,
    seat: SeatAuthority,
  ): { ok: true; command: Command } | GateRejection {
    const unitId = this.readTargetId(raw.unitId);
    if (unitId === null) return reject('invalid-target', 'Unit is not valid.');
    const unit = this.game.getEntity(unitId);
    if (!unit || unit.hp <= 0 || unit.kind !== 'unit' || unit.owner !== seat.playerId) {
      return reject('not-your-entity', 'That unit does not belong to this player.');
    }
    const abilityId = readDefId(raw.abilityId);
    if (abilityId === null) return reject('invalid-definition', 'Ability is not valid.');
    const status = this.game.abilityStatus(seat.playerId, unitId, abilityId);
    if (!status.ok) return reject('upgrade-unavailable', 'That ability cannot be used.', status.reason);
    return { ok: true, command: { type: 'useAbility', team: seat.team, unitId, abilityId } };
  }

  /**
   * Authorising the seat's national strategic capability.
   *
   * Availability and the aim point are both answered by the simulation's own
   * status calls, so the gate cannot accept a strike the tick would refuse or
   * reject a legal one. The family is validated against the nation here, not
   * trusted from the client, and the cooldown/resource transaction happens only
   * when the queue reaches the command.
   */
  private parseSuperweapon(
    raw: Record<string, unknown>,
    seat: SeatAuthority,
  ): { ok: true; command: Command } | GateRejection {
    const familyId = readDefId(raw.familyId);
    if (familyId === null) return reject('invalid-definition', 'Strategic capability is not valid.');
    const x = readCoordinate(raw.x, this.game.state.map.width * TILE_SIZE);
    const z = readCoordinate(raw.z, this.game.state.map.height * TILE_SIZE);
    if (x === null || z === null) return reject('out-of-bounds', 'Aim point is outside the map.');
    const status = this.game.superweaponStatus(seat.playerId);
    if (!status.ok || !status.family || status.family.id !== familyId) {
      return reject('superweapon-unavailable', 'Strategic capability is not available.', status.reason);
    }
    const targetId = raw.targetId === undefined ? undefined : this.readTargetId(raw.targetId);
    if (raw.targetId !== undefined && targetId === null) {
      return reject('invalid-target', 'Target is not valid.');
    }
    const target = this.game.superweaponTargetStatus(
      seat.playerId,
      familyId,
      x,
      z,
      targetId ?? undefined,
    );
    if (!target.ok) return reject('invalid-target', 'Aim point is not valid.', target.reason);
    return {
      ok: true,
      command: {
        type: 'superweapon',
        team: seat.team,
        familyId,
        x,
        z,
        ...(targetId ? { targetId } : {}),
      },
    };
  }

  private parseProduction(
    type: 'produce' | 'cancelProduction' | 'reorderProduction',
    raw: Record<string, unknown>,
    seat: SeatAuthority,
  ): { ok: true; command: Command } | GateRejection {
    const buildingId = this.readTargetId(raw.buildingId);
    if (buildingId === null) return reject('invalid-building', 'Facility is not valid.');
    const building = this.game.getEntity(buildingId);
    // A missing facility and a hidden enemy facility must return the same
    // code, otherwise the queue commands become an entity-existence oracle.
    if (
      !building ||
      building.hp <= 0 ||
      building.kind !== 'building' ||
      building.owner !== seat.playerId
    ) {
      return reject('not-your-entity', 'That facility does not belong to this player.');
    }

    if (type === 'cancelProduction') {
      if (!Number.isInteger(raw.index) || (raw.index as number) < 0 || (raw.index as number) >= building.queue.length) {
        return reject('invalid-index', 'Queue item is not valid.');
      }
      return {
        ok: true,
        command: { type, team: seat.team, buildingId, index: raw.index as number },
      };
    }

    const defId = readDefId(raw.defId);
    if (defId === null) return reject('invalid-definition', 'Unit definition is not valid.');

    if (type === 'produce') {
      if (!ALL_UNITS[defId]) return reject('invalid-definition', 'Unit definition is not valid.');
      const status = this.game.productionStatus(seat.playerId, buildingId, defId);
      if (!status.ok) {
        return reject('production-unavailable', 'Facility cannot produce that unit.', status.reason);
      }
      return { ok: true, command: { type, team: seat.team, buildingId, defId } };
    }

    const before = raw.beforeDefId;
    if (before !== undefined) {
      if (typeof before !== 'string' || before.length === 0 || before.length > 64) {
        return reject('invalid-definition', 'Queue reference is not valid.');
      }
    }
    if (!building.queue.some((item) => item.defId === defId)) {
      return reject('invalid-index', 'That unit is not in the queue.');
    }
    if (before !== undefined && (before === defId || !building.queue.some((item) => item.defId === before))) {
      return reject('invalid-index', 'Queue reference is not valid.');
    }
    const command: Command = { type, team: seat.team, buildingId, defId };
    if (typeof before === 'string') command.beforeDefId = before;
    return { ok: true, command };
  }

  private parsePlaceBuilding(
    raw: Record<string, unknown>,
    seat: SeatAuthority,
  ): { ok: true; command: Command } | GateRejection {
    const defId = readDefId(raw.defId);
    if (defId === null || !BUILDINGS[defId]) {
      return reject('invalid-definition', 'Structure definition is not valid.');
    }
    const tileX = raw.tileX;
    const tileZ = raw.tileZ;
    if (
      typeof tileX !== 'number' ||
      typeof tileZ !== 'number' ||
      !Number.isInteger(tileX) ||
      !Number.isInteger(tileZ) ||
      tileX < 0 ||
      tileZ < 0 ||
      tileX >= this.game.state.map.width ||
      tileZ >= this.game.state.map.height
    ) {
      return reject('out-of-bounds', 'Build site is outside the map.');
    }

    let facing: number | undefined;
    if (raw.facing !== undefined) {
      if (typeof raw.facing !== 'number' || !Number.isFinite(raw.facing)) {
        return reject('invalid-coordinate', 'Build facing is not valid.');
      }
      facing = raw.facing;
    }

    let builderId: number | undefined;
    if (raw.builderId !== undefined) {
      if (!isPositiveInt(raw.builderId)) return reject('invalid-building', 'Builder is not valid.');
      const builder = this.game.getEntity(raw.builderId);
      if (
        !builder ||
        builder.hp <= 0 ||
        builder.owner !== seat.playerId ||
        builder.kind !== 'unit' ||
        !ALL_UNITS[builder.defId]?.canBuild
      ) {
        return reject('not-your-entity', 'That builder does not belong to this player.');
      }
      builderId = raw.builderId;
    } else {
      const hasBuilder = this.game.state.entities.some(
        (entity) =>
          entity.kind === 'unit' &&
          entity.hp > 0 &&
          entity.owner === seat.playerId &&
          !!ALL_UNITS[entity.defId]?.canBuild,
      );
      if (!hasBuilder) return reject('no-builder', 'No builder is available.');
    }

    const status = this.game.placementStatus(seat.playerId, defId, tileX, tileZ, builderId);
    if (!status.ok) return reject('placement-invalid', 'That site cannot be built on.', status.code);
    const command: Command = { type: 'placeBuilding', team: seat.team, defId, tileX, tileZ };
    if (builderId !== undefined) command.builderId = builderId;
    if (facing !== undefined) command.facing = facing;
    return { ok: true, command };
  }

  /**
   * Selling one owned structure. Every rule — finished, not objective, nobody
   * garrisoned inside — is answered by the simulation's own status call, so the
   * gate and the deconstruction clock cannot disagree.
   */
  private parseSellBuilding(
    raw: Record<string, unknown>,
    seat: SeatAuthority,
  ): { ok: true; command: Command } | GateRejection {
    const buildingId = this.readTargetId(raw.buildingId);
    if (buildingId === null) return reject('invalid-building', 'Structure is not valid.');
    const building = this.game.getEntity(buildingId);
    if (
      !building ||
      building.hp <= 0 ||
      building.kind !== 'building' ||
      building.owner !== seat.playerId
    ) {
      return reject('not-your-entity', 'That structure does not belong to this player.');
    }
    const status = this.game.sellStatus(seat.playerId, buildingId);
    if (!status.ok) return reject('invalid-building', 'That structure cannot be sold.', status.reason);
    return { ok: true, command: { type: 'sellBuilding', team: seat.team, buildingId } };
  }

  private parseSetRally(
    raw: Record<string, unknown>,
    seat: SeatAuthority,
  ): { ok: true; command: Command } | GateRejection {
    const buildingId = this.readTargetId(raw.buildingId);
    if (buildingId === null) return reject('invalid-building', 'Facility is not valid.');
    const building = this.game.getEntity(buildingId);
    if (
      !building ||
      building.hp <= 0 ||
      building.kind !== 'building' ||
      building.owner !== seat.playerId
    ) {
      return reject('not-your-entity', 'That facility does not belong to this player.');
    }
    const x = readCoordinate(raw.x, this.game.state.map.width * TILE_SIZE);
    const z = readCoordinate(raw.z, this.game.state.map.height * TILE_SIZE);
    if (x === null || z === null) return reject('out-of-bounds', 'Rally point is outside the map.');
    const status = this.game.rallyStatus(buildingId, x, z);
    if (!status.ok) return reject('rally-invalid', 'That rally point is not valid.', status.reason);
    return { ok: true, command: { type: 'setRally', team: seat.team, buildingId, x, z } };
  }

  private readIds(value: unknown): { ok: true; ids: number[] } | GateRejection {
    if (!Array.isArray(value) || value.length === 0) {
      return reject('invalid-ids', 'Select at least one entity.');
    }
    if (value.length > this.maxIds) return reject('too-many-ids', 'Too many entities selected.');
    const ids: number[] = [];
    for (const id of value) {
      if (!isPositiveInt(id)) return reject('invalid-ids', 'Entity ids must be positive integers.');
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length === 0) return reject('invalid-ids', 'Select at least one entity.');
    return { ok: true, ids };
  }

  private readTargetId(value: unknown): number | null {
    return isPositiveInt(value) ? value : null;
  }

  private requireOwned(
    ids: readonly number[],
    seat: SeatAuthority,
    kind?: Entity['kind'],
  ): { ok: true; entities: Entity[] } | GateRejection {
    const entities: Entity[] = [];
    for (const id of ids) {
      const entity = this.game.getEntity(id);
      // Missing, dead and foreign entities are deliberately one response. A
      // different code for "exists but hidden" is an information leak that
      // lets a client enumerate the opponent's entities by id.
      if (!entity || entity.hp <= 0 || entity.owner !== seat.playerId) {
        return reject('not-your-entity', 'That entity does not belong to this player.');
      }
      if (kind && entity.kind !== kind) {
        return reject('wrong-entity-type', 'The selection contains the wrong kind of entity.');
      }
      entities.push(entity);
    }
    return { ok: true, entities };
  }

  private isRepairable(seat: SeatAuthority, target: Entity): boolean {
    if (target.kind !== 'building' || target.hp <= 0) return false;
    // Resuming your own paused construction site travels on the same order as
    // a repair: nothing is damaged, but the engineer is needed on the site.
    if (target.construction) {
      return target.owner === seat.playerId && target.buildProgress < 1;
    }
    if (target.hp >= target.maxHp) return false;
    if (target.owner === seat.playerId) return true;
    if (target.owner !== -1 || !BUILDINGS[target.defId]?.garrison) return false;
    return !this.game
      .garrisonOccupants(target.id)
      .some((occupant) => this.game.isHostile(seat.playerId, occupant.owner));
  }
}
