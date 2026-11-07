/**
 * Authored meshes for the set-dressing kinds that have no procedural scatter.
 *
 * The original eleven props reuse the instanced batches that dress the terrain,
 * which is why a hand-placed bush and a generated one share a mesh. Everything
 * here is street furniture, farm kit, industrial clutter, field defences or
 * wrecks: there is no generator growing them, so each kind owns one small mesh.
 *
 * Every builder is authored at the tile centre, standing on y = 0 and facing +X,
 * because that is where `buildPropInstances` puts an instance and how the Forge
 * rotates it. Sizes stay inside a single tile's width (TILE_SIZE is 4 world
 * units, so roughly ±1.1) and under about three units tall, except the silo,
 * wind pump, scaffold and bus, which read better tall and still fit one tile of
 * ground.
 *
 * Poly budgets are deliberately low: these are seen from the tactical camera at
 * zoom 36, where a bench is a few pixels. Detail lives in silhouette and
 * material breaks, not in segment counts.
 */
import { MeshBuilder, PALETTE, shade, type Color } from './geometry';
import type { Vec3 } from './math';
import type { MeshBuffers } from './gl';
import { MATERIAL } from './materials';

const STRAW: Color = [0.63, 0.55, 0.3];
const STRAW_DARK: Color = [0.44, 0.38, 0.2];
const RUST: Color = [0.34, 0.2, 0.14];
const BURNT: Color = [0.13, 0.12, 0.115];
const ASH: Color = [0.28, 0.27, 0.26];
const STONE: Color = [0.44, 0.43, 0.39];
const STONE_DARK: Color = [0.32, 0.32, 0.3];
const TIMBER: Color = [0.34, 0.27, 0.19];
const TIMBER_LIGHT: Color = [0.46, 0.37, 0.25];
const STEEL: Color = [0.4, 0.42, 0.4];
const RUSTED_STEEL: Color = [0.4, 0.29, 0.2];
const GREEN_PAINT: Color = [0.24, 0.31, 0.22];

/**
 * A square-section beam between two world points.
 *
 * `boxRot` turns about Y, so a leaning beam cannot be built with it. A hedgehog
 * and any future leaning prop need a real axis, so this builds the prism from an
 * orthonormal basis around the beam direction.
 */
function beam(b: MeshBuilder, a: Vec3, c: Vec3, radius: number, color: Color): void {
  const ax = c[0] - a[0];
  const ay = c[1] - a[1];
  const az = c[2] - a[2];
  const len = Math.hypot(ax, ay, az) || 1;
  const axis: Vec3 = [ax / len, ay / len, az / len];
  const ref: Vec3 = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ux = axis[1] * ref[2] - axis[2] * ref[1];
  const uy = axis[2] * ref[0] - axis[0] * ref[2];
  const uz = axis[0] * ref[1] - axis[1] * ref[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  const u: Vec3 = [ux / ul, uy / ul, uz / ul];
  const v: Vec3 = [
    axis[1] * u[2] - axis[2] * u[1],
    axis[2] * u[0] - axis[0] * u[2],
    axis[0] * u[1] - axis[1] * u[0],
  ];
  const corner = (point: Vec3, su: number, sv: number): Vec3 => [
    point[0] + u[0] * radius * su + v[0] * radius * sv,
    point[1] + u[1] * radius * su + v[1] * radius * sv,
    point[2] + u[2] * radius * su + v[2] * radius * sv,
  ];
  const a0 = corner(a, 1, 1);
  const a1 = corner(a, -1, 1);
  const a2 = corner(a, -1, -1);
  const a3 = corner(a, 1, -1);
  const c0 = corner(c, 1, 1);
  const c1 = corner(c, -1, 1);
  const c2 = corner(c, -1, -1);
  const c3 = corner(c, 1, -1);
  b.addQuad(a0, a1, c1, c0, color);
  b.addQuad(a1, a2, c2, c1, shade(color, 0.9));
  b.addQuad(a2, a3, c3, c2, shade(color, 0.82));
  b.addQuad(a3, a0, c0, c3, shade(color, 0.94));
  b.addQuad(c0, c1, c2, c3, shade(color, 1.08));
  b.addQuad(a3, a2, a1, a0, shade(color, 0.7));
}

/** A hay bale: banded straw, turned so the twine reads from above. */
function buildHayBale(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  b.box(0, 0.33, 0, 0.92, 0.62, 0.66, STRAW);
  b.box(0, 0.33, 0.34, 0.94, 0.58, 0.06, STRAW_DARK);
  b.box(0, 0.33, -0.34, 0.94, 0.58, 0.06, STRAW_DARK);
  b.box(0, 0.66, 0, 0.86, 0.06, 0.6, shade(STRAW, 1.08));
  b.material = MATERIAL.track;
  for (const x of [-0.2, 0.2]) b.box(x, 0.33, 0, 0.045, 0.64, 0.68, [0.22, 0.19, 0.13]);
  return b.build();
}

/** A tiered hay stack: three courses and a pitched cap. */
function buildHayStack(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  b.box(0, 0.34, 0, 1.7, 0.68, 1.1, STRAW_DARK);
  b.box(0, 0.94, 0, 1.5, 0.56, 0.96, STRAW);
  b.box(0, 1.42, 0, 1.24, 0.42, 0.8, STRAW);
  b.box(0, 1.76, 0, 0.9, 0.28, 0.6, shade(STRAW, 1.06));
  // Two ridge boards and a pole, so the cap reads as thatch rather than a box.
  b.material = MATERIAL.canvas;
  b.boxRot(0, 1.98, 0, 1.06, 0.1, 0.5, 0, shade(STRAW_DARK, 0.9));
  b.material = MATERIAL.canvas;
  b.box(0.72, 0.62, 0, 0.12, 1.24, 0.12, TIMBER);
  return b.build();
}

/** A concrete stock trough with a water surface and a float valve. */
function buildTrough(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.concrete;
  b.box(0, 0.24, 0, 1.24, 0.48, 0.62, STONE);
  b.box(0, 0.5, 0, 1.12, 0.08, 0.5, STONE_DARK);
  b.material = MATERIAL.glass;
  b.box(0, 0.49, 0, 1.0, 0.04, 0.4, PALETTE.glassDark);
  b.material = MATERIAL.bareMetal;
  b.box(0.5, 0.6, 0, 0.1, 0.3, 0.1, PALETTE.metal);
  b.box(0.5, 0.74, 0, 0.24, 0.06, 0.06, PALETTE.metal);
  return b.build();
}

/** A timber wind pump: four legs, cross bracing, fan head and tail vane. */
function buildWindpump(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.boxRot(sx * 0.34, 1.2, sz * 0.34, 0.1, 2.4, 0.1, sz * sx * 0.1, TIMBER);
    }
  }
  for (const y of [0.7, 1.7]) {
    b.box(0, y, 0.34, 0.78, 0.06, 0.06, TIMBER_LIGHT);
    b.box(0, y, -0.34, 0.78, 0.06, 0.06, TIMBER_LIGHT);
    b.box(0.34, y, 0, 0.06, 0.06, 0.78, TIMBER_LIGHT);
    b.box(-0.34, y, 0, 0.06, 0.06, 0.78, TIMBER_LIGHT);
  }
  // Pump head, fan shaft and the four-blade fan.
  b.material = MATERIAL.bareMetal;
  b.box(0, 2.52, 0, 0.34, 0.26, 0.34, STEEL);
  b.cylinderX(0.2, 2.52, 0, 0.05, 0.36, 6, PALETTE.darkMetal);
  b.material = MATERIAL.painted;
  b.box(0.4, 2.52, 0, 0.03, 1.5, 0.1, PALETTE.white);
  b.box(0.4, 2.52, 0, 0.03, 0.1, 1.5, PALETTE.white);
  b.box(0.4, 2.52, 0, 0.03, 0.82, 0.82, PALETTE.hullLight);
  // Tail vane on a boom, pointing away from the wind.
  b.material = MATERIAL.bareMetal;
  b.box(-0.36, 2.5, 0, 0.9, 0.06, 0.06, STEEL);
  b.material = MATERIAL.painted;
  b.box(-0.86, 2.62, 0, 0.36, 0.34, 0.04, PALETTE.white);
  return b.build();
}

/** A corrugated grain bin with a filling spout and ladder. */
function buildGrainSilo(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  b.cylinder(0, 0.12, 0, 0.56, 0.24, 12, STONE_DARK);
  b.cylinder(0, 1.5, 0, 0.5, 2.6, 12, [0.55, 0.55, 0.51]);
  for (const y of [0.5, 1.5, 2.5]) b.cylinder(0, y, 0, 0.52, 0.07, 12, [0.38, 0.38, 0.35]);
  // Cap: a shallow drum, then the spout and hatch.
  b.cylinder(0, 2.86, 0, 0.42, 0.16, 12, PALETTE.darkMetal);
  b.cylinder(0, 2.98, 0, 0.24, 0.14, 8, PALETTE.metal);
  b.box(0.36, 2.8, 0.2, 0.3, 0.5, 0.3, PALETTE.metal);
  b.box(0, 3.1, 0, 0.2, 0.14, 0.2, PALETTE.darkMetal);
  // Ladder up the shaded side.
  b.material = MATERIAL.bareMetal;
  for (const z of [-0.12, 0.12]) b.box(-0.52, 1.5, z, 0.05, 2.8, 0.05, PALETTE.metal);
  for (let i = 0; i < 7; i++) b.box(-0.52, 0.4 + i * 0.4, 0, 0.05, 0.04, 0.28, PALETTE.metal);
  return b.build();
}

/** A scarecrow on a cross post, with a coat that reads as a torso at zoom. */
function buildScarecrow(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  b.box(0, 0.86, 0, 0.11, 1.72, 0.11, TIMBER);
  b.box(0, 1.28, 0, 0.94, 0.07, 0.07, TIMBER_LIGHT);
  // Coat, belt and a hat: three masses that separate at any distance.
  b.box(0, 1.12, 0, 0.5, 0.62, 0.28, [0.36, 0.3, 0.22]);
  b.box(0, 0.84, 0, 0.44, 0.06, 0.3, [0.24, 0.2, 0.16]);
  b.material = MATERIAL.canvas;
  b.box(0, 1.5, 0, 0.42, 0.32, 0.24, [0.44, 0.34, 0.24]);
  b.sphere(0, 1.66, 0, 0.14, 4, 6, [0.55, 0.46, 0.34]);
  b.box(0, 1.8, 0, 0.4, 0.06, 0.36, STRAW_DARK);
  b.box(0, 1.88, 0, 0.24, 0.12, 0.24, STRAW);
  // Gloves on the crossbar ends.
  for (const x of [-0.44, 0.44]) b.box(x, 1.26, 0, 0.1, 0.14, 0.12, STRAW_DARK);
  return b.build();
}

/** A burnt tractor: chassis, engine, cab frame and one remaining wheel pair. */
function buildTractorWreck(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  b.box(0, 0.34, 0, 1.36, 0.3, 0.72, RUST);
  b.box(0.34, 0.66, 0, 0.66, 0.5, 0.66, RUST);
  b.box(0.34, 0.96, 0, 0.5, 0.14, 0.5, BURNT);
  b.box(-0.3, 0.78, 0, 0.52, 0.32, 0.6, BURNT);
  b.material = MATERIAL.bareMetal;
  b.box(0.42, 1.16, 0, 0.07, 0.5, 0.07, RUSTED_STEEL);
  b.boxRot(0.46, 1.4, 0, 0.16, 0.06, 0.55, 0, RUSTED_STEEL);
  b.box(-0.52, 0.5, 0, 0.4, 0.07, 0.6, RUSTED_STEEL);
  b.material = MATERIAL.track;
  for (const z of [-0.42, 0.42]) {
    b.cylinderZ(-0.36, 0.4, z, 0.36, 0.18, 10, PALETTE.rubber);
    b.cylinderZ(-0.36, 0.4, z, 0.15, 0.2, 8, PALETTE.metal);
  }
  // Front axle snapped: a bare stub on one side.
  b.material = MATERIAL.bareMetal;
  b.cylinderZ(0.44, 0.26, -0.38, 0.16, 0.12, 8, RUSTED_STEEL);
  return b.build();
}

/** A run of drystone wall: three courses of offset stones. */
function buildDrystoneWall(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.concrete;
  const lengths = [0.42, 0.36, 0.46, 0.34, 0.4];
  for (let row = 0; row < 3; row++) {
    const y = 0.12 + row * 0.2;
    const shrink = 1 - row * 0.1;
    let x = -0.54;
    for (let i = 0; i < lengths.length; i++) {
      const w = lengths[(i + row) % lengths.length] * shrink;
      b.box(x + w / 2, y, 0, w * 0.94, 0.2, 0.34 - row * 0.03, shade(STONE, 0.9 + ((i * 7 + row * 3) % 5) * 0.045));
      x += w;
      if (x > 0.5) break;
    }
  }
  b.box(0.5, 0.26, 0, 0.16, 0.52, 0.4, STONE_DARK);
  return b.build();
}

/** A park bench: cast legs, slat seat and back. */
function buildBench(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  for (const x of [-0.42, 0.42]) {
    b.box(x, 0.22, 0, 0.08, 0.44, 0.4, PALETTE.darkMetal);
    b.box(x, 0.46, 0, 0.06, 0.06, 0.44, PALETTE.darkMetal);
  }
  b.material = MATERIAL.canvas;
  for (let i = 0; i < 3; i++) b.box(0, 0.46, -0.16 + i * 0.16, 1.02, 0.05, 0.12, TIMBER_LIGHT);
  for (let i = 0; i < 2; i++) b.box(0, 0.66 + i * 0.18, -0.22, 1.02, 0.05, 0.1, TIMBER_LIGHT);
  b.material = MATERIAL.bareMetal;
  for (const x of [-0.44, 0.44]) b.box(x, 0.8, -0.22, 0.05, 0.42, 0.05, PALETTE.darkMetal);
  return b.build();
}

/** A pedestal litter bin with a domed lid. */
function buildBin(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  b.cylinder(0, 0.06, 0, 0.22, 0.12, 10, PALETTE.darkMetal);
  b.cylinder(0, 0.4, 0, 0.2, 0.56, 10, GREEN_PAINT);
  b.cylinder(0, 0.7, 0, 0.215, 0.07, 10, PALETTE.darkMetal);
  b.cylinder(0, 0.78, 0, 0.14, 0.1, 8, PALETTE.metal);
  b.box(0, 0.5, 0.17, 0.2, 0.12, 0.06, PALETTE.darkMetal);
  return b.build();
}

/** A kerbside hydrant: body, bonnet and two nozzle caps. */
function buildHydrant(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.painted;
  b.cylinder(0, 0.05, 0, 0.2, 0.1, 10, PALETTE.darkMetal);
  b.cylinder(0, 0.36, 0, 0.14, 0.54, 10, PALETTE.red);
  b.cylinder(0, 0.68, 0, 0.17, 0.12, 10, PALETTE.red);
  b.cylinder(0, 0.8, 0, 0.09, 0.14, 8, PALETTE.amber);
  b.material = MATERIAL.bareMetal;
  for (const z of [-0.16, 0.16]) b.cylinderZ(0, 0.44, z, 0.07, 0.12, 8, PALETTE.metal);
  b.box(0.16, 0.44, 0, 0.12, 0.1, 0.1, PALETTE.metal);
  return b.build();
}

/** A pedestrian bollard with a reflective band. */
function buildBollard(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  b.cylinder(0, 0.04, 0, 0.14, 0.08, 8, PALETTE.darkMetal);
  b.cylinder(0, 0.42, 0, 0.09, 0.76, 8, PALETTE.darkMetal);
  b.material = MATERIAL.painted;
  b.cylinder(0, 0.66, 0, 0.095, 0.1, 8, PALETTE.white);
  b.cylinder(0, 0.78, 0, 0.085, 0.04, 8, PALETTE.darkMetal);
  return b.build();
}

/** A bus shelter: two posts, a canopy, glazed back panel and a bench. */
function buildBusStop(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  for (const x of [-0.54, 0.54]) {
    for (const z of [-0.24, 0.24]) b.box(x, 1.16, z, 0.07, 2.32, 0.07, PALETTE.darkMetal);
  }
  b.material = MATERIAL.painted;
  b.box(0, 2.36, 0, 1.3, 0.1, 0.68, PALETTE.hullDark);
  b.box(0, 2.42, 0, 1.16, 0.05, 0.58, PALETTE.hull);
  // Glazed back and end panels.
  b.material = MATERIAL.glass;
  b.box(0, 1.2, -0.26, 1.16, 1.9, 0.04, PALETTE.glass);
  b.box(-0.57, 1.2, 0, 0.04, 1.9, 0.5, PALETTE.glassDark);
  b.material = MATERIAL.canvas;
  b.box(0, 0.5, -0.16, 0.92, 0.06, 0.28, TIMBER_LIGHT);
  b.material = MATERIAL.bareMetal;
  for (const x of [-0.36, 0.36]) b.box(x, 0.26, -0.16, 0.05, 0.44, 0.22, PALETTE.darkMetal);
  // Shelter flag and timetable plate.
  b.material = MATERIAL.painted;
  b.box(0.72, 1.6, 0, 0.34, 0.4, 0.05, PALETTE.amber);
  b.material = MATERIAL.bareMetal;
  b.box(0.72, 0.8, 0, 0.06, 1.6, 0.06, PALETTE.metal);
  return b.build();
}

/** A glazed phone box: four corner posts, glass on all sides, a crown roof. */
function buildPhoneBox(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.painted;
  b.box(0, 0.06, 0, 0.62, 0.12, 0.62, PALETTE.red);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(sx * 0.26, 1.14, sz * 0.26, 0.08, 2.0, 0.08, PALETTE.red);
    }
  }
  b.material = MATERIAL.glass;
  for (const sz of [-1, 1]) b.box(0, 1.2, sz * 0.28, 0.46, 1.7, 0.03, PALETTE.glass);
  for (const sx of [-1, 1]) b.box(sx * 0.28, 1.2, 0, 0.03, 1.7, 0.46, PALETTE.glass);
  b.material = MATERIAL.painted;
  b.box(0, 2.18, 0, 0.64, 0.14, 0.64, PALETTE.red);
  b.box(0, 2.32, 0, 0.5, 0.12, 0.5, PALETTE.red);
  b.material = MATERIAL.painted;
  b.box(0, 2.06, 0.3, 0.34, 0.14, 0.04, PALETTE.white);
  return b.build();
}

/** A pillar box on a post, with a slot and a collection plate. */
function buildMailbox(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  b.box(0, 0.34, 0, 0.09, 0.68, 0.09, PALETTE.darkMetal);
  b.material = MATERIAL.painted;
  b.box(0, 0.92, 0, 0.34, 0.44, 0.3, PALETTE.red);
  b.cylinder(0, 1.14, 0, 0.155, 0.1, 10, PALETTE.red);
  b.box(0, 1.0, 0.16, 0.2, 0.04, 0.04, PALETTE.hullDark);
  b.box(0, 0.86, 0.16, 0.16, 0.1, 0.02, PALETTE.white);
  return b.build();
}

/** A market kiosk: counter booth, awning and a stacked crate. */
function buildKiosk(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  b.box(0, 0.9, -0.08, 0.94, 1.8, 0.66, [0.38, 0.32, 0.24]);
  b.box(0, 0.92, 0.24, 0.7, 0.72, 0.06, PALETTE.glassDark);
  b.material = MATERIAL.canvas;
  b.box(0, 0.62, 0.34, 0.98, 0.08, 0.26, TIMBER_LIGHT);
  // Striped awning on two props.
  b.boxRot(0, 1.86, 0.26, 1.16, 0.06, 0.72, -0.22, PALETTE.white);
  b.boxRot(0, 1.86, 0.26, 1.17, 0.07, 0.2, -0.22, PALETTE.red);
  b.material = MATERIAL.bareMetal;
  for (const x of [-0.46, 0.46]) b.box(x, 1.66, 0.44, 0.05, 0.6, 0.05, PALETTE.metal);
  b.material = MATERIAL.canvas;
  b.box(0, 1.9, -0.2, 1.02, 0.1, 0.62, PALETTE.hullDark);
  b.box(0.62, 0.2, 0.3, 0.4, 0.4, 0.34, STRAW_DARK);
  return b.build();
}

/** A stone planter with three clipped shrubs. */
function buildPlanter(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.concrete;
  b.box(0, 0.2, 0, 1.0, 0.4, 0.6, STONE);
  b.box(0, 0.38, 0, 0.9, 0.06, 0.5, STONE_DARK);
  b.material = MATERIAL.canvas;
  b.box(0, 0.4, 0, 0.86, 0.03, 0.46, [0.2, 0.17, 0.12]);
  for (const [x, z, s] of [
    [-0.28, 0.06, 0.2],
    [0.02, -0.08, 0.24],
    [0.3, 0.06, 0.19],
  ] as const) {
    b.sphere(x, 0.56, z, s, 4, 6, [0.28, 0.34, 0.2]);
  }
  return b.build();
}

/** A traffic signal: post, mast arm, housing and three lenses. */
function buildTrafficLight(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  b.cylinder(0, 1.4, 0, 0.07, 2.8, 8, PALETTE.darkMetal);
  b.boxRot(0.45, 2.76, 0, 0.9, 0.08, 0.08, 0, PALETTE.darkMetal);
  b.material = MATERIAL.painted;
  b.box(0.86, 2.5, 0, 0.22, 0.62, 0.24, PALETTE.darkMetal);
  const lens: Array<[number, Color]> = [
    [2.74, PALETTE.red],
    [2.5, PALETTE.amber],
    [2.26, [0.32, 0.62, 0.3]],
  ];
  for (const [y, color] of lens) b.box(0.86, y, 0.13, 0.13, 0.13, 0.03, color);
  b.material = MATERIAL.bareMetal;
  b.box(0, 0.14, 0, 0.24, 0.28, 0.24, PALETTE.darkMetal);
  return b.build();
}

/** Two bike hoops in a small stand. */
function buildBikeRack(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  for (const x of [-0.3, 0.3]) {
    for (const z of [-0.3, 0.3]) b.box(x, 0.34, z, 0.05, 0.68, 0.05, PALETTE.metal);
    b.box(x, 0.68, 0, 0.05, 0.05, 0.65, PALETTE.metal);
    b.box(x, 0.42, 0, 0.05, 0.05, 0.62, PALETTE.metal);
  }
  b.box(0, 0.06, 0, 0.82, 0.05, 0.12, PALETTE.darkMetal);
  return b.build();
}

/** A picnic table with two attached benches and A-frame legs. */
function buildPicnicTable(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  for (let i = 0; i < 3; i++) b.box(0, 0.72, -0.16 + i * 0.16, 1.24, 0.06, 0.14, TIMBER_LIGHT);
  for (const z of [-0.46, 0.46]) {
    b.box(0, 0.44, z, 1.24, 0.06, 0.16, TIMBER_LIGHT);
  }
  for (const x of [-0.46, 0.46]) {
    b.boxRot(x, 0.38, 0.3, 0.08, 0.84, 0.08, 0.42, TIMBER);
    b.boxRot(x, 0.38, -0.3, 0.08, 0.84, 0.08, -0.42, TIMBER);
    b.box(x, 0.42, 0, 0.08, 0.06, 0.72, TIMBER);
  }
  return b.build();
}

/** A timber crate with a lid, corner posts and a diagonal brace. */
function buildCrate(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  b.box(0, 0.32, 0, 0.76, 0.64, 0.72, TIMBER_LIGHT);
  b.box(0, 0.66, 0, 0.8, 0.06, 0.76, TIMBER);
  for (const x of [-0.36, 0.36]) {
    for (const z of [-0.34, 0.34]) b.box(x, 0.32, z, 0.08, 0.68, 0.08, TIMBER);
  }
  b.boxRot(0, 0.32, 0.37, 0.92, 0.07, 0.04, 0.62, TIMBER_LIGHT);
  b.box(0, 0.58, 0.37, 0.5, 0.05, 0.02, PALETTE.hullDark);
  return b.build();
}

/** Three crates stacked at angles: a working dock, not a grid. */
function buildCrateStack(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  b.box(0, 0.3, 0, 0.8, 0.6, 0.74, TIMBER_LIGHT);
  b.boxRot(0.04, 0.86, -0.02, 0.7, 0.54, 0.64, 0.18, TIMBER);
  b.boxRot(-0.3, 0.26, 0.36, 0.52, 0.5, 0.46, -0.3, TIMBER_LIGHT);
  b.material = MATERIAL.bareMetal;
  for (const y of [0.18, 0.6]) b.box(0, y, 0.38, 0.72, 0.04, 0.03, PALETTE.darkMetal);
  return b.build();
}

/** A stack of pallets with the board gaps that make them read as timber. */
function buildPallet(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  for (let level = 0; level < 3; level++) {
    const y = 0.1 + level * 0.17;
    for (let i = 0; i < 4; i++) b.box(0, y, -0.36 + i * 0.24, 0.96, 0.05, 0.17, TIMBER_LIGHT);
    for (const x of [-0.38, 0, 0.38]) b.box(x, y - 0.07, 0, 0.1, 0.08, 0.76, TIMBER);
  }
  return b.build();
}

/** A ribbed steel drum with a bung and a rolled seam. */
function buildBarrel(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.painted;
  const paint: Color = [0.28, 0.34, 0.26];
  b.cylinder(0, 0.44, 0, 0.29, 0.88, 10, paint);
  for (const y of [0.28, 0.6]) b.cylinder(0, y, 0, 0.3, 0.05, 10, shade(paint, 0.8));
  b.cylinder(0, 0.9, 0, 0.27, 0.05, 10, PALETTE.metal);
  b.cylinder(0.12, 0.94, 0.1, 0.07, 0.06, 6, PALETTE.darkMetal);
  return b.build();
}

/** An open skip: tapered body, hinged lid and two lifting lugs. */
function buildDumpster(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  const paint: Color = [0.3, 0.33, 0.3];
  b.box(0, 0.5, 0, 1.1, 0.7, 0.66, paint);
  b.box(0, 0.86, 0, 1.14, 0.06, 0.7, shade(paint, 0.82));
  b.boxRot(0, 1.0, -0.3, 1.12, 0.06, 0.62, -0.5, shade(paint, 1.06));
  for (const x of [-0.46, 0.46]) {
    for (const z of [-0.24, 0.24]) b.cylinderZ(x, 0.16, z, 0.14, 0.1, 8, PALETTE.rubber);
  }
  b.material = MATERIAL.painted;
  for (const x of [-0.5, 0.5]) b.box(x, 0.92, 0.32, 0.12, 0.14, 0.06, PALETTE.amber);
  return b.build();
}

/** A freight container: corrugated sides, door end and corner castings. */
function buildContainer(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.painted;
  const paint: Color = [0.32, 0.36, 0.4];
  b.box(0, 0.78, 0, 1.5, 1.1, 0.86, paint);
  for (let i = 0; i < 8; i++) {
    const x = -0.66 + i * 0.19;
    for (const z of [-0.44, 0.44]) b.box(x, 0.78, z, 0.08, 1.02, 0.05, shade(paint, 0.86));
  }
  for (const z of [-0.44, 0.44]) b.box(0, 1.34, z, 1.52, 0.06, 0.06, shade(paint, 0.74));
  // Door end with two leaves, handles and a lock rod.
  b.box(0.76, 0.78, 0, 0.04, 1.04, 0.84, shade(paint, 0.9));
  b.box(0.78, 0.78, 0, 0.05, 1.0, 0.03, PALETTE.darkMetal);
  b.material = MATERIAL.bareMetal;
  for (const z of [-0.3, 0.3]) b.cylinderZ(0.8, 0.8, z, 0.03, 0.9, 6, PALETTE.metal);
  return b.build();
}

/** A skid-mounted generator: engine block, exhaust stack and fuel tank. */
function buildGenerator(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  b.box(0, 0.1, 0, 1.1, 0.16, 0.66, PALETTE.darkMetal);
  b.material = MATERIAL.painted;
  b.box(0, 0.5, 0, 0.96, 0.62, 0.58, GREEN_PAINT);
  b.box(0, 0.84, 0, 0.86, 0.08, 0.52, shade(GREEN_PAINT, 0.8));
  b.material = MATERIAL.bareMetal;
  b.cylinder(0.28, 0.72, 0.24, 0.07, 0.44, 8, PALETTE.darkMetal);
  b.box(-0.2, 0.4, 0.32, 0.5, 0.24, 0.06, PALETTE.metal);
  b.material = MATERIAL.painted;
  b.cylinder(-0.3, 0.72, -0.22, 0.16, 0.34, 8, PALETTE.oliveDark);
  b.box(-0.3, 0.92, -0.22, 0.16, 0.06, 0.16, PALETTE.amber);
  return b.build();
}

/** A timber cable drum on its side, with cable wound in the middle. */
function buildCableSpool(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  for (const x of [-0.28, 0.28]) b.cylinderX(x, 0.5, 0, 0.5, 0.08, 12, TIMBER_LIGHT);
  b.material = MATERIAL.track;
  b.cylinderX(0, 0.5, 0, 0.34, 0.44, 12, [0.12, 0.12, 0.11]);
  b.material = MATERIAL.canvas;
  b.box(0, 0.06, 0, 0.8, 0.06, 0.5, TIMBER);
  b.material = MATERIAL.bareMetal;
  b.cylinderX(0, 0.5, 0, 0.08, 0.72, 8, PALETTE.darkMetal);
  return b.build();
}

/** A leaning stack of tyres: four rings, each offset a little. */
function buildTyreStack(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.track;
  for (let i = 0; i < 4; i++) {
    const y = 0.14 + i * 0.22;
    const x = (i % 2 === 0 ? 1 : -1) * 0.04;
    b.cylinder(x, y, 0, 0.4, 0.2, 12, PALETTE.rubber);
    b.cylinder(x, y + 0.1, 0, 0.19, 0.06, 10, [0.1, 0.1, 0.1]);
  }
  return b.build();
}

/** Tube-and-board scaffold against a wall: uprights, rails, planks and a brace. */
function buildScaffold(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  for (const x of [-0.5, 0.5]) {
    for (const z of [-0.34, 0.34]) b.box(x, 1.6, z, 0.06, 3.2, 0.06, PALETTE.metal);
  }
  for (const y of [0.9, 1.9, 2.9]) {
    for (const z of [-0.34, 0.34]) b.box(0, y, z, 1.04, 0.05, 0.05, PALETTE.metal);
    b.box(-0.5, y, 0, 0.05, 0.05, 0.72, PALETTE.metal);
    b.box(0.5, y, 0, 0.05, 0.05, 0.72, PALETTE.metal);
  }
  b.boxRot(0, 1.9, -0.34, 1.5, 0.05, 0.05, 0.6, PALETTE.metal);
  b.material = MATERIAL.canvas;
  for (const y of [1.92, 2.92]) b.box(0, y, 0, 0.96, 0.05, 0.58, TIMBER_LIGHT);
  return b.build();
}

/** A horseshoe of filled sandbags around a firing step. */
function buildSandbagNest(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  const bag = (x: number, y: number, z: number, rot = 0): void => {
    b.boxRot(x, y, z, 0.42, 0.2, 0.28, rot, PALETTE.sandbag);
  };
  const rows = [
    { y: 0.1, r: 0.62, n: 9 },
    { y: 0.3, r: 0.56, n: 8 },
    { y: 0.5, r: 0.5, n: 6 },
  ];
  for (const { y, r, n } of rows) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 0.15 + (i / (n - 1)) * Math.PI * 1.7;
      bag(Math.cos(a) * r, y, Math.sin(a) * r, -a + Math.PI / 2);
    }
  }
  b.material = MATERIAL.concrete;
  b.box(0, 0.05, 0, 0.5, 0.1, 0.4, PALETTE.concreteDark);
  return b.build();
}

/** A concrete lane barrier with the tapered profile and lifting eyes. */
function buildJerseyBarrier(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.concrete;
  b.box(0, 0.14, 0, 1.3, 0.28, 0.5, PALETTE.concrete);
  b.box(0, 0.42, 0, 1.24, 0.3, 0.32, PALETTE.concrete);
  b.box(0, 0.62, 0, 1.2, 0.12, 0.2, PALETTE.concrete);
  b.material = MATERIAL.painted;
  b.box(0, 0.66, 0, 0.9, 0.03, 0.16, PALETTE.warning);
  b.material = MATERIAL.bareMetal;
  for (const x of [-0.3, 0.3]) b.box(x, 0.7, 0, 0.08, 0.06, 0.1, PALETTE.darkMetal);
  return b.build();
}

/** A Czech hedgehog: three steel beams crossing at right angles. */
function buildTankTrap(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.bareMetal;
  beam(b, [-0.52, 0.04, -0.34], [0.52, 1.06, 0.34], 0.07, RUSTED_STEEL);
  beam(b, [0.5, 0.04, -0.32], [-0.5, 1.0, 0.32], 0.07, RUSTED_STEEL);
  beam(b, [-0.2, 0.04, 0.5], [0.2, 1.02, -0.5], 0.07, RUSTED_STEEL);
  b.box(0, 0.05, 0, 0.44, 0.1, 0.44, PALETTE.concreteDark);
  return b.build();
}

/** Three ammunition crates stacked, lids latched and one open. */
function buildAmmoBoxes(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.painted;
  const box = (x: number, y: number, z: number, rot: number): void => {
    b.boxRot(x, y, z, 0.5, 0.3, 0.34, rot, PALETTE.oliveDark);
    b.boxRot(x, y + 0.17, z, 0.52, 0.05, 0.36, rot, PALETTE.olive);
  };
  box(0, 0.16, 0, 0);
  box(0.1, 0.48, 0.04, 0.12);
  box(-0.02, 0.8, -0.02, -0.18);
  b.material = MATERIAL.bareMetal;
  for (const x of [-0.12, 0.12]) b.box(x, 0.3, 0.18, 0.04, 0.1, 0.02, PALETTE.metal);
  return b.build();
}

/** A horizontal fuel drum on timber cradles with a hand pump. */
function buildFuelDrum(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.painted;
  b.cylinderX(0, 0.46, 0, 0.3, 0.9, 12, PALETTE.oliveDark);
  for (const x of [-0.28, 0.28]) b.cylinderX(x, 0.46, 0, 0.31, 0.05, 12, PALETTE.olive);
  b.cylinderX(0, 0.76, 0, 0.08, 0.12, 6, PALETTE.darkMetal);
  b.material = MATERIAL.canvas;
  for (const x of [-0.3, 0.3]) {
    b.box(x, 0.14, -0.2, 0.12, 0.28, 0.2, TIMBER);
    b.box(x, 0.14, 0.2, 0.12, 0.28, 0.2, TIMBER);
  }
  b.material = MATERIAL.bareMetal;
  b.box(0.46, 0.42, 0, 0.16, 0.16, 0.12, PALETTE.darkMetal);
  b.boxRot(0.52, 0.62, 0, 0.05, 0.4, 0.05, 0.4, PALETTE.metal);
  return b.build();
}

/** A striped trestle road block, one panel up and one collapsed. */
function buildRoadBlock(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.canvas;
  const trestle = (x: number, z: number, height: number, tilt: number): void => {
    b.boxRot(x, height / 2, z - 0.18, 0.07, height, 0.07, tilt * 0.4, TIMBER);
    b.boxRot(x, height / 2, z + 0.18, 0.07, height, 0.07, -tilt * 0.4, TIMBER);
    for (let i = 0; i < 3; i++) {
      b.box(x, height + 0.04 + i * 0.14, z, 1.1, 0.1, 0.04, i % 2 === 0 ? PALETTE.white : PALETTE.red);
    }
  };
  trestle(-0.3, 0.1, 0.86, 0);
  trestle(0.36, -0.12, 0.6, 0.3);
  b.material = MATERIAL.canvas;
  for (const x of [-0.3, 0.36]) b.box(x, 0.12, 0, 0.34, 0.24, 0.34, PALETTE.sandbag);
  return b.build();
}

/** A burnt saloon: hull, cabin, one axle on blocks, no glass. */
function buildCarWreck(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.painted;
  b.box(0, 0.36, 0, 1.3, 0.42, 0.66, BURNT);
  b.box(-0.06, 0.68, 0, 0.7, 0.36, 0.6, BURNT);
  b.box(-0.06, 0.86, 0, 0.52, 0.06, 0.5, ASH);
  b.box(0.6, 0.34, 0, 0.16, 0.28, 0.62, RUST);
  b.material = MATERIAL.track;
  for (const x of [-0.36, 0.4]) {
    for (const z of [-0.32, 0.32]) b.cylinderZ(x, 0.24, z, 0.24, 0.14, 10, PALETTE.rubber);
  }
  b.material = MATERIAL.glass;
  b.box(0.26, 0.72, 0, 0.04, 0.24, 0.5, PALETTE.glassDark);
  b.material = MATERIAL.bareMetal;
  b.boxRot(0.1, 0.96, 0.18, 0.5, 0.04, 0.2, 0.3, RUSTED_STEEL);
  return b.build();
}

/** A tipped lorry: cab on its side, flatbed across the lane. */
function buildTruckWreck(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.painted;
  b.box(-0.12, 0.34, 0.08, 1.6, 0.3, 0.78, RUST);
  b.box(-0.62, 0.62, 0.16, 0.52, 0.4, 0.72, BURNT);
  b.box(-0.62, 0.88, 0.16, 0.44, 0.1, 0.6, ASH);
  b.box(0.36, 0.72, -0.16, 1.0, 0.5, 0.5, BURNT);
  b.box(0.4, 0.98, -0.16, 0.9, 0.06, 0.44, ASH);
  b.material = MATERIAL.track;
  for (const x of [-0.5, 0.42]) {
    for (const z of [-0.36, 0.36]) b.cylinderZ(x, 0.2, z, 0.26, 0.16, 10, PALETTE.rubber);
  }
  b.material = MATERIAL.bareMetal;
  b.boxRot(0.78, 0.3, 0, 0.7, 0.08, 0.1, 0.2, RUSTED_STEEL);
  return b.build();
}

/** A burnt-out bus: long shell, window band, tilted onto one side. */
function buildBusWreck(): MeshBuffers {
  const b = new MeshBuilder();
  b.material = MATERIAL.painted;
  b.box(0, 0.5, 0, 2.0, 0.7, 0.86, BURNT);
  b.box(0, 1.2, 0, 1.9, 0.7, 0.82, BURNT);
  b.box(0, 1.56, 0, 1.94, 0.08, 0.78, ASH);
  b.material = MATERIAL.glass;
  for (let i = 0; i < 5; i++) b.box(-0.66 + i * 0.33, 1.24, 0.42, 0.24, 0.34, 0.03, PALETTE.glassDark);
  b.material = MATERIAL.painted;
  b.box(0.98, 0.86, 0, 0.06, 1.1, 0.8, RUST);
  b.material = MATERIAL.track;
  for (const x of [-0.7, 0.66]) {
    for (const z of [-0.46, 0.46]) b.cylinderZ(x, 0.3, z, 0.3, 0.16, 10, PALETTE.rubber);
  }
  b.material = MATERIAL.bareMetal;
  b.boxRot(-0.4, 1.62, 0.2, 0.9, 0.05, 0.3, 0.45, RUSTED_STEEL);
  return b.build();
}

const DECOR_MESHES: Record<string, () => MeshBuffers> = {
  bench: buildBench,
  bin: buildBin,
  hydrant: buildHydrant,
  bollard: buildBollard,
  busStop: buildBusStop,
  phoneBox: buildPhoneBox,
  mailbox: buildMailbox,
  kiosk: buildKiosk,
  planter: buildPlanter,
  trafficLight: buildTrafficLight,
  bikeRack: buildBikeRack,
  picnicTable: buildPicnicTable,
  hayBale: buildHayBale,
  hayStack: buildHayStack,
  trough: buildTrough,
  windpump: buildWindpump,
  grainSilo: buildGrainSilo,
  scarecrow: buildScarecrow,
  tractorWreck: buildTractorWreck,
  drystoneWall: buildDrystoneWall,
  crate: buildCrate,
  crateStack: buildCrateStack,
  pallet: buildPallet,
  barrel: buildBarrel,
  dumpster: buildDumpster,
  container: buildContainer,
  generator: buildGenerator,
  cableSpool: buildCableSpool,
  tyreStack: buildTyreStack,
  scaffold: buildScaffold,
  sandbagNest: buildSandbagNest,
  jerseyBarrier: buildJerseyBarrier,
  tankTrap: buildTankTrap,
  ammoBoxes: buildAmmoBoxes,
  fuelDrum: buildFuelDrum,
  roadBlock: buildRoadBlock,
  carWreck: buildCarWreck,
  truckWreck: buildTruckWreck,
  busWreck: buildBusWreck,
};

/** Every batch that owns an authored mesh rather than reusing a scatter batch. */
export const DECOR_BATCHES: readonly string[] = Object.keys(DECOR_MESHES);

const CACHE = new Map<string, MeshBuffers>();

/**
 * The authored mesh for a decor batch, or undefined for a legacy scatter batch
 * that the renderer already draws.
 */
export function buildDecorMesh(batch: string): MeshBuffers | undefined {
  const cached = CACHE.get(batch);
  if (cached) return cached;
  const build = DECOR_MESHES[batch];
  if (!build) return undefined;
  const mesh = build();
  CACHE.set(batch, mesh);
  return mesh;
}
