/**
 * Career presentation.
 *
 * Pure markup builders, so the account panel, the service-record modal and the
 * end-of-match card all read the same career the same way. Nothing here decides
 * XP or rank: it renders the totals and standing it is handed.
 */
import type { CareerMatchRecord, CareerMode, CareerOutcome } from '../accounts/career';
import type { CareerSnapshot } from '../accounts/careerService';
import { rankInsigniaSvg } from './rankInsignia';

const MODE_LABEL: Record<CareerMode, string> = {
  campaign: 'Campaign',
  skirmish: 'Skirmish',
  multiplayer: 'Multiplayer',
};

const OUTCOME_LABEL: Record<CareerOutcome, string> = {
  victory: 'Victory',
  defeat: 'Defeat',
  draw: 'Draw',
};

export function escapeCareerHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function playtime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  return `${minutes}m`;
}

function matchDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

function matchDate(recordedAt: number): string {
  if (!Number.isFinite(recordedAt) || recordedAt <= 0) return '—';
  try {
    return new Date(recordedAt).toISOString().slice(0, 10);
  } catch {
    return '—';
  }
}

export function careerSummaryMarkup(snapshot: CareerSnapshot | null): string {
  if (!snapshot) return '<p class="account-note">Reading your service record…</p>';
  const view = snapshot.view;
  const totals = view.totals;
  const winRate = totals.matches > 0 ? Math.round((totals.victories / totals.matches) * 100) : 0;
  const percent = Math.round(view.progress * 100);
  const nextText = view.next
    ? `${view.xpInto} / ${view.xpSpan ?? 0} XP to ${escapeCareerHtml(view.next.name)}`
    : 'Top of the ladder — every rank held';
  const sourceText =
    snapshot.source === 'guest'
      ? 'Guest career on this device. Sign in and import it to keep it across devices.'
      : 'Career stored with your MCA account.';
  return `
    <div class="career-block" data-career-source="${snapshot.source}">
      <div class="career-rank">
        <span class="career-insignia">${rankInsigniaSvg(view.rank, { label: `${view.rank.name} insignia` })}</span>
        <span class="career-rank-text">
          <b>${escapeCareerHtml(view.rank.name)}</b>
          <small>${escapeCareerHtml(view.rank.grade)} · ${escapeCareerHtml(view.rank.abbreviation)}</small>
        </span>
        <span class="career-xp"><b>${totals.xp.toLocaleString()}</b><small>CAREER XP</small></span>
      </div>
      <div class="career-progress" role="progressbar" aria-label="Progress to next rank"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>
      <p class="career-next">${nextText}</p>
      <div class="career-stats">
        <div><span>OPERATIONS</span><b>${totals.matches}</b></div>
        <div><span>VICTORIES</span><b>${totals.victories}</b></div>
        <div><span>WIN RATE</span><b>${winRate}%</b></div>
        <div><span>SERVICE</span><b>${playtime(totals.playSeconds)}</b></div>
      </div>
      <p class="account-note">${sourceText}</p>
      ${snapshot.unavailable ? '<p class="account-notice" role="status" data-level="warning">The account career could not be reached, so the local guest record is shown.</p>' : ''}
    </div>`;
}

export function careerHistoryMarkup(snapshot: CareerSnapshot | null, limit = 5): string {
  if (!snapshot) return '';
  const matches = snapshot.view.matches.slice(0, limit);
  if (matches.length === 0) {
    return '<p class="account-note">No completed operations yet. Finish a campaign mission or skirmish to open your service record.</p>';
  }
  const rows = matches
    .map(
      (match: CareerMatchRecord) => `
      <li class="career-match" data-outcome="${match.outcome}">
        <span class="career-match-outcome">${OUTCOME_LABEL[match.outcome]}</span>
        <span class="career-match-detail">${MODE_LABEL[match.mode]} · ${matchDuration(match.durationSeconds)}</span>
        <span class="career-match-date">${matchDate(match.recordedAt)}</span>
        <b class="career-match-xp">+${match.xp}</b>
      </li>`,
    )
    .join('');
  return `<ul class="career-history" aria-label="Recent operations">${rows}</ul>`;
}

/** The full service record, used by the panel's modal. */
export function serviceRecordMarkup(snapshot: CareerSnapshot | null): string {
  if (!snapshot) return '<p class="account-note">The service record is unavailable right now.</p>';
  const totals = snapshot.view.totals;
  return `
    ${careerSummaryMarkup(snapshot)}
    <div class="career-record">
      <p class="section-title">SERVICE RECORD</p>
      ${careerHistoryMarkup(snapshot, 20)}
      <div class="career-record-totals">
        <div><span>KILLS</span><b>${totals.kills}</b></div>
        <div><span>UNITS LOST</span><b>${totals.unitsLost}</b></div>
        <div><span>DEFEATS</span><b>${totals.defeats}</b></div>
        <div><span>DRAWS</span><b>${totals.draws}</b></div>
      </div>
      <p class="account-note">XP is awarded for a completed operation: base by mode, one per full minute of play, scaled by outcome and AI difficulty. Kills and losses are recorded but earn nothing.</p>
    </div>`;
}

export type EndCareerState =
  | { status: 'none' }
  | { status: 'pending' }
  | { status: 'recorded'; xp: number; snapshot: CareerSnapshot }
  | { status: 'failed'; message: string };

/**
 * The career line on the end card. A pending campaign result says so plainly
 * instead of showing XP that has not been awarded yet.
 */
export function endCareerMarkup(state: EndCareerState): string {
  if (state.status === 'none') return '';
  if (state.status === 'pending') {
    return `<div class="end-career" data-state="pending">
      <span class="end-career-label">CAREER</span>
      <b>XP is awarded when you accept this result</b>
    </div>`;
  }
  if (state.status === 'failed') {
    return `<div class="end-career" data-state="failed">
      <span class="end-career-label">CAREER</span>
      <b>This result was not recorded: ${escapeCareerHtml(state.message)}</b>
    </div>`;
  }
  const view = state.snapshot.view;
  return `<div class="end-career" data-state="recorded">
    <span class="career-insignia">${rankInsigniaSvg(view.rank, { label: `${view.rank.name} insignia` })}</span>
    <span class="end-career-text">
      <b>+${state.xp} CAREER XP</b>
      <small>${escapeCareerHtml(view.rank.name)} · ${view.totals.xp.toLocaleString()} XP</small>
    </span>
    <span class="end-career-source">${state.snapshot.source === 'guest' ? 'GUEST RECORD' : 'ACCOUNT'}</span>
  </div>`;
}
