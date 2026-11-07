/**
 * The expanded set-dressing catalogue and the meshes behind its new kinds.
 *
 * Fifty placeable props is a promise about variety: a city block should be able
 * to take benches, bins, hydrants, shelters and wrecks instead of a dozen copies
 * of the same bush. The original eleven kinds reuse the procedural scatter
 * batches; the other thirty-nine own a batch and a mesh each, which is what this
 * suite checks, along with the size contract that keeps a prop inside one tile.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DECOR_PROP_IDS, PROPS, PROP_GROUPS, PROP_IDS } from '../src/data/props';
import { DECOR_BATCHES, buildDecorMesh } from '../src/render/decorMeshes';

const rendererSource = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const terrainSource = readFileSync(new URL('../src/render/terrainMesh.ts', import.meta.url), 'utf8');

describe('the fifty-kind catalogue', () => {
  it('files every kind under exactly one palette group', () => {
    expect(PROP_IDS).toHaveLength(50);
    expect(new Set(PROP_IDS).size).toBe(50);
    const total = PROP_GROUPS.reduce(
      (sum, group) => sum + PROP_IDS.filter((id) => PROPS[id].group === group).length,
      0,
    );
    expect(total).toBe(50);
    for (const group of PROP_GROUPS) {
      expect(PROP_IDS.some((id) => PROPS[id].group === group), group).toBe(true);
    }
    expect(PROPS.bench.group).toBe('street');
    expect(PROPS.hayBale.group).toBe('farm');
    expect(PROPS.busStop.group).toBe('street');
    expect(PROPS.tankTrap.group).toBe('military');
  });

  it('gives the new kinds their own batch and leaves the scatter kinds alone', () => {
    expect(DECOR_PROP_IDS).toHaveLength(39);
    expect(DECOR_BATCHES).toHaveLength(39);
    for (const id of DECOR_PROP_IDS) {
      expect(PROPS[id].batch, id).toBe(id);
      expect(PROPS[id].note.length, id).toBeGreaterThan(10);
    }
    expect(PROPS.tree.batch).toBe('trees');
    expect(PROPS.lamp.batch).toBe('lamps');
    expect(DECOR_BATCHES).not.toContain('trees');
    expect(buildDecorMesh('trees')).toBeUndefined();
  });
});

describe('decor meshes', () => {
  it('builds a real mesh for every decor kind', () => {
    for (const id of DECOR_PROP_IDS) {
      const mesh = buildDecorMesh(id);
      expect(mesh, id).toBeDefined();
      const vertices = mesh!.positions.length / 3;
      expect(vertices, id).toBeGreaterThan(30);
      expect(mesh!.indices.length / 3, id).toBeGreaterThan(20);
      expect(mesh!.materials!.length, id).toBe(vertices);
      for (const material of mesh!.materials!) {
        expect(material, id).toBeGreaterThanOrEqual(0);
        expect(material, id).toBeLessThan(8);
      }
    }
  });

  it('keeps each prop inside one tile and standing on the ground', () => {
    for (const id of DECOR_PROP_IDS) {
      const mesh = buildDecorMesh(id)!;
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
        expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), id).toBe(true);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      // A prop is placed on one tile and must not spill into its neighbour's.
      expect(Math.max(Math.abs(minX), maxX), `${id} width`).toBeLessThanOrEqual(1.35);
      expect(Math.max(Math.abs(minZ), maxZ), `${id} depth`).toBeLessThanOrEqual(1.35);
      // Standing on its tile, not sunk through it or tall enough to read as a building.
      expect(minY, `${id} base`).toBeGreaterThanOrEqual(-0.12);
      expect(maxY, `${id} height`).toBeLessThanOrEqual(3.8);
    }
  });

  it('routes authored props into the decor batches and draws them', () => {
    expect(terrainSource).toContain('decor[def.batch]');
    expect(terrainSource).toContain('Object.values(decor)');
    expect(rendererSource).toContain('DECOR_BATCHES');
    expect(rendererSource).toContain('this.decorMeshes');
    expect(rendererSource).toContain('this.decorInstances');
  });
});
