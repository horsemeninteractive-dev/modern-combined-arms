# Phase 5F — Transport AI and amphibious coordination

**Status:** implemented in the working tree. No commit, reset, stash, revert or
clean was performed. The AI drives the three existing carriers through the
ordinary command queue; no passenger array, second boarding path or new unit was
added.

## 1. What the audit found

- `AIController.update` runs tasking in a fixed order: target, garrison, defence,
  economy, scouting, construction, research, production, naval, air, capture,
  abilities, superweapon, offensive.
- **No transport tasking existed at all.** `desiredUnits` never named the APC,
  `transportHelo` or `landingCraft`, `NAVAL_SLOTS` deliberately excludes the
  transport, and the `combat` list is filtered to units with weapons, so an
  unarmed carrier was never ordered to attack. That part needed no change.
- Carriers are already fully command-driven: `garrison`, `ungarrison` and `move`
  are the only interfaces, and `Game` owns beach selection, landing zones,
  ordering validation and the exit transaction. The AI therefore needs only to
  decide *when and where*, never *how*.
- One gap blocked planning: there was no read-only way to ask whether a beach or
  landing zone exists without issuing an order and generating refusal events.

## 2. New planning module

`src/sim/transportAI.ts` holds the pure decisions, testable without a battle:

- `transportKindOf` maps a hull to `land` / `air` / `naval` from its existing
  `TransportDef` and domain. No id list.
- `lineCrossesWater` samples the existing terrain grid along the base-to-objective
  line. This is the evidence that a transport is actually useful.
- `coastalStagingPoint` finds a foot-standable land tile beside navigable water —
  the only place infantry can wait for, or walk off, a landing craft.
- `waterApproachTo` finds the navigable water beside a landing point, because a
  move order to land is not a naval order.
- `transportDemand` returns at most one arm, with a reason.

## 3. Demand rules

| Arm | Condition |
| --- | --- |
| Naval | water on the map, a shipyard, an objective across water, a beach at both ends, no hull owned or queued |
| Air | a heliport, a field army, an approach of 25+ tiles, no aircraft owned or queued |
| Land | a factory and barracks, eight combat units, an approach of 22+ tiles, no APC owned or queued |

All three share a 2.5-minute opening gate and a cooldown after the last
commitment or loss (40 s naval/air, 30 s land). A transport is a mid-game asset:
buying one while the perimeter is still being laid out spends the hull's price
and the defence that was never sited, which an existing AI regression test caught
during this phase.

## 4. Operation lifecycle

One `TransportOperation` is stored on `AIControlState` (optional, so older saves
load unchanged). It records carrier id, passenger ids, stage, objective, staging
point, start tick, last order tick and refusals — numbers, strings and ids only.

1. **embark** — order the squad to `garrison` the carrier. The simulation finds
   the beach or landing zone and the infantry walk to it. The squad is counted
   whole: men already in the hold plus the last one walking to the ramp is a full
   lift. Timeout 75 s, then the plan is abandoned.
2. **transit** — `move` the carrier to the water beside the landing point (or the
   point itself for air and land). Up to two free combat units are put on the
   route as escort, never the whole army.
3. **unload** — `ungarrison`, which beaches or lands the carrier authoritatively
   and releases everyone through the shared exit transaction. A second refusal
   against an already-beached hull means the ground is blocked; the passengers
   stay aboard and the operation is dropped.

After a successful landing the released infantry receive one `attackMove` toward
the original objective, and the carrier is sent home by an ordinary move — which
is also what clears a beached hull's shore state.

## 5. Failure and recovery

- Carrier destroyed or missing → operation removed; passengers follow the
  existing kill-on-destruction policy exactly once.
- Carrier damaged below 35 %, or hostiles with weapons within nine tiles → the
  operation is abandoned rather than pressed.
- No beach, no landing zone, no water approach, or the shore becomes blocked →
  cancelled once, never re-ordered every think.
- Passengers dead or committed elsewhere → pruned; fewer than two left cancels.
- Hard ceiling of seven minutes, so a genuinely stuck operation cannot hold a
  hull forever.

Cancellation never moves, destroys or teleports a passenger. If they boarded,
they stay aboard; if not, they stay on foot.

## 6. New read-only game queries

- `Game.navalLandingAvailable(id, x, z, exits)` — runs the real beach planner,
  including navigable water, hull clearance, distinct foot exits and a naval
  route, and writes nothing.
- `Game.transportLandingAvailable(id, x, z)` — the field-landing counterpart.

Both exist so a commander can decline a plan instead of generating refusal
events, and both are side-effect free, so no client or AI can use them to mutate
state.

## 7. Multiplayer and persistence

The AI issues the same commands a player does, through `enqueueCommand`, so the
command gate, authoritative revalidation and projection privacy apply unchanged.
`transportOps` is serialised with the existing AI state; it holds no passenger
data, because `garrisonId` remains the only link.

## 8. Verification

`tests/transport-ai.test.ts` covers classification, separation detection, coastal
staging on both shores, demand gating and cooldown, a full strait crossing with
three infantry, destruction with three embarked passengers (one loss each, no
dangling references), an unarmed hull never acquiring a target, and an APC
advance that is used for 22+ tiles but refused for a six-tile walk.

Existing suites retained: container architecture, APC, transport helicopter,
landing craft, garrison, naval, submarine, AI.
