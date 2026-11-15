/**
 * Colour-vision palettes for ownership, health and alert signals.
 *
 * The standard palette keeps the shipped colours. The three alternate presets
 * separate the pairs that red-green and blue-yellow deficiencies compress:
 * friend/hostile, healthy/damaged, and routine/warning/critical. Colour is
 * never the only channel; the renderers add solid, dashed or patterned marks
 * alongside every palette.
 *
 * This module is deliberately free of DOM and renderer dependencies so the
 * settings normaliser, CSS bridge, canvas overlay and tests all read one source.
 */

export type ColorVisionPalette =
  | 'standard'
  | 'deuteranopia'
  | 'protanopia'
  | 'tritanopia';

export interface ColorVisionTokens {
  /** Local/allied ownership. */
  friendly: string;
  friendlySoft: string;
  /** Hostile ownership. */
  hostile: string;
  hostileSoft: string;
  /** Unowned structures and objectives. */
  neutral: string;
  /** Health and supply tones. */
  ok: string;
  okSoft: string;
  wounded: string;
  woundedSoft: string;
  critical: string;
  criticalSoft: string;
  /** Alert tones. */
  info: string;
  infoSoft: string;
  success: string;
  successSoft: string;
}

export interface ColorVisionPaletteDef {
  id: ColorVisionPalette;
  label: string;
  /** Short line for the settings sheet; names the colour pair it separates. */
  description: string;
  tokens: ColorVisionTokens;
}

const STANDARD: ColorVisionTokens = {
  friendly: '#52c5e6',
  friendlySoft: '#a6e8f8',
  hostile: '#ef6c4d',
  hostileSoft: '#ffb29b',
  neutral: '#b9c6c1',
  ok: '#86c791',
  okSoft: '#b6e3bd',
  wounded: '#e0a34a',
  woundedSoft: '#f1c27e',
  critical: '#ef6c4d',
  criticalSoft: '#ffb29b',
  info: '#52c5e6',
  infoSoft: '#a6e8f8',
  success: '#86c791',
  successSoft: '#b6e3bd',
};

/**
 * Red-green deficiency: blue and orange remain separable, while health and
 * alert severity use blue, yellow and magenta rather than green/red.
 */
const DEUTERANOPIA: ColorVisionTokens = {
  friendly: '#4ea8ff',
  friendlySoft: '#a8d4ff',
  hostile: '#ff9f43',
  hostileSoft: '#ffd2a3',
  neutral: '#c7cfcc',
  ok: '#5fd4ff',
  okSoft: '#b5edff',
  wounded: '#ffd166',
  woundedSoft: '#ffe6a8',
  critical: '#ff6b9d',
  criticalSoft: '#ffb3c9',
  info: '#5fd4ff',
  infoSoft: '#b5edff',
  success: '#7fe0c3',
  successSoft: '#b8f0df',
};

/** Red deficiency: cyan and orange replace the compressed red/green pair. */
const PROTANOPIA: ColorVisionTokens = {
  friendly: '#41c7f0',
  friendlySoft: '#a5e8f8',
  hostile: '#ff8c42',
  hostileSoft: '#ffc59b',
  neutral: '#d0d4cf',
  ok: '#41c7f0',
  okSoft: '#a5e8f8',
  wounded: '#ffc857',
  woundedSoft: '#ffe3a0',
  critical: '#ff5c8a',
  criticalSoft: '#ffadc3',
  info: '#41c7f0',
  infoSoft: '#a5e8f8',
  success: '#7dd3b0',
  successSoft: '#b9ead8',
};

/**
 * Blue-yellow deficiency: teal and magenta carry ownership, and amber/violet
 * carry health and alerts without relying on the blue-yellow axis.
 */
const TRITANOPIA: ColorVisionTokens = {
  friendly: '#2fd6a8',
  friendlySoft: '#a6f1dd',
  hostile: '#ff69b4',
  hostileSoft: '#ffb4d9',
  neutral: '#d8d2c4',
  ok: '#2fd6a8',
  okSoft: '#a6f1dd',
  wounded: '#ff9f43',
  woundedSoft: '#ffd2a3',
  critical: '#c77dff',
  criticalSoft: '#e4c2ff',
  info: '#b8c7ff',
  infoSoft: '#dbe2ff',
  success: '#2fd6a8',
  successSoft: '#a6f1dd',
};

export const COLOR_VISION_PALETTES: readonly ColorVisionPaletteDef[] = Object.freeze([
  {
    id: 'standard',
    label: 'Standard',
    description: 'The shipped command colours.',
    tokens: STANDARD,
  },
  {
    id: 'deuteranopia',
    label: 'Deuteranopia — blue / orange',
    description: 'Separates red from green with blue, orange and magenta.',
    tokens: DEUTERANOPIA,
  },
  {
    id: 'protanopia',
    label: 'Protanopia — cyan / orange',
    description: 'Separates red from green with cyan, orange and magenta.',
    tokens: PROTANOPIA,
  },
  {
    id: 'tritanopia',
    label: 'Tritanopia — teal / magenta',
    description: 'Separates blue from yellow with teal, amber and violet.',
    tokens: TRITANOPIA,
  },
]);

/** The three accessibility presets, excluding the standard baseline. */
export const COLOR_VISION_PRESETS = COLOR_VISION_PALETTES.filter(
  (palette) => palette.id !== 'standard',
);

export const COLOR_VISION_DEFAULT: ColorVisionPalette = 'standard';

const PALETTE_IDS = new Set<string>(COLOR_VISION_PALETTES.map((palette) => palette.id));

export function normaliseColorVision(value: unknown): ColorVisionPalette {
  return typeof value === 'string' && PALETTE_IDS.has(value)
    ? (value as ColorVisionPalette)
    : COLOR_VISION_DEFAULT;
}

export function colorVisionDef(palette: ColorVisionPalette): ColorVisionPaletteDef {
  return COLOR_VISION_PALETTES.find((entry) => entry.id === palette) ?? COLOR_VISION_PALETTES[0];
}

export function colorVisionTokens(palette: ColorVisionPalette): ColorVisionTokens {
  return colorVisionDef(palette).tokens;
}

/**
 * Push the palette into the stylesheet as custom properties. The canvas already
 * reads the token object directly; this keeps every DOM readout on the same
 * values rather than duplicating a second palette in CSS.
 */
export function colorVisionCssVars(
  tokens: ColorVisionTokens,
): Record<string, string> {
  return {
    '--cv-friendly': tokens.friendly,
    '--cv-friendly-soft': tokens.friendlySoft,
    '--cv-hostile': tokens.hostile,
    '--cv-hostile-soft': tokens.hostileSoft,
    '--cv-neutral': tokens.neutral,
    '--cv-ok': tokens.ok,
    '--cv-ok-soft': tokens.okSoft,
    '--cv-wounded': tokens.wounded,
    '--cv-wounded-soft': tokens.woundedSoft,
    '--cv-critical': tokens.critical,
    '--cv-critical-soft': tokens.criticalSoft,
    '--cv-info': tokens.info,
    '--cv-info-soft': tokens.infoSoft,
    '--cv-success': tokens.success,
    '--cv-success-soft': tokens.successSoft,
  };
}

/** Canvas drawing needs an alpha-tolerant form of a palette colour. */
export function withAlpha(hex: string, alpha: number): string {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#ffffff';
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 0));
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}
