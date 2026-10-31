/**
 * Phase 2A.8 local A/B benchmark: old vs new pathfinding allocation paths.
 *
 * Loads the current source and a reconstructed pre-optimisation source tree
 * (tmp/phase2a8-old/src) in one Node process. Both run the real Game and the
 * real calibration workload; no synthetic pathfinding substitute is used for
 * the game tasks. Measurements are block throughput: a batch of prepared
 * worlds is run inside one timed window, alternating old/new order per block.
 * This is more stable than timing individual 10 ms commands.
 *
 * These are local wall-clock measurements, not Cloudflare Worker CPU time.
 * Heap deltas are coarse one-burst observations after a forced GC; they show
 * direction and rough size, not exact bytes.
 *
 * Usage: node --expose-gc tools/phase2a8-pathfinding-benchmark.mjs
 */

import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const OLD_MODULE = '/tmp/phase2a8-old/src/multiplayer/batchCalibration.ts';
const OUT = path.join(
  ROOT,
  'staging-evidence',
  `phase2a8-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
const BLOCKS = 8;
const BATCH = 24;
const MEMORY_REPS = 12;
const ASTAR_SEARCHES = 2000;

if (typeof global.gc !== 'function') {
  console.error('Run with: node --expose-gc tools/phase2a8-pathfinding-benchmark.mjs');
  process.exit(2);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
}

function groundIdsFor(game, owner, UNITS) {
  return game.state.entities
    .filter(
      (entity) =>
        entity.kind === 'unit' &&
        entity.hp > 0 &&
        entity.owner === owner &&
        UNITS[entity.defId]?.domain !== 'air',
    )
    .map((entity) => entity.id)
    .sort((a, b) => a - b);
}

async function main() {
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const current = await server.ssrLoadModule('/src/multiplayer/batchCalibration.ts');
    const previous = await server.ssrLoadModule(OLD_MODULE);
    const currentPathfinding = await server.ssrLoadModule('/src/sim/pathfinding.ts');
    const previousPathfinding = await server.ssrLoadModule(
      '/tmp/phase2a8-old/src/sim/pathfinding.ts',
    );
    const fixtures = await server.ssrLoadModule('/tests/pathfinding-fixtures.ts');
    const { TILE_SIZE } = await server.ssrLoadModule('/src/sim/constants.ts');
    const { UNITS } = await server.ssrLoadModule('/src/data/units.ts');

    const apis = { old: previous, new: current };
    const pathfinders = { old: previousPathfinding, new: currentPathfinding };

    const tasks = [
      {
        id: 'apply-commands-stress',
        description: 'Direct application of the two full-force attack-move orders (80 units).',
        batch: BATCH,
        prepare: (api) => api.createCalibrationGame('stress'),
        run: (state) => {
          for (const command of state.game.pending.slice()) {
            state.game.commandMove(
              command.team,
              command.ids,
              command.x,
              command.z,
              !!command.attackMove,
            );
          }
        },
      },
      {
        id: 'first-tick-stress',
        description: 'First authoritative tick of the 80-unit stress setup with both orders queued.',
        batch: BATCH,
        prepare: (api) => api.createCalibrationGame('stress'),
        run: (state) => state.game.tick(),
      },
      {
        id: 'first-tick-no-orders',
        description: 'First authoritative tick of the same 80 units with queued orders removed.',
        batch: BATCH,
        prepare: (api) => {
          const state = api.createCalibrationGame('stress');
          state.game.pending.length = 0;
          return state;
        },
        run: (state) => state.game.tick(),
      },
      {
        id: 'single-order',
        description: 'Direct attack-move of one team-0 ground unit: smallest command batch.',
        batch: 200,
        prepare: (api) => {
          const state = api.createCalibrationGame('stress');
          state.game.pending.length = 0;
          return {
            game: state.game,
            ids: groundIdsFor(state.game, 0, UNITS).slice(0, 1),
          };
        },
        run: (state) => state.game.commandMove(0, state.ids, 44 * TILE_SIZE, 44 * TILE_SIZE, true),
      },
      {
        id: 'path-scaling-9',
        description: 'Direct attack-move of 9 team-0 ground units: path requests only.',
        batch: BATCH,
        prepare: (api) => {
          const state = api.createCalibrationGame('stress');
          state.game.pending.length = 0;
          return {
            game: state.game,
            ids: groundIdsFor(state.game, 0, UNITS).slice(0, 9),
          };
        },
        run: (state) => state.game.commandMove(0, state.ids, 44 * TILE_SIZE, 44 * TILE_SIZE, true),
      },
      {
        id: 'path-scaling-36',
        description: 'Direct attack-move of 36 team-0 ground units: path requests only.',
        batch: BATCH,
        prepare: (api) => {
          const state = api.createCalibrationGame('stress');
          state.game.pending.length = 0;
          return {
            game: state.game,
            ids: groundIdsFor(state.game, 0, UNITS).slice(0, 36),
          };
        },
        run: (state) => state.game.commandMove(0, state.ids, 44 * TILE_SIZE, 44 * TILE_SIZE, true),
      },
    ];

    // Warm both variants and all tasks before any measured block.
    for (let warm = 0; warm < 3; warm++) {
      for (const variant of ['old', 'new']) {
        for (const task of tasks) {
          const state = task.prepare(apis[variant]);
          task.run(state);
        }
      }
    }

    const results = [];
    for (const task of tasks) {
      const elapsed = { old: [], new: [] };
      for (let block = 0; block < BLOCKS; block++) {
        // Prepare each variant's worlds immediately before its own timed run,
        // after the other variant's worlds have been released and collected.
        // Preparing both up front made the second variant run under the first
        // variant's retained heap, which biased the measurement by run order.
        const order = block % 2 === 0 ? ['old', 'new'] : ['new', 'old'];
        for (const variant of order) {
          global.gc();
          const states = Array.from({ length: task.batch }, () => task.prepare(apis[variant]));
          global.gc();
          const start = process.hrtime.bigint();
          for (const state of states) task.run(state);
          const ms = Number(process.hrtime.bigint() - start) / 1e6 / states.length;
          elapsed[variant].push(ms);
          if (states[0].game.state.tick < 0) throw new Error('unreachable');
          states.length = 0;
        }
      }
      const summary = {
        id: task.id,
        description: task.description,
        blocks: BLOCKS,
        batch: task.batch,
        old: { medianMs: Number(median(elapsed.old).toFixed(3)) },
        new: { medianMs: Number(median(elapsed.new).toFixed(3)) },
        oldSamples: elapsed.old.map((value) => Number(value.toFixed(3))),
        newSamples: elapsed.new.map((value) => Number(value.toFixed(3))),
      };
      summary.changePct = Number(
        (((summary.new.medianMs - summary.old.medianMs) / summary.old.medianMs) * 100).toFixed(1),
      );
      results.push(summary);
      console.log(
        `${task.id.padEnd(24)} old ${summary.old.medianMs.toFixed(3).padStart(8)} ms  ` +
          `new ${summary.new.medianMs.toFixed(3).padStart(8)} ms  ${summary.changePct.toFixed(1)}%`,
      );
    }

    // Traffic-mask preparation only: 36 old per-request scans versus one command
    // batch. This isolates Optimisation A from A* work.
    const maskTask = {
      id: 'traffic-mask-prep-36',
      prepare: (api) => {
        const state = api.createCalibrationGame('stress');
        state.game.pending.length = 0;
        const units = state.game.state.entities
          .filter(
            (entity) =>
              entity.kind === 'unit' &&
              entity.hp > 0 &&
              entity.owner === 0 &&
              UNITS[entity.defId]?.domain === 'land',
          )
          .sort((a, b) => a.id - b.id)
          .slice(0, 36);
        return { game: state.game, units };
      },
      runOld: (state) => {
        let total = 0;
        for (const unit of state.units) {
          const nav = state.game.navFor(unit);
          total += nav.soft ? nav.soft.length : 0;
        }
        if (total < 0) throw new Error('unreachable');
      },
      runNew: (state) => {
        const batch = state.game.beginNavBatch(0);
        const soft = batch.softFor('land');
        if (!soft) throw new Error('land mask missing');
        if (soft.length < 0) throw new Error('unreachable');
      },
    };

    // Warm the mask task before measuring it.
    for (let warm = 0; warm < 4; warm++) {
      maskTask.runOld(maskTask.prepare(previous));
      maskTask.runNew(maskTask.prepare(current));
    }
    const maskElapsed = { old: [], new: [] };
    for (let block = 0; block < BLOCKS; block++) {
      const order = block % 2 === 0 ? ['old', 'new'] : ['new', 'old'];
      for (const variant of order) {
        global.gc();
        const state = maskTask.prepare(apis[variant]);
        global.gc();
        const start = process.hrtime.bigint();
        if (variant === 'old') maskTask.runOld(state);
        else maskTask.runNew(state);
        maskElapsed[variant].push(Number(process.hrtime.bigint() - start) / 1e6);
      }
    }
    const maskSummary = {
      id: maskTask.id,
      description:
        'Traffic-mask preparation for 36 ground path requests: old per-request navFor versus one command batch.',
      blocks: BLOCKS,
      batch: 36,
      old: { medianMs: Number(median(maskElapsed.old).toFixed(3)) },
      new: { medianMs: Number(median(maskElapsed.new).toFixed(3)) },
      oldSamples: maskElapsed.old.map((value) => Number(value.toFixed(3))),
      newSamples: maskElapsed.new.map((value) => Number(value.toFixed(3))),
    };
    maskSummary.changePct = Number(
      (
        ((maskSummary.new.medianMs - maskSummary.old.medianMs) / maskSummary.old.medianMs) *
        100
      ).toFixed(1),
    );
    results.push(maskSummary);
    console.log(
      `${'traffic-mask-prep-36'.padEnd(24)} old ${maskSummary.old.medianMs.toFixed(3).padStart(8)} ms  ` +
        `new ${maskSummary.new.medianMs.toFixed(3).padStart(8)} ms  ${maskSummary.changePct.toFixed(1)}%`,
    );

    // External-memory observation for the same mask workload: typed-array
    // backing stores are visible in `external`, unlike the JS heap.
    const maskMemory = { old: [], new: [] };
    for (let rep = 0; rep < MEMORY_REPS; rep++) {
      const order = rep % 2 === 0 ? ['old', 'new'] : ['new', 'old'];
      for (const variant of order) {
        global.gc();
        const state = maskTask.prepare(apis[variant]);
        global.gc();
        const before = process.memoryUsage().external;
        let retained;
        if (variant === 'old') {
          retained = state.units.map((unit) => state.game.navFor(unit));
        } else {
          retained = [state.game.beginNavBatch(0)];
        }
        const after = process.memoryUsage().external;
        maskMemory[variant].push(after - before);
        if (!retained) throw new Error('unreachable');
        retained = null;
      }
    }
    const maskMemorySummary = {
      method:
        'external memory delta for 36 old per-request masks versus one command batch, masks retained until read',
      reps: MEMORY_REPS,
      old: { medianBytes: Math.round(median(maskMemory.old)) },
      new: { medianBytes: Math.round(median(maskMemory.new)) },
      expected: { oldBytes: 36 * 96 * 72, newBytes: 96 * 72 },
    };
    console.log(
      `traffic-mask external delta: old median ${maskMemorySummary.old.medianBytes} B, ` +
        `new median ${maskMemorySummary.new.medianBytes} B`,
    );

    // Pure A* microbenchmark: isolates the heap change from command-side work.
    const trafficCase = fixtures
      .pathFixtureCases()
      .find((fixture) => fixture.name === 'dynamic-traffic');
    if (!trafficCase) throw new Error('dynamic-traffic fixture missing');
    const astar = { old: [], new: [] };
    for (let block = 0; block < BLOCKS; block++) {
      const order = block % 2 === 0 ? ['old', 'new'] : ['new', 'old'];
      for (const variant of order) {
        global.gc();
        const findPath = pathfinders[variant].findPath;
        let acc = 0;
        const start = process.hrtime.bigint();
        for (let search = 0; search < ASTAR_SEARCHES; search++) {
          const found = findPath(
            trafficCase.nav,
            trafficCase.startX,
            trafficCase.startZ,
            trafficCase.goalX,
            trafficCase.goalZ,
            trafficCase.maxNodes,
          );
          acc += found ? found.length : -1;
        }
        const msPerThousand =
          (Number(process.hrtime.bigint() - start) / 1e6 / ASTAR_SEARCHES) * 1000;
        astar[variant].push(msPerThousand);
        if (acc < 0) throw new Error('unreachable');
      }
    }
    const astarSummary = {
      id: 'astar-dynamic-traffic',
      description:
        'Pure A* on the dynamic-traffic fixture, 2000 searches per block; heap-only microbenchmark.',
      old: { medianMs: Number(median(astar.old).toFixed(3)) },
      new: { medianMs: Number(median(astar.new).toFixed(3)) },
      oldSamples: astar.old.map((value) => Number(value.toFixed(3))),
      newSamples: astar.new.map((value) => Number(value.toFixed(3))),
    };
    astarSummary.changePct = Number(
      (
        ((astarSummary.new.medianMs - astarSummary.old.medianMs) /
          astarSummary.old.medianMs) *
        100
      ).toFixed(1),
    );
    results.push(astarSummary);
    console.log(
      `${'astar-dynamic-traffic'.padEnd(24)} old ${astarSummary.old.medianMs.toFixed(3).padStart(8)} ms/1k  ` +
        `new ${astarSummary.new.medianMs.toFixed(3).padStart(8)} ms/1k  ${astarSummary.changePct.toFixed(1)}%`,
    );

    // Coarse allocation observation for the command burst. Setup is outside the
    // measured delta; a forced GC keeps unrelated garbage out of the baseline.
    const memoryTask = tasks[0];
    const memory = { old: [], new: [] };
    for (let rep = 0; rep < MEMORY_REPS; rep++) {
      const order = rep % 2 === 0 ? ['old', 'new'] : ['new', 'old'];
      for (const variant of order) {
        global.gc();
        const state = memoryTask.prepare(apis[variant]);
        global.gc();
        const before = process.memoryUsage().heapUsed;
        memoryTask.run(state);
        const after = process.memoryUsage().heapUsed;
        memory[variant].push(after - before);
        if (state.game.state.tick < 0) throw new Error('unreachable');
      }
    }
    const memorySummary = {
      method:
        'heapUsed delta across one command burst, forced GC before baseline, result retained; coarse and local',
      reps: MEMORY_REPS,
      old: {
        medianBytes: Math.round(median(memory.old)),
        minBytes: Math.min(...memory.old),
        maxBytes: Math.max(...memory.old),
      },
      new: {
        medianBytes: Math.round(median(memory.new)),
        minBytes: Math.min(...memory.new),
        maxBytes: Math.max(...memory.new),
      },
    };
    console.log(
      `\ncommand-burst heap delta (coarse): old median ${memorySummary.old.medianBytes} B, ` +
        `new median ${memorySummary.new.medianBytes} B`,
    );

    const meta = {
      generatedAt: new Date().toISOString(),
      phase: '2A.8',
      localOnly: true,
      warning:
        'Local wall-clock A/B on Node. Not Cloudflare Worker CPU time, not a deployed per-tick distribution, and not a capacity proof.',
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpu: os.cpus()?.[0]?.model ?? null,
      blocks: BLOCKS,
      batch: BATCH,
      memoryReps: MEMORY_REPS,
      astarSearchesPerBlock: ASTAR_SEARCHES,
      sourceHashes: {
        'src/sim/pathfinding.ts': sha256('src/sim/pathfinding.ts'),
        'src/sim/navBatch.ts': sha256('src/sim/navBatch.ts'),
        'src/sim/game.ts': sha256('src/sim/game.ts'),
        'src/multiplayer/batchCalibration.ts': sha256('src/multiplayer/batchCalibration.ts'),
      },
    };

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      path.join(OUT, 'results.json'),
      JSON.stringify({ meta, results, memory: memorySummary, maskMemory: maskMemorySummary }, null, 2),
    );
    const lines = [
      '# Phase 2A.8 local pathfinding A/B evidence',
      '',
      `Generated ${meta.generatedAt} on ${meta.platform}, Node ${meta.node}, CPU ${meta.cpu}.`,
      '',
      'The old variant is the reconstructed pre-optimisation source tree in `tmp/phase2a8-old`;',
      'the new variant is the working tree. Both run the real calibration workload in the same',
      'Node process. Each row is a block median; a block prepares fresh worlds outside the timed',
      'window, then runs the whole batch, alternating old/new order every block. These are local',
      'wall-clock values, not Cloudflare Worker CPU measurements.',
      '',
      '| Task | Old median | New median | Change | Blocks | Batch |',
      '| --- | --- | --- | --- | --- | --- |',
      ...results.map(
        (row) =>
          `| ${row.id} | ${row.old.medianMs}${row.id.startsWith('astar') ? ' ms/1k' : ' ms'} | ` +
          `${row.new.medianMs}${row.id.startsWith('astar') ? ' ms/1k' : ' ms'} | ` +
          `${row.changePct}% | ${row.blocks ?? BLOCKS} | ${row.batch ?? ASTAR_SEARCHES} |`,
      ),
      '',
      '`apply-commands-stress`, `first-tick-*` and the scaling tasks use the real Game with the',
      'Phase 2A.6 stress scenario. `astar-dynamic-traffic` is a pure pathfinding microbenchmark',
      'and is not a game-frame measurement.',
      '',
      '## Coarse allocation observation',
      '',
      `Method: ${memorySummary.method}. Median over ${memorySummary.reps} pairs.`,
      '',
      '| Variant | Median heap delta | Min | Max |',
      '| --- | --- | --- | --- |',
      `| Old | ${memorySummary.old.medianBytes} B | ${memorySummary.old.minBytes} B | ${memorySummary.old.maxBytes} B |`,
      `| New | ${memorySummary.new.medianBytes} B | ${memorySummary.new.minBytes} B | ${memorySummary.new.maxBytes} B |`,
      '',
      'This delta is dominated by retained path arrays and other command-side allocations as well',
      'as uncollected temporary masks/nodes, so it is a direction-and-scale observation, not an',
      'exact allocation-accounting result.',
      '',
      '## Traffic-mask external memory',
      '',
      `${maskMemorySummary.method}. Median over ${maskMemorySummary.reps} pairs.`,
      '',
      '| Variant | Median external delta | Structural expectation |',
      '| --- | --- | --- |',
      `| Old (36 requests) | ${maskMemorySummary.old.medianBytes} B | ${maskMemorySummary.expected.oldBytes} B |`,
      `| New (one batch) | ${maskMemorySummary.new.medianBytes} B | ${maskMemorySummary.expected.newBytes} B |`,
    ];
    fs.writeFileSync(path.join(OUT, 'README.md'), `${lines.join('\n')}\n`);
    console.log(`\nWrote ${OUT}`);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
