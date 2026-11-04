/**
 * Deterministic mission trigger evaluator (Stage S3).
 *
 * The evaluator is a pure function over the authoritative mission runtime plus a
 * world snapshot the simulation supplies. Nothing here reads the HUD, the
 * renderer, wall-clock time or browser timers, and no action runs JavaScript:
 * actions are the typed members of the mission document.
 *
 * ## Ordering
 *
 * Triggers are evaluated in descending `priority`, then by trigger id, every
 * pass. After a trigger executes, evaluation restarts from the top of that
 * order, because its actions may have made a higher-priority trigger eligible.
 * A trigger executes at most once per tick (`executed`), so a self-sustaining
 * loop is impossible; at most `MAX_TRIGGER_EXECUTIONS_PER_TICK` triggers run in
 * a tick and any remaining work is deferred to the next tick.
 *
 * ## Firing policies
 *
 * - `once` — executes at most once in the mission.
 * - `once: false` with no cooldown — repeat: fires on the rising edge, i.e. when
 *   the conditions were false at the previous evaluation and are true now.
 * - `once: false` with a cooldown — fires whenever the conditions hold and at
 *   least `cooldownSeconds` have passed since the last execution, so it can
 *   repeat while the conditions stay true.
 * - `delaySeconds` — the execution is scheduled for `tick + ceil(seconds ×
 *   TICK_RATE)`. A pending execution is cancelled if the conditions stop holding
 *   before it is due, so a trigger never fires on a condition that no longer
 *   applies. A zero delay executes during the current evaluation.
 *
 * All timing is measured in simulation ticks. Absolute ticks are stored, so a
 * save and reload continue the same schedule.
 */
import { TICK_RATE } from '../sim/constants';
import { worldToTile } from '../sim/terrain';
import type {
  MissionCondition,
  MissionDoc,
  MissionRegionDoc,
  MissionTriggerDoc,
  MissionValue,
} from './types';
import type { MissionObjectiveChange, MissionRuntime, MissionTriggerRuntime } from './runtime';

/**
 * Fixed ceiling on trigger executions in one tick. The remainder stays eligible
 * and is picked up by the next tick, which bounds a cascade without changing its
 * outcome for any authored mission that stays under the limit.
 */
export const MAX_TRIGGER_EXECUTIONS_PER_TICK = 16;

/** One live unit, as the simulation sees it for occupancy conditions. */
export interface MissionTriggerUnit {
  team: number;
  x: number;
  z: number;
}

/** The authoritative facts trigger conditions may read in one tick. */
export interface MissionTriggerWorld {
  /** Absolute simulation tick. */
  tick: number;
  /** Absolute tick the mission began on, for elapsed-time conditions. */
  startedAtTick: number;
  /** Live units only (`kind === 'unit'` and `hp > 0`). */
  units: readonly MissionTriggerUnit[];
  /** Authored placement keys whose entity currently exists with `hp > 0`. */
  aliveAuthored: ReadonlySet<string>;
}

/** Side effects the simulation supplies; the evaluator never renders anything. */
export interface MissionTriggerEffects {
  /** Emit one mission message through the normal simulation notice pathway. */
  message(text: string): void;
  /** Relay objective transitions so the HUD and log see ordinary events. */
  objectiveChanged(changes: readonly MissionObjectiveChange[]): void;
}

function toTicks(seconds: number | undefined): number {
  if (seconds === undefined) return 0;
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  // Ceiling, never floor: a delay must not complete before its authored time and
  // a cooldown must not allow a faster rate than authored.
  return Math.ceil(seconds * TICK_RATE);
}

/** Higher priority first, then id, so document order can never decide a tie. */
export function orderedMissionTriggers(doc: MissionDoc): MissionTriggerDoc[] {
  return [...doc.triggers].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id),
  );
}

function compareValues(
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte',
  actual: MissionValue,
  expected: MissionValue,
): boolean {
  if (op === 'eq') return actual === expected;
  if (op === 'ne') return actual !== expected;
  // Ordering comparisons are only meaningful for numbers; the validator rejects
  // other declared types, and a mismatched runtime value simply does not hold.
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  switch (op) {
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
  }
}

function insideRegion(region: MissionRegionDoc, x: number, z: number): boolean {
  // The same world-to-tile conversion the simulation uses for fog, vision and
  // capture, so a region means the same ground everywhere.
  const tx = worldToTile(x);
  const tz = worldToTile(z);
  return (
    tx >= region.x &&
    tx < region.x + region.width &&
    tz >= region.z &&
    tz < region.z + region.height
  );
}

/**
 * Evaluate one condition against the runtime and the world snapshot.
 *
 * The document schema composes conditions as an AND list; there is no OR group,
 * so none is invented here.
 */
export function missionConditionHolds(
  doc: MissionDoc,
  runtime: MissionRuntime,
  world: MissionTriggerWorld,
  condition: MissionCondition,
): boolean {
  switch (condition.kind) {
    case 'elapsed':
      return (world.tick - world.startedAtTick) / TICK_RATE >= condition.seconds;
    case 'variable': {
      const actual = runtime.variables[condition.variable];
      if (actual === undefined) return false;
      return compareValues(condition.op, actual, condition.value);
    }
    case 'objective':
      return runtime.objectiveState(condition.objective) === condition.state;
    case 'entityAlive':
      return world.aliveAuthored.has(condition.entity);
    case 'entityDead':
      // A placement that was never spawned counts as lost: an authored goal
      // cannot be "not yet true" forever because the entity never appeared.
      return !world.aliveAuthored.has(condition.entity);
    case 'regionOccupied': {
      const region = doc.regions.find((entry) => entry.id === condition.region);
      if (!region) return false;
      let count = 0;
      for (const unit of world.units) {
        if (unit.team !== condition.team) continue;
        if (!insideRegion(region, unit.x, unit.z)) continue;
        count++;
        if (count >= condition.atLeast) return true;
      }
      return false;
    }
  }
}

function triggerConditionsHold(
  doc: MissionDoc,
  runtime: MissionRuntime,
  world: MissionTriggerWorld,
  trigger: MissionTriggerDoc,
): boolean {
  return trigger.conditions.every((condition) =>
    missionConditionHolds(doc, runtime, world, condition),
  );
}

type StepOutcome = 'executed' | 'changed' | 'wait';

/**
 * Advance one trigger by one evaluation step.
 *
 * `changed` means scheduling state moved (a delay was armed or cancelled) but no
 * action ran; the caller rescans once more because a cancellation can unblock
 * nothing but a schedule must not be mistaken for a firing.
 */
function stepTrigger(
  runtime: MissionRuntime,
  trigger: MissionTriggerDoc,
  state: MissionTriggerRuntime,
  world: MissionTriggerWorld,
  effects: MissionTriggerEffects,
): StepOutcome {
  const doc = runtime.doc;
  const conditionsHold = triggerConditionsHold(doc, runtime, world, trigger);
  const tick = world.tick;

  if (state.pendingDueTick !== null) {
    if (trigger.once && state.fired > 0) {
      // Invariant guard: a once trigger can never have work left after firing.
      state.pendingDueTick = null;
      return 'changed';
    }
    if (!conditionsHold) {
      // Documented cancellation rule: a delayed execution does not fire on a
      // condition that stopped holding while it waited.
      state.pendingDueTick = null;
      state.armed = false;
      return 'changed';
    }
    if (tick >= state.pendingDueTick) {
      executeTrigger(runtime, trigger, state, world, effects);
      return 'executed';
    }
    state.armed = true;
    return 'wait';
  }

  const wasArmed = state.armed;
  state.armed = conditionsHold;
  const cooldownTicks = toTicks(trigger.cooldownSeconds);
  let eligible: boolean;
  if (trigger.once) {
    eligible = state.fired === 0;
  } else if (trigger.cooldownSeconds !== undefined) {
    eligible =
      state.fired === 0 || tick - (state.lastFiredTick ?? 0) >= cooldownTicks;
  } else {
    eligible = !wasArmed;
  }
  if (!conditionsHold || !eligible) return 'wait';

  const delayTicks = toTicks(trigger.delaySeconds);
  if (delayTicks > 0) {
    state.pendingDueTick = tick + delayTicks;
    state.armed = true;
    return 'changed';
  }
  executeTrigger(runtime, trigger, state, world, effects);
  return 'executed';
}

function executeTrigger(
  runtime: MissionRuntime,
  trigger: MissionTriggerDoc,
  state: MissionTriggerRuntime,
  world: MissionTriggerWorld,
  effects: MissionTriggerEffects,
): void {
  state.pendingDueTick = null;
  state.fired += 1;
  state.lastFiredTick = world.tick;
  for (const action of trigger.actions) applyAction(runtime, action, effects);
}

function applyAction(
  runtime: MissionRuntime,
  action: MissionTriggerDoc['actions'][number],
  effects: MissionTriggerEffects,
): void {
  switch (action.kind) {
    case 'setVariable':
      // Refused by the runtime for unknown ids, wrong types or a finished
      // mission; a refused write simply does not move the cascade.
      runtime.setVariable(action.variable, action.value);
      return;
    case 'setObjective': {
      // All objective changes go through the S2 transition API, so dependency
      // settling, blockedBy bookkeeping and terminal protection still apply.
      if (action.state === 'hidden') return; // rejected by validation
      const result =
        action.state === 'active'
          ? runtime.activateObjective(action.objective)
          : action.state === 'complete'
            ? runtime.completeObjective(action.objective)
            : runtime.failObjective(action.objective);
      if (result.ok && result.changes.length > 0) effects.objectiveChanged(result.changes);
      return;
    }
    case 'message':
      effects.message(action.text);
      return;
    default:
      // `activateAiGroup`, `spawnReinforcement` and `endMission` are declared in
      // the document schema but are not executed in this build. Validation
      // reports them as deferred; ignoring them here keeps a mission authored
      // ahead of the runtime from crashing or half-applying.
      return;
  }
}

/**
 * Run one tick's worth of mission triggers.
 *
 * Returns the number of executions performed, which tests use to prove the
 * cascade budget is respected.
 */
export function evaluateMissionTriggers(
  runtime: MissionRuntime,
  world: MissionTriggerWorld,
  effects: MissionTriggerEffects,
): number {
  if (runtime.isTerminal) return 0;
  const ordered = orderedMissionTriggers(runtime.doc);
  if (ordered.length === 0) return 0;
  const states = new Map(runtime.state.triggers.map((state) => [state.id, state]));
  const executed = new Set<string>();
  let executions = 0;
  let progress = true;
  while (progress && !runtime.isTerminal) {
    progress = false;
    for (const trigger of ordered) {
      if (executed.has(trigger.id)) continue;
      const state = states.get(trigger.id);
      if (!state) continue;
      const outcome = stepTrigger(runtime, trigger, state, world, effects);
      if (outcome === 'executed') {
        executed.add(trigger.id);
        executions++;
        if (executions >= MAX_TRIGGER_EXECUTIONS_PER_TICK) return executions;
        // Restart from the highest priority so a cascade never reorders work.
        progress = true;
        break;
      }
      if (outcome === 'changed') progress = true;
    }
  }
  return executions;
}
