/**
 * Authored set dressing: individual props placed by hand, in the scenario.
 *
 * Procedural scatter dresses the ground a tile at a time. This suite covers the
 * other half of the promise: a prop a map author places on one tile is stored in
 * the scenario, survives a save round-trip, is drawn out of the batch its kind
 * names, and is refused or warned about where it does not belong.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROPS, PROP_IDS, isPropKind, type PropKind } from '../src/data/props';
import {
  ScenarioFormatError,
  createScenario,
  parseScenario,
  scenarioToJson,
  validateScenario,
  type ScenarioProp,
} from '../src/sim/scenario';
import { createRuntimeMap } from '../src/sim/map';
import { SCENARIOS } from '../src/data/scenarioCatalog';
import { buildPropInstances, onSite, structureRects } from '../src/render/terrainMesh';
import { Terrain, tileIndex } from '../src/sim/terrain';
import { TILE_SIZE } from '../src/sim/constants';

const editorSource = readFileSync(new URL('../src/ui/editor.ts', import.meta.url), 'utf8');
const editorRenderSource = readFileSync(
  new URL('../src/ui/editorRender.ts', import.meta.url),
  'utf8',
);
const terrainMeshSource = readFileSync(
  new URL('../src/render/terrainMesh.ts', import.meta.url),
  'utf8',
);

function prop(kind: PropKind, x: number, z: number, extra: Partial<ScenarioProp> = {}): ScenarioProp {
  return { kind, x, z, ...extra };
}

describe('prop catalogue', () => {
  it('names one instanced batch per kind, with a note for the palette', () => {
    expect(PROP_IDS).toHaveLength(50);
    expect(new Set(PROP_IDS).size).toBe(PROP_IDS.length);
    for (const id of PROP_IDS) {
      const def = PROPS[id];
      expect(def.id).toBe(id);
      expect(def.name.length).toBeGreaterThan(2);
      expect(def.note.length).toBeGreaterThan(10);
      expect(def.scale).toBeGreaterThan(0);
      expect(def.batch.length).toBeGreaterThanOrEqual(3);
    }
    expect(isPropKind('bush')).toBe(true);
    expect(isPropKind('dragon')).toBe(false);
  });
});

describe('the scenario format', () => {
  it('carries authored props through a save and reload', () => {
    const scenario = createScenario(32, 32, 'Prop round trip');
    scenario.props = [
      prop('bush', 4, 5),
      prop('rubble', 12, 12, { rotation: 0.75, scale: 1.4 }),
      prop('reed', 30, 30),
    ];
    const reloaded = parseScenario(JSON.parse(scenarioToJson(scenario)));
    expect(reloaded.props).toEqual(scenario.props);
    // Absent stays absent: a map with no authored props writes no key at all,
    // so every earlier scenario still parses to exactly what it did before.
    const bare = parseScenario(JSON.parse(scenarioToJson(createScenario(16, 16))));
    expect(bare.props).toBeUndefined();
    expect('props' in JSON.parse(scenarioToJson(createScenario(16, 16)))).toBe(false);
  });

  it('refuses an unknown kind, a stray coordinate and a silly scale', () => {
    const base = JSON.parse(scenarioToJson(createScenario(16, 16)));
    const withProp = (entry: Record<string, unknown>) => ({ ...base, props: [entry] });
    expect(() => parseScenario(withProp({ kind: 'dragon', x: 1, z: 1 }))).toThrow(ScenarioFormatError);
    expect(() => parseScenario(withProp({ kind: 'bush', x: 99, z: 1 }))).toThrow(ScenarioFormatError);
    expect(() => parseScenario(withProp({ kind: 'bush', x: 1, z: 1, scale: 40 }))).toThrow(
      ScenarioFormatError,
    );
    expect(() => parseScenario(withProp({ kind: 'bush', x: 1, z: 1, rotation: 9 }))).toThrow(
      ScenarioFormatError,
    );
  });

  it('warns about a land prop in the water and a prop on a structure', () => {
    const scenario = createScenario(32, 32);
    scenario.tiles[tileIndex(32, 3, 3)] = { t: Terrain.DeepWater, e: 0, o: 0 };
    scenario.structures.push({ defId: 'barracks', owner: 0, x: 20, z: 20 });
    scenario.props = [prop('tree', 3, 3), prop('rock', 20, 20), prop('reed', 3, 3)];
    const issues = validateScenario(scenario);
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain('prop-on-water');
    expect(codes).toContain('prop-on-structure');
    // One warning per offending prop: the reed in the shallows is legal, so the
    // water warning can only be the tree's.
    expect(issues.filter((issue) => issue.code === 'prop-on-water')).toHaveLength(1);
    expect(issues.find((issue) => issue.code === 'prop-on-water')?.x).toBe(3);
    expect(issues.find((issue) => issue.code === 'prop-on-structure')?.x).toBe(20);
  });
});

describe('drawing authored props', () => {
  it('stands the prop on its own tile, in the batch its kind names', () => {
    const scenario = createScenario(32, 32);
    scenario.props = [
      prop('rock', 5, 5),
      prop('reed', 6, 6),
      prop('rubble', 7, 7, { rotation: 1.2, scale: 1.5 }),
    ];
    const props = buildPropInstances(scenario);
    const centreX = 5.5 * TILE_SIZE;
    const centreZ = 5.5 * TILE_SIZE;
    const authored = props.rocks.filter(
      (rock) => Math.abs(rock.x - centreX) < 1e-6 && Math.abs(rock.z - centreZ) < 1e-6,
    );
    expect(authored).toHaveLength(1);
    // Default size comes from the catalogue, not from a bare 1.0.
    expect(authored[0].scale).toBeCloseTo(PROPS.rock.scale, 5);

    const reed = props.reeds.filter((entry) => Math.abs(entry.x - 6.5 * TILE_SIZE) < 1e-6);
    expect(reed).toHaveLength(1);

    const heap = props.rubble.filter((entry) => Math.abs(entry.x - 7.5 * TILE_SIZE) < 1e-6);
    expect(heap).toHaveLength(1);
    expect(heap[0].rotation).toBeCloseTo(1.2, 5);
    expect(heap[0].scale).toBeCloseTo(PROPS.rubble.scale * 1.5, 5);
  });

  it('yields the ground to a structure standing over it', () => {
    const scenario = createScenario(32, 32);
    scenario.structures.push({ defId: 'barracks', owner: 0, x: 20, z: 20 });
    scenario.props = [prop('rock', 20, 20), prop('rock', 10, 10)];
    const map = createRuntimeMap(scenario);
    const props = buildPropInstances(scenario, map.ore, map.maxOre);
    const rects = structureRects(scenario.structures);
    expect(props.rocks.filter((rock) => onSite(rects, rock.x, rock.z))).toHaveLength(0);
    // The prop away from the footprint is untouched.
    expect(
      props.rocks.some(
        (rock) => Math.abs(rock.x - 10.5 * TILE_SIZE) < 1e-6 && Math.abs(rock.z - 10.5 * TILE_SIZE) < 1e-6,
      ),
    ).toBe(true);
  });

  it('is deterministic for the same scenario', () => {
    const scenario = createScenario(32, 32);
    scenario.props = [prop('bush', 8, 9), prop('sign', 9, 8, { rotation: -0.4 })];
    expect(buildPropInstances(scenario).signs).toEqual(buildPropInstances(scenario).signs);
  });
});

describe('authored props on the shipped roster', () => {
  it('ships individual pieces on several competitive maps', () => {
    const withProps = SCENARIOS.filter((entry) => (entry.create().props ?? []).length > 0);
    const total = withProps.reduce((sum, entry) => sum + (entry.create().props ?? []).length, 0);
    expect(withProps.length).toBeGreaterThanOrEqual(3);
    expect(total).toBeGreaterThanOrEqual(20);
    const ids = withProps.map((entry) => entry.id);
    expect(ids).toContain('contact-zone');
    expect(ids).toContain('crossing-point');
    // Authored props are stamped by the map's own four-way helper, so every one
    // of them has three rotated counterparts.
    for (const entry of withProps) {
      const scenario = entry.create();
      const props = scenario.props ?? [];
      expect(props.length % 4, `${entry.id} prop count`).toBe(0);
      // Every authored piece has to be visible: the draw pass clears props off
      // a structure footprint, so one authored under a building would vanish.
      const rects = structureRects(scenario.structures);
      const hidden = props.filter(
        (prop) => onSite(rects, (prop.x + 0.5) * TILE_SIZE, (prop.z + 0.5) * TILE_SIZE),
      );
      expect(hidden, `${entry.id} authored props under a structure`).toHaveLength(0);
    }
  });
});

describe('the Scenario Forge tool', () => {
  it('has a palette, a placement path and an erase path', () => {
    expect(editorSource).toContain('data-prop=');
    expect(editorSource).toContain("this.tool = 'prop'");
    expect(editorSource).toContain('private placeProp(');
    expect(editorSource).toContain('this.scenario.props');
    expect(editorRenderSource).toContain('scenario.props ?? []');
    // The renderer merges authored props into the same batches as the scatter.
    expect(terrainMeshSource).toContain('scenario.props ?? []');
    expect(terrainMeshSource).toContain('PROPS[prop.kind]');
  });
});
