/**
 * Pure settings vocabulary shared by the app, the HUD and the renderer.
 *
 * Keeping the normalisation here means a hand-edited or stale localStorage
 * blob can never put an out-of-range scale, an unknown preset or an invalid
 * render ratio into the live settings object. Every helper is total: an
 * unrecognised value falls back to the documented default rather than throwing.
 */

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'custom';
export type EscBehavior = 'pause' | 'menu';

/**
 * Authored-scene groups a player can switch on their own.
 *
 * The master `cinematics` switch still suppresses everything; these only split
 * the contexts so a player can keep the mission brief while turning the opening
 * framing off. Nothing here is read by the simulation.
 */
export type CinematicScope = 'campaign' | 'briefing' | 'battle';
export interface CinematicScopes {
  campaign: boolean;
  briefing: boolean;
  battle: boolean;
}
export const CINEMATIC_SCOPE_DEFAULT: CinematicScopes = {
  campaign: true,
  briefing: true,
  battle: true,
};

/** Map a cinematic context onto the group that owns it. */
export function cinematicScopeFor(kind: string): CinematicScope {
  if (kind === 'campaignIntro' || kind === 'intermission' || kind === 'campaignFinale') {
    return 'campaign';
  }
  if (kind === 'briefing') return 'briefing';
  return 'battle';
}

/** A stale or malformed settings blob keeps every group on. */
export function normaliseCinematicScopes(value: unknown): CinematicScopes {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    campaign: raw.campaign !== false,
    briefing: raw.briefing !== false,
    battle: raw.battle !== false,
  };
}

/**
 * Shadow fidelity. Basic is the long-standing projected-quad pass; detailed
 * renders a real depth map from the sun every frame, so structures, vehicles,
 * terrain and props cast and receive shadows with their own silhouettes.
 */
export type ShadowDetail = 'off' | 'basic' | 'detailed';
export const SHADOW_DETAILS: ShadowDetail[] = ['off', 'basic', 'detailed'];
export const SHADOW_DETAIL_LABELS: Record<ShadowDetail, string> = {
  off: 'Off',
  basic: 'Basic',
  detailed: 'Detailed',
};


/** Interface scale is a multiplier, not a percentage, throughout the code. */
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.5;
export const UI_SCALE_DEFAULT = 1;

/**
 * Edge panning. The band depth is in CSS pixels from the visible battlefield
 * edge; the speed is a multiplier on the authored camera travel.
 */
export const EDGE_PAN_WIDTH_MIN = 4;
export const EDGE_PAN_WIDTH_MAX = 48;
export const EDGE_PAN_WIDTH_DEFAULT = 18;
export const EDGE_PAN_SPEED_MIN = 0.4;
export const EDGE_PAN_SPEED_MAX = 2.5;
export const EDGE_PAN_SPEED_DEFAULT = 1;

/** Gamepad camera and cursor speed multiplier, applied on both sticks. */
export const GAMEPAD_SENSITIVITY_MIN = 0.4;
export const GAMEPAD_SENSITIVITY_MAX = 2.5;
export const GAMEPAD_SENSITIVITY_DEFAULT = 1;

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
  /** Shadow fidelity: none, the flat projected pass, or a real shadow map. */
  shadowDetail: ShadowDetail;
  /** Ground-contact occlusion; the main post effect for object grounding. */
  ambientOcclusion: boolean;
  /** HDR bloom around lamps, glints and explosions. */
  bloom: boolean;
  /** Water screen-space reflections; only worth its cost on High/Custom. */
  screenSpaceReflections: boolean;
  /** Short directional sun shadows that ground units on the road. */
  contactShadows: boolean;
  /** Animated water normals; off keeps the sea surface but freezes ripples. */
  waterDetail: boolean;
}

/**
 * Presets trade resolution for effects. High is the authored look; medium and
 * low are for integrated GPUs and phones, where fill rate is the bottleneck.
 */
export const GRAPHICS_PRESETS: Record<GraphicsQuality, GraphicsPreset> = {
  low: {
    renderScale: 0.7,
    maxParticles: 900,
    shadowDetail: 'off',
    ambientOcclusion: false,
    bloom: false,
    screenSpaceReflections: false,
    contactShadows: false,
    waterDetail: false,
  },
  medium: {
    renderScale: 0.85,
    maxParticles: 1800,
    shadowDetail: 'basic',
    ambientOcclusion: true,
    bloom: true,
    screenSpaceReflections: false,
    contactShadows: true,
    waterDetail: false,
  },
  high: {
    renderScale: 1,
    maxParticles: 2800,
    shadowDetail: 'detailed',
    ambientOcclusion: true,
    bloom: true,
    screenSpaceReflections: true,
    contactShadows: true,
    waterDetail: true,
  },
  // Custom starts from the authored look; selecting it preserves the player's
  // explicit effect switches instead of reapplying a preset.
  custom: {
    renderScale: 1,
    maxParticles: 2800,
    shadowDetail: 'detailed',
    ambientOcclusion: true,
    bloom: true,
    screenSpaceReflections: true,
    contactShadows: true,
    waterDetail: true,
  },
};

export const GRAPHICS_QUALITIES: GraphicsQuality[] = ['low', 'medium', 'high', 'custom'];

export function normaliseUiScale(value: unknown): number {
  // `null` and `''` coerce to 0, which would silently read as a deliberate
  // 80% choice; a missing field must take the default instead.
  if (value === null || value === undefined || value === '') return UI_SCALE_DEFAULT;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return UI_SCALE_DEFAULT;
  return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, n));
}

export function normaliseEdgePanWidth(value: unknown): number {
  if (value === null || value === undefined || value === '') return EDGE_PAN_WIDTH_DEFAULT;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return EDGE_PAN_WIDTH_DEFAULT;
  return Math.max(EDGE_PAN_WIDTH_MIN, Math.min(EDGE_PAN_WIDTH_MAX, n));
}

export function normaliseEdgePanSpeed(value: unknown): number {
  if (value === null || value === undefined || value === '') return EDGE_PAN_SPEED_DEFAULT;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return EDGE_PAN_SPEED_DEFAULT;
  return Math.max(EDGE_PAN_SPEED_MIN, Math.min(EDGE_PAN_SPEED_MAX, n));
}

export function normaliseGamepadSensitivity(value: unknown): number {
  if (value === null || value === undefined || value === '') {
    return GAMEPAD_SENSITIVITY_DEFAULT;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return GAMEPAD_SENSITIVITY_DEFAULT;
  return Math.max(
    GAMEPAD_SENSITIVITY_MIN,
    Math.min(GAMEPAD_SENSITIVITY_MAX, n),
  );
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

/** An unknown or stale shadow level falls back to the authored default. */
export function normaliseShadowDetail(value: unknown): ShadowDetail {
  return SHADOW_DETAILS.includes(value as ShadowDetail) ? (value as ShadowDetail) : 'detailed';
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
