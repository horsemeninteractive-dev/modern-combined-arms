/**
 * Browser client for the account API.
 *
 * Same-origin by design (`/api/account`), so the session cookie is sent and set
 * by the browser and never appears in JavaScript. The client validates shape
 * only: it is not a security boundary, and every rule it applies is repeated on
 * the server.
 */
import type {
  CareerMatchInput,
  CareerMatchRecord,
  CareerTotals,
  CareerMode,
  CareerOutcome,
  CareerProvenance,
} from './career';
import { EMPTY_CAREER, isCareerRecordDifficulty, type CareerViewData } from './career';
import type { RankSpec } from './ranks';
import type { CareerStats, NationLine, StatBlock } from './stats';
import type {
  AchievementCategory,
  AchievementTier,
  AchievementView,
  AwardType,
} from './achievements';
import type { LevelStanding } from './levels';
import type { ProviderId } from './types';
import type { GuestMigrationRequest } from './guest';

export interface AccountIdentityView {
  provider: ProviderId;
  displayName: string | null;
  linkedAt: number;
}

export interface AccountView {
  id: string;
  createdAt: number;
  status: string;
  lastAuthAt: number | null;
  displayName: string | null;
  avatarUrl: string | null;
  identities: AccountIdentityView[];
}

export interface AccountState {
  authenticated: boolean;
  account: AccountView | null;
  providers: ProviderId[];
  /** The player's presentable identity, once signed in. */
  identity: IdentityView | null;
}

function asIdentity(value: unknown): IdentityView | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.callsign !== 'string' || !record.callsign) return null;
  return {
    callsign: record.callsign.slice(0, 32),
    avatar: typeof record.avatar === 'string' ? record.avatar : 'insignia',
  };
}

function asStatBlock(value: unknown): StatBlock | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const optionalRate = typeof row.winRate === 'number' ? row.winRate : null;
  return {
    matches: num(row.matches),
    victories: num(row.victories),
    defeats: num(row.defeats),
    draws: num(row.draws),
    outbreakMatches: num(row.outbreakMatches),
    winRate: optionalRate,
    playSeconds: num(row.playSeconds),
    xp: num(row.xp),
    unitsDestroyed: num(row.unitsDestroyed),
    unitsLost: num(row.unitsLost),
    structuresDestroyed: num(row.structuresDestroyed),
    structuresLost: num(row.structuresLost),
    structuresBuilt: num(row.structuresBuilt),
    sitesCaptured: num(row.sitesCaptured),
    superweaponsUsed: num(row.superweaponsUsed),
    objectivesCompleted: num(row.objectivesCompleted),
  };
}

function asCareerStats(value: unknown): CareerStats | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const overall = asStatBlock(row.overall);
  if (!overall) return null;
  const modes = (typeof row.modes === 'object' && row.modes !== null ? row.modes : {}) as Record<
    string,
    unknown
  >;
  const nationsRaw = Array.isArray(row.nations) ? row.nations : [];
  const nations: NationLine[] = [];
  for (const entry of nationsRaw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const nation = (entry as Record<string, unknown>).nation;
    const block = asStatBlock(entry);
    if (typeof nation === 'string' && block) nations.push({ nation, ...block });
  }
  const fallback = asStatBlock({}) as StatBlock;
  return {
    overall,
    modes: {
      campaign: asStatBlock(modes.campaign) ?? fallback,
      skirmish: asStatBlock(modes.skirmish) ?? fallback,
      multiplayer: asStatBlock(modes.multiplayer) ?? fallback,
      outbreak: asStatBlock(modes.outbreak) ?? fallback,
    },
    nations,
  };
}

export type AccountAuthOutcome = 'signed-in' | 'linked' | 'error';

export interface CareerNextRank {
  id: string;
  name: string;
  grade: string;
  xpRequired: number;
}

export interface IdentityView {
  callsign: string;
  avatar: string;
}

/** The career block: totals, standing and the most recent service record. */
export interface CareerCampaignView {
  campaignId: string;
  completedAt: number;
}

export interface CareerView extends CareerViewData {
  /** Grouped statistics. Absent on a guest ledger, which has no breakdown. */
  stats?: CareerStats | null;
  /** Earned and in-progress commendations. */
  achievements?: AchievementView[];
  /** Full campaigns recorded from validated campaign-match results. */
  campaigns?: CareerCampaignView[];
  identity?: IdentityView | null;
}

export interface AwardView {
  id: string;
  achievementId: string;
  name: string;
  description: string;
  type: AwardType;
  visual: string;
  priority: number;
  hidden: boolean;
  nation: string | null;
  campaign: string | null;
  mode: CareerMode | null;
}

export interface AchievementSummary {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  commendation: string;
  reward: { kind: 'cosmetic'; cosmeticId: string } | null;
  award?: AwardView | null;
}

export interface CareerRewards {
  achievements: AchievementSummary[];
  levelBefore: number;
  levelAfter: number;
  levelUp: boolean;
  rankBefore: RankSpec | null;
  rankAfter: RankSpec | null;
  promoted: boolean;
}

/** One row of the paged service record. */
export interface MatchHistoryItem {
  match: CareerMatchRecord;
  report: MatchReportView | null;
  achievements?: AchievementSummary[];
}

export interface MatchReportView {
  mapId: string | null;
  opponentCallsign: string | null;
  opponentNation: string | null;
  structuresDestroyed: number;
  structuresLost: number;
  structuresBuilt: number;
  sitesCaptured: number;
  superweaponsUsed: number;
  objectivesCompleted: number;
  rewardStatus: 'awarded' | 'capped' | 'ineligible' | 'local';
  xpBefore: number;
  xpAfter: number;
  breakdown: {
    version: number;
    status: string;
    base: number;
    completion: number;
    duration: number;
    objectives: number;
    performance: number;
    outcomeFactor: number;
    subtotal: number;
    xp: number;
    reason: string | null;
  } | null;
}

/** The post-match career outcome: recorded, or still being synchronised. */
export type MatchResultView =
  | { status: 'pending'; matchRef: string }
  | {
      status: 'recorded';
      matchRef: string;
      match: CareerMatchRecord;
      award: {
        xp: number;
        status: string;
        reason: string | null;
        breakdown: MatchReportView['breakdown'];
        xpBefore: number;
        xpAfter: number;
        rankBefore: RankSpec | null;
        rankAfter: RankSpec | null;
        promoted: boolean;
      };
      achievements: AchievementSummary[];
    };

export interface PublicPlayerView {
  callsign: string;
  avatar: string;
  rank: RankSpec | null;
  xp: number;
  progress: number;
  matches: number;
  winRate: number | null;
  playSeconds: number;
  multiplayer: StatBlock | null;
  nations: NationLine[];
}

export interface CareerRecordResult {
  recorded: boolean;
  award: number;
  rewards: CareerRewards | null;
  career: CareerView;
}

export interface GuestMigrationResult {
  status: 'migrated' | 'already-migrated';
  importedXp: number;
  career: CareerView | null;
}

const MODES: readonly CareerMode[] = ['campaign', 'skirmish', 'multiplayer', 'outbreak'];
const OUTCOMES: readonly CareerOutcome[] = ['victory', 'defeat', 'draw'];
const PROVENANCES: readonly CareerProvenance[] = ['local', 'guest', 'authoritative'];

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asTotals(value: unknown): CareerTotals {
  if (typeof value !== 'object' || value === null) return { ...EMPTY_CAREER };
  const row = value as Record<string, unknown>;
  return {
    xp: num(row.xp),
    matches: num(row.matches),
    victories: num(row.victories),
    defeats: num(row.defeats),
    draws: num(row.draws),
    outbreakMatches: num(row.outbreakMatches),
    kills: num(row.kills),
    unitsLost: num(row.unitsLost),
    playSeconds: num(row.playSeconds),
  };
}

function asMatch(value: unknown): CareerMatchRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.ref !== 'string') return null;
  return {
    ref: row.ref,
    mode: MODES.includes(row.mode as CareerMode) ? (row.mode as CareerMode) : 'skirmish',
    outcome: OUTCOMES.includes(row.outcome as CareerOutcome) ? (row.outcome as CareerOutcome) : 'defeat',
    difficulty: isCareerRecordDifficulty(row.difficulty) ? row.difficulty : 'veteran',
    durationSeconds: num(row.durationSeconds),
    nation: typeof row.nation === 'string' ? row.nation : null,
    kills: num(row.kills),
    unitsLost: num(row.unitsLost),
    xp: num(row.xp),
    provenance: PROVENANCES.includes(row.provenance as CareerProvenance)
      ? (row.provenance as CareerProvenance)
      : 'local',
    recordedAt: num(row.recordedAt),
  };
}

function asRank(value: unknown): RankSpec | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  const insignia = (row.insignia ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    name: row.name,
    abbreviation: typeof row.abbreviation === 'string' ? row.abbreviation : '',
    grade: typeof row.grade === 'string' ? row.grade : '',
    tier: (typeof row.tier === 'string' ? row.tier : 'enlisted') as RankSpec['tier'],
    threshold: num(row.threshold),
    insignia: {
      ...(typeof insignia.chevrons === 'number' ? { chevrons: insignia.chevrons } : {}),
      ...(typeof insignia.rockers === 'number' ? { rockers: insignia.rockers } : {}),
      ...(typeof insignia.bars === 'number' ? { bars: insignia.bars } : {}),
      ...(typeof insignia.stars === 'number' ? { stars: insignia.stars } : {}),
      ...(insignia.wreath === true ? { wreath: true } : {}),
    },
  };
}

/** Shape check only: the server remains the authority on every value. */
export function asCareerView(value: unknown): CareerView | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const rank = asRank(row.rank);
  if (!rank) return null;
  const totals = asTotals(row.totals);
  const nextRaw = row.next;
  const next =
    typeof nextRaw === 'object' && nextRaw !== null
      ? (nextRaw as Record<string, unknown>)
      : null;
  return {
    totals,
    rank: { ...rank, threshold: rank.threshold || 0 },
    next:
      next && typeof next.id === 'string'
        ? {
            id: next.id,
            name: typeof next.name === 'string' ? next.name : String(next.id),
            grade: typeof next.grade === 'string' ? next.grade : '',
            xpRequired: num(next.xpRequired),
          }
        : null,
    xpInto: num(row.xpInto),
    xpSpan: typeof row.xpSpan === 'number' ? row.xpSpan : null,
    progress: Math.max(0, Math.min(1, num(row.progress))),
    level: asLevel(row.level) ?? {
      level: { number: 1, threshold: 0 },
      xpInto: 0,
      xpSpan: null,
      next: null,
      progress: 0,
    },
    matches: Array.isArray(row.matches)
      ? row.matches.map(asMatch).filter((match): match is CareerMatchRecord => match !== null)
      : [],
    stats: asCareerStats(row.stats),
    achievements: Array.isArray(row.achievements)
      ? row.achievements
          .map(asAchievement)
          .filter((entry): entry is AchievementView => entry !== null)
      : [],
    campaigns: Array.isArray(row.campaigns)
      ? row.campaigns
          .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
          .filter((entry) => typeof entry.campaignId === 'string')
          .map((entry) => ({
            campaignId: String(entry.campaignId),
            completedAt: num(entry.completedAt),
          }))
      : [],
    identity: asIdentity(row.identity),
  };
}

function asLevel(value: unknown): LevelStanding | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const level = (typeof row.level === 'object' && row.level !== null ? row.level : {}) as Record<
    string,
    unknown
  >;
  const nextRow = (typeof row.next === 'object' && row.next !== null ? row.next : null) as Record<
    string,
    unknown
  > | null;
  const number = num(level.number, 1);
  const threshold = num(level.threshold);
  return {
    level: { number, threshold },
    xpInto: num(row.xpInto),
    xpSpan: typeof row.xpSpan === 'number' ? row.xpSpan : null,
    next: nextRow
      ? { number: num(nextRow.number, number + 1), threshold: num(nextRow.threshold) }
      : null,
    progress: Math.max(0, Math.min(1, num(row.progress))),
  };
}

function asAward(value: unknown): AwardView | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    achievementId: typeof row.achievementId === 'string' ? row.achievementId : '',
    name: typeof row.name === 'string' ? row.name : row.id,
    description: typeof row.description === 'string' ? row.description : '',
    type:
      row.type === 'medal' || row.type === 'ribbon' || row.type === 'commendation'
        ? row.type
        : 'commendation',
    visual: typeof row.visual === 'string' ? row.visual : '',
    priority: num(row.priority, 100),
    hidden: row.hidden === true,
    nation: typeof row.nation === 'string' ? row.nation : null,
    campaign: typeof row.campaign === 'string' ? row.campaign : null,
    mode: MODES.includes(row.mode as CareerMode) ? (row.mode as CareerMode) : null,
  };
}

function asAchievement(value: unknown): AchievementView | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  const reward =
    typeof row.reward === 'object' && row.reward !== null
      ? (row.reward as Record<string, unknown>)
      : null;
  return {
    id: row.id,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : '',
    category: (typeof row.category === 'string' ? row.category : 'career') as AchievementCategory,
    tier: (typeof row.tier === 'string' ? row.tier : 'bronze') as AchievementTier,
    commendation: typeof row.commendation === 'string' ? row.commendation : row.name,
    hidden: row.hidden === true,
    reward:
      reward && reward.kind === 'cosmetic' && typeof reward.cosmeticId === 'string'
        ? { kind: 'cosmetic', cosmeticId: reward.cosmeticId }
        : null,
    award: asAward(row.award),
    scope: row.scope === 'campaign' ? 'campaign' : 'account',
    mode: typeof row.mode === 'string' ? (row.mode as AchievementView['mode']) : null,
    nation: typeof row.nation === 'string' ? row.nation : null,
    campaign: typeof row.campaign === 'string' ? row.campaign : null,
    order: num(row.order, 100),
    awardedAt: typeof row.awardedAt === 'number' ? row.awardedAt : null,
    progress: num(row.progress),
    target: Math.max(1, num(row.target, 1)),
    complete: row.complete === true,
  };
}

function asAchievementSummary(value: unknown): AchievementSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string') return null;
  const reward =
    typeof row.reward === 'object' && row.reward !== null
      ? (row.reward as Record<string, unknown>)
      : null;
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : row.id,
    description: typeof row.description === 'string' ? row.description : '',
    category: (typeof row.category === 'string' ? row.category : 'career') as AchievementCategory,
    tier: (typeof row.tier === 'string' ? row.tier : 'bronze') as AchievementTier,
    commendation: typeof row.commendation === 'string' ? row.commendation : row.id,
    reward:
      reward && reward.kind === 'cosmetic' && typeof reward.cosmeticId === 'string'
        ? { kind: 'cosmetic', cosmeticId: reward.cosmeticId }
        : null,
    award: asAward(row.award),
  };
}

function asCareerRewards(value: unknown): CareerRewards | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  return {
    achievements: Array.isArray(row.achievements)
      ? row.achievements
          .map(asAchievementSummary)
          .filter((entry): entry is AchievementSummary => entry !== null)
      : [],
    levelBefore: num(row.levelBefore, 1),
    levelAfter: num(row.levelAfter, 1),
    levelUp: row.levelUp === true,
    rankBefore: asRank(row.rankBefore),
    rankAfter: asRank(row.rankAfter),
    promoted: row.promoted === true,
  };
}

function asReport(value: unknown): MatchReportView | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const status = row.rewardStatus;
  return {
    mapId: typeof row.mapId === 'string' ? row.mapId : null,
    opponentCallsign: typeof row.opponentCallsign === 'string' ? row.opponentCallsign : null,
    opponentNation: typeof row.opponentNation === 'string' ? row.opponentNation : null,
    structuresDestroyed: num(row.structuresDestroyed),
    structuresLost: num(row.structuresLost),
    structuresBuilt: num(row.structuresBuilt),
    sitesCaptured: num(row.sitesCaptured),
    superweaponsUsed: num(row.superweaponsUsed),
    objectivesCompleted: num(row.objectivesCompleted),
    rewardStatus:
      status === 'capped' || status === 'ineligible' || status === 'local' ? status : 'awarded',
    xpBefore: num(row.xpBefore),
    xpAfter: num(row.xpAfter),
    breakdown:
      typeof row.breakdown === 'object' && row.breakdown !== null
        ? (row.breakdown as MatchReportView['breakdown'])
        : null,
  };
}

export class AccountApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'AccountApiError';
    this.code = code;
    this.status = status;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function asAccount(value: unknown): AccountView | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string') return null;
  const identities = Array.isArray(record.identities)
    ? record.identities
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((item) => ({
          provider: item.provider === 'discord' ? ('discord' as const) : ('google' as const),
          displayName: typeof item.displayName === 'string' ? item.displayName : null,
          linkedAt: typeof item.linkedAt === 'number' ? item.linkedAt : 0,
        }))
    : [];
  return {
    id: record.id,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    status: typeof record.status === 'string' ? record.status : 'active',
    lastAuthAt: typeof record.lastAuthAt === 'number' ? record.lastAuthAt : null,
    displayName: typeof record.displayName === 'string' ? record.displayName : null,
    avatarUrl: typeof record.avatarUrl === 'string' ? record.avatarUrl : null,
    identities,
  };
}

function asProviders(value: unknown): ProviderId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ProviderId => item === 'google' || item === 'discord');
}

import { parseFlagSyncDocument, type FlagSyncDocument } from '../identity/flagSync';
import {
  parseOutbreakBoard,
  type OutbreakBoard,
  type OutbreakBoardDifficulty,
  type OutbreakBoardMode,
  type OutbreakRunInput,
} from './outbreakBoard';

export class HttpAccountApi {
  private readonly base: string;
  private readonly fetchImpl: FetchLike;

  constructor(base = '/api/account', fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
    this.base = base.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new AccountApiError('network', 'The account service could not be reached.', 0);
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    if (!response.ok || body.ok === false) {
      const error = (body.error ?? {}) as Record<string, unknown>;
      throw new AccountApiError(
        typeof error.code === 'string' ? error.code : 'server-error',
        typeof error.message === 'string' ? error.message : 'The account service refused that request.',
        response.status,
      );
    }
    return body;
  }

  async state(): Promise<AccountState> {
    const body = await this.request('/me');
    return {
      authenticated: body.authenticated === true,
      account: asAccount(body.account),
      providers: asProviders(body.providers),
      identity: asIdentity(body.identity),
    };
  }

  /** One page of the service record, newest first. */
  async history(offset = 0, limit = 20): Promise<{ items: MatchHistoryItem[]; hasMore: boolean }> {
    const body = await this.request(`/career/matches?limit=${limit}&offset=${offset}`);
    const items: MatchHistoryItem[] = [];
    for (const entry of Array.isArray(body.items) ? body.items : []) {
      if (typeof entry !== 'object' || entry === null) continue;
      const match = asMatch((entry as Record<string, unknown>).match);
      if (!match) continue;
      const rawAchievements = (entry as Record<string, unknown>).achievements;
      items.push({
        match,
        report: asReport((entry as Record<string, unknown>).report),
        achievements: Array.isArray(rawAchievements)
          ? rawAchievements
              .map(asAchievementSummary)
              .filter((award): award is AchievementSummary => award !== null)
          : [],
      });
    }
    const page = (typeof body.page === 'object' && body.page !== null ? body.page : {}) as Record<
      string,
      unknown
    >;
    return { items, hasMore: page.hasMore === true };
  }

  /**
   * The career outcome of one match. `pending` is a real answer, not an error:
   * the room reports a result after the scoreboard is already on screen.
   */
  async matchResult(ref: string): Promise<MatchResultView> {
    const body = await this.request(`/career/results/${encodeURIComponent(ref)}`);
    if (body.status !== 'recorded') return { status: 'pending', matchRef: ref };
    const match = asMatch(body.match);
    const award = (typeof body.award === 'object' && body.award !== null ? body.award : {}) as Record<
      string,
      unknown
    >;
    if (!match) return { status: 'pending', matchRef: ref };
    return {
      status: 'recorded',
      matchRef: ref,
      match,
      award: {
        xp: num(award.xp),
        status: typeof award.status === 'string' ? award.status : 'awarded',
        reason: typeof award.reason === 'string' ? award.reason : null,
        breakdown: asReport({ rewardStatus: award.status, breakdown: award.breakdown })?.breakdown ?? null,
        xpBefore: num(award.xpBefore),
        xpAfter: num(award.xpAfter),
        rankBefore: asRank(award.rankBefore),
        rankAfter: asRank(award.rankAfter),
        promoted: award.promoted === true,
      },
      achievements: Array.isArray(body.achievements)
        ? body.achievements
            .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
            .map((entry) => asAchievementSummary(entry))
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        : [],
    };
  }

  async updateIdentity(patch: { callsign?: string; avatar?: string }): Promise<IdentityView> {
    const body = await this.request('/identity', {
      method: 'POST',
      body: JSON.stringify(patch),
    });
    const identity = asIdentity(body.identity);
    if (!identity) throw new AccountApiError('server-error', 'The identity reply was malformed.', 500);
    return identity;
  }

  /** Saved command flags, active design and equipped cosmetics. */
  async flags(): Promise<FlagSyncDocument> {
    const body = await this.request('/flags');
    return parseFlagSyncDocument(body.flags, Date.now());
  }

  /** Replace the account's flag document; `expectedRevision` guards staleness. */
  async saveFlags(document: Record<string, unknown>): Promise<FlagSyncDocument> {
    const body = await this.request('/flags', {
      method: 'POST',
      body: JSON.stringify(document),
    });
    return parseFlagSyncDocument(body.flags, Date.now());
  }

  /** A limited public profile, addressed by callsign. */
  async publicProfile(callsign: string): Promise<PublicPlayerView> {
    const body = await this.request(`/players/${encodeURIComponent(callsign)}`);
    const player = (typeof body.player === 'object' && body.player !== null ? body.player : {}) as Record<
      string,
      unknown
    >;
    const nations: NationLine[] = [];
    for (const entry of Array.isArray(player.nations) ? player.nations : []) {
      if (typeof entry !== 'object' || entry === null) continue;
      const nation = (entry as Record<string, unknown>).nation;
      const block = asStatBlock(entry);
      if (typeof nation === 'string' && block) nations.push({ nation, ...block });
    }
    return {
      callsign: typeof player.callsign === 'string' ? player.callsign : callsign,
      avatar: typeof player.avatar === 'string' ? player.avatar : 'insignia',
      rank: asRank(player.rank),
      xp: num(player.xp),
      progress: Math.max(0, Math.min(1, num(player.progress))),
      matches: num(player.matches),
      winRate: typeof player.winRate === 'number' ? player.winRate : null,
      playSeconds: num(player.playSeconds),
      multiplayer: asStatBlock(player.multiplayer),
      nations,
    };
  }

  /** A full-page navigation, not a fetch: the provider sets its own cookies. */
  signInUrl(provider: ProviderId): string {
    return `${this.base}/auth/${provider}/start`;
  }

  linkUrl(provider: ProviderId): string {
    return `${this.base}/auth/${provider}/start?mode=link`;
  }

  async logout(): Promise<void> {
    await this.request('/logout', { method: 'POST' });
  }

  async revokeAll(): Promise<number> {
    const body = await this.request('/sessions/revoke-all', { method: 'POST' });
    return typeof body.revoked === 'number' ? body.revoked : 0;
  }

  async unlink(provider: ProviderId): Promise<void> {
    await this.request(`/providers/${provider}/unlink`, { method: 'POST' });
  }

  async migrateGuest(
    request: GuestMigrationRequest & { career?: CareerMatchInput[] },
  ): Promise<GuestMigrationResult> {
    const body = await this.request('/migrate/guest', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return {
      status: body.status === 'already-migrated' ? 'already-migrated' : 'migrated',
      importedXp: num(body.importedXp),
      career: asCareerView(body.career),
    };
  }

  /** The signed-in career. Throws `unauthorized` for a guest, by design. */
  async career(): Promise<CareerView> {
    const body = await this.request('/career');
    const career = asCareerView(body.career);
    if (!career) throw new AccountApiError('server-error', 'The career record was malformed.', 500);
    return career;
  }

  async recordMatch(
    input: CareerMatchInput,
    stats?: import('./career').CareerAccomplishments,
  ): Promise<CareerRecordResult> {
    const body = await this.request('/matches', {
      method: 'POST',
      body: JSON.stringify(stats ? { ...input, stats } : input),
    });
    const career = asCareerView(body.career);
    if (!career) throw new AccountApiError('server-error', 'The career record was malformed.', 500);
    const award = typeof body.award === 'object' && body.award !== null
      ? num((body.award as Record<string, unknown>).xp)
      : 0;
    return { recorded: body.recorded === true, award, rewards: asCareerRewards(body.rewards), career };
  }

  /** One public leaderboard; a session also brings the reader's own standing. */
  async outbreakBoard(
    mode: OutbreakBoardMode,
    difficulty: OutbreakBoardDifficulty,
    map: string,
  ): Promise<OutbreakBoard> {
    const body = await this.request(
      `/outbreak/leaderboard?mode=${mode}&difficulty=${difficulty}&map=${encodeURIComponent(map)}`,
    );
    const board = parseOutbreakBoard(body);
    if (!board) throw new AccountApiError('server-error', 'The leaderboard reply was malformed.', 500);
    return board;
  }

  /**
   * Post a finished run. The service keeps the better of the two, so this is
   * safe to call on every finish: `improved` says whether the board changed.
   */
  async submitOutbreakRun(
    run: OutbreakRunInput,
  ): Promise<{ improved: boolean; board: OutbreakBoard; award: number; capped: boolean }> {
    const body = await this.request('/outbreak/runs', {
      method: 'POST',
      body: JSON.stringify(run),
    });
    const board = parseOutbreakBoard(body);
    if (!board) throw new AccountApiError('server-error', 'The leaderboard reply was malformed.', 500);
    const awardBody =
      typeof body.award === 'object' && body.award !== null
        ? (body.award as Record<string, unknown>)
        : null;
    return {
      improved: body.improved === true,
      board,
      award: awardBody ? num(awardBody.xp) : 0,
      capped: awardBody?.capped === true,
    };
  }

  async multiplayerTicket(): Promise<{ ticket: string; expiresAt: number }> {
    const body = await this.request('/multiplayer/ticket', { method: 'POST' });
    if (typeof body.ticket !== 'string' || typeof body.expiresAt !== 'number') {
      throw new AccountApiError('server-error', 'The room identity ticket was malformed.', 500);
    }
    return { ticket: body.ticket, expiresAt: body.expiresAt };
  }
}

/**
 * Read and consume the `?auth=` result of an OAuth round trip.
 *
 * The parameters are removed from the address bar so a reload cannot replay the
 * notice, and the outcome is returned for the UI to report.
 */
export function takeAuthOutcome(location: Location, history: History): { outcome: AccountAuthOutcome; code: string | null } | null {
  const params = new URLSearchParams(location.search);
  const outcome = params.get('auth');
  if (outcome !== 'signed-in' && outcome !== 'linked' && outcome !== 'error') return null;
  const code = params.get('code');
  params.delete('auth');
  params.delete('code');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  return { outcome, code };
}
