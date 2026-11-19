import { BUILDINGS } from '../data/buildings';
import { ALL_UNITS } from '../data/units';
import { TILE_SIZE } from './constants';
import type { ContainerDef, Entity } from './types';

/**
 * A resolved passenger container: the entity plus the rules its definition
 * supplies. Buildings expose `garrison`; units expose `transport`. Both are the
 * same `ContainerDef` contract, so boarding, occupancy, destruction and
 * persistence never branch on a transport id.
 */
export interface ContainerSpec {
  readonly entity: Entity;
  readonly def: ContainerDef;
  /** Mobile containers carry their passengers; static ones stay put. */
  readonly mobile: boolean;
  readonly capacity: number;
}

/**
 * Resolve an entity as a container, or null when it cannot hold passengers.
 *
 * Deliberately ignores hp: a destroyed container still needs its definition
 * when occupants are being killed or ejected, and callers check liveness where
 * it matters (entry, boarding range, unloading).
 */
export function containerSpec(entity: Entity | null | undefined): ContainerSpec | null {
  if (!entity) return null;
  if (entity.kind === 'building') {
    const def = BUILDINGS[entity.defId]?.garrison;
    if (!def) return null;
    return { entity, def, mobile: false, capacity: def.capacity };
  }
  const def = ALL_UNITS[entity.defId]?.transport;
  if (!def) return null;
  return { entity, def, mobile: true, capacity: def.capacity };
}

/** True when the entity is a static or mobile passenger container. */
export function isContainer(entity: Entity | null | undefined): entity is Entity {
  return containerSpec(entity) !== null;
}

/** Mobile containers are moved by their own orders; static ones are shelters. */
export function isMobileContainer(entity: Entity | null | undefined): boolean {
  return containerSpec(entity)?.mobile ?? false;
}

/** Authoritative capacity for a container, or 0 when it is not one. */
export function containerCapacity(entity: Entity | null | undefined): number {
  return containerSpec(entity)?.capacity ?? 0;
}

/** Firing positions a container exposes. Mobile transports default to none. */
export function containerFiringSlots(entity: Entity | null | undefined): number {
  const def = containerSpec(entity)?.def;
  return def?.firingSlots ?? 0;
}

/** Boarding range in world units. Static shelters use their doorway approach. */
export function containerBoardingRange(entity: Entity | null | undefined): number {
  const spec = containerSpec(entity);
  if (!spec || !spec.mobile) return 0;
  return Math.max(0, spec.def.boardingRadius ?? 2) * TILE_SIZE;
}

/**
 * Air transports are the one container that cannot be entered in flight.
 * Fixed-wing hulls never carry a transport definition, so this is effectively
 * a rotary-lift rule without naming a particular helicopter.
 */
export function containerRequiresLanding(entity: Entity | null | undefined): boolean {
  const spec = containerSpec(entity);
  return !!spec?.mobile && ALL_UNITS[entity!.defId]?.domain === 'air';
}

/** A naval transport can only exchange passengers while beached. */
export function containerRequiresBeaching(entity: Entity | null | undefined): boolean {
  const spec = containerSpec(entity);
  return !!spec?.mobile && ALL_UNITS[entity!.defId]?.domain === 'naval';
}

/**
 * Whether a mobile container is in a state where passengers can board or exit.
 * A ground roll still reports `landed`, so the roll itself has to be excluded:
 * nobody walks under a helicopter while it is lifting or settling. A landing
 * craft is the naval equivalent: its hull must be stopped against the shore.
 */
export function containerBoardingReady(entity: Entity | null | undefined): boolean {
  if (!containerRequiresLanding(entity) && !containerRequiresBeaching(entity)) return true;
  if (containerRequiresLanding(entity)) {
    const ac = entity!.aircraft;
    return !!ac && ac.landed && !ac.roll;
  }
  return entity!.navalLanding?.beached === true;
}

/** Destruction policy for occupants. Kill is the default for every container. */
export function containerOnDestroyed(entity: Entity | null | undefined): 'kill' | 'eject' {
  return containerSpec(entity)?.def.onDestroyed ?? 'kill';
}

/**
 * Whether a unit is allowed to board this container.
 *
 * Eligibility is a data rule, not a list of ids: a passenger must be a live,
 * exposed infantry entity. `canGarrison` already marks exactly the infantry
 * platforms that may occupy cover (riflemen, ATGM teams, medics and national
 * infantry teams); engineers, vehicles and aircraft fail it. A future
 * specialised carrier can narrow the rule through `ContainerDef.passenger`.
 */
export function containerAcceptsPassenger(
  container: Entity | null | undefined,
  unit: Entity,
): boolean {
  const spec = containerSpec(container);
  if (!spec || unit.kind !== 'unit' || unit.hp <= 0 || unit.garrisonId) return false;
  const def = ALL_UNITS[unit.defId];
  if (!def || def.armour !== 'infantry' || !def.canGarrison) return false;
  return (spec.def.passenger ?? 'infantry') === 'infantry';
}

/** Whether an embarked passenger may use its own weapons from the container. */
export function containerAllowsPassengerFire(entity: Entity | null | undefined): boolean {
  const spec = containerSpec(entity);
  if (!spec) return false;
  if (!spec.mobile) return (spec.def.firingSlots ?? 0) > 0;
  return spec.def.canFireEmbarked === true && (spec.def.firingSlots ?? 0) > 0;
}
