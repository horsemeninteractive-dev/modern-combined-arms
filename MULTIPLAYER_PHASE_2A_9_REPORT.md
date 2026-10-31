# MCA — Phase 2A.9: Staging CPU Impact Validation

**Status: PASS for the controlled staging comparison. The Phase 2A.8 changes were associated with a repeatable reduction in aggregate invocation CPU for the synthetic 80-unit stress workload. The 10 ms individual-tick CPU target remains UNVERIFIED. Production was not deployed, changed or enabled.**

## 1. Summary

The experiment compared two staging Worker versions that differ only in the intended Phase 2A.8 pathfinding changes:

| | A — baseline | B — optimised |
| --- | --- | --- |
| Version | `e5aef673-bf6f-461c-8539-5605c5ddf908` | `d23e416c-c755-4ec4-bfb3-373ec216c275` |
| Tag | `phase2a9-a` | `phase2a9-b` |
| Source | reconstructed pre-2A.8 tree | current working tree |
| Pathfinding | old per-request traffic mask and object-node heap | shared command batch, typed-array heap |

Both builds ran the same deterministic 80-unit mass-order workload in six interleaved sessions: A1, B1, B2, A2, A3, B3. Each build produced 216 measured calibration invocations, and every invocation was matched to a platform `cpuTimeMs` record. All 216 authoritative-state comparisons matched exactly.

Main results:

- **100-tick stress batch, setup-subtracted:** A **214.1 ms**, B **141.3 ms**; difference **72.8 ms per invocation**, **34.0% lower** (95% bootstrap CI **16.1%–48.3%**).
- **Warm first-tick excess:** A **15.75 ms**, B **11.75 ms**; difference **4.0 ms**, **25.4% lower** (95% CI **0.35%–50.4%**).
- **Combined first-tick sample, including cold-start repetitions:** A **27.33 ms**, B **18.50 ms**; difference **8.83 ms**, **32.3% lower** (95% CI for the difference **3.94–14.32 ms**).
- **Derived aggregate stress cost:** A **2.14 ms/tick**, B **1.41 ms/tick**; difference **0.73 ms/tick**, **34.0% lower** (95% CI **16.1%–48.3%**). This is a derived estimate, not a per-tick measurement.
- B was lower in all three interleaved session pairs for both 100-tick CPU and first-tick CPU.

The result cannot be explained by a simplified workload: both builds executed the real `Game.tick()` path with real pathfinding, movement, combat, projectiles and casualties, and every final state checksum matched.

## 2. Source and deployment identification

- Repository HEAD during the experiment: `132ccc8` with substantial pre-existing uncommitted work. No reset, overwrite, stage or commit was performed.
- A was built from the reconstructed pre-2A.8 tree in `tmp/phase2a8-old`.
- B was built from the current working tree.
- The two source trees differ **only** in:
  - `src/sim/game.ts`
  - `src/sim/pathfinding.ts`
  - `src/sim/navBatch.ts`
- Source and artifact SHA-256 values are recorded in `staging-evidence/phase2a9-deployment.txt`.
- The A artifact contains no `NavBatch` symbol; the B artifact does. This is consistent with the intended integration.
- B remains deployed at 100% of the isolated staging Worker after validation.
- `MULTIPLAYER_FEATURE.enabled` remains `false`. No production route, deployment, capacity limit or feature flag was changed.

The Worker build marker is still `phase2a6-staging`; version identity for every observation came from `$workers.scriptVersion.id`, not the build marker.

## 3. Workload and experimental design

### 3.1 Deterministic workload

The experiment reused the Phase 2A.6/2A.7 calibration workload:

- Scenario `island-assault`, fixed seed.
- 80 units: 16 scenario units plus 64 fixed added units.
- Two full-force attack-move commands, one per team.
- 72 accepted formation slots and 8 idle/rejected slots.
- Real pathfinding, movement, fire, projectiles and casualties.
- Fog enabled; AI disabled.
- Batch sizes `0, 1, 5, 20, 100` authoritative `Game.tick()` calls.
- Batch `0` is setup only; batch `1` is setup plus the first authoritative tick.

The baseline profile (16 units, no commands) was retained as a low-activity control.

This is a synthetic mass-order workload, deliberately more demanding than a normal match. Its 72-request first-tick burst is the case Phase 2A.7 diagnosed; it is not a representative ordinary tick.

### 3.2 Session structure

Each session:

1. Created a 10 s room and shut it down.
2. Verified calibration is admin-only (`403` unauthenticated), invalid profiles/batches are `400`, and plain status exposes no calibration data.
3. Ran two unmeasured warmups.
4. Ran 6 repetitions of each profile × batch, with profile order alternating by repetition.
5. Ran 12 extra stress batch-1 invocations after the main sequence.
6. Verified the room was closed and the reservation was `released`.

That is 72 measured invocations per session and 216 per build, plus 6 warmups per build.

### 3.3 Interleaving

The deployment order was **A1, B1, B2, A2, A3, B3**. A and B runs were never concurrent. Each session used a fresh room ID. No session state, reservation or diagnostics carried into another.

## 4. Measurement source and resolution

Cloudflare Workers Observability telemetry was queried directly:

```text
POST /accounts/{account_id}/workers/observability/telemetry/query
view: events
filters:
  $workers.event.request.url includes "run=p2a9-A" or "run=p2a9-B"
  $workers.executionModel eq "durableObject"
fields:
  $workers.cpuTimeMs
  $workers.wallTimeMs
  $workers.scriptVersion.id
  request URL
  event timestamp
```

Query run IDs:

- A: `xydv2qtrpwt0nmb3zua3vcu3`
- B: `5o4job4n19nrgvk6kfzkuhbe`

Properties:

- `$workers.cpuTimeMs` is **integer milliseconds per Durable Object invocation**.
- It measures CPU, not wall time. Wall time was also present but is not used as CPU.
- It includes scenario/`Game` construction, command setup, the requested ticks, state hashing, response serialisation and routing.
- It is not a per-tick timeline and has no per-tick maximum or percentile.

Coverage:

| Build | Measured samples | Matched CPU records | Coverage |
| --- | ---: | ---: | ---: |
| A | 216 | 216 | 100% |
| B | 216 | 216 | 100% |

No sample was missing, so no value was imputed. All 432 matched sample records had outcome `ok`; there were no error or CPU-limit records.

A platform aggregate query independently summed `$workers.cpuTimeMs` by version and Durable Object:

- A: 2,895 + 2,502 + 3,116 = **8,513 ms** across 216 sample events.
- B: 1,981 + 1,648 + 2,113 = **5,742 ms** across 216 sample events.

Those totals exactly match the per-invocation sums. See `phase2a9-platform-aggregate.json`.

`wrangler tail` was tested as a secondary source. It had incomplete Durable Object coverage and its process lingered long enough to mix later sessions, so it was discarded and is not used in any result.

## 5. Direct platform measurements

Values are invocation CPU in milliseconds. `mean` and `median` are across the stated number of independent invocations. Confidence intervals are bootstrap percentile intervals and are reported for the key comparisons, not every cell.

| Measurement | A | B | Difference |
| --- | ---: | ---: | ---: |
| Sample invocations | 216 | 216 | 0 |
| Completed authoritative ticks in samples | 4,572 | 4,572 | 0 |
| Total sample CPU, 216 invocations | 8,513 ms | 5,742 ms | **−2,771 ms (−32.6%)** |
| CPU per completed tick, workload-weighted | 1.862 ms | 1.256 ms | **−32.6%** |
| Mean CPU per sample invocation | 39.41 ms | 26.58 ms | −12.83 ms |
| Stress batch 0 (setup only), mean / median | 7.44 / 6.0 | 5.17 / 4.0 | +2.28 ms mean (CI −0.28 to +5.00) |
| Stress batch 1 (setup + first tick), mean / median | 35.61 / 25.5 | 21.67 / 14.5 | +13.94 ms mean (CI 0.89 to 28.22) |
| Stress extra warm batch 1, mean / median | 23.19 / 21.0 | 16.92 / 15.0 | +6.28 ms mean |
| Stress combined batch 1, mean / median | 27.33 / 22.5 | 18.50 / 15.0 | +8.83 ms mean (CI 3.94 to 14.32) |
| Stress batch 5 (setup + 5 ticks), mean / median | 38.72 / 30.0 | 27.56 / 21.0 | +11.17 ms mean |
| Stress batch 20 (setup + 20 ticks), mean / median | 80.61 / 67.5 | 52.72 / 48.5 | +27.89 ms mean |
| Stress batch 100 (setup + 100 ticks), mean / median | 221.56 / 218.5 | 146.50 / 128.0 | **+75.06 ms mean (CI 31.78 to 115.28)** |
| Baseline batch 0 (setup only), mean / median | 4.50 / 3.0 | 3.17 / 2.0 | +1.33 ms mean |
| Baseline batch 1 (setup + first tick), mean / median | 5.50 / 3.0 | 3.39 / 3.0 | +2.11 ms mean (CI −0.61 to +5.00) |
| Baseline batch 100 (setup + 100 ticks), mean / median | 18.56 / 13.0 | 14.28 / 9.5 | +4.28 ms mean |
| Outcome errors / CPU-limit events | 0 | 0 | 0 |

CPU per completed tick in this table is the workload-weighted total (all batch sizes, including setup) divided by 4,572 ticks. It is not the same estimator as the 100-tick marginal estimate in section 6.2.

CPU per minute is **not derived**. Each calibration session window is about 25 seconds and contains deliberate 250 ms pacing between requests; normalising that to a minute would describe the calibration duty cycle, not a match CPU rate. The platform per-object totals are preserved instead.

Peak memory is **not captured**: the event query exposes CPU and wall time, not per-invocation memory.

Additional distribution detail for the two primary cells:

| Cell | Build | p10 | p25 | p75 | p90 | p95 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Stress batch 100 | A | 120 | 170 | 283 | 313 | 320 | 320 |
| Stress batch 100 | B | 90 | 100 | 160 | 239 | 312 | 312 |
| Combined stress batch 1 | A | 18 | 19 | 29 | 42 | 66 | 115 |
| Combined stress batch 1 | B | 12 | 13 | 20 | 29 | 56 | 61 |

The integer-millisecond resolution matters most for the baseline control, whose values are mostly 1–5 ms.

## 6. First-tick and sustained cost

### 6.1 First-tick excess

The first tick cannot be isolated by a clock in this runtime. The defensible estimate is the difference between independent batch-1 and batch-0 invocations. This subtracts each build's own setup cost but still carries setup/JIT variation.

| Estimator | A excess | B excess | Difference | Percent lower |
| --- | ---: | ---: | ---: | ---: |
| 18 main batch-1 samples, mean | 28.17 ms | 16.50 ms | **11.67 ms** (CI −1.67 to 25.83) | 41.4% (CI −5.9% to 91.7%) |
| 18 main batch-1 samples, median | 19.5 ms | 10.5 ms | **9.0 ms** (CI 1.5 to 20.0) | 46.2% (CI 7.7% to 102.6%) |
| 54 combined batch-1 samples, mean | 19.89 ms | 13.33 ms | **6.56 ms** (CI 0.89 to 12.69) | 33.0% |
| 54 combined batch-1 samples, median | 16.5 ms | 11.0 ms | **5.5 ms** (CI 1.0 to 10.0) | 33.3% |
| 36 warm extra batch-1 samples, mean | 15.75 ms | 11.75 ms | **4.0 ms** (CI 0.06 to 7.94) | **25.4%** (CI 0.35% to 50.4%) |
| 36 warm extra batch-1 samples, median | 15.0 ms | 11.0 ms | **4.0 ms** (CI 0 to 9.0) | 26.7% |

The first measured stress batch-1 invocation in each session was an outlier in both builds: A produced 66, 115 and 72 ms in A1/A2/A3; B produced 61, 56 and 56 ms in B1/B2/B3. These are consistent with cold-start compilation or VM setup in the first real pathfinding invocation of a session, not a steady-state tick. The main first-tick mean therefore has a wide confidence interval that includes zero. The median and the larger combined/warm samples show a consistent reduction.

The warm extra samples are the cleanest first-tick estimator: they were collected after the main sequence in the same warm Durable Object. They show a 4.0 ms lower first-tick excess, with a confidence interval that only just excludes zero. This is evidence of a real but modest warm first-tick improvement; it is not a per-tick CPU measurement.

### 6.2 Sustained cost

The setup-subtracted 100-tick comparison is the primary aggregate estimator:

| Measure | A | B | Difference |
| --- | ---: | ---: | ---: |
| 100-tick batch minus setup, mean | 214.11 ms | 141.33 ms | **72.78 ms lower** (CI 30.8–114.2) |
| Percent lower | — | — | **34.0%** (CI 16.1%–48.3%) |
| Raw 100-tick batch, mean | 221.56 ms | 146.50 ms | 75.06 ms lower (CI 31.78–115.28) |

Derived linear fits over batches 1, 5, 20 and 100:

| Build / profile | Slope | Intercept | R² | n |
| --- | ---: | ---: | ---: | ---: |
| A / stress | 1.880 ms/tick | 34.91 ms | 0.762 | 72 |
| B / stress | 1.245 ms/tick | 22.90 ms | 0.701 | 72 |
| A / stress, batches 5–100 | 1.871 ms/tick | 35.69 ms | 0.737 | 54 |
| B / stress, batches 5–100 | 1.226 ms/tick | 24.53 ms | 0.663 | 54 |

The stress relationship is approximately linear over this range but has large residuals; it is not a precise tick-cost model. The baseline fits are weak (R² 0.27 and 0.23) and should not be interpreted as per-tick costs.

Derived per-tick estimates for the synthetic stress workload:

| Estimator | A | B | Difference | Percent lower |
| --- | ---: | ---: | ---: | ---: |
| `(batch100 − setup) / 100` | 2.141 ms | 1.413 ms | 0.728 ms (CI 0.308–1.142) | **34.0%** (CI 16.1%–48.3%) |
| `(batch100 − batch1) / 99` | 1.878 ms | 1.261 ms | 0.617 ms (CI 0.170–1.063) | 32.9% (CI 10.4%–50.1%) |

These are aggregate derived estimates. They do not establish any individual tick's CPU, maximum or percentile.

## 7. Interleaved control and negative control

Absolute CPU levels drifted downward across the experiment in both builds. Session-pair comparisons control for that drift better than pooled means:

| Slot | Sessions | Batch-100 mean A | Batch-100 mean B | Difference | Combined first-tick mean A | Combined first-tick mean B | Difference |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | A1 vs B1 | 261.67 | 177.67 | **84.00** | 22.56 | 17.17 | **5.39** |
| 2 | A2 vs B2 | 216.50 | 147.33 | **69.17** | 33.11 | 20.56 | **12.56** |
| 3 | A3 vs B3 | 186.50 | 114.50 | **72.00** | 26.33 | 17.78 | **8.56** |

B was lower in every pair for both metrics. The pair differences are similar to the pooled difference, so the conclusion is not caused by one unusually slow A session.

The baseline profile is a negative control: it has no commands and does not exercise the command-scoped pathfinding batch. Its A/B batch-1 mean difference is **2.11 ms** (CI **−0.61 to +5.00**), and its median is identical at 3 ms. This is a small, near-resolution difference whose interval includes zero. It cannot explain the roughly 73–75 ms difference in the 100-tick stress batch. It does mean that a small global build/runtime shift cannot be excluded, so the exact percentage should be treated as an estimate rather than a pathfinding-only attribution.

The stress setup control is also small: 7.44 vs 5.17 ms mean (CI −0.28 to +5.00). Subtracting each build's setup changes the 100-tick difference only from 75.06 to 72.78 ms.

## 8. Behavioural equivalence

Before comparing CPU, each A sample was matched to the B sample with the same session slot, profile, batch and repetition.

- Comparisons: **216**.
- Fields compared: final checksum, initial checksum, final tick, live units, projectiles, shots, kills, commands issued, command entity IDs, RNG state.
- Mismatches: **0**.
- Completed tick counts matched the requested batch in every invocation.
- Every run reported the expected profile and run ID.
- Two independent stress runs remain deterministic under the existing tests.

The calibration route returns aggregate activity counts, not the full event array. Event-by-event sequence equality was therefore not independently compared through this route; the authoritative state checksum, entity/projectile counts, combat counts and RNG state matched exactly.

No calibration data enters game state, save data, snapshots, team projections or client protocol messages.

## 9. Local verification

| Check | Result |
| --- | --- |
| TypeScript typecheck | **Pass** |
| Full Vitest suite | **Pass — 94 files, 937 tests** |
| Production build | **Pass** |
| Focused Phase 2A.9 harness tests | **Pass — 4 tests** |
| Production bundle calibration/ClockProbe markers | **0** |
| `MULTIPLAYER_FEATURE.enabled` | **false** |

Logs: `staging-evidence/phase2a9-typecheck.log`, `phase2a9-vitest.log`, `phase2a9-build.log`.

The production build retains `NavBatch` because it is part of the single-player simulation path. It contains no `runBatchCalibration`, `calibrate`, `phase2a9` or `ClockProbe` symbols.

## 10. Staging lifecycle and security validation

The optimised B build passed the deployed 15-check smoke test:

- 101 WebSocket upgrade.
- Two seats connected.
- Team projections isolated.
- Valid command accepted.
- Forged authority rejected.
- Oversized frame rejected.
- Wrong token `401`.
- Foreign origin `403`.
- Duplicate seat `409`.
- Resync checkpoint applied.
- Reconnect accepted on a new epoch.
- Delta carried no map or full state.
- Result delivered to both seats.
- Reservation released.
- Deployed global capacity boundary enforced (`capacity-full` for the third room).

The calibration harness also verified admin-only access, invalid calibration rejection, no calibration data on the plain status route, and reservation release for every session. The real-room smoke transferred one 58,967-byte initial sync, a 365-byte first delta and a resync in 19 ms. Calibration invocations returned only calibration JSON and produced no room snapshots or deltas.

A 30-minute soak was not run. The task requires a short real-room validation unless it reveals a lifecycle or stability concern; it did not.

## 11. Comparison with earlier phases

### Phase 2A.4

Phase 2A.4 measured **19.698 s aggregate CPU over 35,994 normal-match ticks**, about **0.547 ms/tick**, in a 30-minute two-seat soak. That was a different workload: a normal match over 30 minutes, not an 80-unit synthetic mass engagement.

Phase 2A.9's derived stress estimates are **2.14 ms/tick (A)** and **1.41 ms/tick (B)**. They are not comparable to 0.547 ms/tick and are not evidence of a normal-match regression. The synthetic stress workload is deliberately much heavier.

### Phase 2A.8 local evidence

Phase 2A.8's local V8 wall-clock benchmark reported roughly **12–14% lower first stress tick** and **81–90% lower traffic-mask preparation**, with pure A* CPU essentially neutral. Phase 2A.9's deployed CPU reduction is larger, roughly **25–34%** depending on the estimator.

The direction agrees; the magnitude does not. Local wall-clock timing is not deployed CPU, and the deployed CPU accounting includes allocation/GC work that the local wall-clock benchmark may under-attribute. The deployed result should not be presented as confirming the local percentage. It is an independent, platform-measured improvement in the same direction.

## 12. What is directly measured, derived, and not established

### Directly measured

- Per-invocation `$workers.cpuTimeMs` for 216 A and 216 B samples.
- Exact run-ID and script-version correlation.
- Completed tick counts and final state checksums.
- Workload unit, projectile, shot and kill counts.
- Platform aggregate sums by version and Durable Object.
- Zero missing samples and zero outcome errors.

### Derived estimates

- First-tick excess as batch 1 minus batch 0.
- Setup-subtracted 100-tick CPU.
- Aggregate CPU per tick from the 100-tick batch.
- Linear slopes and intercepts over batch sizes.
- Bootstrap confidence intervals.
- Session-pair differences and the baseline negative-control comparison.

### Not established

- Individual tick CPU timings.
- Maximum CPU consumption of any individual tick.
- A per-tick percentile distribution.
- Proof that every tick remains below 10 ms.
- Normal-match CPU improvement.
- Concurrent-room capacity.
- Per-invocation memory or a memory trend.
- Event-by-event sequence equality through the calibration route.

## 13. Limitations

1. **Invocation CPU is not tick CPU.** Every value includes setup, command application, state hashing, response serialisation and routing.
2. **Batch 1 is not a clocked tick.** It is one tick plus setup, compared with an independent setup-only invocation.
3. **Integer-millisecond resolution.** The baseline control sits at 1–5 ms and cannot support fine-grained conclusions.
4. **Cold-start outliers.** The first stress batch-1 invocation of each session is much slower than later ones. The main first-tick mean has a wide interval; the combined and warm estimates are more stable.
5. **Platform drift.** Absolute CPU declined across the experiment. B was lower in every interleaved pair, but the percentage uncertainty is wide.
6. **Small baseline shift.** The negative control shows a 1–2 ms A/B difference with an interval including zero. The bulk of the stress difference is far larger, but exact pathfinding-only attribution is not possible.
7. **Synthetic workload.** The 80-unit mass-order scenario is deliberately demanding and is not a normal match.
8. **No memory metric.** The event query provides CPU and wall time, not per-invocation memory. No memory conclusion is drawn.
9. **Short validation.** The real-room lifecycle test was short; it does not establish 30-minute stability or concurrent-room capacity.
10. **No 10 ms proof.** Nothing in this phase measures an individual tick's CPU, so the 10 ms target remains unverified.

## 14. Conclusion

In the isolated staging runtime, the Phase 2A.8 build produced a repeatable reduction in aggregate invocation CPU for the synthetic 80-unit mass-order workload:

- The setup-subtracted 100-tick stress batch was **72.8 ms lower per invocation**, or **34.0% lower** (95% CI **16.1%–48.3%**).
- The warm first-tick excess was **4.0 ms lower**, or **25.4% lower** (95% CI **0.35%–50.4%**).
- B was lower in all three interleaved session pairs for both metrics.
- All 216 authoritative-state comparisons matched exactly, so the CPU difference is not explained by different simulation work.

The result is useful for capacity planning **for this synthetic stress workload**. It does not prove a normal-match improvement, a per-tick maximum, or the 10 ms individual-tick target.

**The 10 ms individual-tick CPU target remains UNVERIFIED.**

## 15. Evidence index

- `staging-evidence/phase2a9-evidence-README.md`
- `staging-evidence/phase2a9-deployment.txt`
- `staging-evidence/phase2a9-observability-extract.json`
- `staging-evidence/phase2a9-platform-aggregate.json`
- `staging-evidence/phase2a9-analysis/analysis.json`
- `staging-evidence/phase2a9-analysis/analysis.log`
- Six `staging-evidence/phase2a9-<session>-*` directories (`A1`, `A2`, `A3`, `B1`, `B2`, `B3`)
- `staging-evidence/phase2a9-deployed-smoke.log`
- `staging-evidence/phase2a9-typecheck.log`
- `staging-evidence/phase2a9-vitest.log`
- `staging-evidence/phase2a9-build.log`
- `tools/phase2a9-ab-calibration.mjs`
- `tools/phase2a9-analyse.mjs`
- `tests/phase2a9-ab-calibration.test.ts`
