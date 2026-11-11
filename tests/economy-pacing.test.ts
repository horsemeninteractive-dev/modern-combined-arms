/**
 * Phase 6C.3 / 6C.5 — economy and match pacing.
 *
 * Income, payback and pacing are measured on the authoritative simulation with
 * the AI running, because a resource rate on its own says nothing about whether
 * a match reaches its intended length.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS } from '../src/data/buildings';
import { UNITS } from '../src/data/units';
import { AIController, initialAIState } from '../src/sim/ai';
import { buildStructure, fund, incomeOver, siteFor, snapshot } from './economyBench';

function island(ai = false): Game {
  return new Game(createIslandAssault(), { enableAI: ai });
}

describe('economic baseline', () => {
  it('starts a skirmish on the authored bank', () => {
    const game = island();
    console.log('[econ]', JSON.stringify({
      kind: 'start',
      mats: game.player(0)!.mats,
      req: game.player(0)!.req,
      hqReqPerSec: game.reqRate(0),
      passiveMatsPerSec: game.passiveMatsRate(0),
    }));
    expect(game.player(0)!.mats).toBe(3000);
    expect(game.player(0)!.req).toBe(180);
    // The headquarters is the only requisition source at the opening.
    expect(game.reqRate(0)).toBe(0.4);
  });

  it('pays requisition from the structures that declare it', () => {
    const game = island();
    // Built for real through the same path a player uses, so the income line is
    // read from a completed, operational structure.
    buildStructure(game, 0, 'refinery', { site: siteFor(game, 0, 'refinery') });
    const before = game.reqRate(0);
    console.log('[econ]', JSON.stringify({
      kind: 'requisition',
      hqOnly: 0.4,
      withRefinery: before,
      refineryDeficit: BUILDINGS.refinery.reqPerSec,
    }));
    expect(before).toBeCloseTo(0.5, 5);
  });

  it('measures harvester income and payback on a real map', () => {
    // The island map carries ore but no starting economy: the fixture supplies a
    // hauler and a drop-off, then reads income the way the HUD would.
    const scenario = createIslandAssault();
    scenario.units.push({ defId: 'harvester', owner: 0, x: 26, z: 40 });
    const game = new Game(scenario, { enableAI: false });
    fund(game);
    buildStructure(game, 0, 'refinery', { site: siteFor(game, 0, 'refinery') });
    const start = game.player(0)!;
    const harvesters = game
      .entitiesOf(0, 'unit')
      .filter((e) => e.defId === 'harvester').length;
    const ore = game.state.scenario.tiles.filter((t) => (t.o ?? 0) > 0).length;
    const banked = incomeOver(game, 0, 180);
    const perMinute = Math.round((banked.mats / 3) * 10) / 10;
    // Payback in seconds: one hull's price over that hull's own share of the
    // measured income, converted from minutes.
    const payback = perMinute > 0
      ? Math.round(((UNITS.harvester.cost.mats / (perMinute / Math.max(1, harvesters))) * 60) * 10) / 10
      : null;
    console.log('[econ]', JSON.stringify({
      kind: 'harvester',
      harvesters,
      oreTiles: ore,
      matsIn180s: banked.mats,
      reqIn180s: banked.req,
      matsPerMinute: perMinute,
      harvesterCost: UNITS.harvester.cost.mats,
      paybackSecondsPerHull: payback,
      bankedAtEnd: Math.round(start.mats),
    }));
    expect(harvesters).toBeGreaterThan(0);
    expect(banked.mats).toBeGreaterThan(0);
  });
});

describe('match pacing', () => {
  it('records how a real skirmish spends its first fifteen minutes', () => {
    const game = island(true);
    const marks: Array<ReturnType<typeof snapshot>> = [];
    for (const seconds of [0, 120, 300, 600, 900]) {
      const elapsed = seconds - (marks.at(-1)?.seconds ?? 0);
      if (elapsed > 0) game.advance(elapsed);
      marks.push(snapshot(game, 0, seconds));
      marks.push(snapshot(game, 1, seconds));
    }
    const side = (owner: number) => marks.filter((m) => marks.indexOf(m) % 2 === owner);
    console.log('[econ]', JSON.stringify({
      kind: 'pacing',
      player0: side(0).map((m) => ({
        s: m.seconds,
        mats: m.mats,
        req: m.req,
        buildings: m.buildings,
        units: m.units,
        army: m.armyValue,
        supply: m.supply,
        demand: m.demand,
        brownout: m.brownout,
      })),
      player1: side(1).map((m) => ({
        s: m.seconds,
        mats: m.mats,
        req: m.req,
        buildings: m.buildings,
        units: m.units,
        army: m.armyValue,
        supply: m.supply,
        demand: m.demand,
        brownout: m.brownout,
      })),
      player1Structures: marks.filter((m) => marks.indexOf(m) % 2 === 1).at(-1)?.byDef,
    }));
    const last = snapshot(game, 1, 900);
    expect(last.buildings).toBeGreaterThan(1);
    expect(last.units).toBeGreaterThan(0);
    // An AI that never builds is an AI defect, not an economy finding.
    expect(Object.keys(last.byDef).length).toBeGreaterThan(2);
  });

  it('compares construction and spending across the three difficulties', () => {
    const rows = (['recruit', 'veteran', 'elite'] as const).map((difficulty) => {
      const game = island(false);
      const ai = new AIController();
      const state = initialAIState(7, difficulty);
      for (let i = 0; i < 20 * 600 && game.state.victory === 'playing'; i++) {
        game.tick();
        ai.update(game, 1, state);
      }
      const snap = snapshot(game, 1, 600);
      return {
        difficulty,
        victory: game.state.victory,
        buildings: snap.buildings,
        units: snap.units,
        army: snap.armyValue,
        mats: snap.mats,
        req: snap.req,
        supply: snap.supply,
        demand: snap.demand,
        brownout: snap.brownout,
        byDef: snap.byDef,
      };
    });
    console.log('[econ]', JSON.stringify({ kind: 'ai-difficulty-economy', rows }));
    // Every level has to run an economy, not just the top one.
    for (const row of rows) {
      expect(row.buildings, `${row.difficulty} buildings`).toBeGreaterThan(1);
      expect(row.units, `${row.difficulty} units`).toBeGreaterThan(0);
    }
    // Three ten-minute matches run through the full AI controller: a generous
    // budget so a loaded host measures the same thing instead of timing out.
  }, 300_000);
});
