import type { App } from '../app';
import { buildingFamily } from '../data/buildings';
import {
  TUTORIAL_ASSEMBLY_POINT,
  TUTORIAL_ASSEMBLY_TILE,
  TUTORIAL_BUILD_POINT,
} from '../data/tutorial';
import { TILE_SIZE } from '../sim/constants';
import type { Entity } from '../sim/types';

export interface TutorialMarker {
  /** A live entity takes priority over a fixed point. */
  entityId?: number;
  x?: number;
  z?: number;
  radius: number;
  color: string;
  label: string;
}

interface TutorialStep {
  title: string;
  body: string;
  /** HUD controls to ring while the player learns this beat. */
  focus?: string[];
  /** Step zero is the only one with a manual continue button. */
  next?: boolean;
}

const AMBER = '#f1c27e';
const RED = '#ef6c4d';

const STEPS: readonly TutorialStep[] = [
  {
    title: 'Find your bearings',
    body:
      'This is your training cadre. <b>Pan</b> with WASD, the arrow keys, edge scroll or a middle-mouse drag. <b>Zoom</b> with the wheel. Take a moment to look around the base, then continue.',
    next: true,
  },
  {
    title: 'Select the engineer',
    body:
      'Select the <b>Combat Engineer</b> parked beside the refinery — the amber ring marks him. Engineers build, repair and capture; nothing gets raised without one.',
  },
  {
    title: 'Raise a barracks',
    body:
      'Open the <b>BASE</b> panel in the production sidebar (or press <b>B</b>), choose <b>Field Barracks</b>, then click the marked pad. The engineer will drive over and break ground.',
    focus: ['[data-tab="base"]', '[data-build="barracks"]'],
  },
  {
    title: 'Train a rifleman',
    body:
      'Open the <b>LAND</b> production tab and queue a <b>Rifleman</b>. Infantry are cheap, fast and fragile; a few riflemen are the core of any first push.',
    focus: ['[data-tab="land"]'],
  },
  {
    title: 'Select the squad',
    body:
      'Drag a selection box around at least two riflemen, or Shift-click each one. The selection panel lists their health and the orders they can take.',
  },
  {
    title: 'Move to the assembly point',
    body:
      'Order the squad to the marked <b>assembly point</b> (right-click it, or use <b>MOVE</b> on touch). Watch the dashed path and the destination ring: the squad will route around obstacles and stop on arrival.',
  },
  {
    title: 'Engage the aggressor',
    body:
      'An aggressor engineer is isolated beyond the assembly point. With your riflemen selected, order an attack on him (right-click, or use <b>ATTACK</b> on touch). Press <b>A</b> for attack-move when you want to fight on the way.',
  },
];

const STEP_COUNT = STEPS.length;

export class TutorialDirector {
  private readonly app: App;
  private step = 0;
  private active = false;
  private complete = false;
  private engineerId = 0;
  private startRifles = new Set<number>();
  private squadIds: number[] = [];
  private barracksDefId = 'barracks';
  private startCamera = { cx: 0, cz: 0, zoom: 0 };
  private graceUntil = 0;
  private lastUi = 0;
  private lastFocusCheck = 0;
  private lastStatus = '';
  private focused: HTMLElement[] = [];
  private focusSelectors: string[] = [];

  constructor(app: App) {
    this.app = app;
  }

  /** Begin the first lane. Called only after the battle and HUD are mounted. */
  start(): void {
    const game = this.app.game;
    if (!game) return;
    this.active = true;
    this.complete = false;
    this.step = 0;
    // A battle can be replayed from the menu without a page reload. Start with
    // fresh entity ids so an old engineer or rifleman cannot satisfy a lesson.
    this.engineerId = 0;
    this.startRifles.clear();
    this.squadIds = [];
    this.focused = [];
    this.focusSelectors = [];
    this.graceUntil = performance.now() + 900;
    this.startCamera = {
      cx: this.app.renderer.camera.cx,
      cz: this.app.renderer.camera.cz,
      zoom: this.app.renderer.camera.zoom,
    };

    for (const unit of game.entitiesOf(this.app.localPlayerId, 'unit')) {
      if (unit.defId === 'engineer' && this.engineerId === 0) this.engineerId = unit.id;
      if (unit.defId === 'rifle') this.startRifles.add(unit.id);
    }
    this.barracksDefId =
      game.rosterFor(this.app.localPlayerId).buildings.find((id) => buildingFamily(id) === 'barracks') ??
      'barracks';

    this.bind();
    this.showPanel();
    this.renderStep();
    this.ensureCameraForStep();
  }

  /** The app calls this every animation frame while the battle is on screen. */
  update(_dt: number): void {
    if (!this.active || !this.app.game) return;
    const now = performance.now();
    if (now - this.lastUi > 140) {
      this.lastUi = now;
      this.updateStatus();
    }
    if (now - this.lastFocusCheck > 650) {
      this.lastFocusCheck = now;
      this.refreshFocus();
    }
    if (this.stepReady(now)) this.advance();
  }

  /** Called by the app when the battle ends, the menu opens or a new battle starts. */
  dispose(): void {
    this.active = false;
    this.clearFocus();
    const panel = document.getElementById('tutorial-panel');
    panel?.classList.add('hidden');
    const skip = document.getElementById('btn-tutorial-skip') as HTMLButtonElement | null;
    const next = document.getElementById('btn-tutorial-next') as HTMLButtonElement | null;
    const cont = document.getElementById('btn-tutorial-continue') as HTMLButtonElement | null;
    if (skip) skip.onclick = null;
    if (next) next.onclick = null;
    if (cont) cont.onclick = null;
    this.focusSelectors = [];
    this.lastStatus = '';
  }

  /** The overlay asks for the current world-space teaching marker. */
  marker(): TutorialMarker | null {
    if (!this.active || this.complete) return null;
    switch (this.step) {
      case 1: {
        const engineer = this.app.game?.getEntity(this.engineerId);
        if (!engineer || engineer.hp <= 0) return null;
        return { entityId: engineer.id, radius: 2.6, color: AMBER, label: 'ENGINEER' };
      }
      case 2:
        return {
          x: TUTORIAL_BUILD_POINT.x,
          z: TUTORIAL_BUILD_POINT.z,
          radius: 6.2,
          color: AMBER,
          label: 'BUILD PAD',
        };
      case 3: {
        const barracks = this.barracksEntity();
        if (!barracks) return null;
        return { entityId: barracks.id, radius: 4.6, color: AMBER, label: 'BARRACKS' };
      }
      case 5:
        return {
          x: TUTORIAL_ASSEMBLY_POINT.x,
          z: TUTORIAL_ASSEMBLY_POINT.z,
          radius: 4.2,
          color: AMBER,
          label: 'ASSEMBLY',
        };
      case 6: {
        const target = this.targetEntity();
        if (!target) return null;
        return { entityId: target.id, radius: 3.1, color: RED, label: 'TARGET' };
      }
      default:
        return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Progression                                                         */
  /* ------------------------------------------------------------------ */

  private stepReady(now: number): boolean {
    const game = this.app.game;
    if (!game) return false;
    switch (this.step) {
      case 0: {
        if (now < this.graceUntil) return false;
        const camera = this.app.renderer.camera;
        return (
          Math.hypot(camera.cx - this.startCamera.cx, camera.cz - this.startCamera.cz) >
            2 * TILE_SIZE || Math.abs(camera.zoom - this.startCamera.zoom) > 2
        );
      }
      case 1:
        return this.app.selectedEntities().some((e) => e.id === this.engineerId);
      case 2:
        return !!this.barracksEntity();
      case 3:
        return game.state.entities.some(
          (e) =>
            e.owner === this.app.localPlayerId &&
            e.kind === 'unit' &&
            e.defId === 'rifle' &&
            e.hp > 0 &&
            !this.startRifles.has(e.id),
        );
      case 4: {
        const rifles = this.selectedRifles();
        if (rifles.length < 2) return false;
        this.squadIds = rifles.map((e) => e.id);
        return true;
      }
      case 5:
        return this.squadNearAssembly();
      case 6:
        return !this.targetEntity();
      default:
        return false;
    }
  }

  private advance(): void {
    if (!this.active) return;
    if (this.step >= STEP_COUNT - 1) {
      this.finishLane();
      return;
    }
    this.step++;
    this.app.audio.play('ui');
    this.renderStep();
    this.ensureCameraForStep();
  }

  private finishLane(): void {
    this.active = false;
    this.complete = true;
    this.clearFocus();
    this.renderComplete();
    this.app.audio.play('complete');
  }

  private targetEntity(): Entity | undefined {
    const game = this.app.game;
    if (!game) return undefined;
    return game.state.entities.find(
      (e) =>
        e.owner !== this.app.localPlayerId &&
        e.kind === 'unit' &&
        e.defId === 'engineer' &&
        e.hp > 0,
    );
  }

  private barracksEntity(): Entity | undefined {
    const game = this.app.game;
    if (!game) return undefined;
    return game
      .entitiesOf(this.app.localPlayerId, 'building')
      .find((e) => buildingFamily(e.defId) === 'barracks' && !e.construction);
  }

  private selectedRifles(): Entity[] {
    return this.app
      .selectedEntities()
      .filter(
        (e) =>
          e.owner === this.app.localPlayerId && e.kind === 'unit' && e.defId === 'rifle',
      );
  }

  private squadNearAssembly(): boolean {
    const game = this.app.game;
    if (!game || this.squadIds.length < 2) return false;
    let alive = 0;
    let near = 0;
    for (const id of this.squadIds) {
      const unit = game.getEntity(id);
      if (!unit || unit.hp <= 0) continue;
      alive++;
      const distance = Math.hypot(
        unit.x - TUTORIAL_ASSEMBLY_POINT.x,
        unit.z - TUTORIAL_ASSEMBLY_POINT.z,
      );
      if (distance <= 3.5 * TILE_SIZE) near++;
    }
    return alive >= 2 && near >= 2;
  }

  /* ------------------------------------------------------------------ */
  /* Panel                                                               */
  /* ------------------------------------------------------------------ */

  private bind(): void {
    const skip = document.getElementById('btn-tutorial-skip') as HTMLButtonElement | null;
    const next = document.getElementById('btn-tutorial-next') as HTMLButtonElement | null;
    const cont = document.getElementById('btn-tutorial-continue') as HTMLButtonElement | null;
    if (skip) {
      skip.onclick = () => {
        this.app.audio.play('ui');
        this.app.finishTutorial();
      };
    }
    if (next) {
      next.onclick = () => {
        this.app.audio.play('ui');
        if (this.step === 0) this.advance();
      };
    }
    if (cont) {
      cont.onclick = () => {
        this.app.audio.play('ui');
        this.app.finishTutorial();
      };
    }
  }

  private showPanel(): void {
    const panel = document.getElementById('tutorial-panel');
    panel?.classList.remove('hidden');
  }

  private renderStep(): void {
    const step = STEPS[this.step];
    if (!step) return;
    const panel = document.getElementById('tutorial-panel');
    panel?.classList.remove('hidden');
    this.text('tutorial-progress-label', `${String(this.step + 1).padStart(2, '0')} / ${String(STEP_COUNT).padStart(2, '0')}`);
    this.text('tutorial-title', step.title);
    const body = document.getElementById('tutorial-body');
    if (body) body.innerHTML = step.body;
    const next = document.getElementById('btn-tutorial-next') as HTMLButtonElement | null;
    const cont = document.getElementById('btn-tutorial-continue') as HTMLButtonElement | null;
    const skip = document.getElementById('btn-tutorial-skip') as HTMLButtonElement | null;
    if (next) next.hidden = !step.next;
    if (cont) cont.hidden = true;
    if (skip) skip.hidden = false;
    this.lastStatus = '';
    this.updateStatus();
    // A national roster can substitute the barracks; focus the card the player
    // will actually see rather than assuming the baseline id is on screen.
    const selectors =
      this.step === 2
        ? ['[data-tab="base"]', `[data-build="${this.barracksDefId}"]`]
        : step.focus ?? [];
    this.applyFocus(selectors);
  }

  private renderComplete(): void {
    const panel = document.getElementById('tutorial-panel');
    panel?.classList.remove('hidden');
    this.text('tutorial-progress-label', 'COMPLETE');
    this.text('tutorial-title', 'Lane complete');
    const body = document.getElementById('tutorial-body');
    if (body) {
      body.innerHTML =
        'You have selected, built, trained, moved and fought. That is the loop: economy, production, orders. Continue the battle when you are ready, or start a skirmish and put the cadre to work.';
    }
    const next = document.getElementById('btn-tutorial-next') as HTMLButtonElement | null;
    const cont = document.getElementById('btn-tutorial-continue') as HTMLButtonElement | null;
    const skip = document.getElementById('btn-tutorial-skip') as HTMLButtonElement | null;
    if (next) next.hidden = true;
    if (cont) cont.hidden = false;
    if (skip) skip.hidden = true;
    const status = document.getElementById('tutorial-status');
    if (status) status.textContent = 'TRAINING COMPLETE';
    const meter = document.getElementById('tutorial-meter');
    if (meter) meter.style.width = '100%';
  }

  private updateStatus(): void {
    const game = this.app.game;
    if (!game) return;
    let status = '';
    switch (this.step) {
      case 0:
        status = 'PAN OR ZOOM TO CONTINUE';
        break;
      case 1:
        status = 'AWAITING ENGINEER SELECTION';
        break;
      case 2: {
        const site = game
          .entitiesOf(this.app.localPlayerId, 'building')
          .find((e) => buildingFamily(e.defId) === 'barracks');
        status = site
          ? site.construction
            ? `CONSTRUCTION ${Math.round(site.buildProgress * 100)}%`
            : 'BARRACKS OPERATIONAL'
          : 'AWAITING BARRACKS · PAD MARKED';
        break;
      }
      case 3: {
        const barracks = this.barracksEntity();
        const item = barracks?.queue[0];
        status = item
          ? `TRAINING ${Math.round((1 - item.remaining / Math.max(0.01, item.total)) * 100)}%`
          : 'SELECT LAND · QUEUE RIFLEMAN';
        break;
      }
      case 4:
        status = `${this.selectedRifles().length} RIFLEMEN SELECTED`;
        break;
      case 5:
        status = `ASSEMBLY ${TUTORIAL_ASSEMBLY_TILE.x}, ${TUTORIAL_ASSEMBLY_TILE.z} · ${Math.round(
          this.squadDistance() / TILE_SIZE,
        )} TILES`;
        break;
      case 6: {
        const target = this.targetEntity();
        status = target
          ? `TARGET ${Math.round((target.hp / Math.max(1, target.maxHp)) * 100)}%`
          : 'TARGET DESTROYED';
        break;
      }
      default:
        status = '';
    }
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      const el = document.getElementById('tutorial-status');
      if (el) el.textContent = status;
    }
    const meter = document.getElementById('tutorial-meter');
    if (meter) meter.style.width = `${Math.round(((this.step + (this.complete ? 1 : 0)) / STEP_COUNT) * 100)}%`;
  }

  private squadDistance(): number {
    const game = this.app.game;
    if (!game) return 0;
    let nearest = Infinity;
    for (const id of this.squadIds) {
      const unit = game.getEntity(id);
      if (!unit || unit.hp <= 0) continue;
      nearest = Math.min(
        nearest,
        Math.hypot(unit.x - TUTORIAL_ASSEMBLY_POINT.x, unit.z - TUTORIAL_ASSEMBLY_POINT.z),
      );
    }
    return Number.isFinite(nearest) ? nearest : 0;
  }

  private text(id: string, value: string): void {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  /* ------------------------------------------------------------------ */
  /* Focus and camera                                                    */
  /* ------------------------------------------------------------------ */

  private applyFocus(selectors: string[]): void {
    this.clearFocus();
    this.focusSelectors = selectors;
    if (selectors.length === 0) return;
    const seen = new Set<HTMLElement>();
    for (const selector of selectors) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el) || el.getClientRects().length === 0) return;
        seen.add(el);
        el.classList.add('tutorial-focus');
        this.focused.push(el);
      });
    }
  }

  private refreshFocus(): void {
    if (this.focusSelectors.length === 0) return;
    // HUD cards are rebuilt as resources change. Reapply the ring when any
    // focused node was replaced, even if another selector (such as the tab)
    // is still connected.
    if (this.focused.length > 0 && this.focused.every((el) => el.isConnected)) return;
    this.applyFocus(this.focusSelectors);
  }

  private clearFocus(): void {
    for (const el of this.focused) el.classList.remove('tutorial-focus');
    this.focused = [];
  }

  private ensureCameraForStep(): void {
    const camera = this.app.renderer.camera;
    if (this.step === 2) {
      camera.centerOn(TUTORIAL_BUILD_POINT.x, TUTORIAL_BUILD_POINT.z);
      return;
    }
    if (this.step === 3) {
      const barracks = this.barracksEntity();
      if (barracks) camera.centerOn(barracks.x, barracks.z);
      return;
    }
    if (this.step === 5) {
      camera.centerOn(TUTORIAL_ASSEMBLY_POINT.x, TUTORIAL_ASSEMBLY_POINT.z);
      return;
    }
    if (this.step === 6) {
      const target = this.targetEntity();
      camera.centerOn(
        target?.x ?? TUTORIAL_ASSEMBLY_POINT.x,
        target?.z ?? TUTORIAL_ASSEMBLY_POINT.z,
      );
    }
  }
}
