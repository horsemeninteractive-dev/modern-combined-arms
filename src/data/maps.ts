import { MAP_FORMAT, MAP_FORMAT_VERSION } from '../sim/constants';
import { Terrain, inBounds, tileIndex, type TerrainId } from '../sim/terrain';
import {
  clearOreUnderStructures,
  phaseSettings,
  type Scenario,
  type ScenarioPlayer,
  type ScenarioStructure,
  type ScenarioTile,
  type ScenarioUnit,
} from '../sim/scenario';
import { BUILDINGS } from './buildings';

/**
 * Symmetric skirmish theatres.
 *
 * Each map is authored on the western half and mirrored across the vertical
 * centre line, so terrain, elevation, deposits, objectives, starting forces and
 * base sites are identical for both commanders. Nothing may be placed on one
 * side only: `tests/maps.test.ts` compares every tile and entity with its
 * mirror image.
 *
 * The three theatres are deliberately different sizes: Rust Valley is a wide
 * armour basin, Kestrel Straits is a compact naval map, and Foundry District is
 * a dense city grid built for street fighting.
 */

interface Draft {
  readonly width: number;
  readonly height: number;
  tiles: ScenarioTile[];
  structures: ScenarioStructure[];
  units: ScenarioUnit[];
}

function blank(width: number, height: number): Draft {
  const tiles: ScenarioTile[] = new Array(width * height);
  for (let i = 0; i < tiles.length; i++) tiles[i] = { t: Terrain.Grass, e: 1, o: 0 };
  return { width, height, tiles, structures: [], units: [] };
}

const isWater = (t: number): boolean =>
  t === Terrain.DeepWater || t === Terrain.ShallowWater;

/** West-half authoring helpers; every write also lands on its mirror tile. */
class Painter {
  constructor(readonly draft: Draft) {}

  get width(): number {
    return this.draft.width;
  }

  get height(): number {
    return this.draft.height;
  }

  mirror(x: number): number {
    return this.draft.width - 1 - x;
  }

  mirrorOrigin(x: number, footprintWidth: number): number {
    return this.draft.width - (x + footprintWidth);
  }

  tile(x: number, z: number): ScenarioTile {
    return this.draft.tiles[tileIndex(this.width, x, z)];
  }

  /** One tile only, for work that is already symmetric. */
  set(x: number, z: number, terrain: TerrainId, elevation?: number, ore?: number): void {
    if (!inBounds(this.width, this.height, x, z)) return;
    const tile = this.tile(x, z);
    tile.t = terrain;
    if (elevation !== undefined) tile.e = elevation;
    if (ore !== undefined) tile.o = ore;
  }

  /** The tile and its mirror image. */
  paint(x: number, z: number, terrain: TerrainId, elevation?: number, ore?: number): void {
    this.set(x, z, terrain, elevation, ore);
    this.set(this.mirror(x), z, terrain, elevation, ore);
  }

  rect(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    terrain: TerrainId,
    elevation?: number,
  ): void {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) this.paint(x, z, terrain, elevation);
    }
  }

  lane(x0: number, z0: number, x1: number, z1: number, elevation = 1): void {
    this.rect(x0, z0, x1, z1, Terrain.Grass, elevation);
  }

  /** Deep water behind a one-tile shallow shelf, mirrored. */
  water(x0: number, x1: number, z0 = 0, z1 = this.height - 1): void {
    this.rect(x0, z0, x1, z1, Terrain.ShallowWater, 0);
    this.rect(x0 + 1, z0, x1, z1, Terrain.DeepWater, 0);
  }

  road(x0: number, z0: number, x1: number, z1: number): void {
    let x = x0;
    let z = z0;
    const mark = () => {
      const t = this.tile(x, z).t;
      if (!isWater(t)) this.paint(x, z, Terrain.Road, this.tile(x, z).e);
    };
    mark();
    while (x !== x1 || z !== z1) {
      if (x !== x1) x += Math.sign(x1 - x);
      if (z !== z1) z += Math.sign(z1 - z);
      mark();
    }
  }

  route(points: Array<[number, number]>): void {
    for (let i = 1; i < points.length; i++) {
      this.road(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    }
  }

  ore(cx: number, cz: number, rx: number, rz: number, amount: number): void {
    for (let dz = -rz; dz <= rz; dz++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if (dx * dx + dz * dz > rx * rx + rz * rz + 1) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || x >= this.width || z < 0 || z >= this.height) continue;
        const t = this.tile(x, z).t;
        if (t !== Terrain.Grass && t !== Terrain.Sand) continue;
        this.paint(x, z, t, undefined, amount);
      }
    }
  }

  border(): void {
    for (let x = 0; x < this.width; x++) {
      for (const z of [0, 1, this.height - 2, this.height - 1]) {
        this.set(x, z, Terrain.Rock, 3);
      }
    }
    for (let z = 0; z < this.height; z++) {
      for (const x of [0, 1, this.width - 2, this.width - 1]) {
        this.set(x, z, Terrain.Rock, 3);
      }
    }
  }

  beaches(): void {
    const waterAt = (x: number, z: number): boolean =>
      inBounds(this.width, this.height, x, z) && isWater(this.tile(x, z).t);
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const t = this.tile(x, z);
        if (isWater(t.t) || t.t === Terrain.Rock) continue;
        if (waterAt(x - 1, z) || waterAt(x + 1, z) || waterAt(x, z - 1) || waterAt(x, z + 1)) {
          t.t = Terrain.Sand;
        }
      }
    }
  }

  /** Owner 0 west, owner 1 mirrored — identical ground, identical structures. */
  owned(defId: string, x: number, z: number): void {
    const w = BUILDINGS[defId]?.footprint.w ?? 1;
    this.draft.structures.push({ defId, owner: 0, x, z });
    this.draft.structures.push({ defId, owner: 1, x: this.mirrorOrigin(x, w), z });
  }

  /** Neutral objective mirrored as a pair, so neither side is nearer one. */
  neutral(defId: string, x: number, z: number): void {
    const w = BUILDINGS[defId]?.footprint.w ?? 1;
    this.draft.structures.push({ defId, owner: -1, x, z });
    this.draft.structures.push({ defId, owner: -1, x: this.mirrorOrigin(x, w), z });
  }

  unit(defId: string, owner: number, x: number, z: number): void {
    const px = owner === 0 ? x : this.mirror(x);
    this.draft.units.push({ defId, owner, x: px, z });
  }

  /** Engineer, two MBTs and five riflemen per side, mirrored. */
  landingForce(x: number, z: number): void {
    for (const owner of [0, 1]) {
      this.unit('engineer', owner, x + 2, z + 2);
      this.unit('tank', owner, x + 5, z + 1);
      this.unit('tank', owner, x + 5, z + 5);
      this.unit('rifle', owner, x + 1, z + 4);
      this.unit('rifle', owner, x + 2, z + 6);
      this.unit('rifle', owner, x + 4, z + 7);
      this.unit('rifle', owner, x + 7, z + 3);
      this.unit('rifle', owner, x + 7, z + 6);
    }
  }
}

interface Ground {
  startX: number;
  startZ: number;
  blue: string;
  red: string;
  objectives: string[];
}

function assemble(
  draft: Draft,
  meta: Scenario['meta'],
  ground: Ground,
  seed: number,
): Scenario {
  const painter = new Painter(draft);
  painter.beaches();
  const players: ScenarioPlayer[] = [
    {
      id: 0,
      name: ground.blue,
      factionId: 'baltic',
      team: 0,
      isAI: false,
      startX: ground.startX,
      startZ: ground.startZ,
    },
    {
      id: 1,
      name: ground.red,
      factionId: 'expeditionary',
      team: 1,
      isAI: true,
      startX: painter.mirror(ground.startX),
      startZ: ground.startZ,
    },
  ];
  const scenario: Scenario = {
    format: MAP_FORMAT,
    version: MAP_FORMAT_VERSION,
    meta,
    width: draft.width,
    height: draft.height,
    tiles: draft.tiles,
    players,
    structures: draft.structures,
    units: draft.units,
    objectives: ground.objectives,
    settings: {
      ...phaseSettings('day'),
      seed,
      startingMats: 3000,
      startingReq: 180,
      fog: true,
      victory: 'destroyHQ',
      weather: 'clear',
      timeOfDay: 'day',
    },
  };
  // A deposit under a footprint can never be mined; harvesters would park on it.
  clearOreUnderStructures(scenario);
  return scenario;
}

/* ------------------------------------------------------------------ */
/* Rust Valley — armour country, 112 × 80                              */
/* ------------------------------------------------------------------ */

/**
 * A wide landlocked basin split by a central massif with two armour passes.
 * No coast and no navigable water: tank country, forested flank routes and the
 * two passes decide the battle.
 */
export function createRustValley(): Scenario {
  const W = 112;
  const H = 80;
  const draft = blank(W, H);
  const p = new Painter(draft);
  p.border();

  for (let z = 4; z <= 74; z++) {
    const pass = (z >= 29 && z <= 37) || (z >= 50 && z <= 57);
    if (pass) continue;
    p.paint(52, z, Terrain.Rock, 2);
    p.paint(53, z, Terrain.Rock, 3);
    p.paint(54, z, Terrain.Rock, 3);
    p.paint(55, z, Terrain.Rock, 2);
  }

  p.rect(16, 6, 38, 18, Terrain.Forest, 1);
  p.rect(16, 62, 38, 73, Terrain.Forest, 1);
  p.rect(40, 8, 48, 14, Terrain.Forest, 1);
  p.rect(40, 66, 48, 72, Terrain.Forest, 1);

  p.lane(4, 20, 51, 28);
  p.lane(4, 40, 51, 48);
  p.lane(51, 29, 55, 37);
  p.lane(51, 50, 55, 57);
  p.lane(4, 8, 20, 26);
  p.lane(4, 30, 14, 40);

  p.rect(30, 22, 32, 24, Terrain.Rock, 2);
  p.rect(42, 42, 44, 44, Terrain.Rock, 2);

  p.route([
    [12, 22],
    [12, 34],
    [32, 34],
    [52, 34],
  ]);
  p.route([
    [12, 22],
    [22, 52],
    [38, 62],
    [52, 62],
  ]);
  p.route([
    [12, 34],
    [10, 30],
    [10, 26],
  ]);

  p.ore(14, 26, 3, 2, 300);
  p.ore(30, 44, 2, 2, 300);
  p.ore(44, 50, 2, 1, 280);
  p.ore(24, 17, 2, 2, 260);
  p.ore(34, 28, 1, 2, 260);

  p.owned('commandPost', 8, 12);
  p.neutral('relay', 44, 24);
  p.neutral('supplyDepot', 36, 46);
  p.neutral('relay', 44, 60);
  p.neutral('tenement', 30, 36);
  p.neutral('ruin', 38, 30);

  p.landingForce(16, 20);

  return assemble(
    draft,
    {
      id: 'rust-valley',
      name: 'Rust Valley',
      description:
        'A landlocked basin cut by a central massif and two armour passes. No coast, no navy: tanks, flanking routes and hull-down ground decide it.',
      author: 'MCA scenario team',
      created: '2026-10-25',
      targetSize: 'large',
    },
    {
      startX: 16,
      startZ: 22,
      blue: 'Baltic Task Force',
      red: '11th Expeditionary Corps',
      objectives: [
        'Destroy the opposing Command Post.',
        'Hold the two armour passes to control the centre.',
        'Capture the relays and the forward supply depot for income.',
        'Keep your own Command Post operational.',
      ],
    },
    404701,
  );
}

/* ------------------------------------------------------------------ */
/* Kestrel Straits — naval country, 88 × 64                            */
/* ------------------------------------------------------------------ */

/**
 * Two facing coasts across a deep strait, with two islands joined to each shore
 * by shallow fords. Compact and sea-focused: shipyards, corvettes and shore
 * bombardment matter from the first minute.
 */
export function createKestrelStraits(): Scenario {
  const W = 88;
  const H = 64;
  const draft = blank(W, H);
  const p = new Painter(draft);
  p.border();

  // The strait runs the full height of the map; the mirror closes it.
  p.water(29, 43);

  // Islands with shallow fords back to each shore.
  p.rect(38, 14, 43, 19, Terrain.Grass, 1);
  p.rect(38, 41, 43, 46, Terrain.Grass, 1);
  p.rect(29, 16, 38, 18, Terrain.ShallowWater, 0);
  p.rect(29, 43, 38, 45, Terrain.ShallowWater, 0);

  p.rect(18, 5, 28, 12, Terrain.Forest, 1);
  p.rect(18, 51, 28, 58, Terrain.Forest, 1);
  p.lane(4, 22, 22, 40);
  p.rect(14, 55, 16, 57, Terrain.Rock, 2);

  p.route([
    [10, 18],
    [10, 30],
    [22, 30],
    [27, 26],
  ]);
  p.route([
    [10, 18],
    [16, 14],
    [24, 14],
  ]);

  p.ore(10, 16, 3, 2, 300);
  p.ore(20, 36, 2, 2, 300);
  p.ore(18, 20, 2, 2, 260);
  p.ore(24, 46, 2, 2, 260);

  p.owned('commandPost', 6, 24);
  p.neutral('relay', 26, 32);
  p.neutral('supplyDepot', 18, 44);
  p.neutral('radarStation', 40, 15);
  p.neutral('tenement', 22, 20);

  p.landingForce(12, 30);

  return assemble(
    draft,
    {
      id: 'kestrel-straits',
      name: 'Kestrel Straits',
      description:
        'Two coasts, one deep strait and two island strongpoints reached across shallow fords. Ground forces meet on the islands; the sea decides the flanks.',
      author: 'MCA scenario team',
      created: '2026-10-25',
      targetSize: 'small',
    },
    {
      startX: 14,
      startZ: 34,
      blue: 'Baltic Task Force',
      red: '11th Expeditionary Corps',
      objectives: [
        'Destroy the opposing Command Post.',
        'Control the strait and bombard the enemy coast.',
        'Take the island radar station and the fords.',
        'Keep your own Command Post operational.',
      ],
    },
    912077,
  );
}

/* ------------------------------------------------------------------ */
/* Foundry District — urban country, 104 × 76                          */
/* ------------------------------------------------------------------ */

/**
 * Two field bases on the open outskirts, facing each other across a dense
 * mirrored city. The whole urban core is held back from the coasts of the map,
 * so each commander gets a wide clear yard to raise production, power and
 * defences before the fight moves street to street.
 */
export function createFoundryDistrict(): Scenario {
  const W = 104;
  const H = 76;
  const draft = blank(W, H);
  const p = new Painter(draft);
  p.border();

  // The city core: 31 tiles of blocks per side, with eighteen-tile open yards
  // outside the ring road at either end of the map.
  p.rect(21, 6, 51, 69, Terrain.Urban, 1);

  // Greens cut back out of the blocks. The central square straddles the mirror
  // line and holds the district's two landmarks, so the very middle of the map
  // is a place both commanders can name on the map.
  p.rect(25, 30, 31, 39, Terrain.Grass, 1);
  p.rect(33, 57, 39, 63, Terrain.Grass, 1);
  p.rect(41, 9, 47, 15, Terrain.Grass, 1);
  p.rect(45, 28, 51, 46, Terrain.Grass, 1);

  // Avenues and cross streets inside the city; the mirror completes the grid.
  // The square itself is left open apart from the boulevard down its axis.
  for (const x of [24, 32, 40]) p.rect(x, 6, x, 69, Terrain.Road, 1);
  for (const z of [8, 16, 24, 32, 36, 40, 48, 56, 64]) {
    const last = z === 36 ? 51 : 44;
    for (let x = 21; x <= last; x++) p.paint(x, z, Terrain.Road, 1);
  }

  // The ring road bounds the city, and three approach highways cross the open
  // yard without cutting it into unusable strips.
  for (let z = 8; z <= 69; z++) p.paint(20, z, Terrain.Road, 1);
  for (const z of [16, 36, 56]) p.road(7, z, 21, z);

  // Forest belts frame the outskirts well away from the building lots.
  p.rect(4, 4, 18, 7, Terrain.Forest, 1);
  p.rect(4, 66, 18, 72, Terrain.Forest, 1);

  // Garrison blocks, each one between two avenues so no side gets cover the
  // other lacks.
  p.neutral('ruin', 21, 9);
  p.neutral('warehouse', 25, 9);
  p.neutral('officeBlock', 33, 10);
  p.neutral('tenement', 25, 17);
  p.neutral('warehouse', 33, 17);
  p.neutral('officeBlock', 25, 25);
  p.neutral('tenement', 33, 25);
  p.neutral('ruin', 41, 25);
  p.neutral('ruin', 37, 37);
  p.neutral('warehouse', 25, 41);
  p.neutral('officeBlock', 33, 41);
  p.neutral('tenement', 41, 41);
  p.neutral('warehouse', 33, 49);
  p.neutral('ruin', 41, 49);
  p.neutral('officeBlock', 25, 57);
  p.neutral('tenement', 41, 57);
  p.neutral('ruin', 21, 57);
  p.neutral('warehouse', 33, 65);

  // Civic services among the garrison blocks, mirrored so both approaches meet
  // the same strongpoints. Each sits on a clear lot between two streets.
  p.neutral('fireStation', 42, 9);
  p.neutral('clinic', 21, 17);
  p.neutral('marketHall', 25, 65);

  // The central square: a city hall and the works that named the district face
  // each other across the mirror line, with the strategic objectives around
  // them. Taking the square means holding both landmarks.
  p.neutral('civicHall', 45, 29);
  p.neutral('foundryWorks', 45, 38);
  p.neutral('relay', 45, 34);
  p.neutral('radarStation', 41, 29);
  p.neutral('supplyDepot', 45, 44);

  p.owned('commandPost', 5, 29);
  p.landingForce(5, 36);

  p.ore(14, 20, 2, 2, 300);
  p.ore(14, 54, 2, 2, 280);
  p.ore(27, 34, 1, 1, 220);
  p.ore(35, 60, 1, 1, 200);

  return assemble(
    draft,
    {
      id: 'foundry-district',
      name: 'Foundry District',
      description:
        'Two field bases on the open outskirts, facing each other across a dense city core. Warehouses, offices, tenements, a fire station, clinic, market hall and ruins give the infantry dozens of strongpoints; armour fights avenue by avenue.',
      author: 'MCA scenario team',
      created: '2026-10-25',
      targetSize: 'large',
    },
    {
      startX: 11,
      startZ: 34,
      blue: 'Baltic Task Force',
      red: '11th Expeditionary Corps',
      objectives: [
        'Destroy the opposing Command Post.',
        'Clear the city blocks and hold the central square.',
        'Garrison the civic buildings, warehouses and offices to hold the streets.',
        'Keep your own Command Post operational.',
      ],
    },
    550211,
  );
}
