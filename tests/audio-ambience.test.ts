import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOOP_SEAM_SECONDS,
  MAX_LOOP_SECONDS,
  loopRate,
  parseAmbienceManifest,
} from '../src/ui/ambienceSamples';
import { Camera } from '../src/render/camera';
import {
  MAX_AMBIENCE_VOICES,
  ambiencePlan,
  clampAmbiencePitch,
  driveProfile,
  framingGain,
  structureAmbience,
  unitAmbience,
  type AmbienceCandidate,
  type AmbienceKind,
} from '../src/ui/ambience';

function at(id: number, sx: number, sy = 0, kind: AmbienceKind = 'trackedHeavy', level = 1): AmbienceCandidate {
  return { id, kind, sx, sy, level };
}

const STILL = {
  domain: 'land',
  moveClass: 'tracked',
  armour: 'heavy',
  role: 'Armour',
  speed: 2.2,
  moving: false,
  harvesting: false,
  garrisoned: false,
  dived: false,
};

/** Project a world point through a real camera, the way the app does. */
function screenOf(camera: Camera, x: number, z: number): { sx: number; sy: number } {
  const p = camera.worldToScreen(x, 0, z);
  return { sx: (p.x / camera.width) * 2 - 1, sy: (p.y / camera.height) * 2 - 1 };
}

/** Four world units to a tile (sim/constants), 128-tile map. */
const TILE = 4;
const FOCUS = 64 * TILE;

function cameraAt(zoom: number): Camera {
  const camera = new Camera();
  camera.setViewport(1600, 900);
  camera.setMap(128, 128);
  camera.setZoom(zoom);
  camera.centerOn(FOCUS, FOCUS);
  return camera;
}

describe('battlefield ambience plan', () => {
  it('hears the focus loudest and falls away across the frame, in both axes', () => {
    const plan = ambiencePlan([at(1, 0), at(2, 0.6), at(3, 0, 0.6), at(4, 1.2)]);
    const byId = new Map(plan.map((voice) => [voice.id, voice]));
    expect(byId.get(1)!.gain).toBeGreaterThan(byId.get(2)!.gain);
    expect(byId.get(2)!.gain).toBeGreaterThan(byId.get(4)!.gain);
    // Up the frame is an offset too, not only left and right.
    expect(byId.get(3)!.gain).toBeLessThan(byId.get(1)!.gain);
    expect(byId.get(3)!.gain).toBeCloseTo(byId.get(2)!.gain, 6);
  });

  it('pans by screen side and dulls with distance', () => {
    const plan = ambiencePlan([at(1, 0.5), at(2, -0.5), at(3, 0.05)]);
    const byId = new Map(plan.map((voice) => [voice.id, voice]));
    expect(byId.get(1)!.pan).toBeGreaterThan(0.3);
    expect(byId.get(2)!.pan).toBeLessThan(-0.3);
    expect(byId.get(2)!.pan).toBeCloseTo(-byId.get(1)!.pan, 6);
    expect(Math.abs(byId.get(3)!.pan)).toBeLessThan(0.1);
    expect(byId.get(1)!.muffle).toBeGreaterThan(byId.get(3)!.muffle);
  });

  it('drops sources past the frame, silent sources and repeated ids', () => {
    const plan = ambiencePlan([at(1, 0.2), at(2, 4), { ...at(3, 0.1), level: 0 }, at(1, 0.4)]);
    expect(plan.map((voice) => voice.id)).toEqual([1]);
  });

  it('keeps only the nearest voices when the map is busy', () => {
    const many = Array.from({ length: 12 }, (_, index) => at(index + 1, index * 0.1));
    const plan = ambiencePlan(many);
    expect(plan).toHaveLength(MAX_AMBIENCE_VOICES);
    expect(plan[0].id).toBe(1);
    expect(plan[plan.length - 1].id).toBe(MAX_AMBIENCE_VOICES);
  });

  it('returns an empty bed instead of guessing a position', () => {
    expect(ambiencePlan([])).toEqual([]);
    expect(ambiencePlan([{ ...at(1, 0), sx: Number.NaN }])).toEqual([]);
    expect(ambiencePlan([{ ...at(1, 0), sy: Number.NaN }])).toEqual([]);
  });

  it('carries motion through the plan so the engine can shape the timbre', () => {
    const plan = ambiencePlan([
      { ...at(1, 0), motion: 1 },
      { ...at(2, 0.1), motion: 0 },
      { ...at(3, 0.2) },
      { ...at(4, 0.3), motion: 4 },
    ]);
    const byId = new Map(plan.map((voice) => [voice.id, voice]));
    expect(byId.get(1)!.motion).toBe(1);
    expect(byId.get(2)!.motion).toBe(0);
    // Absent or malformed motion still yields a usable voice.
    expect(byId.get(3)!.motion).toBe(0.5);
    expect(byId.get(4)!.motion).toBe(1);
  });

  it('scales the whole bed with the framing so a wide map is not a wall of noise', () => {
    const wide = ambiencePlan([at(1, 0)], { gainScale: framingGain(110) });
    const battle = ambiencePlan([at(1, 0)], { gainScale: framingGain(36) });
    const close = ambiencePlan([at(1, 0)], { gainScale: framingGain(14) });
    expect(battle[0].gain).toBeCloseTo(1, 5);
    expect(wide[0].gain).toBeLessThan(battle[0].gain);
    expect(close[0].gain).toBeGreaterThan(battle[0].gain);
  });

  it('clamps source pitch into a usable range', () => {
    expect(clampAmbiencePitch(undefined)).toBe(1);
    expect(clampAmbiencePitch(0.01)).toBe(0.55);
    expect(clampAmbiencePitch(9)).toBe(1.9);
    expect(clampAmbiencePitch(Number.NaN)).toBe(1);
  });
});

describe('positional projection', () => {
  it('moves a unit across the mix as the camera pans over it', () => {
    const camera = cameraAt(36);
    const unitX = FOCUS + 8 * TILE;
    const unitZ = FOCUS;
    const behind = screenOf(camera, unitX, unitZ);
    camera.panWorld(unitX - camera.cx, unitZ - camera.cz);
    const centred = screenOf(camera, unitX, unitZ);
    // Panning onto the hull brings it to the middle and makes it louder.
    expect(Math.abs(centred.sx)).toBeLessThan(Math.abs(behind.sx));
    const before = ambiencePlan([{ ...at(1, behind.sx, behind.sy), kind: 'trackedHeavy' }])[0].gain;
    const after = ambiencePlan([{ ...at(1, centred.sx, centred.sy), kind: 'trackedHeavy' }])[0].gain;
    expect(after).toBeGreaterThan(before);
  });

  it('narrows the audible area as the camera zooms in', () => {
    const wide = cameraAt(90);
    const close = cameraAt(16);
    const unitX = FOCUS + 6 * TILE;
    const unitZ = FOCUS;
    const widePoint = screenOf(wide, unitX, unitZ);
    const closePoint = screenOf(close, unitX, unitZ);
    // The same hull is further out in normalised screen space when framed close.
    expect(Math.abs(closePoint.sx)).toBeGreaterThan(Math.abs(widePoint.sx));
    expect(ambiencePlan([at(1, closePoint.sx, closePoint.sy)])[0].gain).toBeLessThan(
      ambiencePlan([at(1, widePoint.sx, widePoint.sy)])[0].gain,
    );
    // …while the friendly framing trim keeps the close view the louder one.
    expect(framingGain(16)).toBeGreaterThan(framingGain(90));
  });
});

describe('drive families', () => {
  const base = {
    domain: 'land',
    moveClass: 'tracked',
    armour: 'light',
    role: 'Armour',
    speed: 2.2,
    moving: true,
    harvesting: false,
    garrisoned: false,
    dived: false,
  };

  it('tells a scout jeep, a battle tank and a section apart', () => {
    expect(driveProfile({ ...base, moveClass: 'wheeled', speed: 3.7, role: 'Reconnaissance' })).toBe('buggy');
    expect(driveProfile({ ...base, armour: 'heavy', role: 'Armour' })).toBe('trackedHeavy');
    expect(driveProfile({ ...base, moveClass: 'foot', armour: 'infantry', speed: 1.35, role: 'Infantry' })).toBe('foot');
    // A laden wheeled hull is a truck, not a scout.
    expect(driveProfile({ ...base, moveClass: 'wheeled', speed: 2.4 })).toBe('truck');
  });

  it('gives air and sea their own voices', () => {
    expect(driveProfile({ ...base, moveClass: 'air', domain: 'air', role: 'Rotary attack' })).toBe('rotor');
    expect(driveProfile({ ...base, moveClass: 'air', domain: 'air', role: 'Air superiority' })).toBe('jet');
    expect(driveProfile({ ...base, moveClass: 'naval', domain: 'naval', role: 'Fleet escort' })).toBe('naval');
  });

  it('keeps infantry a whisper next to armour, and louder on the move', () => {
    const feet = unitAmbience({ ...base, moveClass: 'foot', armour: 'infantry' })!;
    const tank = unitAmbience({ ...base, armour: 'heavy' })!;
    const idleFeet = unitAmbience({ ...base, moveClass: 'foot', armour: 'infantry', moving: false })!;
    expect(feet.kind).toBe('foot');
    expect(tank.kind).toBe('trackedHeavy');
    expect(feet.level).toBeLessThan(tank.level / 2);
    expect(feet.level).toBeGreaterThan(idleFeet.level);
  });

  it('rolls louder and brighter with speed', () => {
    const slow = unitAmbience({ ...base, armour: 'heavy', speed: 1.5 })!;
    const fast = unitAmbience({ ...base, armour: 'heavy', speed: 5 })!;
    expect(fast.level).toBeGreaterThan(slow.level);
    expect(fast.pitch).toBeGreaterThan(slow.pitch);
    expect(fast.motion).toBeGreaterThan(slow.motion);
  });

  it('makes a parked hull a different sound from a rolling one, not a quieter copy', () => {
    for (const [moveClass, armour] of [
      ['tracked', 'heavy'],
      ['tracked', 'light'],
      ['wheeled', 'light'],
      ['foot', 'infantry'],
    ] as const) {
      const still = unitAmbience({ ...STILL, moveClass, armour, speed: moveClass === 'foot' ? 1.4 : 2.5 })!;
      const rolling = unitAmbience({ ...STILL, moveClass, armour, speed: moveClass === 'foot' ? 1.4 : 2.5, moving: true })!;
      // Motion drives the filter and the clatter on the engine side, so it has to
      // reach the plan as a real timbre step, and idle has to be well under it.
      expect(rolling.motion).toBeGreaterThan(0.5);
      expect(still.motion).toBe(0);
      expect(rolling.level).toBeGreaterThan(still.level * 1.8);
      expect(rolling.pitch).toBeGreaterThan(still.pitch);
    }
  });

  it('gives harvesters a working diesel and hides what the map hides', () => {
    expect(unitAmbience({ ...base, harvesting: true })!.kind).toBe('truck');
    expect(unitAmbience({ ...base, garrisoned: true })).toBeNull();
    expect(unitAmbience({ ...base, dived: true })).toBeNull();
    expect(unitAmbience({ ...base, speed: 0 })).toBeNull();
  });
});

describe('structure ambience', () => {
  it('makes the grid audible before the economy, and leaves guns silent', () => {
    const plant = structureAmbience({ power: 40 })!;
    const refinery = structureAmbience({ refinery: true })!;
    const factory = structureAmbience({ productionList: ['tank'] })!;
    const defence = structureAmbience({ power: -2 })!;
    expect(plant.level).toBeGreaterThan(refinery.level);
    expect(refinery.level).toBeGreaterThan(factory.level);
    expect(plant.pitch).toBeGreaterThan(1);
    expect(defence.level).toBeLessThan(factory.level);
    expect(structureAmbience({})).toBeNull();
  });
});

describe('recorded ambience manifest', () => {
  const root = new URL('../public/audio/ambience/', import.meta.url);
  const shipped = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));

  it('covers the four families that were sourced, with files that exist', () => {
    const manifest = parseAmbienceManifest(shipped);
    const kinds = manifest.loops.map((loop) => loop.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['trackedHeavy', 'trackedLight', 'truck', 'buggy', 'facility']),
    );
    for (const loop of manifest.loops) {
      expect(existsSync(new URL(loop.src, root))).toBe(true);
    }
    expect(manifest.steps).not.toBeNull();
    expect(manifest.steps!.src.length).toBeGreaterThanOrEqual(2);
    for (const step of manifest.steps!.src) {
      expect(existsSync(new URL(step, root))).toBe(true);
    }
    // The credits page names the same files, so a swapped asset cannot ship
    // without its licence line.
    const credited = new Set(manifest.credits.flatMap((credit) => credit.files));
    for (const loop of manifest.loops) expect(credited.has(loop.src)).toBe(true);
    for (const credit of manifest.credits) {
      expect(credit.licence).toContain('CC0');
      expect(credit.source).toContain('opengameart.org/content/');
    }
  });

  it('moves a recording’s rate between rest and travel, and clamps it', () => {
    const loop = { idleRate: 0.8, moveRate: 1.2 };
    expect(loopRate(loop, 0)).toBeCloseTo(0.8, 6);
    expect(loopRate(loop, 1)).toBeCloseTo(1.2, 6);
    // Half travel is halfway between the two ends, not a curve.
    expect(loopRate(loop, 0.5)).toBeCloseTo(1, 6);
    expect(loopRate(loop, 0, 1.6)).toBeCloseTo(1.28, 6);
    // A wild pitch or motion cannot turn machinery into a whistle.
    expect(loopRate(loop, 4, 9)).toBeLessThanOrEqual(2.4);
    expect(loopRate(loop, -3, 0.01)).toBeGreaterThanOrEqual(0.4);
    expect(loopRate(loop, Number.NaN)).toBeCloseTo(0.8, 6);
  });

  it('drops rows it cannot play instead of failing the whole manifest', () => {
    const manifest = parseAmbienceManifest({
      loops: [
        { kind: 'tank', src: 'x.ogg' },
        { kind: 'buggy', src: '../secrets.ogg' },
        { kind: 'buggy', src: '/absolute.ogg' },
        { kind: 'truck', src: 'truck.ogg', gain: 9, idleRate: 0.1, moveRate: 12 },
        { kind: 'truck', src: 'second.ogg' },
      ],
      steps: { src: ['only-one.ogg'], strideSeconds: 0.4 },
      credits: [{ title: 'no source' }],
    });
    expect(manifest.loops.map((loop) => loop.kind)).toEqual(['truck']);
    // Outside the root is not a file the bed may fetch.
    expect(manifest.loops[0].src).toBe('truck.ogg');
    // Ranges are clamped, not trusted.
    expect(manifest.loops[0].gain).toBe(2);
    expect(manifest.loops[0].idleRate).toBe(0.4);
    expect(manifest.loops[0].moveRate).toBe(2.4);
    // One footfall is a click, not a march.
    expect(manifest.steps).toBeNull();
    expect(manifest.credits).toHaveLength(0);
    expect(parseAmbienceManifest(null).loops).toHaveLength(0);
  });

  it('keeps the loop window short enough to hold in memory', () => {
    expect(MAX_LOOP_SECONDS).toBeLessThanOrEqual(15);
    expect(LOOP_SEAM_SECONDS).toBeGreaterThan(0.01);
  });
});
