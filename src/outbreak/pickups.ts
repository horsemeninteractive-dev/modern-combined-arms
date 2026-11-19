/**
 * Horde drops.
 *
 * A killed infected occasionally leaves something worth walking over: a satchel
 * of materials, a radio that yields requisition, a field manual that promotes
 * the crew that picks it up, or a shot of something that makes a squad faster.
 * The point is deliberate risk — a drop is worth leaving the line for, in the
 * middle of a wave, which is exactly when leaving the line is expensive.
 *
 * The rolls are seeded from the match's own stream rather than `Math.random`, so
 * both peers of a co-op run agree on what fell and where. The drops live here
 * rather than in the simulation's entity list: they are not units, they block
 * nothing, and nothing targets them.
 */
import type { Game } from '../sim/game';
import type { Entity } from '../sim/types';
import type { Rng } from '../core/rng';

export type PickupKind = 'mats' | 'req' | 'veterancy' | 'speed';

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  z: number;
  /** Simulation tick the drop appeared; drives the beacon's pulse. */
  tick: number;
}

/** Share of horde deaths that leave a drop. Rare enough to be an event. */
export const PICKUP_DROP_CHANCE = 0.07;
/** How close a friendly unit must come to claim a drop, in world units. */
export const PICKUP_REACH = 4.5;
/** Seconds a drop lies on the field before it is lost. */
export const PICKUP_LIFETIME_SECONDS = 75;
/** Radius the area drops reach, in world units. */
const SPLASH_RADIUS = 12;

/** What each drop is worth. */
export const PICKUP_VALUES = {
  mats: 160,
  req: 60,
  xp: 45,
  /** Seconds of battle speed a dose lasts. */
  speedSeconds: 15,
} as const;

/** The roll table. Weights, not percentages: they are normalised on the roll. */
const PICKUP_TABLE: ReadonlyArray<{ kind: PickupKind; weight: number }> = Object.freeze([
  { kind: 'mats', weight: 46 },
  { kind: 'req', weight: 26 },
  { kind: 'veterancy', weight: 18 },
  { kind: 'speed', weight: 10 },
]);

const PICKUP_NAMES: Readonly<Record<PickupKind, string>> = Object.freeze({
  mats: 'Material crate',
  req: 'Field radio',
  veterancy: 'Field manual',
  speed: 'Stimulant ampoule',
});

const PICKUP_COLORS: Readonly<Record<PickupKind, [number, number, number]>> = Object.freeze({
  mats: [1.0, 0.78, 0.34],
  req: [0.42, 0.78, 1.0],
  veterancy: [0.88, 0.92, 0.55],
  speed: [0.55, 1.0, 0.62],
});

export function pickupName(kind: PickupKind): string {
  return PICKUP_NAMES[kind];
}

export function pickupColor(kind: PickupKind): [number, number, number] {
  return PICKUP_COLORS[kind];
}

/** One roll: whether this death drops something, and what. */
export function rollPickup(
  rng: Rng,
  x: number,
  z: number,
  tick: number,
  id: number,
): Pickup | null {
  if (rng.next() >= PICKUP_DROP_CHANCE) return null;
  const total = PICKUP_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.next() * total;
  let kind: PickupKind = PICKUP_TABLE[0].kind;
  for (const entry of PICKUP_TABLE) {
    roll -= entry.weight;
    if (roll <= 0) {
      kind = entry.kind;
      break;
    }
  }
  return { id, kind, x, z, tick };
}

/**
 * Claim a drop for whichever friendly unit reached it first.
 *
 * Returns the line the HUD should print, or null when nobody is close enough.
 * `infectedOwner` is passed rather than read so this stays a pure function of
 * the match that owns it.
 */
export function collectPickup(
  game: Game,
  pickup: Pickup,
  infectedOwner: number,
): string | null {
  const claimer = nearestDefender(game, pickup.x, pickup.z, PICKUP_REACH, infectedOwner);
  if (!claimer) return null;
  const player = game.player(claimer.owner);
  if (!player) return null;
  const text = claimText(game, pickup, player, infectedOwner);
  if (!text) return null;
  // The line goes through the event bus so it reaches the HUD, the log and the
  // announcer the same way every other in-world message does.
  game.emit('notice', {
    team: game.teamOf(claimer.owner),
    x: pickup.x,
    z: pickup.z,
    text: `${pickupName(pickup.kind)}: ${text}`,
    level: 'success',
    sound: 'ready',
  });
  return text;
}

function claimText(
  game: Game,
  pickup: Pickup,
  player: { mats: number; req: number },
  infectedOwner: number,
): string | null {
  switch (pickup.kind) {
    case 'mats':
      player.mats += PICKUP_VALUES.mats;
      return `+${PICKUP_VALUES.mats} materials recovered`;
    case 'req':
      player.req += PICKUP_VALUES.req;
      return `+${PICKUP_VALUES.req} requisition recovered`;
    case 'veterancy': {
      let trained = 0;
      for (const unit of nearbyDefenders(game, pickup.x, pickup.z, SPLASH_RADIUS, infectedOwner)) {
        unit.xp = (unit.xp ?? 0) + PICKUP_VALUES.xp;
        trained++;
      }
      return trained === 1 ? '1 crew promoted by a field manual' : `${trained} crews promoted by a field manual`;
    }
    case 'speed': {
      let dosed = 0;
      for (const unit of nearbyDefenders(game, pickup.x, pickup.z, SPLASH_RADIUS, infectedOwner)) {
        // The same effect a commander's emergency-power order applies, so the
        // buff reads in the HUD, times out on the simulation clock and survives
        // a pause without a second speed system anywhere in the engine.
        unit.effects = { ...(unit.effects ?? {}), emergencyPower: PICKUP_VALUES.speedSeconds };
        dosed++;
      }
      return dosed === 1 ? '1 unit dosed: battle speed for 15 s' : `${dosed} units dosed: battle speed for 15 s`;
    }
  }
}

function nearestDefender(
  game: Game,
  x: number,
  z: number,
  radius: number,
  infectedOwner: number,
): Entity | null {
  let best: Entity | null = null;
  let bestDistance = radius;
  for (const unit of nearbyDefenders(game, x, z, radius, infectedOwner)) {
    const distance = Math.hypot(unit.x - x, unit.z - z);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = unit;
    }
  }
  return best;
}

function* nearbyDefenders(
  game: Game,
  x: number,
  z: number,
  radius: number,
  infectedOwner: number,
): Generator<Entity> {
  for (const entity of game.state.entities) {
    if (entity.kind !== 'unit' || entity.hp <= 0) continue;
    if (entity.owner === infectedOwner) continue;
    if (entity.garrisonId) continue;
    if (Math.hypot(entity.x - x, entity.z - z) > radius) continue;
    yield entity;
  }
}
