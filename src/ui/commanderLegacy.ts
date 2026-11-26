/**
 * Commander Legacy.
 *
 * The formal service record: standing, decorations, national service, campaign
 * legacy and the milestones that produced them. It renders only what the career
 * view already says, so an account and a guest see the same screen with the same
 * rules, and a missing breakdown degrades to a short note instead of a broken
 * page.
 *
 * Identity, rank and level are the account page head's job: this screen opens
 * on the summary, so the same standing is not stated twice in one view.
 * Awards appear here as earned records. Nothing on this screen is equipable and
 * no field can imply a rank the career has not reached.
 */
import { CAMPAIGNS } from '../data/campaign';
import { NATIONS, PLAYABLE_NATION_IDS } from '../data/factions';
import type { CareerSnapshot } from '../accounts/careerService';
import { careerWinRate } from '../accounts/career';
import {
  ACHIEVEMENT_CATEGORY_LABEL,
  type AchievementView,
  type AwardDefinition,
  type AwardType,
} from '../accounts/achievements';
import { awardSvg, awardTypeLabel } from './awards';
import { escapeCareerHtml } from './careerView';

export interface CommanderLegacyInput {
  snapshot: CareerSnapshot | null;
}

const DECORATION_ORDER: AwardType[] = ['medal', 'ribbon', 'commendation'];
const DECORATION_PLURAL: Record<AwardType, string> = {
  medal: 'Medals',
  ribbon: 'Ribbons',
  commendation: 'Commendations',
};

function playtime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${minutes}m`;
}

function dateOf(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—';
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return '—';
  }
}

function awardOf(entry: AchievementView): AwardDefinition | null {
  return entry.award ?? null;
}

function decorationGroups(entries: readonly AchievementView[]): string {
  const earned = entries.filter((entry) => entry.complete && awardOf(entry));
  const locked = entries.filter((entry) => !entry.complete && awardOf(entry));
  const groups = DECORATION_ORDER.map((type) => {
    const rows = earned.filter((entry) => awardOf(entry)!.type === type);
    if (rows.length === 0) return '';
    return `<div class="legacy-rack" data-award-type="${type}">
      <p class="legacy-rack-title">${DECORATION_PLURAL[type].toUpperCase()} <span>${rows.length}</span></p>
      <ul class="legacy-award-list">${rows
        .slice()
        .sort((left, right) => (awardOf(left)!.priority - awardOf(right)!.priority) || left.order - right.order)
        .map(
          (entry) => `<li class="legacy-award" data-state="earned" data-award="${escapeCareerHtml(awardOf(entry)!.id)}">
            <details>
              <summary>
                ${awardSvg(awardOf(entry)!, { size: type === 'ribbon' ? 66 : 44 })}
                <span class="legacy-award-text">
                  <b>${escapeCareerHtml(awardOf(entry)!.name)}</b>
                  <small>${escapeCareerHtml(awardTypeLabel(type))} · ${dateOf(entry.awardedAt)}</small>
                </span>
              </summary>
              <div class="legacy-citation">
                <p>${escapeCareerHtml(awardOf(entry)!.description)}</p>
                <p class="legacy-citation-meta">${ACHIEVEMENT_CATEGORY_LABEL[entry.category].toUpperCase()} · ${escapeCareerHtml(entry.name)}${entry.nation ? ` · ${escapeCareerHtml(NATIONS[entry.nation]?.name ?? entry.nation)}` : ''}${entry.campaign ? ` · ${escapeCareerHtml(CAMPAIGNS.find((campaign) => campaign.id === entry.campaign)?.name ?? entry.campaign)}` : ''}</p>
              </div>
            </details>
          </li>`,
        )
        .join('')}</ul>
    </div>`;
  }).filter(Boolean);
  const lockedMarkup =
    locked.length > 0
      ? `<details class="legacy-locked">
          <summary>${locked.length} award${locked.length === 1 ? '' : 's'} not yet earned</summary>
          <ul class="legacy-award-list legacy-award-list-locked">${locked
            .slice()
            .sort((left, right) => left.order - right.order)
            .map(
              (entry) => `<li class="legacy-award" data-state="locked" data-award="${escapeCareerHtml(awardOf(entry)!.id)}">
                <div class="legacy-award-locked-row">
                  ${awardSvg(awardOf(entry)!, { size: awardOf(entry)!.type === 'ribbon' ? 66 : 44, className: 'award-art-locked' })}
                  <span class="legacy-award-text">
                    <b>${escapeCareerHtml(awardOf(entry)!.name)}</b>
                    <small>${escapeCareerHtml(awardTypeLabel(awardOf(entry)!.type))} · ${entry.progress} / ${entry.target}</small>
                  </span>
                </div>
                <p class="legacy-locked-citation">${escapeCareerHtml(entry.description)}</p>
              </li>`,
            )
            .join('')}</ul>
        </details>`
      : '';
  if (groups.length === 0 && !lockedMarkup) {
    return '<p class="account-note">No decorations yet. Complete an operation to open your first award.</p>';
  }
  return `${groups.join('')}${lockedMarkup}`;
}

function nationalService(entries: readonly AchievementView[]): string {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const rows = PLAYABLE_NATION_IDS.map((nationId) => {
    const nation = NATIONS[nationId];
    if (!nation) return '';
    const entry = byId.get(`${nationId}-service`) ?? null;
    const award = entry ? awardOf(entry) : null;
    const earned = entry?.complete === true;
    const percent = entry ? Math.round((entry.progress / Math.max(1, entry.target)) * 100) : 0;
    return `<li class="legacy-nation" data-nation="${escapeCareerHtml(nationId)}" data-state="${earned ? 'served' : 'open'}">
      ${award ? awardSvg(award, { size: 54, className: earned ? '' : 'award-art-locked' }) : ''}
      <span class="legacy-nation-text">
        <b>${escapeCareerHtml(nation.name)}</b>
        <small>${escapeCareerHtml(nation.allianceId === 'defender' ? 'Atlantic Accord' : 'Eurasian Pact')} · ${earned ? 'AWARDED' : `${entry?.progress ?? 0} / ${entry?.target ?? 1} victories`}</small>
      </span>
      <span class="legacy-nation-bar" aria-hidden="true"><i style="width:${percent}%"></i></span>
    </li>`;
  });
  return `<ul class="legacy-nations" aria-label="National service">${rows.join('')}</ul>`;
}

function campaignLegacy(snapshot: CareerSnapshot): string {
  const completed = new Map(
    (snapshot.view.campaigns ?? []).map((entry) => [entry.campaignId, entry.completedAt]),
  );
  const rows = CAMPAIGNS.map((campaign) => {
    const at = completed.get(campaign.id) ?? null;
    return `<li class="legacy-campaign" data-campaign="${escapeCareerHtml(campaign.id)}" data-state="${at ? 'complete' : 'open'}">
      <span class="legacy-campaign-mark" aria-hidden="true" style="--campaign-accent:${escapeCareerHtml(campaign.accent)}"></span>
      <span class="legacy-campaign-text">
        <b>${escapeCareerHtml(campaign.name)}</b>
        <small>${escapeCareerHtml(campaign.coalition)} · ${campaign.missions.length} operations</small>
      </span>
      <span class="legacy-campaign-state">${at ? `COMPLETE · ${dateOf(at)}` : 'IN PROGRESS'}</span>
    </li>`;
  });
  return `<ul class="legacy-campaigns" aria-label="Campaign legacy">${rows.join('')}</ul>`;
}

function milestones(entries: readonly AchievementView[]): string {
  const earned = entries
    .filter((entry) => entry.complete)
    .sort((left, right) => (left.awardedAt ?? 0) - (right.awardedAt ?? 0));
  if (earned.length === 0) {
    return '<p class="account-note">Your milestones appear here as they are earned.</p>';
  }
  const shown = earned.slice(-12).reverse();
  return `<ol class="legacy-milestones" aria-label="Career milestones">${shown
    .map(
      (entry) => `<li>
        <span class="legacy-milestone-date">${dateOf(entry.awardedAt)}</span>
        <span class="legacy-milestone-text">
          <b>${escapeCareerHtml(entry.name)}</b>
          <small>${ACHIEVEMENT_CATEGORY_LABEL[entry.category].toUpperCase()}${entry.award ? ` · ${escapeCareerHtml(entry.award.name)}` : ''}</small>
        </span>
      </li>`,
    )
    .join('')}</ol>`;
}

/** The complete showcase, or an honest empty state while the record loads. */
export function commanderLegacyMarkup(input: CommanderLegacyInput): string {
  const { snapshot } = input;
  if (!snapshot) {
    return '<p class="account-note">Reading your service record…</p>';
  }
  const view = snapshot.view;
  const totals = view.totals;
  const entries = view.achievements ?? [];
  const earned = entries.filter((entry) => entry.complete);
  const nationsServed = (view.stats?.nations ?? []).length;
  const campaignsCompleted = (view.campaigns ?? []).length;
  // Survival runs stay on the record as defeats but are not decided matches, so
  // the summary's rate ignores them (`careerWinRate` holds the rule).
  const rate = careerWinRate(totals);
  const winRate = rate === null ? 0 : Math.round(rate * 100);
  return `<div class="legacy" data-source="${snapshot.source}" data-state="${earned.length > 0 ? 'decorated' : 'opening'}">
    <section class="legacy-summary" aria-label="Career summary">
      <p class="section-title">SERVICE SUMMARY</p>
      <div class="legacy-summary-grid">
        <div><span>OPERATIONS</span><b>${totals.matches}</b></div>
        <div><span>VICTORIES</span><b>${totals.victories}</b></div>
        <div><span>WIN RATE</span><b>${winRate}%</b></div>
        <div><span>SERVICE TIME</span><b>${playtime(totals.playSeconds)}</b></div>
        <div><span>CAMPAIGNS</span><b>${campaignsCompleted}</b></div>
        <div><span>NATIONS SERVED</span><b>${nationsServed}</b></div>
        <div><span>DECORATIONS</span><b>${earned.length}</b></div>
        <div><span>DEFEATS</span><b>${totals.defeats}</b></div>
        <div><span>DRAWS</span><b>${totals.draws}</b></div>
      </div>
      ${snapshot.unavailable ? '<p class="account-notice" role="status" data-level="warning">The account service could not be reached, so this is the local guest record.</p>' : ''}
    </section>

    <section class="legacy-decorations" aria-label="Decorations">
      <p class="section-title">DECORATIONS <span>${earned.length} EARNED</span></p>
      ${decorationGroups(entries)}
    </section>

    <section class="legacy-national" aria-label="National service">
      <p class="section-title">NATIONAL SERVICE <span>${nationsServed} OF ${PLAYABLE_NATION_IDS.length} NATIONS</span></p>
      ${nationalService(entries)}
    </section>

    <section class="legacy-campaign" aria-label="Campaign legacy">
      <p class="section-title">CAMPAIGN LEGACY <span>${campaignsCompleted} COMPLETE</span></p>
      ${campaignLegacy(snapshot)}
    </section>

    <section class="legacy-milestone-section" aria-label="Career milestones">
      <p class="section-title">MILESTONES</p>
      ${milestones(entries)}
    </section>
  </div>`;
}
