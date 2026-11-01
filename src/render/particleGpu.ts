import { createProgram } from './gl';
import { PARTICLE_FS, PARTICLE_VS } from './shaders';
import type { Camera } from './camera';

export interface GpuParticle {
  x: number;
  y: number;
  z: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
  /** Length along `dir`; 1 is round. Rain and sparks streak. */
  stretch?: number;
  /** Edge softness 0..1; 0 is a tight hot core, 1 a fully feathered puff. */
  soft?: number;
  /** World-space streak axis, already normalised. Defaults to world up. */
  dirX?: number;
  dirY?: number;
  dirZ?: number;
}

/** Floats per instance: centre(3) size(1) rgba(4) shape(2) dir(3). */
const FLOATS_PER_INSTANCE = 13;

interface Batch {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  capacity: number;
  data: Float32Array;
  count: number;
}

export class ParticleGpu {
  private program: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private additive: Batch;
  private normal: Batch;

  constructor(private gl: WebGL2RenderingContext) {
    this.program = createProgram(gl, PARTICLE_VS, PARTICLE_FS);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 0,
        1, -1, 1, 0,
        1, 1, 1, 1,
        -1, 1, 0, 1,
      ]),
      gl.STATIC_DRAW,
    );
    const index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    const makeBatch = (): Batch => {
      const vao = gl.createVertexArray();
      if (!vao) throw new Error('Unable to create particle VAO.');
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4 * 4, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      const buffer = gl.createBuffer()!;
      const stride = FLOATS_PER_INSTANCE * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 3 * 4);
      gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 4 * 4);
      gl.vertexAttribDivisor(4, 1);
      gl.enableVertexAttribArray(5);
      gl.vertexAttribPointer(5, 2, gl.FLOAT, false, stride, 8 * 4);
      gl.vertexAttribDivisor(5, 1);
      gl.enableVertexAttribArray(6);
      gl.vertexAttribPointer(6, 3, gl.FLOAT, false, stride, 10 * 4);
      gl.vertexAttribDivisor(6, 1);
      gl.bindVertexArray(null);
      return { vao, buffer, capacity: 0, data: new Float32Array(0), count: 0 };
    };
    this.additive = makeBatch();
    this.normal = makeBatch();
    for (const name of ['uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar', 'uRightDir', 'uUpDir', 'uAdditive']) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
  }

  private upload(batch: Batch, particles: GpuParticle[]): void {
    const gl = this.gl;
    if (batch.capacity < particles.length) {
      batch.capacity = Math.max(particles.length, 256);
      batch.data = new Float32Array(batch.capacity * FLOATS_PER_INSTANCE);
    }
    const d = batch.data;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const o = i * FLOATS_PER_INSTANCE;
      d[o] = p.x;
      d[o + 1] = p.y;
      d[o + 2] = p.z;
      d[o + 3] = p.size;
      d[o + 4] = p.r;
      d[o + 5] = p.g;
      d[o + 6] = p.b;
      d[o + 7] = p.a;
      d[o + 8] = p.stretch ?? 1;
      d[o + 9] = p.soft ?? 0.5;
      d[o + 10] = p.dirX ?? 0;
      d[o + 11] = p.dirY ?? 1;
      d[o + 12] = p.dirZ ?? 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      d.subarray(0, particles.length * FLOATS_PER_INSTANCE),
      gl.DYNAMIC_DRAW,
    );
    batch.count = particles.length;
  }

  draw(camera: Camera, additive: GpuParticle[], normal: GpuParticle[]): void {
    if (additive.length === 0 && normal.length === 0) return;
    const gl = this.gl;
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

    if (normal.length > 0) {
      this.upload(this.normal, normal);
      gl.uniform1f(this.u.uAdditive, 0);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.normal.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.normal.count);
    }
    if (additive.length > 0) {
      this.upload(this.additive, additive);
      gl.uniform1f(this.u.uAdditive, 1);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(this.additive.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.additive.count);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}
