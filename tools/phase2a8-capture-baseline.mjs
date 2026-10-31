/**
 * Phase 2A.8 baseline capture.
 *
 * Run this BEFORE changing pathfinding. It records:
 *   - exact paths for the synthetic equality matrix,
 *   - exact stress/baseline first-tick unit paths,
 *   - deterministic state checksums at several ticks.
 *
 * The frozen reference fixture lives at tests/fixtures/phase2a8-path-baseline.json
 * and must not be overwritten by a post-change run. This tool writes a current
 * snapshot to tmp/ for manual comparison only.
 *
 * Usage: node tools/phase2a8-capture-baseline.mjs
 */

import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'tmp', 'phase2a8-current-fixture.json');

function checksum(text) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function tickChecksums(game, ticks) {
  const out = [{ tick: game.state.tick, checksum: checksum(game.stateHash()) }];
  for (const tick of ticks) {
    while (game.state.tick < tick) game.tick();
    out.push({ tick: game.state.tick, checksum: checksum(game.stateHash()) });
  }
  return out;
}

function pathsOf(game) {
  return game.state.entities
    .filter((entity) => entity.kind === 'unit' && entity.hp > 0 && entity.path.length > 0)
    .sort((a, b) => a.id - b.id)
    .map((entity) => ({
      id: entity.id,
      defId: entity.defId,
      owner: entity.owner,
      state: entity.state,
      order: entity.order ? { ...entity.order } : null,
      path: entity.path.map((point) => ({ x: point.x, z: point.z })),
    }));
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
    const pathfinding = await server.ssrLoadModule('/src/sim/pathfinding.ts');
    const fixtures = await server.ssrLoadModule('/tests/pathfinding-fixtures.ts');
    const calibration = await server.ssrLoadModule('/src/multiplayer/batchCalibration.ts');

    const paths = fixtures.pathFixtureCases().map((fixture) => ({
      name: fixture.name,
      path: pathfinding.findPath(
        fixture.nav,
        fixture.startX,
        fixture.startZ,
        fixture.goalX,
        fixture.goalZ,
        fixture.maxNodes,
      ),
    }));

    const stress = calibration.createCalibrationGame('stress').game;
    const stressTicks = tickChecksums(stress, [1, 2, 3, 10, 30, 60, 100]);
    const stressFirstTick = pathsOf(stress);
    // pathsOf runs after the full tick sequence; capture first-tick paths by
    // rebuilding below rather than reconstructing historical state.
    const stressFirst = calibration.createCalibrationGame('stress').game;
    stressFirst.tick();
    const stressFirstPaths = pathsOf(stressFirst);
    const baselineFirst = calibration.createCalibrationGame('baseline').game;
    baselineFirst.tick();
    const baselineFirstPaths = pathsOf(baselineFirst);
    const baselineTicks = tickChecksums(calibration.createCalibrationGame('baseline').game, [1, 2, 10, 30]);

    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      method:
        'Current working-tree snapshot for manual comparison; the reference fixture is frozen separately.',
      paths,
      stress: {
        ticks: stressTicks,
        firstTickPaths: stressFirstPaths,
        finalPathsSample: stressFirstTick.slice(0, 8),
      },
      baseline: {
        ticks: baselineTicks,
        firstTickPaths: baselineFirstPaths,
      },
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Wrote ${OUT}`);
    console.log(`Synthetic cases: ${paths.length}, stress paths: ${stressFirstPaths.length}, baseline paths: ${baselineFirstPaths.length}`);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
