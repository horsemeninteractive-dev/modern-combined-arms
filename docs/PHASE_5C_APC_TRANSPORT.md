# Phase 5C — Shared APC & Land Infantry Transport

**Status:** implemented in the working tree. No commit, reset, stash or revert
was performed. The APC uses the Phase 5B `ContainerDef` / `TransportDef`
architecture; there is no parallel cargo system.

## 1. Role

The APC is the shared baseline infantry transport for both alliances. It is a
conventional wheeled armoured personnel carrier, not an IFV: its job is to carry
a squad across open ground and put it down intact. It remains available to every
nation through the common `UNIT_LIST` baseline; there is no national variant,
exclusive, research gate or second APC.

## 2. Final statistics

| Attribute | Value | Rationale |
| --- | --- | --- |
| Domain / move class | land / wheeled | A conventional wheeled APC, distinct from tracked IFV and MBT hulls. |
| Speed | 3.05 tiles/s | Faster than the 2.3 MBT, slower than the 3.7 recon car. |
| Turn rate | 2.8 | Responsive enough to follow a route through a base. |
| Collision radius | 2.7 | Larger than the IFV's 2.4; the troop box is a real footprint. |
| Vision | 9 tiles | Same as the IFV; the squad does not gain a second sight line. |
| HP / armour | 320 / light | Weaker than the 380 HP IFV and far weaker than the 540 HP tank. |
| Cost | 380 materials, 15 requisition | Cheaper than the 460/20 IFV, expensive enough not to be disposable. |
| Build time | 11 s | Slightly faster than the IFV's 12 s; factory queue rules are unchanged. |
| Weapon | `apcMg` 7.62mm machine gun | 6 damage, 5.2 tiles, 0.45 s cooldown, 0.68 accuracy, ground only. |
| Anti-armour | None meaningful | 0.05 multiplier against heavy armour, 0.35 against light. |
| Passenger capacity | 4 individual entities | Not squads and not four squads. |
| Passenger firing | Disabled | `firingSlots: 0`, `canFireEmbarked: false`. |
| Boarding radius | 2.5 tiles | Infantry already alongside board immediately. |
| Destruction policy | `kill` | All passengers die with the hull; no spill or ejection. |
| Facility / gate | Vehicle Factory / tier 0 | The existing factory and production queue; no new building or technology. |

The machine gun is deliberately inferior to the IFV's autocannon against every
target class, and has no anti-air or missile capability. The APC cannot replace
an IFV in a firefight.

## 3. Passenger eligibility and capacity

`TransportDef.passenger` is `'infantry'`. The shared helper
`containerAcceptsPassenger` requires all of:

- a live, exposed `unit` entity;
- `armour === 'infantry'`;
- `canGarrison === true` on its definition;
- a container whose `passenger` class is `infantry`.

This accepts riflemen, ATGM teams, medics and eligible national infantry teams.
It rejects vehicles, other APCs, aircraft, ships, buildings, harvesters and
engineers. Eligibility is a data rule; there is no hardcoded unit-id list in
generic container logic. Capacity is re-read from the derived occupant list on
every entry, so the fifth soldier cannot take a seat and simultaneous orders are
resolved deterministically by entity id.

## 4. Boarding controls

1. Select one or more eligible infantry.
2. Right-click a friendly APC, or press `G` / `BOARD / GARRISON` and click it.
3. Infantry within 2.5 tiles enter immediately; the rest path to the carrier.
4. A carrier that drives on is followed: `updateGarrisonOrder` re-plans when the
   route runs out or the carrier has moved more than a tile from the old
   destination.

A friendly APC includes a carrier owned by another player on the same team.
Enemy carriers are refused by the simulation and the command gate; enemy APCs
fall through to the normal attack order. Passengers from more than one player on
the same side can share the four seats. The carrier owner's unload releases everyone
aboard; another player may unload only their own infantry.

Mixed selections send only the eligible infantry. A full APC refuses the order
before creating a route and emits `Armoured Personnel Carrier is full (4/4)`.
If a group is larger than the remaining seats, the accepted infantry board and
the remainder stay outside with a warning.

## 5. Unloading controls

Select the APC and use `UNLOAD ALL`, or select its passengers and use `EXIT`.
The existing `ungarrison` command is used. On a mixed-player carrier, the
carrier owner's order releases everyone aboard; a passenger owner's order
releases only their own infantry and leaves teammates aboard. The carrier is
halted first
(`order`, `path`, destination and state cleared), then `exitContainer` plans a
distinct safe position for every passenger before moving anybody.

Placement uses the existing deterministic ring search:

- outside the hull footprint;
- one passenger per position, with collision spacing;
- no blocked tiles, buildings, deep water or off-map positions;
- all passengers move or nobody does.

If no complete ring can be found, every passenger remains embarked and the
order emits `No safe exit from ...; occupants remain inside.` There is no
individual seat selection or partial unload.

## 6. Lifecycle and persistence

Passengers keep their original entity ids, owner, health, veterancy and
upgrades. While embarked they are pinned to the carrier, skipped by independent
movement, collision, targeting, firing and vision, and are not rendered as
separate infantry models. The selected-unit card shows `PASSENGERS n/4`, the
remaining spaces and the passenger type mix.

When the APC is destroyed, `destroyContainer` applies the `kill` policy once:
each passenger's reference is cleared, the normal casualty path records one
loss per passenger, and no orphan survives. There is no damage spill and no
ejection.

`garrisonId` remains the only occupancy reference, so no save-schema change was
needed. `reconcileContainers()` restores legal relationships, clears orphans and
trims an over-full container to the lowest ids on load.

## 7. Multiplayer and privacy

Boarding and unloading are ordinary authoritative `garrison` / `ungarrison`
commands. `CommandGate` verifies the seat owns the selected infantry, the APC is
a mobile container belonging to the seat's team, capacity is available and the
passengers are eligible; mixed selections are filtered to eligible infantry
before enqueueing. The simulation re-validates the same-side relationship in
`enterContainer` / `exitContainer`.

`createTeamSnapshot` now calls `Game.assertContainerIntegrity()` before building
the wire state. The check rejects a passenger whose container is missing or
dead, a non-infantry passenger, a passenger in an enemy transport, or a
container over capacity. This is the cross-entity check the per-entity schema
cannot express; it does not change legal building garrisons.

Enemy projections omit embarked passengers entirely even when the carrier is
visible. Owner projections include the passengers and their `garrisonId`.
Reconnect uses the same snapshot path.

## 8. AI compatibility

No APC demand is registered in `AIController.desiredUnits()`, so the AI does not
buy or spam a transport it cannot yet task. Existing AI garrison, combat and
production behaviour is unchanged. Full transport AI remains Phase 5F.

## 9. Known limitations

- Air and naval infantry transport remain deferred.
- No passenger firing, door guns, ejection, damage spill, amphibious movement or
  convoy behaviour.
- No individual seat selection. `UNLOAD ALL` is carrier-wide for the carrier
  owner; a non-owner passenger can release only their own infantry.
- The APC cannot carry engineers, even though they are individual units, because
  their support-vehicle classification and `canGarrison` rule exclude them.
- Full transport AI is deferred; the AI will not use the APC productively yet.
- The generated voice lines use the local Kokoro placeholder cast, like the rest
  of the recorded set; final voice direction can replace them without changing
  the runtime contract.

## 10. Verification

- `tests/apc-transport.test.ts` — 23 tests covering registry, both-alliance
  production, capacity, eligibility, mixed selections, moving boarding,
  teammate boarding/save/unload, carrier-owner unload, contextual orders, full feedback, safe
  unloading, moving unload, destruction, projection privacy, cross-entity
  validation and the command gate.
- Existing `tests/container-architecture.test.ts`, `tests/garrison.test.ts` and
  `tests/garrisonable-fog.test.ts` remain green.
- `npx tsc --noEmit`, the full test suite and `npm run build` are the release
  gates; actual results are recorded in the Phase 5C completion report.
