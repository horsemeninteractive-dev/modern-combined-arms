import { describe, expect, it } from 'vitest';
import {
  enterFullscreen,
  exitFullscreen,
  isFullscreen,
  toggleFullscreen,
  wantsAutomaticFullscreen,
  type FullscreenDocument,
} from '../src/ui/fullscreen';

/**
 * The browser owns the fullscreen state, so the helpers are exercised against
 * a document double: a request only counts once the document reports a
 * fullscreen element, exactly as the settings switch trusts it in play.
 */
function fakeDoc(options: { supported?: boolean; refuse?: boolean } = {}) {
  const { supported = true, refuse = false } = options;
  const state: { element: Element | null } = { element: null };
  const calls = { requests: 0, exits: 0 };
  const doc: FullscreenDocument = {
    get fullscreenElement() {
      return state.element;
    },
    documentElement: supported
      ? {
          requestFullscreen: async () => {
            calls.requests++;
            if (refuse) throw new Error('refused');
            state.element = {} as Element;
          },
        }
      : {},
    exitFullscreen: async () => {
      calls.exits++;
      state.element = null;
    },
  };
  return { doc, state, calls };
}

describe('fullscreen helpers', () => {
  it('reports the state the document actually holds', async () => {
    const { doc, calls } = fakeDoc();
    expect(isFullscreen(doc)).toBe(false);
    await expect(enterFullscreen(doc)).resolves.toBe(true);
    expect(isFullscreen(doc)).toBe(true);
    expect(calls.requests).toBe(1);
  });

  it('toggles in and back out, following the browser each time', async () => {
    const { doc, calls } = fakeDoc();
    await expect(toggleFullscreen(doc)).resolves.toBe(true);
    await expect(toggleFullscreen(doc)).resolves.toBe(false);
    expect(calls.requests).toBe(1);
    expect(calls.exits).toBe(1);
  });

  it('stays windowed without throwing when the browser supports or allows no fullscreen', async () => {
    const unsupported = fakeDoc({ supported: false });
    await expect(enterFullscreen(unsupported.doc)).resolves.toBe(false);
    expect(unsupported.calls.requests).toBe(0);

    const refused = fakeDoc({ refuse: true });
    await expect(enterFullscreen(refused.doc)).resolves.toBe(false);
    expect(isFullscreen(refused.doc)).toBe(false);
  });

  it('leaves touch devices and immersive windows to the system', () => {
    // Android answers every request with its "swipe down to exit" notice, and
    // that notice parks itself over the battlefield even when the app is
    // already running in fullscreen display mode.
    expect(wantsAutomaticFullscreen({ coarsePointer: true, alreadyImmersive: false })).toBe(false);
    expect(wantsAutomaticFullscreen({ coarsePointer: false, alreadyImmersive: true })).toBe(false);
    expect(wantsAutomaticFullscreen({ coarsePointer: true, alreadyImmersive: true })).toBe(false);
    expect(wantsAutomaticFullscreen({ coarsePointer: false, alreadyImmersive: false })).toBe(true);
  });

  it('does not ask to leave when already windowed', async () => {
    const { doc, calls } = fakeDoc();
    await expect(exitFullscreen(doc)).resolves.toBe(false);
    expect(calls.exits).toBe(0);
  });
});
