/**
 * Texture units for the mesh program. Its fragment shader samples the national
 * flag (or the white fallback), the strategic fog mask used by roads, the tiny
 * material-property LUT and the previous fog field it cross-fades from. One
 * sampler can only read one unit, so each gets its own slot: 0 flag, 1 fog,
 * 2 material, 3 previous fog.
 */
export const MESH_FLAG_TEXTURE_UNIT = 0;
export const MESH_FOG_TEXTURE_UNIT = 1;
export const MESH_MATERIAL_TEXTURE_UNIT = 2;
export const MESH_FOG_OLD_TEXTURE_UNIT = 3;
/** The prop program has no flag; it uses 0 for fog, 1 for materials, 2 for fog-old. */
export const PROP_MATERIAL_TEXTURE_UNIT = 1;

/** Bind a texture and point its sampler uniform at the same unit. */
export function bindTextureUnit(
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture,
  sampler: WebGLUniformLocation | null,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(sampler, unit);
}

export interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  teamMask: Float32Array;
  /** One material id per vertex; absent means legacy painted material. */
  materials?: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create WebGL program.');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

export function uniformsOf(gl: WebGL2RenderingContext, program: WebGLProgram): Record<string, WebGLUniformLocation | null> {
  const names = [
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
    'uAlpha',
    'uFlash',
    'uTint',
    'uFogTex',
    'uShoreTex',
    'uUseFog',
    'uTime',
    'uWorldSize',
    'uEmissive',
    'uCenter',
    'uSize',
    'uColor',
    'uRightDir',
    'uUpDir',
    'uTex',
    'uViewRect',
  ];
  const out: Record<string, WebGLUniformLocation | null> = {};
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}

export class StaticMesh {
  readonly vao: WebGLVertexArrayObject;
  readonly count: number;
  private indexType: number;

  constructor(
    private gl: WebGL2RenderingContext,
    data: MeshBuffers,
  ) {
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to create VAO.');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const interleaved = new Float32Array((data.positions.length / 3) * 11);
    for (let i = 0, v = 0; i < data.positions.length; i += 3, v += 11) {
      interleaved[v] = data.positions[i];
      interleaved[v + 1] = data.positions[i + 1];
      interleaved[v + 2] = data.positions[i + 2];
      interleaved[v + 3] = data.normals[i];
      interleaved[v + 4] = data.normals[i + 1];
      interleaved[v + 5] = data.normals[i + 2];
      interleaved[v + 6] = data.colors[i];
      interleaved[v + 7] = data.colors[i + 1];
      interleaved[v + 8] = data.colors[i + 2];
      interleaved[v + 9] = data.teamMask[i / 3];
      interleaved[v + 10] = data.materials ? data.materials[i / 3] : 0;
    }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
    const stride = 11 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 9 * 4);
    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 1, gl.FLOAT, false, stride, 10 * 4);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    this.indexType =
      data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.count = data.indices.length;
    gl.bindVertexArray(null);
  }

  draw(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, this.indexType, 0);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
  }
}

export interface FlagMeshBuffers extends MeshBuffers {
  /** 0 at the pole, 1 at the free edge of the cloth. */
  wind: Float32Array;
  /** UV into the national flag texture. */
  uv: Float32Array;
  /** 1 for the national flag, 0 for the alliance flag and pole. */
  texMask: Float32Array;
}

/**
 * A mesh with cloth data. It uses the same mesh program as everything else;
 * only the flag assembly enables the extra attributes, so ordinary meshes pay
 * no vertex memory for wind, UVs or texture masking.
 */
export class FlagMesh {
  readonly vao: WebGLVertexArrayObject;
  readonly count: number;
  private indexType: number;

  constructor(
    private gl: WebGL2RenderingContext,
    data: FlagMeshBuffers,
  ) {
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to create flag VAO.');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const vertexCount = data.positions.length / 3;
    const interleaved = new Float32Array(vertexCount * 15);
    for (let i = 0, v = 0; i < vertexCount; i++, v += 15) {
      const p = i * 3;
      interleaved[v] = data.positions[p];
      interleaved[v + 1] = data.positions[p + 1];
      interleaved[v + 2] = data.positions[p + 2];
      interleaved[v + 3] = data.normals[p];
      interleaved[v + 4] = data.normals[p + 1];
      interleaved[v + 5] = data.normals[p + 2];
      interleaved[v + 6] = data.colors[p];
      interleaved[v + 7] = data.colors[p + 1];
      interleaved[v + 8] = data.colors[p + 2];
      interleaved[v + 9] = data.teamMask[i];
      interleaved[v + 10] = data.wind[i] ?? 0;
      interleaved[v + 11] = data.uv[i * 2] ?? 0;
      interleaved[v + 12] = data.uv[i * 2 + 1] ?? 0;
      interleaved[v + 13] = data.texMask[i] ?? 0;
      interleaved[v + 14] = 0;
    }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
    const stride = 15 * 4;
    for (const [location, size, offset] of [
      [0, 3, 0],
      [1, 3, 3],
      [2, 3, 6],
      [3, 1, 9],
      [4, 1, 10],
      [5, 2, 11],
      [6, 1, 13],
      [7, 1, 14],
    ] as const) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4);
    }
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    this.indexType =
      data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.count = data.indices.length;
    gl.bindVertexArray(null);
  }

  draw(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, this.indexType, 0);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
  }
}

export interface PropInstance {
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  color: [number, number, number];
}

/** Static mesh with per-instance position/rotation/scale/color. */
export class InstancedMesh {
  readonly vao: WebGLVertexArrayObject;
  readonly count: number;
  private indexType: number;
  private instanceBuffer: WebGLBuffer;
  private capacity = 0;
  private instanceData: Float32Array = new Float32Array(0);

  constructor(
    private gl: WebGL2RenderingContext,
    data: MeshBuffers,
  ) {
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to create instanced VAO.');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const interleaved = new Float32Array((data.positions.length / 3) * 11);
    for (let i = 0, v = 0; i < data.positions.length; i += 3, v += 11) {
      interleaved[v] = data.positions[i];
      interleaved[v + 1] = data.positions[i + 1];
      interleaved[v + 2] = data.positions[i + 2];
      interleaved[v + 3] = data.normals[i];
      interleaved[v + 4] = data.normals[i + 1];
      interleaved[v + 5] = data.normals[i + 2];
      interleaved[v + 6] = data.colors[i];
      interleaved[v + 7] = data.colors[i + 1];
      interleaved[v + 8] = data.colors[i + 2];
      interleaved[v + 9] = data.teamMask[i / 3];
      interleaved[v + 10] = data.materials ? data.materials[i / 3] : 0;
    }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
    const stride = 11 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 9 * 4);
    gl.enableVertexAttribArray(8);
    gl.vertexAttribPointer(8, 1, gl.FLOAT, false, stride, 10 * 4);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    this.indexType =
      data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.count = data.indices.length;
    const ibuf = gl.createBuffer();
    this.instanceBuffer = ibuf;
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 8 * 4, 0);
    gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 8 * 4, 3 * 4);
    gl.vertexAttribDivisor(5, 1);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 1, gl.FLOAT, false, 8 * 4, 4 * 4);
    gl.vertexAttribDivisor(6, 1);
    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 3, gl.FLOAT, false, 8 * 4, 5 * 4);
    gl.vertexAttribDivisor(7, 1);
    gl.bindVertexArray(null);
  }

  setInstances(instances: PropInstance[]): void {
    const gl = this.gl;
    if (this.capacity < instances.length) {
      this.capacity = Math.max(instances.length, 64);
      this.instanceData = new Float32Array(this.capacity * 8);
    }
    const data = this.instanceData;
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const o = i * 8;
      data[o] = inst.x;
      data[o + 1] = inst.y;
      data[o + 2] = inst.z;
      data[o + 3] = inst.rotation;
      data[o + 4] = inst.scale;
      data[o + 5] = inst.color[0];
      data[o + 6] = inst.color[1];
      data[o + 7] = inst.color[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, instances.length * 8), gl.DYNAMIC_DRAW);
  }

  draw(count: number): void {
    if (count === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.count, this.indexType, 0, count);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.instanceBuffer);
  }
}
