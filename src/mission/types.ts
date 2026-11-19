/**
 * Mission document types (Stage S1).
 *
 * A mission is a versioned, declarative document embedded in a Scenario. It is
 * data only: nothing here executes, and there is no script string anywhere in
 * the shape. Later stages add runtime semantics to the same document, so the
 * types are written as discriminated unions that can grow without redesigning
 * what already exists.
 *
 * The mission format version is deliberately independent of the scenario format
 * version. A mission document can gain a field without every map being rewritten,
 * and a map can change without invalidating authored missions.
 */

export const MISSION_FORMAT = 'mca-mission';

/**
 * Version 1 is the first authored mission document. A document naming a newer
 * version is rejected rather than parsed optimistically: an unknown field can
 * change what a trigger means.
 */
export const MISSION_FORMAT_VERSION = 1;

/** A typed mission value. Variables are limited to these three types. */
export type MissionValue = number | boolean | string;

export type MissionVariableType = 'number' | 'boolean' | 'string';

/**
 * How an objective is presented and whether it is required for victory.
 *
 * `primary` objectives decide the mission: victory needs every one complete and
 * a single failure is a defeat. `secondary` and `bonus` are reported to the
 * player and carry no independent victory rule.
 */
export type MissionObjectiveKind = 'primary' | 'secondary' | 'bonus';

/**
 * Objective state, as the authoritative runtime holds it.
 *
 * `hidden` is the only non-terminal state that is not yet available to the
 * player: a dependent objective waits here until its prerequisites complete,
 * and a trigger-gated objective waits for its trigger. Hidden objectives are
 * never shown by the HUD.
 */
export type MissionObjectiveState = 'hidden' | 'active' | 'complete' | 'failed';

/**
 * Authored opening visibility. Absent means "available at mission start" for an
 * objective with no prerequisites, and "wait for prerequisites" for one with
 * them. `hidden` keeps an objective back until a trigger activates it, which is
 * the only way to author a reveal.
 */
export type MissionObjectiveInitial = 'active' | 'hidden';

/** Which end-of-mission outcome an action requests. */
export type MissionOutcome = 'victory' | 'defeat';

/** A campaign link. Ordering is authored, not inferred from file names. */
export interface MissionCampaignRef {
  campaignId: string;
  /** Position in the campaign chronology, starting at 1. */
  order: number;
  /** Which coalition the player commands in this mission. */
  side?: 'defender' | 'eastern';
}

/**
 * Structured operation briefing.
 *
 * Every field is authored prose, not a mini-language: the presentation layer
 * never parses markup out of a paragraph. `{{name}}` and `{{callsign}}` are the
 * only substitutions, and they resolve against the commander profile at render
 * time.
 */
export interface MissionBriefing {
  /** One or two sentences of situation. */
  summary: string;
  /** Friendly force description the briefing shows. */
  friendly: string;
  /** Known enemy force description. */
  enemy: string;
  /** Optional operation subtitle under the title. */
  subtitle?: string;
  /** Strategic context: why this operation matters in the wider campaign. */
  context?: string;
  /** Optional commander-voice paragraph. */
  commanderNote?: string;
  /** Known enemy intent, as distinct from the order of battle. */
  enemyIntent?: string;
  /** Named friendly personnel the player should expect in the order of battle. */
  personnel?: string[];
  /** Operational instructions, one short line each. */
  instructions?: string[];
}

/** Outcome-specific debrief prose. Facts stay in `MissionResult`. */
export interface MissionDebriefCopy {
  victory?: string;
  defeat?: string;
}

/**
 * One objective.
 *
 * `dependsOn` names other objectives, never triggers: a trigger may activate or
 * complete an objective, but the dependency graph is authored and checkable
 * without running anything.
 */
export interface MissionObjectiveDoc {
  id: string;
  title: string;
  description?: string;
  kind: MissionObjectiveKind;
  /** Objectives that must complete before this one becomes active. */
  dependsOn: string[];
  /** Opening visibility override; dependencies still gate activation. */
  initialState?: MissionObjectiveInitial;
  /** Authored entity keys the objective protects, for mission result capture. */
  protectedEntities?: string[];
}

/** A typed mission variable and its authored default. */
export interface MissionVariableDoc {
  id: string;
  type: MissionVariableType;
  default: MissionValue;
  description?: string;
}

/** A rectangular tile region used by triggers, AI groups and reinforcements. */
export interface MissionRegionDoc {
  id: string;
  name?: string;
  /** Top-left tile. */
  x: number;
  z: number;
  /** Size in tiles; both at least one. */
  width: number;
  height: number;
}

/**
 * A trigger condition.
 *
 * Every member is a closed, typed shape. Adding a condition means adding a
 * member here and a case in the evaluator, never accepting free text.
 */
export type MissionCondition =
  | { kind: 'elapsed'; seconds: number }
  | {
      kind: 'variable';
      variable: string;
      op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
      value: MissionValue;
    }
  | { kind: 'objective'; objective: string; state: MissionObjectiveState }
  | { kind: 'entityAlive'; entity: string }
  /**
   * The authored placement no longer exists, or exists with zero hit points.
   *
   * The inverse of `entityAlive` exists because "destroy the command post" is
   * the commonest authored objective: without it a mission could describe the
   * goal but never observe it, and campaign missions would be unwinnable.
   */
  | { kind: 'entityDead'; entity: string }
  | { kind: 'regionOccupied'; region: string; team: number; atLeast: number };

/** A trigger action. Same closed-union rule as conditions. */
export type MissionAction =
  | { kind: 'setVariable'; variable: string; value: MissionValue }
  | { kind: 'setObjective'; objective: string; state: MissionObjectiveState }
  | { kind: 'message'; text: string }
  | { kind: 'activateAiGroup'; group: string }
  | { kind: 'spawnReinforcement'; reinforcement: string }
  /** Request an in-mission cinematic. Presentation only: no mission state moves. */
  | { kind: 'startCinematic'; cinematic: string }
  | { kind: 'endMission'; outcome: MissionOutcome };

/**
 * One authored trigger.
 *
 * `once`, `cooldownSeconds` and `delaySeconds` are declared here so authored
 * data that relies on them validates today; evaluation is a later stage.
 */
export interface MissionTriggerDoc {
  id: string;
  /**
   * Evaluation order within a tick. Higher fires first; equal priority falls
   * back to trigger id, so ordering never depends on document or object order.
   */
  priority?: number;
  once: boolean;
  /** Minimum seconds between firings when `once` is false. */
  cooldownSeconds?: number;
  /** Seconds to wait after the conditions first hold before acting. */
  delaySeconds?: number;
  conditions: MissionCondition[];
  actions: MissionAction[];
}

export type MissionAiTask = 'attack' | 'defend' | 'patrol' | 'reinforce';

/** A group of authored entities the mission gives one AI task. */
export interface MissionAiGroupDoc {
  id: string;
  owner: number;
  task: MissionAiTask;
  /** Authored entity keys this group commands. */
  units: string[];
  /** Region the group is told to operate in, when the task uses one. */
  region?: string;
  /**
   * Whether the group fights from the first tick.
   *
   * A `dormant` group is placed on the map but held: its units stand where they
   * were authored, are not counted by the AI commander and take no orders until
   * an `activateAiGroup` action releases them. This is how a mission keeps a
   * counterattack or an ambush off the board until the story calls for it.
   * Absent means `active`, which is what every group authored before this field
   * meant.
   */
  initial?: 'active' | 'dormant';
}

/** One reinforcement wave. */
export interface MissionReinforcementDoc {
  id: string;
  owner: number;
  /** Region the wave arrives in; the spawn point is resolved at runtime. */
  region: string;
  units: Array<{ defId: string; count: number }>;
  /** Optional trigger whose firing requests this wave. */
  triggerId?: string;
  /** Seconds after the mission starts, when no trigger gates the wave. */
  afterSeconds?: number;
}

/** Why an authored placement is named in the mission. */
export type MissionEntityRole = 'veteran' | 'asset' | 'protected' | 'objective';

/** Named significance attached to an authored placement key. */
export interface MissionEntityDoc {
  /** Must match a `key` on an authored unit or structure placement. */
  key: string;
  name?: string;
  role: MissionEntityRole;
  notes?: string;
}

/**
 * Where a sequence plays, and therefore whether it pauses the battle.
 *
 * `campaignIntro` and `campaignFinale` are campaign-level scenes and live on
 * the campaign definition rather than in a mission document. `briefing` and
 * `debrief` are mission-level scenes that frame their respective screens.
 */
export type MissionCinematicContext =
  | 'campaignIntro'
  | 'opening'
  | 'briefing'
  | 'inMission'
  | 'debrief'
  | 'intermission'
  | 'ending'
  | 'campaignFinale';

/** Authored camera framing. Positions are tile coordinates; entities are keys. */
export type MissionCinematicTarget =
  | { kind: 'position'; x: number; z: number }
  | { kind: 'entity'; entity: string }
  /** The framing the scene found when it started; returns the camera mid-scene. */
  | { kind: 'restore' };

/** How a scene enters or leaves the frame. */
export type MissionCinematicTransitionKind = 'cut' | 'fade';

/**
 * One authored edge transition.
 *
 * A `fade` dips through black for its duration, which is what lets a chain of
 * scenes read as one continuous presentation. A `cut` is the historical
 * behaviour and adds no time: the next scene simply starts on its first frame.
 */
export interface MissionCinematicTransition {
  kind: MissionCinematicTransitionKind;
  /** Seconds the dip takes. Zero on a fade is treated as a cut. */
  durationSeconds: number;
}

/** Existing particle effects a cinematic beat may fire. */
export type MissionCinematicEffectKind = 'explosion' | 'smoke' | 'dust' | 'muzzle';

/** Staging actions an actor beat can ask the renderer to perform. */
export type MissionCinematicActorAction =
  | 'move'
  | 'turn'
  | 'animate'
  | 'fire'
  | 'enter'
  | 'leave'
  | 'appear'
  | 'disappear';

/**
 * One ordered timeline beat.
 *
 * A camera beat moves to a framing and holds it; a line beat shows a subtitle;
 * a notify beat raises the ordinary mission notice. An actor beat stages an
 * existing entity on the render layer only. All timing is in seconds of
 * presentation time, never simulation time.
 */
export type MissionCinematicStep =
  | {
      kind: 'camera';
      target: MissionCinematicTarget;
      /** Half-height of the orthographic view; defaults to the current zoom. */
      zoom?: number;
      /**
       * Orbit yaw around the focus, in degrees. 45 is the default isometric
       * view; 0 looks north along -Z. Omit to keep the current yaw.
       */
      rotationDegrees?: number;
      /** Seconds spent travelling to the framing; 0 cuts immediately. */
      durationSeconds: number;
      /** Seconds held on the framing after the move. */
      holdSeconds?: number;
      /** Follow an entity target while the beat runs. */
      track?: boolean;
      /** Screen-shake pulse when the beat starts, 0..1. */
      shake?: number;
      /** Interpolation; smooth defaults, linear is constant-rate, cut ignores duration. */
      ease?: 'smooth' | 'linear' | 'cut';
    }
  | {
      kind: 'line';
      speaker: string;
      text: string;
      /** Seconds the subtitle stays up. */
      durationSeconds: number;
      /** Silent beat before the next step. */
      pauseSeconds?: number;
      /** Optional portrait image path, relative to the site root. */
      portrait?: string;
      /** Optional voice clip path, played through the existing voice channel. */
      voice?: string;
      /** Render the line on the radio channel rather than as a scene caption. */
      radio?: boolean;
    }
  | {
      kind: 'notify';
      text: string;
      durationSeconds?: number;
      /** Optional kicker above the notice, e.g. a place or operation name. */
      heading?: string;
    }
  | {
      kind: 'effect';
      effect: MissionCinematicEffectKind;
      target: MissionCinematicTarget;
      scale?: number;
      durationSeconds?: number;
    }
  | {
      kind: 'actor';
      action: 'move';
      entity: string;
      /** Destination in tile coordinates. The simulation position never moves. */
      x: number;
      z: number;
      durationSeconds: number;
      ease?: 'smooth' | 'linear' | 'cut';
    }
  | {
      kind: 'actor';
      action: 'turn';
      entity: string;
      /** Final presentation heading in degrees, measured like the map facing. */
      facingDegrees: number;
      durationSeconds: number;
      ease?: 'smooth' | 'linear' | 'cut';
    }
  | {
      kind: 'actor';
      action: 'animate';
      entity: string;
      /** Procedural poses the renderer owns; there is no skeletal clip library. */
      pose: 'idle' | 'walk';
      durationSeconds: number;
    }
  | {
      kind: 'actor';
      action: 'fire';
      entity: string;
      target: MissionCinematicTarget;
      scale?: number;
      durationSeconds: number;
    }
  | {
      kind: 'actor';
      action: 'enter';
      entity: string;
      /** Authored structure key. The actor fades and moves to its exterior. */
      structure: string;
      durationSeconds: number;
    }
  | {
      kind: 'actor';
      action: 'leave';
      entity: string;
      structure: string;
      /** Destination in tile coordinates after leaving the structure. */
      x: number;
      z: number;
      durationSeconds: number;
    }
  | {
      kind: 'actor';
      action: 'appear' | 'disappear';
      entity: string;
      durationSeconds: number;
    }
  | {
      kind: 'sound';
      /** Existing synthesised or recorded cue name, never a new audio path. */
      cue: string;
      gain?: number;
      durationSeconds?: number;
    }
  | {
      kind: 'card';
      /** Large centred title, e.g. a chapter or a date. */
      heading: string;
      /** Optional line under the heading, e.g. a place. */
      subheading?: string;
      /** Optional short paragraph under the subheading. */
      body?: string;
      durationSeconds: number;
    }
  | {
      kind: 'music';
      /** Catalogue track id, never a file path. The saved playlist is untouched. */
      track: string;
      /** Seconds the beat holds before the next one; the cue plays on. */
      durationSeconds?: number;
    };

/**
 * One in-engine cinematic sequence.
 *
 * The document is data only. Playback lives in the presentation layer and
 * cannot call back into the mission or campaign state, so a malformed sequence
 * can never change what happened in a battle.
 */
export interface MissionCinematicDoc {
  id: string;
  kind: MissionCinematicContext;
  /** Whether the player may skip this scene. A separate skip-all preference is UI state. */
  skippable: boolean;
  /** Mission seconds at which an in-mission sequence becomes eligible. */
  atSeconds?: number;
  /** Ordered timeline. */
  steps: MissionCinematicStep[];
  /**
   * How the scene enters and leaves the frame. Omitted means a hard cut at both
   * edges, which is what every document authored before transitions did.
   */
  transition?: { in?: MissionCinematicTransition; out?: MissionCinematicTransition };
  /**
   * Legacy flat dialogue, folded into `steps` by the parser. Kept so an early
   * document still parses and so callers can read the lines without walking the
   * timeline.
   */
  dialogue: Array<{ speaker: string; line: string }>;
}

/** A campaign consequence written when a completed mission result is accepted. */
export interface MissionConsequenceDoc {
  id: string;
  /** Campaign variable the outcome writes. */
  key: string;
  value: MissionValue;
  description?: string;
}

/** Which named assets follow the player into later missions. */
export interface MissionCarryoverDoc {
  enabled: boolean;
  /** Authored entity keys eligible to carry over. */
  assets: string[];
}

/**
 * A complete mission document.
 *
 * List fields are required on an authored document so an export is self
 * contained, but the parser accepts an omitted list as empty: an early mission
 * with no triggers is valid data, not a malformed file.
 */
export interface MissionDoc {
  format: typeof MISSION_FORMAT;
  version: number;
  /** Stable mission identity. Distinct from the enclosing scenario's meta.id. */
  id: string;
  title: string;
  description: string;
  author?: string;
  campaign?: MissionCampaignRef;
  briefing: MissionBriefing;
  /** Optional victory/defeat prose for the debrief. */
  debrief?: MissionDebriefCopy;
  objectives: MissionObjectiveDoc[];
  variables: MissionVariableDoc[];
  regions: MissionRegionDoc[];
  triggers: MissionTriggerDoc[];
  aiGroups: MissionAiGroupDoc[];
  reinforcements: MissionReinforcementDoc[];
  entities: MissionEntityDoc[];
  cinematics: MissionCinematicDoc[];
  consequences: MissionConsequenceDoc[];
  carryover: MissionCarryoverDoc;
}

/* ------------------------------------------------------------------ */
/* Mission result                                                      */
/* ------------------------------------------------------------------ */

/** One objective as it stood when the mission ended. */
export interface MissionResultObjective {
  id: string;
  title: string;
  kind: MissionObjectiveKind;
  state: MissionObjectiveState;
}

/** A named authored entity and whether it survived the mission. */
export interface MissionResultEntity {
  key: string;
  name?: string;
  role: MissionEntityRole;
  /** Definition actually spawned for the key, when it was placed at all. */
  defId?: string;
  survived: boolean;
}

/**
 * One side's recorded statistics.
 *
 * These are the counters the simulation already maintains per player. They do
 * not distinguish losses by cause, and there is no reinforcement ledger, so the
 * result reports exactly these numbers and nothing inferred from them.
 */
export interface MissionResultStats {
  unitsBuilt: number;
  unitsLost: number;
  kills: number;
  buildingsBuilt: number;
  matsGathered: number;
}

/**
 * What actually happened in a finished mission.
 *
 * Captured once, by the authoritative simulation, at the moment the mission
 * reaches a terminal outcome. The campaign layer in a later stage consumes this
 * rather than recounting anything from the HUD.
 */
export interface MissionResult {
  missionId: string;
  outcome: MissionOutcome;
  /** Absolute simulation tick the result was captured at. */
  tick: number;
  /** Mission time in seconds, measured from the scenario's start tick. */
  elapsedSeconds: number;
  objectives: MissionResultObjective[];
  /** The local player's own counters. */
  friendly: MissionResultStats;
  /** Everything the opposing players recorded. */
  enemy: { unitsLost: number; kills: number };
  entities: MissionResultEntity[];
}

/** Cross-document facts a mission may be checked against. */
export interface MissionValidationContext {
  /** Map width in tiles, when the mission is validated inside a scenario. */
  width?: number;
  /** Map height in tiles, when the mission is validated inside a scenario. */
  height?: number;
  /** Authored placement keys available in the enclosing scenario. */
  entityKeys?: ReadonlySet<string>;
}

/** A structured mission validation finding, mirroring `ValidationIssue`. */
export interface MissionIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  /** Dotted path inside the mission document, e.g. `triggers[2].actions[0]`. */
  path: string;
}

/** Thrown when a mission document cannot be parsed or fails validation. */
export class MissionFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionFormatError';
  }
}
