import {
  ELEVATION_HEIGHT,
  HARVESTER_CAPACITY,
  MAX_QUEUE,
  PLAYER,
  REPAIR_SUPPRESSION_TICKS,
  TICK_RATE,
  TILE_SIZE,
  VISION_INTERVAL,
} from './constants';
import { angleTo, dist, dist2, normalizeAngle, rotateLocalOffset, turnToward, clamp } from '../core/math';
import { muzzleHeight, muzzleReach, muzzleWorldOffset } from './hardpoints';
import { Rng } from '../core/rng';
import {
  BUILDINGS,
  buildingFamily,
  buildingRequirements,
  isIndestructibleStructure,
} from '../data/buildings';
import { UNITS, unitFamily } from '../data/units';
import { WEAPONS } from '../data/weapons';
import {
  RESEARCH,
  TIER_ZERO_BUILDINGS,
  TIER_ZERO_UNITS,
  buildingModuleDef,
  exclusiveUnitTech,
  installedModuleEffects,
  resolveResearchUnlocks,
  requiredTechnologiesForBuilding,
  requiredTechnologiesForUnit,
  techDef,
  techDisplayName,
  unitDefinitionAvailable,
  unitUpgradeDef,
  upgradesForSlot,
  modulesForSlot,
  type BuildingModuleDef,
  type ResearchCatalog,
  type ResearchUnlocks,
  type TechDef,
  type UnitUpgradeDef,
} from '../data/research';
import {
  TERRAIN,
  Terrain,
  canStandOn,
  inBounds,
  moveCost,
  terrainName,
  tileConcealment,
  tileIndex,
  worldToTile,
  type TerrainId,
} from './terrain';
import { buildingDef } from '../data/buildings';
import { unitDef } from '../data/units';
import { findPath, nearestWalkable, type NavGrid } from './pathfinding';
import { NavBatch, type NavBatchMember } from './navBatch';
import {
  adjacentWater,
  checkPlacement,
  waterFacingFor,
  type Scenario,
  type ScenarioRestrictions,
  type ScenarioStructure,
} from './scenario';
import { createRuntimeMap, footprintCenter, stampFootprint } from './map';
import { TUTORIAL_SCENARIO_ID } from '../data/tutorial';
import {
  dayNightAt,
  type DayNightState,
} from './dayNight';
import { weatherFor, weatherSpeedFactor, type WeatherProfile } from './weather';
import {
  ILLUMINATED_TARGET_BONUS,
  collectLightSources,
  illuminationAt,
  illuminationGrid as buildIlluminationGrid,
  type LightSource,
} from './illumination';
import {
  accuracyFactor,
  acquireTicksFor,
  engagementFactor,
  sensorFor,
  visionFactor,
} from './sensors';
import { awardCombatXp, rankOf } from './veterancy';
import {
  MissionRuntime,
  buildMissionResult,
  evaluateMissionTriggers,
  type MissionObjectiveChange,
  type MissionOutcome,
  type MissionResult,
  type MissionTransitionResult,
} from '../mission';

/**
 * What one replacement drop-off costs. A base with no refinery and less than
 * this in the bank cannot buy its way back into the hauling economy, which is
 * the state the headquarters lifeline exists for.
 */
const REFINERY_REPLACEMENT_COST = Math.min(
  ...Object.values(BUILDINGS)
    .filter((def) => def.refinery)
    .map((def) => def.cost.mats),
);

import {
  canWeaponTarget,
  weaponCanHurt,
  computeDamage,
  coverFactor,
  entityArmour,
  entityName,
  entityTargetClass,
  entityVision,
  entityWeapons,
  hasLineOfSight,
  usesPrimaryAmmo,
} from './combat';
import {
  buildingSlotId,
  productionEntries as rosterProductionEntries,
  resolveRoster,
  rosterIncludes,
  unitSlotId,
} from '../data/roster';
import { tryIdentityDef, NATIONS } from '../data/factions';
import { abilityForUpgrade } from '../data/abilities';
import {
  SUPERWEAPON_FAMILIES,
  isSuperweaponFamilyId,
  superweaponPresentation,
  type SuperweaponFamilyDef,
  type SuperweaponFamilyId,
} from '../data/superweapons';
import {
  cooldownSeconds,
  createSuperweaponState,
  ewRangeFactor,
  ewScanFactor,
  ewVisionFactor,
  operationCountdown,
  operationPhase,
  salvoPoints,
  type SuperweaponStatus,
} from './superweapons';
import { AIController, initialAIState } from './ai';
import { structureBenefit } from './infrastructure';
import {
  SAVE_FORMAT,
  SAVE_FORMAT_VERSION,
  type SaveData,
} from './save';
import { migrateSave } from './saveMigrations';
import type {
  Command,
  Entity,
  GameState,
  ImpactSurface,
  PlayerState,
  PlayerSuperweaponState,
  PowerStatus,
  Projectile,
  SimEvent,
  SimEventCode,
  SimEventType,
  UnitDef,
  VictoryState,
  WeaponDef,
  AIControlState,
  AIDifficulty,
  ChartedStructure,
  ContactRecord,
  ContactBand,
  ContactState,
  PathPoint,
  SmokeCloud,
  VisionState,
} from './types';

import { CONTACT_DETECTED_TICKS, CONTACT_EXPIRE_TICKS } from './contacts';

export interface GameOptions {
  localPlayerId?: number;
  enableAI?: boolean;
  /** Load path: skip scenario spawning. */
  skipInit?: boolean;
  /**
   * Per-match seed for the AI commander. Tests and saves default to the
   * scenario seed; the shell passes a fresh value for each new battle so two
   * matches on the same map do not field the identical opening.
   */
  aiSeed?: number;
  /** Selected opponent strength for a new battle; saves keep their own. */
  aiDifficulty?: AIDifficulty;
  /**
   * Experiment-only switch for the Phase 9 replication: disables the rule that
   * suspends engineer repair while a structure is under fire. Production code
   * never sets it, so the shipped default is the Phase 8 behaviour. Not saved
   * and never read from a scenario, so it cannot change a normal match or a
   * save file.
   */
  repairSuppression?: boolean;
  /**
   * Research data for this match. Production always uses the shipped catalog;
   * tests and, later, a modding path can supply a fixture without mutating the
   * default. The catalog is static data and is never serialised.
   */
  research?: ResearchCatalog;
}

export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFormatError';
  }
}

const AIRCRAFT_ALTITUDE = 13;

/** Electronic-attack sight and range penalties, from the family catalogue. */
const EW_EFFECT =
  SUPERWEAPON_FAMILIES.ew.effect.kind === 'ew' ? SUPERWEAPON_FAMILIES.ew.effect : undefined;
/** An assigned engineer has to be this close to the site to advance it. */
const ENGINEER_WORK_RANGE = 5 * TILE_SIZE;
/** Fraction of a structure's maximum HP restored per engineer per second. */
const ENGINEER_REPAIR_RATE = 0.035;
/** A medic treats one wounded infantryman inside this radius. */
const MEDIC_HEAL_RANGE = 5 * TILE_SIZE;
/** Hit points restored per second to that one patient. */
const MEDIC_HEAL_RATE = 4;
const BUILD_RADIUS = 11;
/**
 * Below this fraction of its maximum integrity a shelter is no longer tenable:
 * the occupants are driven out and nobody may re-enter until it is repaired.
 */
const GARRISON_ABANDON_FRACTION = 0.25;
/**
 * Door rules are measured from the *wall*, not the building centre: a unit is
 * at the door once it is within this many world units of the footprint edge.
 * That keeps a tenement and a hovel equally easy to walk into, and leaves room
 * for the movement code's arrival radius so a unit is never stranded a step
 * short of the range it was ordered into.
 */
const GARRISON_ENTRY_CLEARANCE = 1.75 * TILE_SIZE;
/** Widest gap from a wall that still counts as an approach tile. */
const GARRISON_APPROACH_CLEARANCE = 1.5 * TILE_SIZE;
/** Ticks a garrison order may spend without progress before it gives up. */
const GARRISON_APPROACH_BUDGET = 60;
/**
 * How close a harvester must stand to a deposit's tile centre to mine it. One
 * place, because the reroute check and the mining check must agree: a route that
 * ends outside this radius can never start mining.
 */
const HARVEST_REACH = 3.5;
/**
 * Ticks a moving unit may fail to advance before its order is reported as
 * impossible. A jam behind a friendly hull, a closed gate or a vehicle waiting
 * for its turn costs a couple of seconds; only a genuinely walled-in hull should
 * ever produce the "cannot reach" warning, so the grace is generous.
 */
const STUCK_GIVE_UP_TICKS = 90;
/** Ticks a hauler may spend failing to close on a seam before it gives it up. */
const HARVEST_APPROACH_PATIENCE = 60;
/** How far from a walled-off aim the platoon may be walked before refusing. */
const REACHABLE_AIM_SEARCH = 4;
/** Route probes per ring when hunting for reachable ground near an aim. */
const REACHABLE_AIM_PROBES = 5;

export class Game {
  state: GameState;
  rng: Rng;
  blocked: Uint8Array;
  /** Entity ids visible to each player id (rebuilt during vision refresh). */
  visible: Set<number>[];
  localPlayerId: number;
  pending: Command[] = [];
  ai: AIController | null = null;
  /**
   * Mission runtime for a mission-bearing scenario; null for skirmish and
   * multiplayer. It is inert in this stage: it owns state, not behaviour.
   */
  mission: MissionRuntime | null = null;
  private byId = new Map<number, Entity>();
  /** Fast lookup over `state.charted`, keyed "team:entityId". */
  private chartedIndex = new Set<string>();
  private incomeSamples = 0;
  private lastMatsSample: number[] = [];
  /** Last grid state announced per owner; presentation-only, never saved. */
  private gridBrownout = new Map<number, boolean>();
  /** Coalesces under-attack alerts; presentation-only and never saved. */
  private lastAttackNotice = new Map<'base' | 'forces', number>();
  /** Not serialised; used for diagnostics and renderer consumption. */
  eventsSince = 0;
  /**
   * Authoritative time of day, cached by tick so a frame cannot see two clocks.
   * Presentation reads this; nothing may set it.
   */
  private dayNightCache: { tick: number; state: DayNightState } | null = null;
  /** Authored weather for this battle; constant, so cached against the settings. */
  private weatherCache: { settings: unknown; profile: WeatherProfile } | null = null;
  /** Lights burning at the last vision refresh; presentation reads the same list. */
  private lightSources: LightSource[] = [];
  private litGrid: Float32Array | null = null;
  /**
   * Ground and height with every standing bridge deck laid over the water.
   * Null while the map has no span, so an ordinary battle never pays for the
   * copy. Rebuilt only when a span is added, dropped or re-decked.
   */
  private deckTerrain: Uint8Array | null = null;
  private deckElevation: Uint8Array | null = null;
  private deckMask: Uint8Array | null = null;
  private deckDirty = true;
  /** Whether incoming fire suspends engineer repair (Phase 8 rule; always true in play). */
  private readonly repairSuppression: boolean;
  /** Static technology, upgrade and module catalogue for this match. */
  readonly research: ResearchCatalog;

  constructor(scenario: Scenario, opts: GameOptions = {}) {
    this.localPlayerId = opts.localPlayerId ?? PLAYER;
    this.repairSuppression = opts.repairSuppression !== false;
    this.research = opts.research ?? RESEARCH;
    this.state = {
      scenario,
      map: createRuntimeMap(scenario),
      tick: 0,
      seed: scenario.settings.seed >>> 0,
      rngState: scenario.settings.seed >>> 0,
      nextEntityId: 1,
      nextProjectileId: 1,
      eventSeq: 1,
      players: [],
      entities: [],
      projectiles: [],
      events: [],
      victory: 'playing',
      startedAtTick: 0,
      fog: [],
      ai: this.createAIState(
        (opts.aiSeed ?? scenario.settings.seed) >>> 0,
        opts.aiDifficulty ?? 'veteran',
      ),
      contacts: [],
      charted: [],
      commandCount: 0,
      smoke: [],
      nextSmokeId: 1,
      mission: null,
      ready: false,
    };
    // The scenario already parsed and validated its mission, so the simulation
    // never sees raw JSON. Skirmishes stay on the old path with no runtime.
    if (scenario.mission) {
      this.mission = MissionRuntime.fromDoc(scenario.mission);
      this.state.mission = this.mission.state;
    }
    this.rng = new Rng(this.state.seed);
    this.blocked = new Uint8Array(scenario.width * scenario.height);
    this.visible = [[], []].map(() => new Set<number>());
    this.state.fog = [0, 1].map(() => new Uint8Array(scenario.width * scenario.height));
    if (!opts.skipInit) this.initialize();
    if (opts.enableAI !== false) this.ai = new AIController();
  }

  private createAIState(
    aiSeed: number,
    difficulty: AIDifficulty = 'veteran',
  ): AIControlState {
    return initialAIState(aiSeed, difficulty);
  }

  /**
   * The match clock. Derived purely from the authoritative tick and the
   * scenario's authored start, so every peer, every reconnect and every restored
   * snapshot agree without exchanging time messages.
   */
  get dayNight(): DayNightState {
    const tick = this.state.tick;
    if (this.dayNightCache?.tick === tick) return this.dayNightCache.state;
    const state = dayNightAt(tick, {
      startHour: this.state.scenario.settings.startHour,
      dayLengthMinutes: this.state.scenario.settings.dayLengthMinutes,
    });
    this.dayNightCache = { tick, state };
    return state;
  }

  /**
   * Weather for this battle. Authored on the scenario and constant, so it is
   * resolved once per scenario rather than once per unit per tick. Both peers
   * build the same profile from the same scenario data, which is why weather
   * needs no part of the multiplayer stream.
   */
  get weather(): WeatherProfile {
    const settings = this.state.scenario.settings;
    if (this.weatherCache && this.weatherCache.settings === settings) {
      return this.weatherCache.profile;
    }
    const profile = weatherFor(settings.weather);
    this.weatherCache = { settings, profile };
    return profile;
  }

  /** Lights as of the last vision refresh. Presentation only. */
  get lights(): readonly LightSource[] {
    return this.lightSources;
  }

  /** Illumination grid as of the last vision refresh, or null in daylight. */
  get illumination(): Float32Array | null {
    return this.litGrid;
  }

  private initialize(): void {
    const scenario = this.state.scenario;
    for (const p of scenario.players) {
      const player: PlayerState = {
        id: p.id,
        name: p.name,
        factionId: p.factionId,
        team: p.team,
        isAI: p.isAI,
        mats: scenario.settings.startingMats,
        req: scenario.settings.startingReq,
        stats: { matsGathered: 0, unitsBuilt: 0, unitsLost: 0, kills: 0, buildingsBuilt: 0 },
        incomeHistory: new Array(60).fill(0),
        defeated: false,
        relayCount: 0,
        research: { completed: [], project: null },
        superweapon: createSuperweaponState(),
      };
      this.state.players.push(player);
    }
    // Structures first so unit homes can be resolved.
    for (const s of scenario.structures) {
      this.spawnStructure(s);
    }
    for (const u of scenario.units) {
      const x = (u.x + 0.5) * TILE_SIZE;
      const z = (u.z + 0.5) * TILE_SIZE;
      this.spawnUnit(u.owner, u.defId, x, z, {
        starting: true,
        ...(u.key ? { authoredKey: u.key } : {}),
      });
    }
    this.grantScenarioResearch();
    this.blocked.fill(0);
    for (const e of this.state.entities) {
      if (e.kind === 'building') {
        const def = BUILDINGS[e.defId];
        const tx = Math.round(e.x / TILE_SIZE - def.footprint.w / 2);
        const tz = Math.round(e.z / TILE_SIZE - def.footprint.h / 2);
        // A deck is crossed, not walked around: only a dropped span blocks.
        stampFootprint(this.blocked, this.state.map, e.defId, tx, tz, def.walkable && e.hp > 0 ? 0 : 1);
      }
    }
    this.deckDirty = true;
    // The opening notice points at the human landing force. The AI is not given
    // this position: targetKnown stays false until a contact is recorded.
    const target = scenario.players.find((p) => !p.isAI) ?? scenario.players[0];
    this.lastMatsSample = this.state.players.map((p) => p.stats.matsGathered);
    this.state.ready = true;
    this.refreshVision(true);
    this.emit('notice', {
      team: this.localPlayerId,
      x: (target.startX + 0.5) * TILE_SIZE,
      z: (target.startZ + 0.5) * TILE_SIZE,
      text: `${scenario.meta.name} — ${this.objectiveText()}`,
      level: 'info',
      sound: 'start',
    });
  }

  private objectiveText(): string {
    if (this.state.scenario.meta.id === TUTORIAL_SCENARIO_ID) {
      return 'Complete the training lanes.';
    }
    if (this.state.scenario.settings.victory === 'annihilation') {
      return 'Destroy every enemy unit and structure.';
    }
    return 'Destroy the enemy Command Post to win the battle.';
  }

  /* ------------------------------------------------------------------ */
  /* Entity creation                                                    */
  /* ------------------------------------------------------------------ */

  private baseEntity(kind: Entity['kind'], defId: string, owner: number, x: number, z: number, hp: number): Entity {
    return {
      id: this.state.nextEntityId++,
      kind,
      defId,
      owner,
      x,
      z,
      hp,
      maxHp: hp,
      facing: Math.PI * 0.5,
      turretFacing: Math.PI * 0.5,
      state: 'idle',
      order: null,
      path: [],
      pathIndex: 0,
      cooldown: 0,
      targetId: 0,
      ammo: 0,
      maxAmmo: 0,
      fuel: 0,
      maxFuel: 0,
      stance: 'aggressive',
      suppression: 0,
      lastHitTick: -9999,
      kills: 0,
      xp: 0,
      buildProgress: 1,
      construction: false,
      queue: [],
      rallyX: x,
      rallyZ: z,
      homeId: 0,
      destX: x,
      destZ: z,
      guardX: x,
      guardZ: z,
      blockedTicks: 0,
      aimTargetId: 0,
      captureTargetId: 0,
      captureProgress: 0,
      healTargetId: 0,
      buildTargetId: 0,
      repairTargetId: 0,
      garrisonId: 0,
      aiGroup: 0,
      aiRole: '',
    };
  }

  private spawnUnit(
    owner: number,
    defId: string,
    x: number,
    z: number,
    opts: { starting?: boolean; free?: boolean; authoredKey?: string } = {},
  ): Entity {
    const def = unitDef(defId);
    const hp = def.hp;
    const e = this.baseEntity('unit', defId, owner, x, z, hp);
    if (opts.authoredKey) e.authoredKey = opts.authoredKey;
    e.facing = Math.atan2(this.state.map.height * TILE_SIZE * 0.5 - z, this.state.map.width * TILE_SIZE * 0.5 - x);
    e.turretFacing = e.facing;
    e.destX = x;
    e.destZ = z;
    e.guardX = x;
    e.guardZ = z;
    e.maxAmmo = def.ammo ?? 0;
    e.ammo = def.ammo ?? 0;
    e.maxFuel = def.fuel ?? 0;
    e.fuel = def.fuel ?? 0;
    if (defId === 'harvester') {
      e.harvester = {
        phase: 'seek',
        ore: 0,
        timer: 0,
        oreTileX: -1,
        oreTileZ: -1,
        refineId: 0,
      };
    }
    if (def.domain === 'air') {
      const home = this.nearestOwnedBuilding(owner, (b) => !!BUILDINGS[b.defId]?.airfield, x, z);
      e.homeId = home?.id ?? 0;
      e.aircraft = {
        homeId: e.homeId,
        // Scenario aircraft begin parked and fully armed; produced aircraft
        // launch immediately and recover when fuel or missiles run low.
        landed: !!opts.starting,
        serviceTimer: 0,
        serviceTotal: 8,
        returningHome: false,
      };
      if (opts.starting) e.state = 'grounded';
      if (home) {
        e.homeId = home.id;
        // Start aircraft in the pattern above the airfield.
        e.x = home.x;
        e.z = home.z;
        e.destX = e.x;
        e.destZ = e.z;
      }
    }
    if (def.domain === 'naval') {
      const home = this.nearestOwnedBuilding(owner, (b) => !!BUILDINGS[b.defId]?.shipyard, x, z);
      e.homeId = home?.id ?? 0;
      e.state = 'idle';
    }
    if (def.submarine) {
      e.submarine = {
        dived: false,
        battery: def.submarine.batterySeconds,
        maxBattery: def.submarine.batterySeconds,
        revealTimer: 0,
        revealed: false,
      };
    }
    this.addEntity(e);
    if (!opts.starting) {
      const player = this.player(owner);
      if (player) player.stats.unitsBuilt++;
      this.emit('unitBuilt', { team: owner, x, z, text: `${def.name} ready`, entityId: e.id, defId, level: 'info' });
    }
    return e;
  }

  private spawnStructure(s: ScenarioStructure, construction = false): Entity {
    const def = buildingDef(s.defId);
    const center = footprintCenter(s.defId, s.x, s.z);
    const hp = construction ? Math.round(def.hp * 0.2) : def.hp;
    const e = this.baseEntity('building', s.defId, s.owner, center.x, center.z, hp);
    if (s.key) e.authoredKey = s.key;
    // A yard turns its slipway toward its harbour so the gate, the berth and
    // the hulls all agree. Authored facing wins; otherwise it is read off the
    // coastline, which is deterministic for a given map and position.
    const facing = s.facing ?? (def.requiresWater ? waterFacingFor(this.state.scenario, s) : 0);
    e.facing = facing;
    e.turretFacing = facing;
    e.ammo = 0;
    e.maxAmmo = 0;
    e.buildProgress = construction ? 0 : 1;
    e.construction = construction;
    e.state = construction ? 'constructing' : 'idle';
    // Default rally directly in front of the gate, which is local +Z rotated
    // by the structure's facing.
    const frontReach = (def.footprint.h / 2 + 2) * TILE_SIZE;
    e.rallyX = center.x - Math.sin(facing) * frontReach;
    e.rallyZ = center.z + Math.cos(facing) * frontReach;
    if (def.produces === 'naval') {
      // Hulls can only gather on open water, so a new yard rallies into the sea
      // beside its gate instead of onto the beach behind it.
      const water = this.adjacentRallyWater(s, facing);
      if (water) {
        e.rallyX = water.x;
        e.rallyZ = water.z;
      }
    }
    e.destX = center.x;
    e.destZ = center.z;
    e.guardX = center.x;
    e.guardZ = center.z;
    this.addEntity(e);
    stampFootprint(this.blocked, this.state.map, s.defId, s.x, s.z, def.walkable ? 0 : 1);
    if (def.walkable) this.deckDirty = true;
    if (s.owner >= 0) {
      const player = this.player(s.owner);
      if (player && !construction) player.stats.buildingsBuilt++;
    }
    if (def.capturable) {
      // Anchors authored objectives visually even when neutral.
      e.aiRole = def.id === 'relay' ? 'relay' : 'objective';
    }
    return e;
  }

  /**
   * Nearest navigable tile beside a naval structure, used to seed its rally
   * point. Deterministic: distance first, then tile order, so saves replay it.
   */
  private adjacentRallyWater(
    s: ScenarioStructure,
    facing: number,
  ): { x: number; z: number } | null {
    const def = BUILDINGS[s.defId];
    if (!def) return null;
    const water = adjacentWater(this.state.scenario, s);
    if (water.length === 0) return null;
    const center = footprintCenter(s.defId, s.x, s.z);
    const reach = (Math.max(def.footprint.w, def.footprint.h) / 2 + 2) * TILE_SIZE;
    const cx = center.x - Math.sin(facing) * reach;
    const cz = center.z + Math.cos(facing) * reach;
    const best = [...water].sort((a, b) => {
      const da = dist2((a.x + 0.5) * TILE_SIZE, (a.z + 0.5) * TILE_SIZE, cx, cz);
      const db = dist2((b.x + 0.5) * TILE_SIZE, (b.z + 0.5) * TILE_SIZE, cx, cz);
      return da - db || a.z - b.z || a.x - b.x;
    })[0];
    return { x: (best.x + 0.5) * TILE_SIZE, z: (best.z + 0.5) * TILE_SIZE };
  }

  private addEntity(e: Entity): void {
    this.state.entities.push(e);
    this.byId.set(e.id, e);
  }

  getEntity(id: number): Entity | undefined {
    return this.byId.get(id);
  }

  player(id: number): PlayerState | undefined {
    return this.state.players.find((p) => p.id === id);
  }

  /**
   * The content a player may field, resolved from the player's faction or
   * nation id. Rosters are frozen and cached, so this is safe to call from a
   * render pass; it is also the single membership rule the simulation uses.
   */
  rosterFor(owner: number) {
    const p = this.player(owner);
    if (!p) throw new Error(`No player ${owner} to resolve a roster for.`);
    return resolveRoster(p.factionId);
  }

  /** Whether the player's resolved roster contains a unit definition. */
  canProduce(owner: number, defId: string): boolean {
    return rosterIncludes(this.rosterFor(owner), 'unit', defId);
  }

  /** Whether the player's resolved roster contains a structure definition. */
  canBuild(owner: number, defId: string): boolean {
    return rosterIncludes(this.rosterFor(owner), 'building', defId);
  }

  /**
   * Structure families that still block this structure, in declaration order,
   * resolved to the names this player would actually field. Only operational
   * structures count: a foundation does not satisfy a gate, and losing the
   * prerequisite closes the tier again. Presentation-only callers get the same
   * answer the placement command will give them.
   */
  missingTech(owner: number, defId: string): Array<{ family: string; defId: string; name: string }> {
    const required = buildingRequirements(defId);
    if (required.length === 0) return [];
    const complete = new Set(
      this.state.entities
        .filter((e) => e.owner === owner && e.kind === 'building' && e.hp > 0 && !e.construction)
        .map((e) => buildingFamily(e.defId)),
    );
    const roster = this.rosterFor(owner);
    return required
      .filter((family) => !complete.has(family))
      .map((family) => {
        const actual = buildingSlotId(roster, family) ?? family;
        return { family, defId: actual, name: BUILDINGS[actual]?.name ?? family };
      });
  }

  /** Actual unit in a baseline slot for this player (national variant or base). */
  unitIdFor(owner: number, slotId: string): string | undefined {
    return unitSlotId(this.rosterFor(owner), slotId);
  }

  /** Actual structure in a baseline slot for this player. */
  buildingIdFor(owner: number, slotId: string): string | undefined {
    return buildingSlotId(this.rosterFor(owner), slotId);
  }

  /** Production cards a facility should show for this player. */
  productionEntries(owner: number, buildingId: string): string[] {
    return rosterProductionEntries(this.rosterFor(owner), buildingId);
  }

  /* ------------------------------------------------------------------ */
  /* Research: read model                                                */
  /* ------------------------------------------------------------------ */

  researchState(owner: number): PlayerState['research'] | undefined {
    return this.player(owner)?.research;
  }

  completedTechnologies(owner: number): string[] {
    return this.player(owner)?.research.completed ?? [];
  }

  /**
   * Everything the player's completed research makes available, resolved from
   * canonical slots. National replacements inherit their slot's unlock, so the
   * caller never has to know which platform a nation fields.
   */
  researchUnlocks(owner: number): ResearchUnlocks {
    return resolveResearchUnlocks(this.completedTechnologies(owner), this.research);
  }

  /** Whether this player's research makes a canonical unit slot available. */
  unitSlotUnlocked(owner: number, slot: string): boolean {
    if (!this.player(owner)) return false;
    return TIER_ZERO_UNITS.includes(slot) || this.researchUnlocks(owner).unitSlots.has(slot);
  }

  /** Whether this player's research makes a canonical structure slot available. */
  buildingSlotUnlocked(owner: number, slot: string): boolean {
    if (!this.player(owner)) return false;
    return (
      TIER_ZERO_BUILDINGS.includes(slot) || this.researchUnlocks(owner).buildingSlots.has(slot)
    );
  }

  /**
   * Whether one concrete unit definition is available. A national replacement
   * inherits its alliance slot's unlock through `unitFamily`; a national
   * exclusive, which has no canonical slot, carries its own requirement.
   */
  unitDefinitionUnlocked(owner: number, defId: string): boolean {
    if (!this.player(owner)) return false;
    if (this.unitRestrictedByOperation(owner, defId)) return false;
    return unitDefinitionAvailable(this.completedTechnologies(owner), defId, this.research);
  }

  /* ------------------------------------------------------------------ */
  /* Operation roster limits                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Roster limits the scenario's author set for one commander.
   *
   * A campaign operation is fought with the force that was landed: the same
   * simulation runs, with a trimmed technology tree and a few platforms the
   * theatre cannot support. A scenario without limits returns undefined, so
   * skirmish, multiplayer and every existing save behave exactly as before.
   */
  operationRestrictions(owner: number): ScenarioRestrictions | undefined {
    return this.state.scenario.players.find((p) => p.id === owner)?.restrictions;
  }

  /**
   * A unit this operation refuses. The list may name a concrete definition or a
   * canonical slot, so a national replacement is refused with its family.
   */
  unitRestrictedByOperation(owner: number, defId: string): boolean {
    const units = this.operationRestrictions(owner)?.units;
    if (!units || units.length === 0) return false;
    return units.includes(defId) || units.includes(unitFamily(defId));
  }

  /** A structure this operation refuses, by concrete id or canonical family. */
  buildingRestrictedByOperation(owner: number, defId: string): boolean {
    const buildings = this.operationRestrictions(owner)?.buildings;
    if (!buildings || buildings.length === 0) return false;
    return buildings.includes(defId) || buildings.includes(buildingFamily(defId));
  }

  /** A technology this operation refuses, whatever the commander has studied. */
  techRestrictedByOperation(owner: number, techId: string): boolean {
    return (this.operationRestrictions(owner)?.technologies ?? []).includes(techId);
  }

  /** Technology ids the research panel should present as outside this operation. */
  operationLockedTechnologies(owner: number): readonly string[] {
    return this.operationRestrictions(owner)?.technologies ?? [];
  }

  /* ------------------------------------------------------------------ */
  /* Strategic superweapons                                             */
  /* ------------------------------------------------------------------ */

  /** Whether this battle permits national strategic capabilities at all. */
  superweaponEnabled(): boolean {
    return this.state.scenario.settings.superweapons !== false;
  }

  /**
   * The national capability this commander can field, or null.
   *
   * The nation catalogue is the only authority: there is no list of nation
   * names in this file, so a new nation or faction only has to set its
   * `superweapon` id in data. A nation without one is a fully supported state.
   */
  superweaponFamilyFor(owner: number): SuperweaponFamilyDef | null {
    const p = this.player(owner);
    if (!p) return null;
    const nation = NATIONS[p.factionId];
    return nation?.superweapon && isSuperweaponFamilyId(nation.superweapon)
      ? SUPERWEAPON_FAMILIES[nation.superweapon]
      : null;
  }

  /** The commander's operational Strategic Operations Centre, if any. */
  strategicOpsCentre(owner: number): Entity | undefined {
    const defId = this.buildingIdFor(owner, 'strategicOps');
    if (!defId) return undefined;
    return this.state.entities.find(
      (e) =>
        e.kind === 'building' &&
        e.owner === owner &&
        buildingFamily(e.defId) === 'strategicOps' &&
        e.hp > 0 &&
        !e.construction,
    );
  }

  /**
   * The whole authoritative availability answer.
   *
   * Every gate is checked here, in one order, so the command, the HUD chip and
   * the panel cannot disagree about whether a call-in is legal. A missing
   * structure, missing research, active operation, national cooldown and an
   * empty bank each produce their own actionable reason.
   */
  superweaponStatus(owner: number): SuperweaponStatus {
    const p = this.player(owner);
    const family = this.superweaponFamilyFor(owner);
    const enabled = this.superweaponEnabled();
    const centre = !!this.strategicOpsCentre(owner);
    const completed = new Set(this.completedTechnologies(owner));
    // The chain is named the way this commander's alliance names it, so an
    // eastern player does not read a coalition doctrine label on its own tree.
    const allianceId = p ? tryIdentityDef(p.factionId)?.allianceId : undefined;
    const techName = (id: string): string => {
      const tech = techDef(id, this.research);
      return tech ? techDisplayName(tech, allianceId) : id;
    };
    const requires = family ? family.requires.map((id) => ({ id, name: techName(id), ready: completed.has(id) })) : [];
    const missingTechs = family
      ? family.requires
          .filter((id) => !completed.has(id))
          .map((id) => {
            return { id, name: techName(id) };
          })
      : [];
    const sw = p?.superweapon;
    const cooldown = family && sw ? cooldownSeconds(sw, this.state.tick, family.id) : 0;
    const operation = sw?.active ?? null;
    const affordable = !!p && !!family && p.mats >= family.cost.mats && p.req >= family.cost.req;
    let reason = '';
    if (!enabled) reason = 'Strategic superweapons are disabled for this battle.';
    else if (!family) reason = 'This nation fields no strategic superweapon.';
    else if (!centre) reason = 'Build a Strategic Operations Centre to authorise a call-in.';
    else if (missingTechs.length > 0) {
      reason = `Complete the authority chain first: ${missingTechs.map((t) => t.name).join(', ')}.`;
    } else if (operation) {
      reason = `An operation is already committed (${operation.family}).`;
    } else if (cooldown > 0) {
      reason = `National reload: ${Math.ceil(cooldown)}s remaining.`;
    } else if (!affordable) {
      reason = `Not enough resources: ${family.cost.mats} mats and ${family.cost.req} req required.`;
    }
    return {
      ok: enabled && !!family && centre && missingTechs.length === 0 && !operation && cooldown <= 0 && affordable,
      reason,
      family,
      targeting: family?.targeting ?? null,
      cost: family?.cost ?? null,
      enabled,
      hasCentre: centre,
      requires,
      missingTechs,
      cooldown,
      operation,
      phase: operationPhase(operation, this.state.tick),
      countdown: operationCountdown(operation, this.state.tick),
      affordable,
      ewActive: !!sw && sw.ewUntilTick > this.state.tick,
      defenceActive: !!sw?.defence && sw.defence.untilTick > this.state.tick,
    };
  }

  /** Radius in tiles a family's aim area covers; zero for a single target. */
  private superweaponRadius(family: SuperweaponFamilyDef): number {
    const effect = family.effect;
    if (effect.kind === 'ew' || effect.kind === 'dew') return effect.radiusTiles;
    if (effect.kind === 'saturation' || effect.kind === 'drone') return effect.spreadTiles;
    return 0;
  }

  /**
   * Validate and canonicalise one aim point. A rejected target never reaches
   * the charge step, which is what keeps an invalid order from spending a
   * national cooldown.
   */
  private resolveSuperweaponTarget(
    owner: number,
    family: SuperweaponFamilyDef,
    x: number,
    z: number,
    targetId: number | undefined,
  ): { ok: true; x: number; z: number; targetId: number } | { ok: false; reason: string } {
    const map = this.state.map;
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    if (!inBounds(map.width, map.height, tx, tz)) {
      return { ok: false, reason: 'That aim point is outside the battlefield.' };
    }
    const team = this.teamOf(owner);
    if (family.targeting === 'enemyStructure') {
      const target = targetId ? this.getEntity(targetId) : undefined;
      if (!target || target.hp <= 0 || target.kind !== 'building') {
        return { ok: false, reason: 'A hypersonic strike needs one hostile structure.' };
      }
      if (!this.isHostile(owner, target.owner)) {
        return { ok: false, reason: 'That structure is not hostile.' };
      }
      if (!this.isVisibleTo(team, target.id)) {
        return { ok: false, reason: 'No current sighting of that structure.' };
      }
      if (isIndestructibleStructure(target.defId)) {
        return { ok: false, reason: 'That objective cannot be damaged by a strike.' };
      }
      return { ok: true, x: target.x, z: target.z, targetId: target.id };
    }
    if (family.targeting === 'friendlyArea') {
      const radius = this.superweaponRadius(family) * TILE_SIZE;
      const own = this.state.entities.some(
        (e) =>
          e.hp > 0 &&
          e.owner === owner &&
          dist(e.x, e.z, (tx + 0.5) * TILE_SIZE, (tz + 0.5) * TILE_SIZE) <= radius,
      );
      if (!own) {
        return { ok: false, reason: 'The defensive field must cover your own forces.' };
      }
      return { ok: true, x: (tx + 0.5) * TILE_SIZE, z: (tz + 0.5) * TILE_SIZE, targetId: 0 };
    }
    // Area attacks need a current sighting: a commander cannot aim a strategic
    // barrage at ground it has never seen.
    if (this.fogAt(team, tx, tz) !== 2) {
      return { ok: false, reason: 'No current sighting of that area.' };
    }
    if (family.targeting === 'enemyNetwork') {
      const radius = this.superweaponRadius(family) * TILE_SIZE;
      const present = this.state.entities.some(
        (e) =>
          e.hp > 0 &&
          this.isHostile(owner, e.owner) &&
          dist(e.x, e.z, (tx + 0.5) * TILE_SIZE, (tz + 0.5) * TILE_SIZE) <= radius,
      );
      if (!present) {
        return { ok: false, reason: 'No hostile network is inside that area.' };
      }
    }
    return { ok: true, x: (tx + 0.5) * TILE_SIZE, z: (tz + 0.5) * TILE_SIZE, targetId: 0 };
  }

  /**
   * Public target check for the command gate.
   *
   * The gate must be able to refuse an illegal aim point before queueing it, so
   * a multiplayer client cannot occupy the authoritative queue with a target
   * the simulation will reject. The command repeats the same check at the tick;
   * one helper keeps both answers identical.
   */
  superweaponTargetStatus(
    owner: number,
    familyId: string,
    x: number,
    z: number,
    targetId?: number,
  ): { ok: boolean; reason: string } {
    const family = this.superweaponFamilyFor(owner);
    if (!family || family.id !== familyId) {
      return { ok: false, reason: 'That is not this nation\'s strategic capability.' };
    }
    const target = this.resolveSuperweaponTarget(owner, family, x, z, targetId);
    return target.ok ? { ok: true, reason: '' } : target;
  }

  /**
   * Authorise one strategic operation.
   *
   * The whole transaction is authoritative and ordered: validate, charge once,
   * start the national cooldown, commit the operation. A duplicate command is
   * refused by the already-committed operation, so a repeated input or a
   * replayed network command cannot buy two strikes.
   */
  commandSuperweapon(
    owner: number,
    familyId: string,
    x: number,
    z: number,
    targetId?: number,
  ): void {
    const p = this.player(owner);
    const family = this.superweaponFamilyFor(owner);
    const status = this.superweaponStatus(owner);
    if (!p || !family) {
      this.emit('orderFailed', { team: owner, x, z, text: status.reason || 'No strategic capability.' });
      return;
    }
    if (family.id !== familyId) {
      this.emit('orderFailed', { team: owner, x, z, text: 'That is not this nation\'s strategic capability.' });
      return;
    }
    // Availability gates describe the structure, research and national reload.
    if (!status.ok) {
      this.emit('orderFailed', { team: owner, x, z, text: status.reason });
      return;
    }
    const target = this.resolveSuperweaponTarget(owner, family, x, z, targetId);
    if (!target.ok) {
      this.emit('orderFailed', { team: owner, x, z, text: target.reason });
      return;
    }
    p.mats -= family.cost.mats;
    p.req -= family.cost.req;
    const tick = this.state.tick;
    p.superweapon.cooldowns[family.id] = tick + Math.round(family.cooldownSeconds * TICK_RATE);
    const executeTick = tick + Math.max(1, Math.round(family.warningSeconds * TICK_RATE));
    const effect = family.effect;
    let endTick = executeTick + 8 * TICK_RATE;
    if (effect.kind === 'ew' || effect.kind === 'dew') {
      endTick = executeTick + Math.round(effect.durationSeconds * TICK_RATE);
    } else if (effect.kind === 'saturation') {
      endTick = executeTick + Math.round((effect.munitions * effect.intervalSeconds + 8) * TICK_RATE);
    } else if (effect.kind === 'drone') {
      endTick = executeTick + Math.round((effect.drones * effect.intervalSeconds + 10) * TICK_RATE);
    }
    p.superweapon.active = {
      id: tick * 8 + owner,
      family: family.id,
      phase: 'warning',
      startTick: tick,
      executeTick,
      endTick,
      targetX: target.x,
      targetZ: target.z,
      targetId: target.targetId,
      launched: 0,
    };
    const presentation = this.superweaponPresentationFor(owner, family);
    this.emit('notice', {
      team: owner,
      x: target.x,
      z: target.z,
      text: `${presentation.name} authorised. ${family.warningSeconds}s to execution.`,
      code: 'superweaponAuthorised',
      level: 'warning',
      sound: 'alert',
    });
    for (const defender of this.superweaponAffectedOwners(owner, target.x, target.z, family)) {
      this.emit('notice', {
        team: defender,
        x: target.x,
        z: target.z,
        text: `Incoming strategic operation: ${presentation.name}.`,
        code: 'superweaponWarning',
        level: 'warning',
        sound: 'alert',
      });
    }
  }

  /** Local name of a capability for this commander's alliance. */
  private superweaponPresentationFor(
    owner: number,
    family: SuperweaponFamilyDef,
  ): { name: string; description: string } {
    const p = this.player(owner);
    const allianceId = p ? tryIdentityDef(p.factionId)?.allianceId : undefined;
    return superweaponPresentation(family, allianceId);
  }

  /** Hostile commanders with anything inside the aim area. */
  private superweaponAffectedOwners(
    owner: number,
    x: number,
    z: number,
    family: SuperweaponFamilyDef,
  ): number[] {
    const radius = Math.max(this.superweaponRadius(family), family.effect.kind === 'hypersonic' ? 3 : 0) * TILE_SIZE;
    const affected: number[] = [];
    for (const q of this.state.players) {
      if (q.defeated || !this.isHostile(owner, q.id)) continue;
      if (
        this.state.entities.some(
          (e) => e.hp > 0 && e.owner === q.id && dist(e.x, e.z, x, z) <= radius,
        )
      ) {
        affected.push(q.id);
      }
    }
    return affected;
  }

  /** One command's committed operation, for the HUD and the panel. */
  superweaponOperation(owner: number): PlayerSuperweaponState['active'] {
    return this.player(owner)?.superweapon.active ?? null;
  }

  /**
   * Repair saved strategic state.
   *
   * Saves written before this layer have no field at all, which must load as a
   * ready commander rather than a broken one. A malformed operation is dropped
   * instead of being allowed to spawn effects from a hand-edited file, and an
   * expired cooldown is kept as a past tick so the national reload is never
   * silently reset by opening an old save.
   */
  private normalizeSuperweaponStates(): void {
    for (const p of this.state.players) {
      const raw = p.superweapon as Partial<PlayerSuperweaponState> | undefined;
      const cooldowns: Record<string, number> = {};
      for (const [id, until] of Object.entries(raw?.cooldowns ?? {})) {
        if (!isSuperweaponFamilyId(id)) continue;
        if (typeof until === 'number' && Number.isFinite(until)) cooldowns[id] = until;
      }
      const activeRaw = raw?.active;
      let active: PlayerSuperweaponState['active'] = null;
      if (
        activeRaw &&
        isSuperweaponFamilyId(activeRaw.family) &&
        (activeRaw.phase === 'warning' || activeRaw.phase === 'executing') &&
        Number.isFinite(activeRaw.executeTick) &&
        Number.isFinite(activeRaw.endTick) &&
        activeRaw.endTick > this.state.tick
      ) {
        active = {
          id: Number.isFinite(activeRaw.id) ? activeRaw.id : 0,
          family: activeRaw.family,
          phase: activeRaw.phase,
          startTick: Number.isFinite(activeRaw.startTick) ? activeRaw.startTick : this.state.tick,
          executeTick: activeRaw.executeTick,
          endTick: activeRaw.endTick,
          targetX: Number.isFinite(activeRaw.targetX) ? activeRaw.targetX : 0,
          targetZ: Number.isFinite(activeRaw.targetZ) ? activeRaw.targetZ : 0,
          targetId: Number.isFinite(activeRaw.targetId) ? activeRaw.targetId : 0,
          launched: Number.isFinite(activeRaw.launched) ? Math.max(0, activeRaw.launched) : 0,
        };
      }
      const defenceRaw = raw?.defence;
      const defence =
        defenceRaw &&
        Number.isFinite(defenceRaw.x) &&
        Number.isFinite(defenceRaw.z) &&
        Number.isFinite(defenceRaw.radiusTiles) &&
        Number.isFinite(defenceRaw.untilTick) &&
        defenceRaw.untilTick > this.state.tick
          ? {
              x: defenceRaw.x,
              z: defenceRaw.z,
              radiusTiles: defenceRaw.radiusTiles,
              untilTick: defenceRaw.untilTick,
              spentThisSecond: 0,
              secondMark: Math.floor(this.state.tick / TICK_RATE),
            }
          : null;
      p.superweapon = {
        cooldowns,
        active,
        ewUntilTick:
          typeof raw?.ewUntilTick === 'number' && Number.isFinite(raw.ewUntilTick)
            ? raw.ewUntilTick
            : 0,
        defence,
      };
    }
  }

  /**
   * Advance every committed operation on the authoritative clock.
   *
   * Warning and execution are phases of one state machine: the effect starts
   * exactly once when the warning elapses, and the operation clears exactly once
   * at its end. Nothing here depends on a render frame.
   */
  private updateSuperweapons(): void {
    const tick = this.state.tick;
    for (const p of this.state.players) {
      const sw = p.superweapon;
      if (sw.defence && tick >= sw.defence.untilTick) sw.defence = null;
      const op = sw.active;
      if (!op) continue;
      if (op.phase === 'warning' && tick >= op.executeTick) {
        op.phase = 'executing';
        this.beginSuperweaponEffect(p, op);
      }
      if (op.phase === 'executing' && (op.family === 'saturation' || op.family === 'drone')) {
        this.launchSuperweaponBatch(p, op);
      }
      if (tick >= op.endTick) {
        sw.active = null;
        const family = SUPERWEAPON_FAMILIES[op.family as SuperweaponFamilyId];
        const name = family ? this.superweaponPresentationFor(p.id, family).name : 'Strategic operation';
        this.emit('notice', {
          team: p.id,
          x: op.targetX,
          z: op.targetZ,
          text: `${name} complete.`,
          code: 'superweaponComplete',
          level: 'info',
        });
      }
    }
  }

  /** Begin an operation's effect exactly once, at its authoritative resolve tick. */
  private beginSuperweaponEffect(p: PlayerState, op: NonNullable<PlayerSuperweaponState['active']>): void {
    const family = SUPERWEAPON_FAMILIES[op.family as SuperweaponFamilyId];
    if (!family) return;
    const effect = family.effect;
    if (effect.kind === 'hypersonic') {
      this.spawnStrategicProjectile(p.id, op, 0, 'stormMissile', effect.damage, effect.splash, effect.flightSpeed, true);
      op.launched = 1;
    } else if (effect.kind === 'saturation' || effect.kind === 'drone') {
      // The batch launcher starts the volley; later rounds are released by the
      // update loop at the authored interval, so the defence has time to work.
      this.launchSuperweaponBatch(p, op);
    } else if (effect.kind === 'ew') {
      const until = this.state.tick + Math.round(effect.durationSeconds * TICK_RATE);
      for (const q of this.state.players) {
        if (q.defeated || !this.isHostile(p.id, q.id)) continue;
        const inArea = this.state.entities.some(
          (e) =>
            e.hp > 0 &&
            e.owner === q.id &&
            dist(e.x, e.z, op.targetX, op.targetZ) <= effect.radiusTiles * TILE_SIZE,
        );
        if (!inArea) continue;
        q.superweapon.ewUntilTick = Math.max(q.superweapon.ewUntilTick, until);
        this.emit('notice', {
          team: q.id,
          x: op.targetX,
          z: op.targetZ,
          text: 'Electronic attack is degrading our sensor and datalink picture.',
          code: 'superweaponWarning',
          level: 'warning',
          sound: 'alert',
        });
      }
    } else if (effect.kind === 'dew') {
      p.superweapon.defence = {
        x: op.targetX,
        z: op.targetZ,
        radiusTiles: effect.radiusTiles,
        untilTick: this.state.tick + Math.round(effect.durationSeconds * TICK_RATE),
        spentThisSecond: 0,
        secondMark: Math.floor(this.state.tick / TICK_RATE),
      };
      this.emit('notice', {
        team: p.id,
        x: op.targetX,
        z: op.targetZ,
        text: 'Directed-energy defence net is active over the sector.',
        code: 'superweaponImpact',
        level: 'success',
        sound: 'ui',
      });
    }
  }

  /** Release the next batch of a saturation or drone operation. */
  private launchSuperweaponBatch(
    p: PlayerState,
    op: NonNullable<PlayerSuperweaponState['active']>,
  ): void {
    const family = SUPERWEAPON_FAMILIES[op.family as SuperweaponFamilyId];
    if (!family) return;
    const effect = family.effect;
    if (effect.kind !== 'saturation' && effect.kind !== 'drone') return;
    const total = effect.kind === 'saturation' ? effect.munitions : effect.drones;
    const intervalTicks = Math.max(1, Math.round(effect.intervalSeconds * TICK_RATE));
    const elapsed = Math.max(0, this.state.tick - op.executeTick);
    const expected = Math.min(total, 1 + Math.floor(elapsed / intervalTicks));
    if (expected <= op.launched) return;
    const points = salvoPoints(op.id, total, effect.spreadTiles * TILE_SIZE);
    const targets =
      effect.kind === 'drone'
        ? this.state.entities.filter(
            (e) =>
              e.hp > 0 &&
              this.isHostile(p.id, e.owner) &&
              dist(e.x, e.z, op.targetX, op.targetZ) <= effect.spreadTiles * TILE_SIZE,
          )
        : [];
    for (let index = op.launched; index < expected; index++) {
      const point = points[index] ?? { x: 0, z: 0 };
      const tx = Math.max(TILE_SIZE, Math.min((this.state.map.width - 1) * TILE_SIZE, op.targetX + point.x));
      const tz = Math.max(TILE_SIZE, Math.min((this.state.map.height - 1) * TILE_SIZE, op.targetZ + point.z));
      const target = effect.kind === 'drone' && targets.length > 0 ? targets[index % targets.length] : undefined;
      this.spawnStrategicProjectile(
        p.id,
        op,
        index,
        effect.kind === 'drone' ? 'strikeMissile' : 'heavyRocketSalvo',
        effect.damage,
        effect.splash,
        effect.kind === 'drone' ? 22 : 34,
        !!target,
        target?.id ?? 0,
        tx,
        tz,
      );
    }
    op.launched = expected;
  }

  /** One off-map munition, entering from the map edge nearest its aim point. */
  private spawnStrategicProjectile(
    owner: number,
    op: NonNullable<PlayerSuperweaponState['active']>,
    index: number,
    weaponId: string,
    damage: number,
    splash: number,
    speed: number,
    homing: boolean,
    targetId = 0,
    tx = op.targetX,
    tz = op.targetZ,
  ): void {
    const weapon = WEAPONS[weaponId];
    if (!weapon) return;
    const fromNorth = tz >= this.state.map.height * TILE_SIZE * 0.5;
    const startX = tx;
    const startZ = fromNorth
      ? Math.max(0, tz - 22 * TILE_SIZE)
      : Math.min(this.state.map.height * TILE_SIZE, tz + 22 * TILE_SIZE);
    const ty = this.heightAt(tx, tz) + 1.3;
    this.state.projectiles.push({
      id: this.state.nextProjectileId++,
      owner,
      shooterId: this.strategicOpsCentre(owner)?.id ?? 0,
      weaponId,
      x: startX,
      y: 24,
      z: startZ,
      tx,
      ty,
      tz,
      targetId,
      speed,
      splash,
      kind: weapon.projectile,
      homing,
      damage,
      armourMul: {},
      suppression: weapon.suppression ?? 0.6,
      seed: op.id + index,
      strategic: { family: op.family, operationId: op.id },
    });
  }

  /** Actual roster unit ids the player may produce with its current research. */
  availableUnits(owner: number): string[] {
    return this.rosterFor(owner).units.filter((id) => this.unitDefinitionUnlocked(owner, id));
  }

  /** Actual roster structure ids the player may construct with its research. */
  availableBuildings(owner: number): string[] {
    return this.rosterFor(owner).buildings.filter(
      (id) =>
        this.buildingSlotUnlocked(owner, buildingFamily(id)) &&
        !this.buildingRestrictedByOperation(owner, id),
    );
  }

  /**
   * Technologies whose completion opens one concrete unit, excluding the ones
   * already complete. Production and the research panel share this answer so a
   * locked card names exactly the node the player still needs.
   */
  missingResearchForUnit(owner: number, defId: string): TechDef[] {
    const completed = new Set(this.completedTechnologies(owner));
    return requiredTechnologiesForUnit(defId, this.research).filter(
      (tech) => !completed.has(tech.id),
    );
  }

  /** Technologies still needed before one concrete structure is buildable. */
  missingResearchForBuilding(owner: number, defId: string): TechDef[] {
    const completed = new Set(this.completedTechnologies(owner));
    return requiredTechnologiesForBuilding(defId, this.research).filter(
      (tech) => !completed.has(tech.id),
    );
  }

  /**
   * Upgrades this unit may take. Research availability is global; the per-unit
   * exclusion is what the hull has already taken, so a newly produced unit sees
   * the same list as one that existed before the research completed.
   */
  availableUpgrades(owner: number, unitId: number): UnitUpgradeDef[] {
    const unit = this.getEntity(unitId);
    if (!unit || unit.kind !== 'unit' || unit.owner !== owner || unit.hp <= 0) return [];
    const applied = new Set(unit.upgrades ?? []);
    return upgradesForSlot(
      this.completedTechnologies(owner),
      unitFamily(unit.defId),
      this.research,
    ).filter((upgrade) => !applied.has(upgrade.id));
  }

  /** Modules this structure could buy and install right now. */
  availableModules(owner: number, buildingId: number): BuildingModuleDef[] {
    const building = this.getEntity(buildingId);
    if (!building || building.kind !== 'building' || building.owner !== owner || building.hp <= 0) {
      return [];
    }
    if (building.construction) return [];
    const installed = building.modules ?? [];
    const p = this.player(owner);
    if (!p) return [];
    return modulesForSlot(
      p.research.completed,
      buildingFamily(building.defId),
      this.research,
    ).filter((module) => {
      const count = installed.filter((id) => id === module.id).length;
      return count < (module.capacity ?? 1);
    });
  }

  /** Ids of the modules installed on one structure, in purchase order. */
  installedModules(buildingId: number): string[] {
    return this.getEntity(buildingId)?.modules ?? [];
  }

  /** Ids of the upgrades one unit has already taken. */
  appliedUpgrades(unitId: number): string[] {
    return this.getEntity(unitId)?.upgrades ?? [];
  }

  entitiesOf(owner: number, kind?: Entity['kind']): Entity[] {
    return this.state.entities.filter(
      (e) => e.owner === owner && e.hp > 0 && (!kind || e.kind === kind),
    );
  }

  teamOf(owner: number): number {
    return this.player(owner)?.team ?? -1;
  }

  isHostile(a: number, b: number): boolean {
    if (a < 0 || b < 0) return false;
    const ta = this.teamOf(a);
    const tb = this.teamOf(b);
    return ta >= 0 && tb >= 0 && ta !== tb;
  }

  /**
   * A neutral shelter becomes a legal target while enemy infantry occupy it.
   * This keeps civilian buildings neutral until someone takes cover, yet lets
   * the opponent clear the position with ordinary anti-structure fire instead
   * of facing an invulnerable bunker.
   */
  private isAttackable(attackerOwner: number, target: Entity): boolean {
    if (this.isHostile(attackerOwner, target.owner)) return true;
    if (target.owner !== -1 || target.kind !== 'building') return false;
    // A neutral span is a shared crossing rather than a protected objective:
    // either side may drop it, and either side may re-deck it afterwards.
    if (BUILDINGS[target.defId]?.walkable) return target.hp > 0;
    if (!BUILDINGS[target.defId]?.garrison) return false;
    for (const e of this.state.entities) {
      if (e.kind !== 'unit' || e.hp <= 0 || e.garrisonId !== target.id) continue;
      if (this.isHostile(attackerOwner, e.owner)) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Command handling                                                   */
  /* ------------------------------------------------------------------ */

  enqueueCommand(cmd: Command): void {
    this.pending.push(cmd);
  }

  private processCommands(): void {
    if (this.pending.length === 0) return;
    const commands = this.pending;
    this.pending = [];
    for (const cmd of commands) {
      if (this.state.victory !== 'playing') break;
      this.state.commandCount++;
      switch (cmd.type) {
        case 'move':
          this.commandMove(cmd.team, cmd.ids, cmd.x, cmd.z, !!cmd.attackMove);
          break;
        case 'attack':
          this.commandAttack(cmd.team, cmd.ids, cmd.targetId);
          break;
        case 'stop':
          this.commandStop(cmd.team, cmd.ids);
          break;
        case 'hold':
          this.commandHold(cmd.team, cmd.ids);
          break;
        case 'stance':
          for (const e of this.ownedEntities(cmd.team, cmd.ids)) e.stance = cmd.stance;
          break;
        case 'return':
          this.commandReturn(cmd.team, cmd.ids);
          break;
        case 'dive':
          this.commandDive(cmd.team, cmd.ids, cmd.dive);
          break;
        case 'capture':
          this.commandCapture(cmd.team, cmd.ids, cmd.targetId);
          break;
        case 'repair':
          this.commandRepair(cmd.team, cmd.ids, cmd.targetId);
          break;
        case 'garrison':
          this.commandGarrison(cmd.team, cmd.ids, cmd.targetId);
          break;
        case 'ungarrison':
          this.commandUngarrison(cmd.team, cmd.ids);
          break;
        case 'produce':
          this.commandProduce(cmd.team, cmd.buildingId, cmd.defId);
          break;
        case 'cancelProduction':
          this.commandCancelProduction(cmd.team, cmd.buildingId, cmd.index);
          break;
        case 'reorderProduction':
          this.commandReorderProduction(cmd.team, cmd.buildingId, cmd.defId, cmd.beforeDefId);
          break;
        case 'placeBuilding':
          this.commandPlaceBuilding(cmd.team, cmd.builderId, cmd.defId, cmd.tileX, cmd.tileZ);
          break;
        case 'sellBuilding':
          this.commandSellBuilding(cmd.team, cmd.buildingId);
          break;
        case 'research':
          this.commandResearch(cmd.team, cmd.buildingId, cmd.techId);
          break;
        case 'cancelResearch':
          this.commandCancelResearch(cmd.team, cmd.buildingId);
          break;
        case 'installModule':
          this.commandInstallModule(cmd.team, cmd.buildingId, cmd.moduleId);
          break;
        case 'activateUpgrade':
          this.commandActivateUpgrade(cmd.team, cmd.unitId, cmd.upgradeId);
          break;
        case 'useAbility':
          this.commandUseAbility(cmd.team, cmd.unitId, cmd.abilityId);
          break;
        case 'superweapon':
          this.commandSuperweapon(cmd.team, cmd.familyId, cmd.x, cmd.z, cmd.targetId);
          break;
        case 'setRally': {
          const b = this.getEntity(cmd.buildingId);
          if (!b || b.kind !== 'building' || b.owner !== cmd.team) break;
          const status = this.rallyStatus(cmd.buildingId, cmd.x, cmd.z);
          if (!status.ok) {
            this.emit('orderFailed', {
              team: cmd.team,
              x: cmd.x,
              z: cmd.z,
              text: status.reason,
              entityId: b.id,
              level: 'warning',
            });
            break;
          }
          b.rallyX = cmd.x;
          b.rallyZ = cmd.z;
          // Acknowledgement, not a loss of information: the announcer needs the
          // transition to know the new rally is live, and the player hears it.
          this.emit('orderAck', {
            team: cmd.team,
            x: cmd.x,
            z: cmd.z,
            text: `${entityName(b)} rally point set.`,
            code: 'rallySet',
            entityId: b.id,
          });
          break;
        }
      }
    }
  }

  private ownedEntities(owner: number, ids: number[]): Entity[] {
    const out: Entity[] = [];
    for (const id of [...ids].sort((a, b) => a - b)) {
      const e = this.byId.get(id);
      if (e && e.owner === owner && e.hp > 0) out.push(e);
    }
    return out;
  }

  private commandMove(owner: number, ids: number[], x: number, z: number, attackMove: boolean): void {
    const selected = this.ownedEntities(owner, ids).filter((e) => e.kind === 'unit');
    const entities = selected.filter((e) => !e.garrisonId);
    if (entities.length === 0) {
      if (selected.some((e) => e.garrisonId)) {
        this.emit('orderFailed', {
          team: owner,
          x,
          z,
          text: 'Garrisoned infantry must exit the building before moving.',
          level: 'warning',
          sound: 'denied',
        });
      }
      return;
    }
    const destinations = this.formationPoints(entities, x, z);
    // Below a small batch the one shared scan and per-domain bookkeeping cost
    // more than the per-request mask it replaces. All-air orders never consult
    // the traffic mask, so they must not pay for one either.
    const needsTraffic = entities.some((e) => unitDef(e.defId).domain !== 'air');
    const navBatch =
      needsTraffic && entities.length >= 4 ? this.beginNavBatch(owner) : undefined;
    let failed = 0;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const dest = destinations[i];
      const def = unitDef(e.defId);
      // A player order takes an engineer off its site; construction pauses.
      this.releaseBuildTarget(e);
      // A movement order replaces any combat order. The direct target is part
      // of the old order, so it must not outlive it: a target destroyed later
      // would otherwise leave an entity id that no longer exists in the saved
      // state, and the strict room-snapshot validator would reject the room.
      e.targetId = 0;
      e.aimTargetId = 0;
      if (def.domain === 'air') {
        e.order = { type: attackMove ? 'attackMove' : 'move', x: dest.x, z: dest.z };
        e.path = [{ x: dest.x, z: dest.z }];
        e.pathIndex = 0;
        e.destX = dest.x;
        e.destZ = dest.z;
        e.state = 'moving';
        if (e.aircraft?.landed) {
          e.aircraft.landed = false;
          e.aircraft.serviceTimer = 0;
        }
        e.aircraft && (e.aircraft.returningHome = false);
        continue;
      }
      if (e.harvester) {
        const refinery = this.refineryNear(owner, dest.x, dest.z);
        if (refinery) {
          // Right-clicking a refinery is an offload order, not a blocked move
          // into its footprint.
          e.harvester.refineId = refinery.id;
          this.sendHarvesterToRefinery(e);
          navBatch?.refresh(e.id, e.state === 'moving' || e.path.length > 0);
          continue;
        }
        e.harvester.phase = 'seek';
      }
      // The stand decided here is the ground this unit will actually stop on.
      // A slot that is only *standable* is not enough: a peak, a pocket behind
      // a cliff or a corner cut off by a footprint can be open ground the hull
      // can never drive to, which used to refuse the whole order for that unit.
      const plan = this.planMove(e, def, dest.x, dest.z, navBatch);
      if (!plan) {
        failed++;
        e.order = null;
        e.path = [];
        e.state = 'idle';
        navBatch?.refresh(e.id, false);
        continue;
      }
      e.order = { type: attackMove ? 'attackMove' : 'move', x: plan.x, z: plan.z };
      e.path = plan.path;
      e.pathIndex = 0;
      e.destX = plan.x;
      e.destZ = plan.z;
      e.state = plan.path.length > 0 ? 'moving' : 'idle';
      e.blockedTicks = 0;
      // The aim was already dropped when the order replaced the old one.
      e.captureTargetId = 0;
      e.captureProgress = 0;
      navBatch?.refresh(e.id, e.state === 'moving' || e.path.length > 0);
    }
    if (failed > 0) {
      this.emit('orderFailed', {
        team: owner,
        x,
        z,
        text:
          failed === entities.length
            ? 'No route to that location for the selected force.'
            : `${failed} unit${failed === 1 ? '' : 's'} cannot reach that location.`,
        // The local commander's first ordered unit answers the refusal.
        defId: entities[0]?.defId,
        level: 'warning',
        sound: 'denied',
      });
    } else {
      this.emit('orderAck', {
        team: owner,
        x,
        z,
        text: attackMove ? 'Attack-move ordered' : 'Moving',
        code: 'moveOrder',
        defId: entities[0]?.defId,
        level: 'info',
      });
    }
  }

  /**
   * Whether `commandMove` would accept this destination for the whole group.
   *
   * The command layer refuses the order outright when any unit's formation slot
   * is a tile it cannot stand on, or a tile inside a structure. The AI needs
   * that same test before it counts a wave as launched: a remembered contact
   * reports a building's centre, which is a blocked tile, so an order aimed
   * there is refused and nothing moves.
   */
  canOrderMove(owner: number, ids: number[], x: number, z: number): boolean {
    const entities = this.ownedEntities(owner, ids).filter(
      (e) => e.kind === 'unit' && !e.garrisonId,
    );
    if (entities.length === 0) return false;
    const destinations = this.formationPoints(entities, x, z);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const def = unitDef(e.defId);
      // Aircraft fly anywhere; a harvester sent at a refinery is redirected to
      // offload instead of being refused.
      if (def.domain === 'air' || e.harvester) continue;
      // The slot is allowed to walk out to nearby open ground, exactly as the
      // command layer does, or the two would disagree about what is a valid aim.
      if (!this.moveSlotFor(def, destinations[i].x, destinations[i].z)) return false;
    }
    // Tile tests are cheap and reject most of the walk; only a slot that
    // survives them is worth an actual route search. The routes are a
    // feasibility check, not state changes, so one traffic mask serves them all.
    const needsTraffic = entities.some(
      (e) => unitDef(e.defId).domain !== 'air' && !e.harvester,
    );
    const navBatch =
      needsTraffic && entities.length >= 4 ? this.beginNavBatch(owner) : undefined;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (unitDef(e.defId).domain === 'air' || e.harvester) continue;
      // Deliberately the *strict* test: a wave is only counted as launched when
      // the aim the commander chose is open to every unit in it. The command
      // layer's last-resort walk-out (planMove) is a convenience for a player
      // clicking on awkward ground; letting it satisfy this gate would mean an
      // assault destination could shift because of ground the AI cannot see.
      const slot = this.moveSlotFor(unitDef(e.defId), destinations[i].x, destinations[i].z, false);
      if (!slot) return false;
      if (!this.findPathFor(e, slot.x, slot.z, navBatch)) return false;
    }
    return true;
  }

  /**
   * Structures this team may treat as walls: what it can see, what it has
   * charted and remembers, and the structures it holds a live contact for.
   * Fog is per team and structures never move, so this is exactly the occupancy
   * the commander is entitled to plan around.
   */
  private knownBlockage(team: number): Uint8Array {
    const mask = new Uint8Array(this.state.map.width * this.state.map.height);
    const stamp = (defId: string, wx: number, wz: number): void => {
      const def = BUILDINGS[defId];
      if (!def) return;
      const tx = Math.round(wx / TILE_SIZE - def.footprint.w / 2);
      const tz = Math.round(wz / TILE_SIZE - def.footprint.h / 2);
      stampFootprint(mask, this.state.map, defId, tx, tz, 1);
    };
    for (const e of this.state.entities) {
      if (e.kind !== 'building' || e.hp <= 0) continue;
      if (!this.isKnownTo(team, e.id)) continue;
      stamp(e.defId, e.x, e.z);
    }
    // A contact is memory too: the team saw this structure and knows where it
    // stands, even if it has not been charted as a silhouette. Only a contact
    // that still carries its identification can stamp a footprint; a degraded
    // one has already lost its definition, and the charted silhouettes above
    // cover any structure the team has genuinely seen.
    for (const c of this.state.contacts) {
      if (c.team !== team || c.kind !== 'building' || !c.defId) continue;
      stamp(c.defId, c.x, c.z);
    }
    return mask;
  }

  /**
   * Whether every unit's formation slot is terrain it can stand on and is not
   * inside a structure the team knows about. This is the aim test, and it uses
   * nothing but knowledge the team has earned.
   */
  private aimIsOpen(
    owner: number,
    ids: number[],
    x: number,
    z: number,
    knownBlocked: Uint8Array,
  ): boolean {
    const entities = this.ownedEntities(owner, ids).filter(
      (e) => e.kind === 'unit' && !e.garrisonId,
    );
    if (entities.length === 0) return false;
    const destinations = this.formationPoints(entities, x, z);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const def = unitDef(e.defId);
      if (def.domain === 'air') continue;
      const dest = destinations[i];
      const destTile = this.tileAt(dest.x, dest.z);
      if (destTile === null) return false;
      if (
        !canStandOn(
          this.state.map.width,
          this.state.map.height,
          this.state.map.terrain,
          destTile,
          def.moveClass,
        )
      ) {
        return false;
      }
      if (knownBlocked[destTile]) return false;
    }
    return true;
  }

  /**
   * Nearest point to `x,z`, walking toward `towardX,towardZ`, that stands the
   * group clear of the structures its team knows about. Structure centres are
   * blocked, so an assault wave aimed at one has to be stood off onto the open
   * ground beside it.
   *
   * The walk reads no hidden occupancy: a building the team has never seen
   * cannot steer the aim onto a different tile. It can still make the world
   * refuse the chosen point, which is why the result is validated against the
   * real command layer at the end — a refusal is physics, and the caller is told
   * that nothing was launched rather than being given another destination.
   */
  groupApproach(
    owner: number,
    ids: number[],
    x: number,
    z: number,
    towardX: number,
    towardZ: number,
    maxTiles = 10,
  ): { x: number; z: number } | null {
    const knownBlocked = this.knownBlockage(this.teamOf(owner));
    const dx = towardX - x;
    const dz = towardZ - z;
    const len = Math.hypot(dx, dz) || 1;
    const stepX = (dx / len) * TILE_SIZE;
    const stepZ = (dz / len) * TILE_SIZE;
    for (let step = 0; step <= maxTiles; step++) {
      const px = x + stepX * step;
      const pz = z + stepZ * step;
      if (!this.aimIsOpen(owner, ids, px, pz, knownBlocked)) continue;
      return this.canOrderMove(owner, ids, px, pz) ? { x: px, z: pz } : null;
    }
    return null;
  }

  private formationPoints(entities: Entity[], x: number, z: number): Array<{ x: number; z: number }> {
    const n = entities.length;
    if (n === 1) return [{ x, z }];
    let maxRadius = 3;
    for (const e of entities) maxRadius = Math.max(maxRadius, unitDef(e.defId).radius);
    const spacing = Math.max(7, maxRadius * 2.4);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const out: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ox = (col - (cols - 1) / 2) * spacing;
      const oz = (row - (rows - 1) / 2) * spacing;
      let px = x + ox;
      let pz = z + oz;
      px = clamp(px, TILE_SIZE, (this.state.map.width - 1) * TILE_SIZE);
      pz = clamp(pz, TILE_SIZE, (this.state.map.height - 1) * TILE_SIZE);
      // Nudge invalid offsets back toward the target.
      const def = unitDef(entities[i].defId);
      if (def.domain !== 'air') {
        const tile = this.tileAt(px, pz);
        if (tile === null || !canStandOn(this.state.map.width, this.state.map.height, this.state.map.terrain, tile, def.moveClass)) {
          px = x;
          pz = z;
        }
      }
      out.push({ x: px, z: pz });
    }
    return out;
  }

  private commandAttack(owner: number, ids: number[], targetId: number): void {
    const orderedDefId = this.ownedEntities(owner, ids)[0]?.defId;
    const target = this.getEntity(targetId);
    if (!target || target.hp <= 0) {
      this.emit('orderFailed', {
        team: owner,
        x: 0,
        z: 0,
        text: 'Target no longer exists.',
        defId: orderedDefId,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    if (isIndestructibleStructure(target.defId)) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: `${buildingDef(target.defId).name} cannot be destroyed — capture it with a Combat Engineer.`,
        defId: orderedDefId,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    if (target.kind === 'unit' && target.garrisonId) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: 'That infantry is inside a building — engage the structure or clear its occupants.',
        defId: orderedDefId,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    if (!this.isHostile(owner, target.owner) && target.owner !== -1) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: 'That is a friendly unit.',
        defId: orderedDefId,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    // Mobile shooters reposition; armed structures hold their ground and
    // simply take the target, but both accept the same explicit attack order.
    const entities = this.ownedEntities(owner, ids).filter(
      (e) =>
        (e.kind === 'unit' && !e.garrisonId) ||
        (e.kind === 'building' && !e.construction && entityWeapons(e).length > 0),
    );
    let capable = 0;
    let firstCapable: Entity | null = null;
    for (const e of entities) {
      this.releaseBuildTarget(e);
      const weapons = entityWeapons(e);
      const usable = weapons.some(
        (w) => weaponCanHurt(w, target) && (!usesPrimaryAmmo(e, w) || e.ammo > 0),
      );
      if (!usable) {
        // A unit that cannot damage this target holds its ground. Walking it
        // toward the target used to turn an unarmed medic or an anti-infantry
        // rifle squad into a suicide run against a structure; normal automatic
        // engagement can still answer anything it is actually able to fight.
        e.order = null;
        e.path = [];
        e.pathIndex = 0;
        e.state = 'idle';
        e.targetId = 0;
        e.aimTargetId = 0;
        e.blockedTicks = 0;
        continue;
      }
      capable++;
      firstCapable ??= e;
      e.order = { type: 'attack', targetId: target.id };
      e.targetId = target.id;
      e.aimTargetId = target.id;
      e.captureTargetId = 0;
      e.captureProgress = 0;
      if (e.kind === 'building') {
        e.path = [];
        e.pathIndex = 0;
        continue;
      }
      e.path = [];
      e.pathIndex = 0;
      if (UNITS[e.defId]?.domain === 'air' && e.aircraft?.landed) {
        e.aircraft.landed = false;
        e.aircraft.returningHome = false;
      }
    }
    if (capable === 0) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: 'Selected forces cannot attack that target.',
        defId: entities[0]?.defId,
        level: 'warning',
        sound: 'denied',
      });
    } else {
      this.emit('orderAck', {
        team: owner,
        x: target.x,
        z: target.z,
        text: `Attacking ${entityName(target)}`,
        entityId: target.id,
        code: 'attackOrder',
        defId: firstCapable?.defId ?? entities[0]?.defId,
        level: 'info',
      });
    }
  }

  private commandStop(owner: number, ids: number[]): void {
    for (const e of this.ownedEntities(owner, ids)) {
      if (e.garrisonId) continue;
      this.releaseBuildTarget(e);
      e.order = null;
      e.path = [];
      e.pathIndex = 0;
      e.state = e.kind === 'building' ? 'idle' : 'idle';
      e.targetId = 0;
      e.aimTargetId = 0;
      e.destX = e.x;
      e.destZ = e.z;
      e.guardX = e.x;
      e.guardZ = e.z;
      e.captureTargetId = 0;
      e.captureProgress = 0;
    }
  }

  private commandHold(owner: number, ids: number[]): void {
    for (const e of this.ownedEntities(owner, ids)) {
      if (e.garrisonId) continue;
      this.releaseBuildTarget(e);
      e.stance = 'hold';
      e.order = null;
      e.path = [];
      e.pathIndex = 0;
      e.targetId = 0;
      e.aimTargetId = 0;
      e.destX = e.x;
      e.destZ = e.z;
      e.guardX = e.x;
      e.guardZ = e.z;
    }
    this.emit('orderAck', { team: owner, x: 0, z: 0, text: 'Holding position', level: 'info' });
  }

  private commandReturn(owner: number, ids: number[]): void {
    for (const e of this.ownedEntities(owner, ids)) {
      if (e.kind !== 'unit' || e.garrisonId) continue;
      const def = unitDef(e.defId);
      if (def.domain === 'air' && e.aircraft) {
        this.orderAircraftReturn(e);
      } else if (def.domain === 'naval') {
        const home = this.getEntity(e.homeId);
        if (home && home.hp > 0) {
          e.order = { type: 'return', x: home.x, z: home.z };
          const path = this.findPathFor(e, home.x, home.z);
          e.path = path ?? [];
          e.pathIndex = 0;
          e.destX = home.x;
          e.destZ = home.z;
          e.state = 'returning';
        }
      } else if (e.harvester) {
        this.sendHarvesterToRefinery(e);
      }
    }
  }

  /**
   * Dive or surface a submarine. Diving is refused on a depleted battery so a
   * player cannot cycle the stealth state faster than the endurance model
   * allows. The order does not cancel movement: a boat can dive while it runs.
   */
  private commandDive(owner: number, ids: number[], dive: boolean): void {
    for (const e of this.ownedEntities(owner, ids)) {
      if (e.kind !== 'unit' || e.garrisonId) continue;
      const def = unitDef(e.defId);
      const sub = e.submarine;
      if (!def.submarine || !sub) continue;
      if (dive) {
        if (sub.dived) continue;
        if (sub.battery < sub.maxBattery * 0.2) {
          this.emit('orderFailed', {
            team: owner,
            x: e.x,
            z: e.z,
            text: `${def.name} battery too low to dive.`,
            entityId: e.id,
            defId: e.defId,
            level: 'warning',
            sound: 'denied',
          });
          continue;
        }
        sub.dived = true;
        this.emit('orderAck', {
          team: owner,
          x: e.x,
          z: e.z,
          text: `${def.name} diving`,
          entityId: e.id,
          defId: e.defId,
          code: 'moveOrder',
          level: 'info',
        });
      } else {
        if (!sub.dived) continue;
        sub.dived = false;
        sub.revealed = false;
        sub.revealTimer = 0;
        this.emit('orderAck', {
          team: owner,
          x: e.x,
          z: e.z,
          text: `${def.name} surfacing`,
          entityId: e.id,
          defId: e.defId,
          code: 'moveOrder',
          level: 'info',
        });
      }
    }
  }

  private commandCapture(owner: number, ids: number[], targetId: number): void {
    const target = this.getEntity(targetId);
    const targetDef = target ? BUILDINGS[target.defId] : undefined;
    if (
      !target ||
      target.kind !== 'building' ||
      !targetDef?.capturable ||
      target.hp <= 0 ||
      target.construction
    ) {
      this.emit('orderFailed', {
        team: owner,
        x: target?.x ?? 0,
        z: target?.z ?? 0,
        text: 'Only capturable strategic infrastructure can be seized.',
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    if (target.owner === owner) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: `That ${targetDef.name.toLowerCase()} is already ours.`,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const engineers = this.ownedEntities(owner, ids).filter(
      (e) => e.kind === 'unit' && unitDef(e.defId).canCapture && !e.garrisonId,
    );
    if (engineers.length === 0) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: 'Select a Combat Engineer to capture the objective.',
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    let accepted = 0;
    for (const e of engineers) {
      const path = this.findPathFor(e, target.x, target.z);
      if (!path) {
        this.emit('orderFailed', {
          team: owner,
          x: e.x,
          z: e.z,
          text: `${entityName(e)} cannot reach the ${targetDef.name.toLowerCase()}.`,
          level: 'warning',
          entityId: e.id,
          sound: 'denied',
        });
        continue;
      }
      this.releaseBuildTarget(e);
      e.order = { type: 'capture', targetId: target.id, x: target.x, z: target.z };
      e.captureTargetId = target.id;
      e.captureProgress = 0;
      e.path = path;
      e.pathIndex = 0;
      e.destX = target.x;
      e.destZ = target.z;
      e.state = 'capturing';
      accepted++;
    }
    if (accepted === 0) return;
    this.emit('orderAck', {
      team: owner,
      x: target.x,
      z: target.z,
      text: `Engineer en route to capture ${targetDef.name.toLowerCase()}`,
      entityId: target.id,
      level: 'info',
    });
  }

  /**
   * A structure an engineer may work on: the team's own, or a neutral shelter.
   * A neutral shelter is repairable whether or not infantry are inside it, so
   * an engineer can prepare a position before occupying it. A shelter held by
   * hostile infantry is not a repair job; it has to be cleared first.
   */
  /** The player's own construction site, still standing and still unfinished. */
  private isOwnSite(owner: number, target: Entity): boolean {
    return (
      target.kind === 'building' &&
      !!target.construction &&
      target.hp > 0 &&
      target.owner === owner &&
      target.buildProgress < 1
    );
  }

  private isRepairableBy(owner: number, target: Entity): boolean {
    if (target.kind !== 'building' || target.construction || target.hp >= target.maxHp) {
      return false;
    }
    const def = BUILDINGS[target.defId];
    // A dropped span is a repair job, not a ruin: its wreckage is still on the
    // map, and re-decking it reopens the crossing for both sides.
    if (def?.walkable) return target.owner === owner || target.owner === -1;
    if (target.hp <= 0) return false;
    if (target.owner === owner) return true;
    if (!BUILDINGS[target.defId]?.garrison) return false;
    if (target.owner !== -1) return false;
    return !this.garrisonOccupants(target.id).some((unit) => this.isHostile(owner, unit.owner));
  }

  private commandRepair(owner: number, ids: number[], targetId: number): void {
    const target = this.getEntity(targetId);
    // A paused construction site is not damaged, so it is not a repair job —
    // but it is the same engineer standing at the same place doing the same
    // work, and the player reaches it with the same order. Calling a builder
    // away (or a fight leaving one shot off the site) paused the structure at
    // whatever percentage it had reached and there was no way back: the site
    // refused repair, and the automatic assignment only offers a site to an
    // engineer with no order at all. Resume it explicitly instead.
    if (target && this.isOwnSite(owner, target)) {
      const builders = this.ownedEntities(owner, ids).filter(
        (e) => e.kind === 'unit' && unitDef(e.defId).canBuild,
      );
      if (builders.length === 0) {
        this.emit('orderFailed', {
          team: owner,
          x: target.x,
          z: target.z,
          text: 'Select a Combat Engineer to resume construction.',
          level: 'warning',
          sound: 'denied',
        });
        return;
      }
      for (const e of builders) {
        e.targetId = 0;
        e.aimTargetId = 0;
        e.captureTargetId = 0;
        e.captureProgress = 0;
        e.healTargetId = 0;
        this.assignBuilderToSite(e, target);
      }
      this.emit('orderAck', {
        team: owner,
        x: target.x,
        z: target.z,
        text: `Engineer en route to resume ${buildingDef(target.defId).name.toLowerCase()} construction`,
        entityId: target.id,
        level: 'info',
      });
      return;
    }
    if (!target || !this.isRepairableBy(owner, target)) {
      this.emit('orderFailed', {
        team: owner,
        x: target?.x ?? 0,
        z: target?.z ?? 0,
        text: 'Only a damaged friendly structure, a neutral shelter or your own construction site can be worked on.',
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const engineers = this.ownedEntities(owner, ids).filter(
      (e) => e.kind === 'unit' && unitDef(e.defId).canBuild,
    );
    if (engineers.length === 0) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: 'Select a Combat Engineer to repair the structure.',
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    for (const e of engineers) {
      this.releaseBuildTarget(e);
      e.order = { type: 'repair', targetId: target.id, x: target.x, z: target.z };
      e.targetId = 0;
      e.aimTargetId = 0;
      e.captureTargetId = 0;
      e.captureProgress = 0;
      e.healTargetId = 0;
      // Reuse the construction approach point: just outside the footprint,
      // within working range of the structure centre.
      this.walkEngineerToSite(e, target);
    }
    const underFire = this.state.tick - target.lastHitTick < REPAIR_SUPPRESSION_TICKS;
    this.emit('orderAck', {
      team: owner,
      x: target.x,
      z: target.z,
      text: underFire
        ? 'Engineer en route — repair suspended under fire'
        : 'Engineer en route to repair structure',
      entityId: target.id,
      level: 'info',
    });
  }

  /* ------------------------------------------------------------------ */
  /* Garrisons                                                          */
  /* ------------------------------------------------------------------ */

  /** Living infantry inside a building, in stable id order. */
  garrisonOccupants(buildingId: number): Entity[] {
    return this.state.entities
      .filter((e) => e.kind === 'unit' && e.hp > 0 && e.garrisonId === buildingId)
      .sort((a, b) => a.id - b.id);
  }

  /**
   * Distance from a point to the outer edge of a structure's footprint, in
   * world units. Zero inside the walls, so door checks work the same for every
   * footprint size.
   */
  private structureClearance(building: Entity, x: number, z: number): number {
    const def = buildingDef(building.defId);
    const left = building.x / TILE_SIZE - def.footprint.w / 2;
    const top = building.z / TILE_SIZE - def.footprint.h / 2;
    const tx = x / TILE_SIZE;
    const tz = z / TILE_SIZE;
    const dx = Math.max(left - tx, 0, tx - (left + def.footprint.w));
    const dz = Math.max(top - tz, 0, tz - (top + def.footprint.h));
    return Math.hypot(dx, dz) * TILE_SIZE;
  }

  /**
   * Walkable tile just outside the footprint. Candidates are scored by how
   * close they are to the wall (not the centre, which unfairly favours small
   * buildings) and by the walk from the unit, and the first one with a real
   * path wins so a walled side does not hide an open approach.
   */
  private findGarrisonApproach(
    unit: Entity,
    building: Entity,
  ): { path: PathPoint[]; x: number; z: number } | null {
    const def = buildingDef(building.defId);
    const top = Math.round(building.x / TILE_SIZE - def.footprint.w / 2);
    const left = Math.round(building.z / TILE_SIZE - def.footprint.h / 2);
    const candidates: Array<{ x: number; z: number; d: number; c: number }> = [];
    for (let ring = 1; ring <= 3; ring++) {
      for (let z = left - ring; z < left + def.footprint.h + ring; z++) {
        for (let x = top - ring; x < top + def.footprint.w + ring; x++) {
          const onRing =
            x === top - ring ||
            x === top + def.footprint.w + ring - 1 ||
            z === left - ring ||
            z === left + def.footprint.h + ring - 1;
          if (!onRing) continue;
          if (!inBounds(this.state.map.width, this.state.map.height, x, z)) continue;
          const idx = tileIndex(this.state.map.width, x, z);
          if (this.blocked[idx]) continue;
          if (!canStandOn(this.state.map.width, this.state.map.height, this.state.map.terrain, idx, 'foot')) continue;
          const wx = (x + 0.5) * TILE_SIZE;
          const wz = (z + 0.5) * TILE_SIZE;
          // A door outside the entry clearance would cancel the order on arrival.
          const clearance = this.structureClearance(building, wx, wz);
          if (clearance > GARRISON_APPROACH_CLEARANCE) continue;
          candidates.push({ x: wx, z: wz, d: dist(unit.x, unit.z, wx, wz), c: clearance });
        }
      }
    }
    candidates.sort((a, b) => a.d - b.d || a.c - b.c || a.z - b.z || a.x - b.x);
    for (const candidate of candidates) {
      const path = this.findPathFor(unit, candidate.x, candidate.z);
      if (path) return { path, x: candidate.x, z: candidate.z };
    }
    return null;
  }

  private commandGarrison(owner: number, ids: number[], targetId: number): void {
    const target = this.getEntity(targetId);
    const def = target ? BUILDINGS[target.defId] : undefined;
    if (!target || target.kind !== 'building' || target.hp <= 0 || !def?.garrison) {
      this.emit('orderFailed', {
        team: owner,
        x: target?.x ?? 0,
        z: target?.z ?? 0,
        text: 'This structure cannot be garrisoned.',
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    if (this.isHostile(owner, target.owner)) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: 'Enemy-held buildings cannot be entered. Clear them first.',
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const occupants = this.garrisonOccupants(target.id);
    if (occupants.some((occupant) => this.isHostile(owner, occupant.owner))) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: 'Hostile infantry hold that building. Clear it before occupying it.',
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    if (target.hp / target.maxHp <= GARRISON_ABANDON_FRACTION) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: `${def.name} is too badly damaged to hold infantry — repair it first.`,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const occupied = occupants.length;
    const remaining = Math.max(0, def.garrison.capacity - occupied);
    if (remaining <= 0) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: `${def.name} is full (${occupied}/${def.garrison.capacity}).`,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const eligible = this.ownedEntities(owner, ids)
      .filter((e) => e.kind === 'unit' && e.hp > 0 && !e.garrisonId && !!unitDef(e.defId).canGarrison)
      .sort((a, b) => a.id - b.id);
    if (eligible.length === 0) {
      this.emit('orderFailed', {
        team: owner,
        x: target.x,
        z: target.z,
        text: 'Only infantry can garrison a building.',
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    let accepted = 0;
    for (const unit of eligible) {
      if (accepted >= remaining) break;
      const approach = this.findGarrisonApproach(unit, target);
      if (!approach) {
        this.emit('orderFailed', {
          team: owner,
          x: unit.x,
          z: unit.z,
          text: `${entityName(unit)} cannot reach a door at ${def.name}.`,
          level: 'warning',
          entityId: unit.id,
          sound: 'denied',
        });
        continue;
      }
      this.releaseBuildTarget(unit);
      unit.order = { type: 'garrison', targetId: target.id, x: target.x, z: target.z };
      unit.path = approach.path;
      unit.pathIndex = 0;
      unit.destX = approach.x;
      unit.destZ = approach.z;
      unit.targetId = 0;
      unit.aimTargetId = 0;
      unit.captureTargetId = 0;
      unit.captureProgress = 0;
      // The approach budget counts ticks without progress, so a unit that has
      // been standing guard for a while starts with a clean slate.
      unit.blockedTicks = 0;
      unit.state = 'moving';
      accepted++;
    }
    if (accepted === 0) return;
    this.emit('orderAck', {
      team: owner,
      x: target.x,
      z: target.z,
      text: `${accepted} infantry moving to garrison ${def.name}`,
      entityId: target.id,
      level: 'info',
    });
  }

  private commandUngarrison(owner: number, ids: number[]): void {
    const buildings = new Set<Entity>();
    for (const id of ids) {
      const e = this.getEntity(id);
      if (!e) continue;
      if (e.kind === 'building') {
        if (this.garrisonOccupants(e.id).some((unit) => unit.owner === owner)) buildings.add(e);
      } else if (e.kind === 'unit' && e.owner === owner && e.garrisonId) {
        const building = this.getEntity(e.garrisonId);
        if (building) buildings.add(building);
      }
    }
    if (buildings.size === 0) {
      this.emit('orderFailed', {
        team: owner,
        x: 0,
        z: 0,
        text: 'Select garrisoned infantry or an occupied building to order them out.',
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    for (const building of [...buildings].sort((a, b) => a.id - b.id)) {
      if (!this.exitGarrisonBuilding(building, owner)) {
        this.emit('orderFailed', {
          team: owner,
          x: building.x,
          z: building.z,
          text: `No safe exit from ${buildingDef(building.defId).name}; occupants remain inside.`,
          level: 'warning',
          entityId: building.id,
          sound: 'denied',
        });
      }
    }
  }

  private enterGarrison(unit: Entity, building: Entity): boolean {
    const def = BUILDINGS[building.defId];
    if (!def?.garrison || unit.garrisonId || unit.hp <= 0 || building.hp <= 0) return false;
    if (this.isHostile(unit.owner, building.owner)) {
      unit.order = null;
      unit.path = [];
      unit.state = 'idle';
      return false;
    }
    const current = this.garrisonOccupants(building.id);
    if (current.some((occupant) => this.isHostile(unit.owner, occupant.owner))) {
      unit.order = null;
      unit.path = [];
      unit.state = 'idle';
      this.emit('orderFailed', {
        team: unit.owner,
        x: building.x,
        z: building.z,
        text: `${def.name} is held by hostile infantry. Clear it first.`,
        level: 'warning',
        entityId: unit.id,
        sound: 'denied',
      });
      return false;
    }
    if (building.hp / building.maxHp <= GARRISON_ABANDON_FRACTION) {
      unit.order = null;
      unit.path = [];
      unit.state = 'idle';
      this.emit('orderFailed', {
        team: unit.owner,
        x: building.x,
        z: building.z,
        text: `${def.name} is too badly damaged to hold infantry.`,
        level: 'warning',
        entityId: unit.id,
        sound: 'denied',
      });
      return false;
    }
    if (current.length >= def.garrison.capacity) {
      unit.order = null;
      unit.path = [];
      unit.state = 'idle';
      this.emit('orderFailed', {
        team: unit.owner,
        x: building.x,
        z: building.z,
        text: `${def.name} filled before ${entityName(unit)} arrived.`,
        level: 'warning',
        entityId: unit.id,
        sound: 'denied',
      });
      return false;
    }
    unit.garrisonId = building.id;
    unit.x = building.x;
    unit.z = building.z;
    unit.facing = building.facing;
    unit.turretFacing = building.facing;
    unit.state = 'garrisoned';
    unit.order = null;
    unit.path = [];
    unit.pathIndex = 0;
    unit.destX = unit.x;
    unit.destZ = unit.z;
    unit.guardX = unit.x;
    unit.guardZ = unit.z;
    unit.targetId = 0;
    unit.aimTargetId = 0;
    unit.captureTargetId = 0;
    unit.captureProgress = 0;
    const count = current.length + 1;
    this.emit('notice', {
      team: unit.owner,
      x: building.x,
      z: building.z,
      text: `${entityName(unit)} garrisoned ${def.name} (${count}/${def.garrison.capacity})`,
      entityId: building.id,
      level: 'info',
      sound: 'ui',
    });
    return true;
  }

  private isExitClear(
    x: number,
    z: number,
    radius: number,
    planned: Array<{ x: number; z: number; radius: number }>,
  ): boolean {
    for (const other of this.state.entities) {
      if (other.kind !== 'unit' || other.hp <= 0 || other.garrisonId) continue;
      const min = (radius + unitDef(other.defId).radius) * 0.7;
      if (dist2(x, z, other.x, other.z) < min * min) return false;
    }
    for (const other of planned) {
      const min = (radius + other.radius) * 0.7;
      if (dist2(x, z, other.x, other.z) < min * min) return false;
    }
    return true;
  }

  private findExitSpot(
    building: Entity,
    radius: number,
    planned: Array<{ x: number; z: number; radius: number }>,
  ): { x: number; z: number } | null {
    const def = buildingDef(building.defId);
    const left = Math.round(building.x / TILE_SIZE - def.footprint.w / 2);
    const top = Math.round(building.z / TILE_SIZE - def.footprint.h / 2);
    const candidates: Array<{ x: number; z: number; d: number }> = [];
    for (let ring = 1; ring <= 8; ring++) {
      for (let z = top - ring; z < top + def.footprint.h + ring; z++) {
        for (let x = left - ring; x < left + def.footprint.w + ring; x++) {
          const onRing =
            x === left - ring ||
            x === left + def.footprint.w + ring - 1 ||
            z === top - ring ||
            z === top + def.footprint.h + ring - 1;
          if (!onRing) continue;
          if (!inBounds(this.state.map.width, this.state.map.height, x, z)) continue;
          const idx = tileIndex(this.state.map.width, x, z);
          if (this.blocked[idx]) continue;
          if (!canStandOn(this.state.map.width, this.state.map.height, this.state.map.terrain, idx, 'foot')) continue;
          const wx = (x + 0.5) * TILE_SIZE;
          const wz = (z + 0.5) * TILE_SIZE;
          if (!this.isExitClear(wx, wz, radius, planned)) continue;
          candidates.push({ x: wx, z: wz, d: dist(wx, wz, building.x, building.z) });
        }
      }
      if (candidates.length > 0) break;
    }
    candidates.sort((a, b) => a.d - b.d || a.z - b.z || a.x - b.x);
    const spot = candidates[0];
    return spot ? { x: spot.x, z: spot.z } : null;
  }

  private exitGarrisonBuilding(building: Entity, owner: number): boolean {
    const occupants = this.garrisonOccupants(building.id).filter((e) => e.owner === owner);
    if (occupants.length === 0) return false;
    const planned: Array<{ x: number; z: number; radius: number }> = [];
    for (const unit of occupants) {
      const radius = unitDef(unit.defId).radius;
      const spot = this.findExitSpot(building, radius, planned);
      if (!spot) return false;
      planned.push({ ...spot, radius });
    }
    for (let i = 0; i < occupants.length; i++) {
      const unit = occupants[i];
      const spot = planned[i];
      unit.garrisonId = 0;
      unit.x = spot.x;
      unit.z = spot.z;
      unit.destX = spot.x;
      unit.destZ = spot.z;
      unit.guardX = spot.x;
      unit.guardZ = spot.z;
      unit.order = null;
      unit.path = [];
      unit.pathIndex = 0;
      unit.state = 'idle';
      unit.targetId = 0;
      unit.aimTargetId = 0;
      unit.captureTargetId = 0;
      unit.captureProgress = 0;
      unit.blockedTicks = 0;
    }
    this.emit('orderAck', {
      team: owner,
      x: building.x,
      z: building.z,
      text: `${occupants.length} infantry exited ${buildingDef(building.defId).name}`,
      entityId: building.id,
      level: 'info',
      sound: 'ui',
    });
    return true;
  }

  /**
   * Move a garrison-bound infantryman to the building and put them inside.
   * Returns true when the order finished (entered or cancelled) and the normal
   * movement/combat path should be skipped this tick.
   */
  private updateGarrisonOrder(unit: Entity): boolean {
    if (unit.order?.type !== 'garrison') return false;
    const building = this.getEntity(unit.order.targetId ?? 0);
    const def = building ? BUILDINGS[building.defId] : undefined;
    if (!building || !def?.garrison || building.hp <= 0 || this.isHostile(unit.owner, building.owner)) {
      unit.order = null;
      unit.path = [];
      unit.state = 'idle';
      return true;
    }
    if (this.structureClearance(building, unit.x, unit.z) <= GARRISON_ENTRY_CLEARANCE) {
      this.enterGarrison(unit, building);
      return true;
    }
    if (unit.path.length > 0) return false;
    // Arrived short of the wall, or the route collapsed on the way (a fresh
    // structure, a crowd, a jammed corridor). Take a fresh approach until the
    // no-progress budget runs out instead of abandoning the order at the curb.
    if (unit.blockedTicks <= GARRISON_APPROACH_BUDGET) {
      const approach = this.findGarrisonApproach(unit, building);
      if (approach) {
        unit.path = approach.path;
        unit.pathIndex = 0;
        unit.destX = approach.x;
        unit.destZ = approach.z;
        unit.state = approach.path.length > 0 ? 'moving' : 'idle';
        return true;
      }
    }
    unit.order = null;
    unit.state = 'idle';
    this.emit('orderFailed', {
      team: unit.owner,
      x: building.x,
      z: building.z,
      text: `${entityName(unit)} could not reach ${def.name}.`,
      level: 'warning',
      entityId: unit.id,
      sound: 'denied',
    });
    return true;
  }

  private updateGarrisons(dt: number): void {
    const occupants = new Map<number, Entity[]>();
    for (const e of this.state.entities) {
      if (e.kind !== 'unit' || e.hp <= 0 || !e.garrisonId) continue;
      const list = occupants.get(e.garrisonId) ?? [];
      list.push(e);
      occupants.set(e.garrisonId, list);
    }
    for (const building of [...this.state.entities].sort((a, b) => a.id - b.id)) {
      if (building.kind !== 'building' || building.hp <= 0) continue;
      const cfg = BUILDINGS[building.defId]?.garrison;
      if (!cfg) continue;
      const inside = (occupants.get(building.id) ?? []).sort((a, b) => a.id - b.id);
      for (const unit of inside) {
        unit.x = building.x;
        unit.z = building.z;
        unit.state = 'garrisoned';
        unit.cooldown = Math.max(0, unit.cooldown - dt);
        unit.suppression = Math.max(0, unit.suppression - dt * 0.12);
      }
      // Rotate the available firing positions so one occupant cannot starve
      // the others of every shot. The offset is deterministic (tick + id).
      let shots = 0;
      const start = inside.length > 0 ? (this.state.tick + building.id) % inside.length : 0;
      for (let offset = 0; offset < inside.length; offset++) {
        if (shots >= cfg.firingSlots) break;
        const unit = inside[(start + offset) % inside.length];
        const weapons = entityWeapons(unit);
        if (weapons.length === 0 || unit.cooldown > 0) continue;
        const acquired = this.acquireAutoTarget(unit, weapons);
        if (!acquired) continue;
        unit.targetId = acquired.target.id;
        unit.aimTargetId = acquired.target.id;
        this.tryFire(unit, acquired.target, acquired.weapon, weapons);
        shots++;
      }
    }
  }

  /** Split part of a structure hit through the garrison envelope. */
  private damageGarrison(
    building: Entity,
    weapon: WeaponDef,
    baseDamage: number,
    projectileId: number,
    attackerOwner: number,
    shooterId: number,
    direct = false,
  ): void {
    const cfg = BUILDINGS[building.defId]?.garrison;
    if (!cfg) return;
    const inside = this.garrisonOccupants(building.id);
    if (inside.length === 0) return;
    // Only the round that strikes the building reaches the occupants; nearby
    // splash still suppresses the shelter but does not select a victim.
    if (!direct) return;
    const index = Math.abs(projectileId + this.state.tick) % inside.length;
    const occupant = inside[index];
    // Cover blocks a share of the direct hit; exposure only governs how much
    // suppression reaches the occupied space. Protection is therefore the
    // number the HUD shows and the fraction the damage model applies.
    const raw = baseDamage * (1 - cfg.protection);
    const damage = computeDamage(raw, weapon.multipliers, 'infantry');
    if (damage <= 0) return;
    occupant.suppression = Math.min(1, occupant.suppression + weapon.suppression * cfg.exposure);
    this.damageEntity(occupant, damage, attackerOwner, shooterId, weapon.id);
  }

  /**
   * A shelter below a quarter integrity is no longer tenable. Everyone inside
   * is driven out — by every owner, since a neutral block can hold occupants
   * from both sides — and the exits are reused so nobody is sealed inside.
   */
  private expelFromCollapsingShelter(building: Entity): void {
    if (building.kind !== 'building') return;
    const cfg = BUILDINGS[building.defId]?.garrison;
    if (!cfg) return;
    if (building.hp > 0 && building.hp / building.maxHp > GARRISON_ABANDON_FRACTION) return;
    const inside = this.garrisonOccupants(building.id);
    if (inside.length === 0) return;
    const owners = [...new Set(inside.map((unit) => unit.owner))].sort((a, b) => a - b);
    let expelled = 0;
    for (const owner of owners) {
      if (this.exitGarrisonBuilding(building, owner)) expelled++;
    }
    if (expelled === 0) return;
    this.emit('notice', {
      team: building.owner >= 0 ? building.owner : owners[0],
      x: building.x,
      z: building.z,
      text: `${buildingDef(building.defId).name} is collapsing — infantry driven out`,
      entityId: building.id,
      level: 'warning',
      sound: 'explosion',
    });
  }

  /** A destroyed shelter kills every occupant outright, so none are left sealed inside. */
  private destroyGarrison(building: Entity, attackerOwner: number): void {
    const inside = this.garrisonOccupants(building.id);
    if (inside.length === 0) return;
    const lostByOwner = new Map<number, number>();
    for (const unit of inside) {
      const victim = this.player(unit.owner);
      unit.hp = 0;
      unit.state = 'dead';
      unit.order = null;
      unit.path = [];
      unit.garrisonId = 0;
      if (victim) {
        victim.stats.unitsLost++;
        lostByOwner.set(unit.owner, (lostByOwner.get(unit.owner) ?? 0) + 1);
      }
    }
    // A neutral shelter has no player to notify; tell each occupant's owner
    // about their own losses instead of routing the notice to team -1.
    for (const [owner, count] of [...lostByOwner].sort((a, b) => a[0] - b[0])) {
      this.emit('notice', {
        team: owner,
        x: building.x,
        z: building.z,
        text: `${count} infantry lost with ${buildingDef(building.defId).name}`,
        entityId: building.id,
        level: 'critical',
        sound: 'explosion',
      });
    }
    void attackerOwner;
  }

  /** Exact content of a capture confirmation, shared by every objective. */
  private captureText(defId: string): string {
    const def = BUILDINGS[defId];
    if (!def) return 'Objective captured';
    const benefit = structureBenefit(def);
    return benefit
      ? `${def.name} captured — ${benefit}`
      : `${def.name} captured`;
  }

  /* ------------------------------------------------------------------ */
  /* Research: authoritative progression                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Scenario authoring grants technologies explicitly, and a pre-placed
   * structure or unit grants the technology that unlocks its slot. Without the
   * implicit grant an authored airfield would open the match with an air arm
   * the player is not yet allowed to replace, which is exactly the trap the
   * research gate is meant to avoid on a fresh build.
   */
  private grantScenarioResearch(): void {
    const granted = new Map<number, Set<string>>();
    for (const p of this.state.players) granted.set(p.id, new Set<string>());
    for (const entry of this.state.scenario.players) {
      const set = granted.get(entry.id);
      if (!set) continue;
      for (const id of entry.technologies ?? []) {
        if (techDef(id, this.research)) set.add(id);
      }
    }
    for (const entity of this.state.entities) {
      const set = granted.get(entity.owner);
      if (!set) continue;
      const slot = entity.kind === 'unit' ? unitFamily(entity.defId) : buildingFamily(entity.defId);
      if (entity.kind === 'unit') {
        const exclusive = exclusiveUnitTech(entity.defId);
        if (exclusive) set.add(exclusive);
      }
      for (const tech of this.research.techs) {
        const implies = tech.effects.some(
          (effect) =>
            (effect.kind === 'unlockUnit' && effect.slot === slot) ||
            (effect.kind === 'unlockBuilding' && effect.slot === slot),
        );
        if (implies) set.add(tech.id);
      }
    }
    // Nothing else is granted here. An AI seat studies the tree exactly like a
    // human one, through the Research Centre and the research command; the
    // Stage 4B.1 convenience grant that filled an AI's tree at match start is
    // gone so research availability is identical for every seat.
    for (const p of this.state.players) {
      const set = granted.get(p.id);
      if (!set || set.size === 0) continue;
      // A pre-placed tier-2 exclusive implies its branch's tier 1 as well. Close
      // the grant over prerequisites until stable, otherwise the saved record
      // would contain a technology whose prerequisite is absent and the loader
      // would rightly prune it on reload.
      let changed = true;
      while (changed) {
        changed = false;
        for (const tech of this.research.techs) {
          if (!set.has(tech.id)) continue;
          for (const required of tech.requires) {
            if (set.has(required)) continue;
            set.add(required);
            changed = true;
          }
        }
      }
      // Catalogue order, not set insertion order: the completed list is part of
      // the state hash and must not depend on entity iteration.
      p.research.completed = this.research.techs
        .filter((tech) => set.has(tech.id))
        .map((tech) => tech.id);
    }
  }

  /** The fastest operational Research Centre, or null when the project cannot run. */
  private operationalResearchCentre(owner: number): Entity | null {
    let best: Entity | null = null;
    let bestSpeed = Infinity;
    for (const e of this.state.entities) {
      if (e.owner !== owner || e.kind !== 'building' || e.hp <= 0 || e.construction) continue;
      if (buildingFamily(e.defId) !== 'researchCentre') continue;
      const speed = BUILDINGS[e.defId]?.researchSpeed ?? 1;
      if (speed < bestSpeed) {
        best = e;
        bestSpeed = speed;
      }
    }
    return best;
  }

  /** Whether this player has an operational centre that can run a project. */
  hasResearchCentre(owner: number): boolean {
    return this.operationalResearchCentre(owner) !== null;
  }

  /** The centre commands must name, or null when no centre can run a project. */
  researchCentreId(owner: number): number | null {
    return this.operationalResearchCentre(owner)?.id ?? null;
  }

  /**
   * Current effective research multiplier for a player. Zero when no centre is
   * operational; otherwise the centre's own speed, fitted research modules and
   * the grid brownout multiplier. The progress clock and the panel both read
   * this, so the displayed rate cannot drift from the simulation.
   */
  researchRate(owner: number): number {
    const centre = this.operationalResearchCentre(owner);
    if (!centre) return 0;
    const moduleSpeed = centre.modules?.length
      ? installedModuleEffects(centre.modules, this.research).researchSpeed
      : 1;
    return (
      (BUILDINGS[centre.defId]?.researchSpeed ?? 1) * moduleSpeed * this.powerSpeed(owner)
    );
  }

  /**
   * Why an active project is not advancing at full speed, or null when it is.
   * The project survives a lost centre, so this is a pause explanation rather
   * than a reason to discard it.
   */
  researchPauseReason(owner: number): string | null {
    const p = this.player(owner);
    if (!p?.research.project) return null;
    if (!this.operationalResearchCentre(owner)) {
      return 'PAUSED — no operational Research Centre';
    }
    const power = this.powerStatus(owner);
    if (power.brownout) {
      return `SLOWED — grid brownout (${Math.round(this.researchRate(owner) * 100)}% speed)`;
    }
    return null;
  }

  /**
   * Catalogue eligibility for a technology: alliance and nation restrictions
   * only, with no reference to a centre, a project or the bank.
   *
   * `researchStatus` defers to this, and the AI research planner asks the same
   * method, so a restricted node cannot be ordered by a client and cannot be
   * chosen as a target by a commander either.
   */
  techEligibility(owner: number, techId: string): { ok: boolean; reason: string } {
    const p = this.player(owner);
    if (!p) return { ok: false, reason: 'Unknown player.' };
    const tech = techDef(techId, this.research);
    if (!tech) return { ok: false, reason: 'Unknown technology.' };
    const identity = tryIdentityDef(p.factionId);
    if (tech.alliances && (!identity || !tech.alliances.includes(identity.allianceId))) {
      return { ok: false, reason: `${tech.name} is not available to this alliance.` };
    }
    if (tech.nations && !tech.nations.includes(p.factionId)) {
      return { ok: false, reason: `${tech.name} is not available to this nation.` };
    }
    // The operation's own limits outrank the catalogue: a theatre with no air
    // support cannot be given an airfield by studying one.
    if (this.techRestrictedByOperation(owner, tech.id)) {
      return { ok: false, reason: `${tech.name} is not available in this operation.` };
    }
    // An authority node is only worth studying where the capability it unlocks
    // can actually be called in, so a battle without superweapons (or a nation
    // without one) must not offer the chain as a research option.
    if (tech.strategic && (!this.superweaponEnabled() || !this.superweaponFamilyFor(owner))) {
      return {
        ok: false,
        reason: this.superweaponEnabled()
          ? 'This nation fields no strategic superweapon.'
          : 'Strategic superweapons are disabled for this battle.',
      };
    }
    return { ok: true, reason: '' };
  }

  /**
   * Why a project cannot start. The same answer is used by the command handler,
   * the command gate and the future research panel, so a locked node never looks
   * affordable to a client that the simulation would refuse.
   */
  researchStatus(
    owner: number,
    buildingId: number,
    techId: string,
  ): { ok: boolean; reason: string } {
    const p = this.player(owner);
    if (!p) return { ok: false, reason: 'Unknown player.' };
    const centre = this.getEntity(buildingId);
    if (
      !centre ||
      centre.kind !== 'building' ||
      centre.owner !== owner ||
      centre.hp <= 0 ||
      centre.construction ||
      !!centre.deconstruct ||
      buildingFamily(centre.defId) !== 'researchCentre'
    ) {
      return { ok: false, reason: 'An operational Research Centre is required.' };
    }
    const tech = techDef(techId, this.research);
    if (!tech) return { ok: false, reason: 'Unknown technology.' };
    if (p.research.project) return { ok: false, reason: 'A research project is already in progress.' };
    if (p.research.completed.includes(tech.id)) {
      return { ok: false, reason: `${tech.name} is already researched.` };
    }
    const eligibility = this.techEligibility(owner, tech.id);
    if (!eligibility.ok) return eligibility;
    const missing = tech.requires.filter((id) => !p.research.completed.includes(id));
    if (missing.length > 0) {
      const names = missing.map((id) => techDef(id, this.research)?.name ?? id);
      return { ok: false, reason: `Requires ${names.join(' and ')}.` };
    }
    if (p.mats < tech.cost.mats) return { ok: false, reason: 'Insufficient materials.' };
    if (p.req < tech.cost.req) return { ok: false, reason: 'Insufficient requisition.' };
    return { ok: true, reason: '' };
  }

  /** Why the player cannot cancel right now (the centre must still be usable). */
  cancelResearchStatus(owner: number, buildingId: number): { ok: boolean; reason: string } {
    const p = this.player(owner);
    if (!p) return { ok: false, reason: 'Unknown player.' };
    if (!p.research.project) return { ok: false, reason: 'No research project is in progress.' };
    const centre = this.getEntity(buildingId);
    if (
      !centre ||
      centre.kind !== 'building' ||
      centre.owner !== owner ||
      centre.hp <= 0 ||
      centre.construction ||
      !!centre.deconstruct ||
      buildingFamily(centre.defId) !== 'researchCentre'
    ) {
      return { ok: false, reason: 'An operational Research Centre is required.' };
    }
    return { ok: true, reason: '' };
  }

  private commandResearch(owner: number, buildingId: number, techId: string): void {
    const status = this.researchStatus(owner, buildingId, techId);
    const centre = this.getEntity(buildingId);
    if (!status.ok) {
      this.emit('orderFailed', {
        team: owner,
        x: centre?.x ?? 0,
        z: centre?.z ?? 0,
        text: status.reason,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const p = this.player(owner)!;
    const tech = techDef(techId, this.research)!;
    p.mats -= tech.cost.mats;
    p.req -= tech.cost.req;
    p.research.project = { techId: tech.id, remaining: tech.seconds, total: tech.seconds };
    this.emit('orderAck', {
      team: owner,
      x: centre!.x,
      z: centre!.z,
      text: `${tech.name} research started`,
      entityId: centre!.id,
      level: 'info',
      sound: 'queue',
      code: 'researchStarted',
    });
  }

  private commandCancelResearch(owner: number, buildingId: number): void {
    const status = this.cancelResearchStatus(owner, buildingId);
    if (!status.ok) return;
    const p = this.player(owner)!;
    const project = p.research.project!;
    const tech = techDef(project.techId, this.research);
    if (tech) {
      p.mats += tech.cost.mats;
      p.req += tech.cost.req;
    }
    p.research.project = null;
    const centre = this.getEntity(buildingId);
    this.emit('orderAck', {
      team: owner,
      x: centre?.x ?? 0,
      z: centre?.z ?? 0,
      text: `${tech?.name ?? project.techId} research cancelled — resources refunded`,
      entityId: centre?.id,
      level: 'info',
      code: 'researchCancelled',
    });
  }

  /**
   * One fixed-tick step of the player's project.
   *
   * The project lives on the player, not the centre, so it survives the centre
   * being destroyed: no operational centre means no progress, not a loss of the
   * materials already spent. A brownout slows the work exactly as it slows
   * production. Completion is removed from the project before the event is
   * emitted, so a project can only complete once.
   */
  private updateResearch(dt: number): void {
    for (const p of this.state.players) {
      const project = p.research.project;
      if (!project || p.defeated) continue;
      const centre = this.operationalResearchCentre(p.id);
      if (!centre) continue;
      const tech = techDef(project.techId, this.research);
      if (!tech) {
        p.research.project = null;
        continue;
      }
      // One rate resolver for the clock and the panel: the centre's base speed,
      // fitted modules and the grid multiplier cannot disagree.
      const speed = this.researchRate(p.id);
      if (speed <= 0) continue;
      project.remaining = Math.max(0, project.remaining - dt * speed);
      // Fixed-tick seconds accumulate float error; a project one epsilon short
      // of zero has finished and must not sit invisible on the last frame.
      if (project.remaining > 1e-9) continue;
      project.remaining = 0;
      p.research.completed.push(tech.id);
      p.research.project = null;
      this.emit('notice', {
        team: p.id,
        x: centre.x,
        z: centre.z,
        text: `${tech.name} research complete`,
        entityId: centre.id,
        level: 'success',
        sound: 'complete',
        code: 'researchComplete',
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Research: individual upgrades and modules                          */
  /* ------------------------------------------------------------------ */

  moduleStatus(owner: number, buildingId: number, moduleId: string): { ok: boolean; reason: string } {
    const p = this.player(owner);
    if (!p) return { ok: false, reason: 'Unknown player.' };
    const building = this.getEntity(buildingId);
    if (
      !building ||
      building.kind !== 'building' ||
      building.owner !== owner ||
      building.hp <= 0 ||
      building.construction ||
      !!building.deconstruct
    ) {
      return { ok: false, reason: 'An operational structure is required.' };
    }
    const module = buildingModuleDef(moduleId, this.research);
    if (!module) return { ok: false, reason: 'Unknown module.' };
    const slot = buildingFamily(building.defId);
    if (!module.eligibleSlots.includes(slot)) {
      return { ok: false, reason: `${module.name} cannot be fitted to this structure.` };
    }
    const unlocks = resolveResearchUnlocks(p.research.completed, this.research);
    if (!unlocks.modules.has(module.id)) {
      return { ok: false, reason: `${module.name} has not been researched.` };
    }
    const installed = building.modules ?? [];
    const count = installed.filter((id) => id === module.id).length;
    if (count >= (module.capacity ?? 1)) {
      return { ok: false, reason: `${module.name} is already installed.` };
    }
    if (p.mats < module.cost.mats) return { ok: false, reason: 'Insufficient materials.' };
    if (p.req < module.cost.req) return { ok: false, reason: 'Insufficient requisition.' };
    return { ok: true, reason: '' };
  }

  private commandInstallModule(owner: number, buildingId: number, moduleId: string): void {
    const status = this.moduleStatus(owner, buildingId, moduleId);
    const building = this.getEntity(buildingId);
    if (!status.ok) {
      this.emit('orderFailed', {
        team: owner,
        x: building?.x ?? 0,
        z: building?.z ?? 0,
        text: status.reason,
        entityId: building?.id,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const p = this.player(owner)!;
    const module = buildingModuleDef(moduleId, this.research)!;
    p.mats -= module.cost.mats;
    p.req -= module.cost.req;
    building!.modules = [...(building!.modules ?? []), module.id];
    this.emit('orderAck', {
      team: owner,
      x: building!.x,
      z: building!.z,
      text: `${module.name} installed`,
      entityId: building!.id,
      level: 'info',
      sound: 'complete',
      code: 'moduleInstalled',
    });
  }

  upgradeStatus(owner: number, unitId: number, upgradeId: string): { ok: boolean; reason: string } {
    const p = this.player(owner);
    if (!p) return { ok: false, reason: 'Unknown player.' };
    const unit = this.getEntity(unitId);
    if (!unit || unit.kind !== 'unit' || unit.owner !== owner || unit.hp <= 0) {
      return { ok: false, reason: 'A living unit is required.' };
    }
    const upgrade = unitUpgradeDef(upgradeId, this.research);
    if (!upgrade) return { ok: false, reason: 'Unknown upgrade.' };
    const slot = unitFamily(unit.defId);
    if (!upgrade.eligibleSlots.includes(slot)) {
      return { ok: false, reason: `${upgrade.name} cannot be fitted to this unit.` };
    }
    const unlocks = resolveResearchUnlocks(p.research.completed, this.research);
    if (!unlocks.upgrades.has(upgrade.id)) {
      return { ok: false, reason: `${upgrade.name} has not been researched.` };
    }
    if ((unit.upgrades ?? []).includes(upgrade.id)) {
      return { ok: false, reason: `${upgrade.name} is already fitted.` };
    }
    if (p.mats < upgrade.cost.mats) return { ok: false, reason: 'Insufficient materials.' };
    if (p.req < upgrade.cost.req) return { ok: false, reason: 'Insufficient requisition.' };
    return { ok: true, reason: '' };
  }

  private commandActivateUpgrade(owner: number, unitId: number, upgradeId: string): void {
    const status = this.upgradeStatus(owner, unitId, upgradeId);
    const unit = this.getEntity(unitId);
    if (!status.ok) {
      this.emit('orderFailed', {
        team: owner,
        x: unit?.x ?? 0,
        z: unit?.z ?? 0,
        text: status.reason,
        entityId: unit?.id,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const p = this.player(owner)!;
    const upgrade = unitUpgradeDef(upgradeId, this.research)!;
    p.mats -= upgrade.cost.mats;
    p.req -= upgrade.cost.req;
    unit!.upgrades = [...(unit!.upgrades ?? []), upgrade.id];
    this.emit('orderAck', {
      team: owner,
      x: unit!.x,
      z: unit!.z,
      text: `${upgrade.name} fitted`,
      entityId: unit!.id,
      level: 'info',
      code: 'upgradeApplied',
    });
  }

  /* ------------------------------------------------------------------ */
  /* Unit abilities                                                     */
  /* ------------------------------------------------------------------ */

  /** Active smoke clouds, oldest first. Vision and presentation share this list. */
  get smokeClouds(): readonly SmokeCloud[] {
    return this.state.smoke;
  }

  /**
   * Whether a cloud sits over `to` but not over `from`.
   *
   * This is the whole smoke rule in one predicate. A cloud hides what is inside
   * it from anyone outside it, and hides nothing from a crew already standing in
   * the same cloud — which is why a smoked position cannot be shot at from a
   * distance but can be fought inside. Radar, sonar and other non-visual sensors
   * never ask this question, so smoke is not a blanket stealth field.
   */
  smokeScreens(ax: number, az: number, bx: number, bz: number): boolean {
    const clouds = this.state.smoke;
    if (clouds.length === 0) return false;
    let fromCovered = false;
    let toCovered = false;
    for (const cloud of clouds) {
      const r2 = cloud.radius * cloud.radius;
      if (dist2(ax, az, cloud.x, cloud.z) <= r2) fromCovered = true;
      if (dist2(bx, bz, cloud.x, cloud.z) <= r2) toCovered = true;
    }
    return toCovered && !fromCovered;
  }

  /** Whether any live cloud covers a world point. */
  smokeCoversPoint(x: number, z: number): boolean {
    for (const cloud of this.state.smoke) {
      const r2 = cloud.radius * cloud.radius;
      if (dist2(x, z, cloud.x, cloud.z) <= r2) return true;
    }
    return false;
  }

  /** Seconds before one hull may use an ability again; 0 when ready. */
  cooldownRemaining(unitId: number, abilityId: string): number {
    return Math.max(0, this.getEntity(unitId)?.cooldowns?.[abilityId] ?? 0);
  }

  /**
   * Distance, in world units, at which this entity can actually engage.
   *
   * A weapon keeps its physical reach; what light and weather shrink is how far
   * the crew can identify and hold a target. Every caller that decides whether
   * to stand and fight, or how far to close, has to use this same number: units
   * that stopped at the bare weapon range used to park just outside what they
   * could engage at in fog or at night, fire nothing, and never close further.
   */
  private engagementReach(e: Entity, weapon: WeaponDef): number {
    const reach = weapon.indirect
      ? weapon.range
      : weapon.range * engagementFactor(sensorFor(e), this.dayNight) * this.weather.acquisition;
    // An electronic attack degrades the datalink that turns a sighting into a
    // firing solution; the physical gun is unchanged, which is why the penalty
    // is modest and expires.
    const ew = ewRangeFactor(
      this.player(e.owner)?.superweapon,
      this.state.tick,
      EW_EFFECT,
    );
    return reach * ew * TILE_SIZE;
  }

  /**
   * Whether one owned unit can use an ability right now, and why not.
   *
   * Availability is resolved from the player's completed research on every call
   * rather than stored on the hull: research finishing must reach units that
   * already exist, and a scenario grant must resolve through the same path. The
   * only per-hull state is the reload clock.
   */
  abilityStatus(
    owner: number,
    unitId: number,
    abilityId: string,
  ): { ok: boolean; reason: string; cooldown: number } {
    const p = this.player(owner);
    if (!p) return { ok: false, reason: 'Unknown player.', cooldown: 0 };
    const unit = this.getEntity(unitId);
    if (!unit || unit.kind !== 'unit' || unit.owner !== owner || unit.hp <= 0) {
      return { ok: false, reason: 'A living unit is required.', cooldown: 0 };
    }
    if (unit.garrisonId) {
      return { ok: false, reason: 'Garrisoned infantry must leave the building first.', cooldown: 0 };
    }
    const upgrade = unitUpgradeDef(abilityId, this.research);
    const ability = upgrade ? abilityForUpgrade(upgrade.id) : undefined;
    if (!upgrade || !ability) return { ok: false, reason: 'Unknown ability.', cooldown: 0 };
    if (!upgrade.eligibleSlots.includes(unitFamily(unit.defId))) {
      return { ok: false, reason: `${upgrade.name} cannot be fitted to this unit.`, cooldown: 0 };
    }
    if (!this.researchUnlocks(owner).upgrades.has(upgrade.id)) {
      return { ok: false, reason: `${upgrade.name} has not been researched.`, cooldown: 0 };
    }
    const cooldown = Math.max(0, unit.cooldowns?.[upgrade.id] ?? 0);
    if (cooldown > 0) {
      return {
        ok: false,
        reason: `${upgrade.name} reloading — ${Math.ceil(cooldown)}s`,
        cooldown,
      };
    }
    return { ok: true, reason: '', cooldown: 0 };
  }

  private commandUseAbility(owner: number, unitId: number, abilityId: string): void {
    const status = this.abilityStatus(owner, unitId, abilityId);
    const unit = this.getEntity(unitId);
    if (!status.ok) {
      this.emit('orderFailed', {
        team: owner,
        x: unit?.x ?? 0,
        z: unit?.z ?? 0,
        text: status.reason,
        entityId: unit?.id,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const ability = abilityForUpgrade(abilityId)!;
    const tick = this.state.tick;
    this.state.smoke.push({
      id: this.state.nextSmokeId++,
      owner,
      team: this.teamOf(owner),
      x: unit!.x,
      z: unit!.z,
      radius: ability.radius * TILE_SIZE,
      startTick: tick,
      expiresTick: tick + Math.max(1, Math.round(ability.durationSeconds * TICK_RATE)),
    });
    // Only the hull that fired reloads. The command never touches the player's
    // research record or any other unit's clock.
    unit!.cooldowns = { ...(unit!.cooldowns ?? {}), [ability.upgradeId]: ability.cooldownSeconds };
    this.emit('orderAck', {
      team: owner,
      x: unit!.x,
      z: unit!.z,
      text: 'Smoke away',
      entityId: unit!.id,
      level: 'info',
      sound: 'queue',
      code: 'abilityUsed',
    });
  }

  /** Drop expired clouds. Called once per tick, before vision is refreshed. */
  private updateSmoke(): void {
    const clouds = this.state.smoke;
    if (clouds.length === 0) return;
    const tick = this.state.tick;
    let write = 0;
    for (let i = 0; i < clouds.length; i++) {
      if (clouds[i].expiresTick > tick) clouds[write++] = clouds[i];
    }
    clouds.length = write;
  }

  /* ------------------------------------------------------------------ */
  /* Production                                                         */
  /* ------------------------------------------------------------------ */

  productionStatus(owner: number, buildingId: number, defId: string): { ok: boolean; reason: string } {
    const p = this.player(owner);
    const b = this.getEntity(buildingId);
    const def = UNITS[defId];
    if (!p) return { ok: false, reason: 'Unknown player.' };
    if (!b || b.kind !== 'building' || b.owner !== owner || b.hp <= 0) {
      return { ok: false, reason: 'Facility unavailable.' };
    }
    if (b.construction) return { ok: false, reason: 'Facility still under construction.' };
    if (b.deconstruct) return { ok: false, reason: 'Facility is being dismantled for sale.' };
    const bdef = BUILDINGS[b.defId];
    if (!bdef?.produces) return { ok: false, reason: 'This facility does not produce units.' };
    if (!def) return { ok: false, reason: 'Unknown unit type.' };
    if (!this.canProduce(owner, defId)) {
      return { ok: false, reason: `${def.name} is not in ${p.name}'s roster.` };
    }
    if (this.unitRestrictedByOperation(owner, defId)) {
      return { ok: false, reason: `${def.name} is not available in this operation.` };
    }
    // Resolve the facility's baseline slots through the roster so a national
    // variant keeps its family's production slot without a parallel list.
    if (!this.productionEntries(owner, b.defId).includes(defId)) {
      return { ok: false, reason: `${bdef.name} cannot produce ${def.name}.` };
    }
    // Research is checked after facility eligibility: a card is capped by what
    // this building makes before it is capped by what the player has studied.
    const missingResearch = this.missingResearchForUnit(owner, defId);
    if (missingResearch.length > 0) {
      return {
        ok: false,
        reason: `${def.name} requires ${missingResearch.map((tech) => tech.name).join(' and ')} research.`,
      };
    }
    // Engineers are a factory unit, with the command post as a fallback so a
    // lost factory and engineer do not leave the player permanently unable to
    // build. The HQ hands the role back as soon as a factory is operational.
    if (defId === 'engineer' && b.defId === 'commandPost') {
      const factory = this.state.entities.some(
        (e) => e.owner === owner && e.defId === 'factory' && e.hp > 0 && !e.construction,
      );
      if (factory) {
        return { ok: false, reason: 'An operational Vehicle Factory builds engineers.' };
      }
    }
    if (b.queue.length >= MAX_QUEUE) return { ok: false, reason: 'Production queue is full.' };
    if (p.mats < def.cost.mats) return { ok: false, reason: 'Insufficient materials.' };
    if (p.req < def.cost.req) return { ok: false, reason: 'Insufficient requisition.' };
    if (unitFamily(def.id) === 'fighter') {
      const hasAirfield = this.state.entities.some(
        (e) => e.owner === owner && e.defId === 'airfield' && e.hp > 0 && !e.construction,
      );
      if (!hasAirfield) return { ok: false, reason: 'Requires an operational airfield.' };
    }
    if (def.domain === 'naval') {
      const hasYard = this.state.entities.some(
        (e) => e.owner === owner && e.defId === 'shipyard' && e.hp > 0 && !e.construction,
      );
      if (!hasYard) return { ok: false, reason: 'Requires an operational shipyard.' };
    }
    return { ok: true, reason: '' };
  }

  /**
   * A naval facility can only rally its hulls to water; every other force is
   * free to use any point, and a rally on bad ground simply leaves a unit on
   * the apron. Shared by the command handler, the produced unit and the HUD so
   * the rejection text is identical everywhere.
   */
  rallyStatus(buildingId: number, x: number, z: number): { ok: boolean; reason: string } {
    const b = this.getEntity(buildingId);
    if (!b || b.kind !== 'building' || b.hp <= 0) {
      return { ok: false, reason: 'Facility unavailable.' };
    }
    const def = BUILDINGS[b.defId];
    if (def?.produces !== 'naval') return { ok: true, reason: '' };
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return { ok: false, reason: 'Naval rally points must be on water.' };
    }
    const { width, height, terrain } = this.state.map;
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    if (!inBounds(width, height, tx, tz)) {
      return { ok: false, reason: 'Naval rally points must be on water.' };
    }
    if (!canStandOn(width, height, terrain, tileIndex(width, tx, tz), 'naval')) {
      return { ok: false, reason: 'Naval rally points must be on water.' };
    }
    return { ok: true, reason: '' };
  }

  private commandProduce(owner: number, buildingId: number, defId: string): void {
    const status = this.productionStatus(owner, buildingId, defId);
    if (!status.ok) {
      const b = this.getEntity(buildingId);
      this.emit('orderFailed', {
        team: owner,
        x: b?.x ?? 0,
        z: b?.z ?? 0,
        text: status.reason,
        level: 'warning',
        sound: 'denied',
        code: status.reason === 'Production queue is full.' ? 'queueFull' : undefined,
      });
      return;
    }
    const p = this.player(owner)!;
    const bt = this.getEntity(buildingId)!;
    const def = unitDef(defId);
    p.mats -= def.cost.mats;
    p.req -= def.cost.req;
    // Only the empty-to-active transition is a production start. Appending to
    // an existing queue must not replay the announcement for every item.
    const startingProduction = bt.queue.length === 0;
    bt.queue.push({ defId, remaining: def.buildTime, total: def.buildTime });
    this.emit('orderAck', {
      team: owner,
      x: bt.x,
      z: bt.z,
      text: `${def.name} queued`,
      entityId: bt.id,
      level: 'info',
      sound: 'queue',
      code: startingProduction ? 'productionStarted' : undefined,
    });
  }

  /**
   * Whether a structure can be sold right now, and why not. Shared by the
   * command handler and the selection panel so the button and the rejection
   * always agree. Selling starts a deconstruction clock; the refund only pays
   * on completion, so a structure shelled apart mid-sale pays nothing.
   */
  sellStatus(owner: number, buildingId: number): { ok: boolean; reason: string } {
    const b = this.getEntity(buildingId);
    if (!b || b.kind !== 'building' || b.owner !== owner || b.hp <= 0) {
      return { ok: false, reason: 'Select one of your own structures.' };
    }
    if (b.construction) return { ok: false, reason: 'Finish construction before selling.' };
    if (b.deconstruct) return { ok: false, reason: 'This structure is already being dismantled.' };
    if (isIndestructibleStructure(b.defId)) {
      return { ok: false, reason: 'Objective structures cannot be sold.' };
    }
    const def = BUILDINGS[b.defId];
    if (def?.walkable) {
      return { ok: false, reason: 'Engineered spans cannot be sold — the crossing would stay blocked.' };
    }
    if (this.state.entities.some((e) => e.kind === 'unit' && e.hp > 0 && e.garrisonId === b.id)) {
      return { ok: false, reason: 'Evacuate the garrison before selling.' };
    }
    return { ok: true, reason: '' };
  }

  /** Seconds a sale takes: half the original build time, never under three. */
  static sellSeconds(defId: string): number {
    return Math.max(3, buildingDef(defId).buildTime * 0.5);
  }

  /** 75% of the structure cost, in the same two currencies the player paid. */
  static sellRefund(defId: string): { mats: number; req: number } {
    const def = buildingDef(defId);
    return { mats: Math.floor(def.cost.mats * 0.75), req: Math.floor(def.cost.req * 0.75) };
  }

  /** The quote the selection panel prints, from the same rules the command uses. */
  sellQuote(buildingId: number): { mats: number; req: number; seconds: number } | null {
    const b = this.getEntity(buildingId);
    if (!b || b.kind !== 'building') return null;
    const refund = Game.sellRefund(b.defId);
    return { ...refund, seconds: Game.sellSeconds(b.defId) };
  }

  private commandSellBuilding(owner: number, buildingId: number): void {
    const status = this.sellStatus(owner, buildingId);
    const b = this.getEntity(buildingId);
    if (!status.ok) {
      this.emit('orderFailed', {
        team: owner,
        x: b?.x ?? 0,
        z: b?.z ?? 0,
        text: status.reason,
        entityId: b?.id,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const p = this.player(owner);
    // Queued production was already paid for; cashing it out at the moment the
    // sale starts is the only honest refund, because the queue is cleared here.
    if (p) {
      for (const item of b!.queue) {
        const unit = unitDef(item.defId);
        p.mats += unit.cost.mats;
        p.req += unit.cost.req;
      }
    }
    b!.queue = [];
    const total = Game.sellSeconds(b!.defId);
    b!.deconstruct = { remaining: total, total };
    b!.state = 'selling';
    b!.rallyX = b!.x;
    b!.rallyZ = b!.z;
    const def = buildingDef(b!.defId);
    const refund = Game.sellRefund(b!.defId);
    this.emit('orderAck', {
      team: owner,
      x: b!.x,
      z: b!.z,
      text: `${def.name} dismantling — ${refund.mats}M/${refund.req}R on completion`,
      entityId: b!.id,
      defId: b!.defId,
      level: 'info',
      sound: 'build',
      code: 'buildingSold',
    });
  }

  /** Pay a completed sale and let cleanup remove the structure this tick. */
  private completeSale(b: Entity): void {
    const def = buildingDef(b.defId);
    const refund = Game.sellRefund(b.defId);
    const p = this.player(b.owner);
    if (p) {
      p.mats += refund.mats;
      p.req += refund.req;
    }
    this.emit('buildingSold', {
      team: b.owner,
      x: b.x,
      z: b.z,
      text: `${def.name} sold — ${refund.mats}M/${refund.req}R recovered`,
      entityId: b.id,
      defId: b.defId,
      level: 'success',
      sound: 'complete',
      code: 'buildingSold',
    });
    delete b.deconstruct;
    b.queue = [];
    b.path = [];
    b.hp = 0;
  }

  private commandCancelProduction(owner: number, buildingId: number, queueIndex: number): void {
    const b = this.getEntity(buildingId);
    if (!b || b.owner !== owner || b.kind !== 'building') return;
    const item = b.queue[queueIndex];
    if (!item) return;
    const p = this.player(owner);
    const def = unitDef(item.defId);
    if (p) {
      p.mats += def.cost.mats;
      p.req += def.cost.req;
    }
    b.queue.splice(queueIndex, 1);
    this.emit('orderAck', {
      team: owner,
      x: b.x,
      z: b.z,
      text: `${def.name} production cancelled — resources refunded`,
      level: 'info',
      // Cancelling the active item is a genuine production interruption;
      // removing a later queue item is only a quiet edit.
      code: queueIndex === 0 ? 'productionCancelled' : undefined,
    });
  }

  /**
   * Move every queued copy of one unit type ahead of the first copy of
   * `beforeDefId` (or to the queue tail when it is absent). Items keep their
   * paid cost and elapsed progress; this only changes their order, so it can
   * never create or refund resources. The UI treats a drag between cameo cards
   * as this type-level priority move.
   */
  private commandReorderProduction(
    owner: number,
    buildingId: number,
    defId: string,
    beforeDefId?: string,
  ): void {
    const b = this.getEntity(buildingId);
    if (!b || b.kind !== 'building' || b.owner !== owner) return;
    if (defId === beforeDefId) return;
    const moving = b.queue.filter((item) => item.defId === defId);
    if (moving.length === 0) return;
    const rest = b.queue.filter((item) => item.defId !== defId);
    let insertAt = rest.length;
    if (beforeDefId) {
      const target = rest.findIndex((item) => item.defId === beforeDefId);
      if (target < 0) return;
      insertAt = target;
    }
    const next = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
    if (next.every((item, i) => item === b.queue[i])) return;
    b.queue = next;
    this.emit('orderAck', {
      team: owner,
      x: b.x,
      z: b.z,
      text: `${unitDef(defId).name} production priority updated`,
      level: 'info',
    });
  }

  placementStatus(
    owner: number,
    defId: string,
    tileX: number,
    tileZ: number,
    builderId?: number,
    ignoreCost = false,
  ): { ok: boolean; code: string; reason: string } {
    const def = BUILDINGS[defId];
    if (!def) return { ok: false, code: 'unknown', reason: 'Unknown structure.' };
    if (def.authoredOnly) {
      return {
        ok: false,
        code: 'reserved',
        reason: `${def.name} is an authored objective or shelter, not a buildable structure.`,
      };
    }
    const p = this.player(owner);
    if (!p) return { ok: false, code: 'player', reason: 'Unknown player.' };
    if (!this.canBuild(owner, defId)) {
      return {
        ok: false,
        code: 'roster',
        reason: `${def.name} is not in ${p.name}'s roster.`,
      };
    }
    if (this.buildingRestrictedByOperation(owner, defId)) {
      return {
        ok: false,
        code: 'operation',
        reason: `${def.name} is not available in this operation.`,
      };
    }
    const missingResearch = this.missingResearchForBuilding(owner, defId);
    if (missingResearch.length > 0) {
      return {
        ok: false,
        code: 'research',
        reason: `${def.name} requires ${missingResearch.map((tech) => tech.name).join(' and ')} research.`,
      };
    }
    if (defId === 'commandPost') {
      const existing = this.state.entities.some(
        (e) => e.owner === owner && e.defId === 'commandPost' && e.hp > 0,
      );
      if (existing) return { ok: false, code: 'hq', reason: 'Only one Command Post per battlegroup.' };
    }
    if (buildingFamily(defId) === 'researchCentre') {
      // One centre, one project: a second building would only duplicate power
      // draw and a foundation the player cannot use.
      const existing = this.state.entities.some(
        (e) =>
          e.owner === owner &&
          e.kind === 'building' &&
          e.hp > 0 &&
          buildingFamily(e.defId) === 'researchCentre',
      );
      if (existing) return { ok: false, code: 'hq', reason: 'Only one Research Centre per battlegroup.' };
    }
    const missing = this.missingTech(owner, defId);
    if (missing.length > 0) {
      return {
        ok: false,
        code: 'tech',
        reason: `Requires ${missing.map((m) => m.name).join(' and ')}.`,
      };
    }
    if (builderId !== undefined) {
      const builder = this.getEntity(builderId);
      if (!builder || builder.owner !== owner || builder.kind !== 'unit') {
        return { ok: false, code: 'builder', reason: 'Builder unavailable.' };
      }
      if (!unitDef(builder.defId).canBuild) {
        return { ok: false, code: 'builder', reason: 'This unit cannot construct buildings.' };
      }
    }
    if (!ignoreCost && p.mats < def.cost.mats) {
      return { ok: false, code: 'mats', reason: 'Insufficient materials.' };
    }
    if (!ignoreCost && p.req < def.cost.req) {
      return { ok: false, code: 'req', reason: 'Insufficient requisition.' };
    }
    const occupied = blockedSnapshot(this.blocked);
    // The runtime ore field, not the authored tiles: a worked-out deposit is
    // ordinary ground again.
    const check = checkPlacement(
      this.state.scenario,
      defId,
      tileX,
      tileZ,
      occupied,
      this.state.map.ore,
    );
    if (!check.ok) return check;
    // Units block foundations.
    for (const e of this.state.entities) {
      if (e.kind !== 'unit' || e.hp <= 0) continue;
      const tx = Math.floor(e.x / TILE_SIZE);
      const tz = Math.floor(e.z / TILE_SIZE);
      if (tx >= tileX && tx < tileX + def.footprint.w && tz >= tileZ && tz < tileZ + def.footprint.h) {
        return { ok: false, code: 'units', reason: 'Units are standing on the site.' };
      }
    }
    if (def.requiresWater) {
      const water = adjacentWater(this.state.scenario, { defId, owner, x: tileX, z: tileZ });
      if (water.length < 3) {
        return {
          ok: false,
          code: 'water-access',
          reason: `${def.name} needs a usable stretch of navigable water alongside.`,
        };
      }
    }
    // Build radius: within reach of an existing completed structure.
    const cx = (tileX + def.footprint.w / 2) * TILE_SIZE;
    const cz = (tileZ + def.footprint.h / 2) * TILE_SIZE;
    let inRadius = false;
    for (const e of this.state.entities) {
      if (e.owner !== owner || e.kind !== 'building' || e.hp <= 0 || e.construction) continue;
      if (dist(cx, cz, e.x, e.z) <= BUILD_RADIUS * TILE_SIZE) {
        inRadius = true;
        break;
      }
    }
    if (!inRadius) {
      return {
        ok: false,
        code: 'radius',
        reason: 'Outside build radius — expand with a forward structure first.',
      };
    }
    return { ok: true, code: 'ok', reason: 'Placement valid.' };
  }

  /**
   * Release a stalled construction site and return part of its cost. Used by
   * the AI when a builder cannot make progress; a site must never become a
   * permanent tax on the build plan. Not exposed as a player command yet.
   */
  abandonConstruction(owner: number, buildingId: number, refund = 0.5): boolean {
    const site = this.getEntity(buildingId);
    if (!site || site.kind !== 'building' || site.owner !== owner || !site.construction) return false;
    const def = BUILDINGS[site.defId];
    if (!def) return false;
    for (const e of this.state.entities) {
      if (e.kind === 'unit' && e.buildTargetId === site.id) this.releaseBuildTarget(e);
    }
    const tx = Math.round(site.x / TILE_SIZE - def.footprint.w / 2);
    const tz = Math.round(site.z / TILE_SIZE - def.footprint.h / 2);
    stampFootprint(this.blocked, this.state.map, site.defId, tx, tz, 0);
    this.state.entities = this.state.entities.filter((e) => e !== site);
    this.byId.delete(site.id);
    const p = this.player(owner);
    if (p) {
      p.mats += def.cost.mats * Math.max(0, Math.min(1, refund));
      p.req += def.cost.req * Math.max(0, Math.min(1, refund));
    }
    this.emit('orderFailed', {
      team: owner,
      x: site.x,
      z: site.z,
      text: `${def.name} construction abandoned — builder cannot make progress.`,
      level: 'warning',
      entityId: site.id,
      defId: site.defId,
      sound: 'denied',
    });
    return true;
  }

  private commandPlaceBuilding(
    owner: number,
    builderId: number | undefined,
    defId: string,
    tileX: number,
    tileZ: number,
  ): void {
    const builder = this.resolveBuilder(owner, builderId, tileX, tileZ);
    // A site can be sited while every engineer is committed: it waits for the
    // next free engineer instead of stealing one from work already in progress.
    const hasEngineer = this.state.entities.some(
      (e) => e.kind === 'unit' && e.hp > 0 && e.owner === owner && !!unitDef(e.defId).canBuild,
    );
    if (!builder && !hasEngineer) {
      this.emit('orderFailed', {
        team: owner,
        x: (tileX + 0.5) * TILE_SIZE,
        z: (tileZ + 0.5) * TILE_SIZE,
        text: 'No Combat Engineer available — build one at the Vehicle Factory.',
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const status = this.placementStatus(owner, defId, tileX, tileZ, builder?.id);
    if (!status.ok) {
      this.emit('orderFailed', {
        team: owner,
        x: (tileX + 0.5) * TILE_SIZE,
        z: (tileZ + 0.5) * TILE_SIZE,
        text: status.reason,
        level: 'warning',
        sound: 'denied',
      });
      return;
    }
    const p = this.player(owner)!;
    const def = buildingDef(defId);
    p.mats -= def.cost.mats;
    p.req -= def.cost.req;
    const building = this.spawnStructure({ defId, owner, x: tileX, z: tileZ }, true);
    this.emit('buildingPlaced', {
      team: owner,
      x: building.x,
      z: building.z,
      text: `${def.name} under construction`,
      entityId: building.id,
      defId,
      level: 'info',
      sound: 'build',
    });
    if (builder) this.assignBuilderToSite(builder, building);
  }

  /**
   * The engineer a placement should use: the preferred one when it can build,
   * otherwise the nearest idle engineer. Committed engineers are never taken
   * off existing work; the new site waits for one to free up instead.
   */
  private resolveBuilder(
    owner: number,
    preferredId: number | undefined,
    tileX: number,
    tileZ: number,
  ): Entity | null {
    const eligible = (e: Entity): boolean =>
      e.kind === 'unit' && e.hp > 0 && e.owner === owner && !!unitDef(e.defId).canBuild;
    if (preferredId !== undefined && preferredId !== 0) {
      const preferred = this.getEntity(preferredId);
      if (preferred && eligible(preferred)) return preferred;
    }
    const cx = (tileX + 0.5) * TILE_SIZE;
    const cz = (tileZ + 0.5) * TILE_SIZE;
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const e of this.state.entities) {
      if (!eligible(e) || e.buildTargetId || e.order) continue;
      const score = dist(e.x, e.z, cx, cz);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private releaseBuildTarget(e: Entity): void {
    if (!e.buildTargetId) return;
    e.buildTargetId = 0;
    if (e.state === 'building') e.state = 'idle';
  }

  private assignBuilderToSite(engineer: Entity, site: Entity): void {
    engineer.buildTargetId = site.id;
    engineer.order = null;
    engineer.targetId = 0;
    engineer.aimTargetId = 0;
    engineer.captureTargetId = 0;
    engineer.captureProgress = 0;
    this.walkEngineerToSite(engineer, site);
  }

  /** Send an assigned engineer to a spot just outside the site's footprint. */
  private walkEngineerToSite(engineer: Entity, site: Entity): void {
    const def = buildingDef(site.defId);
    const dx = engineer.x - site.x;
    const dz = engineer.z - site.z;
    const len = Math.hypot(dx, dz);
    const reach = (Math.max(def.footprint.w, def.footprint.h) * TILE_SIZE) / 2 + 2.5;
    const tx = site.x + (len > 0.01 ? (dx / len) * reach : reach);
    const tz = site.z + (len > 0.01 ? (dz / len) * reach : 0);
    const path = this.findPathFor(engineer, tx, tz);
    engineer.path = path ?? [];
    engineer.pathIndex = 0;
    engineer.destX = tx;
    engineer.destZ = tz;
    engineer.state = engineer.path.length > 0 ? 'moving' : 'idle';
    engineer.blockedTicks = 0;
  }

  /**
   * Match idle engineers to unfinished sites, one engineer per site. Runs every
   * tick so a newly produced engineer, or one released by a player order, picks
   * up whatever is paused.
   */
  private updateEngineerAssignments(): void {
    const engineers = this.state.entities.filter(
      (e) => e.kind === 'unit' && e.hp > 0 && unitDef(e.defId).canBuild,
    );
    for (const eng of engineers) {
      if (!eng.buildTargetId) continue;
      const site = this.getEntity(eng.buildTargetId);
      if (
        !site ||
        site.kind !== 'building' ||
        site.hp <= 0 ||
        !site.construction ||
        site.owner !== eng.owner ||
        eng.order
      ) {
        this.releaseBuildTarget(eng);
      }
    }
    const sites = this.state.entities
      .filter((e) => e.kind === 'building' && e.hp > 0 && e.construction)
      .sort((a, b) => a.id - b.id);
    for (const site of sites) {
      const builder = engineers.find((e) => e.buildTargetId === site.id);
      if (builder) {
        if (dist(builder.x, builder.z, site.x, site.z) <= ENGINEER_WORK_RANGE) {
          if (builder.state !== 'building') {
            builder.state = 'building';
            builder.path = [];
            builder.pathIndex = 0;
            builder.destX = builder.x;
            builder.destZ = builder.z;
          }
        } else if (builder.state !== 'moving' || builder.path.length === 0) {
          // Off the site with no route: drifted out (separation, terrain), had
          // its approach cut by a structure raised across it, or lost its path
          // to a crowd. Previously only a builder still flagged `building` was
          // walked back on, so one that ended up idle and out of range kept the
          // site assigned to itself and never returned — the site sat at its
          // last percentage forever while every other engineer was passed over.
          // Retried on a slow clock so a genuinely sealed site costs one search
          // a second rather than one per tick.
          if ((this.state.tick + builder.id) % 20 === 0) {
            this.walkEngineerToSite(builder, site);
          }
        }
        continue;
      }
      const idle = engineers
        .filter((e) => e.owner === site.owner && !e.buildTargetId && !e.order)
        .sort(
          (a, b) =>
            dist(a.x, a.z, site.x, site.z) - dist(b.x, b.z, site.x, site.z),
        );
      const chosen = idle[0];
      if (chosen) this.assignBuilderToSite(chosen, site);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tick                                                               */
  /* ------------------------------------------------------------------ */

  tick(): void {
    if (!this.state.ready) return;
    if (this.state.victory !== 'playing') return;
    this.state.tick++;
    const dt = 1 / TICK_RATE;
    this.processCommands();
    this.updatePassiveIncome(dt);
    this.updateBuildingSystems(dt);
    this.updateResearch(dt);
    // Strategic operations advance on the same clock: warnings resolve, volleys
    // release and defensive fields expire before this tick's projectiles move.
    this.updateSuperweapons();
    // Clouds expire on the authoritative clock and must be gone before vision
    // is refreshed, so an expired cloud cannot hide a unit for one extra beat.
    this.updateSmoke();
    // The controller schedules itself: its reaction time is a property of the
    // commander level, not of this loop.
    this.ai?.update(this);
    this.updateUnits(dt);
    this.updateGarrisons(dt);
    this.updateProjectiles(dt);
    this.cleanup();
    if (this.state.tick % VISION_INTERVAL === 0) {
      this.refreshVision(false);
      this.updateIncomeHistory();
    }
    // Authored triggers read this tick's authoritative state and run before the
    // verdict, so a trigger can still complete a bonus objective on the same
    // tick the last primary objective is secured.
    this.updateMissionTriggers();
    this.evaluateVictory();
  }

  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }

  /* ------------------------------------------------------------------ */
  /* Mission objectives                                                 */
  /* ------------------------------------------------------------------ */

  /** The captured result of a finished mission, or null while it is running. */
  get missionResult(): MissionResult | null {
    return this.mission?.result ?? null;
  }

  /**
   * Objective transitions requested from gameplay.
   *
   * S3's trigger actions will call exactly these methods, so the authoritative
   * validation (known id, valid transition, prerequisites, terminal mission)
   * lives in one place. A refused request changes nothing and emits nothing.
   */
  activateObjective(id: string): boolean {
    return this.applyMissionTransition(this.mission?.activateObjective(id));
  }

  completeObjective(id: string): boolean {
    return this.applyMissionTransition(this.mission?.completeObjective(id));
  }

  failObjective(id: string): boolean {
    return this.applyMissionTransition(this.mission?.failObjective(id));
  }

  private applyMissionTransition(result: MissionTransitionResult | undefined): boolean {
    if (!result?.ok) return false;
    for (const change of result.changes) this.announceObjectiveChange(change);
    return true;
  }

  /**
   * Relay one objective transition as an ordinary simulation event. Mission
   * state is not a second event system: the HUD, log and announcer read this
   * like any other notice.
   */
  private announceObjectiveChange(change: MissionObjectiveChange): void {
    const mission = this.mission;
    if (!mission) return;
    const title = mission.objectiveTitle(change.id) ?? change.id;
    const code: SimEventCode =
      change.to === 'complete'
        ? 'objectiveComplete'
        : change.to === 'failed'
          ? 'objectiveFailed'
          : 'objectiveActivated';
    const text =
      change.to === 'complete'
        ? `Objective complete — ${title}.`
        : change.to === 'failed'
          ? `Objective failed — ${title}.`
          : `Objective active — ${title}.`;
    this.emit('notice', {
      team: this.localPlayerId,
      x: 0,
      z: 0,
      text,
      level: change.to === 'failed' ? 'critical' : change.to === 'complete' ? 'success' : 'info',
      code,
    });
  }

  /**
   * Build and store the mission result once, from the authoritative state the
   * outcome was decided on. A second call is a no-op, and a save taken after
   * this point restores the same result rather than recapturing it.
   */
  private captureMissionResult(outcome: MissionOutcome): void {
    const mission = this.mission;
    if (!mission || mission.result) return;
    if (mission.outcome !== 'playing' && mission.outcome !== outcome) return;
    const result = buildMissionResult({
      doc: mission.doc,
      state: mission.state,
      outcome,
      tick: this.state.tick,
      elapsedSeconds: Math.max(0, this.state.tick - this.state.startedAtTick) / TICK_RATE,
      localPlayerId: this.localPlayerId,
      players: this.state.players.map((player) => ({ id: player.id, stats: player.stats })),
      entities: this.state.entities.map((entity) => ({
        defId: entity.defId,
        hp: entity.hp,
        ...(entity.authoredKey ? { authoredKey: entity.authoredKey } : {}),
      })),
    });
    mission.finalizeResult(outcome, result);
  }

  /**
   * One tick of authored mission triggers.
   *
   * The world snapshot is built from live simulation state only: live units for
   * occupancy, and authored keys whose entity still exists with hit points for
   * `entityAlive`. The whole tick runs inside one action batch, so objective
   * changes accumulate before the outcome is committed at the tick's evaluation
   * point.
   */
  private updateMissionTriggers(): void {
    const mission = this.mission;
    if (!mission || mission.isTerminal) return;
    if (mission.doc.triggers.length === 0) return;
    const units = this.state.entities
      .filter((entity) => entity.kind === 'unit' && entity.hp > 0)
      .map((entity) => ({
        team: this.player(entity.owner)?.team ?? entity.owner,
        x: entity.x,
        z: entity.z,
      }));
    const aliveAuthored = new Set<string>();
    for (const entity of this.state.entities) {
      if (entity.authoredKey && entity.hp > 0) aliveAuthored.add(entity.authoredKey);
    }
    mission.beginActionBatch();
    try {
      evaluateMissionTriggers(
        mission,
        {
          tick: this.state.tick,
          startedAtTick: this.state.startedAtTick,
          units,
          aliveAuthored,
        },
        {
          message: (text) => this.announceMissionMessage(text),
          objectiveChanged: (changes) => {
            for (const change of changes) this.announceObjectiveChange(change);
          },
        },
      );
    } finally {
      mission.endActionBatch();
    }
  }

  private announceMissionMessage(text: string): void {
    this.emit('notice', {
      team: this.localPlayerId,
      x: 0,
      z: 0,
      text,
      level: 'info',
      code: 'missionMessage',
    });
  }

  syncRng(): void {
    this.rng.setState(this.state.rngState);
  }

  private persistRng(): void {
    this.state.rngState = this.rng.getState();
  }

  private updatePassiveIncome(dt: number): void {
    for (const p of this.state.players) {
      if (p.defeated) continue;
      let reqRate = 0;
      let relayCount = 0;
      for (const e of this.state.entities) {
        if (e.owner !== p.id || e.kind !== 'building' || e.construction || e.hp <= 0) continue;
        const def = BUILDINGS[e.defId];
        reqRate += def?.reqPerSec ?? 0;
        if (e.defId === 'relay') relayCount++;
      }
      const matsRate = this.passiveMatsFor(p.id);
      p.relayCount = relayCount;
      p.req = Math.min(99999, p.req + reqRate * dt);
      if (matsRate > 0) {
        const gain = matsRate * dt;
        p.mats = Math.min(99999, p.mats + gain);
        p.stats.matsGathered += gain;
      }
    }
  }

  private updateIncomeHistory(): void {
    this.incomeSamples++;
    for (let i = 0; i < this.state.players.length; i++) {
      const p = this.state.players[i];
      const delta = p.stats.matsGathered - (this.lastMatsSample[i] ?? 0);
      this.lastMatsSample[i] = p.stats.matsGathered;
      p.incomeHistory.push(delta);
      if (p.incomeHistory.length > 60) p.incomeHistory.shift();
      void this.incomeSamples;
    }
  }

  matsPerMinute(playerId: number): number {
    const p = this.player(playerId);
    if (!p) return 0;
    // incomeHistory holds 60 samples at VISION_INTERVAL (0.5 s), i.e. 30 s.
    // Normalise that window to the per-minute rate the HUD displays.
    return Math.round(p.incomeHistory.reduce((a, b) => a + b, 0) * 2);
  }

  /**
   * Grid balance for one player, recomputed from live structures. Construction
   * sites draw nothing until they finish, and a destroyed structure stops both
   * its output and its draw.
   */
  powerStatus(playerId: number): PowerStatus {
    let supply = 0;
    let demand = 0;
    for (const e of this.state.entities) {
      if (e.owner !== playerId || e.kind !== 'building' || e.construction || e.hp <= 0) continue;
      const draw = BUILDINGS[e.defId]?.power ?? 0;
      const modulePower = e.modules?.length
        ? installedModuleEffects(e.modules, this.research).power
        : 0;
      const total = draw + modulePower;
      if (total >= 0) supply += total;
      else demand -= total;
    }
    if (demand <= supply) return { supply, demand, ratio: 1, brownout: false };
    return { supply, demand, ratio: supply / demand, brownout: true };
  }

  /**
   * Production and construction multiplier for a brownout: full speed on a
   * balanced grid, degrading to 35% at zero supply. Never a hard stop, so a
   * cut grid slows the base rather than silently freezing it.
   */
  powerSpeed(playerId: number): number {
    return Math.max(0.35, this.powerStatus(playerId).ratio);
  }

  reqRate(playerId: number): number {
    let rate = 0;
    for (const e of this.state.entities) {
      if (e.owner !== playerId || e.kind !== 'building' || e.construction || e.hp <= 0) continue;
      rate += BUILDINGS[e.defId]?.reqPerSec ?? 0;
    }
    return Math.round(rate * 10) / 10;
  }

  /**
   * Passive material income, in mats per second. Lifeline sources (the
   * headquarters trickle) only pay while the owner has no working hauling
   * economy, so ordinary hauling is never double-counted.
   */
  private passiveMatsFor(playerId: number): number {
    const player = this.player(playerId);
    let harvesters = 0;
    let refineries = 0;
    for (const e of this.state.entities) {
      if (e.owner !== playerId || e.hp <= 0) continue;
      if (e.kind === 'unit' && e.defId === 'harvester') harvesters++;
      else if (e.kind === 'building' && BUILDINGS[e.defId]?.refinery) refineries++;
    }
    // The lifeline covers a base with no working hauling economy. A hauler with
    // nowhere to tip is not hauling — all refineries were lost — and that used
    // to be a permanent dead end: no income to buy the replacement. The bank
    // test keeps the trickle off while a drop-off is already affordable, so an
    // ordinary opening or a well-funded rebuild is never subsidised.
    const hauling =
      harvesters > 0 &&
      (refineries > 0 || (player?.mats ?? 0) >= REFINERY_REPLACEMENT_COST);
    let rate = 0;
    for (const e of this.state.entities) {
      if (e.owner !== playerId || e.kind !== 'building' || e.construction || e.hp <= 0) continue;
      const def = BUILDINGS[e.defId];
      if (!def?.matsPerSec) continue;
      if (def.matsPerSecBackstop && hauling) continue;
      rate += def.matsPerSec;
    }
    return rate;
  }

  /** Passive material income from captured facilities, in mats per second. */
  passiveMatsRate(playerId: number): number {
    return Math.round(this.passiveMatsFor(playerId) * 100) / 100;
  }

  /**
   * Radar network summary used by the HUD and tests. A station's feed is lost
   * in a grid brownout, matching the minimap radar rule.
   */
  radarNetwork(playerId: number): {
    stations: number;
    online: number;
    radius: number;
    contacts: number;
    brownout: boolean;
  } {
    const brownout = this.powerStatus(playerId).brownout;
    let stations = 0;
    let radius = 0;
    for (const e of this.state.entities) {
      if (e.owner !== playerId || e.kind !== 'building' || e.construction || e.hp <= 0) continue;
      const scan = (BUILDINGS[e.defId]?.scanRadius ?? 0) * ewScanFactor(this.player(playerId)?.superweapon, this.state.tick);
      if (scan <= 0) continue;
      stations++;
      radius = Math.max(radius, scan);
    }
    let contacts = 0;
    if (stations > 0 && !brownout) {
      for (const enemy of this.state.entities) {
        if (enemy.hp <= 0 || enemy.kind !== 'unit' || !this.isHostile(playerId, enemy.owner)) continue;
        if (!this.isVisibleTo(this.teamOf(playerId), enemy.id)) continue;
        for (const e of this.state.entities) {
          if (e.owner !== playerId || e.kind !== 'building' || e.construction || e.hp <= 0) continue;
          const scan =
            (BUILDINGS[e.defId]?.scanRadius ?? 0) *
            ewScanFactor(this.player(e.owner)?.superweapon, this.state.tick);
          if (scan > 0 && dist(e.x, e.z, enemy.x, enemy.z) <= scan * TILE_SIZE) {
            contacts++;
            break;
          }
        }
      }
    }
    return { stations, online: stations > 0 && !brownout ? stations : 0, radius, contacts, brownout };
  }

  private updateBuildingSystems(dt: number): void {
    const engineers = this.state.entities.filter(
      (e) => e.kind === 'unit' && e.hp > 0 && unitDef(e.defId).canBuild,
    );
    this.updateEngineerAssignments();
    // One grid evaluation per owner per tick, shared by construction and queues.
    const speeds = new Map<number, number>();
    const speedFor = (owner: number): number => {
      let s = speeds.get(owner);
      if (s === undefined) {
        s = this.powerSpeed(owner);
        speeds.set(owner, s);
      }
      return s;
    };
    for (const e of [...this.state.entities].sort((a, b) => a.id - b.id)) {
      if (e.kind !== 'building' || e.hp <= 0) continue;
      // Static defences keep their own reload clock too, which is what lets a
      // SAM site engage strategic munitions without firing every tick.
      if (e.cooldowns) {
        for (const id of Object.keys(e.cooldowns)) {
          const next = e.cooldowns[id] - dt;
          if (next <= 0) delete e.cooldowns[id];
          else e.cooldowns[id] = next;
        }
        if (Object.keys(e.cooldowns).length === 0) delete e.cooldowns;
      }
      // A sold structure is dead weight from the first tick: no vision, no
      // weapons, no production, no power. The clock is the only thing left.
      if (e.deconstruct) {
        e.deconstruct.remaining = Math.max(0, e.deconstruct.remaining - dt);
        if (e.deconstruct.remaining <= 0) this.completeSale(e);
        continue;
      }
      if (e.construction) {
        const def = buildingDef(e.defId);
        // Construction only advances while the assigned engineer is on site.
        // Calling the engineer away pauses the site at its current progress.
        const builder = engineers.find(
          (eng) =>
            eng.owner === e.owner &&
            eng.buildTargetId === e.id &&
            dist(eng.x, eng.z, e.x, e.z) <= ENGINEER_WORK_RANGE,
        );
        if (builder) {
          const rate = 1 / Math.max(1, def.buildTime);
          e.buildProgress = Math.min(1, e.buildProgress + rate * dt * speedFor(e.owner));
        }
        e.hp = Math.min(e.maxHp, e.maxHp * (0.2 + 0.8 * e.buildProgress));
        if (e.buildProgress >= 1) {
          if (builder) this.releaseBuildTarget(builder);
          e.construction = false;
          e.hp = e.maxHp;
          e.state = 'idle';
          e.buildProgress = 1;
          const p = this.player(e.owner);
          if (p) p.stats.buildingsBuilt++;
          this.emit('buildingComplete', {
            team: e.owner,
            x: e.x,
            z: e.z,
            text: `${def.name} operational`,
            entityId: e.id,
            defId: e.defId,
            level: 'success',
            sound: 'complete',
          });
          // A refinery arrives with its own hauler so the new income stream
          // starts without a second production order.
          if (def.refinery) {
            const harvester = this.spawnFromFacility(e, 'harvester');
            if (harvester) harvester.state = 'idle';
          }
        }
        continue;
      }
      if (e.queue.length > 0) {
        const item = e.queue[0];
        item.remaining -= dt * speedFor(e.owner);
        if (item.remaining <= 0) {
          const spawned = this.spawnFromFacility(e, item.defId);
          if (spawned) {
            e.queue.shift();
            this.emit('notice', {
              team: e.owner,
              x: e.x,
              z: e.z,
              text: `${unitDef(item.defId).name} deployed`,
              level: 'info',
            });
          } else if (this.state.tick % 100 === 0) {
            this.emit('orderFailed', {
              team: e.owner,
              x: e.x,
              z: e.z,
              text: 'Production blocked — clear space around the facility.',
              level: 'warning',
            });
          }
          item.remaining = 0;
        }
      }
      // Static weapons reload on the same tick clock as mobile units. Without
      // this decrement an emplacement fires once and then stays silent for the
      // rest of the battle.
      e.cooldown = Math.max(0, e.cooldown - dt);
      const weapons = entityWeapons(e);
      if (weapons.length > 0) {
        const turretRate = BUILDINGS[e.defId]?.turretRate;
        if (turretRate) this.updateStaticTurret(e, dt, turretRate, weapons);
        this.updateAutoEngagement(e, dt, weapons);
      }
    }
    this.updateGridNotices();
  }

  /**
   * One warning when an owner's grid goes short and one when it recovers.
   * Transitions only, so a long brownout does not flood the event log.
   */
  private updateGridNotices(): void {
    for (const p of this.state.players) {
      if (p.defeated) continue;
      const status = this.powerStatus(p.id);
      const was = this.gridBrownout.get(p.id) ?? false;
      if (status.brownout === was) continue;
      this.gridBrownout.set(p.id, status.brownout);
      const anchor = this.state.entities.find(
        (e) =>
          e.owner === p.id &&
          e.kind === 'building' &&
          e.hp > 0 &&
          !!BUILDINGS[e.defId]?.commandPost,
      );
      this.emit('notice', {
        team: p.id,
        x: anchor?.x ?? 0,
        z: anchor?.z ?? 0,
        text: status.brownout
          ? `Grid deficit: ${status.supply} supply for ${status.demand} demand — production and construction at ${Math.round(status.ratio * 100)}%. Build a Turbine Plant.`
          : 'Grid balanced — production and construction at full speed.',
        level: status.brownout ? 'warning' : 'success',
        sound: status.brownout ? 'alert' : 'complete',
        code: status.brownout ? undefined : 'powerRestored',
      });
    }
  }

  /** Find a legal spawn point for a produced unit. */
  /**
   * A finished unit appears on the apron beside its facility and then walks to
   * the rally point. The apron keeps the footprint clear, and the rally order
   * is validated like any other move (terrain class, blocked tiles, path), so a
   * rally set on water or inside a building simply leaves the unit on the apron.
   */
  private spawnFromFacility(building: Entity, defId: string): Entity | null {
    const unit = this.spawnAtFacility(building, defId);
    if (unit) this.sendToRally(unit, building);
    return unit;
  }

  private sendToRally(unit: Entity, building: Entity): void {
    const domain = unitDef(unit.defId).domain;
    // Aircraft take off under their own recovery logic; a ground-style move
    // order would just pin them to the apron.
    if (domain === 'air') return;
    if (!Number.isFinite(building.rallyX) || !Number.isFinite(building.rallyZ)) return;
    // A hull holding a land rally (an old save or an edited scenario) stays on
    // its berth rather than beaching itself.
    if (domain === 'naval' && !this.rallyStatus(building.id, building.rallyX, building.rallyZ).ok) {
      return;
    }
    if (dist(unit.x, unit.z, building.rallyX, building.rallyZ) < 2 * TILE_SIZE) return;
    this.commandMove(unit.owner, [unit.id], building.rallyX, building.rallyZ, false);
  }

  private spawnAtFacility(building: Entity, defId: string): Entity | null {
    const def = unitDef(defId);
    const bdef = BUILDINGS[building.defId];
    if (def.domain === 'air') {
      if (building.defId !== 'airfield') return null;
      const plane = this.spawnUnit(building.owner, defId, building.x, building.z);
      plane.aircraft!.landed = false;
      plane.aircraft!.homeId = building.id;
      plane.homeId = building.id;
      return plane;
    }
    if (def.domain === 'naval') {
      if (building.defId !== 'shipyard') return null;
      const structure: ScenarioStructure = {
        defId: building.defId,
        owner: building.owner,
        x: Math.round(building.x / TILE_SIZE - bdef.footprint.w / 2),
        z: Math.round(building.z / TILE_SIZE - bdef.footprint.h / 2),
      };
      const water = adjacentWater(this.state.scenario, structure);
      const sorted = water.sort((a, b) => {
        const da = dist2((a.x + 0.5) * TILE_SIZE, (a.z + 0.5) * TILE_SIZE, building.rallyX, building.rallyZ);
        const db = dist2((b.x + 0.5) * TILE_SIZE, (b.z + 0.5) * TILE_SIZE, building.rallyX, building.rallyZ);
        return da - db || a.z - b.z || a.x - b.x;
      });
      for (const t of sorted) {
        const x = (t.x + 0.5) * TILE_SIZE;
        const z = (t.z + 0.5) * TILE_SIZE;
        if (this.isSpawnClear(x, z, def.radius)) {
          const ship = this.spawnUnit(building.owner, defId, x, z);
          ship.homeId = building.id;
          return ship;
        }
      }
      return null;
    }
    // Ground units: spiral around the footprint, preferring the rally direction.
    const origin = {
      x: Math.round(building.x / TILE_SIZE - bdef.footprint.w / 2),
      z: Math.round(building.z / TILE_SIZE - bdef.footprint.h / 2),
    };
    const centerTileX = origin.x + Math.floor(bdef.footprint.w / 2);
    const centerTileZ = origin.z + Math.floor(bdef.footprint.h / 2);
    // The apron tile centred on the front face, which is where the factory
    // shutter is. A vehicle that appears there reads as driving out of the bay
    // and then follows its rally order, instead of popping in beside the wall.
    const apronZ = origin.z + bdef.footprint.h;
    if (inBounds(this.state.map.width, this.state.map.height, centerTileX, apronZ)) {
      const idx = tileIndex(this.state.map.width, centerTileX, apronZ);
      const x = (centerTileX + 0.5) * TILE_SIZE;
      const z = (apronZ + 0.5) * TILE_SIZE;
      if (
        !this.blocked[idx] &&
        canStandOn(this.state.map.width, this.state.map.height, this.state.map.terrain, idx, def.moveClass) &&
        this.isSpawnClear(x, z, def.radius)
      ) {
        return this.spawnUnit(building.owner, defId, x, z);
      }
    }
    for (let radius = bdef.footprint.w; radius <= bdef.footprint.w + 6; radius++) {
      const candidates: Array<{ tx: number; tz: number }> = [];
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          candidates.push({ tx: centerTileX + dx, tz: centerTileZ + dz });
        }
      }
      candidates.sort((a, b) => {
        const da = dist2((a.tx + 0.5) * TILE_SIZE, (a.tz + 0.5) * TILE_SIZE, building.rallyX, building.rallyZ);
        const db = dist2((b.tx + 0.5) * TILE_SIZE, (b.tz + 0.5) * TILE_SIZE, building.rallyX, building.rallyZ);
        return da - db || a.tz - b.tz || a.tx - b.tx;
      });
      for (const c of candidates) {
        if (!inBounds(this.state.map.width, this.state.map.height, c.tx, c.tz)) continue;
        const idx = tileIndex(this.state.map.width, c.tx, c.tz);
        if (this.blocked[idx]) continue;
        if (!canStandOn(this.state.map.width, this.state.map.height, this.state.map.terrain, idx, def.moveClass)) {
          continue;
        }
        const x = (c.tx + 0.5) * TILE_SIZE;
        const z = (c.tz + 0.5) * TILE_SIZE;
        if (!this.isSpawnClear(x, z, def.radius)) continue;
        return this.spawnUnit(building.owner, defId, x, z);
      }
    }
    return null;
  }

  private isSpawnClear(x: number, z: number, radius: number): boolean {
    for (const e of this.state.entities) {
      if (e.kind !== 'unit' || e.hp <= 0) continue;
      const min = (radius + unitDef(e.defId).radius) * 0.7;
      if (dist2(x, z, e.x, e.z) < min * min) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Vision                                                             */
  /* ------------------------------------------------------------------ */

  refreshVision(initial: boolean): void {
    const dayNight = this.dayNight;
    // One bounded light list per refresh, shared by the simulation and the
    // renderer. A browned-out base is dark, and a daylight map has none at all.
    this.lightSources = collectLightSources(
      this.state.entities,
      dayNight,
      (owner) => !this.powerStatus(owner).brownout,
    );
    this.litGrid = this.lightSources.length
      ? buildIlluminationGrid(this.state.scenario.width, this.state.scenario.height, this.lightSources)
      : null;
    if (!this.state.scenario.settings.fog) {
      for (let team = 0; team < 2; team++) {
        this.state.fog[team].fill(2);
        this.visible[team] = new Set(
          this.state.entities.filter((e) => e.hp > 0).map((e) => e.id),
        );
      }
      return;
    }
    for (let team = 0; team < 2; team++) {
      const fog = this.state.fog[team];
      if (!initial) {
        for (let i = 0; i < fog.length; i++) if (fog[i] === 2) fog[i] = 1;
      } else {
        fog.fill(0);
      }
      for (const e of this.state.entities) {
        if (e.hp <= 0) continue;
        const ownerTeam = this.teamOf(e.owner);
        if (ownerTeam !== team) continue;
        // Darkness shortens what a unit can pick out; optics decide by how much.
        // A hull adds its own penalty: in a real sea state the watch is looking
        // through spray from a deck that will not hold still, so a ship sees
        // less far than a vehicle on the shore in the same weather.
        const seaReach = UNITS[e.defId]?.domain === 'naval' ? this.weather.navalVision : 1;
        const vision =
          entityVision(e) *
          visionFactor(sensorFor(e), dayNight) *
          this.weather.visibility *
          seaReach *
          ewVisionFactor(
            this.player(e.owner)?.superweapon,
            this.state.tick,
            UNITS[e.defId]?.domain,
            EW_EFFECT,
            e.kind === 'building',
          );
        this.stampVision(fog, e.x, e.z, vision);
      }
      // A team's own lights reveal their own yard to that team. This is why a
      // floodlit base keeps its perimeter at night while an unlit one goes blind
      // beyond its optics.
      for (const light of this.lightSources) {
        if (light.owner < 0 || this.teamOf(light.owner) !== team) continue;
        const reach = light.vertical === 'ground' ? light.radius : light.radius * 0.6;
        this.stampVision(fog, light.x, light.z, reach);
      }
    }
    for (let team = 0; team < 2; team++) this.refreshVisibleEntities(team, initial, dayNight);
    this.ageContacts();
  }

  private stampVision(fog: Uint8Array, x: number, z: number, visionTiles: number): void {
    const map = this.state.map;
    const cx = Math.floor(x / TILE_SIZE);
    const cz = Math.floor(z / TILE_SIZE);
    const r = Math.ceil(visionTiles);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > visionTiles * visionTiles) continue;
        const tx = cx + dx;
        const tz = cz + dz;
        if (!inBounds(map.width, map.height, tx, tz)) continue;
        const i = tileIndex(map.width, tx, tz);
        if (fog[i] === 2) continue;
        const txw = (tx + 0.5) * TILE_SIZE;
        const tzw = (tz + 0.5) * TILE_SIZE;
        // Smoke cuts the sight line into its own footprint. A crew standing in
        // the same cloud is exempt, so smoke blinds the observer outside it
        // rather than blinding everyone.
        if (this.smokeScreens(x, z, txw, tzw)) continue;
        if (!hasLineOfSight(map, x, z, txw, tzw)) continue;
        fog[i] = 2;
      }
    }
  }

  private litAt(x: number, z: number): number {
    const grid = this.litGrid;
    if (!grid) return 0;
    return illuminationAt(grid, this.state.scenario.width, this.state.scenario.height, x, z);
  }

  /**
   * A target standing in a lit pool is easier to pick out: an optical observer
   * gains extra reach against it. Illumination never reveals anything nobody
   * can see; it only stretches the observer's reach where the light falls.
   */
  private seesLitTarget(target: Entity, team: number, dayNight: DayNightState): boolean {
    for (const source of this.state.entities) {
      if (source.hp <= 0 || source.owner < 0 || this.teamOf(source.owner) !== team) continue;
      const reach =
        entityVision(source) *
        visionFactor(sensorFor(source), dayNight) *
        this.weather.visibility *
        (1 + ILLUMINATED_TARGET_BONUS) *
        ewVisionFactor(
          this.player(source.owner)?.superweapon,
          this.state.tick,
          UNITS[source.defId]?.domain,
          EW_EFFECT,
          source.kind === 'building',
        );
      if (dist(source.x, source.z, target.x, target.z) > reach * TILE_SIZE) continue;
      if (!hasLineOfSight(this.state.map, source.x, source.z, target.x, target.z)) continue;
      return true;
    }
    return false;
  }

  /** A vehicle showing a light gives itself away to anyone close enough to see it. */
  private seesOwnLight(target: Entity, team: number): boolean {
    let radius = 0;
    for (const light of this.lightSources) {
      if (light.entityId === target.id) radius = Math.max(radius, light.radius);
    }
    if (radius <= 0) return false;
    for (const source of this.state.entities) {
      if (source.hp <= 0 || source.owner < 0 || this.teamOf(source.owner) !== team) continue;
      if (dist(source.x, source.z, target.x, target.z) > radius * 1.3 * TILE_SIZE) continue;
      if (!hasLineOfSight(this.state.map, source.x, source.z, target.x, target.z)) continue;
      return true;
    }
    return false;
  }

  private refreshVisibleEntities(team: number, initial = false, dayNight = this.dayNight): void {
    const previous = this.visible[team] ?? new Set<number>();
    const set = new Set<number>();
    const fog = this.state.fog[team];
    const map = this.state.map;
    const gridBrownout = new Map<number, boolean>();
    const radars: Array<{ x: number; z: number; radius: number; owner: number }> = [];
    for (const e of this.state.entities) {
      if (e.hp <= 0 || e.kind !== 'building' || e.construction) continue;
      if (this.teamOf(e.owner) !== team) continue;
      const scan =
        (BUILDINGS[e.defId]?.scanRadius ?? 0) *
        ewScanFactor(this.player(e.owner)?.superweapon, this.state.tick);
      if (scan <= 0) continue;
      let brownout = gridBrownout.get(e.owner);
      if (brownout === undefined) {
        brownout = this.powerStatus(e.owner).brownout;
        gridBrownout.set(e.owner, brownout);
      }
      if (brownout) continue;
      radars.push({ x: e.x, z: e.z, radius: scan, owner: e.owner });
    }
    // Sonar is a unit sensor, not a powered structure: an escort's set works
    // even when the grid is browned out. It is the only sensor that can find a
    // dived boat through fog without the boat revealing itself.
    const sonars: Array<{ x: number; z: number; radius: number; owner: number }> = [];
    for (const e of this.state.entities) {
      if (e.hp <= 0 || e.kind !== 'unit' || e.garrisonId) continue;
      if (e.owner < 0 || this.teamOf(e.owner) !== team) continue;
      const sonar = UNITS[e.defId]?.sonar ?? 0;
      if (sonar > 0) sonars.push({ x: e.x, z: e.z, radius: sonar, owner: e.owner });
    }
    let radarContacts = 0;
    let radarSource: { x: number; z: number; owner: number } | null = null;
    let sonarContact: Entity | null = null;
    let newHostile: Entity | null = null;
    for (const e of this.state.entities) {
      if (e.hp <= 0) continue;
      if (e.owner >= 0 && this.teamOf(e.owner) === team) {
        set.add(e.id);
        continue;
      }
      // Every structure, neutral objectives included, has to be seen before
      // it is drawn: nothing is charted for free.
      if (e.kind === 'unit' && e.garrisonId) continue;
      const radar = radars.find(
        (r) => dist(r.x, r.z, e.x, e.z) <= r.radius * TILE_SIZE,
      );
      const sub = e.submarine;
      const dived = !!sub?.dived;
      const datum = dived && !!sub?.revealed;
      const sonar = dived && !datum
        ? sonars.find((s) => dist(s.x, s.z, e.x, e.z) <= s.radius * TILE_SIZE)
        : undefined;
      const tx = Math.floor(e.x / TILE_SIZE);
      const tz = Math.floor(e.z / TILE_SIZE);
      if (!inBounds(map.width, map.height, tx, tz)) continue;
      const idx = tileIndex(map.width, tx, tz);
      const fogValue = this.state.scenario.settings.fog ? fog[idx] : 2;
      // Illumination and a vehicle's own lights are the two ways a target can be
      // picked out beyond the observer's own reach. Both still go through the
      // authoritative line of sight and the team's own sources.
      const lit = e.owner >= 0 && e.kind === 'unit' ? this.litAt(e.x, e.z) : 0;
      const litVisible = lit > 0.25 && this.seesLitTarget(e, team, dayNight);
      const ownLightVisible =
        e.kind === 'unit' && dayNight.darkness > 0 && this.seesOwnLight(e, team);
      if (fogValue !== 2 && !radar && !sonar && !datum && !litVisible && !ownLightVisible) continue;
      // Aircraft are large, noisy and above the canopy: forest concealment
      // applies to ground units, not to any airframe. A dived boat is under
      // the water, so the canopy is irrelevant to it as well.
      if (!radar && !dived && e.kind === 'unit' && UNITS[e.defId]?.domain !== 'air') {
        const terrain = this.state.map.terrain[idx] as TerrainId;
        // Concealment stacks the base terrain with whatever surface cover the
        // tile carries, so crops, reeds and scrub hide a unit the way canopy
        // always did — without any of them counting as armour.
        const concealment = tileConcealment(terrain, this.state.map.overlay?.[idx] ?? 0);
        if (concealment >= 0.4) {
          // Concealed units are only spotted at close range, and darkness
          // tightens that range; a lit clearing loosens it again. Full
          // concealment (dense reeds, deep canopy) close the range further.
          const tightness = Math.max(0, concealment - 0.8) / 0.2;
          const closeRange =
            (lit > 0.25 ? 2.5 : 4.5) *
            (1 - 0.45 * tightness) *
            (1 - 0.35 * dayNight.darkness) *
            this.weather.visibility;
          let close = false;
          for (const source of this.state.entities) {
            if (source.hp <= 0 || source.owner < 0 || this.teamOf(source.owner) !== team) continue;
            if (dist(source.x, source.z, e.x, e.z) <= closeRange * TILE_SIZE) {
              close = true;
              break;
            }
          }
          if (!close) continue;
        }
      }
      // A dived boat is invisible outside periscope range and an escort's
      // sonar. A launch datum or a depth-charge hit bypasses both.
      if (dived && !datum && !sonar) {
        const def = UNITS[e.defId]?.submarine;
        let close = false;
        for (const source of this.state.entities) {
          if (source.hp <= 0 || source.owner < 0 || this.teamOf(source.owner) !== team) continue;
          if (dist(source.x, source.z, e.x, e.z) <= (def?.closeDetect ?? 4.5) * TILE_SIZE) {
            close = true;
            break;
          }
        }
        if (!close) continue;
      }
      set.add(e.id);
      if (sonar && !previous.has(e.id) && e.kind === 'unit') sonarContact ??= e;
      // A newly visible hostile is a genuine detection. The event is emitted
      // only for the local team and only after visibility, fog and concealment
      // have already approved the sighting, so it cannot reveal hidden units.
      if (
        !initial &&
        team === this.teamOf(this.localPlayerId) &&
        e.kind === 'unit' &&
        e.owner >= 0 &&
        this.isHostile(e.owner, this.localPlayerId) &&
        !previous.has(e.id) &&
        !sonar &&
        !newHostile
      ) {
        newHostile = e;
      }
      // Structures never move, so a building that has been seen once is kept
      // as a remembered silhouette after it drops out of vision.
      if (e.kind === 'building' && this.teamOf(e.owner) !== team) this.chartBuilding(team, e.id);
      // Contacts are hostile sightings: neutral shelters and objectives can be
      // charted without ever being filed as an enemy position.
      if (e.owner >= 0) this.recordContact(team, e);
      if (radar && !previous.has(e.id) && e.kind === 'unit') {
        radarContacts++;
        radarSource ??= radar;
      }
    }
    this.visible[team] = set;
    if (newHostile) {
      this.emit('notice', {
        team: this.localPlayerId,
        x: newHostile.x,
        z: newHostile.z,
        text: `Enemy detected — ${entityName(newHostile)}`,
        entityId: newHostile.id,
        level: 'info',
        code: 'enemyDetected',
      });
    }
    if (radarContacts > 0 && radarSource) {
      const owner = this.state.players.find((p) => p.team === team)?.id;
      if (owner !== undefined) {
        this.emit('notice', {
          team: owner,
          x: radarSource.x,
          z: radarSource.z,
          text: `Radar contact — ${radarContacts} hostile ${radarContacts === 1 ? 'unit' : 'units'} plotted`,
          level: 'info',
          sound: 'radar',
        });
      }
    }
    if (sonarContact) {
      const owner = this.state.players.find((p) => p.team === team)?.id;
      if (owner !== undefined) {
        this.emit('notice', {
          team: owner,
          x: sonarContact.x,
          z: sonarContact.z,
          text: `Sonar contact — ${entityName(sonarContact)}`,
          entityId: sonarContact.id,
          level: 'warning',
          sound: 'radar',
        });
      }
    }
  }

  /** Coarse class for a sighting; the exact definition is withheld afterwards. */
  private contactBand(e: Entity): ContactBand {
    if (e.kind === 'building') return 'structure';
    const def = UNITS[e.defId];
    if (!def) return 'armour';
    if (def.domain === 'air') return 'air';
    if (def.domain === 'naval') return 'naval';
    return def.armour === 'infantry' ? 'infantry' : 'armour';
  }

  private recordContact(team: number, e: Entity): void {
    const existing = this.state.contacts.find(
      (c) => c.team === team && c.entityId === e.id,
    );
    if (existing) {
      existing.x = e.x;
      existing.z = e.z;
      existing.tick = this.state.tick;
      existing.defId = e.defId;
      existing.kind = e.kind;
      existing.state = 'confirmed';
      existing.band = this.contactBand(e);
    } else {
      this.state.contacts.push({
        team,
        entityId: e.id,
        x: e.x,
        z: e.z,
        tick: this.state.tick,
        defId: e.defId,
        kind: e.kind,
        state: 'confirmed',
        band: this.contactBand(e),
      });
    }
  }

  /**
   * Age every contact the team can no longer see. A sighting is confirmed only
   * while the unit is in vision; the tick vision drops it becomes detected — the
   * last position is still usable, the exact type is withdrawn — and after the
   * detection window it degrades to a fading last-known mark. A contact is
   * dropped when its source is gone or it has been unseen for the expiry window,
   * so a memory never outlives the thing that produced it. Only observed state is
   * ever stored: nothing here reads an unseen entity's current position.
   */
  private ageContacts(): void {
    const tick = this.state.tick;
    const alive = new Set<number>();
    for (const e of this.state.entities) if (e.hp > 0) alive.add(e.id);
    const kept: ContactRecord[] = [];
    for (const c of this.state.contacts) {
      if (!alive.has(c.entityId)) continue;
      const age = Math.max(0, tick - c.tick);
      if (age > CONTACT_EXPIRE_TICKS) continue;
      const state: ContactState = c.state ?? 'confirmed';
      if (this.isVisibleTo(c.team, c.entityId)) {
        // The vision refresh owns confirmed records; this only repairs a record
        // that survived a settings change or a load without being refreshed.
        c.state = 'confirmed';
      } else if (c.kind === 'building') {
        // Structures do not move and are held by the charted silhouettes, so a
        // building contact keeps its identification rather than degrading.
        kept.push(c);
        continue;
      } else if (state === 'confirmed') {
        c.state = 'detected';
        delete c.defId;
      } else if (state === 'detected' && age > CONTACT_DETECTED_TICKS) {
        c.state = 'last-known';
        delete c.defId;
        delete c.band;
        delete c.kind;
      }
      kept.push(c);
    }
    this.state.contacts = kept;
  }

  isVisibleTo(team: number, entityId: number): boolean {
    if (!this.state.scenario.settings.fog) return true;
    return this.visible[team]?.has(entityId) ?? false;
  }

  /**
   * Adopt the room's authoritative map for presentation.
   *
   * A networked client never simulates, but the ground it paints must be the
   * ground the server is fighting over: the surface layer decides whether a
   * tile reads as crop rows, reeds or a hedgerow, and therefore how thick the
   * vegetation looks and where the sight lines appear to close. The projection
   * ships the map once, so this copies it into the runtime buffers and into the
   * authored tiles the renderer rebuilds geometry and props from.
   *
   * Returns true only when the ground itself changed — terrain, elevation or the
   * surface layer — so the caller rebuilds the terrain GPU resources once rather
   * than on every resync. Remaining material is adopted either way; the renderer
   * already refreshes ore props from the runtime map.
   */
  adoptNetworkMap(projected: {
    width: number;
    height: number;
    terrain: number[];
    elevation: number[];
    ore: number[];
    overlay?: number[];
  }): boolean {
    const scenario = this.state.scenario;
    const map = this.state.map;
    const size = scenario.width * scenario.height;
    if (projected.width !== scenario.width || projected.height !== scenario.height) return false;
    if (
      projected.terrain.length !== size ||
      projected.elevation.length !== size ||
      projected.ore.length !== size
    ) {
      return false;
    }
    if (projected.overlay && projected.overlay.length !== size) return false;

    const terrain = Uint8Array.from(projected.terrain);
    const elevation = Uint8Array.from(projected.elevation);
    const ore = Uint16Array.from(projected.ore);
    const overlay = projected.overlay ? Uint8Array.from(projected.overlay) : null;
    const tiles = scenario.tiles;
    // The renderer builds geometry and props from the authored tiles, so that is
    // where a "the ground changed" answer has to come from.
    let ground = false;
    let material = false;
    for (let i = 0; i < size && !(ground && material); i++) {
      ground ||=
        tiles[i].t !== terrain[i] ||
        tiles[i].e !== elevation[i] ||
        (overlay !== null && (tiles[i].v ?? 0) !== overlay[i]);
      material ||= map.ore[i] !== ore[i];
    }
    if (!ground && !material) return false;

    map.terrain.set(terrain);
    map.elevation.set(elevation);
    map.ore.set(ore);
    // The ship carries remaining material, not the authored maximum. Keep the
    // richer of the two per tile so a partially mined deposit still renders as
    // partially mined rather than refilling.
    for (let i = 0; i < size; i++) map.maxOre[i] = Math.max(map.maxOre[i], ore[i]);
    if (overlay) {
      if (!map.overlay || map.overlay.length !== size) map.overlay = new Uint8Array(size);
      map.overlay.set(overlay);
    }
    for (let i = 0; i < size; i++) {
      const tile = tiles[i];
      tile.t = terrain[i];
      tile.e = elevation[i];
      tile.o = ore[i];
      if (overlay) {
        if (overlay[i] === 0) delete tile.v;
        else tile.v = overlay[i];
      }
    }
    return ground;
  }

  /**
   * Adopt a presentation-only view of the world.
   *
   * A networked client never simulates: it draws the team-visible projection
   * the room sends. The shell owns entity identity (so presentation smoothing
   * survives an update), and this replaces the buffers the renderer and HUD
   * read while rebuilding the indexes they look things up through — the id map,
   * the charted index and the local team's visible set. The simulation clock,
   * RNG, AI and command queue are untouched because nothing here ticks.
   */
  adoptNetworkView(view: {
    entities: Entity[];
    players: PlayerState[];
    projectiles: Projectile[];
    contacts: ContactRecord[];
    charted: ChartedStructure[];
    smoke: SmokeCloud[];
    fog: Uint8Array;
    tick: number;
    victory: VictoryState;
    events: SimEvent[];
    visibleIds: Iterable<number>;
  }): void {
    this.state.entities = view.entities;
    this.state.players = view.players;
    this.state.projectiles = view.projectiles;
    this.state.contacts = view.contacts;
    this.state.charted = view.charted;
    // Clouds are drawn and, on the authoritative side, resolved; a client only
    // needs the same geometry the server used.
    this.state.smoke = view.smoke.map((cloud) => ({ ...cloud }));
    this.state.tick = view.tick;
    this.state.victory = view.victory;
    this.state.events = view.events;
    this.byId.clear();
    for (const entity of view.entities) this.byId.set(entity.id, entity);
    this.rebuildChartedIndex();
    // The adopted view is complete for drawing, even though nothing simulated it.
    this.state.ready = true;
    const team = this.teamOf(this.localPlayerId);
    if (team >= 0 && team < this.visible.length) {
      this.visible[team] = new Set(view.visibleIds);
      const fog = this.state.fog[team];
      if (fog && fog.length === view.fog.length) fog.set(view.fog);
      else this.state.fog[team] = view.fog;
    }
    const last = view.events[view.events.length - 1];
    if (last) this.state.eventSeq = Math.max(this.state.eventSeq, last.seq + 1);
  }

  /** Record a structure as seen by a team; safe to call every vision refresh. */
  private chartBuilding(team: number, entityId: number): void {
    const key = `${team}:${entityId}`;
    if (this.chartedIndex.has(key)) return;
    this.chartedIndex.add(key);
    this.state.charted.push({ team, entityId });
  }

  private rebuildChartedIndex(): void {
    this.chartedIndex.clear();
    for (const c of this.state.charted) this.chartedIndex.add(`${c.team}:${c.entityId}`);
  }

  /**
   * Three-state knowledge for drawing: a unit is only ever visible or hidden,
   * while a structure the team has already charted stays on the map as a
   * dimmed silhouette once it leaves vision. Structure coordinates never move,
   * so a remembered building is always drawn where it really is.
   */
  visionStateOf(team: number, entityId: number): VisionState {
    if (!this.state.scenario.settings.fog) return 'visible';
    if (this.visible[team]?.has(entityId)) return 'visible';
    const e = this.byId.get(entityId);
    if (!e || e.hp <= 0 || e.kind !== 'building') return 'hidden';
    return this.chartedIndex.has(`${team}:${entityId}`) ? 'remembered' : 'hidden';
  }

  /** Visible now, or a structure the team can still recall. */
  isKnownTo(team: number, entityId: number): boolean {
    return this.visionStateOf(team, entityId) !== 'hidden';
  }

  visibleEnemies(owner: number): Entity[] {
    const team = this.teamOf(owner);
    const out: Entity[] = [];
    for (const e of this.state.entities) {
      if (e.hp <= 0) continue;
      if (!this.isHostile(owner, e.owner)) continue;
      if (this.isVisibleTo(team, e.id)) out.push(e);
    }
    return out;
  }

  contactsFor(owner: number): ContactRecord[] {
    const team = this.teamOf(owner);
    return this.state.contacts.filter((c) => c.team === team && !this.isVisibleTo(team, c.entityId));
  }

  fogAt(team: number, tileX: number, tileZ: number): number {
    if (!this.state.scenario.settings.fog) return 2;
    if (!inBounds(this.state.map.width, this.state.map.height, tileX, tileZ)) return 0;
    return this.state.fog[team][tileIndex(this.state.map.width, tileX, tileZ)];
  }

  /* ------------------------------------------------------------------ */
  /* Units                                                              */
  /* ------------------------------------------------------------------ */

  private updateUnits(dt: number): void {
    // Built lazily on the first support tick so battles without medics or
    // recovery vehicles pay no extra scan. Each list is shared by every
    // support unit in this tick only.
    let wounded: Entity[] | null = null;
    let repairable: Entity[] | null = null;
    for (const e of [...this.state.entities].sort((a, b) => a.id - b.id)) {
      if (e.kind !== 'unit' || e.hp <= 0) continue;
      if (e.garrisonId) continue;
      e.cooldown = Math.max(0, e.cooldown - dt);
      // Ability reload is the hull's own clock, in simulation seconds. It is
      // decremented here, in the fixed tick, so a reload is identical on every
      // peer and survives a reload of a save file.
      if (e.cooldowns) {
        for (const id of Object.keys(e.cooldowns)) {
          const next = e.cooldowns[id] - dt;
          if (next <= 0) delete e.cooldowns[id];
          else e.cooldowns[id] = next;
        }
        if (Object.keys(e.cooldowns).length === 0) delete e.cooldowns;
      }
      e.suppression = Math.max(0, e.suppression - dt * 0.12);
      // The counter means "ticks spent under a movement order without getting
      // anywhere". Anything that is not trying to travel resets it, so a quiet
      // garrison, a gunner on target or a miner at a seam is never mistaken for
      // a wedged hull; an order that is not yet walking (an attack still to be
      // closed, a route waiting on traffic) still accrues it, which is what the
      // attack and garrison handlers watch to decide when to re-plan.
      if (this.wantsToTravel(e)) e.blockedTicks++;
      else e.blockedTicks = 0;
      const def = unitDef(e.defId);
      if (this.updateGarrisonOrder(e)) continue;
      if (def.domain === 'air') {
        this.updateAircraft(e, def, dt);
        continue;
      }
      if (e.submarine) this.updateSubmarine(e, dt);
      if (def.domain === 'naval') {
        this.updateNaval(e, dt);
      }
      if (e.harvester) this.updateHarvester(e, dt);
      this.updateOrderTargeting(e, def, dt);
      this.moveAlongPath(e, def, dt);
      this.updateTurret(e, def, dt);
      if (e.defId === 'medic') {
        wounded ??= this.state.entities.filter(
          (t) =>
            t.kind === 'unit' &&
            t.hp > 0 &&
            t.hp < t.maxHp &&
            unitDef(t.defId).armour === 'infantry',
        );
        this.updateMedic(e, dt, wounded);
      }
      if (def.repair) {
        repairable ??= this.state.entities
          .filter((t) => {
            if (t.kind !== 'unit' || t.hp <= 0 || t.hp >= t.maxHp) return false;
            const tdef = unitDef(t.defId);
            return tdef.domain === 'land' && tdef.armour !== 'infantry';
          })
          .sort((a, b) => a.id - b.id);
        this.updateRecovery(e, def, dt, repairable);
      }
      const weapons = entityWeapons(e);
      if (weapons.length > 0) this.updateAutoEngagement(e, dt, weapons);
    }
    this.separateUnits();
    this.persistRng();
  }

  /**
   * Diesel-electric endurance. A dived boat burns battery and is forced up
   * when it runs dry; a surfaced boat recharges. The launch datum is a short
   * timer, not a permanent reveal, so stealth is a cycle rather than a switch.
   */
  private updateSubmarine(e: Entity, dt: number): void {
    const sub = e.submarine;
    if (!sub) return;
    if (sub.revealTimer > 0) {
      sub.revealTimer = Math.max(0, sub.revealTimer - dt);
      if (sub.revealTimer <= 0) sub.revealed = false;
    }
    if (sub.dived) {
      sub.battery = Math.max(0, sub.battery - dt);
      if (sub.battery <= 0) {
        sub.dived = false;
        sub.revealed = false;
        sub.revealTimer = 0;
        this.emit('alert', {
          team: e.owner,
          x: e.x,
          z: e.z,
          text: `${UNITS[e.defId]?.name ?? 'Submarine'} battery exhausted — surfacing`,
          entityId: e.id,
          level: 'warning',
          sound: 'alert',
        });
      }
    } else {
      // A full recharge takes about 28 s, so a forced surfacing is a real
      // operational pause instead of a one-second dip back under the surface.
      sub.battery = Math.min(sub.maxBattery, sub.battery + dt * 1.6);
    }
  }

  /** Expose a submarine for a few seconds after a launch or a depth-charge hit. */
  private revealSubmarine(e: Entity, seconds: number): void {
    const sub = e.submarine;
    if (!sub || !sub.dived) return;
    sub.revealed = true;
    sub.revealTimer = Math.max(sub.revealTimer, seconds);
    // The launch datum is immediate. Without this, a boat firing in a fogged
    // tile would stay out of the visible set until the next half-second vision
    // refresh, hiding its own muzzle flash and torpedo launch.
    for (const team of this.visible) team.add(e.id);
  }

  private updateNaval(e: Entity, dt: number): void {
    const home = this.getEntity(e.homeId);
    const docked =
      !!home &&
      home.hp > 0 &&
      !home.construction &&
      dist(e.x, e.z, home.x, home.z) <= 6 * TILE_SIZE;
    if (docked) {
      // Repair is independent of the missile rack: a fully armed corvette must
      // still be able to patch damage at its shipyard.
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.012 * dt);
      if (e.ammo < e.maxAmmo) {
        // Reload one missile every 2.5s while docked.
        e.reloadTimer = (e.reloadTimer ?? 0) + dt;
        if (e.reloadTimer >= 2.5) {
          e.reloadTimer = 0;
          e.ammo = Math.min(e.maxAmmo, e.ammo + 1);
          this.emit('notice', {
            team: e.owner,
            x: e.x,
            z: e.z,
            text: `${UNITS[e.defId]?.name ?? 'Vessel'} reloaded (${e.ammo}/${e.maxAmmo})`,
            level: 'info',
          });
        }
      }
    }
    if (e.ammo <= 0 && e.order?.type !== 'return') {
      const homeAlive = home && home.hp > 0;
      if (homeAlive) {
        this.emit('alert', {
          team: e.owner,
          x: e.x,
          z: e.z,
          text: `${UNITS[e.defId]?.name ?? 'Vessel'} out of missiles — returning to shipyard`,
          level: 'warning',
          entityId: e.id,
          sound: 'alert',
        });
        e.order = { type: 'return', x: home.x, z: home.z };
        const path = this.findPathFor(e, home.x, home.z);
        e.path = path ?? [];
        e.pathIndex = 0;
        e.destX = home.x;
        e.destZ = home.z;
        e.state = 'returning';
      }
    }
    if (e.order?.type === 'return') {
      const home2 = this.getEntity(e.homeId);
      if (home2 && home2.hp > 0 && dist(e.x, e.z, home2.x, home2.z) < 6 * TILE_SIZE) {
        e.order = null;
        e.path = [];
        e.state = 'idle';
        e.destX = e.x;
        e.destZ = e.z;
      }
    }
  }

  private updateAircraft(e: Entity, def: UnitDef, dt: number): void {
    const ac = e.aircraft;
    if (!ac) return;
    const home = this.getEntity(ac.homeId);
    if (ac.landed) {
      e.fuel = Math.max(0, e.fuel);
      if (e.state === 'rearming') {
        ac.serviceTimer -= dt;
        e.hp = Math.min(e.maxHp, e.hp + (e.maxHp / ac.serviceTotal) * dt);
        if (ac.serviceTimer <= 0) {
          e.ammo = e.maxAmmo;
          e.fuel = e.maxFuel;
          e.hp = e.maxHp;
          e.state = 'grounded';
          e.order = null;
          ac.returningHome = false;
          this.emit('aircraftReady', {
            team: e.owner,
            x: e.x,
            z: e.z,
            text: `${def.name} rearmed and ready`,
            entityId: e.id,
            level: 'success',
            sound: 'ready',
          });
        }
      }
      return;
    }
    // Airborne fuel burn and auto-recovery.
    e.fuel = Math.max(0, e.fuel - dt);
    if (!home || home.hp <= 0) {
      if (e.fuel <= 0) {
        e.hp -= 8 * dt;
        if (e.hp <= 0) this.emit('unitLost', { team: e.owner, x: e.x, z: e.z, text: `${def.name} lost — no recovery airfield`, entityId: e.id, level: 'critical' });
      }
    }
    const lowFuel = e.fuel < e.maxFuel * 0.25;
    const noAmmo = e.maxAmmo > 0 && e.ammo <= 0;
    if ((lowFuel || noAmmo) && !ac.returningHome && e.order?.type !== 'return' && home && home.hp > 0) {
      this.orderAircraftReturn(e);
      this.emit('alert', {
        team: e.owner,
        x: e.x,
        z: e.z,
        text: lowFuel
          ? `${def.name} low on fuel — returning to airfield`
          : `${def.name} out of ordnance — returning to airfield`,
        level: 'warning',
        entityId: e.id,
        sound: 'alert',
      });
    }
    if (e.order?.type === 'return') {
      if (home && home.hp > 0 && dist(e.x, e.z, home.x, home.z) < 7 * TILE_SIZE) {
        e.x = home.x;
        e.z = home.z;
        e.path = [];
        e.pathIndex = 0;
        e.state = 'rearming';
        ac.landed = true;
        ac.serviceTimer = ac.serviceTotal;
        e.order = null;
        this.emit('aircraftReturn', {
          team: e.owner,
          x: e.x,
          z: e.z,
          text: `${def.name} landing — rearming`,
          entityId: e.id,
          level: 'info',
          sound: 'land',
        });
        return;
      }
    }
    if (e.fuel <= 0 && (!home || home.hp <= 0)) {
      // ditch
    }
    this.updateOrderTargeting(e, def, dt);
    this.moveAlongPath(e, def, dt);
    const weapons = entityWeapons(e);
    if (weapons.length > 0) this.updateAutoEngagement(e, dt, weapons);
  }

  private orderAircraftReturn(e: Entity): void {
    const home = this.getEntity(e.homeId);
    if (!home || home.hp <= 0) return;
    if (!e.aircraft) return;
    e.aircraft.returningHome = true;
    e.order = { type: 'return', x: home.x, z: home.z };
    e.path = [{ x: home.x, z: home.z }];
    e.pathIndex = 0;
    e.destX = home.x;
    e.destZ = home.z;
    e.state = 'returning';
  }

  private updateHarvester(e: Entity, dt: number): void {
    const h = e.harvester;
    if (!h) return;
    const player = this.player(e.owner);
    if (!player) return;
    if (e.order?.type === 'attack' || e.order?.type === 'capture') return;
    // A player move is authoritative until the hull arrives. The seek phase
    // used to replace the ordered path on the very next tick, which is why a
    // harvester could not be steered by hand.
    if (e.order?.type === 'move' || e.order?.type === 'attackMove') {
      if (e.path.length > 0) return;
      e.order = null;
      if (h.ore >= HARVESTER_CAPACITY) this.sendHarvesterToRefinery(e);
      else h.phase = 'seek';
      return;
    }
    // A full hopper always seeks a refinery, even after a player order.
    if (h.ore >= HARVESTER_CAPACITY && h.phase !== 'toRefinery' && h.phase !== 'unloading') {
      this.sendHarvesterToRefinery(e);
      return;
    }
    switch (h.phase) {
      case 'seek': {
        if (!this.findOreForHarvester(e)) {
          if (this.state.tick % 200 === 0) {
            this.emit('orderFailed', {
              team: e.owner,
              x: e.x,
              z: e.z,
              text: 'Harvester idle — no reachable material deposit.',
              level: 'warning',
            });
          }
          e.state = 'idle';
          return;
        }
        h.phase = 'toOre';
        h.timer = 0;
        break;
      }
      case 'toOre': {
        if (dist(e.x, e.z, (h.oreTileX + 0.5) * TILE_SIZE, (h.oreTileZ + 0.5) * TILE_SIZE) < HARVEST_REACH) {
          h.phase = 'mining';
          h.timer = 0;
          e.path = [];
          e.state = 'harvesting';
          e.destX = e.x;
          e.destZ = e.z;
          break;
        }
        // Arrived somewhere short of the deposit and unable to close the last
        // metres — the seam was built over, the lane is walled, or another
        // hauler is sitting on it. Look for another one instead of standing
        // here for the rest of the battle. The patience limit covers the case
        // where a route still exists on paper but the hull is going nowhere.
        if (e.path.length === 0 || e.blockedTicks > HARVEST_APPROACH_PATIENCE) {
          h.phase = 'seek';
          e.path = [];
          e.state = 'idle';
        }
        break;
      }
      case 'mining': {
        e.state = 'harvesting';
        const idx = tileIndex(this.state.map.width, h.oreTileX, h.oreTileZ);
        const available = idx >= 0 && idx < this.state.map.ore.length ? this.state.map.ore[idx] : 0;
        if (available <= 0) {
          h.phase = 'seek';
          e.state = 'idle';
          break;
        }
        h.timer += dt;
        const rate = 22; // material per second
        const take = Math.min(rate * dt, HARVESTER_CAPACITY - h.ore, available);
        h.ore += take;
        this.state.map.ore[idx] = Math.max(0, available - take);
        if (h.ore >= HARVESTER_CAPACITY) {
          h.phase = 'toRefinery';
          h.timer = 0;
          this.sendHarvesterToRefinery(e);
        }
        break;
      }
      case 'toRefinery': {
        e.state = 'delivering';
        if (h.refineId) {
          const refinery = this.getEntity(h.refineId);
          if (!refinery || refinery.hp <= 0) {
            h.refineId = 0;
            h.phase = 'seek';
            break;
          }
          if (dist(e.x, e.z, refinery.x, refinery.z) < 8 * TILE_SIZE) {
            h.phase = 'unloading';
            h.timer = 0;
            e.path = [];
            e.state = 'delivering';
          }
        } else {
          h.phase = 'seek';
        }
        break;
      }
      case 'unloading': {
        h.timer += dt;
        if (h.timer >= 1.2) {
          player.mats += h.ore;
          player.stats.matsGathered += h.ore;
          this.emit('income', {
            team: e.owner,
            x: e.x,
            z: e.z,
            text: `+${Math.round(h.ore)} materials`,
            level: 'info',
            sound: 'deposit',
          });
          h.ore = 0;
          h.phase = 'seek';
          h.timer = 0;
          e.state = 'idle';
        }
        break;
      }
    }
  }

  /** A friendly refinery within a right-click's reach. */
  private refineryNear(owner: number, x: number, z: number): Entity | null {
    let best: Entity | null = null;
    let bestDist = Infinity;
    for (const b of this.state.entities) {
      if (b.owner !== owner || b.kind !== 'building' || b.hp <= 0 || b.construction) continue;
      if (!BUILDINGS[b.defId]?.refinery) continue;
      const d = dist(x, z, b.x, b.z);
      if (d <= 6 * TILE_SIZE && d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  private sendHarvesterToRefinery(e: Entity): void {
    const h = e.harvester!;
    let best: Entity | null = null;
    let bestDist = Infinity;
    for (const b of this.state.entities) {
      if (b.owner !== e.owner || b.kind !== 'building' || b.hp <= 0) continue;
      if (!BUILDINGS[b.defId]?.refinery) continue;
      const d = dist(e.x, e.z, b.x, b.z);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    if (!best) {
      h.phase = 'seek';
      return;
    }
    h.refineId = best.id;
    const path = this.findPathFor(e, best.x, best.z);
    if (!path) {
      h.phase = 'seek';
      return;
    }
    h.phase = 'toRefinery';
    e.path = path;
    e.pathIndex = 0;
    e.destX = best.x;
    e.destZ = best.z;
    e.state = 'delivering';
  }

  private findOreForHarvester(e: Entity): boolean {
    const h = e.harvester!;
    const map = this.state.map;
    const candidates: Array<{ i: number; d: number }> = [];
    for (let i = 0; i < map.ore.length; i++) {
      if (map.ore[i] <= 0) continue;
      const x = (i % map.width + 0.5) * TILE_SIZE;
      const z = (((i / map.width) | 0) + 0.5) * TILE_SIZE;
      candidates.push({ i, d: dist2(e.x, e.z, x, z) });
    }
    candidates.sort((a, b) => a.d - b.d || a.i - b.i);
    const limit = Math.min(candidates.length, 14);
    for (let c = 0; c < limit; c++) {
      const i = candidates[c].i;
      const tx = i % map.width;
      const tz = (i / map.width) | 0;
      // A structure standing on the deposit makes it unminable: the tile itself
      // is blocked, so the hull could only ever park beside it and wait.
      if (this.blocked[i]) continue;
      // A seam another hauler is already working is not this one's ground.
      // Driving at it means pushing against a hull that is standing still to
      // mine, and separation hands the mover straight back its own step, so the
      // pair deadlock until one of them is destroyed.
      if (this.depositClaimed(e, tx, tz)) continue;
      const cx = (tx + 0.5) * TILE_SIZE;
      const cz = (tz + 0.5) * TILE_SIZE;
      const path = this.findPathFor(e, cx, cz);
      if (!path) continue;
      // The route has to finish inside mining reach. A goal redirected onto a
      // neighbouring tile would otherwise leave the harvester standing out of
      // range for the rest of the match, which reads as a stuck unit.
      const end = path.length > 0 ? path[path.length - 1] : { x: e.x, z: e.z };
      if (dist(end.x, end.z, cx, cz) >= HARVEST_REACH) continue;
      h.oreTileX = tx;
      h.oreTileZ = tz;
      e.path = path;
      e.pathIndex = 0;
      e.destX = cx;
      e.destZ = cz;
      e.state = 'moving';
      return true;
    }
    return false;
  }

  /** True when a friendly hauler is already standing over this deposit tile. */
  private depositClaimed(e: Entity, tx: number, tz: number): boolean {
    const cx = (tx + 0.5) * TILE_SIZE;
    const cz = (tz + 0.5) * TILE_SIZE;
    for (const other of this.state.entities) {
      if (other === e || other.kind !== 'unit' || other.hp <= 0 || other.garrisonId) continue;
      if (!other.harvester || other.owner !== e.owner) continue;
      if (dist2(other.x, other.z, cx, cz) < HARVEST_REACH * HARVEST_REACH) return true;
    }
    return false;
  }

  private updateOrderTargeting(e: Entity, def: UnitDef, dt: number): void {
    if (e.order?.type === 'attack') {
      const target = this.getEntity(e.order.targetId ?? 0);
      if (!target || target.hp <= 0) {
        e.order = null;
        e.targetId = 0;
        e.aimTargetId = 0;
        e.path = [];
        e.state = 'idle';
        return;
      }
      // Keep the turret laid on the ordered target while closing or firing.
      e.aimTargetId = target.id;
      const weapons = entityWeapons(e);
      let weapon = this.chooseWeapon(e, target, weapons);
      if (!weapon) {
        if (e.maxAmmo > 0 && e.ammo <= 0 && def.domain === 'air') {
          this.orderAircraftReturn(e);
        }
        e.state = 'idle';
        return;
      }
      // Close to the range the crew can really engage at, not the barrel's
      // theoretical reach: in fog or at night standing off at the physical
      // range means never getting a shot away.
      const range = this.engagementReach(e, weapon) + 3;
      const minimum = (weapon.minRange ?? 0) * TILE_SIZE;
      const d = dist(e.x, e.z, target.x, target.z);
      // Smoke between gun and target breaks the lay: the crew closes into the
      // cloud rather than firing blind through it.
      const screened = this.smokeScreens(e.x, e.z, target.x, target.z);
      const spotted =
        !screened && (!weapon.indirect || this.isVisibleTo(this.teamOf(e.owner), target.id));
      // Already driving toward the target on a path of its own: leave it alone.
      // Re-issuing the same path every tick restarts the step it is taking, and
      // a crew closing a one-tile gap would crawl for the rest of the match.
      const closing = e.path.length > 0 && e.state === 'moving';
      if (
        d <= range &&
        d >= minimum &&
        spotted &&
        (def.domain === 'air' || weapon.indirect || hasLineOfSight(this.state.map, e.x, e.z, target.x, target.z))
      ) {
        e.path = [];
        if (def.domain === 'air') {
          // Aircraft orbit their target rather than stopping.
          e.path = [{ x: e.x, z: e.z }];
        }
        e.state = 'attacking';
        this.tryFire(e, target, weapon, weapons);
      } else if (d < minimum) {
        // A howitzer cannot depress its barrel into its own minimum range.
        // Hold position rather than chasing a target it cannot shoot.
        e.path = [];
        e.state = 'idle';
      } else {
        if (def.domain === 'air') {
          if (e.fuel > 0) {
            e.destX = target.x;
            e.destZ = target.z;
            e.path = [{ x: target.x, z: target.z }];
            e.pathIndex = 0;
            e.state = 'moving';
          }
        } else if (
          e.stance !== 'hold' &&
          // Either the crew has been jammed for a few ticks, or it simply cannot
          // reach the target from here. The second case is the one light and
          // weather create: an optical crew that cannot identify at the barrel's
          // physical range must drive into its real engagement range instead of
          // sitting at the edge of it, firing nothing.
          (e.blockedTicks > 4 || (spotted && d > range && !closing))
        ) {
          const path = this.findPathFor(e, target.x, target.z);
          if (path) {
            e.path = path;
            e.pathIndex = 0;
            e.destX = target.x;
            e.destZ = target.z;
            e.state = 'moving';
            e.blockedTicks = 0;
          } else {
            e.blockedTicks = 0;
            e.state = 'idle';
          }
        }
      }
      return;
    }
    if (e.order?.type === 'repair') {
      const target = this.getEntity(e.order.targetId ?? 0);
      if (!target || !this.isRepairableBy(e.owner, target)) {
        e.order = null;
        e.path = [];
        e.state = 'idle';
        return;
      }
      if (dist(e.x, e.z, target.x, target.z) <= ENGINEER_WORK_RANGE) {
        e.path = [];
        e.state = 'repairing';
        // Shelling stops work. The crew keeps the detail but makes no progress
        // until the structure has been quiet for a second; the order is kept so
        // it resumes by itself instead of the commander having to re-issue it.
        // `repairSuppression: false` exists only so the Phase 9 replication can
        // run the pre-Phase-8 behaviour on this exact tree; play never sets it.
        if (
          this.repairSuppression &&
          this.state.tick - target.lastHitTick < REPAIR_SUPPRESSION_TICKS
        ) {
          return;
        }
        const wasCollapsed = target.hp <= 0;
        target.hp = Math.min(
          target.maxHp,
          target.hp + target.maxHp * ENGINEER_REPAIR_RATE * dt,
        );
        if (wasCollapsed && target.hp > 0) {
          // The span carries traffic again the moment the deck is whole enough
          // to drive across: the blocked tiles are released and the navigation
          // layer is rebuilt with the deck over the water.
          const def = buildingDef(target.defId);
          const tx = Math.round(target.x / TILE_SIZE - def.footprint.w / 2);
          const tz = Math.round(target.z / TILE_SIZE - def.footprint.h / 2);
          if (def.walkable) {
            stampFootprint(this.blocked, this.state.map, target.defId, tx, tz, 0);
            this.deckDirty = true;
            this.emit('notice', {
              team: this.localPlayerId,
              x: target.x,
              z: target.z,
              text: 'Bridge re-decked — the crossing is open',
              level: 'info',
            });
          }
        }
        if (target.hp >= target.maxHp) {
          target.hp = target.maxHp;
          e.order = null;
          e.state = 'idle';
        }
      } else {
        e.state = 'moving';
        // Re-approach if separation or terrain cancelled the original path.
        if (e.path.length === 0) this.walkEngineerToSite(e, target);
      }
      return;
    }
    if (e.order?.type === 'capture') {
      const target = this.getEntity(e.order.targetId ?? 0);
      if (!target || target.hp <= 0 || target.owner === e.owner) {
        e.order = null;
        e.captureTargetId = 0;
        e.captureProgress = 0;
        e.state = 'idle';
        return;
      }
      if (dist(e.x, e.z, target.x, target.z) <= 4.5 * TILE_SIZE) {
        e.path = [];
        e.state = 'capturing';
        e.captureProgress += 1 / (TICKS_PER_SECOND * 5);
        if (e.captureProgress >= 1) {
          const previousOwner = target.owner;
          const lostByLocal =
            previousOwner === this.localPlayerId &&
            this.isHostile(e.owner, previousOwner);
          target.owner = e.owner;
          target.aiRole = 'captured';
          // A captured structure is the new owner's, not a half-sold wreck:
          // the previous owner's sale dies with the flag, so nobody is paid.
          delete target.deconstruct;
          e.captureProgress = 0;
          e.captureTargetId = 0;
          e.order = null;
          e.state = 'idle';
          const p = this.player(e.owner);
          if (p) p.stats.kills += 0;
          this.emit('capture', {
            team: e.owner,
            x: target.x,
            z: target.z,
            text: lostByLocal
              ? `${buildingDef(target.defId).name} lost`
              : this.captureText(target.defId),
            entityId: target.id,
            level: lostByLocal ? 'critical' : 'success',
            sound: lostByLocal ? undefined : 'capture',
            code: lostByLocal ? 'siteLost' : undefined,
          });
        }
      } else {
        e.state = 'moving';
      }
      return;
    }
    // Move orders are cleared at arrival by movement; attack-move auto-fires.
  }

  private chooseWeapon(e: Entity, target: Entity, weapons: WeaponDef[]): WeaponDef | null {
    // A dived boat is an ASW problem before it is a missile target. Without
    // this preference an escort spends its anti-ship missiles on an empty
    // patch of sea while its depth charges stay in the rack.
    if (target.kind === 'unit' && target.submarine?.dived) {
      for (const w of weapons) {
        if (!w.asw || !canWeaponTarget(w, target)) continue;
        if (usesPrimaryAmmo(e, w) && e.ammo <= 0) continue;
        return w;
      }
    }
    let fallback: WeaponDef | null = null;
    for (const w of weapons) {
      if (!canWeaponTarget(w, target)) continue;
      if (usesPrimaryAmmo(e, w)) {
        if (e.ammo <= 0) continue;
        return w;
      }
      if (!fallback) fallback = w;
    }
    return fallback;
  }

  /** Best visible hostile this entity's weapons can currently engage. */
  private acquireAutoTarget(
    e: Entity,
    weapons: WeaponDef[],
  ): { target: Entity; weapon: WeaponDef } | null {
    const owner = e.owner;
    if (owner < 0) return null;
    const team = this.teamOf(owner);
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const target of this.state.entities) {
      if (target.hp <= 0) continue;
      if (!this.isAttackable(owner, target)) continue;
      if (!this.isVisibleTo(team, target.id)) continue;
      // Occupants are represented by their shelter; the structure is the
      // engageable target and its envelope resolves occupant casualties.
      if (target.kind === 'unit' && target.garrisonId) continue;
      const d = dist(e.x, e.z, target.x, target.z);
      let usable = false;
      let weaponRange = 0;
      let ignoresCover = false;
      for (const w of weapons) {
        if (!canWeaponTarget(w, target)) continue;
        if (usesPrimaryAmmo(e, w) && e.ammo <= 0) continue;
        if (d < (w.minRange ?? 0) * TILE_SIZE) continue;
        // Indirect fire is aimed at a known location, so its reach is physical;
        // direct fire is limited by what the crew can identify at this light.
        const reach = this.engagementReach(e, w);
        if (d > reach + 4) continue;
        usable = true;
        weaponRange = Math.max(weaponRange, reach / TILE_SIZE);
        if (w.indirect) ignoresCover = true;
      }
      if (!usable) continue;
      if (d > weaponRange * TILE_SIZE + 4) continue;
      const shooterDef = UNITS[e.defId];
      if (
        shooterDef?.domain !== 'air' &&
        !ignoresCover &&
        !hasLineOfSight(this.state.map, e.x, e.z, target.x, target.z)
      ) {
        continue;
      }
      const score = d + (entityTargetClass(target) === 'air' ? -6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = target;
      }
    }
    if (!best) return null;
    const weapon = this.chooseWeapon(e, best, weapons);
    return weapon ? { target: best, weapon } : null;
  }

  /**
   * An emplacement uses an explicit player order until that target dies or
   * becomes invalid, then falls back to the normal automatic acquisition.
   * Unlike a vehicle it cannot chase, so the order is retained while the
   * target sits outside the gun's range and the turret still tracks it.
   */
  private staticEngagementTarget(
    e: Entity,
    weapons: WeaponDef[],
  ): { target: Entity; weapon: WeaponDef } | null {
    if (e.order?.type !== 'attack') return this.acquireAutoTarget(e, weapons);
    const target = this.getEntity(e.order.targetId ?? 0);
    if (!target || target.hp <= 0 || !this.isAttackable(e.owner, target)) {
      e.order = null;
      e.targetId = 0;
      e.aimTargetId = 0;
      return this.acquireAutoTarget(e, weapons);
    }
    const weapon = this.chooseWeapon(e, target, weapons);
    if (!weapon) {
      e.order = null;
      e.targetId = 0;
      e.aimTargetId = 0;
      return this.acquireAutoTarget(e, weapons);
    }
    return { target, weapon };
  }

  /**
   * Traverse a fixed emplacement's turret toward its current target between
   * shots, mirroring the presentation state used by vehicles. Firing is still
   * driven solely by cooldown in updateAutoEngagement.
   */
  private updateStaticTurret(e: Entity, dt: number, rate: number, weapons: WeaponDef[]): void {
    const acquired = this.staticEngagementTarget(e, weapons);
    if (!acquired) {
      e.aimTargetId = 0;
      e.turretFacing = turnToward(e.turretFacing, e.facing, rate * dt);
      return;
    }
    e.aimTargetId = acquired.target.id;
    const desired = angleTo(e.x, e.z, acquired.target.x, acquired.target.z);
    e.turretFacing = turnToward(e.turretFacing, desired, rate * dt);
  }

  private updateAutoEngagement(e: Entity, dt: number, weapons: WeaponDef[]): void {
    void dt;
    if (e.cooldown > 0) return;
    if (e.kind === 'unit' && UNITS[e.defId]?.domain === 'air') {
      // Aircraft only auto-engage when explicitly ordered; prevents suicide runs.
      if (e.order?.type !== 'attack') return;
    }
    const acquired =
      e.kind === 'building'
        ? this.staticEngagementTarget(e, weapons)
        : this.acquireAutoTarget(e, weapons);
    if (!acquired) return;
    const best = acquired.target;
    const w = acquired.weapon;
    if (e.kind === 'unit' && (e.order?.type === 'move' || e.order?.type === 'attackMove')) {
      if (dist(e.x, e.z, best.x, best.z) > this.engagementReach(e, w) + 3) return;
    }
    // Each emplacement's weapon target classes already exclude the domains it
    // cannot engage (SAMs vs ground, ground guns vs air), so a building fires
    // on whatever its definition allows.
    this.tryFire(e, best, w, weapons);
  }

  private tryFire(e: Entity, target: Entity, weapon: WeaponDef, weapons: WeaponDef[]): void {
    if (e.cooldown > 0) return;
    const shooterDef = UNITS[e.defId];
    const d = dist(e.x, e.z, target.x, target.z);
    const dayNight = this.dayNight;
    const profile = sensorFor(e);
    // The gun keeps its physical range; what shrinks at night is how far the
    // crew can identify and hold a target. Indirect fire is exempt: it is aimed
    // at a coordinate a spotter already reported.
    const effectiveRange = this.engagementReach(e, weapon) / TILE_SIZE;
    if (d > effectiveRange * TILE_SIZE + 4) return;
    if (d < (weapon.minRange ?? 0) * TILE_SIZE) return;
    if (weapon.indirect && e.state === 'moving') return;
    // Indirect fire arcs over cover, but the firing team still needs a spotter
    // to know where the target is. Reconnaissance therefore enables artillery
    // instead of being cosmetic.
    if (weapon.indirect && !this.isVisibleTo(this.teamOf(e.owner), target.id)) return;
    if (!weapon.indirect && this.smokeScreens(e.x, e.z, target.x, target.z)) return;
    if (
      !weapon.indirect &&
      e.kind !== 'building' &&
      shooterDef?.domain !== 'air' &&
      !hasLineOfSight(this.state.map, e.x, e.z, target.x, target.z)
    ) {
      return;
    }
    // Identification takes time in the dark. A crew holds a target for a few
    // ticks before the first shot; thermal sights need almost none.
    if (!weapon.indirect) {
      const needed = acquireTicksFor(profile, dayNight);
      if (needed > 0) {
        if (e.acquireTargetId !== target.id) {
          e.acquireTargetId = target.id;
          e.acquireTicks = 0;
        }
        const held = (e.acquireTicks ?? 0) + 1;
        e.acquireTicks = held;
        if (held < needed) return;
      }
    }
    if (usesPrimaryAmmo(e, weapon)) {
      if (e.ammo <= 0) return;
      e.ammo--;
    }
    // A veteran crew works its gun faster; the reload it sets is the only
    // thing veterancy changes about the weapon itself.
    const crew = rankOf(e);
    e.cooldown = weapon.cooldown * crew.cooldown;
    // A submarine launch is a datum: the boat is briefly exposed, which gives
    // the target a chance to answer with sonar, guns or depth charges.
    if (shooterDef?.submarine) this.revealSubmarine(e, shooterDef.submarine.revealSeconds);
    // A shot always leaves the barrel on bearing, even if the turret was still
    // traversing, so the projectile origin and direction cannot disagree.
    e.turretFacing = angleTo(e.x, e.z, target.x, target.z);
    e.aimTargetId = target.id;
    const accuracyPenalty = e.suppression * 0.32;
    const firingDef = UNITS[e.defId];
    const movingPenalty = firingDef?.domain === 'land' && e.state === 'moving' ? 0.12 : 0;
    // Poor optics also cost a little precision, capped so night fighting is
    // degraded, never useless.
    const nightAccuracy = weapon.indirect ? 1 : accuracyFactor(profile, dayNight);
    const hit =
      this.rng.next() <
      clamp(
        weapon.accuracy * nightAccuracy * this.weather.accuracy +
          crew.accuracy -
          accuracyPenalty -
          movingPenalty,
        0.05,
        1,
      );
    // A miss lands inside the weapon's own pattern, stretched by the weather.
    // Indirect fire is exempt from the accuracy penalty above but not from
    // dispersion: a gunners' correction drifts in a gale whatever the sights.
    const spread = hit ? 0 : (1.5 + this.rng.next() * 2.5) * TILE_SIZE * this.weather.dispersion;
    const scatterAngle = this.rng.next() * Math.PI * 2;
    const start = this.muzzlePoint(e);
    const targetHeight = weapon.underwater
      ? 0.18
      : entityTargetClass(target) === 'air'
        ? AIRCRAFT_ALTITUDE
        : this.heightAt(target.x, target.z) + 1.3;
    const lob = weapon.indirect === true;
    const shotDistance = Math.hypot(target.x - start.x, target.z - start.z);
    const projectile: Projectile = {
      id: this.state.nextProjectileId++,
      owner: e.owner,
      shooterId: e.id,
      weaponId: weapon.id,
      x: start.x,
      y: start.y,
      z: start.z,
      tx: target.x + Math.cos(scatterAngle) * spread,
      ty: targetHeight,
      tz: target.z + Math.sin(scatterAngle) * spread,
      // A lobbed shell lands where it was aimed; it does not follow a moving
      // target, so the splash radius is what does the work.
      targetId: hit && !lob ? target.id : 0,
      speed: weapon.speed,
      splash: weapon.splash ?? 0,
      kind: weapon.projectile,
      homing:
        weapon.projectile === 'missile' ||
        weapon.projectile === 'sam' ||
        weapon.projectile === 'torpedo',
      // The crew's edge is baked into the round when it leaves the barrel, so
      // the impact is resolved with the same numbers on every peer.
      damage: weapon.damage * crew.damage,
      armourMul: weapon.multipliers,
      suppression: weapon.suppression,
      seed: this.rng.int(0, 0xffff),
      startX: start.x,
      startY: start.y,
      startZ: start.z,
      lob,
      arc: lob ? Math.min(12, 3.5 + (shotDistance / TILE_SIZE) * 0.3) : undefined,
    };
    this.state.projectiles.push(projectile);
    this.emit('shot', {
      team: e.owner,
      x: start.x,
      y: start.y,
      z: start.z,
      text: '',
      entityId: e.id,
      weaponId: weapon.id,
      sound:
        weapon.projectile === 'sam'
          ? 'sam'
          : weapon.projectile === 'missile' || weapon.projectile === 'torpedo'
            ? 'missile'
            : weapon.projectile === 'shell'
              ? 'cannon'
              : 'rifle',
    });
    void weapons;
  }

  /**
   * World position a shot leaves from: the authored hardpoint rotated by the
   * turret (or hull, for fixed-forward weapons) plus the unit's own position.
   * Buildings keep their existing centre-of-mass origin.
   */
  private muzzlePoint(e: Entity): { x: number; y: number; z: number } {
    const def = UNITS[e.defId];
    if (e.kind === 'building') {
      return { x: e.x, y: this.heightAt(e.x, e.z) + 3.5, z: e.z };
    }
    const offset = def
      ? muzzleWorldOffset(def, e.facing, e.turretFacing)
      : rotateLocalOffset(muzzleReach(undefined), 0, e.turretFacing);
    const y =
      def?.domain === 'air'
        ? AIRCRAFT_ALTITUDE
        : this.heightAt(e.x, e.z) + muzzleHeight(def);
    return { x: e.x + offset.x, y, z: e.z + offset.z };
  }

  /**
   * Turret traverse. Presentation-facing state only: the turret lays on the
   * current aim target while it exists, otherwise it settles back onto the hull
   * heading. It never gates firing, so firing rates are unchanged.
   */
  private updateTurret(e: Entity, def: UnitDef, dt: number): void {
    const target = e.aimTargetId ? this.getEntity(e.aimTargetId) : undefined;
    const valid = !!target && target.hp > 0 && this.isHostile(e.owner, target.owner);
    if (!valid) {
      e.aimTargetId = 0;
    }
    if (!def.turretRate) {
      // Turretless units aim with the whole body. On these units turretFacing
      // is presentation state -- nothing rotates a rifle's muzzle offset with
      // it -- so a squad standing its ground turns to face what it is shooting
      // at while movement, firing maths and the tuned AI matchups stay put.
      // Walking squads keep their weapon heading on the direction of travel.
      if (e.path.length > 0 || e.state === 'moving') {
        e.turretFacing = e.facing;
        return;
      }
      const bearing = valid ? angleTo(e.x, e.z, target!.x, target!.z) : e.facing;
      e.turretFacing = turnToward(e.turretFacing, bearing, def.turnRate * dt);
      return;
    }
    const desired = valid ? angleTo(e.x, e.z, target!.x, target!.z) : e.facing;
    e.turretFacing = turnToward(e.turretFacing, desired, def.turretRate * dt);
  }

  /**
   * A recovery vehicle patches one damaged friendly vehicle at a time while
   * standing still. It never chases a customer: the commander positions it, and
   * moving or taking another order ends the job. Repairs are paid for in
   * materials, so a field repair is cheaper than losing the hull but not free.
   */
  private updateRecovery(e: Entity, def: UnitDef, dt: number, repairable: Entity[]): void {
    const cfg = def.repair;
    if (!cfg) return;
    const busy = !!e.order || e.path.length > 0 || e.state === 'moving';
    if (busy) {
      e.repairTargetId = 0;
      if (e.state === 'repairing') e.state = 'idle';
      return;
    }
    const usable = (t: Entity | undefined): t is Entity => {
      if (!t || t.id === e.id || t.kind !== 'unit' || t.hp <= 0 || t.hp >= t.maxHp) return false;
      if (t.owner !== e.owner) return false;
      const tdef = unitDef(t.defId);
      return (
        tdef.domain === 'land' &&
        tdef.armour !== 'infantry' &&
        dist(e.x, e.z, t.x, t.z) <= cfg.radius * TILE_SIZE
      );
    };
    let target = e.repairTargetId ? this.getEntity(e.repairTargetId) : undefined;
    if (!usable(target)) {
      target = undefined;
      let bestScore = Infinity;
      for (const t of repairable) {
        if (!usable(t)) continue;
        const score = (t.hp / t.maxHp) * 10000 + dist(e.x, e.z, t.x, t.z);
        if (score < bestScore) {
          bestScore = score;
          target = t;
        }
      }
    }
    if (!target) {
      e.repairTargetId = 0;
      if (e.state === 'repairing') e.state = 'idle';
      return;
    }
    const player = this.player(e.owner);
    if (!player) return;
    const wanted = Math.min(cfg.hpPerSec * dt, target.maxHp - target.hp);
    const affordable =
      cfg.materialCostPerHp > 0 ? player.mats / cfg.materialCostPerHp : wanted;
    const amount = Math.min(wanted, affordable);
    if (amount <= 0) {
      e.repairTargetId = 0;
      if (e.state === 'repairing') e.state = 'idle';
      return;
    }
    e.repairTargetId = target.id;
    e.state = 'repairing';
    target.hp = Math.min(target.maxHp, target.hp + amount);
    player.mats = Math.max(0, player.mats - amount * cfg.materialCostPerHp);
  }

  /**
   * A medic treats one wounded friendly infantryman at a time while standing
   * still. It never walks to a patient: the commanding player chooses the
   * position, and moving or taking another order ends treatment immediately.
   */
  private updateMedic(e: Entity, dt: number, wounded: Entity[]): void {
    const busy = !!e.order || e.path.length > 0 || e.state === 'moving';
    if (busy) {
      e.healTargetId = 0;
      if (e.state === 'healing') e.state = 'idle';
      return;
    }
    const usable = (t: Entity | undefined): t is Entity =>
      !!t &&
      t.id !== e.id &&
      t.kind === 'unit' &&
      t.hp > 0 &&
      t.hp < t.maxHp &&
      t.owner === e.owner &&
      unitDef(t.defId).armour === 'infantry' &&
      dist(e.x, e.z, t.x, t.z) <= MEDIC_HEAL_RANGE;
    let target = e.healTargetId ? this.getEntity(e.healTargetId) : undefined;
    if (!usable(target)) {
      target = undefined;
      let bestScore = Infinity;
      for (const t of wounded) {
        if (!usable(t)) continue;
        // Triage the most badly hurt patient first, then the nearest.
        const score = (t.hp / t.maxHp) * 10000 + dist(e.x, e.z, t.x, t.z);
        if (score < bestScore) {
          bestScore = score;
          target = t;
        }
      }
    }
    if (!target) {
      e.healTargetId = 0;
      if (e.state === 'healing') e.state = 'idle';
      return;
    }
    e.healTargetId = target.id;
    e.state = 'healing';
    target.hp = Math.min(target.maxHp, target.hp + MEDIC_HEAL_RATE * dt);
  }

  /* ------------------------------------------------------------------ */
  /* Movement                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * The point a unit should actually stand on for a requested destination.
   *
   * A group gets a grid of formation slots, and on broken ground some of those
   * slots land inside a footprint or on rock. Refusing the order for that used
   * to strand every unit that drew a bad slot — the commander saw "no route"
   * for a move into a tight space that was perfectly possible. Instead the slot
   * walks out to the nearest tile this mover can occupy, up to three tiles, and
   * only a genuinely enclosed aim returns null.
   */
  private moveSlotFor(
    def: UnitDef,
    x: number,
    z: number,
    /**
     * Whether an occupied slot may walk out to the nearest open tile. The
     * command layer allows it, because a commander clicking a tight pocket
     * means "as close as you can get". A planning gate that is asking "is this
     * exact ground open?" (the AI's assault-destination check) does not: a
     * structure's centre is not an open aim merely because the ring beside it
     * is, or an unseen footprint could pull a wave onto itself.
     */
    allowWalkOut = true,
  ): { x: number; z: number } | null {
    if (this.canStandAt(def, x, z)) return { x, z };
    if (!allowWalkOut) return null;
    for (let radius = 1; radius <= 3; radius++) {
      let best: { x: number; z: number } | null = null;
      let bestDist = Infinity;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          // Ring only, so the first radius with any open tile wins outright.
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const px = x + dx * TILE_SIZE;
          const pz = z + dz * TILE_SIZE;
          if (!this.canStandAt(def, px, pz)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestDist) {
            bestDist = d;
            best = { x: px, z: pz };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * Where a mover should stand and the route that gets it there.
   *
   * `moveSlotFor` only answers whether a hull may *stand* on a point. Standable
   * ground can still be unreachable — a lone peak, a pocket behind a cliff, a
   * corner sealed by a footprint — and treating "standable" as "reachable" is
   * what refused a whole group's order for the one unit that drew such a slot
   * ("1 unit cannot reach that location") while the rest drove off. So the aim
   * is walked out to the nearest ground that is both standable *and* routable,
   * cheapest first, before anything is refused.
   */
  private planMove(
    e: Entity,
    def: UnitDef,
    x: number,
    z: number,
    navBatch?: NavBatch,
  ): { x: number; z: number; path: import('./types').PathPoint[] } | null {
    const slot = this.moveSlotFor(def, x, z);
    if (slot) {
      const path = this.findPathFor(e, slot.x, slot.z, navBatch);
      if (path) return { x: slot.x, z: slot.z, path };
    }
    const fallback = this.reachableAimFor(e, def, x, z, navBatch);
    return fallback;
  }

  /**
   * The nearest point around an aim that this mover can both stand on and drive
   * to. Rings outwards from the aim, nearest candidate first within a ring, so
   * the moved stop is as close to what the commander clicked as the ground
   * allows. Deterministic: ties break on distance, then z, then x.
   */
  private reachableAimFor(
    e: Entity,
    def: UnitDef,
    x: number,
    z: number,
    navBatch?: NavBatch,
  ): { x: number; z: number; path: import('./types').PathPoint[] } | null {
    const aimX = x;
    const aimZ = z;
    for (let radius = 1; radius <= REACHABLE_AIM_SEARCH; radius++) {
      const candidates: Array<{ x: number; z: number; d: number }> = [];
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const px = aimX + dx * TILE_SIZE;
          const pz = aimZ + dz * TILE_SIZE;
          if (!this.canStandAt(def, px, pz)) continue;
          candidates.push({ x: px, z: pz, d: dx * dx + dz * dz });
        }
      }
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => a.d - b.d || a.z - b.z || a.x - b.x);
      const probes = Math.min(candidates.length, REACHABLE_AIM_PROBES);
      for (let i = 0; i < probes; i++) {
        const c = candidates[i];
        const path = this.findPathFor(e, c.x, c.z, navBatch);
        if (path) return { x: c.x, z: c.z, path };
      }
    }
    return null;
  }

  /** Whether this mover may stand with its centre on a point. */
  private canStandAt(def: UnitDef, x: number, z: number): boolean {
    const tile = this.tileAt(x, z);
    if (tile === null || this.blocked[tile]) return false;
    return canStandOn(
      this.state.map.width,
      this.state.map.height,
      this.state.map.terrain,
      tile,
      def.moveClass,
    );
  }

  private findPathFor(
    e: Entity,
    tx: number,
    tz: number,
    navBatch?: NavBatch,
  ): import('./types').PathPoint[] | null {
    const def = unitDef(e.defId);
    if (def.domain === 'air') {
      return [{ x: tx, z: tz }];
    }
    const nav = this.navFor(e, navBatch);
    const startX = Math.floor(e.x / TILE_SIZE);
    const startZ = Math.floor(e.z / TILE_SIZE);
    let goalX = worldToTile(tx);
    let goalZ = worldToTile(tz);
    if (!inBounds(this.state.map.width, this.state.map.height, goalX, goalZ)) {
      goalX = clamp(goalX, 0, this.state.map.width - 1);
      goalZ = clamp(goalZ, 0, this.state.map.height - 1);
    }
    const goal = nearestWalkable(nav, goalX, goalZ, 10);
    if (goal === null) return null;
    if (goal === tileIndex(this.state.map.width, startX, startZ)) return [];
    // Path to the tile that was actually resolved, not to the raw aim. The
    // search inside findPath widens its own ring to 8, so an aim beside a large
    // structure — a command post, a research centre — could resolve here at 9
    // or 10 and then be thrown away there, dropping the unit to the fallback
    // ring scan. The resolved tile is walkable, so it resolves to itself.
    const goalTileX = goal % this.state.map.width;
    const goalTileZ = (goal / this.state.map.width) | 0;
    return findPath(nav, startX, startZ, goalTileX, goalTileZ);
  }

  /**
   * One traffic scan for a whole command. Old per-request masks filtered to the
   * requesting unit's domain and excluded hostile units. Domains are kept
   * separate because they are genuinely different masks; air is omitted since
   * aircraft paths never consult traffic. The batch lives only for this call.
   */
  private beginNavBatch(owner: number): NavBatch {
    const width = this.state.map.width;
    const height = this.state.map.height;
    const members: NavBatchMember[] = [];
    for (const other of this.state.entities) {
      if (other.kind !== 'unit' || other.hp <= 0 || other.garrisonId) continue;
      const def = unitDef(other.defId);
      if (def.domain === 'air') continue;
      if (this.isHostile(owner, other.owner)) continue;
      const tx = Math.floor(other.x / TILE_SIZE);
      const tz = Math.floor(other.z / TILE_SIZE);
      if (!inBounds(width, height, tx, tz)) continue;
      // A moving unit is lighter traffic than one holding position, but it is
      // still traffic: a repath should prefer a clear lane over a column that
      // is itself waiting on the unit ahead.
      members.push({
        id: other.id,
        tile: tileIndex(width, tx, tz),
        domain: def.domain,
        moving: other.state === 'moving' || other.path.length > 0,
      });
    }
    return new NavBatch(width, height, members);
  }

  /**
   * Lay every standing bridge deck over the water it spans.
   *
   * The map itself is never rewritten — a deck is a structure, not terrain, and
   * mutating the map would desynchronise every client that projected the same
   * ground. Instead the navigation layer is a copy with the deck tiles already
   * turned into road at bank height, so a route crosses the span while it
   * stands and goes looking for a ford once it is down.
   */
  private rebuildDecks(): void {
    this.deckDirty = false;
    const map = this.state.map;
    let spans = 0;
    for (const e of this.state.entities) {
      if (e.kind !== 'building' || e.hp <= 0) continue;
      if (!BUILDINGS[e.defId]?.walkable) continue;
      spans++;
      break;
    }
    if (spans === 0) {
      this.deckTerrain = null;
      this.deckElevation = null;
      this.deckMask = null;
      return;
    }
    const terrain = new Uint8Array(map.terrain);
    const elevation = new Uint8Array(map.elevation);
    const mask = new Uint8Array(map.terrain.length);
    for (const e of this.state.entities) {
      if (e.kind !== 'building' || e.hp <= 0) continue;
      const def = BUILDINGS[e.defId];
      if (!def?.walkable) continue;
      const tx = Math.round(e.x / TILE_SIZE - def.footprint.w / 2);
      const tz = Math.round(e.z / TILE_SIZE - def.footprint.h / 2);
      // The deck sits at the height of the banks it lands on, so a vehicle
      // drives on and off without a step the movement class has to refuse.
      let level = 0;
      for (let dz = -1; dz <= def.footprint.h; dz++) {
        for (let dx = -1; dx <= def.footprint.w; dx++) {
          const x = tx + dx;
          const z = tz + dz;
          if (!inBounds(map.width, map.height, x, z)) continue;
          const i = tileIndex(map.width, x, z);
          if (map.terrain[i] === Terrain.DeepWater || map.terrain[i] === Terrain.ShallowWater) continue;
          if (elevation[i] > level) level = elevation[i];
        }
      }
      for (let dz = 0; dz < def.footprint.h; dz++) {
        for (let dx = 0; dx < def.footprint.w; dx++) {
          const x = tx + dx;
          const z = tz + dz;
          if (!inBounds(map.width, map.height, x, z)) continue;
          const i = tileIndex(map.width, x, z);
          terrain[i] = Terrain.Road;
          elevation[i] = level;
          mask[i] = 1;
        }
      }
    }
    this.deckTerrain = terrain;
    this.deckElevation = elevation;
    this.deckMask = mask;
  }

  /**
   * World height of a bridge deck under a point, or null when there is none.
   *
   * Presentation only: a deck is a structure over water, so the terrain surface
   * under it is still the sea bed. Anything standing on the span — a vehicle
   * crossing, its dust, a wreck — has to be drawn at deck height instead.
   */
  deckHeightAt(x: number, z: number): number | null {
    if (this.deckDirty) this.rebuildDecks();
    if (!this.deckMask || !this.deckElevation) return null;
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    if (!inBounds(this.state.map.width, this.state.map.height, tx, tz)) return null;
    const i = tileIndex(this.state.map.width, tx, tz);
    if (!this.deckMask[i]) return null;
    return this.deckElevation[i] * ELEVATION_HEIGHT;
  }

  /**
   * Get anybody standing on a span off it when the deck drops.
   *
   * Without this the units would be left on the water tiles the bridge covered:
   * visually wrong, and unpathable until the span was rebuilt. The search is a
   * deterministic ring walk, so the same collapse evicts the same unit to the
   * same bank on every peer.
   */
  private clearDeck(
    bridge: Entity,
    w: number,
    h: number,
    tx: number,
    tz: number,
  ): void {
    const map = this.state.map;
    const occupied = (x: number, z: number): boolean => x >= tx && x < tx + w && z >= tz && z < tz + h;
    for (const e of this.state.entities) {
      if (e.kind !== 'unit' || e.hp <= 0) continue;
      const ux = Math.floor(e.x / TILE_SIZE);
      const uz = Math.floor(e.z / TILE_SIZE);
      if (!occupied(ux, uz)) continue;
      let placed = false;
      for (let radius = 1; radius <= 8 && !placed; radius++) {
        for (let dz = -radius; dz <= radius && !placed; dz++) {
          for (let dx = -radius; dx <= radius && !placed; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
            const x = ux + dx;
            const z = uz + dz;
            if (!inBounds(map.width, map.height, x, z)) continue;
            const i = tileIndex(map.width, x, z);
            const t = map.terrain[i] as TerrainId;
            if (t === Terrain.DeepWater || t === Terrain.ShallowWater) continue;
            if (this.blocked[i]) continue;
            if (occupied(x, z)) continue;
            e.x = (x + 0.5) * TILE_SIZE;
            e.z = (z + 0.5) * TILE_SIZE;
            e.path = [];
            e.pathIndex = 0;
            e.destX = e.x;
            e.destZ = e.z;
            if (e.order?.type === 'move' || e.order?.type === 'attackMove') e.order = null;
            e.state = 'idle';
            placed = true;
          }
        }
      }
    }
    this.emit('notice', {
      team: this.localPlayerId,
      x: bridge.x,
      z: bridge.z,
      text: 'Bridge span down — the crossing is closed',
      level: 'warning',
      sound: 'alert',
    });
  }

  private navFor(e: Entity, batch?: NavBatch): NavGrid {
    const def = unitDef(e.defId);
    if (this.deckDirty) this.rebuildDecks();
    const nav: NavGrid = {
      width: this.state.map.width,
      height: this.state.map.height,
      terrain: this.deckTerrain ?? this.state.map.terrain,
      elevation: this.deckElevation ?? this.state.map.elevation,
      overlay: this.state.map.overlay,
      moveClass: def.moveClass,
      occupied: this.blocked,
    };
    if (def.domain !== 'air') {
      const batchSoft = batch?.softFor(def.domain);
      if (batchSoft) {
        nav.soft = batchSoft;
      } else {
        // Idle friendly units are soft traffic: a fresh route steps around a
        // formation instead of walking into the back of it, while a corridor
        // still remains passable when there is no alternative.
        const soft = new Uint8Array(this.state.map.width * this.state.map.height);
        for (const other of this.state.entities) {
          if (other === e || other.kind !== 'unit' || other.hp <= 0 || other.garrisonId) continue;
          if (unitDef(other.defId).domain !== def.domain) continue;
          if (this.isHostile(e.owner, other.owner)) continue;
          const moving = other.state === 'moving' || other.path.length > 0;
          const tx = Math.floor(other.x / TILE_SIZE);
          const tz = Math.floor(other.z / TILE_SIZE);
          if (!inBounds(this.state.map.width, this.state.map.height, tx, tz)) continue;
          soft[tileIndex(this.state.map.width, tx, tz)] = moving ? 2 : 1;
        }
        nav.soft = soft;
      }
    }
    return nav;
  }

  private moveAlongPath(e: Entity, def: UnitDef, dt: number): void {
    if (e.order?.type === 'return' && def.domain === 'air') {
      // handled by aircraft update / path
    }
    if (e.path.length === 0) {
      if (e.state === 'moving') this.arrive(e);
      return;
    }
    if (e.pathIndex >= e.path.length) {
      this.arrive(e);
      return;
    }
    const target = e.path[e.pathIndex];
    const dx = target.x - e.x;
    const dz = target.z - e.z;
    const d = Math.hypot(dx, dz);
    // A garrison route ends at a doorway, so the last step has to be walked
    // rather than declared done from a couple of metres out.
    const lastStep = e.pathIndex === e.path.length - 1;
    const arrivalRadius = lastStep
      ? e.order?.type === 'garrison'
        ? Math.max(0.9, def.radius * 0.25)
        : Math.max(2.5, def.radius * 0.4)
      : 1.2;
    // A traveller pushed off its line (traffic, a nudge, a shoulder step) can
    // end up abeam of its next waypoint. Turning back to touch it costs a
    // U-turn and re-enters the traffic it just avoided, so a waypoint counts as
    // reached once it is behind the unit along the route—except the last one,
    // where the destination itself is what has to be reached.
    let passed = false;
    if (!lastStep) {
      // The route direction comes from the neighbours, because the first
      // waypoint has no previous point and the last has no next one.
      const prev = e.pathIndex > 0 ? e.path[e.pathIndex - 1] : null;
      const next = e.path[e.pathIndex + 1] ?? null;
      const routeX = (next ?? target).x - (prev ?? target).x;
      const routeZ = (next ?? target).z - (prev ?? target).z;
      const routeLen = Math.hypot(routeX, routeZ);
      if (routeLen > 0.001) {
        passed = ((e.x - target.x) * routeX + (e.z - target.z) * routeZ) / routeLen > 0;
      }
    }
    if (d <= arrivalRadius || passed) {
      e.pathIndex++;
      if (e.pathIndex >= e.path.length) {
        if (def.domain === 'air' && e.order?.type === 'return') {
          // Aircraft landing handled in updateAircraft; keep near base.
          this.arrive(e);
        } else {
          this.arrive(e);
        }
      }
      return;
    }
    const desired = Math.atan2(dz, dx);
    // Avoidance is a heading change, not a sideways teleport: the hull turns
    // onto the open lane and then drives along its own nose.
    const steer = this.steerAroundUnits(e, def, desired);
    const turn = def.turnRate * dt;
    e.facing = turnToward(e.facing, steer, turn);
    const diff = Math.abs(normalizeAngle(steer - e.facing));
    let turnFactor = 0.2 + 0.8 * Math.max(0, Math.cos(diff));
    if (diff > 1.3) turnFactor = 0.16;
    if (def.domain === 'naval') turnFactor = 0.12 + 0.88 * Math.max(0, Math.cos(diff));
    const terrain = this.tileAt(e.x, e.z);
    let terrainFactor = 1;
    if (terrain !== null) {
      const t = this.state.map.terrain[terrain] as TerrainId;
      if (def.moveClass !== 'air') {
        const cost = TERRAIN[t].costs[def.moveClass];
        if (Number.isFinite(cost) && cost > 0) terrainFactor = 1 / cost;
      }
    }
    const suppressionFactor = 1 - e.suppression * 0.2;
    const diveFactor = e.submarine?.dived ? def.submarine?.diveSpeed ?? 1 : 1;
    const speed =
      def.speed *
      TILE_SIZE *
      Math.max(0.08, turnFactor) *
      terrainFactor *
      suppressionFactor *
      diveFactor *
      weatherSpeedFactor(def.domain, this.weather);
    // Ground and naval movers travel where the hull points. A vehicle waiting
    // for its turn therefore pivots instead of sliding sideways, and a track
    // that has not come round yet covers less ground.
    const heading = def.domain === 'air' ? desired : e.facing;
    const alignment = def.domain === 'air' ? 1 : Math.max(0, Math.cos(diff));
    const step = Math.min(d, speed * dt * alignment);
    let nx = e.x + Math.cos(heading) * step;
    let nz = e.z + Math.sin(heading) * step;
    // A friendly hull parked in the lane makes way. Separation alone only ever
    // pushed the mover back, and a mover that never advances never reaches the
    // blocked-tick threshold that re-routes it, so it stood there for good.
    const traffic = this.trafficInTheWay(e, def, nx, nz);
    if (traffic) this.makeWay(traffic, e);
    if (this.canOccupy(e, nx, nz)) {
      e.x = nx;
      e.z = nz;
      e.blockedTicks = 0;
    } else if (this.canOccupy(e, nx, e.z)) {
      // Slip along a wall instead of stopping dead against it: a step on one
      // axis alone clears the corners the smoothed path cuts across. It is a
      // last-resort correction, not a driving lane.
      e.x = nx;
      e.blockedTicks = 0;
    } else if (this.canOccupy(e, e.x, nz)) {
      e.z = nz;
      e.blockedTicks = 0;
    } else {
      // Nothing can be driven: the bow is against something. If a friendly hull
      // is the thing in the way, it gives way — including here, where the step
      // that failed was into a wall and the traffic test around that point saw
      // nothing. A defile closed by a parked vehicle is exactly this case.
      const ahead = this.trafficAhead(e, def);
      if (ahead && this.makeWay(ahead, e)) {
        e.blockedTicks = 0;
        return;
      }
      // A stopped neighbour can pin a column while the route ahead is clear.
      // Step onto the open shoulder before giving up and re-planning.
      if (e.blockedTicks > 2) {
        const nudge = Math.max(step * 1.35, 1.0);
        // Try a full shoulder step first, then the diagonal. A unit pinned
        // directly ahead is usually too close for a 45-degree step to clear
        // its footprint, which is what made a follower look stuck.
        for (const angle of [
          e.facing + Math.PI * 0.5,
          e.facing - Math.PI * 0.5,
          e.facing + Math.PI * 0.25,
          e.facing - Math.PI * 0.25,
        ]) {
          const sx = e.x + Math.cos(angle) * nudge;
          const sz = e.z + Math.sin(angle) * nudge;
          if (this.canOccupy(e, sx, sz) && this.unitClearAt(e, sx, sz)) {
            e.x = sx;
            e.z = sz;
            e.blockedTicks = 0;
            return;
          }
        }
      }
      // Something is in the way for good: a new structure across the route, a
      // walled pocket the aim sat behind, a column that closed up. Re-plan to
      // the nearest ground this hull can actually reach before declaring the
      // order impossible, and give it far more than a few ticks to work out.
      if (e.blockedTicks > 8) {
        const plan = this.planMove(e, def, e.destX, e.destZ);
        if (plan && plan.path.length > 0) {
          e.path = plan.path;
          e.pathIndex = 0;
          e.destX = plan.x;
          e.destZ = plan.z;
          if (e.order?.type === 'move' || e.order?.type === 'attackMove') {
            e.order = { ...e.order, x: plan.x, z: plan.z };
          }
          e.blockedTicks = 0;
        } else if (e.blockedTicks < STUCK_GIVE_UP_TICKS) {
          // Keep trying: the nudge pass and traffic yielding below still have
          // a chance to open the lane before this becomes a refusal.
        } else if (e.order?.type === 'garrison') {
          // The garrison handler owns this failure: it keeps trying doors for a
          // while, then reports the shelter it could not reach.
          e.path = [];
          e.pathIndex = 0;
        } else {
          this.emit('orderFailed', {
            team: e.owner,
            x: e.x,
            z: e.z,
            text: `${entityName(e)} cannot reach its destination.`,
            level: 'warning',
            entityId: e.id,
            sound: 'denied',
          });
          e.order = null;
          e.path = [];
          e.state = 'idle';
          e.blockedTicks = 0;
        }
      }
    }
  }

  /**
   * Local avoidance for ground movers. A unit in the lane is treated as a
   * point to pass rather than a direction to swerve: the mover aims at a flank
   * of the obstacle, just ahead of it, and holds that aim until it is properly
   * past. A momentary heading bias used to saw back and forth behind a slower
   * friendly, so a fast scout could ride a hauler's bumper indefinitely.
   * Purely geometric and tie-broken by entity id, so replays stay bit-identical.
   */
  private steerAroundUnits(e: Entity, def: UnitDef, desired: number): number {
    if (def.domain === 'air') return desired;
    const fx = Math.cos(desired);
    const fz = Math.sin(desired);
    let bestLateral = 0;
    let bestLane = 1;
    let bestAhead = Infinity;
    let bestOther: Entity | null = null;
    let bestOd: UnitDef | null = null;
    let bestHeadOn = false;
    let bestMoving = false;
    for (const other of this.state.entities) {
      if (other === e || other.kind !== 'unit' || other.hp <= 0 || other.garrisonId) continue;
      const od = unitDef(other.defId);
      if (od.domain !== def.domain) continue;
      // Hostiles are targets, not traffic: swerving around them would break off
      // every engagement.
      if (this.isHostile(e.owner, other.owner)) continue;
      const otherMoving = other.state === 'moving' || other.path.length > 0;
      const headOn = otherMoving && Math.cos(normalizeAngle(other.facing - desired)) < -0.2;
      const dx = other.x - e.x;
      const dz = other.z - e.z;
      if (otherMoving) {
        const otherSpeed = unitDef(other.defId).speed;
        // Give a same-speed or faster column room, but only once there is room
        // to leave: a follower right up against the leader's tail has to steer
        // out, not keep pushing into it. Without the gap test an infantry
        // column walked through itself, and without the overtake a fast scout
        // could ride the back bumper of a hauler indefinitely.
        const gap = dx * fx + dz * fz;
        if (!headOn && otherSpeed >= def.speed && gap > (def.radius + od.radius) * 1.4) continue;
      }
      // Only the last couple of metres of the lane: this is about not walking
      // into someone standing still, not about re-planning the route.
      const reach = (def.radius + od.radius) * 3.6;
      const ahead = dx * fx + dz * fz;
      // Keep steering until the obstacle is properly behind the nose:
      // dropping it the instant its centre fell behind the mover let a passing
      // vehicle cut back in and clip the unit it was overtaking.
      const behind = headOn ? 0 : formationRadius(def) + formationRadius(od) * 0.5;
      if (ahead <= -behind || ahead > reach) continue;
      const lateral = -dx * fz + dz * fx;
      const lane = (def.radius + od.radius) * 1.3;
      // Abreast of an obstacle, accept a wider corridor: the passing line is
      // deliberately outside the lane, and re-grabbing the obstacle from there
      // is what produced the oscillation.
      if (Math.abs(lateral) >= (ahead > 0 ? lane : lane * 2)) continue;
      if (ahead < bestAhead) {
        bestAhead = ahead;
        bestLateral = lateral;
        bestLane = lane;
        bestOther = other;
        bestOd = od;
        bestHeadOn = headOn;
        bestMoving = otherMoving;
      }
    }
    if (bestOther === null || bestOd === null) return desired;
    // Steer to the roomier side, and harder the more squarely the obstacle sits
    // in the lane.
    if (bestHeadOn) {
      const side = bestLateral === 0 ? (e.id % 2 === 0 ? 1 : -1) : bestLateral > 0 ? -1 : 1;
      const centrality = 1 - Math.min(1, Math.abs(bestLateral) / bestLane);
      return desired + side * (0.4 + 0.7 * centrality);
    }
    // Overtake: work in the lane's frame, not ours. A moving obstacle carries
    // the reference axis, so the chosen side cannot flip mid-manoeuvre (the
    // mover's bearing to its waypoint swings while it changes lane, which used
    // to send it across the bow of the unit it was passing). A parked obstacle
    // has no useful heading of its own, so the lane is our direction of travel.
    const ax = bestMoving ? Math.cos(bestOther.facing) : fx;
    const az = bestMoving ? Math.sin(bestOther.facing) : fz;
    const beside = -(e.x - bestOther.x) * az + (e.z - bestOther.z) * ax;
    let side = Math.abs(beside) < 0.4 ? (e.id % 2 === 0 ? 1 : -1) : beside > 0 ? 1 : -1;
    const clearance = (bestOd.radius + def.radius) * 1.3;
    const flankX = bestOther.x - az * side * clearance;
    const flankZ = bestOther.z + ax * side * clearance;
    if (!this.canOccupy(e, flankX, flankZ)) {
      // That shoulder is a wall: try the other one before giving up on passing.
      side = -side;
    }
    // Aim along the lane, angled by exactly what is needed to reach the flank
    // line before the obstacle. Aiming at a fixed point beside or beyond the
    // obstacle made the approach too shallow from a distance, so the mover
    // arrived before it had shifted a hull's width and then pushed into it.
    const laneAngle = Math.atan2(az, ax);
    if (bestAhead <= 0) return laneAngle;
    const error = Math.abs(beside) >= clearance ? 0 : side * clearance - beside;
    const angle = Math.atan2(error, Math.max(bestAhead, 2));
    return laneAngle + Math.max(-0.9, Math.min(0.9, angle));
  }

  private arrive(e: Entity): void {
    e.path = [];
    e.pathIndex = 0;
    e.destX = e.x;
    e.destZ = e.z;
    e.guardX = e.x;
    e.guardZ = e.z;
    e.blockedTicks = 0;
    const order = e.order;
    if (order?.type === 'move' || order?.type === 'attackMove') {
      e.order = null;
      e.state = 'idle';
      return;
    }
    if (order?.type === 'patrol' && order.x !== undefined && order.z !== undefined) {
      const px = order.x;
      const pz = order.z;
      const otherX = e.patrolX ?? order.x2 ?? e.x;
      const otherZ = e.patrolZ ?? order.z2 ?? e.z;
      e.order = { type: 'patrol', x: otherX, z: otherZ };
      e.patrolX = px;
      e.patrolZ = pz;
      const path = this.findPathFor(e, otherX, otherZ);
      e.path = path ?? [];
      e.pathIndex = 0;
      e.destX = otherX;
      e.destZ = otherZ;
      return;
    }
    if (order?.type === 'return') {
      e.state = 'idle';
      return;
    }
    if (
      order?.type === 'capture' ||
      order?.type === 'attack' ||
      order?.type === 'repair' ||
      order?.type === 'garrison'
    ) {
      return;
    }
    e.state = 'idle';
  }

  /**
   * A friendly unit standing where the mover is about to drive. A parked unit
   * clears the lane whenever it is asked; a unit with an order only yields when
   * it is wedged itself and this mover has the lower id. That tie-break is what
   * stops two columns pushing nose to nose for the rest of the battle: exactly
   * one of any pair steps aside, and the choice is stable across replays.
   */
  private trafficInTheWay(e: Entity, def: UnitDef, x: number, z: number): Entity | null {
    if (def.domain === 'air') return null;
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const other of this.state.entities) {
      if (other === e || other.kind !== 'unit' || other.hp <= 0 || other.garrisonId) continue;
      const od = unitDef(other.defId);
      if (od.domain !== def.domain) continue;
      if (this.isHostile(e.owner, other.owner)) continue;
      if (!this.willGiveWay(other)) continue;
      // Only what is actually in front of the hull. A unit sitting behind it
      // used to count merely because it was near the next step, which shoved
      // parked squads out of the way of a vehicle driving off in the opposite
      // direction.
      const fx = Math.cos(e.facing);
      const fz = Math.sin(e.facing);
      if ((other.x - e.x) * fx + (other.z - e.z) * fz <= 0) continue;
      const min = (formationRadius(def) + formationRadius(od)) * 0.9;
      const d = dist2(x, z, other.x, other.z);
      if (d >= min * min || d >= bestD) continue;
      best = other;
      bestD = d;
    }
    return best;
  }

  /**
   * Friendly traffic directly in front of a mover that has failed to advance.
   * Used only when the step itself is impossible, so the probe is a bow-length
   * ahead of the hull rather than at the blocked next position.
   */
  private trafficAhead(e: Entity, def: UnitDef): Entity | null {
    if (def.domain === 'air') return null;
    const fx = Math.cos(e.facing);
    const fz = Math.sin(e.facing);
    let best: Entity | null = null;
    let bestAhead = Infinity;
    for (const other of this.state.entities) {
      if (other === e || other.kind !== 'unit' || other.hp <= 0 || other.garrisonId) continue;
      const od = unitDef(other.defId);
      if (od.domain !== def.domain) continue;
      if (this.isHostile(e.owner, other.owner)) continue;
      if (!this.willGiveWay(other)) continue;
      const dx = other.x - e.x;
      const dz = other.z - e.z;
      const ahead = dx * fx + dz * fz;
      const lateral = Math.abs(-dx * fz + dz * fx);
      const reach = (formationRadius(def) + formationRadius(od)) * 1.35;
      if (ahead <= 0 || ahead > reach) continue;
      if (lateral > (formationRadius(def) + formationRadius(od)) * 0.75) continue;
      if (ahead < bestAhead) {
        bestAhead = ahead;
        best = other;
      }
    }
    return best;
  }

  /**
   * Whether `blocker` should step out of `mover`'s lane.
   *
   * Parked units always make way, unless they were told to hold their ground. A
   * unit that is under orders but has been failing to advance for a moment is
   * traffic too — that is the head-on standoff in a corridor, where both hulls
   * wait for the other and neither ever moves. The higher id yields so the pair
   * cannot both step and shuffle forever.
   */
  private willGiveWay(blocker: Entity): boolean {
    if (blocker.stance === 'hold') return false;
    return this.isIdleTraffic(blocker);
  }

  /** Whether this unit is under an order that requires it to change ground. */
  private wantsToTravel(e: Entity): boolean {
    if (e.path.length > 0 || e.state === 'moving') return true;
    switch (e.order?.type) {
      case 'move':
      case 'attackMove':
      case 'attack':
      case 'capture':
      case 'garrison':
      case 'repair':
        return true;
      default:
        break;
    }
    if (e.harvester) return e.harvester.phase === 'toOre' || e.harvester.phase === 'toRefinery';
    return false;
  }

  /** No order, no target and no hold stance: the unit is parked, not defending. */
  private isIdleTraffic(e: Entity): boolean {
    if (e.state !== 'idle') return false;
    if (e.path.length > 0) return false;
    if (e.order) return false;
    if (e.targetId || e.aimTargetId) return false;
    return e.stance !== 'hold';
  }

  /**
   * Step a parked unit out of the lane, perpendicular to the mover's heading.
   * One shoulder at a time: the mover creeps up, the blocker clears a hull's
   * width, and the lane opens within a tick or two. Pure geometry, so it stays
   * deterministic, and the blocker keeps its guard point: it stepped aside, it
   * was not ordered.
   */
  private makeWay(blocker: Entity, mover: Entity): boolean {
    const bDef = unitDef(blocker.defId);
    const mDef = unitDef(mover.defId);
    const aside = (formationRadius(bDef) + formationRadius(mDef)) * 0.95;
    for (const sign of [1, -1]) {
      const angle = mover.facing + Math.PI * 0.5 * sign;
      const bx = blocker.x + Math.cos(angle) * aside;
      const bz = blocker.z + Math.sin(angle) * aside;
      if (!this.canOccupy(blocker, bx, bz)) continue;
      if (!this.unitClearAt(blocker, bx, bz)) continue;
      return this.sidestep(blocker, bx, bz);
    }
    // No shoulder at all: a defile, a bridge, a gate between two structures.
    // A parked unit still gives way by stepping along the lane, so the column
    // shuffles forward instead of the vehicle grinding to a halt behind it for
    // the rest of the battle. Only a unit at rest is moved like this: one that
    // is under orders is driving its own route and not a queue to be pushed.
    if (!this.isIdleTraffic(blocker)) return false;
    // Away from the mover, not along its nose: a hull jammed in a defile has
    // been steering into the walls, so its facing points at rock rather than at
    // the only lane that exists.
    const away = Math.atan2(blocker.z - mover.z, blocker.x - mover.x);
    for (const sign of [0, 1]) {
      const angle = away + Math.PI * sign;
      const bx = blocker.x + Math.cos(angle) * aside;
      const bz = blocker.z + Math.sin(angle) * aside;
      if (!this.canOccupy(blocker, bx, bz)) continue;
      if (!this.unitClearAt(blocker, bx, bz)) continue;
      return this.sidestep(blocker, bx, bz);
    }
    return false;
  }

  /**
   * Send a unit that is giving way to its clearing position under its own
   * power. Giving way used to write the new coordinates straight into the
   * entity, so a hull snapped a full body-width sideways between two frames;
   * a one-point route makes it drive and turn there instead, at its own speed.
   * The unit is not under orders afterwards: it stepped aside, it was not told
   * to go anywhere, so its guard point is untouched and it simply stops there.
   */
  private sidestep(blocker: Entity, x: number, z: number): boolean {
    // Only a unit at rest is ever redirected: taking a unit under orders off its
    // route to clear a lane would silently cancel what the commander told it to
    // do, which is worse than the queue it was standing in.
    if (blocker.order || blocker.targetId || blocker.aimTargetId) return false;
    if (blocker.state === 'moving' && blocker.path.length > 0) {
      // Already walking out of the way; do not re-aim it every tick.
      return true;
    }
    blocker.order = null;
    blocker.path = [{ x, z }];
    blocker.pathIndex = 0;
    blocker.destX = x;
    blocker.destZ = z;
    blocker.state = 'moving';
    blocker.blockedTicks = 0;
    return true;
  }

  /** Whether a step would put `e` inside another ground unit's footprint. */
  private unitClearAt(e: Entity, x: number, z: number): boolean {
    const def = unitDef(e.defId);
    for (const other of this.state.entities) {
      if (other === e || other.kind !== 'unit' || other.hp <= 0 || other.garrisonId) continue;
      if (unitDef(other.defId).domain !== def.domain) continue;
      const min = (formationRadius(def) + formationRadius(unitDef(other.defId))) * 0.7;
      if (dist2(x, z, other.x, other.z) < min * min) return false;
    }
    return true;
  }

  private canOccupy(e: Entity, x: number, z: number): boolean {
    if (x < TILE_SIZE * 0.5 || z < TILE_SIZE * 0.5) return false;
    if (x > (this.state.map.width - 0.5) * TILE_SIZE || z > (this.state.map.height - 0.5) * TILE_SIZE) {
      return false;
    }
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    if (!inBounds(this.state.map.width, this.state.map.height, tx, tz)) return false;
    const def = unitDef(e.defId);
    // Aircraft fly over structures, coastlines and elevation; only map bounds apply.
    if (def.moveClass === 'air') return true;
    const idx = tileIndex(this.state.map.width, tx, tz);
    // A hull already standing on ground it should not be on — shoved into a
    // foundation by separation, spawned before the building was raised, restored
    // mid-collision — has to be allowed to drive out. Without this the first
    // step is refused, the shoulder nudges are refused too, and it stands there
    // for the rest of the battle while its route keeps looking perfectly valid.
    // Only a mover that is already in the wall gets this dispensation; everyone
    // else is held out of it exactly as before.
    const curTx = Math.floor(e.x / TILE_SIZE);
    const curTz = Math.floor(e.z / TILE_SIZE);
    const curIdx = tileIndex(this.state.map.width, curTx, curTz);
    const trapped = this.blocked[curIdx] === 1;
    if (this.blocked[idx] && !trapped) return false;
    if (this.deckDirty) this.rebuildDecks();
    // Routing and movement must agree about a bridge deck: the route is planned
    // on the decked ground (see `navFor`), so the per-step check is too, or a
    // column would plan a crossing it then refuses to drive over.
    const cost = moveCost(
      this.state.map.width,
      this.state.map.height,
      this.deckTerrain ?? this.state.map.terrain,
      this.deckElevation ?? this.state.map.elevation,
      tx,
      tz,
      curTx,
      curTz,
      def.moveClass,
    );
    return Number.isFinite(cost) || trapped;
  }

  private separateUnits(): void {
    const units = this.state.entities.filter((e) => e.kind === 'unit' && e.hp > 0 && !e.garrisonId);
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      const da = unitDef(a.defId);
      if (da.domain === 'air') continue;
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j];
        const db = unitDef(b.defId);
        if (db.domain === 'air') continue;
        if (da.domain !== db.domain) continue;
        const minDist = (formationRadius(da) + formationRadius(db)) * 0.78;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minDist * minDist || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        // A unit holding position is never shoved aside, by a friend or by the
        // enemy. The mover yields, or stops short when it has no room, so an
        // idle defender stays where the commander put it.
        const aMoving = a.state === 'moving' || a.path.length > 0;
        const bMoving = b.state === 'moving' || b.path.length > 0;
        const aShare = aMoving === bMoving ? 0.5 : aMoving ? 1 : 0;
        const push = Math.min(0.35, (minDist - d) / d);
        if (aShare > 0) {
          const ax = a.x - dx * push * aShare;
          const az = a.z - dz * push * aShare;
          if (this.canOccupy(a, ax, az)) {
            a.x = ax;
            a.z = az;
          }
        }
        if (aShare < 1) {
          const bx = b.x + dx * push * (1 - aShare);
          const bz = b.z + dz * push * (1 - aShare);
          if (this.canOccupy(b, bx, bz)) {
            b.x = bx;
            b.z = bz;
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Projectiles and damage                                             */
  /* ------------------------------------------------------------------ */

  private updateProjectiles(dt: number): void {
    if (this.state.projectiles.length === 0) return;
    const remaining: Projectile[] = [];
    for (const p of this.state.projectiles) {
      // Strategic munitions can be engaged before they reach the aim point.
      // Ordinary fire is untouched: this is the counterplay layer, not a new
      // universal interception rule.
      if (p.strategic && this.interceptStrategicProjectile(p)) continue;
      const target = p.homing && p.targetId ? this.getEntity(p.targetId) : undefined;
      if (target && target.hp > 0) {
        p.tx = target.x;
        p.tz = target.z;
        p.ty =
          p.kind === 'torpedo'
            ? 0.18
            : entityTargetClass(target) === 'air'
              ? AIRCRAFT_ALTITUDE
              : this.heightAt(target.x, target.z) + 1.3;
      }
      if (
        p.lob &&
        p.startX !== undefined &&
        p.startY !== undefined &&
        p.startZ !== undefined
      ) {
        // Presentation and collision both read this height. The horizontal
        // path stays deterministic; only the vertical arc is added.
        const total = Math.hypot(p.tx - p.startX, p.tz - p.startZ);
        const remaining = Math.hypot(p.tx - p.x, p.tz - p.z);
        const t = total > 0 ? Math.max(0, Math.min(1, 1 - remaining / total)) : 1;
        p.y = p.startY + (p.ty - p.startY) * t + Math.sin(Math.PI * t) * (p.arc ?? 0);
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dz = p.tz - p.z;
      const d = Math.hypot(dx, dy, dz);
      const step = p.speed * TILE_SIZE * dt;
      if (d <= Math.max(step, 1.4)) {
        p.x = p.tx;
        p.y = p.ty;
        p.z = p.tz;
        this.impact(p);
        continue;
      }
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      p.z += (dz / d) * step;
      remaining.push(p);
    }
    this.state.projectiles = remaining;
  }

  /**
   * Try to stop one strategic munition with a defensive field or local air
   * defence. Returns true when the round is destroyed before impact.
   *
   * The field is checked first because it is the dedicated counter, then the
   * nearest eligible air-defence weapon. Each defender has its own reload, so a
   * layered net stops more of a salvo than a single battery, and a saturation
   * attack can still overwhelm it.
   */
  private interceptStrategicProjectile(p: Projectile): boolean {
    const tick = this.state.tick;
    const second = Math.floor(tick / TICK_RATE);
    for (const q of this.state.players) {
      if (q.defeated || !this.isHostile(p.owner, q.id)) continue;
      const field = q.superweapon.defence;
      if (!field || tick >= field.untilTick) continue;
      if (dist(p.x, p.z, field.x, field.z) > field.radiusTiles * TILE_SIZE) continue;
      if (field.secondMark !== second) {
        field.secondMark = second;
        field.spentThisSecond = 0;
      }
      const effect = SUPERWEAPON_FAMILIES.dew.effect;
      const capacity = effect.kind === 'dew' ? effect.capacityPerSecond : 0;
      if (field.spentThisSecond >= capacity) continue;
      field.spentThisSecond++;
      this.emit('notice', {
        team: q.id,
        x: p.x,
        y: p.y,
        z: p.z,
        text: 'Directed-energy defence burnt down an incoming strategic munition.',
        code: 'superweaponIntercept',
        level: 'success',
        sound: 'impact',
      });
      return true;
    }
    for (const e of this.state.entities) {
      if (e.hp <= 0 || e.construction || !this.isHostile(p.owner, e.owner)) continue;
      if ((e.cooldowns?.intercept ?? 0) > 0) continue;
      const weapon = entityWeapons(e).find((w) => w.antiAir);
      if (!weapon) continue;
      if (dist(e.x, e.z, p.x, p.z) > this.engagementReach(e, weapon) + 1.5 * TILE_SIZE) continue;
      e.cooldowns = { ...(e.cooldowns ?? {}), intercept: 1.6 };
      this.emit('notice', {
        team: e.owner,
        x: p.x,
        y: p.y,
        z: p.z,
        text: `${entityName(e)} intercepted an incoming strategic munition.`,
        code: 'superweaponIntercept',
        level: 'success',
        sound: 'impact',
      });
      return true;
    }
    return false;
  }

  private impact(p: Projectile): void {
    const weapon = WEAPONS[p.weaponId];
    if (!weapon && !p.strategic) return;
    const targets = weapon?.targets ?? ['ground', 'structure', 'naval'];
    const multipliers = weapon?.multipliers ?? {};
    const radius = Math.max(1.4, (p.splash > 0 ? p.splash * TILE_SIZE : 1.6));
    const direct = p.targetId ? this.getEntity(p.targetId) : undefined;
    let hitCount = 0;
    for (const e of this.state.entities) {
      if (e.hp <= 0) continue;
      if (!this.isAttackable(p.owner, e)) continue;
      // Garrisoned infantry are not exposed targets; hits on their shelter
      // pass through damageGarrison below.
      if (e.kind === 'unit' && e.garrisonId) continue;
      // A dived boat is immune to ordinary fire until its launch datum exposes
      // it; depth charges are the only weapon that can reach it while hidden.
      const submerged = !!e.submarine?.dived;
      if (weapon?.asw) {
        if (!submerged) continue;
      } else if (submerged && !e.submarine?.revealed) {
        continue;
      }
      const targetClass = entityTargetClass(e);
      if (!targets.includes(targetClass)) continue;
      const d = dist(p.x, p.z, e.x, e.z);
      const effectiveRadius = radius + (e.kind === 'building' ? 4 : unitDef(e.defId).radius * 0.7);
      if (d > effectiveRadius) continue;
      if (direct && e.id !== direct.id && d > radius) continue;
      const falloff = p.splash > 0 ? 1 - 0.55 * Math.min(1, d / radius) : 1;
      const damage = computeDamage(p.damage * falloff, multipliers, entityArmour(e));
      if (damage <= 0) continue;
      this.damageEntity(e, damage, p.owner, p.shooterId, p.weaponId);
      if (weapon && e.kind === 'building' && BUILDINGS[e.defId]?.garrison) {
        this.damageGarrison(e, weapon, p.damage * falloff, p.id, p.owner, p.shooterId, e.id === direct?.id);
      }
      e.suppression = Math.min(1, e.suppression + p.suppression * falloff);
      hitCount++;
    }
    const surface: ImpactSurface = direct
      ? this.impactSurface(direct)
      : this.isWaterPoint(p.x, p.z)
        ? 'water'
        : 'ground';
    this.emit(p.splash > 0 ? 'explosion' : 'impact', {
      team: p.owner,
      x: p.x,
      y: p.y,
      z: p.z,
      text: '',
      weaponId: p.weaponId,
      surface,
      hit: !!direct,
      targetId: direct?.id ?? 0,
      sound: p.splash > 0 ? 'explosion' : 'impact',
      level: 'info',
    });
    void hitCount;
  }

  private impactSurface(target: Entity): ImpactSurface {
    if (target.kind === 'building') return 'structure';
    const def = UNITS[target.defId];
    if (def?.domain === 'air') return 'air';
    if (def && def.armour !== 'infantry') return 'armour';
    return 'ground';
  }

  private isWaterPoint(x: number, z: number): boolean {
    const tile = this.tileAt(x, z);
    if (tile === null) return false;
    const terrain = this.state.map.terrain[tile];
    return terrain === Terrain.DeepWater || terrain === Terrain.ShallowWater;
  }

  private damageEntity(
    target: Entity,
    damage: number,
    attackerOwner: number,
    shooterId: number,
    weaponId?: string,
  ): void {
    if (target.hp <= 0) return;
    // Capture-only objectives are never damaged; even splash leaves them intact.
    if (isIndestructibleStructure(target.defId)) return;
    // Infantry in physical cover take less from direct fire. Concealment never
    // enters this calculation: a crop field hides a squad but does not stop a
    // round once it is found, and indirect fire arcs over field cover. Vehicles
    // do not benefit — their protection is their armour, which the damage model
    // already accounts for, so a tank duel is decided by guns and plating.
    if (damage > 0 && target.kind === 'unit') {
      const def = UNITS[target.defId];
      if (def && def.domain !== 'air' && def.armour === 'infantry') {
        const cover = coverFactor(this.state.map, target.x, target.z, weaponId ? WEAPONS[weaponId] : undefined);
        if (cover > 0) damage = Math.max(0.1, Math.round(damage * (1 - 0.3 * cover) * 10) / 10);
      }
    }
    // What actually landed, so a killing blow cannot pay out more experience
    // than the target had left to give.
    const applied = Math.max(0, Math.min(damage, target.hp));
    target.hp -= damage;
    target.lastHitTick = this.state.tick;
    // Veterancy is earned by the crew that did the work, friend or foe, ship,
    // airframe or vehicle. Static defences never promote, and neither does a
    // shot into somebody else's fight: only hostile damage counts.
    const shooter = this.getEntity(shooterId);
    if (
      shooter &&
      shooter.kind === 'unit' &&
      applied > 0 &&
      target.owner >= 0 &&
      this.isHostile(shooter.owner, target.owner)
    ) {
      const promoted = awardCombatXp(shooter, applied, Math.max(1, target.maxHp));
      if (promoted) {
        // `unitPromoted` is the presentation hook: the line, the announcer and
        // the hull flash all key off it, so promotion feedback stays in one
        // place instead of every surface guessing from the prose.
        this.emit('notice', {
          team: shooter.owner,
          x: shooter.x,
          z: shooter.z,
          text: `${entityName(shooter)} promoted to ${promoted.name}`,
          code: 'unitPromoted',
          entityId: shooter.id,
          defId: shooter.defId,
          level: 'success',
        });
      }
    }
    // A depth-charge hit is a datum of its own: the boat is briefly exposed
    // even if it was not the one that launched.
    if (target.submarine?.dived) {
      target.submarine.revealed = true;
      target.submarine.revealTimer = Math.max(target.submarine.revealTimer, 3);
    }
    if (target.hp > 0) {
      this.expelFromCollapsingShelter(target);
      this.noteUnderAttack(target, attackerOwner);
      return;
    }
    target.hp = 0;
    target.state = 'dead';
    if (target.kind === 'building' && BUILDINGS[target.defId]?.garrison) {
      this.destroyGarrison(target, attackerOwner);
    }
    const attacker = this.player(attackerOwner);
    const victim = this.player(target.owner);
    if (attacker) attacker.stats.kills++;
    if (victim) {
      if (target.kind === 'unit') victim.stats.unitsLost++;
    }
    const name = entityName(target);
    if (target.kind === 'unit') {
      this.emit('unitLost', {
        team: target.owner,
        x: target.x,
        z: target.z,
        text: `${name} destroyed`,
        entityId: target.id,
        defId: target.defId,
        weaponId,
        facing: target.facing,
        level: this.teamOf(target.owner) === this.teamOf(this.localPlayerId) ? 'critical' : 'info',
        sound: 'explosion',
      });
      if (target.owner === this.localPlayerId) {
        this.emit('alert', {
          team: target.owner,
          x: target.x,
          z: target.z,
          text: `${name} lost`,
          level: 'warning',
          entityId: target.id,
          sound: 'alert',
        });
      }
    } else {
      this.emit('buildingLost', {
        team: target.owner,
        x: target.x,
        z: target.z,
        text: `${name} destroyed`,
        entityId: target.id,
        defId: target.defId,
        weaponId,
        facing: target.facing,
        level: this.teamOf(target.owner) === this.teamOf(this.localPlayerId) ? 'critical' : 'info',
        sound: 'explosion',
      });
      const def = buildingDef(target.defId);
      const tx = Math.round(target.x / TILE_SIZE - def.footprint.w / 2);
      const tz = Math.round(target.z / TILE_SIZE - def.footprint.h / 2);
      if (def.walkable) {
        // A bridge is not cleared when it dies. The span drops into the channel,
        // the crossing closes, and the wreckage stays until an engineer re-decks
        // it — so the tiles block from this tick on.
        stampFootprint(this.blocked, this.state.map, target.defId, tx, tz, 1);
        this.clearDeck(target, def.footprint.w, def.footprint.h, tx, tz);
        this.deckDirty = true;
      } else {
        stampFootprint(this.blocked, this.state.map, target.defId, tx, tz, 0);
      }
    }
    if (shooter) shooter.kills++;
    target.path = [];
    target.queue = [];
  }

  /**
   * One voice alert per category per ten seconds, for the local player only.
   * This is a presentation coalescer, not simulation state: it is never saved
   * and cannot change damage, targeting, AI or the deterministic hash.
   */
  private noteUnderAttack(target: Entity, attackerOwner: number): void {
    if (target.owner < 0) return;
    if (this.teamOf(target.owner) !== this.teamOf(this.localPlayerId)) return;
    if (!this.isHostile(attackerOwner, target.owner)) return;
    const kind: 'base' | 'forces' = target.kind === 'building' ? 'base' : 'forces';
    const last = this.lastAttackNotice.get(kind) ?? -Infinity;
    if (this.state.tick - last < 10 * TICK_RATE) return;
    this.lastAttackNotice.set(kind, this.state.tick);
    this.emit('alert', {
      team: this.localPlayerId,
      x: target.x,
      z: target.z,
      text:
        kind === 'base'
          ? `${entityName(target)} under attack`
          : 'Forces under attack',
      entityId: target.id,
      level: 'warning',
      sound: 'alert',
      code: kind === 'base' ? 'baseUnderAttack' : 'forcesUnderAttack',
    });
  }

  private cleanup(): void {
    // A dropped span is kept on purpose, so only a removable death is a reason
    // to walk the entity list.
    if (
      !this.state.entities.some(
        (e) => e.hp <= 0 && !(e.kind === 'building' && BUILDINGS[e.defId]?.walkable),
      )
    ) {
      return;
    }
    // Destroyed shelters kill their occupants first: those units are not in the
    // initial dead list, so recompute it before removing ids, or a stale id
    // would keep them selectable through getEntity after death.
    for (const e of this.state.entities) {
      if (e.kind === 'building' && e.hp <= 0 && BUILDINGS[e.defId]?.garrison) {
        this.destroyGarrison(e, e.owner);
      }
    }
    const dead = this.state.entities.filter((e) => e.hp <= 0);
    for (const e of dead) {
      if (e.kind === 'building') {
        const def = buildingDef(e.defId);
        const tx = Math.round(e.x / TILE_SIZE - def.footprint.w / 2);
        const tz = Math.round(e.z / TILE_SIZE - def.footprint.h / 2);
        // A dropped span survives its own destruction as wreckage: clearing its
        // footprint here would reopen the crossing the enemy just closed.
        if (def.walkable) continue;
        stampFootprint(this.blocked, this.state.map, e.defId, tx, tz, 0);
      }
      this.byId.delete(e.id);
    }
    this.state.entities = this.state.entities.filter(
      (e) => e.hp > 0 || (e.kind === 'building' && !!BUILDINGS[e.defId]?.walkable),
    );
    this.state.contacts = this.state.contacts.filter((c) => this.byId.has(c.entityId));
    if (this.state.charted.some((c) => !this.byId.has(c.entityId))) {
      this.state.charted = this.state.charted.filter((c) => this.byId.has(c.entityId));
      this.rebuildChartedIndex();
    }
    // Clear orders pointing at dead entities.
    for (const e of this.state.entities) {
      if (e.order?.targetId && !this.byId.has(e.order.targetId)) {
        e.order = null;
        e.targetId = 0;
        e.aimTargetId = 0;
        e.state = 'idle';
      }
      // A direct target can outlive the order that created it. Clear it from
      // the authoritative state here, whatever order the unit now holds, so a
      // checkpoint can never serialise an entity id that has just been removed.
      if (e.targetId && !this.byId.has(e.targetId)) e.targetId = 0;
      if (e.aimTargetId && !this.byId.has(e.aimTargetId)) e.aimTargetId = 0;
      if (e.healTargetId && !this.byId.has(e.healTargetId)) e.healTargetId = 0;
      if (e.buildTargetId && !this.byId.has(e.buildTargetId)) this.releaseBuildTarget(e);
      if (e.repairTargetId && !this.byId.has(e.repairTargetId)) {
        e.repairTargetId = 0;
        if (e.state === 'repairing') e.state = 'idle';
      }
      if (e.garrisonId && !this.byId.has(e.garrisonId)) {
        // Defensive fallback: a missing shelter must never leave an
        // inaccessible occupant with a stale reference.
        e.garrisonId = 0;
        e.state = 'idle';
      }
      if (e.captureTargetId && !this.byId.has(e.captureTargetId)) {
        e.captureTargetId = 0;
        e.captureProgress = 0;
      }
      if (e.homeId && !this.byId.has(e.homeId)) e.homeId = 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Victory                                                            */
  /* ------------------------------------------------------------------ */

  private evaluateVictory(): void {
    if (this.state.victory !== 'playing') return;
    const scenario = this.state.scenario;
    for (const p of this.state.players) {
      if (p.defeated) continue;
      let defeated = false;
      if (scenario.settings.victory === 'destroyHQ') {
        const hasHq = this.state.entities.some(
          (e) => e.owner === p.id && e.hp > 0 && !e.construction && BUILDINGS[e.defId]?.commandPost,
        );
        defeated = !hasHq;
      } else {
        const hasAny = this.state.entities.some((e) => e.owner === p.id && e.hp > 0);
        defeated = !hasAny;
      }
      if (defeated) p.defeated = true;
    }
    // A mission's clock is its objective tree, not a skirmish score. Time
    // pressure belongs to authored triggers, which S3 will provide; silently
    // scoring a mission on residual hit points would invent a rule.
    if (scenario.settings.timeLimitSec !== null && !this.mission) {
      const elapsed = (this.state.tick - this.state.startedAtTick) / TICK_RATE;
      if (elapsed >= scenario.settings.timeLimitSec) {
        const score = (id: number) =>
          this.state.entities
            .filter((e) => e.owner === id && e.hp > 0)
            .reduce((sum, e) => sum + e.hp, 0);
        const a = score(this.state.players[0]?.id ?? 0);
        const b = score(this.state.players[1]?.id ?? 1);
        this.finish(a === b ? 'draw' : a > b ? 'victory' : 'defeat');
        return;
      }
    }
    const local = this.player(this.localPlayerId);
    if (!local) return;
    if (this.mission) {
      // Mission outcomes are decided by the objective tree. The existing
      // force-destruction rule still counts: losing the field is a defeat even
      // if every primary objective happened to be complete.
      this.mission.evaluateOutcome(local.defeated);
      if (this.mission.outcome === 'victory') {
        this.finish('victory');
        return;
      }
      if (this.mission.outcome === 'defeat') {
        this.finish('defeat');
        return;
      }
      return;
    }
    if (local.defeated) {
      this.finish('defeat');
      return;
    }
    const enemies = this.state.players.filter(
      (p) => p.id !== local.id && this.isHostile(p.id, local.id),
    );
    if (enemies.length > 0 && enemies.every((p) => p.defeated)) {
      this.finish('victory');
    }
  }

  private finish(result: VictoryState): void {
    if (this.state.victory !== 'playing') return;
    this.state.victory = result;
    for (const p of this.state.players) {
      if (result === 'victory' && this.isHostile(p.id, this.localPlayerId)) p.defeated = true;
      if (result === 'defeat' && p.id === this.localPlayerId) p.defeated = true;
    }
    // The result is captured before the end event, from exactly the state the
    // verdict was decided on. Nothing in the UI recounts it.
    const mission = this.mission;
    if (mission && (result === 'victory' || result === 'defeat')) {
      this.captureMissionResult(result);
    }
    const failedPrimary = mission?.doc.objectives.some(
      (objective) =>
        objective.kind === 'primary' && mission.objectiveState(objective.id) === 'failed',
    );
    const text = mission
      ? result === 'victory'
        ? 'All primary objectives secured. Mission complete.'
        : result === 'defeat'
          ? failedPrimary
            ? 'A primary objective was lost. Mission failed.'
            : 'Your force was destroyed before the mission could be completed.'
          : 'Mission ended.'
      : result === 'victory'
        ? 'Island secured. Enemy command eliminated.'
        : result === 'defeat'
          ? 'Command Post lost. Operation failed.'
          : 'Operation ended in a draw.';
    this.emit(result === 'victory' ? 'victory' : result === 'defeat' ? 'defeat' : 'notice', {
      team: this.localPlayerId,
      x: 0,
      z: 0,
      text,
      level: result === 'victory' ? 'success' : 'critical',
      sound: result === 'victory' ? 'victory' : 'defeat',
    });
  }

  /* ------------------------------------------------------------------ */
  /* Events and diagnostics                                             */
  /* ------------------------------------------------------------------ */

  emit(
    type: SimEventType,
    data: {
      team: number;
      x: number;
      z: number;
      y?: number;
      text: string;
      entityId?: number;
      defId?: string;
      weaponId?: string;
      surface?: SimEvent['surface'];
      hit?: boolean;
      targetId?: number;
      facing?: number;
      sound?: string;
      code?: SimEventCode;
      level?: SimEvent['level'];
    },
  ): void {
    const ev: SimEvent = {
      seq: this.state.eventSeq++,
      tick: this.state.tick,
      type,
      team: data.team,
      x: data.x,
      y: data.y,
      z: data.z,
      text: data.text,
      entityId: data.entityId,
      defId: data.defId,
      weaponId: data.weaponId,
      surface: data.surface,
      hit: data.hit,
      targetId: data.targetId,
      facing: data.facing,
      sound: data.sound,
      code: data.code,
      level: data.level ?? 'info',
    };
    this.state.events.push(ev);
    if (this.state.events.length > 240) this.state.events.shift();
  }

  /** Events added since the given sequence number. */
  eventsAfter(seq: number): SimEvent[] {
    return this.state.events.filter((e) => e.seq > seq);
  }

  heightAt(x: number, z: number): number {
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    if (!inBounds(this.state.map.width, this.state.map.height, tx, tz)) return 0;
    return this.state.map.elevation[tileIndex(this.state.map.width, tx, tz)] * ELEVATION_HEIGHT;
  }

  tileAt(x: number, z: number): number | null {
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    if (!inBounds(this.state.map.width, this.state.map.height, tx, tz)) return null;
    return tileIndex(this.state.map.width, tx, tz);
  }

  /** Building near a point on the same team (for aircraft/ship home checks). */
  nearestOwnedBuilding(
    owner: number,
    predicate: (e: Entity) => boolean,
    x: number,
    z: number,
  ): Entity | null {
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const e of this.state.entities) {
      if (e.owner !== owner || e.kind !== 'building' || e.hp <= 0) continue;
      if (!predicate(e)) continue;
      const d = dist2(x, z, e.x, e.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  stats() {
    let units = 0;
    let buildings = 0;
    for (const e of this.state.entities) {
      if (e.kind === 'unit') units++;
      else buildings++;
    }
    return {
      entities: this.state.entities.length,
      units,
      buildings,
      projectiles: this.state.projectiles.length,
      tick: this.state.tick,
      ms: 0,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Save / load                                                        */
  /* ------------------------------------------------------------------ */

  toSave(): SaveData {
    const { scenario, ...rest } = this.state;
    return {
      format: SAVE_FORMAT,
      version: SAVE_FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      scenario,
      state: {
        map: {
          width: rest.map.width,
          height: rest.map.height,
          terrain: Array.from(rest.map.terrain),
          elevation: Array.from(rest.map.elevation),
          ore: Array.from(rest.map.ore),
          maxOre: Array.from(rest.map.maxOre),
        },
        tick: rest.tick,
        seed: rest.seed,
        rngState: rest.rngState,
        nextEntityId: rest.nextEntityId,
        nextProjectileId: rest.nextProjectileId,
        eventSeq: rest.eventSeq,
        fog: rest.fog.map((f) => Array.from(f)),
        players: rest.players,
        entities: rest.entities,
        projectiles: rest.projectiles,
        events: rest.events.slice(-80),
        victory: rest.victory,
        startedAtTick: rest.startedAtTick,
        ai: rest.ai,
        contacts: rest.contacts,
        charted: rest.charted,
        commandCount: rest.commandCount,
        // Smoke is authoritative battlefield state, not a client effect: a save
        // taken inside a cloud has to restore the same obstruction.
        smoke: rest.smoke.map((cloud) => ({ ...cloud })),
        nextSmokeId: rest.nextSmokeId,
        // The canonical runtime snapshot, so a save never aliases live state.
        mission: this.mission ? this.mission.snapshot() : null,
      },
      localPlayerId: this.localPlayerId,
    };
  }

  static fromSave(raw: unknown, opts: GameOptions = {}): Game {
    if (!raw || typeof raw !== 'object') throw new SaveFormatError('Save file is not valid JSON object data.');
    const header = raw as { format?: unknown; version?: unknown };
    if (header.format !== SAVE_FORMAT) throw new SaveFormatError('This is not a Modern Combined Arms battle save.');
    const version = typeof header.version === 'number' ? header.version : Number.NaN;
    if (!Number.isFinite(version)) throw new SaveFormatError('Save file has no readable version.');
    if (version > SAVE_FORMAT_VERSION) {
      throw new SaveFormatError(
        `Save version ${version} was written by a newer build; this build supports up to ${SAVE_FORMAT_VERSION}. Update the game before loading it.`,
      );
    }
    // Older files are upgraded in place by the migration chain rather than
    // refused. A version the chain cannot reach still fails with the same
    // clear message the loader has always given.
    const migrated = version === SAVE_FORMAT_VERSION ? raw : migrateSave(raw);
    if (!migrated) {
      throw new SaveFormatError(
        `Save version ${version} is not supported by this build (expected ${SAVE_FORMAT_VERSION}).`,
      );
    }
    const data = migrated as unknown as Partial<SaveData> & { state?: Record<string, unknown> };
    if (!data.scenario || !data.state) throw new SaveFormatError('Save file is missing scenario or state data.');
    const savedScenario = data.scenario;
    const savedState = data.state;
    const state = savedState as unknown as GameState;
    if (!Array.isArray(state.entities) || !Array.isArray(state.players)) {
      throw new SaveFormatError('Save file state is corrupted.');
    }
    if (state.entities.some((e) => !UNITS[e.defId] && !BUILDINGS[e.defId])) {
      throw new SaveFormatError('Save file references content that is not installed.');
    }
    // A save stores the nation or preset by id; an unknown id must fail here
    // rather than resolving to a fallback roster mid-battle.
    for (const p of state.players) {
      if (!p || typeof p.factionId !== 'string' || !tryIdentityDef(p.factionId)) {
        throw new SaveFormatError('Save file references an unknown faction or nation.');
      }
    }
    const game = new Game(savedScenario, { ...opts, skipInit: true });
    game.localPlayerId = data.localPlayerId ?? opts.localPlayerId ?? PLAYER;
    // The mission document travels inside the scenario, so the runtime is
    // rebuilt from validated authored data plus the saved state. A save with no
    // mission state (every pre-mission save, and every skirmish) restores fresh
    // defaults only when the scenario actually carries a mission.
    const missionRuntime = savedScenario.mission
      ? MissionRuntime.fromState(savedScenario.mission, state.mission)
      : null;
    const map = savedState.map as unknown as GameState['map'];
    // A v1 file may predate the ore arrays or lose them in serialisation;
    // rebuild the runtime map from the embedded scenario rather than crash.
    const fallbackMap = createRuntimeMap(savedScenario);
    const loadedSmoke = normalizeSmoke(state.smoke, state.tick);
    game.state = {
      ...state,
      scenario: savedScenario,
      map: map && Array.isArray(map.terrain)
        ? {
            width: map.width,
            height: map.height,
            terrain: Uint8Array.from(map.terrain),
            elevation: Uint8Array.from(map.elevation),
            ore: Array.isArray(map.ore) ? Uint16Array.from(map.ore) : fallbackMap.ore,
            maxOre: Array.isArray(map.maxOre) ? Uint16Array.from(map.maxOre) : fallbackMap.maxOre,
          }
        : fallbackMap,
      fog: [0, 1].map((team) =>
        savedState.fog?.[team]
          ? Uint8Array.from(savedState.fog[team])
          : new Uint8Array(savedScenario.width * savedScenario.height),
      ),
      ai: {
        ...game.createAIState(
          (state.ai?.aiSeed ?? savedScenario.settings.seed) >>> 0,
          state.ai?.difficulty ?? opts.aiDifficulty ?? 'veteran',
        ),
        ...(state.ai ?? {}),
      },
      // A save written before smoke existed has no field at all; an expired
      // cloud is dropped rather than resurrected, and a malformed one is
      // ignored instead of poisoning every vision query.
      smoke: loadedSmoke,
      nextSmokeId: Math.max(
        1,
        Number.isInteger(state.nextSmokeId) && state.nextSmokeId > 0
          ? state.nextSmokeId
          : 1,
        ...loadedSmoke.map((cloud) => cloud.id + 1),
      ),
      mission: missionRuntime ? missionRuntime.state : null,
      ready: true,
    };
    game.mission = missionRuntime;
    // A save taken at the moment of a terminal outcome normally carries the
    // result. If it does not, capturing it from the restored end state is
    // deterministic: the tick no longer advances once the battle is over.
    if (missionRuntime && missionRuntime.outcome !== 'playing' && !missionRuntime.result) {
      game.captureMissionResult(missionRuntime.outcome);
    }
    game.normalizeResearchState();
    game.normalizeSuperweaponStates();
    game.rng = new Rng(game.state.seed);
    game.rng.setState(game.state.rngState);
    game.blocked = new Uint8Array(savedScenario.width * savedScenario.height);
    game.byId = new Map();
    game.state.entities.sort((a, b) => a.id - b.id);
    for (const e of game.state.entities) {
      e.hp = Number(e.hp);
      e.buildTargetId = Number(e.buildTargetId ?? 0);
      e.healTargetId = Number(e.healTargetId ?? 0);
      // Authored identity is optional and must stay a non-empty string; a
      // hand-edited value is dropped rather than becoming a dangling reference.
      if (typeof e.authoredKey !== 'string' || e.authoredKey.length === 0) delete e.authoredKey;
      // Saves written before the submarine phase have no dive state. Rebuild it
      // rather than treating the boat as a permanent surface ship.
      const subDef = UNITS[e.defId]?.submarine;
      if (subDef && !e.submarine) {
        e.submarine = {
          dived: false,
          battery: subDef.batterySeconds,
          maxBattery: subDef.batterySeconds,
          revealTimer: 0,
          revealed: false,
        };
      }
      if (e.submarine) {
        const maxBattery = Number(e.submarine.maxBattery);
        e.submarine.maxBattery =
          Number.isFinite(maxBattery) && maxBattery > 0
            ? maxBattery
            : (subDef?.batterySeconds ?? 45);
        const battery = Number(e.submarine.battery);
        e.submarine.battery = Math.max(
          0,
          Math.min(e.submarine.maxBattery, Number.isFinite(battery) ? battery : e.submarine.maxBattery),
        );
        e.submarine.revealTimer = Math.max(0, Number(e.submarine.revealTimer ?? 0));
        e.submarine.revealed = !!e.submarine.revealed && e.submarine.revealTimer > 0;
      }
      game.byId.set(e.id, e);
      if (e.kind === 'building' && e.hp > 0) {
        const def = buildingDef(e.defId);
        const tx = Math.round(e.x / TILE_SIZE - def.footprint.w / 2);
        const tz = Math.round(e.z / TILE_SIZE - def.footprint.h / 2);
        stampFootprint(game.blocked, game.state.map, e.defId, tx, tz, 1);
      }
    }
    game.visible = [[], []].map(() => new Set<number>());
    game.state.charted = Array.isArray(state.charted) ? state.charted : [];
    game.rebuildChartedIndex();
    game.state.ready = true;
    game.refreshVision(false);
    game.lastMatsSample = game.state.players.map((p) => p.stats.matsGathered);
    game.ai = new AIController();
    if (opts.enableAI === false) game.ai = null;
    return game;
  }

  /**
   * Make a loaded research record safe without granting anything. A save from
   * before research existed has no field at all, and a hand-edited or older
   * content id is dropped rather than poisoning every availability query.
   */
  private normalizeResearchState(): void {
    for (const p of this.state.players) {
      const raw = p.research as Partial<PlayerState['research']> | undefined;
      const identity = tryIdentityDef(p.factionId);
      const allowed = (id: string): boolean => {
        const tech = techDef(id, this.research);
        if (!tech) return false;
        if (tech.alliances && (!identity || !tech.alliances.includes(identity.allianceId))) {
          return false;
        }
        if (tech.nations && !tech.nations.includes(p.factionId)) return false;
        return true;
      };
      const known = Array.isArray(raw?.completed)
        ? [...new Set(raw.completed.filter((id): id is string => typeof id === 'string'))].filter(
            allowed,
          )
        : [];
      // Drop a hand-edited technology whose prerequisites are absent rather
      // than letting it unlock equipment the player never researched.
      const completed = known.filter((id) =>
        (techDef(id, this.research)?.requires ?? []).every((required) => known.includes(required)),
      );
      p.research = { completed, project: null };
      const project = raw?.project;
      const tech =
        project && typeof project.techId === 'string'
          ? techDef(project.techId, this.research)
          : undefined;
      if (
        project &&
        tech &&
        allowed(tech.id) &&
        tech.requires.every((id) => completed.includes(id)) &&
        !completed.includes(tech.id) &&
        Number.isFinite(project.remaining) &&
        Number.isFinite(project.total)
      ) {
        const total = Math.max(1, project.total);
        p.research.project = {
          techId: tech.id,
          remaining: Math.max(0, Math.min(total, project.remaining)),
          total,
        };
      }
    }
    for (const e of this.state.entities) {
      if (e.kind === 'unit' && Array.isArray(e.upgrades)) {
        const slot = unitFamily(e.defId);
        const upgrades = [
          ...new Set(e.upgrades.filter((id): id is string => typeof id === 'string')),
        ].filter((id) => unitUpgradeDef(id, this.research)?.eligibleSlots.includes(slot));
        if (upgrades.length > 0) e.upgrades = upgrades;
        else delete e.upgrades;
      } else {
        delete e.upgrades;
      }
      if (e.kind === 'building' && Array.isArray(e.modules)) {
        const slot = buildingFamily(e.defId);
        const modules: string[] = [];
        for (const id of e.modules) {
          if (typeof id !== 'string') continue;
          const module = buildingModuleDef(id, this.research);
          if (!module || !module.eligibleSlots.includes(slot)) continue;
          const count = modules.filter((entry) => entry === id).length;
          if (count >= (module.capacity ?? 1)) continue;
          modules.push(id);
        }
        if (modules.length > 0) e.modules = modules;
        else delete e.modules;
      } else {
        delete e.modules;
      }
      // Reload clocks are per-hull and keyed by a playable upgrade id. A stale
      // or hand-edited key is dropped; an expired clock is removed so a loaded
      // save and a live battle hash the same.
      if (e.kind === 'unit' && e.cooldowns && typeof e.cooldowns === 'object') {
        const cooldowns: Record<string, number> = {};
        for (const [id, value] of Object.entries(e.cooldowns)) {
          if (!abilityForUpgrade(id)) continue;
          if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
          cooldowns[id] = value;
        }
        if (Object.keys(cooldowns).length > 0) e.cooldowns = cooldowns;
        else delete e.cooldowns;
      } else {
        delete e.cooldowns;
      }
    }
  }

  stateHash(): string {
    const parts: string[] = [];
    parts.push(`t=${this.state.tick}`, `r=${this.state.rngState}`, `v=${this.state.victory}`);
    for (const p of this.state.players) {
      const project = p.research.project;
      // Strategic state is hashed only once a commander has any: a battle that
      // has never called in a capability hashes exactly as it did before this
      // layer existed, which keeps every pre-existing determinism baseline
      // meaningful instead of merely re-recorded.
      const sw = p.superweapon;
      const swCooldowns = Object.entries(sw.cooldowns)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, until]) => `${id}@${until}`)
        .join('+');
      const swPart =
        swCooldowns || sw.active || sw.ewUntilTick > 0 || sw.defence
          ? `:s${swCooldowns || '-'}` +
            `:${sw.active ? `${sw.active.family}@${sw.active.phase}@${sw.active.launched}` : '-'}` +
            `:e${sw.ewUntilTick}:d${
              sw.defence
                ? `${sw.defence.x.toFixed(1)},${sw.defence.z.toFixed(1)},${sw.defence.untilTick}`
                : '-'
            }`
          : '';
      parts.push(
        `p${p.id}:${p.mats.toFixed(2)}:${p.req.toFixed(2)}:${p.stats.unitsLost}:${p.stats.kills}` +
          `:r${p.research.completed.join('+') || '-'}:${
            project ? `${project.techId}@${project.remaining.toFixed(3)}` : '-'
          }` +
          swPart,
      );
    }
    for (const e of [...this.state.entities].sort((a, b) => a.id - b.id)) {
      parts.push(
        [
          'e',
          e.id,
          e.defId,
          e.owner,
          // Authored identity is state: two worlds whose named asset differs
          // must not hash the same. Only keyed entities emit it, so an ordinary
          // battle hashes exactly as it did before missions existed.
          ...(e.authoredKey ? [e.authoredKey] : []),
          e.hp.toFixed(1),
          e.x.toFixed(2),
          e.z.toFixed(2),
          e.ammo,
          e.fuel.toFixed(1),
          e.state,
          e.order?.type ?? '-',
          e.order?.targetId ?? 0,
          e.pathIndex,
          e.queue.length,
          e.buildProgress.toFixed(2),
          // A dismantling structure is still a structure: two worlds that sold
          // at different moments must not hash alike. Only a sale emits the
          // field, so every pre-existing baseline hashes exactly as before.
          ...(e.deconstruct ? [e.deconstruct.remaining.toFixed(2)] : []),
          e.suppression.toFixed(2),
          // Repair progress now depends on how recently a structure was hit, so
          // the hash has to cover it for save/load comparisons to be faithful.
          e.lastHitTick,
          e.healTargetId,
          e.garrisonId,
          e.captureTargetId,
          e.captureProgress.toFixed(3),
          // Veterancy is simulation state: two worlds that have fought the same
          // fight have to promote the same crews.
          e.xp ?? 0,
          // Individual upgrade and module state changes what a unit or structure
          // can do, so two worlds that took different purchases must differ.
          (e.upgrades ?? []).join('+') || '-',
          (e.modules ?? []).join('+') || '-',
          // A reload clock is simulation state: two worlds whose smoke
          // dischargers are at different points in their cycle must differ.
          Object.entries(e.cooldowns ?? {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, value]) => `${id}@${value.toFixed(2)}`)
            .join('+') || '-',
          e.submarine
            ? `s${e.submarine.dived ? 1 : 0}:${e.submarine.battery.toFixed(1)}:${e.submarine.revealTimer.toFixed(1)}:${e.submarine.revealed ? 1 : 0}`
            : '-',
        ].join(','),
      );
    }
    for (const pr of [...this.state.projectiles].sort((a, b) => a.id - b.id)) {
      // Only an off-map strategic round carries a family; an ordinary shell
      // hashes exactly as it did before this layer existed, so every recorded
      // combat baseline keeps its meaning.
      parts.push(
        `j${pr.id}:${pr.x.toFixed(1)}:${pr.z.toFixed(1)}:${pr.targetId}${
          pr.strategic ? `:${pr.strategic.family}` : ''
        }`,
      );
    }
    for (const cloud of this.state.smoke) {
      parts.push(`k${cloud.id}:${cloud.x.toFixed(1)}:${cloud.z.toFixed(1)}:${cloud.radius}:${cloud.expiresTick}`);
    }
    // Mission state hashes through its own canonical form, so the digest and the
    // save file cannot disagree about what the mission contains. A skirmish
    // contributes nothing at all, which keeps every pre-mission fingerprint
    // (and the Phase 2A.8 path-equivalence baselines) byte-identical.
    if (this.mission) parts.push(`m=${this.mission.hash()}`);
    return parts.join('|');
  }

  get elapsedSeconds(): number {
    return this.state.tick / TICK_RATE;
  }
}

const TICKS_PER_SECOND = TICK_RATE;

/**
 * Spacing footprint used by local avoidance and separation. An infantry marker
 * is one figure on screen standing in for a fire team, so its spacing radius is
 * deliberately smaller than the gameplay radius used for structures and
 * picking; at the full radius a section barged through gaps like a truck.
 */
function formationRadius(def: UnitDef): number {
  return def.armour === 'infantry' ? def.radius * 0.62 : def.radius;
}

/**
 * Keep only well-formed, unexpired smoke clouds from a save file. Expired
 * clouds are dropped rather than restored, and ids stay unique so a reload
 * cannot alias two live clouds.
 */
function normalizeSmoke(raw: unknown, tick: number): SmokeCloud[] {
  if (!Array.isArray(raw)) return [];
  const clouds: SmokeCloud[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const cloud = entry as Partial<SmokeCloud>;
    const id = cloud.id;
    const numbers = [cloud.x, cloud.z, cloud.radius, cloud.expiresTick];
    if (!Number.isInteger(id) || (id as number) <= 0 || seen.has(id as number)) continue;
    if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
    if ((cloud.radius as number) <= 0 || (cloud.expiresTick as number) <= tick) continue;
    seen.add(id as number);
    clouds.push({
      id: id as number,
      owner: Number.isInteger(cloud.owner) ? (cloud.owner as number) : -1,
      team: Number.isInteger(cloud.team) ? (cloud.team as number) : -1,
      x: cloud.x as number,
      z: cloud.z as number,
      radius: cloud.radius as number,
      startTick: Number.isFinite(cloud.startTick) ? (cloud.startTick as number) : tick,
      expiresTick: cloud.expiresTick as number,
    });
  }
  return clouds.sort((a, b) => a.id - b.id);
}

function blockedSnapshot(blocked: Uint8Array): Uint8Array {
  const snapshot = new Uint8Array(blocked.length);
  for (let i = 0; i < blocked.length; i++) {
    // Mark structures and any non-buildable terrain. checkPlacement handles
    // terrain separately; the occupancy copy only needs structures.
    snapshot[i] = blocked[i];
  }
  return snapshot;
}

export { TILE_SIZE, Terrain };

/** Re-exported for UI text. */
export function terrainLabel(t: number): string {
  return terrainName(t);
}

/** Convenience check used by the UI to select a local player's entity. */
export function isUnit(e: Entity | undefined): e is Entity {
  return !!e && e.kind === 'unit';
}

/** Defensive re-export to keep renderer imports stable. */
export type { Entity, GameState, PlayerState, UnitDef, WeaponDef };
