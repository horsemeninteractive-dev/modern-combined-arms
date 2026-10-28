/**
 * Shared national-matchup arena.
 *
 * The harness (`tools/nation-matchups.ts`) and the timeout audit
 * (`tools/timeout-audit.ts`) must measure the same battlefield, or their
 * numbers cannot be compared. This module holds the single definition of the
 * arena, the seed pool and the material-weighted board score.
 *
 * It is a diagnostic helper, not game code: nothing under `src/` imports it.
 */
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { UNITS } from '../src/data/units';
import { BUILDINGS } from '../src/data/buildings';
import { NATIONS, PLAYABLE_NATION_IDS } from '../src/data/factions';

export const NATION_IDS = [...PLAYABLE_NATION_IDS];

export const VARIANT_BY_NATION: Readonly<Record<string, string>> = {
  lithuania: 'pathfinder',
  poland: 'spearhead',
  uk: 'mlrs',
  russia: 'heavyHowitzer',
  belarus: 'deepReconUAV',
  hungary: 'bunker',
};

/** All 15 unordered pairings, in registry order. */
export const PAIRS: Array<[string, string]> = [];
for (let i = 0; i < NATION_IDS.length; i++) {
  for (let j = i + 1; j < NATION_IDS.length; j++) {
    PAIRS.push([NATION_IDS[i], NATION_IDS[j]]);
  }
}

/** The Phase 5/6 seed pool, kept identical for direct comparison. */
export const BASE_SEEDS = [101, 1078, 2055, 3032, 4009];

/**
 * Materials per authored ore tile. The shipped maps use 260-340 per tile,
 * which is one harvester load: a match there burns through every deposit in
 * about three minutes. The ladder therefore uses a two-load field so economy
 * decisions have time to pay for themselves.
 *
 * Phase 10 needed to know how much of the late-game collapse is this field being
 * finite, so the value can be overridden for a diagnostic arm:
 *   MCA_ARENA_ORE=1200 npx tsx tools/timeout-audit.ts 3 600 veteran
 * The default is unchanged, so every earlier result still reproduces.
 */
export const ARENA_ORE = (() => {
  const raw = Number(process.env.MCA_ARENA_ORE ?? '');
  return Number.isFinite(raw) && raw >= 100 ? Math.min(5000, raw) : 600;
})();

/**
 * A deliberately symmetric 64x64 arena. The command posts face each other
 * across 27 tiles of open ground; every deposit is mirrored in x.
 */
export function matchupScenario(westNation: string, eastNation: string, seed: number) {
  const scenario = createEmptyScenario(64, 64);
  scenario.meta.id = 'national-matchup-audit';
  scenario.meta.name = 'National Matchup Audit';
  scenario.settings.seed = seed;
  scenario.settings.startingMats = 3000;
  scenario.settings.startingReq = 180;
  scenario.settings.fog = true;
  scenario.settings.victory = 'destroyHQ';
  scenario.settings.timeLimitSec = null;
  scenario.settings.weather = 'clear';
  scenario.settings.timeOfDay = 'dusk';
  scenario.players[0].name = NATIONS[westNation]?.name ?? westNation;
  scenario.players[0].factionId = westNation;
  scenario.players[0].team = 0;
  scenario.players[0].isAI = false;
  scenario.players[0].startX = 18;
  scenario.players[0].startZ = 37;
  scenario.players[1].name = NATIONS[eastNation]?.name ?? eastNation;
  scenario.players[1].factionId = eastNation;
  scenario.players[1].team = 1;
  scenario.players[1].isAI = false;
  scenario.players[1].startX = 45;
  scenario.players[1].startZ = 37;
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
export function sideScore(game: Game, id: number): number {
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

/**
 * A second, independent seed set can be supplied for reproduction runs:
 *   MCA_SEEDS=11,555,999 npx tsx tools/nation-matchups.ts 3 600
 */
export function seedPool(): number[] {
  const env = (process.env.MCA_SEEDS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return env.length > 0 ? env : BASE_SEEDS;
}
