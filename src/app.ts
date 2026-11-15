import { Renderer } from './render/renderer';
import { AIR_UNIT_ALTITUDE, PARKED_AIRCRAFT_CLEARANCE } from './render/unitMeshes';
import { Game } from './sim/game';
import { TICK_MS, TICK_RATE, TILE_SIZE } from './sim/constants';
import { BUILDINGS } from './data/buildings';
import { techDef } from './data/research';
import { UNITS } from './data/units';
import { createIslandAssault } from './data/scenarios';
import {
  SCENARIOS,
  defaultScenarioId,
  scenarioById,
  scenariosForMode,
} from './data/scenarioCatalog';
import {
  createTutorialScenario,
  TUTORIAL_BRIEF,
  TUTORIAL_SCENARIO_ID,
} from './data/tutorial';
import { commandersForNation } from './data/commanders';
import {
  PLAYABLE_NATION_IDS,
  playableNations,
  resolveOpponentNation,
  identityAlliance,
  identityDef,
  tryIdentityDef,
} from './data/factions';
import {
  CAMPAIGNS,
  campaignById,
  clearedMissionCount,
  emptyCampaignProgress,
  isMissionCleared,
  isMissionUnlocked,
  missionById,
  parseCampaignProgress,
  resumeMissionId,
  type CampaignDef,
  type CampaignMission,
  type CampaignProgress,
} from './data/campaign';
import {
  acceptCampaignResult,
  buildCampaignScenario,
  CampaignStateError,
  campaignProgressOf,
  campaignResultOutlook,
  campaignScenarioDeployments,
  createCampaignState,
  emptyCampaignSave,
  launchCampaignMission,
  migrateLegacyCampaignProgress,
  normaliseCommanderIdentity,
  parseCampaignSave,
  retryCampaignMission,
  serializeCampaignSave,
  submitCampaignResult,
  validateCampaignDefinition,
  validateCampaignState,
  type CampaignOutlook,
  type CampaignPendingResult,
  type CampaignSaveDoc,
  type CampaignState,
  type CommanderIdentity,
  type CommanderPronouns,
} from './campaign';
import type {
  MissionCinematicContext,
  MissionCinematicDoc,
  MissionResult,
} from './mission/types';
import type { MissionSection } from './mission/authoring';
import { missionDebriefMarkup } from './ui/missionDebrief';
import {
  CinematicPlayer,
  cinematicPausesSimulation,
  localiseCinematic,
} from './ui/cinematics';
import { CinematicOverlay } from './ui/cinematicOverlay';
import {
  briefingObjectiveListMarkup,
  briefingText,
  missionBriefingMarkup,
} from './ui/missionBriefing';
import {
  cloneScenario,
  canLaunch,
  validateScenario,
  type Scenario,
} from './sim/scenario';
import type { AIDifficulty, Command, Entity, Stance, VictoryState } from './sim/types';
import type { SaveData } from './sim/save';
import { AudioEngine } from './ui/audio';
import { combatMix } from './ui/audioSpatial';
import {
  SERVICE_BEACON_CHIRP_SECONDS,
  ambiencePlan,
  framingGain,
  serviceKitAmbience,
  structureAmbience,
  unitAmbience,
  type AmbienceCandidate,
} from './ui/ambience';
import { isServicingAircraft } from './render/servicing';
import {
  defaultMusicPlaylist,
  moveMusicTrack,
  normaliseMusicPlaylist,
  restoreDefaultMusicPlaylist,
  setMusicRepeat,
  setMusicShuffle,
  setMusicTrackEnabled,
  type MusicPlaylistPreferences,
  type MusicRepeatMode,
} from './ui/musicPlaylist';
import { musicPanelMarkup, syncMusicPanel } from './ui/musicSettings';
import { unitVoiceForEvent } from './ui/unitVoice';
import { eventVisibleToLocal } from './render/combatFx';
import { announcementForEvent } from './ui/announcer';
import { narratorForFaction } from './data/narrators';
import { HUD } from './ui/hud';
import { objectiveProgress } from './ui/objectiveBrief';
import { missionObjectiveMarkup, missionObjectiveView } from './ui/missionObjectiveView';
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
import { copyText, diagnosticsText } from './ui/diagnostics';
import {
  BUILD_COMMIT,
  VERSION_LINE,
  buildStampLabel,
  currentBuildStamp,
  versionTitle,
} from './version';
import {
  WEATHER,
  WEATHER_KINDS,
  normaliseWeather,
  weatherFor,
  type WeatherKind,
} from './sim/weather';
import { pickTerrain, terrainVisualHeight, type TerrainHit } from './render/terrainSurface';
import { constructionGridVisible } from './render/gridVisibility';
import { contextOrderFor } from './ui/orderIntent';
import { SUPERWEAPON_TARGET_LABEL } from './ui/superweaponView';
import type { SuperweaponStatus } from './sim/superweapons';
import { briefLabelPosition, briefMapLabels, drawBriefMap } from './ui/mapPreview';
import { flagNationForFaction, flagTextureUrl } from './render/flags';
import { needsLandscape } from './ui/orientation';
import { NationPicker } from './ui/nationPicker';
import { MultiplayerPanel } from './ui/multiplayerPanel';
import type { LobbyClient, LobbyView } from './multiplayer/lobbyClient';
import { buildLobbyScenario, validateLobbyConfig } from './multiplayer/lobbyConfig';
import { NetworkBattle } from './multiplayer/networkBattle';
import { enterFullscreen, isFullscreen, toggleFullscreen, wantsAutomaticFullscreen } from './ui/fullscreen';
import { MenuAttractMatch } from './ui/menuAttract';
import { readFlagState } from './identity/flagStore';
import { camoTintFor } from './identity/cosmetics';
import { AccountPanel } from './ui/accountPanel';
import { FlagStore } from './identity/flagStore';
import { parseFlagComposition, type FlagComposition } from './identity/flag';
import { HttpAccountApi, takeAuthOutcome } from './accounts/client';
import { ensureGuestProfile } from './accounts/guest';
import { CareerService } from './accounts/careerService';
import type { CareerMatchInput } from './accounts/career';
import { endCareerMarkup, mpCareerSummaryMarkup, type EndCareerState } from './ui/careerView';
import { CursorLayer, type AppCursor } from './ui/cursors';
import { addOrderGhost, type OrderGhost, type OrderGhostKind } from './ui/orderGhosts';
import { TutorialDirector } from './ui/tutorial';
import {
  BINDABLE_ACTIONS,
  DEFAULT_KEY_BINDINGS,
  actionLabel,
  assignKeyBinding,
  keyLabel,
  normaliseKeyBindings,
  resetKeyBindings,
  type BindableActionId,
  type KeyBindings,
} from './inputBindings';
import {
  GAMEPAD_SENSITIVITY_MAX,
  GAMEPAD_SENSITIVITY_MIN,
  GRAPHICS_QUALITIES,
  EDGE_PAN_SPEED_MAX,
  EDGE_PAN_SPEED_MIN,
  EDGE_PAN_WIDTH_MAX,
  EDGE_PAN_WIDTH_MIN,
  graphicsPreset,
  normaliseEdgePanSpeed,
  normaliseEdgePanWidth,
  normaliseEscBehavior,
  normaliseGamepadSensitivity,
  normaliseGraphicsQuality,
  normaliseLightBloom,
  nextIdleIndex,
  normaliseRenderScale,
  normaliseShadowDetail,
  normaliseUiScale,
  presetNightLights,
  SHADOW_DETAILS,
  SHADOW_DETAIL_LABELS,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  type EscBehavior,
  type GraphicsQuality,
  type ShadowDetail,
} from './settings';
import {
  COLOR_VISION_PALETTES,
  colorVisionCssVars,
  colorVisionTokens,
  normaliseColorVision,
  type ColorVisionPalette,
} from './colorVision';

import {
  normaliseDayLength,
  normaliseStartHour,
  phaseForStartHour,
} from './sim/dayNight';

export type Screen = 'menu' | 'battle' | 'editor';
/** Panels inside the main menu shell. */
export type MenuView =
  | 'singleplayer'
  | 'multiplayer'
  | 'campaign'
  | 'skirmish'
  | 'editor'
  | 'settings'
  | 'account';
/** Sections of the settings sheet; only one panel is visible at a time. */
export type SettingsTab = 'display' | 'input' | 'audio' | 'music';

export type CommandMode =
  | 'none'
  | 'move'
  | 'land'
  | 'attack'
  | 'attackMove'
  | 'patrol'
  | 'guard'
  | 'capture'
  | 'repair'
  | 'garrison'
  | 'box'
  | 'place'
  | 'superweapon';

export interface CampaignRun {
  campaign: CampaignDef;
  mission: CampaignMission;
  index: number;
  next: CampaignMission | null;
}

/** What the end-screen campaign card may offer. */
export interface CampaignDebriefInfo {
  missionName: string;
  nextMissionName: string | null;
  /** True only after the final result has been accepted. */
  campaignComplete: boolean;
  /** True when this is the last operation, accepted or not. */
  finalOperation: boolean;
  awaitingAcceptance: boolean;
}

export interface AppSettings {
  sfx: number;
  ambient: number;
  /** Menu theme volume. The track streams from /audio/music/menu-theme.mp3. */
  music: number;
  /** Strategic announcer voice volume. */
  voice: number;
  /** Selection, move, attack and refusal barks from the selected force. */
  unitVoice: number;
  effects: boolean;
  shake: boolean;
  fogVisual: boolean;
  edgePan: boolean;
  /** Depth of the edge-pan band, in CSS pixels from the battlefield edge. */
  edgePanWidth: number;
  /** Multiplier on the authored edge-pan camera speed. */
  edgePanSpeed: number;
  /** Gamepad camera and cursor speed, 0.4–2.5. */
  gamepadSensitivity: number;
  /** Remappable battle hotkeys, stored by action id. */
  keyBindings: KeyBindings;
  /**
   * Tactical reticles for orders, placement and box selection. Off falls back
   * to the platform's native pointers for players who prefer them.
   */
  customCursors: boolean;
  /** Opponent strength for new battles; a loaded save keeps its own. */
  difficulty: AIDifficulty;
  /** Selected skirmish theatre. */
  mapId: string;
  /** Playable nation the local commander fields in a new skirmish. */
  nationId: string;
  /**
   * Chosen opponent, or '' to face the deterministic default of the other
   * alliance. Any playable nation is a legal pick, mirror matches included.
   */
  opponentNationId: string;
  /**
   * Authored AI commander for the opposing seat, '' for the legacy seeded
   * profile. Always one of the opponent nation's own commanders.
   */
  opponentCommanderId: string;
  /** Team tint the local commander fields in a new skirmish (`#rrggbb`). */
  teamColor: string;
  /** Team tint of the opposing commander in a new skirmish. */
  opponentColor: string;
  /** HUD and menu scale, 0.8–1.5, driving the --ui-scale custom property. */
  uiScale: number;
  /** Colour-vision preset for ownership, health and alert signals. */
  colorVision: ColorVisionPalette;
  /** Render preset; controls render scale, particles, shadows and water. */
  graphicsQuality: GraphicsQuality;
  /** Shadow fidelity, independent of the preset after the player picks one. */
  shadowDetail: ShadowDetail;
  /** Fraction of the device pixel ratio (0.5–1), capped at 2x overall. */
  renderScale: number;
  /** Live frame-rate badge in the battle HUD. */
  fpsReadout: boolean;
  /** What Escape does outside a command mode: pause the battle or open a menu. */
  escBehavior: EscBehavior;
  /**
   * Battle soundtrack selection, order and playback options. The menu theme is
   * separate and is not represented here.
   */
  musicPlaylist: MusicPlaylistPreferences;
  /** Team-coloured outline where a unit is hidden behind a structure. */
  silhouettes: boolean;
  /** Building and vehicle lights after dark; presentation only. */
  nightLights: boolean;
  /** Additive light intensity multiplier; never touches detection. */
  lightBloom: number;
  /**
   * Whether a new skirmish permits national strategic superweapons. Both sides
   * read the same setting, so the match is symmetric whether it is on or off.
   */
  superweapons: boolean;
  /** Start hour for a new skirmish, 0..24. */
  startHour: number;
  /** Weather a new skirmish opens in; the simulation reads the profile. */
  weather: WeatherKind;
  /** Real minutes per in-game day; 0 freezes the clock at the start hour. */
  dayLengthMinutes: number;
  /**
   * Play authored mission cinematics. Off is the skip-all preference: campaign
   * progression and mission outcomes are untouched, only the scenes are.
   */
  cinematics: boolean;
}

/** Skirmish team colours: the alliance defaults, then four distinct picks. */
export const TEAM_COLORS = [
  { id: 'blue', hex: '#37b6e0', name: 'Blue' },
  { id: 'red', hex: '#ef6a4a', name: 'Red' },
  { id: 'green', hex: '#7fbf6a', name: 'Green' },
  { id: 'amber', hex: '#e0a34a', name: 'Amber' },
  { id: 'teal', hex: '#4fc9b8', name: 'Teal' },
  { id: 'violet', hex: '#a98bf0', name: 'Violet' },
  { id: 'slate', hex: '#9aaba2', name: 'Slate' },
  { id: 'white', hex: '#e8eeea', name: 'White' },
] as const;

export interface DragBox {
  active: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const SETTINGS_KEY = 'iron-tide.settings.v1';
const SAVE_PREFIX = 'iron-tide.save.v1.';
/** Pre-S4 deck progress, read once and migrated into the campaign save. */
const CAMPAIGN_PROGRESS_KEY = 'iron-tide.campaign.v1';
const CAMPAIGN_SAVE_KEY = 'iron-tide.campaign.v2';
/** The intro sting plays once per browser session, so reloads land in the menu. */

export const SAVE_SLOTS = [1, 2, 3];

const DIFFICULTY_COPY: Record<AIDifficulty, string> = {
  recruit: 'Recruit — thin economy and early small attacks; the easiest commander.',
  veteran: 'Veteran — balanced expansion, production and attack timing.',
  elite: 'Elite — the broadest economy and the best-timed combined-arms push.',
};

const DIFFICULTIES = Object.keys(DIFFICULTY_COPY) as AIDifficulty[];

const MENU_VIEWS: MenuView[] = [
  'singleplayer',
  'multiplayer',
  'campaign',
  'skirmish',
  'editor',
  'settings',
  'account',
];

/** Seconds a bot battle runs before the menu cuts to the next theatre. */
const ATTRACT_MATCH_SECONDS = 68;

/**
 * The menu backdrop runs its own sky. A compressed day cycle means the battle
 * behind the deck visibly moves through dawn, day, dusk and night while the
 * player sits in the menus, and each cut to the next theatre opens under a
 * different weather front. Both are authored scenario settings on a throwaway
 * bot battle, so nothing about a real match is bent: a skirmish or campaign
 * operation keeps the time of day and weather it was written with.
 */
const ATTRACT_DAY_MINUTES = 6;
const ATTRACT_START_HOURS = [5.5, 8.5, 12, 16, 19.5, 22] as const;
const ATTRACT_WEATHER: ReadonlyArray<Scenario['settings']['weather']> = [
  'clear',
  'overcast',
  'rain',
  'fog',
  'storm',
  'clear',
];

function isMenuView(value: unknown): value is MenuView {
  return MENU_VIEWS.includes(value as MenuView);
}

export class App {
  readonly renderer: Renderer;
  readonly audio = new AudioEngine();
  readonly overlay: Overlay;
  /** Full-window pointer layer, above every screen and modal. */
  readonly cursorLayer: CursorLayer;
  readonly hud: HUD;
  readonly input: InputController;
  readonly editor: Editor;

  screen: Screen = 'menu';
  /** null until the player picks a view: the menu opens with nothing selected. */
  menuView: MenuView | null = null;
  game: Game | null = null;
  /** The flag flown by the battle on screen, captured when it started. */
  private matchFlag: FlagComposition | null = null;
  /** The battle that flag belongs to, so a load cannot inherit an old one. */
  private matchFlagGame: Game | null = null;
  /** Scripted training overlay; null outside the tutorial mission. */
  tutorial: TutorialDirector | null = null;
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
  /** Last settings section opened; survives leaving and reopening Settings. */
  private settingsTab: SettingsTab = 'display';
  /** Window key listener while the player is recording a new binding. */
  private bindingCapture: AbortController | null = null;
  perf = { fps: 0, simMs: 0, frameMs: 0, entities: 0 };
  dragBox: DragBox = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  pointer = { x: 0, y: 0, over: false };
  /**
   * The drawn pointer for the whole app. Its name follows the armed order
   * while the pointer is over the battlefield and switches to the action or
   * blocked pointer over a HUD or menu control. `visible` is false when the
   * player uses native cursors, over a text field, or outside the window.
   */
  pointerCursor = { name: 'select' as AppCursor, visible: false };
  /** Fading impressions left by right-click move and attack orders. */
  orderGhosts: OrderGhost[] = [];
  padCursor = { x: 0, y: 0, active: false };

  private lastEventSeq = 0;
  /** Last local alert with a world position; F2 and critical toasts jump here. */
  private lastAlert: { x: number; z: number; tick: number } | null = null;
  /** Camera bookmarks saved with Ctrl+Shift+1..4 and recalled with Shift+1..4. */
  readonly bookmarks = new Map<number, { x: number; z: number }>();
  /** Last idle unit reached by each idle-unit hotkey, so presses cycle. */
  private idleCursor = new Map<string, number>();
  private accumulator = 0;
  /** Seconds since the battlefield bed last asked for a new plan. */
  private ambienceClock = 0;
  /** Seconds since the bowser beacon last chirped over a working apron. */
  private serviceChirpClock = 0;
  private lastFrame = 0;
  /** Scenario used by the static loading backdrop; null once a battle owns the canvas. */
  private menuScenario: Scenario | null = null;
  private menuDrift = 0;
  /** Live AI-vs-AI battle behind the main menu, if one is running. */
  private attract: MenuAttractMatch | null = null;
  private attractIndex = 0;
  private attractElapsed = 0;
  private attractFocus = { x: 0, z: 0 };
  private attractFocusTimer = 0;
  /** Ticks still to fast-forward on a new menu battle, spread across frames. */
  private attractWarmup = 0;
  /** Flag-bearing nation fields in the skirmish setup. */
  private nationPicker: NationPicker | null = null;
  private opponentPicker: NationPicker | null = null;
  /**
   * True while the pre-battle briefing is up. The frame loop treats it as its
   * own screen: the theatre is shown wide, nothing is simulated, and a restart
   * cannot tick the old battle underneath the loading copy.
   */
  loading = false;
  private introTimer = 0;
  private introBeatTimer = 0;
  /** One-shot downlink fault played when the deck changes. */
  private glitchTimer = 0;
  private menuHandoffStarted = false;
  /** Account chip in the menu header; null until the menu is installed. */
  private accountPanel: AccountPanel | null = null;
  private accountApi: HttpAccountApi | null = null;
  /** Career reads/writes; a guest and an account share this interface. */
  private careerService: CareerService | null = null;
  private briefObserver: ResizeObserver | null = null;
  /** Built-in theatres, generated once and shared by the backdrop and thumbnails. */
  private mapCache = new Map<string, Scenario>();
  /** Campaign selection is separate from the skirmish map and nation settings. */
  private campaignId = CAMPAIGNS[0].id;
  private campaignMissionId = CAMPAIGNS[0].missions[0].id;
  /**
   * The deck's view of accepted operations. Derived from `campaignSave`, never
   * written to storage on its own, so progression has one source of truth.
   */
  private campaignProgress: CampaignProgress = emptyCampaignProgress();
  /** Authoritative campaign runs and the deck's selection. */
  private campaignSave: CampaignSaveDoc = emptyCampaignSave();
  private campaignCache: { key: string; scenario: Scenario } | null = null;
  private campaignBriefObserver: ResizeObserver | null = null;
  /** Set only when this gate paused the battle, so a manual pause survives. */
  private orientationPaused = false;
  /** Set only when a lost GPU context paused the battle. */
  private contextPaused = false;
  /** The sting belongs to the launch, not to the menu: it plays once per page. */
  private introPlayed = false;
  private victoryShown: VictoryState | 'none' = 'none';
  /**
   * A mission test run owns a disposable scenario copy. It is never campaign
   * state and is never written to a battle or campaign save.
   */
  private missionTestScenario: Scenario | null = null;
  /** Workbench section the author launched the test from. */
  private missionTestSection: MissionSection | null = null;
  /**
   * Presentation-only cinematic playback. It is never serialised into a battle
   * save or a campaign save: recovering a save lands at the briefing or the end
   * screen, not halfway through a camera move.
   */
  private cinematic: CinematicPlayer | null = null;
  private cinematicContext: MissionCinematicContext | null = null;
  /** Set while the Forge is previewing a scene, so the backdrop is released. */
  private cinematicPreview = false;
  private readonly cinematicOverlay: CinematicOverlay;
  /** In-mission sequences already shown in this battle run. */
  private readonly cinematicPlayed = new Set<string>();
  /** Background surfaces this scene made inert, so they can be restored. */
  private readonly cinematicBackground = new Set<HTMLElement>();
  private fpsSamples: number[] = [];
  /** Build key whose changelog notes this device has acknowledged. */
  private changelogAck: string | null = null;
  /** Network deck; built on first visit so an offline launch opens no socket. */
  private multiplayerPanel: MultiplayerPanel | null = null;
  /** Live networked battle, or null in a local match. */
  private network: NetworkBattle | null = null;
  /** The seat whose stream feeds `network`. */
  private networkClient: LobbyClient | null = null;
  /**
   * Room+seat whose handoff has been attempted. The deck reports the started
   * match on every update, so without this the entry would be retried on each
   * one; it is cleared when the seat is given up.
   */
  private networkHandoffKey: string | null = null;
  /**
   * True while the seat is showing a room that has stopped sending. Without it
   * a dropped link looks like a battle where every order is ignored.
   */
  private networkStale = false;
  /**
   * Room+seat currently linking behind the loading brief. The room reports
   * "playing" before its first update has arrived, so the brief is held until
   * that update is applied instead of dropping the player onto an empty map.
   */
  private networkLoadingKey: string | null = null;
  private networkLoadingShownAt = 0;
  private networkLoadingTimer: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    cursorCanvas: HTMLCanvasElement,
  ) {
    this.renderer = new Renderer(canvas);
    this.overlay = new Overlay(overlayCanvas);
    this.cursorLayer = new CursorLayer(cursorCanvas);
    this.settings = this.loadSettings();
    this.applySettings();
    // Keep an open settings sheet in step with automatic track changes and
    // previews without polling or rebuilding the panel.
    this.audio.onMatchMusicChange(() => this.syncMusicPlaybackUi());
    this.campaignSave = this.loadCampaignSave();
    this.restoreCampaignSelection();
    this.hud = new HUD(this);
    this.cinematicOverlay = new CinematicOverlay();
    this.cinematicOverlay.bind({
      onSkip: () => this.skipCinematic(),
      onSkipAll: () => this.skipAllCinematics(),
    });
    this.renderer.onContextLost = () => this.handleGraphicsContextLost();
    this.renderer.onContextRestored = () => this.handleGraphicsContextRestored();
    this.input = new InputController(this, canvas);
    this.editor = new Editor(this);
    this.installMenu();
    this.installResize();
    this.bindFirstInteraction();
    this.startMenuBackdrop();
    this.resize();
    // A development handle for the console and for automated visual checks.
    // Production bundles never expose it: `import.meta.env.DEV` is compiled out.
    if (import.meta.env.DEV) {
      (window as unknown as { mca?: App }).mca = this;
    }
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
      unitVoice: 0.7,
      musicPlaylist: defaultMusicPlaylist(),
      effects: true,
      shake: true,
      fogVisual: true,
      edgePan: true,
      edgePanWidth: 18,
      edgePanSpeed: 1,
      gamepadSensitivity: 1,
      keyBindings: { ...DEFAULT_KEY_BINDINGS },
      customCursors: true,
      difficulty: 'veteran',
      mapId: defaultScenarioId('skirmish'),
      nationId: PLAYABLE_NATION_IDS[0],
      opponentNationId: '',
      opponentCommanderId: '',
      teamColor: TEAM_COLORS[0].hex,
      opponentColor: TEAM_COLORS[1].hex,
      uiScale: 1,
      colorVision: 'standard',
      graphicsQuality: 'high',
      shadowDetail: 'detailed',
      renderScale: 1,
      fpsReadout: false,
      escBehavior: 'pause',
      silhouettes: true,
      nightLights: true,
      lightBloom: 1,
      startHour: 18,
      weather: 'clear',
      superweapons: true,
      // One in-game day is four real hours, so a skirmish lives inside a phase
      // and only a long battle actually crosses into the dark.
      dayLengthMinutes: 240,
      cinematics: true,
    };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      const difficulty = DIFFICULTIES.includes(parsed.difficulty as AIDifficulty)
        ? (parsed.difficulty as AIDifficulty)
        : defaults.difficulty;
      const mapId = scenariosForMode('skirmish').some((s) => s.id === parsed.mapId)
        ? (parsed.mapId as string)
        : defaults.mapId;
      // Only a playable nation is a valid selection; an older or hand-edited
      // settings blob must not put an alliance or an unknown id in a player slot.
      const nationId = PLAYABLE_NATION_IDS.includes(parsed.nationId as string)
        ? (parsed.nationId as string)
        : defaults.nationId;
      // A saved opponent survives only while it still names a playable nation;
      // an older or hand-edited id falls back to the deterministic default.
      const opponentNationId =
        typeof parsed.opponentNationId === 'string' &&
        resolveOpponentNation(nationId, parsed.opponentNationId).id === parsed.opponentNationId
          ? parsed.opponentNationId
          : '';
      // A commander is a choice inside the opponent's nation, so a saved id
      // survives only while that nation still fields it; anything else falls
      // back to the seeded profile rather than to a foreign leader.
      const opponentNation = resolveOpponentNation(nationId, opponentNationId).id;
      const opponentCommanderId =
        typeof parsed.opponentCommanderId === 'string' &&
        commandersForNation(opponentNation).some((c) => c.id === parsed.opponentCommanderId)
          ? parsed.opponentCommanderId
          : '';
      const hexColor = (value: unknown, fallback: string): string =>
        typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
      return {
        ...defaults,
        ...parsed,
        music: Math.max(0, Math.min(1, Number(parsed.music ?? defaults.music))),
        voice: Math.max(0, Math.min(1, Number(parsed.voice ?? defaults.voice))),
        unitVoice: Math.max(0, Math.min(1, Number(parsed.unitVoice ?? defaults.unitVoice))),
        difficulty,
        mapId,
        nationId,
        opponentNationId,
        opponentCommanderId,
        teamColor: hexColor(parsed.teamColor, defaults.teamColor),
        opponentColor: hexColor(parsed.opponentColor, defaults.opponentColor),
        // Older saved settings have none of these fields; each falls back to
        // the documented default instead of inheriting an unsafe value.
        uiScale: normaliseUiScale(parsed.uiScale ?? defaults.uiScale),
        colorVision: normaliseColorVision(parsed.colorVision ?? defaults.colorVision),
        graphicsQuality: normaliseGraphicsQuality(parsed.graphicsQuality),
        // A settings file written before shadow levels existed takes the
        // preset's recommendation: low stays flat, medium keeps basic and high
        // gets the full realtime map.
        shadowDetail: normaliseShadowDetail(
          parsed.shadowDetail ??
            graphicsPreset(normaliseGraphicsQuality(parsed.graphicsQuality)).shadowDetail,
        ),
        // A saved game with a quality but no explicit density (or any file
        // written before this setting existed) starts from the preset value.
        renderScale: normaliseRenderScale(
          parsed.renderScale ??
            graphicsPreset(normaliseGraphicsQuality(parsed.graphicsQuality)).renderScale,
        ),
        edgePanWidth: normaliseEdgePanWidth(parsed.edgePanWidth ?? defaults.edgePanWidth),
        edgePanSpeed: normaliseEdgePanSpeed(parsed.edgePanSpeed ?? defaults.edgePanSpeed),
        gamepadSensitivity: normaliseGamepadSensitivity(
          parsed.gamepadSensitivity ?? defaults.gamepadSensitivity,
        ),
        keyBindings: normaliseKeyBindings(parsed.keyBindings),
        // A settings file written before playlists existed gets the authored
        // default. An existing custom selection is preserved, and newly shipped
        // catalogue tracks are appended but not silently enabled.
        musicPlaylist: normaliseMusicPlaylist(parsed.musicPlaylist ?? defaults.musicPlaylist),
        customCursors:
          typeof parsed.customCursors === 'boolean'
            ? parsed.customCursors
            : defaults.customCursors,
        fpsReadout: typeof parsed.fpsReadout === 'boolean' ? parsed.fpsReadout : defaults.fpsReadout,
        escBehavior: normaliseEscBehavior(parsed.escBehavior),
        silhouettes: typeof parsed.silhouettes === 'boolean' ? parsed.silhouettes : defaults.silhouettes,
        nightLights: typeof parsed.nightLights === 'boolean' ? parsed.nightLights : defaults.nightLights,
        lightBloom: normaliseLightBloom(parsed.lightBloom),
        startHour: normaliseStartHour(parsed.startHour, defaults.startHour),
        // An older settings blob has no weather; an unknown id is a clear day
        // rather than a rejected settings file.
        weather: normaliseWeather(parsed.weather),
        dayLengthMinutes: normaliseDayLength(parsed.dayLengthMinutes, defaults.dayLengthMinutes),
        cinematics: parsed.cinematics !== false,
        // A settings file written before this rule existed permits strategic
        // superweapons, which is what a default match already meant.
        superweapons: parsed.superweapons !== false,
      };
    } catch {
      return defaults;
    }
  }

  applySettings(): void {
    this.renderer.settings.effects = this.settings.effects;
    this.renderer.settings.shake = this.settings.shake;
    this.renderer.settings.showFog = this.settings.fogVisual;
    // One preset feeds three renderer ceilings: density, particles and effects.
    // The explicit render scale refines the preset without changing its name.
    const preset = graphicsPreset(this.settings.graphicsQuality);
    this.renderer.settings.renderScale = normaliseRenderScale(this.settings.renderScale);
    this.renderer.settings.shadowDetail = normaliseShadowDetail(this.settings.shadowDetail);
    this.renderer.settings.waterDetail = preset.waterDetail;
    this.renderer.settings.silhouettes = this.settings.silhouettes;
    this.renderer.settings.nightLights = this.settings.nightLights;
    this.renderer.settings.lightBloom = normaliseLightBloom(this.settings.lightBloom);
    this.renderer.settings.colorVision = this.settings.colorVision;
    this.renderer.particles.setCap(preset.maxParticles);
    // The stylesheet and the canvas read one palette. CSS custom properties
    // keep DOM health/alert readouts in step with the battlefield overlay.
    const paletteTokens = colorVisionTokens(this.settings.colorVision);
    document.documentElement.dataset.palette = this.settings.colorVision;
    for (const [property, value] of Object.entries(colorVisionCssVars(paletteTokens))) {
      document.documentElement.style.setProperty(property, value);
    }
    const scale = normaliseUiScale(this.settings.uiScale);
    document.documentElement.style.setProperty('--ui-scale', String(scale));
    // Density is read inside resize(); a settings change must not wait for the
    // next window resize to take effect. A live battle also re-frames its
    // camera because the rail and console just changed size.
    this.renderer.resize();
    document.documentElement.classList.toggle('custom-cursors', this.settings.customCursors);
    if (this.screen === 'battle' && this.hud) this.resize();
    this.audio.setVolumes(1, this.settings.sfx, this.settings.ambient);
    this.audio.setMusicVolume(this.settings.music);
    this.audio.setVoiceVolume(this.settings.voice);
    this.audio.setUnitVoiceVolume(this.settings.unitVoice);
    this.audio.setMusicPlaylist(this.settings.musicPlaylist);
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
    on('btn-campaign-deploy', () => this.deployCampaignMission());
    on('btn-tutorial', () => void this.startBattle(createTutorialScenario()));
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
    document.querySelectorAll<HTMLButtonElement>('[data-menu-back]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.audio.init();
        this.audio.play('ui');
        const target = btn.dataset.menuBack;
        this.showMenuView(target && target !== 'top' && isMenuView(target) ? target : null);
        this.glitchSwitch();
      });
    });
    const difficultySelect = document.getElementById('difficulty') as HTMLSelectElement | null;
    if (difficultySelect) {
      // A dropdown, not a row of buttons: the deployment rail has to hold two
      // nations, two colours, the start hour and weather without scrolling.
      difficultySelect.innerHTML = DIFFICULTIES.map(
        (id) => `<option value="${id}">${id.charAt(0).toUpperCase()}${id.slice(1)}</option>`,
      ).join('');
      difficultySelect.addEventListener('change', () => {
        const difficulty = difficultySelect.value as AIDifficulty;
        if (!DIFFICULTIES.includes(difficulty)) return;
        this.audio.init();
        this.audio.play('ui');
        this.settings.difficulty = difficulty;
        this.saveSettings();
        this.applyDifficultyUi();
      });
    }
    document.querySelectorAll<HTMLButtonElement>('[data-superweapons]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.audio.init();
        this.audio.play('ui');
        this.settings.superweapons = btn.dataset.superweapons !== 'off';
        this.saveSettings();
        this.applySuperweaponUi();
      });
    });
    document.querySelectorAll<HTMLButtonElement>('[data-start-time]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hour = Number(btn.dataset.startTime);
        if (!Number.isFinite(hour)) return;
        this.audio.init();
        this.audio.play('ui');
        this.settings.startHour = normaliseStartHour(hour);
        this.saveSettings();
        this.applyTimeOfDayUi();
        // The menu backdrop is the selected theatre at the selected hour, so the
        // player sees the light they are choosing before deploying.
        this.setMenuBackdrop(this.selectedScenario());
      });
    });
    this.configureMultiplayerNav();
    this.renderVersionStamp();
    this.changelogAck = readAcknowledged(this.localStore());
    this.refreshChangelogBadge();
    this.buildMapSelector();
    this.buildNationSelector();
    this.buildOpponentSelector();
    this.buildCommanderSelector();
    this.buildTeamColors();
    this.buildWeatherSelector();
    this.buildCampaignScreen();
    document.addEventListener('fullscreenchange', () => this.syncFullscreenControls());
    this.applyDifficultyUi();
    this.applyTimeOfDayUi();
    this.applyWeatherUi();
    this.applySuperweaponUi();
    this.showMenuView(this.menuView);
    this.renderMenuSettings();
    this.refreshEditorAutosaveButton();
    this.installAccount();
    this.installIntro();
  }

  /**
   * The account chip in the menu header.
   *
   * The guest profile is created here rather than at boot so opening the game
   * writes one small local record and nothing else: no account, no request. A
   * blocked localStorage still leaves a usable session-only guest identity.
   */
  /**
   * Apply the equipped unit camo to the local player's own units.
   *
   * Read from the same local document the flag editor writes, so a camo worn in
   * the menu is already in place on the first painted frame of a battle. The
   * renderer tints hull panels only; nothing here touches the simulation.
   */
  private applyUnitCamo(): void {
    let camo: string | null = null;
    try {
      camo = typeof localStorage === 'undefined' ? null : readFlagState(localStorage).equipped.camo;
    } catch {
      camo = null;
    }
    this.renderer.setUnitCamo(camoTintFor(camo));
  }

  private installAccount(): void {
    const storage = this.localStore();
    const guest = storage ? ensureGuestProfile(storage) : null;
    this.accountApi = new HttpAccountApi();
    this.careerService = new CareerService(this.accountApi, storage);
    this.accountPanel = new AccountPanel({
      api: this.accountApi,
      guest,
      storage,
      career: this.careerService,
      notify: (text, level) => this.notify(text, level),
      // The chip is a route like Settings: clicking it opens the account screen,
      // and clicking it while that screen is open returns to the main menu.
      navigate: (view) => {
        if (this.screen !== 'menu') return;
        this.showMenuView(view && this.menuView === view ? null : view);
        this.glitchSwitch();
      },
      // A result card is mid-debrief, so its award notice points at the menu
      // rather than yanking the player out of the acceptance flow.
      openLegacy: () => {
        if (this.screen !== 'menu') {
          this.notify('Commander Legacy is in the main menu under Account.', 'info');
          return;
        }
        this.showMenuView('account');
        this.accountPanel?.showLegacy();
        this.glitchSwitch();
      },
    });
    this.accountPanel.mount();
    // A sign-in redirect lands back on the menu with `?auth=…`; consuming it
    // here keeps the address bar clean and reports the outcome in one place.
    const outcome = takeAuthOutcome(window.location, window.history);
    if (outcome) {
      void this.accountPanel.handleAuthOutcome(outcome.outcome, outcome.code);
    }
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
        // Audio needs the gesture: start it before any await.
        this.audio.init();
        this.audio.play('ui');
        this.enterIntroFullscreen();
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

  /**
   * The room worker this client talks to. Configured at build time, with a
   * loopback default so `npm run dev` can drive `npm run rooms:dev`. No address
   * means the deck says so rather than pretending to host a room offline.
   */
  private multiplayerOrigin(): string {
    const configured = String(import.meta.env.VITE_MULTIPLAYER_URL ?? '').trim();
    if (configured) return configured.replace(/\/+$/, '');
    return import.meta.env.DEV ? 'http://127.0.0.1:8791' : '';
  }

  /**
   * The shipped markup offers no online entry, because a build with no room
   * worker address cannot host anything. Configuring an address is what turns
   * the deck on, so the shipped default and a misconfigured staging build both
   * stay honest about what they can do.
   */
  private configureMultiplayerNav(): void {
    const origin = this.multiplayerOrigin();
    if (!origin) return;
    const entry = document.querySelector<HTMLButtonElement>('[data-menu-view="multiplayer"]');
    if (!entry) return;
    entry.disabled = false;
    entry.removeAttribute('aria-disabled');
    entry.removeAttribute('title');
    entry.classList.remove('soon');
    const badge = entry.querySelector('.menu-nav-badge');
    if (badge) badge.textContent = '1V1';
    const summary = entry.querySelector('.menu-nav-text small');
    if (summary) summary.textContent = 'Host or join a 1v1 room';
  }

  private ensureMultiplayerPanel(): MultiplayerPanel | null {
    const host = document.getElementById('multiplayer-panel');
    if (!host) return null;
    if (!this.multiplayerPanel) {
      this.multiplayerPanel = new MultiplayerPanel(host, {
        origin: this.multiplayerOrigin(),
        onMatchStart: (client, view) => this.startNetworkBattle(client, view),
        // A signed-in player's seat is verified by the room Worker; a guest, or
        // an account service that cannot mint a ticket, simply opens a guest
        // seat. Matchmaking never waits on identity.
        identityTicket: async () => {
          if (!this.accountApi) return null;
          try {
            return (await this.accountApi.multiplayerTicket()).ticket;
          } catch {
            return null;
          }
        },
        // Only the service can publish a record; the lobby asks it rather than
        // reading anything an opponent's client might claim.
        lookupPlayer: async (callsign) => {
          if (!this.accountApi) return null;
          try {
            return await this.accountApi.publicProfile(callsign);
          } catch {
            return null;
          }
        },
      });
    }
    return this.multiplayerPanel;
  }

  showMenuView(view: MenuView | null): void {
    const previousView = this.menuView;
    this.menuView = view;
    const menu = document.getElementById('menu-screen');
    if (!menu) return;
    // An idle deck shows its own panel; `dataset.view` keeps the CSS switch honest.
    menu.dataset.view = view ?? 'idle';
    // The deck is a stack of levels, not one long page: the top level chooses a
    // mode, Singleplayer opens its own list, and Skirmish and Campaign hand the
    // sidebar to their own options. Only one level is mounted at a time.
    const level =
      view === 'skirmish'
        ? 'skirmish'
        : view === 'singleplayer'
          ? 'singleplayer'
          : view === 'campaign'
            ? 'campaign'
            : view === 'account'
              ? 'account'
              : 'top';
    menu.dataset.level = level;
    menu.querySelectorAll<HTMLElement>('[data-menu-level]').forEach((entry) => {
      entry.hidden = entry.dataset.menuLevel !== level;
    });
    menu.querySelectorAll<HTMLButtonElement>('[data-menu-view]').forEach((btn) => {
      const target = btn.dataset.menuView;
      const active = target === view;
      btn.classList.toggle('on', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    if (view === 'settings') this.renderMenuSettings();
    // The account screen reads the session and career on entry, the same way
    // Settings rebuilds its rows: the deck may be opened long after sign-in.
    if (view === 'account') this.accountPanel?.show();
    if (view === 'multiplayer') this.ensureMultiplayerPanel()?.show();
    else this.multiplayerPanel?.hide();
    if (view === 'editor') this.refreshEditorAutosaveButton();
    // The board canvas has no size while the view is hidden; paint it on entry.
    if (view === 'skirmish') this.paintBriefMap();
    if (view === 'campaign') {
      // Rebuild the rail from progress every time the deck opens: a victory
      // recorded during the last battle must show its newly unlocked operation.
      this.renderCampaignMissions();
      this.applyCampaignUi();
      // Opening the campaign shows its own theatre behind the deck, not the
      // skirmish map the player happened to select last.
      if (previousView !== 'campaign') this.setMenuBackdrop(this.campaignScenario());
    }
  }

  /* ------------------------------------------------------------------ */
  /* Menu battlefield backdrop                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Show a live AI-vs-AI battle behind the menu. The deck is a window onto the
   * war room, not a static matte painting: both commanders fight under the same
   * rules as a skirmish, with a spectator camera that follows the action.
   */
  private startMenuBackdrop(): void {
    this.setMenuBackdrop(
      this.menuView === 'campaign' ? this.campaignScenario() : this.selectedScenario(),
    );
  }

  /** Swap the map behind the shell, used both on arrival and on selection. */
  private setMenuBackdrop(scenario: Scenario): void {
    const index = SCENARIOS.findIndex((entry) => entry.id === scenario.meta.id);
    this.attractIndex = index >= 0 ? index : 0;
    this.startAttractMatch(scenario);
    this.paintBriefMap();
  }

  /** Build and start a fresh bot battle on the given theatre. */
  private startAttractMatch(base: Scenario): void {
    this.stopAttract();
    // The ground behind the shell is a downlink: `.menu-mode` lets CSS tear it.
    this.setMenuMode(true);
    const scenario = cloneScenario(base);
    // The backdrop is a bot skirmish, not a campaign attempt: its mission tree
    // must not complete objectives or fire authored triggers behind the deck.
    delete scenario.mission;
    delete scenario.meta.campaign;
    // The backdrop cycles its own conditions: a short in-game day so the light
    // shifts during a cut, and a front that changes with each theatre.
    scenario.settings.startHour =
      ATTRACT_START_HOURS[this.attractIndex % ATTRACT_START_HOURS.length];
    scenario.settings.dayLengthMinutes = ATTRACT_DAY_MINUTES;
    scenario.settings.weather = ATTRACT_WEATHER[this.attractIndex % ATTRACT_WEATHER.length];
    const nations = playableNations();
    const friend = nations[this.attractIndex % nations.length];
    const enemy = nations[(this.attractIndex + 2) % nations.length];
    if (scenario.players[0]) {
      scenario.players[0].isAI = true;
      scenario.players[0].factionId = friend.id;
      scenario.players[0].name = `${friend.name} AI`;
      scenario.players[0].color = TEAM_COLORS[0].hex;
    }
    if (scenario.players[1]) {
      scenario.players[1].isAI = true;
      scenario.players[1].factionId = enemy.id;
      scenario.players[1].name = `${enemy.name} AI`;
      scenario.players[1].color = TEAM_COLORS[1].hex;
    }
    const seed = ((base.settings.seed ?? 1) ^ ((this.attractIndex + 1) * 0x9e3779b9)) >>> 0;
    const difficulties =
      this.attractIndex % 2 === 0
        ? (['veteran', 'elite'] as [AIDifficulty, AIDifficulty])
        : (['elite', 'veteran'] as [AIDifficulty, AIDifficulty]);
    this.attract = new MenuAttractMatch(scenario, { seed, difficulties });
    this.menuScenario = scenario;
    this.attractElapsed = 0;
    // The warm-up is spread over the first frames instead of blocking the
    // menu: the deck opens immediately and the battle catches up underneath it.
    this.attractWarmup = 900;
    this.renderer.setGame(this.attract.game);
    this.renderer.settings.grid = false;
    this.renderer.settings.showFog = false;
    this.renderer.camera.setScreenLift(0);
    this.renderer.camera.setZoom(26);
    this.attractFocus = this.chooseAttractFocus() ?? this.mapCenter(scenario);
    this.attractFocusTimer = 4;
    this.renderer.camera.centerOn(this.attractFocus.x, this.attractFocus.z);
  }

  /** Drop the menu battle before a loading screen, editor or real battle. */
  private stopAttract(): void {
    if (!this.attract) return;
    this.attract = null;
    this.attractElapsed = 0;
    this.attractFocusTimer = 0;
    this.attractWarmup = 0;
    this.renderer.setGame(null);
    this.renderer.setCommandFlag(null);
  }

  /** Spend a few milliseconds per frame bringing a new bot battle up to tempo. */
  private warmAttract(): void {
    if (!this.attract || this.attractWarmup <= 0) return;
    const deadline = performance.now() + 3.5;
    let steps = 0;
    while (this.attractWarmup > 0 && steps < 60 && performance.now() < deadline) {
      this.attract.stepOnce();
      this.attractWarmup--;
      steps++;
    }
  }

  private mapCenter(scenario: Scenario): { x: number; z: number } {
    return {
      x: (scenario.width * TILE_SIZE) / 2,
      z: (scenario.height * TILE_SIZE) / 2,
    };
  }

  /** Pick a point worth watching: recent fire, then the closest hostile pair. */
  private chooseAttractFocus(): { x: number; z: number } | null {
    const game = this.attract?.game;
    if (!game) return null;
    const events = game.state.events;
    for (let i = events.length - 1; i >= 0 && i >= events.length - 80; i--) {
      const ev = events[i];
      if (
        (ev.type === 'explosion' || ev.type === 'impact' || ev.type === 'shot') &&
        Number.isFinite(ev.x) &&
        Number.isFinite(ev.z) &&
        (ev.x !== 0 || ev.z !== 0)
      ) {
        return { x: ev.x, z: ev.z };
      }
    }
    const armed = game.state.entities.filter(
      (e) => e.kind === 'unit' && e.hp > 0 && (UNITS[e.defId]?.weapons.length ?? 0) > 0,
    );
    let best: { a: Entity; b: Entity; d: number } | null = null;
    for (const a of armed) {
      for (const b of armed) {
        if (a.owner === b.owner || !game.isHostile(a.owner, b.owner)) continue;
        const d = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (best) return { x: (best.a.x + best.b.x) / 2, z: (best.a.z + best.b.z) / 2 };
    const hqs = game.state.entities.filter(
      (e) => e.kind === 'building' && e.hp > 0 && BUILDINGS[e.defId]?.commandPost,
    );
    if (hqs.length > 0) {
      return {
        x: hqs.reduce((sum, e) => sum + e.x, 0) / hqs.length,
        z: hqs.reduce((sum, e) => sum + e.z, 0) / hqs.length,
      };
    }
    return null;
  }

  /** Advance the bot battle and keep the spectator camera on the action. */
  private updateAttract(dt: number): void {
    if (!this.attract) {
      this.startMenuBackdrop();
      return;
    }
    this.attractElapsed += dt;
    if (this.attractElapsed >= ATTRACT_MATCH_SECONDS) {
      this.attractIndex = (this.attractIndex + 1) % SCENARIOS.length;
      this.startAttractMatch(this.scenarioFor(SCENARIOS[this.attractIndex].id));
      // The next theatre arrives as a signal cut, not a jump cut: the same tear
      // the menu uses for a view change sells the new downlink.
      this.glitchSwitch();
      return;
    }
    this.warmAttract();
    this.attract.update(dt);
    this.attractFocusTimer -= dt;
    if (this.attractFocusTimer <= 0) {
      this.attractFocus = this.chooseAttractFocus() ?? this.attractFocus;
      this.attractFocusTimer = 5;
    }
    const camera = this.renderer.camera;
    const follow = 1 - Math.exp(-Math.max(0, dt) * 1.8);
    camera.centerOn(
      camera.cx + (this.attractFocus.x - camera.cx) * follow,
      camera.cz + (this.attractFocus.z - camera.cz) * follow,
    );
    this.renderer.update(dt);
  }

  /**
   * The mission brief shows the real island, not a sketch: the same scenario
   * that the battlefield is built from, rasterised, with the callouts pinned to
   * the two command posts.
   */
  private paintBriefMap(): void {
    const canvas = document.getElementById('brief-map-canvas') as HTMLCanvasElement | null;
    // The brief always describes the player's selected theatre, even while the
    // attract battle behind the deck has already cut to a different map.
    const scenario = this.selectedScenario();
    if (!canvas || !scenario) return;
    const rect = drawBriefMap(canvas, scenario);
    // The panel is sized by the stylesheet, so repaint whenever its box moves
    // (window resize, responsive column) instead of stretching one raster.
    if (!this.briefObserver && 'ResizeObserver' in window) {
      this.briefObserver = new ResizeObserver(() => this.paintBriefMap());
      this.briefObserver.observe(canvas);
    }
    if (!rect) return;
    for (const label of briefMapLabels(scenario)) {
      const el = document.getElementById(
        label.side === 'friend' ? 'brief-label-friend' : 'brief-label-enemy',
      );
      if (!el) continue;
      const at = briefLabelPosition(rect, label);
      el.style.left = `${at.left.toFixed(2)}%`;
      el.style.top = `${at.top.toFixed(2)}%`;
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
    const select = document.getElementById('difficulty') as HTMLSelectElement | null;
    if (select) {
      select.value = this.settings.difficulty;
      // The explanatory sentence now rides on the control itself.
      select.title = DIFFICULTY_COPY[this.settings.difficulty];
    }
  }

  /** Time-of-day picker: four authored starts, each with its own light. */
  private applyTimeOfDayUi(): void {
    const start = Math.round(this.settings.startHour);
    document.querySelectorAll<HTMLButtonElement>('[data-start-time]').forEach((btn) => {
      const on = Number(btn.dataset.startTime) === start;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      const phase = phaseForStartHour(Number(btn.dataset.startTime));
      btn.title = `${phase.charAt(0).toUpperCase()}${phase.slice(1)} start`;
    });
  }

  /** Two buttons, one match rule: enabled by default, remembered per player. */
  private applySuperweaponUi(): void {
    const on = this.settings.superweapons !== false;
    document.querySelectorAll<HTMLButtonElement>('[data-superweapons]').forEach((btn) => {
      const selected = (btn.dataset.superweapons === 'on') === on;
      btn.classList.toggle('on', selected);
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  /**
   * Weather picker: one button per authored profile.
   *
   * The catalogue is the single source of truth, so a weather kind added to the
   * simulation appears here (and in the forge) without a second list to keep in
   * step. Weather is fought on, not merely seen, so the note spells out what the
   * choice does rather than describing the sky.
   */
  private buildWeatherSelector(): void {
    const host = document.getElementById('weather-options');
    if (!host) return;
    host.innerHTML = '';
    for (const kind of WEATHER_KINDS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'difficulty-btn';
      btn.dataset.weather = kind;
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = WEATHER[kind].label.toUpperCase();
      btn.addEventListener('click', () => {
        this.audio.init();
        this.audio.play('ui');
        this.settings.weather = kind;
        this.saveSettings();
        this.applyWeatherUi();
        this.applyMapUi();
        // The menu backdrop is the selected theatre in the selected weather, so
        // the choice is visible before a single unit lands.
        this.setMenuBackdrop(this.selectedScenario());
      });
      host.appendChild(btn);
    }
  }

  private applyWeatherUi(): void {
    const profile = weatherFor(this.settings.weather);
    document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((btn) => {
      const on = btn.dataset.weather === profile.kind;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      // The hint that used to sit under the picker is now the button's tooltip,
      // so the choice still explains itself without spending a rail row.
      btn.title = `${WEATHER[btn.dataset.weather as WeatherKind].label} — ${WEATHER[btn.dataset.weather as WeatherKind].hint}`;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Theatre selection                                                   */
  /* ------------------------------------------------------------------ */

  /** Built-in maps are generated once and shared by the shell and the thumbnails. */
  private scenarioFor(id: string): Scenario {
    const cached = this.mapCache.get(id);
    if (cached) return cached;
    const entry = scenarioById(id) ?? scenarioById(defaultScenarioId('skirmish'))!;
    const scenario = entry.create();
    this.mapCache.set(entry.id, scenario);
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
    const theirs = resolveOpponentNation(mine.id, this.settings.opponentNationId);
    // The map's callsigns belong to its legacy presets ("Baltic Task Force"),
    // so a nation deployment also stamps a formation name it actually owns.
    if (scenario.players[0]) {
      scenario.players[0].factionId = mine.id;
      scenario.players[0].name = `${mine.name} Task Force`;
      scenario.players[0].color = this.settings.teamColor;
    }
    if (scenario.players[1]) {
      scenario.players[1].factionId = theirs.id;
      scenario.players[1].name = `${theirs.name} Task Force`;
      scenario.players[1].color = this.settings.opponentColor;
      // The opponent's doctrine is a chosen identity, not a per-battle dice
      // roll: with a commander the seed only varies the opening, exactly as an
      // authored scenario with a commander does.
      const commander = commandersForNation(theirs.id).find(
        (c) => c.id === this.settings.opponentCommanderId,
      );
      scenario.players[1].commanderId = commander?.id;
    }
    // A skirmish starts at the time the player chose; the authored phase label
    // stays as the map's own default for campaign missions and multiplayer.
    scenario.settings.startHour = normaliseStartHour(this.settings.startHour);
    scenario.settings.dayLengthMinutes = normaliseDayLength(this.settings.dayLengthMinutes);
    scenario.settings.timeOfDay = phaseForStartHour(scenario.settings.startHour);
    // Weather stacks with the clock rather than replacing it: the same dusk in
    // fog is a different battle from the same dusk in a storm.
    scenario.settings.weather = this.settings.weather;
    // Strategic superweapons are a match rule, not a per-side advantage: both
    // commanders read the same setting, and a match that turns them off keeps
    // every other research and construction path exactly as it was.
    scenario.settings.superweapons = this.settings.superweapons !== false;
    return scenario;
  }

  /** Nation picker: one flag row per playable nation, grouped by alliance. */
  private buildNationSelector(): void {
    const host = document.getElementById('nation-select');
    if (!host) return;
    this.nationPicker = new NationPicker(host, (id) => {
      if (!PLAYABLE_NATION_IDS.includes(id)) return;
      this.audio.init();
      this.audio.play('ui');
      this.settings.nationId = id;
      this.saveSettings();
      this.applyNationUi();
    });
    this.applyNationUi();
  }

  /**
   * Opponent picker: every playable nation. Setup is free-choice, so the same
   * flag can stand on both sides; the list does not follow the commander's
   * alliance.
   */
  private buildOpponentSelector(): void {
    const host = document.getElementById('opponent-select');
    if (!host) return;
    this.opponentPicker = new NationPicker(host, (id) => {
      if (!PLAYABLE_NATION_IDS.includes(id)) return;
      this.audio.init();
      this.audio.play('ui');
      this.settings.opponentNationId = id;
      this.saveSettings();
      this.applyNationUi();
    });
    this.applyNationUi();
  }

  /**
   * The opponent's commander is picked from that nation's own generals, so the
   * list follows the opposing banner rather than the player's. The empty value
   * is the seeded profile every earlier build used, kept as a visible choice
   * instead of an implicit one.
   */
  private buildCommanderSelector(): void {
    const select = document.getElementById('opponent-commander') as HTMLSelectElement | null;
    if (!select) return;
    select.addEventListener('change', () => {
      this.audio.init();
      this.audio.play('ui');
      this.settings.opponentCommanderId = select.value;
      this.saveSettings();
      this.applyCommanderUi();
    });
    this.applyCommanderUi();
  }

  private applyCommanderUi(): void {
    const select = document.getElementById('opponent-commander') as HTMLSelectElement | null;
    if (!select) return;
    const opponent = resolveOpponentNation(this.settings.nationId, this.settings.opponentNationId);
    const list = commandersForNation(opponent.id);
    const chosen = list.find((c) => c.id === this.settings.opponentCommanderId);
    // A nation change can retire the previous pick; the selection is corrected
    // in settings as well as in the control, so deployment cannot carry a
    // commander the opposing nation does not field.
    if (!chosen && this.settings.opponentCommanderId) {
      this.settings.opponentCommanderId = '';
      this.saveSettings();
    }
    select.innerHTML = [
      '<option value="">Seeded (no commander)</option>',
      ...list.map(
        (c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} · ${escapeHtml(c.callsign)}</option>`,
      ),
    ].join('');
    select.value = chosen?.id ?? '';
    select.title = chosen
      ? `${chosen.name} (${chosen.callsign}) — ${chosen.primaryDoctrine}, ${chosen.secondaryDoctrine}`
      : 'A fresh seeded opponent each battle: the pre-commander behaviour';
  }

  /**
   * Team colours are a skirmish choice, not a faction property: the trim masks
   * on units and buildings, the building flags and the brief markers all read
   * the two swatches. Authored maps and campaign scenarios carry no override,
   * so they keep the blue/red faction colours.
   */
  private buildTeamColors(): void {
    this.populateColorSelect('team-color', 'teamColor');
    this.populateColorSelect('opponent-color', 'opponentColor');
    this.applyTeamColorUi();
  }

  /**
   * Colours are a dropdown so the two nation cards stay one line each. The
   * swatch beside the select carries the colour itself; the option text names
   * it, which is what a native select can express.
   */
  private populateColorSelect(id: string, key: 'teamColor' | 'opponentColor'): void {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = TEAM_COLORS.map(
      (colour) => `<option value="${colour.hex}">${colour.name}</option>`,
    ).join('');
    select.addEventListener('change', () => {
      this.audio.init();
      this.audio.play('ui');
      this.settings[key] = select.value;
      this.saveSettings();
      this.applyTeamColorUi();
    });
  }

  private applyTeamColorUi(): void {
    const mark = (selectId: string, dotId: string, value: string) => {
      const select = document.getElementById(selectId) as HTMLSelectElement | null;
      if (select) select.value = value;
      const dot = document.getElementById(dotId);
      if (dot) dot.style.background = value;
    };
    mark('team-color', 'team-color-dot', this.settings.teamColor);
    mark('opponent-color', 'opponent-color-dot', this.settings.opponentColor);
    // The mission brief uses the same two colours for its side markers, so the
    // setup reads as one consistent pair before deployment.
    const friend = document.getElementById('brief-label-friend');
    const enemy = document.getElementById('brief-label-enemy');
    if (friend) {
      friend.style.color = this.settings.teamColor;
      friend.style.setProperty('--marker', this.settings.teamColor);
    }
    if (enemy) {
      enemy.style.color = this.settings.opponentColor;
      enemy.style.setProperty('--marker', this.settings.opponentColor);
    }
  }

  /**
   * Every surface that names the two sides reads the same registry records: the
   * picker note, the mission brief and (through the stamped scenario) the
   * loading screen and HUD.
   */
  private applyNationUi(): void {
    const identity = identityDef(this.settings.nationId);
    const alliance = identityAlliance(identity.id);
    const opponent = resolveOpponentNation(identity.id, this.settings.opponentNationId);
    // Both pickers offer every playable nation with its flag; setup is
    // free-choice, so the opponent list does not follow the player's alliance.
    const entries = playableNations().map((nation) => ({
      id: nation.id,
      name: nation.name,
      group: identityAlliance(nation.id).name,
    }));
    this.nationPicker?.setOptions(entries, identity.id);
    this.opponentPicker?.setOptions(entries, opponent.id);
    const text = (id: string, value: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    text('brief-command', identity.name);
    text('brief-formation', identity.legacy ? 'Alliance task force' : `${identity.name} Task Force`);
    text('brief-doctrine', identity.doctrine ?? 'Alliance task force');
    text('brief-opposition', opponent.name);
    text('brief-alliance', alliance.name);
    text('brief-label-friend', identity.shortName || identity.name);
    text('brief-label-enemy', opponent.shortName || opponent.name);
    this.applyCommanderUi();
  }

  private buildMapSelector(): void {
    const root = document.getElementById('map-cards');
    if (!root) return;
    root.innerHTML = '';
    // The selector shows exactly what the catalogue makes available for
    // skirmish. It does not decide availability, size or player count itself.
    for (const entry of scenariosForMode('skirmish')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-card';
      btn.dataset.mapId = entry.id;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      // One line per battlefield, like a mission list: the name reads first and
      // the authored footprint sits right-aligned. The raster moved to the
      // large preview beside it, where it is actually legible.
      btn.title = `${entry.focus} · ${entry.width}×${entry.height} · ${entry.tags.join(' · ')}`;
      btn.innerHTML = `
        <span class="map-card-name">${escapeHtml(entry.name)}</span>
        <span class="map-card-size">${entry.targetSize}</span>`;
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
  }

  /** The head, the brief and the selector all describe the selected theatre. */
  private applyMapUi(): void {
    const entry = scenarioById(this.settings.mapId) ?? scenarioById(defaultScenarioId('skirmish'))!;
    const scenario = this.selectedScenario();
    const index = Math.max(0, scenariosForMode('skirmish').findIndex((s) => s.id === entry.id));
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
    text('brief-tags', entry.tags.join(' · '));
    text('brief-players', `${entry.playerCounts.join(' or ')} commanders`);
    const weather = weatherFor(this.settings.weather);
    text('brief-weather', weather.label);
    const weatherRow = document.getElementById('brief-weather');
    if (weatherRow) weatherRow.title = weather.hint;
    const canvas = document.getElementById('brief-map-canvas');
    canvas?.setAttribute('aria-label', `${entry.name} terrain map`);
    // Command, formation and the map's side labels are nation-driven; see
    // applyNationUi, which runs after this pass.
    this.paintBriefMap();
  }

  /* ------------------------------------------------------------------ */
  /* Campaign                                                            */
  /* ------------------------------------------------------------------ */

  private campaignDef(): CampaignDef {
    return campaignById(this.campaignId);
  }

  private campaignMission(): CampaignMission {
    return missionById(this.campaignDef(), this.campaignMissionId);
  }

  /** Restore the deck exactly where the player left it, when still legal. */
  private restoreCampaignSelection(): void {
    const selection = this.campaignSave.lastSelection;
    const selectedCampaign = selection
      ? CAMPAIGNS.find((campaign) => campaign.id === selection.campaignId)
      : undefined;
    if (selectedCampaign) this.campaignId = selectedCampaign.id;
    const campaign = selectedCampaign ?? this.campaignDef();
    const state = this.campaignSave.runs[campaign.id];
    if (state) {
      // An authoritative run decides what is next; the stored selection is only
      // the deck's memory of which campaign was open.
      this.campaignMissionId = state.currentMissionId;
      this.campaignProgress = campaignProgressOf(state, campaign);
      return;
    }
    const mission = selection
      ? campaign.missions.find((entry) => entry.id === selection.missionId)
      : undefined;
    if (mission && isMissionUnlocked(this.campaignProgress, campaign, mission.id)) {
      this.campaignMissionId = mission.id;
      return;
    }
    this.campaignMissionId = resumeMissionId(this.campaignProgress, campaign);
  }

  /** The authoritative run for the campaign open in the deck, if it has begun. */
  private campaignState(): CampaignState | null {
    return this.campaignSave.runs[this.campaignId] ?? null;
  }

  /** Store a transition and refresh the deck's derived view of it. */
  private setCampaignState(state: CampaignState): void {
    this.campaignSave = {
      ...this.campaignSave,
      runs: { ...this.campaignSave.runs, [state.campaignId]: state },
    };
    this.campaignProgress = campaignProgressOf(state, campaignById(state.campaignId));
    this.campaignMissionId = state.currentMissionId;
    this.persistCampaignSelection();
  }

  /** Write the current deck selection; progression is owned by the run state. */
  private persistCampaignSelection(): void {
    const campaign = this.campaignDef();
    if (!campaign.missions.some((mission) => mission.id === this.campaignMissionId)) return;
    this.campaignSave = {
      ...this.campaignSave,
      lastSelection: { campaignId: this.campaignId, missionId: this.campaignMissionId },
    };
    this.saveCampaignSave();
  }

  /**
   * Read the campaign save, migrating the pre-S4 cleared set once.
   *
   * The old deck only knew which operations were cleared, so those become
   * accepted legacy records. No objective outcome or veteran loss is invented.
   */
  private loadCampaignSave(): CampaignSaveDoc {
    try {
      const raw = localStorage.getItem(CAMPAIGN_SAVE_KEY);
      if (raw) return parseCampaignSave(JSON.parse(raw), CAMPAIGNS);
      const legacy = localStorage.getItem(CAMPAIGN_PROGRESS_KEY);
      if (!legacy) return emptyCampaignSave();
      const migrated = migrateLegacyCampaignProgress(
        parseCampaignProgress(JSON.parse(legacy)),
        CAMPAIGNS,
      );
      localStorage.setItem(CAMPAIGN_SAVE_KEY, serializeCampaignSave(migrated));
      return migrated;
    } catch {
      // Private browsing or malformed storage must not stop the menu opening;
      // the run still progresses in memory for this session.
      return emptyCampaignSave();
    }
  }

  private saveCampaignSave(): void {
    try {
      localStorage.setItem(CAMPAIGN_SAVE_KEY, serializeCampaignSave(this.campaignSave));
    } catch {
      /* Progress remains available in memory. */
    }
  }

  /** The campaign operation currently on the battlefield, if this is one. */
  campaignRun(): CampaignRun | null {
    const ref = this.game?.state.scenario.meta.campaign;
    if (!ref) return null;
    const campaign = CAMPAIGNS.find((entry) => entry.id === ref.campaignId);
    if (!campaign) return null;
    const index = campaign.missions.findIndex((mission) => mission.id === ref.missionId);
    if (index < 0) return null;
    return {
      campaign,
      mission: campaign.missions[index],
      index,
      next: campaign.missions[index + 1] ?? null,
    };
  }

  /**
   * What the end screen may offer for a campaign operation.
   *
   * Progression is never advanced by the fact that a battle ended: the card
   * offers accept or retry, and only acceptance changes the campaign.
   */
  campaignDebrief(): CampaignDebriefInfo | null {
    const run = this.campaignRun();
    if (!run) return null;
    const state = this.campaignState();
    // A loaded battle can belong to an operation the campaign has already moved
    // past. Such a save is a skirmish over old ground, not a campaign attempt,
    // so it gets no accept or retry controls.
    if (!state || state.currentMissionId !== run.mission.id) return null;
    return {
      missionName: run.mission.name,
      nextMissionName: run.next?.name ?? null,
      campaignComplete: state.phase === 'complete',
      finalOperation: run.next === null,
      awaitingAcceptance: state.phase === 'debrief' && Boolean(state.pending),
    };
  }

  /**
   * The campaign operation as a real scenario.
   *
   * The theatre is a copy of the named built-in map, but the mission document,
   * command posts and any deployed veterans are authored into it here. The
   * result is parsed again, so the mission's entity references are checked
   * against the placements the builder actually created.
   */
  private campaignScenario(): Scenario {
    const campaign = this.campaignDef();
    const mission = this.campaignMission();
    const state = this.campaignState();
    const deployments = campaignScenarioDeployments(state, campaign, mission);
    const cacheKey = `${campaign.id}:${mission.id}:${deployments
      .map((entry) => `${entry.key}=${entry.veteranId}`)
      .join(',')}`;
    const cached = this.campaignCache;
    if (cached && cached.key === cacheKey) return cached.scenario;

    try {
      const parsed = buildCampaignScenario({
        def: campaign,
        mission,
        state,
        base: this.scenarioFor(mission.mapId),
      });
      this.campaignCache = { key: cacheKey, scenario: parsed };
      return parsed;
    } catch (error) {
      // The deck preview must still open if an operation cannot be assembled;
      // deployment runs the same builder again and reports the failure there
      // instead of silently fighting a plain skirmish.
      const fallback = cloneScenario(this.scenarioFor(mission.mapId));
      this.campaignCache = { key: cacheKey, scenario: fallback };
      if (this.menuView === 'campaign') {
        const message = error instanceof Error ? error.message : String(error);
        this.notify(message, 'warning');
      }
      return fallback;
    }
  }

  /** Read the commander form, reporting the first problem instead of guessing. */
  private readCommanderIdentity(): CommanderIdentity | null {
    const value = (id: string) =>
      (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
    const pronounsRaw = (document.getElementById('campaign-commander-pronouns') as
      | HTMLSelectElement
      | null)?.value;
    const pronouns = pronounsRaw ? (pronounsRaw as CommanderPronouns) : undefined;
    try {
      return normaliseCommanderIdentity({
        name: value('campaign-commander-name'),
        callsign: value('campaign-commander-callsign'),
        background: value('campaign-commander-background'),
        ...(pronouns ? { pronouns } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(message, 'warning');
      this.audio.play('denied');
      return null;
    }
  }

  /**
   * Open the operation: start the campaign if needed, snapshot it, then deploy.
   *
   * The campaign snapshot is taken before the scenario is built so retrying
   * restores the roster and variables exactly as they were at launch.
   */
  private deployCampaignMission(): void {
    const def = this.campaignDef();
    const errors = validateCampaignDefinition(def, {
      knownMapIds: new Set(SCENARIOS.map((entry) => entry.id)),
    }).filter((entry) => entry.severity === 'error');
    if (errors.length > 0) {
      this.notify(`Campaign is not deployable: ${errors[0].message}`, 'critical');
      this.audio.play('denied');
      return;
    }
    let state = this.campaignState();
    if (state?.phase === 'debrief') {
      this.openCampaignResult();
      return;
    }
    const identity = this.readCommanderIdentity();
    if (!identity) return;
    if (!state) {
      try {
        state = createCampaignState(def, identity);
      } catch (error) {
        this.notify(error instanceof Error ? error.message : String(error), 'warning');
        return;
      }
    } else {
      state = { ...state, commander: identity };
    }
    const stateIssues = validateCampaignState(state, def).filter(
      (issue) => issue.severity === 'error',
    );
    if (stateIssues.length > 0) {
      this.notify(`Campaign cannot continue: ${stateIssues[0].message}`, 'critical');
      this.audio.play('denied');
      return;
    }
    try {
      // A run left in the playing phase has no live battle behind it (the deck
      // was reopened), so deployment restarts from its own snapshot.
      if (state.phase === 'playing') state = retryCampaignMission(state);
      const launched = launchCampaignMission(state, def, state.currentMissionId);
      this.setCampaignState(launched);
      this.campaignCache = null;
      const scenario = this.campaignScenario();
      if (scenario.mission?.id !== launched.currentMissionId) {
        // Roll the launch back so the deck is not left in a phantom battle.
        this.setCampaignState(retryCampaignMission(launched));
        throw new CampaignStateError(
          'definition-mismatch',
          `Operation "${launched.currentMissionId}" could not be assembled on its theatre.`,
        );
      }
      void this.startBattle(scenario);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(`Unable to deploy: ${message}`, 'critical');
      this.audio.play('denied');
    }
  }

  /** Review a result that survived a reload before the player accepted it. */
  private openCampaignResult(): void {
    const state = this.campaignState();
    if (!state?.pending) return;
    const mission = this.campaignMission();
    const result = state.pending.result;
    const flown = parseFlagComposition(state.pending.flag);
    openModal({
      title: `${mission.name} — ${result.outcome === 'victory' ? 'Victory' : 'Defeat'}`,
      wide: true,
      body: missionDebriefMarkup(result, {
        mission: mission.mission,
        outlook: campaignResultOutlook(state, this.campaignDef()),
        flag: flown.ok ? flown.composition : null,
      }),
      actions: [
        {
          label: 'Accept and continue',
          primary: true,
          onClick: () => this.acceptCampaignResultAction(),
        },
        { label: 'Retry operation', onClick: () => this.retryCampaignOperation() },
        { label: 'Cancel' },
      ],
    });
  }

  /** Accept the pending result: the only transaction that advances a campaign. */
  acceptCampaignResultAction(): void {
    const run = this.campaignRun();
    const state = this.campaignState();
    const campaign = run?.campaign ?? this.campaignDef();
    if (!state) return;
    // Capture the operation being accepted: after acceptance the campaign's
    // current mission already points at the next briefing.
    const acceptedMission = missionById(campaign, state.currentMissionId);
    const pending = state.pending;
    try {
      const accepted = acceptCampaignResult(state, campaign);
      this.setCampaignState(accepted);
      this.campaignCache = null;
      // Acceptance is what makes the operation part of the career. The reference
      // names the campaign and operation, so a second acceptance can never pay
      // twice even if a retry replays this flow.
      if (pending) this.recordCampaignCareer(campaign.id, pending);
      this.audio.play('complete');
      if (accepted.phase === 'complete') {
        this.notify('Campaign complete. Every operation has been accepted.', 'success');
      } else {
        this.notify(`Operation accepted. ${this.campaignMission().name} is next.`, 'success');
      }
      this.toMenu();
      this.showMenuView('campaign');
      this.renderCampaignMissions();
      this.applyCampaignUi();
      this.setMenuBackdrop(this.campaignScenario());
      // The intermission or ending scene frames the campaign, not the battle.
      // The result is already committed before playback starts, so a skipped or
      // failed scene cannot lose progression.
      const context: MissionCinematicContext =
        accepted.phase === 'complete' ? 'ending' : 'intermission';
      const sequence = acceptedMission.mission.cinematics.find(
        (entry) => entry.kind === context,
      );
      if (sequence) {
        this.playCinematic(
          sequence,
          context,
          accepted.phase === 'complete' ? 'CAMPAIGN COMPLETE' : 'OPERATION ACCEPTED',
          accepted.phase === 'complete' ? campaign.name : acceptedMission.name,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(`Could not accept the result: ${message}`, 'critical');
    }
  }

  /** Replay the operation from the snapshot taken before it launched. */
  retryCampaignOperation(): void {
    const state = this.campaignState();
    if (!state) return;
    try {
      const retried = retryCampaignMission(state);
      this.setCampaignState(retried);
      this.campaignCache = null;
      void this.startBattle(this.campaignScenario());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(`Could not restart the operation: ${message}`, 'critical');
    }
  }

  /** Record the captured result without touching persistent progress. */
  private captureCampaignResult(run: CampaignRun, missionResult: MissionResult): void {
    const state = this.campaignState();
    if (!state || state.phase !== 'playing') return;
    try {
      const submitted = submitCampaignResult(
        state,
        run.campaign,
        run.mission.id,
        missionResult,
        this.game ? this.matchFlagSnapshot(this.game) : null,
      );
      this.setCampaignState(submitted);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof CampaignStateError) || error.code !== 'phase-mismatch') {
        this.notify(`Campaign result not recorded: ${message}`, 'warning');
      }
    }
  }

  private buildCampaignScreen(): void {
    const switchHost = document.getElementById('campaign-switch');
    if (switchHost) {
      switchHost.innerHTML = CAMPAIGNS.map(
        (campaign) => `
          <button type="button" class="campaign-switch-btn" data-campaign="${campaign.id}" aria-pressed="false" style="--side:${campaign.accent}">
            <i class="campaign-side-mark" aria-hidden="true"></i>
            <span><b>${escapeHtml(campaign.name)}</b><small>${escapeHtml(campaign.coalition)}</small></span>
          </button>`,
      ).join('');
      switchHost.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-campaign]');
        const id = button?.dataset.campaign;
        if (!id) return;
        this.audio.init();
        this.audio.play('ui');
        this.selectCampaign(id);
      });
    }
    this.renderCampaignMissions();
  }

  /** The rail is the operation list; the stage is the mission dossier and brief. */
  private renderCampaignMissions(): void {
    const host = document.getElementById('campaign-missions');
    if (!host) return;
    const campaign = this.campaignDef();
    if (!isMissionUnlocked(this.campaignProgress, campaign, this.campaignMissionId)) {
      this.campaignMissionId = resumeMissionId(this.campaignProgress, campaign);
    }
    host.innerHTML = campaign.missions
      .map((mission, index) => {
        const cleared = isMissionCleared(this.campaignProgress, campaign.id, mission.id);
        const locked = !isMissionUnlocked(this.campaignProgress, campaign, mission.id);
        // An operation is a locked gate until the one before it is cleared.
        const previous = campaign.missions[index - 1];
        const title = locked
          ? `Accept ${previous?.name ?? 'the previous operation'} to unlock this operation.`
          : cleared
            ? `${mission.name} has been accepted. Replay the battle from Skirmish.`
            : mission.situation;
        const marker = locked
          ? '<span class="menu-nav-badge campaign-lock">LOCKED</span>'
          : cleared
            ? '<span class="menu-nav-badge campaign-cleared">CLEARED</span>'
            : '<span class="menu-nav-go" aria-hidden="true">›</span>';
        // A completed operation is a record, not a launch target: the campaign
        // has one next operation, and accepting a replay would duplicate
        // consequences. Skirmish remains the place to fight any map again.
        const inactive = locked || cleared;
        return `
          <button type="button" class="menu-nav-item campaign-mission${locked ? ' locked' : ''}${cleared ? ' cleared' : ''}" data-campaign-mission="${mission.id}" aria-pressed="false" ${inactive ? 'disabled aria-disabled="true"' : ''} title="${escapeHtml(title)}">
            <span class="menu-nav-index">${String(index + 1).padStart(2, '0')}</span>
            <span class="menu-nav-text"><b>${escapeHtml(mission.name)}</b><small>${escapeHtml(mission.focus)}</small></span>
            ${marker}
          </button>`;
      })
      .join('');
    host.querySelectorAll<HTMLButtonElement>('[data-campaign-mission]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.campaignMission;
        if (!id) return;
        this.audio.init();
        this.audio.play('ui');
        this.selectCampaignMission(id);
      });
    });
  }

  private selectCampaign(id: string): void {
    const campaign = campaignById(id);
    if (campaign.id === this.campaignId) {
      this.persistCampaignSelection();
      return;
    }
    this.campaignId = campaign.id;
    // A returning commander lands on the operation the run says is next; an
    // unstarted campaign opens on its first operation.
    const state = this.campaignState();
    this.campaignMissionId = state
      ? state.currentMissionId
      : resumeMissionId(this.campaignProgress, campaign);
    this.campaignProgress = state
      ? campaignProgressOf(state, campaign)
      : emptyCampaignProgress();
    this.campaignCache = null;
    this.persistCampaignSelection();
    this.renderCampaignMissions();
    this.applyCampaignUi();
    this.setMenuBackdrop(this.campaignScenario());
    this.glitchSwitch();
  }

  private selectCampaignMission(id: string): void {
    const campaign = this.campaignDef();
    if (!campaign.missions.some((mission) => mission.id === id)) return;
    if (!isMissionUnlocked(this.campaignProgress, campaign, id)) {
      this.audio.play('denied');
      this.notify('That operation is locked. Accept the previous operation first.', 'warning');
      return;
    }
    if (isMissionCleared(this.campaignProgress, campaign.id, id)) {
      this.audio.play('denied');
      this.notify('That operation has been accepted. Replay the battle from Skirmish.', 'info');
      return;
    }
    if (id === this.campaignMissionId) {
      this.persistCampaignSelection();
      return;
    }
    const previousMap = this.campaignMission().mapId;
    this.campaignMissionId = id;
    this.campaignCache = null;
    this.persistCampaignSelection();
    this.applyCampaignUi();
    // The deck's window onto the war should show the theatre being briefed.
    if (this.campaignMission().mapId !== previousMap) this.setMenuBackdrop(this.campaignScenario());
    this.glitchSwitch();
  }

  /** Every campaign surface reads the selected operation, never the skirmish form. */
  private applyCampaignUi(): void {
    const campaign = this.campaignDef();
    const mission = this.campaignMission();
    const scenario = this.campaignScenario();
    const entry = scenarioById(mission.mapId) ?? scenarioById(defaultScenarioId('campaign'))!;
    const command = identityDef(mission.playerNationId);
    const opposition = identityDef(mission.opponentNationId);
    const alliance = identityAlliance(command.id);
    const enemyAlliance = identityAlliance(opposition.id);
    const text = (id: string, value: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    document.querySelectorAll<HTMLElement>('[data-campaign]').forEach((button) => {
      const active = button.dataset.campaign === campaign.id;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll<HTMLElement>('[data-campaign-mission]').forEach((button) => {
      const active = button.dataset.campaignMission === mission.id;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const cleared = clearedMissionCount(this.campaignProgress, campaign);
    const state = this.campaignState();
    const phaseNote =
      state?.phase === 'debrief'
        ? ' · result awaiting acceptance'
        : state?.phase === 'complete'
          ? ' · campaign complete'
          : '';
    text('campaign-eyebrow', `CAMPAIGN · ${campaign.coalition.toUpperCase()}`);
    text('campaign-title', campaign.name);
    text('campaign-lede', campaign.lede);
    text(
      'campaign-note',
      `${campaign.note} · ${cleared}/${campaign.missions.length} operations accepted${phaseNote}`,
    );
    text('campaign-code', mission.code);
    text('campaign-map-code', mission.code);
    const commander = state?.commander ?? null;
    const briefing = scenario.mission?.briefing;
    const briefingCopy = (value: string) => briefingText(value, commander);
    text('campaign-situation', briefing ? briefingCopy(briefing.summary) : mission.situation);
    const contextLine = document.getElementById('campaign-context');
    if (contextLine) {
      const value = briefing?.context ? briefingCopy(briefing.context) : '';
      contextLine.textContent = value;
      contextLine.classList.toggle('hidden', value.length === 0);
    }
    const commanderLine = document.getElementById('campaign-commander-line');
    if (commanderLine) {
      commanderLine.innerHTML = commander
        ? `COMMANDER <b>${escapeHtml(commander.name)}</b> · ${escapeHtml(commander.callsign)}`
        : 'COMMANDER <b>NOT SET</b> · ENTER A PROFILE TO DEPLOY';
    }
    const friendlyLine = document.getElementById('campaign-friendly');
    if (friendlyLine) {
      friendlyLine.textContent = briefing
        ? briefingCopy(briefing.friendly)
        : `${command.name} task force holding the western approach.`;
    }
    const personnelList = document.getElementById('campaign-personnel');
    if (personnelList) {
      const names = briefing?.personnel ?? [];
      personnelList.innerHTML = names
        .map((name) => `<li>${escapeHtml(briefingCopy(name))}</li>`)
        .join('');
      personnelList.parentElement?.classList.toggle('hidden', names.length === 0);
    }
    const intentLine = document.getElementById('campaign-enemy-intent');
    if (intentLine) {
      intentLine.textContent = briefing?.enemyIntent
        ? briefingCopy(briefing.enemyIntent)
        : mission.threat;
    }
    const instructionList = document.getElementById('campaign-instructions');
    if (instructionList) {
      const instructions = briefing?.instructions ?? [];
      instructionList.innerHTML = instructions
        .map((line) => `<li>${escapeHtml(briefingCopy(line))}</li>`)
        .join('');
      instructionList.parentElement?.classList.toggle('hidden', instructions.length === 0);
    }
    const noteLine = document.getElementById('campaign-commander-note');
    if (noteLine) {
      // A commander note addresses the player by callsign; until a profile
      // exists it would render raw tokens, so it waits for identity.
      const note =
        briefing?.commanderNote && commander ? briefingCopy(briefing.commanderNote) : '';
      noteLine.textContent = note;
      noteLine.classList.toggle('hidden', note.length === 0);
    }
    text('campaign-command', command.name);
    text('campaign-opposition', opposition.name);
    text('campaign-alliance', alliance.name);
    text('campaign-size', `${scenario.width} × ${scenario.height} tiles`);
    text('campaign-domains', entry.domains);
    text('campaign-threat', mission.threat);
    text(
      'campaign-deploy-label',
      state?.phase === 'debrief'
        ? 'Review operation result'
        : state?.phase === 'complete'
          ? 'Campaign complete'
          : state?.phase === 'playing'
            ? `Resume ${mission.name}`
            : mission.name,
    );
    const deploy = document.getElementById('btn-campaign-deploy') as HTMLButtonElement | null;
    if (deploy) deploy.disabled = state?.phase === 'complete';

    // The mission document is the authoritative objective tree; the map's
    // legacy objective strings remain the fallback for an operation without one.
    const objectives = document.getElementById('campaign-objectives');
    if (objectives) {
      objectives.innerHTML = scenario.mission
        ? briefingObjectiveListMarkup(scenario.mission, commander)
        : scenario.objectives.map((objective) => `<li>${escapeHtml(objective)}</li>`).join('');
    }
    this.syncCampaignCommanderUi();
    const friend = document.getElementById('campaign-label-friend');
    if (friend) {
      friend.textContent = command.shortName || command.name;
      friend.style.color = alliance.color;
      friend.style.setProperty('--marker', alliance.color);
    }
    const enemy = document.getElementById('campaign-label-enemy');
    if (enemy) {
      enemy.textContent = opposition.shortName || opposition.name;
      enemy.style.color = enemyAlliance.color;
      enemy.style.setProperty('--marker', enemyAlliance.color);
    }
    const canvas = document.getElementById('campaign-map-canvas');
    canvas?.setAttribute('aria-label', `${mission.name} terrain map`);
    this.paintCampaignMap();
  }

  /** Mirror the persisted commander profile into the deck form. */
  private syncCampaignCommanderUi(): void {
    const state = this.campaignState();
    const identity = state?.commander ?? null;
    const active = document.activeElement;
    const set = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      // Typing must survive a repaint triggered by a map selection.
      if (el && el !== active) el.value = value;
    };
    set('campaign-commander-name', identity?.name ?? '');
    set('campaign-commander-callsign', identity?.callsign ?? '');
    set('campaign-commander-background', identity?.background ?? '');
    const pronouns = document.getElementById('campaign-commander-pronouns') as
      | HTMLSelectElement
      | null;
    if (pronouns && pronouns !== active) pronouns.value = identity?.pronouns ?? '';
    const status = document.getElementById('campaign-commander-status');
    if (status) {
      status.textContent = !state
        ? 'No campaign started · enter a profile to deploy'
        : `${state.veterans.length} named personnel · ${state.completed.length} accepted`;
    }
  }

  private paintCampaignMap(): void {
    const canvas = document.getElementById('campaign-map-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const scenario = this.campaignScenario();
    const rect = drawBriefMap(canvas, scenario);
    // The campaign panel is often hidden while this runs (boot, or the skirmish
    // view). ResizeObserver repaints it once the panel has a box.
    if (!this.campaignBriefObserver && 'ResizeObserver' in window) {
      this.campaignBriefObserver = new ResizeObserver(() => this.paintCampaignMap());
      this.campaignBriefObserver.observe(canvas);
    }
    if (!rect) return;
    for (const label of briefMapLabels(scenario)) {
      const el = document.getElementById(
        label.side === 'friend' ? 'campaign-label-friend' : 'campaign-label-enemy',
      );
      if (!el) continue;
      const at = briefLabelPosition(rect, label);
      el.style.left = `${at.left.toFixed(2)}%`;
      el.style.top = `${at.top.toFixed(2)}%`;
    }
  }

  private showMenu(): void {
    this.missionTestScenario = null;
    this.cinematicPreview = false;
    if (this.cinematic) this.cinematic.skip(true);
    this.endNetworkBattle();
    this.finishTutorial();
    document.getElementById('menu-screen')?.classList.remove('hidden', 'handoff');
    document.getElementById('loading-screen')?.classList.add('hidden');
    this.loading = false;
    this.hud.unmount();
    this.screen = 'menu';
    this.game = null;
    this.paused = false;
    this.overlay.clear();
    this.renderer.setGame(null);
    this.renderer.setCommandFlag(null);
    this.audio.stopMatchMusic();
    this.audio.stopAmbience();
    this.audio.resetAnnouncer();
    this.startMenuBackdrop();
    this.applyDifficultyUi();
    this.applyNationUi();
    this.showMenuView(this.menuView);
    this.refreshEditorAutosaveButton();
    // Returning from a battle or the editor is a natural moment to re-read the
    // session: it may have expired, or been ended on another device.
    void this.accountPanel?.refresh();
    this.revealMenu();
    this.paintBriefMap();
    this.audio.playMenuMusic();
  }

  /**
   * The loading screen is a screen, not a modal: it fills the viewport over the
   * chosen map while the task force is assembled, and carries the brief.
   */
  private setLoading(
    active: boolean,
    scenario?: Scenario,
    options: { commandPlayerId?: number; network?: boolean } = {},
  ): void {
    const screen = document.getElementById('loading-screen');
    if (!screen) return;
    if (active) this.stopAttract();
    this.loading = active;
    screen.classList.toggle('hidden', !active);
    if (active && scenario) {
      this.showLoadingBackdrop(scenario);
      this.fillLoading(scenario, options);
    }
  }

  /**
   * The briefing sits on the live battlefield render, not on a diagram: the
   * selected theatre is shown from the same drifted wide shot the menu uses,
   * so the player spends the wait looking at the ground about to be fought
   * over. The nation's flag is a DOM overlay above it.
   */
  private showLoadingBackdrop(scenario: Scenario): void {
    this.menuScenario = scenario;
    this.menuDrift = 0;
    this.renderer.setGame(null);
    this.renderer.setCommandFlag(null);
    this.renderer.setScenario(scenario);
    this.renderer.settings.grid = false;
    this.renderer.settings.showFog = false;
    this.renderer.camera.setScreenLift(0);
    this.renderer.camera.setZoom(38);
    this.advanceMenuBackdrop(0);
    // The deck's signal tearing belongs to the menu. Behind a loading brief it
    // would read as a fault, so the picture is left clean.
    this.setMenuMode(false);
  }

  private fillLoading(
    scenario: Scenario,
    options: { commandPlayerId?: number; network?: boolean } = {},
  ): void {
    // The brief names the side the viewer fights as, so a networked guest reads
    // its own nation rather than the host's.
    const commandPlayer = scenario.players[options.commandPlayerId ?? 0] ?? scenario.players[0];
    const opponentPlayer =
      scenario.players.find((player) => player !== commandPlayer) ?? scenario.players[1];
    const entry =
      SCENARIOS.find((s) => s.id === scenario.meta.id) ??
      (scenario.meta.id === TUTORIAL_SCENARIO_ID ? TUTORIAL_BRIEF : SCENARIOS[0]);
    const text = (id: string, value: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    const difficulty = this.settings.difficulty;
    // The loading screen reads the scenario, not the menu settings, so an
    // editor launch or a restarted battle names the side it is actually fought as.
    const command = tryIdentityDef(commandPlayer?.factionId ?? '');
    const opponent = tryIdentityDef(opponentPlayer?.factionId ?? '');
    text('loading-title', scenario.meta.name || entry.name);
    text('loading-lede', scenario.meta.description || entry.description);
    text('loading-size', `${scenario.width} × ${scenario.height} tiles`);
    text('loading-command', command?.name ?? commandPlayer?.name ?? 'Task force');
    text('loading-formation', commandPlayer?.name ?? 'Task force');
    text('loading-doctrine', command?.doctrine ?? 'Alliance task force');
    text('loading-opposition', opponent?.name ?? opponentPlayer?.name ?? 'Opposing corps');
    text(
      'loading-alliance',
      command ? identityAlliance(command.id).name : 'Unallied force',
    );
    text('loading-domains', entry.domains);
    // A human opponent is not a difficulty setting, but the brief has one slot
    // for naming who is on the other side.
    // The briefing's watermark is the alliance crest of the side being fought:
    // the same silver/gold identity the battle chrome carries.
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.dataset.front = command ? identityAlliance(command.id).id : 'defender';
    }
    text(
      'loading-difficulty',
      options.network
        ? 'Remote commander'
        : scenario.meta.id === TUTORIAL_SCENARIO_ID
          ? 'Training cadre'
          : difficulty[0].toUpperCase() + difficulty.slice(1),
    );
    const hint = document.getElementById('loading-hint');
    if (hint) {
      hint.textContent = options.network
        ? 'Linking to the room · receiving battlefield · briefing commander'
        : scenario.meta.id === TUTORIAL_SCENARIO_ID
          ? 'Marking training lanes · briefing instructor · checking live-fire range'
          : 'Building terrain mesh · plotting navigation · briefing AI commander';
    }

    // The flag overlay is the one piece of the briefing that is not the live
    // render: it rises out of the bottom of the frame behind the copy.
    const flag = document.getElementById('loading-flag');
    if (flag) {
      const factionId = commandPlayer?.factionId ?? '';
      const nation = factionId ? flagNationForFaction(factionId) : undefined;
      flag.style.backgroundImage = nation ? `url(${flagTextureUrl(nation)})` : 'none';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Battle lifecycle                                                    */
  /* ------------------------------------------------------------------ */

  async startBattle(
    scenario: Scenario,
    options: { missionTest?: boolean } = {},
  ): Promise<void> {
    // A restart or redeploy drops any scene from the previous battle and
    // restores the camera the player was using before it.
    if (this.cinematic) this.cinematic.skip(true);
    this.cinematicPlayed.clear();
    this.finishTutorial();
    // A new battle gets a clean pointer: no ghost from the last engagement.
    this.orderGhosts.length = 0;
    const isTutorial = scenario.meta.id === TUTORIAL_SCENARIO_ID;
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
        // The training lane is scripted: an AI commander would wander into the
        // lesson or attack the trainee while they are still learning the HUD.
        enableAI: !isTutorial,
        aiSeed,
        aiDifficulty: this.settings.difficulty,
      });
      this.game = game;
      this.applyUnitCamo();
      this.captureCommandFlag(game);
      // The third mast flag is a skirmish and multiplayer identity; a campaign
      // operation flies only its alliance and national colours.
      this.renderer.setCommandFlag(this.campaignRun() ? null : this.matchFlagSnapshot(game));
      // The reporting voice belongs to the seat's faction, not to the map. It is
      // set before the opening line so the first words of a battle are already
      // in the right voice.
      this.applyNarrator(game);
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
      this.bookmarks.clear();
      this.idleCursor.clear();
      this.lastAlert = null;
      this.mode = 'none';
      this.placeDefId = null;
      this.accumulator = 0;
      // The opening scene belongs to the launch, not to a loaded save. It frames
      // the battlefield that has just appeared and never advances the mission.
      const openingCinematic = gameScenario.mission?.cinematics.find(
        (entry) => entry.kind === 'opening',
      );
      // A scene that opens the battle must own its very first painted frame. The
      // chrome is put away before the shell is built, so the interface is never
      // assembled on screen only to be pulled down again a frame later.
      const openingWillPlay =
        !!openingCinematic && this.settings.cinematics && !this.cinematic;
      if (openingWillPlay) this.hud.setCinemaHidden(true);
      this.hud.mount(game);
      this.lastEventSeq = 0;
      this.frameBattleCamera();
      // A test run is a disposable copy parsed from the workbench. It carries no
      // campaign reference, so the campaign layer cannot submit a result from it.
      this.missionTestScenario = options.missionTest ? cloneScenario(gameScenario) : null;
      this.setLoading(false);
      this.audio.startMatchMusic();
      if (openingCinematic) {
        const started = this.playCinematic(
          openingCinematic,
          'opening',
          'OPERATION OPENING',
          gameScenario.mission?.title ?? gameScenario.meta.name,
        );
        // Cinematics switched off, or a scene that already holds the frame: the
        // battle still needs an interface, so give the chrome back immediately.
        if (!started) this.hud.setCinemaHidden(false);
      }
      // The opening line belongs to the battle, not to the deck: the announcer is
      // reset above, so each engagement establishes its own field once.
      this.audio.announce('battlefieldEstablished');
      if (isTutorial) {
        this.tutorial = new TutorialDirector(this);
        this.tutorial.start();
        this.notify('Training cadre online. Follow the lane instructions.', 'info');
      } else {
        this.notify('Beachhead established. Establish your economy.', 'info');
      }
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

  /**
   * Point the announcer at the local seat's faction narrator.
   *
   * Every battle-entry path calls this immediately after the game is assigned:
   * a fresh deployment, a networked handoff and a loaded save. One resolution
   * point keeps faction checks out of the event drain and out of every cue.
   * An unknown faction resolves to the Defender voice rather than falling
   * silent, so a malformed save still reports its battlefield.
   */
  /**
   * Capture the command flag for the battle that is starting.
   *
   * This is the whole point of the snapshot: a player who edits or equips a
   * different flag after deploying still gets the report of the flag that was
   * flown. The snapshot is tied to the game instance so a loaded save, which
   * has no deployment moment, cannot inherit the previous battle's flag.
   */
  private captureCommandFlag(game: Game): void {
    this.matchFlag = null;
    this.matchFlagGame = game;
    try {
      if (typeof localStorage === 'undefined') return;
      this.matchFlag = new FlagStore(localStorage).activeDesign()?.composition ?? null;
    } catch {
      /* Storage is blocked: the report simply shows no flag. */
    }
  }

  /** The flag flown when `game` started, or null for a battle with no capture. */
  matchFlagSnapshot(game: Game): FlagComposition | null {
    return this.matchFlagGame === game ? this.matchFlag : null;
  }

  private applyNarrator(game: Game): void {
    const factionId = game.player(game.localPlayerId)?.factionId;
    this.audio.setNarrator(narratorForFaction(factionId).id);
  }

  async restart(): Promise<void> {
    if (!this.game) return;
    // A networked match belongs to its room: there is nothing local to restart,
    // and re-entering would silently drop the seat.
    if (this.network) {
      this.notify('A networked match cannot be restarted from this seat.', 'warning');
      return;
    }
    const scenario = cloneScenario(this.game.state.scenario);
    await this.startBattle(scenario, { missionTest: this.missionTestActive });
  }

  /**
   * Enter a match the room has already started.
   *
   * The client builds the same scenario the room built, purely as a display
   * shell: terrain, both nations, both colours and the fog arrays. From the
   * first update onward, every entity, player row and visibility state on
   * screen comes from the room's team projection, and every order goes back to
   * the room instead of into the local simulation.
   *
   * The handoff arrives on the frame the room goes live and all of the assembly
   * below is synchronous, so it is done behind the same loading brief the
   * single-player launch uses, and that brief stays up until the room's first
   * update has been applied.
   */
  private async startNetworkBattle(client: LobbyClient, view: LobbyView): Promise<void> {
    if (this.screen === 'battle' && this.network) return;
    const handoffKey = `${view.roomId ?? ''}:${view.seat ?? 0}`;
    if (this.networkHandoffKey === handoffKey) return;
    this.networkHandoffKey = handoffKey;
    const config = {
      version: 1 as const,
      mapId: view.mapId ?? '',
      matchDurationMs: view.matchDurationMs,
      // The client builds its own copy of the battlefield from the room's
      // configuration, so the host's hour and weather have to be carried across
      // rather than left to the map's authored defaults: without them a guest
      // fought the same ground in a different sky.
      startHour: view.startHour,
      weather: view.weather,
      seats: view.seats.map((seat) => ({
        nation: seat.nation,
        color: seat.color,
        ready: seat.ready,
      })),
    };
    const parsed = validateLobbyConfig(config);
    if (!parsed.ok) {
      this.notify(`Cannot join the match: ${parsed.problem.message}`, 'critical');
      return;
    }
    const scenario = buildLobbyScenario(parsed.config);
    if (!canLaunch(scenario)) {
      this.notify('This room selected a map that cannot launch here.', 'critical');
      return;
    }
    const seat = view.seat ?? 0;
    // Assembling the shell is synchronous: terrain, meshes, HUD and camera all
    // happen on the frame the room hands off, which is why the tab used to stall
    // before the battlefield appeared. Put up the same briefing the single-player
    // launch uses and let it paint before any of that work starts.
    this.networkLoadingKey = handoffKey;
    this.networkLoadingShownAt = performance.now();
    this.setLoading(true, scenario, { commandPlayerId: seat, network: true });
    document.getElementById('menu-screen')?.classList.add('hidden');
    this.hud.unmount();
    this.overlay.clear();
    await new Promise((resolve) => window.setTimeout(resolve, 240));
    // The seat can be given up while the brief is painting.
    if (this.networkLoadingKey !== handoffKey) return;
    try {
      const game = new Game(cloneScenario(scenario), {
        localPlayerId: seat,
        // The room runs the only AI. A second one here would fight the stream.
        enableAI: false,
        // The shell must not spawn the scenario's forces: for the instant before
        // the first update arrives, a locally initialised world would show both
        // sides' real openings, including the opponent in fog.
        skipInit: true,
      });
      this.finishTutorial();
      this.audio.init();
      this.audio.stopMenuMusic();
      this.audio.resetAnnouncer();
      // The shell has no forces yet (skipInit), but the HUD and the order
      // intents need both seats to exist from the first frame. Seed the player
      // rows from the scenario and leave the world empty: the room's first
      // update fills it in.
      game.adoptNetworkView({
        entities: [],
        players: scenario.players.map((player) => ({
          id: player.id,
          name: player.name,
          factionId: player.factionId,
          team: player.team,
          isAI: false,
          mats: scenario.settings.startingMats,
          req: scenario.settings.startingReq,
          stats: { matsGathered: 0, unitsBuilt: 0, unitsLost: 0, kills: 0, buildingsBuilt: 0 },
          incomeHistory: new Array(60).fill(0),
          defeated: false,
          relayCount: 0,
          research: { completed: [], project: null },
          superweapon: { cooldowns: {}, active: null, ewUntilTick: 0, defence: null },
        })),
        projectiles: [],
        contacts: [],
        charted: [],
        smoke: [],
        fog: new Uint8Array(scenario.width * scenario.height),
        tick: 0,
        victory: 'playing',
        events: [],
        visibleIds: [],
      });
      this.game = game;
      this.applyUnitCamo();
      this.captureCommandFlag(game);
      // The third mast flag is a skirmish and multiplayer identity; a campaign
      // operation flies only its alliance and national colours.
      this.renderer.setCommandFlag(this.campaignRun() ? null : this.matchFlagSnapshot(game));
      // A networked seat reports in its own faction's voice; the room's other
      // seats never hear it, because each client resolves its own narrator.
      this.applyNarrator(game);
      this.network = new NetworkBattle({
        game,
        team: seat,
        send: (command) => client.sendCommand(command),
      });
      this.networkClient = client;
      client.onSnapshot((snapshot) => {
        // The room's map is the battlefield: adopt its layers before the update
        // lands so the first painted frame already shows the real ground. A
        // resync re-ships the same map, and nothing is rebuilt then.
        if (snapshot.map && this.game?.adoptNetworkMap(snapshot.map)) {
          this.renderer.rebuildTerrain();
        }
        this.network?.apply(snapshot);
        // The room's first update is on screen, so the brief has done its job.
        this.releaseNetworkLoading();
      });
      this.renderer.settings.showFog = this.settings.fogVisual && scenario.settings.fog;
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
      this.bookmarks.clear();
      this.idleCursor.clear();
      this.lastAlert = null;
      this.mode = 'none';
      this.placeDefId = null;
      this.accumulator = 0;
      this.hud.mount(game);
      this.frameBattleCamera();
      this.audio.startMatchMusic();
      this.audio.announce('battlefieldEstablished');
      this.notify(`Linked to the room as seat ${seat + 1}. The server is authoritative.`, 'info');
      // A silent room must not leave the player staring at a brief forever.
      if (this.networkLoadingKey === handoffKey) {
        this.networkLoadingTimer = window.setTimeout(() => this.releaseNetworkLoading(), 5_000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Networked battle failed to start', error);
      this.network = null;
      this.networkClient = null;
      this.networkHandoffKey = null;
      this.cancelNetworkLoading();
      this.setLoading(false);
      this.notify(`Networked battle failed to start: ${message}`, 'critical');
      this.showMenu();
    }
  }

  /**
   * One funnel for every order the player gives.
   *
   * In a local battle the command goes into the simulation's queue. In a
   * networked battle it goes to the room, which validates it against this
   * seat's authority and applies it on the authoritative tick. Nothing is
   * applied locally either way here, so the two paths cannot drift.
   */
  private dispatchCommand(command: Command): void {
    if (this.network) {
      if (!this.network.send(command)) {
        this.notify('Order not sent: the match connection is not available.', 'warning');
      }
      return;
    }
    this.game?.enqueueCommand(command);
  }

  /** Drop the seat and the mirror when leaving a networked battle. */
  private endNetworkBattle(): void {
    this.networkHandoffKey = null;
    this.networkStale = false;
    this.cancelNetworkLoading();
    if (!this.network && !this.networkClient) return;
    this.networkClient?.onSnapshot(null);
    this.networkClient?.leave();
    this.networkClient = null;
    this.network = null;
    this.multiplayerPanel?.returnFromBattle();
  }

  /**
   * Lift the brief once the room's first update is applied. It is held for a
   * short minimum so a fast connection does not flash it for a single frame,
   * which is the same floor the single-player launch uses.
   */
  private releaseNetworkLoading(): void {
    if (!this.networkLoadingKey) return;
    this.networkLoadingKey = null;
    if (this.networkLoadingTimer !== null) {
      window.clearTimeout(this.networkLoadingTimer);
      this.networkLoadingTimer = null;
    }
    const remaining = Math.max(0, 780 - (performance.now() - this.networkLoadingShownAt));
    window.setTimeout(() => {
      // A newer handoff owns the screen by now; leave its brief alone.
      if (this.networkLoadingKey === null) this.setLoading(false);
    }, remaining);
  }

  /** Drop the brief's bookkeeping without touching what is on screen. */
  private cancelNetworkLoading(): void {
    this.networkLoadingKey = null;
    if (this.networkLoadingTimer !== null) {
      window.clearTimeout(this.networkLoadingTimer);
      this.networkLoadingTimer = null;
    }
  }

  finishTutorial(): void {
    this.tutorial?.dispose();
    this.tutorial = null;
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
    // A lost GPU context freezes presentation until the browser restores it.
    // Keep the clock moving and the RAF alive, but do no simulation or HUD
    // work while there is nothing valid to draw.
    if (this.renderer.contextLost) {
      this.lastFrame = now;
      requestAnimationFrame(this.frame);
      return;
    }
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
    if (this.screen === 'battle' && this.game && !this.loading) {
      if (this.network) {
        // A networked battle has no local clock to advance: each update from the
        // room replaced the world, and this only eases the display toward it.
        if (!this.paused) this.network.sync(dt);
        this.reportNetworkStaleness(this.network.status().ageMs);
        this.drainEvents();
        this.perf.simMs = 0;
      } else if (!this.paused && !this.cinematicHoldsSimulation) {
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
    }

    // A sequence owns the camera for the frame, so it is advanced before the
    // renderer reads the framing. The clock is the render delta, never a timer.
    if (this.cinematic) {
      this.cinematic.update(dt);
      if (this.cinematic) this.cinematicOverlay.render(this.cinematic.frame);
    }

    if (this.loading) {
      // The briefing screen is the picture: drift the wide shot and keep the
      // theatre rendering until the battle replaces it.
      this.advanceMenuBackdrop(dt);
      this.renderer.render();
    } else if (this.screen === 'battle' && this.game) {
      const sig = this.hudSignatureOf(this.game);
      this.hud.update(this.game, dt, sig);
      this.updateBattlefieldAmbience(dt);
      this.tutorial?.update(dt);
      this.maybeStartInMissionCinematic();
      this.checkVictory();
      this.renderer.setSimulationAlpha(
        this.paused || this.network ? 1 : Math.min(1, this.accumulator / (TICK_MS / 1000)),
      );
      this.renderer.update(dt);
      this.renderer.render();
      this.overlay.draw(this);
      this.perf.entities = this.game.state.entities.length;
    } else if (this.screen === 'editor') {
      this.renderer.update(dt);
      this.renderer.render();
      this.editor.draw();
    } else {
      this.updateAttract(dt);
      this.renderer.render();
    }
    // Last, so the pointer is never under a panel, modal or canvas mark.
    this.cursorLayer.draw(
      this.pointerCursor.name,
      this.pointer.x,
      this.pointer.y,
      this.pointerCursor.visible && this.settings.customCursors,
      performance.now(),
    );
    requestAnimationFrame(this.frame);
  };

  /**
   * Say out loud when the room has gone quiet, and say so again when it comes
   * back. A networked seat owns no clock, so silence is indistinguishable from
   * a battle standing still unless the client says which one it is.
   */
  private reportNetworkStaleness(ageMs: number): void {
    if (!this.networkStale && ageMs > 3_000) {
      this.networkStale = true;
      this.notify('Waiting for the room — reconnecting the link.', 'warning');
      return;
    }
    if (this.networkStale && ageMs < 1_500) {
      this.networkStale = false;
      this.notify('Room link restored.', 'info');
    }
  }

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
      // A rank-up is felt on the map before it is read: the promoted hull pulses
      // for about a second, and the commander gets the same field-report line as
      // every other battle event. The log entry is added below with the rest of
      // this team's news, so a promotion survives as history, not just a flash.
      if (ev.type === 'notice' && ev.code === 'unitPromoted') {
        if (ev.entityId !== undefined && eventVisibleToLocal(this.game, ev)) {
          this.renderer.flashPromotion(ev.entityId);
        }
        if (isLocal) this.notify(ev.text, 'success');
      }
      // Visible enemy fire is part of the battle, not hidden information. Feed
      // it through the same fog gate the renderer uses, with distance trim so
      // a firefight across the island does not sound like one in the base.
      if (eventVisibleToLocal(this.game, ev) && ev.sound) {
        // Place the cue on the same ground frame the camera uses. Events with
        // no reported position stay centred rather than being panned as if
        // they happened at the world origin.
        const camera = this.renderer.camera;
        const positioned = Number.isFinite(ev.x) && Number.isFinite(ev.z) && (ev.x !== 0 || ev.z !== 0);
        const mix = positioned
          ? combatMix(
              ev.x,
              ev.z,
              {
                x: camera.cx,
                z: camera.cz,
                rightX: camera.right[0],
                rightZ: camera.right[2],
                reach: Math.max(1, camera.zoom * 2.6),
              },
              isLocal,
            )
          : { gain: isLocal ? 1 : 0.55, pan: 0 };
        this.audio.play(ev.sound, mix.gain, mix.pan);
      }
      const bark = unitVoiceForEvent(ev, local);
      if (bark) this.audio.speakUnit(bark.cue, bark.defId);
      if (isLocal && (ev.level === 'warning' || ev.level === 'critical')) {
        // A positioned alert is what F2 and a critical toast fly the camera to.
        // Events without a real world position contribute nothing.
        if (Number.isFinite(ev.x) && Number.isFinite(ev.z) && (ev.x !== 0 || ev.z !== 0)) {
          this.lastAlert = { x: ev.x, z: ev.z, tick: ev.tick };
        }
        this.toast(ev.text, ev.level === 'critical' ? 'critical' : 'warning', {
          x: ev.x,
          z: ev.z,
          entityId: ev.entityId,
          tick: ev.tick,
        });
      } else if (isLocal || ev.type === 'buildingLost' || ev.type === 'capture') {
        this.hud.log(ev.text, ev.level ?? 'info', ev.tick, {
          x: ev.x,
          z: ev.z,
          entityId: ev.entityId,
        });
      }
    }
  }

  /**
   * Describe the battlefield bed for this frame: engines on the ground and
   * working structures that the local commander can actually see.
   *
   * Fog decides who gets a voice. A charted structure is memory, not a running
   * plant, and an unseen column must not give itself away by its engine — the
   * bed is presentation, but it still must not leak what the map hides.
   */
  private ambienceCandidates(): AmbienceCandidate[] {
    const game = this.game;
    if (!game) return [];
    const camera = this.renderer.camera;
    const width = Math.max(1, camera.width);
    const height = Math.max(1, camera.height);
    // Screen position, not ground position: the ask is that the mix follows the
    // picture. The camera's own projection already folds in pan, the HUD's
    // framing lift and the zoom, so one call per source is all the bed needs.
    const project = (x: number, z: number) => {
      const p = camera.worldToScreen(x, 0, z);
      return { sx: (p.x / width) * 2 - 1, sy: (p.y / height) * 2 - 1 };
    };
    const out: AmbienceCandidate[] = [];
    for (const e of game.state.entities) {
      if (e.hp <= 0) continue;
      if (!game.isVisibleTo(this.localPlayerId, e.id)) continue;
      if (e.kind === 'unit') {
        const def = UNITS[e.defId];
        if (!def) continue;
        // A hull on turnaround is not idling: its engine is off and the bowser
        // beside it is the thing running. The kit's pump replaces the aircraft's
        // own voice rather than stacking on it, which is also why it has to be
        // decided here — the plan keeps one voice per source.
        if (isServicingAircraft(e)) {
          const kit = serviceKitAmbience({ servicing: true });
          if (kit) {
            out.push({
              id: e.id,
              kind: kit.kind,
              level: kit.level,
              pitch: kit.pitch,
              motion: kit.motion,
              ...project(e.x, e.z),
            });
          }
          continue;
        }
        const tone = unitAmbience({
          domain: def.domain,
          moveClass: def.moveClass,
          armour: def.armour,
          role: def.role,
          speed: def.speed,
          moving: e.state === 'moving',
          harvesting: !!e.harvester,
          garrisoned: !!e.garrisonId,
          dived: !!e.submarine?.dived,
        });
        if (!tone) continue;
        out.push({
          id: e.id,
          kind: tone.kind,
          level: tone.level,
          pitch: tone.pitch,
          motion: tone.motion,
          ...project(e.x, e.z),
        });
        continue;
      }
      // A site is scaffolding and a sale is a teardown: neither is a working
      // plant, and both already have their own cues.
      if (e.construction || e.deconstruct) continue;
      const def = BUILDINGS[e.defId];
      if (!def) continue;
      const tone = structureAmbience(def);
      if (!tone) continue;
      // A working plant hums at a steady speed: some life, no travel.
      out.push({
        id: e.id,
        kind: 'facility',
        level: tone.level,
        pitch: tone.pitch,
        motion: 0.15,
        ...project(e.x, e.z),
      });
    }
    return out;
  }

  /**
   * Steer the bed ten times a second rather than once per frame.
   *
   * The gains are smoothed inside the audio graph, so a 10 Hz plan sounds
   * continuous while costing a fraction of the walk over the entity list — the
   * bed is ambience, not a cue that has to land on a tick.
   */
  private updateBattlefieldAmbience(dt: number): void {
    if (!this.game) return;
    this.ambienceClock += dt;
    this.serviceChirpClock += dt;
    if (this.ambienceClock < 0.1) return;
    this.ambienceClock = 0;
    const plan = ambiencePlan(this.ambienceCandidates(), {
      gainScale: framingGain(this.renderer.camera.zoom),
    });
    this.audio.updateAmbience(plan);
    // The beacon chirps over the pump on its own clock, from the same plan that
    // decided who is audible: the nearest working apron, panned where it sits in
    // the frame. With no apron in earshot the clock simply keeps running, so the
    // first call lands as the crew hook up instead of up to a beat late.
    if (this.serviceChirpClock < SERVICE_BEACON_CHIRP_SECONDS) return;
    const apron = plan.find((voice) => voice.kind === 'servicing');
    if (!apron) return;
    this.serviceChirpClock = 0;
    this.audio.play('serviceBeacon', Math.max(0.2, apron.gain * 0.9), apron.pan);
  }

  /* ------------------------------------------------------------------ */
  /* Cinematic presentation                                              */
  /* ------------------------------------------------------------------ */

  /** True while a sequence owns input. The input controller checks this. */
  get cinematicLocked(): boolean {
    return this.cinematic !== null;
  }

  /** True while the scene is a framing scene and the simulation must hold. */
  private get cinematicHoldsSimulation(): boolean {
    return this.cinematicContext !== null && cinematicPausesSimulation(this.cinematicContext);
  }

  /** Read-only outlook on the pending result. It never mutates the campaign. */
  campaignOutlook(): CampaignOutlook | null {
    const state = this.campaignState();
    if (!state) return null;
    return campaignResultOutlook(state, this.campaignDef());
  }

  skipCinematic(): void {
    this.cinematic?.skip();
  }

  /** The persistent skip-all preference: end this scene and suppress future ones. */
  skipAllCinematics(): void {
    this.settings.cinematics = false;
    this.saveSettings();
    this.renderMenuSettings();
    this.cinematic?.skip(true);
    this.toast('Cinematics disabled. Campaign progress is unchanged.', 'info');
  }

  private prefersReducedMotion(): boolean {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /**
   * Start one authored sequence.
   *
   * Presentation state only: the mission document is copied for commander
   * tokens, the camera is captured by the player and the simulation is held by
   * the frame loop for framing contexts. Returns false when cinematics are off
   * or another scene is already running.
   */
  private playCinematic(
    doc: MissionCinematicDoc,
    context: MissionCinematicContext,
    eyebrow: string,
    title: string,
    force = false,
  ): boolean {
    if ((!this.settings.cinematics && !force) || this.cinematic) return false;
    const commander = this.campaignState()?.commander ?? null;
    const localised = localiseCinematic(doc, commander);
    const camera = this.renderer.camera;
    const player = new CinematicPlayer(
      localised,
      {
        camera,
        resolveEntity: (key) => this.cinematicPoint(key),
        restoreCamera: (state) => camera.setFraming(state.cx, state.cz, state.zoom),
        reducedMotion: this.prefersReducedMotion(),
      },
      () => this.endCinematic(),
    );
    this.cinematic = player;
    this.cinematicContext = context;
    // A scene owns the frame: the chrome leaves with it and returns afterwards.
    this.hud.setCinemaHidden(true);
    this.hideCinematicBackground(true);
    this.cinematicOverlay.show({
      eyebrow,
      title,
      skippable: doc.skippable,
      framing: cinematicPausesSimulation(context),
    });
    player.start();
    this.cinematicOverlay.render(player.frame);
    return true;
  }

  private endCinematic(): void {
    this.cinematic = null;
    this.cinematicContext = null;
    if (this.cinematicPreview) {
      this.cinematicPreview = false;
      this.menuScenario = null;
    }
    this.cinematicOverlay.hide();
    // The commander's own HUD preference decides what comes back, not the scene.
    this.hud.setCinemaHidden(false);
    this.hideCinematicBackground(false);
  }

  /**
   * Keep the screen behind a scene out of the accessibility tree and out of the
   * tab order. Only surfaces this scene hid are restored, so a hidden menu is
   * not made visible by a cinematic ending.
   */
  private hideCinematicBackground(hidden: boolean): void {
    if (hidden) {
      for (const id of ['hud-root', 'menu-screen']) {
        const element = document.getElementById(id);
        if (!element || this.cinematicBackground.has(element)) continue;
        element.setAttribute('aria-hidden', 'true');
        element.setAttribute('inert', '');
        this.cinematicBackground.add(element);
      }
      return;
    }
    for (const element of this.cinematicBackground) {
      element.removeAttribute('aria-hidden');
      element.removeAttribute('inert');
    }
    this.cinematicBackground.clear();
  }

  /** World position of an authored placement, live or on the deck backdrop. */
  private cinematicPoint(key: string): { x: number; z: number } | null {
    const entity = this.game?.state.entities.find(
      (entry) => entry.authoredKey === key && entry.hp > 0,
    );
    if (entity) return { x: entity.x, z: entity.z };
    const scenario = this.menuScenario ?? this.game?.state.scenario ?? null;
    if (!scenario) return null;
    const unit = scenario.units.find((entry) => entry.key === key);
    if (unit) return { x: (unit.x + 0.5) * TILE_SIZE, z: (unit.z + 0.5) * TILE_SIZE };
    const structure = scenario.structures.find((entry) => entry.key === key);
    if (structure) {
      return { x: (structure.x + 0.5) * TILE_SIZE, z: (structure.z + 0.5) * TILE_SIZE };
    }
    return null;
  }

  /**
   * Start an in-mission sequence whose authored time has arrived.
   *
   * Eligible sequences are presentation state, not trigger actions: the mission
   * runtime is not told about them and no simulation tick is consumed.
   */
  private maybeStartInMissionCinematic(): void {
    if (this.cinematic || !this.game || this.screen !== 'battle' || this.loading || this.paused) {
      return;
    }
    if (this.game.state.victory !== 'playing') return;
    const doc = this.game.state.scenario.mission;
    if (!doc) return;
    const seconds = Math.max(0, this.game.state.tick - this.game.state.startedAtTick) / TICK_RATE;
    const next = doc.cinematics
      .filter(
        (entry) =>
          entry.kind === 'inMission' &&
          !this.cinematicPlayed.has(entry.id) &&
          (entry.atSeconds ?? Number.POSITIVE_INFINITY) <= seconds,
      )
      .sort((a, b) => (a.atSeconds ?? 0) - (b.atSeconds ?? 0) || a.id.localeCompare(b.id))[0];
    if (!next) return;
    this.cinematicPlayed.add(next.id);
    if (!this.settings.cinematics) return;
    // A scene is not an order mode: leave placement/box selection cleanly.
    this.mode = 'none';
    this.placeDefId = null;
    this.dragBox.active = false;
    this.playCinematic(next, 'inMission', 'FIELD REPORT', doc.title);
  }

  /** A loaded battle must not replay scenes it has already passed. */
  private markElapsedCinematics(): void {
    const doc = this.game?.state.scenario.mission;
    if (!doc || !this.game) return;
    const seconds = Math.max(0, this.game.state.tick - this.game.state.startedAtTick) / TICK_RATE;
    for (const entry of doc.cinematics) {
      if (entry.kind === 'inMission' && (entry.atSeconds ?? Number.POSITIVE_INFINITY) <= seconds) {
        this.cinematicPlayed.add(entry.id);
      }
    }
  }

  private checkVictory(): void {
    if (!this.game) return;
    const result = this.game.state.victory;
    if (result === 'playing' || this.victoryShown === result) return;
    // The result screen outranks a scene still on screen: restore the camera
    // before the card is built.
    this.cinematic?.skip(true);
    this.victoryShown = result;
    // A campaign operation ending is not progression. The captured result is
    // recorded as pending; the player accepts or retries on the end screen, and
    // only acceptance changes the roster or the campaign's variables.
    const run = this.campaignRun();
    if (run) {
      this.campaignId = run.campaign.id;
      const missionResult = this.game.missionResult;
      if (missionResult) this.captureCampaignResult(run, missionResult);
      this.renderCampaignMissions();
      this.applyCampaignUi();
    }
    this.finishTutorial();
    this.audio.stopMatchMusic();
    this.selected = [];
    this.mode = 'none';
    this.hud.showEnd(result);
    void this.recordEndCareer(result);
  }

  /**
   * Career line on the end card.
   *
   * A campaign result is not career progress until it is accepted, so the card
   * says so and the award happens in the acceptance transaction. A workbench
   * test is not a played operation at all. Everything else is recorded once per
   * finished battle, with a reference that makes a retry or a reload harmless.
   */
  private async recordEndCareer(result: VictoryState): Promise<void> {
    const slot = document.getElementById('end-career');
    if (!slot || !this.careerService || result === 'playing') return;
    if (this.missionTestActive) return;
    // An online match is already recorded by the room that ran it. The client
    // must never submit it: it reads the award the account service derived
    // from the authoritative result, and says "synchronising" until it can.
    if (this.network) {
      await this.recordNetworkCareer(slot, result);
      return;
    }
    if (this.campaignRun()) {
      this.paintEndCareer(slot, { status: 'pending' });
      return;
    }
    const game = this.game;
    if (!game) return;
    const missionResult = game.missionResult;
    const elapsedSeconds =
      missionResult?.elapsedSeconds ??
      Math.max(0, (game.state.tick - game.state.startedAtTick) / TICK_RATE);
    const player = this.localPlayer;
    const input: CareerMatchInput = {
      ref: this.careerRef('skirmish'),
      mode: 'skirmish',
      outcome: result,
      difficulty: this.settings.difficulty,
      durationSeconds: Math.round(elapsedSeconds),
      nation: player?.factionId ?? null,
      kills: player?.stats.kills ?? 0,
      unitsLost: player?.stats.unitsLost ?? 0,
    };
    try {
      const objectivesCompleted = missionResult
        ? missionResult.objectives.filter((objective) => objective.state === 'complete').length
        : 0;
      const outcome = await this.careerService.record(input, {
        objectivesCompleted,
        structuresBuilt: player?.stats.buildingsBuilt ?? 0,
        structuresDestroyed: player?.stats.structuresDestroyed ?? 0,
        sitesCaptured: player?.stats.sitesCaptured ?? 0,
        superweaponsUsed: 0,
      });
      this.paintEndCareer(slot, {
        status: 'recorded',
        xp: outcome.award,
        snapshot: outcome.snapshot,
        rewards: outcome.rewards,
      });
      void this.accountPanel?.refresh();
    } catch (error) {
      this.paintEndCareer(slot, {
        status: 'failed',
        message: error instanceof Error ? error.message : 'the account service could not be reached',
      });
    }
  }

  private paintEndCareer(slot: HTMLElement, state: EndCareerState): void {
    // A restart or a menu return may have replaced the card while the request
    // was in flight; only paint into the slot that is still on screen.
    if (document.getElementById('end-career') !== slot) return;
    slot.innerHTML = endCareerMarkup(state);
  }

  /**
   * The career block on an online result card.
   *
   * The room reports the finished match to the account service, so the client
   * waits for the room's match reference, then asks the service what the match
   * paid. Every state it can be in — waiting, still synchronising, awarded,
   * or unavailable to a guest — is shown honestly, and a retry only re-reads;
   * it can never create a second award.
   */
  private async recordNetworkCareer(slot: HTMLElement, outcome: VictoryState): Promise<void> {
    if (!this.careerService) {
      this.paintEndCareer(slot, { status: 'pending' });
      return;
    }
    this.paintNetworkCareer(slot, null, 'Waiting for the room to report the finished match…', false);
    let matchId = this.networkClient?.state.matchResult?.matchId ?? null;
    const deadline = performance.now() + 10_000;
    while (!matchId && performance.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      if (document.getElementById('end-career') !== slot) return;
      matchId = this.networkClient?.state.matchResult?.matchId ?? null;
    }
    if (!matchId) {
      this.paintNetworkCareer(slot, null, 'The room has not reported this match yet.', true);
      return;
    }
    try {
      const view = await this.careerService.matchOutcome(matchId);
      if (document.getElementById('end-career') !== slot) return;
      if (!view) {
        this.paintNetworkCareer(
          slot,
          null,
          'Online career XP is stored with an account. Sign in before the next match to earn it.',
          false,
        );
        return;
      }
      if (view.status === 'recorded') {
        this.paintNetworkCareer(slot, view, null, false);
        void this.accountPanel?.refresh();
        return;
      }
      this.paintNetworkCareer(
        slot,
        null,
        'The result is still synchronising. It will appear in your service record shortly.',
        true,
      );
    } catch (error) {
      this.paintNetworkCareer(
        slot,
        null,
        error instanceof Error ? error.message : 'The account service could not be reached.',
        true,
      );
    }
    // `outcome` is deliberately unused for the award: the server decided it.
    void outcome;
  }

  private paintNetworkCareer(
    slot: HTMLElement,
    view: Parameters<typeof mpCareerSummaryMarkup>[0],
    note: string | null,
    retry: boolean,
  ): void {
    if (document.getElementById('end-career') !== slot) return;
    const noteMarkup = note
      ? `<p class="account-note" data-career-note>${note.replace(/[<>&]/g, '')}</p>`
      : '';
    const retryMarkup = retry
      ? '<button type="button" class="btn btn-ghost" data-career-retry>RETRY RECORD</button>'
      : '';
    slot.innerHTML = `${mpCareerSummaryMarkup(view)}${noteMarkup}${retryMarkup}`;
    if (retry) {
      slot.querySelector('[data-career-retry]')?.addEventListener('click', () => {
        void this.recordNetworkCareer(slot, this.game?.state.victory ?? 'defeat');
      });
    }
  }

  /** Stable reference for idempotent career writes. */
  private careerRef(prefix: string): string {
    const cryptoApi = typeof crypto !== 'undefined' ? crypto : null;
    const random =
      cryptoApi && typeof cryptoApi.randomUUID === 'function'
        ? cryptoApi.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}:${random}`;
  }

  /** Campaign XP is awarded by the acceptance transaction, never by the battle. */
  private recordCampaignCareer(campaignId: string, pending: CampaignPendingResult): void {
    if (!this.careerService) return;
    const input: CareerMatchInput = {
      ref: `campaign:${campaignId}:${pending.missionId}`.slice(0, 96),
      mode: 'campaign',
      outcome: pending.result.outcome,
      difficulty: this.settings.difficulty,
      durationSeconds: Math.max(0, Math.round(pending.result.elapsedSeconds)),
      kills: pending.result.friendly.kills,
      unitsLost: pending.result.friendly.unitsLost,
    };
    void this.careerService
      .record(input, {
        objectivesCompleted: pending.result.objectives.filter((objective) => objective.state === 'complete').length,
        structuresBuilt: pending.result.friendly.buildingsBuilt,
        structuresDestroyed: 0,
        sitesCaptured: 0,
        superweaponsUsed: 0,
      })
      .then((outcome) => {
        for (const award of outcome.rewards?.achievements ?? []) {
          this.notify(`Commendation earned: ${award.name}.`, 'success');
        }
        if (outcome.rewards?.promoted && outcome.rewards.rankAfter) {
          this.notify(`Promoted to ${outcome.rewards.rankAfter.name}.`, 'success');
        } else if (outcome.rewards?.levelUp) {
          this.notify(`Service level ${outcome.rewards.levelAfter}.`, 'info');
        }
        void this.accountPanel?.refresh();
      })
      .catch((error: unknown) =>
        this.notify(
          `Career record not saved: ${error instanceof Error ? error.message : 'account service unavailable'}`,
          'warning',
        ),
      );
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
    // The map answers a click before a unit does: one short tick under the
    // bark, so a click that caught nothing still feels like it landed.
    this.audio.play('select');
    this.playSelectionBark();
  }

  addToSelection(id: number): void {
    const e = this.game?.getEntity(id);
    if (!e) return;
    const adding = !this.selected.includes(id);
    if (adding) {
      this.selected = [...this.selected, id];
    } else {
      this.selected = this.selected.filter((s) => s !== id);
    }
    this.hud.selectionChanged();
    if (adding && e.owner === this.localPlayerId && e.kind === 'unit') {
      this.audio.speakUnit('select', e.defId);
    }
  }

  /**
   * The first locally owned mobile unit answers a new selection. Structures and
   * mixed groups follow the same rule: one clear acknowledgement, not a chorus.
   */
  private playSelectionBark(): void {
    if (!this.game) return;
    const unit = this.selectedEntities().find(
      (e) => e.kind === 'unit' && e.owner === this.localPlayerId,
    );
    if (unit) this.audio.speakUnit('select', unit.defId);
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

  /** Select the whole mobile force; garrisoned infantry stay inside. */
  selectAllArmy(): void {
    if (!this.game) return;
    const ids = this.game
      .entitiesOf(this.localPlayerId, 'unit')
      .filter((e) => e.hp > 0 && !e.garrisonId)
      .map((e) => e.id);
    if (ids.length === 0) {
      this.notify('No mobile units to select.', 'warning');
      return;
    }
    this.setSelection(ids);
  }

  /**
   * A grouped roster card narrows the selection to that unit type instead of
   * opening one hull; the detail card can still inspect a single entity.
   */
  narrowSelectionToType(defId: string): void {
    const ids = this.selectedEntities()
      .filter((e) => e.kind === 'unit' && e.defId === defId)
      .map((e) => e.id);
    if (ids.length === 0) return;
    this.setSelection(ids);
  }

  /**
   * Cycle the player's idle haulers or engineers, centring the camera on the
   * chosen unit. Repeated presses wrap, so a lost worker can always be found.
   */
  cycleIdleUnit(kind: 'harvester' | 'engineer'): void {
    if (!this.game) return;
    const idle = this.game
      .entitiesOf(this.localPlayerId, 'unit')
      .filter((e) => {
        if (e.hp <= 0 || e.garrisonId) return false;
        const wanted = kind === 'harvester' ? !!e.harvester : !!UNITS[e.defId]?.canBuild;
        return wanted && e.state === 'idle' && !e.order;
      })
      .sort((a, b) => a.id - b.id);
    if (idle.length === 0) {
      this.notify(
        kind === 'harvester' ? 'No idle harvesters.' : 'No idle engineers.',
        'warning',
      );
      return;
    }
    const previousId = this.idleCursor.get(kind) ?? -1;
    const index = nextIdleIndex(
      idle.length,
      idle.findIndex((e) => e.id === previousId),
    );
    const target = idle[index];
    this.idleCursor.set(kind, target.id);
    this.setSelection([target.id]);
    this.renderer.camera.centerOn(target.x, target.z);
    this.audio.play('ui');
  }

  /** Fly to the most recent local warning or critical alert, if one exists. */
  jumpToLastAlert(): void {
    if (!this.lastAlert) {
      this.notify('No recent alert to jump to.', 'info');
      return;
    }
    this.renderer.camera.centerOn(this.lastAlert.x, this.lastAlert.z);
    this.audio.play('ui');
  }

  /** Fly to a report selected from the searchable event log. */
  jumpToLogEntry(x: number, z: number): void {
    if (!this.game || this.screen !== 'battle') return;
    this.renderer.camera.centerOn(x, z);
    this.audio.play('ui');
  }

  toggleEventLog(): void {
    this.hud.toggleEventLog();
  }

  closeEventLog(): void {
    this.hud.closeEventLog();
  }

  /** Store the current camera centre in one of four bookmarks. */
  saveBookmark(index: number): void {
    if (this.screen !== 'battle' || !this.game) return;
    const camera = this.renderer.camera;
    this.bookmarks.set(index, { x: camera.cx, z: camera.cz });
    this.notify(`Camera bookmark ${index} saved.`, 'success');
    this.audio.play('ui');
  }

  recallBookmark(index: number): void {
    const spot = this.bookmarks.get(index);
    if (!spot) {
      this.notify(`Camera bookmark ${index} is empty.`, 'warning');
      return;
    }
    this.renderer.camera.centerOn(spot.x, spot.z);
    this.audio.play('ui');
  }

  /**
   * Vertical offset of a unit's click target. Air hulls are drawn at a blended
   * altitude, never at a flat cruising height, so a parked or landing airframe
   * has to be picked where it actually is — the old fixed cruising offset put
   * its hotspot far above the model and left every stationed plane and
   * helicopter unclickable.
   */
  private unitPickHeight(e: Entity): number {
    if (e.kind !== 'unit' || UNITS[e.defId]?.domain !== 'air') return 1;
    const ac = e.aircraft;
    const climb = ac ? ac.climb ?? (ac.landed ? 0 : 1) : 1;
    return PARKED_AIRCRAFT_CLEARANCE + (AIR_UNIT_ALTITUDE - PARKED_AIRCRAFT_CLEARANCE) * climb;
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
      // A passenger is part of its container, not a separate click target: the
      // hull (or building) underneath owns selection and orders, so a loaded
      // transport can still be right-clicked to take more troops.
      if (e.kind === 'unit' && e.garrisonId) continue;
      if (
        e.owner !== this.localPlayerId &&
        !this.game.isKnownTo(this.game.teamOf(this.localPlayerId), e.id)
      ) continue;
      const y = terrainVisualHeight(this.game.state.scenario, e.x, e.z) + this.unitPickHeight(e);
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
      if (e.owner !== this.localPlayerId || e.hp <= 0 || e.kind === 'building' || e.garrisonId) continue;
      const p = this.renderer.camera.worldToScreen(
        e.x,
        terrainVisualHeight(this.game.state.scenario, e.x, e.z) + this.unitPickHeight(e),
        e.z,
      );
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

  /**
   * Resolve and dispatch a right-click order. Returns the order that actually
   * reached the simulation, so the caller can leave a ghost only for a command
   * the console accepted rather than for a refusal.
   */
  orderAt(
    clientX: number,
    clientY: number,
    attackMove = false,
    queue = false,
  ): OrderGhostKind | null {
    if (!this.game) return null;
    // A right-click while a footprint is armed is the universal cancel: the
    // selected force must not be sent walking just because the build cursor
    // was over the battlefield.
    if (this.mode === 'place') {
      this.cancelMode();
      return null;
    }
    const target = this.pickAt(clientX, clientY);
    const hostile = !!target && this.game.isHostile(target.owner, this.localPlayerId);
    if (this.mode === 'guard') {
      if (target) this.commandGuard(target.id);
      else this.notify('Select a friendly unit to guard.', 'warning');
      return null;
    }
    // A mobile transport exposes the same occupancy list as a shelter, but only
    // its owner may see who is inside; the projection already enforces that on
    // the wire, and a right-click on an enemy APC falls through to attack.
    const occupants =
      target &&
      (target.kind === 'building' || UNITS[target.defId]?.transport)
        ? this.game.garrisonOccupants(target.id)
        : [];
    switch (contextOrderFor(target, this.ownSelected(), this.localPlayerId, hostile, occupants)) {
      case 'capture':
        if (target) this.commandCapture(target.id);
        return null;
      case 'repair':
        if (target) this.commandRepair(target.id);
        return null;
      case 'garrison':
        if (target) this.commandGarrison(target.id);
        return null;
      case 'attack':
        if (target && this.commandAttack(target.id)) return 'attack';
        return null;
      default: {
        const p = this.worldAt(clientX, clientY);
        if (p && this.commandMove(p.x, p.z, attackMove, queue)) return 'move';
        return null;
      }
    }
  }

  /** Remember an accepted right-click order as a fading mark on the ground. */
  markOrderGhost(x: number, y: number, kind: OrderGhostKind): void {
    addOrderGhost(this.orderGhosts, { x, y, kind, born: performance.now() });
  }

  commandMove(x: number, z: number, attackMove = false, queue = false): boolean {
    if (!this.game) return false;
    const units = this.ownSelected().filter((e) => e.kind === 'unit');
    const movable = units.filter((e) => !e.garrisonId);
    if (units.length > 0 && movable.length === 0) {
      this.mode = 'none';
      this.notify('Garrisoned infantry must exit the building before moving.', 'warning');
      this.audio.play('denied');
      return false;
    }
    const buildings = this.ownSelected().filter((e) => e.kind === 'building');
    if (movable.length > 0) {
      const cmd: Command = { type: 'move', team: this.localPlayerId, ids: movable.map((e) => e.id), x, z, attackMove };
      if (queue) cmd.queue = true;
      this.dispatchCommand(cmd);
      this.audio.play('order');
      this.mode = 'none';
      return true;
    }
    if (buildings.length === 1) {
      const target = buildings[0];
      // Refuse before queuing so the confirmation is never a lie: a shipyard
      // only rallies its hulls to water.
      const status = this.game.rallyStatus(target.id, x, z);
      if (!status.ok) {
        this.notify(status.reason, 'warning');
        this.audio.play('denied');
        return false;
      }
      this.dispatchCommand({ type: 'setRally', team: this.localPlayerId, buildingId: target.id, x, z });
      this.audio.play('order');
      this.mode = 'none';
      this.notify(target.defId === 'shipyard' ? 'Naval rally point set.' : 'Rally point set.', 'info');
      return true;
    }
    this.notify('Select units to issue orders.', 'warning');
    this.audio.play('denied');
    return false;
  }

  /** Patrol selected mobile units between their current ground and a point. */
  commandPatrol(x: number, z: number): boolean {
    if (!this.game) return false;
    const units = this.ownSelected().filter((e) => e.kind === 'unit' && !e.garrisonId);
    if (units.length === 0) {
      this.notify('Select units to patrol.', 'warning');
      this.audio.play('denied');
      return false;
    }
    this.dispatchCommand({
      type: 'patrol',
      team: this.localPlayerId,
      ids: units.map((e) => e.id),
      x,
      z,
    });
    this.audio.play('order');
    this.mode = 'none';
    return true;
  }

  /** Follow a friendly unit; the guard detail keeps its weapons free. */
  commandGuard(targetId: number): boolean {
    if (!this.game) return false;
    const target = this.game.getEntity(targetId);
    if (
      !target ||
      target.kind !== 'unit' ||
      target.hp <= 0 ||
      target.owner < 0 ||
      this.game.isHostile(target.owner, this.localPlayerId) ||
      target.garrisonId
    ) {
      this.notify('Select a friendly unit to guard.', 'warning');
      this.audio.play('denied');
      return false;
    }
    const units = this.ownSelected().filter(
      (e) => e.kind === 'unit' && !e.garrisonId && e.id !== targetId,
    );
    if (units.length === 0) {
      this.notify('Select another unit to guard that one.', 'warning');
      this.audio.play('denied');
      return false;
    }
    this.dispatchCommand({
      type: 'guard',
      team: this.localPlayerId,
      ids: units.map((e) => e.id),
      targetId: target.id,
    });
    this.audio.play('order');
    this.mode = 'none';
    return true;
  }

  commandAttack(targetId: number): boolean {
    if (!this.game) return false;
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
      return false;
    }
    this.dispatchCommand({ type: 'attack', team: this.localPlayerId, ids: attackers.map((e) => e.id), targetId });
    this.audio.play('order');
    this.mode = 'none';
    return true;
  }

  commandCapture(targetId: number): void {
    if (!this.game) return;
    const engineers = this.ownSelected().filter((e) => UNITS[e.defId]?.canCapture && !e.garrisonId);
    if (engineers.length === 0) {
      this.notify('Combat Engineers capture strategic objectives.', 'warning');
      this.audio.play('denied');
      return;
    }
    this.dispatchCommand({ type: 'capture', team: this.localPlayerId, ids: engineers.map((e) => e.id), targetId });
    this.audio.play('order');
    this.mode = 'none';
  }

  commandGarrison(targetId: number): void {
    if (!this.game) return;
    const infantry = this.ownSelected().filter(
      (e) => e.kind === 'unit' && !e.garrisonId && UNITS[e.defId]?.canGarrison,
    );
    if (infantry.length === 0) {
      this.notify('Select exposed infantry to board a transport or garrison a building.', 'warning');
      this.audio.play('denied');
      return;
    }
    this.dispatchCommand({ type: 'garrison', team: this.localPlayerId, ids: infantry.map((e) => e.id), targetId });
    this.audio.play('order');
    this.mode = 'none';
  }

  commandUngarrison(): void {
    if (!this.game) return;
    const game = this.game;
    const selected = this.selectedEntities();
    const ids = selected
      .filter((e) => {
        // A selected passenger is one form of this order; the hull or building
        // carrying them is the other. Without the container branch a loaded APC
        // was rejected even though the panel had offered UNLOAD ALL for it.
        if (e.kind === 'unit' && e.garrisonId) return e.owner === this.localPlayerId;
        if (e.kind === 'unit') {
          if (!UNITS[e.defId]?.transport) return false;
          // Air and naval unloads depend on the owner's landing or beaching, so
          // only that owner may issue them. A ground carrier only needs one of
          // the player's own infantry aboard, even when a teammate owns it.
          const domain = UNITS[e.defId]?.domain;
          if ((domain === 'air' || domain === 'naval') && e.owner !== this.localPlayerId) {
            return false;
          }
        }
        return game.garrisonOccupants(e.id).some((u) => u.owner === this.localPlayerId);
      })
      .map((e) => e.id);
    if (ids.length === 0) {
      this.notify('Select passengers, an occupied building, or a loaded transport to unload.', 'warning');
      this.audio.play('denied');
      return;
    }
    this.dispatchCommand({ type: 'ungarrison', team: this.localPlayerId, ids });
    this.audio.play('order');
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
    this.dispatchCommand({ type: 'repair', team: this.localPlayerId, ids: engineers.map((e) => e.id), targetId });
    this.audio.play('order');
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
    this.dispatchCommand({ type: 'stop', team: this.localPlayerId, ids });
    this.audio.play('order');
  }

  commandHold(): void {
    if (!this.game) return;
    const ids = this.ownSelected().filter((e) => e.kind === 'unit').map((e) => e.id);
    if (ids.length === 0) return;
    this.dispatchCommand({ type: 'hold', team: this.localPlayerId, ids });
    this.audio.play('order');
  }

  setStance(stance: Stance): void {
    if (!this.game) return;
    const ids = this.ownSelected().filter((e) => e.kind === 'unit').map((e) => e.id);
    if (ids.length === 0) return;
    this.dispatchCommand({ type: 'stance', team: this.localPlayerId, ids, stance });
    this.audio.play('order');
  }

  /**
   * Use a researched unit ability on one inspected hull.
   *
   * The local status check only decides whether to bother the room; it is not
   * authority. In a networked battle the command goes up and the server's own
   * status call decides, exactly as it does for every other order.
   */
  useAbility(unitId: number, abilityId: string): void {
    if (!this.game) return;
    const unit = this.game.getEntity(unitId);
    if (!unit || unit.kind !== 'unit' || unit.owner !== this.localPlayerId) return;
    const status = this.game.abilityStatus(this.localPlayerId, unitId, abilityId);
    if (!status.ok) {
      this.notify(status.reason, 'warning');
      this.audio.play('denied');
      return;
    }
    this.dispatchCommand({ type: 'useAbility', team: this.localPlayerId, unitId, abilityId });
    this.audio.play('order');
  }

  /**
   * Buy a researched module for one structure.
   *
   * The module is individual to the structure, so the command names both. The
   * local status check decides whether to bother the room; it is not authority.
   * In a networked battle the order goes up and the server's own
   * `moduleStatus` decides, exactly as it does for every other order.
   */
  installModule(buildingId: number, moduleId: string): void {
    if (!this.game) return;
    const building = this.game.getEntity(buildingId);
    if (!building || building.kind !== 'building' || building.owner !== this.localPlayerId) {
      return;
    }
    const status = this.game.moduleStatus(this.localPlayerId, buildingId, moduleId);
    if (!status.ok) {
      this.notify(status.reason, 'warning');
      this.audio.play('denied');
      return;
    }
    this.dispatchCommand({ type: 'installModule', team: this.localPlayerId, buildingId, moduleId });
    this.audio.play('ui');
  }

  /** Dive the selected boats if any are surfaced; otherwise bring them up. */
  commandDive(): void {
    if (!this.game) return;
    const subs = this.ownSelected().filter(
      (e) => e.kind === 'unit' && !!UNITS[e.defId]?.submarine,
    );
    if (subs.length === 0) {
      this.notify('Select a submarine to dive or surface.', 'warning');
      this.audio.play('denied');
      return;
    }
    const dive = subs.some((e) => !e.submarine?.dived);
    this.dispatchCommand({
      type: 'dive',
      team: this.localPlayerId,
      ids: subs.map((e) => e.id),
      dive,
    });
    this.audio.play('ui');
  }

  /** Land selected transport helicopters on open ground at the click point. */
  commandLand(x: number, z: number): boolean {
    if (!this.game) return false;
    const transports = this.ownSelected().filter(
      (e) =>
        e.kind === 'unit' &&
        !!UNITS[e.defId]?.transport &&
        UNITS[e.defId]?.domain === 'air',
    );
    if (transports.length === 0) {
      this.notify('Select a transport helicopter to land.', 'warning');
      this.audio.play('denied');
      return false;
    }
    this.dispatchCommand({
      type: 'land',
      team: this.localPlayerId,
      ids: transports.map((e) => e.id),
      x,
      z,
    });
    this.audio.play('order');
    this.mode = 'none';
    return true;
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
    this.dispatchCommand({ type: 'return', team: this.localPlayerId, ids });
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
      this.notify('Select exposed infantry to board a transport or garrison a building.', 'warning');
      this.audio.play('denied');
      return;
    }
    if (
      mode === 'land' &&
      !this.ownSelected().some(
        (e) =>
          e.kind === 'unit' &&
          !!UNITS[e.defId]?.transport &&
          UNITS[e.defId]?.domain === 'air',
      )
    ) {
      this.notify('Select a transport helicopter to land.', 'warning');
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
    if (mode === 'patrol' && !this.ownSelected().some((e) => e.kind === 'unit' && !e.garrisonId)) {
      this.notify('Select mobile units to patrol.', 'warning');
      this.audio.play('denied');
      return;
    }
    if (mode === 'guard' && !this.ownSelected().some((e) => e.kind === 'unit' && !e.garrisonId)) {
      this.notify('Select units to guard a friendly unit.', 'warning');
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
  /* Strategic operations                                                */
  /* ------------------------------------------------------------------ */

  /** Authoritative strategic status for the local commander, or null. */
  superweaponStatus(): SuperweaponStatus | null {
    return this.game ? this.game.superweaponStatus(this.localPlayerId) : null;
  }

  /**
   * Arm the national call-in so the next map click picks the target.
   *
   * The availability answer comes from the simulation, not from the panel, so a
   * button left enabled by a stale render still cannot start an illegal
   * operation. Cancelling the mode leaves the document and the bank untouched.
   */
  beginSuperweaponTargeting(): void {
    const game = this.game;
    if (!game) return;
    const status = game.superweaponStatus(this.localPlayerId);
    if (!status.ok || !status.family) {
      this.notify(status.reason || 'No strategic capability is available.', 'warning');
      this.audio.play('denied');
      return;
    }
    this.mode = 'superweapon';
    this.notify(
      `${SUPERWEAPON_TARGET_LABEL[status.family.targeting]} Esc cancels.`,
      'info',
    );
    this.audio.play('ui');
  }

  /**
   * Resolve one map click as a strategic aim point.
   *
   * Only an aim point and an optional concrete target leave this method; the
   * simulation re-checks the target and charges the cost itself, so a refused
   * click spends nothing and a repeated click cannot buy two operations.
   */
  superweaponAtScreen(clientX: number, clientY: number): void {
    const game = this.game;
    if (!game) return;
    const status = game.superweaponStatus(this.localPlayerId);
    if (!status.ok || !status.family) {
      this.notify(status.reason || 'No strategic capability is available.', 'warning');
      this.audio.play('denied');
      return;
    }
    const point = this.worldAt(clientX, clientY);
    if (!point) return;
    // Only a hostile structure is a concrete target. A hostile unit under the
    // cursor is ignored rather than passed on: the precision strike resolves
    // the structure itself, and the area calls use the ground point.
    const pick = this.pickAt(clientX, clientY);
    const structureId =
      pick && pick.kind === 'building' && game.isHostile(pick.owner, this.localPlayerId)
        ? pick.id
        : 0;
    const check = game.superweaponTargetStatus(
      this.localPlayerId,
      status.family.id,
      point.x,
      point.z,
      structureId || undefined,
    );
    if (!check.ok) {
      this.notify(check.reason, 'warning');
      this.audio.play('denied');
      return;
    }
    this.dispatchCommand({
      type: 'superweapon',
      team: this.localPlayerId,
      familyId: status.family.id,
      x: point.x,
      z: point.z,
      ...(structureId ? { targetId: structureId } : {}),
    });
    this.audio.play('ui');
    this.mode = 'none';
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
    this.dispatchCommand({ type: 'produce', team: this.localPlayerId, buildingId, defId });
    this.audio.play('queue');
  }

  cancelProduction(buildingId: number, index: number): void {
    if (!this.game) return;
    this.dispatchCommand({ type: 'cancelProduction', team: this.localPlayerId, buildingId, index });
    this.audio.play('ui');
  }

  /**
   * Confirm a sale. The simulation owns the deconstruction clock and the
   * refund, so this only checks the same status the panel shows and dispatches.
   */
  sellBuilding(buildingId: number): void {
    if (!this.game) return;
    const status = this.game.sellStatus(this.localPlayerId, buildingId);
    if (!status.ok) {
      this.notify(status.reason, 'warning');
      this.audio.play('denied');
      return;
    }
    const e = this.game.getEntity(buildingId);
    const quote = this.game.sellQuote(buildingId);
    this.dispatchCommand({ type: 'sellBuilding', team: this.localPlayerId, buildingId });
    this.audio.play('build');
    if (e && quote) {
      this.notify(
        `${BUILDINGS[e.defId]?.name ?? e.defId} dismantling — ${quote.mats}M/${quote.req}R when it comes down.`,
        'info',
      );
    }
  }

  reorderProduction(buildingId: number, defId: string, beforeDefId: string): void {
    if (!this.game) return;
    this.dispatchCommand({
      type: 'reorderProduction',
      team: this.localPlayerId,
      buildingId,
      defId,
      beforeDefId,
    });
    this.audio.play('ui');
  }

  /**
   * Start one project at the player's operational centre.
   *
   * The UI never marks the node active itself: the command is queued (or sent
   * to the room) and the next authoritative tick owns the project. The local
   * status check only turns a known refusal into immediate feedback.
   */
  startResearch(techId: string): void {
    const game = this.game;
    if (!game) return;
    const tech = techDef(techId);
    if (!tech) {
      this.notify('That technology is not available.', 'warning');
      return;
    }
    const centreId = game.researchCentreId(this.localPlayerId);
    if (centreId === null) {
      this.notify('An operational Research Centre is required.', 'warning');
      this.audio.play('denied');
      return;
    }
    const status = game.researchStatus(this.localPlayerId, centreId, techId);
    if (!status.ok) {
      this.notify(status.reason, 'warning');
      this.audio.play('denied');
      return;
    }
    this.dispatchCommand({
      type: 'research',
      team: this.localPlayerId,
      buildingId: centreId,
      techId,
    });
    this.notify(`${tech.name} research ordered.`, 'info');
    this.audio.play('ui');
  }

  /** Cancel the player's project; the simulation owns the refund. */
  cancelResearch(): void {
    const game = this.game;
    if (!game) return;
    const centreId = game.researchCentreId(this.localPlayerId);
    if (centreId === null) {
      this.notify('An operational Research Centre is required to cancel.', 'warning');
      this.audio.play('denied');
      return;
    }
    const status = game.cancelResearchStatus(this.localPlayerId, centreId);
    if (!status.ok) {
      this.notify(status.reason, 'warning');
      this.audio.play('denied');
      return;
    }
    this.dispatchCommand({ type: 'cancelResearch', team: this.localPlayerId, buildingId: centreId });
    this.notify('Research cancelled — committed resources refunded.', 'info');
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
    this.dispatchCommand({
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

  cycleProductionTab(direction = 1): void {
    this.hud.cycleTab(direction);
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
    this.finishTutorial();
    const record = this.readSlot(slot);
    if (!record) {
      this.notify(`Slot ${slot} is empty or unreadable.`, 'warning');
      return;
    }
    try {
      const game = Game.fromSave(record.data, { localPlayerId: record.data.localPlayerId ?? 0, enableAI: true });
      this.game = game;
      this.applyUnitCamo();
      // A load is not a deployment: there is no match-start snapshot to report,
      // and the previous battle's flag must not be lent to it.
      this.matchFlag = null;
      this.matchFlagGame = null;
      this.renderer.setCommandFlag(null);
      this.applyNarrator(game);
      // A save has already passed its authored in-mission scenes; opening it
      // must not replay dialogue the player has already seen.
      this.cinematicPlayed.clear();
      this.markElapsedCinematics();
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
      this.bookmarks.clear();
      this.idleCursor.clear();
      this.lastAlert = null;
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

  /** A dropped GPU context is not a game state: hold the battle and explain. */
  private handleGraphicsContextLost(): void {
    if (this.contextPaused) return;
    this.contextPaused = this.pauseForModal();
    this.toast('Graphics context lost — rebuilding the battlefield…', 'warning');
  }

  private handleGraphicsContextRestored(): void {
    this.resize();
    this.toast('Graphics restored.', 'success');
    this.resumeAfterModal(this.contextPaused);
    this.contextPaused = false;
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
    // A campaign operation brings its own brief into battle. A skirmish still
    // names the opponent actually staged for the next deployment, so the
    // briefing never advertises a legacy force the player is not fighting.
    const run = this.screen === 'battle' ? this.campaignRun() : null;
    const opponent = run
      ? identityDef(run.mission.opponentNationId)
      : resolveOpponentNation(this.settings.nationId, this.settings.opponentNationId);
    // A mission-bearing scenario is briefed from its own structured document,
    // not from the deck's legacy one-line summary. A plain skirmish keeps the
    // original operational copy.
    const missionDoc = this.game?.state.scenario.mission ?? null;
    const missionCopy = missionDoc
      ? null
      : run
        ? run.mission.situation
        : `Establish your beachhead, grow an economy, and destroy the ${opponent.name} command post before it overruns you. Capture the neutral signals relays to fund advanced production.`;
    const objectiveMarkup = run && !missionDoc
      ? `<h4>OBJECTIVES</h4><ol class="briefing-objectives">${run.mission.objectives
          .map((objective) => `<li>${escapeHtml(objective)}</li>`)
          .join('')}</ol>`
      : '';
    const threatMarkup = run && !missionDoc
      ? `<h4>THREAT</h4><p>${escapeHtml(run.mission.threat)}</p>`
      : '';
    // The rail's objective button opens this briefing, so the live objective
    // and the tally it used to print in the sidebar belong here.
    const liveObjective =
      this.screen === 'battle' && this.game ? objectiveProgress(this.game) : null;
    const objectiveBriefMarkup = liveObjective
      ? `<h4>PRIMARY OBJECTIVE</h4>
        <p class="briefing-objective">${escapeHtml(liveObjective.primary)}</p>
        <p class="briefing-objective-progress">${escapeHtml(liveObjective.summary)}</p>`
      : '';
    // A mission's own objective tree, including the states already resolved.
    // Hidden objectives are excluded by the view, so the briefing cannot reveal
    // authored content early.
    const missionView = this.screen === 'battle' && this.game ? missionObjectiveView(this.game) : null;
    const missionObjectivesMarkup = missionView
      ? `<h4>MISSION OBJECTIVES</h4><ul class="briefing-objectives mission-objectives">${[
          ...missionView.primary,
          ...missionView.supporting,
          ...missionView.resolved,
        ]
          .map((objective) => missionObjectiveMarkup(objective))
          .join('')}</ul>`
      : '';
    openModal({
      title: run ? `${run.mission.name} — Briefing & controls` : 'Briefing & controls',
      body: `
        <div class="briefing-grid">
          <div>
            ${
              missionDoc
                ? missionBriefingMarkup(missionDoc, {
                    commander: this.campaignState()?.commander ?? null,
                    ...(run?.mission.code ? { code: run.mission.code } : {}),
                  })
                : `<h4>MISSION</h4><p>${escapeHtml(missionCopy ?? '')}</p>`
            }
            ${objectiveBriefMarkup}
            ${missionObjectivesMarkup}
            ${objectiveMarkup}
            ${threatMarkup}
            <h4>COMBINED ARMS</h4>
            <p>Ground forces decide the ridge. Strike fighters strike hard but must rearm at the airfield and respect SAM coverage. The shipyard line — fast attack craft, missile corvette and escort frigate — contests the bay and bombards the coast. Ports and airfields are physical, capturable assets.</p>
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
              <div><span>Select all army</span><kbd>Ctrl+A</kbd></div>
              <div><span>Camera bookmarks</span><kbd>Ctrl+Shift+1..4 / Shift+1..4</kbd></div>
              <div><span>Idle harvester / engineer</span><kbd>F8 / F9</kbd></div>
              <div><span>Jump to last alert</span><kbd>F2</kbd></div>
              <div><span>Briefing</span><kbd>F1</kbd></div>
              <div><span>Pan / zoom</span><kbd>Arrows / edge · wheel</kbd></div>
              <div><span>Pause / menu / speed</span><kbd>Esc · P · +/-</kbd></div>
              <div><span>Hide interface (screenshots)</span><kbd>U</kbd></div>
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

  /** Put the four facts a bug report needs on the clipboard. */
  async copyDiagnostics(): Promise<void> {
    const game = this.game;
    if (!game) {
      this.notify('Start a battle to collect battle diagnostics.', 'warning');
      return;
    }
    const text = diagnosticsText({
      mapName: game.state.scenario.meta.name,
      mapId: game.state.scenario.meta.id,
      tick: game.state.tick,
    });
    const copied = await copyText(text);
    this.notify(
      copied
        ? 'Diagnostics copied to the clipboard.'
        : 'Clipboard unavailable — the build stamp is on the pause card.',
      copied ? 'success' : 'warning',
    );
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
      onClose: () => {
        this.cancelKeyCapture();
        this.resumeAfterModal(resume);
      },
      onMount: (root) => this.bindSettingsControls(root),
    });
  }

  /**
   * Esc-menu target when the player prefers a menu to an immediate pause. It is
   * the same pause gate as Settings: closing any page of it resumes only when
   * the menu itself paused the battle, so a manual pause survives.
   */
  openPauseMenu(): void {
    if (this.screen !== 'battle' || !this.game) return;
    const resume = this.pauseForModal();
    openModal({
      title: 'Battle menu',
      body: '<p class="modal-note">The simulation is halted. Settings and saves keep it halted until you close them.</p>',
      actions: [
        // Resume is explicit: it also lifts a pause the player set with P rather
        // than only the pause this menu applied.
        { label: 'Resume', primary: true, onClick: () => this.resumeAfterModal(true) },
        {
          label: 'Settings',
          onClick: () => {
            // Close first so the pause menu's onClose cannot resume underneath
            // the settings modal; openSettings pauses again for the new page.
            closeModal();
            this.openSettings();
            return false;
          },
        },
        {
          label: 'Save battle',
          onClick: () => {
            closeModal();
            this.openSaveMenu(false);
            return false;
          },
        },
        {
          label: 'Leave battle',
          danger: true,
          onClick: () => {
            closeModal();
            this.toMenu();
            return false;
          },
        },
      ],
      onClose: () => this.resumeAfterModal(resume),
    });
  }

  /**
   * One markup source for the settings rows, shared by the in-battle modal and
   * the main-menu Settings view so the two can never drift apart. Rows are
   * grouped into tabs because the sheet grew past a comfortable single scroll.
   */
  private settingsRowsMarkup(): string {
    const s = this.settings;
    const qualityOptions = GRAPHICS_QUALITIES.map(
      (id) => `<option value="${id}" ${s.graphicsQuality === id ? 'selected' : ''}>${id[0].toUpperCase()}${id.slice(1)}</option>`,
    ).join('');
    const shadowOptions = SHADOW_DETAILS.map(
      (id) => `<option value="${id}" ${s.shadowDetail === id ? 'selected' : ''}>${SHADOW_DETAIL_LABELS[id]}</option>`,
    ).join('');
    const paletteOptions = COLOR_VISION_PALETTES.map(
      (palette) => `<option value="${palette.id}" ${s.colorVision === palette.id ? 'selected' : ''}>${palette.label}</option>`,
    ).join('');
    const displayRows = `
      <div class="setting-row"><div><label>Interface scale</label><small>HUD type, rail and sidebar sizes</small></div><div class="set-inline"><input type="range" min="${Math.round(UI_SCALE_MIN * 100)}" max="${Math.round(UI_SCALE_MAX * 100)}" step="5" value="${Math.round(s.uiScale * 100)}" data-set="uiScale"><output data-value-for="uiScale">${Math.round(s.uiScale * 100)}%</output></div></div>
      <div class="setting-row"><div><label>Colour palette</label><small>Recolours ownership, health and alerts; patterns remain</small></div><select data-choice="colorVision" aria-label="Colour-vision palette">${paletteOptions}</select></div>
      <div class="setting-row"><div><label>Graphics quality</label><small>Resolution, particles, shadows and water</small></div><select data-choice="graphicsQuality" aria-label="Graphics quality">${qualityOptions}</select></div>
      <div class="setting-row"><div><label>Shadow detail</label><small>Basic is the flat projected pass; Detailed renders real sun shadows from a depth map</small></div><select data-choice="shadowDetail" aria-label="Shadow detail">${shadowOptions}</select></div>
      <div class="setting-row"><div><label>Render scale</label><small>Share of the device pixel ratio, capped at 2×</small></div><div class="set-inline"><input type="range" min="50" max="100" step="5" value="${Math.round(s.renderScale * 100)}" data-set="renderScale"><output data-value-for="renderScale">${Math.round(s.renderScale * 100)}%</output></div></div>
      <div class="setting-row"><div><label>Frame rate</label><small>Show the live FPS badge in battle</small></div><button class="switch ${s.fpsReadout ? 'on' : ''}" data-toggle="fpsReadout"></button></div>
      <div class="setting-row"><div><label>Visual effects</label><small>Particles, smoke and tracers</small></div><button class="switch ${s.effects ? 'on' : ''}" data-toggle="effects"></button></div>
      <div class="setting-row"><div><label>Unit silhouettes</label><small>Outline a unit hidden behind a structure</small></div><button class="switch ${s.silhouettes ? 'on' : ''}" data-toggle="silhouettes"></button></div>
      <div class="setting-row"><div><label>Screen shake</label><small>Explosion camera movement</small></div><button class="switch ${s.shake ? 'on' : ''}" data-toggle="shake"></button></div>
      <div class="setting-row"><div><label>Cinematics</label><small>Authored mission scenes. Off is skip-all; progression is unaffected.</small></div><button class="switch ${s.cinematics ? 'on' : ''}" data-toggle="cinematics"></button></div>
      <div class="setting-row"><div><label>Fog of war</label><small>Visual fog; gameplay detection is unchanged</small></div><button class="switch ${s.fogVisual ? 'on' : ''}" data-toggle="fogVisual"></button></div>
      <div class="setting-row"><div><label>Night lights</label><small>Building and vehicle lights; their detection effect is unchanged</small></div><button class="switch ${s.nightLights ? 'on' : ''}" data-toggle="nightLights"></button></div>
      <div class="setting-row"><div><label>Light glow</label><small>Additive brightness of lamps and beams</small></div><div class="set-inline"><input type="range" min="0" max="150" step="5" value="${Math.round(s.lightBloom * 100)}" data-set="lightBloom"><output data-value-for="lightBloom">${Math.round(s.lightBloom * 100)}%</output></div></div>
      <div class="setting-row"><div><label>Fullscreen</label><small>Fill the screen; Esc leaves it</small></div><button class="switch ${isFullscreen() ? 'on' : ''}" data-toggle="fullscreen"></button></div>
    `;
    const keyBindingRows = BINDABLE_ACTIONS.map(
      (action) => `<div class="setting-row keybind-row"><div><label>${action.label}</label><small>Battle hotkey</small></div><button type="button" class="keybind-btn" data-bind="${action.id}" aria-label="Rebind ${action.label}: ${keyLabel(s.keyBindings[action.id])}">${keyLabel(s.keyBindings[action.id])}</button></div>`,
    ).join('');
    const inputRows = `
      <div class="setting-row"><div><label>Escape key</label><small>Outside an order mode</small></div><select data-choice="escBehavior" aria-label="Escape key behaviour"><option value="pause" ${s.escBehavior === 'pause' ? 'selected' : ''}>Pauses the battle</option><option value="menu" ${s.escBehavior === 'menu' ? 'selected' : ''}>Opens the menu</option></select></div>
      <div class="setting-row"><div><label>Edge panning</label><small>Move camera at screen edges</small></div><button class="switch ${s.edgePan ? 'on' : ''}" data-toggle="edgePan"></button></div>
      <div class="setting-row"><div><label>Edge pan width</label><small>How far in from the battlefield edge the camera starts to move</small></div><div class="set-inline"><input type="range" min="${EDGE_PAN_WIDTH_MIN}" max="${EDGE_PAN_WIDTH_MAX}" step="2" value="${Math.round(s.edgePanWidth)}" data-set="edgePanWidth"><output data-value-for="edgePanWidth">${Math.round(s.edgePanWidth)}px</output></div></div>
      <div class="setting-row"><div><label>Edge pan speed</label><small>Camera travel while the pointer sits in the band</small></div><div class="set-inline"><input type="range" min="${Math.round(EDGE_PAN_SPEED_MIN * 100)}" max="${Math.round(EDGE_PAN_SPEED_MAX * 100)}" step="5" value="${Math.round(s.edgePanSpeed * 100)}" data-set="edgePanSpeed"><output data-value-for="edgePanSpeed">${Math.round(s.edgePanSpeed * 100)}%</output></div></div>
      <div class="setting-row"><div><label>Gamepad sensitivity</label><small>Camera and cursor speed on the sticks</small></div><div class="set-inline"><input type="range" min="${Math.round(GAMEPAD_SENSITIVITY_MIN * 100)}" max="${Math.round(GAMEPAD_SENSITIVITY_MAX * 100)}" step="5" value="${Math.round(s.gamepadSensitivity * 100)}" data-set="gamepadSensitivity"><output data-value-for="gamepadSensitivity">${Math.round(s.gamepadSensitivity * 100)}%</output></div></div>
      <div class="setting-row"><div><label>Custom cursors</label><small>Animated tactical reticles for orders, placement and box selection</small></div><button class="switch ${s.customCursors ? 'on' : ''}" data-toggle="customCursors"></button></div>
      <div class="keybind-heading"><b>Battle hotkeys</b><small>Select a keycap, then press the replacement. Reserved keys and conflicts are refused.</small></div>
      <div class="keybind-list">${keyBindingRows}</div>
      <div class="setting-row"><div><label>Reset hotkeys</label><small>Restore the default battle layout</small></div><button type="button" class="keybind-reset" data-bind-reset>RESET</button></div>
      <div class="bind-status" data-bind-status role="status" aria-live="polite"></div>
    `;
    const audioRows = `
      <div class="setting-row"><div><label>Effects volume</label><small>Weapons, impacts and alerts</small></div><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-set="sfx"></div>
      <div class="setting-row"><div><label>Announcer volume</label><small>Strategic voice lines</small></div><input type="range" min="0" max="1" step="0.05" value="${s.voice}" data-set="voice"></div>
      <div class="setting-row"><div><label>Unit responses</label><small>Selection, orders and refusals</small></div><input type="range" min="0" max="1" step="0.05" value="${s.unitVoice}" data-set="unitVoice"></div>
      <div class="setting-row"><div><label>Ambience volume</label><small>Sea, wind and low drone</small></div><input type="range" min="0" max="1" step="0.05" value="${s.ambient}" data-set="ambient"></div>
      <div class="setting-row"><div><label>Music volume</label><small>Menu and battle soundtracks</small></div><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-set="music"></div>
    `;
    const musicRows = musicPanelMarkup(s.musicPlaylist, this.audio.matchMusicState);
    const tabs: { id: SettingsTab; label: string }[] = [
      { id: 'display', label: 'Display' },
      { id: 'input', label: 'Controls' },
      { id: 'audio', label: 'Audio' },
      { id: 'music', label: 'Playlist' },
    ];
    const tabBar = tabs
      .map((tab) => {
        const active = this.settingsTab === tab.id;
        return `<button type="button" class="settings-tab${active ? ' active' : ''}" data-settings-tab="${tab.id}" aria-pressed="${active}"${active ? ' aria-current="true"' : ''}>${tab.label}</button>`;
      })
      .join('');
    const panel = (id: SettingsTab, rows: string) =>
      `<section class="settings-panel" data-settings-panel="${id}" aria-label="${
        tabs.find((tab) => tab.id === id)?.label ?? id
      } settings"${this.settingsTab === id ? '' : ' hidden'}>${rows}</section>`;
    return `<div class="settings-tabs" role="group" aria-label="Settings sections">${tabBar}</div>${panel(
      'display',
      displayRows,
    )}${panel('input', inputRows)}${panel('audio', audioRows)}${panel('music', musicRows)}`;
  }

  /** Show one settings section and remember it for the next visit. */
  private showSettingsTab(tab: SettingsTab): void {
    this.cancelKeyCapture();
    this.settingsTab = tab;
    document.querySelectorAll<HTMLElement>('[data-settings-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== tab;
    });
    document.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
      const active = button.dataset.settingsTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  }

  private renderMenuSettings(): void {
    const grid = document.getElementById('menu-settings-grid');
    if (!grid) return;
    this.cancelKeyCapture();
    grid.innerHTML = this.settingsRowsMarkup();
    this.bindSettingsControls(grid);
  }

  private bindSettingsControls(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const tab = button.dataset.settingsTab;
        if (tab === 'display' || tab === 'input' || tab === 'audio' || tab === 'music') {
          this.showSettingsTab(tab);
        }
      });
    });
    root.querySelectorAll<HTMLInputElement>('[data-set]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.set;
        const raw = Number(input.value);
        if (key === 'uiScale') this.settings.uiScale = normaliseUiScale(raw / 100);
        else if (key === 'renderScale') this.settings.renderScale = normaliseRenderScale(raw / 100);
        else if (key === 'sfx' || key === 'voice' || key === 'unitVoice' || key === 'ambient' || key === 'music') {
          this.settings[key] = raw;
        }        else if (key === 'lightBloom') {
          this.settings.lightBloom = normaliseLightBloom(raw / 100);
          this.renderer.settings.lightBloom = this.settings.lightBloom;
        } else if (key === 'edgePanWidth') {
          this.settings.edgePanWidth = normaliseEdgePanWidth(raw);
        } else if (key === 'edgePanSpeed') {
          this.settings.edgePanSpeed = normaliseEdgePanSpeed(raw / 100);
        } else if (key === 'gamepadSensitivity') {
          this.settings.gamepadSensitivity = normaliseGamepadSensitivity(raw / 100);
        } else return;
        const out = root.querySelector<HTMLElement>(`[data-value-for="${key}"]`);
        if (out) out.textContent = key === 'edgePanWidth' ? `${Math.round(raw)}px` : `${Math.round(raw)}%`;
        this.saveSettings();
      });
    });
    root.querySelectorAll<HTMLSelectElement>('[data-choice]').forEach((select) => {
      select.addEventListener('change', () => {
        if (select.dataset.choice === 'graphicsQuality') {
          this.settings.graphicsQuality = normaliseGraphicsQuality(select.value);
          // A preset is a starting point: choosing one also applies its
          // recommended density, which the render-scale slider can refine.
          this.settings.renderScale = normaliseRenderScale(
            graphicsPreset(this.settings.graphicsQuality).renderScale,
          );
          // Low quality keeps the darkness but drops the additive light pass;
          // the switch can turn it back on, because it is presentation only.
          this.settings.nightLights = presetNightLights(this.settings.graphicsQuality);
          // Choosing a preset also recommends a shadow level. Detailed is an
          // explicit upgrade: no preset selects it silently.
          this.settings.shadowDetail = graphicsPreset(this.settings.graphicsQuality).shadowDetail;
          const shadowSelect = root.querySelector<HTMLSelectElement>('[data-choice="shadowDetail"]');
          if (shadowSelect) shadowSelect.value = this.settings.shadowDetail;
          const slider = root.querySelector<HTMLInputElement>('[data-set="renderScale"]');
          if (slider) slider.value = String(Math.round(this.settings.renderScale * 100));
          const out = root.querySelector<HTMLElement>('[data-value-for="renderScale"]');
          if (out) out.textContent = `${Math.round(this.settings.renderScale * 100)}%`;
        } else if (select.dataset.choice === 'shadowDetail') {
          this.settings.shadowDetail = normaliseShadowDetail(select.value);
        } else if (select.dataset.choice === 'colorVision') {
          this.settings.colorVision = normaliseColorVision(select.value);
        } else if (select.dataset.choice === 'escBehavior') {
          this.settings.escBehavior = normaliseEscBehavior(select.value);
        } else return;
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
        if (key === 'fpsReadout') {
          this.settings.fpsReadout = !this.settings.fpsReadout;
          btn.classList.toggle('on', this.settings.fpsReadout);
          btn.setAttribute('aria-pressed', this.settings.fpsReadout ? 'true' : 'false');
          this.saveSettings();
          return;
        }
        if (
          key !== 'effects' &&
          key !== 'shake' &&
          key !== 'fogVisual' &&
          key !== 'edgePan' &&
          key !== 'customCursors' &&
          key !== 'silhouettes' &&
          key !== 'nightLights' &&
          key !== 'cinematics'
        ) {
          return;
        }
        this.settings[key] = !this.settings[key];
        btn.classList.toggle('on', this.settings[key]);
        btn.setAttribute('aria-pressed', this.settings[key] ? 'true' : 'false');
        this.saveSettings();
        if (key === 'fogVisual') {
          this.renderer.settings.showFog = this.settings.fogVisual && !!this.game?.state.scenario.settings.fog;
        }
        if (key === 'silhouettes') {
          this.renderer.settings.silhouettes = this.settings.silhouettes;
        }
        if (key === 'nightLights') {
          this.renderer.settings.nightLights = this.settings.nightLights;
        }
      });
    });
    // Keep any other copy of the same controls (menu view vs. battle modal) in step.
    root.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((btn) => {
      const on = btn.dataset.toggle === 'fullscreen' ? isFullscreen() : btn.classList.contains('on');
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    this.bindKeyBindingControls(root);
    this.bindMusicControls(root);
  }

  /** Wire the controls tab's keycaps and reset button. */
  private bindKeyBindingControls(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.bind as BindableActionId;
        if (!BINDABLE_ACTIONS.some((entry) => entry.id === action)) return;
        this.beginKeyCapture(root, button, action);
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-bind-reset]').forEach((button) => {
      button.addEventListener('click', () => {
        this.cancelKeyCapture();
        this.settings.keyBindings = resetKeyBindings();
        this.saveSettings();
        this.refreshBindingButtons(root);
        this.hud.refreshKeycaps();
        const status = root.querySelector<HTMLElement>('[data-bind-status]');
        if (status) status.textContent = 'Hotkeys reset to their defaults.';
      });
    });
  }

  /** Rewrite every visible keycap from the current action map. */
  private refreshBindingButtons(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((button) => {
      const action = button.dataset.bind as BindableActionId;
      if (!BINDABLE_ACTIONS.some((entry) => entry.id === action)) return;
      const label = keyLabel(this.settings.keyBindings[action]);
      button.textContent = label;
      button.classList.remove('listening');
      button.setAttribute('aria-label', `Rebind ${actionLabel(action)}: ${label}`);
    });
  }

  /**
   * Capture one physical key for an action. A window listener runs before the
   * battle input controller (the settings page is modal, so that controller is
   * already inert) and Escape always cancels without closing the page.
   */
  private beginKeyCapture(
    root: HTMLElement,
    button: HTMLButtonElement,
    action: BindableActionId,
  ): void {
    this.cancelKeyCapture();
    const status = root.querySelector<HTMLElement>('[data-bind-status]');
    button.classList.add('listening');
    button.textContent = 'PRESS A KEY';
    if (status) status.textContent = 'Press a key, or Escape to cancel.';
    const controller = new AbortController();
    this.bindingCapture = controller;
    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        this.cancelKeyCapture();
        if (status) status.textContent = 'Rebind cancelled.';
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        if (status) status.textContent = 'Release the modifier keys and press one key.';
        return;
      }
      const result = assignKeyBinding(this.settings.keyBindings, action, event.code);
      if (!result.ok) {
        if (status) {
          status.textContent =
            result.conflict.kind === 'conflict'
              ? `${keyLabel(event.code)} is already used by ${actionLabel(result.conflict.action)}.`
              : 'That key is reserved for camera, groups or system controls.';
        }
        return;
      }
      this.settings.keyBindings = result.bindings;
      this.saveSettings();
      controller.abort();
      if (this.bindingCapture === controller) this.bindingCapture = null;
      this.refreshBindingButtons(root);
      this.hud.refreshKeycaps();
      if (status) status.textContent = `${actionLabel(action)} is now ${keyLabel(event.code)}.`;
    };
    window.addEventListener('keydown', onKey, { capture: true, signal: controller.signal });
  }

  /** Drop a pending rebind, e.g. when the player leaves the Controls tab. */
  private cancelKeyCapture(): void {
    this.bindingCapture?.abort();
    this.bindingCapture = null;
    document.querySelectorAll<HTMLButtonElement>('[data-bind].listening').forEach((button) => {
      const action = button.dataset.bind as BindableActionId;
      if (!BINDABLE_ACTIONS.some((entry) => entry.id === action)) return;
      button.textContent = keyLabel(this.settings.keyBindings[action]);
      button.classList.remove('listening');
    });
  }

  /**
   * Battle playlist controls. Every change rewrites only the playlist field,
   * persists the whole settings blob through the existing path, and lets the
   * controller decide whether the current track may keep playing.
   */
  private bindMusicControls(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>('[data-music-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.musicToggle;
        if (!id) return;
        this.audio.play('ui');
        const enabled = this.settings.musicPlaylist.enabled.includes(id);
        this.commitMusicPlaylist(
          setMusicTrackEnabled(this.settings.musicPlaylist, id, !enabled),
        );
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-music-move]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.musicMove;
        if (!id) return;
        const direction: -1 | 1 = button.dataset.direction === '1' ? 1 : -1;
        this.commitMusicPlaylist(moveMusicTrack(this.settings.musicPlaylist, id, direction));
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-music-preview]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.musicPreview;
        if (!id) return;
        this.audio.init();
        this.audio.play('ui');
        this.audio.previewMatchTrack(id);
        this.syncMusicPlaybackUi();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-music-transport]').forEach((button) => {
      button.addEventListener('click', () => {
        this.audio.init();
        this.audio.play('ui');
        const action = button.dataset.musicTransport;
        if (action === 'previous') this.audio.previousMatchTrack();
        else if (action === 'next') this.audio.nextMatchTrack();
        else if (action === 'toggle') this.audio.toggleMatchPause();
        this.syncMusicPlaybackUi();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-music-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const shuffle = button.dataset.musicMode === 'shuffle';
        if (shuffle === this.settings.musicPlaylist.shuffle) return;
        this.commitMusicPlaylist(setMusicShuffle(this.settings.musicPlaylist, shuffle));
      });
    });
    root.querySelectorAll<HTMLSelectElement>('[data-music-repeat]').forEach((select) => {
      select.addEventListener('change', () => {
        this.commitMusicPlaylist(
          setMusicRepeat(this.settings.musicPlaylist, select.value as MusicRepeatMode),
        );
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-music-defaults]').forEach((button) => {
      button.addEventListener('click', () => {
        this.audio.play('ui');
        this.commitMusicPlaylist(restoreDefaultMusicPlaylist());
      });
    });
    this.syncMusicPlaybackUi();
  }

  private commitMusicPlaylist(next: MusicPlaylistPreferences): void {
    this.settings.musicPlaylist = normaliseMusicPlaylist(next);
    this.audio.setMusicPlaylist(this.settings.musicPlaylist);
    this.saveSettings();
    this.syncMusicPlaybackUi();
  }

  /** Refresh every open settings sheet (menu view and/or battle modal). */
  private syncMusicPlaybackUi(): void {
    const preferences = this.settings.musicPlaylist;
    const state = this.audio.matchMusicState;
    document
      .querySelectorAll<HTMLElement>('[data-music-panel]')
      .forEach((panel) => syncMusicPanel(panel, preferences, state));
  }

  /**
   * Every Fullscreen switch — the menu Settings view and the in-battle modal —
   * follows the live document state, including leaving with Esc.
   */
  /** The one automatic fullscreen request, refused on touch and immersive windows. */
  private enterIntroFullscreen(): void {
    const query = (value: string): boolean =>
      typeof window.matchMedia === 'function' && window.matchMedia(value).matches;
    const wanted = wantsAutomaticFullscreen({
      coarsePointer: query('(pointer: coarse)'),
      alreadyImmersive: isFullscreen() || query('(display-mode: fullscreen)'),
    });
    if (!wanted) return;
    void enterFullscreen().then(() => this.syncFullscreenControls());
  }

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
    this.missionTestScenario = null;
    this.victoryShown = 'none';
    this.finishTutorial();
    this.audio.init();
    this.audio.stopMenuMusic();
    this.audio.stopMatchMusic();
    this.audio.stopAmbience();
    this.stopAttract();
    this.menuScenario = null;
    document.getElementById('menu-screen')?.classList.add('hidden');
    this.hud.unmount();
    this.screen = 'editor';
    this.setMenuMode(false);
    this.game = null;
    this.overlay.clear();
    this.renderer.setGame(null);
    this.renderer.setCommandFlag(null);
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
  /* Mission authoring test runs                                         */
  /* ------------------------------------------------------------------ */

  /** True while the battle on screen is a workbench test, not a campaign run. */
  get missionTestActive(): boolean {
    return this.missionTestScenario !== null;
  }

  /** Commander identity for briefing/dossier previews. */
  missionCommander(): CommanderIdentity | null {
    return this.campaignState()?.commander ?? null;
  }

  /**
   * Run the working mission through the real simulation without touching the
   * campaign. The campaign marker is stripped from the copy, which is the same
   * boundary multiplayer and skirmish use for mission-free scenarios.
   */
  async startMissionTest(scenario: Scenario, section?: MissionSection): Promise<void> {
    const test = cloneScenario(scenario);
    delete test.meta.campaign;
    // Callers that close the workbench first pass the section in; otherwise it
    // is still readable from the open panel.
    this.missionTestSection = section ?? this.editor.missionWorkbenchSection;
    this.editor.close();
    await this.startBattle(test, { missionTest: true });
    if (this.screen !== 'battle') {
      // Validation failed before the battle opened: return to the document
      // rather than leaving the author on a closed Forge.
      this.missionTestScenario = null;
      this.openEditor(scenario);
      this.editor.openMissionWorkbench(this.missionTestSection ?? undefined);
    }
  }

  /** Leave the result screen of a test run and restore the authoring document. */
  returnToMissionWorkbench(): void {
    const scenario = this.missionTestScenario;
    if (!scenario) return;
    this.missionTestScenario = null;
    this.openEditor(scenario);
    this.editor.openMissionWorkbench(this.missionTestSection ?? 'validation');
    this.missionTestSection = null;
  }

  /** Play an authored sequence inside the Forge without executing mission code. */
  previewCinematicFromEditor(doc: MissionCinematicDoc): void {
    if (!this.editor.active) return;
    this.menuScenario = this.editor.scenario;
    this.cinematicPreview = true;
    const played = this.playCinematic(
      doc,
      'opening',
      'CINEMATIC PREVIEW',
      this.editor.scenario.mission?.title ?? this.editor.scenario.meta.name,
      true,
    );
    if (!played) {
      this.cinematicPreview = false;
      this.menuScenario = null;
      this.notify('A scene is already playing.', 'warning');
    }
  }

  /* ------------------------------------------------------------------ */
  /* UI plumbing                                                         */
  /* ------------------------------------------------------------------ */

  toast(
    text: string,
    level: 'info' | 'warning' | 'critical' | 'success' = 'info',
    target?: { x?: number; z?: number; entityId?: number; tick?: number },
  ): void {
    this.notify(text, level);
    if (this.screen === 'battle') {
      this.hud.log(text, level, target?.tick ?? this.game?.state.tick ?? 0, target);
    }
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
    // A critical alert is also a place on the map: the toast becomes the
    // shortcut back to it, matching the F2 hotkey.
    if (level === 'critical' && this.lastAlert && this.screen === 'battle') {
      el.classList.add('clickable');
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.title = 'Jump to the last alert (F2)';
      const jump = () => {
        this.jumpToLastAlert();
        el.remove();
      };
      el.addEventListener('click', jump);
      el.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        jump();
      });
    }
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
    this.cursorLayer.resize();
    const maxX = this.overlay.width;
    const maxY = this.overlay.height;
    if (this.padCursor.x === 0 && this.padCursor.y === 0) {
      this.padCursor.x = maxX / 2;
      this.padCursor.y = maxY / 2;
    }
    void maxY;
  }
}
