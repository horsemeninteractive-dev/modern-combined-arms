import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';
import { gridAlertCopy } from '../src/ui/hudLayout';

type Extra = { defId: string; x: number; z: number; owner?: number };

/**
 * Consumers authored as fixtures. The battle starts with a command post only
 * (80 supply, no draw), so extra structures are pushed into the scenario rather
 * than mocked.
 */
const CONSUMERS: Extra[] = [
  { defId: 'factory', x: 30, z: 34 },
  { defId: 'samBattery', x: 30, z: 40 },
  { defId: 'airfield', x: 34, z: 26 },
  { defId: 'refinery', x: 34, z: 36 },
  { defId: 'factory', x: 38, z: 40 },
];
const BARRACKS: Extra = { defId: 'barracks', x: 20, z: 38 };

function gameWith(extra: Extra[] = [], ai = false) {
  const scenario = createIslandAssault();
  for (const s of extra) {
    scenario.structures.push({ defId: s.defId, owner: s.owner ?? 0, x: s.x, z: s.z });
  }
  return new Game(scenario, { enableAI: ai });
}

/** Park the player's engineer beside a site so work starts without a drive. */
function engineerAt(game: Game, x: number, z: number) {
  const engineer = game.entitiesOf(0, 'unit').find((e) => e.defId === 'engineer')!;
  engineer.x = x;
  engineer.z = z;
  return engineer;
}

describe('base power grid', () => {
  it('derives supply and demand from completed structures', () => {
    const game = gameWith();
    expect(game.powerStatus(0)).toEqual({ supply: 80, demand: 0, ratio: 1, brownout: false });
    expect(game.powerSpeed(0)).toBe(1);
    expect(game.powerStatus(1)).toEqual({ supply: 80, demand: 0, ratio: 1, brownout: false });
  });

  it('matches the structure definitions rather than a hard-coded table', () => {
    const game = gameWith([...CONSUMERS, BARRACKS]);
    const draw = game
      .entitiesOf(0, 'building')
      .reduce((sum, e) => sum - Math.min(0, BUILDINGS[e.defId]?.power ?? 0), 0);
    expect(draw).toBe(93);
    expect(game.powerStatus(0).demand).toBe(draw);
  });

  it('flags a deficit once demand exceeds supply and scales speed by the ratio', () => {
    const game = gameWith([...CONSUMERS, BARRACKS]);
    const power = game.powerStatus(0);
    expect(power.supply).toBe(80);
    expect(power.demand).toBe(93);
    expect(power.brownout).toBe(true);
    expect(power.ratio).toBeCloseTo(80 / 93, 6);
    expect(game.powerSpeed(0)).toBeCloseTo(80 / 93, 6);
  });

  it('restores full speed with a turbine plant and leaves headroom', () => {
    const game = gameWith([...CONSUMERS, BARRACKS, { defId: 'powerPlant', x: 44, z: 34 }]);
    const power = game.powerStatus(0);
    expect(power.supply).toBe(180);
    expect(power.demand).toBe(93);
    expect(power.brownout).toBe(false);
    expect(game.powerSpeed(0)).toBe(1);
  });

  it('does not count construction sites or destroyed structures', () => {
    const game = gameWith([{ defId: 'powerPlant', x: 22, z: 32 }]);
    const plant = game.entitiesOf(0, 'building').find((e) => e.defId === 'powerPlant')!;
    plant.construction = true;
    expect(game.powerStatus(0).supply).toBe(80);
    plant.construction = false;
    expect(game.powerStatus(0).supply).toBe(180);
    plant.hp = 0;
    expect(game.powerStatus(0).supply).toBe(80);
    expect(game.powerStatus(0).demand).toBe(0);
  });

  it('never stalls below the 35% brownout floor', () => {
    const scenario = createIslandAssault();
    scenario.structures = scenario.structures.filter(
      (s) => !(s.owner === 0 && s.defId === 'commandPost'),
    );
    for (const s of CONSUMERS) scenario.structures.push({ defId: s.defId, owner: 0, x: s.x, z: s.z });
    const game = new Game(scenario, { enableAI: false });
    const power = game.powerStatus(0);
    expect(power.supply).toBe(0);
    expect(power.demand).toBe(85);
    expect(power.ratio).toBe(0);
    expect(game.powerSpeed(0)).toBe(0.35);
  });
});

describe('brownout effects', () => {
  it('slows unit production by the grid ratio', () => {
    const balanced = gameWith([BARRACKS]);
    const stressed = gameWith([...CONSUMERS, BARRACKS]);
    const ratio = stressed.powerStatus(0).ratio;
    expect(ratio).toBeLessThan(1);

    for (const game of [balanced, stressed]) {
      const barracks = game.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
      game.enqueueCommand({ type: 'produce', team: 0, buildingId: barracks.id, defId: 'rifle' });
    }
    balanced.tick();
    stressed.tick();
    const balancedBarracks = balanced.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
    const stressedBarracks = stressed.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
    const startBalanced = balancedBarracks.queue[0].remaining;
    const startStressed = stressedBarracks.queue[0].remaining;
    expect(startStressed).toBeGreaterThan(startBalanced);

    balanced.advance(40);
    stressed.advance(40);
    const elapsedBalanced = startBalanced - balancedBarracks.queue[0].remaining;
    const elapsedStressed = startStressed - stressedBarracks.queue[0].remaining;
    expect(elapsedBalanced).toBeCloseTo(2, 5);
    expect(elapsedStressed).toBeCloseTo(2 * ratio, 4);
    expect(elapsedStressed).toBeLessThan(elapsedBalanced);
  });

  it('slows construction of a building site by the grid ratio', () => {
    const balanced = gameWith([BARRACKS]);
    const stressed = gameWith([...CONSUMERS, BARRACKS]);
    for (const game of [balanced, stressed]) {
      const barracks = game.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
      barracks.construction = true;
      barracks.buildProgress = 0;
      barracks.hp = Math.round(barracks.maxHp * 0.2);
      barracks.state = 'constructing';
    }
    // The site itself does not draw, so the ratio is read after that.
    const ratio = stressed.powerStatus(0).ratio;
    expect(ratio).toBeCloseTo(80 / 85, 6);

    balanced.advance(60);
    stressed.advance(60);
    const balancedBarracks = balanced.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
    const stressedBarracks = stressed.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
    expect(balancedBarracks.buildProgress).toBeGreaterThan(0);
    expect(balancedBarracks.buildProgress).toBeLessThan(1);
    expect(stressedBarracks.buildProgress).toBeCloseTo(
      balancedBarracks.buildProgress * ratio,
      4,
    );
  });

  it('pauses construction when the engineer is called away', () => {
    const game = gameWith([BARRACKS]);
    const barracks = game.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
    barracks.construction = true;
    barracks.buildProgress = 0;
    barracks.hp = Math.round(barracks.maxHp * 0.2);
    barracks.state = 'constructing';
    game.advance(40);
    const engineer = game.entitiesOf(0, 'unit').find((e) => e.defId === 'engineer')!;
    expect(engineer.buildTargetId).toBe(barracks.id);
    expect(barracks.buildProgress).toBeGreaterThan(0);
    const progress = barracks.buildProgress;

    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [engineer.id],
      x: 30 * 4,
      z: 44 * 4,
    });
    game.tick();
    expect(engineer.buildTargetId).toBe(0);
    game.advance(40);
    expect(barracks.buildProgress).toBeCloseTo(progress, 6);

    // Once the errand is done the engineer is idle again and walks back on its
    // own, so the site resumes rather than staying abandoned.
    game.advance(400);
    expect(barracks.buildProgress).toBeGreaterThan(progress);
  });

  it('returns to full speed once a turbine plant finishes', () => {
    const game = gameWith([...CONSUMERS, BARRACKS, { defId: 'powerPlant', x: 22, z: 32 }]);
    const site = game.entitiesOf(0, 'building').find((e) => e.defId === 'powerPlant')!;
    site.construction = true;
    site.buildProgress = 0.97;
    site.hp = Math.round(site.maxHp * 0.2);
    site.state = 'constructing';
    engineerAt(game, 22 * 4, 36 * 4);
    expect(game.powerStatus(0).brownout).toBe(true);
    expect(game.powerSpeed(0)).toBeLessThan(1);
    game.advance(30);
    expect(site.construction).toBe(false);
    expect(game.powerStatus(0).brownout).toBe(false);
    expect(game.powerSpeed(0)).toBe(1);
  });

  it('warns once on entering a brownout and once on recovery', () => {
    const game = gameWith([...CONSUMERS, BARRACKS]);
    const gridNotices = () =>
      game.state.events.filter((e) => e.team === 0 && /Grid (deficit|balanced)/.test(e.text));

    game.advance(40);
    const entered = gridNotices();
    expect(entered).toHaveLength(1);
    expect(entered[0].level).toBe('warning');
    expect(entered[0].text).toMatch(/80 supply for 93 demand/);
    expect(entered[0].text).toMatch(/86%/);

    game.advance(60);
    expect(gridNotices()).toHaveLength(1);

    // Completing a plant clears the notice and announces the recovery.
    const scenarioPlant = gameWith([
      ...CONSUMERS,
      BARRACKS,
      { defId: 'powerPlant', x: 22, z: 32 },
    ]);
    const site = scenarioPlant.entitiesOf(0, 'building').find((e) => e.defId === 'powerPlant')!;
    site.construction = true;
    site.buildProgress = 0.97;
    site.hp = Math.round(site.maxHp * 0.2);
    site.state = 'constructing';
    engineerAt(scenarioPlant, 22 * 4, 36 * 4);
    scenarioPlant.tick();
    const notices = () =>
      scenarioPlant.state.events.filter((e) => /Grid (deficit|balanced)/.test(e.text));
    expect(notices().map((e) => e.level)).toEqual(['warning']);
    scenarioPlant.advance(60);
    expect(notices().map((e) => e.level)).toEqual(['warning', 'success']);
    expect(notices()[1].text).toMatch(/full speed/);
    scenarioPlant.advance(40);
    expect(notices()).toHaveLength(2);
  });

  it('writes a production alert only while the grid is short', () => {
    const balanced = gameWith();
    expect(gridAlertCopy(balanced.powerStatus(0))).toBeNull();
    const copy = gridAlertCopy(gameWith([...CONSUMERS, BARRACKS]).powerStatus(0));
    expect(copy).toContain('GRID DEFICIT');
    expect(copy).toContain('80 SUPPLY / 93 DEMAND');
    expect(copy).toContain('PRODUCTION AT 86%');
  });

  it('builds turbine plants on a deficit instead of waiting', () => {
    const extras: Extra[] = [...CONSUMERS, BARRACKS, { defId: 'factory', x: 44, z: 34, owner: 1 }].map(
      (s) => ({ ...s, owner: 1 }),
    );
    const game = gameWith(extras, true);
    expect(game.powerStatus(1).brownout).toBe(true);
    game.advance(20 * 120);
    const plants = game.entitiesOf(1, 'building').filter((e) => e.defId === 'powerPlant');
    expect(plants.length).toBeGreaterThan(0);
    expect(game.powerStatus(1).brownout).toBe(false);
  });
});
