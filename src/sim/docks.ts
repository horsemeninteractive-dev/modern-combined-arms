import { rotateLocalOffset } from '../core/math';
import { BUILDINGS, buildingFamily } from '../data/buildings';
import { TILE_SIZE } from './constants';

/**
 * Where aircraft sit when they are down.
 *
 * A facility's `docks` say *how many* airframes it can hold; this file says
 * *where* each one stands. The positions are authored in the facility's own
 * local units — +X forward, +Z right, exactly the axes the structure mesh is
 * built on — and rotated by the structure's facing, so the flight line follows
 * a turned airfield instead of staying glued to world east.
 *
 * Every position clears the buildings, the fuel farm, the flag dais and the
 * works around it, because a parked hull is drawn full size: a fighter is over
 * seven units across, which is most of an apron. Positions are also spread
 * across both ends of the apron rather than packed nose-to-tail, so four
 * airframes read as a flight line instead of one long striped block.
 *
 * The holding point is not a position. A hull that lands with every position of
 * its kind taken sets down on the open ground beside the field and waits there;
 * putting it in a slot would silently double-book a berth, and leaving it in the
 * middle of the apron would park it inside the hangar.
 */

export type DockKind = 'fixedWing' | 'helo';

/** Local x, local z, heading offset from the structure's facing. */
type Slot = readonly [number, number, number];

interface FacilityApron {
  fixedWing: readonly Slot[];
  helo: readonly Slot[];
  /** Open ground beside the field, for a hull with nowhere to park. */
  hold: Slot;
}

const HALF_TURN = Math.PI / 2;

const APRONS: Record<string, FacilityApron> = {
  airfield: {
    // A two-by-two flight line on the parking apron, all nose east. A strike
    // fighter is 6.7 units long and 5.6 across, so the columns are 6.6 apart
    // and the rows 6.0: any closer and wingtips share the same air, which is
    // what made the first pass read as aircraft dropped on top of each other.
    // The rows sit between the hangar frontage and the flag dais, which is why
    // the dais is the one painted marking the flight line deliberately misses.
    fixedWing: [
      [-3.3, -0.6, 0],
      [3.3, -0.6, 0],
      [-3.3, 5.4, 0],
      [3.3, 5.4, 0],
    ],
    // The emergency pad: the open west end of the apron, clear of the flight
    // line and of the hangar mouth. It is painted, so a hull that sets down
    // there reads as a recovery landing rather than a jet left in the wrong
    // place.
    helo: [[-8.9, 3.2, 0]],
    hold: [0, 12.6, HALF_TURN],
  },
  heliport: {
    fixedWing: [],
    // The two touchdown circles painted on the apron, dead centre of each.
    helo: [
      [-3.6, 1.6, HALF_TURN],
      [3.6, 1.6, HALF_TURN],
    ],
    hold: [0, 11.2, HALF_TURN],
  },
};

export interface DockPose {
  x: number;
  z: number;
  facing: number;
}

/** A facility's authored apron, read through its variant chain. */
function apronFor(defId: string): FacilityApron | undefined {
  return APRONS[buildingFamily(defId)] ?? APRONS[defId];
}

function poseAt(
  building: { x: number; z: number; facing: number },
  slot: Slot,
): DockPose {
  const offset = rotateLocalOffset(slot[0], slot[1], building.facing);
  return {
    x: building.x + offset.x,
    z: building.z + offset.z,
    facing: building.facing + slot[2],
  };
}

/**
 * World pose of one docking position, or null when this facility has no such
 * position — either it never had one of this kind, or the index is past the end
 * because more hulls are down than the apron was authored for.
 */
export function dockPose(
  building: { defId: string; x: number; z: number; facing: number },
  kind: DockKind,
  index: number,
): DockPose | null {
  const apron = apronFor(building.defId);
  const slot = apron?.[kind][index];
  return slot ? poseAt(building, slot) : null;
}

/** World pose of the holding point beside a facility. */
export function dockHoldPose(building: {
  defId: string;
  x: number;
  z: number;
  facing: number;
}): DockPose | null {
  const apron = apronFor(building.defId);
  return apron ? poseAt(building, apron.hold) : null;
}

/** How many positions of a kind a facility was authored with. */
export function authoredSlots(defId: string, kind: DockKind): number {
  return apronFor(defId)?.[kind].length ?? 0;
}

/**
 * A straight run along one facility's strip, in world space.
 *
 * The runway is painted on the airfield mesh down the local +X axis, between
 * the two threshold keys, so a take-off runs west to east and a landing comes
 * back the other way. Only fixed-wing hulls use it: a helicopter lifts off its
 * own pad and never touches the strip.
 */
export interface RunwayRun {
  from: DockPose;
  to: DockPose;
}

const RUNWAY = { west: -9.0, east: 9.4, z: 2.6 } as const;

/** Where a hull lines up, and where its wheels leave the strip. Nose east. */
export function runwayTakeoff(building: {
  defId: string;
  x: number;
  z: number;
  facing: number;
}): RunwayRun | null {
  if (authoredSlots(building.defId, 'fixedWing') === 0) return null;
  return {
    from: poseAt(building, [RUNWAY.west, RUNWAY.z, 0]),
    to: poseAt(building, [RUNWAY.east, RUNWAY.z, 0]),
  };
}

/**
 * Where an inbound hull touches down, and where it has rolled out. Nose west,
 * so the landing comes back along the strip rather than onto the apron.
 */
export function runwayLanding(building: {
  defId: string;
  x: number;
  z: number;
  facing: number;
}): RunwayRun | null {
  if (authoredSlots(building.defId, 'fixedWing') === 0) return null;
  return {
    from: poseAt(building, [RUNWAY.east, RUNWAY.z, Math.PI]),
    to: poseAt(building, [RUNWAY.west, RUNWAY.z, Math.PI]),
  };
}

/* -------------------------------------------------------------------------- */
/* Delivery bays                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Where haulers unload.
 *
 * A refinery's delivery mouth is a real piece of the model, so the trucks that
 * feed it stop at real mouths: two bays on the apron in front of the hopper, and
 * a staging spot clear of both for a hauler that arrives while they are busy.
 * Without authored bays a load could be deposited from anywhere inside a wide
 * radius, which made a second refinery pointless.
 */
interface DeliveryApron {
  bays: readonly Slot[];
  /** Open ground a hauler waits on while every bay is taken. */
  wait: Slot;
}

const DELIVERY_APRONS: Record<string, DeliveryApron> = {
  refinery: {
    // Nose-in at the delivery mouth: the hull stops with its front bumper at
    // the opening (the apron face sits at local z 3.4) and its body clear of
    // the hopper, which is why the bays sit well out from the footprint edge.
    bays: [
      [-0.6, 7.4, -HALF_TURN],
      [3.8, 7.4, -HALF_TURN],
    ],
    wait: [-5.6, 9.8, -HALF_TURN],
  },
};

function deliveryFor(defId: string): DeliveryApron | undefined {
  return DELIVERY_APRONS[buildingFamily(defId)] ?? DELIVERY_APRONS[defId];
}

/** World pose of one unloading bay, or null past the authored count. */
export function deliveryBay(
  building: { defId: string; x: number; z: number; facing: number },
  index: number,
): DockPose | null {
  const apron = deliveryFor(building.defId);
  const slot = apron?.bays[index];
  return slot ? poseAt(building, slot) : null;
}

/**
 * The spot a hauler stands on at a bay: the painted mouth, pushed clear of the
 * structure's collision footprint.
 *
 * The authored bay sits just inside the footprint edge so a stopped truck reads
 * as nose-in at the mouth, but the tile under a structure is blocked, so a route
 * can never end there. Pathing then snapped the goal to whatever walkable tile it
 * could reach, and on open ground that landed the truck at the kerb a few units
 * from the bay. Against a wall, a cliff or a neighbouring structure the snapped
 * tile was on the far side, the truck could not close the last metres, and the
 * load never came off — with the mouth still claimed by that truck.
 *
 * So the drive ends on the same bearing, clear of the wall: the truck pulls up
 * to the mouth from outside it, and unloading measures against this point rather
 * than through the building.
 */
export function deliveryStand(
  building: { defId: string; x: number; z: number; facing: number },
  index: number,
): DockPose | null {
  const apron = deliveryFor(building.defId);
  const slot = apron?.bays[index];
  if (!slot) return null;
  const def = BUILDINGS[buildingFamily(building.defId)] ?? BUILDINGS[building.defId];
  const halfX = def ? (def.footprint.w * TILE_SIZE) / 2 : 0;
  const halfZ = def ? (def.footprint.h * TILE_SIZE) / 2 : 0;
  const clearance = TILE_SIZE * 0.4;
  const localX = Math.max(-(halfX - clearance), Math.min(halfX - clearance, slot[0]));
  const localZ = Math.max(halfZ + clearance, Math.abs(slot[1])) * (slot[1] < 0 ? -1 : 1);
  return poseAt(building, [localX, localZ, slot[2]]);
}

/** Where a hauler waits when every bay is promised to another load. */
export function deliveryWait(building: {
  defId: string;
  x: number;
  z: number;
  facing: number;
}): DockPose | null {
  const apron = deliveryFor(building.defId);
  return apron ? poseAt(building, apron.wait) : null;
}

/** How many unloading bays a drop-off was authored with. */
export function authoredBays(defId: string): number {
  return deliveryFor(defId)?.bays.length ?? 0;
}
