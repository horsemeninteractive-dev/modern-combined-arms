import type { App } from '../app';
import type { Game } from '../sim/game';
import type { Entity, VictoryState } from '../sim/types';
import { BUILDINGS, BUILDABLE_BY_PLAYER, isIndestructibleStructure } from '../data/buildings';
import { UNITS } from '../data/units';
import { FACTIONS } from '../data/factions';
import { TERRAIN, Terrain, tileIndex, type TerrainId } from '../sim/terrain';
import { TILE_SIZE } from '../sim/constants';
import { icon, iconSvg } from './icons';
import { escapeHtml } from './modal';
import {
  PRODUCTION_TABS,
  edgeAutoScrollVelocity,
  gridAlertCopy,
  minimapBackingSize,
  minimapStatus,
  productionCardState,
  productionDomain,
  resolveHudLayout,
  structureTab,
  toggleHudPanel,
  type HudLayout,
  type HudPanel,
  type ProductionTab,
} from './hudLayout';
import { ThumbnailRenderer } from '../render/thumbnails';
import type { ThumbnailKind, ThumbnailRequest, ThumbnailShape } from '../render/thumbnailFrame';
import { objectiveMeterState } from './relayMeter';
import { structureBenefit } from '../sim/infrastructure';

const DOMAIN_LABEL: Record<string, string> = { land: 'LAND', air: 'AIR', naval: 'SEA' };

interface QueueDragState {
  pointerId: number;
  buildingId: number;
  defId: string;
  name: string;
  count: number;
  card: HTMLElement;
  startX: number;
  startY: number;
  /** Latest viewport position; auto-scroll moves the sheet under this point. */
  pointerX: number;
  pointerY: number;
  active: boolean;
  fromGrip: boolean;
  target: HTMLElement | null;
  ghost: HTMLElement | null;
}

/** Pointer distance from a sheet edge that starts auto-scrolling. */
const QUEUE_EDGE_SCROLL_ZONE = 48;
/** Maximum sheet scroll speed while dragging, in CSS pixels per second. */
const QUEUE_EDGE_SCROLL_SPEED = 900;
/** The pointer may drift this far outside the sheet horizontally and still scroll. */
const QUEUE_EDGE_SCROLL_MARGIN = 28;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function fmtTime(tick: number): string {
  const total = Math.floor(tick / 20);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function hpClass(frac: number): string {
  if (frac < 0.3) return 'low';
  if (frac < 0.6) return 'mid';
  return '';
}

function stateLabel(e: Entity): string {
  if (e.construction) return `CONSTRUCTING ${Math.round(e.buildProgress * 100)}%`;
  if (e.garrisonId) return 'GARRISONED';
  if (e.kind === 'building') {
    if (e.queue.length > 0) return 'PRODUCING';
    return 'OPERATIONAL';
  }
  if (e.aircraft) {
    if (e.aircraft.landed) return e.aircraft.serviceTimer > 0 ? 'REARMING' : 'GROUNDED';
    if (e.aircraft.returningHome) return 'RETURNING TO BASE';
    return e.state === 'attacking' ? 'ENGAGING' : 'AIRBORNE';
  }
  if (e.harvester) {
    if (e.state === 'harvesting') return 'MINING';
    if (e.state === 'delivering') return 'DELIVERING';
    return 'HARVESTING';
  }
  return e.state.toUpperCase().replace(/_/g, ' ');
}

function ownerColor(game: Game, e: Entity): string {
  if (e.owner === -1) return '#8d9d98';
  const p = game.player(e.owner);
  return p ? FACTIONS[p.factionId]?.color ?? '#d8e2dd' : '#d8e2dd';
}

export class HUD {
  private app: App;
  private root: HTMLElement | null = null;
  private game: Game | null = null;
  private tab: ProductionTab = 'base';
  private lastUpdate = 0;
  private lastMinimap = 0;
  private lastProductionKey = '';
  private logs: Array<{ text: string; level: string; tick: number }> = [];
  private endShown = false;
  private minimapDragging = false;
  private minimapFrame = 0;
  /** Native-resolution terrain buffer, upscaled to the dock's device pixels. */
  private minimapTerrain: HTMLCanvasElement | null = null;
  /** Low-resolution noise buffer for the dead radar feed. */
  private radarNoise: HTMLCanvasElement | null = null;
  /** Pointer drag state for cameo priority reordering. */
  private queueDrag: QueueDragState | null = null;
  private queueScrollFrame = 0;
  private queueScrollLast = 0;
  private suppressQueueClickUntil = 0;
  private pausedCache: boolean | null = null;
  private modeCache = '';
  private layout: HudLayout = 'desktop';
  private panel: HudPanel = 'none';
  private hudEl: HTMLElement | null = null;
  private thumbnails: ThumbnailRenderer | null | undefined;
  /** Roster chip chosen for the detail card; cleared when it leaves the selection. */
  private inspectedId = 0;

  constructor(app: App) {
    this.app = app;
    // Pay the offscreen-context and shader setup cost while the menu is open,
    // not inside the first battle's mount.
    this.thumbnailRenderer();
  }

  mount(game: Game): void {
    this.game = game;
    this.logs = [];
    this.endShown = false;
    this.tab = 'base';
    this.inspectedId = 0;
    this.panel = 'none';
    this.app.additiveSelection = false;
    this.lastProductionKey = '';
    this.suppressQueueClickUntil = 0;
    this.pausedCache = null;
    this.modeCache = '';
    const root = document.getElementById('hud-root');
    if (!root) return;
    this.root = root;
    this.layout = this.detectLayout();
    this.warmBattleArt();
    this.renderShell();
  }

  unmount(): void {
    this.finishQueueDrag();
    if (this.root) this.root.innerHTML = '';
    this.root = null;
    this.hudEl = null;
    this.game = null;
    this.endShown = false;
  }

  /** Rebuild the active composition when the viewport crosses the layout point. */
  refreshLayout(): boolean {
    const next = this.detectLayout();
    if (next === this.layout && this.root) return false;
    this.layout = next;
    this.panel = 'none';
    this.app.additiveSelection = false;
    if (this.root && this.game) this.renderShell();
    return true;
  }

  private detectLayout(): HudLayout {
    const coarse = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
    return resolveHudLayout(window.innerWidth, window.innerHeight, coarse);
  }

  private renderShell(): void {
    const root = this.root;
    const game = this.game;
    if (!root || !game) return;
    root.innerHTML = this.markup(game);
    this.hudEl = root.querySelector<HTMLElement>('.hud');
    this.bind();
    this.syncPanelState();
    this.renderResources();
    this.renderSelection(true);
    this.renderProduction(true);
    this.renderObjective();
    this.renderGroups();
    this.renderAddMode();
    this.updateMode(true);
    this.drawMinimap();
    this.lastProductionKey = '';
  }

  private markup(game: Game): string {
    return this.layout === 'desktop' ? this.desktopMarkup(game) : this.mobileMarkup(game);
  }

  /**
   * Desktop chrome is a full-height rail on the far left: landscape screens have
   * width to spare and almost none to lose. Resources, army size, objective,
   * control-group slots, mission time and the menu actions all live here, so the
   * battlefield keeps the full height between the rail and the production sidebar.
   */
  private railMarkup(game: Game): string {
    const p = game.player(game.localPlayerId);
    const faction = p ? FACTIONS[p.factionId] : null;
    return `
      <aside class="hud-rail" aria-label="Command rail">
        <div class="rail-brand">
          <img class="brand-mark" src="/insignia.svg" alt="" aria-hidden="true" width="30" height="30" />
          <span class="rail-theatre" title="${escapeHtml(faction?.shortName ?? 'TASK FORCE')} · Kestrel Bay">${escapeHtml(faction?.shortName ?? 'TASK FORCE')}</span>
        </div>
        <div class="rail-stats">
          <div class="rail-stat"><span class="rail-label"><i class="resource-swatch"></i>MATS</span><b id="res-mats">0</b><span class="rail-rate" id="res-mats-rate">+0/m</span></div>
          <div class="rail-stat req"><span class="rail-label"><i class="resource-swatch blue"></i>REQ</span><b id="res-req">0</b><span class="rail-rate" id="res-req-rate">+0.0/s</span></div>
          <div class="rail-stat power" id="rail-power" title="Grid power — structures draw on the grid; a deficit browns out production"><span class="rail-label">PWR</span><b id="res-power">0 / 0</b><span class="rail-rate" id="res-power-sub">BALANCED</span></div>
          <div class="rail-stat"><span class="rail-label">ARMY</span><b id="res-force">0</b><span class="rail-rate" id="res-force-sub">0 STRUCTURES</span></div>
        </div>
        <button class="rail-objective" data-act="objective" title="Primary objective — open the briefing">
          <span class="rail-label">OBJECTIVE</span>
          <b data-objective-primary>${escapeHtml(primaryObjective(game))}</b>
          <span class="objective-sub" data-objective-sub></span>
        </button>
        <div class="rail-bottom">
          <div class="rail-groups" aria-label="Control groups">${this.groupStripMarkup()}</div>
          <div class="rail-clock"><span>MISSION</span><b id="clock">0:00</b></div>
          <div class="rail-actions">
            <button class="rail-btn" data-act="save" title="Save battle" aria-label="Save battle">${icon('save')}</button>
            <button class="rail-btn" data-act="pause" id="btn-pause-top" title="Pause (P)" aria-label="Pause battle">${icon('pause')}</button>
            <button class="rail-btn" data-act="settings" title="Settings" aria-label="Settings">${icon('settings')}</button>
            <button class="rail-btn" data-act="menu" title="Menu" aria-label="Menu">${icon('menu')}</button>
          </div>
        </div>
      </aside>`;
  }

  /** Mobile keeps a thin top strip: touch screens need the vertical pixels. */
  private mobileTopbarMarkup(game: Game): string {
    return `
      <header class="mobile-topbar">
        <img class="brand-mark" src="/insignia.svg" alt="" aria-hidden="true" width="26" height="26" />
        <div class="mobile-stats">
          <div class="mobile-stat"><span>MATS</span><b id="res-mats">0</b></div>
          <div class="mobile-stat req"><span>REQ</span><b id="res-req">0</b></div>
          <div class="mobile-stat power"><span>PWR</span><b id="res-power-mobile">0/0</b></div>
          <div class="mobile-stat"><span>ARMY</span><b id="res-force">0</b></div>
        </div>
        <button class="mobile-objective" data-act="objective" title="Primary objective">
          <span class="label">PRIMARY</span>
          <b data-objective-primary>${escapeHtml(primaryObjective(game))}</b>
          <span class="objective-sub" data-objective-sub></span>
        </button>
        <div class="mobile-actions">
          <button class="mobile-action" data-act="save" title="Save battle" aria-label="Save battle">${icon('save')}</button>
          <button class="mobile-action" data-act="pause" id="btn-pause-top" title="Pause (P)" aria-label="Pause battle">${icon('pause')}</button>
          <button class="mobile-action" data-act="settings" title="Settings" aria-label="Settings">${icon('settings')}</button>
          <button class="mobile-action" data-act="menu" title="Menu" aria-label="Menu">${icon('menu')}</button>
        </div>
      </header>`;
  }

  private commandButtons(mobile: boolean): string {
    return `
      <div class="command-bar" role="toolbar" aria-label="Commands">
        <button class="cmd-btn" data-act="move" title="${mobile ? 'Move selected units — tap a destination' : 'Move selected units — click a destination'}">${icon('move')}<span class="lbl">MOVE</span></button>
        <button class="cmd-btn" data-act="attack" title="Attack target (then tap/click)">${icon('attack')}<span class="lbl">ATTACK</span></button>
        <button class="cmd-btn" data-act="attackMove" title="Attack-move (A)">${icon('attackMove')}<span class="lbl">A-MOVE</span></button>
        <div class="cmd-sep"></div>
        <button class="cmd-btn" data-act="stop" title="Stop (S)">${icon('stop')}<span class="lbl">STOP</span></button>
        <button class="cmd-btn" data-act="hold" title="Hold position (H)">${icon('hold')}<span class="lbl">HOLD POS</span></button>
        <button class="cmd-btn" data-act="capture" title="Capture a strategic objective (C)">${icon('capture')}<span class="lbl">CAPTURE</span></button>
        <button class="cmd-btn" data-act="repair" title="Repair a damaged structure (then tap/click it)">${icon('repair')}<span class="lbl">REPAIR</span></button>
        <button class="cmd-btn" data-act="garrison" title="Garrison a building (G)">${icon('garrison')}<span class="lbl">GARRISON</span></button>
        <button class="cmd-btn" data-act="ungarrison" title="Order infantry out of a building">${icon('ungarrison')}<span class="lbl">EXIT</span></button>
        <button class="cmd-btn" data-act="return" title="Return aircraft / ship to base">${icon('return')}<span class="lbl">RETURN</span></button>
        <div class="cmd-sep"></div>
        <button class="cmd-btn accent" data-act="build" title="Construction">${icon('build')}<span class="lbl">BUILD</span></button>
        <button class="cmd-btn" data-act="box" title="Box selection">${icon('box')}<span class="lbl">BOX</span></button>
        ${mobile ? `<button class="cmd-btn" data-act="groups" title="Control groups">${icon('squad')}<span class="lbl">GROUPS</span></button>
        <button class="cmd-btn" data-act="map" title="Tactical map">${icon('scope')}<span class="lbl">MAP</span></button>` : ''}
        <button class="cmd-btn" data-act="debug" title="Debug overlay (F3)">${icon('log')}<span class="lbl">DIAG</span></button>
      </div>`;
  }

  private selectionPanelMarkup(): string {
    return `<section class="selection-panel">
      <div class="panel-head"><span>SELECTION</span><span class="mono" id="sel-count">NONE</span></div>
      <div class="selection-main">
        <div class="selection-body" id="selection-body"></div>
        <div class="sel-roster" id="selection-roster" data-roster aria-label="Selected units"></div>
      </div>
    </section>`;
  }

  private groupStripMarkup(): string {
    return `<div class="group-strip" id="group-strip" role="group" aria-label="Control groups"></div>`;
  }

  private productionMarkup(): string {
    const tabs = PRODUCTION_TABS.map(({ id, label, icon: iconName }) =>
      `<button class="prod-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}" aria-label="${label}" title="${label}">${icon(iconName, 'tab-icon')}<span class="rail-label">${label}</span></button>`,
    ).join('');
    return `<aside class="production-sidebar" aria-label="Production">
      <nav class="prod-tabs" id="prod-tabs" aria-label="Production categories">
        ${tabs}
      </nav>
      <div class="sidebar-content">
        <div class="sidebar-head"><button class="sheet-close" data-act="close-sheets" aria-label="Close production">×</button></div>
        <div class="grid-alert hidden" id="grid-alert" role="status" aria-live="polite">
          <span id="grid-alert-copy"></span>
          <button class="grid-alert-btn" data-act="grid-fix" title="Select the base and site a Turbine Plant">BUILD PLANT</button>
        </div>
        <div class="prod-body" id="prod-body"></div>
      </div>
      <div class="map-dock" id="map-dock">
        <button class="sheet-close map-close" data-act="close-sheets" aria-label="Close map">×</button>
        <div class="minimap-wrap"><canvas id="minimap" aria-label="Tactical map"></canvas></div>
      </div>
    </aside>`;
  }

  private desktopMarkup(game: Game): string {
    return `<div class="hud layout-desktop">
      ${this.railMarkup(game)}
      <div class="mode-banner hidden" id="mode-banner">
        <span id="mode-text"></span>
        <button data-act="cancel-mode">CANCEL [ESC]</button>
      </div>
      ${this.productionMarkup()}
      <section class="battle-console hud-bottom">
        <div class="console-actions">${this.commandButtons(false)}</div>
        ${this.selectionPanelMarkup()}
      </section>
      <div class="debug-panel hidden" id="debug-panel"></div>
      <div class="pause-overlay hidden" id="pause-overlay">
        <div class="pause-card"><span class="eyebrow">SIMULATION HALTED</span><h2>PAUSED</h2><p>Issue orders, inspect the battlefield, then resume.</p><button class="btn btn-primary" data-act="pause">RESUME</button></div>
      </div>
      <div id="end-root"></div>
    </div>`;
  }

  private mobileMarkup(game: Game): string {
    return `<div class="hud layout-mobile">
      ${this.mobileTopbarMarkup(game)}
      <div class="mode-banner hidden" id="mode-banner">
        <span id="mode-text"></span>
        <button data-act="cancel-mode">CANCEL</button>
      </div>
      ${this.productionMarkup()}
      <button class="mobile-backdrop" data-act="close-sheets" aria-label="Close panel"></button>
      <section class="mobile-sheet objective-sheet" role="dialog" aria-label="Primary objective">
        <div class="sheet-head"><span>PRIMARY OBJECTIVE</span><button class="sheet-close" data-act="close-sheets" aria-label="Close objective">×</button></div>
        <div class="objective-sheet-body"><h3 data-objective-primary></h3><p data-objective-sub></p><p class="sheet-note">Capture signals relays for requisition, forward supply depots for supplementary materials and radar stations for reconnaissance. Destroy the enemy command post to secure the island.</p></div>
      </section>
      <section class="mobile-sheet selection-sheet" role="dialog" aria-label="Selection">
        <div class="sheet-head"><span>SELECTION</span><span class="mono" id="sel-count">NONE</span><button class="sheet-close" data-act="close-sheets" aria-label="Close selection">×</button></div>
        <div class="selection-body" id="selection-body"></div>
      </section>
      <section class="mobile-sheet groups-sheet" role="dialog" aria-label="Control groups">
        <div class="sheet-head"><span>CONTROL GROUPS</span><button class="sheet-close" data-act="close-sheets" aria-label="Close groups">×</button></div>
        <p class="sheet-note">Tap an empty slot to assign the current selection; tap a populated slot to recall it.</p>
        ${this.groupStripMarkup()}
      </section>
      <section class="mobile-console hud-bottom">
        <div class="mobile-roster-row">
          <div class="mobile-roster" id="mobile-roster" data-roster aria-label="Selection"></div>
          <button class="add-toggle" data-act="add-select" aria-pressed="false" title="Add tapped units to the selection">ADD</button>
        </div>
        <div class="mobile-command-row">${this.commandButtons(true)}</div>
      </section>
      <div class="debug-panel hidden" id="debug-panel"></div>
      <div class="pause-overlay hidden" id="pause-overlay">
        <div class="pause-card"><span class="eyebrow">SIMULATION HALTED</span><h2>PAUSED</h2><p>Issue orders, inspect the battlefield, then resume.</p><button class="btn btn-primary" data-act="pause">RESUME</button></div>
      </div>
      <div id="end-root"></div>
    </div>`;
  }

  private bind(): void {
    const root = this.root;
    if (!root) return;
    // Delegated and assigned (not added), so a repeated mount or bind can never
    // install a second handler and make a click toggle twice.
    root.onclick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const actEl = target?.closest<HTMLElement>('[data-act]');
      if (actEl && root.contains(actEl)) {
        event.stopPropagation();
        this.action(actEl.dataset.act ?? '');
        return;
      }
      const chip = target?.closest<HTMLElement>('[data-inspect]');
      if (chip && root.contains(chip)) {
        this.inspect(Number(chip.dataset.inspect));
        return;
      }
      const tabEl = target?.closest<HTMLElement>('[data-tab]');
      if (tabEl && root.contains(tabEl)) {
        const next = (tabEl.dataset.tab as typeof this.tab) ?? 'base';
        const close = this.layout === 'mobile' && this.panel === 'production' && this.tab === next;
        this.tab = next;
        root.querySelectorAll('.prod-tab').forEach((b) => b.classList.toggle('active', b === tabEl));
        this.renderProduction(true);
        if (this.layout === 'mobile') this.setPanel(close ? 'none' : 'production');
      }
    };
    const minimap = root.querySelector<HTMLCanvasElement>('#minimap');
    if (minimap) {
      const jump = (event: PointerEvent) => {
        if (!this.game || !this.minimapIsOnline()) return;
        const map = this.game.state.map;
        const rect = minimap.getBoundingClientRect();
        const width = Math.max(1, minimap.clientWidth);
        const height = Math.max(1, minimap.clientHeight);
        const x = Math.max(0, Math.min(map.width, ((event.clientX - rect.left - minimap.clientLeft) / width) * map.width));
        const z = Math.max(0, Math.min(map.height, ((event.clientY - rect.top - minimap.clientTop) / height) * map.height));
        this.app.renderer.camera.centerOn(x * TILE_SIZE, z * TILE_SIZE);
      };
      minimap.onpointerdown = (event) => {
        if (!this.minimapIsOnline()) return;
        minimap.setPointerCapture(event.pointerId);
        this.minimapDragging = true;
        jump(event);
      };
      minimap.onpointermove = (event) => {
        if (!this.minimapIsOnline()) {
          this.minimapDragging = false;
          return;
        }
        if (this.minimapDragging) jump(event);
      };
      minimap.onpointerup = () => {
        this.minimapDragging = false;
      };
      minimap.onpointercancel = () => {
        this.minimapDragging = false;
      };
    }
  }

  private action(act: string): void {
    switch (act) {
      case 'pause':
        this.app.togglePause();
        break;
      case 'save':
        this.app.openSaveMenu(false);
        break;
      case 'settings':
        this.app.openSettings();
        break;
      case 'menu':
        this.app.toMenu();
        break;
      case 'move':
        this.app.setMode('move');
        break;
      case 'attack':
        this.app.setMode('attack');
        break;
      case 'attackMove':
        this.app.setMode('attackMove');
        break;
      case 'stop':
        this.app.commandStop();
        break;
      case 'hold':
        this.app.commandHold();
        break;
      case 'capture':
        this.app.setMode('capture');
        break;
      case 'repair':
        this.app.setMode('repair');
        break;
      case 'garrison':
        this.app.setMode('garrison');
        break;
      case 'ungarrison':
        this.app.commandUngarrison();
        break;
      case 'return':
        this.app.commandReturn();
        break;
      case 'grid-fix':
        this.selectTab('base');
        this.app.beginPlacement('powerPlant');
        if (this.layout === 'mobile') this.setPanel('none');
        break;
      case 'build':
        this.selectTab('base');
        this.renderSelection(true);
        if (this.layout === 'mobile') this.setPanel('production');
        break;
      case 'objective':
        // Desktop has no sheet: the objective lives in the rail and opens the
        // briefing modal. Mobile shows its objective sheet.
        if (this.layout === 'mobile') this.setPanel('objective');
        else this.app.openBriefing();
        break;
      case 'selection':
        this.setPanel('selection');
        break;
      case 'groups':
        this.setPanel('groups');
        break;
      case 'map':
        this.setPanel('map');
        break;
      case 'close-sheets':
        this.setPanel('none');
        break;
      case 'add-select':
        this.app.toggleAdditiveSelection();
        break;
      case 'box':
        this.app.setMode('box');
        break;
      case 'debug':
        this.app.debug = !this.app.debug;
        this.root?.querySelector('#debug-panel')?.classList.toggle('hidden', !this.app.debug);
        break;
      case 'cancel-mode':
        this.app.cancelMode();
        break;
      case 'stance':
        this.app.setStance((document.activeElement as HTMLElement)?.dataset.stance as 'aggressive');
        break;
      case 'resume':
        if (this.app.paused) this.app.togglePause();
        break;
      default:
        break;
    }
  }

  update(game: Game, dt: number, signature: string): void {
    if (!this.root || !this.game) return;
    const now = performance.now();
    if (this.pausedCache !== this.app.paused) {
      this.pausedCache = this.app.paused;
      this.root.querySelector('#pause-overlay')?.classList.toggle('hidden', !this.app.paused);
      const top = this.root.querySelector('#btn-pause-top');
      if (top) {
        top.innerHTML = this.app.paused ? icon('play') : icon('pause');
        top.setAttribute('title', this.app.paused ? 'Resume (P)' : 'Pause (P)');
        top.setAttribute('aria-label', this.app.paused ? 'Resume battle' : 'Pause battle');
      }
    }
    this.updateMode();
    if (now - this.lastUpdate > 110) {
      this.lastUpdate = now;
      this.renderResources();
      this.renderSelection();
      this.renderGroups();
      this.renderAddMode();
      this.decorateThumbnails();
      const clock = this.root.querySelector('#clock');
      if (clock) clock.textContent = fmtTime(game.state.tick);
      const key = `${signature}|${this.tab}|${this.selectedKey()}|${Math.floor((this.app.localPlayer?.mats ?? 0) / 40)}|${Math.floor((this.app.localPlayer?.req ?? 0) / 20)}`;
      if (key !== this.lastProductionKey) {
        this.lastProductionKey = key;
        this.renderProduction();
      }
      if (this.app.debug) this.renderDebug();
    }
    // Training progress is presentation state and must follow every animation
    // frame, not the throttled HUD refresh: sampling it at 110 ms made the
    // radial wipe visibly step instead of sweep.
    this.refreshProductionProgress();
    if (now - this.lastMinimap > 50) {
      this.lastMinimap = now;
      this.drawMinimap();
    }
    void dt;
  }

  private selectedKey(): string {
    return this.app.selected.join(',');
  }

  showBuildTab(): void {
    this.selectTab('base');
    this.renderSelection(true);
    if (this.layout === 'mobile') this.setPanel('production');
  }

  cycleTab(): void {
    const tabs = PRODUCTION_TABS.map((t) => t.id);
    const index = tabs.indexOf(this.tab);
    this.selectTab(tabs[(index + 1) % tabs.length]);
  }

  private selectTab(tab: ProductionTab): void {
    this.tab = tab;
    this.root?.querySelectorAll('.prod-tab').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab);
    });
    this.renderProduction(true);
  }

  /** Roster chip: show that entity in the detail card, or return to the group summary. */
  private inspect(id: number): void {
    if (!Number.isFinite(id)) return;
    const selected = this.app.selectedEntities();
    if (!selected.some((e) => e.id === id)) return;
    this.inspectedId = this.layout === 'desktop' && this.inspectedId === id ? 0 : id;
    this.renderSelection(true);
    if (this.layout === 'mobile') this.setPanel('selection');
  }

  selectionChanged(): void {
    const selected = this.app.selectedEntities();
    if (this.inspectedId !== 0 && !selected.some((e) => e.id === this.inspectedId)) {
      this.inspectedId = 0;
    }
    this.renderSelection(true);
    this.renderProduction(true);
    this.renderAddMode();
  }

  /** Mobile panel state is presentation-only; the simulation never reads it. */
  private setPanel(requested: HudPanel): void {
    if (this.layout !== 'mobile') return;
    if (requested === 'none') this.panel = 'none';
    else this.panel = toggleHudPanel(this.panel, requested as Exclude<HudPanel, 'none'>);
    this.syncPanelState();
  }

  private syncPanelState(): void {
    const hud = this.hudEl;
    if (!hud) return;
    hud.dataset.panel = this.panel;
    for (const name of ['production', 'objective', 'selection', 'groups', 'map'] as const) {
      hud.classList.toggle(`panel-${name}`, this.panel === name);
    }
    this.root?.querySelectorAll<HTMLElement>('[data-act="objective"]').forEach((b) => {
      b.setAttribute('aria-expanded', String(this.panel === 'objective'));
    });
  }

  private renderAddMode(): void {
    const active = this.app.additiveSelection === true;
    this.root?.querySelectorAll<HTMLElement>('.add-toggle').forEach((b) => {
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Resources and objectives                                            */
  /* ------------------------------------------------------------------ */

  private renderResources(): void {
    const game = this.game;
    const p = this.app.localPlayer;
    if (!game || !this.root || !p) return;
    const mats = this.root.querySelector('#res-mats');
    const req = this.root.querySelector('#res-req');
    const matsRate = this.root.querySelector<HTMLElement>('#res-mats-rate');
    const reqRate = this.root.querySelector<HTMLElement>('#res-req-rate');
    const force_ = this.root.querySelector('#res-force');
    const forceSub = this.root.querySelector('#res-force-sub');
    const power = game.powerStatus(p.id);
    const powerEl = this.root.querySelector('#res-power');
    const powerSub = this.root.querySelector('#res-power-sub');
    const powerMobile = this.root.querySelector('#res-power-mobile');
    if (powerEl) powerEl.textContent = `${power.supply} / ${power.demand}`;
    if (powerSub) {
      powerSub.textContent = power.brownout
        ? `BROWNOUT · ${Math.round(power.ratio * 100)}%`
        : power.demand === 0
          ? 'NO DRAW'
          : `RESERVE ${power.supply - power.demand}`;
      powerSub.classList.toggle('low', power.brownout);
    }
    if (powerMobile) powerMobile.textContent = `${power.supply}/${power.demand}`;
    const alert = this.root.querySelector<HTMLElement>('#grid-alert');
    const alertCopy = this.root.querySelector('#grid-alert-copy');
    if (alert) {
      const copy = gridAlertCopy(power);
      alert.classList.toggle('hidden', copy === null);
      if (alertCopy && copy !== null) alertCopy.textContent = copy;
    }
    this.root
      .querySelectorAll<HTMLElement>('[data-build="powerPlant"]')
      .forEach((card) => card.classList.toggle('suggested', power.brownout));
    const railPower = this.root.querySelector('#rail-power');
    if (railPower) {
      railPower.classList.toggle('brownout', power.brownout);
      railPower.setAttribute(
        'title',
        power.brownout
          ? `Grid deficit: ${power.supply} supply for ${power.demand} demand — production and construction at ${Math.round(power.ratio * 100)}%`
          : `Grid: ${power.supply} supply, ${power.demand} demand`,
      );
    }
    if (mats) mats.textContent = Math.floor(p.mats).toLocaleString();
    if (req) req.textContent = Math.floor(p.req).toLocaleString();
    if (matsRate) {
      matsRate.textContent = `${game.matsPerMinute(p.id) >= 0 ? '+' : ''}${game.matsPerMinute(p.id)}/m`;
      const passive = game.passiveMatsRate(p.id);
      matsRate.title = passive > 0
        ? `Materials income, rolling 30-second window (per-minute rate) · captured depots: +${passive.toFixed(2)}/s`
        : 'Materials income, rolling 30-second window (per-minute rate)';
    }
    if (reqRate) {
      reqRate.textContent = `+${game.reqRate(p.id).toFixed(1)}/s`;
      reqRate.title = 'Requisition from command posts, refineries and captured signals relays';
    }
    if (force_ || forceSub) {
      const units = game.entitiesOf(p.id, 'unit').length;
      const buildings = game.entitiesOf(p.id, 'building').length;
      if (force_) {
        force_.textContent = `${units}`;
        force_.setAttribute('title', `${units} units · ${buildings} structures`);
      }
      if (forceSub) forceSub.textContent = `${buildings} STRUCT`;
    }
  }

  private renderObjective(): void {
    if (!this.game || !this.root) return;
    const game = this.game;
    const live = game.state.entities.filter((e) => e.hp > 0);
    const objectives = live.filter((e) => e.kind === 'building' && !!BUILDINGS[e.defId]?.capturable);
    const relays = objectives.filter((e) => e.defId === 'relay');
    const depots = objectives.filter((e) => !!BUILDINGS[e.defId]?.matsPerSec);
    const stations = objectives.filter((e) => !!BUILDINGS[e.defId]?.scanRadius);
    const owned = (list: Entity[]): number => list.filter((e) => e.owner === this.app.localPlayerId).length;
    const hq = game.state.entities.find(
      (e) => e.owner === this.app.localPlayerId && e.defId === 'commandPost' && e.hp > 0,
    );
    const enemyHq = game.state.entities.find(
      (e) => e.owner !== this.app.localPlayerId && e.defId === 'commandPost' && e.hp > 0,
    );
    const parts = [`Relays ${owned(relays)}/${relays.length}`];
    if (depots.length > 0) parts.push(`Depots ${owned(depots)}/${depots.length}`);
    if (stations.length > 0) parts.push(`Radar ${owned(stations)}/${stations.length}`);
    const passive = game.passiveMatsRate(this.app.localPlayerId);
    if (passive > 0) parts.push(`+${passive.toFixed(2)} M/s`);
    if (!hq) parts.push('Command Post lost');
    else if (!enemyHq) parts.push('Enemy HQ destroyed');
    const subText = parts.join(' · ');
    this.root.querySelectorAll<HTMLElement>('[data-objective-sub]').forEach((sub) => {
      sub.textContent = subText;
      sub.classList.toggle('bad', !hq);
    });
    this.root.querySelectorAll<HTMLElement>('[data-objective-primary]').forEach((primary) => {
      primary.textContent = primaryObjective(game);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Selection                                                           */
  /* ------------------------------------------------------------------ */

  private teamColor(): string {
    const p = this.app.localPlayer;
    return p ? FACTIONS[p.factionId]?.color ?? '#d8e2dd' : '#d8e2dd';
  }

  private thumbMarkup(
    kind: ThumbnailKind,
    defId: string,
    color: string,
    shape: ThumbnailShape,
    iconName: string,
    className = '',
    badge = 0,
  ): string {
    const classes = ['thumb-frame', className].filter(Boolean).join(' ');
    return `<span class="${classes}">
      <span class="thumb-art" data-thumb-kind="${kind}" data-thumb-id="${escapeHtml(defId)}" data-thumb-shape="${shape}" data-thumb-color="${escapeHtml(color)}" aria-hidden="true"></span>
      <span class="thumb-fallback" aria-hidden="true">${iconSvg(iconName)}</span>
      ${badge > 1 ? `<b class="sel-count-badge">${badge}</b>` : ''}
    </span>`;
  }

  private thumbnailRenderer(): ThumbnailRenderer | null {
    if (this.thumbnails === undefined) {
      try {
        this.thumbnails = new ThumbnailRenderer();
      } catch {
        this.thumbnails = null;
      }
    }
    return this.thumbnails;
  }

  /** Pre-render card art and every selectable portrait before the shell paints. */
  private warmBattleArt(): void {
    const game = this.game;
    const renderer = this.thumbnailRenderer();
    if (!game || !renderer?.available) return;
    const localColor = this.teamColor();
    const requests: ThumbnailRequest[] = [
      ...Object.keys(UNITS).map((defId) => ({ kind: 'unit' as const, defId, color: localColor, shape: 'card' as const })),
      ...BUILDABLE_BY_PLAYER.map((def) => ({ kind: 'building' as const, defId: def.id, color: localColor, shape: 'card' as const })),
    ];

    // Portraits are cached per team colour, so warm every unit and structure for
    // each faction in the battle; a hostile or captured asset uses its own colour.
    const portraitColors = new Set<string>([localColor]);
    for (const player of game.state.players) {
      portraitColors.add(FACTIONS[player.factionId]?.color ?? '#d8e2dd');
    }
    for (const color of portraitColors) {
      for (const defId of Object.keys(UNITS)) {
        requests.push({ kind: 'unit', defId, color, shape: 'portrait' });
      }
      for (const defId of Object.keys(BUILDINGS)) {
        requests.push({ kind: 'building', defId, color, shape: 'portrait' });
      }
    }
    // Authored neutral objectives and shelters use the shared neutral colour.
    for (const def of Object.values(BUILDINGS)) {
      if (def.authoredOnly) {
        requests.push({ kind: 'building', defId: def.id, color: '#8d9d98', shape: 'portrait' });
      }
    }
    renderer.warmSync(requests);
  }

  /** Fill icon placeholders with cached off-screen renders; icons remain on failure. */
  private decorateThumbnails(): void {
    const root = this.root;
    if (!root) return;
    const arts = root.querySelectorAll<HTMLElement>('.thumb-art[data-thumb-id]');
    if (arts.length === 0) return;
    const renderer = this.thumbnailRenderer();
    if (!renderer?.available) return;
    for (const art of arts) {
      if (art.classList.contains('has-art')) continue;
      const defId = art.dataset.thumbId;
      if (!defId) continue;
      const url = renderer.get({
        kind: art.dataset.thumbKind === 'building' ? 'building' : 'unit',
        defId,
        color: art.dataset.thumbColor || '#d8e2dd',
        shape: art.dataset.thumbShape === 'portrait' ? 'portrait' : 'card',
      });
      if (!url) continue;
      art.style.backgroundImage = `url("${url}")`;
      art.classList.add('has-art');
    }
  }

  private renderSelection(force = false): void {
    if (!this.game || !this.root) return;
    const game = this.game;
    const entities = this.app.selectedEntities();
    const countText = entities.length === 0 ? 'NONE' : `${entities.length} SELECTED`;
    this.root.querySelectorAll<HTMLElement>('#sel-count').forEach((count) => {
      count.textContent = countText;
    });
    this.root.querySelector('.mobile-console')?.classList.toggle('has-selection', entities.length > 0);
    this.root.querySelector('.selection-panel')?.classList.toggle('empty-selection', entities.length === 0);
    this.renderRoster(entities);
    const body = this.root.querySelector('#selection-body');
    if (!body) return;
    if (entities.length === 0) {
      const hint = this.layout === 'mobile'
        ? 'Tap a unit or drag a box. Tap the battlefield to move; tap an enemy to attack. Use GARRISON to occupy a building.'
        : 'Click a unit or drag a box. Right-click to move or attack. Engineers capture objectives and repair structures; infantry can garrison eligible buildings.';
      body.innerHTML = `
        <div class="idle-hint">
          <span class="hint-title">NO FORCES SELECTED</span>
          <p>${hint}</p>
          <div class="key-row"><span class="hotkey">A</span><span class="hotkey">S</span><span class="hotkey">H</span><span class="hotkey">C</span><span class="hotkey">F3</span><span class="hotkey">1-9</span></div>
        </div>`;
      return;
    }
    const inspected = this.inspectedId !== 0
      ? entities.find((e) => e.id === this.inspectedId)
      : undefined;
    if (entities.length > 1 && !inspected) {
      const units = entities.filter((e) => e.kind === 'unit');
      const buildings = entities.filter((e) => e.kind === 'building');
      const lead = units[0] ?? entities[0];
      const leadIcon = lead.kind === 'unit'
        ? UNITS[lead.defId]?.icon ?? 'squad'
        : BUILDINGS[lead.defId]?.icon ?? 'command';
      const types = new Map<string, number>();
      for (const e of units) types.set(e.defId, (types.get(e.defId) ?? 0) + 1);
      const totalHp = entities.reduce((a, e) => a + e.hp, 0);
      const totalMax = entities.reduce((a, e) => a + e.maxHp, 0);
      const frac = totalMax > 0 ? totalHp / totalMax : 0;
      const stance = units[0]?.stance ?? 'aggressive';
      // The breakdown lives in the status column so no line has to be clipped:
      // up to three types by strength, then a count of the rest.
      const mix = [...types.entries()].sort((a, b) => b[1] - a[1]);
      const shown = mix.slice(0, 3);
      const hidden = mix.length - shown.length;
      const composition = `
        ${shown.map(([id, n]) => `<div class="group-mix"><span>${escapeHtml(UNITS[id]?.shortName ?? id)}</span><b>×${n}</b></div>`).join('')}
        ${hidden > 0 ? `<div class="group-mix more"><span>${hidden} more type${hidden === 1 ? '' : 's'}</span></div>` : ''}`;
      const role = units.length === 0 ? 'STRUCTURES' : `${stance.toUpperCase()} STANCE`;
      body.innerHTML = `
        <div class="sel-primary">
          <div class="sel-main">
            ${this.thumbMarkup(lead.kind, lead.defId, ownerColor(game, lead), 'portrait', leadIcon, 'sel-icon', entities.length)}
            <div class="sel-info">
              <div class="sel-title"><h3>${units.length} ${units.length === 1 ? 'unit' : 'units'}</h3><span>${buildings.length > 0 ? `${buildings.length} ${buildings.length === 1 ? 'structure' : 'structures'}` : ''}</span></div>
              <div class="sel-role">${role}</div>
            </div>
          </div>
        </div>
        <div class="sel-stats">
          <div class="stat-grid">
            <div class="stat"><span>UNITS</span><b>${units.length}</b></div>
            <div class="stat"><span>STRUCTURES</span><b>${buildings.length}</b></div>
            <div class="stat"><span>INTEGRITY</span><b>${Math.round(frac * 100)}%</b></div>
            <div class="stat"><span>TYPES</span><b>${mix.length}</b></div>
          </div>
        </div>
        <div class="sel-notes">${composition}</div>
        <div class="sel-actions">
          ${this.stanceButtons(entities)}
          ${this.garrisonOrderButtons(entities)}
          ${this.groupChips(entities)}
        </div>`;
      this.bindStanceButtons();
      this.bindGarrisonButtons();
      this.decorateThumbnails();
      return;
    }
    const e = inspected ?? entities[0];
    const def = e.kind === 'unit' ? UNITS[e.defId] : BUILDINGS[e.defId];
    const p = game.player(e.owner);
    const isOwn = e.owner === this.app.localPlayerId;
    const isEnemy = e.owner !== this.app.localPlayerId && p && game.isHostile(e.owner, this.app.localPlayerId);
    const frac = clamp01(e.hp / e.maxHp);
    const iconName = def?.icon ?? 'target';
    const objective = BUILDINGS[e.defId]?.capturable ? objectiveMeterState(game, e) : null;
    const garrisonDef = e.kind === 'building' ? BUILDINGS[e.defId]?.garrison : undefined;
    const occupants = garrisonDef ? game.garrisonOccupants(e.id) : [];
    const stateText = objective ? objective.caption : stateLabel(e);
    // Role only: the live state is already a value in the middle column, so
    // repeating it here only pushed the role line past the column width.
    const roleText = objective ? `${def?.role ?? ''} · ${stateText}` : (def?.role ?? '');
    // An objective's primary vital is who holds it and how far a capture has
    // progressed. Capture-only structures (relays, forward depots) show control
    // alone; destructible infrastructure adds an integrity bar beneath it.
    const objectiveFill = objective
      ? objective.progress > 0
        ? objective.progress
        : objective.owner >= 0
          ? 1
          : 0
      : 0;
    const controlBlock = objective
      ? `<div class="hp-block"><div class="hp-label"><span>${objective.progress > 0 ? 'CAPTURE' : 'CONTROL'}</span><span>${objective.progress > 0 ? `${Math.round(objective.progress * 100)}%` : escapeHtml(objective.ownerLabel)}</span></div><div class="hp-bar"><i style="width:${objectiveFill * 100}%;background:${objective.progress > 0 ? objective.capturerColor : objective.ownerColor}"></i></div></div>`
      : '';
    const integrityBlock =
      e.kind !== 'building' || isIndestructibleStructure(e.defId)
        ? ''
        : `<div class="hp-block"><div class="hp-label"><span>INTEGRITY</span><span>${Math.ceil(e.hp)}/${Math.ceil(e.maxHp)}</span></div><div class="hp-bar"><i class="${hpClass(frac)}" style="width:${frac * 100}%"></i></div></div>`;
    const vitalBlock = `${controlBlock}${integrityBlock}`;
    let stats = '';
    if (e.kind === 'unit' && def && 'speed' in def) {
      const ammo = e.maxAmmo > 0
        ? `<div class="ammo-dots">${Array.from({ length: e.maxAmmo }, (_, i) => `<i class="${i >= e.ammo ? 'empty' : ''}"></i>`).join('')}</div><b>${e.ammo}/${e.maxAmmo}</b>`
        : `<b>—</b>`;
      const fuel = e.maxFuel > 0 ? `<b>${Math.max(0, Math.round((e.fuel / e.maxFuel) * 100))}%</b>` : `<b>—</b>`;
      stats = `
        <div class="stat-grid">
          <div class="stat"><span>STATE</span><b>${escapeHtml(stateLabel(e))}</b></div>
          <div class="stat"><span>SPEED</span><b>${def.speed.toFixed(1)} m/s</b></div>
          <div class="stat"><span>AMMO</span>${ammo}</div>
          <div class="stat"><span>FUEL</span>${fuel}</div>
        </div>`;
    } else if (e.kind === 'building' && def) {
      const q = e.queue[0];
      // Stat cells are one short value each, so the long-form benefit is
      // abbreviated here; the full wording lives in the data description.
      const benefit = BUILDINGS[e.defId]
        ? structureBenefit(BUILDINGS[e.defId])
            .replace(' requisition/s', ' req/s')
            .replace(' materials/s', ' mat/s')
            .replace('-tile scan', ' tile scan')
        : '';
      const power = BUILDINGS[e.defId]?.power ?? 0;
      const compactState = e.construction
        ? `BUILDING ${Math.round(e.buildProgress * 100)}%`
        : objective
          ? objective.progress > 0
            ? `CAPTURING ${Math.round(objective.progress * 100)}%`
            : objective.owner >= 0
              ? 'CONTROLLED'
              : 'NEUTRAL'
          : stateLabel(e);
      stats = `
        <div class="stat-grid">
          <div class="stat"><span>STATE</span><b>${escapeHtml(compactState)}</b></div>
          <div class="stat"><span>${benefit ? 'BENEFIT' : 'QUEUE'}</span><b>${benefit ? escapeHtml(benefit) : `${e.queue.length}${q ? ` · ${UNITS[q.defId]?.shortName ?? q.defId}` : ''}`}</b></div>
          <div class="stat"><span>VISION</span><b>${def.vision} tiles</b></div>
          <div class="stat"><span>POWER</span><b>${power > 0 ? `+${power}` : `${power}`}</b></div>
        </div>`;
    }
    // Status lines are single fixed-height rows in the right-hand column, which
    // also carries the vitals: the identity keeps its full width for the name
    // and role, so neither can be ellipsised away.
    let statusLines = '';
    if (garrisonDef) {
      const occupancy = Math.min(garrisonDef.capacity, occupants.length);
      const ownerBreakdown = occupants.length === 0
        ? 'EMPTY'
        : occupants.some((u) => u.owner === this.app.localPlayerId)
          ? 'FRIENDLY'
          : this.app.game?.isHostile(occupants[0].owner, this.app.localPlayerId)
            ? 'HOSTILE'
            : 'OCCUPIED';
      statusLines += `<div class="sel-line"><span>GARRISON ${occupancy}/${garrisonDef.capacity} · ${ownerBreakdown}</span><b>${Math.round(garrisonDef.protection * 100)}% PROT · ${garrisonDef.firingSlots} SLOTS</b></div>`;
    }
    if (objective) {
      const radar = BUILDINGS[e.defId]?.scanRadius ?? 0;
      if (radar > 0) {
        const owner = e.owner;
        const net = owner >= 0 ? game.radarNetwork(owner) : null;
        const online = !!net && net.online > 0 && !net.brownout;
        const feed = owner < 0
          ? 'UNCLAIMED'
          : online
            ? `ONLINE · ${net!.contacts} CONTACTS`
            : net?.brownout
              ? 'OFFLINE — GRID'
              : 'OFFLINE';
        statusLines += `<div class="sel-line"><span>RADAR ${feed}</span><b>SCAN ${radar} TILES</b></div>`;
      }
    }
    const hint = !isOwn && objective
      ? 'CAPTURE WITH A COMBAT ENGINEER'
      : !isOwn && garrisonDef
        ? 'GARRISON WITH INFANTRY'
        : !isOwn && isEnemy
          ? 'HOSTILE — ORDER AN ATTACK'
          : '';
    body.innerHTML = `
      <div class="sel-primary">
        <div class="sel-main">
          ${this.thumbMarkup(e.kind, e.defId, ownerColor(game, e), 'portrait', iconName, `sel-icon${isEnemy ? ' enemy' : e.owner === -1 ? ' neutral' : ''}`)}
          <div class="sel-info">
            <div class="sel-title"><h3>${escapeHtml(def?.name ?? e.defId)}</h3><span>${p ? escapeHtml(FACTIONS[p.factionId]?.shortName ?? p.name) : 'NEUTRAL'}${isOwn ? '' : isEnemy ? ' · HOSTILE' : ''}</span></div>
            <div class="sel-role">${escapeHtml(roleText)}</div>
          </div>
        </div>
      </div>
      <div class="sel-stats">${stats}</div>
      <div class="sel-notes">
        ${vitalBlock}
        ${statusLines}
        ${hint ? `<div class="sel-hint">${hint}</div>` : ''}
      </div>
      <div class="sel-actions">
        ${isOwn ? this.stanceButtons([e]) : ''}
        ${this.garrisonOrderButtons([e])}
        ${isOwn ? this.groupChips([e]) : ''}
      </div>`;
    this.bindStanceButtons();
    this.bindGarrisonButtons();
    this.decorateThumbnails();
    void force;
  }

  /**
   * The roster uses the panel's horizontal space: one chip per selected entity,
   * scrolled sideways instead of stacking rows. It is rebuilt only when the
   * selection changes so a scrolled strip does not jump every refresh.
   */
  private renderRoster(entities: Entity[]): void {
    const root = this.root;
    if (!root) return;
    const listKey = entities.map((e) => e.id).join(',');
    root.querySelectorAll<HTMLElement>('[data-roster]').forEach((host) => {
      if (entities.length === 0) {
        if (host.dataset.key !== 'empty') {
          host.dataset.key = 'empty';
          host.innerHTML = `<span class="roster-empty">${this.layout === 'mobile' ? 'NO SELECTION — TAP A UNIT' : 'No forces selected'}</span>`;
        }
        return;
      }
      if (host.dataset.key !== listKey) {
        host.dataset.key = listKey;
        host.innerHTML = entities.map((e) => this.rosterChip(e)).join('');
      }
      for (const e of entities) {
        const chip = host.querySelector<HTMLElement>(`[data-inspect="${e.id}"]`);
        if (!chip) continue;
        chip.classList.toggle('active', e.id === this.inspectedId);
        chip.setAttribute('aria-pressed', String(e.id === this.inspectedId));
        const bar = chip.querySelector<HTMLElement>('.chip-hp i');
        if (!bar) continue;
        const frac = clamp01(e.hp / e.maxHp);
        bar.style.width = `${frac * 100}%`;
        bar.className = hpClass(frac);
      }
    });
  }

  private rosterChip(e: Entity): string {
    const def = e.kind === 'unit' ? UNITS[e.defId] : BUILDINGS[e.defId];
    const colour = this.game ? ownerColor(this.game, e) : '#d8e2dd';
    const frac = clamp01(e.hp / e.maxHp);
    const name = def?.name ?? e.defId;
    return `<button class="roster-chip" data-inspect="${e.id}" title="${escapeHtml(name)} · ${escapeHtml(stateLabel(e))}" aria-label="${escapeHtml(name)}">
      ${this.thumbMarkup(e.kind, e.defId, colour, 'portrait', def?.icon ?? 'target', 'chip-art')}
      <span class="chip-copy">
        <span class="chip-name">${escapeHtml(def?.shortName ?? e.defId)}</span>
        <span class="chip-hp"><i class="${hpClass(frac)}" style="width:${frac * 100}%"></i></span>
      </span>
    </button>`;
  }

  /** Stance is the only order control in the panel; orders live in the command bar. */
  private stanceButtons(entities: Entity[]): string {
    const units = entities.filter(
      (e) => e.owner === this.app.localPlayerId && e.kind === 'unit',
    );
    if (units.length === 0) return '';
    const stance = units[0].stance ?? 'aggressive';
    return `<div class="stance-row">
      <span class="stance-label">STANCE</span>
      <button class="mini-btn ${stance === 'aggressive' ? 'active' : ''}" data-stance="aggressive">AGGRESSIVE</button>
      <button class="mini-btn ${stance === 'defensive' ? 'active' : ''}" data-stance="defensive">DEFENSIVE</button>
      <button class="mini-btn ${stance === 'hold' ? 'active' : ''}" data-stance="hold">HOLD FIRE</button>
    </div>`;
  }

  private bindStanceButtons(): void {
    this.root?.querySelectorAll<HTMLElement>('[data-stance]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.app.setStance(btn.dataset.stance as 'aggressive');
        this.renderSelection(true);
      });
    });
  }

  /** Direct garrison and exit controls for desktop and touch selections. */
  private garrisonOrderButtons(entities: Entity[]): string {
    const game = this.game;
    if (!game) return '';
    const eligible = entities.some(
      (e) =>
        e.kind === 'unit' &&
        e.owner === this.app.localPlayerId &&
        !e.garrisonId &&
        !!UNITS[e.defId]?.canGarrison,
    );
    const inside = entities.some(
      (e) =>
        e.kind === 'unit' && e.owner === this.app.localPlayerId && !!e.garrisonId,
    );
    const holdsBuilding = entities.some(
      (e) =>
        e.kind === 'building' &&
        game.garrisonOccupants(e.id).some((u) => u.owner === this.app.localPlayerId),
    );
    if (!eligible && !inside && !holdsBuilding) return '';
    return `<div class="sel-orders garrison-orders">
      ${eligible ? `<button class="mini-btn" data-garrison-order>GARRISON</button>` : ''}
      ${inside || holdsBuilding ? `<button class="mini-btn" data-ungarrison-order>EXIT BUILDING</button>` : ''}
    </div>`;
  }

  private bindGarrisonButtons(): void {
    this.root?.querySelectorAll<HTMLElement>('[data-garrison-order]').forEach((btn) => {
      btn.addEventListener('click', () => this.app.setMode('garrison'));
    });
    this.root?.querySelectorAll<HTMLElement>('[data-ungarrison-order]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.app.commandUngarrison();
        this.renderSelection(true);
      });
    });
  }

  private groupChips(entities: Entity[]): string {
    const ids = entities.map((e) => e.id).join(',');
    const assigned: number[] = [];
    for (const [index, group] of this.app.groups) {
      if (group.some((id) => ids.split(',').map(Number).includes(id))) assigned.push(index);
    }
    if (assigned.length === 0) return '';
    return `<div class="group-chips">${assigned.map((n) => `<span class="group-chip">GROUP ${n}</span>`).join('')}</div>`;
  }

  private renderGroups(): void {
    if (!this.root) return;
    const strip = this.root.querySelector<HTMLElement>('#group-strip');
    if (!strip) return;
    // Build and bind the nine slots once. Rewriting them on every HUD tick
    // replaces the node under the pointer and can swallow a click that spans
    // an update; only the assigned/empty presentation needs refreshing.
    if (!strip.dataset.bound) {
      strip.innerHTML = Array.from({ length: 9 }, (_, i) => {
        const n = i + 1;
        return `<button class="control-group empty" data-group="${n}"><b>${n}</b><i class="group-state" aria-hidden="true"></i></button>`;
      }).join('');
      strip.querySelectorAll<HTMLElement>('[data-group]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const n = Number(btn.dataset.group);
          if (this.app.groups.has(n)) this.app.recallGroup(n);
          else this.app.assignGroup(n);
          this.renderGroups();
        });
      });
      strip.dataset.bound = '1';
    }
    strip.querySelectorAll<HTMLElement>('[data-group]').forEach((btn) => {
      const n = Number(btn.dataset.group);
      const has = (this.app.groups.get(n)?.length ?? 0) > 0;
      btn.classList.toggle('has', has);
      btn.classList.toggle('empty', !has);
      btn.setAttribute(
        'aria-label',
        has ? `Recall control group ${n}` : `Assign selection to empty control group ${n}`,
      );
    });
  }

  /* ------------------------------------------------------------------ */
  /* Production                                                          */
  /* ------------------------------------------------------------------ */

  private renderProduction(force = false): void {
    if (!this.game || !this.root) return;
    if (this.queueDrag) this.finishQueueDrag();
    const game = this.game;
    const body = this.root.querySelector('#prod-body');
    if (!body) return;
    const structurePanel = this.tab === 'base' || this.tab === 'defence';
    if (structurePanel) {
      body.innerHTML = this.buildMarkup(this.tab === 'defence' ? 'defence' : 'base');
      this.bindBuildCards();
      this.decorateThumbnails();
      return;
    }
    const hasFactory = game
      .entitiesOf(this.app.localPlayerId, 'building')
      .some((e) => e.defId === 'factory' && e.hp > 0 && !e.construction);
    const domain = productionDomain(this.tab);
    const facilities = game
      .entitiesOf(this.app.localPlayerId, 'building')
      .filter((e) => !!BUILDINGS[e.defId]?.produces)
      .filter((e) => !!domain && BUILDINGS[e.defId]?.produces === domain)
      // The HQ engineering panel is a fallback only while no factory stands.
      .filter((e) => e.defId !== 'commandPost' || !hasFactory);
    if (facilities.length === 0) {
      body.innerHTML = `<div class="prod-empty">No ${DOMAIN_LABEL[this.tab] ?? this.tab.toUpperCase()} production facility. Build one from the BASE panel.</div>`;
      return;
    }
    const html = facilities.map((f) => {
      const def = BUILDINGS[f.defId];
      const list = def.productionList ?? [];
      const cards = list.map((id) => {
        const udef = UNITS[id];
        if (!udef) return '';
        const status = game.productionStatus(this.app.localPlayerId, f.id, id);
        const queued = productionCardState(f.queue, id);
        const reorderable = queued.queued > 0 && f.queue.some((item) => item.defId !== id);
        const dragHint = reorderable ? ' Drag to set production priority.' : '';
        const title = status.ok ? `${udef.description}${dragHint}` : `${status.reason}${dragHint}`;
        const disabled = !status.ok && !reorderable ? 'disabled' : '';
        const cardClass = [
          'unit-card',
          queued.active ? 'training' : '',
          status.ok ? '' : 'unavailable',
          reorderable ? 'reorderable' : '',
        ].filter(Boolean).join(' ');
        return `<div class="unit-slot">
          <button class="${cardClass}" data-produce="${f.id}:${id}" data-queued="${queued.queued}" ${status.ok ? '' : 'aria-disabled="true"'} ${disabled} title="${escapeHtml(title)}">
            <span class="u-hot">${udef.hotkey ?? ''}</span>
            <span class="u-art">
              ${this.thumbMarkup('unit', id, this.teamColor(), 'card', udef.icon, 'u-thumb')}
              <span class="u-progress" style="--p:${(queued.progress * 100).toFixed(1)}%" aria-hidden="true"></span>
            </span>
            <span class="u-name">${escapeHtml(udef.shortName)}</span>
            <span class="u-cost"><b>${udef.cost.mats}</b>M${udef.cost.req > 0 ? ` · ${udef.cost.req}R` : ''}</span>
            ${reorderable ? '<span class="u-grip" title="Drag to set production priority" aria-hidden="true"></span>' : ''}
          </button>
          ${queued.queued > 0 ? `<button class="u-queue" data-cancel-def="${f.id}:${id}" title="${queued.queued} queued — cancel one" aria-label="Cancel one queued ${escapeHtml(udef.name)}">${queued.queued}</button>` : ''}
        </div>`;
      }).join('');
      return `<div class="facility" data-facility="${f.id}">
        <div class="facility-head"><span class="facility-name">${icon(def.icon)}${escapeHtml(def.shortName)}</span><span class="facility-meta">${f.construction ? `BUILDING ${Math.round(f.buildProgress * 100)}%` : `${f.queue.length} QUEUED`}</span></div>
        ${f.construction ? '' : `<div class="unit-grid">${cards}</div>`}
      </div>`;
    }).join('');
    body.innerHTML = html;
    body.querySelectorAll<HTMLButtonElement>('[data-produce]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (performance.now() < this.suppressQueueClickUntil) return;
        const [bid, defId] = (btn.dataset.produce ?? '').split(':');
        this.app.produce(Number(bid), defId);
        this.renderProduction(true);
        if (this.layout === 'mobile') this.setPanel('none');
      });
    });
    body.querySelectorAll<HTMLElement>('.unit-card.reorderable').forEach((card) => {
      card.addEventListener('pointerdown', (event) => this.beginQueueDrag(event, card));
    });
    body.querySelectorAll<HTMLButtonElement>('[data-cancel-def]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (performance.now() < this.suppressQueueClickUntil) return;
        const [bid, defId] = (btn.dataset.cancelDef ?? '').split(':');
        const facility = game.getEntity(Number(bid));
        const index = facility?.queue.map((item) => item.defId).lastIndexOf(defId) ?? -1;
        if (index < 0) return;
        this.app.cancelProduction(Number(bid), index);
        this.renderProduction(true);
      });
    });
    this.decorateThumbnails();
    void force;
  }

  /**
   * Advance the cameo's radial wipe without rebuilding the production DOM.
   * Queue length changes still arrive through the HUD signature and produce a
   * fresh render; continuous progress is presentation state, so a CSS custom
   * property is enough and keeps button focus intact.
   */
  private refreshProductionProgress(): void {
    const game = this.game;
    const body = this.root?.querySelector('#prod-body');
    if (!game || !body) return;
    body.querySelectorAll<HTMLElement>('.unit-card[data-produce]').forEach((card) => {
      const [bid, defId] = (card.dataset.produce ?? '').split(':');
      const facility = game.getEntity(Number(bid));
      const state = productionCardState(facility?.queue ?? [], defId);
      card.classList.toggle('training', state.active);
      // The overlay carries its own inline `--p` from the initial markup, which
      // wins over a value inherited from the card. Write to the overlay itself
      // or these per-frame updates are silently ignored until the next re-render.
      card.querySelector<HTMLElement>('.u-progress')?.style.setProperty(
        '--p',
        `${(state.progress * 100).toFixed(1)}%`,
      );
    });
  }

  /* ------------------------------------------------------------------ */
  /* Production priority drag                                            */
  /* ------------------------------------------------------------------ */

  private beginQueueDrag(event: PointerEvent, card: HTMLElement): void {
    if (this.queueDrag || event.button !== 0) return;
    const [buildingId, defId] = (card.dataset.produce ?? '').split(':');
    const count = Number(card.dataset.queued ?? 0);
    if (!buildingId || !defId || count < 1) return;
    const onGrip = !!(event.target as Element | null)?.closest('.u-grip');
    // A touch drag must start on the visible grip; a mouse may pull the card
    // from anywhere, leaving the ordinary click path untouched.
    if (event.pointerType === 'touch' && !onGrip) return;
    this.queueDrag = {
      pointerId: event.pointerId,
      buildingId: Number(buildingId),
      defId,
      name: card.querySelector('.u-name')?.textContent?.trim() || defId,
      count,
      card,
      startX: event.clientX,
      startY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      active: false,
      fromGrip: event.pointerType === 'touch' && onGrip,
      target: null,
      ghost: null,
    };
    window.addEventListener('pointermove', this.moveQueueDrag, { passive: false });
    window.addEventListener('pointerup', this.endQueueDrag);
    window.addEventListener('pointercancel', this.endQueueDrag);
    window.addEventListener('blur', this.cancelQueueDrag);
  }

  private activateQueueDrag(drag: QueueDragState, event: PointerEvent): void {
    drag.active = true;
    drag.card.classList.add('dragging');
    this.hudEl?.classList.add('queue-dragging');
    const ghost = document.createElement('div');
    ghost.className = 'queue-ghost';
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    this.updateQueueDragGhost(drag);
    this.startQueueAutoScroll();
  }

  private updateQueueDragGhost(drag: QueueDragState): void {
    if (!drag.ghost) return;
    const targetName = drag.target?.querySelector('.u-name')?.textContent?.trim() ?? '';
    drag.ghost.innerHTML = `<b>${escapeHtml(drag.name)} ×${drag.count}</b><span>${
      targetName ? `SET AHEAD OF ${escapeHtml(targetName)}` : 'DROP ON A QUEUED CARD'
    }</span>`;
  }

  private moveQueueDrag = (event: PointerEvent): void => {
    const drag = this.queueDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.pointerX = event.clientX;
    drag.pointerY = event.clientY;
    if (!drag.active) {
      const threshold = event.pointerType === 'touch' ? 8 : 5;
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < threshold) return;
      this.activateQueueDrag(drag, event);
    }
    if (event.cancelable) event.preventDefault();
    if (drag.ghost) {
      drag.ghost.style.left = `${event.clientX}px`;
      drag.ghost.style.top = `${event.clientY}px`;
    }
    this.updateQueueDragTarget(drag, event.clientX, event.clientY);
  };

  /**
   * Resolve the drop target under a viewport point. Called both on pointermove
   * and after an auto-scroll frame, so cards that slide under a stationary
   * pointer become valid targets without requiring another mouse movement.
   */
  private updateQueueDragTarget(drag: QueueDragState, clientX: number, clientY: number): void {
    const hovered = document.elementFromPoint(clientX, clientY);
    const slot = hovered?.closest<HTMLElement>('.unit-slot') ?? null;
    const card = slot?.querySelector<HTMLElement>('.unit-card[data-produce]') ?? null;
    let next: HTMLElement | null = null;
    if (card && card !== drag.card) {
      const [targetBuilding, targetDef] = (card.dataset.produce ?? '').split(':');
      if (
        targetBuilding === String(drag.buildingId) &&
        targetDef !== drag.defId &&
        Number(card.dataset.queued ?? 0) > 0
      ) {
        next = card;
      }
    }
    if (next !== drag.target) {
      drag.target?.classList.remove('drop-target');
      drag.target = next;
      drag.target?.classList.add('drop-target');
      this.updateQueueDragGhost(drag);
    }
  }

  private startQueueAutoScroll(): void {
    this.stopQueueAutoScroll();
    this.queueScrollFrame = requestAnimationFrame(this.stepQueueAutoScroll);
  }

  private stopQueueAutoScroll(): void {
    if (this.queueScrollFrame) cancelAnimationFrame(this.queueScrollFrame);
    this.queueScrollFrame = 0;
    this.queueScrollLast = 0;
  }

  private stepQueueAutoScroll = (now: number): void => {
    this.queueScrollFrame = 0;
    const drag = this.queueDrag;
    if (!drag || !drag.active) return;
    const body = this.root?.querySelector<HTMLElement>('#prod-body');
    const elapsed = this.queueScrollLast === 0
      ? 0
      : Math.min(0.05, Math.max(0, (now - this.queueScrollLast) / 1000));
    this.queueScrollLast = now;
    if (body && elapsed > 0) {
      const rect = body.getBoundingClientRect();
      const overSheet =
        rect.height > 0 &&
        drag.pointerX >= rect.left - QUEUE_EDGE_SCROLL_MARGIN &&
        drag.pointerX <= rect.right + QUEUE_EDGE_SCROLL_MARGIN;
      if (overSheet) {
        const speed = edgeAutoScrollVelocity(
          drag.pointerY,
          rect.top,
          rect.bottom,
          QUEUE_EDGE_SCROLL_ZONE,
          QUEUE_EDGE_SCROLL_SPEED,
        );
        const maxScroll = body.scrollHeight - body.clientHeight;
        if (speed !== 0 && maxScroll > 0) {
          const before = body.scrollTop;
          body.scrollTop = Math.max(0, Math.min(maxScroll, before + speed * elapsed));
          if (body.scrollTop !== before) {
            // Content moved under a stationary pointer: retarget immediately.
            this.updateQueueDragTarget(drag, drag.pointerX, drag.pointerY);
          }
        }
      }
    }
    this.queueScrollFrame = requestAnimationFrame(this.stepQueueAutoScroll);
  };

  private endQueueDrag = (event: PointerEvent): void => {
    const drag = this.queueDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const active = drag.active;
    const target = drag.target;
    const targetDefId = target ? (target.dataset.produce ?? '').split(':')[1] : '';
    const targetName = target?.querySelector('.u-name')?.textContent?.trim() ?? '';
    const drop = event.type === 'pointerup' && active && !!targetDefId;
    this.finishQueueDrag();
    if (!active) {
      if (drag.fromGrip) this.suppressQueueClickUntil = performance.now() + 350;
      return;
    }
    this.suppressQueueClickUntil = performance.now() + 500;
    if (!drop) return;
    const queue = this.game?.getEntity(drag.buildingId)?.queue ?? [];
    const lastDragged = queue.map((item) => item.defId).lastIndexOf(drag.defId);
    const firstTarget = queue.findIndex((item) => item.defId === targetDefId);
    if (lastDragged < 0 || firstTarget < 0) return;
    if (lastDragged < firstTarget) {
      this.app.notify(`${drag.name} is already ahead of ${targetName || targetDefId}.`, 'info');
      return;
    }
    this.app.reorderProduction(drag.buildingId, drag.defId, targetDefId);
    this.app.notify(`${drag.name} priority set ahead of ${targetName || targetDefId}.`, 'info');
    // The next HUD tick sees the reordered authoritative queue and swaps the
    // radial wipe to the new training head. Clear the cached key so it cannot
    // be skipped if the signature happened to be unchanged.
    this.lastProductionKey = '';
  };

  private cancelQueueDrag = (): void => {
    this.finishQueueDrag();
  };

  private finishQueueDrag(): void {
    const drag = this.queueDrag;
    if (!drag) return;
    this.queueDrag = null;
    this.stopQueueAutoScroll();
    window.removeEventListener('pointermove', this.moveQueueDrag);
    window.removeEventListener('pointerup', this.endQueueDrag);
    window.removeEventListener('pointercancel', this.endQueueDrag);
    window.removeEventListener('blur', this.cancelQueueDrag);
    // Covers a drag interrupted by a production re-render as well as the normal
    // drop: the synthetic click after pointerup must not queue another unit.
    if (drag.active) this.suppressQueueClickUntil = performance.now() + 500;
    drag.card.classList.remove('dragging');
    drag.target?.classList.remove('drop-target');
    drag.ghost?.remove();
    this.hudEl?.classList.remove('queue-dragging');
  }

  /** One structure panel per category: BASE sites infrastructure, DEFENCE sites guns. */
  private buildMarkup(tab: 'base' | 'defence'): string {
    const p = this.app.localPlayer;
    const engineer = this.game?.entitiesOf(this.app.localPlayerId, 'unit').find((e) => UNITS[e.defId]?.canBuild);
    const cards = BUILDABLE_BY_PLAYER
      .filter((def) => structureTab(!!def.weapons?.length) === tab)
      .map((def) => {
        const affordable = p ? p.mats >= def.cost.mats && p.req >= def.cost.req : false;
        return `<button class="build-card" data-build="${def.id}" ${engineer ? '' : 'disabled'} title="${escapeHtml(def.description)}">
          ${def.id === 'powerPlant' ? '<span class="b-flag">GRID FIX</span>' : ''}
          ${this.thumbMarkup('building', def.id, this.teamColor(), 'card', def.icon, 'b-thumb')}
          <span class="b-copy"><span class="b-name">${escapeHtml(def.name)}</span><span class="b-cost"><b>${def.cost.mats}</b>M${def.cost.req > 0 ? ` · ${def.cost.req}R` : ''} · ${def.buildTime}s${affordable ? '' : ' · INSUFFICIENT'}</span></span>
        </button>`;
      }).join('');
    return `<div class="build-grid">${cards}</div>`;
  }

  private bindBuildCards(): void {
    this.root?.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const defId = btn.dataset.build;
        if (defId) this.app.beginPlacement(defId);
        if (this.layout === 'mobile') this.setPanel('none');
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Mode banner, logs, minimap, debug, end                              */
  /* ------------------------------------------------------------------ */

  private updateMode(force = false): void {
    if (!this.root) return;
    const banner = this.root.querySelector<HTMLElement>('#mode-banner');
    const text = this.root.querySelector('#mode-text');
    if (!banner || !text) return;
    if (this.app.mode === 'none') {
      banner.classList.add('hidden');
      if (this.modeCache !== 'none') {
        this.modeCache = 'none';
        this.root.querySelectorAll<HTMLElement>('.cmd-btn.active').forEach((b) => {
          b.classList.remove('active');
        });
      }
      return;
    }
    const labels: Record<string, string> = {
      move: 'MOVE — select a destination',
      attack: 'ATTACK — select a target',
      attackMove: 'ATTACK-MOVE — select a destination',
      capture: 'CAPTURE — select a strategic objective',
      repair: 'REPAIR — select a damaged friendly structure',
      garrison: 'GARRISON — select a building',
      box: 'BOX SELECT — drag across units',
      place: this.app.placeDefId ? `PLACE ${BUILDINGS[this.app.placeDefId]?.name.toUpperCase() ?? 'STRUCTURE'}` : 'PLACEMENT',
    };
    const next = labels[this.app.mode] ?? '';
    if (!force && next === this.modeCache) return;
    this.modeCache = next;
    text.textContent = next;
    banner.classList.remove('hidden');
    this.root.querySelectorAll<HTMLElement>('.cmd-btn').forEach((b) => {
      const act = b.dataset.act;
      b.classList.toggle('active', act === this.app.mode || (act === 'build' && this.app.mode === 'place'));
    });
  }

  log(text: string, level = 'info', tick = 0): void {
    this.logs.push({ text, level, tick });
    if (this.logs.length > 40) this.logs.shift();
    this.renderLog();
  }

  seedLog(game: Game): void {
    this.logs = [];
    const local = game.localPlayerId;
    for (const ev of game.state.events.slice(-30)) {
      if (ev.team === local || ev.type === 'buildingLost') this.logs.push({ text: ev.text, level: ev.level ?? 'info', tick: ev.tick });
    }
    this.renderLog();
  }

  private renderLog(): void {
    const list = this.root?.querySelector('#log-list');
    if (!list) return;
    list.innerHTML = this.logs
      .slice(-24)
      .reverse()
      .map((l) => `<div class="log-entry ${escapeHtml(l.level)}"><time>${fmtTime(l.tick)}</time><span>${escapeHtml(l.text)}</span></div>`)
      .join('');
  }

  /** Radar Array present, operational and not browned out. */
  private minimapIsOnline(): boolean {
    const game = this.game;
    if (!game) return false;
    const hasRadar = game
      .entitiesOf(this.app.localPlayerId, 'building')
      .some((e) => e.hp > 0 && !e.construction && !!BUILDINGS[e.defId]?.radar);
    return minimapStatus(hasRadar, game.powerStatus(this.app.localPlayerId).brownout).online;
  }

  private drawMinimap(): void {
    const game = this.game;
    const canvas = this.root?.querySelector<HTMLCanvasElement>('#minimap');
    if (!game || !canvas) return;
    const radar = game
      .entitiesOf(this.app.localPlayerId, 'building')
      .some((e) => e.hp > 0 && !e.construction && !!BUILDINGS[e.defId]?.radar);
    const status = minimapStatus(radar, game.powerStatus(this.app.localPlayerId).brownout);
    canvas.classList.toggle('static', !status.online);
    canvas.title = status.online
      ? 'Click to jump the camera'
      : status.reason === 'brownout'
        ? 'Radar offline — grid brownout'
        : 'Radar offline — build a Radar Array or capture a Radar Station';
    canvas.setAttribute(
      'aria-label',
      status.online ? 'Tactical map' : `Tactical map offline: ${status.reason === 'brownout' ? 'grid brownout' : 'no radar'}`,
    );
    const map = game.state.map;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (cssWidth < 2 || cssHeight < 2) return;
    const density = typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
    const backing = minimapBackingSize(cssWidth, cssHeight, density);
    if (canvas.width !== backing.width || canvas.height !== backing.height) {
      canvas.width = backing.width;
      canvas.height = backing.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pixelDensity = canvas.width / Math.max(1, cssWidth);
    if (!status.online) {
      this.drawRadarStatic(ctx, canvas, status.reason, pixelDensity);
      return;
    }
    if (!this.minimapTerrain) this.minimapTerrain = document.createElement('canvas');
    const terrain = this.minimapTerrain;
    if (terrain.width !== map.width || terrain.height !== map.height) {
      terrain.width = map.width;
      terrain.height = map.height;
    }
    const tctx = terrain.getContext('2d');
    if (!tctx) return;
    const fog = game.state.fog[game.player(game.localPlayerId)?.team ?? 0];
    for (let z = 0; z < map.height; z++) {
      for (let x = 0; x < map.width; x++) {
        const i = tileIndex(map.width, x, z);
        const t = TERRAIN[map.terrain[i] as TerrainId] ?? TERRAIN[Terrain.Grass];
        const [r, g, b] = t.color.map((v) => Math.round(v * 255));
        const visibility = fog?.[i] ?? 0;
        const shade = visibility === 2 ? 1 : visibility === 1 ? 0.55 : 0.22;
        tctx.fillStyle = `rgb(${Math.round(r * shade)},${Math.round(g * shade)},${Math.round(b * shade)})`;
        tctx.fillRect(x, z, 1, 1);
        if (map.ore[i] > 0 && visibility > 0) {
          tctx.fillStyle = `rgba(224,163,74,${0.35 + 0.55 * (visibility === 2 ? 1 : 0.5)})`;
          tctx.fillRect(x, z, 1, 1);
        }
      }
    }

    // The 96x72 tactical raster fills the dock so the picture and its click
    // mapping stay aligned with the previous HUD, but terrain is upscaled once
    // into the device-resolution canvas and markers are drawn over it crisp.
    const scaleX = canvas.width / map.width;
    const scaleY = canvas.height / map.height;
    const strokeScale = Math.min(scaleX, scaleY);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#071012';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(terrain, 0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (const e of game.state.entities) {
      if (e.hp <= 0) continue;
      // Garrisoned infantry are shown by their shelter marker.
      if (e.kind === 'unit' && e.garrisonId) continue;
      if (e.owner !== this.app.localPlayerId && !game.isVisibleTo(this.app.localPlayerId, e.id) && !game.contactsFor(this.app.localPlayerId).some((c) => c.entityId === e.id)) continue;
      const tx = e.x / TILE_SIZE;
      const tz = e.z / TILE_SIZE;
      ctx.fillStyle = e.owner === -1 ? '#c9d2ce' : ownerColor(game, e);
      if (e.kind === 'building') {
        const def = BUILDINGS[e.defId];
        ctx.fillRect(tx - (def?.footprint.w ?? 1) / 2, tz - (def?.footprint.h ?? 1) / 2, Math.max(2, def?.footprint.w ?? 2), Math.max(2, def?.footprint.h ?? 2));
      } else {
        ctx.fillRect(tx - 0.7, tz - 0.7, 1.8, 1.8);
      }
      if (this.app.selected.includes(e.id)) {
        ctx.strokeStyle = '#f1c27e';
        ctx.lineWidth = 1.25 / strokeScale;
        ctx.strokeRect(tx - 1.7, tz - 1.7, 3.6, 3.6);
      }
    }
    const v = this.app.renderer.camera.viewRect();
    ctx.strokeStyle = 'rgba(241,194,126,0.9)';
    ctx.lineWidth = 1 / strokeScale;
    ctx.strokeRect(v.x0 / TILE_SIZE, v.z0 / TILE_SIZE, (v.x1 - v.x0) / TILE_SIZE, (v.z1 - v.z0) / TILE_SIZE);
    ctx.restore();

    // A powered radar gets a slow phosphor sweep so the tactical picture
    // visibly refreshes even when the battle is paused or nothing moves. Draw
    // it in screen pixels so the circle stays circular despite the map stretch.
    ctx.save();
    const frame = ++this.minimapFrame;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.hypot(canvas.width, canvas.height) * 0.5;
    const sweep = frame * 0.028;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    for (let i = 0; i < 3; i++) {
      const angle = sweep - i * 0.09;
      ctx.strokeStyle = `rgba(224,163,74,${0.16 - i * 0.045})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(224,163,74,0.5)';
    ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
  }

  /**
   * Dead radar feed. Grain is regenerated at a third of the backing-store
   * resolution (cheap to animate, soft like an analogue signal) and rendered
   * underneath a crisp, device-pixel caption with rolling interference and
   * scanlines. Static here is presentation only and never touches the sim.
   */
  private drawRadarStatic(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    reason: 'no-radar' | 'brownout' | null,
    density: number,
  ): void {
    const w = canvas.width;
    const h = canvas.height;
    const frame = ++this.minimapFrame;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.72);
    glow.addColorStop(0, '#0d1f20');
    glow.addColorStop(0.65, '#071214');
    glow.addColorStop(1, '#030809');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const nw = Math.max(72, Math.round(w / 3));
    const nh = Math.max(48, Math.round(h / 3));
    if (!this.radarNoise) this.radarNoise = document.createElement('canvas');
    const noise = this.radarNoise;
    if (noise.width !== nw || noise.height !== nh) {
      noise.width = nw;
      noise.height = nh;
    }
    const nctx = noise.getContext('2d');
    if (nctx) {
      const image = nctx.createImageData(nw, nh);
      const data = image.data;
      let seed = (Math.imul(frame + 1, 1664525) + 1013904223) >>> 0;
      for (let i = 0; i < data.length; i += 4) {
        seed ^= seed << 13;
        seed >>>= 0;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        seed >>>= 0;
        const v = seed >>> 24;
        data[i] = 92 + (v & 63);
        data[i + 1] = 112 + ((v >>> 2) & 55);
        data[i + 2] = 108 + ((v >>> 4) & 47);
        data[i + 3] = v > 214 ? 150 : v > 146 ? 66 : 22;
      }
      nctx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.72;
      ctx.drawImage(noise, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    const bandY = ((frame * 9) % (h + 90)) - 45;
    const band = ctx.createLinearGradient(0, bandY - 26, 0, bandY + 26);
    band.addColorStop(0, 'rgba(190,230,220,0)');
    band.addColorStop(0.5, 'rgba(190,230,220,0.12)');
    band.addColorStop(1, 'rgba(190,230,220,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, bandY - 26, w, 52);

    const scan = Math.max(2, Math.round(3 * density));
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    for (let y = 0; y < h; y += scan) ctx.fillRect(0, y, w, 1);

    const vignette = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.18,
      w / 2, h / 2, Math.hypot(w, h) * 0.62,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    const mainFont = Math.max(13, Math.round(11 * density));
    const subFont = Math.max(9, Math.round(7.5 * density));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${mainFont}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    const main = 'RADAR OFFLINE';
    const mainWidth = ctx.measureText(main).width;
    ctx.font = `600 ${subFont}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    const sub = reason === 'brownout' ? 'GRID BROWNOUT · RESTORE POWER' : 'NO RADAR ARRAY · BUILD FROM BASE';
    const subWidth = ctx.measureText(sub).width;
    const pad = Math.round(12 * density);
    const plateW = Math.min(w - Math.round(16 * density), Math.max(mainWidth, subWidth) + pad * 2);
    const plateH = mainFont + subFont + Math.round(22 * density);
    const plateX = (w - plateW) / 2;
    const plateY = (h - plateH) / 2;
    ctx.fillStyle = 'rgba(3,8,9,0.8)';
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.strokeStyle = 'rgba(145,177,170,0.32)';
    ctx.lineWidth = Math.max(1, density);
    ctx.strokeRect(plateX + 0.5, plateY + 0.5, plateW - 1, plateH - 1);
    ctx.fillStyle = 'rgba(224,163,74,0.72)';
    ctx.fillRect(plateX, plateY, plateW, Math.max(1, density));
    ctx.font = `700 ${mainFont}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.fillStyle = '#d8e2dd';
    ctx.fillText(main, w / 2, h / 2 - subFont * 0.55);
    ctx.font = `600 ${subFont}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.fillStyle = 'rgba(224,163,74,0.92)';
    ctx.fillText(sub, w / 2, h / 2 + mainFont * 0.62);
  }

  private renderDebug(): void {
    if (!this.game || !this.root) return;
    const panel = this.root.querySelector('#debug-panel');
    if (!panel) return;
    const game = this.game;
    const sel = this.app.selectedEntities();
    const ai = game.state.ai;
    panel.innerHTML = `
      <b>MCA DIAGNOSTICS</b>
      <div class="section">FPS <b>${this.app.perf.fps}</b> · frame <b>${this.app.perf.frameMs}ms</b> · sim <b>${this.app.perf.simMs}ms</b></div>
      <div>entities <b>${game.stats().entities}</b> · units <b>${game.stats().units}</b> · projectiles <b>${game.stats().projectiles}</b></div>
      <div>tick <b>${game.state.tick}</b> · speed <b>${this.app.speed}×</b> · seed <b>${game.state.seed}</b></div>
      <div class="section">AI <b>${ai.phase}</b> · wave <b>${ai.attackWave}</b> · army <b>${ai.desiredArmy}</b></div>
      <div>${escapeHtml(ai.lastDecision)}</div>
      <div class="section">SELECTED ${sel.length} · GROUPS ${this.app.groups.size}</div>
      ${sel.slice(0, 6).map((e) => `<div>#${e.id} ${escapeHtml(e.defId)} · ${e.state} · ${Math.round(e.hp)}hp · [${Math.round(e.x)},${Math.round(e.z)}]</div>`).join('')}
      <div class="section">SIM ${game.stats().ms.toFixed(2)}ms · fog ${game.state.scenario.settings.fog ? 'on' : 'off'}</div>`;
  }

  showEnd(result: VictoryState): void {
    if (!this.game || !this.root || this.endShown) return;
    this.endShown = true;
    const p = this.app.localPlayer;
    const stats = p?.stats;
    const game = this.game;
    const victory = result === 'victory';
    const root = this.root.querySelector('#end-root');
    if (!root) return;
    const enemies = game.state.players.filter((q) => q.id !== this.app.localPlayerId);
    const enemyStats = enemies[0]?.stats;
    root.innerHTML = `
      <div class="end-screen">
        <div class="end-card">
          <span class="result">${result === 'draw' ? 'OPERATION ENDED' : victory ? 'OPERATION COMPLETE' : 'OPERATION FAILED'}</span>
          <h2 class="${victory ? '' : 'defeat'}">${result === 'draw' ? 'Stalemate' : victory ? 'Island Secured' : 'Beachhead Lost'}</h2>
          <p>${victory
            ? 'The 11th Expeditionary Corps command post is destroyed. Kestrel Bay is under Baltic control — land, air and sea were brought to bear as one force.'
            : 'Your command post has fallen. The expeditionary corps holds the island; a new plan and a new landing are required.'}</p>
          <div class="end-stats">
            <div><span>MISSION TIME</span><b>${fmtTime(game.state.tick)}</b></div>
            <div><span>UNITS BUILT</span><b>${stats?.unitsBuilt ?? 0}</b></div>
            <div><span>UNITS LOST</span><b>${stats?.unitsLost ?? 0}</b></div>
            <div><span>KILLS</span><b>${stats?.kills ?? 0}</b></div>
            <div><span>MATERIALS</span><b>${Math.round(stats?.matsGathered ?? 0)}</b></div>
            <div><span>STRUCTURES</span><b>${stats?.buildingsBuilt ?? 0}</b></div>
            <div><span>ENEMY LOSSES</span><b>${enemyStats?.unitsLost ?? 0}</b></div>
            <div><span>RELAYS</span><b>${p?.relayCount ?? 0}</b></div>
          </div>
          <div class="end-actions">
            <button class="btn btn-primary" data-end="restart">RESTART SCENARIO</button>
            <button class="btn btn-ghost" data-end="save">SAVE BATTLE</button>
            <button class="btn btn-ghost" data-end="editor">SCENARIO EDITOR</button>
            <button class="btn btn-ghost" data-end="menu">RETURN TO MENU</button>
          </div>
        </div>
      </div>`;
    root.querySelectorAll<HTMLElement>('[data-end]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.end;
        if (act === 'restart') void this.app.restart();
        if (act === 'save') this.app.openSaveMenu(false);
        if (act === 'editor') this.app.openEditor(game.state.scenario);
        if (act === 'menu') this.app.toMenu();
      });
    });
    this.app.audio.play(victory ? 'victory' : 'defeat');
  }
}

function primaryObjective(game: Game): string {
  const enemyHq = game.state.entities.find(
    (e) => e.owner !== game.localPlayerId && e.defId === 'commandPost' && e.hp > 0,
  );
  if (!enemyHq) return 'Enemy command destroyed — secure the island.';
  if (game.state.scenario.settings.victory === 'annihilation') return 'Destroy all enemy forces.';
  return 'Destroy the 11th Corps Command Post.';
}
