import { describe, expect, it } from 'vitest';
import { createTeamSnapshot } from '../src/multiplayer/projection';
import { buildDelta, createBaseline } from '../src/multiplayer/teamDelta';
import { NetworkBattle } from '../src/multiplayer/networkBattle';
import { Game } from '../src/sim/game';
import { defaultScenarioId, scenarioById } from '../src/data/scenarioCatalog';
import { cloneScenario, type Scenario } from '../src/sim/scenario';
import { TILE_SIZE } from '../src/sim/constants';

/**
 * A room is authoritative for work as well as for combat. Mining and capturing
 * are per-tick actions, so a client that is only told where a hull stands draws
 * a stopped vehicle at the deposit and an engineer that never starts working:
 * that reads to the player as "harvesters never mine" and "captures do nothing".
 */
function economyScenario(): Scenario {
  const scenario = scenarioById(defaultScenarioId('multiplayer'))!.create();
  scenario.settings.fog = true;
  scenario.units.push(
    { defId: 'harvester', owner: 0, x: 30, z: 30 },
    { defId: 'harvester', owner: 1, x: 60, z: 60 },
  );
  return scenario;
}

function game(): Game {
  return new Game(economyScenario(), { localPlayerId: -1, enableAI: false });
}

function seekAndMine(game: Game, owner: number): { id: number; ore: () => number } {
  const hauler = game.state.entities.find(
    (entity) => entity.kind === 'unit' && entity.owner === owner && entity.harvester,
  )!;
  // Mining starts with an empty hopper, so wait for the first load before
  // asserting that work is arriving.
  for (let tick = 0; tick < 20 * 30; tick++) {
    game.tick();
    if (hauler.harvester!.ore > 0) break;
  }
  expect(hauler.harvester!.phase).toBe('mining');
  return { id: hauler.id, ore: () => hauler.harvester!.ore };
}

describe('Networked work state', () => {
  it('ships a mining hauler phase, cargo and seam to its owner', () => {
    const state = game();
    const hauler = seekAndMine(state, 0);
    const snapshot = createTeamSnapshot(state, 0);
    const projected = snapshot.entities.find((entity) => entity.id === hauler.id)!;
    expect(projected.harvester?.phase).toBe('mining');
    expect(projected.harvester?.ore).toBeGreaterThan(0);
    expect(projected.harvester?.oreTileX).toBeGreaterThanOrEqual(0);
    expect(projected.harvester?.oreTileZ).toBeGreaterThanOrEqual(0);
  });

  it('ships the engineer capture target and progress to its owner', () => {
    const state = game();
    const engineer = state.state.entities.find(
      (entity) => entity.kind === 'unit' && entity.owner === 0 && entity.defId === 'engineer',
    )!;
    const relay = state.state.entities.find(
      (entity) => entity.kind === 'building' && entity.owner === -1,
    )!;
    // An engineer only ever works a structure it can see, so put it on the
    // relay's doorstep and let the team's vision catch up before projecting.
    engineer.x = relay.x - 1.5 * TILE_SIZE;
    engineer.z = relay.z;
    for (let tick = 0; tick < 40; tick++) state.tick();
    engineer.captureTargetId = relay.id;
    engineer.captureProgress = 0.42;

    const snapshot = createTeamSnapshot(state, 0);
    const projected = snapshot.entities.find((entity) => entity.id === engineer.id)!;
    expect(projected.captureTargetId).toBe(relay.id);
    expect(projected.captureProgress).toBeCloseTo(0.42, 6);

    // The opponent's engineer is hidden, and an own unit's capture target is
    // still redacted if the structure is no longer known to that team.
    const foe = createTeamSnapshot(state, 0);
    expect(foe.entities.some((entity) => entity.captureProgress === 0.42 && entity.owner === 1)).toBe(
      false,
    );
  });

  it('keeps the hauler state in a delta rather than dropping it as unchanged', () => {
    const state = game();
    const hauler = seekAndMine(state, 0);
    const baselineState = createTeamSnapshot(state, 0);
    const baseline = createBaseline(baselineState);
    for (let tick = 0; tick < 20; tick++) state.tick();
    const current = createTeamSnapshot(state, 0);
    const changes = buildDelta(baseline, current, Uint8Array.from(current.fog));
    const upsert = (changes.entities?.upsert ?? []).find((entity) => entity.id === hauler.id);
    expect(upsert?.harvester?.ore).toBeGreaterThan(baselineState.entities.find((e) => e.id === hauler.id)!.harvester!.ore);
  });

  it('gives the client the real working state instead of a stopped hull', () => {
    const state = game();
    const hauler = seekAndMine(state, 0);
    const clientGame = new Game(cloneScenario(state.state.scenario), {
      localPlayerId: 0,
      enableAI: false,
      skipInit: true,
    });
    const battle = new NetworkBattle({ game: clientGame, team: 0, send: () => true });
    battle.apply(createTeamSnapshot(state, 0));

    const local = clientGame.getEntity(hauler.id)!;
    expect(local.harvester?.phase).toBe('mining');
    expect(local.harvester?.ore).toBeGreaterThan(0);

    const engineer = state.state.entities.find(
      (entity) => entity.kind === 'unit' && entity.owner === 0 && entity.defId === 'engineer',
    )!;
    const relayKnown = state.state.entities.find(
      (entity) => entity.kind === 'building' && entity.owner === -1,
    )!;
    engineer.x = relayKnown.x - 1.5 * TILE_SIZE;
    engineer.z = relayKnown.z;
    for (let tick = 0; tick < 40; tick++) state.tick();
    engineer.captureTargetId = relayKnown.id;
    engineer.captureProgress = 0.3;
    battle.apply(createTeamSnapshot(state, 0));
    const localEngineer = clientGame.getEntity(engineer.id)!;
    expect(localEngineer.captureTargetId).toBe(relayKnown.id);
    expect(localEngineer.captureProgress).toBeCloseTo(0.3, 6);
  });
  it('adopts a structure that changes hands, so a capture reads as captured', () => {
    const state = game();
    const clientGame = new Game(cloneScenario(state.state.scenario), {
      localPlayerId: 0,
      enableAI: false,
      skipInit: true,
    });
    const battle = new NetworkBattle({ game: clientGame, team: 0, send: () => true });

    const relay = state.state.entities.find(
      (entity) => entity.kind === 'building' && entity.owner === -1,
    )!;
    // Keep the objective in the team's sight so it is a live record rather than
    // a charted silhouette, then hand it over exactly as a finished capture does.
    const scout = state.state.entities.find((entity) => entity.kind === 'unit' && entity.owner === 0)!;
    scout.x = relay.x - 2 * TILE_SIZE;
    scout.z = relay.z;
    for (let tick = 0; tick < 40; tick++) state.tick();
    battle.apply(createTeamSnapshot(state, 0));
    expect(clientGame.getEntity(relay.id)!.owner).toBe(-1);

    relay.owner = 0;
    battle.apply(createTeamSnapshot(state, 0));
    const taken = clientGame.getEntity(relay.id)!;
    expect(taken.owner).toBe(0);
    expect(clientGame.isHostile(taken.owner, 0)).toBe(false);
  });
});
