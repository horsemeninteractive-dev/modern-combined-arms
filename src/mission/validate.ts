/**
 * Mission document validation.
 *
 * This checks everything that can be known from the authored data alone, plus
 * the cross-document facts the enclosing scenario supplies (map bounds and
 * authored placement keys). It deliberately does not pretend to know things
 * that require a running mission: objective reachability, trigger cycles and
 * reinforcement timing all depend on semantics later stages will implement, and
 * are recorded as future work in the completion report rather than guessed at
 * here.
 *
 * The function never throws. `parseMission` turns any `error` issue into a
 * `MissionFormatError` with the issue's path, and the scenario validator
 * surfaces warnings and information alongside its own findings.
 */
import { UNITS } from '../data/units';
import { MUSIC_TRACKS_BY_ID } from '../ui/musicCatalogue';
import type {
  MissionAction,
  MissionCinematicStep,
  MissionCondition,
  MissionDoc,
  MissionIssue,
  MissionValidationContext,
  MissionValue,
  MissionVariableType,
} from './types';

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

/** Ids are authored references, so they are restricted to a boring alphabet. */
export function isMissionId(value: string): boolean {
  return ID_PATTERN.test(value);
}

function valueMatches(type: MissionVariableType, value: MissionValue): boolean {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string';
}

function secondsLabel(seconds: number): string {
  return Number.isFinite(seconds) ? `${seconds}s` : 'an invalid duration';
}

/** Elapsed time of one beat, matching the presentation clock. */
function cinematicStepDuration(step: MissionCinematicStep): number {
  if (step.kind === 'camera') return step.durationSeconds + (step.holdSeconds ?? 0);
  if (step.kind === 'line') return step.durationSeconds + (step.pauseSeconds ?? 0);
  if (step.kind === 'sound') return step.durationSeconds ?? 0;
  if (step.kind === 'card' || step.kind === 'music') return step.durationSeconds ?? 0;
  if (step.kind === 'actor') return step.durationSeconds;
  return step.durationSeconds ?? 2.5;
}

/** Authored media must stay inside the project, with no scheme or traversal. */
function safeCinematicAsset(value: string): boolean {
  return /^(?!\/\/)(?!.*\.\.)[A-Za-z0-9._~!$&'()+,;=:@%/-]+$/.test(value);
}

export function validateMission(
  doc: MissionDoc,
  context: MissionValidationContext = {},
): MissionIssue[] {
  const issues: MissionIssue[] = [];
  const add = (
    severity: MissionIssue['severity'],
    code: string,
    message: string,
    path: string,
  ) => issues.push({ severity, code, message, path });

  if (!isMissionId(doc.id)) {
    add('error', 'mission-id-invalid', `Mission id "${doc.id}" is not a valid identifier.`, 'id');
  }
  if (doc.title.trim().length === 0) {
    add('error', 'mission-title-missing', 'Mission has no title.', 'title');
  }
  if (doc.campaign) {
    if (!isMissionId(doc.campaign.campaignId)) {
      add(
        'error',
        'campaign-id-invalid',
        `Campaign id "${doc.campaign.campaignId}" is not a valid identifier.`,
        'campaign.campaignId',
      );
    }
    if (!Number.isInteger(doc.campaign.order) || doc.campaign.order < 1) {
      add(
        'error',
        'campaign-order-invalid',
        'Campaign order must be a whole number starting at 1.',
        'campaign.order',
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Briefing copy                                                     */
  /* ---------------------------------------------------------------- */

  // The three core fields are what an operation dossier cannot omit. The
  // optional sections are allowed to be absent, but an authored blank is a
  // mistake worth reporting rather than a paragraph the UI silently drops.
  const briefingFields: Array<[keyof typeof doc.briefing, string]> = [
    ['summary', 'summary'],
    ['friendly', 'friendly'],
    ['enemy', 'enemy'],
  ];
  for (const [key, path] of briefingFields) {
    const value = doc.briefing[key];
    if (typeof value === 'string' && value.trim().length === 0) {
      add('error', 'briefing-empty', `Briefing ${path} is empty.`, `briefing.${path}`);
    }
  }
  for (const key of ['subtitle', 'context', 'commanderNote', 'enemyIntent'] as const) {
    const value = doc.briefing[key];
    if (value !== undefined && value.trim().length === 0) {
      add(
        'warning',
        'briefing-section-empty',
        `Briefing ${key} is authored but empty.`,
        `briefing.${key}`,
      );
    }
  }
  for (const key of ['personnel', 'instructions'] as const) {
    doc.briefing[key]?.forEach((entry, i) => {
      if (entry.trim().length === 0) {
        add(
          'error',
          'briefing-entry-empty',
          `Briefing ${key}[${i}] is empty.`,
          `briefing.${key}[${i}]`,
        );
      }
    });
  }
  if (doc.briefing.instructions && doc.briefing.instructions.length > 8) {
    add(
      'warning',
      'briefing-instructions-long',
      'More than eight operational instructions will not fit a compact briefing.',
      'briefing.instructions',
    );
  }
  if (doc.debrief) {
    for (const key of ['victory', 'defeat'] as const) {
      const value = doc.debrief[key];
      if (value !== undefined && value.trim().length === 0) {
        add(
          'warning',
          'debrief-copy-empty',
          `Debrief ${key} copy is authored but empty.`,
          `debrief.${key}`,
        );
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Namespaced id uniqueness                                          */
  /* ---------------------------------------------------------------- */

  // Each authored namespace is independent: an objective and a region may share
  // a name, but two objectives may not.
  // Entities are keyed by their authored placement key rather than an "id",
  // but they are still one namespace for uniqueness purposes.
  const namespaces: Array<[name: string, ids: string[], field: string]> = [
    ['objectives', doc.objectives.map((entry) => entry.id), 'id'],
    ['variables', doc.variables.map((entry) => entry.id), 'id'],
    ['regions', doc.regions.map((entry) => entry.id), 'id'],
    ['triggers', doc.triggers.map((entry) => entry.id), 'id'],
    ['aiGroups', doc.aiGroups.map((entry) => entry.id), 'id'],
    ['reinforcements', doc.reinforcements.map((entry) => entry.id), 'id'],
    ['entities', doc.entities.map((entry) => entry.key), 'key'],
    ['cinematics', doc.cinematics.map((entry) => entry.id), 'id'],
    ['consequences', doc.consequences.map((entry) => entry.id), 'id'],
  ];
  const index = new Map<string, Set<string>>();
  for (const [name, ids, field] of namespaces) {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      const path = `${name}[${i}].${field}`;
      if (!isMissionId(id)) {
        add('error', 'child-id-invalid', `${name}[${i}] ${field} "${id}" is not a valid identifier.`, path);
        return;
      }
      if (seen.has(id)) {
        add('error', 'duplicate-id', `${name} has more than one entry with ${field} "${id}".`, path);
        return;
      }
      seen.add(id);
    });
    index.set(name, seen);
  }
  const objectives = index.get('objectives')!;
  const variables = index.get('variables')!;
  const regions = index.get('regions')!;
  const triggers = index.get('triggers')!;
  const aiGroups = index.get('aiGroups')!;
  const reinforcements = index.get('reinforcements')!;

  /* ---------------------------------------------------------------- */
  /* Variables                                                         */
  /* ---------------------------------------------------------------- */

  doc.variables.forEach((variable, i) => {
    if (!valueMatches(variable.type, variable.default)) {
      add(
        'error',
        'variable-default-type',
        `Variable "${variable.id}" is declared ${variable.type} but defaults to ${JSON.stringify(variable.default)}.`,
        `variables[${i}].default`,
      );
    }
  });

  /* ---------------------------------------------------------------- */
  /* Regions                                                           */
  /* ---------------------------------------------------------------- */

  doc.regions.forEach((region, i) => {
    if (!Number.isInteger(region.x) || !Number.isInteger(region.z) || region.x < 0 || region.z < 0) {
      add('error', 'region-origin-invalid', `Region "${region.id}" must start on a whole tile.`, `regions[${i}]`);
    }
    if (!Number.isInteger(region.width) || !Number.isInteger(region.height) || region.width < 1 || region.height < 1) {
      add(
        'error',
        'region-size-invalid',
        `Region "${region.id}" must be at least 1×1 whole tiles.`,
        `regions[${i}]`,
      );
      return;
    }
    if (context.width !== undefined && context.height !== undefined) {
      if (region.x + region.width > context.width || region.z + region.height > context.height) {
        add(
          'error',
          'region-out-of-bounds',
          `Region "${region.id}" extends past the ${context.width}×${context.height} map.`,
          `regions[${i}]`,
        );
      }
    }
  });

  /* ---------------------------------------------------------------- */
  /* Objectives                                                        */
  /* ---------------------------------------------------------------- */

  const OBJECTIVE_KINDS = ['primary', 'secondary', 'bonus'];
  const OBJECTIVE_INITIAL = ['active', 'hidden'];
  doc.objectives.forEach((objective, i) => {
    if (!(OBJECTIVE_KINDS as readonly string[]).includes(objective.kind)) {
      add(
        'error',
        'objective-kind-invalid',
        `Objective "${objective.id}" has unsupported kind "${String(objective.kind)}".`,
        `objectives[${i}].kind`,
      );
    }
    if (objective.initialState !== undefined) {
      if (!(OBJECTIVE_INITIAL as readonly string[]).includes(objective.initialState)) {
        add(
          'error',
          'objective-initial-invalid',
          `Objective "${objective.id}" has unsupported opening state "${String(objective.initialState)}".`,
          `objectives[${i}].initialState`,
        );
      } else if (objective.initialState === 'active' && objective.dependsOn.length > 0) {
        add(
          'warning',
          'objective-initial-active-ignored',
          `Objective "${objective.id}" opens hidden because it has prerequisites; its initialState is ignored.`,
          `objectives[${i}].initialState`,
        );
      }
    }
    const seenDeps = new Set<string>();
    objective.dependsOn.forEach((dependency, d) => {
      const path = `objectives[${i}].dependsOn[${d}]`;
      if (dependency === objective.id) {
        add('error', 'objective-self-dependency', `Objective "${objective.id}" depends on itself.`, path);
        return;
      }
      if (!objectives.has(dependency)) {
        add(
          'error',
          'objective-dependency-missing',
          `Objective "${objective.id}" depends on unknown objective "${dependency}".`,
          path,
        );
        return;
      }
      if (seenDeps.has(dependency)) {
        add(
          'error',
          'objective-dependency-duplicate',
          `Objective "${objective.id}" lists dependency "${dependency}" twice.`,
          path,
        );
      }
      seenDeps.add(dependency);
    });
    if (objective.kind === 'primary' && objective.dependsOn.length === 0) {
      // Not an error: a mission may open with a primary objective already live.
      add(
        'info',
        'objective-root',
        `Objective "${objective.id}" has no prerequisites and is available from the start.`,
        `objectives[${i}]`,
      );
    }
  });
  if (doc.objectives.length === 0) {
    add('warning', 'objectives-empty', 'Mission declares no objectives.', 'objectives');
  }
  // A mission is won by completing every primary objective and lost by failing
  // one. With none at all there is no outcome rule, so the document is refused
  // instead of producing a run that can never end.
  if (!doc.objectives.some((objective) => objective.kind === 'primary')) {
    add(
      'error',
      'mission-primary-missing',
      'Mission has no primary objective, so it could never be won or lost. Add at least one primary objective.',
      'objectives',
    );
  }

  // Dependency cycles are a property of the authored graph, so they are checked
  // here rather than waiting for a runtime that would simply never activate the
  // objectives in the loop.
  const byObjective = new Map(doc.objectives.map((objective) => [objective.id, objective]));
  const processed = new Set<string>();
  const visiting = new Set<string>();
  const trail: string[] = [];
  const visit = (id: string): boolean => {
    if (processed.has(id)) return false;
    if (visiting.has(id)) {
      const cycle = [...trail.slice(trail.indexOf(id)), id];
      const index = doc.objectives.findIndex((objective) => objective.id === id);
      add(
        'error',
        'objective-dependency-cycle',
        `Objectives form a dependency cycle: ${cycle.join(' → ')}.`,
        `objectives[${Math.max(0, index)}].dependsOn`,
      );
      return true;
    }
    visiting.add(id);
    trail.push(id);
    for (const dependency of byObjective.get(id)?.dependsOn ?? []) {
      // A self-reference is reported separately with a clearer message.
      if (dependency === id || !byObjective.has(dependency)) continue;
      visit(dependency);
    }
    trail.pop();
    visiting.delete(id);
    processed.add(id);
    return false;
  };
  for (const objective of doc.objectives) visit(objective.id);

  /* ---------------------------------------------------------------- */
  /* Authored entity references                                        */
  /* ---------------------------------------------------------------- */

  const knownEntityKeys = context.entityKeys;
  const checkEntityRef = (key: string, path: string, label: string) => {
    if (knownEntityKeys && !knownEntityKeys.has(key)) {
      add(
        'error',
        'entity-ref-missing',
        `${label} refers to authored entity "${key}", which is not placed in this scenario.`,
        path,
      );
    }
  };

  doc.entities.forEach((entity, i) => {
    checkEntityRef(entity.key, `entities[${i}].key`, 'Mission entity');
  });
  doc.objectives.forEach((objective, i) => {
    const seenProtected = new Set<string>();
    objective.protectedEntities?.forEach((key, p) => {
      const path = `objectives[${i}].protectedEntities[${p}]`;
      checkEntityRef(key, path, 'Objective');
      if (seenProtected.has(key)) {
        add(
          'warning',
          'objective-protected-duplicate',
          `Objective "${objective.id}" protects "${key}" more than once.`,
          path,
        );
      }
      seenProtected.add(key);
    });
  });
  if (doc.entities.length > 0 && !knownEntityKeys) {
    // Standalone documents cannot resolve placement keys; that is checked when
    // the mission is attached to a scenario, not a property of the document.
    add(
      'info',
      'entity-keys-unchecked',
      'Authored entity keys are only resolved when the mission is validated inside a scenario.',
      'entities',
    );
  }

  /* ---------------------------------------------------------------- */
  /* Triggers                                                          */
  /* ---------------------------------------------------------------- */

  const checkValue = (value: MissionValue, path: string, label: string) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      add('error', 'value-invalid', `${label} must be a finite number.`, path);
    }
  };

  const checkCondition = (condition: MissionCondition, path: string) => {
    switch (condition.kind) {
      case 'elapsed':
        if (!Number.isFinite(condition.seconds) || condition.seconds < 0) {
          add('error', 'condition-elapsed-invalid', 'Elapsed condition needs a non-negative duration.', `${path}.seconds`);
        }
        break;
      case 'variable': {
        if (!variables.has(condition.variable)) {
          add(
            'error',
            'condition-variable-missing',
            `Condition refers to unknown variable "${condition.variable}".`,
            `${path}.variable`,
          );
        }
        const declared = doc.variables.find((variable) => variable.id === condition.variable);
        if (declared && !valueMatches(declared.type, condition.value)) {
          add(
            'error',
            'condition-value-type',
            `Condition compares ${declared.type} variable "${declared.id}" to ${JSON.stringify(condition.value)}.`,
            `${path}.value`,
          );
        }
        if (
          declared &&
          declared.type !== 'number' &&
          (condition.op === 'lt' || condition.op === 'lte' || condition.op === 'gt' || condition.op === 'gte')
        ) {
          add(
            'error',
            'condition-operator-type',
            `Condition orders ${declared.type} variable "${declared.id}" with "${condition.op}"; only numbers can be ordered.`,
            `${path}.op`,
          );
        }
        checkValue(condition.value, `${path}.value`, 'Condition value');
        break;
      }
      case 'objective':
        if (!objectives.has(condition.objective)) {
          add(
            'error',
            'condition-objective-missing',
            `Condition refers to unknown objective "${condition.objective}".`,
            `${path}.objective`,
          );
        }
        break;
      case 'entityAlive':
      case 'entityDead':
        checkEntityRef(condition.entity, `${path}.entity`, 'Condition');
        break;
      case 'regionOccupied':
        if (!regions.has(condition.region)) {
          add(
            'error',
            'condition-region-missing',
            `Condition refers to unknown region "${condition.region}".`,
            `${path}.region`,
          );
        }
        if (!Number.isInteger(condition.team) || condition.team < 0) {
          add('error', 'condition-team-invalid', 'Region condition needs a team id.', `${path}.team`);
        }
        if (!Number.isInteger(condition.atLeast) || condition.atLeast < 1) {
          add(
            'error',
            'condition-count-invalid',
            'Region condition needs at least one unit to count as occupied.',
            `${path}.atLeast`,
          );
        }
        break;
      default: {
        // A parsed condition is already a known member; this keeps a hand-built
        // document from silently carrying an unsupported kind.
        const kind = (condition as { kind?: unknown }).kind;
        add('error', 'condition-unknown', `Unsupported condition kind "${String(kind)}".`, path);
      }
    }
  };

  const checkAction = (action: MissionAction, path: string) => {
    switch (action.kind) {
      case 'setVariable': {
        const declared = doc.variables.find((variable) => variable.id === action.variable);
        if (!declared) {
          add(
            'error',
            'action-variable-missing',
            `Action writes unknown variable "${action.variable}".`,
            `${path}.variable`,
          );
        } else if (!valueMatches(declared.type, action.value)) {
          add(
            'error',
            'action-value-type',
            `Action writes ${JSON.stringify(action.value)} to ${declared.type} variable "${declared.id}".`,
            `${path}.value`,
          );
        }
        checkValue(action.value, `${path}.value`, 'Action value');
        break;
      }
      case 'setObjective':
        if (!objectives.has(action.objective)) {
          add(
            'error',
            'action-objective-missing',
            `Action changes unknown objective "${action.objective}".`,
            `${path}.objective`,
          );
        } else if (action.state === 'hidden') {
          // Hidden is an authored opening state, not a transition: no runtime
          // API can move an objective back to it, so authoring it is an error
          // rather than a silently ignored action.
          add(
            'error',
            'action-objective-hidden',
            `Action cannot return objective "${action.objective}" to hidden.`,
            `${path}.state`,
          );
        }
        break;
      case 'message':
        if (action.text.trim().length === 0) {
          add('error', 'action-message-empty', 'Message action has no text.', `${path}.text`);
        }
        break;
      case 'activateAiGroup':
        if (!aiGroups.has(action.group)) {
          add(
            'error',
            'action-group-missing',
            `Action activates unknown AI group "${action.group}".`,
            `${path}.group`,
          );
        }
        break;
      case 'spawnReinforcement':
        if (!reinforcements.has(action.reinforcement)) {
          add(
            'error',
            'action-reinforcement-missing',
            `Action requests unknown reinforcement "${action.reinforcement}".`,
            `${path}.reinforcement`,
          );
        }
        break;
      case 'startCinematic': {
        const sequence = doc.cinematics.find((entry) => entry.id === action.cinematic);
        if (!sequence) {
          add(
            'error',
            'action-cinematic-missing',
            `Action starts unknown cinematic "${action.cinematic}".`,
            `${path}.cinematic`,
          );
        } else if (sequence.kind !== 'inMission') {
          add(
            'error',
            'action-cinematic-context',
            `Trigger-started cinematic "${action.cinematic}" must use the in-mission context; it is ${sequence.kind}.`,
            `${path}.cinematic`,
          );
        }
        break;
      }
      case 'endMission':
        // The verdict is one of two literals, so there is nothing to check here.
        break;
      default: {
        const kind = (action as { kind?: unknown }).kind;
        add('error', 'action-unknown', `Unsupported action kind "${String(kind)}".`, path);
      }
    }
  };

  doc.triggers.forEach((trigger, i) => {
    if (trigger.priority !== undefined && !Number.isInteger(trigger.priority)) {
      add(
        'error',
        'trigger-priority-invalid',
        `Trigger "${trigger.id}" has a non-integer priority.`,
        `triggers[${i}].priority`,
      );
    }
    if (trigger.conditions.length === 0) {
      add(
        'warning',
        'trigger-immediate',
        `Trigger "${trigger.id}" has no conditions and would fire on the first tick.`,
        `triggers[${i}].conditions`,
      );
    }
    if (trigger.actions.length === 0) {
      add('warning', 'trigger-inert', `Trigger "${trigger.id}" has no actions.`, `triggers[${i}].actions`);
    }
    if (trigger.cooldownSeconds !== undefined && (!Number.isFinite(trigger.cooldownSeconds) || trigger.cooldownSeconds < 0)) {
      add(
        'error',
        'trigger-cooldown-invalid',
        `Trigger "${trigger.id}" has an invalid cooldown (${secondsLabel(trigger.cooldownSeconds)}).`,
        `triggers[${i}].cooldownSeconds`,
      );
    }
    if (trigger.once && trigger.cooldownSeconds !== undefined) {
      add(
        'warning',
        'trigger-cooldown-unused',
        `Trigger "${trigger.id}" is once-only, so its cooldown is never used.`,
        `triggers[${i}].cooldownSeconds`,
      );
    }
    if (trigger.delaySeconds !== undefined && (!Number.isFinite(trigger.delaySeconds) || trigger.delaySeconds < 0)) {
      add(
        'error',
        'trigger-delay-invalid',
        `Trigger "${trigger.id}" has an invalid delay (${secondsLabel(trigger.delaySeconds)}).`,
        `triggers[${i}].delaySeconds`,
      );
    }
    // A repeat with no conditions and no cooldown (or a zero cooldown) has
    // nothing to gate it and would fire on every tick. That is a design error
    // worth surfacing, not a runtime failure.
    if (
      !trigger.once &&
      (trigger.cooldownSeconds === 0 ||
        (trigger.conditions.length === 0 && trigger.cooldownSeconds === undefined))
    ) {
      add(
        'warning',
        'trigger-repeat-unthrottled',
        `Trigger "${trigger.id}" repeats without conditions or a cooldown and would fire every tick.`,
        `triggers[${i}]`,
      );
    }
    trigger.conditions.forEach((condition, c) =>
      checkCondition(condition, `triggers[${i}].conditions[${c}]`),
    );
    trigger.actions.forEach((action, a) => checkAction(action, `triggers[${i}].actions[${a}]`));
    // The schema has no trigger-to-trigger references, so a general dependency
    // cycle is unrepresentable. The one structural loop it can express is a
    // trigger whose condition requires the exact objective state its own action
    // sets; another source must satisfy it first.
    const selfGated = trigger.actions.some(
      (action) =>
        action.kind === 'setObjective' &&
        trigger.conditions.some(
          (condition) =>
            condition.kind === 'objective' &&
            condition.objective === action.objective &&
            condition.state === action.state,
        ),
    );
    if (selfGated) {
      add(
        'warning',
        'trigger-self-gated',
        `Trigger "${trigger.id}" only fires on an objective state it sets itself; another source must satisfy the condition first.`,
        `triggers[${i}]`,
      );
    }
  });

  /* ---------------------------------------------------------------- */
  /* Semantic authoring warnings                                       */
  /* ---------------------------------------------------------------- */

  // These describe the authored configuration, not the player's experience.
  // Nothing here claims to prove that a mission is winnable, balanced or fun:
  // those need simulation or a person playing it. Each finding is a statement
  // about what the document itself does and does not express.
  const usedRegions = new Set<string>();
  for (const trigger of doc.triggers) {
    for (const condition of trigger.conditions) {
      if (condition.kind === 'regionOccupied') usedRegions.add(condition.region);
    }
  }
  for (const group of doc.aiGroups) if (group.region) usedRegions.add(group.region);
  for (const wave of doc.reinforcements) usedRegions.add(wave.region);
  doc.regions.forEach((region, i) => {
    if (usedRegions.has(region.id)) return;
    add(
      'warning',
      'region-unused',
      `Region "${region.id}" is not used by any trigger condition, AI group or reinforcement, so nothing observes it.`,
      `regions[${i}]`,
    );
  });

  // Completing an objective is something only a trigger action can do: the
  // dependency graph gates activation, never completion. An objective no action
  // completes is therefore unreachable by construction, not merely hard.
  const completingActions = new Set<string>();
  const activatingActions = new Set<string>();
  for (const trigger of doc.triggers) {
    for (const action of trigger.actions) {
      if (action.kind !== 'setObjective') continue;
      if (action.state === 'complete') completingActions.add(action.objective);
      if (action.state === 'active') activatingActions.add(action.objective);
    }
  }
  doc.objectives.forEach((objective, i) => {
    if (completingActions.has(objective.id)) return;
    add(
      'warning',
      'objective-no-completion',
      `No trigger action sets objective "${objective.id}" to complete, so the authored configuration never completes it.`,
      `objectives[${i}]`,
    );
  });

  // An objective held back for a trigger starts hidden. Completing a hidden
  // objective is rejected by the runtime (`invalid-transition`), so an action
  // that jumps straight to complete needs something else to activate it first.
  doc.triggers.forEach((trigger, i) => {
    trigger.actions.forEach((action, a) => {
      if (action.kind !== 'setObjective' || action.state !== 'complete') return;
      const objective = doc.objectives.find((entry) => entry.id === action.objective);
      if (!objective) return;
      const heldBack =
        objective.initialState === 'hidden' || objective.dependsOn.length > 0;
      if (!heldBack || activatingActions.has(objective.id)) return;
      add(
        'warning',
        'action-objective-never-active',
        `Trigger "${trigger.id}" completes "${objective.id}", which opens inactive, and no action activates it first; that transition is rejected at runtime.`,
        `triggers[${i}].actions[${a}]`,
      );
    });
  });

  // A declared entity that nothing references is either leftover authoring or a
  // missing reference, and both are worth seeing before the mission ships.
  const referencedEntities = new Set<string>();
  for (const objective of doc.objectives) {
    for (const key of objective.protectedEntities ?? []) referencedEntities.add(key);
  }
  for (const trigger of doc.triggers) {
    for (const condition of trigger.conditions) {
      if (condition.kind === 'entityAlive' || condition.kind === 'entityDead') {
        referencedEntities.add(condition.entity);
      }
    }
  }
  for (const cinematic of doc.cinematics) {
    for (const step of cinematic.steps) {
      if ((step.kind === 'camera' || step.kind === 'effect') && step.target.kind === 'entity') {
        referencedEntities.add(step.target.entity);
      }
      if (step.kind === 'actor') {
        referencedEntities.add(step.entity);
        if ((step.action === 'enter' || step.action === 'leave') && step.structure) {
          referencedEntities.add(step.structure);
        }
        if (step.action === 'fire' && step.target.kind === 'entity') {
          referencedEntities.add(step.target.entity);
        }
      }
    }
  }
  for (const group of doc.aiGroups) for (const key of group.units) referencedEntities.add(key);
  for (const key of doc.carryover.assets) referencedEntities.add(key);
  doc.entities.forEach((entity, i) => {
    if (referencedEntities.has(entity.key)) return;
    add(
      'info',
      'entity-unreferenced',
      `Authored entity "${entity.key}" is declared but no objective, condition, camera, actor or carryover refers to it.`,
      `entities[${i}]`,
    );
  });

  /* ---------------------------------------------------------------- */
  /* AI groups and reinforcements                                      */
  /* ---------------------------------------------------------------- */

  // Which groups and waves a trigger actually requests. A dormant group with no
  // activation trigger, and a wave with no request and no arrival time, would
  // simply never appear, so both are reported here rather than discovered in
  // play.
  const releasedGroups = new Set<string>();
  const requestedWaves = new Set<string>();
  for (const trigger of doc.triggers) {
    for (const action of trigger.actions) {
      if (action.kind === 'activateAiGroup') releasedGroups.add(action.group);
      if (action.kind === 'spawnReinforcement') requestedWaves.add(action.reinforcement);
    }
  }

  doc.aiGroups.forEach((group, i) => {
    if (!Number.isInteger(group.owner) || group.owner < 0) {
      add('error', 'ai-owner-invalid', `AI group "${group.id}" needs a player id.`, `aiGroups[${i}].owner`);
    }
    if (group.initial === 'dormant' && !releasedGroups.has(group.id)) {
      add(
        'warning',
        'ai-group-dormant-unreleased',
        `AI group "${group.id}" is dormant but no trigger activates it; it will hold its positions for the whole mission.`,
        `aiGroups[${i}].initial`,
      );
    }
    if (group.units.length === 0) {
      add('warning', 'ai-group-empty', `AI group "${group.id}" commands no units.`, `aiGroups[${i}].units`);
    }
    group.units.forEach((key, u) =>
      checkEntityRef(key, `aiGroups[${i}].units[${u}]`, 'AI group'),
    );
    if (group.region !== undefined && !regions.has(group.region)) {
      add(
        'error',
        'ai-region-missing',
        `AI group "${group.id}" refers to unknown region "${group.region}".`,
        `aiGroups[${i}].region`,
      );
    }
  });

  doc.reinforcements.forEach((wave, i) => {
    if (!Number.isInteger(wave.owner) || wave.owner < 0) {
      add(
        'error',
        'reinforcement-owner-invalid',
        `Reinforcement "${wave.id}" needs a player id.`,
        `reinforcements[${i}].owner`,
      );
    }
    if (!regions.has(wave.region)) {
      add(
        'error',
        'reinforcement-region-missing',
        `Reinforcement "${wave.id}" arrives in unknown region "${wave.region}".`,
        `reinforcements[${i}].region`,
      );
    }
    if (wave.triggerId !== undefined && !triggers.has(wave.triggerId)) {
      add(
        'error',
        'reinforcement-trigger-missing',
        `Reinforcement "${wave.id}" is gated by unknown trigger "${wave.triggerId}".`,
        `reinforcements[${i}].triggerId`,
      );
    }
    if (wave.afterSeconds !== undefined && (!Number.isFinite(wave.afterSeconds) || wave.afterSeconds < 0)) {
      add(
        'error',
        'reinforcement-time-invalid',
        `Reinforcement "${wave.id}" has an invalid arrival time (${secondsLabel(wave.afterSeconds)}).`,
        `reinforcements[${i}].afterSeconds`,
      );
    }
    if (wave.units.length === 0) {
      add('warning', 'reinforcement-empty', `Reinforcement "${wave.id}" brings no units.`, `reinforcements[${i}].units`);
    }
    if (!requestedWaves.has(wave.id) && wave.afterSeconds === undefined) {
      add(
        'warning',
        'reinforcement-unscheduled',
        `Reinforcement "${wave.id}" has no spawn action and no arrival time, so it never arrives.`,
        `reinforcements[${i}]`,
      );
    }
    if (wave.triggerId !== undefined && !requestedWaves.has(wave.id)) {
      add(
        'warning',
        'reinforcement-trigger-not-requesting',
        `Reinforcement "${wave.id}" names trigger "${wave.triggerId}", but that trigger has no spawnReinforcement action; the wave will only arrive on its timer.`,
        `reinforcements[${i}].triggerId`,
      );
    }
    wave.units.forEach((unit, u) => {
      if (!UNITS[unit.defId]) {
        add(
          'error',
          'reinforcement-unit-unknown',
          `Reinforcement "${wave.id}" names unknown unit "${unit.defId}".`,
          `reinforcements[${i}].units[${u}].defId`,
        );
      }
      if (!Number.isInteger(unit.count) || unit.count < 1) {
        add(
          'error',
          'reinforcement-count-invalid',
          `Reinforcement "${wave.id}" must bring at least one of "${unit.defId}".`,
          `reinforcements[${i}].units[${u}].count`,
        );
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* Cinematics, consequences, carryover                               */
  /* ---------------------------------------------------------------- */

  const checkCinematicAsset = (value: string, path: string) => {
    if (!safeCinematicAsset(value)) {
      add(
        'error',
        'cinematic-asset-path',
        `Media reference "${value}" must be a project-relative path without a scheme or "..".`,
        path,
      );
    }
  };
  const cinematicContexts = new Map<string, number>();
  doc.cinematics.forEach((cinematic, i) => {
    const base = `cinematics[${i}]`;
    cinematicContexts.set(cinematic.kind, (cinematicContexts.get(cinematic.kind) ?? 0) + 1);
    if (cinematic.kind === 'campaignIntro' || cinematic.kind === 'campaignFinale') {
      add(
        'error',
        'cinematic-context-misplaced',
        `Cinematic "${cinematic.id}" uses the campaign context "${cinematic.kind}". Author it on the campaign definition, not in a mission document.`,
        `${base}.kind`,
      );
    }
    if (cinematic.steps.length === 0) {
      add(
        'error',
        'cinematic-empty',
        `Cinematic "${cinematic.id}" has no timeline steps.`,
        `${base}.steps`,
      );
    }
    if (cinematic.kind === 'inMission') {
      if (cinematic.atSeconds === undefined || !Number.isFinite(cinematic.atSeconds) || cinematic.atSeconds < 0) {
        add(
          'error',
          'cinematic-time-missing',
          `In-mission cinematic "${cinematic.id}" needs a non-negative atSeconds.`,
          `${base}.atSeconds`,
        );
      }
    } else if (cinematic.atSeconds !== undefined) {
      add(
        'warning',
        'cinematic-time-ignored',
        `atSeconds on "${cinematic.id}" is ignored: only in-mission sequences are time-gated.`,
        `${base}.atSeconds`,
      );
    }
    // An edge transition is presentation only, but a fade authored with no
    // duration is a silent cut the author did not ask for.
    (['in', 'out'] as const).forEach((edge) => {
      const transition = cinematic.transition?.[edge];
      if (!transition) return;
      const edgePath = `${base}.transition.${edge}`;
      if (transition.kind !== 'cut' && transition.kind !== 'fade') {
        add(
          'error',
          'cinematic-transition-invalid',
          'Transition kind must be cut or fade.',
          `${edgePath}.kind`,
        );
      }
      if (!Number.isFinite(transition.durationSeconds) || transition.durationSeconds < 0) {
        add(
          'error',
          'cinematic-transition-invalid',
          'Transition duration must be zero or more.',
          `${edgePath}.durationSeconds`,
        );
      } else if (transition.kind === 'fade' && transition.durationSeconds === 0) {
        add(
          'warning',
          'cinematic-transition-zero',
          'A zero-second fade is a cut; this transition has no effect.',
          `${edgePath}.durationSeconds`,
        );
      }
    });
    cinematic.dialogue.forEach((entry, d) => {
      if (entry.line.trim().length === 0) {
        add(
          'warning',
          'dialogue-empty',
          `Cinematic "${cinematic.id}" has an empty line for ${entry.speaker || 'an unnamed speaker'}.`,
          `${base}.dialogue[${d}].line`,
        );
      }
    });

    let hasLine = false;
    cinematic.steps.forEach((step, s) => {
      const path = `${base}.steps[${s}]`;
      if (step.kind === 'camera') {
        if (!Number.isFinite(step.durationSeconds) || step.durationSeconds < 0) {
          add('error', 'cinematic-duration-invalid', 'Camera move duration must be zero or more.', `${path}.durationSeconds`);
        }
        if (step.holdSeconds !== undefined && (!Number.isFinite(step.holdSeconds) || step.holdSeconds < 0)) {
          add('error', 'cinematic-hold-invalid', 'Camera hold must be zero or more.', `${path}.holdSeconds`);
        }
        if (step.zoom !== undefined && (!Number.isFinite(step.zoom) || step.zoom <= 0 || step.zoom > 110)) {
          add('error', 'cinematic-zoom-invalid', 'Camera zoom must be above 0 and at most 110.', `${path}.zoom`);
        }
        if (
          step.rotationDegrees !== undefined &&
          (!Number.isFinite(step.rotationDegrees) ||
            step.rotationDegrees < -360 ||
            step.rotationDegrees > 360)
        ) {
          add(
            'error',
            'cinematic-rotation-invalid',
            'Camera rotation must be between -360 and 360 degrees.',
            `${path}.rotationDegrees`,
          );
        }
        if (step.shake !== undefined && (!Number.isFinite(step.shake) || step.shake < 0 || step.shake > 1)) {
          add('error', 'cinematic-shake-invalid', 'Camera shake must be between 0 and 1.', `${path}.shake`);
        }
        if (step.track && step.target.kind !== 'entity') {
          add(
            'warning',
            'cinematic-track-no-entity',
            'Camera tracking needs an entity target; this beat holds a fixed framing.',
            `${path}.track`,
          );
        }
        if (step.ease !== undefined && !['smooth', 'linear', 'cut'].includes(step.ease)) {
          add('error', 'cinematic-ease-invalid', 'Camera ease must be smooth, linear or cut.', `${path}.ease`);
        }
        const target = step.target;
        if (target.kind === 'position') {
          if (!Number.isFinite(target.x) || !Number.isFinite(target.z)) {
            add('error', 'cinematic-target-invalid', 'Camera position must be finite.', `${path}.target`);
          } else {
            if (context.width !== undefined && (target.x < 0 || target.x > context.width)) {
              add('error', 'cinematic-target-outside', 'Camera position is outside the map width.', `${path}.target.x`);
            }
            if (context.height !== undefined && (target.z < 0 || target.z > context.height)) {
              add('error', 'cinematic-target-outside', 'Camera position is outside the map height.', `${path}.target.z`);
            }
          }
        } else if (target.kind === 'entity') {
          checkEntityRef(target.entity, `${path}.target.entity`, 'Cinematic camera');
        }
      } else if (step.kind === 'line') {
        hasLine = true;
        if (step.text.trim().length === 0) {
          add('error', 'cinematic-line-empty', 'Dialogue beat has no text.', `${path}.text`);
        }
        if (step.speaker.trim().length === 0) {
          add('warning', 'cinematic-speaker-empty', 'Dialogue beat has no speaker.', `${path}.speaker`);
        }
        if (!Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0) {
          add('error', 'cinematic-duration-invalid', 'Dialogue beat needs a positive duration.', `${path}.durationSeconds`);
        }
        if (step.pauseSeconds !== undefined && (!Number.isFinite(step.pauseSeconds) || step.pauseSeconds < 0)) {
          add('error', 'cinematic-pause-invalid', 'Dialogue pause must be zero or more.', `${path}.pauseSeconds`);
        }
        if (step.portrait !== undefined) checkCinematicAsset(step.portrait, `${path}.portrait`);
        if (step.voice !== undefined) checkCinematicAsset(step.voice, `${path}.voice`);
      } else if (step.kind === 'notify') {
        if (step.text.trim().length === 0) {
          add('error', 'cinematic-notice-empty', 'Notice beat has no text.', `${path}.text`);
        }
        if (step.durationSeconds !== undefined && (!Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0)) {
          add('error', 'cinematic-duration-invalid', 'Notice beat needs a positive duration.', `${path}.durationSeconds`);
        }
        if (step.heading !== undefined && step.heading.trim().length === 0) {
          add('error', 'cinematic-notice-heading-empty', 'Notice heading has no text.', `${path}.heading`);
        }
      } else if (step.kind === 'actor') {
        checkEntityRef(step.entity, `${path}.entity`, 'Cinematic actor');
        if (!Number.isFinite(step.durationSeconds) || step.durationSeconds < 0) {
          add(
            'error',
            'cinematic-duration-invalid',
            'Actor beat timing must be zero or more.',
            `${path}.durationSeconds`,
          );
        }
        if (step.action === 'move') {
          if (!Number.isFinite(step.x) || !Number.isFinite(step.z)) {
            add('error', 'cinematic-target-invalid', 'Actor destination must be finite.', `${path}`);
          } else {
            if (context.width !== undefined && (step.x < 0 || step.x > context.width)) {
              add('error', 'cinematic-target-outside', 'Actor destination is outside the map width.', `${path}.x`);
            }
            if (context.height !== undefined && (step.z < 0 || step.z > context.height)) {
              add('error', 'cinematic-target-outside', 'Actor destination is outside the map height.', `${path}.z`);
            }
          }
          if (step.ease !== undefined && !['smooth', 'linear', 'cut'].includes(step.ease)) {
            add('error', 'cinematic-ease-invalid', 'Actor ease must be smooth, linear or cut.', `${path}.ease`);
          }
        } else if (step.action === 'turn') {
          if (!Number.isFinite(step.facingDegrees)) {
            add('error', 'cinematic-turn-invalid', 'Actor facing must be a finite number of degrees.', `${path}.facingDegrees`);
          }
          if (step.ease !== undefined && !['smooth', 'linear', 'cut'].includes(step.ease)) {
            add('error', 'cinematic-ease-invalid', 'Actor ease must be smooth, linear or cut.', `${path}.ease`);
          }
        } else if (step.action === 'animate') {
          if (step.pose !== 'idle' && step.pose !== 'walk') {
            add(
              'error',
              'cinematic-pose-unsupported',
              `Unsupported actor pose "${String(step.pose)}"; the renderer has idle and walk only.`,
              `${path}.pose`,
            );
          }
          if (!(step.durationSeconds > 0)) {
            add('error', 'cinematic-duration-invalid', 'Animation beat needs a positive duration.', `${path}.durationSeconds`);
          }
        } else if (step.action === 'fire') {
          if (step.scale !== undefined && (!Number.isFinite(step.scale) || step.scale <= 0)) {
            add('error', 'cinematic-effect-scale', 'Fire beat scale must be above zero.', `${path}.scale`);
          }
          if (step.target.kind === 'restore') {
            add('error', 'cinematic-target-invalid', 'Fire needs a world position or entity target.', `${path}.target`);
          } else if (step.target.kind === 'position') {
            if (!Number.isFinite(step.target.x) || !Number.isFinite(step.target.z)) {
              add('error', 'cinematic-target-invalid', 'Fire target must be finite.', `${path}.target`);
            } else {
              if (context.width !== undefined && (step.target.x < 0 || step.target.x > context.width)) {
                add('error', 'cinematic-target-outside', 'Fire target is outside the map width.', `${path}.target.x`);
              }
              if (context.height !== undefined && (step.target.z < 0 || step.target.z > context.height)) {
                add('error', 'cinematic-target-outside', 'Fire target is outside the map height.', `${path}.target.z`);
              }
            }
          } else {
            checkEntityRef(step.target.entity, `${path}.target.entity`, 'Cinematic fire target');
          }
        } else if (step.action === 'enter' || step.action === 'leave') {
          checkEntityRef(step.structure, `${path}.structure`, 'Cinematic structure');
          if (step.structure === step.entity) {
            add('error', 'cinematic-structure-self', 'An actor cannot enter or leave itself.', `${path}.structure`);
          }
          if (step.action === 'leave') {
            if (!Number.isFinite(step.x) || !Number.isFinite(step.z)) {
              add('error', 'cinematic-target-invalid', 'Actor exit destination must be finite.', `${path}`);
            } else {
              if (context.width !== undefined && (step.x < 0 || step.x > context.width)) {
                add('error', 'cinematic-target-outside', 'Actor exit is outside the map width.', `${path}.x`);
              }
              if (context.height !== undefined && (step.z < 0 || step.z > context.height)) {
                add('error', 'cinematic-target-outside', 'Actor exit is outside the map height.', `${path}.z`);
              }
            }
          }
        }
      } else if (step.kind === 'card') {
        if (step.heading.trim().length === 0) {
          add('error', 'cinematic-card-heading', 'Chapter card has no heading.', `${path}.heading`);
        }
        if (!Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0) {
          add('error', 'cinematic-duration-invalid', 'Chapter card needs a positive duration.', `${path}.durationSeconds`);
        }
        if (step.body !== undefined && step.body.trim().length === 0 && step.subheading === undefined) {
          add('warning', 'cinematic-card-body-empty', 'Chapter card authors an empty body.', `${path}.body`);
        }
      } else if (step.kind === 'music') {
        if (!MUSIC_TRACKS_BY_ID.has(step.track)) {
          add(
            'error',
            'cinematic-music-track',
            `Music beat names "${step.track}", which is not an authored soundtrack track.`,
            `${path}.track`,
          );
        }
        if (
          step.durationSeconds !== undefined &&
          (!Number.isFinite(step.durationSeconds) || step.durationSeconds < 0)
        ) {
          add('error', 'cinematic-duration-invalid', 'Music beat timing must be zero or more.', `${path}.durationSeconds`);
        }
      } else if (step.kind === 'sound') {
        if (step.cue.trim().length === 0) {
          add('error', 'cinematic-sound-cue', 'Sound beat has no cue name.', `${path}.cue`);
        }
        if (step.gain !== undefined && (!Number.isFinite(step.gain) || step.gain < 0 || step.gain > 1)) {
          add('error', 'cinematic-sound-gain', 'Sound gain must be between 0 and 1.', `${path}.gain`);
        }
        if (
          step.durationSeconds !== undefined &&
          (!Number.isFinite(step.durationSeconds) || step.durationSeconds < 0)
        ) {
          add('error', 'cinematic-duration-invalid', 'Sound beat timing must be zero or more.', `${path}.durationSeconds`);
        }
      } else {
        if (!['explosion', 'smoke', 'dust', 'muzzle'].includes(step.effect)) {
          add('error', 'cinematic-effect-unknown', `Unsupported effect "${String(step.effect)}".`, `${path}.effect`);
        }
        if (step.scale !== undefined && (!Number.isFinite(step.scale) || step.scale <= 0)) {
          add('error', 'cinematic-effect-scale', 'Effect scale must be above zero.', `${path}.scale`);
        }
        if (
          step.durationSeconds !== undefined &&
          (!Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0)
        ) {
          add('error', 'cinematic-duration-invalid', 'Effect beat needs a positive duration.', `${path}.durationSeconds`);
        }
        const target = step.target;
        if (target.kind === 'position') {
          if (!Number.isFinite(target.x) || !Number.isFinite(target.z)) {
            add('error', 'cinematic-target-invalid', 'Effect position must be finite.', `${path}.target`);
          } else {
            if (context.width !== undefined && (target.x < 0 || target.x > context.width)) {
              add('error', 'cinematic-target-outside', 'Effect position is outside the map width.', `${path}.target.x`);
            }
            if (context.height !== undefined && (target.z < 0 || target.z > context.height)) {
              add('error', 'cinematic-target-outside', 'Effect position is outside the map height.', `${path}.target.z`);
            }
          }
        } else if (target.kind === 'entity') {
          checkEntityRef(target.entity, `${path}.target.entity`, 'Cinematic effect');
        }
      }
    });
    if (!hasLine && cinematic.kind !== 'inMission') {
      add(
        'warning',
        'cinematic-no-dialogue',
        `Cinematic "${cinematic.id}" has no dialogue beat.`,
        `${base}.steps`,
      );
    }
    const total = cinematic.steps.reduce(
      (seconds, step) => seconds + cinematicStepDuration(step),
      0,
    );
    if (!(total > 0)) {
      add(
        'warning',
        'cinematic-zero-duration',
        `Cinematic "${cinematic.id}" has no elapsed time; it would finish on its first frame.`,
        `${base}.steps`,
      );
    }
  });
  for (const [kind, count] of cinematicContexts) {
    if (count > 1) {
      add(
        'info',
        'cinematic-context-multiple',
        `${count} ${kind} sequences are authored; they play in document order.`,
        'cinematics',
      );
    }
  }

  doc.consequences.forEach((consequence, i) => {
    if (!isMissionId(consequence.key)) {
      add(
        'error',
        'consequence-key-invalid',
        `Consequence "${consequence.id}" writes an invalid campaign key "${consequence.key}".`,
        `consequences[${i}].key`,
      );
    }
    checkValue(consequence.value, `consequences[${i}].value`, 'Consequence value');
  });

  doc.carryover.assets.forEach((key, a) =>
    checkEntityRef(key, `carryover.assets[${a}]`, 'Carryover'),
  );

  return issues;
}
