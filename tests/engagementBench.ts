/**
 * Mixed-force, naval and air engagements for the balance benchmark.
 *
 * The duel in `combatBench.ts` answers "what does this hull do to that one".
 * These helpers answer the next question: what happens when the compositions a
 * real battle produces meet — a section of infantry with its IFVs against a
 * pair of tanks, a frigate against a dived boat, a gunship against a mobile
 * launcher. Everything runs through the real `Game`, so acquisition, terrain,
 * fuel, ammunition, armour and suppression are the match's own.
 *
 * Test-only, like the duel harness.
 */
import { Game } from '../src/sim/game';
import { createEmptyScenario, createIslandAssault } from '../src/data/scenarios';
import { Terrain } from '../src/sim/terrain';
import { TILE_SIZE } from '../src/sim/constants';
import type { Scenario } from '../src/sim/scenario';

export type MapKind = 'land' | 'island';

export interface SideSpec {
  defId: string;
  count?: number;
  /** Overrides the ammunition of every hull on this side. */
  ammo?: number;
}

export interface EngagementOptions {
  attacker: SideSpec;
  defender: SideSpec;
  /** Gap between the two groups, in tiles. */
  tiles: number;
  seconds?: number;
  seed?: number;
  map?: MapKind;
  /** Puts a defending submarine under the surface before the first tick. */
  diver?: boolean;
  /** Adds the structures the hull needs to launch (airfield, heliport). */
  air?: boolean;
}

export interface EngagementMetrics {
  attacker: string;
  defender: string;
  attackerCount: number;
  defenderCount: number;
  ticks: number;
  seconds: number;
  /** Every weapon fired by the attacking side, with its shot count. */
  shots: Record<string, number>;
  defenderShots: Record<string, number>;
  damageDealt: number;
  damageTaken: number;
  attackerHp: number;
  defenderHp: number;
  attackerStartHp: number;
  defenderStartHp: number;
  attackerLost: number;
  defenderLost: number;
  /** True once every defending hull is gone. */
  destroyed: boolean;
  secondsToKill: number | null;
  /** True once every attacking hull is gone. */
  repulsed: boolean;
}

const isNavigable = (tile: number): boolean =>
  tile === Terrain.DeepWater || tile === Terrain.ShallowWater;

/**
 * The first straight run of open water at least `tiles` long.
 *
 * A naval duel needs a lane, not two points: a hull spawned on a tile with land
 * between it and its opponent measures pathfinding, not gunnery. The scan is
 * row-major and deterministic, so the same fixture is used on every run.
 */
export function openWaterLane(
  scenario: Scenario,
  tiles: number,
): { x0: number; z0: number; x1: number; z1: number } | null {
  const width = scenario.width;
  for (let z = 2; z < scenario.height - 2; z++) {
    for (let x = 2; x + tiles < scenario.width - 2; x++) {
      let clear = true;
      for (let i = 0; i <= tiles; i++) {
        if (!isNavigable(scenario.tiles[z * width + x + i].t)) {
          clear = false;
          break;
        }
      }
      if (clear) return { x0: x, z0: z, x1: x + tiles, z1: z };
    }
  }
  return null;
}

function baseScenario(map: MapKind): Scenario {
  if (map === 'island') {
    const scenario = createIslandAssault();
    scenario.units = [];
    scenario.structures = [];
    return scenario;
  }
  return createEmptyScenario(64, 64);
}

export function runEngagement(options: EngagementOptions): EngagementMetrics {
  const seconds = options.seconds ?? 60;
  const map = options.map ?? 'land';
  const scenario = baseScenario(map);
  scenario.settings.fog = false;
  if (options.seed !== undefined) scenario.settings.seed = options.seed;
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 3, z: 3 },
    { defId: 'commandPost', owner: 1, x: 3, z: 59 },
  ];
  if (options.air) {
    scenario.structures.push(
      { defId: 'airfield', owner: 0, x: 8, z: 30 },
      { defId: 'heliport', owner: 0, x: 8, z: 40 },
      { defId: 'airfield', owner: 1, x: 54, z: 30 },
    );
  }

  const attackerCount = options.attacker.count ?? 1;
  const defenderCount = options.defender.count ?? 1;

  let ax0 = 20;
  let az0 = 30;
  let dx0 = 20 + options.tiles;
  let dz0 = 30;
  if (map === 'island') {
    const lane = openWaterLane(scenario, Math.max(options.tiles, 4));
    if (!lane) throw new Error('island fixture has no open water lane for this engagement');
    ax0 = lane.x0;
    az0 = lane.z0;
    dx0 = lane.x1;
    dz0 = lane.z1;
  }

  const placed = (defId: string, owner: number, x: number, z: number) => {
    scenario.units.push({ defId, owner, x, z });
  };
  for (let i = 0; i < attackerCount; i++) {
    placed(options.attacker.defId, 0, ax0, az0 + (i % 2) * 0.5);
  }
  for (let i = 0; i < defenderCount; i++) {
    placed(options.defender.defId, 1, dx0, dz0 + (i % 2) * 0.5);
  }

  const game = new Game(scenario, { enableAI: false });
  const attackers = game
    .entitiesOf(0, 'unit')
    .filter((e) => e.defId === options.attacker.defId)
    .slice(0, attackerCount);
  const defenders = game
    .entitiesOf(1, 'unit')
    .filter((e) => e.defId === options.defender.defId)
    .slice(0, defenderCount);
  if (attackers.length === 0 || defenders.length === 0) {
    throw new Error(`could not place ${options.attacker.defId} vs ${options.defender.defId}`);
  }
  const attackerStartHp = attackers.reduce((n, e) => n + e.maxHp, 0);
  const defenderStartHp = defenders.reduce((n, e) => n + e.maxHp, 0);
  for (const unit of attackers) {
    if (options.attacker.ammo !== undefined) {
      unit.ammo = options.attacker.ammo;
      unit.maxAmmo = Math.max(unit.maxAmmo, options.attacker.ammo);
    }
  }
  for (const unit of defenders) {
    if (options.defender.ammo !== undefined) {
      unit.ammo = options.defender.ammo;
      unit.maxAmmo = Math.max(unit.maxAmmo, options.defender.ammo);
    }
    if (options.diver && unit.submarine) unit.submarine.dived = true;
  }
  const primary = defenders[0];
  game.enqueueCommand({
    type: 'attack',
    team: 0,
    ids: attackers.map((e) => e.id),
    targetId: primary.id,
  });

  const shots: Record<string, number> = {};
  const defenderShots: Record<string, number> = {};
  const attackerIds = new Set(attackers.map((e) => e.id));
  const defenderIds = new Set(defenders.map((e) => e.id));
  const start = game.state.tick;
  let firstShotTick: number | null = null;
  let lastSeq = 0;
  const limit = 20 * seconds;
  for (let i = 0; i < limit; i++) {
    game.tick();
    for (const event of game.state.events) {
      if (event.seq <= lastSeq) continue;
      lastSeq = event.seq;
      if (event.type !== 'shot') continue;
      const weaponId = (event as { weaponId?: string }).weaponId;
      const shooter = event.entityId;
      if (!weaponId || shooter === undefined) continue;
      if (attackerIds.has(shooter)) {
        shots[weaponId] = (shots[weaponId] ?? 0) + 1;
        if (firstShotTick === null) firstShotTick = game.state.tick - start;
      } else if (defenderIds.has(shooter)) {
        defenderShots[weaponId] = (defenderShots[weaponId] ?? 0) + 1;
      }
    }
    const defendersAlive = defenders.filter((e) => (game.getEntity(e.id)?.hp ?? 0) > 0);
    const attackersAlive = attackers.filter((e) => (game.getEntity(e.id)?.hp ?? 0) > 0);
    if (defendersAlive.length === 0 || attackersAlive.length === 0) break;
  }

  const liveHp = (ids: Set<number>): number =>
    [...ids].reduce((n, id) => n + Math.max(0, game.getEntity(id)?.hp ?? 0), 0);
  const attackerHp = liveHp(attackerIds);
  const defenderHp = liveHp(defenderIds);
  const destroyed = defenderHp <= 0;
  const repulsed = attackerHp <= 0;

  return {
    attacker: options.attacker.defId,
    defender: options.defender.defId,
    attackerCount,
    defenderCount,
    ticks: game.state.tick - start,
    seconds: Math.round((game.state.tick - start) / 20),
    shots,
    defenderShots,
    damageDealt: Math.round((defenderStartHp - defenderHp) * 10) / 10,
    damageTaken: Math.round((attackerStartHp - attackerHp) * 10) / 10,
    attackerHp: Math.round(attackerHp * 10) / 10,
    defenderHp: Math.round(defenderHp * 10) / 10,
    attackerStartHp,
    defenderStartHp,
    attackerLost: attackers.filter((e) => (game.getEntity(e.id)?.hp ?? 0) <= 0).length,
    defenderLost: defenders.filter((e) => (game.getEntity(e.id)?.hp ?? 0) <= 0).length,
    destroyed,
    secondsToKill: destroyed && firstShotTick !== null ? (game.state.tick - start) / 20 : null,
    repulsed,
  };
}

/** World-unit spacing helper used by callers that need a tile gap. */
export const tiles = (n: number): number => n * TILE_SIZE;
