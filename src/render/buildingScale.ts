/**
 * Vertical scale of a structure's model while it is not a working building.
 *
 * A construction site is groundworks before it is a shell: the mesh starts as a
 * stub roughly a tenth of its height and grows into its frame as the engineers
 * work. Selling a structure runs that curve backwards — the model sinks back
 * down as the deconstruction clock runs out — so the price on the sell button
 * and the thing on the map tell the same story, and the structure never blinks
 * out at full height.
 *
 * Both callers of the model transform (the lit pass and the shadow casters)
 * read the same function, so a dismantling building's shadow shrinks with it.
 */
export const BUILD_STUB_SCALE = 0.06;

export interface BuildingScaleState {
  construction: boolean;
  /** Authoritative build progress, 0–1. */
  buildProgress: number;
  /** Sale clock while the structure is being dismantled for parts. */
  deconstruct?: { remaining: number; total: number } | undefined;
}

export function buildingVerticalScale(state: BuildingScaleState): number {
  const sale = state.deconstruct;
  if (!state.construction && sale && sale.total > 0) {
    // Full height at the first frame of the sale, the build's own stub at the
    // last: one continuous curve in either direction.
    const left = Math.max(0, Math.min(1, sale.remaining / sale.total));
    return BUILD_STUB_SCALE + left * (1 - BUILD_STUB_SCALE);
  }
  if (state.construction) {
    // Same floor as a fresh site, then straight growth into the finished frame.
    const progress = 0.04 + Math.max(0, Math.min(1, state.buildProgress)) * 0.96;
    return BUILD_STUB_SCALE + progress * (1 - BUILD_STUB_SCALE);
  }
  return 1;
}
