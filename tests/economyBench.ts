/**
 * Economic and infrastructure benchmark.
 *
 * Everything here drives the authoritative `Game`: real placement, real
 * engineers, real production queues, real power grid. Nothing re-implements a
 * cost, a duration or an income rate, so a test that reads these numbers cannot
 * drift from the simulation the player actually gets.
 */
import { Game } from '../src/sim/game';
import type { Entity } from '../src/sim/types';

export interface Site {
  x: number;
  z: number;
}

/** The simulation clock is 20 ticks per second; `advance` counts ticks. */
export const TICKS_PER_SECOND = 20;

/** Advance the authoritative simulation by a number of seconds. */
export function advanceSeconds(game: Game, seconds: number): void {
  game.advance(Math.max(1, Math.round(seconds * TICKS_PER_SECOND)));
}

export interface Placed {
  structure: Entity;
  /** Seconds from the order being accepted to the structure finishing. */
  seconds: number;
  site: Site;
}

/**
 * First legal site for a structure, skipping ground already used by this
 * fixture. Placement rules are the simulation's own, not a guessed rectangle.
 */
export function siteFor(
  game: Game,
  owner: number,
  defId: string,
  avoid: readonly Site[] = [],
): Site {
  for (let z = 8; z <= 52; z++) {
    for (let x = 8; x <= 52; x++) {
      if (avoid.some((s) => Math.abs(s.x - x) < 5 && Math.abs(s.z - z) < 5)) continue;
      if (game.placementStatus(owner, defId, x, z).ok) return { x, z };
    }
  }
  throw new Error(`no legal site for ${defId}`);
}

function engineerOf(game: Game, owner: number): Entity | undefined {
  return game.entitiesOf(owner, 'unit').find((e) => e.defId === 'engineer');
}

/**
 * Order a structure and time it to completion with one engineer already
 * standing on the site, so the measurement is build time rather than a walk.
 */
export function buildStructure(
  game: Game,
  owner: number,
  defId: string,
  options: { site?: Site; maxSeconds?: number } = {},
): Placed {
  const site = options.site ?? siteFor(game, owner, defId);
  game.enqueueCommand({
    type: 'placeBuilding',
    team: owner,
    defId,
    tileX: site.x,
    tileZ: site.z,
  });
  // The order is queued; the site exists after the next tick.
  game.tick();
  const structure = game
    .entitiesOf(owner, 'building')
    .find((e) => e.defId === defId && e.construction);
  if (!structure) throw new Error(`${defId} was not accepted at ${site.x},${site.z}`);
  // Adjacent, and assigned on the next tick because it is idle.
  const engineer = engineerOf(game, owner);
  if (engineer) {
    engineer.x = site.x * 4;
    engineer.z = site.z * 4;
  }
  const limit = options.maxSeconds ?? 240;
  let seconds = 0;
  while (structure.construction && seconds < limit) {
    advanceSeconds(game, 0.5);
    seconds += 0.5;
  }
  return { structure, seconds: Math.round(seconds * 100) / 100, site };
}

/** Give the side a bank so a throughput measurement is not gated by income. */
export function fund(game: Game, owner = 0, mats = 40000, req = 4000): void {
  const player = game.player(owner);
  if (!player) throw new Error(`no player ${owner}`);
  player.mats = mats;
  player.req = req;
}

export interface Throughput {
  produced: number;
  seconds: number;
  /** Units completed per minute. */
  perMinute: number;
}

/**
 * Produce `count` units from one structure as fast as the queue allows, and
 * report how long it took. Units already standing are excluded.
 */
export function produceUnits(
  game: Game,
  owner: number,
  buildingId: number,
  defId: string,
  count: number,
  maxSeconds = 400,
): Throughput {
  const standing = (): number =>
    game.entitiesOf(owner, 'unit').filter((e) => e.defId === defId).length;
  const before = standing();
  let queued = 0;
  let seconds = 0;
  while (standing() - before < count && seconds < maxSeconds) {
    if (queued < count && game.productionStatus(owner, buildingId, defId).ok) {
      game.enqueueCommand({ type: 'produce', team: owner, buildingId, defId });
      queued++;
    }
    advanceSeconds(game, 1);
    seconds += 1;
  }
  const produced = standing() - before;
  return {
    produced,
    seconds,
    perMinute: seconds > 0 ? Math.round((produced / seconds) * 60 * 100) / 100 : 0,
  };
}

export interface Snapshot {
  seconds: number;
  mats: number;
  req: number;
  buildings: number;
  units: number;
  armyValue: number;
  supply: number;
  demand: number;
  brownout: boolean;
  byDef: Record<string, number>;
}

/** One sample of a side's economic state, for milestone and pacing tables. */
export function snapshot(game: Game, owner: number, seconds: number): Snapshot {
  const player = game.player(owner);
  const power = game.powerStatus(owner);
  const byDef: Record<string, number> = {};
  let armyValue = 0;
  let buildings = 0;
  let units = 0;
  for (const e of game.state.entities) {
    if (e.owner !== owner || e.hp <= 0) continue;
    byDef[e.defId] = (byDef[e.defId] ?? 0) + 1;
    if (e.kind === 'building') buildings++;
    else {
      units++;
      armyValue += armyCost(e.defId);
    }
  }
  return {
    seconds,
    mats: Math.round(player?.mats ?? 0),
    req: Math.round(player?.req ?? 0),
    buildings,
    units,
    armyValue,
    supply: power.supply,
    demand: power.demand,
    brownout: power.brownout,
    byDef,
  };
}

/** Cached lookup so a snapshot does not import the whole unit table per call. */
import { UNITS } from '../src/data/units';
function armyCost(defId: string): number {
  return UNITS[defId]?.cost.mats ?? 0;
}

/**
 * Bank the difference in a resource over an interval. Uses the player's own
 * balance, so passive income, spending by the AI and refunds all land in the
 * number the player would see.
 */
export function incomeOver(game: Game, owner: number, seconds: number): {
  mats: number;
  req: number;
} {
  const player = game.player(owner);
  const mats0 = player?.mats ?? 0;
  const req0 = player?.req ?? 0;
  advanceSeconds(game, seconds);
  return {
    mats: Math.round(((player?.mats ?? 0) - mats0) * 10) / 10,
    req: Math.round(((player?.req ?? 0) - req0) * 10) / 10,
  };
}
