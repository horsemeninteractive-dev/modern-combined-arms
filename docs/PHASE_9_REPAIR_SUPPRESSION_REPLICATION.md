# Phase 9 — Independent Replication of Repair Suppression

Status: **experiment complete, no gameplay change.** The Phase 8 rule
(`REPAIR_SUPPRESSION_TICKS = 20`) is retained.

Conclusion: **Supported.** The rule reduced timeouts in all three independent
seed pools, and the pooled paired estimate excludes zero (6.1 percentage points,
bootstrap 95 % CI 3.5–8.5, exact McNemar p ≈ 0.00005). The fresh pool on its own
is **not** individually significant (4.4 pp, CI −0.6–10.0, p = 0.215), and the
effect size varies from 2.8 to 11.1 pp between pools, so this is a real but
unevenly sized effect rather than a uniform one.

| Pool | Seeds | Control timeouts | Shipped timeouts | Paired difference | 95 % CI (cluster bootstrap) |
| --- | --- | --- | --- | --- | --- |
| A (Phase 8 primary) | 101, 1078, 2055 | 46 (25.6 %) | 26 (14.4 %) | **+11.1 pp** | 6.7 – 15.6 |
| C (Phase 8 replication) | 11, 555, 999 | 50 (27.8 %) | 45 (25.0 %) | +2.8 pp | −0.6 – 6.1 |
| D (**fresh**) | 1234, 2468, 3690 | 70 (38.9 %) | 62 (34.4 %) | +4.4 pp | −0.6 – 10.0 |
| **Pooled** | 540 matched pairs | 166 (30.7 %) | 133 (24.6 %) | **+6.1 pp** | 3.5 – 8.5 |

---

## 1. Question and predeclared measures

**Question.** Does Phase 8's repair-suppression rule produce a repeatable
improvement in AI match resolution, or was the primary-pool result a property of
those seeds? This phase replicates the comparison on a seed pool never used to
design or measure the rule. It does not attempt to improve the result.

Predeclared before any fresh-pool run:

**Primary outcomes**

- total timeouts and timeout rate per arm;
- decisive results reported separately from timeouts (never counted as wins);
- `siege-out-repaired` count and rate;
- `army-collapse` count and rate;
- every other timeout category;
- the paired difference in timeout rate with an uncertainty interval, plus a
  paired test.

**Secondary outcomes**

- decisive match duration;
- command-post health at the end, damage absorbed, damage repaired, and the
  number of posts that absorbed ≥ 500 damage yet ended at ≥ 85 % health;
- attackers at the objective (`maxCombatAtEnemyHq`), surviving force value and
  combat units alive at the end;
- artillery production per side and engineer repair duty;
- per-nation, per-seat and per-personality results.

**Decision rule**: retain the rule if the fresh pool is directionally consistent
with both earlier pools **and** the pooled paired interval excludes zero. One
pool alone is never treated as validation, and a non-significant fresh pool alone
is not treated as disproof.

## 2. Control and treatment

| | Treatment | Control |
| --- | --- | --- |
| Command | `npx tsx tools/timeout-audit.ts 3 600 veteran` | `MCA_REPAIR_RULE=off npx tsx tools/timeout-audit.ts 3 600 veteran` |
| Suppression in the engine | on (production default) | off (`repairSuppression: false` game option) |
| AI engineer selection | Phase 8 behaviour | **identical** — the AI does not read the option |
| Source tree | current working tree | current working tree |

The control is the engine's own suppression branch switched off, not a
post-tick reconstruction and not the Phase 7 tree:

```ts
// src/sim/game.ts — experiment-only; production never passes this.
export interface GameOptions { /* … */ repairSuppression?: boolean }
this.repairSuppression = opts.repairSuppression !== false;   // default true

if (this.repairSuppression &&
    this.state.tick - target.lastHitTick < REPAIR_SUPPRESSION_TICKS) return;
```

The option is constructor-only: it is not serialised, not read from a scenario,
not exposed in the UI or menu, and not set anywhere under `src/` outside the
default assignment. A saved game loaded without it gets the shipped rule.
`tests/repair-medic.test.ts` and `tests/determinism-save.test.ts` confirm the
production default is unchanged.

The AI's Phase 8 engineer-selection change — "do not park the engineer on a
structure that has been shelled in the last second" — is present and identical in
both arms. That is deliberate: this phase measures the **engine rule** alone.
Measured confirmation that it is held constant: mean engineer repair-duty samples
per side are 257 (control) and 263 (shipped) across 1 080 sides — the AI still
sends engineers and still holds repair orders at the same rate.

The Phase 8 `legacy` reconstruction arm is therefore superseded for causal
claims. Running it again would have mixed two things: the engine rule and the
post-tick approximation.

## 3. The fresh seed pool

Previous pools: **{101, 1078, 2055}** (Phase 7 audit / Phase 8 primary),
**{3032, 4009}** (used only by the 5-seed matrix), **{11, 555, 999}** (Phase 8
replication). The fresh pool was fixed before running:

> **1234, 2468, 3690**

No overlap with any previous pool. Same sample structure as Phase 8: 15 nation
pairings × 2 seat assignments × 2 commander temperaments × 3 seeds = **180
matches per arm**, 600 s cap, veteran difficulty, `destroyHQ`, the shared 64×64
mirrored arena, 3 000 materials / 180 requisition.

Each match is paired by `(pairing, seed, seat swap, personality rotation)`, so the
control and treatment for a given configuration see the identical map, starting
forces, faction assignment, commander and AI seed. Seats and pairs are not
re-sampled between arms. No interim result was used to replace a seed.

## 4. Variables confirmed identical between arms

| Variable | Status |
| --- | --- |
| Scenario, map, ore layout, starting forces | same constructor, same seed |
| Unit/building/weapon statistics, costs, roster | no file under `src/data/` was edited in Phase 9 (the data modifications visible in `git status` are the earlier phases' national roster work) |
| AI logic, priorities, difficulty, personality | identical; `src/sim/ai.ts` untouched in Phase 9 |
| Engineer-selection change (Phase 8) | present in both arms |
| Victory/timeout rules, 600 s cap | identical |
| Seat assignment, pairing, personality rotation | paired per match |
| RNG seeds (scenario + AI) | identical per pair |
| Telemetry/classifier | identical; only the header records which arm ran |

Two arms of 180 matches each were also re-run for pools A and C under the same
clean control, so all three pools are compared with identical methodology. The
Phase 8 numbers themselves are preserved unchanged in
`docs/PHASE_8_SIEGE_REPAIR_DESIGN.md`; where the clean control differs from the
Phase 8 reconstruction, both are shown (§6).

## 5. Fresh-pool results (D: 1234, 2468, 3690)

### 5.1 Primary outcomes

| Measure | Control (suppression off) | Shipped | Difference |
| --- | --- | --- | --- |
| Matches | 180 | 180 | — |
| Timeouts | 70 (38.9 %) | 62 (34.4 %) | −4.4 pp |
| `siege-out-repaired` | 18 (10.0 %) | **7 (3.9 %)** | −6.1 pp |
| `army-collapse` | 33 (18.3 %) | 31 (17.2 %) | −1.1 pp |
| `other` | 12 | 16 | +4 |
| `defensive-stalemate` | 4 | 4 | 0 |
| `artillery-standoff` | 3 | 4 | +1 |
| Decisive (non-timeout) | 110 | 118 | +8 |

Paired analysis over the 180 matched configurations: 20 configurations time out
only under the control, 12 only under the shipped rule, 148 agree.
Exact McNemar p = 0.215; cluster bootstrap (resampling `(pairing, seed)` blocks)
95 % CI for the difference: **−0.6 to 10.0 pp**.

Interpretation: the direction matches both earlier pools, the specific
siege-out-repaired category falls sharply (18 → 7), but the aggregate timeout
reduction on this pool is not individually significant, and part of the gain is
offset by a rise in the `other`/unclassified bucket. The fresh pool therefore
supports the mechanism and weakly supports the aggregate claim.

### 5.2 Secondary outcomes (pool D)

| Measure | Control | Shipped |
| --- | --- | --- |
| Mean decisive duration | 323.7 s | **300.0 s** |
| Mean command-post health at end | 68.3 % | 66.5 % |
| Posts that absorbed ≥ 500 damage and ended ≥ 85 % | 30 sides (8.3 %) | **15 (4.2 %)** |
| Post damage absorbed per match | 3 630 | 2 734 |
| Post damage repaired per match | 2 236 | **1 258** |
| Attackers at the enemy post, peak per side | 3.48 | 3.49 |
| Surviving force value per side | 1 772 | 1 953 |
| Combat units alive at end per side | 2.40 | 2.71 |
| Artillery completed per side | 0.36 | 0.35 |
| Engineered repair-duty samples per side | 320 | 346 |

The mechanism behaves exactly as designed: repair volume halves, posts end more
damaged, matches that do finish finish ~24 s sooner, and more force survives —
while the number of attackers reaching the objective and artillery production are
unchanged. The change is not "the AI stopped attacking".

## 6. All three pools, side by side

Each pool is kept separate; no pool is merged into another's rate.

### 6.1 Clean-control comparison (all pools, same methodology)

| Pool | Arm | Timeouts | Rate | `siege-out-repaired` | `army-collapse` |
| --- | --- | --- | --- | --- | --- |
| A (101/1078/2055) | control | 46 | 25.6 % | 23 | 16 |
| A | shipped | **26** | **14.4 %** | **11** | **10** |
| C (11/555/999) | control | 50 | 27.8 % | 9 | 27 |
| C | shipped | 45 | 25.0 % | 13 | 21 |
| D (1234/2468/3690) | control | 70 | 38.9 % | 18 | 33 |
| D | shipped | 62 | 34.4 % | 7 | 31 |
| **Pooled (540)** | control | 166 | 30.7 % | 50 | 76 |
| **Pooled (540)** | shipped | **133** | **24.6 %** | **31** | **62** |

Pooled effect: **−6.1 pp** (95 % cluster-bootstrap CI 3.5–8.5), exact McNemar
p ≈ 0.00005 over 540 matched pairs (49 discordant favouring the control,
16 favouring the shipped rule). 135 independent `(pairing, seed)` clusters.

### 6.2 Phase 8 arms versus the clean control

| Pool | Phase 8 control arm | Clean control | Phase 8 shipped | Clean shipped |
| --- | --- | --- | --- | --- |
| A | 50 (reconstructed) | **46** | 26 | 26 |
| C | 52 (reconstructed) | **50** | 45 | 45 |

The reconstruction slightly **overstated** the pre-change timeout count (50 vs 46
on pool A, 52 vs 50 on pool C). The Phase 8 conclusion therefore holds under a
stricter control: the effect is real but about 4 matches smaller than the
reconstruction suggested.

### 6.3 Pooled secondary outcomes

| Measure | Control | Shipped |
| --- | --- | --- |
| Mean decisive duration | 300.0 s | 290.1 s |
| Posts repaired through (≥ 500 absorbed, ends ≥ 85 %) | 91 sides (8.4 %) | **62 (5.7 %)** |
| Post damage absorbed per match | 3 349 | 2 705 |
| Post damage repaired per match | 1 772 | **1 012** |
| Attackers at the enemy post, peak per side | 3.58 | 3.60 |
| Surviving force value per side | 1 896 | 1 971 |
| Combat units alive at end per side | 2.65 | 2.82 |
| Artillery completed per side | 0.35 | 0.34 |

### 6.4 Per-nation timeout counts, pooled over 540 pairs (180 sides each)

| Nation | Control | Shipped |
| --- | --- | --- |
| Lithuania | 42 | 33 |
| Poland | 60 | **43** |
| United Kingdom | 60 | 51 |
| Russia | 61 | 49 |
| Belarus | 51 | 44 |
| Hungary | 58 | 46 |

Every nation improves in the pooled sample. All six still time out in a fifth to a
third of their sides, so this is a reduction in a persistent condition, not a
cure.

## 7. Limitations, uncertainty and confounders

- **The fresh pool is not individually significant.** Its CI includes zero. The
  supported verdict rests on directional consistency across three disjoint pools
  plus the pooled interval, not on pool D alone.
- **Effect size is pool-dependent** (11.1 / 2.8 / 4.4 pp). Pool D also has the
  highest baseline timeout rate (38.9 %), and its stalls are dominated by
  `army-collapse` (33 of 70 timeouts), which repair cannot address. Pools differ
  in stall mix for reasons this phase did not attempt to explain; doing so would
  be a new investigation, not a replication.
- **Pairing is not perfect independence.** The four orientations of one
  `(pairing, seed)` share map and AI seeds, so the McNemar p-value treats them as
  independent when they are not. The cluster bootstrap by `(pairing, seed)` is
  reported for that reason and is the interval quoted in the verdict; it is wider
  than the naive paired interval but still excludes zero when pooled.
- **Pool C's `siege-out-repaired` count rose** (9 → 13) while its total fell. A
  lower timeout rate with a category moving the wrong way is a mixed signal, and
  is one reason the verdict is "supported with variation", not "confirmed".
- **One arena, one difficulty, AI only.** 64×64 mirrored arena, veteran, 600 s
  cap, `destroyHQ`. Nothing here measures human play, other maps or other
  difficulties.
- **Not addressed, deliberately**: the east-seat advantage, commander-personality
  effects, army-collapse stalls, engineer stacking above the shipped rate, and
  free repair. Each is a separate hypothesis with its own evidence requirement.
- **The experiment switch is not a gameplay setting.** It exists only as a
  `GameOptions` field consumed by the audit tool; no UI, save or scenario path can
  reach it.

## 8. Conclusion

**Supported — retain the rule.** Across 540 matched pairs on three disjoint seed
pools the shipped suppression rule reduced timeouts from 30.7 % to 24.6 %
(difference 6.1 pp, cluster-bootstrap CI 3.5–8.5, exact McNemar p ≈ 0.00005), cut
posts that are repaired through a real bombardment from 91 to 62 sides, halved
repair volume, and shortened decisive matches slightly while leaving attackers at
the objective and artillery production unchanged. Every pool points the same way.

The magnitude is not uniform: one fresh pool on its own cannot distinguish the
effect from noise, and the smallest pool-level effect (2.8 pp) would be easy to
lose in a different arena. If a later change makes repair-suppression effects
material to a balance decision, the smallest experiment that would settle it is
another 180-match pair on a fourth pool plus the 300-match matrix, using the same
`MCA_REPAIR_RULE=off` control — not a change to the suppression window.

No gameplay, data, save or UI behaviour was changed in this phase apart from the
experiment-only constructor option.

---

## 9. Verification

Run on the final tree:

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run tests/repair-medic.test.ts tests/ai-employment.test.ts tests/determinism-save.test.ts` | 3 files / 32 tests passed |
| `npx vitest run` | **41 files / 442 tests passed**, 75.3 s |
| `npm run build` | tsc + vite build + service-worker precache, 457.24 kB JS (135.08 kB gzip) |

`tests/repair-medic.test.ts` also checks the boundary this phase introduced: the
default game suppresses repair under fire, the experiment control does not, and a
save round-trip **drops** the control (a loaded game uses the shipped rule). No
save-schema field was added.

### Reproduction

```
npx tsc --noEmit
npx vitest run
npm run build

# Fresh pool, both arms
MCA_SEEDS=1234,2468,3690 npx tsx tools/timeout-audit.ts 3 600 veteran
MCA_SEEDS=1234,2468,3690 MCA_REPAIR_RULE=off npx tsx tools/timeout-audit.ts 3 600 veteran

# Existing pools under the clean control
MCA_SEEDS=101,1078,2055 MCA_REPAIR_RULE=off npx tsx tools/timeout-audit.ts 3 600 veteran
MCA_SEEDS=11,555,999     MCA_REPAIR_RULE=off npx tsx tools/timeout-audit.ts 3 600 veteran
```

Raw JSONL: `tmp/p9-off-poolA.jsonl`, `tmp/p9-off-poolC.jsonl`,
`tmp/p9-off-3seeds.jsonl`, `tmp/p9-shipped-3seeds.jsonl`,
`tmp/p8-control-3seeds.jsonl`, `tmp/p8-control-repl.jsonl`.
