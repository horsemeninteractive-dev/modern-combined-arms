import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { TILE_SIZE } from '../src/sim/constants';
import {
  WEATHER,
  WEATHER_KINDS,
  isWeatherKind,
  normaliseWeather,
  weatherFor,
  weatherSpeedFactor,
} from '../src/sim/weather';
import { parseScenario } from '../src/sim/scenario';
import { ParticleSystem } from '../src/render/particles';
import { PARTICLE_VS, PROP_VS, TERRAIN_FS } from '../src/render/shaders';

/**
 * Weather.
 *
 * Two properties matter. First, `clear` must be the exact identity, so every
 * scenario authored before weather existed fights the battle it was tuned for.
 * Second, the four factors have to stack: light, weather, elevation and terrain
 * are independent multipliers rather than one replacing another.
 */

const editorSource = readFileSync(new URL('../src/ui/editor.ts', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

function arena(weather: string, startHour = 12) {
  const scenario = createEmptyScenario(48, 48);
  scenario.settings.fog = false;
  scenario.settings.startHour = startHour;
  scenario.settings.dayLengthMinutes = 240;
  // The setting is authored text; parsing is what validates it in real files.
  scenario.settings.weather = normaliseWeather(weather);
  return scenario;
}

describe('weather catalogue', () => {
  it('is the exact identity when clear', () => {
    const clear = weatherFor('clear');
    expect(clear.visibility).toBe(1);
    expect(clear.acquisition).toBe(1);
    expect(clear.accuracy).toBe(1);
    expect(clear.dispersion).toBe(1);
    expect(weatherSpeedFactor('land', clear)).toBe(1);
    expect(weatherSpeedFactor('air', clear)).toBe(1);
    expect(clear.precipitation).toBe(0);
    expect(clear.gloom).toBe(0);
  });

  it('degrades detection monotonically as the weather worsens', () => {
    const order = ['clear', 'overcast', 'rain', 'storm'] as const;
    for (let i = 1; i < order.length; i++) {
      const worse = WEATHER[order[i]];
      const better = WEATHER[order[i - 1]];
      expect(worse.visibility).toBeLessThan(better.visibility);
      expect(worse.accuracy).toBeLessThan(better.accuracy);
      expect(worse.dispersion).toBeGreaterThan(better.dispersion);
    }
  });

  it('taxes every domain by its own half of the weather', () => {
    const storm = WEATHER.storm;
    expect(weatherSpeedFactor('air', storm)).toBeLessThan(weatherSpeedFactor('land', storm));
    // A hull in a heavy sea is slowed by the water it is pushing through, but a
    // flat calm is still the identity, so a sea battle on a clear day is
    // unchanged.
    expect(weatherSpeedFactor('naval', storm)).toBeLessThan(1);
    expect(weatherSpeedFactor('naval', WEATHER.clear)).toBe(1);
    expect(weatherSpeedFactor('naval', WEATHER.blizzard)).toBeLessThan(
      weatherSpeedFactor('naval', storm),
    );
    expect(weatherSpeedFactor('land', WEATHER.snow)).toBeLessThan(
      weatherSpeedFactor('land', WEATHER.rain),
    );
  });

  it('treats an unknown or missing kind as a clear day', () => {
    expect(isWeatherKind('hail')).toBe(false);
    expect(normaliseWeather('hail')).toBe('clear');
    expect(normaliseWeather(undefined)).toBe('clear');
    expect(WEATHER_KINDS).toHaveLength(7);
    expect(WEATHER_KINDS).toContain('fog');
    expect(WEATHER_KINDS).toContain('blizzard');
  });

  it('makes fog a sight penalty without a ground penalty', () => {
    const fog = WEATHER.fog;
    // Mist hides far more than it slows: the ground is dry and the going is
    // good, so a fog battle is won by reconnaissance rather than traction.
    expect(fog.visibility).toBeLessThan(WEATHER.rain.visibility);
    expect(fog.groundSpeed).toBeGreaterThan(WEATHER.snow.groundSpeed);
    expect(fog.precipitation).toBe(0);
    expect(fog.wet).toBeGreaterThan(0);
    expect(fog.dim).toBeLessThan(WEATHER.storm.dim);
  });

  it('makes a blizzard the worst of the catalogue by every measure', () => {
    const blizzard = WEATHER.blizzard;
    for (const other of ['clear', 'overcast', 'fog', 'rain', 'storm', 'snow'] as const) {
      expect(blizzard.visibility).toBeLessThanOrEqual(WEATHER[other].visibility);
      expect(blizzard.groundSpeed).toBeLessThan(WEATHER[other].groundSpeed);
      expect(blizzard.airSpeed).toBeLessThan(WEATHER[other].airSpeed);
      expect(blizzard.dispersion).toBeGreaterThanOrEqual(WEATHER[other].dispersion);
    }
    // Snow is cold and matte, never wet: the whiteout does not glisten.
    expect(blizzard.wet).toBe(0);
  });

  it('lays heavier weather down on the ground it falls on', () => {
    // Wetness is what the terrain shader reads; snow is a reflector, not a soak.
    expect(WEATHER.clear.wet).toBe(0);
    expect(WEATHER.rain.wet).toBeGreaterThan(0.5);
    expect(WEATHER.storm.wet).toBe(1);
    expect(WEATHER.snow.wet).toBe(0);
    // And an overcast or storming sky kills the sun's cast shadows.
    expect(WEATHER.storm.shadow).toBeLessThan(WEATHER.rain.shadow);
    expect(WEATHER.rain.shadow).toBeLessThan(WEATHER.overcast.shadow);
  });
});

describe('weather in scenario files', () => {
  const base = {
    format: 'iron-tide-scenario',
    version: 1,
    meta: { id: 'w', name: 'W', description: '', author: '', created: '2026-01-01', targetSize: 'small' as const },
    width: 16,
    height: 16,
    tiles: new Array(256).fill({ t: 0, e: 1, o: 0 }),
    players: [
      { id: 0, name: 'A', factionId: 'baltic', team: 0, isAI: false, startX: 2, startZ: 2 },
      { id: 1, name: 'B', factionId: 'expeditionary', team: 1, isAI: true, startX: 13, startZ: 13 },
    ],
    structures: [],
    units: [],
    objectives: [],
  };

  it('round-trips every authored kind', () => {
    for (const kind of WEATHER_KINDS) {
      const scenario = parseScenario({ ...base, settings: { weather: kind } });
      expect(scenario.settings.weather).toBe(kind);
    }
  });

  it('rejects an unknown kind instead of quietly clearing the sky', () => {
    expect(() => parseScenario({ ...base, settings: { weather: 'hail' } })).toThrow(/settings\.weather/);
  });
});

describe('weather in the simulation', () => {
  it('hides a unit that a clear day reveals', () => {
    const clear = arena('clear');
    clear.settings.fog = true;
    clear.units.push(
      { defId: 'rifle', owner: 0, x: 10, z: 10 },
      { defId: 'tank', owner: 1, x: 15, z: 10 },
    );
    const byDay = new Game(clear, { enableAI: false });
    const seen = byDay.state.entities.find((e) => e.defId === 'tank')!;
    expect(byDay.isVisibleTo(0, seen.id)).toBe(true);

    const storm = arena('storm');
    storm.settings.fog = true;
    storm.units.push(
      { defId: 'rifle', owner: 0, x: 10, z: 10 },
      { defId: 'tank', owner: 1, x: 15, z: 10 },
    );
    const byStorm = new Game(storm, { enableAI: false });
    const hidden = byStorm.state.entities.find((e) => e.defId === 'tank')!;
    expect(byStorm.isVisibleTo(0, hidden.id)).toBe(false);
  });

  it('shortens practical engagement range below the gun\'s physical range', () => {
    function duel(weather: string) {
      const scenario = arena(weather);
      scenario.units.push(
        { defId: 'rifle', owner: 0, x: 20, z: 24 },
        { defId: 'rifle', owner: 1, x: 25.5, z: 24 },
      );
      const game = new Game(scenario, { enableAI: false });
      const attacker = game.state.entities.find((e) => e.defId === 'rifle' && e.owner === 0)!;
      const target = game.state.entities.find((e) => e.defId === 'rifle' && e.owner === 1)!;
      game.enqueueCommand({ type: 'attack', team: 0, ids: [attacker.id], targetId: target.id });
      game.advance(20 * 300);
      return attacker.cooldown > 0;
    }
    // Five and a half tiles is inside the rifle's range; a storm cuts what the
    // crew can identify to about four, so the shot is never taken.
    expect(duel('clear')).toBe(true);
    expect(duel('storm')).toBe(false);
  });

  it('slows a hull on soft ground without ever stopping it', () => {
    function travel(weather: string) {
      const scenario = arena(weather);
      scenario.units.push({ defId: 'tank', owner: 0, x: 8, z: 24 });
      const game = new Game(scenario, { enableAI: false });
      const tank = game.state.entities.find((e) => e.defId === 'tank')!;
      game.enqueueCommand({ type: 'move', team: 0, ids: [tank.id], x: 40 * TILE_SIZE, z: 24 * TILE_SIZE });
      game.advance(120);
      return tank.x;
    }
    const dry = travel('clear');
    const snow = travel('snow');
    expect(snow).toBeLessThan(dry);
    // Slower is not stuck: the hull still made ground.
    expect(snow).toBeGreaterThan(8 * TILE_SIZE);
  });

  it('stays deterministic: weather needs no part of the match stream', () => {
    const build = () => {
      const scenario = arena('snow', 22);
      scenario.units.push(
        { defId: 'tank', owner: 0, x: 20, z: 24 },
        { defId: 'tank', owner: 1, x: 26, z: 24 },
        { defId: 'recon', owner: 0, x: 22, z: 20 },
      );
      const game = new Game(scenario, { enableAI: false });
      game.enqueueCommand({ type: 'move', team: 0, ids: [], x: 26 * TILE_SIZE, z: 24 * TILE_SIZE });
      return game;
    };
    const a = build();
    const b = build();
    for (let i = 0; i < 300; i++) {
      a.tick();
      b.tick();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(a.weather.kind).toBe('snow');
  });
});

describe('weather and time of day in the authoring tools', () => {
  it('shows the authored hour in the forge rather than a frozen default', () => {
    // The forge renders through the real pipeline with no Game, so the renderer
    // has to derive the clock from the scenario or the time control is inert.
    expect(rendererSource).toContain('private previewDayNight()');
    expect(rendererSource).toContain('else this.dayNight = this.previewDayNight();');
    expect(rendererSource).toContain('settings.startHour');
  });

  it('drives the forge time control from the authoritative hour', () => {
    // Writing only the legacy phase label left `startHour` — the value the
    // simulation actually reads — untouched.
    expect(editorSource).toContain("id=\"ed-tod\"");
    expect(editorSource).toContain('this.scenario.settings.startHour = hour;');
    expect(editorSource).toContain('this.scenario.settings.timeOfDay = phaseForStartHour(hour);');
    expect(editorSource).toContain("id=\"ed-daylen\"");
    expect(editorSource).toContain('WEATHER_KINDS.map');
  });

  it('renders precipitation for the authored weather', () => {
    expect(rendererSource).toContain('private emitWeather(');
    expect(rendererSource).toContain('this.particles.precipitation(');
    expect(rendererSource).toContain('this.scenario.settings.weather');
  });

  it('lets a skirmish choose its own weather', () => {
    const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    // The picker is built from the catalogue, and the choice reaches the
    // scenario the battle is actually fought on — not only the setup screen.
    expect(appSource).toContain('private buildWeatherSelector()');
    expect(appSource).toContain('for (const kind of WEATHER_KINDS)');
    expect(appSource).toContain('scenario.settings.weather = this.settings.weather;');
    expect(appSource).toContain("'brief-weather'");
    expect(appSource).toContain('weather: normaliseWeather(parsed.weather)');
  });
});

describe('storm presentation', () => {
  it('stretches rain along its fall direction, not across the screen', () => {
    const system = new ParticleSystem();
    for (let i = 0; i < 40; i++) system.precipitation(10, 10, [2.8, -0.9], true, 1);
    expect(system.particles).toHaveLength(40);
    for (const drop of system.particles) {
      expect(drop.stretch).toBeGreaterThan(4);
      const dir = drop.dir!;
      // Falling, not drifting: the streak axis points down and is normalised.
      expect(dir[1]).toBeLessThan(-0.9);
      expect(Math.hypot(dir[0], dir[1], dir[2])).toBeCloseTo(1, 5);
    }
    // The quad is laid along that world axis; billboarding the stretch on the
    // camera's right vector is what drew horizontal lines.
    expect(PARTICLE_VS).toContain('iDir');
    expect(PARTICLE_VS).toContain('cross(axis, uForward)');
  });

  it('moves foliage in the wind and leaves rigid props alone', () => {
    expect(PROP_VS).toContain('uWind');
    expect(PROP_VS).toContain('abs(aMaterial -');
  });

  it('dims a storm and schedules lightning for it', () => {
    expect(WEATHER.clear.dim).toBe(0);
    expect(WEATHER.storm.dim).toBeGreaterThan(WEATHER.rain.dim);
    expect(WEATHER.storm.precipitation).toBeGreaterThan(WEATHER.rain.precipitation);
    expect(WEATHER.blizzard.precipitation).toBeGreaterThan(WEATHER.snow.precipitation);
    expect(rendererSource).toContain('private updateStorm()');
    expect(rendererSource).toContain('private applyFlash()');
    expect(rendererSource).toContain("this.weather.kind !== 'storm'");
  });

  it('flashes the cloud as well as striking the ground', () => {
    // A close bolt and a distant sheet flash are separate channels: the sheet
    // lifts the sky, the bolt lifts the battlefield, and only the bolt shakes.
    expect(rendererSource).toContain('private sheet = 0');
    expect(rendererSource).toContain('this.nextSheetAt');
    const flash = rendererSource.slice(
      rendererSource.indexOf('private applyFlash'),
      rendererSource.indexOf('private previewDayNight'),
    );
    expect(flash).toContain('const s = this.sheet');
    expect(flash).toContain('s * 0.85');
  });

  it('paints wet ground from the weather profile', () => {
    expect(TERRAIN_FS).toContain('uniform float uWet');
    expect(TERRAIN_FS).toContain('float puddle');
    expect(rendererSource).toContain('this.weather.wet');
  });

  it('drives a heavier fall from a heavier profile', () => {
    const drizzle: number[] = [];
    const downpour: number[] = [];
    const probe = (out: number[], strength: number) => {
      const system = new ParticleSystem();
      for (let i = 0; i < 30; i++) system.precipitation(10, 10, [3.2, -1.1], true, strength);
      for (const drop of system.particles) {
        out.push(drop.alpha, drop.stretch ?? 0, Math.abs(drop.vy));
      }
    };
    probe(drizzle, 1);
    probe(downpour, 2);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    // A storm is not just more drops: each one is faster and reads heavier.
    expect(mean(downpour)).toBeGreaterThan(mean(drizzle));
    expect(Math.max(...downpour)).toBeGreaterThan(Math.max(...drizzle));
  });
});
