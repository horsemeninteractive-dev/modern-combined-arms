/**
 * Economic recovery after the drop-off is lost.
 *
 * Phase 14 observed that the Phase 13 flip left a commander with no refinery and
 * no bank to rebuild one. These fixtures establish whether that state is a
 * temporary delay, a recoverable sequence, or a genuine deadlock, by separating
 * the routes the simulation actually offers:
 *
 *   - hauling, which needs a refinery to tip into;
 *   - the headquarters material trickle, which is the designed lifeline for a
 *     stripped base;
 *   - the bank, which is the only way to buy a replacement drop-off;
 *   - the engineer, which is the only way to build the replacement drop-off.
 *
 * Worlds are frozen: a command post, a factory and a barracks (so no prerequisite
 * outranks the drop-off), an engineer or no engineer, optional haulers, ore under
 * the base and a fixed bank. No opponent acts. The no-engineer arms are the
 * Phase 15 §1.5 deadlock: a one-per-second trickle that a 130-material rifleman
 * can spend long before the engineer's 300 is in hand.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';

interface RecoveryWorld {
  /** Complete refineries the commander starts with. */
  refineries?: number;
  harvesters?: number;
  mats?: number;
  /** Destroy the standing refinery on the first tick. */
  destroyRefinery?: boolean;
  /** Put an unrelated structure under construction before anything else. */
  busyEngineer?: boolean;
  /** Start with no engineer at all (the Phase 15 §1.5 deadlock). */
  noEngineer?: boolean;
  /**
   * Barracks only: no command post and no factory, so the engineer cannot be
   * trained. Uses `annihilation` so the empty-HQ victory rule does not end the
   * match on the first tick.
   */
  barracksOnly?: boolean;
}

const SEED = 13;

function scenarioFor(w: RecoveryWorld) {
  const scenario = createEmptyScenario(64, 64);
  scenario.settings.seed = SEED;
  scenario.settings.fog = false;
  scenario.settings.startingMats = w.mats ?? 200;
  scenario.settings.startingReq = 200;
  scenario.settings.victory = w.barracksOnly ? 'annihilation' : 'destroyHQ';
  scenario.players[0].factionId = 'baltic';
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].factionId = 'baltic';
  scenario.players[1].startX = 40;
  scenario.players[1].startZ = 30;
  scenario.structures.push({ defId: 'commandPost', owner: 0, x: 6, z: 6 });
  if (!w.barracksOnly) {
    scenario.structures.push(
      { defId: 'commandPost', owner: 1, x: 44, z: 33 },
      { defId: 'factory', owner: 1, x: 40, z: 31 },
    );
  }
  scenario.structures.push({ defId: 'barracks', owner: 1, x: 40, z: 35 });
  for (let i = 0; i < (w.refineries ?? 0); i++) {
    scenario.structures.push({ defId: 'refinery', owner: 1, x: 48 + i * 4, z: 31 });
  }
  // Ore under the base, so a hauler that can tip has work to do.
  for (let z = 34; z <= 38; z++) {
    for (let x = 46; x <= 50; x++) scenario.tiles[z * 64 + x].o = 600;
  }
  if (!w.noEngineer && !w.barracksOnly) {
    scenario.units.push({ defId: 'engineer', owner: 1, x: 44, z: 39 });
  }
  for (let i = 0; i < (w.harvesters ?? 2); i++) {
    scenario.units.push({ defId: 'harvester', owner: 1, x: 47 + i, z: 34 });
  }
  return scenario;
}

interface Run {
  game: Game;
  /** Bank sampled each second. */
  bank: number[];
  refineryOrderedAt: number | null;
  refineryCount: number;
  passiveRate: number;
  harvesters: number;
  /** Tick the first engineer appeared on, and units completed before it. */
  engineerAtTick: number | null;
  unitsBeforeEngineer: number | null;
}

function run(w: RecoveryWorld, seconds: number, prepare?: (game: Game) => void): Run {
  const game = new Game(scenarioFor(w), { enableAI: false });
  // Mid-match changes (a drained map) belong to the running game, not the
  // authored scenario, so the fixture can tell a map that ran out from one that
  // was never given deposits.
  prepare?.(game);
  const ai = new AIController();
  const state = initialAIState(SEED, 'veteran');
  const refineryId = game.buildingIdFor(1, 'refinery');
  const engineer = game.entitiesOf(1, 'unit').find((u) => u.defId === 'engineer')!;
  if (w.busyEngineer) {
    // A real construction order through the command layer: the engineer is busy
    // when the drop-off is lost, and the AI cannot start anything else.
    game.enqueueCommand({
      type: 'placeBuilding',
      team: 1,
      builderId: engineer.id,
      defId: 'radarStation',
      tileX: 40,
      tileZ: 39,
    });
    game.tick();
  }
  const before = new Set(game.entitiesOf(1, 'building').map((b) => b.id));
  const bank: number[] = [];
  let refineryOrderedAt: number | null = null;
  let engineerAtTick: number | null = null;
  let unitsBeforeEngineer: number | null = null;
  let destroyed = !w.destroyRefinery;
  for (let i = 0; i < 20 * seconds; i++) {
    if (!destroyed) {
      destroyed = true;
      for (const b of game.entitiesOf(1, 'building')) {
        if (b.defId === refineryId) b.hp = 0;
      }
    }
    const builtBefore = game.state.players[1]!.stats.unitsBuilt;
    game.tick();
    ai.update(game, 1, state);
    if (engineerAtTick === null) {
      const hasEngineer = game
        .entitiesOf(1, 'unit')
        .some((u) => u.defId === 'engineer' && u.hp > 0);
      if (hasEngineer) {
        engineerAtTick = game.state.tick;
        unitsBeforeEngineer = builtBefore;
      }
    }
    if (refineryOrderedAt === null && refineryId) {
      const refinery = game
        .entitiesOf(1, 'building')
        .find((b) => b.defId === refineryId && !before.has(b.id));
      if (refinery) refineryOrderedAt = game.state.tick;
    }
    if (i % 20 === 0) bank.push(Math.round(game.state.players[1]!.mats));
  }
  return {
    game,
    bank,
    refineryOrderedAt,
    refineryCount: game
      .entitiesOf(1, 'building')
      .filter((b) => b.defId === refineryId && b.hp > 0).length,
    passiveRate: game.passiveMatsRate(1),
    harvesters: game.entitiesOf(1, 'unit').filter((u) => u.defId === 'harvester' && u.hp > 0)
      .length,
    engineerAtTick,
    unitsBeforeEngineer,
  };
}

describe('economic recovery', () => {
  it('earns nothing from hauling without a drop-off', () => {
    // Two haulers, ore under the base, no refinery. Ore cannot become materials,
    // so the only income left is the one-per-second lifeline — never a hauler
    // cycle, and nowhere near enough to buy a drop-off inside a minute.
    const r = run({ harvesters: 2, mats: 200 }, 60);
    expect(r.harvesters).toBe(2);
    const gained = r.bank.at(-1)! - r.bank[0]!;
    expect(gained).toBeGreaterThanOrEqual(55);
    expect(gained).toBeLessThanOrEqual(65);
    expect(r.refineryOrderedAt).toBeNull();
  });

  it('pays the headquarters trickle when no hauler is left', () => {
    // The designed lifeline: no haulers, so the headquarters trickles.
    const r = run({ harvesters: 0, mats: 200 }, 60);
    expect(r.passiveRate).toBe(1);
    expect(r.bank.at(-1)).toBeGreaterThan(r.bank[0]!);
  });

  it('pays the lifeline when the map is worked out, even with haulers standing', () => {
    // The reported dead end: every seam drained, haulers and a drop-off still
    // standing, so the side had no income at all and the trickle stayed off
    // until it destroyed its own harvesters. A drained map is not a working
    // hauling economy, so the headquarters lifeline has to pay.
    const r = run({ refineries: 1, harvesters: 2, mats: 200 }, 30, (game) => {
      game.state.map.ore.fill(0);
    });
    expect(r.passiveRate).toBe(1);
    // The bank itself is spent by the AI; the lifeline shows in what the base
    // actually gathered: thirty seconds of one material a second.
    expect(r.game.state.players[1]!.stats.matsGathered).toBeGreaterThanOrEqual(25);
  });

  it('keeps the trickle off while any seam still holds material', () => {
    // One tile left on the map is still a working economy; the lifeline is for
    // a drained map, not for a side that simply has not driven to the far field.
    const r = run({ refineries: 1, harvesters: 2, mats: 200 }, 30, (game) => {
      game.state.map.ore.fill(0);
      // Far more than a crew can work out inside the window, so the seam is
      // still paying when the rate is read.
      game.state.map.ore[game.state.map.ore.length - 1] = 50_000;
    });
    expect(r.passiveRate).toBe(0);
  });

  it('recovers a hauler-stripped base instead of stalling forever', () => {
    // Two haulers that cannot tip. The lifeline pays, and production holds the
    // bank for the drop-off, so the bank climbs to the price and the refinery
    // comes back inside a match.
    const r = run({ harvesters: 2, mats: 200 }, 600);
    expect(r.refineryOrderedAt).not.toBeNull();
    expect(r.refineryCount).toBeGreaterThanOrEqual(1);
  });

  it('does not spend the recovery bank on units while the drop-off is missing', () => {
    // The reserve half of the fix: with no refinery the bank is the only route
    // back, so production must not consume it.
    const r = run({ harvesters: 2, mats: 300 }, 60);
    expect(r.game.state.players[1]!.stats.unitsBuilt).toBe(0);
    expect(r.bank.at(-1)!).toBeGreaterThan(r.bank[0]!);
  });

  it('still produces normally while a drop-off is standing', () => {
    // The reserve must not leak into a healthy economy.
    const r = run({ refineries: 1, harvesters: 2, mats: 900 }, 120);
    expect(r.game.state.players[1]!.stats.unitsBuilt).toBeGreaterThan(0);
  });

  it('rebuilds immediately when the bank can cover the replacement', () => {
    const r = run({ harvesters: 2, mats: 2000 }, 30);
    expect(r.refineryOrderedAt).not.toBeNull();
    expect(r.refineryOrderedAt!).toBeLessThan(20 * 5);
    expect(r.refineryCount).toBe(1);
  });

  it('keeps earning with one surviving refinery and expands from it', () => {
    const r = run({ refineries: 1, harvesters: 2, mats: 100 }, 120);
    expect(r.passiveRate).toBe(0);
    // The bank is sampled second by second and the commander spends from it, so
    // the final reading can be a few materials left over from a purchase (a
    // drop-off costs 600). What the fixture is guarding is that income actually
    // cleared the starting 100 instead of the base stalling, so it reads the
    // high-water mark rather than the last sample.
    expect(Math.max(...r.bank)).toBeGreaterThan(100);
    // Saturated drop-off: the second one is bought out of ordinary income.
    expect(r.refineryOrderedAt).not.toBeNull();
    expect(r.refineryCount).toBe(2);
  });

  it('rebuilds a refinery lost while the engineer was already building', () => {
    const r = run(
      { refineries: 1, harvesters: 2, mats: 2000, destroyRefinery: true, busyEngineer: true },
      120,
    );
    // The unrelated site is finished first, then the drop-off is replaced.
    expect(r.refineryOrderedAt).not.toBeNull();
    expect(r.refineryCount).toBeGreaterThanOrEqual(1);
  });

  it('holds the bank for a replacement engineer instead of buying combat units', () => {
    // The Phase 15 §1.5 deadlock: no engineer, no drop-off, one material per
    // second. Without the reserve the bank reaches a rifleman's 130 at ~130 s
    // and production spends it, so 300 is never reached. At 150 s the only
    // correct state is "nothing built, still saving".
    const r = run({ noEngineer: true, harvesters: 2, mats: 0 }, 150);
    expect(r.game.state.players[1]!.stats.unitsBuilt).toBe(0);
    expect(r.engineerAtTick).toBeNull();
    expect(r.bank.at(-1)!).toBeGreaterThanOrEqual(140);
  });

  it('buys the engineer and restarts construction from the saved bank', () => {
    // 200 + 100 s of trickle buys the engineer; the drop-off reserve then takes
    // over and holds the 600 for the refinery, which arrives at ~700 s.
    const r = run({ noEngineer: true, harvesters: 2, mats: 200 }, 800);
    expect(r.unitsBeforeEngineer).toBe(0);
    expect(r.engineerAtTick).not.toBeNull();
    // 100 s to save the price, plus the 12 s production run and think jitter.
    expect(r.engineerAtTick! / 20).toBeLessThanOrEqual(120);
    expect(r.refineryOrderedAt).not.toBeNull();
    expect(r.refineryCount).toBeGreaterThanOrEqual(1);
  });

  it('buys the engineer before the drop-off when both are missing', () => {
    // Two reserves in sequence, never at once: the engineer first (no unit can
    // recover the base without it), then the refinery it unlocks.
    const r = run({ noEngineer: true, harvesters: 2, mats: 200 }, 200);
    expect(r.unitsBeforeEngineer).toBe(0);
    expect(r.engineerAtTick).not.toBeNull();
    expect(r.refineryOrderedAt).toBeNull();
  });

  it('releases the reserve as soon as the engineer is queued', () => {
    // 500 pays for the engineer immediately and leaves 200: the army must keep
    // producing while the engineer is still on the production line.
    const r = run({ noEngineer: true, harvesters: 2, mats: 500 }, 25);
    expect(r.engineerAtTick).not.toBeNull();
    expect(r.game.state.players[1]!.stats.unitsBuilt).toBeGreaterThanOrEqual(2);
  });

  it('does not reserve anything while an engineer is standing', () => {
    // A live engineer makes the engineer reserve dormant; an ordinary bank of
    // 130 still buys an ordinary unit.
    const r = run({ refineries: 1, harvesters: 1, mats: 130 }, 40);
    expect(r.game.state.players[1]!.stats.unitsBuilt).toBeGreaterThan(0);
    expect(r.engineerAtTick).toBe(1);
  });

  it('holds the bank when the drop-off has no hauler to feed it', () => {
    // A completed refinery with no hauler is the same absorbing state as no
    // refinery at all: the lifeline is the only income, and a rifleman's 130
    // arrives long before the engineer's 300. Run past the 300 s price so the
    // replacement has time to finish.
    const r = run({ noEngineer: true, refineries: 1, harvesters: 0, mats: 0 }, 340);
    expect(r.unitsBeforeEngineer).toBe(0);
    expect(r.engineerAtTick).not.toBeNull();
    expect(r.engineerAtTick! / 20).toBeLessThanOrEqual(330);
  });

  it('leaves a working economy alone when the engineer is missing', () => {
    // Drop-off and hauler both standing: income buys the engineer in seconds,
    // so the army keeps producing. This is the boundary the reserve must not
    // cross — an ordinary engineer loss is not an economic recovery state.
    // Ten seconds is before hauling income can reach the engineer's 300, so a
    // unit built here can only be the rifleman: production was not held.
    const r = run({ noEngineer: true, refineries: 1, harvesters: 1, mats: 130 }, 10);
    expect(r.game.state.players[1]!.stats.unitsBuilt).toBeGreaterThan(0);
  });

  it('does not freeze production when no facility can train an engineer', () => {
    // Barracks only and a funded bank: the engineer is unproducible, so holding
    // the price forever would turn a bad base into a silent one. The rifleman
    // is bought instead. (`annihilation` keeps the empty-HQ side in the match.)
    const r = run({ barracksOnly: true, harvesters: 2, mats: 500 }, 40);
    expect(r.engineerAtTick).toBeNull();
    expect(r.game.state.players[1]!.stats.unitsBuilt).toBeGreaterThan(0);
  });

  it('makes the same engineer-recovery decisions twice on identical worlds', () => {
    const a = run({ noEngineer: true, harvesters: 2, mats: 200 }, 120);
    const b = run({ noEngineer: true, harvesters: 2, mats: 200 }, 120);
    expect(a.bank).toEqual(b.bank);
    expect(a.engineerAtTick).toBe(b.engineerAtTick);
    expect(a.game.stateHash()).toBe(b.game.stateHash());
  });

  it('makes the same recovery decisions twice on identical worlds', () => {
    const a = run({ harvesters: 2, mats: 200 }, 60);
    const b = run({ harvesters: 2, mats: 200 }, 60);
    expect(a.bank).toEqual(b.bank);
    expect(a.refineryOrderedAt).toBe(b.refineryOrderedAt);
    expect(a.game.stateHash()).toBe(b.game.stateHash());
  });
});
