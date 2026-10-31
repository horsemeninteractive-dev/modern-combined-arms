import { describe, expect, it } from 'vitest';
import {
  DEVICE_PIXEL_RATIO_CAP,
  GRAPHICS_PRESETS,
  RENDER_SCALE_MAX,
  RENDER_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  effectivePixelRatio,
  graphicsPreset,
  nextIdleIndex,
  normaliseEscBehavior,
  normaliseGraphicsQuality,
  normaliseRenderScale,
  normaliseUiScale,
} from '../src/settings';
import { SELECTION_GROUP_THRESHOLD, selectionChips } from '../src/ui/hudLayout';

describe('interface scale', () => {
  it('clamps to the supported range and defaults junk to 100%', () => {
    expect(normaliseUiScale(1)).toBe(1);
    expect(normaliseUiScale(UI_SCALE_MIN)).toBe(UI_SCALE_MIN);
    expect(normaliseUiScale(UI_SCALE_MAX)).toBe(UI_SCALE_MAX);
    expect(normaliseUiScale(0.1)).toBe(UI_SCALE_MIN);
    expect(normaliseUiScale(9)).toBe(UI_SCALE_MAX);
    // A hand-edited or older settings blob must not produce NaN in CSS.
    for (const value of [undefined, null, 'huge', Number.NaN]) {
      expect(normaliseUiScale(value)).toBe(1);
    }
  });
});

describe('graphics presets', () => {
  it('falls back to high for unknown quality and accepts the three presets', () => {
    expect(normaliseGraphicsQuality('low')).toBe('low');
    expect(normaliseGraphicsQuality('medium')).toBe('medium');
    expect(normaliseGraphicsQuality('high')).toBe('high');
    expect(normaliseGraphicsQuality('ultra')).toBe('high');
    expect(normaliseGraphicsQuality(undefined)).toBe('high');
    expect(graphicsPreset('nonsense')).toEqual(GRAPHICS_PRESETS.high);
  });

  it('trades particles, shadows and water detail for resolution', () => {
    const { low, medium, high } = GRAPHICS_PRESETS;
    expect(low.maxParticles).toBeLessThan(medium.maxParticles);
    expect(medium.maxParticles).toBeLessThan(high.maxParticles);
    expect(low.renderScale).toBeLessThan(medium.renderScale);
    expect(medium.renderScale).toBeLessThanOrEqual(high.renderScale);
    expect(low.shadows).toBe(false);
    expect(medium.shadows).toBe(true);
    expect(low.waterDetail).toBe(false);
    expect(high.waterDetail).toBe(true);
  });

  it('clamps the explicit render scale to half..full device density', () => {
    expect(normaliseRenderScale(RENDER_SCALE_MIN)).toBe(RENDER_SCALE_MIN);
    expect(normaliseRenderScale(RENDER_SCALE_MAX)).toBe(RENDER_SCALE_MAX);
    expect(normaliseRenderScale(0.01)).toBe(RENDER_SCALE_MIN);
    expect(normaliseRenderScale(4)).toBe(RENDER_SCALE_MAX);
    expect(normaliseRenderScale(undefined)).toBe(1);
  });

  it('never exceeds the historical 2x cap and never goes below half density', () => {
    expect(effectivePixelRatio(1, 1)).toBe(1);
    expect(effectivePixelRatio(2, 1)).toBe(2);
    // A 3x phone is still drawn at 2x, exactly as before the setting existed.
    expect(effectivePixelRatio(3, 1)).toBe(DEVICE_PIXEL_RATIO_CAP);
    expect(effectivePixelRatio(2, 0.5)).toBe(1);
    expect(effectivePixelRatio(1, 0.5)).toBe(0.5);
    // Unknown inputs take the full-density default rather than a 0.5x canvas.
    expect(effectivePixelRatio(Number.NaN, Number.NaN)).toBe(1);
  });
});

describe('escape behaviour', () => {
  it('keeps the current pause default and only accepts the documented alternative', () => {
    expect(normaliseEscBehavior('pause')).toBe('pause');
    expect(normaliseEscBehavior('menu')).toBe('menu');
    expect(normaliseEscBehavior(undefined)).toBe('pause');
    expect(normaliseEscBehavior('fullscreen')).toBe('pause');
  });
});

describe('idle unit cycling', () => {
  it('wraps and reports no target for an empty list', () => {
    expect(nextIdleIndex(0, -1)).toBe(-1);
    expect(nextIdleIndex(-3, 0)).toBe(-1);
    expect(nextIdleIndex(3, -1)).toBe(0);
    expect(nextIdleIndex(3, 0)).toBe(1);
    expect(nextIdleIndex(3, 2)).toBe(0);
    // A remembered unit that became busy is not in the list: start over.
    expect(nextIdleIndex(2, -1)).toBe(0);
  });
});

describe('selection roster grouping', () => {
  const unit = (id: number, defId = 'rifle', hp = 100, maxHp = 100) => ({
    id,
    kind: 'unit',
    defId,
    hp,
    maxHp,
  });
  const building = (id: number, defId = 'factory', hp = 500, maxHp = 500) => ({
    id,
    kind: 'building',
    defId,
    hp,
    maxHp,
  });

  it('keeps one card per hull at or below the threshold', () => {
    const entities = Array.from({ length: SELECTION_GROUP_THRESHOLD }, (_, i) => unit(i + 1));
    const chips = selectionChips(entities);
    expect(chips).toHaveLength(SELECTION_GROUP_THRESHOLD);
    expect(chips.every((chip) => chip.kind === 'entity' && chip.count === 1)).toBe(true);
    expect(chips[0].ids).toEqual([1]);
  });

  it('collapses identical types above the threshold and keeps the first-seen order', () => {
    const entities = [
      unit(1, 'rifle'),
      building(2),
      unit(3, 'tank'),
      unit(4, 'rifle'),
      ...Array.from({ length: 6 }, (_, i) => unit(i + 5, 'rifle')),
    ];
    expect(entities).toHaveLength(10);
    const chips = selectionChips(entities);
    expect(chips.map((chip) => chip.key)).toEqual([
      'type:rifle',
      '2',
      'type:tank',
    ]);
    expect(chips[0].kind).toBe('group');
    expect(chips[0].defId).toBe('rifle');
    expect(chips[0].count).toBe(8);
    expect(chips[0].ids).toHaveLength(8);
    // Structures stay individual so a base is never one anonymous card.
    expect(chips[1].kind).toBe('entity');
    expect(chips[1].defId).toBe('factory');
    expect(chips[2].count).toBe(1);
  });

  it('sums integrity for a grouped card so its bar reflects the type', () => {
    const entities = [
      unit(1, 'rifle', 100, 100),
      unit(2, 'rifle', 50, 100),
      ...Array.from({ length: 7 }, (_, i) => unit(i + 3, 'tank', 100, 100)),
    ];
    const chips = selectionChips(entities);
    const rifles = chips.find((chip) => chip.key === 'type:rifle')!;
    expect(rifles.hp).toBe(150);
    expect(rifles.maxHp).toBe(200);
    expect(rifles.count).toBe(2);
  });
});
