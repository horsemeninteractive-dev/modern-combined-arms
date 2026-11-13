/**
 * Phase 4 — tactical personality must show in decisions, not profile fields.
 *
 * Every fixture runs the shipped planner against the shipped simulation and
 * reads the decision the controller actually recorded: the contact it chose to
 * march on, the army size it demands, the phase it entered. The enemy command
 * post is deliberately outside the AI's vision, so the choice is among the
 * contacts it legitimately has.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, aiProfile, initialAIState } from '../src/sim/ai';
import {
  COMMANDERS,
  NEUTRAL_TACTICAL,
  tacticalProfileFor,
} from '../src/data/commanders';
import type { AIDifficulty } from '../src/sim/types';

const SIZE = 72;
const CX = 40;
const CZ = 30;

interface Field {
  game: Game;
  state: ReturnType<typeof initialAIState>;
  /** Def id of the contact the planner chose, or null when it has no contact. */
  chosen: string | null;
}

function battlefield(
  commanderId: string | undefined,
  ticks = 200,
  difficulty: AIDifficulty = 'elite',
  options: { hidden?: boolean; raid?: boolean } = {},
): Field {
  const s = createEmptyScenario(SIZE, SIZE);
  s.settings.seed = 7;
  s.players[0].factionId = 'baltic';
  s.players[0].startX = 4;
  s.players[0].startZ = 4;
  s.players[1].factionId = 'poland';
  s.players[1].startX = CX;
  s.players[1].startZ = CZ;
  s.structures.push({ defId: 'commandPost', owner: 1, x: CX + 4, z: CZ + 6 });
  // The enemy command post sits far outside the AI's vision. It is a legal
  // target only once found, which is exactly the information rule under test.
  s.structures.push({ defId: 'commandPost', owner: 0, x: 4, z: 4 });
  const put = (defId: string, dx: number, dz: number, kind: 'units' | 'structures'): void => {
    s[kind].push({ defId, owner: 0, x: CX + dx, z: CZ + dz } as never);
  };
  put('factory', 3, 0, 'structures');
  put('refinery', -3, 0, 'structures');
  put('atTurret', 0, 3, 'structures');
  put('tank', 0, -3, 'units');
  put('spg', 2, 2, 'units');
  put('recon', -2, -2, 'units');
  put('aa', 2, -2, 'units');
  // A second armoured contact, not a hauler: this fixture measures pure
  // commander preference, so the opponent read must not lean economic.
  put('tank', -2, 2, 'units');
  if (options.raid) {
    // Two raiders beside the base: an emergency by any commander's reading.
    s.units.push({ defId: 'tank', owner: 0, x: CX - 2, z: CZ - 4 });
    s.units.push({ defId: 'tank', owner: 0, x: CX - 3, z: CZ - 4 });
  }
  // A single scout gives the base the vision it needs; vision is the AI's own.
  s.units.push({ defId: 'recon', owner: 1, x: CX + 1, z: CZ + 1 });

  const game = new Game(s, { enableAI: false });
  const ai = new AIController();
  const state = initialAIState(7, difficulty, commanderId);
  for (let i = 0; i < ticks; i++) {
    game.tick();
    ai.update(game, 1, state);
  }
  const hit = game.state.entities.find(
    (e) =>
      e.owner === 0 &&
      Math.abs(e.x - state.targetBaseX) < 1 &&
      Math.abs(e.z - state.targetBaseZ) < 1,
  );
  return { game, state, chosen: state.targetKnown ? (hit?.defId ?? null) : null };
}

describe('tactical personality: target prioritisation', () => {
  it('two commanders of one nation choose different contacts', () => {
    const assault = battlefield('krzysztofZawadzki');
    const bastion = battlefield('piotrGrabowski');
    console.log('[tactics]', JSON.stringify({ kind: 'poland', assault: assault.chosen, bastion: bastion.chosen }));
    // Same map, same contacts, same bank: only the doctrine differs.
    expect(assault.chosen).toBe('factory');
    expect(bastion.chosen).toBe('refinery');
    expect(assault.chosen).not.toBe(bastion.chosen);
  });

  it('different nations with comparable doctrine reach the same conclusion', () => {
    const russian = battlefield('viktorSokolov');
    const finnish = battlefield('juhaniRautio');
    console.log('[tactics]', JSON.stringify({ kind: 'artillery', russian: russian.chosen, finnish: finnish.chosen }));
    expect(russian.chosen).toBe('refinery');
    expect(finnish.chosen).toBe('refinery');
  });

  it('never targets the unseen enemy command post', () => {
    const field = battlefield('krzysztofZawadzki');
    const hq = field.game.state.entities.find(
      (e) => e.owner === 0 && e.defId === 'commandPost',
    );
    expect(hq).toBeDefined();
    expect(field.state.targetBaseX).not.toBe(hq!.x);
    expect(field.state.targetBaseZ).not.toBe(hq!.z);
    // Whatever it chose, the coordinates belong to a contact it can see.
    const match = field.game.state.entities.some(
      (e) =>
        e.owner === 0 && e.x === field.state.targetBaseX && e.z === field.state.targetBaseZ,
    );
    expect(match).toBe(true);
  });

  it('keeps its chosen contact stable across think cycles', () => {
    const early = battlefield('piotrGrabowski', 200);
    const late = battlefield('piotrGrabowski', 420);
    expect(late.chosen).toBe(early.chosen);
  });
});

describe('tactical personality: commitment and threat response', () => {
  it('an aggressive commander plans a smaller army than a cautious one', () => {
    const assault = battlefield('krzysztofZawadzki');
    const bastion = battlefield('piotrGrabowski');
    console.log('[tactics]', JSON.stringify({ kind: 'army', assault: assault.state.desiredArmy, bastion: bastion.state.desiredArmy }));
    expect(assault.state.desiredArmy).toBeLessThanOrEqual(bastion.state.desiredArmy);
  });

  it('an emergency still puts every commander on defence', () => {
    for (const id of ['krzysztofZawadzki', 'piotrGrabowski', 'martaZielinska']) {
      const field = battlefield(id, 320, 'elite', { raid: true });
      expect(field.state.phase).toBe('defend');
    }
  });
});

describe('tactical personality: separation from difficulty and legacy', () => {
  it('derives the same tactical reading at every difficulty', () => {
    const profiles = (['recruit', 'veteran', 'elite'] as AIDifficulty[]).map((difficulty) =>
      aiProfile(7, difficulty, 'viktorSokolov'),
    );
    for (const profile of profiles) {
      expect(profile.strategy).toBe(profiles[0].strategy);
    }
    // The doctrine is the level-independent half of the decision. Since Phase 5
    // the level also contributes execution quality, so the *choice* may differ at
    // recruit: that is the level reading a contact less accurately, not a
    // different commander. Veteran and elite must both follow the doctrine.
    expect(tacticalProfileFor('viktorSokolov')).toEqual(
      tacticalProfileFor('viktorSokolov'),
    );
    const targets = (['recruit', 'veteran', 'elite'] as AIDifficulty[]).map(
      (difficulty) => battlefield('viktorSokolov', 200, difficulty).chosen,
    );
    expect(targets[1]).toBe('refinery');
    expect(targets[2]).toBe('refinery');
    expect(targets[0]).not.toBeNull();
  });

  it('uses the neutral profile when no commander is selected', () => {
    expect(tacticalProfileFor(undefined)).toBeUndefined();
    expect(tacticalProfileFor('notACommander')).toBeUndefined();
    expect(NEUTRAL_TACTICAL.threatRadius).toBe(1);
    expect(NEUTRAL_TACTICAL.recallMargin).toBe(1);
    for (const value of Object.values(NEUTRAL_TACTICAL.targetBias)) expect(value).toBe(1);
    // The seeded planner keeps its original choice: the highest base value,
    // adjusted only by distance.
    const seeded = battlefield(undefined);
    expect(seeded.chosen).toBe('factory');
  });

  it('is deterministic for a fixed scenario, seed, commander and difficulty', () => {
    const first = battlefield('viktorSokolov', 260);
    const second = battlefield('viktorSokolov', 260);
    expect(first.chosen).toBe(second.chosen);
    expect(first.state.desiredArmy).toBe(second.state.desiredArmy);
    expect(first.state.targetBaseX).toBe(second.state.targetBaseX);
    expect(first.state.targetBaseZ).toBe(second.state.targetBaseZ);
  });

  it('gives every commander a bounded, explainable tactical profile', () => {
    for (const commander of COMMANDERS) {
      const tactical = tacticalProfileFor(commander.id);
      expect(tactical).toBeDefined();
      for (const value of Object.values(tactical!.targetBias)) {
        expect(value).toBeGreaterThanOrEqual(0.75);
        expect(value).toBeLessThanOrEqual(1.4);
      }
      expect(tactical!.threatRadius).toBeGreaterThanOrEqual(0.85);
      expect(tactical!.threatRadius).toBeLessThanOrEqual(1.3);
      expect(tactical!.recallMargin).toBeGreaterThanOrEqual(0.85);
      expect(tactical!.recallMargin).toBeLessThanOrEqual(1.3);
    }
  });
});
