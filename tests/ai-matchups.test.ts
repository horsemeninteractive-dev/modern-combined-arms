import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';
import type { AIDifficulty } from '../src/sim/types';
import { UNITS } from '../src/data/units';
import { BUILDINGS } from '../src/data/buildings';

/**
 * Materials per authored ore tile on the matchup arena. The shipped maps use
 * 260-340 per tile, which is one harvester load: a match there burns through
 * every deposit in about three minutes, after which both commanders can only
 * spend their bank and every level plays the same. The ladder therefore uses a
 * deep field so a match is limited by how fast an economy can mine, not by how
 * much ore is left standing.
 *
 * This number has to stay deep. Harvesters now reach every deposit on a field
 * (unreachable seams are rerouted rather than abandoned), so a shallow field is
 * exhausted sooner than it used to be, and once both sides are sitting on an
 * empty map their economies converge and every skill margin collapses toward a
 * coin flip. At 3600 per tile the field outlasts the 600-second limit and the
 * measured margins are stable.
 */
const ARENA_ORE = 3600;

/** Eight seeds x both sides = sixteen matches per pairing. */
const SEEDS = [101, 1078, 2055, 3032, 4009, 4986, 5963, 6940];

/**
 * A deliberately symmetric 64x64 arena for commander matchups. The authored
 * island is asymmetric, so a single match cannot separate side bias from
 * difficulty. Every pairing is therefore played with each level on each side;
 * the mirrored pair cancels the map's west-side advantage from the aggregate.
 */
function matchupScenario() {
  const scenario = createEmptyScenario(64, 64);
  scenario.meta.name = 'AI Matchup';
  scenario.settings.startingMats = 3000;
  scenario.settings.startingReq = 180;
  scenario.players[0].startX = 18;
  scenario.players[0].startZ = 37;
  scenario.players[0].isAI = false;
  scenario.players[1].startX = 45;
  scenario.players[1].startZ = 37;
  scenario.players[1].isAI = false;
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 16, z: 33 },
    { defId: 'commandPost', owner: 1, x: 44, z: 33 },
    { defId: 'relay', owner: -1, x: 30, z: 32 },
    { defId: 'relay', owner: -1, x: 32, z: 32 },
  ];
  scenario.units = [
    { defId: 'engineer', owner: 0, x: 22, z: 38 },
    { defId: 'harvester', owner: 0, x: 26, z: 36 },
    { defId: 'tank', owner: 0, x: 22, z: 35 },
    { defId: 'tank', owner: 0, x: 24, z: 35 },
    { defId: 'rifle', owner: 0, x: 22, z: 40 },
    { defId: 'rifle', owner: 0, x: 23, z: 40 },
    { defId: 'rifle', owner: 0, x: 24, z: 40 },
    { defId: 'rifle', owner: 0, x: 25, z: 40 },
    { defId: 'rifle', owner: 0, x: 26, z: 40 },
    { defId: 'engineer', owner: 1, x: 41, z: 38 },
    { defId: 'harvester', owner: 1, x: 37, z: 36 },
    { defId: 'tank', owner: 1, x: 41, z: 35 },
    { defId: 'tank', owner: 1, x: 39, z: 35 },
    { defId: 'rifle', owner: 1, x: 41, z: 40 },
    { defId: 'rifle', owner: 1, x: 40, z: 40 },
    { defId: 'rifle', owner: 1, x: 39, z: 40 },
    { defId: 'rifle', owner: 1, x: 38, z: 40 },
    { defId: 'rifle', owner: 1, x: 37, z: 40 },
  ];
  for (const x of [10, 11, 21, 22]) {
    for (const z of [27, 28, 38, 39]) {
      scenario.tiles[z * scenario.width + x].o = ARENA_ORE;
      scenario.tiles[z * scenario.width + (63 - x)].o = ARENA_ORE;
    }
  }
  return scenario;
}

/** Material-weighted board value, used when neither HQ falls inside the limit. */
function sideScore(game: Game, id: number): number {
  let unitValue = 0;
  let buildingValue = 0;
  for (const e of game.entitiesOf(id)) {
    if (e.kind === 'unit') {
      const def = UNITS[e.defId];
      unitValue += (def?.cost.mats ?? 0) + (def?.cost.req ?? 0) * 1.5;
    } else {
      const def = BUILDINGS[e.defId];
      buildingValue += ((def?.cost.mats ?? 0) + (def?.cost.req ?? 0) * 1.5) * 0.6;
    }
  }
  const p = game.player(id)!;
  return (
    unitValue +
    buildingValue +
    p.stats.kills * 140 +
    Math.round(p.mats * 0.1) +
    Math.round(p.stats.matsGathered * 0.08)
  );
}

/**
 * Both sides run the real AIController through the public command API. The
 * built-in single-AI hook is disabled so the match is symmetric and the harness
 * owns both controllers. Each controller schedules its own think cadence from
 * its difficulty, exactly as it does inside a real battle.
 */
function runMatch(
  westDifficulty: AIDifficulty,
  eastDifficulty: AIDifficulty,
  seed: number,
  maxSeconds = 600,
) {
  const game = new Game(matchupScenario(), { enableAI: false });
  const west = new AIController();
  const east = new AIController();
  const westState = initialAIState(seed, westDifficulty);
  const eastState = initialAIState(seed, eastDifficulty);
  for (let i = 0; i < 20 * maxSeconds && game.state.victory === 'playing'; i++) {
    game.tick();
    west.update(game, 0, westState);
    east.update(game, 1, eastState);
  }
  return { west: sideScore(game, 0), east: sideScore(game, 1) };
}

function pair(a: AIDifficulty, b: AIDifficulty, seeds: number[]) {
  let margin = 0;
  let wins = 0;
  let losses = 0;
  for (const seed of seeds) {
    for (const swapped of [false, true]) {
      // Each level plays each side once, so a west-side map advantage cancels.
      const west = swapped ? b : a;
      const east = swapped ? a : b;
      const result = runMatch(west, east, seed);
      const aScore = swapped ? result.east : result.west;
      const bScore = swapped ? result.west : result.east;
      margin += aScore - bScore;
      if (aScore > bScore) wins++;
      else losses++;
    }
  }
  return { margin: Math.round(margin), wins, losses };
}

describe('AI difficulty matchups', () => {
  it('keeps Recruit below Veteran and Elite above both', () => {
    const recruitVsVeteran = pair('recruit', 'veteran', SEEDS);
    const eliteVsRecruit = pair('elite', 'recruit', SEEDS);
    const eliteVsVeteran = pair('elite', 'veteran', SEEDS);
    const results = [
      ['Recruit vs Veteran', recruitVsVeteran],
      ['Elite vs Recruit', eliteVsRecruit],
      ['Elite vs Veteran', eliteVsVeteran],
    ] as const;
    for (const [label, result] of results) {
      console.log(
        `[matchup] ${label}: margin ${result.margin}, wins ${result.wins}-${result.losses}`,
      );
    }

    // Recruit: slow decisions, thin economy, no home guard, piecemeal attacks
    // and no recall — it keeps pressing while its own base is dismantled. That
    // last point is what this margin measured before the recall existed: every
    // level abandoned its base on the way out, so a recruit rush lifted a
    // veteran command post in half its matches and this pairing was a coin flip
    // (margin -22.8k, 7-9).
    //
    // The Phase 1 tactical abilities then moved this number to -15,012 (6-10),
    // with the same harness reading +1,130 (8-8) when AI ability use was
    // suppressed — the recruit's slow reaction cadence was the largest lever,
    // because it answers guided rounds and breaks contact noticeably later.
    // The threshold records that measured separation rather than the older -30k,
    // which belonged to a commander that had no abilities to spend.
    expect(recruitVsVeteran.margin).toBeLessThan(-10000);
    expect(recruitVsVeteran.losses).toBeGreaterThan(recruitVsVeteran.wins);
    expect(recruitVsVeteran.wins).toBeLessThanOrEqual(7);

    // Elite: fastest decisions, leanest spend on infrastructure, counters what it
    // scouted, posts two guards and recalls, so it should not just edge Recruit
    // but dominate it.
    expect(eliteVsRecruit.margin).toBeGreaterThan(45000);
    expect(eliteVsRecruit.wins).toBeGreaterThanOrEqual(11);

    // Veteran is the baseline, so this is the closest pairing: still a clear
    // positive result rather than a coin flip.
    expect(eliteVsVeteran.margin).toBeGreaterThan(15000);
    expect(eliteVsVeteran.wins).toBeGreaterThanOrEqual(9);
    // The ladder runs 48 full-length matches; with both higher levels now
    // defending, matches that used to end in a knockout run to the 600-second
    // limit instead. The budget is deliberately generous so a slower machine
    // measures the same thing rather than timing out mid-pairing: the whole set
    // is roughly 576,000 simulated ticks, which is over nine minutes at the
    // host's measured tick cost before a single match is lost to contention.
    // This is the longest single test in the suite by an order of magnitude.
  }, 1_200_000);
});
