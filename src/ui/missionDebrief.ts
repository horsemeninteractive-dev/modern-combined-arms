/**
 * Mission debrief presentation.
 *
 * Everything rendered here comes from the captured `MissionResult`; nothing is
 * recounted from the live HUD or invented to fit a narrative. Hidden objectives
 * are omitted so the debrief cannot reveal authored content the player never
 * met, and the counters are the ones the simulation actually keeps.
 *
 * A campaign outlook may be supplied for the "if accepted" section. It is
 * derived from the pending result and is explicitly not applied: acceptance
 * remains the only transaction that changes the roster or campaign variables.
 */
import type { MissionDoc, MissionResult, MissionValue } from '../mission';
import type { CampaignOutlook } from '../campaign/outlook';
import { escapeHtml } from './modal';

export interface MissionDebriefContext {
  mission?: MissionDoc;
  outlook?: CampaignOutlook | null;
}

export function missionClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** End-screen heading and copy for a mission, derived from the result. */
export function missionOutcomeCopy(
  result: MissionResult,
  mission?: MissionDoc,
): { heading: string; copy: string } {
  const authored = mission?.debrief?.[result.outcome];
  if (result.outcome === 'victory') {
    return {
      heading: 'Operation Complete',
      copy: authored ?? 'All primary objectives secured. The operation is complete.',
    };
  }
  const failedPrimary = result.objectives.some(
    (objective) => objective.kind === 'primary' && objective.state === 'failed',
  );
  return {
    heading: 'Operation Failed',
    copy:
      authored ??
      (failedPrimary
        ? 'A primary objective was lost. The operation has failed.'
        : 'Your force was destroyed before the operation could be completed.'),
  };
}

function valueLabel(value: MissionValue): string {
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  return escapeHtml(String(value));
}

function outlookMarkup(outlook: CampaignOutlook): string {
  const consequences = outlook.consequences
    .map(
      (consequence) =>
        `<li><span>${escapeHtml(consequence.key)}</span><b>${valueLabel(consequence.value)}</b>${
          consequence.description
            ? `<small>${escapeHtml(consequence.description)}</small>`
            : ''
        }</li>`,
    )
    .join('');
  const veterans = outlook.veterans
    .map(
      (veteran) =>
        `<li class="${veteran.lost ? 'lost' : 'survived'}"><span>${escapeHtml(veteran.name)}</span><b>${
          veteran.lost ? 'PERMANENTLY LOST' : 'SURVIVES'
        }</b></li>`,
    )
    .join('');
  const next = outlook.finalOperation
    ? '<li><span>CAMPAIGN</span><b>FINAL OPERATION ACCEPTED</b></li>'
    : `<li><span>NEXT OPERATION</span><b>${escapeHtml(outlook.nextMissionName ?? outlook.nextMissionId ?? '—')}</b></li>`;
  return `
    <div class="mission-debrief-outlook">
      <h4>IF ACCEPTED</h4>
      <p class="mission-debrief-boundary">Not yet applied. Accepting this result commits these changes; retrying restores the force and campaign state from before the operation.</p>
      ${consequences ? `<ul class="mission-debrief-consequences">${consequences}</ul>` : ''}
      ${veterans ? `<ul class="mission-debrief-veterans">${veterans}</ul>` : ''}
      <ul class="mission-debrief-consequences">${next}</ul>
    </div>`;
}

export function missionDebriefMarkup(
  result: MissionResult,
  context: MissionDebriefContext = {},
): string {
  const objectives = result.objectives
    .filter((objective) => objective.state !== 'hidden')
    .map((objective) => {
      const mark = objective.state === 'complete' ? '✓' : objective.state === 'failed' ? '✕' : '·';
      // The state is written out as well as colour-coded, so the list is legible
      // without hue and reads correctly to a screen reader.
      const state = objective.state.toUpperCase();
      return `<li class="${objective.state}"><span class="objective-mark" aria-hidden="true">${mark}</span>${escapeHtml(objective.title)}<em>${state} · ${objective.kind.toUpperCase()}</em></li>`;
    })
    .join('');
  const assets = result.entities
    // An enemy command post is the objective, not a friendly named asset that
    // was lost; the objective list already reports it.
    .filter((entity) => entity.role !== 'objective')
    .map((entity) => {
      const name = entity.name ?? entity.key;
      return `<li class="${entity.survived ? 'survived' : 'lost'}"><span>${escapeHtml(name)}</span><b>${entity.survived ? 'SURVIVED' : 'LOST'}</b></li>`;
    })
    .join('');
  return `
    <div class="mission-debrief">
      <h3>MISSION DEBRIEF</h3>
      ${objectives ? `<ul class="mission-debrief-objectives">${objectives}</ul>` : ''}
      <div class="mission-debrief-facts">
        <span>MISSION TIME <b>${missionClock(result.elapsedSeconds)}</b></span>
        <span>FRIENDLY LOSSES <b>${result.friendly.unitsLost}</b></span>
        <span>ENEMY LOSSES <b>${result.enemy.unitsLost}</b></span>
        <span>KILLS <b>${result.friendly.kills}</b></span>
        <span>UNITS BUILT <b>${result.friendly.unitsBuilt}</b></span>
        <span>STRUCTURES <b>${result.friendly.buildingsBuilt}</b></span>
      </div>
      ${assets ? `<h4>NAMED ASSETS</h4><ul class="mission-debrief-assets">${assets}</ul>` : ''}
      ${context.outlook ? outlookMarkup(context.outlook) : ''}
    </div>`;
}
