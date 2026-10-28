/**
 * Deterministic building showroom and contact sheets (dev server only).
 *
 * This is audit tooling, not a game module: nothing in `src/` imports it. It
 * places authored structures on the real Kestrel Bay terrain, freezes the
 * clock, hides the HUD and frames either one building or a grid of buildings.
 *
 *   npm run dev
 *   await (await import('/tools/building-audit.js')).showBuilding('factory')
 *   await (await import('/tools/building-audit.js')).capture()
 */

const TILE = 4;

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.visibility = 'hidden';
}

/** First clear 14 x 10 grass block on the authored scenario. */
function clearArea(scenario, buildings) {
  const blocked = new Set();
  for (const s of scenario.structures) {
    const def = buildings[s.defId];
    if (!def) continue;
    for (let dz = 0; dz < def.footprint.h; dz++) {
      for (let dx = 0; dx < def.footprint.w; dx++) blocked.add(`${s.x + dx},${s.z + dz}`);
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

function preparePage(app) {
  document.documentElement.classList.remove('booting');
  const intro = document.getElementById('intro-screen');
  if (intro) intro.classList.add('hidden');
  const pause = document.getElementById('pause-screen');
  if (pause) pause.classList.add('hidden');
  hide('hud-root');
  hide('overlay');
  app.resize();
}

function freeze(app) {
  app.renderer.time = 0;
  const update = app.renderer.update.bind(app.renderer);
  app.renderer.update = () => update(0);
  app.renderer.render();
}

/**
 * Several different structures in one real battlefield frame. Unlike
 * `contactSheet`, this composes them together, so a side-by-side pair can be
 * judged at the same camera, scale and lighting. Positions are scenario tiles.
 *
 * @param {Array<{defId: string, owner?: number, x: number, z: number, facing?: number}>} items
 * @param {{zoom?: number, fog?: boolean, select?: boolean}} [options]
 */
export async function showStructures(items, options = {}) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const { createIslandAssault } = await import('/src/data/scenarios.ts');
  const { footprintCenter } = await import('/src/sim/map.ts');
  const scenario = createIslandAssault();
  scenario.structures.push(
    ...items.map((item) => ({
      defId: item.defId,
      owner: item.owner ?? 0,
      x: item.x,
      z: item.z,
      ...(item.facing === undefined ? {} : { facing: item.facing }),
    })),
  );
  scenario.settings.fog = options.fog ?? false;
  scenario.settings.timeOfDay = options.timeOfDay ?? 'day';
  scenario.settings.weather = 'clear';
  app.settings.mapId = 'island-assault';
  app.settings.fogVisual = options.fog ?? false;
  app.settings.effects = false;
  app.renderer.settings.showFog = options.fog ?? false;
  app.renderer.settings.effects = false;
  app.speed = 0;
  await app.startBattle(scenario);
  const centers = items.map((item) => footprintCenter(item.defId, item.x, item.z));
  const missing = items.filter((item) => {
    const center = footprintCenter(item.defId, item.x, item.z);
    return !app.game?.state.entities.some(
      (e) => e.kind === 'building' && e.defId === item.defId && Math.abs(e.x - center.x) < 0.01 && Math.abs(e.z - center.z) < 0.01,
    );
  });
  if (missing.length > 0) throw new Error(`Scenario did not spawn: ${missing.map((m) => m.defId).join(', ')}`);
  app.speed = 0;
  app.paused = false;
  preparePage(app);
  const focus = {
    x: centers.reduce((sum, c) => sum + c.x, 0) / centers.length,
    z: centers.reduce((sum, c) => sum + c.z, 0) / centers.length,
  };
  const camera = app.renderer.camera;
  camera.setScreenLift(0, 0);
  camera.zoom = options.zoom ?? 36;
  camera.update();
  camera.centerOn(focus.x, focus.z);
  app.selected = [];
  freeze(app);
  app.overlay.clear();
  const result = {
    ready: true,
    ids: items.map((item) => item.defId),
    focus,
    camera: {
      cx: camera.cx,
      cz: camera.cz,
      zoom: camera.zoom,
      pitchDeg: Math.round((camera.pitch * 180) / Math.PI),
    },
    frame: {
      css: [camera.width, camera.height],
      buffer: [app.renderer.gl.drawingBufferWidth, app.renderer.gl.drawingBufferHeight],
      dpr: app.renderer.dpr,
    },
  };
  window.__buildingPair = result;
  return result;
}

/**
 * One authored building, plus optional friendly/enemy duplicate for team
 * colour and a rifleman/tank scale reference in the foreground.
 *
 * @param {string} defId
 * @param {{zoom?: number, facing?: number, owner?: number, duplicate?: boolean,
 *          fog?: boolean, select?: boolean, refs?: boolean, groundDetail?: boolean}} [options]
 */
export async function showBuilding(defId, options = {}) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const { createIslandAssault } = await import('/src/data/scenarios.ts');
  const { BUILDINGS } = await import('/src/data/buildings.ts');
  const { footprintCenter } = await import('/src/sim/map.ts');

  const scenario = createIslandAssault();
  const def = BUILDINGS[defId];
  if (!def) throw new Error(`Unknown building: ${defId}`);
  const area = clearArea(scenario, BUILDINGS);
  const x = options.at?.x ?? area.x + 4;
  const z = options.at?.z ?? area.z + 2;
  const facing = options.facing;
  const first = { defId, owner: options.owner ?? 0, x, z };
  if (facing !== undefined) first.facing = facing;
  scenario.structures.push(first);
  if (options.duplicate) {
    const second = { defId, owner: 1, x: x + def.footprint.w + 2, z };
    if (facing !== undefined) second.facing = facing;
    scenario.structures.push(second);
  }
  if (options.refs) {
    scenario.units.push(
      { defId: 'rifle', owner: 0, x: x + 1, z: z + def.footprint.h + 1 },
      { defId: 'tank', owner: 0, x: x + 3, z: z + def.footprint.h + 1 },
      { defId: 'mlrs', owner: 1, x: x + 5, z: z + def.footprint.h + 1 },
    );
  }
  scenario.settings.fog = options.fog ?? false;
  scenario.settings.timeOfDay = options.timeOfDay ?? 'day';
  scenario.settings.weather = 'clear';

  app.settings.mapId = 'island-assault';
  app.settings.fogVisual = options.fog ?? false;
  app.settings.effects = false;
  app.renderer.settings.showFog = options.fog ?? false;
  app.renderer.settings.effects = false;
  app.speed = 0;
  await app.startBattle(scenario);
  app.speed = 0;
  app.paused = false;
  preparePage(app);

  const center = footprintCenter(defId, x, z);
  const camera = app.renderer.camera;
  camera.setScreenLift(0, 0);
  camera.zoom = options.zoom ?? 36;
  camera.update();
  camera.centerOn(center.x, center.z);

  const focus = app.game
    .entitiesOf(0, 'building')
    .find((e) => e.defId === defId && Math.abs(e.x - center.x) < 1 && Math.abs(e.z - center.z) < 1);
  app.selected = options.select && focus ? [focus.id] : [];
  freeze(app);
  if (app.selected.length > 0) app.overlay.draw(app);
  else app.overlay.clear();

  const mesh = await buildingMeshFor(defId);
  const result = {
    ready: true,
    defId,
    name: def.name,
    owner: options.owner ?? 0,
    duplicate: !!options.duplicate,
    footprint: def.footprint,
    entity: focus
      ? { x: focus.x, z: focus.z, y: focus.y, facing: focus.facing, turretFacing: focus.turretFacing }
      : null,
    mesh,
    camera: {
      cx: camera.cx,
      cz: camera.cz,
      zoom: camera.zoom,
      pitchDeg: Math.round((camera.pitch * 180) / Math.PI),
    },
    frame: {
      css: [camera.width, camera.height],
      buffer: [app.renderer.gl.drawingBufferWidth, app.renderer.gl.drawingBufferHeight],
      dpr: app.renderer.dpr,
    },
    fog: app.renderer.settings.showFog,
  };
  window.__buildingAudit = result;
  return result;
}

async function buildingMeshFor(defId) {
  const { buildingMesh } = await import('/src/render/buildingMeshes.ts');
  const mesh = buildingMesh(defId);
  if (!mesh) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  let teamVertices = 0;
  for (let i = 0; i < mesh.teamMask.length; i++) {
    if (mesh.teamMask[i] > 0) teamVertices++;
  }
  return {
    vertices: mesh.positions.length / 3,
    triangles: mesh.indices.length / 3,
    teamVertices,
    teamShare: Math.round((teamVertices / (mesh.positions.length / 3)) * 1000) / 10,
    bounds: {
      x: Math.round((maxX - minX) * 100) / 100,
      y: Math.round((maxY - minY) * 100) / 100,
      z: Math.round((maxZ - minZ) * 100) / 100,
      minY: Math.round(minY * 100) / 100,
      maxY: Math.round(maxY * 100) / 100,
    },
  };
}

/**
 * A single image of several buildings, each rendered as its own real frame at
 * the requested battle zoom and cropped around the structure. Labels are audit
 * annotations, never part of the game frame.
 *
 * @param {string[]} ids
 * @param {{zoom?: number, cols?: number, cell?: [number, number], label?: boolean}} [options]
 */
export async function contactSheet(ids, options = {}) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const cols = options.cols ?? 2;
  const rows = Math.ceil(ids.length / cols);
  const cell = options.cell ?? [800, 450];
  const sheet = document.createElement('canvas');
  sheet.width = cols * cell[0];
  sheet.height = rows * cell[1];
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#0b1010';
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  for (let i = 0; i < ids.length; i++) {
    const result = await showBuilding(ids[i], {
      zoom: options.zoom ?? 36,
      owner: options.owner ?? 0,
      fog: options.fog ?? false,
      facing: options.facing ?? 0,
      refs: options.refs ?? false,
      // A coastal battery has to sit on a valid navigable-water edge; the
      // generic grass showroom rejects it and would silently keep the previous
      // frame in the sheet.
      at: options.atById?.[ids[i]] ?? (ids[i] === 'coastalBattery' ? { x: 15, z: 51 } : undefined),
    });
    const gl = app.renderer.gl;
    const canvas = gl.canvas;
    // WebGL discards the drawing buffer after compositing, so submit this
    // building's frame in the same task as the drawImage below.
    app.renderer.render();
    // Crop a 4:3-ish centre window around the structure, then letterbox it into
    // the cell. The crop is taken from a full-resolution frame, so nothing is
    // upscaled and the silhouette stays at the tested battle-zoom pixel size.
    const cropW = Math.min(canvas.width, 900);
    const cropH = Math.min(canvas.height, Math.round(cropW * 0.5625));
    const sx = Math.round((canvas.width - cropW) / 2);
    // Keep more sky above the footprint so masts and clock towers survive.
    const sy = Math.max(0, Math.round((canvas.height - cropH) * 0.55));
    const cx = (i % cols) * cell[0];
    const cy = Math.floor(i / cols) * cell[1];
    ctx.drawImage(canvas, sx, sy, cropW, cropH, cx, cy, cell[0], cell[1]);
    if (options.label !== false) {
      const label = `${ids[i]}  |  ${result.name}`;
      ctx.fillStyle = 'rgba(6, 9, 9, 0.72)';
      ctx.fillRect(cx + 8, cy + cell[1] - 30, Math.min(cell[0] - 16, label.length * 7.2 + 12), 22);
      ctx.fillStyle = '#d7d3c4';
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillText(label, cx + 14, cy + cell[1] - 14);
    }
  }

  document.querySelectorAll('[data-building-audit-sheet]').forEach((el) => el.remove());
  sheet.dataset.buildingAuditSheet = 'true';
  sheet.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483000;background:#0b1010;';
  document.body.appendChild(sheet);
  window.__buildingSheet = { ids, cols, cell, width: sheet.width, height: sheet.height };
  return window.__buildingSheet;
}

/** Remove a contact sheet so the live game canvas is visible again. */
export function clearSheet() {
  document.querySelectorAll('[data-building-audit-sheet]').forEach((el) => el.remove());
}

/**
 * Flat-shaded orthographic silhouettes from the actual building meshes. This
 * deliberately bypasses the live frame, flags and team tint: it exists to
 * judge primary shape, not ownership or material presentation.
 */
export async function silhouetteSheet(ids, options = {}) {
  const { buildingMesh } = await import('/src/render/buildingMeshes.ts');
  const cols = options.cols ?? 3;
  const rows = Math.ceil(ids.length / cols);
  const cell = options.cell ?? [520, 420];
  const sheet = document.createElement('canvas');
  sheet.width = cols * cell[0];
  sheet.height = rows * cell[1];
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#d7d3c4';
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  const pitch = (30 * Math.PI) / 180;
  const c45 = Math.SQRT1_2;
  const project = (x, y, z) => [
    (x - z) * c45,
    (x + z) * c45 * Math.sin(pitch) - y * Math.cos(pitch),
  ];

  for (let i = 0; i < ids.length; i++) {
    const mesh = buildingMesh(ids[i]);
    if (!mesh) continue;
    const pts = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let v = 0; v < mesh.positions.length; v += 3) {
      const [x, y] = project(mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]);
      pts.push([x, y]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = 34;
    const scale = Math.min(
      (cell[0] - pad * 2) / Math.max(1, maxX - minX),
      (cell[1] - pad * 2) / Math.max(1, maxY - minY),
    );
    const ox = (i % cols) * cell[0] + cell[0] / 2 - ((minX + maxX) / 2) * scale;
    const oy = Math.floor(i / cols) * cell[1] + cell[1] / 2 - ((minY + maxY) / 2) * scale;
    ctx.fillStyle = '#101616';
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t];
      const b = mesh.indices[t + 1];
      const c = mesh.indices[t + 2];
      ctx.beginPath();
      ctx.moveTo(ox + pts[a][0] * scale, oy + pts[a][1] * scale);
      ctx.lineTo(ox + pts[b][0] * scale, oy + pts[b][1] * scale);
      ctx.lineTo(ox + pts[c][0] * scale, oy + pts[c][1] * scale);
      ctx.closePath();
      ctx.fill();
    }
  }

  document.querySelectorAll('[data-building-audit-sheet]').forEach((el) => el.remove());
  sheet.dataset.buildingAuditSheet = 'true';
  sheet.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483000;background:#d7d3c4;';
  document.body.appendChild(sheet);
  return { ids, cols, cell, width: sheet.width, height: sheet.height };
}

/**
 * Frozen opening frame of a shipped map, focused on the urban core rather than
 * the player's base. Used to judge structures in their real authored context.
 */
export async function showMap(
  mapId = 'foundry-district',
  focus = { x: 46, z: 34 },
  zoom = 30,
  options = {},
) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  document.documentElement.classList.remove('booting');
  const intro = document.getElementById('intro-screen');
  if (intro) intro.classList.add('hidden');
  const { createFoundryDistrict } = await import('/src/data/maps.ts');
  const { createIslandAssault } = await import('/src/data/scenarios.ts');
  const scenario = mapId === 'island-assault' ? createIslandAssault() : createFoundryDistrict();
  const fog = options.fog ?? false;
  scenario.settings.fog = fog;
  scenario.settings.timeOfDay = 'day';
  app.settings.mapId = mapId;
  app.settings.fogVisual = fog;
  app.settings.effects = false;
  app.renderer.settings.showFog = fog;
  app.renderer.settings.effects = false;
  app.speed = 0;
  await app.startBattle(scenario);
  app.speed = 0;
  app.paused = false;
  preparePage(app);
  const camera = app.renderer.camera;
  camera.setScreenLift(0, 0);
  camera.zoom = zoom;
  camera.update();
  camera.centerOn(focus.x * TILE, focus.z * TILE);
  app.selected = [];
  freeze(app);
  app.overlay.clear();
  const result = {
    ready: true,
    mapId: scenario.meta.id,
    entities: app.game.state.entities.length,
    buildings: app.game.state.entities.filter((e) => e.kind === 'building').length,
    camera: {
      cx: camera.cx,
      cz: camera.cz,
      zoom: camera.zoom,
      pitchDeg: Math.round((camera.pitch * 180) / Math.PI),
    },
    frame: {
      css: [camera.width, camera.height],
      buffer: [app.renderer.gl.drawingBufferWidth, app.renderer.gl.drawingBufferHeight],
      dpr: app.renderer.dpr,
    },
  };
  window.__buildingAuditMap = result;
  return result;
}

/** Save a contact-sheet canvas through the loopback audit sink. */
export async function saveSheet(name) {
  const sheet = document.querySelector('[data-building-audit-sheet]');
  if (!sheet) throw new Error('No contact sheet on the page.');
  return saveDataUrl(name, sheet.toDataURL('image/png'));
}

/** Downscaled contact sheet for in-chat review. */
export async function saveReviewSheet(name, maxWidth = 1100) {
  const sheet = document.querySelector('[data-building-audit-sheet]');
  if (!sheet) throw new Error('No contact sheet on the page.');
  const scale = Math.min(1, maxWidth / sheet.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sheet.width * scale);
  canvas.height = Math.round(sheet.height * scale);
  canvas.getContext('2d').drawImage(sheet, 0, 0, canvas.width, canvas.height);
  return saveDataUrl(name, canvas.toDataURL('image/png'));
}

/**
 * Save a close crop with building flags suppressed. Team tint is untouched, so
 * this is the evidence for body ownership after capture, independent of the
 * flag rig. The renderer method is restored even if the save fails.
 */
export async function saveFlaglessCrop(name, width = 800, height = 600, includeOverlay = false) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const renderer = app.renderer;
  const original = renderer.drawBuildingFlags;
  renderer.drawBuildingFlags = () => {};
  try {
    return await saveCentreCrop(name, width, height, includeOverlay);
  } finally {
    renderer.drawBuildingFlags = original;
  }
}

/** Save the current game frame at native canvas resolution. */
export async function saveFrame(name, includeOverlay = true) {
  return saveDataUrl(name, capture(includeOverlay));
}

/** Save a downscaled copy for in-chat review; the native frame stays on disk. */
export async function saveReviewFrame(name, maxWidth = 1100, includeOverlay = false) {
  const dataUrl = capture(includeOverlay);
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
  const scale = Math.min(1, maxWidth / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return saveDataUrl(name, canvas.toDataURL('image/png'));
}

async function saveDataUrl(name, dataUrl) {
  const res = await fetch(`http://127.0.0.1:5201/save?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: dataUrl,
  });
  if (!res.ok) throw new Error(`Capture sink rejected ${name}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Measure one frozen frame's draw submission. CPU timing, not GPU time. */
export function measureCurrent(frames = 8) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const gl = app.renderer.gl;
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
  for (let i = 0; i < 5; i++) app.renderer.render();
  gl.finish();
  const start = performance.now();
  for (let i = 0; i < frames; i++) app.renderer.render();
  const cpuRenderMs = (performance.now() - start) / frames;
  gl.finish();
  stats.drawCalls = 0;
  stats.triangles = 0;
  stats.lines = 0;
  app.renderer.render();
  gl.finish();
  for (const name of names) if (saved[name]) gl[name] = saved[name];
  return {
    ...stats,
    triangles: Math.round(stats.triangles),
    cpuRenderMs: Math.round(cpuRenderMs * 100) / 100,
    frame: {
      css: [app.renderer.camera.width, app.renderer.camera.height],
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      dpr: app.renderer.dpr,
    },
  };
}

/**
 * Save a 1:1 native-pixel crop around the frame centre, for judging a model at
 * the actual rendered pixel size rather than a downscaled page image.
 */
export async function saveCentreCrop(name, width = 640, height = 520, includeOverlay = false) {
  const dataUrl = capture(includeOverlay);
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
  const w = Math.min(width, img.width);
  const h = Math.min(height, img.height);
  const sx = Math.round((img.width - w) / 2);
  const sy = Math.round((img.height - h) * 0.48);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, sx, sy, w, h, 0, 0, w, h);
  return saveDataUrl(name, canvas.toDataURL('image/png'));
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
