/**
 * Deployed clock-capability probe.
 *
 * Cloudflare freezes timer APIs during CPU-only work as a Spectre mitigation.
 * This probe does not attempt to time a production tick; it establishes which
 * clocks, if any, advance around identical synchronous work in the actual
 * deployed runtime. It is exposed only through the admin-only status route and
 * returns bounded aggregates, never game state or credentials.
 */

export type ClockName =
  | 'performance.now'
  | 'Date.now'
  | 'process.hrtime.bigint'
  | 'process.cpuUsage';

export interface ClockDelta {
  name: ClockName;
  available: boolean;
  /** Sum of user + system microseconds for process.cpuUsage; nanoseconds for hrtime. */
  unit: 'ms' | 'ns' | 'us';
  delta: number | null;
  error: string | null;
}

export interface ClockWorkload {
  iterations: number;
  checksum: number;
  clocks: ClockDelta[];
}

export interface ClockProbeResult {
  version: 1;
  method: 'synchronous-cpu-workload';
  iterations: number;
  workloadMultipliers: number[];
  workloads: ClockWorkload[];
  /** Whether each clock advanced across a real I/O turn. */
  ioYield: ClockDelta[];
  notes: string;
}

interface ProcessLike {
  hrtime?: {
    bigint?: () => bigint;
  };
  cpuUsage?: () => { user: number; system: number };
}

interface Snapshot {
  performanceNow: number | null;
  dateNow: number | null;
  hrTime: bigint | null;
  cpuUsage: number | null;
  errors: Partial<Record<ClockName, string>>;
}

function processGlobal(): ProcessLike | null {
  const candidate = (globalThis as { process?: ProcessLike }).process;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

function errorText(error: unknown): string {
  return String(error).slice(0, 60);
}

function snapshot(): Snapshot {
  const result: Snapshot = {
    performanceNow: null,
    dateNow: null,
    hrTime: null,
    cpuUsage: null,
    errors: {},
  };
  try {
    result.performanceNow =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : null;
    if (result.performanceNow === null) result.errors['performance.now'] = 'unavailable';
  } catch (error) {
    result.errors['performance.now'] = errorText(error);
  }
  try {
    result.dateNow = Date.now();
  } catch (error) {
    result.errors['Date.now'] = errorText(error);
  }
  const proc = processGlobal();
  if (!proc?.hrtime?.bigint) {
    result.errors['process.hrtime.bigint'] = 'unavailable';
  } else {
    try {
      result.hrTime = proc.hrtime.bigint();
    } catch (error) {
      result.errors['process.hrtime.bigint'] = errorText(error);
    }
  }
  if (!proc?.cpuUsage) {
    result.errors['process.cpuUsage'] = 'unavailable';
  } else {
    try {
      const usage = proc.cpuUsage();
      result.cpuUsage = usage.user + usage.system;
    } catch (error) {
      result.errors['process.cpuUsage'] = errorText(error);
    }
  }
  return result;
}

function delta(
  name: ClockName,
  unit: 'ms' | 'ns' | 'us',
  before: number | bigint | null,
  after: number | bigint | null,
  beforeError: string | undefined,
  afterError: string | undefined,
): ClockDelta {
  if (typeof before === 'number' && typeof after === 'number') {
    return {
      name,
      available: true,
      unit,
      delta: Math.max(0, after - before),
      error: null,
    };
  }
  if (typeof before === 'bigint' && typeof after === 'bigint') {
    return {
      name,
      available: true,
      unit,
      delta: Math.max(0, Number(after - before)),
      error: null,
    };
  }
  return {
    name,
    available: false,
    unit,
    delta: null,
    error: beforeError ?? afterError ?? 'unavailable',
  };
}

function clockDeltas(before: Snapshot, after: Snapshot): ClockDelta[] {
  return [
    delta(
      'performance.now',
      'ms',
      before.performanceNow,
      after.performanceNow,
      before.errors['performance.now'],
      after.errors['performance.now'],
    ),
    delta(
      'Date.now',
      'ms',
      before.dateNow,
      after.dateNow,
      before.errors['Date.now'],
      after.errors['Date.now'],
    ),
    delta(
      'process.hrtime.bigint',
      'ns',
      before.hrTime,
      after.hrTime,
      before.errors['process.hrtime.bigint'],
      after.errors['process.hrtime.bigint'],
    ),
    delta(
      'process.cpuUsage',
      'us',
      before.cpuUsage,
      after.cpuUsage,
      before.errors['process.cpuUsage'],
      after.errors['process.cpuUsage'],
    ),
  ];
}

/** Deterministic arithmetic survives dead-code elimination because it is returned. */
function burn(iterations: number): number {
  let value = 0x9e3779b9;
  for (let index = 0; index < iterations; index++) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value = (value + index) >>> 0;
  }
  return value >>> 0;
}

function ioYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runClockProbe(iterations = 100_000): Promise<ClockProbeResult> {
  const boundedIterations = Math.max(1_000, Math.min(250_000, Math.floor(iterations)));
  const multipliers = [1, 2, 4];
  const workloads: ClockWorkload[] = [];
  for (const multiplier of multipliers) {
    const count = boundedIterations * multiplier;
    const before = snapshot();
    const checksum = burn(count);
    const after = snapshot();
    workloads.push({
      iterations: count,
      checksum,
      clocks: clockDeltas(before, after),
    });
  }

  const ioBefore = snapshot();
  await ioYield();
  const ioAfter = snapshot();

  return {
    version: 1,
    method: 'synchronous-cpu-workload',
    iterations: boundedIterations,
    workloadMultipliers: multipliers,
    workloads,
    ioYield: clockDeltas(ioBefore, ioAfter),
    notes:
      'CPU-only workloads run synchronously. A zero delta means the clock did not advance, not that no CPU was used. ioYield runs after a real timer turn and is shown for comparison only.',
  };
}
