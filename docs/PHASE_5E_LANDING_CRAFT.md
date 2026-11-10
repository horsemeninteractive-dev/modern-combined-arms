# Phase 5E — Shared Naval Landing Craft

**Status:** implemented in the working tree. No commit, reset, stash, revert or
clean was performed. The craft is a data-defined consumer of the Phase 5B
container contract and the Phase 5C/5D boarding and exit transactions; it has no
second cargo list, passenger identifier or movement system.

## 1. Identity and final statistics

`landingCraft` is the shared amphibious infantry transport for both alliances.
It is unarmed, carries four individual infantry entities and exists to put a
fire team on a natural coastline.

| Attribute | Value |
| --- | --- |
| ID | `landingCraft` |
| Name / short name | Naval Landing Craft / LANDING CRAFT |
| Role | Amphibious transport |
| Domain / movement | naval / naval |
| Speed / turn | 2.8 / 0.9 |
| Collision radius / vision | 4.2 / 9 |
| HP / armour | 560 / naval |
| Cost / build time | 520 materials, 95 requisition / 18 s |
| Armament | none (`weapons: []`) |
| Capacity | 4 individual infantry |
| Passenger firing | disabled (`canFireEmbarked: false`, `firingSlots: 0`) |
| Boarding radius | 2.5 tiles |
| Destruction | `kill` |
| Production | `shipyard`, `kockumsYard`; `naval1` unlock |
| National variants | none |

The hull is more durable than the 320 HP APC, less durable than the 950 HP
corvette, slower than attack craft and corvettes, and more expensive than the
APC. It cannot defeat a warship through firepower because it has none.

## 2. Source audit findings

- `garrisonId` is the sole authoritative passenger reference. The existing
  `containerSpec`, `containerOccupants`, `enterContainer`, `exitContainer`,
  `destroyContainer` and reconciliation paths already cover mobile containers.
- Naval movement uses the existing `naval` move class and A* navigation;
  shallow water is navigable but foot-passable, so ordinary ring exits would
  place infantry in water. A dedicated land-only exit planner was required.
- `containerBoardingReady` previously knew only the aircraft landing state. A
  naval transport must wait for an explicit beached state.
- `updateNaval` automatically returned any hull with zero missiles. An unarmed
  landing craft would therefore have entered a permanent return loop unless the
  branch was limited to armed hulls.
- Shipyard production already spawns into adjacent navigable water. No
  production-building change was needed beyond adding the unit to the catalogue.
- `exitContainer`'s standard ring includes shallow water. Naval unloading cannot
  use it unchanged.
- There was no beaching state. `NavalLandingState` is the minimal addition: a
  target water position, a purpose and a public `beached` flag. It is saved
  directly with the entity and projected as public state.

## 3. Production and roster

`landingCraft` is registered once in the shared `UNIT_LIST`, so both alliance
baselines inherit it. It is included in the shared shipyard and the Swedish
Kockums yard production lists. The existing `naval1` technology unlocks it; no
new facility or technology was added. Naval production continues to use the
existing queue, costs and adjacent-water spawn logic.

## 4. Boarding

An infantry garrison order targeting a landing craft first asks the craft to
find a beach near the squad. A candidate beach must:

- be a navigable, unblocked water tile inside the map;
- be clear of other live hulls (the craft itself is ignored);
- have a route for the craft through existing naval pathfinding;
- have at least the required distinct foot-standable land exits;
- reject blocked structures, impassable terrain, occupied positions and
  off-map positions.

The beach score prefers the closest usable land side, then shallow water, then
distance from the squad. Once beached, infantry approach a land tile within the
shared 2.5-tile boarding radius and enter through `enterContainer`. They never
path across water. Enemy infantry is rejected by the existing friendly-carrier
rule. Allied infantry may board; its owner is unchanged.

## 5. Movement and beaching

While loaded, the craft is a normal naval entity: it uses naval navigation,
collision and movement, and the passengers remain pinned to the hull by
`garrisonId`. A normal move order clears any beach/approach state, lifts the
hull off the shore in simulation terms, and is the supported way to leave a
beach. The unarmed hull does not acquire attack targets.

`finishNavalLanding` snaps to the validated tile centre, sets `beached`, and for
an unload runs the shared exit transaction. A shore that cannot be reached is
refused once and clears the approach rather than retrying forever.

## 6. Unloading and safe exits

The HUD's `UNLOAD ALL` sends the existing `ungarrison` command. If at sea, the
craft requests a beach sized for the whole current load. At the shore,
`exitContainer` calls a naval-specific exit planner that accepts only non-water,
foot-standable, unblocked, unoccupied and distinct tiles around the hull. All
positions are planned before any passenger is moved. If any position is
missing, the transaction returns false and every passenger remains aboard.

## 7. Lifecycle and persistence

Passengers retain ids, owners, health, veterancy and upgrades. The existing
`kill` policy records each loss once. `toSave` serialises entities directly, so
`navalLanding` and `garrisonId` survive without a schema change. Reconciliation
still repairs an invalid container reference by returning the passenger to an
independent state; over-capacity containers remain rejected before snapshots
leave.

## 8. Multiplayer and privacy

The command gate restricts naval unload to the carrier owner, mirroring the air
transport rule. The authoritative simulation revalidates ownership, eligibility,
capacity and every exit position at execution time; no client supplies a beach
or exit coordinate. `navalLanding` is public projected state because both sides
need to draw a beached hull. Passenger records remain behind the existing
fog/visibility rules: the enemy sees the craft but not its embarked identities.
Snapshots, deltas, reconnect and team projection carry the new public field and
the existing `garrisonId` association.

## 9. Presentation

The HUD reports `PASSENGERS n/4`, remaining spaces, passenger composition and
`AT SEA` / `APPROACHING SHORE` / `BEACHED`. The unload button is disabled when
empty. The procedural model is a wide flat-bottomed hull with a lowered bow ramp,
an open well deck and a small stern pilot house, distinct from attack craft and
corvettes. A dedicated twelve-clip Kokoro voice bank covers selection, movement,
unarmed attack refusal and inability to comply (including beaching refusals).

## 10. AI

No landing craft was added to `desiredUnits()` or `NAVAL_SLOTS`. Existing naval
AI production, attack, patrol and defence priorities are untouched. Full
amphibious tasking remains out of scope for Phase 5F.

## 11. Verification

The dedicated suite is `tests/landing-craft-transport.test.ts`. It covers the
registry and both baselines, both shipyards, production into water, four-seat
boarding, mixed/ineligible cargo, allied ownership, enemy rejection, a missing
beach, movement with passengers, unloading onto distinct foot-standable tiles,
leaving the beach, failed unload retention, destruction once, save/load and
projection privacy plus command-gate ownership.

See the Phase 5E completion report in the final response for exact command
results, including the full non-AI suite, typecheck, build and remaining
limitations.
