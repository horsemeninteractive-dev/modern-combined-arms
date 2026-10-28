import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/data/buildings';
import { tryIdentityDef } from '../src/data/factions';
import { TILE_SIZE } from '../src/sim/constants';
import {
  buildingBannerAnchor,
  buildingMesh,
  buildingStyle,
  buildingTopHeight,
} from '../src/render/buildingMeshes';
import { BUILDING_FLAG_ANCHORS } from '../src/render/flags';
import { MeshBuilder, PALETTE, materialForColor, shade } from '../src/render/geometry';
import { hexToRgb } from '../src/render/math';
import { MATERIAL } from '../src/render/materials';
import { NEUTRAL_TEAM_COLOR, teamColorForOwner } from '../src/render/teamColor';
import type { MeshBuffers } from '../src/render/gl';

function bounds(mesh: MeshBuffers): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
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
    const y = u * p[a + 1] + v * p[b + 1] + w * p[c + 1];
    top = Math.max(top, y);
  }
  return top;
}

function triangles(mesh: MeshBuffers): number {
  return mesh.indices.length / 3;
}

function trackShare(mesh: MeshBuffers): number {
  const materials = mesh.materials!;
  let track = 0;
  for (const id of materials) if (id === MATERIAL.track) track++;
  return track / materials.length;
}

function teamVertices(mesh: MeshBuffers): number {
  return mesh.teamMask.filter((value) => value > 0).length;
}

const CEILINGS: Record<string, number> = {
  atTurret: 1100,
  coastalBattery: 1100,
  radarStation: 1400,
  relay: 1000,
};

describe('Phase 4 defensive silhouettes', () => {
  it('separates the anti-tank gun and coastal battery while preserving their mounts', () => {
    const at = buildingStyle('atTurret')!;
    const coastal = buildingStyle('coastalBattery')!;
    expect(Array.from(at.body.positions)).not.toEqual(Array.from(coastal.body.positions));
    expect(Array.from(at.turret!.positions)).not.toEqual(Array.from(coastal.turret!.positions));
    expect(at.turretOffset).toEqual([0, 1.3, 0]);
    expect(coastal.turretOffset).toEqual([0, 1.35, 0]);
    expect(BUILDINGS.coastalBattery.requiresWater).toBe(true);
    expect(BUILDINGS.atTurret.weapons).toEqual(['atTurretGun']);
    expect(BUILDINGS.coastalBattery.weapons).toEqual(['coastalMissile']);

    // A single long gun against two separated raised rails and a tall blast
    // plate: the two turrets must not be variants of one silhouette.
    const atGun = bounds(at.turret!);
    const coastalLauncher = bounds(coastal.turret!);
    expect(atGun.maxX).toBeGreaterThan(3.7);
    expect(atGun.maxY).toBeLessThan(2);
    expect(coastalLauncher.maxY).toBeGreaterThan(2.2);
    expect(coastalLauncher.maxY).toBeGreaterThan(atGun.maxY + 0.5);
  });

  it('keeps both defensive bodies inside their 2x2 footprint and under the ceilings', () => {
    for (const id of ['atTurret', 'coastalBattery']) {
      const def = BUILDINGS[id];
      const mesh = buildingMesh(id)!;
      const b = bounds(mesh);
      const halfW = (def.footprint.w * TILE_SIZE) / 2;
      const halfH = (def.footprint.h * TILE_SIZE) / 2;
      expect(Math.abs(b.minX), id).toBeLessThanOrEqual(halfW + 0.05);
      expect(Math.abs(b.maxX), id).toBeLessThanOrEqual(halfW + 0.05);
      expect(Math.abs(b.minZ), id).toBeLessThanOrEqual(halfH + 0.05);
      expect(Math.abs(b.maxZ), id).toBeLessThanOrEqual(halfH + 0.05);
      expect(triangles(mesh), id).toBeLessThanOrEqual(CEILINGS[id]);
      expect(triangles(buildingStyle(id)!.body), `${id} body`).toBeLessThan(triangles(mesh));
      // One fixed body, one traversing weapon, one flag: no new submissions.
      expect([buildingStyle(id)!.turret, buildingStyle(id)!.rotor, buildingStyle(id)!.door].filter(Boolean)).toHaveLength(1);
    }
  });
});

describe('Phase 4 captured-objective identities', () => {
  it('gives the relay and radar station substantial, separate bodies and arrays', () => {
    const relay = buildingStyle('relay')!;
    const station = buildingStyle('radarStation')!;
    expect(Array.from(relay.body.positions)).not.toEqual(Array.from(station.body.positions));
    expect(Array.from(relay.rotor!.mesh.positions)).not.toEqual(Array.from(station.rotor!.mesh.positions));
    expect(relay.rotor!.rate).toBe(1.2);
    expect(station.rotor!.rate).toBe(0.45);
    expect(relay.turret).toBeUndefined();
    expect(station.turret).toBeUndefined();

    const relayMesh = buildingMesh('relay')!;
    const stationMesh = buildingMesh('radarStation')!;
    expect(bounds(relayMesh).maxY).toBeLessThan(8);
    expect(bounds(stationMesh).maxY).toBeGreaterThan(7);
    expect(bounds(relayMesh).maxX - bounds(relayMesh).minX).toBeLessThan(8);
    expect(bounds(stationMesh).maxX - bounds(stationMesh).minX).toBeLessThan(12);

    for (const id of ['relay', 'radarStation']) {
      const body = buildingStyle(id)!.body;
      expect(triangles(buildingMesh(id)!), id).toBeLessThanOrEqual(CEILINGS[id]);
      expect(teamVertices(body), id).toBeGreaterThanOrEqual(24);
      expect([buildingStyle(id)!.turret, buildingStyle(id)!.rotor, buildingStyle(id)!.door].filter(Boolean)).toHaveLength(1);
    }
  });

  it('resolves neutral, defender and eastern ownership from the same body mask', () => {
    const defender = tryIdentityDef('lithuania')!;
    const eastern = tryIdentityDef('russia')!;
    expect(teamColorForOwner(-1, defender.id)).toEqual(NEUTRAL_TEAM_COLOR);
    expect(teamColorForOwner(0, defender.id)).toEqual(hexToRgb(defender.color));
    expect(teamColorForOwner(1, eastern.id)).toEqual(hexToRgb(eastern.color));
    expect(teamColorForOwner(0, defender.id)).not.toEqual(teamColorForOwner(1, eastern.id));
    expect(teamColorForOwner(-1, undefined)).toEqual(NEUTRAL_TEAM_COLOR);

    for (const id of ['relay', 'radarStation']) {
      const body = buildingStyle(id)!.body;
      const masked = teamVertices(body);
      // The ownership plate lives on the body, so hiding the flag cannot hide
      // the owner: the mask resolves to grey or a faction colour at draw time.
      expect(masked, id).toBeGreaterThan(0);
      for (const mask of body.teamMask) {
        expect(mask, id).toBeGreaterThanOrEqual(0);
        expect(mask, id).toBeLessThanOrEqual(1);
      }
    }
    // Supply Depot remains the established positive control.
    expect(teamVertices(buildingStyle('supplyDepot')!.body)).toBeGreaterThan(0);
  });
});

describe('Phase 4 shared glass classification', () => {
  it('classifies shaded and unshaded dark glass as glass, and real track as track', () => {
    for (const factor of [1, 0.94, 0.88, 0.82, 0.7, 0.5]) {
      expect(materialForColor(shade(PALETTE.glassDark, factor)), `glassDark x${factor}`).toBe(MATERIAL.glass);
      expect(materialForColor(shade(PALETTE.glass, factor)), `glass x${factor}`).toBe(MATERIAL.glass);
    }
    for (const factor of [1, 0.94, 0.7]) {
      expect(materialForColor(shade(PALETTE.track, factor)), `track x${factor}`).toBe(MATERIAL.track);
      expect(materialForColor(shade(PALETTE.rubber, factor)), `rubber x${factor}`).toBe(MATERIAL.track);
    }
    // Shaded dark metal is a metal edge, not a tyre.
    expect(materialForColor(PALETTE.darkMetal)).toBe(MATERIAL.bareMetal);
    expect(materialForColor(shade(PALETTE.darkMetal, 0.7))).toBe(MATERIAL.bareMetal);
  });

  it('brings the tenement and office-block glazing back below 5% track and leaves the ruin non-glass', () => {
    for (const id of ['tenement', 'officeBlock']) {
      expect(trackShare(buildingStyle(id)!.body), id).toBeLessThan(0.05);
    }
    const ruin = buildingStyle('ruin')!.body;
    expect(Array.from(ruin.materials!).some((id) => id === MATERIAL.glass)).toBe(false);
    expect(Array.from(ruin.materials!).some((id) => id === MATERIAL.track)).toBe(false);
  });

  it('keeps every blue-green building surface on the glass path', () => {
    for (const def of Object.values(BUILDINGS)) {
      const mesh = buildingStyle(def.id)?.body;
      if (!mesh) continue;
      for (let i = 0; i < mesh.colors.length; i += 3) {
        const r = mesh.colors[i];
        const g = mesh.colors[i + 1];
        const b = mesh.colors[i + 2];
        if (b > r * 1.3 && g > r * 1.3) {
          expect(mesh.materials![i / 3], `${def.id} blue-green vertex`).toBe(MATERIAL.glass);
        }
      }
    }
  });
});

describe('Phase 4 flag and overlay anchors', () => {
  it('supports every roof flag without intersection or conspicuous float', () => {
    for (const def of Object.values(BUILDINGS)) {
      const anchor = BUILDING_FLAG_ANCHORS[def.id];
      const mesh = buildingMesh(def.id)!;
      const top = surfaceAt(mesh, anchor.x, anchor.z);
      expect(Number.isFinite(top), def.id).toBe(true);
      if (anchor.apron) {
        // The two open yards mount at ground level by design.
        expect(['airfield', 'shipyard'], def.id).toContain(def.id);
        expect(anchor.y, def.id).toBeLessThan(1.2);
        continue;
      }
      expect(anchor.y, `${def.id} pole base intersects the mesh`).toBeGreaterThanOrEqual(top - 0.08);
      expect(anchor.y, `${def.id} pole base floats above its support`).toBeLessThanOrEqual(top + 0.12);
    }
  });

  it('keeps every building health bar above the rendered roof', () => {
    for (const def of Object.values(BUILDINGS)) {
      const top = buildingTopHeight(def.id);
      const anchor = buildingBannerAnchor(def.id);
      expect(anchor.y, def.id).toBeGreaterThanOrEqual(top + 0.4);
    }
    // The two corrected anchors are supported by the new geometry.
    expect(BUILDING_FLAG_ANCHORS.radarStation.y).toBeCloseTo(4.44, 2);
    expect(BUILDING_FLAG_ANCHORS.foundryWorks.y).toBeCloseTo(8.76, 2);
  });
});

describe('Phase 4 material id integrity', () => {
  it('keeps every merged building material buffer aligned and in range', () => {
    for (const def of Object.values(BUILDINGS)) {
      const mesh = buildingMesh(def.id)!;
      expect(mesh.materials!.length, def.id).toBe(mesh.positions.length / 3);
      for (const id of mesh.materials!) {
        expect(id, def.id).toBeGreaterThanOrEqual(0);
        expect(id, def.id).toBeLessThan(8);
      }
    }
  });

  it('keeps a minimal builder consistent with the shared classifier', () => {
    const b = new MeshBuilder();
    b.box(0, 1, 0, 2, 2, 2, PALETTE.glassDark);
    const mesh = b.build();
    expect(Array.from(mesh.materials!).every((id) => id === MATERIAL.glass)).toBe(true);
  });
});
