import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import {
  DEFAULT_DAY_LENGTH_MINUTES,
  NIGHT_LIGHT_FLOOR,
  PHASE_START_HOURS,
  configFromPhase,
  darknessAtLight,
  dayNightAt,
  formatHour,
  lightAtHour,
  phaseAtHour,
  phaseForStartHour,
} from '../src/sim/dayNight';
import {
  MIN_ENGAGEMENT_FACTOR,
  MIN_NIGHT_DETECTION,
  acquireTicksFor,
  accuracyFactor,
  engagementFactor,
  sensorFor,
  visionFactor,
} from '../src/sim/sensors';
import { illuminationAt } from '../src/sim/illumination';
import { dist } from '../src/core/math';
import { TILE_SIZE } from '../src/sim/constants';
import {
  ORE_LIGHT_LIMIT,
  buildLightView,
  oreGlowLights,
  poweredWindowGlow,
  structureWindowGlow,
  windowGlow,
} from '../src/render/lightView';
import { headlampAnchor } from '../src/render/lightAnchors';
import { DECAL_FS, MESH_FS, PROP_FS, TERRAIN_FS } from '../src/render/shaders';
import { readFileSync } from 'node:fs';
import { unitVisualScale } from '../src/render/unitMeshes';
import type { Entity } from '../src/sim/types';
import { parseScenario, phaseSettings } from '../src/sim/scenario';

/**
 * Day/night warfare.
 *
 * The clock is authoritative and pure; the tactical layer is a function of the
 * light it produces. These checks pin both, and pin the one property the rest of
 * the game depends on: a daylight battle behaves exactly as it did before the
 * clock existed.
 */

const rendererSource = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

const DAY: Parameters<typeof dayNightAt>[1] = { startHour: 12, dayLengthMinutes: 240 };
const NIGHT: Parameters<typeof dayNightAt>[1] = { startHour: 22, dayLengthMinutes: 240 };

function arena(startHour: number) {
  const scenario = createEmptyScenario(48, 48);
  scenario.settings.fog = false;
  scenario.settings.startHour = startHour;
  scenario.settings.dayLengthMinutes = 240;
  return scenario;
}

describe('authoritative day/night clock', () => {
  it('is a pure function of the tick and the authored start', () => {
    const a = dayNightAt(1200, DAY);
    const b = dayNightAt(1200, { ...DAY });
    expect(b).toEqual(a);
    // Ten real seconds at the default cycle is a small but real advance.
    expect(dayNightAt(1400, DAY).hour).toBeGreaterThan(a.hour);
    expect(dayNightAt(0, DAY).hour).toBe(12);
  });

  it('freezes at the authored hour when the cycle is zero', () => {
    const frozen = { startHour: 22, dayLengthMinutes: 0 };
    for (const tick of [0, 1, 600, 6000]) {
      const state = dayNightAt(tick, frozen);
      expect(state.hour).toBe(22);
      expect(state.frozen).toBe(true);
      expect(state.phase).toBe('night');
    }
  });

  it('wraps a whole cycle back to the start hour and counts the days', () => {
    const ticksPerDay = 240 * 60 * 20; // day length in minutes -> seconds -> ticks
    const state = dayNightAt(ticksPerDay, DAY);
    expect(state.day).toBe(1);
    expect(state.hour).toBeCloseTo(12, 5);
    expect(state.light).toBeCloseTo(1, 5);
  });

  it('runs day, dusk and night in order and never goes pitch black', () => {
    expect(lightAtHour(12)).toBe(1);
    expect(lightAtHour(18)).toBeLessThan(1);
    expect(lightAtHour(18)).toBeGreaterThan(lightAtHour(20));
    expect(lightAtHour(20)).toBeGreaterThanOrEqual(NIGHT_LIGHT_FLOOR);
    expect(lightAtHour(22)).toBe(NIGHT_LIGHT_FLOOR);
    expect(lightAtHour(5)).toBeGreaterThan(NIGHT_LIGHT_FLOOR);
    expect(phaseAtHour(12)).toBe('day');
    expect(phaseAtHour(18)).toBe('dusk');
    expect(phaseAtHour(22)).toBe('night');
    expect(formatHour(18.5)).toBe('18:30');
    expect(phaseForStartHour(PHASE_START_HOURS.day)).toBe('day');
  });

  it('reads a legacy phase label as an authored start hour', () => {
    expect(configFromPhase('night').startHour).toBe(PHASE_START_HOURS.night);
    expect(phaseSettings('dawn').startHour).toBe(PHASE_START_HOURS.dawn);
    const legacy = parseScenario({
      format: 'iron-tide-scenario',
      version: 1,
      meta: { id: 'legacy', name: 'Legacy', description: '', author: '', created: '2026-01-01', targetSize: 'small' },
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
      settings: { timeOfDay: 'night' },
    });
    expect(legacy.settings.startHour).toBe(PHASE_START_HOURS.night);
    expect(legacy.settings.dayLengthMinutes).toBe(DEFAULT_DAY_LENGTH_MINUTES);
  });
});

describe('night sensor model', () => {
  it('leaves daylight, dawn and dusk completely untouched', () => {
    // Darkness only starts once the light falls below the night threshold, so a
    // dusk-authored scenario keeps the balance it was tuned with.
    for (const hour of [8, 12, 16, 18]) {
      const state = dayNightAt(0, { startHour: hour, dayLengthMinutes: 0 });
      expect(state.darkness).toBe(0);
    }
    const dusk = dayNightAt(0, { startHour: 18, dayLengthMinutes: 0 });
    expect(dusk.darkness).toBe(0);
    const rifle = sensorFor({ kind: 'unit', defId: 'rifle' });
    const tank = sensorFor({ kind: 'unit', defId: 'tank' });
    expect(visionFactor(rifle, dusk)).toBe(1);
    expect(engagementFactor(rifle, dusk)).toBe(1);
    expect(accuracyFactor(rifle, dusk)).toBe(1);
    expect(acquireTicksFor(rifle, dusk)).toBe(0);
    expect(acquireTicksFor(tank, dusk)).toBe(0);
  });

  it('rates darkness from the ambient light rather than the clock label', () => {
    expect(darknessAtLight(1)).toBe(0);
    expect(darknessAtLight(0.5)).toBe(0);
    expect(darknessAtLight(0.25)).toBeCloseTo(0.5, 6);
    expect(darknessAtLight(0)).toBe(1);
  });

  it('favours crews with night equipment at full darkness', () => {
    const night = dayNightAt(0, NIGHT);
    expect(night.darkness).toBeGreaterThan(0.85);
    expect(night.darkness).toBeCloseTo(1 - NIGHT_LIGHT_FLOOR / 0.5, 6);
    const rifle = sensorFor({ kind: 'unit', defId: 'rifle' });
    const tank = sensorFor({ kind: 'unit', defId: 'tank' });
    const recon = sensorFor({ kind: 'unit', defId: 'recon' });

    expect(engagementFactor(rifle, night)).toBeLessThan(engagementFactor(tank, night));
    expect(visionFactor(rifle, night)).toBeLessThan(visionFactor(recon, night));
    expect(acquireTicksFor(rifle, night)).toBeGreaterThan(acquireTicksFor(tank, night));
    expect(accuracyFactor(rifle, night)).toBeLessThan(accuracyFactor(tank, night));

    // Floors: darkness degrades a unit, it never disarms it.
    expect(engagementFactor(rifle, night)).toBeGreaterThanOrEqual(MIN_ENGAGEMENT_FACTOR);
    expect(visionFactor(rifle, night)).toBeGreaterThanOrEqual(MIN_NIGHT_DETECTION);
    expect(accuracyFactor(rifle, night)).toBeGreaterThan(0.8);
  });
});

describe('night combat in the simulation', () => {
  function duel(startHour: number) {
    const scenario = arena(startHour);
    // A match with no headquarters is decided on the first tick, and the
    // simulation stops before anything can move. The duel needs a real match.
    scenario.structures.push(
      { defId: 'commandPost', owner: 0, x: 6, z: 40 },
      { defId: 'commandPost', owner: 1, x: 40, z: 6 },
    );
    scenario.units.push(
      { defId: 'rifle', owner: 0, x: 20, z: 24 },
      { defId: 'rifle', owner: 1, x: 25.5, z: 24 },
    );
    const game = new Game(scenario, { enableAI: false });
    const attacker = game.state.entities.find((e) => e.defId === 'rifle' && e.owner === 0)!;
    const target = game.state.entities.find((e) => e.defId === 'rifle' && e.owner === 1)!;
    const standoff = dist(attacker.x, attacker.z, target.x, target.z);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [attacker.id], targetId: target.id });
    let firstShot = -1;
    let closest = Infinity;
    for (let i = 0; i < 20 * 40 && firstShot < 0; i++) {
      game.tick();
      if (attacker.cooldown > 0) firstShot = game.state.tick;
      closest = Math.min(closest, dist(attacker.x, attacker.z, target.x, target.z));
    }
    return { firstShot, closed: closest < standoff - 0.5, game };
  }

  it('opens fire from the standing start by day and closes the gap at night', () => {
    // Five and a half tiles is inside the rifle's six-tile range, so daylight
    // needs no approach at all.
    const day = duel(12);
    expect(day.firstShot).toBe(1);
    expect(day.closed).toBe(false);

    // Darkness shrinks what the crew can identify to about four tiles. The order
    // is not refused and the crew does not sit at the edge of its barrel range:
    // it drives into the range it can actually engage at and then fires.
    const night = duel(22);
    expect(night.firstShot).toBeGreaterThan(day.firstShot);
    expect(night.closed).toBe(true);
    expect(night.game.state.smoke).toHaveLength(0);
  });

  it('hides a unit at night that daylight reveals', () => {
    const scenario = arena(12);
    scenario.settings.fog = true;
    scenario.units.push(
      { defId: 'rifle', owner: 0, x: 10, z: 10 },
      { defId: 'tank', owner: 1, x: 15, z: 10 },
    );
    const byDay = new Game(scenario, { enableAI: false });
    const enemy = byDay.state.entities.find((e) => e.defId === 'tank')!;
    expect(byDay.isVisibleTo(0, enemy.id)).toBe(true);

    const night = arena(22);
    night.settings.fog = true;
    night.units.push(
      { defId: 'rifle', owner: 0, x: 10, z: 10 },
      { defId: 'tank', owner: 1, x: 15, z: 10 },
    );
    const byNight = new Game(night, { enableAI: false });
    const hidden = byNight.state.entities.find((e) => e.defId === 'tank')!;
    expect(byNight.isVisibleTo(0, hidden.id)).toBe(false);
  });

  it('stays deterministic across peers at night', () => {
    const build = () => {
      const scenario = arena(22);
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
    expect(a.dayNight).toEqual(b.dayNight);
  });
});

describe('battlefield lighting', () => {
  function base(startHour: number) {
    const scenario = arena(startHour);
    scenario.structures.push({ defId: 'commandPost', owner: 0, x: 20, z: 24 });
    return new Game(scenario, { enableAI: false });
  }

  it('keeps the field dark of artificial light in daylight', () => {
    const game = base(12);
    expect(game.lights).toHaveLength(0);
    expect(game.illumination).toBeNull();
  });

  it('lights a base at night and pools that light on the ground', () => {
    const game = base(22);
    expect(game.lights.length).toBeGreaterThan(0);
    const grid = game.illumination;
    expect(grid).not.toBeNull();
    const lit = illuminationAt(grid!, game.state.scenario.width, game.state.scenario.height, 20.5 * TILE_SIZE, 24.5 * TILE_SIZE);
    expect(lit).toBeGreaterThan(0);
    const away = illuminationAt(grid!, game.state.scenario.width, game.state.scenario.height, 2.5 * TILE_SIZE, 2.5 * TILE_SIZE);
    expect(away).toBe(0);
  });
});

describe('presentation lights', () => {
  function scene(startHour: number) {
    const scenario = arena(startHour);
    scenario.units.push(
      { defId: 'tank', owner: 0, x: 20, z: 24 },
      { defId: 'rifle', owner: 0, x: 14, z: 24 },
    );
    scenario.structures.push(
      { defId: 'commandPost', owner: 0, x: 30, z: 24 },
      { defId: 'barracks', owner: 0, x: 34, z: 30 },
    );
    return new Game(scenario, { enableAI: false });
  }

  function view(game: Game) {
    return buildLightView({
      entities: game.state.entities,
      dayNight: game.dayNight,
      bloom: 1,
      effects: true,
      powered: () => true,
      eye: [0, 60, 0],
      groundY: () => 0,
    });
  }

  function tankOf(game: Game): Entity {
    return game.state.entities.find((e) => e.defId === 'tank')!;
  }

  it('shows nothing in daylight', () => {
    const game = scene(12);
    expect(view(game)).toHaveLength(0);
  });

  it('lights a structure as a lit compound, not one blob under the roof', () => {
    const game = scene(22);
    const lights = view(game);
    const groundPools = lights.filter((l) => l.glow === 0 && l.cone === 0);
    const lampHeads = lights.filter((l) => l.glow === 1);
    // Four work-lamps per structure, each with a pool and a visible lamp head.
    expect(groundPools.length).toBeGreaterThanOrEqual(8);
    expect(lampHeads.length).toBeGreaterThanOrEqual(8);
    // The pools sit off the centreline, so the apron is lit rather than the roof.
    const cp = game.state.entities.find((e) => e.defId === 'commandPost')!;
    const ring = groundPools.filter((l) => Math.hypot(l.x - cp.x, l.z - cp.z) > TILE_SIZE);
    expect(ring.length).toBeGreaterThan(0);
  });

  it('lights the model\'s own window glass rather than painting windows on it', () => {
    // The buildings already carry their glazing as glass material, so the glow
    // is shader-side: no billboard panes are emitted by the light view at all.
    const game = scene(22);
    const barracks = game.state.entities.find((e) => e.defId === 'barracks')!;
    for (const e of game.state.entities) {
      if (e.id !== barracks.id) e.hp = 0;
    }
    const glows = view(game).filter((l) => l.glow === 1);
    // Four corner lamp heads, and nothing floating over the walls.
    expect(glows.length).toBe(4);

    expect(MESH_FS).toContain('uNightGlow');
    expect(MESH_FS).toContain('materialId > 4.5 && materialId < 5.5');
    // Windows follow the owner's grid and the team's knowledge, not just the clock.
    // A collapsed shell or a wrecked body has no intact glazing to light.
    expect(rendererSource).toContain("kind === 'building' && !collapsed && damageStage < 2");
    expect(rendererSource).toContain("this.buildingWindowGlow(owner, construction, remembered)");
  });

  it('leaves a structure the team has only charted dark', () => {
    const night = windowGlow(dayNightAt(0, NIGHT), true);
    const lit = { construction: false, remembered: false, power: { demand: 5, ratio: 1 } };
    expect(structureWindowGlow(night, lit)).toBe(night);
    // No grid, no glass: an ownerless site has nothing feeding its lamps, so its
    // windows stay dark until an engineer brings it onto a grid.
    expect(structureWindowGlow(night, { ...lit, power: null })).toBe(0);
    // A memory of a compound does not include whether anyone switched the lights
    // on, so a charted building must not glow through the fog.
    expect(structureWindowGlow(night, { ...lit, remembered: true })).toBe(0);
    // Nor does a site that has not finished its shell.
    expect(structureWindowGlow(night, { ...lit, construction: true })).toBe(0);
    // Daylight has nothing to dim, whoever holds the ground.
    expect(structureWindowGlow(0, { construction: false, remembered: false, power: { demand: 5, ratio: 1 } })).toBe(0);
    // A visible structure still answers to its owner's grid.
    expect(structureWindowGlow(night, { ...lit, power: { demand: 40, ratio: 0 } })).toBe(0);
    expect(structureWindowGlow(night, { ...lit, power: { demand: 40, ratio: 0.5 } })).toBeCloseTo(night * 0.5, 6);
  });

  it('takes a structure\'s windows with its grid', () => {
    // Glazing is part of the compound's own load. By day there is nothing to
    // dim; a balanced grid or a site with no draw keeps the full glow.
    const night = windowGlow(dayNightAt(0, NIGHT), true);
    expect(poweredWindowGlow(0, { demand: 40, ratio: 0 })).toBe(0);
    expect(poweredWindowGlow(night, { demand: 0, ratio: 1 })).toBe(night);
    expect(poweredWindowGlow(night, { demand: 40, ratio: 1 })).toBe(night);
    // A partial deficit dims the windows with production.
    expect(poweredWindowGlow(night, { demand: 40, ratio: 0.5 })).toBeCloseTo(night * 0.5, 6);
    // No supply at all: the base cannot light its own glass.
    expect(poweredWindowGlow(night, { demand: 40, ratio: 0 })).toBe(0);
    // A degenerate ratio never brightens a window past its clock value.
    expect(poweredWindowGlow(night, { demand: 10, ratio: 3 })).toBe(night);
    expect(poweredWindowGlow(night, { demand: 10, ratio: Number.NaN })).toBe(night);
  });

  it('reads the deficit from the live grid', () => {
    // A barracks on its own draws power nothing supplies, so the whole base is
    // browned out and its glass is dark after all.
    const dark = arena(22);
    dark.structures.push({ defId: 'barracks', owner: 0, x: 20, z: 24 });
    const darkGame = new Game(dark, { enableAI: false });
    const status = darkGame.powerStatus(0);
    expect(status.brownout).toBe(true);
    expect(poweredWindowGlow(windowGlow(darkGame.dayNight, true), status)).toBe(0);

    // The headquarters runs its own generator; with it the same base is lit.
    const lit = arena(22);
    lit.structures.push(
      { defId: 'commandPost', owner: 0, x: 20, z: 24 },
      { defId: 'barracks', owner: 0, x: 26, z: 24 },
    );
    const litGame = new Game(lit, { enableAI: false });
    expect(litGame.powerStatus(0).brownout).toBe(false);
    expect(poweredWindowGlow(windowGlow(litGame.dayNight, true), litGame.powerStatus(0))).toBeGreaterThan(0.9);
  });

  it('raises the window glow only after dark', () => {
    expect(windowGlow(dayNightAt(0, { startHour: 12, dayLengthMinutes: 0 }), true)).toBe(0);
    expect(windowGlow(dayNightAt(0, { startHour: 18, dayLengthMinutes: 0 }), true)).toBe(0);
    const night = windowGlow(dayNightAt(0, NIGHT), true);
    expect(night).toBeGreaterThan(0.9);
    // Turning the night-light presentation off dims the windows, it does not
    // black them out: the building still reads as occupied.
    expect(windowGlow(dayNightAt(0, NIGHT), false)).toBeGreaterThan(0);
    expect(windowGlow(dayNightAt(0, NIGHT), false)).toBeLessThan(night);
  });

  it('gives a moving tank two projected headlamps and none while it is parked', () => {
    const game = scene(22);
    const tank = tankOf(game);
    expect(view(game).filter((l) => l.spot)).toHaveLength(0);

    tank.state = 'moving';
    tank.facing = 0;
    const lamps = view(game).filter((l) => l.spot);
    // Two lamps, and no beam geometry at all: the ground shader does the work.
    expect(lamps).toHaveLength(2);
    expect(lamps.every((l) => l.cone === 0)).toBe(true);

    const anchor = headlampAnchor('tank')!;
    for (const lamp of lamps) {
      const spot = lamp.spot!;
      // Aimed along the hull's facing and tilted down so the cone meets the road.
      expect(spot.dirX).toBeGreaterThan(0.95);
      expect(Math.abs(spot.dirZ)).toBeLessThan(0.05);
      expect(spot.dirY).toBeLessThan(-0.1);
      expect(Math.hypot(spot.dirX, spot.dirY, spot.dirZ)).toBeCloseTo(1, 6);
      // About three tiles of reach from a lamp mounted on the hull.
      expect(spot.range).toBeGreaterThan(10);
      expect(spot.range).toBeLessThanOrEqual(14);
      expect(lamp.y).toBeCloseTo(spot.y, 6);
      expect(Math.hypot(spot.x - tank.x, spot.z - tank.z)).toBeLessThan(
        anchor.forward + anchor.lateral + 1,
      );
    }
    // One lamp each side of the hull centre line.
    expect(Math.sign(lamps[0].z - tank.z)).toBe(-Math.sign(lamps[1].z - tank.z));

    tank.state = 'idle';
    tank.order = null;
    expect(view(game).filter((l) => l.spot)).toHaveLength(0);
  });

  it('mounts the lamps on the vehicle model rather than at a fixed offset', () => {
    const tank = headlampAnchor('tank');
    const engineer = headlampAnchor('engineer');
    expect(tank).not.toBeNull();
    expect(engineer).not.toBeNull();
    // Model space is local +X forward, so the mount is the front of each mesh.
    const tankFront = 3 * unitVisualScale('tank');
    expect(tank!.forward).toBeGreaterThan(1.2);
    expect(tank!.forward).toBeLessThan(tankFront + 2);
    expect(engineer!.forward).toBeGreaterThan(1.2);
    expect(tank!.forward).not.toBeCloseTo(engineer!.forward, 3);
    expect(tank!.lateral).toBeGreaterThan(0);
    // Bigger hulls carry their lamps higher off the ground.
    expect(headlampAnchor('recon')!.height).toBeGreaterThan(0.2);
  });

  it('puts the lamps where the drawn hull is, not where the last tick ended', () => {
    const game = scene(22);
    const tank = tankOf(game);
    tank.state = 'moving';
    tank.facing = 0;
    const anchor = headlampAnchor('tank')!;
    // A pose that lags the simulation, as the renderer's easing does while a
    // vehicle accelerates: the lights must sit on the drawn hull.
    const drawn = { x: tank.x - 6, z: tank.z + 4, facing: Math.PI / 2 };
    const lamps = buildLightView({
      entities: game.state.entities,
      dayNight: game.dayNight,
      bloom: 1,
      effects: true,
      powered: () => true,
      eye: [0, 60, 0],
      groundY: () => 0,
      pose: (e) => (e.id === tank.id ? drawn : null),
    }).filter((l) => l.spot);
    expect(lamps).toHaveLength(2);
    for (const lamp of lamps) {
      const spot = lamp.spot!;
      // Mounted on the drawn hull, one lamp either side of its nose...
      expect(Math.abs(spot.x - drawn.x)).toBeCloseTo(anchor.lateral, 6);
      expect(spot.z).toBeCloseTo(drawn.z + anchor.forward, 6);
      // ...and aimed down the drawn heading, so the light leads the hull rather
      // than trailing the simulation position.
      expect(Math.abs(spot.dirX)).toBeLessThan(0.01);
      expect(spot.dirZ).toBeGreaterThan(0.9);
    }
  });

  it('follows the hull every frame instead of the vision cadence', () => {
    const game = scene(22);
    const tank = tankOf(game);
    tank.state = 'moving';
    tank.facing = 0;
    const first = view(game).filter((l) => l.spot);
    const startX = tank.x;

    // Half a second of travel plus a turn, as the simulation would deliver it.
    tank.x += 3 * TILE_SIZE;
    tank.facing = Math.PI / 2;
    // The renderer's own pose follows the sim immediately when it is told to.
    const second = buildLightView({
      entities: game.state.entities,
      dayNight: game.dayNight,
      bloom: 1,
      effects: true,
      powered: () => true,
      eye: [0, 60, 0],
      groundY: () => 0,
      pose: (e) => (e.id === tank.id ? { x: tank.x, z: tank.z, facing: tank.facing } : null),
    }).filter((l) => l.spot);

    // Rebuilt from live state, so the cones already point down the new heading
    // instead of trailing the half-second vision refresh.
    for (const lamp of second) {
      expect(Math.abs(lamp.spot!.dirX)).toBeLessThan(0.01);
      expect(lamp.spot!.dirZ).toBeGreaterThan(0.9);
    }
    // And they moved with the hull rather than reporting the old placement.
    expect(Math.abs(second[0].spot!.x - first[0].spot!.x)).toBeGreaterThan(8);
    expect(Math.abs(first[0].spot!.x - startX)).toBeLessThan(2);
  });

  it('turns a browned-out compound dark', () => {
    const game = scene(22);
    const lights = buildLightView({
      entities: game.state.entities,
      dayNight: game.dayNight,
      bloom: 1,
      effects: true,
      powered: () => false,
      eye: [0, 60, 0],
      groundY: () => 0,
    });
    // Only the unit lights survive: no power, no structure lighting.
    expect(lights.filter((l) => l.spot)).toHaveLength(0);
    const barracks = game.state.entities.find((e) => e.defId === 'barracks')!;
    expect(lights.some((l) => Math.hypot(l.x - barracks.x, l.z - barracks.z) < 10)).toBe(false);
  });

  it('lights only what the player can see, never the fog of war', () => {
    const game = scene(22);
    const tank = tankOf(game);
    tank.state = 'moving';
    const filter = (visible: (e: Entity) => boolean) =>
      buildLightView({
        entities: game.state.entities,
        dayNight: game.dayNight,
        bloom: 1,
        effects: true,
        powered: () => true,
        eye: [0, 60, 0],
        groundY: () => 0,
        visible,
      });

    // The unfiltered view is the whole battlefield: both compounds and the tank.
    expect(view(game).length).toBeGreaterThan(8);
    // An enemy the player cannot see must not advertise itself with wall lamps
    // or headlights, so nothing at all is lit when nothing is visible.
    expect(filter(() => false)).toHaveLength(0);
    // A single visible unit lights only itself.
    const onlyTank = filter((e) => e.id === tank.id);
    // Its two projected lamps and their lens glows, nothing from the compounds.
    expect(onlyTank.filter((l) => l.spot)).toHaveLength(2);
    expect(onlyTank.every((l) => Math.hypot(l.x - tank.x, l.z - tank.z) < 20)).toBe(true);

    // The renderer feeds the local team's vision into that filter.
    expect(rendererSource).toContain("visible: (e) => game.visionStateOf(team, e.id) === 'visible'");
    expect(rendererSource).toContain('game.fogAt(');
  });

  it('lets a crystal seam glow cyan on ground the player has explored', () => {
    const eye: [number, number, number] = [40, 60, 40];
    const seam = { x: 44, y: 0, z: 40, scale: 1 };
    const unexplored = { x: 400, y: 0, z: 400, scale: 1 };

    expect(oreGlowLights([seam], 0, eye)).toHaveLength(0);
    const lights = oreGlowLights([seam, unexplored], 1, eye);
    expect(lights).toHaveLength(1);
    // Cyan: the blue channel leads and red trails.
    expect(lights[0].color[2]).toBeGreaterThan(lights[0].color[0]);
    expect(lights[0].color[1]).toBeGreaterThan(lights[0].color[0]);
    expect(lights[0].glow).toBe(0);
    expect(lights[0].intensity).toBeGreaterThan(0);

    // Fog of war applies to the seam as well.
    expect(oreGlowLights([seam], 1, eye, () => false)).toHaveLength(0);
    // A large field cannot grow the light pass without bound.
    const field = Array.from({ length: 300 }, (_, i) => ({ x: i * 0.2, y: 0, z: 0 }));
    expect(oreGlowLights(field, 1, [0, 60, 0]).length).toBeLessThanOrEqual(ORE_LIGHT_LIMIT);

    // The deposit is the one prop the shader lights from inside after dark.
    expect(PROP_FS).toContain('uGlow');
    expect(rendererSource).toContain('gl.uniform3f(p.u.uGlow, 0.16 * crystal, 0.8 * crystal, 1.0 * crystal)');
  });

  it('lays lamp light on the surface itself instead of drawing a beam', () => {
    // The beam is gone: the terrain fragment stage evaluates each lamp cone
    // against the ground it hits, so a slope cannot clip it or band it.
    expect(TERRAIN_FS).toContain('vec3 groundSpots(vec3 p, vec3 n)');
    expect(TERRAIN_FS).toContain('lit += base * groundSpots(vWorld, n);');
    expect(TERRAIN_FS).toContain('uniform vec4 uSpotSrc[GROUND_SPOT_MAX]');
    expect(rendererSource).toContain('this.bindGroundSpots(p)');
    expect(rendererSource).toContain("'uSpotSrc[0]'");
    // The cone budget is spent on the nearest lamps, not on list order: a base
    // can put more emplacements on the ground than one pass evaluates.
    expect(rendererSource).toContain('const MAX_GROUND_SPOTS = 32;');
    expect(rendererSource).toContain('this.selectGroundSpots(lights);');

    const game = scene(22);
    const tank = tankOf(game);
    tank.state = 'moving';
    tank.facing = 0;
    // A ramp under the lane: the lamp stays on the hull, and the cone's reach is
    // a property of the light rather than a quad laid at bumper height.
    const ramp = (x: number) => Math.max(0, (x - tank.x) * 0.5);
    const lamps = buildLightView({
      entities: game.state.entities,
      dayNight: game.dayNight,
      bloom: 1,
      effects: true,
      powered: () => true,
      eye: [0, 60, 0],
      groundY: ramp,
    }).filter((l) => l.spot);
    expect(lamps).toHaveLength(2);
    for (const lamp of lamps) {
      const spot = lamp.spot!;
      expect(spot.y - ramp(spot.x)).toBeGreaterThan(0.2);
      expect(spot.range).toBeGreaterThan(10);
      // Nothing is laid on the ground for the beam to intersect.
      expect(lamp.glow).toBe(1);
      expect(lamp.cone).toBe(0);
    }
  });

  it('fades lamp pools behind walls and crests with an occluder map', () => {
    // The pool is not allowed to paint through a building or over a ridge: the
    // ground-to-lamp segment is marched through a top-down depth map.
    expect(TERRAIN_FS).toContain('float lampVisibility(vec3 p, vec3 n, vec3 lamp)');
    expect(TERRAIN_FS).toContain('texture(uLampShadow, coord.xy).r');
    expect(TERRAIN_FS).toContain('visible * (0.2 + 0.8 * facing)');

    expect(rendererSource).toContain('private renderLampOccluders()');
    // Straight down over the camera footprint: stored depth is the height of
    // whatever stands at that XZ.
    expect(rendererSource).toContain('shadowLightMatrix([0, 1, 0], cx, cz, footprint + 30)');
    expect(rendererSource).toContain('this.drawShadowCasters(cx, cz, footprint);');
    // Hedgerows and large site props block a beam too; short ground cover stays
    // out of the map.
    const occluders = rendererSource.slice(
      rendererSource.indexOf('private renderLampOccluders'),
      rendererSource.indexOf('private drawTerrain'),
    );
    for (const prop of [
      'this.treesMesh.draw',
      'this.bushesMesh.draw',
      'this.shrubsMesh.draw',
      'this.rocksMesh.draw',
      'this.fencesMesh.draw',
      'this.rubbleMesh.draw',
    ]) {
      expect(occluders).toContain(prop);
    }
    expect(occluders).not.toContain('this.tuftsMesh.draw');
    expect(occluders).not.toContain('this.reedsMesh.draw');
    // Structures and terrain go into the same map, so a wall and a crest both
    // block a lamp.
    expect(rendererSource).toContain('this.terrainGpu.count');
    // Occluders must exist before the terrain pass samples the lamps.
    expect(rendererSource.indexOf('this.renderLampOccluders()')).toBeLessThan(
      rendererSource.indexOf('this.drawTerrain();'),
    );
    expect(rendererSource).toContain(
      "'uLampShadow', 'uLampVP', 'uLampTexel', 'uLampOcclusion'",
    );
    // Decals are surface marks on the same ground: a track crossing a pool is
    // lit by it instead of staying a dark band through the light.
    expect(DECAL_FS).toContain('groundSpots(vWorld, vec3(0.0, 1.0, 0.0))');
    expect(rendererSource).toContain('this.decalGpu.draw(this.camera, decals, {');
    // Every lit mesh receives the lamp cones, not only the road: a headlamp
    // that lights the deck but not the hull or the wall beside it reads as a
    // decal. The gate closes again after the entity pass.
    expect(rendererSource).toContain('gl.uniform1f(mp.u.uSpotGate ?? null, 1);');
    expect(rendererSource).toContain('gl.uniform1f(mp.u.uSpotGate ?? null, 0);');
    expect(rendererSource).not.toContain('const walkableDeck');
  });

  it('respects the instance ceiling', () => {
    const game = scene(22);
    const capped = buildLightView({
      entities: game.state.entities,
      dayNight: game.dayNight,
      bloom: 1,
      effects: true,
      powered: () => true,
      eye: [0, 60, 0],
      groundY: () => 0,
      maxLights: 5,
    });
    expect(capped.length).toBeGreaterThan(0);
    expect(capped.length).toBeLessThanOrEqual(5);
  });
});
