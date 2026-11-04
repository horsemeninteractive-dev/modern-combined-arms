import { beforeEach, describe, expect, it } from 'vitest';
import {
  HEALTH_COLORS,
  HEALTH_SEGMENTS,
  SERVICE_ROW_HEIGHT,
  ammoPips,
  clampFraction,
  fuelFraction,
  fuelPercent,
  hasServiceStrip,
  healthColor,
  healthPercent,
  healthPulse,
  healthSegments,
  healthTone,
  serviceStripLayout,
  supplyTone,
} from '../src/ui/bars';
import { UNITS } from '../src/data/units';
import {
  DAMAGE_SPILL,
  buildingDamageAnchors,
  buildingDamageMesh,
  buildingDamageStage,
  buildingDamageTint,
  clearDamageMeshCache,
} from '../src/render/buildingDamage';
import { clearBuildingModuleCache, buildingModuleMesh } from '../src/render/buildingModules';
import { buildingTopHeight } from '../src/render/buildingMeshes';
import { BUILDINGS } from '../src/data/buildings';
import { TILE_SIZE } from '../src/sim/constants';

function triangles(mesh: { indices: ArrayLike<number> }): number {
  return mesh.indices.length / 3;
}

function extents(defId: string): { x: number; z: number } {
  const def = BUILDINGS[defId];
  return {
    x: (def.footprint.w * TILE_SIZE) / 2,
    z: (def.footprint.h * TILE_SIZE) / 2,
  };
}

describe('battlefield health bar presentation', () => {
  it('keeps the two established breakpoints for the tone ramp', () => {
    expect(healthTone(1)).toBe('ok');
    expect(healthTone(0.61)).toBe('ok');
    expect(healthTone(0.6)).toBe('wounded');
    expect(healthTone(0.31)).toBe('wounded');
    expect(healthTone(0.3)).toBe('critical');
    expect(healthTone(0)).toBe('critical');
    expect(healthColor(0.8)).toBe(HEALTH_COLORS.ok);
    expect(healthColor(0.1)).toBe(HEALTH_COLORS.critical);
  });

  it('clamps and rounds the values the overlay prints', () => {
    expect(clampFraction(1.4)).toBe(1);
    expect(clampFraction(-2)).toBe(0);
    expect(clampFraction(Number.NaN)).toBe(0);
    expect(healthPercent(0.426)).toBe(43);
    expect(healthPercent(2)).toBe(100);
  });

  it('counts lit cells so a nearly dead hull still shows one', () => {
    expect(HEALTH_SEGMENTS).toBe(10);
    expect(healthSegments(0)).toBe(0);
    expect(healthSegments(0.001)).toBe(1);
    expect(healthSegments(0.04)).toBe(1);
    expect(healthSegments(0.55)).toBe(6);
    expect(healthSegments(1)).toBe(HEALTH_SEGMENTS);
    expect(healthSegments(0.5, 4)).toBe(2);
  });

  it('only pulses a critical hull, and never under reduced motion', () => {
    let min = 1;
    let max = 0;
    for (let now = 0; now < 1200; now += 40) {
      const value = healthPulse(0.1, now);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(min).toBeLessThan(0.15);
    expect(max).toBeGreaterThan(0.85);
    expect(healthPulse(0.8, 100)).toBe(0);
    expect(healthPulse(0.1, 100, true)).toBe(0);
  });
});

describe('ammunition pips and endurance meter', () => {
  it('shows one pip per round, live rounds first', () => {
    expect(ammoPips(4, 4)).toEqual([true, true, true, true]);
    expect(ammoPips(0, 4)).toEqual([false, false, false, false]);
    expect(ammoPips(2, 5)).toEqual([true, true, false, false, false]);
    expect(ammoPips(0, 0)).toEqual([]);
  });

  it('clamps a bad or oversized rack instead of drawing a wall of pips', () => {
    expect(ammoPips(9, 6)).toHaveLength(6);
    expect(ammoPips(6, 6).every(Boolean)).toBe(true);
    expect(ammoPips(30, 30)).toHaveLength(12);
    expect(ammoPips(-2, 3)).toEqual([false, false, false]);
  });

  it('turns the endurance rail at half a tank and at a fifth', () => {
    expect(fuelFraction(40, 80)).toBe(0.5);
    expect(fuelFraction(40, 0)).toBe(0);
    expect(fuelPercent(63, 80)).toBe(79);
    expect(supplyTone(1)).toBe('ok');
    expect(supplyTone(0.51)).toBe('ok');
    expect(supplyTone(0.5)).toBe('low');
    expect(supplyTone(0.21)).toBe('low');
    expect(supplyTone(0.2)).toBe('critical');
    expect(supplyTone(0)).toBe('critical');
  });

  it('only gives aircraft and ships a service strip', () => {
    expect(hasServiceStrip('air')).toBe(true);
    expect(hasServiceStrip('naval')).toBe(true);
    expect(hasServiceStrip('land')).toBe(false);
    expect(hasServiceStrip(undefined)).toBe(false);
  });

  it('stacks the rail and the rack without spilling out of the plate', () => {
    // The selected hull's plate is its 30px bar plus 3px of frame either side.
    const plate = 36;
    for (const [id, def] of Object.entries(UNITS)) {
      if (!hasServiceStrip(def.domain)) continue;
      const ammo = def.ammo ?? 0;
      const fuel = def.fuel ?? 0;
      const layout = serviceStripLayout(ammo, ammo, fuel, plate);
      expect(layout.ammoWidth, id).toBeLessThanOrEqual(plate);
      const both = ammo > 0 && fuel > 0;
      expect(layout.fuelRow).toBe(fuel > 0 ? SERVICE_ROW_HEIGHT : 0);
      expect(layout.ammoRow).toBe(ammo > 0 ? SERVICE_ROW_HEIGHT : 0);
      expect(layout.rowGap).toBe(both ? 2 : 0);
      expect(layout.contentHeight).toBe(layout.fuelRow + layout.rowGap + layout.ammoRow);
    }
  });

  it('keeps a full twelve-round rack inside the plate by tightening the pitch', () => {
    const layout = serviceStripLayout(12, 12, 80, 36);
    expect(layout.ammoWidth).toBeLessThanOrEqual(36);
    expect(layout.pipWidth).toBeLessThan(3);
    expect(layout.pipGap).toBe(1);
    expect(serviceStripLayout(0, 0, 0, 36).contentHeight).toBe(0);
    expect(serviceStripLayout(0, 0, 80, 36).contentHeight).toBe(SERVICE_ROW_HEIGHT);
  });
});

describe('building battle-damage states', () => {
  beforeEach(() => clearDamageMeshCache());

  it('crosses into a new state at each threshold', () => {
    expect(buildingDamageStage(1)).toBe(0);
    expect(buildingDamageStage(0.8)).toBe(0);
    expect(buildingDamageStage(0.79)).toBe(1);
    expect(buildingDamageStage(0.5)).toBe(1);
    expect(buildingDamageStage(0.49)).toBe(2);
    expect(buildingDamageStage(0.22)).toBe(2);
    expect(buildingDamageStage(0.1)).toBe(3);
    expect(buildingDamageStage(Number.NaN)).toBe(0);
  });

  it('chars the paint monotonically as integrity falls', () => {
    expect(buildingDamageTint(1)).toEqual([1, 1, 1]);
    const samples = [0.9, 0.7, 0.45, 0.2, 0.05].map((f) => buildingDamageTint(f));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i][0]).toBeLessThan(samples[i - 1][0]);
      expect(samples[i][1]).toBeLessThan(samples[i - 1][1]);
      expect(samples[i][2]).toBeLessThan(samples[i - 1][2]);
    }
    const [r, g, b] = samples[samples.length - 1];
    // Soot is warm, not blue: red survives a little longer than green or blue.
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r).toBeGreaterThan(0.6);
  });

  it('adds a distinct debris mesh at each new stage', () => {
    expect(buildingDamageMesh('commandPost', 0)).toBeUndefined();
    const light = buildingDamageMesh('commandPost', 1)!;
    const heavy = buildingDamageMesh('commandPost', 2)!;
    const wrecked = buildingDamageMesh('commandPost', 3)!;
    expect(light).toBeDefined();
    expect(triangles(heavy)).toBeGreaterThan(triangles(light));
    expect(triangles(wrecked)).toBeGreaterThan(triangles(heavy));
    // A ruin and a bridge already carry their own damage story.
    expect(buildingDamageMesh('ruin', 3)).toBeUndefined();
    expect(buildingDamageMesh('bridge', 3)).toBeUndefined();
  });

  it('generates the same debris from the same definition every time', () => {
    const first = buildingDamageMesh('commandPost', 3)!;
    clearDamageMeshCache();
    const second = buildingDamageMesh('commandPost', 3)!;
    expect(Array.from(second.positions)).toEqual(Array.from(first.positions));
    expect(Array.from(second.indices)).toEqual(Array.from(first.indices));
  });

  it('keeps debris in a bounded spill and below the structure top', () => {
    const bound = DAMAGE_SPILL + 1.4;
    for (const defId of Object.keys(BUILDINGS)) {
      const { x: halfX, z: halfZ } = extents(defId);
      const top = buildingTopHeight(defId);
      for (const stage of [1, 2, 3] as const) {
        const mesh = buildingDamageMesh(defId, stage);
        if (!mesh) continue;
        for (let i = 0; i < mesh.positions.length; i += 3) {
          const x = mesh.positions[i];
          const y = mesh.positions[i + 1];
          const z = mesh.positions[i + 2];
          expect(Math.abs(x), `${defId} stage ${stage} x`).toBeLessThanOrEqual(halfX + bound);
          expect(Math.abs(z), `${defId} stage ${stage} z`).toBeLessThanOrEqual(halfZ + bound);
          expect(y, `${defId} stage ${stage} y`).toBeGreaterThanOrEqual(-0.01);
          expect(y, `${defId} stage ${stage} top`).toBeLessThanOrEqual(top + 0.001);
        }
      }
    }
  });

  it('emits smoke from the pile only once the structure is failing', () => {
    expect(buildingDamageAnchors('commandPost', 0)).toHaveLength(0);
    expect(buildingDamageAnchors('commandPost', 1)).toHaveLength(0);
    expect(buildingDamageAnchors('commandPost', 2).length).toBeGreaterThanOrEqual(1);
    const anchors = buildingDamageAnchors('commandPost', 3);
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    const { x: halfX, z: halfZ } = extents('commandPost');
    for (const [x, y, z] of anchors) {
      expect(Math.abs(x)).toBeLessThanOrEqual(halfX + DAMAGE_SPILL);
      expect(Math.abs(z)).toBeLessThanOrEqual(halfZ + DAMAGE_SPILL);
      expect(y).toBeGreaterThan(0.2);
    }
  });
});

describe('installed building modules change the model', () => {
  beforeEach(() => clearBuildingModuleCache());

  it('adds a turbine skid to the power plant', () => {
    const mesh = buildingModuleMesh('powerPlant', 'advancedTurbine');
    expect(mesh).toBeDefined();
    expect(triangles(mesh!)).toBeGreaterThan(100);
  });

  it('never hoists a retrofit onto a structure it cannot be installed on', () => {
    expect(buildingModuleMesh('commandPost', 'advancedTurbine')).toBeUndefined();
    expect(buildingModuleMesh('powerPlant', 'notAModule')).toBeUndefined();
  });

  it('keeps the retrofit inside the existing footprint and top band', () => {
    const mesh = buildingModuleMesh('powerPlant', 'advancedTurbine')!;
    const { x: halfX, z: halfZ } = extents('powerPlant');
    const top = buildingTopHeight('powerPlant');
    for (let i = 0; i < mesh.positions.length; i += 3) {
      expect(Math.abs(mesh.positions[i])).toBeLessThanOrEqual(halfX);
      expect(Math.abs(mesh.positions[i + 2])).toBeLessThanOrEqual(halfZ);
      expect(mesh.positions[i + 1]).toBeGreaterThanOrEqual(0);
      expect(mesh.positions[i + 1]).toBeLessThanOrEqual(top);
    }
  });
});
