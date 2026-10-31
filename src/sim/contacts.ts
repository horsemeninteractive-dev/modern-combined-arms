/**
 * Contact knowledge: how long a sighting stays useful, and how it should read.
 *
 * The simulation stores the state on the record itself; these helpers are the
 * one place that defines the windows and the presentation contract, so the HUD,
 * the tactical map and any future briefing read the same rules. Everything here
 * is derived from observed data only — a contact never gains information it did
 * not have while the unit was visible.
 */

import type { ContactBand, ContactRecord, ContactState } from './types';

/**
 * A sighting stays `detected` for eight seconds after vision drops, then becomes
 * `last-known` until the thirty-second expiry. Both windows are in simulation
 * ticks at 20 Hz.
 */
export const CONTACT_DETECTED_TICKS = 8 * 20;
export const CONTACT_EXPIRE_TICKS = 30 * 20;

export const CONTACT_BAND_LABEL: Record<ContactBand, string> = {
  infantry: 'INFANTRY',
  armour: 'ARMOUR',
  air: 'AIR',
  naval: 'NAVAL',
  structure: 'STRUCTURE',
};

/** Ticks since the last confirmed sighting, never negative. */
export function contactAge(nowTick: number, contact: ContactRecord): number {
  return Math.max(0, nowTick - contact.tick);
}

/**
 * The state a contact should be read as right now. Stored state is authoritative
 * for records written by this build; a record from an older save has no state and
 * is treated as a confirmed sighting until it is aged by the simulation.
 */
export function contactStateOf(contact: ContactRecord): ContactState {
  return contact.state ?? 'confirmed';
}

/** True when the exact unit type is known and may be named. */
export function contactIsClassified(contact: ContactRecord): boolean {
  return contactStateOf(contact) === 'confirmed' && typeof contact.defId === 'string';
}

/**
 * Opacity for a remembered contact: full while confirmed, slightly reduced while
 * detected, and fading across the last-known window so an old mark never reads as
 * a live target. Floors at 0.18 rather than vanishing, because the marker is
 * about to expire anyway.
 */
export function contactAlpha(nowTick: number, contact: ContactRecord): number {
  const state = contactStateOf(contact);
  if (state === 'confirmed') return 1;
  const age = contactAge(nowTick, contact);
  if (state === 'detected') {
    const span = Math.max(1, CONTACT_DETECTED_TICKS);
    return 0.72 - 0.12 * Math.min(1, age / span);
  }
  const span = Math.max(1, CONTACT_EXPIRE_TICKS - CONTACT_DETECTED_TICKS);
  const faded = Math.min(1, Math.max(0, (age - CONTACT_DETECTED_TICKS) / span));
  return 0.6 - 0.42 * faded;
}

/**
 * Short caption for a contact marker. A confirmed contact may be named for its
 * band, a detected one is marked uncertain, and a last-known one says so rather
 * than pretending to identify anything.
 */
export function contactLabel(contact: ContactRecord): string {
  const state = contactStateOf(contact);
  if (state === 'confirmed') {
    return contact.band ? CONTACT_BAND_LABEL[contact.band] : 'CONFIRMED';
  }
  if (state === 'detected') {
    return contact.band ? `${CONTACT_BAND_LABEL[contact.band]}?` : 'CONTACT?';
  }
  return 'LAST KNOWN';
}

/**
 * Whether the marker should be drawn as a hollow ring. An unclassified contact is
 * hollow so the shape itself says "position only"; a classified one is solid.
 * Last-known marks are hollow and faded regardless.
 */
export function contactIsHollow(contact: ContactRecord): boolean {
  const state = contactStateOf(contact);
  return state !== 'confirmed' || !contact.defId;
}
