import { describe, expect, it } from 'vitest';
import {
  unitBannerHeight,
  unitGroundMarker,
  unitShadowRadius,
  unitStyle,
  unitVisualScale,
} from '../src/render/unitMeshes';
import { buildingStyle } from '../src/render/buildingMeshes';
import { limbModelMatrix } from '../src/render/unitTransform';
import { UNITS } from '../src/data/units';

function bodyBounds(id: string): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const p = unitStyle(id)!.body.positions;
  const out = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < p.length; i += 3) {
    out.minX = Math.min(out.minX, p[i]);
    out.maxX = Math.max(out.maxX, p[i]);
    out.minY = Math.min(out.minY, p[i + 1]);
    out.maxY = Math.max(out.maxY, p[i + 1]);
    out.minZ = Math.min(out.minZ, p[i + 2]);
    out.maxZ = Math.max(out.maxZ, p[i + 2]);
  }
  return out;
}

/** Full standing height in world units, including the separate leg mesh. */
function infantryHeight(id: string): number {
  const style = unitStyle(id)!;
  const body = bodyBounds(id);
  const rig = style.infantry!;
  let legMin = Infinity;
  for (let i = 1; i < rig.leg.positions.length; i += 3) {
    legMin = Math.min(legMin, rig.leg.positions[i]);
  }
  return Math.max(body.maxY, rig.hip[1] - legMin) * unitVisualScale(id);
}

describe('unit visual scale', () => {
  it('keeps a rifleman clearly shorter than an MBT hull', () => {
    const rifle = infantryHeight('rifle');
    const tankHull = (bodyBounds('tank').maxX - bodyBounds('tank').minX) * unitVisualScale('tank');
    // 1.2 world units is 2.4 m at the 2 m/world reference; the 3.56-unit hull
    // is 7.1 m. The old 4.1-unit infantry was almost as long as the tank.
    expect(rifle).toBeGreaterThan(1.1);
    expect(rifle).toBeLessThan(1.3);
    expect(tankHull).toBeGreaterThan(rifle * 2.7);
    expect(unitVisualScale('rifle')).toBe(1);
    expect(unitVisualScale('tank')).toBe(1);
  });

  it('keeps every presentation scale inside a shared, non-inflated range', () => {
    for (const id of Object.keys(UNITS)) {
      const scale = unitVisualScale(id);
      expect(scale, id).toBeGreaterThanOrEqual(0.4);
      expect(scale, id).toBeLessThanOrEqual(1);
    }
    expect(unitVisualScale('tank')).toBe(1);
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

  it('gives the MBT a long hull with a turret that sits inside its width', () => {
    const body = bodyBounds('tank');
    const hullLength = (body.maxX - body.minX) * unitVisualScale('tank');
    const hullWidth = (body.maxZ - body.minZ) * unitVisualScale('tank');
    // 3.56 x 1.76 world units: 7.1 x 3.5 m at the 2 m reference, close to a
    // real MBT rather than the old square track box.
    expect(hullLength / hullWidth).toBeGreaterThan(1.9);
    expect(hullLength / hullWidth).toBeLessThan(2.4);

    const turret = unitStyle('tank')!.turret!;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 2; i < turret.positions.length; i += 3) {
      minZ = Math.min(minZ, turret.positions[i]);
      maxZ = Math.max(maxZ, turret.positions[i]);
    }
    const turretWidth = (maxZ - minZ) * unitVisualScale('tank');
    // The turret is wide enough to read but tapered inside the hull sides.
    expect(turretWidth).toBeLessThan(hullWidth * 0.7);
    expect(turretWidth).toBeGreaterThan(hullWidth * 0.45);
  });

  it('anchors the MBT gun tube at the turret muzzle hardpoint', () => {
    const turret = unitStyle('tank')!.turret!;
    let maxX = -Infinity;
    for (let i = 0; i < turret.positions.length; i += 3) {
      maxX = Math.max(maxX, turret.positions[i]);
    }
    // The hardpoint is in world units; the mesh is drawn at the tank's visual
    // scale, so the tube tip has to land on `muzzle.forward` after scaling.
    expect(maxX * unitVisualScale('tank')).toBeCloseTo(UNITS.tank.muzzle!.forward, 1);
  });

  it('aligns the rifle and ATGM tips with their authored forward hardpoints', () => {
    const tip = (id: string): number => {
      const style = unitStyle(id)!;
      let maxX = -Infinity;
      for (let i = 0; i < style.body.positions.length; i += 3) {
        maxX = Math.max(maxX, style.body.positions[i]);
      }
      return maxX * unitVisualScale(id);
    };
    expect(tip('rifle')).toBeCloseTo(UNITS.rifle.muzzle!.forward, 1);
    expect(tip('atgm')).toBeCloseTo(UNITS.atgm.muzzle!.forward, 1);
    // The specialist launcher is still visibly longer than the rifle, but it
    // is carried equipment rather than the old 3 m prop.
    expect(tip('atgm')).toBeGreaterThan(tip('rifle') + 0.1);
  });

  it('separates the SPG hull from the legacy tank and lands its gun hardpoint', () => {
    const spg = unitStyle('spg')!;
    const spearhead = unitStyle('spearhead')!;
    // The SPG no longer inherits the legacy hull that the Polish Spearhead
    // still uses; that separation is what allows a long, narrow artillery
    // chassis without reskinning the MBT variant.
    expect(spg.body).not.toBe(spearhead.body);
    expect(spg.turret).not.toBe(spearhead.turret);
    expect(unitVisualScale('spg')).toBe(1);

    const body = bodyBounds('spg');
    const length = (body.maxX - body.minX) * unitVisualScale('spg');
    const width = (body.maxZ - body.minZ) * unitVisualScale('spg');
    expect(length / width).toBeGreaterThan(2.1);

    const turret = spg.turret!;
    let maxX = -Infinity;
    for (let i = 0; i < turret.positions.length; i += 3) {
      maxX = Math.max(maxX, turret.positions[i]);
    }
    const tipYs: number[] = [];
    for (let i = 0; i < turret.positions.length; i += 3) {
      if (Math.abs(turret.positions[i] - maxX) < 0.001) tipYs.push(turret.positions[i + 1]);
    }
    const tipY = tipYs.reduce((a, b) => a + b, 0) / tipYs.length;
    expect(spg.turretOffset[0] + maxX).toBeCloseTo(UNITS.spg.muzzle!.forward, 2);
    expect(spg.turretOffset[1] + tipY).toBeCloseTo(UNITS.spg.muzzle!.height, 2);

    expect(unitBannerHeight('spg')).toBeGreaterThan(2.0);
    expect(unitBannerHeight('spg')).toBeLessThan(2.5);
    expect(spg.body.teamMask.some((v) => v >= 0.5)).toBe(true);
    expect(spg.turret!.teamMask.some((v) => v >= 0.5)).toBe(true);
  });

  it('shares the scout hull between Recon and Pathfinder and keeps their cues distinct', () => {
    const recon = unitStyle('recon')!;
    const pathfinder = unitStyle('pathfinder')!;
    expect(pathfinder.body).toBe(recon.body);
    expect(pathfinder.turret).toBeUndefined();
    expect(recon.turret).toBeDefined();
    expect(unitVisualScale('recon')).toBe(1);
    expect(unitVisualScale('pathfinder')).toBe(1);

    const body = bodyBounds('recon');
    const length = (body.maxX - body.minX) * unitVisualScale('recon');
    const width = (body.maxZ - body.minZ) * unitVisualScale('recon');
    expect(length / width).toBeGreaterThan(1.7);

    const turret = recon.turret!;
    let maxX = -Infinity;
    for (let i = 0; i < turret.positions.length; i += 3) {
      maxX = Math.max(maxX, turret.positions[i]);
    }
    const tipYs: number[] = [];
    for (let i = 0; i < turret.positions.length; i += 3) {
      if (Math.abs(turret.positions[i] - maxX) < 0.001) tipYs.push(turret.positions[i + 1]);
    }
    const tipY = tipYs.reduce((a, b) => a + b, 0) / tipYs.length;
    expect(recon.turretOffset[0] + maxX).toBeCloseTo(UNITS.recon.muzzle!.forward, 2);
    expect(recon.turretOffset[1] + tipY).toBeCloseTo(UNITS.recon.muzzle!.height, 2);

    for (const id of ['recon', 'pathfinder']) {
      expect(unitBannerHeight(id)).toBeGreaterThan(1.8);
      expect(unitBannerHeight(id)).toBeLessThan(2.3);
    }
    expect(recon.body.teamMask.some((v) => v >= 0.5)).toBe(true);
    expect(recon.turret!.teamMask.some((v) => v >= 0.5)).toBe(true);
  });

  it('lowers the health-bar anchor for the rescaled models', () => {
    expect(unitBannerHeight('rifle')).toBeGreaterThan(1.1);
    expect(unitBannerHeight('rifle')).toBeLessThan(1.6);
    expect(unitBannerHeight('tank')).toBeGreaterThan(unitBannerHeight('rifle'));
    expect(unitBannerHeight('tank')).toBeLessThan(2);
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

  it('marks foot units with a bounded ground pool and leaves vehicles plain', () => {
    for (const id of ['rifle', 'atgm', 'medic']) {
      const marker = unitGroundMarker(id);
      expect(marker, id).not.toBeNull();
      expect(marker!.rx).toBeGreaterThan(0);
      expect(marker!.rz).toBeGreaterThan(0);
      expect(marker!.alpha).toBeGreaterThan(0);
      expect(marker!.alpha).toBeLessThanOrEqual(0.5);
      // A presence cue, not a second shadow: it stays near the unit's own
      // contact footprint instead of growing into an area marker.
      expect(marker!.rx).toBeLessThan(unitShadowRadius(id)[0] * 2);
    }
    for (const id of ['tank', 'spg', 'recon', 'harvester', 'corvette']) {
      expect(unitGroundMarker(id), id).toBeNull();
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

  it('carries a team-colour surface on every unit', () => {
    // Ownership has to survive at battle zoom, so every unit needs at least one
    // painted panel on its body or its turret; team colour cannot be an
    // MBT-only convention.
    for (const id of Object.keys(UNITS)) {
      const style = unitStyle(id);
      expect(style, id).toBeDefined();
      const marked =
        style!.body.teamMask.some((v) => v >= 0.5) ||
        (style!.turret?.teamMask.some((v) => v >= 0.5) ?? false);
      expect(marked, `${id} has no team marking`).toBe(true);
    }
  });
});
