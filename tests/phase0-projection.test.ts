import { describe, expect, it } from 'vitest';
import { createIslandAssault } from '../src/data/scenarios';
import { Game } from '../src/sim/game';
import { projectForTeam } from '../phase0/projection';
import type { Projectile } from '../src/sim/types';

function hiddenEnemy(game: Game, team: number) {
  const enemy = game.state.entities.find(
    (entity) =>
      entity.kind === 'unit' &&
      game.teamOf(entity.owner) !== team &&
      !game.isVisibleTo(team, entity.id),
  );
  if (!enemy) throw new Error('fixture has no hidden enemy unit');
  return enemy;
}

describe('phase-0 team projection', () => {
  it('sends only own and currently visible entities, and no raw game state', () => {
    const scenario = createIslandAssault();
    scenario.settings.fog = true;
    const game = new Game(scenario, { enableAI: false });
    const hidden = hiddenEnemy(game, 0);
    game.state.players[1].mats = 987654;

    const snapshot = projectForTeam(game, 0, 0);
    const payload = JSON.stringify(snapshot);

    expect(snapshot.type).toBe('snapshot');
    expect(snapshot.team).toBe(0);
    expect(snapshot.players.map((player) => player.id)).toEqual([0]);
    expect(snapshot.entities.some((entity) => entity.id === hidden.id)).toBe(false);
    for (const entity of snapshot.entities) {
      const ownerTeam = game.teamOf(entity.owner);
      expect(ownerTeam === 0 || game.isVisibleTo(0, entity.id)).toBe(true);
    }
    expect(payload).not.toContain('987654');
    expect(payload).not.toContain('"scenario"');
    expect(payload).not.toContain('"ai"');
    expect(payload).not.toContain('"contacts"');
    expect(payload).not.toContain('"charted"');
    expect(payload).not.toContain('"fog"');
    expect(payload).not.toContain('"rngState"');
    expect(payload).not.toContain('"seed"');
  });

  it('redacts hidden enemy events for the opposing team and keeps own events', () => {
    const scenario = createIslandAssault();
    scenario.settings.fog = true;
    const game = new Game(scenario, { enableAI: false });
    const hidden = hiddenEnemy(game, 0);
    game.emit('shot', {
      team: game.state.players[1].id,
      x: hidden.x,
      z: hidden.z,
      text: 'hidden-enemy-fire',
      entityId: hidden.id,
      targetId: game.state.entities.find((entity) => game.teamOf(entity.owner) === 0)?.id,
      weaponId: 'rifle',
    });

    const teamZero = projectForTeam(game, 0, 0);
    const teamOne = projectForTeam(game, 1, 0);
    expect(JSON.stringify(teamZero)).not.toContain('hidden-enemy-fire');
    expect(teamZero.events.some((event) => event.text === 'hidden-enemy-fire')).toBe(false);
    expect(teamOne.events.some((event) => event.text === 'hidden-enemy-fire')).toBe(true);
    expect(teamZero.events.every((event) => event.entityId !== hidden.id)).toBe(true);
  });

  it('strips hidden ids from own-team events as well as enemy events', () => {
    const scenario = createIslandAssault();
    scenario.settings.fog = true;
    const game = new Game(scenario, { enableAI: false });
    const own = game.state.entities.find(
      (entity) => entity.kind === 'unit' && game.teamOf(entity.owner) === 0,
    );
    if (!own) throw new Error('fixture has no own unit');
    const hidden = hiddenEnemy(game, 0);
    game.emit('shot', {
      team: game.state.players[0].id,
      x: own.x,
      z: own.z,
      text: 'own-fire-at-remembered-position',
      entityId: own.id,
      targetId: hidden.id,
      weaponId: 'rifle',
    });

    const snapshot = projectForTeam(game, 0, 0);
    const event = snapshot.events.find((entry) => entry.text === 'own-fire-at-remembered-position');
    expect(event?.entityId).toBe(own.id);
    expect(event?.targetId).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain(`"targetId":${hidden.id}`);
  });

  it('never exposes a hidden shooter id on a visible projectile', () => {
    const scenario = createIslandAssault();
    scenario.settings.fog = true;
    const game = new Game(scenario, { enableAI: false });
    const own = game.state.entities.find(
      (entity) => entity.kind === 'unit' && game.teamOf(entity.owner) === 0,
    );
    if (!own) throw new Error('fixture has no own unit');
    const hidden = hiddenEnemy(game, 0);
    game.state.projectiles.push({
      id: 9001,
      owner: hidden.owner,
      shooterId: hidden.id,
      weaponId: 'rifle',
      x: own.x,
      y: 0,
      z: own.z,
    } as unknown as Projectile);

    const snapshot = projectForTeam(game, 0, 0);
    const projectile = snapshot.projectiles.find((entry) => entry.id === 9001);
    expect(projectile).toBeDefined();
    expect(projectile?.shooterId).toBe(0);
    expect(JSON.stringify(snapshot)).not.toContain(`"shooterId":${hidden.id}`);
  });

  it('shows an enemy unit when the team actually sees it', () => {
    const scenario = createIslandAssault();
    scenario.settings.fog = false;
    const game = new Game(scenario, { enableAI: false });
    const enemy = game.state.entities.find(
      (entity) => entity.kind === 'unit' && game.teamOf(entity.owner) === 1,
    );
    if (!enemy) throw new Error('fixture has no enemy unit');

    const snapshot = projectForTeam(game, 0, 0);
    expect(snapshot.entities.some((entity) => entity.id === enemy.id)).toBe(true);
    expect(snapshot.players.map((player) => player.id)).toEqual([0]);
  });

  it('uses the same default-deny boundary for both teams', () => {
    const scenario = createIslandAssault();
    scenario.settings.fog = true;
    const game = new Game(scenario, { enableAI: false });
    const hiddenZero = hiddenEnemy(game, 0);
    const hiddenOne = hiddenEnemy(game, 1);

    const zero = projectForTeam(game, 0, 0);
    const one = projectForTeam(game, 1, 0);
    expect(zero.entities.some((entity) => entity.id === hiddenZero.id)).toBe(false);
    expect(one.entities.some((entity) => entity.id === hiddenOne.id)).toBe(false);
    expect(zero.players.every((player) => player.team === 0)).toBe(true);
    expect(one.players.every((player) => player.team === 1)).toBe(true);
  });
});
