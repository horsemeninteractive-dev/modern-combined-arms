# Phase 13 — Build-Site Information Integrity

**Verdict: the suspected leak is real, reproduced and fixed. One function changed:
the build-site crowd score now counts only entities the commander's team can
know about. Phase 12's two fixes, the Phase 11 assault correction and the
difficulty contract are unchanged, and the 540-match national matrix differs in
4 of 540 records — one underlying game duplicated across three pairings plus one
non-outcome change.**

Phase 12 left one item open: `findBuildSite` subtracted `crowd * 1.1`, and
`crowd` counted **every** live entity in `state.entities` within half a footprint
plus three tiles — including enemies the AI has never seen. This phase proves
that the term is a knowledge leak, measures what it actually does in matches, and
gates it on the same boundary Phase 12 established. Nothing else changed.

## 1. The scoring path, traced

`AIController.findBuildSite` (`src/sim/ai.ts`) runs a ring search from radius 2
to 16 tiles around the base centre:

1. Candidate tiles come from the ring, in deterministic `radius → dz → dx` order.
2. Each tile is rejected unless `game.placementStatus(aiId, defId, x, z, engineer.id, true)`
   returns `ok`. That call is the physical layer: footprint overlap, terrain,
   deposits, adjacency to a producer, engineer reach. It stays authoritative and
   is not touched by this phase.
3. Surviving tiles get a score:
   `-|distanceFromBase - preferred| * 1.4` (site the building at its intended
   radius), minus `distanceToEngineer * 0.8`, plus a refinery's ore bonus, plus a
   defensive-structure threat term, plus a small per-nation/random jitter
   (`this.random(ctx) * 2.2`), minus the crowd term.
4. The best score wins; the engineer is ordered to build there.

The crowd loop was:

```ts
let crowd = 0;
for (const e of ctx.game.state.entities) {
  if (e.hp <= 0) continue;
  if (dist(wx, wz, e.x, e.z) < (Math.max(def.footprint.w, def.footprint.h) * TILE_SIZE) / 2 + 3 * TILE_SIZE) {
    crowd++;
  }
}
score -= crowd * 1.1;
```

`state.entities` is the whole world. It contains enemy units and structures in
fog, so a hidden tank inside that radius added `-1.1` to a candidate tile — a
strategic score driven by information the commander does not have. Physical
placement and the strategic score are separate stages, and only the second one
was reading unrestricted state.

## 2. Classification of every contributing category

The question is not "which entities exist" but "which of them may a commander
plan around". Using the Phase 12 model (`isKnownTo` = visible now, or a charted
structure):

| Entity category | Pre-Phase-13 | Shipped | Why |
| --- | --- | --- | --- |
| Own units and structures | counted | **counted** | the commander's own force is fully known |
| Allied units and structures | counted | **counted** | `teamOf(e.owner) === teamOf(aiId)`; the team shares vision, so this is the same information |
| Authored neutral objects (`owner < 0`) | counted | **counted** | map-authored garrisons and objectives are common knowledge; the HUD counts them for the player too |
| Visible enemy | counted | **counted** | legitimately observed |
| Charted enemy structure out of vision | counted | **counted** | a structure never moves, so its position is still true knowledge (Phase 12 `knownBlockage` rule) |
| Remembered **unit** contact, currently hidden | counted at the *stale* position | **not counted** | a contact is a 30 s old position; a tank that drove away must not keep its old tile reserved. Counting it would be exactly the "stale knowledge read as live occupancy" the phase forbids |
| Never-seen enemy unit or structure | **counted** | **not counted** | the defect |

The crowd *coefficient* (1.1), the radius (half a footprint + 3 tiles) and every
other score term are untouched.

## 3. Fixtures

Five fixtures were added to `tests/fog-integrity.test.ts` (13 in the file now):

| Fixture | What it isolates |
| --- | --- |
| `does not let unseen enemies choose the construction site` | two identical worlds, four enemy tanks added in a forest pocket in one; asserts the tanks are `isVisibleTo`/`isKnownTo`/`knownForCrowding` false **and** that the chosen site is identical |
| `still counts what the commander can see` | the same units, observed: the predicate is true, so visible enemies still influence a site |
| `classifies own, allied, neutral and remembered entities correctly` | own, allied team, authored neutral, never-seen enemy, unobserved unit contact |
| `keeps physical placement authoritative` | the chosen tile passes `placementStatus` in an AI-free twin of the same world; an unseen enemy tank still refuses a placement on its tile |
| `repeats the same site selection on an identical seed` | same site twice, and identical `stateHash()` after both runs |

Scenario: 64×64, seed 7, fog on, baltic on both sides, one engineer at `(42,20)`,
a forest pocket at `x 44–50, z 21–26`, and in the "dark" world four enemy tanks at
`(46,23) (48,23) (46,25) (48,25)` — close enough to the candidate tiles to be
inside the crowd radius, far enough from the engineer to stay unseen.

Result at the first construction site (tick 11):

| Arm | Clear world | Same world plus four unseen tanks |
| --- | --- | --- |
| Shipped gate | `factory@184,114` | `factory@184,114` |
| Pre-Phase-13 (counts everything) | `factory@184,114` | **`factory@168,114`** |

One tile of drift, produced by enemies that never appeared on the commander's
map. Removing the gate makes the first fixture fail; restoring it makes the
suite green — so the test is tied to the defect, not to the implementation.

## 4. The production change

One new function and one guarded loop iteration in `src/sim/ai.ts`:

```ts
export function knownForCrowding(game: Game, aiId: number, e: Entity): boolean {
  if (e.owner < 0) return true;
  if (e.owner === aiId) return true;
  const team = game.teamOf(aiId);
  if (game.teamOf(e.owner) === team) return true;
  // `isKnownTo` is the Phase 12 boundary itself: seen now, or a structure this
  // team has charted. Unit contacts are stale by design and stay excluded.
  return game.isKnownTo(team, e.id);
}
```

and in `findBuildSite`:

```ts
if (!knownForCrowding(ctx.game, ctx.aiId, e)) continue;
```

There is no second fog model: `knownForCrowding` calls the same
`visionStateOf`/`isKnownTo` path the renderer, `knownBlockage` and the capture
gate use. No state is added, nothing is serialised, and no option or setting was
introduced — this is not an experiment arm, it is the shipped AI.

## 5. How often it engages, and what it changes

A temporary counter (removed afterwards, not part of the tree) instrumented the
loop and ran the arena with the gate on and forced open. Two seeds × all 15
pairings × both seats = 60 matched configurations, each played twice at the
Phase 9/10/11/12 settings (600 s cap, repair suppression on):

| Measure | Value |
| --- | --- |
| Matched configurations | 60 |
| Site decisions (gated arm) | 770 |
| Hidden observations the gate skipped **inside** the crowd radius | 2 612 |
| Configurations whose site sequence differed | **4 / 60** (6.7%) |
| Configurations whose *outcome* differed | 2 / 60 |

So the term was not decorative — it moved one site decision in roughly one
match in fifteen, and the change ripples into economy and outcome from there.

### The one game that flipped, in full

`hungary (west) vs uk (east)`, seed 3690, personalities unrotated, 600 s cap.
Fifth construction decision, tick 2530 (126.5 s):

| Arm | Fifth site |
| --- | --- |
| Pre-Phase-13 (counts everything) | `refinery@14,28` |
| Shipped gate | `bunker@27,38` |

Hidden enemy units near `(27,38)` were pushing the score off that tile, and the
AI fell back to a refinery. With the leak removed the AI builds the bunker its
own knowledge actually prefers — and, in this arena, the cheaper defensive
structure costs it the economy that the accidental refinery had given it: west
score `12516` → `7997`, and `belarus vs hungary` turns from a 291.8 s decisive
loss into a 600 s `army-collapse` timeout.

That is the honest shape of this phase: **the leak was measurably steering a
strategic decision, and removing it made this one match worse.** A refinery being
a better buy than a bunker is a build-order design question; it is not a licence
to keep building on intuition gained from tanks the AI cannot see. The phase
deliberately does not touch build priorities, costs or the crowd coefficient.

## 6. Matched 540-match comparison

Identical arena, seeds, seats, personalities and settings as the Phase 12
baseline:

```bash
MCA_SEEDS=101,1078,2055,11,555,999,1234,2468,3690 \
  npx tsx tools/timeout-audit.ts 9 600 veteran > tmp/p13-540b.jsonl
# Phase 12 baseline: tmp/p12-540.jsonl (same seeds, same arguments)
python tmp/p13-compare.py tmp/p12-540.jsonl tmp/p13-540b.jsonl
```

All 540 configurations are present in both arms; 536 are bit-identical.

| Measure | Phase 12 | Phase 13 | Δ |
| --- | --- | --- | --- |
| Matches | 540 | 540 | — |
| Decisive | 402 (74.4%) | 401 (74.3%) | −1 (−0.19 pp) |
| Timeouts | 138 (25.6%) | 139 (25.7%) | +1 (+0.19 pp) |
| `army-collapse` | 87 (16.1%) | 90 (16.7%) | +3 (+0.56 pp) |
| `siege-out-repaired` | 23 (4.3%) | 21 (3.9%) | −2 (−0.37 pp) |
| `defensive-stalemate` | 18 | 18 | 0 |
| `artillery-standoff` | 4 | 4 | 0 |
| `targeting-or-pathfinding` | 1 | 1 | 0 |
| Mean decisive duration | 288.1 s | 288.1 s | 0.0 s |
| Refused orders | 2 688 | 2 693 | +5 |
| Refusals into a structure footprint | **391** | **391** | **0** |
| Assault waves | 756 | 755 | −1 |
| Units built | 18 713 | 18 703 | −10 |
| Materials gathered | 5 036 200 | 5 036 146 | −54 |
| Producers / refineries at end | 2 369 / 1 204 | 2 370 / 1 197 | +1 / −7 |
| Combat units at end | 2 862 | 2 849 | −13 |
| Static defences at end | 1 491 | 1 494 | +3 |
| Command-post damage dealt / repaired | 1 591 833 / 692 902 | 1 588 663 / 692 118 | −3 170 / −784 |

The footprint-refusal count is the Phase 11 acceptance number and it is
unchanged at 391, so the assault correction is intact.

### The four changed records

| Pairing | Seed | Seat swap | Phase 12 | Phase 13 |
| --- | --- | --- | --- | --- |
| `belarus vs hungary` | 3690 | yes | resolved 291.8 s | `army-collapse` 600.0 s |
| `russia vs hungary` | 3690 | yes | `siege-out-repaired` 600.0 s | `army-collapse` 600.0 s |
| `uk vs hungary` | 3690 | yes | `siege-out-repaired` 600.0 s | `army-collapse` 600.0 s |
| `lithuania vs hungary` | 1234 | no | resolved 222.8 s | resolved 220.8 s |

The first three are the **same game**: Hungary in the west seat against three
different opponents, all reaching the same state at the flipped site decision
(the Phase 12 baseline already reported identical scores for the `uk` and
`russia` records, so this duplication predates the phase). The effective
independent evidence for an outcome change is therefore **one** match, not three.

Re-running the spot configuration with the shipped tree reproduces the arm
bit-for-bit (`MCA_SEEDS=3690 npx tsx tools/timeout-audit.ts 1 600 veteran hungary,uk`:
all four records identical to `tmp/p13-540b.jsonl`), so the matrix is
deterministic and the differences are attributable to the gate, not to run noise.

## 7. Uncertainty

At record level the paired table is 3 discordant records in the timeout direction
and 0 in the other; treating the three duplicated records as one game leaves
1 discordant pair. Exact McNemar (binomial, two-sided): 3/0 → p = 0.25,
1/0 → p = 1.0. Neither is evidence of anything; the sample has no power to
resolve a difference of this size, and the direction happens to be slightly
unfavourable.

What can be claimed is narrower and stronger than a rate: **the mechanism is
identified.** A specific site decision in a specific configuration moves when the
gate is applied, and the aggregate shifts by at most one game. No claim is made
that the change improves match resolution — it was never expected to, and it
does not.

Limits worth stating:

- The counter run covered 2 seeds × 15 pairs × 2 seats. It measures how often the
  term matters, not a population rate.
- The national arena gives both AIs 600 ore per tile; shipped maps carry
  260–340. Build-site density near a base is similar, but the arena's short
  economy is not proof for long matches on a shipped map.
- The duplicated-record pattern is an arena artefact (nation-specific variants
  never reaching the field in those pairings), not something this phase caused or
  fixed.

## 8. Verification

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean |
| Fog fixtures | `npx vitest run tests/fog-integrity.test.ts` | 13 / 13 pass (5 new) |
| Full suite | `npx vitest run` | **42 files, 460 tests pass** |
| Difficulty contract | inside `tests/ai-matchups.test.ts` | Recruit–Veteran **−49 344** (4–12), Elite–Recruit **85 540** (15–1), Elite–Veteran **34 177** (11–5) — all identical to Phase 12 |
| Production build | `npm run build` | clean, `dist/assets/index-*.js` 459.57 kB (gzip 135.64 kB) |
| Determinism / save | inside `tests/determinism-save.test.ts` + the new determinism fixture | pass; no serialisation change |
| National rosters, legacy presets | `tests/national-specialisations.test.ts`, `tests/nation-setup.test.ts` | pass (6 nations) |
| 540-match matrix | `tools/timeout-audit.ts`, seeds above | 4 / 540 records changed, spot-check reproducible |

Pre-fix evidence: with the single `if (!knownForCrowding(...)) continue;` line
removed from `findBuildSite`, the hidden-enemy fixture fails
(`expected { defId: 'factory', x: 168 … } to equal { defId: 'factory', x: 184 … }`)
and the other 12 pass. With the line in place, all 13 pass — the fixture is
bound to the defect, not to a particular implementation.

## 9. Systems explicitly unchanged

Unit and building statistics, costs, production and construction times, economy
rates, difficulty profiles and weights, national and legacy rosters, the shared
roster resolver, repair suppression (`REPAIR_SUPPRESSION_TICKS = 20`), victory
conditions, the assault destination handling from Phase 11 (`canOrderMove`,
`groupApproach`, `aimIsOpen`, `formationPoints`), Phase 12's `knownBlockage` and
engineer capture gating, the diagnostic arena's 600-ore default and the shipped
maps' ore fields, save format and persistence, and the crowd coefficient, radius
and every other build-site score term.

## 10. Remaining risk and next step

The gate makes the strategic score a function of knowledge only, which is the
boundary the project has been converging on across Phases 12 and 13. What is left
is not a leak but a command: the flipped match shows the AI preferring a
defensive bunker where an economy building would have served it better. That is
build-order priority, a design question with its own measurement — least-cost
next step is a paired experiment on defensive-structure priority during the
expand phase, with the information boundary now fixed and held constant.
