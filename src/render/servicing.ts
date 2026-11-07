import { rotateLocalOffset } from '../core/math';
import type { PropInstance } from './gl';
import type { Entity } from '../sim/types';
import { PARKED_AIRCRAFT_CLEARANCE } from './unitMeshes';

/**
 * Ground servicing on a parked airframe.
 *
 * A hull that has landed and is having its ammunition, fuel and damage put back
 * is visibly being worked on: a bowser, a pump skid, a hose up to the rear
 * fuselage and two crew walking the ground between them, with the bowser's
 * beacon turning. The kit is a prop instance, not a simulation entity — it
 * carries no collision, no health and no orders, and it disappears the moment
 * the servicing run ends.
 *
 * The kit is authored in the hull's own frame (`buildServiceKit`), so the only
 * transform needed is that hull's parked heading. The beacon is a second
 * instance because its yaw is the spin: everything else in the set is parked,
 * and one part that turns is enough to read as "working" rather than "abandoned".
 *
 * The crew are a third: each figure walks its own route from the bowser to the
 * hull, works there, and walks back. A pair of figures frozen beside the truck
 * was the one thing on the apron that read as a photograph rather than a
 * turnaround, so the routes live here, in the same frame as the kit, and the
 * cycle is derived from route length rather than authored by hand.
 */

/** Beacon mount in the airframe's frame: the bowser cab roof, right of the tail. */
const BEACON_LOCAL = { x: -4.38, y: 1.1, z: 1.2 };

/** Radians per second of the beacon's rotation. Slow enough to follow by eye. */
const BEACON_RATE = 5.2;

export const SERVICE_KIT_BEACON_LOCAL = BEACON_LOCAL;

/** A walking pace across an apron, in hull-local units per second. */
export const SERVICE_CREW_WALK_SPEED = 0.85;

/** Height of a stride's rise, and of the working sway. Both in world units. */
const STRIDE_LIFT = 0.055;
const WORK_SWAY = 0.012;

/** Radians of yaw a walking figure rocks through, about a tenth of a radian. */
const STRIDE_SWAY = 0.1;

/** Where one crew member stands, in the airframe's frame (nose +X, right +Z). */
export interface ServiceCrewStop {
  x: number;
  z: number;
}

/**
 * One crew member's beat: a hose hand from the reel to the fuelling point, and
 * a technician from the pump to the rear fuselage.
 *
 * `work` and `rest` are dwell times in seconds at the hull and at the bowser;
 * `delay` is a head start in seconds, so the two never march in step.
 */
export interface ServiceCrewRoute {
  from: ServiceCrewStop;
  to: ServiceCrewStop;
  work: number;
  rest: number;
  delay: number;
}

/**
 * The two beats, kept clear of the wing and the stabilator: everything from
 * x = -4.98 forward to x = -3.12 stays behind the airframe's trailing edge.
 */
export const SERVICE_CREW_ROUTES: readonly ServiceCrewRoute[] = [
  // Hose hand: the reel on the bowser to the coupling at the fuselage.
  { from: { x: -4.98, z: 1.72 }, to: { x: -3.12, z: 0.86 }, work: 2.1, rest: 1.3, delay: 0 },
  // Technician: the pump skid to the flank behind the tail.
  { from: { x: -4.2, z: 2.26 }, to: { x: -3.32, z: 1.52 }, work: 2.6, rest: 1.1, delay: 1.4 },
];

/** What a crew member is doing at a given moment. */
export interface ServiceCrewPose {
  /** Fraction of the way from the bowser to the hull, 0 at the bowser. */
  t: number;
  /** Heading in the airframe's frame. */
  heading: number;
  /** Vertical offset from the apron: a stride's rise or a working sway. */
  lift: number;
  /**
   * Yaw wobble about the heading, radians. Zero while standing: a figure that
   * rocks where it is stationed looks unsteady, whereas a walking one that rocks
   * reads as taking strides.
   */
  sway: number;
  /** True while walking, false while working or waiting. */
  walking: boolean;
}

function ease(f: number): number {
  const clamped = f < 0 ? 0 : f > 1 ? 1 : f;
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Where a crew member is on its beat, and which way it faces.
 *
 * A route is walked out, worked, walked back and rested, so the position is a
 * fraction of the leg eased at both ends: a figure that starts and stops at a
 * constant rate reads as sliding, not walking. The walk time comes from the leg
 * length, which keeps a long and a short beat at the same pace instead of one
 * crew member sauntering while the other sprints.
 */
export function crewPose(route: ServiceCrewRoute, time: number): ServiceCrewPose {
  const dist = Math.hypot(route.to.x - route.from.x, route.to.z - route.from.z);
  const walk = Math.max(0.2, dist / SERVICE_CREW_WALK_SPEED);
  const cycle = walk * 2 + route.work + route.rest;
  let p = time % cycle;
  if (p < 0) p += cycle;

  const towardHull = Math.atan2(route.to.z - route.from.z, route.to.x - route.from.x);
  const towardBowser = towardHull + Math.PI;
  const stride = time * 7.4;

  if (p < walk) {
    return {
      t: ease(p / walk),
      heading: towardHull,
      lift: Math.abs(Math.sin(stride)) * STRIDE_LIFT,
      sway: Math.sin(stride) * STRIDE_SWAY,
      walking: true,
    };
  }
  if (p < walk + route.work) {
    // At the hull: a slow lean into the panel rather than a march in place.
    return {
      t: 1,
      heading: towardHull,
      lift: WORK_SWAY + Math.sin(stride * 0.7) * WORK_SWAY,
      sway: 0,
      walking: false,
    };
  }
  if (p < walk * 2 + route.work) {
    return {
      t: 1 - ease((p - walk - route.work) / walk),
      heading: towardBowser,
      lift: Math.abs(Math.sin(stride)) * STRIDE_LIFT,
      sway: Math.sin(stride) * STRIDE_SWAY,
      walking: true,
    };
  }
  // Back at the bowser, turning round for the next trip.
  return { t: 0, heading: towardHull, lift: 0, sway: 0, walking: false };
}

/**
 * Whether this entity is a parked hull being turned around.
 *
 * Deliberately narrow: a grounded hull that is merely parked, or one waiting for
 * a docking position (it cannot be serviced yet), shows nothing. The state is
 * the simulation's own, so the kit and the rearm timer can never disagree.
 */
export function isServicingAircraft(e: Entity): boolean {
  const ac = e.aircraft;
  if (e.kind !== 'unit' || e.hp <= 0 || e.garrisonId) return false;
  if (!ac || !ac.landed || ac.waitingForDock) return false;
  return e.state === 'rearming';
}

export interface ServicedHull {
  id: number;
  x: number;
  z: number;
  facing: number;
}

/**
 * Fill the instance arrays for the hulls currently being serviced.
 *
 * `groundAt` supplies the terrain height under a hull, so a field on a slope
 * still stands its bowser on the apron rather than in mid-air; the parked
 * clearance is the same one the airframe itself is drawn at. The crew ride the
 * same apron height, so a figure never floats over or sinks into the paving.
 */
export function serviceInstances(
  hulls: ReadonlyArray<ServicedHull>,
  groundAt: (x: number, z: number) => number,
  time: number,
  kit: PropInstance[],
  beacon: PropInstance[],
  crew: PropInstance[],
): void {
  kit.length = 0;
  beacon.length = 0;
  crew.length = 0;
  for (const hull of hulls) {
    const y = groundAt(hull.x, hull.z) + PARKED_AIRCRAFT_CLEARANCE;
    kit.push({
      x: hull.x,
      y,
      z: hull.z,
      rotation: hull.facing,
      scale: 1,
      color: [1, 1, 1],
    });
    const offset = rotateLocalOffset(BEACON_LOCAL.x, BEACON_LOCAL.z, hull.facing);
    beacon.push({
      x: hull.x + offset.x,
      y: y + BEACON_LOCAL.y,
      z: hull.z + offset.z,
      // The beacon spins, and a different phase per hull keeps a flight line
      // from blinking in lockstep.
      rotation: time * BEACON_RATE + hull.id * 0.7,
      scale: 1,
      color: [1, 1, 1],
    });
    for (const route of SERVICE_CREW_ROUTES) {
      // Each hull starts its crew at a different point in the cycle, so a row of
      // serviced aircraft has two figures moving on every apron.
      const pose = crewPose(route, time + hull.id * 1.7 + route.delay);
      const localX = route.from.x + (route.to.x - route.from.x) * pose.t;
      const localZ = route.from.z + (route.to.z - route.from.z) * pose.t;
      const spot = rotateLocalOffset(localX, localZ, hull.facing);
      crew.push({
        x: hull.x + spot.x,
        y: y + pose.lift,
        z: hull.z + spot.z,
        rotation: hull.facing + pose.heading + pose.sway,
        scale: 1,
        color: [1, 1, 1],
      });
    }
  }
}
