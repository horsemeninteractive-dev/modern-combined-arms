# Phase 12 — Fog-of-War Integrity and AI Information Boundaries

**Verdict: two confirmed leaks, both fixed. The Phase 11 assault correction and
the difficulty contract are intact, and 539 of the 540 diagnostic matches are
bit-identical to Phase 11.**

The audit traced every place the AI reads the world rather than its own
knowledge. Two of them let hidden occupancy change a *decision*: the assault aim
inherited from Phase 11, and engineer capture tasking. Both are now gated on the
team's own memory. A third — build-site crowding — is a confirmed dependency of
the same class that this phase documents but does not change. Everything else
either reads only own/neutral entities, or reads the static map, which is not
information the player lacks either.

## 1. What the AI is allowed to know

| Source | Who has it | Used for |
| --- | --- | --- |
| `game.visibleEnemies(owner)` | the team's current vision cones, radars and close-range forest spotting | threats, direct-fire targets, scouted force mix |
| `game.contactsFor(owner)` | sightings younger than 30 s that are no longer visible | remembered enemy positions, the assault objective |
| `game.isKnownTo(team, id)` / `visionStateOf` | visible units and **charted** structures — a structure is charted the first time it is seen and stays charted | drawing the map, and now the aim and capture gates |
| terrain, elevation, `canStandOn` | static map data | every movement check; equally available to the player |
| `this.blocked` | every structure on the map, **including invisible ones** | physical collision, pathfinding, and the command layer's refusal of an order |

The last row is the whole question. `blocked` is a physical fact of the
simulation, and it must keep refusing movement into a wall nobody can see. What
must not happen is the AI *pre-reading* it to choose where to stand.

## 2. Findings

### A. Confirmed leak — the assault aim (fixed)

`Game.groupApproach` (Phase 11) walked from the remembered contact toward the
AI's base and returned the first point `canOrderMove` accepted. `canOrderMove`
tests `this.blocked`, which covers unseen structures, so a hidden building on
that line pushed the aim further out.

Reproduction (`tests/fog-integrity.test.ts`, first test), six tanks, one
remembered command post, seed 7, fog on:

| World | AI's first attack-move order | Wave |
| --- | --- | --- |
| Clear | `(20.2, 34.1)` tiles | 1 |
| Same, plus a bunker at `(21, 33)` the AI has never seen | `(23.2, 34.1)` tiles | 1 |

The bunker is genuinely unknown: `isKnownTo` false, `isVisibleTo` false, no
contact, no charted entry. A three-tile shift in a deliberate destination is a
decision, not a collision.

**Correction.** `knownBlockage(team)` builds a tile mask from the structures the
team can see, has charted, or holds a building contact for; `aimIsOpen` walks
against that mask plus terrain only. The walk therefore cannot move because of a
building the team has never seen. The chosen point is still validated against the
real command layer once, at the end: if the world refuses it, `groupApproach`
returns `null` and the commander holds without starting a wave — physics is
allowed to stop an attack, hidden knowledge is not allowed to redirect it.

Consequence, measured by the same fixture: with the hidden bunker the commander
now orders exactly the destination it would have chosen anyway, and gets no wave
instead of a diverted one. Both are visible in the fixture's assertions.

Knowledge is what gates it, not team identity: give the same bunker a scout for
one tick (`spotter` fixture) and it is charted, so the aim clears it and the wave
lands on the post. Withdraw the scout and the structure stays charted — a
remembered silhouette is knowledge the AI is meant to have.

### B. Confirmed leak — engineer capture tasking (fixed)

`AIController.captureObjective` scanned `game.state.entities` for any capturable
structure within 48 tiles of its engineer. `supplyDepot` and `radarStation` are
capturable and buildable, so an **enemy-built** depot in the dark became a
capture target without ever being seen.

Reproduction (same test file): AI engineer at `(38, 30)` tiles, enemy depot at
`(20, 20)`, no vision of it.

| World | Capture order | Depot knowledge at the time |
| --- | --- | --- |
| No depot | none, 120 s | — |
| Hidden enemy depot | **engineer ordered to `(21.5, 21.5)`** | unknown when the order was issued; the engineer only saw it after walking there |

**Correction.** Enemy-owned capturable structures now need `isKnownTo(team, id)`.
Authored objectives (`owner < 0`, the neutral relays, depots and radar stations a
map places) stay eligible without a report: they are part of the scenario, and
the objective line in the HUD counts them for the player in exactly the same way.
Charted enemy structures remain valid targets, which the fixture verifies through
a real save round-trip.

### C. Confirmed dependency, not changed — build-site crowding

`findBuildSite` scores candidate tiles and subtracts `crowd * 1.1`, where `crowd`
counts **every** entity within half a footprint plus three tiles, from
`game.state.entities` — including enemy units and structures the AI cannot see.
A hidden tank therefore nudges the AI away from a build site it would otherwise
choose.

This is the same class of violation as A, but it is a soft score among the AI's
own base positions rather than a binary task, and correcting it would change base
layout for every match. It is documented here rather than fixed: the phase's
scope is the Phase 11 boundary, and a layout change belongs with its own
measurement. Recommended follow-up: count only `ctx.own`, `ctx.visible` and
charted structures, then compare base layouts and the 540-match matrix.

### D. No issue — the rest of the decision surface

| Read | Verdict |
| --- | --- |
| `manageGarrison` scan for shelters | own or neutral (`owner === ctx.aiId \|\| owner === -1`) only; authored cover |
| Threat detection, direct-fire targets, air/naval counts | `ctx.visible` only |
| Scouted force mix, defence targets, enemy military count | `visibleEnemies` + `contactsFor`, filtered by team |
| Production, power, income, queue decisions | own player and own entities only |
| `standable` in the AI | terrain via `canStandOn`; static map, no occupancy |
| `formationPoints` | own group geometry |
| Contacts and charting | recorded only on sighting, expire after 30 s (contacts) or persist as silhouettes (structures) |

Allied sharing (fixture F): participants on the same `team` share vision and
contacts, because vision is computed per team, and an entity moved onto team 1 by
a third player is known to both members of team 1 and to neither member of team
0. No new sharing rule was introduced.

## 3. Evidence and fixtures

`tests/fog-integrity.test.ts` — eight deterministic fixtures, all passing:

1. **Hidden-structure independence.** Same world ± an unseen bunker: the aim is
   no longer steered; the hidden building may only refuse the chosen order, and
   the wave counter stays at zero rather than advancing on a phantom wave.
2. **Charted structure.** A scout sees the bunker; the aim clears its 2×2
   footprint and the wave destroys the post.
3. **Remembered contact.** After the scout withdraws, `visionStateOf` is
   `remembered`, the contact keeps the post's coordinates, and the wave still
   attacks them.
4. **Memory expiry.** With two tanks (below the gate and the overdue threshold),
   the contact expires and the commander drops the objective; no wave, no damage.
5. **Never-seen structure.** Not visible, not charted, not known; it never
   appears in a decision and the remembered post stays the objective.
6. **Allied sharing.** Team-mates share vision and contacts; the opposing team
   learns nothing.
7. **Capture gating.** No order against an unseen enemy depot; the same depot
   becomes a target once charted (through a save load).
8. **Determinism.** Two runs of the hidden-structure fixture produce the same
   destination, wave count, post health and `stateHash()`.

The two leaks were demonstrated *before* the corrections with these same
fixtures: the first test failed with `waves 1` instead of 0, and the capture
fixture ordered the engineer to the unseen depot. Both now pass.

Limitations: arrival paths and line-of-sight were not exhaustively enumerated;
the fixtures cover one map area and one unit mix. The build-site finding (C) has
a proven data flow but no behavioural measurement.

## 4. Regression and outcome verification

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **42 files / 455 tests passed** (was 41 / 447) |
| `npm run build` | clean, `sw.js precaches 13 files` |
| `npx vitest run tests/fog-integrity.test.ts` | 8 / 8 |
| `tests/ai-employment.test.ts` (Phase 11 fixtures) | 15 / 15, one fixture updated to grant the remembered contact the aim now requires |
| `tests/ai-matchups.test.ts` | contracts unchanged: Recruit–Veteran **−49 344** (4–12), Elite–Recruit **85 540** (15–1), Elite–Veteran **34 177** (11–5) |
| Determinism / save-load tests | unchanged and passing |

National matrix, `MCA_SEEDS=101,1078,2055,11,555,999,1234,2468,3690 npx tsx
tools/timeout-audit.ts 9 600 veteran`, compared with the stored Phase 11 run
(`tmp/p11-540-on.jsonl`):

| Measure | Phase 11 | Phase 12 |
| --- | --- | --- |
| Timeouts | 138 (25.6 %) | 138 (25.6 %) |
| `army-collapse` / `siege` / `stalemate` / `standoff` / `other` | 87 / 23 / 18 / 4 / 5 | identical |
| Decisive matches, mean duration | 402, 288 s | 402, 288 s |
| Refused group moves | 2 688 | 2 688 |
| …of which into an enemy footprint | **391** | **391** |
| Matches with artillery | 294 | 294 |
| Matches identical to Phase 11 | — | **539 of 540** |

The single differing match is `uk vs belarus`, seed 2468, rotated personalities:
victory at 272.9 s with a 9 159 west score becomes victory at 226.1 s with
11 239. No other outcome, category or refusal count moved.

That near-identity is the expected result and a useful one: in normal play the
AI acquires a building's contact at the same moment it charts it, so the
knowledge-gated aim selects the same tile the old code did, and the hidden
boundary only mattered in the contrived cases — plus one real match in 540.

## 5. What was not changed

- Unit, weapon, building and economy values; construction times; costs.
- National rosters, the six-nation substitution map, or the legacy `baltic` /
  `expeditionary` presets.
- AI difficulty weights, reaction cadence, army-size thresholds, assault gate,
  wave cooldown, commit share, reserve.
- Combat, indirect fire, repair suppression (Phase 8/9 rule untouched), victory
  conditions, timeout classification.
- Save format and serialization; no new persistent state. The fixes add no
  fields, consume no randomness, and the fixtures' determinism check confirms it.
- Scouting and patrol destination selection (the Phase 11 scout variant remains
  unshipped), and the diagnostic arena's ore default.
- The seat asymmetry and timeout rate, which are separate open issues.

## 6. Next step

Fix finding C the same way — count only what the team knows when scoring a build
site — and measure whether base layouts and the matrix move. After that the
information boundary is clean enough that the remaining national-matrix work
(shipped-map ore budgets, seat asymmetry, army-collapse timeouts) can be trusted
not to be confounded by AI omniscience.

## Appendix — files

| File | Change |
| --- | --- |
| `src/sim/game.ts` | `knownBlockage`, `aimIsOpen`; `groupApproach` walks on team knowledge and validates once against the command layer |
| `src/sim/ai.ts` | capture candidates require knowledge for enemy-owned structures |
| `tests/fog-integrity.test.ts` | new: eight fixtures for the boundary |
| `tests/ai-employment.test.ts` | destroyed-structure fixture now grants the remembered contact the aim requires |
| `README.md` | test count and the audit link |
