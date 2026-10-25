import { it } from 'vitest';
import { Game } from '../src/sim/game';
import { TILE_SIZE } from '../src/sim/constants';
import { islandWith } from './helpers';

it('debug naval', () => {
  const game = new Game(
    islandWith({
      structures: [{ defId: 'shipyard', owner: 0, x: 12, z: 37 }],
      units: [{ defId: 'corvette', owner: 0, x: 9, z: 42 }],
    }),
    { enableAI: false },
  );
  const ship = game.state.entities.find((e) => e.defId === 'corvette' && e.owner === 0)!;
  console.log('ship start', ship.x / TILE_SIZE, ship.z / TILE_SIZE, 'home', ship.homeId, game.getEntity(ship.homeId)?.defId, ship.ammo);
  game.enqueueCommand({ type: 'move', team: 0, ids: [ship.id], x: 60 * TILE_SIZE, z: 50 * TILE_SIZE });
  game.tick();
  console.log('after tick order', ship.order, 'path', ship.path.slice(0, 5), 'blocks', ship.blockedTicks, 'state', ship.state);
  for (const e of game.state.events.slice(-5)) console.log(e.type, e.text);
  for (let i = 0; i < 6; i++) {
    game.advance(20 * 5);
    console.log(
      i,
      'pos',
      (ship.x / TILE_SIZE).toFixed(2),
      (ship.z / TILE_SIZE).toFixed(2),
      'order',
      ship.order,
      'pathIndex',
      ship.pathIndex,
      '/',
      ship.path.length,
      'state',
      ship.state,
    );
  }
  console.log('events', game.state.events.slice(-10).map((e) => `${e.type}:${e.text}`));
  ship.ammo = 0;
  game.advance(20 * 2);
  console.log('ammo return', ship.order, ship.state, ship.ammo);
});
