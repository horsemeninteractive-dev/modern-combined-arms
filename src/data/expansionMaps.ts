import {
  Field,
  assemble,
  placeBase,
  type MapMeta,
} from './competitiveMaps';
import { Overlay, Terrain, packOverlay } from '../sim/terrain';
import { phaseSettings, type Scenario, type ScenarioSettings } from '../sim/scenario';

/**
 * The second half of the competitive roster: maps twelve to sixteen.
 *
 * They are built with exactly the same quadrant library as the first eleven
 * (`Field`, `placeBase`, `assemble`), so each one is four-way rotationally
 * symmetric by construction and audited the same way. The split is purely for
 * file size: one module per eight maps was becoming unreadable.
 */

/* ------------------------------------------------------------------ */
/* 12 — Granite Steps                                                  */
/* ------------------------------------------------------------------ */

/**
 * Rocky uplands. Impassable granite ridges divide the quadrant into terraced
 * steps; the passes are worn rocky ground that costs wheels dearly, so this is
 * tracked-vehicle and infantry country. Guns that take the upper step can see
 * most of the map.
 */
export function createGraniteSteps(): Scenario {
  const field = new Field(108);
  const q = field.quarter;

  // Ridges shape three steps: low ground out by the base, then 2 and 3.
  field.route(
    [
      [16, 30],
      [30, 30],
    ],
    Terrain.Rock,
    2,
    1,
  );
  field.route(
    [
      [30, 16],
      [30, 30],
    ],
    Terrain.Rock,
    2,
    1,
  );
  // The inner ridge has a gap at its midpoint: a continuous wall would fence
  // the centre relay off from every slot, which the accessibility audit catches.
  field.route(
    [
      [34, 44],
      [38, 40],
    ],
    Terrain.Rock,
    2,
    2,
  );
  field.route(
    [
      [40, 38],
      [44, 34],
    ],
    Terrain.Rock,
    2,
    2,
  );
  // Worn rock either side of the passes: passable, bad for wheels, good cover.
  field.disc(28, 24, 5, Terrain.Rocks, 1);
  field.disc(24, 28, 5, Terrain.Rocks, 1);
  field.disc(38, 38, 6, Terrain.Rocks, 2);
  field.disc(44, 44, 5, Terrain.Rocks, 3);
  field.disc(18, 18, 4, Terrain.Scrub, 2);
  field.overlayDisc(38, 38, 5, packOverlay(Overlay.Crater, 1));

  placeBase(field, {
    post: [9, 9],
    start: [16, 16],
    pad: [7, 7, 24, 24],
    road: [
      [24, 16],
      [30, 20],
      [38, 30],
      [q - 2, q - 2],
    ],
    ore: [
      [18, 9, 3, 340],
      [9, 18, 2, 300],
      [40, 36, 2, 360],
    ],
  });

  field.neutral('relay', q - 10, q - 10);
  field.neutral('radarStation', 34, 42);
  // One step above the low ground: a two-step pedestal is a wall to wheels and
  // tracks, and the audit would rightly call the centre unreachable.
  field.centreBlock(Terrain.Rocks, 2);
  field.centreStructure('relay');

  // Chapel on the steps: stone walls and a bell tower that sees the whole stair.
  field.neutral('chapel', 34, 24);
  return assemble(
    field,
    {
      id: 'granite-steps',
      name: 'Granite Steps',
      description:
        'Granite ridges cut the ground into three terraces. The passes are worn rock that punishes wheels, so tracks and infantry own the map, and whoever holds the upper step can see and shell the ones below.',
      targetSize: 'large',
    } satisfies MapMeta,
    [16, 16],
    [
      'Destroy the opposing Command Post.',
      'Force the passes and hold the upper terraces.',
      'Cover the rocky approaches before moving onto them.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_012, timeOfDay: 'day', weather: 'clear' } satisfies Partial<ScenarioSettings> & {
      seed: number;
    },
  );
}

/* ------------------------------------------------------------------ */
/* 13 — Saffron Erg                                                    */
/* ------------------------------------------------------------------ */

/**
 * Deep desert. Long dunes run across the quadrant, giving elevation and
 * observation but costing heavy vehicles dearly, and the sand basins between
 * them are wide open. The largest competitive map: room to manoeuvre, to
 * reconnoitre and to lose contact.
 */
export function createSaffronErg(): Scenario {
  const field = new Field(128);
  const q = field.quarter;

  // Dune seas with a raised crest line: observation ground that is slow to hold.
  field.disc(30, 18, 10, Terrain.Dune, 1);
  field.disc(18, 30, 10, Terrain.Dune, 1);
  field.route(
    [
      [40, 20],
      [30, 30],
    ],
    Terrain.Dune,
    3,
    2,
  );
  field.route(
    [
      [20, 40],
      [30, 30],
    ],
    Terrain.Dune,
    3,
    2,
  );
  // Sand basins, where the vehicle fight actually happens.
  field.disc(16, 16, 6, Terrain.Sand);
  field.disc(46, 34, 8, Terrain.Sand);
  field.disc(34, 46, 8, Terrain.Sand);
  field.disc(48, 14, 4, Terrain.Rocks);
  field.overlayDisc(40, 40, 5, packOverlay(Overlay.Crater, 1));

  placeBase(field, {
    post: [10, 10],
    start: [18, 18],
    pad: [8, 8, 28, 28],
    ground: Terrain.Sand,
    road: [
      [28, 18],
      [38, 18],
      [46, 34],
      [q - 2, q - 2],
    ],
    ore: [
      [22, 10, 3, 360],
      [10, 22, 3, 360],
      [46, 40, 3, 420],
    ],
  });

  field.neutral('relay', q - 10, q - 10);
  field.neutral('supplyDepot', 44, 24);
  field.neutral('radarStation', 30, 50);
  field.centreBlock(Terrain.Sand, 2);
  field.centreStructure('relay');

  // A dune lookout: thirteen tiles of vision over the erg, and no shelter at all.
  field.neutral('watchtower', 41, 29);
  return assemble(
    field,
    {
      id: 'saffron-erg',
      name: 'Saffron Erg',
      description:
        'The largest battlefield in the pool: dune crests that give observation, wide sand basins that reward manoeuvre, and enough distance for reconnaissance and long-range fire to decide a battle.',
      targetSize: 'large',
    } satisfies MapMeta,
    [18, 18],
    [
      'Destroy the opposing Command Post.',
      'Take the dune crests and hold the centre relay.',
      'Use the radar station to find the enemy in open desert.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_013, timeOfDay: 'day', weather: 'clear' } satisfies Partial<ScenarioSettings> & {
      seed: number;
    },
  );
}

/* ------------------------------------------------------------------ */
/* 14 — Ashcross Sprawl                                                */
/* ------------------------------------------------------------------ */

/**
 * The city map. A grid of dense built-up blocks with streets between them:
 * infantry holds the buildings and the streets are the only armour routes, so
 * the fight is about which intersections you can cover.
 */
export function createAshcrossSprawl(): Scenario {
  const field = new Field(92);
  const q = field.quarter;

  // Residential blocks: dense ground, with streets cut through afterwards.
  field.rect(16, 16, 25, 25, Terrain.DenseUrban);
  field.rect(11, 27, 22, 33, Terrain.DenseUrban);
  field.rect(27, 11, 33, 22, Terrain.DenseUrban);
  field.rect(29, 29, 36, 36, Terrain.DenseUrban);
  field.route(
    [
      [10, 26],
      [36, 26],
    ],
    Terrain.Road,
    2,
  );
  field.route(
    [
      [26, 10],
      [26, 36],
    ],
    Terrain.Road,
    2,
  );
  field.route(
    [
      [16, 16],
      [16, 26],
      [26, 26],
    ],
    Terrain.Road,
    1,
  );
  field.route(
    [
      [26, 26],
      [36, 26],
      [36, 36],
    ],
    Terrain.Road,
    1,
  );
  // Rubble and craters where the shelling was heaviest.
  field.disc(20, 20, 3, Terrain.Urban);
  field.overlayDisc(20, 20, 3, packOverlay(Overlay.Crater, 2));
  field.overlayDisc(32, 24, 3, packOverlay(Overlay.Crater, 1));

  placeBase(field, {
    post: [8, 8],
    start: [14, 14],
    pad: [6, 6, 20, 20],
    road: [
      [20, 14],
      [22, 20],
      [26, 26],
    ],
    ore: [
      [16, 8, 2, 320],
      [8, 16, 2, 320],
      [32, 32, 2, 360],
    ],
  });

  field.neutral('tenement', 18, 30);
  field.neutral('ruin', 30, 18);
  // The precinct house holds the north junction, and the burned shell beside it
  // is the cheap position in the same street.
  field.neutral('constabulary', 24, 11);
  field.neutral('ruin', 33, 24);
  field.neutral('relay', q - 7, q - 7);
  field.centreBlock(Terrain.Urban);
  field.centreStructure('relay');

  return assemble(
    field,
    {
      id: 'ashcross-sprawl',
      name: 'Ashcross Sprawl',
      description:
        'A dense city grid. Infantry holds the blocks, the streets are the only armour routes, and every intersection is a fight. Nowhere is safe to stand in the open.',
      targetSize: 'medium',
    } satisfies MapMeta,
    [14, 14],
    [
      'Destroy the opposing Command Post.',
      'Clear the blocks and take the centre relay.',
      'Garrison the tenements to lock the streets.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_014, timeOfDay: 'dusk', weather: 'overcast' } satisfies Partial<ScenarioSettings> & {
      seed: number;
    },
  );
}

/* ------------------------------------------------------------------ */
/* 15 — Freight Yards                                                  */
/* ------------------------------------------------------------------ */

/**
 * Industrial ground. Concrete hardstanding gives excellent mobility for every
 * class, so the map is fast and open in the middle; the freight buildings and
 * storage compounds provide the cover, and the yards themselves are buildable,
 * which makes forward expansion unusually aggressive.
 */
export function createFreightYards(): Scenario {
  const field = new Field(116);
  const q = field.quarter;

  // Hardstanding across the inner half of the quadrant.
  field.disc(34, 34, 16, Terrain.Industrial);
  field.rect(24, 12, 44, 22, Terrain.Industrial);
  field.rect(12, 24, 22, 44, Terrain.Industrial);
  // Rail spurs and service roads threading the yards.
  field.route(
    [
      [14, 36],
      [36, 14],
    ],
    Terrain.Road,
    2,
  );
  field.route(
    [
      [18, 46],
      [46, 18],
    ],
    Terrain.Road,
    1,
  );
  field.route(
    [
      [24, 39],
      [39, 24],
    ],
    Terrain.Road,
    1,
  );
  // Storehouses and compounds, and the scars of a hit on the yards.
  field.rect(30, 30, 38, 38, Terrain.Urban);
  field.disc(46, 46, 4, Terrain.Rocks, 1);
  field.overlayDisc(34, 34, 6, packOverlay(Overlay.Crater, 1));
  field.overlayDisc(26, 26, 4, packOverlay(Overlay.Crater, 2));
  field.overlayDisc(44, 20, 3, packOverlay(Overlay.Mud, 1));

  placeBase(field, {
    post: [9, 9],
    start: [16, 16],
    pad: [7, 7, 24, 24],
    road: [
      [24, 16],
      [34, 16],
      [42, 30],
      [q - 2, q - 2],
    ],
    ore: [
      [20, 9, 2, 320],
      [9, 20, 2, 320],
      [40, 40, 3, 420],
    ],
  });

  field.neutral('relay', q - 9, q - 9);
  field.neutral('supplyDepot', 30, 20);
  field.neutral('radarStation', 20, 46);
  // The goods shed at the yard edge: five infantry can hold the gap between
  // the hardstanding and the compounds. A square footprint, because an
  // authored shelter is stamped at all four rotations of the quadrant.
  field.neutral('freightShed', 39, 33);
  field.centreBlock(Terrain.Industrial);
  field.centreStructure('relay');

  return assemble(
    field,
    {
      id: 'freight-yards',
      name: 'Freight Yards',
      description:
        'Concrete rail yards and hardstanding: the fastest ground in the pool, so the fight is mobile and the middle is wide open. Freight buildings give cover, and the yards themselves can be built on.',
      targetSize: 'large',
    } satisfies MapMeta,
    [16, 16],
    [
      'Destroy the opposing Command Post.',
      'Hold the yard roads and the centre relay.',
      'Capture the forward depot to fund an expansion into the yards.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_015, timeOfDay: 'day', weather: 'overcast' } satisfies Partial<ScenarioSettings> & {
      seed: number;
    },
  );
}

/* ------------------------------------------------------------------ */
/* 16 — Silt Delta                                                     */
/* ------------------------------------------------------------------ */

/**
 * River delta. Braided shallow channels and silt islands: the water is wadeable
 * everywhere, so no route is closed, but every crossing is slow and the reed
 * banks along it conceal whoever is waiting there. Expansion is a series of
 * exposed crossings rather than a single front.
 */
export function createSiltDelta(): Scenario {
  const field = new Field(136);
  const q = field.quarter;

  // Braided channels: shallow, so every class can cross, and slow enough that
  // a crossing can be contested.
  field.route(
    [
      [12, 40],
      [40, 12],
    ],
    Terrain.ShallowWater,
    2,
    0,
  );
  field.route(
    [
      [24, 52],
      [52, 24],
    ],
    Terrain.ShallowWater,
    2,
    0,
  );
  field.route(
    [
      [30, 30],
      [48, 12],
    ],
    Terrain.ShallowWater,
    1,
    0,
  );
  // Silt banks and reed beds between the channels.
  field.disc(30, 30, 8, Terrain.Marsh);
  field.disc(44, 22, 5, Terrain.Marsh);
  field.disc(22, 44, 5, Terrain.Marsh);
  field.overlayDisc(30, 30, 8, packOverlay(Overlay.Reeds, 2));
  field.overlayDisc(44, 22, 5, packOverlay(Overlay.Reeds, 1));
  field.overlayDisc(22, 44, 5, packOverlay(Overlay.Reeds, 1));
  // Causeways: the drained ground, and the fastest way across the delta.
  field.recolour(
    [
      [18, 48],
      [q - 6, q - 6],
    ],
    Terrain.Marsh,
    Terrain.Farmland,
    2,
  );
  field.recolour(
    [
      [48, 18],
      [q - 6, q - 6],
    ],
    Terrain.Marsh,
    Terrain.Farmland,
    2,
  );
  field.disc(22, 40, 4, Terrain.Mud);
  field.overlayDisc(40, 40, 5, packOverlay(Overlay.Crop, 2));
  field.overlayRoute(
    [
      [24, 40],
      [40, 24],
    ],
    packOverlay(Overlay.Mud, 1),
    2,
  );

  placeBase(field, {
    post: [10, 10],
    start: [18, 18],
    pad: [8, 8, 28, 28],
    road: [
      [28, 18],
      [36, 26],
      [46, 40],
      [q - 2, q - 2],
    ],
    ore: [
      [24, 10, 3, 360],
      [10, 24, 3, 360],
      [52, 48, 3, 440],
    ],
  });

  field.neutral('relay', q - 10, q - 10);
  field.neutral('supplyDepot', 34, 30);
  field.neutral('radarStation', 48, 34);
  // A farmstead on the drained causeway and a chapel on the silt bank: the two
  // landmarks that tell the player where they are on an otherwise flat delta.
  field.neutral('farmhouse', 40, 42);
  field.neutral('chapel', 26, 36);
  field.centreBlock(Terrain.Farmland);
  field.centreStructure('relay');

  return assemble(
    field,
    {
      id: 'silt-delta',
      name: 'Silt Delta',
      description:
        'Braided shallow channels between silt islands and reed banks. Every crossing is wadeable, so nothing is closed off — but each one is slow, exposed, and a good place to be ambushed.',
      targetSize: 'large',
    } satisfies MapMeta,
    [18, 18],
    [
      'Destroy the opposing Command Post.',
      'Cross the delta and hold the centre relay.',
      'Screen your crossings with the reed banks.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_016, timeOfDay: 'dawn', weather: 'rain' } satisfies Partial<ScenarioSettings> & {
      seed: number;
    },
  );
}

/** Re-exported so a caller can prefill a phase without importing two modules. */
export { phaseSettings };
