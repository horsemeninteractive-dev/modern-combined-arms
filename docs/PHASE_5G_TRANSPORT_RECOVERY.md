# Phase 5G — Transport recovery and hardening

## 1. What the audit found

The three carriers were already command-driven, and Phase 5F's planning module
(`src/sim/transportAI.ts`) was sound: demand was gated, planning was pure, and
all boarding, beaching and unloading went through `garrison`, `move` and
`ungarrison`. The audit did find two real defects.

**Defect 1 — orphaned passengers.** `cancelTransport` deleted the operation
unconditionally. If the carrier was hurt, threatened, timed out or refused an
unload while troops were aboard, the operation vanished and nothing was left
responsible for those passengers: a loaded hull sat idle with no owner, and the
commander would plan a new operation elsewhere. No passenger was killed or
teleported — the state was simply lost.

**Defect 2 — an escort that could never be selected.** Escort candidates had to
pass `free()`, which requires `!entity.order`. The AI gives its combat units
orders on nearly every think, so in practice there were no free units and escorts
were essentially never assigned, despite the code path existing.

Everything else checked out: board-only-when-landed/beached, kill-on-destruction
with one loss per passenger, temporary field landings that do not overwrite a
home berth, and the save schema carrying `transportOps` as an optional field.

## 2. Recovery behaviour

`TransportOperation.stage` gains `recover` and `recoverUnload`. Cancellation now
behaves differently depending on the hold:

- **Empty hold** — the operation is removed, exactly as before, and the cooldown
  starts.
- **Passengers aboard** — the operation is kept and becomes a recovery run. The
  same `TransportOperation` remains the only owner of those troops, so no second
  passenger list and no parallel state exist.

Recovery drives the carrier home with ordinary `move` orders (a water approach
near the base for a landing craft, a field landing near the base for a
helicopter, the base itself for an APC), then issues `ungarrison` there. The
authoritative unload finds the exits; nothing is teleported and `garrisonId` is
never written by AI code.

Failure handling:

- No valid home beach or landing zone → the operation is **held**, not deleted,
  and the commander reports how many infantry are waiting.
- A refused unload is retried at a ten-second pace. After eight refusals the
  operation is held again rather than retried forever.
- Recovery has no assault ceiling. The seven-minute limit still applies to the
  assault stages only.
- A destroyed carrier still follows the established kill-on-destruction policy;
  there is nobody left to recover, so the operation is dropped.
- Aircraft landing validation and naval beaching validation are unchanged and
  re-checked every recovery step.

On success the hull is released with no attack follow-up, so recovered infantry
do not receive a stale assault order.

## 3. Escort change

Escort selection now accepts combat units that are already under orders — the
ones marching on the same objective — instead of requiring idle units. It still
takes at most two, still excludes aircraft and garrisoned units, still respects
`claimed`, and still only runs when the base itself is not under threat. The
units are ordinary entities: when the operation ends or is cancelled they simply
receive the next think's orders.

## 4. Tests added

`tests/transport-ai.test.ts` grows from 10 to 21 tests:

- **Recovery:** damaged loaded carrier becomes `recover` and lands all three
  passengers home; an empty carrier is dropped without loss; 36 % health keeps
  the assault; exact 35 % triggers recovery.
- **Threats:** unarmed hostile ignored; armed hostile at 9.5 tiles ignored and at
  8 tiles triggers recovery; threat removed → passengers still delivered.
- **Escort:** exactly two of three tanks escort, the third keeps its own work,
  and no unit is left garrisoned or tied to a finished operation.
- **Helicopter end-to-end:** AI plans the operation, infantry board while the
  hull is landed, it flies 36 tiles, lands, unloads all three at the objective,
  and returns to a landed state.
- **Field landing:** a temporary landing is recorded on the aircraft and never
  promoted to a home berth.
- **Persistence:** a save taken in transit restores stage, passenger list and
  occupants; a save taken mid-recovery restores `recover` and still lands its
  passengers.

## 5. Deliberately unchanged

No new transport, building, research, passenger weapon, selective unload,
formation system or multi-wave assault. No change to boarding radii, capacities,
beaching rules, landing validation, destruction policy or the AI economy.

## 6. Verification status

Automated coverage is listed in the Phase 5G completion report. Browser visual
inspection of the three carriers, live two-client sessions and human-play balance
assessment were **not** performed in this environment; the exact limitation and
reproduction steps are recorded in the report.
