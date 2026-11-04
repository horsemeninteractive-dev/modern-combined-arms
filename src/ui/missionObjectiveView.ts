/**
 * Mission objective presentation.
 *
 * This is a read-only projection of the authoritative mission runtime: every
 * state, count and headline below comes from `Game.mission`, never from a UI
 * copy. Hidden objectives are excluded entirely, so the interface cannot reveal
 * an objective the player has not been told about yet.
 */
import type { Game } from '../sim/game';
import type { MissionObjectiveKind, MissionObjectiveState } from '../mission';
import { escapeHtml } from './modal';

export interface MissionObjectiveLine {
  id: string;
  title: string;
  description?: string;
  kind: MissionObjectiveKind;
  state: MissionObjectiveState;
}

export interface MissionObjectiveView {
  /** Active primary objectives, in authored order. */
  primary: MissionObjectiveLine[];
  /** Active secondary and bonus objectives, in authored order. */
  supporting: MissionObjectiveLine[];
  /** Complete and failed objectives, in authored order. */
  resolved: MissionObjectiveLine[];
  primaryCount: number;
  primaryComplete: number;
  failedCount: number;
  /** Compact line for the HUD: primary progress, support and failures. */
  summary: string;
  /** Rail / topbar headline. */
  headline: string;
}

/** One objective row, used by the objective sheet and the briefing. */
export function missionObjectiveMarkup(line: MissionObjectiveLine): string {
  const mark = line.state === 'complete' ? '✓' : line.state === 'failed' ? '✕' : '·';
  const label =
    line.kind === 'primary' ? 'PRIMARY' : line.kind === 'secondary' ? 'SECONDARY' : 'BONUS';
  const detail = line.description
    ? ` title="${escapeHtml(line.description)}"`
    : '';
  return `<li class="objective-line ${line.state}"${detail}><span class="objective-mark" aria-hidden="true">${mark}</span><span class="objective-title">${escapeHtml(line.title)}</span><em>${label}</em></li>`;
}

export function missionObjectiveView(game: Game): MissionObjectiveView | null {
  const mission = game.mission;
  if (!mission) return null;
  const lines: MissionObjectiveLine[] = mission.doc.objectives.map((objective) => ({
    id: objective.id,
    title: objective.title,
    ...(objective.description !== undefined ? { description: objective.description } : {}),
    kind: objective.kind,
    state: mission.objectiveState(objective.id) ?? 'hidden',
  }));
  const visible = lines.filter((line) => line.state !== 'hidden');
  const primary = visible.filter((line) => line.kind === 'primary' && line.state === 'active');
  const supporting = visible.filter((line) => line.kind !== 'primary' && line.state === 'active');
  const resolved = visible.filter(
    (line) => line.state === 'complete' || line.state === 'failed',
  );
  const primaryLines = lines.filter((line) => line.kind === 'primary');
  const primaryComplete = primaryLines.filter((line) => line.state === 'complete').length;
  const failedCount = visible.filter((line) => line.state === 'failed').length;

  const parts = [`${primaryComplete}/${primaryLines.length} PRIMARY`];
  if (supporting.length > 0) parts.push(`${supporting.length} SUPPORT`);
  if (failedCount > 0) parts.push(`${failedCount} FAILED`);

  const headline =
    primary[0]?.title ??
    (primaryLines.length > 0 && primaryComplete === primaryLines.length
      ? 'All primary objectives secured'
      : failedCount > 0
        ? 'Objective lost'
        : 'Mission in progress');

  return {
    primary,
    supporting,
    resolved,
    primaryCount: primaryLines.length,
    primaryComplete,
    failedCount,
    summary: parts.join(' · '),
    headline,
  };
}
