import { TILE_SIZE } from '../sim/constants';
import { OVERLAYS, Terrain, TERRAIN, overlayIdOf, tileIndex, type TerrainId } from '../sim/terrain';
import type { Scenario } from '../sim/scenario';
import type { RuntimeMap } from '../sim/types';
import { BUILDINGS } from '../data/buildings';
import { MeshBuilder } from './geometry';
import { MATERIAL } from './materials';
import type { MeshBuffers } from './gl';
import { hash01 } from './math';
import type { PropInstance } from './gl';
import { WATER_LEVEL, terrainCornerHeight, terrainSurfaceHeight } from './terrainSurface';

export interface TerrainGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  /** Per-vertex weights for grass/scrub, dry earth, forest floor and stone. */
  grounds: Float32Array;
  indices: Uint32Array;
}

/**
 * Visual ground cover, not simulation terrain. The weights let the terrain
 * shader apply a material treatment to each corner while tile colour and all
 * movement/build rules continue to come from `Terrain`.
 */
function groundCover(t: TerrainId): [number, number, number, number] {
  switch (t) {
    case Terrain.Grass:
      return [1, 0, 0, 0];
    case Terrain.Forest:
      return [0.12, 0.12, 0.76, 0];
    case Terrain.Rock:
      return [0, 0, 0, 1];
    case Terrain.Road:
      // The road is its own draped surface. Letting the terrain underneath
      // carry road cover too left a square, tile-shaped halo around every
      // smoothed edge.
      return [0, 0, 0, 0];
    case Terrain.Urban:
      return [0.05, 0.42, 0, 0.53];
    // Wetland and scrub read as green cover with their own colour on top.
    case Terrain.Scrub:
      return [0.72, 0.18, 0.1, 0];
    case Terrain.Marsh:
      return [0.5, 0.34, 0.08, 0.08];
    case Terrain.Farmland:
      return [0.34, 0.66, 0, 0];
    case Terrain.Mud:
      return [0.04, 0.9, 0, 0.06];
    case Terrain.Rocks:
      return [0, 0, 0, 1];
    case Terrain.DenseUrban:
      return [0.02, 0.3, 0, 0.68];
    case Terrain.Industrial:
      return [0.06, 0.34, 0, 0.6];
    default:
      // Sand, dunes and any future dry ground read as exposed earth.
      return [0.08, 0.92, 0, 0];
  }
}

/**
 * Base colour with its surface layer blended in.
 *
 * The overlay is a tint over the ground, not a replacement: a crop field reads
 * as cultivated earth with rows on it, and the same crops over open ground
 * read as green. Density scales the blend, so light reeds and dense reeds are
 * visibly different without a second terrain id.
 */
function surfaceColor(terrain: TerrainId, overlay: number): [number, number, number] {
  const base = TERRAIN[terrain].color;
  if (overlay <= 0) return base;
  const props = OVERLAYS[overlayIdOf(overlay)];
  if (props.id === 0) return base;
  const density = overlay % 4;
  const amount = Math.min(0.7, props.strength * density * 0.3);
  return [
    base[0] * (1 - amount) + props.tint[0] * amount,
    base[1] * (1 - amount) + props.tint[1] * amount,
    base[2] * (1 - amount) + props.tint[2] * amount,
  ];
}


export function buildTerrainGeometry(scenario: Scenario): TerrainGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const ground: number[] = [];
  const idx: number[] = [];
  const W = scenario.width;
  const H = scenario.height;
  const worldW = W * TILE_SIZE;
  const worldH = H * TILE_SIZE;

  // One height per grid corner, shared by the four tiles that meet there.
  // Averaging the touching tile elevations turns terraces into continuous
  // ramps instead of vertical steps.
  const cornersW = W + 1;
  const corners = new Float32Array(cornersW * (H + 1));
  for (let vz = 0; vz <= H; vz++) {
    for (let vx = 0; vx <= W; vx++) {
      corners[vz * cornersW + vx] = terrainCornerHeight(scenario, vx, vz);
    }
  }
  const cornerAt = (vx: number, vz: number): number =>
    corners[Math.max(0, Math.min(H, vz)) * cornersW + Math.max(0, Math.min(W, vx))];
  const normalAt = (vx: number, vz: number): [number, number, number] => {
    const x0 = Math.max(0, vx - 1);
    const x1 = Math.min(W, vx + 1);
    const z0 = Math.max(0, vz - 1);
    const z1 = Math.min(H, vz + 1);
    const dhdx = (cornerAt(x1, vz) - cornerAt(x0, vz)) / Math.max(TILE_SIZE, (x1 - x0) * TILE_SIZE);
    const dhdz = (cornerAt(vx, z1) - cornerAt(vx, z0)) / Math.max(TILE_SIZE, (z1 - z0) * TILE_SIZE);
    const len = Math.hypot(dhdx, 1, dhdz) || 1;
    return [-dhdx / len, 1 / len, -dhdz / len];
  };

  // One colour per grid corner, averaged over the land tiles that meet there.
  // Sampling the colour per tile instead put a hard seam on every tile edge,
  // which is what made the ground read as a visible grid: neighbouring tiles
  // of the same terrain could still differ by up to 14% brightness. Averaging
  // on the shared corner turns the terrain mix into a continuous gradient.
  const cornerColors = new Float32Array(cornersW * (H + 1) * 3);
  for (let vz = 0; vz <= H; vz++) {
    for (let vx = 0; vx <= W; vx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dz = -1; dz <= 0; dz++) {
        for (let dx = -1; dx <= 0; dx++) {
          const tx = vx + dx;
          const tz = vz + dz;
          if (tx < 0 || tz < 0 || tx >= W || tz >= H) continue;
          const tile = scenario.tiles[tileIndex(W, tx, tz)];
          const terrain = tile.t as TerrainId;
          const def = TERRAIN[terrain];
          // Water quads are not part of this mesh; letting their colour in
          // would smear a dark blue band along every coastline. Roads are
          // excluded for the same reason: their surface is drawn by
          // buildRoadDetails, and sampling the tile colour here put a hard
          // square of asphalt under every rounded road edge.
          if (def.water || terrain === Terrain.Road) continue;
          const [sr, sg, sb] = surfaceColor(terrain, tile.v ?? 0);
          r += sr;
          g += sg;
          b += sb;
          n++;
        }
      }
      if (n === 0) {
        r = 0.1;
        g = 0.2;
        b = 0.22;
        n = 1;
      }
      const tint = 0.95 + hash01(vx, vz, 11) * 0.1;
      const o = (vz * cornersW + vx) * 3;
      cornerColors[o] = (r / n) * tint;
      cornerColors[o + 1] = (g / n) * tint;
      cornerColors[o + 2] = (b / n) * tint;
    }
  }
  const cornerColorAt = (vx: number, vz: number): [number, number, number] => {
    const cx = Math.max(0, Math.min(W, vx));
    const cz = Math.max(0, Math.min(H, vz));
    const o = (cz * cornersW + cx) * 3;
    return [cornerColors[o], cornerColors[o + 1], cornerColors[o + 2]];
  };

  // Material weights are averaged over the same four tiles as the colour, so a
  // material transition follows the ground exactly instead of snapping at tile
  // borders. Water contributes nothing; its quads are not in this mesh.
  const cornerGround = new Float32Array(cornersW * (H + 1) * 4);
  for (let vz = 0; vz <= H; vz++) {
    for (let vx = 0; vx <= W; vx++) {
      let dry = 0;
      let scrub = 0;
      let forest = 0;
      let stone = 0;
      for (let dz = -1; dz <= 0; dz++) {
        for (let dx = -1; dx <= 0; dx++) {
          const tx = vx + dx;
          const tz = vz + dz;
          if (tx < 0 || tz < 0 || tx >= W || tz >= H) continue;
          const terrain = scenario.tiles[tileIndex(W, tx, tz)].t as TerrainId;
          if (TERRAIN[terrain].water || terrain === Terrain.Road) continue;
          const w = groundCover(terrain);
          scrub += w[0];
          dry += w[1];
          forest += w[2];
          stone += w[3];
        }
      }
      const sum = scrub + dry + forest + stone;
      const o = (vz * cornersW + vx) * 4;
      if (sum < 1e-6) {
        // A coastline corner with no land tiles is not drawn, but keep the
        // buffer finite so interpolation never produces a NaN.
        cornerGround[o + 1] = 1;
        continue;
      }
      cornerGround[o] = scrub / sum;
      cornerGround[o + 1] = dry / sum;
      cornerGround[o + 2] = forest / sum;
      cornerGround[o + 3] = stone / sum;
    }
  }
  const cornerGroundAt = (vx: number, vz: number): [number, number, number, number] => {
    const cx = Math.max(0, Math.min(W, vx));
    const cz = Math.max(0, Math.min(H, vz));
    const o = (cz * cornersW + cx) * 4;
    return [cornerGround[o], cornerGround[o + 1], cornerGround[o + 2], cornerGround[o + 3]];
  };
  /** A little extra light for high ground, sampled per corner so it stays smooth. */
  const reliefAt = (vx: number, vz: number): number => 0.985 + cornerAt(vx, vz) * 0.006;

  const addVertex = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    c: number[],
    g: readonly number[],
    u: number,
    v: number,
  ) => {
    pos.push(x, y, z);
    nrm.push(nx, ny, nz);
    col.push(c[0], c[1], c[2]);
    ground.push(g[0], g[1], g[2], g[3]);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };

  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const tile = scenario.tiles[tileIndex(W, x, z)];
      const terrain = tile.t as TerrainId;
      if (TERRAIN[terrain].water) continue;
      const x0 = x * TILE_SIZE;
      const x1 = x0 + TILE_SIZE;
      const z0 = z * TILE_SIZE;
      const z1 = z0 + TILE_SIZE;
      const n00 = normalAt(x, z);
      const n10 = normalAt(x + 1, z);
      const n01 = normalAt(x, z + 1);
      const n11 = normalAt(x + 1, z + 1);
      const c00 = cornerColorAt(x, z);
      const c10 = cornerColorAt(x + 1, z);
      const c01 = cornerColorAt(x, z + 1);
      const c11 = cornerColorAt(x + 1, z + 1);
      const g00 = cornerGroundAt(x, z);
      const g10 = cornerGroundAt(x + 1, z);
      const g01 = cornerGroundAt(x, z + 1);
      const g11 = cornerGroundAt(x + 1, z + 1);
      const r00 = reliefAt(x, z);
      const r10 = reliefAt(x + 1, z);
      const r01 = reliefAt(x, z + 1);
      const r11 = reliefAt(x + 1, z + 1);
      const i0 = addVertex(x0, cornerAt(x, z), z0, n00[0], n00[1], n00[2], [c00[0] * r00, c00[1] * r00, c00[2] * r00], g00, x0 / worldW, z0 / worldH);
      const i1 = addVertex(x0, cornerAt(x, z + 1), z1, n01[0], n01[1], n01[2], [c01[0] * r01, c01[1] * r01, c01[2] * r01], g01, x0 / worldW, z1 / worldH);
      const i2 = addVertex(x1, cornerAt(x + 1, z + 1), z1, n11[0], n11[1], n11[2], [c11[0] * r11, c11[1] * r11, c11[2] * r11], g11, x1 / worldW, z1 / worldH);
      const i3 = addVertex(x1, cornerAt(x + 1, z), z0, n10[0], n10[1], n10[2], [c10[0] * r10, c10[1] * r10, c10[2] * r10], g10, x1 / worldW, z0 / worldH);
      idx.push(i0, i2, i1, i0, i3, i2);
    }
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    colors: new Float32Array(col),
    uvs: new Float32Array(uv),
    grounds: new Float32Array(ground),
    indices: new Uint32Array(idx),
  };
}

/** A centre-line segment of the road network, in world units. */
export interface RoadSegment {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/**
 * Join every pair of road tiles that touch, including diagonally. Roads used to
 * be drawn as dashes on every other tile, so a diagonal run left two squares
 * meeting at a single corner and read as loose slabs on the grid. Connecting
 * the tile centres gives one continuous surface whatever direction the road
 * takes.
 */
export function roadSegments(scenario: Scenario): RoadSegment[] {
  const W = scenario.width;
  const H = scenario.height;
  const isRoad = (x: number, z: number): boolean => {
    if (x < 0 || z < 0 || x >= W || z >= H) return false;
    return scenario.tiles[tileIndex(W, x, z)].t === Terrain.Road;
  };
  // Half of the eight-neighbourhood, so each adjacency is emitted once.
  const dirs: Array<[number, number]> = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ];
  const out: RoadSegment[] = [];
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (!isRoad(x, z)) continue;
      for (const [dx, dz] of dirs) {
        if (!isRoad(x + dx, z + dz)) continue;
        out.push({
          x0: (x + 0.5) * TILE_SIZE,
          z0: (z + 0.5) * TILE_SIZE,
          x1: (x + dx + 0.5) * TILE_SIZE,
          z1: (z + dz + 0.5) * TILE_SIZE,
        });
      }
    }
  }
  return out;
}

/**
 * Asphalt sits above the ground so it wins the depth test without a gap. The
 * terrain mesh is coarse, so a 2 cm lift let its triangles poke through the
 * ribbon edge as a fine sawtooth on slopes; 6 cm clears that while remaining
 * inside the road-conformance budget and invisible at battle zoom.
 */
const ROAD_SURFACE_LIFT = 0.06;
/** Node fillets are a hair higher so overlapping ribbons cannot z-fight. */
const ROAD_PATCH_LIFT = 0.062;
/** Graded shoulder outside the carriageway, low enough that asphalt always wins. */
const ROAD_VERGE_LIFT = 0.045;
const ROAD_VERGE_PATCH_LIFT = 0.047;
/** Carriageway half-width. The old one-tile quad was 4.0 units wide. */
const ROAD_HALF_WIDTH = TILE_SIZE * 0.49;
/** A narrow, lightly darker gravel lip, not a second road-coloured band. */
const ROAD_SHOULDER_HALF = ROAD_HALF_WIDTH + TILE_SIZE * 0.10;
/** Wheel wear sits 1 mm over the asphalt so it can never share its plane. */
const ROAD_WEAR_LIFT = ROAD_SURFACE_LIFT + 0.001;
const ROAD_DRAIN_LIFT = ROAD_SURFACE_LIFT + 0.0012;
const ROAD_MARK_LIFT = ROAD_SURFACE_LIFT + 0.0018;

/**
 * A smooth, deterministic edge variation. The old road had a mathematically
 * perfect ribbon width, which is what made every straight run read as a long
 * ruler line at battle zoom. Two low frequencies roughen the verge without
 * making a noisy saw edge; the same world position always gets the same wart.
 */
function edgeTaper(x: number, z: number): number {
  return 1 + 0.042 * Math.sin(x * 0.47 + z * 0.23) + 0.021 * Math.sin(x * 1.31 - z * 0.77 + 1.4);
}

/**
 * The road surface.
 *
 * Roads used to be one raised quad per road tile. That copied the tile grid
 * exactly: a diagonal run became a staircase and every corner was a right
 * angle, which is what made the network read as painted squares. The visual
 * surface is now a continuous centre-line network: a draped ribbon between
 * every pair of touching road tiles, with a round fillet at ends, corners and
 * junctions. The simulation still uses the original road tiles for movement,
 * building placement and ore rules; only the presentation is smoothed.
 *
 * A narrow, slightly darker shoulder is built from the same centre lines.
 * Because it is drawn below the carriageway, it only appears at the outer
 * edge, giving the asphalt a graded transition into grass instead of a hard
 * tile cut.
 */
export function buildRoadDetails(scenario: Scenario): MeshBuffers {
  const b = new MeshBuilder();
  // Every road face is asphalt, including the graded shoulder: the shader
  // varies the tone, but the material family must not be inferred from greys.
  b.material = MATERIAL.asphalt;
  const W = scenario.width;
  const H = scenario.height;
  const worldW = W * TILE_SIZE;
  const worldH = H * TILE_SIZE;
  const isRoad = (x: number, z: number): boolean => {
    if (x < 0 || z < 0 || x >= W || z >= H) return false;
    return scenario.tiles[tileIndex(W, x, z)].t === Terrain.Road;
  };

  const asphalt: [number, number, number] = [0.38, 0.365, 0.335];
  const verge: [number, number, number] = [0.335, 0.32, 0.29];
  // Clamp edge fillets to the map before sampling: a corner at the last tile
  // would otherwise extend past the terrain and fall to height zero.
  const height = (x: number, z: number, lift: number): number => {
    const cx = Math.max(0, Math.min(worldW - 1e-4, x));
    const cz = Math.max(0, Math.min(worldH - 1e-4, z));
    return (isWaterAt(scenario, cx, cz) ? WATER_LEVEL : terrainSurfaceHeight(scenario, cx, cz)) + lift;
  };

  /**
   * A ribbon of `half` width either side of the line a→b, draped on the ground.
   * `offset` shifts the whole strip sideways (wheel wear, drainage seams);
   * `taper` widens and narrows it with the world-space edge noise.
   */
  const ribbon = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    half: number,
    lift: number,
    color: [number, number, number],
    offset = 0,
    taper = 0,
    stepsOverride = 0,
  ): void => {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    // Perpendicular to the run; winding keeps the normal pointing up.
    const ux = -dz / len;
    const uz = dx / len;
    const point = (x: number, z: number, side: number): [number, number, number] => {
      const signed = offset + side * half * (1 + taper * (edgeTaper(x, z) - 1));
      const px = x + ux * signed;
      const pz = z + uz * signed;
      return [px, height(px, pz, lift), pz];
    };
    const steps = stepsOverride > 0 ? stepsOverride : Math.max(1, Math.ceil(len / (TILE_SIZE * 0.5)));
    let prevX = ax;
    let prevZ = az;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const curX = ax + dx * t;
      const curZ = az + dz * t;
      b.addQuad(
        point(prevX, prevZ, 1),
        point(curX, curZ, 1),
        point(curX, curZ, -1),
        point(prevX, prevZ, -1),
        color,
      );
      prevX = curX;
      prevZ = curZ;
    }
  };

  /** A draped round fillet or road end, with the normal facing up. */
  const disc = (
    cx: number,
    cz: number,
    radius: number,
    lift: number,
    color: [number, number, number],
  ): void => {
    const segments = 12;
    const centerY = height(cx, cz, lift);
    const ring: Array<[number, number, number]> = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      ring.push([x, height(x, z, lift), z]);
    }
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      b.addTriangle([cx, centerY, cz], ring[j], ring[i], color);
    }
  };

  interface RoadNode {
    x: number;
    z: number;
    dirs: Array<[number, number]>;
  }
  const nodes = new Map<string, RoadNode>();
  const key = (x: number, z: number): string => `${x},${z}`;
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (!isRoad(x, z)) continue;
      nodes.set(key(x, z), {
        x: (x + 0.5) * TILE_SIZE,
        z: (z + 0.5) * TILE_SIZE,
        dirs: [],
      });
    }
  }

  const segments = roadSegments(scenario);
  // Wheel wear and drainage seams are deliberately darker than asphalt. Their
  // vertex colours are the whole decal: no extra mesh, texture or draw call.
  const wheelWear: [number, number, number] = [0.315, 0.305, 0.285];
  const drainSeam: [number, number, number] = [0.255, 0.248, 0.23];
  const lanePaint: [number, number, number] = [0.52, 0.49, 0.4];
  segments.forEach((s, index) => {
    const ax = Math.floor(s.x0 / TILE_SIZE);
    const az = Math.floor(s.z0 / TILE_SIZE);
    const bx = Math.floor(s.x1 / TILE_SIZE);
    const bz = Math.floor(s.z1 / TILE_SIZE);
    const a = nodes.get(key(ax, az));
    const c = nodes.get(key(bx, bz));
    if (!a || !c) return;
    const dx = s.x1 - s.x0;
    const dz = s.z1 - s.z0;
    const len = Math.hypot(dx, dz) || 1;
    a.dirs.push([dx / len, dz / len]);
    c.dirs.push([-dx / len, -dz / len]);
    // A sub-millimetre stagger between crossing ribbons prevents coplanar
    // surfaces fighting inside wide junctions without creating a visible lip.
    const stagger = (index % 4) * 0.0005;
    // The carriageway edge is allowed to wander by a few centimetres. This is
    // what stops a long straight run reading as a perfect ruler, while the
    // shoulder keeps its full width underneath.
    ribbon(s.x0, s.z0, s.x1, s.z1, ROAD_HALF_WIDTH, ROAD_SURFACE_LIFT + stagger, asphalt, 0, 1);
    ribbon(s.x0, s.z0, s.x1, s.z1, ROAD_SHOULDER_HALF, ROAD_VERGE_LIFT + stagger * 0.6, verge, 0, 0.7);
    // Two worn wheel paths, set in from the lane centre. They follow every
    // segment including diagonals, so the surface finally has a direction cue
    // other than the network's tile geometry. Flat street grids need one quad
    // per path; a sloped segment keeps the same subdivision as the carriageway
    // so the wear cannot cut through the asphalt at a crest.
    const flat = Math.abs(height(s.x0, s.z0, 0) - height(s.x1, s.z1, 0)) < 0.02;
    for (const side of [-1, 1]) {
      ribbon(
        s.x0,
        s.z0,
        s.x1,
        s.z1,
        TILE_SIZE * 0.045,
        ROAD_WEAR_LIFT + stagger,
        wheelWear,
        side * TILE_SIZE * 0.235,
        0.3,
        flat ? 1 : 0,
      );
    }
  });

  /** A node with exactly two collinear connections is a plain straight run. */
  const isThrough = (node: RoadNode): boolean => {
    if (node.dirs.length !== 2) return false;
    return node.dirs[0][0] * node.dirs[1][0] + node.dirs[0][1] * node.dirs[1][1] < -0.98;
  };

  // Lane paint and the drainage seam are only laid on through segments. At a
  // junction they would cross each other and paint an X through the turning
  // space; stopping them at the stop line is also how a real road reads.
  segments.forEach((s, index) => {
    const ax = Math.floor(s.x0 / TILE_SIZE);
    const az = Math.floor(s.z0 / TILE_SIZE);
    const bx = Math.floor(s.x1 / TILE_SIZE);
    const bz = Math.floor(s.z1 / TILE_SIZE);
    const a = nodes.get(key(ax, az));
    const c = nodes.get(key(bx, bz));
    if (!a || !c || !isThrough(a) || !isThrough(c)) return;
    const dx = s.x1 - s.x0;
    const dz = s.z1 - s.z0;
    const len = Math.hypot(dx, dz);
    if (len < TILE_SIZE * 0.9) return;
    const stagger = (index % 4) * 0.0005;
    const ux = dx / len;
    const uz = dz / len;
    // A short drainage seam just inside each carriageway edge. At battle zoom
    // it reads as a kerb shadow, not as another lane.
    for (const side of [-1, 1]) {
      ribbon(
        s.x0,
        s.z0,
        s.x1,
        s.z1,
        TILE_SIZE * 0.035,
        ROAD_DRAIN_LIFT + stagger,
        drainSeam,
        side * (ROAD_HALF_WIDTH - TILE_SIZE * 0.055),
        0,
      );
    }
    // Broken centre line, phased off the world position so adjacent segments
    // form a continuous pattern instead of restarting at every tile.
    const dash = TILE_SIZE * 0.38;
    const gap = TILE_SIZE * 0.42;
    const phase = ((s.x0 * 0.37 + s.z0 * 0.61) % (dash + gap) + dash + gap) % (dash + gap);
    for (let d = phase; d + dash <= len; d += dash + gap) {
      const x0 = s.x0 + ux * d;
      const z0 = s.z0 + uz * d;
      const x1 = s.x0 + ux * (d + dash);
      const z1 = s.z0 + uz * (d + dash);
      ribbon(x0, z0, x1, z1, TILE_SIZE * 0.028, ROAD_MARK_LIFT + stagger, lanePaint);
    }
  });

  for (const node of nodes.values()) {
    // A straight-through node is already fully covered by the two ribbons that
    // meet there. Ends, corners and junctions need a fillet to close the notch
    // between ribbon ends and to round the outside of the turn.
    let patch = node.dirs.length !== 2;
    if (node.dirs.length === 2) {
      const dot = node.dirs[0][0] * node.dirs[1][0] + node.dirs[0][1] * node.dirs[1][1];
      patch = dot > -0.98;
    }
    if (!patch) continue;
    disc(node.x, node.z, ROAD_HALF_WIDTH + 0.03, ROAD_PATCH_LIFT, asphalt);
    disc(node.x, node.z, ROAD_SHOULDER_HALF + 0.03, ROAD_VERGE_PATCH_LIFT, verge);
    // Junction wear comes from the wheel paths crossing the fillet, not from a
    // dark disc: a circle at every corner read as a manhole cover, not asphalt.
  }

  return b.build();
}

/**
 * Coastal field shared by the terrain and water shaders.
 *
 * A single "is this water" mask made the beach and surf bands stop exactly at
 * the tile boundary: there was no way to know how far a land vertex was from
 * the sea, so wet sand could not fade inland. The RGBA texture carries three
 * independent reads:
 *
 *   R  legacy water shallowness (shallow 220, deep 15, land 0)
 *   G  land proximity to water, 1 on the first land tile, 0 six tiles inland
 *   B  water proximity to land, 1 on the first water tile, 0 seven tiles out
 *
 * Distances are a four-neighbour tile flood, so the result is deterministic and
 * costs one pass over the map at scenario load. The visible transition is still
 * shaded procedurally; this is a field, not a painted texture.
 */
export function buildShoreTexture(scenario: Scenario): Uint8Array {
  const W = scenario.width;
  const H = scenario.height;
  const count = W * H;
  const data = new Uint8Array(count * 4);
  const landDist = new Uint16Array(count);
  const waterDist = new Uint16Array(count);
  const queue = new Int32Array(count);
  const UNREACHED = 0xffff;

  const flood = (dist: Uint16Array, sourceIsWater: boolean): void => {
    dist.fill(UNREACHED);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < count; i++) {
      if (TERRAIN[scenario.tiles[i].t as TerrainId].water === sourceIsWater) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      const z = (i / W) | 0;
      const next = dist[i] + 1;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const ni = nz * W + nx;
        if (dist[ni] === UNREACHED) {
          dist[ni] = next;
          queue[tail++] = ni;
        }
      }
    }
  };

  // Land distance is measured from the sea; water distance from the shore.
  flood(landDist, true);
  flood(waterDist, false);

  const band = (distance: number, span: number): number => {
    if (distance === UNREACHED) return 0;
    return Math.round(Math.max(0, Math.min(1, 1 - (distance - 1) / span)) * 255);
  };
  for (let i = 0; i < count; i++) {
    const t = scenario.tiles[i].t as TerrainId;
    const water = TERRAIN[t].water;
    const o = i * 4;
    data[o + 3] = 255;
    if (water) {
      data[o] = t === Terrain.ShallowWater ? 220 : 15;
      // The surf belongs to the first tile or two, not to half the sea. A wide
      // water-distance band produced broad pale stripes parallel to the coast.
      data[o + 2] = band(waterDist[i], 1.25);
    } else {
      data[o + 1] = band(landDist[i], 3.2);
    }
  }
  return data;
}

export function buildPropInstances(
  scenario: Scenario,
  ore?: Uint16Array,
  maxOre?: Uint16Array,
): {
  trees: PropInstance[];
  rocks: PropInstance[];
  ore: PropInstance[];
  bushes: PropInstance[];
  shrubs: PropInstance[];
  tufts: PropInstance[];
  fences: PropInstance[];
  lamps: PropInstance[];
  signs: PropInstance[];
  rubble: PropInstance[];
  reeds: PropInstance[];
  poles: PropInstance[];
} {
  const trees: PropInstance[] = [];
  const rocks: PropInstance[] = [];
  const oreInstances: PropInstance[] = [];
  const bushes: PropInstance[] = [];
  const shrubs: PropInstance[] = [];
  const tufts: PropInstance[] = [];
  const fences: PropInstance[] = [];
  const rubble: PropInstance[] = [];
  const reeds: PropInstance[] = [];
  const poles: PropInstance[] = [];
  const lamps: PropInstance[] = [];
  const signs: PropInstance[] = [];
  const W = scenario.width;
  const H = scenario.height;
  // Coastal riprap is part of the existing instanced rock pass, not a new draw
  // path. Keep it out of authored footprints so a breakwater never grows
  // through a command post or a supply depot.
  const blocked = new Uint8Array(W * H);
  for (const structure of scenario.structures) {
    const def = BUILDINGS[structure.defId];
    if (!def) continue;
    for (let dz = 0; dz < def.footprint.h; dz++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        const tx = structure.x + dx;
        const tz = structure.z + dz;
        if (tx >= 0 && tz >= 0 && tx < W && tz < H) blocked[tz * W + tx] = 1;
      }
    }
  }
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = tileIndex(W, x, z);
      const tile = scenario.tiles[i];
      if (tile.t === Terrain.Forest) {
        const count = hash01(x, z, 3) > 0.35 ? 2 : 1;
        for (let k = 0; k < count; k++) {
          const ox = (hash01(x, z, k + 7) - 0.5) * 3.2;
          const oz = (hash01(x, z, k + 19) - 0.5) * 3.2;
          const wx = (x + 0.5) * TILE_SIZE + ox;
          const wz = (z + 0.5) * TILE_SIZE + oz;
          const scale = 0.65 + hash01(x, z, k + 31) * 0.55;
          const tint = 0.82 + hash01(x, z, k + 41) * 0.28;
          trees.push({
            x: wx,
            y: terrainSurfaceHeight(scenario, wx, wz),
            z: wz,
            rotation: hash01(x, z, k + 53) * Math.PI * 2,
            scale,
            color: [tint * 0.92, tint, tint * 0.88],
          });
        }
      } else if (tile.t === Terrain.Rock && hash01(x, z, 5) > 0.6) {
        const wx = (x + 0.5) * TILE_SIZE + (hash01(x, z, 9) - 0.5) * 2;
        const wz = (z + 0.5) * TILE_SIZE + (hash01(x, z, 10) - 0.5) * 2;
        rocks.push({
          x: wx,
          y: terrainSurfaceHeight(scenario, wx, wz),
          z: wz,
          rotation: hash01(x, z, 11) * Math.PI * 2,
          scale: 0.55 + hash01(x, z, 12) * 0.8,
          color: [0.9 + hash01(x, z, 13) * 0.16, 0.88, 0.85],
        });
      } else if (
        !TERRAIN[tile.t as TerrainId].water &&
        !blocked[i] &&
        tile.t !== Terrain.Road &&
        tile.t !== Terrain.Urban
      ) {
        // A sparse breakwater / riprap line on ordinary coast. Only every third
        // eligible tile is used, and the stone is nudged toward the water so a
        // few pieces sit half in the surf. This is visual cover, not a
        // simulation obstacle: props remain non-blocking, as before.
        let seaX = 0;
        let seaZ = 0;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          if (TERRAIN[scenario.tiles[nz * W + nx].t as TerrainId].water) {
            seaX = dx;
            seaZ = dz;
            break;
          }
        }
        if ((seaX !== 0 || seaZ !== 0) && hash01(x, z, 71) > 0.58) {
          const push = 0.36 + hash01(x, z, 73) * 0.1;
          const wx = (x + 0.5 + seaX * push) * TILE_SIZE;
          const wz = (z + 0.5 + seaZ * push) * TILE_SIZE;
          rocks.push({
            x: wx,
            y: terrainSurfaceHeight(scenario, wx, wz) + 0.005,
            z: wz,
            rotation: hash01(x, z, 75) * Math.PI * 2,
            scale: 0.4 + hash01(x, z, 77) * 0.42,
            color: [0.8 + hash01(x, z, 79) * 0.1, 0.84, 0.85],
          });
        }
      }
      // Ground cover is placed by landscape, not by tile count. Five-tile
      // cells decide where the brushland is; field edges next to timber, rock,
      // water or a road always carry cover, because that is where scrub grows.
      // Open fields are left open on purpose, with only grass tufts and the odd
      // straggler. A flat per-tile chance was what made the old scatter read as
      // random dots across every lawn.
      if ((tile.t === Terrain.Grass || tile.t === Terrain.Sand) && !blocked[i] && tile.o === 0) {
        const grass = tile.t === Terrain.Grass;
        let edge = false;
        for (let dz = -1; dz <= 1 && !edge; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
            const near = scenario.tiles[nz * W + nx].t as TerrainId;
            if (
              TERRAIN[near].water ||
              near === Terrain.Forest ||
              near === Terrain.Rock ||
              near === Terrain.Urban ||
              near === Terrain.Road
            ) {
              edge = true;
              break;
            }
          }
        }
        const patch = hash01(Math.floor(x / 5), Math.floor(z / 5), 96);
        const brushland = grass && (patch > 0.6 || (edge && patch > 0.24));
        const roll = hash01(x, z, 101);
        const plant = (kind: 'bush' | 'shrub' | 'tuft', salt: number) => {
          const wx = (x + 0.5) * TILE_SIZE + (hash01(x, z, salt) - 0.5) * 2.9;
          const wz = (z + 0.5) * TILE_SIZE + (hash01(x, z, salt + 1) - 0.5) * 2.9;
          const tint = 0.82 + hash01(x, z, salt + 2) * 0.34;
          const dry = !grass;
          // Three green families rather than one flat tint: a cool hedge green,
          // a yellow field green and a deeper blue-green. Brush growing in
          // company then mixes tones instead of stamping the same dot across a
          // field, which is what made the old scatter read as dark specks.
          const variant = hash01(x, z, salt + 5);
          const green: [number, number, number] =
            variant < 0.34
              ? [0.80, 1.0, 0.76]
              : variant < 0.68
                ? [1.04, 1.0, 0.72]
                : [0.74, 0.94, 0.86];
          const instance: PropInstance = {
            x: wx,
            y: terrainSurfaceHeight(scenario, wx, wz),
            z: wz,
            rotation: hash01(x, z, salt + 3) * Math.PI * 2,
            scale: kind === 'tuft' ? 0.7 + hash01(x, z, salt + 4) * 0.7 : 0.55 + hash01(x, z, salt + 4) * 0.9,
            color: dry
              ? [tint * 0.98, tint * 0.9, tint * 0.68]
              : [tint * green[0], tint * green[1], tint * green[2]],
          };
          if (kind === 'bush') bushes.push(instance);
          else if (kind === 'shrub') shrubs.push(instance);
          else tufts.push(instance);
        };
        if (brushland) {
          if (roll < 0.34) plant('bush', 105);
          else if (roll < 0.5) plant('shrub', 109);
          else if (roll < 0.62) plant('tuft', 113);
          // Brush grows in company: a second, smaller plant beside the first.
          if (roll < 0.5 && hash01(x, z, 127) > 0.55) plant('bush', 131);
        } else if (grass) {
          if (roll < 0.09) plant('tuft', 137);
          else if (roll < 0.11) plant('bush', 139);
        } else if (roll < 0.14) {
          plant('tuft', 141);
        }
      }

      // Field fencing runs parallel to the carriageway, so open grass next to a
      // road gets a boundary line. The local fence mesh runs along X, which is
      // why a north/south road needs the quarter-turn.
      if (tile.t === Terrain.Grass && !blocked[i] && tile.o === 0) {
        let roadX = 0;
        let roadZ = 0;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          if (scenario.tiles[nz * W + nx].t === Terrain.Road) {
            roadX = dx;
            roadZ = dz;
            break;
          }
        }
        if ((roadX !== 0 || roadZ !== 0) && hash01(x, z, 121) > 0.6) {
          const wx = (x + 0.5 + roadX * 0.34) * TILE_SIZE;
          const wz = (z + 0.5 + roadZ * 0.34) * TILE_SIZE;
          fences.push({
            x: wx,
            y: terrainSurfaceHeight(scenario, wx, wz),
            z: wz,
            rotation: roadX !== 0 ? Math.PI / 2 : 0,
            scale: 0.92 + hash01(x, z, 123) * 0.2,
            color: [0.92 + hash01(x, z, 125) * 0.14, 0.94, 0.96],
          });
        }
      }

      // Street lamps stand at the kerb and lean over the carriageway. One road
      // tile in about eight gets one, aimed at the nearest land beside it.
      if (tile.t === Terrain.Road && hash01(x, z, 131) > 0.875) {
        let kerbX = 0;
        let kerbZ = 0;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          const neighbour = scenario.tiles[nz * W + nx];
          if (TERRAIN[neighbour.t as TerrainId].water || neighbour.t === Terrain.Road) continue;
          kerbX = dx;
          kerbZ = dz;
          break;
        }
        if (kerbX !== 0 || kerbZ !== 0) {
          const wx = (x + 0.5 + kerbX * 0.4) * TILE_SIZE;
          const wz = (z + 0.5 + kerbZ * 0.4) * TILE_SIZE;
          lamps.push({
            x: wx,
            y: terrainSurfaceHeight(scenario, wx, wz),
            z: wz,
            rotation: Math.atan2(-kerbZ, -kerbX),
            scale: 1,
            color: [1, 1, 1],
          });
        }
      }

      // Roadside direction signs. They stand on the verge with their blades
      // turned at the carriageway, so a road reads as a road with places on it
      // rather than a strip of asphalt through empty ground. Sparse on purpose:
      // one landmark every few dozen tiles, not a picket line of them.
      if (
        !blocked[i] &&
        tile.o === 0 &&
        !TERRAIN[tile.t as TerrainId].water &&
        tile.t !== Terrain.Road &&
        tile.t !== Terrain.Forest &&
        tile.t !== Terrain.Rock &&
        tile.t !== Terrain.Rocks
      ) {
        let toRoadX = 0;
        let toRoadZ = 0;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          if (scenario.tiles[nz * W + nx].t === Terrain.Road) {
            toRoadX = dx;
            toRoadZ = dz;
            break;
          }
        }
        if ((toRoadX !== 0 || toRoadZ !== 0) && hash01(x, z, 149) > 0.9) {
          const wx = (x + 0.5 + toRoadX * 0.3) * TILE_SIZE;
          const wz = (z + 0.5 + toRoadZ * 0.3) * TILE_SIZE;
          signs.push({
            x: wx,
            y: terrainSurfaceHeight(scenario, wx, wz),
            z: wz,
            // Local +X points at the carriageway, so the blades face the traffic.
            rotation: Math.atan2(toRoadZ, toRoadX),
            scale: 0.95 + hash01(x, z, 151) * 0.18,
            color: [1, 1, 1],
          });
        }
      }

      // Collapsed masonry in the built-up districts. A street of clean tiles
      // reads as a diagram; a street with a heap of slabs in it reads as a place
      // that has been fought over.
      if (
        !blocked[i] &&
        (tile.t === Terrain.Urban ||
          tile.t === Terrain.DenseUrban ||
          tile.t === Terrain.Industrial) &&
        hash01(x, z, 163) > 0.82
      ) {
        const wx = (x + 0.5) * TILE_SIZE + (hash01(x, z, 165) - 0.5) * 2.4;
        const wz = (z + 0.5) * TILE_SIZE + (hash01(x, z, 167) - 0.5) * 2.4;
        rubble.push({
          x: wx,
          y: terrainSurfaceHeight(scenario, wx, wz),
          z: wz,
          rotation: hash01(x, z, 169) * Math.PI * 2,
          scale: 0.8 + hash01(x, z, 171) * 0.55,
          color: [0.94 + hash01(x, z, 173) * 0.12, 0.94, 0.92],
        });
      }

      // Reeds stand in the water at the bank and in the marsh itself. They are
      // the only prop placed on a water tile, so they are also the thing that
      // tells a shallow shelf apart from open sea at a glance.
      const waterTile = TERRAIN[tile.t as TerrainId].water;
      if (
        !blocked[i] &&
        (tile.t === Terrain.Marsh ||
          (waterTile && tile.t === Terrain.ShallowWater && hash01(x, z, 177) > 0.52))
      ) {
        let toLand = false;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          if (!TERRAIN[scenario.tiles[nz * W + nx].t as TerrainId].water) toLand = true;
        }
        if (toLand) {
          const wx = (x + 0.5) * TILE_SIZE + (hash01(x, z, 179) - 0.5) * 2.6;
          const wz = (z + 0.5) * TILE_SIZE + (hash01(x, z, 181) - 0.5) * 2.6;
          // Water tiles report no land height, so the clump stands on the
          // surface plane instead of on a sea bed nobody can see.
          const y = waterTile ? 0.14 : terrainSurfaceHeight(scenario, wx, wz);
          reeds.push({
            x: wx,
            y,
            z: wz,
            rotation: hash01(x, z, 183) * Math.PI * 2,
            scale: 0.85 + hash01(x, z, 185) * 0.5,
            color: [0.95 + hash01(x, z, 187) * 0.12, 0.98, 0.9],
          });
        }
      }

      // Telegraph poles along the carriageway, rarer and taller than the lamps.
      // The arm turns across the road, so consecutive poles read as one line.
      if (tile.t === Terrain.Road && hash01(x, z, 191) > 0.955) {
        let vergeX = 0;
        let vergeZ = 0;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
          const neighbour = scenario.tiles[nz * W + nx];
          if (TERRAIN[neighbour.t as TerrainId].water || neighbour.t === Terrain.Road) continue;
          vergeX = dx;
          vergeZ = dz;
          break;
        }
        if (vergeX !== 0 || vergeZ !== 0) {
          const wx = (x + 0.5 + vergeX * 0.44) * TILE_SIZE;
          const wz = (z + 0.5 + vergeZ * 0.44) * TILE_SIZE;
          poles.push({
            x: wx,
            y: terrainSurfaceHeight(scenario, wx, wz),
            z: wz,
            rotation: Math.atan2(vergeZ, vergeX),
            scale: 0.94 + hash01(x, z, 193) * 0.14,
            color: [1, 1, 1],
          });
        }
      }

      const amount = ore ? ore[i] : tile.o;
      if (amount > 0) {
        const max = maxOre ? maxOre[i] : tile.o || 1;
        const ratio = Math.max(0.25, Math.min(1, amount / Math.max(1, max)));
        const wx = (x + 0.5) * TILE_SIZE + (hash01(x, z, 21) - 0.5) * 1.8;
        const wz = (z + 0.5) * TILE_SIZE + (hash01(x, z, 22) - 0.5) * 1.8;
        oreInstances.push({
          x: wx,
          y: terrainSurfaceHeight(scenario, wx, wz) + 0.02,
          z: wz,
          rotation: hash01(x, z, 23) * Math.PI * 2,
          scale: 0.45 + ratio * 0.75,
          color: [1, 0.94 + ratio * 0.06, 0.82],
        });
      }
    }
  }
  return {
    trees,
    rocks,
    ore: oreInstances,
    bushes,
    shrubs,
    tufts,
    fences,
    lamps,
    signs,
    rubble,
    reeds,
    poles,
  };
}

export function runtimeOreInstances(scenario: Scenario, map: RuntimeMap): PropInstance[] {
  return buildPropInstances(scenario, map.ore, map.maxOre).ore;
}

/** Sloped land height used by props, entities and effects; water returns 0. */
export function tileWorldHeight(scenario: Scenario, x: number, z: number): number {
  return terrainSurfaceHeight(scenario, x, z);
}

export function isWaterAt(scenario: Scenario, x: number, z: number): boolean {
  const tx = Math.floor(x / TILE_SIZE);
  const tz = Math.floor(z / TILE_SIZE);
  if (tx < 0 || tz < 0 || tx >= scenario.width || tz >= scenario.height) return false;
  return TERRAIN[scenario.tiles[tileIndex(scenario.width, tx, tz)].t as TerrainId].water;
}
