# Phase 15 — Economic Recovery and Defensive Priority Audit

**Verdict, two separate findings.**

1. **Economic recovery: a genuine deadlock existed and is fixed.** A base with no
   refinery, at least one hauler and less than the price of a replacement had
   *zero* income — the headquarters lifeline was withheld because the base "still
   had a hauler" — so it could never buy its way back. The lifeline now covers the
   real condition (no working drop-off, and none affordable), and production
   holds the bank for the drop-off instead of spending it on units. Recovery is
   measurable and linear: `(600 − bank)` seconds.
2. **Defensive priority: no defect, no change.** Across 120 controlled
   combinations the perimeter is requested exactly while the scouted report
   leaves an arm unanswered, and stops the moment it is answered.
   There is no runaway, and the economy resumes on the same sighting once the
   perimeter is complete. `defenceTargets`, `nextDefenceBuild` and every score are
   untouched.

## 1. Economic recovery — the state machine, as implemented

Income has exactly three sources: hauler round trips (require a refinery to tip
into), the headquarters lifeline (`matsPerSec: 1`, `matsPerSecBackstop`), and
captured depots (`supplyDepot`, 2/s). Ore in the ground is not income.

| State | Before this phase | Shipped |
| --- | --- | --- |
| Refinery standing | hauling income; lifeline off | unchanged |
| No refinery, **bank ≥ 600** | lifeline off; the essential refinery is ordered as soon as the engineer is free | unchanged |
| No refinery, bank < 600, **no hauler** | lifeline 1/s | unchanged |
| No refinery, bank < 600, **hauler alive** | **lifeline off. Income 0. Bank frozen. No legal path to a refinery** | lifeline 1/s, and production stops spending so the bank reaches the price |

The fourth row is the defect. It is not rare: **108 of the 1 080 diagnostic
sides** (540 matches × 2) end a match with zero refineries, live haulers and under
600 materials — and 43 of those have no ore left on the map either, so nothing
could have saved them. For the rest the state was strictly absorbing: the bank
was frozen and nothing in the simulation could ever raise it again.

### 1.1 Reproducing the deadlock

`tests/economic-recovery.test.ts`, frozen world: command post, factory, barracks,
engineer, two haulers, ore under the base, no refinery.

| Start bank | Arm | Result after 600 s |
| --- | --- | --- |
| 200 | Phase 14 baseline | `passiveMatsRate` **0**, bank stayed at 200, no refinery ordered |
| 200 | lifeline only (reserve disabled) | `passiveMatsRate` **1**, but the bank peaked at **400** and ended at **339**: three units (two riflemen, one ATGM team) were bought out of the trickle, and the 600 price was never reached in 600 s |
| 200 | shipped | bank climbed untouched and the refinery was ordered at **tick 8011 = 400.6 s** |

The middle row is why the phase needed two changes, not one: restoring income is
not the same as restoring recovery. The AI's saving formula
(`reserve = cost − bank`, so `budget = 2·bank − cost`) spends everything above
half the price, so a 1 mat/s trickle can never outrun a 130-material unit.
The bottom row is the shipped behaviour: with no drop-off in existence and none
under construction, production keeps the whole price back.

### 1.2 Recovery time is linear in the missing bank

Measured on the shipped tree, same fixture, starting bank varied:

| Start bank | Refinery ordered | Elapsed |
| --- | --- | --- |
| 0 | tick 12 011 | 600.6 s |
| 200 | tick 8 011 | 400.6 s |
| 400 | tick 4 011 | 200.6 s |

One mat per second, no spending in between. That is the whole of the lifeline —
it removes a trapdoor, it does not repair an economy quickly.

### 1.3 The two production changes

**(a) `src/sim/game.ts` — the lifeline's eligibility.**

```ts
const hauling =
  harvesters > 0 &&
  (refineries > 0 || (player?.mats ?? 0) >= REFINERY_REPLACEMENT_COST);
```

`REFINERY_REPLACEMENT_COST` is the cheapest `refinery` definition (600; it is the
only drop-off definition, and rosters substitute units, not buildings, so it
cannot drift). A hauler with no drop-off and no way to buy one is not a hauling
economy, so the backstop pays. The bank test is what keeps the
change invisible in ordinary play: an opening (3 000 materials) or a funded
rebuild is never subsidised. Refineries under construction count as standing, so
the trickle stops the moment one is being built.

**(b) `src/sim/ai.ts` — the recovery reserve.**

`manageConstruction` now asks `savingReserve(ctx, def)` instead of inlining
`cost − bank`. For every structure except the drop-off it returns the old
shortfall, so ordinary saving is untouched. For the drop-off, when the commander
has no refinery at all — `anyDropOff` counts a site under construction, so the
rule releases as soon as one is placed — it returns the **whole price**, so
`manageProduction` receives a budget of zero until the refinery is affordable.
Once the site exists the reserve reverts to the ordinary formula and the army
resumes.

No new state, no save change, no new option, no hidden information: the rule uses
only the commander's own buildings and bank.

### 1.4 One existing assertion updated

`tests/infrastructure.test.ts` asserted that a harvester with **no refinery**
replaces the lifeline. That is exactly the rule this phase identifies as the
defect, so the fixture now gives the hauler a real drop-off (preserving the
original intent, "a working hauler replaces the trickle") and adds an explicit
assertion that a stranded hauler keeps the lifeline.

### 1.5 A second, adjacent deadlock, documented and not fixed

The fixtures above keep an engineer alive. Remove it and start at bank 0, and a
different deadlock appears: `manageConstruction` returns early on
`!ctx.engineer`, so no reserve is applied, and production spends the trickle on
riflemen (130) and ATGM teams before the engineer's 240 is ever accumulated.
Measured over 800 s in that world (same map, two haulers, no refinery):

```
t0:   eng false ref false mats 0
…     (bank oscillates 0–200 the whole time, +1/s)
t800: eng false ref false mats 10   — 3 riflemen and 2 ATGM teams built
```

Nothing was ever bought that could restore income. The same world **with 600 in
the bank** recovers, so the state is bank-dependent, not absolute: the engineer is
bought at ~30 s (240), the lifeline keeps paying while the bank is under the
drop-off's price, and the refinery is placed at ~570 s once the reserve has
refilled it — the bank test in (a) keeping the trickle off throughout.

This is a *distinct* deadlock from the one the brief names: the refinery is not
the blocker, the missing engineer is. It is also common at the end of a lost game
— **111 of 1 080** diagnostic sides finish with neither a refinery nor an
engineer, and 101 of those matches still resolved rather than timing out, so the
state usually accompanies a decisive loss rather than a stalemate.

It is **not fixed here** because the smallest correction is a production reserve
for the engineer's price, and the AI has no *unit* reserve — `savingReserve`
holds for structures only. Adding one would pause unit production in every base
that loses its engineer, a broader behavioural change than this brief authorises
and one that would need the full matrix and difficulty ladder to clear. It is the
recommended next step in §6.

## 2. Defensive priority — the measured decision surface

`defenceTargets` asks for **two of the dominant scouted arm and one of the
other**; `nextDefenceBuild` returns the missing one, dominant first, and `null`
once both targets are met. The emplacement score is
`78 (core ready) + 38 (scouted) + 55 (threat) + 35 (damaged) + defence × 28 + jitter`,
against the refinery's `58 + economy × 30 + jitter`.

A **120-cell sweep** — 12 scouting reports × 5 standing perimeters × 2
economies (1 drop-off/2 haulers and 2/3) — run as
`tests/defence-priority.test.ts › holds the unmet-demand invariant across the
measured surface`, with a complete core, bank 2 000 and grid headroom so nothing
else competes. Every scouted unit is visible; no hidden entity is involved.

| Scouting report (infantry/armour) | Standing (turret/nest) | Unmet demand | Ordered |
| --- | --- | --- | --- |
| none, balanced, or tied (0/0, 1/1, 2/2, 3/3) | 1/1, 2/1, 1/2, 2/2 | none | refinery (83.9) or radar (55.1) |
| infantry leads (1/0, 2/1, 3/1, 5/0) | 1/1 | second nest | **nest (188.5)** |
| the same | 1/2 | none | refinery or radar |
| armour leads (0/1, 1/2, 1/3, 0/5) | 1/1 | second turret | **turret (188.5)** |
| the same | 2/1 | none | refinery or radar |
| any report, including none | 0/0 | the opening pair | atTurret, then mgNest |

All 120 cells agree with `nextDefenceBuild`: the choice is exactly the unmet
demand, and where the demand is met no emplacement is offered at all (it is not
merely outscored). The economic fallback is capacity-driven, not rule-driven:
the same satisfied cell orders the **refinery** where the haulers have saturated
one drop-off and the **radar** where they have not.

Score gap in the competing case, measured in Phase 14 (the sweep records orders,
not scores): **nest 188.5, refinery 83.9, radar 55.1** — a **104.6**-point margin,
the "approximately 105 points" the brief cites. The nest's total includes the
55-point threat bonus, because a scouted force in sight is also a threat:
`78 + 38 + 55 + defence × 28 + jitter`. The refinery is `58 + economy × 30`
plus jitter and the radar `34 + economy × 22` plus jitter, which is why the
emplacement wins by such a wide band rather than by a rounding margin.

### Answers to the brief's questions

1. **When does defence outrank economy?** Exactly when
   `nextDefenceBuild(mix, standing) != null` and the perimeter is unlocked
   (`coreReady || scouted || threat || damaged` — with a complete core this is
   always true). Concretely, a request exists while either arm's standing count is
   below its target: two for the arm that *leads* the scouted report, one
   otherwise. Because the fixtures start with the balanced opening pair (one
   turret, one nest), that reduces to: a report that leads in one arm asks for a
   second of that arm, and a report that does not lead asks for nothing — the rule
   is a proportional answer, not a blind "build defence" preference.
2. **Does it change when the requirement is met?** Yes — the option disappears
   entirely, and the same sighting then buys the economy building.
3. **Can it build emplacements without a change in threats?** No. The demand is
   capped at 2 + 1 by `defenceTargets`; five rifle squads against two nests and
   two turrets orders nothing defensive. It can add the *other* arm if scouting
   later flips, which is one bounded extra structure, not a loop.
4. **Is the refinery/hauler loop healthy under defence requests?** Yes. One
   drop-off with two haulers (saturated) offers the refinery at 83.9 beside the
   nest at 188.5; with the perimeter answered the refinery is built. Two drop-offs
   with three haulers do not offer a third, and the AI takes the radar instead.
5. **Rule or other differences?** The rule alone. Building type is decided in
   `buildOptions` before any site is scored, so Phase 13's site gate cannot
   influence it; the Phase 13 flip was a scouted-mix difference of one rifle squad
   (Phase 14), not a threshold in this score.

No change was made to `defenceTargets`, `nextDefenceBuild`, the emplacement score
or the refinery score.

## 3. Matched matrix comparison

Same arena, seeds, seats and personalities as Phase 13/14
(`MCA_SEEDS=101,1078,2055,11,555,999,1234,2468,3690 npx tsx tools/timeout-audit.ts 9 600 veteran`),
keyed on `(pair, seed, swapped, personalityRotated)`; 540 configurations in both
arms, none missing.

| Measure | Phase 13/14 | Phase 15 | Δ |
| --- | --- | --- | --- |
| Matches | 540 | 540 | — |
| Decisive | 401 (74.3%) | 397 (73.5%) | −4 |
| Timeouts | 139 (25.7%) | 143 (26.5%) | +4 |
| `army-collapse` | 90 | 91 | +1 |
| `siege-out-repaired` | 21 | 21 | 0 |
| `defensive-stalemate` / `artillery-standoff` / `targeting` | 18 / 4 / 1 | 18 / 4 / 1 | 0 |
| Mean decisive duration | 288.1 s | 287.9 s | −0.2 s |
| Refused orders | 2 693 | 2 760 | +67 |
| Refusals into a structure footprint | **391** | **391** | **0** |
| Units built | 18 703 | 18 743 | +40 |
| Materials gathered | 5 036 146 | 5 053 805 | +17 659 |
| Producers / refineries at end | 2 370 / 1 197 | 2 376 / 1 195 | +6 / −2 |
| Command-post damage dealt / repaired | 1 588 663 / 692 118 | 1 592 805 / 701 337 | +4 142 / +9 219 |

**424 records are byte-identical and 115 differ**; of those 115, **66 are within
±100 gathered materials** — a few seconds of trickle while a side stands between
drop-offs. Five records change category, in four configurations:

| Game | Phase 13/14 | Phase 15 | Losing side's endgame |
| --- | --- | --- | --- |
| seed 999, `poland vs uk` (swapped), `uk vs belarus`, `uk vs russia` — same numbers, 3 records | resolved 345.1 s, west 5 487 / east 10 825 | `other` timeout, west 7 428 / east 9 080 | **0 refineries, 2 haulers, 110 mats, ore exhausted** |
| `lithuania vs poland`, seed 3690, rotated | resolved 300.9 s, west 3 795 / east 11 640 | `siege-out-repaired` 600 s, west 4 886 / east 10 396 | 0 refineries, ore exhausted |
| `lithuania vs hungary`, seed 3690, rotated and swapped | `siege-out-repaired` 600 s, west 6 286 / east 10 170 | `army-collapse` 600 s, west 6 866 / east 9 540 | 0 refineries, ore exhausted |

Every one of the five is the deadlock state itself: the side that changes is the
one that ends with **no refinery, live haulers and no ore left to haul**, exactly
the state the fix addresses. The lifeline pays it 1 mat/s, so it lingers, builds a
few more units and reaches the cap instead of dying — in the seed-999 game west
gains 369 materials and three units and survives 255 s longer, while east keeps
its lead (9 080 to 7 428). None of these is a rescue, and none reverses a winner:
the arena's ore field (19 200, exhausted by ~300 s) means no refunded income can
actually be spent on a drop-off. No improvement is claimed from this matrix; a
1 mat/s perturbation in a chaotic simulation is not a clean instrument.

**The two changes, separated.** A lifeline-only arm (reserve disabled) was run on
the same 540 configurations (`tmp/p15-lifeline.jsonl`): it changes the same 115
records and the same 5 category records, but drifts the Phase 11 footprint-refusal
count to **390** and builds 7 more units. The shipped pair keeps 391 exactly. The
reserve's own matrix footprint is therefore negligible; its value is the recovery
fixture, where without it no refinery appears at all.

## 4. Verification

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean |
| Recovery fixtures | `npx vitest run tests/economic-recovery.test.ts` | 9 / 9 pass |
| Priority fixtures | `npx vitest run tests/defence-priority.test.ts` | 8 / 8 pass (incl. the 120-cell sweep) |
| Fog integrity | `npx vitest run tests/fog-integrity.test.ts` | 13 / 13 (Phase 12/13 intact) |
| Phase 13/14 site fixtures | `npx vitest run tests/construction-priority.test.ts` | 7 / 7 |
| Full suite | `npx vitest run` | **45 files, 484 tests pass** |
| Difficulty contract | inside `tests/ai-matchups.test.ts` | Recruit–Veteran **−49 003** (4–12), Elite–Recruit **85 330** (15–1), Elite–Veteran **35 527** (11–5) — all above the 15 000 floor |
| Production build | `npm run build` | clean |
| Determinism / save | `tests/determinism-save.test.ts` + new determinism fixtures | pass; no serialisation change |
| National rosters, legacy presets | `tests/national-specialisations.test.ts`, `tests/nation-setup.test.ts` | pass (6 nations) |

The Elite–Veteran margin moved from 34 177 to 35 527 on the same 16 duels; the
contract is unchanged and still satisfied with a wide margin.

## 5. Explicitly unchanged

Unit, building and weapon statistics; costs, build and production times; income
**rates** (the lifeline is still 1/s and depots 2/s — only its eligibility
changed); power values; difficulty weights; `defenceTargets`, `nextDefenceBuild`
and the emplacement score; national and legacy rosters; repair suppression;
`knownForCrowding` and the Phase 12/13 information boundary; assault-destination
handling; site scoring; victory conditions; the diagnostic arena's ore default;
save format and persistence.

### Files changed

| File | Change |
| --- | --- |
| `src/sim/game.ts` | `REFINERY_REPLACEMENT_COST`; the lifeline's `hauling` test now requires a working or affordable drop-off |
| `src/sim/ai.ts` | `savingReserve` — the drop-off's price is held back while no refinery exists; used by both saving paths in `manageConstruction` |
| `tests/economic-recovery.test.ts` | new, 9 fixtures (stranded hauler, funded rebuild, one surviving drop-off, loss during construction, determinism) |
| `tests/defence-priority.test.ts` | new, 8 fixtures (targets, demand, the 120-cell surface, determinism) |
| `tests/infrastructure.test.ts` | the lifeline fixture gains a real drop-off and an explicit stranded-hauler case |
| `docs/PHASE_15_ECONOMIC_RECOVERY_AND_DEFENCE_PRIORITY_AUDIT.md` | this report |
| `README.md` | links the two new fixtures and this report |

No change to `defenceTargets`, `nextDefenceBuild`, the emplacement/refinery
scores, `findBuildSite`, `knownForCrowding`, save serialisation or any data table.

## 6. Limitations and next step

- **Recovery latency is the whole story.** At 1 mat/s a side that loses its last
  drop-off with an empty bank needs ten minutes. The fix removes the absorbing
  state; it does not make the recovery competitive. A faster recovery would mean
  changing a rate, which this phase is not authorised to do.
- **The reserve has a real cost.** While the drop-off is missing, unit production
  is paused. The matrix shows no measurable aggregate difference either way, but
  a late-game loss of the only refinery now costs army production until the
  replacement is affordable.
- **A base with no refinery *and* no engineer is still deadlocked** (§1.5,
  tested): the headquarters can legally train an engineer (240) once no factory
  stands, but production has no unit reserve, so the trickle is spent on combat
  units and the price is never reached. Fixing it means a new mechanism, which
  this phase deliberately did not add.
- **The arena is not a clean instrument at this scale.** 115 of 540 records move
  by a few materials, and four configurations (five records) change category; the
  same chaotic amplification appeared in Phases 13 and 14. The defensible claims
  are the state machine, the recovery times and the unchanged priority surface —
  not win rates. The 600 s cap is also shorter than the recovery path the fix
  enables, so this arena cannot measure whether the fix helps a real economy.
- **The 108 deadlock-shaped end states were measured for incidence, not for
  recovery.** Measuring how many would rebuild inside a longer match needs a
  900 s+ arm; the fixture result `(600 − bank)` suggests few of the late ones
  would, since the arena's ore is already gone.

**Recommended next step:** one narrow phase on the §1.5 deadlock — give
production a reserve for the engineer's price while the commander has no engineer
at all, then re-run the same 540 configurations and the ladder. It is the same
"hold the bank for the thing that restores capability" principle already used for
the drop-off, applied to a unit instead of a structure, and it is the only
remaining state in which a base can be left with income it cannot turn into
recovery.
