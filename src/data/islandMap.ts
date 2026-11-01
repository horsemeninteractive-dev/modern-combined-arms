import { Field, assemble, placeBase, type MapMeta } from './competitiveMaps';
import { Overlay, Terrain, packOverlay } from '../sim/terrain';
import type { Scenario, ScenarioSettings } from '../sim/scenario';

/**
 * Seventeen — Cormorant Isle.
 *
 * The roster had coastlines but no island: every map joined its starts by land
 * and left the sea as scenery. This one is one island in open water, ringed by a
 * beach and cut by four deep bays, and it is built so naval play is a real
 * option rather than a decoration:
 *
 * - The outer beach is authored at the interior's elevation. A shipyard or a
 *   coastal battery needs a level 5x5 plot with navigable water alongside, and
 *   a beach band dropped to sea level cannot host one. Keeping the whole coast
 *   at one level is what makes harbour building possible.
 * - The four bays cut through beach and grass to open water, so a hull can come
 *   inland and shell the shore road, and a defender can put a shipyard in the
 *   bay head with the yard protected by land on three sides.
 * - Everything strategic is inland and reachable on tracks from all four
 *   starts, so a player who ignores the sea is never locked out of the match —
 *   they only cede the flanks, the bombardment angles and the ore on the point.
 */

/** Deep water over the whole map, then the island is carved out of it. */
export function createCormorantIsle(): Scenario {
  // 132 rather than the pool's other 120/128 boards: a square is the only
  // four-way-symmetric shape, and the island needs the extra water margin for
  // the bays to reach it without touching the map edge.
  const field = new Field(132);
  const q = field.quarter;
  const c = q - 1;

  // Open sea first. Everything after this is the island, so any tile left alone
  // is water by definition.
  field.rect(0, 0, field.size - 1, field.size - 1, Terrain.DeepWater, 0);
  // Beach ring, then the interior, both at elevation 1: a level coast is the
  // foundation a harbour needs.
  field.disc(c, c, 52, Terrain.Sand, 1);
  field.disc(c, c, 46, Terrain.Grass, 1);
  // Four deep bays. Each one cuts through beach and the first rows of grass, so
  // its head is a landlocked harbour with water reaching the middle of the map.
  field.disc(c, 6, 14, Terrain.DeepWater, 0);
  // Shallow shelf along every coast: a landing beach, not a deep-water cliff.
  field.shelf(Terrain.ShallowWater, 3);

  // Central massif. Worn rock is passable by every class, so the centre is
  // contested ground rather than a wall.
  field.disc(c, c, 15, Terrain.Rocks, 2);
  field.disc(c, c, 7, Terrain.Rocks, 3);
  // Wooded belt on the landward shoulder of each bay.
  field.disc(48, 52, 9, Terrain.Forest, 1);
  field.disc(76, 44, 7, Terrain.Forest, 2);
  // Farmland terrace on the southern approach, with hedgerows across it.
  field.disc(c, 42, 10, Terrain.Farmland, 1);
  field.overlayDisc(c, 42, 10, packOverlay(Overlay.Crop, 2));
  field.overlayRoute(
    [
      [50, 40],
      [58, 40],
      [66, 42],
    ],
    packOverlay(Overlay.Hedge, 1),
  );
  // Dune belt behind the west beach and a reed bed at the south bay head.
  field.disc(36, c, 6, Terrain.Dune, 2);
  field.disc(52, 88, 7, Terrain.Marsh);
  field.overlayDisc(52, 88, 7, packOverlay(Overlay.Reeds, 2));
  // Scrub where the island's interior drains.
  // Scrub sits on the eastern shoulder, clear of the massif: painting it over
  // the massif's middle step would put level-1 ground against the level-3
  // outcrop, which is a two-step climb and closes the centre to wheeled units.
  field.disc(92, 64, 6, Terrain.Scrub, 1);

  // A deep cut across the island's north-east shoulder, with the road carried
  // over it on a bridge. The cut is the one place on the island where armour
  // cannot simply drive where it likes: the span is the crossing, and shooting
  // it down closes the lane until an engineer re-decks it.
  field.rect(51, 8, 52, 52, Terrain.DeepWater, 0);
  field.overlayDisc(50, 40, 3, packOverlay(Overlay.Mud, 1));

  placeBase(field, {
    post: [34, 34],
    start: [40, 40],
    pad: [32, 32, 44, 44],
    // The base road runs up to the west bank and stops: the deck carries it the
    // rest of the way, so no road tile is painted through the channel.
    road: [
      [44, 40],
      [44, 44],
      [50, 44],
    ],
    ore: [
      [46, 30, 3, 380],
      [30, 46, 3, 380],
      // The point's deposit is the contested one: it is the only ore that sits
      // between the centre and the beach.
      [52, 46, 2, 420],
    ],
  });

  // Far bank of the cut: the road resumes and runs on to the centre.
  field.route(
    [
      [53, 44],
      [57, 48],
      [c, c],
    ],
    Terrain.Road,
  );
  // The span over the cut, one per quadrant.
  field.bridge(50, 42);

  // Objectives, one per quadrant plus the centre.
  field.neutral('relay', q - 18, q - 18);
  field.neutral('supplyDepot', c, q - 16);
  field.neutral('radarStation', 76, 50);
  // Shelters: one of each new kind, so a single map exercises the whole set.
  field.neutral('farmhouse', 56, 44);
  field.neutral('chapel', 44, 58);
  field.neutral('constabulary', 72, 72);
  field.neutral('watchtower', c, 38);
  field.neutral('ruin', 46, 62);
  // The centre sits on the massif's middle step, not at sea level: a 2x2 hole
  // at elevation 1 inside a level-3 outcrop is a two-step climb, which wheeled
  // movement refuses — the objective has to be reachable by every class.
  field.centreBlock(Terrain.Road, 2);
  field.centreStructure('relay');

  return assemble(
    field,
    {
      id: 'cormorant-isle',
      name: 'Cormorant Isle',
      description:
        'A single island in open water. Four deep bays give hulls a way inland, a level beach ring makes harbour building possible, and the tracks between the bases cross a rocky centre. Naval is optional and never free: every ship is a tank you did not build.',
      targetSize: 'large',
    } satisfies MapMeta,
    [40, 40],
    [
      'Destroy the opposing Command Post.',
      'Hold the centre relay on the massif.',
      'Build on the beach: a shipyard turns the sea into a second front.',
      'Watch the bays. A corvette can shell the shore road from inside them.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_017, timeOfDay: 'dawn', weather: 'clear' } satisfies Partial<ScenarioSettings> & {
      seed: number;
    },
  );
}
