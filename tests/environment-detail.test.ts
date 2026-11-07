/**
 * Environmental detail: props, sea state and atmospheric depth.
 *
 * Three separate promises are checked here, because they are three separate
 * ways the battlefield stops looking like a diagram:
 *
 *   props     — rubble, bank reeds and telegraph poles are authored from the
 *               terrain itself, so every map gets them without a map edit.
 *   sea state — a storm runs a real wave height, and the two naval penalties the
 *               waves imply (speed and watch range) come from the same profile.
 *   air       — distance haze and drifting mist give the weather depth. The
 *               calibration matters more than the effect: haze that is too
 *               strong for rain turns every map white.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WEATHER, weatherSpeedFactor } from '../src/sim/weather';
import { scenarioById } from '../src/data/scenarioCatalog';
import type { Scenario } from '../src/sim/scenario';
import { buildPropInstances } from '../src/render/terrainMesh';
import { Terrain } from '../src/sim/terrain';
import { TILE_SIZE } from '../src/sim/constants';
import { MESH_FS, PROP_FS, TERRAIN_FS, WATER_FS, WATER_VS } from '../src/render/shaders';
import { ParticleSystem } from '../src/render/particles';

const rendererSource = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const terrainMeshSource = readFileSync(
  new URL('../src/render/terrainMesh.ts', import.meta.url),
  'utf8',
);
const geometrySource = readFileSync(new URL('../src/render/geometry.ts', import.meta.url), 'utf8');

function propsFor(id: string) {
  const entry = scenarioById(id);
  if (!entry) throw new Error(`Unknown map ${id}`);
  return { scenario: entry.create(), props: buildPropInstances(entry.create()) };
}

describe('environmental props', () => {
  it('scatters rubble through the built-up districts', () => {
    const { props } = propsFor('ashcross-sprawl');
    expect(props.rubble.length).toBeGreaterThan(10);
    // Rubble belongs to the streets, not to open fields.
    const { props: open } = propsFor('open-front');
    expect(open.rubble.length).toBeLessThan(props.rubble.length);
    expect(geometrySource).toContain('export function buildRubbleMesh');
  });

  it('stands reeds in shallow water at the bank and in the marsh', () => {
    const { scenario, props } = propsFor('cormorant-isle');
    expect(props.reeds.length).toBeGreaterThan(8);
    let inWater = 0;
    for (const clump of props.reeds) {
      const tx = Math.floor(clump.x / TILE_SIZE);
      const tz = Math.floor(clump.z / TILE_SIZE);
      const tile = scenario.tiles[tz * scenario.width + tx];
      if (!tile) continue;
      if (tile.t === Terrain.ShallowWater || tile.t === Terrain.Marsh) inWater++;
    }
    // Nearly every clump must be on the bank it was authored for; a stray one
    // would be a reed growing in a street.
    expect(inWater / props.reeds.length).toBeGreaterThan(0.9);
    expect(terrainMeshSource).toContain('Terrain.Marsh ||');
  });

  it('plans a telegraph run along the roads', () => {
    const { props } = propsFor('open-front');
    expect(props.poles.length).toBeGreaterThan(0);
    expect(geometrySource).toContain('export function buildUtilityPoleMesh');
    // Poles are the tallest roadside prop, so their shadows have to be long.
    expect(rendererSource).toContain('for (const pole of this.poleInstances)');
    expect(rendererSource).toContain('this.shadowLean(1.6 * pole.scale)');
  });

  it('draws each new prop from one instanced batch', () => {
    for (const mesh of ['rubbleMesh', 'reedsMesh', 'polesMesh']) {
      expect(rendererSource).toContain(`this.${mesh} = new InstancedMesh`);
      expect(rendererSource).toContain(`this.${mesh}.draw(`);
    }
  });
});

describe('terrain detail families', () => {
  /**
   * The eight terrains added with the sixteen-map catalogue shipped without any
   * ground scatter: scrub, dune, farmland, mud and rocky ground were painted
   * tiles. A brush map read as a flat field with a forest on it. Each now grows
   * its own family, and these are the promises that keep it that way.
   */
  type Props = ReturnType<typeof buildPropInstances>;

  function countOn(
    scenario: Scenario,
    list: Props[keyof Props],
    terrain: number,
  ): number {
    let found = 0;
    for (const instance of list as Array<{ x: number; z: number }>) {
      const tx = Math.floor(instance.x / TILE_SIZE);
      const tz = Math.floor(instance.z / TILE_SIZE);
      if (scenario.tiles[tz * scenario.width + tx]?.t === terrain) found++;
    }
    return found;
  }

  function tilesOf(scenario: Scenario, terrain: number): number {
    let found = 0;
    for (const tile of scenario.tiles) if (tile.t === terrain) found++;
    return found;
  }

  it('grows brush across scrub ground instead of leaving it painted', () => {
    const { scenario, props } = propsFor('thorn-scrub');
    const scrub = tilesOf(scenario, Terrain.Scrub);
    expect(scrub).toBeGreaterThan(200);
    const brush =
      countOn(scenario, props.bushes, Terrain.Scrub) + countOn(scenario, props.shrubs, Terrain.Scrub);
    // The thickets are two plants deep, so roughly half of every brush tile
    // carries scrub and the rest carries a straggler.
    expect(brush).toBeGreaterThan(scrub * 0.25);
  });

  it('strews stubble over farmland and dry grass over the dunes', () => {
    const vale = propsFor('hedgerow-vale');
    expect(tilesOf(vale.scenario, Terrain.Farmland)).toBeGreaterThan(200);
    expect(countOn(vale.scenario, vale.props.tufts, Terrain.Farmland)).toBeGreaterThan(100);

    const erg = propsFor('saffron-erg');
    expect(countOn(erg.scenario, erg.props.tufts, Terrain.Dune)).toBeGreaterThan(50);
    // Wind-blown sand leaves stone behind: the dune belt is not a bare slope.
    expect(countOn(erg.scenario, erg.props.rocks, Terrain.Dune)).toBeGreaterThan(5);
  });

  it('raises boulders on rocky ground, not only on ridge rock', () => {
    const { scenario, props } = propsFor('granite-steps');
    const rocky = tilesOf(scenario, Terrain.Rocks);
    expect(rocky).toBeGreaterThan(100);
    expect(countOn(scenario, props.rocks, Terrain.Rocks)).toBeGreaterThan(rocky * 0.25);
  });

  it('feeds the new detail through the batches that already exist', () => {
    // Six instanced batches cover every map's scatter; a new terrain joins them
    // rather than adding a draw call of its own.
    for (const mesh of ['rocksMesh', 'bushesMesh', 'shrubsMesh', 'tuftsMesh']) {
      expect(rendererSource).toContain(`this.${mesh}.draw(`);
    }
  });
});

describe('sea state', () => {
  it('rises with the weather and taxes both hulls and watches', () => {
    expect(WEATHER.clear.sea).toBeLessThan(WEATHER.rain.sea);
    expect(WEATHER.rain.sea).toBeLessThan(WEATHER.storm.sea);
    expect(WEATHER.storm.sea).toBeLessThan(WEATHER.blizzard.sea);
    // The two naval penalties follow the water they come from.
    expect(WEATHER.storm.navalSpeed).toBeLessThan(1);
    expect(WEATHER.storm.navalVision).toBeLessThan(WEATHER.rain.navalVision);
    expect(weatherSpeedFactor('naval', WEATHER.storm)).toBe(WEATHER.storm.navalSpeed);
  });

  it('moves a real surface rather than shading a flat plane', () => {
    // A four-corner quad can only be tilted, so the sea is a displaced grid.
    expect(WATER_VS).toContain('uniform float uSea');
    expect(WATER_VS).toContain('seaSurface(aPos.xz, uTime, uSea)');
    expect(WATER_VS).toContain('aPos.y + height');
    expect(rendererSource).toContain('segmentsX');
    expect(rendererSource).toContain('this.waterCount');
    // Deep water only: the shelf stays flat so the surf line holds the beach.
    expect(WATER_VS).toContain('shore.r');
  });

  it('breaks whitecaps in a heavy sea', () => {
    expect(WATER_FS).toContain('float openSea = 1.0 - depth;');
    expect(WATER_FS).toContain('float caps = smoothstep');
    expect(WATER_FS).toContain('whitecap');
    // Sea state reaches the shader from the profile, not from a constant.
    expect(rendererSource).toContain('this.weather.sea');
  });
});

describe('air: haze and mist', () => {
  it('thickens the air as the weather worsens, without whiting out a clear day', () => {
    expect(WEATHER.clear.haze).toBeLessThan(WEATHER.overcast.haze);
    expect(WEATHER.overcast.haze).toBeLessThan(WEATHER.rain.haze);
    expect(WEATHER.rain.haze).toBeLessThan(WEATHER.storm.haze);
    expect(WEATHER.storm.haze).toBeLessThan(WEATHER.fog.haze);
    // Calibration guard: at ~150 world units of view, everything except fog and
    // a blizzard has to stay under a heavy wash. The first pass had rain at 80%
    // extinction, which made every map look like it was inside a cloud.
    const extinctionAt = (density: number) => 1 - Math.exp(-density * 150);
    expect(extinctionAt(WEATHER.rain.haze)).toBeLessThan(0.25);
    expect(extinctionAt(WEATHER.storm.haze)).toBeLessThan(0.4);
    expect(extinctionAt(WEATHER.clear.haze)).toBeLessThan(0.03);
    expect(extinctionAt(WEATHER.fog.haze)).toBeGreaterThan(0.7);
  });

  it('fades every lit surface toward the weather, before the fog of war', () => {
    for (const shader of [MESH_FS, TERRAIN_FS, WATER_FS, PROP_FS]) {
      expect(shader).toContain('applyHaze(');
      expect(shader).toContain('uniform float uHaze');
      // Knowledge has the last word: the fog mask is applied after the air.
      expect(shader.indexOf('= applyHaze(')).toBeLessThan(shader.indexOf('= applyFog('));
    }
  });

  it('measures haze from the camera focus, not from the far-back eye', () => {
    // Regression guard. The camera is orthographic and sits ~1400 units back
    // along its own view axis, so distance from the eye is the same for every
    // fragment on screen. Measuring from the eye replaced the whole view with
    // the air colour: a storm day became a white void. Haze has to be measured
    // past the focus point instead.
    expect(TERRAIN_FS).toContain('uniform float uHazeRef;');
    expect(TERRAIN_FS).toContain('max(0.0, length(world - uEye) - uHazeRef)');
    for (const shader of [MESH_FS, TERRAIN_FS, WATER_FS, PROP_FS]) {
      expect(shader).toContain('uHazeRef');
    }
    expect(rendererSource).toContain("'uHaze', 'uHazeColor', 'uHazeRef'");
    expect(rendererSource).toContain('u.uHazeRef');
  });

  it('drifts mist banks in fog and only a trace of it elsewhere', () => {
    const system = new ParticleSystem();
    system.mist(10, 10, [1.6, 0.6], 1);
    expect(system.particles).toHaveLength(1);
    const bank = system.particles[0];
    expect(bank.alpha).toBeLessThan(0.07);
    expect(bank.soft).toBeGreaterThan(0.9);
    expect(bank.life).toBeGreaterThan(4);
    // Emission is weather-keyed: thick in fog, a garnish under rain.
    expect(rendererSource).toContain('private emitMist(');
    expect(rendererSource).toContain("profile.kind === 'fog'");
    expect(rendererSource).toContain('this.mistBudget += 2 * density * dt');
  });
});
