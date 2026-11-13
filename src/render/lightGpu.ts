import { createProgram } from './gl';
import { LIGHT_FS, LIGHT_VS } from './shaders';
import type { Camera } from './camera';

/**
 * One instanced batch for every light on the battlefield.
 *
 * Ground pools and camera-facing glows share the same buffer and draw call, so a
 * night map costs one extra draw rather than one per lamp. Additive blending,
 * depth-tested but not depth-writing, with no shadow maps and no per-frame
 * allocation once the buffer has grown.
 */

export interface GpuLight {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Rotation in radians; beams point along the vehicle's facing. */
  rotation: number;
  /** Elongation along the rotation; 1 is a circle. */
  stretch: number;
  /** 1 draws a camera-facing glow, 0 a ground pool. */
  glow: number;
  /**
   * 1 draws a headlamp/ searchlight cone instead of a round pool: the beam
   * starts at the back edge, widens forward and fades out at its far end.
   */
  cone: number;
  color: [number, number, number];
  intensity: number;
  /**
   * For a cone: where this quad sits along the beam, 0 at the bumper and 1 at
   * the far end. A beam over rising ground is split into several quads, one per
   * terrain step, and each carries its slice so the fades stay continuous.
   * Absent means the whole beam in one quad.
   */
  beam?: readonly [number, number];
  /**
   * A real lamp for the terrain shader: origin, aim, cone and reach. The beam is
   * not drawn as geometry at all, so no quad can sink into a slope or band at a
   * seam; the ground evaluates the cone per fragment against the surface it
   * actually hit.
   */
  spot?: GroundSpot;
}

export interface GroundSpot {
  /** Lamp position in world space. */
  x: number;
  y: number;
  z: number;
  /** Unit aim vector; lamps look slightly down so the cone meets the ground. */
  dirX: number;
  dirY: number;
  dirZ: number;
  /** Distance at which the cone has decayed to nothing. */
  range: number;
  /** Cosine of the cone's soft outer edge. */
  cosOuter: number;
  color: [number, number, number];
  intensity: number;
}

const FLOATS_PER_LIGHT = 14;

export class LightGpu {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private data = new Float32Array(0);
  private capacity = 0;
  private count = 0;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private gl: WebGL2RenderingContext) {
    this.program = createProgram(gl, LIGHT_VS, LIGHT_FS);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
      gl.STATIC_DRAW,
    );
    const index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to create light VAO.');
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);

    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const stride = FLOATS_PER_LIGHT * 4;
    // center (3), color RGBA (4), shape (4), padding (1)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 3 * 4);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 7 * 4);
    gl.vertexAttribDivisor(3, 1);
    // Beam shape: 1 for a cone, 0 for a round pool or a camera-facing glow.
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 11 * 4);
    gl.vertexAttribDivisor(4, 1);
    // Beam slice: 0 at the bumper, 1 at the far end.
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 2, gl.FLOAT, false, stride, 12 * 4);
    gl.vertexAttribDivisor(5, 1);
    gl.bindVertexArray(null);

    for (const name of [
      'uEye',
      'uRight',
      'uUp',
      'uForward',
      'uHalf',
      'uNear',
      'uFar',
      'uRightDir',
      'uUpDir',
    ]) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
  }

  draw(camera: Camera, lights: readonly GpuLight[]): void {
    if (lights.length === 0) return;
    const gl = this.gl;
    if (this.capacity < lights.length) {
      this.capacity = Math.max(lights.length, 128);
      this.data = new Float32Array(this.capacity * FLOATS_PER_LIGHT);
    }
    const d = this.data;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      const o = i * FLOATS_PER_LIGHT;
      d[o] = l.x;
      d[o + 1] = l.y;
      d[o + 2] = l.z;
      d[o + 3] = l.color[0];
      d[o + 4] = l.color[1];
      d[o + 5] = l.color[2];
      d[o + 6] = Math.max(0, Math.min(1, l.intensity));
      d[o + 7] = l.radius;
      d[o + 8] = l.rotation;
      d[o + 9] = l.stretch;
      d[o + 10] = l.glow;
      d[o + 11] = l.cone;
      d[o + 12] = l.beam ? l.beam[0] : 0;
      d[o + 13] = l.beam ? l.beam[1] : 1;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, lights.length * FLOATS_PER_LIGHT), gl.DYNAMIC_DRAW);
    this.count = lights.length;

    gl.useProgram(this.program);
    gl.uniform3fv(this.u.uEye, camera.eye);
    gl.uniform3fv(this.u.uRight, camera.right);
    gl.uniform3fv(this.u.uUp, camera.up);
    gl.uniform3fv(this.u.uForward, camera.forward);
    gl.uniform2f(this.u.uHalf, camera.halfW, camera.halfH);
    gl.uniform1f(this.u.uNear, 1);
    gl.uniform1f(this.u.uFar, 3000);
    gl.uniform3fv(this.u.uRightDir, camera.right);
    gl.uniform3fv(this.u.uUpDir, camera.up);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.count);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}
