/**
 * Career presentation.
 *
 * Pure markup builders, so the account panel, the service-record modal and the
 * end-of-match card all read the same career the same way. Nothing here decides
 * XP or rank: it renders the totals and standing it is handed.
 */
import type { CareerMode, CareerOutcome } from '../accounts/career';
import type { CareerSnapshot } from '../accounts/careerService';
import type { CareerStats, StatBlock } from '../accounts/stats';
import type {
  IdentityView,
  MatchHistoryItem,
  MatchReportView,
  MatchResultView,
} from '../accounts/client';
import { rankForXp } from '../accounts/ranks';
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

export function modeLabel(mode: CareerMode): string {
  return MODE_LABEL[mode];
}

export function careerHistoryMarkup(
  snapshot: CareerSnapshot | null,
  limit = 5,
  reports?: ReadonlyMap<string, MatchReportView | null>,
): string {
  if (!snapshot) return '';
  const matches = snapshot.view.matches.slice(0, limit);
  if (matches.length === 0) {
    return '<p class="account-note">No completed operations yet. Finish a campaign mission or skirmish to open your service record.</p>';
  }
  return historyListMarkup(matches.map((match) => ({ match, report: reports?.get(match.ref) ?? null })));
}

/** One row per match, with the opponent when there was one. */
export function historyListMarkup(items: readonly MatchHistoryItem[], selectable = false): string {
  if (items.length === 0) {
    return '<p class="account-note">No matches recorded yet.</p>';
  }
  const rows = items
    .map(({ match, report }: MatchHistoryItem) => {
      const opponent = report?.opponentCallsign
        ? `<span class="career-match-opponent">vs ${escapeCareerHtml(report.opponentCallsign)}</span>`
        : '';
      const map = report?.mapId
        ? `<span class="career-match-map">${escapeCareerHtml(report.mapId)}</span>`
        : '';
      const tag = selectable ? 'button' : 'div';
      const attrs = selectable
        ? `type="button" data-account-action="match" data-match-ref="${escapeCareerHtml(match.ref)}"`
        : '';
      return `
      <li class="career-match" data-outcome="${match.outcome}">
        <${tag} class="career-match-row" ${attrs}>
          <span class="career-match-outcome">${OUTCOME_LABEL[match.outcome]}</span>
          <span class="career-match-detail">${MODE_LABEL[match.mode]} · ${matchDuration(match.durationSeconds)}${map}</span>
          ${opponent}
          <span class="career-match-date">${matchDate(match.recordedAt)}</span>
          <b class="career-match-xp">+${match.xp}</b>
        </${tag}>
      </li>`;
    })
    .join('');
  return `<ul class="career-history" aria-label="Recent operations">${rows}</ul>`;
}

/** The expanded summary of one recorded match. */
export function matchDetailMarkup(item: MatchHistoryItem): string {
  const { match, report } = item;
  const rows: string[] = [
    `<div><span>MODE</span><b>${MODE_LABEL[match.mode]}</b></div>`,
    `<div><span>RESULT</span><b>${OUTCOME_LABEL[match.outcome]}</b></div>`,
    `<div><span>DURATION</span><b>${matchDuration(match.durationSeconds)}</b></div>`,
    `<div><span>XP</span><b>+${match.xp}</b></div>`,
  ];
  if (report?.opponentCallsign) {
    rows.push(`<div><span>OPPONENT</span><b>${escapeCareerHtml(report.opponentCallsign)}</b></div>`);
  }
  if (report?.opponentNation) {
    rows.push(`<div><span>OPPONENT NATION</span><b>${escapeCareerHtml(report.opponentNation)}</b></div>`);
  }
  if (match.nation) rows.push(`<div><span>NATION</span><b>${escapeCareerHtml(match.nation)}</b></div>`);
  if (report?.mapId) rows.push(`<div><span>MAP</span><b>${escapeCareerHtml(report.mapId)}</b></div>`);
  rows.push(`<div><span>UNITS DESTROYED</span><b>${match.kills}</b></div>`);
  rows.push(`<div><span>UNITS LOST</span><b>${match.unitsLost}</b></div>`);
  if (report) {
    rows.push(`<div><span>STRUCTURES DESTROYED</span><b>${report.structuresDestroyed}</b></div>`);
    rows.push(`<div><span>STRUCTURES LOST</span><b>${report.structuresLost}</b></div>`);
    rows.push(`<div><span>STRUCTURES BUILT</span><b>${report.structuresBuilt}</b></div>`);
    rows.push(`<div><span>SITES CAPTURED</span><b>${report.sitesCaptured}</b></div>`);
  }
  const reason = report?.breakdown?.reason;
  const status =
    report && report.rewardStatus !== 'awarded' && report.rewardStatus !== 'local'
      ? `<p class="account-note">${escapeCareerHtml(reason ?? 'This match did not award career XP.')}</p>`
      : '';
  return `<div class="career-match-detail-card" data-match-ref="${escapeCareerHtml(match.ref)}">
    <p class="section-title">MATCH ${escapeCareerHtml(match.ref)}</p>
    <div class="career-record-totals">${rows.join('')}</div>
    ${status}
  </div>`;
}

/** The player's name and badge, shown wherever an identity is presented. */
export function identityBannerMarkup(
  identity: IdentityView | null,
  rankName: string,
  grade: string,
  xp: number,
): string {
  const initial = (identity?.callsign ?? 'Guest').slice(0, 1).toUpperCase();
  return `<div class="identity-banner">
    <span class="identity-avatar" aria-hidden="true">${escapeCareerHtml(initial)}</span>
    <span class="identity-text">
      <b>${escapeCareerHtml(identity?.callsign ?? 'Guest commander')}</b>
      <small>${escapeCareerHtml(rankName)}${grade ? ` · ${escapeCareerHtml(grade)}` : ''} · ${xp.toLocaleString()} XP</small>
    </span>
  </div>`;
}

function record(row: StatBlock): string {
  const rate = row.winRate === null ? '—' : `${Math.round(row.winRate * 100)}%`;
  return `${row.matches} played · ${row.victories} won · ${row.defeats} lost · ${row.draws} drawn · ${rate}`;
}

function statCells(row: StatBlock): string {
  return `
    <div><span>MATCHES</span><b>${row.matches}</b></div>
    <div><span>WIN RATE</span><b>${row.winRate === null ? '—' : `${Math.round(row.winRate * 100)}%`}</b></div>
    <div><span>PLAYTIME</span><b>${playtime(row.playSeconds)}</b></div>
    <div><span>DESTROYED</span><b>${row.unitsDestroyed + row.structuresDestroyed}</b></div>
    <div><span>LOST</span><b>${row.unitsLost + row.structuresLost}</b></div>
    <div><span>BUILT</span><b>${row.structuresBuilt}</b></div>
    <div><span>SITES TAKEN</span><b>${row.sitesCaptured}</b></div>
    <div><span>XP</span><b>${row.xp.toLocaleString()}</b></div>`;
}

/**
 * Mode and nation breakdown.
 *
 * A mode with no matches is listed with an explicit "no record" line rather
 * than a row of zeros, because a zero that looks played is worse than an
 * honest blank.
 */
export function careerStatsMarkup(stats: CareerStats | null | undefined): string {
  if (!stats) {
    return '<p class="account-note">A detailed breakdown is stored with an MCA account; a guest record keeps totals only.</p>';
  }
  const modes = (['multiplayer', 'skirmish', 'campaign'] as CareerMode[])
    .map((mode) => {
      const row = stats.modes[mode];
      const body =
        row.matches === 0
          ? '<p class="account-note">No matches in this mode yet.</p>'
          : `<p class="career-mode-line">${record(row)}</p>
             <div class="career-record-totals">${statCells(row)}</div>`;
      return `<div class="career-mode" data-mode="${mode}">
        <p class="section-title">${MODE_LABEL[mode].toUpperCase()}</p>
        ${body}
      </div>`;
    })
    .join('');
  const nations = stats.nations.length
    ? `<p class="section-title">NATION RECORD</p>
       <ul class="career-nations" aria-label="Performance by nation">
         ${stats.nations
           .map(
             (line) => `<li>
               <span class="career-nation-name">${escapeCareerHtml(line.nation.toUpperCase())}</span>
               <span class="career-nation-line">${record(line)}</span>
             </li>`,
           )
           .join('')}
       </ul>`
    : '<p class="account-note">No nation record yet; it is filled by the nation you play.</p>';
  return `<div class="career-breakdown">
    <p class="section-title">OVERALL SERVICE</p>
    <div class="career-record-totals">${statCells(stats.overall)}</div>
    ${modes}
    ${nations}
  </div>`;
}

/** The full service record, used by the panel's modal. */
export function serviceRecordMarkup(
  snapshot: CareerSnapshot | null,
  options: {
    stats?: CareerStats | null;
    history?: readonly MatchHistoryItem[] | null;
    hasMore?: boolean;
  } = {},
): string {
  if (!snapshot) return '<p class="account-note">The service record is unavailable right now.</p>';
  const history = options.history ?? null;
  const historyMarkup = history
    ? `${historyListMarkup(history, true)}${options.hasMore ? '<button type="button" class="account-secondary" data-account-action="history-more">Load more matches</button>' : ''}`
    : careerHistoryMarkup(snapshot, 20);
  const totals = snapshot.view.totals;
  return `
    ${careerSummaryMarkup(snapshot)}
    <div class="career-record">
      <p class="section-title">SERVICE RECORD</p>
      <p class="section-title">RECENT OPERATIONS</p>
      ${historyMarkup}
      <div id="account-match-detail" class="account-match-detail"></div>
      <div class="career-record-totals">
        <div><span>KILLS</span><b>${totals.kills}</b></div>
        <div><span>UNITS LOST</span><b>${totals.unitsLost}</b></div>
        <div><span>DEFEATS</span><b>${totals.defeats}</b></div>
        <div><span>DRAWS</span><b>${totals.draws}</b></div>
      </div>
      ${careerStatsMarkup(options.stats ?? null)}
      <p class="account-note">Career XP is one ladder across every mode. Online matches pay a completion award plus duration, sites captured and units destroyed, scaled by the result, capped at 12 rewarded matches a day. A defeat still pays, so finishing a losing match is always better than leaving it. Kills and losses are recorded but earn nothing on their own.</p>
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

/**
 * The career block on the multiplayer result screen.
 *
 * It is built from the account service's own answer rather than from the
 * scoreboard: while that answer is pending the block says so, and when it
 * arrives it shows the award, the ranks either side of it and where the player
 * now stands on the ladder.
 */
export function mpCareerSummaryMarkup(result: MatchResultView | null): string {
  if (!result || result.status === 'pending') {
    return `<div class="end-career" data-state="pending" role="status">
      <span class="end-career-label">CAREER</span>
      <b>Synchronising your service record…</b>
    </div>`;
  }
  const { match, award } = result;
  const standing = award.rankAfter ? rankForXp(award.xpAfter) : null;
  const percent = standing ? Math.round(standing.progress * 100) : 100;
  const nextText = standing?.next
    ? `${standing.xpInto} / ${standing.xpSpan ?? 0} XP to ${escapeCareerHtml(standing.next.name)}`
    : 'Top of the ladder — every rank held';
  const promotion = award.promoted && award.rankAfter
    ? `<p class="career-promotion">PROMOTED TO ${escapeCareerHtml(award.rankAfter.name.toUpperCase())}</p>`
    : '';
  const reason = award.reason
    ? `<p class="account-note">${escapeCareerHtml(award.reason)}</p>`
    : '';
  const breakdown = award.breakdown
    ? `<p class="end-career-breakdown">
        PARTICIPATION ${award.breakdown.base} · COMPLETION ${award.breakdown.completion} ·
        DURATION ${award.breakdown.duration} · SITES ${award.breakdown.objectives} ·
        DESTRUCTION ${award.breakdown.performance} × ${award.breakdown.outcomeFactor}
      </p>`
    : '';
  return `<div class="end-career" data-state="recorded" data-outcome="${match.outcome}">
    <span class="end-career-label">CAREER</span>
    <span class="end-career-text">
      <b>+${award.xp.toLocaleString()} XP</b>
      <small>${award.rankBefore ? `${escapeCareerHtml(award.rankBefore.name)} → ` : ''}${award.rankAfter ? escapeCareerHtml(award.rankAfter.name) : 'Unranked'}</small>
    </span>
    <span class="end-career-xp">${award.xpBefore.toLocaleString()} → ${award.xpAfter.toLocaleString()} XP</span>
    ${promotion}
    <div class="career-progress" role="progressbar" aria-label="Progress to next rank"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>
    <p class="career-next">${nextText}</p>
    ${reason}
    ${breakdown}
  </div>`;
}
