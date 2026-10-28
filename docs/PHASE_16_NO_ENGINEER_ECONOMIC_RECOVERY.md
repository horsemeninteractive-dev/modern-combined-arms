# Phase 16 — No-Engineer Economic Recovery

**Verdict.** The deadlock is real and is fixed by a narrow unit-production reserve.
A commander with no engineer, and no working drop-off economy, now holds the
engineer's authoritative price (300) instead of spending the one-per-second
headquarters lifeline on riflemen. In the controlled fixture the engineer arrives
at **112.5 s** and the replacement refinery site is placed at **700.5 s**; without
the reserve the same world buys a rifleman at ~130 s and never accumulates the
price. The rule is gated on a *broken* economy (no completed drop-off, or no
hauler), so an ordinary engineer loss in a working base is untouched.

**What this does not do.** It does not turn the 111 end-of-loss sides from the
Phase 15 matrix into recoveries. Re-running that exact cohort shows **78 of 111
already acquired an engineer without any reserve**, at the same median time
(136.5 s), because those end states are snapshots of a losing side whose engineer
was killed late, not the strict bank-starved deadlock. With the fix, 79 acquire
one — a single side more, acquiring at 391.5 s with no site placed before the
match ended — and four match outcomes change. The
mechanism fixes the absorbing state the brief names; it is not a rescue for a
beaten army. That distinction is the main result of this phase.

---

## 1. Root cause

`desiredUnits()` asks for an engineer whenever none is alive, at priority **240**
— the highest unit demand in the table. That number is a *priority*, not a price.
It appears in the Phase 15 report as "the engineer's 240", which is how the
misreading started; the authoritative cost is `UNITS.engineer.cost.mats = 300`
(`src/data/units.ts`).

The spending path is what deadlocks:

1. `manageConstruction()` returns early on `!ctx.engineer` with the **whole bank**
   (`src/sim/ai.ts`, the `no engineer — scheduling replacement` branch). It cannot
   apply the Phase 15 drop-off reserve, because that reserve is keyed to a
   building the commander cannot place without an engineer.
2. `manageProduction()` sorts demands by priority and buys the **first affordable**
   one. The engineer is first, but at a bank below 300 it is skipped.
3. The headquarters lifeline pays 1 mat/s while hauling is impossible
   (`updatePassiveIncome`). It reaches a rifleman's 130 long before 300, so a
   rifleman is bought, the bank resets, and the price is never reached.

That is the absorbing state: no engineer → no construction → no drop-off → 1/s
income → cheaper units consume it → no engineer. The Phase 15 drop-off reserve
never runs, because it requires an engineer in the first place.

## 2. The chosen mechanism

One new private method, `engineerReserve(ctx)`, called at the top of
`manageProduction()`. It returns a number of materials to withhold, exactly like
`savingReserve()` does for structures.

**Trigger (all must hold)**

| Condition | Why |
| --- | --- |
| No live engineer (`ctx.engineer` absent) | There is no unit that can build. |
| No completed refinery **or** no live harvester | The economy is broken; with both, income buys the engineer in seconds and the army must not pause. |
| No engineer already in a production queue | A replacement is on its way; the reserve releases. |
| A completed facility can train the engineer | `productionEntries` + the command-post/factory fallback; no reserve if the capability is gone. |
| Requisition covers the engineer's `req` | A hold for a purchase that can never happen would freeze production forever. |

**Reserve**: the authoritative `UNITS[engineerId].cost.mats` (300), for the
roster-resolved engineer, not a constant. While `budget.mats < reserve`, production
returns without enqueuing anything, so the trickle accumulates. At 300 the demand
is already first and affordable, so the engineer is enqueued; the reserve's job is
only to protect the bank below that line.

**Release**: an engineer exists, is queued, no facility can train one, the req is
short, or the bank covers the price. Every condition is commander-local: own
units, own buildings, own bank, own roster. No map, enemy or hidden state is read.

**Interaction with the Phase 15 drop-off reserve**: mutually exclusive by
construction. The drop-off reserve runs only when an engineer exists; this one
runs only when none does. In sequence they are complementary: the engineer is
bought first, then the drop-off's 600 is held by the existing rule (test
`buys the engineer before the drop-off when both are missing`).

**No state, no schema.** The method is pure and reads the current tick's context;
nothing is serialised, so saves and replays are unaffected.

## 3. Baseline reproduction

The Phase 15 matrix (`tmp/p15-540.jsonl`) was replayed, not re-derived:

| Measure | Value |
| --- | --- |
| Sides (540 matches × 2) | 1 080 |
| No engineer **and** no refinery at end | **111** (matches the report) |
| …with at least one producer standing | **95** |
| …with ore left on the map | **69** |
| …with both | **62** |

So most of the 111 were not unable to build an engineer — they had a facility.
The deadlock is about *spending order*, not production capability.

**The discriminating fixture.** `tests/economic-recovery.test.ts › holds the bank
for a replacement engineer instead of buying combat units` starts with no
engineer, no refinery, two haulers, ore under the base, bank 0. At 150 s:

| Arm | Units built | Engineer | Bank |
| --- | --- | --- | --- |
| Pre-fix (reserve disabled, verified by a temporary one-line revert) | **1** (rifleman) | no | ~150 → 0 |
| Shipped | **0** | no | ~150, still saving |

Phase 15's historical 800 s run of the same world recorded three riflemen and two
ATGM teams, no engineer, bank 10 — the same failure at a longer horizon.

## 4. The shipped path, measured

`tmp/p16-trace.ts` (experiment-only, mirrors the fixture) with bank 200:

| Time | Bank | Engineer | Refinery | Units built |
| --- | --- | --- | --- | --- |
| 0 s | 200 | no | 0 | 0 |
| 100 s | 300 | no | 0 | 0 |
| 112.5 s | 0 | **yes** | 0 | 1 |
| 300 s | 200 | yes | 0 | 1 |
| 700 s | 600 | yes | 0 | 1 |
| 700.5 s | — | yes | site placed | 1 |
| 750 s | 450 | yes | **1** | **7** |

The engineer's 300 is spent at 112.5 s, the drop-off reserve then holds every
material until 600, the site is placed at 700.5 s, and hauling income resumes: six
more units are built in the following 50 s. Without the reserve the bank never
reaches 300 (§3) and none of this happens.

From a zero bank the same arithmetic gives the engineer at ~312 s and the
refinery at ~900 s, which is longer than the diagnostic arena's 600 s cap — one
reason the matrix cannot show the completed recovery.

## 5. The 111-side cohort, re-run

The exact 111 configurations were replayed with the Phase 15 seeds, seats and
personalities (`tmp/p16-cohort.json`), instrumented to count engineer acquisitions
and construction sites placed after one. The control arm disabled the reserve;
it reproduces the Phase 15 end states (0 engineers at end by definition, same mean
duration 272.7 s).

| Measure | No reserve | Shipped |
| --- | --- | --- |
| Sides that acquired an engineer at least once | 78 / 111 | **79 / 111** |
| Engineer acquisitions (total) | 103 | 107 |
| Median first acquisition | 136.5 s | 136.5 s |
| Sides placing a site after an acquisition | 25 | 25 |
| Sides with an engineer alive at end | 0 | **4** |
| Sides with a refinery at end | 0 | **3** |
| Mean match length | 272.7 s | 267.5 s |
| Matches changing winner/timeout | — | 4 / 111 |

The median acquisition time is unchanged, which is the important negative
result: these sides were **not** waiting on a bank-starved trickle. They lost an
engineer while still running an economy, bought another within ~2.3 minutes, and
then lost it again (or lost the match). The reserve changes only the subset whose
economy had already collapsed at the moment the engineer was missing.

The 16 sides that ended the baseline with no producer are not a separate
"ineligible" group either: all 16 acquired at least one engineer during the
re-run. "No producer at end" is a snapshot of a beaten base, not a permanent
capability loss.

## 6. Matched 540-match diagnostic

Same arena, seeds, seats and personalities as Phases 13–15:

`MCA_SEEDS=101,1078,2055,11,555,999,1234,2468,3690 npx tsx tools/timeout-audit.ts 9 600 veteran`

| Measure | Phase 15 | Phase 16 | Δ |
| --- | --- | --- | --- |
| Matches | 540 | 540 | — |
| Decisive | 397 | 403 | +6 |
| Timeouts | 143 | 137 | −6 |
| `army-collapse` | 91 | 84 | −7 |
| `siege-out-repaired` | 21 | 21 | 0 |
| `defensive-stalemate` | 18 | 18 | 0 |
| `artillery-standoff` | 4 | 4 | 0 |
| `other` / `targeting` | 8 / 1 | 9 / 1 | +1 / 0 |
| Mean decisive duration | 287.9 s | 289.3 s | +1.4 s |
| Refused orders | 2 760 | 2 676 | −84 |
| Refusals into a structure footprint | 391 | **390** | **−1** |
| Units built | 18 743 | 18 600 | −143 |
| Materials gathered | 5 053 805 | 5 053 215 | −590 |
| Producers / refineries at end | 2 376 / 1 195 | 2 368 / 1 197 | −8 / +2 |
| Command-post damage dealt / repaired | 1 592 805 / 701 337 | 1 604 425 / 707 841 | +11 620 / +6 504 |
| Sides with no engineer and no refinery at end | **111** | **104** | **−7** |

**493 of 540 records are byte-identical (91.3%); 47 differ, and 11 timeout
categories move.** The assault-destination code is untouched and the
structure-footprint refusal count is **390 against the baseline 391** — the same
one-refusal offset Phase 15 measured in its lifeline-only arm, not a new drift.
The earlier draft of this rule (holding for the engineer whenever it was missing,
not only when the economy was broken) moved the same count to 403; narrowing the
trigger removed that divergence. The remaining 47 records change because a few
seconds of production timing reshape which waves form and where they go.

The six fewer timeouts and seven fewer stranded end states are the aggregate of
the same small subset; they are **not** claimed as a win-rate improvement. The
matrix's ore field is exhausted around 300 s, so no refunded income can be spent
on a drop-off in most of these games.

## 7. Verification

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | clean |
| Recovery fixtures | `npx vitest run tests/economic-recovery.test.ts` | **18 / 18** |
| Full suite | `npx vitest run` | **45 files, 493 tests** pass |
| Production build | `npm run build` | clean (460.48 kB JS, 135.90 kB gzip; +0.09 kB) |
| Difficulty contract | in `tests/ai-matchups.test.ts` | Recruit–Veteran **−50 005** (4–12), Elite–Recruit **86 251** (15–1), Elite–Veteran **36 531** (11–5); all thresholds met |
| Determinism | new fixture + existing | identical bank series, acquisition tick and `stateHash()` |
| Save / replay | unchanged | no new fields; `SaveGame` untouched |
| National rosters / presets | full suite | pass (six nations, legacy presets) |

The Elite–Veteran margin moved from 35 527 (Phase 15) to 36 531; the contract
(`> 15 000`, ≥ 9 wins) is satisfied with the same 11–5 record. The other two
contracts also improved slightly.

New regression coverage in `tests/economic-recovery.test.ts`:

1. holds the bank instead of buying combat units (the deadlock);
2. buys the engineer and restarts construction from the saved bank;
3. buys the engineer before the drop-off when both are missing;
4. releases the reserve as soon as the engineer is queued;
5. does not reserve while an engineer is standing;
6. holds when a completed drop-off has no hauler;
7. leaves a working economy alone (drop-off + hauler: production continues);
8. does not freeze when no facility can train an engineer;
9. deterministic engineer recovery (two identical runs).

## 8. Explicitly unchanged

Unit, building and weapon statistics; costs and build times (the 300 used by the
reserve is read from the unit table); income rates and the lifeline eligibility;
power; difficulty weights and profiles; `defenceTargets`, `nextDefenceBuild` and
every construction score; `savingReserve` and the Phase 15 drop-off rule;
`findBuildSite` and `knownForCrowding`; Phase 12 fog boundaries; Phase 11 assault
destinations; repair suppression; victory conditions; the diagnostic arena's ore
default; national and legacy rosters; save format; the renderer.

## 9. Remaining limitations and next step

- **The rule cannot outrun a lost game.** At 1 mat/s, a base at zero needs ~300 s
  for the engineer and ~600 s more for the drop-off. The fixture shows the path
  works; the arena's 600 s cap and exhausted ore mean most of the 111 diagnose a
  defeat, not a recoverable economy.
- **The 111 were misread as one cohort.** 78 of them bought an engineer without
  help. The true deadlock is narrower: no engineer *and* no working drop-off
  economy (no drop-off, no hauler, or a stalled site). Only that subset changes.
- **Ore exhaustion is not detected.** A base with a completed drop-off, a hauler
  and no ore left still looks "working" to this rule (and produces 0/s). Closing
  that needs a hauler-idle signal, which is a larger perception change than this
  phase authorises.
- **Reserve cost is real.** In the strict deadlock, every combat unit is delayed
  until the engineer is bought. That is the intended trade, and it only applies
  while the economy is broken.
- **Footprint refusals are 390, not 391.** Effectively intact (Phase 15's own
  lifeline-only arm also recorded 390), but not byte-identical. The assault code
  is untouched; a one-record difference in a chaotic metric is the honest
  description.

**Next step:** if the remaining absorbing state matters, the honest target is the
ore-exhausted hauler — a local "my haulers have nothing to do" signal feeding the
same reserve, not a broader economy rewrite.
