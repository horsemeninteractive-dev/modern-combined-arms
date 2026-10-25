import type { Game } from '../sim/game';
import type { Entity } from '../sim/types';
import { FACTIONS } from '../data/factions';

export const RELAY_NEUTRAL_COLOR = '#8d9d98';

export interface RelayMeterState {
  /** Current owner id, or -1 for neutral. */
  owner: number;
  ownerLabel: string;
  ownerColor: string;
  /** 0..1 capture progress of the most advanced engineer. */
  progress: number;
  /** Owner id of the engineer making the most progress, if any. */
  capturer: number | null;
  capturerColor: string;
  /** Short text for the world meter and selection card. */
  caption: string;
}

function factionLabel(game: Game, owner: number): string {
  const p = game.player(owner);
  if (!p) return 'NEUTRAL';
  return (FACTIONS[p.factionId]?.shortName ?? p.name).toUpperCase();
}

function factionColor(game: Game, owner: number): string {
  const p = game.player(owner);
  if (!p) return RELAY_NEUTRAL_COLOR;
  return FACTIONS[p.factionId]?.color ?? RELAY_NEUTRAL_COLOR;
}

/**
 * Ownership plus the live capture race for any strategic objective. Capture
 * progress lives on the engineer (authoritative simulation state), not on the
 * structure, so the meter reads the unit currently working on it. An engineer
 * pulled away clears that progress with its order.
 */
export function objectiveMeterState(game: Game, relay: Entity): RelayMeterState {
  let capturer: number | null = null;
  let progress = 0;
  for (const e of game.state.entities) {
    if (e.kind !== 'unit' || e.hp <= 0) continue;
    if (e.captureTargetId !== relay.id) continue;
    if (e.captureProgress > progress) {
      progress = e.captureProgress;
      capturer = e.owner;
    }
  }
  const ownerLabel = relay.owner >= 0 ? factionLabel(game, relay.owner) : 'NEUTRAL';
  const ownerColor = relay.owner >= 0 ? factionColor(game, relay.owner) : RELAY_NEUTRAL_COLOR;
  const capturerColor = capturer !== null ? factionColor(game, capturer) : '#52c5e6';
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const caption =
    progress > 0
      ? `${ownerLabel} · ${pct}% CAPTURED`
      : relay.owner >= 0
        ? ownerLabel
        : 'NEUTRAL · UNCLAIMED';
  return { owner: relay.owner, ownerLabel, ownerColor, progress, capturer, capturerColor, caption };
}

/** Signals relays read the same control meter as every other objective. */
export const relayMeterState = objectiveMeterState;
