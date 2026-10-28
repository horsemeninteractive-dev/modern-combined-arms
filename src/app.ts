import { Renderer } from './render/renderer';
import { Game } from './sim/game';
import { TICK_MS, TILE_SIZE } from './sim/constants';
import { BUILDINGS } from './data/buildings';
import { UNITS } from './data/units';
import {
  BUILTIN_SCENARIOS,
  DEFAULT_SCENARIO_ID,
  builtinScenario,
  createIslandAssault,
  type BuiltinScenario,
} from './data/scenarios';
import {
  ALLIANCE_LIST,
  NATION_LIST,
  PLAYABLE_NATION_IDS,
  defaultOpponentNation,
  identityAlliance,
  identityDef,
  tryIdentityDef,
} from './data/factions';
import {
  cloneScenario,
  canLaunch,
  validateScenario,
  type Scenario,
} from './sim/scenario';
import type { AIDifficulty, Command, Entity, Stance, VictoryState } from './sim/types';
import type { SaveData } from './sim/save';
import { AudioEngine } from './ui/audio';
import { announcementForEvent } from './ui/announcer';
import { HUD } from './ui/hud';
import { InputController } from './ui/input';
import { Editor } from './ui/editor';
import { Overlay } from './ui/overlay';
import { openModal, confirmDialog, escapeHtml, closeModal } from './ui/modal';
import {
  hasUnseenChangelog,
  markAcknowledged,
  readAcknowledged,
  renderChangelog,
  type KeyValueStore,
} from './ui/changelog';
import {
  BUILD_COMMIT,
  VERSION_LINE,
  buildStampLabel,
  currentBuildStamp,
  versionTitle,
} from './version';
import { pickTerrain, terrainVisualHeight, type TerrainHit } from './render/terrainSurface';
import { constructionGridVisible } from './render/gridVisibility';
import { contextOrderFor } from './ui/orderIntent';
import { briefMapLabels, drawBriefMap } from './ui/mapPreview';
import { needsLandscape } from './ui/orientation';
import { enterFullscreen, isFullscreen, toggleFullscreen } from './ui/fullscreen';

export type Screen = 'menu' | 'battle' | 'editor';
/** Panels inside the main menu shell. */
export type MenuView = 'skirmish' | 'editor' | 'settings';
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
  /** Menu theme volume. The track streams from /audio/menu-theme.mp3. */
  music: number;
  /** Strategic announcer voice volume. */
  voice: number;
  effects: boolean;
  shake: boolean;
  fogVisual: boolean;
  edgePan: boolean;
  /** Opponent strength for new battles; a loaded save keeps its own. */
  difficulty: AIDifficulty;
  /** Selected skirmish theatre. */
  mapId: string;
  /**
   * Playable nation the local commander fields in a new skirmish. The opposing
   * nation is derived from the other alliance, so both sides are always known.
   */
  nationId: string;
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
/** The intro sting plays once per browser session, so reloads land in the menu. */

export const SAVE_SLOTS = [1, 2, 3];

const DIFFICULTY_COPY: Record<AIDifficulty, string> = {
  recruit: 'Recruit — thin economy and early small attacks; the easiest commander.',
  veteran: 'Veteran — balanced expansion, production and attack timing.',
  elite: 'Elite — the broadest economy and the best-timed combined-arms push.',
};

const DIFFICULTIES = Object.keys(DIFFICULTY_COPY) as AIDifficulty[];

const MENU_VIEWS: MenuView[] = ['skirmish', 'editor', 'settings'];

function isMenuView(value: unknown): value is MenuView {
  return MENU_VIEWS.includes(value as MenuView);
}

export class App {
  readonly renderer: Renderer;
  readonly audio = new AudioEngine();
  readonly overlay: Overlay;
  readonly hud: HUD;
  readonly input: InputController;
  readonly editor: Editor;

  screen: Screen = 'menu';
  /** null until the player picks a view: the menu opens with nothing selected. */
  menuView: MenuView | null = null;
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
  /** Scenario drawn behind the menu; null when a battle or the editor owns the canvas. */
  private menuScenario: Scenario | null = null;
  private menuDrift = 0;
  private introTimer = 0;
  private introBeatTimer = 0;
  /** One-shot downlink fault played when the deck changes. */
  private glitchTimer = 0;
  private menuHandoffStarted = false;
  private briefObserver: ResizeObserver | null = null;
  /** Built-in theatres, generated once and shared by the backdrop and thumbnails. */
  private mapCache = new Map<string, Scenario>();
  /** Set only when this gate paused the battle, so a manual pause survives. */
  private orientationPaused = false;
  /** The sting belongs to the launch, not to the menu: it plays once per page. */
  private introPlayed = false;
  private victoryShown: VictoryState | 'none' = 'none';
  private fpsSamples: number[] = [];
  /** Build key whose changelog notes this device has acknowledged. */
  private changelogAck: string | null = null;

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
    this.startMenuBackdrop();
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
      music: 0.45,
      voice: 0.8,
      effects: true,
      shake: true,
      fogVisual: true,
      edgePan: true,
      difficulty: 'veteran',
      mapId: DEFAULT_SCENARIO_ID,
      nationId: PLAYABLE_NATION_IDS[0],
    };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      const difficulty = DIFFICULTIES.includes(parsed.difficulty as AIDifficulty)
        ? (parsed.difficulty as AIDifficulty)
        : defaults.difficulty;
      const mapId = BUILTIN_SCENARIOS.some((s) => s.id === parsed.mapId)
        ? (parsed.mapId as string)
        : defaults.mapId;
      // Only a playable nation is a valid selection; an older or hand-edited
      // settings blob must not put an alliance or an unknown id in a player slot.
      const nationId = PLAYABLE_NATION_IDS.includes(parsed.nationId as string)
        ? (parsed.nationId as string)
        : defaults.nationId;
      return {
        ...defaults,
        ...parsed,
        music: Math.max(0, Math.min(1, Number(parsed.music ?? defaults.music))),
        voice: Math.max(0, Math.min(1, Number(parsed.voice ?? defaults.voice))),
        difficulty,
        mapId,
        nationId,
      };
    } catch {
      return defaults;
    }
  }

  applySettings(): void {
    this.renderer.settings.effects = this.settings.effects;
    this.renderer.settings.shake = this.settings.shake;
    this.renderer.settings.showFog = this.settings.fogVisual;
    this.audio.setVolumes(1, this.settings.sfx, this.settings.ambient);
    this.audio.setMusicVolume(this.settings.music);
    this.audio.setVoiceVolume(this.settings.voice);
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
    on('btn-deploy', () => void this.startBattle(this.deployScenario()));
    on('btn-editor', () => this.openEditor());
    on('btn-editor-autosave', () => this.openEditorAutosave());
    on('btn-load', () => this.openLoadMenu());
    on('btn-briefing', () => this.openBriefing());
    on('btn-changelog', () => this.openChangelog());
    document.querySelectorAll<HTMLButtonElement>('[data-menu-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.menuView as MenuView;
        if (!isMenuView(view)) return;
        this.audio.init();
        this.audio.play('ui');
        this.showMenuView(view);
        this.glitchSwitch();
      });
    });
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
    this.renderVersionStamp();
    this.changelogAck = readAcknowledged(this.localStore());
    this.refreshChangelogBadge();
    this.buildMapSelector();
    this.buildNationSelector();
    document.addEventListener('fullscreenchange', () => this.syncFullscreenControls());
    this.applyDifficultyUi();
    this.showMenuView(this.menuView);
    this.renderMenuSettings();
    this.refreshEditorAutosaveButton();
    this.installIntro();
  }

  /* ------------------------------------------------------------------ */
  /* Intro sting                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * The studio sting plays once per session over a black field, but only after
   * a deliberate click: browsers refuse to start audio (or fullscreen) without
   * a gesture, and a silent opening reads as broken. The gate also takes the
   * app fullscreen. From then on any pointer, key, the skip button, the end of
   * the clip, a decode error or an autoplay refusal all land in the same place:
   * the menu, already animating in. A fallback timer makes sure a stalled
   * download can never hold the game.
   */
  private installIntro(): void {
    const intro = document.getElementById('intro-screen');
    if (!intro) {
      this.revealMenu();
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.introPlayed || reduced) {
      intro.classList.add('hidden');
      this.revealMenu();
      this.audio.playMenuMusic();
      return;
    }

    const gate = document.getElementById('btn-start');
    if (!gate) {
      this.beginIntroPlayback();
      return;
    }
    gate.focus({ preventScroll: true });
    gate.addEventListener(
      'click',
      () => {
        // Audio and fullscreen both need the gesture: start them before any await.
        this.audio.init();
        this.audio.play('ui');
        void enterFullscreen().then(() => this.syncFullscreenControls());
        intro.classList.add('started');
        window.setTimeout(() => this.beginIntroPlayback(), 300);
      },
      { once: true },
    );
  }

  /** Run the sting itself, once the start gate has taken the gesture. */
  private beginIntroPlayback(): void {
    const intro = document.getElementById('intro-screen');
    if (!intro || intro.classList.contains('done')) return;
    const skip = document.getElementById('btn-skip-intro');
    skip?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.finishIntro();
    });
    intro.addEventListener('pointerdown', () => this.finishIntro());
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') this.finishIntro();
      },
      { once: true },
    );

    const video = document.getElementById('intro-video') as HTMLVideoElement | null;
    if (!video) {
      this.finishIntro();
      return;
    }
    video.addEventListener('ended', () => this.endStudioBeat());
    video.addEventListener('error', () => this.introFallback());
    // If metadata never arrives, the sting is missing or unplayable: fall back to
    // the studio plate, then the engine beat, then the menu.
    this.introTimer = window.setTimeout(() => this.introFallback(), 12000);

    // The start gate supplied the gesture, so the sting can play with sound.
    // Set it explicitly: a previous muted autoplay attempt must not persist.
    video.muted = false;
    intro.classList.add('playing');
    const source = video.dataset.src;
    if (source) video.src = source;
    video.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        intro.style.setProperty('--intro-duration', `${video.duration.toFixed(2)}s`);
      }
    });
    const started = video.play();
    if (started) started.catch(() => this.introFallback());
  }

  /**
   * Autoplay can be refused (battery saver, strict policy). Rather than losing
   * the branding beat entirely, hold a static studio plate for a moment; any
   * input still takes the player straight to the menu.
   */
  private introFallback(): void {
    const intro = document.getElementById('intro-screen');
    if (!intro || intro.classList.contains('done')) return;
    intro.classList.add('blocked');
    window.clearTimeout(this.introTimer);
    this.introTimer = window.setTimeout(() => this.endStudioBeat(), 3200);
  }

  /**
   * The title sequence has two beats: the studio sting, then the engine plate.
   * The engine beat always follows the studio beat — played, refused or failed —
   * and any input during it still takes the player straight to the menu.
   */
  private endStudioBeat(): void {
    const intro = document.getElementById('intro-screen');
    if (!intro || intro.classList.contains('done') || intro.classList.contains('engine')) return;
    window.clearTimeout(this.introTimer);
    intro.classList.add('engine');
    this.introBeatTimer = window.setTimeout(() => this.startLogoBeat(), 2000);
  }

  /** Third beat: the game lockup, held before it flies into the menu topbar. */
  private startLogoBeat(): void {
    const intro = document.getElementById('intro-screen');
    if (!intro || intro.classList.contains('done')) return;
    intro.classList.add('logo');
    this.introBeatTimer = window.setTimeout(() => this.startMenuHandoff(), 1500);
  }

  /**
   * Build the menu underneath the clearing intro, then dock the lockup. The
   * menu's own logo stays hidden until the flight lands so the two never show
   * at once.
   */
  private startMenuHandoff(): void {
    const intro = document.getElementById('intro-screen');
    const menu = document.getElementById('menu-screen');
    if (!intro || !menu || intro.classList.contains('done')) {
      this.finishIntro();
      return;
    }
    this.menuHandoffStarted = true;
    menu.classList.add('handoff');
    this.revealMenu();
    intro.classList.add('flying');
    // Wait out the topbar's entrance so the target rect has settled.
    this.introBeatTimer = window.setTimeout(() => this.flyLogoToMenu(), 500);
  }

  /**
   * Transform the intro emblem onto the menu's own, measured not guessed. The
   * beats compare marks rather than lockups: the intro carries the mark alone,
   * so the topbar is where the rule and the words are laid out.
   */
  private flyLogoToMenu(): void {
    const intro = document.getElementById('intro-screen');
    const logo = document.querySelector<HTMLElement>('.intro-game-logo');
    const target = document.querySelector<HTMLElement>('.menu-topbar .game-logo');
    const from = logo?.querySelector<HTMLElement>('.game-logo-mark')?.getBoundingClientRect();
    const to = target?.querySelector<HTMLElement>('.game-logo-mark')?.getBoundingClientRect();
    if (!intro || !logo || !from || !to || from.width < 1 || to.width < 1) {
      this.finishIntro();
      return;
    }
    logo.style.transformOrigin = '0 0';
    logo.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${(to.width / from.width).toFixed(4)})`;
    this.introBeatTimer = window.setTimeout(() => this.finishIntro(), 750);
  }

  private finishIntro(): void {
    const intro = document.getElementById('intro-screen');
    if (!intro || intro.classList.contains('done')) return;
    window.clearTimeout(this.introTimer);
    window.clearTimeout(this.introBeatTimer);
    this.introPlayed = true;
    if (!this.menuHandoffStarted) this.revealMenu();
    const menu = document.getElementById('menu-screen');
    menu?.classList.remove('handoff');
    // The mark has landed: draw the rule and type the lockup in behind it.
    menu?.classList.add('docked');
    // The sting is over: let the menu theme take the room.
    this.audio.playMenuMusic();
    intro.classList.add('done');
    window.setTimeout(() => intro.classList.add('hidden'), 700);
  }

  /** Kick off the staged menu entrance once the sting has cleared the screen. */
  private revealMenu(): void {
    const menu = document.getElementById('menu-screen');
    if (!menu) return;
    menu.classList.add('ready');
    menu.classList.remove('replay');
    // Force a reflow so the entrance animations restart when the sting replays.
    void menu.offsetWidth;
    menu.classList.add('replay');
  }

  /* ------------------------------------------------------------------ */
  /* Menu views                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * The switch reads as a signal break rather than a cut: the shell tears, the
   * picture kicks and the new panel's copy comes up line by line. Re-adding the
   * class restarts it, so tapping the same option twice still feels answered.
   */
  private glitchSwitch(): void {
    const app = document.getElementById('app');
    if (!app) return;
    window.clearTimeout(this.glitchTimer);
    app.classList.remove('glitching');
    void app.offsetWidth;
    app.classList.add('glitching');
    this.glitchTimer = window.setTimeout(() => app.classList.remove('glitching'), 760);
  }

  private setMenuMode(active: boolean): void {
    document.getElementById('app')?.classList.toggle('menu-mode', active);
  }

  showMenuView(view: MenuView | null): void {
    this.menuView = view;
    const menu = document.getElementById('menu-screen');
    if (!menu) return;
    // An idle deck shows its own panel; `dataset.view` keeps the CSS switch honest.
    menu.dataset.view = view ?? 'idle';
    menu.querySelectorAll<HTMLButtonElement>('[data-menu-view]').forEach((btn) => {
      const active = btn.dataset.menuView === view;
      btn.classList.toggle('on', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    if (view === 'settings') this.renderMenuSettings();
    if (view === 'editor') this.refreshEditorAutosaveButton();
    if (view === 'skirmish') this.paintMapThumbnails();
  }

  /* ------------------------------------------------------------------ */
  /* Menu battlefield backdrop                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Show the selected theatre behind the menu and let the camera drift across
   * it, so the shell reads as a game rather than a page over a black canvas.
   */
  private startMenuBackdrop(): void {
    this.setMenuBackdrop(this.selectedScenario());
  }

  /** Swap the map behind the shell, used both on arrival and on selection. */
  private setMenuBackdrop(scenario: Scenario): void {
    // The ground behind the shell is a downlink: `.menu-mode` lets CSS tear it.
    this.setMenuMode(true);
    this.menuScenario = scenario;
    this.menuDrift = 0;
    this.renderer.setScenario(scenario);
    this.renderer.settings.grid = false;
    this.renderer.settings.showFog = false;
    this.renderer.camera.setScreenLift(0);
    this.renderer.camera.setZoom(38);
    this.advanceMenuBackdrop(0);
    this.paintBriefMap();
  }

  /**
   * The mission brief shows the real island, not a sketch: the same scenario
   * that the battlefield is built from, rasterised, with the callouts pinned to
   * the two command posts.
   */
  private paintBriefMap(): void {
    const canvas = document.getElementById('brief-map-canvas') as HTMLCanvasElement | null;
    const scenario = this.menuScenario;
    if (!canvas || !scenario) return;
    drawBriefMap(canvas, scenario);
    // The panel is sized by the stylesheet, so repaint whenever its box moves
    // (window resize, responsive column) instead of stretching one raster.
    if (!this.briefObserver && 'ResizeObserver' in window) {
      this.briefObserver = new ResizeObserver(() => this.paintBriefMap());
      this.briefObserver.observe(canvas);
    }
    for (const label of briefMapLabels(scenario)) {
      const el = document.getElementById(
        label.side === 'friend' ? 'brief-label-friend' : 'brief-label-enemy',
      );
      if (!el) continue;
      el.style.left = `${label.x.toFixed(2)}%`;
      el.style.top = `${label.z.toFixed(2)}%`;
    }
  }

  /**
   * Portrait phones are unplayable: the command deck, production rail and map
   * need the full width. Show a blocking rotate prompt and hold the battle
   * while it is up, without overriding a pause the player chose themselves.
   */
  private updateOrientationPrompt(): void {
    const screen = document.getElementById('rotate-screen');
    if (!screen) return;
    const show = needsLandscape(window.innerWidth, window.innerHeight, this.renderer.isTouch);
    // The element's own class is the state, so a stale flag can never leave the
    // gate up after the device has been turned back.
    if (show === !screen.classList.contains('hidden')) return;
    screen.classList.toggle('hidden', !show);
    document.body.classList.toggle('orientation-locked', show);
    if (show) {
      this.orientationPaused = this.pauseForModal();
    } else {
      this.resumeAfterModal(this.orientationPaused);
      this.orientationPaused = false;
    }
  }

  private advanceMenuBackdrop(dt: number): void {
    const scenario = this.menuScenario;
    if (!scenario) return;
    this.menuDrift += Math.min(0.05, dt);
    const t = this.menuDrift;
    const worldW = scenario.width * TILE_SIZE;
    const worldH = scenario.height * TILE_SIZE;
    const cx = worldW * 0.52 + Math.sin(t * 0.055) * worldW * 0.08;
    const cz = worldH * 0.54 + Math.cos(t * 0.041) * worldH * 0.06;
    this.renderer.camera.centerOn(cx, cz);
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

  /* ------------------------------------------------------------------ */
  /* Theatre selection                                                   */
  /* ------------------------------------------------------------------ */

  /** Built-in maps are generated once and shared by the shell and the thumbnails. */
  private scenarioFor(id: string): Scenario {
    const cached = this.mapCache.get(id);
    if (cached) return cached;
    const scenario = builtinScenario(id).create();
    this.mapCache.set(id, scenario);
    return scenario;
  }

  private selectedScenario(): Scenario {
    return this.scenarioFor(this.settings.mapId);
  }

  /**
   * The scenario a skirmish is actually fought on: the selected theatre with
   * both player slots stamped from the nation registry. The cached backdrop is
   * never mutated, so changing nations cannot leak into another view.
   */
  private deployScenario(): Scenario {
    const scenario = cloneScenario(this.selectedScenario());
    const mine = identityDef(this.settings.nationId);
    const theirs = defaultOpponentNation(mine.id);
    // The map's callsigns belong to its legacy presets ("Baltic Task Force"),
    // so a nation deployment also stamps a formation name it actually owns.
    if (scenario.players[0]) {
      scenario.players[0].factionId = mine.id;
      scenario.players[0].name = `${mine.name} Task Force`;
    }
    if (scenario.players[1]) {
      scenario.players[1].factionId = theirs.id;
      scenario.players[1].name = `${theirs.name} Task Force`;
    }
    return scenario;
  }

  /** Nation picker: one option per playable nation, grouped by alliance. */
  private buildNationSelector(): void {
    const select = document.getElementById('nation-select') as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = '';
    for (const alliance of ALLIANCE_LIST) {
      const nations = NATION_LIST.filter((nation) => nation.allianceId === alliance.id);
      if (nations.length === 0) continue;
      const group = document.createElement('optgroup');
      group.label = alliance.name.toUpperCase();
      for (const nation of nations) {
        const option = document.createElement('option');
        option.value = nation.id;
        option.textContent = nation.name;
        group.appendChild(option);
      }
      select.appendChild(group);
    }
    select.value = this.settings.nationId;
    select.addEventListener('change', () => {
      if (!PLAYABLE_NATION_IDS.includes(select.value)) {
        select.value = this.settings.nationId;
        return;
      }
      this.audio.init();
      this.audio.play('ui');
      this.settings.nationId = select.value;
      this.saveSettings();
      this.applyNationUi();
    });
    this.applyNationUi();
  }

  /**
   * Every surface that names the two sides reads the same registry records: the
   * picker note, the mission brief and (through the stamped scenario) the
   * loading screen and HUD.
   */
  private applyNationUi(): void {
    const identity = identityDef(this.settings.nationId);
    const alliance = identityAlliance(identity.id);
    const opponent = defaultOpponentNation(identity.id);
    const select = document.getElementById('nation-select') as HTMLSelectElement | null;
    if (select && select.value !== identity.id) select.value = identity.id;
    const text = (id: string, value: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    text('nation-note', `${identity.name} · ${alliance.name} — ${identity.blurb}`);
    text('brief-command', identity.name);
    text('brief-formation', identity.legacy ? 'Alliance task force' : `${identity.name} Task Force`);
    text('brief-doctrine', identity.doctrine ?? 'Alliance task force');
    text('brief-opposition', opponent.name);
    text('brief-alliance', alliance.name);
    text('brief-label-friend', identity.shortName || identity.name);
    text('brief-label-enemy', opponent.shortName || opponent.name);
  }

  private buildMapSelector(): void {
    const root = document.getElementById('map-cards');
    if (!root) return;
    root.innerHTML = '';
    for (const entry of BUILTIN_SCENARIOS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-card';
      btn.dataset.mapId = entry.id;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.innerHTML = `
        <canvas class="map-card-canvas" aria-hidden="true"></canvas>
        <span class="map-card-text">
          <b>${escapeHtml(entry.name.replace('Island Assault — ', ''))}</b>
          <small>${escapeHtml(entry.focus)} · ${entry.width}×${entry.height}</small>
        </span>`;
      btn.addEventListener('click', () => {
        this.audio.init();
        this.audio.play('ui');
        this.selectMap(entry.id);
      });
      root.appendChild(btn);
    }
    this.applyMapUi();
  }

  private selectMap(id: string): void {
    if (this.settings.mapId !== id) {
      this.settings.mapId = id;
      this.saveSettings();
      this.setMenuBackdrop(this.selectedScenario());
    }
    this.applyMapUi();
    this.applyNationUi();
    this.paintMapThumbnails();
  }

  /** The head, the brief and the selector all describe the selected theatre. */
  private applyMapUi(): void {
    const entry = builtinScenario(this.settings.mapId);
    const scenario = this.selectedScenario();
    const index = Math.max(0, BUILTIN_SCENARIOS.findIndex((s) => s.id === entry.id));
    const text = (id: string, value: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    document.querySelectorAll<HTMLButtonElement>('.map-card').forEach((btn) => {
      const on = btn.dataset.mapId === entry.id;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    text('skirmish-eyebrow', `SKIRMISH · ${entry.focus.toUpperCase()}`);
    text('skirmish-title', entry.name);
    text('skirmish-lede', scenario.meta.description || entry.description);
    text('brief-code', `${entry.focus.toUpperCase()} / 0${index + 1}`);
    text('brief-size', `${scenario.width} × ${scenario.height} tiles`);
    text('brief-domains', entry.domains);
    const canvas = document.getElementById('brief-map-canvas');
    canvas?.setAttribute('aria-label', `${entry.name} terrain map`);
    // Command, formation and the map's side labels are nation-driven; see
    // applyNationUi, which runs after this pass.
    this.paintBriefMap();
  }

  private paintMapThumbnails(): void {
    document.querySelectorAll<HTMLButtonElement>('.map-card').forEach((btn) => {
      const id = btn.dataset.mapId;
      const canvas = btn.querySelector('canvas');
      if (!id || !canvas || canvas.clientWidth < 4) return;
      drawBriefMap(canvas, this.scenarioFor(id));
    });
  }

  private showMenu(): void {
    document.getElementById('menu-screen')?.classList.remove('hidden', 'handoff');
    document.getElementById('loading-screen')?.classList.add('hidden');
    this.hud.unmount();
    this.screen = 'menu';
    this.game = null;
    this.paused = false;
    this.overlay.clear();
    this.renderer.setGame(null);
    this.audio.stopMatchMusic();
    this.audio.resetAnnouncer();
    this.startMenuBackdrop();
    this.applyDifficultyUi();
    this.applyNationUi();
    this.showMenuView(this.menuView);
    this.refreshEditorAutosaveButton();
    this.revealMenu();
    this.paintMapThumbnails();
    this.audio.playMenuMusic();
  }

  /**
   * The loading screen is a screen, not a modal: it fills the viewport over the
   * chosen map while the task force is assembled, and carries the brief.
   */
  private setLoading(active: boolean, scenario?: Scenario): void {
    const screen = document.getElementById('loading-screen');
    if (!screen) return;
    if (active && scenario) this.fillLoading(scenario);
    screen.classList.toggle('hidden', !active);
  }

  private fillLoading(scenario: Scenario): void {
    const entry: BuiltinScenario =
      BUILTIN_SCENARIOS.find((s) => s.id === scenario.meta.id) ?? BUILTIN_SCENARIOS[0];
    const text = (id: string, value: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    const difficulty = this.settings.difficulty;
    // The loading screen reads the scenario, not the menu settings, so an
    // editor launch or a restarted battle names the side it is actually fought as.
    const command = tryIdentityDef(scenario.players[0]?.factionId ?? '');
    const opponent = tryIdentityDef(scenario.players[1]?.factionId ?? '');
    text('loading-title', scenario.meta.name || entry.name);
    text('loading-lede', scenario.meta.description || entry.description);
    text('loading-size', `${scenario.width} × ${scenario.height} tiles`);
    text('loading-command', command?.name ?? scenario.players[0]?.name ?? 'Task force');
    text('loading-formation', scenario.players[0]?.name ?? 'Task force');
    text('loading-doctrine', command?.doctrine ?? 'Alliance task force');
    text('loading-opposition', opponent?.name ?? scenario.players[1]?.name ?? 'Opposing corps');
    text(
      'loading-alliance',
      command ? identityAlliance(command.id).name : 'Unallied force',
    );
    text('loading-domains', entry.domains);
    text('loading-difficulty', difficulty[0].toUpperCase() + difficulty.slice(1));
    const hint = document.getElementById('loading-hint');
    if (hint) hint.textContent = 'Building terrain mesh · plotting navigation · briefing AI commander';
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
    // The menu theme belongs to the deck, not the battlefield. Clear any voice
    // line or cooldown left by a previous engagement.
    this.audio.stopMenuMusic();
    this.audio.stopMatchMusic();
    this.audio.resetAnnouncer();
    // The map stays on screen behind the briefing while the battle is built.
    this.setLoading(true, scenario);
    document.getElementById('menu-screen')?.classList.add('hidden');
    this.hud.unmount();
    this.overlay.clear();
    const shownAt = performance.now();
    await new Promise((resolve) => window.setTimeout(resolve, 240));
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
      // A fast machine would otherwise flash the briefing for a single frame.
      const elapsed = performance.now() - shownAt;
      if (elapsed < 780) await new Promise((resolve) => window.setTimeout(resolve, 780 - elapsed));
      this.menuScenario = null;
      this.renderer.settings.showFog = this.settings.fogVisual && gameScenario.settings.fog;
      this.renderer.setGame(game);
      this.renderer.camera.setBattleZoom();
      this.screen = 'battle';
      this.setMenuMode(false);
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
      this.audio.startMatchMusic();
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
      this.advanceMenuBackdrop(dt);
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
      const cue = announcementForEvent(ev, local);
      if (cue) this.audio.announce(cue);
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
    this.audio.stopMatchMusic();
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
      // Provenance for the slot list and support reports. The simulation never
      // reads this field, so the save format and its hash are unchanged.
      data.build = currentBuildStamp();
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
      this.audio.stopMatchMusic();
      this.audio.resetAnnouncer();
      this.audio.stopMenuMusic();
      document.getElementById('menu-screen')?.classList.add('hidden');
      this.setLoading(false);
      this.renderer.settings.showFog = this.settings.fogVisual && game.state.scenario.settings.fog;
      this.renderer.setGame(game);
      this.screen = 'battle';
      this.setMenuMode(false);
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
      // A save may already be decided; only a live battle gets a soundtrack.
      if (game.state.victory === 'playing') this.audio.startMatchMusic();
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
        ? `<small>${escapeHtml(record.name)} · ${escapeHtml(new Date(record.savedAt).toLocaleString())}</small><small class="slot-build">${escapeHtml(buildStampLabel(record.data.build))}</small>`
        : '<small>Empty slot</small>';
      return `<div class="slot-row"><div><b>SLOT ${slot}</b>${meta}</div><button class="btn btn-ghost" data-slot="${slot}">${record ? (loadMode ? 'Load' : 'Overwrite') : 'Empty'}</button></div>`;
    }).join('');
    openModal({
      title: loadMode ? 'Load battle' : 'Save battle',
      body: `<p class="build-stamp">${escapeHtml(VERSION_LINE)} · COMMIT ${escapeHtml(BUILD_COMMIT)}</p><div class="save-slots">${rows}</div><p class="modal-note">Saves are stored in this browser with versioned state and scenario data, and record the build that wrote them. A failed load leaves the current battle untouched.</p>`,
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

  private localStore(): KeyValueStore | null {
    try {
      return window.localStorage;
    } catch {
      // Storage can be blocked outright; the badge still works for this session.
      return null;
    }
  }

  /**
   * A build is acknowledged by opening the changelog. The badge is created
   * here rather than shipped in the markup, so a returning player never sees
   * it flash before the stored marker is read.
   */
  private refreshChangelogBadge(): void {
    const btn = document.getElementById('btn-changelog');
    if (!btn) return;
    const unseen = hasUnseenChangelog(currentBuildStamp(), this.changelogAck);
    btn.classList.toggle('has-new', unseen);
    btn.setAttribute('aria-label', unseen ? 'Changelog — new notes since your last visit' : 'Changelog');
    const badge = btn.querySelector<HTMLElement>('.menu-footer-badge');
    if (!unseen) {
      badge?.remove();
      return;
    }
    if (!badge) {
      const tag = document.createElement('span');
      tag.className = 'menu-footer-badge';
      tag.textContent = 'NEW';
      tag.setAttribute('aria-hidden', 'true');
      btn.appendChild(tag);
    }
  }

  /** The footer names the build that is actually running, not a typed string. */
  private renderVersionStamp(): void {
    const stamp = document.getElementById('menu-build');
    if (!stamp) return;
    stamp.textContent = `${VERSION_LINE} · IRONTIDE ENGINE`;
    stamp.title = versionTitle();
  }

  openChangelog(): void {
    this.changelogAck = markAcknowledged(this.localStore(), currentBuildStamp());
    this.refreshChangelogBadge();
    const resume = this.pauseForModal();
    openModal({
      title: 'Changelog',
      wide: true,
      body: `
        <p class="build-stamp">${escapeHtml(VERSION_LINE)} · COMMIT ${escapeHtml(BUILD_COMMIT)}</p>
        ${renderChangelog()}
        <p class="modal-note">The version and stage are read from package.json at build time; the build number is the repository commit count. This panel renders the same CHANGELOG.md that ships with the source.</p>`,
      actions: [{ label: 'Close', primary: true }],
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
    const resume = this.pauseForModal();
    openModal({
      title: 'Settings',
      body: `<div class="settings-grid">${this.settingsRowsMarkup()}</div>`,
      actions: [{ label: 'Done', primary: true }],
      onClose: () => this.resumeAfterModal(resume),
      onMount: (root) => this.bindSettingsControls(root),
    });
  }

  /**
   * One markup source for the settings rows, shared by the in-battle modal and
   * the main-menu Settings view so the two can never drift apart.
   */
  private settingsRowsMarkup(): string {
    const s = this.settings;
    return `
      <div class="setting-row"><div><label>Effects volume</label><small>Weapons, impacts and alerts</small></div><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-set="sfx"></div>
      <div class="setting-row"><div><label>Announcer volume</label><small>Strategic voice lines</small></div><input type="range" min="0" max="1" step="0.05" value="${s.voice}" data-set="voice"></div>
      <div class="setting-row"><div><label>Ambience volume</label><small>Sea, wind and low drone</small></div><input type="range" min="0" max="1" step="0.05" value="${s.ambient}" data-set="ambient"></div>
      <div class="setting-row"><div><label>Music volume</label><small>Menu and battle soundtracks</small></div><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-set="music"></div>
      <div class="setting-row"><div><label>Visual effects</label><small>Particles, smoke and tracers</small></div><button class="switch ${s.effects ? 'on' : ''}" data-toggle="effects"></button></div>
      <div class="setting-row"><div><label>Screen shake</label><small>Explosion camera movement</small></div><button class="switch ${s.shake ? 'on' : ''}" data-toggle="shake"></button></div>
      <div class="setting-row"><div><label>Fog of war</label><small>Visual fog; gameplay detection is unchanged</small></div><button class="switch ${s.fogVisual ? 'on' : ''}" data-toggle="fogVisual"></button></div>
      <div class="setting-row"><div><label>Edge panning</label><small>Move camera at screen edges</small></div><button class="switch ${s.edgePan ? 'on' : ''}" data-toggle="edgePan"></button></div>
      <div class="setting-row"><div><label>Fullscreen</label><small>Fill the screen; Esc leaves it</small></div><button class="switch ${isFullscreen() ? 'on' : ''}" data-toggle="fullscreen"></button></div>
    `;
  }

  private renderMenuSettings(): void {
    const grid = document.getElementById('menu-settings-grid');
    if (!grid) return;
    grid.innerHTML = this.settingsRowsMarkup();
    this.bindSettingsControls(grid);
  }

  private bindSettingsControls(root: HTMLElement): void {
    root.querySelectorAll<HTMLInputElement>('[data-set]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.set as 'sfx' | 'voice' | 'ambient' | 'music';
        this.settings[key] = Number(input.value);
        this.saveSettings();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggle;
        if (!key) return;
        if (key === 'fullscreen') {
          // Show the intent immediately, then let the document be the judge:
          // the fullscreenchange handler (or the promise) reconciles the switch.
          const next = !isFullscreen();
          btn.classList.toggle('on', next);
          btn.setAttribute('aria-pressed', next ? 'true' : 'false');
          void toggleFullscreen().then(() => this.syncFullscreenControls());
          return;
        }
        if (key !== 'effects' && key !== 'shake' && key !== 'fogVisual' && key !== 'edgePan') return;
        this.settings[key] = !this.settings[key];
        btn.classList.toggle('on', this.settings[key]);
        btn.setAttribute('aria-pressed', this.settings[key] ? 'true' : 'false');
        this.saveSettings();
        if (key === 'fogVisual') {
          this.renderer.settings.showFog = this.settings.fogVisual && !!this.game?.state.scenario.settings.fog;
        }
      });
    });
    // Keep any other copy of the same controls (menu view vs. battle modal) in step.
    root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
      const on = btn.dataset.toggle === 'fullscreen' ? isFullscreen() : btn.classList.contains('on');
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /**
   * Every Fullscreen switch — the menu Settings view and the in-battle modal —
   * follows the live document state, including leaving with Esc.
   */
  private syncFullscreenControls(): void {
    const on = isFullscreen();
    document.querySelectorAll<HTMLButtonElement>('[data-toggle="fullscreen"]').forEach((btn) => {
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = on ? 'Exit fullscreen (Esc)' : 'Enter fullscreen';
    });
  }

  /* ------------------------------------------------------------------ */
  /* Editor                                                              */
  /* ------------------------------------------------------------------ */

  openEditor(scenario?: Scenario): void {
    this.audio.init();
    this.audio.stopMenuMusic();
    this.audio.stopMatchMusic();
    this.menuScenario = null;
    document.getElementById('menu-screen')?.classList.add('hidden');
    this.hud.unmount();
    this.screen = 'editor';
    this.setMenuMode(false);
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

  /** Resume the last Scenario Forge autosave straight from the main menu. */
  openEditorAutosave(): void {
    const scenario = Editor.readAutosave();
    if (!scenario) {
      this.notify('No Scenario Forge autosave exists in this browser yet.', 'warning');
      this.refreshEditorAutosaveButton();
      return;
    }
    this.openEditor(scenario);
    this.notify('Scenario Forge autosave restored.', 'success');
  }

  private refreshEditorAutosaveButton(): void {
    const btn = document.getElementById('btn-editor-autosave') as HTMLButtonElement | null;
    if (!btn) return;
    const available = Editor.hasAutosave();
    btn.disabled = !available;
    btn.title = available
      ? 'Continue the last scenario saved by the Scenario Forge'
      : 'No Scenario Forge autosave exists in this browser yet';
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
    this.updateOrientationPrompt();
    if (this.screen === 'menu') this.paintBriefMap();
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
