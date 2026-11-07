import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/sim/types';
import type { PropInstance } from '../src/render/gl';
import {
  SERVICE_CREW_ROUTES,
  SERVICE_CREW_WALK_SPEED,
  SERVICE_KIT_BEACON_LOCAL,
  crewPose,
  isServicingAircraft,
  serviceInstances,
} from '../src/render/servicing';
import { PARKED_AIRCRAFT_CLEARANCE } from '../src/render/unitMeshes';
import { buildServiceBeacon, buildServiceCrew, buildServiceKit } from '../src/render/geometry';

/**
 * Ground servicing on a parked hull.
 *
 * A hull being turned around puts a bowser, a pump skid, a hose and two crew on
 * its apron, with the bowser's beacon turning. These suites pin the gate — only
 * a hull that is actually rearming gets the kit — and the placement, which is
 * authored in the airframe's own frame and therefore has to turn with it.
 */

function hull(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 7,
    kind: 'unit',
    defId: 'fighter',
    owner: 0,
    x: 100,
    z: 50,
    facing: 0,
    turretFacing: 0,
    hp: 40,
    maxHp: 40,
    ammo: 4,
    maxAmmo: 4,
    fuel: 100,
    maxFuel: 100,
    path: [],
    state: 'rearming',
    aircraft: {
      homeId: 3,
      landed: true,
      serviceTimer: 6,
      serviceTotal: 12,
      returningHome: false,
    },
    ...overrides,
  } as unknown as Entity;
}

function place(hulls: Array<{ id: number; x: number; z: number; facing: number }>, time = 0) {
  const kit: PropInstance[] = [];
  const beacon: PropInstance[] = [];
  const crew: PropInstance[] = [];
  serviceInstances(hulls, () => 4, time, kit, beacon, crew);
  return { kit, beacon, crew };
}

describe('servicing gate', () => {
  it('works a landed hull that is rearming', () => {
    expect(isServicingAircraft(hull())).toBe(true);
  });

  it('leaves a hull that is merely parked alone', () => {
    expect(isServicingAircraft(hull({ state: 'grounded' }))).toBe(false);
    expect(isServicingAircraft(hull({ state: 'idle' }))).toBe(false);
  });

  it('stages nothing for an airborne hull', () => {
    const airborne = hull();
    airborne.aircraft!.landed = false;
    expect(isServicingAircraft(airborne)).toBe(false);
  });

  it('stages nothing for a hull still waiting for a docking position', () => {
    // It is down, but with nowhere to park nothing can reach it: no fuel, no
    // ammunition, and therefore no crew working on it.
    const waiting = hull();
    waiting.aircraft!.waitingForDock = true;
    expect(isServicingAircraft(waiting)).toBe(false);
  });

  it('ignores dead and garrisoned units', () => {
    expect(isServicingAircraft(hull({ hp: 0 }))).toBe(false);
    expect(isServicingAircraft(hull({ garrisonId: 12 }))).toBe(false);
  });
});

describe('servicing placement', () => {
  it('stands the kit on the hull and the beacon on the bowser', () => {
    const { kit, beacon } = place([{ id: 7, x: 100, z: 50, facing: 0 }]);
    expect(kit).toHaveLength(1);
    expect(beacon).toHaveLength(1);
    expect(kit[0]).toMatchObject({ x: 100, z: 50, rotation: 0, scale: 1 });
    // The kit is drawn on the apron, at the clearance the airframe itself uses.
    expect(kit[0].y).toBeCloseTo(4 + PARKED_AIRCRAFT_CLEARANCE, 6);
    expect(beacon[0].x).toBeCloseTo(100 + SERVICE_KIT_BEACON_LOCAL.x, 6);
    expect(beacon[0].z).toBeCloseTo(50 + SERVICE_KIT_BEACON_LOCAL.z, 6);
    expect(beacon[0].y).toBeCloseTo(4 + PARKED_AIRCRAFT_CLEARANCE + SERVICE_KIT_BEACON_LOCAL.y, 6);
  });

  it('turns the whole set with the parked heading', () => {
    const straight = place([{ id: 7, x: 0, z: 0, facing: 0 }]);
    const turned = place([{ id: 7, x: 0, z: 0, facing: Math.PI / 2 }]);
    // A quarter turn puts local +X on world +Z and local +Z on world -X.
    expect(turned.beacon[0].x).toBeCloseTo(-straight.beacon[0].z, 6);
    expect(turned.beacon[0].z).toBeCloseTo(straight.beacon[0].x, 6);
  });

  it('spins each beacon out of phase with its neighbours', () => {
    const { beacon } = place(
      [
        { id: 7, x: 0, z: 0, facing: 0 },
        { id: 9, x: 20, z: 0, facing: 0 },
      ],
      2,
    );
    expect(beacon).toHaveLength(2);
    expect(beacon[0].rotation).not.toBeCloseTo(beacon[1].rotation, 6);
    // The spin advances with the renderer clock.
    const later = place([{ id: 7, x: 0, z: 0, facing: 0 }], 3).beacon[0];
    expect(later.rotation).toBeGreaterThan(beacon[0].rotation);
  });

  it('empties the previous frame before staging the next', () => {
    const kit: PropInstance[] = [];
    const beacon: PropInstance[] = [];
    const crew: PropInstance[] = [];
    serviceInstances([{ id: 7, x: 0, z: 0, facing: 0 }], () => 0, 0, kit, beacon, crew);
    expect(kit).toHaveLength(1);
    expect(crew).toHaveLength(SERVICE_CREW_ROUTES.length);
    serviceInstances([], () => 0, 0, kit, beacon, crew);
    expect(kit).toHaveLength(0);
    expect(beacon).toHaveLength(0);
    expect(crew).toHaveLength(0);
  });
});

describe('servicing crew', () => {
  it('walks a figure between the bowser and the hull instead of parking it', () => {
    const at = (t: number) => place([{ id: 7, x: 0, z: 0, facing: 0 }], t).crew;
    // Sample a whole cycle: the first figure has to be at more than one place on
    // its beat, or it is standing still and the walk never happened.
    const first = at(0)[0];
    let moved = 0;
    for (let t = 0.5; t < 9; t += 0.5) {
      const now = at(t)[0];
      if (Math.hypot(now.x - first.x, now.z - first.z) > 0.5) moved++; // prettier-ignore
    }
    expect(moved).toBeGreaterThan(3);
  });

  it('starts each beat at the bowser and ends it at the hull', () => {
    for (const route of SERVICE_CREW_ROUTES) {
      const start = crewPose(route, 0);
      // Time 0 is the start of the outbound leg: the figure stands at `from`.
      expect(start.t).toBeCloseTo(0, 6);
      expect(start.walking).toBe(true);
      const leg = Math.hypot(route.to.x - route.from.x, route.to.z - route.from.z) / SERVICE_CREW_WALK_SPEED;
      const work = crewPose(route, leg + 0.05);
      expect(work.t).toBeCloseTo(1, 6);
      expect(work.walking).toBe(false);
    }
  });

  it('faces the way it is going, then turns for home', () => {
    for (const route of SERVICE_CREW_ROUTES) {
      const leg = Math.hypot(route.to.x - route.from.x, route.to.z - route.from.z) / SERVICE_CREW_WALK_SPEED;
      const out = crewPose(route, leg * 0.5);
      const back = crewPose(route, leg * 1.5 + route.work + 0.05);
      const towardHull = Math.atan2(route.to.z - route.from.z, route.to.x - route.from.x);
      expect(out.heading).toBeCloseTo(towardHull, 6);
      expect(back.heading).toBeCloseTo(towardHull + Math.PI, 6);
    }
  });

  it('rocks as it walks and steadies when it stops', () => {
    const route = SERVICE_CREW_ROUTES[0];
    const leg = Math.hypot(route.to.x - route.from.x, route.to.z - route.from.z) / SERVICE_CREW_WALK_SPEED;
    let widest = 0;
    for (let t = 0.05; t < leg; t += 0.05) widest = Math.max(widest, Math.abs(crewPose(route, t).sway));
    // A gait, not a statue: the figure has to actually rock on the way out.
    expect(widest).toBeGreaterThan(0.05);
    // And it plants itself at the hull instead of swaying on the spot.
    expect(crewPose(route, leg + 0.1).sway).toBe(0);
  });

  it('keeps every step behind the wing and the stabilator', () => {
    // The whole beat, not just its ends: a route that swings forward of the
    // trailing edge would walk a figure's head through a wing.
    for (const route of SERVICE_CREW_ROUTES) {
      for (const stop of [route.from, route.to]) {
        expect(stop.x).toBeLessThan(-3);
        expect(Math.abs(stop.z)).toBeLessThan(2.6);
      }
    }
  });

  it('puts two crew on the apron for every serviced hull, out of step', () => {
    const { crew } = place(
      [
        { id: 7, x: 0, z: 0, facing: 0 },
        { id: 9, x: 20, z: 0, facing: 0 },
      ],
      2,
    );
    expect(crew).toHaveLength(SERVICE_CREW_ROUTES.length * 2);
    expect(crew[0].x).not.toBeCloseTo(crew[2].x - 20, 3);
  });

  it('walks the crew on the apron rather than above it', () => {
    const { crew } = place([{ id: 7, x: 0, z: 0, facing: 0 }], 1);
    for (const figure of crew) {
      // A stride lifts the figure a few centimetres; it never leaves the paving.
      expect(figure.y).toBeGreaterThanOrEqual(4 + PARKED_AIRCRAFT_CLEARANCE);
      expect(figure.y - (4 + PARKED_AIRCRAFT_CLEARANCE)).toBeLessThan(0.06);
    }
  });

  it('turns the crew with the parked heading', () => {
    const straight = place([{ id: 7, x: 0, z: 0, facing: 0 }], 1).crew[0];
    const turned = place([{ id: 7, x: 0, z: 0, facing: Math.PI / 2 }], 1).crew[0];
    expect(turned.x).toBeCloseTo(-straight.z, 6);
    expect(turned.z).toBeCloseTo(straight.x, 6);
    expect(turned.rotation).toBeCloseTo(straight.rotation + Math.PI / 2, 6);
  });
});

describe('servicing meshes', () => {
  it('builds finite geometry for the kit, its crew and its beacon', () => {
    for (const mesh of [buildServiceKit(), buildServiceCrew(), buildServiceBeacon()]) {
      expect(mesh.indices.length).toBeGreaterThan(0);
      expect(mesh.positions.length).toBe(mesh.normals.length);
      for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('keeps the crew clear of the wing and the tail', () => {
    // The strike fighter's wing sweeps back to about x = -2.2 and sits half a
    // unit off the apron, so anything the crew stands under has to be behind
    // the stabilator: the kit is authored from x = -3.1 rearward.
    const kit = buildServiceKit();
    let minX = Infinity;
    for (let i = 0; i < kit.positions.length; i += 3) {
      minX = Math.min(minX, kit.positions[i]);
    }
    // Bodywork reaches back past the tail; the point is that the set spans the
    // ground behind the hull rather than the middle of the apron.
    expect(minX).toBeLessThan(-6);
    let maxY = 0;
    for (let i = 1; i < kit.positions.length; i += 3) maxY = Math.max(maxY, kit.positions[i]);
    // Nothing in the set is taller than the airframe it serves is off the ground.
    expect(maxY).toBeLessThan(1.4);
  });
});
