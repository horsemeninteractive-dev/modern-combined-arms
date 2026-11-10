import type { CommandMode } from '../app';

/**
 * The app cursor set.
 *
 * Pointers are drawn on a dedicated full-window canvas rather than set as CSS
 * cursor images: browsers snapshot cursor images once, so an animated SVG or
 * GIF freezes, and a canvas reticle can rotate, pulse and react to placement
 * validity without shipping a sprite per state. The OS pointer is hidden
 * app-wide while these are on, so the reticle crosses the deck, HUD panels,
 * modals and the editor instead of stopping at the battlefield frame. Text
 * fields are the exception: they keep their native I-beam.
 *
 * The glyphs follow the same 24×24 vocabulary as the HUD icons, drawn with a
 * dark halo so the pointer stays legible over snow, sand and dark water.
 */
export type BattleCursor =
  | 'select'
  | 'move'
  | 'attack'
  | 'attackMove'
  | 'capture'
  | 'repair'
  | 'garrison'
  | 'place'
  | 'placeBlocked'
  | 'box'
  | 'pan'
  | 'strike';

/** Pointer states for the deck, HUD, modals and editor rather than the field. */
export type UiCursor = 'action' | 'blocked';

/** Everything the cursor layer can paint. */
export type AppCursor = BattleCursor | UiCursor;

export interface CursorContext {
  /** Placement validity under the pointer; null/undefined while unknown. */
  placementOk?: boolean | null;
  /** Right- or middle-button camera drag is under way. */
  panning?: boolean;
  /** A box-selection rectangle is being dragged. */
  draggingBox?: boolean;
}

export const CURSOR_INK = '#e8eeea';
export const CURSOR_AMBER = '#e0a34a';
export const CURSOR_RED = '#ef6a4a';
export const CURSOR_GREEN = '#7fbf6a';
export const CURSOR_TEAL = '#4fc9b8';
const HALO = '#05090b';

/** The plain arrow, filled rather than stroked: the resting pointer. */
const ARROW = 'M4 2v16l4.2-4.2 2.9 6.8 3.4-1.5-2.9-6.6H18z';
const ARROW_TIP = { x: 4, y: 2 };
const PLACE_BRACKETS = 'M2 7V2h5M17 2h5v5M22 17v5h-5M7 22H2v-5';
const BLOCKED_SLASH = 'M3 3l18 18';

/**
 * Cursor glyphs are raw path data, not the HUD's SVG markup: Path2D accepts a
 * path string only, and the HUD icons mix in `<circle>`/`<rect>` elements that
 * would silently drop out of a stroke. Circles are drawn as arc pairs so every
 * glyph rasterises through the same path. Coordinates match the 24×24 grid.
 */
const GLYPHS = {
  move: 'M12 2v20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12h20M2 12l3-3M2 12l3 3M22 12l-3 3M22 12l-3-3',
  attack:
    'M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4M12 2v4M12 18v4M2 12h4M18 12h4',
  attackMove:
    'M4 18L18 4M18 4h-6M18 4v6M8 13a3 3 0 1 0 0 6a3 3 0 1 0 0-6M8 13v6M5 16h6',
  capture: 'M6 21V3M6 4h12l-3 4 3 4H6M3 21h6',
  repair: 'M14.5 4.5a4 4 0 0 0-5.3 5.3L4 15v4h4l5.2-5.2a4 4 0 0 0 5.3-5.3l-2.8 2.8-2.2-2.2zM4 19l3-3',
  garrison: 'M4 21V9l8-6 8 6v12M9 21v-6h6v6M12 8.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8M9 13h6',
  build: 'M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6M9 10h6',
  box: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  // A strategic aim reticle: an outer ring with crosshair ticks, so a
  // superweapon call-in never reads as an ordinary order cursor.
  strike:
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10M12 1v4M12 19v4M1 12h4M19 12h4',
} as const;

interface CursorStyle {
  /** Centred glyph path, or null for the filled arrow. */
  glyph: string | null;
  color: string;
  /** Radians per second; 0 keeps the glyph upright. */
  spin: number;
  /** Extra path that pulses (blocked slash) or orbits (placement brackets). */
  accent?: string;
  accentSpin?: number;
}

const STYLES: Record<BattleCursor, CursorStyle> = {
  select: { glyph: null, color: CURSOR_INK, spin: 0 },
  move: { glyph: GLYPHS.move, color: CURSOR_INK, spin: 0 },
  attack: { glyph: GLYPHS.attack, color: CURSOR_RED, spin: 0.9 },
  attackMove: { glyph: GLYPHS.attackMove, color: CURSOR_AMBER, spin: -0.7 },
  capture: { glyph: GLYPHS.capture, color: CURSOR_AMBER, spin: 0 },
  repair: { glyph: GLYPHS.repair, color: CURSOR_TEAL, spin: 0 },
  garrison: { glyph: GLYPHS.garrison, color: CURSOR_GREEN, spin: 0 },
  place: { glyph: GLYPHS.build, color: CURSOR_GREEN, spin: 0, accent: PLACE_BRACKETS, accentSpin: 0.4 },
  placeBlocked: { glyph: GLYPHS.build, color: CURSOR_RED, spin: 0, accent: BLOCKED_SLASH },
  box: { glyph: GLYPHS.box, color: CURSOR_INK, spin: 0 },
  pan: { glyph: GLYPHS.move, color: CURSOR_AMBER, spin: 0 },
  strike: { glyph: GLYPHS.strike, color: CURSOR_RED, spin: 0.5 },
};

/**
 * Controls that accept a click, tap or drag. Native elements plus the divs and
 * rows that carry an explicit action attribute or a known clickable class.
 * The cursor layer reads this selector rather than the CSS `cursor` value,
 * because the app-wide `cursor: none` rule would otherwise erase the semantic.
 */
export const UI_CURSOR_TARGETS = [
  'button',
  'a[href]',
  'summary',
  'label[for]',
  'select',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="range"]',
  'input[type="color"]',
  'input[type="file"]',
  '[role="button"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[data-act]',
  '[data-toggle]',
  '[data-menu-view]',
  '[data-map]',
  '[data-build]',
  '[data-produce]',
  '[data-stance]',
  '[data-tab]',
  '[data-choice]',
  '.rail-power',
  '.toast.clickable',
  '.issue',
  '.u-grip',
  '.editor-rail',
  '.editor-sheet-grab',
  '#minimap',
].join(', ');

/**
 * The UI pointer under `target`. A disabled control still reports the blocked
 * state, so the player can tell a control exists but will not accept the click.
 */
export function uiCursorFor(target: Element | null): UiCursor | 'select' {
  const control = target?.closest(UI_CURSOR_TARGETS);
  if (!control) return 'select';
  // The tactical map is clickable while it is live; its offline face is not.
  if (control.id === 'minimap' && control.classList.contains('static')) return 'select';
  if (control.matches(':disabled, [aria-disabled="true"], .locked, .disabled')) return 'blocked';
  return 'action';
}

/** Native equivalents, used when the player turns custom cursors off. */
export const NATIVE_CURSORS: Record<BattleCursor, string> = {
  select: 'default',
  move: 'crosshair',
  attack: 'crosshair',
  attackMove: 'crosshair',
  capture: 'crosshair',
  repair: 'crosshair',
  garrison: 'crosshair',
  place: 'copy',
  placeBlocked: 'not-allowed',
  box: 'crosshair',
  pan: 'grabbing',
  strike: 'crosshair',
};

/**
 * The pointer an app mode should show. A camera drag outranks the mode (the
 * view is what is being moved), and a box drag outranks the armed order so the
 * live selection rectangle always reads as the thing being driven.
 */
export function battleCursor(mode: CommandMode, ctx: CursorContext = {}): BattleCursor {
  if (ctx.panning) return 'pan';
  if (ctx.draggingBox) return 'box';
  switch (mode) {
    case 'place':
      return ctx.placementOk === false ? 'placeBlocked' : 'place';
    case 'move':
    case 'land':
      return 'move';
    case 'attack':
      return 'attack';
    case 'attackMove':
      return 'attackMove';
    case 'capture':
      return 'capture';
    case 'repair':
      return 'repair';
    case 'garrison':
      return 'garrison';
    case 'box':
      return 'box';
    case 'superweapon':
      return 'strike';
    default:
      return 'select';
  }
}

/**
 * The editor's map surface. Placement and camera drags are contextual the same
 * way they are in battle: a place tool follows the tile under the pointer and
 * turns blocked outside the map or over the authoring panels, while a camera
 * drag keeps its pan reticle even when the pointer crosses a rail.
 *
 * `null` means the editor does not own the pointer state here, so the ordinary
 * UI action/blocked resolution applies instead.
 */
export interface EditorCursorContext {
  /** The pointer is over the map canvas rather than an editor panel. */
  overMap: boolean;
  /** The pointer is over a clickable control in the editor chrome. */
  overControl: boolean;
  /** A middle/right-button or PAN-mode camera drag is in progress. */
  panning: boolean;
  /** The PAN toolbar toggle is armed; left-drag moves the camera. */
  panMode: boolean;
  /** A structure, unit or player-start tool is armed. */
  placing: boolean;
  /** The highlighted tile accepts the current placement. */
  placementOk: boolean;
}

export function editorCursor(ctx: EditorCursorContext): BattleCursor | null {
  // A camera drag outranks every authoring tool and follows the pointer over
  // the panels, because the gesture began on the map and is still moving it.
  if (ctx.panning) return 'pan';
  if (ctx.panMode && ctx.overMap) return 'pan';
  if (!ctx.placing) return null;
  if (ctx.overMap) return ctx.placementOk ? 'place' : 'placeBlocked';
  // A toolbar button or panel control still accepts its own click while a place
  // tool is armed, so let the ordinary UI action/blocked resolution own it.
  // Only inert chrome refuses the tool before it can reach the document.
  if (ctx.overControl) return null;
  return 'placeBlocked';
}

/**
 * CSS `cursor` for a state. Custom cursors hide the OS pointer (`none`) because
 * the cursor layer paints the reticle; turning them off returns the platform's
 * own pointer with the closest native meaning.
 */
export function cursorProperty(cursor: BattleCursor, custom: boolean): string {
  return custom ? 'none' : NATIVE_CURSORS[cursor];
}

const TAU = Math.PI * 2;
const pathCache = new Map<string, Path2D>();

/** Path2D is created lazily: tests import this module without a canvas. */
function pathFor(data: string): Path2D {
  let path = pathCache.get(data);
  if (!path) {
    path = new Path2D(data);
    pathCache.set(data, path);
  }
  return path;
}

function strokeGlyph(
  ctx: CanvasRenderingContext2D,
  data: string,
  color: string,
  alpha: number,
  offsetX = 0,
  offsetY = 0,
  scale = 1,
): void {
  const path = pathFor(data);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Halo first, then the coloured line: the halo is what survives bright ground.
  ctx.strokeStyle = HALO;
  ctx.lineWidth = 3.8;
  ctx.stroke(path);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke(path);
  ctx.restore();
}

/**
 * The pointing hand for an actionable control. The arrow says "this is where
 * you are"; the gauntlet says "this will take a click", so a player can tell a
 * button from the panel behind it without the OS pointer.
 */
const HAND =
  'M9 11V4.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v8.5c0 3-2.5 5.5-5.5 5.5h-2.3c-1.4 0-2.7-.6-3.6-1.7l-4.1-5a1.7 1.7 0 0 1 2.6-2.2L9 14.5z';
const HAND_TIP = { x: 9, y: 3 };

function drawActionHand(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const path = pathFor(HAND);
  ctx.save();
  ctx.translate(x - HAND_TIP.x, y - HAND_TIP.y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = HALO;
  ctx.strokeStyle = HALO;
  ctx.lineWidth = 3;
  ctx.fill(path);
  ctx.stroke(path);
  ctx.fillStyle = CURSOR_INK;
  ctx.strokeStyle = CURSOR_AMBER;
  ctx.lineWidth = 1.1;
  ctx.fill(path);
  ctx.stroke(path);
  ctx.restore();
  // The same slow amber pulse at the fingertip, so the actionable pointer keeps
  // the resting pointer's heartbeat instead of feeling like a second language.
  const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
  ctx.save();
  ctx.globalAlpha = 0.1 + 0.16 * pulse;
  ctx.fillStyle = CURSOR_AMBER;
  ctx.beginPath();
  ctx.arc(x, y, 2 + pulse * 2.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
  state: 'select' | 'blocked' = 'select',
): void {
  const path = pathFor(ARROW);
  ctx.save();
  ctx.translate(x - ARROW_TIP.x, y - ARROW_TIP.y);
  ctx.lineJoin = 'round';
  ctx.fillStyle = HALO;
  ctx.strokeStyle = HALO;
  ctx.lineWidth = 3;
  ctx.fill(path);
  ctx.stroke(path);
  ctx.fillStyle = state === 'blocked' ? '#a9b4b0' : CURSOR_INK;
  ctx.strokeStyle = HALO;
  ctx.lineWidth = 1.1;
  ctx.fill(path);
  ctx.stroke(path);
  ctx.restore();
  // A slow amber blink at the tip keeps the resting pointer alive without
  // moving the tip away from the pixel the player is pointing at.
  const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
  ctx.save();
  ctx.globalAlpha = state === 'blocked' ? 0.08 : 0.1 + 0.16 * pulse;
  ctx.fillStyle = state === 'blocked' ? CURSOR_RED : CURSOR_AMBER;
  ctx.beginPath();
  ctx.arc(x, y, 2 + pulse * 2.4, 0, TAU);
  ctx.fill();
  ctx.restore();
  if (state !== 'blocked') return;
  // A red slash across the arrow: this control is visible but will refuse the
  // click, which is exactly what the native not-allowed pointer said.
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = CURSOR_RED;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + 1, y + 17);
  ctx.lineTo(x + 17, y + 1);
  ctx.stroke();
  ctx.restore();
}

function drawPulseRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  time: number,
  speed = 3.2,
  alpha = 0.28,
): void {
  const pulse = 0.5 + 0.5 * Math.sin(time * speed);
  ctx.save();
  ctx.globalAlpha = alpha + pulse * 0.16;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, 12.5 + pulse * 2, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * Paint one cursor at a client-space point. `timeMs` drives every animation; it
 * is presentation only and never reaches the simulation.
 */
export function drawBattleCursor(
  ctx: CanvasRenderingContext2D,
  cursor: AppCursor,
  x: number,
  y: number,
  timeMs: number,
): void {
  if (cursor === 'select') {
    drawArrow(ctx, x, y, timeMs / 1000);
    return;
  }
  if (cursor === 'action') {
    drawActionHand(ctx, x, y, timeMs / 1000);
    return;
  }
  if (cursor === 'blocked') {
    drawArrow(ctx, x, y, timeMs / 1000, 'blocked');
    return;
  }
  const style = STYLES[cursor];
  const t = timeMs / 1000;
  const blocked = cursor === 'placeBlocked';

  // A soft disc under the glyph separates it from busy terrain.
  ctx.save();
  ctx.globalAlpha = blocked ? 0.26 + 0.1 * Math.sin(t * 7) : 0.2;
  ctx.fillStyle = HALO;
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, TAU);
  ctx.fill();
  ctx.restore();

  drawPulseRing(ctx, x, y, style.color, t, blocked ? 7 : 3.2, blocked ? 0.4 : 0.28);

  if (cursor === 'box') {
    // Marching dashes so the box cursor reads as selectable, not as a target.
    const path = pathFor(GLYPHS.box);
    ctx.save();
    ctx.translate(x - 12, y - 12);
    ctx.setLineDash([3, 3]);
    ctx.lineDashOffset = -t * 14;
    ctx.strokeStyle = HALO;
    ctx.lineWidth = 3.4;
    ctx.stroke(path);
    ctx.strokeStyle = CURSOR_INK;
    ctx.lineWidth = 1.4;
    ctx.stroke(path);
    ctx.restore();
  } else if (style.glyph) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * style.spin);
    ctx.translate(-12, -12);
    strokeGlyph(ctx, style.glyph, style.color, 1);
    ctx.restore();
  }

  if (style.accent) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * (style.accentSpin ?? 0));
    ctx.translate(-12, -12);
    strokeGlyph(ctx, style.accent, style.color, blocked ? 0.9 : 0.75);
    ctx.restore();
  }

  if (cursor === 'pan') {
    // Pressed centre: the arrow arms already say "camera", the dot says "held".
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = CURSOR_AMBER;
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/** A fading order impression: the cursor glyph, scaled and drifting upward. */
export function drawOrderGhostGlyph(
  ctx: CanvasRenderingContext2D,
  kind: 'move' | 'attack',
  x: number,
  y: number,
  scale: number,
  alpha: number,
  rise: number,
): void {
  const glyph = kind === 'attack' ? GLYPHS.attack : GLYPHS.move;
  const color = kind === 'attack' ? CURSOR_RED : CURSOR_AMBER;
  ctx.save();
  ctx.translate(x, y - rise);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  strokeGlyph(ctx, glyph, color, alpha);
  ctx.restore();
}

/**
 * Text-entry controls whose native pointer must survive custom cursors. This
 * mirrors the `custom-cursors` text-field rules in style.css: the drawn arrow
 * yields to the I-beam so selection and caret placement stay familiar.
 */
export const NATIVE_CURSOR_TARGETS =
  "input:not([type='range']):not([type='checkbox']):not([type='radio']):not([type='color']):not([type='file']):not([type='button']):not([type='submit']):not([type='reset']), textarea, select, [contenteditable='true']";

/** Whether a control under the pointer wants the platform's own cursor. */
export function wantsNativeCursor(target: Element | null): boolean {
  return !!target?.closest(NATIVE_CURSOR_TARGETS);
}

/**
 * Densest device-pixel ratio the pointer is rasterised at. A 4× ceiling is a
 * guard against an absurd backing store, not a target: everything up to that
 * draws at the panel's native density.
 */
export const MAX_CURSOR_DPR = 4;

/** Backing-store size and the CSS→device scale that maps onto it exactly. */
export interface CursorSurface {
  /** Backing store, in device pixels. */
  width: number;
  height: number;
  /** Device pixels per CSS pixel on each axis. */
  scaleX: number;
  scaleY: number;
}

/**
 * Size the pointer's backing store for the display it is on.
 *
 * The layer used to cap the ratio at 2, which left 2.5× and 3× panels painting
 * every glyph at roughly two-thirds of native density; the compositor then
 * resampled the whole canvas up to the panel, which is what read as a soft,
 * slightly crawling pointer. Rendering at the real ratio keeps the 1px halo and
 * ring edges on physical pixels. The scale is derived back from the rounded
 * backing store so the CSS-space transform lands on whole device pixels rather
 * than being off by a fraction of one at the far edge of the screen.
 */
export function cursorSurface(cssWidth: number, cssHeight: number, ratio: number): CursorSurface {
  const width = Math.max(1, cssWidth || 1);
  const height = Math.max(1, cssHeight || 1);
  const scale = Math.min(MAX_CURSOR_DPR, Math.max(1, ratio || 1));
  const backingWidth = Math.max(1, Math.round(width * scale));
  const backingHeight = Math.max(1, Math.round(height * scale));
  return {
    width: backingWidth,
    height: backingHeight,
    scaleX: backingWidth / width,
    scaleY: backingHeight / height,
  };
}

/**
 * Snap a CSS-space coordinate onto the device-pixel grid.
 *
 * A hairline reticle drawn between physical pixels lands on a different
 * subpixel each frame while the pointer is barely moving, so a ring or a 1.6px
 * cap appears to shiver in place — the complaint that reads as a jittery
 * pointer on a high-refresh panel, where every one of those steps is shown.
 */
export function snapToDevice(value: number, scale: number): number {
  return scale > 0 ? Math.round(value * scale) / scale : value;
}

/**
 * Extent of the painted pointer from its anchor, in CSS pixels: the widest ring
 * plus its halo, with a pixel of slack for the anti-aliased edge.
 */
export const CURSOR_BLEED = 28;

/** Side of the pointer's own canvas box, in CSS pixels. */
export const CURSOR_BOX = CURSOR_BLEED * 2;

/**
 * The topmost cursor surface.
 *
 * The pointer gets its own small canvas rather than a full-window one: a
 * full-screen 2D layer has to be cleared and re-composited every frame, and at
 * 120 Hz and above that cost is exactly what shows up as a pointer that steps
 * and shivers against a scene that is still smooth. This canvas is one 56px
 * square that only ever repaints inside itself; moving it is a compositor-only
 * transform, so the pointer stays glued to the hand at any refresh rate.
 *
 * It is still a separate canvas from the battlefield overlay, so the pointer can
 * sit above the deck, modals and editor without lifting the selection rings and
 * hover labels above the HUD.
 */
export class CursorLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Ratio the backing store was sized for, so a monitor move can be noticed. */
  private ratio = 1;
  private scaleX = 1;
  private scaleY = 1;
  /** Last transform written, so the style is only touched when it changes. */
  private placement = '';
  private reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D cursor context unavailable.');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.ratio = window.devicePixelRatio || 1;
    const surface = cursorSurface(CURSOR_BOX, CURSOR_BOX, this.ratio);
    this.canvas.width = surface.width;
    this.canvas.height = surface.height;
    this.scaleX = surface.scaleX;
    this.scaleY = surface.scaleY;
    // The box is positioned in CSS pixels by its transform, so the drawing space
    // stays the same 56px square at every density.
    this.ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
  }

  /** Place the canvas box so the glyph anchor lands on the pointer. */
  private place(x: number, y: number): void {
    const left = snapToDevice(x, this.scaleX) - CURSOR_BLEED;
    const top = snapToDevice(y, this.scaleY) - CURSOR_BLEED;
    const next = `translate3d(${left}px, ${top}px, 0)`;
    if (next === this.placement) return;
    this.placement = next;
    this.canvas.style.transform = next;
  }

  draw(cursor: AppCursor, x: number, y: number, visible: boolean, timeMs: number): void {
    // Moving the window to another monitor, or changing the browser zoom, alters
    // the ratio without necessarily resizing this canvas: re-size before the
    // next paint so the pointer never draws at a stale density.
    if (Math.abs((window.devicePixelRatio || 1) - this.ratio) > 1e-3) this.resize();
    if (!visible) {
      // Park the box off-screen instead of painting a hidden pointer.
      this.place(-CURSOR_BOX * 4, -CURSOR_BOX * 4);
      return;
    }
    this.place(x, y);
    // The whole canvas is one small square, so a full clear is cheap here and
    // leaves no edge for a glyph to leave residue against.
    this.ctx.clearRect(0, 0, CURSOR_BOX, CURSOR_BOX);
    drawBattleCursor(
      this.ctx,
      cursor,
      CURSOR_BLEED,
      CURSOR_BLEED,
      this.reducedMotion ? 0 : timeMs,
    );
  }
}
