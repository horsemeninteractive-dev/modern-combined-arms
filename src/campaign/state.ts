/**
 * Authoritative campaign transitions.
 *
 * Every operation here is pure: it validates the current phase, returns a new
 * state and never reads storage, the DOM or a clock. The application persists
 * the result; tests drive the same functions without a browser.
 *
 * The one transaction that changes persistent progress is `acceptCampaignResult`.
 * Launching snapshots the campaign, and retrying restores that snapshot, so a
 * failed attempt cannot lose veterans or spend campaign consequences.
 */
import { readMissionResult } from '../mission/result';
import type {
  MissionDoc,
  MissionResult,
  MissionResultEntity,
  MissionValue,
  MissionVariableType,
} from '../mission/types';
import type { CampaignDef, CampaignMission } from '../data/campaign';
import { NATIONS } from '../data/factions';
import { UNITS } from '../data/units';
import { normaliseCommanderIdentity } from './identity';
import { parseFlagComposition, type FlagComposition } from '../identity/flag';
import {
  CampaignStateError,
  type CampaignMissionRecord,
  type CampaignPendingResult,
  type CampaignPhase,
  type CampaignSaveDoc,
  type CampaignSnapshot,
  type CampaignState,
  type CampaignVeteran,
  type CampaignVeteranDeployment,
  type CommanderIdentity,
} from './types';
import type { CampaignProgress } from '../data/campaign';

const PHASES: readonly CampaignPhase[] = ['briefing', 'playing', 'debrief', 'complete'];

export function isCampaignPhase(value: unknown): value is CampaignPhase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value);
}

function isMissionValue(value: unknown): value is MissionValue {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function valueMatchesType(type: MissionVariableType, value: MissionValue): boolean {
  return typeof value === type;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function missionOf(def: CampaignDef, missionId: string): CampaignMission | undefined {
  return def.missions.find((mission) => mission.id === missionId);
}

export function nextMissionOf(def: CampaignDef, missionId: string): CampaignMission | null {
  const index = def.missions.findIndex((mission) => mission.id === missionId);
  return index >= 0 ? (def.missions[index + 1] ?? null) : null;
}

/** Authored variables, key-sorted so two runs serialise identically. */
function initialVariables(def: CampaignDef): Record<string, MissionValue> {
  const variables: Record<string, MissionValue> = {};
  for (const variable of [...def.variables].sort((a, b) => a.id.localeCompare(b.id))) {
    variables[variable.id] = variable.default;
  }
  return variables;
}

function initialVeterans(def: CampaignDef): CampaignVeteran[] {
  return def.roster.map((entry) => ({
    id: entry.id,
    name: entry.name,
    defId: entry.defId,
    role: entry.role,
    missions: [],
  }));
}

/**
 * A new campaign run.
 *
 * The identity is required here, not later: every mission can then assume a
 * commander exists for briefing copy.
 */
export function createCampaignState(def: CampaignDef, rawIdentity: unknown): CampaignState {
  let commander: CommanderIdentity;
  try {
    commander = normaliseCommanderIdentity(rawIdentity);
  } catch (error) {
    throw new CampaignStateError(
      'invalid-identity',
      error instanceof Error ? error.message : String(error),
    );
  }
  const first = def.missions[0];
  if (!first) {
    throw new CampaignStateError('unknown-mission', `Campaign "${def.id}" has no operations.`);
  }
  return {
    campaignId: def.id,
    definitionVersion: def.version,
    commander,
    phase: 'briefing',
    currentMissionId: first.id,
    completed: [],
    variables: initialVariables(def),
    veterans: initialVeterans(def),
    preMission: null,
    deployments: [],
    pending: null,
  };
}

function snapshotOf(state: CampaignState): CampaignSnapshot {
  return {
    commander: state.commander ? { ...state.commander } : null,
    currentMissionId: state.currentMissionId,
    completed: clone(state.completed),
    variables: clone(state.variables),
    veterans: clone(state.veterans),
  };
}

/**
 * Veterans assigned to one operation.
 *
 * A slot is filled only by the roster individual it names, and only while that
 * individual is alive. Absent veterans leave the slot empty rather than
 * substituting somebody else, so a mission author's roster intent is preserved
 * and no veteran is silently injected into an operation they were not authored
 * into.
 */
export function campaignDeploymentsFor(
  state: CampaignState,
  def: CampaignDef,
  missionId: string,
): CampaignVeteranDeployment[] {
  const mission = missionOf(def, missionId);
  if (!mission) return [];
  const deployments: CampaignVeteranDeployment[] = [];
  const used = new Set<string>();
  const keys = new Set<string>();
  for (const slot of mission.veterans) {
    if (used.has(slot.veteranId) || keys.has(slot.key)) continue;
    const veteran = state.veterans.find(
      (entry) => entry.id === slot.veteranId && entry.defId === slot.defId,
    );
    if (!veteran) continue;
    used.add(veteran.id);
    keys.add(slot.key);
    deployments.push({ key: slot.key, veteranId: veteran.id });
  }
  return deployments;
}

/** The veterans actually placed for the active mission, in slot order. */
export function deployedVeterans(
  state: CampaignState,
  def: CampaignDef,
): Array<{ deployment: CampaignVeteranDeployment; veteran: CampaignVeteran }> {
  const mission = missionOf(def, state.currentMissionId);
  if (!mission) return [];
  const result: Array<{ deployment: CampaignVeteranDeployment; veteran: CampaignVeteran }> = [];
  for (const deployment of state.deployments) {
    const veteran = state.veterans.find((entry) => entry.id === deployment.veteranId);
    if (veteran) result.push({ deployment, veteran });
  }
  return result;
}

/** The mission document for the active operation, without deployment additions. */
export function campaignMissionDoc(
  def: CampaignDef,
  missionId: string,
): MissionDoc | undefined {
  return missionOf(def, missionId)?.mission;
}

/**
 * Enter the current operation.
 *
 * This is the only place the pre-mission snapshot is taken, and it is taken
 * before any deployment or mission runtime exists. Retrying restores exactly
 * this object.
 */
export function launchCampaignMission(
  state: CampaignState,
  def: CampaignDef,
  missionId: string = state.currentMissionId,
): CampaignState {
  if (state.campaignId !== def.id) {
    throw new CampaignStateError('definition-mismatch', 'Campaign definition does not match this run.');
  }
  if (state.phase !== 'briefing') {
    throw new CampaignStateError(
      'phase-mismatch',
      `Cannot launch from the ${state.phase} phase.`,
    );
  }
  if (!state.commander) {
    throw new CampaignStateError('no-commander', 'A commander profile is required before deploying.');
  }
  if (missionId !== state.currentMissionId) {
    throw new CampaignStateError(
      'mission-not-current',
      `"${missionId}" is not the next operation; "${state.currentMissionId}" is.`,
    );
  }
  if (!missionOf(def, missionId)) {
    throw new CampaignStateError('unknown-mission', `Unknown operation "${missionId}".`);
  }
  return {
    ...state,
    phase: 'playing',
    preMission: snapshotOf(state),
    deployments: campaignDeploymentsFor(state, def, missionId),
    pending: null,
  };
}

/**
 * Record the operation's captured result.
 *
 * The result is authoritative and copied; nothing recounts it. Entering this
 * phase does not change the roster, variables or completed set.
 */
export function submitCampaignResult(
  state: CampaignState,
  def: CampaignDef,
  missionId: string,
  result: MissionResult,
  /**
   * The flag flown when the operation launched. It is recorded with the result
   * so a debrief reopened after a reload still reports the battle that was
   * fought, not whatever is equipped now.
   */
  flag?: FlagComposition | null,
): CampaignState {
  if (state.phase !== 'playing') {
    throw new CampaignStateError(
      'phase-mismatch',
      `Cannot submit a result from the ${state.phase} phase.`,
    );
  }
  if (missionId !== state.currentMissionId) {
    throw new CampaignStateError(
      'mission-not-current',
      `"${missionId}" is not the active operation; "${state.currentMissionId}" is.`,
    );
  }
  if (result.missionId !== missionId) {
    throw new CampaignStateError(
      'result-mismatch',
      `Result is for "${result.missionId}", not "${missionId}".`,
    );
  }
  if (!missionOf(def, missionId)) {
    throw new CampaignStateError('unknown-mission', `Unknown operation "${missionId}".`);
  }
  if (state.completed.some((record) => record.missionId === missionId)) {
    throw new CampaignStateError('already-accepted', `"${missionId}" has already been accepted.`);
  }
  const pending: CampaignPendingResult = {
    missionId,
    result: clone(result),
    deployments: state.deployments.map((entry) => ({ ...entry })),
    ...(flag ? { flag } : {}),
  };
  return { ...state, phase: 'debrief', pending };
}

/**
 * The mission document as the launched scenario actually carries it.
 *
 * Deployed veterans add entity metadata and carryover references at launch, so
 * reading a saved result against the static document would otherwise drop the
 * very entities the campaign needs to decide who survived.
 */
function docWithDeployments(
  doc: MissionDoc,
  deployments: readonly CampaignVeteranDeployment[],
  veterans: readonly CampaignVeteran[],
): MissionDoc {
  if (deployments.length === 0) return doc;
  const copy = clone(doc);
  for (const deployment of deployments) {
    if (copy.entities.some((entity) => entity.key === deployment.key)) continue;
    const veteran = veterans.find((entry) => entry.id === deployment.veteranId);
    if (!veteran) continue;
    copy.entities.push({ key: deployment.key, name: veteran.name, role: 'veteran' });
    if (!copy.carryover.assets.includes(deployment.key)) {
      copy.carryover.assets.push(deployment.key);
    }
  }
  return copy;
}

/**
 * Add entity metadata that a saved result carries but the static document does
 * not, such as a veteran who was later lost from the roster.
 */
function docWithSavedEntities(doc: MissionDoc, rawResult: unknown): MissionDoc {
  if (!rawResult || typeof rawResult !== 'object') return doc;
  const saved = (rawResult as Partial<MissionResult>).entities;
  if (!Array.isArray(saved) || saved.length === 0) return doc;
  const copy = clone(doc);
  for (const entry of saved) {
    if (!entry || typeof entry !== 'object') continue;
    const entity = entry as Partial<MissionResultEntity>;
    if (typeof entity.key !== 'string' || entity.key.length === 0) continue;
    if (copy.entities.some((existing) => existing.key === entity.key)) continue;
    const role = entity.role;
    if (role !== 'veteran' && role !== 'asset' && role !== 'protected' && role !== 'objective') {
      continue;
    }
    copy.entities.push({
      key: entity.key,
      ...(typeof entity.name === 'string' ? { name: entity.name } : {}),
      role,
    });
  }
  return copy;
}

function resultForDeployment(
  result: MissionResult,
  deployment: CampaignVeteranDeployment,
): boolean {
  const entity = result.entities.find((entry) => entry.key === deployment.key);
  if (!entity) {
    throw new CampaignStateError(
      'result-mismatch',
      `Result does not report the deployed veteran "${deployment.key}".`,
    );
  }
  return entity.survived;
}

/**
 * Accept the pending result: the campaign's only consequence transaction.
 *
 * Applies mission consequences, retires lost veterans, records the accepted
 * result and advances. Calling it twice is rejected because the first call both
 * records the mission and clears the pending result.
 */
export function acceptCampaignResult(state: CampaignState, def: CampaignDef): CampaignState {
  if (state.phase !== 'debrief' || !state.pending) {
    throw new CampaignStateError('no-pending-result', 'There is no mission result to accept.');
  }
  const { pending } = state;
  if (pending.missionId !== state.currentMissionId) {
    throw new CampaignStateError(
      'result-mismatch',
      'The pending result does not belong to the current operation.',
    );
  }
  if (state.completed.some((record) => record.missionId === pending.missionId)) {
    throw new CampaignStateError(
      'already-accepted',
      `"${pending.missionId}" has already been accepted.`,
    );
  }
  const mission = missionOf(def, pending.missionId);
  if (!mission) {
    throw new CampaignStateError('unknown-mission', `Unknown operation "${pending.missionId}".`);
  }

  const variables: Record<string, MissionValue> = { ...state.variables };
  for (const consequence of mission.mission.consequences) {
    const declared = def.variables.find((entry) => entry.id === consequence.key);
    if (!declared || !valueMatchesType(declared.type, consequence.value)) {
      throw new CampaignStateError(
        'definition-mismatch',
        `Operation "${mission.id}" writes campaign variable "${consequence.key}", which is not declared with that type.`,
      );
    }
    variables[consequence.key] = consequence.value;
  }

  const veterans = state.veterans.map((veteran) => ({
    ...veteran,
    missions: [...veteran.missions],
  }));
  for (const deployment of pending.deployments) {
    const index = veterans.findIndex((entry) => entry.id === deployment.veteranId);
    if (index < 0) {
      throw new CampaignStateError(
        'veteran-unavailable',
        `Deployed veteran "${deployment.veteranId}" is not in the roster.`,
      );
    }
    if (!resultForDeployment(pending.result, deployment)) {
      // Permanent loss happens here and nowhere else. A defeat screen nobody
      // accepted leaves the roster untouched.
      veterans.splice(index, 1);
      continue;
    }
    if (!veterans[index].missions.includes(pending.missionId)) {
      veterans[index].missions.push(pending.missionId);
    }
  }

  const record: CampaignMissionRecord = {
    missionId: pending.missionId,
    outcome: pending.result.outcome,
    result: clone(pending.result),
    ...(pending.deployments.length > 0
      ? { deployments: pending.deployments.map((entry) => ({ ...entry })) }
      : {}),
  };
  const completed = [...state.completed, record];
  const next = nextMissionOf(def, pending.missionId);
  if (!next) {
    return {
      ...state,
      phase: 'complete',
      completed,
      variables,
      veterans,
      preMission: null,
      deployments: [],
      pending: null,
    };
  }
  return {
    ...state,
    phase: 'briefing',
    currentMissionId: next.id,
    completed,
    variables,
    veterans,
    preMission: null,
    deployments: [],
    pending: null,
  };
}

/**
 * Roll back to the snapshot taken at launch.
 *
 * Works from either the debrief or a live mission. The roster, variables,
 * completed set and mission selection return exactly to their pre-mission
 * values; the player then deploys again from the briefing.
 */
export function retryCampaignMission(state: CampaignState): CampaignState {
  if (state.phase !== 'playing' && state.phase !== 'debrief') {
    throw new CampaignStateError(
      'phase-mismatch',
      `Cannot retry from the ${state.phase} phase.`,
    );
  }
  if (!state.preMission) {
    throw new CampaignStateError(
      'no-restore-point',
      'This run has no pre-mission snapshot to restore.',
    );
  }
  const snapshot = clone(state.preMission);
  return {
    campaignId: state.campaignId,
    definitionVersion: state.definitionVersion,
    commander: snapshot.commander,
    phase: 'briefing',
    currentMissionId: snapshot.currentMissionId,
    completed: snapshot.completed,
    variables: snapshot.variables,
    veterans: snapshot.veterans,
    preMission: null,
    deployments: [],
    pending: null,
  };
}

/**
 * The deck's legacy progress view, derived from authoritative state.
 *
 * Kept so the existing campaign rail keeps one source of truth: the cleared set
 * is the accepted mission list, never a second stored field.
 */
export function campaignProgressOf(
  state: CampaignState,
  def: CampaignDef,
): CampaignProgress {
  const completed = new Set(state.completed.map((record) => record.missionId));
  const cleared = def.missions
    .filter((mission) => completed.has(mission.id))
    .map((mission) => mission.id);
  return {
    version: 1,
    cleared: cleared.length > 0 ? { [def.id]: cleared } : {},
    lastSelection: { campaignId: def.id, missionId: state.currentMissionId },
  };
}

/* ------------------------------------------------------------------ */
/* Loading and normalisation                                          */
/* ------------------------------------------------------------------ */

function readVariables(
  def: CampaignDef,
  raw: unknown,
): Record<string, MissionValue> {
  const variables = initialVariables(def);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return variables;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const declared = def.variables.find((entry) => entry.id === key);
    if (!declared || !isMissionValue(value)) continue;
    if (!valueMatchesType(declared.type, value)) continue;
    variables[key] = value;
  }
  return variables;
}

function readVeterans(def: CampaignDef, raw: unknown): CampaignVeteran[] {
  const byId = new Map<string, CampaignVeteran>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Partial<CampaignVeteran>;
      if (typeof record.id !== 'string') continue;
      if (byId.has(record.id)) continue;
      const authored = def.roster.find((roster) => roster.id === record.id);
      if (!authored) continue;
      const missions = Array.isArray(record.missions)
        ? def.missions
            .filter(
              (mission) =>
                Array.isArray(record.missions) &&
                record.missions.some(
                  (id) => typeof id === 'string' && id === mission.id,
                ),
            )
            .map((mission) => mission.id)
        : [];
      byId.set(authored.id, {
        id: authored.id,
        name: typeof record.name === 'string' && record.name.trim() ? record.name : authored.name,
        defId: authored.defId,
        role: authored.role,
        missions,
      });
    }
  }
  // A roster individual missing from the save is treated as never having
  // existed rather than resurrected; authored veterans are only removed by an
  // accepted loss.
  return def.roster
    .map((authored) => byId.get(authored.id))
    .filter((entry): entry is CampaignVeteran => entry !== undefined);
}

function readCompleted(
  def: CampaignDef,
  raw: unknown,
  veterans: readonly CampaignVeteran[],
): CampaignMissionRecord[] {
  const byId = new Map<string, CampaignMissionRecord>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Partial<CampaignMissionRecord>;
      if (typeof record.missionId !== 'string') continue;
      const mission = missionOf(def, record.missionId);
      if (!mission || byId.has(record.missionId)) continue;
      const outcome = record.outcome === 'defeat' ? 'defeat' : 'victory';
      const deployments = readDeployments({ veterans }, record.deployments);
      const doc = docWithSavedEntities(
        docWithDeployments(mission.mission, deployments, veterans),
        record.result,
      );
      const result = readMissionResult(doc, record.result, outcome);
      byId.set(record.missionId, {
        missionId: mission.id,
        outcome,
        ...(result ? { result } : {}),
        ...(deployments.length > 0 ? { deployments } : {}),
        ...(record.legacy ? { legacy: true } : {}),
      });
    }
  }
  return def.missions
    .map((mission) => byId.get(mission.id))
    .filter((entry): entry is CampaignMissionRecord => entry !== undefined);
}

function readSnapshot(
  def: CampaignDef,
  raw: unknown,
): CampaignSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Partial<CampaignSnapshot>;
  let commander: CommanderIdentity | null = null;
  if (record.commander) {
    try {
      commander = normaliseCommanderIdentity(record.commander);
    } catch {
      return null;
    }
  }
  const current = missionOf(def, String(record.currentMissionId ?? ''));
  if (!current) return null;
  const veterans = readVeterans(def, record.veterans);
  return {
    commander,
    currentMissionId: current.id,
    completed: readCompleted(def, record.completed, veterans),
    variables: readVariables(def, record.variables),
    veterans,
  };
}

function readDeployments(
  state: { veterans: readonly CampaignVeteran[] },
  raw: unknown,
): CampaignVeteranDeployment[] {
  const deployments: CampaignVeteranDeployment[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  if (!Array.isArray(raw)) return deployments;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Partial<CampaignVeteranDeployment>;
    if (typeof record.key !== 'string' || typeof record.veteranId !== 'string') continue;
    if (keys.has(record.key) || ids.has(record.veteranId)) continue;
    const veteran = state.veterans.find((candidate) => candidate.id === record.veteranId);
    if (!veteran) continue;
    keys.add(record.key);
    ids.add(veteran.id);
    deployments.push({ key: record.key, veteranId: veteran.id });
  }
  return deployments;
}

function readPending(
  def: CampaignDef,
  raw: unknown,
  missionId: string,
  veterans: CampaignVeteran[],
): CampaignPendingResult | null {
  const mission = missionOf(def, missionId);
  if (!mission) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Partial<CampaignPendingResult>;
  if (record.missionId !== missionId) return null;
  const rawResult = record.result as Partial<MissionResult> | undefined;
  const outcome = rawResult?.outcome === 'defeat' ? 'defeat' : 'victory';
  const deployments = readDeployments({ veterans }, record.deployments);
  const result = readMissionResult(
    docWithDeployments(mission.mission, deployments, veterans),
    record.result,
    outcome,
  );
  if (!result) return null;
  // The flag is re-validated on read: a hand-edited save must not get an
  // arbitrary composition into the renderer, and an unreadable one is dropped
  // rather than failing the whole debrief.
  const flown = parseFlagComposition(record.flag);
  return {
    missionId,
    result,
    deployments,
    ...(flown.ok ? { flag: flown.composition } : {}),
  };
}

/**
 * Read a saved run against the current definition.
 *
 * Recoverable legacy gaps (a missing commander, an absent optional field, a
 * stale selection) are normalised. A state that cannot be trusted to mean what
 * it says — a terminal phase without its result, a debrief pointing at another
 * operation, a snapshot that does not match — falls back to the briefing for the
 * next incomplete operation instead of inventing progress.
 */
export function normalizeCampaignState(
  def: CampaignDef,
  raw: unknown,
): CampaignState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Partial<CampaignState>;
  if (record.campaignId !== def.id) return null;

  let commander: CommanderIdentity | null = null;
  if (record.commander) {
    try {
      commander = normaliseCommanderIdentity(record.commander);
    } catch {
      commander = null;
    }
  }
  const variables = readVariables(def, record.variables);
  const veterans = readVeterans(def, record.veterans);
  const completed = readCompleted(def, record.completed, veterans);
  const completedIds = new Set(completed.map((entry) => entry.missionId));
  const firstIncomplete = def.missions.find((mission) => !completedIds.has(mission.id)) ?? null;
  const allComplete = firstIncomplete === null;
  let currentMissionId =
    typeof record.currentMissionId === 'string' && missionOf(def, record.currentMissionId)
      ? record.currentMissionId
      : (firstIncomplete ?? def.missions[def.missions.length - 1]).id;
  if (completedIds.has(currentMissionId) && firstIncomplete) {
    currentMissionId = firstIncomplete.id;
  }
  if (allComplete) currentMissionId = def.missions[def.missions.length - 1].id;

  let phase: CampaignPhase = isCampaignPhase(record.phase) ? record.phase : 'briefing';
  if (allComplete) {
    phase = 'complete';
  } else if (phase === 'complete') {
    phase = 'briefing';
  }

  const preMission =
    phase === 'playing' ? readSnapshot(def, record.preMission) : null;
  if (phase === 'playing') {
    if (!preMission || preMission.currentMissionId !== currentMissionId) phase = 'briefing';
  }

  let pending: CampaignPendingResult | null = null;
  if (phase === 'debrief') {
    pending = readPending(def, record.pending, currentMissionId, veterans);
    if (!pending) phase = 'briefing';
  }
  if (phase === 'debrief' && !pending) phase = 'briefing';

  // A debrief's deployment list is the one carried by its pending result; the
  // run's own list is only live during the playing phase.
  const deployments =
    phase === 'playing'
      ? readDeployments({ veterans }, record.deployments)
      : pending
        ? pending.deployments.map((entry) => ({ ...entry }))
        : [];

  return {
    campaignId: def.id,
    definitionVersion:
      typeof record.definitionVersion === 'number'
        ? record.definitionVersion
        : def.version,
    commander,
    phase,
    currentMissionId,
    completed,
    variables,
    veterans,
    preMission: phase === 'playing' ? preMission : null,
    deployments,
    pending,
  };
}

/** Canonical campaign-save serialisation, shared by persistence and tests. */
export function serializeCampaignSave(save: CampaignSaveDoc): string {
  const runs: Record<string, CampaignState> = {};
  for (const key of Object.keys(save.runs).sort()) {
    const state = save.runs[key];
    if (!state) continue;
    runs[key] = {
      ...state,
      completed: state.completed.map((record) => ({ ...record })),
      variables: Object.fromEntries(
        Object.keys(state.variables)
          .sort()
          .map((id) => [id, state.variables[id]]),
      ),
      veterans: [...state.veterans]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((veteran) => ({ ...veteran, missions: [...veteran.missions] })),
      deployments: state.deployments.map((entry) => ({ ...entry })),
      pending: state.pending
        ? {
            ...state.pending,
            deployments: state.pending.deployments.map((entry) => ({ ...entry })),
          }
        : null,
      preMission: (() => {
        const pre = state.preMission;
        if (!pre) return null;
        return {
          ...pre,
          completed: pre.completed.map((record) => ({ ...record })),
          variables: Object.fromEntries(
            Object.keys(pre.variables)
              .sort()
              .map((id) => [id, pre.variables[id]]),
          ),
          veterans: [...pre.veterans]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((veteran) => ({ ...veteran, missions: [...veteran.missions] })),
        };
      })(),
    };
  }
  return JSON.stringify({
    format: save.format,
    version: save.version,
    runs,
    ...(save.lastSelection ? { lastSelection: save.lastSelection } : {}),
  });
}

/**
 * The playing-time check used by the app and validation: a campaign's operation
 * must name a nation that exists, and its side must match the campaign.
 */
export function campaignMissionNationIssues(
  def: CampaignDef,
  mission: CampaignMission,
  index: number,
): string[] {
  const issues: string[] = [];
  const command = NATIONS[mission.playerNationId];
  const opposition = NATIONS[mission.opponentNationId];
  if (!command) issues.push(`missions[${index}].playerNationId is not a playable nation`);
  if (!opposition) issues.push(`missions[${index}].opponentNationId is not a playable nation`);
  if (command && command.allianceId !== def.allianceId) {
    issues.push(`missions[${index}] command does not belong to ${def.allianceId}`);
  }
  if (opposition && opposition.allianceId === def.allianceId) {
    issues.push(`missions[${index}] opposition belongs to the campaign alliance`);
  }
  return issues;
}

/** Unit definitions a roster may legitimately use. */
export function isKnownUnitDef(defId: string): boolean {
  return Boolean(UNITS[defId]);
}
