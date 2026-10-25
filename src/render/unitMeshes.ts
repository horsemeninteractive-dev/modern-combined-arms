import { MeshBuilder, PALETTE, type Color } from './geometry';
import type { MeshBuffers } from './gl';
import type { Vec3 } from './math';

export interface EntityStyle {
  body: MeshBuffers;
  turret?: MeshBuffers;
  turretOffset: Vec3;
  /** Optional cargo mesh scaled vertically by a 0..1 fill fraction. */
  load?: MeshBuffers;
  /**
   * Infantry legs, kept separate from the torso so the renderer can swing them
   * about the hip while the soldier walks. The mesh origin is the hip joint and
   * the geometry hangs down to local Y = 0, which puts the boots on the ground.
   */
  infantry?: { leg: MeshBuffers; hip: Vec3; hipOffset: number };
}

function soldier(b: MeshBuilder, x: number, z: number, palette: Color): void {
  b.box(x, 0.62, z, 0.42, 0.28, 0.3, PALETTE.hullDark);
  b.box(x, 1.02, z, 0.48, 0.58, 0.34, palette);
  b.box(x, 1.08, z + 0.19, 0.42, 0.3, 0.08, palette, 0.9);
  b.sphere(x, 1.48, z, 0.22, 3, 5, [0.55, 0.44, 0.33]);
  b.box(x, 1.62, z, 0.36, 0.16, 0.38, PALETTE.oliveDark);
  b.cylinderX(x + 0.5, 1.02, z, 0.055, 0.9, 5, PALETTE.darkMetal);
}

/** One leg, origin at the hip joint, boot sole at local Y = 0. */
function buildLeg(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, -0.16, 0, 0.17, 0.32, 0.19, PALETTE.oliveDark);
  b.box(0.02, -0.36, 0, 0.15, 0.16, 0.17, PALETTE.oliveDark);
  b.box(0.07, -0.44, 0, 0.3, 0.08, 0.2, PALETTE.darkMetal);
  return b.build();
}

// Hip height in the torso mesh, and how far apart the legs sit.
const HIP_Y = 0.48;
const HIP_Z = 0.115;
const LEG_MESH = buildLeg();

function infantryRig(): NonNullable<EntityStyle['infantry']> {
  return { leg: LEG_MESH, hip: [0, HIP_Y, HIP_Z], hipOffset: HIP_Y };
}

function buildRifle(): MeshBuffers {
  const b = new MeshBuilder();
  // One infantryman per unit, matching the reference RTS convention.
  soldier(b, 0, 0, PALETTE.olive);
  return b.build();
}

function buildAtgm(): MeshBuffers {
  const b = new MeshBuilder();
  soldier(b, 0, 0, PALETTE.olive);
  // Shoulder-launched guided missile tube instead of a second crewman.
  b.box(0.55, 1.18, 0.18, 1.15, 0.22, 0.3, PALETTE.hull);
  b.cylinderX(1.15, 1.18, 0.18, 0.13, 1.5, 6, [0.22, 0.26, 0.2]);
  b.box(1.95, 1.18, 0.18, 0.28, 0.18, 0.2, PALETTE.warning);
  b.box(0.35, 1.42, 0.18, 0.28, 0.18, 0.2, PALETTE.darkMetal);
  return b.build();
}

function buildMedic(): MeshBuffers {
  const b = new MeshBuilder();
  soldier(b, 0, 0, PALETTE.olive);
  // White helmet band and a medical satchel with a red cross make the medic
  // read apart from a rifleman at RTS zoom.
  b.box(0, 1.7, 0, 0.37, 0.06, 0.39, PALETTE.white);
  b.box(-0.05, 1.08, -0.27, 0.5, 0.42, 0.16, PALETTE.white);
  b.box(-0.05, 1.08, -0.352, 0.3, 0.08, 0.02, PALETTE.red);
  b.box(-0.05, 1.08, -0.352, 0.08, 0.3, 0.02, PALETTE.red);
  return b.build();
}

function buildEngineer(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(-0.2, 0.42, -1.25, 4.3, 0.8, 0.55, PALETTE.track);
  b.box(-0.2, 0.42, 1.25, 4.3, 0.8, 0.55, PALETTE.track);
  b.box(0, 0.95, 0, 3.8, 0.75, 2.2, PALETTE.hull);
  b.box(-0.4, 1.48, 0, 1.9, 0.4, 1.8, PALETTE.hullLight, 0.55);
  b.box(0.7, 1.55, 0, 0.8, 0.6, 1.4, PALETTE.glassDark);
  b.box(0.75, 1.58, 0, 0.65, 0.38, 1.1, PALETTE.glass);
  b.box(2.15, 0.65, 0, 0.5, 1.2, 2.9, PALETTE.metal);
  b.box(2.4, 0.35, 0, 0.35, 0.35, 2.4, PALETTE.darkMetal);
  b.box(-1.8, 1.55, 0, 0.3, 1.0, 0.3, PALETTE.warning);
  b.box(-1.8, 2.05, 0, 1.7, 0.22, 0.22, PALETTE.warning);
  b.box(-2.5, 1.8, 0, 0.5, 0.4, 0.9, PALETTE.metal);
  b.box(0, 1.35, 0.95, 2.4, 0.18, 0.4, PALETTE.hull, 0.85);
  return b.build();
}

function buildTankBody(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.48, -1.35, 4.7, 0.9, 0.62, PALETTE.track);
  b.box(0, 0.48, 1.35, 4.7, 0.9, 0.62, PALETTE.track);
  for (let i = 0; i < 5; i++) {
    b.cylinderZ(-1.8 + i * 0.9, 0.46, -1.35, 0.34, 0.72, 7, [0.12, 0.13, 0.12]);
    b.cylinderZ(-1.8 + i * 0.9, 0.46, 1.35, 0.34, 0.72, 7, [0.12, 0.13, 0.12]);
  }
  b.box(-0.1, 1.0, 0, 4.0, 0.7, 2.1, PALETTE.hull);
  b.box(1.65, 0.98, 0, 0.8, 0.5, 2.0, PALETTE.hullLight);
  b.box(-1.5, 1.05, 0, 1.0, 0.45, 1.8, PALETTE.hullDark);
  b.box(0, 1.15, 1.02, 3.2, 0.2, 0.18, PALETTE.hull, 0.9);
  b.box(0, 1.15, -1.02, 3.2, 0.2, 0.18, PALETTE.hull, 0.9);
  b.box(-2.05, 1.0, 0, 0.5, 0.6, 1.5, PALETTE.darkMetal);
  b.box(-1.5, 1.55, 0, 0.4, 0.5, 0.4, PALETTE.darkMetal);
  return b.build();
}

function buildTankTurret(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.32, 0, 2.0, 0.62, 1.6, PALETTE.hullLight, 0.25);
  b.box(0.85, 0.32, 0, 0.7, 0.5, 1.0, PALETTE.hull);
  b.cylinderX(1.8, 0.32, 0, 0.12, 2.5, 7, PALETTE.darkMetal);
  b.cylinderX(2.95, 0.32, 0, 0.17, 0.3, 7, PALETTE.hullDark);
  b.box(-0.55, 0.72, 0, 0.7, 0.25, 0.9, PALETTE.hullDark);
  b.box(0, 0.55, 0.82, 1.0, 0.12, 0.12, PALETTE.hull, 0.9);
  return b.build();
}

function buildRecon(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.7, 0, 3.4, 0.6, 2.0, PALETTE.hull);
  b.box(1.55, 0.8, 0, 0.9, 0.6, 1.8, PALETTE.hullLight);
  b.box(1.4, 1.1, 0, 0.55, 0.4, 1.3, PALETTE.glass);
  b.box(-0.3, 1.1, 0, 1.8, 0.35, 1.7, PALETTE.oliveDark, 0.6);
  for (const x of [-1.1, 1.15]) {
    for (const z of [-1.15, 1.15]) {
      b.cylinderZ(x, 0.48, z, 0.46, 0.36, 9, PALETTE.rubber);
      b.cylinderZ(x, 0.48, z > 0 ? 1.32 : -1.32, 0.24, 0.06, 7, PALETTE.metal);
    }
  }
  b.box(-1.9, 1.2, 0, 0.15, 1.2, 0.15, PALETTE.metal);
  b.box(-1.9, 1.8, 0, 0.5, 0.2, 0.5, PALETTE.warning);
  b.box(0, 1.35, 0.84, 2.4, 0.12, 0.12, PALETTE.hull, 0.9);
  return b.build();
}

function buildReconTurret(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.2, 0, 1.0, 0.4, 0.9, PALETTE.hullDark);
  b.cylinderX(0.9, 0.22, 0, 0.06, 1.4, 5, PALETTE.darkMetal);
  b.box(0.2, 0.5, 0, 0.3, 0.25, 0.3, PALETTE.olive);
  return b.build();
}

function buildAA(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.65, 0, 4.2, 0.6, 2.1, PALETTE.hull);
  b.box(1.75, 0.85, 0, 1.0, 0.7, 1.7, PALETTE.hullDark);
  b.box(1.55, 1.15, 0, 0.5, 0.35, 1.2, PALETTE.glass);
  for (const x of [-1.6, -0.2, 1.3]) {
    for (const z of [-1.15, 1.15]) {
      b.cylinderZ(x, 0.45, z, 0.4, 0.35, 8, PALETTE.rubber);
    }
  }
  b.box(-1.2, 1.12, 0, 2.2, 0.42, 1.5, PALETTE.oliveDark, 0.5);
  b.box(-1.9, 1.4, 0, 0.4, 0.9, 1.8, PALETTE.metal);
  b.box(0, 1.3, 0.85, 3.0, 0.14, 0.14, PALETTE.hull, 0.9);
  return b.build();
}

function buildAATurret(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.25, 0, 1.2, 0.5, 1.4, PALETTE.hullDark);
  for (const z of [-0.38, 0.38]) {
    b.cylinderX(1.3, 0.5, z, 0.17, 2.0, 6, [0.24, 0.27, 0.21]);
    b.box(2.2, 0.5, z, 0.3, 0.1, 0.1, PALETTE.warning);
  }
  b.box(-0.4, 0.9, 0, 0.2, 0.9, 0.2, PALETTE.metal);
  b.box(-0.4, 1.35, 0, 0.8, 0.25, 0.9, PALETTE.darkMetal);
  return b.build();
}

function buildHarvester(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(-0.3, 0.55, -1.75, 5.6, 1.0, 0.8, PALETTE.track);
  b.box(-0.3, 0.55, 1.75, 5.6, 1.0, 0.8, PALETTE.track);
  for (let i = 0; i < 5; i++) {
    b.cylinderZ(-2.4 + i * 1.1, 0.55, -1.75, 0.38, 0.85, 7, PALETTE.track);
    b.cylinderZ(-2.4 + i * 1.1, 0.55, 1.75, 0.38, 0.85, 7, PALETTE.track);
  }
  b.box(-0.3, 1.45, 0, 5.2, 1.0, 3.2, PALETTE.hull);
  b.box(2.2, 1.9, 0, 1.4, 1.3, 2.4, PALETTE.hullLight);
  b.box(2.65, 2.15, 0, 0.4, 0.6, 1.8, PALETTE.glass);
  b.box(2.7, 2.15, 0, 0.45, 0.42, 1.3, PALETTE.glass);
  // Hopper walls
  b.box(-1.6, 2.15, -1.5, 3.2, 0.8, 0.25, PALETTE.hullDark);
  b.box(-1.6, 2.15, 1.5, 3.2, 0.8, 0.25, PALETTE.hullDark);
  b.box(-3.1, 2.15, 0, 0.25, 0.8, 2.8, PALETTE.hullDark);
  b.box(-1.6, 1.85, 0, 3.0, 0.5, 2.4, PALETTE.amber);
  b.box(0.4, 1.65, 1.15, 4.2, 0.2, 0.2, PALETTE.hull, 0.9);
  b.box(-2.4, 2.7, 0, 0.3, 0.8, 0.3, PALETTE.darkMetal);
  b.cylinder(-2.4, 3.1, 0.35, 0.14, 1.0, 6, PALETTE.darkMetal);
  return b.build();
}

function buildHarvesterLoad(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(-1.6, 0.5, 0, 2.9, 1.0, 2.25, PALETTE.amber);
  b.box(-1.6, 1.02, 0, 2.3, 0.18, 1.75, [0.94, 0.68, 0.26]);
  return b.build();
}

function buildFighter(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0, 0, 6.4, 0.7, 1.25, [0.45, 0.48, 0.47]);
  b.box(3.45, 0, 0, 1.0, 0.5, 0.9, [0.5, 0.52, 0.5]);
  b.box(4.0, 0, 0, 0.7, 0.25, 0.45, [0.38, 0.4, 0.39]);
  b.box(0.6, 0.48, 0, 1.6, 0.35, 0.95, [0.2, 0.36, 0.4]);
  b.box(-1.0, 0.42, 0, 0.8, 0.2, 0.7, [0.28, 0.32, 0.32]);
  // Wings (swept through rotation).
  b.boxRot(-0.4, -0.03, -1.8, 3.2, 0.16, 2.9, 0.42, [0.4, 0.43, 0.42]);
  b.boxRot(-0.4, -0.03, 1.8, 3.2, 0.16, 2.9, -0.42, [0.4, 0.43, 0.42]);
  b.boxRot(-0.2, 0.02, -1.75, 1.9, 0.2, 0.35, 0.42, [0.3, 0.34, 0.34], 0.9);
  b.boxRot(-0.2, 0.02, 1.75, 1.9, 0.2, 0.35, -0.42, [0.3, 0.34, 0.34], 0.9);
  // Tails.
  b.box(-2.7, 0.85, -0.75, 1.1, 1.4, 0.12, [0.42, 0.45, 0.44]);
  b.box(-2.7, 0.85, 0.75, 1.1, 1.4, 0.12, [0.42, 0.45, 0.44]);
  b.box(-2.9, 0.15, 0, 0.8, 0.25, 1.9, [0.4, 0.43, 0.42]);
  // Engines.
  b.cylinderX(-3.3, 0, -0.5, 0.28, 0.7, 7, PALETTE.darkMetal);
  b.cylinderX(-3.3, 0, 0.5, 0.28, 0.7, 7, PALETTE.darkMetal);
  // Missiles.
  for (const z of [-1.9, -1.35, 1.35, 1.9]) {
    b.cylinderX(-0.3, -0.28, z, 0.09, 1.9, 5, PALETTE.white);
    b.box(0.65, -0.28, z, 0.15, 0.18, 0.18, PALETTE.warning);
  }
  b.box(0.2, 0.3, 0, 3.2, 0.1, 0.16, PALETTE.hull, 0.9);
  return b.build();
}

function buildCorvetteBody(): MeshBuffers {
  const b = new MeshBuilder();
  // Hull.
  b.box(-0.5, 0.6, 0, 12.5, 1.3, 4.2, [0.36, 0.4, 0.42]);
  b.box(6.4, 0.65, 0, 2.0, 1.1, 3.2, [0.33, 0.37, 0.39]);
  b.addTriangle([7.6, 0.2, -1.4], [7.6, 0.2, 1.4], [8.6, 0.7, 0], [0.3, 0.34, 0.36]);
  b.addTriangle([7.6, 1.1, -1.4], [8.6, 0.7, 0], [7.6, 1.1, 1.4], [0.4, 0.44, 0.45]);
  b.addQuad([7.6, 0.2, -1.4], [7.6, 1.1, -1.4], [7.6, 1.1, 1.4], [7.6, 0.2, 1.4], [0.3, 0.34, 0.36]);
  // Waterline stripe.
  b.box(-0.5, 0.12, -2.15, 12.6, 0.12, 0.1, [0.2, 0.22, 0.23]);
  b.box(-0.5, 0.12, 2.15, 12.6, 0.12, 0.1, [0.2, 0.22, 0.23]);
  b.box(-2.0, 1.05, -2.02, 6.0, 0.18, 0.14, PALETTE.hull, 0.9);
  b.box(-2.0, 1.05, 2.02, 6.0, 0.18, 0.14, PALETTE.hull, 0.9);
  // Deck.
  b.box(-0.5, 1.3, 0, 11.8, 0.15, 3.8, [0.3, 0.33, 0.34]);
  // Superstructure.
  b.box(-1.6, 2.2, 0, 4.4, 1.8, 2.8, [0.42, 0.46, 0.47], 0.15);
  b.box(-0.2, 3.1, 0, 2.0, 0.6, 2.4, [0.47, 0.5, 0.51]);
  b.box(-0.2, 2.6, 0, 2.3, 0.45, 2.55, PALETTE.glass);
  b.box(-0.2, 2.6, 0, 2.6, 0.25, 0.75, PALETTE.glassDark);
  // Mast/radar.
  b.box(-2.3, 3.6, 0, 0.15, 2.0, 0.15, PALETTE.metal);
  b.box(-2.3, 4.5, 0, 1.6, 0.12, 0.7, PALETTE.metal);
  b.box(-2.7, 4.7, 0, 0.9, 0.25, 0.2, PALETTE.darkMetal);
  // Missile canisters.
  b.box(-2.4, 1.85, -1.1, 2.2, 0.5, 0.55, PALETTE.oliveDark);
  b.box(-2.4, 1.85, 1.1, 2.2, 0.5, 0.55, PALETTE.oliveDark);
  b.box(-1.25, 1.95, -1.1, 0.2, 0.6, 0.65, PALETTE.warning);
  b.box(-1.25, 1.95, 1.1, 0.2, 0.6, 0.65, PALETTE.warning);
  // Stern.
  b.box(-6.9, 1.0, 0, 0.6, 0.8, 3.4, [0.28, 0.31, 0.32]);
  // Life rafts / detail.
  b.box(2.0, 1.45, 1.4, 1.2, 0.3, 0.4, PALETTE.oliveDark);
  b.box(2.0, 1.45, -1.4, 1.2, 0.3, 0.4, PALETTE.oliveDark);
  return b.build();
}

function buildCorvetteTurret(): MeshBuffers {
  const b = new MeshBuilder();
  b.box(0, 0.3, 0, 1.6, 0.5, 1.2, [0.4, 0.44, 0.45], 0.25);
  b.cylinderX(1.5, 0.35, 0, 0.09, 2.1, 7, PALETTE.darkMetal);
  b.box(0.3, 0.6, 0, 0.5, 0.25, 0.6, PALETTE.darkMetal);
  return b.build();
}

/**
 * Visual-only scale per unit, tuned against the 4-unit tile grid: infantry
 * read taller than the old squad models, while vehicles and ships come down
 * to the reference RTS convention of roughly one tile of hull length.
 * Collision radii stay untouched.
 */
const VISUAL_SCALE: Record<string, number> = {
  rifle: 2.4,
  atgm: 2.4,
  medic: 2.35,
  engineer: 0.75,
  tank: 0.72,
  recon: 0.78,
  aa: 0.78,
  harvester: 0.7,
  fighter: 0.85,
  corvette: 0.42,
};

export function unitVisualScale(id: string): number {
  return VISUAL_SCALE[id] ?? 1;
}

/**
 * Ground footprint used for the soft contact shadow, in world units. These
 * follow the scaled meshes rather than the collision radius, so a lone
 * infantryman gets a small shadow and a tank keeps its hull-shaped pool.
 */
const SHADOW_RADIUS: Record<string, [number, number]> = {
  rifle: [0.55, 0.45],
  atgm: [0.65, 0.5],
  medic: [0.55, 0.45],
  engineer: [2.0, 1.15],
  tank: [1.9, 0.95],
  recon: [2.0, 0.95],
  aa: [1.9, 1.0],
  harvester: [3.0, 1.1],
  fighter: [2.6, 2.6],
  corvette: [3.7, 0.95],
};

export function unitShadowRadius(id: string): [number, number] {
  return SHADOW_RADIUS[id] ?? [1.4, 1.4];
}

const STYLES: Record<string, EntityStyle> = {
  rifle: { body: buildRifle(), turretOffset: [0, 0, 0], infantry: infantryRig() },
  atgm: { body: buildAtgm(), turretOffset: [0, 0, 0], infantry: infantryRig() },
  medic: { body: buildMedic(), turretOffset: [0, 0, 0], infantry: infantryRig() },
  engineer: { body: buildEngineer(), turretOffset: [0, 0, 0] },
  tank: {
    body: buildTankBody(),
    turret: buildTankTurret(),
    turretOffset: [0, 1.32, 0],
  },
  recon: {
    body: buildRecon(),
    turret: buildReconTurret(),
    turretOffset: [0, 1.3, 0],
  },
  aa: {
    body: buildAA(),
    turret: buildAATurret(),
    turretOffset: [0, 1.28, 0],
  },
  harvester: { body: buildHarvester(), turretOffset: [0, 0, 0], load: buildHarvesterLoad() },
  fighter: { body: buildFighter(), turretOffset: [0, 0, 0] },
  corvette: {
    body: buildCorvetteBody(),
    turret: buildCorvetteTurret(),
    turretOffset: [4.7, 1.5, 0],
  },
};

export function unitStyle(id: string): EntityStyle | undefined {
  return STYLES[id];
}

/** Placeholder style for unknown unit ids. */
export const FALLBACK_STYLE: EntityStyle = {
  body: (() => {
    const b = new MeshBuilder();
    b.box(0, 0.7, 0, 2.5, 1.4, 1.8, PALETTE.hull, 0.5);
    return b.build();
  })(),
  turretOffset: [0, 0, 0],
};
