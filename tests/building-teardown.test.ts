import { describe, expect, it } from 'vitest';
import { BUILD_STUB_SCALE, buildingVerticalScale } from '../src/render/buildingScale';

describe('structure model scale', () => {
  it('leaves a finished, working structure at full height', () => {
    expect(buildingVerticalScale({ construction: false, buildProgress: 1 })).toBe(1);
    expect(buildingVerticalScale({ construction: false, buildProgress: 0 })).toBe(1);
  });

  it('grows a site from the stub into its frame', () => {
    expect(buildingVerticalScale({ construction: true, buildProgress: 0 })).toBeCloseTo(
      BUILD_STUB_SCALE + 0.04 * (1 - BUILD_STUB_SCALE),
      6,
    );
    expect(buildingVerticalScale({ construction: true, buildProgress: 1 })).toBe(1);
  });

  it('runs the build curve backwards while a structure is sold', () => {
    const sale = (remaining: number, total = 10) => ({ remaining, total });
    // The first frame of the sale is the finished height, the last is the stub
    // a new site starts from: the model comes apart instead of vanishing.
    expect(buildingVerticalScale({ construction: false, buildProgress: 1, deconstruct: sale(10) })).toBe(1);
    expect(buildingVerticalScale({ construction: false, buildProgress: 1, deconstruct: sale(5) })).toBeCloseTo(
      BUILD_STUB_SCALE + 0.5 * (1 - BUILD_STUB_SCALE),
      6,
    );
    expect(buildingVerticalScale({ construction: false, buildProgress: 1, deconstruct: sale(0) })).toBeCloseTo(
      BUILD_STUB_SCALE,
      6,
    );
  });

  it('holds its ends against a clock that overshoots or is degenerate', () => {
    expect(
      buildingVerticalScale({ construction: false, buildProgress: 1, deconstruct: { remaining: 20, total: 10 } }),
    ).toBe(1);
    expect(
      buildingVerticalScale({ construction: false, buildProgress: 1, deconstruct: { remaining: -3, total: 10 } }),
    ).toBeCloseTo(BUILD_STUB_SCALE, 6);
    expect(
      buildingVerticalScale({ construction: false, buildProgress: 1, deconstruct: { remaining: 0, total: 0 } }),
    ).toBe(1);
  });
});
