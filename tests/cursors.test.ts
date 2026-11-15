import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MAX_CURSOR_DPR,
  NATIVE_CURSORS,
  UI_CURSOR_TARGETS,
  battleCursor,
  cursorProperty,
  cursorSurface,
  drawBattleCursor,
  editorCursor,
  drawOrderGhostGlyph,
  snapToDevice,
  uiCursorFor,
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
  'guard',
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
    expect(battleCursor('patrol')).toBe('move');
    expect(battleCursor('guard')).toBe('guard');
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

describe('editor pointer states', () => {
  const base = {
    overMap: true,
    overControl: false,
    panning: false,
    panMode: false,
    placing: false,
    placementOk: false,
  };

  it('keeps a camera drag on the pan reticle across the editor chrome', () => {
    expect(editorCursor({ ...base, panning: true })).toBe('pan');
    // The drag started on the map, so it stays a pan even over a rail.
    expect(editorCursor({ ...base, panning: true, overMap: false })).toBe('pan');
    // PAN mode only becomes a camera gesture once the pointer is on the map.
    expect(editorCursor({ ...base, panMode: true })).toBe('pan');
    expect(editorCursor({ ...base, panMode: true, overMap: false })).toBeNull();
  });

  it('shows placement and refusal on the map, and refusal over the panels', () => {
    expect(editorCursor({ ...base, placing: true, placementOk: true })).toBe('place');
    expect(editorCursor({ ...base, placing: true, placementOk: false })).toBe('placeBlocked');
    // Inert chrome cannot receive an authored placement.
    expect(editorCursor({ ...base, overMap: false, placing: true, placementOk: true })).toBe('placeBlocked');
    // A clickable control in that chrome keeps its own action/blocked state, so
    // the armed tool does not disguise a working button as a refused build site.
    expect(
      editorCursor({ ...base, overMap: false, overControl: true, placing: true, placementOk: true }),
    ).toBeNull();
    // Painting keeps the ordinary UI resolution; only placement tools are
    // contextual map cursors.
    expect(editorCursor({ ...base, placing: false })).toBeNull();
  });
});

describe('UI pointer states', () => {
  const control = (options: { disabled?: boolean; id?: string; static?: boolean } = {}) =>
    ({
      id: options.id ?? '',
      classList: { contains: (name: string) => options.static === true && name === 'static' },
      matches: (selector: string) =>
        selector.includes(':disabled') ? options.disabled === true : false,
      closest: () => null,
    }) as unknown as Element;
  const hit = (target: Element | null) =>
    ({ closest: () => target }) as unknown as Element;

  it('marks native and app-specific controls as actionable', () => {
    expect(UI_CURSOR_TARGETS).toContain('button');
    expect(UI_CURSOR_TARGETS).toContain('[role="button"]');
    expect(UI_CURSOR_TARGETS).toContain('[data-act]');
    expect(UI_CURSOR_TARGETS).toContain('.rail-power');
    // A chip inside a button still resolves to the control that owns the click.
    expect(uiCursorFor(hit(control()))).toBe('action');
    // Empty ground and ordinary text stay on the resting arrow.
    expect(uiCursorFor(null)).toBe('select');
    expect(uiCursorFor(hit(null))).toBe('select');
  });

  it('shows a blocked pointer on disabled controls and an offline map', () => {
    expect(uiCursorFor(hit(control({ disabled: true })))).toBe('blocked');
    expect(uiCursorFor(hit(control({ id: 'minimap', static: true })))).toBe('select');
    expect(uiCursorFor(hit(control({ id: 'minimap' })))).toBe('action');
  });
});

describe('pointer resolution', () => {
  it('rasterises at the display\u2019s real density instead of capping at 2×', () => {
    expect([cursorSurface(1920, 1080, 1).width, cursorSurface(1920, 1080, 1).height]).toEqual([
      1920,
      1080,
    ]);
    const retina = cursorSurface(1920, 1080, 2);
    expect([retina.width, retina.height]).toEqual([3840, 2160]);
    // A 3× panel is the case the old ceiling ruined: it drew at two-thirds of
    // native and let the compositor resample the pointer.
    const phone = cursorSurface(430, 932, 3);
    expect(phone.width).toBe(1290);
    expect(phone.scaleX).toBeCloseTo(3, 6);
    // The ceiling is a guard against an absurd backing store, not a cap at 2.
    expect(MAX_CURSOR_DPR).toBeGreaterThanOrEqual(3);
    expect(cursorSurface(1920, 1080, 8).width).toBe(1920 * MAX_CURSOR_DPR);
  });

  it('maps CSS space onto whole device pixels on fractional ratios', () => {
    const surface = cursorSurface(1536.5, 864, 1.5);
    expect(surface.width).toBe(2305);
    expect(surface.scaleX).toBeCloseTo(2305 / 1536.5, 6);
    expect(surface.scaleY).toBeCloseTo(surface.height / 864, 6);
    // Snapping is what stops a hairline ring shivering between subpixels while
    // the pointer is nearly still, which is far more visible at 120 Hz and up.
    expect(snapToDevice(10.4, 2)).toBe(10.5);
    expect(snapToDevice(10.1, 2)).toBe(10);
    expect(snapToDevice(10.1, 3)).toBeCloseTo(10, 6);
    expect(snapToDevice(10.1, 0)).toBe(10.1);
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
  it('draws the pointer on a layer above every screen, with ghosts on the overlay', () => {
    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(app).toContain('pointerCursor = {');
    expect(app).toContain('orderGhosts');
    expect(app).toContain('markOrderGhost(');
    expect(app).toContain('this.cursorLayer.draw(');
    expect(app).toContain("classList.toggle('custom-cursors'");
    // A refused order must not leave a mark.
    expect(app).toContain('if (target && this.commandAttack(target.id))');
    expect(app).toContain('if (p && this.commandMove(p.x, p.z, attackMove, queue))');

    const input = readFileSync(new URL('../src/ui/input.ts', import.meta.url), 'utf8');
    expect(input).toContain('markOrderGhost(press.startX, press.startY, order)');
    // Shift is a waypoint modifier, not attack-move: modifiers must not turn a
    // deliberately queued move into a different order type.
    expect(input).toContain(
      'this.app.orderAt(press.startX, press.startY, false, event.shiftKey)',
    );
    expect(input).toContain('cursorProperty(fieldCursor, false)');
    // The pointer position is tracked from the window, not only the canvas, and
    // it falls back to the arrow away from the battlefield or over a text field.
    expect(input).toContain('this.app.pointer.x = event.clientX');
    expect(input).toContain('wantsNativeCursor(hit)');
    expect(input).toContain('uiCursorFor(hit)');
    expect(input).toContain('pointerCursor.visible = custom && this.edgePointer.inside && !native');

    expect(input).toContain('editorCursor({');
    expect(input).toContain('overControl: uiCursor !== \'select\'');
    expect(input).toContain('hit === this.canvas');
    expect(input).toContain("app.mode === 'place' && !modalOpen");
    // The battle rail keeps action/blocked on its controls while a build tool is
    // armed, and only its inert surface reports the placement as refused.
    expect(input).toContain("uiCursor === 'select' ? 'placeBlocked' : uiCursor");

    const editor = readFileSync(new URL('../src/ui/editor.ts', import.meta.url), 'utf8');
    expect(editor).toContain('get panning()');
    expect(editor).toContain('get placementToolActive()');
    expect(editor).toContain('get placementOk()');

    const cursors = readFileSync(new URL('../src/ui/cursors.ts', import.meta.url), 'utf8');
    expect(cursors).toContain('export class CursorLayer');
    expect(cursors).toContain('export function editorCursor(');
    expect(cursors).toContain('export function wantsNativeCursor(');
    expect(cursors).toContain('export function uiCursorFor(');
    expect(cursors).toContain('function drawActionHand(');
    // The pointer is a small box moved by transform, not a full-screen canvas
    // repainted every frame, which is what keeps it smooth above 60 Hz.
    expect(cursors).toContain('export const CURSOR_BOX');
    expect(cursors).toContain('this.place(x, y)');
    expect(cursors).toContain('translate3d(');
    // Moving the window to another monitor must not leave a stale density.
    expect(cursors).toContain('this.ratio');
    expect(cursors).toContain('cursorSurface(');

    const overlay = readFileSync(new URL('../src/ui/overlay.ts', import.meta.url), 'utf8');
    expect(overlay).toContain('drawOrderGhosts(');
    expect(overlay).toContain('pruneOrderGhosts(app.orderGhosts, now)');
    // The pointer belongs to the app-wide layer now, not the battlefield canvas.
    expect(overlay).not.toContain('drawBattleCursor(');

    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('id="overlay"');
    expect(html).toContain('id="cursor-layer"');

    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toContain('#cursor-layer');
    expect(css).toContain('html.custom-cursors');
    // The pointer canvas is a small composited box, not a screen-sized layer.
    expect(css).toMatch(/#cursor-layer \{[^}]*width: 56px/);
    expect(css).toContain('will-change: transform');
  });

  it('offers a settings switch for the native pointers', () => {
    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(app).toContain('data-toggle="customCursors"');
    expect(app).toContain("key !== 'customCursors'");
    expect(app).toContain('customCursors: true');
  });
});
