# Phase 5D — Shared Utility Transport Helicopter

**Status:** implemented in the working tree. No commit, reset, stash or revert was
performed. The helicopter is a data-defined consumer of the Phase 5B container
contract and the Phase 5C boarding/unloading transactions; there is no second
cargo or flight simulation.

## 1. Role and identity

`transportHelo` is the shared conventional medium-lift utility helicopter for
both alliances. It carries four individual infantry entities, is unarmed, and
exists to insert and extract a squad. It is deliberately not an attack
helicopter with seats: it has no door gun, rockets, missiles or passenger firing
positions.

Both alliances inherit the same definition through `UNIT_LIST`. There is no
national variant, no exclusive and no second transport helicopter.

## 2. Final statistics

| Attribute | Value | Rationale |
| --- | --- | --- |
| ID | `transportHelo` | Canonical shared slot. |
| Domain / movement | air / air, `rotary: true` | Uses the existing aircraft and heliport systems. |
| Role | Utility transport | Dedicated lift platform. |
| Speed | 7.4 tiles/s | Faster than the 3.05 APC over distance, slower than the 8.4 gunship and much slower than a jet. |
| Turn rate | 2.3 | Stable transport handling rather than gunship agility. |
| Collision / landing radius | 3.1 | Wide four-man cabin and rotor footprint. |
| Vision | 12 tiles | Helicopter optics; passengers add no independent vision. |
| HP / armour | 220 / air | Lower than the 240 HP gunship and the 320 HP APC; the transport is deliberately fragile. |
| Cost | 760 materials, 140 requisition | More expensive than the APC, cheaper than a strike fighter. |
| Build time | 20 s | Heliport queue, existing production rules. |
| Fuel | 90 | Existing aircraft fuel/servicing model. |
| Armament | none | `weapons: []`; no attack order. |
| Capacity | 4 individual infantry | Not four squads. |
| Passenger firing | disabled | `canFireEmbarked: false`, `firingSlots: 0`. |
| Boarding radius | 2.5 tiles | Same interaction range as the APC. |
| Destruction | `kill` | Every passenger dies with the hull exactly once. |
| Facility | heliport | Existing rotary production and two-berth capacity. |
| Research | `air2` (Air Superiority / Strike Aviation) | Existing rotary unlock; no new technology or branch. |
| National variants | none | Shared baseline for both alliances. |

## 3. Production and basing

The heliport's production list includes `transportHelo`. `productionStatus`
enforces the same two helicopter positions used by gunships, so a transport
cannot bypass the capacity that already governs `attackHelo`. The transport is
not produced by an airfield; the airfield's single temporary helicopter pad
remains recovery-only and cannot build either helicopter type.

A battlefield landing is a field stop, not a rebasing operation. `homeId`,
`berth` and the permanent docking assignment are untouched while the helicopter
carries passengers to an open-ground landing zone. Takeoff preserves the berth,
and an explicit RETURN clears any field stop and brings the hull back to its
assigned home position.

## 4. Landing and takeoff

The helicopter uses the existing aircraft movement and ground-roll system. A
transport-specific landing is represented by `AircraftState.fieldLanding` and a
`fieldLand` ground-roll leg rather than a second flight system.

A field landing request searches outward from the requested point, up to 14 tile
rings, for a candidate whose footprint:

- lies wholly inside the map;
- is not blocked by a structure footprint;
- is standable by foot movement (no deep water or impassable terrain);
- does not overlap another live ground unit;
- is clear of the carrier's own hull.

If no candidate exists, the request fails once with `No clear landing zone` and
the infantry remain independent. A failed request is not retried every tick.
Infantry boarding orders wait while the hull is airborne or rolling; they only
walk to it after the authoritative landed state is reached.

Normal movement clears `fieldLanding`, takes off if the hull is parked, and
carries the passengers to the destination without ejecting them. An explicit
RETURN also clears the field stop.

## 5. Boarding

1. Select eligible infantry.
2. Right-click a friendly transport helicopter, or use the existing garrison
   order.
3. The helicopter flies to a clear landing position near the squad and lands.
4. Eligible infantry approach and board through the existing `garrison`
   command and `enterContainer` transaction.

Eligibility is the shared data rule: a live, exposed infantry entity with
`armour === 'infantry'` and `canGarrison === true`. Vehicles, engineers, other
transports, aircraft and ships cannot board. Mixed selections are filtered;
the fifth soldier is refused with feedback. A full hull is refused before a
waiting route is created.

## 6. Unloading

`UNLOAD ALL` uses the existing `ungarrison` command. If the helicopter is
airborne or rolling, it first requests a field landing with purpose `unload`.
Passengers are released only after `finishFieldLanding` has set the hull down.

`exitContainer` plans a distinct safe position for every passenger before moving
anyone. It rejects blocked tiles, buildings, occupied positions, deep water and
off-map positions. If the complete plan cannot be made, every passenger remains
aboard and the order reports that the unload is blocked. Landing on open ground
does not require a road, but passenger placement still requires foot-standable
terrain.

## 7. Passenger lifecycle and destruction

`garrisonId` remains the only occupancy reference. While embarked, passengers
keep their entity id, owner, health, veterancy and upgrades; they are pinned to
the hull, contribute no independent vision, cannot be selected or targeted, and
do not fire. No separate airborne passenger entity is rendered or simulated.

When the helicopter is destroyed, the shared `kill` policy clears every
passenger, records each loss once, and leaves no orphaned container reference.
Save/load and reconnect preserve occupancy through the same `garrisonId` field;
no save-schema change is required.

## 8. Allied passenger ownership

The shared mobile-container rule is team-aware. Allied infantry may board an
allied transport helicopter, retain their original player ownership, and return
to that owner after unloading. Enemy infantry cannot board.

The shared mobile-container unload rule is carrier-owner wide: a carrier owner's
`UNLOAD ALL` releases every passenger aboard, including allied infantry. A
non-owner may release only their own infantry from a ground carrier; an air
transport accepts only its owner's unload order because the owner controls the
landing and the exit transaction. This is enforced in both the simulation and
the command gate, so a player still cannot use a friendly carrier to take
ownership of another player's infantry.

## 9. UI, model and audio

- Distinct `TRANSPORT HELO` name, utility-transport role, description and icon.
- Procedural wide-cabin helicopter mesh with main and tail rotors, distinct from
  the gunship silhouette and within the existing visual scale limit.
- Selection HUD shows `PASSENGERS n/4`, remaining capacity, passenger mix and
  `LANDED` / `AIRBORNE` / `LANDING` state. `UNLOAD ALL` is disabled when empty.
- Twelve recorded Kokoro lines (`select`, `move`, `attack`, `unableToComply`,
  three takes each) describe an unarmed lift crew. The `attack` lines explicitly
  report that the aircraft has no weapons.
- Landing, refusal, full-capacity and blocked-exit feedback use the existing
  order event channel.

## 10. Multiplayer authority and privacy

Boarding and unloading are ordinary authoritative `garrison` / `ungarrison`
commands. The command gate checks seat ownership, friendly carrier ownership,
eligibility, known target, hostile occupants and capacity. The simulation
re-validates every relationship in `enterContainer` / `exitContainer`.

`createTeamSnapshot` runs `assertContainerIntegrity()` before building the wire
state. A forged or corrupted snapshot with a missing/dead container, wrong
passenger class, enemy passenger or over-capacity transport is rejected. Enemy
projections omit embarked passenger identities even when the helicopter is
visible; the owner projection includes them. Landing state
(`aircraft.landed`, `aircraft.roll`, `aircraft.fieldLanding`) is public
simulation state so both peers render the same takeoff, approach and landing.

## 11. AI compatibility

No transport-helicopter demand is registered in `desiredUnits()`. The AI does
not buy or spam a platform it cannot task, and full transport mission planning
remains deferred to Phase 5F. Existing attack-helicopter production, airfield
recovery and heliport behaviour are unchanged.

## 12. Known limitations

- Boarding and unloading require a landed hull; rope insertion, fast-roping and
  boarding from a hover are deferred.
- No air drops, paratroopers, passenger firing, door guns or medevac.
- No manual landing-zone picker: the nearest clear field position is selected
  automatically, with refusal feedback when none exists.
- No full transport AI, convoy behaviour, amphibious movement or naval landing
  craft.
- The generated voice lines use the local Kokoro placeholder cast, as with the
  rest of the recorded set.

## 13. Verification

`tests/transport-helo.test.ts` covers 19 cases:

- registry, shared roster, air-domain classification, four-seat capacity,
  unarmed status and lower-than-gunship durability;
- both-alliance heliport production, the `air2` gate and shared two-berth
  capacity;
- airfield recovery-only rejection;
- landed boarding, four-passenger capacity, fifth-passenger refusal, mixed
  selection filtering and friendly/enemy context resolution;
- allied boarding with owner-preserving unload;
- movement with passengers, landed-only unloading, safe distinct placement,
  blocked placement retention, save/load identity and destruction exactly once;
- map-edge footprint, occupied landing rejection, failed landing feedback
  without retry, and takeoff/return with the permanent berth intact;
- owner/enemy projection privacy and authoritative boarding command rejection.

The transport suite also runs with the existing aircraft-berth, aircraft-dock,
air-naval, APC, container, voice, alliance-baseline and roster suites. The
final targeted APC/transport/faction/alliance run passed 83 tests in 4 files.
The full non-AI suite passed 2,788 tests in 192 files. `npx tsc --noEmit`
and `npm run build` both passed; the build produced the normal Vite bundle and
service-worker precache. The 48-match AI ladder also passed in 410.1 s:
Recruit vs Veteran margin -17,311 (6-10), Elite vs Recruit +94,480 (14-2) and
Elite vs Veteran +40,588 (9-7), preserving the intended difficulty ordering.
