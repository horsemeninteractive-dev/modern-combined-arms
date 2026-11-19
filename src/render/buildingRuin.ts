import { BUILDINGS } from '../data/buildings';
import { MeshBuilder, PALETTE, type Color } from './geometry';
import type { MeshBuffers } from './gl';

/**
 * Family-specific damage shells.
 *
 * The intact bodies are built once and never cut up at runtime. Instead a
 * structure that has lost most of its integrity is drawn as a ruin shell with
 * the same footprint: roofless civic halls, gutted fire stations, collapsed
 * warehouse bays and broken tenements. The shell is presentation only; the data
 * footprint, collision, cover and picking are unchanged.
 *
 * Stage 2 is the first collapse: a canopy, bay or tower has come down and the
 * upper floors are open. Stage 3 is the burnt-out shell that remains until the
 * structure is cleared, and the same mesh is used for the persistent wreck.
 */

export type BuildingDamageFamily = 'residential' | 'civic' | 'industrial' | 'military';
export type BuildingShellStage = 2 | 3;

const RESIDENTIAL = new Set([
  'tenement',
  'apartmentBlock',
  'motelBlock',
  'townhouseTerrace',
  'farmhouse',
  'schoolhouse',
]);

const CIVIC = new Set([
  'civicHall',
  'constabulary',
  'chapel',
  'clinic',
  'fireStation',
  'marketHall',
  'cinema',
  'bankHouse',
  'stationHouse',
]);

const INDUSTRIAL = new Set([
  'factory',
  'refinery',
  'warehouse',
  'freightShed',
  'foundryWorks',
  'armourWorks',
  'coldStore',
  'autoGarage',
  'powerPlant',
]);

const NO_SHELL = new Set(['ruin', 'bridge', 'sandbagWall', 'concreteWall']);

/**
 * How long a destroyed structure's shell stands before the ground takes it.
 *
 * Long enough to be read as the building that was there — a landmark lost is
 * worth a beat of the player's attention — and short enough that a long match
 * does not end as a field of every structure anyone ever lost.
 */
export const WRECK_LINGER_SECONDS = 7;
/** Seconds the shell spends settling into the ground once the linger ends. */
export const WRECK_SINK_SECONDS = 3;

export interface WreckSettle {
  /** Metres the shell has sunk below its footprint; 0 while it still stands. */
  sink: number;
  /** Draw alpha: 1 while it stands, 0 once it is fully under the ground. */
  alpha: number;
  /** True once the shell is finished and can be dropped from the draw list. */
  gone: boolean;
}

/**
 * The settle curve for one wreck shell, in battle seconds.
 *
 * Pure and deterministic so the timing is a unit-testable rule rather than a
 * number buried in the draw loop. The sink accelerates — the ground gives under
 * the weight and then takes it — and the fade follows the sink, so the shell
 * never turns transparent while it still looks like it is standing on the
 * surface it was built on.
 */
export function wreckSettle(ageSeconds: number, topHeight: number): WreckSettle {
  const gone = ageSeconds >= WRECK_LINGER_SECONDS + WRECK_SINK_SECONDS;
  const settle = Math.min(1, Math.max(0, ageSeconds - WRECK_LINGER_SECONDS) / WRECK_SINK_SECONDS);
  const sink = settle * settle * (Math.max(0, topHeight) + 0.9);
  const alpha = 1 - settle * settle * (3 - 2 * settle);
  return { sink, alpha, gone };
}

export function buildingDamageFamily(defId: string): BuildingDamageFamily | null {
  if (NO_SHELL.has(defId)) return null;
  if (RESIDENTIAL.has(defId)) return 'residential';
  if (CIVIC.has(defId)) return 'civic';
  if (INDUSTRIAL.has(defId)) return 'industrial';
  return BUILDINGS[defId] ? 'military' : null;
}

export interface ShellExtents {
  halfX: number;
  halfZ: number;
  top: number;
}

const SOOT: Color = [0.16, 0.145, 0.125];
const ASH: Color = [0.23, 0.215, 0.19];
const BURNT_BRICK: Color = [0.3, 0.19, 0.145];
const BURNT_CONCRETE: Color = [0.33, 0.315, 0.285];
const BURNT_STEEL: Color = [0.22, 0.21, 0.195];
const EMBER: Color = [0.36, 0.16, 0.075];
// Interior slabs sit inside a wall ring and receive no direct sun. At burnt
// wall values they collapse to a featureless black pit, so the floor reads
// lighter, as exposed aggregate and ash rather than a void.
const INTERIOR_ASH: Color = [0.5, 0.455, 0.385];

function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let s = seed || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function rubble(b: MeshBuilder, rand: () => number, halfX: number, halfZ: number, count: number): void {
  // One large fallen floor plate anchors the pile. Hand-sized chunks alone read
  // as scattered gravel from the tactical camera, not as a collapsed building.
  b.boxRot(
    (rand() * 2 - 1) * halfX * 0.35,
    0.24,
    (rand() * 2 - 1) * halfZ * 0.35,
    halfX * (0.24 + rand() * 0.16),
    0.18,
    halfZ * (0.2 + rand() * 0.15),
    rand() * Math.PI,
    BURNT_CONCRETE,
  );
  for (let i = 0; i < count; i++) {
    const x = (rand() * 2 - 1) * (halfX + 0.65);
    const z = (rand() * 2 - 1) * (halfZ + 0.65);
    const s = 0.22 + rand() * 0.48;
    const tall = s * (0.28 + rand() * 0.35);
    // Rest the whole chunk on the ground. Centring it at a fixed height let a
    // tall piece push its bottom face below y=0 and hang through the terrain.
    b.boxRot(
      x,
      0.02 + tall / 2,
      z,
      s,
      tall,
      s * (0.7 + rand() * 0.5),
      rand() * Math.PI,
      rand() > 0.35 ? INTERIOR_ASH : SOOT,
    );
  }
}

function brokenWall(
  b: MeshBuilder,
  x: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  color: Color,
  axis: 'x' | 'z' = 'x',
): void {
  const sx = axis === 'x' ? width : depth;
  const sz = axis === 'x' ? depth : width;
  b.box(x, height / 2, z, sx, height, sz, color);
  // Broken top edge: three uneven stubs read as masonry torn down rather than
  // a clean parapet. A side wall's length runs along Z, so the stubs must too.
  const n = Math.max(3, Math.round(width / 1.3));
  for (let i = 0; i < n; i++) {
    const off = -width / 2 + (i + 0.5) * (width / n);
    const h = 0.18 + ((i * 37) % 11) / 22;
    b.box(
      x + (axis === 'x' ? off : 0),
      height + h / 2,
      z + (axis === 'z' ? off : 0),
      axis === 'x' ? width / n + 0.06 : depth,
      h,
      axis === 'x' ? depth : width / n + 0.06,
      color,
    );
  }
}

function exposedSlab(
  b: MeshBuilder,
  x: number,
  z: number,
  width: number,
  depth: number,
  y: number,
  yaw = 0,
): void {
  b.boxRot(x, y, z, width, 0.18, depth, yaw, INTERIOR_ASH);
  for (let i = 0; i < 4; i++) {
    b.boxRot(
      x - width / 2 + 0.3 + i * (width / 4),
      y + 0.12,
      z + (i % 2 ? 0.22 : -0.18),
      0.06,
      0.34,
      0.06,
      yaw,
      PALETTE.metal,
    );
  }
}

function windowVoid(
  b: MeshBuilder,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  facing: 'x' | 'z',
): void {
  const w = facing === 'z' ? width : 0.12;
  const d = facing === 'z' ? 0.12 : width;
  b.box(x, y, z, w, height, d, [0.045, 0.043, 0.04]);
  // A surviving lintel and one bent frame leg stop the opening reading as a
  // painted rectangle.
  b.box(x, y + height / 2 + 0.1, z, facing === 'z' ? width + 0.28 : 0.18, 0.16, facing === 'z' ? 0.18 : width + 0.28, BURNT_CONCRETE);
  b.box(
    x + (facing === 'z' ? -width * 0.38 : 0),
    y,
    z + (facing === 'z' ? 0 : -width * 0.38),
    facing === 'z' ? 0.09 : 0.14,
    height * 0.82,
    facing === 'z' ? 0.14 : 0.09,
    PALETTE.darkMetal,
  );
}

function residentialShell(
  b: MeshBuilder,
  rand: () => number,
  e: ShellExtents,
  stage: BuildingShellStage,
  defId: string,
): void {
  const height = e.top * (stage === 3 ? 0.34 : 0.58);
  const front = e.halfZ;
  const back = -e.halfZ;
  b.box(0, 0.06, 0, e.halfX * 2, 0.12, e.halfZ * 2, INTERIOR_ASH);
  // Front and rear walls survive in patches; the gable ends are broken.
  brokenWall(b, 0, front, e.halfX * 2, height * 0.82, 0.3, BURNT_BRICK);
  brokenWall(b, 0, back, e.halfX * 1.7, height * 0.62, 0.28, BURNT_BRICK);
  brokenWall(b, -e.halfX, 0, e.halfZ * 1.35, height * 0.55, 0.28, BURNT_BRICK, 'z');
  // Two open floors. The lower slab is the ceiling that fell onto the ground
  // floor; the upper one is the surviving edge of the first floor.
  // A surviving floor fragment, not a new roof: keep it to one corner so the
  // street-facing rooms and the collapsed middle stay open to the camera.
  exposedSlab(b, -e.halfX * 0.2, e.halfZ * 0.12, e.halfX * 0.95, e.halfZ * 0.6, height * 0.42, -0.06);
  if (stage === 2) {
    exposedSlab(b, e.halfX * 0.3, -e.halfZ * 0.22, e.halfX * 0.58, e.halfZ * 0.4, height * 0.7, 0.08);
  } else {
    exposedSlab(b, -e.halfX * 0.28, -e.halfZ * 0.24, e.halfX * 0.4, e.halfZ * 0.3, height * 0.56, -0.12);
  }
  // Blown window bays and a sagging balcony.
  const bays = Math.max(2, Math.round(e.halfX / 1.7));
  for (let i = 0; i < bays; i++) {
    const x = -e.halfX * 0.75 + (i / Math.max(1, bays - 1)) * e.halfX * 1.5;
    windowVoid(b, x, height * 0.62, front + 0.02, 1.05, height * 0.32, 'z');
    if (i % 2 === 0) windowVoid(b, x, height * 0.48, back - 0.02, 1.0, height * 0.28, 'z');
  }
  if (defId === 'tenement' || defId === 'apartmentBlock' || defId === 'motelBlock') {
    b.boxRot(0.8, height * 0.55, front + 0.55, Math.min(3.2, e.halfX * 1.2), 0.16, 0.9, 0.12, BURNT_CONCRETE);
    for (let i = 0; i < 4; i++) {
      b.box(-0.7 + i * 1.0, height * 0.55 + 0.05, front + 0.92, 0.06, 0.62, 0.06, PALETTE.metal);
    }
  }
  // Chimney stack and collapsed roof plates.
  b.box(e.halfX * 0.62, height * 0.55, back * 0.55, 0.75, height * 1.05, 0.75, BURNT_BRICK);
  b.box(e.halfX * 0.62, height * 1.08, back * 0.55, 0.92, 0.16, 0.92, SOOT);
  for (let i = 0; i < (stage === 3 ? 5 : 3); i++) {
    b.boxRot(
      (rand() * 2 - 1) * e.halfX * 0.8,
      height * (0.72 + rand() * 0.2),
      (rand() * 2 - 1) * e.halfZ * 0.7,
      0.9 + rand() * 1.5,
      0.12,
      0.6 + rand() * 0.8,
      rand() * Math.PI,
      i % 2 ? PALETTE.oliveDark : SOOT,
    );
  }
  b.box(-e.halfX * 0.35, 0.55, front * 0.55, 1.0, 0.9, 0.8, ASH);
  rubble(b, rand, e.halfX, e.halfZ, stage === 3 ? 20 : 12);
}

function civicShell(
  b: MeshBuilder,
  rand: () => number,
  e: ShellExtents,
  stage: BuildingShellStage,
  defId: string,
): void {
  const height = e.top * (stage === 3 ? 0.36 : 0.6);
  const front = e.halfZ;
  b.box(0, 0.07, 0, e.halfX * 2, 0.14, e.halfZ * 2, INTERIOR_ASH);
  // The hall keeps its side walls and the front colonnade; the roof and the
  // centre bays are gone. A civic shell is wider and more ordered than a house.
  brokenWall(b, 0, front, e.halfX * 2, height * 0.72, 0.34, BURNT_CONCRETE);
  brokenWall(b, 0, -e.halfZ, e.halfX * 1.75, height * 0.55, 0.32, BURNT_CONCRETE);
  brokenWall(b, -e.halfX, 0, e.halfZ * 1.45, height * 0.66, 0.32, BURNT_CONCRETE, 'z');
  brokenWall(b, e.halfX, 0, e.halfZ * 1.1, height * 0.48, 0.32, BURNT_CONCRETE, 'z');
  // Colonnade: four stumps with one fallen column across the steps.
  const columns = Math.max(3, Math.min(5, Math.round(e.halfX / 1.6)));
  for (let i = 0; i < columns; i++) {
    const x = -e.halfX * 0.75 + (i / Math.max(1, columns - 1)) * e.halfX * 1.5;
    const h = height * (i === columns - 1 ? 0.45 : 0.82);
    b.box(x, h / 2, front + 0.55, 0.46, h, 0.46, BURNT_CONCRETE);
    b.box(x, h + 0.1, front + 0.55, 0.6, 0.16, 0.6, ASH);
  }
  // A fallen column lies across the steps. boxRot only yaws, so using it to
  // stand a tall box on its side drove the column far below the plaza.
  b.box(e.halfX * 0.25, 0.23, front - height * 0.3, 0.46, 0.46, height * 0.78, BURNT_CONCRETE);
  // Exposed floor and a collapsed entrance canopy.
  exposedSlab(b, -e.halfX * 0.12, -e.halfZ * 0.14, e.halfX * 0.6, e.halfZ * 0.42, height * 0.34, -0.05);
  b.boxRot(-e.halfX * 0.15, height * 0.34, front + 0.55, e.halfX * 1.1, 0.18, 0.95, 0.08, BURNT_CONCRETE);
  b.boxRot(e.halfX * 0.45, 0.9, front + 0.4, 1.4, 0.16, 0.9, -0.3, BURNT_STEEL);
  // Special civic identities survive in silhouette.
  if (defId === 'fireStation') {
    const towerX = -e.halfX * 0.62;
    // The tower loses its upper stage first and is only a stump by stage 3.
    const towerH = height * (stage === 3 ? 0.6 : 0.88);
    b.box(towerX, towerH / 2, -e.halfZ * 0.52, 1.0, towerH, 1.0, BURNT_BRICK);
    b.box(towerX, towerH + 0.1, -e.halfZ * 0.52, 1.16, 0.2, 1.16, SOOT);
    // The apparatus bay mouth, with one buckled door leaf still hanging.
    b.box(0.25, height * 0.32, front + 0.06, e.halfX * 1.1, height * 0.58, 0.22, [0.04, 0.038, 0.035]);
    b.boxRot(0.25 + e.halfX * 0.2, height * 0.32, front + 0.45, 1.1, height * 0.52, 0.1, 0.22, BURNT_STEEL);
    for (let i = 0; i < 4; i++) {
      b.box(-e.halfX * 0.4 + i * 1.2, height * 0.62, front + 0.16, 0.1, 0.1, 0.08, PALETTE.warning);
    }
  } else if (defId === 'clinic') {
    b.box(0, height * 0.7, front + 0.05, 1.0, 0.22, 0.14, ASH);
    b.box(0, height * 0.7, front + 0.05, 0.2, 1.0, 0.14, ASH);
    for (let i = 0; i < 3; i++) {
      windowVoid(b, -e.halfX * 0.5 + i * 1.8, height * 0.42, front + 0.03, 1.1, height * 0.3, 'z');
    }
  } else if (defId === 'marketHall') {
    // Arcade arch stumps and a fallen awning over the stalls.
    for (let i = 0; i < 4; i++) {
      const x = -e.halfX * 0.7 + i * (e.halfX * 1.4 / 3);
      b.box(x, height * 0.28, front + 0.1, 0.35, height * 0.56, 0.35, BURNT_CONCRETE);
      b.box(x, height * 0.58, front + 0.1, 0.5, 0.18, 0.5, BURNT_CONCRETE);
    }
    b.boxRot(0, height * 0.36, front + 0.2, e.halfX * 1.3, 0.16, 0.8, 0.14, PALETTE.canvas);
    for (let i = 0; i < 3; i++) {
      b.box(-e.halfX * 0.45 + i * 1.8, 0.75, -e.halfZ * 0.2, 1.2, 0.8, 0.8, ASH);
    }
  } else if (defId === 'chapel') {
    b.box(-e.halfX * 0.65, height * 0.72, -e.halfZ * 0.55, 0.9, height * 1.44, 0.9, BURNT_CONCRETE);
    b.box(-e.halfX * 0.65, height * 1.48, -e.halfZ * 0.55, 1.1, 0.18, 1.1, SOOT);
  }
  if (stage === 2) {
    // The hall roof has come down in sections. One footprint-sized plate at
    // wall height read as a new green roof; two low, offset plates leave the
    // gutted interior and the surviving colonnade visible around them.
    b.boxRot(-e.halfX * 0.26, height * 0.32, -e.halfZ * 0.18, e.halfX * 0.82, 0.16, e.halfZ * 0.52, -0.09, PALETTE.oliveDark);
    b.boxRot(e.halfX * 0.28, height * 0.24, e.halfZ * 0.2, e.halfX * 0.55, 0.14, e.halfZ * 0.42, 0.2, PALETTE.oliveDark);
  }
  rubble(b, rand, e.halfX, e.halfZ, stage === 3 ? 24 : 14);
}

function industrialShell(
  b: MeshBuilder,
  rand: () => number,
  e: ShellExtents,
  stage: BuildingShellStage,
): void {
  const height = e.top * (stage === 3 ? 0.32 : 0.56);
  const front = e.halfZ;
  b.box(0, 0.06, 0, e.halfX * 2, 0.12, e.halfZ * 2, INTERIOR_ASH);
  // Steel frame: the columns outlive the cladding.
  for (let i = 0; i < 4; i++) {
    const x = -e.halfX * 0.82 + i * (e.halfX * 1.64 / 3);
    for (const z of [-e.halfZ * 0.72, e.halfZ * 0.72]) {
      b.box(x, height * 0.55, z, 0.18, height * 1.1, 0.18, BURNT_STEEL);
      b.box(x, height * 0.14, z, 0.5, 0.28, 0.5, BURNT_CONCRETE);
    }
  }
  // Remaining cladding, torn back from the bay.
  brokenWall(b, -e.halfX * 0.55, front, e.halfX * 0.9, height * 0.68, 0.18, ASH);
  brokenWall(b, 0, -e.halfZ, e.halfX * 1.6, height * 0.52, 0.2, ASH);
  b.box(e.halfX * 0.65, height * 0.36, front * 0.2, e.halfX * 0.6, height * 0.72, 0.18, BURNT_BRICK);
  // Open loading bay and the collapsed sawtooth roof over it.
  b.box(0.2, height * 0.3, front + 0.04, e.halfX * 0.95, height * 0.55, 0.16, [0.035, 0.033, 0.03]);
  for (let i = 0; i < 3; i++) {
    b.boxRot(
      -e.halfX * 0.55 + i * (e.halfX * 0.55),
      height * (0.62 + i * 0.1),
      -e.halfZ * 0.25,
      e.halfX * 0.5,
      0.18,
      e.halfZ * 0.75,
      (i - 1) * 0.22,
      PALETTE.oliveDark,
    );
  }
  // Chimney and fallen ducting. The stack rises from the slab; centring it at
  // 72% of the shell height pushed its base through the terrain.
  const stack = height * 1.25;
  b.box(e.halfX * 0.62, stack / 2, -e.halfZ * 0.55, 0.85, stack, 0.85, BURNT_BRICK);
  b.box(e.halfX * 0.62, stack + 0.09, -e.halfZ * 0.55, 1.0, 0.18, 1.0, SOOT);
  b.boxRot(-e.halfX * 0.25, 0.42, front * 0.55, e.halfX * 1.4, 0.28, 0.28, 0.18, PALETTE.darkMetal);
  // Machinery and a surviving internal floor.
  exposedSlab(b, e.halfX * 0.04, -e.halfZ * 0.2, e.halfX * 0.85, e.halfZ * 0.46, height * 0.48, 0.07);
  for (let i = 0; i < 3; i++) {
    b.box(-e.halfX * 0.4 + i * 1.7, 0.7, -e.halfZ * 0.15, 0.9, 1.0, 0.8, i === 1 ? EMBER : PALETTE.darkMetal);
  }
  rubble(b, rand, e.halfX, e.halfZ, stage === 3 ? 26 : 16);
}

function militaryShell(
  b: MeshBuilder,
  rand: () => number,
  e: ShellExtents,
  stage: BuildingShellStage,
): void {
  const height = e.top * (stage === 3 ? 0.3 : 0.5);
  b.box(0, 0.08, 0, e.halfX * 2, 0.16, e.halfZ * 2, INTERIOR_ASH);
  // Low concrete walls with embrasures survive; the light roof does not.
  brokenWall(b, 0, e.halfZ, e.halfX * 1.9, height, 0.42, BURNT_CONCRETE);
  brokenWall(b, 0, -e.halfZ, e.halfX * 1.5, height * 0.7, 0.4, BURNT_CONCRETE);
  brokenWall(b, -e.halfX, 0, e.halfZ * 1.4, height * 0.8, 0.38, BURNT_CONCRETE, 'z');
  for (let i = 0; i < 3; i++) {
    b.box(-e.halfX * 0.55 + i * (e.halfX * 0.55), height * 0.55, e.halfZ + 0.02, 0.9, 0.34, 0.16, [0.04, 0.04, 0.038]);
  }
  // Collapsed roof slab resting at an angle across the interior.
  b.boxRot(0, height * 0.64, 0, e.halfX * 1.5, 0.2, e.halfZ * 1.1, 0.1, ASH);
  b.boxRot(e.halfX * 0.2, height * 0.4, -e.halfZ * 0.1, e.halfX * 0.8, 0.18, e.halfZ * 0.65, -0.25, BURNT_CONCRETE);
  exposedSlab(b, 0, -e.halfZ * 0.12, e.halfX * 0.8, e.halfZ * 0.5, height * 0.3, -0.05);
  // Sandbag stub, antenna stump and a burnt equipment box.
  for (let i = 0; i < 5; i++) {
    b.box(-e.halfX * 0.55 + i * 0.7, 0.38, e.halfZ + 0.65, 0.65, 0.5, 0.5, PALETTE.sandbag);
  }
  b.box(e.halfX * 0.55, height * 0.55, -e.halfZ * 0.55, 0.12, height * 1.1, 0.12, PALETTE.metal);
  b.box(e.halfX * 0.55, height * 1.1, -e.halfZ * 0.55, 0.35, 0.12, 0.35, PALETTE.warning);
  b.box(-e.halfX * 0.35, 0.75, -e.halfZ * 0.25, 1.2, 0.8, 0.9, SOOT);
  rubble(b, rand, e.halfX, e.halfZ, stage === 3 ? 20 : 12);
}

const SHELLS = new Map<string, MeshBuffers>();

/**
 * Ruin shell for one structure family and stage. The mesh is generated from the
 * footprint and a fixed hash, so the same building always leaves the same ruin
 * and a save round-trip cannot reshuffle it.
 */
export function buildingDamageShell(
  defId: string,
  stage: BuildingShellStage,
  extents: ShellExtents,
): MeshBuffers | undefined {
  const family = buildingDamageFamily(defId);
  if (!family) return undefined;
  const key = `${defId}:${stage}:${extents.halfX.toFixed(2)}:${extents.halfZ.toFixed(2)}:${extents.top.toFixed(2)}`;
  const cached = SHELLS.get(key);
  if (cached) return cached;
  const rand = seeded(hashString(`${defId}:shell:${stage}`));
  const b = new MeshBuilder();
  if (family === 'residential') residentialShell(b, rand, extents, stage, defId);
  else if (family === 'civic') civicShell(b, rand, extents, stage, defId);
  else if (family === 'industrial') industrialShell(b, rand, extents, stage);
  else militaryShell(b, rand, extents, stage);
  const mesh = b.build();
  SHELLS.set(key, mesh);
  return mesh;
}

/** Test/probe hook, matching the damage mesh cache. */
export function clearDamageShellCache(): void {
  SHELLS.clear();
}
