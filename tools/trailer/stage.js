/**
 * MCA trailer director (dev only, never bundled).
 *
 * Loaded by `tools/trailer/capture.mjs` through the dev server, exactly like the
 * other probe modules. It stages one of the shipped maps, hands both sides to
 * the real simulation, drives an authored camera and records the result with
 * the game's own audio graph tapped into the recording.
 *
 * Nothing in here is imported by the game. The rules it uses — scenario shape,
 * `Game`, `enqueueCommand` — are the same ones the shipped battle uses, so a
 * frame of this trailer is a frame of the game.
 *
 * Two entry points matter:
 *   - a still: stage, advance the simulation to the shot's preview time and
 *     paint one composited frame, so framing can be checked before a take;
 *   - a take: stage, run in real time, record the composite canvas and the
 *     audio master bus to WebM, stop on the shot's duration.
 */

import { SHOTS } from './script.js';

const SINK = 'http://127.0.0.1:5211';
const WIDTH = 1920;
const HEIGHT = 1080;
const TILE = 4;
const TICKS_PER_SECOND = 20;
/** 2.05:1 letterbox: enough to read as a film frame, not enough to crop the fight. */
const BAR = Math.round((HEIGHT - WIDTH / 2.05) / 2);

const FRAME = '"Bahnschrift", "DIN Alternate", "DIN Condensed", "Arial Narrow", sans-serif';
const MONO = '"Cascadia Mono", "SFMono-Regular", Consolas, monospace';
const BODY = '"Inter", "Segoe UI", Arial, sans-serif';
const AMBER = '#f1c27e';
const BRASS = '#b98d55';
const BONE = '#f4e7d0';
const ASH = '#cbbfae';

/* -------------------------------------------------------------------------- */
/* Engine modules                                                             */
/* -------------------------------------------------------------------------- */

let enginePromise = null;

function engine() {
  enginePromise ??= (async () => {
    const [game, maps, competitive, expansion, island, scenarios, dayNight, terrainMesh] =
      await Promise.all([
        import('/src/sim/game.ts'),
        import('/src/data/maps.ts'),
        import('/src/data/competitiveMaps.ts'),
        import('/src/data/expansionMaps.ts'),
        import('/src/data/islandMap.ts'),
        import('/src/data/scenarios.ts'),
        import('/src/sim/dayNight.ts'),
        import('/src/render/terrainMesh.ts'),
      ]);
    const factories = {};
    for (const module of [maps, competitive, expansion, island, scenarios]) {
      for (const [name, value] of Object.entries(module)) {
        if (name.startsWith('create') && typeof value === 'function') factories[name] = value;
      }
    }
    return {
      Game: game.Game,
      factories,
      phaseForStartHour: dayNight.phaseForStartHour,
      isWaterAt: terrainMesh.isWaterAt,
    };
  })();
  return enginePromise;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, u) => a + (b - a) * u;

function easeInOut(u) {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function hideElement(id, display = 'none') {
  const el = document.getElementById(id);
  if (el) el.style.display = display;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function post(name, blob) {
  const response = await fetch(`${SINK}/file?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: blob,
  });
  if (!response.ok) throw new Error(`sink refused ${name}: ${response.status}`);
  return response.json();
}

/* -------------------------------------------------------------------------- */
/* Scenario staging                                                           */
/* -------------------------------------------------------------------------- */

/** Nudge a spot off water and onto the nearest dry footing. */
function drySpot(scenario, isWaterAt, x, z) {
  const probe = (tx, tz) =>
    tx >= 1 &&
    tz >= 1 &&
    tx < scenario.width - 1 &&
    tz < scenario.height - 1 &&
    !isWaterAt(scenario, (tx + 0.5) * TILE, (tz + 0.5) * TILE);
  if (probe(x, z)) return { x, z };
  for (let radius = 1; radius <= 14; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        if (probe(x + dx, z + dz)) return { x: x + dx, z: z + dz };
      }
    }
  }
  return { x, z };
}

/**
 * Where a shot is anchored, in tiles.
 *
 * Everything a shot authors — camera keys, force positions, order targets — is
 * relative to this point, so one shot reads sensibly on any map and a map's own
 * layout can never put a staged tank in the sea.
 */
function resolveAnchor(scenario, shot) {
  const post = (owner) =>
    scenario.structures.find(
      (structure) => structure.defId === 'commandPost' && structure.owner === owner,
    );
  const centroid = (owner) => {
    const units = scenario.units.filter((unit) => unit.owner === owner);
    if (units.length === 0) return null;
    const sum = units.reduce((acc, unit) => ({ x: acc.x + unit.x, z: acc.z + unit.z }), { x: 0, z: 0 });
    return { x: sum.x / units.length, z: sum.z / units.length };
  };
  const mode = shot.anchor ?? 'map';
  if (typeof mode === 'object') return mode;
  if (mode === 'blue' || mode === 'red') {
    const base = post(mode === 'blue' ? 0 : 1);
    if (base) return { x: base.x + 1.5, z: base.z + 1.5 };
    const fallback = centroid(mode === 'blue' ? 0 : 1);
    if (fallback) return fallback;
  }
  if (mode === 'units0' || mode === 'units1') {
    const fallback = centroid(mode === 'units0' ? 0 : 1);
    if (fallback) return fallback;
  }
  return { x: scenario.width / 2, z: scenario.height / 2 };
}

function addUnits(scenario, isWaterAt, shot, anchor) {
  for (const group of shot.units ?? []) {
    const count = group.count ?? 1;
    const columns = group.columns ?? Math.max(1, Math.ceil(Math.sqrt(count)));
    for (let i = 0; i < count; i++) {
      const column = i % columns;
      const row = Math.floor(i / columns);
      const spot = drySpot(
        scenario,
        isWaterAt,
        Math.round(anchor.x + group.x + column * (group.gapX ?? 2)),
        Math.round(anchor.z + group.z + row * (group.gapZ ?? 2)),
      );
      scenario.units.push({ defId: group.defId, owner: group.owner ?? 0, x: spot.x, z: spot.z });
    }
  }
}

function addStructures(scenario, isWaterAt, shot, anchor) {
  for (const group of shot.structures ?? []) {
    const spot = drySpot(scenario, isWaterAt, Math.round(anchor.x + group.x), Math.round(anchor.z + group.z));
    scenario.structures.push({ defId: group.defId, owner: group.owner ?? 0, x: spot.x, z: spot.z });
  }
}

/**
 * Build one battle from a shot description.
 *
 * The map supplies terrain, roads, props and its authored bases; the shot
 * supplies the forces and the hour. Units are the real definitions, the fight
 * is the real simulation, and the whole thing is deterministic for a seed.
 */
async function stage(app, shot) {
  const { Game, factories, phaseForStartHour, isWaterAt } = await engine();
  const factory = factories[shot.map];
  if (!factory) throw new Error(`unknown map factory "${shot.map}"`);
  const scenario = factory();

  scenario.units = shot.keepUnits ? scenario.units : [];
  if (shot.clearStructures) scenario.structures = [];

  // A trailer shot is a skirmish, not a mission: objectives, briefings and
  // victory checks belong to the campaign, and a stray objective completing
  // mid-take would put a dialog in the frame.
  scenario.mission = undefined;

  const hour = shot.hour ?? 10;
  scenario.settings.fog = false;
  scenario.settings.seed = shot.seed ?? 4101;
  scenario.settings.startHour = hour;
  scenario.settings.timeOfDay = phaseForStartHour(hour);
  scenario.settings.weather = shot.weather ?? 'clear';
  scenario.settings.superweapons = false;
  scenario.settings.timeLimitSec = 0;

  const [ours, theirs] = shot.nations ?? ['baltic', 'eastern'];
  if (scenario.players[0]) scenario.players[0].factionId = ours;
  if (scenario.players[1]) scenario.players[1].factionId = theirs;

  // Forces are authored against an anchor, and the anchor is read from the
  // map's own bases — so staging has to happen before the simulation is built.
  // A unit added afterwards would exist in the scenario and nowhere else, which
  // is exactly the bug that produced empty battlefields on the first pass.
  const anchor = resolveAnchor(scenario, shot);
  addStructures(scenario, isWaterAt, shot, anchor);
  addUnits(scenario, isWaterAt, shot, anchor);

  const game = new Game(scenario, {
    localPlayerId: 0,
    enableAI: shot.ai ?? false,
    aiSeed: shot.seed ?? 4101,
    aiDifficulty: 'veteran',
  });

  app.game = game;
  app.screen = 'battle';
  app.paused = false;
  app.speed = shot.speed ?? 1;
  app.accumulator = 0;
  app.lastEventSeq = 0;
  app.victoryShown = 'none';
  app.selected = [];
  app.groups?.clear?.();
  app.mode = 'none';
  app.placeDefId = null;
  app.cinematic = null;
  app.network = null;

  app.renderer.settings.showFog = !!shot.fog;
  app.renderer.settings.effects = true;
  app.renderer.settings.shake = true;
  app.renderer.settings.grid = false;
  app.renderer.setGame(game);
  app.renderer.setSimulationAlpha(1);
  app.resize();
  app.hud.mount(game);
  app.frameBattleCamera?.();
  return { game, anchor };
}

/* -------------------------------------------------------------------------- */
/* Camera                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where the fight is, in tiles.
 *
 * A shot can follow its own action instead of a fixed point: the centre is the
 * mean of every unit the shot staged, biased a little toward the enemy so the
 * camera leads into contact rather than sitting on the back of its own column.
 * Returned in tiles because that is what camera keys are authored in.
 */
function actionCentre(game, shot) {
  const group = (owner) => game.entitiesOf(owner, 'unit').filter((unit) => unit.hp > 0);
  const sum = (units) =>
    units.reduce((acc, unit) => ({ x: acc.x + unit.x / TILE, z: acc.z + unit.z / TILE }), { x: 0, z: 0 });
  const own = group(0);
  const enemy = group(1);
  if (own.length === 0 && enemy.length === 0) return null;
  const a = own.length ? sum(own) : { x: 0, z: 0 };
  const b = enemy.length ? sum(enemy) : { x: 0, z: 0 };
  const p = own.length ? { x: a.x / own.length, z: a.z / own.length } : { x: b.x / enemy.length, z: b.z / enemy.length };
  const q = enemy.length ? { x: b.x / enemy.length, z: b.z / enemy.length } : p;
  const lead = shot.lead ?? 0.3;
  return { x: lerp(p.x, q.x, lead), z: lerp(p.z, q.z, lead) };
}

/** Smooth a follow camera so it tracks the fight without snapping between units. */
function followCentre(state, game, shot, dt) {
  const target = actionCentre(game, shot);
  if (!target) return state.anchor;
  if (!state.follow) {
    state.follow = { ...target };
    return state.follow;
  }
  const rate = shot.followRate ?? 1.6;
  const k = clamp01(dt * rate);
  state.follow.x = lerp(state.follow.x, target.x, k);
  state.follow.z = lerp(state.follow.z, target.z, k);
  return state.follow;
}

/**
 * Interpolated camera for a shot.
 *
 * Positions are authored in tiles because that is the unit the maps are drawn
 * in; the camera works in world units. Zoom eases geometrically so a push reads
 * as constant-speed travel rather than slowing down as it closes.
 */
function applyCamera(app, shot, anchor, t) {
  const keys = shot.camera;
  if (!keys || keys.length === 0) return;
  const camera = app.renderer.camera;
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }
  const span = Math.max(1e-4, b.t - a.t);
  const raw = t < keys[0].t ? 0 : t > keys[keys.length - 1].t ? 1 : (t - a.t) / span;
  // A `cut: true` key lands instantly: the camera snaps to it instead of
  // travelling, which is how the montage changes angle inside one take.
  const u = b.cut ? 1 : (a.ease ?? 'inout') === 'linear' ? raw : easeInOut(raw);
  const x = (anchor.x + lerp(a.x, b.x, u)) * TILE;
  const z = (anchor.z + lerp(a.z, b.z, u)) * TILE;
  const zoom = Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), u));
  const pitch = a.pitch === undefined && b.pitch === undefined
    ? null
    : (lerp(a.pitch ?? 30, b.pitch ?? 30, u) * Math.PI) / 180;
  if (pitch !== null) camera.pitch = pitch;
  camera.setScreenLift(0, 0);
  camera.setFraming(x, z, zoom);
}

/* -------------------------------------------------------------------------- */
/* Composite frame                                                            */
/* -------------------------------------------------------------------------- */

const chrome = {
  vignette: null,
  insignia: null,
};

function buildVignette(ctx) {
  const gradient = ctx.createRadialGradient(
    WIDTH / 2,
    HEIGHT / 2,
    HEIGHT * 0.32,
    WIDTH / 2,
    HEIGHT / 2,
    HEIGHT * 0.95,
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.65, 'rgba(3,6,8,0.22)');
  gradient.addColorStop(1, 'rgba(3,6,8,0.62)');
  chrome.vignette = gradient;
}

function tracked(ctx, text, x, y, spacing) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(text, x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function titleOpacity(title, t) {
  const fade = title.fade ?? 0.55;
  const inOpacity = clamp01((t - title.from) / fade);
  const outOpacity = clamp01((title.to - t) / fade);
  return Math.min(inOpacity, outOpacity);
}

function drawLowerThird(ctx, title, alpha) {
  const x = 104;
  const baseY = HEIGHT - BAR - 96;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = AMBER;
  ctx.font = `600 15px ${MONO}`;
  tracked(ctx, title.kicker ?? 'MODERN COMBINED ARMS', x, baseY - 62, 4.4);

  ctx.fillStyle = BONE;
  ctx.font = `600 46px ${FRAME}`;
  ctx.fillText(title.text, x, baseY);

  if (title.sub) {
    ctx.fillStyle = ASH;
    ctx.font = `400 19px ${BODY}`;
    ctx.fillText(title.sub, x + 2, baseY + 34);
  }

  ctx.fillStyle = 'rgba(241,194,126,0.85)';
  ctx.fillRect(x, baseY + 52, 46, 2);
  ctx.restore();
}

function drawCenterTitle(ctx, title, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2 + 10;

  if (title.kicker) {
    ctx.fillStyle = AMBER;
    ctx.font = `600 17px ${MONO}`;
    tracked(ctx, title.kicker, cx, cy - 84, 6);
  }
  ctx.fillStyle = BONE;
  ctx.font = `600 96px ${FRAME}`;
  ctx.fillText(title.text, cx, cy);
  if (title.sub) {
    ctx.fillStyle = AMBER;
    ctx.font = `500 25px ${FRAME}`;
    tracked(ctx, title.sub, cx, cy + 52, 9);
  }
  ctx.restore();
}

async function drawEndCard(ctx, title, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // Not quite black: the battlefield behind the card still has to read as a
  // place, silhouetted under the lockup rather than erased.
  const shade = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  shade.addColorStop(0, 'rgba(4,7,10,0.82)');
  shade.addColorStop(0.5, 'rgba(4,7,10,0.72)');
  shade.addColorStop(1, 'rgba(3,5,7,0.9)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const left = WIDTH / 2 - 380;
  const top = HEIGHT / 2 - 150;
  if (!chrome.insignia) {
    try {
      const image = new Image();
      image.src = '/insignia.svg';
      await image.decode();
      chrome.insignia = image;
    } catch {
      chrome.insignia = null;
    }
  }
  if (chrome.insignia) ctx.drawImage(chrome.insignia, left, top, 92, 92);

  const textX = left + 124;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = BRASS;
  ctx.font = `600 13px ${MONO}`;
  tracked(ctx, title.kicker ?? 'COMBINED-ARMS REAL-TIME STRATEGY', textX, top + 6, 4.2);

  ctx.fillStyle = BONE;
  ctx.font = `600 92px ${FRAME}`;
  ctx.fillText('MCA', textX - 4, top + 24);

  ctx.fillStyle = AMBER;
  ctx.font = `500 22px ${FRAME}`;
  tracked(ctx, 'MODERN COMBINED ARMS', textX, top + 128, 8);

  ctx.fillStyle = ASH;
  ctx.font = `400 18px ${BODY}`;
  ctx.fillText(title.sub ?? '', textX, top + 178);

  ctx.fillStyle = BRASS;
  ctx.font = `500 13px ${MONO}`;
  tracked(ctx, title.tag ?? 'BETA — PLAY IT IN THE BROWSER', WIDTH / 2 - 380, HEIGHT - 168, 3.4);
  ctx.restore();
}

function drawComposite(state, t) {
  const ctx = state.ctx;
  const gl = document.getElementById('gl');
  if (!gl) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05080a';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.drawImage(gl, 0, 0, WIDTH, HEIGHT);

  if (!chrome.vignette) buildVignette(ctx);
  ctx.fillStyle = chrome.vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  for (const title of state.shot.titles ?? []) {
    if (t < title.from || t > title.to) continue;
    const alpha = titleOpacity(title, t);
    if (alpha <= 0) continue;
    if (title.kind === 'end') void drawEndCard(ctx, title, alpha);
    else if (title.kind === 'center') drawCenterTitle(ctx, title, alpha);
    else drawLowerThird(ctx, title, alpha);
  }

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIDTH, BAR);
  ctx.fillRect(0, HEIGHT - BAR, WIDTH, BAR);
}

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

function audioTap(app) {
  const audio = app.audio;
  const ctx = audio?.ctx;
  const master = audio?.master;
  if (!ctx || !master) {
    console.error('[trailer] no audio graph to tap: the clip will be silent');
    return null;
  }
  console.log(`[trailer] audio tap on a ${ctx.state} context at ${ctx.sampleRate} Hz`);
  const destination = ctx.createMediaStreamDestination();
  master.connect(destination);
  return {
    stream: destination.stream,
    dispose() {
      try {
        master.disconnect(destination);
      } catch {
        /* Already torn down with the engine. */
      }
    },
  };
}

function pickMime() {
  const options = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

async function prepareStage() {
  const app = window.ironTide;
  if (!app) throw new Error('window.ironTide is missing: is this the game page?');
  document.documentElement.classList.remove('booting');
  for (const id of ['intro-screen', 'menu-screen', 'loading-screen', 'pause-screen', 'victory-screen', 'defeat-screen', 'briefing-screen', 'cinematic-root', 'mission-debrief', 'hud-root', 'overlay']) {
    hideElement(id);
  }
  document.body.classList.remove('cinematic-active');
  app.settings.customCursors = false;
  app.resize();
  // The recording taps the engine's master bus, so the graph has to exist
  // before a take starts. Without this the clip comes back silent.
  app.audio?.init?.();
  if (app.audio?.ctx?.state === 'suspended') await app.audio.ctx.resume();
  return app;
}

/** Install the frame hook once; the active state decides what it draws. */
function installHook(app) {
  if (app.renderer.__trailerHook) return;
  const original = app.renderer.render.bind(app.renderer);
  const hooked = function render() {
    const state = window.__trailerState;
    if (!state) return original();
    // The hook runs inside the shell's frame loop: an exception here would end
    // the animation loop and silently freeze a take, so a bad frame is reported
    // once and skipped instead of taking the page down with it.
    try {
      return hookFrame(app, original, state);
    } catch (error) {
      if (!hooked.reported) {
        hooked.reported = true;
        console.error(`[trailer] frame hook failed: ${error?.stack ?? error}`);
      }
      return original();
    }
  };
  const hookFrame = (app, original, state) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - (state.lastPaint ?? now)) / 1000);
    state.lastPaint = now;
    const t = state.frozen ?? Math.min(state.shot.duration, (now - state.start) / 1000);
    const base = state.shot.follow
      ? followCentre(state, app.game, state.shot, state.frozen !== undefined ? 1 : dt)
      : state.anchor;
    applyCamera(app, state.shot, base, t);
    original();
    drawComposite(state, t);
    // Victory/defeat belong to a match that ends, and a take must not be
    // interrupted by the shell celebrating a command post it just lost.
    if (app.victoryShown !== 'none') {
      app.victoryShown = 'none';
      hideElement('victory-screen');
      hideElement('defeat-screen');
    }
    state.onFrame?.(t);
    return undefined;
  };
  app.renderer.__trailerHook = hooked;
  app.renderer.render = hooked;
}

function makeComposite() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D composite context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

function issueCues(app, shot, anchor, from, to) {
  for (const cue of shot.cues ?? []) {
    if (cue.t < from || cue.t >= to) continue;
    const pool = app.game.entitiesOf(cue.owner, 'unit');
    const ids = pool
      .filter((unit) => !cue.defIds || cue.defIds.includes(unit.defId))
      .map((unit) => unit.id);
    if (ids.length === 0) continue;
    app.game.enqueueCommand({
      type: 'move',
      team: cue.owner,
      ids,
      x: (anchor.x + cue.x) * TILE,
      z: (anchor.z + cue.z) * TILE,
      attackMove: cue.type !== 'move',
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Entry points                                                               */
/* -------------------------------------------------------------------------- */

async function still(app, shot) {
  const { canvas, ctx } = makeComposite();
  const { game, anchor } = await stage(app, shot);
  const preview = shot.previewTime ?? shot.duration * 0.5;
  // Advance deterministically to the preview moment so the still carries the
  // same battle state a take would have shown.
  const ticks = Math.round(preview * TICKS_PER_SECOND);
  for (let i = 0; i < ticks; i++) {
    issueCues(app, shot, anchor, (i - 1) / TICKS_PER_SECOND, i / TICKS_PER_SECOND);
    game.tick();
  }
  installHook(app);
  const state = { shot, anchor, frozen: preview, ctx, start: performance.now() };
  // A follow camera has to arrive where a take would have arrived: settle it
  // over the shot's own timeline instead of dropping in at the first frame.
  if (shot.follow) {
    for (let i = 0; i <= 60; i++) followCentre(state, game, shot, 1);
  }
  window.__trailerState = state;
  await nextFrame();
  await nextFrame();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const result = await post(`still-${shot.id}.png`, blob);
  window.__trailerState = null;
  return result;
}

async function take(app, shot) {
  const { canvas, ctx } = makeComposite();
  const { anchor } = await stage(app, shot);
  installHook(app);

  const tap = audioTap(app);
  const stream = canvas.captureStream(30);
  for (const track of tap?.stream.getAudioTracks() ?? []) stream.addTrack(track);

  const mimeType = pickMime();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 16_000_000,
    audioBitsPerSecond: 192_000,
  });
  const chunks = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  const finished = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));

  let last = 0;
  const state = {
    shot,
    anchor,
    start: performance.now(),
    ctx,
    onFrame(t) {
      issueCues(app, shot, anchor, last, t + 0.5);
      last = t + 0.5;
      if (t >= shot.duration && recorder.state === 'recording') recorder.stop();
    },
  };
  window.__trailerState = state;

  recorder.start(1000);
  console.log(`[trailer] take ${shot.id} rolling (${mimeType})`);
  // A take is a real-time job in someone else's frame loop: if frames stop
  // arriving, stop the recorder anyway so the run reports a short clip instead
  // of waiting forever for a stop that will never come.
  const watchdog = setTimeout(() => {
    console.error(`[trailer] take ${shot.id} stalled at t=${last.toFixed(2)}s; stopping`);
    if (recorder.state !== 'inactive') recorder.stop();
  }, (shot.duration + 20) * 1000);
  await finished;
  clearTimeout(watchdog);
  console.log(`[trailer] take ${shot.id} stopped with ${chunks.length} chunk(s)`);
  window.__trailerState = null;
  tap?.dispose();
  for (const track of stream.getTracks()) track.stop();

  const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
  if (blob.size < 40_000) throw new Error(`clip ${shot.id} is suspiciously small (${blob.size} bytes)`);
  return post(`clip-${shot.id}.webm`, blob);
}

export async function run(mode, ids) {
  const shots = ids ? SHOTS.filter((shot) => ids.includes(shot.id)) : SHOTS;
  if (shots.length === 0) throw new Error(`no shots matched ${JSON.stringify(ids)}`);
  if (mode === 'info') {
    const { factories } = await engine();
    return shots.map((shot) => {
      const scenario = factories[shot.map]();
      const count = (list, owner) => list.filter((entry) => entry.owner === owner).length;
      return {
        id: shot.id,
        map: shot.map,
        size: [scenario.width, scenario.height],
        units: [count(scenario.units, 0), count(scenario.units, 1)],
        structures: [count(scenario.structures, 0), count(scenario.structures, 1)],
        posts: scenario.structures
          .filter((structure) => structure.defId === 'commandPost')
          .map((structure) => ({ owner: structure.owner, x: structure.x, z: structure.z })),
        ore: scenario.tiles.filter((tile) => tile.o > 0).length,
        structureList: scenario.structures.map((s) => `${s.defId}@${s.owner}:${s.x},${s.z}`),
        unitList: scenario.units.map((u) => `${u.defId}@${u.owner}:${u.x},${u.z}`),
        settings: {
          timeOfDay: scenario.settings.timeOfDay,
          weather: scenario.settings.weather,
          fog: scenario.settings.fog,
        },
      };
    });
  }

  const app = await prepareStage();
  const results = [];
  for (const shot of shots) {
    const started = performance.now();
    const result = mode === 'record' ? await take(app, shot) : await still(app, shot);
    results.push(result);
    console.log(`[trailer] ${shot.id} -> ${result.name} in ${Math.round(performance.now() - started)}ms`);
  }
  return results;
}
