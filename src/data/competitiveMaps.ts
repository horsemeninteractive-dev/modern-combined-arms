import { MAP_FORMAT, MAP_FORMAT_VERSION } from '../sim/constants';
import {
  Overlay,
  TERRAIN,
  Terrain,
  inBounds,
  overlayAllowedOn,
  packOverlay,
  tileBuildable,
  tileIndex,
  type TerrainId,
} from '../sim/terrain';
import {
  clearOreUnderStructures,
  phaseSettings,
  type Scenario,
  type ScenarioPlayer,
  type ScenarioSettings,
  type ScenarioSlot,
  type ScenarioStructure,
  type ScenarioTile,
  type ScenarioUnit,
} from '../sim/scenario';
import { BUILDINGS } from './buildings';

/**
 * Competitive skirmish and multiplayer battlefields.
 *
 * Every map here is built from a *quarter*: terrain, ore, cover, roads and
 * neutral objectives are authored inside the top-left quadrant and stamped four
 * times at 0/90/180/270 degrees around the map centre. Because the stamp is a
 * pure rotation of one authoring pass, the finished battlefield is four-way
 * rotationally symmetric by construction — and `tests/map-roster.test.ts`
 * re-derives the rotation from the finished tiles instead of trusting this
 * file.
 *
 * Owned content (commands posts and starting forces) exists for the two seats
 * only: seat 0 in the first quadrant, seat 1 in the opposite one. A 180-degree
 * rotation maps one onto the other with ownership swapped, which is what makes
 * the map fair for 1v1 without inventing two phantom armies in the empty
 * quadrants.
 *
 * All maps are square. A 90-degree rotation of a W×H grid is only meaningful
 * when W === H, so the roster trades odd footprints for genuine symmetry.
 */

type Rotation = 0 | 1 | 2 | 3;
const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

/**
 * How much a tile of authored deposit actually holds.
 *
 * One tile is one hopper at 1.0, and a field of five tiles then pays for five
 * loads before it is gone — which emptied the competitive maps long before a
 * match was decided. Half again as much per tile keeps expansion worth taking
 * without turning the opening into a sprint.
 */
export const ORE_YIELD_SCALE = 1.5;

/** Rotate a tile coordinate 90 degrees clockwise about the map centre. */
export function rotatePoint(size: number, k: Rotation, x: number, z: number): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (let i = 0; i < k; i++) {
    const nx = size - 1 - pz;
    const nz = px;
    px = nx;
    pz = nz;
  }
  return { x: px, z: pz };
}

/** Rotate a footprint, swapping width and height on quarter turns. */
export function rotateRect(
  size: number,
  k: Rotation,
  x: number,
  z: number,
  w: number,
  h: number,
): { x: number; z: number; w: number; h: number } {
  let rx = x;
  let rz = z;
  let rw = w;
  let rh = h;
  for (let i = 0; i < k; i++) {
    const nx = size - rh - rz;
    const nz = rx;
    const nh = rw;
    rw = rh;
    rh = nh;
    rx = nx;
    rz = nz;
  }
  return { x: rx, z: rz, w: rw, h: rh };
}

export function footprintOf(defId: string): { w: number; h: number } {
  return BUILDINGS[defId]?.footprint ?? { w: 1, h: 1 };
}

/**
 * A square battlefield under construction. Every painted operation is applied
 * to all four rotations, so a single authoring pass is the whole map.
 */
export class Field {
  readonly tiles: ScenarioTile[];
  readonly structures: ScenarioStructure[] = [];
  readonly units: ScenarioUnit[] = [];

  constructor(readonly size: number) {
    this.tiles = new Array<ScenarioTile>(size * size);
    for (let i = 0; i < this.tiles.length; i++) this.tiles[i] = { t: Terrain.Grass, e: 1, o: 0 };
  }

  /** Tiles per side of the authored quadrant. */
  get quarter(): number {
    return this.size / 2;
  }

  tile(x: number, z: number): ScenarioTile | undefined {
    if (!inBounds(this.size, this.size, x, z)) return undefined;
    return this.tiles[tileIndex(this.size, x, z)];
  }

  private write(x: number, z: number, terrain: TerrainId, elevation?: number, ore?: number): void {
    const tile = this.tile(x, z);
    if (!tile) return;
    tile.t = terrain;
    if (elevation !== undefined) tile.e = elevation;
    if (ore !== undefined) tile.o = ore;
  }

  /** One tile, stamped at all four rotations. */
  set(x: number, z: number, terrain: TerrainId, elevation?: number): void {
    for (const k of ROTATIONS) {
      const p = rotatePoint(this.size, k, x, z);
      this.write(p.x, p.z, terrain, elevation);
    }
  }

  /** Inclusive rectangle, stamped at all four rotations. */
  rect(x0: number, z0: number, x1: number, z1: number, terrain: TerrainId, elevation?: number): void {
    for (const k of ROTATIONS) {
      const a = rotatePoint(this.size, k, x0, z0);
      const b = rotatePoint(this.size, k, x1, z1);
      for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++) {
        for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
          this.write(x, z, terrain, elevation);
        }
      }
    }
  }

  /** Filled disc, stamped at all four rotations. */
  disc(cx: number, cz: number, radius: number, terrain: TerrainId, elevation?: number): void {
    const r2 = radius * radius + radius;
    for (const k of ROTATIONS) {
      const c = rotatePoint(this.size, k, cx, cz);
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dz * dz > r2) continue;
          this.write(c.x + dx, c.z + dz, terrain, elevation);
        }
      }
    }
  }

  /**
   * Polyline of terrain, `width` tiles thick and centred on the line. Widths
   * are rounded up to odd numbers: an even band sits on one side of its line,
   * so a quarter turn would shift it and break symmetry.
   */
  route(points: Array<[number, number]>, terrain: TerrainId, width = 1, elevation?: number): void {
    const half = ((width % 2 === 0 ? width + 1 : width) - 1) / 2;
    for (const k of ROTATIONS) {
      const rotated = points.map(([x, z]) => rotatePoint(this.size, k, x, z));
      for (let i = 1; i < rotated.length; i++) {
        const [ax, az] = [rotated[i - 1].x, rotated[i - 1].z];
        const [bx, bz] = [rotated[i].x, rotated[i].z];
        let x = ax;
        let z = az;
        const stepX = Math.sign(bx - ax);
        const stepZ = Math.sign(bz - az);
        while (true) {
          for (let oz = -Math.floor(half); oz <= Math.ceil(half); oz++) {
            for (let ox = -Math.floor(half); ox <= Math.ceil(half); ox++) {
              this.write(x + ox, z + oz, terrain, elevation);
            }
          }
          if (x === bx && z === bz) break;
          if (x !== bx) x += stepX;
          if (z !== bz) z += stepZ;
        }
      }
    }
  }

  /**
   * Recolour only tiles that already hold `from`. Used for fords, beach fringes
   * and any pass that must not paint its terrain onto open ground.
   */
  recolour(points: Array<[number, number]>, from: TerrainId, to: TerrainId, width = 1): void {
    const half = Math.floor(((width % 2 === 0 ? width + 1 : width) - 1) / 2);
    for (const k of ROTATIONS) {
      const rotated = points.map(([x, z]) => rotatePoint(this.size, k, x, z));
      for (let i = 1; i < rotated.length; i++) {
        const [ax, az] = [rotated[i - 1].x, rotated[i - 1].z];
        const [bx, bz] = [rotated[i].x, rotated[i].z];
        let x = ax;
        let z = az;
        const stepX = Math.sign(bx - ax);
        const stepZ = Math.sign(bz - az);
        while (true) {
          for (let oz = -half; oz <= half; oz++) {
            for (let ox = -half; ox <= half; ox++) {
              const tile = this.tile(x + ox, z + oz);
              if (tile && tile.t === from) {
                tile.t = to;
                tile.e = 0;
              }
            }
          }
          if (x === bx && z === bz) break;
          if (x !== bx) x += stepX;
          if (z !== bz) z += stepZ;
        }
      }
    }
  }

  /** A band of `terrain` around every water tile, on all four coasts. */
  shore(terrain: TerrainId, depth = 1): void {
    const isWater = (t: number): boolean => t === Terrain.DeepWater || t === Terrain.ShallowWater;
    for (let pass = 0; pass < depth; pass++) {
      const marks: number[] = [];
      for (let z = 0; z < this.size; z++) {
        for (let x = 0; x < this.size; x++) {
          const i = tileIndex(this.size, x, z);
          if (isWater(this.tiles[i].t)) continue;
          const wet =
            (this.tile(x - 1, z) && isWater(this.tile(x - 1, z)!.t)) ||
            (this.tile(x + 1, z) && isWater(this.tile(x + 1, z)!.t)) ||
            (this.tile(x, z - 1) && isWater(this.tile(x, z - 1)!.t)) ||
            (this.tile(x, z + 1) && isWater(this.tile(x, z + 1)!.t));
          if (wet) marks.push(i);
        }
      }
      for (const i of marks) {
        this.tiles[i].t = terrain;
        this.tiles[i].e = 0;
      }
    }
  }

  /**
   * A band of `terrain` on the seaward side of every coast, `depth` tiles out.
   *
   * `shore` widens the land into the water; this does the opposite and grows
   * the shallows away from it, which is what gives a harbour or a landing beach
   * a navigable shelf instead of a deep-water cliff.
   */
  shelf(terrain: TerrainId, depth = 1): void {
    const isWater = (t: number): boolean => t === Terrain.DeepWater || t === Terrain.ShallowWater;
    for (let pass = 0; pass < depth; pass++) {
      const marks: number[] = [];
      for (let z = 0; z < this.size; z++) {
        for (let x = 0; x < this.size; x++) {
          const i = tileIndex(this.size, x, z);
          if (!isWater(this.tiles[i].t)) continue;
          const nearLand =
            (this.tile(x - 1, z) && !isWater(this.tile(x - 1, z)!.t)) ||
            (this.tile(x + 1, z) && !isWater(this.tile(x + 1, z)!.t)) ||
            (this.tile(x, z - 1) && !isWater(this.tile(x, z - 1)!.t)) ||
            (this.tile(x, z + 1) && !isWater(this.tile(x, z + 1)!.t));
          if (nearLand) marks.push(i);
        }
      }
      for (const i of marks) {
        this.tiles[i].t = terrain;
        this.tiles[i].e = 0;
        this.tiles[i].o = 0;
      }
    }
  }

  /**
   * Surface layer, stamped at all four rotations. The base terrain is left
   * alone; a layer that the ground cannot carry is skipped rather than forced.
   */
  overlayDisc(cx: number, cz: number, radius: number, overlay: number): void {
    const r2 = radius * radius + radius;
    for (const k of ROTATIONS) {
      const c = rotatePoint(this.size, k, cx, cz);
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dz * dz > r2) continue;
          const tile = this.tile(c.x + dx, c.z + dz);
          if (!tile || !overlayAllowedOn(overlay, tile.t)) continue;
          tile.v = overlay;
        }
      }
    }
  }

  /** Surface layer along a polyline, e.g. hedgerows along a field boundary. */
  overlayRoute(points: Array<[number, number]>, overlay: number, width = 1): void {
    const half = ((width % 2 === 0 ? width + 1 : width) - 1) / 2;
    for (const k of ROTATIONS) {
      const rotated = points.map(([x, z]) => rotatePoint(this.size, k, x, z));
      for (let i = 1; i < rotated.length; i++) {
        const [ax, az] = [rotated[i - 1].x, rotated[i - 1].z];
        const [bx, bz] = [rotated[i].x, rotated[i].z];
        let x = ax;
        let z = az;
        const stepX = Math.sign(bx - ax);
        const stepZ = Math.sign(bz - az);
        while (true) {
          for (let oz = -Math.floor(half); oz <= Math.ceil(half); oz++) {
            for (let ox = -Math.floor(half); ox <= Math.ceil(half); ox++) {
              const tile = this.tile(x + ox, z + oz);
              if (!tile || !overlayAllowedOn(overlay, tile.t)) continue;
              tile.v = overlay;
            }
          }
          if (x === bx && z === bz) break;
          if (x !== bx) x += stepX;
          if (z !== bz) z += stepZ;
        }
      }
    }
  }

  /**
   * Ore disc, stamped at all four rotations, only on ground that can hold it.
   *
   * The authored amount is a per-tile capacity. It is scaled here rather than in
   * every map because the whole competitive roster is played with the same
   * economy: a field that paid for one hopper per tile drained in the middle of
   * a match and left the sides on the headquarters trickle.
   */
  ore(cx: number, cz: number, radius: number, amount: number): void {
    const r2 = radius * radius + radius;
    for (const k of ROTATIONS) {
      const c = rotatePoint(this.size, k, cx, cz);
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dz * dz > r2) continue;
          const tile = this.tile(c.x + dx, c.z + dz);
          if (!tile) continue;
          if (!TERRAIN[tile.t as TerrainId].oreAllowed) continue;
          tile.o = Math.round(amount * ORE_YIELD_SCALE);
        }
      }
    }
  }

  /**
   * The 2×2 block at the exact map centre. A quarter turn maps this block onto
   * itself, so it is the one place a single placement is already symmetric.
   */
  centreBlock(terrain: TerrainId, elevation = 1): void {
    const q = this.quarter;
    for (const [x, z] of [
      [q - 1, q - 1],
      [q, q - 1],
      [q - 1, q],
      [q, q],
    ]) {
      this.write(x, z, terrain, elevation);
    }
  }

  /** A 2×2 structure centred on the map, e.g. the contested centre relay. */
  centreStructure(defId: string): void {
    this.structures.push({ defId, owner: -1, x: this.quarter - 1, z: this.quarter - 1 });
  }

  /**
   * Authored road bridge, stamped at all four rotations with its span turned
   * across the channel it crosses.
   *
   * The footprint is square, so the deck tiles and the wreckage agree in every
   * quadrant; only the span direction turns with the channel. Use it together
   * with `route` segments that stop at each bank: the deck itself is water, so
   * painting road through the channel would build a causeway instead.
   */
  bridge(x: number, z: number): void {
    const { w, h } = footprintOf('bridge');
    for (const k of ROTATIONS) {
      const r = rotateRect(this.size, k, x, z, w, h);
      this.structures.push({
        defId: 'bridge',
        owner: -1,
        x: r.x,
        z: r.z,
        // Wrapped into [-π, π], which is what the scenario format accepts.
        facing: ((k * (Math.PI / 2) + Math.PI) % (Math.PI * 2)) - Math.PI,
      });
    }
  }

  /** Neutral structure, stamped at all four rotations. */
  neutral(defId: string, x: number, z: number): void {
    const { w, h } = footprintOf(defId);
    for (const k of ROTATIONS) {
      const r = rotateRect(this.size, k, x, z, w, h);
      this.structures.push({ defId, owner: -1, x: r.x, z: r.z });
    }
  }

  /** One owned structure, rotated into quadrant `k`. */
  owned(k: Rotation, defId: string, x: number, z: number, owner: number): void {
    const { w, h } = footprintOf(defId);
    const r = rotateRect(this.size, k, x, z, w, h);
    this.structures.push({ defId, owner, x: r.x, z: r.z });
  }

  /** One unit, rotated into quadrant `k`. */
  unit(k: Rotation, defId: string, owner: number, x: number, z: number): void {
    const p = rotatePoint(this.size, k, x, z);
    this.units.push({ defId, owner, x: p.x, z: p.z });
  }
}

export interface BaseSpec {
  post: [number, number];
  /** Tile a player's camera and deployment centre on. */
  start: [number, number];
  /** Buildable yard, inclusive tile rect. */
  pad: [number, number, number, number];
  ground?: TerrainId;
  elevation?: number;
  /** Road from the yard to the centre hub, authored once and spun. */
  road?: Array<[number, number]>;
  /** Ore fields near the base, authored in quadrant coordinates. */
  ore?: Array<[number, number, number, number]>;
}

/** Starting force offsets from the start tile: identical for both seats. */
export const FORCE: ReadonlyArray<[string, number, number]> = [
  ['engineer', -1, -2],
  ['tank', 2, 0],
  ['tank', 1, 3],
  ['rifle', -1, 2],
  ['rifle', 2, -2],
  ['rifle', 3, 2],
  ['rifle', -2, 4],
  ['rifle', 4, -1],
];

export function placeBase(field: Field, spec: BaseSpec): void {
  const [x0, z0, x1, z1] = spec.pad;
  field.rect(x0, z0, x1, z1, spec.ground ?? Terrain.Grass, spec.elevation ?? 1);
  if (spec.road) field.route(spec.road, Terrain.Road);
  for (const [cx, cz, radius, amount] of spec.ore ?? []) field.ore(cx, cz, radius, amount);
  for (const k of [0, 2] as Rotation[]) {
    const owner = k === 0 ? 0 : 1;
    field.owned(k, 'commandPost', spec.post[0], spec.post[1], owner);
    for (const [defId, dx, dz] of FORCE) {
      field.unit(k, defId, owner, spec.start[0] + dx, spec.start[1] + dz);
    }
  }
}

export interface MapMeta {
  id: string;
  name: string;
  description: string;
  targetSize: 'small' | 'medium' | 'large';
}

const BUILDABLE_FALLBACK = [
  Terrain.Grass,
  Terrain.Farmland,
  Terrain.Sand,
  Terrain.Industrial,
  Terrain.Urban,
] as const;

/**
 * Guarantee every authored structure stands on ground that can hold it.
 *
 * Terrain and structures are authored separately: a marsh can grow over a
 * depot's footprint, or a ridge can rise through a relay. Rather than asking
 * every map to keep its features clear of its buildings by hand, the finished
 * scenario is repaired here — the footprint takes the nearest buildable ground
 * the map already uses, at one level, so the structure is legal and stays part
 * of the environment.
 *
 * Symmetry is preserved because the repair only reads the tile under each
 * footprint, and both are symmetric by construction.
 */
export function repairStructureGround(scenario: Scenario): number {
  const { width, height, tiles } = scenario;
  let repaired = 0;
  for (const structure of scenario.structures) {
    const def = BUILDINGS[structure.defId];
    const footprint = def?.footprint;
    if (!footprint) continue;
    // A span is meant to stand over water: levelling its footprint would turn
    // the channel it bridges into dry ground and delete the crossing.
    if (def?.walkable) continue;
    const cells: number[] = [];
    let needsWork = false;
    for (let dz = 0; dz < footprint.h; dz++) {
      for (let dx = 0; dx < footprint.w; dx++) {
        const x = structure.x + dx;
        const z = structure.z + dz;
        if (!inBounds(width, height, x, z)) continue;
        const i = tileIndex(width, x, z);
        cells.push(i);
        if (!tileBuildable(tiles[i].t, tiles[i].v ?? 0)) needsWork = true;
      }
    }
    if (cells.length === 0) continue;
    if (!needsWork) continue;
    // The replacement ground is read from the footprint's own cells, never from
    // its origin tile: on a rotated stamp the origin may itself be one of the
    // cells being repaired, which would give one quadrant a different answer
    // from its three rotations and break the map's symmetry.
    const ground =
      BUILDABLE_FALLBACK.find((candidate) =>
        cells.some((i) => tiles[i].t === candidate && tileBuildable(tiles[i].t, tiles[i].v ?? 0)),
      ) ?? Terrain.Grass;
    const level = Math.min(...cells.map((i) => tiles[i].e));
    for (const i of cells) {
      if (!tileBuildable(tiles[i].t, tiles[i].v ?? 0)) {
        tiles[i].t = ground;
        tiles[i].v = undefined;
        tiles[i].o = 0;
      }
      tiles[i].e = level;
    }
    repaired++;
  }
  return repaired;
}

export function assemble(
  field: Field,
  meta: MapMeta,
  start: [number, number],
  objectives: string[],
  settings: Partial<ScenarioSettings> & { seed: number },
): Scenario {
  const slots: ScenarioSlot[] = ROTATIONS.map((k) => rotatePoint(field.size, k, start[0], start[1]));
  const players: ScenarioPlayer[] = [
    {
      id: 0,
      name: 'Task Force Blue',
      factionId: 'baltic',
      team: 0,
      isAI: false,
      startX: slots[0].x,
      startZ: slots[0].z,
    },
    {
      id: 1,
      name: 'Task Force Red',
      factionId: 'expeditionary',
      team: 1,
      isAI: true,
      startX: slots[2].x,
      startZ: slots[2].z,
    },
  ];
  // Ore is authored in discs that know nothing about footprints, and a base pad
  // sits inside its own ore fields. Clear whatever ended up under a structure
  // before the map is handed out: a deposit nobody can mine strands harvesters.
  const assembled: Scenario = {
    format: MAP_FORMAT,
    version: MAP_FORMAT_VERSION,
    meta: {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      author: 'MCA scenario team',
      created: '2026-10-31',
      targetSize: meta.targetSize,
    },
    width: field.size,
    height: field.size,
    tiles: field.tiles,
    players,
    structures: field.structures,
    units: field.units,
    objectives,
    settings: {
      ...phaseSettings(settings.timeOfDay ?? 'dusk'),
      startingMats: 3000,
      startingReq: 180,
      fog: true,
      victory: 'destroyHQ',
      ...settings,
    },
    slots,
  };
  clearOreUnderStructures(assembled);
  repairStructureGround(assembled);
  return assembled;
}

/* ------------------------------------------------------------------ */
/* 1 — Open Front                                                      */
/* ------------------------------------------------------------------ */

/**
 * The reference competitive map: open ground with enough low cover that
 * infantry can hold a treeline, and enough clearance that armour is never
 * funnelled. Both seats reach the centre relay and the ring of signals relays
 * over open terrain from any of the four quadrants.
 */
export function createOpenFront(): Scenario {
  const field = new Field(84);
  const q = field.quarter;

  // Gentle rises, all one step high so every movement class can cross them.
  field.disc(30, 8, 5, Terrain.Grass, 2);
  field.disc(8, 30, 5, Terrain.Grass, 2);
  // Treelines that break sightlines without walling off a lane.
  field.disc(24, 24, 3, Terrain.Forest);
  field.disc(15, 35, 2, Terrain.Forest);
  field.disc(36, 12, 2, Terrain.Forest);
  // One low outcrop to anchor the midfield fight.
  field.disc(33, 34, 2, Terrain.Rock, 2);
  // Farmland belt on the outer approach, split by hedgerows: the map's second
  // identity is a cultivated countryside, and the fields give infantry a
  // covered route that armour has to respect without being able to enter.
  field.disc(20, 30, 5, Terrain.Farmland);
  field.overlayDisc(20, 30, 5, packOverlay(Overlay.Crop, 2));
  field.overlayDisc(26, 17, 3, packOverlay(Overlay.Crop, 1));
  field.overlayRoute(
    [
      [14, 26],
      [24, 26],
    ],
    packOverlay(Overlay.Hedge, 1),
  );
  field.overlayRoute(
    [
      [17, 14],
      [17, 22],
    ],
    packOverlay(Overlay.Hedge, 1),
  );

  placeBase(field, {
    post: [8, 8],
    start: [14, 14],
    pad: [7, 7, 20, 20],
    road: [
      [20, 14],
      [27, 14],
      [33, 24],
      [q - 2, q - 2],
    ],
    ore: [
      [17, 8, 2, 300],
      [8, 17, 2, 300],
      [26, 34, 2, 360],
    ],
  });

  // A ring of signals relays around the centre, one per quadrant.
  field.neutral('relay', q - 6, q - 6);
  field.neutral('supplyDepot', 33, 27);
  // The farm belt is inhabited: a farmhouse with its yard and a chapel with a
  // bell tower give infantry two reasons to leave the road and hold ground.
  field.neutral('farmhouse', 21, 27);
  field.neutral('chapel', 26, 22);
  // A lookout on the low rise covers the eastern approach.
  field.neutral('watchtower', 30, 9);
  field.centreBlock(Terrain.Road);
  field.centreStructure('relay');

  return assemble(
    field,
    {
      id: 'open-front',
      name: 'Open Front',
      description:
        'Open rolling ground with scattered treelines and two low ridges. The reference competitive map: every approach is viable, and the centre relay is the axis both sides fight around.',
      targetSize: 'medium',
    },
    [14, 14],
    [
      'Destroy the opposing Command Post.',
      'Capture the centre signals relay and the ring of relays.',
      'Seize the forward supply depot for supplementary materials.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_001, timeOfDay: 'day', weather: 'clear' },
  );
}

/* ------------------------------------------------------------------ */
/* 2 — Woodland Divide                                                 */
/* ------------------------------------------------------------------ */

/**
 * Broken ground: overlapping woodland separates the quadrants, so armour works
 * the clearings and the roads while infantry owns the trees. No single wood
 * closes a lane — three corridors leave every quadrant.
 */
export function createWoodlandDivide(): Scenario {
  const field = new Field(88);
  const q = field.quarter;

  // Broken wood, with the roads cut through it afterwards.
  field.disc(26, 12, 5, Terrain.Forest);
  field.disc(12, 26, 5, Terrain.Forest);
  field.disc(34, 34, 4, Terrain.Forest);
  field.disc(37, 20, 3, Terrain.Forest);
  field.disc(28, 8, 3, Terrain.Forest);
  // A knoll under the eastern wood, still a one-step climb.
  field.disc(37, 20, 3, Terrain.Forest, 2);
  // Clearings that open infantry routes through the tree belts.
  field.disc(20, 20, 2, Terrain.Grass, 1);
  field.disc(30, 24, 2, Terrain.Grass, 1);
  // Low rock at the inner corner, cover without a wall.
  field.disc(40, 30, 2, Terrain.Rock, 2);
  // Scrub fills the gaps between the woods, and the logging tracks are churned
  // into mud: the map now has three textures of cover instead of one.
  field.disc(31, 17, 4, Terrain.Scrub);
  field.disc(16, 33, 3, Terrain.Scrub);
  field.overlayRoute(
    [
      [19, 16],
      [26, 22],
      [31, 33],
    ],
    packOverlay(Overlay.Mud, 1),
  );
  field.overlayDisc(24, 31, 2, packOverlay(Overlay.Crater, 1));

  placeBase(field, {
    post: [7, 7],
    start: [13, 13],
    pad: [5, 5, 19, 19],
    road: [
      [19, 13],
      [23, 20],
      [29, 29],
      [q - 2, q - 2],
    ],
    ore: [
      [17, 8, 2, 300],
      [22, 21, 2, 320],
      [34, 26, 2, 380],
    ],
  });

  // A second track through the wood, so the road is not the only vehicle lane.
  field.route(
    [
      [19, 16],
      [26, 22],
      [31, 33],
      [q - 3, q - 3],
    ],
    Terrain.Road,
  );

  field.neutral('relay', q - 6, q - 6);
  field.neutral('supplyDepot', 30, 18);
  // Cleared ground in the wood: a farmstead and a timber lookout, both worth
  // fighting for and both easier to find than the trees around them.
  field.neutral('farmhouse', 20, 32);
  field.neutral('watchtower', 33, 25);
  field.centreBlock(Terrain.Road);
  field.centreStructure('relay');

  return assemble(
    field,
    {
      id: 'woodland-divide',
      name: 'Woodland Divide',
      description:
        'Overlapping woodland splits four quadrants into clearings and tracks. Concealed infantry can close on armour, but cut roads keep vehicles viable and no single treeline decides the match.',
      targetSize: 'medium',
    },
    [13, 13],
    [
      'Destroy the opposing Command Post.',
      'Hold the centre relay and the relays inside the woods.',
      'Use the treelines to ambush armour moving on the clearings.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_002, timeOfDay: 'dawn', weather: 'overcast' },
  );
}

/* ------------------------------------------------------------------ */
/* 3 — Drylands                                                        */
/* ------------------------------------------------------------------ */

/**
 * Armour country. Long ridges divide the map into wide lanes, raised plateaus
 * give tanks and self-propelled guns reach, and the richest ore sits out in the
 * open where holding ground matters more than holding a base.
 */
export function createDrylands(): Scenario {
  const field = new Field(112);
  const q = field.quarter;

  // Low ridges: two-tile walls that make lanes, both with gaps.
  field.route(
    [
      [10, 46],
      [22, 38],
      [30, 30],
    ],
    Terrain.Rock,
    2,
    2,
  );
  field.route(
    [
      [30, 10],
      [38, 18],
    ],
    Terrain.Rock,
    2,
    2,
  );
  field.route(
    [
      [46, 20],
      [40, 26],
    ],
    Terrain.Rock,
    2,
    2,
  );

  // Broad sandy basins between the ridges.
  field.disc(24, 24, 6, Terrain.Sand);
  field.disc(38, 40, 5, Terrain.Sand);
  // A raised central plateau, one step up from the basin so all classes climb.
  field.disc(q - 4, q - 4, 9, Terrain.Sand, 2);
  // Deep dune seas either side of the lanes, and broken rock where the ridges
  // decay: heavy armour has to choose a lane, not drive straight at the centre.
  field.disc(32, 24, 6, Terrain.Dune);
  field.disc(44, 20, 4, Terrain.Rocks, 1);
  field.overlayDisc(24, 24, 4, packOverlay(Overlay.Crater, 2));

  placeBase(field, {
    post: [9, 9],
    start: [16, 16],
    pad: [7, 7, 23, 23],
    ground: Terrain.Sand,
    road: [
      [23, 16],
      [32, 16],
      [40, 30],
      [q - 2, q - 2],
    ],
    ore: [
      [20, 10, 3, 340],
      [12, 32, 2, 300],
      [42, 32, 3, 420],
    ],
  });

  field.neutral('radarStation', q - 10, q - 10);
  field.neutral('supplyDepot', 30, 42);
  field.centreBlock(Terrain.Road, 2);
  field.centreStructure('relay');

  // Desert lookout: a bare timber tower on the dune ridge, the only shelter
  // for a squad watching the far approach.
  field.neutral('watchtower', 43, 26);
  return assemble(
    field,
    {
      id: 'drylands',
      name: 'Drylands',
      description:
        'Large sand basins split by long ridges. Wide vehicle lanes reward manoeuvre and long-range fire, while the plateau and the forward radar station pay whoever controls open ground.',
      targetSize: 'large',
    },
    [16, 16],
    [
      'Destroy the opposing Command Post.',
      'Control the ridgelines and the central plateau.',
      'Capture the radar station to extend detection.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_003, timeOfDay: 'day', weather: 'clear' },
  );
}

/* ------------------------------------------------------------------ */
/* 4 — Ironworks                                                       */
/* ------------------------------------------------------------------ */

/**
 * Industrial grid. Blocks of rubble and warehouses give infantry fighting
 * positions, the roads keep vehicles moving, and every block has more than one
 * way round it — the city restricts armour without caging it.
 */
export function createIronworks(): Scenario {
  const field = new Field(80);
  const q = field.quarter;

  // Industrial blocks, one per quadrant, cut by the street grid below.
  field.rect(20, 20, 29, 29, Terrain.Urban);
  field.rect(14, 26, 18, 33, Terrain.Urban);
  field.rect(26, 14, 33, 18, Terrain.Urban);
  field.rect(33, 24, 36, 29, Terrain.Urban);
  field.disc(37, 37, 2, Terrain.Rock, 2);
  // The yards themselves are concrete hardstanding, and the tenement blocks at
  // the inner edge are dense built-up ground: the district reads as a working
  // industrial site rather than a field of rubble.
  field.rect(20, 30, 27, 36, Terrain.Industrial);
  field.rect(30, 20, 36, 26, Terrain.Industrial);
  field.rect(21, 21, 25, 25, Terrain.DenseUrban);
  field.overlayDisc(30, 30, 4, packOverlay(Overlay.Crater, 2));
  field.overlayDisc(16, 22, 2, packOverlay(Overlay.Crater, 1));

  // Street grid: an outer avenue, an inner ring, and the hub approach.
  field.route(
    [
      [13, 18],
      [13, 36],
    ],
    Terrain.Road,
    2,
  );
  field.route(
    [
      [18, 13],
      [36, 13],
    ],
    Terrain.Road,
    2,
  );
  field.route(
    [
      [19, 19],
      [36, 19],
      [36, 36],
      [19, 36],
      [19, 19],
    ],
    Terrain.Road,
    1,
  );
  field.route(
    [
      [36, 28],
      [q - 2, q - 2],
    ],
    Terrain.Road,
    2,
  );

  placeBase(field, {
    post: [7, 7],
    start: [13, 13],
    pad: [5, 5, 18, 18],
    road: [
      [18, 13],
      [19, 19],
    ],
    ore: [
      [8, 24, 2, 320],
      [24, 8, 2, 320],
      [30, 32, 2, 360],
    ],
  });

  // Neutral industry: garrisonable cover on every approach to the hub. These
  // footprints are square on purpose — the scenario format stores a structure
  // as an origin, so a 5×4 building cannot express its own quarter turn and
  // would break four-way symmetry.
  field.neutral('tenement', 22, 22);
  field.neutral('tenement', 28, 15);
  field.neutral('ruin', 15, 30);
  field.neutral('ruin', 34, 26);
  field.neutral('relay', q - 10, q - 7);
  // Forward stocks in the hardstanding behind the inner yards: the depot is a
  // contested walk from either base, and it keeps paying once the ore is gone.
  field.neutral('supplyDepot', 22, 32);
  field.centreBlock(Terrain.Urban);
  field.centreStructure('relay');

  return assemble(
    field,
    {
      id: 'ironworks',
      name: 'Ironworks',
      description:
        'A dense industrial grid of warehouses, offices and rubble. Infantry holds the blocks, vehicles fight for the avenues, and the central relay sits where four streets meet.',
      targetSize: 'medium',
    },
    [13, 13],
    [
      'Destroy the opposing Command Post.',
      'Clear the industrial blocks and hold the hub relay.',
      'Garrison the warehouses to lock the avenues.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_004, timeOfDay: 'day', weather: 'overcast' },
  );
}

/* ------------------------------------------------------------------ */
/* 5 — Crossing Point                                                  */
/* ------------------------------------------------------------------ */

/**
 * A river diamond around the centre. One road bridge and one shallow ford cross
 * each side, so a commander can trade speed for surprise. Armour needs the
 * bridges, infantry can wade, and the inner arena is where the relays are.
 */
export function createCrossingPoint(): Scenario {
  const field = new Field(96);
  const q = field.quarter;

  // The diamond: a two-tile river on the line x + z = 72, rotated four times.
  field.route(
    [
      [q - 2, 26],
      [26, q - 2],
    ],
    Terrain.DeepWater,
    2,
    0,
  );
  field.route(
    [
      [q - 1, 27],
      [27, q - 1],
    ],
    Terrain.DeepWater,
    2,
    0,
  );
  field.shore(Terrain.Sand, 1);
  // Marsh and reed beds along the inner bank: the crossings stay the only way
  // across for armour, and the bog itself is a slow, concealing flank route for
  // infantry that wants to arrive unseen.
  field.disc(34, 44, 4, Terrain.Marsh);
  field.disc(42, 36, 3, Terrain.Marsh);
  field.overlayDisc(34, 44, 4, packOverlay(Overlay.Reeds, 2));
  field.overlayDisc(42, 36, 3, packOverlay(Overlay.Reeds, 1));
  field.overlayDisc(30, 36, 2, packOverlay(Overlay.Mud, 2));

  // The bridge: a road straight through the diamond at the inner corner.
  field.route(
    [
      [32, 32],
      [q + 2, q + 2],
    ],
    Terrain.Road,
    1,
  );
  // The ford: shallow water further out, slower but unmissable to recon.
  field.recolour(
    [
      [24, 36],
      [36, 48],
    ],
    Terrain.DeepWater,
    Terrain.ShallowWater,
    2,
  );

  placeBase(field, {
    post: [9, 9],
    start: [16, 16],
    pad: [7, 7, 22, 22],
    road: [
      [22, 16],
      [26, 24],
      [32, 32],
    ],
    ore: [
      [18, 9, 2, 320],
      [10, 20, 2, 300],
    ],
  });

  // Inner arena: ore and a relay behind the river, paid for at the crossings.
  field.ore(q - 6, q - 6, 2, 340);
  field.neutral('relay', q - 14, q - 14);
  field.neutral('supplyDepot', 28, 26);
  field.centreBlock(Terrain.Grass);
  field.centreStructure('relay');

  // The river farm: a walled yard either side of the bridge approach, worth
  // holding whoever owns the crossing.
  field.neutral('farmhouse', 22, 22);
  return assemble(
    field,
    {
      id: 'crossing-point',
      name: 'Crossing Point',
      description:
        'A river diamond closes off the centre. Each side has one road bridge and one shallow ford: armour wants the bridges, infantry can wade, and the inner arena holds the relays.',
      targetSize: 'medium',
    },
    [16, 16],
    [
      'Destroy the opposing Command Post.',
      'Cross the river and hold the inner relays.',
      'Choose between the bridges for speed and the fords for surprise.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_005, timeOfDay: 'dusk', weather: 'clear' },
  );
}

/* ------------------------------------------------------------------ */
/* 6 — High Ground                                                     */
/* ------------------------------------------------------------------ */

/**
 * A terraced massif sits over the centre, one step per terrace so every
 * movement class can climb it. Artillery that takes the high ground owns the
 * approaches, but the ramps are wide, few and exposed, so the position has to
 * be held rather than merely reached.
 */
export function createHighGround(): Scenario {
  const field = new Field(104);
  const q = field.quarter;

  // Terraced hill: 1 → 2 → 3 in single steps, merged across the centre.
  field.disc(q - 6, q - 6, 16, Terrain.Grass, 2);
  field.disc(q - 6, q - 6, 10, Terrain.Grass, 3);
  // Rock spurs that shape the ramps without closing them.
  field.route(
    [
      [q - 18, 34],
      [q - 12, 40],
    ],
    Terrain.Rock,
    2,
    3,
  );
  field.route(
    [
      [34, q - 18],
      [40, q - 12],
    ],
    Terrain.Rock,
    2,
    3,
  );
  field.disc(20, 40, 3, Terrain.Forest);
  field.disc(40, 20, 3, Terrain.Forest);
  // Rocky ground at the foot of the massif, and cultivated terraces on the low
  // ground: the approach is now a choice between stone cover and open fields.
  field.disc(24, 30, 4, Terrain.Rocks, 2);
  field.disc(30, 22, 3, Terrain.Rocks, 2);
  field.disc(22, 20, 4, Terrain.Farmland, 1);
  field.overlayDisc(22, 20, 4, packOverlay(Overlay.Crop, 2));

  placeBase(field, {
    post: [9, 9],
    start: [16, 16],
    pad: [7, 7, 22, 22],
    road: [
      [22, 16],
      [28, 18],
      [32, 26],
      [36, 34],
      [q - 4, q - 4],
    ],
    ore: [
      [20, 9, 3, 340],
      [9, 20, 2, 300],
      [40, 32, 2, 320],
    ],
  });

  field.neutral('radarStation', 36, 44);
  field.neutral('relay', q - 16, q - 12);
  // The depot sits on the upper terrace beside the crest: taking the hill and
  // then holding the stocks on it is the same decision, not two.
  field.neutral('supplyDepot', 44, 44);
  // The centre block sits on the crest, at the crest's elevation: a 2×2 dip to
  // sea level would be a step vehicles cannot climb out of.
  field.centreBlock(Terrain.Road, 3);
  field.centreStructure('relay');

  // Hilltop chapel: the best observation on the ridge, and the one landmark
  // both commanders can see from their own side.
  field.neutral('chapel', 34, 23);
  return assemble(
    field,
    {
      id: 'high-ground',
      name: 'High Ground',
      description:
        'A terraced massif over the centre, ringed by forested slopes. Artillery and long-range fire dominate from the top, but the ramps are wide, exposed and shared by both sides.',
      targetSize: 'large',
    },
    [16, 16],
    [
      'Destroy the opposing Command Post.',
      'Take the massif and hold the radar station.',
      'Cover the ramps before moving guns onto the crest.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_006, timeOfDay: 'dawn', weather: 'overcast' },
  );
}

/* ------------------------------------------------------------------ */
/* 7 — Littoral                                                        */
/* ------------------------------------------------------------------ */

/**
 * Coastal plains. A sheltered sea fills each outer corner, beaches and dunes
 * frame the land approaches, and the bases sit on the coast with the fight
 * inland. No naval unit is required: the water is terrain, not a domain.
 */
export function createLittoral(): Scenario {
  const field = new Field(120);
  const q = field.quarter;

  // Corner seas, authored in the quadrant and stamped into all four corners.
  for (let z = 0; z < q; z++) {
    for (let x = 0; x < q; x++) {
      const edge = x + z;
      if (edge < 22) field.set(x, z, Terrain.DeepWater, 0);
      else if (edge < 26) field.set(x, z, Terrain.ShallowWater, 0);
      else if (edge < 31) field.set(x, z, Terrain.Sand, 0);
    }
  }
  field.shore(Terrain.Sand, 1);

  // Dune ridges inland: one step up, passable by every class.
  field.disc(34, 34, 4, Terrain.Sand, 2);
  field.disc(20, 48, 3, Terrain.Grass, 2);
  field.disc(48, 20, 3, Terrain.Grass, 2);
  field.disc(44, 44, 3, Terrain.Forest, 2);
  // The coastal flats are dunes and salt marsh: the seaward flank is passable
  // but slow, and the reed beds along the shore hide anybody advancing on it.
  field.disc(30, 42, 4, Terrain.Dune, 1);
  field.disc(42, 30, 4, Terrain.Dune, 1);
  field.disc(34, 22, 3, Terrain.Marsh);
  field.overlayDisc(34, 22, 3, packOverlay(Overlay.Reeds, 2));
  field.overlayDisc(38, 30, 2, packOverlay(Overlay.Crater, 1));

  placeBase(field, {
    post: [36, 12],
    start: [42, 18],
    pad: [34, 10, 49, 25],
    road: [
      [49, 18],
      [54, 28],
      [q - 2, q - 2],
    ],
    ore: [
      [38, 26, 2, 320],
      [28, 14, 2, 300],
    ],
  });

  // Coastal road along the beach, giving the seaward flank a real route.
  field.route(
    [
      [42, 30],
      [48, 34],
      [52, 42],
      [q - 4, q - 4],
    ],
    Terrain.Road,
  );

  field.neutral('relay', q - 8, q - 8);
  field.neutral('supplyDepot', 26, 34);
  field.centreBlock(Terrain.Road);
  field.centreStructure('relay');

  // A shore farm behind the dunes: thin walls, but it covers the coastal road.
  field.neutral('farmhouse', 47, 27);
  return assemble(
    field,
    {
      id: 'littoral',
      name: 'Littoral',
      description:
        'Coastal plains with a sheltered sea in every outer corner. Beaches, dunes and two inland roads give the flanks room, and the coastal supply depot pays for holding the shore.',
      targetSize: 'large',
    },
    [42, 18],
    [
      'Destroy the opposing Command Post.',
      'Hold the coastal supply depot and the centre relay.',
      'Use the beaches to turn an inland push.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_007, timeOfDay: 'day', weather: 'clear' },
  );
}

/* ------------------------------------------------------------------ */
/* 8 — Contact Zone                                                    */
/* ------------------------------------------------------------------ */

/**
 * The short map. Bases sit well inside their quadrants, so the first fight
 * starts in under a minute; rubble in the middle still leaves room to flank
 * rather than trade units head-on at the centre tile.
 */
export function createContactZone(): Scenario {
  const field = new Field(64);
  const q = field.quarter;

  // A tight urban core with three ways round it.
  field.rect(21, 21, 30, 30, Terrain.Urban);
  field.rect(16, 24, 19, 29, Terrain.Urban);
  field.rect(24, 16, 29, 19, Terrain.Urban);
  field.disc(13, 26, 2, Terrain.Rock, 2);
  field.disc(26, 13, 2, Terrain.Rock, 2);
  field.disc(20, 8, 2, Terrain.Forest);
  // The core is a dense built-up block, ringed by industrial hardstanding: the
  // short map's fight is now street to street rather than rubble to rubble.
  field.rect(23, 23, 28, 28, Terrain.DenseUrban);
  field.rect(17, 27, 20, 31, Terrain.DenseUrban);
  field.rect(27, 17, 31, 20, Terrain.Industrial);
  field.overlayDisc(19, 19, 2, packOverlay(Overlay.Crater, 2));
  field.overlayDisc(26, 20, 2, packOverlay(Overlay.Crater, 1));

  field.route(
    [
      [21, 16],
      [24, 24],
      [q - 2, q - 2],
    ],
    Terrain.Road,
    1,
  );
  field.route(
    [
      [16, 22],
      [28, 28],
    ],
    Terrain.Road,
    1,
  );

  placeBase(field, {
    post: [11, 11],
    start: [16, 16],
    pad: [9, 9, 22, 22],
    road: [
      [22, 16],
      [24, 20],
    ],
    ore: [
      [12, 6, 2, 300],
      [6, 12, 2, 300],
      [21, 21, 2, 340],
    ],
  });

  field.neutral('ruin', 24, 24);
  field.neutral('relay', q - 5, q - 5);
  // A stockpile in the street south of the core: close enough to be fought over
  // on this short map, far enough that taking it is not a free walk from base.
  field.neutral('supplyDepot', 21, 29);
  field.centreBlock(Terrain.Urban);
  field.centreStructure('relay');

  return assemble(
    field,
    {
      id: 'contact-zone',
      name: 'Contact Zone',
      description:
        'A compact urban core with short approaches. Bases are close, the first contact is quick, and the rubble still leaves three ways round the centre relay.',
      targetSize: 'small',
    },
    [16, 16],
    [
      'Destroy the opposing Command Post.',
      'Take the centre relay before the other side can dig in.',
      'Flank the core rather than trading at the centre tile.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_008, timeOfDay: 'dusk', weather: 'clear' },
  );
}

/* ------------------------------------------------------------------ */
/* 9 — Blackwater Fens                                                 */
/* ------------------------------------------------------------------ */

/**
 * The wetland map. Two shallow channels cut the quadrant diagonally and the
 * ground between them is marsh, so the shortest line to the centre is also the
 * slowest; the few firm causeways are where the fight happens. Nothing here is
 * impassable: armour can cross the fen, it just pays for it.
 */
export function createBlackwaterFens(): Scenario {
  const field = new Field(72);
  const q = field.quarter;

  // Shallow channels: wadeable by every class, so no site is cut off.
  field.route(
    [
      [8, 26],
      [26, 8],
    ],
    Terrain.ShallowWater,
    2,
    0,
  );
  field.route(
    [
      [18, 32],
      [32, 18],
    ],
    Terrain.ShallowWater,
    1,
    0,
  );
  // Marsh between and around them, with reeds deep enough to hide a squad.
  field.disc(20, 20, 6, Terrain.Marsh);
  field.disc(30, 12, 4, Terrain.Marsh);
  field.disc(12, 30, 4, Terrain.Marsh);
  field.overlayDisc(20, 20, 5, packOverlay(Overlay.Reeds, 2));
  field.overlayDisc(30, 12, 4, packOverlay(Overlay.Reeds, 1));
  field.overlayDisc(12, 30, 4, packOverlay(Overlay.Reeds, 1));
  // Churned silt where the fen drains into the channel: mud is a surface, not a
  // wetland, so it is the one place in the fen that is merely slow.
  field.disc(24, 16, 3, Terrain.Mud);
  // Causeways: the only ground that drains, so vehicles have lanes to use.
  field.recolour(
    [
      [14, 34],
      [q - 6, q - 6],
    ],
    Terrain.Marsh,
    Terrain.Farmland,
    2,
  );
  field.overlayRoute(
    [
      [10, 22],
      [20, 30],
      [q - 5, q - 5],
    ],
    packOverlay(Overlay.Mud, 1),
    2,
  );

  placeBase(field, {
    post: [7, 7],
    start: [12, 12],
    pad: [5, 5, 18, 18],
    road: [
      [18, 12],
      [22, 18],
      [q - 2, q - 2],
    ],
    ore: [
      [14, 7, 2, 300],
      [7, 14, 2, 300],
      [26, 26, 2, 320],
    ],
  });

  field.neutral('relay', q - 7, q - 7);
  field.neutral('supplyDepot', 26, 14);
  field.centreBlock(Terrain.Farmland);
  field.centreStructure('relay');

  // Fen lookout on the causeway: a periscope over the reeds, and a fragile one.
  field.neutral('watchtower', 27, 18);
  return assemble(
    field,
    {
      id: 'blackwater-fens',
      name: 'Blackwater Fens',
      description:
        'Reed beds and shallow channels split every approach. Vehicles can cross the fen, but they pay for it; infantry that uses the reeds arrives unseen.',
      targetSize: 'small',
    },
    [12, 12],
    [
      'Destroy the opposing Command Post.',
      'Hold the causeways and the centre relay.',
      'Cross the fen under cover of the reeds.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_009, timeOfDay: 'dawn', weather: 'overcast' },
  );
}

/* ------------------------------------------------------------------ */
/* 10 — Hedgerow Vale                                                  */
/* ------------------------------------------------------------------ */

/**
 * Bocage. Cultivated fields divided by hedgerows: the banks break sight lines
 * and give cover, the crops hide infantry inside the fields, and the field
 * boundaries turn the countryside into a maze of small enclosures.
 */
export function createHedgerowVale(): Scenario {
  const field = new Field(100);
  const q = field.quarter;

  // Field system: farmland over the outer half, hedgerows on the boundaries.
  field.disc(20, 20, 10, Terrain.Farmland);
  field.disc(34, 30, 8, Terrain.Farmland);
  field.disc(28, 12, 6, Terrain.Farmland);
  field.overlayDisc(20, 20, 10, packOverlay(Overlay.Crop, 2));
  field.overlayDisc(34, 30, 8, packOverlay(Overlay.Crop, 2));
  field.overlayDisc(28, 12, 6, packOverlay(Overlay.Crop, 1));
  field.overlayRoute(
    [
      [10, 26],
      [30, 26],
    ],
    packOverlay(Overlay.Hedge, 1),
  );
  field.overlayRoute(
    [
      [26, 10],
      [26, 30],
    ],
    packOverlay(Overlay.Hedge, 1),
  );
  field.overlayRoute(
    [
      [34, 24],
      [34, 40],
    ],
    packOverlay(Overlay.Hedge, 1),
  );
  field.overlayRoute(
    [
      [14, 34],
      [26, 34],
    ],
    packOverlay(Overlay.Hedge, 1),
  );
  // Wooded and marshy corners, so the map is not farmland to the horizon.
  field.disc(40, 16, 4, Terrain.Forest);
  field.disc(16, 42, 4, Terrain.Scrub);
  field.overlayDisc(18, 44, 3, packOverlay(Overlay.Mud, 1));

  placeBase(field, {
    post: [8, 8],
    start: [14, 14],
    pad: [6, 6, 22, 22],
    road: [
      [22, 14],
      [30, 18],
      [q - 2, q - 2],
    ],
    ore: [
      [16, 8, 2, 320],
      [8, 16, 2, 320],
      [34, 34, 3, 400],
    ],
  });

  field.neutral('relay', q - 8, q - 8);
  field.neutral('supplyDepot', 30, 24);
  // The vale is farmed and it is inhabited: a farmstead inside the crop belt and
  // a chapel whose tower sees across the hedgerows.
  field.neutral('farmhouse', 18, 34);
  field.neutral('chapel', 30, 36);
  field.centreBlock(Terrain.Farmland);
  field.centreStructure('relay');

  return assemble(
    field,
    {
      id: 'hedgerow-vale',
      name: 'Hedgerow Vale',
      description:
        'Cultivated fields divided by hedgerows. Every bank breaks a sight line and gives cover, the crops hide infantry inside the fields, and armour is funnelled along the lanes between them.',
      targetSize: 'medium',
    },
    [14, 14],
    [
      'Destroy the opposing Command Post.',
      'Fight through the enclosures to the centre relay.',
      'Use hedgerows to break up an armoured push.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_010, timeOfDay: 'day', weather: 'clear' },
  );
}

/* ------------------------------------------------------------------ */
/* 11 — Thorn Scrub                                                    */
/* ------------------------------------------------------------------ */

/**
 * The smallest, closest competitive map. Scrub and brush everywhere: almost
 * every tile conceals infantry, sight lines are short, and there is no room to
 * set up a long-range engagement. Numbers and ground matter more than reach.
 */
export function createThornScrub(): Scenario {
  const field = new Field(76);
  const q = field.quarter;

  field.disc(18, 18, 8, Terrain.Scrub);
  field.disc(30, 14, 5, Terrain.Scrub);
  field.disc(14, 30, 5, Terrain.Scrub);
  field.disc(30, 30, 6, Terrain.Scrub);
  field.disc(22, 8, 3, Terrain.Forest);
  field.disc(8, 22, 3, Terrain.Forest);
  field.disc(34, 24, 2, Terrain.Rocks, 1);
  // Broken ground: the scars of an earlier battle, not fresh terrain.
  field.overlayDisc(18, 18, 5, packOverlay(Overlay.Crater, 1));
  field.overlayDisc(30, 30, 4, packOverlay(Overlay.Crater, 2));
  field.overlayRoute(
    [
      [12, 26],
      [26, 32],
    ],
    packOverlay(Overlay.Mud, 1),
    2,
  );

  placeBase(field, {
    post: [7, 7],
    start: [12, 12],
    pad: [5, 5, 18, 18],
    road: [
      [18, 12],
      [24, 18],
      [q - 2, q - 2],
    ],
    ore: [
      [13, 6, 2, 300],
      [6, 13, 2, 300],
      [28, 24, 2, 340],
    ],
  });

  field.neutral('relay', q - 6, q - 6);
  field.neutral('supplyDepot', 26, 16);
  field.centreBlock(Terrain.Scrub);
  field.centreStructure('relay');

  // A collapsed farmstead at the scrub edge: two infantry, one firing
  // position, and enough broken wall to trade shots from.
  field.neutral('ruin', 33, 19);
  return assemble(
    field,
    {
      id: 'thorn-scrub',
      name: 'Thorn Scrub',
      description:
        'Close, brush-covered ground where almost every tile hides infantry and no sight line runs far. Scouting is hard, ambushes are cheap, and the centre relay sits in the thickest scrub on the map.',
      targetSize: 'small',
    },
    [12, 12],
    [
      'Destroy the opposing Command Post.',
      'Clear the scrub and take the centre relay.',
      'Use the brush to close on armour unseen.',
      'Keep your own Command Post operational.',
    ],
    { seed: 81_011, timeOfDay: 'dusk', weather: 'overcast' },
  );
}
