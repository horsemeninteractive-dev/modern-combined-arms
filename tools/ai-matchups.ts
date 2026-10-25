/**
 * Wider AI-vs-AI difficulty sample.
 *
 * The ladder test in tests/ai-matchups.test.ts runs eight seeds because that is
 * what fits comfortably in the suite. This harness plays any number of seeds so
 * a tuning pass can check that a result is not an artefact of a small sample:
 *
 *   npx tsx tools/ai-matchups.ts recruit veteran 24 600
 *
 * Arguments: <levelA> <levelB> [seeds=8] [materials per ore tile=300].
 * It mirrors every pairing (each level plays each side once) and prints the
 * aggregate material-weighted margin and win/loss count. It is deterministic:
 * the same arguments always produce the same numbers.
 */
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState, aiProfile } from '../src/sim/ai';
import type { AIDifficulty } from '../src/sim/types';
import { UNITS } from '../src/data/units';
import { BUILDINGS } from '../src/data/buildings';

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
      scenario.tiles[z * scenario.width + x].o = ORE;
      scenario.tiles[z * scenario.width + (63 - x)].o = ORE;
    }
  }
  return scenario;
}

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

function runMatch(westDifficulty: AIDifficulty, eastDifficulty: AIDifficulty, seed: number) {
  const game = new Game(matchupScenario(), { enableAI: false });
  const west = new AIController();
  const east = new AIController();
  const westState = initialAIState(seed, westDifficulty);
  const eastState = initialAIState(seed, eastDifficulty);
  for (let i = 0; i < 20 * 600 && game.state.victory === 'playing'; i++) {
    game.tick();
    west.update(game, 0, westState);
    east.update(game, 1, eastState);
  }
  const detail = (id: number) => {
    const p = game.player(id)!;
    const units = game.entitiesOf(id, 'unit').map((e) => e.defId);
    return {
      score: sideScore(game, id),
      kills: p.stats.kills,
      mats: Math.round(p.mats),
      gathered: Math.round(p.stats.matsGathered),
      units: units.length,
      wave: id === 0 ? westState.attackWave : eastState.attackWave,
      phase: id === 0 ? westState.phase : eastState.phase,
      decision: id === 0 ? westState.lastDecision : eastState.lastDecision,
    };
  };
  return { victory: game.state.victory, west: detail(0), east: detail(1) };
}

const args = process.argv.slice(2);
const [a, b] = args.slice(0, 2) as [AIDifficulty, AIDifficulty];
const count = Number(args[2] ?? 8);
const ORE = Number(args[3] ?? 300);
const seeds = Array.from({ length: count }, (_, i) => 101 + i * 977);

console.log(
  'profiles',
  JSON.stringify({ [a]: aiProfile(101, a), [b]: aiProfile(101, b) }, null, 0),
);
let margin = 0;
let wins = 0;
let losses = 0;
let draws = 0;
for (const seed of seeds) {
  for (const swapped of [false, true]) {
    const westDifficulty = swapped ? b : a;
    const eastDifficulty = swapped ? a : b;
    const r = runMatch(westDifficulty, eastDifficulty, seed);
    const aSide = swapped ? r.east : r.west;
    const bSide = swapped ? r.west : r.east;
    const delta = aSide.score - bSide.score;
    margin += delta;
    if (delta > 0) wins++;
    else losses++;
    console.log(
      JSON.stringify({
        seed,
        swapped,
        victory: r.victory,
        margin: delta,
        a: `${aSide.units}u ${aSide.gathered}g w${aSide.wave} k${aSide.kills} ${aSide.phase}`,
        b: `${bSide.units}u ${bSide.gathered}g w${bSide.wave} k${bSide.kills} ${bSide.phase}`,
      }),
    );
  }
}
console.log(JSON.stringify({ pair: `${a} vs ${b}`, margin, wins, losses, draws }));
