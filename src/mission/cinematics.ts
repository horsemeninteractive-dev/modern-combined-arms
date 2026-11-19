/**
 * Cinematic selection rules.
 *
 * A context may carry more than one sequence. Selection is pure data logic so
 * the runtime, the workbench and tests all agree on what plays and in which
 * order without depending on document array order for in-mission scenes.
 */
import type { MissionCinematicContext, MissionCinematicDoc } from './types';

/**
 * All sequences for one context, in playback order.
 *
 * Opening, briefing, debrief, intermission, ending and campaign scenes play in
 * the order the author wrote them. An in-mission sequence is also ordered by
 * its authored time gate, with ties broken by document order, so two scenes at
 * the same second keep the timeline the author saw.
 */
export function orderedCinematics(
  cinematics: readonly MissionCinematicDoc[],
  kind: MissionCinematicContext,
): MissionCinematicDoc[] {
  const matches = cinematics.filter((entry) => entry.kind === kind);
  if (kind !== 'inMission') return matches;
  return matches
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        (a.entry.atSeconds ?? 0) - (b.entry.atSeconds ?? 0) || a.index - b.index,
    )
    .map((item) => item.entry);
}

/** In-mission sequences whose time has arrived and that have not been shown. */
export function dueInMissionCinematics(
  cinematics: readonly MissionCinematicDoc[],
  seconds: number,
  shown: ReadonlySet<string>,
): MissionCinematicDoc[] {
  return orderedCinematics(cinematics, 'inMission').filter(
    (entry) =>
      !shown.has(entry.id) && (entry.atSeconds ?? Number.POSITIVE_INFINITY) <= seconds,
  );
}

/** Every context a mission document may author. Campaign scenes live elsewhere. */
export const MISSION_CINEMATIC_CONTEXTS: readonly MissionCinematicContext[] = [
  'opening',
  'briefing',
  'inMission',
  'debrief',
  'intermission',
  'ending',
];

/** Contexts that belong on a campaign definition rather than a mission. */
export const CAMPAIGN_CINEMATIC_CONTEXTS: readonly MissionCinematicContext[] = [
  'campaignIntro',
  'campaignFinale',
];

/** True when a sequence is safe to start from a mission trigger. */
export function isTriggerableCinematic(doc: MissionCinematicDoc): boolean {
  return doc.kind === 'inMission';
}