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
