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
import { BUILDINGS, isIndestructibleStructure } from '../data/buildings';
import { UNITS } from '../data/units';
import { WEAPONS } from '../data/weapons';
import {
  TERRAIN,
  Terrain,
  canStandOn,
  inBounds,
  moveCost,
  terrainName,
  tileIndex,
  worldToTile,
  type TerrainId,
} from './terrain';
import { buildingDef } from '../data/buildings';
import { unitDef } from '../data/units';
import { findPath, nearestWalkable, type NavGrid } from './pathfinding';
import {
  adjacentWater,
  checkPlacement,
  waterFacingFor,
  type Scenario,
  type ScenarioStructure,
} from './scenario';
import { createRuntimeMap, footprintCenter, stampFootprint } from './map';

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
  computeDamage,
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
import { tryIdentityDef } from '../data/factions';
import { AIController, initialAIState } from './ai';
import { structureBenefit } from './infrastructure';
import {
  SAVE_FORMAT,
  SAVE_FORMAT_VERSION,
  type SaveData,
} from './save';
import type {
  Command,
  Entity,
  GameState,
  PlayerState,
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
  ContactRecord,
  PathPoint,
  VisionState,
} from './types';

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
}

export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFormatError';
  }
}

const AIRCRAFT_ALTITUDE = 13;
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

export class Game {
  state: GameState;
  rng: Rng;
  blocked: Uint8Array;
  /** Entity ids visible to each player id (rebuilt during vision refresh). */
  visible: Set<number>[];
  localPlayerId: number;
  pending: Command[] = [];
  ai: AIController | null = null;
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
  /** Whether incoming fire suspends engineer repair (Phase 8 rule; always true in play). */
  private readonly repairSuppression: boolean;

  constructor(scenario: Scenario, opts: GameOptions = {}) {
    this.localPlayerId = opts.localPlayerId ?? PLAYER;
    this.repairSuppression = opts.repairSuppression !== false;
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
      ready: false,
    };
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
      this.spawnUnit(u.owner, u.defId, x, z, { starting: true });
    }
    this.blocked.fill(0);
    for (const e of this.state.entities) {
      if (e.kind === 'building') {
        const def = BUILDINGS[e.defId];
        const tx = Math.round(e.x / TILE_SIZE - def.footprint.w / 2);
        const tz = Math.round(e.z / TILE_SIZE - def.footprint.h / 2);
        stampFootprint(this.blocked, this.state.map, e.defId, tx, tz, 1);
      }
    }
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
    if (this.state.scenario.settings.victory === 'annihilation') {
      return 'Destroy every enemy unit and structure.';
    }
    return 'Destroy the enemy Command Post to secure the island.';
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
    opts: { starting?: boolean; free?: boolean } = {},
  ): Entity {
    const def = unitDef(defId);
    const hp = def.hp;
    const e = this.baseEntity('unit', defId, owner, x, z, hp);
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
    stampFootprint(this.blocked, this.state.map, s.defId, s.x, s.z, 1);
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
    let failed = 0;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const dest = destinations[i];
      const def = unitDef(e.defId);
      // A player order takes an engineer off its site; construction pauses.
      this.releaseBuildTarget(e);
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
          continue;
        }
        e.harvester.phase = 'seek';
      }
      const destTile = this.tileAt(dest.x, dest.z);
      if (
        destTile === null ||
        !canStandOn(this.state.map.width, this.state.map.height, this.state.map.terrain, destTile, def.moveClass) ||
        this.blocked[destTile]
      ) {
        failed++;
        e.order = null;
        e.path = [];
        e.state = 'idle';
        continue;
      }
      const path = this.findPathFor(e, dest.x, dest.z);
      if (!path) {
        failed++;
        e.order = null;
        e.path = [];
        e.state = 'idle';
        continue;
      }
      e.order = { type: attackMove ? 'attackMove' : 'move', x: dest.x, z: dest.z };
      e.path = path;
      e.pathIndex = 0;
      e.destX = dest.x;
      e.destZ = dest.z;
      e.state = path.length > 0 ? 'moving' : 'idle';
      e.blockedTicks = 0;
      // A new move order drops the old aim; the turret settles onto the hull
      // rather than tracking a target the unit has left behind.
      e.aimTargetId = 0;
      e.captureTargetId = 0;
      e.captureProgress = 0;
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
        level: 'warning',
        sound: 'denied',
      });
    } else {
      this.emit('orderAck', { team: owner, x, z, text: attackMove ? 'Attack-move ordered' : 'Moving', level: 'info' });
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
        ) ||
        this.blocked[destTile]
      ) {
        return false;
      }
    }
    // Tile tests are cheap and reject most of the walk; only a slot that
    // survives them is worth an actual route search.
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (unitDef(e.defId).domain === 'air' || e.harvester) continue;
      const dest = destinations[i];
      if (!this.findPathFor(e, dest.x, dest.z)) return false;
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
    // stands, even if it has not been charted as a silhouette.
    for (const c of this.state.contacts) {
      if (c.team !== team || c.kind !== 'building') continue;
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
    const target = this.getEntity(targetId);
    if (!target || target.hp <= 0) {
      this.emit('orderFailed', {
        team: owner,
        x: 0,
        z: 0,
        text: 'Target no longer exists.',
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
    for (const e of entities) {
      this.releaseBuildTarget(e);
      const weapons = entityWeapons(e);
      const usable = weapons.some(
        (w) => canWeaponTarget(w, target) && (!usesPrimaryAmmo(e, w) || e.ammo > 0),
      );
      if (!usable) {
        if (e.kind === 'building') continue;
        e.order = { type: 'move', x: target.x, z: target.z };
        const path = this.findPathFor(e, target.x, target.z);
        if (path) {
          e.path = path;
          e.pathIndex = 0;
          e.state = 'moving';
        }
        continue;
      }
      capable++;
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

  private commandRepair(owner: number, ids: number[], targetId: number): void {
    const target = this.getEntity(targetId);
    if (
      !target ||
      target.kind !== 'building' ||
      target.owner !== owner ||
      target.hp <= 0 ||
      target.construction ||
      target.hp >= target.maxHp
    ) {
      this.emit('orderFailed', {
        team: owner,
        x: target?.x ?? 0,
        z: target?.z ?? 0,
        text: 'Only a damaged friendly structure can be repaired.',
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
        text: 'Only riflemen and ATGM teams can garrison a building.',
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
    this.damageEntity(occupant, damage, attackerOwner, shooterId);
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
    const bdef = BUILDINGS[b.defId];
    if (!bdef?.produces) return { ok: false, reason: 'This facility does not produce units.' };
    if (!def) return { ok: false, reason: 'Unknown unit type.' };
    if (!this.canProduce(owner, defId)) {
      return { ok: false, reason: `${def.name} is not in ${p.name}'s roster.` };
    }
    // Resolve the facility's baseline slots through the roster so a national
    // variant keeps its family's production slot without a parallel list.
    if (!this.productionEntries(owner, b.defId).includes(defId)) {
      return { ok: false, reason: `${bdef.name} cannot produce ${def.name}.` };
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
    if (def.id === 'fighter') {
      const hasAirfield = this.state.entities.some(
        (e) => e.owner === owner && e.defId === 'airfield' && e.hp > 0 && !e.construction,
      );
      if (!hasAirfield) return { ok: false, reason: 'Requires an operational airfield.' };
    }
    if (def.id === 'corvette') {
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
    if (defId === 'commandPost') {
      const existing = this.state.entities.some(
        (e) => e.owner === owner && e.defId === 'commandPost' && e.hp > 0,
      );
      if (existing) return { ok: false, code: 'hq', reason: 'Only one Command Post per battlegroup.' };
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
    const check = checkPlacement(this.state.scenario, defId, tileX, tileZ, occupied);
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
        } else if (builder.state === 'building') {
          // Drifted off the site (separation or terrain): walk back on.
          this.walkEngineerToSite(builder, site);
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
    this.evaluateVictory();
  }

  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
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
      if (draw >= 0) supply += draw;
      else demand -= draw;
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
      const scan = BUILDINGS[e.defId]?.scanRadius ?? 0;
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
          const scan = BUILDINGS[e.defId]?.scanRadius ?? 0;
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
        const vision = entityVision(e);
        this.stampVision(fog, e.x, e.z, vision);
      }
    }
    for (let team = 0; team < 2; team++) this.refreshVisibleEntities(team, initial);
    this.cleanContacts();
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
        if (!hasLineOfSight(map, x, z, (tx + 0.5) * TILE_SIZE, (tz + 0.5) * TILE_SIZE)) continue;
        fog[i] = 2;
      }
    }
  }

  private refreshVisibleEntities(team: number, initial = false): void {
    const previous = this.visible[team] ?? new Set<number>();
    const set = new Set<number>();
    const fog = this.state.fog[team];
    const map = this.state.map;
    const gridBrownout = new Map<number, boolean>();
    const radars: Array<{ x: number; z: number; radius: number; owner: number }> = [];
    for (const e of this.state.entities) {
      if (e.hp <= 0 || e.kind !== 'building' || e.construction) continue;
      if (this.teamOf(e.owner) !== team) continue;
      const scan = BUILDINGS[e.defId]?.scanRadius ?? 0;
      if (scan <= 0) continue;
      let brownout = gridBrownout.get(e.owner);
      if (brownout === undefined) {
        brownout = this.powerStatus(e.owner).brownout;
        gridBrownout.set(e.owner, brownout);
      }
      if (brownout) continue;
      radars.push({ x: e.x, z: e.z, radius: scan, owner: e.owner });
    }
    let radarContacts = 0;
    let radarSource: { x: number; z: number; owner: number } | null = null;
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
      const tx = Math.floor(e.x / TILE_SIZE);
      const tz = Math.floor(e.z / TILE_SIZE);
      if (!inBounds(map.width, map.height, tx, tz)) continue;
      const idx = tileIndex(map.width, tx, tz);
      const fogValue = this.state.scenario.settings.fog ? fog[idx] : 2;
      if (fogValue !== 2 && !radar) continue;
      // Aircraft are large, noisy and above the canopy: forest concealment
      // applies to ground units, not to any airframe.
      if (!radar && e.kind === 'unit' && UNITS[e.defId]?.domain !== 'air') {
        const terrain = this.state.map.terrain[idx] as TerrainId;
        const concealment = TERRAIN[terrain].concealment;
        if (concealment > 0.5) {
          // Concealed units inside forest are only spotted at close range.
          let close = false;
          for (const source of this.state.entities) {
            if (source.hp <= 0 || source.owner < 0 || this.teamOf(source.owner) !== team) continue;
            if (dist(source.x, source.z, e.x, e.z) <= 4.5 * TILE_SIZE) {
              close = true;
              break;
            }
          }
          if (!close) continue;
        }
      }
      set.add(e.id);
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
    } else {
      this.state.contacts.push({
        team,
        entityId: e.id,
        x: e.x,
        z: e.z,
        tick: this.state.tick,
        defId: e.defId,
        kind: e.kind,
      });
    }
  }

  private cleanContacts(): void {
    const stale = this.state.tick - 20 * 30;
    this.state.contacts = this.state.contacts.filter(
      (c) => c.tick > stale && this.state.entities.some((e) => e.id === c.entityId && e.hp > 0),
    );
  }

  isVisibleTo(team: number, entityId: number): boolean {
    if (!this.state.scenario.settings.fog) return true;
    return this.visible[team]?.has(entityId) ?? false;
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
      e.suppression = Math.max(0, e.suppression - dt * 0.12);
      e.blockedTicks++;
      const def = unitDef(e.defId);
      if (this.updateGarrisonOrder(e)) continue;
      if (def.domain === 'air') {
        this.updateAircraft(e, def, dt);
        continue;
      }
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
            text: `Corvette reloaded (${e.ammo}/${e.maxAmmo})`,
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
          text: 'Corvette out of missiles — returning to shipyard',
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
    // A full hopper always seeks a refinery, even after a player move order.
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
        if (dist(e.x, e.z, (h.oreTileX + 0.5) * TILE_SIZE, (h.oreTileZ + 0.5) * TILE_SIZE) < 3.5) {
          h.phase = 'mining';
          h.timer = 0;
          e.path = [];
          e.state = 'harvesting';
          e.destX = e.x;
          e.destZ = e.z;
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
    if (e.order?.type === 'move' || e.order?.type === 'attackMove') {
      // Let explicit movement execute, then resume automatic harvesting. A
      // move to a refinery keeps its offload phase so the hopper empties first.
      if (e.path.length === 0) {
        if (h.phase !== 'toRefinery') h.phase = 'seek';
        e.order = null;
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
      const path = this.findPathFor(e, (tx + 0.5) * TILE_SIZE, (tz + 0.5) * TILE_SIZE);
      if (path) {
        h.oreTileX = tx;
        h.oreTileZ = tz;
        e.path = path;
        e.pathIndex = 0;
        e.destX = (tx + 0.5) * TILE_SIZE;
        e.destZ = (tz + 0.5) * TILE_SIZE;
        e.state = 'moving';
        return true;
      }
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
      const range = weapon.range * TILE_SIZE + 3;
      const minimum = (weapon.minRange ?? 0) * TILE_SIZE;
      const d = dist(e.x, e.z, target.x, target.z);
      const spotted = !weapon.indirect || this.isVisibleTo(this.teamOf(e.owner), target.id);
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
        } else if (e.stance !== 'hold' && e.blockedTicks > 4) {
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
      if (
        !target ||
        target.kind !== 'building' ||
        target.hp <= 0 ||
        target.owner !== e.owner ||
        target.construction ||
        target.hp >= target.maxHp
      ) {
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
        target.hp = Math.min(
          target.maxHp,
          target.hp + target.maxHp * ENGINEER_REPAIR_RATE * dt,
        );
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
        usable = true;
        weaponRange = Math.max(weaponRange, w.range);
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
      const range = w.range * TILE_SIZE + 3;
      if (dist(e.x, e.z, best.x, best.z) > range) return;
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
    if (d > weapon.range * TILE_SIZE + 4) return;
    if (d < (weapon.minRange ?? 0) * TILE_SIZE) return;
    if (weapon.indirect && e.state === 'moving') return;
    // Indirect fire arcs over cover, but the firing team still needs a spotter
    // to know where the target is. Reconnaissance therefore enables artillery
    // instead of being cosmetic.
    if (weapon.indirect && !this.isVisibleTo(this.teamOf(e.owner), target.id)) return;
    if (
      !weapon.indirect &&
      e.kind !== 'building' &&
      shooterDef?.domain !== 'air' &&
      !hasLineOfSight(this.state.map, e.x, e.z, target.x, target.z)
    ) {
      return;
    }
    if (usesPrimaryAmmo(e, weapon)) {
      if (e.ammo <= 0) return;
      e.ammo--;
    }
    e.cooldown = weapon.cooldown;
    // A shot always leaves the barrel on bearing, even if the turret was still
    // traversing, so the projectile origin and direction cannot disagree.
    e.turretFacing = angleTo(e.x, e.z, target.x, target.z);
    e.aimTargetId = target.id;
    const accuracyPenalty = e.suppression * 0.32;
    const firingDef = UNITS[e.defId];
    const movingPenalty = firingDef?.domain === 'land' && e.state === 'moving' ? 0.12 : 0;
    const hit = this.rng.next() < clamp(weapon.accuracy - accuracyPenalty - movingPenalty, 0.05, 1);
    const spread = hit ? 0 : (1.5 + this.rng.next() * 2.5) * TILE_SIZE;
    const scatterAngle = this.rng.next() * Math.PI * 2;
    const start = this.muzzlePoint(e);
    const targetHeight =
      entityTargetClass(target) === 'air' ? AIRCRAFT_ALTITUDE : this.heightAt(target.x, target.z) + 1.3;
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
      homing: weapon.projectile === 'missile' || weapon.projectile === 'sam',
      damage: weapon.damage,
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
      sound: weapon.projectile === 'sam' ? 'sam' : weapon.projectile === 'missile' ? 'missile' : weapon.projectile === 'shell' ? 'cannon' : 'rifle',
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

  private findPathFor(e: Entity, tx: number, tz: number): import('./types').PathPoint[] | null {
    const def = unitDef(e.defId);
    if (def.domain === 'air') {
      return [{ x: tx, z: tz }];
    }
    const nav = this.navFor(e);
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
    return findPath(nav, startX, startZ, goalX, goalZ);
  }

  private navFor(e: Entity): NavGrid {
    return {
      width: this.state.map.width,
      height: this.state.map.height,
      terrain: this.state.map.terrain,
      elevation: this.state.map.elevation,
      moveClass: unitDef(e.defId).moveClass,
      occupied: this.blocked,
    };
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
    if (d <= arrivalRadius) {
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
    const turn = def.turnRate * dt;
    e.facing = turnToward(e.facing, desired, turn);
    const diff = Math.abs(normalizeAngle(desired - e.facing));
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
    const speed = def.speed * TILE_SIZE * Math.max(0.08, turnFactor) * terrainFactor * suppressionFactor;
    const step = Math.min(d, speed * dt);
    // Move along the path rather than along the current facing. This prevents
    // ships and vehicles from cutting corners into impassable terrain while
    // their visual turning still takes time. A crowded lane is walked around
    // when there is room, and straight through when there is not.
    const steer = this.steerAroundUnits(e, def, desired);
    let nx = e.x + Math.cos(desired) * step;
    let nz = e.z + Math.sin(desired) * step;
    if (steer !== desired) {
      const sx = e.x + Math.cos(steer) * step;
      const sz = e.z + Math.sin(steer) * step;
      if (this.canOccupy(e, sx, sz)) {
        nx = sx;
        nz = sz;
      }
    }
    if (this.canOccupy(e, nx, nz)) {
      e.x = nx;
      e.z = nz;
      e.blockedTicks = 0;
    } else if (this.canOccupy(e, nx, e.z)) {
      // Slip along a wall instead of stopping dead against it: a step on one
      // axis alone clears corners the smoothed path cuts across.
      e.x = nx;
      e.blockedTicks = 0;
    } else if (this.canOccupy(e, e.x, nz)) {
      e.z = nz;
      e.blockedTicks = 0;
    } else {
      // Destination blocked by a new structure: try to re-route.
      if (e.blockedTicks > 8) {
        const repath = this.findPathFor(e, e.destX, e.destZ);
        if (repath) {
          e.path = repath;
          e.pathIndex = 0;
          e.blockedTicks = 0;
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
   * Cheap local avoidance for ground movers: if another unit sits in the lane
   * ahead, bias the heading to one side rather than walking into it. Purely
   * geometric and tie-broken by entity id, so replays stay bit-identical.
   */
  private steerAroundUnits(e: Entity, def: UnitDef, desired: number): number {
    if (def.domain === 'air') return desired;
    const fx = Math.cos(desired);
    const fz = Math.sin(desired);
    let bestLateral: number | null = null;
    let bestLane = 1;
    let bestAhead = Infinity;
    for (const other of this.state.entities) {
      if (other === e || other.kind !== 'unit' || other.hp <= 0 || other.garrisonId) continue;
      const od = unitDef(other.defId);
      if (od.domain !== def.domain) continue;
      // Hostiles are targets, not traffic: swerving around them would break off
      // every engagement. Nor does a moving column need to dodge itself.
      if (this.isHostile(e.owner, other.owner)) continue;
      if (other.state === 'moving') continue;
      const dx = other.x - e.x;
      const dz = other.z - e.z;
      // Only the last couple of metres of the lane: this is about not walking
      // into someone standing still, not about re-planning the route.
      const reach = (def.radius + od.radius) * 2.4;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > reach) continue;
      const lateral = -dx * fz + dz * fx;
      const lane = (def.radius + od.radius) * 1.15;
      if (Math.abs(lateral) >= lane) continue;
      if (ahead < bestAhead) {
        bestAhead = ahead;
        bestLateral = lateral;
        bestLane = lane;
      }
    }
    if (bestLateral === null) return desired;
    // Steer to the roomier side, and harder the more squarely the obstacle sits
    // in the lane.
    const side = bestLateral === 0 ? (e.id % 2 === 0 ? 1 : -1) : bestLateral > 0 ? -1 : 1;
    const centrality = 1 - Math.min(1, Math.abs(bestLateral) / bestLane);
    return desired + side * (0.4 + 0.7 * centrality);
  }

  private arrive(e: Entity): void {
    e.path = [];
    e.pathIndex = 0;
    e.destX = e.x;
    e.destZ = e.z;
    e.guardX = e.x;
    e.guardZ = e.z;
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
    if (this.blocked[idx]) return false;
    const cost = moveCost(
      this.state.map.width,
      this.state.map.height,
      this.state.map.terrain,
      this.state.map.elevation,
      tx,
      tz,
      Math.floor(e.x / TILE_SIZE),
      Math.floor(e.z / TILE_SIZE),
      def.moveClass,
    );
    return Number.isFinite(cost);
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
        const minDist = (da.radius + db.radius) * 0.78;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minDist * minDist || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        // Within a force, a unit on the move gives way to one holding position,
        // so traffic threads between idle formations instead of shoving them
        // aside. Contact with the enemy stays a shared push: that is combat,
        // not queue discipline.
        const aMoving = a.state === 'moving';
        const bMoving = b.state === 'moving';
        const sameSide = !this.isHostile(a.owner, b.owner);
        const aShare = !sameSide || aMoving === bMoving ? 0.5 : aMoving ? 1 : 0;
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
      const target = p.homing && p.targetId ? this.getEntity(p.targetId) : undefined;
      if (target && target.hp > 0) {
        p.tx = target.x;
        p.tz = target.z;
        p.ty =
          entityTargetClass(target) === 'air' ? AIRCRAFT_ALTITUDE : this.heightAt(target.x, target.z) + 1.3;
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

  private impact(p: Projectile): void {
    const weapon = WEAPONS[p.weaponId];
    if (!weapon) return;
    const radius = Math.max(1.4, (p.splash > 0 ? p.splash * TILE_SIZE : 1.6));
    const direct = p.targetId ? this.getEntity(p.targetId) : undefined;
    let hitCount = 0;
    for (const e of this.state.entities) {
      if (e.hp <= 0) continue;
      if (!this.isAttackable(p.owner, e)) continue;
      // Garrisoned infantry are not exposed targets; hits on their shelter
      // pass through damageGarrison below.
      if (e.kind === 'unit' && e.garrisonId) continue;
      const targetClass = entityTargetClass(e);
      if (!weapon.targets.includes(targetClass)) continue;
      const d = dist(p.x, p.z, e.x, e.z);
      const effectiveRadius = radius + (e.kind === 'building' ? 4 : unitDef(e.defId).radius * 0.7);
      if (d > effectiveRadius) continue;
      if (direct && e.id !== direct.id && d > radius) continue;
      const falloff = p.splash > 0 ? 1 - 0.55 * Math.min(1, d / radius) : 1;
      const damage = computeDamage(p.damage * falloff, weapon.multipliers, entityArmour(e));
      if (damage <= 0) continue;
      this.damageEntity(e, damage, p.owner, p.shooterId);
      if (e.kind === 'building' && BUILDINGS[e.defId]?.garrison) {
        this.damageGarrison(e, weapon, p.damage * falloff, p.id, p.owner, p.shooterId, e.id === direct?.id);
      }
      e.suppression = Math.min(1, e.suppression + p.suppression * falloff);
      hitCount++;
    }
    this.emit(p.splash > 0 ? 'explosion' : 'impact', {
      team: p.owner,
      x: p.x,
      z: p.z,
      text: '',
      sound: p.splash > 0 ? 'explosion' : 'impact',
      level: 'info',
    });
    void hitCount;
  }

  private damageEntity(target: Entity, damage: number, attackerOwner: number, shooterId: number): void {
    if (target.hp <= 0) return;
    // Capture-only objectives are never damaged; even splash leaves them intact.
    if (isIndestructibleStructure(target.defId)) return;
    target.hp -= damage;
    target.lastHitTick = this.state.tick;
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
        level: this.teamOf(target.owner) === this.teamOf(this.localPlayerId) ? 'critical' : 'info',
        sound: 'explosion',
      });
      const def = buildingDef(target.defId);
      const tx = Math.round(target.x / TILE_SIZE - def.footprint.w / 2);
      const tz = Math.round(target.z / TILE_SIZE - def.footprint.h / 2);
      stampFootprint(this.blocked, this.state.map, target.defId, tx, tz, 0);
    }
    const shooter = this.getEntity(shooterId);
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
    if (!this.state.entities.some((e) => e.hp <= 0)) return;
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
        stampFootprint(this.blocked, this.state.map, e.defId, tx, tz, 0);
      }
      this.byId.delete(e.id);
    }
    this.state.entities = this.state.entities.filter((e) => e.hp > 0);
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
      if (e.aimTargetId && !this.byId.has(e.aimTargetId)) e.aimTargetId = 0;
      if (e.healTargetId && !this.byId.has(e.healTargetId)) e.healTargetId = 0;
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
    if (scenario.settings.timeLimitSec !== null) {
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
    this.emit(result === 'victory' ? 'victory' : result === 'defeat' ? 'defeat' : 'notice', {
      team: this.localPlayerId,
      x: 0,
      z: 0,
      text:
        result === 'victory'
          ? 'Island secured. Enemy command eliminated.'
          : result === 'defeat'
            ? 'Command Post lost. Operation failed.'
            : 'Operation ended in a draw.',
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
      },
      localPlayerId: this.localPlayerId,
    };
  }

  static fromSave(raw: unknown, opts: GameOptions = {}): Game {
    if (!raw || typeof raw !== 'object') throw new SaveFormatError('Save file is not valid JSON object data.');
    const data = raw as Partial<SaveData> & { state?: Record<string, unknown> };
    if (data.format !== SAVE_FORMAT) throw new SaveFormatError('This is not a Modern Combined Arms battle save.');
    if (data.version !== SAVE_FORMAT_VERSION) {
      throw new SaveFormatError(
        `Save version ${String(data.version)} is not supported by this build (expected ${SAVE_FORMAT_VERSION}).`,
      );
    }
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
    const map = savedState.map as unknown as GameState['map'];
    game.state = {
      ...state,
      scenario: savedScenario,
      map: map && Array.isArray(map.terrain)
        ? {
            width: map.width,
            height: map.height,
            terrain: Uint8Array.from(map.terrain),
            elevation: Uint8Array.from(map.elevation),
            ore: Uint16Array.from(map.ore),
            maxOre: Uint16Array.from(map.maxOre),
          }
        : createRuntimeMap(savedScenario),
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
      ready: true,
    };
    game.rng = new Rng(game.state.seed);
    game.rng.setState(game.state.rngState);
    game.blocked = new Uint8Array(savedScenario.width * savedScenario.height);
    game.byId = new Map();
    game.state.entities.sort((a, b) => a.id - b.id);
    for (const e of game.state.entities) {
      e.hp = Number(e.hp);
      e.buildTargetId = Number(e.buildTargetId ?? 0);
      e.healTargetId = Number(e.healTargetId ?? 0);
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

  stateHash(): string {
    const parts: string[] = [];
    parts.push(`t=${this.state.tick}`, `r=${this.state.rngState}`, `v=${this.state.victory}`);
    for (const p of this.state.players) {
      parts.push(`p${p.id}:${p.mats.toFixed(2)}:${p.req.toFixed(2)}:${p.stats.unitsLost}:${p.stats.kills}`);
    }
    for (const e of [...this.state.entities].sort((a, b) => a.id - b.id)) {
      parts.push(
        [
          'e',
          e.id,
          e.defId,
          e.owner,
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
          e.suppression.toFixed(2),
          // Repair progress now depends on how recently a structure was hit, so
          // the hash has to cover it for save/load comparisons to be faithful.
          e.lastHitTick,
          e.healTargetId,
          e.garrisonId,
          e.captureTargetId,
          e.captureProgress.toFixed(3),
        ].join(','),
      );
    }
    for (const pr of [...this.state.projectiles].sort((a, b) => a.id - b.id)) {
      parts.push(`j${pr.id}:${pr.x.toFixed(1)}:${pr.z.toFixed(1)}:${pr.targetId}`);
    }
    return parts.join('|');
  }

  get elapsedSeconds(): number {
    return this.state.tick / TICK_RATE;
  }
}

const TICKS_PER_SECOND = TICK_RATE;

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
