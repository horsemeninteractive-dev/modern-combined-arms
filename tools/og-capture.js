/**
 * Dev-only social-card staging probe.
 *
 * The install/manifest card needs a hero that reads at 1200×630: a fully built
 * base with its defenders under assault by a combined-arms force. No shipped
 * scenario stages that, so this tool authors it on Foundry District and freezes
 * the renderer at a chosen battle moment. It never ships in the bundle.
 *
 *   npm run dev
 *   open http://127.0.0.1:5173/ and wait for the menu
 *   await (await import('/tools/og-capture.js')).stageOg()
 *   screenshot the tab at 1200×630 (HUD hidden, fog off)
 *
 * `window.__ogProbe` keeps the staged app, game and helpers for the console.
 */

const TILE = 4;

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

const BASE = [
  // The mirrored red command post already sits at (94, 29); everything else
  // frames it into a compound in the open east yard.
  { defId: 'barracks', x: 87, z: 28 },
  { defId: 'powerPlant', x: 98, z: 28 },
  { defId: 'radar', x: 86, z: 33 },
  { defId: 'mgNest', x: 90, z: 33 },
  { defId: 'atTurret', x: 97, z: 34 },
  { defId: 'factory', x: 88, z: 36 },
  { defId: 'refinery', x: 93, z: 36 },
  { defId: 'samBattery', x: 90, z: 40 },
  { defId: 'bunker', x: 98, z: 40 },
];

const DEFENDERS = [
  { defId: 'tank', x: 92, z: 33 },
  { defId: 'tank', x: 95, z: 35 },
  { defId: 'tank', x: 89, z: 39 },
  { defId: 'rifle', x: 88, z: 30 },
  { defId: 'rifle', x: 96, z: 31 },
  { defId: 'rifle', x: 89, z: 40 },
  { defId: 'rifle', x: 94, z: 41 },
  { defId: 'atgm', x: 86, z: 36 },
  { defId: 'atgm', x: 99, z: 35 },
  { defId: 'spg', x: 100, z: 44 },
];

const ASSAULT = [
  // Three ranks of armour, infantry moving between them, and the fire support
  // echelon behind: the card has to read as a combined-arms assault, not a duel.
  { defId: 'tank', x: 82, z: 31 },
  { defId: 'tank', x: 85, z: 33 },
  { defId: 'tank', x: 81, z: 34 },
  { defId: 'tank', x: 84, z: 35 },
  { defId: 'tank', x: 80, z: 37 },
  { defId: 'tank', x: 83, z: 38 },
  { defId: 'tank', x: 86, z: 39 },
  { defId: 'tank', x: 81, z: 40 },
  { defId: 'tank', x: 84, z: 41 },
  { defId: 'tank', x: 82, z: 43 },
  { defId: 'rifle', x: 79, z: 33 },
  { defId: 'rifle', x: 85, z: 36 },
  { defId: 'rifle', x: 80, z: 35 },
  { defId: 'rifle', x: 83, z: 36 },
  { defId: 'rifle', x: 79, z: 39 },
  { defId: 'rifle', x: 84, z: 40 },
  { defId: 'rifle', x: 81, z: 42 },
  { defId: 'rifle', x: 79, z: 44 },
  { defId: 'atgm', x: 78, z: 35 },
  { defId: 'atgm', x: 86, z: 37 },
  { defId: 'atgm', x: 80, z: 46 },
  { defId: 'atgm', x: 85, z: 45 },
  { defId: 'spg', x: 76, z: 37 },
  { defId: 'spg', x: 76, z: 43 },
  { defId: 'mlrs', x: 76, z: 40 },
  { defId: 'recon', x: 75, z: 38 },
  // Second echelon: the assault has to look like it keeps coming.
  { defId: 'tank', x: 76, z: 33 },
  { defId: 'tank', x: 79, z: 35 },
  { defId: 'tank', x: 75, z: 38 },
  { defId: 'tank', x: 78, z: 40 },
  { defId: 'tank', x: 76, z: 43 },
  { defId: 'tank', x: 79, z: 45 },
  { defId: 'rifle', x: 74, z: 36 },
  { defId: 'rifle', x: 77, z: 39 },
  { defId: 'rifle', x: 75, z: 42 },
  { defId: 'rifle', x: 77, z: 44 },
];

/**
 * Compose the card's title lockup over the live frame. Kept in the scene so the
 * card is captured from the same renderer as the game, not assembled later in
 * an image editor.
 */
export function showCardOverlay() {
  if (document.getElementById('og-card')) return;
  const style = document.createElement('style');
  style.textContent = `
    /* The card is authored at its published size. The dev preview can lay the
       page out slightly wider than its capture region, so a viewport box would
       let the lockup fall outside the frame. */
    #og-card { position: fixed; left: 0; top: 0; width: 1200px; height: 630px; overflow: hidden;
      z-index: 9999; pointer-events: none;
      font-family: 'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
    #og-card .shade { position: absolute; inset: 0;
      background:
        linear-gradient(to top, rgba(4,7,10,0.97) 0%, rgba(4,7,10,0.9) 24%, rgba(4,7,10,0.35) 48%, rgba(4,7,10,0) 66%),
        linear-gradient(to right, rgba(4,7,10,0.82) 0%, rgba(4,7,10,0.28) 34%, rgba(4,7,10,0) 56%); }
    #og-card .lockup { position: absolute; left: 56px; bottom: 46px; display: flex; gap: 22px; align-items: flex-start; }
    #og-card .mark { width: 76px; height: 76px; filter: drop-shadow(0 2px 10px rgba(0,0,0,0.55)); }
    #og-card .kicker { font: 600 10px/1 'SFMono-Regular', 'Cascadia Mono', Consolas, monospace;
      letter-spacing: 0.34em; color: #b98d55; text-transform: uppercase; margin: 2px 0 10px; }
    #og-card h1 { margin: 0; font-family: 'Bahnschrift', 'DIN Alternate', 'DIN Condensed', 'Arial Narrow', sans-serif;
      font-stretch: 88%; font-size: 86px; line-height: 0.86; letter-spacing: 0.01em; color: #f4e7d0;
      text-shadow: 0 3px 18px rgba(0,0,0,0.65); }
    #og-card .sub { margin-top: 8px; font-family: 'Bahnschrift', 'DIN Alternate', 'DIN Condensed', 'Arial Narrow', sans-serif;
      font-stretch: 90%; font-size: 17px; letter-spacing: 0.4em; color: #f1c27e; }
    #og-card p { margin: 16px 0 0; max-width: 380px; font-size: 14px; line-height: 1.5; color: #cbbfae; }
    #og-card .url { position: absolute; right: 46px; bottom: 44px; font: 500 11px/1 'SFMono-Regular', 'Cascadia Mono', Consolas, monospace;
      letter-spacing: 0.18em; color: #8d8274; }
    #og-card .beta { position: absolute; right: 46px; top: 40px; font: 600 10px/1 'SFMono-Regular', 'Cascadia Mono', Consolas, monospace;
      letter-spacing: 0.24em; color: #f1c27e; border: 1px solid rgba(241,194,126,0.4); padding: 7px 10px 6px; background: rgba(4,7,10,0.55); }
  `;
  const card = document.createElement('div');
  card.id = 'og-card';
  card.innerHTML = `
    <div class="shade"></div>
    <div class="lockup">
      <img class="mark" src="/insignia.svg" alt="" />
      <div>
        <div class="kicker">Combined-arms real-time strategy</div>
        <h1>MCA</h1>
        <div class="sub">MODERN COMBINED ARMS</div>
        <p>Author an island. Raise a base, hold the line, and break an armoured assault across land, air and sea.</p>
      </div>
    </div>
    <div class="beta">BETA</div>
    <div class="url">moderncombinedarms.pages.dev</div>`;
  document.head.appendChild(style);
  document.body.appendChild(card);
}

/**
 * Draw the published card offline from the live WebGL frame. The dev preview's
 * screenshot carries the host app's own badge in the corner, so the asset is
 * composed from the canvas and returned as a data URL instead of captured with
 * the browser chrome.
 */
export async function exportCard() {
  const gl = document.getElementById('gl');
  if (!gl) throw new Error('The battlefield canvas is missing.');
  const W = 1200;
  const H = 630;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable.');
  // The WebGL drawing buffer is not preserved between tasks, so the scene has
  // to be re-rendered in this same turn before it is copied.
  window.__ogProbe?.renderNow?.();
  ctx.drawImage(gl, 0, 0, W, H);

  const vertical = ctx.createLinearGradient(0, H, 0, 0);
  vertical.addColorStop(0, 'rgba(4,7,10,0.97)');
  vertical.addColorStop(0.24, 'rgba(4,7,10,0.9)');
  vertical.addColorStop(0.48, 'rgba(4,7,10,0.35)');
  vertical.addColorStop(0.66, 'rgba(4,7,10,0)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, W, H);
  const horizontal = ctx.createLinearGradient(0, 0, W, 0);
  horizontal.addColorStop(0, 'rgba(4,7,10,0.82)');
  horizontal.addColorStop(0.34, 'rgba(4,7,10,0.28)');
  horizontal.addColorStop(0.56, 'rgba(4,7,10,0)');
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, W, H);

  const insignia = new Image();
  insignia.src = '/insignia.svg';
  await insignia.decode();
  const left = 56;
  const blockTop = 396;
  ctx.drawImage(insignia, left, blockTop, 76, 76);

  const textX = left + 76 + 22;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#b98d55';
  ctx.font = '600 10px "Cascadia Mono", Consolas, monospace';
  ctx.letterSpacing = '3.4px';
  ctx.fillText('COMBINED-ARMS REAL-TIME STRATEGY', textX, blockTop);

  ctx.fillStyle = '#f4e7d0';
  ctx.font = '86px Bahnschrift, "DIN Alternate", "Arial Narrow", sans-serif';
  ctx.letterSpacing = '1px';
  ctx.fillText('MCA', textX, blockTop + 16);

  ctx.fillStyle = '#f1c27e';
  ctx.font = '17px Bahnschrift, "DIN Alternate", "Arial Narrow", sans-serif';
  ctx.letterSpacing = '6.8px';
  ctx.fillText('MODERN COMBINED ARMS', textX, blockTop + 104);

  ctx.fillStyle = '#cbbfae';
  ctx.font = '14px "Inter", "Segoe UI", Arial, sans-serif';
  ctx.letterSpacing = '0px';
  ctx.fillText('Author an island. Raise a base, hold the line, and break an', textX, blockTop + 144);
  ctx.fillText('armoured assault across land, air and sea.', textX, blockTop + 165);

  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#8d8274';
  ctx.font = '500 11px "Cascadia Mono", Consolas, monospace';
  ctx.letterSpacing = '2px';
  ctx.fillText('moderncombinedarms.pages.dev', W - 46, H - 44);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#f1c27e';
  ctx.font = '600 10px "Cascadia Mono", Consolas, monospace';
  ctx.letterSpacing = '2.4px';
  const beta = 'BETA';
  const betaW = ctx.measureText(beta).width;
  ctx.fillStyle = 'rgba(4,7,10,0.55)';
  ctx.fillRect(W - 46 - betaW - 20, 40, betaW + 20, 26);
  ctx.strokeStyle = 'rgba(241,194,126,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(W - 46 - betaW - 20, 40, betaW + 20, 26);
  ctx.fillStyle = '#f1c27e';
  ctx.fillText(beta, W - 46 - betaW - 10, 48);

  // JPEG keeps the returned data URL small enough to write from a probe log;
  // the card carries photography-like game art, so the loss is invisible.
  return { dataUrl: out.toDataURL('image/jpeg', 0.92), size: [W, H] };
}

export async function stageOg(options = {}) {
  const app = window.ironTide;
  if (!app) throw new Error('Open the game page first: window.ironTide is missing.');
  const [sim, data, maps] = await Promise.all([
    import('/src/sim/game.ts'),
    import('/src/data/scenarios.ts'),
    import('/src/data/maps.ts'),
  ]);
  const { Game } = sim;
  const scenario = maps.createFoundryDistrict();

  // The city and its landmarks stay: that is the backdrop behind the assault.
  // The shipped landing parties are replaced by the staged battle.
  scenario.units = [];
  scenario.settings.fog = false;
  // Both command posts stay: the map's own victory check reads them, and the
  // blue one sits at the far west end, outside the card's frame.
  for (const structure of BASE) scenario.structures.push({ ...structure, owner: 1 });
  for (const unit of DEFENDERS) scenario.units.push({ ...unit, owner: 1 });
  for (const unit of ASSAULT) scenario.units.push({ ...unit, owner: 0 });

  const game = new Game(scenario, { localPlayerId: 0, enableAI: false });

  app.audio?.stopMenuMusic?.();
  app.audio?.stopMatchMusic?.();
  hide('menu-screen');
  hide('loading-screen');
  hide('intro-screen');
  hide('pause-screen');
  hide('hud-root');
  // The overlay canvas draws hover labels and selection brackets; a card frame
  // must not carry a tooltip for whatever the pointer happened to rest on.
  hide('overlay');
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
  app.renderer.settings.shake = false;
  app.renderer.settings.showFog = false;
  app.renderer.setGame(game);
  app.renderer.setSimulationAlpha(0.5);
  app.resize();
  app.hud.mount(game);
  app.renderer.camera.setScreenLift(0, 0);
  app.renderer.camera.setZoom(options.zoom ?? 30);
  app.renderer.camera.centerOn((options.x ?? 89) * TILE, (options.z ?? 37) * TILE);

  const hq = game.entitiesOf(1, 'building').find((e) => e.defId === 'commandPost');
  const leadTank = game.entitiesOf(0, 'unit').find((e) => e.defId === 'tank');
  const assaultIds = game.entitiesOf(0, 'unit').map((e) => e.id);
  const defenderIds = game.entitiesOf(1, 'unit').map((e) => e.id);
  if (hq && assaultIds.length > 0) {
    game.enqueueCommand({ type: 'attack', team: 0, ids: assaultIds, targetId: hq.id });
  }
  if (leadTank && defenderIds.length > 0) {
    game.enqueueCommand({ type: 'attack', team: 1, ids: defenderIds, targetId: leadTank.id });
  }

  const camera = app.renderer.camera;
  const frame = app.renderer.__ogRealRender ?? app.renderer.render.bind(app.renderer);
  const realUpdate = app.renderer.__ogRealUpdate ?? app.renderer.update.bind(app.renderer);
  app.renderer.__ogRealRender = frame;
  app.renderer.__ogRealUpdate = realUpdate;
  app.renderer.update = () => {};
  app.renderer.render = () => {};
  frame();

  const probe = {
    app,
    game,
    camera,
    /** Advance simulation and presentation together. */
    step(ticks = 1, dt = 0.05) {
      for (let i = 0; i < ticks; i++) {
        game.tick();
        realUpdate(dt);
      }
      frame();
      return probe.summary();
    },
    /** Advance until the battle is visibly under way, then hold the frame. */
    stepToContact(maxTicks = 600, explosions = 5) {
      let seen = 0;
      for (let i = 0; i < maxTicks; i++) {
        game.tick();
        realUpdate(0.05);
        seen = game.state.events.filter((e) => e.type === 'explosion' || e.type === 'impact').length;
        if (seen >= explosions) {
          probe.step(3);
          return { ...probe.summary(), contactTick: i, effectsSeen: seen };
        }
      }
      frame();
      return { ...probe.summary(), contactTick: null, effectsSeen: seen };
    },
    reframe(x, z, zoom) {
      camera.setZoom(zoom);
      camera.centerOn(x * TILE, z * TILE);
      frame();
    },
    renderNow() {
      frame();
    },
    summary() {
      return {
        tick: game.state.tick,
        projectiles: game.state.projectiles.length,
        units: game.state.entities.filter((e) => e.kind === 'unit' && e.hp > 0).length,
        buildings: game.state.entities.filter((e) => e.kind === 'building' && e.hp > 0).length,
        events: game.state.events.length,
      };
    },
  };
  window.__ogProbe = probe;
  if (options.card) showCardOverlay();
  return probe.summary();
}
