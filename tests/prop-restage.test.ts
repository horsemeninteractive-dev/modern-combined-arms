/**
 * Authored scenery has to reach the screen, not just the scenario.
 *
 * Placing a prop only appended it to `scenario.props`; the instanced batches
 * were staged when the map loaded and nothing rebuilt them, so the author saw
 * the Forge's authoring ring and no mesh. These tests pin the two paths that
 * matter: the Forge restages after an edit, and a deployed match — which builds
 * its scenery with the standing buildings passed in — still carries authored
 * decor into its own batches.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createScenario } from '../src/sim/scenario';
import { createRuntimeMap } from '../src/sim/map';
import { buildPropInstances, structureRects } from '../src/render/terrainMesh';
import { DECOR_BATCHES } from '../src/render/decorMeshes';
import { DECOR_PROP_IDS, PROPS } from '../src/data/props';
import { BUILDINGS } from '../src/data/buildings';
import { TILE_SIZE } from '../src/sim/constants';

const rendererSource = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../src/ui/editor.ts', import.meta.url), 'utf8');

describe('restaging authored props', () => {
  it('keeps authored decor when a match builds scenery around its buildings', () => {
    const scenario = createScenario(32, 32, 'Restage');
    scenario.structures.push({ defId: 'barracks', owner: 0, x: 20, z: 20 });
    scenario.props = [
      { kind: 'hayBale', x: 6, z: 6 },
      { kind: 'busStop', x: 8, z: 9, rotation: 1.1, scale: 1.2 },
    ];
    const map = createRuntimeMap(scenario);
    // The live path hands the builders world-space footprint centres, which is
    // what `stampGround` divides back down to a top-left corner.
    const sites = scenario.structures.map((s) => {
      const footprint = BUILDINGS[s.defId].footprint;
      return {
        defId: s.defId,
        x: (s.x + footprint.w / 2) * TILE_SIZE,
        z: (s.z + footprint.h / 2) * TILE_SIZE,
      };
    });
    // The battle path supplies both the live buildings and the same list as the
    // standing set, which is what clears scatter off their footprints.
    const props = buildPropInstances(scenario, map.ore, map.maxOre, sites, sites);
    const hay = props.decor[PROPS.hayBale.batch] ?? [];
    expect(hay).toHaveLength(1);
    expect(hay[0].x).toBeCloseTo(6.5 * TILE_SIZE, 5);
    const bus = props.decor[PROPS.busStop.batch] ?? [];
    expect(bus).toHaveLength(1);
    expect(bus[0].rotation).toBeCloseTo(1.1, 5);
    expect(bus[0].scale).toBeCloseTo(PROPS.busStop.scale * 1.2, 5);
    // Nothing authored under the barracks, and both props stand clear of it.
    expect(structureRects(scenario.structures).length).toBeGreaterThan(0);
    for (const list of Object.values(props.decor)) {
      for (const instance of list) expect(instance.x).toBeLessThan(20 * TILE_SIZE);
    }
  });

  it('gives every authored-only kind a batch the renderer builds a mesh for', () => {
    expect(DECOR_PROP_IDS.length).toBeGreaterThan(30);
    for (const kind of DECOR_PROP_IDS) {
      expect(DECOR_BATCHES, `${kind} batch`).toContain(PROPS[kind].batch);
    }
  });

  it('has a renderer restage the Forge can call after an edit', () => {
    expect(rendererSource).toContain('restageProps()');
    expect(rendererSource).toContain('private applyPropSource(');
    // Scenario build, mid-match restage and the Forge hook all share it.
    expect(rendererSource.match(/applyPropSource\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(editorSource).toContain('renderer.restageProps()');
    // Live buildings reach the builders as world centres, not tiles.
    expect(rendererSource).toContain('(e.x + (footprint?.w ?? 1) / 2) * TILE_SIZE');
  });
});
