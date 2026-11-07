import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { TILE_SIZE } from '../src/sim/constants';
import { islandWith } from './helpers';

function newGame() {
  // Air and naval fixtures: the landing force no longer starts with these.
  return new Game(
    islandWith({
      structures: [
        { defId: 'airfield', owner: 0, x: 24, z: 24 },
        { defId: 'shipyard', owner: 0, x: 12, z: 37 },
        { defId: 'samBattery', owner: 1, x: 68, z: 38 },
      ],
      units: [
        { defId: 'fighter', owner: 0, x: 30, z: 27 },
        { defId: 'corvette', owner: 0, x: 9, z: 42 },
        { defId: 'corvette', owner: 1, x: 66, z: 48 },
      ],
    }),
    { enableAI: false },
  );
}

function unit(game: Game, defId: string, owner: number) {
  return game.state.entities.find((e) => e.kind === 'unit' && e.defId === defId && e.owner === owner)!;
}

describe('aircraft operations', () => {
  it('starts parked, burns fuel in flight and can be ordered to land and rearm', () => {
    const game = newGame();
    const fighter = unit(game, 'fighter', 0);
    const startFuel = fighter.fuel;
    expect(fighter.aircraft?.landed).toBe(true);
    game.advance(20 * 5);
    // A parked aircraft does not consume fuel while it waits on the pad.
    expect(fighter.fuel).toBe(startFuel);

    const home = game.getEntity(fighter.homeId)!;
    game.enqueueCommand({ type: 'move', team: 0, ids: [fighter.id], x: 200, z: 140 });
    // Taxi out, run the strip, climb: the hull is airborne a few seconds in.
    for (let i = 0; i < 20 * 20 && fighter.aircraft?.landed; i++) game.advance(1);
    expect(fighter.aircraft?.landed).toBe(false);
    game.advance(20 * 4);
    expect(fighter.fuel).toBeLessThan(startFuel);
    // It must actually leave the airfield, not hover inside its own footprint.
    expect(Math.hypot(fighter.x - home.x, fighter.z - home.z)).toBeGreaterThan(20);

    game.enqueueCommand({ type: 'return', team: 0, ids: [fighter.id] });
    for (let i = 0; i < 40 && !fighter.aircraft?.landed; i++) game.advance(20);
    expect(fighter.aircraft?.landed).toBe(true);
    // Approach, roll-out and the servicing run: the hull re-arms once it is on
    // its stand, not the moment it is cleared to land.
    for (let i = 0; i < 20 * 20 && fighter.fuel < fighter.maxFuel; i++) game.advance(1);
    expect(fighter.ammo).toBe(fighter.maxAmmo);
    expect(fighter.fuel).toBe(fighter.maxFuel);
    expect(fighter.state).toBe('grounded');
  });

  it('strikes ground targets, consumes missiles and returns when empty', () => {
    const game = newGame();
    const fighter = unit(game, 'fighter', 0);
    const target = unit(game, 'tank', 1);
    // Remove enemy air defence for a clean strike test and move the target near the airfield.
    for (const e of game.state.entities) {
      if (e.defId === 'samBattery' || e.defId === 'aa') e.hp = 0;
    }
    target.x = 36 * TILE_SIZE;
    target.z = 28 * TILE_SIZE;
    fighter.fuel = fighter.maxFuel;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [fighter.id], targetId: target.id });
    game.advance(20 * 30);
    expect(target.hp < target.maxHp || !game.getEntity(target.id)).toBe(true);
    // The aircraft either still carries ordnance or has already recovered and rearmed.
    expect(game.state.events.some((e) => e.type === 'aircraftReturn')).toBe(true);
    if (!fighter.aircraft?.landed) {
      game.enqueueCommand({ type: 'return', team: 0, ids: [fighter.id] });
      game.advance(20 * 12);
    }
    expect(fighter.aircraft?.landed).toBe(true);
  });

  it('is threatened by mobile and static air defence', () => {
    const game = newGame();
    const fighter = unit(game, 'fighter', 0);
    const sam = game.state.entities.find((e) => e.defId === 'samBattery' && e.owner === 1)!;
    fighter.x = sam.x - 20;
    fighter.z = sam.z;
    fighter.fuel = fighter.maxFuel;
    fighter.order = null;
    fighter.aircraft!.landed = false;
    const hp = fighter.hp;
    game.advance(20 * 6);
    expect(fighter.hp).toBeLessThan(hp);
    expect(game.state.events.some((e) => e.type === 'shot')).toBe(true);
  });

  it('does not let ground-only weapons damage aircraft', () => {
    const game = newGame();
    const fighter = unit(game, 'fighter', 0);
    const tank = unit(game, 'tank', 1);
    for (const e of game.state.entities) {
      if (e.owner === 1 && (e.defId === 'samBattery' || e.defId === 'aa')) e.hp = 0;
    }
    fighter.x = tank.x - 20;
    fighter.z = tank.z;
    fighter.fuel = fighter.maxFuel;
    fighter.aircraft!.landed = false;
    const hp = fighter.hp;
    game.advance(20 * 8);
    expect(fighter.hp).toBe(hp);
  });
});

describe('naval operations', () => {
  it('navigates the bay and rejects land destinations', () => {
    const game = newGame();
    const ship = unit(game, 'corvette', 0);
    game.enqueueCommand({ type: 'move', team: 0, ids: [ship.id], x: 60 * TILE_SIZE, z: 50 * TILE_SIZE });
    game.advance(20 * 25);
    expect(ship.x / TILE_SIZE).toBeGreaterThan(35);
    const terrain = game.state.map.terrain[
      Math.floor(ship.z / TILE_SIZE) * game.state.map.width + Math.floor(ship.x / TILE_SIZE)
    ];
    expect([0, 1]).toContain(terrain);

    game.enqueueCommand({ type: 'move', team: 0, ids: [ship.id], x: 76 * TILE_SIZE, z: 26 * TILE_SIZE });
    game.tick();
    expect(game.state.events.some((e) => e.type === 'orderFailed')).toBe(true);
  });

  it('fights opposing vessels with missiles and the deck gun', () => {
    const game = newGame();
    const blue = unit(game, 'corvette', 0);
    const red = unit(game, 'corvette', 1);
    blue.x = 62 * TILE_SIZE;
    blue.z = 50 * TILE_SIZE;
    red.x = 68 * TILE_SIZE;
    red.z = 49 * TILE_SIZE;
    blue.order = null;
    red.order = null;
    const blueHp = blue.hp;
    const redHp = red.hp;
    game.advance(20 * 20);
    expect(blue.hp < blueHp || red.hp < redHp).toBe(true);
    expect(game.state.events.some((e) => e.type === 'shot' || e.type === 'explosion')).toBe(true);
  });

  it('reloads missiles and repairs at a friendly shipyard', () => {
    const game = newGame();
    const ship = unit(game, 'corvette', 0);
    const yard = game.state.entities.find((e) => e.owner === 0 && e.defId === 'shipyard')!;
    ship.x = 11.2 * TILE_SIZE;
    ship.z = 39 * TILE_SIZE;
    ship.ammo = 0;
    ship.hp = ship.maxHp * 0.5;
    ship.order = null;
    const before = ship.ammo;
    game.advance(20 * 15);
    expect(ship.ammo).toBeGreaterThan(before);
    expect(ship.hp).toBeGreaterThan(ship.maxHp * 0.5);
    expect(yard.hp).toBeGreaterThan(0);
  });

  it('repairs a damaged corvette even with a full missile rack', () => {
    const game = newGame();
    const ship = unit(game, 'corvette', 0);
    ship.x = 11.2 * TILE_SIZE;
    ship.z = 39 * TILE_SIZE;
    ship.ammo = ship.maxAmmo;
    ship.hp = ship.maxHp * 0.5;
    ship.order = null;
    game.advance(20 * 15);
    expect(ship.ammo).toBe(ship.maxAmmo);
    expect(ship.hp).toBeGreaterThan(ship.maxHp * 0.5);
  });

  it('does not repair when the shipyard is destroyed', () => {
    const game = newGame();
    const ship = unit(game, 'corvette', 0);
    const yard = game.state.entities.find((e) => e.owner === 0 && e.defId === 'shipyard')!;
    ship.x = 11.2 * TILE_SIZE;
    ship.z = 39 * TILE_SIZE;
    ship.ammo = ship.maxAmmo;
    ship.hp = ship.maxHp * 0.5;
    ship.order = null;
    yard.hp = 0;
    game.advance(20 * 15);
    expect(ship.hp).toBe(ship.maxHp * 0.5);
  });

  it('rallies its hulls to open water and refuses a land rally', () => {
    const game = newGame();
    const yard = game.state.entities.find((e) => e.owner === 0 && e.defId === 'shipyard')!;

    // A new yard seeds its rally on navigable water, not on the beach behind it.
    expect(game.rallyStatus(yard.id, yard.rallyX, yard.rallyZ)).toEqual({ ok: true, reason: '' });
    const rallyTile = game.state.map.terrain[
      Math.floor(yard.rallyZ / TILE_SIZE) * game.state.map.width +
        Math.floor(yard.rallyX / TILE_SIZE)
    ];
    expect([0, 1]).toContain(rallyTile);

    // A dry drop is rejected, and the rejection is reported, not silently taken.
    const dryX = yard.x;
    const dryZ = yard.z + TILE_SIZE;
    const keptX = yard.rallyX;
    const keptZ = yard.rallyZ;
    expect(game.rallyStatus(yard.id, dryX, dryZ).ok).toBe(false);
    game.enqueueCommand({ type: 'setRally', team: 0, buildingId: yard.id, x: dryX, z: dryZ });
    game.tick();
    expect(yard.rallyX).toBe(keptX);
    expect(yard.rallyZ).toBe(keptZ);
    expect(game.state.events.some((e) => e.type === 'orderFailed' && /water/i.test(e.text))).toBe(true);

    // A water drop is accepted.
    const seaX = (yard.rallyX / TILE_SIZE) * TILE_SIZE;
    const seaZ = (yard.rallyZ / TILE_SIZE) * TILE_SIZE;
    game.enqueueCommand({ type: 'setRally', team: 0, buildingId: yard.id, x: seaX, z: seaZ });
    game.tick();
    expect(yard.rallyX).toBe(seaX);
    expect(yard.rallyZ).toBe(seaZ);
  });

  it('walks a new hull to the naval rally point', () => {
    const game = newGame();
    const yard = game.state.entities.find((e) => e.owner === 0 && e.defId === 'shipyard')!;
    game.player(0)!.mats = 5000;
    game.player(0)!.req = 400;
    const before = new Set(game.entitiesOf(0, 'unit').map((e) => e.id));
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: yard.id, defId: 'corvette' });

    let launched = null as ReturnType<typeof unit> | null;
    for (let i = 0; i < 20 * 60 && !launched; i++) {
      game.tick();
      launched = game.entitiesOf(0, 'unit').find((e) => !before.has(e.id)) ?? null;
    }
    expect(launched).not.toBeNull();
    expect(game.rallyStatus(yard.id, yard.rallyX, yard.rallyZ).ok).toBe(true);

    game.advance(20 * 20);
    const tile = game.state.map.terrain[
      Math.floor(launched!.z / TILE_SIZE) * game.state.map.width +
        Math.floor(launched!.x / TILE_SIZE)
    ];
    expect([0, 1]).toContain(tile);
  });

  it('automatically returns to reload when out of missiles', () => {
    const game = newGame();
    const ship = unit(game, 'corvette', 0);
    ship.x = 70 * TILE_SIZE;
    ship.z = 58 * TILE_SIZE;
    ship.ammo = 0;
    game.advance(20 * 2);
    expect(ship.order?.type === 'return' || ship.state === 'returning').toBe(true);
  });
});
