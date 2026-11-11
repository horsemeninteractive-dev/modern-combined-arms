import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { careerRecord, careerViewFrom, summariseCareer } from '../src/accounts/career';
import type { CareerSnapshot } from '../src/accounts/careerService';
import {
  careerHistoryMarkup,
  careerSummaryMarkup,
  endCareerMarkup,
  serviceRecordMarkup,
} from '../src/ui/careerView';

const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

const record = careerRecord(
  {
    ref: 'skirmish:0123abcd-0001',
    mode: 'skirmish',
    outcome: 'victory',
    difficulty: 'veteran',
    durationSeconds: 600,
    nation: 'uk',
    kills: 9,
    unitsLost: 2,
  },
  { provenance: 'local', now: Date.UTC(2026, 10, 4) },
);

const snapshot: CareerSnapshot = {
  view: careerViewFrom(summariseCareer([record]), [record]),
  source: 'account',
};

describe('career summary', () => {
  it('shows the totals without restating the standing above them', () => {
    const html = careerSummaryMarkup(snapshot);
    expect(html).toContain('OPERATIONS');
    expect(html).toContain('VICTORIES');
    expect(html).toContain('100%');
    expect(html).toContain('data-career-source="account"');
    // Rank, level and XP progress belong to the account page head, once.
    expect(html).not.toContain('CAREER XP');
    expect(html).not.toContain('aria-valuenow');
  });

  it('labels a guest career and its transfer route', () => {
    const html = careerSummaryMarkup({ ...snapshot, source: 'guest' });
    expect(html).toContain('Guest career on this device');
    expect(html).toContain('data-career-source="guest"');
  });

  it('warns when the account career could not be read', () => {
    const html = careerSummaryMarkup({ ...snapshot, unavailable: true });
    expect(html).toContain('data-level="warning"');
    expect(html).toContain('could not be reached');
  });

  it('says so when there is no record yet', () => {
    expect(careerHistoryMarkup(snapshot, 4)).toContain('Victory');
    const empty = careerSummaryMarkup(null);
    expect(empty).toContain('Reading your service record');
    expect(careerHistoryMarkup(null)).toBe('');
  });
});

/**
 * The end card's career block used to squeeze the award rack into the same flex
 * line as the XP text, where a 46px ribbon overflowed its 22px art column and
 * printed over its own citation. The rack and its route are whole rows now, and
 * the art column is wide enough for the widest award.
 */
describe('end card career block', () => {
  it('gives the award rack and its route their own full-width rows', () => {
    expect(styles).toContain('.end-career .career-new-awards,');
    expect(styles).toContain('.end-career .career-legacy-link,');
    expect(styles).toContain('.end-career .career-promotion { flex: 1 1 100%; }');
  });

  it('sizes the award art column so no artwork runs under the name', () => {
    expect(styles).toContain(
      '.career-new-awards li { display: grid; grid-template-columns: 40px minmax(0, 1fr);',
    );
    expect(styles).toContain('.career-new-awards li .award-art { max-width: 40px; }');
    expect(styles).toContain('.career-new-awards b { grid-column: 2; grid-row: 1;');
    expect(styles).toContain('.career-new-awards small { grid-column: 2; grid-row: 2;');
  });
});

describe('service record', () => {
  it('lists the matches and the aggregate counters', () => {
    const html = serviceRecordMarkup(snapshot);
    expect(html).toContain('SERVICE RECORD');
    expect(html).toContain('Skirmish · 10:00');
    expect(html).toContain('2026-11-04');
    expect(html).toContain('+110');
    expect(html).toContain('KILLS');
    expect(html).toContain('UNITS LOST');
    expect(html).toContain('Kills and losses are recorded but earn nothing');
  });

  it('reports an unavailable record instead of an empty one', () => {
    expect(serviceRecordMarkup(null)).toContain('unavailable');
  });
});

describe('end-of-match career line', () => {
  it('awards nothing until a campaign result is accepted', () => {
    const html = endCareerMarkup({ status: 'pending' });
    expect(html).toContain('data-state="pending"');
    expect(html).toContain('awarded when you accept');
  });

  it('shows the award, rank and source when recorded', () => {
    const html = endCareerMarkup({ status: 'recorded', xp: 110, snapshot });
    expect(html).toContain('data-state="recorded"');
    expect(html).toContain('+110 CAREER XP');
    expect(html).toContain('ACCOUNT');
    expect(html).toContain('Private');
  });

  it('names the guest ledger when the result went there', () => {
    const html = endCareerMarkup({ status: 'recorded', xp: 55, snapshot: { ...snapshot, source: 'guest' } });
    expect(html).toContain('GUEST RECORD');
  });

  it('reports a result that could not be recorded, escaped', () => {
    const html = endCareerMarkup({ status: 'failed', message: '<b>offline</b>' });
    expect(html).toContain('data-state="failed"');
    expect(html).toContain('&lt;b&gt;offline&lt;/b&gt;');
    expect(html).not.toContain('<b>offline</b>');
  });

  it('renders nothing for a test run', () => {
    expect(endCareerMarkup({ status: 'none' })).toBe('');
  });
});
