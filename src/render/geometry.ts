import type { MeshBuffers } from './gl';
import type { Vec3 } from './math';
import { MATERIAL } from './materials';

export type Color = Vec3;

export const PALETTE = {
  hullDark: [0.19, 0.21, 0.2] as Color,
  hull: [0.32, 0.35, 0.31] as Color,
  hullLight: [0.42, 0.45, 0.39] as Color,
  track: [0.085, 0.09, 0.085] as Color,
  metal: [0.46, 0.47, 0.44] as Color,
  darkMetal: [0.16, 0.17, 0.16] as Color,
  glass: [0.25, 0.46, 0.51] as Color,
  rubber: [0.06, 0.065, 0.06] as Color,
  concrete: [0.4, 0.39, 0.35] as Color,
  concreteDark: [0.26, 0.26, 0.24] as Color,
  canvas: [0.35, 0.36, 0.28] as Color,
  sandbag: [0.44, 0.42, 0.33] as Color,
  olive: [0.27, 0.32, 0.2] as Color,
  oliveDark: [0.18, 0.22, 0.14] as Color,
  amber: [0.86, 0.56, 0.16] as Color,
  warning: [0.92, 0.55, 0.12] as Color,
  glassDark: [0.08, 0.13, 0.14] as Color,
  white: [0.85, 0.86, 0.8] as Color,
  red: [0.7, 0.15, 0.12] as Color,
};

export function shade(c: Color, f: number): Color {
  return [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];
}

/**
 * Every existing builder already supplies a palette colour, so the material id
 * can be inferred from that colour rather than threaded through hundreds of
 * box/cylinder calls. Shades of a palette colour have the same chromaticity, so
 * normalising by the max channel keeps a dark concrete plinth reading as
 * concrete instead of falling into the metal or track family.
 *
 * Builders that need a different answer (roads, rock props, ore) set
 * `MeshBuilder.material` explicitly before adding geometry.
 */
const MATERIAL_ANCHORS: ReadonlyArray<readonly [number, Color]> = [
  [MATERIAL.painted, PALETTE.hull],
  [MATERIAL.painted, PALETTE.hullDark],
  [MATERIAL.painted, PALETTE.hullLight],
  [MATERIAL.painted, PALETTE.olive],
  [MATERIAL.painted, PALETTE.oliveDark],
  [MATERIAL.painted, PALETTE.amber],
  [MATERIAL.painted, PALETTE.warning],
  [MATERIAL.painted, PALETTE.red],
  [MATERIAL.painted, PALETTE.white],
  [MATERIAL.bareMetal, PALETTE.metal],
  [MATERIAL.bareMetal, PALETTE.darkMetal],
  [MATERIAL.concrete, PALETTE.concrete],
  [MATERIAL.concrete, PALETTE.concreteDark],
  [MATERIAL.glass, PALETTE.glass],
  [MATERIAL.glass, PALETTE.glassDark],
  [MATERIAL.canvas, PALETTE.canvas],
  [MATERIAL.canvas, PALETTE.sandbag],
  [MATERIAL.track, PALETTE.track],
  [MATERIAL.track, PALETTE.rubber],
];

function chromaticity(c: Color): Color {
  const max = Math.max(c[0], c[1], c[2], 0.0001);
  return [c[0] / max, c[1] / max, c[2] / max];
}

export function materialForColor(color: Color): number {
  const max = Math.max(color[0], color[1], color[2]);
  const min = Math.min(color[0], color[1], color[2]);
  // Tracks and tyres are near-neutral and very dark. A shaded glassDark face
  // is just as dark in absolute terms but keeps its blue-green cast, so the
  // shortcut must test hue as well as value. Returning track before the anchor
  // comparison used to turn every shaded window band into rubber.
  if (max < 0.135 && max - min < max * 0.2) {
    // The authored track palette tops out around 0.09. A near-neutral surface
    // above that is a shaded dark-metal edge, not rubber. The threshold is
    // proportional so a heavily shaded blue-green window is still glass.
    return max < 0.1 ? MATERIAL.track : MATERIAL.bareMetal;
  }
  const c = chromaticity(color);
  let best: number = MATERIAL.painted;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [id, anchor] of MATERIAL_ANCHORS) {
    const a = chromaticity(anchor);
    const distance =
      (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2 + (c[2] - a[2]) ** 2 +
      ((max - Math.max(anchor[0], anchor[1], anchor[2])) ** 2) * 0.12;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }
  return best;
}

export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  teamMask: number[] = [];
  materials: number[] = [];
  /** Override automatic colour inference for the next faces, or null to infer. */
  material: number | null = null;
  indices: number[] = [];

  private pushMaterial(color: Color): void {
    this.materials.push(this.material ?? materialForColor(color));
  }

  addQuad(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    color: Color,
    team = 0,
  ): void {
    const base = this.positions.length / 3;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const p of [a, b, c, d]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx, ny, nz);
      this.colors.push(color[0], color[1], color[2]);
      this.teamMask.push(team);
      this.pushMaterial(color);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  addTriangle(a: Vec3, b: Vec3, c: Vec3, color: Color, team = 0): void {
    const base = this.positions.length / 3;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx, ny, nz);
      this.colors.push(color[0], color[1], color[2]);
      this.teamMask.push(team);
      this.pushMaterial(color);
    }
    this.indices.push(base, base + 1, base + 2);
  }

  box(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    color: Color,
    team = 0,
  ): void {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    this.addQuad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], color, team);
    this.addQuad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], shade(color, 0.7), team);
    this.addQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], shade(color, 0.88), team);
    this.addQuad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], shade(color, 0.82), team);
    this.addQuad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], shade(color, 0.94), team);
    this.addQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(color, 0.78), team);
  }

  boxRot(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    yaw: number,
    color: Color,
    team = 0,
  ): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const ox = sx / 2;
    const oz = sz / 2;
    const corners: Array<[number, number]> = [
      [-ox, -oz],
      [ox, -oz],
      [ox, oz],
      [-ox, oz],
    ].map(([x, z]) => [x * c - z * s, x * s + z * c]);
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const top = corners.map(([x, z]) => [cx + x, y1, cz + z] as Vec3);
    const bottom = corners.map(([x, z]) => [cx + x, y0, cz + z] as Vec3);
    this.addQuad(top[0], top[1], top[2], top[3], color, team);
    this.addQuad(bottom[0], bottom[3], bottom[2], bottom[1], shade(color, 0.7), team);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.addQuad(bottom[i], bottom[j], top[j], top[i], shade(color, 0.85), team);
    }
  }

  /** Cylinder along the Y axis. */
  cylinder(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    height: number,
    segments: number,
    color: Color,
    team = 0,
  ): void {
    const y0 = cy - height / 2;
    const y1 = cy + height / 2;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const p0: Vec3 = [cx + Math.cos(a0) * radius, y0, cz + Math.sin(a0) * radius];
      const p1: Vec3 = [cx + Math.cos(a1) * radius, y0, cz + Math.sin(a1) * radius];
      const p2: Vec3 = [cx + Math.cos(a1) * radius, y1, cz + Math.sin(a1) * radius];
      const p3: Vec3 = [cx + Math.cos(a0) * radius, y1, cz + Math.sin(a0) * radius];
      this.addQuad(p0, p1, p2, p3, shade(color, 0.9), team);
      this.addTriangle([cx, y1, cz], p3, p2, color, team);
      this.addTriangle([cx, y0, cz], p1, p0, shade(color, 0.65), team);
    }
  }

  /** Cylinder along the X axis (barrels, tubes). */
  cylinderX(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    length: number,
    segments: number,
    color: Color,
    team = 0,
  ): void {
    const x0 = cx - length / 2;
    const x1 = cx + length / 2;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const p0: Vec3 = [x0, cy + Math.cos(a0) * radius, cz + Math.sin(a0) * radius];
      const p1: Vec3 = [x0, cy + Math.cos(a1) * radius, cz + Math.sin(a1) * radius];
      const p2: Vec3 = [x1, cy + Math.cos(a1) * radius, cz + Math.sin(a1) * radius];
      const p3: Vec3 = [x1, cy + Math.cos(a0) * radius, cz + Math.sin(a0) * radius];
      this.addQuad(p0, p1, p2, p3, shade(color, 0.9), team);
      this.addTriangle([x1, cy, cz], p3, p2, color, team);
      this.addTriangle([x0, cy, cz], p1, p0, shade(color, 0.6), team);
    }
  }

  /** Cylinder along the Z axis (wheels). */
  cylinderZ(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    length: number,
    segments: number,
    color: Color,
    team = 0,
  ): void {
    const z0 = cz - length / 2;
    const z1 = cz + length / 2;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const p0: Vec3 = [cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius, z0];
      const p1: Vec3 = [cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, z0];
      const p2: Vec3 = [cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, z1];
      const p3: Vec3 = [cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius, z1];
      this.addQuad(p0, p1, p2, p3, shade(color, 0.9), team);
      this.addTriangle([cx, cy, z1], p3, p2, color, team);
      this.addTriangle([cx, cy, z0], p1, p0, shade(color, 0.6), team);
    }
  }

  cone(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    height: number,
    segments: number,
    color: Color,
    team = 0,
  ): void {
    const y0 = cy;
    const y1 = cy + height;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const p0: Vec3 = [cx + Math.cos(a0) * radius, y0, cz + Math.sin(a0) * radius];
      const p1: Vec3 = [cx + Math.cos(a1) * radius, y0, cz + Math.sin(a1) * radius];
      this.addTriangle(p0, p1, [cx, y1, cz], shade(color, 0.9 + (i % 2) * 0.1), team);
      this.addTriangle([cx, y0, cz], p0, p1, shade(color, 0.6), team);
    }
  }

  sphere(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    latSegments: number,
    lonSegments: number,
    color: Color,
    team = 0,
  ): void {
    for (let lat = 0; lat < latSegments; lat++) {
      const v0 = lat / latSegments;
      const v1 = (lat + 1) / latSegments;
      const phi0 = v0 * Math.PI;
      const phi1 = v1 * Math.PI;
      for (let lon = 0; lon < lonSegments; lon++) {
        const u0 = lon / lonSegments;
        const u1 = (lon + 1) / lonSegments;
        const theta0 = u0 * Math.PI * 2;
        const theta1 = u1 * Math.PI * 2;
        const p = (phi: number, theta: number): Vec3 => [
          cx + Math.sin(phi) * Math.cos(theta) * radius,
          cy + Math.cos(phi) * radius,
          cz + Math.sin(phi) * Math.sin(theta) * radius,
        ];
        const a = p(phi0, theta0);
        const b = p(phi0, theta1);
        const c = p(phi1, theta1);
        const d = p(phi1, theta0);
        this.addQuad(a, b, c, d, shade(color, 0.82 + 0.16 * (lon % 2)), team);
      }
    }
  }

  build(): MeshBuffers {
    const count = this.positions.length / 3;
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      teamMask: new Float32Array(this.teamMask),
      materials: new Float32Array(this.materials),
      indices:
        count > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Prop meshes                                                        */
/* ------------------------------------------------------------------ */

export function buildTreeMesh(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  b.cylinder(0, 1.1, 0, 0.22, 2.2, 6, [0.22, 0.16, 0.1]);
  b.cone(0, 1.8, 0, 1.9, 4.4, 7, [0.12, 0.24, 0.14]);
  b.cone(0, 3.4, 0, 1.45, 3.4, 7, [0.16, 0.3, 0.17]);
  b.cone(0, 4.8, 0, 0.95, 2.6, 6, [0.21, 0.36, 0.2]);
  return b.build();
}

/**
 * A faceted monolith with irregular shoulder and apex rings. The old prop was a
 * sphere plus two boxes: its silhouette stayed round no matter what material it
 * wore, which is why ridge cover read as cartoon boulders. Flat faces give the
 * material shader edges to catch and read as stone at battle zoom.
 */
function addAngularStone(
  b: MeshBuilder,
  cx: number,
  cz: number,
  radius: number,
  height: number,
  sides: number,
  phase: number,
  color: Color,
): void {
  const bottom: Vec3[] = [];
  const shoulder: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    const r0 = radius * (0.82 + 0.18 * Math.sin(i * 2.7 + phase * 3.1));
    const r1 = radius * (0.52 + 0.16 * Math.sin(i * 1.9 + phase * 5.3));
    bottom.push([cx + Math.cos(a) * r0, 0, cz + Math.sin(a) * r0]);
    shoulder.push([
      cx + Math.cos(a + 0.26) * r1,
      height * (0.48 + 0.2 * Math.sin(i * 3.1 + phase)),
      cz + Math.sin(a + 0.26) * r1,
    ]);
  }
  const apex: Vec3 = [cx + radius * 0.16, height, cz - radius * 0.12];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    b.addTriangle(bottom[i], shoulder[i], shoulder[j], shade(color, 0.8));
    b.addTriangle(bottom[i], shoulder[j], bottom[j], shade(color, 0.68));
    b.addTriangle(shoulder[i], apex, shoulder[j], shade(color, 1.02 + (i % 2) * 0.06));
  }
}

export function buildRockMesh(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.rock;
  addAngularStone(b, 0, 0, 1.42, 1.55, 7, 0.35, [0.38, 0.37, 0.34]);
  addAngularStone(b, 1.0, 0.36, 0.78, 0.95, 5, 1.6, [0.31, 0.31, 0.29]);
  addAngularStone(b, -0.92, -0.42, 0.62, 0.7, 5, 2.9, [0.43, 0.41, 0.37]);
  return b.build();
}

/**
 * Ground scrub: three squashed spheres with no trunk, so a bush reads as cover
 * lying on the terrain rather than a small tree. Kept under a metre so it never
 * competes with an infantryman's silhouette at battle zoom.
 */
export function buildBushMesh(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  // Lighter than the grass they stand on. A bush at the old value read as a
  // black spot on the field at battle zoom; lifting the whole ramp keeps the
  // silhouette without turning the scrub into holes in the ground.
  const leaf: Color = [0.33, 0.46, 0.23];
  const dark: Color = [0.22, 0.33, 0.16];
  const light: Color = [0.44, 0.58, 0.29];
  // A shadowed base, three shoulder lobes and a lit crown. Five uneven spheres
  // keep the silhouette lumpy from every yaw, which is what stops a field of
  // bushes reading as one repeated dot.
  b.sphere(0, 0.26, 0, 0.5, 4, 7, dark);
  b.sphere(0.34, 0.34, 0.16, 0.4, 3, 6, leaf);
  b.sphere(-0.3, 0.32, 0.22, 0.35, 3, 6, leaf);
  b.sphere(0.02, 0.52, -0.26, 0.29, 3, 6, light);
  b.sphere(-0.14, 0.6, 0.12, 0.24, 3, 5, light);
  b.box(0.1, 0.52, 0.06, 0.035, 0.62, 0.035, [0.24, 0.19, 0.12]);
  return b.build();
}

/**
 * Leggy brush: four woody stems with small canopies. Taller and sparser than a
 * bush, so a thicket mixes heights instead of repeating one blob.
 */
export function buildShrubMesh(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  // Same lift as the bush: woody stems stay warmer than the foliage, and the
  // canopy keeps a lit crown so a thicket is not one flat mass.
  const stem: Color = [0.31, 0.25, 0.18];
  const leaf: Color = [0.34, 0.47, 0.24];
  const light: Color = [0.43, 0.56, 0.28];
  const stems: Array<[number, number, number]> = [
    [0, 0, 1.06],
    [0.22, 0.14, 0.86],
    [-0.2, 0.18, 0.78],
    [-0.04, -0.24, 0.92],
  ];
  for (const [x, z, h] of stems) b.box(x, h / 2, z, 0.045, h, 0.045, stem);
  b.sphere(0, 1.04, 0, 0.25, 3, 5, leaf);
  b.sphere(0.24, 0.86, 0.14, 0.19, 3, 5, light);
  b.sphere(-0.2, 0.8, 0.18, 0.17, 3, 5, leaf);
  return b.build();
}

/**
 * Dry grass tuft: seven short blades fanning from one point. Under half a metre,
 * it fills verges and dunes without pretending to be cover.
 */
export function buildGrassTuftMesh(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  const dry: Color = [0.46, 0.43, 0.26];
  const light: Color = [0.56, 0.51, 0.31];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = 0.07 + (i % 3) * 0.06;
    b.cone(
      Math.cos(a) * r,
      0,
      Math.sin(a) * r,
      0.055,
      0.32 + (i % 4) * 0.07,
      3,
      i % 2 === 0 ? dry : light,
    );
  }
  return b.build();
}

/**
 * Post-and-rail boundary fencing along the local X axis: three weathered posts
 * and two rails. Placed parallel to a road, it gives the fields edges without
 * blocking anything — props carry no collision.
 */
export function buildFenceMesh(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  const timber: Color = [0.34, 0.29, 0.22];
  const rail: Color = [0.26, 0.23, 0.18];
  for (const x of [-1.15, 0, 1.15]) b.box(x, 0.46, 0, 0.1, 0.92, 0.1, timber);
  for (const y of [0.4, 0.72]) b.box(0, y, 0, 2.4, 0.075, 0.05, rail);
  return b.build();
}

/**
 * Kerbside street lamp: cast base, pole, arm over the carriageway and a warm
 * lens. The arm points along local +X, so the instance rotation aims it at the
 * road it stands beside.
 */
export function buildLampMesh(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  const pole: Color = [0.2, 0.22, 0.21];
  b.box(0, 0.1, 0, 0.24, 0.2, 0.24, [0.27, 0.27, 0.25]);
  b.cylinder(0, 1.32, 0, 0.06, 2.44, 5, pole);
  b.box(0.34, 2.48, 0, 0.72, 0.07, 0.07, pole);
  b.material = MATERIAL.painted;
  b.box(0.72, 2.38, 0, 0.28, 0.1, 0.17, [0.28, 0.28, 0.26]);
  b.box(0.72, 2.32, 0, 0.22, 0.05, 0.12, [0.92, 0.72, 0.34]);
  return b.build();
}

export function buildOreMesh(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  b.cone(0, 0, 0.2, 0.55, 1.9, 5, PALETTE.amber);
  b.cone(0.55, 0, -0.3, 0.4, 1.4, 5, [0.95, 0.66, 0.24]);
  b.cone(-0.5, 0, 0.45, 0.42, 1.2, 5, [0.76, 0.45, 0.1]);
  b.cone(0.1, 0, -0.7, 0.32, 0.9, 5, [0.9, 0.58, 0.18]);
  return b.build();
}
