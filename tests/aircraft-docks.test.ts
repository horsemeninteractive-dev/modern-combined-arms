import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { BUILDINGS } from '../src/data/buildings';
import { dockHoldPose, dockPose } from '../src/sim/docks';
import { TILE_SIZE } from '../src/sim/constants';
import { completeResearch, islandWith } from './helpers';
import type { Scenario } from '../src/sim/scenario';

/**
 * Aircraft positions.
 *
 * An airfield offers four flight-line positions plus one recovery-only
 * helicopter pad; a heliport offers two helicopter positions and no flight
 * line. These suites pin the capacities, the production gates that read them,
 * and the national-variant regression that stalled a British fighter queue at
 * 100% because the gate compared the raw structure id to `airfield`.
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

function structure(game: Game, defId: string) {
  return game
    .entitiesOf(0, 'building')
    .find((e) => e.defId === defId);
}

/**
 * Advance until this hull is off the ground.
 *
 * Take-off is a manoeuvre now — taxi, strip run, climb — so "ordered out" and
 * "airborne" are the same order a few seconds apart.
 */
function waitForTakeoff(game: Game, id: number, seconds = 20): boolean {
  const hull = () => game.getEntity(id);
  for (let i = 0; i < seconds * 20; i++) {
    const e = hull();
    if (e && e.aircraft && !e.aircraft.landed) return true;
    game.advance(1);
  }
  const e = hull();
  return !!e?.aircraft && !e.aircraft.landed;
}

/** Advance until this owner fields a unit of the requested id. */
function waitForUnit(game: Game, defId: string, seconds = 90): boolean {
  for (let i = 0; i < seconds * 20; i++) {
    if (game.entitiesOf(0, 'unit').some((e) => e.defId === defId)) return true;
    game.advance(1);
  }
  return game.entitiesOf(0, 'unit').some((e) => e.defId === defId);
}

describe('aircraft positions', () => {
  it('declares four flight-line positions and one temporary pad on an airfield', () => {
    expect(BUILDINGS.airfield.docks).toEqual({ fixedWing: 4, helo: 1, heloTemporary: true });
    expect(BUILDINGS.heliport.docks).toEqual({ fixedWing: 0, helo: 2 });
    // A national strip is the same airfield, so it carries the same positions.
    expect(BUILDINGS.expeditionaryAirfield.docks).toEqual(BUILDINGS.airfield.docks);
  });

  it('launches a fighter out of a national airfield variant', () => {
    const game = fixture('uk', [{ defId: 'expeditionaryAirfield', owner: 0, x: 24, z: 24 }]);
    const field = structure(game, 'expeditionaryAirfield')!;
    const fighterId = game.unitIdFor(0, 'fighter')!;

    const status = game.productionStatus(0, field.id, fighterId);
    expect(status.ok, status.reason).toBe(true);
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: field.id, defId: fighterId });
    expect(waitForUnit(game, fighterId)).toBe(true);

    const fighter = game.entitiesOf(0, 'unit').find((e) => e.defId === fighterId)!;
    expect(fighter.homeId).toBe(field.id);
    // A new airframe is rolled onto its own stand, not launched into the air:
    // the flight line is where a hull waits, and it leaves only when ordered.
    expect(fighter.aircraft?.landed).toBe(true);
    expect(fighter.aircraft?.berth).toBe(0);
    expect(game.dockStatus(field.id)?.fixedWing).toMatchObject({
      used: 1,
      capacity: 4,
      parked: 1,
      airborne: 0,
      queued: 0,
    });

    // Sent out, it taxis to the threshold, runs the strip and climbs away. A
    // launched hull keeps the position it was given: the flight line is
    // assigned, not merely parked, so the count does not fall on take-off.
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [fighter.id],
      x: 40 * TILE_SIZE,
      z: 40 * TILE_SIZE,
    });
    expect(waitForTakeoff(game, fighter.id)).toBe(true);
    expect(fighter.aircraft?.landed).toBe(false);
    expect(game.dockStatus(field.id)?.fixedWing).toMatchObject({
      used: 1,
      parked: 0,
      airborne: 1,
      queued: 0,
    });
  });

  it('counts a parked flight line and refuses a fifth airframe', () => {
    const fighterId = 'fighter';
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }], [
      { defId: fighterId, owner: 0, x: 24, z: 24 },
      { defId: fighterId, owner: 0, x: 25, z: 24 },
      { defId: fighterId, owner: 0, x: 26, z: 24 },
      { defId: fighterId, owner: 0, x: 27, z: 24 },
    ]);
    const field = structure(game, 'airfield')!;
    expect(game.dockStatus(field.id)?.fixedWing).toMatchObject({
      used: 4,
      capacity: 4,
      parked: 4,
    });

    const status = game.productionStatus(0, field.id, fighterId);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('No free flight-line position (4/4)');
  });

  it('refuses to build a helicopter on an airfield recovery pad', () => {
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }]);
    const field = structure(game, 'airfield')!;
    const heloId = game.unitIdFor(0, 'attackHelo')!;
    const status = game.productionStatus(0, field.id, heloId);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('heliport');
    expect(game.dockStatus(field.id)?.helo).toMatchObject({
      used: 0,
      capacity: 1,
      temporary: true,
    });
  });
});

describe('docking geometry', () => {
  it('gives a national strip the same parking as the shared airfield', () => {
    const shared = { defId: 'airfield', x: 0, z: 0, facing: 0 };
    const national = { defId: 'expeditionaryAirfield', x: 0, z: 0, facing: 0 };
    for (let index = 0; index < 4; index++) {
      expect(dockPose(national, 'fixedWing', index)).toEqual(dockPose(shared, 'fixedWing', index));
    }
    // Past the last authored position there is no berth, rather than a berth
    // invented on top of the first one.
    expect(dockPose(shared, 'fixedWing', 4)).toBeNull();
    expect(dockPose(shared, 'helo', 1)).toBeNull();
  });

  it('turns the whole flight line with the structure', () => {
    const straight = { defId: 'airfield', x: 40, z: 60, facing: 0 };
    const turned = { ...straight, facing: Math.PI / 2 };
    const plain = dockPose(straight, 'fixedWing', 1)!;
    const quarter = dockPose(turned, 'fixedWing', 1)!;
    // Local +X becomes world +Z and local +Z becomes world -X at a quarter
    // turn, so a parked hull stays on its own apron when the field is rotated.
    expect(quarter.x - turned.x).toBeCloseTo(-(plain.z - straight.z), 6);
    expect(quarter.z - turned.z).toBeCloseTo(plain.x - straight.x, 6);
    expect(quarter.facing - turned.facing).toBeCloseTo(plain.facing - straight.facing, 6);
  });
});

describe('heliport', () => {
  it('builds a gunship and bases it on the port', () => {
    const game = fixture('lithuania', [{ defId: 'heliport', owner: 0, x: 24, z: 24 }]);
    const port = structure(game, 'heliport')!;
    const heloId = game.unitIdFor(0, 'attackHelo')!;

    const status = game.productionStatus(0, port.id, heloId);
    expect(status.ok, status.reason).toBe(true);
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: port.id, defId: heloId });
    expect(waitForUnit(game, heloId)).toBe(true);

    const helo = game.entitiesOf(0, 'unit').find((e) => e.defId === heloId)!;
    expect(helo.homeId).toBe(port.id);
    // Built on the port, it stands on a touchdown circle until it is sent out.
    expect(helo.aircraft?.landed).toBe(true);
    expect(helo.aircraft?.berth).toBe(0);
    expect(game.dockStatus(port.id)?.helo).toMatchObject({ used: 1, parked: 1, airborne: 0 });
  });

  it('holds two parked gunships and refuses a third', () => {
    const heloId = 'attackHelo';
    const game = fixture('lithuania', [{ defId: 'heliport', owner: 0, x: 24, z: 24 }], [
      { defId: heloId, owner: 0, x: 24, z: 24 },
      { defId: heloId, owner: 0, x: 25, z: 24 },
    ]);
    const port = structure(game, 'heliport')!;
    expect(game.dockStatus(port.id)?.helo).toMatchObject({
      used: 2,
      capacity: 2,
      parked: 2,
      temporary: false,
    });

    const status = game.productionStatus(0, port.id, heloId);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('No free helicopter position (2/2)');
  });

  it('cannot build fixed-wing aircraft', () => {
    const game = fixture('lithuania', [{ defId: 'heliport', owner: 0, x: 24, z: 24 }]);
    const port = structure(game, 'heliport')!;
    const fighterId = 'fighter';
    const status = game.productionStatus(0, port.id, fighterId);
    expect(status.ok).toBe(false);
    expect(status.reason).toBe('Heliport has no flight line for fixed-wing aircraft.');
  });
});

describe('aircraft homes', () => {
  it('homes each hull to a facility with a position of its kind', () => {
    const game = fixture(
      'lithuania',
      [
        { defId: 'airfield', owner: 0, x: 24, z: 24 },
        { defId: 'heliport', owner: 0, x: 34, z: 24 },
      ],
      [
        { defId: 'fighter', owner: 0, x: 24, z: 24 },
        { defId: 'attackHelo', owner: 0, x: 34, z: 24 },
      ],
    );
    const field = structure(game, 'airfield')!;
    const port = structure(game, 'heliport')!;
    const fighter = game.entitiesOf(0, 'unit').find((e) => e.defId === 'fighter')!;
    const helo = game.entitiesOf(0, 'unit').find((e) => e.defId === 'attackHelo')!;
    expect(fighter.homeId).toBe(field.id);
    expect(helo.homeId).toBe(port.id);
    // A parked hull stands on its own position, not in the middle of the
    // structure it came home to: the centre of an airfield is the hangar.
    expect(fighter.x).not.toBe(field.x);
    expect(fighter.z).not.toBe(field.z);
    expect(helo.x).not.toBe(port.x);
    expect(dockPose(port, 'helo', 0)!).toMatchObject({ x: helo.x, z: helo.z });
  });

  it('spreads four parked fighters across four different positions', () => {
    const fighterId = 'fighter';
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }], [
      { defId: fighterId, owner: 0, x: 24, z: 24 },
      { defId: fighterId, owner: 0, x: 25, z: 24 },
      { defId: fighterId, owner: 0, x: 26, z: 24 },
      { defId: fighterId, owner: 0, x: 27, z: 24 },
    ]);
    const field = structure(game, 'airfield')!;
    const parked = game.entitiesOf(0, 'unit').filter((e) => e.defId === fighterId);
    expect(parked).toHaveLength(4);
    const seen = new Set<string>();
    const slots = new Set<string>();
    for (const plane of parked) {
      seen.add(`${plane.x.toFixed(2)}:${plane.z.toFixed(2)}`);
      // The apron is 24 by 20 world units, and no position is further out than
      // its own far end: a hull parked on the map beside the field would pass a
      // "not the centre" check while being in the wrong place entirely.
      expect(Math.abs(plane.x - field.x)).toBeLessThan(12);
      expect(Math.abs(plane.z - field.z)).toBeLessThan(10);
    }
    expect(seen.size).toBe(4);
    // Those four positions are the authored ones, in order, and each hull took
    // the lowest free one rather than a random or shared spot.
    for (let index = 0; index < 4; index++) {
      const pose = dockPose(field, 'fixedWing', index)!;
      slots.add(`${pose.x.toFixed(2)}:${pose.z.toFixed(2)}`);
    }
    expect(slots).toEqual(seen);
  });

  it('parks two gunships on the heliport pads, one per circle', () => {
    const heloId = 'attackHelo';
    const game = fixture('lithuania', [{ defId: 'heliport', owner: 0, x: 24, z: 24 }], [
      { defId: heloId, owner: 0, x: 24, z: 24 },
      { defId: heloId, owner: 0, x: 25, z: 24 },
    ]);
    const port = structure(game, 'heliport')!;
    const helos = game.entitiesOf(0, 'unit').filter((e) => e.defId === heloId);
    const first = dockPose(port, 'helo', 0)!;
    const second = dockPose(port, 'helo', 1)!;
    expect(first).not.toEqual(second);
    for (const helo of helos) {
      const matches = [first, second].filter(
        (pose) => Math.abs(pose.x - helo.x) < 0.001 && Math.abs(pose.z - helo.z) < 0.001,
      );
      expect(matches, 'a gunship sits on a painted pad').toHaveLength(1);
      // Nose turned to the apron's open edge, not left on its spawn heading.
      expect(Math.abs(helo.facing - first.facing)).toBeLessThan(0.001);
    }
  });

  it('sets a hull down beside the field when every position is taken', () => {
    const heloId = 'attackHelo';
    const game = fixture('lithuania', [{ defId: 'heliport', owner: 0, x: 24, z: 24 }], [
      { defId: heloId, owner: 0, x: 24, z: 24 },
      { defId: heloId, owner: 0, x: 25, z: 24 },
      { defId: heloId, owner: 0, x: 26, z: 24 },
    ]);
    const port = structure(game, 'heliport')!;
    const hold = dockHoldPose(port)!;
    const helos = game.entitiesOf(0, 'unit').filter((e) => e.defId === heloId);
    const offPad = helos.filter(
      (helo) => Math.abs(helo.x - hold.x) < 0.001 && Math.abs(helo.z - hold.z) < 0.001,
    );
    expect(offPad, 'one hull waits on the holding point').toHaveLength(1);
    // The holding point is off the apron, so the spare hull never draws inside
    // a position another aircraft is using.
    expect(Math.abs(hold.z - port.z)).toBeGreaterThan(6);
  });
});
