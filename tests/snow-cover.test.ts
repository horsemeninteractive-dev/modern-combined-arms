/**
 * Snow cover: weather-driven whiteout on the ground and on the canopy.
 *
 * The shipped snow weather used to change the light and the precipitation but
 * left the battlefield summer-green, and the authored snow overlay only reached
 * a 27% blend, which read as frozen dirt. These tests pin the two halves of the
 * fix: a canopy shell that is only instanced in snow and blizzard, and a ground
 * cover that is actually white.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTreeMesh, buildTreeSnowMesh } from '../src/render/geometry';
import { buildTerrainGeometry } from '../src/render/terrainMesh';
import { OVERLAYS, Overlay, packOverlay } from '../src/sim/terrain';
import { createScenario } from '../src/sim/scenario';

const rendererSource = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const shaderSource = readFileSync(new URL('../src/render/shaders.ts', import.meta.url), 'utf8');

describe('snow on the trees', () => {
  it('builds a shell that sits on the conifer tiers', () => {
    const tree = buildTreeMesh();
    const cap = buildTreeSnowMesh();
    expect(cap.positions.length).toBeGreaterThan(0);
    expect(cap.indices.length).toBeGreaterThan(0);
    expect(cap.materials!.length).toBe(cap.positions.length / 3);

    let capTop = -Infinity;
    let treeTop = -Infinity;
    let capRadius = 0;
    for (let i = 0; i < cap.positions.length; i += 3) {
      capTop = Math.max(capTop, cap.positions[i + 1]);
      capRadius = Math.max(capRadius, Math.hypot(cap.positions[i], cap.positions[i + 2]));
    }
    for (let i = 0; i < tree.positions.length; i += 3) {
      treeTop = Math.max(treeTop, tree.positions[i + 1]);
    }
    // The shell covers the canopy but never grows beyond the tree it sits on.
    expect(capTop).toBeGreaterThan(treeTop * 0.7);
    expect(capTop).toBeLessThanOrEqual(treeTop + 0.2);
    expect(capRadius).toBeLessThan(2.0);

    // Snow is white, matte and cold-tinted rather than a pale copy of the leaves.
    let sum = 0;
    for (const channel of cap.colors) sum += channel;
    expect(sum / cap.colors.length).toBeGreaterThan(0.65);
  });

  it('is only instanced in snow and blizzard weather', () => {
    expect(rendererSource).toContain('buildTreeSnowMesh');
    expect(rendererSource).toContain('this.snowCapsMesh');
    expect(rendererSource).toContain("kind === 'snow' || this.weather.kind === 'blizzard'");
    expect(rendererSource).toContain('this.snowCapsMesh.draw(this.snowCapInstances.length)');
  });
});

describe('snow on the ground', () => {
  it('paints an authored snow layer as cover, not as a faint tint', () => {
    // The old 0.3 strength capped the blend at 27%: green showed straight
    // through, which is what made snow look like frozen ground.
    expect(OVERLAYS[Overlay.Snow].strength).toBeGreaterThanOrEqual(0.85);

    const scenario = createScenario(8, 8);
    for (const tile of scenario.tiles) tile.v = packOverlay(Overlay.Snow, 3);
    const geometry = buildTerrainGeometry(scenario);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < geometry.colors.length; i += 3) {
      r += geometry.colors[i];
      g += geometry.colors[i + 1];
      b += geometry.colors[i + 2];
      n++;
    }
    expect(r / n).toBeGreaterThanOrEqual(0.6);
    expect(g / n).toBeGreaterThanOrEqual(0.6);
    expect(b / n).toBeGreaterThanOrEqual(0.65);
  });

  it('whitens the whole terrain from the weather, not only painted tiles', () => {
    expect(shaderSource).toContain('uniform float uSnow;');
    expect(shaderSource).toContain('snow = vec3(0.87, 0.9, 0.95)');
    expect(rendererSource).toContain('this.groundSnow()');
    expect(rendererSource).toContain("kind === 'blizzard' ? 0.92 : kind === 'snow' ? 0.7 : 0");
  });
});
