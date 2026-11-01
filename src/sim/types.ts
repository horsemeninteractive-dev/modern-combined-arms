/* ------------------------------------------------------------------ */
/* Domains, movement, armour                                           */
/* ------------------------------------------------------------------ */

export type Domain = 'land' | 'air' | 'naval';
export type MoveClass = 'foot' | 'wheeled' | 'tracked' | 'naval' | 'air';
/**
 * `support` covers unarmed working vehicles (engineer, harvester). They are
 * armoured enough that anti-tank rounds still hurt, but they must not take the
 * `heavy` bonus that is meant for fighting hulls, or a single tank deletes an
 * economy unit in four shells.
 */
export type ArmourClass =
  | 'infantry'
  | 'light'
  | 'heavy'
  | 'support'
  | 'structure'
  | 'air'
  | 'naval';
export type TargetClass = 'ground' | 'air' | 'naval' | 'structure';
export type WeaponFx = 'bullet' | 'shell' | 'missile' | 'sam' | 'cannon' | 'torpedo';
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
  /**
   * Indirect-fire weapon: the projectile arcs over cover and does not require
   * line of sight. The target must still be visible to the firing team, so a
   * spotter or radar is required.
   */
  indirect?: boolean;
  /** Minimum range in tiles. Absent means the weapon can fire at point blank. */
  minRange?: number;
  /**
   * Anti-submarine weapon. It can only engage a submarine while that boat is
   * dived, and cannot be used against surface ships.
   */
  asw?: boolean;
  /** Runs at the waterline instead of the deck, as a torpedo does. */
  underwater?: boolean;
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
  /**
   * Baseline slot this national variant substitutes, e.g. `tank`. A roster
   * replacement swaps the slot without changing the facility's production
   * list, and the UI/AI resolve the variant through this field.
   */
  variantOf?: string;
  /** Combat domain used for target-class checks. */
  targetClass: TargetClass;
  /** Where this unit's weapons fire from. Absent units have no weapons. */
  muzzle?: MuzzleHardpoint;
  /** Turret traverse rate in radians per second. Absent means no rotating turret. */
  turretRate?: number;
  /**
   * Field repair support. While stationary, the unit restores nearby damaged
   * friendly mechanical units at the definition's rate, paid for in materials.
   * Infantry and structures are handled by the medic and engineer instead.
   */
  repair?: RepairDef;
  /**
   * Diesel-electric boat that can submerge. Battery endurance, underwater
   * speed and the detection radius that still sees a periscope are authored
   * here so the simulation and HUD read the same numbers.
   */
  submarine?: SubmarineDef;
  /** Passive sonar radius in tiles. Detects dived submarines through fog. */
  sonar?: number;
}

export interface SubmarineDef {
  /** Seconds of dived endurance on a full battery. */
  batterySeconds: number;
  /** Speed multiplier while dived. */
  diveSpeed: number;
  /** Seconds the boat is exposed after launching a torpedo. */
  revealSeconds: number;
  /** Enemies this close can see the periscope without sonar. */
  closeDetect: number;
}

/** Passive field-repair envelope for a recovery vehicle. */
export interface RepairDef {
  /** Radius in tiles. */
  radius: number;
  /** Hit points restored per second to the chosen target. */
  hpPerSec: number;
  /** Materials spent per hit point restored. */
  materialCostPerHp: number;
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
  /** Baseline structure slot this national variant substitutes, e.g. `mgNest`. */
  variantOf?: string;
  /**
   * Structure families that must already stand completed for this one to be
   * laid. Baseline ids, never variant ids: a national variant asks for the same
   * family as the shared structure it replaces. Omitted means tier one.
   */
  requires?: string[];
  /** Headquarters buildings are victory objectives. */
  commandPost?: boolean;
  /** Provides the tactical minimap while operational and powered. */
  radar?: boolean;
  /** Secondary-resource income per second while owned. */
  reqPerSec?: number;
  /** Passive material income per second while owned and operational. */
  matsPerSec?: number;
  /**
   * A lifeline rather than an income stream: this passive income only pays
   * while the owner has no harvester left, so a base stripped of its hauling
   * economy can still rebuild instead of sitting at zero income forever.
   */
  matsPerSecBackstop?: boolean;
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
   * The footprint is deck, not masonry: ground units may cross it, so it is
   * never stamped into the blocked grid while it stands. A span that is shot
   * down blocks its own crossing and stays on the map as wreckage that an
   * engineer can re-deck. Used by bridges.
   */
  walkable?: boolean;
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

/** A set of registered unit and building definition ids. */
export interface RosterDef {
  readonly units: readonly string[];
  readonly buildings: readonly string[];
}

/**
 * National changes applied on top of an alliance baseline.
 *
 * Additions are appended in declaration order and must not duplicate an id.
 * Removals must name an id present in the baseline. A replacement maps a
 * baseline id to another registered definition with a unique id: it keeps the
 * baseline slot, which is how a national variant swaps a shared platform
 * without changing production or save state. Every referenced id is
 * a full UnitDef or BuildingDef; this model never clones or patches a
 * definition at runtime.
 */
export interface NationRosterModifications {
  readonly addUnits?: readonly string[];
  readonly addBuildings?: readonly string[];
  readonly removeUnits?: readonly string[];
  readonly removeBuildings?: readonly string[];
  readonly replaceUnits?: Readonly<Record<string, string>>;
  readonly replaceBuildings?: Readonly<Record<string, string>>;
}

/** Shared identity fields for factions, alliances and nations. */
export interface FactionIdentity {
  id: string;
  name: string;
  shortName: string;
  color: string;
  accent: string;
  blurb: string;
}

/** One of the two launch alliances; supplies the shared baseline roster. */
export interface AllianceDef extends FactionIdentity {
  readonly baseline: RosterDef;
}

/** One of the six playable launch nations. */
export interface NationDef extends FactionIdentity {
  /** Alliance whose baseline this nation inherits. */
  readonly allianceId: string;
  /** One-line battlefield identity shown in setup, brief and loading screen. */
  readonly doctrine: string;
  /** National additions, exclusions and substitutions; absent means baseline only. */
  readonly roster?: NationRosterModifications;
}

/**
 * Legacy alliance-level preset (`baltic`, `expeditionary`).
 *
 * Existing maps and saves use these ids, so they stay valid and resolve to the
 * same shared baseline as their alliance. New playable identities are the six
 * nations in `NATION_LIST`; do not add national behaviour here.
 */
export interface FactionDef extends FactionIdentity {
  readonly allianceId: string;
  readonly units: readonly string[];
  readonly buildings: readonly string[];
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

export interface SubmarineState {
  dived: boolean;
  /** Seconds of dived endurance remaining. Recharges while surfaced. */
  battery: number;
  maxBattery: number;
  /** Seconds left in the launch datum that exposes the boat. */
  revealTimer: number;
  /** True while the launch datum is live; ordinary weapons may target it. */
  revealed: boolean;
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
  /**
   * Veterancy experience, earned by damaging and destroying enemies. Integer
   * and clamped, so a save round-trip and both peers of a match agree exactly.
   * Absent on saves and snapshots written before veterancy existed (loads as 0)
   * and always 0 on buildings, which never promote.
   */
  xp?: number;
  /** Buildings: 0..1 construction progress; 1 for complete. */
  buildProgress: number;
  construction: boolean;
  queue: QueueItem[];
  rallyX: number;
  rallyZ: number;
  harvester?: HarvesterState;
  aircraft?: AircraftState;
  submarine?: SubmarineState;
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
  /**
   * Night-fighting target acquisition. `acquireTargetId` is the target the crew
   * is currently identifying and `acquireTicks` how long they have held it; a
   * direct-fire shot waits until enough ticks have accumulated. Optional so a
   * save written before the day/night system loads unchanged (absent = 0).
   */
  acquireTargetId?: number;
  acquireTicks?: number;
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
  /**
   * Friendly mechanical unit this recovery vehicle is currently repairing, or
   * 0. Saved with the entity so a reload resumes the same repair job.
   */
  repairTargetId?: number;
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
  /** Launch point and arc data, present on indirect-fire projectiles. */
  startX?: number;
  startY?: number;
  startZ?: number;
  /** True for a lobbed shot that follows a visible ballistic arc. */
  lob?: boolean;
  /** Peak height of the arc in world units. */
  arc?: number;
}

/**
 * Presentation-neutral transition markers carried by ordinary sim events.
 * They let the UI identify a specific gameplay moment without parsing prose
 * or polling state, and they never affect simulation rules.
 */
export type SimEventCode =
  | 'queueFull'
  | 'productionStarted'
  | 'productionCancelled'
  | 'siteLost'
  | 'powerRestored'
  | 'baseUnderAttack'
  | 'forcesUnderAttack'
  | 'enemyDetected'
  | 'unitPromoted'
  | 'rallySet'
  | 'moveOrder'
  | 'attackOrder';

export type ImpactSurface = 'ground' | 'water' | 'armour' | 'structure' | 'air';

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
  /** Weapon that produced this shot, impact or death. */
  weaponId?: string;
  /** Actual surface at an impact; presentation only, never a hit roll. */
  surface?: ImpactSurface;
  /** A projectile reached its intended target rather than falling nearby. */
  hit?: boolean;
  /** Target of a direct hit, or zero for a splash-only impact. */
  targetId?: number;
  /** Hull or structure heading at the moment of destruction, for wrecks. */
  facing?: number;
  /** Machine-readable transition for presentation services such as the announcer. */
  code?: SimEventCode;
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
  | { type: 'dive'; team: number; ids: number[]; dive: boolean }
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
  /** Tick of the last reconnaissance-drone sortie, kept separate from the land scout. */
  lastAirScoutTick?: number;
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
  /**
   * Packed surface/vegetation overlay per tile (0 = bare). Optional so every
   * existing runtime map literal, save and projection stays valid; a map
   * without it behaves exactly as it did before the layer existed.
   */
  overlay?: Uint8Array;
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
  /**
   * Structures each team has seen at least once. Buildings never move, so a
   * charted structure stays on the map as a remembered silhouette once it
   * drops out of vision; units are never charted.
   */
  charted: ChartedStructure[];
  commandCount: number;
  /** True once the scenario has been initialised fully. */
  ready: boolean;
}

/** How much of a structure a team currently knows about. */
export type VisionState = 'visible' | 'remembered' | 'hidden';

export interface ChartedStructure {
  team: number;
  entityId: number;
}

/**
 * How much a team currently knows about a hostile it cannot see.
 *
 * A sighting is `confirmed` only while the unit is in vision: the exact
 * definition is known and the position is live. Once it drops out, the record
 * becomes `detected` — the last position is still worth acting on, but the exact
 * type is withdrawn. After the detection window it becomes `last-known`, which
 * is a fading marker the player can remember rather than a target. Nothing here
 * is inferred from hidden state: every field was observed while it was visible.
 */
export type ContactState = 'confirmed' | 'detected' | 'last-known';

/** Coarse classification available once a contact has been confirmed. */
export type ContactBand = 'infantry' | 'armour' | 'air' | 'naval' | 'structure';

export interface ContactRecord {
  team: number;
  entityId: number;
  x: number;
  z: number;
  /** Tick of the last confirmed sighting. */
  tick: number;
  /** Exact definition, present only while the contact is confirmed. */
  defId?: string;
  kind?: EntityKind;
  /** Absent in saves written before contact states existed; read as confirmed. */
  state?: ContactState;
  /** Coarse class kept through the detected window, withdrawn once stale. */
  band?: ContactBand;
}

export interface GameStats {
  entities: number;
  units: number;
  buildings: number;
  projectiles: number;
}
