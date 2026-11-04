/**
 * Campaign operation kit.
 *
 * Every operation is a real, versioned `MissionDoc` plus the campaign metadata
 * the deck needs. Writing both by hand for two twelve-operation campaigns would
 * repeat the same briefing, debrief, cinematic and consequence scaffolding 24
 * times, and the copies would drift. This module builds that scaffolding from a
 * short spec and leaves the parts that actually differ — objectives, regions,
 * triggers, prose — in the operation files where a mission author can read them.
 *
 * Nothing here evaluates anything. The kit produces data for the same runtime,
 * parser and validator every skirmish mission and every authored document uses.
 */
import {
  MISSION_FORMAT,
  MISSION_FORMAT_VERSION,
  type MissionAction,
  type MissionBriefing,
  type MissionCampaignRef,
  type MissionCinematicDoc,
  type MissionCinematicStep,
  type MissionCinematicTarget,
  type MissionCondition,
  type MissionDebriefCopy,
  type MissionDoc,
  type MissionEntityDoc,
  type MissionObjectiveDoc,
  type MissionRegionDoc,
  type MissionTriggerDoc,
  type MissionValue,
  type MissionVariableDoc,
} from '../../mission/types';
import type { CampaignVeteranSlot } from '../../campaign/types';

/** One authored operation, in the shape `CAMPAIGNS` expects. */
export interface AuthoredOperation {
  id: string;
  code: string;
  name: string;
  mapId: string;
  focus: string;
  situation: string;
  threat: string;
  objectives: readonly string[];
  playerNationId: string;
  opponentNationId: string;
  mission: MissionDoc;
  veterans: readonly CampaignVeteranSlot[];
}

export type CampaignId = 'baltic-line' | 'eastern-corridor';
export type CampaignSide = 'defender' | 'eastern';

export interface OperationSpec {
  campaignId: CampaignId;
  side: CampaignSide;
  order: number;
  id: string;
  code: string;
  name: string;
  mapId: string;
  focus: string;
  situation: string;
  context: string;
  threat: string;
  playerNationId: string;
  opponentNationId: string;
  briefing: Omit<MissionBriefing, 'summary'> & { summary?: string };
  debrief: MissionDebriefCopy;
  objectives: MissionObjectiveDoc[];
  variables?: MissionVariableDoc[];
  regions: MissionRegionDoc[];
  triggers: MissionTriggerDoc[];
  entities: MissionEntityDoc[];
  /** Opening framing and line beats; a default camera move is added. */
  opening: {
    speaker: string;
    lines: string[];
    target: MissionCinematicTarget;
    zoom?: number;
  };
  /** Optional in-mission scene, played once at `atSeconds`. */
  inMission?: {
    id: string;
    atSeconds: number;
    speaker: string;
    lines: string[];
    target: MissionCinematicTarget;
    zoom?: number;
  };
  ending: { speaker: string; lines: string[]; target?: MissionCinematicTarget };
  /** Named individuals this operation can carry out of the roster. */
  veterans?: readonly CampaignVeteranSlot[];
  /** Entity keys eligible for carryover; defaults to every veteran entity. */
  carryover?: string[];
}

const OPERATION_AUTHOR = 'MCA Campaign Team';

/** A decorated objective: kind and dependencies, with the id as the title short form. */
export function objective(
  id: string,
  title: string,
  kind: MissionObjectiveDoc['kind'],
  options: {
    description?: string;
    dependsOn?: string[];
    initialState?: MissionObjectiveDoc['initialState'];
    protectedEntities?: string[];
  } = {},
): MissionObjectiveDoc {
  return {
    id,
    title,
    kind,
    dependsOn: options.dependsOn ?? [],
    ...(options.description ? { description: options.description } : {}),
    ...(options.initialState ? { initialState: options.initialState } : {}),
    ...(options.protectedEntities ? { protectedEntities: options.protectedEntities } : {}),
  };
}

/**
 * A region objective: hold at least `atLeast` units inside `region`.
 *
 * `unlock` releases the next objective on the same tick, so the authored chain
 * reads as a progression rather than as a set of simultaneous conditions.
 */
export function secureRegion(options: {
  id: string;
  objective: string;
  region: string;
  atLeast?: number;
  message: string;
  unlock?: string;
  variable?: { id: string; value: MissionValue };
  /** Extra conditions the capture also requires (a timer, another objective). */
  also?: MissionCondition[];
  priority?: number;
}): MissionTriggerDoc {
  const actions: MissionAction[] = [
    { kind: 'setObjective', objective: options.objective, state: 'complete' },
  ];
  if (options.unlock) actions.push({ kind: 'setObjective', objective: options.unlock, state: 'active' });
  if (options.variable) {
    actions.push({ kind: 'setVariable', variable: options.variable.id, value: options.variable.value });
  }
  actions.push({ kind: 'message', text: options.message });
  return {
    id: options.id,
    priority: options.priority ?? 40,
    once: true,
    conditions: [
      { kind: 'objective', objective: options.objective, state: 'active' },
      {
        kind: 'regionOccupied',
        region: options.region,
        team: 0,
        atLeast: options.atLeast ?? 3,
      },
      ...(options.also ?? []),
    ],
    actions,
  };
}

/** Break the opposing command post, the operation's usual decisive act. */
export function breakCommandPost(options: {
  id: string;
  objective: string;
  message: string;
  entity?: string;
  priority?: number;
}): MissionTriggerDoc {
  return {
    id: options.id,
    priority: options.priority ?? 50,
    once: true,
    conditions: [
      { kind: 'objective', objective: options.objective, state: 'active' },
      { kind: 'entityDead', entity: options.entity ?? 'enemy-hq' },
    ],
    actions: [
      { kind: 'setObjective', objective: options.objective, state: 'complete' },
      { kind: 'message', text: options.message },
    ],
  };
}

/** Destroy one authored structure, for objectives that are not the command post. */
export function destroyEntity(options: {
  id: string;
  objective: string;
  entity: string;
  message: string;
  unlock?: string;
  priority?: number;
}): MissionTriggerDoc {
  const actions: MissionAction[] = [
    { kind: 'setObjective', objective: options.objective, state: 'complete' },
  ];
  if (options.unlock) actions.push({ kind: 'setObjective', objective: options.unlock, state: 'active' });
  actions.push({ kind: 'message', text: options.message });
  return {
    id: options.id,
    priority: options.priority ?? 45,
    once: true,
    conditions: [
      { kind: 'objective', objective: options.objective, state: 'active' },
      { kind: 'entityDead', entity: options.entity },
    ],
    actions,
  };
}

/**
 * A ground report: once the player puts units into a named region, the
 * operation passes on what was found there. It has no objective consequence, so
 * a region can be authored for terrain and intelligence without inventing a new
 * task for the player.
 */
export function regionReport(options: {
  id: string;
  region: string;
  text: string;
  atLeast?: number;
  team?: number;
  priority?: number;
}): MissionTriggerDoc {
  return {
    id: options.id,
    priority: options.priority ?? 20,
    once: true,
    conditions: [
      {
        kind: 'regionOccupied',
        region: options.region,
        team: options.team ?? 0,
        atLeast: options.atLeast ?? 2,
      },
    ],
    actions: [{ kind: 'message', text: options.text }],
  };
}

/** A timed situation report, used to pace an operation without a new mechanic. */
export function announce(id: string, seconds: number, text: string, priority = 10): MissionTriggerDoc {
  return {
    id,
    priority,
    once: true,
    conditions: [{ kind: 'elapsed', seconds }],
    actions: [{ kind: 'message', text }],
  };
}

/**
 * A deadline: complete or fail an objective once a timer runs out.
 *
 * Both branches are authored, and the success trigger is given the higher
 * priority so the failure branch sees the objective already complete on the same
 * tick instead of failing a line that was just held.
 */
export function deadline(options: {
  id: string;
  seconds: number;
  objective: string;
  region: string;
  atLeast: number;
  successMessage: string;
  failureMessage: string;
  unlock?: string;
  variable?: { id: string; value: MissionValue };
}): MissionTriggerDoc[] {
  const successActions: MissionAction[] = [
    { kind: 'setObjective', objective: options.objective, state: 'complete' },
  ];
  if (options.unlock) successActions.push({ kind: 'setObjective', objective: options.unlock, state: 'active' });
  if (options.variable) {
    successActions.push({ kind: 'setVariable', variable: options.variable.id, value: options.variable.value });
  }
  successActions.push({ kind: 'message', text: options.successMessage });
  return [
    {
      id: options.id,
      priority: 55,
      once: true,
      conditions: [
        { kind: 'elapsed', seconds: options.seconds },
        { kind: 'regionOccupied', region: options.region, team: 0, atLeast: options.atLeast },
      ],
      actions: successActions,
    },
    {
      id: `${options.id}-missed`,
      priority: 35,
      once: true,
      conditions: [
        { kind: 'elapsed', seconds: options.seconds },
        { kind: 'objective', objective: options.objective, state: 'active' },
      ],
      actions: [
        { kind: 'setObjective', objective: options.objective, state: 'failed' },
        { kind: 'message', text: options.failureMessage },
      ],
    },
  ];
}

/** The bonus every operation shares: break them with your own command intact. */
export function cleanSweepTrigger(options: {
  objective?: string;
  message?: string;
} = {}): MissionTriggerDoc {
  const id = options.objective ?? 'clean-sweep';
  return {
    id,
    priority: 60,
    once: true,
    conditions: [
      { kind: 'objective', objective: id, state: 'active' },
      { kind: 'entityDead', entity: 'enemy-hq' },
      { kind: 'entityAlive', entity: 'own-hq' },
    ],
    actions: [
      { kind: 'setObjective', objective: id, state: 'complete' },
      {
        kind: 'message',
        text: options.message ?? 'Their command post is broken and ours is standing — clean operation.',
      },
    ],
  };
}

/** A cinematic from a camera target and a short set of spoken lines. */
export function cinematic(options: {
  id: string;
  kind: MissionCinematicDoc['kind'];
  atSeconds?: number;
  speaker: string;
  lines: string[];
  target: MissionCinematicTarget;
  zoom?: number;
}): MissionCinematicDoc {
  const zoom = options.zoom ?? 40;
  const steps: MissionCinematicStep[] = [
    {
      kind: 'camera',
      target: options.target,
      zoom: zoom * 0.6,
      durationSeconds: options.kind === 'opening' ? 0 : 2.4,
      holdSeconds: 1.1,
    },
  ];
  options.lines.forEach((text, index) => {
    steps.push({
      kind: 'line',
      speaker: options.speaker,
      text,
      durationSeconds: Math.min(7.5, 3 + text.length / 26),
      ...(index < options.lines.length - 1 ? { pauseSeconds: 0.4 } : {}),
    });
  });
  steps.push({
    kind: 'camera',
    target: options.target,
    zoom,
    durationSeconds: 2.8,
    holdSeconds: 0.7,
  });
  return {
    id: options.id,
    kind: options.kind,
    skippable: true,
    ...(options.atSeconds === undefined ? {} : { atSeconds: options.atSeconds }),
    steps,
    dialogue: [],
  };
}

/** The objective lines the deck and dossier list, primary first. */
function objectiveLines(doc: MissionDoc): string[] {
  const order: Record<string, number> = { primary: 0, secondary: 1, bonus: 2 };
  return [...doc.objectives]
    .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))
    .map((entry) => entry.title);
}

/** Build the operation and its mission document from one spec. */
export function buildOperation(spec: OperationSpec): AuthoredOperation {
  const campaign: MissionCampaignRef = {
    campaignId: spec.campaignId,
    order: spec.order,
    side: spec.side,
  };
  const carryover =
    spec.carryover ??
    spec.entities.filter((entity) => entity.role === 'veteran').map((entity) => entity.key);
  const doc: MissionDoc = {
    format: MISSION_FORMAT,
    version: MISSION_FORMAT_VERSION,
    id: spec.id,
    title: spec.name,
    description: spec.situation,
    author: OPERATION_AUTHOR,
    campaign,
    briefing: {
      ...spec.briefing,
      summary: spec.briefing.summary ?? spec.situation,
    },
    debrief: spec.debrief,
    objectives: spec.objectives,
    variables: spec.variables ?? [],
    regions: spec.regions,
    triggers: spec.triggers,
    aiGroups: [],
    reinforcements: [],
    entities: spec.entities,
    cinematics: [
      cinematic({
        id: 'opening',
        kind: 'opening',
        speaker: spec.opening.speaker,
        lines: spec.opening.lines,
        target: spec.opening.target,
        zoom: spec.opening.zoom,
      }),
      ...(spec.inMission
        ? [
            cinematic({
              id: spec.inMission.id,
              kind: 'inMission',
              atSeconds: spec.inMission.atSeconds,
              speaker: spec.inMission.speaker,
              lines: spec.inMission.lines,
              target: spec.inMission.target,
              zoom: spec.inMission.zoom,
            }),
          ]
        : []),
      cinematic({
        id: 'ending',
        kind: 'ending',
        speaker: spec.ending.speaker,
        lines: spec.ending.lines,
        target: spec.ending.target ?? { kind: 'entity', entity: 'own-hq' },
        zoom: 24,
      }),
    ],
    // Consequences are assignments, not arithmetic: each accepted operation
    // records the standing tier it secures and names itself as the last one.
    consequences: [
      { id: 'standing-gain', key: 'standing', value: spec.order },
      { id: 'last-operation', key: 'lastOperation', value: spec.id },
    ],
    carryover: { enabled: true, assets: carryover },
  };
  return {
    id: spec.id,
    code: spec.code,
    name: spec.name,
    mapId: spec.mapId,
    focus: spec.focus,
    situation: spec.situation,
    threat: spec.threat,
    objectives: objectiveLines(doc),
    playerNationId: spec.playerNationId,
    opponentNationId: spec.opponentNationId,
    mission: doc,
    veterans: spec.veterans ?? [],
  };
}

/** Campaign consequence keys every operation writes. */
export const CONSEQUENCE_KEYS = Object.freeze({
  standing: 'standing',
  lastOperation: 'lastOperation',
});
