/**
 * Siege duels: a defended command post against a fixed attacking force.
 *
 * Phase 7 showed that damage repaired on a command post can exceed the damage
 * an arriving group delivers. These fixtures isolate that exchange: no AI, no
 * economy decisions, no map objectives — one post, N engineers and a stated
 * attacker set, played deterministically.
 *
 * Repair-rule candidates are imposed from outside the simulation so no
 * production code has to change while they are evaluated:
 *
 *   control    the shipped rule: 3.5 % max HP/s per engineer, free, and
 *              suspended for a second after the structure takes a hit
 *              (Phase 8 implemented that suppression in the engine)
 *   cost       every repaired HP is paid for from the owner's materials at the
 *              recovery vehicle's 0.45 M/HP rate; repair the owner cannot
 *              afford is rolled back
 *   interrupt  the pre-implementation approximation of the shipped rule, kept
 *              only to reproduce the Phase 8 experiment that motivated it
 *   cap        only one engineer's worth of repair applies to a structure per
 *              tick, however many engineers are working it
 *
 * Rollback is an approximation of the candidate rule, not an implementation:
 * it is applied after the engine's repair tick, so it can only remove progress.
 * That is enough to measure the ceiling each rule would impose.
 *
 *   npx tsx tools/siege-duels.ts [seconds=180]
 */
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import type { ScenarioUnit } from '../src/sim/scenario';

export type RepairRule = 'control' | 'cost' | 'interrupt' | 'cap';

/** The rate the recovery vehicle charges for field repair, in materials per HP. */
export const REPAIR_COST_PER_HP = 0.45;
/** The shipped engineer rate: fraction of max HP restored per engineer per second. */
const ENGINEER_RATE = 0.035;

const args = process.argv.slice(2);
const maxSeconds = Math.max(30, Math.min(600, Number(args[0] ?? 180)));

interface AttackerSet {
  name: string;
  units: string[];
}

const ATTACKERS: AttackerSet[] = [
  { name: '1 tank', units: ['tank'] },
  { name: '2 tanks', units: ['tank', 'tank'] },
  { name: '3 tanks', units: ['tank', 'tank', 'tank'] },
  { name: '4 tanks', units: ['tank', 'tank', 'tank', 'tank'] },
  { name: '6 tanks', units: Array(6).fill('tank') },
  { name: '2 SPG', units: ['spg', 'spg'] },
  { name: '2 MLRS', units: ['mlrs', 'mlrs'] },
  { name: '2 heavy howitzers', units: ['heavyHowitzer', 'heavyHowitzer'] },
  { name: '2 tanks + 2 SPG', units: ['tank', 'tank', 'spg', 'spg'] },
];

interface DuelOptions {
  attackers: string[];
  engineers: number;
  rule: RepairRule;
  bank: number;
  seconds: number;
}

interface DuelResult {
  rule: RepairRule;
  attackers: string;
  engineers: number;
  bank: number;
  destroyedSeconds: number | null;
  endHpPct: number;
  grossDamage: number;
  repaired: number;
  /** Materials actually spent on repair under the cost rule. */
  repairSpend: number;
}

function runDuel(opts: DuelOptions): DuelResult {
  const scenario = createEmptyScenario(48, 48);
  scenario.settings.seed = 909;
  scenario.settings.fog = false;
  scenario.settings.startingMats = 4000;
  scenario.settings.startingReq = 0;
  scenario.players[0].factionId = 'baltic';
  scenario.players[1].factionId = 'expeditionary';
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 14, z: 20 },
    { defId: 'commandPost', owner: 1, x: 42, z: 42 },
  );
  for (let i = 0; i < opts.engineers; i++) {
    scenario.units.push({ defId: 'engineer', owner: 0, x: 18 + i, z: 20 });
  }
  opts.attackers.forEach((defId, i) => {
    scenario.units.push({
      defId,
      owner: 1,
      x: 26 + Math.floor(i / 3) * 2,
      z: 16 + (i % 3) * 3,
    });
  });

  const game = new Game(scenario, { enableAI: false });
  const post = game.state.entities.find(
    (e) => e.kind === 'building' && e.owner === 0 && e.defId === 'commandPost',
  )!;
  // The attacking force is not given an AI: every hull is ordered onto the post.
  const attackers = game.entitiesOf(1, 'unit').filter((e) => e.defId !== 'engineer');
  game.enqueueCommand({
    type: 'attack',
    team: 1,
    ids: attackers.map((e) => e.id),
    targetId: post.id,
  });
  const owner = game.player(0)!;
  owner.mats = opts.bank;

  let gross = 0;
  let repaired = 0;
  let repairSpend = 0;
  let previous = post.hp;
  let destroyedAt: number | null = null;
  const dt = 1 / 20;

  for (let i = 0; i < 20 * opts.seconds && game.state.victory === 'playing'; i++) {
    game.tick();

    // Keep the engineer on the job whenever it is free and the post is hurt.
    // Re-issuing once a second matches the AI's own think cadence rather than
    // giving the defender superhuman micromanagement.
    if (i % 20 === 0 && post.hp > 0 && post.hp < post.maxHp) {
      const engineers = game
        .entitiesOf(0, 'unit')
        .filter((e) => e.defId === 'engineer' && e.hp > 0);
      const underFire = game.state.tick - post.lastHitTick < 20;
      if (opts.rule === 'interrupt' && underFire) {
        for (const e of engineers) {
          if (e.order?.type === 'repair') {
            e.order = null;
            e.state = 'idle';
          }
        }
      } else if (engineers.length > 0) {
        const chosen = opts.rule === 'cap' ? engineers.slice(0, 1) : engineers;
        game.enqueueCommand({
          type: 'repair',
          team: 0,
          ids: chosen.map((e) => e.id),
          targetId: post.id,
        });
      }
    }

    // Candidate rules that remove progress the engine granted this tick.
    const gained = post.hp - previous;
    if (gained > 0 && post.hp > 0) {
      if (opts.rule === 'cost') {
        const charge = gained * REPAIR_COST_PER_HP;
        if (owner.mats >= charge) {
          owner.mats -= charge;
          repairSpend += charge;
        } else {
          const affordable = Math.max(0, owner.mats / REPAIR_COST_PER_HP);
          post.hp = previous + affordable;
          repairSpend += owner.mats;
          owner.mats = 0;
        }
      } else if (opts.rule === 'interrupt') {
        if (game.state.tick - post.lastHitTick < 20) post.hp = previous;
      } else if (opts.rule === 'cap') {
        const oneEngineer = post.maxHp * ENGINEER_RATE * dt;
        if (gained > oneEngineer) post.hp = previous + oneEngineer;
      }
    }

    const now = post.hp;
    if (now < previous) gross += previous - now;
    else repaired += now - previous;
    previous = now;

    if (post.hp <= 0) {
      destroyedAt = +((i + 1) / 20).toFixed(1);
      break;
    }
  }

  return {
    rule: opts.rule,
    attackers: opts.attackers.join('+'),
    engineers: opts.engineers,
    bank: opts.bank,
    destroyedSeconds: destroyedAt,
    endHpPct: +((Math.max(0, post.hp) / post.maxHp) * 100).toFixed(0),
    grossDamage: Math.round(gross),
    repaired: Math.round(repaired),
    repairSpend: Math.round(repairSpend),
  };
}

interface RunSpec {
  attackers: string[];
  engineers: number;
  rule: RepairRule;
  bank: number;
}

const RUNS: RunSpec[] = [];
for (const set of ATTACKERS) {
  RUNS.push({ attackers: set.units, engineers: 1, rule: 'control', bank: 3000 });
  RUNS.push({ attackers: set.units, engineers: 1, rule: 'cost', bank: 3000 });
  RUNS.push({ attackers: set.units, engineers: 1, rule: 'cost', bank: 200 });
}
// Multiple engineers are the one case where the shipped rule is unbounded:
// every engineer adds a full 3.5 %/s.
for (const name of ['2 tanks', '4 tanks', '6 tanks']) {
  const units = ATTACKERS.find((a) => a.name === name)!.units;
  for (const rule of ['control', 'cost', 'cap'] as RepairRule[]) {
    RUNS.push({ attackers: units, engineers: 2, rule, bank: 3000 });
  }
}
// The marginal band: where repair actually decides the outcome, compare the
// structural limit (one engineer's throughput) with the economic one at a bank
// a mid-match commander would plausibly hold.
for (const set of ATTACKERS) {
  RUNS.push({ attackers: set.units, engineers: 2, rule: 'control', bank: 3000 });
  RUNS.push({ attackers: set.units, engineers: 2, rule: 'cap', bank: 3000 });
  RUNS.push({ attackers: set.units, engineers: 2, rule: 'cost', bank: 800 });
}
// No repair at all, as the pure attacker-versus-structure baseline.
RUNS.push({ attackers: ['tank', 'tank', 'tank', 'tank'], engineers: 0, rule: 'control', bank: 3000 });

const results = RUNS.map((run) => runDuel({ ...run, seconds: maxSeconds }));

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : +(xs.reduce((n, v) => n + v, 0) / xs.length).toFixed(1);

for (const r of results) {
  console.log(JSON.stringify({ event: 'duel', ...r }));
}

// Aggregates the report quotes: how often the post falls, and how much of the
// incoming damage the defender erased.
const byEngineerRule = new Map<string, DuelResult[]>();
for (const r of results) {
  const key = `${r.engineers}eng/${r.rule}${r.rule === 'cost' ? `@${r.bank}` : ''}`;
  const list = byEngineerRule.get(key) ?? [];
  list.push(r);
  byEngineerRule.set(key, list);
}
const summary: Record<string, unknown> = {};
for (const [key, list] of byEngineerRule) {
  summary[key] = {
    duels: list.length,
    postsDestroyed: list.filter((r) => r.destroyedSeconds !== null).length,
    meanDestroySeconds: mean(list.filter((r) => r.destroyedSeconds !== null).map((r) => r.destroyedSeconds!)),
    meanGrossDamage: mean(list.map((r) => r.grossDamage)),
    meanRepaired: mean(list.map((r) => r.repaired)),
    meanEndHpPct: mean(list.map((r) => r.endHpPct)),
    meanRepairSpend: mean(list.map((r) => r.repairSpend)),
  };
}
console.log(JSON.stringify({ event: 'summary', maxSeconds, summary }));
