import { describe, expect, it } from 'vitest';
import { MeshBuilder, PALETTE, buildOreMesh, buildRockMesh, buildTreeMesh, materialForColor } from '../src/render/geometry';
import { MATERIAL, MATERIAL_COUNT, MATERIAL_DEFS, materialLut } from '../src/render/materials';
import { buildingMesh } from '../src/render/buildingMeshes';
import { MESH_FS, MESH_VS, PROP_FS, PROP_VS, TERRAIN_FS, WATER_FS } from '../src/render/shaders';
import { createIslandAssault } from '../src/data/scenarios';
import { buildRoadDetails } from '../src/render/terrainMesh';

describe('material pipeline', () => {
  it('maps the palette into the shared material families', () => {
    expect(materialForColor(PALETTE.concrete)).toBe(MATERIAL.concrete);
    expect(materialForColor(PALETTE.concreteDark)).toBe(MATERIAL.concrete);
    expect(materialForColor(PALETTE.metal)).toBe(MATERIAL.bareMetal);
    expect(materialForColor(PALETTE.darkMetal)).toBe(MATERIAL.bareMetal);
    expect(materialForColor(PALETTE.hull)).toBe(MATERIAL.painted);
    expect(materialForColor(PALETTE.olive)).toBe(MATERIAL.painted);
    expect(materialForColor(PALETTE.glass)).toBe(MATERIAL.glass);
    expect(materialForColor(PALETTE.glassDark)).toBe(MATERIAL.glass);
    expect(materialForColor(PALETTE.canvas)).toBe(MATERIAL.canvas);
    expect(materialForColor(PALETTE.sandbag)).toBe(MATERIAL.canvas);
    expect(materialForColor(PALETTE.track)).toBe(MATERIAL.track);
    expect(materialForColor(PALETTE.rubber)).toBe(MATERIAL.track);
  });

  it('emits one material id per vertex and honours an explicit override', () => {
    const b = new MeshBuilder();
    b.box(0, 1, 0, 2, 2, 2, PALETTE.concrete);
    b.material = MATERIAL.rock;
    b.addTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0], [0.5, 0.5, 0.5]);
    const mesh = b.build();
    expect(mesh.materials).toBeDefined();
    expect(mesh.materials!.length).toBe(mesh.positions.length / 3);
    expect(Array.from(mesh.materials!.slice(0, 24)).every((id) => id === MATERIAL.concrete)).toBe(true);
    expect(mesh.materials![mesh.materials!.length - 3]).toBe(MATERIAL.rock);
  });

  it('keeps material buffers aligned when static building parts are merged', () => {
    const hq = buildingMesh('commandPost');
    expect(hq).not.toBeNull();
    expect(hq!.materials).toBeDefined();
    expect(hq!.materials!.length).toBe(hq!.positions.length / 3);
    const ids = new Set(Array.from(hq!.materials!));
    expect(ids.has(MATERIAL.concrete)).toBe(true);
    expect(ids.has(MATERIAL.painted)).toBe(true);
    expect(ids.has(MATERIAL.bareMetal)).toBe(true);
  });

  it('marks the whole road surface as asphalt', () => {
    const road = buildRoadDetails(createIslandAssault());
    expect(road.materials).toBeDefined();
    expect(road.materials!.length).toBe(road.positions.length / 3);
    expect(Array.from(road.materials!).every((id) => id === MATERIAL.asphalt)).toBe(true);
  });

  it('marks props with their own families', () => {
    expect(Array.from(buildTreeMesh().materials!).every((id) => id === MATERIAL.canvas)).toBe(true);
    expect(Array.from(buildRockMesh().materials!).every((id) => id === MATERIAL.rock)).toBe(true);
    // Crystal facets need the glossy glass family, not bare metal.
    expect(Array.from(buildOreMesh().materials!).every((id) => id === MATERIAL.glass)).toBe(true);
  });

  it('publishes a complete, stable 8-row property LUT', () => {
    expect(MATERIAL_DEFS).toHaveLength(MATERIAL_COUNT);
    expect(new Set(MATERIAL_DEFS.map((def) => def.id)).size).toBe(MATERIAL_COUNT);
    const lut = materialLut();
    expect(lut).toHaveLength(MATERIAL_COUNT * 4);
    for (const def of MATERIAL_DEFS) {
      expect(lut[def.id * 4]).toBe(Math.round(def.roughness * 255));
      expect(lut[def.id * 4 + 1]).toBe(Math.round(def.metalness * 255));
      expect(lut[def.id * 4 + 2]).toBe(Math.round(def.detail * 255));
      expect(lut[def.id * 4 + 3]).toBe(Math.round(def.specular * 255));
    }
  });

  it('keeps the shared shader contracts for material, fog, team and flag paths', () => {
    expect(MESH_VS).toContain('layout(location=7) in float aMaterial');
    expect(MESH_VS).toContain('vMaterial = aMaterial');
    expect(MESH_FS).toContain('uniform sampler2D uMatLut');
    expect(MESH_FS).toContain('float materialId = floor(vMaterial + 0.5)');
    expect(MESH_FS).toContain('uFlagTex');
    expect(MESH_FS).toContain('uFogTex');
    expect(MESH_FS).toContain('uTeamColor');
    expect(PROP_VS).toContain('layout(location=8) in float aMaterial');
    expect(PROP_FS).toContain('uniform sampler2D uMatLut');
    expect(TERRAIN_FS).toContain('uniform sampler2D uShoreTex');
    expect(WATER_FS).toContain('uniform sampler2D uShoreTex');
  });
});
