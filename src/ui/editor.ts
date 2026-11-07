import type { App } from '../app';
import {
  checkPlacement,
  cloneScenario,
  parseScenario,
  reachableFrom,
  scenarioToJson,
  validateScenario,
  waterFacingFor,
  type Scenario,
  type ScenarioStructure,
  type ScenarioUnit,
  type ValidationIssue,
} from '../sim/scenario';
import { createEmptyScenario, createIslandAssault } from '../data/scenarios';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { PROPS, PROP_GROUPS, PROP_IDS, type PropKind } from '../data/props';
import { propPreview } from './propPreviews';
import type { ScenarioProp } from '../sim/scenario';
import {
  deleteProps,
  duplicateProps,
  propAt,
  propBox,
  propSettings,
  propTiles,
  propsInBox,
  pruneSelection,
  type TileBox,
  centreProp,
  nudgeProp,
  rotateProp,
} from './editorProps';
import { ALLIANCE_LIST, FACTIONS, NATION_LIST, tryIdentityDef } from '../data/factions';
import {
  OVERLAYS,
  OVERLAY_PALETTE,
  Overlay,
  TERRAIN,
  TERRAIN_GROUPS,
  Terrain,
  canStandOn,
  inBounds,
  overlayAllowedOn,
  overlayNote,
  packOverlay,
  tileIndex,
  type OverlayId,
  type TerrainId,
} from '../sim/terrain';
import { MAX_ELEVATION, TILE_SIZE } from '../sim/constants';
import {
  DEFAULT_DAY_LENGTH_MINUTES,
  PHASE_LABELS,
  formatHour,
  normaliseStartHour,
  phaseAtHour,
  phaseForStartHour,
} from '../sim/dayNight';
import { WEATHER, WEATHER_KINDS, weatherFor } from '../sim/weather';
import { pickTerrain } from '../render/terrainSurface';
import { icon } from './icons';
import { openModal, closeModal, escapeHtml } from './modal';
import { drawEditorOverlay, regionHandleScreenPoints, terrainNameAt, unitPaletteName } from './editorRender';
import { MissionWorkbench } from './missionWorkbench';
import { ensureEntityKey, type MissionSection } from '../mission/authoring';
import {
  applyRect,
  moveRegion,
  rectFromTiles,
  rectOfRegion,
  regionAt,
  resizeRegion,
  sameRect,
  type RegionHandle,
  type TileRect,
} from '../mission/regions';
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftState,
  type EditorDraftWrite,
} from '../mission/draft';
import type { LibraryStorage } from '../mission/library';
import { openMissionLibrary } from './missionLibrary';
import { missionBriefingMarkup } from './missionBriefing';
import {
  dismissEditorSheet,
  editorSheetHeight,
  editorSheetOffset,
  railOffset,
  railRestOffset,
  railSettlesCollapsed,
  resolveEditorLayout,
  type RailSide,
} from './editorLayout';
import {
  SYMMETRY_MODES,
  symmetryNote,
  symmetryOwner,
  symmetryRects,
  symmetryStart,
  symmetryTiles,
  type SymmetryMode,
} from './editorSymmetry';

type EditorTab = 'terrain' | 'forces' | 'mission';
type EditorTool =
  | 'paint'
  | 'raise'
  | 'lower'
  | 'ore'
  | 'erase'
  | 'start'
  | 'structure'
  | 'unit'
  /** Surface/vegetation overlay on top of the existing base terrain. */
  | 'overlay'
  /** Strip the surface layer without touching the ground under it. */
  | 'overlayClear'
  /** Individual authored set dressing: one piece per click. */
  | 'prop'
  /** Eyedropper: adopt a placed prop's kind, yaw and scale. */
  | 'propPick'
  /** Marquee: select authored props, shift to add or remove. */
  | 'propSelect';

/**
 * Browser storage, or null when the browser refuses access entirely.
 *
 * Merely reading `localStorage` can throw in locked-down browsing modes, so
 * every draft path goes through this guard instead of assuming it exists.
 */
function browserStorage(): LibraryStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class Editor {
  readonly app: App;
  readonly ctx: CanvasRenderingContext2D;
  scenario: Scenario;
  active = false;
  tab: EditorTab = 'terrain';
  tool: EditorTool = 'paint';
  terrain: TerrainId = Terrain.Grass;
  /** Surface layer painted by the overlay brushes. */
  overlayId: OverlayId = Overlay.Crop;
  overlayDensity = 2;
  brush = 1;
  owner = 0;
  structureDef = 'barracks';
  unitDef = 'rifle';
  /** Which set-dressing piece the placement tool stamps. */
  propKind: PropKind = 'bush';
  /** Yaw of the next authored prop, in degrees (the format stores radians). */
  propRotation = 0;
  /** Size multiplier of the next authored prop. */
  propScale = 1;
  /** Authored props the marquee has caught: object identity, not tile keys. */
  propSelection: ScenarioProp[] = [];
  /** Marquee rectangle in progress, in tile coordinates; drawn by the overlay. */
  propMarquee: TileBox | null = null;
  /** Whether the marquee being dragged adds to the selection instead of replacing it. */
  private propMarqueeAdditive = false;
  startPlayerId = 0;
  /** Authoring symmetry: one-way, mirrored or four-way rotational. */
  symmetry: SymmetryMode = 'single';
  reachMode: 'off' | 'ground' | 'naval' = 'off';
  panMode = false;
  reach: Uint8Array | null = null;
  issues: ValidationIssue[] = [];
  hover: { x: number; z: number } | null = null;
  hoverScreen = { x: 0, y: 0 };
  overlayWidth = 1;
  overlayHeight = 1;
  /** Draw mission region rectangles on the map while the workbench is open. */
  showRegions = false;
  /**
   * Mission-region authoring mode.
   *
   * While it is anything other than `off` the map belongs to the region tool:
   * a left gesture draws, moves or resizes, and no brush, placement or erase
   * code runs. Right/middle drag still pans, so framing the shot is never a
   * separate mode.
   */
  regionTool: 'off' | 'draw' | 'select' = 'off';
  selectedRegionId: string | null = null;
  /** Rectangle being dragged, before it is written to the document. */
  regionDraft: TileRect | null = null;
  /** Authored placement ringed on the map while a reference is inspected. */
  highlightEntityKey: string | null = null;
  /** Called after a region gesture commits, so the workbench can re-anchor. */
  onRegionEdited: (() => void) | null = null;

  private regionDrag: {
    mode: 'draw' | 'move' | 'resize';
    handle: RegionHandle | null;
    startX: number;
    startZ: number;
    origin: TileRect;
    regionId: string | null;
  } | null = null;
  /** Pending map pick; resolved to an authored key or cancelled with null. */
  private entityPick: ((key: string | null) => void) | null = null;

  private root: HTMLElement | null = null;
  private pan: { x: number; y: number } | null = null;
  private painting = false;
  private lastPaint = '';
  /** Set by any prop edit; the next frame restages the scenery. */
  private propsDirty = false;
  private terrainDirty = false;
  private lastTerrainRefresh = 0;
  private autosaveTimer = 0;
  /** Outcome of the last draft write; drives the recovery panel and toasts. */
  private lastDraftWrite: EditorDraftWrite | null = null;
  private draftFailureNotified = false;
  private touchLayout = false;
  private sheetDrag: { startY: number; dy: number; target: HTMLElement } | null = null;
  /** Which slide rails are drawn out. Remembered while the forge is open. */
  private rails: Record<RailSide, boolean> = { left: true, right: true };
  private canvas: HTMLCanvasElement;
  private workbench: MissionWorkbench | null = null;

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

  /** Whether this browser holds a Scenario Forge draft. */
  static hasAutosave(): boolean {
    const storage = browserStorage();
    return storage ? readEditorDraft(storage).present : false;
  }

  /** Read the draft without opening the forge; null if unusable. */
  static readAutosave(): Scenario | null {
    const storage = browserStorage();
    return storage ? readEditorDraft(storage).scenario : null;
  }

  /** The latest recoverable draft, including metadata for the workbench. */
  draftState(): EditorDraftState {
    const storage = browserStorage();
    if (!storage) {
      return {
        scenario: null,
        meta: null,
        error: 'Browser storage is unavailable in this browsing mode, so nothing can be drafted.',
        present: false,
      };
    }
    return readEditorDraft(storage);
  }

  /** Result of the most recent draft write, so the UI never claims a failed save. */
  get draftStatus(): EditorDraftWrite | null {
    return this.lastDraftWrite;
  }

  open(scenario: Scenario): void {
    this.workbench?.close(true);
    this.workbench = null;
    this.active = true;
    this.load(scenario, false);
    const root = document.getElementById('hud-root');
    if (!root) return;
    this.root = root;
    root.innerHTML = this.markup();
    this.bindChrome();
    this.bindSheetDrag();
    this.bindRails();
    this.bindSymmetry();
    this.applyRails();
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
    this.workbench?.close(true);
    this.workbench = null;
    this.showRegions = false;
    this.resetRegionEditing();
    this.onRegionEdited = null;
    this.highlightEntityKey = null;
    this.entityPick = null;
    this.sheetDrag = null;
    window.removeEventListener('resize', this.onResize);
    this.detachCanvas();
    if (this.root) this.root.innerHTML = '';
    this.root = null;
    this.ctx.clearRect(0, 0, this.overlayWidth, this.overlayHeight);
  }

  private load(scenario: Scenario, refresh = true): void {
    this.scenario = scenario;
    // A yard authored without a facing is turned by the battle from its coast;
    // resolve that here too so the forge previews the slipway it will deploy.
    for (const s of scenario.structures) {
      if (s.facing === undefined && BUILDINGS[s.defId]?.requiresWater) {
        s.facing = waterFacingFor(scenario, s);
      }
    }
    this.issues = [];
    this.reach = null;
    this.hover = null;
    this.terrainDirty = false;
    this.lastPaint = '';
    // A loaded document is a different set of regions: a stale selection or
    // half-drawn rectangle must never be applied to it.
    this.resetRegionEditing();
    this.syncSymmetryRow();
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
          <button class="btn btn-ghost" data-ed="library" aria-label="Mission library">${icon('folder')} <span class="btn-label">LIBRARY</span></button>
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
        <div class="editor-sym-row" id="ed-symmetry" role="group" aria-label="Authoring symmetry">${this.symmetryRow()}</div>
        <div class="tool-scroll" id="ed-tools"></div>
        <div class="editor-workbench-host" id="ed-workbench" hidden></div>
        <button class="editor-rail" data-rail="tools" aria-label="Slide the authoring tools away" aria-expanded="true"><span class="editor-rail-grip"></span></button>
      </aside>
      <aside class="editor-side" aria-label="Scenario settings">
        <div class="editor-sheet-grab" data-sheet-grab aria-label="Drag settings sheet"></div>
        <button class="editor-rail" data-rail="side" aria-label="Slide the scenario settings away" aria-expanded="true"><span class="editor-rail-grip"></span></button>
        <div class="panel-head"><span>SCENARIO SETTINGS</span><span class="editor-sheet-meta"><span class="mono" id="ed-dims">${this.scenario.width}×${this.scenario.height}</span><button class="editor-sheet-close" data-ed="inspector-close" aria-label="Close scenario settings">${icon('close')}</button></span></div>
        <div class="editor-inspector" id="ed-inspector"></div>
      </aside>
      <div class="editor-backdrop" data-ed="backdrop"></div>
      <div class="editor-hint" id="ed-hint">Left click paint · Right/middle drag pan · Wheel zoom · Drag the panel rails to slide them away</div>
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
        this.setTab((btn.dataset.tab as EditorTab) ?? 'terrain');
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
      case 'library':
        this.openMissionLibrary();
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
      this.applyRails();
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
  /* Sliding sidebars                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Both side panels sit on a rail. Dragging the strip on the panel's inner
   * edge slides it out of the way and leaves a working handle on screen, so a
   * wide map can be seen whole without losing the panel for good. The rails
   * are a pointer-device affordance: on touch the panels are drawers already.
   */
  private bindRails(): void {
    this.root?.querySelectorAll<HTMLElement>('[data-rail]').forEach((rail) => {
      const side: RailSide = rail.dataset.rail === 'side' ? 'right' : 'left';
      const panel = rail.parentElement;
      if (!panel) return;
      let drag: { startX: number; base: number } | null = null;
      let moved = false;
      const settle = (clientX: number, commit: boolean): void => {
        const width = panel.offsetWidth;
        const offset = railOffset(side, width, (drag?.base ?? 0) + (clientX - (drag?.startX ?? clientX)));
        if (!commit) {
          panel.style.transform = '';
          return;
        }
        drag = null;
        panel.classList.remove('dragging');
        // `railSettlesCollapsed` answers "stowed?", while `setRail` takes "open":
        // passing it straight through used to push the panel back open exactly
        // when the author had dragged it shut.
        this.setRail(side, !railSettlesCollapsed(side, width, offset));
      };
      rail.addEventListener('pointerdown', (event) => {
        if (this.touchLayout) return;
        event.preventDefault();
        moved = false;
        drag = { startX: event.clientX, base: railRestOffset(side, panel.offsetWidth, !this.rails[side]) };
        panel.classList.add('dragging');
        try {
          rail.setPointerCapture(event.pointerId);
        } catch {
          /* Synthetic pointers cannot be captured. */
        }
      });
      rail.addEventListener('pointermove', (event) => {
        if (!drag) return;
        const width = panel.offsetWidth;
        const offset = railOffset(side, width, drag.base + (event.clientX - drag.startX));
        if (Math.abs(event.clientX - drag.startX) > 3) moved = true;
        panel.style.transform = `translateX(${offset}px)`;
      });
      rail.addEventListener('pointerup', (event) => {
        if (!drag) return;
        settle(event.clientX, moved);
        // A press that never became a drag leaves the panel alone; the click
        // that follows owns the toggle.
      });
      rail.addEventListener('pointercancel', () => {
        if (!drag) return;
        settle(0, false);
        drag = null;
        panel.classList.remove('dragging');
      });
      // A press that never became a drag toggles the panel, so the rail works for
      // anyone who would rather click than pull. The rail is a button, so Enter
      // and Space arrive here as clicks and need no separate handler.
      rail.addEventListener('click', () => {
        if (this.touchLayout || moved) return;
        this.setRail(side, !this.rails[side]);
      });
    });
  }

  /** Put a panel in its open or stowed state and mirror that into the chrome. */
  private setRail(side: RailSide, open: boolean): void {
    this.rails[side] = open;
    const panel = this.root?.querySelector<HTMLElement>(side === 'left' ? '.editor-tools' : '.editor-side');
    if (panel) {
      panel.classList.remove('dragging');
      panel.style.transform = '';
      panel.classList.toggle('collapsed', !open);
      panel.querySelector('[data-rail]')?.setAttribute('aria-expanded', String(open));
      panel.querySelector('[data-rail]')?.setAttribute('aria-label', open
        ? `Slide the ${side === 'left' ? 'authoring tools' : 'scenario settings'} away`
        : `Bring the ${side === 'left' ? 'authoring tools' : 'scenario settings'} back`);
    }
    const screen = this.root?.querySelector<HTMLElement>('.editor-screen');
    screen?.classList.toggle(side === 'left' ? 'tools-collapsed' : 'side-collapsed', !open);
  }

  private applyRails(): void {
    if (this.touchLayout) {
      // The touch composition places the panels itself; stale rail transforms
      // would fight the drawers.
      this.root?.querySelectorAll<HTMLElement>('.editor-tools, .editor-side').forEach((panel) => {
        panel.classList.remove('collapsed', 'dragging');
        panel.style.transform = '';
      });
      this.root?.querySelector('.editor-screen')?.classList.remove('tools-collapsed', 'side-collapsed');
      return;
    }
    this.setRail('left', this.rails.left);
    this.setRail('right', this.rails.right);
  }

  /* ------------------------------------------------------------------ */
  /* Symmetry                                                            */
  /* ------------------------------------------------------------------ */

  private symmetryRow(): string {
    const buttons = SYMMETRY_MODES.map((mode) => {
      const active = this.symmetry === mode.id;
      const title = symmetryNote(mode.id, this.scenario.width, this.scenario.height);
      return `<button class="tool-btn ${active ? 'active' : ''}" data-symmetry="${mode.id}" title="${escapeHtml(title)}" aria-pressed="${active}">${mode.label}</button>`;
    }).join('');
    return `<span class="editor-sym-label">SYMMETRY</span><div class="editor-sym-grid">${buttons}</div>`;
  }

  private syncSymmetryRow(): void {
    const row = this.root?.querySelector('#ed-symmetry');
    if (!row) return;
    row.innerHTML = this.symmetryRow();
    this.bindSymmetry();
  }

  private bindSymmetry(): void {
    this.root?.querySelectorAll<HTMLElement>('[data-symmetry]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.symmetry as SymmetryMode | undefined;
        if (!mode) return;
        this.symmetry = mode;
        this.syncSymmetryRow();
        this.setHint();
        this.app.notify(symmetryNote(mode, this.scenario.width, this.scenario.height), 'info');
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Tools                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Select a sidebar view.
   *
   * The mission view can hold the docked workbench, so a tab change has to
   * re-dock as well as re-render: the workbench is a view of this panel, not an
   * overlay that outlives whichever tab happens to be showing.
   */
  private setTab(tab: EditorTab): void {
    this.tab = tab;
    this.root?.querySelectorAll<HTMLElement>('[data-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
      btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
    });
    this.renderTools();
    this.syncWorkbenchDock();
  }

  /** Column the workbench mounts into, when the Forge is open. */
  get missionWorkbenchHost(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>('#ed-workbench') ?? null;
  }

  /**
   * Show or hide the docked workbench.
   *
   * Docking rules: the workbench claims the MISSION view of the same column the
   * map tools live in. Switching to TERRAIN or FORCES hands the column back
   * without discarding the document, and the panel rail slides the whole column
   * away so the map can be worked on full-width and re-opened where it left off.
   */
  private syncWorkbenchDock(): void {
    const screen = this.root?.querySelector<HTMLElement>('.editor-screen');
    const host = this.missionWorkbenchHost;
    if (!screen || !host) return;
    const docked = Boolean(this.workbench?.active && this.tab === 'mission');
    screen.classList.toggle('mission-view', docked);
    host.hidden = !docked;
  }

  /** The workbench released its document view; hand the column back. */
  workbenchClosed(): void {
    if (!this.root) return;
    this.syncWorkbenchDock();
    this.renderTools();
  }

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
    // The palette is grouped by what the ground is, not by terrain id: the
    // catalogue is twice the size it was, and a flat list of sixteen swatches
    // is not a palette any more.
    const swatches = TERRAIN_GROUPS.map((group) => {
      const cells = group.terrains
        .map((t) => {
          const def = TERRAIN[t];
          const color = `rgb(${def.color.map((c) => Math.round(c * 255)).join(',')})`;
          const active = this.tool === 'paint' && this.terrain === t;
          // The swatch already prints its name and the map hint names the tool, so
          // the hover tip carries only the note: two copies of the same words on
          // screen at once is noise, not help.
          const note = def.note ? ` title="${escapeHtml(def.note)}"` : '';
          return `<button class="terrain-swatch ${active ? 'active' : ''}" data-terrain="${t}"${note} style="background:${color}">${escapeHtml(def.name.toUpperCase())}</button>`;
        })
        .join('');
      return `<h4 class="terrain-group">${group.name.toUpperCase()}</h4><div class="terrain-grid">${cells}</div>`;
    }).join('');
    const overlaySwatches = OVERLAY_PALETTE.map((id) => {
      const def = OVERLAYS[id];
      const color = `rgb(${def.tint.map((c) => Math.round(c * 255)).join(',')})`;
      const active = this.tool === 'overlay' && this.overlayId === id;
      return `<button class="terrain-swatch overlay-swatch ${active ? 'active' : ''}" data-overlay="${id}" title="${escapeHtml(overlayNote(id))}" style="background:${color}">${escapeHtml(def.name.toUpperCase())}</button>`;
    }).join('');
    // Fifty kinds in one flat grid is not a palette, and a label alone does not
    // tell a bollard from a hydrant. Every swatch carries a picture of the mesh
    // it stamps, so the author picks by silhouette — how the prop reads on the
    // map. Group headings are their own rows rather than grid cells, so a long
    // group name can never squeeze the swatches beside it.
    const propGroups = PROP_GROUPS.map((group) => {
      const swatches = PROP_IDS.filter((id) => PROPS[id].group === group)
        .map((id) => {
          const def = PROPS[id];
          const active = this.tool === 'prop' && this.propKind === id ? 'active' : '';
          const preview = propPreview(id);
          return `<button class="prop-swatch ${active}" data-prop="${id}" title="${escapeHtml(def.note)}">${
            preview ? `<img class="prop-thumb" src="${preview}" alt="" draggable="false">` : ''
          }<span>${escapeHtml(def.name.toUpperCase())}</span></button>`;
        })
        .join('');
      return `<div class="prop-group"><h5>${group.toUpperCase()}</h5><div class="prop-grid">${swatches}</div></div>`;
    }).join('');
    return `
      <div class="tool-section"><h4>BRUSH TOOL</h4>
        <div class="tool-grid">
          ${this.toolBtn('paint', 'terrain', 'PAINT')}
          ${this.toolBtn('raise', 'elevation', 'RAISE')}
          ${this.toolBtn('lower', 'elevation', 'LOWER')}
          ${this.toolBtn('ore', 'materials', 'ORE')}
          ${this.toolBtn('overlayClear', 'erase', 'UNLAY')}
          ${this.toolBtn('erase', 'erase', 'ERASE')}
          ${this.toolBtn('start', 'target', 'START')}
        </div>
      </div>
      <div class="tool-section"><h4>TERRAIN</h4>${swatches}</div>
      <div class="tool-section"><h4>SURFACE LAYER</h4>
        <div class="terrain-grid">${overlaySwatches}</div>
        <div class="brush-row"><span class="mono">DENSITY</span><input type="range" min="1" max="3" step="1" value="${this.overlayDensity}" id="ed-overlay-density"><span class="mono">${this.overlayDensity}</span></div>
        <p class="tool-note">Overlays sit on top of the ground and never replace it: paint crops on farmland, reeds on marsh, craters on a battlefield. ${escapeHtml(overlayNote(this.overlayId))}</p>
      </div>
      <div class="tool-section"><h4>BRUSH SIZE</h4>
        <div class="brush-row"><input type="range" min="0" max="4" step="1" value="${this.brush}" id="ed-brush"><span class="mono">${this.brush * 2 + 1}</span></div>
        <p class="tool-note">Paint water to author coastlines and navigable channels. Raise or lower elevation for ridges and plateaus.</p>
      </div>
      <div class="tool-section"><h4>SET DRESSING</h4>
        <div class="prop-palette">${propGroups}</div>
        <div class="brush-row"><span class="mono">ROTATE</span><input type="range" min="-180" max="180" step="45" value="${this.propRotation}" id="ed-prop-rotate"><span class="mono">${this.propRotation}°</span></div>
        <div class="brush-row"><span class="mono">SCALE</span><input type="range" min="0.5" max="2" step="0.1" value="${this.propScale}" id="ed-prop-scale"><span class="mono">${this.propScale.toFixed(1)}×</span></div>
        <div class="tool-grid">
          <button class="tool-btn ${this.tool === 'propPick' ? 'active' : ''}" data-proppick="1" title="Click a placed prop to adopt its kind, rotation and scale">EYEDROPPER</button>
          <button class="tool-btn ${this.tool === 'propSelect' ? 'active' : ''}" data-propsel="1" title="Drag a box over authored props; shift adds or removes">SELECT</button>
        </div>
        ${
          this.propSelection.length > 0
            ? `<p class="tool-note"><b>${this.propSelection.length}</b> prop${this.propSelection.length === 1 ? '' : 's'} selected</p>
              <div class="tool-grid">
                <button class="tool-btn" data-propact="adopt">ADOPT</button>
                <button class="tool-btn" data-propact="duplicate">DUPLICATE</button>
                <button class="tool-btn" data-propact="delete">DELETE</button>
              </div>
              <div class="tool-grid">
                <button class="tool-btn" data-propact="rotateL" title="Turn the selection 45° anticlockwise">⟲ 45°</button>
                <button class="tool-btn" data-propact="rotateR" title="Turn the selection 45° clockwise">⟳ 45°</button>
                <button class="tool-btn" data-propact="centre" title="Put the selection back in the middle of its tiles">CENTRE</button>
              </div>
              <div class="tool-grid">
                <button class="tool-btn" data-propdir="-1:0" title="Nudge left inside the tile">◀</button>
                <button class="tool-btn" data-propdir="0:-1" title="Nudge up inside the tile">▲</button>
                <button class="tool-btn" data-propdir="0:1" title="Nudge down inside the tile">▼</button>
                <button class="tool-btn" data-propdir="1:0" title="Nudge right inside the tile">▶</button>
              </div>`
            : ''
        }
        <p class="tool-note">Props are stored on the scenario, so an authored piece survives a save and ships with the map. Click to place one; ERASE removes it. Select placed props to turn them in 45° steps and nudge them inside their tile (arrow keys). ${escapeHtml(PROPS[this.propKind].note)}</p>
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
    const mission = this.scenario.mission;
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
      <div class="tool-section"><h4>MISSION DOCUMENT</h4>
        ${
          mission
            ? `<p class="tool-note"><b>${escapeHtml(mission.title)}</b> · ${escapeHtml(mission.id)} · ${mission.objectives.length} objectives · ${mission.triggers.length} triggers</p>`
            : '<p class="tool-note">This scenario has no mission document. The workbench can create a playable opening draft from the current map.</p>'
        }
        <div class="tool-grid">
          <button class="tool-btn" data-mission="workbench">${icon('command')}${mission ? 'OPEN WORKBENCH' : 'CREATE MISSION'}</button>
          <button class="tool-btn" data-mission="library">${icon('folder')}MISSION LIBRARY</button>
        </div>
        <p class="tool-note">The library stores complete scenarios with embedded missions. Import and export live in the workbench.</p>
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
    this.root.querySelectorAll<HTMLElement>('[data-overlay]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.overlayId = Number(btn.dataset.overlay) as OverlayId;
        this.tool = 'overlay';
        this.panMode = false;
        this.syncPanButton();
        this.renderTools();
        this.closeTools();
        this.setHint();
      });
    });
    const density = this.root.querySelector<HTMLInputElement>('#ed-overlay-density');
    density?.addEventListener('input', () => {
      this.overlayDensity = Math.max(1, Math.min(3, Number(density.value) || 1));
      const readout = density.nextElementSibling;
      if (readout) readout.textContent = String(this.overlayDensity);
    });
    this.root.querySelectorAll<HTMLElement>('[data-prop]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.prop;
        if (!id || !PROPS[id as PropKind]) return;
        this.propKind = id as PropKind;
        this.tool = 'prop';
        this.panMode = false;
        this.syncPanButton();
        this.renderTools();
        this.closeTools();
        this.setHint();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-proppick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tool = 'propPick';
        this.panMode = false;
        this.syncPanButton();
        this.renderTools();
        this.closeTools();
        this.setHint();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-propsel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tool = 'propSelect';
        this.panMode = false;
        this.syncPanButton();
        this.renderTools();
        this.closeTools();
        this.setHint();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-propact]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.propact;
        if (action === 'adopt') {
          const first = this.propSelection[0];
          if (first) this.adoptPropSettings(first);
        } else if (action === 'duplicate') {
          this.duplicateSelectedProps();
          this.renderTools();
        } else if (action === 'delete') {
          this.deleteSelectedProps();
          this.renderTools();
        } else if (action === 'rotateL') {
          this.rotateSelectedProps(-1);
          this.renderTools();
        } else if (action === 'rotateR') {
          this.rotateSelectedProps(1);
          this.renderTools();
        } else if (action === 'centre') {
          this.centreSelectedProps();
          this.renderTools();
        }
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-propdir]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [dx, dz] = (btn.dataset.propdir ?? '0:0').split(':').map(Number);
        this.nudgeSelectedProps(dx || 0, dz || 0);
        this.renderTools();
      });
    });
    const propRotate = this.root.querySelector<HTMLInputElement>('#ed-prop-rotate');
    propRotate?.addEventListener('input', () => {
      this.propRotation = Math.max(-180, Math.min(180, Number(propRotate.value) || 0));
      const readout = propRotate.nextElementSibling;
      if (readout) readout.textContent = `${this.propRotation}°`;
      this.setHint();
    });
    const propScale = this.root.querySelector<HTMLInputElement>('#ed-prop-scale');
    propScale?.addEventListener('input', () => {
      this.propScale = Math.max(0.5, Math.min(2, Number(propScale.value) || 1));
      const readout = propScale.nextElementSibling;
      if (readout) readout.textContent = `${this.propScale.toFixed(1)}×`;
      this.setHint();
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
    this.root.querySelectorAll<HTMLElement>('[data-mission]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mission === 'library') this.openMissionLibrary();
        else this.openMissionWorkbench();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Mission authoring                                                   */
  /* ------------------------------------------------------------------ */

  /** Open the structured mission workbench in the authoring sidebar. */
  openMissionWorkbench(section?: MissionSection): void {
    if (!this.active) return;
    if (!this.workbench) this.workbench = new MissionWorkbench(this.app, this);
    if (this.tab !== 'mission') this.setTab('mission');
    this.workbench.open(section);
    this.syncWorkbenchDock();
    // On a phone the same column is a drawer: opening the workbench has to
    // bring the drawer forward instead of loading a panel nobody can see.
    if (this.touchLayout) this.openTools();
  }

  /** Section the workbench is on, if it is open. */
  get missionWorkbenchSection(): MissionSection | null {
    return this.workbench?.active ? this.workbench.currentSection : null;
  }

  openMissionLibrary(): void {
    if (!this.active) return;
    openMissionLibrary(this.app, this);
  }

  /* ------------------------------------------------------------------ */
  /* Map-assisted mission authoring                                      */
  /* ------------------------------------------------------------------ */

  /** Whether a region gesture or entity pick currently owns the map. */
  get mapToolActive(): boolean {
    return this.regionTool !== 'off' || this.entityPick !== null;
  }

  /** Whether a right/middle-button or PAN-mode camera drag is under way. */
  get panning(): boolean {
    return this.pan !== null;
  }

  /** Whether the armed tool writes a structure, unit or player start. */
  get placementToolActive(): boolean {
    return !this.mapToolActive && (this.tool === 'structure' || this.tool === 'unit' || this.tool === 'start');
  }

  /**
   * Whether the highlighted tile would accept the armed placement tool.
   *
   * This mirrors the gate in paintAtScreen, including symmetric twins, so the
   * reticle and the click cannot disagree about a site. Every call starts from
   * a fresh occupancy mask: cursor evaluation must never mutate the document
   * or leak state into the next authoring stroke.
   */
  get placementOk(): boolean {
    if (!this.placementToolActive || !this.hover) return false;
    const { x, z } = this.hover;
    if (this.tool === 'start') {
      return this.scenario.players.some((p) => p.id === this.startPlayerId);
    }
    if (this.tool === 'structure') {
      const def = BUILDINGS[this.structureDef];
      if (!def) return false;
      const tx = x - Math.floor(def.footprint.w / 2);
      const tz = z - Math.floor(def.footprint.h / 2);
      const occupied = this.occupancy();
      if (!checkPlacement(this.scenario, this.structureDef, tx, tz, occupied).ok) return false;
      // A starting unit standing on the foundation refuses the placement just
      // as it does when the button is released.
      if (
        this.scenario.units.some(
          (u) => u.x >= tx && u.x < tx + def.footprint.w && u.z >= tz && u.z < tz + def.footprint.h,
        )
      ) {
        return false;
      }
      this.markFootprint(occupied, tx, tz, def.footprint.w, def.footprint.h);
      for (const rect of symmetryRects(
        this.symmetry,
        this.scenario.width,
        this.scenario.height,
        tx,
        tz,
        def.footprint.w,
        def.footprint.h,
      )) {
        if (!checkPlacement(this.scenario, this.structureDef, rect.x, rect.z, occupied).ok) return false;
        this.markFootprint(occupied, rect.x, rect.z, rect.w, rect.h);
      }
      return true;
    }
    if (this.tool === 'unit') {
      const def = UNITS[this.unitDef];
      if (this.owner < 0 || !def) return false;
      const terrain = new Uint8Array(this.scenario.tiles.map((entry) => entry.t));
      const slots = [
        { x, z },
        ...symmetryTiles(
          this.symmetry,
          this.scenario.width,
          this.scenario.height,
          x,
          z,
        ),
      ];
      for (const slot of slots) {
        if (!inBounds(this.scenario.width, this.scenario.height, slot.x, slot.z)) return false;
        if (this.structureAt(slot.x, slot.z)) return false;
        if (
          !canStandOn(
            this.scenario.width,
            this.scenario.height,
            terrain,
            tileIndex(this.scenario.width, slot.x, slot.z),
            def.moveClass,
          )
        ) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  /** Region whose rectangle the in-progress gesture is editing, if any. */
  get regionEditTargetId(): string | null {
    return this.regionDrag?.regionId ?? null;
  }

  /** Whether a drag is currently in progress (draw, move or resize). */
  get regionGestureActive(): boolean {
    return this.regionDrag !== null;
  }

  /**
   * Enter or leave a region tool.
   *
   * Leaving the tool cancels any half-finished gesture, so a mode change can
   * never commit a rectangle the author did not confirm.
   */
  setRegionTool(tool: 'off' | 'draw' | 'select'): void {
    if (tool === 'off') this.cancelRegionEdit();
    this.regionTool = tool;
    if (tool !== 'off') {
      this.showRegions = true;
      // A map tool owns the pointer, so on a phone the drawer has to stop
      // covering the ground being drawn on. Desktop keeps the panel where it is.
      if (this.touchLayout) this.closeTools();
    }
    this.syncMapCursor();
    this.setHint();
  }

  selectRegion(id: string | null): void {
    this.selectedRegionId = id;
    this.draw();
  }

  /** Frame one region without changing the selection semantics of the list. */
  focusRegion(id: string): void {
    const region = this.scenario.mission?.regions.find((entry) => entry.id === id);
    if (!region) return;
    this.selectedRegionId = id;
    const cx = (region.x + Math.max(1, region.width) / 2) * TILE_SIZE;
    const cz = (region.z + Math.max(1, region.height) / 2) * TILE_SIZE;
    this.app.renderer.camera.centerOn(cx, cz);
    const span = Math.max(region.width, region.height) * TILE_SIZE;
    this.app.renderer.camera.setZoom(Math.max(24, Math.min(90, span * 0.9)));
    this.showRegions = true;
    this.draw();
  }

  /** Frame an authored placement, so a reference can be inspected on the map. */
  focusEntity(key: string): void {
    const point = this.entityPoint(key);
    if (!point) return;
    this.highlightEntityKey = key;
    this.app.renderer.camera.centerOn(point.x * TILE_SIZE, point.z * TILE_SIZE);
    this.app.renderer.camera.setZoom(Math.max(24, this.app.renderer.camera.zoom));
    this.draw();
  }

  /** Ring an authored placement without moving the camera. */
  setEntityHighlight(key: string | null): void {
    this.highlightEntityKey = key;
    this.draw();
  }

  /**
   * Ask for the next map click to resolve an authored entity key.
   *
   * Clicking empty ground cancels; it never substitutes a nearby placement, so a
   * failed pick leaves the authored reference exactly as it was.
   */
  pickEntityOnMap(callback: (key: string | null) => void): void {
    this.entityPick = callback;
    this.regionTool = 'off';
    this.regionDraft = null;
    this.regionDrag = null;
    this.syncMapCursor();
    this.setHint();
    if (this.touchLayout) this.closeTools();
    this.app.notify('Select an authored placement on the map. Escape cancels.', 'info');
  }

  cancelEntityPick(): void {
    const pending = this.entityPick;
    this.entityPick = null;
    this.syncMapCursor();
    this.setHint();
    pending?.(null);
  }

  /**
   * Abandon the in-progress gesture.
   *
   * Nothing has been written to the document at this point: the draft rectangle
   * lives only in this object, so cancelling is exactly "forget the draft".
   */
  cancelRegionEdit(): boolean {
    const hadWork = this.regionDrag !== null || this.regionDraft !== null;
    this.regionDrag = null;
    this.regionDraft = null;
    if (hadWork) {
      this.app.notify('Region edit cancelled. The document is unchanged.', 'info');
      this.draw();
    }
    return hadWork;
  }

  /** Drop every map-authoring mode without notifying; used on close/load. */
  private resetRegionEditing(): void {
    this.regionTool = 'off';
    this.regionDrag = null;
    this.regionDraft = null;
    this.selectedRegionId = null;
    this.syncMapCursor();
  }

  private syncMapCursor(): void {
    this.canvas.style.cursor = this.mapToolActive ? 'crosshair' : '';
  }

  private entityPoint(key: string): { x: number; z: number } | null {
    const structure = this.scenario.structures.find((entry) => entry.key === key);
    if (structure) {
      const def = BUILDINGS[structure.defId];
      return {
        x: structure.x + (def?.footprint.w ?? 1) / 2,
        z: structure.z + (def?.footprint.h ?? 1) / 2,
      };
    }
    const unit = this.scenario.units.find((entry) => entry.key === key);
    return unit ? { x: unit.x + 0.5, z: unit.z + 0.5 } : null;
  }

  /** Convert a click to an authored key, or cancel if nothing keyed is there. */
  private resolveEntityPick(clientX: number, clientY: number): void {
    const pending = this.entityPick;
    this.entityPick = null;
    this.updateHover(clientX, clientY);
    const key = this.hover ? this.entityKeyAt(this.hover.x, this.hover.z) : null;
    this.syncMapCursor();
    this.setHint();
    if (!pending) return;
    if (!key) {
      this.app.notify('No authored placement there. The reference is unchanged.', 'warning');
      pending(null);
      return;
    }
    this.highlightEntityKey = key;
    pending(key);
    this.draw();
  }

  /** Keyed placement covering a tile: a structure footprint first, then a unit. */
  private entityKeyAt(x: number, z: number): string | null {
    for (const structure of this.scenario.structures) {
      if (!structure.key) continue;
      const def = BUILDINGS[structure.defId];
      if (!def) continue;
      if (x >= structure.x && x < structure.x + def.footprint.w && z >= structure.z && z < structure.z + def.footprint.h) {
        return structure.key;
      }
    }
    const unit = this.scenario.units.find((entry) => entry.key && entry.x === x && entry.z === z);
    return unit?.key ?? null;
  }

  private beginRegionGesture(event: PointerEvent): void {
    this.updateHover(event.clientX, event.clientY);
    const mission = this.scenario.mission;
    if (!mission || !this.hover) return;
    const bounds = { width: this.scenario.width, height: this.scenario.height };
    const tx = this.hover.x;
    const tz = this.hover.z;
    const selected = mission.regions.find((entry) => entry.id === this.selectedRegionId) ?? null;

    // A grip wins over the body of the rectangle it belongs to, so resizing a
    // region whose edge sits under another one still does the obvious thing.
    if (selected) {
      const handle = this.regionHandleAt(selected, event.clientX, event.clientY);
      if (handle) {
        this.regionDrag = {
          mode: 'resize',
          handle,
          startX: tx,
          startZ: tz,
          origin: rectOfRegion(selected),
          regionId: selected.id,
        };
        this.regionDraft = rectOfRegion(selected);
        this.draw();
        return;
      }
    }

    const under = regionAt(mission.regions, tx, tz);
    if (this.regionTool === 'select') {
      this.selectedRegionId = under?.id ?? null;
      this.regionDrag = under
        ? {
            mode: 'move',
            handle: null,
            startX: tx,
            startZ: tz,
            origin: rectOfRegion(under),
            regionId: under.id,
          }
        : null;
      this.regionDraft = under ? rectOfRegion(under) : null;
      this.onRegionEdited?.();
      this.draw();
      return;
    }

    // Draw mode: dragging inside the selected region moves it; dragging its
    // grip resizes (handled above). Elsewhere starts a new rectangle, which is
    // what an author expects after framing a fresh area.
    if (selected && under?.id === selected.id) {
      this.regionDrag = {
        mode: 'move',
        handle: null,
        startX: tx,
        startZ: tz,
        origin: rectOfRegion(selected),
        regionId: selected.id,
      };
      this.regionDraft = rectOfRegion(selected);
      this.draw();
      return;
    }
    this.regionDrag = {
      mode: 'draw',
      handle: null,
      startX: tx,
      startZ: tz,
      origin: { x: tx, z: tz, width: 1, height: 1 },
      regionId: null,
    };
    this.regionDraft = rectFromTiles(tx, tz, tx, tz, bounds);
    this.draw();
  }

  private updateRegionGesture(clientX: number, clientY: number): void {
    const drag = this.regionDrag;
    if (!drag) return;
    this.updateHover(clientX, clientY);
    if (!this.hover) return;
    const bounds = { width: this.scenario.width, height: this.scenario.height };
    const dx = this.hover.x - drag.startX;
    const dz = this.hover.z - drag.startZ;
    if (drag.mode === 'draw') {
      this.regionDraft = rectFromTiles(drag.startX, drag.startZ, this.hover.x, this.hover.z, bounds);
    } else if (drag.mode === 'move') {
      this.regionDraft = moveRegion(drag.origin, dx, dz, bounds);
    } else if (drag.handle) {
      this.regionDraft = resizeRegion(drag.origin, drag.handle, dx, dz, bounds);
    }
    this.draw();
  }

  /** Write the dragged rectangle to the document. A no-op drag changes nothing. */
  private commitRegionGesture(): void {
    const drag = this.regionDrag;
    const draft = this.regionDraft;
    this.regionDrag = null;
    this.regionDraft = null;
    if (!drag || !draft) return;
    if (drag.mode !== 'draw' && sameRect(drag.origin, draft)) return;
    const mission = this.scenario.mission;
    if (!mission) return;
    if (drag.mode === 'draw') {
      const id = this.uniqueRegionId(mission.regions.map((entry) => entry.id));
      mission.regions.push({ id, x: draft.x, z: draft.z, width: draft.width, height: draft.height });
      this.selectedRegionId = id;
      this.app.notify(`Region ${id} added: ${draft.width}×${draft.height} tiles.`, 'success');
    } else {
      const region = mission.regions.find((entry) => entry.id === drag.regionId);
      if (!region) return;
      applyRect(region, draft);
    }
    this.missionChanged();
    this.onRegionEdited?.();
    this.draw();
  }

  private uniqueRegionId(taken: readonly string[]): string {
    const used = new Set(taken);
    if (!used.has('region')) return 'region';
    let n = 2;
    while (used.has(`region-${n}`)) n++;
    return `region-${n}`;
  }

  /** Grip under a screen point, if any, for the selected rectangle. */
  private regionHandleAt(
    region: { id: string; x: number; z: number; width: number; height: number },
    clientX: number,
    clientY: number,
  ): RegionHandle | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const points = regionHandleScreenPoints(this, region);
    for (const handle of Object.keys(points) as RegionHandle[]) {
      const point = points[handle];
      if (Math.abs(point.x - px) <= 9 && Math.abs(point.y - py) <= 9) return handle;
    }
    return null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if (event.key !== 'Escape' && this.propKeys(event)) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Escape') return;
    if (this.entityPick) {
      this.cancelEntityPick();
      event.preventDefault();
      return;
    }
    if (this.regionDrag || this.regionDraft) {
      this.cancelRegionEdit();
      event.preventDefault();
      return;
    }
    if (this.regionTool !== 'off') {
      this.setRegionTool('off');
      this.onRegionEdited?.();
      event.preventDefault();
    }
  };

  /**
   * Arrow keys nudge the selected props inside their tiles and `[`/`]` turn them
   * by one compass step. Returns whether the key was consumed, so Escape still
   * reaches the cancel path and typing in a field is never intercepted.
   */
  private propKeys(event: KeyboardEvent): boolean {
    if (this.propSelection.length === 0) return false;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return false;
    }
    switch (event.key) {
      case 'ArrowLeft':
        this.nudgeSelectedProps(-1, 0);
        return true;
      case 'ArrowRight':
        this.nudgeSelectedProps(1, 0);
        return true;
      case 'ArrowUp':
        this.nudgeSelectedProps(0, -1);
        return true;
      case 'ArrowDown':
        this.nudgeSelectedProps(0, 1);
        return true;
      case '[':
        this.rotateSelectedProps(-1);
        return true;
      case ']':
        this.rotateSelectedProps(1);
        return true;
      default:
        return false;
    }
  }

  /** Load a document chosen from the library or an import. */
  loadScenario(scenario: Scenario): void {
    this.load(scenario);
    this.workbench?.reload();
    this.noticeStoredDraft();
  }

  /**
   * Warn when a different draft is still stored.
   *
   * Opening an older library snapshot never deletes a newer draft; it only says
   * where it is, so the author decides which version to keep.
   */
  private noticeStoredDraft(): void {
    const draft = this.draftState();
    if (!draft.scenario || !draft.meta) return;
    if (scenarioToJson(draft.scenario) === scenarioToJson(this.scenario)) return;
    this.app.notify(
      `A browser draft from ${new Date(draft.meta.savedAt).toLocaleString()} is still stored and differs from this document. It is listed under Recovery in the workbench.`,
      'info',
    );
  }

  /**
   * Persist the draft and its metadata.
   *
   * Never throws and never reports success it cannot verify: the workbench reads
   * the returned status to decide whether the document is safe on disk.
   */
  private storeDraft(): EditorDraftWrite {
    const storage = browserStorage();
    if (!storage) {
      const failed: EditorDraftWrite = {
        ok: false,
        error:
          'Browser storage is unavailable in this browsing mode. Save the scenario JSON to keep your work.',
        code: 'unavailable',
        meta: null,
      };
      this.lastDraftWrite = failed;
      this.reportDraftFailure(failed);
      return failed;
    }
    const result = writeEditorDraft(storage, this.scenario, {
      entryId: this.workbench?.currentEntryId ?? null,
      missionId: this.scenario.mission?.id ?? null,
      errorCount: this.issues.filter((issue) => issue.severity === 'error').length,
      warningCount: this.issues.filter((issue) => issue.severity === 'warning').length,
    });
    this.lastDraftWrite = result;
    if (result.ok) this.draftFailureNotified = false;
    else this.reportDraftFailure(result);
    this.workbench?.refresh();
    return result;
  }

  /** Report a draft failure once, rather than on every keystroke. */
  private reportDraftFailure(result: EditorDraftWrite): void {
    if (this.draftFailureNotified) return;
    this.draftFailureNotified = true;
    this.app.notify(`Draft not saved. ${result.error ?? 'Browser storage refused the write.'}`, 'critical');
  }

  /** Called by the workbench after every authoritative edit. */
  missionChanged(): void {
    this.refreshValidation();
    this.scheduleAutosave();
    this.workbench?.refresh();
  }

  /** Launch the real runtime on a disposable copy of the working document. */
  testLaunchMission(): void {
    const errors = this.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      this.app.notify(`Cannot test: ${errors[0].message}`, 'critical');
      return;
    }
    if (!this.scenario.mission) {
      this.app.notify('Create a mission document before testing the operation.', 'warning');
      return;
    }
    const mission = this.scenario.mission;
    openModal({
      title: `${mission.title} — Test briefing`,
      wide: true,
      body: `
        <p class="wb-warning">TEST RUN · This launches the real mission runtime on a disposable copy. No campaign progress, consequence or veteran change is committed.</p>
        ${missionBriefingMarkup(mission, { commander: this.app.missionCommander() })}`,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Deploy test',
          primary: true,
          onClick: () => {
            // The section has to be read before the panel closes: the test run
            // reopens the workbench where the author left off, not wherever a
            // freshly constructed workbench happens to default to.
            const section = this.workbench?.currentSection;
            this.workbench?.close(true);
            void this.app.startMissionTest(cloneScenario(this.scenario), section);
          },
        },
      ],
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
        (p) => `<div class="start-row"><span><i class="faction-dot" data-faction-dot="${p.id}" style="background:${tryIdentityDef(p.factionId)?.color ?? '#fff'}"></i>${escapeHtml(p.name)}${p.isAI ? ' (AI)' : ''}</span><select class="faction-select" id="ed-faction-${p.id}" aria-label="Nation for ${escapeHtml(p.name)}">${this.factionOptions(p.factionId)}</select><b id="ed-start-${p.id}">${p.startX}, ${p.startZ}</b></div>`,
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
        <label class="form-row"><span>Weather</span><select id="ed-weather">${WEATHER_KINDS.map((w) => `<option value="${w}" ${s.settings.weather === w ? 'selected' : ''}>${WEATHER[w].label}</option>`).join('')}</select></label>
        <label class="form-row"><span>Start hour</span><input type="range" id="ed-tod" min="0" max="23.5" step="0.5" value="${s.settings.startHour}"><b id="ed-tod-label">${escapeHtml(`${formatHour(s.settings.startHour)} · ${PHASE_LABELS[phaseAtHour(s.settings.startHour)]}`)}</b></label>
        <label class="form-row"><span>Day cycle</span><select id="ed-daylen">${this.dayLengthOptions(s.settings.dayLengthMinutes)}</select></label>
        <label class="form-row"><span>Fog</span><select id="ed-fog"><option value="1" ${s.settings.fog ? 'selected' : ''}>Enabled</option><option value="0" ${!s.settings.fog ? 'selected' : ''}>Disabled</option></select></label>
      </div>
      <p class="tool-note" id="ed-sky-note">${escapeHtml(this.skyNote())}</p>
      <div class="inspector-section"><h4>PLAYER STARTS</h4>${players || '<p class="tool-note">No players defined.</p>'}</div>
      <div class="inspector-section"><h4>MAP SUMMARY</h4><div id="ed-summary"></div></div>
      <div class="inspector-section"><h4>VALIDATION <span id="ed-issue-count"></span></h4><div class="validation-list" id="ed-validation"></div></div>`;
    this.bindInspector();
    this.renderSummary();
  }

  /**
   * Day-cycle presets, plus whatever the scenario already holds so opening an
   * older map never silently rewrites its clock.
   */
  private dayLengthOptions(current: number): string {
    const presets = [
      { value: 0, label: 'Frozen at start hour' },
      { value: 30, label: '30 min per day (fast)' },
      { value: 60, label: '60 min per day' },
      { value: 120, label: '120 min per day' },
      { value: DEFAULT_DAY_LENGTH_MINUTES, label: `${DEFAULT_DAY_LENGTH_MINUTES} min per day (standard)` },
    ];
    if (!presets.some((preset) => preset.value === current)) {
      presets.push({ value: current, label: `${Math.round(current)} min per day` });
    }
    return presets
      .sort((a, b) => a.value - b.value)
      .map(
        (preset) =>
          `<option value="${preset.value}" ${preset.value === current ? 'selected' : ''}>${escapeHtml(preset.label)}</option>`,
      )
      .join('');
  }

  /**
   * One line describing the sky the author has chosen: the same numbers the
   * simulation and the renderer read, so the forge cannot show a different
   * battlefield from the one it is about to save.
   */
  private skyNote(): string {
    const s = this.scenario.settings;
    const profile = weatherFor(s.weather);
    const phase = PHASE_LABELS[phaseAtHour(s.startHour)];
    const clock =
      s.dayLengthMinutes > 0
        ? `${Math.round(s.dayLengthMinutes)} min per day`
        : 'clock frozen';
    return `${formatHour(s.startHour)} ${phase} · ${profile.label} — ${profile.hint} (${clock})`;
  }

  /**
   * Nation and legacy-preset options for a player slot, grouped by alliance.
   * The current value is always present, even for a legacy preset, so editing
   * an old scenario cannot silently rewrite its identity.
   */
  private factionOptions(current: string): string {
    const groups = ALLIANCE_LIST.map((alliance) => {
      const nations = NATION_LIST.filter((nation) => nation.allianceId === alliance.id);
      if (nations.length === 0) return '';
      const options = nations
        .map(
          (nation) =>
            `<option value="${nation.id}" ${nation.id === current ? 'selected' : ''}>${escapeHtml(nation.name)}</option>`,
        )
        .join('');
      return `<optgroup label="${escapeHtml(alliance.name.toUpperCase())}">${options}</optgroup>`;
    }).join('');
    const presets = Object.values(FACTIONS)
      .map(
        (preset) =>
          `<option value="${preset.id}" ${preset.id === current ? 'selected' : ''}>${escapeHtml(preset.name)} (preset)</option>`,
      )
      .join('');
    return `${groups}<optgroup label="LEGACY PRESETS">${presets}</optgroup>`;
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
      this.scenario.settings.weather = weatherFor(v).kind;
      const note = this.root?.querySelector('#ed-sky-note');
      if (note) note.textContent = this.skyNote();
    });
    // The authored hour is the authoritative time; the legacy phase label is
    // derived from it so a saved file never carries two disagreeing clocks.
    const tod = this.root.querySelector<HTMLInputElement>('#ed-tod');
    const applyHour = (raw: string) => {
      const hour = normaliseStartHour(Number(raw), this.scenario.settings.startHour);
      this.scenario.settings.startHour = hour;
      this.scenario.settings.timeOfDay = phaseForStartHour(hour);
      const label = this.root?.querySelector('#ed-tod-label');
      if (label) label.textContent = `${formatHour(hour)} · ${PHASE_LABELS[phaseAtHour(hour)]}`;
      const note = this.root?.querySelector('#ed-sky-note');
      if (note) note.textContent = this.skyNote();
    };
    // Sliding previews live, releasing commits the edit.
    tod?.addEventListener('input', () => applyHour(tod.value));
    tod?.addEventListener('change', () => {
      applyHour(tod.value);
      this.refreshValidation();
      this.scheduleAutosave();
    });
    bind('ed-daylen', (v) => {
      this.scenario.settings.dayLengthMinutes = Math.max(0, Number(v) || 0);
      const note = this.root?.querySelector('#ed-sky-note');
      if (note) note.textContent = this.skyNote();
    });
    bind('ed-fog', (v) => (this.scenario.settings.fog = v === '1'));
    // Nation identity is per player slot and registry-driven; saving the file
    // writes the same id the editor shows.
    for (const player of this.scenario.players) {
      bind(`ed-faction-${player.id}`, (value) => {
        const identity = tryIdentityDef(value);
        if (!identity) return;
        player.factionId = identity.id;
        const dot = this.root?.querySelector<HTMLElement>(`[data-faction-dot="${player.id}"]`);
        if (dot) dot.style.background = identity.color;
      });
    }
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
    this.prunePropSelection();
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
    // Mission-authoring modes own the left button completely: no brush stroke,
    // placement or erase can run while a rectangle is being drawn or an entity
    // is being picked.
    if (this.entityPick) {
      this.resolveEntityPick(event.clientX, event.clientY);
      return;
    }
    if (this.regionTool !== 'off') {
      this.beginRegionGesture(event);
      return;
    }
    if (this.tool === 'propSelect') {
      this.updateHover(event.clientX, event.clientY);
      if (!this.hover) return;
      this.propMarquee = {
        x0: this.hover.x,
        z0: this.hover.z,
        x1: this.hover.x,
        z1: this.hover.z,
      };
      this.propMarqueeAdditive = event.shiftKey;
      this.painting = true;
      return;
    }
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
    if (this.regionDrag) {
      this.updateRegionGesture(event.clientX, event.clientY);
      return;
    }
    if (this.propMarquee && this.hover) {
      this.propMarquee = {
        ...this.propMarquee,
        x1: this.hover.x,
        z1: this.hover.z,
      };
      this.draw();
      return;
    }
    if (this.painting && this.strokesOnDrag()) {
      this.paintAtScreen(event.clientX, event.clientY);
    }
  };

  /**
   * Whether the active tool keeps working while the pointer is held down.
   *
   * Every tile tool paints tile by tile, so a stroke has to re-stamp under the
   * moving cursor; without a tool in this list a drag does nothing and the
   * author is reduced to clicking once per tile. Placement tools are excluded
   * on purpose: dragging a building or a unit across the map would carpet the
   * ground with copies.
   */
  private strokesOnDrag(): boolean {
    return this.tool === 'paint'
      || this.tool === 'raise'
      || this.tool === 'lower'
      || this.tool === 'ore'
      || this.tool === 'erase'
      || this.tool === 'overlay'
      || this.tool === 'overlayClear';
  }

  private onPointerUp = (): void => {
    this.painting = false;
    this.pan = null;
    if (this.propMarquee) {
      const box = propBox(
        this.propMarquee.x0,
        this.propMarquee.z0,
        this.propMarquee.x1,
        this.propMarquee.z1,
      );
      this.applyPropSelection(box, this.propMarqueeAdditive);
      this.propMarquee = null;
      this.draw();
      return;
    }
    if (this.regionDrag) {
      this.commitRegionGesture();
      return;
    }
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
    window.addEventListener('keydown', this.onKeyDown);
  }

  private detachCanvas(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown);
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
        // Every symmetric twin has to be checked the same way as the placement
        // itself: a wall, a coastline or a standing building on the far side
        // would leave the map one-sided, which is the thing the mode exists to
        // prevent. One bad twin refuses the whole stroke.
        const copies = symmetryRects(
          this.symmetry,
          this.scenario.width,
          this.scenario.height,
          tx,
          tz,
          bdef.footprint.w,
          bdef.footprint.h,
        );
        this.markFootprint(occupied, tx, tz, bdef.footprint.w, bdef.footprint.h);
        const accepted: ScenarioStructure[] = [];
        for (const rect of copies) {
          const twin = checkPlacement(this.scenario, this.structureDef, rect.x, rect.z, occupied);
          if (!twin.ok) {
            this.app.notify(`Symmetric site blocked: ${twin.reason}`, 'warning');
            this.app.audio.play('denied');
            return;
          }
          const twinOwner = symmetryOwner(
            this.symmetry,
            this.owner,
            this.scenario.players.length,
            rect.x,
            rect.z,
            this.scenario.width,
            this.scenario.height,
          );
          const copy: ScenarioStructure = { defId: this.structureDef, owner: twinOwner, x: rect.x, z: rect.z };
          if (bdef.requiresWater) copy.facing = waterFacingFor(this.scenario, copy);
          accepted.push(copy);
          this.markFootprint(occupied, rect.x, rect.z, rect.w, rect.h);
        }
        // A yard turned toward its harbour while authoring keeps the gate, the
        // berth and the preview pointing the same way in battle.
        const placed: ScenarioStructure = { defId: this.structureDef, owner: this.owner, x: tx, z: tz };
        if (bdef.requiresWater) placed.facing = waterFacingFor(this.scenario, placed);
        this.scenario.structures.push(placed, ...accepted);
        // A mission cannot refer to a placement without a key. Keying happens
        // only for mission-aware scenarios, so an ordinary skirmish map's
        // authored data stays exactly as it was written.
        if (this.scenario.mission) {
          ensureEntityKey(this.scenario, placed);
          for (const twin of accepted) ensureEntityKey(this.scenario, twin);
        }
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
        const slots = [
          { x: this.hover.x, z: this.hover.z },
          ...symmetryTiles(
            this.symmetry,
            this.scenario.width,
            this.scenario.height,
            this.hover.x,
            this.hover.z,
          ),
        ];
        const twins = [];
        for (const slot of slots) {
          if (!inBounds(this.scenario.width, this.scenario.height, slot.x, slot.z)) {
            this.app.notify('A symmetric deployment would fall outside the map.', 'warning');
            this.app.audio.play('denied');
            return;
          }
          if (!canStandOn(this.scenario.width, this.scenario.height, terrainArr, tileIndex(this.scenario.width, slot.x, slot.z), udef.moveClass)) {
            this.app.notify(`${udef.name} cannot start on this terrain.`, 'warning');
            this.app.audio.play('denied');
            return;
          }
          if (this.structureAt(slot.x, slot.z)) {
            this.app.notify('A structure occupies a symmetric deployment tile.', 'warning');
            this.app.audio.play('denied');
            return;
          }
          twins.push(slot);
        }
        for (const slot of twins) {
          const owner = symmetryOwner(
            this.symmetry,
            this.owner,
            this.scenario.players.length,
            slot.x,
            slot.z,
            this.scenario.width,
            this.scenario.height,
          );
          const unit = { defId: this.unitDef, owner, x: slot.x, z: slot.z };
          this.scenario.units.push(unit);
          if (this.scenario.mission) ensureEntityKey(this.scenario, unit);
        }
      }
      this.app.audio.play('build');
      this.refreshValidation();
      return;
    }
    if (this.tool === 'propPick') {
      const picked = propAt(this.scenario.props ?? [], this.hover.x, this.hover.z);
      if (!picked) {
        this.app.notify('No authored prop stands on that tile.', 'info');
        return;
      }
      this.adoptPropSettings(picked);
      return;
    }
    if (this.tool === 'prop') {
      this.placeProp(this.hover.x, this.hover.z);
      return;
    }
    if (this.tool === 'start') {
      const player = this.scenario.players.find((p) => p.id === this.startPlayerId);
      if (player) {
        player.startX = this.hover.x;
        player.startZ = this.hover.z;
        // Deployment markers follow the symmetry too, so a mirrored or rotated
        // map cannot be left with the two commanders starting unequal ground.
        for (const other of this.scenario.players) {
          if (other.id === player.id) continue;
          const point = symmetryStart(
            this.symmetry,
            other.id,
            this.scenario.players.length,
            this.hover.x,
            this.hover.z,
            this.scenario.width,
            this.scenario.height,
          );
          other.startX = point.x;
          other.startZ = point.z;
        }
        for (const p of this.scenario.players) {
          const label = this.root?.querySelector(`#ed-start-${p.id}`);
          if (label) label.textContent = `${p.startX}, ${p.startZ}`;
        }
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
        if (this.applyTileTool(x, z)) changed = true;
        // The same stroke lands on every symmetric twin. Tiles are pure
        // geometry, so the mode applies to terrain, elevation, deposits and
        // erasure alike.
        for (const twin of symmetryTiles(this.symmetry, this.scenario.width, this.scenario.height, x, z)) {
          if (!inBounds(this.scenario.width, this.scenario.height, twin.x, twin.z)) continue;
          if (this.applyTileTool(twin.x, twin.z)) changed = true;
        }
      }
    }
    if (changed) {
      if (this.tool === 'paint') this.reorientWaterStructures();
      this.terrainDirty = true;
      const status = this.root?.querySelector('#ed-status');
      if (status) status.textContent = `${this.hoverInfo()} · painting`;
      if (performance.now() - this.lastTerrainRefresh > 140) this.refreshTerrain(false);
    }
  }

  /**
   * Keep authored slipways aimed at the sea when the coastline moves under
   * them. There is no rotate tool, so a yard's facing is always derived from
   * the tiles around its footprint rather than authored by hand.
   */
  private reorientWaterStructures(): void {
    for (const s of this.scenario.structures) {
      if (!BUILDINGS[s.defId]?.requiresWater) continue;
      const facing = waterFacingFor(this.scenario, s);
      if (s.facing !== facing) s.facing = facing;
    }
  }

  /** One tile's worth of the active brush. Returns whether anything changed. */
  private applyTileTool(x: number, z: number): boolean {
    const tile = this.scenario.tiles[tileIndex(this.scenario.width, x, z)];
    if (this.tool === 'paint') {
      tile.t = this.terrain;
      if (this.terrain === Terrain.DeepWater || this.terrain === Terrain.ShallowWater) {
        tile.e = 0;
        tile.o = 0;
      } else if (!TERRAIN[this.terrain].oreAllowed) {
        tile.o = 0;
      }
      // Repainting the ground under a layer that the new ground cannot hold
      // drops the layer rather than leaving "crops on deep water" behind.
      if ((tile.v ?? 0) > 0 && !overlayAllowedOn(tile.v ?? 0, tile.t)) tile.v = undefined;
      return true;
    }
    if (this.tool === 'overlay') {
      const packed = packOverlay(this.overlayId, this.overlayDensity);
      if (!overlayAllowedOn(packed, tile.t)) return false;
      if ((tile.v ?? 0) === packed) return false;
      tile.v = packed;
      return true;
    }
    if (this.tool === 'overlayClear') {
      if ((tile.v ?? 0) === 0) return false;
      tile.v = undefined;
      return true;
    }
    if (this.tool === 'raise' || this.tool === 'lower') {
      if (tile.t === Terrain.DeepWater || tile.t === Terrain.ShallowWater) return false;
      const delta = this.tool === 'raise' ? 1 : -1;
      tile.e = Math.max(0, Math.min(MAX_ELEVATION, tile.e + delta));
      return true;
    }
    if (this.tool === 'ore') {
      if (!TERRAIN[tile.t as TerrainId]?.oreAllowed) return false;
      tile.o = 300;
      return true;
    }
    if (this.tool === 'erase') {
      if (this.eraseEntityAt(x, z)) return true;
      if ((tile.v ?? 0) > 0) {
        tile.v = undefined;
        return true;
      }
      return tile.o > 0;
    }
    return false;
  }

  /** Whether a structure footprint covers this tile. */
  private structureAt(x: number, z: number): boolean {
    return this.scenario.structures.some((s) => {
      const def = BUILDINGS[s.defId];
      if (!def) return false;
      return x >= s.x && x < s.x + def.footprint.w && z >= s.z && z < s.z + def.footprint.h;
    });
  }

  private markFootprint(mask: Uint8Array, x: number, z: number, w: number, h: number): void {
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) {
        if (!inBounds(this.scenario.width, this.scenario.height, x + dx, z + dz)) continue;
        mask[tileIndex(this.scenario.width, x + dx, z + dz)] = 1;
      }
    }
  }

  /**
   * Stamp one authored prop, repeated by the authoring symmetry.
   *
   * Placement is refused on a structure's ground: the scatter pass clears props
   * off every footprint, so a prop authored there would never be drawn and the
   * author would be left wondering where it went. A prop is decoration, so the
   * terrain itself is never a reason to refuse — the validator warns about water
   * instead of blocking the click.
   */
  private placeProp(x: number, z: number): void {
    const def = PROPS[this.propKind];
    if (!def) return;
    const targets = [
      { x, z },
      ...symmetryTiles(this.symmetry, this.scenario.width, this.scenario.height, x, z),
    ];
    for (const target of targets) {
      if (!inBounds(this.scenario.width, this.scenario.height, target.x, target.z)) {
        this.app.notify('A symmetric prop would fall outside the map.', 'warning');
        this.app.audio.play('denied');
        return;
      }
      if (this.structureAt(target.x, target.z)) {
        this.app.notify(`${def.name} cannot stand on a structure's ground.`, 'warning');
        this.app.audio.play('denied');
        return;
      }
    }
    const props = (this.scenario.props ??= []);
    const radians = (this.propRotation * Math.PI) / 180;
    for (const target of targets) {
      props.push({
        kind: this.propKind,
        x: target.x,
        z: target.z,
        ...(radians === 0 ? {} : { rotation: radians }),
        ...(this.propScale === 1 ? {} : { scale: this.propScale }),
      });
    }
    this.app.audio.play('build');
    this.refreshValidation();
    this.propsDirty = true;
  }

  /**
   * Adopt a placed prop's kind, yaw and scale, and arm the placement tool with
   * them.
   *
   * This is the eyedropper's whole job: a lamp at an awkward angle becomes the
   * next lamp without touching three controls. The round trip goes through the
   * Forge's own units (degrees, tenths), so the sliders show exactly what the
   * next click will stamp.
   */
  adoptPropSettings(prop: ScenarioProp): void {
    const settings = propSettings(prop);
    this.propKind = settings.kind;
    this.propRotation = settings.rotation;
    this.propScale = settings.scale;
    this.tool = 'prop';
    this.panMode = false;
    this.syncPanButton();
    this.renderTools();
    this.closeTools();
    this.app.notify(
      `Adopted ${PROPS[settings.kind].name} · ${settings.rotation}° · ${settings.scale.toFixed(1)}×`,
      'info',
    );
    this.setHint();
  }

  /** Tiles a duplicate may not land on: every prop and every paved footprint. */
  private occupiedPropTiles(): Set<string> {
    const taken = propTiles(this.scenario.props ?? []);
    for (const structure of this.scenario.structures) {
      const def = BUILDINGS[structure.defId];
      if (!def) continue;
      for (let dz = 0; dz < def.footprint.h; dz++) {
        for (let dx = 0; dx < def.footprint.w; dx++) {
          taken.add(`${structure.x + dx},${structure.z + dz}`);
        }
      }
    }
    return taken;
  }

  /** Turn a marquee into a selection, or toggle it into the existing one. */
  private applyPropSelection(box: TileBox, additive: boolean): void {
    const hits = propsInBox(this.scenario.props ?? [], box);
    if (!additive) {
      this.propSelection = hits;
      if (hits.length === 0) this.app.notify('No authored props in that box.', 'info');
    } else {
      const chosen = new Set(this.propSelection);
      for (const hit of hits) {
        if (chosen.has(hit)) chosen.delete(hit);
        else chosen.add(hit);
      }
      this.propSelection = [...chosen];
    }
    this.renderTools();
    this.setHint();
  }

  /** Copy the selection one tile down and right, keeping every setting. */
  duplicateSelectedProps(): void {
    if (this.propSelection.length === 0) {
      this.app.notify('Select a prop first.', 'info');
      return;
    }
    const props = (this.scenario.props ??= []);
    const copies = duplicateProps(this.propSelection, {
      width: this.scenario.width,
      height: this.scenario.height,
      occupied: this.occupiedPropTiles(),
    });
    if (copies.length === 0) {
      this.app.notify('No room to duplicate that selection.', 'warning');
      this.app.audio.play('denied');
      return;
    }
    props.push(...copies);
    this.propSelection = copies;
    this.app.audio.play('build');
    this.propsDirty = true;
    this.refreshValidation();
    this.setHint();
  }

  /**
   * Re-stamp every selected prop through a pure transform.
   *
   * The selection holds props by identity, so the scenario's entry is replaced
   * rather than mutated and the selection is rebuilt around the new objects. A
   * stale reference would leave the marquee highlighting props that are gone.
   */
  private transformSelectedProps(change: (prop: ScenarioProp) => ScenarioProp): void {
    const props = this.scenario.props ?? [];
    this.propSelection = this.propSelection.map((prop) => {
      const next = change(prop);
      const index = props.indexOf(prop);
      if (index >= 0) props[index] = next;
      return next;
    });
    this.propsDirty = true;
    this.refreshValidation();
    this.setHint();
  }

  /** Turn the selection one compass step: eight directions, no arbitrary yaw. */
  rotateSelectedProps(direction: 1 | -1): void {
    if (this.propSelection.length === 0) return;
    this.transformSelectedProps((prop) => rotateProp(prop, direction));
  }

  /** Move the selection by whole eighths of a tile, never out of its tiles. */
  nudgeSelectedProps(dx: number, dz: number): void {
    if (this.propSelection.length === 0) return;
    this.transformSelectedProps((prop) => nudgeProp(prop, dx, dz));
  }

  /** Put the selection back in the middle of the tiles it stands on. */
  centreSelectedProps(): void {
    if (this.propSelection.length === 0) return;
    this.transformSelectedProps((prop) => centreProp(prop));
  }

  /** Remove every prop the marquee caught. */
  deleteSelectedProps(): void {
    if (this.propSelection.length === 0) {
      this.app.notify('Select a prop first.', 'info');
      return;
    }
    const removed = this.propSelection.length;
    this.scenario.props = deleteProps(this.scenario.props ?? [], this.propSelection);
    this.propSelection = [];
    this.propsDirty = true;
    this.refreshValidation();
    this.app.notify(`Removed ${removed} authored prop${removed === 1 ? '' : 's'}.`, 'info');
    this.setHint();
  }

  /** Drop selected props that a delete, an undo or a reload has already removed. */
  private prunePropSelection(): void {
    if (this.propSelection.length === 0) return;
    this.propSelection = pruneSelection(this.scenario.props ?? [], this.propSelection);
  }

  private eraseEntityAt(x: number, z: number): boolean {
    const structureIndex = this.scenario.structures.findIndex((s) => {
      const bdef = BUILDINGS[s.defId];
      return bdef && x >= s.x && x < s.x + bdef.footprint.w && z >= s.z && z < s.z + bdef.footprint.h;
    });
    if (structureIndex >= 0) {
      this.scenario.structures.splice(structureIndex, 1);
      // The scatter a footprint was hiding comes back with the structure gone.
      this.propsDirty = true;
      return true;
    }
    const unitIndex = this.scenario.units.findIndex((u) => u.x === x && u.z === z);
    if (unitIndex >= 0) {
      this.scenario.units.splice(unitIndex, 1);
      return true;
    }
    const props = this.scenario.props;
    if (props && props.length > 0) {
      const propIndex = props.findIndex((entry) => entry.x === x && entry.z === z);
      if (propIndex >= 0) {
        props.splice(propIndex, 1);
        this.propsDirty = true;
        return true;
      }
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
              const draft = this.draftState();
              if (!draft.present) {
                this.app.notify('No editor autosave exists yet.', 'warning');
                return;
              }
              if (!draft.scenario) {
                this.app.notify(draft.error ?? 'Autosave could not be restored.', 'critical');
                return;
              }
              this.load(draft.scenario);
              this.app.notify(
                draft.meta
                  ? `Editor autosave restored from ${new Date(draft.meta.savedAt).toLocaleString()}.`
                  : 'Editor autosave restored.',
                'success',
              );
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
      const stored = this.storeDraft();
      this.app.notify(
        stored.ok
          ? 'Scenario downloaded and stored in the browser draft.'
          : `Scenario downloaded. The browser draft was not updated: ${stored.error ?? 'storage refused the write.'}`,
        stored.ok ? 'success' : 'warning',
      );
    } catch (error) {
      this.app.notify(`Save failed: ${error instanceof Error ? error.message : String(error)}`, 'critical');
    }
  }

  private scheduleAutosave(): void {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      this.storeDraft();
    }, 1800);
  }

  private launch(): void {
    const errors = this.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      this.app.notify(`Cannot deploy: ${errors[0].message}`, 'critical');
      this.app.audio.play('denied');
      this.setTab('mission');
      return;
    }
    this.app.launchEditorScenario(cloneScenario(this.scenario));
  }

  /** Key a freshly placed entity when this scenario carries a mission. */
  private keyIfMission(entry: ScenarioStructure | ScenarioUnit): void {
    if (!this.scenario.mission) return;
    ensureEntityKey(this.scenario, entry);
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
            const post: ScenarioStructure = { defId: 'commandPost', owner: p.id, x: tx, z: tz };
            this.scenario.structures.push(post);
            this.keyIfMission(post);
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
          const relay: ScenarioStructure = { defId: 'relay', owner: -1, x: tx, z: tz };
          this.scenario.structures.push(relay);
          this.keyIfMission(relay);
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
          const unit: ScenarioUnit = { defId: i === 0 ? 'engineer' : 'rifle', owner: p.id, x, z };
          this.scenario.units.push(unit);
          this.keyIfMission(unit);
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
    // A placed, duplicated or erased prop only exists in the scenario until the
    // instanced batches are rebuilt, so without this the author sees the ring
    // and not the piece.
    if (this.propsDirty) {
      this.propsDirty = false;
      this.app.renderer.restageProps();
    }
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

  /** Mode tag appended to every tool hint while symmetry is doing something. */
  private symmetryTag(): string {
    if (this.symmetry === 'single') return '';
    const label = SYMMETRY_MODES.find((mode) => mode.id === this.symmetry)?.label ?? '';
    return ` · ${label}`;
  }

  toolHint(): string {
    if (this.entityPick) {
      return 'PICK AUTHORED ENTITY · click a keyed placement · empty ground cancels · Esc cancels';
    }
    if (this.regionTool === 'draw') {
      return 'DRAW REGION · drag anywhere to create · drag inside the selected region to move it · drag a grip to resize · Esc cancels';
    }
    if (this.regionTool === 'select') {
      return 'SELECT REGION · click to select · drag to move · grips resize · Esc leaves the tool';
    }
    switch (this.tool) {
      case 'paint':
        return `PAINT ${TERRAIN[this.terrain].name.toUpperCase()} · brush ${this.brush * 2 + 1}${this.symmetryTag()} · L-drag paint · R-drag pan`;
      case 'raise':
        return 'RAISE ELEVATION · L-drag to add a level · right-drag pan';
      case 'lower':
        return 'LOWER ELEVATION · L-drag to remove a level · right-drag pan';
      case 'ore':
        return 'MATERIAL DEPOSIT · paint ore on buildable land · right-drag pan';
      case 'erase':
        return 'ERASE · remove unit/structure, then surface layer, then ore · right-drag pan';
      case 'overlay':
        return `PAINT ${OVERLAYS[this.overlayId].name.toUpperCase()} ${this.overlayDensity} · brush ${this.brush * 2 + 1}${this.symmetryTag()} · ground underneath is preserved · right-drag pan`;
      case 'overlayClear':
        return 'CLEAR SURFACE LAYER · strips crops/reeds/mud, ground untouched · right-drag pan';
      case 'prop':
        return `PLACE ${PROPS[this.propKind].name.toUpperCase()} · rotate ${this.propRotation}° · scale ${this.propScale.toFixed(1)}×${this.symmetryTag()} · click to place · ERASE removes`;
      case 'propPick':
        return 'EYEDROPPER · click an authored prop to adopt its kind, rotation and scale · right-drag pan';
      case 'propSelect':
        return `SELECT PROPS · drag a box or click a prop · shift adds or removes · ${this.propSelection.length} selected · DUPLICATE/DELETE in the panel`;
      case 'start':
        return `PLAYER START · click to reposition ${escapeHtml(this.scenario.players.find((p) => p.id === this.startPlayerId)?.name ?? 'player')}`;
      case 'structure': {
        const def = BUILDINGS[this.structureDef];
        return `PLACE ${def?.name.toUpperCase() ?? 'STRUCTURE'} · owner ${this.owner}${this.symmetryTag()}${this.structureNote(this.structureDef)} · shipyards need navigable coast`;
      }
      case 'unit':
        return `PLACE ${unitPaletteName(this.unitDef).toUpperCase()} · owner ${this.owner}${this.symmetryTag()} · check terrain and structures`;
      default:
        return '';
    }
  }

  private activeToolLabel(): string {
    switch (this.tool) {
      case 'paint':
        return `PAINT ${TERRAIN[this.terrain].name.toUpperCase()}`;
      case 'overlay':
        return `SURFACE ${OVERLAYS[this.overlayId].name.toUpperCase()} ${this.overlayDensity}`;
      case 'overlayClear':
        return 'CLEAR SURFACE LAYER';
      case 'structure':
        return `PLACE ${BUILDINGS[this.structureDef]?.name.toUpperCase() ?? 'STRUCTURE'}${this.structureNote(this.structureDef)}`;
      case 'unit':
        return `PLACE ${unitPaletteName(this.unitDef).toUpperCase()}`;
      case 'prop':
        return `PLACE ${PROPS[this.propKind].name.toUpperCase()}`;
      case 'propPick':
        return 'EYEDROPPER';
      case 'propSelect':
        return `SELECT PROPS (${this.propSelection.length})`;
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

