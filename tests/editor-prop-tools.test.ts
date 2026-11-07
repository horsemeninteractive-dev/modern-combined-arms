/**
 * The Forge's prop eyedropper and multi-select.
 *
 * The gestures are pointer work, but every decision behind them is pure: which
 * prop is under a tile, which ones a box caught, what settings an adopted prop
 * carries, where a copy may land. Those live in `src/ui/editorProps.ts` and are
 * tested here; the editor tests below are source guards that the panel actually
 * calls them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  centreProp,
  deleteProps,
  duplicateProps,
  nudgeProp,
  propAt,
  propBox,
  propSettings,
  propTiles,
  propsInBox,
  pruneSelection,
  rotateProp,
} from '../src/ui/editorProps';
import type { ScenarioProp } from '../src/sim/scenario';

const editorSource = readFileSync(new URL('../src/ui/editor.ts', import.meta.url), 'utf8');
const renderSource = readFileSync(new URL('../src/ui/editorRender.ts', import.meta.url), 'utf8');

const lamp: ScenarioProp = { kind: 'lamp', x: 4, z: 5, rotation: Math.PI / 2, scale: 1.4 };
const bush: ScenarioProp = { kind: 'bush', x: 4, z: 5 };
const far: ScenarioProp = { kind: 'rubble', x: 9, z: 2 };

describe('picking a prop', () => {
  it('normalises a box dragged in any direction', () => {
    expect(propBox(9, 2, 4, 5)).toEqual({ x0: 4, z0: 2, x1: 9, z1: 5 });
    expect(propBox(4, 5, 4, 5)).toEqual({ x0: 4, z0: 5, x1: 4, z1: 5 });
  });

  it('returns the prop an author sees on top of a stacked tile', () => {
    expect(propAt([bush, lamp], 4, 5)).toBe(lamp);
    expect(propAt([lamp, bush], 4, 5)).toBe(bush);
    expect(propAt([bush], 5, 5)).toBeNull();
  });

  it('catches every prop inside a box, edges included', () => {
    const box = propBox(4, 5, 9, 5);
    expect(propsInBox([bush, lamp, far], box)).toEqual([bush, lamp]);
    expect(propsInBox([bush], propBox(9, 2, 9, 2))).toEqual([]);
  });
});

describe('adopting a prop', () => {
  it('converts radians to whole degrees and the scale to tenths', () => {
    expect(propSettings(lamp)).toEqual({ kind: 'lamp', rotation: 90, scale: 1.4 });
    expect(propSettings({ kind: 'rock', x: 1, z: 1, rotation: 0.3 })).toEqual({
      kind: 'rock',
      rotation: 17,
      scale: 1,
    });
    expect(propSettings(bush)).toEqual({ kind: 'bush', rotation: 0, scale: 1 });
  });

  it('keeps the adopted settings inside what the sliders can express', () => {
    const odd: ScenarioProp = { kind: 'sign', x: 2, z: 2, rotation: -Math.PI, scale: 3 };
    const settings = propSettings(odd);
    expect(settings.rotation).toBe(-180);
    expect(settings.scale).toBe(2);
  });
});

describe('duplicating a selection', () => {
  it('copies every setting one tile down and right', () => {
    const copies = duplicateProps([lamp], { width: 16, height: 16 });
    expect(copies).toEqual([{ kind: 'lamp', x: 5, z: 6, rotation: Math.PI / 2, scale: 1.4 }]);
  });

  it('refuses a copy that leaves the map or lands on ground that is taken', () => {
    const edge: ScenarioProp = { kind: 'rock', x: 15, z: 15 };
    expect(duplicateProps([edge], { width: 16, height: 16 })).toEqual([]);
    const blocked = new Set(['5,6']);
    expect(duplicateProps([lamp], { width: 16, height: 16, occupied: blocked })).toEqual([]);
  });

  it('lets a selection slide into tiles another selected prop is leaving', () => {
    const a: ScenarioProp = { kind: 'bush', x: 4, z: 5 };
    const b: ScenarioProp = { kind: 'tuft', x: 5, z: 6 };
    const copies = duplicateProps([a, b], { width: 16, height: 16, occupied: propTiles([a, b]) });
    expect(copies.map((copy) => `${copy.kind}@${copy.x},${copy.z}`)).toEqual([
      'bush@5,6',
      'tuft@6,7',
    ]);
  });

  it('duplicates a stacked tile as a stack', () => {
    const copies = duplicateProps([bush, lamp], { width: 16, height: 16 });
    expect(copies).toHaveLength(2);
    expect(copies.every((copy) => copy.x === 5 && copy.z === 6)).toBe(true);
  });
});

describe('keeping a selection honest', () => {
  it('drops props that are no longer in the scenario', () => {
    expect(pruneSelection([bush], [bush, lamp])).toEqual([bush]);
    expect(pruneSelection([], [bush])).toEqual([]);
  });

  it('deletes exactly the selection', () => {
    expect(deleteProps([bush, lamp, far], [lamp])).toEqual([bush, far]);
    expect(deleteProps([bush], [])).toEqual([bush]);
  });
});

describe('turning and nudging a prop', () => {
  it('turns in eight compass steps from whatever angle the file carried', () => {
    const odd: ScenarioProp = { kind: 'sign', x: 2, z: 2, rotation: (17 * Math.PI) / 180 };
    const east = rotateProp(odd, 1);
    expect(Math.round((east.rotation! * 180) / Math.PI)).toBe(45);
    expect(Math.round((rotateProp(east, 1).rotation! * 180) / Math.PI)).toBe(90);
    expect(Math.round((rotateProp(east, -1).rotation! * 180) / Math.PI)).toBe(0);
  });

  it('wraps a full turn instead of accumulating one', () => {
    let prop: ScenarioProp = { kind: 'lamp', x: 4, z: 5 };
    for (let i = 0; i < 8; i++) prop = rotateProp(prop, 1);
    expect(Math.round((prop.rotation! * 180) / Math.PI)).toBe(0);
    const back = rotateProp({ kind: 'lamp', x: 4, z: 5, rotation: -Math.PI }, -1);
    expect(Math.round((back.rotation! * 180) / Math.PI)).toBe(135);
  });

  it('nudges in eighths of a tile and never leaves the tile', () => {
    const nudged = nudgeProp(bush, 1, -2);
    expect(nudged.offsetX).toBe(0.125);
    expect(nudged.offsetZ).toBe(-0.25);
    expect(nudged.x).toBe(bush.x);
    expect(nudged.z).toBe(bush.z);
    const pinned = nudgeProp(bush, 20, 20);
    expect(pinned.offsetX).toBe(0.5);
    expect(pinned.offsetZ).toBe(0.5);
  });

  it('returns to the tile centre when the nudge is undone', () => {
    const out = nudgeProp(bush, 1, 0);
    expect(nudgeProp(out, -1, 0).offsetX).toBeUndefined();
    expect(centreProp(out).offsetX).toBeUndefined();
  });

  it('carries the nudge into a duplicate', () => {
    const shifted = nudgeProp(lamp, 2, -1);
    expect(duplicateProps([shifted], { width: 16, height: 16 })[0]).toEqual({
      kind: 'lamp',
      x: 5,
      z: 6,
      rotation: Math.PI / 2,
      scale: 1.4,
      offsetX: 0.25,
      offsetZ: -0.125,
    });
  });
});

describe('the Forge panel', () => {
  it('wires the eyedropper, the marquee and the selection actions', () => {
    expect(editorSource).toContain('data-proppick=');
    expect(editorSource).toContain('data-propsel=');
    expect(editorSource).toContain('data-propact=');
    expect(editorSource).toContain('propMarquee: TileBox | null');
    expect(editorSource).toContain('adoptPropSettings(');
    expect(editorSource).toContain('duplicateSelectedProps(');
    expect(editorSource).toContain('deleteSelectedProps(');
    // The eight compass directions and the in-tile nudge are wired, not just
    // described: the panel buttons and the raw offsets both reach the helpers.
    expect(editorSource).toContain('data-propdir=');
    expect(editorSource).toContain('rotateSelectedProps(');
    expect(editorSource).toContain('nudgeSelectedProps(');
    expect(editorSource).toContain('step="45"');
    expect(editorSource).toContain("case 'propPick'");
    expect(editorSource).toContain("case 'propSelect'");
    // The overlay draws the selection and the rubber band.
    expect(renderSource).toContain('editor.propSelection.includes(prop)');
    expect(renderSource).toContain('if (editor.propMarquee)');
  });
});
