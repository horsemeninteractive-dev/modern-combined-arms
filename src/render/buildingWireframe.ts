import { buildingStyle } from './buildingMeshes';

/**
 * Feature edges of a building's main body, in building-local space, as
 * `[ax, ay, az, bx, by, bz, ...]` pairs.
 *
 * The placement preview and the under-construction outline must show the
 * building's actual silhouette, not a generic box. Drawing every triangle edge
 * would fill the shape with triangulation diagonals, so an edge survives only
 * when it borders two faces that meet at a real crease (or is a mesh boundary).
 * The result is the line drawing of the model: walls, roof steps, bays and
 * bevels. Results are cached per definition because the geometry never changes.
 */
const cache = new Map<string, Float32Array>();

const CREASE_DOT = 0.9;

export function buildingWireframe(defId: string): Float32Array {
  const cached = cache.get(defId);
  if (cached) return cached;
  const body = buildingStyle(defId)?.body;
  if (!body) {
    const empty = new Float32Array(0);
    cache.set(defId, empty);
    return empty;
  }
  const position = body.positions;
  const index = body.indices;
  const vertexCount = position.length / 3;
  // Vertices are duplicated per flat-shaded face. Merge them by position so the
  // two faces meeting at a corner find each other in the edge table.
  const keys: string[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const o = i * 3;
    keys[i] = `${Math.round(position[o] * 1000)},${Math.round(position[o + 1] * 1000)},${Math.round(position[o + 2] * 1000)}`;
  }
  interface Edge {
    /** Face normal of the first triangle that used the edge. */
    nx: number;
    ny: number;
    nz: number;
    faces: number;
    crease: boolean;
  }
  const edges = new Map<string, Edge>();
  const tri = (a: number, b: number, c: number, nx: number, ny: number, nz: number): void => {
    const pairs: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [i0, i1] of pairs) {
      const ka = keys[i0];
      const kb = keys[i1];
      if (ka === kb) continue;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const found = edges.get(key);
      if (!found) {
        edges.set(key, { nx, ny, nz, faces: 1, crease: false });
        continue;
      }
      found.faces++;
      if (!found.crease) {
        const dot = found.nx * nx + found.ny * ny + found.nz * nz;
        if (dot < CREASE_DOT) found.crease = true;
      }
    }
  };
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i];
    const b = index[i + 1];
    const c = index[i + 2];
    const ao = a * 3;
    const bo = b * 3;
    const co = c * 3;
    const abx = position[bo] - position[ao];
    const aby = position[bo + 1] - position[ao + 1];
    const abz = position[bo + 2] - position[ao + 2];
    const acx = position[co] - position[ao];
    const acy = position[co + 1] - position[ao + 1];
    const acz = position[co + 2] - position[ao + 2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    tri(a, b, c, nx, ny, nz);
  }
  // Edge keys only store one endpoint index; recover both from the merged key.
  const out: number[] = [];
  for (const [key, edge] of edges) {
    if (!edge.crease && edge.faces > 1) continue;
    const [ka, kb] = key.split('|');
    const a = ka.split(',').map(Number);
    const b = kb.split(',').map(Number);
    out.push(a[0] / 1000, a[1] / 1000, a[2] / 1000, b[0] / 1000, b[1] / 1000, b[2] / 1000);
  }
  const result = new Float32Array(out);
  cache.set(defId, result);
  return result;
}
