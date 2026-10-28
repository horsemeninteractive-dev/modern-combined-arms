import { describe, expect, it } from 'vitest';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';
import { Terrain, TERRAIN, tileIndex } from '../src/sim/terrain';
import { TILE_SIZE } from '../src/sim/constants';
import {
  buildPropInstances,
  buildRoadDetails,
  buildShoreTexture,
} from '../src/render/terrainMesh';
import { buildingMesh, buildingStyle, buildingTopHeight } from '../src/render/buildingMeshes';
import { TERRAIN_FS, WATER_FS } from '../src/render/shaders';
import { MATERIAL } from '../src/render/materials';

const scenario = createIslandAssault();

function readField(
  data: Uint8Array,
  width: number,
  x: number,
  z: number,
): [number, number, number, number] {
  const o = (z * width + x) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

function isWaterAt(x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= scenario.width || z >= scenario.height) return false;
  return TERRAIN[scenario.tiles[tileIndex(scenario.width, x, z)].t as keyof typeof TERRAIN].water;
}

describe('coastal field', () => {
  it('packs four deterministic channels for every tile', () => {
    const field = buildShoreTexture(scenario);
    expect(field).toHaveLength(scenario.width * scenario.height * 4);
    const repeat = buildShoreTexture(scenario);
    expect(Array.from(field)).toEqual(Array.from(repeat));
    for (let i = 3; i < field.length; i += 4) expect(field[i]).toBe(255);
  });

  it('separates land coast distance from water shore distance', () => {
    const field = buildShoreTexture(scenario);
    let landNear = 0;
    let landInland = 0;
    let waterNear = 0;
    let waterFar = 0;

    for (let z = 0; z < scenario.height; z++) {
      for (let x = 0; x < scenario.width; x++) {
        const [r, g, b] = readField(field, scenario.width, x, z);
        if (isWaterAt(x, z)) {
          expect(g, `${x},${z}`).toBe(0);
          if (b >= 250) {
            waterNear++;
            expect(r).toBeGreaterThan(0);
          }
          if (b === 0) waterFar++;
        } else {
          expect(b, `${x},${z}`).toBe(0);
          const touchesWater =
            isWaterAt(x + 1, z) || isWaterAt(x - 1, z) || isWaterAt(x, z + 1) || isWaterAt(x, z - 1);
          if (touchesWater) {
            expect(g, `${x},${z}`).toBeGreaterThanOrEqual(250);
            landNear++;
          }
          if (g === 0) landInland++;
        }
      }
    }

    expect(landNear).toBeGreaterThan(0);
    expect(landInland).toBeGreaterThan(0);
    expect(waterNear).toBeGreaterThan(0);
    expect(waterFar).toBeGreaterThan(0);
  });

  it('drives the terrain and water shaders from the matching channels', () => {
    expect(TERRAIN_FS).toContain('float coast = texture(uShoreTex, vUv).g;');
    expect(WATER_FS).toContain('vec3 shoreField = texture(uShoreTex, vUv).rgb;');
    expect(WATER_FS).toContain('float coast = shoreField.b;');
    expect(WATER_FS).toContain('float depth = smoothstep(0.12, 0.96, shallowness);');
  });
});

describe('road surface detail', () => {
  const mesh = buildRoadDetails(scenario);

  it('keeps the road a single asphalt submission', () => {
    expect(mesh.materials).toBeDefined();
    expect(Array.from(mesh.materials!).every((id) => id === MATERIAL.asphalt)).toBe(true);
  });

  it('adds wheel wear, lane paint and drainage seams without a decal pass', () => {
    let dark = 0;
    let light = 0;
    const colours = new Set<string>();
    for (let i = 0; i < mesh.colors.length; i += 3) {
      const r = mesh.colors[i];
      const g = mesh.colors[i + 1];
      const b = mesh.colors[i + 2];
      colours.add(`${r.toFixed(3)}|${g.toFixed(3)}|${b.toFixed(3)}`);
      if (r < 0.33) dark++;
      if (r > 0.47) light++;
    }
    // These are vertex-coloured surfaces inside the existing static mesh, not a
    // separate decal pass; the exact counts can move with the map but the
    // three treatments must survive generation.
    expect(colours.size).toBeGreaterThanOrEqual(4);
    expect(dark).toBeGreaterThan(200);
    expect(light).toBeGreaterThan(20);
  });

  it('keeps every added surface on the ground and inside the fog contract', () => {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i];
      const y = mesh.positions[i + 1];
      const z = mesh.positions[i + 2];
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(scenario.width * TILE_SIZE);
      expect(z).toBeLessThanOrEqual(scenario.height * TILE_SIZE);
      expect(y).toBeGreaterThan(0);
    }
  });
});

describe('coastal riprap', () => {
  const props = buildPropInstances(scenario);
  const coastal = props.rocks.filter((rock) => {
    const tx = Math.floor(rock.x / TILE_SIZE);
    const tz = Math.floor(rock.z / TILE_SIZE);
    const tile = scenario.tiles[tileIndex(scenario.width, tx, tz)];
    return tile.t !== Terrain.Rock;
  });

  it('places deterministic stone along ordinary coast, not on rock tiles', () => {
    expect(coastal.length).toBeGreaterThan(8);
    expect(coastal).toEqual(buildPropInstances(scenario).rocks.filter((rock) => {
      const tx = Math.floor(rock.x / TILE_SIZE);
      const tz = Math.floor(rock.z / TILE_SIZE);
      return scenario.tiles[tileIndex(scenario.width, tx, tz)].t !== Terrain.Rock;
    }));
  });

  it('keeps every riprap instance on land next to water', () => {
    for (const rock of coastal) {
      const tx = Math.floor(rock.x / TILE_SIZE);
      const tz = Math.floor(rock.z / TILE_SIZE);
      expect(isWaterAt(tx, tz), `${rock.x},${rock.z}`).toBe(false);
      const nearWater =
        isWaterAt(tx + 1, tz) ||
        isWaterAt(tx - 1, tz) ||
        isWaterAt(tx, tz + 1) ||
        isWaterAt(tx, tz - 1) ||
        isWaterAt(tx + 1, tz + 1) ||
        isWaterAt(tx - 1, tz + 1) ||
        isWaterAt(tx + 1, tz - 1) ||
        isWaterAt(tx - 1, tz - 1);
      expect(nearWater, `${rock.x},${rock.z}`).toBe(true);
      expect(rock.scale).toBeGreaterThan(0.35);
      expect(rock.scale).toBeLessThan(1);
    }
  });
});

describe('layered facades', () => {
  it('gives the Command Post a deeper facade without exceeding its triangle ceiling', () => {
    const body = buildingStyle('commandPost')!.body;
    expect(body.indices.length / 3).toBeGreaterThan(650);
    expect(body.indices.length / 3).toBeLessThan(2000);
    expect(buildingTopHeight('commandPost')).toBeGreaterThan(8.5);

    let team = 0;
    for (const mask of body.teamMask) if (mask > 0) team++;
    expect(team).toBeGreaterThanOrEqual(48);

    // The facade work must stay inside the existing four-tile footprint.
    let maxX = 0;
    let maxZ = 0;
    for (let i = 0; i < body.positions.length; i += 3) {
      maxX = Math.max(maxX, Math.abs(body.positions[i]));
      maxZ = Math.max(maxZ, Math.abs(body.positions[i + 2]));
    }
    expect(maxX).toBeLessThan(BUILDINGS.commandPost.footprint.w * TILE_SIZE * 0.5);
    expect(maxZ).toBeLessThan(BUILDINGS.commandPost.footprint.h * TILE_SIZE * 0.5);
  });

  it('layers the Warehouse while keeping it a neutral objective', () => {
    const body = buildingStyle('warehouse')!.body;
    expect(body.indices.length / 3).toBeGreaterThan(650);
    expect(body.indices.length / 3).toBeLessThan(1400);
    // Neutral/capturable structures must not carry a permanent faction panel.
    expect(body.teamMask.filter((mask) => mask > 0)).toHaveLength(0);
    expect(buildingMesh('warehouse')).toBeDefined();
    expect(buildingTopHeight('warehouse')).toBeGreaterThan(7);
  });
});
