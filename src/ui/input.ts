import type { App } from '../app';
import { BUILDINGS } from '../data/buildings';
import { isGarrisonTarget, isRepairTarget } from './orderIntent';
import { edgePanVector } from './hudLayout';
import {
  battleCursor,
  cursorProperty,
  editorCursor,
  uiCursorFor,
  wantsNativeCursor,
  type AppCursor,
} from './cursors';

/** Arrow keys pan; A/S/H/C stay free for the orders the briefing advertises. */
const PAN_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/**
 * How far a right-button press may travel before it counts as a camera drag.
 * Below this the press is an order: the camera never moves, because a player
 * aiming an order at a unit cannot keep the mouse perfectly still.
 */
const DRAG_THRESHOLD_PX = 5;

/*
 * Deliberately out of scope for this pass:
 * - Key rebinding needs a persisted action map, conflict detection, key-cap
 *   rendering from the map, and a settings editor for it.
 * - Patrol needs the simulation to consume order.x2/z2 (the type already has
 *   them) plus command, gate and HUD wiring on both seats.
 * - Waypoint queues need a per-unit queue in authoritative state, snapshot and
 *   save migration, and Shift+order input; that is a simulation change.
 */

export class InputController {
  private app: App;
  private canvas: HTMLCanvasElement;
  private down: { x: number; y: number; button: number; pointerId: number; moved: boolean; touch: boolean } | null = null;
  private pan: {
    x: number;
    y: number;
    startX: number;
    startY: number;
    pointerId: number;
    /** True once the press has travelled far enough to mean "drag the view". */
    dragging: boolean;
    touch: boolean;
  } | null = null;
  private pendingTap: { x: number; y: number; pointerId: number; moved: boolean; touch: boolean } | null = null;
  private keys = new Set<string>();
  private lastClick = { id: 0, time: 0 };
  private touches = new Map<number, { x: number; y: number }>();
  /**
   * Window-level pointer position for edge panning. The canvas stops receiving
   * pointer events once the cursor crosses onto the rail or a sidebar, which is
   * exactly where three of the four edge-pan strips sit.
   */
  private edgePointer = { x: 0, y: 0, inside: false };
  private pinch: { distance: number; cx: number; cy: number } | null = null;
  private padButtons: boolean[] = [];
  private padIndex: number | null = null;
  private padWasActive = false;
  /** Last cursor key applied, so the DOM is only touched when it changes. */
  private cursorKey = '';

  constructor(app: App, canvas: HTMLCanvasElement) {
    this.app = app;
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerleave', () => {
      this.app.pointer.over = false;
    });
    window.addEventListener('pointermove', this.onWindowPointerMove, { passive: true });
    window.addEventListener('blur', () => {
      this.edgePointer.inside = false;
    });
    document.addEventListener('pointerout', (event) => {
      if (!event.relatedTarget) this.edgePointer.inside = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /* ------------------------------------------------------------------ */
  /* Pointer                                                             */
  /* ------------------------------------------------------------------ */

  private onWindowPointerMove = (event: PointerEvent): void => {
    this.edgePointer.x = event.clientX;
    this.edgePointer.y = event.clientY;
    this.edgePointer.inside = event.pointerType !== 'touch';
    // The cursor layer is app-wide, so the position is tracked even while the
    // pointer is over the deck, a panel, a modal or the editor.
    this.app.pointer.x = event.clientX;
    this.app.pointer.y = event.clientY;
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.app.screen !== 'battle') return;
    // A cinematic camera is not an order surface. The overlay owns the pointer
    // for the duration of the scene.
    if (this.app.cinematicLocked) return;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic or already-released pointers cannot be captured. */
    }
    this.app.pointer.x = event.clientX;
    this.app.pointer.y = event.clientY;
    this.app.pointer.over = true;
    const touch = event.pointerType === 'touch';
    if (touch) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size >= 2) {
        this.pendingTap = null;
        this.down = null;
        this.startPinch();
        return;
      }
    }
    if (event.button === 2 || event.button === 1) {
      // A press is not a drag yet: the view stays put until the pointer has
      // actually travelled, so a right-click order never nudges the camera.
      this.pan = {
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        pointerId: event.pointerId,
        dragging: false,
        touch,
      };
      return;
    }
    if (event.button !== 0) return;
    this.down = {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      pointerId: event.pointerId,
      moved: false,
      touch,
    };
    this.pendingTap = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      moved: false,
      touch,
    };
    if (!touch && this.app.mode !== 'none' && this.app.mode !== 'box') return;
    this.app.dragBox = {
      active: false,
      x0: event.clientX,
      y0: event.clientY,
      x1: event.clientX,
      y1: event.clientY,
    };
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.app.screen !== 'battle') return;
    if (this.app.cinematicLocked) return;
    this.app.pointer.x = event.clientX;
    this.app.pointer.y = event.clientY;
    this.app.pointer.over = true;
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size >= 2 && this.pinch) {
        const pts = [...this.touches.values()].slice(0, 2);
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const dx = cx - this.pinch.cx;
        const dy = cy - this.pinch.cy;
        // Two fingers move the view with them, the way the arrow keys do;
        // panScreen's horizontal sign is "drag the ground under the pointer".
        if (Math.abs(dx) + Math.abs(dy) > 1) this.app.renderer.camera.panScreen(-dx, dy);
        if (distance > 12 && this.pinch.distance > 12) {
          this.app.renderer.camera.setZoom(this.app.renderer.camera.zoom * (this.pinch.distance / distance));
        }
        this.pinch = { distance, cx, cy };
        return;
      }
    }
    if (this.pan && this.pan.pointerId === event.pointerId) {
      if (!this.pan.dragging) {
        const travel = Math.hypot(event.clientX - this.pan.startX, event.clientY - this.pan.startY);
        if (travel <= DRAG_THRESHOLD_PX) {
          // Still inside the click tolerance: no pan, so the press can become an order.
          this.pan.x = event.clientX;
          this.pan.y = event.clientY;
          return;
        }
        this.pan.dragging = true;
      }
      // Drag the camera in the direction of the drag, so dragging right shows
      // what is to the right — the same direction ArrowRight and edge pan go.
      this.app.renderer.camera.panScreen(this.pan.x - event.clientX, event.clientY - this.pan.y);
      this.pan.x = event.clientX;
      this.pan.y = event.clientY;
      return;
    }
    if (this.down && this.down.pointerId === event.pointerId) {
      const dx = event.clientX - this.down.x;
      const dy = event.clientY - this.down.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) this.down.moved = true;
      if (this.app.mode === 'none' || this.app.mode === 'box') {
        this.app.dragBox.active = this.down.moved;
        this.app.dragBox.x1 = event.clientX;
        this.app.dragBox.y1 = event.clientY;
      }
      if (this.pendingTap) this.pendingTap.moved = this.down.moved;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.app.screen !== 'battle') return;
    const touch = event.pointerType === 'touch';
    if (touch) this.touches.delete(event.pointerId);
    if (this.pinch && this.touches.size < 2) this.pinch = null;
    if (this.pan && this.pan.pointerId === event.pointerId) {
      const press = this.pan;
      this.pan = null;
      // The order lands where the button went down, which is where the player
      // aimed: a stray pixel of travel must not move the destination.
      if (!touch && !press.dragging && event.button === 2) {
        const order = this.app.orderAt(press.startX, press.startY, event.shiftKey);
        // Only an order the console accepted leaves a mark: a refused order is
        // already reported by its notice, and a ghost would contradict it.
        if (order) this.app.markOrderGhost(press.startX, press.startY, order);
      }
      return;
    }
    if (this.down && this.down.pointerId === event.pointerId) {
      const drag = this.app.dragBox;
      if (drag.active) {
        this.app.boxSelect(drag.x0, drag.y0, event.clientX, event.clientY, event.shiftKey);
        this.app.dragBox = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };
        this.down = null;
        this.pendingTap = null;
        return;
      }
      this.app.dragBox = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };
      const wasClick = !this.down.moved;
      const isTouch = this.down.touch;
      this.down = null;
      if (wasClick) {
        if (isTouch && this.app.additiveSelection && this.app.mode === 'none') {
          // Sticky touch add mode: taps only add/remove friendly units so the
          // player can build a selection without Shift or right-click.
          this.tapAt(event.clientX, event.clientY);
        } else {
          this.handleLeftClick(event.clientX, event.clientY, event.shiftKey, isTouch);
        }
      }
      this.pendingTap = null;
    }
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.touches.delete(event.pointerId);
    this.pinch = null;
    this.down = null;
    this.pan = null;
    this.pendingTap = null;
    this.app.dragBox = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  };

  private startPinch(): void {
    const pts = [...this.touches.values()].slice(0, 2);
    if (pts.length < 2) return;
    this.pinch = {
      distance: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
    };
    this.app.dragBox = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  }

  private onWheel = (event: WheelEvent): void => {
    if (this.app.screen !== 'battle') return;
    if (this.app.cinematicLocked) return;
    event.preventDefault();
    this.app.renderer.camera.zoomBy(event.deltaY > 0 ? 1.1 : 0.9);
  };

  /* ------------------------------------------------------------------ */
  /* Semantic clicks                                                     */
  /* ------------------------------------------------------------------ */

  private handleLeftClick(clientX: number, clientY: number, additive: boolean, moveOnEmpty: boolean): void {
    const app = this.app;
    if (app.mode === 'place') {
      app.placeAtScreen(clientX, clientY);
      return;
    }
    if (app.mode === 'superweapon') {
      app.superweaponAtScreen(clientX, clientY);
      return;
    }
    if (app.mode === 'move') {
      const p = app.worldAt(clientX, clientY);
      if (p) app.commandMove(p.x, p.z, false);
      return;
    }
    if (app.mode === 'land') {
      const p = app.worldAt(clientX, clientY);
      if (p) app.commandLand(p.x, p.z);
      return;
    }
    if (
      app.mode === 'attack' ||
      app.mode === 'attackMove' ||
      app.mode === 'capture' ||
      app.mode === 'repair' ||
      app.mode === 'garrison'
    ) {
      this.executeModeAt(clientX, clientY);
      return;
    }
    const target = app.pickAt(clientX, clientY);
    if (target) {
      const own = target.owner === app.localPlayerId;
      if (own) {
        if (additive) {
          app.addToSelection(target.id);
          return;
        }
        const now = performance.now();
        if (
          this.lastClick.id === target.id &&
          now - this.lastClick.time < 320 &&
          target.kind === 'unit'
        ) {
          this.lastClick = { id: 0, time: 0 };
          app.selectAllVisibleOfType(target.defId);
          return;
        }
        this.lastClick = { id: target.id, time: now };
        app.setSelection([target.id]);
      } else {
        app.setSelection([target.id]);
      }
      return;
    }
    const units = app.ownSelected().filter((e) => e.kind === 'unit');
    if (moveOnEmpty && units.length > 0) {
      const p = app.worldAt(clientX, clientY);
      if (p) app.commandMove(p.x, p.z, false);
      return;
    }
    if (!additive) app.setSelection([]);
  }

  private executeModeAt(clientX: number, clientY: number): void {
    const app = this.app;
    if (app.mode === 'attack') {
      const target = app.pickAt(clientX, clientY);
      if (!target || target.owner === app.localPlayerId || !app.game?.isHostile(target.owner, app.localPlayerId)) {
        app.notify('Select a hostile target.', 'warning');
        app.audio.play('denied');
        return;
      }
      app.commandAttack(target.id);
      return;
    }
    if (app.mode === 'capture') {
      const target = app.pickAt(clientX, clientY);
      if (!target || !BUILDINGS[target.defId]?.capturable) {
        app.notify('Select a signals relay, supply depot or radar station.', 'warning');
        app.audio.play('denied');
        return;
      }
      app.commandCapture(target.id);
      return;
    }
    if (app.mode === 'garrison') {
      const target = app.pickAt(clientX, clientY);
      if (!isGarrisonTarget(target)) {
        app.notify('Select a garrisonable building.', 'warning');
        app.audio.play('denied');
        return;
      }
      app.commandGarrison(target.id);
      return;
    }
    if (app.mode === 'repair') {
      const target = app.pickAt(clientX, clientY);
      const occupants =
        target && app.game ? app.game.garrisonOccupants(target.id) : [];
      if (!isRepairTarget(target, app.localPlayerId, occupants)) {
        app.notify('Select a damaged friendly structure or your own construction site.', 'warning');
        app.audio.play('denied');
        return;
      }
      app.commandRepair(target.id);
      return;
    }
    if (app.mode === 'attackMove') {
      const p = app.worldAt(clientX, clientY);
      if (p) app.commandMove(p.x, p.z, true);
    }
  }

  private tapAt(clientX: number, clientY: number): void {
    const app = this.app;
    if (app.additiveSelection && app.mode === 'none') {
      const addTarget = app.pickAt(clientX, clientY);
      if (addTarget && addTarget.owner === app.localPlayerId) app.addToSelection(addTarget.id);
      else if (!addTarget) app.notify('Add selection: tap a friendly unit.', 'info');
      return;
    }
    if (app.mode !== 'none') {
      this.handleLeftClick(clientX, clientY, false, true);
      return;
    }
    const target = app.pickAt(clientX, clientY);
    if (target) {
      if (target.owner === app.localPlayerId) app.setSelection([target.id]);
      else if (app.game?.isHostile(target.owner, app.localPlayerId)) app.commandAttack(target.id);
      else app.setSelection([target.id]);
      return;
    }
    if (app.ownSelected().some((e) => e.kind === 'unit')) {
      const p = app.worldAt(clientX, clientY);
      if (p) app.commandMove(p.x, p.z, false);
    } else {
      app.setSelection([]);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard                                                            */
  /* ------------------------------------------------------------------ */

  private modalOpen(): boolean {
    return !document.getElementById('modal-root')?.classList.contains('hidden');
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    // Cinematic playback owns Space, Enter and Escape, including on the campaign
    // deck after an operation has been accepted. No command is dispatched.
    if (this.app.cinematicLocked) {
      if (event.code === 'Space' || event.code === 'Enter' || event.code === 'Escape') {
        event.preventDefault();
        this.app.skipCinematic();
      }
      return;
    }
    if (this.app.screen !== 'battle') return;
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (this.modalOpen()) return;
    const code = event.code;
    if (PAN_KEYS.has(code)) {
      this.keys.add(code);
      event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      // Ctrl+Shift+1..4 are camera bookmarks; Ctrl+1..9 stay control groups.
      if (event.shiftKey && /^Digit[1-4]$/.test(code)) {
        event.preventDefault();
        this.app.saveBookmark(Number(code.slice(5)));
      } else if (/^Digit[1-9]$/.test(code)) {
        event.preventDefault();
        this.app.assignGroup(Number(code.slice(5)));
      } else if (code === 'KeyA') {
        // Ctrl+A is the familiar select-all: in battle it selects the army.
        event.preventDefault();
        this.app.selectAllArmy();
      } else if (code === 'KeyS') {
        event.preventDefault();
        this.app.openSaveMenu(false);
      }
      return;
    }
    if (event.altKey) return;
    // Shift+1..4 recalls a camera bookmark; plain 1..9 recalls control groups.
    if (event.shiftKey && /^Digit[1-4]$/.test(code)) {
      event.preventDefault();
      this.app.recallBookmark(Number(code.slice(5)));
      return;
    }
    if (/^Digit[1-9]$/.test(code)) {
      event.preventDefault();
      this.app.recallGroup(Number(code.slice(5)));
      return;
    }
    switch (code) {
      case 'Escape':
        event.preventDefault();
        // A command mode always cancels first; the configured behaviour only
        // governs the otherwise-idle battle.
        if (this.app.mode !== 'none') this.app.cancelMode();
        else if (this.app.settings.escBehavior === 'menu') this.app.openPauseMenu();
        else this.app.togglePause();
        break;
      case 'F2':
        event.preventDefault();
        this.app.jumpToLastAlert();
        break;
      case 'F8':
        event.preventDefault();
        this.app.cycleIdleUnit('harvester');
        break;
      case 'F9':
        event.preventDefault();
        this.app.cycleIdleUnit('engineer');
        break;
      case 'KeyP':
        event.preventDefault();
        this.app.togglePause();
        break;
      case 'Space':
        event.preventDefault();
        this.app.centerOnBase();
        break;
      case 'F3':
        event.preventDefault();
        this.app.debug = !this.app.debug;
        document.getElementById('debug-panel')?.classList.toggle('hidden', !this.app.debug);
        break;
      case 'F1':
        event.preventDefault();
        this.app.paused = true;
        this.app.openBriefing();
        break;
      case 'KeyA':
        event.preventDefault();
        this.app.setMode('attackMove');
        break;
      case 'KeyS':
        event.preventDefault();
        this.app.commandStop();
        break;
      case 'KeyH':
        event.preventDefault();
        this.app.commandHold();
        break;
      case 'KeyC':
        event.preventDefault();
        this.app.setMode('capture');
        break;
      case 'KeyG':
        event.preventDefault();
        this.app.setMode('garrison');
        break;
      case 'KeyR':
        event.preventDefault();
        this.app.commandReturn();
        break;
      case 'KeyD':
        event.preventDefault();
        this.app.commandDive();
        break;
      case 'KeyU':
        // Hides the interface for a clean capture; the same shortcut brings it
        // back, so a screenshot never traps the player without a HUD.
        event.preventDefault();
        this.app.hud.toggleVisibility();
        break;
      case 'KeyB':
        event.preventDefault();
        this.app.hud.showBuildTab();
        break;
      case 'Tab':
        event.preventDefault();
        this.app.cycleProductionTab();
        break;
      case 'Equal':
      case 'NumpadAdd':
        event.preventDefault();
        this.app.setSpeed(nextSpeed(this.app.speed, 1));
        break;
      case 'Minus':
      case 'NumpadSubtract':
        event.preventDefault();
        this.app.setSpeed(nextSpeed(this.app.speed, -1));
        break;
      default:
        break;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Per-frame camera and gamepad                                        */
  /* ------------------------------------------------------------------ */

  update(dt: number): void {
    this.syncCursor();
    if (this.app.cinematicLocked) {
      // Held keys would otherwise pan the authored camera the moment the scene
      // ended. Clear them and let the sequence own the frame.
      this.keys.clear();
      return;
    }
    if (this.app.screen !== 'battle') {
      this.updateGamepad(dt);
      return;
    }
    const camera = this.app.renderer.camera;
    let dx = 0;
    let dz = 0;
    const speed = camera.zoom * 1.9 * dt;
    if (this.keys.has('ArrowLeft')) dx -= speed;
    if (this.keys.has('ArrowRight')) dx += speed;
    if (this.keys.has('ArrowUp')) dz -= speed;
    if (this.keys.has('ArrowDown')) dz += speed;
    if (dx !== 0 || dz !== 0) camera.panView(dx, dz);
    const modal = document.getElementById('modal-root');
    const modalOpen = !!modal && !modal.classList.contains('hidden');
    if (this.app.settings.edgePan && this.edgePointer.inside && !modalOpen) {
      // Pan against the real display edges, not the inner battlefield frame.
      // The rail, production sidebar and battle console cover the outer strip
      // of the viewport, so measuring from the battlefield's inner frame left
      // three edges dead exactly where a fullscreen player pushes the pointer:
      // the cursor stops at the screen border, which sits over the HUD.
      const view = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const edgeSpeed = camera.zoom * 1.25 * dt * this.app.settings.edgePanSpeed;
      const { dx: ex, dz: ez } = edgePanVector(
        this.edgePointer.x,
        this.edgePointer.y,
        view,
        this.app.settings.edgePanWidth,
        edgeSpeed,
      );
      if (ex !== 0 || ez !== 0) camera.panView(ex, ez);
    }
    this.updateGamepad(dt);
  }

  /**
   * Keep the app-wide pointer in step with the armed order.
   *
   * The cursor layer owns the pointer on every screen, but only the battlefield
   * arms an order. Moving onto the rail, a sidebar or a modal drops the order
   * reticle and asks the control under the pointer whether it is actionable or
   * blocked. Placement validity costs a raycast and a footprint check, so it is
   * only recomputed when the mode, screen or pointer position actually changed;
   * the hot path is a string comparison.
   */
  private syncCursor(): void {
    const app = this.app;
    // A cinematic is not an order surface: no reticle is drawn over the shot.
    const battle = app.screen === 'battle' && !!app.game && !app.cinematicLocked;
    const panning = !!this.pan?.dragging;
    const draggingBox = app.dragBox.active;
    const x = Math.round(app.pointer.x);
    const y = Math.round(app.pointer.y);
    const custom = app.settings.customCursors;
    // A modal covers the battlefield without moving the pointer off it, so an
    // armed order belongs to the modal surface, not the field below.
    const modal = document.getElementById('modal-root');
    const modalOpen = !!modal && !modal.classList.contains('hidden');
    const hit = document.elementFromPoint(x, y);
    const uiCursor = uiCursorFor(hit);
    // Text entry keeps the platform I-beam, even though the OS pointer is
    // hidden everywhere else while custom cursors are on.
    const native = custom && wantsNativeCursor(hit);
    // The editor draws its map under a transparent chrome layer, so the canvas
    // under the pointer is the authoring surface. Its armed tool decides whether
    // this is a placement, a camera drag or an ordinary panel control.
    const editor = app.screen === 'editor' && app.editor.active ? app.editor : null;
    const overEditorMap = !!editor && hit === this.canvas;
    const editorState = editor && !modalOpen
      ? editorCursor({
          overMap: overEditorMap,
          overControl: uiCursor !== 'select',
          panning: editor.panning,
          panMode: editor.panMode,
          placing: editor.placementToolActive,
          placementOk:
            overEditorMap && editor.placementToolActive && !editor.panning && !editor.panMode
              ? editor.placementOk
              : false,
        })
      : null;
    // The control state is part of the key as well as the position: a card can
    // become unaffordable or disabled under a still pointer, and the pointer
    // has to turn blocked without waiting for a mouse move.
    const key = `${battle}|${editor ? 'ed' : 'ui'}|${editorState ?? ''}|${app.mode}|${x}|${y}|${panning}|${draggingBox}|${custom}|${app.pointer.over}|${modalOpen}|${app.cinematicLocked}|${this.edgePointer.inside}|${native}|${uiCursor}`;
    if (key === this.cursorKey) return;
    this.cursorKey = key;
    // Resolve the surface from the element under the pointer, not from the last
    // canvas press: a camera drag can end over the rail with pointer capture
    // still set, and the rail must not inherit the battlefield reticle.
    const onField = battle && hit === this.canvas && !modalOpen;
    let placementOk: boolean | null = null;
    if (onField && app.mode === 'place') {
      const site = app.placementAtScreen(app.pointer.x, app.pointer.y);
      if (site) placementOk = site.ok;
    }
    let cursor: AppCursor;
    let nativeName = '';
    if (editorState) {
      cursor = editorState;
      nativeName = cursorProperty(editorState, false);
    } else if (battle && (onField || panning || draggingBox)) {
      // A pan or box gesture outlives the battlefield frame: once it starts it
      // keeps its reticle while the pointer crosses the rail and sidebar.
      const fieldCursor = battleCursor(app.mode, { placementOk, panning, draggingBox });
      cursor = fieldCursor;
      nativeName = cursorProperty(fieldCursor, false);
    } else if (battle && app.mode === 'place' && !modalOpen) {
      // The deployment rail is not a build surface, so inert rail background
      // reports the placement as refused. Its actual controls still accept
      // clicks: an affordable card keeps the action hand and a disabled one the
      // blocked pointer instead of every button reading as a bad build site.
      cursor = uiCursor === 'select' ? 'placeBlocked' : uiCursor;
      nativeName = cursor === 'placeBlocked' ? cursorProperty('placeBlocked', false) : '';
    } else {
      // Over the deck, a panel or a modal: the control under the pointer decides
      // whether this is an ordinary arrow, an actionable hand or a blocked one.
      cursor = uiCursor;
      if (editor && overEditorMap) nativeName = 'crosshair';
    }
    // With custom cursors on, the level above every screen paints the pointer.
    // Off restores the platform pointer with the closest native meaning.
    app.pointerCursor.name = cursor;
    app.pointerCursor.visible = custom && this.edgePointer.inside && !native;
    if (custom) this.applyCursor('none');
    else this.applyCursor(nativeName);
  }

  private applyCursor(css: string): void {
    if (this.canvas.style.cursor !== css) this.canvas.style.cursor = css;
  }

  private updateGamepad(dt: number): void {
    if (this.app.cinematicLocked) return;
    if (this.app.screen !== 'battle' || typeof navigator.getGamepads !== 'function') return;
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected) {
        pad = candidate;
        break;
      }
    }
    if (!pad) {
      this.padIndex = null;
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    if (this.padIndex === null) {
      this.padIndex = pad.index;
      this.app.padCursor.x = rect.width / 2;
      this.app.padCursor.y = rect.height / 2;
    }
    const camera = this.app.renderer.camera;
    const dead = 0.22;
    const lx = pad.axes[0] ?? 0;
    const ly = pad.axes[1] ?? 0;
    if (Math.abs(lx) > dead || Math.abs(ly) > dead) {
      camera.panView(lx * camera.zoom * 1.8 * dt, ly * camera.zoom * 1.8 * dt);
    }
    const rx = pad.axes[2] ?? 0;
    const ry = pad.axes[3] ?? 0;
    if (Math.abs(rx) > dead || Math.abs(ry) > dead) {
      this.app.padCursor.active = true;
      this.padWasActive = true;
      this.app.padCursor.x = Math.max(0, Math.min(rect.width, this.app.padCursor.x + rx * 620 * dt));
      this.app.padCursor.y = Math.max(0, Math.min(rect.height, this.app.padCursor.y + ry * 620 * dt));
    }
    const pressed = pad.buttons.map((b) => b.pressed);
    const just = (index: number) => pressed[index] && !this.padButtons[index];
    if (just(0)) this.padClick(rect.left + this.app.padCursor.x, rect.top + this.app.padCursor.y);
    if (just(1)) {
      if (this.app.mode !== 'none') this.app.cancelMode();
      else this.app.setSelection([]);
    }
    if (just(2)) this.app.setMode('attackMove');
    if (just(3)) this.app.commandStop();
    if (just(12)) this.app.hud.cycleTab();
    if (just(13)) this.app.commandHold();
    if (just(4)) camera.zoomBy(1.08);
    if (just(5)) camera.zoomBy(0.92);
    if (just(9)) this.app.togglePause();
    if (just(8)) this.app.toMenu();
    if (just(6)) this.app.centerOnSelection();
    if (just(7)) this.app.centerOnBase();
    this.padButtons = pressed;
    void this.padWasActive;
  }

  private padClick(clientX: number, clientY: number): void {
    this.app.padCursor.active = true;
    this.tapAt(clientX, clientY);
  }
}

function nextSpeed(current: number, direction: number): number {
  const speeds = [0.5, 1, 2, 3];
  const index = speeds.indexOf(current);
  const next = Math.max(0, Math.min(speeds.length - 1, (index < 0 ? 1 : index) + direction));
  return speeds[next];
}
