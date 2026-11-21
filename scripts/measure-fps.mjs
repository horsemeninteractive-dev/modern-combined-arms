/**
 * End-to-end frame rate, measured in a real headed browser.
 *
 * The GPU probe in src/perf/probe.ts answers "how long does the frame take on
 * the GPU", and it does that well, but it stops at the end of the render: the
 * swap, the compositor and the display's own cadence are outside the timer
 * query. So 13.8 ms of GPU work tells you nothing about whether the player is
 * seeing 60, 90 or 20 frames a second.
 *
 * This launches headed Chromium against the dev server, loads a battle, stresses
 * it to a real entity count, and records the interval between successive
 * requestAnimationFrame callbacks. Those intervals are what the browser's frame
 * scheduler actually produces, so they carry the cost of the whole pipeline:
 * simulation, draw submission, render, present, and every frame the compositor
 * dropped because the main thread or the GPU missed the display deadline.
 *
 * Three things would otherwise make the reading a lie, so each is checked:
 *
 * - An occluded window stops presenting. Chromium throttles rAF to about 1 Hz
 *   there, which reports as one frame per second no matter how fast the game
 *   is. `looksThrottled` recognises that 1 Hz signature, and the run escalates
 *   the window to fullscreen, which nothing can cover.
 * - The display's own cadence is not the game's. A blank page is sampled first,
 *   in the same browser, to get the ceiling this machine can present at.
 * - A newly started battle compiles shaders and builds terrain in its first
 *   frames. That is startup, so every sample is taken after a warm-up.
 *
 * Usage:
 *   npm run fps                    # 300 entities, 6 s samples, dev server :5191
 *   npm run fps -- --entities 500 --seconds 10 --url http://127.0.0.1:5173/
 *   npm run fps -- --json tmp/fps.json       # keep the raw samples
 *   npm run fps -- --configs high,medium,low  # end-to-end cost of each preset
 *
 * The `--configs` matrix applies each named configuration to the live battle and
 * samples it, twice, in opposite orders. That is what a preset is worth in real
 * frames at the entity count that matters, rather than one effect's GPU time.
 *
 * The handles it uses (`window.mca`, `window.mcaPerf`) exist in development
 * builds only, so point this at `npm run dev`, not at `dist`.
 */

import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
};
const number = (name, fallback) => {
  const value = Number(option(name, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const url = String(option('url', 'http://127.0.0.1:5191/'));
const targetEntities = Math.round(number('entities', 300));
const seconds = number('seconds', 6);
const warmupSeconds = number('warmup', 2);
const jsonPath = option('json', null);
// Fullscreen by default: an occlusion throttle reads as one frame per second,
// and a fully covered window is the one thing that reliably triggers it.
const stayWindowed = Boolean(option('windowed', false));
const configList = option('configs', null);
// Freeze the simulation but keep rendering. The difference between a paused and
// a running sample at the same entity count is what the simulation costs; what
// remains is the renderer and the present.
const paused = Boolean(option('paused', false));

/**
 * What the matrix can measure. Each entry applies a preset or the authored look
 * with one switch moved, so a delta is attributable to that switch alone.
 */
const CONFIG_TABLE = {
  high: { preset: 'high' },
  medium: { preset: 'medium' },
  low: { preset: 'low' },
  'high-no-ao': { preset: 'high', override: { ambientOcclusion: false } },
  'high-no-contact': { preset: 'high', override: { contactShadows: false } },
  'high-no-silhouettes': { preset: 'high', override: { silhouettes: false } },
  'high-no-reflections': { preset: 'high', override: { screenSpaceReflections: false } },
  'high-no-water': { preset: 'high', override: { waterDetail: false } },
  'high-basic-shadows': { preset: 'high', override: { shadowDetail: 'basic' } },
  'high-no-shadows': { preset: 'high', override: { shadowDetail: 'off' } },
  'high-no-bloom': { preset: 'high', override: { bloom: false } },
  'high-scale-0.7': { preset: 'high', override: { renderScale: 0.7 } },
  'high-scale-0.8': { preset: 'high', override: { renderScale: 0.8 } },
  'high-no-ao-contact': { preset: 'high', override: { ambientOcclusion: false, contactShadows: false } },
  'medium-no-bloom': { preset: 'medium', override: { bloom: false } },
  'medium-full-res': { preset: 'medium', override: { renderScale: 1 } },
  'low-no-silhouettes': { preset: 'low', override: { silhouettes: false } },
};

const round = (value, places = 2) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

function percentiles(values, points) {
  const sorted = values.slice().sort((a, b) => a - b);
  const out = {};
  for (const point of points) {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round((point / 100) * (sorted.length - 1))));
    out[`p${point}`] = round(sorted[index]);
  }
  return out;
}

/**
 * Sample rAF intervals in the page for `ms`. Runs on the page's own frame
 * scheduler, so it sees exactly the cadence the game's loop is running at.
 * Passed to `page.evaluate` as a function, so it must not close over anything
 * in this module.
 */
function sampleFrames(ms) {
  return new Promise((resolve) => {
    const intervals = [];
    let previous = 0;
    const started = performance.now();
    const step = (timestamp) => {
      if (previous) intervals.push(timestamp - previous);
      previous = timestamp;
      if (timestamp - started < ms) requestAnimationFrame(step);
      else resolve({ intervals, elapsed: performance.now() - started });
    };
    requestAnimationFrame(step);
  });
}

/**
 * Chromium's occlusion throttle fires rAF on a one-second timer, so the
 * intervals pile up at almost exactly 1000 ms against a real display cadence of
 * 16.7 or 11.1. Nothing a game does produces that shape, which is what makes it
 * safe to test for and escalate on.
 */
function looksThrottled(intervals) {
  if (!intervals.length) return false;
  const onTheTimer = intervals.filter((value) => Math.abs(value - 1000) < 80).length;
  return onTheTimer / intervals.length > 0.5;
}

/** The most common interval, which for an idle page is the display cadence. */
function modalInterval(intervals) {
  if (!intervals.length) return null;
  const buckets = new Map();
  for (const value of intervals) {
    const key = Math.round(value);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * @param cadence display refresh in ms, normally the blank-page control. Frames
 *   are bucketed by how many refreshes they took, so "2x" means one missed
 *   deadline and the reading does not depend on the game's own pacing.
 */
function describe(label, sample, cadence) {
  const { intervals, elapsed } = sample ?? {};
  if (!intervals || !intervals.length) return { label, error: 'no frames observed' };
  const sorted = intervals.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const step = cadence ?? modalInterval(intervals);
  const histogram = {};
  for (const value of intervals) {
    const bucket = Math.max(1, Math.round(value / step));
    histogram[`${bucket}x`] = (histogram[`${bucket}x`] ?? 0) + 1;
  }
  const late = intervals.filter((value) => value > step * 1.5).length;
  return {
    label,
    frames: intervals.length,
    seconds: round(elapsed / 1000),
    fpsMean: round((intervals.length / elapsed) * 1000),
    fpsMedian: round(1000 / median),
    msMedian: round(median),
    msMean: round(mean),
    cadenceMs: step,
    onTimeShare: round(((intervals.length - late) / intervals.length) * 100, 1),
    lateFrames: late,
    throttled: looksThrottled(intervals),
    histogram,
    ...percentiles(intervals, [5, 50, 95, 99]),
  };
}

const browser = await chromium.launch({
  headless: false,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
});

/**
 * Drive the OS window state.
 *
 * This matters more than it looks: a minimized window throttles
 * requestAnimationFrame to about 1 Hz, and a fully covered one does the same.
 * Either reads as "one frame per second" no matter how fast the game is. A
 * minimized window also refuses to go fullscreen until it is restored, which is
 * why normal state is always applied first.
 */
async function setWindowState(context, page, windowState) {
  // The browser session resolves window ids from a *page* target id, which only
  // a page-scoped session can report.
  const pageSession = await context.newCDPSession(page);
  const { targetInfo } = await pageSession.send('Target.getTargetInfo');
  await pageSession.detach();
  const session = await browser.newBrowserCDPSession();
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    if (windowState !== 'normal') {
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState } });
    }
  } finally {
    await session.detach();
  }
}

try {
  const context = await browser.newContext({ viewport: { width: 1281, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // A cold dev server transforms the whole module graph on first request, which
  // can take several seconds; that is startup, not a frame rate problem.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  // The probe is installed by a dynamic import from the app constructor, so it
  // lands a beat after `window.mca`.
  await page.waitForFunction(() => Boolean(window.mca && window.mcaPerf), null, { timeout: 30_000 }).catch(() => {
    throw new Error(
      `No window.mca/window.mcaPerf at ${url}. This harness needs the development server (npm run dev): the probe is compiled out of production builds.`,
    );
  });

  await page.bringToFront();
  await page.evaluate(async () => {
    const scenario = window.mca.deployScenario();
    await window.mca.startBattle(scenario);
  });
  await page.waitForFunction(
    () => Boolean(window.mca.game && window.mca.game.state.ready) && window.mca.screen === 'battle',
    null,
    { timeout: 30_000 },
  );
  // The battle brief is its own screen: nothing is simulated while it is up.
  await page.waitForFunction(() => window.mca.loading === false, null, { timeout: 30_000 }).catch(() => {});

  // Take the window before measuring, not after a bad sample: everything below
  // depends on the page actually presenting frames.
  let mode = stayWindowed ? 'windowed' : 'fullscreen';
  await setWindowState(context, page, stayWindowed ? 'normal' : 'fullscreen');
  await page.waitForTimeout(800);

  /**
   * Sample on the page, refusing to report a throttled reading. Something on
   * this desktop can minimize or cover the window mid-run, and a throttled
   * sample looks like a game running at one frame per second, so it is retaken
   * once in a foreground fullscreen window and then treated as a failure rather
   * than as a result.
   */
  const paced = async (label, ms, cadenceMs = null) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.bringToFront();
      const described = describe(label, await page.evaluate(sampleFrames, ms), cadenceMs);
      if (!described.throttled) return described;
      await setWindowState(context, page, 'fullscreen');
      await page.waitForTimeout(800);
      mode = 'fullscreen';
    }
    throw new Error(`${label}: throttled to about 1 Hz (window minimized or occluded); rerun with the window left alone`);
  };

  // Startup work (shader compile, terrain build, first paint, the AI opening
  // moves) is not the steady cost of the scene.
  await page.waitForTimeout(warmupSeconds * 1000);
  const probe = await paced('probe', 1200);
  const cadence = probe.cadenceMs;

  // Control: a page with no game in it, in the same browser at the same size.
  // Whatever cadence it achieves is the ceiling this machine can present at.
  const controlTab = await context.newPage();
  await controlTab.goto('about:blank');
  await controlTab.bringToFront();
  const controlSample = await controlTab.evaluate(sampleFrames, warmupSeconds * 1000);
  await controlTab.close();
  await page.bringToFront();
  const display = describe('display', controlSample, cadence);

  // A battle pauses itself when the page is hidden, which would measure a still
  // picture; clear it once the page is definitely running.
  await page.evaluate((freeze) => {
    window.mca.paused = freeze;
  }, paused);

  if (configList) {
    const names = String(configList).split(',').map((entry) => entry.trim()).filter(Boolean);
    for (const name of names) {
      if (!CONFIG_TABLE[name]) throw new Error(`unknown config "${name}"; known: ${Object.keys(CONFIG_TABLE).join(', ')}`);
    }
    const rows = [];
    // Interleaved short blocks, not one long block per config. A 300-entity
    // battle gets steadily more expensive as decals, wrecks and smoke pile up,
    // and a handheld GPU also sags as it heats: measured in sequential blocks,
    // the config that happens to run last always looks worst. Rotating the order
    // every block spreads that drift across all of them.
    const blocks = Math.max(2, Math.round(number('blocks', 5)));
    for (let block = 0; block < blocks; block++) {
      const shift = block % names.length;
      const order = [...names.slice(shift), ...names.slice(0, shift)];
      for (const name of order) {
        const applied = await page.evaluate(async (spec) => {
          const presets = await import('/src/settings.ts');
          const base = spec.preset
            ? {
                ...presets.GRAPHICS_PRESETS[spec.preset],
                graphicsQuality: spec.preset,
                nightLights: presets.presetNightLights(spec.preset),
              }
            : {};
          Object.assign(window.mca.settings, base, spec.override ?? {});
          window.mca.applySettings();
          window.mca.paused = Boolean(spec.paused);
          const have = window.mca.game.state.entities.length;
          if (have < spec.target) await window.mcaPerf.stress(spec.target - have);
          const gl = window.mca.renderer.gl;
          return {
            entities: window.mca.game.state.entities.length,
            buffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
          };
        }, { ...CONFIG_TABLE[name], target: targetEntities, paused });
        await page.waitForTimeout(250);
        const sample = await paced(name, seconds * 1000, cadence);
        // Simulation time is measured directly, and is the same work whatever
        // the visual settings are; it is reported so the frame budget has both
        // halves. The rest of the comparison is the fps sample itself: rAF
        // intervals, no instrumentation in the loop, nothing that can inflate
        // the very thing being measured.
        const cost = await page.evaluate(() => ({ sim: window.mcaPerf.sim(12) }));
        rows.push({ name, block, at: Date.now(), applied, ...sample, ...cost });
      }
    }

    const byName = new Map();
    for (const row of rows) {
      if (!byName.has(row.name)) byName.set(row.name, []);
      byName.get(row.name).push(row);
    }
    const med = (values) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const started = Math.min(...rows.map((row) => row.at));
    console.log(`\n--- configuration matrix (${blocks} interleaved blocks, ${seconds}s each) ---`);
    console.log('config                   sim ms   fps median   p50 ms   on time   entities   buffer');
    for (const name of names) {
      const samples = byName.get(name);
      const finite = (values) => values.filter((value) => Number.isFinite(value));
      const sim = finite(samples.map((row) => row.sim?.median));
      console.log(
        `${name.padEnd(24)} ${String(sim.length ? round(med(sim)) : 'n/a').padStart(6)}` +
          `       ${String(round(med(samples.map((row) => row.fpsMean)), 1)).padStart(6)}` +
          `   ${String(round(med(samples.map((row) => row.msMedian)))).padStart(6)}` +
          `   ${String(round(med(samples.map((row) => row.onTimeShare)), 1)).padStart(6)}%` +
          `   ${String(Math.round(med(samples.map((row) => row.applied.entities)))).padStart(8)}` +
          `   ${samples[0].applied.buffer}`,
      );
    }
    // Drift check: if the block means fall monotonically, this run overheated or
    // the battlefield loaded up, and the medians above are the only usable part.
    const blockMeans = [];
    for (let block = 0; block < blocks; block++) {
      const inBlock = rows.filter((row) => row.block === block);
      blockMeans.push(round(inBlock.reduce((sum, row) => sum + row.fpsMean, 0) / inBlock.length, 1));
    }
    console.log(`block means over ${round((Date.now() - started) / 1000)}s: ${blockMeans.join(' → ')} fps`);
    if (jsonPath) {
      await writeFile(String(jsonPath), JSON.stringify({ url, cadence, display, rows }, null, 2));
      console.log(`wrote ${jsonPath}`);
    }
    await browser.close();
    process.exit(0);
  }

  const baseline = await paced('battle', warmupSeconds * 1000, cadence);

  // Top up to the requested load rather than spawning blind: `stress` adds
  // units, so the count asked for is the difference.
  const loaded = await page.evaluate(async (target) => {
    const before = window.mca.game.state.entities.length;
    const added = await window.mcaPerf.stress(Math.max(0, target - before));
    return { before, ...added };
  }, targetEntities);

  // Two independent samples under load: the first still carries whatever the
  // stress itself disturbed (fresh units, a rebuild, the AI reacting to them),
  // the second is what the battle settles into.
  await page.waitForTimeout(warmupSeconds * 1000);
  const underLoad = await paced('load 1', seconds * 1000, cadence);
  const settled = await paced('load 2', seconds * 1000, cadence);

  const state = await page.evaluate(() => {
    const gl = window.mca.renderer.gl;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      entities: window.mca.game.state.entities.length,
      units: window.mca.game.state.entities.filter((entity) => entity.kind === 'unit').length,
      tick: window.mca.game.state.tick,
      paused: window.mca.paused,
      speed: window.mca.speed,
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      dpr: window.devicePixelRatio,
      drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      samples: gl.getParameter(gl.SAMPLES),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      // The in-app readout, computed from the same deltas over its own 60-frame
      // window, so it should agree with the samples above.
      perf: { ...window.mca.perf },
    };
  });

  const report = {
    url,
    mode,
    target: targetEntities,
    loaded,
    state,
    probe,
    display,
    baseline,
    underLoad,
    settled,
    errors: errors.slice(0, 5),
  };
  console.log(JSON.stringify(report, null, 2));

  const line = (entry) =>
    entry.error
      ? `${entry.label.padEnd(8)} no frames observed`
      : `${entry.label.padEnd(8)} ${String(entry.fpsMean).padStart(6)} fps mean   ` +
        `${String(entry.fpsMedian).padStart(6)} fps median   ` +
        `${String(entry.msMedian).padStart(6)} ms p50   ` +
        `${String(entry.onTimeShare).padStart(5)}% on time   ` +
        `buckets ${JSON.stringify(entry.histogram)}`;
  console.log('\n--- frame pacing ---');
  for (const entry of [display, baseline, underLoad, settled]) console.log(line(entry));
  console.log(
    `${state.entities} entities, ${state.units} units, ` +
      `${state.drawingBuffer.width}x${state.drawingBuffer.height} @ ${state.samples}x MSAA, ` +
      `display cadence ${cadence} ms, ${mode} window`,
  );

  if (jsonPath) {
    await writeFile(String(jsonPath), JSON.stringify(report, null, 2));
    console.log(`wrote ${jsonPath}`);
  }
} finally {
  await browser.close();
}
