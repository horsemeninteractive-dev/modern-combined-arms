/**
 * Ore exhaustion is a state the commander can see on its own units: a completed
 * drop-off stands, every hauler is in `seek` with an empty hopper, and nothing
 * is being mined. These fixtures pin the resulting decisions:
 *
 *   - no new hauler or saturation refinery while the only haulers idle;
 *   - no suppression while ore is actually being worked;
 *   - no suppression when no hauler exists (rebuilding one is a legitimate bet);
 *   - release as soon as a deposit becomes reachable again;
 *   - identical runs produce the same state.
 *
 * The world is a frozen base with a command post, factory and barracks, optional
 * refinery/haulers/engineer, an optional ore field under the base and a fixed
 * bank. No opponent acts, so every change comes from the commander's own plan.
 * The signal itself is derived from own-unit state and the commander's own
 * income history — never from `map.ore`.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';
import { BUILDINGS } from '../src/data/buildings';
import { unitFamily } from '../src/data/units';

interface World {
  ore?: number;
  bank?: number;
  refineries?: number;
  harvesters?: number;
  engineer?: boolean;
  /** Ore tile coordinates to restore mid-run, for the release fixture. */
  restoreAt?: { second: number; x: number; z: number };
}

const SEED = 17;

function scenarioFor(w: World) {
  const scenario = createEmptyScenario(64, 64);
  scenario.settings.seed = SEED;
  scenario.settings.fog = true;
  scenario.settings.startingMats = w.bank ?? 2000;
  scenario.settings.startingReq = 200;
  scenario.settings.victory = 'destroyHQ';
  scenario.players[0].factionId = 'baltic';
  scenario.players[0].startX = 6;
  scenario.players[0].startZ = 6;
  scenario.players[1].factionId = 'baltic';
  scenario.players[1].startX = 40;
  scenario.players[1].startZ = 30;
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 4, z: 4 },
    { defId: 'commandPost', owner: 1, x: 44, z: 33 },
    { defId: 'factory', owner: 1, x: 40, z: 31 },
    { defId: 'barracks', owner: 1, x: 40, z: 36 },
  ];
  for (let i = 0; i < (w.refineries ?? 1); i++) {
    scenario.structures.push({ defId: 'refinery', owner: 1, x: 48 + i * 4, z: 31 });
  }
  if (w.engineer !== false) scenario.units.push({ defId: 'engineer', owner: 1, x: 44, z: 39 });
  for (let i = 0; i < (w.harvesters ?? 2); i++) {
    scenario.units.push({ defId: 'harvester', owner: 1, x: 47 + i, z: 34 });
  }
  if (w.ore !== undefined) {
    for (let z = 34; z <= 38; z++) {
      for (let x = 46; x <= 50; x++) scenario.tiles[z * 64 + x].o = w.ore;
    }
  }
  return scenario;
}

interface Run {
  game: Game;
  harvesters: number;
  refineries: number;
  combatBuilt: number;
  gathered: number;
  passiveRate: number;
  haulerPhases: string[];
}

function run(w: World, seconds: number): Run {
  const game = new Game(scenarioFor(w), { enableAI: false });
  const ai = new AIController();
  const state = initialAIState(SEED, 'veteran');
  const initial = new Set(game.state.entities.map((e) => e.id));
  const restore = w.restoreAt;
  let restored = false;
  for (let i = 0; i < 20 * seconds; i++) {
    ai.update(game, 1, state);
    game.tick();
    if (restore && !restored && game.state.tick >= restore.second * 20) {
      restored = true;
      const idx = restore.z * game.state.map.width + restore.x;
      game.state.map.ore[idx] = 600;
      game.state.scenario.tiles[idx].o = 600;
    }
  }
  const harvesters = game
    .entitiesOf(1, 'unit')
    .filter((u) => u.hp > 0 && unitFamily(u.defId) === 'harvester');
  const refineries = game
    .entitiesOf(1, 'building')
    .filter((b) => b.hp > 0 && BUILDINGS[b.defId]?.refinery);
  const builtCombat = game
    .entitiesOf(1, 'unit')
    .filter((u) => !initial.has(u.id) && u.defId !== 'harvester' && u.defId !== 'engineer').length;
  return {
    game,
    harvesters: harvesters.length,
    refineries: refineries.length,
    combatBuilt: builtCombat,
    gathered: Math.round(game.player(1)!.stats.matsGathered),
    passiveRate: game.passiveMatsRate(1),
    haulerPhases: harvesters.map((u) => u.harvester?.phase ?? 'none'),
  };
}

describe('ore exhaustion', () => {
  it('does not buy a second hauler while the only one idles on an empty map', () => {
    // One refinery and one hauler: the veteran target is two haulers, so the
    // pre-fix planner bought a useless second one out of a 2 000 bank. With the
    // idle signal the bank goes to the army instead.
    const r = run({ harvesters: 1, bank: 2000 }, 180);
    expect(r.harvesters).toBe(1);
    expect(r.combatBuilt).toBeGreaterThan(0);
    expect(r.gathered).toBe(0);
  });

  it('does not add a saturation refinery or more haulers to an idle base', () => {
    // Two haulers on one refinery is the saturation trigger. Without the signal
    // the commander built a second refinery, which raised the hauler target and
    // bought a third hauler — 900 materials that can never earn.
    const r = run({ harvesters: 2, bank: 5000 }, 180);
    expect(r.refineries).toBe(1);
    expect(r.harvesters).toBe(2);
    expect(r.combatBuilt).toBeGreaterThan(0);
  });

  it('keeps expanding while ore is actually being worked', () => {
    // A healthy world must be untouched: the second hauler is a real
    // investment because the first one is cycling.
    const r = run({ ore: 600, harvesters: 1, bank: 2000 }, 180);
    expect(r.harvesters).toBeGreaterThanOrEqual(2);
    expect(r.gathered).toBeGreaterThan(0);
  });

  it('does not treat a working economy as exhausted', () => {
    const r = run({ ore: 600, harvesters: 2, bank: 2000 }, 60);
    expect(r.gathered).toBeGreaterThan(0);
    expect(r.passiveRate).toBe(0);
  });

  it('keeps rebuilding haulers when none exist, because that is the only bet left', () => {
    // With no live hauler the commander cannot know whether ore remains. Buying
    // one is a legitimate attempt to restart income, so the signal does not fire
    // and the demand stays.
    const r = run({ harvesters: 0, bank: 2000 }, 180);
    expect(r.harvesters).toBeGreaterThanOrEqual(1);
  });

  it('releases as soon as a deposit becomes reachable', () => {
    // Start exhausted with one hauler and a 4 000 bank. At 60 s a deposit is
    // made reachable; the hauler starts mining, the economy demand returns and
    // the commander buys the second hauler it was holding back. The tile is open
    // ground south of the base: a deposit *under* a structure is unminable by
    // design, so restoring one there would test nothing but the idle signal.
    const r = run(
      { harvesters: 1, bank: 4000, restoreAt: { second: 60, x: 46, z: 38 } },
      180,
    );
    expect(r.gathered).toBeGreaterThan(0);
    expect(r.harvesters).toBeGreaterThanOrEqual(2);
  });

  it('makes the same exhausted-economy decisions twice', () => {
    const a = run({ harvesters: 1, bank: 2000 }, 60);
    const b = run({ harvesters: 1, bank: 2000 }, 60);
    expect(a.game.stateHash()).toBe(b.game.stateHash());
    expect(a.harvesters).toBe(b.harvesters);
    expect(a.refineries).toBe(b.refineries);
  });
});
