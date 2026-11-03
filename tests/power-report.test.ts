import { describe, expect, it } from 'vitest';
import { gridReport, powerBreakdownLines } from '../src/ui/powerReport';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';

describe('power report grouping', () => {
  it('groups repeated structures and sorts the biggest draw first', () => {
    const report = gridReport([
      { defId: 'commandPost', hp: 3300 },
      { defId: 'barracks', hp: 1350 },
      { defId: 'barracks', hp: 1350 },
      { defId: 'factory', hp: 1800 },
      { defId: 'powerPlant', hp: 1200 },
    ]);
    expect(report.consumers.map((line) => [line.id, line.count, line.total])).toEqual([
      ['barracks', 2, -16],
      ['factory', 1, -15],
    ]);
    expect(report.sources.map((line) => [line.id, line.count, line.total])).toEqual([
      ['powerPlant', 1, 60],
      ['commandPost', 1, 50],
    ]);
    expect(report.supply).toBe(110);
    expect(report.demand).toBe(31);
    expect(report.brownout).toBe(false);
    expect(report.ratio).toBe(1);
  });

  it('ignores structures still being built, rubble and power-neutral definitions', () => {
    const report = gridReport([
      { defId: 'commandPost', hp: 3300 },
      { defId: 'barracks', hp: 1350, construction: true },
      { defId: 'factory', hp: 0 },
      { defId: 'relay', hp: 900 },
    ]);
    expect(report.consumers).toEqual([]);
    expect(report.demand).toBe(0);
    expect(report.supply).toBe(50);
  });

  it('reports a deficit as a brownout with the output ratio', () => {
    const report = gridReport([
      { defId: 'commandPost', hp: 3300 },
      { defId: 'factory', hp: 1800 },
      { defId: 'factory', hp: 1800 },
      { defId: 'factory', hp: 1800 },
      { defId: 'factory', hp: 1800 },
      { defId: 'samBattery', hp: 1200 },
      { defId: 'samBattery', hp: 1200 },
    ]);
    expect(report.demand).toBe(100);
    expect(report.brownout).toBe(true);
    expect(report.ratio).toBeCloseTo(0.5);
    const lines = powerBreakdownLines(report);
    expect(lines[0]).toContain('BROWNOUT');
    expect(lines[0]).toContain('50 supply / 100 demand');
    expect(lines[0]).toContain('50%');
  });

  it('lists the same totals the card chip will read', () => {
    const report = gridReport([{ defId: 'commandPost', hp: 3300 }]);
    const lines = powerBreakdownLines(report, { id: 'factory', name: 'Vehicle Factory', power: -15 });
    expect(lines[1]).toBe('Generators: Command Post +50');
    expect(lines[2]).toBe('Draw: no structures drawing');
    expect(lines[3]).toBe('Vehicle Factory: -15 → grid after build 50 supply / 15 demand');
  });
});

describe('power report against the simulation', () => {
  it('matches Game.powerStatus for the same base', () => {
    const scenario = createIslandAssault();
    scenario.structures.push(
      { defId: 'factory', owner: 0, x: 30, z: 34 },
      { defId: 'barracks', owner: 0, x: 20, z: 38 },
      { defId: 'powerPlant', owner: 0, x: 40, z: 30 },
    );
    const game = new Game(scenario, { enableAI: false });
    const report = gridReport(
      game.entitiesOf(0, 'building').map((e) => ({
        defId: e.defId,
        construction: e.construction,
        hp: e.hp,
      })),
    );
    const status = game.powerStatus(0);
    expect(report.supply).toBe(status.supply);
    expect(report.demand).toBe(status.demand);
    expect(report.brownout).toBe(status.brownout);
    expect(report.supply).toBe(110);
    expect(report.demand).toBe(-(BUILDINGS.factory.power! + BUILDINGS.barracks.power!));
  });
});
