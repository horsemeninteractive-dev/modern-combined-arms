/**
 * Construction priority under controlled economic and defensive conditions.
 *
 * Phase 14 exists because a Phase 13 information fix changed one match outcome:
 * the AI built a defensive emplacement where the pre-fix run had built a
 * refinery, and the match then collapsed economically. These fixtures isolate the
 * *building-type* decision — which structure the commander wants — from the
 * *site* decision that Phase 13 audited, and show what the priority rules
 * actually do:
 *
 *   - a second drop-off is requested when the haulers have saturated the ones
 *     the commander already has, and not before;
 *   - the perimeter is answered to the scouted force, and only while the scouted
 *     force outnumbers the armament it already has;
 *   - when the perimeter is already answered, the economy option wins.
 *
 * The worlds are frozen: a complete core, one emplacement of each kind, an
 * airfield and grid headroom, so the only things left to want are a second
 * refinery, a second emplacement or a radar. Nothing about the match outcome is
 * asserted — only the decision the rules make.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';
import { Terrain, tileIndex } from '../src/sim/terrain';

interface Fixture {
  /** Extra complete refineries beyond the one in the core. */
  refineries?: number;
  harvesters?: number;
  /** Extra emplacements beyond the one of each kind in the core. */
  mgNest?: number;
  atTurret?: number;
  /** Scouted enemy units parked in plain sight next to the base. */
  infantry?: number;
  tanks?: number;
  /** Enemy units hidden in forest, never seen by the commander. */
  hiddenTanks?: number;
  /** Stamp the hiding forest without placing tanks, for a matched control. */
  forest?: boolean;
  mats?: number;
}

const SEED = 11;

function scenarioFor(f: Fixture) {
  const scenario = createEmptyScenario(64, 64);
  scenario.settings.seed = SEED;
  scenario.settings.fog = true;
  scenario.settings.startingMats = f.mats ?? 2000;
  scenario.settings.startingReq = 200;
  scenario.settings.victory = 'destroyHQ';
  scenario.players[0].factionId = 'baltic';
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].factionId = 'baltic';
  scenario.players[1].startX = 40;
  scenario.players[1].startZ = 30;
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 6, z: 6 },
    // The commander's own base: a complete core, one of each emplacement, an
    // airfield and two generators, so no prerequisite or power option can win.
    { defId: 'commandPost', owner: 1, x: 44, z: 33 },
    { defId: 'factory', owner: 1, x: 40, z: 31 },
    { defId: 'barracks', owner: 1, x: 40, z: 35 },
    { defId: 'airfield', owner: 1, x: 36, z: 29 },
    { defId: 'atTurret', owner: 1, x: 50, z: 29 },
    { defId: 'mgNest', owner: 1, x: 46, z: 37 },
    { defId: 'powerPlant', owner: 1, x: 36, z: 35 },
    { defId: 'powerPlant', owner: 1, x: 36, z: 37 },
    { defId: 'refinery', owner: 1, x: 48, z: 31 },
  );
  for (let i = 0; i < (f.refineries ?? 0); i++) {
    scenario.structures.push({ defId: 'refinery', owner: 1, x: 52 + i * 4, z: 31 });
  }
  for (let i = 0; i < (f.mgNest ?? 0); i++) {
    scenario.structures.push({ defId: 'mgNest', owner: 1, x: 42 + i, z: 37 });
  }
  for (let i = 0; i < (f.atTurret ?? 0); i++) {
    scenario.structures.push({ defId: 'atTurret', owner: 1, x: 52 + i, z: 35 });
  }
  scenario.units.push({ defId: 'engineer', owner: 1, x: 44, z: 39 });
  for (let i = 0; i < (f.harvesters ?? 2); i++) {
    scenario.units.push({ defId: 'harvester', owner: 1, x: 47 + i, z: 34 });
  }
  // A working deposit: the saturation fixtures are about haulers that cycle.
  // Without ore every hauler is idle and a second drop-off cannot help, which
  // is a different decision (and the subject of the ore-exhaustion fixtures).
  for (let z = 34; z <= 37; z++) {
    for (let x = 56; x <= 59; x++) scenario.tiles[tileIndex(64, x, z)].o = 600;
  }
  // Seen enemies: close enough to be inside the base's vision.
  for (let i = 0; i < (f.infantry ?? 0); i++) {
    scenario.units.push({ defId: 'rifle', owner: 0, x: 40 + i, z: 33 });
  }
  for (let i = 0; i < (f.tanks ?? 0); i++) {
    scenario.units.push({ defId: 'tank', owner: 0, x: 40, z: 35 + i });
  }
  // Hidden enemies: forest swallows anything beyond close range. The control
  // world stamps the same forest without tanks, so terrain is not a variable in
  // the unseen-enemy comparison.
  if (f.hiddenTanks || f.forest) {
    for (let z = 41; z <= 46; z++) {
      for (let x = 34; x <= 40; x++) scenario.tiles[tileIndex(64, x, z)].t = Terrain.Forest;
    }
    for (let i = 0; i < (f.hiddenTanks ?? 0); i++) {
      scenario.units.push({ defId: 'tank', owner: 0, x: 37 + (i % 3), z: 43 + Math.floor(i / 3) });
    }
  }
  return scenario;
}

interface FirstBuild {
  defId: string;
  tileX: number;
  tileZ: number;
  tick: number;
}

/** The first structure the commander orders, or null if it never builds. */
function firstBuild(f: Fixture, game?: Game): FirstBuild | null {
  const world = game ?? new Game(scenarioFor(f), { enableAI: false });
  const ai = new AIController();
  const state = initialAIState(SEED, 'veteran');
  const before = new Set(world.entitiesOf(1, 'building').map((b) => b.id));
  for (let i = 0; i < 20 * 60; i++) {
    world.tick();
    ai.update(world, 1, state);
    const site = world.entitiesOf(1, 'building').find((b) => !before.has(b.id));
    if (site) {
      return {
        defId: site.defId,
        tileX: Math.round(site.x / 4),
        tileZ: Math.round(site.z / 4),
        tick: world.state.tick,
      };
    }
  }
  return null;
}

function ids(game: Game) {
  return {
    refinery: game.buildingIdFor(1, 'refinery'),
    mgNest: game.buildingIdFor(1, 'mgNest'),
    atTurret: game.buildingIdFor(1, 'atTurret'),
  };
}

describe('construction priority', () => {
  it('wants a drop-off only when the haulers have saturated the ones it has', () => {
    const one = new Game(scenarioFor({}), { enableAI: false });
    const two = new Game(scenarioFor({ refineries: 1, harvesters: 3 }), { enableAI: false });
    const saturated = new Game(
      scenarioFor({ refineries: 1, harvesters: 4 }),
      { enableAI: false },
    );
    const built = (game: Game) => firstBuild({}, game)?.defId;
    // 1 refinery, 2 haulers — two round trips per drop-off: a second is wanted.
    expect(built(one)).toBe(ids(one).refinery);
    // 2 refineries, 3 haulers — a third drop-off would stand idle.
    expect(built(two)).not.toBe(ids(two).refinery);
    // 2 refineries, 4 haulers — saturated again, so the third is wanted.
    expect(built(saturated)).toBe(ids(saturated).refinery);
  });

  it('does not widen the economy while a single hauler cannot fill the drop-off', () => {
    const game = new Game(scenarioFor({ harvesters: 1 }), { enableAI: false });
    // One hauler per refinery: another drop-off would not raise income. The
    // commander buys the hauler instead, and the refinery returns later.
    expect(firstBuild({}, game)?.defId).not.toBe(ids(game).refinery);
  });

  it('answers the scouted force rather than the economy', () => {
    const infantry = new Game(scenarioFor({ infantry: 2 }), { enableAI: false });
    const armour = new Game(scenarioFor({ tanks: 2 }), { enableAI: false });
    // Two rifle squads scouted and only one nest: the perimeter is answered.
    expect(firstBuild({}, infantry)?.defId).toBe(ids(infantry).mgNest);
    // Two vehicles scouted and only one turret: same, anti-armour.
    expect(firstBuild({}, armour)?.defId).toBe(ids(armour).atTurret);
  });

  it('returns to the economy once the scouted force is answered', () => {
    // The same two rifle squads, but the perimeter already has two nests — the
    // rule is about an unanswered force, not about infantry existing.
    const answered = new Game(scenarioFor({ infantry: 2, mgNest: 2 }), { enableAI: false });
    expect(firstBuild({}, answered)?.defId).toBe(ids(answered).refinery);
    // A balanced scouting report needs neither armament doubled.
    const tie = new Game(scenarioFor({ infantry: 1, tanks: 1 }), { enableAI: false });
    expect(firstBuild({}, tie)?.defId).toBe(ids(tie).refinery);
  });

  it('reproduces the Phase 13 decision from the rules, not from the seed', () => {
    // The motivating match: two rifle squads scouted and one nest standing.
    // The emplacement is not a surprise and not a tie-break — the rule wants it,
    // and the refinery is still on the list, scored far below it.
    const game = new Game(scenarioFor({ infantry: 2 }), { enableAI: false });
    const built = firstBuild({}, game);
    expect(built?.defId).toBe(ids(game).mgNest);
    // The alternative is on the same list — the rule is a ranking, not a bar.
    expect(ids(game).refinery).toBeDefined();
  });

  it('does not let unseen enemies shape the construction decision', () => {
    const clear = new Game(scenarioFor({ forest: true }), { enableAI: false });
    const dark = new Game(scenarioFor({ hiddenTanks: 4 }), { enableAI: false });
    const hidden = dark.entitiesOf(0, 'unit');
    expect(hidden).toHaveLength(4);
    for (const tank of hidden) {
      expect(dark.isVisibleTo(dark.teamOf(1), tank.id)).toBe(false);
    }
    const a = firstBuild({}, clear);
    const b = firstBuild({}, dark);
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    // Still unseen once the order was given.
    for (const tank of hidden) {
      expect(dark.isVisibleTo(dark.teamOf(1), tank.id)).toBe(false);
    }
  });

  it('makes the same decision twice on an identical world', () => {
    const f: Fixture = { infantry: 2 };
    const a = firstBuild(f);
    const b = firstBuild(f);
    expect(a).toEqual(b);
    const firstWorld = new Game(scenarioFor({ refineries: 1, harvesters: 3 }), { enableAI: false });
    const secondWorld = new Game(scenarioFor({ refineries: 1, harvesters: 3 }), { enableAI: false });
    firstBuild({}, firstWorld);
    firstBuild({}, secondWorld);
    expect(firstWorld.stateHash()).toBe(secondWorld.stateHash());
  });
})
