import { describe, expect, it } from 'vitest';
import {
  WRECK_LINGER_SECONDS,
  WRECK_SINK_SECONDS,
  wreckSettle,
} from '../src/render/buildingRuin';

/**
 * A destroyed structure leaves a burnt shell, but the shell is a moment in the
 * battle rather than permanent scenery: it stands, settles into the ground and
 * is gone. These are the timings the draw loop obeys.
 */

const TOP = 6;

describe('destroyed structure shells', () => {
  it('stands still and fully opaque while the wreck is fresh', () => {
    for (const age of [0, 1.5, WRECK_LINGER_SECONDS - 0.01]) {
      const { sink, alpha, gone } = wreckSettle(age, TOP);
      expect(sink).toBe(0);
      expect(alpha).toBe(1);
      expect(gone).toBe(false);
    }
  });

  it('sinks steadily once the linger ends, fading only as it goes under', () => {
    let previousSink = 0;
    let previousAlpha = 1;
    for (let i = 1; i <= 10; i++) {
      const age = WRECK_LINGER_SECONDS + (WRECK_SINK_SECONDS * i) / 10;
      const { sink, alpha } = wreckSettle(age, TOP);
      expect(sink).toBeGreaterThan(previousSink);
      expect(alpha).toBeLessThanOrEqual(previousAlpha);
      // Never fully transparent while it is still standing on the surface.
      if (sink < TOP * 0.5) expect(alpha).toBeGreaterThan(0.25);
      previousSink = sink;
      previousAlpha = alpha;
    }
  });

  it('is buried past its own height and then dropped from the draw list', () => {
    const justBefore = wreckSettle(WRECK_LINGER_SECONDS + WRECK_SINK_SECONDS - 0.01, TOP);
    expect(justBefore.gone).toBe(false);
    // Buried deeper than the shell is tall, so no part of it is left above the
    // ground the instant the fade ends.
    expect(justBefore.sink).toBeGreaterThan(TOP);
    expect(justBefore.alpha).toBeLessThan(0.01);

    const done = wreckSettle(WRECK_LINGER_SECONDS + WRECK_SINK_SECONDS, TOP);
    expect(done.gone).toBe(true);
  });

  it('keeps a taller structure in view a little longer than a hut', () => {
    const age = WRECK_LINGER_SECONDS + WRECK_SINK_SECONDS * 0.5;
    expect(wreckSettle(age, 9).sink).toBeGreaterThan(wreckSettle(age, 2).sink);
  });

  it('treats a negative or nonsense age as still standing', () => {
    const { sink, alpha, gone } = wreckSettle(-4, TOP);
    expect(sink).toBe(0);
    expect(alpha).toBe(1);
    expect(gone).toBe(false);
  });
});
