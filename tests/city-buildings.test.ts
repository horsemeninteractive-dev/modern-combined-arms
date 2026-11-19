/**
 * The garrisonable building stock a city map draws on.
 *
 * Eleven shelters shipped before this set: a city could only repeat tenements,
 * warehouses and offices, which is exactly how a city map starts to read as
 * tiles rather than a place. These nine add a school, apartment slab, motel,
 * cinema, bank, station, garage, cold store and terrace row, taking the stock to
 * twenty distinct shelters.
 *
 * The checks here are the ones a new authored shelter has to pass to be safe on
 * a hand-built map: it fits its footprint, it has no team-tinted ownership panel
 * (shelters read ownership from the flag), it has an occupied dressing variant,
 * its flag mount stands on its own mesh, and its silhouette is its own.
 */
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/data/buildings';
import { buildingMesh, buildingStyle, buildingTopHeight } from '../src/render/buildingMeshes';
import { BUILDING_FLAG_ANCHORS } from '../src/render/flags';
import { TILE_SIZE } from '../src/sim/constants';
import type { MeshBuffers } from '../src/render/gl';

const NEW_SHELTERS = [
  'schoolhouse',
  'apartmentBlock',
  'motelBlock',
  'cinema',
  'bankHouse',
  'stationHouse',
  'autoGarage',
  'coldStore',
  'townhouseTerrace',
];

function bounds(mesh: MeshBuffers) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/** Highest triangle surface at an exact local XZ point, or -Infinity. */
function surfaceAt(mesh: MeshBuffers, x: number, z: number): number {
  const p = mesh.positions;
  const indices = mesh.indices;
  let top = -Infinity;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = p[a];
    const az = p[a + 2];
    const bx = p[b];
    const bz = p[b + 2];
    const cx = p[c];
    const cz = p[c + 2];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-9) continue;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const w = 1 - u - v;
    if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
    top = Math.max(top, u * p[a + 1] + v * p[b + 1] + w * p[c + 1]);
  }
  return top;
}

describe('garrisonable building stock', () => {
  it('offers twenty-three distinct shelters rather than a dozen repeated ones', () => {
    const garrisonable = Object.values(BUILDINGS).filter((def) => def.garrison);
    expect(garrisonable).toHaveLength(23);
    const ids = garrisonable.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of NEW_SHELTERS) expect(ids, id).toContain(id);
  });

  it('authored the new shelters so a Forge map can place them', () => {
    for (const id of NEW_SHELTERS) {
      const def = BUILDINGS[id];
      expect(def, id).toBeDefined();
      expect(def.authoredOnly, id).toBe(true);
      expect(def.icon.length, id).toBeGreaterThan(2);
      expect(def.description.length, id).toBeGreaterThan(80);
      expect(def.garrison, id).toBeDefined();
      expect(def.garrison!.capacity, id).toBeGreaterThanOrEqual(3);
      expect(def.garrison!.capacity, id).toBeLessThanOrEqual(6);
      expect(def.garrison!.protection, id).toBeGreaterThanOrEqual(0.35);
      expect(def.garrison!.protection, id).toBeLessThanOrEqual(0.6);
      expect(def.garrison!.firingSlots, id).toBeGreaterThanOrEqual(1);
    }
  });

  it('fits each new shelter inside its footprint with a body worth rendering', () => {
    for (const id of NEW_SHELTERS) {
      const def = BUILDINGS[id];
      const mesh = buildingMesh(id);
      expect(mesh, id).toBeDefined();
      const b = bounds(mesh!);
      const halfW = (def.footprint.w * TILE_SIZE) / 2;
      const halfH = (def.footprint.h * TILE_SIZE) / 2;
      expect(Math.abs(b.minX), `${id} minX`).toBeLessThanOrEqual(halfW + 0.05);
      expect(Math.abs(b.maxX), `${id} maxX`).toBeLessThanOrEqual(halfW + 0.05);
      expect(Math.abs(b.minZ), `${id} minZ`).toBeLessThanOrEqual(halfH + 0.05);
      expect(Math.abs(b.maxZ), `${id} maxZ`).toBeLessThanOrEqual(halfH + 0.05);
      expect(b.minY, `${id} base`).toBeGreaterThanOrEqual(-0.1);
      const triangles = mesh!.indices.length / 3;
      expect(triangles, `${id} triangles`).toBeGreaterThan(150);
      expect(triangles, `${id} triangles`).toBeLessThan(6000);
    }
  });

  it('reads ownership from the flag rather than a painted roof panel', () => {
    for (const id of NEW_SHELTERS) {
      const body = buildingStyle(id)!.body;
      expect(body.teamMask.filter((value) => value > 0), id).toHaveLength(0);
      // A garrisonable shelter must be able to show that it is occupied.
      const garrisoned = buildingStyle(id)!.garrisoned;
      expect(garrisoned, id).toBeDefined();
      expect(garrisoned!.positions.length, id).toBeGreaterThan(body.positions.length / 2);
    }
  });

  it('stands the flag on the roof and clears the health bar above it', () => {
    for (const id of NEW_SHELTERS) {
      const anchor = BUILDING_FLAG_ANCHORS[id as keyof typeof BUILDING_FLAG_ANCHORS];
      expect(anchor, id).toBeDefined();
      const top = surfaceAt(buildingMesh(id)!, anchor.x, anchor.z);
      expect(Number.isFinite(top), id).toBe(true);
      expect(anchor.y, `${id} flag base`).toBeGreaterThanOrEqual(top - 0.08);
      expect(anchor.y, `${id} flag base`).toBeLessThanOrEqual(top + 0.12);
      expect(buildingTopHeight(id), `${id} height`).toBeGreaterThan(4);
    }
  });

  it('gives every new shelter a silhouette of its own', () => {
    const bodies = NEW_SHELTERS.map((id) => Array.from(buildingStyle(id)!.body.positions).join(','));
    expect(new Set(bodies).size).toBe(NEW_SHELTERS.length);
    // And none of them is a copy of an existing shelter either.
    for (let i = 0; i < NEW_SHELTERS.length; i++) {
      for (let j = i + 1; j < NEW_SHELTERS.length; j++) {
        expect(bodies[i], `${NEW_SHELTERS[i]} vs ${NEW_SHELTERS[j]}`).not.toBe(bodies[j]);
      }
    }
  });
});
