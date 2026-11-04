/**
 * Campaign state (Stage S4).
 *
 * The campaign is the persistence layer between missions. It owns the commander
 * identity, the accepted mission record, campaign variables and the named
 * veteran roster; the active battle's `MissionRuntime` still owns the live
 * mission. Nothing here is a second simulation: accepting a captured
 * `MissionResult` is the only transaction that changes campaign progress.
 *
 * The save format is independent of the scenario and mission formats, so a
 * campaign save can be read against the current definitions without rewriting
 * every mission document.
 */
import type { MissionResult, MissionValue, MissionVariableType } from '../mission/types';

/** Save envelope. A campaign save is a set of runs plus the deck's selection. */
export const CAMPAIGN_SAVE_FORMAT = 'mca-campaign-save';

/**
 * Version 1 is the first authoritative campaign save. A newer file is refused
 * rather than read optimistically: a changed phase or veteran record can change
 * what a mission result means.
 */
export const CAMPAIGN_SAVE_VERSION = 1;

/** An authored campaign variable. Keys are stable and referenced by consequences. */
export interface CampaignVariableDoc {
  id: string;
  type: MissionVariableType;
  default: MissionValue;
  description?: string;
}

export type CommanderPronouns = 'she/her' | 'he/him' | 'they/them';

/**
 * The player's commander profile.
 *
 * Presentation only: it is read by briefings and campaign copy and never by the
 * simulation, so it cannot become a stealth combat modifier.
 */
export interface CommanderIdentity {
  name: string;
  callsign: string;
  background: string;
  pronouns?: CommanderPronouns;
}

export type CampaignVeteranRole = 'veteran' | 'asset';

/**
 * One persistent named individual.
 *
 * Only identity and service history are retained. A veteran is an ordinary
 * `rifle`/`medic`/`atgm` entity when deployed; there is no parallel stat block,
 * level or experience modifier.
 */
export interface CampaignVeteran {
  /** Stable campaign-level id, authored in the campaign roster. */
  id: string;
  name: string;
  defId: string;
  role: CampaignVeteranRole;
  /** Accepted operations this individual served in, in campaign order. */
  missions: string[];
}

/** The authored starting roster of a campaign. */
export interface CampaignRosterEntry {
  id: string;
  name: string;
  defId: string;
  role: CampaignVeteranRole;
}

/**
 * An authored slot for a persistent individual in one operation.
 *
 * The key must be unique inside the launched scenario. The campaign layer adds
 * the placement, the mission entity entry and the carryover reference when the
 * veteran is actually available, so an absent veteran leaves no dangling
 * reference in the mission document.
 */
export interface CampaignVeteranSlot {
  /** Authored placement key, unique inside the operation. */
  key: string;
  /** Roster id expected to fill this slot. */
  veteranId: string;
  /** Must match the roster entry's unit definition. */
  defId: string;
  /** Optional authored tile; otherwise the slot is placed near the player start. */
  x?: number;
  z?: number;
}

/** A veteran assigned to the mission that is currently running. */
export interface CampaignVeteranDeployment {
  key: string;
  veteranId: string;
}

export type CampaignPhase = 'briefing' | 'playing' | 'debrief' | 'complete';

/** One accepted operation. Legacy records migrated from the pre-S4 deck have no result. */
export interface CampaignMissionRecord {
  missionId: string;
  outcome: 'victory' | 'defeat';
  /** The authoritative result, when the operation was accepted in S4 or later. */
  result?: MissionResult;
  /** Veterans who were deployed, so their result entries can be re-read. */
  deployments?: CampaignVeteranDeployment[];
  /** True for a pre-S4 clear migrated from the old progress store. */
  legacy?: boolean;
}

/** The campaign as it stood immediately before the active mission launched. */
export interface CampaignSnapshot {
  commander: CommanderIdentity | null;
  currentMissionId: string;
  completed: CampaignMissionRecord[];
  variables: Record<string, MissionValue>;
  veterans: CampaignVeteran[];
}

/** A captured result waiting for the player to accept or retry. */
export interface CampaignPendingResult {
  missionId: string;
  result: MissionResult;
  deployments: CampaignVeteranDeployment[];
}

/**
 * Authoritative campaign state.
 *
 * `preMission` exists so a failed attempt can be rolled back exactly: the
 * veteran roster, variables, completed records and mission selection are the
 * snapshot, not a reconstruction.
 */
export interface CampaignState {
  campaignId: string;
  /** Definition version the run was started against. */
  definitionVersion: number;
  /** Null only for a migrated legacy run whose commander has not been set yet. */
  commander: CommanderIdentity | null;
  phase: CampaignPhase;
  /** The operation to brief, play, debrief or the final operation when complete. */
  currentMissionId: string;
  /** Accepted operations, in campaign order. */
  completed: CampaignMissionRecord[];
  variables: Record<string, MissionValue>;
  veterans: CampaignVeteran[];
  /** Snapshot taken at launch; null while the campaign is between missions. */
  preMission: CampaignSnapshot | null;
  /** Veterans assigned to the active mission. */
  deployments: CampaignVeteranDeployment[];
  /** Terminal result awaiting acceptance; null outside the debrief phase. */
  pending: CampaignPendingResult | null;
}

export interface CampaignSelection {
  campaignId: string;
  missionId: string;
}

export interface CampaignSaveDoc {
  format: typeof CAMPAIGN_SAVE_FORMAT;
  version: number;
  /** Campaign id -> its authoritative run. */
  runs: Record<string, CampaignState>;
  /** The operation the deck reopens on. */
  lastSelection?: CampaignSelection;
}

export type CampaignIssueSeverity = 'error' | 'warning' | 'info';

/** A structured campaign finding, mirroring the mission and scenario issue shape. */
export interface CampaignIssue {
  severity: CampaignIssueSeverity;
  code: string;
  message: string;
  /** Dotted path inside the definition (e.g. `missions[2].mission.triggers[0]`). */
  path: string;
}

export class CampaignFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignFormatError';
  }
}

export type CampaignErrorCode =
  | 'no-commander'
  | 'invalid-identity'
  | 'unknown-campaign'
  | 'unknown-mission'
  | 'mission-not-current'
  | 'phase-mismatch'
  | 'already-accepted'
  | 'no-pending-result'
  | 'result-mismatch'
  | 'no-restore-point'
  | 'veteran-unavailable'
  | 'definition-mismatch';

/** Thrown when a campaign transition is asked for in the wrong state. */
export class CampaignStateError extends Error {
  readonly code: CampaignErrorCode;

  constructor(code: CampaignErrorCode, message: string) {
    super(message);
    this.name = 'CampaignStateError';
    this.code = code;
  }
}
