# MCA — Phase 2A.6: Batch CPU Calibration

**Overall status: PASS for the batch-calibration milestone. The 10 ms per-tick CPU-headroom target remains UNVERIFIED, and the stress evidence indicates it is not met for a synthetic 80-unit mass-engagement first tick.**

This phase built an admin-only harness that runs real authoritative `Game` ticks in controlled batches, correlated each invocation with Cloudflare's per-invocation `$workers.cpuTimeMs`, and estimated marginal tick cost from repeated batches. It does **not** measure an individual tick's CPU time, a per-tick maximum or a per-tick percentile distribution.

- Staging Worker: `mca-multiplayer-staging`
- Deployed version: `febd117e-8d8e-481e-ba88-c212df262073` (100% of staging traffic)
- Deployed at: `2026-10-30T13:42:47.065Z`; version created `2026-10-30T13:42:45.624Z`
- Build marker: `phase2a6-staging`
- Calibration room: `phase2a6-cal-mvv1d9jg` (1v1, 10 s hard limit, shut down before calibration)
- Test window: `2026-10-30T13:56:52Z` – `2026-10-30T13:57:18Z`
- Production multiplayer flag: **disabled** (`MULTIPLAYER_FEATURE.enabled === false`)
- No production deployment, no plan or billing change, no paid observability service, no staged or committed files.

## 1. What was built

The harness uses the existing simulation and the existing admin-only room status route. It does not create a simplified model of the game.

| File | Change |
| --- | --- |
| `src/multiplayer/batchCalibration.ts` | New bounded calibration workload: real `Game`, two profiles, fixed batches, deterministic checksum/counters. |
| `src/multiplayer/roomDurableObject.ts` | Admin-only `?calibrate=<profile>&batch=<n>&run=<id>` branch on `/status`; staging-gated and allowlisted. |
| `src/multiplayer/roomWorker.ts` | Build marker `phase2a6-staging`. |
| `tests/phase2a6-batch-calibration.test.ts` | Focused tests for batch bounds, determinism, stress population, command issuance and data leakage. |
| `tools/phase2a6-batch-calibration.mjs` | Deployed harness: room lifecycle, unauthorised/invalid checks, 140 paced calibration requests, unique run ids, evidence files. |
| `tools/phase2a6-analyse.mjs` | Joins exact run ids to the Observability export, reports coverage, per-batch statistics, fits and per-repetition slopes. |
| `tools/phase2a-deployed-smoke.mjs` | Build-marker assertion advanced to `phase2a6-staging`. |
| `MULTIPLAYER_PHASE_2A_6_REPORT.md`, `staging-evidence/phase2a6-*` | This report and raw/normalised evidence. |

No change was made to `Game.tick`, `CommandGate`, team projection, snapshots, keepalive, reconnect, reservation logic, match result, save format or any renderer/UI code.

## 2. Calibration design

### 2.1 Workload profiles

Both profiles use `createIslandAssault()` with fog enabled and AI disabled.

| Profile | Population | Commands | Intended use |
| --- | ---: | ---: | --- |
| `baseline` | 16 scenario units | none | Low-activity control; isolates setup and small-tick work |
| `stress` | 80 units: 16 scenario + 64 fixed added units (32 per side) | two attack-move commands, one per team | Representative heavy engagement: pathfinding, fire, projectiles, casualties |

The added stress force is placed deterministically in the southern village approach (`x = 31–39` or `41–49`, `z = 38–51`), away from both command posts. The first stress tick already produces 23 projectiles, 31 shots and no kills; by 100 ticks it has produced 108 shots and 8 kills. This is a deliberately heavier workload than an idle room and heavier than the Phase 2A.4 match.

### 2.2 Batches and repetitions

- Batch sizes: `0, 1, 5, 10, 20, 50, 100` authoritative `Game.tick()` calls.
- Batch `0` is a setup-only control: scenario construction, `Game` construction, stress-unit insertion, command issuance, state hashing and response.
- Ten repetitions per profile and batch: **140 calibration attempts**.
- Each request carries a unique `run=p2a6-<profile>-<batch>-<rep>` id, so the invocation can be joined exactly; no aggregate-only inference.
- The room is created, immediately shut down, and then used only as a closed-room admin shell. No ordinary match runs during calibration.

### 2.3 Why the harness is not a per-tick clock

Phase 2A.5 demonstrated that `performance.now()`, `Date.now()` and `process.hrtime.bigint()` do not advance during synchronous CPU work in this deployed runtime, and `process.cpuUsage()` is not implemented. This phase therefore does not read a clock around a tick. It measures the platform's CPU accounting for an invocation containing a known number of ticks.

The estimator is:

```text
Invocation CPU = fixed invocation/setup cost + (completed ticks × marginal tick cost)
```

The fit is tested, not assumed. Batch 0 supplies a separate setup control. The one-tick batch supplies a direct observation of one tick plus setup, which is used only as a bounded cross-check, not as a per-tick measurement.

## 3. Measurement source and resolution

Cloudflare Workers Observability was queried with:

```text
POST /accounts/{account_id}/workers/observability/telemetry/query
view: events
filter: $workers.event.request.url includes "run=p2a6-"
filter: $workers.durableObjectId exists
fields: $workers.cpuTimeMs, $workers.wallTimeMs, request URL, eventTimestamp
```

Key properties:

- `$workers.cpuTimeMs` is **integer milliseconds per Durable Object invocation**.
- It measures CPU time, not wall time; matched wall time is reported separately.
- It includes scenario/`Game` construction, command setup, state hashing, response serialisation and routing, as well as the requested ticks. It is not a tick-only field.
- A Worker request forwarded to a Durable Object produces a stateless router event and a durable-object event. Only the `durableObject` event contains the calibration work; the stateless record was discarded.
- No per-tick field, per-tick percentile or per-tick timeline exists in the available API.

`durableObjectsInvocationsAdaptiveGroups` exposes CPU quantiles per minute/status/type, but it has no request URL or run-id dimension, so it cannot attribute CPU to an individual calibration batch. `durableObjectsPeriodicGroups` is a per-object, per-minute aggregate. `workersInvocationsAdaptive` is request-level but still grouped. The Observability event record, which carries the request URL and exact `cpuTimeMs`, is therefore the only available per-invocation source with enough identity for this experiment.

Sources used for the metric model: [Durable Objects metrics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/), [Workers metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), [production profiling](https://developers.cloudflare.com/workers/observability/profiling-in-production/), and the [Observability telemetry query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/).

The platform's own free-plan sampling must be accounted for:

- **140 attempts, 132 exact run-id matches (94.29%).**
- Eight records were not returned: `stress-5-6`, `stress-50-6`, `baseline-10-7`, `baseline-20-7`, `stress-10-7`, `baseline-5-8`, `baseline-10-8`, `stress-10-8`.
- Aggregate query metadata reported `sampleInterval = 1.06818`, an estimated 141 sample events and 10,295 ms estimated CPU for the sample filter. The estimate is weighted, not an exact population sum.
- Missing records were **not** imputed. Every number below uses only the 132 matched invocations.
- `wrangler tail` was also tested; it omitted Durable Object records at a similar or worse rate, so it was not used as the primary source. See the evidence README for the tail limitation.

This is a measured platform limitation, not a harness failure: all 140 HTTP responses were 200 and the harness asserted completed tick counts, run ids and checksums.

## 4. Directly measured results

### 4.1 Coverage and totals

| Measure | Result |
| --- | ---: |
| Calibration attempts | 140 |
| Exact run-id CPU matches | **132 (94.29%)** |
| Baseline matches | 66 / 70 |
| Stress matches | 66 / 70 |
| Missing sample runs | 8 (listed above) |
| Matched CPU total | **7,784 ms** |
| Matched wall-time total | **7,986 ms** |
| Mean CPU per matched invocation | 58.97 ms |
| Mean wall per matched invocation | 60.50 ms |
| Matched CPU / wall | 97.5% |

The matched CPU total is the sum of 132 integer-millisecond observations. It is **not** the full population: the platform's weighted aggregate for the sample filter was 10,295 ms over an estimated 141 events, and eight sample records are missing. The two totals are not directly reconcilable and neither is a sum of tick CPU.

### 4.2 Per-batch observations

Values are invocation CPU in milliseconds. `p95` is the nearest-rank 95th percentile; `max` is the largest observed invocation for that batch.

**Baseline (16 units, no commands)**

| Batch | n | Mean | Median | p95 | Max |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 10 | 9.5 | 4.5 | 33 | 33 |
| 1 | 10 | 5.0 | 3.5 | 18 | 18 |
| 5 | 9 | 5.6 | 3.0 | 12 | 12 |
| 10 | 8 | 5.5 | 5.0 | 8 | 8 |
| 20 | 9 | 8.7 | 7.0 | 26 | 26 |
| 50 | 10 | 11.5 | 8.5 | 36 | 36 |
| 100 | 10 | 20.4 | 13.5 | 40 | 40 |

**Stress (80 units, two attack-move commands)**

| Batch | n | Mean | Median | p95 | Max |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 10 | 7.4 | 7.0 | 15 | 15 |
| 1 | 10 | 46.2 | 31.5 | 133 | 133 |
| 5 | 9 | 54.0 | 44.0 | 105 | 105 |
| 10 | 8 | 78.3 | 61.0 | 151 | 151 |
| 20 | 10 | 85.0 | 83.0 | 102 | 102 |
| 50 | 9 | 182.8 | 147.0 | 318 | 318 |
| 100 | 10 | 300.5 | 300.0 | 355 | 355 |

At 1 ms resolution the baseline response is only a few milliseconds above the setup control. The baseline is therefore a control, not a useful estimate of the real match's per-tick cost. The stress series has clear positive slope, but also obvious non-linearity and overdispersion at small batches.

### 4.3 The one-tick observations

The most direct observation of a single tick is the batch-1 invocation, compared with the batch-0 setup control from the same profile. This is a **two-invocation difference**, not a clock around one tick.

| Profile | Batch 0 mean | Batch 1 mean | Batch 1 median | Batch 1 max | Batch 1 − batch 0, median (range) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 9.5 ms | 5.0 ms | 3.5 ms | 18 ms | 0 ms (−29 to +11) |
| Stress | 7.4 ms | 46.2 ms | 31.5 ms | 133 ms | **27 ms (16 to 118)** |

All ten stress repetitions had a positive batch-1-minus-batch-0 difference. The smallest stress batch-1 invocation was 24 ms, while the largest batch-0 control was 15 ms; even that most conservative pairing leaves at least 9 ms excess. The median pair leaves 27 ms excess.

**Interpretation:** this is strong evidence that the first tick of the 80-unit mass-engagement scenario takes well over 10 ms, and in the coldest repetition it is consistent with more than 50 ms. It is not a direct per-tick CPU measurement: setup CPU varies between invocations, and JIT/GC state is not controlled. It does not establish the cost of ticks 2–100 or a normal match tick.

## 5. Derived estimates

### 5.1 Linear fits

`Invocation CPU = intercept + slope × completed ticks`, fitted by ordinary least squares. Confidence intervals are normal-approximation 95% intervals for the slope; they do not include platform sampling uncertainty.

| Profile | Batch range | n | Slope (ms/tick) | 95% CI | Intercept (ms) | R² | Max abs residual (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Stress | all | 66 | **2.720** | 2.469–2.971 | 34.740 | 0.876 | 147.261 |
| Stress | ≥20 | 29 | **2.661** | 2.197–3.126 | 38.227 | 0.823 | 146.700 |
| Stress | ≥50 | 19 | 2.354 | 1.415–3.294 | 65.056 | 0.587 | 135.222 |
| Baseline | all | 66 | 0.137 | 0.083–0.192 | 5.856 | 0.280 | 27.144 |
| Baseline | ≥20 | 29 | 0.151 | 0.052–0.250 | 4.963 | 0.247 | 23.505 |
| Baseline | ≥50 | 20 | 0.178 | 0.003–0.353 | 2.600 | 0.182 | 24.500 |

**Stress:** the all-batches and ≥20 fits agree closely at about **2.66–2.72 ms/tick**, with a high R². The ≥50 fit is lower (2.35) but has a wide interval and only three x-values per repetition; it is not more trustworthy than the ≥20 fit. The intercept is **not** a clean setup cost: it is 34.7–38.2 ms, far above the 7.4 ms batch-0 mean, because the first tick's pathfinding/combat burst and small-batch noise are absorbed into the intercept. Do not subtract that intercept and present the remainder as pure tick CPU.

**Baseline:** the slope is 0.14–0.18 ms/tick, but the response is only a few integer milliseconds and R² is low. This is below the useful resolution of the 1 ms platform metric; it is not evidence that every baseline tick costs exactly 0.15 ms.

### 5.2 Repetition-level slopes

Each repetition was fitted separately to show run-to-run variability that the pooled fit hides.

| Profile / range | n reps | Mean | Median | Min | Max | SD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Stress, all | 10 | 2.719 | 2.709 | 2.071 | 3.332 | 0.461 |
| Stress, ≥20 | 10 | 2.668 | 2.788 | 1.924 | 3.274 | 0.475 |
| Stress, ≥50 | 9 | 2.447 | 2.820 | 0.740 | 3.480 | 0.802 |
| Baseline, all | 10 | 0.140 | 0.107 | −0.026 | 0.307 | 0.094 |
| Baseline, ≥20 | 10 | 0.156 | 0.102 | −0.087 | 0.432 | 0.163 |
| Baseline, ≥50 | 10 | 0.178 | 0.120 | −0.300 | 0.600 | 0.271 |

The stress slope is reproducible to roughly ±0.5 ms/tick (one SD) across repetitions. The baseline slopes cross zero, which is expected when the signal is near 1 ms.

### 5.3 Incremental differences

These avoid a regression model entirely and are useful as a sanity check.

| Profile | Difference | n | Median (ms/tick) | Mean | Range |
| --- | --- | ---: | ---: | ---: | ---: |
| Stress | (batch 50 − batch 20) / 30 | 9 | 2.367 | 3.189 | 1.433–7.400 |
| Stress | (batch 100 − batch 50) / 50 | 9 | 2.820 | 2.447 | 0.740–3.480 |
| Baseline | (batch 50 − batch 20) / 30 | 9 | 0.100 | 0.111 | −0.067–0.333 |
| Baseline | (batch 100 − batch 50) / 50 | 10 | 0.120 | 0.178 | −0.300–0.600 |

The 20→50 stress increment is noisy (one repetition produced a 7.4 ms/tick increment), consistent with the first-tick burst and GC/JIT variation leaking into short batches. The 50→100 increment is the more stable steady-state comparison and agrees with the ≥20 regression.

## 6. Validity and isolation checks

| Check | Result |
| --- | --- |
| All 140 HTTP responses | **200** |
| Requested ticks vs completed ticks | **exact for all 140** (asserted by the harness) |
| Unique run id echoed | **yes for all 140** |
| Distinct checksums by batch | **yes**: 7 distinct stable states per profile |
| Same profile/batch across 10 reps | **one checksum per batch**, no variation |
| Baseline vs stress initial state | **distinct** checksums (`edf2025e4e6158c8` vs `6304954b1abca61b`) |
| Stress activity | real: 31 shots / 23 projectiles after 1 tick; 108 shots / 8 kills after 100 |
| Invalid profile | **400 `invalid-calibration`** |
| Invalid batch (2, 101) | **400 `invalid-calibration`** |
| Unauthenticated calibration | **403** |
| Simultaneous probe + calibrate | **400 `invalid-diagnostics`** |
| Plain `/status` | **200**, no `calibration` field |
| Game state in response | **no**; checksums, counts and activity only |
| Storage writes from calibration | **none** |
| Per-tick logs | **none** |

The focused A/B test builds the same deterministic state twice: once through a direct 20-tick loop and once through `runBatchCalibration`. Both produce the same `stateHash` checksum, tick count and live-unit count for both profiles. The calibration harness is not inserted into `RoomMatch.tick`; there is no instrumentation toggle in the simulation path. The existing `tests/phase2a2-diagnostics.test.ts` enabled/disabled diagnostics A/B remains the authoritative room-level A/B and passes.

## 7. Security, isolation and regression

- Calibration is reachable only through the existing authenticated admin status route; it is gated by `MP_DEV_MODE === '1'` and an admin bearer token.
- It is not a public endpoint, is not linked from the client page, accepts only two profile names and seven batch sizes, caps run ids at 48 characters, and exposes no game state, seat token, reservation data or capacity value.
- It runs only on a closed staging room. It does not create or join a match, does not touch `CommandGate`, and does not persist anything.
- `MULTIPLAYER_FEATURE.enabled` remains `false`. The production build still emits `dist/assets/index-DjlmK8Hv.js`; the calibration module is not in the production app entry.
- No production deploy, no plan upgrade, no billing change, no paid telemetry provider.
- Deployed smoke: **15/15 checks passed** on `febd117e`, including 101 upgrade, two seats, team isolation, command acceptance, forged-authority rejection, oversized-frame rejection, wrong-token 401, foreign-origin 403, duplicate-seat 409, resync, reconnect, first delta without map/full state, result delivery, reservation release and capacity boundary.
- Deployed lifecycle/capacity tests passed: reconnect recovery 121 ms; abandonment observed after 30.134 s with `victory/abandoned`; controlled shutdown; hard deadline 194 ticks / 9.739 s with draw/draw; resync 40 ms; capacity statuses `200, 200, 503, 200` with `capacity-full` and a freed slot.
- Local verification: TypeScript **PASS**; full suite **89 files / 900 tests PASS**; production build **PASS** (79 modules, `index-DjlmK8Hv.js`).
- All 140 calibration HTTP responses were 200; all 132 matched invocation outcomes were `ok`; the largest observed invocation CPU was **355 ms** (stress, batch 100), well below the observed execution limits. No calibration invocation errored.

No lifecycle, protocol, projection, command validation, reservation or determinism behaviour was changed by this phase.

**Overhead estimate.** The ordinary room tick path contains **no calibration work**: there is no hook, counter or log inside `Game.tick` or `RoomMatch.tick`. The calibration branch runs only when an administrator explicitly requests it. Its fixed invocation cost is the batch-0 control: **9.5 ms mean for baseline** and **7.4 ms mean for stress**, including scenario/`Game` construction, command setup, state hashing, routing and the response. That is the harness's fixed cost, not normal room overhead. The staging bundle contains the calibration module; the production bundle does not.

One implementation note: after collecting the deployed evidence, the local source was refactored to extract `createCalibrationGame` so the A/B test could run the exact same state through a direct tick loop. The extraction is behaviour-preserving and covered by the focused A/B test; the evidence below was collected from deployed version `febd117e`, whose calibration semantics are the same.

## 8. Comparison with Phase 2A.4

| Measure | Phase 2A.4 | Phase 2A.6 |
| --- | --- | --- |
| Evidence type | Real 30-minute 1v1 match, platform aggregate | 140 controlled fresh-`Game` invocations, per-invocation CPU |
| Population | Real match (16-ish starting units, growth over time) | Baseline 16 units; stress 80 units |
| CPU denominator | 35,994 ticks | 0–100 ticks per invocation |
| CPU result | 19.698 s aggregate; **0.547 ms/tick average** | Stress **2.66–2.72 ms/tick marginal**; baseline 0.14–0.18 ms/tick |
| Per-tick distribution | Not available | Not available |
| Per-tick maximum | Not available | Not available |
| Sampling/coverage | Platform minute aggregate; no invocation sampling | 132/140 exact invocations; 8 platform omissions |
| 10 ms target | Unverified | **Still unverified; stress first-tick evidence suggests >10 ms** |

The stress marginal is about **4.9×** the Phase 2A.4 average. That is not a contradiction: the stress profile has five times the units and opens with a prepared 80-unit mass engagement, while the 2A.4 average covers the whole match including quiet periods. The figures measure different workloads. Agreement with 0.547 ms/tick was not used as a validation criterion, and disagreement is not evidence that either measurement is wrong.

## 9. Capacity-planning interpretation

The estimates are **partially useful**, with strict limits:

- **Useful:** the stress slope is a reproducible, conservative marginal cost for a heavy 80-unit engagement. It is suitable for comparing workload profiles, catching a regression that raises per-tick cost, and bounding the CPU impact of adding units or combat activity.
- **Not useful for proof:** the baseline slope is near the 1 ms floor and crosses zero. It cannot resolve normal low-activity tick cost.
- **Not useful for concurrency:** this is one room, one isolate and one short run. It does not measure two concurrent rooms, tenant isolation, platform scheduling, memory pressure or the cost of snapshots/persistence (which were not part of the calibration batch).
- **Not proof of 10 ms headroom:** only aggregate marginal cost is available. A mean of 2.66 ms/tick does not prevent a 20 ms tick.

For illustration only, a linear extrapolation of the stress marginal over a 30-minute 20 Hz room is:

```text
2.661 ms/tick × 20 ticks/s × 1,800 s = 95.8 s CPU per room
```

This is **not a measurement** and not a forecast: the stress profile is a sustained mass engagement, not a normal match. The same arithmetic for the Phase 2A.4 average is 19.7 s, and for the baseline slope 5.4 s. The spread shows why the existing conservative two-room and 30-minute limits should not be relaxed from this result.

**Free-tier accounting.** The experiment used one 10 s staging room, 140 admin calibration invocations and 132 matched observations. Matched CPU was 7,784 ms (10,295 ms platform-weighted estimate for the sampled filter); matched wall time was 7,986 ms. The room was shut down before calibration and reservation `r139` is `released`. Workers Observability is built-in (Free-plan retention applies); no paid provider, plan change, billing activation or capacity-limit increase was used. These amounts are small relative to a 30-minute match, but they do not establish concurrent-room capacity.

## 10. Missing or unavailable measurements

| Measurement | Status |
| --- | --- |
| Individual tick CPU time | **Unavailable**; runtime clocks freeze during CPU-only work (Phase 2A.5) |
| Per-tick p50/p95/p99/max | **Unavailable** |
| Proof every tick <10 ms | **Not established** |
| Proof any specific normal-match tick <50 ms | **Not established** |
| Exact full-population invocation CPU | **Unavailable**; 8/140 sample records omitted by platform sampling |
| Exact setup-vs-tick split | **Estimated** by batch-0 control; setup variance remains |
| Memory / heap / allocation profile | **Not measured in this phase** |
| Concurrent-room CPU | **Not measured** |
| Snapshot/persistence CPU in the batch | **Not included**; the harness runs only the simulation |
| 30-minute soak | **Not run** in 2A.6; 2A.4/2A.5 already cover that workload |

## 11. Acceptance assessment

| Criterion | Result | Evidence |
| --- | --- | --- |
| Batch harness runs reproducible authoritative workloads | **PASS** | Real `Game`, 140 attempts, stable checksums by batch, real combat activity |
| Invocation CPU correctly correlated with completed batches | **PASS** | 132 exact run-id matches; tick counts asserted; 8 omissions documented, none imputed |
| Multiple batch sizes tested | **PASS** | 0, 1, 5, 10, 20, 50, 100; 10 reps each |
| Measurement resolution and invocation overhead investigated | **PASS** | 1 ms resolution; batch-0 controls 7.4/9.5 ms; intercepts and residuals reported |
| Estimation method and uncertainty documented | **PASS** | OLS fits, per-repetition slopes, 95% intervals, incremental differences, non-linearity |
| Baseline and representative stress evaluated | **PASS** | Baseline 16 units no commands; stress 80 units with real fire/casualties |
| Determinism and regression tests pass | **PASS** | Direct-loop A/B, stable checksums, 89 files / 900 tests, `tsc`, production build |
| Staging evidence and raw metrics preserved | **PASS** | CSV + SHA-256, query JSON, request log, samples, analysis, README |
| Estimates useful for capacity planning stated | **PASS** | Partially useful; not sufficient for concurrency or per-tick headroom |
| 10 ms individual-tick target remains unverified unless supported | **PASS (unresolved)** | Remains unverified; stress first-tick evidence suggests it is exceeded |

**Overall: PASS for the Phase 2A.6 measurement milestone. The 10 ms per-tick target is not verified and must not be reported as met.** This is not production readiness and does not establish support for multiple concurrent rooms.

## 12. Reproduction

```bash
# Confirm version and staging isolation
npx wrangler deployments list --config mp-room-wrangler.jsonc
curl -s https://mca-multiplayer-staging.horsemeninteractive.workers.dev/api/multiplayer/health

# Local verification
npx tsc --noEmit
npx vitest run
npm run build

# Deployed calibration (staging only; 10 reps, paced)
MP_CALIBRATION_REPS=10 MP_SAMPLE_INTERVAL_MS=500 \
  node tools/phase2a6-batch-calibration.mjs

# Join exact run ids to the Workers Observability export
node tools/phase2a6-analyse.mjs \
  staging-evidence/phase2a6-calibration-<stamp>/samples.json \
  staging-evidence/phase2a6-observability-10rep.csv \
  staging-evidence/phase2a6-calibration-<stamp>

# Deployed regression checks
node tools/phase2a-deployed-smoke.mjs
node tools/phase2a1-failure-tests.mjs
```

Do not deploy this configuration to production or enable `MULTIPLAYER_FEATURE`.

## 13. Evidence index

| Path | Contents |
| --- | --- |
| `staging-evidence/phase2a6-calibration-2026-10-30T13-56-52-136Z/observability-10rep.csv` | 132 raw matched invocation CPU/wall rows |
| `.../observability-query.json` | Exact query, timeframe, platform sample interval and checksum |
| `.../samples.json` | All 140 sample descriptors and deterministic counters |
| `.../requests.jsonl` | Timestamped harness and lifecycle events |
| `.../analysis.json` | Coverage, per-batch statistics, fits and per-repetition slopes |
| `.../README.md` | One-page evidence guide and reproduction |
| `staging-evidence/phase2a6-verification/deployment.txt` | Deployed version listing |
| `.../deployed-smoke.log` | 15 deployed security/lifecycle checks |
| `.../both-diagnostics.log` | Confirms `probe` + `calibrate` is rejected with 400 |
| `.../failure-tests.log` | Reconnect, abandonment, shutdown, deadline, resync, capacity |
| `.../vitest-final.log`, `.../build-final.log`, `.../tsc-final.log` | Final local verification |

Raw CSV integrity: 4,950 bytes, 132 rows, SHA-256 `9da78c99251c31b5f98bd63d400e415c52cef9bb48cd0f7744fc012ad2ce4805`.

## 14. Bottom line

The batch-calibration harness is valid and reproducible: it runs the real authoritative simulation, correlates exact invocations, and produces stable checksums. On the 80-unit stress profile the fitted marginal cost is **2.66–2.72 ms of invocation CPU per tick**, with a per-repetition spread of roughly ±0.5 ms. The low-activity baseline is **0.14–0.18 ms/tick**, but is too close to the 1 ms platform resolution to be a useful normal-match estimate.

The 10 ms target cannot be verified from invocation-level data. More importantly, the one-tick stress observation is not consistent with every tick fitting in 10 ms: the batch-1 invocation median was **31.5 ms**, and the batch-1-minus-batch-0 excess was **27 ms median (16–118 ms)** across ten repetitions. That is a synthetic 80-unit mass-engagement first tick, not a normal match tick, but it is strong evidence against a blanket claim of 10 ms headroom.

Keep the existing two-room and 30-minute staging limits. A separate, narrowly scoped investigation should profile the first mass-engagement tick (pathfinding, targeting, projectile creation) before any snapshot, capacity or lobby work. That investigation should not treat this batch estimate as a per-tick measurement, and it should not optimise based on a single soak.
