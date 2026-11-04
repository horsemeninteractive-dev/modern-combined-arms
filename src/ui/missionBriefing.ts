/**
 * Mission briefing presentation.
 *
 * The dossier is built from structured `MissionBriefing` fields, never by
 * parsing prose. Objective visibility follows the mission document: an objective
 * authored as `hidden` is not mentioned, so a briefing cannot reveal a reveal.
 * The same helper is used by the campaign deck and by the in-battle briefing.
 */
import type { MissionBriefing, MissionDoc, MissionObjectiveDoc } from '../mission';
import type { CommanderIdentity } from '../campaign/types';
import { escapeHtml } from './modal';

export type BriefingCommander = Pick<CommanderIdentity, 'name' | 'callsign'> | null;

const KIND_ORDER: Record<MissionObjectiveDoc['kind'], number> = {
  primary: 0,
  secondary: 1,
  bonus: 2,
};

const KIND_LABEL: Record<MissionObjectiveDoc['kind'], string> = {
  primary: 'PRIMARY',
  secondary: 'SECONDARY',
  bonus: 'BONUS',
};

/**
 * Replace the two authored commander tokens. Everything else is left as plain
 * text and escaped by the caller, so an authored angle bracket cannot become
 * markup.
 */
export function briefingText(text: string, commander: BriefingCommander): string {
  if (!commander) return text;
  return text
    .replaceAll('{{name}}', commander.name)
    .replaceAll('{{callsign}}', commander.callsign);
}

/** Objectives a briefing may show. Trigger-gated objectives stay hidden. */
export function briefingObjectives(doc: MissionDoc): MissionObjectiveDoc[] {
  return doc.objectives
    .filter((objective) => objective.initialState !== 'hidden')
    .slice()
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

export function briefingObjectiveRows(
  doc: MissionDoc,
  commander: BriefingCommander,
): Array<{ id: string; title: string; description: string | null; kind: MissionObjectiveDoc['kind']; kindLabel: string }> {
  return briefingObjectives(doc).map((objective) => ({
    id: objective.id,
    title: briefingText(objective.title, commander),
    description: objective.description ? briefingText(objective.description, commander) : null,
    kind: objective.kind,
    kindLabel: KIND_LABEL[objective.kind],
  }));
}

/** Objective list markup shared by the deck and the in-battle briefing. */
export function briefingObjectiveListMarkup(
  doc: MissionDoc,
  commander: BriefingCommander,
): string {
  return briefingObjectiveRows(doc, commander)
    .map(
      (objective) =>
        `<li class="${objective.kind}"><b>${escapeHtml(objective.title)}</b><em>${objective.kindLabel}</em>${
          objective.description
            ? `<span class="objective-description">${escapeHtml(objective.description)}</span>`
            : ''
        }</li>`,
    )
    .join('');
}

function section(title: string, body: string): string {
  return body ? `<h4>${title}</h4>${body}` : '';
}

function paragraph(text: string | undefined): string {
  return text ? `<p>${escapeHtml(text)}</p>` : '';
}

function list(items: readonly string[] | undefined, ordered = false): string {
  if (!items || items.length === 0) return '';
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
}

export interface MissionBriefingMarkupOptions {
  commander?: BriefingCommander;
  /** Operation code shown above the title, when it has one. */
  code?: string;
}

/**
 * A self-contained briefing block. It is deliberately a fragment: the campaign
 * deck places it in its dossier, the in-battle F1 sheet places it above the
 * controls, and a future mission library can place it anywhere else.
 */
export function missionBriefingMarkup(
  doc: MissionDoc,
  options: MissionBriefingMarkupOptions = {},
): string {
  const commander = options.commander ?? null;
  const briefing: MissionBriefing = doc.briefing;
  const text = (value: string) => escapeHtml(briefingText(value, commander));
  const commanderNote = briefing.commanderNote
    ? `<p class="mission-briefing-note">${text(briefing.commanderNote)}</p>`
    : '';
  return `
    <div class="mission-briefing">
      <p class="mission-briefing-code">${escapeHtml(options.code ?? doc.campaign?.campaignId ?? 'STANDALONE')}</p>
      <h3>${escapeHtml(doc.title)}</h3>
      ${briefing.subtitle ? `<p class="mission-briefing-subtitle">${text(briefing.subtitle)}</p>` : ''}
      ${section('SITUATION', paragraph(briefingText(briefing.summary, commander)))}
      ${briefing.context ? `<p class="mission-briefing-context">${text(briefing.context)}</p>` : ''}
      ${section(
        'OBJECTIVES',
        `<ul class="briefing-objectives mission-briefing-objectives">${briefingObjectiveListMarkup(
          doc,
          commander,
        )}</ul>`,
      )}
      ${section('FRIENDLY FORCES', paragraph(briefingText(briefing.friendly, commander)))}
      ${section('NAMED PERSONNEL', list(briefing.personnel?.map((entry) => briefingText(entry, commander))))}
      ${section('ENEMY', paragraph(briefingText(briefing.enemy, commander)))}
      ${section('ENEMY INTENT', paragraph(briefing.enemyIntent ? briefingText(briefing.enemyIntent, commander) : undefined))}
      ${section(
        'INSTRUCTIONS',
        list(briefing.instructions?.map((entry) => briefingText(entry, commander)), true),
      )}
      ${commanderNote}
    </div>`;
}
