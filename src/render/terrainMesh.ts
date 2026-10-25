import { TILE_SIZE } from '../sim/constants';
import { Terrain, TERRAIN, tileIndex, type TerrainId } from '../sim/terrain';
import type { Scenario } from '../sim/scenario';
import type { RuntimeMap } from '../sim/types';
import { MeshBuilder, PALETTE } from './geometry';
import type { MeshBuffers } from './gl';
import { hash01 } from './math';
import type { PropInstance } from './gl';
import { terrainCornerHeight, terrainSurfaceHeight } from './terrainSurface';

export interface TerrainGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export function buildTerrainGeometry(scenario: Scenario): TerrainGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
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

  const baseColor = (terrain: TerrainId, x: number, z: number, elevation: number): [number, number, number] => {
    const t = TERRAIN[terrain];
    const n = hash01(x, z, 11);
    const light = 0.92 + n * 0.14 + elevation * 0.012;
    return [t.color[0] * light, t.color[1] * light, t.color[2] * light];
  };

  const addVertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: number[], u: number, v: number) => {
    pos.push(x, y, z);
    nrm.push(nx, ny, nz);
    col.push(c[0], c[1], c[2]);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };

  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const tile = scenario.tiles[tileIndex(W, x, z)];
      const terrain = tile.t as TerrainId;
      if (TERRAIN[terrain].water) continue;
      const c = baseColor(terrain, x, z, tile.e);
      const x0 = x * TILE_SIZE;
      const x1 = x0 + TILE_SIZE;
      const z0 = z * TILE_SIZE;
      const z1 = z0 + TILE_SIZE;
      const n00 = normalAt(x, z);
      const n10 = normalAt(x + 1, z);
      const n01 = normalAt(x, z + 1);
      const n11 = normalAt(x + 1, z + 1);
      const i0 = addVertex(x0, cornerAt(x, z), z0, n00[0], n00[1], n00[2], c, x0 / worldW, z0 / worldH);
      const i1 = addVertex(x0, cornerAt(x, z + 1), z1, n01[0], n01[1], n01[2], c, x0 / worldW, z1 / worldH);
      const i2 = addVertex(x1, cornerAt(x + 1, z + 1), z1, n11[0], n11[1], n11[2], c, x1 / worldW, z1 / worldH);
      const i3 = addVertex(x1, cornerAt(x + 1, z), z0, n10[0], n10[1], n10[2], c, x1 / worldW, z0 / worldH);
      idx.push(i0, i2, i1, i0, i3, i2);
    }
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    colors: new Float32Array(col),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  };
}

export function buildRoadDetails(scenario: Scenario): MeshBuffers {
  const b = new MeshBuilder();
  const W = scenario.width;
  const H = scenario.height;
  const isRoad = (x: number, z: number): boolean => {
    if (x < 0 || z < 0 || x >= W || z >= H) return false;
    return scenario.tiles[tileIndex(W, x, z)].t === Terrain.Road;
  };
  for (let z = 1; z < H - 1; z++) {
    for (let x = 1; x < W - 1; x++) {
      if (!isRoad(x, z)) continue;
      if ((x + z) % 2 !== 0) continue;
      const cx = (x + 0.5) * TILE_SIZE;
      const cz = (z + 0.5) * TILE_SIZE;
      const surface = (wx: number, wz: number): number => terrainSurfaceHeight(scenario, wx, wz) + 0.035;
      const c: [number, number, number] = [0.56, 0.52, 0.4];
      if (isRoad(x + 1, z) || isRoad(x - 1, z)) {
        b.addQuad(
          [cx - 1.1, surface(cx - 1.1, cz - 0.09), cz - 0.09],
          [cx + 1.1, surface(cx + 1.1, cz - 0.09), cz - 0.09],
          [cx + 1.1, surface(cx + 1.1, cz + 0.09), cz + 0.09],
          [cx - 1.1, surface(cx - 1.1, cz + 0.09), cz + 0.09],
          c,
        );
      } else if (isRoad(x, z + 1) || isRoad(x, z - 1)) {
        b.addQuad(
          [cx - 0.09, surface(cx - 0.09, cz - 1.1), cz - 1.1],
          [cx - 0.09, surface(cx - 0.09, cz + 1.1), cz + 1.1],
          [cx + 0.09, surface(cx + 0.09, cz + 1.1), cz + 1.1],
          [cx + 0.09, surface(cx + 0.09, cz - 1.1), cz - 1.1],
          c,
        );
      }
    }
  }
  // Shoulder lines around the central pass.
  void PALETTE;
  return b.build();
}

export function buildShoreTexture(scenario: Scenario): Uint8Array {
  const data = new Uint8Array(scenario.width * scenario.height);
  for (let i = 0; i < data.length; i++) {
    const t = scenario.tiles[i].t;
    data[i] = t === Terrain.ShallowWater ? 220 : t === Terrain.DeepWater ? 15 : 0;
  }
  return data;
}

export function buildPropInstances(
  scenario: Scenario,
  ore?: Uint16Array,
  maxOre?: Uint16Array,
): { trees: PropInstance[]; rocks: PropInstance[]; ore: PropInstance[] } {
  const trees: PropInstance[] = [];
  const rocks: PropInstance[] = [];
  const oreInstances: PropInstance[] = [];
  const W = scenario.width;
  const H = scenario.height;
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
  return { trees, rocks, ore: oreInstances };
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
