/**
 * Wave notices for a seat that does not simulate the run.
 *
 * Only the authoritative seat ticks the director, so only it ever receives the
 * director's event stream; the room publishes the wave state instead. This turns
 * two consecutive published samples into the same four notices — incoming,
 * contact, fully deployed, held — so a co-op partner's screen and radio keep up
 * without a second message channel. The state the seat already renders is the
 * whole input.
 */
import type { DirectorEvent, DirectorEventKind } from './director';
import type { OutbreakPhase } from './types';

/** The part of the published wave state the notices are read from. */
export interface RemoteWaveSample {
  wave: number;
  phase: OutbreakPhase;
  /** Bodies of this wave the room has not placed yet. */
  unspawned: number;
  secondsToAssault: number;
}

type NoticeKind = Extract<
  DirectorEventKind,
  'warning' | 'assault' | 'wave-cleared' | 'wave-complete'
>;

/**
 * The notices implied by moving from one published sample to the next.
 *
 * Each beat is announced on the transition into it, never while it holds, so a
 * seat rendering at any frame rate gets one notice per event rather than one per
 * frame. The first sample is silent: a seat that has just connected should show
 * the wave already in progress, not replay the announcements it missed.
 */
export function remoteWaveNotices(
  previous: RemoteWaveSample | null,
  next: RemoteWaveSample,
): DirectorEvent[] {
  if (!previous) return [];
  // A restarted room is running wave one again: a reset, not an announcement.
  if (next.wave < previous.wave) return [];

  const notices: DirectorEvent[] = [];
  const say = (kind: NoticeKind, wave: number): void => {
    notices.push({ kind, wave, secondsToAssault: next.secondsToAssault });
  };
  /** True when this sample is the first one to see `phase` in this wave. */
  const entered = (phase: OutbreakPhase): boolean =>
    next.phase === phase && (previous.phase !== phase || previous.wave !== next.wave);

  // A wave that ended between two samples still gets its recovery beat, even if
  // no sample caught the pause between the last body and the next preparation.
  if (next.wave > previous.wave && previous.phase !== 'complete') say('wave-complete', previous.wave);
  if (entered('warning')) say('warning', next.wave);
  if (entered('assault')) say('assault', next.wave);
  // Every body this wave planned is on the field: the arrival window is closed.
  if (next.unspawned === 0 && previous.unspawned > 0) say('wave-cleared', next.wave);
  if (entered('complete')) say('wave-complete', next.wave);
  return notices;
}
