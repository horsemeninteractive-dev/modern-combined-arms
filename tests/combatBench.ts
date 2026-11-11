/**
 * Deterministic combat benchmark.
 *
 * A duel is one attacker and one defender on an empty map, with the attacker
 * ordered onto the defender. Everything else in the simulation runs exactly as
 * it does in a match — terrain, light, weather, crew veterancy, armour, ammo —
 * so these numbers are measured behaviour, not a second damage model written
 * for the tests.
 *
 * This is a test utility: nothing in `src/` imports it, and no telemetry is
 * added to the game for it.
 */
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { UNITS } from '../src/data/units';

export interface DuelOptions {
  /** Distance between the two units, in tiles. */
  tiles: number;
  /** Simulated seconds; the duel stops early once the defender dies. */
  seconds?: number;
  /** Seed for the existing simulation randomness. */
  seed?: number;
  /** Override the attacker's ammunition (for exhaustion tests). */
  ammo?: number;
  /** Extra metres of separation along Z, to break a straight-line geometry. */
  zOffset?: number;
}

export interface DuelMetrics {
  attacker: string;
  defender: string;
  distanceTiles: number;
  ticks: number;
  /** Every distinct weapon the attacker fired, in order. */
  weaponsUsed: string[];
  shots: number;
  firstShotSeconds: number | null;
  damageDealt: number;
  attackerDamageTaken: number;
  defenderHp: number;
  defenderMaxHp: number;
  attackerHp: number;
  destroyed: boolean;
  secondsToKill: number | null;
}

export function runDuel(attackerId: string, defenderId: string, options: DuelOptions): DuelMetrics {
  const seconds = options.seconds ?? 20;
  const scenario = createEmptyScenario(64, 64);
  scenario.settings.fog = false;
  if (options.seed !== undefined) scenario.settings.seed = options.seed;
  // Both seats hold a command post in opposite corners. A side with no
  // structures is defeated at the first tick, and the clock stops advancing,
  // so a bare map would silently measure nothing at all.
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 4, z: 4 },
    { defId: 'commandPost', owner: 1, x: 59, z: 59 },
  ];
  scenario.units = [
    { defId: attackerId, owner: 0, x: 20, z: 30 },
    { defId: defenderId, owner: 1, x: 20 + options.tiles, z: 30 + (options.zOffset ?? 0) },
  ];
  // Air and naval hulls need their own terrain; an empty map is all land, so a
  // caller that wants a naval duel passes the map in through `scenario`-aware
  // helpers below instead. Land and rotary aircraft work here.
  const game = new Game(scenario, { enableAI: false });
  const attacker = game.state.entities.find(
    (e) => e.kind === 'unit' && e.owner === 0 && e.defId === attackerId,
  )!;
  const defender = game.state.entities.find(
    (e) => e.kind === 'unit' && e.owner === 1 && e.defId === defenderId,
  )!;
  if (options.ammo !== undefined) {
    attacker.ammo = options.ammo;
    attacker.maxAmmo = Math.max(attacker.maxAmmo, options.ammo);
  }
  const defenderMaxHp = defender.maxHp;
  const attackerMaxHp = attacker.maxHp;
  game.enqueueCommand({ type: 'attack', team: 0, ids: [attacker.id], targetId: defender.id });

  const weaponsUsed: string[] = [];
  let shots = 0;
  let firstShotTick: number | null = null;
  const start = game.state.tick;
  // A fixed number of ticks, never a loop on the clock: a battle whose clock
  // stops (victory decided, no simulation step) must end the duel, not hang it.
  const limit = 20 * seconds;
  for (let i = 0; i < limit; i++) {
    // The event log persists, so only events appended by this tick are new.
    const from = game.state.events.length;
    game.tick();
    for (let index = from; index < game.state.events.length; index++) {
      const event = game.state.events[index];
      if (event.type !== 'shot' || event.entityId !== attacker.id) continue;
      const weaponId = (event as { weaponId?: string }).weaponId;
      if (!weaponId) continue;
      shots++;
      if (firstShotTick === null) firstShotTick = game.state.tick - start;
      if (weaponsUsed[weaponsUsed.length - 1] !== weaponId) weaponsUsed.push(weaponId);
    }
    if (defender.hp <= 0 || !game.getEntity(defender.id)) break;
  }
  const stillAlive = game.getEntity(defender.id);
  const killed = !stillAlive || stillAlive.hp <= 0;
  return {
    attacker: attackerId,
    defender: defenderId,
    distanceTiles: options.tiles,
    ticks: game.state.tick - start,
    weaponsUsed,
    shots,
    firstShotSeconds: firstShotTick === null ? null : firstShotTick / 20,
    damageDealt: Math.round((defenderMaxHp - Math.max(0, stillAlive?.hp ?? 0)) * 10) / 10,
    attackerDamageTaken: Math.round((attackerMaxHp - Math.max(0, attacker.hp)) * 10) / 10,
    defenderHp: Math.round(Math.max(0, stillAlive?.hp ?? 0) * 10) / 10,
    defenderMaxHp,
    attackerHp: Math.round(Math.max(0, attacker.hp) * 10) / 10,
    destroyed: killed,
    secondsToKill: killed && firstShotTick !== null ? (game.state.tick - start) / 20 : null,
  };
}

/** Every registered definition that carries more than one weapon. */
export function multiWeaponUnits(): string[] {
  return Object.values(UNITS)
    .filter((def) => (def.weapons?.length ?? 0) > 1)
    .map((def) => def.id)
    .sort();
}
