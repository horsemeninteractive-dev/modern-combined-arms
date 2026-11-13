/**
 * Phase 8 — battlefield-level tactical judgement.
 *
 * Fixtures run the shipped planner against a real engagement: the AI masses a
 * force, commits a wave, and the simulation decides what happens. The tests
 * read the controller's own record of that wave, not a helper constant.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';
import type { AIDifficulty } from '../src/sim/types';

const SIZE = 72;
const CX = 56;
const CZ = 36;

interface Fixture {
  game: Game;
  ai: AIController;
  state: ReturnType<typeof initialAIState>;
}

function battle(
  commanderId: string | undefined,
  difficulty: AIDifficulty,
  defenders: { units?: number; turrets?: number },
  options: { hidden?: boolean; cp?: [number, number]; extraCp?: [number, number] } = {},
): Fixture {
  const [cpX, cpZ] = options.cp ?? [6, 6];
  const s = createEmptyScenario(SIZE, SIZE);
  s.settings.seed = 7;
  s.settings.fog = options.hidden === true;
  s.players[0].factionId = 'baltic';
  s.players[0].startX = 6;
  s.players[0].startZ = 6;
  s.players[1].factionId = 'poland';
  s.players[1].startX = CX;
  s.players[1].startZ = CZ;
  s.structures.push({ defId: 'commandPost', owner: 1, x: CX + 4, z: CZ + 6 });
  s.structures.push({ defId: 'factory', owner: 1, x: CX + 7, z: CZ + 6 });
  s.structures.push({ defId: 'barracks', owner: 1, x: CX + 7, z: CZ + 9 });
  s.structures.push({ defId: 'refinery', owner: 1, x: CX + 9, z: CZ + 9 });
  s.structures.push({ defId: 'powerPlant', owner: 1, x: CX + 9, z: CZ + 5 });
  // Enemy command post far away, so the objective under test is the strongpoint.
  s.structures.push({ defId: 'commandPost', owner: 0, x: cpX, z: cpZ });
  if (options.extraCp) {
    // A second command post so taking the first does not end the match; a
    // wave can then be judged on its own merits.
    s.structures.push({ defId: 'commandPost', owner: 0, x: options.extraCp[0], z: options.extraCp[1] });
  }
  for (let i = 0; i < (defenders.turrets ?? 0); i++) {
    s.structures.push({ defId: 'atTurret', owner: 0, x: cpX + 4 + i, z: cpZ + 4 });
  }
  // Far enough from the base that the garrison is not destroyed while it masses.
  for (let i = 0; i < (defenders.units ?? 0); i++) {
    s.units.push({ defId: 'tank', owner: 0, x: cpX + 4 + (i % 3), z: cpZ + 2 - Math.floor(i / 3) });
  }
  // The AI's own hulls, already built and crewed.
  for (let i = 0; i < 8; i++) {
    s.units.push({ defId: 'tank', owner: 1, x: CX + 2 + (i % 3), z: CZ + 3 + Math.floor(i / 3) });
  }
  s.units.push({ defId: 'recon', owner: 1, x: CX + 8, z: CZ + 8 });
  const game = new Game(s, { enableAI: false });
  const ai = new AIController();
  const state = initialAIState(7, difficulty, commanderId);
  return { game, ai, state };
}

function run(f: Fixture, seconds: number): void {
  for (let i = 0; i < 20 * seconds; i++) {
    f.game.tick();
    f.ai.update(f.game, 1, f.state);
  }
}

describe('battlefield outcome assessment', () => {
  it('recognises a wave that failed', () => {
    const f = battle('piotrGrabowski', 'elite', { turrets: 8 });
    run(f, 200);
    console.log('[tactics8]', JSON.stringify({
      kind: 'failure',
      battle: f.state.battle,
      log: f.state.lastDecision,
      wave: f.state.attackWave,
      phase: f.state.phase,
      victory: f.game.state.victory,
      own: f.game.state.entities.filter((e) => e.owner === 1 && e.kind === 'unit').length,
      kills: f.game.state.players[1]!.stats.kills,
      lost: f.game.state.players[1]!.stats.unitsLost,
    }));
    expect(f.state.battle?.lastOutcome).toBe('failure');
    expect(f.state.battle?.setbacks ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('recognises a wave that reached its objective', () => {
    // An undefended objective: no defenders, only the structures.
    const f = battle('piotrGrabowski', 'elite', { units: 3 }, { cp: [20, 20], extraCp: [4, 4] });
    run(f, 200);
    console.log('[tactics8]', JSON.stringify({
      kind: 'success',
      battle: f.state.battle,
      log: f.state.lastDecision,
      victory: f.game.state.victory,
      wave: f.state.attackWave,
    }));
    expect(f.state.battle?.lastOutcome).toBe('success');
    expect(f.state.battle?.setbacks ?? 0).toBe(0);
  });

  it('does not judge a wave before the observation window', () => {
    const f = battle('piotrGrabowski', 'elite', { turrets: 8 });
    run(f, 8);
    expect(f.state.battle?.lastOutcome).toBeUndefined();
  });

  it('is deterministic for the same battle', () => {
    const first = battle('piotrGrabowski', 'elite', { turrets: 8 });
    const second = battle('piotrGrabowski', 'elite', { turrets: 8 });
    run(first, 200);
    run(second, 200);
    expect(first.state.battle?.lastOutcome).toBe(second.state.battle?.lastOutcome);
    expect(first.state.battle?.setbacks).toBe(second.state.battle?.setbacks);
  });

});

describe('tactical adaptation', () => {
  it('makes a careful elite commander wait longer after a failure than a recruit', () => {
    const elite = battle('piotrGrabowski', 'elite', { turrets: 8 });
    const recruit = battle('piotrGrabowski', 'recruit', { turrets: 8 });
    run(elite, 200);
    run(recruit, 200);
    const eliteSetbacks = elite.state.battle?.setbacks ?? 0;
    const recruitSetbacks = recruit.state.battle?.setbacks ?? 0;
    console.log('[tactics8]', JSON.stringify({
      kind: 'levels',
      elite: { setbacks: eliteSetbacks, until: elite.state.battle?.setbackUntil, wave: elite.state.attackWave },
      recruit: { setbacks: recruitSetbacks, until: recruit.state.battle?.setbackUntil, wave: recruit.state.attackWave },
    }));
    // Both see the failure; only the level that trusts its own judgement acts on
    // it. The recruit keeps pressing the same way, exactly as it should.
    expect(eliteSetbacks).toBeGreaterThanOrEqual(1);
    // The same battlefield, the same elapsed time: the elite commander holds its
    // next wave back to reconsider, while the recruit has already sent another.
    expect(elite.state.attackWave).toBeLessThan(recruit.state.attackWave);
  });

});
