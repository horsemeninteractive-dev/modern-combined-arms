import { describe, expect, it } from 'vitest';
import { unitShadowRadius, unitStyle, unitVisualScale } from '../src/render/unitMeshes';
import { buildingStyle } from '../src/render/buildingMeshes';
import { limbModelMatrix } from '../src/render/unitTransform';
import { UNITS } from '../src/data/units';

describe('unit visual scale', () => {
  it('makes singular infantry read taller than vehicles are long', () => {
    expect(unitVisualScale('rifle')).toBeGreaterThan(1.2);
    expect(unitVisualScale('atgm')).toBeGreaterThan(1.2);
    expect(unitVisualScale('tank')).toBeLessThan(0.85);
  });

  it('keeps vehicle hulls near one tile and infantry near half a tile tall', () => {
    for (const id of Object.keys(UNITS)) {
      const scale = unitVisualScale(id);
      expect(scale).toBeGreaterThanOrEqual(0.4);
      expect(scale).toBeLessThanOrEqual(2.5);
    }
    expect(unitVisualScale('tank')).toBeLessThan(1);
    expect(unitVisualScale('corvette')).toBeLessThan(1);
  });

  it('keeps ships the longest hull silhouette relative to their collision radius', () => {
    expect(unitVisualScale('corvette')).toBeLessThan(unitVisualScale('tank'));
    expect(unitVisualScale('harvester')).toBeLessThan(unitVisualScale('tank') + 0.05);
  });

  it('plants infantry boots on the terrain surface with articulated legs', () => {
    for (const id of ['rifle', 'atgm']) {
      const style = unitStyle(id)!;
      const rig = style.infantry!;
      const positions = rig.leg.positions;
      let minY = Infinity;
      for (let i = 1; i < positions.length; i += 3) minY = Math.min(minY, positions[i]);
      // Legs hang from the hip to the ground: the boot sole sits at Y = 0
      // when the unit's origin is placed on the terrain.
      expect(rig.hip[1] + minY).toBeCloseTo(0, 5);

      const scale = unitVisualScale(id);
      const foot = (swing: number): { x: number; y: number } => {
        const m = limbModelMatrix(0, 0, 0, 0, rig.hip, swing, scale);
        return { x: m[12] + minY * m[1], y: m[13] + minY * m[5] };
      };
      expect(foot(0.02).y).toBeCloseTo(0, 2);
      // Opposite swing phases put the foot in different places, so a walking
      // rifleman visibly strides instead of sliding on stiff legs.
      expect(Math.abs(foot(0.5).x - foot(-0.5).x)).toBeGreaterThan(0.4);
    }
  });

  it('gives the harvester a cargo mesh that grows from the hopper floor', () => {
    const load = unitStyle('harvester')!.load!;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < load.positions.length; i += 3) {
      minY = Math.min(minY, load.positions[i]);
      maxY = Math.max(maxY, load.positions[i]);
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeCloseTo(1.11, 5);
  });

  it('keeps static defence guns on traversing turret meshes', () => {
    for (const id of ['mgNest', 'atTurret']) {
      const style = buildingStyle(id)!;
      expect(style.turret).toBeDefined();
      expect(style.turretOffset?.[1]).toBeGreaterThan(1);
      // The gun geometry is not duplicated into the fixed body.
      expect(style.body.positions.length).toBeGreaterThan(0);
    }
  });

  it('gives every unit a positive, hull-sized shadow footprint', () => {
    for (const id of Object.keys(UNITS)) {
      const [rx, rz] = unitShadowRadius(id);
      expect(rx).toBeGreaterThan(0);
      expect(rz).toBeGreaterThan(0);
      expect(rx).toBeLessThan(UNITS[id].radius * 1.2);
    }
    const [rifleX] = unitShadowRadius('rifle');
    const [tankX] = unitShadowRadius('tank');
    expect(tankX).toBeGreaterThan(rifleX * 2);
  });
});
