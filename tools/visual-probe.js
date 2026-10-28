/**
 * Deterministic Kestrel Bay capture probe (dev server only).
 *
 * The renderer has no headless path and the shell has no fixed capture route,
 * so a visual phase needs a repeatable way to put the shipped scene into one
 * known frame. This module encodes that recipe; it never runs in the game.
 *
 *   npm run dev
 *   open http://127.0.0.1:5173/, wait for the menu
 *   await (await import('/tools/visual-probe.js')).captureKestrel()
 *   screenshot the tab (HUD and overlay are hidden; simulation and visual
 *   clock are frozen at tick 0)
 *
 * The returned object is the scene baseline: frame and DPR, camera, entity
 * count, draw calls, triangles, CPU submission time and fog coverage. Capture
 * the opening frame this way after every renderer change and compare.
 */

const TILE_SIZE = 4;

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.visibility = 'hidden';
}

function fogCoverage(game, camera) {
  const view = camera.viewRect();
  const width = game.state.scenario.width;
  const height = game.state.scenario.height;
  const x0 = Math.max(0, Math.floor(view.x0 / TILE_SIZE));
  const x1 = Math.min(width - 1, Math.ceil(view.x1 / TILE_SIZE));
  const z0 = Math.max(0, Math.floor(view.z0 / TILE_SIZE));
  const z1 = Math.min(height - 1, Math.ceil(view.z1 / TILE_SIZE));
  let visible = 0;
  let charted = 0;
  let hidden = 0;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const fog = game.fogAt(0, x, z);
      if (fog === 2) visible++;
      else if (fog === 1) charted++;
      else hidden++;
    }
  }
  return { visible, charted, hidden, tiles: visible + charted + hidden };
}

export function measureFrame(gl, renderer, drawCalls) {
  const names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'];
  const saved = {};
  const stats = { drawCalls: 0, triangles: 0, lines: 0 };
  for (const name of names) {
    if (!gl[name]) continue;
    saved[name] = gl[name].bind(gl);
    gl[name] = (...args) => {
      const mode = args[0];
      const count = name.startsWith('drawElements') ? args[1] : args[2];
      const instances = name.endsWith('Instanced') ? args[4] ?? 1 : 1;
      stats.drawCalls++;
      if (mode === gl.TRIANGLES) stats.triangles += (count / 3) * instances;
      else if (mode === gl.LINES) stats.lines += (count / 2) * instances;
      return saved[name](...args);
    };
  }
  // Warm the draw path first: the first frames after a reload still create
  // textures and compile draw state, and would otherwise dominate the mean.
  for (let i = 0; i < 5; i++) renderer.render();
  gl.finish();
  // Submission time is measured before the flush: gl.finish waits for the GPU
  // and would report frame completion, not the CPU cost of issuing the frame.
  const start = performance.now();
  for (let i = 0; i < drawCalls; i++) renderer.render();
  const cpuRenderMs = (performance.now() - start) / drawCalls;
  gl.finish();
  stats.drawCalls = 0;
  stats.triangles = 0;
  stats.lines = 0;
  renderer.render();
  gl.finish();
  for (const name of names) {
    if (saved[name]) gl[name] = saved[name];
  }
  return { ...stats, triangles: Math.round(stats.triangles), cpuRenderMs: Math.round(cpuRenderMs * 100) / 100 };
}

/**
 * Start the shipped Kestrel Bay skirmish, freeze it on its first tick and frame
 * the player's base with the HUD out of the way.
 */
export async function captureKestrel(options = {}) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');

  document.documentElement.classList.remove('booting');
  const intro = document.getElementById('intro-screen');
  if (intro) intro.classList.add('hidden');

  app.settings.mapId = options.mapId ?? 'island-assault';
  app.settings.nationId = options.nationId ?? 'baltic';
  app.settings.fogVisual = options.fog ?? true;
  app.settings.effects = true;
  app.renderer.settings.showFog = options.fog ?? true;
  app.renderer.settings.effects = true;

  // Hold the frame loop before the battle starts: a page that is already in a
  // match would otherwise tick the new game while the loading screen waits.
  app.speed = 0;
  await app.startBattle(app.deployScenario());
  // Simulation frozen on tick 0; the pause dialog belongs to the player UI.
  app.paused = false;
  app.speed = 0;
  const pause = document.getElementById('pause-screen');
  if (pause) pause.classList.add('hidden');
  hide('hud-root');
  hide('overlay');

  app.resize();
  const camera = app.renderer.camera;
  camera.setScreenLift(0, 0);
  camera.setBattleZoom();
  app.frameBattleCamera();

  // Freeze the visual clock too: flags, ambient particles and easing all read
  // renderer.time or dt, and a screenshot must not depend on when it was taken.
  app.renderer.time = 0;
  const update = app.renderer.update.bind(app.renderer);
  app.renderer.update = () => update(0);
  app.renderer.render();

  const game = app.game;
  const gl = app.renderer.gl;
  const stats = measureFrame(gl, app.renderer, options.frames ?? 8);
  const hq = game.entitiesOf(0, 'building').find((b) => b.defId === 'commandPost');

  const result = {
    ready: true,
    scene: app.settings.mapId,
    tick: game.state.tick,
    stateHash: game.stateHash(),
    entities: game.state.entities.length,
    units: game.entitiesOf(0).concat(game.entitiesOf(1)).filter((e) => e.kind === 'unit').length,
    frame: {
      css: [camera.width, camera.height],
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      dpr: app.renderer.dpr,
    },
    camera: {
      cx: Math.round(camera.cx * 100) / 100,
      cz: Math.round(camera.cz * 100) / 100,
      zoom: camera.zoom,
      pitchDeg: Math.round((camera.pitch * 180) / Math.PI),
      hq: hq ? [hq.x, hq.z] : null,
    },
    fog: { ...fogCoverage(game, camera), mask: [game.state.scenario.width, game.state.scenario.height], uploadTicks: 3 },
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
    cpuRenderMs: stats.cpuRenderMs,
    fps: app.perf.fps,
    frameMs: app.perf.frameMs,
  };
  window.__capture = result;
  return result;
}

/** Re-frame the frozen scene without re-measuring, for a second screenshot. */
export function frameCamera(x, z) {
  const app = window.ironTide;
  const camera = app.renderer.camera;
  camera.setScreenLift(0, 0);
  camera.setBattleZoom();
  camera.centerOn(x, z);
  app.renderer.render();
  return { cx: camera.cx, cz: camera.cz, zoom: camera.zoom };
}
