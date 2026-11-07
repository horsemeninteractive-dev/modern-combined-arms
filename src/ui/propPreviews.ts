/**
 * Palette thumbnails for set dressing.
 *
 * The Forge has fifty prop kinds, and a wall of text-only labels is not a
 * palette: nothing on screen tells a bollard from a hydrant until one has been
 * placed. Each swatch therefore shows the real authored mesh, drawn here with a
 * small software rasteriser rather than through the GL renderer — no second
 * context, no async upload, and the whole catalogue costs a handful of
 * milliseconds because the meshes are already small.
 *
 * Previews are cached as data URLs. `buildDecorMesh` caches its meshes and the
 * catalogue is static, so each kind is rasterised once per session and the
 * palette can be re-rendered freely.
 */
import type { MeshBuffers } from '../render/gl';
import { buildDecorMesh } from '../render/decorMeshes';
import {
  buildBushMesh,
  buildFenceMesh,
  buildGrassTuftMesh,
  buildLampMesh,
  buildReedMesh,
  buildRockMesh,
  buildRubbleMesh,
  buildShrubMesh,
  buildSignPostMesh,
  buildTreeMesh,
  buildUtilityPoleMesh,
} from '../render/geometry';
import { PROPS, type PropBatch, type PropKind } from '../data/props';

/**
 * The eleven scatter batches, whose meshes the terrain pass already builds.
 * `buildDecorMesh` returns nothing for them, so the palette asks geometry
 * directly rather than duplicating a prop mesh just for the panel.
 */
const LEGACY_MESHES: Partial<Record<PropBatch, () => MeshBuffers>> = {
  trees: buildTreeMesh,
  rocks: buildRockMesh,
  bushes: buildBushMesh,
  shrubs: buildShrubMesh,
  tufts: buildGrassTuftMesh,
  fences: buildFenceMesh,
  lamps: buildLampMesh,
  signs: buildSignPostMesh,
  poles: buildUtilityPoleMesh,
  rubble: buildRubbleMesh,
  reeds: buildReedMesh,
};

const WIDTH = 112;
const HEIGHT = 72;
const PAD = 7;

/** Three-quarter view from the front-left: the angle the map camera reads best. */
const YAW = 0.62;
const PITCH = 0.4;

const LIGHT: [number, number, number] = (() => {
  const l: [number, number, number] = [0.36, 0.86, 0.36];
  const n = Math.hypot(l[0], l[1], l[2]) || 1;
  return [l[0] / n, l[1] / n, l[2] / n];
})();

const CACHE = new Map<PropKind, string>();

/** A prop's palette thumbnail as a data URL, or '' if it cannot be drawn. */
export function propPreview(kind: PropKind): string {
  const cached = CACHE.get(kind);
  if (cached !== undefined) return cached;
  const url = rasterize(meshFor(kind)) ?? '';
  CACHE.set(kind, url);
  return url;
}

function meshFor(kind: PropKind): MeshBuffers | undefined {
  const batch = PROPS[kind].batch;
  return buildDecorMesh(batch) ?? LEGACY_MESHES[batch]?.();
}

function rasterize(mesh: MeshBuffers | undefined): string | null {
  if (!mesh || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const pos = mesh.positions;
  const nrm = mesh.normals;
  const col = mesh.colors;
  const vertices = pos.length / 3;
  const across = new Float32Array(vertices);
  const up = new Float32Array(vertices);
  const depth = new Float32Array(vertices);
  const yawCos = Math.cos(YAW);
  const yawSin = Math.sin(YAW);
  const pitchCos = Math.cos(PITCH);
  const pitchSin = Math.sin(PITCH);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < vertices; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    // Screen-space horizontal offset, and how far into the screen the point
    // sits. Depth is kept around so the triangles can be painted far to near.
    const sx = x * yawCos - z * yawSin;
    const into = x * yawSin + z * yawCos;
    const sy = y * pitchCos - into * pitchSin;
    across[i] = sx;
    up[i] = sy;
    depth[i] = into;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }

  const spanX = Math.max(maxX - minX, 0.0001);
  const spanY = Math.max(maxY - minY, 0.0001);
  const scale = Math.min((WIDTH - PAD * 2) / spanX, (HEIGHT - PAD * 2) / spanY);
  const originX = (WIDTH - spanX * scale) / 2;
  const originY = (HEIGHT - spanY * scale) / 2;
  const screenX = (i: number): number => originX + (across[i] - minX) * scale;
  const screenY = (i: number): number => HEIGHT - originY - (up[i] - minY) * scale;

  const indices = mesh.indices;
  const faces = indices.length / 3;
  const order = Array.from({ length: faces }, (_, i) => i);
  const mid = new Float32Array(faces);
  for (let t = 0; t < faces; t++) {
    mid[t] =
      (depth[indices[t * 3]] + depth[indices[t * 3 + 1]] + depth[indices[t * 3 + 2]]) / 3;
  }
  order.sort((a, b) => mid[a] - mid[b]);

  ctx.lineJoin = 'round';
  for (const t of order) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    // Flat shading from the face normal and the average vertex colour: at this
    // size silhouette and material breaks are all the eye can read anyway.
    const nx = (nrm[ia * 3] + nrm[ib * 3] + nrm[ic * 3]) / 3;
    const ny = (nrm[ia * 3 + 1] + nrm[ib * 3 + 1] + nrm[ic * 3 + 1]) / 3;
    const nz = (nrm[ia * 3 + 2] + nrm[ib * 3 + 2] + nrm[ic * 3 + 2]) / 3;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const lambert = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl);
    const lit = 0.46 + 0.72 * lambert;
    const r = Math.min(255, Math.round(((col[ia * 3] + col[ib * 3] + col[ic * 3]) / 3) * lit * 255));
    const g = Math.min(
      255,
      Math.round(((col[ia * 3 + 1] + col[ib * 3 + 1] + col[ic * 3 + 1]) / 3) * lit * 255),
    );
    const b = Math.min(
      255,
      Math.round(((col[ia * 3 + 2] + col[ib * 3 + 2] + col[ic * 3 + 2]) / 3) * lit * 255),
    );
    const fill = `rgb(${r},${g},${b})`;
    ctx.fillStyle = fill;
    ctx.strokeStyle = fill;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(screenX(ia), screenY(ia));
    ctx.lineTo(screenX(ib), screenY(ib));
    ctx.lineTo(screenX(ic), screenY(ic));
    ctx.closePath();
    ctx.fill();
    // The stroke closes the hairline seams antialiasing leaves between adjacent
    // faces; without it every box reads as a wireframe.
    ctx.stroke();
  }

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
