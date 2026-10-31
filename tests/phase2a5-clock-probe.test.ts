import { runClockProbe } from '../src/multiplayer/clockProbe';

describe('Phase 2A.5 deployed clock probe', () => {
  it('runs bounded, increasing CPU workloads and reports clock deltas', async () => {
    const result = await runClockProbe(1_000);

    expect(result.version).toBe(1);
    expect(result.method).toBe('synchronous-cpu-workload');
    expect(result.iterations).toBe(1_000);
    expect(result.workloads.map((workload) => workload.iterations)).toEqual([1_000, 2_000, 4_000]);
    expect(result.workloadMultipliers).toEqual([1, 2, 4]);

    for (const workload of result.workloads) {
      expect(Number.isFinite(workload.checksum)).toBe(true);
      expect(workload.checksum).toBeGreaterThanOrEqual(0);
      expect(workload.clocks).toHaveLength(4);
      for (const clock of workload.clocks) {
        expect(typeof clock.available).toBe('boolean');
        if (clock.available) {
          expect(clock.error).toBeNull();
          expect(clock.delta).not.toBeNull();
          expect(clock.delta!).toBeGreaterThanOrEqual(0);
        } else {
          expect(clock.delta).toBeNull();
          expect(clock.error).toBeTruthy();
        }
      }
    }

    // Node's performance.now advances during CPU work; deployed Workers may
    // report zero. The probe must distinguish the two without inventing values.
    const performanceClock = result.workloads[0].clocks.find(
      (clock) => clock.name === 'performance.now',
    );
    expect(performanceClock?.available).toBe(true);
    expect(performanceClock?.delta).toBeGreaterThan(0);

    // Node exposes hrtime.bigint; the bigint branch must not be reported as
    // unavailable merely because the value is not a number.
    const hrClock = result.workloads[0].clocks.find(
      (clock) => clock.name === 'process.hrtime.bigint',
    );
    expect(hrClock?.available).toBe(true);
    expect(hrClock?.delta).not.toBeNull();
  });

  it('clamps requested iterations to a small fixed bound', async () => {
    const low = await runClockProbe(1);
    expect(low.iterations).toBe(1_000);
    expect(low.workloads.map((workload) => workload.iterations)).toEqual([1_000, 2_000, 4_000]);

    const high = await runClockProbe(10_000_000);
    expect(high.iterations).toBe(250_000);
    expect(high.workloads.map((workload) => workload.iterations)).toEqual([
      250_000, 500_000, 1_000_000,
    ]);
  });

  it('reports an I/O comparison without exposing game or credential data', async () => {
    const result = await runClockProbe(1_000);
    expect(result.ioYield).toHaveLength(4);
    expect(result.notes).toContain('zero delta');
    expect(JSON.stringify(result)).not.toMatch(/token|seat|player|gameState|scenario/i);
  });
});
