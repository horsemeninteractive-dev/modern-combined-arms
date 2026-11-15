import { createIslandAssault } from '../../src/data/scenarios';
import { AIController, initialAIState } from '../../src/sim/ai';
import { Game } from '../../src/sim/game';

const SAMPLE_EVERY = 100;
const TOTAL_TICKS = 7200;
const AI_SEED = 0x5eed1234;

export interface HashSample {
  tick: number;
  hash: string;
}

export interface DeterminismResult {
  ok: boolean;
  ticks?: number;
  sampleEvery?: number;
  aiSeed?: number;
  scenarioSeed?: number;
  finalVictory?: string;
  entities?: number;
  elapsedMs?: number;
  samples?: HashSample[];
  error?: string;
}

declare global {
  interface Window {
    __MCA_DETERMINISM__?: DeterminismResult;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function run(): Promise<DeterminismResult> {
  const started = performance.now();
  // The authored island gives both controllers a real economy, production and
  // opposing force without a test-only map definition. The simulated state is
  // seeded; the two AI streams use the same fixed seed so the match is
  // reproducible across engines.
  const game = new Game(createIslandAssault(), { enableAI: false });
  const west = new AIController();
  const east = new AIController();
  const westState = initialAIState(AI_SEED, 'veteran');
  const eastState = initialAIState(AI_SEED, 'veteran');
  const samples: HashSample[] = [];

  for (let tick = 1; tick <= TOTAL_TICKS; tick++) {
    game.tick();
    west.update(game, 0, westState);
    east.update(game, 1, eastState);
    if (tick % SAMPLE_EVERY === 0) {
      samples.push({ tick, hash: game.stateHash() });
    }
  }

  return {
    ok: true,
    ticks: TOTAL_TICKS,
    sampleEvery: SAMPLE_EVERY,
    aiSeed: AI_SEED,
    scenarioSeed: game.state.seed,
    finalVictory: game.state.victory,
    entities: game.state.entities.length,
    elapsedMs: Math.round(performance.now() - started),
    samples,
  };
}

run()
  .then((result) => {
    window.__MCA_DETERMINISM__ = result;
  })
  .catch((error: unknown) => {
    window.__MCA_DETERMINISM__ = { ok: false, error: errorMessage(error) };
  });
