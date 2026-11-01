import { MeshBuilder, PALETTE, shade, type Color } from './geometry';
import type { MeshBuffers } from './gl';

/**
 * Team-masked ownership panel. A roof plate is the most reliable ownership
 * cue from the tactical camera: it survives zoom 36 without relying on the
 * flag cloth, which is only a few pixels wide at that distance.
 */
function ownershipPanel(
  b: MeshBuilder,
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  team = 0.68,
): void {
  b.box(x, y - 0.06, z, width + 0.22, 0.08, depth + 0.22, PALETTE.hullDark);
  b.box(x, y, z, width, 0.14, depth, PALETTE.hull, team);
  // A darker centre stripe keeps the panel from reading as a flat colour card.
  b.box(x, y + 0.09, z, width * 0.58, 0.03, depth * 0.3, PALETTE.hullDark, Math.min(0.4, team));
}

/**
 * Pitched field roof with a ridge along X. Built from two quads and two gable
 * triangles, which is enough to break up a box silhouette without adding a
 * mesh type, texture or draw call.
 */
function gableRoof(
  b: MeshBuilder,
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  depth: number,
  height: number,
  color: Color,
): void {
  const hw = width / 2;
  const hd = depth / 2;
  const ridge = baseY + height;
  const slope = shade(color, 1.06);
  const gable = shade(color, 0.8);
  b.addQuad([cx - hw, baseY, cz + hd], [cx + hw, baseY, cz + hd], [cx + hw, ridge, cz], [cx - hw, ridge, cz], slope);
  b.addQuad([cx + hw, baseY, cz - hd], [cx - hw, baseY, cz - hd], [cx - hw, ridge, cz], [cx + hw, ridge, cz], slope);
  b.addTriangle([cx - hw, baseY, cz - hd], [cx - hw, baseY, cz + hd], [cx - hw, ridge, cz], gable);
  b.addTriangle([cx + hw, baseY, cz + hd], [cx + hw, baseY, cz - hd], [cx + hw, ridge, cz], gable);
  // A darker ridge cap reads at battle zoom and hides the thin seam.
  b.box(cx, ridge + 0.04, cz, width + 0.15, 0.12, 0.22, PALETTE.hullDark);
}

function sandbagWall(
  b: MeshBuilder,
  x: number,
  z: number,
  length: number,
  horizontal: boolean,
  baseY = 0.28,
): void {
  const n = Math.max(2, Math.floor(length / 0.75));
  for (let i = 0; i < n; i++) {
    const off = -length / 2 + (i + 0.5) * (length / n);
    const px = horizontal ? x + off : x;
    const pz = horizontal ? z : z + off;
    b.box(px, baseY + (i % 2) * 0.08, pz, horizontal ? 0.72 : 0.55, 0.55, horizontal ? 0.55 : 0.72, PALETTE.sandbag);
  }
}

/**
 * Thick plate leaning back from its base. The coastal battery's blast
 * deflector needs a slope that a yaw-only box cannot express; five quads give
 * it a readable front, back, cap and side edges without a new mesh type.
 */
function slopedPlate(
  b: MeshBuilder,
  x: number,
  baseY: number,
  z: number,
  width: number,
  height: number,
  thickness: number,
  lean: number,
  color: Color,
): void {
  const hw = width / 2;
  const frontLeft: [number, number, number] = [x, baseY, z + hw];
  const frontRight: [number, number, number] = [x, baseY, z - hw];
  const frontTopLeft: [number, number, number] = [x - lean, baseY + height, z + hw];
  const frontTopRight: [number, number, number] = [x - lean, baseY + height, z - hw];
  const backLeft: [number, number, number] = [x - thickness, baseY, z + hw];
  const backRight: [number, number, number] = [x - thickness, baseY, z - hw];
  const backTopLeft: [number, number, number] = [x - lean - thickness, baseY + height, z + hw];
  const backTopRight: [number, number, number] = [x - lean - thickness, baseY + height, z - hw];
  b.addQuad(frontLeft, frontRight, frontTopRight, frontTopLeft, color);
  b.addQuad(backRight, backLeft, backTopLeft, backTopRight, shade(color, 0.8));
  b.addQuad(frontTopLeft, frontTopRight, backTopRight, backTopLeft, shade(color, 1.08));
  b.addQuad(frontRight, backRight, backTopRight, frontTopRight, shade(color, 0.9));
  b.addQuad(backLeft, frontLeft, frontTopLeft, backTopLeft, shade(color, 0.82));
}

/**
 * Occupied-shelter dressing: a concertina ring around the footprint, sandbag
 * firing positions on the roof and a team-tinted trim band. Team colour is
 * carried by masked vertices, so the same mesh is recoloured for whoever is
 * inside instead of needing one mesh per owner. The live flag rig is drawn
 * separately for every owned or garrisoned building.
 */
function garrisonDressing(
  b: MeshBuilder,
  opts: {
    halfX: number;
    halfZ: number;
    groundY: number;
    roofY: number;
    roofHalfX: number;
    roofHalfZ: number;
  },
): void {
  const { halfX, halfZ, groundY, roofY, roofHalfX, roofHalfZ } = opts;

  // Concertina wire ring, tied just outside the walls.
  const wireX = halfX + 0.55;
  const wireZ = halfZ + 0.55;
  const run = (ax: number, az: number, bx: number, bz: number): void => {
    const length = Math.hypot(bx - ax, bz - az);
    const segments = Math.max(2, Math.round(length / 1.1));
    const angle = Math.atan2(bz - az, bx - ax);
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const x0 = ax + (bx - ax) * t0;
      const z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1;
      const z1 = az + (bz - az) * t1;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      const span = Math.hypot(x1 - x0, z1 - z0) * 1.02;
      b.boxRot(mx, groundY + 0.44, mz, span, 0.055, 0.055, angle, PALETTE.metal);
      b.boxRot(mx, groundY + 0.26, mz, span * 0.94, 0.05, 0.05, angle + (i % 2 ? 0.4 : -0.4), PALETTE.darkMetal);
    }
  };
  run(-wireX, -wireZ, wireX, -wireZ);
  run(wireX, -wireZ, wireX, wireZ);
  run(wireX, wireZ, -wireX, wireZ);
  run(-wireX, wireZ, -wireX, -wireZ);
  for (const [x, z] of [
    [-wireX, -wireZ],
    [wireX, -wireZ],
    [wireX, wireZ],
    [-wireX, wireZ],
  ]) {
    b.box(x, groundY + 0.42, z, 0.11, 0.84, 0.11, PALETTE.darkMetal);
    b.box(x, groundY + 0.84, z, 0.16, 0.08, 0.16, PALETTE.warning);
  }

  // Team-tinted trim along the roof edge: the clearest ownership read from the
  // tactical camera.
  const trimY = roofY + 0.09;
  b.box(0, trimY, -roofHalfZ, roofHalfX * 2, 0.13, 0.1, PALETTE.hull, 1);
  b.box(0, trimY, roofHalfZ, roofHalfX * 2, 0.13, 0.1, PALETTE.hull, 1);
  b.box(-roofHalfX, trimY, 0, 0.1, 0.13, roofHalfZ * 2, PALETTE.hull, 1);
  b.box(roofHalfX, trimY, 0, 0.1, 0.13, roofHalfZ * 2, PALETTE.hull, 1);

  // Roof firing positions, kept clear of the stair housing and water tank.
  sandbagWall(b, 0, -roofHalfZ + 0.35, roofHalfX * 2 - 1.2, true, roofY + 0.18);
  sandbagWall(b, -roofHalfX + 0.35, 0.9, roofHalfZ * 1.2, false, roofY + 0.18);
  sandbagWall(b, roofHalfX - 0.35, 0.9, roofHalfZ * 1.2, false, roofY + 0.18);

  // Ground-level sandbags covering the entrance approach.
  sandbagWall(b, 0, halfZ + 1.1, halfX * 1.4, true, groundY + 0.3);
}

function buildCommandPost(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 15.6, 0.6, 15.6, PALETTE.concreteDark);
  b.box(0, 0.75, 0, 14.8, 0.5, 14.8, PALETTE.concrete);
  // Vehicle apron and the command entrance, kept clear of the operations mass
  // so the compound reads as a working headquarters rather than an empty slab.
  // Keep every apron layer above the slab top. Coplanar top faces at y=1.0
  // produced visible z-fighting on the headquarters approach.
  // The apron tucks 0.1 under the operations mass. A flush rear edge at
  // z = 3.1 was coplanar with the block's front wall and shimmered along the
  // entire base of the facade.
  b.box(0, 1.08, 4.95, 9.6, 0.12, 3.9, PALETTE.concreteDark);
  b.box(0, 1.175, 5.0, 8.8, 0.05, 3.0, [0.22, 0.23, 0.21]);
  for (const x of [-3.8, 3.8]) {
    b.box(x, 1.08, 6.1, 0.28, 0.08, 0.9, PALETTE.warning);
  }
  // Central operations block, with a stepped signals room above it.
  b.box(-0.6, 2.95, -0.7, 9.2, 4.1, 7.6, PALETTE.concrete);
  b.box(-0.6, 5.08, -0.7, 9.9, 0.36, 8.2, PALETTE.hullDark);
  b.box(-0.8, 6.25, -0.7, 5.4, 2.0, 4.6, PALETTE.hull);
  b.box(-0.8, 7.32, -0.7, 6.0, 0.28, 5.2, PALETTE.hullDark);
  // The light plate is 0.02 taller than the ownership panel's underside so the
  // panel bottom is buried in it. At exactly 7.61 both faces shared a plane
  // and fought across the whole 4.3 x 3.5 panel footprint.
  b.box(-0.8, 7.55, -0.7, 5.4, 0.16, 4.6, PALETTE.hullLight);
  ownershipPanel(b, -0.8, 7.68, -0.7, 4.3, 3.5);
  // A second operations wing gives the roof a layered silhouette without
  // turning the building into a plain rectangular block.
  b.box(-4.9, 2.25, -1.0, 2.8, 2.7, 5.8, PALETTE.concreteDark);
  b.box(-4.9, 3.75, -1.0, 3.2, 0.24, 6.2, PALETTE.hullDark);
  // This wing projects 0.06 past the central block on purpose. When both
  // masses ended on exactly x = 4.0 their outer faces were coplanar and the
  // whole 2.9 x 3.9 overlap z-fought; the reveal also gives the facade a
  // layered silhouette instead of one flat wall.
  b.box(2.83, 2.35, 1.2, 2.46, 2.9, 4.0, PALETTE.concreteDark);
  b.box(2.8, 3.96, 1.2, 2.8, 0.22, 4.4, PALETTE.hullDark);
  // Glazed watch floor and entrance canopy. The two glass boxes are kept apart
  // so their front faces cannot occupy the same plane.
  b.box(2.6, 4.25, 3.25, 2.8, 0.95, 0.22, PALETTE.glassDark);
  b.box(-2.2, 4.25, 3.3, 4.2, 0.9, 0.18, PALETTE.glassDark);
  b.box(-4.9, 2.8, 1.96, 2.2, 0.8, 0.2, PALETTE.glassDark);
  b.box(-0.6, 3.0, 3.25, 4.4, 0.24, 0.18, PALETTE.hullLight);
  // Sink the entrance 0.03 into the deck so its bottom face is not coplanar
  // with the slab top at y = 1.0.
  b.box(-0.6, 2.02, 3.55, 1.9, 2.1, 0.24, PALETTE.hullDark);
  b.box(-0.6, 1.92, 3.7, 1.6, 1.9, 0.12, PALETTE.glassDark);
  b.box(-0.6, 3.3, 4.15, 4.8, 0.28, 2.0, PALETTE.hullDark);
  for (const x of [-2.5, 1.3]) {
    b.box(x, 1.85, 4.45, 0.16, 2.6, 0.16, PALETTE.metal);
  }
  // Communications cluster: rotor mast, whip antenna and a fixed dish.
  b.box(-4.8, 6.0, -4.4, 0.22, 6.2, 0.22, PALETTE.metal);
  b.box(-4.8, 3.6, -4.4, 0.9, 0.14, 0.9, PALETTE.darkMetal);
  b.box(3.6, 5.4, -4.03, 0.16, 4.0, 0.16, PALETTE.metal);
  b.box(3.6, 7.4, -4.0, 1.5, 1.0, 0.16, PALETTE.hullLight);
  b.box(3.6, 7.4, -4.18, 0.9, 0.58, 0.2, PALETTE.hullDark);
  b.box(-2.6, 7.05, -3.9, 0.14, 2.4, 0.14, PALETTE.metal);
  b.box(-2.6, 8.2, -3.9, 0.8, 0.16, 0.16, PALETTE.warning);
  // Bollards and roof lights. The old perimeter sandbag walls used the
  // default 0.28 base height, which buried them inside the 1.0-high plinth
  // while their ends clipped through its rim as a dotted line; removed rather
  // than left as hidden geometry with visible slivers.
  for (const x of [-6.2, 6.2]) {
    b.box(x, 0.9, 6.2, 0.5, 0.8, 0.5, PALETTE.warning);
  }
  b.box(-3.0, 5.32, 3.0, 0.5, 0.15, 0.5, PALETTE.amber);
  b.box(2.0, 5.32, -2.6, 0.5, 0.15, 0.5, PALETTE.amber);

  // Facade layering. The operations block used to present one dark plane with
  // two glass strips laid on it. The building now has a structural frame: two
  // concrete pilasters, a deep sill course, an entrance surround and a team
  // plaque over the door. Each box is deliberately set a few centimetres into
  // the wall rather than flush with it; the earlier coplanar slab caused
  // z-fighting across the whole approach.
  for (const x of [-4.85, 0.55]) {
    b.box(x, 3.05, 3.16, x > -4 ? 0.42 : 0.38, 3.95, 0.34, PALETTE.concreteDark);
  }
  b.box(-0.6, 4.8, 3.14, 9.5, 0.16, 0.36, PALETTE.concrete);
  b.box(-2.2, 3.72, 3.22, 4.5, 0.12, 0.3, PALETTE.concrete);
  b.box(2.6, 3.72, 3.22, 3.05, 0.12, 0.3, PALETTE.concrete);
  // Entrance surround and three shallow steps down to the apron.
  for (const x of [-1.62, 0.42]) {
    b.box(x, 2.35, 3.62, 0.16, 2.45, 0.24, PALETTE.hullLight);
  }
  b.box(-0.6, 3.14, 3.62, 2.24, 0.18, 0.24, PALETTE.hullLight);
  b.box(-0.6, 1.26, 3.86, 2.2, 0.12, 0.34, PALETTE.concreteDark);
  b.box(-0.6, 1.25, 4.06, 2.0, 0.1, 0.32, PALETTE.concrete);
  b.box(-0.6, 1.24, 4.27, 1.8, 0.08, 0.3, PALETTE.concreteDark);
  // The roof panel handles the overhead read; this framed plaque carries the
  // same ownership cue down to the approach. A roof-panel profile would read
  // as a thin stripe on a wall, so the wall version is a vertical sign.
  b.box(-0.6, 3.56, 3.17, 2.9, 0.4, 0.16, PALETTE.hullDark);
  b.box(-0.6, 3.56, 3.27, 2.6, 0.24, 0.1, PALETTE.hull, 0.78);
  // Service conduits under the window band read as utility runs, not trim.
  b.box(-2.4, 1.5, 3.17, 3.2, 0.08, 0.14, PALETTE.darkMetal);
  b.box(2.4, 1.5, 3.17, 1.4, 0.08, 0.14, PALETTE.darkMetal);
  // Upper operations room gains a shallow observation band and a sill.
  b.box(-0.8, 5.9, 1.64, 3.0, 0.58, 0.18, PALETTE.glassDark);
  b.box(-0.8, 5.56, 1.65, 3.2, 0.12, 0.24, PALETTE.concrete);
  b.box(-0.8, 6.22, 1.65, 3.2, 0.12, 0.24, PALETTE.concrete);
  // Rooftop plant on the low wing. The bottom is sunk into the roof plate so
  // the unit cannot float or share the cap's plane.
  b.box(-4.9, 4.14, -2.6, 1.1, 0.55, 1.1, PALETTE.metal);
  b.cylinder(-4.9, 4.5, -2.6, 0.26, 0.24, 7, PALETTE.darkMetal);
  // Rear downpipes tie the parapet to the slab without crossing a window.
  for (const x of [-5.12, 3.92]) {
    b.cylinder(x, 3.0, -4.56, 0.07, 3.8, 6, PALETTE.darkMetal);
  }
  return b.build();
}

function buildBarracks(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 11.8, 0.6, 11.8, PALETTE.concreteDark);
  b.box(0, 0.7, 0, 11.0, 0.4, 11.0, PALETTE.concrete);
  // Accommodation block: taller walls and a stepped field roof instead of a
  // low storehouse shed.
  b.box(-0.4, 2.3, -1.0, 8.8, 3.0, 7.0, PALETTE.canvas);
  b.box(-0.4, 3.78, -1.0, 9.8, 0.35, 8.0, PALETTE.oliveDark);
  gableRoof(b, -0.4, 3.95, -1.0, 9.8, 7.8, 1.15, PALETTE.olive);
  // Ridge monitor carries the ownership panel and gives the roof a field
  // headquarters silhouette rather than a storehouse gable.
  b.box(-0.4, 5.3, -1.6, 2.9, 0.46, 1.9, PALETTE.oliveDark);
  ownershipPanel(b, -0.4, 5.57, -1.6, 2.4, 1.45);
  // A short accommodation wing breaks the main roof line.
  b.box(-4.9, 1.85, -2.9, 2.0, 2.2, 2.6, PALETTE.canvas);
  b.box(-4.9, 3.0, -2.9, 2.3, 0.2, 2.9, PALETTE.oliveDark);
  // Windows and the squad-bay entrance under a deep canopy.
  for (const z of [-3.4, -1.7, 0.0]) {
    b.box(-1.1, 2.65, z, 1.1, 0.65, 0.5, PALETTE.glassDark);
    b.box(-1.1, 3.02, z, 1.25, 0.14, 0.56, PALETTE.hullLight);
  }
  for (const z of [-2.9, -1.0, 0.9]) {
    b.box(4.02, 2.65, z, 0.18, 0.65, 1.1, PALETTE.glassDark);
    b.box(4.12, 3.02, z, 0.1, 0.14, 1.25, PALETTE.hullLight);
  }
  for (const x of [-3.7, 0.9]) {
    b.box(x, 2.35, 2.52, 1.1, 1.5, 0.18, PALETTE.hullDark);
    b.box(x, 2.35, 2.63, 0.9, 1.3, 0.08, PALETTE.glassDark);
  }
  b.box(2.6, 1.85, 2.52, 2.8, 2.3, 0.12, PALETTE.oliveDark);
  b.box(2.6, 1.7, 2.62, 2.3, 1.9, 0.1, [0.05, 0.055, 0.05]);
  b.box(2.6, 2.88, 2.62, 3.0, 0.18, 0.18, PALETTE.oliveDark);
  b.box(2.6, 3.02, 3.2, 4.0, 0.28, 2.2, PALETTE.oliveDark);
  b.box(2.6, 3.2, 3.2, 3.4, 0.12, 1.8, PALETTE.canvas);
  for (const x of [0.9, 4.3]) {
    b.box(x, 1.65, 4.0, 0.18, 2.6, 0.18, PALETTE.metal);
  }
  // Staging crates, a field notice board and a low sandbag line.
  b.box(-3.2, 1.0, 3.4, 1.2, 0.8, 1.2, PALETTE.oliveDark);
  b.box(-3.2, 1.8, 3.4, 0.9, 0.4, 0.9, PALETTE.olive);
  b.box(-4.8, 1.3, 2.9, 0.12, 1.5, 0.9, PALETTE.hullLight);
  b.box(-4.8, 1.85, 2.9, 0.08, 0.35, 0.65, PALETTE.warning, 0.7);
  sandbagWall(b, 3.8, 5.0, 4.0, true);
  return b.build();
}

function buildFactory(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 15.8, 0.6, 11.8, PALETTE.concreteDark);
  b.box(0, 0.75, 0, 15.2, 0.4, 11.2, PALETTE.concrete);
  b.box(-0.5, 3.2, 0, 12.4, 4.8, 9.0, PALETTE.hull);
  b.box(-0.5, 5.7, 0, 13.2, 0.5, 9.8, PALETTE.oliveDark);
  // Garage bay: a steel frame around a dark mouth. The corrugated shutter is a
  // separate mesh raised by the renderer while a vehicle is rolling out.
  b.box(-0.5, 2.95, 4.62, 5.8, 4.1, 0.3, PALETTE.hullDark);
  b.box(-0.5, 2.75, 4.74, 4.6, 3.5, 0.16, [0.05, 0.055, 0.055]);
  b.box(-0.5, 4.6, 4.7, 5.6, 0.36, 0.26, PALETTE.warning);
  b.box(-0.5, 0.95, 4.85, 5.2, 0.22, 0.5, PALETTE.concreteDark);
  b.box(-5.2, 2.4, 4.66, 0.3, 3.0, 0.3, PALETTE.metal);
  b.box(4.2, 2.4, 4.66, 0.3, 3.0, 0.3, PALETTE.metal);
  for (let i = 0; i < 5; i++) {
    b.box(-5.0 + i * 2.2, 5.9, 0, 1.6, 0.4, 1.4, PALETTE.metal);
    b.box(-5.0 + i * 2.2, 6.2, 0, 1.1, 0.2, 0.9, PALETTE.darkMetal);
  }
  b.box(5.4, 4.0, -3.2, 2.0, 5.0, 2.0, PALETTE.concrete);
  b.box(5.4, 6.8, -3.2, 1.4, 1.4, 1.4, PALETTE.darkMetal);
  b.box(5.4, 7.6, -3.2, 1.0, 0.2, 1.0, PALETTE.warning);
  b.box(-5.4, 4.6, -4.4, 0.2, 6.0, 0.2, PALETTE.metal);
  b.box(-3.9, 6.4, -4.4, 3.2, 0.18, 0.18, PALETTE.metal);
  b.box(-2.5, 5.9, -4.4, 0.15, 0.9, 0.15, PALETTE.metal);
  b.box(-2.5, 5.4, -4.4, 0.5, 0.1, 0.5, PALETTE.warning);
  b.box(0, 5.9, 3.2, 4.6, 0.15, 0.15, PALETTE.hull, 0.85);
  ownershipPanel(b, 0, 6.42, 1.2, 4.8, 2.4);
  sandbagWall(b, -6.2, 2.8, 4.2, false);
  b.box(3.8, 1.0, 4.1, 1.2, 0.8, 1.2, PALETTE.oliveDark);
  b.box(5.0, 1.0, 4.0, 1.2, 0.8, 1.2, PALETTE.olive);
  return b.build();
}

function buildRefinery(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 15.8, 0.6, 11.8, PALETTE.concreteDark);
  b.box(0, 0.75, 0, 15.2, 0.4, 11.2, PALETTE.concrete);
  // Storage silos, with a team-painted band and a connecting catwalk.
  b.cylinder(-3.8, 3.6, -2.6, 2.6, 6.2, 10, PALETTE.metal);
  b.cylinder(-3.8, 6.75, -2.6, 2.7, 0.3, 10, PALETTE.hullDark);
  b.cylinder(0.2, 4.3, -2.6, 2.1, 7.6, 10, PALETTE.hullLight);
  b.cylinder(0.2, 4.55, -2.6, 2.16, 0.42, 10, PALETTE.hull, 0.86);
  b.cylinder(0.2, 8.15, -2.6, 2.2, 0.3, 10, PALETTE.hullDark);
  b.box(-1.8, 5.55, -2.6, 6.2, 0.22, 1.0, PALETTE.metal);
  for (const x of [-4.3, -2.6, -1.0, 0.6]) {
    b.box(x, 5.95, -3.05, 0.1, 0.8, 0.1, PALETTE.metal);
  }
  for (const x of [-4.3, -1.0, 2.4]) {
    b.box(x, 5.95, -2.15, 0.1, 0.8, 0.1, PALETTE.metal);
  }
  // Processing hall and control room.
  b.box(4.0, 2.2, 1.1, 5.8, 3.7, 4.8, PALETTE.hull);
  b.box(4.0, 3.82, 1.1, 6.2, 0.4, 5.2, PALETTE.oliveDark);
  ownershipPanel(b, 4.0, 4.05, 1.1, 4.6, 2.8);
  b.box(4.0, 5.0, -2.6, 5.2, 1.8, 2.2, PALETTE.oliveDark);
  b.box(4.0, 5.9, -2.6, 4.4, 0.2, 1.8, PALETTE.metal);
  b.box(4.0, 4.9, -1.42, 3.0, 0.6, 0.16, PALETTE.glassDark);
  b.box(6.0, 2.8, 1.1, 1.2, 1.0, 2.2, PALETTE.glassDark);
  b.cylinderX(4.0, 3.65, -2.6, 0.4, 6.6, 8, PALETTE.metal);
  b.cylinderX(1.0, 2.5, -2.6, 0.3, 4.0, 8, PALETTE.darkMetal);
  // Unloading bay: a deep delivery mouth with a hazard frame, apron and hopper.
  b.box(1.6, 0.98, 4.75, 7.4, 0.18, 2.0, PALETTE.concreteDark);
  b.box(1.6, 1.1, 3.6, 5.6, 0.3, 0.5, PALETTE.warning);
  b.box(1.6, 2.05, 3.38, 5.4, 2.8, 0.42, PALETTE.hullDark);
  b.box(1.6, 1.95, 3.6, 3.9, 2.3, 0.14, [0.04, 0.05, 0.05]);
  b.box(1.6, 3.28, 3.55, 4.7, 0.3, 0.3, PALETTE.warning);
  b.box(0.6, 2.55, 2.3, 2.4, 1.5, 1.9, PALETTE.darkMetal);
  b.box(0.6, 3.25, 2.3, 2.7, 0.18, 2.2, PALETTE.metal);
  b.box(0.6, 2.8, 3.28, 1.7, 0.7, 0.12, PALETTE.amber);
  // Conveyor into the hopper, with a visible belt and skirt.
  b.boxRot(-1.8, 2.75, 3.6, 7.2, 0.5, 1.25, -0.22, PALETTE.darkMetal);
  b.boxRot(-1.8, 3.02, 3.6, 6.5, 0.12, 0.8, -0.22, PALETTE.amber);
  for (const x of [-4.8, -2.8, -0.8]) {
    b.box(x, 2.0, 3.1, 0.18, 1.6, 0.18, PALETTE.metal);
  }
  b.box(5.3, 1.1, 4.1, 1.4, 0.65, 1.4, PALETTE.amber);
  b.box(5.3, 1.6, 4.1, 1.0, 0.4, 1.0, [0.95, 0.68, 0.28]);
  b.box(0, 3.2, 2.0, 5.0, 0.25, 0.25, PALETTE.hull, 0.9);
  b.box(-3.8, 2.0, 4.2, 0.4, 3.0, 0.4, PALETTE.warning);
  return b.build();
}

function buildAirfield(): MeshBuffers {
  const b = new MeshBuilder();
  // Pale concrete flight apron. The shipyard keeps the darker working quay,
  // so the two strategic sites no longer share the same dark rectangular base.
  b.box(0, 0.15, 0, 23.6, 0.3, 19.6, [0.31, 0.32, 0.3]);
  b.box(0, 0.34, 0, 22.8, 0.12, 18.8, [0.36, 0.37, 0.34]);
  // Runway, threshold keys, centreline and edge lights: the "air" read that
  // survives the tactical camera without relying on the hangar silhouette.
  b.box(0, 0.44, 2.6, 20.0, 0.1, 3.4, [0.1, 0.11, 0.12]);
  for (let i = 0; i < 5; i++) {
    b.box(-6.0 + i * 3.0, 0.505, 2.6, 1.5, 0.03, 0.18, PALETTE.white);
  }
  for (const x of [-9.2, 9.2]) {
    for (let i = 0; i < 3; i++) {
      b.box(x, 0.505, 1.2 + i * 1.3, 0.75, 0.03, 0.62, PALETTE.white);
    }
  }
  for (const z of [1.0, 4.2]) {
    for (let i = 0; i < 4; i++) {
      b.box(-7.2 + i * 4.8, 0.51, z, 0.18, 0.06, 0.18, PALETTE.amber);
    }
  }
  // Taxiway from the runway threshold to the hangar, with a lead line.
  b.box(-8.2, 0.44, -1.25, 2.2, 0.1, 4.3, [0.13, 0.14, 0.15]);
  b.box(-8.2, 0.5, -1.25, 0.12, 0.03, 4.1, PALETTE.warning);
  // Hangar with a real gable and overhanging eaves instead of a flat lid. The
  // door opening and head stay on the exact authored plane of the shutter.
  b.box(-8.2, 2.48, -6.4, 6.4, 4.25, 5.4, PALETTE.hull);
  const eave = 4.6;
  const ridge = 5.95;
  b.addQuad(
    [-8.2, ridge, -9.3],
    [-8.2, ridge, -3.5],
    [-4.6, eave, -3.5],
    [-4.6, eave, -9.3],
    shade(PALETTE.olive, 1.06),
  );
  b.addQuad(
    [-11.8, eave, -9.3],
    [-11.8, eave, -3.5],
    [-8.2, ridge, -3.5],
    [-8.2, ridge, -9.3],
    shade(PALETTE.olive, 1.06),
  );
  b.addTriangle([-4.6, eave, -9.3], [-11.8, eave, -9.3], [-8.2, ridge, -9.3], PALETTE.oliveDark);
  b.addTriangle([-11.8, eave, -3.5], [-4.6, eave, -3.5], [-8.2, ridge, -3.5], PALETTE.oliveDark);
  b.box(-8.2, ridge + 0.05, -6.4, 0.5, 0.14, 6.0, PALETTE.hullDark);
  b.box(-8.2, 4.56, -6.4, 7.4, 0.18, 6.0, PALETTE.hullDark);
  // Flat ridge monitor carries the team panel above the pitched roof.
  b.box(-8.2, 6.22, -6.4, 4.6, 0.42, 1.5, PALETTE.hullDark);
  ownershipPanel(b, -8.2, 6.46, -6.4, 4.1, 1.2);
  // Hangar mouth: dark aperture, hazard head and sill, shutter in front.
  b.box(-8.2, 2.15, -3.66, 5.2, 3.9, 0.28, PALETTE.hullDark);
  b.box(-8.2, 2.1, -3.49, 4.6, 3.4, 0.1, [0.05, 0.055, 0.06]);
  b.box(-8.2, 3.85, -3.58, 5.4, 0.26, 0.22, PALETTE.warning);
  b.box(-8.2, 1.25, -3.5, 5.2, 0.35, 0.3, PALETTE.warning);
  b.box(-8.2, 4.07, -3.62, 5.6, 0.16, 0.1, PALETTE.hull, 0.9);
  // Side buttresses break up the hangar box from three-quarter angles.
  for (const x of [-11.3, -5.1]) {
    for (const z of [-8.7, -6.4, -4.1]) {
      b.box(x, 2.4, z, 0.3, 3.6, 0.45, PALETTE.hullDark);
    }
  }
  // Control tower: a glazed all-round cab, a painted ownership band, and the
  // existing swept approach radar above it.
  b.box(8.4, 2.84, -7.0, 3.0, 4.9, 3.0, PALETTE.concrete);
  b.box(8.4, 5.89, -7.0, 4.2, 1.2, 4.2, PALETTE.hull);
  b.box(8.4, 5.42, -7.0, 4.4, 0.2, 4.4, PALETTE.hull, 0.9);
  b.box(8.4, 5.92, -4.92, 3.4, 0.64, 0.1, PALETTE.glassDark);
  b.box(8.4, 5.92, -9.08, 3.4, 0.64, 0.1, PALETTE.glassDark);
  b.box(6.32, 5.92, -7.0, 0.1, 0.64, 3.0, PALETTE.glassDark);
  b.box(10.48, 5.92, -7.0, 0.1, 0.64, 3.0, PALETTE.glassDark);
  b.box(8.4, 6.6, -7.0, 4.8, 0.24, 4.8, PALETTE.hullDark);
  b.box(8.4, 7.71, -7.0, 0.18, 2.02, 0.18, PALETTE.metal);
  b.box(8.4, 8.3, -7.0, 1.4, 0.2, 0.5, PALETTE.metal);
  b.box(6.4, 1.9, -7.0, 1.4, 3.0, 2.0, PALETTE.concreteDark);
  // Fuel farm behind the tower, with a bund, transfer pipe and pump house.
  b.box(3.6, 0.46, -7.6, 4.6, 0.14, 2.8, PALETTE.concreteDark);
  b.cylinder(2.7, 1.42, -7.6, 0.88, 1.8, 9, PALETTE.metal);
  b.cylinder(4.5, 1.27, -7.6, 0.72, 1.5, 9, PALETTE.hullLight);
  b.box(3.6, 0.98, -6.45, 3.4, 0.14, 0.14, PALETTE.darkMetal);
  b.box(5.7, 0.95, -7.6, 0.9, 0.84, 0.9, PALETTE.oliveDark);
  b.box(5.7, 1.32, -7.6, 0.7, 0.18, 0.7, PALETTE.olive);
  // A parked strike fighter on the apron: the clearest scale and role cue an
  // airfield can carry without adding a moving aircraft entity.
  const jetZ = 6.0;
  b.box(2.6, 0.78, jetZ, 4.6, 0.52, 0.8, PALETTE.hullLight);
  b.box(0.05, 0.73, jetZ, 0.7, 0.34, 0.5, PALETTE.hullLight);
  b.box(-0.28, 0.72, jetZ, 0.25, 0.24, 0.34, PALETTE.hullLight);
  b.box(3.1, 1.13, jetZ, 1.0, 0.22, 0.56, PALETTE.glassDark);
  b.box(3.1, 1.17, jetZ, 0.9, 0.16, 0.46, PALETTE.glass);
  for (const side of [-1, 1]) {
    b.boxRot(2.0, 0.9, jetZ + side * 1.1, 1.7, 0.1, 1.6, side * 0.4, PALETTE.hullLight);
  }
  b.box(4.45, 0.9, jetZ, 0.7, 0.08, 2.0, PALETTE.hullLight);
  for (const side of [-1, 1]) {
    b.box(4.45, 1.22, jetZ + side * 0.45, 0.16, 0.7, 0.5, PALETTE.hullLight);
  }
  // Team band around the fuselage, readable even without the flag.
  b.box(1.2, 0.87, jetZ, 0.5, 0.18, 0.82, PALETTE.hull, 0.9);
  for (const [x, side] of [
    [1.3, 0],
    [3.2, -0.8],
    [3.2, 0.8],
  ] as Array<[number, number]>) {
    b.box(x, 0.63, jetZ + side, 0.22, 0.5, 0.22, PALETTE.darkMetal);
  }
  // Windsock, a flag dais and a painted team line along the apron edge.
  b.box(-10.8, 2.0, 8.4, 0.1, 4.0, 0.1, PALETTE.metal);
  b.box(-10.45, 3.6, 8.4, 0.7, 0.3, 0.12, PALETTE.warning);
  b.box(-9.95, 3.52, 8.4, 0.4, 0.18, 0.1, PALETTE.white);
  b.box(0, 0.39, 8.8, 2.4, 0.06, 1.2, PALETTE.concrete);
  b.box(0, 0.43, 8.8, 2.0, 0.02, 0.9, PALETTE.hull, 0.9);
  b.box(0, 0.43, 7.6, 16.0, 0.03, 0.22, PALETTE.hull, 0.85);
  for (const x of [-7.5, 7.5]) {
    b.box(x, 0.44, 7.6, 0.3, 0.04, 0.22, PALETTE.warning);
  }
  // Towing tractor by the hangar apron.
  b.box(-5.2, 0.65, -1.6, 1.6, 0.5, 0.9, PALETTE.oliveDark);
  b.box(-5.7, 0.94, -1.6, 0.6, 0.4, 0.8, PALETTE.canvas);
  b.box(-4.6, 0.86, -1.6, 0.35, 0.35, 0.85, PALETTE.warning);
  return b.build();
}

function buildShipyard(): MeshBuffers {
  const b = new MeshBuilder();
  // Working quay built as a ring around an open slipway, not a slab with a
  // painted puddle. The basin runs out through the seaward footprint edge, so
  // when the yard turns its local +Z to the coast the dock water joins the sea
  // instead of stopping at a concrete sill or a shutter in an unwalled yard.
  b.box(-7.3, 0.25, 0, 5.0, 0.5, 19.6, PALETTE.concreteDark);
  b.box(7.3, 0.25, 0, 5.0, 0.5, 19.6, PALETTE.concreteDark);
  b.box(0, 0.25, -6.9, 9.6, 0.5, 5.8, PALETTE.concreteDark);
  b.box(-7.3, 0.53, 0, 4.8, 0.1, 18.8, PALETTE.concrete);
  b.box(7.3, 0.53, 0, 4.8, 0.1, 18.8, PALETTE.concrete);
  b.box(0, 0.53, -6.9, 9.2, 0.1, 5.4, PALETTE.concrete);
  // The wet dock sits at terrain level so it meets the sea at the open mouth.
  // Matched to the open-sea value rather than a near-black panel: the dock has
  // to read as the same water the slipway opens onto.
  b.box(0, 0.06, 2.99, 9.64, 0.04, 14.02, [0.045, 0.19, 0.24]);
  // Fender strips and mooring eyes sit flush in the inner quay faces rather
  // than floating a few centimetres off them.
  for (const x of [-4.76, 4.76]) {
    b.box(x, 0.96, 2.9, 0.08, 0.16, 13.4, PALETTE.darkMetal);
    for (const z of [-2.6, 1.2, 5.0, 8.6]) {
      b.box(x, 0.62, z, 0.14, 0.32, 0.14, PALETTE.metal);
    }
  }
  // Corvette under construction across the rear hardstand. Built broadside to
  // the tactical camera so the hull, bridge and funnel read as a ship, not a
  // box behind the slipway gate.
  b.box(4.7, 1.25, -5.45, 6.0, 0.9, 2.8, [0.3, 0.33, 0.34]);
  b.addQuad(
    [7.7, 0.8, -4.05],
    [7.7, 1.7, -4.05],
    [8.6, 1.6, -5.35],
    [8.6, 0.85, -5.35],
    [0.26, 0.29, 0.31],
  );
  b.addQuad(
    [7.7, 0.8, -6.85],
    [8.6, 0.85, -5.55],
    [8.6, 1.6, -5.55],
    [7.7, 1.7, -6.85],
    [0.26, 0.29, 0.31],
  );
  b.addTriangle([7.7, 1.7, -4.05], [7.7, 1.7, -6.85], [8.6, 1.65, -5.45], [0.34, 0.37, 0.38]);
  b.addTriangle([7.7, 0.8, -4.05], [8.6, 0.85, -5.45], [7.7, 0.8, -6.85], [0.2, 0.23, 0.24]);
  b.box(4.7, 1.74, -5.45, 6.2, 0.16, 3.0, [0.34, 0.37, 0.38]);
  // Superstructure, bridge, funnel and mast.
  b.box(2.7, 2.6, -5.45, 2.2, 1.6, 2.0, [0.36, 0.39, 0.4]);
  b.box(2.7, 2.2, -4.43, 1.9, 0.5, 0.12, PALETTE.glassDark);
  b.box(1.62, 2.78, -5.45, 0.1, 0.4, 1.2, PALETTE.glassDark);
  b.box(1.9, 3.5, -5.45, 0.7, 1.0, 0.7, PALETTE.hullDark);
  b.box(1.9, 3.86, -5.45, 0.74, 0.2, 0.74, PALETTE.hull, 0.9);
  b.box(3.4, 4.18, -5.45, 0.12, 1.5, 0.12, PALETTE.metal);
  b.box(3.4, 4.55, -5.45, 0.1, 0.1, 1.1, PALETTE.metal);
  // Foredeck gun and breakwater.
  b.box(6.8, 1.95, -5.45, 0.9, 0.4, 0.9, PALETTE.oliveDark);
  b.cylinderX(7.7, 2.1, -5.45, 0.09, 1.4, 6, PALETTE.darkMetal);
  b.box(5.8, 1.9, -5.45, 0.2, 0.22, 2.3, PALETTE.oliveDark);
  // Scaffolding stands on a work pontoon in the basin, so opening the slipway
  // does not leave the staging hanging over water.
  b.box(3.35, 0.18, -3.95, 2.7, 0.3, 1.1, PALETTE.darkMetal);
  b.box(3.35, 0.34, -3.95, 2.5, 0.03, 0.9, PALETTE.metal);
  for (const x of [2.4, 3.35, 4.3]) {
    b.box(x, 1.57, -3.95, 0.12, 2.46, 0.12, PALETTE.metal);
  }
  b.box(3.35, 1.55, -3.95, 2.1, 0.1, 0.1, PALETTE.metal);
  b.box(3.35, 2.35, -3.95, 2.1, 0.1, 0.1, PALETTE.metal);
  b.box(3.35, 1.95, -3.95, 1.9, 0.08, 0.8, PALETTE.darkMetal);
  // Keel blocks and shaft tubes on the hardstand.
  for (const x of [2.6, 4.7, 6.8]) {
    b.box(x, 0.69, -5.45, 0.5, 0.22, 1.6, PALETTE.darkMetal);
  }
  for (const z of [-5.0, -5.9]) {
    b.cylinderX(1.5, 0.72, z, 0.16, 1.0, 6, PALETTE.darkMetal);
  }
  // No shutter: the yard is an open slipway, so the basin runs straight out
  // between two low guide walls and meets the sea at the footprint edge.
  for (const x of [-5.2, 5.2]) {
    b.box(x, 0.78, 8.9, 0.8, 0.44, 1.6, PALETTE.concreteDark);
    b.box(x, 1.02, 8.9, 0.9, 0.1, 1.7, PALETTE.warning);
  }
  // Travel lift straddling the stern of the corvette, with a trussed beam.
  for (const x of [1.0, 9.4]) {
    b.box(x, 0.7, -6.95, 1.0, 0.24, 1.0, PALETTE.concreteDark);
    b.box(x, 4.0, -6.95, 0.55, 6.9, 0.55, PALETTE.metal);
  }
  b.box(5.2, 7.25, -6.95, 8.8, 0.6, 0.8, PALETTE.metal);
  b.box(5.2, 6.2, -6.95, 8.0, 0.28, 0.4, PALETTE.metal);
  for (const x of [2.8, 5.2, 7.6]) {
    b.box(x, 6.72, -6.95, 0.22, 0.85, 0.3, PALETTE.metal);
  }
  // Two truss diagonals on the camera face of the portal, clear of the hull.
  const brace = (x0: number, y0: number, x1: number, y1: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 0.09;
    const ny = (dx / len) * 0.09;
    b.addQuad(
      [x0 + nx, y0 + ny, -6.55],
      [x0 - nx, y0 - ny, -6.55],
      [x1 - nx, y1 - ny, -6.55],
      [x1 + nx, y1 + ny, -6.55],
      PALETTE.metal,
    );
  };
  brace(1.2, 2.2, 3.4, 6.9);
  brace(9.2, 2.2, 7.0, 6.9);
  b.box(5.2, 6.72, -6.55, 1.4, 0.5, 0.9, PALETTE.hullDark);
  b.box(5.2, 5.0, -6.95, 0.08, 3.0, 0.08, PALETTE.darkMetal);
  b.box(5.2, 3.55, -6.95, 0.5, 0.18, 0.18, PALETTE.warning);
  b.box(5.2, 7.27, -6.53, 2.6, 0.2, 0.1, PALETTE.hull, 0.9);
  // Control house: low and wide with a long glazing band, deliberately unlike
  // the airfield's square tower.
  b.box(-7.2, 1.82, -4.8, 4.0, 2.6, 3.2, PALETTE.hull);
  b.box(-7.2, 3.24, -4.8, 4.2, 0.24, 3.6, PALETTE.oliveDark);
  b.box(-7.2, 2.2, -3.18, 3.2, 0.6, 0.12, PALETTE.glassDark);
  b.box(-5.18, 2.2, -4.8, 0.12, 0.6, 2.6, PALETTE.glassDark);
  ownershipPanel(b, -7.2, 3.42, -4.8, 3.8, 2.2);
  b.box(-6.4, 4.0, -4.8, 0.14, 1.5, 0.14, PALETTE.metal);
  b.box(-6.4, 4.5, -4.8, 1.2, 0.16, 0.5, PALETTE.metal);
  // Storehouse and steel stock on the left quay.
  b.box(-7.2, 1.46, -0.7, 2.2, 1.8, 2.0, PALETTE.oliveDark);
  b.box(-7.2, 2.44, -0.7, 2.6, 0.2, 2.4, PALETTE.olive);
  // Stood proud of the wall so the door panel does not fight the shed face.
  b.box(-6.06, 1.2, -0.7, 0.1, 1.2, 0.9, PALETTE.darkMetal);
  for (const z of [2.1, 3.5]) {
    b.box(-7.6, 0.66, z, 1.8, 0.16, 1.0, PALETTE.metal);
    b.box(-7.6, 0.82, z, 1.5, 0.16, 0.8, PALETTE.hullLight);
  }
  b.cylinderZ(-8.4, 1.14, 0.9, 0.55, 0.5, 8, PALETTE.darkMetal);
  b.box(-8.4, 1.14, 0.9, 0.2, 0.2, 0.64, PALETTE.metal);
  // Bollards along both quay edges, clear of the open slipway mouth.
  for (const x of [-8.6, -6.2, 6.2, 8.6]) {
    b.box(x, 0.76, 6.9, 0.34, 0.4, 0.34, PALETTE.darkMetal);
    b.box(x, 0.98, 6.9, 0.44, 0.08, 0.44, PALETTE.metal);
  }
  // Flag dais on the left quay, not in the water, with a painted team line
  // down each side of the slipway.
  b.box(-7.0, 0.76, 8.6, 2.0, 0.36, 1.0, PALETTE.concrete);
  b.box(-7.0, 0.93, 8.6, 1.7, 0.03, 0.9, PALETTE.hull, 0.9);
  for (const x of [-7.8, 7.8]) {
    b.box(x, 0.59, 9.3, 3.6, 0.03, 0.22, PALETTE.hull, 0.85);
  }
  for (const x of [-6.2, -9.4, 6.2, 9.4]) {
    b.box(x, 0.6, 9.3, 0.3, 0.04, 0.22, PALETTE.warning);
  }
  return b.build();
}

function buildSam(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 7.6, 0.6, 7.6, PALETTE.concreteDark);
  b.box(0, 0.8, 0, 7.0, 0.4, 7.0, PALETTE.concrete);
  b.box(-0.4, 1.8, 0, 4.2, 1.2, 3.0, PALETTE.hull);
  b.box(-0.4, 1.8, 1.6, 4.2, 0.9, 0.25, PALETTE.oliveDark);
  for (const z of [-0.9, -0.3, 0.3, 0.9]) {
    b.box(0.6, 2.6, z, 3.8, 0.36, 0.35, PALETTE.oliveDark);
    b.cylinderX(2.15, 2.6, z, 0.16, 1.2, 6, PALETTE.darkMetal);
    b.box(2.75, 2.6, z, 0.12, 0.18, 0.18, PALETTE.warning);
  }
  b.box(-2.2, 3.4, 0, 0.15, 2.6, 0.15, PALETTE.metal);
  b.box(-2.2, 4.7, 0, 1.4, 0.2, 0.9, PALETTE.metal);
  b.box(1.5, 3.4, -1.5, 1.0, 0.8, 0.3, PALETTE.darkMetal);
  sandbagWall(b, 0, 3.6, 6.0, true);
  sandbagWall(b, -3.0, 0, 5.2, false);
  b.box(2.6, 1.0, 2.6, 0.6, 0.4, 0.6, PALETTE.warning);
  ownershipPanel(b, -0.4, 2.52, 0, 3.0, 1.9);
  return b.build();
}

function buildMgNestBody(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.28, 0, 7.4, 0.55, 7.4, PALETTE.concreteDark);
  b.box(0, 0.7, 0, 6.8, 0.35, 6.8, PALETTE.concrete);
  // Sandbag parapet with a firing gap toward +X.
  sandbagWall(b, 0, -2.8, 6.2, true);
  sandbagWall(b, 0, 2.8, 6.2, true);
  sandbagWall(b, -2.8, 0, 5.2, false);
  sandbagWall(b, 2.8, -1.7, 2.0, false);
  sandbagWall(b, 2.8, 1.7, 2.0, false);
  // Sunken gun pit, with a team-tinted camouflage net over the floor and a
  // banner on the rear parapet so ownership survives battle zoom.
  b.box(0.1, 0.95, 0, 3.6, 0.35, 3.2, PALETTE.oliveDark);
  b.box(0.1, 1.15, 0, 3.3, 0.1, 2.8, PALETTE.oliveDark, 0.42);
  b.box(0.1, 1.23, 0, 1.4, 0.05, 1.1, PALETTE.hull, 0.62);
  for (const z of [-0.5, 0.5]) {
    b.box(0.2, 1.25, z, 0.14, 0.9, 0.14, PALETTE.metal);
  }
  b.box(0.2, 0.85, 0, 0.9, 0.2, 0.2, PALETTE.metal);
  b.box(0.2, 1.7, 0, 0.7, 0.18, 0.7, PALETTE.darkMetal);
  // Ammunition crates and a ready box.
  b.box(-1.9, 1.15, 2.1, 1.1, 0.7, 0.9, PALETTE.oliveDark);
  b.box(-1.9, 1.58, 2.1, 1.2, 0.14, 1.0, PALETTE.olive, 0.86);
  b.box(-2.0, 1.65, -2.0, 0.9, 0.8, 0.7, PALETTE.oliveDark);
  b.box(-2.0, 1.84, -2.0, 1.0, 0.14, 0.8, PALETTE.hull, 0.88);
  b.box(0, 1.15, -2.78, 2.6, 0.18, 0.2, PALETTE.hull, 0.86);
  b.box(1.6, 1.1, -2.5, 0.5, 0.5, 0.5, PALETTE.warning);
  return b.build();
}

/**
 * Hungarian reinforced bunker: a low concrete casemate, deliberately not a
 * recoloured sandbag nest. It shares the machine-gun turret and hardpoint with
 * the baseline nest but has its own heavy roof, embrasure and buttresses.
 */
function buildBunkerBody(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.28, 0, 7.6, 0.55, 7.6, PALETTE.concreteDark);
  b.box(0, 0.66, 0, 7.0, 0.25, 7.0, PALETTE.concrete);
  // Thick casemate with a narrow firing embrasure toward +X.
  b.box(0, 1.05, -0.2, 6.3, 0.9, 5.6, PALETTE.concrete);
  b.box(-3.25, 0.98, -0.2, 0.45, 1.35, 5.8, PALETTE.concreteDark);
  b.box(3.25, 0.98, -0.2, 0.45, 1.35, 5.8, PALETTE.concreteDark);
  b.box(0, 1.55, -0.2, 6.9, 0.24, 6.1, PALETTE.hullDark);
  b.box(0, 1.68, -0.2, 6.3, 0.1, 5.5, PALETTE.concreteDark);
  b.box(0, 0.86, 2.62, 5.2, 0.4, 0.5, PALETTE.concreteDark);
  // Embrasure brow and a dark slit, sized for the heavy MG rather than a
  // pillbox-wide opening. A second observation slit faces the tactical camera
  // so the concrete mass reads as a bunker, not a flat pad.
  b.box(3.18, 1.05, -0.2, 0.18, 0.34, 2.1, [0.035, 0.04, 0.04]);
  b.box(3.3, 1.28, -0.2, 0.5, 0.18, 2.5, PALETTE.concreteDark);
  b.box(3.31, 0.82, -0.2, 0.46, 0.16, 2.5, PALETTE.concreteDark);
  b.box(0, 1.12, 2.68, 3.2, 0.24, 0.16, [0.035, 0.04, 0.04]);
  b.box(0, 1.3, 2.62, 3.6, 0.18, 0.42, PALETTE.concreteDark);
  // Rear magazine and observation cupola give the casemate a layered profile
  // above the flat roof deck.
  b.box(-0.5, 2.2, -2.45, 3.8, 1.3, 1.9, PALETTE.concreteDark);
  b.box(-0.5, 2.9, -2.45, 3.4, 0.16, 1.5, PALETTE.hullDark);
  b.box(-0.5, 2.55, -1.46, 2.4, 0.3, 0.14, [0.035, 0.04, 0.04]);
  b.box(-0.5, 2.78, -1.44, 2.8, 0.14, 0.2, PALETTE.concreteDark);
  b.cylinder(-2.2, 3.05, -2.5, 0.22, 0.8, 6, PALETTE.metal);
  b.box(-2.2, 3.46, -2.5, 0.12, 1.0, 0.12, PALETTE.metal);
  // Reinforced roof beams and corner buttresses make the mass read from above.
  for (const z of [-2.1, 0.0, 2.1]) {
    b.box(0.2, 1.78, z, 5.9, 0.18, 0.42, PALETTE.hullDark);
  }
  for (const [x, z] of [
    [-2.7, 2.2],
    [2.7, 2.2],
    [-2.7, -2.6],
    [2.7, -2.6],
  ]) {
    b.boxRot(x, 0.9, z, 1.1, 1.5, 1.1, Math.PI / 4, PALETTE.concreteDark);
  }
  // Rear access, ventilation and a team-painted roof strip.
  b.box(-0.8, 1.0, -3.06, 2.0, 1.25, 0.28, PALETTE.hullDark);
  b.box(-0.8, 0.98, -3.23, 1.5, 1.0, 0.12, PALETTE.glassDark);
  b.cylinder(-2.4, 1.8, -2.2, 0.28, 0.5, 6, PALETTE.darkMetal);
  b.cylinder(-2.4, 2.08, -2.2, 0.36, 0.16, 6, PALETTE.metal);
  b.box(2.0, 1.8, 2.0, 1.6, 0.18, 0.9, PALETTE.hull, 0.9);
  b.box(0.0, 1.79, 1.95, 3.4, 0.12, 1.15, PALETTE.hull, 0.88);
  // Spare ready boxes under the embrasure.
  b.box(2.0, 1.0, -2.2, 1.2, 0.65, 0.8, PALETTE.oliveDark);
  b.box(2.0, 1.36, -2.2, 1.3, 0.12, 0.9, PALETTE.olive);
  b.box(-1.8, 0.95, 2.1, 0.6, 0.6, 0.6, PALETTE.warning);
  return b.build();
}

/** Traversing gun, authored around its pintle at local origin. */
function buildMgNestTurret(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(-0.9, -0.2, 0, 0.45, 0.8, 0.45, PALETTE.olive);
  b.box(0.3, 0, 0, 1.9, 0.28, 0.3, PALETTE.darkMetal);
  b.cylinderX(1.9, 0, 0, 0.12, 2.2, 6, PALETTE.metal);
  b.box(2.9, 0, 0, 0.42, 0.16, 0.22, PALETTE.darkMetal);
  b.box(0.1, 0.18, 0.24, 0.8, 0.12, 0.14, PALETTE.amber);
  return b.build();
}

function buildAtTurretBody(): MeshBuffers {
  const b = new MeshBuilder();
  // A low, open revetment only beds the weapon. The barrel, shield and split
  // trails have to carry the silhouette at battle zoom.
  b.box(0, 0.16, 0, 7.4, 0.32, 7.4, PALETTE.concreteDark);
  b.box(0, 0.42, 0, 6.8, 0.2, 6.8, PALETTE.concrete);
  sandbagWall(b, 0, -3.05, 5.8, true, 0.5);
  sandbagWall(b, -2.9, -0.9, 3.6, false, 0.5);
  sandbagWall(b, 2.9, -0.9, 3.6, false, 0.5);
  // Steel gun deck, deliberately smaller than the concrete pad.
  b.box(-0.2, 0.66, 0, 3.8, 0.26, 3.2, PALETTE.hullDark);
  b.box(-0.2, 0.82, 0, 3.2, 0.06, 2.6, PALETTE.oliveDark);
  // Split trails run back to steel spades, the clearest low-level cue that
  // this is a towed anti-tank gun rather than a turret on a bunker.
  b.boxRot(-1.85, 0.9, -0.8, 3.9, 0.2, 0.3, Math.PI - 0.36, PALETTE.metal);
  b.boxRot(-1.85, 0.9, 0.8, 3.9, 0.2, 0.3, Math.PI + 0.36, PALETTE.metal);
  b.box(-3.65, 0.7, -1.48, 0.55, 0.4, 0.72, PALETTE.darkMetal);
  b.box(-3.65, 0.7, 1.48, 0.55, 0.4, 0.72, PALETTE.darkMetal);
  // Ready rack and its lid carry the ownership panel; the gun stays clear.
  b.box(-2.45, 0.82, 2.55, 2.0, 0.6, 0.95, PALETTE.oliveDark);
  b.box(-2.45, 1.14, 2.55, 2.1, 0.12, 1.05, PALETTE.olive);
  ownershipPanel(b, -2.45, 1.24, 2.55, 1.8, 0.72);
  b.box(2.35, 0.75, 2.35, 0.9, 0.5, 0.75, PALETTE.oliveDark);
  b.box(2.2, 1.72, -2.3, 0.1, 1.8, 0.1, PALETTE.metal);
  b.box(2.2, 2.2, -2.3, 0.55, 0.4, 0.07, PALETTE.warning);
  return b.build();
}

/** Shield, breech and barrel, authored around the trunnion at local origin. */
function buildAtTurretGun(): MeshBuffers {
  const b = new MeshBuilder();
  // Broad sloped shield with folded side cheeks and a sight slit. The single
  // long barrel is what separates this from the twin-rail coastal launcher.
  b.boxRot(0.25, 0.62, 0, 0.24, 1.55, 2.25, -0.12, PALETTE.oliveDark);
  b.box(0.23, 1.34, 0, 0.3, 0.2, 2.3, PALETTE.olive);
  b.boxRot(0.12, 0.62, -1.13, 0.2, 1.15, 0.58, -0.42, PALETTE.oliveDark);
  b.boxRot(0.12, 0.62, 1.13, 0.2, 1.15, 0.58, 0.42, PALETTE.oliveDark);
  b.box(0.46, 0.98, 0, 0.06, 0.2, 0.72, PALETTE.hullDark);
  // The pintle block reaches down to the steel deck: the shield is tall, and a
  // gun floating above its platform is worse than a short mount.
  b.box(0, -0.1, 0, 1.0, 0.9, 0.9, PALETTE.hullDark);
  b.box(-0.45, 0.4, 0, 1.15, 0.55, 0.8, PALETTE.hull);
  b.box(-0.98, 0.35, 0, 0.5, 0.9, 0.55, PALETTE.darkMetal);
  b.cylinderX(1.75, 0.48, 0, 0.13, 3.4, 8, PALETTE.metal);
  b.cylinderX(3.55, 0.48, 0, 0.2, 0.6, 8, PALETTE.darkMetal);
  b.box(3.86, 0.48, 0, 0.18, 0.22, 0.22, PALETTE.warning);
  return b.build();
}

function buildCoastalBatteryBody(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.16, 0, 7.4, 0.32, 7.4, PALETTE.concreteDark);
  b.box(0, 0.42, 0, 6.9, 0.2, 6.9, PALETTE.concrete);
  b.box(0, 0.62, 0, 5.0, 0.35, 5.0, PALETTE.hullDark);
  b.box(0, 0.82, 0, 4.2, 0.08, 4.2, PALETTE.oliveDark);
  // The landward blast wall and low wing walls frame an opening toward water.
  b.box(-3.1, 0.9, 0, 0.55, 1.2, 5.4, PALETTE.concreteDark);
  b.box(-3.1, 1.52, 0, 0.7, 0.12, 5.6, PALETTE.concrete);
  b.box(-1.5, 0.55, -2.9, 3.0, 0.6, 0.45, PALETTE.concrete);
  b.box(-1.5, 0.55, 2.9, 3.0, 0.6, 0.45, PALETTE.concrete);
  // Ready rounds in a covered rack, with the ownership panel on its lid.
  b.box(1.9, 0.85, 2.35, 1.5, 0.7, 1.8, PALETTE.oliveDark);
  for (const x of [1.55, 2.25]) {
    b.box(x, 1.72, 2.35, 0.42, 1.2, 0.42, PALETTE.hullLight);
    b.box(x, 2.35, 2.35, 0.46, 0.12, 0.46, PALETTE.warning);
  }
  ownershipPanel(b, 1.9, 1.32, 2.35, 1.3, 1.0);
  // Fire-control box on the seaward edge.
  b.box(2.3, 1.05, -2.35, 1.25, 1.0, 1.2, PALETTE.hullLight);
  b.box(2.3, 1.25, -1.73, 0.7, 0.28, 0.08, PALETTE.glassDark);
  return b.build();
}

/** Twin anti-ship launch rails, authored around the traversing pintle. */
function buildCoastalBatteryTurret(): MeshBuffers {
  const b = new MeshBuilder();
  // Rotating pedestal and turntable bridge the low deck to the raised rails.
  b.box(0, -0.05, 0, 2.6, 1.1, 2.8, PALETTE.hullDark);
  b.cylinder(0, 0.5, 0, 1.1, 0.22, 8, PALETTE.darkMetal);
  for (const z of [-1.0, 1.0]) {
    // Two open rails, separated by two metres, on visible pylons.
    b.box(0.15, 1.05, z, 3.2, 0.22, 0.42, PALETTE.oliveDark);
    b.box(-1.0, 1.3, z, 0.24, 0.7, 0.4, PALETTE.metal);
    b.box(1.35, 1.25, z, 0.22, 0.55, 0.35, PALETTE.metal);
    b.box(0.25, 1.48, z, 3.5, 0.14, 0.3, PALETTE.metal);
    b.cylinderX(1.05, 1.72, z, 0.17, 4.0, 6, PALETTE.hullLight);
    b.box(3.18, 1.72, z, 0.3, 0.26, 0.26, PALETTE.warning);
  }
  b.box(-1.3, 1.25, 0, 0.24, 0.3, 2.3, PALETTE.metal);
  slopedPlate(b, -1.9, 1.4, 0, 2.9, 1.65, 0.2, 0.75, PALETTE.oliveDark);
  // The sight sits on the outer rail so the launcher reads as aimed, not just
  // parked ordnance.
  b.box(0.8, 1.9, 1.35, 0.5, 0.35, 0.35, PALETTE.darkMetal);
  b.box(1.05, 1.95, 1.35, 0.22, 0.18, 0.18, PALETTE.warning);
  return b.build();
}

function buildRelay(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.18, 0, 7.4, 0.36, 7.4, PALETTE.concreteDark);
  b.box(0, 0.45, 0, 6.8, 0.2, 6.8, PALETTE.concrete);
  // A field communications cabin gives the relay a real functional mass;
  // the mast rises through its roof instead of standing alone on the pad.
  b.box(-1.2, 1.95, -1.2, 4.2, 2.9, 3.4, PALETTE.hull);
  b.box(-1.2, 3.43, -1.2, 4.6, 0.22, 3.8, PALETTE.hullLight);
  ownershipPanel(b, -1.5, 3.63, -1.35, 2.6, 1.4);
  b.box(-1.2, 2.35, 0.62, 2.8, 0.55, 0.1, PALETTE.glassDark);
  b.box(0.65, 1.25, 0.64, 0.75, 1.3, 0.1, PALETTE.hullDark);
  b.box(-2.8, 2.2, 0.58, 0.55, 0.5, 0.08, PALETTE.warning);
  // Lattice mast and service platform for the rotating uplink.
  b.box(0, 5.15, 0, 0.3, 3.4, 0.3, PALETTE.metal);
  b.box(0, 4.35, 0, 1.9, 0.18, 1.9, PALETTE.metal);
  for (const [x, z] of [
    [-0.65, -0.65],
    [0.65, -0.65],
    [0.65, 0.65],
    [-0.65, 0.65],
  ]) {
    b.box(x, 3.95, z, 0.14, 0.8, 0.14, PALETTE.metal);
  }
  b.box(0, 6.2, 0, 0.7, 0.14, 0.7, PALETTE.darkMetal);
  b.box(0, 6.72, 0, 0.16, 0.85, 0.16, PALETTE.metal);
  b.box(0, 7.2, 0, 0.24, 0.24, 0.24, PALETTE.red);
  // Secondary fixed dish on the cabin roof, distinct from the broad sweeping
  // array of the radar station.
  b.box(-2.55, 3.9, -2.45, 0.16, 1.0, 0.16, PALETTE.metal);
  b.cylinderZ(-2.55, 4.35, -2.35, 0.72, 0.18, 8, PALETTE.hullLight);
  b.box(-2.55, 4.35, -2.24, 0.16, 0.16, 0.18, PALETTE.metal);
  b.box(-2.55, 4.0, -2.24, 0.06, 0.5, 0.06, PALETTE.metal);
  // Cable drum and a generator cabinet at ground level.
  b.box(2.35, 0.9, 2.15, 1.6, 1.0, 1.5, PALETTE.oliveDark);
  b.box(2.3, 1.5, 2.15, 0.8, 0.2, 0.8, PALETTE.olive);
  b.cylinderZ(2.35, 1.2, 2.9, 0.5, 0.4, 8, PALETTE.darkMetal);
  sandbagWall(b, 0, 3.15, 4.4, true, 0.28);
  return b.build();
}

function buildSupplyDepot(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 11.8, 0.6, 11.8, PALETTE.concreteDark);
  b.box(0, 0.7, 0, 11.0, 0.4, 11.0, PALETTE.concrete);
  // Stacked container yard with a loading apron.
  for (const [x, z, y] of [
    [-3.2, -2.8, 1.55],
    [-0.4, -2.8, 1.55],
    [-3.2, -2.8, 3.25],
    [3.0, -2.6, 1.55],
    [-2.4, 2.2, 1.55],
    [0.6, 2.2, 1.55],
  ]) {
    b.box(x, y, z, 2.4, 1.5, 1.8, x < 2 && z < 0 && y > 2 ? PALETTE.olive : PALETTE.canvas);
    b.box(x, y + 0.1, z + 0.95, 2.2, 0.12, 0.08, PALETTE.oliveDark);
  }
  b.box(3.0, 3.1, -2.6, 2.5, 1.6, 1.9, PALETTE.oliveDark);
  b.box(3.0, 2.35, 3.9, 3.0, 0.3, 1.0, PALETTE.darkMetal, 0.9);
  // Crane frame and hook.
  b.box(-4.4, 3.6, 3.4, 0.22, 6.4, 0.22, PALETTE.metal);
  b.box(-2.8, 6.6, 3.4, 3.5, 0.2, 0.2, PALETTE.metal);
  b.box(-1.1, 5.6, 3.4, 0.12, 2.0, 0.12, PALETTE.darkMetal);
  b.box(-1.1, 4.6, 3.4, 0.5, 0.5, 0.5, PALETTE.amber);
  // Perimeter sandbags.
  sandbagWall(b, 0, 5.6, 7.0, true);
  sandbagWall(b, 5.4, 0, 6.0, false);
  return b.build();
}

function buildRadarStation(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.18, 0, 11.6, 0.36, 11.6, PALETTE.concreteDark);
  b.box(0, 0.46, 0, 10.8, 0.2, 10.8, PALETTE.concrete);
  // The operations block is the mass; the tower and array are its roof, not a
  // mast bolted onto a bunker.
  b.box(-0.8, 2.4, -0.6, 7.2, 3.5, 6.8, PALETTE.hull);
  b.box(-0.8, 4.25, -0.6, 7.8, 0.34, 7.4, PALETTE.hullLight);
  // Front-right roof plate: the array is mounted aft, so from the normal
  // camera this panel is not hidden behind the array's silhouette.
  ownershipPanel(b, 1.2, 4.51, 1.8, 2.8, 1.6);
  b.box(-0.8, 2.65, 2.82, 5.4, 0.8, 0.1, PALETTE.glassDark);
  b.box(-0.8, 1.55, 2.83, 1.2, 1.5, 0.12, PALETTE.hullDark);
  b.box(1.5, 2.65, 2.82, 1.0, 0.55, 0.08, PALETTE.warning);
  // Stepped equipment annex breaks the roofline and houses the fixed uplink.
  b.box(3.6, 1.55, 3.1, 3.2, 1.9, 3.6, PALETTE.oliveDark);
  b.box(3.6, 2.62, 3.1, 3.5, 0.22, 3.9, PALETTE.olive);
  b.box(-4.2, 0.95, 3.9, 1.6, 0.8, 1.2, PALETTE.oliveDark);
  // Four-leg sensor tower with visible bracing under the array.
  b.box(0, 4.55, 0, 2.2, 0.22, 2.2, PALETTE.hullDark);
  for (const [x, z] of [
    [-0.65, -0.65],
    [0.65, -0.65],
    [0.65, 0.65],
    [-0.65, 0.65],
  ]) {
    b.box(x, 5.3, z, 0.14, 1.5, 0.14, PALETTE.metal);
  }
  b.box(0, 5.35, 0, 1.5, 0.12, 0.12, PALETTE.metal);
  b.box(0, 5.35, 0, 0.12, 0.12, 1.5, PALETTE.metal);
  b.box(0, 5.95, 0, 1.0, 0.18, 1.0, PALETTE.darkMetal);
  // A small fixed dish on the annex keeps the composition asymmetric without
  // competing with the sweeping array above.
  b.box(3.6, 2.95, 3.1, 0.14, 0.45, 0.14, PALETTE.metal);
  b.cylinder(3.6, 3.3, 3.1, 0.72, 0.2, 8, PALETTE.hullLight);
  b.box(3.6, 3.55, 3.1, 0.1, 0.5, 0.1, PALETTE.metal);
  sandbagWall(b, 0, 4.95, 6.0, true, 0.28);
  sandbagWall(b, 4.9, 0, 4.0, false, 0.28);
  return b.build();
}

function buildTenement(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 15.4, 0.6, 15.4, PALETTE.concreteDark);
  b.box(0, 0.75, 0, 14.6, 0.5, 14.6, PALETTE.concrete);
  // Three-storey apartment block with a recessed entrance.
  b.box(-0.6, 4.0, 0, 11.6, 7.2, 9.6, PALETTE.canvas);
  b.box(-0.6, 7.85, 0, 12.4, 0.5, 10.4, PALETTE.oliveDark);
  b.box(-0.6, 2.3, 4.85, 3.2, 2.8, 0.35, PALETTE.hullDark);
  b.box(-0.6, 1.2, 5.0, 3.0, 1.8, 0.2, PALETTE.glassDark);
  b.box(-0.6, 8.35, 0, 10.8, 0.5, 8.8, PALETTE.concrete);
  for (let floor = 0; floor < 3; floor++) {
    const y = 2.1 + floor * 2.15;
    for (let i = 0; i < 4; i++) {
      const x = -4.6 + i * 2.7;
      b.box(x, y, 4.55, 1.5, 0.9, 0.18, PALETTE.glassDark);
      b.box(x, y, -4.55, 1.5, 0.9, 0.18, PALETTE.glassDark);
    }
  }
  // Side windows, roof water tank and stair housing.
  for (let floor = 0; floor < 3; floor++) {
    const y = 2.1 + floor * 2.15;
    for (const z of [-2.6, 0.2, 3.0]) {
      b.box(-6.45, y, z, 0.18, 0.9, 1.5, PALETTE.glassDark);
      b.box(5.25, y, z, 0.18, 0.9, 1.5, PALETTE.glassDark);
    }
  }
  b.box(3.2, 9.4, 0, 3.0, 2.4, 3.2, PALETTE.concrete);
  b.box(3.2, 10.7, 0, 3.4, 0.3, 3.6, PALETTE.hullLight);
  b.cylinder(-3.6, 9.4, -3.2, 1.25, 2.4, 10, PALETTE.hullLight);
  b.cylinder(-3.6, 10.7, -3.2, 1.35, 0.3, 10, PALETTE.metal);
  // Ground-floor barricade and rubble.
  sandbagWall(b, -1.0, 6.5, 5.0, true);
  b.box(5.2, 0.9, 5.4, 1.2, 0.8, 1.2, PALETTE.concreteDark);
  b.box(-5.6, 0.8, 5.2, 1.0, 0.6, 1.0, PALETTE.concreteDark);
  return b.build();
}

function buildRuin(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.25, 0, 11.6, 0.5, 11.6, PALETTE.concreteDark);
  b.box(0, 0.62, 0, 10.8, 0.35, 10.8, PALETTE.concrete);
  // Broken shell: surviving corners at different heights.
  b.box(-4.4, 1.9, -4.2, 3.2, 3.1, 2.4, PALETTE.concrete);
  b.box(-4.4, 3.55, -4.2, 3.6, 0.3, 2.8, PALETTE.hullDark);
  b.box(3.8, 1.4, 3.6, 3.6, 2.1, 2.6, PALETTE.concrete);
  b.box(3.8, 2.55, 3.6, 4.0, 0.25, 3.0, PALETTE.hullDark);
  b.box(4.0, 1.6, -4.4, 2.4, 2.5, 2.2, PALETTE.concreteDark);
  b.box(-4.8, 0.95, 4.0, 2.6, 1.4, 2.8, PALETTE.concreteDark);
  // Collapsed roof beams and rubble piles.
  b.boxRot(0.6, 1.2, -0.4, 7.4, 0.3, 0.3, 0.35, PALETTE.darkMetal);
  b.boxRot(-1.0, 1.55, 1.2, 6.2, 0.25, 0.25, -0.6, PALETTE.darkMetal);
  for (const [x, z, s] of [
    [-1.6, 2.4, 1.2],
    [1.8, 1.0, 1.5],
    [0.4, -2.8, 1.0],
    [-2.8, -0.8, 0.8],
  ]) {
    b.box(x, 0.9, z, s, 0.7, s, PALETTE.concreteDark);
    b.box(x + 0.35, 1.25, z - 0.25, s * 0.55, 0.35, s * 0.55, PALETTE.concrete);
  }
  sandbagWall(b, -0.6, 5.2, 4.2, true);
  return b.build();
}

function buildWarehouse(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 16.4, 0.6, 13.0, PALETTE.concreteDark);
  b.box(0, 0.72, 0, 15.6, 0.45, 12.2, PALETTE.concrete);
  // A long brick goods store: low walls, a shallow sawtooth roof and a loading
  // dock along the street face.
  b.box(-0.4, 3.4, -0.6, 13.6, 5.4, 9.4, PALETTE.canvas);
  b.box(-0.4, 6.35, -0.6, 14.2, 0.4, 10.0, PALETTE.oliveDark);
  for (let i = 0; i < 3; i++) {
    b.box(-4.4 + i * 4.0, 6.75, -0.6, 3.0, 0.7, 8.6, PALETTE.olive);
  }
  // Loading dock, complete with a recessed roller door and its rails.
  b.box(0.2, 1.25, 5.6, 12.2, 1.7, 2.2, PALETTE.concreteDark);
  b.box(-0.4, 2.9, 4.35, 4.4, 3.4, 0.2, PALETTE.hullDark);
  b.box(-0.4, 2.75, 4.5, 4.0, 3.1, 0.12, PALETTE.metal);
  for (let i = 0; i < 7; i++) {
    b.box(-0.4, 1.35 + i * 0.42, 4.58, 3.9, 0.06, 0.06, PALETTE.darkMetal);
  }
  b.box(0.2, 2.05, 7.05, 11.6, 0.28, 0.28, PALETTE.hullDark);
  b.box(-5.4, 4.6, 4.42, 1.6, 1.4, 0.18, PALETTE.glassDark);
  // Roof vents and a pair of pallets dropped beside the dock.
  for (const [x, z] of [
    [-5.6, -3.6],
    [5.0, -3.2],
    [5.0, 3.0],
  ]) {
    b.cylinder(x, 6.9, z, 0.55, 1.1, 8, PALETTE.metal);
    b.cylinder(x, 7.55, z, 0.65, 0.18, 8, PALETTE.darkMetal);
  }
  for (const [x, z] of [
    [4.7, 4.4],
    [5.9, 4.4],
  ]) {
    b.box(x, 0.95, z, 1.0, 0.15, 1.0, PALETTE.canvas);
    b.box(x, 1.2, z, 0.9, 0.45, 0.9, PALETTE.oliveDark);
  }

  // Facade layering. The goods store was a flat brick box with a roller door
  // painted onto it. Deep wall piers, a sill course, a covered loading bay and
  // visible roof plant give it a construction sequence at battle zoom without
  // adding a texture or a second draw. All slices are set into the wall rather
  // than sitting on the same plane, which is what caused the old z-fighting on
  // the command post.
  for (const x of [-6.55, 2.35, 5.9]) {
    b.box(x, 3.25, 4.16, 0.38, 5.1, 0.34, PALETTE.concreteDark);
  }
  b.box(-0.4, 5.63, 4.14, 13.85, 0.22, 0.36, PALETTE.concrete);
  // Window surrounds on the street face.
  b.box(-5.4, 3.88, 4.34, 1.95, 0.14, 0.36, PALETTE.concrete);
  b.box(-5.4, 5.34, 4.34, 1.95, 0.14, 0.36, PALETTE.concrete);
  // A covered loading bay projects over the roller door. The posts sink into
  // the dock top and the canopy, so neither meeting face is coplanar.
  b.box(-0.4, 4.03, 4.98, 5.4, 0.22, 2.8, PALETTE.hullDark);
  b.box(-0.4, 4.0, 6.32, 5.5, 0.3, 0.16, PALETTE.hullDark);
  for (const x of [-2.9, 2.1]) {
    b.box(x, 3.0, 5.6, 0.16, 1.86, 0.16, PALETTE.metal);
  }
  for (const x of [-1.7, 1.1]) {
    b.box(x, 3.84, 4.26, 0.22, 0.12, 0.3, PALETTE.amber);
  }
  // Painted dock-edge markers make the unloading face legible from above.
  for (let i = 0; i < 5; i++) {
    const x = -4.4 + i * 2.2;
    b.box(x, 2.14, 6.61, 1.2, 0.12, 0.16, i % 2 === 0 ? PALETTE.warning : PALETTE.darkMetal);
  }
  // Pilasters on the long side walls cast real facet breaks where the old
  // elevation was one uninterrupted colour field.
  for (const x of [-7.16, 6.36]) {
    for (const z of [-3.8, -1.2, 1.4]) {
      b.box(x, 3.3, z, 0.3, 5.2, 0.42, PALETTE.concreteDark);
    }
  }
  // A ridge monitor replaces a slice of the sawtooth silhouette with a real
  // roof volume and a breathing cap.
  b.box(0.2, 7.3, -0.6, 2.4, 0.42, 1.2, PALETTE.metal);
  b.box(0.2, 7.53, -0.6, 2.6, 0.12, 1.4, PALETTE.darkMetal);
  // Downpipes at the outer corners, tucked behind the front pilasters.
  for (const x of [-6.98, 6.26]) {
    b.cylinder(x, 3.1, 4.17, 0.08, 4.8, 6, PALETTE.darkMetal);
  }
  sandbagWall(b, -2.4, 7.4, 3.4, true);
  return b.build();
}

function buildOfficeBlock(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 13.2, 0.6, 16.4, PALETTE.concreteDark);
  b.box(0, 0.75, 0, 12.4, 0.5, 15.6, PALETTE.concrete);
  // A tall concrete slab with continuous glazing bands on every face: the
  // tallest civilian structure on the map, and the best view of the street.
  b.box(-0.2, 6.6, 0, 9.6, 11.6, 12.4, PALETTE.concrete);
  b.box(-0.2, 12.6, 0, 10.2, 0.5, 13.0, PALETTE.oliveDark);
  for (let floor = 0; floor < 6; floor++) {
    const y = 1.9 + floor * 1.85;
    b.box(-0.2, y, 6.25, 8.6, 0.95, 0.2, PALETTE.glassDark);
    b.box(-0.2, y, -6.25, 8.6, 0.95, 0.2, PALETTE.glassDark);
    b.box(-5.1, y, 0, 0.2, 0.95, 10.6, PALETTE.glassDark);
    b.box(4.7, y, 0, 0.2, 0.95, 10.6, PALETTE.glassDark);
  }
  // Lobby, canopy and the columns that carry it.
  b.box(-0.2, 1.35, 6.35, 4.0, 2.4, 0.3, PALETTE.hullDark);
  b.box(-0.2, 2.75, 7.0, 5.4, 0.25, 1.6, PALETTE.concrete);
  for (const x of [-2.7, 2.3]) {
    b.box(x, 1.9, 7.75, 0.16, 2.4, 0.16, PALETTE.metal);
  }
  // Rooftop plant: stair housing, chiller units and a comms mast.
  b.box(2.4, 13.9, -3.2, 3.2, 2.4, 3.2, PALETTE.concrete);
  b.box(2.4, 15.25, -3.2, 3.6, 0.3, 3.6, PALETTE.hullLight);
  for (const [x, z] of [
    [-3.2, -4.0],
    [-3.2, 0.4],
  ]) {
    b.box(x, 13.3, z, 2.2, 1.1, 2.0, PALETTE.metal);
    b.cylinder(x, 13.95, z, 0.55, 0.2, 8, PALETTE.darkMetal);
  }
  b.box(-3.6, 15.2, 4.0, 0.16, 5.0, 0.16, PALETTE.metal);
  b.box(-3.6, 17.4, 3.5, 1.2, 0.5, 0.1, PALETTE.amber, 1);
  // Fire escape landings down the east face.
  for (let floor = 0; floor < 4; floor++) {
    b.box(4.95, 3.0 + floor * 2.4, 2.4, 1.3, 0.14, 2.6, PALETTE.darkMetal);
  }
  sandbagWall(b, 0, 8.6, 4.6, true);
  return b.build();
}

function buildCivicHall(): MeshBuffers {
  const b = new MeshBuilder();
  // Stepped plinth and the apron of steps onto the square.
  b.box(0, 0.3, 0, 16.8, 0.6, 16.8, PALETTE.concreteDark);
  b.box(0, 0.72, 0, 16.0, 0.45, 16.0, PALETTE.concrete);
  for (let i = 0; i < 3; i++) {
    b.box(0, 0.55 + i * 0.28, 8.5 - i * 0.55, 10.8 - i * 1.2, 0.3, 1.1, PALETTE.concrete);
  }
  // The civic block: a stone drum with a colonnade standing proud of the face.
  b.box(0, 4.5, -0.3, 13.2, 6.8, 12.8, PALETTE.concrete);
  b.box(0, 8.15, -0.3, 14.0, 0.55, 13.6, PALETTE.hullLight);
  b.box(0, 8.6, -0.3, 12.8, 0.4, 12.4, PALETTE.concreteDark);
  for (let i = 0; i < 5; i++) {
    const x = -4.8 + i * 2.4;
    b.box(x, 3.5, 6.5, 0.6, 5.6, 0.6, PALETTE.hullLight);
    b.box(x, 6.45, 6.5, 0.9, 0.3, 0.9, PALETTE.metal);
    b.box(x, 0.95, 6.5, 0.8, 0.3, 0.8, PALETTE.concreteDark);
  }
  b.box(0, 6.9, 6.3, 12.6, 0.7, 2.0, PALETTE.hullLight);
  b.box(0, 7.55, 6.1, 13.2, 0.5, 2.6, PALETTE.oliveDark);
  b.box(0, 2.15, 6.45, 5.0, 2.6, 0.24, PALETTE.hullDark);
  b.box(0, 2.05, 6.6, 4.4, 2.3, 0.14, PALETTE.glassDark);
  // Tall windows either side of the portico, on both long faces.
  for (const z of [6.25, -7.0]) {
    for (const x of [-4.6, -1.6, 1.6, 4.6]) {
      b.box(x, 3.5, z, 1.5, 3.0, 0.18, PALETTE.glassDark);
      b.box(x, 5.25, z, 1.7, 0.35, 0.26, PALETTE.hullLight);
    }
  }
  // Domed roof over the civic chamber, with a lantern on top.
  b.cylinder(0, 9.05, -0.3, 6.2, 0.5, 14, PALETTE.concrete);
  b.cylinder(0, 9.6, -0.3, 5.6, 0.6, 14, PALETTE.concreteDark);
  b.cylinder(0, 10.3, -0.3, 4.9, 0.9, 16, PALETTE.hullLight);
  b.cylinder(0, 11.35, -0.3, 3.8, 1.3, 16, PALETTE.hullLight);
  b.cylinder(0, 12.3, -0.3, 2.5, 0.7, 14, PALETTE.metal);
  b.cylinder(0, 12.9, -0.3, 1.4, 0.8, 10, PALETTE.concrete);
  b.cylinder(0, 13.45, -0.3, 1.6, 0.3, 10, PALETTE.hullLight);
  b.cone(0, 13.6, -0.3, 1.5, 1.1, 10, PALETTE.oliveDark);
  // Clock tower on the rear elevation: the district's landmark spire.
  b.box(0, 10.8, -5.6, 3.8, 4.4, 3.8, PALETTE.concrete);
  b.box(0, 13.1, -5.6, 4.4, 0.4, 4.4, PALETTE.hullLight);
  for (const [x, z] of [
    [0, -7.55],
    [0, -3.65],
    [1.95, -5.6],
    [-1.95, -5.6],
  ]) {
    b.box(x, 12.55, z, x === 0 ? 2.4 : 0.16, 1.6, x === 0 ? 0.16 : 2.4, PALETTE.glassDark);
  }
  b.box(0, 13.7, -5.6, 3.0, 0.9, 3.0, PALETTE.concreteDark);
  b.cone(0, 14.1, -5.6, 2.2, 1.6, 4, PALETTE.oliveDark);
  b.box(0, 15.9, -5.6, 0.18, 0.7, 0.18, PALETTE.metal);
  sandbagWall(b, 0, 8.9, 5.2, true);
  return b.build();
}

function buildFoundryWorks(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 16.4, 0.6, 12.6, PALETTE.concreteDark);
  b.box(0, 0.72, 0, 15.6, 0.45, 11.8, PALETTE.concrete);
  // The long casting bay under a steep sawtooth roof.
  b.box(-0.4, 3.9, -0.6, 14.0, 6.4, 9.0, PALETTE.canvas);
  b.box(-0.4, 7.35, -0.6, 14.6, 0.4, 9.6, PALETTE.oliveDark);
  for (let i = 0; i < 4; i++) {
    const x = -5.6 + i * 3.4;
    b.box(x, 8.05, -0.6, 2.4, 1.4, 8.8, PALETTE.olive);
    b.box(x + 0.9, 7.75, -0.6, 0.3, 1.2, 8.4, PALETTE.glassDark);
  }
  // Twin stacks: visible right across the district.
  for (const x of [-5.6, 5.2]) {
    b.cylinder(x, 7.4, -4.5, 1.0, 13.6, 10, PALETTE.hullLight);
    b.cylinder(x, 4.2, -4.5, 1.1, 0.5, 10, PALETTE.metal);
    b.cylinder(x, 10.6, -4.5, 1.05, 0.4, 10, PALETTE.metal);
    b.cylinder(x, 13.4, -4.5, 1.1, 0.4, 10, PALETTE.warning);
    b.cylinder(x, 14.3, -4.5, 1.15, 0.2, 10, PALETTE.darkMetal);
  }
  // Furnace house and a quench tank at the west end.
  b.box(-6.6, 3.4, 3.4, 3.2, 5.6, 3.6, PALETTE.concreteDark);
  b.box(-6.6, 6.35, 3.4, 3.6, 0.35, 4.0, PALETTE.hullDark);
  b.cylinder(-5.0, 1.5, 3.0, 1.0, 1.6, 10, PALETTE.darkMetal);
  // Loading doors onto the yard, roller rails and the gantry over them.
  for (const x of [-2.6, 3.0]) {
    b.box(x, 2.9, 4.15, 3.4, 4.2, 0.22, PALETTE.hullDark);
    b.box(x, 2.75, 4.3, 3.0, 3.9, 0.12, PALETTE.metal);
    for (let i = 0; i < 7; i++) {
      b.box(x, 1.2 + i * 0.48, 4.38, 2.9, 0.06, 0.06, PALETTE.darkMetal);
    }
  }
  b.box(0.2, 7.8, 4.9, 13.2, 0.28, 0.28, PALETTE.metal);
  for (const x of [-6.4, 6.8]) {
    b.box(x, 3.9, 4.9, 0.2, 7.8, 0.2, PALETTE.metal);
  }
  b.box(0.2, 7.2, 4.9, 1.6, 0.8, 0.9, PALETTE.warning);
  // Office windows above the doors and the works sign.
  b.box(0.4, 5.6, 4.05, 5.4, 1.5, 0.2, PALETTE.glassDark);
  b.box(-0.4, 8.55, -0.6, 4.4, 0.9, 0.14, PALETTE.amber, 0);
  sandbagWall(b, 2.6, 5.4, 4.2, true);
  return b.build();
}

/** Sandbags, wire and trim for an occupied tenement. */
function tenementDressing(): MeshBuffers {
  const b = new MeshBuilder();
  garrisonDressing(b, {
    halfX: 6.6,
    halfZ: 6.6,
    groundY: 0,
    roofY: 8.6,
    roofHalfX: 5.4,
    roofHalfZ: 4.4,
  });
  // An extra firing step inside the ruined entrance, so the ground floor reads
  // as occupied from street level as well as from the air.
  sandbagWall(b, -0.6, 4.9, 3.4, true, 0.95);
  return b.build();
}

/** Sandbags, wire and trim for an occupied ruin. */
function ruinDressing(): MeshBuffers {
  const b = new MeshBuilder();
  garrisonDressing(b, {
    halfX: 5.6,
    halfZ: 5.6,
    groundY: 0,
    roofY: 1.0,
    roofHalfX: 4.6,
    roofHalfZ: 4.6,
  });
  return b.build();
}

/** Sandbags, wire and trim for an occupied warehouse. */
function warehouseDressing(): MeshBuffers {
  const b = new MeshBuilder();
  garrisonDressing(b, {
    halfX: 7.6,
    halfZ: 6.4,
    groundY: 0,
    roofY: 7.1,
    roofHalfX: 6.6,
    roofHalfZ: 4.6,
  });
  // A second firing line across the loading dock, where the wall is lowest.
  sandbagWall(b, 0.2, 7.4, 6.4, true, 1.9);
  return b.build();
}

/** Sandbags, wire and trim for an occupied office block. */
function officeBlockDressing(): MeshBuffers {
  const b = new MeshBuilder();
  garrisonDressing(b, {
    halfX: 6.2,
    halfZ: 7.6,
    groundY: 0,
    roofY: 12.85,
    roofHalfX: 5.0,
    roofHalfZ: 6.4,
  });
  // Sandbag nest on the lobby canopy, so the entrance is covered from above.
  sandbagWall(b, -0.2, 7.0, 4.6, true, 3.15);
  return b.build();
}

/** Sandbags, wire and trim for an occupied civic hall. */
function civicHallDressing(): MeshBuffers {
  const b = new MeshBuilder();
  garrisonDressing(b, {
    halfX: 7.4,
    halfZ: 7.4,
    groundY: 0,
    roofY: 8.7,
    roofHalfX: 6.6,
    roofHalfZ: 6.6,
  });
  // A firing line across the head of the grand steps.
  sandbagWall(b, 0, 9.0, 6.2, true, 1.1);
  return b.build();
}

/** Sandbags, wire and trim for an occupied foundry works. */
function foundryWorksDressing(): MeshBuffers {
  const b = new MeshBuilder();
  garrisonDressing(b, {
    halfX: 7.4,
    halfZ: 5.6,
    groundY: 0,
    roofY: 7.6,
    roofHalfX: 6.4,
    roofHalfZ: 5.0,
  });
  // Sandbags along the yard side, covering the roller doors.
  sandbagWall(b, 0.4, 5.7, 6.0, true, 0.95);
  return b.build();
}

function buildPowerPlant(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 11.8, 0.6, 11.8, PALETTE.concreteDark);
  b.box(0, 0.7, 0, 11.0, 0.4, 11.0, PALETTE.concrete);
  // Turbine hall with a ridged roof and a large ownership panel.
  b.box(-1.4, 2.2, -1.0, 7.4, 2.8, 7.0, PALETTE.canvas);
  b.box(-1.4, 3.75, -1.0, 8.0, 0.35, 7.6, PALETTE.oliveDark);
  for (let i = 0; i < 4; i++) {
    b.box(-4.2 + i * 1.9, 3.98, -1.0, 0.5, 0.12, 7.4, PALETTE.metal);
  }
  ownershipPanel(b, -1.4, 4.12, -1.0, 5.2, 3.8);
  b.box(-1.4, 1.5, 2.55, 3.0, 2.2, 0.3, PALETTE.hullDark);
  b.box(-1.4, 1.7, 2.7, 2.6, 1.8, 0.15, PALETTE.glassDark);
  b.box(-1.4, 5.0, 2.55, 2.2, 0.22, 0.42, PALETTE.metal);
  // Twin exhaust stacks.
  for (const z of [-3.4, 0.4]) {
    b.cylinder(3.6, 3.1, z, 0.75, 5.2, 10, PALETTE.hullLight);
    b.cylinder(3.6, 5.75, z, 0.85, 0.35, 10, PALETTE.metal);
    b.box(3.6, 5.98, z, 0.6, 0.2, 0.6, PALETTE.warning);
  }
  // Transformer yard, with insulated cable gantries tying the plant together.
  b.box(3.2, 0.95, 4.1, 4.0, 0.35, 2.6, PALETTE.concreteDark);
  for (const x of [2.0, 4.4]) {
    b.box(x, 1.9, 4.1, 1.1, 1.6, 1.0, PALETTE.darkMetal);
    b.box(x, 2.75, 4.1, 1.3, 0.2, 1.2, PALETTE.metal);
    b.box(x, 2.95, 3.7, 0.22, 0.5, 0.22, PALETTE.warning);
    b.cylinder(x, 3.1, 4.1, 0.13, 0.45, 6, PALETTE.hullLight);
  }
  b.box(0.2, 1.6, 4.4, 0.18, 2.6, 0.18, PALETTE.metal);
  b.box(3.2, 2.7, 3.4, 3.6, 0.12, 0.12, PALETTE.metal);
  for (const x of [0.6, 5.8]) {
    b.box(x, 2.2, 3.4, 0.16, 3.8, 0.16, PALETTE.metal);
  }
  b.box(3.2, 4.1, 3.4, 5.4, 0.14, 0.14, PALETTE.metal);
  // Switchgear cabinet, cable spools and a hazard bollard row.
  b.box(-4.6, 1.35, 4.3, 2.0, 1.3, 1.4, PALETTE.oliveDark);
  b.box(-4.6, 2.1, 4.3, 2.3, 0.16, 1.7, PALETTE.olive);
  b.box(-4.5, 1.55, 5.02, 0.7, 0.5, 0.08, PALETTE.amber);
  b.cylinder(-2.4, 0.95, 4.6, 0.55, 0.5, 8, PALETTE.darkMetal);
  for (let i = 0; i < 4; i++) {
    b.box(-5.0 + i * 3.0, 1.05, 5.3, 0.35, 0.15, 0.35, PALETTE.warning);
  }
  b.box(0, 0.85, 5.7, 10.0, 0.14, 0.2, PALETTE.metal);
  return b.build();
}

function buildRadar(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 7.8, 0.6, 7.8, PALETTE.concreteDark);
  b.box(0, 0.75, 0, 7.1, 0.4, 7.1, PALETTE.concrete);
  b.box(-0.7, 1.75, 0, 4.6, 2.0, 3.8, PALETTE.hull);
  b.box(-0.7, 2.85, 0, 5.0, 0.3, 4.2, PALETTE.hullLight);
  b.box(2.0, 1.35, 0, 2.8, 1.5, 2.8, PALETTE.oliveDark);
  b.cylinder(2.0, 2.3, 0, 0.62, 1.3, 8, PALETTE.metal);
  // Mast, platform and tilted dish.
  b.box(0, 4.1, 0, 2.4, 0.22, 2.4, PALETTE.hullDark);
  b.box(0, 3.6, 0, 0.3, 3.3, 0.3, PALETTE.metal);
  b.cylinder(0, 5.2, 0, 0.42, 0.5, 8, PALETTE.darkMetal);
  // The tilted dish rides on the mast as a swept part (buildRadarDish).
  // Perimeter mast and warning lamp.
  b.box(2.4, 2.9, 2.0, 0.14, 3.2, 0.14, PALETTE.metal);
  b.box(2.8, 4.35, 2.0, 0.9, 0.16, 0.16, PALETTE.warning);
  b.box(-2.4, 1.0, 2.3, 1.1, 0.7, 1.1, PALETTE.oliveDark);
  b.box(-2.4, 1.4, 2.3, 0.8, 0.2, 0.8, PALETTE.olive);
  b.box(0.6, 1.35, 1.42, 2.8, 0.6, 0.12, PALETTE.hull, 0.86);
  ownershipPanel(b, -0.7, 2.98, 0, 4.2, 3.4);
  return b.build();
}

/**
 * A slatted roll-up door, authored downward from its lintel (y = 0 is the top
 * edge). Scaled about that edge it retracts into the head of the opening like a
 * real roller door, instead of sliding up the facade and hanging above the
 * roof. Shared by every production building so their entrances match.
 */
function shutterMesh(
  width: number,
  height: number,
  slats: number,
  face: [number, number, number],
  edge: [number, number, number],
): MeshBuffers {
  const b = new MeshBuilder();
  for (let i = 0; i < slats; i++) {
    b.box(
      0,
      -height + (i + 0.5) * (height / slats),
      0,
      width,
      height / slats - 0.03,
      0.14,
      i % 2 === 0 ? face : edge,
    );
  }
  // Hazard band near the bottom edge and a steel cap at the head.
  b.box(0, -height + 0.24, 0.09, width - 0.55, 0.18, 0.06, PALETTE.warning);
  b.box(0, -0.12, 0.08, width, 0.14, 0.06, PALETTE.metal);
  b.box(0, -height + 0.8, 0.09, width - 0.45, 0.06, 0.05, PALETTE.darkMetal);
  return b.build();
}

function buildFactoryDoor(): MeshBuffers {
  return shutterMesh(4.5, 3.5, 12, PALETTE.hull, PALETTE.hullDark);
}

function buildBarracksDoor(): MeshBuffers {
  return shutterMesh(2.2, 1.7, 7, PALETTE.canvas, PALETTE.oliveDark);
}

function buildHangarDoor(): MeshBuffers {
  return shutterMesh(4.6, 3.4, 12, PALETTE.hull, PALETTE.hullDark);
}

/** Headquarters antenna dish, authored around the top of its mast. */
function buildCommandMast(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0, 0, 2.4, 0.14, 0.75, PALETTE.metal);
  b.box(0, 0.3, 0, 0.7, 0.7, 0.7, PALETTE.darkMetal);
  b.box(1.0, 0.34, 0.28, 0.28, 0.8, 0.22, PALETTE.hullLight);
  b.box(0, 0.62, 0, 0.16, 0.16, 0.16, PALETTE.warning);
  return b.build();
}

/** Airfield approach radar, authored around its tower mount. */
function buildAirfieldRadar(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0, 0, 0.18, 0.5, 0.18, PALETTE.metal);
  b.box(0, 0.28, 0, 0.42, 0.3, 0.42, PALETTE.darkMetal);
  b.boxRot(0.55, 0.3, 0, 1.9, 0.9, 0.16, 0.85, PALETTE.hullLight);
  b.box(-0.35, 0.42, 0, 0.2, 0.2, 0.2, PALETTE.warning);
  return b.build();
}

/** Comms drum and dish on the relay mast, authored around the mount. */
function buildRelayDish(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(-1.35, 0, 0, 1.2, 0.16, 1.6, PALETTE.hullLight);
  b.box(1.35, 0.3, 0, 0.5, 0.5, 0.5, PALETTE.hullLight);
  b.cylinderX(1.35, 0.3, 0, 0.42, 0.45, 8, PALETTE.hullLight);
  b.box(0, 0.05, 0, 0.2, 0.2, 0.2, PALETTE.darkMetal);
  b.box(-1.35, 0.2, 0, 0.12, 0.12, 0.12, PALETTE.warning);
  return b.build();
}

/** Tilted dish of the radar tower, authored around the mast top. */
function buildRadarDish(): MeshBuffers {
  const b = new MeshBuilder();
  b.boxRot(0.2, 0.25, 0, 3.4, 1.5, 0.2, 0.55, PALETTE.hullLight);
  b.box(0, 0.05, 0, 0.18, 1.0, 0.18, PALETTE.darkMetal);
  b.box(1.1, 0.62, 0, 0.16, 0.16, 0.16, PALETTE.warning);
  return b.build();
}

/** Broad swept array of a radar station, authored around the tower top. */
function buildRadarStationDish(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, -0.05, 0, 0.9, 0.3, 0.9, PALETTE.darkMetal);
  b.box(0, 0.35, 0, 0.35, 1.1, 0.35, PALETTE.metal);
  // Backing frame first, then the broad sail and its horizontal stiffeners.
  b.box(-0.35, 0.85, 0, 0.22, 1.8, 0.5, PALETTE.darkMetal);
  b.box(-0.35, 1.5, 0, 0.22, 0.16, 4.6, PALETTE.metal);
  b.box(-0.35, 0.15, 0, 0.22, 0.16, 4.6, PALETTE.metal);
  b.boxRot(-0.2, 0.85, 0, 5.6, 2.1, 0.26, 0.18, PALETTE.hullLight);
  for (const y of [0.25, 0.85, 1.45]) {
    b.boxRot(0.08, y, 0, 5.4, 0.08, 0.06, 0.18, PALETTE.darkMetal);
  }
  b.box(-3.2, 0.85, 0, 0.4, 0.12, 0.12, PALETTE.metal);
  b.box(-3.25, 0.5, 0, 0.18, 0.8, 0.18, PALETTE.metal);
  b.box(2.5, 1.9, 0, 0.4, 0.2, 0.4, PALETTE.warning);
  return b.build();
}

export interface BuildingStyle {
  body: MeshBuffers;
  /**
   * Roller shutter on a production building. `offset` is the head of the bay
   * (the panel's top edge) relative to the building origin, and `retract` is
   * the fraction of its height that rolls up while units are coming out.
   */
  door?: { mesh: MeshBuffers; offset: [number, number, number]; retract: number };
  /** Continuously swept mast part (radar dishes), rotated at `rate` rad/s. */
  rotor?: { mesh: MeshBuffers; offset: [number, number, number]; rate: number };
  /**
   * Optional occupied variant for garrisonable shelters: the same building with
   * sandbags, wire and team-tinted trim. Rendered only while infantry
   * are inside, so an empty shelter reads as empty at a glance.
   */
  garrisoned?: MeshBuffers;
  /**
   * What a structure looks like once it has been knocked out but has not been
   * cleared from the map. Only walkable spans use it: everything else is
   * removed when it dies, but a dropped bridge stays as wreckage over the water
   * so the closed crossing can be read and re-decked.
   */
  ruined?: MeshBuffers;
  /** Optional traversing weapon on a fixed mount. */
  turret?: MeshBuffers;
  turretOffset?: [number, number, number];
}

/**
 * Merge static and traversing parts into one mesh for thumbnails. The turret
 * is authored around its own pintle, so its mount offset has to be baked in
 * here; without it the gun sits on the ground behind the parapet.
 */
function mergeMeshes(
  a: MeshBuffers,
  b: MeshBuffers,
  offset: readonly [number, number, number] = [0, 0, 0],
): MeshBuffers {
  const positions = new Float32Array(a.positions.length + b.positions.length);
  positions.set(a.positions, 0);
  for (let i = 0; i < b.positions.length; i += 3) {
    positions[a.positions.length + i] = b.positions[i] + offset[0];
    positions[a.positions.length + i + 1] = b.positions[i + 1] + offset[1];
    positions[a.positions.length + i + 2] = b.positions[i + 2] + offset[2];
  }
  const normals = new Float32Array(a.normals.length + b.normals.length);
  normals.set(a.normals, 0);
  normals.set(b.normals, a.normals.length);
  const colors = new Float32Array(a.colors.length + b.colors.length);
  colors.set(a.colors, 0);
  colors.set(b.colors, a.colors.length);
  const teamMask = new Float32Array(a.teamMask.length + b.teamMask.length);
  teamMask.set(a.teamMask, 0);
  teamMask.set(b.teamMask, a.teamMask.length);
  const vertexCount = a.positions.length / 3;
  const aMaterials = a.materials ?? new Float32Array(vertexCount);
  const bMaterials = b.materials ?? new Float32Array(b.positions.length / 3);
  const materials = new Float32Array(aMaterials.length + bMaterials.length);
  materials.set(aMaterials, 0);
  materials.set(bMaterials, aMaterials.length);
  const indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices, 0);
  for (let i = 0; i < b.indices.length; i++) indices[a.indices.length + i] = b.indices[i] + vertexCount;
  return { positions, normals, colors, teamMask, materials, indices };
}

/* ------------------------------------------------------------------ */
/* Rural, civic and observation shelters                               */
/* ------------------------------------------------------------------ */

/**
 * Stone farmhouse with an attached barn and a walled yard (3x3 tiles).
 * Two storeys of house next to a single-storey barn: the roofline is what makes
 * it read as a working farm rather than another urban block.
 */
function buildFarmhouse(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.28, 0, 11.5, 0.56, 11.5, PALETTE.concreteDark);
  b.box(0, 0.68, 0, 10.8, 0.28, 10.8, PALETTE.concrete);
  // House: two storeys under a shallow hipped roof.
  b.box(-1.4, 3.2, 0.4, 6.8, 5.2, 6.6, PALETTE.canvas);
  b.box(-1.4, 6.05, 0.4, 7.4, 0.5, 7.2, PALETTE.concrete);
  b.box(-1.4, 6.5, 0.4, 5.6, 0.4, 5.2, PALETTE.oliveDark);
  b.box(-3.4, 7.1, 2.6, 0.7, 2.4, 0.7, PALETTE.concreteDark);
  // Barn: long and low, with a dark patched roof.
  b.box(3.6, 2.5, -1.6, 4.0, 3.8, 8.4, PALETTE.hullDark);
  b.box(3.6, 4.6, -1.6, 4.6, 0.4, 9.0, PALETTE.oliveDark);
  b.box(3.6, 2.0, 2.6, 2.4, 2.8, 0.2, PALETTE.darkMetal);
  // Shuttered windows and the kitchen door.
  for (let i = 0; i < 3; i++) {
    const x = -3.4 + i * 2.0;
    b.box(x, 2.2, 3.75, 1.2, 1.0, 0.16, PALETTE.glassDark);
    b.box(x, 4.6, 3.75, 1.2, 1.0, 0.16, PALETTE.glassDark);
  }
  b.box(-1.4, 1.5, 3.8, 1.2, 2.4, 0.2, PALETTE.hullDark);
  // Yard wall, water butt and crates.
  sandbagWall(b, -1.4, 4.9, 5.4, true, 0.85);
  b.cylinder(-4.4, 1.35, 4.6, 0.55, 1.5, 8, PALETTE.darkMetal);
  b.box(3.0, 1.0, 4.4, 1.0, 0.9, 1.0, PALETTE.concreteDark);
  return b.build();
}

/**
 * Village chapel with a bell tower (3x4 tiles).
 * The tower is deliberately the tallest thing on any rural map: it is the
 * observation post the description promises, and its silhouette is unique.
 */
function buildChapel(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.28, 0, 11.4, 0.56, 15.4, PALETTE.concreteDark);
  b.box(0, 0.68, 0, 10.6, 0.28, 14.6, PALETTE.concrete);
  // Nave with a steep roof and a modest porch.
  b.box(1.0, 3.1, 1.2, 7.2, 6.2, 10.4, PALETTE.concrete);
  b.box(1.0, 6.5, 1.2, 7.8, 0.4, 11.0, PALETTE.concreteDark);
  b.box(1.0, 6.95, 1.2, 5.2, 0.5, 9.2, PALETTE.concrete);
  b.box(1.0, 1.6, 6.6, 2.2, 2.6, 0.5, PALETTE.hullDark);
  // Bell tower: square shaft, louvred belfry, cap and spire.
  b.box(-3.6, 5.2, -4.6, 4.6, 10.4, 4.6, PALETTE.concrete);
  b.box(-3.6, 10.7, -4.6, 5.2, 0.6, 5.2, PALETTE.concreteDark);
  for (const [dx, dz] of [[0, -2.28], [0, 2.28], [-2.28, 0], [2.28, 0]] as const) {
    b.box(-3.6 + dx, 8.7, -4.6 + dz, dx === 0 ? 1.8 : 0.16, 1.3, dz === 0 ? 1.8 : 0.16, PALETTE.glassDark);
  }
  b.cone(-3.6, 11.0, -4.6, 2.2, 2.8, 4, PALETTE.concreteDark);
  b.box(-3.6, 14.0, -4.6, 0.14, 0.9, 0.14, PALETTE.metal);
  b.box(-3.6, 14.2, -4.6, 0.7, 0.14, 0.14, PALETTE.metal);
  // Tall lancet windows down both flanks of the nave.
  for (let i = 0; i < 3; i++) {
    const z = -2.4 + i * 3.2;
    b.box(4.65, 4.2, z, 0.16, 2.2, 1.1, PALETTE.glassDark);
    b.box(-2.65, 4.2, z, 0.16, 2.2, 1.1, PALETTE.glassDark);
  }
  sandbagWall(b, 1.0, 7.4, 4.6, true, 0.9);
  return b.build();
}

/**
 * Civic police station (4x3 tiles): a two-storey block with a walled vehicle
 * yard. Flat roof, deep parapet and a radio mast — an institutional building,
 * not another apartment block.
 */
function buildConstabulary(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.26, 0, 15.4, 0.52, 11.4, PALETTE.concreteDark);
  b.box(0, 0.64, 0, 14.8, 0.24, 10.8, PALETTE.concrete);
  b.box(-1.4, 3.5, 0.2, 10.8, 6.4, 8.4, PALETTE.canvas);
  b.box(-1.4, 7.0, 0.2, 11.2, 0.45, 8.8, PALETTE.concrete);
  // Parapet wall around the roof deck.
  b.box(-1.4, 7.6, 4.4, 11.2, 0.7, 0.25, PALETTE.concreteDark);
  b.box(-1.4, 7.6, -4.0, 11.2, 0.7, 0.25, PALETTE.concreteDark);
  b.box(-6.85, 7.6, 0.2, 0.25, 0.7, 8.4, PALETTE.concreteDark);
  b.box(4.05, 7.6, 0.2, 0.25, 0.7, 8.4, PALETTE.concreteDark);
  // Vehicle yard wing with its own flat roof.
  b.box(4.9, 2.0, 0.6, 4.6, 3.6, 6.4, PALETTE.concrete);
  b.box(4.9, 3.9, 0.6, 5.0, 0.24, 6.8, PALETTE.concreteDark);
  // Barred windows across the street face and the lobby canopy.
  for (let i = 0; i < 4; i++) {
    const x = -5.0 + i * 2.4;
    b.box(x, 2.6, 4.45, 1.3, 1.1, 0.16, PALETTE.glassDark);
    b.box(x, 5.2, 4.45, 1.3, 1.1, 0.16, PALETTE.glassDark);
  }
  b.box(-1.4, 2.4, 4.9, 3.4, 0.25, 1.4, PALETTE.hullDark);
  b.box(-1.4, 1.5, 4.5, 1.4, 2.4, 0.2, PALETTE.hullDark);
  // Radio mast, yard sandbags and a parked drum.
  b.box(-5.2, 9.35, -3.2, 0.18, 4.2, 0.18, PALETTE.metal);
  b.box(-5.2, 11.4, -3.2, 1.0, 0.1, 0.1, PALETTE.metal);
  sandbagWall(b, 4.9, 4.2, 3.4, true, 0.9);
  b.cylinder(6.6, 0.9, -3.3, 0.6, 1.2, 8, PALETTE.darkMetal);
  return b.build();
}

/**
 * Timber fire lookout (2x2 tiles): four braced legs carrying a glassed cab.
 * Nothing else on the battlefield has an open frame, so it is recognisable at
 * a glance even among the treeline it is built to see over.
 */
function buildWatchtower(): MeshBuffers {
  const b = new MeshBuilder();
  for (const [x, z] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]] as const) {
    b.box(x, 0.3, z, 1.0, 0.6, 1.0, PALETTE.concreteDark);
    b.box(x, 2.7, z, 0.42, 4.6, 0.42, PALETTE.hullDark);
  }
  // Cross bracing, one bay per face at two heights.
  for (const y of [1.7, 3.7]) {
    b.boxRot(0, y, -2.6, 5.6, 0.16, 0.16, 0.42, PALETTE.darkMetal);
    b.boxRot(0, y, 2.6, 5.6, 0.16, 0.16, -0.42, PALETTE.darkMetal);
    b.boxRot(-2.6, y, 0, 5.6, 0.16, 0.16, Math.PI / 2 + 0.42, PALETTE.darkMetal);
    b.boxRot(2.6, y, 0, 5.6, 0.16, 0.16, Math.PI / 2 - 0.42, PALETTE.darkMetal);
  }
  // Deck, railing and the glassed cab.
  b.box(0, 5.05, 0, 5.8, 0.36, 5.8, PALETTE.concreteDark);
  for (const [x, z] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]] as const) {
    b.box(x, 5.7, z, 0.18, 0.95, 0.18, PALETTE.metal);
  }
  b.box(0, 6.35, 0, 4.0, 2.3, 4.0, PALETTE.canvas);
  b.box(0, 6.9, 0, 4.08, 0.9, 4.08, PALETTE.glassDark);
  b.box(0, 7.65, 0, 4.6, 0.3, 4.6, PALETTE.hullDark);
  // Ladder up the seaward face and the lookout lamp on the rail.
  for (let i = 0; i < 8; i++) b.box(0, 0.8 + i * 0.55, 1.9 - i * 0.06, 0.7, 0.1, 0.12, PALETTE.metal);
  b.box(2.3, 5.9, 2.3, 0.3, 0.3, 0.3, PALETTE.amber);
  return b.build();
}

/**
 * Road bridge (4x4 tiles).
 *
 * The deck runs along local X, so the art points the same way the map authors
 * the crossing: a quarter-turn `facing` on the structure turns the span across
 * the channel it bridges. The two ends are abutments that sit on the banks; the
 * middle is a pier-supported slab with parapets along both carriageway edges.
 * The deck top is ~1.1 units up, which clears the sea plane without leaving a
 * ledge for a vehicle to climb.
 */
function buildBridge(): MeshBuffers {
  const b = new MeshBuilder();
  const span = 15.4;
  // Abutments: the deck lands on solid ground at both banks.
  b.box(-6.9, 0.32, 0, 3.0, 0.64, 7.4, PALETTE.concreteDark);
  b.box(6.9, 0.32, 0, 3.0, 0.64, 7.4, PALETTE.concreteDark);
  // Deck slab, its kerbs and the asphalt strip between them.
  b.box(0, 0.86, 0, span, 0.44, 7.2, PALETTE.concreteDark);
  b.box(0, 1.12, 0, span - 0.6, 0.1, 6.2, PALETTE.concrete);
  b.box(0, 1.18, 0, span - 1.4, 0.06, 4.6, PALETTE.darkMetal);
  // Parapets: a low concrete wall each side with a steel rail on top.
  for (const z of [-3.5, 3.5]) {
    b.box(0, 1.36, z, span, 0.5, 0.34, PALETTE.concrete);
    b.box(0, 1.72, z, span - 0.4, 0.12, 0.12, PALETTE.metal);
    for (let i = -3; i <= 3; i++) b.box(i * 2.3, 1.58, z, 0.14, 0.36, 0.14, PALETTE.metal);
  }
  // Centre pier and the two bank piers under the slab.
  b.box(0, 0.42, 0, 2.2, 0.86, 6.4, PALETTE.concreteDark);
  for (const x of [-4.6, 4.6]) {
    b.box(x, 0.42, 0, 1.5, 0.86, 6.2, PALETTE.concreteDark);
    b.box(x, 0.3, -2.6, 1.7, 0.6, 1.7, PALETTE.concreteDark);
    b.box(x, 0.3, 2.6, 1.7, 0.6, 1.7, PALETTE.concreteDark);
  }
  // Chevron boards at both mouths and a pair of lamps on the near parapet.
  for (const x of [-7.3, 7.3]) {
    b.box(x, 1.5, 0, 0.18, 0.9, 1.5, PALETTE.warning);
    b.box(x + Math.sign(x) * 0.02, 1.5, 0, 0.1, 0.5, 0.7, PALETTE.darkMetal);
  }
  for (const x of [-5.2, 5.2]) {
    b.cylinder(x, 1.72, -3.5, 0.08, 0.9, 5, PALETTE.metal);
    b.box(x, 2.2, -3.5, 0.24, 0.16, 0.24, PALETTE.amber);
  }
  return b.build();
}

/**
 * The same span after the deck has been shot out: abutments, broken stubs and
 * girders hanging over the water. Rendered in place of the intact deck while
 * the structure's hit points are at zero, so a closed crossing is visible
 * rather than an empty gap.
 */
function buildBridgeRuin(): MeshBuffers {
  const b = new MeshBuilder();
  // Only the two bank stubs survive, plus the charred ends of the slab.
  for (const dir of [-1, 1] as const) {
    b.box(dir * 6.9, 0.32, 0, 3.0, 0.64, 7.4, PALETTE.concreteDark);
    b.box(dir * 6.0, 0.86, 0, 4.2, 0.44, 7.2, PALETTE.concreteDark);
    b.box(dir * 4.3, 0.9, 0, 1.4, 0.36, 6.6, PALETTE.concrete);
    for (const z of [-3.5, 3.5]) b.box(dir * 6.0, 1.36, z, 4.2, 0.5, 0.34, PALETTE.concrete);
    // Girder ends bent down into the water, with rebar spikes.
    for (const z of [-2.2, 0.4, 2.6]) {
      b.boxRot(dir * 3.4, 0.62, z, 2.6, 0.22, 0.34, dir * -0.42, PALETTE.darkMetal);
      for (let i = 0; i < 3; i++) {
        b.box(dir * (2.6 + i * 0.35), 0.72 - i * 0.1, z + 0.2, 0.1, 0.1, 0.5, PALETTE.metal);
      }
    }
    b.box(dir * 4.9, 0.5, -2.6, 1.7, 0.6, 1.7, PALETTE.concreteDark);
    b.box(dir * 4.9, 0.5, 2.6, 1.7, 0.6, 1.7, PALETTE.concreteDark);
  }
  // Rubble in the channel where the centre pier and span came down.
  b.box(0, 0.22, 0.6, 3.2, 0.44, 3.4, PALETTE.concreteDark);
  b.box(-1.4, 0.36, -1.2, 1.6, 0.3, 1.8, PALETTE.concrete);
  b.box(1.8, 0.3, 1.9, 1.2, 0.24, 1.2, PALETTE.concrete);
  return b.build();
}

/**
 * Steel goods shed (4x4 tiles).
 *
 * Roller doors at both ends so a column reads the through-route, a shallow
 * sawtooth roof, and a gantry rail over the loading apron. Lighter and lower
 * than the brick warehouse: this is the shelter of a working yard, not a
 * landmark.
 */
function buildFreightShed(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.28, 0, 15.2, 0.56, 15.2, PALETTE.concreteDark);
  b.box(0, 0.62, 0, 14.4, 0.22, 14.4, PALETTE.concrete);
  // The shed itself: corrugated walls, taller than a farm building and squat
  // enough that it never hides the rest of the yard.
  b.box(0, 3.1, 0, 13.6, 4.9, 13.6, PALETTE.canvas);
  b.box(0, 5.72, 0, 14.2, 0.36, 14.2, PALETTE.oliveDark);
  for (let i = 0; i < 3; i++) {
    b.box(-4.4 + i * 4.4, 6.0, 0, 3.2, 0.5, 12.6, PALETTE.olive);
  }
  // Corrugation: vertical ribs down both street faces.
  for (let i = 0; i < 11; i++) {
    const z = -6.0 + i * 1.2;
    b.box(-6.84, 3.1, z, 0.14, 4.6, 0.28, PALETTE.oliveDark);
    b.box(6.84, 3.1, z, 0.14, 4.6, 0.28, PALETTE.oliveDark);
  }
  // Loading doors at both ends, with rails and a lamp over each.
  for (const dir of [-1, 1] as const) {
    b.box(dir * 7.0, 2.3, 0, 0.22, 3.6, 5.6, PALETTE.darkMetal);
    b.box(dir * 7.1, 2.3, 0, 0.1, 3.3, 5.1, PALETTE.metal);
    for (let i = 0; i < 7; i++) b.box(dir * 7.16, 0.9 + i * 0.46, 0, 0.06, 0.06, 5.0, PALETTE.hullDark);
    b.box(dir * 6.9, 4.4, 0, 0.5, 0.28, 0.7, PALETTE.amber);
  }
  // Loading apron and the gantry that serves it.
  b.box(0, 0.78, 7.4, 12.4, 0.16, 2.6, PALETTE.concrete);
  for (const x of [-4.8, 4.8]) b.box(x, 2.6, 7.4, 0.28, 3.6, 0.28, PALETTE.metal);
  b.box(0, 4.4, 7.4, 10.0, 0.26, 0.26, PALETTE.metal);
  b.box(-2.0, 3.9, 7.4, 0.34, 0.9, 0.34, PALETTE.darkMetal);
  // Crate stacks under the gantry.
  for (const [x, z, w] of [
    [-3.4, 8.2, 2.2],
    [0.6, 8.4, 2.6],
    [4.0, 8.1, 2.0],
  ] as const) {
    b.box(x, 1.1, z, w, 0.7, w, PALETTE.sandbag);
    b.box(x, 1.7, z, w * 0.7, 0.5, w * 0.7, PALETTE.oliveDark);
  }
  return b.build();
}

/** Wire, sandbags and a covered firing position for an occupied shed. */
function freightShedDressing(): MeshBuffers {
  const b = new MeshBuilder();
  garrisonDressing(b, {
    halfX: 7.6,
    halfZ: 7.6,
    groundY: 0,
    roofY: 6.4,
    roofHalfX: 6.4,
    roofHalfZ: 6.4,
  });
  // Sandbagged position in the open bay, facing the yard.
  b.box(3.4, 1.05, 7.2, 3.0, 0.9, 0.8, PALETTE.sandbag);
  b.box(3.4, 1.5, 7.2, 2.4, 0.4, 0.6, PALETTE.sandbag);
  return b.build();
}

/** Wire, sandbags and sentries for an occupied farmyard. */
function farmhouseDressing(): MeshBuffers {
  const b = new MeshBuilder();
  garrisonDressing(b, {
    halfX: 5.5,
    halfZ: 5.5,
    groundY: 0,
    roofY: 6.3,
    roofHalfX: 4.6,
    roofHalfZ: 4.4,
  });
  sandbagWall(b, -1.4, 5.1, 4.6, true, 1.0);
  return b.build();
}

/** Wire, sandbags and a tower observation post for an occupied chapel. */
function chapelDressing(): MeshBuffers {
  const b = new MeshBuilder();
  garrisonDressing(b, {
    halfX: 5.5,
    halfZ: 7.5,
    groundY: 0,
    roofY: 6.7,
    roofHalfX: 3.8,
    roofHalfZ: 5.4,
  });
  // A sandbagged step on the tower gallery: the observer's own position.
  sandbagWall(b, -3.6, -2.0, 3.4, true, 11.0);
  return b.build();
}

/** Wire and yard barricades for an occupied constabulary. */
function constabularyDressing(): MeshBuffers {
  const b = new MeshBuilder();
  garrisonDressing(b, {
    halfX: 7.5,
    halfZ: 5.5,
    groundY: 0,
    roofY: 7.2,
    roofHalfX: 5.4,
    roofHalfZ: 4.2,
  });
  sandbagWall(b, -1.4, 5.2, 4.0, true, 1.0);
  return b.build();
}

/** A held lookout: sandbags on the deck and a crew in the cab. */
function watchtowerDressing(): MeshBuffers {
  const b = new MeshBuilder();
  garrisonDressing(b, {
    halfX: 3.1,
    halfZ: 3.1,
    groundY: 0,
    roofY: 5.23,
    roofHalfX: 2.4,
    roofHalfZ: 2.4,
  });
  sandbagWall(b, 0, 2.4, 3.2, true, 5.4);
  return b.build();
}

const STYLES: Record<string, BuildingStyle> = {
  commandPost: {
    body: buildCommandPost(),
    rotor: { mesh: buildCommandMast(), offset: [-4.8, 9.2, -4.4], rate: 0.7 },
  },
  barracks: {
    body: buildBarracks(),
    door: { mesh: buildBarracksDoor(), offset: [2.6, 2.45, 2.74], retract: 0.9 },
  },
  factory: {
    body: buildFactory(),
    door: { mesh: buildFactoryDoor(), offset: [-0.5, 4.45, 4.9], retract: 0.92 },
  },
  refinery: { body: buildRefinery() },
  airfield: {
    body: buildAirfield(),
    door: { mesh: buildHangarDoor(), offset: [-8.2, 3.85, -3.36], retract: 0.9 },
    rotor: { mesh: buildAirfieldRadar(), offset: [8.4, 8.35, -7.0], rate: 1.5 },
  },
  shipyard: { body: buildShipyard() },
  // The shipyard has no shutter: its corvettes launch from the open slipway
  // basin, not through a door in a wall it does not have.
  samBattery: { body: buildSam() },
  mgNest: {
    body: buildMgNestBody(),
    turret: buildMgNestTurret(),
    turretOffset: [0, 1.55, 0],
  },
  bunker: {
    body: buildBunkerBody(),
    turret: buildMgNestTurret(),
    turretOffset: [0, 1.55, 0],
  },
  atTurret: {
    body: buildAtTurretBody(),
    turret: buildAtTurretGun(),
    turretOffset: [0, 1.3, 0],
  },
  coastalBattery: {
    body: buildCoastalBatteryBody(),
    turret: buildCoastalBatteryTurret(),
    turretOffset: [0, 1.35, 0],
  },
  powerPlant: { body: buildPowerPlant() },
  radar: {
    body: buildRadar(),
    rotor: { mesh: buildRadarDish(), offset: [0, 5.35, 0], rate: 0.95 },
  },
  relay: {
    body: buildRelay(),
    rotor: { mesh: buildRelayDish(), offset: [0, 4.9, 0], rate: 1.2 },
  },
  supplyDepot: { body: buildSupplyDepot() },
  radarStation: {
    body: buildRadarStation(),
    rotor: { mesh: buildRadarStationDish(), offset: [0, 6.1, 0], rate: 0.45 },
  },
  tenement: {
    body: buildTenement(),
    garrisoned: mergeMeshes(buildTenement(), tenementDressing()),
  },
  ruin: {
    body: buildRuin(),
    garrisoned: mergeMeshes(buildRuin(), ruinDressing()),
  },
  bridge: {
    body: buildBridge(),
    ruined: buildBridgeRuin(),
  },
  warehouse: {
    body: buildWarehouse(),
    garrisoned: mergeMeshes(buildWarehouse(), warehouseDressing()),
  },
  freightShed: {
    body: buildFreightShed(),
    garrisoned: mergeMeshes(buildFreightShed(), freightShedDressing()),
  },
  officeBlock: {
    body: buildOfficeBlock(),
    garrisoned: mergeMeshes(buildOfficeBlock(), officeBlockDressing()),
  },
  civicHall: {
    body: buildCivicHall(),
    garrisoned: mergeMeshes(buildCivicHall(), civicHallDressing()),
  },
  foundryWorks: {
    body: buildFoundryWorks(),
    garrisoned: mergeMeshes(buildFoundryWorks(), foundryWorksDressing()),
  },
  farmhouse: {
    body: buildFarmhouse(),
    garrisoned: mergeMeshes(buildFarmhouse(), farmhouseDressing()),
  },
  chapel: {
    body: buildChapel(),
    garrisoned: mergeMeshes(buildChapel(), chapelDressing()),
  },
  constabulary: {
    body: buildConstabulary(),
    garrisoned: mergeMeshes(buildConstabulary(), constabularyDressing()),
  },
  watchtower: {
    body: buildWatchtower(),
    garrisoned: mergeMeshes(buildWatchtower(), watchtowerDressing()),
  },
};

export function buildingStyle(id: string): BuildingStyle | undefined {
  return STYLES[id];
}

const COMBINED = new Map<string, MeshBuffers>();
/**
 * The whole building as one static mesh, with every moving part baked in at its
 * resting position. Used for thumbnails, which have no clock to animate.
 */
export function buildingMesh(id: string): MeshBuffers | undefined {
  const style = STYLES[id];
  if (!style) return undefined;
  if (!style.turret && !style.door && !style.rotor) return style.body;
  let mesh = COMBINED.get(id);
  if (!mesh) {
    mesh = style.body;
    if (style.turret) mesh = mergeMeshes(mesh, style.turret, style.turretOffset ?? [0, 0, 0]);
    if (style.door) mesh = mergeMeshes(mesh, style.door.mesh, style.door.offset);
    if (style.rotor) mesh = mergeMeshes(mesh, style.rotor.mesh, style.rotor.offset);
    COMBINED.set(id, mesh);
  }
  return mesh;
}

const TOP_HEIGHTS = new Map<string, number>();
function meshTop(mesh: MeshBuffers): number {
  let top = 0;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    if (mesh.positions[i] > top) top = mesh.positions[i];
  }
  return top;
}

function tallerMesh(id: string): MeshBuffers | undefined {
  const mesh = buildingMesh(id);
  const garrisoned = STYLES[id]?.garrisoned;
  if (!mesh) return garrisoned;
  if (!garrisoned) return mesh;
  return meshTop(garrisoned) > meshTop(mesh) ? garrisoned : mesh;
}

/**
 * Highest visible surface of a structure, including turrets, doors, rotors and
 * the occupied garrison variant. Overlay banners anchor to this instead of the
 * data footprint, which is unrelated to how tall the authored mesh is.
 */
export function buildingTopHeight(id: string): number {
  const cached = TOP_HEIGHTS.get(id);
  if (cached !== undefined) return cached;
  const mesh = tallerMesh(id);
  if (!mesh) return 0;
  const top = meshTop(mesh);
  TOP_HEIGHTS.set(id, top);
  return top;
}

export interface BuildingBannerAnchor {
  x: number;
  y: number;
  z: number;
}

const BANNER_ANCHORS = new Map<string, BuildingBannerAnchor>();
const BANNER_POINTS = new Map<string, ReadonlyArray<BuildingBannerAnchor>>();

/**
 * Distinct vertices in the top band of the silhouette. The overlay projects
 * them to place the bar above the highest visible screen edge, which a single
 * world-space height cannot guarantee when a building is rotated and its top
 * point moves toward the camera.
 */
export function buildingBannerPoints(id: string): ReadonlyArray<BuildingBannerAnchor> {
  const cached = BANNER_POINTS.get(id);
  if (cached) return cached;
  const mesh = tallerMesh(id);
  if (!mesh) {
    const fallback = [{ x: 0, y: 0.45, z: 0 }];
    BANNER_POINTS.set(id, fallback);
    return fallback;
  }
  const top = meshTop(mesh);
  const band = Math.max(0, top - 0.45);
  const seen = new Set<string>();
  const points: BuildingBannerAnchor[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (mesh.positions[i + 1] < band) continue;
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    const key = `${x.toFixed(3)}|${y.toFixed(3)}|${z.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ x, y, z });
  }
  if (points.length === 0) points.push({ x: 0, y: top, z: 0 });
  BANNER_POINTS.set(id, points);
  return points;
}

/**
 * Local centre of the top band, used as the fallback screen position and as a
 * readable world-space contract in tests. The overlay still projects every
 * top-band point so rotation cannot push a bar into the roof.
 */
export function buildingBannerAnchor(id: string): BuildingBannerAnchor {
  const cached = BANNER_ANCHORS.get(id);
  if (cached) return cached;
  const points = buildingBannerPoints(id);
  let sx = 0;
  let sz = 0;
  for (const p of points) {
    sx += p.x;
    sz += p.z;
  }
  const anchor = {
    x: sx / points.length,
    y: buildingTopHeight(id) + 0.45,
    z: sz / points.length,
  };
  BANNER_ANCHORS.set(id, anchor);
  return anchor;
}

export const FALLBACK_BUILDING: MeshBuffers = (() => {
  const b = new MeshBuilder();
  b.box(0, 1.5, 0, 8, 3, 8, PALETTE.concrete);
  b.box(0, 3.2, 0, 6, 0.5, 6, shade(PALETTE.concrete, 1.2));
  return b.build();
})();
