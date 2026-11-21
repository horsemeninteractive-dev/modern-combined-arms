/**
 * Frame-rate harness that runs inside the battle page itself, in the Freebuff
 * preview's browser, instead of in a separate Playwright process.
 *
 * Why it lives on the page: the thing being measured is the interval between
 * successive `requestAnimationFrame` callbacks, which already includes the
 * simulation, draw submission, the render, the swap and every frame the
 * compositor dropped. Sampling that from the outside means a second browser, a
 * second window and CDP window-state pokes all sit between the observer and the
 * observed. Loading this module into the already-running page removes all of
 * that: the samples come from the same frame scheduler that drives the game.
 *
 * What it drives, all through development-only handles:
 *
 * - `window.mcaPerf.stress(n)` tops the battle up to a real entity count, so a
 *   reading is taken at the load the question is about rather than at whatever
 *   the scenario started with.
 * - `window.mca.settings` + `applySettings()` apply a preset, or the authored
 *   look with one switch moved, so a delta is attributable to that switch.
 * - `window.mca.paused` freezes the simulation while the renderer keeps
 *   drawing, which separates "costs frames" from "costs simulation".
 *
 * Controls against the ways this measurement lies to itself:
 *
 * - The display step is inferred from the frames, not assumed: the fastest
 *   frames in a sample are the ones that hit the deadline, and every other frame
 *   is a whole number of those steps late.
 * - Chromium's occlusion throttle fires rAF on a one-second timer, so intervals
 *   piled at ~1000 ms are recognised and flagged rather than reported as fps.
 * - A new battle compiles shaders and builds terrain in its first frames, so
 *   every sample is taken after a warm-up.
 * - The matrix interleaves short blocks with a rotating order. A long battle
 *   gets more expensive as wrecks and smoke accumulate and a handheld GPU sags
 *   as it heats, so a config measured only last always looks worst.
 *
 * Usage, from the preview's console, against the battle page on the dev server:
 *
 *   const { install } = await import('/scripts/preview-fps.js');
 *   install();
 *   await mcaFps.run({ entities: 300, seconds: 5, configs: ['high', 'medium', 'low'], blocks: 3 });
 *
 * `run()` returns immediately and records progress in `mcaFps.state`, so a long
 * matrix can be polled from the console or the browser panel without holding a
 * single evaluation open. `mcaFps.stop()` cancels after the current sample.
 */

/** What the matrix can measure: a preset, or the authored look with one switch moved. */
export const CONFIG_TABLE = {
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

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * Chromium's occlusion throttle fires rAF on a one-second timer, so a throttled
 * window piles intervals up at almost exactly 1000 ms. Nothing the game does
 * produces that shape, which is what makes it safe to test for.
 */
function looksThrottled(intervals) {
  if (!intervals.length) return false;
  const onTheTimer = intervals.filter((value) => Math.abs(value - 1000) < 80).length;
  return onTheTimer / intervals.length > 0.5;
}

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
 * Sample rAF intervals for `ms` on the page's own frame scheduler.
 * @returns {Promise<{intervals: number[], elapsed: number}>}
 */
export function sampleFrames(ms) {
  return new Promise((resolve) => {
    const intervals = [];
    let previous = 0;
    let settled = false;
    const started = performance.now();
    const finish = (stalled) => {
      if (settled) return;
      settled = true;
      resolve({ intervals, elapsed: performance.now() - started, stalled });
    };
    const step = (timestamp) => {
      if (settled) return;
      if (previous) intervals.push(timestamp - previous);
      previous = timestamp;
      if (timestamp - started < ms) requestAnimationFrame(step);
      else finish(false);
    };
    requestAnimationFrame(step);
    // A panel that stops presenting stops firing rAF with it. Never leave the
    // caller waiting on a page that is not drawing: report the stall instead.
    setTimeout(() => finish(true), ms + 1500);
  });
}

/**
 * The display step, inferred from the frames themselves.
 *
 * A blank-iframe control was tried first and abandoned: appending any element
 * to this page's body wedges its main thread in this Electron preview, so a
 * control that perturbs the DOM cannot be part of a frame measurement. Frames
 * still quantise to whole refreshes, so the fastest frames in a sample are the
 * ones that hit the display deadline and they define the step: ~16.7 ms on a
 * 60 Hz panel, multiples of it under load.
 */
export function cadenceFrom(intervals) {
  const finite = intervals.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!finite.length) return null;
  const fastest = finite[Math.floor(finite.length * 0.05)];
  return round(Math.min(33.4, Math.max(6.9, fastest)), 1);
}

/**
 * @param cadence display refresh in ms, normally the blank-iframe control.
 *   Frames are bucketed by how many refreshes they took, so "2x" means one
 *   missed deadline and the reading does not depend on the game's own pacing.
 */
export function describe(label, sample, cadence) {
  const { intervals, elapsed, stalled } = sample ?? {};
  if (!intervals || !intervals.length) return { label, error: 'no frames observed', stalled: Boolean(stalled) };
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
    stalled: Boolean(stalled),
    histogram,
    ...percentiles(intervals, [5, 50, 95, 99]),
  };
}

function readHud() {
  const mca = window.mca;
  const gl = mca.renderer?.gl;
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    entities: mca.game ? mca.game.state.entities.length : 0,
    units: mca.game ? mca.game.state.entities.filter((entity) => entity.kind === 'unit').length : 0,
    paused: mca.paused,
    screen: mca.screen,
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    dpr: window.devicePixelRatio,
    buffer: gl ? `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}` : null,
    samples: gl ? gl.getParameter(gl.SAMPLES) : null,
    renderer: gl ? (debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null,
    // The in-app readout, from the same deltas over its own window.
    perf: mca.perf ? { ...mca.perf } : null,
  };
}

/** Apply a matrix entry to the live battle and top the entity count up to target. */
export async function applyConfig(name, { entities = 300, paused = false } = {}) {
  const spec = CONFIG_TABLE[name];
  if (!spec) throw new Error(`unknown config "${name}"; known: ${Object.keys(CONFIG_TABLE).join(', ')}`);
  const presets = await import('/src/settings.ts');
  const base = spec.preset
    ? {
        ...presets.GRAPHICS_PRESETS[spec.preset],
        graphicsQuality: spec.preset,
        nightLights: presets.presetNightLights(spec.preset),
      }
    : {};
  const mca = window.mca;
  Object.assign(mca.settings, base, spec.override ?? {});
  mca.applySettings();
  mca.paused = paused;
  const have = mca.game ? mca.game.state.entities.length : 0;
  if (have < entities) await window.mcaPerf.stress(entities - have);
  const gl = mca.renderer.gl;
  return {
    entities: mca.game.state.entities.length,
    units: mca.game.state.entities.filter((entity) => entity.kind === 'unit').length,
    buffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
    renderScale: mca.settings.renderScale,
    shadowDetail: mca.settings.shadowDetail,
  };
}

export const state = {
  running: false,
  phase: 'idle',
  opts: null,
  rows: [],
  baseline: [],
      blockMeans: [],
    cadence: null,
    error: null,
    cancel: false,
    startedAt: 0,
    endedAt: 0,
};

function mediansByName() {
  const byName = new Map();
  for (const row of state.rows) (byName.get(row.name) ?? byName.set(row.name, []).get(row.name)).push(row);
  const med = (values) => {
    const finite = values.filter((value) => Number.isFinite(value));
    if (!finite.length) return null;
    const sorted = finite.slice().sort((a, b) => a - b);
    return round(sorted[Math.floor(sorted.length / 2)]);
  };
  const out = [];
  for (const [name, samples] of byName) {
    out.push({
      name,
      blocks: samples.length,
      simMs: med(samples.map((row) => row.sim?.median)),
      fpsMean: med(samples.map((row) => row.fpsMean)),
      fpsMedian: med(samples.map((row) => row.fpsMedian)),
      msMedian: med(samples.map((row) => row.msMedian)),
      p95: med(samples.map((row) => row.p95)),
      onTimeShare: med(samples.map((row) => row.onTimeShare)),
      entities: Math.round(med(samples.map((row) => row.applied.entities))),
      buffer: samples[0].applied.buffer,
      hudFps: med(samples.map((row) => row.hud?.perf?.fps)),
      hudFrameMs: med(samples.map((row) => row.hud?.perf?.frameMs)),
      throttled: samples.some((row) => row.throttled),
    });
  }
  return out;
}

function summary() {
  return {
    running: state.running,
    phase: state.phase,
    error: state.error,
    cancelled: state.cancel,
    seconds: state.endedAt ? round((state.endedAt - state.startedAt) / 1000) : null,
    opts: state.opts,
    cadence: state.cadence,
    baseline: state.baseline,
    blockMeans: state.blockMeans,
    configs: mediansByName(),
  };
}

/**
 * Run a measurement in the background. Returns as soon as it is started; poll
 * `mcaFps.state` for `phase` and `rows`, or `mcaFps.summary()` for medians.
 */
export async function run(options = {}) {
  if (state.running) return { running: true, phase: state.phase };
  const opts = {
    entities: Math.round(options.entities ?? 300),
    seconds: options.seconds ?? 6,
    warmup: options.warmup ?? 2,
    blocks: Math.max(2, Math.round(options.blocks ?? 5)),
    configs: options.configs ?? null,
    paused: Boolean(options.paused),
  };
  Object.assign(state, {
    running: true,
    phase: 'starting',
    opts,
    rows: [],
    baseline: [],
    blockMeans: [],
    error: null,
    cancel: false,
    startedAt: Date.now(),
    endedAt: 0,
  });
  try {
    if (!window.mca || !window.mcaPerf) {
      throw new Error('window.mca / window.mcaPerf missing: this needs the battle running from the dev server.');
    }
    state.phase = 'cadence probe';
    const probe = await sampleFrames(600);
    state.cadence = cadenceFrom(probe.intervals);

    state.phase = `warm-up ${opts.warmup}s`;
    await wait(opts.warmup * 1000);

    if (!opts.configs) {
      state.phase = 'baseline';
      state.baseline.push(describe('baseline', await sampleFrames(opts.seconds * 1000), state.cadence));
      state.phase = 'load 1';
      await applyConfig('high', { entities: opts.entities, paused: opts.paused });
      await wait(opts.warmup * 1000);
      state.baseline.push(describe('load 1', await sampleFrames(opts.seconds * 1000), state.cadence));
      state.phase = 'load 2';
      state.baseline.push(describe('load 2', await sampleFrames(opts.seconds * 1000), state.cadence));
    } else {
      const names = opts.configs;
      for (let block = 0; block < opts.blocks && !state.cancel; block++) {
        const shift = block % names.length;
        const order = [...names.slice(shift), ...names.slice(0, shift)];
        for (const name of order) {
          if (state.cancel) break;
          state.phase = `block ${block + 1}/${opts.blocks}: ${name}`;
          const applied = await applyConfig(name, { entities: opts.entities, paused: opts.paused });
          await wait(250);
          const described = describe(name, await sampleFrames(opts.seconds * 1000), state.cadence);
          state.rows.push({
            name,
            block,
            at: Date.now(),
            applied,
            hud: readHud(),
            sim: window.mcaPerf.sim(12),
            ...described,
          });
        }
        const inBlock = state.rows.filter((row) => row.block === block);
        state.blockMeans.push(
          round(inBlock.reduce((sum, row) => sum + row.fpsMean, 0) / Math.max(1, inBlock.length), 1),
        );
      }
    }
  } catch (error) {
    state.error = String(error?.stack || error);
  } finally {
    state.running = false;
    state.phase = state.error ? 'failed' : 'done';
    state.endedAt = Date.now();
  }
  return summary();
}

/** Stop after the sample in flight rather than mid-sample. */
export function stop() {
  state.cancel = true;
  return state.phase;
}

export function install() {
  window.mcaFps = {
    CONFIG_TABLE,
    sampleFrames,
    cadenceFrom,
    describe,
    applyConfig,
    run,
    stop,
    summary,
    state,
    get running() {
      return state.running;
    },
  };
  return Object.keys(CONFIG_TABLE).length;
}
