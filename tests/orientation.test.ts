import { describe, expect, it } from 'vitest';
import { needsLandscape } from '../src/ui/orientation';

describe('portrait gate', () => {
  it('blocks a touch device held upright', () => {
    expect(needsLandscape(390, 844, true)).toBe(true);
  });

  it('allows the same device once it is turned sideways', () => {
    expect(needsLandscape(844, 390, true)).toBe(false);
  });

  it('leaves a narrow desktop window alone', () => {
    expect(needsLandscape(390, 844, false)).toBe(false);
  });

  it('treats a square viewport as playable', () => {
    expect(needsLandscape(600, 600, true)).toBe(false);
  });
});
