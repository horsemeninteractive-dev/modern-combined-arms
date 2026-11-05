/**
 * A wave that has already left is still the commander's army.
 *
 * The matchup ladder used to be decided by knockouts. `free()` refuses any unit
 * carrying an order, so the defence pass could not touch a committed wave: a
 * commander's base was undefended for as long as its attack ran, and a
 * recruit-level rush lifted veteran and elite command posts in half their
 * matches. That is why the measured margin between Recruit and Veteran was a
 * coin flip rather than a skill gap.
 *
 * These fixtures commit two hulls to an attack-move, drop an intruder beside the
 * command post and ask one question: does the wave come back? The levels that
 * watch their own base recall it, a recruit does not, and an assault already
 * across the map is never abandoned.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, aiProfile, initialAIState } from '../src/sim/ai';
import type { AIDifficulty } from '../src/sim/types';
import { TILE_SIZE } from '../src/sim/constants';

const BASE_X = 10;
const BASE_Z = 10;
/** An intruder this close to the command post is an emergency, not a patrol. */
const INTRUDER_X = BASE_X + 2;
const INTRUDER_Z = BASE_Z;

function scenarioFor(tankX: number, tankZ: number) {
  const scenario = createEmptyScenario(64, 64);
  scenario.meta.name = 'Recall Fixture';
  // No fog: the intruder is visible the moment it arrives, so the test measures
  // the recall decision rather than the commander's optics.
  scenario.settings.fog = false;
  scenario.settings.startingMats = 0;
  scenario.settings.startingReq = 0;
  scenario.players[0].startX = 50;
  scenario.players[0].startZ = 50;
  scenario.players[0].isAI = false;
  scenario.players[1].startX = BASE_X;
  scenario.players[1].startZ = BASE_Z;
  scenario.players[1].isAI = false;
  // Both seats keep a command post: a fixture that starts already lost ends the
  // match before the commander's first think, and nothing would be ordered.
  scenario.structures.push(
    { defId: 'commandPost', owner: 1, x: BASE_X, z: BASE_Z },
    { defId: 'commandPost', owner: 0, x: 50, z: 50 },
  );
  scenario.units.push(
    { defId: 'tank', owner: 1, x: tankX, z: tankZ },
    { defId: 'tank', owner: 1, x: tankX + 1, z: tankZ },
    // The attacker sits on the command post itself: inside the base perimeter.
    // Armour, because a tank's gun can only answer a target class it can
    // actually engage, and the fixture holds the weapon gate fixed.
    { defId: 'tank', owner: 0, x: INTRUDER_X, z: INTRUDER_Z },
  );
  return scenario;
}

interface Outcome {
  orderType: string | null;
  targetsIntruder: boolean;
  distances: number[];
}

/**
 * Commit the two hulls to an attack-move away from base, then let the commander
 * think once with an intruder standing on its command post.
 */
function recallOutcome(difficulty: AIDifficulty, tankX: number, tankZ: number): Outcome {
  const game = new Game(scenarioFor(tankX, tankZ), { enableAI: false });
  const intruder = game.state.entities.find((e) => e.owner === 0 && e.kind === 'unit')!;
  const tanks = game.state.entities.filter((e) => e.owner === 1 && e.kind === 'unit');
  expect(tanks).toHaveLength(2);

  game.enqueueCommand({
    type: 'move',
    team: 1,
    ids: tanks.map((t) => t.id),
    x: 58 * TILE_SIZE,
    z: 58 * TILE_SIZE,
    attackMove: true,
  });
  game.tick();
  // The fixture's premise: both hulls carry an order, which `free()` refuses.
  for (const tank of tanks) expect(tank.order?.type).toBe('attackMove');

  const controller = new AIController();
  const state = initialAIState(7, difficulty);
  state.nextThinkTick = game.state.tick;
  controller.update(game, 1, state);
  game.tick();

  return {
    orderType: tanks[0].order?.type ?? null,
    targetsIntruder: tanks.every(
      (t) => t.order?.type === 'attack' && t.order.targetId === intruder.id,
    ),
    distances: tanks.map((t) => Math.round(Math.hypot(t.destX - t.x, t.destZ - t.z))),
  };
}

describe('AI base recall', () => {
  it('turns a committed wave around when the command post is under fire', () => {
    for (const difficulty of ['veteran', 'elite'] as const) {
      const outcome = recallOutcome(difficulty, BASE_X - 6, BASE_Z + 5);
      expect(outcome.targetsIntruder, `${difficulty} answered the intruder`).toBe(true);
    }
  });

  it('leaves a recruit pressing its attack while its base burns', () => {
    const outcome = recallOutcome('recruit', BASE_X - 6, BASE_Z + 5);
    expect(outcome.orderType).toBe('attackMove');
    expect(outcome.targetsIntruder).toBe(false);
  });

  it('never abandons an assault that is already across the map', () => {
    // ~50 tiles from the command post: further out than any wave can cross back
    // in time, so the elite keeps pressing rather than feeding home one hull at
    // a time.
    const outcome = recallOutcome('elite', BASE_X + 45, BASE_Z + 44);
    expect(outcome.orderType).toBe('attackMove');
    expect(outcome.targetsIntruder).toBe(false);
  });

  it('keeps the level differences that the recall exists to protect', () => {
    // Recruit is the level that does not defend; the higher levels do, and the
    // elite is the only one that posts a standing guard.
    expect(aiProfile(1, 'recruit').recall).toBe(false);
    expect(aiProfile(1, 'veteran').recall).toBe(true);
    expect(aiProfile(1, 'elite').recall).toBe(true);
    expect(aiProfile(1, 'recruit').reserve).toBe(0);
    expect(aiProfile(1, 'elite').reserve).toBeGreaterThan(aiProfile(1, 'veteran').reserve);
  });
});
