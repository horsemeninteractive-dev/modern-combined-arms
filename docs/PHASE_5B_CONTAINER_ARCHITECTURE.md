# Phase 5B — Shared Garrison & Passenger Container Architecture

Status: implemented in Phase 5B. Phase 5C ships `apc` as the first land mobile
consumer and Phase 5D ships `transportHelo` as the first air consumer. No
transport building or landing craft ships. The building garrison system remains
the static consumer of the same contract.

## 1. Why the garrison system was already the right base

The pre-5B simulation recorded occupancy **once**, on the passenger:

```ts
entity.garrisonId // 0 when exposed, otherwise the container entity id
```

Everything else was derived. `garrisonOccupants(buildingId)` scanned the entity
list for live infantry with that id. Because that reference was the only source
of truth, the rest of the simulation already treated an occupant as not present
on the battlefield:

- `updateUnits` skips embarked entities, so they take no independent orders,
  movement, combat or support actions.
- Collision, exit-clearance, auto-targeting, projectile impact, vision
  acquisition and selection all skip `garrisonId`.
- Save/load serialises the field wholesale; no second roster exists to drift.
- The multiplayer projection redacts `garrisonId` unless the container is known
  to the recipient.

Phase 5B generalises the container side of that relationship. It does not
introduce a parallel cargo system, a squad entity, a seat map or a second
movement simulation.

## 2. The shared contract

`src/sim/types.ts`:

```ts
interface ContainerDef {
  capacity: number;
  protection?: number;      // static shelters
  exposure?: number;        // static shelters
  firingSlots?: number;     // 0 means passengers never fire
  mobile?: boolean;
  boardingRadius?: number;  // tiles, mobile containers
  canFireEmbarked?: boolean;
  passenger?: 'infantry';   // data-driven passenger class
  onDestroyed?: 'kill' | 'eject';
}

interface GarrisonDef extends ContainerDef { /* static; fields required */ }
interface TransportDef extends ContainerDef { /* mobile: true; boardingRadius; onDestroyed */ }
```

`UnitDef.transport?: TransportDef` is the only new unit field. Phase 5C's
`apc` and Phase 5D's `transportHelo` set it; all other shipped units leave it
absent.
`BuildingDef.garrison?: GarrisonDef` is unchanged in shape and data.

`src/sim/containers.ts` resolves either definition through one function:

```ts
containerSpec(entity) // { entity, def, mobile, capacity } | null
```

Helpers read capacity, boarding range, firing slots, passenger-fire permission
and destruction policy. No core branch names an APC, helicopter or landing
craft id; a future transport only supplies data.

## 3. Occupancy representation

`garrisonId` remains the single authoritative reference. The passenger roster
is always derived by scanning and sorted by entity id, so a seat is the index in
that list rather than stored state.

Guarantees enforced by the entry transaction:

- one container per passenger (`unit.garrisonId` is scalar);
- a passenger is either embarked or exposed, never both;
- capacity is re-read from the derived roster on every attempt;
- commands are processed in id order, so simultaneous boarding is
  deterministic and the lowest ids win contested seats;
- a destroyed, missing or enemy-owned container is rejected; a same-team
  player's mobile transport is valid;
- no duplicate entry is possible because an embarked unit is filtered out
  before the command is built.

## 4. Boarding

The existing `garrison` command is the boarding order. There is no second order
pipeline:

- **Static shelter:** unchanged. Infantry path to a doorway, the wall-clearance
  check completes entry, and the shelter's protection, firing slots and
  collapse rules apply.
- **Mobile carrier:** infantry already inside `boardingRadius` (tiles, converted
  to world units) enter immediately; otherwise they path to the carrier and
  `updateGarrisonOrder` re-plans when the route runs out. A carrier that drives
  on is followed rather than abandoned at its old position.

`enterContainer` performs eligibility, ownership, hostile-occupant, damage,
capacity and duplicate checks, then writes `garrisonId` and parks the passenger
on the container in one synchronous step. Eligibility is data-driven through
`containerAcceptsPassenger`: a live exposed infantry entity whose definition has
`canGarrison`, matching the container's `passenger` class. Phase 5C and 5D use
this to accept riflemen, ATGM teams, medics and eligible national infantry while
rejecting vehicles, engineers and other transports.

## 5. Embarked behaviour

`updateGarrisons` now iterates every resolved container, not just buildings:

- passengers are pinned to the container's position each tick, so a mobile
  carrier's passengers move with it without a passenger movement simulation;
- they remain `garrisoned`, with cooldown and suppression decay;
- static shelters keep their existing firing-slot rotation;
- mobile carriers expose no firing slots, and `canFireEmbarked` defaults false,
  so passengers do not fire from a transport;
- a mobile passenger contributes no independent vision. The carrier's optics
  are the only eyes it adds. Static garrisons keep their previous sight lines.

They remain non-selectable, non-targetable, absent from collision and spatial
queries, and are never rendered as independent battlefield entities.

## 6. Unloading

The existing `ungarrison` command is the unload order. `exitContainer`:

1. collects the requesting owner's passengers, or every passenger when the
   mobile carrier's owner requests the unload;
2. plans a distinct safe spot for each before moving anybody;
3. scans the building footprint ring, or a one-tile ring around a mobile hull;
4. rejects blocked tiles, deep water, occupied spots and off-map positions;
5. returns everyone or changes nothing.

A failed plan leaves the passengers embarked and emits `No safe exit`, exactly
as the building system always did. Unloading is therefore safe on any terrain a
foot unit can stand on, without implementing swimming or beach landing. Phase 5C
stops a moving mobile carrier before planning the exit ring, so passengers are
never placed at a stale waypoint. Phase 5D lands an air transport first and then
passes a null owner, releasing every passenger aboard under the carrier owner's
UNLOAD ALL order.

## 7. Destruction

`destroyContainer` applies the container's `onDestroyed` policy once:

- `kill` (default, and the only policy any shipped definition uses) destroys
  every remaining passenger, clears its reference, records one loss per
  passenger and emits one notice per owner;
- `eject` is reserved for a container that opts in and reuses the normal safe
  disembark ring; if any owner cannot be placed, the remaining occupants are
  killed rather than orphaned.

A destroyed carrier is processed by the same cleanup pass as a destroyed
shelter. Occupants are zeroed before removal, so the roster is empty on the
next scan and the loss cannot be counted twice.

## 8. Persistence

No save-schema change and no version bump. `garrisonId` was already serialised
and migrated (`saveMigrations.ts`). On load, `reconcileContainers()` runs once,
before the first vision refresh:

- missing, dead or wrong-owner containers clear only the passenger's reference;
- an illegally over-full container keeps the lowest passenger ids first;
- every legal relationship is restored unchanged, including entity ids,
  health, veterancy, upgrades and position.

Existing saves containing only building garrisons load with identical gameplay.

## 9. Multiplayer authority and privacy

The command gate validates the resolved container, not a client claim:

- `garrison` accepts a named building with a garrison or an owned mobile
  carrier; it checks exposed infantry, knowledge, ownership, hostile occupants,
  damage and capacity before enqueueing;
- `ungarrison` accepts an occupied building or transport with a passenger owned
  by the seat; a mobile carrier's owner may unload every passenger aboard, while
  an air transport accepts only its owner's unload order;
- clients never send seat, cargo or passenger ownership, and forged `team`
  fields are rejected as unknown fields.

The server remains authoritative: commands are enqueued, then `enterContainer` /
`exitContainer` re-validate against live state.

Projection: an embarked passenger is never shipped to the opposing team, even
when a coarse visibility test matches the carrier's tile. The owner still
receives the passenger entity and its `garrisonId`. Reconnect uses the same
projection, so hidden passenger identities cannot leak through a resync.

## 10. UI and AI hooks

- HUD and command availability keep using `garrisonOccupants`, now an alias of
  `containerOccupants`. Phase 5C adds a compact `PASSENGERS n/4` line and an
  `UNLOAD ALL` button for a selected APC; Phase 5D adds the landed/airborne state
  and the same control for the transport helicopter. There is no separate
  transport panel.
- `Game.containerOccupants`, `containerOf` and `containerCapacity` are public
  simulation-level hooks for future AI tasking.
- The existing AI garrison behaviour is unchanged and still issues the same
  `garrison` / `ungarrison` commands. No APC or transport-helicopter demand is
  registered, so the AI does not buy or misuse one before Phase 5F.
- Full transport AI, boarding reservations for AI groups and unload planning
  belong to Phase 5F.

## 11. What remains building-specific, and why

| Behaviour | Why it stays on buildings |
| --- | --- |
| Doorway approach (`findGarrisonApproach`, wall clearance) | A shelter has a footprint and walls; a vehicle has a hull and a boarding radius. |
| `damageGarrison` damage split | A structure absorbs part of a hit for its occupants. A carrier's passengers are lost with the hull in this phase; no spill model is introduced. |
| `expelFromCollapsingShelter` | Only a structure collapses at a quarter integrity. |
| Neutral-shelter occupation rules | Neutral authored strongpoints may be entered by either side; a carrier is always owned. |
| Protection, exposure and firing slots | These are properties of cover. Mobile transports define none yet. |

## 12. Explicitly deferred

Landing craft units; transport buildings; national APC or transport-helicopter
variants; transport research; passenger firing; door guns; rope insertion;
paratroopers; swimming and amphibious movement; emergency ejection; fixed-wing
transport aircraft; convoys; fuel and ammunition logistics; squad entities;
broad UI redesign; transport AI. The shared APC and transport helicopter are no
longer deferred; they are documented in `PHASE_5C_APC_TRANSPORT.md` and
`PHASE_5D_TRANSPORT_HELO.md`.

## 13. Verification

- `tests/container-architecture.test.ts` covers the generic contract: boarding,
  identity retention, capacity determinism, one-seat-only, ownership rejection,
  carrier following, independent-order rejection, vision/projection privacy,
  destruction exactly once, unloading, blocked exits, save/load equality,
  orphan repair, over-full trimming and command-gate rejection.
- `tests/apc-transport.test.ts` covers the shipped APC: registry and production,
  both alliances, four-passenger capacity, mixed-selection filtering, moving
  re-planning, full-capacity feedback, contextual orders, safe unloading,
  moving-unload stop, destruction, save/load, projection privacy and
  cross-entity snapshot validation.
- `tests/transport-helo.test.ts` covers the shipped air consumer: both-alliance
  production, shared heliport berths, airfield recovery-only rejection, landed
  boarding, four-seat capacity, allied boarding and owner unload, field landing
  and refusal feedback, map-edge and occupied-position rejection, takeoff with
  its berth intact, movement with passengers, landed-only unloading, blocked
  placement, destruction, save/load and multiplayer projection.
- The existing `tests/garrison.test.ts` and `tests/garrisonable-fog.test.ts`
  suites remain the regression contract for static shelters.
