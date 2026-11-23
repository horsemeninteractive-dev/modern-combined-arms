/**
 * In-memory account store.
 *
 * It is a faithful implementation of the same contract as D1, including the
 * uniqueness rules, so route, OAuth and migration behaviour is tested against
 * real semantics instead of a stub that always agrees with the caller. Tests use
 * it directly; it is not wired into the Worker.
 */
import type { CareerMatchRecord, CareerTotals } from './career';
import { EMPTY_CAREER, summariseCareer } from './career';
import type {
  AccountRecord,
  AccountStore,
  AchievementAwardWrite,
  CareerAchievementRecord,
  CareerCampaignRecord,
  CareerEntryWrite,
  GuestMigrationRecord,
  IdentityRecord,
  MatchReportRecord,
  MpResultPlayerRecord,
  NewIdentity,
  PlayerIdentityDocument,
  PlayerProfileRecord,
  ProviderId,
  SessionRecord,
  WriteOutcome,
} from './types';
import {
  compareOutbreakRuns,
  type OutbreakBoardDifficulty,
  type OutbreakBoardMode,
  type OutbreakRunRecord,
} from './outbreakBoard';
import type { StatGroupRow } from './stats';


export class MemoryAccountStore implements AccountStore {
  private accounts = new Map<string, AccountRecord>();
  private identityRows = new Map<string, IdentityRecord>();
  private sessions = new Map<string, SessionRecord>();
  private sessionsByHash = new Map<string, string>();
  private migrations = new Map<string, GuestMigrationRecord>();
  private limits = new Map<string, number>();
  private career = new Map<string, CareerMatchRecord[]>();
  private profiles = new Map<string, PlayerProfileRecord>();
  private reports = new Map<string, MatchReportRecord>();
  private audit = new Map<string, MpResultPlayerRecord>();
  private flagDocuments = new Map<string, PlayerIdentityDocument>();
  private achievements = new Map<string, CareerAchievementRecord>();
  private campaigns = new Map<string, CareerCampaignRecord>();
  private outbreakRuns = new Map<string, OutbreakRunRecord>();

  private outbreakKey(accountId: string, map: string, mode: string, difficulty: string): string {
    return `${accountId}:${map}:${mode}:${difficulty}`;
  }

  /** A stored run with the player's current callsign, never an account id outward. */
  private outbreakView(record: OutbreakRunRecord): OutbreakRunRecord {
    return {
      ...record,
      nations: [...record.nations],
      callsign: this.profiles.get(record.accountId)?.callsign ?? record.callsign,
    };
  }

  /** Test hook: change an account's status without going through a route. */
  setStatus(accountId: string, status: AccountRecord['status']): void {
    const account = this.accounts.get(accountId);
    if (account) account.status = status;
  }

  async createAccount(input: { id: string; now: number }): Promise<void> {
    if (this.accounts.has(input.id)) throw new Error('account id already exists');
    this.accounts.set(input.id, { id: input.id, createdAt: input.now, status: 'active', lastAuthAt: null });
  }

  async account(id: string): Promise<AccountRecord | null> {
    const account = this.accounts.get(id);
    return account ? { ...account } : null;
  }

  async touchAccountAuth(id: string, now: number): Promise<void> {
    const account = this.accounts.get(id);
    if (account) account.lastAuthAt = now;
  }

  async attachIdentity(identity: NewIdentity): Promise<WriteOutcome> {
    const key = `${identity.provider}:${identity.subject}`;
    if (this.identityRows.has(key)) return 'conflict';
    this.identityRows.set(key, {
      accountId: identity.accountId,
      provider: identity.provider,
      subject: identity.subject,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      linkedAt: identity.now,
    });
    return 'ok';
  }

  async identity(provider: ProviderId, subject: string): Promise<IdentityRecord | null> {
    const identity = this.identityRows.get(`${provider}:${subject}`);
    return identity ? { ...identity } : null;
  }

  async identities(accountId: string): Promise<IdentityRecord[]> {
    return [...this.identityRows.values()]
      .filter((identity) => identity.accountId === accountId)
      .sort((left, right) => left.linkedAt - right.linkedAt || left.provider.localeCompare(right.provider))
      .map((identity) => ({ ...identity }));
  }

  async detachIdentity(accountId: string, provider: ProviderId): Promise<boolean> {
    for (const [key, identity] of this.identityRows) {
      if (identity.accountId === accountId && identity.provider === provider) {
        this.identityRows.delete(key);
        return true;
      }
    }
    return false;
  }

  async createSession(session: {
    id: string;
    accountId: string;
    tokenHash: string;
    createdAt: number;
    expiresAt: number;
  }): Promise<void> {
    if (this.sessionsByHash.has(session.tokenHash)) throw new Error('session token already stored');
    const record: SessionRecord = {
      id: session.id,
      accountId: session.accountId,
      tokenHash: session.tokenHash,
      createdAt: session.createdAt,
      lastSeenAt: session.createdAt,
      expiresAt: session.expiresAt,
      revokedAt: null,
    };
    this.sessions.set(session.id, record);
    this.sessionsByHash.set(session.tokenHash, session.id);
  }

  async sessionByHash(tokenHash: string): Promise<SessionRecord | null> {
    const id = this.sessionsByHash.get(tokenHash);
    const session = id ? this.sessions.get(id) : undefined;
    return session ? { ...session } : null;
  }

  async touchSession(id: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    session.lastSeenAt = lastSeenAt;
    session.expiresAt = expiresAt;
  }

  async revokeSession(id: string, now: number): Promise<void> {
    const session = this.sessions.get(id);
    if (session && session.revokedAt === null) session.revokedAt = now;
  }

  async revokeAllSessions(accountId: string, now: number): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.accountId === accountId && session.revokedAt === null) {
        session.revokedAt = now;
        count++;
      }
    }
    return count;
  }

  async guestMigration(guestId: string): Promise<GuestMigrationRecord | null> {
    const record = this.migrations.get(guestId);
    return record ? { ...record } : null;
  }

  async guestMigrationForAccount(accountId: string): Promise<GuestMigrationRecord | null> {
    for (const record of this.migrations.values()) {
      if (record.accountId === accountId) return { ...record };
    }
    return null;
  }

  async recordGuestMigration(record: GuestMigrationRecord): Promise<WriteOutcome> {
    for (const existing of this.migrations.values()) {
      if (existing.accountId === record.accountId) return 'conflict';
    }
    if (this.migrations.has(record.guestId)) return 'conflict';
    this.migrations.set(record.guestId, { ...record });
    return 'ok';
  }

  async completeGuestMigration(
    guestId: string,
    accountId: string,
    completedAt: number,
  ): Promise<WriteOutcome> {
    const record = this.migrations.get(guestId);
    if (!record || record.accountId !== accountId || record.state !== 'pending') return 'conflict';
    this.migrations.set(guestId, { ...record, state: 'complete', completedAt });
    return 'ok';
  }

  async recordCareerMatch(accountId: string, record: CareerMatchRecord): Promise<WriteOutcome> {
    const rows = this.career.get(accountId) ?? [];
    if (rows.some((existing) => existing.ref === record.ref)) return 'conflict';
    rows.push({ ...record });
    this.career.set(accountId, rows);
    return 'ok';
  }

  async careerMatches(accountId: string, limit: number, offset = 0): Promise<CareerMatchRecord[]> {
    const rows = this.career.get(accountId) ?? [];
    const start = Math.max(0, Math.floor(offset));
    return [...rows]
      .sort((left, right) => right.recordedAt - left.recordedAt || left.ref.localeCompare(right.ref))
      .slice(start, start + Math.max(1, Math.min(200, Math.floor(limit))))
      .map((record) => ({ ...record }));
  }

  async careerMatch(accountId: string, ref: string): Promise<CareerMatchRecord | null> {
    const row = (this.career.get(accountId) ?? []).find((record) => record.ref === ref);
    return row ? { ...row } : null;
  }

  async careerTotals(accountId: string): Promise<CareerTotals> {
    const rows = this.career.get(accountId);
    return rows && rows.length > 0 ? summariseCareer(rows) : { ...EMPTY_CAREER };
  }

  async profile(accountId: string): Promise<PlayerProfileRecord | null> {
    const profile = this.profiles.get(accountId);
    return profile ? { ...profile } : null;
  }

  async profileByCallsignKey(callsignKey: string): Promise<PlayerProfileRecord | null> {
    for (const profile of this.profiles.values()) {
      if (profile.callsignKey === callsignKey) return { ...profile };
    }
    return null;
  }

  async createProfile(record: PlayerProfileRecord): Promise<WriteOutcome> {
    if (this.profiles.has(record.accountId)) return 'conflict';
    for (const existing of this.profiles.values()) {
      if (existing.callsignKey === record.callsignKey) return 'conflict';
    }
    this.profiles.set(record.accountId, { ...record });
    return 'ok';
  }

  async updateProfile(
    accountId: string,
    patch: {
      callsign: string;
      callsignKey: string;
      avatar: PlayerProfileRecord['avatar'];
      updatedAt: number;
      callsignChangedAt: number | null;
    },
  ): Promise<WriteOutcome> {
    const profile = this.profiles.get(accountId);
    if (!profile) return 'conflict';
    for (const existing of this.profiles.values()) {
      if (existing.accountId !== accountId && existing.callsignKey === patch.callsignKey) return 'conflict';
    }
    profile.callsign = patch.callsign;
    profile.callsignKey = patch.callsignKey;
    profile.avatar = patch.avatar;
    profile.updatedAt = patch.updatedAt;
    if (patch.callsignChangedAt !== null) profile.callsignChangedAt = patch.callsignChangedAt;
    return 'ok';
  }

  async playerIdentityDocument(accountId: string): Promise<PlayerIdentityDocument | null> {
    const document = this.flagDocuments.get(accountId);
    if (!document) return null;
    return {
      ...document,
      designs: document.designs.map((flag) => ({ ...flag })),
    };
  }

  async savePlayerIdentityDocument(
    accountId: string,
    document: PlayerIdentityDocument,
    expectedRevision: number,
  ): Promise<WriteOutcome> {
    const current = this.flagDocuments.get(accountId);
    if ((current?.revision ?? 0) !== expectedRevision) return 'conflict';
    this.flagDocuments.set(accountId, {
      ...document,
      designs: document.designs.map((flag) => ({ ...flag })),
      revision: expectedRevision + 1,
    });
    return 'ok';
  }

  async recordCareerEntry(entry: CareerEntryWrite): Promise<WriteOutcome> {
    const rows = this.career.get(entry.accountId) ?? [];
    if (rows.some((existing) => existing.ref === entry.record.ref)) return 'conflict';
    const xpBefore = rows.reduce((total, record) => total + record.xp, 0);
    rows.push({ ...entry.record });
    this.career.set(entry.accountId, rows);
    if (entry.report) {
      const key = `${entry.accountId}:${entry.report.ref}`;
      if (!this.reports.has(key)) {
        this.reports.set(key, {
          ...entry.report,
          xpBefore,
          xpAfter: xpBefore + entry.record.xp,
        });
      }
    }
    if (entry.audit) {
      const key = `${entry.audit.matchId}:${entry.audit.accountId}`;
      if (!this.audit.has(key)) this.audit.set(key, { ...entry.audit });
    }
    return 'ok';
  }

  async recordMatchReport(accountId: string, report: MatchReportRecord): Promise<void> {
    const key = `${accountId}:${report.ref}`;
    if (this.reports.has(key)) return;
    const totals = await this.careerTotals(accountId);
    this.reports.set(key, { ...report, xpBefore: totals.xp, xpAfter: totals.xp + report.xpAfter - report.xpBefore });
  }

  async matchReport(accountId: string, ref: string): Promise<MatchReportRecord | null> {
    const report = this.reports.get(`${accountId}:${ref}`);
    return report ? { ...report } : null;
  }

  async awardedAchievements(accountId: string): Promise<CareerAchievementRecord[]> {
    return [...this.achievements.values()]
      .filter((record) => record.accountId === accountId)
      .sort((left, right) => left.awardedAt - right.awardedAt || left.achievementId.localeCompare(right.achievementId))
      .map((record) => ({ ...record }));
  }

  async achievementsForMatch(accountId: string, matchRef: string): Promise<CareerAchievementRecord[]> {
    return [...this.achievements.values()]
      .filter((record) => record.accountId === accountId && record.matchRef === matchRef)
      .sort((left, right) => left.awardedAt - right.awardedAt || left.achievementId.localeCompare(right.achievementId))
      .map((record) => ({ ...record }));
  }

  async recordAchievements(accountId: string, awards: readonly AchievementAwardWrite[]): Promise<number> {
    let inserted = 0;
    for (const award of awards) {
      const key = `${accountId}:${award.achievementId}`;
      if (this.achievements.has(key)) continue;
      this.achievements.set(key, {
        accountId,
        achievementId: award.achievementId,
        awardedAt: award.awardedAt,
        matchRef: award.matchRef,
      });
      inserted += 1;
    }
    return inserted;
  }

  async outbreakRun(
    accountId: string,
    mode: OutbreakBoardMode,
    difficulty: OutbreakBoardDifficulty,
    map: string,
  ): Promise<OutbreakRunRecord | null> {
    const record = this.outbreakRuns.get(this.outbreakKey(accountId, map, mode, difficulty));
    return record ? this.outbreakView(record) : null;
  }

  async saveOutbreakRun(record: OutbreakRunRecord): Promise<WriteOutcome> {
    const key = this.outbreakKey(record.accountId, record.map, record.mode, record.difficulty);
    const current = this.outbreakRuns.get(key);
    // A better-or-equal run never replaces the stored one, matching the
    // conditional upsert in the D1 store.
    if (current && compareOutbreakRuns(record, current) >= 0) return 'conflict';
    this.outbreakRuns.set(key, { ...record, nations: [...record.nations] });
    return 'ok';
  }

  async outbreakLeaderboard(
    mode: OutbreakBoardMode,
    difficulty: OutbreakBoardDifficulty,
    map: string,
    limit: number,
  ): Promise<OutbreakRunRecord[]> {
    return [...this.outbreakRuns.values()]
      .filter(
        (record) => record.mode === mode && record.difficulty === difficulty && record.map === map,
      )
      .sort(compareOutbreakRuns)
      .slice(0, limit)
      .map((record) => this.outbreakView(record));
  }

  async outbreakRank(run: OutbreakRunRecord): Promise<number> {
    let ahead = 0;
    for (const record of this.outbreakRuns.values()) {
      if (record.mode !== run.mode || record.difficulty !== run.difficulty) continue;
      if (record.map !== run.map) continue;
      if (record.accountId === run.accountId) continue;
      if (compareOutbreakRuns(record, run) < 0) ahead++;
    }
    return ahead + 1;
  }

  async recordCampaignCompletion(accountId: string, campaignId: string, completedAt: number): Promise<WriteOutcome> {
    const key = `${accountId}:${campaignId}`;
    if (this.campaigns.has(key)) return 'conflict';
    this.campaigns.set(key, { accountId, campaignId, completedAt });
    return 'ok';
  }

  async careerCampaigns(accountId: string): Promise<CareerCampaignRecord[]> {
    return [...this.campaigns.values()]
      .filter((record) => record.accountId === accountId)
      .sort((left, right) => left.completedAt - right.completedAt || left.campaignId.localeCompare(right.campaignId))
      .map((record) => ({ ...record }));
  }

  async careerStatRows(accountId: string): Promise<StatGroupRow[]> {
    const rows = this.career.get(accountId) ?? [];
    const groups = new Map<string, StatGroupRow>();
    for (const record of rows) {
      const key = `${record.mode}:${record.nation ?? ''}`;
      const report = this.reports.get(`${accountId}:${record.ref}`);
      const group =
        groups.get(key) ??
        ({
          mode: record.mode,
          nation: record.nation,
          matches: 0,
          victories: 0,
          defeats: 0,
          draws: 0,
          playSeconds: 0,
          xp: 0,
          unitsDestroyed: 0,
          unitsLost: 0,
          structuresDestroyed: 0,
          structuresLost: 0,
          structuresBuilt: 0,
          sitesCaptured: 0,
          superweaponsUsed: 0,
          objectivesCompleted: 0,
        } satisfies StatGroupRow);
      group.matches += 1;
      if (record.outcome === 'victory') group.victories += 1;
      else if (record.outcome === 'defeat') group.defeats += 1;
      else group.draws += 1;
      group.playSeconds += record.durationSeconds;
      group.xp += record.xp;
      group.unitsDestroyed += record.kills;
      group.unitsLost += record.unitsLost;
      if (report) {
        group.structuresDestroyed += report.structuresDestroyed;
        group.structuresLost += report.structuresLost;
        group.structuresBuilt += report.structuresBuilt;
        group.sitesCaptured += report.sitesCaptured;
        group.superweaponsUsed += report.superweaponsUsed;
        group.objectivesCompleted += report.objectivesCompleted;
      }
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  async recordMpResultPlayer(record: MpResultPlayerRecord): Promise<void> {
    const key = `${record.matchId}:${record.accountId}`;
    if (!this.audit.has(key)) this.audit.set(key, { ...record });
  }

  async mpResultsSince(accountId: string, since: number): Promise<number> {
    let count = 0;
    for (const row of this.audit.values()) {
      if (row.accountId === accountId && row.status === 'awarded' && row.processedAt >= since) count += 1;
    }
    return count;
  }

  async countRateLimit(bucket: string, windowStart: number): Promise<number> {
    const key = `${bucket}:${windowStart}`;
    const next = (this.limits.get(key) ?? 0) + 1;
    this.limits.set(key, next);
    return next;
  }

  /** Test hook: every stored session, for asserting rotation and revocation. */
  allSessions(): SessionRecord[] {
    return [...this.sessions.values()].map((session) => ({ ...session }));
  }
}
