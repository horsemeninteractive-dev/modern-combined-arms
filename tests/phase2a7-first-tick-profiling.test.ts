import { createCalibrationGame, runBatchCalibration } from '../src/multiplayer/batchCalibration';
import { UNITS } from '../src/data/units';
import type { Game } from '../src/sim/game';

/**
 * Phase 2A.7 profiled the Phase 2A.6 stress workload locally. These checks prove
 * that the profiled workload is the deployed one and that preparing ticks
 * outside a profiling window (the harness method) does not change state.
 */

/** FNV-1a 64-bit over the deterministic state hash; same format as calibration. */
function checksum(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Phase 2A.6 deployed stress setup and first-tick checksums. Both were
 * re-baselined after the day/night detection, bridge-deck, reachable-stand and
 * unit-veterancy phases changed what the opening order produces (a formation
 * slot the hull cannot drive to is now walked out to reachable ground instead
 * of being refused) and what the state hash contains (veterancy carries the
 * crew's experience per entity). The workload, its ground-unit count and the
 * per-tick order accounting are unchanged.
 */
const DEPLOYED_STRESS_SETUP = 'dae9d509a4fe6587';
const DEPLOYED_STRESS_FIRST_TICK = '2b9a929f42e072e4';

function groundUnitCount(game: Game): number {
  return game.state.entities.filter(
    (entity) =>
      entity.kind === 'unit' &&
      entity.hp > 0 &&
      entity.owner >= 0 &&
      UNITS[entity.defId]?.domain !== 'air',
  ).length;
}

/** Harness-only access to the private queue, to isolate the no-order variant. */
function dropPendingOrders(game: Game): void {
  (game as unknown as { pending: unknown[] }).pending.length = 0;
}

describe('Phase 2A.7 first-tick profiling', () => {
  it('anchors the profiled stress workload to deployed Phase 2A.6 checksums', () => {
    const state = createCalibrationGame('stress');

    expect(checksum(state.game.stateHash())).toBe(DEPLOYED_STRESS_SETUP);
    expect(groundUnitCount(state.game)).toBe(80);

    state.game.tick();

    expect(state.game.state.tick).toBe(1);
    expect(checksum(state.game.stateHash())).toBe(DEPLOYED_STRESS_FIRST_TICK);
    // Every hull in the 80-unit order now receives a stand it can actually
    // drive to, so all 80 carry an order out of the first tick.
    expect(state.game.state.entities.filter((e) => e.kind === 'unit' && e.order).length).toBe(80);
  });

  it('A/B: preparing ticks before a profiled window does not change state', () => {
    const direct = createCalibrationGame('stress').game;
    for (let index = 0; index < 50; index++) direct.tick();

    const staged = createCalibrationGame('stress').game;
    for (let index = 0; index < 30; index++) staged.tick();
    staged.tick(); // tick 31, the profiled steady tick
    for (let index = 0; index < 19; index++) staged.tick();

    expect(staged.state.tick).toBe(50);
    expect(staged.stateHash()).toBe(direct.stateHash());
  });

  it('A/B: dropping the queued orders isolates the burst deterministically', () => {
    const withOrdersA = createCalibrationGame('stress');
    const withOrdersB = createCalibrationGame('stress');
    withOrdersA.game.tick();
    withOrdersB.game.tick();
    expect(withOrdersB.game.stateHash()).toBe(withOrdersA.game.stateHash());

    const withoutA = createCalibrationGame('stress');
    const withoutB = createCalibrationGame('stress');
    dropPendingOrders(withoutA.game);
    dropPendingOrders(withoutB.game);
    withoutA.game.tick();
    withoutB.game.tick();

    expect(withoutB.game.stateHash()).toBe(withoutA.game.stateHash());
    expect(withoutA.game.stateHash()).not.toBe(withOrdersA.game.stateHash());
    expect(withoutA.game.state.tick).toBe(1);
    expect(groundUnitCount(withoutA.game)).toBe(80);
  });

  it('keeps the batch calibration path unchanged', () => {
    const setup = runBatchCalibration('stress', 0);
    expect(setup.final.checksum).toBe(DEPLOYED_STRESS_SETUP);

    const first = runBatchCalibration('stress', 1, 'p2a7-ab');
    expect(first.completedTicks).toBe(1);
    expect(first.final.checksum).toBe(DEPLOYED_STRESS_FIRST_TICK);
  });
});
