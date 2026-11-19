import { beforeEach, describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/data/buildings';
import { TILE_SIZE } from '../src/sim/constants';
import { MeshBuilder } from '../src/render/geometry';
import {
  buildingDamageFamily,
  buildingDamageShell,
  clearDamageShellCache,
  type BuildingDamageFamily,
} from '../src/render/buildingRuin';
import { buildingTopHeight } from '../src/render/buildingMeshes';

function extents(defId: string) {
  const def = BUILDINGS[defId];
  return {
    halfX: (def.footprint.w * TILE_SIZE) / 2,
    halfZ: (def.footprint.h * TILE_SIZE) / 2,
    top: Math.max(0.5, buildingTopHeight(defId)),
  };
}

function triangles(mesh: { indices: ArrayLike<number> }): number {
  return mesh.indices.length / 3;
}

const FAMILY_MEMBERS: Record<BuildingDamageFamily, string[]> = {
  residential: ['tenement', 'apartmentBlock', 'motelBlock', 'townhouseTerrace', 'farmhouse', 'schoolhouse'],
  civic: ['civicHall', 'constabulary', 'chapel', 'clinic', 'fireStation', 'marketHall', 'cinema', 'bankHouse', 'stationHouse'],
  industrial: ['factory', 'refinery', 'warehouse', 'freightShed', 'foundryWorks', 'armourWorks', 'coldStore', 'autoGarage', 'powerPlant'],
  military: ['commandPost', 'barracks', 'bunker', 'radarStation', 'relay'],
};

describe('building destruction identity', () => {
  it('winds a rotated box so its normals face outward', () => {
    const b = new MeshBuilder();
    b.boxRot(0, 0, 0, 2, 2, 2, 0.37, [1, 1, 1]);
    for (let i = 0; i < b.positions.length; i += 3) {
      const dot =
        b.positions[i] * b.normals[i] +
        b.positions[i + 1] * b.normals[i + 1] +
        b.positions[i + 2] * b.normals[i + 2];
      expect(dot, `vertex ${i / 3}`).toBeGreaterThan(0);
    }
  });
  beforeEach(() => clearDamageShellCache());

  it('assigns every normal structure to a family and leaves walls and ruins alone', () => {
    for (const defId of Object.keys(BUILDINGS)) {
      const family = buildingDamageFamily(defId);
      if (['ruin', 'bridge', 'sandbagWall', 'concreteWall'].includes(defId)) {
        expect(family, defId).toBeNull();
      } else {
        expect(family, defId).not.toBeNull();
      }
    }
    expect(buildingDamageFamily('fireStation')).toBe('civic');
    expect(buildingDamageFamily('clinic')).toBe('civic');
    expect(buildingDamageFamily('marketHall')).toBe('civic');
    expect(buildingDamageFamily('tenement')).toBe('residential');
    expect(buildingDamageFamily('foundryWorks')).toBe('industrial');
    expect(buildingDamageFamily('commandPost')).toBe('military');
  });

  it('builds a family shell for every structure and no shell for a ruin', () => {
    for (const [family, ids] of Object.entries(FAMILY_MEMBERS)) {
      for (const defId of ids) {
        const shape = extents(defId);
        const stage2 = buildingDamageShell(defId, 2, shape);
        const stage3 = buildingDamageShell(defId, 3, shape);
        expect(stage2, `${defId} stage 2`).toBeDefined();
        expect(stage3, `${defId} stage 3`).toBeDefined();
        expect(triangles(stage2!), `${defId} stage 2 detail`).toBeGreaterThan(60);
        expect(triangles(stage3!), `${defId} stage 3 detail`).toBeGreaterThan(60);
        expect(
          Array.from(stage2!.positions),
          `${defId} must not reuse one shell for both stages (${family})`,
        ).not.toEqual(Array.from(stage3!.positions));
      }
    }
    expect(buildingDamageShell('ruin', 3, extents('ruin'))).toBeUndefined();
    expect(buildingDamageShell('bridge', 3, extents('bridge'))).toBeUndefined();
  });

  it('keeps every shell inside its authored footprint plus a small rubble spill', () => {
    for (const defId of Object.keys(BUILDINGS)) {
      if (!buildingDamageFamily(defId)) continue;
      const shape = extents(defId);
      for (const stage of [2, 3] as const) {
        const mesh = buildingDamageShell(defId, stage, shape)!;
        for (let i = 0; i < mesh.positions.length; i += 3) {
          const x = mesh.positions[i];
          const y = mesh.positions[i + 1];
          const z = mesh.positions[i + 2];
          expect(Math.abs(x), `${defId} (${buildingDamageFamily(defId)}) stage ${stage} x`).toBeLessThanOrEqual(shape.halfX + 1.5);
          expect(Math.abs(z), `${defId} stage ${stage} z`).toBeLessThanOrEqual(shape.halfZ + 1.5);
          expect(y, `${defId} stage ${stage} y`).toBeGreaterThanOrEqual(-0.01);
          expect(y, `${defId} stage ${stage} top`).toBeLessThanOrEqual(shape.top + 0.2);
        }
      }
    }
  });

  it('generates the same shell from the same building and footprint', () => {
    const shape = extents('fireStation');
    const first = buildingDamageShell('fireStation', 3, shape)!;
    clearDamageShellCache();
    const second = buildingDamageShell('fireStation', 3, shape)!;
    expect(Array.from(second.positions)).toEqual(Array.from(first.positions));
    expect(Array.from(second.indices)).toEqual(Array.from(first.indices));
  });
});
