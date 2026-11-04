import { tryIdentityDef } from './factions';
import type { AnnouncementId } from '../ui/announcer';

/**
 * Battlefield narrator identities.
 *
 * A narrator is a presentation identity, not a simulation concept: the
 * simulation emits the same presentation-neutral events for every seat, and
 * this table decides which voice and which asset directory deliver them. The
 * hand-off point is `announcementForEvent` in `ui/announcer.ts`, which stays
 * entirely ignorant of factions.
 *
 * Resolution is by alliance, not by nation. Adding a nation to an existing
 * alliance needs no change here; adding a third alliance needs one entry.
 */

export type NarratorId = 'defender' | 'eastern';

export interface NarratorVoice {
  /**
   * Kokoro voice used to synthesise this narrator's lines.
   *
   * Recorded even for the Defender narrator, whose shipped clips predate the
   * narrator catalogue and were not made with Kokoro at all: the value is the
   * closest Kokoro female voice to those recordings and exists only so a future
   * Defender line could be generated in a similar register. No generated clip
   * replaces a shipped one.
   */
  voice: string;
  /** Kokoro speech rate for new lines. */
  speed: number;
  /** Processing preset in tools/narrator-voice/generate.py. */
  preset: string;
}

export interface NarratorDef {
  readonly id: NarratorId;
  /** Short identity label for documentation and diagnostics. */
  readonly label: string;
  /** Alliance id this narrator reports for. */
  readonly allianceId: string;
  /**
   * Public directory holding this narrator's clips, without a trailing slash.
   * Filenames are shared across narrators, so one cue table serves both.
   */
  readonly root: string;
  /** Reported-party voice, for the settings surface and documentation. */
  readonly character: string;
  readonly voice: NarratorVoice;
  /**
   * True when the shipped clips are an existing recording rather than generator
   * output. Legacy assets are never overwritten by the narrator generator.
   */
  readonly legacyAssets: boolean;
}

const NARRATORS: Readonly<Record<NarratorId, NarratorDef>> = Object.freeze({
  defender: Object.freeze({
    id: 'defender',
    label: 'Defender tactical AI',
    allianceId: 'defender',
    root: '/audio/narrator/defender',
    character: 'Female coalition tactical AI. Precise, clipped, matter-of-fact reporting.',
    // The shipped recordings are authoritative and were not produced with
    // Kokoro, so they are never regenerated. af_bella is the nearest Kokoro
    // female by measured median pitch and brightness and is only a fallback for
    // a future Defender line.
    voice: Object.freeze({ voice: 'af_bella', speed: 1.0, preset: 'command' }),
    legacyAssets: true,
  }),
  eastern: Object.freeze({
    id: 'eastern',
    label: 'Eastern command AI',
    allianceId: 'eastern',
    root: '/audio/narrator/eastern',
    character: 'Male command-network AI. Composed, procedural, operational phrasing.',
    // One short sentence per cue and a composed, uncoloured male voice: the
    // Defender reports in two clauses, this narrator states the fact and stops.
    // am_adam was chosen by ear from the candidate page, so it is the shipped
    // choice rather than an inference from measurements.
    voice: Object.freeze({ voice: 'am_adam', speed: 0.97, preset: 'command-east' }),
    legacyAssets: false,
  }),
});

export const NARRATOR_IDS: readonly NarratorId[] = Object.freeze(['defender', 'eastern']);
export const NARRATOR_LIST: readonly NarratorDef[] = Object.freeze(
  NARRATOR_IDS.map((id) => NARRATORS[id]),
);

/** The fallback narrator. An unknown alliance still gets an intelligible voice. */
export const DEFAULT_NARRATOR: NarratorId = 'defender';

export function isNarratorId(value: unknown): value is NarratorId {
  return typeof value === 'string' && Object.hasOwn(NARRATORS, value);
}

export function narratorDef(id: NarratorId): NarratorDef {
  return NARRATORS[id];
}

/**
 * Alliance id to narrator. Unknown, empty and malformed values fall back to the
 * Defender voice rather than going silent: a missing configuration must never
 * cost the player their battlefield reports.
 */
export function narratorIdForAlliance(allianceId: string | undefined | null): NarratorId {
  if (!allianceId) return DEFAULT_NARRATOR;
  const found = NARRATOR_LIST.find((def) => def.allianceId === allianceId);
  return found ? found.id : DEFAULT_NARRATOR;
}

/**
 * Faction id (a nation, or a legacy `baltic` / `expeditionary` preset) to
 * narrator. Identity resolution is the same one the HUD, flags and roster use,
 * so a seat cannot end up hearing a voice its own badge contradicts.
 */
export function narratorIdForFaction(factionId: string | undefined | null): NarratorId {
  const identity = tryIdentityDef(factionId ?? '');
  return narratorIdForAlliance(identity?.allianceId);
}

export function narratorForFaction(factionId: string | undefined | null): NarratorDef {
  return NARRATORS[narratorIdForFaction(factionId)];
}

/** Public path for one narrator's clip. */
export function narratorAssetPath(narrator: NarratorId, file: string): string {
  return `${NARRATORS[narrator].root}/${file}`;
}

/**
 * Every narrator advertises the same cue coverage. The generator records the
 * spoken text per narrator, and this list is what its validation compares
 * against, so a new cue cannot ship with only one voice.
 */
export const NARRATOR_CUE_IDS: readonly AnnouncementId[] = Object.freeze([
  'constructionComplete',
  'buildingUnderConstruction',
  'buildingSold',
  'structureLost',
  'unitReady',
  'productionUnderway',
  'productionCancelled',
  'queueFull',
  'reinforcementsAvailable',
  'upgradeComplete',
  'siteSecured',
  'siteContested',
  'siteLost',
  'powerRestored',
  'technologyUnlocked',
  'baseUnderAttack',
  'forcesUnderAttack',
  'unitLost',
  'enemyDetected',
  'unitPromoted',
  'rallyPointSet',
  'battlefieldEstablished',
  'victory',
]);
