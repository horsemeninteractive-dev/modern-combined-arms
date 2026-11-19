import { describe, expect, it } from 'vitest';
import renderer from '../src/render/renderer.ts?raw';
import { MESH_FS, PROP_FS, SHADOW_DEPTH_VS, TERRAIN_FS } from '../src/render/shaders';
import { shadowLightMatrix } from '../src/render/shadowMap';
import type { Vec3 } from '../src/render/math';

function project(m: Float32Array, p: Vec3): { x: number; y: number; z: number; w: number } {
  return {
    x: m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    y: m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    z: m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    w: m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
  };
}

describe('detailed shadows', () => {
  it('fits the sun volume around the camera footprint', () => {
    const sun: Vec3 = [0.4, 0.8, -0.3];
    const volume = shadowLightMatrix(sun, 120, 80, 90);
    const c = project(volume.matrix, volume.center);
    // The framed centre lands in the middle of the map, at mid depth.
    expect(c.w).toBeCloseTo(1, 5);
    expect(c.x / c.w * 0.5 + 0.5).toBeCloseTo(0.5, 5);
    expect(c.y / c.w * 0.5 + 0.5).toBeCloseTo(0.5, 5);
    expect(c.z * 0.5 + 0.5).toBeGreaterThan(0);
    expect(c.z * 0.5 + 0.5).toBeLessThan(1);

    // A point toward the sun is nearer the light and must store less depth, so
    // a surface behind it compares as shadowed.
    const towardSun = project(volume.matrix, [
      volume.center[0] + sun[0] * 20,
      volume.center[1] + sun[1] * 20,
      volume.center[2] + sun[2] * 20,
    ]);
    const above = project(volume.matrix, [
      volume.center[0],
      volume.center[1] + 20,
      volume.center[2],
    ]);
    expect(towardSun.z).toBeLessThan(above.z);

    // The box covers the ground footprint rather than a pinprick: a point well
    // inside the fitted radius still projects inside the map.
    const inside = project(volume.matrix, [120 + 45, 4, 80]);
    expect(Math.abs(inside.x / inside.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(inside.y / inside.w)).toBeLessThanOrEqual(1);
  });

  it('snaps the fitted shadow box to light-space texels', () => {
    const sun: Vec3 = [0.4, 0.8, -0.3];
    // A sub-texel camera move must leave the matrix unchanged; otherwise every
    // shadow edge slides a fraction of a texel per frame as the camera pans.
    const a = shadowLightMatrix(sun, 120, 80, 90, 4, 2048);
    const b = shadowLightMatrix(sun, 120.001, 80.001, 90, 4, 2048);
    a.matrix.forEach((value, i) => expect(b.matrix[i]).toBeCloseTo(value, 5));
  });

  it('rasterises casters with the light matrix, including instanced props', () => {
    expect(SHADOW_DEPTH_VS).toContain('uLightVP');
    expect(SHADOW_DEPTH_VS).toContain('uModel');
    expect(SHADOW_DEPTH_VS).toContain('layout(location=4) in vec3 iPos');
    expect(SHADOW_DEPTH_VS).toContain('layout(location=6) in float iScale');
    // A static mesh leaves the instance attributes disabled, and a disabled
    // float attribute reads as zero. The uniform restores full scale or every
    // building, hull and terrain triangle would collapse to the origin.
    expect(SHADOW_DEPTH_VS).toContain('iScale + uStaticScale');
    expect(renderer).toContain("'uModel', 'uLightVP', 'uStaticScale'");
    expect(renderer).toContain('gl.uniform1f(p.u.uStaticScale, 1)');
    expect(renderer).toContain('gl.uniform1f(p.u.uStaticScale, 0)');
  });

  it('samples the map with PCF in every lit receiver', () => {
    for (const fs of [MESH_FS, TERRAIN_FS, PROP_FS]) {
      expect(fs).toContain('uniform sampler2D uShadowMap');
      expect(fs).toContain('uShadowStrength');
      expect(fs).toContain('shadowAt(');
      expect(fs).toContain('lit / 9.0');
    }
    // Cast shadows only remove the sun's share, never the ambient floor.
    expect(MESH_FS).toContain('mix(1.0, shadowed, uShadowStrength)');
    expect(TERRAIN_FS).toContain('mix(1.0, shadowAt(vWorld, n), uShadowStrength)');
    expect(PROP_FS).toContain('mix(1.0, shadowAt(vWorld, n), uShadowStrength)');
  });

  it('gates the passes on the three levels', () => {
    // Basic still owns the flat pass; detailed draws the map first.
    expect(renderer).toContain("this.settings.shadowDetail !== 'basic'");
    expect(renderer).toContain("this.settings.shadowDetail !== 'detailed'");
    expect(renderer.indexOf('this.renderShadowMap();')).toBeLessThan(
      renderer.indexOf('this.drawTerrain();'),
    );
    // Terrain, props, structures and hulls all cast, and the map is fitted to
    // the visible ground rather than the whole map.
    expect(renderer).toContain(
      'shadowLightMatrix(this.sun, cx, cz, radius, 4, this.shadowMap.size)',
    );
    expect(renderer).toContain('gl.drawElements(gl.TRIANGLES, this.terrainGpu.count');
    expect(renderer).toContain('style.body.draw()');
    // A vehicle's turret is part of its silhouette; casting only the hull lost
    // the gun and launcher from the ground shadow.
    expect(renderer).toContain('style.turret.draw()');
    expect(renderer).toContain('this.bushesMesh.draw(this.bushInstances.length)');
  });
});
