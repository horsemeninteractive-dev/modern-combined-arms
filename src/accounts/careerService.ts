/**
 * The browser's view of a career.
 *
 * A guest and an account play the same way, so callers only ever ask this
 * service to load or record a match; it decides which ledger is authoritative.
 * The server owns a signed-in career. The local ledger is used only when there
 * is provably no session (a 401), never as a silent fallback after a failed
 * write — a signed-in result that failed to record must be reported, not quietly
 * filed where it can never be joined to the account.
 */
import type { CareerMatchInput, CareerViewData } from './career';
import { careerViewFrom, summariseCareer } from './career';
import { AccountApiError, type CareerView, type HttpAccountApi, type MatchResultView } from './client';
import {
  guestCareerPayload,
  localCareerMatches,
  localCareerTotals,
  recordLocalMatch,
  type CareerStorage,
} from './localCareer';

export interface CareerSnapshot {
  /** Account careers also carry the statistics breakdown and identity. */
  view: CareerView;
  source: 'account' | 'guest';
  /** True when the account career could not be read; the guest view is shown. */
  unavailable?: boolean;
}

export interface CareerRecordOutcome {
  snapshot: CareerSnapshot;
  award: number;
  recorded: boolean;
  duplicate: boolean;
}

export const CAREER_HISTORY_LIMIT = 20;

export class CareerService {
  private readonly api: HttpAccountApi;
  private readonly storage: CareerStorage | null;

  constructor(api: HttpAccountApi, storage: CareerStorage | null) {
    this.api = api;
    this.storage = storage;
  }

  private guestView(): CareerSnapshot {
    if (!this.storage) {
      return {
        view: careerViewFrom(summariseCareer([]), []),
        source: 'guest',
      };
    }
    const matches = localCareerMatches(this.storage, CAREER_HISTORY_LIMIT);
    return {
      view: careerViewFrom(localCareerTotals(this.storage), matches),
      source: 'guest',
    };
  }

  /** Read the career: the account's when signed in, the guest ledger otherwise. */
  async load(): Promise<CareerSnapshot> {
    try {
      const career = await this.api.career();
      return { view: career, source: 'account' };
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 401) return this.guestView();
      return { ...this.guestView(), unavailable: true };
    }
  }

  /**
   * Record one completed match.
   *
   * A 401 means the session ended between loading the menu and the result card;
   * the match then belongs to the local ledger, which is still transferable.
   * Every other failure is reported so the end screen can say the result was
   * not recorded.
   */
  async record(input: CareerMatchInput): Promise<CareerRecordOutcome> {
    try {
      const result = await this.api.recordMatch(input);
      return {
        snapshot: { view: result.career, source: 'account' },
        award: result.award,
        recorded: result.recorded,
        duplicate: !result.recorded,
      };
    } catch (error) {
      if (!(error instanceof AccountApiError) || error.status !== 401) throw error;
    }
    if (!this.storage) {
      return {
        snapshot: this.guestView(),
        award: 0,
        recorded: false,
        duplicate: false,
      };
    }
    const local = recordLocalMatch(this.storage, input);
    return {
      snapshot: this.guestView(),
      award: local.duplicate ? 0 : local.record.xp,
      recorded: !local.duplicate,
      duplicate: local.duplicate,
    };
  }

  /**
   * The account service's own answer for one authoritative match.
   *
   * `pending` means the room has not reported the match yet, which is normal for
   * a moment after the scoreboard appears. A guest has no authoritative award to
   * read and gets null, so the end screen can say so instead of inventing XP.
   */
  async matchOutcome(ref: string): Promise<MatchResultView | null> {
    try {
      return await this.api.matchResult(ref);
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 401) return null;
      throw error;
    }
  }

  /** The guest ledger as a migration payload; empty when nothing was played. */
  guestPayload(): CareerMatchInput[] {
    return this.storage ? guestCareerPayload(this.storage) : [];
  }

  /** Rebuild a view for a career the server just returned (after migration). */
  static fromAccount(view: CareerViewData): CareerSnapshot {
    return { view: view as CareerView, source: 'account' };
  }
}
