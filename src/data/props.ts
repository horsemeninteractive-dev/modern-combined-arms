/**
 * Placeable set dressing.
 *
 * A prop is scenery a map author places one at a time: a tree in a courtyard, a
 * boulder on a dune crest, a bus shelter at a junction the procedural scatter
 * never touches. Every kind names an instanced batch the renderer draws, so
 * authored props never cost a draw call per piece and cannot drift away from the
 * procedural scatter standing around them.
 *
 * The original eleven kinds reuse the batches procedural scatter already fills,
 * which is why a hand-placed bush sits in the same instanced mesh as the brush
 * the terrain generator grew. The other thirty-nine are street furniture, farm
 * kit, industrial clutter, field defences and wrecks: they have no procedural
 * counterpart, so each is its own batch with its own authored mesh.
 *
 * `ground` is the rule the validator enforces. A prop authored into deep water
 * is almost always a slip, and a warning at author time is cheaper than a
 * floating hay bale in the middle of a sea.
 */

/** Instanced batches procedural scatter already fills and authored props reuse. */
export type LegacyPropBatch =
  | 'trees'
  | 'rocks'
  | 'bushes'
  | 'shrubs'
  | 'tufts'
  | 'fences'
  | 'lamps'
  | 'signs'
  | 'poles'
  | 'rubble'
  | 'reeds';

export type PropKind =
  | 'tree'
  | 'rock'
  | 'bush'
  | 'shrub'
  | 'tuft'
  | 'reed'
  | 'lamp'
  | 'sign'
  | 'bench'
  | 'bin'
  | 'hydrant'
  | 'bollard'
  | 'busStop'
  | 'phoneBox'
  | 'mailbox'
  | 'kiosk'
  | 'planter'
  | 'trafficLight'
  | 'bikeRack'
  | 'picnicTable'
  | 'fence'
  | 'hayBale'
  | 'hayStack'
  | 'trough'
  | 'windpump'
  | 'grainSilo'
  | 'scarecrow'
  | 'tractorWreck'
  | 'drystoneWall'
  | 'pole'
  | 'crate'
  | 'crateStack'
  | 'pallet'
  | 'barrel'
  | 'dumpster'
  | 'container'
  | 'generator'
  | 'cableSpool'
  | 'tyreStack'
  | 'scaffold'
  | 'sandbagNest'
  | 'jerseyBarrier'
  | 'tankTrap'
  | 'ammoBoxes'
  | 'fuelDrum'
  | 'roadBlock'
  | 'rubble'
  | 'carWreck'
  | 'truckWreck'
  | 'busWreck';

/**
 * Instanced batch that draws a kind. Legacy kinds share a procedural batch; every
 * newer kind names itself, so the catalogue is the single source of truth for
 * which mesh an authored prop lands in.
 */
export type PropBatch = LegacyPropBatch | PropKind;

/** Palette section a kind is filed under in the Forge. */
export type PropGroup = 'nature' | 'street' | 'farm' | 'industry' | 'military' | 'ruined';

/** Palette order of the group headings. */
export const PROP_GROUPS: readonly PropGroup[] = [
  'nature',
  'street',
  'farm',
  'industry',
  'military',
  'ruined',
];

export interface PropDef {
  id: PropKind;
  name: string;
  /** Palette section. */
  group: PropGroup;
  /** Instanced batch that draws this kind. */
  batch: PropBatch;
  /**
   * Where the prop belongs. `land` is warned about when it is authored on a
   * water tile; `any` covers reeds, which grow in the shallows on purpose.
   */
  ground: 'land' | 'any';
  /** Size multiplier applied to the authored scale. */
  scale: number;
  /** One-line authoring note, shown in the Forge palette. */
  note: string;
}

const DEFS: readonly PropDef[] = [
  // ---------------------------------------------------------------- nature
  {
    id: 'tree',
    name: 'Tree',
    group: 'nature',
    batch: 'trees',
    ground: 'land',
    scale: 0.95,
    note: 'Canopy tree: soft cover, heavy concealment and a broken sight line.',
  },
  {
    id: 'rock',
    name: 'Boulder',
    group: 'nature',
    batch: 'rocks',
    ground: 'land',
    scale: 0.85,
    note: 'Loose stone: hard cover for infantry, awkward for wheels.',
  },
  {
    id: 'bush',
    name: 'Scrub bush',
    group: 'nature',
    batch: 'bushes',
    ground: 'land',
    scale: 1,
    note: 'Low scrub: concealment without a canopy.',
  },
  {
    id: 'shrub',
    name: 'Tall shrub',
    group: 'nature',
    batch: 'shrubs',
    ground: 'land',
    scale: 1,
    note: 'Leggy brush: breaks up a silhouette at infantry height.',
  },
  {
    id: 'tuft',
    name: 'Grass tuft',
    group: 'nature',
    batch: 'tufts',
    ground: 'land',
    scale: 0.9,
    note: 'Dry tuft: ground texture, no cover.',
  },
  {
    id: 'reed',
    name: 'Reed clump',
    group: 'nature',
    batch: 'reeds',
    ground: 'any',
    scale: 1,
    note: 'Reed bed; the only prop that belongs in the shallows.',
  },

  // ---------------------------------------------------------------- street
  {
    id: 'lamp',
    name: 'Street lamp',
    group: 'street',
    batch: 'lamps',
    ground: 'land',
    scale: 1,
    note: 'Kerbside lamp; the arm points along the instance yaw.',
  },
  {
    id: 'sign',
    name: 'Road sign',
    group: 'street',
    batch: 'signs',
    ground: 'land',
    scale: 1,
    note: 'Direction sign; the blades face the instance yaw.',
  },
  {
    id: 'bench',
    name: 'Park bench',
    group: 'street',
    batch: 'bench',
    ground: 'land',
    scale: 1,
    note: 'Slatted bench: a readable scrap of civic life on a pavement or square.',
  },
  {
    id: 'bin',
    name: 'Litter bin',
    group: 'street',
    batch: 'bin',
    ground: 'land',
    scale: 1,
    note: 'Pedestal bin. Small enough to line a street without hiding a unit.',
  },
  {
    id: 'hydrant',
    name: 'Fire hydrant',
    group: 'street',
    batch: 'hydrant',
    ground: 'land',
    scale: 1,
    note: 'Kerbside hydrant: a bright datum at a corner, and a good ambush marker.',
  },
  {
    id: 'bollard',
    name: 'Bollard',
    group: 'street',
    batch: 'bollard',
    ground: 'land',
    scale: 1,
    note: 'Pedestrian bollard; line them up to read a closed street.',
  },
  {
    id: 'busStop',
    name: 'Bus shelter',
    group: 'street',
    batch: 'busStop',
    ground: 'land',
    scale: 1,
    note: 'Shelter with a bench and glazing: the classic stop-line landmark.',
  },
  {
    id: 'phoneBox',
    name: 'Phone box',
    group: 'street',
    batch: 'phoneBox',
    ground: 'land',
    scale: 1,
    note: 'Glazed call box. A one-tile silhouette that says "town centre".',
  },
  {
    id: 'mailbox',
    name: 'Post box',
    group: 'street',
    batch: 'mailbox',
    ground: 'land',
    scale: 1,
    note: 'Pillar box on a post; the red blob that anchors a corner.',
  },
  {
    id: 'kiosk',
    name: 'News kiosk',
    group: 'street',
    batch: 'kiosk',
    ground: 'land',
    scale: 1,
    note: 'Awning booth with a counter: market square and station forecourt.',
  },
  {
    id: 'planter',
    name: 'Planter',
    group: 'street',
    batch: 'planter',
    ground: 'land',
    scale: 1,
    note: 'Stone trough with shrubs; soft dressing for hard landscaping.',
  },
  {
    id: 'trafficLight',
    name: 'Traffic light',
    group: 'street',
    batch: 'trafficLight',
    ground: 'land',
    scale: 1,
    note: 'Signal head on an arm; put two at a junction to read the crossing.',
  },
  {
    id: 'bikeRack',
    name: 'Bike rack',
    group: 'street',
    batch: 'bikeRack',
    ground: 'land',
    scale: 1,
    note: 'Two steel hoops. Street clutter for a school or station forecourt.',
  },
  {
    id: 'picnicTable',
    name: 'Picnic table',
    group: 'street',
    batch: 'picnicTable',
    ground: 'land',
    scale: 1,
    note: 'Table and benches: parks, laybys and the yard behind a village hall.',
  },

  // ------------------------------------------------------------------ farm
  {
    id: 'fence',
    name: 'Field fence',
    group: 'farm',
    batch: 'fences',
    ground: 'land',
    scale: 1,
    note: 'Post-and-rail boundary. Decoration only: props never block movement.',
  },
  {
    id: 'hayBale',
    name: 'Hay bale',
    group: 'farm',
    batch: 'hayBale',
    ground: 'land',
    scale: 1,
    note: 'Baled hay in the field: straw colour that reads from any zoom.',
  },
  {
    id: 'hayStack',
    name: 'Hay stack',
    group: 'farm',
    batch: 'hayStack',
    ground: 'land',
    scale: 1,
    note: 'Tiered stack; taller than a bale, so it breaks a hedgerow line.',
  },
  {
    id: 'trough',
    name: 'Water trough',
    group: 'farm',
    batch: 'trough',
    ground: 'land',
    scale: 1,
    note: 'Concrete trough in a paddock. Stands on land, not in the stream.',
  },
  {
    id: 'windpump',
    name: 'Wind pump',
    group: 'farm',
    batch: 'windpump',
    ground: 'land',
    scale: 1,
    note: 'Timber-and-steel pump: the one vertical that marks a farmstead.',
  },
  {
    id: 'grainSilo',
    name: 'Grain silo',
    group: 'farm',
    batch: 'grainSilo',
    ground: 'land',
    scale: 1,
    note: 'Ribbed steel bin with a filling spout: a co-op yard silhouette.',
  },
  {
    id: 'scarecrow',
    name: 'Scarecrow',
    group: 'farm',
    batch: 'scarecrow',
    ground: 'land',
    scale: 1,
    note: 'Cross and coat on a post. Reads as a figure until you look twice.',
  },
  {
    id: 'tractorWreck',
    name: 'Tractor wreck',
    group: 'farm',
    batch: 'tractorWreck',
    ground: 'land',
    scale: 1,
    note: 'Burnt tractor in a field gate: the farm version of a roadblock.',
  },
  {
    id: 'drystoneWall',
    name: 'Drystone wall',
    group: 'farm',
    batch: 'drystoneWall',
    ground: 'land',
    scale: 1,
    note: 'A short run of field wall; overlap several to bound a paddock.',
  },

  // -------------------------------------------------------------- industry
  {
    id: 'pole',
    name: 'Utility pole',
    group: 'industry',
    batch: 'poles',
    ground: 'land',
    scale: 1,
    note: 'Telegraph pole; the crossarm turns across the yaw.',
  },
  {
    id: 'crate',
    name: 'Crate',
    group: 'industry',
    batch: 'crate',
    ground: 'land',
    scale: 1,
    note: 'Timber crate: dock and depot filler, sized to a loading bay.',
  },
  {
    id: 'crateStack',
    name: 'Crate stack',
    group: 'industry',
    batch: 'crateStack',
    ground: 'land',
    scale: 1,
    note: 'A stack of crates at odd angles: reads as a working yard, not a grid.',
  },
  {
    id: 'pallet',
    name: 'Pallet',
    group: 'industry',
    batch: 'pallet',
    ground: 'land',
    scale: 1,
    note: 'Flat pallet stack. Low clutter that keeps a yard from looking swept.',
  },
  {
    id: 'barrel',
    name: 'Steel drum',
    group: 'industry',
    batch: 'barrel',
    ground: 'land',
    scale: 1,
    note: 'Ribbed 44-gallon drum; a yard, a checkpoint or a scrapyard.',
  },
  {
    id: 'dumpster',
    name: 'Skip',
    group: 'industry',
    batch: 'dumpster',
    ground: 'land',
    scale: 1,
    note: 'Open skip with a lid: back-alley cover for a city map.',
  },
  {
    id: 'container',
    name: 'Freight container',
    group: 'industry',
    batch: 'container',
    ground: 'land',
    scale: 1,
    note: 'Ribbed box container. Two in a row read as a dock or a field depot.',
  },
  {
    id: 'generator',
    name: 'Generator',
    group: 'industry',
    batch: 'generator',
    ground: 'land',
    scale: 1,
    note: 'Skid-mounted genset: the noisy box behind a field hospital.',
  },
  {
    id: 'cableSpool',
    name: 'Cable spool',
    group: 'industry',
    batch: 'cableSpool',
    ground: 'land',
    scale: 1,
    note: 'Timber drum of cable; roadside works and substation yards.',
  },
  {
    id: 'tyreStack',
    name: 'Tyre stack',
    group: 'industry',
    batch: 'tyreStack',
    ground: 'land',
    scale: 1,
    note: 'Stacked tyres: garage forecourt, race circuit or improvised barricade.',
  },
  {
    id: 'scaffold',
    name: 'Scaffold',
    group: 'industry',
    batch: 'scaffold',
    ground: 'land',
    scale: 1,
    note: 'Tube-and-board scaffold against a facade under repair.',
  },

  // -------------------------------------------------------------- military
  {
    id: 'sandbagNest',
    name: 'Sandbag nest',
    group: 'military',
    batch: 'sandbagNest',
    ground: 'land',
    scale: 1,
    note: 'Horseshoe of filled bags: a prepared position with a clear arc.',
  },
  {
    id: 'jerseyBarrier',
    name: 'Jersey barrier',
    group: 'military',
    batch: 'jerseyBarrier',
    ground: 'land',
    scale: 1,
    note: 'Concrete lane barrier; line them to close a road or a compound.',
  },
  {
    id: 'tankTrap',
    name: 'Tank trap',
    group: 'military',
    batch: 'tankTrap',
    ground: 'land',
    scale: 1,
    note: 'Crossed steel hedgehog; decoration, but it says "no armour here".',
  },
  {
    id: 'ammoBoxes',
    name: 'Ammo boxes',
    group: 'military',
    batch: 'ammoBoxes',
    ground: 'land',
    scale: 1,
    note: 'Stacked ammunition crates beside a position.',
  },
  {
    id: 'fuelDrum',
    name: 'Fuel drum',
    group: 'military',
    batch: 'fuelDrum',
    ground: 'land',
    scale: 1,
    note: 'Horizontal drum on cradles with a hand pump: a forward fuelling point.',
  },
  {
    id: 'roadBlock',
    name: 'Road block',
    group: 'military',
    batch: 'roadBlock',
    ground: 'land',
    scale: 1,
    note: 'Striped trestle barrier: a checkpoint that reads from across the map.',
  },

  // ---------------------------------------------------------------- ruined
  {
    id: 'rubble',
    name: 'Rubble heap',
    group: 'ruined',
    batch: 'rubble',
    ground: 'land',
    scale: 1,
    note: 'Collapsed masonry and rebar, for streets and yards.',
  },
  {
    id: 'carWreck',
    name: 'Car wreck',
    group: 'ruined',
    batch: 'carWreck',
    ground: 'land',
    scale: 1,
    note: 'Burnt saloon by the kerb: the street-corner wreck of every city map.',
  },
  {
    id: 'truckWreck',
    name: 'Truck wreck',
    group: 'ruined',
    batch: 'truckWreck',
    ground: 'land',
    scale: 1,
    note: 'Tipped lorry across a lane; a natural chokepoint to dress.',
  },
  {
    id: 'busWreck',
    name: 'Bus wreck',
    group: 'ruined',
    batch: 'busWreck',
    ground: 'land',
    scale: 1,
    note: 'Burnt-out bus: the long silhouette that makes a boulevard read as fought over.',
  },
];

/** Every placeable kind, in palette order. */
export const PROP_IDS: readonly PropKind[] = DEFS.map((def) => def.id);

export const PROPS: Record<PropKind, PropDef> = DEFS.reduce(
  (table, def) => {
    table[def.id] = def;
    return table;
  },
  {} as Record<PropKind, PropDef>,
);

/**
 * Batches the procedural scatter already fills. A kind whose batch is in here
 * reuses that instanced mesh; anything else owns an authored mesh.
 */
const SCATTER_BATCHES: ReadonlySet<string> = new Set([
  'trees',
  'rocks',
  'bushes',
  'shrubs',
  'tufts',
  'fences',
  'lamps',
  'signs',
  'poles',
  'rubble',
  'reeds',
]);

/** Kinds that name their own authored mesh instead of reusing a scatter batch. */
export const DECOR_PROP_IDS: readonly PropKind[] = PROP_IDS.filter(
  (id) => !SCATTER_BATCHES.has(PROPS[id].batch),
);

/** Whether a string names a placeable prop. */
export function isPropKind(value: string): value is PropKind {
  return Object.prototype.hasOwnProperty.call(PROPS, value);
}
