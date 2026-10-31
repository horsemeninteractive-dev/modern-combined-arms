import { createIslandAssault } from '../src/data/scenarios';
import { Game } from '../src/sim/game';
import type { Scenario } from '../src/sim/scenario';
import type { Entity } from '../src/sim/types';
import type { SeatAuthority } from '../src/multiplayer/commandGate';

/**
 * The authoritative room has no local player. `Game.evaluateVictory()` then
 * returns without choosing a winner, leaving the neutral result layer as the
 * only authority. Single-player startup never uses this fixture.
 */
export function serverGame(scenario: Scenario = createIslandAssault()): Game {
  scenario.settings.seed = 773311;
  scenario.settings.fog = true;
  return new Game(scenario, { localPlayerId: -1, enableAI: false });
}

export function twoSeats(): SeatAuthority[] {
  return [
    { seatId: 0, playerId: 0, team: 0, active: true },
    { seatId: 1, playerId: 1, team: 1, active: true },
  ];
}

export function fourSeats(): SeatAuthority[] {
  return [
    { seatId: 0, playerId: 0, team: 0, active: true },
    { seatId: 1, playerId: 1, team: 1, active: true },
    { seatId: 2, playerId: 2, team: 0, active: true },
    { seatId: 3, playerId: 3, team: 1, active: true },
  ];
}

export function ownUnit(game: Game, owner = 0, defId?: string): Entity {
  const entity = game.state.entities.find(
    (entry) =>
      entry.kind === 'unit' &&
      entry.owner === owner &&
      entry.hp > 0 &&
      (!defId || entry.defId === defId),
  );
  if (!entity) throw new Error(`No unit for player ${owner}.`);
  return entity;
}

export function hiddenEnemyUnit(game: Game, team = 0): Entity {
  const entity = game.state.entities.find(
    (entry) =>
      entry.kind === 'unit' &&
      entry.hp > 0 &&
      game.teamOf(entry.owner) !== team &&
      !game.isVisibleTo(team, entry.id),
  );
  if (!entity) throw new Error(`No hidden enemy unit for team ${team}.`);
  return entity;
}

export function hiddenEnemyBuilding(game: Game, team = 0): Entity {
  const entity = game.state.entities.find(
    (entry) =>
      entry.kind === 'building' &&
      entry.hp > 0 &&
      game.teamOf(entry.owner) !== team &&
      !game.isVisibleTo(team, entry.id),
  );
  if (!entity) throw new Error(`No hidden enemy structure for team ${team}.`);
  return entity;
}

/** Add two players to the island fixture without changing the shipped scenario. */
export function twoVersusTwoGame(): Game {
  const scenario = createIslandAssault();
  scenario.players.push(
    {
      id: 2,
      name: 'Blue Ally',
      factionId: 'baltic',
      team: 0,
      isAI: false,
      startX: 20,
      startZ: 40,
    },
    {
      id: 3,
      name: 'Red Ally',
      factionId: 'expeditionary',
      team: 1,
      isAI: false,
      startX: 72,
      startZ: 20,
    },
  );
  return serverGame(scenario);
}
