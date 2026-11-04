/**
 * Commander identity.
 *
 * The profile is deliberately small: a name, callsign, background and optional
 * pronouns. Validation is shared by the campaign start screen and the save
 * loader, so a hand-edited save cannot smuggle in a profile the UI would never
 * produce. Nothing here touches the simulation.
 */
import type { CommanderIdentity, CommanderPronouns } from './types';

export const COMMANDER_NAME_MAX = 32;
export const COMMANDER_CALLSIGN_MAX = 12;
export const COMMANDER_BACKGROUND_MAX = 280;

const NAME_MIN = 2;
const CALLSIGN_MIN = 2;
const BACKGROUND_MIN = 1;

const PRONOUNS: readonly CommanderPronouns[] = ['she/her', 'he/him', 'they/them'];

const CALLSIGN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 '\-.]*$/;

export function isCommanderPronouns(value: unknown): value is CommanderPronouns {
  return typeof value === 'string' && (PRONOUNS as readonly string[]).includes(value);
}

function measure(value: string): number {
  return [...value].length;
}

/**
 * Trim and validate a candidate profile.
 *
 * Returns the normalised identity, or throws with the first human-readable
 * problem. Missing optional fields are simply absent; old saves that predate
 * pronouns load through the same path.
 */
export function normaliseCommanderIdentity(raw: unknown): CommanderIdentity {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Commander profile is missing.');
  }
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const callsign = typeof record.callsign === 'string' ? record.callsign.trim() : '';
  const background = typeof record.background === 'string' ? record.background.trim() : '';

  if (measure(name) < NAME_MIN || measure(name) > COMMANDER_NAME_MAX) {
    throw new Error(`Commander name must be ${NAME_MIN}–${COMMANDER_NAME_MAX} characters.`);
  }
  if (measure(callsign) < CALLSIGN_MIN || measure(callsign) > COMMANDER_CALLSIGN_MAX) {
    throw new Error(`Callsign must be ${CALLSIGN_MIN}–${COMMANDER_CALLSIGN_MAX} characters.`);
  }
  if (!CALLSIGN_PATTERN.test(callsign)) {
    throw new Error('Callsign may contain letters, digits, spaces, apostrophes, dots and hyphens.');
  }
  if (measure(background) < BACKGROUND_MIN || measure(background) > COMMANDER_BACKGROUND_MAX) {
    throw new Error(`Background must be 1–${COMMANDER_BACKGROUND_MAX} characters.`);
  }

  const identity: CommanderIdentity = { name, callsign, background };
  // An unrecognised pronoun is dropped rather than rejecting the profile: it is
  // presentational, and an older or hand-edited save should still load.
  if (isCommanderPronouns(record.pronouns)) identity.pronouns = record.pronouns;
  return identity;
}

/** All validation problems, for inline form feedback. */
export function commanderIdentityIssues(raw: unknown): string[] {
  try {
    normaliseCommanderIdentity(raw);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

/** A safe profile for a migrated run that has not asked the player yet. */
export function defaultCommanderIdentity(): CommanderIdentity {
  return {
    name: 'Unassigned Commander',
    callsign: 'Kestrel',
    background: 'Profile not yet entered.',
  };
}
