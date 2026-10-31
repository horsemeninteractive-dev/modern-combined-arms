/**
 * Admin-only batch calibration for estimating authoritative simulation cost.
 *
 * This does not measure individual tick CPU. It runs a fresh, deterministic
 * Game for a fixed number of real ticks inside one request. The external
 * Cloudflare invocation measurement is paired with the returned tick count,
 * workload counts and checksum. Batch 0 is a setup-only control.
 */

import { createIslandAssault } from '../data/scenarios';
import { TILE_SIZE } from '../sim/constants';
import { Game } from '../sim/game';
import { Terrain } from '../sim/terrain';
import type { Scenario } from '../sim/scenario';

export const CALIBRATION_BATCH_SIZES = [0, 1, 5, 10, 20, 50, 100] as const;
export type CalibrationBatch = (typeof CALIBRATION_BATCH_SIZES)[number];

export const CALIBRATION_PROFILES = ['baseline', 'stress'] as const;
export type CalibrationProfile = (typeof CALIBRATION_PROFILES)[number];

const STRESS_UNITS_PER_SIDE = 32;
const MAX_RUN_ID_LENGTH = 48;

export interface CalibrationCounts {
  entities: number;
  units: number;
  buildings: number;
  projectiles: number;
}

export interface CalibrationActivity {
  shots: number;
  impacts: number;
  explosions: number;
  unitsLost: number;
  kills: number;
}

export interface BatchCalibrationResult {
  version: 1;
  method: 'fresh-game-batch';
  profile: CalibrationProfile;
  runId: string | null;
  requestedTicks: number;
  completedTicks: number;
  initialTick: number;
  finalTick: number;
  initial: CalibrationCounts & { checksum: string };
  final: CalibrationCounts & { checksum: string; stateHashLength: number };
  activity: CalibrationActivity;
  commandsIssued: number;
  commandEntityIds: number;
  rngState: number;
  victory: string;
  workload: {
    scenario: 'island-assault';
    seed: number;
    startingUnits: number;
    addedStressUnits: number;
    totalScenarioUnits: number;
    fog: true;
    ai: false;
  };
  notes: string;
}

export function isCalibrationBatch(value: number): value is CalibrationBatch {
  return (CALIBRATION_BATCH_SIZES as readonly number[]).includes(value);
}

export function isCalibrationProfile(value: string): value is CalibrationProfile {
  return (CALIBRATION_PROFILES as readonly string[]).includes(value);
}

/** FNV-1a 64-bit over the full deterministic state hash; returned as hex. */
function stateChecksum(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function counts(game: Game): CalibrationCounts {
  let units = 0;
  let buildings = 0;
  for (const entity of game.state.entities) {
    if (entity.hp <= 0) continue;
    if (entity.kind === 'unit') units++;
    else buildings++;
  }
  return {
    entities: units + buildings,
    units,
    buildings,
    projectiles: game.state.projectiles.length,
  };
}

function openLand(scenario: Scenario, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= scenario.width || z >= scenario.height) return false;
  const tile = scenario.tiles[z * scenario.width + x];
  return (
    tile.t !== Terrain.DeepWater &&
    tile.t !== Terrain.ShallowWater &&
    tile.t !== Terrain.Rock
  );
}

/**
 * Add a deterministic opposing force in the southern village approach. The
 * region is away from both command posts, so a 100-tick batch cannot end by
 * headquarters destruction. The fixed checkerboard is sparse enough for
 * pathfinding and dense enough to produce real contact, fire and casualties.
 */
function addStressUnits(scenario: Scenario): number {
  const added: number[] = [];
  for (const owner of [0, 1]) {
    const candidates: Array<{ x: number; z: number }> = [];
    const x0 = owner === 0 ? 31 : 41;
    const x1 = owner === 0 ? 39 : 49;
    for (let z = 38; z <= 51; z++) {
      for (let x = x0; x <= x1; x++) {
        if (openLand(scenario, x, z)) candidates.push({ x, z });
      }
    }
    const chosen = candidates.slice(0, STRESS_UNITS_PER_SIDE);
    for (let index = 0; index < chosen.length; index++) {
      const point = chosen[index];
      const defId =
        index % 7 === 0 ? 'spg' : index % 5 === 0 ? 'atgm' : index % 2 === 0 ? 'rifle' : 'tank';
      scenario.units.push({ defId, owner, x: point.x, z: point.z });
      added.push(index);
    }
  }
  return added.length;
}

function issueStressCommands(game: Game): { commands: number; ids: number } {
  let commands = 0;
  let ids = 0;
  for (const team of [0, 1]) {
    const owned = game.state.entities
      .filter((entity) => entity.kind === 'unit' && entity.hp > 0 && entity.owner === team)
      .map((entity) => entity.id);
    if (owned.length === 0) continue;
    game.enqueueCommand({
      type: 'move',
      team,
      ids: owned,
      x: (team === 0 ? 44 : 36) * TILE_SIZE,
      z: 44 * TILE_SIZE,
      attackMove: true,
    });
    commands++;
    ids += owned.length;
  }
  return { commands, ids };
}

function activity(game: Game): CalibrationActivity {
  let shots = 0;
  let impacts = 0;
  let explosions = 0;
  for (const event of game.state.events) {
    if (event.type === 'shot') shots++;
    else if (event.type === 'impact') impacts++;
    else if (event.type === 'explosion') explosions++;
  }
  let unitsLost = 0;
  let kills = 0;
  for (const player of game.state.players) {
    unitsLost += player.stats.unitsLost;
    kills += player.stats.kills;
  }
  return { shots, impacts, explosions, unitsLost, kills };
}

export interface CalibrationGameSetup {
  game: Game;
  addedStressUnits: number;
  startingUnits: number;
  totalScenarioUnits: number;
  seed: number;
  commandsIssued: number;
  commandEntityIds: number;
}

/**
 * Build the exact deterministic state used by a calibration batch without
 * ticking it. Exported only so the focused A/B test can run the same state
 * through a plain tick loop and compare final checksums.
 */
export function createCalibrationGame(profile: CalibrationProfile): CalibrationGameSetup {
  if (!isCalibrationProfile(profile)) throw new Error('Unknown calibration profile.');
  const scenario = createIslandAssault();
  scenario.settings.fog = true;
  scenario.players[0].isAI = false;
  scenario.players[1].isAI = false;
  const addedStressUnits = profile === 'stress' ? addStressUnits(scenario) : 0;

  const game = new Game(scenario, { localPlayerId: -1, enableAI: false });
  // RoomMatch discards this presentation-only opening notice. Keep the
  // calibration state on the same footing as the authoritative room.
  game.state.events = [];
  game.state.eventSeq = 1;
  const issued = profile === 'stress' ? issueStressCommands(game) : { commands: 0, ids: 0 };

  return {
    game,
    addedStressUnits,
    startingUnits: scenario.units.length - addedStressUnits,
    totalScenarioUnits: scenario.units.length,
    seed: scenario.settings.seed,
    commandsIssued: issued.commands,
    commandEntityIds: issued.ids,
  };
}

export function runBatchCalibration(
  profile: CalibrationProfile,
  requestedTicks: CalibrationBatch,
  runId: string | null = null,
): BatchCalibrationResult {
  if (!isCalibrationProfile(profile)) throw new Error('Unknown calibration profile.');
  if (!isCalibrationBatch(requestedTicks)) throw new Error('Unsupported calibration batch size.');
  if (runId !== null && (runId.length === 0 || runId.length > MAX_RUN_ID_LENGTH)) {
    throw new Error('Invalid calibration run id.');
  }

  const setup = createCalibrationGame(profile);
  const { game, addedStressUnits, startingUnits, totalScenarioUnits } = setup;
  const initialTick = game.state.tick;
  const initialCounts = counts(game);
  const initialChecksum = stateChecksum(game.stateHash());

  for (let index = 0; index < requestedTicks; index++) game.tick();

  const finalHash = game.stateHash();
  const finalCounts = counts(game);
  const completedTicks = game.state.tick - initialTick;

  return {
    version: 1,
    method: 'fresh-game-batch',
    profile,
    runId,
    requestedTicks,
    completedTicks,
    initialTick,
    finalTick: game.state.tick,
    initial: { ...initialCounts, checksum: initialChecksum },
    final: {
      ...finalCounts,
      checksum: stateChecksum(finalHash),
      stateHashLength: finalHash.length,
    },
    activity: activity(game),
    commandsIssued: setup.commandsIssued,
    commandEntityIds: setup.commandEntityIds,
    rngState: game.state.rngState,
    victory: game.state.victory,
    workload: {
      scenario: 'island-assault',
      seed: setup.seed,
      startingUnits,
      addedStressUnits,
      totalScenarioUnits,
      fog: true,
      ai: false,
    },
    notes:
      'Real Game ticks, fresh deterministic scenario per invocation. Batch 0 is setup only. Invocation CPU includes setup, routing and response; it is not per-tick CPU.',
  };
}
