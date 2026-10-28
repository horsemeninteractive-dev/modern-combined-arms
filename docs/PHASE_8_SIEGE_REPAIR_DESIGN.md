# Phase 8 — Siege, Repair and Objective Resolution Design Pass

Status: **one narrow rule implemented and measured** (Outcome A). Repair now makes
no progress while the structure it is working on has been hit within the last
second. Nothing else changed: no weapon, cost, health, roster, AI-difficulty or
save-format value was touched, and the Phase 7 AI massing experiment remains
reverted.

The short version: engineer repair was not implemented incorrectly — it did
exactly what it said, free, at 3.5 % of maximum HP per engineer per second. That
rate simply exceeded what the AI could deliver to a command post, so a single
engineer out-repaired two tanks indefinitely. Suppression under fire turns repair
into work that has to be won back between bombardments instead of a permanent
immunity, and it is the only one of the four candidate rules that improved siege
resolution without coupling defence to the bank balance or requiring a new AI
budgeting model.

What it does **not** do is settle match resolution. It halves timeouts on the
Phase 7 seed pool and barely moves them on an independent pool whose stalls are
mostly army collapse. The mechanic is measured and shipped; the claim that it
cures stalled matches is not, and §6.4 says so with the numbers.

| Arm (180 audited matches each) | Timeouts | Rate | `siege-out-repaired` | `army-collapse` |
| --- | --- | --- | --- | --- |
| Phase 7 historical tree (pre-change) | 59 | 32.8 % | 18 | 31 |
| Reconstructed pre-change repair, current tree | 50 | 27.8 % | 22 | 20 |
| Shipped (repair suspended under fire) | **26** | **14.4 %** | **11** | **10** |

---

## 1. Baseline revision and working-tree state

| | |
| --- | --- |
| Commit | `7989e5b` (`master`) plus the uncommitted Phase 1–7 working tree |
| Arena | shared 64×64 mirrored arena, posts 27 tiles apart, 600 materials per ore tile (`tools/matchup-arena.ts`) |
| Scenario | `destroyHQ`, fog on, 3 000 materials / 180 requisition, dusk, veteran AI |
| Seeds | 101, 1078, 2055 (the Phase 7 audit slice of the Phase 5/6 pool) |
| Replication seeds | 11, 555, 999 (`MCA_SEEDS`, the Phase 7 independent pool) |
| Audit command | `npx tsx tools/timeout-audit.ts 3 600 veteran` |
| Audit sample | 15 pairings × 2 seat assignments × 2 commander temperaments × 3 seeds = 180 matches per arm |
| Duel command | `npx tsx tools/siege-duels.ts 180` |
| Duel sample | 48×48 fixture, seed 909, 64 duels (control / cost / cap, 0–2 engineers, 9 attacker sets), one post, no AI |

Before editing, `npx tsc --noEmit` passed and the focused repair, determinism and
AI-employment tests were green. The Phase 7 report, the Phase 5/6 reports, the
repair/medic tests, the AI employment tests and the shared arena were read as the
baseline; every number below was re-measured on the current tree rather than
copied from Phase 7.

The tree contained no unrelated uncommitted work beyond the phases themselves;
`tmp/` diagnostics were left as scratch and are not part of the change.

---

## 2. The rules as implemented (verified, not assumed)

| Rule | Implementation | Verified by |
| --- | --- | --- |
| Repair rate | `ENGINEER_REPAIR_RATE = 0.035` × the target's **maximum** HP per engineer per second, applied per tick at `dt = 1/20` | `src/sim/game.ts` repair branch; 77 HP/s on the 2 200 HP Command Post |
| Cost | **Free.** No materials, requisition or time cost beyond the engineer's attention | duel arm `control` reports `spend = 0` for every attacker set |
| Engineer count | Additive: every engineer within range adds a full 3.5 %/s; no cap, no diminishing returns | 2-engineer duels repair up to twice as fast (1 tank: 3 553 HP in 180 s against 3 507 for one engineer, both capped by the post's health) |
| Eligibility | Owned, completed, alive, damaged building; the order is cleared when the target reaches full HP or dies | `repair-medic.test.ts` |
| Range | 5 tiles from the structure (shared with construction approach) | `ENGINEER_WORK_RANGE` |
| Interruption | **New rule.** No progress on a tick where `tick − lastHitTick < 20` (one second). The order is retained, so work resumes by itself | `repair-medic.test.ts` "makes no progress while the structure is under fire, then resumes" |
| Multiple targets | Each engineer works one structure; several engineers on one structure stack | duel arms |
| Objective rule | `destroyHQ`: a match is decided when a command post reaches 0 HP; no timer in the arena (600 s cap only for measurement) | `tools/matchup-arena.ts` |
| AI repair | Sends one engineer to the worst-damaged structure below threshold, now only when that structure has been quiet for a second, otherwise it builds or repairs elsewhere | `ai-employment.test.ts` "does not park the engineer on a structure that is being shelled" |

The arithmetic Phase 7 quoted is confirmed: one engineer = 77 HP/s on the
command post, two = 154 HP/s, and 72 × 1.35 = 97 damage per 155 mm shell, so
**one engineer out-repaired four howitzers** before this phase.

---

## 3. Design goals and success criteria

| # | Goal | Testable criterion used here |
| --- | --- | --- |
| 1 | Defence remains meaningful | A lone engineer still saves the post from a single attacker, and from two with intermittent fire |
| 2 | Sieges remain resolvable | A committed force of three or more direct-fire attackers breaks a repaired post inside a few minutes |
| 3 | Attacker commitment matters | One or two attackers must fail; four or more must succeed quickly, without scripted micro |
| 4 | Repair has a limit that is understandable | The limit must be visible in play and in the UI, not a hidden penalty |
| 5 | Army collapse stays distinguishable | The share of timeouts classified `army-collapse` must not be converted into `siege-out-repaired`; decisive outcomes must not be manufactured |
| 6 | Human and AI compatible | No personality-specific branch; the same engine rule applies to both seats and to scripted orders |
| 7 | Determinism and saves | `stateHash` covers the new input; replay and round-trip tests stay green |

Not every timeout is a defect. `army-collapse` (both armies consumed, nothing
left to push) and `active-unresolved` are legitimate outcomes of two cautious
commanders; the undesirable one is `siege-out-repaired`, where a post absorbs
real damage and ends near full health.

---

## 4. Alternatives evaluated

| Arm | Rule | Player experience | Evidence | Verdict |
| --- | --- | --- | --- | --- |
| A. Control | Shipped pre-Phase-8: free, unconditional, additive | A single engineer makes a post immortal against anything the AI actually sends | 1 tank: post ends at 97 %, 3 507 HP repaired; 2 tanks: 93 %, 6 639 repaired | Baseline |
| B. Economic cost | Every repaired HP billed at the recovery vehicle's 0.45 M/HP | Defending drains the bank; late-game repair becomes a real economic decision | At a 3 000 bank: **identical outcomes to control in all 12 comparable duels** (spend 1 578–3 084). At an 800 bank: every repaired post in the marginal band falls, and even one tank grinds a post to 46 % | Rejected for this phase: it does not change the tactical threshold unless the bank is empty, and it requires AI material budgeting that does not exist |
| C. Suppression under fire | No repair progress on a tick that follows a hit within one second | Repair becomes work between bombardments; sustained fire suppresses it. Visible in the selection card | 3 tanks break a lone engineer in 92.5 s; 2 nearly do (93 % after 180 s); 1 cannot | **Selected** |
| D. Throughput cap | Only one engineer's worth of repair per structure per tick | Stacking engineers stops being a cheap immunity | With 2 engineers the cap changes almost nothing: 1 tank 98 % vs 99 %, 2 tanks 96 % vs 97 %, 3 tanks 3 % vs 6 %, 2 SPG 94 % vs 97 %. Where it does bite (2 tanks + 2 SPG) it is dominated by suppression anyway | Deferred: a 77 HP/s floor is still above most attacker groups, so the cap treats the symptom |
| E. Keep repair, fix attack commitment | No repair change; make the AI mass and push | — | Phase 7 implemented the massing split and it made resolution **worse** (29 → 39 timeouts of 60, objective damage halved) and was reverted | Rejected unless new evidence appears |

Candidate B and D were measured by imposing the rule from outside the simulation
(`tools/siege-duels.ts`, `tools/timeout-audit.ts`) so that no production code had
to change while they were compared. Rollback is an approximation: it can only
remove progress the engine granted, so it measures the ceiling each rule would
impose, not its exact implementation.

---

## 5. Controlled duels (no AI, deterministic, seed 909)

One command post (2 200 HP) with N engineers, one stated attacker set, 180 s cap.
Destruction time is the first tick at 0 HP; "alive" means the post survived the
cap.

### 5.1 One engineer, shipped rule

| Attackers | Post | Time | Damage absorbed | Repaired |
| --- | --- | --- | --- | --- |
| 1 tank | alive, 97 % | — | 3 567 | 3 507 |
| 2 tanks | alive, 93 % | — | 6 787 | 6 639 |
| 3 tanks | destroyed | 92.5 s | 5 422 | 3 222 |
| 4 tanks | destroyed | 41.0 s | 2 200 | 0 |
| 6 tanks | destroyed | 25.8 s | 2 200 | 0 |
| 2 SPG | alive, 94 % | — | 5 196 | 5 067 |
| 2 MLRS | destroyed | 114.3 s | 2 563 | 363 |
| 2 heavy howitzers | destroyed | 106.3 s | 3 555 | 1 355 |
| 2 tanks + 2 SPG | destroyed | 39.5 s | 2 550 | 350 |
| 4 tanks, no engineer | destroyed | 39.6 s | 2 200 | 0 |

A single tank's reload leaves gaps longer than the one-second suppression
window, so the crew works between shots — the post survives but never fully
recovers (97 %). Three tanks firing out of phase keep the site suppressed, and
the post falls. Indirect batteries follow the same logic: two SPG could not
suppress a lone engineer at all (94 % after 180 s), while two MLRS (114.3 s) and
two heavy howitzers (106.3 s) could.

### 5.2 Two engineers: the marginal band (control vs cap vs cost @ 800 bank)

| Attackers | Control | Cap | Cost @ 800 |
| --- | --- | --- | --- |
| 1 tank | alive 99 % | alive 98 % | alive 46 % |
| 2 tanks | alive 97 % | alive 96 % | destroyed 112.5 s |
| 3 tanks | alive 6 % (near-fall) | alive 3 % | destroyed 71.7 s |
| 2 SPG | alive 97 % | alive 94 % | destroyed 156 s |
| 2 MLRS | alive 56 % | alive 56 % | alive 7 % |
| 2 tanks + 2 SPG | destroyed 161.5 s | destroyed 67.2 s | destroyed 61.5 s |

Two engineer stacks remain the strongest defensive play under the shipped rule;
that is a known, deliberate limitation (see §8).

---

## 6. Full AI matches

### 6.1 Timeout population

`npx tsx tools/timeout-audit.ts 3 600 veteran`, 180 matches per arm, same seeds,
pairings, seats and temperaments.

| Measure | Phase 7 (pre-change tree) | Reconstructed pre-change repair | Shipped |
| --- | --- | --- | --- |
| Matches | 180 | 180 | 180 |
| Timeouts | 59 (32.8 %) | 50 (27.8 %) | **26 (14.4 %)** |
| Decisive mean duration | — | 291.3 s | 285.7 s |
| `siege-out-repaired` | 18 (30.5 %) | 22 (44.0 %) | **11 (42.3 %)** |
| `army-collapse` | 31 | 20 (40.0 %) | **10 (38.5 %)** |
| `defensive-stalemate` | — | 4 | 2 |
| `artillery-standoff` | — | 1 | 1 |
| `other` | — | 3 | 2 |
| HP repaired into command posts, all 360 sides | — | 356 086 | **188 733** |
| Repair as a share of all post damage absorbed | — | 35.2 % | **26.0 %** |

The reconstructed arm runs the current tree with the engine's quantified repair
restored on suppressed ticks (the audit's `MCA_REPAIR_RULE=legacy`): the engine
withholds exactly `maxHp × 0.035 × dt` per assigned engineer on those ticks, so
adding that amount back reproduces the old repair volume. It is not a byte-exact
replay of the pre-Phase-8 tree — the co-shipped AI employment change is still
active and the restoration lands after the tick instead of inside it — so it is
reported as an arm, not as the historical baseline. The 59 → 50 gap is therefore
not attributed to the engine rule alone.

Two things follow from the table:

1. **The engine rule is the effective change.** Holding the tree constant, repair
   suppression cuts timeouts from 50 to 26 of 180 and halves the number of posts
   that are repaired through an actual bombardment (22 → 11).
2. **The stall type did not simply get relabelled.** `army-collapse` fell by the
   same absolute amount (20 → 10), and decisive matches finish slightly faster,
   which is what goal 5 requires. Timeouts are still 14 % of matches, and 11 of
   those 26 are still siege-out-repaired — the rule reduces the ceiling, it does
   not make a post indestructible.

### 6.2 Per-nation timeout rate (60 sides each)

| Nation | Reconstructed pre-change repair | Shipped |
| --- | --- | --- |
| Lithuania | 31.7 % | **10.0 %** |
| Poland | 25.0 % | **13.3 %** |
| United Kingdom | 23.3 % | **16.7 %** |
| Russia | 26.7 % | **16.7 %** |
| Belarus | 20.0 % | **10.0 %** |
| Hungary | 40.0 % | **20.0 %** |

Every nation improves. Hungary still leads, but its stall rate halves without
touching the bunker, which matches Phase 7's finding that the bunker is a
bystander rather than a driver.

### 6.3 Artillery employment is preserved

| Nation (60 sides) | Reconstructed | Shipped |
| --- | --- | --- |
| Lithuania | 70.0 % | 75.0 % |
| Poland | 41.7 % | 41.7 % |
| United Kingdom | 26.7 % | 30.0 % |
| Russia | 20.0 % | 21.7 % |
| Belarus | 30.0 % | 28.3 % |
| Hungary | 48.3 % | 40.0 % |

The Phase 6 employment gains are intact and, if anything, slightly stronger for
the UK and Russia, so the lower timeout rate is not the old "the AI stopped
building artillery" artefact.

### 6.4 Replication on independent seeds

`MCA_SEEDS=11,555,999`, same 180-match configuration, both arms:

| Arm | Timeouts | Rate | `siege-out-repaired` | `army-collapse` | Post repair share |
| --- | --- | --- | --- | --- | --- |
| Reconstructed pre-change repair | 52 | 28.9 % | 11 | 27 | 31.1 % |
| Shipped | 45 | **25.0 %** | 13 | 21 | **23.4 %** |

**The timeout improvement does not replicate on this pool.** The rule still does
what it is designed to do — repair falls from 31.1 % to 23.4 % of post damage
absorbed — but the timeout rate moves only 28.9 % → 25.0 %, and
`siege-out-repaired` does not fall at all (11 → 13). This pool's stalls are
dominated by `army-collapse` (27 and 21 of the timeouts), which no repair rule
addresses.

So the honest statement is: **the mechanic is engaged on every seed pool, but the
match-level benefit is not uniform.** On the Phase 7 pool and on the full matrix
(§6.5) it is large; on this pool it is small. Neither pool is a statistically
conclusive competitive ranking, and the two are never merged.

### 6.5 The full matrix, before and after

`npx tsx tools/nation-matchups.ts 5 600` — the Phase 7 command, unchanged, 5
seeds × 15 pairings × 4 orientations = 300 national matches plus 20 legacy
controls, 243.6 s wall clock.

| Measure | Phase 7 (pre-change) | Phase 8 (shipped) |
| --- | --- | --- |
| National matches | 300 | 300 |
| Timeouts | 106 (35.3 %) | **61 (20.3 %)** |
| Legacy `baltic` vs `expeditionary` | 10/20 timeouts | **2/20** |
| Mean decisive duration | — | 290.5 s (239 matches) |
| Timeout rate with a battery in the match | 41.5 % (81/195) | **20.9 %** (38/182) |
| Timeout rate without a battery | 23.8 % (25/105) | **19.5 %** (23/118) |
| Completed shared SPG / UK MLRS / Russian heavy howitzer | 201 / 21 / 18 | **187 / 27 / 19** |
| East seat share of decided matches | 65.5 % (127–67) | 56.1 % (134–105) |
| Per-nation timeouts (100 sides each) | Lithuania 46, Poland 37, Belarus 37, UK 32, Russia 30, Hungary 30 | **Lithuania 22, Poland 24, Belarus 19, UK 19, Russia 18, Hungary 20** |

The artillery–timeout association that started this whole thread has almost
disappeared (41.5 % vs 23.8 % became 20.9 % vs 19.5 %) without changing a single
weapon value or the Phase 6 artillery demand policy. Artillery employment is
intact: 182 of 300 matches still field a battery, and the MLRS and heavy howitzer
counts are slightly **higher** than before (27 and 19 against 21 and 18), so this
is not the "the AI stopped building artillery" artefact the phase warned about.

The east-seat advantage is reduced (65.5 % → 56.1 %) but not removed; it was not
touched in this phase and remains an open diagnostic from Phase 6.

---

## 7. The selected outcome and the implementation

**Outcome A — a narrow rule change**, justified by §5 and §6: repair is
suppressed for one second after a hit, in the engine, for both seats.

| File | Change |
| --- | --- |
| `src/sim/constants.ts` | `REPAIR_SUPPRESSION_TICKS = 20` (one second at 20 tps) with the design rationale |
| `src/sim/game.ts` | The engineer repair branch makes no progress while the target has been hit inside that window, keeps the order, and still reports `repairing`; the repair `orderAck` distinguishes "suspended under fire"; `stateHash` now covers `lastHitTick` |
| `src/sim/ai.ts` | The AI only sends its engineer to a structure that has been quiet for the same window, so the crew builds or repairs something else instead of standing in a bombardment |
| `src/ui/hud.ts` | The selected structure's integrity block shows `UNDER FIRE` / `REPAIR SUSPENDED` while the rule is active |
| `src/style.css` | `.hp-note` styling for that line |
| `tests/repair-medic.test.ts` | Progress stops under sustained hits, the order survives, work resumes after the firing lapses, and save/replay stay identical |
| `tests/ai-employment.test.ts` | The AI does not park the engineer on a shelled structure, and does return once it is quiet |
| `tools/siege-duels.ts` | Repair-rule duel harness (control / legacy / cost / cap) with the marginal two-engineer band |
| `tools/timeout-audit.ts` | Adds the `legacy` repair reconstruction arm and the engineer-range constants it needs |
| `README.md` | One sentence in the economy bullet: repairs are suspended while the structure is under fire |

Design notes:

- **Why one second.** A single gun's reload is longer than a second, so an
  isolated attacker cannot suppress a crew permanently; two attackers firing out
  of phase can. That is what produces the "three attackers break a lone
  engineer" threshold in §5, and it is why the post is not simply made of paper.
- **Why the engine and not the UI.** Suppression is simulation state, so scripted
  human orders, AI orders, replays and saves all observe it. Nothing depends on a
  commander noticing a warning.
- **Why no material cost.** §4 shows a cost only bites when the bank is drained,
  and the AI has no repair budget; adding one would be a separate, larger phase.
- **Why no cap.** A 77 HP/s floor is still above the realistic attacker arrival
  rate, so capping engineer count changes almost nothing while making a
  multi-engineer defensive investment feel arbitrary.

---

## 8. Remaining uncertainties and explicit limitations

- **Two engineers still stack** additively (154 HP/s). Three attackers broke a
  single-engineer post in 92.5 s but only reached 6 % against two engineers in
  180 s. Suppression reduced the problem; a throughput cap is the obvious next
  lever if engineer stacking appears in real matches. It was measured (§5.2) and
  deliberately not shipped alone.
- **Repair is still free**, which contradicts the GDD's "costs time and
  resources". This phase measured a 0.45 M/HP charge and left the decision open.
- **The reconstruction arm is not a byte-exact baseline.** The 59 → 50 difference
  between the historical tree and the reconstructed arm is not separated into
  the engine rule and the co-shipped AI employment change; it is labelled
  inconclusive and is much smaller than the 50 → 26 engine effect.
- **No human play.** Every result is AI-vs-AI on one arena at veteran difficulty.
  The rule's feel for a player defending a post under artillery is untested.
- **The resolution benefit is pool-dependent.** Seeds 101/1078/2055 halve
timeouts (27.8 % → 14.4 %) and the 300-match matrix drops from 35.3 % to 20.3 %,
but seeds 11/555/999 only move from 28.9 % to 25.0 %. That pool's stalls are
mostly `army-collapse`, which no repair rule addresses. The mechanic itself is
unambiguous — repair falls from 35.2 % to 26.0 % of post damage on the primary
pool and 31.1 % to 23.4 % on the replication pool — so the rule is justified on
behavioural grounds with the match-level benefit as supporting, not decisive,
evidence.
- **Sample size.** 180 matches per arm per seed pool, with the standing east-seat
  and commander-temperament confounders documented in Phase 5/6/7. Per-nation
  rates are 60 sides each: direction is trustworthy, individual percentages are
  not. A 360-match arm on a third pool would be the cheapest way to settle
  whether the timeout benefit generalises.
- **11 of 26 remaining timeouts are still `siege-out-repaired`.** Those are
  matches where an army did reach the post and still could not finish it; the
  next diagnostic should separate "too few attackers at the objective" from
  "repair still too strong" rather than assuming the latter.

---

## 9. Verification

Run on the final tree, in this order:

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **41 files / 441 tests passed**, 64.8 s (Phase 7 baseline: 38 / 412) |
| `npm run build` | tsc + vite build + service-worker precache, 61 modules, 457.15 kB JS (135.04 kB gzip) |
| `npx tsx tools/siege-duels.ts 180` | 64 duels, §5 |
| `npx tsx tools/timeout-audit.ts 3 600 veteran` | 180 matches, 26 timeouts (14.4 %) |
| `MCA_REPAIR_RULE=legacy npx tsx tools/timeout-audit.ts 3 600 veteran` | 180 matches, 50 timeouts (27.8 %) |
| `MCA_SEEDS=11,555,999 npx tsx tools/timeout-audit.ts 3 600 veteran` (both arms) | 180 + 180 matches, 28.9 % → 25.0 % |
| `npx tsx tools/nation-matchups.ts 5 600` | 320 matches (300 national + 20 legacy), 243.6 s, 20.3 % national timeouts |

Raw JSONL for every run is in `tmp/p8-*.jsonl` and `tmp/phase8-siege-duels.jsonl`;
all three harnesses stay outside the fast test suite.

---

## 10. Recommended next step

Ranked by evidence strength:

1. **Corroborate the resolution claim, then decide whether to keep it.** The
   mechanic is measured; the match-level benefit is a single-pool result. Re-run
   both arms on a third seed pool plus the 300-match matrix, and if the timeout
   effect does not reproduce, either accept the rule purely as a repairability
   limit or revert it. Do not tune the suppression window to chase a number.
2. **Measure attackers at the objective, not only artillery.** 11 `siege-out-repaired`
   timeouts remain on the primary pool with real post damage. The audit already
   records `maxCombatAtEnemyHq`; the next pass should condition on how many
   attackers actually stood at the post and for how long before proposing any
   further repair change.
3. **Engineer stacking.** If matches show 2+ engineers on one post, evaluate the
   throughput cap as a second narrow rule, with the duel arms in this document as
   the fixture.
4. **Repair cost.** Only if the economy phase wants repair to be a material
   decision; it needs AI budgeting and a UI cost readout before it can ship.
5. **Hungary's remaining 20 %.** Halved without a bunker change; still the highest
   nation on the primary pool, so it belongs to a later balance pass, not to
   another repair rule.
