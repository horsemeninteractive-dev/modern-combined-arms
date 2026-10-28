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
  gl_Position = projectWorld(world.xyz);
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
uniform float uAlpha;
uniform float uFlash;
uniform sampler2D uFogTex;
uniform sampler2D uFlagTex;
uniform sampler2D uMatLut;
uniform float uUseFog;
uniform vec2 uWorldSize;
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

  lit += vec3(1.0, 0.86, 0.66) * uFlash;
  // Only the road pass samples fog: roads are ground features, so they are
  // known where the team has vision, dimmed where the ground was charted and
  // lost again in ground nobody has ever seen.
  float fog = uUseFog > 0.5 ? texture(uFogTex, vWorld.xz / uWorldSize).r : 1.0;
  if (fog < 0.08) lit = mix(vec3(0.012, 0.027, 0.038), lit * 0.12, 0.22);
  else lit = mix(lit * 0.34, lit, smoothstep(0.18, 0.92, fog));
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
${CAMERA}
out vec2 vLocal;
out float vAlpha;
void main() {
  vec2 p = aCorner * aRadius;
  float c = cos(aRotation);
  float s = sin(aRotation);
  vec2 rotated = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec3 world = aCenter + vec3(rotated.x, 0.0, rotated.y);
  vLocal = aCorner;
  vAlpha = aAlpha;
  gl_Position = projectWorld(world);
}
`;

export const SHADOW_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in float vAlpha;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 outColor;
void main() {
  float d = length(vLocal);
  float soft = 1.0 - smoothstep(0.62, 1.0, d);
  float core = 1.0 - smoothstep(0.0, 0.9, d);
  float a = vAlpha * uOpacity * (0.8 * soft + 0.2 * core);
  if (a < 0.004) discard;
  outColor = vec4(uColor, a);
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
uniform sampler2D uFogTex;
uniform sampler2D uShoreTex;
uniform float uUseFog;
uniform float uTime;
uniform float uGrid;
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
  float diffuse = max(dot(n, normalize(uSun)), 0.0);
  vec3 lit = base * (uAmbient + (1.0 - uAmbient) * diffuse * 0.88 + 0.06 * n.y);
  float fog = uUseFog > 0.5 ? texture(uFogTex, vUv).r : 1.0;
  vec3 dark = vec3(0.012, 0.027, 0.038);
  if (fog < 0.08) {
    lit = mix(dark, lit * 0.12, 0.22);
  } else {
    float vis = smoothstep(0.18, 0.92, fog);
    lit = mix(lit * 0.34 + dark * 0.3, lit, vis);
  }
  outColor = vec4(lit, 1.0);
}
`;

export const WATER_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform vec2 uWorldSize;
${CAMERA}
out vec3 vWorld;
out vec2 vUv;
void main() {
  vWorld = aPos;
  vUv = aPos.xz / uWorldSize;
  gl_Position = projectWorld(aPos);
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
uniform sampler2D uFogTex;
uniform sampler2D uShoreTex;
uniform float uUseFog;
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

float wave(vec2 p, float t) {
  return sin(p.x * 0.55 + t * 0.8) * 0.5 + sin(p.y * 0.7 - t * 0.63) * 0.5
       + sin((p.x + p.y) * 0.33 + t * 0.4) * 0.25;
}

// One combined surface height. The finite difference is taken in world space,
// so the normal is stable at every camera orientation and never uses dFdx.
float surface(vec2 p, float t) {
  return wave(p * 0.14, t) * 0.6 + wave(p * 0.43 + 7.0, t * 1.35) * 0.28
       + wave(p * 1.15 - 3.0, t * 1.8) * 0.12;
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
  float h0 = surface(p, t);
  float hx = surface(p + vec2(e, 0.0), t);
  float hz = surface(p + vec2(0.0, e), t);
  vec2 grad = vec2((hx - h0) / e, (hz - h0) / e);
  vec3 n = normalize(vec3(-grad.x * 3.2, 1.0, -grad.y * 3.2));
  // Fine chop breaks the long swell into water rather than a printed gradient.
  // Its two terms are animated in opposite directions so the pattern does not
  // sit still under the camera.
  n.x += (noise2(p * 1.7 + vec2(t * 0.12, 0.0)) - 0.5) * 0.12;
  n.z += (noise2(p * 1.9 - vec2(0.0, t * 0.1)) - 0.5) * 0.12;
  n = normalize(n);
  vec3 viewDir = normalize(uEye - vWorld);
  vec3 sunDir = normalize(uSun);

  float depth = smoothstep(0.12, 0.96, shallowness);
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
  col += vec3(0.014, 0.026, 0.028) * chop;
  float crest = smoothstep(0.5, 0.9, h0);
  col = mix(col, vec3(0.3, 0.44, 0.46), crest * 0.1);
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

  float fog = uUseFog > 0.5 ? texture(uFogTex, vUv).r : 1.0;
  if (fog < 0.08) {
    col = mix(vec3(0.012, 0.03, 0.045), col * 0.15, 0.2);
  } else {
    col = mix(col * 0.3 + vec3(0.006, 0.02, 0.03), col, smoothstep(0.15, 0.9, fog));
  }
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
uniform float uEmissive;
uniform sampler2D uFogTex;
uniform sampler2D uMatLut;
uniform float uUseFog;
uniform vec2 uWorldSize;
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
  col += vColor * uEmissive;
  float fog = uUseFog > 0.5 ? texture(uFogTex, vWorld.xz / uWorldSize).r : 1.0;
  if (fog < 0.08) col = mix(vec3(0.012, 0.028, 0.04), col * 0.12, 0.2);
  else col = mix(col * 0.3, col, smoothstep(0.15, 0.9, fog));
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
uniform vec3 uRightDir;
uniform vec3 uUpDir;
${CAMERA}
out vec4 vColor;
out vec2 vUv;
void main() {
  vec3 world = iCenter + uRightDir * aPos.x * iSize + uUpDir * aPos.y * iSize;
  vColor = iColor;
  vUv = aUv;
  gl_Position = projectWorld(world);
}
`;

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vUv;
uniform float uAdditive;
out vec4 outColor;
void main() {
  float d = length(vUv - vec2(0.5)) * 2.0;
  float circle = smoothstep(1.0, 0.15, d);
  float a = circle * vColor.a;
  if (uAdditive > 0.5) {
    outColor = vec4(vColor.rgb * a, a);
  } else {
    outColor = vec4(vColor.rgb, a);
  }
}
`;
