/**
 * Development-only profiling probe.
 *
 * Two things make the battlefield's cost easy to misread, and this probe exists
 * to defeat both:
 *
 * 1. Draw calls and triangles do not describe it. The post chain, the MSAA
 *    resolve and the present are fullscreen work: each submits as a single
 *    three-vertex draw, so a pass that costs milliseconds looks free in any
 *    per-draw or per-triangle accounting. Ambient occlusion alone is a 12-tap
 *    kernel plus two depth-aware blurs at full resolution.
 *
 * 2. Frame-time sampling cannot see it in a backgrounded or offscreen tab,
 *    because requestAnimationFrame stops there entirely (it reports zero ticks
 *    while the page is hidden, not a slow rate). A "12 fps" reading taken that
 *    way is the tab's throttling, not the game.
 *
 * So this times the GPU with EXT_disjoint_timer_query_webgl2 while driving
 * frames by hand, which needs no rAF and gives identical numbers whether or not
 * the page is visible, and breaks the post chain down per effect.
 *
 * Attached in development only, as `window.mcaPerf`.
 */

import { TILE_SIZE } from '../sim/constants';

type ProbePost = {
  options: { ao: number; bloom: number; contact: number };
  bindScene: () => void;
  end: () => void;
};

type ProbeApp = {
  game: {
    state: { entities: Array<{ kind: string; x?: number; z?: number }> };
    tick: () => void;
    spawnUnit?: (owner: number, defId: string, x: number, z: number) => unknown;
  } | null;
  renderer: { gl: WebGL2RenderingContext; post: ProbePost; render: () => void };
  frame: (time: number) => void;
};

const round = (value: number): number => Math.round(value * 100) / 100;

function median(values: number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  const sorted = finite.slice().sort((a, b) => a - b);
  return round(sorted[Math.floor(sorted.length / 2)]);
}

function summarise(values: number[]): { median: number | null; min: number | null; max: number | null; n: number } {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return { median: null, min: null, max: null, n: 0 };
  return {
    median: median(finite),
    min: round(Math.min(...finite)),
    max: round(Math.max(...finite)),
    n: finite.length,
  };
}

export interface PerfProbe {
  /**
   * GPU milliseconds per full frame at the current entity count.
   *
   * Only clean while requestAnimationFrame is idle (a hidden tab). In a visible
   * tab the hand-driven frames interleave with the animation loop and the GPU
   * queue carries both, which roughly doubles the reading.
   */
  frame(rounds?: number): Promise<{ gpu: ReturnType<typeof summarise>; entities: number }>;
  /**
   * CPU wall time of `Game.tick()` alone, with the simulation advanced by hand.
   *
   * This is the cost the renderer cannot see and cannot hide: one tick of the
   * whole authoritative state. It is timed directly rather than inferred from
   * a frame, because a hand-driven frame catches up with a variable number of
   * ticks and so charges the CPU for however many the loop happened to run.
   */
  sim(rounds?: number): ReturnType<typeof summarise>;
  /** GPU milliseconds for the post chain with each effect switched off in turn. */
  post(rounds?: number): Promise<Record<string, ReturnType<typeof summarise>>>;
  /** Spawn `count` extra units around the current army so the frame carries a real load. */
  stress(count?: number): Promise<{ entities: number; units: number }>;
  /** Everything at once: entity count, frame cost, post breakdown. */
  report(count?: number): Promise<unknown>;
}

export function installPerfProbe(appLike: unknown): PerfProbe | null {
  const app = appLike as ProbeApp;
  if (!app || !app.renderer || !app.renderer.gl) return null;
  const gl = app.renderer.gl;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) {
    console.warn('[mcaPerf] EXT_disjoint_timer_query_webgl2 is unavailable; GPU timings need ANGLE/D3D11 or Metal.');
    return null;
  }

  /**
   * One timed batch. The query is polled rather than awaited with a flush, so
   * the GPU is never stalled by the measurement itself.
   */
  const timed = (draw: () => void): Promise<number> =>
    new Promise((resolve) => {
      const query = gl.createQuery();
      if (!query) {
        resolve(Number.NaN);
        return;
      }
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      draw();
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      const poll = (): void => {
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
          setTimeout(poll, 4);
          return;
        }
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
        const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
        gl.deleteQuery(query);
        resolve(disjoint ? Number.NaN : nanoseconds / 1e6);
      };
      poll();
    });

  const entities = (): number => (app.game ? app.game.state.entities.length : 0);

  const frame: PerfProbe['frame'] = async (rounds = 8) => {
    const gpu: number[] = [];
    for (let i = 0; i < rounds; i++) {
      gpu.push(await timed(() => app.frame(performance.now())));
    }
    return { gpu: summarise(gpu), entities: entities() };
  };

  const sim: PerfProbe['sim'] = (rounds = 20) => {
    const game = app.game;
    if (!game) return summarise([]);
    // One untimed tick first, so a warm-up cost (a freshly built spatial index)
    // does not land in the sample that is reported.
    game.tick();
    const ticks: number[] = [];
    for (let i = 0; i < rounds; i++) {
      const started = performance.now();
      game.tick();
      ticks.push(performance.now() - started);
    }
    return summarise(ticks);
  };

  const post: PerfProbe['post'] = async (rounds = 5) => {
    const pipeline = app.renderer.post;
    const saved = { ...pipeline.options };
    const variants = [
      { id: 'all', options: { ao: saved.ao, bloom: saved.bloom, contact: saved.contact } },
      { id: 'no AO', options: { ao: 0, bloom: saved.bloom, contact: saved.contact } },
      { id: 'no contact', options: { ao: saved.ao, bloom: saved.bloom, contact: 0 } },
      { id: 'no bloom', options: { ao: saved.ao, bloom: 0, contact: saved.contact } },
      { id: 'composite only', options: { ao: 0, bloom: 0, contact: 0 } },
    ];
    const samples: Record<string, number[]> = {};
    try {
      for (let round = 0; round < rounds; round++) {
        for (const variant of variants) {
          pipeline.options.ao = variant.options.ao;
          pipeline.options.bloom = variant.options.bloom;
          pipeline.options.contact = variant.options.contact;
          const ms = await timed(() => {
            pipeline.bindScene();
            pipeline.end();
          });
          (samples[variant.id] ??= []).push(ms);
        }
      }
    } finally {
      pipeline.options.ao = saved.ao;
      pipeline.options.bloom = saved.bloom;
      pipeline.options.contact = saved.contact;
    }
    const out: Record<string, ReturnType<typeof summarise>> = {};
    for (const key of Object.keys(samples)) out[key] = summarise(samples[key]);
    return out;
  };

  const stress: PerfProbe['stress'] = async (count = 260) => {
    const game = app.game;
    if (!game || !game.spawnUnit) return { entities: entities(), units: 0 };
    const units = game.state.entities.filter((entity) => entity.kind === 'unit');
    let sumX = 0;
    let sumZ = 0;
    for (const unit of units) {
      sumX += unit.x ?? 0;
      sumZ += unit.z ?? 0;
    }
    const centreX = units.length ? sumX / units.length : 0;
    const centreZ = units.length ? sumZ / units.length : 0;
    const defs = ['rifle', 'rifle', 'rifle', 'atgm', 'tank', 'engineer', 'harvester'];
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399963;
      const radius = (0.6 + Math.sqrt(i) * 1.5) * TILE_SIZE;
      try {
        game.spawnUnit(i % 2, defs[i % defs.length], centreX + Math.cos(angle) * radius, centreZ + Math.sin(angle) * radius);
      } catch {
        break;
      }
    }
    // Vision updates on an interval; without a few ticks the new units are not
    // in the render list and the frame keeps its old cost.
    for (let i = 0; i < 14; i++) game.tick();
    return { entities: entities(), units: game.state.entities.filter((entity) => entity.kind === 'unit').length };
  };

  const report: PerfProbe['report'] = async (count = 260) => {
    const before = entities();
    const loaded = await stress(count);
    return {
      before,
      loaded,
      frame: await frame(),
      sim: sim(),
      post: await post(),
      gl: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, samples: gl.getParameter(gl.SAMPLES) },
    };
  };

  const probe: PerfProbe = { frame, sim, post, stress, report };
  (window as unknown as { mcaPerf?: PerfProbe }).mcaPerf = probe;
  return probe;
}
