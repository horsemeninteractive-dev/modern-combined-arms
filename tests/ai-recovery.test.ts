/**
 * Phase 6D.1 — does the AI recover from economic damage, and if not, why?
 *
 * The existing `economy-rebuild` suite proves the commander *chooses* a
 * replacement harvester over infantry when its bank is short. This file asks the
 * next question: how long does that decision actually take to pay off, and does
 * the answer explain the competitive collapse seen in Phase 6D?
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';
import { STRIPPED_BASE_TRICKLE_RATE } from '../src/sim/constants';

const SEED = 7;
const HARVESTER_COST = 500;

interface World {
  mats?: number;
  req?: number;
  harvesters?: number;
  refinery?: boolean;
  factory?: boolean;
  powerPlant?: boolean;
  consumers?: boolean;
  engineer?: boolean;
  /** An enemy rifle stands off the base, so the commander is not alone. */
  enemyNearBase?: boolean;
}

function scenarioFor(w: World) {
  const scenario = createEmptyScenario(64, 64);
  scenario.settings.seed = SEED;
  scenario.settings.fog = false;
  scenario.settings.startingMats = w.mats ?? 0;
  scenario.settings.startingReq = w.req ?? 200;
  scenario.settings.victory = 'destroyHQ';
  scenario.players[0].factionId = 'baltic';
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].factionId = 'baltic';
  scenario.players[1].startX = 40;
  scenario.players[1].startZ = 30;
  // The human seat keeps an HQ so the match cannot resolve.
  scenario.structures.push({ defId: 'commandPost', owner: 0, x: 6, z: 6 });
  scenario.structures.push({ defId: 'commandPost', owner: 1, x: 44, z: 33 });
  if (w.refinery) scenario.structures.push({ defId: 'refinery', owner: 1, x: 48, z: 31 });
  if (w.factory) scenario.structures.push({ defId: 'factory', owner: 1, x: 40, z: 31 });
  if (w.powerPlant) scenario.structures.push({ defId: 'powerPlant', owner: 1, x: 52, z: 37 });
  if (w.consumers) {
    scenario.structures.push(
      { defId: 'barracks', owner: 1, x: 40, z: 36 },
      { defId: 'radar', owner: 1, x: 36, z: 33 },
    );
  }
  for (let z = 34; z <= 38; z++) {
    for (let x = 46; x <= 50; x++) scenario.tiles[z * 64 + x].o = 600;
  }
  if (w.engineer !== false) scenario.units.push({ defId: 'engineer', owner: 1, x: 44, z: 39 });
  if (w.enemyNearBase) scenario.units.push({ defId: 'rifle', owner: 0, x: 37, z: 34 });
  for (let i = 0; i < (w.harvesters ?? 0); i++) {
    scenario.units.push({ defId: 'harvester', owner: 1, x: 47 + i, z: 34 });
  }
  return scenario;
}

interface RecoveryRun {
  game: Game;
  firstHarvesterSecond: number | null;
  firstPowerPlantSecond: number | null;
  /** First capability structure (barracks, radar, research, nest, turret). */
  firstCapabilitySecond: number | null;
  harvestersAtEnd: number;
  powerAtEnd: { supply: number; demand: number; brownout: boolean };
  matsAtEnd: number;
  structuresAtEnd: number;
  byDef: Record<string, number>;
}

function recover(w: World, seconds: number, damage?: (game: Game) => void): RecoveryRun {
  const game = new Game(scenarioFor(w), { enableAI: false });
  const ai = new AIController();
  const state = initialAIState(SEED, 'veteran');
  damage?.(game);
  const knownUnits = new Set(game.entitiesOf(1, 'unit').map((e) => e.id));
  const knownBuildings = new Set(game.entitiesOf(1, 'building').map((e) => e.id));
  let firstHarvesterSecond: number | null = null;
  let firstPowerPlantSecond: number | null = null;
  let firstCapabilitySecond: number | null = null;
  const capabilitySlots = new Set(['barracks', 'radar', 'researchCentre', 'mgNest', 'atTurret', 'samBattery']);
  for (let i = 0; i < 20 * seconds; i++) {
    game.tick();
    ai.update(game, 1, state);
    if (firstHarvesterSecond === null) {
      const built = game
        .entitiesOf(1, 'unit')
        .find((e) => e.defId === 'harvester' && !knownUnits.has(e.id));
      if (built) firstHarvesterSecond = game.state.tick / 20;
    }
    if (firstPowerPlantSecond === null) {
      const built = game
        .entitiesOf(1, 'building')
        .find((e) => e.defId === 'powerPlant' && !knownBuildings.has(e.id));
      if (built) firstPowerPlantSecond = game.state.tick / 20;
    }
    if (firstCapabilitySecond === null) {
      const built = game
        .entitiesOf(1, 'building')
        .find((e) => capabilitySlots.has(e.defId) && !knownBuildings.has(e.id));
      if (built) firstCapabilitySecond = game.state.tick / 20;
    }
  }
  const power = game.powerStatus(1);
  const byDef: Record<string, number> = {};
  for (const e of game.state.entities) {
    if (e.owner !== 1 || e.hp <= 0) continue;
    byDef[e.defId] = (byDef[e.defId] ?? 0) + 1;
  }
  return {
    game,
    byDef,
    firstHarvesterSecond: firstHarvesterSecond === null ? null : Math.round(firstHarvesterSecond),
    firstPowerPlantSecond:
      firstPowerPlantSecond === null ? null : Math.round(firstPowerPlantSecond),
    firstCapabilitySecond:
      firstCapabilitySecond === null ? null : Math.round(firstCapabilitySecond),
    harvestersAtEnd: game
      .entitiesOf(1, 'unit')
      .filter((e) => e.defId === 'harvester' && e.hp > 0).length,
    powerAtEnd: power,
    matsAtEnd: Math.round(game.player(1)?.mats ?? 0),
    structuresAtEnd: game.entitiesOf(1, 'building').filter((e) => e.hp > 0).length,
  };
}

describe('harvester recovery', () => {
  it('rebuilds from the one-per-second lifeline, but only after the price is met', () => {
    // Factory and refinery survive, every hauler is gone, bank empty. The
    // commander must hold for the 500-mat hull at one material a second.
    const run = recover({ refinery: true, factory: true, mats: 0 }, 700, (game) => {
      for (const unit of game.entitiesOf(1, 'unit')) {
        if (unit.defId === 'harvester') unit.hp = 0;
      }
    });
    console.log('[rec]', JSON.stringify({ kind: 'hauler-lifeline', ...run, game: undefined }));
    expect(run.firstHarvesterSecond).not.toBeNull();
    // One per second: 500 materials, then the production run. The band is wide
    // because think cadence and the 14-second build add to the bank wait.
    expect(run.firstHarvesterSecond!).toBeGreaterThanOrEqual(HARVESTER_COST - 40);
    expect(run.firstHarvesterSecond!).toBeLessThanOrEqual(HARVESTER_COST + 120);
  });

  // Formerly a reproduced defect: at 600 materials with a refinery, a factory
  // and no hauler at all, the commander bought a barracks (520) and was left on
  // 80, so the hull that earns never arrived. The rescue rule keeps capability
  // structures out of that bank while a replacement is owed, so this is now a
  // normal assertion rather than an expected failure.
  it('rebuilds immediately when the bank already covers the hull', () => {
    const run = recover({ refinery: true, factory: true, mats: 600 }, 120, (game) => {
      for (const unit of game.entitiesOf(1, 'unit')) {
        if (unit.defId === 'harvester') unit.hp = 0;
      }
    });
    console.log('[rec]', JSON.stringify({ kind: 'hauler-funded', ...run, game: undefined }));
    expect(run.firstHarvesterSecond).not.toBeNull();
    expect(run.firstHarvesterSecond!).toBeLessThanOrEqual(60);
  });

  it('recovers faster without a factory than with one', () => {
    // The authored inversion: a stripped base with no factory draws the
    // subsidised lifeline, while a surviving factory caps it at one per second.
    const stripped = recover({ refinery: true, mats: 0 }, 400, (game) => {
      for (const unit of game.entitiesOf(1, 'unit')) {
        if (unit.defId === 'harvester') unit.hp = 0;
      }
    });
    const withFactory = recover({ refinery: true, factory: true, mats: 0 }, 700, (game) => {
      for (const unit of game.entitiesOf(1, 'unit')) {
        if (unit.defId === 'harvester') unit.hp = 0;
      }
    });
    console.log('[rec]', JSON.stringify({
      kind: 'hauler-boundary',
      stripped: { ...stripped, game: undefined },
      withFactory: { ...withFactory, game: undefined },
      strippedRate: STRIPPED_BASE_TRICKLE_RATE,
    }));
    expect(stripped.firstHarvesterSecond).not.toBeNull();
    expect(withFactory.firstHarvesterSecond).not.toBeNull();
    expect(stripped.firstHarvesterSecond!).toBeLessThan(withFactory.firstHarvesterSecond!);
  });
});

describe('power recovery', () => {
  it('rebuilds a destroyed plant when the bank can pay for it', () => {
    const run = recover(
      { refinery: true, factory: true, powerPlant: true, consumers: true, mats: 600 },
      180,
      (game) => {
        const plant = game.entitiesOf(1, 'building').find((e) => e.defId === 'powerPlant');
        if (plant) plant.hp = 0;
      },
    );
    console.log('[rec]', JSON.stringify({ kind: 'power-rebuild', ...run, game: undefined }));
    expect(run.firstPowerPlantSecond).not.toBeNull();
    // Measured at 128 s from a 600-material bank: the build plus the commander's
    // think cadence. The band records the measurement, not an aspiration.
    expect(run.firstPowerPlantSecond!).toBeLessThanOrEqual(180);
    expect(run.powerAtEnd.brownout).toBe(false);
  });

  it('documents the affordability boundary when the bank is empty', () => {
    // No income at all: the plant costs 400 and the lifeline pays one a second,
    // so the rebuild sits on the same slow clock as the hauler.
    const run = recover(
      { refinery: true, factory: true, powerPlant: true, consumers: true, mats: 0 },
      600,
      (game) => {
        const plant = game.entitiesOf(1, 'building').find((e) => e.defId === 'powerPlant');
        if (plant) plant.hp = 0;
      },
    );
    console.log('[rec]', JSON.stringify({ kind: 'power-boundary', ...run, game: undefined }));
    // Recorded, not required: the point is where the clock lands, not that a
    // particular second is met.
    expect(run.firstPowerPlantSecond === null || run.firstPowerPlantSecond! >= 380).toBe(true);
  });
});

describe('rescue scope under pressure', () => {
  it('fortifies first under threat, then still replaces the haulers', () => {
    // Live pressure: a hostile rifle is inside the threat radius, so this is not
    // an empty-map fixture. Measured behaviour is defence first: the commander
    // sites a nest and the bank then falls under the hull price, so the
    // replacement waits for the lifeline instead of arriving in the first minute.
    // The window is long enough to show it does not become a permanent lock.
    const run = recover({ refinery: true, factory: true, mats: 600, enemyNearBase: true }, 420, (game) => {
      for (const unit of game.entitiesOf(1, 'unit')) {
        if (unit.defId === 'harvester') unit.hp = 0;
      }
    });
    console.log('[rec]', JSON.stringify({ kind: 'hauler-under-threat', ...run, game: undefined }));
    // It answered the threat instead of banking the hull ...
    expect((run.byDef.mgNest ?? 0) + (run.byDef.atTurret ?? 0)).toBeGreaterThan(0);
    // ... and still rebuilt its income afterwards rather than staying stripped.
    expect(run.firstHarvesterSecond).not.toBeNull();
    expect(run.firstHarvesterSecond!).toBeLessThanOrEqual(420);
  });

  it('does not stay locked to rescue facilities when the factory is gone', () => {
    // No factory means no viable production route, so the bank is not owed to a
    // hull that cannot be built. The base must keep raising other structures
    // instead of sitting on 600 materials for the rest of the match.
    const run = recover({ refinery: true, mats: 600 }, 180, (game) => {
      for (const unit of game.entitiesOf(1, 'unit')) {
        if (unit.defId === 'harvester') unit.hp = 0;
      }
    });
    console.log('[rec]', JSON.stringify({ kind: 'no-route', ...run, game: undefined }));
    const rescueOnly = (run.byDef.commandPost ?? 0) + (run.byDef.refinery ?? 0) + (run.byDef.powerPlant ?? 0) + (run.byDef.factory ?? 0);
    const other = run.structuresAtEnd - rescueOnly;
    expect(other).toBeGreaterThan(0);
  });

  it('holds the reserve without a threat, but builds defence when one appears', () => {
    // The paired regression for the rescue guard's only exception. Identical
    // fixtures, one variable: a hostile rifle inside the 34-tile threat radius.
    const quiet = recover({ refinery: true, factory: true, mats: 600 }, 120, (game) => {
      for (const unit of game.entitiesOf(1, 'unit')) if (unit.defId === 'harvester') unit.hp = 0;
    });
    const pressed = recover(
      { refinery: true, factory: true, mats: 600, enemyNearBase: true },
      120,
      (game) => {
        for (const unit of game.entitiesOf(1, 'unit')) if (unit.defId === 'harvester') unit.hp = 0;
      },
    );
    console.log('[rec]', JSON.stringify({
      kind: 'emergency-pair',
      quiet: { ...quiet, game: undefined },
      pressed: { ...pressed, game: undefined },
    }));
    // No threat: the reserve is spent on the hull before any capability
    // structure — the ordering is the evidence, not the mere absence.
    expect(quiet.firstHarvesterSecond).not.toBeNull();
    expect(
      quiet.firstCapabilitySecond === null ||
        quiet.firstCapabilitySecond > quiet.firstHarvesterSecond!,
    ).toBe(true);
    // Live threat: a defensive position is admitted through the same guard while
    // the harvesters are still gone.
    expect((pressed.byDef.mgNest ?? 0) + (pressed.byDef.atTurret ?? 0)).toBeGreaterThan(0);
  });
});
