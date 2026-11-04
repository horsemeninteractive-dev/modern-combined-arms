/**
 * Campaign public surface (Stage S4).
 *
 * The app, the deck and the campaign tests all reach campaign code here. The
 * mission document and simulation remain the shared runtime; this module only
 * owns progress between missions.
 */
export {
  CAMPAIGN_SAVE_FORMAT,
  CAMPAIGN_SAVE_VERSION,
  CampaignFormatError,
  CampaignStateError,
  type CampaignErrorCode,
  type CampaignIssue,
  type CampaignIssueSeverity,
  type CampaignMissionRecord,
  type CampaignPendingResult,
  type CampaignPhase,
  type CampaignRosterEntry,
  type CampaignSaveDoc,
  type CampaignSelection,
  type CampaignSnapshot,
  type CampaignState,
  type CampaignVariableDoc,
  type CampaignVeteran,
  type CampaignVeteranDeployment,
  type CampaignVeteranRole,
  type CampaignVeteranSlot,
  type CommanderIdentity,
  type CommanderPronouns,
} from './types';
export {
  COMMANDER_BACKGROUND_MAX,
  COMMANDER_CALLSIGN_MAX,
  COMMANDER_NAME_MAX,
  commanderIdentityIssues,
  defaultCommanderIdentity,
  isCommanderPronouns,
  normaliseCommanderIdentity,
} from './identity';
export {
  acceptCampaignResult,
  campaignDeploymentsFor,
  campaignMissionDoc,
  campaignProgressOf,
  createCampaignState,
  deployedVeterans,
  isCampaignPhase,
  isKnownUnitDef,
  launchCampaignMission,
  nextMissionOf,
  normalizeCampaignState,
  retryCampaignMission,
  serializeCampaignSave,
  submitCampaignResult,
} from './state';
export {
  emptyCampaignSave,
  migrateLegacyCampaignProgress,
  parseCampaignSave,
} from './store';
export {
  campaignResultOutlook,
  type CampaignOutlook,
  type CampaignOutlookConsequence,
  type CampaignOutlookVeteran,
} from './outlook';
export {
  buildCampaignScenario,
  campaignScenarioDeployments,
  type CampaignScenarioInput,
} from './scenario';
export {
  campaignDefinitionIsPlayable,
  missionVeteranSlots,
  validateCampaignDefinition,
  validateCampaignState,
  type CampaignDefinitionContext,
} from './validate';
