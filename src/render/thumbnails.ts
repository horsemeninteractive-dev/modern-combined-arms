import { createProgram, StaticMesh, bindTextureUnit, MESH_MATERIAL_TEXTURE_UNIT, type MeshBuffers } from './gl';
import { materialLut } from './materials';
import { MESH_FS, MESH_VS } from './shaders';
import { buildingMesh, FALLBACK_BUILDING } from './buildingMeshes';
import { unitStyle, unitVisualScale, FALLBACK_STYLE } from './unitMeshes';
import { hexToRgb, modelMatrix, type Vec3 } from './math';
import { limbModelMatrix } from './unitTransform';
import {
  THUMBNAIL_SIZES,
  portraitFrame,
  thumbnailKey,
  type ThumbnailRequest,
  type ThumbnailShape,
} from './thumbnailFrame';

const UNIT_VIEW_YAW = -0.45;
const UNIFORM_NAMES = [
  'uEye',
  'uRight',
  'uUp',
  'uForward',
  'uHalf',
  'uNear',
  'uFar',
  'uModel',
  'uTeamColor',
  'uSun',
  'uTint',
  'uAmbient',
  'uAlpha',
  'uFlash',
  'uMatLut',
] as const;
type UniformName = (typeof UNIFORM_NAMES)[number];

interface MeshPart {
  slot: 'body' | 'turret' | 'leg';
  mesh: MeshBuffers;
  matrix: Float32Array;
}

interface QueueItem {
  key: string;
  request: ThumbnailRequest;
  shape: ThumbnailShape;
}

function transformedPoints(mesh: MeshBuffers, matrix: Float32Array): Vec3[] {
  const out: Vec3[] = [];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    out.push([
      matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
      matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
      matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    ]);
  }
  return out;
}

function unitParts(defId: string): MeshPart[] {
  const style = unitStyle(defId) ?? FALLBACK_STYLE;
  const scale = unitVisualScale(defId);
  const yaw = UNIT_VIEW_YAW;
  const parts: MeshPart[] = [
    { slot: 'body', mesh: style.body, matrix: modelMatrix(0, 0, 0, yaw, scale, scale, scale) },
  ];
  if (style.infantry) {
    const hip = style.infantry.hip;
    for (const side of [1, -1]) {
      parts.push({
        slot: 'leg',
        mesh: style.infantry.leg,
        matrix: limbModelMatrix(
          0,
          0,
          0,
          -yaw,
          [hip[0], hip[1], hip[2] * side],
          0.15 * side,
          scale,
        ),
      });
    }
  }
  if (style.turret) {
    const offset = style.turretOffset;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    parts.push({
      slot: 'turret',
      mesh: style.turret,
      matrix: modelMatrix(
        (offset[0] * c + offset[2] * s) * scale,
        offset[1] * scale,
        (-offset[0] * s + offset[2] * c) * scale,
        yaw,
        scale,
        scale,
        scale,
      ),
    });
  }
  return parts;
}

/**
 * Renders unit and building art off-screen with the battle mesh shaders, then
 * caches the transparent PNGs as object or data URLs for the HUD. A failure
 * leaves the existing icon fallbacks in place rather than breaking the interface.
 */
export class ThumbnailRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Partial<Record<UniformName, WebGLUniformLocation | null>> = {};
  private meshes = new Map<string, StaticMesh>();
  private materialTexture: WebGLTexture | null = null;
  private cache = new Map<string, string>();
  private failed = new Set<string>();
  private pending = new Set<string>();
  private queue: QueueItem[] = [];
  private draining = false;
  private scheduled = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = this.canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        depth: true,
        preserveDrawingBuffer: true,
        premultipliedAlpha: false,
      });
    } catch {
      gl = null;
    }
    if (!gl) return;
    try {
      this.program = createProgram(gl, MESH_VS, MESH_FS);
    } catch {
      return;
    }
    this.gl = gl;
    for (const name of UNIFORM_NAMES) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    // The shared mesh shader samples a categorical material LUT. The battle
    // renderer owns its own copy; this off-screen context needs one too.
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 8, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, materialLut());
    this.materialTexture = texture;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  get available(): boolean {
    return this.gl !== null && this.program !== null;
  }

  /**
   * Pre-render a batch synchronously while the battle loading screen is up, so
   * the HUD's first paint already has card art instead of icon fallbacks.
   */
  warmSync(requests: readonly ThumbnailRequest[]): void {
    if (!this.available) return;
    for (const request of requests) {
      const shape: ThumbnailShape = request.shape ?? 'card';
      const normalized: ThumbnailRequest = { ...request, shape };
      const key = thumbnailKey(normalized);
      if (this.cache.has(key) || this.failed.has(key)) continue;
      try {
        if (!this.drawToCanvas(normalized, shape)) {
          this.failed.add(key);
          continue;
        }
        this.cache.set(key, this.canvas.toDataURL('image/png'));
      } catch {
        this.failed.add(key);
      }
    }
  }

  /**
   * Returns cached art immediately or queues a render and returns null. The
   * queue is drained one image at a time so later selections never block a
   * frame; the HUD fills whichever placeholders are ready on its next update.
   */
  get(request: ThumbnailRequest): string | null {
    if (!this.available) return null;
    const shape: ThumbnailShape = request.shape ?? 'card';
    const normalized: ThumbnailRequest = { ...request, shape };
    const cached = this.cache.get(thumbnailKey(normalized));
    if (cached) return cached;
    this.queueRequest(normalized);
    return null;
  }

  private queueRequest(request: ThumbnailRequest): string {
    const shape: ThumbnailShape = request.shape ?? 'card';
    const normalized: ThumbnailRequest = { ...request, shape };
    const key = thumbnailKey(normalized);
    if (this.cache.has(key) || this.failed.has(key) || this.pending.has(key)) return key;
    this.pending.add(key);
    this.queue.push({ key, request: normalized, shape });
    this.schedule();
    return key;
  }

  private schedule(): void {
    if (this.draining || this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      this.pump();
    }, 0);
  }

  private pump(): void {
    if (this.draining || !this.available) return;
    const item = this.queue.shift();
    if (!item) {
      this.draining = false;
      return;
    }
    this.draining = true;
    this.renderToBlob(item.request, item.shape, (url) => {
      this.pending.delete(item.key);
      this.draining = false;
      if (url) this.cache.set(item.key, url);
      else this.failed.add(item.key);
      this.pump();
    });
  }

  private drawToCanvas(request: ThumbnailRequest, shape: ThumbnailShape): boolean {
    const gl = this.gl;
    const program = this.program;
    if (!gl || !program) return false;

    const parts: MeshPart[] = request.kind === 'building'
      ? [{
          slot: 'body',
          mesh: buildingMesh(request.defId) ?? FALLBACK_BUILDING,
          matrix: modelMatrix(0, 0, 0, 0),
        }]
      : unitParts(request.defId);
    const points = parts.flatMap((part) => transformedPoints(part.mesh, part.matrix));
    const size = THUMBNAIL_SIZES[shape];
    const frame = portraitFrame(points, size.width, size.height);
    if (!frame) return false;

    try {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
      gl.viewport(0, 0, size.width, size.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);

      const u = this.uniforms;
      gl.uniform3fv(u.uEye ?? null, frame.eye);
      gl.uniform3fv(u.uRight ?? null, frame.right);
      gl.uniform3fv(u.uUp ?? null, frame.up);
      gl.uniform3fv(u.uForward ?? null, frame.forward);
      gl.uniform2f(u.uHalf ?? null, frame.halfW, frame.halfH);
      gl.uniform1f(u.uNear ?? null, 0.5);
      gl.uniform1f(u.uFar ?? null, 700);
      gl.uniform3fv(u.uSun ?? null, [0.45, 0.82, 0.35]);
      gl.uniform3fv(u.uTint ?? null, [1.28, 1.28, 1.22]);
      gl.uniform1f(u.uAmbient ?? null, 0.58);
      gl.uniform1f(u.uAlpha ?? null, 1);
      gl.uniform1f(u.uFlash ?? null, 0);
      gl.uniform3fv(u.uTeamColor ?? null, this.teamRgb(request.color));
      if (this.materialTexture) {
        bindTextureUnit(gl, MESH_MATERIAL_TEXTURE_UNIT, this.materialTexture, u.uMatLut ?? null);
      }

      for (const part of parts) {
        const mesh = this.mesh(request.kind, request.defId, part.slot, part.mesh);
        gl.uniformMatrix4fv(u.uModel ?? null, false, part.matrix);
        mesh.draw();
      }
      gl.bindVertexArray(null);
      return true;
    } catch {
      return false;
    }
  }

  private renderToBlob(
    request: ThumbnailRequest,
    shape: ThumbnailShape,
    done: (url: string | null) => void,
  ): void {
    if (!this.drawToCanvas(request, shape)) {
      done(null);
      return;
    }
    if (typeof this.canvas.toBlob === 'function') {
      try {
        this.canvas.toBlob((blob) => {
          if (!blob) {
            done(null);
            return;
          }
          try {
            done(URL.createObjectURL(blob));
          } catch {
            done(null);
          }
        }, 'image/png');
      } catch {
        done(null);
      }
      return;
    }
    try {
      done(this.canvas.toDataURL('image/png'));
    } catch {
      done(null);
    }
  }

  private mesh(
    kind: ThumbnailRequest['kind'],
    defId: string,
    slot: MeshPart['slot'],
    buffers: MeshBuffers,
  ): StaticMesh {
    const key = `${kind}:${defId}:${slot}`;
    const existing = this.meshes.get(key);
    if (existing) return existing;
    const mesh = new StaticMesh(this.gl!, buffers);
    this.meshes.set(key, mesh);
    return mesh;
  }

  private teamRgb(color: string): Vec3 {
    try {
      return hexToRgb(color);
    } catch {
      return [0.82, 0.88, 0.84];
    }
  }
}
