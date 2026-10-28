import { describe, expect, it } from 'vitest';
import { unitBannerHeight, unitShadowRadius, unitStyle, unitVisualScale } from '../src/render/unitMeshes';
import { turretModelMatrix } from '../src/render/unitTransform';
import { UNITS } from '../src/data/units';

function bounds(part: { positions: ArrayLike<number> }): {
  x: number;
  y: number;
  z: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
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
  return {
    x: maxX - minX,
    y: maxY - minY,
    z: maxZ - minZ,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
  };
}

describe('national artillery visual identity', () => {
  it('authors both carriers at the shared world scale with their own geometry', () => {
    expect(unitVisualScale('mlrs')).toBe(1);
    expect(unitVisualScale('heavyHowitzer')).toBe(1);

    const mlrs = unitStyle('mlrs')!;
    const heavy = unitStyle('heavyHowitzer')!;
    const spg = unitStyle('spg')!;
    const tank = unitStyle('tank')!;

    // The three artillery vehicles have separate silhouettes; none silently
    // inherits the MBT or the shared SPG geometry.
    expect(mlrs.body).not.toBe(spg.body);
    expect(heavy.body).not.toBe(spg.body);
    expect(spg.body).not.toBe(tank.body);
    expect(mlrs.turret).not.toBe(spg.turret);
    expect(heavy.turret).not.toBe(spg.turret);
    expect(spg.turret).not.toBe(tank.turret);
    expect(mlrs.turret).not.toBe(tank.turret);
    expect(heavy.turret).not.toBe(tank.turret);
  });

  it('keeps the MLRS tube tips and howitzer barrel on their authored hardpoints', () => {
    const mlrs = bounds(unitStyle('mlrs')!.turret!);
    const heavy = bounds(unitStyle('heavyHowitzer')!.turret!);

    expect(mlrs.maxX * unitVisualScale('mlrs')).toBeCloseTo(UNITS.mlrs.muzzle!.forward, 2);
    expect(heavy.maxX * unitVisualScale('heavyHowitzer')).toBeCloseTo(
      UNITS.heavyHowitzer.muzzle!.forward,
      2,
    );
    // Both weapons are materially longer than the shared MBT's 2.2 hardpoint.
    expect(mlrs.maxX).toBeGreaterThan(UNITS.tank.muzzle!.forward);
    expect(heavy.maxX).toBeGreaterThan(UNITS.tank.muzzle!.forward);
  });

  it('keeps the artillery chassis narrow while leaving the weapon dominant', () => {
    for (const id of ['mlrs', 'heavyHowitzer']) {
      const body = bounds(unitStyle(id)!.body);
      const turret = bounds(unitStyle(id)!.turret!);
      // The legacy tank hull is 3.42 wide before its 0.7 multiplier; these
      // carriers must not inherit that near-square footprint.
      expect(body.z).toBeLessThan(2.1);
      expect(body.x).toBeGreaterThan(3.5);
      // The launcher/gun house is the primary mass on the vehicle.
      expect(turret.x).toBeGreaterThan(3.5);
      expect(turret.y).toBeGreaterThan(0.7);
    }
  });

  it('keeps both weapon systems readable above their chassis without floating bars', () => {
    // The cab is the tallest fixed point; the stowed launcher sits below its
    // roof. The health-bar anchor clears the cab without floating.
    expect(unitBannerHeight('mlrs')).toBeGreaterThan(2.0);
    expect(unitBannerHeight('mlrs')).toBeLessThan(2.4);
    expect(unitBannerHeight('heavyHowitzer')).toBeGreaterThan(2.0);
    expect(unitBannerHeight('heavyHowitzer')).toBeLessThan(3);
    for (const id of ['mlrs', 'heavyHowitzer']) {
      const [rx, rz] = unitShadowRadius(id);
      expect(rx).toBeGreaterThan(1.5);
      expect(rz).toBeGreaterThan(0.7);
      expect(rx).toBeLessThan(UNITS[id].radius * 1.2);
    }
  });

  it('stows the launcher level with the cab roof and deploys it on target', () => {
    const style = unitStyle('mlrs')!;
    const launcher = bounds(style.turret!);

    // The cab roof and the stowed pack are the same height in the reference.
    // The body also carries an antenna behind the windscreen, so measure the
    // cab roof envelope rather than the tallest spike on the vehicle.
    let cabTop = -Infinity;
    for (let i = 0; i < style.body.positions.length; i += 3) {
      if (style.body.positions[i] > 2.8) {
        cabTop = Math.max(cabTop, style.body.positions[i + 1]);
      }
    }
    let packTop = -Infinity;
    for (let i = 0; i < style.turret!.positions.length; i += 3) {
      // The thin antenna is the only part above the pack envelope.
      if (style.turret!.positions[i] > -0.5) {
        packTop = Math.max(packTop, style.turret!.positions[i + 1]);
      }
    }
    expect(Math.abs(cabTop - packTop)).toBeLessThan(0.06);
    expect(launcher.y).toBeLessThan(1.15);

    // The front of the cab must be carried by track, not cantilevered beyond it.
    let trackFront = -Infinity;
    for (let i = 0; i < style.body.positions.length; i += 3) {
      const z = style.body.positions[i + 2];
      if (Math.abs(z) > 0.75 && style.body.positions[i + 1] < 0.55) {
        trackFront = Math.max(trackFront, style.body.positions[i]);
      }
    }
    expect(trackFront).toBeGreaterThan(3.4);

    // Both halves of the vehicle carry a team-colour surface.
    expect(style.body.teamMask.some((v) => v >= 0.5)).toBe(true);
    expect(style.turret!.teamMask.some((v) => v >= 0.5)).toBe(true);
    expect(style.launcherElevation).toBeGreaterThan(0.35);
    expect(style.launcherPivot).toBeDefined();

    // Pitch is render-only and hinges at the rear cradle. Transforming the
    // front tip must raise it, while the zero-pitch matrix is unchanged.
    const flat = turretModelMatrix(0, 0, 0, 0, 0, [0, 0, 0], 1, 1, 0, style.launcherPivot);
    const up = turretModelMatrix(
      0,
      0,
      0,
      0,
      0,
      [0, 0, 0],
      1,
      1,
      style.launcherElevation!,
      style.launcherPivot,
    );
    const tipY = (m: Float32Array): number => m[1] * 2.3 + m[5] * 1.3 + m[13];
    expect(tipY(flat)).toBeCloseTo(1.3, 5);
    expect(tipY(up)).toBeGreaterThan(tipY(flat) + 0.5);
  });
});
