import { createProgram } from './gl';
import type { Camera } from './camera';

/**
 * Fullscreen triangle. WebGL2 supplies gl_VertexID, so the post chain needs no
 * vertex buffer or attribute state: one VAO and three vertices cover the frame.
 */
const FULLSCREEN_VS = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Bright-pass for the bloom chain.
 *
 * The scene is already HDR, so the threshold is a soft knee rather than a
 * binary cut: sun glints and lamps feed the bloom, while a bright concrete
 * apron at noon does not turn into a glowing slab.
 */
const BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
out vec4 outColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float knee = smoothstep(uThreshold, uThreshold + 0.55, luma);
  outColor = vec4(c * knee, 1.0);
}
`;

/** Separable nine-tap Gaussian; the caller supplies the axis and texel size. */
const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uDirection;
out vec4 outColor;
void main() {
  vec3 sum = texture(uSource, vUv).rgb * 0.227027;
  sum += texture(uSource, vUv + uDirection * 1.384615).rgb * 0.316216;
  sum += texture(uSource, vUv - uDirection * 1.384615).rgb * 0.316216;
  sum += texture(uSource, vUv + uDirection * 3.230769).rgb * 0.070270;
  sum += texture(uSource, vUv - uDirection * 3.230769).rgb * 0.070270;
  outColor = vec4(sum, 1.0);
}
`;

/**
 * Separable AO blur whose weights fall off when the depth tap belongs to a
 * different surface. A normal Gaussian blur mixes the dark side of a wall into
 * the bright ground beside it, leaving halos that shift as the camera moves.
 * The depth term keeps the smoothing inside one surface instead.
 */
const AO_BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uDepth;
uniform vec2 uDirection;
uniform float uNear;
uniform float uFar;
uniform float uDepthTolerance;
out vec4 outColor;

float linearDepth(float depth) {
  return uNear + depth * (uFar - uNear);
}

void main() {
  const float OFFSETS[5] = float[5](0.0, -3.230769, -1.384615, 1.384615, 3.230769);
  const float WEIGHTS[5] = float[5](0.227027, 0.070270, 0.316216, 0.316216, 0.070270);
  float center = linearDepth(texture(uDepth, vUv).r);
  float sum = 0.0;
  float total = 0.0;
  for (int i = 0; i < 5; i++) {
    vec2 uv = vUv + uDirection * OFFSETS[i];
    float d = linearDepth(texture(uDepth, uv).r);
    float w = WEIGHTS[i] * exp(-abs(d - center) * uDepthTolerance);
    sum += texture(uSource, uv).r * w;
    total += w;
  }
  outColor = vec4(vec3(sum / max(total, 0.0001)), 1.0);
}
`;

/**
 * ACES filmic curve. The scene is authored display-referred, so this is used as
 * a highlight rolloff rather than a full linear-light grade: mids stay close to
 * the existing palette while lamps and glints stop clipping to flat white.
 */
const ACES = /* glsl */ `
vec3 acesFilm(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`;

/**
 * Screen-space ambient occlusion, reconstructed from the scene's own depth.
 *
 * The camera is a fixed orthographic isometric view, so a pixel's world position
 * is one ray from the eye and no inverse-projection matrix is needed. Eight
 * points in a hemisphere around the reconstructed normal are projected back to
 * screen and compared with the depth already there: a point behind the visible
 * surface is blocking ambient light from reaching it.
 *
 * Depth-edge pixels return white. A normal made from derivatives across a
 * silhouette points sideways and produces a dark halo around every wall and
 * hull; skipping those pixels and letting the blur bridge the gap keeps the
 * contact darkening under the object instead of around it.
 */
const AO_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uDepth;
uniform vec3 uEye;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform vec2 uHalf;
uniform float uNear;
uniform float uFar;
uniform float uRadius;
uniform float uBias;
uniform float uIntensity;
out vec4 outColor;

vec3 worldAt(vec2 uv, float depth) {
  float x = uv.x * 2.0 - 1.0;
  float y = uv.y * 2.0 - 1.0;
  float viewZ = uNear + depth * (uFar - uNear);
  return uEye + uRight * (x * uHalf.x) + uUp * (y * uHalf.y) + uForward * viewZ;
}

vec4 projectWorld(vec3 world) {
  vec3 rel = world - uEye;
  return vec4(
    dot(rel, uRight) / uHalf.x,
    dot(rel, uUp) / uHalf.y,
    ((dot(rel, uForward) - uNear) / (uFar - uNear)) * 2.0 - 1.0,
    1.0
  );
}

void main() {
  float depth = texture(uDepth, vUv).r;
  if (depth >= 0.99999) {
    outColor = vec4(1.0);
    return;
  }
  vec3 p = worldAt(vUv, depth);
  // Reject depth silhouettes in world units, not normalized depth. A fixed
  // normalized-depth threshold changes meaning with zoom: a sloped tile can
  // lose its AO when the camera moves in, then regain it when it moves out.
  float worldDx = length(dFdx(p));
  float worldDy = length(dFdy(p));
  if (worldDx > uRadius * 1.5 || worldDy > uRadius * 1.5) {
    outColor = vec4(1.0);
    return;
  }

  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  if (dot(n, uForward) > 0.0) n = -n;

  // Keep the sample frame stable in world space. Rotating it with a
  // screen-space hash made the AO grain crawl while the loading camera panned.
  vec3 tangent = abs(n.y) > 0.92
    ? normalize(cross(n, vec3(1.0, 0.0, 0.0)))
    : normalize(cross(n, vec3(0.0, 1.0, 0.0)));
  vec3 bitangent = cross(n, tangent);
  mat3 tbn = mat3(tangent, bitangent, n);

  const int KERNEL_SIZE = 12;
  const vec3 KERNEL[12] = vec3[12](
    vec3(0.12, 0.24, 0.42),
    vec3(-0.31, 0.18, 0.64),
    vec3(0.28, -0.34, 0.58),
    vec3(-0.21, -0.42, 0.47),
    vec3(0.52, 0.11, 0.27),
    vec3(-0.46, 0.44, 0.22),
    vec3(0.08, -0.55, 0.36),
    vec3(0.37, 0.48, 0.16),
    vec3(0.36, -0.12, 0.55),
    vec3(-0.12, 0.58, 0.44),
    vec3(0.58, -0.42, 0.32),
    vec3(-0.60, -0.18, 0.38)
  );

  float occlusion = 0.0;
  for (int i = 0; i < KERNEL_SIZE; i++) {
    vec3 sampleWorld = p + tbn * KERNEL[i] * uRadius;
    vec4 clip = projectWorld(sampleWorld);
    vec2 sampleUv = clip.xy * 0.5 + 0.5;
    if (sampleUv.x <= 0.0 || sampleUv.x >= 1.0 || sampleUv.y <= 0.0 || sampleUv.y >= 1.0) continue;
    float sampleDepth = texture(uDepth, sampleUv).r;
    if (sampleDepth >= 0.99999) continue;
    // Compare the sample point's own view depth with the surface stored at
    // that pixel. A flat plane's samples sit in front of the ground, so they
    // do not occlude; only geometry behind the visible surface does.
    float sampleViewZ = uNear + (clip.z * 0.5 + 0.5) * (uFar - uNear);
    float sceneViewZ = uNear + sampleDepth * (uFar - uNear);
    float away = sampleViewZ - sceneViewZ;
    if (away <= uBias) continue;
    float range = smoothstep(0.0, 1.0, uRadius / max(away, 0.001));
    occlusion += range;
  }

  float ao = clamp(1.0 - (occlusion / float(KERNEL_SIZE)) * uIntensity, 0.0, 1.0);
  outColor = vec4(vec3(ao), 1.0);
}
`;

/**
 * Short screen-space contact shadows cast by the sun.
 *
 * AO only darkens crevices around a mesh; it does not put a directional patch
 * of shade on the road under a vehicle. This pass reconstructs the ground from
 * the resolved depth, marches a few metres toward the sun and records the first
 * depth-buffer surface that blocks the ray. The march is deliberately short so
 * it reads as contact grounding rather than duplicating the full shadow map.
 */
const CONTACT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uDepth;
uniform vec3 uEye;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform vec2 uHalf;
uniform float uNear;
uniform float uFar;
uniform vec3 uSun;
out vec4 outColor;

vec3 worldAt(vec2 uv, float depth) {
  float x = uv.x * 2.0 - 1.0;
  float y = uv.y * 2.0 - 1.0;
  float viewZ = uNear + depth * (uFar - uNear);
  return uEye + uRight * (x * uHalf.x) + uUp * (y * uHalf.y) + uForward * viewZ;
}

vec4 projectWorld(vec3 world) {
  vec3 rel = world - uEye;
  return vec4(
    dot(rel, uRight) / uHalf.x,
    dot(rel, uUp) / uHalf.y,
    ((dot(rel, uForward) - uNear) / (uFar - uNear)) * 2.0 - 1.0,
    1.0
  );
}

float linearDepth(float depth) {
  return uNear + depth * (uFar - uNear);
}

void main() {
  float depth = texture(uDepth, vUv).r;
  if (depth >= 0.99999) {
    outColor = vec4(1.0);
    return;
  }

  vec3 p = worldAt(vUv, depth);
  // Reject silhouettes in world units. The old normalized-depth threshold
  // changed with zoom and became a hard, jagged edge wherever two surfaces met.
  float worldDx = length(dFdx(p));
  float worldDy = length(dFdy(p));
  if (worldDx > 2.0 || worldDy > 2.0) {
    outColor = vec4(1.0);
    return;
  }

  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  if (dot(n, uForward) > 0.0) n = -n;
  // Contact shade belongs on the ground under a caster, not on the vertical
  // face that casts it. The old pass shaded walls too, leaving black slabs that
  // crawled with the depth-edge test as the camera panned.
  if (n.y < 0.35) {
    outColor = vec4(1.0);
    return;
  }
  vec3 sunDir = normalize(uSun);
  if (dot(n, sunDir) <= 0.05) {
    outColor = vec4(1.0);
    return;
  }

  vec3 origin = p + n * 0.05 + sunDir * 0.02;
  float occluded = 0.0;
  // Stagger the march per pixel. With a fixed set of sixteen distances every
  // pixel along a caster's edge finds its first blocker at the same step, which
  // is what draws the shade as concentric bands; starting each pixel a fraction
  // of a step in turns those bands into a fine stipple the blur can smooth.
  // Keyed on world position, so the pattern is fixed to the ground rather than
  // crawling with the camera.
  float jitter = fract(sin(dot(p.xz * 12.9898 + p.y * 78.233, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < 16; i++) {
    // The contact scale is a few metres: long enough to catch a hull, short
    // enough that the result stays attached to the ground under it.
    float t = (float(i) + jitter) * 0.28;
    vec3 q = origin + sunDir * t;
    vec4 clip = projectWorld(q);
    vec2 uv = clip.xy * 0.5 + 0.5;
    if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) break;
    float sceneDepth = texture(uDepth, uv).r;
    if (sceneDepth >= 0.99999) continue;
    // Compare in world units so the thickness means the same thing at every
    // zoom. A soft near and far limit keeps the contact patch from ending in a
    // hard, sparkling rim.
    float away = linearDepth(clip.z * 0.5 + 0.5) - linearDepth(sceneDepth);
    if (away > 0.18 && away < 2.4) {
      float nearFade = smoothstep(0.18, 0.55, away);
      float farFade = 1.0 - smoothstep(1.8, 2.4, away);
      occluded = max(occluded, nearFade * farFade);
    }
  }
  outColor = vec4(vec3(1.0 - occluded), 1.0);
}
`;

const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uAO;
uniform sampler2D uContact;
uniform float uAOStrength;
uniform float uContactStrength;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uVignette;
out vec4 outColor;
${ACES}
void main() {
  vec3 color = texture(uScene, vUv).rgb;
  float ao = mix(1.0, texture(uAO, vUv).r, uAOStrength);
  float contact = mix(1.0, texture(uContact, vUv).r, uContactStrength);
  color *= ao * contact;
  color += texture(uBloom, vUv).rgb * uBloomStrength;
  color *= uExposure;
  color = acesFilm(color);
  vec2 q = vUv - 0.5;
  float vignette = 1.0 - smoothstep(0.55, 1.0, length(q) * 1.45);
  color *= mix(1.0, vignette, uVignette);
  outColor = vec4(color, 1.0);
}
`;

export interface PostOptions {
  exposure: number;
  bloom: number;
  vignette: number;
  /** 0 turns the AO pass off; 1 applies its full darkening. */
  ao: number;
  /** 0 turns the directional contact-shadow pass off; 1 is full shade. */
  contact: number;
}

/**
 * Scene target and post chain for the battlefield.
 *
 * The renderer used to submit every surface straight to the default framebuffer.
 * That made highlights clamp at 1.0 and left effects with no way to bloom. This
 * keeps the forward passes unchanged but resolves them through an HDR target,
 * then a bright/blur/composite chain, before the browser sees the frame.
 *
 * RGBA16F is used when the browser can render to it; otherwise the same chain
 * runs on RGBA8. An MSAA target is attempted first and falls back to a
 * single-sample target if the driver rejects the combination.
 */
export class PostPipeline {
  options: PostOptions = { exposure: 0.72, bloom: 0.5, vignette: 0.08, ao: 0.6, contact: 0.55 };

  private brightProgram: WebGLProgram;
  private blurProgram: WebGLProgram;
  private aoBlurProgram: WebGLProgram;
  private compositeProgram: WebGLProgram;
  private aoProgram: WebGLProgram;
  private contactProgram: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private sceneFbo: WebGLFramebuffer | null = null;
  private sceneMsaaFbo: WebGLFramebuffer | null = null;
  private sceneMsaaColor: WebGLRenderbuffer | null = null;
  private sceneMsaaDepth: WebGLRenderbuffer | null = null;
  private resolveFbo: WebGLFramebuffer | null = null;
  private resolveColor: WebGLTexture | null = null;
  /**
   * Resolved scene depth, sampled by the AO pass. The MSAA target owns a
   * renderbuffer instead; its depth is blitted here once per frame.
   */
  private resolveDepth: WebGLTexture | null = null;
  private bloomFboA: WebGLFramebuffer | null = null;
  private bloomFboB: WebGLFramebuffer | null = null;
  private bloomA: WebGLTexture | null = null;
  private bloomB: WebGLTexture | null = null;
  private aoFboA: WebGLFramebuffer | null = null;
  private aoFboB: WebGLFramebuffer | null = null;
  private aoA: WebGLTexture | null = null;
  private aoB: WebGLTexture | null = null;
  private contactFboA: WebGLFramebuffer | null = null;
  private contactFboB: WebGLFramebuffer | null = null;
  private contactA: WebGLTexture | null = null;
  private contactB: WebGLTexture | null = null;
  /** Previous resolved scene, sampled by the water reflection march. */
  private reflectionSource: WebGLTexture | null = null;
  private reflectionDepthSource: WebGLTexture | null = null;
  private reflectionFbo: WebGLFramebuffer | null = null;

  private eye: [number, number, number] = [0, 0, 0];
  private right: [number, number, number] = [1, 0, 0];
  private up: [number, number, number] = [0, 1, 0];
  private forward: [number, number, number] = [0, 0, -1];
  private halfW = 1;
  private halfH = 1;
  private near = 1;
  private far = 3000;
  private sun: [number, number, number] = [0.45, 0.82, 0.35];

  private width = 0;
  private height = 0;
  private bloomWidth = 0;
  private bloomHeight = 0;
  private samples = 0;
  private internalFormat = 0;
  private texelType = 0;

  private readonly brightUniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly blurUniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly aoBlurUniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly compositeUniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly aoUniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly contactUniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(private gl: WebGL2RenderingContext) {
    this.brightProgram = createProgram(gl, FULLSCREEN_VS, BRIGHT_FS);
    this.blurProgram = createProgram(gl, FULLSCREEN_VS, BLUR_FS);
    this.aoBlurProgram = createProgram(gl, FULLSCREEN_VS, AO_BLUR_FS);
    this.compositeProgram = createProgram(gl, FULLSCREEN_VS, COMPOSITE_FS);
    this.aoProgram = createProgram(gl, FULLSCREEN_VS, AO_FS);
    this.contactProgram = createProgram(gl, FULLSCREEN_VS, CONTACT_FS);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to create post-process VAO.');
    this.vao = vao;

    for (const name of ['uScene', 'uThreshold']) {
      this.brightUniforms[name] = gl.getUniformLocation(this.brightProgram, name);
    }
    for (const name of ['uSource', 'uDirection']) {
      this.blurUniforms[name] = gl.getUniformLocation(this.blurProgram, name);
    }
    for (const name of [
      'uSource', 'uDepth', 'uDirection', 'uNear', 'uFar', 'uDepthTolerance',
    ]) {
      this.aoBlurUniforms[name] = gl.getUniformLocation(this.aoBlurProgram, name);
    }
    for (const name of ['uScene', 'uBloom', 'uAO', 'uContact', 'uAOStrength', 'uContactStrength', 'uExposure', 'uBloomStrength', 'uVignette']) {
      this.compositeUniforms[name] = gl.getUniformLocation(this.compositeProgram, name);
    }
    for (const name of [
      'uDepth', 'uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar', 'uSun',
    ]) {
      this.contactUniforms[name] = gl.getUniformLocation(this.contactProgram, name);
    }
    for (const name of [
      'uDepth', 'uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar',
      'uRadius', 'uBias', 'uIntensity',
    ]) {
      this.aoUniforms[name] = gl.getUniformLocation(this.aoProgram, name);
    }

    const floatTarget =
      gl.getExtension('EXT_color_buffer_float') ??
      gl.getExtension('EXT_color_buffer_half_float');
    this.internalFormat = floatTarget ? gl.RGBA16F : gl.RGBA8;
    this.texelType = floatTarget ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
    this.samples = Number.isFinite(maxSamples) ? Math.min(4, Math.max(0, maxSamples)) : 0;
  }

  /** Previous resolved scene, for the water reflection march. */
  get reflectionTexture(): WebGLTexture | null {
    return this.reflectionSource;
  }

  /** Previous frame's resolved depth, paired with `reflectionTexture`. */
  get reflectionDepth(): WebGLTexture | null {
    return this.reflectionDepthSource;
  }

  /** Direction toward the sun, used for the directional contact-shadow march. */
  setSun(sun: [number, number, number]): void {
    this.sun = [sun[0], sun[1], sun[2]];
  }

  /** Camera state the AO pass needs to reconstruct world positions from depth. */
  setCamera(camera: Camera, near: number, far: number): void {
    this.eye = [camera.eye[0], camera.eye[1], camera.eye[2]];
    this.right = [camera.right[0], camera.right[1], camera.right[2]];
    this.up = [camera.up[0], camera.up[1], camera.up[2]];
    this.forward = [camera.forward[0], camera.forward[1], camera.forward[2]];
    this.halfW = camera.halfW;
    this.halfH = camera.halfH;
    this.near = near;
    this.far = far;
  }

  /** Rebuild the render targets for the canvas drawing-buffer size. */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.bloomWidth = Math.max(1, Math.floor(w / 2));
    this.bloomHeight = Math.max(1, Math.floor(h / 2));
    this.destroyTargets();
    this.createTargets();
  }

  /** Bind the HDR scene target. The caller clears and draws the normal passes. */
  begin(): void {
    if (!this.sceneFbo || !this.resolveFbo) this.resize(this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
    this.bindScene();
    const gl = this.gl;
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
  }

  /** Return to the scene target after an intermediate pass (shadow, occlusion). */
  bindScene(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneMsaaFbo ?? this.sceneFbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  /**
   * Resolve the scene, build the bloom, and tone-map to the default framebuffer.
   *
   * The scene is drawn into the multisampled target when one exists. Resolving
   * is a colour blit: depth is not consumed by the post chain, so there is no
   * reason to pay for a second full-size depth resolve.
   */
  end(): void {
    const gl = this.gl;
    if (
      !this.resolveFbo || !this.resolveColor || !this.resolveDepth ||
      !this.bloomFboA || !this.bloomFboB || !this.bloomA ||
      !this.aoFboA || !this.aoFboB || !this.aoA || !this.aoB ||
      !this.contactFboA || !this.contactFboB || !this.contactA || !this.contactB
    ) return;

    if (this.sceneMsaaFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneMsaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
      gl.blitFramebuffer(
        0, 0, this.width, this.height,
        0, 0, this.width, this.height,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      // The AO pass reconstructs world positions from depth, so the MSAA depth
      // has to be resolved too. Both attachments are DEPTH_COMPONENT24.
      gl.blitFramebuffer(
        0, 0, this.width, this.height,
        0, 0, this.width, this.height,
        gl.DEPTH_BUFFER_BIT,
        gl.NEAREST,
      );
    }

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);

    // Bloom is a separate switch from AO and the water reflection. Turning it
    // off skips the bright-pass and both blur passes, not just the mix.
    const bloomEnabled = this.options.bloom > 0.001;
    if (bloomEnabled) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFboA);
      gl.viewport(0, 0, this.bloomWidth, this.bloomHeight);
      gl.useProgram(this.brightProgram);
      this.bindTexture(0, this.resolveColor, this.brightUniforms.uScene);
      gl.uniform1f(this.brightUniforms.uThreshold, 0.82);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFboB);
      gl.useProgram(this.blurProgram);
      this.bindTexture(0, this.bloomA, this.blurUniforms.uSource);
      gl.uniform2f(this.blurUniforms.uDirection, 1 / this.bloomWidth, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFboA);
      this.bindTexture(0, this.bloomB, this.blurUniforms.uSource);
      gl.uniform2f(this.blurUniforms.uDirection, 0, 1 / this.bloomHeight);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Ambient occlusion at full resolution, then one separable blur to turn
    // the eight-sample kernel into a soft contact shadow instead of grain.
    const aoEnabled = this.options.ao > 0.001;
    if (aoEnabled) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoFboA);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.aoProgram);
      this.bindTexture(0, this.resolveDepth, this.aoUniforms.uDepth);
      gl.uniform3fv(this.aoUniforms.uEye, this.eye);
      gl.uniform3fv(this.aoUniforms.uRight, this.right);
      gl.uniform3fv(this.aoUniforms.uUp, this.up);
      gl.uniform3fv(this.aoUniforms.uForward, this.forward);
      gl.uniform2f(this.aoUniforms.uHalf, this.halfW, this.halfH);
      gl.uniform1f(this.aoUniforms.uNear, this.near);
      gl.uniform1f(this.aoUniforms.uFar, this.far);
      gl.uniform1f(this.aoUniforms.uRadius, 2.6);
      gl.uniform1f(this.aoUniforms.uBias, 0.08);
      gl.uniform1f(this.aoUniforms.uIntensity, 1.15);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.useProgram(this.aoBlurProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoFboB);
      this.bindTexture(0, this.aoA, this.aoBlurUniforms.uSource);
      this.bindTexture(1, this.resolveDepth, this.aoBlurUniforms.uDepth);
      gl.uniform1f(this.aoBlurUniforms.uNear, this.near);
      gl.uniform1f(this.aoBlurUniforms.uFar, this.far);
      gl.uniform1f(this.aoBlurUniforms.uDepthTolerance, 2.4);
      gl.uniform2f(this.aoBlurUniforms.uDirection, 1.5 / this.width, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoFboA);
      this.bindTexture(0, this.aoB, this.aoBlurUniforms.uSource);
      this.bindTexture(1, this.resolveDepth, this.aoBlurUniforms.uDepth);
      gl.uniform2f(this.aoBlurUniforms.uDirection, 0, 1.5 / this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Directional contact shadows: a short march from the visible surface
    // toward the sun, blurred once so the patch under a hull reads as shade
    // rather than a hard silhouette of the depth buffer.
    const contactEnabled = this.options.contact > 0.001;
    if (contactEnabled) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.contactFboA);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.contactProgram);
      this.bindTexture(0, this.resolveDepth, this.contactUniforms.uDepth);
      gl.uniform3fv(this.contactUniforms.uEye, this.eye);
      gl.uniform3fv(this.contactUniforms.uRight, this.right);
      gl.uniform3fv(this.contactUniforms.uUp, this.up);
      gl.uniform3fv(this.contactUniforms.uForward, this.forward);
      gl.uniform2f(this.contactUniforms.uHalf, this.halfW, this.halfH);
      gl.uniform1f(this.contactUniforms.uNear, this.near);
      gl.uniform1f(this.contactUniforms.uFar, this.far);
      gl.uniform3fv(this.contactUniforms.uSun, this.sun);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Use the same depth-aware blur as AO. A plain Gaussian lets the hard
      // binary ray hit smear across a silhouette, which reads as a dark patch
      // switching on and off as the camera moves.
      gl.useProgram(this.aoBlurProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.contactFboB);
      this.bindTexture(0, this.contactA, this.aoBlurUniforms.uSource);
      this.bindTexture(1, this.resolveDepth, this.aoBlurUniforms.uDepth);
      gl.uniform1f(this.aoBlurUniforms.uNear, this.near);
      gl.uniform1f(this.aoBlurUniforms.uFar, this.far);
      gl.uniform1f(this.aoBlurUniforms.uDepthTolerance, 2.4);
      gl.uniform2f(this.aoBlurUniforms.uDirection, 2.2 / this.width, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.contactFboA);
      this.bindTexture(0, this.contactB, this.aoBlurUniforms.uSource);
      this.bindTexture(1, this.resolveDepth, this.aoBlurUniforms.uDepth);
      gl.uniform2f(this.aoBlurUniforms.uDirection, 0, 2.2 / this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.compositeProgram);
    this.bindTexture(0, this.resolveColor, this.compositeUniforms.uScene);
    this.bindTexture(1, this.bloomA, this.compositeUniforms.uBloom);
    this.bindTexture(2, this.aoA, this.compositeUniforms.uAO);
    this.bindTexture(3, this.contactA, this.compositeUniforms.uContact);
    gl.uniform1f(this.compositeUniforms.uAOStrength, aoEnabled ? this.options.ao : 0);
    gl.uniform1f(
      this.compositeUniforms.uContactStrength,
      contactEnabled ? this.options.contact : 0,
    );
    gl.uniform1f(this.compositeUniforms.uExposure, this.options.exposure);
    gl.uniform1f(this.compositeUniforms.uBloomStrength, this.options.bloom);
    gl.uniform1f(this.compositeUniforms.uVignette, this.options.vignette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Keep this frame's resolved scene and depth for next frame's water
    // reflections. A blit moves both without sampling the target the water
    // will read, so the single-sample path has no feedback loop either.
    if (this.reflectionFbo && this.reflectionSource && this.reflectionDepthSource) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.resolveFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.reflectionFbo);
      gl.blitFramebuffer(
        0, 0, this.width, this.height,
        0, 0, this.width, this.height,
        gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  dispose(): void {
    const gl = this.gl;
    this.destroyTargets();
    gl.deleteProgram(this.brightProgram);
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.aoBlurProgram);
    gl.deleteProgram(this.compositeProgram);
    gl.deleteProgram(this.aoProgram);
    gl.deleteProgram(this.contactProgram);
    gl.deleteVertexArray(this.vao);
  }

  private bindTexture(unit: number, texture: WebGLTexture | null, sampler: WebGLUniformLocation | null): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(sampler, unit);
  }

  private createTargets(): void {
    const gl = this.gl;
    this.resolveFbo = gl.createFramebuffer();
    this.resolveColor = this.makeColorTexture(this.width, this.height);
    this.resolveDepth = this.makeDepthTexture(this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.resolveColor, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.resolveDepth, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    this.sceneFbo = this.resolveFbo;
    if (this.samples > 1 && this.makeMultisampleTarget()) {
      this.sceneFbo = this.sceneMsaaFbo;
    }

    this.bloomA = this.makeColorTexture(this.bloomWidth, this.bloomHeight);
    this.bloomB = this.makeColorTexture(this.bloomWidth, this.bloomHeight);
    this.bloomFboA = this.makeAttachment(this.bloomA);
    this.bloomFboB = this.makeAttachment(this.bloomB);

    this.createAOTargets();
    this.createContactTargets();

    this.reflectionSource = this.makeColorTexture(this.width, this.height);
    this.reflectionDepthSource = this.makeDepthTexture(this.width, this.height);
    this.reflectionFbo = this.makeAttachment(this.reflectionSource);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.reflectionFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      this.reflectionDepthSource,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** AO is a single channel in RGBA8; it never needs an HDR target. */
  private createAOTargets(): void {
    const gl = this.gl;
    this.aoA = this.makeColorTexture(this.width, this.height, gl.RGBA8, gl.UNSIGNED_BYTE);
    this.aoB = this.makeColorTexture(this.width, this.height, gl.RGBA8, gl.UNSIGNED_BYTE);
    this.aoFboA = this.makeAttachment(this.aoA);
    this.aoFboB = this.makeAttachment(this.aoB);
  }

  private createContactTargets(): void {
    const gl = this.gl;
    this.contactA = this.makeColorTexture(this.width, this.height, gl.RGBA8, gl.UNSIGNED_BYTE);
    this.contactB = this.makeColorTexture(this.width, this.height, gl.RGBA8, gl.UNSIGNED_BYTE);
    this.contactFboA = this.makeAttachment(this.contactA);
    this.contactFboB = this.makeAttachment(this.contactB);
  }

  private makeMultisampleTarget(): boolean {
    const gl = this.gl;
    this.sceneMsaaFbo = gl.createFramebuffer();
    this.sceneMsaaColor = gl.createRenderbuffer();
    this.sceneMsaaDepth = gl.createRenderbuffer();
    if (!this.sceneMsaaFbo || !this.sceneMsaaColor || !this.sceneMsaaDepth) return false;

    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneMsaaColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, this.internalFormat, this.width, this.height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneMsaaDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, this.width, this.height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneMsaaFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.sceneMsaaColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneMsaaDepth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) return true;

    gl.deleteFramebuffer(this.sceneMsaaFbo);
    gl.deleteRenderbuffer(this.sceneMsaaColor);
    gl.deleteRenderbuffer(this.sceneMsaaDepth);
    this.sceneMsaaFbo = null;
    this.sceneMsaaColor = null;
    this.sceneMsaaDepth = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return false;
  }

  private makeColorTexture(
    width: number,
    height: number,
    internalFormat = this.internalFormat,
    texelType = this.texelType,
  ): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Unable to create post-process texture.');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      gl.RGBA,
      texelType,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private makeDepthTexture(width: number, height: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Unable to create post-process depth texture.');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      width,
      height,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private makeAttachment(texture: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('Unable to create post-process framebuffer.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    return fbo;
  }

  private destroyTargets(): void {
    const gl = this.gl;
    if (this.sceneMsaaFbo) gl.deleteFramebuffer(this.sceneMsaaFbo);
    if (this.sceneMsaaColor) gl.deleteRenderbuffer(this.sceneMsaaColor);
    if (this.sceneMsaaDepth) gl.deleteRenderbuffer(this.sceneMsaaDepth);
    if (this.resolveFbo) gl.deleteFramebuffer(this.resolveFbo);
    if (this.resolveColor) gl.deleteTexture(this.resolveColor);
    if (this.resolveDepth) gl.deleteTexture(this.resolveDepth);
    if (this.bloomFboA) gl.deleteFramebuffer(this.bloomFboA);
    if (this.bloomFboB) gl.deleteFramebuffer(this.bloomFboB);
    if (this.bloomA) gl.deleteTexture(this.bloomA);
    if (this.bloomB) gl.deleteTexture(this.bloomB);
    this.destroyAOTargets();
    this.destroyContactTargets();
    if (this.reflectionFbo) gl.deleteFramebuffer(this.reflectionFbo);
    if (this.reflectionSource) gl.deleteTexture(this.reflectionSource);
    if (this.reflectionDepthSource) gl.deleteTexture(this.reflectionDepthSource);
    this.sceneMsaaFbo = null;
    this.sceneMsaaColor = null;
    this.sceneMsaaDepth = null;
    this.resolveFbo = null;
    this.resolveColor = null;
    this.resolveDepth = null;
    this.bloomFboA = null;
    this.bloomFboB = null;
    this.bloomA = null;
    this.bloomB = null;
    this.reflectionFbo = null;
    this.reflectionSource = null;
    this.reflectionDepthSource = null;
    this.sceneFbo = null;
  }

  private destroyAOTargets(): void {
    const gl = this.gl;
    if (this.aoFboA) gl.deleteFramebuffer(this.aoFboA);
    if (this.aoFboB) gl.deleteFramebuffer(this.aoFboB);
    if (this.aoA) gl.deleteTexture(this.aoA);
    if (this.aoB) gl.deleteTexture(this.aoB);
    this.aoFboA = null;
    this.aoFboB = null;
    this.aoA = null;
    this.aoB = null;
  }

  private destroyContactTargets(): void {
    const gl = this.gl;
    if (this.contactFboA) gl.deleteFramebuffer(this.contactFboA);
    if (this.contactFboB) gl.deleteFramebuffer(this.contactFboB);
    if (this.contactA) gl.deleteTexture(this.contactA);
    if (this.contactB) gl.deleteTexture(this.contactB);
    this.contactFboA = null;
    this.contactFboB = null;
    this.contactA = null;
    this.contactB = null;
  }
}
