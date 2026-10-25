/* ------------------------------------------------------------------ */
/* Domains, movement, armour                                           */
/* ------------------------------------------------------------------ */

export type Domain = 'land' | 'air' | 'naval';
export type MoveClass = 'foot' | 'wheeled' | 'tracked' | 'naval' | 'air';
export type ArmourClass = 'infantry' | 'light' | 'heavy' | 'structure' | 'air' | 'naval';
export type TargetClass = 'ground' | 'air' | 'naval' | 'structure';
export type WeaponFx = 'bullet' | 'shell' | 'missile' | 'sam' | 'cannon';
export type EntityKind = 'unit' | 'building';
export type Stance = 'aggressive' | 'defensive' | 'hold';
export type VictoryState = 'playing' | 'victory' | 'defeat' | 'draw';

/* ------------------------------------------------------------------ */
/* Definitions (authored data)                                         */
/* ------------------------------------------------------------------ */

export interface WeaponDef {
  id: string;
  name: string;
  damage: number;
  /** Range in tiles. */
  range: number;
  /** Seconds between shots. */
  cooldown: number;
  accuracy: number;
  projectile: WeaponFx;
  /** Projectile speed in tiles/second. */
  speed: number;
  /** Splash radius in tiles (0 = single target). */
  splash?: number;
  targets: TargetClass[];
  multipliers: Partial<Record<ArmourClass, number>>;
  suppression: number;
  /** Fires even while moving without an accuracy penalty. */
  stabilised?: boolean;
  /** Anti-air capable weapons can detect and fire at aircraft. */
  antiAir?: boolean;
}

export interface Cost {
  mats: number;
  req: number;
}

/**
 * Weapon hardpoint in unit-local units: +X forward, +Z to the right, Y up.
 * Distances are world units from the entity origin, tuned to the rendered mesh
 * scale so a shot starts where the barrel ends. `turreted` hardpoints follow
 * the turret angle; fixed-forward weapons follow the hull heading.
 */
export interface MuzzleHardpoint {
  forward: number;
  lateral?: number;
  height: number;
  turreted?: boolean;
}

export interface UnitDef {
  id: string;
  name: string;
  shortName: string;
  role: string;
  domain: Domain;
  moveClass: MoveClass;
  /** Speed in tiles per second. */
  speed: number;
  /** Turn rate in radians per second. */
  turnRate: number;
  /** Collision / visual radius in world units. */
  radius: number;
  /** Vision radius in tiles. */
  vision: number;
  hp: number;
  armour: ArmourClass;
  cost: Cost;
  buildTime: number;
  producedBy: string[];
  weapons: string[];
  ammo?: number;
  /** Fuel in seconds of flight. Aircraft only. */
  fuel?: number;
  canBuild?: boolean;
  canCapture?: boolean;
  /** Eligible to occupy a garrisonable building. Infantry only by design. */
  canGarrison?: boolean;
  /** Radius in tiles within which this unit must remain near its parent structure. */
  homeRadius?: number;
  description: string;
  icon: string;
  hotkey?: string;
  /** Combat domain used for target-class checks. */
  targetClass: TargetClass;
  /** Where this unit's weapons fire from. Absent units have no weapons. */
  muzzle?: MuzzleHardpoint;
  /** Turret traverse rate in radians per second. Absent means no rotating turret. */
  turretRate?: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  shortName: string;
  role: string;
  footprint: { w: number; h: number };
  hp: number;
  armour: ArmourClass;
  cost: Cost;
  buildTime: number;
  vision: number;
  /** Production domain this structure enables. */
  produces?: Domain;
  /** Unit ids this structure is allowed to produce. */
  productionList?: string[];
  /** Drops off harvested materials. */
  refinery?: boolean;
  /** Aircraft recovery point. */
  airfield?: boolean;
  /** Naval build / repair point. Requires navigable water adjacency. */
  shipyard?: boolean;
  /** Headquarters buildings are victory objectives. */
  commandPost?: boolean;
  /** Provides the tactical minimap while operational and powered. */
  radar?: boolean;
  /** Secondary-resource income per second while owned. */
  reqPerSec?: number;
  /** Passive material income per second while owned and operational. */
  matsPerSec?: number;
  /**
   * Capturable strategic objective. Combat Engineers capture it through the
   * shared capture order; effects only apply while owned and operational.
   */
  capturable?: boolean;
  /**
   * A capture-only objective: weapons cannot target it and damage is ignored,
   * so it changes hands only through an engineer's capture order.
   */
  indestructible?: boolean;
  /** Authored-only structure: the editor places it, players cannot build it. */
  authoredOnly?: boolean;
  /**
   * Reconnaissance objective. While owned and operational it reveals hostile
   * entities inside this radius in tiles, ignoring terrain masking.
   */
  scanRadius?: number;
  /** Occupiable shelter and its protection class. Absent means not garrisonable. */
  garrison?: GarrisonDef;
  /** Must be adjacent to navigable deep water. */
  requiresWater?: boolean;
  /**
   * Net grid power: positive structures generate, negative structures draw.
   * Absent means zero. A deficit slows construction and production for the
   * owner until supply catches up.
   */
  power?: number;
  weapons?: string[];
  /** Radians per second a mounted weapon traverses, if it has a turret. */
  turretRate?: number;
  description: string;
  icon: string;
  hotkey?: string;
  /** Can be placed on water like a platform (currently unused by slice content). */
  waterStructure?: boolean;
}

export interface GarrisonDef {
  /** Maximum infantry entities inside at once. */
  capacity: number;
  /** Fraction of incoming damage the structure blocks for its occupants (0..0.9). */
  protection: number;
  /** Fraction of a weapon's suppression that reaches the occupants through the cover. */
  exposure: number;
  /** Occupants allowed to fire through the building's firing positions at once. */
  firingSlots: number;
}

export interface FactionDef {
  id: string;
  name: string;
  shortName: string;
  color: string;
  accent: string;
  blurb: string;
  units: string[];
  buildings: string[];
}

/* ------------------------------------------------------------------ */
/* Orders and entity runtime state                                     */
/* ------------------------------------------------------------------ */

export type OrderType =
  | 'move'
  | 'attackMove'
  | 'attack'
  | 'stop'
  | 'hold'
  | 'guard'
  | 'return'
  | 'harvest'
  | 'capture'
  | 'repair'
  | 'patrol'
  | 'garrison';

export interface Order {
  type: OrderType;
  x?: number;
  z?: number;
  targetId?: number;
  /** Patrol endpoints. */
  x2?: number;
  z2?: number;
  /** Set when an automatically issued order should revert to guard duty. */
  auto?: boolean;
}

export interface PathPoint {
  x: number;
  z: number;
}

export interface QueueItem {
  defId: string;
  /** Seconds remaining. */
  remaining: number;
  total: number;
}

export type EntityState =
  | 'idle'
  | 'moving'
  | 'attacking'
  | 'harvesting'
  | 'delivering'
  | 'rearming'
  | 'grounded'
  | 'takingOff'
  | 'returning'
  | 'capturing'
  | 'constructing'
  /** Engineer standing at a construction site and working on it. */
  | 'building'
  /** Combat Engineer restoring a completed friendly structure. */
  | 'repairing'
  /** Medic treating one wounded friendly infantry unit. */
  | 'healing'
  /** Infantry inside a garrisonable building, not exposed on the map. */
  | 'garrisoned'
  | 'dead';

export interface HarvesterState {
  phase: 'seek' | 'toOre' | 'mining' | 'toRefinery' | 'unloading';
  ore: number;
  timer: number;
  oreTileX: number;
  oreTileZ: number;
  refineId: number;
}

export interface AircraftState {
  homeId: number;
  landed: boolean;
  /** Seconds remaining until full rearm/refuel. */
  serviceTimer: number;
  serviceTotal: number;
  returningHome: boolean;
}

export interface Entity {
  id: number;
  kind: EntityKind;
  defId: string;
  owner: number;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  facing: number;
  turretFacing: number;
  state: EntityState;
  order: Order | null;
  path: PathPoint[];
  pathIndex: number;
  /** Ticks until the current weapon can fire again. */
  cooldown: number;
  /** Ship missile reload accumulator, seconds. */
  reloadTimer?: number;
  targetId: number;
  ammo: number;
  maxAmmo: number;
  fuel: number;
  maxFuel: number;
  stance: Stance;
  suppression: number;
  lastHitTick: number;
  kills: number;
  /** Buildings: 0..1 construction progress; 1 for complete. */
  buildProgress: number;
  construction: boolean;
  queue: QueueItem[];
  rallyX: number;
  rallyZ: number;
  harvester?: HarvesterState;
  aircraft?: AircraftState;
  /** Set for aircraft after they are ordered to return home. */
  homeId: number;
  patrolX?: number;
  patrolZ?: number;
  /** Movement destination used to detect arrival / unreachable feedback. */
  destX: number;
  destZ: number;
  /** Guard position to return to after a short auto-engagement. */
  guardX: number;
  guardZ: number;
  /** Ticks since the unit last had a valid path (diagnostics). */
  blockedTicks: number;
  /**
   * Entity the turret is currently laid on. Presentation-only aim state: it
   * never affects damage, range or target selection, and is cleared as soon as
   * that entity is gone. Saves written before this field existed load as 0.
   */
  aimTargetId: number;
  captureTargetId: number;
  captureProgress: number;
  /**
   * Wounded friendly infantry this medic is treating, or 0. Only one target
   * is treated at a time; the field is authoritative simulation state so a
   * save resumes the same treatment.
   */
  healTargetId: number;
  /**
   * Engineer assignment: id of the construction site this engineer is
   * responsible for, or 0. A site only advances while its assigned engineer
   * is on location, so calling the engineer away pauses construction. Saved
   * with the entity; older saves load as 0 and the engineer is re-assigned.
   */
  buildTargetId: number;
  /** Building id this infantryman occupies, or 0 when exposed. */
  garrisonId: number;
  /** AI bookkeeping (serialised so saves remain faithful). */
  aiGroup: number;
  aiRole: string;
}

/* ------------------------------------------------------------------ */
/* Projectiles and events                                              */
/* ------------------------------------------------------------------ */

export interface Projectile {
  id: number;
  owner: number;
  shooterId: number;
  weaponId: string;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  targetId: number;
  speed: number;
  splash: number;
  kind: WeaponFx;
  homing: boolean;
  damage: number;
  armourMul: Partial<Record<ArmourClass, number>>;
  suppression: number;
  seed: number;
}

export type SimEventType =
  | 'shot'
  | 'impact'
  | 'explosion'
  | 'unitBuilt'
  | 'buildingComplete'
  | 'buildingPlaced'
  | 'unitLost'
  | 'buildingLost'
  | 'capture'
  | 'income'
  | 'alert'
  | 'orderFailed'
  | 'orderAck'
  | 'aircraftReturn'
  | 'aircraftReady'
  | 'victory'
  | 'defeat'
  | 'notice';

export interface SimEvent {
  seq: number;
  tick: number;
  type: SimEventType;
  team: number;
  x: number;
  z: number;
  text: string;
  /** Optional world height for effects whose origin is above the ground plane. */
  y?: number;
  entityId?: number;
  defId?: string;
  sound?: string;
  /** Alert priority for the UI layer. */
  level?: 'info' | 'warning' | 'critical' | 'success';
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export type Command =
  | { type: 'move'; team: number; ids: number[]; x: number; z: number; attackMove?: boolean }
  | { type: 'attack'; team: number; ids: number[]; targetId: number }
  | { type: 'stop'; team: number; ids: number[] }
  | { type: 'hold'; team: number; ids: number[] }
  | { type: 'stance'; team: number; ids: number[]; stance: Stance }
  | { type: 'return'; team: number; ids: number[] }
  | { type: 'capture'; team: number; ids: number[]; targetId: number }
  | { type: 'repair'; team: number; ids: number[]; targetId: number }
  | { type: 'garrison'; team: number; ids: number[]; targetId: number }
  | { type: 'ungarrison'; team: number; ids: number[] }
  | { type: 'produce'; team: number; buildingId: number; defId: string }
  | { type: 'cancelProduction'; team: number; buildingId: number; index: number }
  | { type: 'reorderProduction'; team: number; buildingId: number; defId: string; beforeDefId?: string }
  | { type: 'placeBuilding'; team: number; builderId?: number; defId: string; tileX: number; tileZ: number }
  | { type: 'setRally'; team: number; buildingId: number; x: number; z: number };

/* ------------------------------------------------------------------ */
/* Runtime state                                                       */
/* ------------------------------------------------------------------ */

/** Derived grid state for one player; never stored, always recomputed. */
export interface PowerStatus {
  supply: number;
  demand: number;
  /** supply / demand capped at 1; 1 when nothing draws. */
  ratio: number;
  brownout: boolean;
}

export interface PlayerState {
  id: number;
  name: string;
  factionId: string;
  team: number;
  isAI: boolean;
  mats: number;
  req: number;
  /** Convenience counters for UI and diagnostics. */
  stats: {
    matsGathered: number;
    unitsBuilt: number;
    unitsLost: number;
    kills: number;
    buildingsBuilt: number;
  };
  incomeHistory: number[];
  defeated: boolean;
  relayCount: number;
}

export type AIStrategy = 'armour' | 'infantry' | 'air' | 'economy' | 'pressure';

/** Selectable opponent strength; never changes resources, vision or rules. */
export type AIDifficulty = 'recruit' | 'veteran' | 'elite';

export interface AIControlState {
  nextThinkTick: number;
  phase: 'opening' | 'build' | 'pressure' | 'assault' | 'defend';
  attackWave: number;
  lastWaveTick: number;
  /** Last known hostile position; only written from vision or contacts. */
  targetBaseX: number;
  targetBaseZ: number;
  targetKnown: boolean;
  groupCounter: number;
  desiredArmy: number;
  lastDecision: string;
  /** Serialised AI RNG-independent decision timer. */
  nextBuildTick: number;
  scouted: boolean;
  /** Match seed for this commander; selects strategy and drives its RNG. */
  aiSeed: number;
  /** Saved random stream, so a reload continues the same commander. */
  aiRng: number;
  /** Opening the commander is executing, fixed for the match. */
  strategy: AIStrategy;
  /** Selected opponent strength, fixed for the match and saved with it. */
  difficulty: AIDifficulty;
  /** Tick of the most recent contact, used to expire stale target data. */
  lastContactTick: number;
  /** Tick of the last reconnaissance order, to avoid thrashing scouts. */
  lastScoutTick: number;
  /** Construction currently being watched for measurable progress. */
  activeSiteId: number;
  activeSiteProgress: number;
  activeSiteTick: number;
  /** Last garrison entry or release decision, to avoid thrashing. */
  lastGarrisonTick?: number;
  /** Last strategic-objective capture attempt, to avoid retrying a blocked route. */
  lastObjectiveTick?: number;
}

export interface RuntimeMap {
  width: number;
  height: number;
  terrain: Uint8Array;
  elevation: Uint8Array;
  ore: Uint16Array;
  maxOre: Uint16Array;
}

export interface GameState {
  scenario: import('./scenario').Scenario;
  map: RuntimeMap;
  tick: number;
  seed: number;
  rngState: number;
  nextEntityId: number;
  nextProjectileId: number;
  eventSeq: number;
  players: PlayerState[];
  entities: Entity[];
  projectiles: Projectile[];
  events: SimEvent[];
  victory: VictoryState;
  startedAtTick: number;
  /** Per-team explored / visible fog: 0 = unexplored, 1 = explored, 2 = visible. */
  fog: Uint8Array[];
  ai: AIControlState;
  /** Records of last known enemy sightings per team, keyed by entity id. */
  contacts: ContactRecord[];
  commandCount: number;
  /** True once the scenario has been initialised fully. */
  ready: boolean;
}

export interface ContactRecord {
  team: number;
  entityId: number;
  x: number;
  z: number;
  tick: number;
  defId: string;
  kind: EntityKind;
}

export interface GameStats {
  entities: number;
  units: number;
  buildings: number;
  projectiles: number;
}
