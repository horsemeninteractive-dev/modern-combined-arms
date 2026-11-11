/**
 * Mixed-force engagement harness.
 *
 * `engagementBench` compares one hull type against one hull type. The
 * combined-arms matrix needs sides made of several different hulls at chosen
 * positions — a section of infantry with its carrier against a pair of tanks, a
 * screen standing between an enemy thrust and a battery. This helper places
 * explicit lists on either side and drives them through the real `Game`.
 *
 * Shot attribution is by `event.team`, not by entity id: a static emplacement
 * fires with its own building id, so an id-set join silently drops every
 * structure's shots. That mistake is what made Phase 6B.2 conclude the static
 * SAM never fired.
 *
 * Test-only: nothing in `src/` imports it.
 */
import { Game } from '../src/sim/game';
import { createEmptyScenario, createIslandAssault } from '../src/data/scenarios';
import type { Scenario } from '../src/sim/scenario';
import type { Entity } from '../src/sim/types';
import { openWaterLane } from './engagementBench';

/** A hull to place: a bare id takes the default slot, an object pins it. */
export type Spawn = string | { defId: string; x: number; z: number };

export interface MixedOptions {
  attacker: Spawn[];
  defender: Spawn[];
  /** Gap between the two default groups, in tiles. Ignored for pinned spawns. */
  tiles: number;
  seconds?: number;
  seed?: number;
  map?: 'land' | 'island';
  /** Adds the structures fixed-wing and rotary hulls need to launch. */
  air?: boolean;
  /** Puts every defending submarine under the surface before the first tick. */
  diver?: boolean;
  /** Empties the attacking side's missile racks. */
  attackerAmmo?: number;
  /**
   * Fog of war. Off by default so duel-style fixtures measure weapons rather
   * than optics; a spotting test has to turn it on, because with fog disabled
   * every entity is visible and no weapon ever lacks a sighting.
   */
  fog?: boolean;
  attackerAmmoFor?: { defId: string; ammo: number };
  /** Extra structures, so a fixture can include a static emplacement. */
  attackerStructures?: Array<{ defId: string; x: number; z: number }>;
  defenderStructures?: Array<{ defId: string; x: number; z: number }>;
}

export interface MixedMetrics {
  attacker: string[];
  defender: string[];
  ticks: number;
  seconds: number;
  shots: Record<string, number>;
  defenderShots: Record<string, number>;
  /** Static structures fire with their own id; these are their shots. */
  attackerStructureShots: Record<string, number>;
  defenderStructureShots: Record<string, number>;
  damageDealt: number;
  damageTaken: number;
  attackerStartHp: number;
  defenderStartHp: number;
  attackerHp: number;
  defenderHp: number;
  attackerLost: number;
  defenderLost: number;
  /** Surviving hulls by definition, so the battery can be measured alone. */
  attackerSurvivors: Record<string, number>;
  defenderSurvivors: Record<string, number>;
  destroyed: boolean;
  repulsed: boolean;
}

const idOf = (s: Spawn): string => (typeof s === 'string' ? s : s.defId);

function base(map: 'land' | 'island'): Scenario {
  if (map === 'island') {
    const s = createIslandAssault();
    s.units = [];
    s.structures = [];
    return s;
  }
  return createEmptyScenario(64, 64);
}

export function runMixed(options: MixedOptions): MixedMetrics {
  const seconds = options.seconds ?? 40;
  const map = options.map ?? 'land';
  const scenario = base(map);
  scenario.settings.fog = options.fog ?? false;
  if (options.seed !== undefined) scenario.settings.seed = options.seed;
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 3, z: 3 },
    { defId: 'commandPost', owner: 1, x: 3, z: 59 },
  ];
  for (const s of options.attackerStructures ?? []) {
    scenario.structures.push({ ...s, owner: 0 });
  }
  for (const s of options.defenderStructures ?? []) {
    scenario.structures.push({ ...s, owner: 1 });
  }
  if (options.air) {
    scenario.structures.push(
      { defId: 'airfield', owner: 0, x: 8, z: 30 },
      { defId: 'heliport', owner: 0, x: 8, z: 40 },
      { defId: 'airfield', owner: 1, x: 54, z: 30 },
      { defId: 'heliport', owner: 1, x: 54, z: 40 },
    );
  }

  let ax = 20;
  let az = 30;
  let dx = 20 + options.tiles;
  let dz = 30;
  if (map === 'island') {
    const lane = openWaterLane(scenario, Math.max(Math.ceil(options.tiles), 6));
    if (!lane) throw new Error('island fixture has no open water lane');
    ax = lane.x0;
    az = lane.z0;
    dx = lane.x1;
    dz = lane.z1;
  }

  options.attacker.forEach((spawn, index) => {
    const pinned = typeof spawn === 'string' ? null : spawn;
    scenario.units.push({
      defId: idOf(spawn),
      owner: 0,
      x: pinned ? pinned.x : ax,
      z: pinned ? pinned.z : az + (index % 3) * 0.7,
    });
  });
  options.defender.forEach((spawn, index) => {
    const pinned = typeof spawn === 'string' ? null : spawn;
    scenario.units.push({
      defId: idOf(spawn),
      owner: 1,
      x: pinned ? pinned.x : dx,
      z: pinned ? pinned.z : dz + (index % 3) * 0.7,
    });
  });

  const game = new Game(scenario, { enableAI: false });
  const attackers = game.entitiesOf(0, 'unit');
  const defenders = game.entitiesOf(1, 'unit');
  const attackerStartHp = attackers.reduce((n, e) => n + e.maxHp, 0);
  const defenderStartHp = defenders.reduce((n, e) => n + e.maxHp, 0);
  const attackerIds = new Set(attackers.map((e) => e.id));
  const defenderIds = new Set(defenders.map((e) => e.id));
  const structures = new Set(
    game.state.entities.filter((e) => e.kind === 'building').map((e) => e.id),
  );

  for (const unit of attackers) {
    if (options.attackerAmmo !== undefined) {
      unit.ammo = options.attackerAmmo;
      unit.maxAmmo = Math.max(unit.maxAmmo, options.attackerAmmo);
    }
    if (options.attackerAmmoFor && unit.defId === options.attackerAmmoFor.defId) {
      unit.ammo = options.attackerAmmoFor.ammo;
      unit.maxAmmo = Math.max(unit.maxAmmo, options.attackerAmmoFor.ammo);
    }
  }
  for (const unit of defenders) {
    if (options.diver && unit.submarine) unit.submarine.dived = true;
  }
  // A structure-only defence is a legal fixture: a lone emplacement answering a
  // raid is exactly the case a static-defence measurement needs.
  if (defenders.length === 0 && (options.defenderStructures?.length ?? 0) === 0) {
    throw new Error('no defenders placed');
  }
  // A structure-only defence has no unit to name, so the raid is pointed at the
  // emplacement itself; automatic engagement would find it anyway, but an
  // explicit order is what the mixed benchmark is comparing.
  const targetId =
    defenders[0]?.id ??
    game.state.entities.find((e) => e.kind === 'building' && e.owner === 1)?.id;
  if (targetId !== undefined) {
    game.enqueueCommand({
      type: 'attack',
      team: 0,
      ids: attackers.map((e) => e.id),
      targetId,
    });
  }

  const shots: Record<string, number> = {};
  const defenderShots: Record<string, number> = {};
  const attackerStructureShots: Record<string, number> = {};
  const defenderStructureShots: Record<string, number> = {};
  let lastSeq = 0;
  const start = game.state.tick;
  for (let i = 0; i < 20 * seconds; i++) {
    game.tick();
    for (const event of game.state.events) {
      if (event.seq <= lastSeq) continue;
      lastSeq = event.seq;
      if (event.type !== 'shot') continue;
      const weaponId = (event as { weaponId?: string }).weaponId;
      const shooter = event.entityId;
      const team = event.team;
      if (!weaponId || shooter === undefined || (team !== 0 && team !== 1)) continue;
      const fromStructure = structures.has(shooter);
      const into =
        team === 0
          ? fromStructure
            ? attackerStructureShots
            : shots
          : fromStructure
            ? defenderStructureShots
            : defenderShots;
      into[weaponId] = (into[weaponId] ?? 0) + 1;
    }
    const aliveA = attackers.filter((e) => (game.getEntity(e.id)?.hp ?? 0) > 0);
    const aliveD = defenders.filter((e) => (game.getEntity(e.id)?.hp ?? 0) > 0);
    if (aliveA.length === 0 || aliveD.length === 0) break;
  }

  const liveHp = (ids: Set<number>): number =>
    [...ids].reduce((n, id) => n + Math.max(0, game.getEntity(id)?.hp ?? 0), 0);
  const attackerHp = liveHp(attackerIds);
  const defenderHp = liveHp(defenderIds);
  const survivors = (list: Entity[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const e of list) {
      if ((game.getEntity(e.id)?.hp ?? 0) <= 0) continue;
      out[e.defId] = (out[e.defId] ?? 0) + 1;
    }
    return out;
  };

  return {
    attacker: options.attacker.map(idOf),
    defender: options.defender.map(idOf),
    ticks: game.state.tick - start,
    seconds: Math.round((game.state.tick - start) / 20),
    shots,
    defenderShots,
    attackerStructureShots,
    defenderStructureShots,
    damageDealt: Math.round((defenderStartHp - defenderHp) * 10) / 10,
    damageTaken: Math.round((attackerStartHp - attackerHp) * 10) / 10,
    attackerStartHp,
    defenderStartHp,
    attackerHp: Math.round(attackerHp * 10) / 10,
    defenderHp: Math.round(defenderHp * 10) / 10,
    attackerLost: attackers.filter((e) => (game.getEntity(e.id)?.hp ?? 0) <= 0).length,
    defenderLost: defenders.filter((e) => (game.getEntity(e.id)?.hp ?? 0) <= 0).length,
    attackerSurvivors: survivors(attackers),
    defenderSurvivors: survivors(defenders),
    destroyed: defenderHp <= 0,
    repulsed: attackerHp <= 0,
  };
}
