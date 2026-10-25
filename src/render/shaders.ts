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
uniform mat4 uModel;
${CAMERA}
out vec3 vNormal;
out vec3 vColor;
out float vTeam;
out vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vTeam = aTeam;
  vWorld = world.xyz;
  gl_Position = projectWorld(world.xyz);
}
`;

export const MESH_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in float vTeam;
in vec3 vWorld;
uniform vec3 uTeamColor;
uniform vec3 uSun;
uniform vec3 uTint;
uniform float uAmbient;
uniform float uAlpha;
uniform float uFlash;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  float diffuse = max(dot(n, normalize(uSun)), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 base = mix(vColor, uTeamColor, clamp(vTeam, 0.0, 1.0)) * uTint;
  vec3 lit = base * (uAmbient + (1.0 - uAmbient) * diffuse * 0.9 + 0.07 * hemi);
  lit += vec3(1.0, 0.86, 0.66) * uFlash;
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
${CAMERA}
out vec3 vNormal;
out vec3 vColor;
out vec2 vUv;
out vec3 vWorld;
void main() {
  vNormal = aNormal;
  vColor = aColor;
  vUv = aUv;
  vWorld = aPos;
  gl_Position = projectWorld(aPos);
}
`;

export const TERRAIN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec2 vUv;
in vec3 vWorld;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uAmbient;
uniform sampler2D uFogTex;
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
void main() {
  float grain = noise2(vWorld.xz * 0.55) * 0.16 + noise2(vWorld.xz * 2.3) * 0.06;
  vec3 base = vColor * (0.9 + grain);
  // Construction guidance only; ordinary play leaves uGrid at 0.
  vec2 cell = abs(fract(vWorld.xz / 4.0) - 0.5);
  float edge = smoothstep(0.46, 0.5, max(cell.x, cell.y));
  base *= 1.0 - edge * 0.14 * uGrid;
  vec3 n = normalize(vNormal);
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

float wave(vec2 p, float t) {
  return sin(p.x * 0.55 + t * 0.8) * 0.5 + sin(p.y * 0.7 - t * 0.63) * 0.5
       + sin((p.x + p.y) * 0.33 + t * 0.4) * 0.25;
}
void main() {
  float shore = texture(uShoreTex, vUv).r;
  float t = uTime;
  vec2 p = vWorld.xz;
  float w0 = wave(p * 0.14, t);
  float w1 = wave(p * 0.43 + 7.0, t * 1.35);
  float ripple = (w0 * 0.65 + w1 * 0.35);
  vec3 deep = vec3(0.04, 0.17, 0.25);
  vec3 shallow = vec3(0.12, 0.4, 0.44);
  vec3 col = mix(deep, shallow, smoothstep(0.15, 0.95, shore));
  col += ripple * 0.035;
  // Moving glints.
  vec3 n = normalize(vec3(ripple * 0.12, 1.0, w1 * 0.1));
  vec3 viewDir = normalize(uEye - vWorld);
  float spec = pow(max(dot(reflect(-normalize(uSun), n), viewDir), 0.0), 64.0);
  col += vec3(0.55, 0.72, 0.72) * spec * 0.5;
  float foamBand = smoothstep(0.72, 0.98, shore) * smoothstep(0.1, 0.7, 0.55 + 0.45 * sin(t * 1.3 + p.x * 0.4 + p.y * 0.3));
  col = mix(col, vec3(0.55, 0.67, 0.65), foamBand * 0.45);
  col *= uAmbient + 0.35;
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
${CAMERA}
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
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
  gl_Position = projectWorld(world);
}
`;

export const PROP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorld;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uAmbient;
uniform float uEmissive;
uniform sampler2D uFogTex;
uniform float uUseFog;
uniform vec2 uWorldSize;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  float diffuse = max(dot(n, normalize(uSun)), 0.0);
  vec3 col = vColor * (uAmbient + (1.0 - uAmbient) * diffuse * 0.82 + 0.08 * n.y);
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
