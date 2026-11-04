export type EditorLayout = 'desktop' | 'touch';

/**
 * The editor keeps a desktop workstation composition on pointer devices, and
 * switches to drawers/sheets on phones, short windows and coarse-pointer
 * tablets. Width alone is not enough: a touch tablet in landscape still needs
 * 44 px controls even when it is wider than a phone.
 */
export function resolveEditorLayout(width: number, height: number, coarsePointer: boolean): EditorLayout {
  if (coarsePointer && width <= 1200) return 'touch';
  if (width <= 900) return 'touch';
  if (height <= 480) return 'touch';
  return 'desktop';
}

/** Bottom-sheet height: tappable and readable without swallowing the map. */
export function editorSheetHeight(viewportHeight: number): number {
  return Math.max(220, Math.min(460, Math.round(viewportHeight * 0.68)));
}

/** Follow the finger while dragging the sheet down, never upward past rest. */
export function editorSheetOffset(dy: number, height: number): number {
  return Math.max(0, Math.min(height, dy));
}

/** A deliberate drag (or a short screen) dismisses the sheet. */
export function dismissEditorSheet(dy: number, height: number): boolean {
  return dy > Math.min(96, height * 0.25);
}

/* ------------------------------------------------------------------ */
/* Sliding sidebars                                                    */
/* ------------------------------------------------------------------ */

export type RailSide = 'left' | 'right';

/**
 * Horizontal travel between fully open and fully stowed, in pixels.
 *
 * Stowing takes the panel's whole width: the grab handle is a strip that sits
 * outside the panel's edge, so it stays on screen at the edge while the panel
 * itself leaves. Nothing of the panel has to be kept back for the handle.
 */
export function railTravel(side: RailSide, width: number): number {
  return Math.max(0, width) * (side === 'left' ? -1 : 1);
}

/** Where a drag from `dragged` should leave the panel, clamped to its stops. */
export function railOffset(side: RailSide, width: number, dragged: number): number {
  const travel = railTravel(side, width);
  if (travel === 0) return 0;
  const low = Math.min(0, travel);
  const high = Math.max(0, travel);
  return Math.max(low, Math.min(high, dragged));
}

/** Offset for a panel resting in one of its two states. */
export function railRestOffset(side: RailSide, width: number, collapsed: boolean): number {
  return collapsed ? railTravel(side, width) : 0;
}

/**
 * Whether a released drag settled shut. Halfway is the tipping point: past it
 * the panel was clearly being pushed away, short of it the gesture reads as a
 * nudge the panel should spring back from.
 */
export function railSettlesCollapsed(side: RailSide, width: number, offset: number): boolean {
  const travel = railTravel(side, width);
  if (travel === 0) return false;
  return Math.abs(offset) >= Math.abs(travel) * 0.5;
}
