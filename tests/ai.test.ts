import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { aiProfile, defenceTargets, nextDefenceBuild, scoutedForceMix } from '../src/sim/ai';
import { Terrain } from '../src/sim/terrain';
import type { AIDifficulty } from '../src/sim/types';

function aiGame() {
  const scenario = createIslandAssault();
  return new Game(scenario, { enableAI: true });
}

/** A developed AI base, so the construction chain reaches base defences. */
function developedAiGame(difficulty: AIDifficulty = 'veteran') {
  const scenario = createIslandAssault();
  scenario.structures.push(
    { defId: 'factory', owner: 1, x: 68, z: 30 },
    { defId: 'refinery', owner: 1, x: 66, z: 34 },
    { defId: 'barracks', owner: 1, x: 78, z: 34 },
  );
  scenario.units.push({ defId: 'harvester', owner: 1, x: 70, z: 36 });
  const game = new Game(scenario, { enableAI: true, aiDifficulty: difficulty });
  game.player(1)!.mats = 5000;
  game.player(1)!.req = 1000;
  return game;
}

function firstStructure(aiSeed: number): string | null {
  const game = new Game(createIslandAssault(), { enableAI: true, aiSeed });
  for (let i = 0; i < 20 * 90; i++) {
    game.tick();
    const first = game
      .entitiesOf(1, 'building')
      .find((e) => e.defId !== 'commandPost' && e.defId !== 'relay');
    if (first) return first.defId;
  }
  return null;
}

describe('skirmish AI', () => {
  it('draws a commander from the match seed and replays the same one', () => {
    const picks = [1, 2, 3, 6, 11, 24].map((seed) => aiProfile(seed));
    expect(aiProfile(1234)).toEqual(aiProfile(1234));
    expect(new Set(picks.map((p) => p.strategy)).size).toBeGreaterThanOrEqual(3);
    for (const pick of picks) {
      expect(pick.aggression).toBeGreaterThanOrEqual(0.05);
      expect(pick.aggression).toBeLessThanOrEqual(0.95);
    }
  });

  it('varies economy and commitment by difficulty without changing its resources', () => {
    const recruit = aiProfile(12345, 'recruit');
    const veteran = aiProfile(12345, 'veteran');
    const elite = aiProfile(12345, 'elite');
    expect(recruit.strategy).toBe(veteran.strategy);
    expect(elite.strategy).toBe(veteran.strategy);
    // A recruit is deliberately the weaker commander: it decides slowly, plans
    // a smaller army on a thinner economy, ignores what it scouted and feeds
    // units in as they finish. Elite decides fastest, masses a larger army that
    // counters the force it actually saw, and only attacks once it is complete.
    expect(recruit.aggression).toBeGreaterThan(veteran.aggression);
    expect(veteran.aggression).toBeGreaterThan(elite.aggression);
    expect(veteran.economy).toBeGreaterThan(recruit.economy);
    expect(elite.economy).toBeGreaterThan(veteran.economy);
    expect(recruit.armyScale).toBeLessThan(veteran.armyScale);
    expect(elite.armyScale).toBeGreaterThan(veteran.armyScale);
    expect(recruit.reactionTicks).toBeGreaterThan(veteran.reactionTicks);
    expect(veteran.reactionTicks).toBeGreaterThan(elite.reactionTicks);
    expect(recruit.commitShare).toBeLessThan(veteran.commitShare);
    expect(elite.commitShare).toBeGreaterThan(veteran.commitShare);
    expect(recruit.responseWeight).toBeLessThan(veteran.responseWeight);
    expect(elite.responseWeight).toBeGreaterThan(veteran.responseWeight);

    const low = new Game(createIslandAssault(), {
      enableAI: true,
      aiSeed: 12345,
      aiDifficulty: 'recruit',
    });
    const high = new Game(createIslandAssault(), {
      enableAI: true,
      aiSeed: 12345,
      aiDifficulty: 'elite',
    });
    expect(low.state.ai.difficulty).toBe('recruit');
    expect(high.state.ai.difficulty).toBe('elite');
    expect(low.player(1)!.mats).toBe(high.player(1)!.mats);
    expect(low.entitiesOf(1, 'unit').length).toBe(high.entitiesOf(1, 'unit').length);
  });

  it('crews its economy by difficulty rather than receiving extra income', () => {
    const low = developedAiGame('recruit');
    const high = developedAiGame('elite');
    low.advance(20 * 30);
    high.advance(20 * 30);
    const haulers = (game: Game): number =>
      game.entitiesOf(1, 'unit').filter((e) => e.defId === 'harvester').length;
    expect(haulers(low)).toBe(1);
    expect(haulers(high)).toBeGreaterThan(haulers(low));
    expect(low.player(1)!.mats).not.toBe(high.player(1)!.mats);
  });

  it('opens differently under different commanders on the same map', () => {
    const openings = [1, 3, 6].map(firstStructure);
    expect(openings.every((id) => id !== null)).toBe(true);
    expect(new Set(openings).size).toBeGreaterThan(1);
  });

  it('is given its own base but not the opposing landing position', () => {
    const game = aiGame();
    expect(game.state.ai.targetKnown).toBe(false);
    expect(game.state.ai.targetBaseX).toBe(0);
    expect(game.state.ai.targetBaseZ).toBe(0);
    game.advance(20 * 30);
    expect(game.state.ai.targetKnown).toBe(false);
    expect(game.state.ai.attackWave).toBe(0);
  });

  it('repairs a badly damaged structure when it cannot build', () => {
    const game = developedAiGame();
    game.player(1)!.mats = 0;
    game.player(1)!.req = 0;
    const barracks = game.entitiesOf(1, 'building').find((e) => e.defId === 'barracks')!;
    barracks.hp = barracks.maxHp * 0.4;
    const before = barracks.hp;
    game.advance(20 * 20);
    expect(barracks.hp).toBeGreaterThan(before);
  });

  it('resumes the same commander from a save', () => {
    const original = new Game(createIslandAssault(), {
      enableAI: true,
      aiSeed: 77,
      aiDifficulty: 'elite',
    });
    original.advance(20 * 150);
    const save = JSON.parse(JSON.stringify(original.toSave()));
    const restored = Game.fromSave(save, { enableAI: true });
    expect(restored.state.ai.aiSeed).toBe(original.state.ai.aiSeed);
    expect(restored.state.ai.strategy).toBe(original.state.ai.strategy);
    expect(restored.state.ai.difficulty).toBe('elite');
    expect(restored.state.ai.aiRng).toBe(original.state.ai.aiRng);
    original.advance(20 * 40);
    restored.advance(20 * 40);
    expect(restored.stateHash()).toBe(original.stateHash());
  });

  it('constructs facilities and produces units using shared rules', () => {
    const game = aiGame();
    const initialBuildings = game.entitiesOf(1, 'building').length;
    const initialUnits = game.entitiesOf(1, 'unit').length;
    game.advance(20 * 150);
    const buildings = game.entitiesOf(1, 'building');
    const units = game.entitiesOf(1, 'unit');
    const summary = {
      tick: game.state.tick,
      mats: Math.round(game.player(1)!.mats),
      req: Math.round(game.player(1)!.req),
      buildings: buildings.map((b) => b.defId),
      units: units.map((u) => u.defId),
      decision: game.state.ai.lastDecision,
      victory: game.state.victory,
      events: game.state.events.slice(-8).map((e) => `${e.type}:${e.text}`),
    };
    console.log(JSON.stringify(summary, null, 2));
    expect(buildings.length).toBeGreaterThanOrEqual(initialBuildings);
    expect(units.length).toBeGreaterThanOrEqual(initialUnits - 2);
    expect(game.state.ai.lastDecision.length).toBeGreaterThan(0);
    expect(game.state.victory).toBe('playing');
  });

  it('replaces its engineer when the starting one is lost', () => {
    const game = aiGame();
    for (const e of game.entitiesOf(1, 'unit')) {
      if (e.defId === 'engineer') e.hp = 0;
    }
    game.player(1)!.mats = 1200;
    game.advance(20 * 24);
    expect(game.entitiesOf(1, 'unit').some((e) => e.defId === 'engineer')).toBe(true);
  });

  it('counts the hostile force it has actually scouted, not the whole roster', () => {
    const game = aiGame();
    const playerUnits = game.entitiesOf(0, 'unit');
    game.state.contacts = playerUnits.map((e) => ({
      team: 1,
      entityId: e.id,
      x: e.x,
      z: e.z,
      tick: game.state.tick,
      defId: e.defId,
      kind: 'unit',
    }));
    const mix = scoutedForceMix(game, 1);
    // Two MBTs and five riflemen; the unarmed engineer is not a perimeter cue.
    expect(mix).toEqual({ armour: 2, infantry: 5 });
  });

  it('prefers the gun that answers the scouted force', () => {
    const infantryHeavy = { armour: 1, infantry: 6 };
    expect(defenceTargets(infantryHeavy)).toEqual({ atTurret: 1, mgNest: 2 });
    expect(nextDefenceBuild(infantryHeavy, { atTurret: 0, mgNest: 0 })).toBe('mgNest');
    expect(nextDefenceBuild(infantryHeavy, { atTurret: 0, mgNest: 1 })).toBe('mgNest');
    expect(nextDefenceBuild(infantryHeavy, { atTurret: 0, mgNest: 2 })).toBe('atTurret');
    expect(nextDefenceBuild(infantryHeavy, { atTurret: 1, mgNest: 2 })).toBeNull();

    const armourHeavy = { armour: 6, infantry: 1 };
    expect(defenceTargets(armourHeavy)).toEqual({ atTurret: 2, mgNest: 1 });
    expect(nextDefenceBuild(armourHeavy, { atTurret: 0, mgNest: 0 })).toBe('atTurret');
    expect(nextDefenceBuild(armourHeavy, { atTurret: 1, mgNest: 0 })).toBe('atTurret');
    expect(nextDefenceBuild(armourHeavy, { atTurret: 2, mgNest: 0 })).toBe('mgNest');
    expect(nextDefenceBuild(armourHeavy, { atTurret: 2, mgNest: 1 })).toBeNull();

    // No recent scouting keeps the legacy anti-armour opening.
    expect(nextDefenceBuild({ armour: 0, infantry: 0 }, { atTurret: 0, mgNest: 0 })).toBe('atTurret');
    expect(nextDefenceBuild({ armour: 0, infantry: 0 }, { atTurret: 1, mgNest: 0 })).toBe('mgNest');
    expect(nextDefenceBuild({ armour: 0, infantry: 0 }, { atTurret: 1, mgNest: 1 })).toBeNull();
  });

  it('sites an MG nest first when scouts report an infantry-heavy landing', () => {
    const game = developedAiGame();
    // Feed the scouting report from the opening so the first perimeter choice
    // is the answer to the seen force, not a blind anti-armour default.
    const seedScouts = (): void => {
      game.state.contacts = game
        .entitiesOf(0, 'unit')
        .filter((e) => e.defId === 'rifle' || e.defId === 'tank')
        .map((e) => ({
          team: 1,
          entityId: e.id,
          x: e.x,
          z: e.z,
          tick: game.state.tick,
          defId: e.defId,
          kind: 'unit' as const,
        }));
    };
    for (let i = 0; i < 20 * 90; i++) {
      if (i % 20 === 0) seedScouts();
      game.tick();
      const defence = game
        .entitiesOf(1, 'building')
        .find((e) => e.defId === 'mgNest' || e.defId === 'atTurret');
      if (defence) {
        expect(defence.defId).toBe('mgNest');
        return;
      }
    }
    throw new Error('AI never sited a base defence');
  });

  it('builds an airfield, fields a fighter and sorties it against a ground target', () => {
    const game = developedAiGame();
    game.player(1)!.mats = 10000;
    game.player(1)!.req = 2500;

    for (let i = 0; i < 20 * 420; i++) {
      game.tick();
      if (game.entitiesOf(1, 'building').some((e) => e.defId === 'airfield' && !e.construction)) break;
    }
    const airfield = game
      .entitiesOf(1, 'building')
      .find((e) => e.defId === 'airfield' && !e.construction);
    expect(airfield).toBeDefined();

    for (let i = 0; i < 20 * 180; i++) {
      game.tick();
      if (game.entitiesOf(1, 'unit').some((e) => e.defId === 'fighter')) break;
    }
    const fighter = game.entitiesOf(1, 'unit').find((e) => e.defId === 'fighter');
    expect(fighter).toBeDefined();

    // Clear the fog so the established fighter has a ground target to sortie
    // against without depending on the starting patrol positions.
    game.state.scenario.settings.fog = false;
    for (let i = 0; i < 20 * 20; i++) game.tick();
    expect(
      fighter!.order?.type === 'attack' || fighter!.ammo < fighter!.maxAmmo,
    ).toBe(true);
  });

  it('builds a coastal shipyard and maintains a corvette', () => {
    const game = developedAiGame();
    game.player(1)!.mats = 6000;
    game.player(1)!.req = 1200;

    for (let i = 0; i < 20 * 420; i++) {
      game.tick();
      if (game.entitiesOf(1, 'building').some((e) => e.defId === 'shipyard' && !e.construction)) break;
    }
    const yard = game.entitiesOf(1, 'building').find((e) => e.defId === 'shipyard');
    expect(yard).toBeDefined();
    expect(yard!.construction).toBe(false);

    for (let i = 0; i < 20 * 180; i++) {
      game.tick();
      if (game.entitiesOf(1, 'unit').some((e) => e.defId === 'corvette')) break;
    }
    const corvette = game.entitiesOf(1, 'unit').find((e) => e.defId === 'corvette');
    expect(corvette).toBeDefined();

    corvette!.hp = 0;
    game.player(1)!.mats = 6000;
    for (let i = 0; i < 20 * 180; i++) game.tick();
    expect(game.entitiesOf(1, 'unit').some((e) => e.defId === 'corvette')).toBe(true);
  });

  it('does not stall land construction when the map has no coast', () => {
    const scenario = createIslandAssault();
    for (const tile of scenario.tiles) {
      if (tile.t === Terrain.DeepWater || tile.t === Terrain.ShallowWater) {
        tile.t = Terrain.Grass;
        tile.e = 1;
      }
    }
    const game = new Game(scenario, { enableAI: true });
    game.player(1)!.mats = 4000;
    game.player(1)!.req = 800;
    game.advance(20 * 220);
    expect(game.entitiesOf(1, 'building').some((e) => e.defId === 'shipyard')).toBe(false);
    expect(game.entitiesOf(1, 'building').some((e) => e.defId === 'barracks')).toBe(true);
  });

  it('builds anti-tank and anti-infantry emplacements for base defence', () => {
    const game = developedAiGame();
    game.advance(20 * 160);
    const defences = game
      .entitiesOf(1, 'building')
      .filter((e) => e.defId === 'atTurret' || e.defId === 'mgNest')
      .map((e) => e.defId);
    expect(defences).toContain('atTurret');
    expect(defences).toContain('mgNest');
  });

  it('reaches its air and naval branches under normal starting resources', () => {
    const game = aiGame();
    // A passive player loses this map well before the air branch is affordable,
    // so hold the landing Command Post together: the horizon we measure here is
    // the AI's build order at its normal income, not the player's survival.
    const commandPost = game.entitiesOf(0, 'building').find((e) => e.defId === 'commandPost')!;
    for (let i = 0; i < 20 * 360 && game.state.victory === 'playing'; i++) {
      commandPost.hp = commandPost.maxHp;
      game.tick();
    }
    const buildings = game.entitiesOf(1, 'building').map((e) => e.defId);
    expect(game.state.victory).toBe('playing');
    expect(buildings).toContain('airfield');
    expect(buildings).toContain('shipyard');
    expect(game.state.ai.attackWave).toBeGreaterThanOrEqual(1);
  });

  it('sends an attack force and produces a credible threat', () => {
    const game = aiGame();
    const initialAiUnits = game.player(1)!.stats.unitsBuilt;
    game.advance(20 * 420);
    const aiUnits = game.entitiesOf(1, 'unit');
    const playerBuildings = game.entitiesOf(0, 'building');
    const summary = {
      tick: game.state.tick,
      aiUnits: aiUnits.length,
      aiBuildings: game.entitiesOf(1, 'building').map((b) => b.defId),
      playerBuildings: playerBuildings.length,
      playerUnits: game.entitiesOf(0, 'unit').length,
      wave: game.state.ai.attackWave,
      phase: game.state.ai.phase,
      decision: game.state.ai.lastDecision,
      aiMats: Math.round(game.player(1)!.mats),
      victory: game.state.victory,
    };
    console.log(JSON.stringify(summary, null, 2));
    expect(game.state.ai.attackWave).toBeGreaterThanOrEqual(1);
    // The landing force is deliberately small, so waves take losses; a
    // credible threat is fresh production plus damage inflicted on the player.
    expect(game.player(1)!.stats.unitsBuilt).toBeGreaterThan(initialAiUnits);
    expect(game.player(0)!.stats.unitsLost).toBeGreaterThan(0);
    expect(aiUnits.length).toBeGreaterThan(0);
  });
});
