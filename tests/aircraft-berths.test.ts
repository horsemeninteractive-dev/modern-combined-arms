import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { TICK_RATE, TILE_SIZE } from '../src/sim/constants';
import { dockPose } from '../src/sim/docks';
import { BUILDING_MODULES } from '../src/data/research';
import { moduleActions } from '../src/ui/moduleView';
import { productionBlockReason } from '../src/ui/hudLayout';
import { completeResearch, islandWith } from './helpers';
import type { Scenario } from '../src/sim/scenario';
import type { Entity } from '../src/sim/types';

/**
 * Aircraft berth reservations.
 *
 * A docking position is *assigned*, not merely occupied: the hull owns it from
 * the moment its order is accepted, through take-off, patrol and return, until
 * it is destroyed or re-based. These suites pin that model — the capacity gate,
 * the queue's reservation, the emergency helicopter pad, facility destruction
 * and the save round-trip — because counting only parked hulls let a flight line
 * field more aircraft than it had positions.
 */

function fixture(
  nation: string,
  structures: Scenario['structures'],
  units: Scenario['units'] = [],
): Game {
  const scenario = islandWith({ structures, units });
  scenario.players[0].factionId = nation;
  const game = new Game(scenario, { enableAI: false });
  completeResearch(game, 0);
  const player = game.player(0)!;
  player.mats = 40000;
  player.req = 40000;
  return game;
}

function building(game: Game, defId: string, index = 0): Entity {
  return game.entitiesOf(0, 'building').filter((e) => e.defId === defId)[index];
}

function aircraft(game: Game, defId: string, index = 0): Entity {
  return game.entitiesOf(0, 'unit').filter((e) => e.defId === defId)[index];
}

function queue(game: Game, buildingId: number, defId: string): void {
  game.enqueueCommand({ type: 'produce', team: 0, buildingId, defId });
  game.tick();
}

/** Advance until the predicate holds, with a bounded number of seconds. */
function until(game: Game, value: number, predicate: () => boolean): boolean {
  for (let i = 0; i < Math.round(value * TICK_RATE); i++) {
    if (predicate()) return true;
    game.advance(1);
  }
  return predicate();
}

function fighters(count: number, at: { x: number; z: number }): Scenario['units'] {
  return Array.from({ length: count }, (_, i) => ({
    defId: 'fighter',
    owner: 0,
    x: at.x + i,
    z: at.z,
  }));
}

describe('permanent flight-line berths', () => {
  it('holds four airborne airframes and refuses a fifth', () => {
    const game = fixture(
      'lithuania',
      [{ defId: 'airfield', owner: 0, x: 24, z: 24 }],
      fighters(4, { x: 24, z: 24 }),
    );
    const field = building(game, 'airfield');

    // Send the whole flight line out. Take-off is not a release.
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: game.entitiesOf(0, 'unit').map((e) => e.id),
      x: 44 * TILE_SIZE,
      z: 40 * TILE_SIZE,
    });
    game.tick();
    const planes = game.entitiesOf(0, 'unit').filter((e) => e.defId === 'fighter');
    expect(planes).toHaveLength(4);
    // Take-off is a taxi and a strip run, so the flight line empties over the
    // next few seconds rather than on the order's first tick.
    expect(until(game, 20, () => planes.every((p) => !p.aircraft!.landed))).toBe(true);

    expect(game.dockStatus(field.id)?.fixedWing).toMatchObject({
      used: 4,
      capacity: 4,
      parked: 0,
      airborne: 4,
    });
    const status = game.productionStatus(0, field.id, 'fighter');
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('No free flight-line position (4/4)');
  });

  it('reports the full flight line before the bank, and refuses the order', () => {
    const game = fixture(
      'lithuania',
      [{ defId: 'airfield', owner: 0, x: 24, z: 24 }],
      fighters(4, { x: 24, z: 24 }),
    );
    const field = building(game, 'airfield');
    // A commander with a flight line full of its own aircraft and no materials:
    // capacity is the gate that money cannot clear, so that is what the card
    // must say. Reporting "NO MATERIALS" here would send them to mine ore for a
    // hull the field has nowhere to put.
    const player = game.player(0)!;
    player.mats = 0;
    player.req = 0;

    const status = game.productionStatus(0, field.id, 'fighter');
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('No free flight-line position (4/4)');
    expect(productionBlockReason(status.reason)).toEqual({
      text: 'NO FREE FLIGHT LINE',
      tone: 'space',
    });

    // The same answer from the command layer: nothing is queued and no berth is
    // promised, so freeing a position later still has four holders, not five.
    queue(game, field.id, 'fighter');
    expect(field.queue).toHaveLength(0);
    expect(game.entitiesOf(0, 'unit').filter((e) => e.defId === 'fighter')).toHaveLength(4);
  });

  it('reserves a berth the moment the order is accepted', () => {
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }]);
    const field = building(game, 'airfield');

    queue(game, field.id, 'fighter');
    expect(game.dockStatus(field.id)?.fixedWing).toMatchObject({ used: 1, queued: 1 });

    queue(game, field.id, 'fighter');
    queue(game, field.id, 'fighter');
    queue(game, field.id, 'fighter');
    expect(game.dockStatus(field.id)?.fixedWing).toMatchObject({ used: 4, queued: 4 });
    // Four positions promised to the queue means the fifth order is refused
    // before any hull has started down the line.
    expect(game.productionStatus(0, field.id, 'fighter').ok).toBe(false);

    // Cancelling an order hands its position straight back.
    game.enqueueCommand({ type: 'cancelProduction', team: 0, buildingId: field.id, index: 3 });
    game.tick();
    expect(game.productionStatus(0, field.id, 'fighter').ok).toBe(true);
  });

  it('moves a reservation from the queue onto the completed airframe', () => {
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }]);
    const field = building(game, 'airfield');

    queue(game, field.id, 'fighter');
    expect(game.dockStatus(field.id)?.fixedWing).toMatchObject({ used: 1, queued: 1 });

    const built = until(game, 90, () => game.entitiesOf(0, 'unit').some((e) => e.defId === 'fighter'));
    expect(built).toBe(true);
    const fighter = aircraft(game, 'fighter');
    expect(fighter.aircraft!.berth).toBe(0);
    // The airframe comes off the line parked on the stand it was promised.
    expect(fighter.aircraft!.landed).toBe(true);
    // One position, one holder: the queue's promise became the hull's.
    expect(game.dockStatus(field.id)?.fixedWing).toMatchObject({
      used: 1,
      queued: 0,
      parked: 1,
      airborne: 0,
    });
  });

  it('frees the position when the airframe is destroyed', () => {
    const game = fixture(
      'lithuania',
      [{ defId: 'airfield', owner: 0, x: 24, z: 24 }],
      fighters(4, { x: 24, z: 24 }),
    );
    const field = building(game, 'airfield');
    expect(game.productionStatus(0, field.id, 'fighter').ok).toBe(false);

    aircraft(game, 'fighter', 0).hp = 0;
    game.tick();
    expect(game.dockStatus(field.id)?.fixedWing).toMatchObject({ used: 3, parked: 3 });
    expect(game.productionStatus(0, field.id, 'fighter').ok).toBe(true);
  });

  it('gives each airfield its own four positions', () => {
    const game = fixture(
      'lithuania',
      [
        { defId: 'airfield', owner: 0, x: 24, z: 24 },
        { defId: 'airfield', owner: 0, x: 42, z: 26 },
      ],
      [...fighters(4, { x: 24, z: 24 }), ...fighters(4, { x: 42, z: 26 })],
    );
    const fields = game.entitiesOf(0, 'building').filter((e) => e.defId === 'airfield');
    expect(fields).toHaveLength(2);
    for (const field of fields) {
      expect(game.dockStatus(field.id)?.fixedWing.used).toBe(4);
      expect(game.productionStatus(0, field.id, 'fighter').ok).toBe(false);
    }
  });

  it('keeps a national strip on the same four-position rule', () => {
    const game = fixture(
      'uk',
      [{ defId: 'expeditionaryAirfield', owner: 0, x: 24, z: 24 }],
      fighters(4, { x: 24, z: 24 }),
    );
    const field = building(game, 'expeditionaryAirfield');
    const fighterId = game.unitIdFor(0, 'fighter')!;
    expect(game.dockStatus(field.id)?.fixedWing.capacity).toBe(4);
    expect(game.productionStatus(0, field.id, fighterId).reason).toContain('(4/4)');
  });

  it('counts a reconnaissance drone against the flight line', () => {
    const game = fixture(
      'lithuania',
      [{ defId: 'airfield', owner: 0, x: 24, z: 24 }],
      [
        ...fighters(3, { x: 24, z: 24 }),
        { defId: 'uav', owner: 0, x: 27, z: 24 },
      ],
    );
    const field = building(game, 'airfield');
    expect(game.dockStatus(field.id)?.fixedWing.used).toBe(4);
    expect(game.productionStatus(0, field.id, 'uav').reason).toContain('flight-line position (4/4)');
  });
});

describe('heliport berths', () => {
  it('holds two helicopters and refuses a third', () => {
    const game = fixture(
      'lithuania',
      [{ defId: 'heliport', owner: 0, x: 24, z: 24 }],
      [
        { defId: 'attackHelo', owner: 0, x: 24, z: 24 },
        { defId: 'attackHelo', owner: 0, x: 25, z: 24 },
      ],
    );
    const port = building(game, 'heliport');
    expect(game.productionStatus(0, port.id, 'attackHelo').ok).toBe(false);
    expect(game.productionStatus(0, port.id, 'attackHelo').reason).toContain('(2/2)');
  });

  it('gives two heliports independent capacity', () => {
    const game = fixture(
      'lithuania',
      [
        { defId: 'heliport', owner: 0, x: 24, z: 24 },
        { defId: 'heliport', owner: 0, x: 38, z: 24 },
      ],
      [
        { defId: 'attackHelo', owner: 0, x: 24, z: 24 },
        { defId: 'attackHelo', owner: 0, x: 25, z: 24 },
      ],
    );
    const ports = game.entitiesOf(0, 'building').filter((e) => e.defId === 'heliport');
    const occupied = ports.find((p) => game.dockStatus(p.id)?.helo.used === 2)!;
    const empty = ports.find((p) => p.id !== occupied.id)!;
    expect(empty).toBeDefined();
    expect(game.productionStatus(0, occupied.id, 'attackHelo').ok).toBe(false);
    expect(game.productionStatus(0, empty.id, 'attackHelo').ok).toBe(true);
  });
});

describe('destroyed facilities and emergency recovery', () => {
  it('re-bases airframes when their airfield is destroyed', () => {
    const game = fixture(
      'lithuania',
      [
        { defId: 'airfield', owner: 0, x: 24, z: 24 },
        { defId: 'airfield', owner: 0, x: 42, z: 26 },
      ],
      fighters(2, { x: 24, z: 24 }),
    );
    const [lost, survivor] = game.entitiesOf(0, 'building').filter((e) => e.defId === 'airfield');
    const planes = game.entitiesOf(0, 'unit').filter((e) => e.defId === 'fighter');
    expect(planes).toHaveLength(2);
    expect(planes.every((p) => p.aircraft?.homeId === lost.id)).toBe(true);

    lost.hp = 0;
    game.tick();

    for (const plane of planes) {
      expect(plane.hp).toBeGreaterThan(0);
      expect(plane.aircraft?.homeId).toBe(survivor.id);
      expect(plane.homeId).toBe(survivor.id);
      expect(plane.aircraft?.temporaryBerth).toBeFalsy();
    }
    // The two hulls take the survivor's first two positions, not one shared one.
    expect(planes.map((p) => p.aircraft!.berth).sort()).toEqual([0, 1]);
    expect(game.dockStatus(lost.id)).toBeNull();
    expect(game.dockStatus(survivor.id)?.fixedWing.used).toBe(2);
  });

  it('recovers a diverted helicopter on the airfield pad, then releases it', () => {
    const game = fixture(
      'lithuania',
      [
        { defId: 'heliport', owner: 0, x: 24, z: 24 },
        { defId: 'airfield', owner: 0, x: 34, z: 24 },
      ],
      [{ defId: 'attackHelo', owner: 0, x: 24, z: 24 }],
    );
    const port = building(game, 'heliport');
    const field = building(game, 'airfield');
    const helo = aircraft(game, 'attackHelo');
    expect(helo.aircraft?.homeId).toBe(port.id);

    // Put the gunship over open ground so the diversion is a real sortie.
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [helo.id],
      x: 28 * TILE_SIZE,
      z: 24 * TILE_SIZE,
    });
    game.tick();
    // The crew spins up and lifts before the sortie counts as flown.
    expect(until(game, 20, () => !helo.aircraft?.landed)).toBe(true);

    port.hp = 0;
    game.tick();
    // The pad is promised to the inbound hull: it is not a shared position.
    expect(helo.aircraft?.homeId).toBe(field.id);
    expect(helo.aircraft?.temporaryBerth).toBe(true);
    expect(helo.aircraft?.berth).toBe(0);
    expect(game.dockStatus(field.id)?.helo).toMatchObject({
      used: 1,
      capacity: 1,
      inbound: 1,
      temporary: true,
    });

    expect(until(game, 30, () => !!helo.aircraft?.landed)).toBe(true);
    expect(helo.aircraft?.berth).toBe(0);
    expect(game.dockStatus(field.id)?.helo).toMatchObject({ used: 1, parked: 1 });

    // After the servicing run the crew lifts off and clears the pad: it never
    // becomes a permanent helicopter berth.
    expect(until(game, 20, () => !helo.aircraft?.temporaryBerth)).toBe(true);
    expect(helo.aircraft?.landed).toBe(false);
    expect(helo.aircraft?.berth).toBeUndefined();
    expect(game.dockStatus(field.id)?.helo).toMatchObject({ used: 0, parked: 0 });
    expect(helo.hp).toBe(helo.maxHp);
  });

  it('will not let two helicopters share the one temporary pad', () => {
    const game = fixture(
      'lithuania',
      [
        { defId: 'heliport', owner: 0, x: 24, z: 24 },
        { defId: 'airfield', owner: 0, x: 34, z: 24 },
      ],
      [
        { defId: 'attackHelo', owner: 0, x: 24, z: 24 },
        { defId: 'attackHelo', owner: 0, x: 25, z: 24 },
      ],
    );
    const port = building(game, 'heliport');
    const field = building(game, 'airfield');
    const helos = game.entitiesOf(0, 'unit').filter((e) => e.defId === 'attackHelo');
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: helos.map((h) => h.id),
      x: 28 * TILE_SIZE,
      z: 24 * TILE_SIZE,
    });
    game.tick();

    port.hp = 0;
    // One pad, one claimant at every moment: whichever crew holds it, the other
    // must stay up or look elsewhere. A pad that read 2 would be two hulls on
    // one painted position.
    let peak = 0;
    for (let i = 0; i < 20 * TICK_RATE; i++) {
      game.tick();
      const dock = game.dockStatus(field.id)!.helo;
      peak = Math.max(peak, dock.used, dock.parked + dock.inbound);
    }
    expect(peak).toBe(1);
  });

  it('never lets an airfield build a helicopter on the recovery pad', () => {
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }]);
    const field = building(game, 'airfield');
    const status = game.productionStatus(0, field.id, 'attackHelo');
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('heliport');
  });
});

describe('berth persistence', () => {
  it('round-trips assignments through a save', () => {
    const game = fixture(
      'lithuania',
      [{ defId: 'airfield', owner: 0, x: 24, z: 24 }],
      fighters(3, { x: 24, z: 24 }),
    );
    const assign = (g: Game) =>
      g
        .entitiesOf(0, 'unit')
        .filter((e) => e.defId === 'fighter')
        .map((e) => ({ berth: e.aircraft!.berth, home: e.aircraft!.homeId }))
        .sort((a, b) => (a.berth ?? 0) - (b.berth ?? 0));
    const before = assign(game);

    const loaded = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(assign(loaded)).toEqual(before);
    const field = loaded.entitiesOf(0, 'building').find((e) => e.defId === 'airfield')!;
    expect(loaded.dockStatus(field.id)?.fixedWing).toMatchObject({ used: 3, parked: 3 });
  });

  it('rebuilds reservations for a save that predates them', () => {
    const game = fixture(
      'lithuania',
      [{ defId: 'airfield', owner: 0, x: 24, z: 24 }],
      fighters(2, { x: 24, z: 24 }),
    );
    const raw = JSON.parse(JSON.stringify(game.toSave()));
    // A save from a build that counted parked hulls carries no reservation.
    for (const entity of raw.state.entities) {
      if (entity.aircraft) delete entity.aircraft.berth;
      if (Array.isArray(entity.queue)) {
        for (const item of entity.queue) delete item.berth;
      }
    }

    const loaded = Game.fromSave(raw, { enableAI: false });
    loaded.tick();
    const planes = loaded
      .entitiesOf(0, 'unit')
      .filter((e) => e.defId === 'fighter')
      .sort((a, b) => (a.aircraft!.berth ?? 0) - (b.aircraft!.berth ?? 0));
    expect(planes.map((p) => p.aircraft!.berth)).toEqual([0, 1]);
    // Physical positions follow the reconstructed assignment.
    const field = loaded.entitiesOf(0, 'building').find((e) => e.defId === 'airfield')!;
    for (const [index, plane] of planes.entries()) {
      const pose = dockPose(field, 'fixedWing', index)!;
      expect(plane.x).toBeCloseTo(pose.x, 6);
      expect(plane.z).toBeCloseTo(pose.z, 6);
    }
  });

  it('keeps an over-capacity battle alive without double-booking', () => {
    const game = fixture(
      'lithuania',
      [{ defId: 'airfield', owner: 0, x: 24, z: 24 }],
      fighters(5, { x: 24, z: 24 }),
    );
    const field = building(game, 'airfield');
    const extra = aircraft(game, 'fighter', 4);

    expect(extra.hp).toBeGreaterThan(0);
    expect(extra.aircraft!.berth).toBeUndefined();
    expect(game.dockStatus(field.id)?.fixedWing).toMatchObject({ used: 4, capacity: 4 });
    // It waits on the holding point rather than sharing a painted position.
    for (let index = 0; index < 4; index++) {
      const pose = dockPose(field, 'fixedWing', index)!;
      expect(Math.hypot(extra.x - pose.x, extra.z - pose.z)).toBeGreaterThan(1);
    }
    // No servicing until a position frees: the overflow hull is not rearmed on
    // someone else's apron.
    expect(extra.aircraft!.waitingForDock).toBe(true);
  });
});

describe('flightline maintenance', () => {
  /** Land one fighter and return the servicing clock the facility set. */
  function landOne(withModule: boolean): { game: Game; fighter: Entity; field: Entity } {
    const game = fixture(
      'lithuania',
      [{ defId: 'airfield', owner: 0, x: 24, z: 24 }],
      fighters(1, { x: 24, z: 24 }),
    );
    const field = building(game, 'airfield');
    if (withModule) {
      game.enqueueCommand({
        type: 'installModule',
        team: 0,
        buildingId: field.id,
        moduleId: 'flightlineMaintenance',
      });
      game.tick();
    }
    const fighter = aircraft(game, 'fighter');
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [fighter.id],
      x: 40 * TILE_SIZE,
      z: 24 * TILE_SIZE,
    });
    game.tick();
    game.enqueueCommand({ type: 'return', team: 0, ids: [fighter.id] });
    game.tick();
    return { game, fighter, field };
  }

  it('shortens servicing and leaves production alone', () => {
    expect(BUILDING_MODULES.flightlineMaintenance.effects).toEqual([
      { kind: 'serviceSpeed', multiplier: 1.3 },
    ]);

    const plain = landOne(false);
    expect(plain.fighter.aircraft!.landed).toBe(true);
    // The recall starts the crew on the tick it is accepted, so the clock reads
    // one tick short of the full eight seconds.
    expect(plain.fighter.aircraft!.serviceTimer).toBeGreaterThan(7.9);
    expect(plain.fighter.aircraft!.serviceTimer).toBeLessThanOrEqual(8);

    const fitted = landOne(true);
    expect(fitted.field.modules).toContain('flightlineMaintenance');
    expect(fitted.fighter.aircraft!.landed).toBe(true);
    expect(fitted.fighter.aircraft!.serviceTotal / fitted.fighter.aircraft!.serviceTimer).toBeCloseTo(
      1.3,
      // The timer is read after one tick has already run, so the ratio carries
      // that fraction rather than landing on exactly 1.3.
      1,
    );
    // Production time is the airframe's, not the crew's.
    expect(fitted.game.productionStatus(0, fitted.field.id, 'fighter').ok).toBe(true);
  });

  it('reports the servicing effect instead of a power figure', () => {
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }]);
    const field = building(game, 'airfield');
    const action = moduleActions(game, 0, field.id).find(
      (m) => m.moduleId === 'flightlineMaintenance',
    )!;
    expect(action.detail).toContain('30% service');
    expect(action.detail).not.toContain('0 power');
  });
});
