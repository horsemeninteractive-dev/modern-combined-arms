import { TILE_SIZE } from '../src/sim/constants';
import type { Game } from '../src/sim/game';
import type { Command } from '../src/sim/types';

/**
 * Phase-0 command gate.
 *
 * The transport supplies only a seat. The gate derives the owning team from
 * that seat, ignores any client-supplied `team`, and rejects ids that do not
 * belong to the seat's team. It is intentionally a small allowlist: this spike
 * measures movement orders, attacks, stops and holds, not the full UI surface.
 */

export interface Seat {
  seat: number;
  team: 0 | 1;
}

export type GateResult =
  | { ok: true; command: Command }
  | { ok: false; reason: string };

const ALLOWED = new Set(['move', 'attack', 'stop', 'hold']);
const MAX_IDS = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IDS) return null;
  const ids: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item <= 0) return null;
    if (!ids.includes(item)) ids.push(item);
  }
  return ids;
}

function readCoordinate(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > max) return null;
  return value;
}

function readId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function ownedIds(game: Game, team: number, ids: number[]): boolean {
  for (const id of ids) {
    const entity = game.getEntity(id);
    if (!entity || entity.hp <= 0) return false;
    if (game.teamOf(entity.owner) !== team) return false;
  }
  return true;
}

export function gateCommand(game: Game, seat: Seat, raw: unknown): GateResult {
  if (!isRecord(raw)) return { ok: false, reason: 'malformed-command' };
  if (typeof raw.type !== 'string' || !ALLOWED.has(raw.type)) {
    return { ok: false, reason: 'command-not-allowed' };
  }
  const ids = readIds(raw.ids);
  if (!ids) return { ok: false, reason: 'invalid-ids' };
  if (!ownedIds(game, seat.team, ids)) return { ok: false, reason: 'not-your-unit' };

  if (raw.type === 'move') {
    const x = readCoordinate(raw.x, game.state.map.width * TILE_SIZE);
    const z = readCoordinate(raw.z, game.state.map.height * TILE_SIZE);
    if (x === null || z === null) return { ok: false, reason: 'out-of-bounds' };
    const command: Command = { type: 'move', team: seat.team, ids, x, z };
    if (raw.attackMove === true) command.attackMove = true;
    return { ok: true, command };
  }

  if (raw.type === 'attack') {
    const targetId = readId(raw.targetId);
    if (targetId === null) return { ok: false, reason: 'invalid-target' };
    const target = game.getEntity(targetId);
    if (!target || target.hp <= 0) return { ok: false, reason: 'invalid-target' };
    if (game.teamOf(target.owner) === seat.team) return { ok: false, reason: 'friendly-target' };
    if (!game.isVisibleTo(seat.team, targetId)) return { ok: false, reason: 'target-hidden' };
    return { ok: true, command: { type: 'attack', team: seat.team, ids, targetId } };
  }

  if (raw.type === 'stop') {
    return { ok: true, command: { type: 'stop', team: seat.team, ids } };
  }

  return { ok: true, command: { type: 'hold', team: seat.team, ids } };
}
