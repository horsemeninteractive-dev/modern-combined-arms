/**
 * Authoritative mission runtime (Stage S2).
 *
 * The runtime owns mission state and the rules that change it: objective
 * activation, dependency resolution, completion, failure and the mission
 * outcome. It is pure data plus methods — no rendering, no wall-clock time, no
 * second simulation clock. `Game` is the only caller that drives it, and only
 * from the fixed-step pipeline.
 *
 * Two invariants matter for later stages:
 *
 * 1. Every state change goes through a documented transition. `complete` and
 *    `failed` are terminal, a hidden objective cannot be completed directly, and
 *    a repeated call is refused rather than re-applied.
 * 2. There is exactly one canonical serialisation, used by both the save file
 *    and the state hash, so the two can never disagree about what a mission is.
 */
import type {
  MissionDoc,
  MissionObjectiveDoc,
  MissionObjectiveState,
  MissionOutcome,
  MissionResult,
  MissionValue,
  MissionVariableType,
} from './types';
import { readMissionResult } from './result';

export type MissionRuntimeOutcome = 'playing' | MissionOutcome;

/** One objective's live state. `blockedBy` records why a failed objective died. */
export interface MissionObjectiveRuntime {
  id: string;
  state: MissionObjectiveState;
  /**
   * Dependency ids whose failure made this objective impossible. Present only
   * on objectives that failed because a prerequisite failed, which keeps a
   * player's own failure distinguishable from a blocked chain.
   */
  blockedBy?: string[];
}

/**
 * One trigger's execution state.
 *
 * `fired` is the lifetime execution count (a once trigger never exceeds one).
 * `armed` records whether the conditions held at the previous evaluation, which
 * is what makes a repeat trigger fire on the rising edge rather than every tick.
 * `pendingDueTick` is an absolute simulation tick for a delayed execution and is
 * null when nothing is waiting.
 */
export interface MissionTriggerRuntime {
  id: string;
  fired: number;
  lastFiredTick: number | null;
  armed: boolean;
  pendingDueTick: number | null;
}

/**
 * Serializable mission state.
 *
 * Variable keys are emitted in sorted order, objectives and triggers in authored
 * order, so two runtimes with the same meaning always produce the same bytes.
 * `result` is null until the mission ends and is never recomputed afterwards.
 */
export interface MissionRuntimeState {
  missionId: string;
  version: number;
  variables: Record<string, MissionValue>;
  objectives: MissionObjectiveRuntime[];
  triggers: MissionTriggerRuntime[];
  /**
   * AI groups an action has released, in activation order.
   *
   * Activation is a one-way latch: a group that has been released stays
   * released, so a repeating trigger cannot re-task it every time it fires and
   * a save written afterwards resumes with the same battlefield.
   */
  groups: string[];
  /** Reinforcement waves that have already been placed on the map. */
  waves: string[];
  outcome: MissionRuntimeOutcome;
  result: MissionResult | null;
}

/** One objective transition, in the order the runtime applies them. */
export interface MissionObjectiveChange {
  id: string;
  from: MissionObjectiveState;
  to: MissionObjectiveState;
}

/** Why a requested transition did nothing. */
export type MissionTransitionReason =
  | 'unknown-objective'
  | 'invalid-transition'
  | 'dependency-incomplete'
  | 'mission-ended';

export interface MissionTransitionResult {
  ok: boolean;
  reason?: MissionTransitionReason;
  /** The requested change plus any dependency fallout it caused. */
  changes: MissionObjectiveChange[];
}

const OBJECTIVE_STATES: readonly MissionObjectiveState[] = [
  'hidden',
  'active',
  'complete',
  'failed',
];

function isMissionValue(value: unknown): value is MissionValue {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function matchesVariableType(type: MissionVariableType, value: MissionValue): boolean {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string';
}

/** Objectives an author explicitly held back wait for a trigger, not a dependency. */
function awaitsTrigger(objective: MissionObjectiveDoc): boolean {
  return objective.initialState === 'hidden';
}

/**
 * Opening state.
 *
 * An objective with prerequisites starts hidden whatever its `initialState`
 * says: dependencies gate activation, and an authored "active" cannot override
 * that. An objective with no prerequisites is active unless it is explicitly
 * trigger-gated.
 */
export function initialObjectiveState(objective: MissionObjectiveDoc): MissionObjectiveState {
  if (objective.dependsOn.length > 0) return 'hidden';
  return objective.initialState === 'hidden' ? 'hidden' : 'active';
}

/** Fresh state: authored defaults, initial objective visibility, no outcome. */
export function createMissionRuntimeState(doc: MissionDoc): MissionRuntimeState {
  const variables: Record<string, MissionValue> = {};
  // Authored order is not guaranteed to be stable across exporters, so the
  // record is built in sorted key order from the start.
  for (const variable of [...doc.variables].sort((a, b) => a.id.localeCompare(b.id))) {
    variables[variable.id] = variable.default;
  }
  return {
    missionId: doc.id,
    version: doc.version,
    variables,
    objectives: doc.objectives.map((objective) => ({
      id: objective.id,
      state: initialObjectiveState(objective),
    })),
    triggers: doc.triggers.map((trigger) => ({
      id: trigger.id,
      fired: 0,
      lastFiredTick: null,
      armed: false,
      pendingDueTick: null,
    })),
    groups: [],
    waves: [],
    outcome: 'playing',
    result: null,
  };
}

/**
 * The objective-only outcome rule.
 *
 * Victory needs at least one primary objective and every primary complete.
 * A single failed primary is a defeat. Secondary and bonus objectives are
 * deliberately absent: they never decide the mission.
 */
function objectiveOutcome(
  doc: MissionDoc,
  objectives: readonly MissionObjectiveRuntime[],
): MissionOutcome | null {
  const primaries = doc.objectives.filter((objective) => objective.kind === 'primary');
  if (primaries.length === 0) return null;
  const states = new Map(objectives.map((objective) => [objective.id, objective.state]));
  if (primaries.some((primary) => states.get(primary.id) === 'failed')) return 'defeat';
  if (primaries.every((primary) => states.get(primary.id) === 'complete')) return 'victory';
  return null;
}

/**
 * Resolve dependency fallout until nothing changes.
 *
 * A hidden objective whose prerequisites are all complete becomes active,
 * unless it is trigger-gated. A hidden objective with any failed prerequisite
 * becomes failed and records which dependencies blocked it, so a chain cannot
 * sit pending forever. Iterating to a fixed point handles multi-level chains
 * deterministically: objectives are visited in authored order on every pass.
 */
function settleObjectives(
  doc: MissionDoc,
  objectives: MissionObjectiveRuntime[],
): MissionObjectiveChange[] {
  const changes: MissionObjectiveChange[] = [];
  const byId = new Map(objectives.map((objective) => [objective.id, objective]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const authored of doc.objectives) {
      const runtime = byId.get(authored.id);
      if (!runtime || runtime.state !== 'hidden') continue;
      if (authored.dependsOn.length === 0) continue;
      const stateOf = (id: string) => byId.get(id)?.state;
      const failed = authored.dependsOn
        .filter((id) => stateOf(id) === 'failed')
        .sort((a, b) => a.localeCompare(b));
      if (failed.length > 0) {
        runtime.state = 'failed';
        runtime.blockedBy = failed;
        changes.push({ id: runtime.id, from: 'hidden', to: 'failed' });
        changed = true;
        continue;
      }
      const ready =
        !awaitsTrigger(authored) &&
        authored.dependsOn.every((id) => stateOf(id) === 'complete');
      if (ready) {
        runtime.state = 'active';
        changes.push({ id: runtime.id, from: 'hidden', to: 'active' });
        changed = true;
      }
    }
  }
  return changes;
}

/**
 * Rebuild state from a save.
 *
 * Unknown ids are dropped rather than resurrected, missing variables fall back
 * to their authored defaults, and a state that belongs to a different mission is
 * refused by the caller. Normalising here (instead of trusting the file) means a
 * hand-edited save cannot invent a variable, skip an objective or park a mission
 * with completed prerequisites in a permanently hidden state.
 */
export function normalizeMissionRuntimeState(
  doc: MissionDoc,
  raw: unknown,
): MissionRuntimeState {
  const fresh = createMissionRuntimeState(doc);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fresh;
  const candidate = raw as Partial<MissionRuntimeState>;
  if (candidate.missionId !== doc.id || candidate.version !== doc.version) return fresh;
  const variables: Record<string, MissionValue> = { ...fresh.variables };
  const rawVariables = candidate.variables;
  if (rawVariables && typeof rawVariables === 'object' && !Array.isArray(rawVariables)) {
    for (const [id, value] of Object.entries(rawVariables)) {
      if (!(id in variables)) continue;
      if (!isMissionValue(value)) continue;
      variables[id] = value;
    }
  }
  // `pending` was the inert S1 placeholder. A save written then is read as the
  // objective's authored opening state rather than as a fifth state.
  const saved = new Map<string, MissionObjectiveState>();
  if (Array.isArray(candidate.objectives)) {
    for (const entry of candidate.objectives) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Partial<MissionObjectiveRuntime>;
      if (typeof record.id !== 'string') continue;
      const rawState: unknown = record.state;
      const state =
        rawState === 'pending'
          ? initialObjectiveState(
              doc.objectives.find((objective) => objective.id === record.id) ?? {
                id: record.id,
                title: '',
                kind: 'primary',
                dependsOn: [],
              },
            )
          : rawState;
      if (!OBJECTIVE_STATES.includes(state as MissionObjectiveState)) continue;
      saved.set(record.id, state as MissionObjectiveState);
    }
  }
  const authored = new Map(doc.objectives.map((objective) => [objective.id, objective]));
  const objectives: MissionObjectiveRuntime[] = fresh.objectives.map((objective) => ({
    id: objective.id,
    state: saved.get(objective.id) ?? objective.state,
  }));
  // Carry a saved blocking reason only where it is still meaningful.
  if (Array.isArray(candidate.objectives)) {
    for (const entry of candidate.objectives) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Partial<MissionObjectiveRuntime>;
      const targeted = objectives.find((objective) => objective.id === record.id);
      if (!targeted || targeted.state !== 'failed') continue;
      if (!Array.isArray(record.blockedBy)) continue;
      const blockedBy = [
        ...new Set(
          record.blockedBy.filter(
            (id): id is string =>
              typeof id === 'string' && authored.has(id) && id !== record.id,
          ),
        ),
      ].sort((a, b) => a.localeCompare(b));
      if (blockedBy.length > 0) targeted.blockedBy = blockedBy;
    }
  }
  // Dependency fallout is derived from state, so replaying it after loading
  // cannot duplicate an activation: already-active objectives are left alone.
  settleObjectives(doc, objectives);

  // Trigger execution state. A save written before triggers existed has no
  // field and starts every trigger unfired; an id that is no longer authored is
  // dropped, and an untrusted value falls back to its default.
  const savedTriggers = new Map<string, Partial<MissionTriggerRuntime>>();
  if (Array.isArray(candidate.triggers)) {
    for (const entry of candidate.triggers) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Partial<MissionTriggerRuntime>;
      if (typeof record.id !== 'string') continue;
      if (savedTriggers.has(record.id)) continue;
      savedTriggers.set(record.id, record);
    }
  }
  const triggers: MissionTriggerRuntime[] = fresh.triggers.map((trigger) => {
    const savedTrigger = savedTriggers.get(trigger.id);
    if (!savedTrigger) return trigger;
    const authored = doc.triggers.find((candidateTrigger) => candidateTrigger.id === trigger.id);
    const rawFired = savedTrigger.fired;
    let fired =
      typeof rawFired === 'number' && Number.isInteger(rawFired) && rawFired >= 0
        ? rawFired
        : 0;
    if (authored?.once) fired = Math.min(1, fired);
    const integerTick = (value: unknown): number | null =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
    const lastFiredTick = integerTick(savedTrigger.lastFiredTick);
    // A once trigger that already fired has no work left, so a stale pending
    // delay in a hand-edited file is dropped rather than executed.
    const pendingDueTick = authored?.once && fired > 0
      ? null
      : integerTick(savedTrigger.pendingDueTick);
    return {
      id: trigger.id,
      fired,
      // A trigger that has fired must have a timestamp; tick 0 is the safest
      // reconstruction if a hand-edited file lost it.
      lastFiredTick: fired > 0 ? (lastFiredTick ?? 0) : null,
      armed: savedTrigger.armed === true,
      pendingDueTick,
    };
  });

  // Group and wave bookkeeping. Both are one-way latches, so an id that is no
  // longer authored is dropped rather than resurrected, and a hand-edited file
  // cannot mark an unknown group active.
  const knownGroups = new Set(doc.aiGroups.map((group) => group.id));
  const knownWaves = new Set(doc.reinforcements.map((wave) => wave.id));
  const latches = (value: unknown, known: ReadonlySet<string>): string[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const entry of value) {
      if (typeof entry !== 'string' || !known.has(entry)) continue;
      seen.add(entry);
    }
    return [...seen];
  };
  const groups = latches(candidate.groups, knownGroups);
  const waves = latches(candidate.waves, knownWaves);

  let outcome: MissionRuntimeOutcome = 'playing';
  if (candidate.outcome === 'victory' || candidate.outcome === 'defeat') {
    outcome = candidate.outcome;
  } else {
    // A save taken exactly at completion keeps its terminal outcome without a
    // result; `Game` captures the result from the restored state.
    outcome = objectiveOutcome(doc, objectives) ?? 'playing';
  }
  const result = readMissionResult(doc, candidate.result, outcome);
  return {
    missionId: doc.id,
    version: doc.version,
    variables,
    objectives,
    triggers,
    groups,
    waves,
    outcome,
    result,
  };
}

/**
 * Canonical serialisation shared by the save file and the state hash.
 *
 * Keys are sorted explicitly rather than relying on insertion order, so a save
 * written by one code path and a hash computed by another agree.
 */
export function serializeMissionRuntime(state: MissionRuntimeState): string {
  const variables: Record<string, MissionValue> = {};
  for (const key of Object.keys(state.variables).sort()) variables[key] = state.variables[key];
  return JSON.stringify({
    missionId: state.missionId,
    version: state.version,
    variables,
    objectives: state.objectives.map((objective) =>
      objective.blockedBy && objective.blockedBy.length > 0
        ? [objective.id, objective.state, objective.blockedBy.join('+')]
        : [objective.id, objective.state],
    ),
    triggers: state.triggers.map((trigger) => [
      trigger.id,
      trigger.fired,
      trigger.lastFiredTick ?? -1,
      trigger.armed ? 1 : 0,
      trigger.pendingDueTick ?? -1,
    ]),
    groups: [...state.groups],
    waves: [...state.waves],
    outcome: state.outcome,
    result: state.result,
  });
}

/**
 * 32-bit FNV-1a over the canonical serialisation.
 *
 * A short digest keeps the simulation state hash readable, and because the input
 * is canonical the digest changes exactly when mission state changes.
 */
export function missionRuntimeHash(state: MissionRuntimeState): string {
  let hash = 0x811c9dc5;
  const text = serializeMissionRuntime(state);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The authoritative mission runtime for a mission-bearing scenario. */
export class MissionRuntime {
  /** True while a trigger's actions are being applied (see `beginActionBatch`). */
  private actionBatch = false;

  constructor(
    readonly doc: MissionDoc,
    /** The authoritative state object; `GameState.mission` points at this. */
    readonly state: MissionRuntimeState,
  ) {}

  static fromDoc(doc: MissionDoc): MissionRuntime {
    return new MissionRuntime(doc, createMissionRuntimeState(doc));
  }

  /**
   * Restore from a save. A state that names another mission or version is not
   * trusted; the caller gets a fresh runtime instead of a half-applied one.
   */
  static fromState(doc: MissionDoc, raw: unknown): MissionRuntime {
    return new MissionRuntime(doc, normalizeMissionRuntimeState(doc, raw));
  }

  get id(): string {
    return this.state.missionId;
  }

  get version(): number {
    return this.state.version;
  }

  get variables(): Readonly<Record<string, MissionValue>> {
    return this.state.variables;
  }

  get objectives(): readonly MissionObjectiveRuntime[] {
    return this.state.objectives;
  }

  get outcome(): MissionRuntimeOutcome {
    return this.state.outcome;
  }

  get result(): MissionResult | null {
    return this.state.result;
  }

  /** True once an outcome exists; no further transition is accepted afterwards. */
  get isTerminal(): boolean {
    return this.state.outcome !== 'playing';
  }

  /** Current state of one objective, or undefined for an unknown id. */
  objectiveState(id: string): MissionObjectiveState | undefined {
    return this.state.objectives.find((objective) => objective.id === id)?.state;
  }

  /** Title as authored, for feedback text; never invented by the runtime. */
  objectiveTitle(id: string): string | undefined {
    return this.doc.objectives.find((objective) => objective.id === id)?.title;
  }

  /**
   * Make a trigger-gated objective available.
   *
   * Dependencies are enforced here as well as by dependency resolution: a
   * trigger cannot activate a dependent objective before its prerequisites
   * complete, so authored ordering holds no matter who asks.
   */
  activateObjective(id: string): MissionTransitionResult {
    const objective = this.find(id);
    if (!objective) return { ok: false, reason: 'unknown-objective', changes: [] };
    if (this.isTerminal) return { ok: false, reason: 'mission-ended', changes: [] };
    const runtime = this.runtimeFor(id)!;
    if (runtime.state !== 'hidden') {
      return { ok: false, reason: 'invalid-transition', changes: [] };
    }
    const deps = objective.dependsOn;
    if (!deps.every((dependency) => this.objectiveState(dependency) === 'complete')) {
      return { ok: false, reason: 'dependency-incomplete', changes: [] };
    }
    return this.apply(runtime, 'active');
  }

  /** Complete an active objective and resolve any dependents it unlocks. */
  completeObjective(id: string): MissionTransitionResult {
    const runtime = this.findRuntime(id);
    if (!runtime) return { ok: false, reason: 'unknown-objective', changes: [] };
    if (this.isTerminal) return { ok: false, reason: 'mission-ended', changes: [] };
    if (runtime.state !== 'active') {
      return { ok: false, reason: 'invalid-transition', changes: [] };
    }
    return this.apply(runtime, 'complete');
  }

  /** Fail an active objective; dependents that can no longer activate fail too. */
  failObjective(id: string): MissionTransitionResult {
    const runtime = this.findRuntime(id);
    if (!runtime) return { ok: false, reason: 'unknown-objective', changes: [] };
    if (this.isTerminal) return { ok: false, reason: 'mission-ended', changes: [] };
    if (runtime.state !== 'active') {
      return { ok: false, reason: 'invalid-transition', changes: [] };
    }
    return this.apply(runtime, 'failed');
  }

  /**
   * Evaluate the mission outcome, optionally because the local player's force
   * was destroyed. Returns true when the outcome changed.
   *
   * A force defeat is a mission defeat even when every objective happens to be
   * complete, because the commander no longer holds the field.
   */
  evaluateOutcome(forceDefeat = false): boolean {
    if (this.isTerminal) return false;
    if (forceDefeat) {
      this.state.outcome = 'defeat';
      return true;
    }
    return this.commitOutcome();
  }

  /**
   * Write a declared mission variable.
   *
   * Unknown ids, values that do not match the declared type and writes after the
   * outcome is committed are refused, so authored content can neither invent a
   * variable nor damage a finished mission. Returns true only when the value
   * actually changed, which is what lets a trigger cascade detect movement.
   */
  setVariable(id: string, value: MissionValue): boolean {
    if (this.isTerminal) return false;
    const declared = this.doc.variables.find((variable) => variable.id === id);
    if (!declared) return false;
    if (!matchesVariableType(declared.type, value)) return false;
    if (this.state.variables[id] === value) return false;
    this.state.variables[id] = value;
    return true;
  }

  /**
   * Release an authored AI group, exactly once.
   *
   * Returns true only when this call released the group, which is what tells
   * the trigger evaluator to hand it to the simulation. A second activation of
   * the same group, an unknown id, or a release after the mission ended is
   * refused without touching the latch.
   */
  activateGroup(id: string): boolean {
    if (this.isTerminal) return false;
    if (!this.doc.aiGroups.some((group) => group.id === id)) return false;
    if (this.state.groups.includes(id)) return false;
    this.state.groups.push(id);
    return true;
  }

  /** Whether an action has already released this group. */
  isGroupActive(id: string): boolean {
    return this.state.groups.includes(id);
  }

  /**
   * Record that a reinforcement wave has been placed, exactly once.
   *
   * Spawning is not idempotent — placing the same column twice would double the
   * force — so the latch is written before the simulation is asked to place it,
   * and a save taken afterwards can never spawn it again.
   */
  markWaveSpawned(id: string): boolean {
    if (this.isTerminal) return false;
    if (!this.doc.reinforcements.some((wave) => wave.id === id)) return false;
    if (this.state.waves.includes(id)) return false;
    this.state.waves.push(id);
    return true;
  }

  /** Whether this wave has already been placed. */
  isWaveSpawned(id: string): boolean {
    return this.state.waves.includes(id);
  }

  /**
   * Commit an authored ending.
   *
   * This is the only way a trigger can decide the battle. The verdict is
   * recorded on the authoritative runtime, so the ordinary pipeline captures the
   * result and finishes the match from the same state every other outcome uses;
   * there is no client-side shortcut and no second result path.
   */
  forceOutcome(outcome: MissionOutcome): boolean {
    if (this.isTerminal) return false;
    this.state.outcome = outcome;
    return true;
  }

  /**
   * Hold the mission outcome open while a batch of actions is applied.
   *
   * The trigger evaluator wraps one trigger's actions in a batch: completing the
   * final primary objective inside it must not stop the trigger's remaining
   * authored actions (a bonus objective has to be completable on the victory
   * tick). The outcome commits once the batch ends, and never reopens after
   * that.
   */
  beginActionBatch(): void {
    this.actionBatch = true;
  }

  endActionBatch(): void {
    if (!this.actionBatch) return;
    this.actionBatch = false;
    this.commitOutcome();
  }

  /** Commit the objective-derived outcome once, unless one already exists. */
  private commitOutcome(): boolean {
    if (this.isTerminal) return false;
    const computed = objectiveOutcome(this.doc, this.state.objectives);
    if (!computed) return false;
    this.state.outcome = computed;
    return true;
  }

  /**
   * Store the captured result exactly once. A result for a mission that is
   * still playing, or a second result for a finished one, is refused.
   */
  finalizeResult(outcome: MissionOutcome, result: MissionResult): boolean {
    if (this.state.result) return false;
    if (result.outcome !== outcome || result.missionId !== this.state.missionId) return false;
    if (this.state.outcome === 'playing') this.state.outcome = outcome;
    else if (this.state.outcome !== outcome) return false;
    this.state.result = result;
    return true;
  }

  /** A defensive copy: the save writer must not be able to mutate live state. */
  snapshot(): MissionRuntimeState {
    return {
      missionId: this.state.missionId,
      version: this.state.version,
      variables: { ...this.state.variables },
      objectives: this.state.objectives.map((objective) => ({
        id: objective.id,
        state: objective.state,
        ...(objective.blockedBy ? { blockedBy: [...objective.blockedBy] } : {}),
      })),
      triggers: this.state.triggers.map((trigger) => ({ ...trigger })),
      groups: [...this.state.groups],
      waves: [...this.state.waves],
      outcome: this.state.outcome,
      result: this.state.result ? structuredClone(this.state.result) : null,
    };
  }

  serialize(): string {
    return serializeMissionRuntime(this.state);
  }

  hash(): string {
    return missionRuntimeHash(this.state);
  }

  private find(id: string): MissionObjectiveDoc | undefined {
    return this.doc.objectives.find((objective) => objective.id === id);
  }

  private runtimeFor(id: string): MissionObjectiveRuntime | undefined {
    return this.state.objectives.find((objective) => objective.id === id);
  }

  private findRuntime(id: string): MissionObjectiveRuntime | undefined {
    return this.runtimeFor(id);
  }

  /**
   * Apply one transition, then settle dependencies and recompute the outcome.
   * The returned `changes` is everything that moved, in application order.
   */
  private apply(
    runtime: MissionObjectiveRuntime,
    next: MissionObjectiveState,
  ): MissionTransitionResult {
    const changes: MissionObjectiveChange[] = [
      { id: runtime.id, from: runtime.state, to: next },
    ];
    runtime.state = next;
    delete runtime.blockedBy;
    changes.push(...settleObjectives(this.doc, this.state.objectives));
    // Inside an action batch the outcome is deliberately not committed yet: the
    // trigger's remaining actions run first, then the tick's evaluation point
    // settles the verdict.
    if (!this.actionBatch) this.commitOutcome();
    return { ok: true, changes };
  }
}
