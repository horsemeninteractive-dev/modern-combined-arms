/**
 * Phase 2 — commander catalogue, profile resolution and save compatibility.
 *
 * The point of this suite is not that thirty rows exist; it is that the identity
 * layer is safe: every reference resolves through the nation's real roster, an
 * explicit commander changes the profile deterministically, and a match or save
 * with no commander behaves exactly as it did before the catalogue existed.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMANDERS,
  COMMANDER_CAPABILITY_TAGS,
  COMMANDER_PROFILE_VERSION,
  COMMANDER_STRATEGIES,
  commanderAssignmentIssues,
  commanderById,
  commandersForNation,
  resolveCommander,
  validateCommanderCatalog,
} from '../src/data/commanders';
import { NATION_LIST } from '../src/data/factions';
import { resolveRoster, unitSlotId, buildingSlotId } from '../src/data/roster';
import { TECHS } from '../src/data/research';
import { AI_STRATEGIES, aiProfile, initialAIState } from '../src/sim/ai';
import { Game } from '../src/sim/game';
import { createOpenFront } from '../src/data/competitiveMaps';

function gameWithCommander(commanderId?: string, difficulty: 'recruit' | 'veteran' | 'elite' = 'veteran') {
  const scenario = createOpenFront();
  scenario.players[1].factionId = 'poland';
  scenario.players[1].isAI = true;
  if (commanderId) scenario.players[1].commanderId = commanderId;
  return new Game(scenario, { enableAI: false, aiCommanderId: commanderId, aiDifficulty: difficulty });
}

describe('commander catalogue', () => {
  it('ships exactly thirty commanders, three per nation', () => {
    validateCommanderCatalog();
    expect(COMMANDERS).toHaveLength(30);
    for (const nation of NATION_LIST) {
      expect(commandersForNation(nation.id)).toHaveLength(3);
    }
    expect(new Set(COMMANDERS.map((c) => c.id)).size).toBe(30);
  });

  it('resolves every signature reference through the nation roster', () => {
    for (const entry of COMMANDERS) {
      const roster = resolveRoster(entry.nationId);
      for (const ref of entry.signatureUnits) {
        expect(unitSlotId(roster, ref), `${entry.id} unit ${ref}`).toBeTruthy();
      }
      for (const ref of entry.signatureBuildings) {
        expect(buildingSlotId(roster, ref), `${entry.id} building ${ref}`).toBeTruthy();
      }
      for (const tech of entry.research) {
        expect(TECHS[tech], `${entry.id} tech ${tech}`).toBeTruthy();
      }
    }
  });

  it('uses only capabilities and strategies the game actually has', () => {
    // The data module declares the five openings itself to avoid a circular
    // import; this is the assertion that keeps the two lists honest.
    expect([...COMMANDER_STRATEGIES].sort()).toEqual([...AI_STRATEGIES].sort());
    for (const entry of COMMANDERS) {
      expect(COMMANDER_STRATEGIES).toContain(entry.strategy);
      for (const tag of entry.capabilityTags) expect(COMMANDER_CAPABILITY_TAGS).toContain(tag);
    }
  });

  it('is immutable data, not mutable state', () => {
    expect(Object.isFrozen(COMMANDERS)).toBe(true);
    const entry = COMMANDERS[0];
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.signatureUnits)).toBe(true);
    expect(Object.isFrozen(entry.productionWeights)).toBe(true);
  });

  it('gives all thirty commanders distinct authored profiles', () => {
    const fingerprints = COMMANDERS.map((c) =>
      JSON.stringify([
        c.primaryDoctrine,
        c.aggression,
        c.economy,
        c.tech,
        c.defence,
        c.armyScale,
        c.productionWeights,
        c.signatureUnits,
      ]),
    );
    expect(new Set(fingerprints).size).toBe(30);
  });
});

describe('commander profile resolution', () => {
  it('leaves the seeded profile untouched when no commander is named', () => {
    for (const difficulty of ['recruit', 'veteran', 'elite'] as const) {
      for (const seed of [1, 11, 23, 1234]) {
        const legacy = aiProfile(seed, difficulty);
        expect(aiProfile(seed, difficulty, undefined)).toEqual(legacy);
        expect(legacy).toEqual(aiProfile(seed, difficulty));
      }
    }
  });

  it('resolves an authored commander deterministically, independent of the seed', () => {
    const a = aiProfile(1, 'veteran', 'krzysztofZawadzki');
    const b = aiProfile(987654, 'veteran', 'krzysztofZawadzki');
    expect(a).toEqual(b);
    expect(a.strategy).toBe('armour');
    expect(commanderById('krzysztofZawadzki')!.strategy).toBe(a.strategy);
  });

  it('keeps difficulty separate from commander identity', () => {
    const recruit = aiProfile(5, 'recruit', 'juhaniRautio');
    const veteran = aiProfile(5, 'veteran', 'juhaniRautio');
    const elite = aiProfile(5, 'elite', 'juhaniRautio');
    // The doctrine is the same at every level ...
    expect(recruit.strategy).toBe('economy');
    expect(veteran.strategy).toBe('economy');
    expect(elite.strategy).toBe('economy');
    // ... and only execution quality moves.
    expect(recruit.reactionTicks).toBeGreaterThan(veteran.reactionTicks);
    expect(elite.reactionTicks).toBeLessThan(veteran.reactionTicks);
    expect(recruit.recall).toBe(false);
    expect(veteran.recall).toBe(true);
    expect(elite.armyScale).toBeGreaterThan(veteran.armyScale);
    expect(recruit.responseWeight).toBeLessThan(veteran.responseWeight);
  });

  it('never reassigns a commander to another nation', () => {
    expect(resolveCommander('poland', 'rasaVilkas')).toBeUndefined();
    expect(resolveCommander('lithuania', 'rasaVilkas')).toBeDefined();
    expect(commanderAssignmentIssues('poland', 'rasaVilkas')[0]).toMatch(/belongs to lithuania/);
    expect(commanderAssignmentIssues('poland', undefined)).toEqual([]);
  });

  it('falls back to the seeded profile for an unknown id', () => {
    expect(aiProfile(42, 'veteran', 'notACommander')).toEqual(aiProfile(42, 'veteran'));
    expect(resolveCommander('poland', 'notACommander')).toBeUndefined();
  });

  it('stores the identity in AI control state with a profile version', () => {
    const state = initialAIState(7, 'veteran', 'elinSjoberg');
    expect(state.commanderId).toBe('elinSjoberg');
    expect(state.commanderProfileVersion).toBe(COMMANDER_PROFILE_VERSION);
    const legacy = initialAIState(7, 'veteran');
    expect(legacy.commanderId).toBeUndefined();
  });
});

describe('commander save compatibility', () => {
  it('persists and restores an explicit commander', () => {
    const game = gameWithCommander('krzysztofZawadzki');
    game.advance(5);
    expect(game.state.ai.commanderId).toBe('krzysztofZawadzki');
    const save = JSON.parse(JSON.stringify(game.toSave()));
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.state.ai.commanderId).toBe('krzysztofZawadzki');
    expect(restored.state.ai.commanderProfileVersion).toBe(COMMANDER_PROFILE_VERSION);
  });

  it('loads a save written before commanders existed', () => {
    const game = gameWithCommander();
    game.advance(5);
    const save = JSON.parse(JSON.stringify(game.toSave()));
    expect(save.state.ai.commanderId).toBeUndefined();
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.state.ai.commanderId).toBeUndefined();
    // The seeded path, not a defaulted commander.
    expect(restored.state.ai.strategy).toBe(aiProfile(restored.state.ai.aiSeed, 'veteran').strategy);
  });

  it('does not crash on an unknown or wrong-nation commander in a save', () => {
    const game = gameWithCommander();
    game.advance(5);
    const save = JSON.parse(JSON.stringify(game.toSave()));
    save.state.ai.commanderId = 'ghostCommander';
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.state.ai.commanderId).toBeUndefined();

    const wrongNation = JSON.parse(JSON.stringify(game.toSave()));
    // The AI player is Poland; a Lithuanian commander must not be adopted.
    wrongNation.state.ai.commanderId = 'rasaVilkas';
    const second = Game.fromSave(wrongNation, { enableAI: false });
    expect(second.state.ai.commanderId).toBeUndefined();
  });
});
