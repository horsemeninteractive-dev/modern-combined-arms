import type { App } from '../app';
import {
  checkPlacement,
  cloneScenario,
  parseScenario,
  reachableFrom,
  scenarioToJson,
  validateScenario,
  type Scenario,
  type ValidationIssue,
} from '../sim/scenario';
import { createEmptyScenario, createIslandAssault } from '../data/scenarios';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { FACTIONS } from '../data/factions';
import {
  TERRAIN,
  TERRAIN_ORDER,
  Terrain,
  canStandOn,
  inBounds,
  tileIndex,
  type TerrainId,
} from '../sim/terrain';
import { TILE_SIZE } from '../sim/constants';
import { pickTerrain } from '../render/terrainSurface';
import { icon } from './icons';
import { openModal, closeModal, escapeHtml } from './modal';
import { drawEditorOverlay, terrainNameAt, unitPaletteName } from './editorRender';
import {
  dismissEditorSheet,
  editorSheetHeight,
  editorSheetOffset,
  resolveEditorLayout,
} from './editorLayout';

type EditorTab = 'terrain' | 'forces' | 'mission';
type EditorTool = 'paint' | 'raise' | 'lower' | 'ore' | 'erase' | 'start' | 'structure' | 'unit';

const AUTOSAVE_KEY = 'iron-tide.editor.autosave.v1';

export class Editor {
  readonly app: App;
  readonly ctx: CanvasRenderingContext2D;
  scenario: Scenario;
  active = false;
  tab: EditorTab = 'terrain';
  tool: EditorTool = 'paint';
  terrain: TerrainId = Terrain.Grass;
  brush = 1;
  owner = 0;
  structureDef = 'barracks';
  unitDef = 'rifle';
  startPlayerId = 0;
  reachMode: 'off' | 'ground' | 'naval' = 'off';
  panMode = false;
  reach: Uint8Array | null = null;
  issues: ValidationIssue[] = [];
  hover: { x: number; z: number } | null = null;
  hoverScreen = { x: 0, y: 0 };
  overlayWidth = 1;
  overlayHeight = 1;

  private root: HTMLElement | null = null;
  private pan: { x: number; y: number } | null = null;
  private painting = false;
  private lastPaint = '';
  private terrainDirty = false;
  private lastTerrainRefresh = 0;
  private autosaveTimer = 0;
  private touchLayout = false;
  private sheetDrag: { startY: number; dy: number; target: HTMLElement } | null = null;
  private canvas: HTMLCanvasElement;

  constructor(app: App) {
    this.app = app;
    this.scenario = createEmptyScenario(64, 48);
    this.canvas = document.getElementById('gl') as HTMLCanvasElement;
    const overlay = document.getElementById('overlay') as HTMLCanvasElement;
    const ctx = overlay.getContext('2d');
    if (!ctx) throw new Error('Editor overlay context unavailable.');
    this.ctx = ctx;
  }

  /* ------------------------------------------------------------------ */
  /* Open / close                                                        */
  /* ------------------------------------------------------------------ */

  open(scenario: Scenario): void {
    this.active = true;
    this.load(scenario, false);
    const root = document.getElementById('hud-root');
    if (!root) return;
    this.root = root;
    root.innerHTML = this.markup();
    this.bindChrome();
    this.bindSheetDrag();
    this.renderTools();
    this.renderInspector();
    this.refreshValidation();
    this.attachCanvas();
    this.touchLayout = this.currentTouchLayout();
    this.root.querySelector('.editor-screen')?.classList.toggle('touch', this.touchLayout);
    this.syncSheetHeight();
    this.setHint();
    window.removeEventListener('resize', this.onResize);
    window.addEventListener('resize', this.onResize);
    this.app.renderer.settings.showFog = false;
    this.app.renderer.setScenario(this.scenario);
    this.app.renderer.camera.setZoom(Math.max(58, this.scenario.width * 0.5));
    this.app.renderer.camera.centerOn((this.scenario.width * TILE_SIZE) / 2, (this.scenario.height * TILE_SIZE) / 2);
    this.app.notify('Scenario Forge ready. Paint terrain, place forces, validate, then deploy.', 'info');
  }

  close(): void {
    this.active = false;
    this.sheetDrag = null;
    window.removeEventListener('resize', this.onResize);
    this.detachCanvas();
    if (this.root) this.root.innerHTML = '';
    this.root = null;
    this.ctx.clearRect(0, 0, this.overlayWidth, this.overlayHeight);
  }

  private load(scenario: Scenario, refresh = true): void {
    this.scenario = scenario;
    this.issues = [];
    this.reach = null;
    this.hover = null;
    this.terrainDirty = false;
    this.lastPaint = '';
    if (refresh && this.active) {
      this.app.renderer.settings.showFog = false;
      this.app.renderer.setScenario(this.scenario);
      this.app.renderer.camera.setZoom(Math.max(58, this.scenario.width * 0.5));
      this.app.renderer.camera.centerOn((this.scenario.width * TILE_SIZE) / 2, (this.scenario.height * TILE_SIZE) / 2);
      this.renderInspector();
      this.refreshValidation();
    }
    const title = this.root?.querySelector('#ed-name');
    if (title) title.textContent = this.scenario.meta.name;
    const sub = this.root?.querySelector('#ed-sub');
    if (sub) sub.textContent = `SCENARIO FORGE · ${this.scenario.width}×${this.scenario.height} · ${this.scenario.structures.length} STRUCTURES · ${this.scenario.units.length} UNITS`;
  }

  /* ------------------------------------------------------------------ */
  /* Markup                                                              */
  /* ------------------------------------------------------------------ */

  private markup(): string {
    return `<div class="editor-screen">
      <header class="editor-topbar">
        <div class="top-ident"><img class="brand-mark" src="/insignia.svg" alt="MCA" width="30" height="30" /><div><h2>SCENARIO FORGE</h2><p>MCA AUTHORING</p></div></div>
        <div class="editor-title"><b id="ed-name">${escapeHtml(this.scenario.meta.name)}</b><span id="ed-sub">SCENARIO FORGE · ${this.scenario.width}×${this.scenario.height}</span></div>
        <div class="actions">
          <button class="btn btn-ghost editor-tools-btn" data-ed="tools" aria-label="Authoring tools" aria-expanded="false">${icon('build')} <span class="btn-label">TOOLS</span></button>
          <button class="btn btn-ghost" data-ed="menu" aria-label="Scenario menu">${icon('menu')} <span class="btn-label">MENU</span></button>
          <button class="btn btn-ghost" data-ed="new" aria-label="New scenario">${icon('box')} <span class="btn-label">NEW</span></button>
          <button class="btn btn-ghost" data-ed="open" aria-label="Open scenario">${icon('folder')} <span class="btn-label">OPEN</span></button>
          <button class="btn btn-ghost" data-ed="save" aria-label="Save scenario">${icon('save')} <span class="btn-label">SAVE</span></button>
          <button class="btn btn-ghost editor-inspect-btn" data-ed="inspector" aria-label="Scenario settings" aria-expanded="false">${icon('settings')} <span class="btn-label">INSPECT</span></button>
          <button class="btn btn-primary" data-ed="launch" aria-label="Deploy scenario">${icon('play')} <span class="btn-label">DEPLOY</span></button>
        </div>
      </header>
      <aside class="editor-tools" aria-label="Authoring tools">
        <div class="panel-head editor-tools-head"><span>AUTHORING TOOLS</span><button class="editor-panel-close" data-ed="tools-close" aria-label="Close tools">${icon('close')}</button></div>
        <div class="editor-tab-row">
          <button class="editor-tab active" data-tab="terrain">TERRAIN</button>
          <button class="editor-tab" data-tab="forces">FORCES</button>
          <button class="editor-tab" data-tab="mission">MISSION</button>
        </div>
        <div class="tool-scroll" id="ed-tools"></div>
      </aside>
      <aside class="editor-side" aria-label="Scenario settings">
        <div class="editor-sheet-grab" data-sheet-grab aria-label="Drag settings sheet"></div>
        <div class="panel-head"><span>SCENARIO SETTINGS</span><span class="editor-sheet-meta"><span class="mono" id="ed-dims">${this.scenario.width}×${this.scenario.height}</span><button class="editor-sheet-close" data-ed="inspector-close" aria-label="Close scenario settings">${icon('close')}</button></span></div>
        <div class="editor-inspector" id="ed-inspector"></div>
      </aside>
      <div class="editor-backdrop" data-ed="backdrop"></div>
      <div class="editor-hint" id="ed-hint">Left click paint · Right/middle drag pan · Wheel zoom</div>
      <div class="editor-toolbar-overlay">
        <button class="btn btn-ghost" data-ed="pan" aria-label="Pan map" aria-pressed="false">${icon('move')} <span class="btn-label">PAN</span></button>
        <button class="btn btn-ghost" data-ed="reach" aria-label="Reachability preview">${icon('terrain')} <span class="btn-label">REACH</span></button>
        <button class="btn btn-ghost" data-ed="focus" aria-label="Battle view">${icon('target')} <span class="btn-label">BATTLE VIEW</span></button>
        <button class="btn btn-ghost editor-zoom-btn" data-ed="zoomout" aria-label="Zoom out">−</button>
        <button class="btn btn-ghost editor-zoom-btn" data-ed="zoomin" aria-label="Zoom in">+</button>
      </div>
      <div class="editor-status" id="ed-status">Ready</div>
    </div>`;
  }

  private bindChrome(): void {
    if (!this.root) return;
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = (btn.dataset.tab as EditorTab) ?? 'terrain';
        this.root?.querySelectorAll('.editor-tab').forEach((b) => b.classList.toggle('active', b === btn));
        this.renderTools();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-ed]').forEach((btn) => {
      btn.addEventListener('click', () => this.action(btn.dataset.ed ?? ''));
    });
  }

  private action(action: string): void {
    switch (action) {
      case 'menu':
        this.app.closeEditor();
        break;
      case 'new':
        this.showNewDialog();
        break;
      case 'open':
        this.showOpenDialog();
        break;
      case 'save':
        this.saveJson();
        break;
      case 'launch':
        this.launch();
        break;
      case 'reach':
        this.reachMode = this.reachMode === 'off' ? 'ground' : this.reachMode === 'ground' ? 'naval' : 'off';
        this.reach = null;
        this.refreshValidation();
        this.app.notify(`Reachability preview: ${this.reachMode.toUpperCase()}.`, 'info');
        break;
      case 'focus':
        this.app.renderer.camera.setZoom(52);
        this.app.renderer.camera.centerOn((this.scenario.width * TILE_SIZE) / 2, (this.scenario.height * TILE_SIZE) / 2);
        break;
      case 'inspector':
        this.toggleInspector();
        break;
      case 'inspector-close':
        this.closeInspector();
        break;
      case 'tools':
        this.toggleTools();
        break;
      case 'tools-close':
        this.closeTools();
        break;
      case 'backdrop':
        this.closePanels();
        break;
      case 'pan':
        this.panMode = !this.panMode;
        this.syncPanButton();
        this.setHint();
        break;
      case 'zoomout':
        this.app.renderer.camera.zoomBy(1.12);
        break;
      case 'zoomin':
        this.app.renderer.camera.zoomBy(0.89);
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Touch drawers and bottom sheet                                      */
  /* ------------------------------------------------------------------ */

  private currentTouchLayout(): boolean {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    return resolveEditorLayout(window.innerWidth, window.innerHeight, coarse) === 'touch';
  }

  private onResize = (): void => {
    if (!this.active) return;
    const touch = this.currentTouchLayout();
    if (touch !== this.touchLayout) {
      this.touchLayout = touch;
      this.root?.querySelector('.editor-screen')?.classList.toggle('touch', touch);
      if (!touch) this.closePanels();
    }
    this.syncSheetHeight();
    this.setHint();
  };

  private syncSheetHeight(): void {
    const screen = this.root?.querySelector<HTMLElement>('.editor-screen');
    screen?.style.setProperty('--ed-sheet-h', `${editorSheetHeight(window.innerHeight)}px`);
  }

  private updateBackdrop(): void {
    const open =
      this.root?.querySelector('.editor-tools')?.classList.contains('open') ||
      this.root?.querySelector('.editor-side')?.classList.contains('open') ||
      false;
    this.root?.querySelector('.editor-backdrop')?.classList.toggle('open', open);
  }

  private openTools(): void {
    this.closeInspector();
    this.root?.querySelector('.editor-tools')?.classList.add('open');
    this.root?.querySelector('[data-ed="tools"]')?.setAttribute('aria-expanded', 'true');
    this.updateBackdrop();
  }

  private closeTools(): void {
    this.root?.querySelector('.editor-tools')?.classList.remove('open');
    this.root?.querySelector('[data-ed="tools"]')?.setAttribute('aria-expanded', 'false');
    this.updateBackdrop();
  }

  private toggleTools(): void {
    if (this.root?.querySelector('.editor-tools')?.classList.contains('open')) this.closeTools();
    else this.openTools();
  }

  private openInspector(): void {
    this.closeTools();
    this.root?.querySelector('.editor-side')?.classList.add('open');
    this.root?.querySelector('[data-ed="inspector"]')?.setAttribute('aria-expanded', 'true');
    this.updateBackdrop();
  }

  private closeInspector(keepTransform = false): void {
    const side = this.root?.querySelector<HTMLElement>('.editor-side');
    side?.classList.remove('open');
    if (side && !keepTransform) side.style.transform = '';
    this.root?.querySelector('[data-ed="inspector"]')?.setAttribute('aria-expanded', 'false');
    this.updateBackdrop();
  }

  private toggleInspector(): void {
    if (this.root?.querySelector('.editor-side')?.classList.contains('open')) this.closeInspector();
    else this.openInspector();
  }

  private closePanels(): void {
    this.closeTools();
    this.closeInspector();
  }

  private syncPanButton(): void {
    const button = this.root?.querySelector('[data-ed="pan"]');
    button?.classList.toggle('active', this.panMode);
    button?.setAttribute('aria-pressed', String(this.panMode));
  }

  private bindSheetDrag(): void {
    const grab = this.root?.querySelector<HTMLElement>('[data-sheet-grab]');
    if (!grab) return;
    grab.addEventListener('pointerdown', (event) => {
      if (!this.touchLayout) return;
      const target = this.root?.querySelector<HTMLElement>('.editor-side');
      if (!target) return;
      this.sheetDrag = { startY: event.clientY, dy: 0, target };
      target.classList.add('dragging');
      try {
        grab.setPointerCapture(event.pointerId);
      } catch {
        /* Synthetic pointers cannot be captured. */
      }
      event.preventDefault();
    });
    grab.addEventListener('pointermove', (event) => {
      if (!this.sheetDrag) return;
      const dy = editorSheetOffset(event.clientY - this.sheetDrag.startY, this.sheetDrag.target.offsetHeight);
      this.sheetDrag.dy = dy;
      this.sheetDrag.target.style.transform = `translateY(${dy}px)`;
    });
    const end = (): void => {
      const drag = this.sheetDrag;
      if (!drag) return;
      this.sheetDrag = null;
      drag.target.classList.remove('dragging');
      if (dismissEditorSheet(drag.dy, drag.target.offsetHeight)) {
        drag.target.style.transform = 'translateY(100%)';
        this.closeInspector(true);
        window.setTimeout(() => {
          drag.target.style.transform = '';
        }, 180);
      } else {
        drag.target.style.transform = '';
      }
    };
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
  }

  /* ------------------------------------------------------------------ */
  /* Tools                                                               */
  /* ------------------------------------------------------------------ */

  private renderTools(): void {
    if (!this.root) return;
    const el = this.root.querySelector('#ed-tools');
    if (!el) return;
    if (this.tab === 'terrain') el.innerHTML = this.terrainTools();
    else if (this.tab === 'forces') el.innerHTML = this.forceTools();
    else el.innerHTML = this.missionTools();
    this.bindTools();
  }

  private terrainTools(): string {
    const swatches = TERRAIN_ORDER.map((t) => {
      const def = TERRAIN[t];
      const color = `rgb(${def.color.map((c) => Math.round(c * 255)).join(',')})`;
      return `<button class="terrain-swatch ${this.tool === 'paint' && this.terrain === t ? 'active' : ''}" data-terrain="${t}" style="background:${color}">${def.name.toUpperCase()}</button>`;
    }).join('');
    return `
      <div class="tool-section"><h4>BRUSH TOOL</h4>
        <div class="tool-grid">
          ${this.toolBtn('paint', 'terrain', 'PAINT')}
          ${this.toolBtn('raise', 'elevation', 'RAISE')}
          ${this.toolBtn('lower', 'elevation', 'LOWER')}
          ${this.toolBtn('ore', 'materials', 'ORE')}
          ${this.toolBtn('erase', 'erase', 'ERASE')}
          ${this.toolBtn('start', 'target', 'START')}
        </div>
      </div>
      <div class="tool-section"><h4>TERRAIN</h4><div class="terrain-grid">${swatches}</div></div>
      <div class="tool-section"><h4>BRUSH SIZE</h4>
        <div class="brush-row"><input type="range" min="0" max="4" step="1" value="${this.brush}" id="ed-brush"><span class="mono">${this.brush * 2 + 1}</span></div>
        <p class="tool-note">Paint water to author coastlines and navigable channels. Raise or lower elevation for ridges and plateaus.</p>
      </div>
      <div class="tool-section"><h4>PREVIEW</h4>
        <div class="tool-grid">
          <button class="tool-btn ${this.reachMode === 'off' ? 'active' : ''}" data-reach="off">OFF</button>
          <button class="tool-btn ${this.reachMode === 'ground' ? 'active' : ''}" data-reach="ground">${icon('terrain')}GROUND</button>
          <button class="tool-btn ${this.reachMode === 'naval' ? 'active' : ''}" data-reach="naval">${icon('water')}NAVAL</button>
        </div>
      </div>`;
  }

  private forceTools(): string {
    const owners = this.scenario.players.map((p) => `<option value="${p.id}" ${this.owner === p.id ? 'selected' : ''}>${escapeHtml(p.name)}${p.isAI ? ' (AI)' : ''}</option>`).join('');
    const buildings = Object.values(BUILDINGS).map((b) => {
      const selected = this.tool === 'structure' && this.structureDef === b.id;
      return `<button class="tool-btn ${selected ? 'active' : ''}" data-building="${b.id}" title="${escapeHtml(b.description)}">${icon(b.icon)}${escapeHtml(b.shortName)}</button>`;
    }).join('');
    const domainOrder = ['land', 'air', 'naval'] as const;
    const units = domainOrder.map((domain) => {
      const cards = Object.values(UNITS)
        .filter((u) => u.domain === domain)
        .map((u) => {
          const selected = this.tool === 'unit' && this.unitDef === u.id;
          return `<button class="tool-btn ${selected ? 'active' : ''}" data-unit="${u.id}" title="${escapeHtml(u.description)}">${icon(u.icon)}${escapeHtml(u.shortName)}</button>`;
        })
        .join('');
      return `<h4>${domain.toUpperCase()}</h4><div class="tool-grid">${cards}</div>`;
    }).join('');
    return `
      <div class="tool-section"><h4>OWNER</h4>
        <div class="form-row"><span>Place for</span><select id="ed-owner">${owners}<option value="-1" ${this.owner === -1 ? 'selected' : ''}>Neutral</option></select></div>
      </div>
      <div class="tool-section"><h4>STRUCTURES</h4><div class="tool-grid">${buildings}</div></div>
      <div class="tool-section">${units}</div>
      <div class="tool-section">${this.toolBtn('erase', 'erase', 'REMOVE')}</div>
      <p class="tool-note">Click to place the selected asset. Left click with REMOVE deletes a unit or structure under the cursor. Shipyards require a buildable coast with navigable water alongside.</p>`;
  }

  private missionTools(): string {
    const startButtons = this.scenario.players
      .map(
        (p) => `<button class="tool-btn ${this.tool === 'start' && this.startPlayerId === p.id ? 'active' : ''}" data-start="${p.id}">${icon(p.isAI ? 'target' : 'commander')}${escapeHtml(p.name)}<small>(${p.startX}, ${p.startZ})</small></button>`,
      )
      .join('');
    return `
      <div class="tool-section"><h4>PLAYER STARTS</h4>
        <div class="tool-grid">${startButtons}</div>
        <p class="tool-note">Select a start, then click the map to move that deployment marker. Each player needs a valid Command Post.</p>
      </div>
      <div class="tool-section"><h4>OBJECTIVES</h4>
        <textarea id="ed-objectives" rows="4">${escapeHtml(this.scenario.objectives.join('\n'))}</textarea>
        <p class="tool-note">One objective per line. These appear in battle and the briefing.</p>
      </div>
      <div class="tool-section"><h4>QUICK CHECK</h4>
        <div class="tool-grid">
          <button class="tool-btn" data-quick="hq">${icon('command')}ADD HQs</button>
          <button class="tool-btn" data-quick="relay">${icon('relay')}ADD RELAYS</button>
          <button class="tool-btn" data-quick="force">${icon('squad')}ADD STARTERS</button>
        </div>
        <p class="tool-note">Quick checks add a valid command post, two neutral relays, or a small starting force for each player so a new map can be tested immediately.</p>
      </div>`;
  }

  private toolBtn(tool: EditorTool, iconName: string, label: string): string {
    return `<button class="tool-btn ${this.tool === tool ? 'active' : ''}" data-tool="${tool}">${icon(iconName)}${label}</button>`;
  }

  private bindTools(): void {
    if (!this.root) return;
    this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tool = btn.dataset.tool as EditorTool;
        this.panMode = false;
        this.syncPanButton();
        this.renderTools();
        this.closeTools();
        this.setHint();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-terrain]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.terrain = Number(btn.dataset.terrain) as TerrainId;
        this.tool = 'paint';
        this.panMode = false;
        this.syncPanButton();
        this.renderTools();
        this.closeTools();
        this.setHint();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-building]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.structureDef = btn.dataset.building ?? 'barracks';
        this.tool = 'structure';
        this.panMode = false;
        this.syncPanButton();
        this.renderTools();
        this.closeTools();
        this.setHint();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-unit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.unitDef = btn.dataset.unit ?? 'rifle';
        this.tool = 'unit';
        this.panMode = false;
        this.syncPanButton();
        this.renderTools();
        this.closeTools();
        this.setHint();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-reach]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.reachMode = (btn.dataset.reach as typeof this.reachMode) ?? 'off';
        this.reach = null;
        this.renderTools();
        this.refreshValidation();
      });
    });
    const owner = this.root.querySelector<HTMLSelectElement>('#ed-owner');
    owner?.addEventListener('change', () => {
      this.owner = Number(owner.value);
      if (this.owner === -1 && this.tool === 'unit') {
        this.tool = 'structure';
        this.renderTools();
      }
      this.setHint();
    });
    this.root.querySelectorAll<HTMLElement>('[data-start]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.startPlayerId = Number(btn.dataset.start);
        this.tool = 'start';
        this.panMode = false;
        this.syncPanButton();
        this.renderTools();
        this.closeTools();
        this.setHint();
      });
    });
    const brush = this.root.querySelector<HTMLInputElement>('#ed-brush');
    brush?.addEventListener('input', () => {
      this.brush = Number(brush.value);
      const label = brush.nextElementSibling;
      if (label) label.textContent = String(this.brush * 2 + 1);
    });
    const objectives = this.root.querySelector<HTMLTextAreaElement>('#ed-objectives');
    objectives?.addEventListener('change', () => {
      this.scenario.objectives = objectives.value.split('\n').map((s) => s.trim()).filter(Boolean);
      this.app.notify('Objectives updated.', 'info');
      this.scheduleAutosave();
    });
    this.root.querySelectorAll<HTMLElement>('[data-quick]').forEach((btn) => {
      btn.addEventListener('click', () => this.quickAction(btn.dataset.quick ?? ''));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Inspector                                                           */
  /* ------------------------------------------------------------------ */

  private renderInspector(): void {
    if (!this.root) return;
    const el = this.root.querySelector('#ed-inspector');
    if (!el) return;
    const s = this.scenario;
    const players = s.players
      .map(
        (p) => `<div class="start-row"><span><i class="faction-dot" style="background:${FACTIONS[p.factionId]?.color ?? '#fff'}"></i>${escapeHtml(p.name)}${p.isAI ? ' (AI)' : ''}</span><b id="ed-start-${p.id}">${p.startX}, ${p.startZ}</b></div>`,
      )
      .join('');
    el.innerHTML = `
      <div class="form-grid">
        <label class="form-row"><span>Name</span><input id="ed-meta-name" value="${escapeHtml(s.meta.name)}"></label>
        <label class="form-row"><span>Author</span><input id="ed-meta-author" value="${escapeHtml(s.meta.author)}"></label>
        <label class="form-row"><span>Description</span><textarea id="ed-meta-desc" rows="3">${escapeHtml(s.meta.description)}</textarea></label>
        <label class="form-row"><span>Seed</span><input type="number" id="ed-seed" value="${s.settings.seed}"></label>
        <label class="form-row"><span>Start mats</span><input type="number" id="ed-mats" value="${s.settings.startingMats}"></label>
        <label class="form-row"><span>Start req</span><input type="number" id="ed-req" value="${s.settings.startingReq}"></label>
        <label class="form-row"><span>Victory</span><select id="ed-victory"><option value="destroyHQ" ${s.settings.victory === 'destroyHQ' ? 'selected' : ''}>Destroy HQ</option><option value="annihilation" ${s.settings.victory === 'annihilation' ? 'selected' : ''}>Annihilation</option></select></label>
        <label class="form-row"><span>Weather</span><select id="ed-weather">${['clear', 'overcast', 'rain'].map((w) => `<option value="${w}" ${s.settings.weather === w ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
        <label class="form-row"><span>Time of day</span><select id="ed-tod">${['dawn', 'day', 'dusk', 'night'].map((w) => `<option value="${w}" ${s.settings.timeOfDay === w ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
        <label class="form-row"><span>Fog</span><select id="ed-fog"><option value="1" ${s.settings.fog ? 'selected' : ''}>Enabled</option><option value="0" ${!s.settings.fog ? 'selected' : ''}>Disabled</option></select></label>
      </div>
      <div class="inspector-section"><h4>PLAYER STARTS</h4>${players || '<p class="tool-note">No players defined.</p>'}</div>
      <div class="inspector-section"><h4>MAP SUMMARY</h4><div id="ed-summary"></div></div>
      <div class="inspector-section"><h4>VALIDATION <span id="ed-issue-count"></span></h4><div class="validation-list" id="ed-validation"></div></div>`;
    this.bindInspector();
    this.renderSummary();
  }

  private bindInspector(): void {
    if (!this.root) return;
    const bind = (id: string, fn: (value: string) => void) => {
      const input = this.root?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`);
      input?.addEventListener('change', () => {
        fn(input.value);
        this.refreshValidation();
        this.scheduleAutosave();
      });
    };
    bind('ed-meta-name', (v) => {
      this.scenario.meta.name = v;
      const title = this.root?.querySelector('#ed-name');
      if (title) title.textContent = v;
    });
    bind('ed-meta-author', (v) => (this.scenario.meta.author = v));
    bind('ed-meta-desc', (v) => (this.scenario.meta.description = v));
    bind('ed-seed', (v) => (this.scenario.settings.seed = Math.max(0, Math.floor(Number(v) || 0))));
    bind('ed-mats', (v) => (this.scenario.settings.startingMats = Math.max(0, Math.floor(Number(v) || 0))));
    bind('ed-req', (v) => (this.scenario.settings.startingReq = Math.max(0, Math.floor(Number(v) || 0))));
    bind('ed-victory', (v) => (this.scenario.settings.victory = v as 'destroyHQ'));
    bind('ed-weather', (v) => {
      this.scenario.settings.weather = v as 'clear';
      this.refreshTerrain(true);
    });
    bind('ed-tod', (v) => {
      this.scenario.settings.timeOfDay = v as 'dusk';
      this.refreshTerrain(true);
    });
    bind('ed-fog', (v) => (this.scenario.settings.fog = v === '1'));
  }

  private renderSummary(): void {
    const el = this.root?.querySelector('#ed-summary');
    if (!el) return;
    let land = 0;
    let water = 0;
    let ore = 0;
    for (const tile of this.scenario.tiles) {
      if (tile.t === Terrain.DeepWater || tile.t === Terrain.ShallowWater) water++;
      else land++;
      if (tile.o > 0) ore++;
    }
    el.innerHTML = `<div class="summary-grid"><div><span>LAND</span><b>${land}</b></div><div><span>WATER</span><b>${water}</b></div><div><span>ORE</span><b>${ore}</b></div><div><span>OBJ</span><b>${this.scenario.objectives.length}</b></div></div>`;
  }

  refreshValidation(): void {
    if (!this.active) return;
    this.issues = validateScenario(this.scenario);
    const list = this.root?.querySelector('#ed-validation');
    const count = this.root?.querySelector('#ed-issue-count');
    const status = this.root?.querySelector('#ed-status');
    const errors = this.issues.filter((i) => i.severity === 'error').length;
    const warnings = this.issues.filter((i) => i.severity === 'warning').length;
    if (count) count.textContent = `${errors} ERR · ${warnings} WARN`;
    if (status) status.textContent = `${errors} errors · ${warnings} warnings · ${this.scenario.width}×${this.scenario.height} · ${this.scenario.tiles.length} tiles`;
    if (list) {
      list.innerHTML = this.issues.length === 0
        ? '<div class="issue info"><span class="sev">OK</span><p>Scenario is valid and ready to deploy.</p></div>'
        : this.issues
            .slice(0, 40)
            .map(
              (issue, i) => `<div class="issue ${issue.severity}" data-issue="${i}"><span class="sev">${issue.severity === 'error' ? 'ERR' : issue.severity === 'warning' ? 'WARN' : 'INFO'}</span><div><p>${escapeHtml(issue.message)}</p><div class="issue-meta">${issue.code}${issue.x !== undefined ? ` · ${issue.x}, ${issue.z}` : ''}</div></div></div>`,
            )
            .join('');
      list.querySelectorAll<HTMLElement>('[data-issue]').forEach((el) => {
        el.addEventListener('click', () => {
          const issue = this.issues[Number(el.dataset.issue)];
          if (issue?.x !== undefined && issue.z !== undefined) {
            this.app.renderer.camera.centerOn((issue.x + 0.5) * TILE_SIZE, (issue.z + 0.5) * TILE_SIZE);
            this.app.renderer.camera.setZoom(34);
          }
        });
      });
    }
    this.renderSummary();
    this.recomputeReach();
    const sub = this.root?.querySelector('#ed-sub');
    if (sub) sub.textContent = `SCENARIO FORGE · ${this.scenario.width}×${this.scenario.height} · ${this.scenario.structures.length} STRUCTURES · ${this.scenario.units.length} UNITS`;
  }

  private recomputeReach(): void {
    if (this.reachMode === 'off') {
      this.reach = null;
      return;
    }
    const starts = this.scenario.players.map((p) => ({ x: p.startX, z: p.startZ }));
    if (this.reachMode === 'naval') {
      const water: Array<{ x: number; z: number }> = [];
      for (let z = 0; z < this.scenario.height; z++) {
        for (let x = 0; x < this.scenario.width; x++) {
          const t = this.scenario.tiles[tileIndex(this.scenario.width, x, z)].t;
          if (t === Terrain.DeepWater || t === Terrain.ShallowWater) water.push({ x, z });
        }
      }
      this.reach = reachableFrom(this.scenario, water, 'naval');
    } else {
      this.reach = reachableFrom(this.scenario, starts, 'tracked');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Canvas interaction                                                  */
  /* ------------------------------------------------------------------ */

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.active) return;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic or already-released pointers cannot be captured. */
    }
    if (event.button === 1 || event.button === 2 || this.panMode) {
      this.pan = { x: event.clientX, y: event.clientY };
      return;
    }
    if (event.button !== 0) return;
    this.painting = true;
    this.lastPaint = '';
    this.paintAtScreen(event.clientX, event.clientY);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.active) return;
    this.updateHover(event.clientX, event.clientY);
    if (this.pan) {
      this.app.renderer.camera.panScreen(event.clientX - this.pan.x, event.clientY - this.pan.y);
      this.pan = { x: event.clientX, y: event.clientY };
      return;
    }
    if (this.painting && (this.tool === 'paint' || this.tool === 'raise' || this.tool === 'lower' || this.tool === 'ore' || this.tool === 'erase')) {
      this.paintAtScreen(event.clientX, event.clientY);
    }
  };

  private onPointerUp = (): void => {
    this.painting = false;
    this.pan = null;
    if (this.terrainDirty) this.refreshTerrain(true);
    this.refreshValidation();
    this.scheduleAutosave();
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.active) return;
    event.preventDefault();
    this.app.renderer.camera.zoomBy(event.deltaY > 0 ? 1.1 : 0.9);
  };

  private onContext = (event: Event): void => {
    event.preventDefault();
  };

  private attachCanvas(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContext);
  }

  private detachCanvas(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContext);
  }

  private updateHover(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.hoverScreen = { x: clientX - rect.left, y: clientY - rect.top };
    const ray = this.app.renderer.camera.screenRay(clientX - rect.left, clientY - rect.top);
    const hit = pickTerrain(this.scenario, ray);
    this.hover = hit && inBounds(this.scenario.width, this.scenario.height, hit.tileX, hit.tileZ)
      ? { x: hit.tileX, z: hit.tileZ }
      : null;
  }

  private paintAtScreen(clientX: number, clientY: number): void {
    this.updateHover(clientX, clientY);
    if (!this.hover) return;
    const key = `${this.hover.x},${this.hover.z}`;
    if (key === this.lastPaint && this.tool !== 'structure' && this.tool !== 'unit') return;
    this.lastPaint = key;
    if (this.tool === 'structure' || this.tool === 'unit') {
      if (this.tool === 'unit' && this.owner < 0) {
        this.app.notify('Neutral units cannot be placed; choose a player owner.', 'warning');
        return;
      }
      const def = this.tool === 'structure' ? BUILDINGS[this.structureDef] : UNITS[this.unitDef];
      if (!def) return;
      if (this.tool === 'structure') {
        const bdef = BUILDINGS[this.structureDef];
        const tx = this.hover.x - Math.floor(bdef.footprint.w / 2);
        const tz = this.hover.z - Math.floor(bdef.footprint.h / 2);
        const occupied = this.occupancy();
        const check = checkPlacement(this.scenario, this.structureDef, tx, tz, occupied);
        if (!check.ok) {
          this.app.notify(check.reason, 'warning');
          this.app.audio.play('denied');
          return;
        }
        const unitBlocked = this.scenario.units.some(
          (u) => u.x >= tx && u.x < tx + bdef.footprint.w && u.z >= tz && u.z < tz + bdef.footprint.h,
        );
        if (unitBlocked) {
          this.app.notify('A starting unit is standing on the foundation.', 'warning');
          return;
        }
        this.scenario.structures.push({ defId: this.structureDef, owner: this.owner, x: tx, z: tz });
      } else {
        const udef = UNITS[this.unitDef];
        const blocked = this.scenario.structures.some((s) => {
          const bdef = BUILDINGS[s.defId];
          return bdef && this.hover && this.hover.x >= s.x && this.hover.x < s.x + bdef.footprint.w && this.hover.z >= s.z && this.hover.z < s.z + bdef.footprint.h;
        });
        if (blocked) {
          this.app.notify('A structure occupies that tile.', 'warning');
          return;
        }
        const terrainArr = new Uint8Array(this.scenario.tiles.map((t) => t.t));
        if (!canStandOn(this.scenario.width, this.scenario.height, terrainArr, tileIndex(this.scenario.width, this.hover.x, this.hover.z), udef.moveClass)) {
          this.app.notify(`${udef.name} cannot start on this terrain.`, 'warning');
          this.app.audio.play('denied');
          return;
        }
        this.scenario.units.push({ defId: this.unitDef, owner: this.owner, x: this.hover.x, z: this.hover.z });
      }
      this.app.audio.play('build');
      this.refreshValidation();
      return;
    }
    if (this.tool === 'start') {
      const player = this.scenario.players.find((p) => p.id === this.startPlayerId);
      if (player) {
        player.startX = this.hover.x;
        player.startZ = this.hover.z;
        const label = this.root?.querySelector(`#ed-start-${player.id}`);
        if (label) label.textContent = `${player.startX}, ${player.startZ}`;
        this.refreshValidation();
      }
      return;
    }
    this.paintTiles(this.hover.x, this.hover.z);
  }

  private paintTiles(cx: number, cz: number): void {
    const radius = this.brush;
    let changed = false;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius + 1) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (!inBounds(this.scenario.width, this.scenario.height, x, z)) continue;
        const tile = this.scenario.tiles[tileIndex(this.scenario.width, x, z)];
        if (this.tool === 'paint') {
          tile.t = this.terrain;
          if (this.terrain === Terrain.DeepWater) {
            tile.e = 0;
            tile.o = 0;
          } else if (this.terrain === Terrain.ShallowWater) {
            tile.e = 0;
            tile.o = 0;
          } else if (!TERRAIN[this.terrain].oreAllowed) {
            tile.o = 0;
          }
          changed = true;
        } else if (this.tool === 'raise' || this.tool === 'lower') {
          if (tile.t === Terrain.DeepWater || tile.t === Terrain.ShallowWater) continue;
          const delta = this.tool === 'raise' ? 1 : -1;
          tile.e = Math.max(0, Math.min(4, tile.e + delta));
          changed = true;
        } else if (this.tool === 'ore') {
          if (TERRAIN[tile.t as TerrainId]?.oreAllowed) {
            tile.o = 300;
            changed = true;
          }
        } else if (this.tool === 'erase') {
          if (this.eraseEntityAt(x, z) || tile.o > 0) changed = true;
        }
      }
    }
    if (changed) {
      this.terrainDirty = true;
      const status = this.root?.querySelector('#ed-status');
      if (status) status.textContent = `${this.hoverInfo()} · painting`;
      if (performance.now() - this.lastTerrainRefresh > 140) this.refreshTerrain(false);
    }
  }

  private eraseEntityAt(x: number, z: number): boolean {
    const structureIndex = this.scenario.structures.findIndex((s) => {
      const bdef = BUILDINGS[s.defId];
      return bdef && x >= s.x && x < s.x + bdef.footprint.w && z >= s.z && z < s.z + bdef.footprint.h;
    });
    if (structureIndex >= 0) {
      this.scenario.structures.splice(structureIndex, 1);
      return true;
    }
    const unitIndex = this.scenario.units.findIndex((u) => u.x === x && u.z === z);
    if (unitIndex >= 0) {
      this.scenario.units.splice(unitIndex, 1);
      return true;
    }
    return false;
  }

  private occupancy(): Uint8Array {
    const occupied = new Uint8Array(this.scenario.width * this.scenario.height);
    for (const s of this.scenario.structures) {
      const def = BUILDINGS[s.defId];
      if (!def) continue;
      for (let dz = 0; dz < def.footprint.h; dz++) {
        for (let dx = 0; dx < def.footprint.w; dx++) {
          const x = s.x + dx;
          const z = s.z + dz;
          if (inBounds(this.scenario.width, this.scenario.height, x, z)) occupied[tileIndex(this.scenario.width, x, z)] = 1;
        }
      }
    }
    return occupied;
  }

  private refreshTerrain(force: boolean): void {
    if (!this.terrainDirty && !force) return;
    const camera = this.app.renderer.camera;
    const cx = camera.cx;
    const cz = camera.cz;
    const zoom = camera.zoom;
    this.app.renderer.setScenario(this.scenario);
    this.app.renderer.settings.showFog = false;
    camera.centerOn(cx, cz);
    camera.setZoom(zoom);
    this.terrainDirty = false;
    this.lastTerrainRefresh = performance.now();
  }

  /* ------------------------------------------------------------------ */
  /* New / open / save / deploy                                          */
  /* ------------------------------------------------------------------ */

  private showNewDialog(): void {
    openModal({
      title: 'New scenario',
      body: `<div class="form-grid">
        <label class="form-row"><span>Name</span><input id="new-name" value="New island scenario"></label>
        <label class="form-row"><span>Width</span><input id="new-w" type="number" min="16" max="160" value="96"></label>
        <label class="form-row"><span>Height</span><input id="new-h" type="number" min="16" max="128" value="72"></label>
        <p class="modal-note">Creates a grass island-free map with two players and no forces. Use the terrain tools to author coastlines and deploy assets.</p>
      </div>`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Create',
          primary: true,
          onClick: () => {
            const w = Math.max(16, Math.min(160, Number((document.getElementById('new-w') as HTMLInputElement)?.value) || 96));
            const h = Math.max(16, Math.min(128, Number((document.getElementById('new-h') as HTMLInputElement)?.value) || 72));
            const name = (document.getElementById('new-name') as HTMLInputElement)?.value || 'New island scenario';
            const scenario = createEmptyScenario(w, h);
            scenario.meta.name = name;
            scenario.meta.id = `custom-${Date.now().toString(36)}`;
            this.load(scenario);
            this.app.notify(`${name} created (${w}×${h}).`, 'success');
          },
        },
      ],
    });
  }

  private showOpenDialog(): void {
    openModal({
      title: 'Open scenario',
      body: `<p>Load a scenario JSON created by Scenario Forge, restore the last autosave, or open the built-in Kestrel Bay battlefield.</p>
        <input type="file" id="ed-file" accept=".json,application/json" hidden>
        <div class="tool-grid open-grid">
          <button class="tool-btn" data-open="file">${icon('folder')}FROM FILE</button>
          <button class="tool-btn" data-open="auto">${icon('save')}AUTOSAVE</button>
          <button class="tool-btn" data-open="builtin">${icon('terrain')}KESTREL BAY</button>
        </div>`,
      actions: [{ label: 'Cancel' }],
      onMount: (root) => {
        const file = root.querySelector<HTMLInputElement>('#ed-file');
        root.querySelectorAll<HTMLElement>('[data-open]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const kind = btn.dataset.open;
            if (kind === 'file') file?.click();
            if (kind === 'auto') {
              try {
                const raw = localStorage.getItem(AUTOSAVE_KEY);
                if (!raw) {
                  this.app.notify('No editor autosave exists yet.', 'warning');
                  return;
                }
                this.load(parseScenario(JSON.parse(raw)));
                this.app.notify('Editor autosave restored.', 'success');
              } catch (error) {
                this.app.notify(`Autosave could not be restored: ${error instanceof Error ? error.message : String(error)}`, 'critical');
              }
            }
            if (kind === 'builtin') {
              this.load(createIslandAssault());
              closeModal();
              this.app.notify('Loaded Island Assault — Kestrel Bay.', 'success');
            }
          });
        });
        file?.addEventListener('change', async () => {
          const chosen = file.files?.[0];
          if (!chosen) return;
          try {
            const text = await chosen.text();
            const scenario = parseScenario(JSON.parse(text));
            this.load(scenario);
            this.app.notify(`Loaded ${scenario.meta.name}.`, 'success');
          } catch (error) {
            this.app.notify(`Scenario load failed: ${error instanceof Error ? error.message : String(error)}`, 'critical');
          }
        });
      },
    });
  }

  private saveJson(): void {
    try {
      const json = scenarioToJson(this.scenario);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.scenario.meta.id || 'scenario'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      localStorage.setItem(AUTOSAVE_KEY, json);
      this.app.notify('Scenario saved as JSON and in browser autosave.', 'success');
    } catch (error) {
      this.app.notify(`Save failed: ${error instanceof Error ? error.message : String(error)}`, 'critical');
    }
  }

  private scheduleAutosave(): void {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, scenarioToJson(this.scenario));
      } catch {
        /* Autosave is best-effort. */
      }
    }, 1800);
  }

  private launch(): void {
    const errors = this.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      this.app.notify(`Cannot deploy: ${errors[0].message}`, 'critical');
      this.app.audio.play('denied');
      this.tab = 'mission';
      this.renderTools();
      return;
    }
    this.app.launchEditorScenario(cloneScenario(this.scenario));
  }

  private quickAction(kind: string): void {
    if (kind === 'hq') {
      const occupied = this.occupancy();
      for (const p of this.scenario.players) {
        const hasHq = this.scenario.structures.some((s) => s.owner === p.id && BUILDINGS[s.defId]?.commandPost);
        if (hasHq) continue;
        for (let attempt = 0; attempt < 60; attempt++) {
          const tx = Math.max(0, Math.min(this.scenario.width - 4, p.startX - 2 + (attempt % 6) - 3));
          const tz = Math.max(0, Math.min(this.scenario.height - 4, p.startZ - 2 + Math.floor(attempt / 6) - 3));
          if (checkPlacement(this.scenario, 'commandPost', tx, tz, occupied).ok) {
            this.scenario.structures.push({ defId: 'commandPost', owner: p.id, x: tx, z: tz });
            for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) occupied[tileIndex(this.scenario.width, tx + dx, tz + dz)] = 1;
            break;
          }
        }
      }
      this.app.notify('Command posts added where space allowed.', 'success');
    } else if (kind === 'relay') {
      const occupied = this.occupancy();
      const placed: string[] = [];
      for (let attempt = 0; attempt < 80 && placed.length < 2; attempt++) {
        const tx = Math.floor(this.scenario.width * 0.35 + (attempt * 7) % Math.max(4, Math.floor(this.scenario.width * 0.3)));
        const tz = Math.floor(this.scenario.height * 0.25 + (attempt * 5) % Math.max(4, Math.floor(this.scenario.height * 0.5)));
        if (checkPlacement(this.scenario, 'relay', tx, tz, occupied).ok) {
          this.scenario.structures.push({ defId: 'relay', owner: -1, x: tx, z: tz });
          placed.push(`${tx},${tz}`);
          occupied[tileIndex(this.scenario.width, tx, tz)] = 1;
          occupied[tileIndex(this.scenario.width, tx + 1, tz)] = 1;
          occupied[tileIndex(this.scenario.width, tx, tz + 1)] = 1;
          occupied[tileIndex(this.scenario.width, tx + 1, tz + 1)] = 1;
        }
      }
      this.app.notify(placed.length ? `${placed.length} relays added.` : 'No room for relays — paint more open ground.', placed.length ? 'success' : 'warning');
    } else if (kind === 'force') {
      for (const p of this.scenario.players) {
        if (this.scenario.units.some((u) => u.owner === p.id)) continue;
        for (let i = 0; i < 3; i++) {
          const x = Math.max(0, Math.min(this.scenario.width - 1, p.startX + (i % 2 === 0 ? 2 : -2)));
          const z = Math.max(0, Math.min(this.scenario.height - 1, p.startZ + i));
          this.scenario.units.push({ defId: i === 0 ? 'engineer' : 'rifle', owner: p.id, x, z });
        }
      }
      this.app.notify('Starter engineer and riflemen added.', 'success');
    }
    this.refreshValidation();
    this.scheduleAutosave();
  }

  /* ------------------------------------------------------------------ */
  /* Draw                                                                */
  /* ------------------------------------------------------------------ */

  draw(): void {
    if (!this.active) return;
    this.overlayWidth = this.app.overlay.width;
    this.overlayHeight = this.app.overlay.height;
    const now = performance.now();
    if (this.terrainDirty && now - this.lastTerrainRefresh > 120) this.refreshTerrain(false);
    drawEditorOverlay(this);
  }

  hoverInfo(): string {
    if (!this.hover) return 'Out of bounds';
    return `(${this.hover.x}, ${this.hover.z}) · ${terrainNameAt(this, this.hover.x, this.hover.z)}`;
  }

  /** Short, inspectable description of the selected structure's authored role. */
  private structureNote(defId: string): string {
    const def = BUILDINGS[defId];
    if (!def) return '';
    if (def.garrison) {
      return ` · garrison ${def.garrison.capacity} · ${Math.round(def.garrison.protection * 100)}% cover`;
    }
    if ((def.matsPerSec ?? 0) > 0) return ` · +${def.matsPerSec} materials/s when captured`;
    if ((def.scanRadius ?? 0) > 0) return ` · ${def.scanRadius}-tile reconnaissance when captured`;
    if ((def.reqPerSec ?? 0) > 0) return ` · +${def.reqPerSec} requisition/s when captured`;
    return '';
  }

  toolHint(): string {
    switch (this.tool) {
      case 'paint':
        return `PAINT ${TERRAIN[this.terrain].name.toUpperCase()} · brush ${this.brush * 2 + 1} · L-drag paint · R-drag pan`;
      case 'raise':
        return 'RAISE ELEVATION · L-drag to add a level · right-drag pan';
      case 'lower':
        return 'LOWER ELEVATION · L-drag to remove a level · right-drag pan';
      case 'ore':
        return 'MATERIAL DEPOSIT · paint ore on buildable land · right-drag pan';
      case 'erase':
        return 'ERASE · remove unit/structure under cursor, or clear ore · right-drag pan';
      case 'start':
        return `PLAYER START · click to reposition ${escapeHtml(this.scenario.players.find((p) => p.id === this.startPlayerId)?.name ?? 'player')}`;
      case 'structure': {
        const def = BUILDINGS[this.structureDef];
        return `PLACE ${def?.name.toUpperCase() ?? 'STRUCTURE'} · owner ${this.owner}${this.structureNote(this.structureDef)} · shipyards need navigable coast`;
      }
      case 'unit':
        return `PLACE ${unitPaletteName(this.unitDef).toUpperCase()} · owner ${this.owner} · check terrain and structures`;
      default:
        return '';
    }
  }

  private activeToolLabel(): string {
    switch (this.tool) {
      case 'paint':
        return `PAINT ${TERRAIN[this.terrain].name.toUpperCase()}`;
      case 'structure':
        return `PLACE ${BUILDINGS[this.structureDef]?.name.toUpperCase() ?? 'STRUCTURE'}${this.structureNote(this.structureDef)}`;
      case 'unit':
        return `PLACE ${unitPaletteName(this.unitDef).toUpperCase()}`;
      case 'start':
        return `START ${this.scenario.players.find((p) => p.id === this.startPlayerId)?.name.toUpperCase() ?? 'PLAYER'}`;
      default:
        return this.tool.toUpperCase();
    }
  }

  private setHint(): void {
    const hint = this.root?.querySelector('#ed-hint');
    if (hint) {
      hint.textContent = this.touchLayout
        ? `${this.activeToolLabel()} · ${this.panMode ? 'PAN ACTIVE' : 'tap/drag to apply'} · +/− zoom`
        : this.toolHint();
    }
    this.draw();
  }
}

