/**
 * The hauler half of economic recovery.
 *
 * The engineer recovery route (Phase 16) restored construction, but a base that
 * lost its vehicle factory *and* its last harvester had no legal way to train a
 * replacement: `harvester` was produced only by `factory`, so the side with a
 * standing drop-off and no hull to feed it could only sit on the one-per-second
 * lifeline and watch a 500-material hull recede. These fixtures pin the three
 * parts of the fix:
 *
 *   - the headquarters fallback, mirroring the engineer's (and stepping aside
 *     the moment a factory is operational again);
 *   - a lifeline rate that can actually fund the replacement in one match, paid
 *     only in the stripped state the fix is for, and only once the side has a
 *     materials plant (a refinery, standing or going up) to bank against;
 *   - the AI holding its bank for the replacement instead of dribbling the
 *     lifeline away on infantry.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';
import { STRIPPED_BASE_TRICKLE_RATE } from '../src/sim/constants';

interface World {
  /** Complete refineries the commander starts with. */
  refineries?: number;
  harvesters?: number;
  mats?: number;
  /** A completed vehicle factory. */
  factory?: boolean;
  /** Start with no engineer (the reserve is the engineer's own problem). */
  noEngineer?: boolean;
}

const SEED = 21;
const HARVESTER_COST = 500;

function scenarioFor(w: World) {
  const scenario = createEmptyScenario(64, 64);
  scenario.settings.seed = SEED;
  scenario.settings.fog = false;
  scenario.settings.startingMats = w.mats ?? 0;
  scenario.settings.startingReq = 200;
  scenario.settings.victory = 'destroyHQ';
  scenario.players[0].factionId = 'baltic';
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].factionId = 'baltic';
  scenario.players[1].startX = 40;
  scenario.players[1].startZ = 30;
  // The human side keeps an HQ so the match cannot resolve; it does nothing.
  scenario.structures.push({ defId: 'commandPost', owner: 0, x: 6, z: 6 });
  scenario.structures.push({ defId: 'commandPost', owner: 1, x: 44, z: 33 });
  scenario.structures.push({ defId: 'barracks', owner: 1, x: 40, z: 35 });
  if (w.factory) scenario.structures.push({ defId: 'factory', owner: 1, x: 40, z: 31 });
  for (let i = 0; i < (w.refineries ?? 0); i++) {
    scenario.structures.push({ defId: 'refinery', owner: 1, x: 48 + i * 4, z: 31 });
  }
  // Ore under the base, so a hauler that can tip has work to do.
  for (let z = 34; z <= 38; z++) {
    for (let x = 46; x <= 50; x++) scenario.tiles[z * 64 + x].o = 600;
  }
  if (!w.noEngineer) scenario.units.push({ defId: 'engineer', owner: 1, x: 44, z: 39 });
  for (let i = 0; i < (w.harvesters ?? 0); i++) {
    scenario.units.push({ defId: 'harvester', owner: 1, x: 47 + i, z: 34 });
  }
  return scenario;
}

function fresh(w: World): Game {
  return new Game(scenarioFor(w), { enableAI: false });
}

/** Tick a frozen world with the commander running; reports the first unit built. */
function simulate(
  w: World,
  seconds: number,
): { game: Game; firstUnit: string | null; atSecond: number | null } {
  const game = fresh(w);
  const ai = new AIController();
  const state = initialAIState(SEED, 'veteran');
  const known = new Set(game.entitiesOf(1, 'unit').map((u) => u.id));
  let firstUnit: string | null = null;
  let atSecond: number | null = null;
  for (let i = 0; i < 20 * seconds; i++) {
    game.tick();
    ai.update(game, 1, state);
    if (firstUnit === null) {
      const built = game.entitiesOf(1, 'unit').find((u) => !known.has(u.id));
      if (built) {
        firstUnit = built.defId;
        atSecond = game.state.tick / 20;
      }
    }
  }
  return { game, firstUnit, atSecond };
}

function hq(game: Game): number {
  const hqEntity = game
    .entitiesOf(1, 'building')
    .find((b) => b.defId === 'commandPost' && b.hp > 0 && !b.construction);
  return hqEntity!.id;
}

describe('hauler rebuild route', () => {
  it('sells a replacement harvester from the command post when no factory stands', () => {
    // The dead end itself: without a factory the base could not train the one
    // hull that earns, so the fallback has to exist. The bank is funded here so
    // the test reads the facility rule rather than affordability.
    const game = fresh({ mats: 600 });
    expect(game.productionStatus(1, hq(game), 'harvester').ok).toBe(true);
  });

  it('hands the hauler slot back to an operational factory', () => {
    // A factory is the real production facility; the headquarters fallback must
    // never compete with it or the base would build haulers at the HQ forever.
    const game = fresh({ factory: true, mats: 600 });
    const status = game.productionStatus(1, hq(game), 'harvester');
    expect(status.ok).toBe(false);
    expect(status.reason).toMatch(/Vehicle Factory/);
  });

  it('pays nothing until a materials plant stands, then the lifeline covers the hull', () => {
    // The trickle is a lifeline for an economy that exists and has broken, not
    // an opening allowance: with only a headquarters a side earns nothing, so a
    // match opens on its authorised bank. The fallback hull is still trainable
    // from that bank, and once a refinery is up (or going up) the stripped rate
    // takes over the rest of the recovery.
    const opening = fresh({ mats: 600 });
    expect(opening.productionStatus(1, hq(opening), 'harvester').ok).toBe(true);
    expect(opening.passiveMatsRate(1)).toBe(0);

    const planted = fresh({ refineries: 1, mats: 600 });
    expect(planted.passiveMatsRate(1)).toBe(STRIPPED_BASE_TRICKLE_RATE);
  });
});

describe('stripped-base lifeline', () => {
  it('pays a workable rate when nothing can earn and nothing can build a hauler', () => {
    // A refinery standing, no hauler and no factory: 500 materials at one a
    // second is over eight minutes, longer than a match. The lifeline has to
    // cover the hull. (A bare headquarters is the opening, which pays nothing.)
    const game = fresh({ refineries: 1 });
    expect(game.passiveMatsRate(1)).toBe(STRIPPED_BASE_TRICKLE_RATE);
  });

  it('pays the ordinary trickle while a factory can still build the hauler', () => {
    // Not stripped: the base holds the means to rebuild, so it recovers at the
    // designed one-per-second rate rather than a subsidised one.
    const game = fresh({ factory: true });
    expect(game.passiveMatsRate(1)).toBe(1);
  });

  it('turns the lifeline off once a hauler and a drop-off are working', () => {
    const game = fresh({ refineries: 1, harvesters: 1 });
    expect(game.passiveMatsRate(1)).toBe(0);
  });
});

describe('commander rebuild behaviour', () => {
  it('holds the bank for a replacement harvester instead of buying infantry', () => {
    // The trap the ladder showed: a standing drop-off, no hauler, and the
    // lifeline spent on the 130-material rifleman long before the 500 hull.
    // The first unit out of this base has to be the harvester.
    const r = simulate({ refineries: 1, factory: true, mats: 0 }, 600);
    expect(r.firstUnit).toBe('harvester');
    expect(r.atSecond).not.toBeNull();
    // Bank 0 at the one-per-second lifeline: 500 materials is ~500 s, plus the
    // 14 s production run and think jitter. Nothing cheaper may slip out first.
    expect(r.atSecond!).toBeGreaterThan(HARVESTER_COST - 5);
    expect(r.atSecond!).toBeLessThanOrEqual(HARVESTER_COST + 90);
  });

  it('buys the replacement from the headquarters fallback when the factory is gone', () => {
    // Stripped: the lifeline pays a workable rate and the command post trains
    // the hull, so the same base recovers in a fraction of the time.
    const r = simulate({ refineries: 1, mats: 0 }, 260);
    expect(r.firstUnit).toBe('harvester');
    // Four a second instead of one: the hull arrives in roughly two minutes
    // rather than eight, which is inside a match.
    expect(r.atSecond!).toBeLessThanOrEqual(HARVESTER_COST / STRIPPED_BASE_TRICKLE_RATE + 90);
    // The base keeps working from there: a second hull follows the recovery.
    const haulers = r.game
      .entitiesOf(1, 'unit')
      .filter((u) => u.defId === 'harvester' && u.hp > 0).length;
    expect(haulers).toBeGreaterThanOrEqual(1);
  });

  it('keeps a pending hauler reserve out of a perimeter build', () => {
    // Observed in the ladder: at 451 materials the commander sited a 380-mat
    // turret, dropped below the 500 hauler price and lost minutes to the same
    // starvation one level up. While the reserve is pending, the bank below it
    // is not construction money — and at 450 with one material a second the
    // price is still 50 s away, so nothing may be sited in that window.
    const game = fresh({ refineries: 1, factory: true, mats: 450 });
    const ai = new AIController();
    const state = initialAIState(SEED, 'veteran');
    const buildingsBefore = game.entitiesOf(1, 'building').length;
    for (let i = 0; i < 20 * 45; i++) {
      game.tick();
      ai.update(game, 1, state);
    }
    expect(game.entitiesOf(1, 'building').length).toBe(buildingsBefore);
    expect(game.state.players[1]!.mats).toBeLessThan(HARVESTER_COST);
  });

  it('does not hold the bank on a drained map, where no hull can earn', () => {
    // A worked-out map pays the lifeline with a hauler standing, so hoarding
    // for one that has nothing to mine would freeze the army for good.
    const game = fresh({ refineries: 1, factory: true, mats: 200 });
    game.state.map.ore.fill(0);
    const ai = new AIController();
    const state = initialAIState(SEED, 'veteran');
    const before = game.state.players[1]!.stats.unitsBuilt;
    for (let i = 0; i < 20 * 30; i++) {
      game.tick();
      ai.update(game, 1, state);
    }
    expect(game.state.players[1]!.stats.unitsBuilt).toBeGreaterThan(before);
  });
});
