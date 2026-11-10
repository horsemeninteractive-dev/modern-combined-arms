/**
 * Personal command flag: a structured, versioned composition.
 *
 * A command flag is the player's own identity, separate from the national flag
 * flown by a match and from the team colour that identifies a side. Nothing in
 * this model affects the simulation: it is rendered from a closed element
 * library, never from uploaded artwork.
 *
 * The document is deliberately small and closed. Every colour is a palette id
 * and every emblem a catalogue id, so a validated composition can be drawn by
 * the same renderer on every surface, and an unknown id is a rejection rather
 * than a surprising image.
 */

export const FLAG_FORMAT = 'mca-command-flag' as const;
export const FLAG_SCHEMA_VERSION = 1 as const;

/** Saved designs one player may keep. One constant, used by store and UI. */
export const MAX_FLAG_DESIGNS = 8;
export const MAX_FLAG_NAME_LENGTH = 28;
export const MAX_FLAG_DECORATIONS = 3;
/** A composition is a few hundred bytes; the cap only stops abuse. */
export const MAX_FLAG_BYTES = 4096;
/** Whole-document cap: every design may use the full composition budget. */
export const MAX_FLAG_DOCUMENT_BYTES = MAX_FLAG_BYTES * MAX_FLAG_DESIGNS + 8192;

export interface FlagColor {
  id: string;
  label: string;
  hex: string;
}

/** A curated palette. Sixteen colours is enough range without a colour picker. */
export const FLAG_PALETTE: readonly FlagColor[] = Object.freeze([
  { id: 'ink', label: 'Ink', hex: '#111820' },
  { id: 'slate', label: 'Slate', hex: '#3d4a55' },
  { id: 'steel', label: 'Steel', hex: '#5b7d92' },
  { id: 'sky', label: 'Sky', hex: '#8fc3d6' },
  { id: 'ice', label: 'Ice', hex: '#dfe9ec' },
  { id: 'bone', label: 'Bone', hex: '#efe7d4' },
  { id: 'sand', label: 'Sand', hex: '#cdb488' },
  { id: 'gold', label: 'Gold', hex: '#c9a35f' },
  { id: 'rust', label: 'Rust', hex: '#a85632' },
  { id: 'signal', label: 'Signal', hex: '#cd4b34' },
  { id: 'crimson', label: 'Crimson', hex: '#8e2f33' },
  { id: 'plum', label: 'Plum', hex: '#4a3350' },
  { id: 'navy', label: 'Navy', hex: '#16324a' },
  { id: 'teal', label: 'Teal', hex: '#2f6f68' },
  { id: 'forest', label: 'Forest', hex: '#2f4a37' },
  { id: 'olive', label: 'Olive', hex: '#6b7548' },
]);

export type FlagColorId = (typeof FLAG_PALETTE)[number]['id'];
export const FLAG_COLOR_IDS: readonly string[] = FLAG_PALETTE.map((color) => color.id);

export function flagColorHex(id: string): string {
  return FLAG_PALETTE.find((color) => color.id === id)?.hex ?? '#3d4a55';
}

function hexToRgb(hex: string): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

export function flagColorRgb(id: string): string {
  return hexToRgb(flagColorHex(id));
}

export type FlagShape =
  | { kind: 'polygon'; points: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'path'; d: string; stroke?: number };

export interface FlagEmblemDef {
  id: string;
  label: string;
  /** Primitives in a 100×100 box, centred on 50,50. */
  shapes: readonly FlagShape[];
}

function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    points.push(`${(cx + Math.cos(angle) * radius).toFixed(1)},${(cy + Math.sin(angle) * radius).toFixed(1)}`);
  }
  return points.join(' ');
}

/**
 * The emblem library. Shapes are simple, high-contrast geometry so they read at
 * 32 px in a lobby row and at 400 px in the editor.
 */
export const FLAG_EMBLEMS: readonly FlagEmblemDef[] = Object.freeze([
  {
    id: 'star',
    label: 'Star',
    shapes: [{ kind: 'polygon', points: starPoints(50, 52, 30, 12.5) }],
  },
  {
    id: 'chevron',
    label: 'Chevron',
    shapes: [{ kind: 'polygon', points: '50,24 84,54 71,68 50,49 29,68 16,54' }],
  },
  {
    id: 'anchor',
    label: 'Anchor',
    shapes: [
      { kind: 'circle', cx: 50, cy: 20, r: 7 },
      { kind: 'rect', x: 46.5, y: 24, w: 7, h: 42 },
      { kind: 'rect', x: 30, y: 36, w: 40, h: 6 },
      { kind: 'path', d: 'M18 54 Q18 82 50 86 Q82 82 82 54 L74 54 Q74 74 50 78 Q26 74 26 54 Z' },
      { kind: 'polygon', points: '18,54 8,44 30,44' },
      { kind: 'polygon', points: '82,54 92,44 70,44' },
    ],
  },
  {
    id: 'shield',
    label: 'Shield',
    shapes: [{ kind: 'path', d: 'M50 12 L82 26 L82 52 Q82 76 50 88 Q18 76 18 52 L18 26 Z' }],
  },
  {
    id: 'eagle',
    label: 'Eagle',
    shapes: [
      { kind: 'polygon', points: '50,22 62,36 90,28 78,52 62,58 50,82 38,58 22,52 10,28 38,36' },
      { kind: 'circle', cx: 50, cy: 26, r: 4 },
    ],
  },
  {
    id: 'bolt',
    label: 'Bolt',
    shapes: [{ kind: 'polygon', points: '58,10 26,56 46,56 38,90 74,42 53,42' }],
  },
  {
    id: 'compass',
    label: 'Compass',
    shapes: [
      { kind: 'path', d: 'M50 10 L82 50 L50 90 L18 50 Z', stroke: 6 },
      { kind: 'polygon', points: '50,26 58,50 50,74 42,50' },
    ],
  },
  {
    id: 'laurel',
    label: 'Laurel',
    shapes: [
      { kind: 'path', d: 'M28 76 Q10 50 26 22', stroke: 7 },
      { kind: 'path', d: 'M72 76 Q90 50 74 22', stroke: 7 },
      { kind: 'circle', cx: 24, cy: 34, r: 5 },
      { kind: 'circle', cx: 76, cy: 34, r: 5 },
      { kind: 'circle', cx: 22, cy: 56, r: 5 },
      { kind: 'circle', cx: 78, cy: 56, r: 5 },
    ],
  },
  {
    id: 'crown',
    label: 'Crown',
    shapes: [{ kind: 'polygon', points: '20,72 24,32 38,50 50,26 62,50 76,32 80,72' }],
  },
  {
    id: 'wing',
    label: 'Wing',
    shapes: [
      { kind: 'polygon', points: '50,30 66,44 88,38 78,58 64,62 50,76 36,62 22,58 12,38 34,44' },
      { kind: 'rect', x: 47, y: 40, w: 6, h: 30 },
    ],
  },
]);

export type FlagEmblemId = (typeof FLAG_EMBLEMS)[number]['id'];
export const FLAG_EMBLEM_IDS: readonly string[] = FLAG_EMBLEMS.map((emblem) => emblem.id);

export function flagEmblem(id: string): FlagEmblemDef | null {
  return FLAG_EMBLEMS.find((emblem) => emblem.id === id) ?? null;
}

export const FLAG_BACKGROUNDS = [
  { id: 'solid', label: 'Solid' },
  { id: 'splitH', label: 'Split horizontal' },
  { id: 'splitV', label: 'Split vertical' },
  { id: 'splitD', label: 'Diagonal split' },
  { id: 'gradient', label: 'Gradient' },
] as const;

export type FlagBackgroundKind = (typeof FLAG_BACKGROUNDS)[number]['id'];
export const FLAG_BACKGROUND_IDS: readonly string[] = FLAG_BACKGROUNDS.map((entry) => entry.id);

export const FLAG_STRIPES = [
  { id: 'none', label: 'None' },
  { id: 'horizontal', label: 'Horizontal' },
  { id: 'vertical', label: 'Vertical' },
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'cross', label: 'Cross' },
] as const;

export type FlagStripeKind = (typeof FLAG_STRIPES)[number]['id'];
export const FLAG_STRIPE_IDS: readonly string[] = FLAG_STRIPES.map((entry) => entry.id);

export const FLAG_BORDERS = [
  { id: 'none', label: 'None' },
  { id: 'thin', label: 'Thin' },
  { id: 'double', label: 'Double' },
  { id: 'corners', label: 'Corners' },
] as const;

export type FlagBorderKind = (typeof FLAG_BORDERS)[number]['id'];
export const FLAG_BORDER_IDS: readonly string[] = FLAG_BORDERS.map((entry) => entry.id);

export const FLAG_DECORATIONS = [
  { id: 'star', label: 'Star' },
  { id: 'dot', label: 'Dot' },
  { id: 'bar', label: 'Bar' },
  { id: 'chevron', label: 'Chevron' },
] as const;

export type FlagDecorationId = (typeof FLAG_DECORATIONS)[number]['id'];
export const FLAG_DECORATION_IDS: readonly string[] = FLAG_DECORATIONS.map((entry) => entry.id);

export interface FlagBackground {
  kind: FlagBackgroundKind;
  primary: string;
  secondary: string;
}

export interface FlagStripe {
  kind: FlagStripeKind;
  color: string;
  /** Stripe band width as a percentage of the flag's short axis. */
  width: number;
}

export interface FlagEmblemState {
  id: string;
  color: string;
  /** Offsets in percent of the flag box, clamped to ±30 / ±20. */
  x: number;
  y: number;
  scale: number;
  rotate: 0 | 90 | 180 | 270;
  mirror: boolean;
}

export interface FlagBorder {
  kind: FlagBorderKind;
  color: string;
}

export interface FlagDecoration {
  id: FlagDecorationId;
  color: string;
  x: number;
  y: number;
  scale: number;
  rotate: 0 | 90 | 180 | 270;
}

export interface FlagComposition {
  format: typeof FLAG_FORMAT;
  version: typeof FLAG_SCHEMA_VERSION;
  background: FlagBackground;
  stripe: FlagStripe;
  emblem: FlagEmblemState | null;
  border: FlagBorder;
  decorations: FlagDecoration[];
}

/** A saved design. The composition is the design; the rest is presentation. */
export interface FlagDesign {
  id: string;
  name: string;
  composition: FlagComposition;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
}

export interface FlagIssue {
  path: string;
  message: string;
}

export const DEFAULT_FLAG_NAME = 'Command flag';

export function defaultComposition(): FlagComposition {
  return {
    format: FLAG_FORMAT,
    version: FLAG_SCHEMA_VERSION,
    background: { kind: 'solid', primary: 'navy', secondary: 'slate' },
    stripe: { kind: 'none', color: 'gold', width: 6 },
    emblem: { id: 'star', color: 'bone', x: 0, y: 0, scale: 1, rotate: 0, mirror: false },
    border: { kind: 'thin', color: 'gold' },
    decorations: [],
  };
}

/** A deliberately neutral composition, used when a stored design is unreadable. */
export function fallbackComposition(): FlagComposition {
  return {
    format: FLAG_FORMAT,
    version: FLAG_SCHEMA_VERSION,
    background: { kind: 'solid', primary: 'slate', secondary: 'slate' },
    stripe: { kind: 'none', color: 'slate', width: 6 },
    emblem: null,
    border: { kind: 'thin', color: 'steel' },
    decorations: [],
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}

function rotation(value: unknown): 0 | 90 | 180 | 270 {
  return value === 90 || value === 180 || value === 270 ? value : 0;
}

function color(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return FLAG_COLOR_IDS.includes(value) ? value : null;
}

function oneOf<T extends string>(value: unknown, ids: readonly string[]): T | null {
  if (typeof value !== 'string') return null;
  return (ids.includes(value) ? value : null) as T | null;
}

export type FlagParseResult =
  | { ok: true; composition: FlagComposition }
  | { ok: false; issues: FlagIssue[] };

/**
 * Read untrusted composition data.
 *
 * Unknown enums and colours are rejected: silently substituting them would make
 * two different inputs render the same, and a player would not know their design
 * had changed. Out-of-range numbers are clamped instead, because a stale client
 * sending `scale: 3` still means a flag.
 */
export function parseFlagComposition(raw: unknown): FlagParseResult {
  const issues: FlagIssue[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: '', message: 'A flag composition must be an object.' }] };
  }
  const doc = raw as Record<string, unknown>;
  if (doc.format !== FLAG_FORMAT) {
    issues.push({ path: 'format', message: `Expected "${FLAG_FORMAT}".` });
  }
  if (doc.version !== FLAG_SCHEMA_VERSION) {
    issues.push({ path: 'version', message: `Unsupported flag schema version.` });
  }

  const backgroundRaw = (doc.background ?? {}) as Record<string, unknown>;
  const backgroundKind = oneOf<FlagBackgroundKind>(backgroundRaw.kind, FLAG_BACKGROUND_IDS);
  if (!backgroundKind) issues.push({ path: 'background.kind', message: 'Unknown background.' });
  const primary = color(backgroundRaw.primary);
  if (!primary) issues.push({ path: 'background.primary', message: 'Unknown palette colour.' });
  const secondary = color(backgroundRaw.secondary ?? primary ?? 'slate');
  if (!secondary) issues.push({ path: 'background.secondary', message: 'Unknown palette colour.' });

  const stripeRaw = (doc.stripe ?? {}) as Record<string, unknown>;
  const stripeKind = oneOf<FlagStripeKind>(stripeRaw.kind, FLAG_STRIPE_IDS);
  if (!stripeKind) issues.push({ path: 'stripe.kind', message: 'Unknown stripe arrangement.' });
  const stripeColor = color(stripeRaw.color);
  if (!stripeColor) issues.push({ path: 'stripe.color', message: 'Unknown palette colour.' });

  const borderRaw = (doc.border ?? {}) as Record<string, unknown>;
  const borderKind = oneOf<FlagBorderKind>(borderRaw.kind, FLAG_BORDER_IDS);
  if (!borderKind) issues.push({ path: 'border.kind', message: 'Unknown border.' });
  const borderColor = color(borderRaw.color);
  if (!borderColor) issues.push({ path: 'border.color', message: 'Unknown palette colour.' });

  let emblem: FlagEmblemState | null = null;
  if (doc.emblem !== null && doc.emblem !== undefined) {
    const emblemRaw = doc.emblem as Record<string, unknown>;
    if (typeof emblemRaw !== 'object' || emblemRaw === null) {
      issues.push({ path: 'emblem', message: 'An emblem must be an object or null.' });
    } else {
      const id = oneOf<string>(emblemRaw.id, FLAG_EMBLEM_IDS);
      if (!id) issues.push({ path: 'emblem.id', message: 'Unknown emblem.' });
      const emblemColor = color(emblemRaw.color);
      if (!emblemColor) issues.push({ path: 'emblem.color', message: 'Unknown palette colour.' });
      emblem = {
        id: id ?? 'star',
        color: emblemColor ?? 'bone',
        x: clamp(emblemRaw.x, -30, 30, 0),
        y: clamp(emblemRaw.y, -20, 20, 0),
        scale: clamp(emblemRaw.scale, 0.4, 1.8, 1),
        rotate: rotation(emblemRaw.rotate),
        mirror: emblemRaw.mirror === true,
      };
    }
  }

  const decorationsRaw = Array.isArray(doc.decorations) ? doc.decorations : [];
  if (!Array.isArray(doc.decorations) && doc.decorations !== undefined) {
    issues.push({ path: 'decorations', message: 'Decorations must be an array.' });
  }
  const decorations: FlagDecoration[] = [];
  decorationsRaw.slice(0, MAX_FLAG_DECORATIONS).forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      issues.push({ path: `decorations[${index}]`, message: 'A decoration must be an object.' });
      return;
    }
    const entry = raw as Record<string, unknown>;
    const id = oneOf<FlagDecorationId>(entry.id, FLAG_DECORATION_IDS);
    if (!id) {
      issues.push({ path: `decorations[${index}].id`, message: 'Unknown decoration.' });
      return;
    }
    const decorationColor = color(entry.color);
    if (!decorationColor) {
      issues.push({ path: `decorations[${index}].color`, message: 'Unknown palette colour.' });
      return;
    }
    decorations.push({
      id,
      color: decorationColor,
      x: clamp(entry.x, -45, 45, 0),
      y: clamp(entry.y, -30, 30, 0),
      scale: clamp(entry.scale, 0.3, 1.6, 1),
      rotate: rotation(entry.rotate),
    });
  });

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    composition: {
      format: FLAG_FORMAT,
      version: FLAG_SCHEMA_VERSION,
      background: {
        kind: backgroundKind ?? 'solid',
        primary: primary ?? 'navy',
        secondary: secondary ?? 'slate',
      },
      stripe: {
        kind: stripeKind ?? 'none',
        color: stripeColor ?? 'gold',
        width: clamp(stripeRaw.width, 1, 16, 6),
      },
      emblem,
      border: { kind: borderKind ?? 'none', color: borderColor ?? 'gold' },
      decorations,
    },
  };
}

/** Byte size of the stored form, used to reject oversized payloads early. */
export function compositionBytes(composition: FlagComposition): number {
  return new TextEncoder().encode(JSON.stringify(composition)).length;
}

export function cloneComposition(composition: FlagComposition): FlagComposition {
  return JSON.parse(JSON.stringify(composition)) as FlagComposition;
}

export function compositionEqual(a: FlagComposition, b: FlagComposition): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
