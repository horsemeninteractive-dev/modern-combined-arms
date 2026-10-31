/**
 * Campaign prologue content. The screen is a command deck over the existing
 * simulation: every operation names one built-in theatre and a fixed pair of
 * nations, so a campaign battle cannot inherit a skirmish nation or colour
 * choice. Operations are linear: a victory clears the current operation and
 * opens the next one. The cleared set is persisted by the app shell, while the
 * battle itself remains a standalone scenario.
 */
export interface CampaignMission {
  id: string;
  /** Short operation code shared by the rail, dossier and brief. */
  code: string;
  name: string;
  /** Built-in theatre this operation deploys on. */
  mapId: string;
  /** One-line operation type shown under the rail entry. */
  focus: string;
  situation: string;
  threat: string;
  /** Authored objectives for this operation, primary first. */
  objectives: readonly string[];
  /** The campaign side's fixed command. */
  playerNationId: string;
  /** The fixed opposing command. */
  opponentNationId: string;
}

export interface CampaignDef {
  id: string;
  name: string;
  /** Coalition label, also the campaign's colour source. */
  coalition: string;
  /** Alliance id the campaign fights for. */
  allianceId: string;
  /** Coalition colour, used for the tab mark and the player's map callouts. */
  accent: string;
  lede: string;
  note: string;
  missions: readonly CampaignMission[];
}

export const CAMPAIGNS: readonly CampaignDef[] = [
  {
    id: 'baltic-line',
    name: 'The Baltic Line',
    coalition: 'Defender Coalition',
    allianceId: 'defender',
    accent: '#37b6e0',
    lede:
      'Three opening operations holding the Baltic approach: a beachhead on Kestrel Bay, the armour passes of Rust Valley, and the sea lane through the Kestrel Straits.',
    note: 'Fixed commands · blue versus red. Each operation is a standalone battle.',
    missions: [
      {
        id: 'baltic-01',
        code: 'BALTIC / 01',
        name: 'Kestrel Beachhead',
        mapId: 'island-assault',
        focus: 'Beachhead · Combined',
        situation:
          'The 11th Corps has dug into the ridge above Kestrel Bay. A Lithuanian battlegroup holds the western beachhead while coalition reinforcements race to land behind it.',
        threat: 'Entrenched armour, layered air defence and a coastal missile corvette.',
        objectives: [
          'Destroy the Russian Command Post above Kestrel Bay.',
          'Hold the western beachhead while reinforcements land.',
          'Capture the beachhead signals relay to fund the advance.',
          'Keep the Lithuanian Command Post operational.',
        ],
        playerNationId: 'lithuania',
        opponentNationId: 'russia',
      },
      {
        id: 'baltic-02',
        code: 'BALTIC / 02',
        name: 'Rust Pass',
        mapId: 'rust-valley',
        focus: 'Armour · Land',
        situation:
          'Polish armour must force the central massif before Belarus can close the two wide passes. Whoever holds the high ground controls the eastern plain.',
        threat: 'Massed armour and prepared anti-tank screens in the passes.',
        objectives: [
          'Destroy the Belarusian Command Post beyond the passes.',
          'Control both armour passes through the central massif.',
          'Take the forward supply depot to sustain the armour.',
          'Keep the Polish Command Post operational.',
        ],
        playerNationId: 'poland',
        opponentNationId: 'belarus',
      },
      {
        id: 'baltic-03',
        code: 'BALTIC / 03',
        name: 'Strait Denial',
        mapId: 'kestrel-straits',
        focus: 'Naval · Littoral',
        situation:
          "A UK task force is ordered to cut the expeditionary corps' sea lane through the Kestrel Straits and hold the islands that anchor it.",
        threat: 'Coastal missile corvettes, strike aircraft and fortified radar stations.',
        objectives: [
          'Destroy the Russian Command Post covering the straits.',
          'Cut the expeditionary corps sea lane through the Kestrel Straits.',
          'Take the island radar station to blind the coast.',
          'Keep the UK Command Post and shipyard operational.',
        ],
        playerNationId: 'uk',
        opponentNationId: 'russia',
      },
    ],
  },
  {
    id: 'eastern-corridor',
    name: 'The Eastern Corridor',
    coalition: 'Eastern Coalition',
    allianceId: 'eastern',
    accent: '#ef6a4a',
    lede:
      'Three opening operations driving the corridor to the coast: the Kestrel beachhead, the foundry city, and the strait blockade.',
    note: 'Fixed commands · red versus blue. Each operation is a standalone battle.',
    missions: [
      {
        id: 'corridor-01',
        code: 'CORRIDOR / 01',
        name: 'Red Beach',
        mapId: 'island-assault',
        focus: 'Assault · Combined',
        situation:
          'The corps has landed on Kestrel Bay and must clear the beachhead before coalition reinforcements arrive. The first hour decides whether the landing holds.',
        threat: 'Anti-tank screens, prepared defences and coalition air cover.',
        objectives: [
          'Destroy the Lithuanian Command Post above the beachhead.',
          'Clear the anti-tank screen before coalition reinforcements arrive.',
          'Capture the beachhead signals relay to fund the assault.',
          'Keep the Russian Command Post operational.',
        ],
        playerNationId: 'russia',
        opponentNationId: 'lithuania',
      },
      {
        id: 'corridor-02',
        code: 'CORRIDOR / 02',
        name: 'Foundry Pocket',
        mapId: 'foundry-district',
        focus: 'Urban · Land',
        situation:
          'Belarusian troops push into the foundry district, where Polish defenders hold the warehouses and the rail link. The city core is the decisive ground.',
        threat: 'Urban ambushes, fortified tenements and close-range armour.',
        objectives: [
          'Destroy the Polish Command Post in the foundry core.',
          'Clear the tenements and hold the central rail link.',
          'Garrison the warehouses and offices to hold the streets.',
          'Keep the Belarusian Command Post operational.',
        ],
        playerNationId: 'belarus',
        opponentNationId: 'poland',
      },
      {
        id: 'corridor-03',
        code: 'CORRIDOR / 03',
        name: 'Strait Blockade',
        mapId: 'kestrel-straits',
        focus: 'Blockade · Littoral',
        situation:
          "The coalition's island chain keeps the Kestrel Straits open. The corps must close the sea lane before the next convoy runs it.",
        threat: 'A coalition naval task group and long-range coastal fires.',
        objectives: [
          'Destroy the UK Command Post covering the straits.',
          'Break the coalition naval task group in the Kestrel Straits.',
          'Take the coastal radar station to cover the blockade.',
          'Keep the Russian Command Post and shipyard operational.',
        ],
        playerNationId: 'russia',
        opponentNationId: 'uk',
      },
    ],
  },
];

/** A campaign, or the first one for an unknown id. */
export function campaignById(id: string): CampaignDef {
  return CAMPAIGNS.find((campaign) => campaign.id === id) ?? CAMPAIGNS[0];
}

/** An operation in a campaign, or that campaign's first operation. */
export function missionById(campaign: CampaignDef, id: string): CampaignMission {
  return campaign.missions.find((mission) => mission.id === id) ?? campaign.missions[0];
}

/** The campaign and operation the player left open in the deck. */
export interface CampaignSelection {
  campaignId: string;
  missionId: string;
}

/**
 * The persistent half of a campaign: operations the player has finished and
 * the last operation they had open.
 *
 * A linear operation unlocks when the one before it is cleared, so the store
 * only needs the cleared set. It is intentionally small and JSON-only; the
 * campaign screen owns the browser storage around it.
 */
export interface CampaignProgress {
  version: 1;
  /** Campaign id -> cleared operation ids, in campaign order. */
  cleared: Record<string, string[]>;
  /** Restored on the next visit so the deck reopens where the player left it. */
  lastSelection?: CampaignSelection;
}

export function emptyCampaignProgress(): CampaignProgress {
  return { version: 1, cleared: {} };
}

export function isMissionCleared(
  progress: CampaignProgress,
  campaignId: string,
  missionId: string,
): boolean {
  return progress.cleared[campaignId]?.includes(missionId) ?? false;
}

/** The first operation is always open; later ones need the previous clear. */
export function isMissionUnlocked(
  progress: CampaignProgress,
  campaign: CampaignDef,
  missionId: string,
): boolean {
  const index = campaign.missions.findIndex((mission) => mission.id === missionId);
  if (index < 0) return false;
  if (index === 0) return true;
  return (
    isMissionCleared(progress, campaign.id, campaign.missions[index - 1].id) ||
    isMissionCleared(progress, campaign.id, missionId)
  );
}

export function clearedMissionCount(progress: CampaignProgress, campaign: CampaignDef): number {
  return campaign.missions.filter((mission) => isMissionCleared(progress, campaign.id, mission.id))
    .length;
}

/** The first open, unfinished operation; the last operation once all are clear. */
export function resumeMissionId(
  progress: CampaignProgress,
  campaign: CampaignDef,
): string {
  return (
    campaign.missions.find(
      (mission) =>
        isMissionUnlocked(progress, campaign, mission.id) &&
        !isMissionCleared(progress, campaign.id, mission.id),
    ) ?? campaign.missions[campaign.missions.length - 1]
  ).id;
}

/** The next operation in the authored order, or null at the end of a campaign. */
export function nextMissionId(campaign: CampaignDef, missionId: string): string | null {
  const index = campaign.missions.findIndex((mission) => mission.id === missionId);
  return index >= 0 ? (campaign.missions[index + 1]?.id ?? null) : null;
}

/** Remember the operation currently shown in the campaign deck. */
export function rememberCampaignSelection(
  progress: CampaignProgress,
  campaignId: string,
  missionId: string,
): CampaignProgress {
  const campaign = CAMPAIGNS.find((entry) => entry.id === campaignId);
  if (!campaign || !campaign.missions.some((mission) => mission.id === missionId)) {
    return progress;
  }
  if (
    progress.lastSelection?.campaignId === campaignId &&
    progress.lastSelection.missionId === missionId
  ) {
    return progress;
  }
  return { ...progress, lastSelection: { campaignId, missionId } };
}

/** Record a victory without duplicating a replay; unknown ids are ignored. */
export function recordCampaignVictory(
  progress: CampaignProgress,
  campaignId: string,
  missionId: string,
): CampaignProgress {
  const campaign = CAMPAIGNS.find((entry) => entry.id === campaignId);
  if (!campaign || !campaign.missions.some((mission) => mission.id === missionId)) {
    return progress;
  }
  if (isMissionCleared(progress, campaignId, missionId)) return progress;
  const cleared = new Set([...(progress.cleared[campaignId] ?? []), missionId]);
  return {
    version: 1,
    cleared: {
      ...progress.cleared,
      [campaignId]: campaign.missions
        .filter((mission) => cleared.has(mission.id))
        .map((mission) => mission.id),
    },
    ...(progress.lastSelection ? { lastSelection: progress.lastSelection } : {}),
  };
}

/** Reject stale, malformed or unknown progress instead of unlocking nonsense. */
export function parseCampaignProgress(raw: unknown): CampaignProgress {
  if (!raw || typeof raw !== 'object') return emptyCampaignProgress();
  const record = raw as { version?: unknown; cleared?: unknown; lastSelection?: unknown };
  if (record.version !== 1) return emptyCampaignProgress();
  const source = record.cleared;
  if (!source || typeof source !== 'object') return emptyCampaignProgress();
  const cleared: Record<string, string[]> = {};
  for (const campaign of CAMPAIGNS) {
    const entries = (source as Record<string, unknown>)[campaign.id];
    if (!Array.isArray(entries)) continue;
    const known = new Set(
      entries.filter((id): id is string => typeof id === 'string'),
    );
    const ordered = campaign.missions
      .filter((mission) => known.has(mission.id))
      .map((mission) => mission.id);
    if (ordered.length > 0) cleared[campaign.id] = ordered;
  }
  // A stale or hand-edited selection is dropped without discarding the
  // cleared set; the menu then falls back to the first unfinished operation.
  const selectionRaw = record.lastSelection;
  let lastSelection: CampaignSelection | undefined;
  if (selectionRaw && typeof selectionRaw === 'object') {
    const selection = selectionRaw as Record<string, unknown>;
    const campaignId = selection.campaignId;
    const missionId = selection.missionId;
    if (typeof campaignId === 'string' && typeof missionId === 'string') {
      const campaign = CAMPAIGNS.find((entry) => entry.id === campaignId);
      if (campaign?.missions.some((mission) => mission.id === missionId)) {
        lastSelection = { campaignId, missionId };
      }
    }
  }
  return { version: 1, cleared, ...(lastSelection ? { lastSelection } : {}) };
}
