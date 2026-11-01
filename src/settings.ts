/**
 * Pure settings vocabulary shared by the app, the HUD and the renderer.
 *
 * Keeping the normalisation here means a hand-edited or stale localStorage
 * blob can never put an out-of-range scale, an unknown preset or an invalid
 * render ratio into the live settings object. Every helper is total: an
 * unrecognised value falls back to the documented default rather than throwing.
 */

export type GraphicsQuality = 'low' | 'medium' | 'high';
export type EscBehavior = 'pause' | 'menu';

/** Interface scale is a multiplier, not a percentage, throughout the code. */
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.5;
export const UI_SCALE_DEFAULT = 1;

/** Render scale is a fraction of the device pixel ratio, capped below at 2. */
export const RENDER_SCALE_MIN = 0.5;
export const RENDER_SCALE_MAX = 1;
export const RENDER_SCALE_DEFAULT = 1;
export const DEVICE_PIXEL_RATIO_CAP = 2;

export interface GraphicsPreset {
  /** Fraction of the device pixel ratio the battlefield is drawn at. */
  renderScale: number;
  /** Live particle ceiling; older particles are shed first. */
  maxParticles: number;
  /** Flat projected shadows for units, structures and props. */
  shadows: boolean;
  /** Animated water normals; off keeps the sea surface but freezes ripples. */
  waterDetail: boolean;
}

/**
 * Presets trade resolution for effects. High is the authored look; medium and
 * low are for integrated GPUs and phones, where fill rate is the bottleneck.
 */
export const GRAPHICS_PRESETS: Record<GraphicsQuality, GraphicsPreset> = {
  low: { renderScale: 0.7, maxParticles: 900, shadows: false, waterDetail: false },
  medium: { renderScale: 0.85, maxParticles: 1800, shadows: true, waterDetail: false },
  high: { renderScale: 1, maxParticles: 2800, shadows: true, waterDetail: true },
};

export const GRAPHICS_QUALITIES: GraphicsQuality[] = ['low', 'medium', 'high'];

export function normaliseUiScale(value: unknown): number {
  // `null` and `''` coerce to 0, which would silently read as a deliberate
  // 80% choice; a missing field must take the default instead.
  if (value === null || value === undefined || value === '') return UI_SCALE_DEFAULT;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return UI_SCALE_DEFAULT;
  return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, n));
}

export function normaliseRenderScale(value: unknown): number {
  if (value === null || value === undefined || value === '') return RENDER_SCALE_DEFAULT;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return RENDER_SCALE_DEFAULT;
  return Math.max(RENDER_SCALE_MIN, Math.min(RENDER_SCALE_MAX, n));
}

export function normaliseGraphicsQuality(value: unknown): GraphicsQuality {
  return GRAPHICS_QUALITIES.includes(value as GraphicsQuality)
    ? (value as GraphicsQuality)
    : 'high';
}

export function normaliseEscBehavior(value: unknown): EscBehavior {
  return value === 'menu' ? 'menu' : 'pause';
}

/**
 * Additive light intensity. Presentation only: no gameplay rule reads this, so
 * two players with different settings still get identical detection and combat.
 */
export function normaliseLightBloom(value: unknown): number {
  if (value === null || value === undefined || value === '') return 1;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1.5, n));
}

/**
 * Graphics presets decide whether night lights are drawn at all. Low quality
 * keeps the darkness and the gameplay, and drops the additive pass.
 */
export function presetNightLights(quality: unknown): boolean {
  return normaliseGraphicsQuality(quality) !== 'low';
}

export function graphicsPreset(quality: unknown): GraphicsPreset {
  return GRAPHICS_PRESETS[normaliseGraphicsQuality(quality)];
}

/**
 * Backing-store density for the battlefield canvas. The render scale is a
 * fraction of the physical pixel ratio, and the 2x cap is the same one the
 * renderer has always applied, so a 3x phone never triples the fragment work.
 */
export function effectivePixelRatio(devicePixelRatio: number, renderScale: number): number {
  const base = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const scale = normaliseRenderScale(renderScale);
  return Math.min(DEVICE_PIXEL_RATIO_CAP, Math.max(0.5, base * scale));
}

/**
 * Next idle unit in a stable list. Returns -1 when there is nothing idle, and
 * wraps so repeated presses cycle rather than stopping at the end.
 */
export function nextIdleIndex(count: number, previous: number): number {
  if (!Number.isInteger(count) || count <= 0) return -1;
  if (!Number.isInteger(previous) || previous < -1) return 0;
  return previous + 1 >= count ? 0 : previous + 1;
}
