# Phase 10 — Army-Collapse Timeout Diagnosis

Status: **audit complete, one AI defect found and deliberately not shipped.**

The question was why battles end with both armies consumed and no command post
destroyed. The answer is not one mechanism. In this arena:

1. **The test arena's ore field is exhausted in every army-collapse match** (62 of
   62), and the side's production probe then reads "Insufficient materials" on
   every side (124 of 124). Both sides keep their factories, refineries and
   harvesters; there is simply nothing left to mine.
2. **Both armies are annihilated to two units or fewer** in every such match
   (median 1 per side), after trading 27 losses and 30 kills each.
3. **The survivor is not ordered to finish the match.** In 38 of 62 matches
   exactly one side has zero combat units, and in 36 of those the other side's
   survivor is within 30 tiles of the enemy post — usually idle, and usually with
   the post undamaged for the final minute.
4. The reason it stays idle is the assault gate: the AI masses toward an army of
   6–9 and will not commit 1–2 units, and with the economy exhausted the army can
   never grow again.

A **separate, genuine defect** surfaced during the investigation: the AI orders
assault waves to the *centre* of a remembered structure, which is a blocked tile,
so `commandMove` refuses the whole order. A wave is announced, counted, and never
moves (3 206 refused move commands in 540 matches, 1 121 of them onto enemy
structures). It was fixed, measured, and **reverted**: the fix drops the
Elite-vs-Veteran difficulty margin from 38 931 to 11 523, below the ladder's
15 000 regression contract, and this phase is not allowed to retune AI difficulty
to compensate. The fix and its measurements are recorded below for the phase that
owns that ladder.

---

## 1. Baseline and configuration

| | |
| --- | --- |
| Commit | `7989e5b` (`master`) plus the uncommitted Phase 1–9 working tree |
| Arena | shared 64×64 mirrored arena, posts 27 tiles apart, 19 200 materials of ore in total (`ARENA_ORE = 600` per tile) |
| Scenario | `destroyHQ`, fog on, 3 000 materials / 180 requisition, dusk, veteran |
| Seeds | A: 101, 1078, 2055 · C: 11, 555, 999 · D: 1234, 2468, 3690 |
| Sample | 15 pairings × 2 seats × 2 commander temperaments × 3 seeds = **540 matches** |
| Command | `npx tsx tools/timeout-audit.ts 3 600 veteran` (per pool via `MCA_SEEDS`) |
| Repair rule | Phase 8 suppression **on and unchanged** in every arm |
| Fixtures | `npx tsx tools/collapse-fixtures.ts 120` |
| Economy experiment | `MCA_ARENA_ORE=1200` / `2400 npx tsx tools/timeout-audit.ts …` |

Baseline outcome, 540 matches:

| Measure | Value |
| --- | --- |
| Timeouts | 133 (24.6 %) |
| `army-collapse` | **62** (11.5 % of matches, 46.6 % of timeouts) |
| `siege-out-repaired` | 31 |
| `defensive-stalemate` | 10 |
| `artillery-standoff` | 5 |
| `other` | 25 |
| Decisive matches | 407, mean 290.1 s |
| East seat share of decided matches | 64.1 % (261–146) — the standing Phase 5–9 confounder, untouched |

The Phase 9 figures (133 timeouts of 540, 31 siege stalls) reproduce exactly, so
this phase's baseline is the shipped behaviour with no drift.

## 2. What `army-collapse` actually means

The classifier's primary rule is unchanged since Phase 7: a timeout is
`army-collapse` when both sides end with **two or fewer armed land/air units**
(`armies-gone`). Phase 10 added endgame telemetry rather than new categories:

| Field | Meaning |
| --- | --- |
| `endgame.combat`, `orders` | armed units alive and what they were doing |
| `harvesters`, `refineries`, `producers`, `queued` | whether the economy and production still existed |
| `blocked` | the reason `productionStatus` gives for each producer's own cheapest unit |
| `oreLeft`, `oreLeft/oreStart` | ore left in the ground |
| `nearestToEnemyHq` | tiles from the nearest survivor to the enemy post |
| `sinceUnitDamage`, `sinceEnemyHqDamage` | ticks since the last damage on each side |
| `moveFailures`, `moveFailuresOnStructure` | orders the command layer refused |

Validation against the 62 collapsed matches: 54 sides ended with 0 armed units, 39
with 1 and 31 with 2 — the category is exactly what its name says, not a bucket
for anything unexplained. Eight matches had **both** sides at zero; 38 had exactly
one side at zero; none had a side above 2.

## 3. The measured causes

### 3.1 Economic exhaustion is the enabling condition (62/62)

| Fact | Collapsed matches | Sides |
| --- | --- | --- |
| Ore left on the map: 0 | **62 of 62** | — |
| Production blocked by "Insufficient materials" | — | **124 of 124** |
| Producers alive | — | 124 of 124 |
| Refineries alive | — | 122 of 124 |
| Harvesters alive | — | 82 of 124 |
| Units queued at the end | — | 12 of 124 |
| Median bank / requisition | — | 41 mats / 783 req |
| Median gathered per side | — | 5 100 |
| Median units built / lost / killed per side | 21 / 27 / 30 | — |

This is not a production bug and not a targeting bug: every side still owned a
working producer, nearly all owned a refinery, and most owned harvesters. They
were simply out of ore, with requisition they could not spend because every unit
costs materials. In 55 of the 62 matches the loser of the last engagement had no
command-post damage in the final minute at all — the battle was already decided,
the objective simply could not be attacked.

### 3.2 The arena economy is smaller than the game's own maps

| Map | Ore in total |
| --- | --- |
| `rust-valley` | 49 400 |
| `kestrel-straits` | 59 600 |
| `foundry-district` | 33 760 |
| **matchup arena (600/tile)** | **19 200** |
| arena at `MCA_ARENA_ORE=1200` | 38 400 |
| arena at `MCA_ARENA_ORE=2400` | 76 800 |

At the default the arena holds **57 % of the smallest shipped map**, for two full
AI armies over ten minutes. Raising the diagnostic knob shows the consequence
directly (pool A, 180 matches per arm, everything else identical):

| Arena ore | Timeouts | `army-collapse` | `siege-out-repaired` | Decisive mean | Ore exhausted in timeouts |
| --- | --- | --- | --- | --- | --- |
| 600 (19 200) | 26 (14.4 %) | **10** | 11 | 285.7 s | 26 of 26 |
| 1 200 (38 400) | 7 (3.9 %) | **0** | 1 | 295.6 s | 6 of 7 |
| 2 400 (76 800) | 4 (2.2 %) | **0** | 2 | 275.3 s | 1 of 4 |

Pool D (the most attritional pool, 38.9 % timeouts at the default) keeps ten
`army-collapse` timeouts at 1 200 (10.0 % overall) — and all ten are matches whose
ore was still exhausted by 600 s, from ~10 400 materials gathered per side. More
ore reduces the category; it does not remove it from a pool that spends faster.

**Interpretation:** `army-collapse` is a *harness economy* phenomenon first and an
AI behaviour second. On maps with 33 760–59 600 ore the condition it represents
does not exist at the default arena's pace, which is why this phase does not
change gameplay to chase it.

### 3.3 The surviving force never commits

Every collapsed match ends with ≤2 armed units per side, so the AI's assault gate
is the only thing that could still produce an attack. Fixtures
(`tools/collapse-fixtures.ts`, 120 s, no ore, no bank, remembered enemy post,
undefended) show what it does:

| Force | Post damage | Ordered to the post | Result |
| --- | --- | --- | --- |
| 1 tank | 0 | no | `massing 1/6 units at base` |
| 2 tanks | 0 | no | `massing 2/6 units at base` |
| 3 tanks | 0 | no | `massing 3/6 units at base` |
| 4 tanks | 0 | no | `massing 4/6 units at base` |
| 6 tanks | 0 | no | `massing 6/7 units at base` |
| 3 tanks, 2 AT turrets | 0 | no | correct: the push would be suicide |
| 3 tanks, 1 defending tank | 0 | no | correct while outgunned |

In the audit's 62 collapsed matches this shows up as 55 of 124 sides whose only
surviving units are idle, and 33 matches where an idle survivor sits within 30
tiles of an enemy post that has 0–1 defending units and no engineer.

The gate is `max(3, round(desiredArmy × commitShare × aggression))`, with an
"overdue" escape hatch that still requires **four** ready units, and a home guard
of `reserve` units. With `desiredArmy` at 6–9 and 1–2 units alive, no branch can
fire. This is intended massing behaviour meeting an economy that can never
recover — a design trade-off, not a defect. It is also why a "last-ditch push"
rule is tempting and was **not** implemented: the condition it fixes does not
occur when the economy can still produce.

## 4. The defect that was found: phantom assault waves

### 4.1 Reproduction

`tmp/gate-debug.ts` (six tanks, remembered post, no economy) shows the AI
announcing waves while no unit ever receives an order:

```
86 phase build  wave 3 ... orders -,-,-,-,-,- x 122 | massing 6/7 units at base
90 phase assault wave 4 ... orders -,-,-,-,-,- x 122 | assault wave 4 with 6 units
92 phase build  wave 4 ... orders -,-,-,-,-,- x 122 | massing 6/7 units at base
```

The wave is aimed at `st.targetBaseX/Z`, which for a structure contact is the
structure's **centre tile**. `commandMove` cannot fit a formation onto a blocked
tile, so it refuses the group and emits:

```
orderFailed: No route to that location for the selected force.
```

The AI increments `attackWave`, writes an "assault wave" decision, and every unit
keeps `order === null`.

### 4.2 How common it is

Across the 540 baseline matches: **3 206** refused move commands, **1 121** of them
aimed inside an enemy structure footprint, in 127 of 180 matches of pool A alone.
It affects decisive matches too (it is not the army-collapse cause), but it means
a large share of the AI's announced offence never leaves the base.

### 4.3 The fix that was measured, and why it was not shipped

A narrow change was implemented: an `openDestination()` helper that backs a
destination out of any structure footprint along the line to the AI's base before
the wave and scout orders are issued. Measured against the untouched baseline on
the same seeds:

| Pool | Timeouts before → after | `army-collapse` | `siege-out-repaired` | Decisive mean | Peak attackers at the post | Structure refusals |
| --- | --- | --- | --- | --- | --- | --- |
| A (101/1078/2055) | 26 → 27 | 10 → 16 | 11 → 9 | 285.7 → 279.1 s | 3.65 → 3.95 | 333 → 117 |
| D (1234/2468/3690) | 62 → 46 | 31 → 21 | 7 → 10 | 300.0 → 289.8 s | 3.49 → 3.83 | — → 53 |

Paired by configuration: pool A 21 vs 22 discordant (p = 1.00), pool D 35 vs 19
(p = 0.040); pooled 88 → 73 timeouts. Fixtures with the fix: 4 and 6 tanks now
commit, reach the post and destroy it (2 200 damage) inside 120 s.

It was reverted because it breaks the difficulty ladder contract in
`tests/ai-matchups.test.ts`:

| Pairing (8 seeds, both seats) | Baseline | With the fix |
| --- | --- | --- |
| Recruit vs Veteran | −51 476 (4–12) | unchanged ordering |
| Elite vs Recruit | 63 375 (13–3) | unchanged ordering |
| **Elite vs Veteran** | **38 931 (12–4)** | **11 523** (contract: > 15 000, ≥ 9 wins) |

A change that cuts the Elite/Veteran separation by 70 % is a difficulty-tuning
change in its own right, and Phase 10 is explicitly not allowed to retune AI
priorities or balance to compensate. Shipping it would require either accepting a
weaker test or recalibrating the ladder — both are a separate, evidence-backed
decision about the difficulty ladder. The patch is kept at
`tmp/ai-phase10-open-dest.ts`; no gameplay code from this phase ships.

## 5. Seat and commander personality

| Slice | Matches | `army-collapse` | Any timeout |
| --- | --- | --- | --- |
| Personality seeds unrotated | 270 | 36 | 70 |
| Personality seeds rotated | 270 | 26 | 63 |
| Seeds 101 / 1078 / 2055 | 180 | 10 | 26 |
| Seeds 11 / 555 / 999 | 180 | 21 | 45 |
| Seeds 1234 / 2468 / 3690 | 180 | 31 | 62 |

Collapse is strongly seed-clustered (2 to 15 per 60-match seed block) — the
category reflects how a particular attrition spiral plays out, not a nation or a
commander trait. By pairing, the most affected are `poland vs uk` (8), `uk vs
russia` (7), `poland vs russia` (6) and `poland vs belarus` (6); none is
distinguishable from attrition luck at these counts. The east seat still wins
64.1 % of decided matches; this phase did not touch it and does not attribute
collapse to it.

## 6. What was implemented

**No gameplay, data, balance or save change ships from Phase 10.**

| File | Change |
| --- | --- |
| `tools/timeout-audit.ts` | endgame telemetry per side (economy, production status, orders, ore, distances, refused orders, last-damage clocks); `MCA_REPAIR_RULE=off` retained from Phase 9 |
| `tools/matchup-arena.ts` | `MCA_ARENA_ORE` diagnostic override, default unchanged at 600 |
| `tools/collapse-fixtures.ts` | new; the deterministic gate/assault fixtures in §3.3 and §4.1 |
| `README.md` | links this report, the fixture tool and the ore override |
| `src/sim/ai.ts` | **unchanged** — the `openDestination` patch was measured and reverted |

No test was weakened, removed or recalibrated; the full suite and the ladder pass
on the shipped tree.

## 7. Remaining uncertainties and next step

- **`army-collapse` cannot be read as a gameplay defect in this arena.** Its
  defining condition is ore exhaustion, which the default arena reaches while the
  shipped maps would not. Any future matchup matrix should either use an ore field
  within the shipped range or report this category separately as an arena
  artefact. Changing the default would invalidate Phase 5–9 comparisons, so it was
  not done here.
- **The wave defect is real and unfixed.** It is not the cause of army collapse,
  but it means announced waves often do not exist. The next phase should ship the
  `openDestination` fix together with a measured recalibration of the
  Elite/Veteran ladder, or with evidence that the ladder separation is preserved.
- **A last-ditch push rule remains unevaluated.** With 1–2 survivors and no
  income, a rule that commits them at an objectively defenceless post would
  convert some `army-collapse` timeouts into decisions. It was not implemented
  because the trigger only exists under an exhausted economy, and because it
  interacts with the same gate the difficulty ladder depends on. Test it against
  the ore-1 200 arm, where the trigger is rare, before shipping it.
- **Hungary, seats and personalities are unchanged** and remain balance-phase
  questions, not collapse causes.

Raw JSONL: `tmp/p10-base-{A,C,D}.jsonl`, `tmp/p10-ore1200-{A,D}.jsonl`,
`tmp/p10-ore2400-A.jsonl`, `tmp/p10-fix-{A,D}.jsonl`,
`tmp/p10-fixtures-shipped.jsonl`.
