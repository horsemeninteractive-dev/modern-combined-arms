# Phase 7 — Indirect-Fire Interaction and Match Resolution Audit

Status: **audit complete, no gameplay behaviour changed.**

Phase 6 reported that matches containing artillery timed out far more often
(42 %) than matches without (25 %), and that the overall rate had risen to 36 %.
This phase tests whether indirect fire is the cause of that, and what actually
keeps otherwise viable AI battles from reaching a decision.

The short answer: **artillery is a symptom and at most a contributor, not the
cause.** The dominant mechanism is that the command post is repaired faster than
an arriving force damages it, while both armies are consumed in the middle of
the map. One narrowly scoped AI change was implemented, measured and **reverted**
because it made match resolution worse. The details are below, including the
numbers that rejected it.

---

## 1. Baseline revision and reproduction

| | |
| --- | --- |
| Commit | `7989e5b` (`master`) plus the uncommitted Phase 1–6 working tree |
| Arena | shared 64×64 mirrored arena, posts 27 tiles apart, 600 materials per ore tile |
| Command | `npx tsx tools/nation-matchups.ts 5 600` |
| Seeds | 101, 1078, 2055, 3032, 4009 (the Phase 5/6 pool) |
| Matches | 300 national + 20 legacy control = 320, 229 s wall clock |
| Tool | `tools/nation-matchups.ts`, configuration unchanged |

The Phase 6 figures reproduce:

| Measure | Phase 6 report | This run |
| --- | --- | --- |
| Overall timeout rate | 36 % | **35.3 %** (106/300) |
| Timeout rate with a battery in the match | 42 % | **41.5 %** (81/195) |
| Timeout rate without a battery | 25 % | **23.8 %** (25/105) |
| Legacy control (`baltic` vs `expeditionary`) | — | 10/20 timeouts |

Artillery employment also holds: 195 of 300 matches (65 %) put at least one
battery on the field; 201 shared SPGs, 21 UK MLRS and 18 Russian heavy howitzers
were completed across 600 sides.

**Per-nation timeout rate (100 sides each):** Lithuania 46 %, Poland 37 %,
Belarus 37 %, UK 32 %, Russia 30 %, Hungary 30 %.

**Seat and personality (the standing confounders).** Of 194 decided matches the
east seat won 65.5 % (127–67); the 106 timeouts are held separately and never
counted as wins. Commander temperament matters as much as nation: across 600
sides, armour won 54–19, air 93–80, infantry 27–40 and economy 20–55. A single
matrix therefore cannot attribute an outcome to a national variant; every claim
below is either a mechanism measured inside a match or a comparison of two runs
of the same configuration.

A refactor landed in this phase: the arena, seed pool and score formula moved to
`tools/matchup-arena.ts` so the harness and the new diagnostics cannot drift.
The refactored harness reproduces the pre-refactor run exactly — all 64 seed-101
matches identical in winner, duration and both board scores.

---

## 2. Timeout classification rules

`tools/timeout-audit.ts` runs the same arena and commander pairing and samples
state every 10 ticks. A match that is still `playing` at the cap is a timeout and
gets every flag whose condition holds; a primary category is then picked by the
first matching rule, so overlapping evidence is preserved rather than discarded.

| Flag | Condition |
| --- | --- |
| `no-approach` | neither side ever had a combat unit within 20 tiles of the enemy post |
| `army-never-approached` | neither side brought an army (6+ units) within 14 tiles |
| `no-objective-damage` | no command post absorbed any damage |
| `hq-repaired-through` | a post absorbed ≥ 500 damage yet ends at ≥ 85 % health |
| `engineer-repairing` | an engineer spent ≥ 30 s of the match repairing the post |
| `defences` / `mutual-defences` | ≥ 3 / ≥ 2 per side completed weapon or garrison structures alive at the end |
| `artillery-present` / `artillery-firing` / `both-sides-artillery` | a battery existed / ≥ 10 indirect rounds were fired / both sides fired |
| `armies-alive-no-progress` | ≥ 10 combat units alive at the end and no post damage |
| `force-advantage-held` | one side ends ≥ 1.6× the other's force value with 8+ units |
| `quiet-last-minute` / `active-last-minute` | no / > 300 damage each side in the final minute |
| `both-banked` | both banks ≥ 800 materials at the end |
| `thin-economy` | both sides gathered < 6000 materials in total |
| `armies-gone` | both sides end with ≤ 2 combat units |
| `defend-without-base-threat` | a side spent > 50 % of the match in `defend` while enemies were within 15 tiles of its base < 15 % of the time |

Primary categories, in rule order: `army-collapse`, `no-approach`,
`targeting-or-pathfinding`, `siege-out-repaired`, `defensive-stalemate`,
`artillery-standoff`, `insufficient-siege`, `active-unresolved`,
`economic-stagnation`, `other`.

---

## 3. Baseline timeout distribution

`npx tsx tools/timeout-audit.ts 3 600` — 180 matches, seeds 101/1078/2055, 59
timeouts (32.8 %; lower than the matrix because it omits the legacy control and
runs three seeds rather than five).

| Category | Count | Share | with artillery | without |
| --- | --- | --- | --- | --- |
| `army-collapse` | 31 | 52.5 % | 22 | 9 |
| `siege-out-repaired` | 18 | 30.5 % | 17 | 1 |
| `other` (no approach, quiet end) | 8 | 13.6 % | 8 | 0 |
| `artillery-standoff` | 1 | 1.7 % | 1 | 0 |
| `defensive-stalemate` | 1 | 1.7 % | 1 | 0 |

Flags across those 59 timeouts: `hq-repaired-through` 36, `quiet-last-minute` 46,
`artillery-present` 49, `armies-gone` 31, `artillery-firing` 31, `defences` 30,
`engineer-repairing` 24, `no-objective-damage` 11, `both-sides-artillery` 6,
`mutual-defences` 6, `defend-without-base-threat` 4.

There is **no** timeout in this sample where artillery was firing across a
stand-off while both armies watched: that category is 1.7 %. The two real
patterns are mutually exhausted armies and a post that heals through a siege.

### Side-by-side (per-side means unless stated)

| | Decisive (121) | `army-collapse` (31) | `siege-out-repaired` (18) |
| --- | --- | --- | --- |
| Duration | 288 s | 600 s | 600 s |
| Materials gathered | 4551 | 5160 | 5175 |
| Materials banked at end | 132 | 75 | 84 |
| Units built | 15.1 | 19.2 | 20.2 |
| Units lost | 18.4 | 25.3 | 24.6 |
| Combat units alive at end | 3.0 | 0.7 | 1.9 |
| Committed waves | 0.6 | 0.6 | 1.3 |
| Post damage absorbed | 1791 | 1122 | 1879 |
| Post damage repaired | 691 | 1008 | **1848** |
| Post health at end (of 2200) | 1100 | 2086 | **2169** |
| Engineer repairing | 11 s | 14 s | 26 s |
| Enemy within 15 tiles of base | 103 s | 165 s | 189 s |
| Time in `defend` phase | 78 % | 52 % | 64 % |

A stalled match is not an idle one: the sides build, spend and lose *more* units
than in a decisive match. They simply cannot convert that activity into a dead
command post.

### 3.1 Independent replication — the artillery association does not survive

The same harness, the same arena and the same code, on a seed pool that was not
used in Phase 5 or 6 (`MCA_SEEDS=11,555,999`, 180 national matches, 134 s):

| | Phase 6 pool (seeds 101–4009) | Independent pool (11, 555, 999) |
| --- | --- | --- |
| Overall timeout rate | 35.3 % (106/300) | **27.8 %** (50/180) |
| Timeouts with a battery in the match | 41.5 % (81/195) | **23.5 %** (20/85) |
| Timeouts without a battery | 23.8 % (25/105) | **31.6 %** (30/95) |
| Matches with a battery | 65 % | 47 % |
| East seat share of decided matches | 65.5 % | 60.0 % |

**The sign reverses.** On the replicate seed set, matches containing artillery
timed out *less* often than matches without it. Two disjoint samples of the same
build therefore disagree on the direction of the effect, which is what a
confounded association looks like: a battery is bought by a commander with a
formed army, a quiet base and spare bank, so it tracks the shape of the match.
It is not what makes matches long. Per-nation timeout rates on the replicate:
Lithuania 25 %, Poland 30 %, UK 31.7 %, Russia 23.3 %, Belarus 26.7 %,
Hungary 30 %.

The *win-rate* association, unlike the timeout one, does replicate: sides that
built a battery won 57.5 % (42–31) of their decided matches here, against 47.1 %
(88–99) for sides without one — the Phase 6 pool read 54.5 % against 47.6 %. A
battery marks the stronger side in both samples; it does not make a match stall.

---

## 4. Controlled experiments

`npx tsx tools/indirect-fire-experiments.ts 8 600` — 16 matches per fixture over
an independent seed pool (131, 977, 1601, 2311, 3109, 4051, 5003, 6007), both
commander personalities on both sides, both sides playing the legacy presets so
no national variant is involved. The intervention is part of the scenario; no
game code differs between arms.

| Fixture | Timeouts | Decisive mean | Post damage absorbed (W/E) | Post damaged then standing | Shots |
| --- | --- | --- | --- | --- | --- |
| control | 1/16 (6.3 %) | 251 s | 1951 / 1160 | 0 | 173 |
| tanks-both (+2 MBT each) | 7/16 (43.8 %) | 291 s | 803 / 3034 | 3 | 288 |
| arty-both (+2 SPG each) | 4/16 (25.0 %) | 202 s | 2075 / 1660 | 3 | 616 |
| arty-vs-tank (W +2 SPG, E +2 MBT) | 5/16 (31.3 %) | 280 s | 2944 / 2052 | 4 | 398 |
| bunker-both (+1 bunker each) | 5/16 (31.3 %) | 262 s | 2141 / 511 | 1 | 240 |
| bunker-arty (+1 bunker, +1 SPG each) | 6/16 (37.5 %) | 239 s | 1839 / 3292 | 1 | 633 |

What the fixtures say:

- **Adding artillery is not what stalls a match.** Two free tanks per side
  produced *more* timeouts (7/16) than two free guns (4/16), and the artillery
  arm fired 2.3× as many rounds. Artillery's association with timeouts in the
  matrix is better explained by *when* it is bought (a quiet base, a formed army,
  a bank that can spare 620–760) than by what it does.
- **Equal-cost artillery versus armour is not a stalemate generator** in this
  fixture: the artillery side won the damage exchange (kills 29.4 vs 23.6, post
  damage 2944 vs 2052) and the match ended in 280 s on average.
- **A single extra bunker does not lengthen a match much** (5/16 against a
  control of 1/16, borderline at this sample size) and its own health barely
  moves: 6 of 16 west bunkers and 11 of 16 east bunkers survived, at a mean
  lowest health of 17 %/34 %. It is bypassed, not besieged.
- The fixtures are small-n and show the same large seat/personality variance as
  the matrix (e.g. `tanks-both` 803 vs 3034 post damage). They are used only to
  reject a claim, never to establish a win rate.

**Design limits.** No arm removes the AI's *ability* to build artillery: that
would mean running different AI code in the two arms, which is exactly the sort
of change this phase may not make. Availability was therefore varied in two
honest ways instead — by pre-placing (or not pre-placing) batteries in the
scenario, and by relying on the natural variation in the matrix, where a battery
appeared in 65 % of matches on one seed pool and 47 % on another. Experiment B
(introduction time) is covered only to the extent that pre-placed guns are
available from tick zero; a staged introduction would need a spawn hook that
does not exist in the public API, and was not built for this audit.

---

## 5. Indirect-fire implementation findings

Audited end to end: target visibility, minimum/maximum range, reload timing,
projectile flight and arc, accuracy and scatter, splash and falloff, structure
and armour multipliers, suppression, and legal targets.

**The implementation is correct.** A lobbed shell
(`game.ts` `tryFire`/`updateProjectiles`/`impact`):

- requires the target to be visible to the firing *team* (a spotter, not the gun);
- is refused while the hull is moving and while the target sits inside
  `minRange` (4 tiles shared, 6 MLRS, 5 heavy howitzer);
- lands where it was aimed with a scatter ball, so it does not track a moving
  target — splash does the work (`splash` 2.0 / 2.6 / 2.4 tiles, 55 % falloff);
- arcs over cover via `arc`, so line of sight is not required;
- damages structures through the normal armour multiplier, and cannot damage
  capture-only objectives;
- suppresses survivors;
- cannot damage friendly entities: the impact loop filters on `isAttackable`, which
  admits hostiles, plus a neutral shelter that is holding hostiles;
- clears its order when the ordered target dies, so a gun does not keep firing at
  a corpse. One bounded inefficiency exists: an artillery hull whose target
  closes inside its own minimum range holds position and waits rather than
  re-tasking itself, because the order is still valid. At a 91 % duty cycle this
  is not a material contributor to stalled matches.

**Duty cycle is not the problem.** Over the 60-match single-seed audit, 67 of 120
sides had at least one battery: 99.1 hull-minutes alive, 989 indirect rounds
fired — 9.98 rounds per hull-minute against a theoretical maximum of 10.9 for the
shared gun's 5.5 s reload, i.e. **91 % of the rate the weapon allows**. Hulls
spend 84 % of their time under an attack order. Tanks get killed and guns get
killed; they are not sitting idle.

**No variant escapes the ceiling.** Per-shot structure damage and sustained rate:
shared howitzer 72 × 1.35 = 97 every 5.5 s (**17.7 dps**), UK MLRS 42 × 1.15 = 48
every 3.2 s (**15.1 dps**, and 0.62 accuracy with a 2.6-tile scatter), Russian
heavy howitzer 105 × 1.45 = 152 every 7.5 s (**20.3 dps**). In the 300-match
matrix the UK completed 21 MLRS (38 kills) and Russia 18 heavy howitzers (67
kills) across 100 sides each; in the audit's single seed, the split of indirect
rounds fired was 703 shared, 197 rocket and 89 heavy. The heavy gun is the
closest to useful against a repaired post, and still lands at a quarter of the
repair rate on its own.

**The real ceiling is repair.** A 155 mm shell does 72 × 1.35 = 97 damage to a
structure and fires every 5.5 s: **17.7 dps**. An engineer restores
`0.035 × maxHp` per second with no material cost — **77 hp/s on a 2200 hp command
post**. One engineer therefore out-repairs four howitzers, or three tanks
(60 damage × 1.0 structure multiplier every 2.5 s = 24 dps each). Measured in the
18 `siege-out-repaired` matches: 1879 damage absorbed, 1848 repaired, post
finishing at 2169/2200. In the decisive matches the same test reads 1791 absorbed
and 691 repaired — the post fell because the engineer died or could not keep up,
not because more damage arrived.

Concentration at the objective is the second half of the arithmetic. Over the
audit, a side averages 9.2 combat units alive but only **3.5 ever stand within 12
tiles of the enemy post**, and 12 of 120 sides never get a single unit there.
Breaking a repaired post needs roughly four attackers firing at once; the AI's
typical arrival is one hull.

`Repairs should cost time and resources` is the stated design intent
(`Modern_Combined_Arms_RTS_GDD_v0.1.md`, §§ on infrastructure damage and
destruction). Engineer repair costs time only. That is a **balance/design
finding, not a code defect**, and this phase does not change it.

---

## 6. AI decision-path findings

- **Waves are effectively a one-shot mechanism.** Per side over 600 s: 25 of 120
  sides never committed a wave, 62 committed exactly one, and the mean is 1.3.
  `offensive()` returns to `defend` whenever any hostile is visible within 34
  tiles of the base, and `defend()` then claims every free unit for an individual
  attack order. On this arena the command posts are 27 tiles apart, so that
  radius reaches most of the enemy half: 59 % of samples have the nearest visible
  enemy more than 15 tiles from the base, yet the AI is in `defend` for 66 % of
  the match and treats every such contact as a base threat.
- **Units are alive and massed at home, not at the objective.** Mean peak force
  is 9.2 units per side, but the peak at the enemy post is 3.5.
- **Measured attempt, rejected.** Splitting "base under attack" (16 tiles) from
  "contact on the map" (34 tiles) so the army keeps massing was implemented and
  re-measured on the same 60 matches:

  | | Before | After |
  | --- | --- | --- |
  | Timeouts | 29/60 | **39/60** |
  | Committed waves per side | 1.3 | 8.1 |
  | Peak attackers at the enemy post | 3.5 | 5.8 |
  | Post damage absorbed per side | 1087 | **495** |
  | Post damage repaired per side | 507 | 77 |
  | Mean decisive duration | 330 s | 430 s |

  More waves and more attackers at the objective made matches *longer* and cut
  objective damage in half: the massed army now meets the enemy in the middle
  and is destroyed there, away from the post it was meant to break. The change
  was reverted. `src/sim/ai.ts` is back to its Phase 6 decision rules: the four
  uk/russia seed-101 matches reproduce their pre-change durations
  (307.1 / 450.9 / 600 / 345.9 s) exactly, and the full suite passes. This is a
  real negative result: the piecemeal defence is not what prevents resolution.

---

## 7. Hungary and the bunker

From the 300-match matrix, Hungary sides (100):

- placed a bunker in 87 sides, with 31 % timeouts, against 23 % for the 13 sides
  that did not (small control group);
- completed 140 bunkers in total, 75 still standing at the end;
- absorbed 20 925 damage across all bunkers — about 150 of 900 health each,
  confirming they are bypassed rather than fought;
- scored 109 kills across those 140 structures.

Timeout rate does not depend on whether the bunker lived: 30 % of sides whose
bunkers all died timed out, against 30 % where at least one survived. Hungary's
overall timeout rate (30 %) is below Lithuania's (46 %) in this configuration.
**The bunker is a bystander in stalled matches, not a driver**, and its statistics
were not touched.

---

## 8. Changes made

Gameplay or simulation: **none.**

| File | Change |
| --- | --- |
| `tools/matchup-arena.ts` | new; shared arena, seed pool, pair list, variant map and score formula |
| `tools/nation-matchups.ts` | imports the shared arena instead of holding a copy; output verified identical |
| `tools/timeout-audit.ts` | new; per-match timeout classification and objective/siege telemetry |
| `tools/indirect-fire-experiments.ts` | new; six controlled fixtures on the same arena |
| `docs/PHASE_7_INDIRECT_FIRE_AUDIT.md` | this report |
| `README.md` | links the Phase 7 report and the two new diagnostics |

`src/sim/ai.ts` was edited and then restored; `src/sim/game.ts`, the data files
and the save format were not touched. No test was modified.

---

## 9. Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 41 files / 439 tests passing |
| `npm run build` | succeeds (Vite production bundle + service worker) |
| `npx tsx tools/nation-matchups.ts 5 600` | 320 matches, 229 s, 35.3 % timeouts |
| `npx tsx tools/nation-matchups.ts 3 600` on independent seeds 11/555/999 | 180 national matches, 134 s, 27.8 % timeouts; artillery association **reverses** (§3.1) |
| `npx tsx tools/timeout-audit.ts 3 600` | 180 matches, 59 timeouts classified |
| `npx tsx tools/indirect-fire-experiments.ts 8 600` | 96 matches across six fixtures |
| Harness refactor equivalence | 64/64 seed-101 matches identical to the pre-refactor run |

Reproducibility: every command is deterministic for a given seed set; the audit
and harness print one JSON line per match, so a disputed number can be traced to
a single game. The tools stay out of the fast unit suite. This report's raw runs
are in `tmp/phase7/` (`baseline-matrix.jsonl`, `audit-1seed-v2/v3.jsonl`,
`audit-full-3seeds.jsonl`, `matrix-independent.jsonl`, `experiments.jsonl`);
the directory is git-ignored and every file is regenerated by the commands above.

---

## 10. Interpretation: artillery's role

Separating the three questions the phase set:

- **Is artillery causal?** No evidence for it, and the correlation itself does
  not replicate: on an independent seed pool the artillery-to-timeout association
  reverses (23.5 % with a battery against 31.6 % without). Adding and removing
  guns in controlled fixtures does not reproduce the timeout pattern either,
  artillery fires at 91 % of its possible rate while alive, and the timeout
  population contains almost no artillery stand-offs (1.7 %).
- **Is it contributory?** Yes, mildly and indirectly. It is the arm least able to
  beat structure repair (17.7 dps against 77 hp/s), it competes for the same bank
  as the armour that could, and a battery's hull life in these matches averages
  about a minute. Sides that build one win *more* of their decided matches in
  both pools (54.5 % vs 47.6 %, replicate 57.5 % vs 47.1 %), so it is not a
  losing purchase — it is a marker of a strong, rich commander rather than the
  thing that makes a match long.
- **Is it merely correlated?** Yes. The strongest predictor of a timeout in
  this sample is a command post that was damaged and healed: 36 of 59 timeouts
  show `hq-repaired-through`, 24 show an engineer actively repairing, and in the
  `siege-out-repaired` group 1848 of 1879 damage was undone. That condition is
  present in matches with and without a battery.

The mechanism the data supports is:

1. Both armies meet and mutually attrit (`army-collapse`, 52.5 %).
2. What survives rarely reaches the objective in enough strength (peak 3.5
   attackers against the ~4 needed to out-damage repair).
3. The defender's engineer restores the post for free at 77 hp/s, so any damage
   that does land is erased between attacks.
4. The match reaches the cap with both sides still producing and spending.

---

## 11. Unresolved questions

- **Engineer repair cost.** The GDD says repairs cost time and resources;
  structure repair currently costs neither. This is the single largest lever on
  the timeout population, but changing it is an economy/balance decision and was
  deliberately not taken here.
- **Whether repair should be reduced under fire** (a siege-pressure rule) rather
  than made expensive. Both are design choices with different side effects on
  players defending a base.
- **Why so few attackers reach the objective.** The audit measures the
  concentration gap but not its cause; the rejected experiment shows it is not
  simply the massing gate. Pathing losses, the attack-move engagement rule and
  the mid-map meeting are all still candidates.
- **Sample size for national claims.** 20 matches per pairing cannot separate a
  national variant from commander personality (economy commanders win 20 of 120
  decided matches). Any national balance conclusion needs a larger, stratified
  run.
- **Seat order.** Phase 6's `tools/seat-symmetry.ts` showed an identical duel is
  decided by entity creation order; the east seat wins 65.5 % (Phase 6 pool) and
  60.0 % (independent pool) of decided matches. This is a standing confounder for
  every mirrored comparison.
- **Seed-pool sensitivity.** The Phase 6 artillery/timeout association reversed
  on a second seed pool (23.5 % with a battery against 31.6 % without), so any
  headline rate from this harness must name its seed pool. Future comparisons
  should draw commanders from a fixed pool and stratify by temperament.

---

## 12. Recommended next phase

Ranked by evidence:

1. **Siege and repair interaction (design + implementation).** Decide what
   repairing a command post under fire should cost — materials, a rate penalty,
   or a cap — and implement it with a regression fixture. This is the one change
   the data says would move the timeout population, and it is a game-design
   decision before it is a code change.
2. **Objective concentration.** Investigate why attackers arrive at the enemy
   post one at a time (attack-move engagement, pathing attrition, wave timing)
   now that the massing gate has been shown not to be the cause.
3. **Larger stratified matchup run.** Raise the per-pairing sample and stratify
   by commander personality before any national balance claim.
4. **Seat-order symmetry.** Decide whether simultaneous damage resolution is
   worth the determinism work; until then, report seat splits with every result.

No national balance value, unit statistic or roster entry was changed, and no
new combat system was added.
