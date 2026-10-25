import { Renderer } from './render/renderer';
import { Game } from './sim/game';
import { TICK_MS, TILE_SIZE } from './sim/constants';
import { BUILDINGS } from './data/buildings';
import { UNITS } from './data/units';
import { createIslandAssault } from './data/scenarios';
import {
  cloneScenario,
  canLaunch,
  validateScenario,
  type Scenario,
} from './sim/scenario';
import type { AIDifficulty, Command, Entity, Stance, VictoryState } from './sim/types';
import type { SaveData } from './sim/save';
import { AudioEngine } from './ui/audio';
import { HUD } from './ui/hud';
import { InputController } from './ui/input';
import { Editor } from './ui/editor';
import { Overlay } from './ui/overlay';
import { openModal, confirmDialog, escapeHtml, closeModal } from './ui/modal';
import { pickTerrain, terrainVisualHeight, type TerrainHit } from './render/terrainSurface';
import { constructionGridVisible } from './render/gridVisibility';
import { contextOrderFor } from './ui/orderIntent';

export type Screen = 'menu' | 'battle' | 'editor';
export type CommandMode =
  | 'none'
  | 'move'
  | 'attack'
  | 'attackMove'
  | 'capture'
  | 'repair'
  | 'garrison'
  | 'box'
  | 'place';

export interface AppSettings {
  sfx: number;
  ambient: number;
  effects: boolean;
  shake: boolean;
  fogVisual: boolean;
  edgePan: boolean;
  /** Opponent strength for new battles; a loaded save keeps its own. */
  difficulty: AIDifficulty;
}

export interface DragBox {
  active: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const SETTINGS_KEY = 'iron-tide.settings.v1';
const SAVE_PREFIX = 'iron-tide.save.v1.';
export const SAVE_SLOTS = [1, 2, 3];

const DIFFICULTY_COPY: Record<AIDifficulty, string> = {
  recruit: 'Recruit — thin economy and early small attacks; the easiest commander.',
  veteran: 'Veteran — balanced expansion, production and attack timing.',
  elite: 'Elite — the broadest economy and the best-timed combined-arms push.',
};

const DIFFICULTIES = Object.keys(DIFFICULTY_COPY) as AIDifficulty[];

export class App {
  readonly renderer: Renderer;
  readonly audio = new AudioEngine();
  readonly overlay: Overlay;
  readonly hud: HUD;
  readonly input: InputController;
  readonly editor: Editor;

  screen: Screen = 'menu';
  game: Game | null = null;
  selected: number[] = [];
  groups = new Map<number, number[]>();
  /** Sticky touch add-to-selection mode; desktop Shift remains unchanged. */
  additiveSelection = false;
  mode: CommandMode = 'none';
  placeDefId: string | null = null;
  paused = false;
  speed = 1;
  debug = false;
  settings: AppSettings;
  perf = { fps: 0, simMs: 0, frameMs: 0, entities: 0 };
  dragBox: DragBox = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  pointer = { x: 0, y: 0, over: false };
  padCursor = { x: 0, y: 0, active: false };

  private lastEventSeq = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private victoryShown: VictoryState | 'none' = 'none';
  private fpsSamples: number[] = [];

  constructor(canvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.overlay = new Overlay(overlayCanvas);
    this.settings = this.loadSettings();
    this.applySettings();
    this.hud = new HUD(this);
    this.input = new InputController(this, canvas);
    this.editor = new Editor(this);
    this.installMenu();
    this.installResize();
    this.bindFirstInteraction();
    this.resize();
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
    if (this.renderer.isTouch) document.body.classList.add('touch');
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  private loadSettings(): AppSettings {
    const defaults: AppSettings = {
      sfx: 0.8,
      ambient: 0.35,
      effects: true,
      shake: true,
      fogVisual: true,
      edgePan: true,
      difficulty: 'veteran',
    };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      const difficulty = DIFFICULTIES.includes(parsed.difficulty as AIDifficulty)
        ? (parsed.difficulty as AIDifficulty)
        : defaults.difficulty;
      return { ...defaults, ...parsed, difficulty };
    } catch {
      return defaults;
    }
  }

  applySettings(): void {
    this.renderer.settings.effects = this.settings.effects;
    this.renderer.settings.shake = this.settings.shake;
    this.renderer.settings.showFog = this.settings.fogVisual;
    this.audio.setVolumes(1, this.settings.sfx, this.settings.ambient);
  }

  saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* Storage can be unavailable in private mode; settings stay in memory. */
    }
    this.applySettings();
  }

  /* ------------------------------------------------------------------ */
  /* Boot / menu                                                         */
  /* ------------------------------------------------------------------ */

  private bindFirstInteraction(): void {
    const start = () => this.audio.init();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }

  private installMenu(): void {
    const on = (id: string, fn: () => void) => {
      document.getElementById(id)?.addEventListener('click', () => {
        this.audio.init();
        this.audio.play('ui');
        fn();
      });
    };
    on('btn-deploy', () => void this.startBattle(createIslandAssault()));
    on('btn-editor', () => this.openEditor());
    on('btn-load', () => this.openLoadMenu());
    on('btn-briefing', () => this.openBriefing());
    document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const difficulty = btn.dataset.difficulty as AIDifficulty;
        if (!DIFFICULTIES.includes(difficulty)) return;
        this.audio.init();
        this.audio.play('ui');
        this.settings.difficulty = difficulty;
        this.saveSettings();
        this.applyDifficultyUi();
      });
    });
    this.applyDifficultyUi();
  }

  private applyDifficultyUi(): void {
    const current = this.settings.difficulty;
    document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((btn) => {
      const active = btn.dataset.difficulty === current;
      btn.classList.toggle('on', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const note = document.getElementById('difficulty-note');
    if (note) note.textContent = DIFFICULTY_COPY[current];
  }

  private showMenu(): void {
    document.getElementById('menu-screen')?.classList.remove('hidden');
    document.getElementById('loading-screen')?.classList.add('hidden');
    this.hud.unmount();
    this.screen = 'menu';
    this.game = null;
    this.paused = false;
    this.overlay.clear();
    this.renderer.setGame(null);
    this.renderer.camera.setScreenLift(0);
    this.renderer.camera.setZoom(52);
    this.applyDifficultyUi();
  }

  private setLoading(active: boolean, title = 'Assembling task force…', hint = 'Building terrain mesh · plotting navigation · briefing AI commander'): void {
    const screen = document.getElementById('loading-screen');
    if (!screen) return;
    screen.classList.toggle('hidden', !active);
    const t = document.getElementById('loading-title');
    const h = document.getElementById('loading-hint');
    if (t) t.textContent = title;
    if (h) h.textContent = hint;
  }

  /* ------------------------------------------------------------------ */
  /* Battle lifecycle                                                    */
  /* ------------------------------------------------------------------ */

  async startBattle(scenario: Scenario): Promise<void> {
    const errors = validateScenario(scenario).filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      this.notify(`Cannot deploy: ${errors[0].message}`, 'critical');
      this.openValidation(errors);
      return;
    }
    if (!canLaunch(scenario)) return;
    this.audio.init();
    this.setLoading(true);
    document.getElementById('menu-screen')?.classList.add('hidden');
    this.hud.unmount();
    this.overlay.clear();
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    try {
      const gameScenario = cloneScenario(scenario);
      // A fresh commander each battle: same map, different opening and
      // temperament. The seed is stored in the save, so a reload still
      // replays the same opponent.
      const aiSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      const game = new Game(gameScenario, {
        localPlayerId: 0,
        enableAI: true,
        aiSeed,
        aiDifficulty: this.settings.difficulty,
      });
      this.game = game;
      this.renderer.settings.showFog = this.settings.fogVisual && gameScenario.settings.fog;
      this.renderer.setGame(game);
      this.renderer.camera.setBattleZoom();
      this.screen = 'battle';
      this.paused = false;
      this.speed = 1;
      this.lastEventSeq = 0;
      this.victoryShown = 'none';
      this.selected = [];
      this.groups.clear();
      this.mode = 'none';
      this.placeDefId = null;
      this.accumulator = 0;
      this.hud.mount(game);
      this.lastEventSeq = 0;
      this.frameBattleCamera();
      this.setLoading(false);
      this.notify('Beachhead established. Establish your economy.', 'info');
    } catch (error) {
      this.setLoading(false);
      this.showMenu();
      const message = error instanceof Error ? error.message : String(error);
      this.notify(`Battle failed to start: ${message}`, 'critical');
      openModal({
        title: 'Unable to start battle',
        body: `<p>${escapeHtml(message)}</p><p>The scenario may reference unsupported content or be too large for this device.</p>`,
        actions: [{ label: 'Return to menu', primary: true }],
      });
    }
  }

  async restart(): Promise<void> {
    if (!this.game) return;
    const scenario = cloneScenario(this.game.state.scenario);
    await this.startBattle(scenario);
  }

  toMenu(): void {
    if (this.screen === 'battle' && this.game && this.game.state.victory === 'playing') {
      confirmDialog('Abandon battle?', 'Current progress will be lost unless you saved.', 'Abandon', () => {
        this.showMenu();
      });
      return;
    }
    this.showMenu();
  }

  togglePause(): void {
    if (this.screen !== 'battle' || !this.game) return;
    if (this.game.state.victory !== 'playing') return;
    this.paused = !this.paused;
    this.audio.play('ui');
    if (!this.paused) this.lastFrame = performance.now();
  }

  setSpeed(multiplier: number): void {
    this.speed = multiplier;
    this.audio.play('ui');
  }

  private frame = (now: number): void => {
    const raw = now - this.lastFrame;
    this.lastFrame = now;
    const dt = Math.min(0.1, raw / 1000);
    this.fpsSamples.push(raw);
    if (this.fpsSamples.length > 60) this.fpsSamples.shift();
    this.perf.fps = Math.round(1000 / (this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length));
    this.perf.frameMs = Math.round(raw * 10) / 10;

    this.input.update(dt);
    // Construction guidance belongs to placement only; editor has its own grid.
    this.renderer.settings.grid = constructionGridVisible(this.screen, this.mode);
    if (this.screen === 'battle' && this.game && !this.paused) {
      const simStart = performance.now();
      this.accumulator += Math.min(0.25, dt) * this.speed;
      let steps = 0;
      while (this.accumulator >= TICK_MS / 1000 && steps < 8) {
        this.game.tick();
        this.accumulator -= TICK_MS / 1000;
        steps++;
      }
      this.perf.simMs = Math.round((performance.now() - simStart) * 100) / 100;
      this.drainEvents();
    }

    if (this.screen === 'battle' && this.game) {
      const sig = this.hudSignatureOf(this.game);
      this.hud.update(this.game, dt, sig);
      this.checkVictory();
      this.renderer.update(dt);
      this.renderer.render();
      this.overlay.draw(this);
      this.perf.entities = this.game.state.entities.length;
    } else if (this.screen === 'editor') {
      this.renderer.update(dt);
      this.renderer.render();
      this.editor.draw();
    } else {
      this.renderer.render();
    }
    requestAnimationFrame(this.frame);
  };

  private drainEvents(): void {
    if (!this.game) return;
    const events = this.game.eventsAfter(this.lastEventSeq);
    if (events.length === 0) return;
    this.lastEventSeq = events[events.length - 1].seq;
    for (const ev of events) {
      const local = this.game.localPlayerId;
      const isLocal = ev.team === local;
      if (isLocal && ev.sound) this.audio.play(ev.sound);
      if (isLocal && (ev.level === 'warning' || ev.level === 'critical')) {
        this.hud.log(ev.text, ev.level, ev.tick);
        this.toast(ev.text, ev.level === 'critical' ? 'critical' : 'warning');
      } else if (isLocal || ev.type === 'buildingLost' || ev.type === 'capture') {
        this.hud.log(ev.text, ev.level ?? 'info', ev.tick);
      }
    }
  }

  private checkVictory(): void {
    if (!this.game) return;
    const result = this.game.state.victory;
    if (result === 'playing' || this.victoryShown === result) return;
    this.victoryShown = result;
    this.selected = [];
    this.mode = 'none';
    this.hud.showEnd(result);
  }

  private hudSignatureOf(game: Game): string {
    return game.state.entities
      .map((e) => `${e.id}:${e.kind}:${e.queue.map((item) => item.defId).join(',')}:${e.construction ? 1 : 0}:${e.owner}`)
      .join('|');
  }

  /* ------------------------------------------------------------------ */
  /* Selection and commands                                              */
  /* ------------------------------------------------------------------ */

  get localPlayerId(): number {
    return this.game?.localPlayerId ?? 0;
  }

  get localPlayer() {
    return this.game?.player(this.localPlayerId) ?? null;
  }

  selectedEntities(): Entity[] {
    if (!this.game) return [];
    const out: Entity[] = [];
    for (const id of this.selected) {
      const e = this.game.getEntity(id);
      if (e && e.hp > 0) out.push(e);
    }
    return out;
  }

  ownSelected(): Entity[] {
    return this.selectedEntities().filter((e) => e.owner === this.localPlayerId);
  }

  setSelection(ids: number[]): void {
    if (!this.game) {
      this.selected = [];
      return;
    }
    const seen = new Set<number>();
    const next: number[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      const e = this.game.getEntity(id);
      if (!e || e.hp <= 0) continue;
      // A charted structure can still be selected after it slips out of vision;
      // a hidden one cannot be clicked at all.
      if (e.owner !== this.localPlayerId && !this.game.isKnownTo(this.game.teamOf(this.localPlayerId), id)) continue;
      seen.add(id);
      next.push(id);
      if (next.length >= 48) break;
    }
    this.selected = next;
    this.mode = 'none';
    this.placeDefId = null;
    this.hud.selectionChanged();
  }

  addToSelection(id: number): void {
    const e = this.game?.getEntity(id);
    if (!e) return;
    if (this.selected.includes(id)) {
      this.selected = this.selected.filter((s) => s !== id);
    } else {
      this.selected = [...this.selected, id];
    }
    this.hud.selectionChanged();
  }

  toggleAdditiveSelection(): void {
    this.additiveSelection = !this.additiveSelection;
    this.hud.selectionChanged();
  }

  selectAllVisibleOfType(defId: string): void {
    if (!this.game) return;
    const ids = this.game
      .entitiesOf(this.localPlayerId, 'unit')
      .filter((e) => e.defId === defId && this.game?.isVisibleTo(this.localPlayerId, e.id))
      .map((e) => e.id);
    this.setSelection(ids);
  }

  pickAt(clientX: number, clientY: number): Entity | null {
    if (!this.game) return null;
    const rect = this.rendererCanvasRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const e of this.game.state.entities) {
      if (e.hp <= 0) continue;
      if (
        e.owner !== this.localPlayerId &&
        !this.game.isKnownTo(this.game.teamOf(this.localPlayerId), e.id)
      ) continue;
      const y = terrainVisualHeight(this.game.state.scenario, e.x, e.z) + (e.kind === 'unit' && UNITS[e.defId]?.domain === 'air' ? 12 : 1);
      const p = this.renderer.camera.worldToScreen(e.x, y, e.z);
      if (!p.visible) continue;
      const dx = p.x - px;
      const dy = p.y - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      const threshold = e.kind === 'building' ? 42 : 26;
      if (d < threshold && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  toggleSelectionAt(clientX: number, clientY: number): void {
    const e = this.pickAt(clientX, clientY);
    if (!e) {
      this.setSelection([]);
      return;
    }
    if (e.owner !== this.localPlayerId) {
      this.setSelection([e.id]);
      return;
    }
    this.addToSelection(e.id);
  }

  boxSelect(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    if (!this.game) return;
    const rect = this.rendererCanvasRect();
    const minX = Math.min(x0, x1) - rect.left;
    const maxX = Math.max(x0, x1) - rect.left;
    const minY = Math.min(y0, y1) - rect.top;
    const maxY = Math.max(y0, y1) - rect.top;
    const ids: number[] = [];
    for (const e of this.game.state.entities) {
      if (e.owner !== this.localPlayerId || e.hp <= 0 || e.kind === 'building') continue;
      const p = this.renderer.camera.worldToScreen(e.x, terrainVisualHeight(this.game.state.scenario, e.x, e.z) + 1, e.z);
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) ids.push(e.id);
    }
    const base = additive ? this.selected : [];
    this.setSelection([...base, ...ids]);
    if (ids.length === 0 && !additive) this.notify('No units in selection box.', 'info');
  }

  /** Resolve a screen point against the sloped terrain; null means a real miss. */
  worldAt(clientX: number, clientY: number): TerrainHit | null {
    const game = this.game;
    if (!game) return null;
    const rect = this.rendererCanvasRect();
    const ray = this.renderer.camera.screenRay(clientX - rect.left, clientY - rect.top);
    return pickTerrain(game.state.scenario, ray);
  }

  private rendererCanvasRect(): DOMRect {
    return document.getElementById('gl')!.getBoundingClientRect();
  }

  orderAt(clientX: number, clientY: number, attackMove = false): void {
    if (!this.game) return;
    const target = this.pickAt(clientX, clientY);
    const hostile = !!target && this.game.isHostile(target.owner, this.localPlayerId);
    switch (contextOrderFor(target, this.ownSelected(), this.localPlayerId, hostile)) {
      case 'capture':
        if (target) this.commandCapture(target.id);
        return;
      case 'repair':
        if (target) this.commandRepair(target.id);
        return;
      case 'garrison':
        if (target) this.commandGarrison(target.id);
        return;
      case 'attack':
        if (target) this.commandAttack(target.id);
        return;
      default: {
        const p = this.worldAt(clientX, clientY);
        if (p) this.commandMove(p.x, p.z, attackMove);
      }
    }
  }

  commandMove(x: number, z: number, attackMove = false): void {
    if (!this.game) return;
    const units = this.ownSelected().filter((e) => e.kind === 'unit');
    const movable = units.filter((e) => !e.garrisonId);
    if (units.length > 0 && movable.length === 0) {
      this.mode = 'none';
      this.notify('Garrisoned infantry must exit the building before moving.', 'warning');
      this.audio.play('denied');
      return;
    }
    const buildings = this.ownSelected().filter((e) => e.kind === 'building');
    if (movable.length > 0) {
      const cmd: Command = { type: 'move', team: this.localPlayerId, ids: movable.map((e) => e.id), x, z, attackMove };
      this.game.enqueueCommand(cmd);
      this.audio.play('ui');
      this.mode = 'none';
      return;
    }
    if (buildings.length === 1) {
      const target = buildings[0];
      // Refuse before queuing so the confirmation is never a lie: a shipyard
      // only rallies its hulls to water.
      const status = this.game.rallyStatus(target.id, x, z);
      if (!status.ok) {
        this.notify(status.reason, 'warning');
        this.audio.play('denied');
        return;
      }
      this.game.enqueueCommand({ type: 'setRally', team: this.localPlayerId, buildingId: target.id, x, z });
      this.audio.play('ui');
      this.mode = 'none';
      this.notify(target.defId === 'shipyard' ? 'Naval rally point set.' : 'Rally point set.', 'info');
      return;
    }
    this.notify('Select units to issue orders.', 'warning');
    this.audio.play('denied');
  }

  commandAttack(targetId: number): void {
    if (!this.game) return;
    // Static defences with a traversing gun take the same target order as
    // mobile combat units; unarmed structures cannot be ordered to attack.
    const attackers = this.ownSelected().filter(
      (e) =>
        (e.kind === 'unit' && !e.garrisonId) ||
        (e.kind === 'building' &&
          !e.construction &&
          !!BUILDINGS[e.defId]?.weapons?.length),
    );
    if (attackers.length === 0) {
      this.notify('Select combat units or an armed defence to attack.', 'warning');
      this.audio.play('denied');
      return;
    }
    this.game.enqueueCommand({ type: 'attack', team: this.localPlayerId, ids: attackers.map((e) => e.id), targetId });
    this.audio.play('ui');
    this.mode = 'none';
  }

  commandCapture(targetId: number): void {
    if (!this.game) return;
    const engineers = this.ownSelected().filter((e) => UNITS[e.defId]?.canCapture && !e.garrisonId);
    if (engineers.length === 0) {
      this.notify('Combat Engineers capture strategic objectives.', 'warning');
      this.audio.play('denied');
      return;
    }
    this.game.enqueueCommand({ type: 'capture', team: this.localPlayerId, ids: engineers.map((e) => e.id), targetId });
    this.audio.play('ui');
    this.mode = 'none';
  }

  commandGarrison(targetId: number): void {
    if (!this.game) return;
    const infantry = this.ownSelected().filter(
      (e) => e.kind === 'unit' && !e.garrisonId && UNITS[e.defId]?.canGarrison,
    );
    if (infantry.length === 0) {
      this.notify('Select riflemen or ATGM teams to garrison a building.', 'warning');
      this.audio.play('denied');
      return;
    }
    this.game.enqueueCommand({ type: 'garrison', team: this.localPlayerId, ids: infantry.map((e) => e.id), targetId });
    this.audio.play('ui');
    this.mode = 'none';
  }

  commandUngarrison(): void {
    if (!this.game) return;
    const selected = this.selectedEntities();
    const ids = selected
      .filter((e) => {
        if (e.kind === 'unit') return e.owner === this.localPlayerId && !!e.garrisonId;
        return this.game!.garrisonOccupants(e.id).some((u) => u.owner === this.localPlayerId);
      })
      .map((e) => e.id);
    if (ids.length === 0) {
      this.notify('Select garrisoned infantry or an occupied building to order them out.', 'warning');
      this.audio.play('denied');
      return;
    }
    this.game.enqueueCommand({ type: 'ungarrison', team: this.localPlayerId, ids });
    this.audio.play('ui');
    this.mode = 'none';
  }

  commandRepair(targetId: number): void {
    if (!this.game) return;
    const engineers = this.ownSelected().filter((e) => UNITS[e.defId]?.canBuild);
    if (engineers.length === 0) {
      this.notify('Combat Engineers repair damaged structures.', 'warning');
      this.audio.play('denied');
      return;
    }
    this.game.enqueueCommand({ type: 'repair', team: this.localPlayerId, ids: engineers.map((e) => e.id), targetId });
    this.audio.play('ui');
    this.mode = 'none';
  }

  commandStop(): void {
    if (!this.game) return;
    const ids = this.ownSelected()
      .filter(
        (e) =>
          e.kind === 'unit' ||
          (e.kind === 'building' && !!BUILDINGS[e.defId]?.weapons?.length),
      )
      .map((e) => e.id);
    if (ids.length === 0) return;
    this.game.enqueueCommand({ type: 'stop', team: this.localPlayerId, ids });
    this.audio.play('ui');
  }

  commandHold(): void {
    if (!this.game) return;
    const ids = this.ownSelected().filter((e) => e.kind === 'unit').map((e) => e.id);
    if (ids.length === 0) return;
    this.game.enqueueCommand({ type: 'hold', team: this.localPlayerId, ids });
    this.audio.play('ui');
  }

  setStance(stance: Stance): void {
    if (!this.game) return;
    const ids = this.ownSelected().filter((e) => e.kind === 'unit').map((e) => e.id);
    if (ids.length === 0) return;
    this.game.enqueueCommand({ type: 'stance', team: this.localPlayerId, ids, stance });
    this.audio.play('ui');
  }

  commandReturn(): void {
    if (!this.game) return;
    const ids = this.ownSelected()
      .filter((e) => e.kind === 'unit' && (UNITS[e.defId]?.domain === 'air' || UNITS[e.defId]?.domain === 'naval'))
      .map((e) => e.id);
    if (ids.length === 0) {
      this.notify('Only aircraft and ships can return for service.', 'warning');
      return;
    }
    this.game.enqueueCommand({ type: 'return', team: this.localPlayerId, ids });
    this.audio.play('ui');
  }

  setMode(mode: CommandMode): void {
    if (!this.game) return;
    if (mode === 'place' && !this.placeDefId) {
      this.notify('Choose a structure to build first.', 'warning');
      return;
    }
    if (mode === 'repair' && !this.ownSelected().some((e) => UNITS[e.defId]?.canBuild)) {
      this.notify('Select a Combat Engineer to repair structures.', 'warning');
      this.audio.play('denied');
      return;
    }
    if (
      mode === 'garrison' &&
      !this.ownSelected().some(
        (e) => e.kind === 'unit' && !e.garrisonId && UNITS[e.defId]?.canGarrison,
      )
    ) {
      this.notify('Select riflemen or ATGM teams to garrison a building.', 'warning');
      this.audio.play('denied');
      return;
    }
    if (
      mode === 'move' &&
      !this.ownSelected().some((e) => e.kind === 'unit' || e.kind === 'building')
    ) {
      this.notify('Select units or a production structure to move or rally.', 'warning');
      this.audio.play('denied');
      return;
    }
    this.mode = this.mode === mode ? 'none' : mode;
    if (this.mode !== 'place') this.placeDefId = null;
    if (this.mode !== 'none' && this.additiveSelection) {
      this.additiveSelection = false;
      this.hud.selectionChanged();
    }
    this.audio.play('ui');
  }

  cancelMode(): void {
    this.mode = 'none';
    this.placeDefId = null;
    this.hud.selectionChanged();
  }

  /* ------------------------------------------------------------------ */
  /* Economy, production and construction                                */
  /* ------------------------------------------------------------------ */

  produce(buildingId: number, defId: string): void {
    if (!this.game) return;
    const status = this.game.productionStatus(this.localPlayerId, buildingId, defId);
    if (!status.ok) {
      this.notify(status.reason, 'warning');
      this.audio.play('denied');
      return;
    }
    this.game.enqueueCommand({ type: 'produce', team: this.localPlayerId, buildingId, defId });
    this.audio.play('queue');
  }

  cancelProduction(buildingId: number, index: number): void {
    if (!this.game) return;
    this.game.enqueueCommand({ type: 'cancelProduction', team: this.localPlayerId, buildingId, index });
    this.audio.play('ui');
  }

  reorderProduction(buildingId: number, defId: string, beforeDefId: string): void {
    if (!this.game) return;
    this.game.enqueueCommand({
      type: 'reorderProduction',
      team: this.localPlayerId,
      buildingId,
      defId,
      beforeDefId,
    });
    this.audio.play('ui');
  }

  beginPlacement(defId: string): void {
    if (!this.game) return;
    if (!BUILDINGS[defId]) return;
    // No engineer needs to be selected: the site is placed immediately and an
    // idle engineer is dispatched to it by the simulation.
    this.placeDefId = defId;
    this.mode = 'place';
    this.audio.play('ui');
    this.hud.selectionChanged();
  }

  placementAtScreen(clientX: number, clientY: number): { tileX: number; tileZ: number; ok: boolean; reason: string } | null {
    if (!this.game || !this.placeDefId) return null;
    const def = BUILDINGS[this.placeDefId];
    if (!def) return null;
    const world = this.worldAt(clientX, clientY);
    if (!world) return null;
    const tx = Math.floor(world.x / TILE_SIZE - def.footprint.w / 2);
    const tz = Math.floor(world.z / TILE_SIZE - def.footprint.h / 2);
    const status = this.game.placementStatus(this.localPlayerId, this.placeDefId, tx, tz);
    return { tileX: tx, tileZ: tz, ok: status.ok, reason: status.reason };
  }

  placeAtScreen(clientX: number, clientY: number): void {
    if (!this.game || !this.placeDefId) return;
    const site = this.placementAtScreen(clientX, clientY);
    if (!site) return;
    if (!site.ok) {
      this.notify(site.reason, 'warning');
      this.audio.play('denied');
      return;
    }
    this.game.enqueueCommand({
      type: 'placeBuilding',
      team: this.localPlayerId,
      defId: this.placeDefId,
      tileX: site.tileX,
      tileZ: site.tileZ,
    });
    this.audio.play('build');
    this.notify(`${BUILDINGS[this.placeDefId].name} queued for construction.`, 'success');
    this.mode = 'none';
    this.placeDefId = null;
  }

  /* ------------------------------------------------------------------ */
  /* Groups, camera, saves                                               */
  /* ------------------------------------------------------------------ */

  assignGroup(index: number): void {
    const ids = this.ownSelected().map((e) => e.id);
    if (ids.length === 0) {
      this.notify('Select friendly units before assigning a control group.', 'warning');
      return;
    }
    this.groups.set(index, ids);
    this.notify(`Control group ${index} assigned (${ids.length}).`, 'info');
  }

  recallGroup(index: number): void {
    const ids = this.groups.get(index);
    if (!ids || ids.length === 0) return;
    const alive = ids.filter((id) => this.game?.getEntity(id));
    if (alive.length === 0) {
      this.groups.delete(index);
      return;
    }
    this.setSelection(alive);
    this.centerOnSelection();
  }

  centerOnSelection(): void {
    if (!this.game) return;
    const entities = this.ownSelected();
    if (entities.length === 0) return;
    let x = 0;
    let z = 0;
    for (const e of entities) {
      x += e.x;
      z += e.z;
    }
    this.renderer.camera.centerOn(x / entities.length, z / entities.length);
  }

  centerOnBase(): void {
    if (!this.game) return;
    const hq = this.game.state.entities.find(
      (e) => e.owner === this.localPlayerId && BUILDINGS[e.defId]?.commandPost,
    );
    if (hq) this.renderer.camera.centerOn(hq.x, hq.z);
  }

  /**
   * Opening frame: centre the whole base footprint in the space above the
   * command deck, so outlying facilities such as the airfield stay in view.
   */
  private frameBattleCamera(): void {
    const frame = this.hudScreenFrame();
    this.renderer.camera.setScreenLift(frame.lift, frame.horizontal);
    if (!this.game) return;
    const structures = this.game.state.entities.filter(
      (e) => e.owner === this.localPlayerId && e.hp > 0 && BUILDINGS[e.defId],
    );
    if (structures.length === 0) {
      this.centerOnBase();
      return;
    }
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const e of structures) {
      const f = BUILDINGS[e.defId].footprint;
      minX = Math.min(minX, e.x - (f.w * TILE_SIZE) / 2);
      maxX = Math.max(maxX, e.x + (f.w * TILE_SIZE) / 2);
      minZ = Math.min(minZ, e.z - (f.h * TILE_SIZE) / 2);
      maxZ = Math.max(maxZ, e.z + (f.h * TILE_SIZE) / 2);
    }
    this.renderer.camera.centerOn((minX + maxX) / 2, (minZ + maxZ) / 2);
  }

  cycleProductionTab(): void {
    this.hud.cycleTab();
  }

  saveToSlot(slot: number): void {
    if (!this.game) return;
    try {
      const data = this.game.toSave();
      localStorage.setItem(`${SAVE_PREFIX}${slot}`, JSON.stringify(data));
      this.notify(`Battle saved to slot ${slot}.`, 'success');
      this.audio.play('complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(`Save failed: ${message}`, 'critical');
    }
  }

  readSlot(slot: number): { data: SaveData; savedAt: string; name: string } | null {
    try {
      const raw = localStorage.getItem(`${SAVE_PREFIX}${slot}`);
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveData;
      if (!data || data.format !== 'iron-tide-save') return null;
      return { data, savedAt: data.savedAt ?? 'unknown', name: data.scenario?.meta?.name ?? 'Unknown scenario' };
    } catch {
      return null;
    }
  }

  loadFromSlot(slot: number): void {
    const record = this.readSlot(slot);
    if (!record) {
      this.notify(`Slot ${slot} is empty or unreadable.`, 'warning');
      return;
    }
    try {
      const game = Game.fromSave(record.data, { localPlayerId: record.data.localPlayerId ?? 0, enableAI: true });
      this.game = game;
      document.getElementById('menu-screen')?.classList.add('hidden');
      this.setLoading(false);
      this.renderer.settings.showFog = this.settings.fogVisual && game.state.scenario.settings.fog;
      this.renderer.setGame(game);
      this.screen = 'battle';
      this.paused = false;
      this.speed = 1;
      this.selected = [];
      this.groups.clear();
      this.mode = 'none';
      this.accumulator = 0;
      this.victoryShown = 'none';
      this.lastEventSeq = game.state.eventSeq;
      this.hud.mount(game);
      this.hud.seedLog(game);
      this.centerOnBase();
      this.audio.play('complete');
      this.notify(`Loaded ${record.name} from slot ${slot}.`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(`Load failed: ${message}`, 'critical');
      this.audio.play('denied');
    }
  }

  private pauseForModal(): boolean {
    if (this.screen === 'battle' && !this.paused && this.game?.state.victory === 'playing') {
      this.paused = true;
      return true;
    }
    return false;
  }

  private resumeAfterModal(resumed: boolean): void {
    if (resumed && this.screen === 'battle') this.paused = false;
  }

  openSaveMenu(loadMode = false): void {
    const resume = this.pauseForModal();
    const rows = SAVE_SLOTS.map((slot) => {
      const record = this.readSlot(slot);
      const meta = record
        ? `<small>${escapeHtml(record.name)} · ${escapeHtml(new Date(record.savedAt).toLocaleString())}</small>`
        : '<small>Empty slot</small>';
      return `<div class="slot-row"><div><b>SLOT ${slot}</b>${meta}</div><button class="btn btn-ghost" data-slot="${slot}">${record ? (loadMode ? 'Load' : 'Overwrite') : 'Empty'}</button></div>`;
    }).join('');
    openModal({
      title: loadMode ? 'Load battle' : 'Save battle',
      body: `<div class="save-slots">${rows}</div><p class="modal-note">Saves are stored in this browser with versioned state and scenario data. A failed load leaves the current battle untouched.</p>`,
      actions: [{ label: 'Close' }],
      onClose: () => this.resumeAfterModal(resume),
      onMount: (root) => {
        root.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const slot = Number(btn.dataset.slot);
            if (loadMode) {
              this.loadFromSlot(slot);
              if (this.game) closeModal();
            } else {
              this.saveToSlot(slot);
              closeModal();
            }
          });
        });
      },
    });
  }

  openLoadMenu(): void {
    this.openSaveMenu(true);
  }

  openBriefing(): void {
    const resume = this.pauseForModal();
    openModal({
      title: 'Briefing & controls',
      body: `
        <div class="briefing-grid">
          <div>
            <h4>MISSION</h4>
            <p>Establish the beachhead on Kestrel Island, grow an economy, and destroy the 11th Expeditionary Corps Command Post before it overruns you. Capture the neutral signals relays to fund advanced production.</p>
            <h4>COMBINED ARMS</h4>
            <p>Ground forces decide the ridge. Strike fighters strike hard but must rearm at the airfield and respect SAM coverage. The corvette controls the bay and bombards the coast. Ports and airfields are physical, capturable assets.</p>
          </div>
          <div>
            <h4>DESKTOP</h4>
            <div class="controls-grid">
              <div><span>Select / box select</span><kbd>LMB drag</kbd></div>
              <div><span>Move / attack / rally</span><kbd>RMB</kbd></div>
              <div><span>Add to selection</span><kbd>Shift</kbd></div>
              <div><span>Attack-move</span><kbd>A</kbd></div>
              <div><span>Stop / hold</span><kbd>S / H</kbd></div>
              <div><span>Capture relay</span><kbd>C</kbd></div>
              <div><span>Control groups</span><kbd>Ctrl+1..9</kbd></div>
              <div><span>Pan / zoom</span><kbd>Arrows / edge · wheel</kbd></div>
              <div><span>Pause / speed</span><kbd>P / +/-</kbd></div>
              <div><span>Debug overlay</span><kbd>F3</kbd></div>
            </div>
            <h4>TOUCH & GAMEPAD</h4>
            <p>Touch uses tap to select and order, drag for box selection, and dedicated BOX / ATTACK controls. Gamepad uses the left stick to pan, right stick to move the cursor, A to confirm, X to attack-move, Y to stop and Start to pause.</p>
          </div>
        </div>
        <p class="modal-note">The simulation is fixed-step (20 Hz) and deterministic for identical scenarios, seeds and command sequences.</p>`,
      actions: [{ label: 'Understood', primary: true }],
      onClose: () => this.resumeAfterModal(resume),
    });
  }

  openValidation(errors: { message: string; x?: number; z?: number }[]): void {
    openModal({
      title: 'Scenario validation failed',
      body: `<p>This scenario cannot be deployed until these errors are resolved:</p><ul class="validation-modal">${errors
        .map((e) => `<li>${escapeHtml(e.message)}</li>`)
        .join('')}</ul>`,
      actions: [{ label: 'Close', primary: true }],
    });
  }

  openSettings(): void {
    const s = this.settings;
    const resume = this.pauseForModal();
    openModal({
      title: 'Settings',
      body: `
        <div class="settings-grid">
          <div class="setting-row"><div><label>Effects volume</label><small>Weapons, impacts and alerts</small></div><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-set="sfx"></div>
          <div class="setting-row"><div><label>Ambience volume</label><small>Sea, wind and low drone</small></div><input type="range" min="0" max="1" step="0.05" value="${s.ambient}" data-set="ambient"></div>
          <div class="setting-row"><div><label>Visual effects</label><small>Particles, smoke and tracers</small></div><button class="switch ${s.effects ? 'on' : ''}" data-toggle="effects"></button></div>
          <div class="setting-row"><div><label>Screen shake</label><small>Explosion camera movement</small></div><button class="switch ${s.shake ? 'on' : ''}" data-toggle="shake"></button></div>
          <div class="setting-row"><div><label>Fog of war</label><small>Visual fog; gameplay detection is unchanged</small></div><button class="switch ${s.fogVisual ? 'on' : ''}" data-toggle="fogVisual"></button></div>
          <div class="setting-row"><div><label>Edge panning</label><small>Move camera at screen edges</small></div><button class="switch ${s.edgePan ? 'on' : ''}" data-toggle="edgePan"></button></div>
        </div>`,
      actions: [{ label: 'Done', primary: true }],
      onClose: () => this.resumeAfterModal(resume),
      onMount: (root) => {
        root.querySelectorAll<HTMLInputElement>('[data-set]').forEach((input) => {
          input.addEventListener('input', () => {
            const key = input.dataset.set as 'sfx' | 'ambient';
            this.settings[key] = Number(input.value);
            this.saveSettings();
          });
        });
        root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const key = btn.dataset.toggle as 'effects' | 'shake' | 'fogVisual' | 'edgePan';
            this.settings[key] = !this.settings[key];
            btn.classList.toggle('on', this.settings[key]);
            this.saveSettings();
            if (key === 'fogVisual' && this.game) {
              this.renderer.settings.showFog = this.settings.fogVisual && this.game.state.scenario.settings.fog;
            }
          });
        });
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Editor                                                              */
  /* ------------------------------------------------------------------ */

  openEditor(scenario?: Scenario): void {
    this.audio.init();
    document.getElementById('menu-screen')?.classList.add('hidden');
    this.hud.unmount();
    this.screen = 'editor';
    this.game = null;
    this.overlay.clear();
    this.renderer.setGame(null);
    this.renderer.camera.setScreenLift(0);
    this.renderer.settings.showFog = false;
    this.editor.open(scenario ?? createIslandAssault());
  }

  closeEditor(): void {
    this.editor.close();
    this.renderer.settings.showFog = this.settings.fogVisual;
    this.showMenu();
  }

  launchEditorScenario(scenario: Scenario): void {
    this.editor.close();
    void this.startBattle(scenario);
  }

  /* ------------------------------------------------------------------ */
  /* UI plumbing                                                         */
  /* ------------------------------------------------------------------ */

  toast(text: string, level: 'info' | 'warning' | 'critical' | 'success' = 'info'): void {
    this.notify(text, level);
    if (this.screen === 'battle') this.hud.log(text, level, this.game?.state.tick ?? 0);
  }

  /**
   * Battlefield notice: one plain line at the top-left of the view, typed in
   * character by character behind a colour-coded rule. No card, no icon and no
   * level tag, so the report reads over the map instead of covering it. The
   * finished sentence is mirrored into a visually hidden node for screen
   * readers, because the typing animation itself is decorative.
   */
  notify(text: string, level: 'info' | 'warning' | 'critical' | 'success' = 'info'): void {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${level} typing`;
    el.innerHTML = `<span class="t-text" aria-hidden="true"></span><span class="t-caret" aria-hidden="true"></span><span class="sr-only"></span>`;
    const span = el.querySelector<HTMLElement>('.t-text');
    const a11y = el.querySelector<HTMLElement>('.sr-only');
    if (a11y) a11y.textContent = text;
    root.appendChild(el);
    while (root.children.length > 4) root.firstElementChild?.remove();
    // Fast enough to stay ahead of reading, slow enough to look like a feed.
    const step = Math.max(8, Math.min(22, 420 / Math.max(1, text.length)));
    let typed = 0;
    const typeTimer = window.setInterval(() => {
      typed++;
      if (span) span.textContent = text.slice(0, typed);
      if (typed < text.length) return;
      window.clearInterval(typeTimer);
      el.classList.remove('typing');
    }, step);
    window.setTimeout(() => {
      window.clearInterval(typeTimer);
      el.style.opacity = '0';
      el.style.transition = 'opacity 250ms';
      window.setTimeout(() => el.remove(), 300);
    }, level === 'critical' ? 5600 : 4000);
  }

  private installResize(): void {
    window.addEventListener('resize', () => this.resize());
    const stage = document.getElementById('stage');
    if (stage && 'ResizeObserver' in window) {
      new ResizeObserver(() => this.resize()).observe(stage);
    }
  }

  /**
   * Offset a framed focus from the viewport centre to the centre of the clear
   * battlefield: up from the bottom command area, left from the production
   * sidebar or mobile category rail.
   */
  private hudScreenFrame(): { lift: number; horizontal: number } {
    const hud = document.querySelector<HTMLElement>('.hud');
    const bottom = document.querySelector<HTMLElement>('.hud-bottom');
    if (!hud || !bottom) return { lift: 0, horizontal: 0 };
    const mobile = hud.classList.contains('layout-mobile');
    const top = hud.querySelector<HTMLElement>('.mobile-topbar');
    const rail = hud.querySelector<HTMLElement>('.hud-rail');
    const bottomHeight = bottom.getBoundingClientRect().height;
    const height = top ? top.getBoundingClientRect().height : 0;
    const column = mobile
      ? hud.querySelector<HTMLElement>('.prod-tabs')
      : hud.querySelector<HTMLElement>('.production-sidebar');
    const leftInset = rail ? rail.getBoundingClientRect().width : 0;
    const rightInset = column
      ? Math.max(0, window.innerWidth - column.getBoundingClientRect().left)
      : 0;
    return {
      lift: Math.max(0, (bottomHeight - height) / 2),
      // Positive shifts the framed point left (sidebar), negative right (rail).
      horizontal: (rightInset - leftInset) / 2,
    };
  }

  resize(): void {
    this.renderer.resize();
    const camera = this.renderer.camera;
    if (this.screen === 'battle') {
      const layoutChanged = this.hud.refreshLayout();
      if (layoutChanged) {
        this.frameBattleCamera();
      } else {
        const frame = this.hudScreenFrame();
        if (
          Math.abs(frame.lift - camera.screenLift) > 0.5 ||
          Math.abs(frame.horizontal - camera.screenLiftX) > 0.5
        ) {
          // Keep the framed ground point in the clear area without resetting the
          // player's current camera position.
          camera.panScreen(frame.horizontal - camera.screenLiftX, frame.lift - camera.screenLift);
          camera.setScreenLift(frame.lift, frame.horizontal);
        }
      }
    }
    this.overlay.resize();
    const maxX = this.overlay.width;
    const maxY = this.overlay.height;
    if (this.padCursor.x === 0 && this.padCursor.y === 0) {
      this.padCursor.x = maxX / 2;
      this.padCursor.y = maxY / 2;
    }
    void maxY;
  }
}
