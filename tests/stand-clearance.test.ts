import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { dockPose } from '../src/sim/docks';
import { islandWith } from './helpers';
import type { Scenario } from '../src/sim/scenario';
import type { Entity } from '../src/sim/types';
import type { PropInstance } from '../src/render/gl';
import { buildStandClearanceFrame, buildStandClearanceRing } from '../src/render/geometry';
import {
  STAND_MARK_HEIGHT,
  standMarkInstances,
  standPulse,
  type ClearedStand,
} from '../src/render/standClearance';

/**
 * Landing clearance.
 *
 * The bay a hull is coming down on has to be the one the simulation will hand
 * it, not a guess: an empty-bay guess would light the wrong stand as soon as the
 * flight line had a gap in it. These suites pin the answer to the same rules
 * that land the aircraft, and the marker to the paint it sits on.
 */

function fixture(
  nation: string,
  structures: Scenario['structures'],
  units: Scenario['units'] = [],
): Game {
  const scenario = islandWith({ structures, units });
  scenario.players[0].factionId = nation;
  const game = new Game(scenario, { enableAI: false });
  const player = game.player(0)!;
  player.mats = 40000;
  player.req = 40000;
  return game;
}

function building(game: Game, defId: string) {
  return game.entitiesOf(0, 'building').find((e) => e.defId === defId)!;
}

/** Put a hull back in the air, coming home, as a sortie would. */
function inbound(unit: Entity, homeId: number) {
  unit.aircraft!.landed = false;
  unit.aircraft!.returningHome = true;
  unit.aircraft!.homeId = homeId;
  unit.order = { type: 'return', x: 0, z: 0 };
  unit.state = 'returning';
  return unit;
}

function aircraft(game: Game, defId: string, index = 0) {
  return game.entitiesOf(0, 'unit').filter((e) => e.defId === defId)[index];
}

describe('landing clearance', () => {
  it('clears an inbound fighter onto the first flight-line bay', () => {
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }], [
      { defId: 'fighter', owner: 0, x: 24, z: 24 },
    ]);
    const field = building(game, 'airfield');
    const fighter = inbound(aircraft(game, 'fighter'), field.id);

    const bay = game.landingClearance(fighter)!;
    const pose = dockPose(field, 'fixedWing', 0)!;
    expect(bay).toMatchObject({ buildingId: field.id, kind: 'fixedWing', index: 0 });
    expect(bay.x).toBeCloseTo(pose.x, 6);
    expect(bay.z).toBeCloseTo(pose.z, 6);
    expect(bay.facing).toBeCloseTo(pose.facing, 6);
  });

  it('moves the marking to the next bay as the flight line fills', () => {
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }], [
      { defId: 'fighter', owner: 0, x: 24, z: 24 },
      { defId: 'fighter', owner: 0, x: 25, z: 24 },
    ]);
    const field = building(game, 'airfield');
    const first = aircraft(game, 'fighter', 0);
    const second = aircraft(game, 'fighter', 1);
    const bay = game.landingClearance(inbound(second, field.id))!;
    // The lower id stays parked, so the hull still in the air is given bay 1.
    expect(second.id).toBeGreaterThan(first.id);
    const pose = dockPose(field, 'fixedWing', 1)!;
    expect(bay.index).toBe(1);
    expect(bay.x).toBeCloseTo(pose.x, 6);
    expect(bay.z).toBeCloseTo(pose.z, 6);
  });

  it('gives two hulls on final two different bays', () => {
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }], [
      { defId: 'fighter', owner: 0, x: 24, z: 24 },
      { defId: 'fighter', owner: 0, x: 25, z: 24 },
    ]);
    const field = building(game, 'airfield');
    const lead = inbound(aircraft(game, 'fighter', 0), field.id);
    const trail = inbound(aircraft(game, 'fighter', 1), field.id);
    const first = game.landingClearance(lead)!;
    const second = game.landingClearance(trail)!;
    // Both flashing the same stand would tell the player nothing about the
    // second hull, and the queue does land in this order.
    expect(first.index).toBe(0);
    expect(second.index).toBe(1);
    expect(first.x === second.x && first.z === second.z).toBe(false);
  });

  it('marks no bay at all when every position is taken', () => {
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }], [
      { defId: 'fighter', owner: 0, x: 24, z: 24 },
      { defId: 'fighter', owner: 0, x: 25, z: 24 },
      { defId: 'fighter', owner: 0, x: 26, z: 24 },
      { defId: 'fighter', owner: 0, x: 27, z: 24 },
      { defId: 'fighter', owner: 0, x: 28, z: 24 },
    ]);
    const field = building(game, 'airfield');
    const last = inbound(aircraft(game, 'fighter', 4), field.id);
    // It still comes down — on the holding point, with nothing to service it.
    // Lighting a bay it cannot have would be a lie on the apron.
    expect(game.landingClearance(last)).toBeNull();
  });

  it('clears a helicopter onto a rotary pad, not a flight-line bay', () => {
    const game = fixture('lithuania', [{ defId: 'heliport', owner: 0, x: 24, z: 24 }], [
      { defId: 'attackHelo', owner: 0, x: 24, z: 24 },
    ]);
    const port = building(game, 'heliport');
    const helo = inbound(aircraft(game, 'attackHelo'), port.id);

    const bay = game.landingClearance(helo)!;
    const pose = dockPose(port, 'helo', 0)!;
    expect(bay.kind).toBe('helo');
    expect(bay.x).toBeCloseTo(pose.x, 6);
    expect(bay.z).toBeCloseTo(pose.z, 6);
  });

  it('clears nothing for a hull that is down, parked or just patrolling', () => {
    const game = fixture('lithuania', [{ defId: 'airfield', owner: 0, x: 24, z: 24 }], [
      { defId: 'fighter', owner: 0, x: 24, z: 24 },
    ]);
    const field = building(game, 'airfield');
    const fighter = aircraft(game, 'fighter');
    // Parked: the marking belongs to the approach, not to a hull already down.
    expect(game.landingClearance(fighter)).toBeNull();

    fighter.aircraft!.landed = false;
    // Airborne but fighting: a sortie is not an approach.
    fighter.order = { type: 'attack', x: field.x + 30, z: field.z };
    expect(game.landingClearance(fighter)).toBeNull();

    fighter.order = { type: 'return', x: field.x, z: field.z };
    fighter.hp = 0;
    expect(game.landingClearance(fighter)).toBeNull();
  });
});

describe('clearance markers', () => {
  function stage(stands: ClearedStand[], ground = 4) {
    const frames: PropInstance[] = [];
    const rings: PropInstance[] = [];
    standMarkInstances(stands, () => ground, frames, rings);
    return { frames, rings };
  }

  it('puts a frame on a stand and a ring on a rotary pad', () => {
    const { frames, rings } = stage([
      { kind: 'fixedWing', x: 100, z: 50, facing: 0 },
      { kind: 'helo', x: 30, z: 10, facing: Math.PI },
    ]);
    expect(frames).toHaveLength(1);
    expect(rings).toHaveLength(1);
    expect(frames[0]).toMatchObject({ x: 100, z: 50, rotation: 0, scale: 1 });
    expect(rings[0]).toMatchObject({ x: 30, z: 10, rotation: Math.PI });
    // Above the paint, not on it: the highest marking on either facility tops
    // out at 0.53 above the ground.
    expect(frames[0].y).toBeCloseTo(4 + STAND_MARK_HEIGHT, 6);
    expect(frames[0].y).toBeGreaterThan(4 + 0.53);
  });

  it('empties the previous frame before staging the next', () => {
    const frames: PropInstance[] = [];
    const rings: PropInstance[] = [];
    standMarkInstances([{ kind: 'fixedWing', x: 0, z: 0, facing: 0 }], () => 0, frames, rings);
    expect(frames).toHaveLength(1);
    standMarkInstances([], () => 0, frames, rings);
    expect(frames).toHaveLength(0);
    expect(rings).toHaveLength(0);
  });

  it('pulses between a readable floor and full brightness', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 400; i++) {
      const value = standPulse(i * 0.017);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(min).toBeGreaterThanOrEqual(0.2);
    expect(max).toBeLessThanOrEqual(1);
    // It has to actually flash: a marker that never dims is just more paint.
    expect(max - min).toBeGreaterThan(0.6);
  });
});

describe('clearance meshes', () => {
  it('builds finite geometry for the frame and the ring', () => {
    for (const mesh of [buildStandClearanceFrame(), buildStandClearanceRing()]) {
      expect(mesh.indices.length).toBeGreaterThan(0);
      expect(mesh.positions.length).toBe(mesh.normals.length);
      for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('draws the frame around the painted stand rather than on it', () => {
    const frame = buildStandClearanceFrame();
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < frame.positions.length; i += 3) {
      minX = Math.min(minX, frame.positions[i]);
      maxX = Math.max(maxX, frame.positions[i]);
      minZ = Math.min(minZ, frame.positions[i + 2]);
      maxZ = Math.max(maxZ, frame.positions[i + 2]);
    }
    // The white fuselage outline is 5.4 by 2.4; the signal it lights up wraps it.
    expect(maxX - minX).toBeGreaterThan(5.4);
    expect(maxZ - minZ).toBeGreaterThan(2.4);
    // And stays on the bay: a frame wider than an apron would flash over its
    // neighbours' markings.
    expect(maxX - minX).toBeLessThan(7);
    expect(maxZ - minZ).toBeLessThan(3.6);
  });
});
