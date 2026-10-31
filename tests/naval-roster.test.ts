import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { TILE_SIZE } from '../src/sim/constants';
import { UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';
import { isNavigable } from '../src/sim/terrain';
import { islandWith } from './helpers';

function fleetGame(units: Array<{ defId: string; owner: number; x: number; z: number }> = []) {
  return new Game(
    islandWith({
      structures: [{ defId: 'shipyard', owner: 0, x: 12, z: 37 }],
      units,
    }),
    { enableAI: false },
  );
}

function unit(game: Game, defId: string, owner = 0) {
  return game.state.entities.find(
    (e) => e.kind === 'unit' && e.defId === defId && e.owner === owner && e.hp > 0,
  )!;
}

describe('naval roster', () => {
  it('offers a cheap raider, the corvette core and an escort at the shipyard', () => {
    const game = fleetGame();
    const yard = game.entitiesOf(0, 'building').find((e) => e.defId === 'shipyard')!;
    expect(game.productionEntries(0, yard.defId)).toEqual([
      'missileBoat',
      'corvette',
      'submarine',
      'frigate',
    ]);

    game.player(0)!.mats = 6000;
    game.player(0)!.req = 1000;
    for (const id of ['missileBoat', 'corvette', 'submarine', 'frigate']) {
      expect(game.productionStatus(0, yard.id, id), id).toEqual({ ok: true, reason: '' });
    }
  });

  it('keeps each hull in its own price and range band', () => {
    expect(UNITS.missileBoat.cost.mats).toBeLessThan(UNITS.corvette.cost.mats);
    expect(UNITS.frigate.cost.mats).toBeGreaterThan(UNITS.corvette.cost.mats);
    expect(UNITS.missileBoat.ammo).toBe(2);
    expect(UNITS.corvette.ammo).toBe(6);
    expect(UNITS.frigate.ammo).toBe(4);
    expect(WEAPONS.skiffMissile.range).toBeLessThan(WEAPONS.navalMissile.range);
    expect(WEAPONS.navalSam.targets).toEqual(['air']);
    expect(WEAPONS.navalSam.antiAir).toBe(true);
    expect(UNITS.frigate.weapons).toContain('navalSam');
  });

  it('screens the fleet against a strike aircraft with its naval SAM', () => {
    const game = fleetGame([
      { defId: 'frigate', owner: 0, x: 9, z: 42 },
      { defId: 'fighter', owner: 1, x: 15, z: 42 },
    ]);
    const fighter = unit(game, 'fighter', 1);
    fighter.aircraft!.landed = false;
    fighter.fuel = fighter.maxFuel;
    fighter.order = null;
    const hp = fighter.hp;
    game.advance(20 * 12);
    expect(fighter.hp).toBeLessThan(hp);
    expect(game.state.events.some((e) => e.type === 'shot' || e.type === 'explosion')).toBe(true);
  });

  it('returns a fast attack craft to reload once its two missiles are spent', () => {
    const game = fleetGame([{ defId: 'missileBoat', owner: 0, x: 70, z: 58 }]);
    const boat = unit(game, 'missileBoat');
    expect(boat.maxAmmo).toBe(2);
    boat.ammo = 0;
    game.advance(20 * 2);
    expect(boat.order?.type === 'return' || boat.state === 'returning').toBe(true);
  });

  it('names the hull in its reload notice instead of always saying corvette', () => {
    const game = fleetGame([{ defId: 'missileBoat', owner: 0, x: 9, z: 42 }]);
    const boat = unit(game, 'missileBoat');
    boat.ammo = 0;
    game.advance(20 * 4);
    const texts = game.state.events.map((e) => ('text' in e ? String(e.text) : ''));
    expect(texts.some((text) => text.includes('Missile Boat reloaded'))).toBe(true);
    expect(boat.ammo).toBeGreaterThan(0);
  });

  it('keeps the new hulls water-bound and inside the sea', () => {
    for (const defId of ['missileBoat', 'frigate']) {
      const game = fleetGame([{ defId, owner: 0, x: 9, z: 42 }]);
      const ship = unit(game, defId);
      game.enqueueCommand({
        type: 'move',
        team: 0,
        ids: [ship.id],
        x: 60 * TILE_SIZE,
        z: 50 * TILE_SIZE,
      });
      game.advance(20 * 30);
      const terrain = game.state.map.terrain[
        Math.floor(ship.z / TILE_SIZE) * game.state.map.width + Math.floor(ship.x / TILE_SIZE)
      ];
      expect(isNavigable(terrain), `${defId} beached at terrain ${terrain}`).toBe(true);
    }
  });
});
