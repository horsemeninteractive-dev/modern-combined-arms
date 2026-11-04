import { describe, expect, it } from 'vitest';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';
import type { Scenario } from '../src/sim/scenario';
import {
  MIN_REGION_SIZE,
  applyRect,
  authoringIssues,
  authoredEntities,
  createMissionDoc,
  dependencyChain,
  describeEntityReference,
  ensureEntityKey,
  focusForPath,
  materialiseEntityKeys,
  moveRegion,
  objectiveDependents,
  overlappingRegions,
  parseMission,
  rectFromTiles,
  rectOfRegion,
  regionAt,
  regionBoundsLabel,
  resizeRegion,
  scenarioEntityKeyIssues,
  validateMission,
  wouldCreateDependencyCycle,
  type MissionDoc,
} from '../src/mission';

const BOUNDS = { width: 32, height: 24 };

function fixture(): { scenario: Scenario; mission: MissionDoc } {
  const scenario = createIslandAssault();
  const mission = createMissionDoc(scenario, { id: 'alpha-operation', title: 'Alpha Operation' });
  scenario.mission = mission;
  return { scenario, mission };
}

function contextFor(scenario: Scenario) {
  return {
    width: scenario.width,
    height: scenario.height,
    entityKeys: new Set(
      [...scenario.structures, ...scenario.units]
        .map((entry) => entry.key)
        .filter((key): key is string => Boolean(key)),
    ),
  };
}

function codes(doc: MissionDoc, scenario = createIslandAssault()): string[] {
  return validateMission(doc, contextFor(scenario)).map((issue) => issue.code);
}

describe('region drag geometry', () => {
  it('normalises a drag in every direction', () => {
    const downRight = rectFromTiles(4, 6, 9, 12, BOUNDS);
    const upLeft = rectFromTiles(9, 12, 4, 6, BOUNDS);
    const downLeft = rectFromTiles(9, 6, 4, 12, BOUNDS);
    const upRight = rectFromTiles(4, 12, 9, 6, BOUNDS);
    for (const rect of [downRight, upLeft, downLeft, upRight]) {
      expect(rect).toEqual({ x: 4, z: 6, width: 6, height: 7 });
    }
  });

  it('treats both drag corners as tiles, not edges', () => {
    // Dragging from tile 4 to tile 9 covers 4,5,6,7,8,9 — six tiles.
    expect(rectFromTiles(4, 4, 9, 9, BOUNDS).width).toBe(6);
    // A click without movement is the smallest legal region, never zero.
    expect(rectFromTiles(7, 7, 7, 7, BOUNDS)).toEqual({ x: 7, z: 7, width: MIN_REGION_SIZE, height: MIN_REGION_SIZE });
  });

  it('clamps a drag that leaves the map instead of rejecting it', () => {
    const rect = rectFromTiles(-5, -3, 100, 100, BOUNDS);
    expect(rect).toEqual({ x: 0, z: 0, width: BOUNDS.width, height: BOUNDS.height });
    const partial = rectFromTiles(28, 20, 60, 60, BOUNDS);
    expect(partial.x + partial.width).toBeLessThanOrEqual(BOUNDS.width);
    expect(partial.z + partial.height).toBeLessThanOrEqual(BOUNDS.height);
    expect(partial).toEqual({ x: 28, z: 20, width: 4, height: 4 });
  });

  it('moves a region without letting it leave the map', () => {
    const rect = { x: 4, z: 4, width: 6, height: 6 };
    expect(moveRegion(rect, 3, -2, BOUNDS)).toEqual({ x: 7, z: 2, width: 6, height: 6 });
    expect(moveRegion(rect, 500, 500, BOUNDS)).toEqual({ x: 26, z: 18, width: 6, height: 6 });
    expect(moveRegion(rect, -500, -500, BOUNDS)).toEqual({ x: 0, z: 0, width: 6, height: 6 });
  });

  it('resizes from each edge and corner', () => {
    const rect = { x: 10, z: 10, width: 5, height: 5 };
    expect(resizeRegion(rect, 'e', 3, 0, BOUNDS)).toEqual({ x: 10, z: 10, width: 8, height: 5 });
    expect(resizeRegion(rect, 'w', 3, 0, BOUNDS)).toEqual({ x: 13, z: 10, width: 2, height: 5 });
    expect(resizeRegion(rect, 'n', 0, 2, BOUNDS)).toEqual({ x: 10, z: 12, width: 5, height: 3 });
    expect(resizeRegion(rect, 'se', 4, 4, BOUNDS)).toEqual({ x: 10, z: 10, width: 9, height: 9 });
    expect(resizeRegion(rect, 'nw', -2, -2, BOUNDS)).toEqual({ x: 8, z: 8, width: 7, height: 7 });
  });

  it('stops at the minimum size when an edge is dragged past its opposite', () => {
    const rect = { x: 10, z: 10, width: 5, height: 5 };
    const squeezed = resizeRegion(rect, 'w', 40, 0, BOUNDS);
    expect(squeezed.width).toBe(MIN_REGION_SIZE);
    expect(squeezed.x + squeezed.width).toBe(15);
    const inverted = resizeRegion(rect, 'n', 0, 99, BOUNDS);
    expect(inverted.height).toBe(MIN_REGION_SIZE);
    expect(inverted.z + inverted.height).toBe(15);
  });

  it('keeps a resize inside the map bounds', () => {
    const rect = { x: 28, z: 20, width: 4, height: 4 };
    const grown = resizeRegion(rect, 'se', 20, 20, BOUNDS);
    expect(grown.x + grown.width).toBe(BOUNDS.width);
    expect(grown.z + grown.height).toBe(BOUNDS.height);
    const outLeft = resizeRegion(rect, 'nw', -50, -50, BOUNDS);
    expect(outLeft.x).toBe(0);
    expect(outLeft.z).toBe(0);
  });

  it('does not mutate the region it is given', () => {
    const rect = { x: 4, z: 4, width: 6, height: 6 };
    const before = { ...rect };
    moveRegion(rect, 2, 2, BOUNDS);
    resizeRegion(rect, 'se', 2, 2, BOUNDS);
    expect(rect).toEqual(before);
  });

  it('applies edited bounds back without changing the id', () => {
    const { mission } = fixture();
    mission.regions.push({ id: 'drop-zone', name: 'Drop zone', x: 2, z: 2, width: 3, height: 3 });
    const region = mission.regions[0];
    applyRect(region, { x: 8, z: 9, width: 4, height: 5 });
    expect(region.id).toBe('drop-zone');
    expect(rectOfRegion(region)).toEqual({ x: 8, z: 9, width: 4, height: 5 });
  });

  it('finds the topmost region under a tile', () => {
    const regions = [
      { id: 'outer', x: 0, z: 0, width: 20, height: 20 },
      { id: 'inner', x: 5, z: 5, width: 4, height: 4 },
    ];
    expect(regionAt(regions, 6, 6)?.id).toBe('inner');
    expect(regionAt(regions, 2, 2)?.id).toBe('outer');
    expect(regionAt(regions, 30, 30)).toBeNull();
    // The right and bottom edges are exclusive, as the runtime reads them.
    expect(regionAt(regions, 9, 9)?.id).toBe('outer');
  });

  it('reports every overlapping region, excluding itself', () => {
    const regions = [
      { id: 'a', x: 0, z: 0, width: 10, height: 10 },
      { id: 'b', x: 8, z: 8, width: 6, height: 6 },
      { id: 'c', x: 20, z: 20, width: 4, height: 4 },
    ];
    expect(overlappingRegions(regions, regions[0], 'a').map((entry) => entry.id)).toEqual(['b']);
    expect(overlappingRegions(regions, regions[2], 'c')).toEqual([]);
  });

  it('labels bounds the way the panel does', () => {
    expect(regionBoundsLabel({ x: 3, z: 4, width: 5, height: 2 })).toBe('3, 4 · 5×2');
  });
});

describe('authored entity references', () => {
  it('keys unkeyed placements uniquely and leaves existing keys alone', () => {
    const scenario = createIslandAssault();
    scenario.structures = [
      { defId: 'barracks', owner: 0, x: 4, z: 4 },
      { defId: 'barracks', owner: 0, x: 10, z: 4 },
      { defId: 'factory', owner: 1, x: 20, z: 20, key: 'their-works' },
    ];
    scenario.units = [
      { defId: 'rifle', owner: 0, x: 6, z: 6 },
      { defId: 'rifle', owner: 0, x: 7, z: 6 },
    ];
    const added = materialiseEntityKeys(scenario);
    expect(new Set(added).size).toBe(added.length);
    expect(scenario.structures[2].key).toBe('their-works');
    expect(scenario.structures[0].key).toBe('barracks');
    expect(scenario.structures[1].key).toBe('barracks-0');
    expect(scenario.units[0].key).toBe('rifle');
    expect(scenario.units[1].key).toBe('rifle-0');
    expect(new Set(scenario.units.map((entry) => entry.key)).size).toBe(2);
  });

  it('is stable when applied twice', () => {
    const scenario = createIslandAssault();
    scenario.units = [{ defId: 'rifle', owner: 0, x: 6, z: 6 }];
    materialiseEntityKeys(scenario);
    const key = scenario.units[0].key;
    expect(materialiseEntityKeys(scenario)).toEqual([]);
    expect(scenario.units[0].key).toBe(key);
  });

  it('never reuses a key held by a structure', () => {
    const scenario = createIslandAssault();
    scenario.structures = [{ defId: 'barracks', owner: 0, x: 4, z: 4, key: 'rifle' }];
    scenario.units = [{ defId: 'rifle', owner: 0, x: 6, z: 6 }];
    const key = ensureEntityKey(scenario, scenario.units[0]);
    expect(key).not.toBe('rifle');
    expect(scenarioEntityKeyIssues(scenario)).toEqual([]);
  });

  it('describes a known placement with its type and owner', () => {
    const { scenario } = fixture();
    const key = scenario.structures.find((entry) => entry.key)!.key!;
    const info = describeEntityReference(scenario, key);
    expect(info.found).toBe(true);
    expect(info.detail).toContain('tile');
    expect(authoredEntities(scenario).find((entry) => entry.key === key)?.owner).toBe(
      scenario.structures.find((entry) => entry.key === key)?.owner,
    );
  });

  it('reports a missing reference without substituting another placement', () => {
    const { scenario } = fixture();
    const info = describeEntityReference(scenario, 'ghost-hq');
    expect(info.found).toBe(false);
    expect(info.label).toBe('ghost-hq');
    expect(info.detail).toMatch(/not placed/i);
  });

  it('flags duplicate and malformed authored keys on the map', () => {
    const scenario = createIslandAssault();
    scenario.structures = [
      { defId: 'barracks', owner: 0, x: 4, z: 4, key: 'shared' },
      { defId: 'barracks', owner: 1, x: 20, z: 20, key: 'shared' },
      { defId: 'factory', owner: 0, x: 12, z: 12, key: 'not valid!' },
    ];
    const issues = scenarioEntityKeyIssues(scenario);
    expect(issues.map((issue) => issue.code)).toEqual(['scenario-key-duplicate', 'scenario-key-invalid']);
    expect(issues.every((issue) => issue.severity === 'error')).toBe(true);
    expect(issues[0].path).toBe('scenario.structures[1].key');
  });

  it('merges scenario key problems into the authoring diagnostics', () => {
    const { scenario, mission } = fixture();
    scenario.units.push({ defId: 'rifle', owner: 0, x: 3, z: 3, key: 'own-hq' });
    const issues = authoringIssues(mission, scenario);
    expect(issues.some((issue) => issue.code === 'scenario-key-duplicate')).toBe(true);
  });
});

describe('objective relationships', () => {
  function threeObjectives(): MissionDoc {
    const { mission } = fixture();
    mission.objectives = [
      { id: 'root', title: 'Root', kind: 'primary', dependsOn: [] },
      { id: 'middle', title: 'Middle', kind: 'secondary', dependsOn: ['root'] },
      { id: 'leaf', title: 'Leaf', kind: 'bonus', dependsOn: ['middle'] },
    ];
    mission.triggers = [];
    return mission;
  }

  it('lists dependents by title', () => {
    const doc = threeObjectives();
    expect(objectiveDependents(doc, 'root').map((entry) => entry.title)).toEqual(['Middle']);
    expect(objectiveDependents(doc, 'leaf')).toEqual([]);
  });

  it('refuses self and cyclic dependencies', () => {
    const doc = threeObjectives();
    expect(wouldCreateDependencyCycle(doc, 'root', 'root')).toBe(true);
    // root ← middle ← leaf: making root depend on leaf closes the loop.
    expect(wouldCreateDependencyCycle(doc, 'root', 'leaf')).toBe(true);
    expect(wouldCreateDependencyCycle(doc, 'root', 'middle')).toBe(true);
    // A sibling edge that does not close a loop is allowed.
    expect(wouldCreateDependencyCycle(doc, 'leaf', 'root')).toBe(false);
  });

  it('reads prerequisite chains by id', () => {
    const doc = threeObjectives();
    expect(dependencyChain(doc, 'leaf')).toEqual([['leaf', 'middle', 'root']]);
  });

  it('keeps a broken prerequisite visible in the chain', () => {
    const doc = threeObjectives();
    doc.objectives[2].dependsOn = ['missing'];
    expect(dependencyChain(doc, 'leaf')).toEqual([['leaf', 'missing']]);
  });
});

describe('authoring diagnostics', () => {
  it('warns when nothing can complete an objective', () => {
    const { scenario, mission } = fixture();
    mission.triggers = [];
    const issues = validateMission(mission, contextFor(scenario));
    expect(issues.filter((issue) => issue.code === 'objective-no-completion')).toHaveLength(
      mission.objectives.length,
    );
    expect(issues.find((issue) => issue.code === 'objective-no-completion')?.severity).toBe('warning');
  });

  it('stays quiet when a trigger completes the objective', () => {
    const { scenario, mission } = fixture();
    expect(codes(mission, scenario)).not.toContain('objective-no-completion');
  });

  it('warns about a region nothing observes', () => {
    const { scenario, mission } = fixture();
    mission.regions = [{ id: 'unused-zone', x: 2, z: 2, width: 3, height: 3 }];
    const issues = validateMission(mission, contextFor(scenario));
    const unused = issues.find((issue) => issue.code === 'region-unused');
    expect(unused?.severity).toBe('warning');
    expect(unused?.path).toBe('regions[0]');
  });

  it('does not warn once a condition reads the region', () => {
    const { scenario, mission } = fixture();
    mission.regions = [{ id: 'used-zone', x: 2, z: 2, width: 3, height: 3 }];
    mission.triggers.push({
      id: 'zone-held',
      once: true,
      conditions: [{ kind: 'regionOccupied', region: 'used-zone', team: 0, atLeast: 2 }],
      actions: [{ kind: 'message', text: 'Zone held.' }],
    });
    expect(codes(mission, scenario)).not.toContain('region-unused');
  });

  it('warns when an action completes an objective that never becomes active', () => {
    const { scenario, mission } = fixture();
    mission.objectives = [
      { id: 'root', title: 'Root', kind: 'primary', dependsOn: [] },
      { id: 'gated', title: 'Gated', kind: 'secondary', dependsOn: [], initialState: 'hidden' },
    ];
    mission.triggers = [
      {
        id: 'complete-gated',
        once: true,
        conditions: [{ kind: 'elapsed', seconds: 10 }],
        actions: [{ kind: 'setObjective', objective: 'gated', state: 'complete' }],
      },
    ];
    const issues = validateMission(mission, contextFor(scenario));
    expect(issues.some((issue) => issue.code === 'action-objective-never-active')).toBe(true);
  });

  it('accepts the same action once something activates the objective', () => {
    const { scenario, mission } = fixture();
    mission.objectives = [
      { id: 'root', title: 'Root', kind: 'primary', dependsOn: [] },
      { id: 'gated', title: 'Gated', kind: 'secondary', dependsOn: [], initialState: 'hidden' },
    ];
    mission.triggers = [
      {
        id: 'open-gated',
        once: true,
        conditions: [{ kind: 'elapsed', seconds: 5 }],
        actions: [{ kind: 'setObjective', objective: 'gated', state: 'active' }],
      },
      {
        id: 'complete-gated',
        once: true,
        conditions: [{ kind: 'objective', objective: 'gated', state: 'active' }],
        actions: [{ kind: 'setObjective', objective: 'gated', state: 'complete' }],
      },
    ];
    const issues = validateMission(mission, contextFor(scenario));
    expect(issues.some((issue) => issue.code === 'action-objective-never-active')).toBe(false);
  });

  it('reports an unreferenced declared entity as information only', () => {
    const { scenario, mission } = fixture();
    // A real placed asset with a key, declared in the mission but named by no
    // objective, condition, camera or carryover entry.
    scenario.units.push({ defId: 'rifle', owner: 0, x: 5, z: 5, key: 'watch-post' });
    mission.entities.push({ key: 'watch-post', name: 'Watch post', role: 'asset' });
    const issues = validateMission(mission, contextFor(scenario));
    const info = issues.find((issue) => issue.code === 'entity-unreferenced');
    expect(info?.severity).toBe('info');
    expect(info?.path).toBe(`entities[${mission.entities.length - 1}]`);
  });

  it('warnings never block a document from parsing', () => {
    const { scenario, mission } = fixture();
    mission.triggers = [];
    mission.regions = [{ id: 'unused-zone', x: 1, z: 1, width: 2, height: 2 }];
    const issues = validateMission(mission, contextFor(scenario));
    expect(issues.some((issue) => issue.severity === 'warning')).toBe(true);
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false);
    expect(() => parseMission(JSON.parse(JSON.stringify(mission)), contextFor(scenario))).not.toThrow();
  });

  it('still reports broken references as errors', () => {
    const { scenario, mission } = fixture();
    mission.objectives[0].protectedEntities = ['nowhere'];
    mission.triggers.push({
      id: 'broken',
      once: true,
      conditions: [{ kind: 'regionOccupied', region: 'ghost-region', team: 0, atLeast: 1 }],
      actions: [{ kind: 'message', text: 'x' }],
    });
    mission.cinematics.push({
      id: 'broken-camera',
      kind: 'opening',
      skippable: true,
      steps: [{ kind: 'camera', target: { kind: 'entity', entity: 'ghost-unit' }, durationSeconds: 0 }],
      dialogue: [],
    });
    const issues = validateMission(mission, contextFor(scenario));
    const errors = issues.filter((issue) => issue.severity === 'error');
    expect(errors.some((issue) => issue.code === 'entity-ref-missing' && issue.path.startsWith('objectives'))).toBe(true);
    expect(errors.some((issue) => issue.code === 'entity-ref-missing' && issue.path.startsWith('cinematics'))).toBe(true);
    expect(errors.map((issue) => issue.code)).toContain('condition-region-missing');
    // A camera-only scene is a design warning, not a blocking error.
    expect(issues.find((issue) => issue.code === 'cinematic-no-dialogue')?.severity).toBe('warning');
  });

  it('keeps existing duplicate-id errors', () => {
    const { scenario, mission } = fixture();
    mission.objectives.push({ ...mission.objectives[0] });
    const issues = validateMission(mission, contextFor(scenario));
    expect(issues.some((issue) => issue.code === 'duplicate-id' && issue.severity === 'error')).toBe(true);
  });
});

describe('diagnostic navigation', () => {
  it('routes each document path to its section and item', () => {
    const { mission } = fixture();
    expect(focusForPath('objectives[1].dependsOn[0]', mission)).toMatchObject({
      section: 'objectives',
      objectiveIndex: 1,
    });
    expect(focusForPath('triggers[2].actions[0].objective', mission)).toMatchObject({
      section: 'triggers',
      triggerIndex: 2,
    });
    expect(focusForPath('regions[0]', mission)).toMatchObject({ section: 'regions', regionIndex: 0 });
    expect(focusForPath('cinematics[1].steps[0]', mission)).toMatchObject({
      section: 'cinematics',
      cinematicIndex: 1,
    });
    expect(focusForPath('briefing.summary', mission).section).toBe('briefing');
    expect(focusForPath('variables[0].default', mission).section).toBe('variables');
    expect(focusForPath('scenario.units[3].key', mission).section).toBe('regions');
  });

  it('carries the authored placement a reference names', () => {
    const { scenario, mission } = fixture();
    const key = scenario.structures.find((entry) => entry.key)!.key!;
    mission.objectives[0].protectedEntities = [key];
    expect(focusForPath('objectives[0].protectedEntities[0]', mission).entityKey).toBe(key);
    mission.triggers[0].conditions = [{ kind: 'entityAlive', entity: key }];
    expect(focusForPath('triggers[0].conditions[0].entity', mission).entityKey).toBe(key);
    mission.cinematics.push({
      id: 'shot',
      kind: 'opening',
      skippable: true,
      steps: [{ kind: 'camera', target: { kind: 'entity', entity: key }, durationSeconds: 0 }],
      dialogue: [],
    });
    expect(focusForPath('cinematics[0].steps[0].target.entity', mission).entityKey).toBe(key);
  });

  it('carries the region a condition names', () => {
    const { mission } = fixture();
    mission.regions = [{ id: 'zone-a', x: 1, z: 1, width: 2, height: 2 }];
    mission.triggers[0].conditions = [{ kind: 'regionOccupied', region: 'zone-a', team: 0, atLeast: 1 }];
    expect(focusForPath('triggers[0].conditions[0].region', mission)).toMatchObject({
      section: 'triggers',
      regionId: 'zone-a',
      regionIndex: 0,
    });
  });

  it('resolves a region id that no longer exists without inventing an index', () => {
    const { mission } = fixture();
    mission.triggers[0].conditions = [{ kind: 'regionOccupied', region: 'gone', team: 0, atLeast: 1 }];
    const focus = focusForPath('triggers[0].conditions[0].region', mission);
    expect(focus.regionId).toBe('gone');
    expect(focus.regionIndex).toBeUndefined();
  });
});

describe('scene placements stay untouched by region maths', () => {
  it('does not move structures or units while regions are edited', () => {
    const { scenario, mission } = fixture();
    const structures = JSON.stringify(scenario.structures);
    const units = JSON.stringify(scenario.units);
    mission.regions.push({ id: 'zone', x: 3, z: 3, width: 4, height: 4 });
    const rect = rectOfRegion(mission.regions[0]);
    applyRect(mission.regions[0], moveRegion(rect, 4, 4, { width: scenario.width, height: scenario.height }));
    expect(JSON.stringify(scenario.structures)).toBe(structures);
    expect(JSON.stringify(scenario.units)).toBe(units);
  });

  it('keeps the edited region authoritative after a JSON round-trip', () => {
    const { scenario, mission } = fixture();
    mission.regions.push({ id: 'zone', x: 3, z: 3, width: 4, height: 4 });
    applyRect(mission.regions[0], { x: 9, z: 11, width: 2, height: 6 });
    const parsed = parseMission(JSON.parse(JSON.stringify(mission)), contextFor(scenario));
    expect(parsed.regions[0]).toMatchObject({ id: 'zone', x: 9, z: 11, width: 2, height: 6 });
  });
});

// Keep the building registry import meaningful: keys derive from def ids, and a
// renamed def would silently change generated keys without this assertion.
if (!BUILDINGS.barracks) throw new Error('barracks definition missing');
