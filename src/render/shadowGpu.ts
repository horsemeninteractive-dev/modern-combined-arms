import { createProgram } from './gl';
import { SHADOW_FS, SHADOW_VS } from './shaders';
import type { Camera } from './camera';

export interface GpuShadow {
  x: number;
  y: number;
  z: number;
  /** Half-extent along the shadow's local X (usually the hull length). */
  rx: number;
  /** Half-extent along the shadow's local Z (usually the hull width). */
  rz: number;
  rotation: number;
  alpha: number;
  /**
   * Optional ground colour. Contact shadows leave this unset and use the dark
   * default; a foot unit's presence pool sets its alliance colour instead.
   */
  color?: [number, number, number];
}

/** 10 floats: centre xyz, radii xy, rotation, alpha, colour rgb. */
const STRIDE = 10;
/** The old uniform colour, kept as the per-instance default. */
const SHADOW_COLOR: [number, number, number] = [0.025, 0.032, 0.028];
const ATTRIBUTES = [
  { location: 1, size: 3, offset: 0 },
  { location: 2, size: 2, offset: 3 },
  { location: 3, size: 1, offset: 5 },
  { location: 4, size: 1, offset: 6 },
  { location: 5, size: 3, offset: 7 },
];

/**
 * Instanced, soft-edged ground shadows. A single quad per entity is projected
 * flat onto the terrain, with a radial falloff in the fragment shader so the
 * edge blends into sand, grass and rock rather than reading as a hard disc.
 */
export class ShadowGpu {
  private program: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private vao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;
  private capacity = 0;
  private data = new Float32Array(0);

  constructor(private gl: WebGL2RenderingContext) {
    this.program = createProgram(gl, SHADOW_VS, SHADOW_FS);

    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
      gl.STATIC_DRAW,
    );
    const index = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to create shadow VAO.');
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);

    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    for (const attribute of ATTRIBUTES) {
      gl.enableVertexAttribArray(attribute.location);
      gl.vertexAttribPointer(
        attribute.location,
        attribute.size,
        gl.FLOAT,
        false,
        STRIDE * 4,
        attribute.offset * 4,
      );
      gl.vertexAttribDivisor(attribute.location, 1);
    }
    gl.bindVertexArray(null);

    for (const name of ['uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar', 'uOpacity']) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
  }

  draw(camera: Camera, shadows: GpuShadow[], opacity = 0.4): void {
    if (shadows.length === 0) return;
    const gl = this.gl;
    if (this.capacity < shadows.length) {
      this.capacity = Math.max(shadows.length, 64);
      this.data = new Float32Array(this.capacity * STRIDE);
    }
    const data = this.data;
    for (let i = 0; i < shadows.length; i++) {
      const s = shadows[i];
      const o = i * STRIDE;
      data[o] = s.x;
      data[o + 1] = s.y;
      data[o + 2] = s.z;
      data[o + 3] = s.rx;
      data[o + 4] = s.rz;
      data[o + 5] = s.rotation;
      data[o + 6] = s.alpha;
      const color = s.color ?? SHADOW_COLOR;
      data[o + 7] = color[0];
      data[o + 8] = color[1];
      data[o + 9] = color[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, shadows.length * STRIDE), gl.DYNAMIC_DRAW);

    gl.useProgram(this.program);
    gl.uniform3fv(this.u.uEye, camera.eye);
    gl.uniform3fv(this.u.uRight, camera.right);
    gl.uniform3fv(this.u.uUp, camera.up);
    gl.uniform3fv(this.u.uForward, camera.forward);
    gl.uniform2f(this.u.uHalf, camera.halfW, camera.halfH);
    gl.uniform1f(this.u.uNear, 1);
    gl.uniform1f(this.u.uFar, 3000);
    gl.uniform1f(this.u.uOpacity, opacity);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -1);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, shadows.length);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.instanceBuffer);
  }
}
