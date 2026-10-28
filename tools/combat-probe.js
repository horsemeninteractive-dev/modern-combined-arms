/**
 * Dev-only combat staging probe.
 *
 * The game has no authored combat sandbox, so a readability pass needs a
 * repeatable way to put representative weapons into one known frame. This tool
 * builds a deterministic, AI-free battle from the shipped island scenario and
 * hands the renderer a frozen clock. It never ships in the bundle.
 *
 *   npm run dev
 *   open http://127.0.0.1:5175/ and wait for the menu
 *   await (await import('/tools/combat-probe.js')).stage('tank')
 *   ... screenshots ...
 *   await (await import('/tools/combat-probe.js')).stage('rifle')
 *
 * `window.__combatProbe` keeps the staged app, game and helpers for the console.
 */

const TILE = 4;

async function loadModules() {
  const [sim, data] = await Promise.all([
    import('/src/sim/game.ts'),
    import('/src/data/scenarios.ts'),
  ]);
  return { Game: sim.Game, createIslandAssault: data.createIslandAssault };
}

function addUnit(scenario, defId, owner, x, z) {
  scenario.units.push({ defId, owner, x, z });
}

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function show(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

/**
 * Each scene starts from the shipped island, strips the landing forces and
 * authors only the duel. Positions use the open grass corridor at z≈34–40,
 * west of the ridge road, so no scene depends on a forest or a building tile.
 */
const SCENES = {
  rifle: {
    label: 'Rifle section versus rifle section',
    build(s) {
      addUnit(s, 'rifle', 0, 20, 23);
      addUnit(s, 'rifle', 0, 21, 24);
      addUnit(s, 'rifle', 0, 20, 25);
      addUnit(s, 'rifle', 1, 25, 23);
      addUnit(s, 'rifle', 1, 26, 25);
      return { cx: 23 * TILE, cz: 24 * TILE, teams: [[0], [1]] };
    },
  },
  atgm: {
    label: 'Anti-tank guided missile versus MBT',
    build(s) {
      addUnit(s, 'atgm', 0, 19, 24);
      addUnit(s, 'tank', 1, 25, 24);
      return { cx: 22 * TILE, cz: 24 * TILE, teams: [[0], [1]] };
    },
  },
  tank: {
    label: 'MBT main gun versus MBT',
    build(s) {
      addUnit(s, 'tank', 0, 19, 24);
      addUnit(s, 'tank', 1, 26, 24);
      return { cx: 22.5 * TILE, cz: 24 * TILE, teams: [[0], [1]] };
    },
  },
  artillery: {
    label: 'Self-propelled artillery versus infantry',
    build(s) {
      addUnit(s, 'spg', 0, 18, 24);
      addUnit(s, 'rifle', 1, 28, 24);
      addUnit(s, 'rifle', 1, 29, 25);
      return { cx: 23.5 * TILE, cz: 24.5 * TILE, teams: [[0], [1]] };
    },
  },
  antiAir: {
    label: 'Air-defence vehicle versus strike aircraft',
    build(s) {
      addUnit(s, 'aa', 0, 21, 24);
      addUnit(s, 'fighter', 1, 25, 24);
      return { cx: 23 * TILE, cz: 24 * TILE, teams: [[0], [1]], air: true };
    },
  },
  staticAt: {
    label: 'Anti-tank gun emplacement versus MBT',
    build(s) {
      s.structures.push({ defId: 'atTurret', owner: 0, x: 27, z: 23 });
      addUnit(s, 'tank', 1, 21, 23);
      return { cx: 24 * TILE, cz: 23 * TILE, teams: [[], [1]] };
    },
  },
  coastal: {
    label: 'Coastal battery versus corvette',
    build(s) {
      s.structures.push({ defId: 'coastalBattery', owner: 0, x: 15, z: 51 });
      addUnit(s, 'corvette', 1, 9, 48);
      return { cx: 12.5 * TILE, cz: 50 * TILE, teams: [[], [1]] };
    },
  },
  destruction: {
    label: 'MBT destroyed by a main-gun hit',
    build(s) {
      addUnit(s, 'tank', 0, 19, 24);
      addUnit(s, 'tank', 1, 24, 24);
      return { cx: 21.5 * TILE, cz: 24 * TILE, teams: [[0], [1]] };
    },
  },
  dense: {
    label: 'Dense mixed engagement',
    build(s) {
      for (let i = 0; i < 8; i++) {
        addUnit(s, 'rifle', 0, 19 + (i % 2), 21 + Math.floor(i / 2));
        addUnit(s, 'rifle', 1, 26 + (i % 2), 21 + Math.floor(i / 2));
      }
      addUnit(s, 'tank', 0, 18, 24);
      addUnit(s, 'tank', 1, 28, 24);
      addUnit(s, 'atgm', 0, 21, 26);
      addUnit(s, 'spg', 0, 18, 20);
      addUnit(s, 'tank', 1, 28, 20);
      return { cx: 23 * TILE, cz: 23.5 * TILE, teams: [[0], [1]] };
    },
  },
  miss: {
    label: 'Rifle volley with a ground miss',
    build(s) {
      for (let i = 0; i < 6; i++) {
        addUnit(s, 'rifle', 0, 19 + (i % 3) * 2, 22 + Math.floor(i / 3));
      }
      addUnit(s, 'tank', 1, 25, 25);
      return { cx: 22 * TILE, cz: 23.5 * TILE, teams: [[0], [1]] };
    },
  },
  structure: {
    label: 'Static structure destroyed by direct fire',
    build(s) {
      addUnit(s, 'tank', 0, 22, 24);
      s.structures.push({ defId: 'warehouse', owner: 1, x: 27, z: 24 });
      return { cx: 24.5 * TILE, cz: 24 * TILE, teams: [[0], []], attackStructure: 'warehouse' };
    },
  },
  barrage: {
    label: 'Simultaneous rifle barrage',
    build(s) {
      for (let i = 0; i < 12; i++) {
        const x = 18 + (i % 4) * 3;
        const z = 21 + Math.floor(i / 4);
        addUnit(s, 'rifle', 0, x, z);
        addUnit(s, 'rifle', 1, x, z + 5);
      }
      addUnit(s, 'tank', 0, 18, 25);
      addUnit(s, 'tank', 1, 28, 22);
      return { cx: 23 * TILE, cz: 24.5 * TILE, teams: [[0], [1]] };
    },
  },
  fog: {
    label: 'Friendly contact with an enemy held beyond vision',
    build(s) {
      addUnit(s, 'rifle', 0, 22, 24);
      addUnit(s, 'rifle', 1, 40, 24);
      s.settings.fog = true;
      return { cx: 27 * TILE, cz: 24 * TILE, teams: [[0], [1]] };
    },
  },
};

export const COMBAT_SCENES = Object.keys(SCENES);

function stripLandingForce(scenario) {
  scenario.units = [];
  scenario.settings.fog = false;
  // A duel against an AI commander would add off-camera contacts and orders.
  for (const player of scenario.players) player.isAI = false;
}

function visibleIds(game, owner, kind) {
  return game
    .entitiesOf(owner, kind)
    .filter((e) => e.hp > 0 && !e.garrisonId)
    .map((e) => e.id);
}

/**
 * Stage one scene and freeze it on the current tick. The helper restores the
 * real renderer update behind `probe.step()` so effects age at simulation time,
 * not the browser's wall clock.
 */
export async function stage(kind = 'rifle', options = {}) {
  const scene = SCENES[kind];
  if (!scene) throw new Error(`Unknown combat scene "${kind}". Try ${COMBAT_SCENES.join(', ')}.`);
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const { Game, createIslandAssault } = await loadModules();

  const scenario = createIslandAssault();
  stripLandingForce(scenario);
  const spec = scene.build(scenario);
  const game = new Game(scenario, { localPlayerId: 0, enableAI: false });

  if (spec.air) {
    for (const e of game.entitiesOf(1, 'unit')) {
      if (e.defId !== 'fighter') continue;
      e.aircraft.landed = false;
      e.state = 'idle';
      e.x = 35 * TILE;
      e.z = 38 * TILE;
      e.fuel = e.maxFuel;
      e.ammo = e.maxAmmo;
    }
  }

  // A stunningly simple deterministic frame: no menu, no HUD, no music.
  app.audio?.stopMenuMusic?.();
  app.audio?.stopMatchMusic?.();
  hide('menu-screen');
  hide('loading-screen');
  hide('intro-screen');
  hide('pause-screen');
  hide('hud-root');
  document.documentElement.classList.remove('booting');

  app.game = game;
  app.screen = 'battle';
  app.paused = true;
  app.speed = 0;
  app.accumulator = 0;
  app.lastEventSeq = 0;
  app.victoryShown = 'none';
  app.selected = [];
  app.mode = 'none';
  app.placeDefId = null;
  app.renderer.settings.effects = true;
  app.renderer.settings.shake = options.shake ?? false;
  app.renderer.settings.showFog = !!scenario.settings.fog;
  app.renderer.setGame(game);
  app.renderer.setSimulationAlpha(0.5);
  app.resize();
  app.hud.mount(game);
  // Mounting/resizing the HUD can re-frame the battle; apply the probe camera
  // last so a scene always lands on its authored centre.
  app.renderer.camera.setScreenLift(0, 0);
  app.renderer.camera.setZoom(options.zoom ?? 36);
  app.renderer.camera.centerOn(spec.cx, spec.cz);

  // Give both sides an explicit contact. Units are not left to wander into
  // range, so every capture starts from the same tick-zero disposition.
  for (const [attacker, defender] of [[0, 1], [1, 0]]) {
    const ids = visibleIds(game, attacker, 'unit');
    const targets = visibleIds(game, defender, 'unit');
    if (ids.length === 0 || targets.length === 0) continue;
    game.enqueueCommand({ type: 'attack', team: game.player(attacker).team, ids, targetId: targets[0] });
  }
  if (spec.attackStructure) {
    const ids = visibleIds(game, 0, 'unit');
    const target = game.entitiesOf(1, 'building').find((e) => e.defId === spec.attackStructure);
    if (ids.length > 0 && target) {
      game.enqueueCommand({ type: 'attack', team: game.player(0).team, ids, targetId: target.id });
    }
  }

  const camera = app.renderer.camera;
  // Keep the true renderer methods on the instance so staging a second scene
  // does not capture the previous probe's no-op wrappers.
  const frame = app.renderer.__combatRealRender ?? app.renderer.render.bind(app.renderer);
  const realUpdate = app.renderer.__combatRealUpdate ?? app.renderer.update.bind(app.renderer);
  app.renderer.__combatRealRender = frame;
  app.renderer.__combatRealUpdate = realUpdate;
  app.renderer.update = () => {};
  app.renderer.render = () => {};
  frame();

  const probe = {
    kind,
    label: scene.label,
    app,
    game,
    camera,
    renderer: app.renderer,
    /** Advance simulation and presentation together. */
    step(ticks = 1, dt = 0.05) {
      for (let i = 0; i < ticks; i++) {
        game.tick();
        realUpdate(dt);
      }
      frame();
      return probe.summary();
    },
    stepUntilEvent(type, weaponId = null, maxTicks = 400) {
      const start = game.state.eventSeq;
      for (let i = 0; i < maxTicks; i++) {
        game.tick();
        realUpdate(0.05);
        const ev = game.state.events.find(
          (e) => e.seq > start && e.type === type && (!weaponId || e.weaponId === weaponId),
        );
        if (ev) {
          frame();
          return { ...ev, stepped: i + 1, ...probe.summary() };
        }
      }
      frame();
      return null;
    },
    stepUntilProjectile(weaponId, maxTicks = 400) {
      for (let i = 0; i < maxTicks; i++) {
        game.tick();
        realUpdate(0.02);
        if (game.state.projectiles.some((p) => p.weaponId === weaponId)) {
          app.renderer.setSimulationAlpha(0.5);
          frame();
          return probe.summary();
        }
      }
      frame();
      return null;
    },
    run(seconds = 6) {
      return probe.step(Math.round(seconds * 20));
    },
    /** Consume already-emitted events without advancing the simulation. */
    flush(dt = 0.05) {
      realUpdate(dt);
      frame();
      return probe.summary();
    },
    summary() {
      const seen = { units: 0, buildings: 0, projectiles: 0, particles: 0, wrecks: 0, events: 0 };
      for (const e of game.state.entities) {
        if (e.hp <= 0) continue;
        if (e.kind === 'unit') seen.units++;
        else seen.buildings++;
      }
      seen.projectiles = game.state.projectiles.length;
      seen.particles = app.renderer.particles.particles.length;
      seen.wrecks = app.renderer.wrecks.length;
      seen.events = game.state.events.length;
      return { ...seen, tick: game.state.tick, camera: { cx: camera.cx, cz: camera.cz, zoom: camera.zoom } };
    },
    /** Kill armoured targets through the real damage path to pressure the wreck cap. */
    wreckPressure(count = 30) {
      for (let i = 0; i < count; i++) {
        const x = (24 + (i % 6) * 3) * TILE;
        const z = (32 + Math.floor(i / 6) * 3) * TILE;
        const tank = game.spawnUnit(1, 'tank', x, z);
        game.damageEntity(tank, 99999, 0, 0, 'tankGun');
      }
      realUpdate(0.05);
      frame();
      return { spawned: count, wrecks: app.renderer.wrecks.length, particles: app.renderer.particles.particles.length };
    },
    clearWrecks() {
      app.renderer.wrecks.clear();
      frame();
    },
    /** Same draw-call / CPU-submission protocol as tools/visual-probe.js. */
    async measure(frames = 8) {
      const { measureFrame } = await import('/tools/visual-probe.js');
      app.renderer.render = frame;
      const stats = measureFrame(app.renderer.gl, app.renderer, frames);
      app.renderer.render = () => {};
      return stats;
    },
    /**
     * Read the rendered framebuffer directly. The tab may be minimised, so a
     * browser screenshot is not always available; this is the same frame the
     * renderer just submitted, not a mesh-viewer substitute.
     */
    async capture(name, maxWidth = 1600) {
      frame();
      const gl = app.renderer.gl;
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const source = document.createElement('canvas');
      source.width = w;
      source.height = h;
      const sourceCtx = source.getContext('2d');
      const image = sourceCtx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        image.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      }
      sourceCtx.putImageData(image, 0, 0);
      const scale = Math.min(1, maxWidth / w);
      const outW = Math.max(1, Math.round(w * scale));
      const outH = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      canvas.getContext('2d').drawImage(source, 0, 0, outW, outH);
      const data = canvas.toDataURL('image/png');
      await fetch(`http://127.0.0.1:5201/save?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        mode: 'no-cors',
        body: data,
      });
      return { name, width: outW, height: outH };
    },
    restore() {
      app.renderer.update = realUpdate;
      app.renderer.render = frame;
      app.screen = 'menu';
      app.game = null;
      app.renderer.setGame(null);
      show('menu-screen');
      show('hud-root');
    },
  };
  window.__combatProbe = probe;
  window.__combatSummary = probe.summary();
  return { kind, label: scene.label, ...window.__combatSummary, spec };
}

/** Capture the current staged frame through the audit PNG sink. */
export async function capture(name, maxWidth = 1600) {
  const probe = window.__combatProbe;
  if (!probe) throw new Error('Stage a combat scene first.');
  return probe.capture(name, maxWidth);
}

/** Re-centre without restaging, for a second angle or a tighter crop. */
export function frameAt(x, z, zoom = 36) {
  const probe = window.__combatProbe;
  if (!probe) throw new Error('Stage a combat scene first.');
  probe.camera.setZoom(zoom);
  probe.camera.centerOn(x, z);
  probe.renderer.render();
  return { cx: probe.camera.cx, cz: probe.camera.cz, zoom: probe.camera.zoom };
}
