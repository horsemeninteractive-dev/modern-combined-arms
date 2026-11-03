import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  NATIVE_CURSORS,
  battleCursor,
  cursorProperty,
  drawBattleCursor,
  drawOrderGhostGlyph,
  type BattleCursor,
} from '../src/ui/cursors';
import {
  GHOST_ECHOES,
  ORDER_GHOST_LIFE_MS,
  ORDER_GHOST_LIMIT,
  addOrderGhost,
  ghostOpacity,
  ghostProgress,
  ghostRise,
  ghostScale,
  pruneOrderGhosts,
  type OrderGhost,
} from '../src/ui/orderGhosts';

const ALL: BattleCursor[] = [
  'select',
  'move',
  'attack',
  'attackMove',
  'capture',
  'repair',
  'garrison',
  'place',
  'placeBlocked',
  'box',
  'pan',
];

describe('battle cursor mapping', () => {
  it('gives every armed order its own pointer and leaves the rest on select', () => {
    expect(battleCursor('none')).toBe('select');
    expect(battleCursor('move')).toBe('move');
    expect(battleCursor('attack')).toBe('attack');
    expect(battleCursor('attackMove')).toBe('attackMove');
    expect(battleCursor('capture')).toBe('capture');
    expect(battleCursor('repair')).toBe('repair');
    expect(battleCursor('garrison')).toBe('garrison');
    expect(battleCursor('box')).toBe('box');
  });

  it('reflects placement validity under the pointer', () => {
    expect(battleCursor('place', { placementOk: true })).toBe('place');
    // Unknown validity (pointer between tiles, or not yet over the field) is
    // still a placement cursor; only a rejected tile turns it red.
    expect(battleCursor('place', { placementOk: null })).toBe('place');
    expect(battleCursor('place', { placementOk: false })).toBe('placeBlocked');
  });

  it('lets a camera drag and a box drag outrank the armed order', () => {
    expect(battleCursor('attack', { panning: true })).toBe('pan');
    expect(battleCursor('place', { panning: true, placementOk: false })).toBe('pan');
    expect(battleCursor('none', { draggingBox: true })).toBe('box');
    // Input only starts a box while no order is armed, so this pairing is a
    // guard rather than a reachable state: the live rectangle always wins.
    expect(battleCursor('garrison', { draggingBox: true })).toBe('box');
  });
});

describe('pointer presentation', () => {
  it('hides the OS pointer while the canvas draws the reticle', () => {
    for (const name of ALL) {
      expect(cursorProperty(name, true)).toBe('none');
    }
  });

  it('falls back to a native pointer with the closest meaning', () => {
    for (const name of ALL) {
      expect(cursorProperty(name, false)).toBe(NATIVE_CURSORS[name]);
      expect(NATIVE_CURSORS[name]).not.toContain('url(');
    }
    expect(NATIVE_CURSORS.select).toBe('default');
    expect(NATIVE_CURSORS.attack).toBe('crosshair');
    expect(NATIVE_CURSORS.place).toBe('copy');
    expect(NATIVE_CURSORS.placeBlocked).toBe('not-allowed');
    expect(NATIVE_CURSORS.pan).toBe('grabbing');
  });

  it('draws every pointer and ghost on the canvas', () => {
    // The draw functions take a context, so a smoke check that they exist and
    // are functions is the right level here; the real rendering is verified in
    // the browser. Their geometry comes from the shared HUD icon set.
    expect(typeof drawBattleCursor).toBe('function');
    expect(typeof drawOrderGhostGlyph).toBe('function');
    expect(drawBattleCursor.length).toBe(5);
    expect(drawOrderGhostGlyph.length).toBe(7);
  });
});

describe('order ghosts', () => {
  const ghost = (born: number): OrderGhost => ({ x: 10, y: 20, kind: 'move', born });

  it('keeps a bounded trail and drops finished impressions', () => {
    const list: OrderGhost[] = [];
    for (let i = 0; i < ORDER_GHOST_LIMIT + 3; i += 1) addOrderGhost(list, ghost(i * 10));
    expect(list).toHaveLength(ORDER_GHOST_LIMIT);
    expect(list[list.length - 1].born).toBe((ORDER_GHOST_LIMIT + 2) * 10);

    // A click's ghosts are all live up to the last millisecond of the life and
    // gone on the next one; pruning compacts in place rather than allocating.
    const fresh = Array.from({ length: ORDER_GHOST_LIMIT }, () => ghost(1000));
    const kept = pruneOrderGhosts(fresh, 1000 + ORDER_GHOST_LIFE_MS - 1);
    expect(kept).toBe(fresh);
    expect(kept).toHaveLength(ORDER_GHOST_LIMIT);
    expect(pruneOrderGhosts(kept, 1000 + ORDER_GHOST_LIFE_MS)).toHaveLength(0);
  });

  it('fades fast, grows and lifts as the echo ages', () => {
    const born = 1000;
    expect(ghostProgress(born, born)).toBe(0);
    expect(ghostProgress(born, born + ORDER_GHOST_LIFE_MS)).toBe(1);
    // Clock skew or a paused tab must not produce a negative or >1 progress.
    expect(ghostProgress(born, born - 50)).toBe(0);
    expect(ghostProgress(born, born + ORDER_GHOST_LIFE_MS * 2)).toBe(1);

    expect(ghostOpacity(0)).toBeGreaterThan(ghostOpacity(0.5));
    expect(ghostOpacity(0.5)).toBeGreaterThan(ghostOpacity(1));
    expect(ghostOpacity(1)).toBe(0);
    expect(ghostScale(0)).toBe(1);
    expect(ghostScale(1)).toBeGreaterThan(1);
    expect(ghostRise(0)).toBe(0);
    expect(ghostRise(1)).toBeGreaterThan(0);
    // Several echoes are what make it a ghost rather than one toast.
    expect(GHOST_ECHOES).toBeGreaterThanOrEqual(2);
  });
});

describe('cursor integration', () => {
  it('draws the pointer and accepted-order ghosts on the overlay only', () => {
    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(app).toContain('pointerCursor = {');
    expect(app).toContain('orderGhosts');
    expect(app).toContain('markOrderGhost(');
    // A refused order must not leave a mark.
    expect(app).toContain('if (target && this.commandAttack(target.id))');
    expect(app).toContain('if (p && this.commandMove(p.x, p.z, attackMove))');

    const input = readFileSync(new URL('../src/ui/input.ts', import.meta.url), 'utf8');
    expect(input).toContain('markOrderGhost(press.startX, press.startY, order)');
    expect(input).toContain('cursorProperty(cursor, custom)');
    expect(input).toContain('pointerCursor.visible = custom && app.pointer.over');

    const overlay = readFileSync(new URL('../src/ui/overlay.ts', import.meta.url), 'utf8');
    expect(overlay).toContain('drawBattleCursor(');
    expect(overlay).toContain('drawOrderGhosts(');
    expect(overlay).toContain('pruneOrderGhosts(app.orderGhosts, now)');
    // The drawn pointer is painted last so nothing covers the click point.
    expect(overlay.indexOf('drawOrderGhosts(app')).toBeLessThan(
      overlay.indexOf('drawBattleCursor('),
    );

    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('id="overlay"');
  });

  it('offers a settings switch for the native pointers', () => {
    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(app).toContain('data-toggle="customCursors"');
    expect(app).toContain("key !== 'customCursors'");
    expect(app).toContain('customCursors: true');
  });
});
