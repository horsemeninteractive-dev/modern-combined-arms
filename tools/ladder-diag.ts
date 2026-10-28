/**
 * Difficulty-ladder diagnosis.
 *
 * `tests/ai-matchups.test.ts` plays Elite against Veteran on eight seeds, both
 * seats, and asserts a material-weighted margin. Phase 11 changes how an
 * assault wave is aimed, which changes those matches, so this tool exists to
 * see *why* the margin moves rather than only that it did.
 *
 * It runs the same arena, seeds, seats and matchup loop as the test, once with
 * the shipped destination resolution and once with it switched off — the same
 * build, same AI, same economy, one variable. For every match it records the
 * margin and the things that produce it: waves announced, move orders the
 * simulation refused, kills and losses, command-post health, army value and
 * what each side spent.
 *
 *   npx tsx tools/ladder-diag.ts [pairing=elite-veteran] [limitSeconds=600] [replication]
 *
 * Diagnostics only: nothing under `src/` imports it and it changes no game
 * behaviour.
 */
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';
import type { AIDifficulty, Entity } from '../src/sim/types';
import { UNITS } from '../src/data/units';
import { BUILDINGS } from '../src/data/buildings';
import { TILE_SIZE } from '../src/sim/constants';

/** Identical to the ladder test: eight seeds x both seats = sixteen matches. */
const SEEDS = [
  101, 1078, 2055, 3032, 4009, 4986, 5963, 6940,
];
/**
 * A second pool for replication: the contract must not depend on eight lucky
 * seeds. `MCA_LADDER_SEEDS=101,2000,...` overrides the list entirely.
 */
const REPLICATION_SEEDS = [2101, 3078, 4055, 5032, 6009, 6986, 7963, 8940];
const SEED_SET = (process.env.MCA_LADDER_SEEDS ?? '')
  .split(',')
  .map((v) => Number(v.trim()))
  .filter((v) => Number.isInteger(v) && v > 0);
/** Materials per ore tile, as in the ladder test. */
const ARENA_ORE = 600;

const args = process.argv.slice(2);
const [aName, bName] = (args[0] ?? 'elite-veteran').split('-') as [AIDifficulty, AIDifficulty];
const limitSeconds = Math.max(60, Math.min(1200, Number(args[1] ?? 600)));

function scenario() {
  const s = createEmptyScenario(64, 64);
  s.meta.name = 'AI Matchup';
  s.settings.startingMats = 3000;
  s.settings.startingReq = 180;
  s.players[0].startX = 18;
  s.players[0].startZ = 37;
  s.players[0].isAI = false;
  s.players[1].startX = 45;
  s.players[1].startZ = 37;
  s.players[1].isAI = false;
  s.structures = [
    { defId: 'commandPost', owner: 0, x: 16, z: 33 },
    { defId: 'commandPost', owner: 1, x: 44, z: 33 },
    { defId: 'relay', owner: -1, x: 30, z: 32 },
    { defId: 'relay', owner: -1, x: 32, z: 32 },
  ];
  const u = (defId: string, owner: number, x: number, z: number) => ({ defId, owner, x, z });
  s.units = [
    u('engineer', 0, 22, 38),
    u('harvester', 0, 26, 36),
    u('tank', 0, 22, 35),
    u('tank', 0, 24, 35),
    u('rifle', 0, 22, 40),
    u('rifle', 0, 23, 40),
    u('rifle', 0, 24, 40),
    u('rifle', 0, 25, 40),
    u('rifle', 0, 26, 40),
    u('engineer', 1, 41, 38),
    u('harvester', 1, 37, 36),
    u('tank', 1, 41, 35),
    u('tank', 1, 39, 35),
    u('rifle', 1, 41, 40),
    u('rifle', 1, 40, 40),
    u('rifle', 1, 39, 40),
    u('rifle', 1, 38, 40),
    u('rifle', 1, 37, 40),
  ];
  for (const x of [10, 11, 21, 22]) {
    for (const z of [27, 28, 38, 39]) {
      s.tiles[z * 64 + x].o = ARENA_ORE;
      s.tiles[z * 64 + (63 - x)].o = ARENA_ORE;
    }
  }
  return s;
}

/** Material-weighted board value, exactly as the ladder test scores it. */
function sideScore(game: Game, id: number): number {
  let unitValue = 0;
  let buildingValue = 0;
  for (const e of game.entitiesOf(id)) {
    if (e.hp <= 0) continue;
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

interface SideTrace {
  waves: number;
  refusals: number;
  refusalsOnStructure: number;
  kills: number;
  losses: number;
  unitsBuilt: number;
  unitsLost: number;
  armyEnd: number;
  forceEnd: number;
  hqEndHp: number;
  gathered: number;
  mats: number;
}

function traceSide(
  game: Game,
  id: number,
  state: ReturnType<typeof initialAIState>,
  refusals: { onStructure: number; total: number },
  hq: Entity | undefined,
): SideTrace {
  const p = game.player(id)!;
  let armyEnd = 0;
  let forceEnd = 0;
  for (const e of game.entitiesOf(id)) {
    if (e.hp <= 0 || e.kind !== 'unit') continue;
    const def = UNITS[e.defId];
    if (!def || e.garrisonId) continue;
    armyEnd++;
    forceEnd += def.cost.mats + def.cost.req * 1.5;
  }
  return {
    waves: state.attackWave,
    refusals: refusals.total,
    refusalsOnStructure: refusals.onStructure,
    kills: p.stats.kills,
    losses: p.stats.unitsLost,
    unitsBuilt: p.stats.unitsBuilt,
    unitsLost: p.stats.unitsLost,
    armyEnd,
    forceEnd: Math.round(forceEnd),
    hqEndHp: Math.round(hq?.hp ?? 0),
    gathered: Math.round(p.stats.matsGathered),
    mats: Math.round(p.mats),
  };
}

/** One match; `resolveApproach` is the only difference between arms. */
function runMatch(
  westDifficulty: AIDifficulty,
  eastDifficulty: AIDifficulty,
  seed: number,
  resolveApproach: boolean,
) {
  const game = new Game(scenario(), { enableAI: false });
  const west = new AIController({ resolveApproach });
  const east = new AIController({ resolveApproach });
  const westState = initialAIState(seed, westDifficulty);
  const eastState = initialAIState(seed, eastDifficulty);
  const posts = new Map<number, Entity>();
  for (const e of game.state.entities) {
    if (e.kind === 'building' && BUILDINGS[e.defId]?.commandPost) posts.set(e.owner, e);
  }
  const refusal = [
    { total: 0, onStructure: 0 },
    { total: 0, onStructure: 0 },
  ];
  let lastEventSeq = 0;
  const limit = 20 * limitSeconds;
  let ticks = 0;
  for (let i = 0; i < limit && game.state.victory === 'playing'; i++) {
    game.tick();
    west.update(game, 0, westState);
    east.update(game, 1, eastState);
    ticks = i + 1;
    for (const ev of game.state.events) {
      if (ev.seq <= lastEventSeq) continue;
      lastEventSeq = ev.seq;
      if (ev.type !== 'orderFailed' || !ev.text.includes('No route')) continue;
      const rec = refusal[ev.team];
      if (!rec) continue;
      rec.total++;
      for (const b of game.state.entities) {
        if (b.kind !== 'building' || b.hp <= 0 || b.owner === ev.team) continue;
        const def = BUILDINGS[b.defId];
        if (!def) continue;
        if (
          Math.abs(ev.x - b.x) <= (def.footprint.w * TILE_SIZE) / 2 &&
          Math.abs(ev.z - b.z) <= (def.footprint.h * TILE_SIZE) / 2
        ) {
          rec.onStructure++;
          break;
        }
      }
    }
  }
  const westHq = posts.get(0);
  const eastHq = posts.get(1);
  return {
    seed,
    /** The stronger level's seat, so the aggregate can cancel the map's bias. */
    aIsEast: westDifficulty === bName,
    victory: game.state.victory,
    seconds: +(ticks / 20).toFixed(1),
    west: traceSide(game, 0, westState, refusal[0], westHq),
    east: traceSide(game, 1, eastState, refusal[1], eastHq),
    westScore: sideScore(game, 0),
    eastScore: sideScore(game, 1),
  };
}

type Rec = ReturnType<typeof runMatch>;

function summarise(label: string, recs: Rec[]) {
  // `a` is the stronger level; it plays each seat once per seed so the map's
  // own bias cancels out of the aggregate.
  let margin = 0;
  let wins = 0;
  let losses = 0;
  const side = { waves: 0, refusals: 0, refusalsOnStructure: 0, kills: 0, losses: 0 };
  const other = { waves: 0, refusals: 0, refusalsOnStructure: 0, kills: 0, losses: 0 };
  const force = { a: 0, b: 0 };
  const army = { a: 0, b: 0 };
  const hq = { a: 0, b: 0 };
  const built = { a: 0, b: 0 };
  const gathered = { a: 0, b: 0 };
  const deciding = recs.filter((r) => r.victory !== 'playing');
  for (const r of recs) {
    const swapped = r.aIsEast;
    const aScore = swapped ? r.eastScore : r.westScore;
    const bScore = swapped ? r.westScore : r.eastScore;
    margin += aScore - bScore;
    if (aScore > bScore) wins++;
    else losses++;
    const aSide = swapped ? r.east : r.west;
    const bSide = swapped ? r.west : r.east;
    for (const [dst, src] of [
      [side, aSide],
      [other, bSide],
    ] as const) {
      dst.waves += src.waves;
      dst.refusals += src.refusals;
      dst.refusalsOnStructure += src.refusalsOnStructure;
      dst.kills += src.kills;
      dst.losses += src.losses;
    }
    force.a += aSide.forceEnd;
    force.b += bSide.forceEnd;
    army.a += aSide.armyEnd;
    army.b += bSide.armyEnd;
    hq.a += aSide.hqEndHp;
    hq.b += bSide.hqEndHp;
    built.a += aSide.unitsBuilt;
    built.b += bSide.unitsBuilt;
    gathered.a += aSide.gathered;
    gathered.b += bSide.gathered;
  }
  const n = recs.length || 1;
  const mean = (v: number) => Math.round(v / n);
  console.log(
    JSON.stringify({
      event: 'arm',
      label,
      pairing: `${aName} vs ${bName}`,
      matches: recs.length,
      margin: Math.round(margin),
      wins,
      losses,
      decided: deciding.length,
      duration: mean(recs.reduce((t, r) => t + r.seconds, 0)),
      a: {
        waves: mean(side.waves),
        refusals: mean(side.refusals),
        refusalsOnStructure: mean(side.refusalsOnStructure),
        kills: mean(side.kills),
        losses: mean(side.losses),
        armyEnd: mean(army.a),
        forceEnd: mean(force.a),
        hqEndHp: mean(hq.a),
        unitsBuilt: mean(built.a),
        gathered: mean(gathered.a),
      },
      b: {
        waves: mean(other.waves),
        refusals: mean(other.refusals),
        refusalsOnStructure: mean(other.refusalsOnStructure),
        kills: mean(other.kills),
        losses: mean(other.losses),
        armyEnd: mean(army.b),
        forceEnd: mean(force.b),
        hqEndHp: mean(hq.b),
        unitsBuilt: mean(built.b),
        gathered: mean(gathered.b),
      },
    }),
  );
}

const arms = process.env.MCA_LADDER_ARMS === 'off' ? [false] : process.env.MCA_LADDER_ARMS === 'on' ? [true] : [true, false];
const seeds =
  SEED_SET.length > 0
    ? SEED_SET
    : args[2] === 'replication'
      ? REPLICATION_SEEDS
      : SEEDS;
for (const resolveApproach of arms) {
  const recs: Rec[] = [];
  for (const seed of seeds) {
    for (const swapped of [false, true]) {
      const west = swapped ? bName : aName;
      const east = swapped ? aName : bName;
      const r = runMatch(west, east, seed, resolveApproach);
      recs.push(r);
      if (process.env.MCA_LADDER_VERBOSE) {
        console.log(
          JSON.stringify({
            event: 'match',
            arm: resolveApproach ? 'on' : 'off',
            seed,
            aSeat: swapped ? 'east' : 'west',
            victory: r.victory,
            seconds: r.seconds,
            margin: (swapped ? r.eastScore : r.westScore) - (swapped ? r.westScore : r.eastScore),
            a: swapped ? r.east : r.west,
            b: swapped ? r.west : r.east,
          }),
        );
      }
    }
  }
  summarise(resolveApproach ? 'resolved' : 'unresolved', recs);
}
