/**
 * Deterministic material showroom (dev server only).
 *
 * The ordinary opening frame is a good regression baseline, but it does not
 * put a building, a vehicle, a road, ridge rock and the coast in one view. This
 * tool places the representative assets on the authored Kestrel coast and
 * freezes the same scene at battle and close zoom. It is audit tooling: no
 * game module imports it.
 *
 *   npm run dev
 *   await (await import('/tools/material-audit.js')).showMaterialScene()
 *   await (await import('/tools/material-audit.js')).capture('mat-after')
 */

const TILE = 4;

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.visibility = 'hidden';
}

async function prepare() {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const { createIslandAssault } = await import('/src/data/scenarios.ts');
  const { validateScenario } = await import('/src/sim/scenario.ts');
  const scenario = createIslandAssault();

  // A narrow beach, a road bend and the western ridge edge are all within one
  // battle-zoom frame here. Moving the player's existing command post rather
  // than adding a second keeps the scenario inside its two-HQ contract.
  scenario.structures = scenario.structures.filter(
    (s) => !(s.defId === 'commandPost' && s.owner === 0),
  );
  scenario.structures.push({ defId: 'commandPost', owner: 0, x: 64, z: 8 });
  scenario.units.push(
    { defId: 'tank', owner: 0, x: 61, z: 12 },
    { defId: 'rifle', owner: 0, x: 60, z: 13 },
    { defId: 'atgm', owner: 0, x: 66, z: 14 },
  );
  const issues = validateScenario(scenario).filter((i) => i.severity === 'error');
  if (issues.length > 0) throw new Error(`Material showroom scenario is invalid: ${issues[0].message}`);
  scenario.settings.fog = false;
  scenario.settings.timeOfDay = 'day';
  scenario.settings.weather = 'clear';

  document.documentElement.classList.remove('booting');
  const intro = document.getElementById('intro-screen');
  if (intro) intro.classList.add('hidden');
  const pause = document.getElementById('pause-screen');
  if (pause) pause.classList.add('hidden');
  hide('hud-root');
  hide('overlay');

  app.settings.mapId = 'island-assault';
  app.settings.fogVisual = false;
  app.settings.effects = false;
  app.renderer.settings.showFog = false;
  app.renderer.settings.effects = false;
  app.speed = 0;
  await app.startBattle(scenario);
  app.speed = 0;
  app.paused = false;
  app.resize();

  const camera = app.renderer.camera;
  camera.setScreenLift(0, 0);
  camera.zoom = 30;
  camera.update();
  camera.centerOn(66 * TILE, 11.5 * TILE);
  app.renderer.time = 0;
  const update = app.renderer.update.bind(app.renderer);
  app.renderer.update = () => update(0);
  app.renderer.render();
  app.overlay.clear();
  window.__materialScene = {
    ready: true,
    tick: app.game.state.tick,
    stateHash: app.game.stateHash(),
    entities: app.game.state.entities.length,
    camera: { cx: camera.cx, cz: camera.cz, zoom: camera.zoom, pitchDeg: Math.round((camera.pitch * 180) / Math.PI) },
    frame: { css: [camera.width, camera.height], buffer: [app.renderer.gl.drawingBufferWidth, app.renderer.gl.drawingBufferHeight] },
  };
  return window.__materialScene;
}

/** Move the frozen showroom camera without restarting the scenario. */
export function frame(zoom = 30, cx = 66 * TILE, cz = 11.5 * TILE) {
  const app = window.ironTide;
  const camera = app.renderer.camera;
  camera.zoom = zoom;
  camera.update();
  camera.centerOn(cx, cz);
  app.renderer.render();
  app.overlay.clear();
  return { cx: camera.cx, cz: camera.cz, zoom: camera.zoom };
}

/** Save the current native frame through the loopback audit sink. */
export async function capture(name, includeOverlay = false) {
  const { saveFrame } = await import('/tools/building-audit.js');
  return saveFrame(`${name}.png`, includeOverlay);
}

/** Save a 1:1 centre crop for close material inspection. */
export async function centreCrop(name, width = 760, height = 560) {
  const { saveCentreCrop } = await import('/tools/building-audit.js');
  return saveCentreCrop(`${name}.png`, width, height, false);
}

export async function showMaterialScene() {
  await prepare();
  return window.__materialScene;
}
