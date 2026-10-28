/**
 * Deterministic single-unit showroom for the Phase 5 readability pack.
 *
 * Dev-server only; no game module imports this. It places one unit on clear
 * Kestrel Bay grass and frames it at the real battle camera or a stated close
 * inspection zoom. Captures are cropped at 1:1 device pixels: nothing is
 * enlarged, and the crop only removes empty battlefield around the sample.
 *
 *   node tools/readability-capture.cjs   # local PNG sink on :8792
 *   await (await import('/tools/readability-probe.js')).showSample('rifle')
 *   await ...saveSample('primary-a', { width: 640, height: 360 })
 */

const TILE = 4;
const CAPTURE_ORIGIN = 'http://127.0.0.1:8792';

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.visibility = 'hidden';
}

function clearArea(scenario, buildings) {
  const blocked = new Set();
  for (const s of scenario.structures) {
    const def = buildings[s.defId];
    for (let dz = 0; dz < def.footprint.h; dz++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        blocked.add(`${s.x + dx},${s.z + dz}`);
      }
    }
  }
  for (let z = 2; z <= scenario.height - 12; z++) {
    for (let x = 2; x <= scenario.width - 16; x++) {
      let ok = true;
      for (let dz = 0; dz < 10 && ok; dz++) {
        for (let dx = 0; dx < 14; dx++) {
          const tile = scenario.tiles[(z + dz) * scenario.width + x + dx];
          if (tile.t !== 3 || tile.o > 0 || blocked.has(`${x + dx},${z + dz}`)) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return { x, z };
    }
  }
  throw new Error('No clear grass showroom area on this scenario.');
}

/**
 * One-unit showroom. Entity positions are world units after `startBattle`;
 * scenario positions are tile coordinates.
 *
 * @param {string} defId
 * @param {{zoom?: number, facing?: number, turret?: number, select?: boolean,
 *          timeOfDay?: string, fog?: boolean}} [options]
 */
export async function showSample(defId, options = {}) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const { createIslandAssault } = await import('/src/data/scenarios.ts');
  const { BUILDINGS } = await import('/src/data/buildings.ts');

  document.documentElement.classList.remove('booting');
  const intro = document.getElementById('intro-screen');
  if (intro) intro.classList.add('hidden');

  const scenario = createIslandAssault();
  const area = clearArea(scenario, BUILDINGS);
  const unitAt = { x: area.x + 5, z: area.z + 5 };
  scenario.units = [{ defId, owner: 0, x: unitAt.x, z: unitAt.z }];
  scenario.settings.fog = false;
  scenario.settings.timeOfDay = options.timeOfDay ?? 'day';
  scenario.settings.weather = 'clear';

  app.settings.fogVisual = false;
  app.settings.effects = false;
  app.renderer.settings.showFog = options.fog ?? false;
  app.renderer.settings.effects = false;
  app.speed = 0;
  await app.startBattle(scenario);
  app.speed = 0;
  app.paused = false;
  const pause = document.getElementById('pause-screen');
  if (pause) pause.classList.add('hidden');
  hide('hud-root');
  app.resize();

  const unit = app.game.entitiesOf(0, 'unit').find((e) => e.defId === defId);
  if (!unit) throw new Error(`Probe unit ${defId} was not created.`);
  const facing = options.facing ?? 0;
  const turret = options.turret ?? facing;
  unit.facing = facing;
  unit.turretFacing = turret;
  unit.state = 'idle';
  unit.order = null;
  unit.destX = unit.x;
  unit.destZ = unit.z;

  app.selected = options.select ? [unit.id] : [];
  const camera = app.renderer.camera;
  camera.setScreenLift(0, 0);
  camera.zoom = options.zoom ?? 36;
  camera.update();
  // Entity positions are already world units; scenario positions were tiles.
  camera.centerOn(unit.x, unit.z);
  app.renderer.time = 0;
  const update = app.renderer.update.bind(app.renderer);
  app.renderer.update = () => update(0);
  app.renderer.render();
  if (app.selected.length > 0) app.overlay.draw(app);
  else app.overlay.clear();

  const result = {
    ready: true,
    defId,
    unit: {
      x: unit.x,
      z: unit.z,
      facing: unit.facing,
      turretFacing: unit.turretFacing,
    },
    camera: { cx: camera.cx, cz: camera.cz, zoom: camera.zoom, pitch: camera.pitch },
    frame: {
      css: [camera.width, camera.height],
      buffer: [app.renderer.gl.drawingBufferWidth, app.renderer.gl.drawingBufferHeight],
      dpr: app.renderer.dpr,
    },
    fog: app.renderer.settings.showFog,
    selected: [...app.selected],
  };
  window.__readabilityProbe = result;
  return result;
}

/**
 * Multiple units on one clear grass row, for relative-scale comparison.
 * `entries` is [{defId, facing?, turret?}, ...]; positions are spaced in tiles.
 */
export async function showLineup(entries, options = {}) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const { createIslandAssault } = await import('/src/data/scenarios.ts');
  const { BUILDINGS } = await import('/src/data/buildings.ts');

  document.documentElement.classList.remove('booting');
  const intro = document.getElementById('intro-screen');
  if (intro) intro.classList.add('hidden');

  const scenario = createIslandAssault();
  const area = clearArea(scenario, BUILDINGS);
  const spacing = options.spacing ?? 4;
  scenario.units = entries.map((entry, i) => ({
    defId: entry.defId,
    owner: 0,
    x: area.x + 4 + i * spacing,
    z: area.z + 5,
  }));
  scenario.settings.fog = false;
  scenario.settings.timeOfDay = options.timeOfDay ?? 'day';
  scenario.settings.weather = 'clear';

  app.settings.fogVisual = false;
  app.settings.effects = false;
  app.renderer.settings.showFog = false;
  app.renderer.settings.effects = false;
  app.speed = 0;
  await app.startBattle(scenario);
  app.speed = 0;
  app.paused = false;
  const pause = document.getElementById('pause-screen');
  if (pause) pause.classList.add('hidden');
  hide('hud-root');
  app.resize();

  const units = app.game.entitiesOf(0, 'unit');
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const entry = entries[i];
    unit.facing = entry.facing ?? 0;
    unit.turretFacing = entry.turret ?? unit.facing;
    unit.state = 'idle';
    unit.order = null;
    unit.destX = unit.x;
    unit.destZ = unit.z;
  }
  app.selected = [];
  const camera = app.renderer.camera;
  camera.setScreenLift(0, 0);
  camera.zoom = options.zoom ?? 36;
  camera.update();
  const cx = units.reduce((sum, u) => sum + u.x, 0) / Math.max(1, units.length);
  const cz = units.reduce((sum, u) => sum + u.z, 0) / Math.max(1, units.length);
  camera.centerOn(cx, cz);
  app.renderer.time = 0;
  const update = app.renderer.update.bind(app.renderer);
  app.renderer.update = () => update(0);
  app.renderer.render();
  app.overlay.clear();

  return {
    ready: true,
    entries: entries.map((entry, i) => ({ defId: entry.defId, x: units[i]?.x, z: units[i]?.z })),
    camera: { cx: camera.cx, cz: camera.cz, zoom: camera.zoom, width: camera.width, height: camera.height },
    frame: {
      buffer: [app.renderer.gl.drawingBufferWidth, app.renderer.gl.drawingBufferHeight],
      dpr: app.renderer.dpr,
    },
  };
}

/** Composite the full WebGL frame and the optional DOM overlay into a canvas. */
function composite(includeOverlay) {
  const app = window.ironTide;
  const gl = app.renderer.gl;
  const overlay = document.getElementById('overlay');
  app.renderer.render();
  if (includeOverlay) {
    if (app.selected.length > 0) app.overlay.draw(app);
    else app.overlay.clear();
  }
  const canvas = document.createElement('canvas');
  canvas.width = gl.drawingBufferWidth;
  canvas.height = gl.drawingBufferHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(gl.canvas, 0, 0);
  if (includeOverlay) ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** Crop the current frame at 1:1 device pixels. Returns a PNG data URL. */
export function crop(includeOverlay = false, width = 640, height = 360) {
  const { canvas } = composite(includeOverlay);
  const x = Math.max(0, Math.floor((canvas.width - width) / 2));
  const y = Math.max(0, Math.floor((canvas.height - height) / 2));
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return { data: out.toDataURL('image/png'), source: [canvas.width, canvas.height], crop: [x, y, width, height] };
}

/** Save the current 1:1 crop through the local dev-only capture sink. */
export async function saveSample(name, options = {}) {
  const shot = crop(options.overlay ?? false, options.width ?? 640, options.height ?? 360);
  const res = await fetch(`${CAPTURE_ORIGIN}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data: shot.data }),
  });
  if (!res.ok) throw new Error(`Capture sink refused ${name}: ${res.status}`);
  const written = await res.json();
  return { ...written, source: shot.source, crop: shot.crop, probe: window.__readabilityProbe };
}
