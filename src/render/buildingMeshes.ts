import { MeshBuilder, PALETTE, shade } from './geometry';
import type { MeshBuffers } from './gl';

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
 * Occupied-shelter dressing: a concertina ring around the footprint, sandbag
 * firing positions on the roof, a team flag and a team-tinted trim band. Team
 * colour is carried by masked vertices, so the same mesh is recoloured for
 * whoever is inside instead of needing one mesh per owner.
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

  // Team flag on the roof corner.
  const poleX = -roofHalfX + 0.55;
  const poleZ = roofHalfZ - 0.55;
  b.box(poleX, roofY + 1.35, poleZ, 0.09, 2.7, 0.09, PALETTE.metal);
  b.box(poleX + 0.58, roofY + 2.3, poleZ, 1.05, 0.58, 0.06, PALETTE.hull, 1);
  b.box(poleX, roofY + 2.72, poleZ, 0.16, 0.16, 0.16, PALETTE.warning);

  // Ground-level sandbags covering the entrance approach.
  sandbagWall(b, 0, halfZ + 1.1, halfX * 1.4, true, groundY + 0.3);
}

function buildCommandPost(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 15.6, 0.6, 15.6, PALETTE.concreteDark);
  b.box(0, 0.8, 0, 14.6, 0.5, 14.6, PALETTE.concrete);
  b.box(-1.2, 2.2, -0.5, 10.0, 2.8, 8.4, PALETTE.concrete);
  b.box(-1.2, 2.0, 3.9, 9.6, 2.1, 0.6, PALETTE.concreteDark);
  b.box(-1.2, 3.05, -0.5, 10.6, 0.35, 8.9, PALETTE.hullDark);
  b.box(-1.0, 3.6, -0.5, 4.4, 1.2, 4.4, PALETTE.hull, 0.35);
  b.box(-1.0, 4.35, -0.5, 4.9, 0.25, 4.9, PALETTE.hullLight);
  b.box(2.6, 3.7, 2.6, 2.6, 0.9, 2.4, PALETTE.glass);
  b.box(2.6, 3.85, 2.6, 2.9, 0.14, 2.7, PALETTE.hullDark);
  // Antenna mast and dishes.
  b.box(-4.8, 6.0, -4.4, 0.2, 6.0, 0.2, PALETTE.metal);
  b.box(-4.8, 9.2, -4.4, 2.2, 0.12, 0.7, PALETTE.metal);
  b.box(-4.8, 8.9, -4.4, 0.7, 0.7, 0.7, PALETTE.darkMetal);
  b.box(3.6, 5.4, -4.0, 0.16, 4.0, 0.16, PALETTE.metal);
  b.box(3.6, 7.4, -4.0, 1.5, 1.0, 0.16, PALETTE.hullLight);
  // Flags.
  for (const z of [-5.0, 5.0]) {
    b.box(6.2, 3.8, z, 0.12, 5.0, 0.12, PALETTE.metal);
    b.box(6.7, 5.8, z, 1.0, 0.7, 0.08, PALETTE.hull, 1.0);
  }
  // Sandbags and bollards.
  sandbagWall(b, 0, 7.3, 9.0, true);
  sandbagWall(b, 7.2, 2.5, 6.0, false);
  for (const x of [-6.2, 6.2]) {
    b.box(x, 0.9, 6.2, 0.5, 0.8, 0.5, PALETTE.warning);
  }
  // Roof lights.
  b.box(-3.0, 3.35, 3.0, 0.5, 0.15, 0.5, PALETTE.amber);
  b.box(2.0, 3.35, -2.6, 0.5, 0.15, 0.5, PALETTE.amber);
  return b.build();
}

function buildBarracks(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 11.8, 0.6, 11.8, PALETTE.concreteDark);
  b.box(0, 0.7, 0, 11.0, 0.4, 11.0, PALETTE.concrete);
  b.box(-0.4, 2.1, -1.0, 9.2, 2.6, 7.0, PALETTE.canvas);
  b.box(-0.4, 2.85, -1.0, 9.8, 0.5, 7.6, PALETTE.oliveDark);
  b.box(-0.4, 3.4, -1.0, 8.8, 0.6, 6.6, PALETTE.olive);
  b.box(3.2, 1.7, -1.0, 1.0, 1.8, 1.8, PALETTE.hullDark);
  b.box(3.8, 2.2, -1.0, 0.4, 1.6, 1.2, PALETTE.glassDark);
  b.box(3.9, 2.4, -1.0, 0.35, 0.4, 0.8, PALETTE.glass);
  for (const z of [-3.6, -1.0, 1.6]) {
    b.box(-1.1, 2.0, z, 1.0, 0.55, 0.55, PALETTE.glassDark);
  }
  b.box(0, 1.9, 2.6, 1.6, 0.15, 0.6, PALETTE.hull, 0.9);
  // Entrance canopy.
  b.box(2.6, 2.7, 2.5, 3.2, 0.2, 2.2, PALETTE.oliveDark);
  b.box(4.0, 1.4, 2.5, 0.2, 2.4, 0.2, PALETTE.metal);
  b.box(1.2, 1.4, 2.5, 0.2, 2.4, 0.2, PALETTE.metal);
  // Flag and crates.
  b.box(-5.0, 2.8, 4.5, 0.1, 4.2, 0.1, PALETTE.metal);
  b.box(-4.5, 4.7, 4.5, 1.0, 0.65, 0.08, PALETTE.hull, 1.0);
  b.box(-3.2, 1.0, 3.4, 1.2, 0.8, 1.2, PALETTE.oliveDark);
  b.box(-3.2, 1.8, 3.4, 0.9, 0.4, 0.9, PALETTE.olive);
  sandbagWall(b, 3.8, 5.0, 4.0, true);
  return b.build();
}

function buildFactory(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 15.8, 0.6, 11.8, PALETTE.concreteDark);
  b.box(0, 0.75, 0, 15.2, 0.4, 11.2, PALETTE.concrete);
  b.box(-0.5, 3.2, 0, 12.4, 4.8, 9.0, PALETTE.hull);
  b.box(-0.5, 5.7, 0, 13.2, 0.5, 9.8, PALETTE.oliveDark);
  b.box(-0.5, 3.1, 4.6, 5.0, 4.4, 0.4, PALETTE.hullDark);
  b.box(-0.5, 3.1, 4.8, 4.4, 4.0, 0.2, PALETTE.glassDark);
  b.box(-0.5, 1.5, 4.55, 5.2, 0.4, 0.35, PALETTE.warning);
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
  sandbagWall(b, -6.2, 2.8, 4.2, false);
  b.box(3.8, 1.0, 4.1, 1.2, 0.8, 1.2, PALETTE.oliveDark);
  b.box(5.0, 1.0, 4.0, 1.2, 0.8, 1.2, PALETTE.olive);
  return b.build();
}

function buildRefinery(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 15.8, 0.6, 11.8, PALETTE.concreteDark);
  b.box(0, 0.75, 0, 15.2, 0.4, 11.2, PALETTE.concrete);
  b.cylinder(-3.8, 3.6, -2.6, 2.6, 6.2, 10, PALETTE.metal);
  b.cylinder(-3.8, 6.75, -2.6, 2.7, 0.3, 10, PALETTE.hullDark);
  b.cylinder(0.2, 4.3, -2.6, 2.1, 7.6, 10, PALETTE.hullLight);
  b.cylinder(0.2, 8.15, -2.6, 2.2, 0.3, 10, PALETTE.hullDark);
  b.box(4.0, 2.0, 1.5, 5.6, 3.6, 5.0, PALETTE.hull);
  b.box(4.0, 3.55, 1.5, 6.0, 0.4, 5.4, PALETTE.oliveDark);
  b.box(6.2, 1.2, 3.9, 1.2, 2.2, 0.4, PALETTE.hullDark);
  b.box(4.6, 1.4, 4.05, 1.4, 0.5, 0.2, PALETTE.glass);
  b.cylinderX(4.0, 3.9, -2.6, 0.4, 6.6, 8, PALETTE.metal);
  b.cylinderX(1.0, 2.5, -2.6, 0.3, 4.0, 8, PALETTE.darkMetal);
  b.box(4.0, 5.0, -2.6, 5.2, 1.8, 2.2, PALETTE.oliveDark);
  b.box(4.0, 5.9, -2.6, 4.2, 0.2, 1.8, PALETTE.metal);
  // Conveyor into the hopper.
  b.boxRot(-1.6, 2.2, 4.2, 7.4, 0.4, 1.1, -0.18, PALETTE.darkMetal);
  b.boxRot(-1.6, 2.42, 4.2, 6.6, 0.15, 0.8, -0.18, PALETTE.amber);
  b.box(5.3, 1.1, 4.1, 1.4, 0.65, 1.4, PALETTE.amber);
  b.box(5.3, 1.6, 4.1, 1.0, 0.4, 1.0, [0.95, 0.68, 0.28]);
  b.box(-6.5, 4.2, 4.6, 0.1, 6.0, 0.1, PALETTE.metal);
  b.box(-6.0, 6.4, 4.6, 1.1, 0.7, 0.08, PALETTE.hull, 1.0);
  b.box(0, 3.2, 2.0, 5.0, 0.25, 0.25, PALETTE.hull, 0.9);
  b.box(-3.8, 2.0, 4.2, 0.4, 3.0, 0.4, PALETTE.warning);
  return b.build();
}

function buildAirfield(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.12, 0, 23.6, 0.28, 19.6, [0.19, 0.2, 0.2]);
  b.box(0, 0.28, 0, 20.0, 0.12, 3.2, [0.12, 0.13, 0.13]);
  for (let i = 0; i < 7; i++) {
    b.box(-8.4 + i * 2.8, 0.36, 0, 1.4, 0.05, 0.2, PALETTE.white);
  }
  b.box(-8.4, 0.36, -3.3, 1.0, 0.05, 0.5, PALETTE.warning);
  b.box(8.4, 0.36, 3.3, 1.0, 0.05, 0.5, PALETTE.warning);
  // Hangar.
  b.box(-8.2, 2.6, -6.4, 6.4, 4.4, 5.4, PALETTE.hull);
  b.box(-8.2, 4.8, -6.4, 7.2, 0.5, 6.2, PALETTE.oliveDark);
  b.box(-8.2, 2.3, -3.65, 4.8, 3.8, 0.3, PALETTE.glassDark);
  b.box(-8.2, 1.25, -3.5, 5.2, 0.35, 0.3, PALETTE.warning);
  // Control tower.
  b.box(8.4, 3.2, -7.0, 3.0, 5.4, 3.0, PALETTE.concrete);
  b.box(8.4, 6.0, -7.0, 4.0, 1.2, 4.0, PALETTE.hull);
  b.box(8.4, 6.0, -5.25, 3.4, 0.9, 0.4, PALETTE.glass);
  b.box(8.4, 6.6, -7.0, 4.4, 0.3, 4.4, PALETTE.hullDark);
  b.box(8.4, 7.4, -7.0, 0.15, 2.4, 0.15, PALETTE.metal);
  b.box(8.4, 8.3, -7.0, 1.4, 0.2, 0.5, PALETTE.metal);
  // Fuel and support.
  b.cylinder(3.4, 1.0, -7.4, 1.0, 1.8, 9, PALETTE.metal);
  b.cylinder(5.8, 0.9, -7.6, 0.8, 1.5, 9, PALETTE.hullLight);
  b.box(2.2, 0.65, 6.2, 3.2, 1.0, 1.5, PALETTE.oliveDark);
  b.box(2.2, 1.25, 6.2, 2.6, 0.25, 1.2, PALETTE.olive);
  b.box(0, 0.4, 7.6, 5.2, 0.2, 2.0, PALETTE.concreteDark);
  // Windsock and lights.
  b.box(-10.8, 2.0, 8.4, 0.1, 4.0, 0.1, PALETTE.metal);
  b.box(-10.3, 3.6, 8.4, 1.1, 0.5, 0.1, PALETTE.warning);
  for (let i = 0; i < 4; i++) {
    b.box(-10.0 + i * 6.6, 0.4, 9.4, 0.22, 0.22, 0.22, PALETTE.amber);
  }
  b.box(0, 0.4, 8.8, 14.0, 0.08, 0.3, PALETTE.hull, 0.9);
  return b.build();
}

function buildShipyard(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 19.6, 0.6, 15.6, PALETTE.concreteDark);
  b.box(-1.0, 0.75, 0, 15.0, 0.4, 14.6, PALETTE.concrete);
  b.box(-4.6, 1.2, 0, 10.0, 0.5, 5.0, PALETTE.concrete);
  // Dry dock hull.
  b.box(-3.0, 1.8, 0, 8.4, 1.4, 4.2, [0.3, 0.34, 0.36]);
  b.box(-0.2, 2.6, 0, 3.2, 1.8, 3.2, [0.38, 0.42, 0.43], 0.2);
  b.box(-3.0, 2.5, 0, 5.8, 0.3, 3.6, PALETTE.oliveDark);
  b.box(2.8, 2.4, 0, 0.3, 0.6, 3.6, PALETTE.darkMetal);
  // Gantry.
  for (const x of [-9.0, -5.0]) {
    b.box(x, 4.6, -7.2, 0.4, 8.2, 0.4, PALETTE.metal);
    b.box(x, 4.6, 7.2, 0.4, 8.2, 0.4, PALETTE.metal);
  }
  b.box(-7.0, 8.4, 0, 5.4, 0.5, 15.0, PALETTE.metal);
  b.box(-7.0, 7.8, 0, 3.2, 0.4, 0.8, PALETTE.warning);
  b.box(-7.0, 7.2, 0, 0.18, 1.2, 0.18, PALETTE.warning);
  b.box(-7.0, 6.8, 0, 1.4, 0.2, 0.2, PALETTE.darkMetal);
  // Control shed.
  b.box(6.0, 2.2, -5.0, 5.4, 3.2, 4.4, PALETTE.hull);
  b.box(6.0, 4.0, -5.0, 6.0, 0.4, 5.0, PALETTE.oliveDark);
  b.box(6.0, 2.8, -2.8, 3.4, 0.8, 0.3, PALETTE.glass);
  b.box(6.0, 5.0, -5.0, 0.15, 2.4, 0.15, PALETTE.metal);
  b.box(6.5, 5.9, -5.0, 1.2, 0.6, 0.1, PALETTE.hull, 1.0);
  // Cranes, bollards, materials.
  b.box(8.0, 1.3, 2.6, 1.4, 1.6, 1.4, PALETTE.oliveDark);
  b.box(8.0, 2.2, 2.6, 1.0, 0.5, 1.0, PALETTE.amber);
  for (let i = 0; i < 4; i++) {
    b.box(-1.0 + i * 3.2, 0.9, 7.0, 0.4, 0.8, 0.4, PALETTE.metal);
  }
  b.box(0, 0.9, 7.8, 12.0, 0.18, 0.35, PALETTE.hull, 0.9);
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
  // Sunken gun pit and tripod.
  b.box(0.1, 0.95, 0, 3.6, 0.35, 3.2, PALETTE.oliveDark);
  for (const z of [-0.5, 0.5]) {
    b.box(0.2, 1.15, z, 0.16, 0.7, 0.16, PALETTE.metal);
  }
  b.box(0.2, 0.85, 0, 0.9, 0.2, 0.2, PALETTE.metal);
  // Ammunition crates and a ready box.
  b.box(-1.9, 1.15, 2.1, 1.1, 0.7, 0.9, PALETTE.oliveDark);
  b.box(-1.9, 1.55, 2.1, 1.2, 0.12, 1.0, PALETTE.olive);
  b.box(-2.0, 1.65, -2.0, 0.9, 0.8, 0.7, PALETTE.oliveDark);
  b.box(-2.0, 1.82, -2.0, 0.45, 0.18, 0.08, PALETTE.amber);
  b.box(1.6, 1.1, -2.5, 0.5, 0.5, 0.5, PALETTE.warning);
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
  b.box(0, 0.3, 0, 7.6, 0.6, 7.6, PALETTE.concreteDark);
  b.box(0, 0.75, 0, 7.0, 0.4, 7.0, PALETTE.concrete);
  // Revetment: low concrete kerbs with sandbags on three sides.
  b.box(0, 0.95, 0, 5.2, 0.4, 4.6, PALETTE.oliveDark);
  sandbagWall(b, 0, -3.0, 6.4, true);
  sandbagWall(b, -3.0, 0, 5.2, false);
  sandbagWall(b, 2.9, 2.0, 2.2, false);
  sandbagWall(b, 2.9, -2.0, 2.2, false);
  // Gun carriage and trails.
  b.box(-0.9, 1.3, 0, 2.2, 0.4, 0.7, PALETTE.hullDark);
  b.box(-1.9, 1.05, -0.9, 2.6, 0.22, 0.3, PALETTE.metal);
  b.box(-1.9, 1.05, 0.9, 2.6, 0.22, 0.3, PALETTE.metal);
  b.box(-3.1, 0.9, -1.6, 0.8, 0.5, 0.5, PALETTE.darkMetal);
  b.box(-3.1, 0.9, 1.6, 0.8, 0.5, 0.5, PALETTE.darkMetal);
  // Ready ammunition and a range board.
  b.box(-2.1, 1.2, 2.4, 1.2, 0.55, 0.8, PALETTE.oliveDark);
  b.box(-2.1, 1.55, 2.4, 1.3, 0.12, 0.9, PALETTE.olive);
  b.box(1.7, 2.0, -2.6, 0.12, 1.8, 0.12, PALETTE.metal);
  b.box(1.9, 2.55, -2.6, 0.6, 0.45, 0.08, PALETTE.warning);
  b.box(2.3, 1.0, 2.6, 0.55, 0.55, 0.55, PALETTE.warning);
  return b.build();
}

/** Shield, breech and barrel, authored around the trunnion at local origin. */
function buildAtTurretGun(): MeshBuffers {
  const b = new MeshBuilder();
  b.boxRot(0.2, 0.45, 0, 0.25, 1.5, 2.1, -0.18, PALETTE.oliveDark);
  b.boxRot(0.32, 0.55, 0.55, 0.12, 0.5, 0.6, -0.18, PALETTE.olive);
  b.box(-0.25, 0.4, 0, 1.0, 0.5, 0.55, PALETTE.hull);
  b.cylinderX(1.9, 0.48, 0, 0.13, 3.4, 8, PALETTE.metal);
  b.cylinderX(3.45, 0.48, 0, 0.2, 0.6, 8, PALETTE.darkMetal);
  b.box(3.75, 0.48, 0, 0.25, 0.22, 0.22, PALETTE.warning);
  return b.build();
}

function buildRelay(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 7.6, 0.6, 7.6, PALETTE.concreteDark);
  b.box(0, 0.75, 0, 6.8, 0.4, 6.8, PALETTE.concrete);
  b.box(0, 4.0, 0, 0.5, 7.0, 0.5, PALETTE.metal);
  for (let i = 0; i < 3; i++) {
    const y = 1.4 + i * 1.9;
    b.box(0, y, 0, 2.2 - i * 0.5, 0.12, 2.2 - i * 0.5, PALETTE.metal);
  }
  b.box(-1.0, 5.6, 0, 0.12, 2.2, 0.12, PALETTE.metal);
  b.box(0.9, 6.6, 0, 0.12, 1.2, 0.12, PALETTE.metal);
  b.box(0, 7.3, 0, 0.25, 0.25, 0.25, PALETTE.red);
  b.box(-1.6, 4.9, 0, 1.2, 0.15, 1.6, PALETTE.hullLight);
  b.cylinderX(1.4, 5.2, 0, 0.5, 0.2, 8, PALETTE.hullLight);
  b.box(1.4, 5.2, 0, 0.1, 0.1, 0.1, PALETTE.hullDark);
  b.box(0, 2.6, 2.2, 2.6, 1.4, 1.4, PALETTE.oliveDark);
  b.box(0, 3.3, 2.2, 2.9, 0.2, 1.7, PALETTE.olive);
  b.box(0.6, 2.8, 2.95, 1.0, 0.4, 0.1, PALETTE.amber);
  sandbagWall(b, 0, 3.3, 4.0, true);
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
  // Flag and perimeter sandbags.
  b.box(4.8, 3.0, 3.9, 0.1, 4.4, 0.1, PALETTE.metal);
  b.box(4.3, 4.9, 3.9, 1.0, 0.62, 0.08, PALETTE.amber, 1.0);
  sandbagWall(b, 0, 5.6, 7.0, true);
  sandbagWall(b, 5.4, 0, 6.0, false);
  return b.build();
}

function buildRadarStation(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 11.8, 0.6, 11.8, PALETTE.concreteDark);
  b.box(0, 0.72, 0, 11.0, 0.4, 11.0, PALETTE.concrete);
  // Bunker base, taller mast and a broad dish.
  b.box(-0.9, 1.9, -0.8, 6.2, 2.4, 6.0, PALETTE.hull);
  b.box(-0.9, 3.2, -0.8, 6.8, 0.35, 6.6, PALETTE.hullLight);
  b.box(3.0, 1.4, 2.4, 2.6, 1.6, 2.6, PALETTE.oliveDark);
  b.cylinder(3.0, 2.5, 2.4, 0.7, 1.5, 8, PALETTE.metal);
  b.box(0, 4.8, 0, 2.6, 0.24, 2.6, PALETTE.hullDark);
  b.box(0, 4.2, 0, 0.34, 4.0, 0.34, PALETTE.metal);
  b.boxRot(-0.2, 6.1, 0, 4.4, 1.8, 0.24, 0.62, PALETTE.hullLight);
  b.box(0, 6.05, 0, 0.2, 1.2, 0.2, PALETTE.darkMetal);
  b.box(0, 6.9, 0, 0.4, 0.24, 0.4, PALETTE.warning);
  // Fortified perimeter and a satellite uplink.
  sandbagWall(b, 0, 5.6, 8.0, true);
  sandbagWall(b, 5.5, 0, 8.0, false);
  b.box(-4.6, 2.6, 4.2, 0.14, 3.8, 0.14, PALETTE.metal);
  b.cylinder(-4.6, 4.4, 4.2, 0.9, 0.25, 8, PALETTE.hullLight);
  b.box(-4.6, 4.85, 4.2, 0.12, 0.7, 0.12, PALETTE.metal);
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

/** Sandbags, wire, flag and trim for an occupied tenement. */
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

/** Sandbags, wire, flag and trim for an occupied ruin. */
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

function buildPowerPlant(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 11.8, 0.6, 11.8, PALETTE.concreteDark);
  b.box(0, 0.7, 0, 11.0, 0.4, 11.0, PALETTE.concrete);
  // Turbine hall with a ridged roof.
  b.box(-1.4, 2.2, -1.0, 7.4, 2.8, 7.0, PALETTE.canvas);
  b.box(-1.4, 3.75, -1.0, 8.0, 0.35, 7.6, PALETTE.oliveDark);
  for (let i = 0; i < 4; i++) {
    b.box(-4.2 + i * 1.9, 3.98, -1.0, 0.5, 0.12, 7.4, PALETTE.metal);
  }
  b.box(-1.4, 1.5, 2.55, 3.0, 2.2, 0.3, PALETTE.hullDark);
  b.box(-1.4, 1.7, 2.7, 2.6, 1.8, 0.15, PALETTE.glassDark);
  // Twin exhaust stacks.
  for (const z of [-3.4, 0.4]) {
    b.cylinder(3.6, 3.1, z, 0.75, 5.2, 10, PALETTE.hullLight);
    b.cylinder(3.6, 5.75, z, 0.85, 0.35, 10, PALETTE.metal);
    b.box(3.6, 5.98, z, 0.6, 0.2, 0.6, PALETTE.warning);
  }
  // Transformer yard.
  b.box(3.2, 0.95, 4.1, 4.0, 0.35, 2.6, PALETTE.concreteDark);
  for (const x of [2.0, 4.4]) {
    b.box(x, 1.9, 4.1, 1.1, 1.6, 1.0, PALETTE.darkMetal);
    b.box(x, 2.75, 4.1, 1.3, 0.2, 1.2, PALETTE.metal);
    b.box(x, 2.95, 3.7, 0.22, 0.5, 0.22, PALETTE.warning);
  }
  b.box(0.2, 1.6, 4.4, 0.18, 2.6, 0.18, PALETTE.metal);
  b.box(3.2, 2.7, 3.4, 3.6, 0.12, 0.12, PALETTE.metal);
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
  b.boxRot(0.2, 5.35, 0, 3.4, 1.5, 0.2, 0.55, PALETTE.hullLight);
  b.box(0, 5.35, 0, 0.18, 1.1, 0.18, PALETTE.darkMetal);
  // Perimeter mast and warning lamp.
  b.box(2.4, 2.9, 2.0, 0.14, 3.2, 0.14, PALETTE.metal);
  b.box(2.8, 4.35, 2.0, 0.9, 0.16, 0.16, PALETTE.warning);
  b.box(-2.4, 1.0, 2.3, 1.1, 0.7, 1.1, PALETTE.oliveDark);
  b.box(-2.4, 1.4, 2.3, 0.8, 0.2, 0.8, PALETTE.olive);
  return b.build();
}

export interface BuildingStyle {
  body: MeshBuffers;
  /**
   * Optional occupied variant for garrisonable shelters: the same building with
   * sandbags, wire, a flag and team-tinted trim. Rendered only while infantry
   * are inside, so an empty shelter reads as empty at a glance.
   */
  garrisoned?: MeshBuffers;
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
  const indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices, 0);
  for (let i = 0; i < b.indices.length; i++) indices[a.indices.length + i] = b.indices[i] + vertexCount;
  return { positions, normals, colors, teamMask, indices };
}

const STYLES: Record<string, BuildingStyle> = {
  commandPost: { body: buildCommandPost() },
  barracks: { body: buildBarracks() },
  factory: { body: buildFactory() },
  refinery: { body: buildRefinery() },
  airfield: { body: buildAirfield() },
  shipyard: { body: buildShipyard() },
  samBattery: { body: buildSam() },
  mgNest: {
    body: buildMgNestBody(),
    turret: buildMgNestTurret(),
    turretOffset: [0, 1.55, 0],
  },
  atTurret: {
    body: buildAtTurretBody(),
    turret: buildAtTurretGun(),
    turretOffset: [0, 1.3, 0],
  },
  powerPlant: { body: buildPowerPlant() },
  radar: { body: buildRadar() },
  relay: { body: buildRelay() },
  supplyDepot: { body: buildSupplyDepot() },
  radarStation: { body: buildRadarStation() },
  tenement: {
    body: buildTenement(),
    garrisoned: mergeMeshes(buildTenement(), tenementDressing()),
  },
  ruin: {
    body: buildRuin(),
    garrisoned: mergeMeshes(buildRuin(), ruinDressing()),
  },
};

export function buildingStyle(id: string): BuildingStyle | undefined {
  return STYLES[id];
}

const COMBINED = new Map<string, MeshBuffers>();
export function buildingMesh(id: string): MeshBuffers | undefined {
  const style = STYLES[id];
  if (!style) return undefined;
  if (!style.turret) return style.body;
  let mesh = COMBINED.get(id);
  if (!mesh) {
    mesh = mergeMeshes(style.body, style.turret, style.turretOffset ?? [0, 0, 0]);
    COMBINED.set(id, mesh);
  }
  return mesh;
}

export const FALLBACK_BUILDING: MeshBuffers = (() => {
  const b = new MeshBuilder();
  b.box(0, 1.5, 0, 8, 3, 8, PALETTE.concrete);
  b.box(0, 3.2, 0, 6, 0.5, 6, shade(PALETTE.concrete, 1.2));
  return b.build();
})();
