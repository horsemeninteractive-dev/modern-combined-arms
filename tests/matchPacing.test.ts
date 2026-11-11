/**
 * Phase 6C.1 — completed competitive matches.
 *
 * Gated behind PACING_BENCH=1 so the fast suite does not pay for it. Run with:
 *   PACING_BENCH=1 npx vitest run tests/matchPacing.test.ts
 *
 * Matches run to the scenario's own victory condition. Nothing forces a winner,
 * shortens the clock or terminates a match early; a match that reaches the
 * limit is reported as stalled rather than as a completed 40-minute game.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createOpenFront, createWoodlandDivide } from '../src/data/competitiveMaps';
import { AIController, initialAIState } from '../src/sim/ai';
import type { Scenario } from '../src/sim/scenario';

// The project does not ship Node typings, so the one environment read this
// benchmark needs is declared locally rather than pulling in @types/node.
declare const process: { env: Record<string, string | undefined> };

const RUN = process.env.PACING_BENCH === '1';
const LIMIT_SECONDS = 2400;

interface Side {
  mats: number;
  req: number;
  structures: number;
  refineries: number;
  factories: number;
  harvesters: number;
  army: number;
  supply: number;
  demand: number;
}

function side(game: Game, owner: number): Side {
  let structures = 0;
  let refineries = 0;
  let factories = 0;
  let harvesters = 0;
  let army = 0;
  for (const e of game.state.entities) {
    if (e.owner !== owner || e.hp <= 0) continue;
    if (e.kind === 'building') {
      structures++;
      if (e.defId === 'refinery') refineries++;
      if (e.defId === 'factory' || e.defId === 'armourWorks') factories++;
    } else {
      if (e.defId === 'harvester') harvesters++;
      else army += 100;
    }
  }
  const power = game.powerStatus(owner);
  return {
    mats: Math.round(game.player(owner)?.mats ?? 0),
    req: Math.round(game.player(owner)?.req ?? 0),
    structures,
    refineries,
    factories,
    harvesters,
    army,
    supply: power.supply,
    demand: power.demand,
  };
}

function play(
  name: string,
  scenario: Scenario,
  seed: number,
  west: 'recruit' | 'veteran' | 'elite',
  east: 'recruit' | 'veteran' | 'elite',
): Record<string, unknown> {
  scenario.settings.seed = seed;
  const game = new Game(scenario, { enableAI: false });
  const a = new AIController();
  const b = new AIController();
  const sa = initialAIState(seed, west);
  const sb = initialAIState(seed, east);
  let firstShot: number | null = null;
  let firstExpansion: number | null = null;
  let firstMajorLoss: number | null = null;
  const banks: Array<{ s: number; p0: number; p1: number }> = [];
  const startStructures = game.state.entities.filter((e) => e.kind === 'building').length;

  for (let i = 0; i < 20 * LIMIT_SECONDS && game.state.victory === 'playing'; i++) {
    game.tick();
    a.update(game, 0, sa);
    b.update(game, 1, sb);
    const t = i / 20;
    if (firstShot === null && game.state.events.some((e) => e.type === 'shot')) firstShot = t;
    if (firstExpansion === null) {
      const refineries = game.state.entities.filter(
        (e) => e.kind === 'building' && e.defId === 'refinery' && e.hp > 0,
      ).length;
      if (refineries > 2) firstExpansion = t;
    }
    if (firstMajorLoss === null && startStructures > 0) {
      const standing = game.state.entities.filter(
        (e) => e.kind === 'building' && e.hp > 0,
      ).length;
      if (standing < startStructures) firstMajorLoss = t;
    }
    if (i % 1200 === 0) {
      banks.push({ s: Math.round(t), p0: Math.round(game.player(0)?.mats ?? 0), p1: Math.round(game.player(1)?.mats ?? 0) });
    }
  }

  return {
    map: name,
    seed,
    west,
    east,
    victory: game.state.victory,
    seconds: Math.round(game.state.tick / 20),
    firstShotSeconds: firstShot,
    firstExpansionSeconds: firstExpansion,
    firstStructureLossSeconds: firstMajorLoss,
    westSide: side(game, 0),
    eastSide: side(game, 1),
    banks,
  };
}

describe.skipIf(!RUN)('competitive match pacing', () => {
  it('runs complete matches to their own victory condition', () => {
    const matches = [
      play('openFront', createOpenFront(), 11, 'veteran', 'veteran'),
      play('openFront', createOpenFront(), 23, 'elite', 'veteran'),
      play('woodlandDivide', createWoodlandDivide(), 11, 'veteran', 'elite'),
      play('woodlandDivide', createWoodlandDivide(), 23, 'recruit', 'veteran'),
    ];
    console.log('[pace]', JSON.stringify({ kind: 'matches', matches }));
    expect(matches).toHaveLength(4);
    for (const match of matches) {
      // A match either resolved or hit the ceiling; both are recorded, neither
      // is silently relabelled.
      expect(['playing', 'victory', 'defeat', 'draw', 'stalemate']).toContain(
        match.victory as string,
      );
      expect(match.seconds as number).toBeGreaterThan(0);
    }
  }, 1_800_000);
});
