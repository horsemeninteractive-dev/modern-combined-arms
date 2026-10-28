import type { BuildingDef } from '../sim/types';

const ROSTER: BuildingDef[] = [
  {
    id: 'commandPost',
    name: 'Command Post',
    shortName: 'COMMAND',
    role: 'Headquarters',
    footprint: { w: 4, h: 4 },
    hp: 3300,
    armour: 'structure',
    cost: { mats: 1400, req: 0 },
    buildTime: 34,
    vision: 10,
    commandPost: true,
    reqPerSec: 0.4,
    // A standing headquarters trickles a little material while its owner has
    // no working drop-off — no refinery, and none affordable — so losing the
    // whole hauling economy is a severe setback rather than a permanent dead
    // end.
    matsPerSec: 1,
    matsPerSecBackstop: true,
    // Engineering fallback: the HQ trains engineers only while no vehicle
    // factory is operational (see Game.productionStatus).
    produces: 'land',
    productionList: ['engineer'],
    // The headquarters runs its own generator; every other structure draws on it.
    power: 80,
    description:
      'The battlegroup command element. Loss of the Command Post ends the operation. Provides limited requisition income and, while no working drop-off remains, a small material trickle so a stripped base can recover; it can also train a replacement Combat Engineer when no Vehicle Factory is operational.',
    icon: 'command',
    hotkey: 'H',
  },
  {
    id: 'barracks',
    name: 'Field Barracks',
    shortName: 'BARRACKS',
    role: 'Infantry production',
    footprint: { w: 3, h: 3 },
    hp: 1350,
    armour: 'structure',
    cost: { mats: 520, req: 0 },
    buildTime: 15,
    vision: 7,
    power: -8,
    produces: 'land',
    productionList: ['rifle', 'atgm', 'medic'],
    description: 'Trains riflemen, anti-tank teams and field medics.',
    icon: 'barracks',
    hotkey: 'B',
  },
  {
    id: 'factory',
    name: 'Vehicle Factory',
    shortName: 'FACTORY',
    role: 'Vehicle production',
    footprint: { w: 4, h: 3 },
    hp: 1800,
    armour: 'structure',
    cost: { mats: 840, req: 0 },
    buildTime: 20,
    vision: 7,
    power: -15,
    produces: 'land',
    productionList: ['engineer', 'harvester', 'recon', 'aa', 'tank', 'spg', 'recovery'],
    description:
      'Builds armoured vehicles, recovery and artillery support, and harvesters. Each factory runs its own production queue.',
    icon: 'factory',
    hotkey: 'V',
  },
  {
    id: 'refinery',
    name: 'Material Refinery',
    shortName: 'REFINERY',
    role: 'Resource drop-off',
    footprint: { w: 4, h: 3 },
    hp: 1500,
    armour: 'structure',
    cost: { mats: 600, req: 0 },
    buildTime: 16,
    vision: 7,
    refinery: true,
    reqPerSec: 0.1,
    power: -10,
    description:
      'Receives harvested material loads. A second refinery near a fresh deposit shortens harvester round trips.',
    icon: 'refinery',
    hotkey: 'F',
  },
  {
    id: 'airfield',
    name: 'Forward Airfield',
    shortName: 'AIRFIELD',
    role: 'Air production / recovery',
    footprint: { w: 6, h: 5 },
    hp: 2250,
    armour: 'structure',
    cost: { mats: 1250, req: 120 },
    buildTime: 26,
    vision: 9,
    power: -25,
    produces: 'air',
    productionList: ['fighter', 'interceptor', 'uav'],
    airfield: true,
    description:
      'Produces strike fighters, interceptors and reconnaissance drones, and services them: rearming, refuelling and repairing aircraft that return to base.',
    icon: 'airfield',
    hotkey: 'J',
  },
  {
    id: 'shipyard',
    name: 'Naval Shipyard',
    shortName: 'SHIPYARD',
    role: 'Naval production / repair',
    // Square footprint: the yard turns its slipway toward the water, and a
    // square keeps the blocked tiles and the art aligned in every direction.
    footprint: { w: 5, h: 5 },
    hp: 2400,
    armour: 'structure',
    cost: { mats: 1050, req: 150 },
    buildTime: 28,
    vision: 9,
    power: -20,
    produces: 'naval',
    productionList: ['corvette'],
    shipyard: true,
    requiresWater: true,
    description:
      'Builds and services missile corvettes. Must be placed on a buildable coast with navigable water alongside.',
    icon: 'shipyard',
    hotkey: 'N',
  },
  {
    id: 'powerPlant',
    name: 'Turbine Plant',
    shortName: 'POWER',
    role: 'Power generation',
    footprint: { w: 3, h: 3 },
    hp: 1170,
    armour: 'structure',
    cost: { mats: 480, req: 0 },
    buildTime: 16,
    vision: 6,
    power: 100,
    description:
      'Generates grid power for the battlegroup. Every structure draws on the grid; a deficit slows construction and production until supply catches up.',
    icon: 'power',
    hotkey: 'P',
  },
  {
    id: 'radar',
    name: 'Radar Array',
    shortName: 'RADAR',
    role: 'Detection / tactical map',
    footprint: { w: 2, h: 2 },
    hp: 975,
    armour: 'structure',
    cost: { mats: 420, req: 0 },
    buildTime: 12,
    vision: 15,
    power: -12,
    radar: true,
    description:
      'Battlefield surveillance array. While operational and the grid is balanced it feeds the tactical minimap; a brownout or its loss blanks the map.',
    icon: 'scope',
    hotkey: '',
  },
  {
    id: 'samBattery',
    name: 'SAM Battery',
    shortName: 'SAM',
    role: 'Static air defence',
    footprint: { w: 2, h: 2 },
    hp: 1080,
    armour: 'structure',
    cost: { mats: 420, req: 40 },
    buildTime: 12,
    vision: 11,
    power: -20,
    weapons: ['samBattery'],
    description:
      'Static long-range surface-to-air battery. Denies airspace around the base; cannot engage ground forces.',
    icon: 'sam',
    hotkey: 'K',
  },
  {
    id: 'mgNest',
    name: 'Heavy MG Nest',
    shortName: 'MG NEST',
    role: 'Static anti-infantry',
    footprint: { w: 2, h: 2 },
    hp: 780,
    armour: 'structure',
    cost: { mats: 260, req: 0 },
    buildTime: 9,
    vision: 8,
    power: -6,
    weapons: ['heavyMg'],
    turretRate: 3.4,
    description:
      'Entrenched heavy machine gun. Cheap, durable and murderous against infantry, but nearly useless against armour.',
    icon: 'mg',
    hotkey: 'G',
  },
  {
    id: 'atTurret',
    name: 'Anti-Tank Gun',
    shortName: 'AT GUN',
    role: 'Static anti-armour',
    footprint: { w: 2, h: 2 },
    hp: 1140,
    armour: 'structure',
    cost: { mats: 430, req: 30 },
    buildTime: 13,
    vision: 10,
    power: -10,
    weapons: ['atTurretGun'],
    turretRate: 2.2,
    description:
      'Concealed 76mm anti-tank gun in a sandbagged emplacement. Long reach against vehicles and ships; poor against dispersed infantry.',
    icon: 'atgun',
    hotkey: 'T',
  },
  {
    id: 'coastalBattery',
    name: 'Coastal Battery',
    shortName: 'COASTAL',
    role: 'Static anti-ship defence',
    footprint: { w: 2, h: 2 },
    hp: 1050,
    armour: 'structure',
    cost: { mats: 480, req: 40 },
    buildTime: 14,
    vision: 11,
    power: -12,
    weapons: ['coastalMissile'],
    turretRate: 1.5,
    requiresWater: true,
    description:
      'Shore-based anti-ship missile launcher. Long reach against corvettes and other hulls, but it cannot engage ground forces and needs a buildable coastline with navigable water alongside.',
    icon: 'coastal',
    hotkey: 'L',
  },
  {
    id: 'relay',
    name: 'Signals Relay',
    shortName: 'RELAY',
    role: 'Capturable objective',
    footprint: { w: 2, h: 2 },
    hp: 850,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 9,
    reqPerSec: 1.1,
    capturable: true,
    indestructible: true,
    authoredOnly: true,
    description:
      'Neutral communications relay. Engineers can capture it; an owned relay feeds a steady stream of requisition. Relays are objectives, not targets, and cannot be destroyed — only captured.',
    icon: 'relay',
    hotkey: '',
  },
  {
    id: 'supplyDepot',
    name: 'Forward Supply Depot',
    shortName: 'DEPOT',
    role: 'Capturable material objective',
    footprint: { w: 3, h: 3 },
    hp: 900,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 7,
    matsPerSec: 2,
    capturable: true,
    indestructible: true,
    authoredOnly: true,
    description:
      'Forward stockpile. Engineers can capture it; while owned and operational it supplies 2 materials per second without a harvester or refinery. Like a relay it is an objective, not a target: it changes hands only by capture and cannot be destroyed.',
    icon: 'supply',
    hotkey: '',
  },
  {
    id: 'radarStation',
    name: 'Radar Station',
    shortName: 'RADAR STN',
    role: 'Capturable reconnaissance objective',
    footprint: { w: 3, h: 3 },
    hp: 800,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 10,
    radar: true,
    scanRadius: 22,
    capturable: true,
    authoredOnly: true,
    description:
      'Capturable surveillance station. While owned and the grid is balanced it keeps the tactical map online and plots hostile units within 22 tiles through terrain masking. It cannot fire and does not grant line of sight for weapons.',
    icon: 'radarstation',
    hotkey: '',
  },
  {
    id: 'tenement',
    name: 'Urban Tenement',
    shortName: 'TENEMENT',
    role: 'Garrison strongpoint',
    footprint: { w: 4, h: 4 },
    hp: 720,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 5,
    authoredOnly: true,
    garrison: { capacity: 4, protection: 0.55, exposure: 0.45, firingSlots: 2 },
    description:
      'Reinforced apartment block. Riflemen and ATGM teams can garrison it: up to four occupants, two firing positions and 55% protection against incoming fire. Dense cover, not a bunker — bring anti-structure fire.',
    icon: 'tenement',
    hotkey: '',
  },
  {
    id: 'warehouse',
    name: 'Brick Warehouse',
    shortName: 'WAREHOUSE',
    role: 'Garrison strongpoint',
    footprint: { w: 5, h: 4 },
    hp: 640,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 5,
    authoredOnly: true,
    garrison: { capacity: 4, protection: 0.45, exposure: 0.55, firingSlots: 2 },
    description:
      'Long brick goods store with a loading dock. Four infantry can hold it behind two firing positions and 45% protection: better than a ruin, worse than a purpose-built tenement.',
    icon: 'warehouse',
    hotkey: '',
  },
  {
    id: 'officeBlock',
    name: 'Office Block',
    shortName: 'OFFICES',
    role: 'Garrison strongpoint',
    footprint: { w: 4, h: 5 },
    hp: 680,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 7,
    authoredOnly: true,
    garrison: { capacity: 5, protection: 0.5, exposure: 0.5, firingSlots: 3 },
    description:
      'Concrete office tower with a commanding view of the street. Five occupants, three firing positions and 50% protection, but it is a large target for anti-structure fire.',
    icon: 'offices',
    hotkey: '',
  },
  {
    id: 'civicHall',
    name: 'Civic Hall',
    shortName: 'CIVIC HALL',
    role: 'Landmark strongpoint',
    footprint: { w: 5, h: 5 },
    hp: 1500,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 8,
    authoredOnly: true,
    garrison: { capacity: 6, protection: 0.6, exposure: 0.4, firingSlots: 3 },
    description:
      'The city hall: a domed civic block with a clock tower that anchors the central square. Six infantry can hold it behind three firing positions and 60% protection — the strongest shelter in the district, and the one both commanders will fight over.',
    icon: 'civic',
    hotkey: '',
  },
  {
    id: 'foundryWorks',
    name: 'Foundry Works',
    shortName: 'FOUNDRY',
    role: 'Landmark strongpoint',
    footprint: { w: 5, h: 4 },
    hp: 1600,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 6,
    authoredOnly: true,
    garrison: { capacity: 5, protection: 0.5, exposure: 0.5, firingSlots: 2 },
    description:
      'The works that gave the district its name: a long bay under twin chimneys, with a gantry rail across the yard. Five occupants hold it behind two firing positions and 50% protection, though the high stacks make it easy to find from a distance.',
    icon: 'foundry',
    hotkey: '',
  },
  {
    id: 'ruin',
    name: 'Ruined House',
    shortName: 'RUIN',
    role: 'Garrison position',
    footprint: { w: 3, h: 3 },
    hp: 420,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 4,
    authoredOnly: true,
    garrison: { capacity: 2, protection: 0.35, exposure: 0.7, firingSlots: 1 },
    description:
      'Damaged civilian house. Two infantry can use its broken walls as a light firing position with 35% protection; one can fire at a time. Much more exposed than a tenement.',
    icon: 'ruin',
    hotkey: '',
  },
];

/**
 * National variants, registered but absent from `BUILDING_LIST`. The shared
 * alliance baseline must not hand every nation another nation's structure; a
 * nation roster substitutes the slot explicitly.
 */
const NATIONAL_BUILDINGS: BuildingDef[] = [
  {
    id: 'bunker',
    name: 'Reinforced Bunker',
    shortName: 'BUNKER',
    role: 'Fortified anti-infantry',
    footprint: { w: 2, h: 2 },
    hp: 1350,
    armour: 'structure',
    cost: { mats: 420, req: 0 },
    buildTime: 14,
    vision: 10,
    power: -8,
    weapons: ['heavyMg'],
    turretRate: 3.0,
    variantOf: 'mgNest',
    description:
      'Hungarian reinforced machine-gun bunker. Nearly twice the survivability of the shared nest and a little more reach, paid for with a higher price and 14 seconds of construction: fewer positions, held longer.',
    icon: 'mg',
    hotkey: 'G',
  },
];

export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries(
  [...ROSTER, ...NATIONAL_BUILDINGS].map((b) => [b.id, b]),
);
export const BUILDING_LIST = ROSTER;

/** Registered national variants; deliberately excluded from the shared baseline. */
export const NATIONAL_BUILDING_LIST = NATIONAL_BUILDINGS;

/** Baseline family id for a national variant, or the id itself. */
export function buildingFamily(id: string): string {
  return BUILDINGS[id]?.variantOf ?? id;
}

export function buildingDef(id: string): BuildingDef {
  const def = BUILDINGS[id];
  if (!def) throw new Error(`Unknown building definition: ${id}`);
  return def;
}

/**
 * Objective structures that change hands only through capture. Weapons cannot
 * target them and no amount of splash damage can bring them down, so the
 * overlay skips their integrity bar and the damage model ignores them.
 */
export function isIndestructibleStructure(defId: string): boolean {
  return BUILDINGS[defId]?.indestructible === true;
}

/** Buildings a player can place. Strategic objectives and neutral shelters are authored only. */
export const BUILDABLE_BY_PLAYER = [...ROSTER, ...NATIONAL_BUILDINGS].filter(
  (b) => !b.authoredOnly,
);
