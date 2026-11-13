import { createProgram } from './gl';
import { DECAL_FS, DECAL_VS } from './shaders';
import type { Camera } from './camera';
import { decalAlpha, type GroundDecal, type GroundDecalKind } from './decalStore';

/** 11 floats: centre xyz, radii xy, rotation, alpha, colour rgb, kind. */
const STRIDE = 11;
const KIND_CODE: Record<GroundDecalKind, number> = {
  track: 0,
  scorch: 1,
  tyre: 2,
  crater: 3,
};
const ATTRIBUTES = [
  { location: 1, size: 3, offset: 0 },
  { location: 2, size: 2, offset: 3 },
  { location: 3, size: 1, offset: 5 },
  { location: 4, size: 1, offset: 6 },
  { location: 5, size: 3, offset: 7 },
  { location: 6, size: 1, offset: 10 },
];

/**
 * Lamp data a decal pass needs: the same packed cones the terrain and roads
 * evaluate, plus the occluder map that fades them behind walls.
 */
export interface DecalLamps {
  src: Float32Array;
  aim: Float32Array;
  tint: Float32Array;
  count: number;
  occluder: WebGLTexture | null;
  matrix: Float32Array;
  texel: number;
}

/**
 * One instanced quad per ground decal. The batch is drawn flat on the terrain,
 * before shadows and props, with depth writes disabled so it behaves as a
 * surface mark rather than geometry.
 */
export class DecalGpu {
  private program: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private vao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;
  private capacity = 0;
  private data = new Float32Array(0);

  constructor(private gl: WebGL2RenderingContext) {
    this.program = createProgram(gl, DECAL_VS, DECAL_FS);

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
    if (!vao) throw new Error('Unable to create decal VAO.');
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

    for (const name of [
      'uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar',
      'uSpotSrc[0]', 'uSpotAim[0]', 'uSpotTint[0]', 'uSpotCount', 'uSpotGate',
      'uLampShadow', 'uLampVP', 'uLampTexel', 'uLampOcclusion',
    ]) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
  }

  draw(camera: Camera, decals: readonly GroundDecal[], lamps?: DecalLamps): void {
    if (decals.length === 0) return;
    const gl = this.gl;
    if (this.capacity < decals.length) {
      this.capacity = Math.max(decals.length, 64);
      this.data = new Float32Array(this.capacity * STRIDE);
    }
    const data = this.data;
    for (let i = 0; i < decals.length; i++) {
      const decal = decals[i];
      const alpha = decalAlpha(decal);
      if (!(alpha > 0)) {
        // Store entries that expire this frame should not keep a stale draw.
        data[i * STRIDE + 6] = 0;
        continue;
      }
      const o = i * STRIDE;
      data[o] = decal.x;
      data[o + 1] = decal.y;
      data[o + 2] = decal.z;
      data[o + 3] = decal.rx;
      data[o + 4] = decal.rz;
      data[o + 5] = decal.rotation;
      data[o + 6] = alpha;
      data[o + 7] = decal.color[0];
      data[o + 8] = decal.color[1];
      data[o + 9] = decal.color[2];
      data[o + 10] = KIND_CODE[decal.kind];
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, decals.length * STRIDE), gl.DYNAMIC_DRAW);

    gl.useProgram(this.program);
    gl.uniform3fv(this.u.uEye, camera.eye);
    gl.uniform3fv(this.u.uRight, camera.right);
    gl.uniform3fv(this.u.uUp, camera.up);
    gl.uniform3fv(this.u.uForward, camera.forward);
    gl.uniform2f(this.u.uHalf, camera.halfW, camera.halfH);
    gl.uniform1f(this.u.uNear, 1);
    gl.uniform1f(this.u.uFar, 3000);
    if (lamps) {
      gl.uniform4fv(this.u['uSpotSrc[0]'] ?? null, lamps.src);
      gl.uniform4fv(this.u['uSpotAim[0]'] ?? null, lamps.aim);
      gl.uniform4fv(this.u['uSpotTint[0]'] ?? null, lamps.tint);
      gl.uniform1i(this.u.uSpotCount ?? null, lamps.count);
      gl.uniform1f(this.u.uSpotGate ?? null, 1);
      gl.uniformMatrix4fv(this.u.uLampVP ?? null, false, lamps.matrix);
      gl.uniform2f(this.u.uLampTexel ?? null, lamps.texel, lamps.texel);
      gl.uniform1f(this.u.uLampOcclusion ?? null, lamps.occluder ? 1 : 0);
      gl.uniform1i(this.u.uLampShadow ?? null, 6);
      if (lamps.occluder) {
        gl.activeTexture(gl.TEXTURE0 + 6);
        gl.bindTexture(gl.TEXTURE_2D, lamps.occluder);
        gl.activeTexture(gl.TEXTURE0);
      }
    } else {
      gl.uniform1f(this.u.uSpotGate ?? null, 0);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -2);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, decals.length);
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
