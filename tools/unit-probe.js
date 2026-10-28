/**
 * Deterministic one-unit showroom for the visual slice (dev server only).
 *
 * Places one friendly and one enemy copy of a unit on clear Kestrel Bay grass,
 * freezes the clock and frames them at either close or battle zoom. The scene
 * is built from the shipped scenario and uses the real renderer; only the
 * scenario's unit list and camera are changed. Nothing in `src/` imports this.
 *
 *   npm run dev
 *   await (await import('/tools/unit-probe.js')).showUnit('rifle')
 *   await (await import('/tools/unit-probe.js')).capture()
 */

const TILE = 4;

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
 * @param {string} defId
 * @param {{zoom?: number, facing?: number, turret?: number, select?: boolean,
 *          timeOfDay?: string, fog?: boolean, enemy?: boolean}} [options]
 */
export async function showUnit(defId, options = {}) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const { createIslandAssault } = await import('/src/data/scenarios.ts');
  const { BUILDINGS } = await import('/src/data/buildings.ts');

  document.documentElement.classList.remove('booting');
  const intro = document.getElementById('intro-screen');
  if (intro) intro.classList.add('hidden');

  const scenario = createIslandAssault();
  const area = options.water ? { x: 5, z: 38 } : clearArea(scenario, BUILDINGS);
  const friendly = options.water ? { x: 9, z: 42 } : { x: area.x + 4, z: area.z + 6 };
  const enemy = options.water ? { x: 16, z: 42 } : { x: area.x + 8, z: area.z + 2 };
  scenario.units = [{ defId, owner: 0, x: friendly.x, z: friendly.z }];
  if (options.enemy !== false) {
    scenario.units.push({ defId, owner: 1, x: enemy.x, z: enemy.z });
  }
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

  const unit = (owner) =>
    app.game.entitiesOf(owner, 'unit').find((e) => e.defId === defId);
  const friendlyUnit = unit(0);
  const enemyUnit = options.enemy === false ? null : unit(1);
  const facing = options.facing ?? 0;
  const turret = options.turret ?? facing;
  for (const u of [friendlyUnit, enemyUnit]) {
    if (!u) continue;
    u.facing = facing;
    u.turretFacing = turret;
    if (u.aircraft) u.aircraft.landed = false;
    const v = app.renderer.visuals?.get(u.id);
    if (v && u.aircraft) v.emergeAlt = 1;
    u.state = 'idle';
    u.order = null;
    u.destX = u.x;
    u.destZ = u.z;
  }

  app.selected = options.select && friendlyUnit ? [friendlyUnit.id] : [];
  const camera = app.renderer.camera;
  camera.setScreenLift(0, 0);
  // The public setter clamps to the gameplay range; this dev-only showroom is
  // allowed to go closer so the silhouette can be inspected at pixel scale.
  camera.zoom = options.zoom ?? 22;
  camera.update();
  const focus = options.enemy === false ? friendly : { x: (friendly.x + enemy.x) / 2, z: (friendly.z + enemy.z) / 2 };
  camera.centerOn((focus.x + 0.5) * TILE, (focus.z + 0.5) * TILE);
  app.renderer.time = 0;
  const update = app.renderer.update.bind(app.renderer);
  app.renderer.update = () => update(0);
  app.renderer.render();
  if (app.selected.length > 0) app.overlay.draw(app);
  else app.overlay.clear();

  const result = {
    ready: true,
    defId,
    ids: [friendlyUnit?.id, enemyUnit?.id].filter(Boolean),
    unit: friendlyUnit
      ? {
          x: friendlyUnit.x,
          z: friendlyUnit.z,
          facing: friendlyUnit.facing,
          turretFacing: friendlyUnit.turretFacing,
        }
      : null,
    camera: { cx: camera.cx, cz: camera.cz, zoom: camera.zoom, pitch: camera.pitch },
    frame: {
      css: [camera.width, camera.height],
      buffer: [app.renderer.gl.drawingBufferWidth, app.renderer.gl.drawingBufferHeight],
      dpr: app.renderer.dpr,
    },
    fog: app.renderer.settings.showFog,
    selected: [...app.selected],
  };
  window.__unitProbe = result;
  return result;
}

/** Reframe the current frozen showroom without rebuilding the scene. */
export function frameUnit(x, z, zoom = 22) {
  const app = window.ironTide;
  app.renderer.camera.setScreenLift(0, 0);
  app.renderer.camera.setZoom(zoom);
  app.renderer.camera.centerOn(x, z);
  app.renderer.render();
  if (app.selected.length > 0) app.overlay.draw(app);
  else app.overlay.clear();
}

/** Composite the WebGL scene and, optionally, the selection/health overlay. */
export function capture(includeOverlay = true) {
  const app = window.ironTide;
  const gl = app.renderer.gl;
  const overlay = document.getElementById('overlay');
  // WebGL does not preserve its drawing buffer, so the frame has to be
  // submitted in the same task as drawImage.
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
  return canvas.toDataURL('image/png');
}
