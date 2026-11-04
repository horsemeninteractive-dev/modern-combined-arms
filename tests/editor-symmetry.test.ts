import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SYMMETRY_MODES,
  mirrorOriginX,
  mirrorTileX,
  mirrorTileZ,
  quadrantOf,
  symmetryNote,
  symmetryOwner,
  symmetryRects,
  symmetryRotates,
  symmetryStart,
  symmetryTiles,
} from '../src/ui/editorSymmetry';
import {
  railOffset,
  railRestOffset,
  railSettlesCollapsed,
  railTravel,
} from '../src/ui/editorLayout';
import { rotatePoint, rotateRect } from '../src/data/competitiveMaps';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('authoring symmetry', () => {
  it('offers one-way, two-way and four-way modes', () => {
    expect(SYMMETRY_MODES.map((mode) => mode.id)).toEqual(['single', 'mirror', 'rotate']);
    expect(SYMMETRY_MODES.map((mode) => mode.label)).toEqual(['1-WAY', '2-WAY', '4-WAY']);
  });

  it('turns four ways on a square map and mirrors four ways on a rectangle', () => {
    expect(symmetryRotates(88, 88)).toBe(true);
    expect(symmetryRotates(96, 72)).toBe(false);
    // Every shape can be authored four ways; only the arrangement differs.
    for (const mode of ['single', 'mirror', 'rotate'] as const) {
      expect(symmetryNote(mode, 96, 72)).toBeTruthy();
    }
    expect(symmetryNote('rotate', 88, 88)).toContain('four rotations');
    expect(symmetryNote('rotate', 96, 72)).toContain('both centre lines');
  });

  it('leaves a one-way map alone', () => {
    expect(symmetryTiles('single', 64, 64, 3, 5)).toEqual([]);
    expect(symmetryRects('single', 64, 64, 3, 5, 4, 2)).toEqual([]);
  });

  it('mirrors tiles across the vertical axis the legacy theatres use', () => {
    expect(mirrorTileX(64, 0)).toBe(63);
    const [twin] = symmetryTiles('mirror', 64, 64, 4, 9);
    expect(twin).toEqual({ x: 59, z: 9 });
    // An odd-width map's centre column is its own mirror: painting it must not
    // produce a duplicate stroke on the same tile.
    expect(symmetryTiles('mirror', 65, 40, 32, 9)).toEqual([]);
  });

  it('mirrors a footprint by its whole width, not its origin', () => {
    // A four-wide building at x=4 spans 4..7, so its twin spans 56..59 and its
    // origin is 56 — not `width - 1 - 4`.
    expect(mirrorOriginX(64, 4, 4)).toBe(56);
    expect(symmetryRects('mirror', 64, 64, 4, 12, 4, 3)).toEqual([{ x: 56, z: 12, w: 4, h: 3 }]);
  });

  it('repeats a stroke at every quarter turn on a square map', () => {
    const tiles = symmetryTiles('rotate', 80, 80, 7, 12).map((tile) => `${tile.x},${tile.z}`);
    expect(tiles).toEqual([
      `${rotatePoint(80, 1, 7, 12).x},${rotatePoint(80, 1, 7, 12).z}`,
      `${rotatePoint(80, 2, 7, 12).x},${rotatePoint(80, 2, 7, 12).z}`,
      `${rotatePoint(80, 3, 7, 12).x},${rotatePoint(80, 3, 7, 12).z}`,
    ]);
    expect(new Set(tiles).size).toBe(3);
    // On an odd-length map the centre tile is its own quarter turn, so the
    // stroke must not be applied to it four times.
    expect(symmetryTiles('rotate', 65, 65, 32, 32)).toEqual([]);
  });

  it('swaps footprint width and height on the side quadrants', () => {
    const rects = symmetryRects('rotate', 80, 80, 6, 10, 4, 2);
    expect(rects).toEqual([
      rotateRect(80, 1, 6, 10, 4, 2),
      rotateRect(80, 2, 6, 10, 4, 2),
      rotateRect(80, 3, 6, 10, 4, 2),
    ]);
    expect(rects[0].w).toBe(2);
    expect(rects[0].h).toBe(4);
  });

  it('combines both mirrors on a rectangular grid, one copy per quadrant', () => {
    expect(mirrorTileZ(72, 10)).toBe(61);
    expect(symmetryTiles('rotate', 96, 72, 10, 10)).toEqual([
      { x: 85, z: 10 },
      { x: 10, z: 61 },
      { x: 85, z: 61 },
    ]);
    // Footprint copies mirror by their own extent on both axes, so a 4×2 depot
    // stays 4×2 in the far column, far row and far corner.
    expect(symmetryRects('rotate', 96, 72, 10, 10, 4, 2)).toEqual([
      { x: 82, z: 10, w: 4, h: 2 },
      { x: 10, z: 60, w: 4, h: 2 },
      { x: 82, z: 60, w: 4, h: 2 },
    ]);
    // Every copy lands inside the map, which a quarter turn of a rectangle
    // could not guarantee.
    for (let x = 0; x < 96; x += 7) {
      for (let z = 0; z < 72; z += 5) {
        for (const tile of symmetryTiles('rotate', 96, 72, x, z)) {
          expect(tile.x).toBeGreaterThanOrEqual(0);
          expect(tile.x).toBeLessThan(96);
          expect(tile.z).toBeGreaterThanOrEqual(0);
          expect(tile.z).toBeLessThan(72);
        }
      }
    }
  });

  it('reads quadrants clockwise from the north-west', () => {
    expect(quadrantOf(64, 64, 4, 4)).toBe(0);
    expect(quadrantOf(64, 64, 60, 4)).toBe(1);
    expect(quadrantOf(64, 64, 60, 60)).toBe(2);
    expect(quadrantOf(64, 64, 4, 60)).toBe(3);
  });

  it('gives the far side to the other commander on a two-way map', () => {
    expect(symmetryOwner('mirror', 0, 2, 60, 12, 64, 64)).toBe(1);
    expect(symmetryOwner('mirror', 1, 2, 4, 12, 64, 64)).toBe(0);
    // Neutral ground stays neutral on both sides.
    expect(symmetryOwner('mirror', -1, 2, 60, 12, 64, 64)).toBe(-1);
  });

  it('follows the quadrant on a four-way map', () => {
    // Four commanders: one seat per quadrant.
    expect(symmetryOwner('rotate', 0, 4, 60, 4, 88, 88)).toBe(1);
    expect(symmetryOwner('rotate', 0, 4, 60, 60, 88, 88)).toBe(2);
    expect(symmetryOwner('rotate', 0, 4, 4, 60, 88, 88)).toBe(3);
    // Two commanders: the opposite quadrant is theirs, the flanks stay neutral
    // (the convention the competitive roster uses for its 1v1 pairings).
    expect(symmetryOwner('rotate', 0, 2, 60, 60, 88, 88)).toBe(1);
    expect(symmetryOwner('rotate', 0, 2, 60, 4, 88, 88)).toBe(-1);
    expect(symmetryOwner('rotate', 0, 2, 4, 60, 88, 88)).toBe(-1);
  });

  it('places deployment markers symmetrically', () => {
    // Two-way: the second seat lands on the mirrored tile.
    expect(symmetryStart('mirror', 1, 2, 6, 20, 64, 64)).toEqual({ x: 57, z: 20 });
    expect(symmetryStart('mirror', 0, 2, 6, 20, 64, 64)).toEqual({ x: 6, z: 20 });
    // Four-way: seat one takes the half turn so 1v1 keeps opposite corners.
    const half = rotatePoint(88, 2, 9, 9);
    expect(symmetryStart('rotate', 1, 2, 9, 9, 88, 88)).toEqual(half);
    // A rectangle's half turn is the combined mirror, i.e. the far corner.
    expect(symmetryStart('rotate', 1, 2, 9, 9, 96, 72)).toEqual({ x: 86, z: 62 });
    // One seat per quadrant for a four-commander rectangular map.
    expect(symmetryStart('rotate', 1, 4, 9, 9, 96, 72)).toEqual({ x: 86, z: 9 });
    expect(symmetryStart('rotate', 2, 4, 9, 9, 96, 72)).toEqual({ x: 86, z: 62 });
    expect(symmetryStart('rotate', 3, 4, 9, 9, 96, 72)).toEqual({ x: 9, z: 62 });
    expect(symmetryStart('single', 1, 2, 9, 9, 88, 88)).toEqual({ x: 9, z: 9 });
  });
});

describe('sliding sidebars', () => {
  it('stows the panel entirely, because the handle sits outside it', () => {
    expect(railTravel('left', 288)).toBe(-288);
    expect(railTravel('right', 330)).toBe(330);
  });

  it('clamps a drag between the open and stowed stops', () => {
    expect(railOffset('left', 288, 40)).toBe(0);
    expect(railOffset('left', 288, -900)).toBe(-288);
    expect(railOffset('right', 330, -50)).toBe(0);
    expect(railOffset('right', 330, 900)).toBe(330);
    expect(railRestOffset('left', 288, true)).toBe(-288);
    expect(railRestOffset('right', 330, false)).toBe(0);
  });

  it('settles shut only past the halfway point', () => {
    expect(railSettlesCollapsed('left', 288, -80)).toBe(false);
    expect(railSettlesCollapsed('left', 288, -150)).toBe(true);
    expect(railSettlesCollapsed('right', 330, 120)).toBe(false);
    expect(railSettlesCollapsed('right', 330, 170)).toBe(true);
  });
});

describe('editor wiring', () => {
  it('surfaces the three modes in the forge', () => {
    const editor = read('src/ui/editor.ts');
    expect(editor).toContain('data-symmetry=');
    expect(editor).toContain('editor-sym-row');
    expect(editor).toContain('symmetryTiles(');
    expect(editor).toContain('symmetryRects(');
    expect(editor).toContain('symmetryStart(');
    // No mode is ever disabled: the forge offers the arrangement the map shape
    // can honour instead of greying four-way out on a rectangle.
    expect(editor).not.toContain('needs a square map');
  });

  it('puts a slide rail on both sidebars', () => {
    const editor = read('src/ui/editor.ts');
    const css = read('src/style.css');
    expect(editor).toContain('data-rail="tools"');
    expect(editor).toContain('data-rail="side"');
    expect(editor).toContain('bindRails()');
    expect(css).toContain('.editor-tools.collapsed');
    expect(css).toContain('.editor-side.collapsed');
    // The touch composition keeps its own drawers, so the rails stand down.
    expect(css).toContain('.editor-rail { display: none; }');
  });
});
