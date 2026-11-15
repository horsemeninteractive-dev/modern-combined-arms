import { describe, expect, it } from 'vitest';
import { nextFocusIndex, nextGroupSlot, nextPopulatedGroup } from '../src/ui/gamepad';

/** A 2 by 2 menu grid with a wide action below it. */
const grid = [
  { left: 0, top: 0, width: 100, height: 30 },
  { left: 140, top: 0, width: 100, height: 30 },
  { left: 0, top: 50, width: 100, height: 30 },
  { left: 140, top: 50, width: 100, height: 30 },
  { left: 0, top: 110, width: 240, height: 30 },
];

describe('gamepad directional focus', () => {
  it('moves one control in each direction', () => {
    expect(nextFocusIndex(grid, 0, 1, 0)).toBe(1);
    expect(nextFocusIndex(grid, 1, -1, 0)).toBe(0);
    expect(nextFocusIndex(grid, 0, 0, 1)).toBe(2);
    expect(nextFocusIndex(grid, 3, 0, -1)).toBe(1);
  });

  it('prefers the nearest control in line before a diagonal one', () => {
    const staggered = [
      { left: 0, top: 0, width: 100, height: 30 },
      { left: 120, top: 120, width: 100, height: 30 },
      { left: 0, top: 50, width: 100, height: 30 },
    ];
    expect(nextFocusIndex(staggered, 0, 0, 1)).toBe(2);
  });

  it('does not wrap past an edge and starts at the first control', () => {
    expect(nextFocusIndex(grid, 0, -1, 0)).toBe(-1);
    expect(nextFocusIndex(grid, 4, 0, 1)).toBe(-1);
    expect(nextFocusIndex(grid, -1, 1, 0)).toBe(0);
    expect(nextFocusIndex([], -1, 0, 1)).toBe(-1);
  });
});

describe('gamepad control groups', () => {
  it('wraps group assignment through slots 1 to 9', () => {
    expect(nextGroupSlot(0, 1)).toBe(1);
    expect(nextGroupSlot(0, -1)).toBe(9);
    expect(nextGroupSlot(5, 1)).toBe(6);
    expect(nextGroupSlot(9, 1)).toBe(1);
    expect(nextGroupSlot(1, -1)).toBe(9);
  });

  it('recalls only populated groups and wraps through them', () => {
    expect(nextPopulatedGroup([1, 4, 9], 4, 1)).toBe(9);
    expect(nextPopulatedGroup([1, 4, 9], 9, 1)).toBe(1);
    expect(nextPopulatedGroup([1, 4, 9], 1, -1)).toBe(9);
    expect(nextPopulatedGroup([1, 4, 9], 0, 1)).toBe(1);
    expect(nextPopulatedGroup([1, 4, 9], 7, -1)).toBe(4);
    expect(nextPopulatedGroup([], 0, 1)).toBeNull();
    expect(nextPopulatedGroup([0, 10], 0, 1)).toBeNull();
  });
});
