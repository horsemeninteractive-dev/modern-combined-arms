import { rotateLocalOffset } from '../core/math';
import type { PropInstance } from './gl';
import type { Entity } from '../sim/types';

/**
 * The amber lamp a combat engineer shows while it is working.
 *
 * An engineer parked beside a half-built structure and one that is actually
 * driving the works looked identical: the simulation's `building` and
 * `repairing` states were the only thing that knew the difference, and nothing
 * in the renderer read them. The lamp is the same fitting the flight line uses
 * (`buildServiceBeacon`), mounted on the engineering vehicle's cab, so one mesh
 * and one instanced draw serve both kinds of work.
 *
 * Like the servicing kit this is presentation only: a prop instance with no
 * collision, no health and no orders, rebuilt every frame from the states the
 * simulation publishes and gone the moment the crew stops.
 */

/** Radians per second of the beacon's rotation. Slow enough to follow by eye. */
const BEACON_RATE = 4.6;

/** Beacon mount in the hull's frame (nose +X, right +Z): the cab roof. */
const BEACON_LOCAL = { x: -0.4, y: 1.5, z: 0 };

/** Height of the working rock, in world units, and its yaw in radians. */
const WORK_LIFT = 0.035;
const WORK_SWAY = 0.014;

/** The pose a hull holds while it is not working: perfectly still. */
const AT_REST = { lift: 0, sway: 0 };

/**
 * Whether this entity is a crew with its machine under load.
 *
 * Narrow on purpose: a garrisoned unit is not on the map, and a dead one is not
 * working. Both states are the simulation's own, so the lamp and the progress
 * bar on the structure can never disagree about whether work is happening.
 */
export function isWorkingEngineer(e: Entity): boolean {
  if (e.kind !== 'unit' || e.hp <= 0 || e.garrisonId) return false;
  return e.state === 'building' || e.state === 'repairing';
}

/** Vertical rock and yaw wobble of a working hull, for the body transform. */
export interface WorkMotion {
  lift: number;
  sway: number;
}

/**
 * How the machine moves while it works.
 *
 * A working vehicle is being driven, not parked: it settles on its suspension
 * and shuffles a degree or two as the blade bites. The rise is taken as the
 * absolute of a sine so the hull is never drawn below the ground it stands on,
 * and the yaw runs at half the rate so the two motions do not beat together
 * into a single pulsing scale change.
 */
export function engineerWorkPose(e: Entity, time: number): WorkMotion {
  if (!isWorkingEngineer(e)) return AT_REST;
  const phase = time * 5.2 + e.id * 1.3;
  return {
    lift: Math.abs(Math.sin(phase)) * WORK_LIFT,
    sway: Math.sin(phase * 0.5) * WORK_SWAY,
  };
}

/**
 * Fill `out` with one beacon per visible working engineer.
 *
 * The caller owns fog: `visible` is the same test the rest of the pass uses, so
 * a site being worked beyond the team's own eyes lights nothing. A different
 * phase per hull keeps a row of crews from blinking in lockstep, and the
 * instance yaw is the spin — a stuck lamp would say "parked".
 */
export function workLightInstances(
  entities: Iterable<Entity>,
  visible: (e: Entity) => boolean,
  groundAt: (x: number, z: number) => number,
  time: number,
  out: PropInstance[],
): void {
  for (const e of entities) {
    if (!isWorkingEngineer(e)) continue;
    if (!visible(e)) continue;
    const offset = rotateLocalOffset(BEACON_LOCAL.x, BEACON_LOCAL.z, e.facing);
    out.push({
      x: e.x + offset.x,
      y: groundAt(e.x, e.z) + BEACON_LOCAL.y,
      z: e.z + offset.z,
      rotation: time * BEACON_RATE + e.id * 0.9,
      scale: 1,
      color: [1, 1, 1],
    });
  }
}
