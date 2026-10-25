import { describe, expect, it } from 'vitest';
import {
  canLaunch,
  checkPlacement,
  parseScenario,
  reachableFrom,
  scenarioToJson,
  validateScenario,
  type Scenario,
} from '../src/sim/scenario';
import { createIslandAssault } from '../src/data/scenarios';
import { tileIndex, Terrain } from '../src/sim/terrain';
import { buildingDef } from '../src/data/buildings';
import { createEmptyScenario } from '../src/data/scenarios';

describe('Island Assault scenario', () => {
  it('passes validation without fatal errors', () => {
    const scenario = createIslandAssault();
    const issues = validateScenario(scenario);
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length) console.log(errors);
    expect(errors).toEqual([]);
    expect(canLaunch(scenario)).toBe(true);
  });

  it('round-trips through JSON without changing gameplay data', () => {
    const scenario = createIslandAssault();
    const parsed = parseScenario(JSON.parse(scenarioToJson(scenario)));
    expect(parsed.width).toBe(scenario.width);
    expect(parsed.height).toBe(scenario.height);
    expect(parsed.tiles.length).toBe(scenario.tiles.length);
    expect(parsed.players).toEqual(scenario.players);
    expect(parsed.structures).toEqual(scenario.structures);
    expect(parsed.units).toEqual(scenario.units);
    expect(parsed.settings).toEqual(scenario.settings);
    expect(validateScenario(parsed).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('has a navigable route from the player port to the eastern bay', () => {
    const scenario = createIslandAssault();
    // Naval starts are fixtures: the landing force arrives without a navy.
    const start = { x: 9, z: 42 };
    const reach = reachableFrom(scenario, [start], 'naval');
    expect(reach[tileIndex(scenario.width, 66, 48)]).toBe(1);
  });

  it('has a ground route between the opposing starts through the ridge pass', () => {
    const scenario = createIslandAssault();
    const blue = scenario.players[0];
    const red = scenario.players[1];
    const reach = reachableFrom(scenario, [{ x: blue.startX, z: blue.startZ }], 'tracked');
    expect(reach[tileIndex(scenario.width, red.startX, red.startZ)]).toBe(1);
  });

  it('keeps hostile starts out of each other’s initial vision', () => {
    const scenario = createIslandAssault();
    const blue = scenario.players[0];
    const red = scenario.players[1];
    expect(Math.hypot(blue.startX - red.startX, blue.startZ - red.startZ)).toBeGreaterThan(25);
  });

  it('rejects a missing Command Post and a shipyard without water', () => {
    const scenario = createIslandAssault();
    scenario.structures = scenario.structures.filter(
      (s) => !(s.owner === 1 && s.defId === 'commandPost'),
    );
    const issues = validateScenario(scenario);
    expect(issues.some((i) => i.code === 'hq-missing' && i.severity === 'error')).toBe(true);

    const noWater = createEmptyScenario(32, 32);
    noWater.structures.push({ defId: 'shipyard', owner: 0, x: 4, z: 4 });
    const issues2 = validateScenario(noWater);
    expect(issues2.some((i) => i.code === 'shipyard-water' && i.severity === 'error')).toBe(true);
  });
});

describe('scenario format safety', () => {
  it('rejects bad versions with an actionable message', () => {
    const scenario = createIslandAssault();
    const raw = JSON.parse(scenarioToJson(scenario));
    raw.version = 99;
    expect(() => parseScenario(raw)).toThrow(/Unsupported scenario version/);
  });

  it('rejects mismatched tile counts', () => {
    const scenario = createIslandAssault();
    const raw = JSON.parse(scenarioToJson(scenario));
    raw.tiles.pop();
    expect(() => parseScenario(raw)).toThrow(/tile entries/);
  });

  it('does not allow a building footprint on water or slopes', () => {
    const scenario = createIslandAssault();
    const water = checkPlacement(scenario, 'barracks', 0, 0);
    expect(water.ok).toBe(false);
    const slope = checkPlacement(scenario, 'barracks', 47, 28);
    expect(slope.ok).toBe(false);
    const ridge = checkPlacement(scenario, 'barracks', 52, 30);
    expect(ridge.ok).toBe(false);
  });

  it('accepts a barracks on the player’s open ground', () => {
    const scenario = createIslandAssault();
    const result = checkPlacement(scenario, 'barracks', 25, 30);
    expect(result.ok, result.reason).toBe(true);
  });
});

describe('validation coverage', () => {
  it('flags ore that cannot be reached from any refinery', () => {
    const scenario: Scenario = createIslandAssault();
    for (const t of scenario.tiles) t.o = 0;
    // A single pocket of ore on an isolated ridge tile.
    const i = tileIndex(scenario.width, 53, 30);
    scenario.tiles[i] = { t: Terrain.Rock, e: 3, o: 500 };
    const issues = validateScenario(scenario);
    expect(issues.some((i2) => i2.code === 'ore-unreachable')).toBe(true);
  });

  it('identifies an unreachable player start', () => {
    const scenario = createIslandAssault();
    // Move the AI start onto an isolated ridge tile.
    scenario.players[1].startX = 53;
    scenario.players[1].startZ = 30;
    const issues = validateScenario(scenario);
    expect(
      issues.some((i) => i.code === 'starts-not-connected' || i.code === 'start-obstructed'),
    ).toBe(true);
  });

  it('defines build footprints consistently for every structure', () => {
    const scenario = createIslandAssault();
    for (const s of scenario.structures) {
      const def = buildingDef(s.defId);
      expect(def.footprint.w).toBeGreaterThan(0);
      expect(def.footprint.h).toBeGreaterThan(0);
    }
  });
});
