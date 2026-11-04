import { describe, expect, it } from 'vitest';
import {
  careerRecord,
  careerViewFrom,
  careerXp,
  EMPTY_CAREER,
  MAX_MATCH_SECONDS,
  parseCareerMatch,
  summariseCareer,
} from '../src/accounts/career';
import { RANKS, rankForXp } from '../src/accounts/ranks';
import { rankInsigniaSvg } from '../src/ui/rankInsignia';

const base = {
  ref: 'skirmish:0123abcd-4567',
  mode: 'skirmish' as const,
  outcome: 'victory' as const,
  difficulty: 'veteran' as const,
  durationSeconds: 600,
};

describe('career XP', () => {
  it('pays base, a capped minute bonus, outcome and difficulty', () => {
    expect(careerXp(base)).toBe(110);
    expect(careerXp({ ...base, difficulty: 'elite' })).toBe(138);
    expect(careerXp({ ...base, difficulty: 'recruit' })).toBe(88);
    expect(careerXp({ ...base, outcome: 'defeat' })).toBe(33);
    expect(careerXp({ ...base, outcome: 'draw' })).toBe(55);
    expect(careerXp({ ...base, mode: 'campaign' })).toBe(160);
  });

  it('caps the length bonus instead of paying for an idle clock', () => {
    const capped = careerXp({ ...base, durationSeconds: MAX_MATCH_SECONDS });
    const atCap = careerXp({ ...base, durationSeconds: 3_600 });
    expect(capped).toBe(atCap);
    expect(capped).toBe(160);
  });

  it('never returns a negative or fractional award', () => {
    const xp = careerXp({ ...base, durationSeconds: -50 });
    expect(xp).toBe(100);
    expect(Number.isInteger(careerXp({ ...base, durationSeconds: 59 }))).toBe(true);
  });
});

describe('career match validation', () => {
  it('accepts a minimal match and fills the optional counters', () => {
    const parsed = parseCareerMatch({ ...base });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kills).toBe(0);
    expect(parsed.value.unitsLost).toBe(0);
    expect(parsed.value.nation).toBeNull();
  });

  it('accepts a nation and bounded counters', () => {
    const parsed = parseCareerMatch({ ...base, nation: 'uk', kills: 42, unitsLost: 7 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nation).toBe('uk');
    expect(parsed.value.kills).toBe(42);
  });

  it.each([
    ['missing ref', { ...base, ref: '' }],
    ['short ref', { ...base, ref: 'abc' }],
    ['free-form ref', { ...base, ref: 'skirmish:../../etc/passwd' }],
    ['unknown mode', { ...base, mode: 'survival' }],
    ['unknown outcome', { ...base, outcome: 'pyrrhic' }],
    ['unknown difficulty', { ...base, difficulty: 'nightmare' }],
    ['fractional duration', { ...base, durationSeconds: 12.5 }],
    ['negative duration', { ...base, durationSeconds: -1 }],
    ['absurd duration', { ...base, durationSeconds: MAX_MATCH_SECONDS + 1 }],
    ['string duration', { ...base, durationSeconds: '600' }],
    ['excess kills', { ...base, kills: 5_001 }],
    ['negative losses', { ...base, unitsLost: -2 }],
    ['unsafe nation', { ...base, nation: '../uk' }],
    ['array body', []],
    ['null body', null],
  ])('rejects %s', (_label, body) => {
    const parsed = parseCareerMatch(body);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe('invalid-request');
  });
});

describe('career totals', () => {
  const records = [
    careerRecord({ ...base, ref: 'skirmish:aaaaaaaa', outcome: 'victory', durationSeconds: 600 }, { provenance: 'local', now: 1 }),
    careerRecord({ ...base, ref: 'skirmish:bbbbbbbb', outcome: 'defeat', durationSeconds: 1200 }, { provenance: 'local', now: 2 }),
    careerRecord({ ...base, ref: 'skirmish:cccccccc', outcome: 'draw', durationSeconds: 60 }, { provenance: 'guest', now: 3 }),
  ];

  it('counts one of each outcome and sums time and XP', () => {
    const totals = summariseCareer(records);
    expect(totals.matches).toBe(3);
    expect(totals.victories).toBe(1);
    expect(totals.defeats).toBe(1);
    expect(totals.draws).toBe(1);
    expect(totals.playSeconds).toBe(1_860);
    expect(totals.xp).toBe(records.reduce((sum, record) => sum + record.xp, 0));
  });

  it('is empty for an empty ledger', () => {
    expect(summariseCareer([])).toEqual(EMPTY_CAREER);
  });

  it('records provenance and a recomputed value', () => {
    const record = careerRecord({ ...base, kills: 9 }, { provenance: 'guest', now: 5 });
    expect(record.provenance).toBe('guest');
    expect(record.recordedAt).toBe(5);
    expect(record.xp).toBe(careerXp(base));
  });
});

describe('rank ladder', () => {
  it('has strictly increasing thresholds that start at zero', () => {
    expect(RANKS[0].threshold).toBe(0);
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].threshold).toBeGreaterThan(RANKS[i - 1].threshold);
      expect(RANKS[i].id).not.toBe(RANKS[i - 1].id);
    }
  });

  it('resolves the lower boundary of each rank exactly', () => {
    for (const rank of RANKS) {
      expect(rankForXp(rank.threshold).rank.id).toBe(rank.id);
      if (rank.threshold > 0) {
        expect(rankForXp(rank.threshold - 1).rank.id).not.toBe(rank.id);
      }
    }
  });

  it('reports progress toward the next rank', () => {
    const standing = rankForXp(500);
    expect(standing.rank.id).toBe('corporal');
    expect(standing.next?.id).toBe('sergeant');
    expect(standing.xpInto).toBe(100);
    expect(standing.xpSpan).toBe(700);
    expect(standing.progress).toBeCloseTo(1 / 7, 4);
  });

  it('tops out at General with full progress', () => {
    const standing = rankForXp(9_999_999);
    expect(standing.rank.id).toBe('general');
    expect(standing.next).toBeNull();
    expect(standing.progress).toBe(1);
  });

  it('treats invalid totals as zero rather than throwing', () => {
    expect(rankForXp(-10).rank.id).toBe('private');
    expect(rankForXp(Number.NaN).rank.id).toBe('private');
  });

  it('exposes the career view the Worker returns', () => {
    const view = careerViewFrom(summariseCareer([]), []);
    expect(view.rank.id).toBe('private');
    expect(view.next?.id).toBe('corporal');
    expect(view.progress).toBe(0);
  });
});

describe('rank insignia', () => {
  it('draws the authored shapes for every rank', () => {
    for (const rank of RANKS) {
      const svg = rankInsigniaSvg(rank, { label: rank.name });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('viewBox="0 0 48 30"');
      expect(svg).toContain(`<title>${rank.name}</title>`);
      const expectedShapes =
        (rank.insignia.chevrons ?? 0) + (rank.insignia.rockers ?? 0) +
        (rank.insignia.bars ?? 0) + (rank.insignia.stars ?? 0);
      expect(expectedShapes).toBeGreaterThan(0);
    }
  });

  it('escapes the accessible title', () => {
    const svg = rankInsigniaSvg(RANKS[0], { label: '<script>' });
    expect(svg).not.toContain('<script>');
  });
});
