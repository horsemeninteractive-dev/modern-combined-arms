/**
 * Commander-ladder probe.
 *
 * The matchup test measures a score margin. That number says a level lost, not
 * why. This harness runs the same symmetric arena with two real AI controllers
 * and records the bookkeeping a balance argument needs: what each side built,
 * what it lost, what it gathered, how large its army was, what it fired and
 * what was left at the end.
 *
 * Test-only, like `combatBench.ts`: nothing in `src/` imports it and the
 * simulation is untouched. `GameClass` is injectable so a diagnostic can run the
 * same scenario against a different revision of the simulation without editing
 * the working tree.
 */
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';
import { UNITS } from '../src/data/units';
import { BUILDINGS } from '../src/data/buildings';
import type { AIDifficulty, Entity } from '../src/sim/types';

/** Same deep field as the matchup test; see the note there. */
const ARENA_ORE = 3600;

export function matchupScenario() {
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

/** Material-weighted board value, identical to the matchup test's measure. */
export function sideScore(game: Game, id: number): number {
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

/** Material value of the hulls a side still has on the board. */
function armyValue(game: Game, id: number): number {
  let value = 0;
  for (const e of game.entitiesOf(id)) {
    if (e.kind !== 'unit') continue;
    const def = UNITS[e.defId];
    value += (def?.cost.mats ?? 0) + (def?.cost.req ?? 0) * 1.5;
  }
  return Math.round(value);
}

export interface SideMetrics {
  score: number;
  /** Completed hulls of each kind, including the ones that later died. */
  built: Record<string, number>;
  /** The first eight hulls in the order they appeared. */
  productionOrder: string[];
  /** Hulls lost, by kind. */
  lost: Record<string, number>;
  kills: number;
  matsGathered: number;
  matsBanked: number;
  reqBanked: number;
  /** Peak and mean hulls with a weapon on the field. */
  peakArmy: number;
  meanArmy: number;
  /** Hulls and structures left when the match ended. */
  survivors: Record<string, number>;
  buildingsBuilt: number;
  /** Every weapon this side fired, with its shot count. */
  shots: Record<string, number>;
  /** The first shot, for the record. */
  firstShot: { tick: number; weaponId: string } | null;
  /** The first combat hull this side lost. */
  firstLoss: { tick: number; defId: string } | null;
  /** Material value of surviving hulls. */
  survivorValue: number;
  /** Combat-hull value sampled every 30 seconds. */
  armyValueSamples: number[];
  /** Assault waves the commander committed. */
  waves: number;
  lastDecision: string;
}

export interface LadderResult {
  seed: number;
  westDifficulty: AIDifficulty;
  eastDifficulty: AIDifficulty;
  west: SideMetrics;
  east: SideMetrics;
  ticks: number;
  seconds: number;
  victory: string;
  /** `knockout` when a command post fell or a side was defeated, `clock` otherwise. */
  terminatedBy: 'knockout' | 'clock';
  winner: 'west' | 'east' | 'draw';
}

type GameClass = new (
  scenario: ReturnType<typeof matchupScenario>,
  options: { enableAI: boolean },
) => Game;

function isCombatHull(e: Entity): boolean {
  if (e.kind !== 'unit') return false;
  const def = UNITS[e.defId];
  return (def?.weapons.length ?? 0) > 0;
}

export function runLadderMatch(
  westDifficulty: AIDifficulty,
  eastDifficulty: AIDifficulty,
  seed: number,
  maxSeconds = 600,
  GameClassRef: GameClass = Game,
): LadderResult {
  const game = new GameClassRef(matchupScenario(), { enableAI: false });
  const west = new AIController();
  const east = new AIController();
  const westState = initialAIState(seed, westDifficulty);
  const eastState = initialAIState(seed, eastDifficulty);

  const initial = new Set(game.state.entities.map((e) => e.id));
  const known = new Map<number, Map<number, string>>([
    [0, new Map()],
    [1, new Map()],
  ]);
  const built: Record<0 | 1, Record<string, number>> = { 0: {}, 1: {} };
  const productionOrder: Record<0 | 1, string[]> = { 0: [], 1: [] };
  const lost: Record<0 | 1, Record<string, number>> = { 0: {}, 1: {} };
  const firstLoss: Record<0 | 1, { tick: number; defId: string } | null> = {
    0: null,
    1: null,
  };
  const shots: Record<0 | 1, Record<string, number>> = { 0: {}, 1: {} };
  const firstShot: Record<0 | 1, { tick: number; weaponId: string } | null> = {
    0: null,
    1: null,
  };
  const armySum: Record<0 | 1, number> = { 0: 0, 1: 0 };
  const armyPeak: Record<0 | 1, number> = { 0: 0, 1: 0 };
  const armyValueSamples: Record<0 | 1, number[]> = { 0: [], 1: [] };
  let samples = 0;
  let lastSeq = 0;

  for (let i = 0; i < 20 * maxSeconds && game.state.victory === 'playing'; i++) {
    game.tick();
    west.update(game, 0, westState);
    east.update(game, 1, eastState);

    for (const event of game.state.events) {
      if (event.seq <= lastSeq) continue;
      lastSeq = event.seq;
      if (event.type !== 'shot') continue;
      const weaponId = (event as { weaponId?: string }).weaponId;
      const owner = event.team;
      if (!weaponId || (owner !== 0 && owner !== 1)) continue;
      shots[owner][weaponId] = (shots[owner][weaponId] ?? 0) + 1;
      if (!firstShot[owner]) firstShot[owner] = { tick: game.state.tick, weaponId };
    }

    for (const owner of [0, 1] as const) {
      const live = new Map<number, string>();
      let army = 0;
      for (const e of game.entitiesOf(owner)) {
        if (e.kind !== 'unit') continue;
        live.set(e.id, e.defId);
        if (isCombatHull(e)) army++;
        if (!initial.has(e.id) && !known.get(owner)!.has(e.id)) {
          built[owner][e.defId] = (built[owner][e.defId] ?? 0) + 1;
          if (productionOrder[owner].length < 8) productionOrder[owner].push(e.defId);
        }
      }
      for (const [id, defId] of known.get(owner)!) {
        if (live.has(id)) continue;
        // A hull that was built and is gone now was destroyed, not refunded.
        lost[owner][defId] = (lost[owner][defId] ?? 0) + 1;
        if (!firstLoss[owner] && isCombatHullDef(defId)) {
          firstLoss[owner] = { tick: game.state.tick, defId };
        }
      }
      known.set(owner, live);
      armySum[owner] += army;
      armyPeak[owner] = Math.max(armyPeak[owner], army);
    }
    if (game.state.tick % (20 * 30) === 0) {
      armyValueSamples[0].push(armyValue(game, 0));
      armyValueSamples[1].push(armyValue(game, 1));
    }
    samples++;
  }

  const measure = (owner: 0 | 1): SideMetrics => {
    const survivors: Record<string, number> = {};
    for (const e of game.entitiesOf(owner)) {
      survivors[e.defId] = (survivors[e.defId] ?? 0) + 1;
    }
    const p = game.player(owner)!;
    return {
      score: sideScore(game, owner),
      built: built[owner],
      productionOrder: productionOrder[owner],
      lost: lost[owner],
      kills: p.stats.kills,
      matsGathered: Math.round(p.stats.matsGathered),
      matsBanked: Math.round(p.mats),
      reqBanked: Math.round(p.req),
      peakArmy: armyPeak[owner],
      meanArmy: samples === 0 ? 0 : Math.round((armySum[owner] / samples) * 10) / 10,
      survivors,
      buildingsBuilt: p.stats.buildingsBuilt,
      shots: shots[owner],
      firstShot: firstShot[owner],
      firstLoss: firstLoss[owner],
      survivorValue: armyValue(game, owner),
      armyValueSamples: armyValueSamples[owner],
      waves: owner === 0 ? westState.attackWave : eastState.attackWave,
      lastDecision: owner === 0 ? westState.lastDecision : eastState.lastDecision,
    };
  };

  const westMetrics = measure(0);
  const eastMetrics = measure(1);
  const margin = westMetrics.score - eastMetrics.score;
  const terminatedBy: 'knockout' | 'clock' =
    game.state.victory === 'playing' ? 'clock' : 'knockout';
  return {
    seed,
    westDifficulty,
    eastDifficulty,
    west: westMetrics,
    east: eastMetrics,
    ticks: game.state.tick,
    seconds: Math.round(game.state.tick / 20),
    victory: game.state.victory,
    terminatedBy,
    winner: margin > 0 ? 'west' : margin < 0 ? 'east' : 'draw',
  };
}

function isCombatHullDef(defId: string): boolean {
  const def = UNITS[defId];
  return (def?.weapons.length ?? 0) > 0;
}
