import { cross, normalize, type Vec3 } from './math';

export type ThumbnailKind = 'unit' | 'building';
export type ThumbnailShape = 'card' | 'portrait';

export interface ThumbnailRequest {
  kind: ThumbnailKind;
  defId: string;
  color: string;
  shape?: ThumbnailShape;
}

export interface PortraitFrame {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  eye: Vec3;
  halfW: number;
  halfH: number;
}

/** Native pixels per slot; card art is 2× its CSS size, portraits are 2× the HUD square. */
export const THUMBNAIL_SIZES: Record<ThumbnailShape, { width: number; height: number }> = {
  card: { width: 192, height: 144 },
  portrait: { width: 96, height: 96 },
};

const CAMERA_YAW = Math.PI * 0.25;
const CAMERA_PITCH = Math.PI / 6;
const CAMERA_DISTANCE = 320;
const FRAME_PADDING = 1.16;

const FORWARD = normalize([
  -Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH),
  -Math.sin(CAMERA_PITCH),
  -Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH),
]);
const RIGHT = normalize(cross(FORWARD, [0, 1, 0]));
const UP = normalize(cross(RIGHT, FORWARD));

export function thumbnailKey(request: ThumbnailRequest): string {
  const shape = request.shape ?? 'card';
  return `${request.kind}:${request.defId}:${shape}:${request.color.toLowerCase()}`;
}

/**
 * Fit an orthographic three-quarter view around the supplied world points.
 * The returned eye/axes feed the same camera uniforms as the battle renderer.
 */
export function portraitFrame(
  points: readonly Vec3[],
  width: number,
  height: number,
): PortraitFrame | null {
  if (points.length === 0 || width <= 0 || height <= 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] > maxZ) maxZ = p[2];
  }
  const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];

  let minR = Infinity;
  let maxR = -Infinity;
  let minU = Infinity;
  let maxU = -Infinity;
  for (const p of points) {
    const dx = p[0] - center[0];
    const dy = p[1] - center[1];
    const dz = p[2] - center[2];
    const r = dx * RIGHT[0] + dy * RIGHT[1] + dz * RIGHT[2];
    const u = dx * UP[0] + dy * UP[1] + dz * UP[2];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
  }

  const midR = (minR + maxR) / 2;
  const midU = (minU + maxU) / 2;
  const target: Vec3 = [
    center[0] + RIGHT[0] * midR + UP[0] * midU,
    center[1] + RIGHT[1] * midR + UP[1] * midU,
    center[2] + RIGHT[2] * midR + UP[2] * midU,
  ];
  const eye: Vec3 = [
    target[0] - FORWARD[0] * CAMERA_DISTANCE,
    target[1] - FORWARD[1] * CAMERA_DISTANCE,
    target[2] - FORWARD[2] * CAMERA_DISTANCE,
  ];

  const aspect = width / height;
  const spanR = Math.max(maxR - minR, 0.001);
  const spanU = Math.max(maxU - minU, 0.001);
  const halfH = Math.max(spanU / 2, spanR / 2 / aspect) * FRAME_PADDING;
  const halfW = halfH * aspect;

  return { forward: FORWARD, right: RIGHT, up: UP, eye, halfW, halfH };
}
