import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import app from '../src/app.ts?raw';

const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
import {
  DEVICE_PIXEL_RATIO_CAP,
  EDGE_PAN_SPEED_DEFAULT,
  EDGE_PAN_SPEED_MAX,
  EDGE_PAN_SPEED_MIN,
  EDGE_PAN_WIDTH_DEFAULT,
  EDGE_PAN_WIDTH_MAX,
  EDGE_PAN_WIDTH_MIN,
  GAMEPAD_SENSITIVITY_DEFAULT,
  GAMEPAD_SENSITIVITY_MAX,
  GAMEPAD_SENSITIVITY_MIN,
  GRAPHICS_PRESETS,
  normaliseEdgePanSpeed,
  normaliseEdgePanWidth,
  RENDER_SCALE_MAX,
  RENDER_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  effectivePixelRatio,
  graphicsPreset,
  nextIdleIndex,
  normaliseEscBehavior,
  normaliseGamepadSensitivity,
  normaliseGraphicsQuality,
  normaliseRenderScale,
  normaliseShadowDetail,
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
    expect(low.shadowDetail).toBe('off');
    expect(medium.shadowDetail).toBe('basic');
    // High is the authored look: realtime shadows are part of it, not a hidden
    // upgrade the player has to discover in a submenu.
    expect(high.shadowDetail).toBe('detailed');
    expect(low.waterDetail).toBe(false);
    expect(high.waterDetail).toBe(true);
  });

  it('normalises the three shadow levels and rejects unknown ones', () => {
    expect(normaliseShadowDetail('off')).toBe('off');
    expect(normaliseShadowDetail('basic')).toBe('basic');
    expect(normaliseShadowDetail('detailed')).toBe('detailed');
    expect(normaliseShadowDetail('raytraced')).toBe('detailed');
    expect(normaliseShadowDetail(undefined)).toBe('detailed');
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

describe('edge pan tuning', () => {
  it('clamps the band depth in pixels and falls back to the documented default', () => {
    expect(normaliseEdgePanWidth(EDGE_PAN_WIDTH_DEFAULT)).toBe(EDGE_PAN_WIDTH_DEFAULT);
    expect(normaliseEdgePanWidth(EDGE_PAN_WIDTH_MIN)).toBe(EDGE_PAN_WIDTH_MIN);
    expect(normaliseEdgePanWidth(EDGE_PAN_WIDTH_MAX)).toBe(EDGE_PAN_WIDTH_MAX);
    expect(normaliseEdgePanWidth(1)).toBe(EDGE_PAN_WIDTH_MIN);
    expect(normaliseEdgePanWidth(500)).toBe(EDGE_PAN_WIDTH_MAX);
    for (const value of [undefined, null, 'wide', Number.NaN]) {
      expect(normaliseEdgePanWidth(value)).toBe(EDGE_PAN_WIDTH_DEFAULT);
    }
  });

  it('clamps the speed multiplier and never leaves the camera frozen by junk', () => {
    expect(normaliseEdgePanSpeed(EDGE_PAN_SPEED_DEFAULT)).toBe(EDGE_PAN_SPEED_DEFAULT);
    expect(normaliseEdgePanSpeed(EDGE_PAN_SPEED_MIN)).toBe(EDGE_PAN_SPEED_MIN);
    expect(normaliseEdgePanSpeed(EDGE_PAN_SPEED_MAX)).toBe(EDGE_PAN_SPEED_MAX);
    expect(normaliseEdgePanSpeed(0.01)).toBe(EDGE_PAN_SPEED_MIN);
    expect(normaliseEdgePanSpeed(9)).toBe(EDGE_PAN_SPEED_MAX);
    for (const value of [undefined, null, 'fast', Number.NaN]) {
      expect(normaliseEdgePanSpeed(value)).toBe(EDGE_PAN_SPEED_DEFAULT);
    }
  });
});

describe('gamepad sensitivity', () => {
  it('clamps stick sensitivity and never disables the pad with junk', () => {
    expect(normaliseGamepadSensitivity(GAMEPAD_SENSITIVITY_DEFAULT)).toBe(
      GAMEPAD_SENSITIVITY_DEFAULT,
    );
    expect(normaliseGamepadSensitivity(GAMEPAD_SENSITIVITY_MIN)).toBe(GAMEPAD_SENSITIVITY_MIN);
    expect(normaliseGamepadSensitivity(GAMEPAD_SENSITIVITY_MAX)).toBe(GAMEPAD_SENSITIVITY_MAX);
    expect(normaliseGamepadSensitivity(0.01)).toBe(GAMEPAD_SENSITIVITY_MIN);
    expect(normaliseGamepadSensitivity(9)).toBe(GAMEPAD_SENSITIVITY_MAX);
    for (const value of [undefined, null, 'fast', Number.NaN]) {
      expect(normaliseGamepadSensitivity(value)).toBe(GAMEPAD_SENSITIVITY_DEFAULT);
    }
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

describe('settings tabs', () => {
  /** The row groups, sliced out of the shared settings markup builder. */
  function settingsGroups(): Record<'display' | 'input' | 'audio' | 'music', string> {
    const start = app.indexOf('const displayRows');
    const end = app.indexOf('const tabs:', start);
    expect(start).toBeGreaterThan(-1);
    const body = app.slice(start, end);
    const inputAt = body.indexOf('const inputRows');
    const audioAt = body.indexOf('const audioRows');
    const musicAt = body.indexOf('const musicRows');
    return {
      display: body.slice(0, inputAt),
      input: body.slice(inputAt, audioAt),
      audio: body.slice(audioAt, musicAt),
      music: body.slice(musicAt),
    };
  }

  const keys = (markup: string) =>
    [...markup.matchAll(/data-(?:set|choice|toggle)="([^"]+)"/g)].map((match) => match[1]).sort();

  it('splits the sheet into display, controls, audio and playlist tabs without losing a control', () => {
    const groups = settingsGroups();
    expect(groups.display).not.toBe(groups.input);
    // Tabs and panels are generated from one id list, so the ids are the source of truth.
    expect(app).toContain(`{ id: 'display', label: 'Display' }`);
    expect(app).toContain(`{ id: 'input', label: 'Controls' }`);
    expect(app).toContain(`{ id: 'audio', label: 'Audio' }`);
    expect(app).toContain(`{ id: 'music', label: 'Playlist' }`);
    expect(app).toContain('data-settings-tab="${tab.id}"');
    expect(app).toContain('data-settings-panel="${id}"');
    expect(app).toContain('data-bind="${action.id}"');
    expect(app).toContain('data-bind-status');
    expect(app).toContain('assignKeyBinding');
    // Every settings key sits in exactly one tab, so nothing is hidden or duplicated.
    const all = keys(app.slice(app.indexOf('const displayRows'), app.indexOf('const tabs:')));
    expect(new Set(all).size).toBe(all.length);
    const regrouped = [
      ...keys(groups.display),
      ...keys(groups.input),
      ...keys(groups.audio),
      ...keys(groups.music),
    ].sort();
    expect(regrouped).toEqual(all);
  });

  it('puts presentation in Display, camera and input in Controls, and levels in Audio', () => {
    const groups = settingsGroups();
    expect(keys(groups.display)).toEqual(
      [
        'cinematics',
        'colorVision',
        'effects',
        'fogVisual',
        'fpsReadout',
        'fullscreen',
        'graphicsQuality',
        'lightBloom',
        'nightLights',
        'renderScale',
        'shadowDetail',
        'shake',
        'silhouettes',
        'uiScale',
      ].sort(),
    );
    expect(keys(groups.input)).toEqual(
      [
        'customCursors',
        'edgePan',
        'edgePanSpeed',
        'edgePanWidth',
        'escBehavior',
        'gamepadSensitivity',
      ].sort(),
    );
    expect(keys(groups.audio)).toEqual(
      ['ambient', 'music', 'sfx', 'unitVoice', 'voice'].sort(),
    );
  });

  it('switches panels by hiding the inactive ones and marking the active tab', () => {
    expect(app).toContain('private showSettingsTab(tab: SettingsTab)');
    expect(app).toContain("panel.hidden = panel.dataset.settingsPanel !== tab");
    expect(app).toContain("button.classList.toggle('active', active)");
    // The hidden attribute must beat the panel's own grid display, or all three show.
    expect(styles).toContain('.settings-panel[hidden] { display: none; }');
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
