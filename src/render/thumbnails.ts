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
  // Hull paint multiplier. The battle renderer uploads the equipped camo (or
  // white); this context has no camo, and an unset vec3 is black, which would
  // paint every hull on every card black.
  'uCamo',
  'uAmbient',
  'uAlpha',
  'uFlash',
  'uMatLut',
  // Added with the day/night grade. These default to zero when a program
  // declares them, and `uTone` multiplies the whole lit colour, so leaving it
  // unset renders every card as a black silhouette.
  'uTone',
  'uNightGlow',
  'uSilhouette',
  'uUseFog',
] as const;
type UniformName = (typeof UNIFORM_NAMES)[number];

interface MeshPart {
  slot: 'body' | 'turret' | 'leg' | 'rotor';
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
  // A rotor is a separate part now that it turns in battle, so the card has to
  // draw it too — held at a three-quarter angle instead of edge-on, or the
  // gunship reads as a mast with no blades.
  for (const part of [style.rotor, style.tailRotor]) {
    if (!part) continue;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    parts.push({
      slot: 'rotor',
      mesh: part.mesh,
      matrix: modelMatrix(
        (part.offset[0] * c + part.offset[2] * s) * scale,
        part.offset[1] * scale,
        (-part.offset[0] * s + part.offset[2] * c) * scale,
        0.7,
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
    // This is a second, off-screen GL context. A driver reset here must not
    // take the battle canvas with it, and the HUD already has icon fallbacks.
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.handleContextLost();
    });
    this.canvas.addEventListener('webglcontextrestored', () => this.tryInit());
    this.tryInit();
  }

  private tryInit(): void {
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
    this.gl = gl;
    try {
      this.initResources();
    } catch {
      // Stay unavailable rather than throwing from the HUD's paint path.
      this.program = null;
      this.gl = null;
    }
  }

  private initResources(): void {
    const gl = this.gl!;
    this.meshes.clear();
    this.uniforms = {};
    this.program = createProgram(gl, MESH_VS, MESH_FS);
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

  private handleContextLost(): void {
    // Cached object URLs still hold finished PNGs, so existing cards keep
    // their art. New cards fall back to the icon while the context is gone.
    this.gl = null;
    this.program = null;
    this.materialTexture = null;
    this.meshes.clear();
    this.uniforms = {};
    this.queue.length = 0;
    this.pending.clear();
    this.draining = false;
    this.scheduled = false;
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
    const shape: ThumbnailShape = request.shape ?? 'card';
    const normalized: ThumbnailRequest = { ...request, shape };
    const cached = this.cache.get(thumbnailKey(normalized));
    if (cached) return cached;
    if (!this.available) return null;
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
      // Card art shows the platform, never a commander's equipped paint.
      gl.uniform3fv(u.uCamo ?? null, [1, 1, 1]);
      gl.uniform1f(u.uAmbient ?? null, 0.58);
      gl.uniform1f(u.uAlpha ?? null, 1);
      gl.uniform1f(u.uFlash ?? null, 0);
      // Card art is its own studio shot: neutral grade, no window glow, no fog
      // and no silhouette pass. The card's own CSS dims it for state.
      gl.uniform3fv(u.uTone ?? null, [1, 1, 1]);
      gl.uniform1f(u.uNightGlow ?? null, 0);
      gl.uniform1f(u.uSilhouette ?? null, 0);
      gl.uniform1f(u.uUseFog ?? null, 0);
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
