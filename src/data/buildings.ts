import type { BuildingDef } from '../sim/types';
import { resolveVariantChain } from './variant';

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
    // The headquarters runs its own generator, but only enough for the opening:
    // barracks, factory, refinery and radar sit just inside 50, so the first
    // expansion is what makes a Turbine Plant necessary rather than optional.
    power: 50,
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
    id: 'researchCentre',
    name: 'Applied Research Centre',
    shortName: 'RESEARCH',
    role: 'Research',
    footprint: { w: 4, h: 3 },
    hp: 1400,
    armour: 'structure',
    cost: { mats: 700, req: 40 },
    buildTime: 60,
    vision: 8,
    power: -30,
    requires: ['factory'],
    researchSpeed: 1,
    description:
      'The applied research centre. Runs one branch project at a time, paid in materials and requisition. Research unlocks platforms, unit upgrades and structure modules; the centre itself builds nothing, and a destroyed or unfinished centre pauses the project instead of cancelling it.',
    icon: 'research',
    hotkey: 'R',
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
    requires: ['factory'],
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
    requires: ['factory'],
    produces: 'naval',
    productionList: ['missileBoat', 'corvette', 'submarine', 'frigate'],
    shipyard: true,
    requiresWater: true,
    description:	  'Builds and services the naval line: fast missile boats, missile corvettes, attack submarines and escort frigates. Must be placed on a buildable coast with navigable water alongside.',
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
    // A smaller, cheaper turbine because a mature base needs two or three of
    // them: a pair costs about what the old single plant did, so the extra
    // plants add a decision rather than a tax.
    cost: { mats: 400, req: 0 },
    buildTime: 12,
    vision: 6,
    // Deliberately smaller than one HQ plus a full base: a mature base of air,
    // naval, radar and perimeter structures needs two or three plants.
    power: 60,
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
    requires: ['barracks'],
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
    requires: ['factory'],
    weapons: ['samBattery'],
    // The launcher trains on its target instead of standing welded to the pad.
    turretRate: 1.6,
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
    requires: ['factory'],
    weapons: ['coastalMissile'],
    turretRate: 1.5,
    requiresWater: true,
    description:
      'Shore-based anti-ship missile launcher. Long reach against corvettes and other hulls, but it cannot engage ground forces and needs a buildable coastline with navigable water alongside.',
    icon: 'coastal',
    hotkey: 'L',
  },
  {
    id: 'bridge',
    name: 'Road Bridge',
    shortName: 'BRIDGE',
    role: 'Crossing',
    // Square, like every authored structure: the span is stamped at all four
    // rotations of a competitive map, and a rectangular footprint cannot be
    // rotated without also rotating the blocked tiles it stands for.
    footprint: { w: 4, h: 4 },
    hp: 900,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 4,
    authoredOnly: true,
    // Deck, not obstacle: a ground unit drives across the span instead of
    // routing around it. Shooting it down blocks the crossing until an
    // engineer re-decks it.
    walkable: true,
    // The span is authored over the channel it bridges, so water under it is
    // the point rather than a placement mistake.
    waterStructure: true,
    description:
      'Span carrying the road over a channel. Any ground unit can cross it while it stands, and it can be repaired between fights. Anti-structure fire drops the deck: the crossing closes, unless an engineer rebuilds it.',
    icon: 'bridge',
    hotkey: '',
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
    id: 'freightShed',
    name: 'Freight Shed',
    shortName: 'SHED',
    role: 'Industrial strongpoint',
    // Square like every authored shelter, so it can be stamped at all four
    // rotations of a competitive map without turning its footprint.
    footprint: { w: 4, h: 4 },
    hp: 700,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 5,
    authoredOnly: true,
    garrison: { capacity: 5, protection: 0.45, exposure: 0.55, firingSlots: 2 },
    description:
      'Steel goods shed with loading doors at both ends. Five infantry hold it behind two firing positions and 45% protection: thin sheet walls, but the open bay gives a covered line down the yard.',
    icon: 'freightShed',
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
  {
    id: 'chapel',
    name: 'Village Chapel',
    shortName: 'CHAPEL',
    role: 'Landmark observer',
    // Square: an authored structure is stamped at all four rotations, so a
    // non-square footprint cannot be placed symmetrically on a four-way map.
    footprint: { w: 4, h: 4 },
    hp: 620,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    // The bell tower is the draw: it sees over the treeline and across the
    // river bend that the rest of the village cannot.
    vision: 11,
    authoredOnly: true,
    garrison: { capacity: 3, protection: 0.5, exposure: 0.5, firingSlots: 2 },
    description:
      'Stone chapel with a bell tower. Three infantry hold the nave behind two firing positions and 50% protection, and the tower sees eleven tiles over the rooftops — the best observation in a village, and the most obvious landmark on the map.',
    icon: 'chapel',
    hotkey: '',
  },
  {
    id: 'farmhouse',
    name: 'Farmhouse',
    shortName: 'FARM',
    role: 'Rural strongpoint',
    footprint: { w: 3, h: 3 },
    hp: 460,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 5,
    authoredOnly: true,
    garrison: { capacity: 3, protection: 0.38, exposure: 0.62, firingSlots: 2 },
    description:
      'Stone farmhouse with a walled yard and an attached barn. Three infantry get two firing positions and 38% protection: thin walls, but the yard wall lets a squad trade shots without standing in the open.',
    icon: 'farmhouse',
    hotkey: '',
  },
  {
    id: 'constabulary',
    name: 'Constabulary',
    shortName: 'POLICE',
    role: 'Urban strongpoint',
    footprint: { w: 4, h: 4 },
    hp: 780,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    vision: 8,
    authoredOnly: true,
    garrison: { capacity: 4, protection: 0.5, exposure: 0.5, firingSlots: 3 },
    description:
      'Reinforced civic police station with a walled vehicle yard. Four occupants hold it behind three firing positions and 50% protection: the strongest street-corner position in a town, and the one that covers the junction.',
    icon: 'constabulary',
    hotkey: '',
  },
  {
    id: 'watchtower',
    name: 'Fire Lookout',
    shortName: 'LOOKOUT',
    role: 'Observation post',
    footprint: { w: 2, h: 2 },
    hp: 340,
    armour: 'structure',
    cost: { mats: 0, req: 0 },
    buildTime: 0,
    // A bare timber tower: almost no shelter, but it is a periscope on legs.
    vision: 13,
    authoredOnly: true,
    garrison: { capacity: 2, protection: 0.3, exposure: 0.7, firingSlots: 1 },
    description:
      'Timber fire lookout on a hill. Two infantry get one firing position and only 30% protection, but thirteen tiles of vision: a cheap way to watch a pass, and a fragile one.',
    icon: 'watchtower',
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
    national: true,
    description:
      'Hungarian reinforced machine-gun bunker. Nearly twice the survivability of the shared nest and a little more reach, paid for with a higher price and 14 seconds of construction: fewer positions, held longer.',
    icon: 'mg',
    hotkey: 'G',
  },
  {
    id: 'forwardPost',
    name: 'Forward Observation Post',
    shortName: 'FWD POST',
    role: 'Detection / tactical map',
    footprint: { w: 2, h: 2 },
    hp: 600,
    armour: 'structure',
    cost: { mats: 300, req: 0 },
    buildTime: 9,
    vision: 12,
    power: -8,
    requires: ['barracks'],
    radar: true,
    variantOf: 'radar',
    national: true,
    description:
      'Lithuanian forward observation post. A third cheaper and quicker to raise than the shared array, with a smaller dish and a shorter reach: more of the map can be watched, but each post is easy to knock down and does less per site.',
    icon: 'scope',
    hotkey: '',
  },
  {
    id: 'armourWorks',
    name: 'Armoured Workshop',
    shortName: 'ARMOUR WORKS',
    role: 'Vehicle production',
    footprint: { w: 4, h: 3 },
    hp: 2520,
    armour: 'structure',
    cost: { mats: 966, req: 0 },
    buildTime: 23,
    vision: 7,
    power: -15,
    produces: 'land',
    productionList: ['engineer', 'harvester', 'recon', 'aa', 'tank', 'spg', 'recovery'],
    variantOf: 'factory',
    national: true,
    description:
      'Polish hardened vehicle works. Thicker bay walls and a bermed apron give forty per cent more survivability than the shared factory for fifteen per cent more material and three extra seconds of construction. It builds exactly the same vehicles.',
    icon: 'factory',
    hotkey: 'V',
  },
  {
    id: 'expeditionaryAirfield',
    name: 'Expeditionary Airfield',
    shortName: 'EXPED AIRFIELD',
    role: 'Air production / recovery',
    footprint: { w: 6, h: 5 },
    hp: 1690,
    armour: 'structure',
    cost: { mats: 875, req: 120 },
    buildTime: 17,
    vision: 9,
    power: -25,
    requires: ['factory'],
    produces: 'air',
    productionList: ['fighter', 'interceptor', 'uav'],
    airfield: true,
    variantOf: 'airfield',
    national: true,
    description:
      'British expeditionary strip: a shorter runway and tented servicing line. Thirty per cent cheaper and a third faster to stand up than the shared airfield, for a quarter less structure. The same airframes are produced and recovered, so losing it costs the whole flight line.',
    icon: 'airfield',
    hotkey: 'J',
  },
  {
    id: 'longRangeSam',
    name: 'Long-Range SAM Site',
    shortName: 'LONG SAM',
    role: 'Static air defence',
    footprint: { w: 2, h: 2 },
    hp: 1120,
    armour: 'structure',
    cost: { mats: 590, req: 55 },
    buildTime: 14,
    vision: 12,
    power: -26,
    requires: ['factory'],
    weapons: ['longRangeSamMissile'],
    // Heavier mount than the shared battery, so it traverses more slowly.
    turretRate: 1.1,
    variantOf: 'samBattery',
    national: true,
    description:
      'Russian long-range surface-to-air site. A taller mast and bigger rounds reach a third further than the shared battery, at forty per cent more material and a slower reload. It still cannot touch ground forces, so anything that walks into the site is unanswered.',
    icon: 'sam',
    hotkey: 'K',
  },
  {
    id: 'signalsBureau',
    name: 'Signals Bureau',
    shortName: 'SIGNALS',
    role: 'Research (national)',
    footprint: { w: 2, h: 2 },
    hp: 900,
    armour: 'structure',
    cost: { mats: 600, req: 30 },
    buildTime: 52,
    vision: 14,
    power: -30,
    requires: ['factory'],
    researchSpeed: 1.25,
    variantOf: 'researchCentre',
    national: true,
    description:
      'Belarusian signals bureau doubling as the national research centre. A compact listening station rather than a laboratory campus: it finishes each project a fifth faster and sees farther than the shared centre, but carries far less structure. Belarus-only, and it occupies the Research Centre slot.',
    icon: 'research',
    hotkey: 'R',
  },
  /*
   * Expansion-nation structure variants. Each substitutes a canonical slot, so
   * the family keeps its placement rules, footprint class, power draw and
   * production list; only the trade on survivability, cost or reach changes.
   */
  {
    id: 'garrisonBarracks',
    name: 'Garrison Barracks',
    shortName: 'GARRISON',
    role: 'Infantry production',
    footprint: { w: 3, h: 3 },
    hp: 1150,
    armour: 'structure',
    cost: { mats: 450, req: 0 },
    buildTime: 12,
    vision: 7,
    power: -8,
    produces: 'land',
    productionList: ['rifle', 'atgm', 'medic'],
    variantOf: 'barracks',
    national: true,
    description:
      'Finnish garrison barracks: a mobilisation hall rather than a field depot. Cheaper and three seconds quicker to raise than the shared barracks, with a fifth less structure — the point is to have one standing in every sector, not to keep any one of them.',
    icon: 'barracks',
    hotkey: 'B',
  },
  {
    id: 'kockumsYard',
    name: 'Kockums Shipyard',
    shortName: 'KOCKUMS',
    role: 'Naval production / repair',
    footprint: { w: 5, h: 5 },
    hp: 2900,
    armour: 'structure',
    cost: { mats: 1200, req: 165 },
    buildTime: 30,
    vision: 10,
    power: -20,
    requires: ['factory'],
    produces: 'naval',
    productionList: ['missileBoat', 'corvette', 'submarine', 'frigate'],
    shipyard: true,
    requiresWater: true,
    variantOf: 'shipyard',
    national: true,
    description:
      'Swedish hardened naval yard: blast-resistant halls and a covered fitting-out basin. A fifth more structure and two extra seconds to build than the shared shipyard, and it sees a little further over the approaches. It builds and services the same hulls.',
    icon: 'shipyard',
    hotkey: 'N',
  },
  {
    id: 'noorBattery',
    name: 'Noor Coast Launcher',
    shortName: 'NOOR',
    role: 'Static anti-ship defence',
    footprint: { w: 2, h: 2 },
    hp: 820,
    armour: 'structure',
    cost: { mats: 380, req: 35 },
    buildTime: 11,
    vision: 11,
    power: -12,
    requires: ['factory'],
    weapons: ['noorMissile'],
    turretRate: 1.6,
    requiresWater: true,
    variantOf: 'coastalBattery',
    national: true,
    description:
      'Iranian dispersed shore-launch site: a truck-borne launcher and a revetment instead of a hardened battery. Cheaper, quicker and much more fragile than the shared battery, with three tiles less reach — the doctrine is many sites, not one strongpoint.',
    icon: 'coastal',
    hotkey: 'L',
  },
  {
    id: 'entrenchedAtGun',
    name: 'Entrenched AT Gun',
    shortName: 'AT STRONGPOINT',
    role: 'Static anti-armour',
    footprint: { w: 2, h: 2 },
    hp: 1450,
    armour: 'structure',
    cost: { mats: 480, req: 35 },
    buildTime: 15,
    vision: 10,
    power: -10,
    weapons: ['atTurretGun'],
    turretRate: 2.0,
    variantOf: 'atTurret',
    national: true,
    description:
      'North Korean anti-tank strongpoint: the shared 76mm gun under a timber-and-concrete casemate. Nearly a third more structure for a little more material and two extra seconds, and a slower mount — a position built to be assaulted rather than to redeploy.',
    icon: 'atgun',
    hotkey: 'T',
  },
];

export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries(
  [...ROSTER, ...NATIONAL_BUILDINGS].map((b) => [b.id, b]),
);
export const BUILDING_LIST = ROSTER;

/** Registered national variants; deliberately excluded from the shared baseline. */
export const NATIONAL_BUILDING_LIST = NATIONAL_BUILDINGS;

/**
 * Canonical baseline slot for a structure, walking the whole `variantOf` chain
 * so a national variant of an alliance platform still reports the slot it
 * occupies. A broken chain reports the queried id rather than an unrelated
 * ancestor.
 */
export function buildingFamily(id: string): string {
  return resolveVariantChain(BUILDINGS, id).root;
}

/**
 * Structure families that must already stand completed before `id` can be
 * laid. A national variant inherits its canonical slot's requirements unless it
 * declares its own, so a substituted structure never escapes its family's gate.
 */
export function buildingRequirements(id: string): string[] {
  const def = BUILDINGS[id];
  if (!def) return [];
  if (def.requires) return def.requires;
  const root = buildingFamily(id);
  return root === id ? [] : BUILDINGS[root]?.requires ?? [];
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
