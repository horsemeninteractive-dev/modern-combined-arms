import { MATERIAL } from './materials';

const CAMERA = /* glsl */ `
uniform vec3 uEye;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform vec2 uHalf;
uniform float uNear;
uniform float uFar;
vec4 projectWorld(vec3 world) {
  vec3 rel = world - uEye;
  float x = dot(rel, uRight) / uHalf.x;
  float y = dot(rel, uUp) / uHalf.y;
  float z = ((dot(rel, uForward) - uNear) / (uFar - uNear)) * 2.0 - 1.0;
  return vec4(x, y, z, 1.0);
}
`;

/**
 * Fog field shared by every world-space fragment shader.
 *
 * The mask is uploaded every third tick, so a single texture made the vision
 * boundary step on that cadence. Two fields — the previous upload and the new
 * one — are cross-faded by uFogBlend, which the renderer ramps across exactly
 * one fog interval. The three authored fog states are preserved: 255 is
 * visible, 112 is charted but not watched, 0 has never been seen.
 *
 * Charted ground is desaturated and cooled rather than only darkened, so
 * remembered terrain reads as memory instead of as night. `uWorldSize` lives
 * here because every shader that samples this field is world-projected.
 */
const FOG_FIELD = /* glsl */ `
uniform sampler2D uFogTex;
uniform sampler2D uFogTexOld;
uniform float uFogBlend;
uniform vec2 uWorldSize;

float fogField(vec2 uv) {
  return mix(texture(uFogTexOld, uv).r, texture(uFogTex, uv).r, uFogBlend);
}
float fogSeen(float fog) {
  return smoothstep(0.66, 0.94, fog);
}
float fogCharted(float fog) {
  return smoothstep(0.12, 0.50, fog);
}
vec3 chartedTone(vec3 lit) {
  float luma = dot(lit, vec3(0.299, 0.587, 0.114));
  vec3 cool = luma * vec3(0.72, 0.84, 1.06);
  return mix(vec3(luma), cool, 0.62) * 0.50 + vec3(0.010, 0.019, 0.031);
}
vec3 applyFog(vec3 lit, float fog) {
  vec3 unseen = vec3(0.012, 0.027, 0.038);
  vec3 seen = mix(unseen, chartedTone(lit), fogCharted(fog));
  return mix(seen, lit, fogSeen(fog));
}
`;

/**
 * Aerial perspective.
 *
 * Fog of war answers "may I know this is here"; haze answers "how far away is
 * it", and the two are different questions. Every lit surface fades toward the
 * weather's own air colour with distance, measured from the camera eye, so the
 * far side of a foggy map genuinely disappears into the murk while the ground a
 * scout is standing on stays legible. It is one exp per fragment and it is what
 * turns the weather from a tint into a volume.
 */
const HAZE_GLSL = /* glsl */ `
uniform vec3 uHazeColor;
uniform float uHaze;
/**
 * Distance from the eye to the camera's focus point, in world units.
 *
 * The camera is orthographic and sits far back along its own view axis, so raw
 * distance from the eye is nearly the same for every fragment on screen — haze
 * measured that way replaced the whole view with the air colour instead of
 * fading the far edge. Measuring *past* the focus point instead keeps the
 * ground under the crosshair clear, pushes the wash toward the horizon of the
 * view, and behaves the same at every zoom level.
 */
uniform float uHazeRef;

vec3 applyHaze(vec3 col, vec3 world) {
  if (uHaze < 0.0001) return col;
  float d = max(0.0, length(world - uEye) - uHazeRef);
  // Exponential extinction, saturated so a very thick profile cannot overflow.
  return mix(col, uHazeColor, clamp(1.0 - exp(-d * uHaze), 0.0, 0.97));
}
`;

export const MESH_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in float aTeam;
layout(location=4) in float aWind;
layout(location=5) in vec2 aUv;
layout(location=6) in float aTexMask;
layout(location=7) in float aMaterial;
uniform mat4 uModel;
uniform float uTime;
/** World units pulled toward the eye for the occluded-unit silhouette pass. */
uniform float uDepthPull;
${CAMERA}
out vec3 vNormal;
out vec3 vColor;
out float vTeam;
out vec2 vUv;
out float vTexMask;
out float vWind;
out vec3 vWorld;
out vec3 vLocal;
out float vMaterial;
void main() {
  // Only flag cloth carries wind. Every other mesh leaves the attribute at its
  // default zero, so this branch is a no-op for buildings, units and props.
  vec3 p = aPos;
  float wind = clamp(aWind, 0.0, 1.0);
  if (wind > 0.001) {
    float phase = uTime * 3.6 + p.x * 2.4 + p.y * 0.9;
    p.z += sin(phase) * 0.22 * wind;
    p.y += cos(phase * 0.72 + 0.6) * 0.06 * wind;
    p.x += sin(phase * 0.5 + 1.0) * 0.08 * wind;
  }
  vec4 world = uModel * vec4(p, 1.0);
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vTeam = aTeam;
  vUv = aUv;
  vTexMask = aTexMask;
  vWind = wind;
  vWorld = world.xyz;
  vLocal = aPos;
  vMaterial = aMaterial;
  vec4 clip = projectWorld(world.xyz);
  // The silhouette pass draws with a GREATER depth test. Pulling it toward the
  // camera in view depth only — never on screen, the projection is orthographic
  // — passes just where a surface sits directly in front of the unit, so a
  // building occludes it but a ridge further down the view does not.
  clip.z -= (2.0 * uDepthPull) / (uFar - uNear);
  gl_Position = clip;
}
`;

export const MESH_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in float vTeam;
in vec2 vUv;
in float vTexMask;
in float vWind;
in vec3 vWorld;
in vec3 vLocal;
in float vMaterial;
uniform vec3 uTeamColor;
uniform vec3 uSun;
uniform vec3 uEye;
uniform vec3 uTint;
uniform float uAmbient;
/** Global time-of-day grade: warm at dusk, cool and dim at night. */
uniform vec3 uTone;
uniform float uAlpha;
uniform float uFlash;
/**
 * How strongly a structure's own glazing is lit from inside, 0 by day. Only the
 * mesh pass reads it, and the renderer raises it for buildings alone so a
 * vehicle windscreen never glows like an office window.
 */
uniform float uNightGlow;
uniform sampler2D uFlagTex;
uniform sampler2D uMatLut;
uniform float uUseFog;
/** 1 while drawing the occluded-unit silhouette pass. */
uniform float uSilhouette;
${FOG_FIELD}
${HAZE_GLSL}
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Triplanar noise avoids UV seams and works on every hand-authored box,
// cylinder and faceted shell without adding tangents or a texture atlas.
float triNoise(vec3 p, vec3 n, float scale) {
  vec3 q = p * scale;
  vec3 w = pow(abs(n), vec3(4.0));
  w /= max(w.x + w.y + w.z, 0.001);
  return noise2(q.zy) * w.x + noise2(q.xz + 17.3) * w.y + noise2(q.xy + 41.7) * w.z;
}

void main() {
  // A unit hidden behind a structure keeps its shape on screen as a flat team
  // colour. Nothing is lit, textured or fogged here: the pass is a readability
  // aid, and the caller has already restricted it to units in vision.
  if (uSilhouette > 0.5) {
    outColor = vec4(uTeamColor * 0.92 + vec3(0.05, 0.07, 0.08), uAlpha);
    return;
  }
  vec3 n = normalize(vNormal);
  vec3 sunDir = normalize(uSun);
  float diffuse = max(dot(n, sunDir), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec4 mat = texture(uMatLut, vec2((floor(vMaterial + 0.5) + 0.5) / 8.0, 0.5));
  float roughness = clamp(mat.r, 0.0, 1.0);
  float metalness = clamp(mat.g, 0.0, 1.0);
  float detail = clamp(mat.b, 0.0, 1.0);
  float specular = clamp(mat.a, 0.0, 1.0);
  float materialId = floor(vMaterial + 0.5);

  vec3 base = mix(vColor, uTeamColor, clamp(vTeam, 0.0, 1.0)) * uTint;
  bool isFlag = vTexMask > 0.5 || vWind > 0.001;
  // The national flag is a real texture; the alliance flag stays a solid team
  // colour. Cloth is deliberately left untextured so a distant flag stays a
  // crisp ownership marker rather than a noisy patch.
  if (vTexMask > 0.5) base = texture(uFlagTex, vUv).rgb * uTint;

  if (!isFlag) {
    float id = materialId;
    float macro = triNoise(vWorld, n, 0.19);
    float meso = triNoise(vWorld, n, 0.62);
    float fine = triNoise(vWorld, n, 2.15);

    if (id < 0.5) {
      // Painted military metal: restrained panel break-up and a little wear.
      base *= mix(1.0, 0.85 + 0.22 * meso + 0.1 * fine, detail);
      base = mix(base, base * 1.14, smoothstep(0.72, 0.9, fine) * 0.4 * detail);
    } else if (id < 1.5) {
      // Bare steel and aluminium: directional scuffing rather than blotches.
      float brushed = noise2(vec2((vWorld.x + vWorld.z) * 3.7, vWorld.y * 0.7));
      base *= mix(1.0, 0.87 + 0.16 * brushed + 0.08 * meso, detail);
    } else if (id < 2.5) {
      // Concrete: aggregate, damp staining and rain streaks down the lower
      // walls. vLocal.y keeps the grime attached to the structure, not to sea
      // level, which matters for buildings on the plateau.
      base *= mix(1.0, 0.75 + 0.3 * meso + 0.12 * fine, detail);
      float stain = smoothstep(0.44, 0.78, macro);
      base = mix(base, base * 0.67, stain * 0.82 * detail);
      float streak = noise2(vec2((vWorld.x + vWorld.z) * 0.92, vLocal.y * 0.24 + 7.0));
      base = mix(base, base * 0.79, smoothstep(0.48, 0.8, streak) * 0.55 * detail);
      base *= mix(0.72, 1.0, smoothstep(0.0, 2.4, vLocal.y));
    } else if (id < 3.5) {
      // Asphalt: coarse aggregate and broad repairs. The carriageway stays
      // darker than the verge, which is the main road-readability cue.
      base *= mix(1.0, 0.74 + 0.24 * fine + 0.12 * meso, detail) * 0.9;
      float repaired = smoothstep(0.55, 0.86, macro);
      base = mix(base, base * 0.68, repaired * 0.65 * detail);
    } else if (id < 4.5) {
      // Rock: beds and fractures, not a smooth painted boulder.
      base *= mix(1.0, 0.7 + 0.3 * meso + 0.15 * fine, detail);
      float strata = 0.5 + 0.5 * sin(vWorld.y * 2.6 + macro * 3.0 + meso * 1.5);
      base = mix(base, base * 0.72, strata * 0.4 * detail);
    } else if (id < 5.5) {
      // Glass keeps its colour clean; the highlight does the work.
    } else if (id < 6.5) {
      // Canvas, sandbags and foliage: a soft weave rather than hard patches.
      base *= mix(1.0, 0.9 + 0.14 * meso, detail);
    } else {
      // Tracks and rubber: fine grain only. Tracks must stay dark next to the
      // hull so running gear reads as running gear.
      base *= mix(1.0, 0.86 + 0.16 * fine, detail);
    }

    // A low-frequency world-space normal bend, projected onto the surface, is
    // what turns a flat concrete or asphalt face from a colour fill into a
    // surface. The derivative is geometric, not screen-space, so it does not
    // shimmer as the camera pans. Painted metal and glass stay smooth.
    if (materialId > 1.5 && materialId < 4.5) {
      float e = 0.7;
      float h0 = triNoise(vWorld, n, 0.13);
      float hx = triNoise(vWorld + vec3(e, 0.0, 0.0), n, 0.13);
      float hy = triNoise(vWorld + vec3(0.0, e, 0.0), n, 0.13);
      float hz = triNoise(vWorld + vec3(0.0, 0.0, e), n, 0.13);
      vec3 grad = vec3(hx - h0, hy - h0, hz - h0) / e;
      float strength = materialId < 2.5 ? 1.5 : materialId < 3.5 ? 1.0 : 2.2;
      n = normalize(n - (grad - n * dot(grad, n)) * strength * detail);
      diffuse = max(dot(n, sunDir), 0.0);
      hemi = 0.5 + 0.5 * n.y;
    }
  }

  // A restrained fixed fill from the seaward side keeps shaded facades from
  // collapsing to one value; it is not screen-dependent and applies equally to
  // every mesh material.
  float fill = max(dot(n, normalize(vec3(-0.55, 0.35, 0.5))), 0.0);
  float shade = uAmbient + (1.0 - uAmbient) * diffuse * 0.9 + 0.11 * hemi + fill * 0.18;
  // Cloth faces the fixed tactical camera, which is often away from the sun.
  // Keep both flags readable without letting them glow like emissive panels.
  shade = mix(shade, max(shade, 0.78), step(0.001, vWind));
  vec3 lit = base * shade;

  if (!isFlag) {
    vec3 viewDir = normalize(uEye - vWorld);
    vec3 halfDir = normalize(sunDir + viewDir);
    float gloss = 1.0 - roughness;
    float highlight = pow(max(dot(n, halfDir), 0.0), mix(6.0, 110.0, gloss));
    lit += mix(vec3(1.0), base, 0.5) * highlight * specular * (0.08 + metalness * 0.55) * (0.3 + diffuse * 0.7);
    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 4.0);
    lit += vec3(0.2, 0.28, 0.3) * fresnel * (0.05 + gloss * 0.16) * (1.0 - metalness * 0.6);
  }

  lit *= uTone;
  lit += vec3(1.0, 0.86, 0.66) * uFlash;
  // Lit windows are the model's own glass, glowing from the inside after dark.
  // Slight facing falloff keeps a facade from reading as one flat panel.
  if (!isFlag && materialId > 4.5 && materialId < 5.5) {
    float inward = 1.0 - abs(dot(n, normalize(uEye - vWorld)));
    lit += (vec3(1.0, 0.84, 0.55) * 0.8 + base * 0.5) * uNightGlow * (0.55 + 0.45 * inward);
  }
  // Only the road pass samples fog: roads are ground features, so they are
  // known where the team has vision, cooled and desaturated where the ground
  // was charted and lost again in ground nobody has ever seen.
  float fog = uUseFog > 0.5 ? fogField(vWorld.xz / uWorldSize) : 1.0;
  // Haze first, fog of war second: aerial perspective is weather, while the
  // fog mask is knowledge. Charted and unseen ground must still read as dark,
  // so the mask always has the last word over the air.
  lit = applyHaze(lit, vWorld);
  lit = applyFog(lit, fog);
  outColor = vec4(lit, uAlpha);
}
`;

export const SHADOW_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aCenter;
layout(location=2) in vec2 aRadius;
layout(location=3) in float aRotation;
layout(location=4) in float aAlpha;
layout(location=5) in vec3 aColor;
${CAMERA}
out vec2 vLocal;
out float vAlpha;
out vec3 vColor;
void main() {
  vec2 p = aCorner * aRadius;
  float c = cos(aRotation);
  float s = sin(aRotation);
  vec2 rotated = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec3 world = aCenter + vec3(rotated.x, 0.0, rotated.y);
  vLocal = aCorner;
  vAlpha = aAlpha;
  vColor = aColor;
  gl_Position = projectWorld(world);
}
`;

export const SHADOW_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in float vAlpha;
in vec3 vColor;
uniform float uOpacity;
out vec4 outColor;
void main() {
  float d = length(vLocal);
  float soft = 1.0 - smoothstep(0.62, 1.0, d);
  float core = 1.0 - smoothstep(0.0, 0.9, d);
  float a = vAlpha * uOpacity * (0.8 * soft + 0.2 * core);
  if (a < 0.004) discard;
  outColor = vec4(vColor, a);
}
`;

export const DECAL_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aCenter;
layout(location=2) in vec2 aRadius;
layout(location=3) in float aRotation;
layout(location=4) in float aAlpha;
layout(location=5) in vec3 aColor;
layout(location=6) in float aKind;
${CAMERA}
out vec2 vLocal;
out vec3 vWorld;
out float vAlpha;
out vec3 vColor;
out float vKind;
void main() {
  vec2 p = aCorner * aRadius;
  float c = cos(aRotation);
  float s = sin(aRotation);
  vec2 rotated = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec3 world = aCenter + vec3(rotated.x, 0.0, rotated.y);
  vLocal = aCorner;
  vWorld = world;
  vAlpha = aAlpha;
  vColor = aColor;
  vKind = aKind;
  gl_Position = projectWorld(world);
}
`;

export const DECAL_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vWorld;
in float vAlpha;
in vec3 vColor;
in float vKind;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float trackMask(vec2 p) {
  // Two parallel bands, each fading over the last third of the segment so
  // consecutive decals overlap instead of reading as dashed stamps.
  float lane = abs(abs(p.y) - 0.72);
  float band = 1.0 - smoothstep(0.10, 0.26, lane);
  float ends = 1.0 - smoothstep(0.68, 1.0, abs(p.x));
  float tread = 0.9 + 0.1 * sin((vWorld.x + vWorld.z) * 7.0);
  return band * ends * tread;
}

float tyreMask(vec2 p) {
  // Narrower rubber bands than a steel track, with a fine repeating tread.
  float lane = abs(abs(p.y) - 0.74);
  float band = 1.0 - smoothstep(0.045, 0.15, lane);
  float ends = 1.0 - smoothstep(0.70, 1.0, abs(p.x));
  float tread = 0.82 + 0.18 * sin(p.x * 26.0 + (vWorld.x + vWorld.z) * 0.35);
  return band * ends * tread;
}

float scorchMask(vec2 p) {
  // World-space noise breaks the ellipse into an irregular burn with a soft
  // rim. It is deterministic for the same position, not frame-time flicker.
  float d = length(p);
  float edge = noise2(vWorld.xz * 1.15 + 7.3) * 0.24;
  float shape = 1.0 - smoothstep(0.38, 0.98, d + edge);
  float ash = 0.82 + 0.18 * noise2(vWorld.xz * 3.2 + 1.7);
  return shape * ash;
}

float craterEdge(vec2 p) {
  return noise2(vWorld.xz * 5.4 + 11.7) * 0.18;
}

float craterMask(vec2 p) {
  // A dark bowl with a broken ring of displaced earth around it. The noise
  // is sampled in world space so adjacent craters do not share a shape.
  float d = length(p);
  float edge = craterEdge(p);
  float bowl = 1.0 - smoothstep(0.20, 0.72, d + edge);
  float ring = smoothstep(0.52, 0.70, d + edge) * (1.0 - smoothstep(0.80, 1.0, d + edge));
  return max(bowl, ring * 0.72);
}

float craterRim(vec2 p) {
  float d = length(p);
  float edge = craterEdge(p);
  return smoothstep(0.52, 0.70, d + edge) * (1.0 - smoothstep(0.80, 1.0, d + edge));
}

void main() {
  float coverage;
  float rim = 0.0;
  if (vKind < 0.5) {
    coverage = trackMask(vLocal);
  } else if (vKind < 1.5) {
    coverage = scorchMask(vLocal);
  } else if (vKind < 2.5) {
    coverage = tyreMask(vLocal);
  } else {
    coverage = craterMask(vLocal);
    rim = craterRim(vLocal);
  }
  float a = coverage * vAlpha;
  if (a < 0.004) discard;

  vec3 color = vColor;
  if (vKind > 2.5) {
    color = mix(vColor, vec3(0.14, 0.12, 0.09), rim * 0.65);
  } else if (vKind >= 0.5) {
    color *= 0.9 + 0.2 * noise2(vWorld.xz * 2.1);
  }
  outColor = vec4(color, a);
}
`;

export const TERRAIN_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in vec2 aUv;
layout(location=4) in vec4 aGround;
${CAMERA}
out vec3 vNormal;
out vec3 vColor;
out vec2 vUv;
out vec3 vWorld;
out vec4 vGround;
void main() {
  vNormal = aNormal;
  vColor = aColor;
  vUv = aUv;
  vWorld = aPos;
  vGround = aGround;
  gl_Position = projectWorld(aPos);
}
`;

export const TERRAIN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec2 vUv;
in vec3 vWorld;
in vec4 vGround;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uAmbient;
uniform vec3 uTone;
uniform sampler2D uShoreTex;
uniform float uUseFog;
uniform float uTime;
uniform float uGrid;
uniform float uWet;
${FOG_FIELD}
${HAZE_GLSL}
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** Small height field used only to perturb the normal on exposed stone. */
float detailHeight(vec2 p) {
  return noise2(p * 1.35 + 3.1) * 0.62 + noise2(p * 4.1 + 11.7) * 0.38;
}

/**
 * Ground materials are a presentation layer over the simulation's terrain
 * colours. They add macro cover, worn earth and sub-tile grain without making
 * a new map type or changing movement, cover or buildability. All functions
 * are deterministic on world XZ, so a camera move can never redraw a different
 * field: there is no frame-time input here.
 */
void main() {
  vec2 p = vWorld.xz;
  vec4 g = max(vGround, vec4(0.0));
  g /= max(dot(g, vec4(1.0)), 0.0001);

  // Three cheap layers: broad ground cover, mid-scale wear, fine aggregate.
  float macro = noise2(p * 0.052) * 0.64 + noise2(p * 0.14 + 13.7) * 0.36;
  float meso = noise2(p * 0.34 + 4.2) * 0.64 + noise2(p * 0.91 + 19.1) * 0.36;
  float fine = noise2(p * 2.4 + 2.0);
  float micro = noise2(p * 5.1 + 9.0);
  // Fracture bands, used only where stone is exposed.
  float ridge = 1.0 - abs(noise2(p * 0.27 + 7.3) * 2.0 - 1.0);

  // The patch mask is domain-warped by the mid-scale layer so exposed earth
  // follows soft, irregular ground shapes instead of round blobs or a grid.
  float earthMask = smoothstep(0.44, 0.70, macro + (meso - 0.5) * 0.14);
  vec3 n = normalize(vNormal);
  // G is the land's distance from the sea, not a water mask. It lets the wet
  // band, salt line and beach apron fade inland instead of ending on the tile
  // edge with the old single-channel shore map.
  float coast = texture(uShoreTex, vUv).g;
  float damp = (1.0 - smoothstep(0.14, 0.58, vWorld.y)) * (0.42 + 0.58 * macro);
  float steep = smoothstep(0.02, 0.24, 1.0 - n.y);

  vec3 base = vColor;
  vec3 dry = mix(base, base * vec3(1.16, 0.88, 0.62), 0.72) * 0.90;
  vec3 dampSoil = mix(base, base * vec3(0.62, 0.68, 0.60), 0.65) * 0.75;
  vec3 leaf = mix(base, base * vec3(0.92, 0.82, 0.63), 0.70);
  vec3 stone = mix(base, vec3(0.46, 0.45, 0.41), 0.55);

  // Dry earth breaks through thin grass and covers open sand in broad patches.
  base = mix(base, dry, earthMask * (0.16 + 0.34 * g.y));
  // Low ground and the shore hold moisture and read darker and cooler.
  base = mix(base, dampSoil, damp * (g.y * 0.52 + g.x * 0.18 + g.w * 0.08));
  // Forest floor: leaf litter around the tree clusters.
  base = mix(base, leaf, g.z * (0.26 + 0.20 * fine));
  // Exposed rock on ridges and on the steep faces between terraces.
  float exposed = clamp(ridge * 0.55 + steep * 0.9, 0.0, 1.0);
  base = mix(base, stone, g.w * (0.16 + 0.34 * exposed) + g.y * ridge * 0.14 + steep * 0.24);
  // Bedding planes and fracture shade, so a ridge is not one flat grey mass.
  float strata = 0.5 + 0.5 * sin(vWorld.y * 2.4 + macro * 2.1 + meso * 1.3);
  vec3 bedded = mix(stone * 0.78, stone * 1.06, strata);
  base = mix(base, bedded, clamp(g.w * 0.34 + steep * 0.18, 0.0, 1.0));

  // The shoreline is a transition, not a painted line. The land-distance
  // channel comes from the same texture the water pass samples, so wet sand,
  // shell debris and the surf edge agree on where the coast is.
  float lowCoast = 1.0 - smoothstep(0.2, 1.9, vWorld.y);
  float coastWet = smoothstep(0.18, 0.82, coast) * lowCoast;
  base = mix(
    base,
    base * vec3(0.58, 0.63, 0.58) + vec3(0.012, 0.022, 0.017),
    coastWet * (0.5 + 0.25 * g.y)
  );
  // A pale shell/salt band belongs to the first metre or two, not the whole
  // beach. Dry sand keeps most of it; grass gets only a faint mineral wash.
  float saltLine = smoothstep(0.68, 0.98, coast) * (1.0 - smoothstep(0.15, 0.78, vWorld.y));
  base = mix(base, vec3(0.57, 0.55, 0.47), saltLine * (0.09 + 0.23 * g.y));
  // The beach apron is gated by the sand weight, so a grassy lake bank stays
  // green. Its irregular edge is the same fine noise used by the ground mix.
  float beach = coast * (1.0 - smoothstep(0.25, 1.15, vWorld.y));
  base = mix(
    base,
    vec3(0.49, 0.45, 0.36) * (0.86 + 0.28 * fine + 0.1 * micro),
    beach * (0.1 + 0.46 * g.y)
  );

  // Field-scale variation: a very low frequency drift over open grass, so a
  // large lawn is not one flat value. It is gated to grass cover away from
  // stone and steep faces, which have their own treatment, and it multiplies
  // the authored tile colour rather than replacing it, so roads, ore and
  // buildable ground stay readable.
  float fieldDrift = noise2(p * 0.014 + 5.3) * 0.6 + noise2(p * 0.031 + 21.4) * 0.4;
  float grassMask = clamp(g.x * (1.0 - g.w) * (1.0 - steep), 0.0, 1.0);
  base *= mix(1.0, 0.88 + 0.24 * fieldDrift, grassMask * 0.85);

  // Broad cast keeps both a map-scale gradient and a field-scale offset, so a
  // 400 px view never lands on a flat patch of one value. Aggregate is the
  // sub-tile layer.
  float broad = 0.93 + macro * 0.16 + (meso - 0.5) * 0.24;
  float aggregate = 1.0 + (fine - 0.5) * 0.09 + (micro - 0.5) * 0.045;
  base *= broad * aggregate;

  // A world-space height gradient perturbs the normal only on stone. This is
  // stable under camera motion (no screen derivatives) and gives ridge faces
  // relief that a flat vertex normal cannot carry.
  float rockMask = clamp(g.w * 0.95 + steep * 0.75, 0.0, 1.0);
  if (rockMask > 0.01) {
    float e = 0.18;
    float h0 = detailHeight(p);
    float hx = detailHeight(p + vec2(e, 0.0));
    float hz = detailHeight(p + vec2(0.0, e));
    vec2 grad = vec2((hx - h0) / e, (hz - h0) / e);
    n = normalize(vec3(n.x - grad.x * 0.13 * rockMask, n.y, n.z - grad.y * 0.13 * rockMask));
  }

  // Construction guidance only; ordinary play leaves uGrid at 0.
  vec2 cell = abs(fract(p / 4.0) - 0.5);
  float edge = smoothstep(0.46, 0.5, max(cell.x, cell.y));
  base *= 1.0 - edge * 0.14 * uGrid;

  // Wet ground. Rain does not paint the whole field one colour: it darkens and
  // cools what it lands on, and pools in the hollows. Both come from the same
  // noise field already used for ground cover, so a puddle sits in the low
  // patch the eye already reads as damp and the sheen follows it there.
  float puddle = 0.0;
  if (uWet > 0.001) {
    puddle = smoothstep(0.5, 0.74, noise2(p * 0.19 + 31.7) * 0.7 + noise2(p * 0.66 + 3.3) * 0.3);
    puddle *= uWet;
    vec3 soaked = base * vec3(0.55, 0.6, 0.65) + vec3(0.006, 0.013, 0.02);
    // Slopes shed water and keep their stone; hollows and grass take it.
    float soak = uWet * (0.30 + 0.26 * (1.0 - steep)) * (1.0 - rockMask * 0.45);
    base = mix(base, soaked, soak);
    base = mix(base, soaked * 0.78, puddle * 0.6);
  }

  float diffuse = max(dot(n, normalize(uSun)), 0.0);
  vec3 lit = base * (uAmbient + (1.0 - uAmbient) * diffuse * 0.88 + 0.06 * n.y);
  // Standing water is a mirror: a broad, low-power highlight over the whole
  // soaked field, tightening to a hard sun-glint on the puddles themselves.
  if (uWet > 0.001) {
    vec3 viewDir = normalize(uEye - vWorld);
    vec3 halfDir = normalize(normalize(uSun) + viewDir);
    float sheen = pow(max(dot(n, halfDir), 0.0), 28.0) * uWet * 0.34;
    float glint = pow(max(dot(n, halfDir), 0.0), 140.0) * puddle * 1.5;
    // Grazing angles catch far more of the sky than a top-down look does.
    float grazing = 1.0 - abs(viewDir.y);
    vec3 sky = mix(vec3(0.34, 0.40, 0.46), vec3(0.62, 0.68, 0.74), diffuse);
    lit += (sky * (sheen + glint * 1.4) + vec3(1.0, 0.97, 0.9) * glint * 0.35) * (0.35 + 0.65 * grazing);
    // A wet surface is a darker diffuse body even where the sun does not glint.
    lit *= 1.0 - 0.1 * uWet * (1.0 - grazing);
  }
  lit *= uTone;
  float fog = uUseFog > 0.5 ? fogField(vUv) : 1.0;
  lit = applyHaze(lit, vWorld);
  lit = applyFog(lit, fog);
  outColor = vec4(lit, 1.0);
}
`;

/**
 * Sea state, shared by both water stages.
 *
 * The height field is one function of world position, time and sea state. The
 * vertex stage samples it to move the surface, the fragment stage takes its
 * finite differences for the normal, so the shape the eye sees and the slope
 * the light bounces off can never disagree. `sea` scales each octave by a
 * different amount: a storm does not just lift the long swell, it breaks the
 * surface into short chop, which is what actually reads as heavy water.
 */
const SEA_GLSL = /* glsl */ `
float wave(vec2 p, float t) {
  return sin(p.x * 0.55 + t * 0.8) * 0.5 + sin(p.y * 0.7 - t * 0.63) * 0.5
       + sin((p.x + p.y) * 0.33 + t * 0.4) * 0.25;
}

float seaSurface(vec2 p, float t, float sea) {
  float swell = wave(p * 0.14, t) * 0.6;
  float ridge = wave(p * 0.43 + 7.0, t * 1.35) * 0.28;
  float chop = wave(p * 1.15 - 3.0, t * 1.8) * 0.12;
  return swell * (0.7 + 1.1 * sea) + ridge * (0.8 + 1.6 * sea) + chop * (0.9 + 2.2 * sea);
}
`;

export const WATER_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform vec2 uWorldSize;
uniform float uTime;
uniform float uSea;
uniform sampler2D uShoreTex;
${CAMERA}
${SEA_GLSL}
out vec3 vWorld;
out vec2 vUv;
void main() {
  vec2 uv = aPos.xz / uWorldSize;
  vUv = uv;
  // Only the open water carries the swell. The shelf is flat, so the surf line
  // stays against the beach instead of riding up it in a storm.
  float shallowness = texture(uShoreTex, uv).r;
  float openSea = 1.0 - smoothstep(0.3, 0.86, shallowness);
  float height = seaSurface(aPos.xz, uTime, uSea) * openSea * (0.16 + 0.52 * uSea);
  vec3 displaced = vec3(aPos.x, aPos.y + height, aPos.z);
  vWorld = displaced;
  gl_Position = projectWorld(displaced);
}
`;

export const WATER_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld;
in vec2 vUv;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uTime;
uniform float uAmbient;
uniform vec3 uTone;
uniform sampler2D uShoreTex;
uniform float uUseFog;
uniform float uSea;
${FOG_FIELD}
${HAZE_GLSL}
${SEA_GLSL}
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  // R is shallowness, B is the water's distance from land. The two together
  // separate the shallow shelf from the surf line without a painted mask.
  vec3 shoreField = texture(uShoreTex, vUv).rgb;
  float shallowness = shoreField.r;
  float coast = shoreField.b;
  float t = uTime;
  vec2 p = vWorld.xz;
  float e = 0.4;
  float h0 = seaSurface(p, t, uSea);
  float hx = seaSurface(p + vec2(e, 0.0), t, uSea);
  float hz = seaSurface(p + vec2(0.0, e), t, uSea);
  vec2 grad = vec2((hx - h0) / e, (hz - h0) / e);
  // A heavy sea is not only taller, it is steeper: the same slope in a rising
  // swell catches the sun far harder than a lazy one does.
  float steepness = 3.2 * (0.85 + 0.75 * uSea);
  vec3 n = normalize(vec3(-grad.x * steepness, 1.0, -grad.y * steepness));
  // Fine chop breaks the long swell into water rather than a printed gradient.
  // Its two terms are animated in opposite directions so the pattern does not
  // sit still under the camera.
  n.x += (noise2(p * 1.7 + vec2(t * 0.12, 0.0)) - 0.5) * 0.12;
  n.z += (noise2(p * 1.9 - vec2(0.0, t * 0.1)) - 0.5) * 0.12;
  n = normalize(n);
  vec3 viewDir = normalize(uEye - vWorld);
  vec3 sunDir = normalize(uSun);

  float depth = smoothstep(0.12, 0.96, shallowness);
  // "depth" here is the shallowness weight the shelf field carries, so open
  // water is its complement. The seaway belongs to open water: a breaking swell
  // is a deep-water phenomenon, and keeping it off the shelf is also what keeps
  // the surf line where the beach is.
  float openSea = 1.0 - depth;
  vec3 deep = vec3(0.035, 0.145, 0.205);
  vec3 shallow = vec3(0.1, 0.34, 0.36);
  vec3 col = mix(deep, shallow, depth * 0.82 + h0 * 0.05);
  col += vec3(0.02, 0.038, 0.04) * h0;
  // The shelf picks up a little green mineral colour and is less mirror-like
  // than deep water. This is what makes the sea read as shallow near the shore.
  float shelf = smoothstep(0.7, 0.98, coast);
  col = mix(col, vec3(0.105, 0.315, 0.31), shelf * 0.14);
  // Short chop is a colour layer as well as a normal layer: at battle zoom the
  // glints alone are too sparse to read as moving water.
  float chop = wave(p * 1.15 - 3.0, t * 1.8);
  col += vec3(0.014, 0.026, 0.028) * chop * (1.0 + 2.4 * uSea * openSea);
  float crest = smoothstep(0.5, 0.9, h0);
  col = mix(col, vec3(0.3, 0.44, 0.46), crest * (0.1 + 0.3 * uSea * openSea));
  // Whitecaps. They are not foam on a beach: they break wherever the surface is
  // steep and the sea is running, which is why they are keyed on the height
  // field rather than on the coast channel.
  float caps = smoothstep(0.58, 0.95, uSea * (0.45 + 0.55 * openSea));
  if (caps > 0.001) {
    float breakUp = 0.5 + 0.5 * sin(t * 2.1 + p.x * 0.9 - p.y * 0.75)
                  * (0.6 + 0.4 * noise2(p * 1.3 - t * 0.07));
    float crestline = smoothstep(0.62, 0.92, h0 * 0.7 + 0.3);
    float whitecap = caps * crestline * smoothstep(0.35, 0.8, breakUp);
    col = mix(col, vec3(0.68, 0.75, 0.76), whitecap * 0.42);
  }
  // Spray haze: in a gale the sea reads through a film of its own water, which
  // is the visual half of the naval detection penalty.
  col = mix(col, vec3(0.36, 0.45, 0.47), uSea * uSea * 0.12);
  float fleck = smoothstep(0.76, 0.94, noise2(p * 2.1 + vec2(t * 0.08, t * 0.05)));
  col = mix(col, vec3(0.44, 0.56, 0.56), fleck * smoothstep(0.15, 0.55, h0) * 0.08);
  // A restrained sky term, not a planar reflection: the tactical camera is
  // steep enough that a constant horizon tint reads better than a mirror.
  float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 2.0);
  col = mix(col, vec3(0.2, 0.28, 0.32), fresnel * 0.48);

  float spec = pow(max(dot(reflect(-sunDir, n), viewDir), 0.0), 160.0);
  col += vec3(1.0, 0.88, 0.7) * spec * 1.35;
  float glint = pow(max(dot(reflect(-sunDir, n), viewDir), 0.0), 420.0);
  col += vec3(1.0, 0.95, 0.86) * glint * 1.5;
  col *= 0.76 + uAmbient * 0.5;

  // A broken, moving surf line. The B channel spreads the band over the first
  // few tiles, so the foam follows the actual shoreline rather than filling
  // every shallow-water tile with the same painted rim.
  float foamLine = smoothstep(0.66, 0.96, coast);
  // A surf break is metres wide, not tens of metres. The higher spatial
  // frequency and two competing terms keep the band broken along the shore.
  float foamNoise = 0.5 + 0.5 * sin(t * 1.7 + p.x * 1.45 + p.y * 1.2)
                  * (0.65 + 0.35 * noise2(p * 1.6 + t * 0.12));
  col = mix(col, vec3(0.56, 0.67, 0.65), foamLine * smoothstep(0.22, 0.9, foamNoise) * 0.28);
  // The last few centimetres of contact get a restrained waterline rather than
  // the old uniform cyan glow along the whole coast.
  float waterline = smoothstep(0.93, 1.0, coast) * (0.4 + 0.6 * noise2(p * 2.1 + t * 0.1));
  col = mix(col, vec3(0.6, 0.69, 0.65), waterline * 0.2);
  col = mix(col, vec3(0.22, 0.38, 0.4), (1.0 - depth) * 0.1);
  col *= uTone;

  float fog = uUseFog > 0.5 ? fogField(vUv) : 1.0;
  col = applyHaze(col, vWorld);
  col = applyFog(col, fog);
  outColor = vec4(col, 1.0);
}
`;

export const PROP_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in float aTeam;
layout(location=4) in vec3 iPos;
layout(location=5) in float iRot;
layout(location=6) in float iScale;
layout(location=7) in vec3 iColor;
layout(location=8) in float aMaterial;
uniform vec2 uWind;
uniform float uTime;
${CAMERA}
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
out float vMaterial;
void main() {
  float c = cos(iRot);
  float s = sin(iRot);
  vec3 p = aPos * iScale;
  vec3 rotated = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  vec3 n = vec3(aNormal.x * c - aNormal.z * s, aNormal.y, aNormal.x * s + aNormal.z * c);
  vec3 world = rotated + iPos;
  // Wind in the canopy. Only foliage is tagged with the canvas material, so
  // fences, kerbs and rock stay planted by construction rather than by a
  // per-prop flag. Displacement grows with height squared: the trunk base does
  // not move and the crown travels, which is how a tree actually bends. Two
  // out-of-phase sines give a gust that arrives across the field instead of
  // every tree nodding in unison.
  float foliage = abs(aMaterial - ${MATERIAL.canvas}.0) < 0.5 ? 1.0 : 0.0;
  if (foliage > 0.5) {
    float h = max(0.0, rotated.y) * 0.25;
    float gust = 0.55 + 0.45 * sin(uTime * 2.3 + iPos.x * 0.35 + iPos.z * 0.27);
    gust += 0.18 * sin(uTime * 5.9 + iPos.z * 0.8);
    vec2 sway = uWind * h * h * gust * 0.045;
    world.x += sway.x;
    world.z += sway.y;
  }
  vNormal = n;
  vColor = aColor * iColor;
  vWorld = world;
  vMaterial = aMaterial;
  gl_Position = projectWorld(world);
}
`;

export const PROP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorld;
in float vMaterial;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uAmbient;
uniform vec3 uTone;
uniform float uEmissive;
uniform vec3 uGlow;
uniform sampler2D uMatLut;
uniform float uUseFog;
${FOG_FIELD}
${HAZE_GLSL}
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float triNoise(vec3 p, vec3 n, float scale) {
  vec3 q = p * scale;
  vec3 w = pow(abs(n), vec3(4.0));
  w /= max(w.x + w.y + w.z, 0.001);
  return noise2(q.zy) * w.x + noise2(q.xz + 17.3) * w.y + noise2(q.xy + 41.7) * w.z;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 sunDir = normalize(uSun);
  float diffuse = max(dot(n, sunDir), 0.0);
  vec4 mat = texture(uMatLut, vec2((floor(vMaterial + 0.5) + 0.5) / 8.0, 0.5));
  float roughness = clamp(mat.r, 0.0, 1.0);
  float metalness = clamp(mat.g, 0.0, 1.0);
  float detail = clamp(mat.b, 0.0, 1.0);
  float specular = clamp(mat.a, 0.0, 1.0);
  vec3 col = vColor;

  float id = floor(vMaterial + 0.5);
  if (id > 3.5 && id < 4.5) {
    // Rock cover: bedded stone, not a smooth sphere. Only stone pays for the
    // three detail octaves; the tree instances stay on their existing vertex
    // colours and silhouette.
    float macro = triNoise(vWorld, n, 0.21);
    float meso = triNoise(vWorld, n, 0.75);
    float fine = triNoise(vWorld, n, 2.8);
    col *= mix(1.0, 0.86 + 0.16 * meso + 0.06 * fine, detail);
    float strata = 0.5 + 0.5 * sin(vWorld.y * 3.1 + macro * 2.8);
    col = mix(col, col * 0.78, strata * 0.34 * detail);
  } else if (id < 1.5) {
    // Ore is the one other prop that benefits from a highlight; a single
    // octave is enough.
    float meso = triNoise(vWorld, n, 0.75);
    col *= mix(1.0, 0.94 + 0.09 * meso, detail);
  }

  col *= uAmbient + (1.0 - uAmbient) * diffuse * 0.82 + 0.08 * n.y;
  vec3 viewDir = normalize(uEye - vWorld);
  vec3 halfDir = normalize(sunDir + viewDir);
  float gloss = 1.0 - roughness;
  float highlight = pow(max(dot(n, halfDir), 0.0), mix(6.0, 100.0, gloss));
  col += mix(vec3(1.0), col, 0.5) * highlight * specular * (0.08 + metalness * 0.5);
  // uGlow is the self-lit colour a prop adds after the light grade: the crystal
  // seams use it to burn cyan once the sun is down. Scaling it by the facet's
  // own brightness keeps the cut faces readable instead of flooding the shard
  // with one flat colour.
  col = col * uTone + vColor * uEmissive + uGlow * dot(vColor, vec3(0.299, 0.587, 0.114));
  float fog = uUseFog > 0.5 ? fogField(vWorld.xz / uWorldSize) : 1.0;
  col = applyHaze(col, vWorld);
  col = applyFog(col, fog);
  outColor = vec4(col, 1.0);
}
`;

export const PARTICLE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in vec3 iCenter;
layout(location=3) in float iSize;
layout(location=4) in vec4 iColor;
// x = vertical stretch, y = edge softness. One spare instance attribute buys
// rain that reads as falling water instead of a column of dots, and smoke with
// a feathered edge instead of a hard-edged disc.
layout(location=5) in vec2 iShape;
// World-space streak axis. A stretched quad billboarded on the camera's right
// axis draws a horizontal line whatever the particle is doing; laying the quad
// along the particle's own direction of travel is what makes rain read as rain
// at any camera pitch.
layout(location=6) in vec3 iDir;
uniform vec3 uRightDir;
uniform vec3 uUpDir;
${CAMERA}
out vec4 vColor;
out vec2 vUv;
out float vSoft;
void main() {
  vec3 axis = normalize(iDir + vec3(0.0, 0.0001, 0.0));
  // Width axis: perpendicular to both the streak and the view, so the quad
  // always faces the camera and stays thin side-on.
  vec3 side = cross(axis, uForward);
  float sideLen = length(side);
  side = sideLen > 0.001 ? side / sideLen : uRightDir;
  vec3 world = iCenter
    + side * aPos.x * iSize
    + axis * aPos.y * iSize * max(iShape.x, 0.05);
  vColor = iColor;
  vUv = aUv;
  vSoft = iShape.y;
  gl_Position = projectWorld(world);
}
`;

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vUv;
in float vSoft;
uniform float uAdditive;
out vec4 outColor;
void main() {
  float d = length(vUv - vec2(0.5)) * 2.0;
  // A soft puff fades from most of its radius; a hot core stays solid almost to
  // the rim and then drops off hard.
  float core = mix(0.86, 0.18, clamp(vSoft, 0.0, 1.0));
  float edge = smoothstep(1.0, core, d);
  // Break the perfect circle. Weightless puffs get a fixed per-fragment wobble
  // on their rim, which reads as billowing vapour; sparks stay clean.
  if (vSoft > 0.6) {
    float n = fract(sin(dot(vUv * 41.0, vec2(12.9898, 78.233))) * 43758.5453);
    edge *= 0.82 + 0.36 * n;
  }
  float a = clamp(edge, 0.0, 1.0) * vColor.a;
  if (uAdditive > 0.5) {
    outColor = vec4(vColor.rgb * a, a);
  } else {
    outColor = vec4(vColor.rgb, a);
  }
}
`;

/**
 * Night lighting pass.
 *
 * One instanced quad batch for every light in the battle: a radial ellipse for
 * ground pools, beams and floodlit yards, and camera-facing glows for lit
 * windows and beacons. Additive, depth-tested, depth-write off, and capped by
 * the simulation's own light list, so a night map costs one draw call rather
 * than one per lamp and never allocates shadow maps.
 */
export const LIGHT_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec3 iCenter;
layout(location=2) in vec4 iColor;
layout(location=3) in vec4 iShape;
layout(location=4) in float iCone;
uniform vec3 uRightDir;
uniform vec3 uUpDir;
${CAMERA}
out vec2 vLocal;
out vec4 vColor;
out float vCone;
void main() {
  // shape: x = radius, y = rotation, z = stretch along facing, w = 1 for a
  // camera-facing glow (windows, beacons) rather than a ground pool.
  // iCone (the spare instance float) turns a pool into a forward cone beam.
  float radius = iShape.x;
  float rot = iShape.y;
  float stretch = iShape.z;
  vec3 world;
  if (iShape.w > 0.5) {
    world = iCenter + uRightDir * aPos.x * radius + uUpDir * aPos.y * radius;
  } else {
    float c = cos(rot);
    float s = sin(rot);
    vec2 p = vec2(aPos.x * radius * stretch, aPos.y * radius);
    world = iCenter + vec3(p.x * c - p.y * s, 0.0, p.x * s + p.y * c);
  }
  vLocal = aPos;
  vColor = iColor;
  vCone = iCone;
  gl_Position = projectWorld(world);
}
`;

export const LIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vColor;
in float vCone;
out vec4 outColor;
void main() {
  float d = length(vLocal);
  if (d > 1.0) discard;
  float a;
  if (vCone > 0.5) {
    // Headlamp cone. vLocal.x runs from the bumper (-1) to the far end (+1). The
    // beam is a soft field, not a shape: the spread widens with distance, the
    // lateral edge is a wide smoothstep rather than a cutoff, and both the near
    // and far ends fade out so the pool has no visible boundary anywhere.
    float t = clamp(vLocal.x * 0.5 + 0.5, 0.0, 1.0);
    float lateral = abs(vLocal.y);
    float spread = mix(0.30, 1.0, t);
    float edge = 1.0 - smoothstep(spread * 0.05, spread, lateral);
    float startFade = smoothstep(0.0, 0.22, t);
    float endFade = 1.0 - smoothstep(0.50, 1.0, t);
    float near = 1.0 - 0.45 * t;
    // Squared once more so the core is not a plateau with a lip around it.
    float beam = edge * edge * startFade * endFade * near;
    a = beam * vColor.a;
  } else {
    // Squared smooth falloff; the rim fades to nothing so pools never show an edge.
    float falloff = 1.0 - d;
    falloff *= falloff;
    a = falloff * vColor.a;
  }
  if (a <= 0.001) discard;
  outColor = vec4(vColor.rgb * a, a);
}
`;
