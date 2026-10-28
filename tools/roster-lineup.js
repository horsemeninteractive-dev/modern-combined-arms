/**
 * Deterministic roster lineup for visual review (dev server only).
 *
 * Places up to twelve units on the clear Kestrel Bay showroom grass in a
 * four-column grid, freezes the clock and frames the whole group. Nothing in
 * `src/` imports this.
 *
 *   npm run dev
 *   await (await import('/tools/roster-lineup.js')).showLineup([...])
 *   await (await import('/tools/roster-lineup.js')).capture()
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
 * @param {string[]} ids Unit definition ids.
 * @param {{zoom?: number, facing?: number, select?: boolean, enemy?: boolean}} [options]
 */
export async function showLineup(ids, options = {}) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const { createIslandAssault } = await import('/src/data/scenarios.ts');
  const { BUILDINGS } = await import('/src/data/buildings.ts');

  document.documentElement.classList.remove('booting');
  const intro = document.getElementById('intro-screen');
  if (intro) intro.classList.add('hidden');

  const scenario = createIslandAssault();
  const area = clearArea(scenario, BUILDINGS);
  const cols = 4;
  const rows = Math.ceil(ids.length / cols);
  const startX = area.x + 1;
  const startZ = area.z + 2;
  updateScenarioUnits(scenario, ids, { cols, startX, startZ, options });
  scenario.settings.fog = false;
  scenario.settings.timeOfDay = 'day';
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
  hide('overlay');
  app.resize();

  const facing = options.facing ?? 0.25;
  // Aim every spawned unit once. The scenario entries own the render transform;
  // the game entities own the animation and weapon-facing state.
  for (let i = 0; i < scenario.units.length; i++) {
    const u = scenario.units[i];
    const gameUnit = app.game.entitiesOf(u.owner, 'unit').find((e) => e.defId === u.defId);
    if (!gameUnit) continue;
    u.facing = facing;
    gameUnit.facing = facing;
    gameUnit.turretFacing = facing;
    if (gameUnit.aircraft) {
      gameUnit.aircraft.landed = false;
      const v = app.renderer.visuals?.get(gameUnit.id);
      if (v) v.emergeAlt = 1;
    }
    gameUnit.state = 'idle';
    gameUnit.order = null;
    gameUnit.destX = gameUnit.x;
    gameUnit.destZ = gameUnit.z;
  }

  app.selected = options.select ? app.game.entitiesOf(0, 'unit').map((e) => e.id) : [];
  const camera = app.renderer.camera;
  camera.setScreenLift(0, 0);
  camera.zoom = options.zoom ?? 36;
  camera.update();
  const centerX = startX + ((cols - 1) * 3) / 2;
  const centerZ = startZ + ((rows - 1) * 3) / 2;
  camera.centerOn((centerX + 0.5) * TILE, (centerZ + 0.5) * TILE);
  app.renderer.time = 0;
  const update = app.renderer.update.bind(app.renderer);
  app.renderer.update = () => update(0);
  app.renderer.render();
  if (app.selected.length > 0) app.overlay.draw(app);
  else app.overlay.clear();

  const result = {
    ready: true,
    ids,
    units: app.game.entitiesOf(0, 'unit').map((u) => ({ id: u.defId, x: u.x, z: u.z })),
    frame: {
      css: [camera.width, camera.height],
      buffer: [app.renderer.gl.drawingBufferWidth, app.renderer.gl.drawingBufferHeight],
      dpr: app.renderer.dpr,
    },
    camera: { cx: camera.cx, cz: camera.cz, zoom: camera.zoom, pitch: camera.pitch },
  };
  window.__lineup = result;
  return result;
}

function updateScenarioUnits(scenario, ids, { cols, startX, startZ, options }) {
  scenario.units = ids.map((defId, i) => ({
    defId,
    owner: options.enemy === false ? 0 : i % 2,
    x: startX + (i % cols) * 3,
    z: startZ + Math.floor(i / cols) * 3,
  }));
}

/** Composite the WebGL scene and, optionally, the selection/health overlay. */
export function capture(includeOverlay = true) {
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
  return canvas.toDataURL('image/png');
}
