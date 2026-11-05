import type { AmbienceKind } from './ambience';

/**
 * Recorded ambience.
 *
 * The bed began as pure synthesis: every family was an oscillator and a band of
 * noise. That reads clearly and costs nothing, but a recording carries detail a
 * recipe cannot — the unevenness of a real diesel, the body of a real boot. This
 * module is the desk between the two: it reads `public/audio/ambience/manifest.json`
 * defensively, and says how a recording is stretched as a hull goes from parked
 * to rolling.
 *
 * Nothing here touches Web Audio, so the manifest rules can be tested without a
 * graph, and a broken or missing manifest can only ever cost the recordings —
 * never the bed.
 */

export const AMBIENCE_AUDIO_ROOT = '/audio/ambience/';

/**
 * Longest loop the game keeps in memory.
 *
 * A field recording can run for minutes; the bed only needs a few stretches of
 * it. Twelve seconds at 48 kHz mono is roughly 2 MB decoded, which is affordable
 * per family in a way that five minutes is not, and long enough that the ear
 * does not pick out the repeat.
 */
export const MAX_LOOP_SECONDS = 12;

/**
 * Seam length for a loop that was not recorded to close on itself.
 *
 * The head is blended with the tail over this window with equal power, so a
 * recording that ends mid-swell loops without a click at the join.
 */
export const LOOP_SEAM_SECONDS = 0.06;

/** Playback-rate bounds. Past these a recording stops being machinery. */
export const MIN_LOOP_RATE = 0.4;
export const MAX_LOOP_RATE = 2.4;

export interface AmbienceLoopSpec {
  /** The family this recording speaks for. */
  kind: AmbienceKind;
  /** File name relative to the ambience root. */
  src: string;
  /** Level trim applied over the family's own bed trim. 1 keeps it as recorded. */
  gain: number;
  /** Playback rate at rest and at full travel. */
  idleRate: number;
  moveRate: number;
}

export interface AmbienceStepsSpec {
  /** Bootfall one-shots, alternated to build a stride. */
  src: string[];
  /** Time between footfalls in the assembled loop. */
  strideSeconds: number;
  /** Level trim for the assembled stride, over the infantry bed trim. */
  gain: number;
}

export interface AmbienceCredit {
  title: string;
  author: string;
  licence: string;
  source: string;
  files: string[];
}

export interface AmbienceSampleManifest {
  loops: AmbienceLoopSpec[];
  steps: AmbienceStepsSpec | null;
  credits: AmbienceCredit[];
}

const KINDS: ReadonlySet<string> = new Set<AmbienceKind>([
  'foot',
  'buggy',
  'truck',
  'trackedLight',
  'trackedHeavy',
  'rotor',
  'jet',
  'naval',
  'facility',
]);

/** A usable file reference: a relative path inside the ambience root. */
function fileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // The manifest is data, so it may not point outside its own directory.
  if (trimmed.startsWith('/') || trimmed.includes('..') || /^[a-z]+:/i.test(trimmed)) return null;
  return trimmed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Read a manifest, keeping only the rows that can actually be played.
 *
 * One malformed entry costs that family's recording and nothing else: the bed
 * falls back to synthesis for it, which is the same path it took before any
 * recording existed.
 */
export function parseAmbienceManifest(raw: unknown): AmbienceSampleManifest {
  const empty: AmbienceSampleManifest = { loops: [], steps: null, credits: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const doc = raw as Record<string, unknown>;
  const loops: AmbienceLoopSpec[] = [];
  const seen = new Set<AmbienceKind>();
  const rows = Array.isArray(doc.loops) ? doc.loops : [];
  for (const entry of rows) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.kind !== 'string' || !KINDS.has(row.kind)) continue;
    const kind = row.kind as AmbienceKind;
    // One recording per family: the first row wins, so a duplicated kind cannot
    // quietly replace the loop a hull is already carrying.
    if (seen.has(kind)) continue;
    const src = fileName(row.src);
    if (!src) continue;
    seen.add(kind);
    const idleRate = clamp(finite(row.idleRate, 1), MIN_LOOP_RATE, MAX_LOOP_RATE);
    loops.push({
      kind,
      src,
      gain: clamp(finite(row.gain, 1), 0, 2),
      idleRate,
      moveRate: clamp(finite(row.moveRate, idleRate), MIN_LOOP_RATE, MAX_LOOP_RATE),
    });
  }

  let steps: AmbienceStepsSpec | null = null;
  const rawSteps = doc.steps;
  if (rawSteps && typeof rawSteps === 'object') {
    const row = rawSteps as Record<string, unknown>;
    const files = (Array.isArray(row.src) ? row.src : [])
      .map(fileName)
      .filter((entry): entry is string => entry !== null);
    // One footfall is a click, not a march.
    if (files.length >= 2) {
      steps = {
        src: files,
        strideSeconds: clamp(finite(row.strideSeconds, 0.46), 0.2, 1.5),
        gain: clamp(finite(row.gain, 1), 0, 4),
      };
    }
  }

  const credits: AmbienceCredit[] = [];
  const rawCredits = Array.isArray(doc.credits) ? doc.credits : [];
  for (const entry of rawCredits) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.title !== 'string' || typeof row.source !== 'string') continue;
    credits.push({
      title: row.title,
      author: typeof row.author === 'string' ? row.author : 'unknown',
      licence: typeof row.licence === 'string' ? row.licence : 'unknown',
      source: row.source,
      files: (Array.isArray(row.files) ? row.files : [])
        .map(fileName)
        .filter((file): file is string => file !== null),
    });
  }

  return { loops, steps, credits };
}

/**
 * Playback rate for a recording at this much travel.
 *
 * Motion stretches the recording instead of only opening a filter, so a parked
 * hull and a rolling one differ in pitch the way real machinery does. The plan's
 * pitch is applied on top, which keeps one recording serving two families (a
 * light track and a laden truck share a diesel at different rates).
 */
export function loopRate(
  spec: { idleRate: number; moveRate: number },
  motion: number,
  pitch = 1,
): number {
  const travel = Number.isFinite(motion) ? Math.max(0, Math.min(1, motion)) : 0;
  const base = spec.idleRate + (spec.moveRate - spec.idleRate) * travel;
  const scale = Number.isFinite(pitch) ? pitch : 1;
  return clamp(base * scale, MIN_LOOP_RATE, MAX_LOOP_RATE);
}
