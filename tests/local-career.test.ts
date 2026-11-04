import { describe, expect, it } from 'vitest';
import { careerXp } from '../src/accounts/career';
import {
  CAREER_STORAGE_KEY,
  guestCareerPayload,
  localCareerMatches,
  localCareerTotals,
  readLocalCareer,
  recordLocalMatch,
} from '../src/accounts/localCareer';

class MapStorage {
  private readonly rows = new Map<string, string>();
  getItem(key: string): string | null {
    return this.rows.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.rows.set(key, value);
  }
  remove(key: string): void {
    this.rows.delete(key);
  }
}

const input = {
  ref: 'skirmish:0123abcd-0001',
  mode: 'skirmish' as const,
  outcome: 'victory' as const,
  difficulty: 'veteran' as const,
  durationSeconds: 600,
  nation: 'uk',
  kills: 12,
  unitsLost: 3,
};

describe('guest career ledger', () => {
  it('records a match and reports it once', () => {
    const storage = new MapStorage();
    const first = recordLocalMatch(storage, input, 1_000);
    expect(first.duplicate).toBe(false);
    expect(first.record.xp).toBe(careerXp(input));
    const again = recordLocalMatch(storage, input, 2_000);
    expect(again.duplicate).toBe(true);
    expect(localCareerMatches(storage)).toHaveLength(1);
  });

  it('keeps newest first and totals every outcome', () => {
    const storage = new MapStorage();
    recordLocalMatch(storage, { ...input, ref: 'skirmish:0123abcd-0001' }, 1_000);
    recordLocalMatch(storage, { ...input, ref: 'skirmish:0123abcd-0002', outcome: 'defeat' }, 2_000);
    const matches = localCareerMatches(storage);
    expect(matches[0].outcome).toBe('defeat');
    const totals = localCareerTotals(storage);
    expect(totals.matches).toBe(2);
    expect(totals.victories).toBe(1);
    expect(totals.defeats).toBe(1);
    expect(totals.xp).toBe(matches.reduce((sum, match) => sum + match.xp, 0));
  });

  it('survives corrupt and hand-edited storage', () => {
    const storage = new MapStorage();
    storage.setItem(CAREER_STORAGE_KEY, '{not json');
    expect(readLocalCareer(storage).matches).toEqual([]);
    storage.setItem(
      CAREER_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        matches: [
          { ref: 'skirmish:0123abcd-0001', mode: 'skirmish', outcome: 'victory', difficulty: 'veteran', durationSeconds: 10 },
          { ref: 'bad', mode: 'skirmish', outcome: 'victory', difficulty: 'veteran', durationSeconds: 10 },
          'nope',
        ],
      }),
    );
    const career = readLocalCareer(storage);
    expect(career.matches).toHaveLength(1);
    expect(career.matches[0].xp).toBe(careerXp({ ...input, durationSeconds: 10 }));
  });

  it('ignores a stored XP value that disagrees with the rules', () => {
    const storage = new MapStorage();
    storage.setItem(
      CAREER_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        matches: [
          {
            ref: 'skirmish:0123abcd-0001',
            mode: 'skirmish',
            outcome: 'victory',
            difficulty: 'veteran',
            durationSeconds: 600,
            kills: 0,
            unitsLost: 0,
            nation: null,
            provenance: 'local',
            recordedAt: 5,
            xp: 999_999,
          },
        ],
      }),
    );
    expect(readLocalCareer(storage).matches[0].xp).toBe(careerXp(input));
  });

  it('caps the stored history', () => {
    const storage = new MapStorage();
    for (let i = 0; i < 205; i++) {
      recordLocalMatch(storage, { ...input, ref: `skirmish:0123abcd-${i.toString().padStart(4, '0')}` }, i);
    }
    expect(readLocalCareer(storage).matches).toHaveLength(200);
    expect(localCareerMatches(storage, 5)).toHaveLength(5);
  });

  it('builds an import payload without client-asserted value', () => {
    const storage = new MapStorage();
    recordLocalMatch(storage, input, 1_000);
    const payload = guestCareerPayload(storage);
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      ref: input.ref,
      mode: 'skirmish',
      outcome: 'victory',
      difficulty: 'veteran',
      durationSeconds: 600,
      nation: 'uk',
      kills: 12,
      unitsLost: 3,
    });
    expect(payload[0]).not.toHaveProperty('xp');
    expect(payload[0]).not.toHaveProperty('provenance');
  });

  it('works without storage', () => {
    expect(readLocalCareer({ getItem: () => null, setItem: () => undefined }).matches).toEqual([]);
  });
});
