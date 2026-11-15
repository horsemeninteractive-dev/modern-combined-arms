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

/**
 * A mobile electronic-attack envelope. The vehicle emits continuously from its
 * own position, so the effect moves with it and ends when the hull dies. Both
 * multipliers are applied to hostile units inside `radius`; they never affect
 * the owner's own coalition.
 */
export interface ElectronicWarfareDef {
  /** Radius in tiles. */
  radius: number;
  /** Multiplier applied to a jammed unit's vision (0.6 = 40% reduction). */
  visionMultiplier: number;
  /** Multiplier applied to a jammed unit's effective engagement reach. */
  engagementMultiplier: number;
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
  /**
   * Passenger transport contract. Absent on every shipped unit in Phase 5B:
   * APCs, transport helicopters and landing craft are defined by later phases
   * and reuse the same occupancy machinery as a garrisonable structure.
   */
  transport?: TransportDef;
  /** Radius in tiles within which this unit must remain near its parent structure. */
  homeRadius?: number;
  description: string;
  icon: string;
  hotkey?: string;
  /**
   * Baseline slot this variant specialises, e.g. `tank`. An alliance platform
   * and a national replacement both declare it, so a roster swap keeps the
   * facility's production list and the UI/AI resolve the definition through the
   * canonical root of the chain.
   */
  variantOf?: string;
  /**
   * Nation-specific definition, as opposed to one of the two alliance
   * platforms. Only a national variant earns the NATIONAL badge; every
   * alliance platform is also a `variantOf`, so the badge cannot key on that.
   */
  national?: boolean;
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
  /** Continuous electronic-attack envelope, emitted while the hull is alive. */
  electronicWarfare?: ElectronicWarfareDef;
  /**
   * One-way attack munition. The airframe is expended when its primary weapon
   * fires, and it cannot be recovered or rearmed. Used by loitering munitions.
   */
  oneWay?: boolean;
  /**
   * Rotary-wing aircraft. A helicopter uses a helo dock, not a flight-line
   * position, which is what lets an airfield recover one without basing it.
   */
  rotary?: boolean;
}

/**
 * How one facility's aircraft positions are used right now.
 *
 * `used` is the number of permanent positions promised, which is the capacity
 * the production gate reads: airborne hulls keep their berth, so `used` does not
 * fall when a sortie launches. The breakdown below it is what the structure card
 * reports, because "3 of 4" alone cannot tell a commander whether the missing
 * hull is on the apron, on approach or still in the queue.
 */
export interface AircraftOccupancy {
  /** Positions promised to hulls or to queued orders. */
  used: number;
  capacity: number;
  /** Hulls down on their own position. */
  parked: number;
  /** Hulls airborne and cleared to come home. */
  inbound: number;
  /** Hulls airborne on a sortie or patrol, still holding their berth. */
  airborne: number;
  /** Production orders holding a berth they have not launched into yet. */
  queued: number;
  /** True when these positions are an airfield's recovery-only helicopter pad. */
  temporary?: boolean;
}

/** Aircraft docking positions a facility offers, by aircraft kind. */
export interface AircraftDocks {
  /** Permanent fixed-wing positions. */
  fixedWing: number;
  /** Helicopter positions. */
  helo: number;
  /** True when the helicopter positions are recovery-only (see `docks`). */
  heloTemporary?: boolean;
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
  /**
   * Aircraft docking positions on this facility.
   *
   * `heloTemporary` marks a pad that may recover, rearm and repair a helicopter
   * but may not base one: the crew relaunches as soon as the servicing run ends
   * so the pad is free again. Such a pad never produces helicopters, which is
   * what keeps a heliport necessary for a real helicopter force.
   */
  docks?: AircraftDocks;
  /** Naval build / repair point. Requires navigable water adjacency. */
  shipyard?: boolean;
  /** Baseline structure slot this variant specialises, e.g. `mgNest`. */
  variantOf?: string;
  /** Nation-specific structure, as opposed to an alliance platform. */
  national?: boolean;
  /**
   * Structure families that must already stand completed for this one to be
   * laid. Baseline ids, never variant ids: a national variant asks for the same
   * family as the shared structure it replaces. Omitted means tier one.
   */
  requires?: string[];
  /** Headquarters buildings are victory objectives. */
  commandPost?: boolean;
  /** Coordinates the owner's national strategic superweapon. */
  strategicOps?: boolean;
  /** Provides the tactical minimap while operational and powered. */
  radar?: boolean;
  /** Secondary-resource income per second while owned. */
  reqPerSec?: number;
  /** Passive material income per second while owned and operational. */
  matsPerSec?: number;
  /**
   * A lifeline rather than an income stream: this passive income only pays
   * while the owner's hauling economy is not working — no hauler left, or no
   * deposit left anywhere to mine — so a base stripped of its income can still
   * rebuild instead of sitting at zero forever.
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
   * Research speed multiplier while this structure runs a project: 1 is the
   * standard centre, 1.25 finishes a project in four fifths of the time. The
   * fastest operational centre supplies it; a destroyed or unfinished centre
   * supplies nothing.
   */
  researchSpeed?: number;
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

/**
 * Shared passenger-container contract.
 *
 * A container holds infantry off the battlefield. A garrisonable structure is
 * a static container; a future APC, transport helicopter or landing craft is a
 * mobile one. Occupancy is recorded once, on the passenger's `garrisonId`; a
 * container never keeps a second mutable passenger list that could disagree
 * with it. Definitions only describe the rules, never a live seat map.
 */
export interface ContainerDef {
  /** Maximum infantry entities inside at once. */
  capacity: number;
  /** Static containers: fraction of incoming damage the cover blocks (0..0.9). */
  protection?: number;
  /** Static containers: fraction of a weapon's suppression reaching occupants. */
  exposure?: number;
  /** Occupants allowed to fire through the container at once. 0 means none. */
  firingSlots?: number;
  /** Mobile containers move with the battlefield and carry their passengers. */
  mobile?: boolean;
  /** Mobile containers: boarding range in tiles. */
  boardingRadius?: number;
  /** Mobile containers: passengers may use their own weapons from inside. */
  canFireEmbarked?: boolean;
  /** Passenger category this container accepts. Defaults to line infantry. */
  passenger?: 'infantry';
  /**
   * What happens to occupants when the container dies. `kill` is the default
   * and the Phase 5B policy; `eject` uses the normal safe disembark ring and is
   * reserved for a container that explicitly opts in.
   */
  onDestroyed?: 'kill' | 'eject';
}

/** Garrison shelter on a structure: static, protected, with firing positions. */
export interface GarrisonDef extends ContainerDef {
  /** Maximum infantry entities inside at once. */
  capacity: number;
  /** Fraction of incoming damage the structure blocks for its occupants (0..0.9). */
  protection: number;
  /** Fraction of a weapon's suppression that reaches the occupants through the cover. */
  exposure: number;
  /** Occupants allowed to fire through the building's firing positions at once. */
  firingSlots: number;
  mobile?: false;
}

/**
 * Passenger transport on a unit. Phase 5B defines the contract and simulates
 * it; no shipped unit carries one yet, and the core architecture never names a
 * particular transport id.
 */
export interface TransportDef extends ContainerDef {
  capacity: number;
  mobile: true;
  /** Range in tiles within which infantry can board a stopped carrier. */
  boardingRadius: number;
  onDestroyed: 'kill' | 'eject';
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

/** One of the ten playable nations. */
export interface NationDef extends FactionIdentity {
  /** Alliance whose baseline this nation inherits. */
  readonly allianceId: string;
  /** One-line battlefield identity shown in setup, brief and loading screen. */
  readonly doctrine: string;
  /** National additions, exclusions and substitutions; absent means baseline only. */
  readonly roster?: NationRosterModifications;
  /**
   * Strategic superweapon family this nation can field. Absent means the nation
   * has no strategic call-in; it keeps every other national strength. The id is
   * a catalogue key, never a nation-specific runtime branch.
   */
  readonly superweapon?: string;
}

/**
 * Legacy alliance-level preset (`baltic`, `expeditionary`).
 *
 * Existing maps and saves use these ids, so they stay valid and resolve to the
 * same shared baseline as their alliance. New playable identities are the ten
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
  /**
   * Aircraft production only: the berth this item has reserved at the facility
   * for the hull it will launch. Reserving at order time is what stops a queue
   * from oversubscribing a flight line or a heliport while earlier hulls are
   * still airborne. Absent on older saves and on every non-aircraft item.
   */
  berth?: number;
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
  | 'selling'
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
  /**
   * The unloading bay this haul was promised, on the refinery in `refineId`.
   * A bay is claimed when the load is dispatched, not on arrival, so two
   * haulers never drive at the same mouth and a full refinery can be seen to
   * hold its queue instead of silently overlapping. Absent while none is free.
   */
  bay?: number;
}

/**
 * One leg of an aircraft's movement on the ground.
 *
 * A sortie no longer begins with an airframe already in the air: it taxis out,
 * runs the strip and climbs away, and a return is a touch-down, a roll-out and a
 * turn onto its own stand. Each leg is a straight, timed line between two poses,
 * which keeps the manoeuvre cheap, deterministic and identical after a reload.
 * Presentation reads the resulting position and the `climb` share; nothing in
 * the simulation branches on the leg except the transition at its end.
 */
export interface GroundRoll {
  kind: 'takeoff' | 'landing';
  /** Seconds elapsed, and the leg's total, so the profile never varies. */
  t: number;
  seconds: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** Heading held for the whole leg. */
  facing: number;
  /**
   * What the hull does when the leg runs out: the next leg of the manoeuvre, or
   * release to normal flight.
   */
  next?: 'takeoffRun' | 'lift' | 'taxiIn' | 'land' | 'fieldLand' | 'airborne';
}

/**
 * A battlefield landing request, separate from a facility recovery.
 *
 * The permanent berth stays on `homeId`; a field landing only borrows open
 * ground for a boarding or unloading stop. `purpose` tells the end of the roll
 * whether passengers should step out immediately or wait to board.
 */
export interface FieldLandingState {
  x: number;
  z: number;
  purpose: 'board' | 'unload' | 'idle';
}

export interface NavalLandingState {
  /** Water tile the hull is running for, or has beached on. */
  x: number;
  z: number;
  purpose: 'board' | 'unload' | 'idle';
  /** True once the hull is stationary against a valid landing shore. */
  beached: boolean;
}

export interface AircraftState {
  homeId: number;
  landed: boolean;
  /** Seconds remaining until full rearm/refuel. */
  serviceTimer: number;
  serviceTotal: number;
  returningHome: boolean;
  /**
   * The permanent position this hull owns at `homeId`, assigned when it is
   * produced (or when a scenario airframe is placed) and held for its whole
   * life — through take-off, patrol, return and parking. Taking off does not
   * release it, so a full flight line cannot be oversubscribed by hulls that
   * happen to be in the air. Absent on older saves and on an airframe that
   * landed with no position to call its own (over-capacity overflow), which is
   * what `waitingForDock` reports.
   */
  berth?: number;
  /**
   * True when `berth` is an airfield's recovery-only helicopter pad rather than
   * a permanent helicopter berth. The reservation is released when servicing
   * finishes, so the pad can take the next damaged rotary hull.
   */
  temporaryBerth?: boolean;
  /**
   * Set when the aircraft is down but every position of its kind is taken: it
   * can land, but it neither rearms nor repairs until one frees up. Absent on
   * older saves and whenever a docking position was available.
   */
  waitingForDock?: boolean;
  /**
   * Share of cruise altitude the hull has actually reached, 0 on its wheels and
   * 1 in the pattern. The simulation authors it — a taxi is 0, a take-off run
   * climbs, a roll-out descends — so the renderer never has to guess how high an
   * airframe should be from a boolean. Absent on older saves, where `landed`
   * remains the whole answer.
   */
  climb?: number;
  /** The ground leg in progress, if any. See `GroundRoll`. */
  roll?: GroundRoll;
  /**
   * A landing on open ground rather than at the hull's home facility. Kept
   * while the helicopter is down so a landed transport is not teleported back
   * to its pad, and cleared by the next ordinary move order.
   */
  fieldLanding?: FieldLandingState;
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
  /**
   * Stable authored identity, copied from the scenario placement that created
   * this entity. Optional: units produced in a match and ordinary placements
   * have none. It is the join key mission documents and, later, campaign
   * veterans use, so it survives save/load unchanged.
   */
  authoredKey?: string;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  facing: number;
  turretFacing: number;
  state: EntityState;
  order: Order | null;
  /**
   * Shift-queued orders after the current one. Empty or absent on an ordinary
   * unit; the simulation executes them in order as each movement leg arrives.
   */
  orderQueue?: Order[];
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
  /**
   * Seconds left before a sold structure is dismantled. Present only while it
   * is being deconstructed: the building is already non-operational, remains
   * targetable, and pays its 75% refund when the clock reaches zero.
   */
  deconstruct?: { remaining: number; total: number };
  queue: QueueItem[];
  rallyX: number;
  rallyZ: number;
  harvester?: HarvesterState;
  aircraft?: AircraftState;
  /**
   * A landing craft's current shore approach. Absent on every other hull.
   * `beached` is public simulation state because boarding and exiting depend on
   * it; the approach coordinates are only a deterministic destination.
   */
  navalLanding?: NavalLandingState;
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
  /**
   * Container id this infantryman occupies, or 0 when exposed. The container is
   * a garrisonable structure or a mobile transport; the field keeps its
   * historical name so existing saves and every `garrisonId` exclusion in the
   * simulation stay valid. It is the single authoritative occupancy reference.
   */
  garrisonId: number;
  /**
   * Friendly mechanical unit this recovery vehicle is currently repairing, or
   * 0. Saved with the entity so a reload resumes the same repair job.
   */
  repairTargetId?: number;
  /** AI bookkeeping (serialised so saves remain faithful). */
  aiGroup: number;
  aiRole: string;
  /**
   * Held for a campaign mission: this unit belongs to a dormant AI group.
   *
   * A held unit is placed on the map but the AI commander ignores it and it
   * takes no orders until an `activateAiGroup` action releases it. Absent on
   * everything else, including every multiplayer entity.
   */
  missionHold?: boolean;
  /**
   * Research this unit has spent on itself, as unit-upgrade ids. Research makes
   * an upgrade available to every eligible unit; this list records the ones
   * this particular hull has actually taken. Absent on older saves and on
   * buildings.
   */
  upgrades?: string[];
  /**
   * Research modules bought and installed on this particular structure. A
   * module unlocked by research is offered on every eligible building, but each
   * installation is individual. Absent on older saves and on units.
   */
  modules?: string[];
  /**
   * Per-ability reload for this hull, in seconds of simulation time remaining,
   * keyed by unit-upgrade id. Cooldown is the unit's, not the player's: one recon
   * troop firing smoke never reloads its neighbour. Absent on older saves and on
   * structures, and never sent to the opposing team.
   */
  cooldowns?: Record<string, number>;
  /**
   * Timed ability effects currently running on this hull, in seconds of
   * simulation time remaining, keyed by unit-upgrade id. The multiplier each one
   * applies lives in `data/abilities.ts`; this is only the clock. Absent on older
   * saves, on structures, and once the effect has run out.
   */
  effects?: Record<string, number>;
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
  /**
   * Set on an off-map strategic munition. Such a round is resolved by its own
   * impact rules and can be engaged by local air defence and defensive fields.
   */
  strategic?: { family: string; operationId: number };
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
  | 'superweaponAuthorised'
  | 'superweaponWarning'
  | 'superweaponImpact'
  | 'superweaponIntercept'
  | 'superweaponComplete'
  | 'superweaponBlocked'
  | 'queueFull'
  | 'productionStarted'
  | 'productionCancelled'
  | 'siteLost'
  | 'buildingSold'
  | 'powerRestored'
  | 'baseUnderAttack'
  | 'forcesUnderAttack'
  | 'enemyDetected'
  | 'unitPromoted'
  | 'rallySet'
  | 'moveOrder'
  | 'attackOrder'
  | 'guardOrder'
  | 'researchStarted'
  | 'researchComplete'
  | 'researchCancelled'
  | 'objectiveActivated'
  | 'objectiveComplete'
  | 'objectiveFailed'
  | 'missionMessage'
  | 'moduleInstalled'
  | 'upgradeApplied'
  | 'abilityUsed';

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
  | 'buildingSold'
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
  | { type: 'move'; team: number; ids: number[]; x: number; z: number; attackMove?: boolean; queue?: boolean }
  /** Patrol between the unit's current ground and one map point. */
  | { type: 'patrol'; team: number; ids: number[]; x: number; z: number }
  /** Follow a friendly unit and engage contacts around it. */
  | { type: 'guard'; team: number; ids: number[]; targetId: number }
  /** Put transport helicopters down on open ground and hold them there. */
  | { type: 'land'; team: number; ids: number[]; x: number; z: number }
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
  /** Sell one finished owned structure; it dismantles before paying a 75% refund. */
  | { type: 'sellBuilding'; team: number; buildingId: number }
  | { type: 'setRally'; team: number; buildingId: number; x: number; z: number }
  /** Start one project at an operational Research Centre. */
  | { type: 'research'; team: number; buildingId: number; techId: string }
  /** Cancel the player's project; the centre refunds its cost like a unit queue. */
  | { type: 'cancelResearch'; team: number; buildingId: number }
  /** Buy and install a researched module on one structure. */
  | { type: 'installModule'; team: number; buildingId: number; moduleId: string }
  /** Apply a researched upgrade to one owned unit. */
  | { type: 'activateUpgrade'; team: number; unitId: number; upgradeId: string }
  /**
   * Use a runtime ability an owned unit has because of research. The effect is
   * centred on the unit, so the command carries no destination: a client cannot
   * ask for a cloud somewhere the hull could not lay one.
   */
  | { type: 'useAbility'; team: number; unitId: number; abilityId: string }
  /**
   * Authorise the commander's national strategic capability against one target.
   * The family is carried so a stale client cannot activate a different one;
   * the simulation checks it against the nation and the target mode.
   */
  | {
      type: 'superweapon';
      team: number;
      familyId: string;
      /** World-space aim point (tile centre for an area, entity centre for a target). */
      x: number;
      z: number;
      targetId?: number;
    };

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

/**
 * One research project. Progress is measured in seconds of fixed-tick work,
 * never wall-clock time, so two peers and a reload all advance it identically.
 */
export interface ResearchProject {
  techId: string;
  /** Seconds of work still to do. Never negative. */
  remaining: number;
  /** Seconds the project cost when it started, for the progress bar. */
  total: number;
}

/** One player's permanent research record; player-global, not per-building. */
export interface ResearchState {
  /** Completed technology ids in completion order. */
  completed: string[];
  /** The single active project, or null when the branch is idle. */
  project: ResearchProject | null;
}

/**
 * One committed strategic operation, as the simulation sees it.
 *
 * The warning phase is a real scheduled event, not a UI delay: the command
 * charges, sets the cooldown and schedules execution on the authoritative tick.
 * A structure lost during the warning therefore cannot cancel it, which is the
 * documented behaviour of a committed operation.
 */
export interface SuperweaponOperationState {
  id: number;
  family: string;
  phase: 'warning' | 'executing';
  startTick: number;
  executeTick: number;
  endTick: number;
  targetX: number;
  targetZ: number;
  targetId: number;
  /** Munitions released so far, for a staged volley. */
  launched: number;
}

/** A directed-energy defensive field established by one commander. */
export interface SuperweaponDefenceField {
  x: number;
  z: number;
  radiusTiles: number;
  untilTick: number;
  /** Munitions stopped during the current second, reset each second. */
  spentThisSecond: number;
  secondMark: number;
}

/** Per-player strategic state: cooldowns survive the centre that earned them. */
export interface PlayerSuperweaponState {
  /** Absolute tick each family becomes available again. */
  cooldowns: Record<string, number>;
  /** At most one committed operation per commander. */
  active: SuperweaponOperationState | null;
  /** Tick an enemy electronic attack stops degrading this commander. */
  ewUntilTick: number;
  /** The commander's own defensive field, when one is established. */
  defence: SuperweaponDefenceField | null;
}

export interface PlayerState {
  id: number;
  name: string;
  factionId: string;
  team: number;
  isAI: boolean;
  mats: number;
  req: number;
  /** Player-global research progress and completed technologies. */
  research: ResearchState;
  /** Convenience counters for UI and diagnostics. */
  stats: {
    matsGathered: number;
    unitsBuilt: number;
    unitsLost: number;
    kills: number;
    buildingsBuilt: number;
    /**
     * Structures destroyed by this player, and lost to this player. Optional
     * because saves written before career service records existed do not carry
     * them; a loader fills 0. `kills` remains every entity killed, so the two
     * counters split it rather than replacing it.
     */
    structuresDestroyed?: number;
    structuresLost?: number;
    /** Enemy strategic sites taken by capture. Optional for the same reason. */
    sitesCaptured?: number;
  };
  incomeHistory: number[];
  defeated: boolean;
  relayCount: number;
  /** Strategic superweapon authority and cooldown state. */
  superweapon: PlayerSuperweaponState;
}

export type AIStrategy = 'armour' | 'infantry' | 'air' | 'economy' | 'pressure';

/** Selectable opponent strength; never changes resources, vision or rules. */
export type AIDifficulty = 'recruit' | 'veteran' | 'elite';

/**
 * One transport operation the commander is running.
 *
 * The carrier and its passengers stay the authoritative entities — `garrisonId`
 * remains the only passenger link — so this records only which hull was
 * committed to which objective and how far the operation has got. Every field
 * is a number, a short string or a list of ids, so it serialises with the rest
 * of the AI state and needs no save schema of its own.
 */
export interface TransportOperation {
  id: number;
  kind: 'land' | 'air' | 'naval';
  transportId: number;
  passengerIds: number[];
  /**
   * Staging and boarding, the run to the objective, the landing itself, and —
   * when an assault is abandoned with troops still aboard — the trip home and
   * the unload there. Recovery is a stage of the same operation rather than a
   * second system, because the passengers need exactly one owner.
   */
  stage: 'embark' | 'transit' | 'unload' | 'recover' | 'recoverUnload';
  targetX: number;
  targetZ: number;
  stageX: number;
  stageZ: number;
  startedTick: number;
  lastOrderTick: number;
  /** Refused landing attempts, so a blocked shore is abandoned rather than retried. */
  refusals: number;
}

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
  /**
   * Authored commander identity, when one was chosen explicitly. Absent on every
   * match and save that predates the commander catalogue, in which case the
   * seeded profile is used exactly as before.
   */
  commanderId?: string;
  /** Profile schema version that authored `commanderId`, for future migrations. */
  commanderProfileVersion?: number;
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
  /**
   * Tick the commander last set materials aside for a planned drop-off. An
   * affordable drop-off is only finished ahead of other concrete while that
   * plan is still fresh, so a base that was never saving for one keeps its
   * ordinary build order.
   */
  economyPlanTick?: number;
  /** Last garrison entry or release decision, to avoid thrashing. */
  lastGarrisonTick?: number;
  /** Last strategic-objective capture attempt, to avoid retrying a blocked route. */
  lastObjectiveTick?: number;
  /**
   * Transport operations in flight. Absent in saves written before Phase 5F;
   * a commander with none simply plans its next operation from the world state.
   */
  transportOps?: TransportOperation[];
  /** Tick the commander last committed, finished or lost a transport. */
  lastTransportTick?: number;
  /**
   * Decaying reading of what the opponent is investing in, inferred only from
   * identified contacts. Absent in saves written before Phase 6 and on the
   * seeded path, where it is simply rebuilt from the first contact.
   */
  opponentRead?: {
    tendency: string | null;
    confidence: number;
    mass: number;
    scores: Record<string, number>;
    tick: number;
    observed: number;
    /** Classes with meaningful evidence, strongest first. Absent in older saves. */
    tendencies?: { tendency: string; share: number }[];
  };
  /**
   * Assessment of the most recent committed wave, from the simulation's own
   * counters and the positions of the units it sent. Absent on the seeded path
   * and in saves written before Phase 8.
   */
  battle?: {
    wave: number;
    startTick: number;
    startKills: number;
    startLosses: number;
    startCount: number;
    x: number;
    z: number;
    ids: number[];
    /** Consecutive failed waves, and when the commander stops doubting itself. */
    setbacks?: number;
    setbackUntil?: number;
    lastOutcome?: 'success' | 'failure' | 'inconclusive';
    lastOutcomeTick?: number;
  };
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
  /**
   * Authoritative smoke clouds, oldest first. A cloud is simulation state: it is
   * timed on the fixed tick, saved, and replicated, because visibility is
   * resolved from it on every peer rather than drawn by the client.
   */
  smoke: SmokeCloud[];
  /** Next free cloud id. Saved so a reload never reuses a live id. */
  nextSmokeId: number;
  /**
   * Authoritative mission state, or null for a skirmish. It is held as plain
   * data so a save and a state hash read the same object; the owner is
   * `Game.mission`, which is the only writer.
   */
  mission: import('../mission').MissionRuntimeState | null;
  /** True once the scenario has been initialised fully. */
  ready: boolean;
}

/** How much of a structure a team currently knows about. */
export type VisionState = 'visible' | 'remembered' | 'hidden';

/**
 * One authoritative smoke cloud.
 *
 * Position and radius are the same numbers the vision refresh tests and the
 * renderer draws, so what the player sees and what the simulation believes are
 * one object. `expiresTick` is absolute, which keeps expiry deterministic across
 * a reload and gives the renderer a fade without a second clock.
 */
export interface SmokeCloud {
  id: number;
  /** Player who laid it; -1 for none (never used, but keeps the field honest). */
  owner: number;
  /** Team that laid it. Smoke obscures everyone, including its owner. */
  team: number;
  x: number;
  z: number;
  /** Radius in world units. */
  radius: number;
  /** Tick the cloud was created, for the visual build-up. */
  startTick: number;
  /** Tick it is removed. Never earlier than `startTick`. */
  expiresTick: number;
}

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
