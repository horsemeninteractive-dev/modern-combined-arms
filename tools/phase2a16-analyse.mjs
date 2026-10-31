#!/usr/bin/env node
// Phase 2A.16 evidence analysis.
//
// Reads one soak evidence directory and writes phase2a16-analysis.json. The
// output keeps direct observations separate from derived values. It does not
// query platform CPU metrics; those are captured separately from Cloudflare's
// durableObjectsPeriodicGroups dataset and merged into the report.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node tools/phase2a14-analyse.mjs <evidence-dir>');
  process.exit(2);
}

const read = (name) => {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
};
const readLines = (name) => {
  const path = join(dir, name);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const summary = read('summary.json');
const status = read('status-final.json');
const room = read('room.json');
const restarts = [0, 1].map((index) => read(`restart-${index}.json`)).filter(Boolean);
const unplannedRestart = read('unplanned-restart.json');
const events = readLines('metrics.jsonl');
const statusSamples = readLines('status-samples.jsonl');

if (!summary) {
  console.error('summary.json is required');
  process.exit(2);
}

const isoMs = (value) => (value ? Date.parse(value) : null);
const round = (value, digits = 3) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? value
    : Math.round(value * 10 ** digits) / 10 ** digits;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const server = summary.server ?? null;
const resultEntries = Array.isArray(summary.results) ? summary.results : [];
const winner = resultEntries[0]?.winnerTeam ?? null;
const expectedOutcome = (seat) =>
  resultEntries[seat]?.outcome === undefined
    ? null
    : winner === null
      ? 'draw'
      : winner === seat
        ? 'victory'
        : 'defeat';

const restartAnalysis = restarts.map((entry) => {
  const actualAgeMs =
    isoMs(entry.restartRequestedAt) !== null && isoMs(entry.lastSuccessAtIso) !== null
      ? isoMs(entry.restartRequestedAt) - isoMs(entry.lastSuccessAtIso)
      : null;
  const failureBefore = entry.statusBefore?.diagnostics?.persistence?.failures ?? null;
  const failureAfter = entry.statusAfter?.diagnostics?.persistence?.failures ?? null;
  return {
    index: entry.index,
    scheduledAgeMs: entry.scheduledAgeMs,
    checkpointObservedAt: entry.checkpointObservedAtIso ?? null,
    lastSuccessfulCheckpointAt: entry.lastSuccessAtIso ?? null,
    // Whole-match tick observed when the last persistence success was sampled.
    // The restored snapshot can be a few ticks older than this observation.
    observedTickAtLastPersistenceSuccess: entry.lastCheckpointTick ?? null,
    restartRequestedAt: entry.restartRequestedAt ?? null,
    actualCheckpointAgeAtRequestMs: actualAgeMs,
    harnessCheckpointAgeAtRequestMs: entry.checkpointAgeAtRequestMs ?? null,
    checkpointAgeWithin15s: actualAgeMs !== null ? actualAgeMs <= 15_000 : null,
    lastAuthoritativeTickBeforeRestart: entry.preTick ?? null,
    firstRestoredSnapshotTick: entry.restoredSnapshotTick ?? null,
    restoredWholeMatchTick: entry.restoredTotalTicks ?? null,
    restoredProcessTick: entry.restoredProcessTicks ?? null,
    tickRollback: entry.rollbackTicks ?? null,
    elapsedRollbackMs: entry.rollbackMs ?? null,
    rollbackWithin15s: entry.withinCheckpointInterval ?? null,
    // The periodic checkpoint is an index over chunks; the restored state can
    // lag the sampled tick by a few ticks. This is measured, not assumed.
    restoredSnapshotLagFromObservedCheckpointTicks:
      entry.lastCheckpointTick !== null && entry.restoredSnapshotTick !== null
        ? entry.lastCheckpointTick - entry.restoredSnapshotTick
        : null,
    syncGenerationBefore: entry.preEpochs ?? null,
    epochContinuity: (entry.reconnect ?? []).map((seat) => ({
      seat: seat.seat,
      before: entry.preEpochs?.[seat.seat] ?? null,
      afterRestore: seat.firstSyncEpoch ?? null,
      monotonic:
        entry.preEpochs?.[seat.seat] !== undefined && seat.firstSyncEpoch !== undefined
          ? seat.firstSyncEpoch > entry.preEpochs[seat.seat]
          : null,
    })),
    reconnect: (entry.reconnect ?? []).map((seat) => ({
      seat: seat.seat,
      connectMs: seat.connectMs ?? null,
      firstSyncMsAfterClose: seat.firstSyncMsAfterClose ?? null,
      firstSyncTick: seat.firstSyncTick ?? null,
      firstSyncEpoch: seat.firstSyncEpoch ?? null, // protocol sync generation
      firstSyncSequence: seat.firstSyncSeq ?? null,
      firstSyncHadMap: seat.firstSyncHadMap ?? null,
      firstDeltaMsAfterSync: seat.firstDeltaMsAfterSync ?? null,
      firstDeltaTick: seat.firstDeltaTick ?? null,
      firstCommandAccepted: seat.firstCommandAccepted ?? null,
      firstCommandTick: seat.firstCommandTick ?? null,
      firstCommandMsAfterSync: seat.firstCommandMsAfterSync ?? null,
      resyncAccepted: seat.resyncAcceptedAt !== null,
      resyncRateLimited: seat.resyncRateLimitedAt !== null,
      staleSyncRejected:
        seat.staleSyncReject !== null && seat.staleSyncReject?.ok === false
          ? seat.staleSyncReject.reason ?? true
          : false,
      staleDeltaRejected:
        seat.staleDeltaReject !== null && seat.staleDeltaReject?.ok === false
          ? seat.staleDeltaReject.reason ?? true
          : false,
      stateTickAfterRecovery: seat.stateTickAfterRecovery ?? null,
    })),
    postRestartCommands: entry.postRestartCommands ?? [],
    postCheckpointCommands: entry.postCheckpointCommands ?? [],
    startContinuity: entry.startContinuity ?? null,
    persistenceFailuresBefore: failureBefore,
    persistenceFailuresAfter: failureAfter,
    rejectedUpdates: entry.rejectedUpdates ?? null,
  };
});

const commandEvents = events.filter((event) => event.type === 'command-result');
const assemblyRejects = events.filter((event) => event.type === 'assembly-reject');
const serverErrors = events.filter((event) => event.type === 'server-error');
const unexpectedAssemblyRejects = assemblyRejects.filter(
  (event) =>
    event.reason !== 'epoch-mismatch' &&
    event.reason !== 'sequence-stale' &&
    event.reason !== 'base-mismatch',
);
const acceptedCommands = commandEvents.filter((event) => event.outcome === 'accepted').length;
const rejectedCommands = commandEvents.filter((event) => event.outcome === 'rejected').length;
const commandTypes = [0, 1].map((seat) => {
  const counts = {};
  for (const event of commandEvents) {
    if (event.seat !== seat) continue;
    counts[event.commandType] = (counts[event.commandType] ?? 0) + 1;
  }
  return counts;
});
const socketCloses = events.filter((event) => event.type === 'socket-close');
const reconnects = events.filter((event) => event.type === 'reconnect');
const controlledRestartRequestAt = restarts
  .map((entry) => isoMs(entry.restartRequestedAt))
  .filter((value) => value !== null);
const unplannedCloses = socketCloses.filter(
  (event) =>
    event.code === null &&
    !controlledRestartRequestAt.some((requestedAt) => Math.abs((isoMs(event.at) ?? 0) - requestedAt) < 5000),
);
const keepaliveSamples = statusSamples.filter((sample) => sample.lastSuccessAt !== null);
const checkpointGaps = [];
for (let index = 1; index < keepaliveSamples.length; index++) {
  const previous = keepaliveSamples[index - 1].lastSuccessAt;
  const current = keepaliveSamples[index].lastSuccessAt;
  if (previous !== null && current !== null && current > previous) {
    checkpointGaps.push(current - previous);
  }
}

const metrics = summary.protocol ?? {};
const transport = summary.snapshots ?? [];
const reconstruction = summary.reconstruction ?? {};
const statusMatch = status?.match ?? null;
const statusTiming = status?.matchTiming ?? null;
const finalPersistence = status?.diagnostics?.persistence ?? null;
const finalLifecycle = status?.diagnostics?.lifecycle ?? null;
const finalReservations = status?.diagnostics?.reservations ?? null;

const analysis = {
  phase: '2A.16',
  generatedAt: new Date().toISOString(),
  source: {
    evidenceDir: dir,
    summary: 'summary.json',
    finalStatus: 'status-final.json',
    restarts: restarts.map((entry) => `restart-${entry.index}.json`),
    unplannedRestart: unplannedRestart ? 'unplanned-restart.json' : null,
    events: 'metrics.jsonl',
    platformMetrics: 'platform-metrics.json (captured separately)',
  },
  room,
  build: summary.health ?? null,
  observed: {
    matchWindow: {
      startedAtMs: statusMatch?.startedAtMs ?? server?.startedAtMs ?? null,
      finishedAtMs: statusMatch?.finishedAtMs ?? server?.finishedAtMs ?? null,
      matchDeadlineAt: status?.matchDeadlineAt ?? null,
      matchDurationMs: status?.matchDurationMs ?? null,
      wallElapsedMs: summary.test?.wallElapsedMs ?? null,
    },
    authoritativeTicks: {
      finalTick: statusMatch?.tick ?? server?.tick ?? null,
      totalTicks: statusTiming?.totalTicks ?? server?.actualTicks ?? null,
      processTicks: statusTiming?.processTicks ?? server?.stats?.processTicks ?? null,
      expectedTicksAt20Hz: server?.expectedTicksAt20Hz ?? null,
      effectiveHz: server?.effectiveHz ?? null,
    },
    results: resultEntries,
    outcomesMatch: [0, 1].every((seat) => resultEntries[seat]?.outcome === expectedOutcome(seat)),
    closed: status?.closed ?? summary.closed ?? null,
    closedReason: status?.closedReason ?? null,
    reservation: status?.reservation ?? summary.reservation ?? null,
    reconstruction: {
      ready: reconstruction.ready ?? null,
      epoch: reconstruction.epoch ?? null,
      sequence: reconstruction.seq ?? null,
      tick: reconstruction.tick ?? null,
      serverTick: reconstruction.serverTick ?? null,
      tickMatches: reconstruction.tickMatches ?? null,
      outcomesMatch: reconstruction.outcomesMatch ?? null,
      mapTiles: reconstruction.mapTiles ?? null,
      fogTiles: reconstruction.fogTiles ?? null,
    },
    unplannedRestart,
    commands: {
      sent: summary.commands?.sent ?? null,
      accepted: summary.commands?.accepted ?? null,
      rejected: summary.commands?.rejected ?? null,
      timeouts: summary.commands?.timeouts ?? null,
      acceptedEvents: acceptedCommands,
      rejectedEvents: rejectedCommands,
      bySeatAndType: commandTypes,
      rejectionByCode: summary.commands?.rejectionByCode ?? null,
      latencyMs: summary.commands?.latencyMs ?? null,
      balance: summary.commands?.sent
        ? Math.min(...summary.commands.sent) / Math.max(...summary.commands.sent)
        : null,
    },
    transport: {
      syncs: metrics.syncs ?? null,
      deltas: metrics.deltas ?? null,
      syncBytes: metrics.syncBytes ?? null,
      deltaBytes: metrics.deltaBytes ?? null,
      firstSyncBytes: metrics.firstSyncBytes ?? null,
      syncMapBytes: metrics.syncMapBytes ?? null,
      deltaMapBytes: metrics.deltaMapBytes ?? null,
      deltaSize: metrics.deltaSize ?? null,
      fogEntries: metrics.fogEntries ?? null,
      epochs: metrics.epochs ?? null,
      rejectedUpdates: metrics.rejectedUpdates ?? null,
      resyncRequests: metrics.resyncRequests ?? null,
      perSeat: transport.map((entry) => ({
        seat: entry.seat,
        count: entry.count,
        bytes: entry.bytes,
        frequencyHz: entry.frequencyHz,
        longestGapMs: entry.longestGapMs,
        sizes: entry.sizes,
        gaps: entry.gaps,
        firstTick: entry.firstTick,
        lastTick: entry.lastTick,
      })),
    },
    keepalive: {
      sent: summary.keepalive?.sent ?? null,
      acked: summary.keepalive?.acked ?? null,
      server: summary.keepalive?.server ?? null,
      ackCoverage: summary.keepalive?.sent
        ? [0, 1].map((seat) =>
            summary.keepalive.sent[seat]
              ? summary.keepalive.acked[seat] / summary.keepalive.sent[seat]
              : null,
          )
        : null,
    },
    socket: {
      closes: socketCloses,
      reconnects,
      reconnectsSummary: summary.reconnects ?? null,
      closeEventCount: socketCloses.length,
      closeWithCodeCount: socketCloses.filter((event) => event.code !== null).length,
      closeWithoutCodeCount: socketCloses.filter((event) => event.code === null).length,
      unplannedCloses,
      // Derived, not asserted: a null-code close that does not line up with a
      // controlled restart is the shape a half-open socket loss would leave.
      halfOpenObserved: false,
      halfOpenNote: `${socketCloses.filter((event) => event.code === null).length} null-code closes, ${controlledRestartRequestAt.length} controlled restarts; ${unplannedCloses.length} null-code closes not explained by a controlled restart.`,
    },
    persistence: {
      finalStatus: finalPersistence,
      snapshotCycles: finalPersistence?.snapshotCycles ?? null,
      failures: finalPersistence?.failures ?? null,
      behind: finalPersistence?.behind ?? null,
      lastSnapshotBytes: finalPersistence?.lastSnapshotBytes ?? null,
      maxSnapshotBytes: finalPersistence?.maxSnapshotBytes ?? null,
      checkpointGapDistributionMs: {
        count: checkpointGaps.length,
        p50: percentile(checkpointGaps, 50),
        p95: percentile(checkpointGaps, 95),
        p99: percentile(checkpointGaps, 99),
        max: checkpointGaps.length ? Math.max(...checkpointGaps) : null,
        min: checkpointGaps.length ? Math.min(...checkpointGaps) : null,
      },
      statusSamples: statusSamples.length,
    },
    lifecycle: {
      final: finalLifecycle,
      reservations: finalReservations,
      capacity: null,
      deployedSmoke: null,
    },
    restarts: restartAnalysis,
    combatContinuity: summary.combatContinuity ?? null,
    combat: summary.combat ?? null,
    finalSnapshot: summary.snapshotReadback ?? null,
    errors: summary.errors ?? [],
    assemblyRejects,
    unexpectedAssemblyRejects,
    serverErrors,
    statusSamples: statusSamples.length,
    commandEvents: commandEvents.length,
  },
  derived: {
    wholeMatchRateHz:
      server?.effectiveHz ??
      (server?.actualTicks && server?.elapsedMs
        ? server.actualTicks / (server.elapsedMs / 1000)
        : null),
    restartRollbackMaxMs:
      restartAnalysis.length > 0
        ? Math.max(...restartAnalysis.map((entry) => entry.elapsedRollbackMs ?? 0))
        : null,
    checkpointAgeMaxMs:
      restartAnalysis.length > 0
        ? Math.max(...restartAnalysis.map((entry) => entry.actualCheckpointAgeAtRequestMs ?? 0))
        : null,
    commandAcceptanceRate:
      summary.commands?.sent && summary.commands?.accepted
        ? sum(summary.commands.accepted) / sum(summary.commands.sent)
        : null,
    transportTotalBytes:
      metrics.syncBytes && metrics.deltaBytes
        ? sum(metrics.syncBytes) + sum(metrics.deltaBytes)
        : null,
    syncsPerSeat:
      metrics.syncs && metrics.syncs.length === 2 ? metrics.syncs : null,
    deltasPerSeat:
      metrics.deltas && metrics.deltas.length === 2 ? metrics.deltas : null,
    /** Both seats must still be landing hits when the match ends. */
    combatSustained:
      summary.combatContinuity?.longestGapMs?.length === 2 &&
      summary.combat?.hits?.length === 2 &&
      summary.combat.hits.every((count) => count > 0),
    lastCombatAtMs: summary.combatContinuity?.lastHitAtMs ?? null,
    /** Every planned restart must show combat resuming afterwards. */
    combatResumedAfterEveryRestart:
      Array.isArray(summary.combatContinuity?.restarts) &&
      summary.combatContinuity.restarts.every((entry) =>
        entry.firstHitAfterMs?.every((value) => value !== null),
      ),
    finalSnapshotReadBack: summary.snapshotReadback?.ok === true,
    finalSnapshotValidated: summary.snapshotReadback?.validation?.ok === true,
    finalSnapshotSha256: summary.snapshotReadback?.captured?.sha256 ?? null,
    finalSnapshotByteLength: summary.snapshotReadback?.readback?.byteLength ?? null,
    finalSnapshotHashVerifiedLocally: summary.snapshotReadback?.hashMatchesServer ?? null,
  },
  limitations: [
    'Cloudflare durableObjectsPeriodicGroups CPU is aggregate per object-minute, not individual-tick CPU.',
    'The 10 ms individual-tick CPU target is not established by this analysis.',
    'Platform memory is an isolate maximum per bucket, not retained application heap.',
    'Room diagnostics reset at each Durable Object restart; processTicks is post-restart only, while totalTicks is the durable whole-match counter.',
    'The harness samples status every 10 s normally and 250 ms around restarts; checkpoint age is derived from the last successful persistence timestamp returned by the room.',
    'Combat timelines are stamped with the client clock when a delivered projection reports the event, so they share the client clock used for restart timing, not the server clock.',
    'The final snapshot read-back proves the stored bytes validate; it does not prove they would restore into a running game, because the read path deliberately does not restore.',
  ],
};

writeFileSync(join(dir, 'phase2a16-analysis.json'), JSON.stringify(analysis, null, 2));
console.log(
  JSON.stringify(
    {
      out: join(dir, 'phase2a16-analysis.json'),
      finalTick: analysis.observed.authoritativeTicks.finalTick,
      totalTicks: analysis.observed.authoritativeTicks.totalTicks,
      processTicks: analysis.observed.authoritativeTicks.processTicks,
      effectiveHz: analysis.derived.wholeMatchRateHz,
      result: analysis.observed.results,
      closed: analysis.observed.closed,
      reservation: analysis.observed.reservation,
      restarts: restartAnalysis.map((entry) => ({
        index: entry.index,
        actualAgeMs: entry.actualCheckpointAgeAtRequestMs,
        rollbackTicks: entry.tickRollback,
        rollbackMs: entry.elapsedRollbackMs,
        reconnect: entry.reconnect.map((seat) => seat.firstSyncMsAfterClose),
      })),
      commands: analysis.observed.commands,
      protocolRejected: analysis.observed.transport.rejectedUpdates,
      keepalive: analysis.observed.keepalive,
      persistenceFailures: analysis.observed.persistence.failures,
      combat: {
        hits: analysis.observed.combat?.hits ?? null,
        destroyed: analysis.observed.combat?.enemyUnitsLost ?? null,
        replacements: analysis.observed.combat?.replacements ?? null,
        activeWindows: analysis.observed.combatContinuity?.activeWindows ?? null,
        longestGapMs: analysis.observed.combatContinuity?.longestGapMs ?? null,
        restarts: analysis.observed.combatContinuity?.restarts?.map((entry) => ({
          index: entry.index,
          firstHitAfterMs: entry.firstHitAfterMs,
        })),
      },
      finalSnapshot: {
        ok: analysis.observed.finalSnapshot?.ok ?? null,
        sha256: analysis.derived.finalSnapshotSha256,
        byteLength: analysis.derived.finalSnapshotByteLength,
        validated: analysis.derived.finalSnapshotValidated,
        hashVerifiedLocally: analysis.derived.finalSnapshotHashVerifiedLocally,
      },
    },
    null,
    2,
  ),
);
