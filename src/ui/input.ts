import type { App } from '../app';
import { BUILDINGS } from '../data/buildings';
import { isGarrisonTarget, isRepairTarget } from './orderIntent';

/** Arrow keys pan; A/S/H/C stay free for the orders the briefing advertises. */
const PAN_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class InputController {
  private app: App;
  private canvas: HTMLCanvasElement;
  private down: { x: number; y: number; button: number; pointerId: number; moved: boolean; touch: boolean } | null = null;
  private pan: { x: number; y: number; pointerId: number } | null = null;
  private pendingTap: { x: number; y: number; pointerId: number; moved: boolean; touch: boolean } | null = null;
  private keys = new Set<string>();
  private lastClick = { id: 0, time: 0 };
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; cx: number; cy: number } | null = null;
  private padButtons: boolean[] = [];
  private padIndex: number | null = null;
  private padWasActive = false;

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
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /* ------------------------------------------------------------------ */
  /* Pointer                                                             */
  /* ------------------------------------------------------------------ */

  private onPointerDown = (event: PointerEvent): void => {
    if (this.app.screen !== 'battle') return;
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
      this.pan = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
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
        if (Math.abs(dx) + Math.abs(dy) > 1) this.app.renderer.camera.panScreen(dx, dy);
        if (distance > 12 && this.pinch.distance > 12) {
          this.app.renderer.camera.setZoom(this.app.renderer.camera.zoom * (this.pinch.distance / distance));
        }
        this.pinch = { distance, cx, cy };
        return;
      }
    }
    if (this.pan && this.pan.pointerId === event.pointerId) {
      this.app.renderer.camera.panScreen(event.clientX - this.pan.x, event.clientY - this.pan.y);
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
      const dx = event.clientX - this.pan.x;
      const dy = event.clientY - this.pan.y;
      const totalMoved = Math.abs(dx) + Math.abs(dy);
      this.pan = null;
      if (!touch && totalMoved < 6 && event.button === 2) {
        this.app.orderAt(event.clientX, event.clientY, event.shiftKey);
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
    if (app.mode === 'move') {
      const p = app.worldAt(clientX, clientY);
      if (p) app.commandMove(p.x, p.z, false);
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
      if (!isRepairTarget(target, app.localPlayerId)) {
        app.notify('Select a damaged friendly structure.', 'warning');
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
      if (/^Digit[1-9]$/.test(code)) {
        event.preventDefault();
        this.app.assignGroup(Number(code.slice(5)));
      } else if (code === 'KeyS') {
        event.preventDefault();
        this.app.openSaveMenu(false);
      }
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
        if (this.app.mode !== 'none') this.app.cancelMode();
        else this.app.togglePause();
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
    if (this.app.settings.edgePan && this.app.pointer.over) {
      const margin = 14;
      const w = camera.width;
      const h = camera.height;
      const rect = this.canvas.getBoundingClientRect();
      const px = this.app.pointer.x - rect.left;
      const py = this.app.pointer.y - rect.top;
      let ex = 0;
      let ez = 0;
      const edgeSpeed = camera.zoom * 1.25 * dt;
      if (px < margin && px >= 0) ex -= edgeSpeed;
      if (px > w - margin) ex += edgeSpeed;
      if (py < margin && py >= 0) ez -= edgeSpeed;
      if (py > h - margin) ez += edgeSpeed;
      if (ex !== 0 || ez !== 0) camera.panView(ex, ez);
    }
    this.updateGamepad(dt);
  }

  private updateGamepad(dt: number): void {
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
