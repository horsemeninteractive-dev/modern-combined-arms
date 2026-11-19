/**
 * Mission document parsing.
 *
 * Parsing is strict on purpose: a mission is authored data that later drives
 * triggers, reinforcements and campaign consequences, so an unknown condition
 * or action kind is a hard error rather than something to skip. Every failure
 * names the dotted path inside the document and, for versions, the version that
 * was found.
 *
 * Structural conversion lives here; semantic checks (duplicate ids, dangling
 * references, variable default types, region bounds) live in `validate.ts`.
 * `parseMission` runs both and converts the first error-severity finding into a
 * `MissionFormatError`, so callers cannot accidentally hold a valid-looking but
 * inconsistent document.
 */
import {
  MISSION_FORMAT,
  MISSION_FORMAT_VERSION,
  MissionFormatError,
  type MissionObjectiveInitial,
  type MissionObjectiveKind,
  type MissionAction,
  type MissionBriefing,
  type MissionCampaignRef,
  type MissionCarryoverDoc,
  type MissionCinematicContext,
  type MissionCinematicDoc,
  type MissionCinematicStep,
  type MissionCinematicTarget,
  type MissionCinematicTransition,
  type MissionCondition,
  type MissionDebriefCopy,
  type MissionConsequenceDoc,
  type MissionDoc,
  type MissionEntityDoc,
  type MissionObjectiveDoc,
  type MissionObjectiveState,
  type MissionRegionDoc,
  type MissionReinforcementDoc,
  type MissionAiGroupDoc,
  type MissionTriggerDoc,
  type MissionValidationContext,
  type MissionValue,
  type MissionVariableDoc,
  type MissionVariableType,
} from './types';
import { validateMission } from './validate';

type Json = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new MissionFormatError(`Invalid mission at ${path}: expected ${expected}`);
}

function asRecord(value: unknown, path: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'object');
  return value as Json;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'string');
  return value;
}

function asNonEmpty(value: unknown, path: string): string {
  const text = asString(value, path);
  if (text.trim().length === 0) fail(path, 'non-empty string');
  return text;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'finite number');
  return value;
}

function asInteger(value: unknown, path: string, min = 0): number {
  const n = asNumber(value, path);
  if (!Number.isInteger(n) || n < min) fail(path, `whole number >= ${min}`);
  return n;
}

function asBool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'boolean');
  return value;
}

function asArray(value: unknown, path: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(path, 'array');
  return value;
}

function asValue(value: unknown, path: string): MissionValue {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  fail(path, 'string, boolean or finite number');
}

const VARIABLE_TYPES: readonly MissionVariableType[] = ['number', 'boolean', 'string'];
const OBJECTIVE_STATES: readonly MissionObjectiveState[] = [
  'hidden',
  'active',
  'complete',
  'failed',
];
/** `optional` was the S1 spelling of `secondary`; authored data may still use it. */
const OBJECTIVE_KIND_ALIASES = ['primary', 'secondary', 'bonus', 'optional'] as const;
const OBJECTIVE_INITIAL = ['active', 'hidden'] as const;
const AI_TASKS = ['attack', 'defend', 'patrol', 'reinforce'] as const;
const AI_GROUP_INITIAL_STATES = ['active', 'dormant'] as const;
/** `in-mission` is accepted as authored prose; the model uses `inMission`. */
const CINEMATIC_KINDS = [
  'campaignIntro',
  'opening',
  'briefing',
  'inMission',
  'debrief',
  'intermission',
  'ending',
  'campaignFinale',
] as const;
/** A legacy dialogue line becomes this many seconds of subtitle. */
export const LEGACY_LINE_SECONDS = 4.5;
const ENTITY_ROLES = ['veteran', 'asset', 'protected', 'objective'] as const;
const CAMPAIGN_SIDES = ['defender', 'eastern'] as const;
const COMPARE_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const;

function oneOf<T extends string>(
  value: unknown,
  path: string,
  options: readonly T[],
): T {
  const text = asString(value, path);
  if (!(options as readonly string[]).includes(text)) {
    fail(path, `one of ${options.join(', ')}`);
  }
  return text as T;
}

function parseCampaign(value: unknown, path: string): MissionCampaignRef {
  const raw = asRecord(value, path);
  const order = asInteger(raw.order, `${path}.order`, 1);
  const side = raw.side === undefined ? undefined : oneOf(raw.side, `${path}.side`, CAMPAIGN_SIDES);
  return {
    campaignId: asNonEmpty(raw.campaignId, `${path}.campaignId`),
    order,
    ...(side ? { side } : {}),
  };
}

function optionalText(raw: Json, key: string, path: string): string | undefined {
  return raw[key] === undefined ? undefined : asString(raw[key], `${path}.${key}`);
}

/** A short authored list; entries may be blank only if the validator sees them. */
function optionalTextList(raw: Json, key: string, path: string): string[] | undefined {
  if (raw[key] === undefined) return undefined;
  return asArray(raw[key], `${path}.${key}`).map((entry, i) =>
    asString(entry, `${path}.${key}[${i}]`),
  );
}

function parseBriefing(value: unknown, path: string): MissionBriefing {
  const raw = asRecord(value, path);
  const subtitle = optionalText(raw, 'subtitle', path);
  const context = optionalText(raw, 'context', path);
  const commanderNote = optionalText(raw, 'commanderNote', path);
  const enemyIntent = optionalText(raw, 'enemyIntent', path);
  const personnel = optionalTextList(raw, 'personnel', path);
  const instructions = optionalTextList(raw, 'instructions', path);
  return {
    summary: asString(raw.summary, `${path}.summary`),
    friendly: asString(raw.friendly, `${path}.friendly`),
    enemy: asString(raw.enemy, `${path}.enemy`),
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(commanderNote !== undefined ? { commanderNote } : {}),
    ...(enemyIntent !== undefined ? { enemyIntent } : {}),
    ...(personnel !== undefined ? { personnel } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
  };
}

function parseDebrief(value: unknown, path: string): MissionDebriefCopy {
  const raw = asRecord(value, path);
  const victory = optionalText(raw, 'victory', path);
  const defeat = optionalText(raw, 'defeat', path);
  return {
    ...(victory !== undefined ? { victory } : {}),
    ...(defeat !== undefined ? { defeat } : {}),
  };
}

function parseObjective(value: unknown, path: string): MissionObjectiveDoc {
  const raw = asRecord(value, path);
  const description =
    raw.description === undefined ? undefined : asString(raw.description, `${path}.description`);
  const authoredKind = oneOf(raw.kind ?? 'primary', `${path}.kind`, OBJECTIVE_KIND_ALIASES);
  const kind: MissionObjectiveKind = authoredKind === 'optional' ? 'secondary' : authoredKind;
  const initialState =
    raw.initialState === undefined
      ? undefined
      : (oneOf(raw.initialState, `${path}.initialState`, OBJECTIVE_INITIAL) as MissionObjectiveInitial);
  const protectedEntities =
    raw.protectedEntities === undefined
      ? undefined
      : asArray(raw.protectedEntities, `${path}.protectedEntities`).map((entry, i) =>
          asNonEmpty(entry, `${path}.protectedEntities[${i}]`),
        );
  return {
    id: asNonEmpty(raw.id, `${path}.id`),
    title: asNonEmpty(raw.title, `${path}.title`),
    ...(description !== undefined ? { description } : {}),
    kind,
    dependsOn: asArray(raw.dependsOn, `${path}.dependsOn`).map((entry, i) =>
      asNonEmpty(entry, `${path}.dependsOn[${i}]`),
    ),
    ...(initialState !== undefined ? { initialState } : {}),
    ...(protectedEntities !== undefined ? { protectedEntities } : {}),
  };
}

function parseVariable(value: unknown, path: string): MissionVariableDoc {
  const raw = asRecord(value, path);
  const description =
    raw.description === undefined ? undefined : asString(raw.description, `${path}.description`);
  return {
    id: asNonEmpty(raw.id, `${path}.id`),
    type: oneOf(raw.type, `${path}.type`, VARIABLE_TYPES),
    default: asValue(raw.default, `${path}.default`),
    ...(description !== undefined ? { description } : {}),
  };
}

function parseRegion(value: unknown, path: string): MissionRegionDoc {
  const raw = asRecord(value, path);
  const name = raw.name === undefined ? undefined : asString(raw.name, `${path}.name`);
  return {
    id: asNonEmpty(raw.id, `${path}.id`),
    ...(name !== undefined ? { name } : {}),
    x: asInteger(raw.x, `${path}.x`),
    z: asInteger(raw.z, `${path}.z`),
    width: asInteger(raw.width, `${path}.width`, 1),
    height: asInteger(raw.height, `${path}.height`, 1),
  };
}

function parseCondition(value: unknown, path: string): MissionCondition {
  const raw = asRecord(value, path);
  const kind = asString(raw.kind, `${path}.kind`);
  switch (kind) {
    case 'elapsed':
      return { kind: 'elapsed', seconds: asNumber(raw.seconds, `${path}.seconds`) };
    case 'variable':
      return {
        kind: 'variable',
        variable: asNonEmpty(raw.variable, `${path}.variable`),
        op: oneOf(raw.op, `${path}.op`, COMPARE_OPS),
        value: asValue(raw.value, `${path}.value`),
      };
    case 'objective':
      return {
        kind: 'objective',
        objective: asNonEmpty(raw.objective, `${path}.objective`),
        state: oneOf(raw.state, `${path}.state`, OBJECTIVE_STATES),
      };
    case 'entityAlive':
      return { kind: 'entityAlive', entity: asNonEmpty(raw.entity, `${path}.entity`) };
    case 'entityDead':
      return { kind: 'entityDead', entity: asNonEmpty(raw.entity, `${path}.entity`) };
    case 'regionOccupied':
      return {
        kind: 'regionOccupied',
        region: asNonEmpty(raw.region, `${path}.region`),
        team: asInteger(raw.team, `${path}.team`),
        atLeast: asInteger(raw.atLeast ?? 1, `${path}.atLeast`, 1),
      };
    default:
      return fail(`${path}.kind`, `a supported condition (found "${kind}")`) as never;
  }
}

function parseAction(value: unknown, path: string): MissionAction {
  const raw = asRecord(value, path);
  const kind = asString(raw.kind, `${path}.kind`);
  switch (kind) {
    case 'setVariable':
      return {
        kind: 'setVariable',
        variable: asNonEmpty(raw.variable, `${path}.variable`),
        value: asValue(raw.value, `${path}.value`),
      };
    case 'setObjective':
      return {
        kind: 'setObjective',
        objective: asNonEmpty(raw.objective, `${path}.objective`),
        state: oneOf(raw.state, `${path}.state`, OBJECTIVE_STATES),
      };
    case 'message':
      return { kind: 'message', text: asNonEmpty(raw.text, `${path}.text`) };
    case 'activateAiGroup':
      return { kind: 'activateAiGroup', group: asNonEmpty(raw.group, `${path}.group`) };
    case 'spawnReinforcement':
      return {
        kind: 'spawnReinforcement',
        reinforcement: asNonEmpty(raw.reinforcement, `${path}.reinforcement`),
      };
    case 'startCinematic':
      return {
        kind: 'startCinematic',
        cinematic: asNonEmpty(raw.cinematic, `${path}.cinematic`),
      };
    case 'endMission':
      return { kind: 'endMission', outcome: oneOf(raw.outcome, `${path}.outcome`, ['victory', 'defeat']) };
    default:
      return fail(`${path}.kind`, `a supported action (found "${kind}")`) as never;
  }
}

function parseTrigger(value: unknown, path: string): MissionTriggerDoc {
  const raw = asRecord(value, path);
  const cooldownSeconds =
    raw.cooldownSeconds === undefined ? undefined : asNumber(raw.cooldownSeconds, `${path}.cooldownSeconds`);
  const delaySeconds =
    raw.delaySeconds === undefined ? undefined : asNumber(raw.delaySeconds, `${path}.delaySeconds`);
  const priority =
    raw.priority === undefined ? undefined : asInteger(raw.priority, `${path}.priority`, -1000);
  return {
    id: asNonEmpty(raw.id, `${path}.id`),
    ...(priority !== undefined ? { priority } : {}),
    once: asBool(raw.once ?? true, `${path}.once`),
    ...(cooldownSeconds !== undefined ? { cooldownSeconds } : {}),
    ...(delaySeconds !== undefined ? { delaySeconds } : {}),
    conditions: asArray(raw.conditions, `${path}.conditions`).map((entry, i) =>
      parseCondition(entry, `${path}.conditions[${i}]`),
    ),
    actions: asArray(raw.actions, `${path}.actions`).map((entry, i) =>
      parseAction(entry, `${path}.actions[${i}]`),
    ),
  };
}

function parseAiGroup(value: unknown, path: string): MissionAiGroupDoc {
  const raw = asRecord(value, path);
  const region = raw.region === undefined ? undefined : asNonEmpty(raw.region, `${path}.region`);
  return {
    id: asNonEmpty(raw.id, `${path}.id`),
    owner: asInteger(raw.owner, `${path}.owner`),
    task: oneOf(raw.task, `${path}.task`, AI_TASKS),
    units: asArray(raw.units, `${path}.units`).map((entry, i) =>
      asNonEmpty(entry, `${path}.units[${i}]`),
    ),
    ...(region !== undefined ? { region } : {}),
    ...(raw.initial === undefined
      ? {}
      : { initial: oneOf(raw.initial, `${path}.initial`, AI_GROUP_INITIAL_STATES) }),
  };
}

function parseReinforcement(value: unknown, path: string): MissionReinforcementDoc {
  const raw = asRecord(value, path);
  const triggerId =
    raw.triggerId === undefined ? undefined : asNonEmpty(raw.triggerId, `${path}.triggerId`);
  const afterSeconds =
    raw.afterSeconds === undefined ? undefined : asNumber(raw.afterSeconds, `${path}.afterSeconds`);
  return {
    id: asNonEmpty(raw.id, `${path}.id`),
    owner: asInteger(raw.owner, `${path}.owner`),
    region: asNonEmpty(raw.region, `${path}.region`),
    units: asArray(raw.units, `${path}.units`).map((entry, i) => {
      const unit = asRecord(entry, `${path}.units[${i}]`);
      return {
        defId: asNonEmpty(unit.defId, `${path}.units[${i}].defId`),
        count: asInteger(unit.count, `${path}.units[${i}].count`, 1),
      };
    }),
    ...(triggerId !== undefined ? { triggerId } : {}),
    ...(afterSeconds !== undefined ? { afterSeconds } : {}),
  };
}

function parseEntity(value: unknown, path: string): MissionEntityDoc {
  const raw = asRecord(value, path);
  const name = raw.name === undefined ? undefined : asString(raw.name, `${path}.name`);
  const notes = raw.notes === undefined ? undefined : asString(raw.notes, `${path}.notes`);
  return {
    key: asNonEmpty(raw.key, `${path}.key`),
    ...(name !== undefined ? { name } : {}),
    role: oneOf(raw.role, `${path}.role`, ENTITY_ROLES),
    ...(notes !== undefined ? { notes } : {}),
  };
}

function parseCinematicTarget(value: unknown, path: string): MissionCinematicTarget {
  const raw = asRecord(value, path);
  const kind = asString(raw.kind, `${path}.kind`);
  if (kind === 'position') {
    return {
      kind: 'position',
      x: asNumber(raw.x, `${path}.x`),
      z: asNumber(raw.z, `${path}.z`),
    };
  }
  if (kind === 'entity') {
    return { kind: 'entity', entity: asNonEmpty(raw.entity, `${path}.entity`) };
  }
  if (kind === 'restore') return { kind: 'restore' };
  return fail(`${path}.kind`, `"position", "entity" or "restore" (found "${kind}")`) as never;
}

function parseCinematicTransition(value: unknown, path: string): MissionCinematicTransition {
  const raw = asRecord(value, path);
  return {
    kind: oneOf(raw.kind, `${path}.kind`, ['cut', 'fade'] as const),
    durationSeconds: asNumber(raw.durationSeconds, `${path}.durationSeconds`),
  };
}

function parseCinematicStep(value: unknown, path: string): MissionCinematicStep {
  const raw = asRecord(value, path);
  const kind = asString(raw.kind, `${path}.kind`);
  switch (kind) {
    case 'camera': {
      const target = parseCinematicTarget(raw.target, `${path}.target`);
      const zoom = raw.zoom === undefined ? undefined : asNumber(raw.zoom, `${path}.zoom`);
      const rotationDegrees =
        raw.rotationDegrees === undefined
          ? undefined
          : asNumber(raw.rotationDegrees, `${path}.rotationDegrees`);
      const durationSeconds = asNumber(raw.durationSeconds, `${path}.durationSeconds`);
      const holdSeconds =
        raw.holdSeconds === undefined ? undefined : asNumber(raw.holdSeconds, `${path}.holdSeconds`);
      const shake = raw.shake === undefined ? undefined : asNumber(raw.shake, `${path}.shake`);
      const track = raw.track === undefined ? undefined : asBool(raw.track, `${path}.track`);
      const ease =
        raw.ease === undefined
          ? undefined
          : oneOf(raw.ease, `${path}.ease`, ['smooth', 'linear', 'cut'] as const);
      return {
        kind: 'camera',
        target,
        ...(zoom !== undefined ? { zoom } : {}),
        ...(rotationDegrees !== undefined ? { rotationDegrees } : {}),
        durationSeconds,
        ...(holdSeconds !== undefined ? { holdSeconds } : {}),
        ...(track !== undefined ? { track } : {}),
        ...(shake !== undefined ? { shake } : {}),
        ...(ease !== undefined ? { ease } : {}),
      };
    }
    case 'line': {
      const durationSeconds = asNumber(raw.durationSeconds, `${path}.durationSeconds`);
      const pauseSeconds =
        raw.pauseSeconds === undefined ? undefined : asNumber(raw.pauseSeconds, `${path}.pauseSeconds`);
      const portrait =
        raw.portrait === undefined ? undefined : asNonEmpty(raw.portrait, `${path}.portrait`);
      const voice = raw.voice === undefined ? undefined : asNonEmpty(raw.voice, `${path}.voice`);
      const radio = raw.radio === undefined ? undefined : asBool(raw.radio, `${path}.radio`);
      return {
        kind: 'line',
        speaker: asString(raw.speaker, `${path}.speaker`),
        text: asNonEmpty(raw.text, `${path}.text`),
        durationSeconds,
        ...(pauseSeconds !== undefined ? { pauseSeconds } : {}),
        ...(portrait !== undefined ? { portrait } : {}),
        ...(voice !== undefined ? { voice } : {}),
        ...(radio !== undefined ? { radio } : {}),
      };
    }
    case 'notify': {
      const durationSeconds =
        raw.durationSeconds === undefined ? undefined : asNumber(raw.durationSeconds, `${path}.durationSeconds`);
      const heading =
        raw.heading === undefined ? undefined : asNonEmpty(raw.heading, `${path}.heading`);
      return {
        kind: 'notify',
        text: asNonEmpty(raw.text, `${path}.text`),
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        ...(heading !== undefined ? { heading } : {}),
      };
    }
    case 'effect': {
      const scale = raw.scale === undefined ? undefined : asNumber(raw.scale, `${path}.scale`);
      const durationSeconds =
        raw.durationSeconds === undefined ? undefined : asNumber(raw.durationSeconds, `${path}.durationSeconds`);
      return {
        kind: 'effect',
        effect: oneOf(raw.effect, `${path}.effect`, ['explosion', 'smoke', 'dust', 'muzzle'] as const),
        target: parseCinematicTarget(raw.target, `${path}.target`),
        ...(scale !== undefined ? { scale } : {}),
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      };
    }
    case 'actor': {
      const action = oneOf(raw.action, `${path}.action`, [
        'move',
        'turn',
        'animate',
        'fire',
        'enter',
        'leave',
        'appear',
        'disappear',
      ] as const);
      const entity = asNonEmpty(raw.entity, `${path}.entity`);
      const durationSeconds = asNumber(raw.durationSeconds, `${path}.durationSeconds`);
      const ease =
        raw.ease === undefined
          ? undefined
          : oneOf(raw.ease, `${path}.ease`, ['smooth', 'linear', 'cut'] as const);
      if (action === 'move') {
        return {
          kind: 'actor',
          action,
          entity,
          x: asNumber(raw.x, `${path}.x`),
          z: asNumber(raw.z, `${path}.z`),
          durationSeconds,
          ...(ease !== undefined ? { ease } : {}),
        };
      }
      if (action === 'turn') {
        return {
          kind: 'actor',
          action,
          entity,
          facingDegrees: asNumber(raw.facingDegrees, `${path}.facingDegrees`),
          durationSeconds,
          ...(ease !== undefined ? { ease } : {}),
        };
      }
      if (action === 'animate') {
        return {
          kind: 'actor',
          action,
          entity,
          pose: oneOf(raw.pose, `${path}.pose`, ['idle', 'walk'] as const),
          durationSeconds,
        };
      }
      if (action === 'fire') {
        const scale = raw.scale === undefined ? undefined : asNumber(raw.scale, `${path}.scale`);
        return {
          kind: 'actor',
          action,
          entity,
          target: parseCinematicTarget(raw.target, `${path}.target`),
          ...(scale !== undefined ? { scale } : {}),
          durationSeconds,
        };
      }
      if (action === 'enter') {
        return {
          kind: 'actor',
          action,
          entity,
          structure: asNonEmpty(raw.structure, `${path}.structure`),
          durationSeconds,
        };
      }
      if (action === 'leave') {
        return {
          kind: 'actor',
          action,
          entity,
          structure: asNonEmpty(raw.structure, `${path}.structure`),
          x: asNumber(raw.x, `${path}.x`),
          z: asNumber(raw.z, `${path}.z`),
          durationSeconds,
        };
      }
      return { kind: 'actor', action, entity, durationSeconds };
    }
    case 'sound': {
      const gain = raw.gain === undefined ? undefined : asNumber(raw.gain, `${path}.gain`);
      const durationSeconds =
        raw.durationSeconds === undefined ? undefined : asNumber(raw.durationSeconds, `${path}.durationSeconds`);
      return {
        kind: 'sound',
        cue: asNonEmpty(raw.cue, `${path}.cue`),
        ...(gain !== undefined ? { gain } : {}),
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      };
    }
    case 'card': {
      const subheading =
        raw.subheading === undefined ? undefined : asString(raw.subheading, `${path}.subheading`);
      const body = raw.body === undefined ? undefined : asString(raw.body, `${path}.body`);
      return {
        kind: 'card',
        heading: asNonEmpty(raw.heading, `${path}.heading`),
        ...(subheading !== undefined ? { subheading } : {}),
        ...(body !== undefined ? { body } : {}),
        durationSeconds: asNumber(raw.durationSeconds, `${path}.durationSeconds`),
      };
    }
    case 'music': {
      const durationSeconds =
        raw.durationSeconds === undefined ? undefined : asNumber(raw.durationSeconds, `${path}.durationSeconds`);
      return {
        kind: 'music',
        track: asNonEmpty(raw.track, `${path}.track`),
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      };
    }
    default:
      return fail(
        `${path}.kind`,
        `"camera", "line", "notify", "effect", "actor", "sound", "card" or "music" (found "${kind}")`,
      ) as never;
  }
}

function parseCinematic(value: unknown, path: string): MissionCinematicDoc {
  const raw = asRecord(value, path);
  const authoredKind = asString(raw.kind, `${path}.kind`);
  const kind: MissionCinematicContext =
    authoredKind === 'in-mission' ? 'inMission' : (oneOf(authoredKind, `${path}.kind`, CINEMATIC_KINDS) as MissionCinematicContext);
  const atSeconds =
    raw.atSeconds === undefined ? undefined : asNumber(raw.atSeconds, `${path}.atSeconds`);
  const authoredTransition =
    raw.transition === undefined ? undefined : asRecord(raw.transition, `${path}.transition`);
  const transitionIn =
    authoredTransition?.in === undefined
      ? undefined
      : parseCinematicTransition(authoredTransition.in, `${path}.transition.in`);
  const transitionOut =
    authoredTransition?.out === undefined
      ? undefined
      : parseCinematicTransition(authoredTransition.out, `${path}.transition.out`);
  const authoredDialogue = asArray(raw.dialogue, `${path}.dialogue`).map((entry, i) => {
    const line = asRecord(entry, `${path}.dialogue[${i}]`);
    return {
      speaker: asString(line.speaker, `${path}.dialogue[${i}].speaker`),
      line: asString(line.line, `${path}.dialogue[${i}].line`),
    };
  });
  let steps = asArray(raw.steps, `${path}.steps`).map((entry, i) =>
    parseCinematicStep(entry, `${path}.steps[${i}]`),
  );
  // An early document carried a flat dialogue list. Fold it into the timeline
  // rather than keeping two playback models alive.
  if (steps.length === 0 && authoredDialogue.length > 0) {
    steps = authoredDialogue.map((entry) => ({
      kind: 'line' as const,
      speaker: entry.speaker,
      text: entry.line,
      durationSeconds: LEGACY_LINE_SECONDS,
    }));
  }
  const dialogue =
    authoredDialogue.length > 0
      ? authoredDialogue
      : steps
          .filter((step): step is Extract<MissionCinematicStep, { kind: 'line' }> => step.kind === 'line')
          .map((step) => ({ speaker: step.speaker, line: step.text }));
  return {
    id: asNonEmpty(raw.id, `${path}.id`),
    kind,
    skippable: asBool(raw.skippable ?? true, `${path}.skippable`),
    ...(atSeconds !== undefined ? { atSeconds } : {}),
    ...(transitionIn || transitionOut
      ? {
          transition: {
            ...(transitionIn ? { in: transitionIn } : {}),
            ...(transitionOut ? { out: transitionOut } : {}),
          },
        }
      : {}),
    steps,
    dialogue,
  };
}

function parseConsequence(value: unknown, path: string): MissionConsequenceDoc {
  const raw = asRecord(value, path);
  const description =
    raw.description === undefined ? undefined : asString(raw.description, `${path}.description`);
  return {
    id: asNonEmpty(raw.id, `${path}.id`),
    key: asNonEmpty(raw.key, `${path}.key`),
    value: asValue(raw.value, `${path}.value`),
    ...(description !== undefined ? { description } : {}),
  };
}

function parseCarryover(value: unknown, path: string): MissionCarryoverDoc {
  const raw = asRecord(value ?? {}, path);
  return {
    enabled: asBool(raw.enabled ?? false, `${path}.enabled`),
    assets: asArray(raw.assets, `${path}.assets`).map((entry, i) =>
      asNonEmpty(entry, `${path}.assets[${i}]`),
    ),
  };
}

/**
 * Parse a mission document.
 *
 * `context` is supplied when the mission is embedded in a scenario, so authored
 * entity keys and map bounds can be resolved during the same pass. A standalone
 * document (an exported mission file) parses without it.
 */
export function parseMission(
  raw: unknown,
  context: MissionValidationContext = {},
  /**
   * Draft loading only.
   *
   * Structural problems are always fatal, but a document that is merely
   * incomplete (for example an objective list an author is midway through) must
   * stay loadable so unsaved work survives a reload. Storage and import keep the
   * default, so an invalid document can never be saved or imported.
   */
  options: { allowInvalid?: boolean } = {},
): MissionDoc {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('mission', 'object');
  const r = raw as Json;
  if (r.format !== MISSION_FORMAT) fail('format', MISSION_FORMAT);
  if (r.version !== MISSION_FORMAT_VERSION) {
    throw new MissionFormatError(
      `Unsupported mission version ${String(r.version)} at mission.version. This build supports version ${MISSION_FORMAT_VERSION}.`,
    );
  }
  const author = r.author === undefined ? undefined : asString(r.author, 'author');
  const doc: MissionDoc = {
    format: MISSION_FORMAT,
    version: MISSION_FORMAT_VERSION,
    id: asNonEmpty(r.id, 'id'),
    title: asNonEmpty(r.title, 'title'),
    description: asString(r.description ?? '', 'description'),
    ...(author !== undefined ? { author } : {}),
    ...(r.campaign !== undefined ? { campaign: parseCampaign(r.campaign, 'campaign') } : {}),
    briefing: parseBriefing(r.briefing, 'briefing'),
    ...(r.debrief !== undefined ? { debrief: parseDebrief(r.debrief, 'debrief') } : {}),
    objectives: asArray(r.objectives, 'objectives').map((entry, i) =>
      parseObjective(entry, `objectives[${i}]`),
    ),
    variables: asArray(r.variables, 'variables').map((entry, i) =>
      parseVariable(entry, `variables[${i}]`),
    ),
    regions: asArray(r.regions, 'regions').map((entry, i) => parseRegion(entry, `regions[${i}]`)),
    triggers: asArray(r.triggers, 'triggers').map((entry, i) =>
      parseTrigger(entry, `triggers[${i}]`),
    ),
    aiGroups: asArray(r.aiGroups, 'aiGroups').map((entry, i) =>
      parseAiGroup(entry, `aiGroups[${i}]`),
    ),
    reinforcements: asArray(r.reinforcements, 'reinforcements').map((entry, i) =>
      parseReinforcement(entry, `reinforcements[${i}]`),
    ),
    entities: asArray(r.entities, 'entities').map((entry, i) =>
      parseEntity(entry, `entities[${i}]`),
    ),
    cinematics: asArray(r.cinematics, 'cinematics').map((entry, i) =>
      parseCinematic(entry, `cinematics[${i}]`),
    ),
    consequences: asArray(r.consequences, 'consequences').map((entry, i) =>
      parseConsequence(entry, `consequences[${i}]`),
    ),
    carryover: parseCarryover(r.carryover, 'carryover'),
  };
  if (options.allowInvalid === true) return doc;
  const firstError = validateMission(doc, context).find((issue) => issue.severity === 'error');
  if (firstError) {
    throw new MissionFormatError(
      `Invalid mission at ${firstError.path}: ${firstError.message} [${firstError.code}]`,
    );
  }
  return doc;
}
