import { describe, expect, it } from 'vitest';
import { unitBannerHeight, unitStyle, unitVisualScale } from '../src/render/unitMeshes';
import { UNITS } from '../src/data/units';

function bounds(part: { positions: ArrayLike<number> }): {
  maxX: number;
  minX: number;
  maxY: number;
  minY: number;
  maxZ: number;
  minZ: number;
} {
  const p = part.positions;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]);
    maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]);
    maxY = Math.max(maxY, p[i + 1]);
    minZ = Math.min(minZ, p[i + 2]);
    maxZ = Math.max(maxZ, p[i + 2]);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/** Average Y of the vertices on the part's forwardmost X plane. */
function tipHeight(part: { positions: ArrayLike<number> }): number {
  const b = bounds(part);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < part.positions.length; i += 3) {
    if (Math.abs(part.positions[i] - b.maxX) < 0.001) {
      sum += part.positions[i + 1];
      count++;
    }
  }
  return sum / count;
}

describe('completed unit roster visual pass', () => {
  it('authors every land, air and naval unit at a coherent non-inflated scale', () => {
    for (const id of Object.keys(UNITS)) {
      const scale = unitVisualScale(id);
      expect(scale, id).toBeGreaterThanOrEqual(0.4);
      expect(scale, id).toBeLessThanOrEqual(1);
    }
    // The ships keep a presentation multiplier: their hulls are authored
    // around a shipyard slip, not a 2 m soldier.
    for (const id of ['missileBoat', 'corvette', 'frigate']) {
      expect(unitVisualScale(id), id).toBe(0.7);
    }
    for (const id of [
      'engineer',
      'spearhead',
      'aa',
      'recovery',
      'harvester',
      'fighter',
      'interceptor',
      'uav',
      'deepReconUAV',
    ]) {
      expect(unitVisualScale(id), id).toBe(1);
    }
  });

  it('clears every reworked roof with a custom banner anchor', () => {
    for (const id of [
      'engineer',
      'spearhead',
      'aa',
      'recovery',
      'harvester',
      'fighter',
      'interceptor',
      'uav',
      'deepReconUAV',
      'corvette',
    ]) {
      const bodyTop = bounds(unitStyle(id)!.body).maxY * unitVisualScale(id);
      expect(unitBannerHeight(id), `${id} still uses the legacy 5-unit anchor`).not.toBe(5);
      expect(unitBannerHeight(id), `${id} anchor is inside the model`).toBeGreaterThan(bodyTop + 0.05);
    }
    expect(unitBannerHeight('recovery')).toBeGreaterThan(unitBannerHeight('tank'));
    expect(unitBannerHeight('harvester')).toBeGreaterThan(unitBannerHeight('recovery'));
    expect(unitBannerHeight('corvette')).toBeGreaterThan(unitBannerHeight('tank'));
  });

  it('places the AA missile pack on the authored forward and height hardpoint', () => {
    const aa = unitStyle('aa')!;
    const turret = aa.turret!;
    const b = bounds(turret);
    expect((aa.turretOffset[0] + b.maxX) * unitVisualScale('aa')).toBeCloseTo(
      UNITS.aa.muzzle!.forward,
      2,
    );
    expect((aa.turretOffset[1] + tipHeight(turret)) * unitVisualScale('aa')).toBeCloseTo(
      UNITS.aa.muzzle!.height,
      2,
    );
    expect(aa.body.teamMask.some((v) => v >= 0.5)).toBe(true);
    expect(turret.teamMask.some((v) => v >= 0.5)).toBe(true);
  });

  it('keeps the Spearhead gun on the MBT-class hardpoint and hull', () => {
    const spearhead = unitStyle('spearhead')!;
    const tank = unitStyle('tank')!;
    // The upgrade carries a longer, heavier hull and its own turret; the gun
    // still lands on the MBT-class muzzle hardpoint from that new mount.
    expect(spearhead.body).not.toBe(tank.body);
    expect(spearhead.turret).not.toBe(tank.turret);
    const turret = spearhead.turret!;
    const b = bounds(turret);
    expect((spearhead.turretOffset[0] + b.maxX) * unitVisualScale('spearhead')).toBeCloseTo(
      UNITS.spearhead.muzzle!.forward,
      1,
    );
    expect((spearhead.turretOffset[1] + tipHeight(turret)) * unitVisualScale('spearhead')).toBeCloseTo(
      UNITS.spearhead.muzzle!.height,
      1,
    );
    expect(turret.teamMask.some((v) => v >= 0.5)).toBe(true);
  });

  it('lands the corvette deck gun on its authored hardpoint', () => {
    const ship = unitStyle('corvette')!;
    const turret = ship.turret!;
    const b = bounds(turret);
    const scale = unitVisualScale('corvette');
    expect((ship.turretOffset[0] + b.maxX) * scale).toBeCloseTo(UNITS.corvette.muzzle!.forward, 1);
    expect((ship.turretOffset[1] + tipHeight(turret)) * scale).toBeCloseTo(
      UNITS.corvette.muzzle!.height,
      1,
    );
    expect(ship.body.teamMask.some((v) => v >= 0.5)).toBe(true);
    expect(turret.teamMask.some((v) => v >= 0.5)).toBe(true);
  });

  it('gives the support and air units role-specific geometry and ownership marks', () => {
    const engineer = unitStyle('engineer')!;
    const recovery = unitStyle('recovery')!;
    expect(engineer.turret).toBeUndefined();
    expect(recovery.turret).toBeUndefined();
    // The crane and blade extend well beyond the cab envelope.
    expect(bounds(engineer.body).maxX).toBeGreaterThan(2.1);
    expect(bounds(engineer.body).maxY).toBeGreaterThan(2.2);
    expect(bounds(recovery.body).maxY).toBeGreaterThan(2.5);

    const fighter = unitStyle('fighter')!;
    const interceptor = unitStyle('interceptor')!;
    const uav = unitStyle('uav')!;
    const deep = unitStyle('deepReconUAV')!;
    expect(fighter.body).not.toBe(interceptor.body);
    expect(uav.body).not.toBe(deep.body);
    // Swept strike wings are wider than the interceptor's delta and the
    // baseline drone's straight wing.
    const span = (id: string): number => {
      const b = bounds(unitStyle(id)!.body);
      return (b.maxZ - b.minZ) * unitVisualScale(id);
    };
    expect(span('fighter')).toBeGreaterThan(span('interceptor'));
    expect(span('deepReconUAV')).toBeGreaterThan(span('uav'));
    for (const id of ['engineer', 'recovery', 'fighter', 'interceptor', 'uav', 'deepReconUAV']) {
      expect(unitStyle(id)!.body.teamMask.some((v) => v >= 0.5), id).toBe(true);
    }
  });

  it('splits the gunship rotors out of the airframe so they can turn', () => {
    const helo = unitStyle('attackHelo')!;
    const rotor = helo.rotor;
    const tail = helo.tailRotor;
    expect(rotor, 'main rotor').toBeDefined();
    expect(tail, 'tail rotor').toBeDefined();
    expect(rotor!.rate).toBeGreaterThan(0);
    expect(tail!.rate).toBeGreaterThan(rotor!.rate);
    // The blades live in the rotor part only: leaving a second copy in the body
    // would draw a static disc under the moving one.
    const body = bounds(helo.body);
    const disc = bounds(rotor!.mesh);
    expect(disc.maxX - disc.minX).toBeGreaterThan(body.maxX - body.minX);
    expect(rotor!.offset[1]).toBeGreaterThan(body.maxY * 0.6);
    // The tail rotor sits behind the cabin, on the fin.
    expect(tail!.offset[0]).toBeLessThan(body.minX * 0.5);
    expect(tail!.offset[0]).toBeGreaterThan(body.minX);
  });

  it('gives the new naval hulls distinct silhouettes and aligned deck guns', () => {
    const boat = unitStyle('missileBoat')!;
    const corvette = unitStyle('corvette')!;
    const frigate = unitStyle('frigate')!;
    const submarine = unitStyle('submarine')!;
    expect(boat.body).not.toBe(corvette.body);
    expect(frigate.body).not.toBe(corvette.body);
    expect(submarine.body).not.toBe(corvette.body);
    expect(submarine.periscope).toBeDefined();
    expect(submarine.turret).toBeUndefined();
    // The escort mounts its own heavier enclosed gunhouse, not the corvette's
    // light 76 mm turret.
    expect(frigate.turret).not.toBe(corvette.turret);

    const length = (id: string): number => {
      const b = bounds(unitStyle(id)!.body);
      return (b.maxX - b.minX) * unitVisualScale(id);
    };
    expect(length('missileBoat')).toBeLessThan(length('corvette'));
    expect(length('frigate')).toBeGreaterThan(length('corvette'));
    expect(length('submarine')).toBeGreaterThan(0);

    for (const id of ['missileBoat', 'frigate']) {
      const style = unitStyle(id)!;
      const turret = style.turret!;
      const b = bounds(turret);
      const scale = unitVisualScale(id);
      expect((style.turretOffset[0] + b.maxX) * scale).toBeCloseTo(
        UNITS[id].muzzle!.forward,
        1,
      );
      expect((style.turretOffset[1] + tipHeight(turret)) * scale).toBeCloseTo(
        UNITS[id].muzzle!.height,
        1,
      );
      expect(style.body.teamMask.some((v) => v >= 0.5), id).toBe(true);
      expect(turret.teamMask.some((v) => v >= 0.5), id).toBe(true);
      expect(unitBannerHeight(id), id).toBeGreaterThan(bounds(style.body).maxY * scale + 0.05);
    }
  });

  it('authors the national naval hulls instead of borrowing their family rig', () => {
    const visby = unitStyle('visby')!;
    const ghadir = unitStyle('ghadir')!;
    const corvette = unitStyle('corvette')!;
    const submarine = unitStyle('submarine')!;
    // The two hulls are bespoke: no shared body and no shared gun or feather.
    expect(visby.body).not.toBe(corvette.body);
    expect(visby.turret).toBeDefined();
    expect(visby.turret).not.toBe(corvette.turret);
    expect(ghadir.body).not.toBe(submarine.body);
    expect(ghadir.periscope).toBeDefined();
    expect(ghadir.periscope).not.toBe(submarine.periscope);
    expect(ghadir.turret).toBeUndefined();

    const length = (id: string): number => {
      const b = bounds(unitStyle(id)!.body);
      return (b.maxX - b.minX) * unitVisualScale(id);
    };
    // A littoral corvette is shorter than the fleet corvette; a midget boat is
    // a third the length of the ocean-going submarine rather than a rescale.
    expect(length('visby')).toBeLessThan(length('corvette'));
    expect(length('ghadir')).toBeLessThan(length('submarine') * 0.75);

    // Tumblehome: the Visby's deck is narrower than its waterline, which is
    // what separates the silhouette from every flared hull in the roster.
    const zAtHeight = (part: { positions: ArrayLike<number> }, minY: number): number => {
      let widest = 0;
      for (let i = 0; i < part.positions.length; i += 3) {
        if (part.positions[i + 1] < minY) continue;
        widest = Math.max(widest, Math.abs(part.positions[i + 2]));
      }
      return widest;
    };
    expect(zAtHeight(visby.body, 0.55)).toBeLessThan(zAtHeight(visby.body, 0.1));

    // The stealth mount still lands on the authored hardpoint.
    const turret = visby.turret!;
    const turretBounds = bounds(turret);
    const scale = unitVisualScale('visby');
    expect((visby.turretOffset[0] + turretBounds.maxX) * scale).toBeCloseTo(
      UNITS.visby.muzzle!.forward,
      1,
    );
    expect((visby.turretOffset[1] + tipHeight(turret)) * scale).toBeCloseTo(
      UNITS.visby.muzzle!.height,
      1,
    );

    for (const id of ['visby', 'ghadir']) {
      const style = unitStyle(id)!;
      expect(style.body.teamMask.some((v) => v >= 0.5), id).toBe(true);
      expect(unitBannerHeight(id), id).toBeGreaterThan(
        bounds(style.body).maxY * unitVisualScale(id) + 0.05,
      );
    }
  });

  it('keeps the harvester cargo inside its new hopper', () => {
    const body = bounds(unitStyle('harvester')!.body);
    const load = bounds(unitStyle('harvester')!.load!);
    const scale = unitVisualScale('harvester');
    expect(load.minX * scale).toBeGreaterThan(body.minX * scale);
    expect(load.maxX * scale).toBeLessThan(body.maxX * scale);
    expect(load.minZ * scale).toBeGreaterThan(body.minZ * scale);
    expect(load.maxZ * scale).toBeLessThan(body.maxZ * scale);
  });
});
