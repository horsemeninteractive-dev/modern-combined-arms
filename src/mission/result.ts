/**
 * Mission result capture.
 *
 * The result is built once, from the authoritative end state, and then stored
 * inside the mission runtime. It reports only facts the simulation actually
 * keeps: the per-player counters it already maintains, the final objective
 * states, mission time and whether each authored entity survived. There is no
 * reinforcement ledger and no cause-of-loss classification in the simulation,
 * so neither is claimed here.
 *
 * Building and reading are pure functions over plain data. `Game` supplies the
 * state; nothing in this module reads the HUD, the renderer or wall-clock time.
 */
import type {
  MissionDoc,
  MissionEntityRole,
  MissionObjectiveKind,
  MissionObjectiveState,
  MissionOutcome,
  MissionResult,
  MissionResultEntity,
  MissionResultObjective,
  MissionResultStats,
} from './types';
import type { MissionRuntimeState } from './runtime';

export interface MissionResultPlayer {
  id: number;
  stats: MissionResultStats;
}

export interface MissionResultEntityState {
  defId: string;
  hp: number;
  authoredKey?: string;
}

export interface MissionResultInput {
  doc: MissionDoc;
  state: MissionRuntimeState;
  outcome: MissionOutcome;
  /** Absolute simulation tick the mission ended on. */
  tick: number;
  /** Mission time in seconds, measured from the scenario's start tick. */
  elapsedSeconds: number;
  localPlayerId: number;
  players: readonly MissionResultPlayer[];
  entities: readonly MissionResultEntityState[];
}

const OBJECTIVE_STATES: readonly MissionObjectiveState[] = [
  'hidden',
  'active',
  'complete',
  'failed',
];

const ENTITY_ROLES: readonly MissionEntityRole[] = [
  'veteran',
  'asset',
  'protected',
  'objective',
];

function copyStats(stats: MissionResultStats): MissionResultStats {
  return {
    unitsBuilt: stats.unitsBuilt,
    unitsLost: stats.unitsLost,
    kills: stats.kills,
    buildingsBuilt: stats.buildingsBuilt,
    matsGathered: stats.matsGathered,
  };
}

/**
 * Build the result for a finished mission.
 *
 * Objective order is authored order and entity order is authored order, so two
 * clients that reached the same end state produce identical results.
 */
export function buildMissionResult(input: MissionResultInput): MissionResult {
  const { doc, state, outcome, localPlayerId } = input;
  const stateOf = new Map(state.objectives.map((entry) => [entry.id, entry.state]));
  const objectives: MissionResultObjective[] = doc.objectives.map((objective) => ({
    id: objective.id,
    title: objective.title,
    kind: objective.kind,
    state: stateOf.get(objective.id) ?? 'hidden',
  }));

  const local = input.players.find((player) => player.id === localPlayerId);
  const friendly = local
    ? copyStats(local.stats)
    : { unitsBuilt: 0, unitsLost: 0, kills: 0, buildingsBuilt: 0, matsGathered: 0 };
  const enemy = input.players
    .filter((player) => player.id !== localPlayerId)
    .reduce(
      (total, player) => {
        total.unitsLost += player.stats.unitsLost;
        total.kills += player.stats.kills;
        return total;
      },
      { unitsLost: 0, kills: 0 },
    );

  const entities: MissionResultEntity[] = doc.entities.map((entity) => {
    const spawned = input.entities.find((candidate) => candidate.authoredKey === entity.key);
    return {
      key: entity.key,
      ...(entity.name !== undefined ? { name: entity.name } : {}),
      role: entity.role,
      ...(spawned ? { defId: spawned.defId } : {}),
      survived: spawned ? spawned.hp > 0 : false,
    };
  });

  return {
    missionId: doc.id,
    outcome,
    tick: input.tick,
    elapsedSeconds: input.elapsedSeconds,
    objectives,
    friendly,
    enemy,
    entities,
  };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function readStats(raw: unknown): MissionResultStats | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const stats = raw as Partial<MissionResultStats>;
  if (
    !isCount(stats.unitsBuilt) ||
    !isCount(stats.unitsLost) ||
    !isCount(stats.kills) ||
    !isCount(stats.buildingsBuilt) ||
    !isCount(stats.matsGathered)
  ) {
    return null;
  }
  return copyStats(stats as MissionResultStats);
}

/**
 * Validate a saved result.
 *
 * A result that does not match this mission, this outcome or the authored
 * objective set is discarded rather than half-read; the simulation then
 * captures a fresh one from the restored state, which is the same end state the
 * file was written from.
 */
export function readMissionResult(
  doc: MissionDoc,
  raw: unknown,
  outcome: MissionOutcome | 'playing',
): MissionResult | null {
  if (outcome === 'playing') return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Partial<MissionResult>;
  if (candidate.missionId !== doc.id) return null;
  if (candidate.outcome !== outcome) return null;
  if (!isCount(candidate.tick)) return null;
  if (!isCount(candidate.elapsedSeconds)) return null;
  const friendly = readStats(candidate.friendly);
  const enemyRaw = candidate.enemy;
  if (!friendly) return null;
  if (!enemyRaw || typeof enemyRaw !== 'object' || Array.isArray(enemyRaw)) return null;
  const enemy = enemyRaw as Partial<MissionResult['enemy']>;
  if (!isCount(enemy.unitsLost) || !isCount(enemy.kills)) return null;
  if (!Array.isArray(candidate.objectives) || !Array.isArray(candidate.entities)) return null;

  const savedObjectives = new Map<string, MissionObjectiveState>();
  for (const entry of candidate.objectives) {
    if (!entry || typeof entry !== 'object') return null;
    const objective = entry as Partial<MissionResultObjective>;
    if (typeof objective.id !== 'string') return null;
    if (!OBJECTIVE_STATES.includes(objective.state as MissionObjectiveState)) return null;
    savedObjectives.set(objective.id, objective.state as MissionObjectiveState);
  }
  // Every authored objective must be present, in any order: the result is a
  // statement about the whole objective tree, not a subset.
  if (savedObjectives.size !== doc.objectives.length) return null;
  if (!doc.objectives.every((objective) => savedObjectives.has(objective.id))) return null;

  const savedEntities = new Map<string, MissionResultEntity>();
  for (const entry of candidate.entities) {
    if (!entry || typeof entry !== 'object') return null;
    const entity = entry as Partial<MissionResultEntity>;
    if (typeof entity.key !== 'string') return null;
    if (typeof entity.survived !== 'boolean') return null;
    if (!ENTITY_ROLES.includes(entity.role as MissionEntityRole)) return null;
    savedEntities.set(entity.key, {
      key: entity.key,
      ...(typeof entity.name === 'string' ? { name: entity.name } : {}),
      role: entity.role as MissionEntityRole,
      ...(typeof entity.defId === 'string' ? { defId: entity.defId } : {}),
      survived: entity.survived,
    });
  }
  const entities: MissionResultEntity[] = [];
  for (const authored of doc.entities) {
    const saved = savedEntities.get(authored.key);
    if (!saved) return null;
    entities.push({ ...saved, role: authored.role });
  }

  return {
    missionId: doc.id,
    outcome,
    tick: candidate.tick,
    elapsedSeconds: candidate.elapsedSeconds,
    objectives: doc.objectives.map((objective) => ({
      id: objective.id,
      title: objective.title,
      kind: objective.kind as MissionObjectiveKind,
      state: savedObjectives.get(objective.id)!,
    })),
    friendly,
    enemy: { unitsLost: enemy.unitsLost, kills: enemy.kills },
    entities,
  };
}
