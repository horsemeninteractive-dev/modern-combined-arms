import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CRATER_DECAL_LIFE,
  DecalStore,
  MAX_GROUND_DECALS,
  SCORCH_DECAL_LIFE,
  TRACK_DECAL_LIFE,
  TYRE_DECAL_LIFE,
  decalAlpha,
} from '../src/render/decalStore';

describe('ground decal store', () => {
  it('drops the oldest mark at the cap instead of growing without bound', () => {
    const store = new DecalStore();
    for (let i = 0; i < MAX_GROUND_DECALS + 8; i++) {
      store.addTrack(i, 0, 0, 0, 1, 1);
    }

    expect(store.length).toBe(MAX_GROUND_DECALS);
    expect(store.decals[0].x).toBe(8);
    expect(store.decals[store.length - 1].x).toBe(MAX_GROUND_DECALS + 7);
  });

  it('fades with age and removes each kind at its own lifetime', () => {
    const store = new DecalStore();
    store.addTrack(10, 0, 20, 0.5, 2, 1);
    const track = store.decals[0];
    expect(track.kind).toBe('track');
    expect(track.life).toBe(TRACK_DECAL_LIFE);
    expect(decalAlpha(track)).toBeCloseTo(track.alpha, 6);

    store.update(TRACK_DECAL_LIFE / 2);
    expect(decalAlpha(track)).toBeCloseTo(track.alpha * 0.5, 6);

    store.update(TRACK_DECAL_LIFE);
    expect(store.length).toBe(0);

    store.addScorch(10, 0, 20, 1.4);
    const scorch = store.decals[0];
    expect(scorch.kind).toBe('scorch');
    expect(scorch.life).toBe(SCORCH_DECAL_LIFE);
    expect(scorch.rx).toBe(scorch.rz);
    expect(scorch.rx).toBeCloseTo(1.4, 6);

    store.update(TRACK_DECAL_LIFE + 0.1);
    expect(store.length).toBe(1);
    store.update(SCORCH_DECAL_LIFE);
    expect(store.length).toBe(0);
  });

  it('gives rubber marks and craters their own bounded lives', () => {
    const store = new DecalStore();
    store.addTyreTrack(4, 0, 8, 0, 1.6, 1.2);
    const tyre = store.decals[0];
    expect(tyre.kind).toBe('tyre');
    expect(tyre.life).toBe(TYRE_DECAL_LIFE);
    expect(tyre.life).toBeLessThan(TRACK_DECAL_LIFE);

    store.addCrater(9, 0, 3, 0.7);
    const crater = store.decals[1];
    expect(crater.kind).toBe('crater');
    expect(crater.life).toBe(CRATER_DECAL_LIFE);
    expect(crater.rx).toBe(0.7);
    expect(crater.rz).toBe(0.7);

    store.update(TYRE_DECAL_LIFE + 0.1);
    expect(store.decals.map((decal) => decal.kind)).toEqual(['crater']);
    expect(decalAlpha(store.decals[0])).toBeLessThan(crater.alpha);
  });

  it('ignores zero or negative frame steps and clears on a new scene', () => {
    const store = new DecalStore();
    store.addTrack(1, 0, 2, 0, 1, 1);
    store.update(0);
    store.update(-1);
    expect(store.length).toBe(1);
    store.clear();
    expect(store.length).toBe(0);
    expect(store.decals).toEqual([]);
  });
});

describe('renderer ground decal integration', () => {
  const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

  it('draws only effects-enabled, gameplay-visible decals', () => {
    const start = renderer.indexOf('private drawGroundDecals');
    const end = renderer.indexOf('private drawShadows', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = renderer.slice(start, end);
    expect(block).toContain('if (!this.settings.effects');
    expect(block).toContain('this.pointVisible');
    expect(block).toContain('decalAlpha');
  });

  it('stamps tracks, tyre marks, scorch and craters only for visible presentation work', () => {
    const trackStart = renderer.indexOf('private stampTrackDecal');
    const tyreStart = renderer.indexOf('private stampTyreDecal', trackStart);
    const scorchStart = renderer.indexOf('private addScorchDecal', tyreStart);
    const craterStart = renderer.indexOf('private addCraterDecal', scorchStart);
    const updateStart = renderer.indexOf('private updateProjectileViews', craterStart);
    expect(trackStart).toBeGreaterThan(-1);
    expect(tyreStart).toBeGreaterThan(trackStart);
    expect(scorchStart).toBeGreaterThan(tyreStart);
    expect(craterStart).toBeGreaterThan(scorchStart);
    expect(updateStart).toBeGreaterThan(craterStart);

    const trackBlock = renderer.slice(trackStart, tyreStart);
    const tyreBlock = renderer.slice(tyreStart, scorchStart);
    const scorchBlock = renderer.slice(scorchStart, craterStart);
    const craterBlock = renderer.slice(craterStart, updateStart);
    expect(trackBlock).toContain('isWaterAt');
    expect(trackBlock).toContain('this.decals.addTrack');
    expect(tyreBlock).toContain('isWaterAt');
    expect(tyreBlock).toContain('this.decals.addTyreTrack');
    expect(scorchBlock).toContain('isWaterAt');
    expect(scorchBlock).toContain('this.decals.addScorch');
    expect(craterBlock).toContain('isWaterAt');
    expect(craterBlock).toContain('this.decals.addCrater');
  });

  it('emits wheeled marks and small ground-impact craters from the right triggers', () => {
    const ambient = renderer.slice(
      renderer.indexOf('private emitAmbientEffects'),
      renderer.indexOf('private stampTrackDecal'),
    );
    expect(ambient).toContain("def.moveClass === 'tracked' || def.moveClass === 'wheeled'");
    expect(ambient).toContain('this.stampTyreDecal');
    expect(ambient).toContain('this.stampTrackDecal');

    const impact = renderer.slice(
      renderer.indexOf("case 'impact':"),
      renderer.indexOf("case 'explosion':"),
    );
    expect(impact).toContain("ev.surface === 'ground'");
    expect(impact).toContain("profile.class !== 'smallArms'");
    expect(impact).toContain('this.addCraterDecal');

    const explosion = renderer.slice(
      renderer.indexOf("case 'explosion':"),
      renderer.indexOf("case 'unitLost':"),
    );
    expect(explosion).toContain("ev.surface === 'ground'");
    expect(explosion).toContain('this.addScorchDecal');
    expect(explosion).toContain('this.addCraterDecal');
  });

  it('clears and ages decals outside the simulation', () => {
    expect(renderer).toContain('this.decals.clear()');
    expect(renderer).toContain('this.decals.update(dt)');
    expect(renderer).toContain('this.drawGroundDecals()');
  });
});
