import type { DeltaChanges, DeltaMessage, SyncMessage } from '../src/multiplayer/protocol';
import type { TeamSnapshot } from '../src/multiplayer/projection';
import { SnapshotAssembler } from '../src/multiplayer/snapshotAssembler';

export const V2 = 2 as const;

export function syncMessage(
  state: TeamSnapshot,
  options: { epoch?: number; seq?: number; roomId?: string; checkpoint?: boolean } = {},
): SyncMessage {
  return {
    type: 'sync',
    v: V2,
    roomId: options.roomId ?? 'phase2a4-room',
    epoch: options.epoch ?? 1,
    seq: options.seq ?? 1,
    tick: state.tick,
    team: state.team,
    checkpoint: options.checkpoint ?? false,
    state,
  };
}

export function deltaMessage(
  options: {
    epoch?: number;
    seq: number;
    base: number;
    tick: number;
    team?: number;
    roomId?: string;
    changes: DeltaChanges;
  },
): DeltaMessage {
  return {
    type: 'delta',
    v: V2,
    roomId: options.roomId ?? 'phase2a4-room',
    epoch: options.epoch ?? 1,
    seq: options.seq,
    base: options.base,
    tick: options.tick,
    team: options.team ?? 0,
    changes: options.changes,
  };
}

/**
 * Compare the whole team-visible view except event history. The full reference
 * snapshot is requested with `sinceSeq = eventSeq`, so it carries no events;
 * events are append-only UI cues and are compared separately where relevant.
 */
export function canonicalState(state: TeamSnapshot): string {
  const byId = <T extends { id: number }>(list: T[]): T[] =>
    [...list].sort((a, b) => a.id - b.id);
  return JSON.stringify({
    tick: state.tick,
    team: state.team,
    fog: state.fog,
    contacts: [...state.contacts].sort(
      (a, b) => a.entityId - b.entityId || a.team - b.team || a.tick - b.tick,
    ),
    charted: [...state.charted].sort((a, b) => a - b),
    players: byId(state.players),
    entities: byId(state.entities),
    projectiles: byId(state.projectiles),
    result: state.result,
  });
}

export function newAssembler(team: number, roomId = 'phase2a4-room'): SnapshotAssembler {
  return new SnapshotAssembler({ roomId, team });
}

export function applyOk(assembler: SnapshotAssembler, message: unknown): void {
  const result = assembler.apply(message);
  if (!result.ok) {
    throw new Error(`Assembler rejected ${JSON.stringify(message).slice(0, 200)}: ${result.reason} ${result.detail}`);
  }
}
