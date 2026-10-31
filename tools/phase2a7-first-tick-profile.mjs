/**
 * Phase 2A.7 local first-tick profiler.
 *
 * Loads the real TypeScript simulation through Vite's SSR module loader and
 * profiles the exact Phase 2A.6 calibration workloads with V8's sampling CPU
 * profiler and precise coverage counters.
 *
 * These are LOCAL measurements. The V8 profiler samples the main thread of a
 * Node process; sample shares are used only for relative attribution inside the
 * simulation. They are not Cloudflare Worker CPU measurements and must never be
 * reported as deployed CPU time.
 *
 * Usage: node tools/phase2a7-first-tick-profile.mjs
 */

import { createServer } from 'vite';
import { Session } from 'node:inspector/promises';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(ROOT, 'staging-evidence', `phase2a7-profile-${STAMP}`);
const PRIOR_EVIDENCE = path.join(
  ROOT,
  'staging-evidence',
  'phase2a6-calibration-2026-10-30T13-56-52-136Z',
  'samples.json',
);
const SAMPLE_INTERVAL_US = 100;
const RAW_STAGES = new Set([
  'first-tick-stress',
  'first-tick-stress-no-commands',
  'steady-batch-20-stress',
  'combat-batch-20-stress',
]);

fs.mkdirSync(path.join(OUT, 'cpu-profiles'), { recursive: true });

function log(...args) {
  console.log(...args);
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
}

/** FNV-1a 64-bit, matching the calibration checksum format. */
function checksum(text) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function normaliseUrl(url) {
  return (url || '').replace(/\\/g, '/').split('?')[0];
}

function categoryOf(name, url) {
  const u = normaliseUrl(url);
  if (name === '(garbage collector)') return 'GC';
  if (name === '(idle)') return 'idle';
  if (name === '(program)' || name === '(root)') return 'runtime';
  if (u.includes('/src/sim/pathfinding')) return 'pathfinding';
  if (
    /^(findPath|findPathFor|navFor|nearestWalkable|stepCost|diagonalBlocked|lineClear|smoothPath|heuristic|MinHeap)$/.test(
      name,
    )
  ) {
    return 'pathfinding';
  }
  if (name === 'moveCost') return 'terrain-queries';
  if (/refreshVision|stampVision|refreshVisibleEntities|cleanContacts/.test(name)) return 'vision';
  // The same helper serves initial fog stamping and gunnery checks; the stage
  // description disambiguates which call site dominates.
  if (/hasLineOfSight/.test(name)) return 'line-of-sight';
  if (
    /updateUnits|moveAlongPath|updateAutoEngagement|chooseWeapon|acquire|updateTurret|updateOrderTargeting|updateMedic|updateRecovery|steerAroundUnits|separateUnits|unitClearAt|canOccupy|updateAircraft|updateNaval|updateSubmarine|updateHarvester|entityWeapons|entityTargetClass|unitDef|canWeaponTarget|usesPrimaryAmmo|tryFire/.test(
      name,
    )
  ) {
    return 'units';
  }
  if (/updateProjectiles|impact|damage|explode|splash|fireWeapon|tryFire/.test(name)) {
    return 'projectiles-combat';
  }
  if (
    /updateBuildingSystems|production|construction|updatePassiveIncome|updateIncomeHistory|powerStatus|updateGarrisons/.test(
      name,
    )
  ) {
    return 'buildings-economy';
  }
  if (/cleanup|removeDead|despawn|reap/.test(name)) return 'cleanup';
  if (/stateHash|stringify/.test(name)) return 'state-hash';
  if (u.includes('/src/sim/terrain')) return 'terrain-queries';
  if (/commandMove|formationPoints|ownedEntities|commandAttack|processCommands/.test(name)) {
    return 'command-application';
  }
  if (
    u.includes('/src/data/scenarios') ||
    /spawnUnit|spawnStructure|createIslandAssault|addStressUnits|issueStressCommands/.test(name)
  ) {
    return 'setup';
  }
  return 'other';
}

function isTransportFrame(name, url) {
  return name === 'post' || normaliseUrl(url).startsWith('node:inspector');
}

function newBuckets() {
  return {
    totalSamples: 0,
    transportSamples: 0,
    functions: new Map(),
    categories: new Map(),
  };
}

/**
 * V8 sample counts, not summed timeDeltas. The inspector start/stop round trip
 * leaves a large gap in timeDeltas; counting samples keeps that transport gap
 * out of the attribution. Samples whose top frame is the inspector transport
 * are discarded explicitly.
 */
function accumulate(profile, buckets) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  for (const sampleId of profile.samples) {
    const node = nodes.get(sampleId);
    if (!node) continue;
    const frame = node.callFrame;
    if (isTransportFrame(frame.functionName, frame.url)) {
      buckets.transportSamples += 1;
      continue;
    }
    buckets.totalSamples += 1;
    const key = `${frame.functionName}|${normaliseUrl(frame.url)}|${frame.lineNumber}`;
    const entry = buckets.functions.get(key) ?? {
      function: frame.functionName || '(anonymous)',
      url: normaliseUrl(frame.url),
      line: frame.lineNumber,
      samples: 0,
    };
    entry.samples += 1;
    buckets.functions.set(key, entry);
    const category = categoryOf(frame.functionName, frame.url);
    buckets.categories.set(category, (buckets.categories.get(category) ?? 0) + 1);
  }
}

function finaliseBuckets(buckets) {
  const total = buckets.totalSamples || 1;
  const topFunctions = [...buckets.functions.values()]
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 24)
    .map((entry) => ({
      function: entry.function,
      url: entry.url,
      line: entry.line,
      samples: entry.samples,
      pct: Number(((entry.samples / total) * 100).toFixed(2)),
    }));
  const categories = [...buckets.categories.entries()]
    .map(([category, samples]) => ({
      category,
      samples,
      pct: Number(((samples / total) * 100).toFixed(2)),
    }))
    .sort((a, b) => b.samples - a.samples);
  return {
    samples: buckets.totalSamples,
    transportSamplesExcluded: buckets.transportSamples,
    topFunctions,
    categories,
  };
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
    const calibration = await server.ssrLoadModule('/src/multiplayer/batchCalibration.ts');
    const { createCalibrationGame, runBatchCalibration } = calibration;
    const { TILE_SIZE } = await server.ssrLoadModule('/src/sim/constants.ts');
    const { UNITS } = await server.ssrLoadModule('/src/data/units.ts');
    const setup = (profile) => createCalibrationGame(profile);

    const session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', { interval: SAMPLE_INTERVAL_US });

    const startProfile = async () => session.post('Profiler.start');
    const stopProfile = async () => {
      const { profile } = await session.post('Profiler.stop');
      return profile;
    };

    /** Send the queued orders directly, without ticking, for command attribution. */
    const applyQueuedCommands = (game) => {
      const queued = game.pending.slice();
      for (const command of queued) {
        game.commandMove(command.team, command.ids, command.x, command.z, !!command.attackMove);
      }
      return queued.length;
    };

    const setupStress = () => setup('stress');
    const setupStressNoCommands = () => {
      const state = setup('stress');
      state.game.pending.length = 0;
      return state;
    };
    const prepareAfter = (profile, ticks) => () => {
      const state = setup(profile);
      for (let index = 0; index < ticks; index++) state.game.tick();
      return state;
    };

    const stages = [
      {
        id: 'setup-baseline',
        description: 'Scenario + Game construction, initial vision, no ticks (16 units).',
        ticks: 0,
        reps: 20,
        prepare: () => null,
        measure: () => {
          const state = setup('baseline');
          return { game: state.game };
        },
      },
      {
        id: 'setup-stress',
        description:
          'Scenario + Game construction, 64 added units, initial vision and two queued orders (80 units).',
        ticks: 0,
        reps: 20,
        prepare: () => null,
        measure: () => {
          const state = setup('stress');
          return { game: state.game };
        },
      },
      {
        id: 'apply-commands-stress',
        description: 'Direct application of the two queued full-force attack-move orders.',
        ticks: 0,
        reps: 20,
        prepare: setupStress,
        measure: (state) => {
          const commands = applyQueuedCommands(state.game);
          return { game: state.game, commands };
        },
      },
      {
        id: 'first-tick-baseline',
        description: 'First authoritative tick, baseline 16 units, no commands.',
        ticks: 1,
        reps: 20,
        prepare: () => setup('baseline'),
        measure: (state) => {
          state.game.tick();
          return { game: state.game };
        },
      },
      {
        id: 'first-tick-stress',
        description:
          'First authoritative tick, 80 units, two full-force attack-move orders processed.',
        ticks: 1,
        reps: 30,
        prepare: setupStress,
        measure: (state) => {
          state.game.tick();
          return { game: state.game };
        },
      },
      {
        id: 'first-tick-stress-no-commands',
        description:
          'First authoritative tick, 80 units, queued orders removed before the tick (harness only).',
        ticks: 1,
        reps: 30,
        prepare: setupStressNoCommands,
        measure: (state) => {
          state.game.tick();
          return { game: state.game };
        },
      },
      {
        id: 'second-tick-stress',
        description: 'Second authoritative tick after the order burst; same state progression.',
        ticks: 1,
        reps: 40,
        prepare: prepareAfter('stress', 1),
        measure: (state) => {
          state.game.tick();
          return { game: state.game };
        },
      },
      {
        id: 'steady-tick-31-stress',
        description: 'Single representative steady tick (tick 31) with the engagement underway.',
        ticks: 1,
        reps: 40,
        prepare: prepareAfter('stress', 30),
        measure: (state) => {
          state.game.tick();
          return { game: state.game };
        },
      },
      {
        id: 'steady-batch-20-stress',
        description: 'Ticks 31-50 batched for stable sampling; divide totals by 20 for per-tick.',
        ticks: 20,
        reps: 10,
        prepare: prepareAfter('stress', 30),
        measure: (state) => {
          for (let index = 0; index < 20; index++) state.game.tick();
          return { game: state.game };
        },
      },
      {
        id: 'combat-batch-20-stress',
        description:
          'Ticks 61-80 batched: projectiles, damage and casualties active; divide by 20.',
        ticks: 20,
        reps: 8,
        prepare: prepareAfter('stress', 60),
        measure: (state) => {
          for (let index = 0; index < 20; index++) state.game.tick();
          return { game: state.game };
        },
      },
      {
        id: 'steady-tick-31-baseline',
        description: 'Single baseline steady tick (tick 31), no commands.',
        ticks: 1,
        reps: 20,
        prepare: prepareAfter('baseline', 30),
        measure: (state) => {
          state.game.tick();
          return { game: state.game };
        },
      },
      {
        id: 'result-collection-stress',
        description: 'Result collection after tick 60: bounded activity counters.',
        ticks: 0,
        reps: 10,
        prepare: prepareAfter('stress', 60),
        measure: (state) => {
          let events = 0;
          for (const event of state.game.state.events) events += event.type.length > 0 ? 1 : 0;
          return { game: state.game, events };
        },
      },
    ];

    /** Deterministic team-0 ground unit list, for the pathfinding scaling probe. */
    const groundIdsFor = (game, owner) =>
      game.state.entities
        .filter(
          (entity) =>
            entity.kind === 'unit' &&
            entity.hp > 0 &&
            entity.owner === owner &&
            UNITS[entity.defId]?.domain !== 'air',
        )
        .map((entity) => entity.id)
        .sort((a, b) => a - b);

    // Controlled scaling probe: same destination and state, only the number of
    // ordered ground units changes. This isolates path-request count.
    for (const count of [9, 18, 27, 36]) {
      stages.push({
        id: `path-scaling-${count}`,
        description: `Direct attack-move of ${count} team-0 ground units to the stress objective (pathfinding only).`,
        ticks: 0,
        reps: 30,
        prepare: setupStressNoCommands,
        measure: (state) => {
          const ids = groundIdsFor(state.game, 0).slice(0, count);
          state.game.commandMove(0, ids, 44 * TILE_SIZE, 44 * TILE_SIZE, true);
          return { game: state.game, commands: 1, ordered: ids.length };
        },
      });
    }

    // Warm every path once so JIT state is comparable between stages.
    for (const stage of stages) {
      const state = stage.prepare ? stage.prepare() : null;
      stage.measure(state);
    }

    const stageResults = [];
    for (const stage of stages) {
      // Prepare every repetition outside the profiler window; only measured work is sampled.
      const prepared = [];
      for (let rep = 0; rep < stage.reps; rep++) {
        prepared.push(stage.prepare ? stage.prepare() : null);
      }
      const before = prepared.map((state) =>
        state ? { hash: checksum(state.game.stateHash()), tick: state.game.state.tick } : null,
      );
      const elapsed = [];
      const measuredList = [];
      await startProfile();
      for (let rep = 0; rep < stage.reps; rep++) {
        const startNs = process.hrtime.bigint();
        const measured = stage.measure(prepared[rep]);
        elapsed.push(Number(process.hrtime.bigint() - startNs) / 1e6);
        measuredList.push(measured);
      }
      const profile = await stopProfile();

      // Hashing is deliberately outside the profiled window.
      const reps = measuredList.map((measured, index) => {
        const game = measured.game;
        return {
          checksumAfter: checksum(game.stateHash()),
          tickAfter: game.state.tick,
          units: game.state.entities.filter((e) => e.kind === 'unit' && e.hp > 0).length,
          projectiles: game.state.projectiles.length,
          commands: measured.commands ?? null,
          ordered: measured.ordered ?? null,
          events: measured.events ?? null,
          elapsedMs: Number(elapsed[index].toFixed(3)),
          before: before[index],
        };
      });

      const buckets = newBuckets();
      accumulate(profile, buckets);
      if (RAW_STAGES.has(stage.id)) {
        fs.writeFileSync(
          path.join(OUT, 'cpu-profiles', `${stage.id}-all-reps.cpuprofile`),
          JSON.stringify(profile),
        );
      }
      const summary = finaliseBuckets(buckets);
      const perTickDivisor = Math.max(1, stage.ticks) * stage.reps;
      const totals = reps.map((rep) => rep.elapsedMs).sort((a, b) => a - b);
      stageResults.push({
        id: stage.id,
        description: stage.description,
        ticksPerRep: stage.ticks,
        reps: stage.reps,
        uniqueChecksums: [...new Set(reps.map((rep) => rep.checksumAfter))],
        totalSamples: summary.samples,
        transportSamplesExcluded: summary.transportSamplesExcluded,
        samplesPerTick: Number((summary.samples / perTickDivisor).toFixed(3)),
        localElapsedMs: {
          median: Number(totals[Math.floor(totals.length / 2)].toFixed(3)),
          min: Number(totals[0].toFixed(3)),
          max: Number(totals[totals.length - 1].toFixed(3)),
        },
        topFunctions: summary.topFunctions,
        categories: summary.categories,
        measurements: reps,
      });
      log(
        `\n[${stage.id}] reps=${stage.reps} samples=${summary.samples} ` +
          `(transport excluded ${summary.transportSamplesExcluded}) ` +
          `samples/tick=${(summary.samples / perTickDivisor).toFixed(2)} checksums=${[...new Set(reps.map((rep) => rep.checksumAfter))].join(',')}`,
      );
      for (const row of summary.topFunctions.slice(0, 8)) {
        log(`  ${row.pct.toFixed(1).padStart(5)}%  ${row.function} (${row.samples} samples)`);
      }
    }

    // Precise coverage gives real call counts; timings above come only from the profiler.
    // V8 precise coverage is most reliable before these hot functions are heavily
    // optimised; only the stages used in the report are collected.
    const coverageStages = stages.filter((stage) =>
      ['first-tick-stress', 'first-tick-stress-no-commands', 'steady-batch-20-stress'].includes(
        stage.id,
      ),
    );
    const coverageResults = [];
    for (const stage of coverageStages) {
      const state = stage.prepare ? stage.prepare() : null;
      await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
      const measured = stage.measure(state);
      const taken = await session.post('Profiler.takePreciseCoverage');
      await session.post('Profiler.stopPreciseCoverage');
      const counts = new Map();
      for (const script of taken.result) {
        if (!normaliseUrl(script.url).includes('/src/')) continue;
        for (const fn of script.functions) {
          const entry = counts.get(fn.functionName) ?? { count: 0, urls: new Set() };
          entry.count += fn.ranges?.[0]?.count ?? 0;
          entry.urls.add(normaliseUrl(script.url).replace(/^.*\/src\//, 'src/'));
          counts.set(fn.functionName, entry);
        }
      }
      const wanted = [
        'findPath',
        'nearestWalkable',
        'stepCost',
        'diagonalBlocked',
        'lineClear',
        'smoothPath',
        'push',
        'pop',
        'navFor',
        'commandMove',
        'formationPoints',
        'updateUnits',
        'updateAutoEngagement',
        'separateUnits',
        'steerAroundUnits',
        'canOccupy',
        'unitClearAt',
        'hasLineOfSight',
        'stampVision',
        'refreshVision',
        'refreshVisibleEntities',
        'updateProjectiles',
        'impact',
        'cleanup',
        'stateHash',
      ];
      const functions = {};
      for (const name of wanted) {
        const entry = counts.get(name);
        functions[name] = entry
          ? {
              calls: entry.count,
              callsPerTick: Number((entry.count / Math.max(1, stage.ticks)).toFixed(2)),
              files: [...entry.urls],
            }
          : { calls: 0, callsPerTick: 0, files: [] };
      }
      coverageResults.push({
        stage: stage.id,
        ticksPerRep: stage.ticks,
        checksumAfter: checksum(measured.game.stateHash()),
        functions,
      });
      log(`\n[coverage:${stage.id}] ${JSON.stringify(functions)}`);
    }

    // The Phase 2A.6 evidence predates the createCalibrationGame refactor.
    let equivalence = { prior: PRIOR_EVIDENCE, records: [], allMatch: false };
    if (fs.existsSync(PRIOR_EVIDENCE)) {
      const prior = JSON.parse(fs.readFileSync(PRIOR_EVIDENCE, 'utf8')).samples;
      const pairs = [];
      for (const profile of ['baseline', 'stress']) {
        for (const batch of [0, 1, 5, 10, 20, 50, 100]) {
          const recorded = prior.find((row) => row.profile === profile && row.batch === batch);
          if (recorded) pairs.push({ profile, batch, recorded });
        }
      }
      for (const { profile, batch, recorded } of pairs) {
        const current = runBatchCalibration(profile, batch, null);
        const match =
          current.initial.checksum === recorded.initialChecksum &&
          current.final.checksum === recorded.checksum &&
          current.finalTick === recorded.finalTick &&
          current.final.units === recorded.units &&
          current.final.projectiles === recorded.projectiles &&
          current.activity.shots === recorded.shots &&
          current.activity.kills === recorded.kills &&
          current.commandsIssued === recorded.commandsIssued;
        equivalence.records.push({
          profile,
          batch,
          match,
          prior: {
            initialChecksum: recorded.initialChecksum,
            checksum: recorded.checksum,
            finalTick: recorded.finalTick,
            units: recorded.units,
            projectiles: recorded.projectiles,
            shots: recorded.shots,
            kills: recorded.kills,
            commandsIssued: recorded.commandsIssued,
          },
          current: {
            initialChecksum: current.initial.checksum,
            checksum: current.final.checksum,
            finalTick: current.finalTick,
            units: current.final.units,
            projectiles: current.final.projectiles,
            shots: current.activity.shots,
            kills: current.activity.kills,
            commandsIssued: current.commandsIssued,
          },
        });
        log(
          `[refactor-equivalence] ${profile}/${batch}: ${match ? 'MATCH' : 'MISMATCH'} ` +
            `prior=${recorded.checksum} current=${current.final.checksum}`,
        );
      }
      equivalence.allMatch =
        equivalence.records.length > 0 && equivalence.records.every((row) => row.match);
    }

    const git = (() => {
      try {
        return fs
          .readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8')
          .trim()
          .replace('ref: ', '');
      } catch {
        return null;
      }
    })();

    const meta = {
      generatedAt: new Date().toISOString(),
      phase: '2A.7',
      method:
        'V8 CPU profiler (requested 100 us sampling interval) around prepared calibration stages, plus V8 precise coverage call counts.',
      localOnly: true,
      warning:
        'Sample shares are local Node main-thread stack samples used for relative attribution. Not deployed Cloudflare CPU time and not a per-tick CPU distribution.',
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpu: os.cpus()?.[0]?.model ?? null,
      gitHead: git,
      sources: {
        'src/sim/game.ts': sha256('src/sim/game.ts'),
        'src/sim/pathfinding.ts': sha256('src/sim/pathfinding.ts'),
        'src/sim/terrain.ts': sha256('src/sim/terrain.ts'),
        'src/multiplayer/batchCalibration.ts': sha256('src/multiplayer/batchCalibration.ts'),
        'src/data/scenarios.ts': sha256('src/data/scenarios.ts'),
      },
      sampleIntervalUs: SAMPLE_INTERVAL_US,
    };

    fs.writeFileSync(path.join(OUT, 'stages.json'), JSON.stringify(stageResults, null, 2));
    fs.writeFileSync(
      path.join(OUT, 'coverage-counts.json'),
      JSON.stringify({ stageCalls: coverageResults }, null, 2),
    );
    fs.writeFileSync(
      path.join(OUT, 'refactor-equivalence.json'),
      JSON.stringify(equivalence, null, 2),
    );
    fs.writeFileSync(path.join(OUT, 'run-meta.json'), JSON.stringify(meta, null, 2));

    const compare = ['first-tick-stress', 'steady-batch-20-stress', 'combat-batch-20-stress'];
    const lines = [
      '# Phase 2A.7 local profiling evidence',
      '',
      `Generated ${meta.generatedAt} on ${meta.platform}, Node ${meta.node}, CPU ${meta.cpu}.`,
      '',
      'Method: V8 sampling CPU profiler around exact calibration stages, loaded through',
      "Vite's SSR module loader. Precise coverage supplied call counts. Repetitions are prepared",
      'before each profiling window, so only measured work is sampled; hashing and checksums are',
      'computed after the window. Samples whose top frame is the inspector transport are excluded.',
      '',
      '**Local evidence only.** These are not Cloudflare Worker CPU measurements. Sample shares are',
      'relative main-thread attribution for a synchronous workload, not CPU time or a per-tick',
      'distribution. Local elapsed values are wall-clock context and are not CPU time either.',
      '',
      '## Command',
      '',
      '```bash',
      'node tools/phase2a7-first-tick-profile.mjs',
      '```',
      '',
      '## Stage totals',
      '',
      '| Stage | Ticks/rep | Reps | Samples | Samples/tick | Local elapsed median (ms) | Unique checksums |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...stageResults.map(
        (stage) =>
          `| ${stage.id} | ${stage.ticksPerRep} | ${stage.reps} | ${stage.totalSamples} | ${stage.samplesPerTick} | ${stage.localElapsedMs.median} | ${stage.uniqueChecksums.length} |`,
      ),
      '',
      '## Pathfinding scaling probe (local, path requests only)',
      '',
      '| Ordered ground units | Samples | Samples/rep | Local elapsed median (ms) |',
      '| --- | --- | --- | --- |',
      ...stageResults
        .filter((stage) => stage.id.startsWith('path-scaling-'))
        .map(
          (stage) =>
            `| ${stage.id.replace('path-scaling-', '')} | ${stage.totalSamples} | ${(stage.totalSamples / stage.reps).toFixed(1)} | ${stage.localElapsedMs.median} |`,
        ),
      '',
      '## Attribution for key stages',
      '',
      ...compare.flatMap((id) => {
        const stage = stageResults.find((row) => row.id === id);
        if (!stage) return [];
        return [
          `### ${id}`,
          '',
          `Samples: ${stage.totalSamples} across ${stage.reps} repetitions.`,
          '',
          '| Category | % of samples |',
          '| --- | --- |',
          ...stage.categories.map((row) => `| ${row.category} | ${row.pct}% |`),
          '',
          '| Function | % of samples | Samples |',
          '| --- | --- | --- |',
          ...stage.topFunctions
            .slice(0, 12)
            .map((row) => `| ${row.function} | ${row.pct}% | ${row.samples} |`),
          '',
        ];
      }),
      '## Refactor equivalence',
      '',
      equivalence.allMatch
        ? `All ${equivalence.records.length} baseline/stress batch records match the Phase 2A.6 deployed checksums exactly.`
        : '**One or more records did not match; see refactor-equivalence.json.**',
      '',
      'Raw profiles: `cpu-profiles/*.cpuprofile` for the first-tick stress/no-command, steady and combat batches.',
    ];
    fs.writeFileSync(path.join(OUT, 'README.md'), `${lines.join('\n')}\n`);

    session.disconnect();
    log(`\nWrote ${OUT}`);
    log(`refactor equivalence: ${equivalence.allMatch ? 'ALL MATCH' : 'CHECK EVIDENCE'}`);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
