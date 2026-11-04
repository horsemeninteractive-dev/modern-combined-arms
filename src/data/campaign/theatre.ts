/**
 * Campaign theatre kit.
 *
 * Campaign operations are not mirrored skirmish maps: each one has an attacker,
 * a defender and a piece of ground that only makes sense from one side. The
 * competitive maps in `competitiveMaps.ts` are built from a quadrant library so
 * every map is rotationally symmetric by construction; that library cannot
 * express "the beachhead is west and the ridge pass is east".
 *
 * This kit is the asymmetric counterpart. It is a painter, not a map format: it
 * writes the same tiles, structures, units and settings every other scenario
 * uses, and `build()` hands back an ordinary scenario that the editor, the
 * validation pass and the campaign loader all read unchanged.
 *
 * Determinism matters. Scatter and blob painting use a local seeded generator,
 * so a theatre is byte-identical every time it is built, which is what lets a
 * saved campaign battle and a fresh launch agree.
 */
import { MAP_FORMAT, MAP_FORMAT_VERSION } from '../../sim/constants';
import { Terrain, inBounds, isNavigable, tileIndex, type TerrainId } from '../../sim/terrain';
import {
  clearOreUnderStructures,
  defaultSettings,
  type Scenario,
  type ScenarioPlayer,
  type ScenarioRestrictions,
  type ScenarioSettings,
  type ScenarioStructure,
  type ScenarioTile,
  type ScenarioUnit,
} from '../../sim/scenario';
import { BUILDINGS } from '../buildings';

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TheatrePlayerSpec {
  name: string;
  factionId: string;
  /** Centre of the deployment area; units are spread around it. */
  start: readonly [number, number];
  isAI?: boolean;
  /** Technologies the operation has already issued to this commander. */
  technologies?: readonly string[];
  /** What the operation withholds; absent means the full roster. */
  restrictions?: ScenarioRestrictions;
}

export interface TheatreMeta {
  id: string;
  name: string;
  description: string;
  targetSize: 'small' | 'medium' | 'large';
  author?: string;
  created?: string;
}

export interface StructureOptions {
  key?: string;
  facing?: number;
  /** Ground painted under the footprint. Defaults to grass. */
  ground?: TerrainId;
  elevation?: number;
  /** Leave the authored ground alone instead of levelling the footprint. */
  keepGround?: boolean;
}

const WATER: readonly number[] = [Terrain.DeepWater, Terrain.ShallowWater];

const isWaterTerrain = (t: number): boolean => WATER.includes(t);

export class Theatre {
  readonly width: number;
  readonly height: number;
  readonly tiles: ScenarioTile[];
  readonly structures: ScenarioStructure[] = [];
  readonly units: ScenarioUnit[] = [];
  private readonly rng: () => number;
  private readonly occupied = new Set<number>();

  constructor(width: number, height: number, seed = 1337) {
    this.width = width;
    this.height = height;
    this.rng = mulberry32(seed);
    this.tiles = new Array(width * height);
    for (let i = 0; i < this.tiles.length; i++) {
      this.tiles[i] = { t: Terrain.Grass, e: 1, o: 0 };
    }
  }

  /* ------------------------------- tiles ------------------------------- */

  inBounds(x: number, z: number): boolean {
    return inBounds(this.width, this.height, x, z);
  }

  get(x: number, z: number): ScenarioTile | undefined {
    if (!this.inBounds(x, z)) return undefined;
    return this.tiles[tileIndex(this.width, x, z)];
  }

  set(x: number, z: number, terrain: TerrainId, elevation?: number, ore?: number): void {
    if (!this.inBounds(x, z)) return;
    const tile = this.tiles[tileIndex(this.width, x, z)];
    tile.t = terrain;
    if (elevation !== undefined) tile.e = elevation;
    if (ore !== undefined) tile.o = ore;
  }

  /** Paint one tile only when it is currently ground (not water). */
  setLand(x: number, z: number, terrain: TerrainId, elevation?: number): void {
    const tile = this.get(x, z);
    if (!tile || isWaterTerrain(tile.t)) return;
    tile.t = terrain;
    if (elevation !== undefined) tile.e = elevation;
  }

  rect(x: number, z: number, w: number, h: number, terrain: TerrainId, elevation?: number): void {
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) this.set(x + dx, z + dz, terrain, elevation);
    }
  }

  disc(cx: number, cz: number, radius: number, terrain: TerrainId, elevation?: number): void {
    const r2 = radius * radius;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > r2) continue;
        this.set(cx + dx, cz + dz, terrain, elevation);
      }
    }
  }

  /**
   * An irregular patch: a disc whose edge is pushed in and out by the seeded
   * generator. Two forests of the same radius therefore never look stamped.
   */
  blob(cx: number, cz: number, radius: number, terrain: TerrainId, elevation?: number): void {
    const wave = [this.rng(), this.rng(), this.rng()];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const angle = Math.atan2(dz, dx);
        const wobble =
          1 +
          0.22 * Math.sin(angle * 3 + wave[0] * 6.28) +
          0.14 * Math.sin(angle * 5 + wave[1] * 6.28) +
          0.08 * Math.sin(angle * 7 + wave[2] * 6.28);
        if (Math.sqrt(dx * dx + dz * dz) > radius * wobble) continue;
        this.set(cx + dx, cz + dz, terrain, elevation);
      }
    }
  }

  /** A straight stroke of terrain `width` tiles wide. */
  line(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    terrain: TerrainId,
    width = 1,
    elevation?: number,
  ): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
    const half = Math.floor((width - 1) / 2);
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const z = Math.round(z0 + (z1 - z0) * t);
      for (let dz = -half; dz <= half + (width % 2 === 0 ? 1 : 0); dz++) {
        for (let dx = -half; dx <= half + (width % 2 === 0 ? 1 : 0); dx++) {
          this.set(x + dx, z + dz, terrain, elevation);
        }
      }
    }
  }

  /** A road through authored waypoints, kept two tiles wide for armour. */
  road(points: ReadonlyArray<readonly [number, number]>, width = 2): void {
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1];
      const [bx, bz] = points[i];
      this.line(ax, az, bx, bz, Terrain.Road, width, 1);
    }
  }

  /** A ridge line: rock at high ground, with the authored passes left open. */
  ridge(points: ReadonlyArray<readonly [number, number]>, width = 3): void {
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1];
      const [bx, bz] = points[i];
      this.line(ax, az, bx, bz, Terrain.Rock, width, 2);
    }
  }

  /** Water where the mask holds, then the shallow margin and the beach. */
  sea(mask: (x: number, z: number) => boolean, beach = true): void {
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        if (!mask(x, z)) continue;
        this.set(x, z, Terrain.DeepWater, 0, 0);
      }
    }
    const landNeighbour = (x: number, z: number): boolean => {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const tile = this.get(x + dx, z + dz);
          if (tile && !isWaterTerrain(tile.t)) return true;
        }
      }
      return false;
    };
    const waterNeighbour = (x: number, z: number): boolean => {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const tile = this.get(x + dx, z + dz);
          if (tile && isWaterTerrain(tile.t)) return true;
        }
      }
      return false;
    };
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.get(x, z)!;
        if (tile.t === Terrain.DeepWater && landNeighbour(x, z)) {
          tile.t = Terrain.ShallowWater;
        }
      }
    }
    if (!beach) return;
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.get(x, z)!;
        if (isWaterTerrain(tile.t)) continue;
        if (tile.t !== Terrain.Grass && tile.t !== Terrain.Scrub) continue;
        if (!waterNeighbour(x, z)) continue;
        tile.t = Terrain.Sand;
        tile.e = 1;
      }
    }
  }

  /** Scatter `count` patches of one terrain over an optional area. */
  scatter(
    terrain: TerrainId,
    count: number,
    options: {
      radius?: number;
      elevation?: number;
      within?: (x: number, z: number) => boolean;
    } = {},
  ): void {
    const radius = options.radius ?? 2;
    for (let i = 0; i < count; i++) {
      const x = Math.floor(this.rng() * this.width);
      const z = Math.floor(this.rng() * this.height);
      if (options.within && !options.within(x, z)) continue;
      this.blob(x, z, radius, terrain, options.elevation);
    }
  }

  /** A material deposit. `amount` is the per-tile reserve. */
  ore(cx: number, cz: number, radius: number, amount = 900): void {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const tile = this.get(cx + dx, cz + dz);
        if (!tile || isWaterTerrain(tile.t)) continue;
        if (!this.buildableGround(tile.t)) continue;
        tile.o = amount;
      }
    }
  }

  private buildableGround(terrain: number): boolean {
    return (
      terrain === Terrain.Grass ||
      terrain === Terrain.Sand ||
      terrain === Terrain.Farmland ||
      terrain === Terrain.Scrub ||
      terrain === Terrain.Road ||
      terrain === Terrain.Urban ||
      terrain === Terrain.Industrial ||
      terrain === Terrain.DenseUrban ||
      terrain === Terrain.Mud
    );
  }

  /* ---------------------------- placements ---------------------------- */

  /**
   * Whether a structure footprint fits at a tile.
   *
   * A footprint has to be inside the map, on ground rather than water, clear of
   * every other placement, and — when the structure needs a harbour — touching
   * deep water. `coastal` widens the search instead of refusing the placement,
   * because a map author names the intended bay, not the exact tile.
   */
  private footprintFits(x: number, z: number, w: number, h: number, coastal: boolean): boolean {
    let touchesDeep = false;
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const cx2 = x + dx;
        const cz2 = z + dz;
        if (!this.inBounds(cx2, cz2)) return false;
        const tile = this.get(cx2, cz2)!;
        if (isWaterTerrain(tile.t)) return false;
        if (this.occupied.has(tileIndex(this.width, cx2, cz2))) return false;
        if (!coastal) continue;
        for (const [nx, nz] of [
          [cx2 + 1, cz2],
          [cx2 - 1, cz2],
          [cx2, cz2 + 1],
          [cx2, cz2 - 1],
        ] as const) {
          const neighbour = this.get(nx, nz);
          // Validation accepts any navigable ring tile, and a shallow margin is
          // exactly where a yard is meant to sit.
          if (neighbour && isNavigable(neighbour.t)) touchesDeep = true;
        }
      }
    }
    return coastal ? touchesDeep : true;
  }

  /**
   * Place a structure centred on a tile.
   *
   * A hand-authored centre can land on top of another structure, near the map
   * edge or with its footprint straddling a shoreline. Rather than asking every
   * map to keep its buildings perfectly apart by hand, the nearest fitting tile
   * is used and the footprint is levelled so the structure is legal.
   */
  structure(
    defId: string,
    owner: number,
    cx: number,
    cz: number,
    options: StructureOptions = {},
  ): void {
    const def = BUILDINGS[defId];
    if (!def) throw new Error(`Unknown structure "${defId}" in campaign theatre`);
    const w = def.footprint.w;
    const h = def.footprint.h;
    const startX = cx - Math.floor(w / 2);
    const startZ = cz - Math.floor(h / 2);
    const coastal = Boolean(def.requiresWater);
    // A harbour may have to travel to find its coast; an ordinary building only
    // steps aside for its neighbours.
    const maxRadius = coastal ? 30 : 14;
    let found: { x: number; z: number } | null = null;
    for (let radius = 0; radius <= maxRadius && !found; radius++) {
      for (let dz = -radius; dz <= radius && !found; dz++) {
        for (let dx = -radius; dx <= radius && !found; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          if (this.footprintFits(startX + dx, startZ + dz, w, h, coastal)) {
            found = { x: startX + dx, z: startZ + dz };
          }
        }
      }
    }
    if (!found) throw new Error(`No room for ${defId} near ${cx},${cz}`);
    const { x, z } = found;
    if (!options.keepGround) {
      const ground = options.ground ?? Terrain.Grass;
      for (let dz = 0; dz < h; dz++) {
        for (let dx = 0; dx < w; dx++) {
          this.set(x + dx, z + dz, ground, options.elevation ?? 1, 0);
        }
      }
    }
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) {
        this.occupied.add(tileIndex(this.width, x + dx, z + dz));
      }
    }
    this.structures.push({
      defId,
      owner,
      x,
      z,
      ...(options.key ? { key: options.key } : {}),
      ...(options.facing === undefined ? {} : { facing: options.facing }),
    });
  }

  unit(defId: string, owner: number, x: number, z: number, key?: string): void {
    this.units.push({ defId, owner, x, z, ...(key ? { key } : {}) });
    this.occupied.add(tileIndex(this.width, x, z));
  }

  private free(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const tile = this.get(x, z)!;
    if (isWaterTerrain(tile.t)) return false;
    if (tile.t === Terrain.Rock || tile.t === Terrain.Rocks) return false;
    return !this.occupied.has(tileIndex(this.width, x, z));
  }

  /**
   * Place hulls on the nearest navigable water, spiralling out from the
   * authored anchorage. A boat authored on the beach is a validation error, so
   * the kit resolves the water instead of trusting the tile.
   */
  navalForce(
    owner: number,
    defIds: readonly string[],
    cx: number,
    cz: number,
  ): Array<{ defId: string; x: number; z: number }> {
    const placed: Array<{ defId: string; x: number; z: number }> = [];
    for (const defId of defIds) {
      let done = false;
      for (let radius = 0; radius <= 24 && !done; radius++) {
        for (let dz = -radius; dz <= radius && !done; dz++) {
          for (let dx = -radius; dx <= radius && !done; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
            const x = cx + dx;
            const z = cz + dz;
            if (!this.inBounds(x, z)) continue;
            const tile = this.get(x, z)!;
            if (!isNavigable(tile.t)) continue;
            if (this.occupied.has(tileIndex(this.width, x, z))) continue;
            this.unit(defId, owner, x, z);
            placed.push({ defId, x, z });
            done = true;
          }
        }
      }
      if (!done) throw new Error(`No navigable water near ${cx},${cz} for ${defId}`);
    }
    return placed;
  }

  /**
   * Place a starting force around a point, spiralling outward until every unit
   * has a free tile. Returns the tiles used, so a briefing can name them.
   */
  force(
    owner: number,
    defIds: readonly string[],
    cx: number,
    cz: number,
  ): Array<{ defId: string; x: number; z: number }> {
    const placed: Array<{ defId: string; x: number; z: number }> = [];
    for (const defId of defIds) {
      let done = false;
      for (let radius = 0; radius < 12 && !done; radius++) {
        for (let dz = -radius; dz <= radius && !done; dz++) {
          for (let dx = -radius; dx <= radius && !done; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
            const x = cx + dx;
            const z = cz + dz;
            if (!this.free(x, z)) continue;
            this.unit(defId, owner, x, z);
            placed.push({ defId, x, z });
            done = true;
          }
        }
      }
      if (!done) throw new Error(`No free deployment tile near ${cx},${cz} for ${defId}`);
    }
    return placed;
  }

  /** A headquarters base: the buildings every operation's rear area needs. */
  base(
    owner: number,
    cx: number,
    cz: number,
    options: {
      naval?: boolean;
      air?: boolean;
      keyPrefix?: string;
      defences?: boolean;
      footprint?: 'full' | 'lean';
    } = {},
  ): void {
    const prefix = options.keyPrefix ?? (owner === 0 ? 'own' : 'enemy');
    // The pad levels ground but never fills water: a coastal base has to keep
    // its harbour, so only existing land is repainted.
    for (let dz = -11; dz <= 11; dz++) {
      for (let dx = -11; dx <= 11; dx++) {
        if (dx * dx + dz * dz > 121) continue;
        this.setLand(cx + dx, cz + dz, Terrain.Grass, 1);
      }
    }
    this.structure('commandPost', owner, cx, cz, {
      key: `${prefix}-hq`,
      ground: Terrain.Grass,
    });
    this.structure('barracks', owner, cx + 8, cz - 5);
    this.structure('factory', owner, cx + 8, cz + 3);
    this.structure('refinery', owner, cx - 8, cz + 5);
    this.structure('powerPlant', owner, cx - 8, cz - 6);
    if (options.footprint !== 'lean') {
      this.structure('researchCentre', owner, cx - 2, cz - 11);
    }
    if (options.air) this.structure('airfield', owner, cx + 1, cz + 12);
    if (options.defences !== false) {
      this.structure('mgNest', owner, cx + 5, cz - 12);
      this.structure('atTurret', owner, cx - 5, cz + 12);
    }
  }

  /* ------------------------------- build ------------------------------ */

  build(
    meta: TheatreMeta,
    players: readonly [TheatrePlayerSpec, TheatrePlayerSpec],
    options: {
      objectives?: readonly string[];
      settings?: Partial<ScenarioSettings>;
    } = {},
  ): Scenario {
    const scenarioPlayers: ScenarioPlayer[] = players.map((player, index) => ({
      id: index,
      name: player.name,
      factionId: player.factionId,
      team: index,
      isAI: player.isAI ?? index === 1,
      startX: player.start[0],
      startZ: player.start[1],
      ...(player.technologies && player.technologies.length > 0
        ? { technologies: [...player.technologies] }
        : {}),
      ...(player.restrictions ? { restrictions: player.restrictions } : {}),
    }));
    const scenario: Scenario = {
      format: MAP_FORMAT,
      version: MAP_FORMAT_VERSION,
      meta: {
        id: meta.id,
        name: meta.name,
        description: meta.description,
        author: meta.author ?? 'MCA Campaign Team',
        created: meta.created ?? '2026-11-03',
        targetSize: meta.targetSize,
      },
      width: this.width,
      height: this.height,
      tiles: this.tiles,
      players: scenarioPlayers,
      structures: this.structures,
      units: this.units,
      objectives: [...(options.objectives ?? [])],
      settings: { ...defaultSettings(), ...(options.settings ?? {}) },
    };
    // A deposit under a structure can never be mined and would strand a
    // harvester on an unreachable field; clear it before handing the map out.
    clearOreUnderStructures(scenario);
    return scenario;
  }
}

/** True when a campaign theatre can host naval play. */
export function isCoastal(scenario: Scenario): boolean {
  return scenario.tiles.some(
    (tile) => tile.t === Terrain.DeepWater || tile.t === Terrain.ShallowWater,
  );
}
