import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COLOR_VISION_DEFAULT,
  COLOR_VISION_PALETTES,
  COLOR_VISION_PRESETS,
  colorVisionCssVars,
  colorVisionDef,
  colorVisionTokens,
  normaliseColorVision,
  withAlpha,
} from '../src/colorVision';
import { teamColorForOwner } from '../src/render/teamColor';
import { hexToRgb } from '../src/render/math';

describe('colour-vision palettes', () => {
  it('ships the standard baseline plus the three accessibility presets', () => {
    expect(COLOR_VISION_PALETTES.map((palette) => palette.id)).toEqual([
      'standard',
      'deuteranopia',
      'protanopia',
      'tritanopia',
    ]);
    expect(COLOR_VISION_PRESETS.map((palette) => palette.id)).toEqual([
      'deuteranopia',
      'protanopia',
      'tritanopia',
    ]);
  });

  it('normalises stale or hand-edited settings to a real palette', () => {
    expect(normaliseColorVision('tritanopia')).toBe('tritanopia');
    expect(normaliseColorVision('sepia')).toBe(COLOR_VISION_DEFAULT);
    expect(normaliseColorVision(undefined)).toBe(COLOR_VISION_DEFAULT);
    expect(colorVisionDef('tritanopia').label).toContain('Tritanopia');
  });

  it('keeps friendly and hostile ownership separable without red/green', () => {
    const standard = colorVisionTokens('standard');
    const deuteranopia = colorVisionTokens('deuteranopia');
    const protanopia = colorVisionTokens('protanopia');
    const tritanopia = colorVisionTokens('tritanopia');
    for (const palette of [deuteranopia, protanopia, tritanopia]) {
      expect(palette.friendly).not.toBe(palette.hostile);
      expect(palette.ok).not.toBe(palette.critical);
      expect(palette.info).not.toBe(palette.wounded);
      expect(palette.wounded).not.toBe(palette.critical);
    }
    expect(standard.friendly).toBe('#52c5e6');
  });

  it('exports the same CSS tokens for the DOM and the renderers', () => {
    const vars = colorVisionCssVars(colorVisionTokens('deuteranopia'));
    expect(vars['--cv-friendly']).toBe('#4ea8ff');
    expect(vars['--cv-hostile']).toBe('#ff9f43');
    expect(vars['--cv-critical']).toBe('#ff6b9d');
    expect(new Set(Object.values(vars)).size).toBeGreaterThan(8);
  });

  it('formats canvas alpha colours and overrides team tints only in a preset', () => {
    expect(withAlpha('#ef6c4d', 0.5)).toBe('rgba(239, 108, 77, 0.5)');
    expect(teamColorForOwner(1, undefined, '#123456')).toEqual(hexToRgb('#123456'));
    expect(teamColorForOwner(1, undefined, '#123456', 'deuteranopia', true)).toEqual(
      hexToRgb('#4ea8ff'),
    );
    expect(teamColorForOwner(1, undefined, '#123456', 'deuteranopia', false)).toEqual(
      hexToRgb('#ff9f43'),
    );
    expect(teamColorForOwner(-1, undefined, '#123456', 'tritanopia', false)).toEqual([
      0.55, 0.6, 0.58,
    ]);
  });

  it('keeps a shape or pattern beside every themed signal', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toContain('--cv-friendly');
    expect(css).toContain('.hp-bar::after');
    expect(css).toContain('repeating-linear-gradient(45deg');
    expect(css).toContain('.toast.warning { border-left: 2px dashed var(--cv-wounded); }');
    expect(css).toContain('.toast.critical { border-left: 3px double var(--cv-critical); }');
    expect(css).toContain('.sel-icon.enemy::before');
  });
});
