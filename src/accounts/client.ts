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
  CareerDifficulty,
  CareerProvenance,
} from './career';
import { EMPTY_CAREER, type CareerViewData } from './career';
import type { RankSpec } from './ranks';
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
}

export type AccountAuthOutcome = 'signed-in' | 'linked' | 'error';

export interface CareerNextRank {
  id: string;
  name: string;
  grade: string;
  xpRequired: number;
}

/** The career block: totals, standing and the most recent service record. */
export type CareerView = CareerViewData;

export interface CareerRecordResult {
  recorded: boolean;
  award: number;
  career: CareerView;
}

export interface GuestMigrationResult {
  status: 'migrated' | 'already-migrated';
  importedXp: number;
  career: CareerView | null;
}

const MODES: readonly CareerMode[] = ['campaign', 'skirmish', 'multiplayer'];
const OUTCOMES: readonly CareerOutcome[] = ['victory', 'defeat', 'draw'];
const DIFFICULTIES: readonly CareerDifficulty[] = ['recruit', 'veteran', 'elite'];
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
    difficulty: DIFFICULTIES.includes(row.difficulty as CareerDifficulty)
      ? (row.difficulty as CareerDifficulty)
      : 'veteran',
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
    matches: Array.isArray(row.matches)
      ? row.matches.map(asMatch).filter((match): match is CareerMatchRecord => match !== null)
      : [],
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

  async recordMatch(input: CareerMatchInput): Promise<CareerRecordResult> {
    const body = await this.request('/matches', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const career = asCareerView(body.career);
    if (!career) throw new AccountApiError('server-error', 'The career record was malformed.', 500);
    const award = typeof body.award === 'object' && body.award !== null
      ? num((body.award as Record<string, unknown>).xp)
      : 0;
    return { recorded: body.recorded === true, award, career };
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
