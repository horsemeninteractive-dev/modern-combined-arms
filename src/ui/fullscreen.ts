/**
 * Fullscreen helpers, kept DOM-thin so the start gate, both settings panels and
 * the tests all read the same rule: a request only counts once the document
 * reports a fullscreen element.
 */
export interface FullscreenDocument {
  readonly fullscreenElement: Element | null;
  readonly documentElement: {
    requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  };
  readonly exitFullscreen?: () => Promise<void>;
}

export function isFullscreen(doc: FullscreenDocument = document): boolean {
  return !!doc.fullscreenElement;
}

/** Ask for fullscreen. Returns whether the document actually entered it. */
export async function enterFullscreen(doc: FullscreenDocument = document): Promise<boolean> {
  if (doc.fullscreenElement) return true;
  const request = doc.documentElement.requestFullscreen;
  if (!request) return false;
  try {
    await request.call(doc.documentElement, { navigationUI: 'hide' });
  } catch {
    // Refused (no gesture, policy, unsupported): the game keeps the window.
    return false;
  }
  return !!doc.fullscreenElement;
}

/** Leave fullscreen. Returns whether the document is still fullscreen. */
export async function exitFullscreen(doc: FullscreenDocument = document): Promise<boolean> {
  if (!doc.fullscreenElement) return false;
  try {
    await doc.exitFullscreen?.call(doc);
  } catch {
    return !!doc.fullscreenElement;
  }
  return false;
}

/**
 * Whether the start gate should ask the Fullscreen API for the whole screen.
 * Touch devices and windows already in `fullscreen` display mode are left
 * alone: Android answers every request with its "swipe down to exit" notice,
 * and that notice parks itself over the battlefield even when the app was
 * already immersive. The Settings switch still asks explicitly.
 */
export interface AutomaticFullscreenContext {
  /** A finger/stylus pointer: the window fills the screen on its own terms. */
  coarsePointer: boolean;
  /** Already in `fullscreen` display mode, or the document is fullscreen. */
  alreadyImmersive: boolean;
}

export function wantsAutomaticFullscreen(context: AutomaticFullscreenContext): boolean {
  return !context.coarsePointer && !context.alreadyImmersive;
}

/** Toggle and report the resulting state, so a switch can follow the truth. */
export async function toggleFullscreen(doc: FullscreenDocument = document): Promise<boolean> {
  return doc.fullscreenElement ? exitFullscreen(doc) : enterFullscreen(doc);
}
