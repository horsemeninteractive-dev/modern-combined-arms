import {
  CALIBRATION_BATCH_SIZES,
  createCalibrationGame,
  isCalibrationBatch,
  runBatchCalibration,
} from '../src/multiplayer/batchCalibration';

describe('Phase 2A.6 batch calibration', () => {
  it('runs a setup-only control and a fixed baseline batch', () => {
    const zero = runBatchCalibration('baseline', 0);
    expect(zero.completedTicks).toBe(0);
    expect(zero.finalTick).toBe(0);
    expect(zero.final.checksum).toBe(zero.initial.checksum);
    expect(zero.workload.addedStressUnits).toBe(0);
    expect(zero.workload.totalScenarioUnits).toBe(16);
    expect(zero.commandsIssued).toBe(0);

    const five = runBatchCalibration('baseline', 5);
    expect(five.completedTicks).toBe(5);
    expect(five.finalTick).toBe(5);
    expect(five.final.checksum).not.toBe(five.initial.checksum);
    expect(five.workload.totalScenarioUnits).toBe(16);
  });

  it('is deterministic for identical profile, batch and inputs', () => {
    const first = runBatchCalibration('baseline', 10, 'det-a');
    const second = runBatchCalibration('baseline', 10, 'det-a');
    expect(second.final.checksum).toBe(first.final.checksum);
    expect(second.finalTick).toBe(first.finalTick);
    expect(second.final).toEqual(first.final);
    expect(second.activity).toEqual(first.activity);
    expect(second.rngState).toBe(first.rngState);
  });

  it('adds a larger reproducible stress force and fixed commands', () => {
    const baseline = runBatchCalibration('baseline', 20);
    const stress = runBatchCalibration('stress', 20);

    expect(stress.workload.addedStressUnits).toBe(64);
    expect(stress.workload.totalScenarioUnits).toBe(80);
    expect(stress.final.units).toBeGreaterThan(baseline.final.units);
    expect(stress.commandsIssued).toBe(2);
    expect(stress.commandEntityIds).toBeGreaterThan(0);
    expect(stress.completedTicks).toBe(20);
    expect(stress.final.checksum).not.toBe(baseline.final.checksum);
    expect(stress.victory).toBe('playing');
    expect(stress.activity.shots + stress.activity.impacts + stress.activity.kills).toBeGreaterThan(0);
  });

  it('A/B: a direct tick loop and the batch runner produce the same state', () => {
    const checksum = (text: string) => {
      let hash = 0xcbf29ce484222325n;
      for (let index = 0; index < text.length; index++) {
        hash ^= BigInt(text.charCodeAt(index));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
      }
      return hash.toString(16).padStart(16, '0');
    };

    for (const profile of ['baseline', 'stress'] as const) {
      const direct = createCalibrationGame(profile);
      for (let index = 0; index < 20; index++) direct.game.tick();
      const result = runBatchCalibration(profile, 20, `ab-${profile}`);

      expect(result.finalTick).toBe(20);
      expect(result.completedTicks).toBe(20);
      expect(result.final.checksum).toBe(checksum(direct.game.stateHash()));
      expect(result.final.units).toBe(direct.game.state.entities.filter((e) => e.kind === 'unit' && e.hp > 0).length);
    }
  });

  it('returns bounded counters, not raw game state', () => {
    const result = runBatchCalibration('stress', 5, 'bounded');
    const serialised = JSON.stringify(result);
    expect(serialised).not.toMatch(/"tiles"|"entities":\[|"projectiles":\[|token|seat/i);
    expect(result.final.stateHashLength).toBeGreaterThan(0);
    expect(result.notes).toContain('not per-tick CPU');
  });

  it('rejects unsupported batch sizes and profiles outside the allowlist', () => {
    expect(isCalibrationBatch(0)).toBe(true);
    expect(isCalibrationBatch(100)).toBe(true);
    expect(isCalibrationBatch(2)).toBe(false);
    expect(CALIBRATION_BATCH_SIZES).toEqual([0, 1, 5, 10, 20, 50, 100]);

    expect(() => runBatchCalibration('baseline', 2 as never)).toThrow('Unsupported');
    expect(() => runBatchCalibration('unknown' as never, 5)).toThrow('Unknown');
    expect(() => runBatchCalibration('baseline', 5, 'x'.repeat(49))).toThrow('run id');
  });
});
