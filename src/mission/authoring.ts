/**
 * Mission authoring helpers.
 *
 * The editor already owns one canonical `Scenario`; a mission is never a second
 * working copy. These helpers create and reason about the embedded document so
 * the workbench can stay a thin view over it.
 *
 * Everything here is pure except `ensureCommandPostKeys` and
 * `ensureMissionForScenario`, which are explicit about changing the authored
 * scenario they are handed.
 */
import type { Scenario, ScenarioStructure, ScenarioUnit } from '../sim/scenario';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { tryIdentityDef } from '../data/factions';
import {
  MISSION_FORMAT,
  MISSION_FORMAT_VERSION,
  type MissionAction,
  type MissionCondition,
  type MissionDoc,
  type MissionIssue,
  type MissionObjectiveDoc,
  type MissionTriggerDoc,
  type MissionValue,
  type MissionVariableType,
} from './types';
import { isMissionId, validateMission } from './validate';

/** Actions the schema carries but the runtime does not execute.
 *
 * Empty since the campaign runtime completion: every action the schema declares
 * is now executed. Kept as an export so the workbench, the authoring tools and
 * their tests keep one place to ask the question.
 */
export const DEFERRED_ACTIONS = [] as const;

export type DeferredActionKind = (typeof DEFERRED_ACTIONS)[number];

/** Workbench sections, also used to route validation issues. */
export type MissionSection =
  | 'overview'
  | 'briefing'
  | 'objectives'
  | 'variables'
  | 'regions'
  | 'triggers'
  | 'aiGroups'
  | 'reinforcements'
  | 'cinematics'
  | 'validation'
  /** Draft, saved copy, last-valid snapshot and storage state. */
  | 'recovery';

const KIND_LABEL: Record<MissionObjectiveDoc['kind'], string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  bonus: 'Bonus',
};

const STATE_LABEL: Record<string, string> = {
  hidden: 'hidden',
  active: 'active',
  complete: 'complete',
  failed: 'failed',
};

const CONDITION_LABEL: Record<MissionCondition['kind'], string> = {
  elapsed: 'Mission time',
  variable: 'Variable',
  objective: 'Objective',
  entityAlive: 'Entity alive',
  entityDead: 'Entity destroyed',
  regionOccupied: 'Region occupied',
};

const ACTION_LABEL: Record<MissionAction['kind'], string> = {
  setVariable: 'Set variable',
  setObjective: 'Set objective',
  message: 'Message',
  activateAiGroup: 'Activate AI group',
  spawnReinforcement: 'Spawn reinforcement',
  startCinematic: 'Start cinematic',
  endMission: 'End mission',
};

export function missionSlug(value: string, fallback = 'mission'): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return isMissionId(slug) ? slug : fallback;
}

/** A stable id that does not collide with the supplied set. */
export function uniqueMissionId(base: string, taken: ReadonlySet<string>): string {
  const root = missionSlug(base);
  if (!taken.has(root)) return root;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${root}-${i}`.slice(0, 64);
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`.slice(0, 64);
}

function identityName(factionId: string | undefined, fallback: string): string {
  return (factionId ? tryIdentityDef(factionId)?.name : undefined) ?? fallback;
}

/**
 * Give each command post a stable authored key.
 *
 * Without a key a mission cannot observe the thing almost every opening
 * operation is about. Existing keys are never rewritten; a post whose obvious
 * key is taken gets an owner-qualified one.
 */
export function ensureCommandPostKeys(scenario: Scenario): {
  ownKey: string | null;
  enemyKey: string | null;
  added: string[];
} {
  const used = new Set<string>();
  for (const structure of scenario.structures) if (structure.key) used.add(structure.key);
  for (const unit of scenario.units) if (unit.key) used.add(unit.key);
  const local = scenario.players[0]?.id ?? 0;
  const added: string[] = [];
  let ownKey: string | null = null;
  let enemyKey: string | null = null;
  const assign = (structure: ScenarioStructure, wanted: string): string => {
    if (structure.key) return structure.key;
    let key = wanted;
    if (used.has(key)) {
      key = `${wanted}-${structure.owner}`;
      let suffix = 2;
      while (used.has(key)) key = `${wanted}-${structure.owner}-${suffix++}`;
    }
    structure.key = key;
    used.add(key);
    added.push(key);
    return key;
  };
  for (const structure of scenario.structures) {
    if (!BUILDINGS[structure.defId]?.commandPost) continue;
    if (structure.owner === local) {
      const key = assign(structure, 'own-hq');
      ownKey ??= key;
    } else {
      const key = assign(structure, 'enemy-hq');
      enemyKey ??= key;
    }
  }
  return { ownKey, enemyKey, added };
}

/** Conventional opening document for a scenario that has no mission yet. */
export function createMissionDoc(
  scenario: Scenario,
  options: { id?: string; title?: string; campaignId?: string } = {},
): MissionDoc {
  const { ownKey, enemyKey } = ensureCommandPostKeys(scenario);
  const local = scenario.players[0];
  const enemy = scenario.players.find((entry) => entry.id !== (local?.id ?? 0));
  const title = options.title?.trim() || scenario.meta.name || 'Untitled operation';
  const friendly = identityName(local?.factionId, local?.name ?? 'Your force');
  const opposing = identityName(enemy?.factionId, enemy?.name ?? 'The enemy');
  const description =
    scenario.meta.description.trim() ||
    `${friendly} task force deploys on ${scenario.meta.name} against ${opposing}.`;
  const objectives: MissionObjectiveDoc[] = [
    {
      id: enemyKey ? 'break-hq' : 'secure-ground',
      title: enemyKey
        ? 'Destroy the opposing command post.'
        : 'Secure the operation area.',
      description: enemyKey
        ? 'Break the enemy command post while keeping your own operational.'
        : 'Add objectives in the workbench; this draft has no authored completion condition yet.',
      kind: 'primary',
      dependsOn: [],
    },
  ];
  if (ownKey) {
    objectives.push({
      id: 'clean-sweep',
      title: 'Break their command post with your own intact.',
      description: 'A bonus for a clean operation.',
      kind: 'bonus',
      dependsOn: [],
      protectedEntities: [ownKey],
    });
  }
  const triggers: MissionTriggerDoc[] = [];
  if (enemyKey) {
    triggers.push({
      id: 'enemy-hq-lost',
      priority: 10,
      once: true,
      conditions: [{ kind: 'entityDead', entity: enemyKey }],
      actions: [
        { kind: 'setObjective', objective: objectives[0].id, state: 'complete' },
        { kind: 'message', text: 'Enemy command post destroyed — objective complete.' },
      ],
    });
    if (ownKey) {
      triggers.push({
        id: 'clean-sweep',
        priority: 20,
        once: true,
        conditions: [
          { kind: 'entityDead', entity: enemyKey },
          { kind: 'entityAlive', entity: ownKey },
        ],
        actions: [
          { kind: 'setObjective', objective: 'clean-sweep', state: 'complete' },
          { kind: 'message', text: 'Command post broken with the task force intact.' },
        ],
      });
    }
  }
  const entities: MissionDoc['entities'] = [];
  if (ownKey) entities.push({ key: ownKey, name: `${friendly} Command Post`, role: 'protected' });
  if (enemyKey) entities.push({ key: enemyKey, name: `${opposing} Command Post`, role: 'objective' });
  return {
    format: MISSION_FORMAT,
    version: MISSION_FORMAT_VERSION,
    id: options.id ?? uniqueMissionId(scenario.meta.id || title, new Set()),
    title,
    description,
    author: scenario.meta.author || 'Mission author',
    ...(options.campaignId ? { campaign: { campaignId: options.campaignId, order: 1 } } : {}),
    briefing: {
      summary: description,
      subtitle: 'Field operation',
      friendly: `${friendly} task force holds the western approach.`,
      enemy: `${opposing} battlegroup holds the objective.`,
      enemyIntent: 'Contest the approach and keep the command post operational.',
      personnel: [],
      instructions: [
        'Establish production before pushing beyond the beachhead.',
        'Keep your command post operational; losing it ends the operation.',
      ],
      commanderNote: '{{callsign}}, this one is yours.',
    },
    debrief: {
      victory: 'The objective is secured and the task force holds the ground.',
      defeat: 'The operation has failed. The task force will refit and return.',
    },
    objectives,
    variables: [],
    regions: [],
    triggers,
    aiGroups: [],
    reinforcements: [],
    entities,
    cinematics: [],
    consequences: [],
    carryover: { enabled: false, assets: [] },
  };
}

/**
 * Ensure the scenario carries a mission, creating an opening draft only when
 * the author explicitly asks for one. Returns whether anything was created.
 */
export function ensureMissionForScenario(
  scenario: Scenario,
  options: { id?: string; title?: string } = {},
): { doc: MissionDoc; created: boolean; keysAdded: string[] } {
  const before = new Set(
    [...scenario.structures, ...scenario.units]
      .map((entry) => entry.key)
      .filter((key): key is string => Boolean(key)),
  );
  if (scenario.mission) return { doc: scenario.mission, created: false, keysAdded: [] };
  const doc = createMissionDoc(scenario, options);
  scenario.mission = doc;
  const keysAdded = [...scenario.structures, ...scenario.units]
    .map((entry) => entry.key)
    .filter((key): key is string => Boolean(key) && !before.has(key!));
  return { doc, created: true, keysAdded };
}

/** Duplicate a document with a fresh id and no campaign association. */
export function duplicateMissionDoc(
  doc: MissionDoc,
  taken: ReadonlySet<string>,
  suffix = 'copy',
): MissionDoc {
  const copy = structuredClone(doc);
  copy.id = uniqueMissionId(`${doc.id}-${suffix}`, taken);
  copy.title = `${doc.title} (Copy)`;
  delete copy.campaign;
  return copy;
}

/** How an objective is visible when the mission starts, before dependencies settle. */
export function openingVisibility(objective: MissionObjectiveDoc): 'active' | 'hidden' {
  if (objective.dependsOn.length > 0) return 'hidden';
  return objective.initialState === 'hidden' ? 'hidden' : 'active';
}

export function objectiveKindLabel(kind: MissionObjectiveDoc['kind']): string {
  return KIND_LABEL[kind];
}

export function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

/** Objective ids referenced by a trigger action or another objective's dependency. */
export function objectiveReferences(doc: MissionDoc, objectiveId: string): string[] {
  const refs: string[] = [];
  doc.objectives.forEach((objective, oi) => {
    if (objective.id === objectiveId) return;
    objective.dependsOn.forEach((id, di) => {
      if (id === objectiveId) refs.push(`objectives[${oi}].dependsOn[${di}]`);
    });
  });
  doc.triggers.forEach((trigger, ti) => {
    trigger.conditions.forEach((condition, ci) => {
      if (condition.kind === 'objective' && condition.objective === objectiveId) {
        refs.push(`triggers[${ti}].conditions[${ci}]`);
      }
    });
    trigger.actions.forEach((action, ai) => {
      if (action.kind === 'setObjective' && action.objective === objectiveId) {
        refs.push(`triggers[${ti}].actions[${ai}]`);
      }
    });
  });
  return refs;
}

export function variableReferences(doc: MissionDoc, variableId: string): string[] {
  const refs: string[] = [];
  doc.triggers.forEach((trigger, ti) => {
    trigger.conditions.forEach((condition, ci) => {
      if (condition.kind === 'variable' && condition.variable === variableId) {
        refs.push(`triggers[${ti}].conditions[${ci}]`);
      }
    });
    trigger.actions.forEach((action, ai) => {
      if (action.kind === 'setVariable' && action.variable === variableId) {
        refs.push(`triggers[${ti}].actions[${ai}]`);
      }
    });
  });
  return refs;
}

export function regionReferences(doc: MissionDoc, regionId: string): string[] {
  const refs: string[] = [];
  doc.triggers.forEach((trigger, ti) => {
    trigger.conditions.forEach((condition, ci) => {
      if (condition.kind === 'regionOccupied' && condition.region === regionId) {
        refs.push(`triggers[${ti}].conditions[${ci}]`);
      }
    });
  });
  doc.aiGroups.forEach((group, gi) => {
    if (group.region === regionId) refs.push(`aiGroups[${gi}].region`);
  });
  doc.reinforcements.forEach((wave, wi) => {
    if (wave.region === regionId) refs.push(`reinforcements[${wi}].region`);
  });
  return refs;
}

export function entityReferences(doc: MissionDoc, key: string): string[] {
  const refs: string[] = [];
  doc.entities.forEach((entity, ei) => {
    if (entity.key === key) refs.push(`entities[${ei}]`);
  });
  doc.objectives.forEach((objective, oi) => {
    objective.protectedEntities?.forEach((entry, pi) => {
      if (entry === key) refs.push(`objectives[${oi}].protectedEntities[${pi}]`);
    });
  });
  doc.triggers.forEach((trigger, ti) => {
    trigger.conditions.forEach((condition, ci) => {
      if (
        (condition.kind === 'entityAlive' || condition.kind === 'entityDead') &&
        condition.entity === key
      ) {
        refs.push(`triggers[${ti}].conditions[${ci}]`);
      }
    });
  });
  doc.cinematics.forEach((cinematic, ci) => {
    cinematic.steps.forEach((step, si) => {
      if (
        (step.kind === 'camera' || step.kind === 'effect') &&
        step.target.kind === 'entity' &&
        step.target.entity === key
      ) {
        refs.push(`cinematics[${ci}].steps[${si}].target`);
      }
      if (step.kind === 'actor') {
        if (step.entity === key) refs.push(`cinematics[${ci}].steps[${si}].entity`);
        if ((step.action === 'enter' || step.action === 'leave') && step.structure === key) {
          refs.push(`cinematics[${ci}].steps[${si}].structure`);
        }
        if (step.action === 'fire' && step.target.kind === 'entity' && step.target.entity === key) {
          refs.push(`cinematics[${ci}].steps[${si}].target`);
        }
      }
    });
  });
  return refs;
}

/** All authored entity keys a mission may reference. */
export function authoredEntityKeys(scenario: Scenario): string[] {
  return [...scenario.structures, ...scenario.units]
    .map((entry) => entry.key)
    .filter((key): key is string => Boolean(key))
    .sort();
}

export function triggerPolicyLabel(trigger: MissionTriggerDoc): string {
  const parts: string[] = [trigger.once ? 'Once' : 'Repeat'];
  if (!trigger.once && trigger.cooldownSeconds !== undefined) {
    parts.push(`cooldown ${trigger.cooldownSeconds}s`);
  }
  if (trigger.delaySeconds !== undefined) parts.push(`delay ${trigger.delaySeconds}s`);
  return parts.join(' · ');
}

export function conditionLabel(kind: MissionCondition['kind']): string {
  return CONDITION_LABEL[kind];
}

export function actionLabel(kind: MissionAction['kind']): string {
  return ACTION_LABEL[kind] ?? kind;
}

export function describeCondition(condition: MissionCondition): string {
  switch (condition.kind) {
    case 'elapsed':
      return `mission time ≥ ${condition.seconds}s`;
    case 'variable':
      return `${condition.variable} ${condition.op} ${JSON.stringify(condition.value)}`;
    case 'objective':
      return `${condition.objective} is ${condition.state}`;
    case 'entityAlive':
      return `${condition.entity} is alive`;
    case 'entityDead':
      return `${condition.entity} is destroyed`;
    case 'regionOccupied':
      return `team ${condition.team} holds ${condition.atLeast}+ tiles in ${condition.region}`;
  }
}

export function describeAction(action: MissionAction): string {
  switch (action.kind) {
    case 'setObjective':
      return `Set ${action.objective} to ${action.state}`;
    case 'setVariable':
      return `Set ${action.variable} = ${JSON.stringify(action.value)}`;
    case 'message':
      return `Message: “${action.text}”`;
    case 'activateAiGroup':
      return `Release AI group ${action.group}`;
    case 'spawnReinforcement':
      return `Bring in reinforcement ${action.reinforcement}`;
    case 'startCinematic':
      return `Play cinematic ${action.cinematic}`;
    case 'endMission':
      return `End mission as ${action.outcome}`;
  }
}

export function isDeferredAction(kind: MissionAction['kind']): kind is DeferredActionKind {
  return (DEFERRED_ACTIONS as readonly string[]).includes(kind);
}

export function parseMissionValue(type: MissionVariableType, raw: string): MissionValue {
  if (type === 'number') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  return raw;
}

export function valueToInput(value: MissionValue): string {
  return typeof value === 'boolean' ? String(value) : String(value);
}

/** Route a validator path to the workbench section that owns it. */
export function sectionForPath(path: string): MissionSection {
  if (path.startsWith('briefing') || path.startsWith('debrief')) return 'briefing';
  if (path.startsWith('objectives')) return 'objectives';
  if (path.startsWith('variables')) return 'variables';
  if (path.startsWith('regions')) return 'regions';
  if (path.startsWith('triggers')) return 'triggers';
  if (path.startsWith('aiGroups')) return 'aiGroups';
  if (path.startsWith('reinforcements')) return 'reinforcements';
  if (path.startsWith('cinematics')) return 'cinematics';
  if (path.startsWith('scenario.')) return 'regions';
  return 'overview';
}

/* ------------------------------------------------------------------ */
/* Authored placements                                               */
/* ------------------------------------------------------------------ */

export interface AuthoredEntityOption {
  key: string;
  /** Placement def name plus its stable key, as shown in a picker. */
  label: string;
  defId: string;
  defName: string;
  owner: number;
  ownerName: string;
  kind: 'structure' | 'unit';
  /** Tile position: top-left for a structure, centre for a unit. */
  x: number;
  z: number;
}

/** Every keyed placement, resolved to a readable label for reference pickers. */
export function authoredEntities(scenario: Scenario): AuthoredEntityOption[] {
  const ownerName = (id: number) =>
    scenario.players.find((player) => player.id === id)?.name ?? `Player ${id}`;
  const structures = scenario.structures
    .filter((entry): entry is ScenarioStructure & { key: string } => Boolean(entry.key))
    .map((entry) => ({
      key: entry.key,
      label: `${entry.key} · ${BUILDINGS[entry.defId]?.name ?? entry.defId}`,
      defId: entry.defId,
      defName: BUILDINGS[entry.defId]?.name ?? entry.defId,
      owner: entry.owner,
      ownerName: ownerName(entry.owner),
      kind: 'structure' as const,
      x: entry.x,
      z: entry.z,
    }));
  const units = scenario.units
    .filter((entry): entry is ScenarioUnit & { key: string } => Boolean(entry.key))
    .map((entry) => ({
      key: entry.key,
      label: `${entry.key} · ${UNITS[entry.defId]?.name ?? entry.defId}`,
      defId: entry.defId,
      defName: UNITS[entry.defId]?.name ?? entry.defId,
      owner: entry.owner,
      ownerName: ownerName(entry.owner),
      kind: 'unit' as const,
      x: entry.x,
      z: entry.z,
    }));
  return [...structures, ...units].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * What a reference field should say about a key.
 *
 * `missing` is deliberately a separate state from "valid": the editor must be
 * able to show a broken reference without silently swapping in another entity.
 */
export function describeEntityReference(
  scenario: Scenario,
  key: string,
): { found: boolean; label: string; detail: string } {
  if (!key) return { found: false, label: 'No entity selected', detail: 'A key is required.' };
  const match = authoredEntities(scenario).find((entry) => entry.key === key);
  if (!match) {
    return {
      found: false,
      label: key,
      detail: 'Not placed in this scenario',
    };
  }
  return {
    found: true,
    label: match.defName,
    detail: `${match.kind} · ${match.ownerName} · tile ${match.x}, ${match.z}`,
  };
}

function slugKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Give one placement a stable authored key if it has none.
 *
 * Existing keys are never rewritten, and a candidate that collides with any
 * key already in the scenario is qualified with its owner and then a counter, so
 * two placed riflemen never end up sharing an identity.
 */
export function ensureEntityKey(
  scenario: Scenario,
  entry: ScenarioStructure | ScenarioUnit,
): string {
  if (entry.key) return entry.key;
  const used = new Set(
    [...scenario.structures, ...scenario.units]
      .map((item) => item.key)
      .filter((key): key is string => Boolean(key)),
  );
  const def = BUILDINGS[entry.defId] ?? UNITS[entry.defId];
  const base = slugKey(def?.id ?? entry.defId ?? 'entity') || 'entity';
  let key = base;
  if (used.has(key)) key = `${base}-${entry.owner}`;
  let suffix = 2;
  while (used.has(key)) key = `${base}-${entry.owner}-${suffix++}`;
  entry.key = key;
  return key;
}

/** Key every unkeyed placement, returning the keys that were added. */
export function materialiseEntityKeys(scenario: Scenario): string[] {
  const added: string[] = [];
  for (const entry of [...scenario.structures, ...scenario.units]) {
    if (entry.key) continue;
    added.push(ensureEntityKey(scenario, entry));
  }
  return added;
}

/**
 * Duplicate or malformed authored keys on the map itself.
 *
 * The mission validator checks the mission's own namespaces; this checks the
 * scenario placements those namespaces point at, which is why it lives with the
 * authoring helpers rather than in the mission document validator.
 */
export function scenarioEntityKeyIssues(scenario: Scenario): MissionIssue[] {
  const issues: MissionIssue[] = [];
  const seen = new Map<string, string>();
  const check = (key: string | undefined, path: string, label: string) => {
    if (!key) return;
    if (!isMissionId(key)) {
      issues.push({
        severity: 'error',
        code: 'scenario-key-invalid',
        message: `${label} has authored key "${key}", which is not a valid identifier.`,
        path,
      });
      return;
    }
    const previous = seen.get(key);
    if (previous) {
      issues.push({
        severity: 'error',
        code: 'scenario-key-duplicate',
        message: `${label} reuses authored key "${key}", already used by ${previous}. Mission references would be ambiguous.`,
        path,
      });
      return;
    }
    seen.set(key, label);
  };
  scenario.structures.forEach((entry, i) =>
    check(entry.key, `scenario.structures[${i}].key`, `structure ${i}`),
  );
  scenario.units.forEach((entry, i) =>
    check(entry.key, `scenario.units[${i}].key`, `unit ${i}`),
  );
  return issues;
}

/* ------------------------------------------------------------------ */
/* Objective relationships                                           */
/* ------------------------------------------------------------------ */

export interface ObjectiveLink {
  id: string;
  title: string;
  index: number;
}

/** Objectives that list `objectiveId` as a prerequisite. */
export function objectiveDependents(doc: MissionDoc, objectiveId: string): ObjectiveLink[] {
  return doc.objectives
    .map((objective, index) => ({ objective, index }))
    .filter((entry) => entry.objective.dependsOn.includes(objectiveId))
    .map((entry) => ({ id: entry.objective.id, title: entry.objective.title, index: entry.index }));
}

/**
 * Whether adding `dependencyId` as a prerequisite of `objectiveId` would close a
 * loop. The runtime would simply never activate the objectives in it, so the
 * editor refuses the edit instead of letting an author author a dead branch.
 */
export function wouldCreateDependencyCycle(
  doc: MissionDoc,
  objectiveId: string,
  dependencyId: string,
): boolean {
  if (objectiveId === dependencyId) return true;
  const byId = new Map(doc.objectives.map((objective) => [objective.id, objective]));
  const stack = [dependencyId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === objectiveId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of byId.get(id)?.dependsOn ?? []) stack.push(next);
  }
  return false;
}

/**
 * Prerequisite chain from an objective up to its roots, for the dependency view.
 * Unknown prerequisites are kept: a broken link is information, not noise.
 */
export function dependencyChain(doc: MissionDoc, objectiveId: string): string[][] {
  const byId = new Map(doc.objectives.map((objective) => [objective.id, objective]));
  const paths: string[][] = [];
  const walk = (id: string, trail: string[]) => {
    const needs = byId.get(id)?.dependsOn ?? [];
    if (needs.length === 0) {
      paths.push([...trail, id]);
      return;
    }
    for (const next of needs) {
      if (trail.includes(next)) {
        paths.push([...trail, id, next]);
        continue;
      }
      walk(next, [...trail, id]);
    }
  };
  walk(objectiveId, []);
  return paths.slice(0, 12);
}

/** Objective ids that no trigger action can ever move to `complete`. */
export function objectivesWithoutCompletion(doc: MissionDoc): string[] {
  const completable = new Set<string>();
  for (const trigger of doc.triggers) {
    for (const action of trigger.actions) {
      if (action.kind === 'setObjective' && action.state === 'complete') {
        completable.add(action.objective);
      }
    }
  }
  return doc.objectives.filter((objective) => !completable.has(objective.id)).map((o) => o.id);
}

/* ------------------------------------------------------------------ */
/* Diagnostic focus                                                  */
/* ------------------------------------------------------------------ */

/** Where the workbench should send the author for one diagnostic. */
export interface MissionFocus {
  section: MissionSection;
  objectiveIndex?: number;
  triggerIndex?: number;
  regionIndex?: number;
  cinematicIndex?: number;
  /** Authored placement to highlight on the map, when the path names one. */
  entityKey?: string;
  /** Region to select and frame on the map. */
  regionId?: string;
}

function indexIn(path: string, name: string): number | undefined {
  const match = new RegExp(`^${name}\\[(\\d+)\\]`).exec(path);
  return match ? Number(match[1]) : undefined;
}

/** A path plus document resolves to the section, item and map object it owns. */
export function focusForPath(path: string, doc: MissionDoc): MissionFocus {
  const section = sectionForPath(path);
  const focus: MissionFocus = { section };
  const objectiveIndex = indexIn(path, 'objectives');
  const triggerIndex = indexIn(path, 'triggers');
  const regionIndex = indexIn(path, 'regions');
  const cinematicIndex = indexIn(path, 'cinematics');
  if (objectiveIndex !== undefined) focus.objectiveIndex = objectiveIndex;
  if (triggerIndex !== undefined) focus.triggerIndex = triggerIndex;
  if (regionIndex !== undefined) {
    focus.regionIndex = regionIndex;
    focus.regionId = doc.regions[regionIndex]?.id;
  }
  if (cinematicIndex !== undefined) focus.cinematicIndex = cinematicIndex;

  // Resolve the exact placement a reference path names, so a diagnostic about a
  // missing or duplicated entity can be pointed at on the map.
  const protectedMatch = /^objectives\[(\d+)\]\.protectedEntities\[(\d+)\]/.exec(path);
  if (protectedMatch) {
    const key = doc.objectives[Number(protectedMatch[1])]?.protectedEntities?.[Number(protectedMatch[2])];
    if (key) focus.entityKey = key;
  }
  const conditionEntityMatch = /^triggers\[(\d+)\]\.conditions\[(\d+)\]\.entity/.exec(path);
  if (conditionEntityMatch) {
    const condition =
      doc.triggers[Number(conditionEntityMatch[1])]?.conditions[Number(conditionEntityMatch[2])];
    if (condition && (condition.kind === 'entityAlive' || condition.kind === 'entityDead')) {
      focus.entityKey = condition.entity;
    }
  }
  const cinematicEntityMatch = /^cinematics\[(\d+)\]\.steps\[(\d+)\]\.target/.exec(path);
  if (cinematicEntityMatch) {
    const step =
      doc.cinematics[Number(cinematicEntityMatch[1])]?.steps[Number(cinematicEntityMatch[2])];
    if ((step?.kind === 'camera' || step?.kind === 'effect') && step.target.kind === 'entity') {
      focus.entityKey = step.target.entity;
    }
  }
  const conditionRegionMatch = /^triggers\[(\d+)\]\.conditions\[(\d+)\]\.region/.exec(path);
  if (conditionRegionMatch) {
    const condition =
      doc.triggers[Number(conditionRegionMatch[1])]?.conditions[Number(conditionRegionMatch[2])];
    if (condition?.kind === 'regionOccupied') {
      focus.regionId = condition.region;
      focus.regionIndex = doc.regions.findIndex((region) => region.id === condition.region);
      if (focus.regionIndex < 0) delete focus.regionIndex;
    }
  }
  if (/^carryover\.assets\[/.test(path)) {
    const match = /^carryover\.assets\[(\d+)\]/.exec(path);
    const key = match ? doc.carryover.assets[Number(match[1])] : undefined;
    if (key) focus.entityKey = key;
  }
  if (path === 'objectives') focus.section = 'objectives';
  return focus;
}

/** Every diagnostic the authoring UI shows: document plus scenario placements. */
export function authoringIssues(doc: MissionDoc, scenario: Scenario): MissionIssue[] {
  return [
    ...requireValidation(doc, scenario),
    ...scenarioEntityKeyIssues(scenario),
  ];
}

/**
 * Validate against the enclosing scenario without duplicating the context
 * construction in every call site.
 */
function requireValidation(doc: MissionDoc, scenario: Scenario): MissionIssue[] {
  return validateMission(doc, {
    width: scenario.width,
    height: scenario.height,
    entityKeys: new Set(
      [...scenario.structures, ...scenario.units]
        .map((entry) => entry.key)
        .filter((key): key is string => Boolean(key)),
    ),
  });
}
