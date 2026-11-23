/**
 * The Outbreak theatres.
 *
 * Each map is a purpose-built survival battlefield, not a skirmish board with a
 * Compost Post dropped on it: the horde's approaches, the ground the base grows
 * into, and the buildings worth holding are all authored together. Four maps
 * ship, each asking a different question of the same mode:
 *
 * - Relay Basin — the open basin: four roads into a central apron.
 * - Civic Square — the city clearing: a free build compound inside the blocks.
 * - Tidewall Quay — the harbour: water closes one approach, the piers make axes
 *   of their own and the warehouses are the only cover on the quay.
 * - Frostline Junction — the rail yard: long sightlines down the tracks, slag
 *   heaps for cover and sheds that make the yard worth fighting for.
 *
 * A map's structures are the map's argument. Garrisonable blocks are placed so
 * every approach has cover the infantry can actually use, and the capturable
 * objectives (relays, supply depots, a radar station) sit where taking them
 * costs the player a walk at the exact moment the next wave is forming.
 */
import { BUILDINGS } from '../data/buildings';
import { Terrain, inBounds, tileIndex, type TerrainId } from '../sim/terrain';
import type { ScenarioStructure, ScenarioTile, ScenarioUnit } from '../sim/scenario';
import type { WeatherKind } from '../sim/weather';
import type { OutbreakEntryRegion } from './types';

export interface OutbreakDraft {
  tiles: ScenarioTile[];
  structures: ScenarioStructure[];
  units: ScenarioUnit[];
}

/** The brush every map is painted with. */
export class Painter {
  constructor(readonly draft: OutbreakDraft, readonly size: number) {}

  set(x: number, z: number, terrain: TerrainId, elevation?: number, ore?: number): void {
    if (!inBounds(this.size, this.size, x, z)) return;
    const tile = this.draft.tiles[tileIndex(this.size, x, z)];
    tile.t = terrain;
    if (elevation !== undefined) tile.e = elevation;
    if (ore !== undefined) tile.o = ore;
  }

  get(x: number, z: number): ScenarioTile | null {
    if (!inBounds(this.size, this.size, x, z)) return null;
    return this.draft.tiles[tileIndex(this.size, x, z)];
  }

  rect(x0: number, z0: number, x1: number, z1: number, terrain: TerrainId, elevation?: number): void {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) this.set(x, z, terrain, elevation);
    }
  }

  /** A road band, only replacing ground that is not rock or water. */
  road(x0: number, z0: number, x1: number, z1: number): void {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!inBounds(this.size, this.size, x, z)) continue;
        const tile = this.draft.tiles[tileIndex(this.size, x, z)];
        if (tile.t === Terrain.DeepWater || tile.t === Terrain.ShallowWater) continue;
        tile.t = Terrain.Road;
      }
    }
  }

  /** A material deposit, only on ground the deposit belongs on. */
  ore(
    cx: number,
    cz: number,
    radius: number,
    amount: number,
    ground: readonly TerrainId[] = [Terrain.Grass],
  ): void {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const tile = this.get(cx + dx, cz + dz);
        if (!tile || !ground.includes(tile.t as TerrainId)) continue;
        tile.o = amount;
      }
    }
  }

  /** Rock rim: the map's own wall, three levels high. */
  border(): void {
    for (let x = 0; x < this.size; x++) {
      for (const z of [0, 1, this.size - 2, this.size - 1]) this.set(x, z, Terrain.Rock, 3);
    }
    for (let z = 0; z < this.size; z++) {
      for (const x of [0, 1, this.size - 2, this.size - 1]) this.set(x, z, Terrain.Rock, 3);
    }
  }

  /**
   * Place a structure on its own hardstanding.
   *
   * Every footprint gets graded first: a shelter dropped on a ridge or in a
   * stand of trees would be an authored error, so the pad is painted before the
   * building is recorded. `pad` is the ground the block stands on, which is how
   * a city block reads as paved city and a depot reads as a depot yard.
   */
  structure(
    defId: string,
    owner: number,
    x: number,
    z: number,
    pad: TerrainId = Terrain.Industrial,
  ): void {
    const footprint = BUILDINGS[defId]?.footprint ?? { w: 1, h: 1 };
    for (let dz = 0; dz < footprint.h; dz++) {
      for (let dx = 0; dx < footprint.w; dx++) this.set(x + dx, z + dz, pad, 1, 0);
    }
    this.draft.structures.push({ defId, owner, x, z });
  }

  unit(defId: string, owner: number, x: number, z: number): void {
    this.draft.units.push({ defId, owner, x, z });
  }
}

export interface OutbreakMapDefinition {
  id: string;
  name: string;
  /** Two-word chip label for the map picker. */
  tag: string;
  /** The one-line theme the picker prints beside the name. */
  theme: string;
  blurb: string;
  /** The deploy button's own order, in the mode's voice. */
  order: string;
  size: number;
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night';
  weather: WeatherKind;
  entryRegions: readonly OutbreakEntryRegion[];
  paint(p: Painter): void;
}

const SIZE = 96;
const CENTRE = SIZE / 2;

/* ------------------------------------------------------------------ */
/* Relay Basin — the open basin                                        */
/* ------------------------------------------------------------------ */

const BASIN_ENTRIES: readonly OutbreakEntryRegion[] = Object.freeze([
  { id: 'north-road', name: 'North road', x: CENTRE, z: 5, radius: 5 },
  { id: 'east-road', name: 'East road', x: SIZE - 5, z: CENTRE, radius: 5 },
  { id: 'south-road', name: 'South road', x: CENTRE, z: SIZE - 5, radius: 5 },
  { id: 'west-road', name: 'West road', x: 5, z: CENTRE, radius: 5 },
  { id: 'north-east-gap', name: 'North-east gap', x: 78, z: 18, radius: 4 },
  { id: 'south-west-gap', name: 'South-west gap', x: 18, z: 78, radius: 4 },
]);

/**
 * Tile the defensive basin.
 *
 * The centre is left open: a 4×4 Command Post placed at tile 46,46 has its
 * footprint centred on tile centre 48.0 — the exact middle of the map — and the
 * apron around it has room for the first ring of emplacements. Four roads meet
 * the apron; the diagonals carry rock and forest, which is what makes the roads
 * the fast way in and the diagonals the slow, covered way.
 */
function paintBasin(p: Painter): void {
  p.border();

  // The apron: open, fast ground the base grows into.
  p.rect(34, 34, 61, 61, Terrain.Grass, 1);
  // A concrete hardstanding under the command area, so the base reads as a base.
  p.rect(42, 42, 53, 53, Terrain.Industrial, 1);

  // Four approaches, seven tiles wide, straight from the map edge.
  p.road(CENTRE - 3, 2, CENTRE + 3, 36);
  p.road(CENTRE - 3, SIZE - 37, CENTRE + 3, SIZE - 3);
  p.road(2, CENTRE - 3, 36, CENTRE + 3);
  p.road(SIZE - 37, CENTRE - 3, SIZE - 3, CENTRE + 3);

  // Rock shoulders on the roads: the lane is wide enough for a horde and narrow
  // enough that a pair of turrets can cover it.
  for (const z of [22, 30, 66, 74]) {
    p.rect(CENTRE - 8, z, CENTRE - 5, z + 2, Terrain.Rock, 2);
    p.rect(CENTRE + 5, z, CENTRE + 8, z + 2, Terrain.Rock, 2);
  }
  for (const x of [22, 30, 66, 74]) {
    p.rect(x, CENTRE - 8, x + 2, CENTRE - 5, Terrain.Rock, 2);
    p.rect(x, CENTRE + 5, x + 2, CENTRE + 8, Terrain.Rock, 2);
  }

  // Diagonal belts: the slow, covered routes into the base.
  p.rect(12, 12, 26, 20, Terrain.Forest, 1);
  p.rect(16, 20, 22, 30, Terrain.Forest, 1);
  p.rect(70, 12, 84, 20, Terrain.Forest, 2);
  p.rect(74, 20, 80, 30, Terrain.Forest, 2);
  p.rect(12, 76, 26, 84, Terrain.Forest, 1);
  p.rect(16, 66, 22, 76, Terrain.Forest, 1);
  p.rect(70, 76, 84, 84, Terrain.Forest, 2);
  p.rect(74, 66, 80, 76, Terrain.Forest, 2);

  // High ground at the four corners of the inner ring: worth holding, awkward
  // to hold, and never on the shortest path to the Command Post.
  p.rect(30, 30, 33, 33, Terrain.Rocks, 3);
  p.rect(62, 30, 65, 33, Terrain.Rocks, 3);
  p.rect(30, 62, 33, 65, Terrain.Rocks, 3);
  p.rect(62, 62, 65, 65, Terrain.Rocks, 3);

  // Scrub and broken ground inside the apron: cover for infantry, no obstacle
  // for a horde, and a reason not to fight everything in the open.
  p.rect(38, 38, 41, 40, Terrain.Scrub, 1);
  p.rect(54, 38, 57, 40, Terrain.Scrub, 1);
  p.rect(38, 55, 41, 57, Terrain.Scrub, 1);
  p.rect(54, 55, 57, 57, Terrain.Scrub, 1);

  // Deposits outside the opening perimeter, on the four quarter-lines.
  p.ore(20, CENTRE, 3, 320);
  p.ore(SIZE - 21, CENTRE, 3, 320);
  p.ore(CENTRE, 20, 3, 320);
  p.ore(CENTRE, SIZE - 21, 3, 320);
  // A second, richer seam beside each road further out.
  p.ore(12, CENTRE + 6, 2, 300);
  p.ore(SIZE - 13, CENTRE + 6, 2, 300);
  p.ore(CENTRE + 6, 12, 2, 300);
  p.ore(CENTRE + 6, SIZE - 13, 2, 300);
  p.ore(26, 26, 2, 260);
  p.ore(SIZE - 27, 26, 2, 260);
  p.ore(26, SIZE - 27, 2, 260);
  p.ore(SIZE - 27, SIZE - 27, 2, 260);
  p.ore(29, 21, 2, 280);
  p.ore(SIZE - 30, 21, 2, 280);
  p.ore(29, SIZE - 22, 2, 280);
  p.ore(SIZE - 30, SIZE - 22, 2, 280);
  p.ore(CENTRE, 34, 2, 240);
  p.ore(CENTRE, SIZE - 35, 2, 240);
  p.ore(34, CENTRE + 6, 2, 240);
  p.ore(SIZE - 35, CENTRE + 6, 2, 240);

  // Meaningful ground to fight over: two supply depots, two relays, two bunkers
  // and ruins on the approaches.
  const neutral = -1;
  p.structure('supplyDepot', neutral, 24, 40);
  p.structure('supplyDepot', neutral, 66, 52);
  p.structure('relay', neutral, CENTRE + 2, 24);
  p.structure('relay', neutral, CENTRE - 5, 68);
  p.structure('bunker', neutral, 40, 24);
  p.structure('bunker', neutral, 52, 68);
  p.structure('warehouse', neutral, 20, 54);
  p.structure('warehouse', neutral, 72, 38);
  p.structure('ruin', neutral, 34, 30);
  p.structure('ruin', neutral, 60, 62);
  p.structure('watchtower', neutral, 30, 46);
  p.structure('watchtower', neutral, 64, 47);
}

/* ------------------------------------------------------------------ */
/* Civic Square — the city clearing                                    */
/* ------------------------------------------------------------------ */

const CITY_ENTRIES: readonly OutbreakEntryRegion[] = Object.freeze([
  { id: 'north-avenue', name: 'North avenue', x: CENTRE, z: 4, radius: 4 },
  { id: 'east-avenue', name: 'East avenue', x: SIZE - 4, z: CENTRE, radius: 4 },
  { id: 'south-avenue', name: 'South avenue', x: CENTRE, z: SIZE - 4, radius: 4 },
  { id: 'west-avenue', name: 'West avenue', x: 4, z: CENTRE, radius: 4 },
  { id: 'north-west-alley', name: 'North-west alley', x: 18, z: 32, radius: 3 },
  { id: 'south-east-alley', name: 'South-east alley', x: 78, z: 63, radius: 3 },
]);

/**
 * A city around an empty square.
 *
 * The compound in the middle is the point of the map: 28×28 of clear, buildable
 * ground with nothing authored inside it, ringed by an avenue and then by the
 * blocks. Every approach runs between buildings, so the fight is street to
 * street and the plazas are the only places a horde can fan out. The blocks are
 * dense with garrisonable city buildings — tenements, offices and townhouses —
 * and the capturable objectives sit on block corners, which is what makes an
 * engineer escort worth its slot.
 */
function paintCivicSquare(p: Painter): void {
  p.border();
  const neutral = -1;

  // The compound: the one thing this map promises and nothing else has. Left
  // completely clear of authored structures so the player's base has room.
  p.rect(34, 34, 61, 61, Terrain.Industrial, 1);
  // The apron ring just inside the walls: grass verge, so the wall line reads.
  p.rect(32, 32, 63, 63, Terrain.Grass, 1);
  p.rect(34, 34, 61, 61, Terrain.Industrial, 1);

  // City ground under the blocks, before the buildings are stamped on it.
  for (const [x0, z0, x1, z1] of [
    [6, 6, 29, 29],
    [65, 6, 89, 29],
    [6, 65, 29, 89],
    [65, 65, 89, 89],
    [33, 6, 62, 29],
    [33, 65, 62, 89],
    [6, 33, 29, 62],
    [65, 33, 89, 62],
  ] as const) {
    p.rect(x0, z0, x1, z1, Terrain.DenseUrban, 1);
  }

  // The ring avenue (four tiles) and the four approach avenues (eight wide).
  p.road(29, 29, 32, 63);
  p.road(63, 29, 66, 63);
  p.road(29, 29, 63, 32);
  p.road(29, 63, 63, 66);
  p.road(43, 2, 50, 32);
  p.road(43, 63, 50, 93);
  p.road(2, 43, 32, 50);
  p.road(63, 43, 93, 50);
  // Two back streets that cut the outer blocks, so the outer ring is walkable.
  p.road(6, 39, 29, 40);
  p.road(66, 55, 89, 56);
  p.road(39, 6, 40, 29);
  p.road(55, 66, 56, 89);

  // Small parks: the only soft ground, and the only place to site a battery
  // that is not overlooked by a block.
  p.rect(10, 31, 18, 37, Terrain.Forest, 2);
  p.rect(77, 58, 85, 64, Terrain.Forest, 2);
  p.rect(33, 79, 39, 87, Terrain.Forest, 1);
  p.rect(56, 8, 62, 16, Terrain.Forest, 1);
  p.rect(22, 22, 27, 27, Terrain.Scrub, 1);
  p.rect(68, 68, 73, 73, Terrain.Scrub, 1);

  // North-west block: the city's own offices and tenements.
  p.structure('tenement', neutral, 9, 9, Terrain.Urban);
  p.structure('officeBlock', neutral, 14, 9, Terrain.Urban);
  p.structure('townhouseTerrace', neutral, 19, 9, Terrain.Urban);
  p.structure('constabulary', neutral, 9, 15, Terrain.Urban);
  p.structure('schoolhouse', neutral, 14, 16, Terrain.Urban);
  p.structure('marketHall', neutral, 19, 15, Terrain.Urban);
  p.structure('supplyDepot', neutral, 10, 21, Terrain.Industrial);
  p.structure('civicHall', neutral, 17, 22, Terrain.Industrial);
  p.structure('clinic', neutral, 23, 18, Terrain.Urban);

  // North-east block: the financial corner, with the relay on the roof plaza.
  p.structure('tenement', neutral, 67, 9, Terrain.Urban);
  p.structure('officeBlock', neutral, 72, 9, Terrain.Urban);
  p.structure('apartmentBlock', neutral, 78, 9, Terrain.Urban);
  p.structure('bankHouse', neutral, 67, 15, Terrain.Urban);
  p.structure('fireStation', neutral, 72, 15, Terrain.Urban);
  p.structure('relay', neutral, 79, 16, Terrain.Industrial);
  p.structure('townhouseTerrace', neutral, 67, 20, Terrain.Urban);
  p.structure('warehouse', neutral, 72, 21, Terrain.Urban);
  p.structure('ruin', neutral, 78, 21, Terrain.Urban);

  // South-west block: the working quarter.
  p.structure('warehouse', neutral, 9, 67, Terrain.Urban);
  p.structure('tenement', neutral, 15, 67, Terrain.Urban);
  p.structure('constabulary', neutral, 20, 67, Terrain.Urban);
  p.structure('coldStore', neutral, 9, 73, Terrain.Urban);
  p.structure('officeBlock', neutral, 16, 74, Terrain.Urban);
  p.structure('supplyDepot', neutral, 23, 74, Terrain.Industrial);
  p.structure('tenement', neutral, 10, 81, Terrain.Urban);
  p.structure('apartmentBlock', neutral, 16, 81, Terrain.Urban);
  p.structure('ruin', neutral, 22, 82, Terrain.Urban);

  // South-east block: the landmark side.
  p.structure('tenement', neutral, 67, 68, Terrain.Urban);
  p.structure('fireStation', neutral, 72, 68, Terrain.Urban);
  p.structure('apartmentBlock', neutral, 78, 68, Terrain.Urban);
  p.structure('cinema', neutral, 67, 74, Terrain.Urban);
  p.structure('relay', neutral, 73, 74, Terrain.Industrial);
  p.structure('warehouse', neutral, 78, 75, Terrain.Urban);
  p.structure('marketHall', neutral, 73, 81, Terrain.Urban);
  p.structure('radarStation', neutral, 79, 81, Terrain.Industrial);
  p.structure('tenement', neutral, 83, 75, Terrain.Urban);

  // Streets of the north plaza: cover on the avenue itself, so the first wave
  // is met behind a wall rather than in the road.
  p.structure('townhouseTerrace', neutral, 34, 20, Terrain.Urban);
  p.structure('tenement', neutral, 39, 20, Terrain.Urban);
  p.structure('officeBlock', neutral, 52, 20, Terrain.Urban);
  p.structure('tenement', neutral, 58, 20, Terrain.Urban);
  p.structure('ruin', neutral, 34, 25, Terrain.Urban);
  p.structure('ruin', neutral, 58, 25, Terrain.Urban);
  // And the south plaza.
  p.structure('warehouse', neutral, 34, 76, Terrain.Urban);
  p.structure('tenement', neutral, 40, 76, Terrain.Urban);
  p.structure('tenement', neutral, 52, 76, Terrain.Urban);
  p.structure('autoGarage', neutral, 58, 76, Terrain.Urban);
  p.structure('ruin', neutral, 45, 71, Terrain.Urban);

  // Block corner towers: two observation posts over the avenues.
  p.structure('watchtower', neutral, 27, 27, Terrain.Industrial);
  p.structure('watchtower', neutral, 73, 60, Terrain.Industrial);

  // Scrap yards in the outer blocks: the city's income, and a walk from the
  // compound for every load.
  p.rect(24, 32, 28, 38, Terrain.Industrial, 1);
  p.rect(67, 32, 72, 38, Terrain.Industrial, 1);
  p.rect(23, 58, 28, 64, Terrain.Industrial, 1);
  p.rect(67, 57, 72, 63, Terrain.Industrial, 1);
  p.rect(31, 8, 37, 14, Terrain.Industrial, 1);
  p.rect(57, 82, 63, 88, Terrain.Industrial, 1);
  p.rect(8, 44, 14, 50, Terrain.Industrial, 1);
  p.rect(82, 44, 88, 50, Terrain.Industrial, 1);
  const yards: readonly TerrainId[] = [Terrain.Industrial, Terrain.Grass];
  p.ore(26, 35, 2, 320, yards);
  p.ore(69, 35, 2, 320, yards);
  p.ore(25, 61, 2, 320, yards);
  p.ore(69, 60, 2, 320, yards);
  p.ore(34, 11, 2, 300, yards);
  p.ore(60, 85, 2, 300, yards);
  p.ore(11, 47, 2, 300, yards);
  p.ore(85, 47, 2, 300, yards);
}

/* ------------------------------------------------------------------ */
/* Tidewall Quay — the harbour                                         */
/* ------------------------------------------------------------------ */

const QUAY_ENTRIES: readonly OutbreakEntryRegion[] = Object.freeze([
  { id: 'north-quay', name: 'North quay', x: 30, z: 5, radius: 4 },
  { id: 'south-quay', name: 'South quay', x: 30, z: SIZE - 5, radius: 4 },
  { id: 'west-road', name: 'West road', x: 5, z: CENTRE, radius: 4 },
  { id: 'inland-crossing', name: 'Inland crossing', x: 44, z: 22, radius: 3 },
  { id: 'north-pier-head', name: 'North pier head', x: 71, z: 27, radius: 3 },
  { id: 'south-pier-head', name: 'South pier head', x: 71, z: 67, radius: 3 },
]);

/**
 * A harbour with its back to the sea.
 *
 * Water closes the east, so three of the four compass approaches converge on
 * the land side and the horde has to be met on the quay. The ground the base
 * grows into is the apron between the inland road and the water; the two piers
 * are their own axis, reachable only by their own road, and the warehouses on
 * the quay are the only hard cover on the whole shoreline. The capturable
 * depots sit on the piers, so holding the sea side pays.
 */
function paintTidewallQuay(p: Painter): void {
  p.border();
  const neutral = -1;

  // The sea: deep water past the quay line, shallows along the wall so a
  // landing reads as wadeable rather than as a cliff.
  p.rect(61, 2, SIZE - 3, SIZE - 3, Terrain.DeepWater);
  p.rect(59, 2, 60, SIZE - 3, Terrain.ShallowWater);
  p.rect(58, 2, 58, SIZE - 3, Terrain.Sand, 0);

  // The quay and the land behind it.
  p.rect(4, 4, 57, SIZE - 5, Terrain.Grass, 1);
  p.rect(22, 34, 57, 61, Terrain.Industrial, 1);
  p.rect(40, 18, 57, 34, Terrain.Industrial, 1);

  // The two piers, driven out over the shallows to the deep water.
  p.rect(58, 26, 74, 29, Terrain.Industrial, 1);
  p.rect(58, 66, 74, 69, Terrain.Industrial, 1);
  p.rect(74, 24, 77, 31, Terrain.Industrial, 1);
  p.rect(74, 64, 77, 71, Terrain.Industrial, 1);

  // The quay road, the inland road and the cross streets.
  p.road(52, 4, 56, 91);
  p.road(28, 4, 32, 91);
  p.road(4, 44, 56, 48);
  p.road(18, 20, 56, 23);
  p.road(18, 70, 56, 73);
  p.road(4, 26, 22, 29);
  p.road(4, 64, 22, 67);

  // Nets, marsh and scrub between the roads: infantry ground, not tank ground.
  p.rect(6, 8, 16, 16, Terrain.Marsh, 0);
  p.rect(6, 78, 16, 88, Terrain.Marsh, 0);
  p.rect(36, 6, 50, 14, Terrain.Scrub, 1);
  p.rect(36, 82, 50, 90, Terrain.Scrub, 1);
  p.rect(12, 32, 20, 42, Terrain.Forest, 1);
  p.rect(12, 52, 20, 62, Terrain.Forest, 1);

  // The quay wall itself: hard cover along the whole shoreline.
  p.structure('warehouse', neutral, 43, 10, Terrain.Industrial);
  p.structure('freightShed', neutral, 36, 10, Terrain.Industrial);
  p.structure('coldStore', neutral, 43, 16, Terrain.Industrial);
  p.structure('warehouse', neutral, 43, 36, Terrain.Industrial);
  p.structure('freightShed', neutral, 36, 36, Terrain.Industrial);
  p.structure('autoGarage', neutral, 48, 30, Terrain.Industrial);
  p.structure('warehouse', neutral, 44, 58, Terrain.Industrial);
  p.structure('freightShed', neutral, 36, 52, Terrain.Industrial);
  p.structure('coldStore', neutral, 43, 76, Terrain.Industrial);
  p.structure('foundryWorks', neutral, 36, 78, Terrain.Industrial);

  // Inland: the village that works the harbour.
  p.structure('freightShed', neutral, 8, 10, Terrain.Industrial);
  p.structure('warehouse', neutral, 8, 34, Terrain.Industrial);
  p.structure('townhouseTerrace', neutral, 8, 48, Terrain.Grass);
  p.structure('chapel', neutral, 14, 26, Terrain.Grass);
  p.structure('marketHall', neutral, 8, 56, Terrain.Grass);
  p.structure('farmhouse', neutral, 8, 84, Terrain.Grass);
  p.structure('tenement', neutral, 20, 50, Terrain.Grass);
  p.structure('watchtower', neutral, 24, 24, Terrain.Industrial);
  p.structure('watchtower', neutral, 24, 76, Terrain.Industrial);
  p.structure('ruin', neutral, 20, 36, Terrain.Grass);
  p.structure('ruin', neutral, 20, 60, Terrain.Grass);
  p.structure('ruin', neutral, 36, 60, Terrain.Industrial);
  p.structure('ruin', neutral, 52, 58, Terrain.Industrial);

  // The piers: a shed each, and the depots the sea side is fought over.
  p.structure('freightShed', neutral, 68, 26, Terrain.Industrial);
  p.structure('freightShed', neutral, 68, 66, Terrain.Industrial);
  p.structure('supplyDepot', neutral, 62, 27, Terrain.Industrial);
  p.structure('supplyDepot', neutral, 62, 67, Terrain.Industrial);
  p.structure('relay', neutral, 75, 25, Terrain.Industrial);
  p.structure('relay', neutral, 75, 68, Terrain.Industrial);

  // Inland objectives: a depot and the reconnaissance that watches the water.
  p.structure('supplyDepot', neutral, 26, 50, Terrain.Industrial);
  p.structure('radarStation', neutral, 34, 68, Terrain.Industrial);
  p.structure('bunker', neutral, 22, 44, Terrain.Industrial);
  p.structure('bunker', neutral, 22, 56, Terrain.Industrial);

  // Fish-meal and scrap along the quay: the material worth walking for.
  const yards: readonly TerrainId[] = [Terrain.Grass, Terrain.Industrial];
  p.ore(14, 22, 2, 320, yards);
  p.ore(14, 68, 2, 320, yards);
  p.ore(26, 12, 2, 300, yards);
  p.ore(26, 84, 2, 300, yards);
  p.ore(52, 20, 2, 300, yards);
  p.ore(52, 74, 2, 300, yards);
  p.ore(34, 24, 2, 260, yards);
  p.ore(34, 62, 2, 260, yards);
  p.ore(12, 40, 2, 280, yards);
  p.ore(12, 56, 2, 280, yards);
}

/* ------------------------------------------------------------------ */
/* Frostline Junction — the rail yard                                  */
/* ------------------------------------------------------------------ */

const FROSTLINE_ENTRIES: readonly OutbreakEntryRegion[] = Object.freeze([
  { id: 'west-rails', name: 'West rails', x: 4, z: 25, radius: 4 },
  { id: 'east-rails', name: 'East rails', x: SIZE - 4, z: 69, radius: 4 },
  { id: 'north-cutting', name: 'North cutting', x: CENTRE, z: 4, radius: 4 },
  { id: 'south-cutting', name: 'South cutting', x: CENTRE, z: SIZE - 4, radius: 4 },
  { id: 'slag-gap', name: 'Slag gap', x: 20, z: 52, radius: 3 },
]);

/**
 * A freezing rail yard.
 *
 * The two running lines cut the map into bands and give the horde long, fast,
 * open approaches that only the yard buildings can interrupt. Between them sits
 * the junction: an industrial apron with room to build, ringed by the sheds and
 * the cold store, with slag heaps for cover. The ore runs along the ballast,
 * which keeps a hauler working the same corridor the waves use.
 */
function paintFrostlineJunction(p: Painter): void {
  p.border();
  const neutral = -1;

  // Snow-bound ground, with the yard apron in the middle.
  p.rect(4, 4, SIZE - 5, SIZE - 5, Terrain.Grass, 1);
  p.rect(30, 30, 65, 65, Terrain.Industrial, 1);
  p.rect(34, 34, 61, 61, Terrain.Industrial, 1);

  // The running lines: full width, three tiles each, and the north-south spur.
  p.road(4, 23, SIZE - 5, 26);
  p.road(4, 68, SIZE - 5, 71);
  p.road(44, 4, 47, SIZE - 5);

  // Service roads between the yard and the sheds.
  p.road(4, 40, 34, 43);
  p.road(62, 52, SIZE - 5, 55);
  p.road(20, 4, 23, 34);
  p.road(72, 62, 75, SIZE - 5);

  // Frozen standing water and slag heaps: the cover this map is fought behind.
  p.rect(6, 12, 18, 20, Terrain.Marsh, 0);
  p.rect(76, 76, 88, 88, Terrain.Marsh, 0);
  p.rect(8, 30, 16, 36, Terrain.Rocks, 3);
  p.rect(78, 28, 86, 34, Terrain.Rocks, 3);
  p.rect(8, 58, 16, 64, Terrain.Rocks, 3);
  p.rect(78, 58, 86, 64, Terrain.Rocks, 3);
  p.rect(28, 16, 38, 20, Terrain.Rock, 2);
  p.rect(58, 76, 68, 80, Terrain.Rock, 2);
  p.rect(24, 62, 30, 66, Terrain.Scrub, 1);
  p.rect(66, 24, 72, 28, Terrain.Scrub, 1);

  // Freight sheds along both running lines: the yard's garrison.
  p.structure('freightShed', neutral, 10, 10, Terrain.Industrial);
  p.structure('freightShed', neutral, 18, 34, Terrain.Industrial);
  p.structure('freightShed', neutral, 24, 12, Terrain.Industrial);
  p.structure('freightShed', neutral, 62, 40, Terrain.Industrial);
  p.structure('freightShed', neutral, 68, 12, Terrain.Industrial);
  p.structure('freightShed', neutral, 76, 44, Terrain.Industrial);
  p.structure('freightShed', neutral, 70, 84, Terrain.Industrial);
  p.structure('coldStore', neutral, 24, 84, Terrain.Industrial);
  p.structure('coldStore', neutral, 62, 84, Terrain.Industrial);
  p.structure('foundryWorks', neutral, 66, 6, Terrain.Industrial);
  p.structure('autoGarage', neutral, 10, 84, Terrain.Industrial);
  p.structure('warehouse', neutral, 10, 46, Terrain.Industrial);
  p.structure('warehouse', neutral, 80, 12, Terrain.Industrial);
  p.structure('ruin', neutral, 20, 22, Terrain.Industrial);
  p.structure('ruin', neutral, 76, 22, Terrain.Industrial);
  p.structure('ruin', neutral, 20, 74, Terrain.Industrial);
  p.structure('ruin', neutral, 76, 74, Terrain.Industrial);
  p.structure('chapel', neutral, 36, 84, Terrain.Industrial);
  p.structure('farmhouse', neutral, 6, 70, Terrain.Grass);
  p.structure('watchtower', neutral, 28, 30, Terrain.Industrial);
  p.structure('watchtower', neutral, 66, 66, Terrain.Industrial);

  // The junction itself: a depot at the throat, two relays and the radar that
  // watches the whole yard.
  p.structure('supplyDepot', neutral, 34, 27, Terrain.Industrial);
  p.structure('supplyDepot', neutral, 60, 62, Terrain.Industrial);
  p.structure('relay', neutral, 52, 18, Terrain.Industrial);
  p.structure('relay', neutral, 52, 78, Terrain.Industrial);
  p.structure('radarStation', neutral, 74, 34, Terrain.Industrial);
  p.structure('supplyDepot', neutral, 18, 48, Terrain.Industrial);
  p.structure('bunker', neutral, 34, 46, Terrain.Industrial);
  p.structure('bunker', neutral, 60, 50, Terrain.Industrial);

  // Ore along the ballast and the frozen sidings.
  const yards: readonly TerrainId[] = [Terrain.Grass, Terrain.Industrial];
  p.ore(14, 30, 2, 320, yards);
  p.ore(82, 30, 2, 320, yards);
  p.ore(14, 62, 2, 320, yards);
  p.ore(82, 62, 2, 320, yards);
  p.ore(24, 38, 2, 300, yards);
  p.ore(72, 58, 2, 300, yards);
  p.ore(6, 22, 2, 300, yards);
  p.ore(88, 72, 2, 300, yards);
  p.ore(40, 8, 2, 260, yards);
  p.ore(52, 88, 2, 260, yards);
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                          */
/* ------------------------------------------------------------------ */

/** The opening force every map shares: enough to hold the apron for two waves. */
function paintStart(p: Painter): void {
  // The Command Post: footprint top-left such that its centre is the map centre.
  const post = BUILDINGS.commandPost?.footprint ?? { w: 4, h: 4 };
  const postX = CENTRE - post.w / 2;
  const postZ = CENTRE - post.h / 2;
  p.structure('commandPost', 0, postX, postZ);
  p.unit('engineer', 0, CENTRE + 4, CENTRE + 1);
  p.unit('harvester', 0, CENTRE + 5, CENTRE + 4);
  p.unit('rifle', 0, CENTRE - 4, CENTRE - 4);
  p.unit('rifle', 0, CENTRE - 2, CENTRE - 4);
  p.unit('rifle', 0, CENTRE, CENTRE - 4);
  p.unit('rifle', 0, CENTRE + 2, CENTRE - 4);
  p.unit('rifle', 0, CENTRE - 4, CENTRE + 4);
  p.unit('tank', 0, CENTRE + 1, CENTRE + 5);
  // A first defensive pair: an MG nest and a sandbag line, so the opening is
  // about learning the angles rather than surviving with nothing.
  p.structure('mgNest', 0, CENTRE - 7, CENTRE - 2);
  p.structure('mgNest', 0, CENTRE + 6, CENTRE + 1);
}

/**
 * The maps, in picker order.
 *
 * The order is also the fallback order: an unknown id resolves to the first
 * entry, which is the basin every existing board was recorded on.
 */
export const OUTBREAK_MAPS: readonly OutbreakMapDefinition[] = Object.freeze([
  {
    id: 'outbreak-relay-basin',
    name: 'Relay Basin',
    tag: 'Basin',
    theme: 'Open ground · four roads in',
    blurb:
      'A fortified basin around a single Command Post. Four roads, four slow approaches and a ring of supplies outside the wire.',
    order: 'Hold the basin',
    size: SIZE,
    timeOfDay: 'dusk',
    weather: 'clear',
    entryRegions: BASIN_ENTRIES,
    paint(p) {
      paintBasin(p);
      paintStart(p);
    },
  },
  {
    id: 'outbreak-civic-square',
    name: 'Civic Square',
    tag: 'City',
    theme: 'City blocks · clear centre',
    blurb:
      'An empty compound at the heart of a built-up city. The blocks are packed with tenements and offices to garrison, and every wave arrives down a street.',
    order: 'Hold the square',
    size: SIZE,
    timeOfDay: 'night',
    weather: 'overcast',
    entryRegions: CITY_ENTRIES,
    paint(p) {
      paintCivicSquare(p);
      paintStart(p);
    },
  },
  {
    id: 'outbreak-tidewall-quay',
    name: 'Tidewall Quay',
    tag: 'Harbour',
    theme: 'Harbour dawn · water closes the east',
    blurb:
      'A working harbour with its back to the sea. Piers make their own approaches and the quay warehouses are the only cover on the shoreline.',
    order: 'Hold the quay',
    size: SIZE,
    timeOfDay: 'dawn',
    weather: 'fog',
    entryRegions: QUAY_ENTRIES,
    paint(p) {
      paintTidewallQuay(p);
      paintStart(p);
    },
  },
  {
    id: 'outbreak-frostline-junction',
    name: 'Frostline Junction',
    tag: 'Rail yard',
    theme: 'Frozen rail yard · long sightlines',
    blurb:
      'A freezing junction between two running lines. The horde comes down the tracks and the sheds are the only thing that breaks the view.',
    order: 'Hold the junction',
    size: SIZE,
    timeOfDay: 'night',
    weather: 'snow',
    entryRegions: FROSTLINE_ENTRIES,
    paint(p) {
      paintFrostlineJunction(p);
      paintStart(p);
    },
  },
]);

/** The map every existing board and room was recorded on. */
export const DEFAULT_OUTBREAK_MAP_ID = 'outbreak-relay-basin';

/** The default map, resolved once. */
export const DEFAULT_OUTBREAK_MAP =
  OUTBREAK_MAPS.find((map) => map.id === DEFAULT_OUTBREAK_MAP_ID) ?? OUTBREAK_MAPS[0];

/** Picker ids, in order. */
export const OUTBREAK_MAP_IDS: readonly string[] = Object.freeze(
  OUTBREAK_MAPS.map((map) => map.id),
);

export function isOutbreakMapId(value: unknown): value is string {
  return typeof value === 'string' && OUTBREAK_MAP_IDS.includes(value);
}

/** Resolve an id to its definition, falling back to the basin. */
export function outbreakMap(id: string | undefined): OutbreakMapDefinition {
  return OUTBREAK_MAPS.find((map) => map.id === id) ?? DEFAULT_OUTBREAK_MAP;
}
