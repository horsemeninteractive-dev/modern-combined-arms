/**
 * Indirect-fire and fortification experiments.
 *
 * The national matrix can only observe: nations differ in many ways at once.
 * These fixtures hold everything except one factor constant on the shared
 * arena, both sides playing the legacy `baltic` / `expeditionary` presets so
 * neither side has a national substitution:
 *
 *   control        baseline army on both sides
 *   tanks-both     two extra tanks each — a material control for the artillery arm
 *   arty-both      two extra SPGs each — is artillery presence alone enough to stall?
 *   arty-vs-tank   two SPGs against two tanks — the intended counterplay
 *   bunker-both    one extra reinforced bunker covering each approach
 *   bunker-arty    a bunker and one SPG each — does artillery answer a bunker?
 *
 * Every fixture is played with both commander personalities on both sides, so
 * a lucky seed is not mistaken for a mechanism. Nothing here changes game code:
 * the extra units and structures are part of the scenario, and everything else
 * runs through the normal command API.
 *
 *   npx tsx tools/indirect-fire-experiments.ts [seeds=8] [maxSeconds=600]
 */
import { Game } from '../src/sim/game';
import { AIController, initialAIState } from '../src/sim/ai';
import type { AIDifficulty } from '../src/sim/types';
import { BUILDINGS } from '../src/data/buildings';
import { WEAPONS } from '../src/data/weapons';
import { matchupScenario } from './matchup-arena';
import type { Scenario, ScenarioUnit } from '../src/sim/scenario';

const args = process.argv.slice(2);
const seedCount = Math.max(1, Number(args[0] ?? 8));
const maxSeconds = Math.max(60, Math.min(1200, Number(args[1] ?? 600)));
const difficulty = (args[2] ?? 'veteran') as AIDifficulty;
const SEEDS = [131, 977, 1601, 2311, 3109, 4051, 5003, 6007].slice(0, seedCount);

const INDIRECT_WEAPONS = new Set(
  Object.values(WEAPONS)
    .filter((w) => w.indirect)
    .map((w) => w.id),
);

type FixtureName =
  | 'control'
  | 'tanks-both'
  | 'arty-both'
  | 'arty-vs-tank'
  | 'bunker-both'
  | 'bunker-arty';

interface Fixture {
  name: FixtureName;
  description: string;
  apply(scenario: Scenario): void;
}

/** Mirror a tile x coordinate about the arena centre line. */
const mirrorX = (x: number): number => 63 - x;

const unit = (defId: string, owner: number, x: number, z: number): ScenarioUnit => ({
  defId,
  owner,
  x: owner === 0 ? x : mirrorX(x),
  z,
});

const FIXTURES: Fixture[] = [
  { name: 'control', description: 'standard arena, no intervention', apply: () => {} },
  {
    name: 'tanks-both',
    description: 'two extra MBTs per side',
    apply: (s) => {
      s.units.push(unit('tank', 0, 24, 30), unit('tank', 0, 24, 33));
      s.units.push(unit('tank', 1, 24, 30), unit('tank', 1, 24, 33));
    },
  },
  {
    name: 'arty-both',
    description: 'two extra SPGs per side',
    apply: (s) => {
      s.units.push(unit('spg', 0, 24, 30), unit('spg', 0, 24, 33));
      s.units.push(unit('spg', 1, 24, 30), unit('spg', 1, 24, 33));
    },
  },
  {
    name: 'arty-vs-tank',
    description: 'west two SPGs, east two MBTs',
    apply: (s) => {
      s.units.push(unit('spg', 0, 24, 30), unit('spg', 0, 24, 33));
      s.units.push(unit('tank', 1, 24, 30), unit('tank', 1, 24, 33));
    },
  },
  {
    name: 'bunker-both',
    description: 'one extra reinforced bunker guarding each approach',
    apply: (s) => {
      s.structures.push({ defId: 'bunker', owner: 0, x: 26, z: 31 });
      s.structures.push({ defId: 'bunker', owner: 1, x: mirrorX(26), z: 31 });
    },
  },
  {
    name: 'bunker-arty',
    description: 'one extra bunker and one extra SPG per side',
    apply: (s) => {
      s.structures.push({ defId: 'bunker', owner: 0, x: 26, z: 31 });
      s.structures.push({ defId: 'bunker', owner: 1, x: mirrorX(26), z: 31 });
      s.units.push(unit('spg', 0, 24, 29), unit('spg', 1, 24, 29));
    },
  },
];

interface FixtureResult {
  fixture: FixtureName;
  seed: number;
  rotated: boolean;
  victory: string;
  timeout: boolean;
  seconds: number;
  /** Gross damage absorbed by each command post, including repaired damage. */
  hqGross: [number, number];
  /** Command-post health fraction at the end. */
  hqEndPct: [number, number];
  kills: [number, number];
  losses: [number, number];
  /** Indirect shells/rockets fired by each side. */
  shots: [number, number];
  /** Injected artillery hulls still alive at the end, and how many were lost. */
  injectedAlive: [number, number];
  injectedLost: [number, number];
  /** Lowest health fraction reached by each side's extra bunker (1 = untouched). */
  bunkerMinPct: [number, number];
  bunkerSurvived: [boolean, boolean];
}

function runFixture(fixture: Fixture, seed: number, rotated: boolean): FixtureResult {
  const scenario = matchupScenario('baltic', 'expeditionary', seed);
  const baselineUnits = scenario.units.length;
  const baselineStructures = scenario.structures.length;
  fixture.apply(scenario);

  const game = new Game(scenario, { enableAI: false });
  const west = new AIController();
  const east = new AIController();
  const westState = initialAIState(rotated ? seed + 977 : seed, difficulty);
  const eastState = initialAIState(rotated ? seed : seed + 977, difficulty);

  // Everything added by the fixture, by owner. Command posts are not part of
  // the fixture, so they cannot be confused with it.
  const injected: Array<[number[], number[]]> = [[], []];
  for (const e of game.state.entities) {
    if (e.owner !== 0 && e.owner !== 1) continue;
    if (e.kind === 'unit' && e.defId !== 'engineer' && e.defId !== 'harvester') {
      // Initial authored units are counted from index 0; fixture hulls follow.
      injected[e.owner].push(e.id);
    }
  }
  const baselineByOwner = [0, 0];
  for (const u of scenario.units.slice(0, baselineUnits)) baselineByOwner[u.owner]++;
  for (const owner of [0, 1]) {
    injected[owner] = injected[owner].slice(baselineByOwner[owner]);
  }

  const hq: Array<{ id: number; maxHp: number; x: number; z: number } | null> = [null, null];
  const bunker: Array<{ id: number; maxHp: number } | null> = [null, null];
  for (const e of game.state.entities) {
    if (e.kind !== 'building') continue;
    if (BUILDINGS[e.defId]?.commandPost) hq[e.owner] = { id: e.id, maxHp: e.maxHp, x: e.x, z: e.z };
    // Legacy presets cannot build a bunker (it is Hungary's national variant),
    // so any bunker on this arena is the fixture's.
    if (e.defId === 'bunker' && !bunker[e.owner]) {
      bunker[e.owner] = { id: e.id, maxHp: e.maxHp };
    }
  }
  void baselineStructures;

  const gross: [number, number] = [0, 0];
  const lastHp: [number, number] = [hq[0]?.maxHp ?? 0, hq[1]?.maxHp ?? 0];
  const shots: [number, number] = [0, 0];
  const seenProjectiles = new Set<number>();
  const bunkerMin: [number, number] = [1, 1];

  const limit = 20 * maxSeconds;
  for (let i = 0; i < limit && game.state.victory === 'playing'; i++) {
    game.tick();
    west.update(game, 0, westState);
    east.update(game, 1, eastState);
    for (const owner of [0, 1]) {
      const h = hq[owner];
      if (!h) continue;
      const hp = game.getEntity(h.id)?.hp ?? 0;
      if (hp < lastHp[owner]) gross[owner] += lastHp[owner] - hp;
      lastHp[owner] = hp;
      const b = bunker[owner];
      if (b) {
        const bhp = game.getEntity(b.id)?.hp ?? 0;
        bunkerMin[owner] = Math.min(bunkerMin[owner], bhp / b.maxHp);
      }
    }
    for (const p of game.state.projectiles) {
      if (seenProjectiles.has(p.id)) continue;
      seenProjectiles.add(p.id);
      if (!INDIRECT_WEAPONS.has(p.weaponId)) continue;
      if (p.owner === 0 || p.owner === 1) shots[p.owner]++;
    }
  }

  const alive: [number, number] = [0, 0];
  for (const owner of [0, 1]) {
    for (const id of injected[owner]) {
      const e = game.getEntity(id);
      if (e && e.hp > 0) alive[owner]++;
    }
  }
  const injectedTotal = [injected[0].length, injected[1].length];

  return {
    fixture: fixture.name,
    seed,
    rotated,
    victory: game.state.victory,
    timeout: game.state.victory === 'playing',
    seconds: +(game.state.tick / 20).toFixed(1),
    hqGross: [Math.round(gross[0]), Math.round(gross[1])],
    hqEndPct: [0, 1].map((o) => {
      const h = hq[o];
      return h ? +(((game.getEntity(h.id)?.hp ?? 0) / h.maxHp) * 100).toFixed(0) : 0;
    }) as [number, number],
    kills: [game.player(0)!.stats.kills, game.player(1)!.stats.kills],
    losses: [game.player(0)!.stats.unitsLost, game.player(1)!.stats.unitsLost],
    shots,
    injectedAlive: alive,
    injectedLost: [injectedTotal[0] - alive[0], injectedTotal[1] - alive[1]],
    bunkerMinPct: [+(bunkerMin[0] * 100).toFixed(0), +(bunkerMin[1] * 100).toFixed(0)],
    bunkerSurvived: [0, 1].map((o) => {
      const b = bunker[o];
      return b ? (game.getEntity(b.id)?.hp ?? 0) > 0 : true;
    }) as [boolean, boolean],
  };
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : +(xs.reduce((n, v) => n + v, 0) / xs.length).toFixed(1);
const pct = (a: number, b: number): number => (b ? Math.round((a / b) * 1000) / 10 : 0);

const summary: Record<string, unknown> = {};
for (const fixture of FIXTURES) {
  const results: FixtureResult[] = [];
  for (const seed of SEEDS) {
    for (const rotated of [false, true]) {
      const r = runFixture(fixture, seed, rotated);
      results.push(r);
      console.log(JSON.stringify({ event: 'match', ...r }));
    }
  }
  const timeouts = results.filter((r) => r.timeout).length;
  const decisive = results.filter((r) => !r.timeout);
  summary[fixture.name] = {
    description: fixture.description,
    matches: results.length,
    timeouts,
    timeoutRatePct: pct(timeouts, results.length),
    meanSecondsDecisive: mean(decisive.map((r) => r.seconds)),
    meanSecondsTimeout: mean(results.filter((r) => r.timeout).map((r) => r.seconds)),
    hqGrossMean: [mean(results.map((r) => r.hqGross[0])), mean(results.map((r) => r.hqGross[1]))],
    matchesWithHqDamage: results.filter((r) => r.hqGross[0] > 0 || r.hqGross[1] > 0).length,
    hqDamagedButStandingEnd: results.filter(
      (r) => (r.hqGross[0] >= 500 && r.hqEndPct[0] >= 85) || (r.hqGross[1] >= 500 && r.hqEndPct[1] >= 85),
    ).length,
    shotsFired: results.reduce((n, r) => n + r.shots[0] + r.shots[1], 0),
    injectedAliveEndPct: [
      pct(
        results.reduce((n, r) => n + r.injectedAlive[0], 0),
        Math.max(1, results.reduce((n, r) => n + r.injectedAlive[0] + r.injectedLost[0], 0)),
      ),
      pct(
        results.reduce((n, r) => n + r.injectedAlive[1], 0),
        Math.max(1, results.reduce((n, r) => n + r.injectedAlive[1] + r.injectedLost[1], 0)),
      ),
    ],
    bunkersSurviving: [
      results.filter((r) => r.bunkerSurvived[0]).length,
      results.filter((r) => r.bunkerSurvived[1]).length,
    ],
    bunkerMeanLowestPct: [mean(results.map((r) => r.bunkerMinPct[0])), mean(results.map((r) => r.bunkerMinPct[1]))],
    killsMean: [mean(results.map((r) => r.kills[0])), mean(results.map((r) => r.kills[1]))],
    lossesMean: [mean(results.map((r) => r.losses[0])), mean(results.map((r) => r.losses[1]))],
  };
}

console.log(
  JSON.stringify({
    event: 'summary',
    seeds: SEEDS,
    difficulty,
    maxSeconds,
    fixtures: summary,
  }),
);
