import { lookAt, multiply, orthographic, type Vec3 } from './math';

/** Depth-map size for the detailed shadow pass. */
export const SHADOW_MAP_SIZE = 2048;

/**
 * Light-space box fitted around the camera's visible ground footprint.
 *
 * The camera is orthographic and fixed-pitch, so the footprint is a rotated
 * rectangle; covering its bounding circle plus the reach of the tallest cast
 * shadow keeps every visible caster inside the map. The box is built around the
 * centre of the view rather than the map origin, so a map-wide orthographic frustum
 * does not waste most of its depth precision on invisible ground.
 */
export interface ShadowVolume {
  matrix: Float32Array;
  center: Vec3;
  radius: number;
  distance: number;
}

export function shadowLightMatrix(
  sun: Vec3,
  centerX: number,
  centerZ: number,
  radius: number,
  sceneY = 4,
): ShadowVolume {
  const center: Vec3 = [centerX, sceneY, centerZ];
  const distance = radius * 2 + 160;
  // A sun near the zenith would make `up` parallel to the view direction and
  // collapse the basis. The authored elevation never gets there, but a guard
  // keeps the matrix well-defined for a hand-written light.
  const up: Vec3 = Math.abs(sun[1]) > 0.995 ? [0, 0, 1] : [0, 1, 0];
  const eye: Vec3 = [
    center[0] + sun[0] * distance,
    center[1] + sun[1] * distance,
    center[2] + sun[2] * distance,
  ];
  const view = lookAt(eye, center, up);
  const projection = orthographic(-radius, radius, -radius, radius, 1, distance * 2 + 320);
  return {
    matrix: multiply(projection, view),
    center,
    radius,
    distance,
  };
}

/**
 * A single depth-only render target for the detailed shadow pass.
 *
 * There is no colour attachment: casters are rasterised for depth alone and the
 * lit passes sample the texture with their own 3x3 PCF compare. Nearest
 * filtering keeps the taps explicit instead of relying on hardware depth
 * comparison, which WebGL2 only offers through a shadow sampler.
 */
export class ShadowMap {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly size: number;

  constructor(
    private gl: WebGL2RenderingContext,
    size = SHADOW_MAP_SIZE,
  ) {
    this.size = size;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Unable to create shadow map.');
    this.texture = texture;
    this.framebuffer = framebuffer;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      size,
      size,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.texture);
  }
}
