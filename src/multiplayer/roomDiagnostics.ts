/**
 * Bounded, aggregate instrumentation for one authoritative room.
 *
 * This is deliberately separate from GameState, SaveData, RoomSnapshotV1 and
 * team projections. It holds fixed-size histograms and counters only: no
 * per-tick log, no unbounded history and no storage write of its own. The
 * Durable Object exposes the summary through its existing admin-only status
 * route and emits one summary line at close.
 */

export function monotonicNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** UTF-8 byte length without allocating a TextEncoder result per payload. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

export interface BucketStats {
  count: number;
  min: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  p999: number | null;
  max: number | null;
  mean: number | null;
  sum: number;
  over10: number;
  over50: number;
  bucketWidth: number;
  overflow: number;
}

class BucketHistogram {
  private readonly counts: Uint32Array;
  private readonly width: number;
  private count = 0;
  private sum = 0;
  private min = Number.POSITIVE_INFINITY;
  private max = 0;
  private overflow = 0;
  private over10 = 0;
  private over50 = 0;

  constructor(width: number, maxValue: number) {
    this.width = width;
    this.counts = new Uint32Array(Math.max(1, Math.ceil(maxValue / width)));
  }

  record(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.count++;
    this.sum += value;
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;
    if (value > 10) this.over10++;
    if (value > 50) this.over50++;
    const index = Math.floor(value / this.width);
    if (index >= this.counts.length) {
      this.overflow++;
      return;
    }
    this.counts[index]++;
  }

  stats(): BucketStats {
    return {
      count: this.count,
      min: this.count ? this.min : null,
      p50: this.quantile(0.5),
      p90: this.quantile(0.9),
      p95: this.quantile(0.95),
      p99: this.quantile(0.99),
      p999: this.quantile(0.999),
      max: this.count ? this.max : null,
      mean: this.count ? this.sum / this.count : null,
      sum: this.sum,
      over10: this.over10,
      over50: this.over50,
      bucketWidth: this.width,
      overflow: this.overflow,
    };
  }

  private quantile(p: number): number | null {
    if (!this.count) return null;
    const target = Math.max(0, Math.ceil(p * this.count) - 1);
    let seen = 0;
    for (let index = 0; index < this.counts.length; index++) {
      seen += this.counts[index];
      if (target < seen) {
        // A bucket midpoint keeps low-percentile values from being reported as
        // the bucket's upper bound. Never report more than the observed max.
        return Math.min((index + 0.5) * this.width, this.max);
      }
    }
    return this.max;
  }
}

export interface RoomDiagnosticsOptions {
  enabled?: boolean;
}

interface PersistenceCycle {
  kind: 'snapshot' | 'meta' | 'load';
  durationMs: number;
  bytes: number;
  chunks: number;
  ok: boolean;
  error?: string;
}

export interface RoomDiagnosticsSummary {
  version: 1;
  clock: 'performance.now';
  clockAdvanced: boolean;
  timerNote: string;
  enabled: boolean;
  startedAt: number;
  activatedAt: number | null;
  closedAt: number | null;
  closedReason: string | null;
  tick: {
    count: number;
    totalMs: number;
    simulationMs: number;
    otherWorkMs: number;
    errors: number;
    lastError: string | null;
    durationsAvailable: boolean;
    duration: BucketStats;
    simulation: BucketStats;
  };
  snapshots: {
    total: number;
    bytes: number;
    bytesMethod: 'utf16-code-units';
    perSeat: Array<{
      seat: number;
      count: number;
      bytes: number;
      size: BucketStats;
      serialization: BucketStats;
    }>;
    serialization: BucketStats;
    durationsAvailable: boolean;
    failures: {
      serialization: number;
      send: number;
      controlSend: number;
      slowClient: number;
    };
  };
  lifecycle: {
    connectionsAccepted: number;
    seatConnects: number[];
    seatDisconnects: number[];
    reconnectAttempts: number;
    reconnectSuccesses: number;
    reconnectRejections: number;
    socketRejections: Record<string, number>;
    deadlineHits: number;
    abnormalShutdowns: number;
  };
  keepalive: {
    received: number;
    acked: number;
    rateLimited: number;
  };
  /** Full synchronisations versus incremental updates on the v2 stream. */
  sync: {
    count: number;
    bytes: number;
    perSeat: number[];
  };
  delta: {
    count: number;
    bytes: number;
    perSeat: number[];
    size: BucketStats;
  };
  resync: {
    requested: number;
    accepted: number;
    rejected: number;
    lastRejection: string | null;
  };
  socket: {
    /** Highest bufferedAmount observed at send time, per seat. */
    maxBufferedBytes: number[];
    lastBufferedBytes: number[];
  };
  reservations: {
    heartbeatSuccesses: number;
    heartbeatFailures: number;
    releaseSuccesses: number;
    releaseFailures: number;
    lastFailureCode: string | null;
  };
  persistence: {
    reads: number;
    writes: number;
    deletes: number;
    readBytes: number;
    writeBytes: number;
    snapshotCycles: number;
    metaCycles: number;
    loadCycles: number;
    failures: number;
    lastSuccessAt: number | null;
    lastFailureAt: number | null;
    lastFailureKind: string | null;
    lastFailure: string | null;
    chunksWritten: number;
    lastSnapshotBytes: number;
    maxSnapshotBytes: number;
    maxCycleMs: number;
    durationsAvailable: boolean;
    cycleDuration: BucketStats;
    operationDuration: BucketStats;
    ageSinceSuccessMs: number | null;
    behind: boolean;
  };
}

const PERSIST_BEHIND_FACTOR = 2;

function safeCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = String(code).slice(0, 48).replace(/[^a-zA-Z0-9_-]/g, '');
  return trimmed || null;
}

export class RoomDiagnostics {
  readonly enabled: boolean;
  readonly startedAt = Date.now();
  clockAdvanced = false;
  activatedAt: number | null = null;
  closedAt: number | null = null;
  closedReason: string | null = null;

  private tickCount = 0;
  private tickTotalMs = 0;
  private simulationTotalMs = 0;
  private tickErrors = 0;
  private lastTickError: string | null = null;

  private readonly tickDuration = new BucketHistogram(0.1, 50);
  private readonly simulationDuration = new BucketHistogram(0.1, 50);

  private snapshotTotal = 0;
  private snapshotBytes = 0;
  private readonly snapshotCounts = [0, 0];
  private readonly snapshotBytesBySeat = [0, 0];
  private readonly snapshotSizes = [
    new BucketHistogram(256, 131_072),
    new BucketHistogram(256, 131_072),
  ];
  private readonly snapshotSerializationAll = new BucketHistogram(0.1, 50);
  private readonly snapshotSerialization = [
    new BucketHistogram(0.1, 50),
    new BucketHistogram(0.1, 50),
  ];
  private syncCount = 0;
  private syncBytes = 0;
  private readonly syncPerSeat = [0, 0];
  private deltaCount = 0;
  private deltaBytes = 0;
  private readonly deltaPerSeat = [0, 0];
  private readonly deltaSizes = new BucketHistogram(64, 131_072);
  private resyncRequested = 0;
  private resyncAccepted = 0;
  private resyncRejected = 0;
  private lastResyncRejection: string | null = null;

  private snapshotSerializationFailures = 0;
  private snapshotSendFailures = 0;
  private controlSendFailures = 0;
  private slowClientEvents = 0;

  private connectionsAccepted = 0;
  private readonly seatConnects = [0, 0];
  private readonly seatDisconnects = [0, 0];
  private reconnectAttempts = 0;
  private reconnectSuccesses = 0;
  private reconnectRejections = 0;
  private readonly socketRejections: Record<string, number> = {};
  private deadlineHits = 0;
  private abnormalShutdowns = 0;

  private keepalivesReceived = 0;
  private keepalivesAcked = 0;
  private keepalivesRateLimited = 0;
  private readonly maxBufferedBytes = [0, 0];
  private readonly lastBufferedBytes = [0, 0];

  private heartbeatSuccesses = 0;
  private heartbeatFailures = 0;
  private releaseSuccesses = 0;
  private releaseFailures = 0;
  private lastFailureCode: string | null = null;

  private persistenceReads = 0;
  private persistenceWrites = 0;
  private persistenceDeletes = 0;
  private persistenceReadBytes = 0;
  private persistenceWriteBytes = 0;
  private persistenceSnapshotCycles = 0;
  private persistenceMetaCycles = 0;
  private persistenceLoadCycles = 0;
  private persistenceFailures = 0;
  private persistenceLastSuccessAt: number | null = null;
  private persistenceLastFailureAt: number | null = null;
  private persistenceLastFailureKind: string | null = null;
  private persistenceLastFailure: string | null = null;
  private persistenceChunksWritten = 0;
  private persistenceLastSnapshotBytes = 0;
  private persistenceMaxSnapshotBytes = 0;
  private persistenceMaxCycleMs = 0;
  private readonly persistenceCycles = new BucketHistogram(1, 2000);
  private readonly persistenceOperations = new BucketHistogram(1, 500);

  constructor(options: RoomDiagnosticsOptions = {}) {
    this.enabled = options.enabled ?? true;
  }

  markActivated(at = Date.now()): void {
    if (!this.enabled || this.activatedAt !== null) return;
    this.activatedAt = at;
  }

  markClosed(reason: string, at = Date.now()): void {
    if (!this.enabled || this.closedAt !== null) return;
    this.closedAt = at;
    this.closedReason = reason.slice(0, 80);
  }

  recordTick(totalMs: number, simulationMs: number): void {
    if (!this.enabled) return;
    if (totalMs > 0 || simulationMs > 0) this.clockAdvanced = true;
    this.tickCount++;
    this.tickTotalMs += Math.max(0, totalMs);
    this.simulationTotalMs += Math.max(0, simulationMs);
    this.tickDuration.record(totalMs);
    this.simulationDuration.record(simulationMs);
  }

  recordTickError(error: unknown): void {
    if (!this.enabled) return;
    this.tickErrors++;
    this.lastTickError = String(error).slice(0, 120);
  }

  recordSnapshot(seat: number, serializationMs: number, bytes: number): void {
    if (!this.enabled || (seat !== 0 && seat !== 1)) return;
    if (serializationMs > 0) this.clockAdvanced = true;
    this.snapshotTotal++;
    this.snapshotBytes += bytes;
    this.snapshotCounts[seat]++;
    this.snapshotBytesBySeat[seat] += bytes;
    this.snapshotSizes[seat].record(bytes);
    this.snapshotSerializationAll.record(serializationMs);
    this.snapshotSerialization[seat].record(serializationMs);
  }

  recordSync(seat: number, bytes: number): void {
    if (!this.enabled || (seat !== 0 && seat !== 1)) return;
    this.syncCount++;
    this.syncBytes += bytes;
    this.syncPerSeat[seat]++;
  }

  recordDelta(seat: number, bytes: number): void {
    if (!this.enabled || (seat !== 0 && seat !== 1)) return;
    this.deltaCount++;
    this.deltaBytes += bytes;
    this.deltaPerSeat[seat]++;
    this.deltaSizes.record(bytes);
  }

  recordResyncAccepted(): void {
    if (!this.enabled) return;
    this.resyncRequested++;
    this.resyncAccepted++;
  }

  recordResyncRejected(code: string): void {
    if (!this.enabled) return;
    this.resyncRequested++;
    this.resyncRejected++;
    this.lastResyncRejection = safeCode(code);
  }

  recordSnapshotSerializationFailure(): void {
    if (!this.enabled) return;
    this.snapshotSerializationFailures++;
  }

  recordSnapshotSendFailure(): void {
    if (!this.enabled) return;
    this.snapshotSendFailures++;
  }

  recordControlSendFailure(): void {
    if (!this.enabled) return;
    this.controlSendFailures++;
  }

  recordSlowClient(): void {
    if (!this.enabled) return;
    this.slowClientEvents++;
  }

  recordConnect(seat: number, reconnect: boolean): void {
    if (!this.enabled) return;
    this.connectionsAccepted++;
    if (seat === 0 || seat === 1) this.seatConnects[seat]++;
    if (reconnect) this.reconnectSuccesses++;
  }

  recordReconnectAttempt(): void {
    if (!this.enabled) return;
    this.reconnectAttempts++;
  }

  recordReconnectRejection(code: string): void {
    if (!this.enabled) return;
    this.reconnectRejections++;
    this.recordSocketRejection(code);
  }

  recordSocketRejection(code: string): void {
    if (!this.enabled) return;
    const safe = safeCode(code) ?? 'unknown';
    if (this.socketRejections[safe] !== undefined) {
      this.socketRejections[safe]++;
      return;
    }
    if (Object.keys(this.socketRejections).length >= 16) {
      this.socketRejections.other = (this.socketRejections.other ?? 0) + 1;
      return;
    }
    this.socketRejections[safe] = 1;
  }

  recordDisconnect(seat: number): void {
    if (!this.enabled || (seat !== 0 && seat !== 1)) return;
    this.seatDisconnects[seat]++;
  }

  recordDeadline(): void {
    if (!this.enabled) return;
    this.deadlineHits++;
  }

  recordAbnormalShutdown(): void {
    if (!this.enabled) return;
    this.abnormalShutdowns++;
  }

  recordKeepalive(): void {
    if (!this.enabled) return;
    this.keepalivesReceived++;
  }

  recordKeepaliveAck(): void {
    if (!this.enabled) return;
    this.keepalivesAcked++;
  }

  recordKeepaliveRateLimited(): void {
    if (!this.enabled) return;
    this.keepalivesRateLimited++;
  }

  recordBufferedAmount(seat: number, bytes: number): void {
    if (!this.enabled || (seat !== 0 && seat !== 1)) return;
    const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    this.lastBufferedBytes[seat] = safe;
    if (safe > this.maxBufferedBytes[seat]) this.maxBufferedBytes[seat] = safe;
  }

  recordHeartbeat(ok: boolean, code?: string): void {
    if (!this.enabled) return;
    if (ok) {
      this.heartbeatSuccesses++;
      return;
    }
    this.heartbeatFailures++;
    this.lastFailureCode = safeCode(code);
  }

  recordRelease(ok: boolean, code?: string): void {
    if (!this.enabled) return;
    if (ok) {
      this.releaseSuccesses++;
      return;
    }
    this.releaseFailures++;
    this.lastFailureCode = safeCode(code);
  }

  recordPersistenceOperation(op: 'read' | 'write' | 'delete', durationMs: number): void {
    if (!this.enabled) return;
    if (durationMs > 0) this.clockAdvanced = true;
    if (op === 'read') this.persistenceReads++;
    else if (op === 'write') this.persistenceWrites++;
    else this.persistenceDeletes++;
    this.persistenceOperations.record(durationMs);
  }

  recordPersistenceRead(bytes: number, durationMs: number): void {
    if (!this.enabled) return;
    if (durationMs > 0) this.clockAdvanced = true;
    this.persistenceReads++;
    this.persistenceReadBytes += Math.max(0, bytes);
    this.persistenceOperations.record(durationMs);
  }

  recordPersistenceCycle(cycle: PersistenceCycle): void {
    if (!this.enabled) return;
    const duration = Math.max(0, cycle.durationMs);
    if (duration > 0) this.clockAdvanced = true;
    this.persistenceMaxCycleMs = Math.max(this.persistenceMaxCycleMs, duration);
    this.persistenceCycles.record(duration);
    if (cycle.ok) {
      this.persistenceLastSuccessAt = Date.now();
      if (cycle.kind === 'snapshot') {
        this.persistenceSnapshotCycles++;
        this.persistenceChunksWritten += Math.max(0, cycle.chunks);
        this.persistenceLastSnapshotBytes = Math.max(0, cycle.bytes);
        this.persistenceMaxSnapshotBytes = Math.max(
          this.persistenceMaxSnapshotBytes,
          Math.max(0, cycle.bytes),
        );
        this.persistenceWriteBytes += Math.max(0, cycle.bytes);
      } else if (cycle.kind === 'meta') {
        this.persistenceMetaCycles++;
        this.persistenceWriteBytes += Math.max(0, cycle.bytes);
      } else {
        this.persistenceLoadCycles++;
        this.persistenceReadBytes += Math.max(0, cycle.bytes);
      }
      return;
    }
    this.persistenceFailures++;
    this.persistenceLastFailureAt = Date.now();
    this.persistenceLastFailureKind = cycle.kind;
    this.persistenceLastFailure = (cycle.error ?? 'unknown').slice(0, 120);
  }

  summary(now = Date.now(), persistIntervalMs = 15_000): RoomDiagnosticsSummary {
    const ageSinceSuccessMs =
      this.persistenceLastSuccessAt === null ? null : Math.max(0, now - this.persistenceLastSuccessAt);
    return {
      version: 1,
      clock: 'performance.now',
      clockAdvanced: this.clockAdvanced,
      timerNote:
        'Deployed Workers freeze timer APIs during CPU-only work as a Spectre mitigation. Zero durations mean the clock did not advance, not that the work took no time.',
      enabled: this.enabled,
      startedAt: this.startedAt,
      activatedAt: this.activatedAt,
      closedAt: this.closedAt,
      closedReason: this.closedReason,
      tick: {
        count: this.tickCount,
        totalMs: this.tickTotalMs,
        simulationMs: this.simulationTotalMs,
        otherWorkMs: Math.max(0, this.tickTotalMs - this.simulationTotalMs),
        errors: this.tickErrors,
        lastError: this.lastTickError,
        durationsAvailable: this.clockAdvanced,
        duration: this.tickDuration.stats(),
        simulation: this.simulationDuration.stats(),
      },
      snapshots: {
        total: this.snapshotTotal,
        bytes: this.snapshotBytes,
        bytesMethod: 'utf16-code-units',
        perSeat: [0, 1].map((seat) => ({
          seat,
          count: this.snapshotCounts[seat],
          bytes: this.snapshotBytesBySeat[seat],
          size: this.snapshotSizes[seat].stats(),
          serialization: this.snapshotSerialization[seat].stats(),
        })),
        serialization: this.snapshotSerializationAll.stats(),
        durationsAvailable: this.clockAdvanced,
        failures: {
          serialization: this.snapshotSerializationFailures,
          send: this.snapshotSendFailures,
          controlSend: this.controlSendFailures,
          slowClient: this.slowClientEvents,
        },
      },
      lifecycle: {
        connectionsAccepted: this.connectionsAccepted,
        seatConnects: [...this.seatConnects],
        seatDisconnects: [...this.seatDisconnects],
        reconnectAttempts: this.reconnectAttempts,
        reconnectSuccesses: this.reconnectSuccesses,
        reconnectRejections: this.reconnectRejections,
        socketRejections: { ...this.socketRejections },
        deadlineHits: this.deadlineHits,
        abnormalShutdowns: this.abnormalShutdowns,
      },
      keepalive: {
        received: this.keepalivesReceived,
        acked: this.keepalivesAcked,
        rateLimited: this.keepalivesRateLimited,
      },
      sync: {
        count: this.syncCount,
        bytes: this.syncBytes,
        perSeat: [...this.syncPerSeat],
      },
      delta: {
        count: this.deltaCount,
        bytes: this.deltaBytes,
        perSeat: [...this.deltaPerSeat],
        size: this.deltaSizes.stats(),
      },
      resync: {
        requested: this.resyncRequested,
        accepted: this.resyncAccepted,
        rejected: this.resyncRejected,
        lastRejection: this.lastResyncRejection,
      },
      socket: {
        maxBufferedBytes: [...this.maxBufferedBytes],
        lastBufferedBytes: [...this.lastBufferedBytes],
      },
      reservations: {
        heartbeatSuccesses: this.heartbeatSuccesses,
        heartbeatFailures: this.heartbeatFailures,
        releaseSuccesses: this.releaseSuccesses,
        releaseFailures: this.releaseFailures,
        lastFailureCode: this.lastFailureCode,
      },
      persistence: {
        reads: this.persistenceReads,
        writes: this.persistenceWrites,
        deletes: this.persistenceDeletes,
        readBytes: this.persistenceReadBytes,
        writeBytes: this.persistenceWriteBytes,
        snapshotCycles: this.persistenceSnapshotCycles,
        metaCycles: this.persistenceMetaCycles,
        loadCycles: this.persistenceLoadCycles,
        failures: this.persistenceFailures,
        lastSuccessAt: this.persistenceLastSuccessAt,
        lastFailureAt: this.persistenceLastFailureAt,
        lastFailureKind: this.persistenceLastFailureKind,
        lastFailure: this.persistenceLastFailure,
        chunksWritten: this.persistenceChunksWritten,
        lastSnapshotBytes: this.persistenceLastSnapshotBytes,
        maxSnapshotBytes: this.persistenceMaxSnapshotBytes,
        maxCycleMs: this.persistenceMaxCycleMs,
        durationsAvailable: this.clockAdvanced,
        cycleDuration: this.persistenceCycles.stats(),
        operationDuration: this.persistenceOperations.stats(),
        ageSinceSuccessMs,
        behind:
          ageSinceSuccessMs !== null && ageSinceSuccessMs > persistIntervalMs * PERSIST_BEHIND_FACTOR,
      },
    };
  }
}
