import { createTeamSnapshot } from '../src/multiplayer/projection';
import { TILE_SIZE } from '../src/sim/constants';
import type { Projectile } from '../src/sim/types';
import {
  hiddenEnemyBuilding,
  hiddenEnemyUnit,
  ownUnit,
  serverGame,
  twoVersusTwoGame,
} from './phase1-helpers';

function hiddenProjectile(owner: number, shooterId: number, x: number, z: number): Projectile {
  return {
    id: 9001,
    owner,
    shooterId,
    weaponId: 'rifle',
    x,
    y: 0,
    z,
    tx: x,
    ty: 0,
    tz: z,
    targetId: 0,
    speed: 1,
    splash: 0,
    kind: 'bullet',
    homing: false,
    damage: 1,
    armourMul: {},
    suppression: 0,
    seed: 0,
  };
}

describe('Phase 1 team projection', () => {
  it('contains only the recipient team and its own fog/contact memory', () => {
    const game = serverGame();
    game.state.contacts.push({
      team: 1,
      entityId: ownUnit(game, 0).id,
      x: 10,
      z: 10,
      tick: game.state.tick,
      defId: 'rifle',
      kind: 'unit',
    });
    const zero = createTeamSnapshot(game, 0);
    const one = createTeamSnapshot(game, 1);

    expect(zero.players.map((player) => player.id)).toEqual([0]);
    expect(one.players.map((player) => player.id)).toEqual([1]);
    expect(zero.fog).toEqual(Array.from(game.state.fog[0]));
    expect(one.fog).toEqual(Array.from(game.state.fog[1]));
    expect(zero.contacts).toHaveLength(0);
    expect(one.contacts).toHaveLength(1);
    expect(zero.map.terrain).toHaveLength(game.state.map.width * game.state.map.height);
    expect(zero.map.elevation).toHaveLength(zero.map.terrain.length);
    expect(zero.result.phase).toBe('playing');
  });

  it('excludes hidden enemies, their resources, events and projectiles', () => {
    const game = serverGame();
    const hidden = hiddenEnemyUnit(game, 0);
    const hiddenBuilding = hiddenEnemyBuilding(game, 0);
    const enemy = game.player(1)!;
    enemy.name = 'SECRET ENEMY NAME';
    enemy.mats = 987654;
    enemy.req = 876543;
    hiddenBuilding.queue.push({ defId: 'tank', remaining: 10, total: 20 });
    game.state.charted.push({ team: 0, entityId: hiddenBuilding.id });
    game.emit('shot', {
      team: 1,
      x: hidden.x,
      z: hidden.z,
      text: 'HIDDEN SHOT',
      entityId: hidden.id,
    });
    game.state.projectiles.push(hiddenProjectile(1, hidden.id, hidden.x, hidden.z));

    expect(game.fogAt(0, Math.floor(hidden.x / TILE_SIZE), Math.floor(hidden.z / TILE_SIZE))).not.toBe(2);
    const snapshot = createTeamSnapshot(game, 0);
    const payload = JSON.stringify(snapshot);

    expect(snapshot.entities.some((entity) => entity.id === hidden.id)).toBe(false);
    expect(snapshot.projectiles.some((projectile) => projectile.id === 9001)).toBe(false);
    expect(snapshot.events.some((event) => event.text === 'HIDDEN SHOT')).toBe(false);
    expect(payload).not.toContain('SECRET ENEMY NAME');
    expect(payload).not.toContain('987654');
    expect(payload).not.toContain('876543');
    expect(payload).not.toContain(`"id":${hidden.id}`);
    expect(payload).not.toContain(`"entityId":${hidden.id}`);
    expect(payload).not.toContain(`"targetId":${hidden.id}`);
    expect(payload).not.toContain(`"shooterId":${hidden.id}`);
  });

  it('shows a charted structure without live hidden state', () => {
    const game = serverGame();
    const building = hiddenEnemyBuilding(game, 0);
    game.state.charted.push({ team: 0, entityId: building.id });
    const snapshot = createTeamSnapshot(game, 0);
    const remembered = snapshot.entities.find((entity) => entity.id === building.id);

    expect(remembered).toBeDefined();
    expect(remembered?.remembered).toBe(true);
    expect(remembered?.hp).toBeNull();
    expect(remembered?.maxHp).toBeNull();
    expect(remembered?.queue).toBeUndefined();
    expect(remembered?.state).toBeNull();
    expect(snapshot.charted).toContain(building.id);
  });

  it('keeps visible enemies and own production data on the wire', () => {
    const game = serverGame();
    const own = ownUnit(game, 0, 'tank');
    own.queue.push({ defId: 'tank', remaining: 5, total: 10 });
    const visibleEnemy = game.state.entities.find(
      (entity) =>
        entity.kind === 'unit' &&
        entity.hp > 0 &&
        game.teamOf(entity.owner) === 1 &&
        game.isVisibleTo(0, entity.id),
    );
    if (!visibleEnemy) return;

    const snapshot = createTeamSnapshot(game, 0);
    const ownProjection = snapshot.entities.find((entity) => entity.id === own.id);
    const enemyProjection = snapshot.entities.find((entity) => entity.id === visibleEnemy.id);
    expect(ownProjection?.queue?.[0]?.defId).toBe('tank');
    expect(enemyProjection?.queue).toBeUndefined();
    expect(enemyProjection?.hp).not.toBeNull();
  });

  it('shows allied players and units in a 2v2 team payload', () => {
    const game = twoVersusTwoGame();
    const zero = createTeamSnapshot(game, 0);
    expect(zero.players.map((player) => player.id).sort()).toEqual([0, 2]);
    expect(zero.result.teams.map((team) => team.team)).toEqual([0, 1]);
  });

  it('keeps the opposing team out of a team-one payload', () => {
    const game = serverGame();
    const blueBuilding = hiddenEnemyBuilding(game, 1);
    game.state.charted.push({ team: 1, entityId: blueBuilding.id });
    const snapshot = createTeamSnapshot(game, 1);
    const payload = JSON.stringify(snapshot);
    expect(snapshot.players.every((player) => player.team === 1)).toBe(true);
    expect(payload).not.toContain('Baltic Task Force');
    expect(snapshot.charted).not.toContain(
      game.state.charted.find((chart) => chart.team === 0)?.entityId ?? -1,
    );
  });
});
