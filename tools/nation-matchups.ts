/**
 * National matchup audit harness.
 *
 * This is deliberately separate from the normal unit suite: the full matrix is
 * 45 pairings x 2 seats x 2 personalities x N seeds, which is an hour of CPU at
 * five seeds. It answers questions the individual national tests cannot: does a
 * nation actually build its variant, does the variant reach the battlefield,
 * and does the national identity change the outcome of a mirrored AI-vs-AI
 * match?
 *
 *   npx tsx tools/nation-matchups.ts [seeds=3] [maxSeconds=600] [difficulty=veteran]
 *
 * A long sweep can be split into processes and concatenated afterwards:
 *   MCA_PAIRS=lithuania-poland,uk-finland MCA_CONTROL=0 npx tsx ...
 *   MCA_SEEDS=3032,4009 npx tsx ...   # a different seed set
 *
 * Both sides run the real AIController through the public command API. The
 * built-in single-AI hook is disabled, exactly like tests/ai-matchups.test.ts.
 * Every pairing is played with each nation on each side and with both commander
 * personalities swapped between seats, so a seat bias is shared equally by all
 * ten nations rather than falling on one. It is not eliminated: the arena is
 * geometrically mirrored but the simulation is not algorithmically symmetric,
 * and the east seat wins about two thirds of decided matches. Read
 * docs/PHASE_5_MATCHUP_AUDIT.md §1.4 before comparing absolute win rates.
 *
 * The harness prints one JSON line per match and a summary per pairing and
 * nation. It does not change game balance, save formats or AI decisions.
 */
import { Game } from '../src/sim/game';
import { AIController, initialAIState, aiProfile } from '../src/sim/ai';
import type { AIDifficulty } from '../src/sim/types';
import { UNITS } from '../src/data/units';
import { BUILDINGS, buildingFamily } from '../src/data/buildings';
import { dist } from '../src/core/math';
import { TILE_SIZE } from '../src/sim/constants';
import {
  NATION_IDS,
  PAIRS,
  VARIANT_BY_NATION,
  matchupScenario,
  seedPool,
  sideScore,
} from './matchup-arena';

interface VariantTrace {
  id: string;
  /** Units: completed spawns. Buildings: completed structures. */
  built: number;
  /** Structure entities placed, including those still under construction. */
  placed: number;
  /** Whether the variant ever appeared in a production queue. */
  queued: boolean;
  firstBuiltTick: number | null;
  maxAlive: number;
  endAlive: number;
  /** Damage actually removed from live variant entities during the match. */
  damageTaken: number;
  /** Kills credited to variant entities while they were alive. */
  kills: number;
  endHp: number;
  /** Ticks the variant existed on the field, summed across all of its hulls. */
  aliveTicks: number;
  /** Airborne ticks for a drone, so loitering is not confused with parking. */
  airborneTicks: number;
  /** Ticks an unarmed land scout spent within escort distance of friendly arms. */
  nearFriendTicks: number;
  /** Enemy entities first seen while a variant hull was within its optics. */
  sighted: number;
}

interface SideTrace {
  nation: string;
  variant: VariantTrace;
  /** Highest simultaneous count of each completed structure definition. */
  structures: Record<string, number>;
  /** Definitions seen in queues at least once. */
  queuedDefs: Set<string>;
  /** Unit definitions ever seen alive, including initial units. */
  seenUnits: Set<string>;
  /** Unit definitions built during the match. */
  produced: Record<string, number>;
}

function newVariant(nation: string): VariantTrace {
  return {
    id: VARIANT_BY_NATION[nation] ?? '',
    built: 0,
    placed: 0,
    queued: false,
    firstBuiltTick: null,
    maxAlive: 0,
    endAlive: 0,
    damageTaken: 0,
    kills: 0,
    endHp: 0,
    aliveTicks: 0,
    airborneTicks: 0,
    nearFriendTicks: 0,
    sighted: 0,
  };
}

function newSide(nation: string): SideTrace {
  return {
    nation,
    variant: newVariant(nation),
    structures: {},
    queuedDefs: new Set(),
    seenUnits: new Set(),
    produced: {},
  };
}

/**
 * Observe one side without touching simulation state. Production is counted
 * from newly spawned entity ids (or completed structures), not from the queue,
 * so the metric means "reached the battlefield". Queue sightings only mark that
 * the AI requested the variant.
 */
function observeSide(
  game: Game,
  ownerId: number,
  trace: SideTrace,
  known: Set<number>,
  lastHp: Map<number, number>,
  lastKills: Map<number, number>,
  completeBuildings: Set<number>,
  seenEnemies: Set<number>,
): void {
  const tick = game.state.tick;
  let aliveVariant = 0;
  const structuresAtTick: Record<string, number> = {};
  // Friendly arms and fresh enemy contacts are side-wide facts, so they are
  // gathered once per observation rather than once per variant hull.
  const arms = game
    .entitiesOf(ownerId, 'unit')
    .filter((e) => e.hp > 0 && (UNITS[e.defId]?.weapons.length ?? 0) > 0);
  const freshContacts =
    tick % 10 === 0
      ? game.visibleEnemies(ownerId).filter((e) => !seenEnemies.has(e.id))
      : [];
  if (freshContacts.length > 0) for (const e of freshContacts) seenEnemies.add(e.id);

  for (const e of game.entitiesOf(ownerId)) {
    if (e.hp <= 0) continue;

    if (e.kind === 'unit') {
      trace.seenUnits.add(e.defId);
      if (!known.has(e.id)) {
        known.add(e.id);
        trace.produced[e.defId] = (trace.produced[e.defId] ?? 0) + 1;
        if (e.defId === trace.variant.id) {
          trace.variant.built++;
          trace.variant.firstBuiltTick ??= tick;
        }
      }
    } else {
      const family = buildingFamily(e.defId);
      if (!e.construction) {
        structuresAtTick[family] = (structuresAtTick[family] ?? 0) + 1;
      }
      if (!known.has(e.id)) {
        known.add(e.id);
        if (e.defId === trace.variant.id) trace.variant.placed++;
      }
      if (!e.construction && !completeBuildings.has(e.id)) {
        completeBuildings.add(e.id);
        if (e.defId === trace.variant.id) {
          trace.variant.built++;
          trace.variant.firstBuiltTick ??= tick;
        }
      }
    }

    for (const item of e.queue) {
      trace.queuedDefs.add(item.defId);
      if (item.defId === trace.variant.id) trace.variant.queued = true;
    }

    if (e.defId === trace.variant.id) {
      aliveVariant++;
      trace.variant.endHp = Math.round(e.hp);
      trace.variant.aliveTicks++;
      const previousHp = lastHp.get(e.id);
      if (previousHp !== undefined && e.hp < previousHp) {
        trace.variant.damageTaken += Math.round(previousHp - e.hp);
      }
      lastHp.set(e.id, e.hp);
      const previousKills = lastKills.get(e.id) ?? 0;
      if (e.kills > previousKills) trace.variant.kills += e.kills - previousKills;
      lastKills.set(e.id, e.kills);
      const variantDef = UNITS[e.defId];
      if (variantDef?.domain === 'air' && !e.aircraft?.landed) trace.variant.airborneTicks++;
      if (variantDef && variantDef.domain === 'land' && variantDef.weapons.length === 0) {
        const escortNear = arms.some(
          (unit) => unit.id !== e.id && dist(e.x, e.z, unit.x, unit.z) <= 14 * TILE_SIZE,
        );
        if (escortNear) trace.variant.nearFriendTicks++;
      }
      if (freshContacts.length > 0 && variantDef) {
        for (const enemy of freshContacts) {
          if (dist(e.x, e.z, enemy.x, enemy.z) <= variantDef.vision * TILE_SIZE) {
            trace.variant.sighted++;
          }
        }
      }
    }
  }

  for (const [defId, count] of Object.entries(structuresAtTick)) {
    trace.structures[defId] = Math.max(trace.structures[defId] ?? 0, count);
  }
  trace.variant.maxAlive = Math.max(trace.variant.maxAlive, aliveVariant);
  trace.variant.endAlive = aliveVariant;
}

interface SideResult {
  nation: string;
  score: number;
  kills: number;
  losses: number;
  gathered: number;
  mats: number;
  req: number;
  units: number;
  buildings: number;
  strategy: string;
  phase: string;
  wave: number;
  lastDecision: string;
  /** Technologies completed by the end of the match. */
  techs: string[];
  /** Requisition per second at the end of the match. */
  reqRate: number;
  variant: ReturnType<typeof variantResult>;
  structures: Record<string, number>;
  produced: Record<string, number>;
  queuedDefs: string[];
}

function variantResult(trace: VariantTrace) {
  return {
    id: trace.id,
    built: trace.built,
    placed: trace.placed,
    queued: trace.queued,
    firstBuilt: trace.firstBuiltTick === null ? null : +(trace.firstBuiltTick / 20).toFixed(1),
    maxAlive: trace.maxAlive,
    endAlive: trace.endAlive,
    endHp: trace.endHp,
    damageTaken: trace.damageTaken,
    kills: trace.kills,
    aliveSeconds: +(trace.aliveTicks / 20).toFixed(1),
    airborneSeconds: +(trace.airborneTicks / 20).toFixed(1),
    nearFriendSeconds: +(trace.nearFriendTicks / 20).toFixed(1),
    sighted: trace.sighted,
  };
}

function runMatch(
  westNation: string,
  eastNation: string,
  seed: number,
  difficulty: AIDifficulty,
  maxSeconds: number,
  personalityRotated = false,
) {
  const game = new Game(matchupScenario(westNation, eastNation, seed), { enableAI: false });
  const west = new AIController();
  const east = new AIController();
  // The two seats get different commander personalities so the match is not a
  // perfect mirror. Seat swaps preserve the seat seeds, so each nation still
  // plays both personalities across the pair. Identical seeds would make both
  // AIs issue the same commands forever on this symmetric arena.
  const westSeed = personalityRotated ? seed + 977 : seed;
  const eastSeed = personalityRotated ? seed : seed + 977;
  const westState = initialAIState(westSeed, difficulty);
  const eastState = initialAIState(eastSeed, difficulty);
  const westTrace = newSide(westNation);
  const eastTrace = newSide(eastNation);
  const westKnown = new Set<number>();
  const eastKnown = new Set<number>();
  const westHp = new Map<number, number>();
  const eastHp = new Map<number, number>();
  const westKills = new Map<number, number>();
  const eastKills = new Map<number, number>();
  const westComplete = new Set<number>();
  const eastComplete = new Set<number>();
  const westSeen = new Set<number>();
  const eastSeen = new Set<number>();

  const limit = 20 * maxSeconds;
  for (let i = 0; i < limit && game.state.victory === 'playing'; i++) {
    game.tick();
    west.update(game, 0, westState);
    east.update(game, 1, eastState);
    observeSide(game, 0, westTrace, westKnown, westHp, westKills, westComplete, westSeen);
    observeSide(game, 1, eastTrace, eastKnown, eastHp, eastKills, eastComplete, eastSeen);
  }

  const detail = (id: number, trace: SideTrace, state: typeof westState): SideResult => {
    const p = game.player(id)!;
    const units = game.entitiesOf(id, 'unit').filter((e) => e.hp > 0);
    const buildings = game.entitiesOf(id, 'building').filter((e) => e.hp > 0);
    return {
      nation: trace.nation,
      score: sideScore(game, id),
      kills: p.stats.kills,
      losses: p.stats.unitsLost,
      gathered: Math.round(p.stats.matsGathered),
      mats: Math.round(p.mats),
      req: Math.round(p.req),
      units: units.length,
      buildings: buildings.length,
      strategy: state.strategy,
      phase: state.phase,
      wave: state.attackWave,
      lastDecision: state.lastDecision,
      techs: game.completedTechnologies(id),
      reqRate: +game.reqRate(id).toFixed(2),
      variant: variantResult(trace.variant),
      structures: trace.structures,
      produced: trace.produced,
      queuedDefs: [...trace.queuedDefs].filter((defId) => UNITS[defId] || BUILDINGS[defId]).sort(),
    };
  };

  return {
    victory: game.state.victory,
    ticks: game.state.tick,
    seconds: +(game.state.tick / 20).toFixed(1),
    aiSeeds: [westSeed, eastSeed],
    west: detail(0, westTrace, westState),
    east: detail(1, eastTrace, eastState),
  };
}

function outcomeFor(
  result: ReturnType<typeof runMatch>,
  swapped: boolean,
): { winner: 'a' | 'b' | 'draw' | 'timeout'; aScore: number; bScore: number } {
  const aScore = swapped ? result.east.score : result.west.score;
  const bScore = swapped ? result.west.score : result.east.score;
  if (result.victory === 'playing') return { winner: 'timeout', aScore, bScore };
  if (result.victory === 'draw') return { winner: 'draw', aScore, bScore };
  // Game.victory is relative to player 0: victory = west, defeat = east.
  const winner = result.victory === 'victory' ? (swapped ? 'b' : 'a') : swapped ? 'a' : 'b';
  return { winner, aScore, bScore };
}

function emptyAggregate(a: string, b: string) {
  return {
    pair: `${a} vs ${b}`,
    a,
    b,
    games: 0,
    aWins: 0,
    bWins: 0,
    draws: 0,
    timeouts: 0,
    margin: 0,
    aVariantBuilt: 0,
    bVariantBuilt: 0,
    aVariantQueued: 0,
    bVariantQueued: 0,
    aVariantKills: 0,
    bVariantKills: 0,
    aVariantDamage: 0,
    bVariantDamage: 0,
  };
}

function variantSummary(nation: string, results: SideResult[]) {
  const id = VARIANT_BY_NATION[nation] ?? '';
  const built = results.filter((r) => r.variant.id === id && r.variant.built > 0).length;
  const queued = results.filter((r) => r.variant.id === id && r.variant.queued).length;
  return {
    nation,
    variant: id,
    games: results.length,
    builtGames: built,
    queuedGames: queued,
    totalBuilt: results.reduce((n, r) => n + (r.variant.id === id ? r.variant.built : 0), 0),
    totalKills: results.reduce((n, r) => n + (r.variant.id === id ? r.variant.kills : 0), 0),
    totalDamageTaken: results.reduce(
      (n, r) => n + (r.variant.id === id ? r.variant.damageTaken : 0),
      0,
    ),
    endAlive: results.reduce((n, r) => n + (r.variant.id === id ? r.variant.endAlive : 0), 0),
    totalAliveSeconds: +results
      .reduce((n, r) => n + (r.variant.id === id ? r.variant.aliveSeconds : 0), 0)
      .toFixed(1),
    totalAirborneSeconds: +results
      .reduce((n, r) => n + (r.variant.id === id ? r.variant.airborneSeconds : 0), 0)
      .toFixed(1),
    totalNearFriendSeconds: +results
      .reduce((n, r) => n + (r.variant.id === id ? r.variant.nearFriendSeconds : 0), 0)
      .toFixed(1),
    totalSighted: results.reduce((n, r) => n + (r.variant.id === id ? r.variant.sighted : 0), 0),
  };
}

const args = process.argv.slice(2);
// A second, independent seed set can be supplied for reproduction runs:
//   MCA_SEEDS=11,555,999 npx tsx tools/nation-matchups.ts 3 600
const SEED_POOL = seedPool();
const seedCount = Math.max(1, Math.min(SEED_POOL.length, Number(args[0] ?? 3)));
const maxSeconds = Math.max(60, Math.min(1200, Number(args[1] ?? 600)));
const difficulty = (args[2] ?? 'veteran') as AIDifficulty;
if (!['recruit', 'veteran', 'elite'].includes(difficulty)) {
  throw new Error(`Unknown difficulty "${difficulty}"`);
}
const seeds = SEED_POOL.slice(0, seedCount);

console.log(
  JSON.stringify({
    event: 'config',
    arena: process.env.MCA_MAP
      ? `skirmish map ${process.env.MCA_MAP} (authored terrain, relays and starting units)`
      : 'mirrored 64x64 arena, ore 600/tile (east seat wins ~2/3 of decided matches; see PHASE_5_MATCHUP_AUDIT.md §1.4)',
    startingMats: Number(process.env.MCA_START_MATS ?? 3000),
    startingReq: Number(process.env.MCA_START_REQ ?? 180),
    difficulty,
    seeds,
    eastSeedOffset: 977,
    personalityRotations: 2,
    maxSeconds,
    nations: NATION_IDS,
    variants: VARIANT_BY_NATION,
    aiProfiles: Object.fromEntries(
      seeds.flatMap((seed) => [
        [seed, aiProfile(seed, difficulty).strategy],
        [seed + 977, aiProfile(seed + 977, difficulty).strategy],
      ]),
    ),
  }),
);

const started = Date.now();
const aggregate: ReturnType<typeof emptyAggregate>[] = [];
const nationSides: Record<string, SideResult[]> = Object.fromEntries(
  NATION_IDS.map((nation) => [nation, []]),
);
const nationRecord: Record<
  string,
  { games: number; wins: number; losses: number; draws: number; timeouts: number }
> = Object.fromEntries(
  NATION_IDS.map((nation) => [nation, { games: 0, wins: 0, losses: 0, draws: 0, timeouts: 0 }]),
);

function runPair(a: string, b: string, trackNations = true): ReturnType<typeof emptyAggregate> {
  const agg = emptyAggregate(a, b);
  for (const seed of seeds) {
    // Both personalities are played on both seats. The standard and rotated
    // runs are exact mirrors when neither roster has a national variant, so a
    // national difference cannot be confused with commander temperament.
    for (const personalityRotated of [false, true]) {
      for (const swapped of [false, true]) {
      const westNation = swapped ? b : a;
      const eastNation = swapped ? a : b;
      const result = runMatch(
        westNation,
        eastNation,
        seed,
        difficulty,
        maxSeconds,
        personalityRotated,
      );
      const outcome = outcomeFor(result, swapped);
      const aSide = swapped ? result.east : result.west;
      const bSide = swapped ? result.west : result.east;
      const aVariant = aSide.variant;
      const bVariant = bSide.variant;
      agg.games++;
      if (outcome.winner === 'a') agg.aWins++;
      else if (outcome.winner === 'b') agg.bWins++;
      else if (outcome.winner === 'draw') agg.draws++;
      else agg.timeouts++;
      agg.margin += outcome.aScore - outcome.bScore;
      if (aVariant.built > 0) agg.aVariantBuilt++;
      if (bVariant.built > 0) agg.bVariantBuilt++;
      if (aVariant.queued) agg.aVariantQueued++;
      if (bVariant.queued) agg.bVariantQueued++;
      agg.aVariantKills += aVariant.kills;
      agg.bVariantKills += bVariant.kills;
      agg.aVariantDamage += aVariant.damageTaken;
      agg.bVariantDamage += bVariant.damageTaken;
      if (trackNations) {
        nationSides[a].push(aSide);
        nationSides[b].push(bSide);
        for (const [nation, won] of [
          [a, outcome.winner === 'a'],
          [b, outcome.winner === 'b'],
        ] as const) {
          const record = nationRecord[nation];
          record.games++;
          if (won) record.wins++;
          else if (outcome.winner === 'draw') record.draws++;
          else if (outcome.winner === 'timeout') record.timeouts++;
          else record.losses++;
        }
      }
      console.log(
        JSON.stringify({
          event: 'match',
          pair: agg.pair,
          a,
          b,
          seed,
          swapped,
          personalityRotated,
          west: westNation,
          east: eastNation,
          winner: outcome.winner,
          victory: result.victory,
          seconds: result.seconds,
          aiSeeds: result.aiSeeds,
          margin: outcome.aScore - outcome.bScore,
          aScore: outcome.aScore,
          bScore: outcome.bScore,
          aSide,
          bSide,
        }),
      );
      }
    }
  }
  return agg;
}

// A full sweep is 45 pairings x 2 seats x 2 personalities x N seeds, so a long
// run can be split across processes and its JSON lines concatenated afterwards:
//   MCA_PAIRS=lithuania-poland,uk-finland MCA_CONTROL=0 npx tsx tools/nation-matchups.ts 3 600 elite
const pairFilter = (process.env.MCA_PAIRS ?? '')
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);
const selectedPairs =
  pairFilter.length > 0
    ? PAIRS.filter(([a, b]) => {
        const forward = `${a}-${b}`.toLowerCase();
        const reverse = `${b}-${a}`.toLowerCase();
        return pairFilter.includes(forward) || pairFilter.includes(reverse);
      })
    : PAIRS;
const runControl = process.env.MCA_CONTROL !== '0';

// Baseline control: the two legacy presets, which both resolve the shared
// baseline. They are not part of the nation matrix.
const control = runControl ? runPair('baltic', 'expeditionary', false) : null;
if (control) {
  console.log(JSON.stringify({ event: 'pair-summary', ...control, control: true }));
}

for (const [a, b] of selectedPairs) {
  const agg = runPair(a, b);
  aggregate.push(agg);
  console.log(JSON.stringify({ event: 'pair-summary', ...agg, avgMargin: +(agg.margin / agg.games).toFixed(0) }));
}

console.log(
  JSON.stringify({
    event: 'nation-summary',
    nations: NATION_IDS.map((nation) => ({
      ...nationRecord[nation],
      ...variantSummary(nation, nationSides[nation]),
    })),
  }),
);

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const totalMatches = aggregate.reduce((n, p) => n + p.games, 0) + (control?.games ?? 0);
console.log(JSON.stringify({ event: 'done', pairs: selectedPairs.length, matches: totalMatches, elapsedSeconds: elapsed }));
