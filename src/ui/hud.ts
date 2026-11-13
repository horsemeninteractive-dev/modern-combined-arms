import type { App } from '../app';
import type { Game } from '../sim/game';
import type { Entity, VictoryState } from '../sim/types';
import {
  BUILDINGS,
  BUILDABLE_BY_PLAYER,
  buildingFamily,
  buildingRequirements,
  isIndestructibleStructure,
} from '../data/buildings';
import { UNITS } from '../data/units';
import {
  BRANCH_NAMES,
  BUILDING_MODULES,
  TECHS,
  installedModuleEffects,
  UNIT_UPGRADES,
  type TechDef,
} from '../data/research';
import { superweaponPresentation } from '../data/superweapons';
import { superweaponView, SUPERWEAPON_TARGET_LABEL } from './superweaponView';
import { abilityActions } from './abilityView';
import { moduleActions } from './moduleView';
import {
  activeResearchView,
  researchAuthorityNodes,
  researchBranchGroups,
  researchNames,
  researchNodeState,
  researchTechName,
} from './researchView';
import { ALLIANCES, tryIdentityDef } from '../data/factions';
import { TERRAIN, Terrain, tileIndex, type TerrainId } from '../sim/terrain';
import { REPAIR_SUPPRESSION_TICKS, TILE_SIZE } from '../sim/constants';
import { sensorFor } from '../sim/sensors';
import { PHASE_LABELS, formatHour } from '../sim/dayNight';
import { veterancyProgress } from '../sim/veterancy';
import { icon, iconSvg } from './icons';
import { escapeHtml } from './modal';
import {
  PRODUCTION_TABS,
  edgeAutoScrollVelocity,
  gridAlertCopy,
  minimapBackingSize,
  minimapStatus,
  cardArtState,
  productionBlockReason,
  productionCardState,
  productionDomain,
  resolveHudLayout,
  selectionChips,
  structureTab,
  toggleHudPanel,
  type HudLayout,
  type HudPanel,
  type ProductionTab,
  type SelectionChipView,
  type ThumbnailArtState,
} from './hudLayout';
import {
  GRID_LOAD_LABEL,
  gridLoadState,
  gridReport,
  powerBreakdownLines,
  powerReadout,
  type GridReport,
  type PowerReadout,
} from './powerReport';
import { ThumbnailRenderer } from '../render/thumbnails';
import { flagNationForFaction, flagTextureUrl } from '../render/flags';
import type { ThumbnailKind, ThumbnailRequest, ThumbnailShape } from '../render/thumbnailFrame';
import { objectiveMeterState } from './relayMeter';
import { ammoPips, fuelFraction, fuelPercent, supplyTone } from './bars';
import { campaignMissionObjectives, objectiveProgress } from './objectiveBrief';
import { missionObjectiveMarkup, missionObjectiveView } from './missionObjectiveView';
import { missionClock, missionDebriefMarkup, missionOutcomeCopy } from './missionDebrief';
import { structureBenefit } from '../sim/infrastructure';
import { contactAlpha, contactIsHollow, contactStateOf } from '../sim/contacts';
import { BUILD_COMMIT, VERSION_LINE } from '../version';

const DOMAIN_LABEL: Record<string, string> = { land: 'LAND', air: 'AIR', naval: 'SEA' };
/** Pause is where a bug report starts, so the exact build stays on screen. */
const PAUSE_BUILD = `${VERSION_LINE} · COMMIT ${BUILD_COMMIT}`;

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

/**
 * A sale is irreversible once the deconstruction clock starts, so the sell
 * control arms on the first click and only commits on a second one. The arm
 * lapses on its own, and a confirm inside the grace window is ignored so an
 * accidental double-click cannot sell a structure before the player has read
 * what they are confirming.
 */
const SALE_CONFIRM_MS = 5000;
const SALE_CONFIRM_GRACE_MS = 350;

/**
 * The sidebar's one cost line: amber **M** for materials, blue **R** for
 * requisition, then the build time. Chips keep the three quantities legible at
 * a glance instead of reading as one run-on string, and both card types share
 * it so a structure and a unit quote their price the same way.
 */
function costChips(mats: number, req: number, time: number): string {
  return `<span class="cost-chips">
    <span class="cost-chip mat"><b>${mats}</b>M</span>
    ${req > 0 ? `<span class="cost-chip req"><b>${req}</b>R</span>` : ''}
    <span class="cost-chip time"><b>${time}</b>s</span>
  </span>`;
}

/**
 * The structure's own grid figure, read at a glance beside its cost.
 * Positive is generation and negative is draw; a zero-power structure gets no
 * chip rather than a meaningless "0 PWR".
 */
function powerChip(power: number): string {
  if (power === 0) return '';
  const value = power > 0 ? `+${power}` : `${power}`;
  return `<span class="cost-chip power${power > 0 ? ' supply' : ''}"><b>${value}</b>PWR</span>`;
}

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
  // Selling is a visible countdown, not a silent disappearance: the structure
  // stays on the field until the clock runs out.
  if (e.deconstruct) return `DISMANTLING ${Math.ceil(e.deconstruct.remaining)}s`;
  if (e.garrisonId) return 'GARRISONED';
  if (e.kind === 'building') {
    if (e.queue.length > 0) return 'PRODUCING';
    return 'OPERATIONAL';
  }
  if (e.submarine) {
    if (e.submarine.dived) {
      return e.submarine.revealed
        ? 'DATUM EXPOSED'
        : `SUBMERGED ${Math.round(e.submarine.battery)}s`;
    }
    return `SURFACED ${Math.round((e.submarine.battery / e.submarine.maxBattery) * 100)}%`;
  }
  if (e.navalLanding) {
    if (e.navalLanding.beached) return 'BEACHED';
    return 'APPROACHING SHORE';
  }
  if (e.kind === 'unit' && UNITS[e.defId]?.domain === 'naval' && UNITS[e.defId]?.transport) {
    return 'AT SEA';
  }
  if (e.aircraft) {
    if (UNITS[e.defId]?.transport) {
      if (e.aircraft.roll?.next === 'fieldLand') return 'LANDING';
      if (e.aircraft.landed) return 'LANDED';
      if (e.aircraft.fieldLanding) return 'APPROACHING LZ';
      return 'AIRBORNE';
    }
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
  return p ? tryIdentityDef(p.factionId)?.color ?? '#d8e2dd' : '#d8e2dd';
}

export class HUD {
  private app: App;
  private root: HTMLElement | null = null;
  private game: Game | null = null;
  private tab: ProductionTab = 'base';
  private lastUpdate = 0;
  private lastMinimap = 0;
  private lastProductionKey = '';
  /**
   * Which rebuildable panel the pointer is currently inside.
   *
   * Both the production/research column and the selection card are rebuilt from
   * scratch, and the HUD refreshes them several times a second. A rebuild throws
   * away the hovered node, so a native tooltip never gets to open and a tooltip
   * already open flickers. While the pointer is inside a panel its rebuild is
   * deferred; the values resume the moment the pointer leaves.
   */
  private hoverPanel: 'prod' | 'selection' | null = null;
  /** Whether tooltip protection is currently armed for the hovered panel. */
  private hoverArmed = true;
  private hoverNode: Element | null = null;
  private pendingProductionKey = '';
  private pendingSelection = false;
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
  /** The sidebar currently shows the research tree rather than production. */
  private researchOpen = false;
  private selectedResearchTech: string | null = null;
  /** The sidebar currently shows strategic operations rather than production. */
  private strategicOpen = false;
  private hudEl: HTMLElement | null = null;
  /** HUD chrome hidden for a clean battlefield capture; the toggle stays. */
  private hudHidden = false;
  /**
   * Chrome put away for a cinematic. Kept apart from the player's own choice so
   * a scene gives the picture back exactly the interface the commander had:
   * someone who had already hidden the HUD with U still has it hidden after.
   */
  private cinemaHidden = false;
  /** Pending timer that takes the chrome out once the exit has played. */
  private hudAnimTimer = 0;
  private thumbnails: ThumbnailRenderer | null | undefined;
  /** Roster chip chosen for the detail card; cleared when it leaves the selection. */
  private inspectedId = 0;
  /** Structure whose sale is armed and waiting for its confirming click. */
  private sellArmed: number | null = null;
  /** When the arm was set, in performance-clock milliseconds. */
  private sellArmedAt = 0;
  private sellArmTimer = 0;
  /** The rail gauge's styled hover readout is open; desktop only. */
  private powerReadoutOpen = false;
  /** Until this timestamp, BASE cards that sit on the grid are called out. */
  private gridFocusUntil = 0;
  /** Last readout markup, so a hover does not rebuild six rows ten times a second. */
  private lastPowerReadoutKey = '';

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
    this.researchOpen = false;
    this.strategicOpen = false;
    this.selectedResearchTech = null;
    this.app.additiveSelection = false;
    this.lastProductionKey = '';
    this.hoverPanel = null;
    this.hoverArmed = true;
    this.hoverNode = null;
    this.pendingProductionKey = '';
    this.pendingSelection = false;
    this.suppressQueueClickUntil = 0;
    this.pausedCache = null;
    this.modeCache = '';
    this.hudHidden = false;
    this.powerReadoutOpen = false;
    this.gridFocusUntil = 0;
    this.lastPowerReadoutKey = '';
    const root = document.getElementById('hud-root');
    if (!root) return;
    this.root = root;
    this.layout = this.detectLayout();
    this.warmBattleArt();
    // `renderShell` applies visibility, which is also what starts the entrance:
    // the shell is assembled from the edges the moment it exists.
    this.renderShell();
  }

  unmount(): void {
    this.finishQueueDrag();
    if (this.root) this.root.innerHTML = '';
    this.root = null;
    this.hudEl = null;
    this.game = null;
    this.endShown = false;
    this.powerReadoutOpen = false;
    this.lastPowerReadoutKey = '';
    // Leaving the battlefield takes the scene with it. A shell that is mounted
    // next keeps whatever a launch set before it, which is how an opening scene
    // gets a first frame with no chrome on it.
    this.cinemaHidden = false;
  }

  /** Rebuild the active composition when the viewport crosses the layout point. */
  refreshLayout(): boolean {
    const next = this.detectLayout();
    if (next === this.layout && this.root) return false;
    this.layout = next;
    this.panel = 'none';
    this.researchOpen = false;
    this.strategicOpen = false;
    this.hoverPanel = null;
    this.hoverArmed = true;
    this.hoverNode = null;
    this.pendingProductionKey = '';
    this.pendingSelection = false;
    this.app.additiveSelection = false;
    this.powerReadoutOpen = false;
    this.lastPowerReadoutKey = '';
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
    // The rebuilt readout starts hidden, so the open flag has to follow it.
    this.powerReadoutOpen = false;
    this.lastPowerReadoutKey = '';
    this.bind();
    this.applyFrontColours();
    // A layout refresh rebuilds the shell; keep the player's capture state.
    this.applyHudVisibility();
    this.syncPanelState();
    this.renderResources();
    this.updateResearchRail();
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
   * Coalition flavour for the chrome.
   *
   * The rail and the mobile strip fly the colours of the side the local player
   * actually commands — defender-aligned commands read blue, the eastern
   * coalition red — with the nation's own shade marking its flag line. The
   * battlefield keeps the player's chosen team tint, so unit and marker
   * readability is untouched: this paints the command chrome only.
   */
  private applyFrontColours(): void {
    const root = this.root;
    const game = this.game;
    if (!root || !game) return;
    const player = game.player(game.localPlayerId);
    const faction = player ? tryIdentityDef(player.factionId) : undefined;
    const front = faction ? ALLIANCES[faction.allianceId] : undefined;
    root.style.setProperty('--front', front?.color ?? '#37b6e0');
    root.style.setProperty('--front-accent', front?.accent ?? '#a8ecff');
    root.style.setProperty('--front-nation', faction?.color ?? front?.color ?? '#37b6e0');
    // The skin is more than a tint: the eastern coalition reads as hard-edged
    // plate work while the defender coalition keeps the cooler instrument look.
    root.dataset.front = front?.id ?? 'defender';
  }

  /**
   * Desktop chrome is a full-height rail on the far left: landscape screens have
   * width to spare and almost none to lose. Resources, army size, objective,
   * control-group slots, mission time and the menu actions all live here, so the
   * battlefield keeps the full height between the rail and the production sidebar.
   */
  private railMarkup(game: Game): string {
    const p = game.player(game.localPlayerId);
    const faction = p ? tryIdentityDef(p.factionId) : undefined;
    // Two identities, in the order the rail reads them: the coalition the
    // command belongs to heads the rail, and the nation under its flag is the
    // country actually flying it. The title carries all three, so neither short
    // label has to.
    const front = faction ? ALLIANCES[faction.allianceId] : undefined;
    const nationLabel = faction?.shortName || faction?.name || 'TASK FORCE';
    const railTitle = faction
      ? `${front?.name ?? faction.allianceId} · ${faction.name}${
          faction.doctrine ? ` · ${faction.doctrine}` : ''
        }`
      : 'Task force';
    // The nation's real flag sits between the brand and the resources, with the
    // country named under it: whose flag is flying over this base.
    const nation = p ? flagNationForFaction(p.factionId) : undefined;
    return `
      <aside class="hud-rail" aria-label="Command rail">
        <!-- The rail scrolls as one column; the power gauge is bolted to its
             outer edge and does not scroll with it. -->
        <div class="rail-body">
          <header class="rail-command" title="${escapeHtml(railTitle)}">
            <div class="rail-identity">
              <span class="rail-flag-wrap">
                ${nation ? `<img class="rail-flag" src="${flagTextureUrl(nation)}" alt="${escapeHtml(nationLabel)} flag" />` : ''}
                <!-- The crest flies on the flag and takes the coalition's colour,
                     so the side a command belongs to reads without a word. -->
                <span class="rail-crest" aria-hidden="true"><i></i></span>
              </span>
              <span class="rail-nation">${front ? '<i></i>' : ''}${escapeHtml(nationLabel)}</span>
            </div>
          </header>
          <div class="rail-stats">
            <div class="rail-stat"><span class="rail-label"><i class="resource-swatch"></i>MATS</span><b id="res-mats">0</b><span class="rail-rate" id="res-mats-rate">+0/m</span></div>
            <div class="rail-stat req"><span class="rail-label"><i class="resource-swatch blue"></i>REQ</span><b id="res-req">0</b><span class="rail-rate" id="res-req-rate">+0.0/s</span></div>
          </div>
          <!-- The accord's crest, sitting in the open band between the
               requisition counter and the army counter. -->
          <div class="rail-insignia" aria-hidden="true"><i></i></div>
          <div class="rail-bottom">
            <div class="rail-tail">
              <div class="rail-stat rail-stat-army"><span class="rail-label">ARMY</span><b id="res-force">0</b><span class="rail-rate" id="res-force-sub">0 STRUCTURES</span></div>
            </div>
            <div class="rail-groups" aria-label="Control groups">${this.groupStripMarkup()}</div>
            <div class="rail-clock" title="Battlefield time of day — darkness shortens detection and engagement range"><span>MISSION</span><b id="clock">0:00</b><span class="clock-phase" id="clock-phase">DUSK</span></div>
            <!-- A 2x3 pad: the four battle controls, then the briefing across
                 the bottom row. The objective is an icon like its neighbours. -->
            <div class="rail-actions" aria-label="Mission controls">
              <button class="rail-btn" data-act="save" title="Save battle" aria-label="Save battle">${icon('save')}</button>
              <button class="rail-btn" data-act="pause" id="btn-pause-top" title="Pause (P)" aria-label="Pause battle">${icon('pause')}</button>
              <button class="rail-btn" data-act="settings" title="Settings" aria-label="Settings">${icon('settings')}</button>
              <button class="rail-btn" data-act="menu" title="Menu" aria-label="Menu">${icon('menu')}</button>
              <button class="rail-btn rail-objective" id="rail-objective-btn" data-act="objective" title="Primary objective — open the briefing" aria-haspopup="dialog">
                ${icon('target')}<span class="rail-label">BRIEF</span>
              </button>
            </div>
          </div>
        </div>
        <!-- Power is a gauge, not a fourth currency: a full-height column with
             the draw rising from the floor and the supply line marked. -->
        <div class="rail-power" id="rail-power" data-power-meter data-power-open data-act="power" role="meter" tabindex="0" aria-controls="prod-body" aria-describedby="power-readout" aria-label="Power grid load — activate to open BASE power structures" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="rail-power-track" aria-hidden="true">
            <i data-power-fill="v"></i>
            <span class="rail-power-cap hidden" data-power-cap></span>
          </div>
          <div class="rail-power-tags" aria-hidden="true">
            <span class="rail-power-state" data-power-state>NO LOAD</span>
            <span class="rail-power-caption">POWER</span>
            <span class="rail-power-read" data-power-read>0/0</span>
          </div>
        </div>
      </aside>
      ${this.powerReadoutMarkup()}`;
  }

  /**
   * The gauge's hover readout. It lives outside the rail because the rail clips
   * its own contents; it opens over the battlefield beside the gauge and never
   * takes the pointer, so the readout cannot flicker as it tracks the grid.
   */
  private powerReadoutMarkup(): string {
    return `<div class="power-readout hidden" id="power-readout" aria-hidden="true">
      <div class="pr-head">
        <span class="pr-state" data-pr-state>NO LOAD</span>
        <b class="pr-totals" data-pr-totals>0 DRAW / 0 SUPPLY</b>
      </div>
      <div class="pr-cols">
        <div class="pr-col source"><span class="pr-title">GENERATORS</span><ul data-pr-sources></ul></div>
        <div class="pr-col draw"><span class="pr-title">DRAW</span><ul data-pr-consumers></ul></div>
      </div>
      <div class="pr-foot"><span><b>CLICK</b> OPEN BASE · POWER STRUCTURES</span></div>
    </div>`;
  }

  /** Mobile keeps a thin top strip: touch screens need the vertical pixels. */
  private mobileTopbarMarkup(game: Game): string {
    const p = game.player(game.localPlayerId);
    const nation = p ? flagNationForFaction(p.factionId) : undefined;
    const nationLabel = this.identityShort(game);
    return `
      <header class="mobile-topbar">
        <!-- The flag and the MCA crest, exactly as the desktop rail flies them:
             the crest takes the coalition's colour over the national flag. -->
        <span class="mobile-flag-wrap">
          ${nation ? `<img class="mobile-flag" src="${flagTextureUrl(nation)}" alt="${escapeHtml(nationLabel)} flag" />` : ''}
          <span class="mobile-crest" aria-hidden="true"><i></i></span>
        </span>
        <span class="mobile-nation" title="${escapeHtml(this.identityTitle(game))}">${escapeHtml(nationLabel)}</span>
        <div class="mobile-stats">
          <div class="mobile-stat"><span>MATS</span><b id="res-mats">0</b></div>
          <div class="mobile-stat req"><span>REQ</span><b id="res-req">0</b></div>
        </div>
        <!-- Army strength and the objective sit with the battle actions at the
             far right, so the resource counters own the middle of the strip. -->
        <div class="mobile-actions">
          <div class="mobile-stat army"><span>ARMY</span><b id="res-force">0</b></div>
          <button class="mobile-objective-icon" data-act="objective" title="Primary objective — open the briefing" aria-label="Primary objective — open the briefing" aria-haspopup="dialog">${icon('target')}</button>
          <button class="mobile-action" data-act="save" title="Save battle" aria-label="Save battle">${icon('save')}</button>
          <button class="mobile-action" data-act="pause" id="btn-pause-top" title="Pause (P)" aria-label="Pause battle">${icon('pause')}</button>
          <button class="mobile-action" data-act="settings" title="Settings" aria-label="Settings">${icon('settings')}</button>
          <button class="mobile-action" data-act="menu" title="Menu" aria-label="Menu">${icon('menu')}</button>
        </div>
      </header>
      <!-- The desktop gauge laid on its side: a full-width draw bar under the
           command strip, so the grid reads at a glance in landscape too. -->
      <div class="mobile-power-strip" id="mobile-power" data-power-meter role="meter" aria-label="Power grid load" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" title="Grid power">
        <span>POWER</span>
        <div class="power-bar"><i data-power-fill></i></div>
        <b data-power-read>0/0</b>
      </div>`;
  }

  /**
   * Every order the strip can offer. `data-cmd` is what
   * `renderCommands()` toggles; a button exists here only if some selection
   * could legitimately use it. The separator after the combat orders is a
   * `data-cmd` so it disappears with them instead of leaving a stray rule.
   */
  private commandButtons(mobile: boolean): string {
    return `
      <div class="command-bar" role="toolbar" aria-label="Commands">
        <button class="cmd-btn" data-cmd="move" data-act="move" title="${mobile ? 'Move selected units — tap a destination' : 'Move selected units — click a destination'}">${icon('move')}<span class="lbl">MOVE</span></button>
        <button class="cmd-btn" data-cmd="attack" data-act="attack" title="Attack target (then tap/click)">${icon('attack')}<span class="lbl">ATTACK</span></button>
        <button class="cmd-btn" data-cmd="attackMove" data-act="attackMove" title="Attack-move (A)">${icon('attackMove')}<span class="lbl">A-MOVE</span><kbd class="cmd-key" aria-hidden="true">A</kbd></button>
        <div class="cmd-sep" data-cmd="combatSep"></div>
        <button class="cmd-btn" data-cmd="stop" data-act="stop" title="Stop (S)">${icon('stop')}<span class="lbl">STOP</span><kbd class="cmd-key" aria-hidden="true">S</kbd></button>
        <button class="cmd-btn" data-cmd="hold" data-act="hold" title="Hold position (H)">${icon('hold')}<span class="lbl">HOLD POS</span><kbd class="cmd-key" aria-hidden="true">H</kbd></button>
        <button class="cmd-btn" data-cmd="capture" data-act="capture" title="Capture a strategic objective (C)">${icon('capture')}<span class="lbl">CAPTURE</span><kbd class="cmd-key" aria-hidden="true">C</kbd></button>
        <button class="cmd-btn" data-cmd="repair" data-act="repair" title="Repair a damaged structure, or resume your own construction site (then tap/click it)">${icon('repair')}<span class="lbl">REPAIR</span></button>
        <button class="cmd-btn" data-cmd="garrison" data-act="garrison" title="Board a transport or garrison a building (G)">${icon('garrison')}<span class="lbl">GARRISON</span><kbd class="cmd-key" aria-hidden="true">G</kbd></button>
        <button class="cmd-btn" data-cmd="ungarrison" data-act="ungarrison" title="Unload a transport or order infantry out of a building">${icon('ungarrison')}<span class="lbl">EXIT</span></button>
        <button class="cmd-btn" data-cmd="return" data-act="return" title="Return aircraft / ship to base (R)">${icon('return')}<span class="lbl">RETURN</span><kbd class="cmd-key" aria-hidden="true">R</kbd></button>
        <button class="cmd-btn" data-cmd="land" data-act="land" title="Land transport helicopters on open ground (then tap/click)">${icon('transportHelo')}<span class="lbl">LAND</span></button>
        <button class="cmd-btn" data-cmd="dive" data-act="dive" title="Dive or surface selected submarines (D)">${icon('submarine')}<span class="lbl">DIVE</span><kbd class="cmd-key" aria-hidden="true">D</kbd></button>
        <div class="cmd-sep" data-cmd="supportSep"></div>
        ${mobile ? '' : `<button class="cmd-btn accent" data-cmd="build" data-act="build" title="Construction (B)">${icon('build')}<span class="lbl">BUILD</span><kbd class="cmd-key" aria-hidden="true">B</kbd></button>
        <button class="cmd-btn" data-cmd="research" data-act="research" title="Research tree — unlock units and structures">${icon('research')}<span class="lbl">RESEARCH</span></button>`}
        <button class="cmd-btn" data-cmd="box" data-act="box" title="Box selection">${icon('box')}<span class="lbl">BOX</span></button>
        ${mobile ? `<button class="cmd-btn" data-cmd="groups" data-act="groups" title="Control groups">${icon('squad')}<span class="lbl">GROUPS</span></button>
        <button class="cmd-btn" data-cmd="map" data-act="map" title="Tactical map">${icon('scope')}<span class="lbl">MAP</span></button>` : ''}
        <button class="cmd-btn" data-cmd="debug" data-act="debug" title="Debug overlay (F3)">${icon('log')}<span class="lbl">DIAG</span></button>
      </div>`;
  }

  /**
   * Show only the orders the current selection can actually issue. A tank has
   * no garrison, repair or capture order, so those buttons disappear; a mixed
   * group keeps every capability at least one member has, because the command
   * is dispatched to that subset only.
   */
  private renderCommands(): void {
    const root = this.root;
    const game = this.game;
    if (!root || !game) return;
    const own = this.app.ownSelected();
    const units = own.filter((e) => e.kind === 'unit');
    const has = (predicate: (e: (typeof units)[number]) => boolean): boolean =>
      units.some(predicate);
    const armed = has((e) => (UNITS[e.defId]?.weapons?.length ?? 0) > 0);
    const show: Record<string, boolean> = {
      move: own.length > 0,
      attack: armed,
      attackMove: armed,
      combatSep: armed,
      stop:
        units.length > 0 ||
        own.some(
          (e) => e.kind === 'building' && (BUILDINGS[e.defId]?.weapons?.length ?? 0) > 0,
        ),
      hold: units.length > 0,
      capture: has((e) => !!UNITS[e.defId]?.canCapture && !e.garrisonId),
      repair: has((e) => !!UNITS[e.defId]?.canBuild),
      garrison: has((e) => !!UNITS[e.defId]?.canGarrison && !e.garrisonId),
      ungarrison:
        units.some((e) => !!e.garrisonId) ||
        this.app.selectedEntities().some((e) => {
          if (e.kind !== 'building' && !UNITS[e.defId]?.transport) return false;
          if (e.kind === 'unit') {
            const domain = UNITS[e.defId]?.domain;
            if (domain === 'air' || domain === 'naval') {
              return e.owner === this.app.localPlayerId;
            }
          }
          return game
            .garrisonOccupants(e.id)
            .some((occupant) => occupant.owner === this.app.localPlayerId);
        }),
      return: has((e) => {
        const domain = UNITS[e.defId]?.domain;
        return domain === 'air' || domain === 'naval';
      }),
      land: has(
        (e) =>
          UNITS[e.defId]?.domain === 'air' &&
          !!UNITS[e.defId]?.transport &&
          !!e.aircraft,
      ),
      dive: has((e) => !!UNITS[e.defId]?.submarine),
      supportSep: true,
      build: true,
      research: true,
      box: true,
      groups: true,
      map: true,
      debug: true,
    };
    root.querySelectorAll<HTMLElement>('[data-cmd]').forEach((button) => {
      const key = button.dataset.cmd ?? '';
      button.hidden = !(show[key] ?? true);
    });
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
    // Research is the last entry in the production rail rather than a separate
    // control elsewhere: it belongs to the same panel it opens, and its bar
    // keeps an active project visible while the tree is closed.
    const researchTab = `<button class="prod-tab research-tab" id="rail-research" data-act="research" aria-label="Research" aria-haspopup="dialog" aria-expanded="false" title="Research tree">${icon('research', 'tab-icon')}<span class="rail-label">RESEARCH</span><span class="tab-research-bar"><i data-research-rail-fill></i></span></button>`;
    // The strategic tab exists only for a nation that actually fields a
    // capability in a battle that permits one, so no nation is shown an empty
    // slot it can never fill.
    const strategicTab = `<button class="prod-tab strategic-tab hidden" id="rail-strategic" data-act="strategic" aria-label="Strategic operations" aria-haspopup="dialog" aria-expanded="false" title="Strategic operations">${icon('strategic', 'tab-icon')}<span class="rail-label">STRAT</span><span class="tab-strategic-bar"><i data-strategic-pip></i></span></button>`;
    return `<aside class="production-sidebar" aria-label="Production">
      <nav class="prod-tabs" id="prod-tabs" aria-label="Production categories">
        ${tabs}
        ${researchTab}
        ${strategicTab}
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

  /**
   * The one control that survives hiding the HUD, so a screenshot can be taken
   * of the battlefield alone and the interface brought back without a menu trip.
   */
  private hudToggleMarkup(): string {
    return `<button class="hud-toggle" data-act="hud-toggle" aria-pressed="false" title="Hide HUD (U) — clean battlefield for screenshots" aria-label="Hide HUD">${icon('eyeOff')}<span>HUD</span></button>`;
  }

  private desktopMarkup(game: Game): string {
    return `<div class="hud layout-desktop">
      ${this.hudToggleMarkup()}
      ${this.railMarkup(game)}
      <div class="mode-banner hidden" id="mode-banner">
        <span id="mode-text"></span>
        <button data-act="cancel-mode">CANCEL [ESC]</button>
      </div>
      ${this.productionMarkup()}
      <div class="perf-readout hidden" id="perf-readout" aria-hidden="true"></div>
      <section class="battle-console hud-bottom">
        <div class="console-actions">${this.commandButtons(false)}</div>
        ${this.selectionPanelMarkup()}
      </section>
      <div class="debug-panel hidden" id="debug-panel"></div>
      <div class="pause-overlay hidden" id="pause-overlay">
        <div class="pause-card"><span class="eyebrow">SIMULATION HALTED</span><h2>PAUSED</h2><p>Issue orders, inspect the battlefield, then resume.</p><p class="pause-build">${escapeHtml(PAUSE_BUILD)}</p><button class="btn btn-primary" data-act="pause">RESUME</button><button class="btn btn-ghost pause-copy" data-act="copy-diagnostics">COPY DIAGNOSTICS</button></div>
      </div>
      <div id="end-root"></div>
    </div>`;
  }

  private mobileMarkup(game: Game): string {
    return `<div class="hud layout-mobile">
      ${this.hudToggleMarkup()}
      ${this.mobileTopbarMarkup(game)}
      <div class="mode-banner hidden" id="mode-banner">
        <span id="mode-text"></span>
        <button data-act="cancel-mode">CANCEL</button>
      </div>
      ${this.productionMarkup()}
      <div class="perf-readout hidden" id="perf-readout" aria-hidden="true"></div>
      <button class="mobile-backdrop" data-act="close-sheets" aria-label="Close panel"></button>
      <section class="mobile-sheet objective-sheet" role="dialog" aria-label="Primary objective">
        <div class="sheet-head"><span>PRIMARY OBJECTIVE</span><button class="sheet-close" data-act="close-sheets" aria-label="Close objective">×</button></div>
        <div class="objective-sheet-body"><h3 data-objective-primary></h3><p data-objective-sub></p><ul class="objective-sheet-list" data-objective-list hidden></ul><p class="sheet-note" data-objective-note>Capture signals relays for requisition, forward supply depots for supplementary materials and radar stations for reconnaissance. Destroy the enemy command post to win the battle.</p></div>
      </section>
      <section class="mobile-sheet selection-sheet" role="dialog" aria-label="Selection">
        <div class="sheet-head"><span>SELECTION</span><span class="mono" id="sel-count">NONE</span><button class="sheet-clear" data-act="clear-selection" title="Clear the selection" hidden>CLEAR</button><button class="sheet-close" data-act="close-sheets" aria-label="Close selection">×</button></div>
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
          <button class="roster-clear" data-act="clear-selection" title="Clear the selection" hidden>CLEAR</button>
          <button class="add-toggle" data-act="add-select" aria-pressed="false" title="Add tapped units to the selection">ADD</button>
        </div>
        <div class="mobile-command-row">${this.commandButtons(true)}</div>
      </section>
      <div class="debug-panel hidden" id="debug-panel"></div>
      <div class="pause-overlay hidden" id="pause-overlay">
        <div class="pause-card"><span class="eyebrow">SIMULATION HALTED</span><h2>PAUSED</h2><p>Issue orders, inspect the battlefield, then resume.</p><p class="pause-build">${escapeHtml(PAUSE_BUILD)}</p><button class="btn btn-primary" data-act="pause">RESUME</button><button class="btn btn-ghost pause-copy" data-act="copy-diagnostics">COPY DIAGNOSTICS</button></div>
      </div>
      <div id="end-root"></div>
    </div>`;
  }

  private bind(): void {
    const root = this.root;
    if (!root) return;
    // Hover tracking for the two panels that are rebuilt wholesale. Assigned on
    // the containers, which outlive the inner HTML they hold, so one listener
    // each survives every re-render.
    const prodBody = root.querySelector<HTMLElement>('#prod-body');
    if (prodBody) {
      prodBody.addEventListener('pointerenter', () => {
        this.hoverPanel = 'prod';
        this.hoverArmed = true;
        this.hoverNode = null;
      });
      prodBody.addEventListener('pointermove', (event: PointerEvent) => this.rearmHover(event));
      prodBody.addEventListener('pointerleave', () => this.releaseHover('prod'));
    }
    const selectionBody = root.querySelector<HTMLElement>('#selection-body');
    if (selectionBody) {
      selectionBody.addEventListener('pointerenter', () => {
        this.hoverPanel = 'selection';
        this.hoverArmed = true;
        this.hoverNode = null;
      });
      selectionBody.addEventListener('pointermove', (event: PointerEvent) => this.rearmHover(event));
      selectionBody.addEventListener('pointerleave', () => this.releaseHover('selection'));
    }
    // Delegated and assigned (not added), so a repeated mount or bind can never
    // install a second handler and make a click toggle twice.
    root.onclick = (event: MouseEvent) => {
      this.handleHudClick(event);
      // A click is a deliberate change and takes priority over tooltip
      // protection: without this the panel a player just clicked (start
      // research, queue a unit) sat frozen until the pointer left it, so the
      // command appeared to do nothing. Protection re-arms on the next move.
      if (this.hoverPanel) {
        this.hoverArmed = false;
        this.flushHover(this.hoverPanel);
      }
    };
    // The rail gauge is the grid's own control: hovering (or focusing) it opens
    // the breakdown, and activating it turns the sidebar to the structures on
    // the grid. The gauge is rebuilt with the shell, so these listeners are
    // re-attached with it rather than delegated from the document.
    const gauge = root.querySelector<HTMLElement>('[data-power-open]');
    if (gauge) {
      gauge.addEventListener('pointerenter', () => this.setPowerReadout(true));
      gauge.addEventListener('pointerleave', () => this.setPowerReadout(false));
      gauge.addEventListener('focus', () => this.setPowerReadout(true));
      gauge.addEventListener('blur', () => this.setPowerReadout(false));
      gauge.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          this.setPowerReadout(false);
          gauge.blur();
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.focusGridStructures();
        }
      });
    }
    this.bindMinimap();
  }

  /**
   * Every control in the shell clicks, not just the ones that reach a command
   * handler: tabs, cards and sheet buttons used to be silent, which made the
   * whole panel feel like a picture rather than a console. One delegated cue
   * covers them, and the engine's minimum gap collapses the duplicate when the
   * action it triggers also plays its own feedback.
   */
  private clickCue(target: Element | null): void {
    const control = target?.closest<HTMLElement>('button, [role="button"]');
    if (!control) return;
    const unavailable = control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true';
    if (unavailable) {
      this.app.audio.play('denied');
      return;
    }
    const act = control.dataset.act;
    if (control.dataset.sellCancel !== undefined || act === 'cancel-mode' || act === 'close-sheets') {
      this.app.audio.play('cancel');
      return;
    }
    this.app.audio.play('ui');
  }

  private handleHudClick(event: MouseEvent): void {
    const root = this.root;
    if (!root) return;
    const target = event.target as Element | null;
    this.clickCue(target);
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
    // A collapsed type card narrows the selection to that type instead of
    // opening a single hull; the count is preserved in the panel header.
    const typeCard = target?.closest<HTMLElement>('[data-select-type]');
    if (typeCard && root.contains(typeCard)) {
      this.app.narrowSelectionToType(typeCard.dataset.selectType ?? '');
      return;
    }
    const tabEl = target?.closest<HTMLElement>('[data-tab]');
    if (tabEl && root.contains(tabEl)) {
      const next = (tabEl.dataset.tab as typeof this.tab) ?? 'base';
      const close =
        this.layout === 'mobile' &&
        this.panel === 'production' &&
        this.tab === next &&
        !this.researchOpen &&
        !this.strategicOpen;
      this.researchOpen = false;
      this.strategicOpen = false;
      this.tab = next;
      root.querySelector('.hud')?.classList.remove('research-open');
      root.querySelector('.hud')?.classList.remove('strategic-open');
      root.querySelectorAll('.prod-tab').forEach((b) => b.classList.toggle('active', b === tabEl));
      this.renderProduction(true);
      this.updateResearchRail();
      if (this.layout === 'mobile') this.setPanel(close ? 'none' : 'production');
    }
  }

  private bindMinimap(): void {
    const root = this.root;
    if (!root) return;
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
        // The map is a control like any other: one cue on the press, never per
        // move, so dragging the view does not rattle.
        if (!this.minimapIsOnline()) {
          this.app.audio.play('denied');
          return;
        }
        this.app.audio.play('ui');
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

  /**
   * Hide the chrome for a clean battlefield capture. The toggle is the only
   * element left, and it flips its own icon so the way back is obvious.
   */
  private setHudHidden(hidden: boolean): void {
    this.hudHidden = hidden;
    this.applyHudVisibility(true);
  }

  /**
   * Put the chrome away while a scene owns the frame, and bring it back after.
   *
   * A cinematic drops it without animation — the opening scene begins on the
   * same frame the battle mounts, and a chrome bar sliding out over the first
   * shot reads as a glitch — while the return plays the usual entrance so the
   * interface reassembles rather than popping back. A HUD the player had already
   * hidden stays hidden.
   */
  setCinemaHidden(hidden: boolean): void {
    if (this.cinemaHidden === hidden) return;
    this.cinemaHidden = hidden;
    this.applyHudVisibility(!hidden);
  }

  /** True while the chrome is off screen for any reason. */
  private get chromeHidden(): boolean {
    return this.hudHidden || this.cinemaHidden;
  }

  /** U — the same toggle the pill offers, for a keyboard capture. */
  toggleVisibility(): void {
    this.setHudHidden(!this.hudHidden);
  }

  /**
   * Both directions are staged. Leaving plays the entry choreography backwards
   * and only then takes the panels out of the document, so the capture is clean
   * and the chrome cannot hold focus while it is gone; arriving plays the same
   * choreography forwards again. `animate` is false on mount — a fresh shell is
   * already entering — and on the layout refresh that preserves the state.
   */
  private applyHudVisibility(animate = false): void {
    const hud = this.hudEl;
    if (!hud) return;
    const hidden = this.chromeHidden;
    const button = hud.querySelector<HTMLButtonElement>('.hud-toggle');
    if (button) {
      // The toggle reports the commander's own choice, not a scene's.
      button.setAttribute('aria-pressed', String(this.hudHidden));
      button.classList.toggle('is-off', this.hudHidden);
      button.title = this.hudHidden ? 'Show HUD (U)' : 'Hide HUD (U) — clean battlefield for screenshots';
      button.setAttribute('aria-label', this.hudHidden ? 'Show HUD' : 'Hide HUD');
      button.innerHTML = `${icon(this.hudHidden ? 'eye' : 'eyeOff')}<span>HUD</span>`;
    }
    window.clearTimeout(this.hudAnimTimer);
    if (hidden) {
      hud.classList.remove('hud-enter');
      // Already off screen: nothing to play, and replaying the exit would put
      // the chrome back on screen for the length of the animation.
      if (!animate || hud.classList.contains('hud-hidden')) {
        hud.classList.remove('hud-exit');
        hud.classList.add('hud-hidden');
        return;
      }
      hud.classList.remove('hud-hidden');
      hud.classList.add('hud-exit');
      this.hudAnimTimer = window.setTimeout(() => {
        hud.classList.remove('hud-exit');
        hud.classList.add('hud-hidden');
      }, 300);
      return;
    }
    hud.classList.remove('hud-hidden', 'hud-exit');
    if (!animate) {
      hud.classList.add('hud-enter');
      return;
    }
    // The class has to be absent for a frame before it is re-applied, or the
    // browser sees no change and skips the entrance.
    hud.classList.remove('hud-enter');
    void hud.offsetWidth;
    hud.classList.add('hud-enter');
  }

  private action(act: string): void {
    switch (act) {
      case 'pause':
        this.app.togglePause();
        break;
      case 'hud-toggle':
        this.setHudHidden(!this.hudHidden);
        break;
      case 'copy-diagnostics':
        void this.app.copyDiagnostics();
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
      case 'land':
        this.app.setMode('land');
        break;
      case 'dive':
        this.app.commandDive();
        break;
      case 'power':
        this.focusGridStructures();
        break;
      case 'grid-fix':
        this.setResearchOpen(false);
        this.selectTab('base');
        this.app.beginPlacement('powerPlant');
        if (this.layout === 'mobile') this.setPanel('none');
        break;
      case 'build':
        this.setResearchOpen(false);
        this.selectTab('base');
        this.renderSelection(true);
        if (this.layout === 'mobile') this.setPanel('production');
        break;
      case 'research':
        this.toggleResearch();
        break;
      case 'strategic':
        this.toggleStrategic();
        break;
      case 'strategic-close':
        this.setStrategicOpen(false);
        break;
      case 'strategic-fire':
        this.app.beginSuperweaponTargeting();
        break;
      case 'research-close':
        this.setResearchOpen(false);
        break;
      case 'research-start':
        this.startSelectedResearch();
        break;
      case 'research-cancel':
        this.app.cancelResearch();
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
      case 'clear-selection':
        this.app.setSelection([]);
        this.setPanel('none');
        break;
      case 'close-sheets':
        this.setResearchOpen(false);
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
      this.updateResearchRail();
      this.updateStrategicRail();
      // A hovered panel keeps its DOM: rebuilding it under the pointer is what
      // made the research nodes' tooltips flash instead of opening.
      if (this.hoverPanel === 'selection' && this.hoverArmed) this.pendingSelection = true;
      else this.renderSelection();
      this.renderGroups();
      this.renderAddMode();
      this.decorateThumbnails();
      // The mission stopwatch keeps the big slot; the authoritative battlefield
      // clock and its phase ride underneath it, so neither hides the other.
      const dn = game.dayNight;
      const clock = this.root.querySelector('#clock');
      if (clock) clock.textContent = fmtTime(game.state.tick);
      const phase = this.root.querySelector('#clock-phase');
      if (phase) {
        phase.textContent = `${formatHour(dn.hour)} ${PHASE_LABELS[dn.phase].toUpperCase()}`;
        phase.classList.toggle('is-night', dn.night > 0.6);
        phase.classList.toggle('is-transition', dn.night > 0.15 && dn.night < 0.85);
      }
      const project = game.researchState(this.app.localPlayerId)?.project;
      const researchKey = `${this.researchOpen ? 1 : 0}|${this.selectedResearchTech ?? ''}|${game.completedTechnologies(this.app.localPlayerId).join(',')}|${project?.techId ?? ''}|${game.hasResearchCentre(this.app.localPlayerId) ? 1 : 0}`;
      // The strategic panel is a status display, so its key carries the state
      // words and the rounded clocks: the panel re-renders when a gate opens or
      // a countdown crosses a second, and never on an idle frame.
      const sw = game.superweaponStatus(this.app.localPlayerId);
      const swKey = `${this.strategicOpen ? 1 : 0}|${sw.ok ? 1 : 0}|${sw.hasCentre ? 1 : 0}|${sw.missingTechs.length}|${sw.phase}|${Math.ceil(sw.cooldown)}|${Math.ceil(sw.countdown)}|${sw.operation ? 1 : 0}|${sw.affordable ? 1 : 0}`;
      const key = `${signature}|${this.tab}|${this.selectedKey()}|${Math.floor((this.app.localPlayer?.mats ?? 0) / 40)}|${Math.floor((this.app.localPlayer?.req ?? 0) / 20)}|${researchKey}|${swKey}`;
      if (key !== this.lastProductionKey) {
        if (this.hoverPanel === 'prod' && this.hoverArmed) {
          this.pendingProductionKey = key;
        } else {
          this.lastProductionKey = key;
          this.renderProduction();
        }
      }
      if (this.app.debug) this.renderDebug();
      this.renderPerfReadout();
    }
    // Training progress is presentation state and must follow every animation
    // frame, not the throttled HUD refresh: sampling it at 110 ms made the
    // radial wipe visibly step instead of sweep.
    this.refreshProductionProgress();
    this.refreshResearchProgress();
    if (now - this.lastMinimap > 50) {
      this.lastMinimap = now;
      this.drawMinimap();
    }
    void dt;
  }

  /** Optional frame-rate badge; presentation-only and never part of the sim. */
  private renderPerfReadout(): void {
    const el = this.root?.querySelector<HTMLElement>('#perf-readout');
    if (!el) return;
    const on = this.app.settings.fpsReadout === true;
    el.classList.toggle('hidden', !on);
    if (!on) return;
    const perf = this.app.perf;
    el.textContent = `${perf.fps} FPS · ${perf.frameMs.toFixed(1)} ms · SIM ${perf.simMs.toFixed(2)} ms · ${perf.entities} ENT`;
  }

  /**
   * Leaving a panel flushes whatever its hover deferred, so a card never stays
   * stale only because the pointer happened to be resting on it.
   */
  private releaseHover(name: 'prod' | 'selection'): void {
    if (this.hoverPanel !== name) return;
    this.hoverPanel = null;
    this.hoverArmed = true;
    this.hoverNode = null;
    this.flushHover(name);
  }

  /**
   * Tooltip protection is only for a pointer that is *resting* on something.
   * Moving onto a different node — a different card, or the rebuilt version of
   * the one under the cursor — re-arms it.
   */
  private rearmHover(event: PointerEvent): void {
    const node = event.target as Element | null;
    if (node === this.hoverNode) return;
    this.hoverNode = node;
    this.hoverArmed = true;
  }

  /** Apply whatever a panel's hover (or a click in it) deferred. */
  private flushHover(name: 'prod' | 'selection'): void {
    if (name === 'selection' && this.pendingSelection) {
      this.pendingSelection = false;
      this.renderSelection(true);
    }
    if (
      name === 'prod' &&
      this.pendingProductionKey &&
      this.pendingProductionKey !== this.lastProductionKey
    ) {
      this.lastProductionKey = this.pendingProductionKey;
      this.pendingProductionKey = '';
      this.renderProduction();
    }
  }

  private selectedKey(): string {
    return this.app.selected.join(',');
  }

  showBuildTab(): void {
    this.setResearchOpen(false);
    this.selectTab('base');
    this.renderSelection(true);
    if (this.layout === 'mobile') this.setPanel('production');
  }

  cycleTab(): void {
    const tabs = PRODUCTION_TABS.map((t) => t.id);
    const index = tabs.indexOf(this.tab);
    this.selectTab(tabs[(index + 1) % tabs.length]);
  }

  /** Open or close the research tree without leaving the battlefield. */
  private toggleResearch(): void {
    this.setResearchOpen(!this.researchOpen);
  }

  private setResearchOpen(open: boolean): void {
    const wasOpen = this.researchOpen;
    this.researchOpen = open;
    if (open) {
      const game = this.game;
      const projectTech = game?.researchState(this.app.localPlayerId)?.project?.techId;
      if (!this.selectedResearchTech || !TECHS[this.selectedResearchTech] || !wasOpen) {
        const techs = game?.research.techs ?? [];
        const done = new Set(game?.completedTechnologies(this.app.localPlayerId) ?? []);
        this.selectedResearchTech =
          (projectTech && TECHS[projectTech] ? projectTech : null) ??
          techs.find((tech) => !done.has(tech.id))?.id ??
          techs[0]?.id ??
          null;
      }
    }
    if (this.layout === 'mobile') {
      if (open) this.panel = 'production';
      else if (this.panel === 'production') this.panel = 'none';
      this.syncPanelState();
    }
    // The tree is the one sidebar view that needs more than a card column: two
    // tier nodes side by side plus a detail block do not fit the production
    // width, so the shell widens only while it is open.
    if (open) this.closeStrategicPanel();
    this.root?.querySelector('.hud')?.classList.toggle('research-open', open);
    this.root?.querySelectorAll<HTMLElement>('.prod-tab').forEach((tab) => {
      tab.classList.toggle(
        'active',
        !this.researchOpen && !this.strategicOpen && tab.dataset.tab === this.tab,
      );
    });
    this.lastProductionKey = '';
    this.renderProduction(true);
    this.updateResearchRail();
  }

  private selectResearchTech(techId: string): void {
    if (!TECHS[techId]) return;
    this.selectedResearchTech = techId;
    this.lastProductionKey = '';
    this.renderProduction(true);
  }

  /** Queue the selected node; the authoritative tick owns the project state. */
  private startSelectedResearch(): void {
    const techId = this.selectedResearchTech;
    if (!techId || !TECHS[techId]) return;
    this.app.startResearch(techId);
    // Never mark the node active here. The next authoritative update changes
    // the project and the normal keyed render picks it up.
    this.lastProductionKey = '';
  }

  /* Strategic operations                                                  */

  private toggleStrategic(): void {
    this.setStrategicOpen(!this.strategicOpen);
  }

  /**
   * Open or close the strategic panel.
   *
   * Only one sidebar view is ever open, so opening this closes research and the
   * production tabs. The shell widens for it exactly as it does for the tree:
   * a requirement list and a status block need more than a card column.
   */
  private setStrategicOpen(open: boolean): void {
    this.strategicOpen = open;
    if (open) {
      this.researchOpen = false;
      this.root?.querySelector('.hud')?.classList.remove('research-open');
    }
    if (this.layout === 'mobile') {
      if (open) this.panel = 'production';
      else if (this.panel === 'production') this.panel = 'none';
      this.syncPanelState();
    }
    this.root?.querySelector('.hud')?.classList.toggle('strategic-open', open);
    this.root?.querySelectorAll<HTMLElement>('.prod-tab').forEach((tab) => {
      tab.classList.toggle(
        'active',
        !this.researchOpen && !this.strategicOpen && tab.dataset.tab === this.tab,
      );
    });
    this.lastProductionKey = '';
    this.renderProduction(true);
    this.updateStrategicRail();
  }

  /** Closing this view never touches the draft, the mission or the selection. */
  private closeStrategicPanel(): void {
    if (!this.strategicOpen) return;
    this.strategicOpen = false;
    this.root?.querySelector('.hud')?.classList.remove('strategic-open');
  }

  /**
   * One national capability, its four gates and its clock.
   *
   * Everything shown here is read from the authoritative status, so the panel
   * cannot claim a call-in is ready while the command would refuse it. A nation
   * with no capability, or a battle that forbids one, still renders a coherent
   * explanation rather than a broken shell.
   */
  private superweaponMarkup(): string {
    const game = this.game;
    const p = this.app.localPlayer;
    if (!game || !p) return '<div class="prod-empty">Strategic operations are unavailable.</div>';
    const owner = this.app.localPlayerId;
    const status = game.superweaponStatus(owner);
    const family = status.family;
    const identity = tryIdentityDef(p.factionId);
    const presentation = family
      ? superweaponPresentation(family, identity?.allianceId)
      : null;
    const view = superweaponView(status, presentation);
    const centreRow = `<li class="sw-req ${status.hasCentre ? 'done' : 'pending'}">
      <span class="sw-req-mark" aria-hidden="true">${status.hasCentre ? '✓' : '○'}</span>
      <span class="sw-req-name">Strategic Operations Centre</span>
      <span class="sw-req-state">${status.hasCentre ? 'OPERATIONAL' : 'MISSING'}</span>
    </li>`;
    const techRows = view.requirements
      .map(
        (row) => `<li class="sw-req ${row.ready ? 'done' : 'pending'}">
        <span class="sw-req-mark" aria-hidden="true">${row.ready ? '✓' : '○'}</span>
        <span class="sw-req-name">${escapeHtml(row.name)}</span>
        <span class="sw-req-state">${row.ready ? 'COMPLETE' : 'REQUIRED'}</span>
      </li>`,
      )
      .join('');
    const operationRow = status.operation
      ? `<div class="sw-operation" role="status">
          <span class="sw-operation-phase">${escapeHtml(view.label)}</span>
          <span class="sw-operation-clock" data-sw-clock>${escapeHtml(view.clock)}</span>
        </div>`
      : '';
    const costBlock = view.cost
      ? `<div class="sw-cost">${costChips(view.cost.mats, view.cost.req, view.warningSeconds)}<span class="sw-cost-note">${view.cooldownSeconds}s NATIONAL RELOAD</span></div>`
      : '';
    const targetBlock = view.targeting
      ? `<div class="sw-target"><span>TARGETING</span><b>${escapeHtml(view.targetLabel)}</b><p>${escapeHtml(view.canFire ? SUPERWEAPON_TARGET_LABEL[view.targeting] : 'Available once the capability is ready.')}</p></div>`
      : '';
    return `<div class="strategic-panel" data-sw-tone="${view.tone}">
      <header class="strategic-head">
        <div><span class="eyebrow">STRATEGIC OPERATIONS</span><h3>${escapeHtml(view.name)}</h3><p class="strategic-role">${escapeHtml(view.role)}</p></div>
        <button class="research-close" data-act="strategic-close" aria-label="Close strategic operations">×</button>
      </header>
      <section class="strategic-state sw-${view.tone}" aria-live="polite">
        <div class="sw-state-head"><span class="sw-state-label">${escapeHtml(view.label)}</span>${view.clock && !status.operation ? `<span class="sw-state-clock" data-sw-clock>${escapeHtml(view.clock)}</span>` : ''}</div>
        <p class="sw-state-detail">${escapeHtml(view.detail)}</p>
        ${operationRow}
        ${costBlock}
        <button class="strategic-fire" data-act="strategic-fire" ${view.canFire ? '' : 'disabled'} title="${escapeHtml(view.canFire ? 'Choose a target on the map' : view.detail)}">${view.canFire ? 'AUTHORISE OPERATION' : 'UNAVAILABLE'}</button>
      </section>
      ${view.description ? `<p class="strategic-desc">${escapeHtml(view.description)}</p>` : ''}
      <section class="sw-reqs" aria-label="Authorisation requirements">
        <div class="sw-reqs-head"><span>AUTHORITY CHAIN</span><span>${status.missingTechs.length === 0 && status.hasCentre ? 'COMPLETE' : `${4 - status.missingTechs.length + (status.hasCentre ? 1 : 0)}/5`}</span></div>
        <ul>${centreRow}${techRows}</ul>
      </section>
      ${targetBlock}
      <p class="strategic-foot">Losing the centre blocks new authorisations but never cancels a committed operation or resets its reload.</p>
    </div>`;
  }

  /**
   * Rail state for the strategic tab.
   *
   * The tab is hidden entirely for a nation without a capability, and for a
   * battle that forbids one, so the rail never advertises a dead end.
   */
  private updateStrategicRail(): void {
    const rail = this.root?.querySelector<HTMLElement>('#rail-strategic');
    const game = this.game;
    if (!rail || !game) return;
    const owner = this.app.localPlayerId;
    const status = game.superweaponStatus(owner);
    const present = status.enabled && !!status.family;
    rail.classList.toggle('hidden', !present);
    rail.classList.toggle('active', this.strategicOpen);
    rail.setAttribute('aria-expanded', String(this.strategicOpen));
    const identity = this.app.localPlayer ? tryIdentityDef(this.app.localPlayer.factionId) : undefined;
    const view = superweaponView(
      status,
      status.family ? superweaponPresentation(status.family, identity?.allianceId) : null,
    );
    rail.dataset.state = view.tone;
    const pip = rail.querySelector<HTMLElement>('[data-strategic-pip]');
    if (pip) pip.dataset.state = view.tone;
    // The tooltip names the state and its clock only; a ticking number is
    // rounded so hovering does not restart the browser tooltip every second.
    const clock = view.clock ? ` · ${view.clock}` : '';
    const title = present ? `${view.name} — ${view.label}${clock}` : 'Strategic operations';
    if (rail.title !== title) rail.title = title;
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
    if (requested !== 'production') this.researchOpen = false;
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
    // The rail shows load, not two numbers: the bar is demand against supply,
    // full and red on a deficit. Exact figures stay in the tooltip and the
    // screen-reader value so the grid reads at a glance like a meter.
    const load =
      power.demand === 0
        ? 0
        : power.supply <= 0
          ? 1
          : Math.min(1, power.demand / power.supply);
    const loadState = GRID_LOAD_LABEL[gridLoadState(power.supply, power.demand, power.brownout)];
    // The desktop gauge opens a styled readout carrying the same grouped
    // snapshot the structure cards use, so a deficit can be traced to the
    // structures causing it without reading a native tooltip. The touch meter
    // keeps the native title: a phone has no hover to open a panel with.
    const grid =
      this.powerReadoutOpen || this.layout === 'mobile' ? this.currentGridReport() : null;
    const gridTitle = grid ? powerBreakdownLines(grid).join('\n') : '';
    this.root.querySelectorAll<HTMLElement>('[data-power-meter]').forEach((meter) => {
      meter.classList.toggle('brownout', power.brownout);
      meter.classList.toggle('strained', !power.brownout && loadState === 'STRAINED');
      meter.setAttribute('aria-valuenow', String(Math.round(load * 100)));
      meter.setAttribute(
        'aria-valuetext',
        `${loadState.toLowerCase()} — ${power.supply} supply for ${power.demand} demand`,
      );
      if (
        !meter.hasAttribute('data-power-open') &&
        gridTitle &&
        meter.title !== gridTitle
      ) {
        meter.setAttribute('title', gridTitle);
      }
    });
    // The gauge scales to whichever is larger, supply or demand, so a deficit
    // is visible as height as well as colour: the column fills to the brim and
    // the amber supply line drops below it, marking exactly how short the grid
    // is. In a healthy grid the supply line sits at the top of the column.
    const scale = Math.max(power.supply, power.demand, 1);
    const drawRatio = power.demand / scale;
    const supplyRatio = power.supply / scale;
    this.root.querySelectorAll<HTMLElement>('[data-power-fill]').forEach((fill) => {
      if (fill.dataset.powerFill === 'v') {
        fill.style.height = `${Math.round(drawRatio * 100)}%`;
        return;
      }
      fill.style.width = `${Math.round(load * 100)}%`;
    });
    this.root.querySelectorAll<HTMLElement>('[data-power-cap]').forEach((cap) => {
      cap.style.bottom = `${Math.round(supplyRatio * 100)}%`;
      cap.classList.toggle('hidden', !power.brownout);
    });
    this.root.querySelectorAll<HTMLElement>('[data-power-read]').forEach((read) => {
      read.textContent = `${power.demand}/${power.supply}`;
    });
    this.root
      .querySelectorAll<HTMLElement>('[data-power-state]')
      .forEach((label) => (label.textContent = loadState));
    if (this.powerReadoutOpen && grid) this.renderPowerReadout(grid);
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
    // On a deficit every draw chip turns red, so the cards themselves show
    // where the demand is coming from while the meter shows how far short it is.
    this.root
      .querySelectorAll<HTMLElement>('.build-card .cost-chip.power:not(.supply)')
      .forEach((chip) => chip.classList.toggle('deficit', power.brownout));
    // The radar card is the answer to the collapsed tactical map: keep it
    // flagged in BASE whenever the local player has no operational radar.
    const radarOnline = this.minimapIsOnline();
    this.root
      .querySelectorAll<HTMLElement>('[data-build="radar"]')
      .forEach((card) => card.classList.toggle('suggested', !radarOnline));
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

  /** Open or close the gauge's styled readout; opening fills it at once. */
  private setPowerReadout(open: boolean): void {
    const el = this.root?.querySelector<HTMLElement>('#power-readout');
    // No readout on touch: there is no hover to open one, and the mobile meter
    // keeps its native tooltip.
    if (!el) return;
    this.powerReadoutOpen = open;
    this.lastPowerReadoutKey = '';
    el.classList.toggle('hidden', !open);
    el.setAttribute('aria-hidden', String(!open));
    this.root?.querySelector('[data-power-open]')?.classList.toggle('reading', open);
    if (open) this.renderResources();
  }

  /**
   * The gauge readout: state, totals, and the largest generators and draws with
   * a bar scaled to the biggest line in its own column. Built as one string so
   * an unchanged frame never tears down the rows under the pointer.
   */
  private renderPowerReadout(grid: GridReport): void {
    const el = this.root?.querySelector<HTMLElement>('#power-readout');
    if (!el) return;
    const view = powerReadout(grid);
    const column = (
      list: PowerReadout['sources'],
      hidden: number,
      empty: string,
    ): string =>
      list.length === 0
        ? `<li class="pr-empty">${empty}</li>`
        : `${list
            .map(
              (row) => `<li>
                <div class="pr-line">
                  <span class="pr-name">${escapeHtml(row.name)}${
                    row.count > 1 ? `<em>×${row.count}</em>` : ''
                  }</span>
                  <span class="pr-val">${row.total > 0 ? '+' : ''}${row.total}</span>
                </div>
                <span class="pr-track"><i style="width:${Math.round(row.share * 100)}%"></i></span>
              </li>`,
            )
            .join('')}${hidden > 0 ? `<li class="pr-more">+${hidden} more</li>` : ''}`;
    const sources = column(view.sources, view.hiddenSources, 'No generation standing');
    const consumers = column(view.consumers, view.hiddenConsumers, 'No structures drawing');
    const key = `${view.state}|${view.demand}|${view.supply}|${sources}|${consumers}`;
    if (key === this.lastPowerReadoutKey) return;
    this.lastPowerReadoutKey = key;
    el.classList.toggle('idle', view.state === 'idle');
    el.classList.toggle('stable', view.state === 'stable');
    el.classList.toggle('strained', view.state === 'strained');
    el.classList.toggle('brownout', view.state === 'brownout');
    const state = el.querySelector('[data-pr-state]');
    if (state) state.textContent = view.label;
    const totals = el.querySelector('[data-pr-totals]');
    if (totals) totals.textContent = `${view.demand} DRAW / ${view.supply} SUPPLY`;
    const sourceList = el.querySelector('[data-pr-sources]');
    if (sourceList) sourceList.innerHTML = sources;
    const consumerList = el.querySelector('[data-pr-consumers]');
    if (consumerList) consumerList.innerHTML = consumers;
  }

  /**
   * Activating the gauge: the BASE tab, with the structures the readout lists
   * called out and the turbine plant brought into view. The sidebar is a single
   * card column, so "focused on power" means the grid's contributors are
   * marked and reachable, not that every other structure disappears.
   */
  private focusGridStructures(): void {
    if (!this.game) return;
    this.setPowerReadout(false);
    this.gridFocusUntil = performance.now() + 2800;
    if (this.strategicOpen) this.setStrategicOpen(false);
    this.setResearchOpen(false);
    this.selectTab('base');
    if (this.layout === 'mobile') this.setPanel('production');
    requestAnimationFrame(() => this.revealGridCard());
    window.setTimeout(() => {
      this.root
        ?.querySelectorAll('.build-card.grid-focus')
        .forEach((card) => card.classList.remove('grid-focus'));
    }, 2900);
  }

  /** Centre the power plant card in the BASE column and hand it focus. */
  private revealGridCard(): void {
    const body = this.root?.querySelector<HTMLElement>('#prod-body');
    if (!body) return;
    const card =
      body.querySelector<HTMLButtonElement>('[data-build="powerPlant"]') ??
      body.querySelector<HTMLButtonElement>('.build-card.grid-focus');
    if (!card) return;
    const bodyRect = body.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    if (cardRect.top < bodyRect.top || cardRect.bottom > bodyRect.bottom) {
      body.scrollTop +=
        cardRect.top - bodyRect.top - Math.max(0, (bodyRect.height - cardRect.height) / 2);
    }
    if (!card.disabled) card.focus({ preventScroll: true });
  }

  private renderObjective(): void {
    if (!this.game || !this.root) return;
    const game = this.game;
    const progress = objectiveProgress(game);
    // A mission reads its own authoritative objective tree. Skirmish keeps the
    // command-post copy and relay tally it has always shown.
    const mission = missionObjectiveView(game);
    const headline = mission ? mission.headline : progress.primary;
    const summary = mission ? mission.summary : progress.summary;
    const flagged = progress.commandPostLost || (mission?.failedCount ?? 0) > 0;
    this.root.querySelectorAll<HTMLElement>('[data-objective-sub]').forEach((sub) => {
      sub.textContent = summary;
      sub.classList.toggle('bad', flagged);
    });
    this.root.querySelectorAll<HTMLElement>('[data-objective-primary]').forEach((primary) => {
      primary.textContent = headline;
    });
    // The rail is only a button now: the hint carries the objective copy on
    // hover, and a lost command post or failed objective flags the button.
    const railObjective = this.root.querySelector<HTMLElement>('#rail-objective-btn');
    if (railObjective) {
      railObjective.classList.toggle('bad', flagged);
      railObjective.setAttribute('title', `${headline} — open the briefing`);
    }
    // The touch sheet and the briefing have room for the full list; the rail
    // shows the primary alone. Campaign content is resolved from campaign data
    // so a save written before objective authoring still shows the brief.
    const list = this.root.querySelector<HTMLElement>('[data-objective-list]');
    if (list) {
      const lines = mission ? [...mission.supporting, ...mission.resolved] : [];
      const operationObjectives = campaignMissionObjectives(game).filter(
        (objective) => objective.trim().length > 0,
      );
      const supporting = operationObjectives.slice(1);
      list.innerHTML = mission
        ? lines.map((line) => missionObjectiveMarkup(line)).join('')
        : supporting.map((objective) => `<li>${escapeHtml(objective)}</li>`).join('');
      list.hidden = mission ? lines.length === 0 : supporting.length === 0;
    }
    const note = this.root.querySelector<HTMLElement>('[data-objective-note]');
    if (note) {
      note.hidden = mission ? true : campaignMissionObjectives(game).some((o) => o.trim().length > 0);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Selection                                                           */
  /* ------------------------------------------------------------------ */

  private teamColor(): string {
    const p = this.app.localPlayer;
    return p ? tryIdentityDef(p.factionId)?.color ?? '#d8e2dd' : '#d8e2dd';
  }

  /** Compact, registry-backed nation label for the touch top strip. */
  private identityShort(game: Game): string {
    const p = game.player(game.localPlayerId);
    const identity = p ? tryIdentityDef(p.factionId) : undefined;
    return identity?.shortName || identity?.name || 'TASK FORCE';
  }

  private identityTitle(game: Game): string {
    const p = game.player(game.localPlayerId);
    const identity = p ? tryIdentityDef(p.factionId) : undefined;
    if (!identity) return 'Task force';
    const alliance = ALLIANCES[identity.allianceId];
    const label = alliance ? `${identity.name} · ${alliance.name}` : identity.name;
    return identity.doctrine ? `${label} · ${identity.doctrine}` : label;
  }

  /**
   * Card art carries its availability the way the card does: a full model when
   * the player can buy it now, greyed when it is unlocked but unaffordable, and
   * a black silhouette when the technology is still missing.
   */
  private thumbMarkup(
    kind: ThumbnailKind,
    defId: string,
    color: string,
    shape: ThumbnailShape,
    iconName: string,
    className = '',
    badge = 0,
    artState: ThumbnailArtState = 'ready',
  ): string {
    const classes = ['thumb-frame', className, artState === 'ready' ? '' : `state-${artState}`]
      .filter(Boolean)
      .join(' ');
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
      portraitColors.add(tryIdentityDef(player.factionId)?.color ?? '#d8e2dd');
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
    this.renderCommands();
    const entities = this.app.selectedEntities();
    // A sale only stays armed while its structure is still the thing on screen.
    if (this.sellArmed !== null && !entities.some((s) => s.id === this.sellArmed)) {
      this.disarmSale();
    }
    const countText = entities.length === 0 ? 'NONE' : `${entities.length} SELECTED`;
    this.root.querySelectorAll<HTMLElement>('#sel-count').forEach((count) => {
      count.textContent = countText;
    });
    this.root.querySelectorAll<HTMLElement>('.sheet-clear').forEach((clear) => {
      clear.hidden = entities.length === 0;
    });
    // The strip's clear control only has work to do once a group is selected:
    // one unit is deselected by tapping it again.
    this.root.querySelectorAll<HTMLElement>('.roster-clear').forEach((clear) => {
      clear.hidden = entities.length <= 1;
    });
    this.root.querySelector('.mobile-console')?.classList.toggle('has-selection', entities.length > 0);
    this.root.querySelector('.selection-panel')?.classList.toggle('empty-selection', entities.length === 0);
    this.renderRoster(entities);
    const body = this.root.querySelector('#selection-body');
    if (!body) return;
    if (entities.length === 0) {
      const hint = this.layout === 'mobile'
        ? 'Tap a unit or drag a box. Tap the battlefield to move; tap an enemy to attack. Use GARRISON to occupy a building or board an APC.'
        : 'Click a unit or drag a box. Right-click to move or attack. Engineers capture objectives and repair structures; infantry can garrison buildings or board an APC.';
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
      // The breakdown is one line of the status column: a stack of rows would
      // be taller than the band at a small interface scale and clip the tail of
      // the list, so the mix is a single ellipsised line that names every type.
      const mix = [...types.entries()].sort((a, b) => b[1] - a[1]);
      const mixLine = mix.map(([id, n]) => `${UNITS[id]?.shortName ?? id} ×${n}`).join(' · ');
      const composition = mixLine
        ? `<div class="group-mix"><span title="${escapeHtml(mixLine)}">${escapeHtml(mixLine)}</span></div>`
        : '';
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
    const isFriendly = e.owner >= 0 && !game.isHostile(e.owner, this.app.localPlayerId);
    const isEnemy = e.owner !== this.app.localPlayerId && p && game.isHostile(e.owner, this.app.localPlayerId);
    const frac = clamp01(e.hp / e.maxHp);
    const iconName = def?.icon ?? 'target';
    const objective = BUILDINGS[e.defId]?.capturable ? objectiveMeterState(game, e) : null;
    const garrisonDef = e.kind === 'building' ? BUILDINGS[e.defId]?.garrison : undefined;
    const transportDef = e.kind === 'unit' ? UNITS[e.defId]?.transport : undefined;
    const occupants =
      garrisonDef || (transportDef && isFriendly) ? game.garrisonOccupants(e.id) : [];
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
    // Repair is suspended while a structure is being hit, so say so where the
    // player is already looking for the integrity bar instead of leaving a
    // stalled bar unexplained.
    const underFire =
      e.kind === 'building' &&
      e.hp > 0 &&
      e.hp < e.maxHp &&
      game.state.tick - e.lastHitTick < REPAIR_SUPPRESSION_TICKS;
    const integrityBlock =
      e.kind !== 'building' || isIndestructibleStructure(e.defId)
        ? ''
        : `<div class="hp-block"><div class="hp-label"><span>INTEGRITY</span><span>${Math.ceil(e.hp)}/${Math.ceil(e.maxHp)}</span></div><div class="hp-bar"><i class="${hpClass(frac)}" style="width:${frac * 100}%"></i></div>${underFire ? '<div class="hp-note"><span>UNDER FIRE</span><span>REPAIR SUSPENDED</span></div>' : ''}</div>`;
    const vitalBlock = `${controlBlock}${integrityBlock}`;
    let stats = '';
    if (e.kind === 'unit' && def && 'speed' in def) {
      // A round is a cartridge, not a dot: spent rounds stay on the rail as
      // empty slots, so the rack's capacity is legible after it is drained.
      const pips = ammoPips(e.ammo, e.maxAmmo);
      const ammo =
        pips.length > 0
          ? `<div class="supply-row"><div class="supply-pips" aria-hidden="true">${pips.map((live) => `<i class="${live ? '' : 'spent'}"></i>`).join('')}</div><b>${e.ammo}/${e.maxAmmo}</b></div>`
          : `<b>—</b>`;
      const fuelFrac = e.maxFuel > 0 ? fuelFraction(e.fuel, e.maxFuel) : 0;
      const fuel =
        e.maxFuel > 0
          ? `<div class="supply-row"><div class="supply-meter ${supplyTone(fuelFrac)}" aria-hidden="true"><i style="width:${fuelPercent(e.fuel, e.maxFuel)}%"></i></div><b>${fuelPercent(e.fuel, e.maxFuel)}%</b></div>`
          : `<b>—</b>`;
      // Rank is the crew's own record, so it sits beside the state rather than
      // buried under the hull figures: a Veteran crew is a reason to keep the
      // unit alive and a reason to expect more from it.
      const vet = veterancyProgress(e);
      const rankText = vet.next
        ? `${vet.rank.name} · ${Math.round(vet.fraction * 100)}%`
        : `${vet.rank.name} · MAX`;
      stats = `
        <div class="stat-grid">
          <div class="stat"><span>STATE</span><b>${escapeHtml(stateLabel(e))}</b></div>
          <div class="stat"><span>RANK</span><b title="${escapeHtml(vet.rank.hint)}">${escapeHtml(rankText)}</b></div>
          <div class="stat"><span>SPEED</span><b>${def.speed.toFixed(1)} m/s</b></div>
          <div class="stat"><span>AMMO</span>${ammo}</div>
          <div class="stat"><span>FUEL</span>${fuel}</div>
        </div>`;
    } else if (e.kind === 'building' && def) {
      const q = e.queue[0];
      // A value that does not fit its cell is ellipsised, so it carries the
      // full sentence in its title rather than losing it.
      const benefitFull = BUILDINGS[e.defId] ? structureBenefit(BUILDINGS[e.defId]) : '';
      const benefit = benefitFull
        ? benefitFull
            .replace(' requisition/s', ' req/s')
            .replace(' materials/s', ' mat/s')
            .replace('-tile scan', ' tile scan')
        : '';
      const power = BUILDINGS[e.defId]?.power ?? 0;
      // A retrofit is part of the structure's supply, so the card reports the
      // grid contribution the simulation actually counts, not the bare hull.
      const modulePower = installedModuleEffects(e.modules ?? []).power;
      const gridPower = power + modulePower;
      const powerTitle = modulePower
        ? `Structure ${power > 0 ? `+${power}` : power} · modules ${modulePower > 0 ? `+${modulePower}` : modulePower}`
        : '';
      const compactState = e.construction
        ? `BUILDING ${Math.round(e.buildProgress * 100)}%`
        : e.deconstruct
          ? `DISMANTLING ${Math.ceil(e.deconstruct.remaining)}s`
          : objective
          ? objective.progress > 0
            ? `CAPTURING ${Math.round(objective.progress * 100)}%`
            : objective.owner >= 0
              ? 'CONTROLLED'
              : 'NEUTRAL'
          : stateLabel(e);
      stats = `
        <div class="stat-grid">
          <div class="stat"><span>STATE</span><b title="${escapeHtml(compactState)}">${escapeHtml(compactState)}</b></div>
          <div class="stat"><span>${benefit ? 'BENEFIT' : 'QUEUE'}</span><b title="${escapeHtml(benefitFull)}">${benefit ? escapeHtml(benefit) : `${e.queue.length}${q ? ` · ${UNITS[q.defId]?.shortName ?? q.defId}` : ''}`}</b></div>
          <div class="stat"><span>VISION</span><b>${def.vision} tiles</b></div>
          <div class="stat"><span>SENSORS</span><b title="${escapeHtml(sensorFor(e).label)}">${escapeHtml(sensorFor(e).label)}</b></div>
          <div class="stat"><span>POWER</span><b${powerTitle ? ` title="${escapeHtml(powerTitle)}"` : ''}>${gridPower > 0 ? `+${gridPower}` : `${gridPower}`}</b></div>
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
    if (transportDef) {
      const occupancy = Math.min(transportDef.capacity, occupants.length);
      const names = [...new Set(occupants.map((u) => UNITS[u.defId]?.shortName ?? u.defId))];
      const mix = names.length > 0 ? ` · ${names.join(' + ')}` : ' · EMPTY';
      const airState = e.aircraft
        ? e.aircraft.roll?.next === 'fieldLand'
          ? ' · LANDING'
          : e.aircraft.landed
            ? ' · LANDED'
            : ' · AIRBORNE'
        : '';
      const seaState = e.navalLanding
        ? e.navalLanding.beached
          ? ' · BEACHED'
          : ' · APPROACHING SHORE'
        : UNITS[e.defId]?.domain === 'naval'
          ? ' · AT SEA'
          : '';
      statusLines += `<div class="sel-line"><span>PASSENGERS ${occupancy}/${transportDef.capacity}${airState}${seaState}${escapeHtml(mix)}</span><b>${Math.max(0, transportDef.capacity - occupancy)} SPACES</b></div>`;
    }
    if (e.deconstruct) {
      const quote = game.sellQuote(e.id);
      statusLines += `<div class="sel-line"><span>DISMANTLING</span><b>${Math.ceil(e.deconstruct.remaining)}s · ${quote?.mats ?? 0}M/${quote?.req ?? 0}R REFUND</b></div>`;
    }
    // Aircraft positions are the facility's real capacity, so the card reports
    // them from the simulation: how many of each kind are parked, and whether a
    // helicopter pad is recovery-only.
    const flightLine = e.kind === 'building' ? game.dockStatus(e.id) : null;
    if (flightLine && (flightLine.fixedWing.capacity > 0 || flightLine.helo.capacity > 0)) {
      // Assigned is the permanent capacity the production gate reads; the rest
      // explains where those hulls are, because "3/4" alone cannot tell a
      // commander whether the missing one is on the apron, on approach or still
      // in the queue. Zero parts are dropped so the row stays one line.
      const describe = (occ: typeof flightLine.fixedWing, label: string): string => {
        const parts = [`${label} ASSIGNED ${occ.used}/${occ.capacity}`];
        parts.push(`PARKED ${occ.parked}`);
        if (occ.inbound > 0) parts.push(`INBOUND ${occ.inbound}`);
        if (occ.airborne > 0) parts.push(`AIRBORNE ${occ.airborne}`);
        if (occ.queued > 0) parts.push(`QUEUED ${occ.queued}`);
        return parts.join(' · ');
      };
      const parts: string[] = [];
      if (flightLine.fixedWing.capacity > 0) {
        parts.push(describe(flightLine.fixedWing, 'FLIGHT LINE'));
      }
      if (flightLine.helo.capacity > 0) {
        parts.push(
          `${describe(
            flightLine.helo,
            flightLine.helo.temporary ? 'HELO PAD' : 'HELO BAYS',
          )}${flightLine.helo.temporary ? ' · RECOVERY ONLY' : ''}`,
        );
      }
      statusLines += `<div class="sel-line"><span>AIRCRAFT</span><b>${escapeHtml(parts.join(' | '))}</b></div>`;
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
            <div class="sel-title"><h3>${escapeHtml(def?.name ?? e.defId)}</h3><span>${p ? escapeHtml(tryIdentityDef(p.factionId)?.shortName || p.name) : 'NEUTRAL'}${isOwn ? '' : isEnemy ? ' · HOSTILE' : ''}</span></div>
            <div class="sel-role">${escapeHtml(roleText)}</div>
          </div>
        </div>
        ${vitalBlock ? `<div class="sel-vitals">${vitalBlock}</div>` : ''}
      </div>
      <div class="sel-stats">${stats}</div>
      <div class="sel-notes">
        ${statusLines}
        ${hint ? `<div class="sel-hint">${hint}</div>` : ''}
      </div>
      <div class="sel-squares">
        ${isOwn ? this.abilityButtons([e]) : ''}
        ${isOwn ? this.sellButton(e) : ''}
        ${isOwn ? this.moduleButtons([e]) : ''}
      </div>
      <div class="sel-actions">
        ${isOwn ? this.stanceButtons([e]) : ''}
        ${this.garrisonOrderButtons([e])}
        ${isOwn ? this.groupChips([e]) : ''}
      </div>`;
    this.bindAbilityButtons();
    this.bindSellButtons();
    this.bindModuleButtons();
    this.bindStanceButtons();
    this.bindGarrisonButtons();
    this.decorateThumbnails();
    void force;
  }

  /**
   * The roster uses the panel's horizontal space: one chip per selected entity,
   * scrolled sideways instead of stacking rows. A large selection collapses
   * identical unit types into one card with a count, and tapping that card
   * narrows the selection to the type. It is rebuilt only when the selection
   * changes so a scrolled strip does not jump every refresh.
   */
  private renderRoster(entities: Entity[]): void {
    const root = this.root;
    if (!root) return;
    const chips = selectionChips(entities);
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
        host.innerHTML = chips.map((chip) => this.rosterChip(chip, entities)).join('');
      }
      for (const chip of chips) {
        const el = host.querySelector<HTMLElement>(
          chip.kind === 'group'
            ? `[data-select-type="${chip.defId}"]`
            : `[data-inspect="${chip.ids[0]}"]`,
        );
        if (!el) continue;
        if (chip.kind === 'entity') {
          el.classList.toggle('active', chip.ids[0] === this.inspectedId);
          el.setAttribute('aria-pressed', String(chip.ids[0] === this.inspectedId));
        }
        const bar = el.querySelector<HTMLElement>('.chip-hp i');
        if (!bar) continue;
        const frac = chip.maxHp > 0 ? clamp01(chip.hp / chip.maxHp) : 0;
        bar.style.width = `${frac * 100}%`;
        bar.className = hpClass(frac);
      }
    });
  }

  private rosterChip(chip: SelectionChipView, entities: Entity[]): string {
    const first = entities.find((e) => chip.ids.includes(e.id));
    if (!first) return '';
    const def = first.kind === 'unit' ? UNITS[chip.defId] : BUILDINGS[chip.defId];
    const colour = this.game ? ownerColor(this.game, first) : '#d8e2dd';
    const frac = chip.maxHp > 0 ? clamp01(chip.hp / chip.maxHp) : 0;
    const name = def?.name ?? chip.defId;
    if (chip.kind === 'group') {
      const label = `${chip.count} × ${def?.shortName ?? chip.defId}`;
      return `<button class="roster-chip grouped" data-select-type="${escapeHtml(chip.defId)}" title="${escapeHtml(label)} — narrow the selection to this type" aria-label="${escapeHtml(label)}; narrow selection">
        ${this.thumbMarkup('unit', chip.defId, colour, 'portrait', def?.icon ?? 'target', 'chip-art')}
        <span class="chip-copy">
          <span class="chip-name">${escapeHtml(def?.shortName ?? chip.defId)}</span>
          <span class="chip-hp"><i class="${hpClass(frac)}" style="width:${frac * 100}%"></i></span>
        </span>
        <span class="chip-count" aria-hidden="true">${chip.count}</span>
      </button>`;
    }
    return `<button class="roster-chip" data-inspect="${chip.ids[0]}" title="${escapeHtml(name)} · ${escapeHtml(stateLabel(first))}" aria-label="${escapeHtml(name)}">
      ${this.thumbMarkup(first.kind, chip.defId, colour, 'portrait', def?.icon ?? 'target', 'chip-art')}
      <span class="chip-copy">
        <span class="chip-name">${escapeHtml(def?.shortName ?? chip.defId)}</span>
        <span class="chip-hp"><i class="${hpClass(frac)}" style="width:${frac * 100}%"></i></span>
      </span>
    </button>`;
  }

  /**
   * Researched abilities this hull can use.
   *
   * The row is built from the simulation's own availability, so a hull with no
   * researched ability shows nothing at all — a tank's selection box is exactly
   * what it was before. Each button acts on this one hull: the reload belongs to
   * the crew that fired, not to the type. A button on reload stays visible and
   * reports its remaining time instead of vanishing, because the player needs to
   * know the capability exists and when it returns.
   */
  private abilityButtons(entities: Entity[]): string {
    const game = this.game;
    if (!game) return '';
    const unit = entities.find(
      (e) => e.kind === 'unit' && e.owner === this.app.localPlayerId && e.hp > 0,
    );
    if (!unit) return '';
    const actions = abilityActions(game, this.app.localPlayerId, unit.id);
    if (actions.length === 0) return '';
    return `<div class="ability-row">
      ${actions
        .map(
          (action) => `<button class="sel-square ability-btn ${action.active ? 'active' : action.ready ? 'ready' : 'reloading'}" data-ability="${escapeHtml(action.upgradeId)}" data-ability-unit="${unit.id}" title="${escapeHtml(`${action.name} — ${action.description} · ${action.note} · ${action.detail}`)}" aria-label="${escapeHtml(`${action.name}, ${action.detail}`)}" aria-pressed="${action.active ? 'true' : 'false'}" aria-disabled="${action.ready ? 'false' : 'true'}">
            ${icon(action.icon, 'square-icon')}
            ${
              action.active
                ? `<span class="square-badge ok">${Math.ceil(action.activeRemaining)}s</span>`
                : action.ready
                  ? ''
                  : `<span class="square-badge">${escapeHtml(action.cooldown > 0 ? `${Math.ceil(action.cooldown)}s` : '—')}</span>`
            }
          </button>`,
        )
        .join('')}
    </div>`;
  }

  private bindAbilityButtons(): void {
    this.root?.querySelectorAll<HTMLElement>('[data-ability]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const abilityId = btn.dataset.ability ?? '';
        const unitId = Number(btn.dataset.abilityUnit);
        if (!abilityId || !Number.isFinite(unitId)) return;
        this.app.useAbility(unitId, abilityId);
        this.renderSelection(true);
      });
    });
  }

  /**
   * Researched modules this structure can buy, and the ones it already holds.
   *
   * Built from the simulation's own availability, so a structure with nothing
   * researched shows no row at all — a barracks card is exactly what it was.
   * Each button buys the retrofit for this one structure, which is the point of
   * a per-building module: two plants are two purchases. An installed module
   * stays on the row reporting what it adds rather than disappearing.
   */
  private moduleButtons(entities: Entity[]): string {
    const game = this.game;
    if (!game) return '';
    const building = entities.find(
      (e) =>
        e.kind === 'building' &&
        e.owner === this.app.localPlayerId &&
        e.hp > 0 &&
        !e.construction,
    );
    if (!building) return '';
    const actions = moduleActions(game, this.app.localPlayerId, building.id);
    if (actions.length === 0) return '';
    return `<div class="ability-row module-row">
      ${actions
        .map(
          (action) => `<button class="sel-square module-btn ${action.ready ? 'ready' : action.installed ? 'installed' : 'reloading'}" data-module="${escapeHtml(action.moduleId)}" data-module-building="${building.id}" title="${escapeHtml(`${action.name} — ${action.description} · ${action.detail}`)}" aria-label="${escapeHtml(`${action.name}, ${action.detail}`)}" aria-disabled="${action.ready ? 'false' : 'true'}">
            ${icon(action.icon, 'square-icon')}
            ${action.installed ? '<span class="square-badge ok">✓</span>' : ''}
          </button>`,
        )
        .join('')}
    </div>`;
  }

  private bindModuleButtons(): void {
    this.root?.querySelectorAll<HTMLElement>('[data-module]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const moduleId = btn.dataset.module ?? '';
        const buildingId = Number(btn.dataset.moduleBuilding);
        if (!moduleId || !Number.isFinite(buildingId)) return;
        this.app.installModule(buildingId, moduleId);
        this.renderSelection(true);
      });
    });
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

  /**
   * The one sell control: only on a finished, owned, sellable structure. The
   * quote is the simulation's own 75% figure, so the panel and the payout can
   * never disagree; while dismantling it becomes a plain countdown.
   */
  private sellButton(e: Entity): string {
    const game = this.game;
    if (!game || e.kind !== 'building' || e.construction || isIndestructibleStructure(e.defId)) {
      return '';
    }
    const quote = game.sellQuote(e.id);
    if (e.deconstruct) {
      const seconds = Math.ceil(e.deconstruct.remaining);
      const title = `Dismantling — ${seconds}s remaining, ${quote?.mats ?? 0}M/${quote?.req ?? 0}R returned when it clears`;
      return `<div class="sel-orders sell-orders">
        <button class="sel-square sell-btn dismantling" disabled title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
          ${icon('sell', 'square-icon')}
          <span class="square-badge">${seconds}s</span>
        </button>
      </div>`;
    }
    const status = game.sellStatus(this.app.localPlayerId, e.id);
    if (!quote) return '';
    const name = BUILDINGS[e.defId]?.name ?? e.defId;
    // First click arms the sale; nothing is dispatched until the confirming
    // click, so a stray click can never start a deconstruction.
    if (this.sellArmed === e.id) {
      const confirmTitle = `Confirm sale of ${name} — ${quote.mats}M/${quote.req}R returned after ${quote.seconds}s of deconstruction`;
      return `<div class="sel-orders sell-orders confirm">
        <button class="sel-square sell-btn danger" data-sell="${e.id}" title="${escapeHtml(confirmTitle)}" aria-label="${escapeHtml(confirmTitle)}" ${status.ok ? '' : 'disabled'}>
          ${icon('check', 'square-icon')}
        </button>
        <button class="sel-square sell-btn cancel" data-sell-cancel="${e.id}" title="Keep ${escapeHtml(name)} — no sale" aria-label="Cancel sale">
          ${icon('close', 'square-icon')}
        </button>
      </div>`;
    }
    const title = status.ok
      ? `Sell ${name} — ${quote.mats}M/${quote.req}R returned after ${quote.seconds}s of deconstruction. Click again to confirm.`
      : `${status.reason} (${quote.mats}M/${quote.req}R after ${quote.seconds}s)`;
    return `<div class="sel-orders sell-orders">
      <button class="sel-square sell-btn danger" data-sell="${e.id}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" ${status.ok ? '' : 'disabled'}>
        ${icon('sell', 'square-icon')}
      </button>
    </div>`;
  }

  /** Offer the sale for confirmation; it expires on its own after a few seconds. */
  private armSale(id: number): void {
    this.disarmSale();
    this.sellArmed = id;
    this.sellArmedAt = performance.now();
    this.sellArmTimer = window.setTimeout(() => {
      if (this.sellArmed !== id) return;
      this.sellArmed = null;
      this.sellArmTimer = 0;
      this.renderSelection(true);
    }, SALE_CONFIRM_MS);
    this.renderSelection(true);
  }

  private disarmSale(): void {
    if (this.sellArmTimer) window.clearTimeout(this.sellArmTimer);
    this.sellArmTimer = 0;
    this.sellArmed = null;
  }

  private bindSellButtons(): void {
    this.root?.querySelectorAll<HTMLElement>('[data-sell]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.sell);
        if (!Number.isFinite(id) || id <= 0) return;
        if (this.sellArmed !== id) {
          this.armSale(id);
          return;
        }
        // The confirming click has to be a deliberate second action, not the
        // second half of a double-click that started the arm.
        if (performance.now() - this.sellArmedAt < SALE_CONFIRM_GRACE_MS) return;
        this.disarmSale();
        this.app.sellBuilding(id);
        this.renderSelection(true);
      });
    });
    this.root?.querySelectorAll<HTMLElement>('[data-sell-cancel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.disarmSale();
        this.renderSelection(true);
      });
    });
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
    const holdsTransport = entities.some((e) => {
      if (
        e.kind !== 'unit' ||
        e.owner < 0 ||
        game.isHostile(e.owner, this.app.localPlayerId) ||
        !UNITS[e.defId]?.transport
      ) {
        return false;
      }
      // Air and naval carriers move under their owner's command, so only the
      // owner may open the carrier-wide unload transaction. A ground carrier
      // still lets a passenger owner extract their own squad.
      const domain = UNITS[e.defId]?.domain;
      if (domain === 'air' || domain === 'naval') return e.owner === this.app.localPlayerId;
      return game.garrisonOccupants(e.id).some((u) => u.owner === this.app.localPlayerId);
    });
    const insideTransport = entities.some((e) => {
      if (e.kind !== 'unit' || !e.garrisonId) return false;
      const carrier = game.getEntity(e.garrisonId);
      if (!carrier || !UNITS[carrier.defId]?.transport) return false;
      const domain = UNITS[carrier.defId]?.domain;
      return domain !== 'air' && domain !== 'naval' || carrier.owner === this.app.localPlayerId;
    });
    const ownTransport = entities.some(
      (e) => e.kind === 'unit' && e.owner === this.app.localPlayerId && !!UNITS[e.defId]?.transport,
    );
    if (!eligible && !inside && !holdsBuilding && !holdsTransport && !insideTransport && !ownTransport) {
      return '';
    }
    const unload = holdsTransport || insideTransport;
    const unloadButton =
      unload || inside || holdsBuilding
        ? `<button class="mini-btn" data-ungarrison-order>${unload ? 'UNLOAD ALL' : 'EXIT BUILDING'}</button>`
        : ownTransport
          ? `<button class="mini-btn" disabled title="No passengers aboard">UNLOAD ALL</button>`
          : '';
    return `<div class="sel-orders garrison-orders">
      ${eligible ? `<button class="mini-btn" data-garrison-order>BOARD / GARRISON</button>` : ''}
      ${unloadButton}
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
    if (this.strategicOpen) {
      body.innerHTML = this.superweaponMarkup();
      this.decorateThumbnails();
      return;
    }
    if (this.researchOpen) {
      body.innerHTML = this.researchMarkup();
      this.bindResearch();
      this.decorateThumbnails();
      return;
    }
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
    const allianceId = this.app.localPlayer ? tryIdentityDef(this.app.localPlayer.factionId)?.allianceId : undefined;
    const html = facilities.map((f) => {
      const def = BUILDINGS[f.defId];
      // The panel shows exactly what the simulation will accept for this
      // player, so a national roster cannot disagree with the facility list.
      const list = game.productionEntries(this.app.localPlayerId, f.defId);
      const cards = list.map((id) => {
        const udef = UNITS[id];
        if (!udef) return '';
        // Every alliance platform is also a variant, so the badge keys on the
        // national marker instead: only a nation-specific definition earns it.
        const national = udef.national ? '<span class="u-national">NATIONAL</span>' : '';
        const status = game.productionStatus(this.app.localPlayerId, f.id, id);
        const queued = productionCardState(f.queue, id);
        const reorderable = queued.queued > 0 && f.queue.some((item) => item.defId !== id);
        const dragHint = reorderable ? ' Drag to set production priority.' : '';
        const researchMissing = game.missingResearchForUnit(this.app.localPlayerId, id);
        const researchLocked = researchMissing.length > 0;
        const researchRequired = researchNames(researchMissing, allianceId);
        const title = researchLocked
          ? `${udef.description} — requires ${researchRequired} research.${dragHint}`
          : status.ok
            ? `${udef.description}${dragHint}`
            : `${status.reason}${dragHint}`;
        const block = researchLocked
          ? { text: `RESEARCH ${researchRequired.toUpperCase()}`, tone: 'research' as const }
          : status.ok
            ? null
            : productionBlockReason(status.reason);
        const disabled = !status.ok && !reorderable ? 'disabled' : '';
        const unlocked = !researchLocked;
        const commander = this.app.localPlayer;
        const payable =
          !!commander && commander.mats >= udef.cost.mats && commander.req >= udef.cost.req;
        const artState = cardArtState(unlocked, payable);
        const cardClass = [
          'unit-card',
          queued.active ? 'training' : '',
          status.ok ? '' : 'unavailable',
          researchLocked ? 'locked' : '',
          block ? `blocked-${block.tone}` : '',
          reorderable ? 'reorderable' : '',
        ].filter(Boolean).join(' ');
        return `<div class="unit-slot" data-slot-for="${f.id}:${id}" data-queued="${queued.queued}">
          <button class="${cardClass}" data-produce="${f.id}:${id}" data-queued="${queued.queued}" ${status.ok ? '' : 'aria-disabled="true"'} ${disabled} title="${escapeHtml(title)}">
            <span class="u-hot">${udef.hotkey ?? ''}</span>
            <span class="u-art">
              ${this.thumbMarkup('unit', id, this.teamColor(), 'card', udef.icon, 'u-thumb', 0, artState)}
              <span class="u-progress" style="--p:${(queued.progress * 100).toFixed(1)}%" aria-hidden="true"></span>
            </span>
            <span class="u-name">${escapeHtml(udef.shortName)}${national}</span>
            ${costChips(udef.cost.mats, udef.cost.req, udef.buildTime)}
            ${block ? `<span class="u-reason ${block.tone}">${block.text}</span>` : ''}
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
    // Right-click on a cameo cancels one queued copy: the same edit as the
    // count button, and the fast path a player expects while the sheet is open.
    body.querySelectorAll<HTMLElement>('.unit-slot').forEach((slot) => {
      slot.addEventListener('contextmenu', (event) => {
        // The sheet owns this gesture: a right-click never opens the browser
        // menu over a cameo, whether or not anything is queued.
        event.preventDefault();
        const queued = Number(slot.dataset.queued ?? '0');
        if (queued <= 0) return;
        const [bid, defId] = (slot.dataset.slotFor ?? '').split(':');
        const facility = game.getEntity(Number(bid));
        const index = facility?.queue.map((item) => item.defId).lastIndexOf(defId) ?? -1;
        if (index < 0) return;
        this.app.cancelProduction(Number(bid), index);
        this.renderProduction(true);
      });
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
    // One grid snapshot for the whole panel: every card's hover copy answers
    // "why am I browning out?" with the same numbers the meter is showing.
    const grid = this.currentGridReport();
    // The gauge's activation calls out the structures the readout just listed —
    // the largest generators and draws — plus the turbine plant, which is the
    // answer when there is no generation at all. Marking every card with a grid
    // value would mark the whole panel and say nothing.
    const gridFocus = performance.now() < this.gridFocusUntil;
    const focusIds = gridFocus && grid
      ? new Set([
          ...powerReadout(grid).sources,
          ...powerReadout(grid).consumers,
        ].map((line) => line.id))
      : null;
    const engineer = this.game?.entitiesOf(this.app.localPlayerId, 'unit').find((e) => UNITS[e.defId]?.canBuild);
    const roster = this.game?.rosterFor(this.app.localPlayerId);
    const allianceId = p ? tryIdentityDef(p.factionId)?.allianceId : undefined;
    const cards = BUILDABLE_BY_PLAYER
      .filter((def) => structureTab(!!def.weapons?.length) === tab)
      .filter((def) => !roster || roster.buildings.includes(def.id))
      .map((def) => {
        const affordable = p ? p.mats >= def.cost.mats && p.req >= def.cost.req : false;
        // The structure tree is visible even when locked, so the sidebar reads
        // as a progression rather than hiding half the roster. Research is a
        // separate gate from a missing prerequisite structure; a card carries
        // whichever applies, and the tooltip keeps both visible.
        const researchMissing =
          this.game?.missingResearchForBuilding(this.app.localPlayerId, def.id) ?? [];
        const researchRequired = researchNames(researchMissing, allianceId);
        const researchLocked = researchMissing.length > 0;
        const missing = this.game?.missingTech(this.app.localPlayerId, def.id) ?? [];
        const required = missing.map((m) => m.name).join(' and ');
        const structureLocked = missing.length > 0;
        const locked = researchLocked || structureLocked;
        // The reverse of the gate: what this structure opens for the roster the
        // player actually fields. The tree is visible on the locked cards; this
        // makes the other half of it legible from the structure that opens it.
        const family = buildingFamily(def.id);
        const unlocks = BUILDABLE_BY_PLAYER
          .filter((b) => buildingRequirements(b.id).includes(family))
          .filter((b) => !roster || roster.buildings.includes(b.id))
          .map((b) => b.name);
        // One affordability language for the whole sidebar: a card the player
        // cannot pay for keeps its text readable while the portrait dims.
        // The short reason is printed on the card so a touch player
        // can read it without a tooltip.
        const shortfall = !p
          ? 'no commander'
          : p.mats < def.cost.mats
            ? 'not enough materials'
            : 'not enough requisition';
        const unlockNote = unlocks.length > 0 ? ` Unlocks ${unlocks.join(', ')}.` : '';
        const power = def.power ?? 0;
        const gridNote = grid
          ? powerBreakdownLines(grid, { id: def.id, name: def.name, power }).join('\n')
          : '';
        const gateNotes = [
          researchLocked ? `requires ${researchRequired} research` : '',
          structureLocked ? `requires ${required}` : '',
        ].filter(Boolean);
        const title = `${def.description}${
          gateNotes.length > 0
            ? ` — ${gateNotes.join('; ')}`
            : !engineer
              ? ' — requires a combat engineer'
              : affordable
                ? ''
                : ` — ${shortfall}`
        }${unlockNote}${gridNote ? `\n\n${gridNote}` : ''}`;
        const block = researchLocked
          ? `RESEARCH ${researchRequired.toUpperCase()}`
          : structureLocked
            ? `NEEDS ${required.toUpperCase()}`
            : !engineer
              ? 'NEEDS ENGINEER'
              : affordable ? '' : shortfall.toUpperCase();
        return `<button class="build-card${affordable ? '' : ' unavailable'}${locked ? ' locked' : ''}${focusIds && (def.id === 'powerPlant' || focusIds.has(def.id)) ? ' grid-focus' : ''}" data-build="${def.id}" ${engineer && !locked ? '' : 'disabled'} title="${escapeHtml(title)}">
          ${def.id === 'powerPlant' ? '<span class="b-flag">GRID FIX</span>' : def.id === 'radar' ? '<span class="b-flag">RADAR</span>' : ''}
          ${this.thumbMarkup('building', def.id, this.teamColor(), 'card', def.icon, 'b-thumb', 0, cardArtState(!locked, affordable))}
          <span class="b-copy">
            <span class="b-name">${escapeHtml(def.name)}${def.national ? '<span class="u-national">NATIONAL</span>' : ''}</span>
            ${block ? `<span class="b-req${researchLocked ? ' research' : locked ? '' : ' short'}">${escapeHtml(block)}</span>` : ''}
            ${costChips(def.cost.mats, def.cost.req, def.buildTime)}
            ${powerChip(power)}
          </span>
        </button>`;
      }).join('');
    return `<div class="build-grid">${cards}</div>`;
  }

  /**
   * Group the local player's operational structures the way the grid counts
   * them: under-construction and destroyed buildings contribute nothing.
   */
  private currentGridReport(): GridReport | null {
    const game = this.game;
    if (!game) return null;
    return gridReport(
      game.entitiesOf(this.app.localPlayerId, 'building').map((e) => ({
        defId: e.defId,
        construction: e.construction,
        hp: e.hp,
        modules: e.modules,
      })),
    );
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
  /* Research                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * The complete tree in the production sidebar: four branch rows, two tier
   * nodes each, an active-project strip and one detail block for the selected
   * node. The branches stay visible so progression is readable at a glance;
   * costs and duration sit on every node, while the longer description and the
   * exact unlock names live in the detail block instead of eight repeated
   * paragraphs.
   */
  private researchMarkup(): string {
    const game = this.game;
    const p = this.app.localPlayer;
    if (!game || !p) return '<div class="prod-empty">Research is unavailable.</div>';
    const owner = this.app.localPlayerId;
    const identity = tryIdentityDef(p.factionId);
    const allianceId = identity?.allianceId;
    const completed = game.completedTechnologies(owner);
    const completedSet = new Set(completed);
    const project = game.researchState(owner)?.project ?? null;
    const hasCentre = game.hasResearchCentre(owner);
    const active = activeResearchView(project, allianceId, game.research);
    const groups = researchBranchGroups(game.research);
    const input = {
      completed,
      project,
      mats: p.mats,
      req: p.req,
      hasCentre,
      allianceId,
      factionId: p.factionId,
      restricted: game.operationLockedTechnologies(owner),
    };
    const selectedTech = this.selectedResearchTech ? TECHS[this.selectedResearchTech] : undefined;
    const selectedView = selectedTech ? researchNodeState(selectedTech, input, game.research) : null;
    const rate = game.researchRate(owner);
    const pauseReason = game.researchPauseReason(owner);

    const activeMarkup = active
      ? `<section class="research-active ${pauseReason ? 'paused' : ''}" aria-label="Active research">
          <div class="research-active-head"><span>ACTIVE PROJECT</span><span data-research-rate>${Math.round(rate * 100)}% SPEED</span></div>
          <div class="research-active-title"><b>${escapeHtml(active.name)}</b><span data-research-remaining>${Math.ceil(active.remaining)}s</span></div>
          <div class="research-progress" role="progressbar" aria-label="Research progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${active.percent}"><i data-research-fill style="width:${active.percent}%"></i></div>
          <div class="research-active-meta">${costChips(active.tech.cost.mats, active.tech.cost.req, active.total)}<span class="research-committed">COMMITTED</span></div>
          <div class="research-active-note" data-research-note>${escapeHtml(pauseReason ?? 'Operational · advancing on the simulation clock.')}</div>
          <button class="research-cancel" data-act="research-cancel" ${hasCentre ? '' : 'disabled'} title="${hasCentre ? 'Cancel the project and refund its cost' : 'An operational Research Centre is required to cancel'}">CANCEL & REFUND</button>
        </section>`
      : `<section class="research-idle" aria-label="Research idle">
          <div><span class="eyebrow">NO ACTIVE PROJECT</span><b>${hasCentre ? 'RESEARCH CENTRE ONLINE' : 'RESEARCH CENTRE OFFLINE'}</b></div>
          <p>${hasCentre ? 'Select a technology below and start research.' : 'Build an operational Research Centre from the BASE panel to begin.'}</p>
        </section>`;

    const branches = groups.map((group) => {
      const done = group.nodes.filter((tech) => completedSet.has(tech.id)).length;
      const nodes = group.nodes.map((tech) => {
        const view = researchNodeState(tech, input, game.research);
        const selected = tech.id === selectedTech?.id;
        return `<button class="research-node state-${view.status}${selected ? ' selected' : ''}" data-act="research-select" data-tech="${escapeHtml(tech.id)}" aria-pressed="${selected}" aria-label="${escapeHtml(view.name)} — ${escapeHtml(view.label)}. ${escapeHtml(view.reason)}" title="${escapeHtml(`${view.name} — ${view.reason}`)}">
          <span class="research-node-top"><span class="research-node-icon">${icon(tech.icon)}</span><span class="research-node-state">${escapeHtml(view.label)}</span></span>
          <b class="research-node-name">${escapeHtml(view.name)}</b>
          <span class="research-node-cost">${tech.cost.mats}M · ${tech.cost.req}R · ${tech.seconds}s</span>
        </button>`;
      }).join('');
      return `<section class="research-branch" data-branch="${group.branch}">
        <div class="research-branch-head"><span>${escapeHtml(group.label.toUpperCase())}</span><span>${done}/${group.nodes.length}</span></div>
        <div class="research-tier-row">${nodes}</div>
      </section>`;
    }).join('');

    // The nation's authority chain, when it has one. It is shown beside the
    // branch tree because these four nodes are the only route to the strategic
    // call-in, and a commander that cannot see them cannot plan for it.
    const family = game.superweaponFamilyFor(owner);
    const authorityTechs = family ? researchAuthorityNodes(family.requires, game.research) : [];
    const authority = authorityTechs.length === 0
      ? ''
      : `<section class="research-branch research-authority" data-branch="authority">
        <div class="research-branch-head"><span>STRATEGIC AUTHORITY</span><span>${authorityTechs.filter((tech) => completedSet.has(tech.id)).length}/${authorityTechs.length}</span></div>
        <div class="research-tier-row">${authorityTechs
          .map((tech) => {
            const view = researchNodeState(tech, input, game.research);
            const selected = tech.id === selectedTech?.id;
            return `<button class="research-node state-${view.status}${selected ? ' selected' : ''}" data-act="research-select" data-tech="${escapeHtml(tech.id)}" aria-pressed="${selected}" aria-label="${escapeHtml(view.name)} — ${escapeHtml(view.label)}. ${escapeHtml(view.reason)}" title="${escapeHtml(`${view.name} — ${view.reason}`)}">
              <span class="research-node-top"><span class="research-node-icon">${icon(tech.icon)}</span><span class="research-node-state">${escapeHtml(view.label)}</span></span>
              <b class="research-node-name">${escapeHtml(view.name)}</b>
              <span class="research-node-cost">${tech.cost.mats}M · ${tech.cost.req}R · ${tech.seconds}s</span>
            </button>`;
          })
          .join('')}</div>
      </section>`;

    const detail = selectedTech && selectedView
      ? `<section class="research-detail" aria-live="polite">
          <div class="research-detail-head"><span>${BRANCH_NAMES[selectedTech.branch].toUpperCase()} · TIER ${selectedTech.tier}</span><h4>${escapeHtml(selectedView.name)}</h4></div>
          <p>${escapeHtml(selectedTech.description)}</p>
          <div class="research-effects"><span>UNLOCKS</span><p>${escapeHtml(this.researchEffectLabels(selectedTech))}</p></div>
          <div class="research-detail-costs">${costChips(selectedTech.cost.mats, selectedTech.cost.req, selectedTech.seconds)}</div>
          <div class="research-requirement"><span>PREREQUISITES</span><b>${escapeHtml(this.researchPrerequisiteNames(selectedTech, allianceId))}</b></div>
          <p class="research-reason state-${selectedView.status}">${escapeHtml(selectedView.reason)}</p>
          <button class="research-start" data-act="research-start" ${selectedView.canStart ? '' : 'disabled'} title="${escapeHtml(selectedView.reason)}">${selectedView.canStart ? 'START RESEARCH' : selectedView.label}</button>
        </section>`
      : '<div class="research-detail empty">Select a technology to inspect it.</div>';

    return `<div class="research-panel">
      <header class="research-head"><div><span class="eyebrow">RESEARCH</span><h3>${completed.length}/${game.research.techs.length} TECHNOLOGIES</h3></div><button class="research-close" data-act="research-close" aria-label="Close research">×</button></header>
      ${activeMarkup}
      <div class="research-branches">${branches}${authority}</div>
      ${detail}
    </div>`;
  }

  /** Concrete names this player's roster gains from one technology. */
  private researchEffectLabels(tech: TechDef): string {
    const game = this.game;
    if (!game) return 'Doctrine effects';
    const owner = this.app.localPlayerId;
    const labels: string[] = [];
    for (const effect of tech.effects) {
      if (effect.kind === 'unlockUnit') {
        const actual = game.unitIdFor(owner, effect.slot) ?? effect.slot;
        labels.push(UNITS[actual]?.name ?? effect.slot);
      } else if (effect.kind === 'unlockBuilding') {
        const actual = game.buildingIdFor(owner, effect.slot) ?? effect.slot;
        labels.push(BUILDINGS[actual]?.name ?? effect.slot);
      } else if (effect.kind === 'grantUnitUpgrade') {
        labels.push(UNIT_UPGRADES[effect.upgrade]?.name ?? effect.upgrade);
      } else if (effect.kind === 'grantBuildingModule') {
        labels.push(BUILDING_MODULES[effect.module]?.name ?? effect.module);
      }
    }
    return labels.length > 0 ? labels.join(' · ') : 'Doctrine effects';
  }

  private researchPrerequisiteNames(tech: TechDef, allianceId?: string): string {
    if (tech.requires.length === 0) return 'None — root technology';
    const names = tech.requires.map((id) => {
      const required = TECHS[id];
      return required ? researchTechName(required, allianceId) : id;
    });
    return names.join(' · ');
  }

  private bindResearch(): void {
    this.root?.querySelectorAll<HTMLButtonElement>('[data-act="research-select"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const techId = btn.dataset.tech;
        if (techId) this.selectResearchTech(techId);
      });
    });
  }

  /** Keep the active strip and rail readout moving between keyed re-renders. */
  private refreshResearchProgress(): void {
    const game = this.game;
    if (!game || !this.researchOpen) return;
    const project = game.researchState(this.app.localPlayerId)?.project ?? null;
    const identity = this.app.localPlayer ? tryIdentityDef(this.app.localPlayer.factionId) : undefined;
    const active = activeResearchView(project, identity?.allianceId, game.research);
    if (!active) return;
    const fill = this.root?.querySelector<HTMLElement>('[data-research-fill]');
    if (fill) fill.style.width = `${active.progress * 100}%`;
    const bar = fill?.parentElement;
    if (bar) bar.setAttribute('aria-valuenow', String(active.percent));
    const remaining = this.root?.querySelector<HTMLElement>('[data-research-remaining]');
    if (remaining) remaining.textContent = `${Math.ceil(active.remaining)}s`;
    const rate = this.root?.querySelector<HTMLElement>('[data-research-rate]');
    if (rate) rate.textContent = `${Math.round(game.researchRate(this.app.localPlayerId) * 100)}% SPEED`;
    const note = this.root?.querySelector<HTMLElement>('[data-research-note]');
    if (note) {
      note.textContent = game.researchPauseReason(this.app.localPlayerId) ?? 'Operational · advancing on the simulation clock.';
    }
  }

  /** Compact rail readout: name, percentage and bar while the tree is closed. */
  private updateResearchRail(): void {
    const rail = this.root?.querySelector<HTMLElement>('#rail-research');
    const game = this.game;
    if (!rail || !game) return;
    const p = this.app.localPlayer;
    const project = game.researchState(this.app.localPlayerId)?.project ?? null;
    const identity = p ? tryIdentityDef(p.factionId) : undefined;
    const active = activeResearchView(project, identity?.allianceId, game.research);
    const fill = rail.querySelector<HTMLElement>('[data-research-rail-fill]');
    rail.classList.toggle('active', this.researchOpen);
    rail.classList.toggle('researching', !!active);
    rail.setAttribute('aria-expanded', String(this.researchOpen));
    if (fill) fill.style.width = `${active?.progress ? active.progress * 100 : 0}%`;
    // The tooltip is written only when its text really moves, and the text holds
    // no ticking countdown: reassigning a hovered element's title restarts the
    // browser's tooltip, which is what made this button appear to refresh.
    const paused = game?.researchPauseReason(this.app.localPlayerId);
    const tick = active ? Math.round(active.percent / 10) * 10 : 0;
    const title = active
      ? `${active.name} — ${tick}% complete${paused ? ` · ${paused}` : ''}`
      : 'Research tree — no active project';
    if (rail.title !== title) rail.title = title;
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
      repair: 'REPAIR — select a damaged structure or your own building site',
      garrison: 'GARRISON / BOARD — select a building or friendly transport',
      box: 'BOX SELECT — drag across units',
      superweapon: 'STRATEGIC OPERATION — choose a target on the map [ESC cancels]',
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
    canvas.closest('.map-dock')?.classList.toggle('radar-offline', !status.online);
    canvas.closest('.production-sidebar')?.classList.toggle('radar-offline', !status.online);
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
      const vision = e.owner === this.app.localPlayerId
        ? 'visible'
        : game.visionStateOf(game.teamOf(this.app.localPlayerId), e.id);
      if (vision === 'hidden') continue;
      const tx = e.x / TILE_SIZE;
      const tz = e.z / TILE_SIZE;
      // Remembered structures stay on the map as faint marks.
      ctx.globalAlpha = vision === 'remembered' ? 0.42 : 1;
      ctx.fillStyle = e.owner === -1 ? '#c9d2ce' : ownerColor(game, e);
      if (e.kind === 'building') {
        const def = BUILDINGS[e.defId];
        ctx.fillRect(tx - (def?.footprint.w ?? 1) / 2, tz - (def?.footprint.h ?? 1) / 2, Math.max(2, def?.footprint.w ?? 2), Math.max(2, def?.footprint.h ?? 2));
      } else {
        ctx.fillRect(tx - 0.7, tz - 0.7, 1.8, 1.8);
      }
      ctx.globalAlpha = 1;
      if (this.app.selected.includes(e.id)) {
        ctx.strokeStyle = '#f1c27e';
        ctx.lineWidth = 1.25 / strokeScale;
        ctx.strokeRect(tx - 1.7, tz - 1.7, 3.6, 3.6);
      }
    }
    // Contacts are drawn from the position recorded while the unit was visible,
    // never from its current hidden position: a detected or last-known mark must
    // not drift with a unit the team cannot see. The shape carries the
    // confidence — solid for a confirmed sighting, hollow once the classification
    // is lost — and the opacity fades across the last-known window.
    const team = game.teamOf(this.app.localPlayerId);
    for (const contact of game.contactsFor(this.app.localPlayerId)) {
      const entity = game.state.entities.find((entry) => entry.id === contact.entityId);
      if (entity && game.visionStateOf(team, contact.entityId) === 'remembered') continue;
      const cxp = contact.x / TILE_SIZE;
      const czp = contact.z / TILE_SIZE;
      const colour = entity ? ownerColor(game, entity) : '#c9d2ce';
      ctx.globalAlpha = contactAlpha(game.state.tick, contact);
      ctx.fillStyle = colour;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.1 / strokeScale;
      if (contactIsHollow(contact)) {
        ctx.strokeRect(cxp - 1.2, czp - 1.2, 2.4, 2.4);
      } else {
        ctx.fillRect(cxp - 1.2, czp - 1.2, 2.4, 2.4);
      }
      if (contactStateOf(contact) === 'last-known') {
        // A small bar under a stale mark reads as memory rather than a target.
        ctx.fillRect(cxp - 1.6, czp + 1.8, 3.2, 0.5);
      }
      ctx.globalAlpha = 1;
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
    const compact = canvas.clientHeight < 90;
    const frame = ++this.minimapFrame;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.72);
    glow.addColorStop(0, '#0d1f20');
    glow.addColorStop(0.65, '#071214');
    glow.addColorStop(1, '#030809');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // The collapsed dock is a status bar, not a dead screen: one readable line
    // plus the action that brings the map back. The full feed returns when the
    // dock regains its height after a Radar Array comes online.
    if (compact) {
      const scan = Math.max(1, Math.round(2 * density));
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (let y = 0; y < h; y += scan) ctx.fillRect(0, y, w, 1);
      const mainFont = Math.max(11, Math.round(11 * density));
      const subFont = Math.max(9, Math.round(9.5 * density));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${mainFont}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.fillStyle = '#d8e2dd';
      ctx.fillText('RADAR OFFLINE', w / 2, h * 0.36);
      ctx.font = `600 ${subFont}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.fillStyle = 'rgba(224,163,74,0.92)';
      ctx.fillText(reason === 'brownout' ? 'GRID BROWNOUT · RESTORE POWER' : 'BUILD A RADAR ARRAY', w / 2, h * 0.7);
      ctx.fillStyle = 'rgba(224,163,74,0.72)';
      ctx.fillRect(0, 0, w, Math.max(1, density));
      return;
    }

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

    const mainFont = Math.max(13, Math.round(13 * density));
    const subFont = Math.max(11, Math.round(11 * density));
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
    // The result card lives inside the HUD; a hidden interface must not swallow
    // the verdict.
    this.setHudHidden(false);
    const p = this.app.localPlayer;
    const stats = p?.stats;
    const game = this.game;
    const victory = result === 'victory';
    const root = this.root.querySelector('#end-root');
    if (!root) return;
    const enemies = game.state.players.filter((q) => q.id !== this.app.localPlayerId);
    const enemyStats = enemies[0]?.stats;
    // End copy names the two identities actually fighting, not the legacy map.
    const victorName = tryIdentityDef(p?.factionId ?? '')?.name ?? 'Your force';
    // Skirmish setup allows a mirror match, so "United Kingdom holds the island"
    // would read as the player's own side unless the opponent is named as such.
    const mirror = Boolean(p && enemies[0] && p.factionId === enemies[0].factionId);
    const enemyName = mirror
      ? 'The opposing task force'
      : (tryIdentityDef(enemies[0]?.factionId ?? '')?.name ?? 'The enemy');
    // The verdict sting and the card share the player's own flag as a backdrop;
    // a defeat desaturates it rather than switching sides, so the screen still
    // reads as this commander's result.
    const nation = p ? flagNationForFaction(p.factionId) : undefined;
    const flagStyle = nation ? ` style="background-image:url(${flagTextureUrl(nation)})"` : '';
    const campaignRun = this.app.campaignRun();
    const testRun = this.app.missionTestActive;
    const campaignDebrief = campaignRun ? this.app.campaignDebrief() : null;
    const campaignVictory = victory ? campaignRun : null;
    const awaitingAcceptance = campaignDebrief?.awaitingAcceptance ?? false;
    const verdictSub = testRun
      ? 'Test run · not a campaign operation'
      : result === 'draw'
        ? 'Operation ended'
        : victory
          ? campaignVictory
            ? 'Operation complete'
            : 'Island secured'
          : 'Beachhead lost';
    // A mission debrief reports the captured authoritative result; its copy is
    // derived from that result, so it cannot claim an outcome the mission did
    // not record.
    const missionResult = game.missionResult;
    const missionDoc = campaignRun?.mission.mission ?? game.state.scenario.mission ?? null;
    const missionCopy = missionResult ? missionOutcomeCopy(missionResult, missionDoc ?? undefined) : null;
    const campaignOutlook = awaitingAcceptance ? this.app.campaignOutlook() : null;
    const heading = missionCopy
      ? missionCopy.heading
      : result === 'draw'
        ? 'Stalemate'
        : victory
          ? campaignVictory
            ? 'Operation Complete'
            : 'Island Secured'
          : 'Beachhead Lost';
    const copy = missionCopy
      ? missionCopy.copy
      : victory
        ? campaignVictory
          ? `${escapeHtml(campaignVictory.mission.name)} is secured. ${enemyName}'s command post is destroyed.`
          : `${enemyName}'s command post is destroyed. ${victorName} holds the island — land, air and sea were brought to bear as one force.`
        : `Your command post has fallen. ${enemyName} holds the island; a new plan and a new landing are required.`;
    // A campaign result is only a record until the player accepts it. The card
    // therefore offers acceptance and retry; it never claims the next operation
    // has unlocked merely because a mission ended.
    // A pending result's outlook already names the next operation and the
    // consequences, so the card only adds the campaign-complete state.
    const campaignNote = campaignDebrief?.campaignComplete
      ? '<div class="end-campaign-note complete"><span>CAMPAIGN COMPLETE</span><b>Every operation accepted</b></div>'
      : '';
    const primaryAction = testRun
      ? '<button class="btn btn-primary" data-end="workbench">RETURN TO MISSION WORKBENCH</button>'
      : awaitingAcceptance
        ? '<button class="btn btn-primary" data-end="accept">ACCEPT AND CONTINUE</button>'
        : campaignDebrief?.campaignComplete
          ? '<button class="btn btn-primary" data-end="menu">RETURN TO COMMAND DECK</button>'
          : campaignDebrief
            ? '<button class="btn btn-primary" data-end="retry">RETRY OPERATION</button>'
            : '<button class="btn btn-primary" data-end="restart">RESTART SCENARIO</button>';
    const secondaryAction = testRun
      ? '<button class="btn btn-ghost" data-end="restart">RESTART TEST</button>'
      : awaitingAcceptance
        ? '<button class="btn btn-ghost" data-end="retry">RETRY OPERATION</button>'
        : '';
    const testNote = testRun
      ? '<div class="end-campaign-note"><span>TEST RUN</span><b>No campaign progress, consequence or veteran change is committed</b></div>'
      : '';
    root.innerHTML = `
      <div class="end-screen ${victory ? 'victory' : result === 'draw' ? 'draw' : 'defeat'}">
        <div class="end-flag"${flagStyle} aria-hidden="true"></div>
        <div class="end-sting" aria-hidden="true">
          <i class="end-sting-rule"></i>
          <span>${result === 'draw' ? 'Stalemate' : victory ? 'Victory' : 'Defeat'}</span>
          <small>${verdictSub}</small>
        </div>
        <div class="end-card">
          <div class="end-body">
            <span class="result">${result === 'draw' ? 'OPERATION ENDED' : victory ? 'OPERATION COMPLETE' : 'OPERATION FAILED'}</span>
            <h2 class="${victory ? '' : 'defeat'}">${heading}</h2>
            <p>${copy}</p>
            ${
              missionResult
                ? missionDebriefMarkup(missionResult, {
                    ...(missionDoc ? { mission: missionDoc } : {}),
                    outlook: campaignOutlook,
                    flag: this.app.matchFlagSnapshot(game),
                  })
                : ''
            }
            ${campaignNote}
            ${testNote}
            <div class="end-stats">
              <div><span>MISSION TIME</span><b>${missionResult ? missionClock(missionResult.elapsedSeconds) : fmtTime(game.state.tick)}</b></div>
              <div><span>UNITS BUILT</span><b>${stats?.unitsBuilt ?? 0}</b></div>
              <div><span>UNITS LOST</span><b>${stats?.unitsLost ?? 0}</b></div>
              <div><span>KILLS</span><b>${stats?.kills ?? 0}</b></div>
              <div><span>MATERIALS</span><b>${Math.round(stats?.matsGathered ?? 0)}</b></div>
              <div><span>STRUCTURES</span><b>${stats?.buildingsBuilt ?? 0}</b></div>
              <div><span>ENEMY LOSSES</span><b>${enemyStats?.unitsLost ?? 0}</b></div>
              <div><span>RELAYS</span><b>${p?.relayCount ?? 0}</b></div>
            </div>
            <div class="end-career-slot" id="end-career"></div>
          </div>
          <div class="end-actions">
            ${primaryAction}
            ${secondaryAction}
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
        if (act === 'workbench') this.app.returnToMissionWorkbench();
        if (act === 'accept') this.app.acceptCampaignResultAction();
        if (act === 'retry') this.app.retryCampaignOperation();
        if (act === 'save') this.app.openSaveMenu(false);
        if (act === 'editor') this.app.openEditor(game.state.scenario);
        if (act === 'menu') this.app.toMenu();
      });
    });
    this.app.audio.play(victory ? 'victory' : 'defeat');
  }
}
