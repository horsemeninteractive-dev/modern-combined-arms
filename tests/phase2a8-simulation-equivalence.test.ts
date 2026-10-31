import { createCalibrationGame } from '../src/multiplayer/batchCalibration';
import { TILE_SIZE } from '../src/sim/constants';
import { UNITS } from '../src/data/units';
import type { Game } from '../src/sim/game';
import baseline from './fixtures/phase2a8-path-baseline.json';

/**
 * Phase 2A.8 authoritative equivalence.
 *
 * The fixture was captured from a reconstructed pre-optimisation source tree
 * and also reproduces every Phase 2A.6 deployed checksum. These checks compare
 * the complete 80-unit stress run, the 16-unit baseline and the 9/18/27/36
 * path-scaling probe against that old capture.
 */

function checksum(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function pathsOf(game: Game) {
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

function summaryOf(game: Game) {
  const units = game.state.entities.filter((entity) => entity.kind === 'unit' && entity.hp > 0);
  const buildings = game.state.entities.filter(
    (entity) => entity.kind === 'building' && entity.hp > 0,
  );
  const eventCounts: Record<string, number> = {};
  for (const event of game.state.events) {
    eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
  }
  return {
    units: units.length,
    buildings: buildings.length,
    projectiles: game.state.projectiles.length,
    nextEntityId: game.state.nextEntityId,
    nextProjectileId: game.state.nextProjectileId,
    eventSeq: game.state.eventSeq,
    rngState: game.state.rngState,
    victory: game.state.victory,
    unitsLost: game.state.players.map((player) => player.stats.unitsLost),
    kills: game.state.players.map((player) => player.stats.kills),
    eventCounts,
  };
}

/** Harness-only access to the command entry point, as the profiler uses it. */
function issueAttackMove(game: Game, ids: number[], x: number, z: number): void {
  (
    game as unknown as {
      commandMove(owner: number, ids: number[], x: number, z: number, attackMove: boolean): void;
    }
  ).commandMove(0, ids, x, z, true);
}

function groundIdsFor(game: Game, owner: number): number[] {
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

function expectFixtureTicks(game: Game, ticks: Array<{ tick: number; checksum: string }>): void {
  expect(game.state.tick).toBe(ticks[0].tick);
  expect(checksum(game.stateHash())).toBe(ticks[0].checksum);
  for (const expected of ticks.slice(1)) {
    while (game.state.tick < expected.tick) game.tick();
    expect(game.state.tick).toBe(expected.tick);
    expect(checksum(game.stateHash())).toBe(expected.checksum);
  }
}

describe('Phase 2A.8 simulation equivalence', () => {
  it('matches the pre-optimisation 80-unit stress run end to end', () => {
    const game = createCalibrationGame('stress').game;

    expect(checksum(game.stateHash())).toBe(baseline.stress.ticks[0].checksum);
    game.tick();
    expect(checksum(game.stateHash())).toBe(baseline.stress.ticks[1].checksum);
    expect(pathsOf(game)).toEqual(baseline.stress.firstTickPaths);
    expect(summaryOf(game)).toEqual(baseline.stress.firstTickSummary);

    while (game.state.tick < 100) game.tick();
    expect(checksum(game.stateHash())).toBe(
      baseline.stress.ticks[baseline.stress.ticks.length - 1].checksum,
    );
    expect(pathsOf(game)).toEqual(baseline.stress.finalPaths);
    expect(summaryOf(game)).toEqual(baseline.stress.finalSummary);

    // The fixture's intermediate checksums hold for this same run.
    const replay = createCalibrationGame('stress').game;
    expectFixtureTicks(replay, baseline.stress.ticks);
  });

  it('keeps identical state and paths across two independent stress runs', () => {
    const first = createCalibrationGame('stress').game;
    const second = createCalibrationGame('stress').game;
    for (let index = 0; index < 100; index++) {
      first.tick();
      second.tick();
    }
    expect(second.stateHash()).toBe(first.stateHash());
    expect(pathsOf(second)).toEqual(pathsOf(first));
    expect(summaryOf(second)).toEqual(summaryOf(first));
  });

  it('matches the pre-optimisation 16-unit baseline', () => {
    const game = createCalibrationGame('baseline').game;
    expectFixtureTicks(game, baseline.baseline.ticks);
    expect(pathsOf(game)).toEqual([]);
  });

  it.each(baseline.scaling)(
    'matches the pre-optimisation $count-unit path-scaling probe',
    (expected) => {
      const game = createCalibrationGame('stress').game;
      game.pending.length = 0;
      const ids = groundIdsFor(game, 0).slice(0, expected.count);
      issueAttackMove(game, ids, 44 * TILE_SIZE, 44 * TILE_SIZE);

      expect(ids.length).toBe(expected.ordered);
      expect(checksum(game.stateHash())).toBe(expected.checksum);
      expect(summaryOf(game)).toEqual(expected.summary);
      expect(pathsOf(game)).toEqual(expected.paths);
    },
  );

  it('keeps the eight rejected formation slots idle in the 80-unit order', () => {
    const game = createCalibrationGame('stress').game;
    game.tick();
    const units = game.state.entities.filter((entity) => entity.kind === 'unit' && entity.hp > 0);
    expect(units.length).toBe(80);
    expect(units.filter((entity) => entity.order).length).toBe(72);
    expect(units.filter((entity) => !entity.order && entity.state === 'idle').length).toBeGreaterThanOrEqual(8);
  });
});
