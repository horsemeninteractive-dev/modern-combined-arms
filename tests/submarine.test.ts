import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { TILE_SIZE } from '../src/sim/constants';
import { UNITS } from '../src/data/units';
import { WEAPONS } from '../src/data/weapons';
import { canWeaponTarget } from '../src/sim/combat';
import { completeResearch, islandWith } from './helpers';

function fleetGame(
  units: Array<{ defId: string; owner: number; x: number; z: number }>,
  fog = true,
) {
  const scenario = islandWith({
    structures: [{ defId: 'shipyard', owner: 0, x: 12, z: 37 }],
    units,
  });
  scenario.settings.fog = fog;
  const game = new Game(scenario, { enableAI: false });
  // Hull behaviour is the subject; the naval tree is granted so the yard can
  // offer the submarine and its escort.
  completeResearch(game, 0);
  return game;
}

function unit(game: Game, defId: string, owner = 0) {
  return game.state.entities.find(
    (e) => e.kind === 'unit' && e.defId === defId && e.owner === owner && e.hp > 0,
  )!;
}

function dive(game: Game, subId: number, value = true) {
  game.enqueueCommand({ type: 'dive', team: 0, ids: [subId], dive: value });
  game.tick();
}

describe('attack submarine', () => {
  it('is a shipyard hull with a torpedo and a frigate ASW counter', () => {
    const game = fleetGame([]);
    const yard = game.entitiesOf(0, 'building').find((e) => e.defId === 'shipyard')!;
    expect(game.productionEntries(0, yard.defId)).toEqual([
      'missileBoat',
      'corvette',
      'submarine',
      'frigate',
      'navalSupport',
    ]);
    game.player(0)!.mats = 6000;
    game.player(0)!.req = 1000;
    expect(game.productionStatus(0, yard.id, 'submarine')).toEqual({ ok: true, reason: '' });

    expect(UNITS.submarine.weapons).toContain('torpedo');
    expect(UNITS.submarine.submarine?.batterySeconds).toBe(45);
    expect(WEAPONS.torpedo.targets).toEqual(['naval']);
    expect(WEAPONS.torpedo.underwater).toBe(true);
    expect(UNITS.frigate.weapons).toContain('depthCharge');
    expect(UNITS.frigate.sonar).toBe(12);
    expect(WEAPONS.depthCharge.asw).toBe(true);
  });

  it('dives, burns battery, refuses a low battery and is forced to surface', () => {
    const game = fleetGame([{ defId: 'submarine', owner: 0, x: 9, z: 42 }]);
    const sub = unit(game, 'submarine');
    expect(sub.submarine?.dived).toBe(false);

    dive(game, sub.id);
    expect(sub.submarine?.dived).toBe(true);
    const battery = sub.submarine!.battery;
    game.advance(20 * 5);
    expect(sub.submarine!.battery).toBeLessThan(battery);

    sub.submarine!.battery = 4;
    dive(game, sub.id, false);
    dive(game, sub.id, true);
    expect(sub.submarine!.dived).toBe(false);
    expect(
      game.state.events.some((e) => e.type === 'orderFailed' && /battery too low/i.test(e.text)),
    ).toBe(true);

    sub.submarine!.battery = 30;
    dive(game, sub.id);
    sub.submarine!.battery = 0.2;
    game.advance(20);
    expect(sub.submarine!.dived).toBe(false);
    expect(
      game.state.events.some((e) => e.type === 'alert' && /battery exhausted/i.test(e.text)),
    ).toBe(true);
    expect(sub.submarine!.battery).toBeGreaterThan(0);
  });

  it('hides a dived boat from normal vision and reveals it on a torpedo launch', () => {
    const game = fleetGame([
      { defId: 'submarine', owner: 0, x: 9, z: 42 },
      { defId: 'corvette', owner: 1, x: 17, z: 42 },
    ]);
    const sub = unit(game, 'submarine');
    const enemy = unit(game, 'corvette', 1);
    sub.submarine!.dived = true;
    game.refreshVision(false);

    // Eight tiles from a corvette with no sonar: the periscope is not seen.
    expect(game.isVisibleTo(1, sub.id)).toBe(false);
    expect(canWeaponTarget(WEAPONS.navalGun, sub)).toBe(false);
    expect(canWeaponTarget(WEAPONS.depthCharge, sub)).toBe(true);

    // Close visual detection: a nearby hostile can see the feather.
    enemy.x = sub.x + 4 * TILE_SIZE;
    game.refreshVision(false);
    expect(game.isVisibleTo(1, sub.id)).toBe(true);

    // Back out of periscope range, then launch. The datum exposes the boat.
    enemy.x = sub.x + 8 * TILE_SIZE;
    game.refreshVision(false);
    expect(game.isVisibleTo(1, sub.id)).toBe(false);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [sub.id], targetId: enemy.id });
    game.advance(20 * 3);

    expect(sub.submarine!.revealed).toBe(true);
    expect(game.isVisibleTo(1, sub.id)).toBe(true);
    expect(canWeaponTarget(WEAPONS.navalGun, sub)).toBe(true);
  });

  it('lets a frigate sonar find a dived boat where a corvette cannot', () => {
    const withFrigate = fleetGame([
      { defId: 'submarine', owner: 0, x: 9, z: 42 },
      { defId: 'frigate', owner: 1, x: 19, z: 42 },
    ]);
    const subA = unit(withFrigate, 'submarine');
    subA.submarine!.dived = true;
    withFrigate.refreshVision(false);
    expect(withFrigate.isVisibleTo(1, subA.id)).toBe(true);

    const withCorvette = fleetGame([
      { defId: 'submarine', owner: 0, x: 9, z: 42 },
      { defId: 'corvette', owner: 1, x: 19, z: 42 },
    ]);
    const subB = unit(withCorvette, 'submarine');
    subB.submarine!.dived = true;
    withCorvette.refreshVision(false);
    expect(withCorvette.isVisibleTo(1, subB.id)).toBe(false);
  });

  it('fires a torpedo only at a surface fleet target and damages it', () => {
    const game = fleetGame([
      { defId: 'submarine', owner: 0, x: 7, z: 50 },
      { defId: 'corvette', owner: 1, x: 13, z: 50 },
    ]);
    const sub = unit(game, 'submarine');
    const enemy = unit(game, 'corvette', 1);
    sub.submarine!.dived = true;
    game.refreshVision(false);
    const hp = enemy.hp;

    game.enqueueCommand({ type: 'attack', team: 0, ids: [sub.id], targetId: enemy.id });
    game.advance(20 * 5);

    expect(sub.ammo).toBe(3);
    expect(enemy.hp).toBeLessThan(hp);
    expect(game.state.events.some((e) => e.type === 'shot' && e.weaponId === 'torpedo')).toBe(true);
  });

  it('keeps anti-ship missiles in the rack while a dived boat is the target', () => {
    const game = fleetGame([
      { defId: 'frigate', owner: 0, x: 10, z: 42 },
      { defId: 'submarine', owner: 1, x: 12.5, z: 42 },
    ]);
    const frigate = unit(game, 'frigate');
    const sub = unit(game, 'submarine', 1);
    sub.submarine!.dived = true;
    // A launch datum is exactly when an escort might be tempted to spend a
    // missile on a periscope; the ASW rack must still answer the boat.
    sub.submarine!.revealed = true;
    sub.submarine!.revealTimer = 30;
    game.refreshVision(false);
    expect(frigate.ammo).toBe(4);

    game.advance(20 * 7);

    expect(frigate.ammo).toBe(4);
    expect(game.state.events.some((e) => e.type === 'shot' && e.weaponId === 'depthCharge')).toBe(true);
    expect(game.state.events.some((e) => e.type === 'shot' && e.weaponId === 'navalMissile')).toBe(false);
  });

  it('damages a dived boat with frigate depth charges', () => {
    const game = fleetGame([
      { defId: 'frigate', owner: 0, x: 10, z: 42 },
      { defId: 'submarine', owner: 1, x: 12.5, z: 42 },
    ]);
    const frigate = unit(game, 'frigate');
    const sub = unit(game, 'submarine', 1);
    sub.submarine!.dived = true;
    game.refreshVision(false);
    expect(game.isVisibleTo(0, sub.id)).toBe(true);

    const hp = sub.hp;
    game.advance(20 * 18);
    expect(sub.hp).toBeLessThan(hp);
    expect(frigate.hp).toBeGreaterThan(0);
    expect(game.state.events.some((e) => e.weaponId === 'depthCharge')).toBe(true);
  });

  it('sends an AI escort to hunt a sonar contact', () => {
    const scenario = createIslandAssault();
    scenario.settings.fog = true;
    scenario.units.push(
      { defId: 'frigate', owner: 1, x: 20, z: 42 },
      { defId: 'submarine', owner: 0, x: 24, z: 42 },
    );
    const game = new Game(scenario, { enableAI: true, aiDifficulty: 'veteran' });
    const frigate = game.state.entities.find(
      (e) => e.kind === 'unit' && e.defId === 'frigate' && e.owner === 1,
    )!;
    const sub = game.state.entities.find(
      (e) => e.kind === 'unit' && e.defId === 'submarine' && e.owner === 0,
    )!;
    sub.submarine!.dived = true;
    game.refreshVision(false);
    expect(game.isVisibleTo(1, sub.id)).toBe(true);

    game.advance(20 * 3);

    expect(frigate.order?.type).toBe('attack');
    expect(frigate.order?.targetId).toBe(sub.id);
  });

  it('lets an AI submarine prefer a corvette to its ASW escort', () => {
    const scenario = createIslandAssault();
    scenario.settings.fog = true;
    scenario.units.push(
      { defId: 'submarine', owner: 1, x: 20, z: 42 },
      { defId: 'frigate', owner: 0, x: 24, z: 42 },
      { defId: 'corvette', owner: 0, x: 24, z: 46 },
    );
    const game = new Game(scenario, { enableAI: true, aiDifficulty: 'veteran' });
    const sub = game.state.entities.find(
      (e) => e.kind === 'unit' && e.defId === 'submarine' && e.owner === 1,
    )!;
    const corvette = game.state.entities.find(
      (e) => e.kind === 'unit' && e.defId === 'corvette' && e.owner === 0,
    )!;

    game.advance(20 * 3);

    expect(sub.order?.type).toBe('attack');
    expect(sub.order?.targetId).toBe(corvette.id);
    expect(sub.submarine?.dived).toBe(true);
  });

  it('returns a boat with empty torpedo tubes to the shipyard', () => {
    const game = fleetGame([{ defId: 'submarine', owner: 0, x: 7, z: 50 }]);
    const sub = unit(game, 'submarine');
    sub.ammo = 0;
    game.advance(20 * 2);
    expect(sub.order?.type === 'return' || sub.state === 'returning').toBe(true);
  });

  it('preserves dive state, battery and launch datum across a save', () => {
    const game = fleetGame([{ defId: 'submarine', owner: 0, x: 9, z: 42 }]);
    const sub = unit(game, 'submarine');
    dive(game, sub.id);
    sub.submarine!.battery = 21.5;
    sub.submarine!.revealed = true;
    sub.submarine!.revealTimer = 4;

    const loaded = Game.fromSave(game.toSave(), { enableAI: false, localPlayerId: 0 });
    const copy = loaded.state.entities.find((e) => e.id === sub.id)!;
    expect(copy.submarine).toEqual({
      dived: true,
      battery: 21.5,
      maxBattery: 45,
      revealTimer: 4,
      revealed: true,
    });
  });
});
