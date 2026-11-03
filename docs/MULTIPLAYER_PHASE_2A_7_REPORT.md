# MCA — Phase 2A.7: First Engagement Tick Profiling

**Overall status: PASS for the diagnosis milestone. The first-tick cost of the synthetic 80-unit stress workload is explained and attributed. The 10 ms per-tick CPU target remains UNVERIFIED.**

The Phase 2A.6 stress first tick was expensive for a specific, measured reason: it applies two full-force attack-move orders to 80 units in one tick, and 72 of those orders perform an A* search over the 96×72 map. The same 80-unit first tick with the queued orders removed is an ordinary ~1.6 ms local tick. The cost is a command-application burst, not first-tick initialisation and not a general per-tick baseline.

This phase made **no simulation, protocol, capacity or production changes**, and **did not deploy**. All profiling was local. Local sample shares are not Cloudflare Worker CPU measurements.

- Staging Worker: `mca-multiplayer-staging`
- Currently deployed version: `febd117e-8d8e-481e-ba88-c212df262073` (100% of staging traffic, unchanged since Phase 2A.6; created `2026-10-30T13:42:45.624Z`, deployed `2026-10-30T13:42:47.065Z`)
- Production multiplayer flag: **disabled** (`MULTIPLAYER_FEATURE.enabled === false`)
- Production bundle: **no calibration or profiling module** (identifier scan of `dist/assets/*.js` returned no matches)
- No production deployment, plan upgrade, billing change, paid telemetry, capacity change or committed file.

## 1. Workload and source revision

The profiled workload is the exact Phase 2A.6 calibration workload, not a simplified model.

| Property | Value |
| --- | --- |
| Scenario | `island-assault` ("Kestrel Bay"), 96×72 tiles, fog enabled |
| Units | 80 ground units: 16 scenario units + 64 deterministic added units (32 per side) |
| Orders | Two attack-move commands, one per team, each ordering that team's full force |
| Destination | Team 0 → `(44,44)` tiles; team 1 → `(36,44)` tiles |
| AI | Disabled in calibration |
| Seed | `scenario.settings.seed` from `createIslandAssault()` |
| Initial checksum | `6304954b1abca61b` |
| First-tick checksum | `87f80cac6f36c97b` |

Of the 80 ordered units, 72 receive a route and enter A*; 8 formation slots are rejected or unreachable, and those units end the tick idle with no order. The 8 do not perform a path search.

Source revision and pinning hashes:

| Item | Value |
| --- | --- |
| Git HEAD | `132ccc8363d5b5bc98b6518b4afd1738dedaad6a` (`master`) |
| Working tree | Uncommitted Phase 2A work preserved; no files staged or committed |
| `src/sim/game.ts` SHA-256 | `bd86717fedd51cac8da4b75fd10f1fb0414eabf09a6df828815a67896f8a2b7a` |
| `src/sim/pathfinding.ts` SHA-256 | `860eb1aa62c7efa1b35c207b5ba8942a1eb052a3aa8d61b8fbda75e07e438f39` |
| `src/sim/terrain.ts` SHA-256 | `5648a375e8b5c03e15be91bae399b930f0d002674ee5226814c948c6d6d08af7` |
| `src/multiplayer/batchCalibration.ts` SHA-256 | `05c679aabc0204c59ed10a83c719c402f74a40b38e2a94460cb8a1432e279471` |
| `src/data/scenarios.ts` SHA-256 | `49bb5ead76705c0380c997668047aa8ae9eb1b2b3256fff652e12d4e5e4f236c` |
| Profiling host | Node `v24.14.0`, `win32 x64`, AMD Custom APU 0405 |

**Refactor verification.** Phase 2A.6 records were collected from deployed `febd117e`, before `createCalibrationGame` was extracted. The current working tree was re-run through all 14 baseline/stress batch records (7 batch sizes × 2 profiles). Every final checksum, tick count, unit count, projectile count, shot count, kill count and command count matched the deployed record exactly (`refactor-equivalence.json`, `allMatch: true`). The refactor is behaviour-preserving for the calibration workload, and the profiled local first tick reproduces the deployed batch-1 checksum `87f80cac6f36c97b`.

## 2. Profiling method and limitations

**Method.** `tools/phase2a7-first-tick-profile.mjs` loads the real TypeScript simulation through Vite's SSR module loader and profiles exact calibration stages with V8's sampling CPU profiler through `node:inspector` (requested 100 µs interval; effective ~1.7 k samples/s). Repetitions are prepared before each profiling window, so construction and pre-ticks are not sampled; checksums are computed after the window. Samples whose top frame is the inspector transport are excluded. V8 precise coverage supplied call counts.

**This is local profiling evidence, not deployed CPU.**

- Samples are main-thread stack samples of a Node process. Sample shares are relative attribution inside a synchronous workload, not CPU seconds.
- Local elapsed values (medians, 20–40 repetitions per stage) are wall-clock context only. They were not converted into CPU time.
- Node on Windows is not the Cloudflare `workerd` isolate. Absolute local timings must not be substituted for deployed CPU.
- The profiler does not produce a per-tick CPU distribution, a per-tick maximum or a percentile timeline. The 10 ms per-tick target cannot be verified from this evidence.
- Ticks shorter than the sampling resolution are not attributable: the 16-unit baseline tick produced 3 samples across 20 repetitions, and result collection produced 0 samples. Those stages are reported as below resolution.
- V8 precise coverage counts for small, inlined helpers varied between runs. The outermost structural counts are consistent (`smoothPath` 72, `nearestWalkable` 144, `commandMove` 2, `updateUnits` 1); helper counts are treated as approximate and are not used to carry conclusions. `findPath`'s own coverage count varied between 61 and 73 across runs while `smoothPath` stayed at 72, so the number of A* searches is derived from `smoothPath`/ordered-unit structure, not from the `findPath` entry count.

**Deterministic A/B.** The profiler never runs inside `Game.tick`; it samples the process externally. A/B checks confirm that preparing 30 ticks before a measured tick 31 and then ticking to 50 produces exactly the same state as 50 direct ticks. Dropping the queued orders produces a different, but reproducible, first-tick state. See §9.

## 3. First-tick versus subsequent-tick results

Local medians; sample percentages are shares of non-transport samples.

| Stage | Ticks/rep | Reps | Local median | Samples/tick | Dominant work |
| --- | --- | --- | --- | --- | --- |
| Game construction, 16 units | 0 | 20 | 5.14 ms | 9.1 total | Scenario generation and initial vision |
| Game construction, 80 units | 0 | 20 | 8.64 ms | 13.6 total | Scenario generation and initial vision |
| Apply both queued orders only | 0 | 20 | 14.62 ms | 24.3 total | 89.9% pathfinding |
| First tick, 80 units, orders | 1 | 30 | **17.78 ms** | **29.5** | **76.4% pathfinding** |
| First tick, 80 units, no orders | 1 | 30 | **1.62 ms** | 2.8 | 57.1% units/combat |
| Second tick, after orders | 1 | 40 | 1.86 ms | 3.3 | 79.2% units |
| Steady tick 31 | 1 | 40 | 1.52 ms | 2.5 | 85.9% units |
| Steady batch, ticks 31–50 | 20 | 10 | 36.58 ms (1.83/tick) | 2.8 | 76.9% units |
| Combat batch, ticks 61–80 | 20 | 8 | 31.90 ms (1.60/tick) | 2.5 | 74.8% units; 1.3% projectiles |

**The first tick is approximately 11× the no-order first tick and approximately 10–12× the steady tick.** The order-application stage alone accounts for essentially the whole difference. The first tick contains no vision refresh (`VISION_INTERVAL = 10`), no unusual initialisation and no persistence; its extra work is the command burst.

The setup stages are separate one-off work: scenario generation, 80 entity spawns and the initial `refreshVision(true)` cost 8.64 ms locally. They are paid once per room/match construction and are not part of a normal tick.

## 4. Significant first-tick hotspots

First tick, 30 repetitions, 886 samples, local median 17.78 ms:

| Category | Share of samples |
| --- | --- |
| Pathfinding (`findPath`, `findPathFor`, `navFor`, heap, `stepCost`, corner checks, smoothing) | **76.41%** |
| Units (targeting, movement, steering, separation, turrets) | 10.95% |
| Terrain queries (`moveCost`, tile lookups) | 4.06% |
| Line-of-sight helper | 2.60% |
| Garbage collector | 2.03% |
| Command application | 1.58% |
| Other small helpers / inlined frames | 1.13% |
| Projectiles/combat | 0.79% |
| Buildings/economy | 0.34% |
| Runtime | 0.11% |

Top self-time frames:

| Function | Share | Notes |
| --- | --- | --- |
| `findPath` | 43.68% | A* main loop, including typed-array setup and closure |
| `diagonalBlocked` | 7.56% | Two additional `stepCost` checks per diagonal candidate |
| `stepCost` | 5.87% + 3.27% (inlined frame) | Movement cost, elevation and traffic checks |
| `navFor` | 4.63% | Builds a full 96×72 `soft` traffic mask per path request and scans all entities |
| `findPathFor` | 4.29% | Per-unit wrapper |
| `steerAroundUnits` | 3.72% | Entity scan per moving unit |
| `pop` / `push` (MinHeap) | 2.82% / 2.37% | Object-node heap operations |
| `hasLineOfSight` | 2.60% | Shared line-of-sight helper (gunnery in this stage) |
| `moveCost` | 2.48% | Terrain/elevation cost lookup |
| `acquireAutoTarget` | 2.37% | Entity scan for automatic engagement |
| `(garbage collector)` | 2.03% | Sampling attribution; not a retained-heap measure |

**Structural call trace.** The two commands order 80 units. `commandMove` validates each formation destination; 8 slots are rejected or have no route, leaving those units idle with no order. The remaining 72 enter `findPathFor`, which calls `navFor`, `nearestWalkable` and `findPath`. Coverage recorded 72 `smoothPath` completions and 144 `nearestWalkable` entries (two per search, one in `findPathFor` and one inside `findPath`), confirming 72 A* searches. One clean coverage run recorded 10,398 `stepCost` and 8,852 `diagonalBlocked` entries; those helper counts varied between runs and are illustrative, not exact.

Each A* search allocates `gScore` (`Float32Array`, 6,912 entries ≈ 27.6 KB), `cameFrom` (`Int32Array` ≈ 27.6 KB) and `closed` (`Uint8Array` ≈ 6.9 KB), plus object nodes for the heap. `navFor` additionally allocates a 6,912-byte traffic mask and scans all 80 entities per request. Across 72 searches that is roughly 4.5 MB of A* typed arrays plus ~0.5 MB of traffic masks, before heap objects and smoothing allocations. GC accounted for 2.03% of first-tick samples in this run: allocation churn is present, but it is not the dominant cost and says nothing about retained memory.

The same work measured in isolation (`apply-commands-stress`) is 89.9% pathfinding and 14.62 ms locally. The first-tick pathfinding share is slightly lower because the ordinary tick work (movement, targeting, engagement) runs in the same tick. `findPath` alone is 50.6% of the isolated command stage.

## 5. One-off versus recurring work

**One-off per order burst:**

- 72 A* searches, 144 nearest-walkable searches, 72 path smoothings.
- 72 `navFor` traffic masks and full-entity scans.
- 72 typed-array A* allocations and associated heap nodes.
- No pathfinding occurs in ticks 2–80 of this scenario: coverage records zero `findPath`, `nearestWalkable`, `stepCost`, `diagonalBlocked`, `lineClear` or `smoothPath` entries in ticks 31–50. The burst is one-off because no unit requests another route; a repath after prolonged blockage would repeat it.

**One-off per room/match construction:**

- `createIslandAssault` terrain and feature generation, entity spawning and the initial fog stamp.
- In the 80-unit setup stage: `createIslandAssault` 23.5%, line-of-sight helper 14.7% (initial vision), `stampVision` 9.9%, `waterNeighbour` 9.2%, `createCalibrationGame` 5.9%, `landNeighbour` 5.9%, `get` 5.5% + 3.7%, `refreshVision` 5.5%, `refreshVisibleEntities` 2.6%, `set` 2.2%.

**Recurring per tick:**

| Function/subsystem | Steady batch (31–50) | Combat batch (61–80) | Second tick |
| --- | --- | --- | --- |
| `steerAroundUnits` | 27.94% | 30.98% | 24.62% |
| `moveAlongPath` | 14.41% | 11.59% | 8.46% |
| `acquireAutoTarget` | 12.10% | 9.32% | 14.62% |
| line-of-sight helper | 8.19% | 8.56% | 6.15% |
| `separateUnits` | 6.76% | 6.05% | 8.46% |
| `updateUnits` | 3.91% | 5.79% | 6.15% |
| `canOccupy` | 3.91% | 2.02% | 3.08% |
| `updateAutoEngagement` | 3.02% | 5.29% | 6.15% |
| vision (`stampVision`/`refreshVision`) | 4.27% | 4.79% | — |
| projectiles/combat | 1.07% | 1.26% | 3.08% |
| GC | <0.5% | <0.5% | <0.5% |

The recurring profile is dominated by units, not pathfinding: steering around nearby units, path following, automatic target acquisition, separation and gunnery line-of-sight checks. `steerAroundUnits` is the single largest recurring frame at roughly a quarter to a third of steady-tick samples; it scans every entity for each moving unit. `acquireAutoTarget` scans entities for each armed unit each tick. No pathfinding, snapshot serialisation or persistence work occurs in these ticks.

## 6. Does cost scale with unit count, command count or engagement complexity?

A controlled probe varied only the number of ordered team-0 ground units, holding the state and destination fixed. It is a pathfinding probe, not a full tick.

| Ordered ground units | Local median | Samples | Relative to 9 |
| --- | --- | --- | --- |
| 9 | 2.25 ms | 116 | 1.00× |
| 18 | 3.55 ms | 197 | 1.58× |
| 27 | 5.00 ms | 254 | 2.23× |
| 36 | 5.40 ms | 299 | 2.40× |

Cost rises with the number of ordered units, but the shape is not a clean line: larger formations spread over different tiles, so route lengths and A* expansion counts differ between group sizes, and the local medians varied between runs. The important result is that the cost follows **path requests/ordered units**, not the number of ticks, not the fact that it is tick 1, and not the two command messages themselves. A two-command burst over 72 ground units is expensive; two commands over a handful of units would not be.

## 7. Representativeness of the synthetic workload

The stress profile is deliberately heavier than a normal match opening:

- A normal match starts with 16 units and orders arrive gradually, usually for a handful of selected units. The calibration adds 64 units in a prepared southern engagement and gives both sides a full-force attack-move on the first authoritative tick.
- The 80-unit mass order is a worst-case command burst. A real player can box-select a large force and attack-move, and coordinated late-game assaults can be large, so the mechanism is realistic; the simultaneous two-sided 72-path burst at tick 1 is not a typical opening.
- The Phase 2A.4 room's aggregate 0.547 ms/tick average covers a whole match, including quiet periods and ordinary commands. The Phase 2A.6 marginal 2.66–2.72 ms/tick describes the sustained 80-unit stress engagement. Neither is a per-tick maximum, and neither is contradicted by this profile.

**Conclusion:** the Phase 2A.6 batch-1 result (median 31.5 ms invocation CPU, 27 ms excess over the setup control) is consistent with this command burst, but it is a synthetic worst case, not evidence that ordinary match ticks exceed 10 ms. It is also not evidence that they stay below 10 ms: that remains unmeasured.

## 8. Optimisation candidates, ranked by evidence and risk

No optimisation was implemented. These are proposals for separate, narrowly scoped tasks.

| Candidate | Evidence | Expected benefit | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| Build the `soft` traffic mask once per command/tick and share it across path requests, instead of per `navFor` | `navFor` 4.63% self in the first tick; 72 full-map allocations and 72 full-entity scans per burst | Removes most `navFor` work and ~0.5 MB of short-lived masks per burst | **Medium**: self-exclusion and moving/idle markings differ per unit, so paths would change. Requires path-equality tests and a deliberate gameplay/determinism decision. | Best first pathfinding task, but not a drop-in change. |
| Replace the object-node `MinHeap` with parallel typed arrays or a reusable node pool | `push`+`pop` ≈ 5.2% of first-tick samples; GC 2.03% | Lower allocation and GC during every path burst | **Low–medium**: heap order and tie-breaking must remain bit-identical | Good isolated optimisation with strong A/B checksum coverage. |
| Add a deterministic spatial index/bucket grid for `steerAroundUnits`, `acquireAutoTarget` and `separateUnits` | These three are 25–31%, 9–15% and 6–8% of recurring samples | Largest recurring CPU reduction; scales with unit density | **Medium–high**: nearest-obstacle/target selection, iteration order and tie-breaking must be preserved exactly | Highest recurring payoff; needs its own design and replay-equivalence phase. |
| Spread pathfinding across several ticks with a bounded per-tick path budget | 72 searches in one tick cost 14.6 ms in isolation | Reduces peak tick cost, not total CPU | **High**: changes when units start moving and therefore gameplay; may also delay orders | Only if peak latency remains a problem after cheaper fixes; not recommended as a first step. |
| Precompute static per-move-class terrain step costs | `moveCost`/terrain categories ≈ 4.1–6.6% of first-tick samples | Small reduction in A* inner-loop cost | **Medium**: larger terrain/pathfinding refactor; must preserve elevation and traffic rules | Low priority relative to the candidates above. |

Not acceptable: reducing simulation frequency, skipping systems, weakening pathfinding quality or target evaluation, removing combat/projectile behaviour, changing RNG consumption or tick ordering, or moving authoritative decisions to clients.

The recurring hotspot distribution also suggests that pathfinding alone is not the whole performance story: a normal heavy engagement spends most of its tick in unit steering, targeting and separation. A future optimisation phase should choose one of those independently rather than combining transport, pathfinding and steering changes.

## 9. Determinism and regression results

**Profiled vs non-profiled A/B.** Every one of the 30 profiled first-tick repetitions produced `87f80cac6f36c97b`, identical to the non-profiled calibration batch-1 result and the deployed Phase 2A.6 record. The 14-record equivalence also matched completed tick counts, surviving unit/projectile counts, shot/kill counters and command counts. The state hash covers entity state and orders, projectiles, player stats and RNG state, so this is a strong check that external profiling did not change command, combat or projectile outcomes; event-log equality is not covered by the hash.

| Check | Result |
| --- | --- |
| Focused Phase 2A.7 tests | **4/4 passed** (`tests/phase2a7-first-tick-profiling.test.ts`, re-run after the final edit) |
| Full test suite | **90 files / 904 tests passed** (119.04 s) |
| TypeScript typecheck | **Passed** (`tsc --noEmit`, part of build) |
| Production build | **Passed**; 79 modules, `dist/assets/index-DjlmK8Hv.js` 650.61 kB (194.68 kB gzip) |
| Production bundle scan | No `fresh-game-batch`, `runBatchCalibration`, `createCalibrationGame` or profiling identifiers |
| Refactor equivalence | **14/14 records match** deployed Phase 2A.6 checksums and activity counts |
| Profiled first tick vs deployed | Local `87f80cac6f36c97b` equals deployed stress batch-1 checksum |
| A/B pre-tick preparation | 30 pre-ticks + measured tick 31 + 19 ticks = same state as 50 direct ticks |
| A/B order burst | Both ordered and no-order variants are deterministic; no-order state differs as expected |
| Workload structure | 80 units ordered; 72 enter A*; 8 idle with no order; all 30 first-tick repetitions produce one checksum |
| Staging deployment | Unchanged `febd117e`; no deployment in this phase |
| Feature flag / capacity | `MULTIPLAYER_FEATURE.enabled === false`; no capacity, deadline or reservation changes |
| Files staged/committed | None |

## 10. Remaining uncertainty

- **No deployed per-tick CPU measurement.** This phase attributes the composition of the burst locally. It does not measure workerd CPU, JIT behaviour, GC or invocation scheduling. Deployed CPU-per-tick and the 10 ms target remain unverified.
- **No retained-heap measurement.** The GC category is sampled main-thread work, not allocation bytes or retained heap. Nothing here resolves or explains Phase 2A.2/2A.3 memory observations.
- **Local absolute timings differ from deployed.** Node measured 17.78 ms for the first stress tick; Phase 2A.6's deployed batch-1 invocation was 31.5 ms median including setup, routing and response. The two are not interchangeable.
- **Synthetic workload.** Normal command sizes, arrival times and unit compositions are not represented by a two-sided 72-path burst at tick 1. The profile cannot establish normal-match headroom.
- **Scaling probe is not a precision benchmark.** Formation geometry, route length and JIT state differ between group sizes; the monotonic trend is more trustworthy than the exact ratios.
- **Coverage counts are approximate for inlined helpers.** Only structural counts (`smoothPath` 72, `nearestWalkable` 144, `commandMove` 2, `updateUnits` 1) are used as facts; per-helper counts varied between runs.
- **Baseline and result-collection stages** are below the local sampling resolution and are not attributed.

## 11. Acceptance checklist

| Criterion | Result |
| --- | --- |
| First-tick execution path traced | **PASS** — construction → enqueue → `processCommands` → `commandMove` → `formationPoints` → `findPathFor` → `navFor` → `findPath` (A*) → tick systems |
| First-tick and steady-state workloads compared | **PASS** — 17.78 ms vs 1.52–1.86 ms, with a 1.62 ms no-order control |
| Significant hotspots supported by profiling evidence | **PASS** — 76.4% pathfinding; `findPath` 43.7% self; `navFor`/corner checks/heap also measured |
| One-off and recurring costs distinguished | **PASS** — order burst, setup and recurring unit/vision work separated |
| Source refactor and profiling harness verified | **PASS** — 14/14 deployed checksums match; deterministic A/B tests |
| Deterministic A/B checks pass | **PASS** |
| Full suite, typecheck and production build pass | **PASS** |
| No production or capacity changes | **PASS** — no deployment, flag false, limits untouched |

## 12. Reproduction commands and evidence

```bash
# Local profiling (writes a timestamped staging-evidence directory)
node tools/phase2a7-first-tick-profile.mjs

# Focused determinism/A-B checks
npx vitest run tests/phase2a7-first-tick-profiling.test.ts

# Full verification
npm test
npm run build

# Confirm the unchanged staging deployment (read-only)
npx wrangler deployments list --config mp-room-wrangler.jsonc
```

Evidence directory: `staging-evidence/phase2a7-profile-2026-10-30T16-31-56-726Z/`

| File | Contents |
| --- | --- |
| `README.md` | Method, stage totals, attribution tables, scaling probe |
| `stages.json` | Raw per-stage measurements, checksums, category and function shares |
| `coverage-counts.json` | V8 precise coverage call counts for the three key stages |
| `refactor-equivalence.json` | Current-source vs deployed Phase 2A.6 checksums and counts |
| `run-meta.json` | Git HEAD, source hashes, host, sampling method |
| `cpu-profiles/*.cpuprofile` | Raw V8 profiles for first-tick, no-command, steady-batch and combat-batch stages |
| `full-test-suite.log`, `build.log` | Full verification logs |

No tokens, credentials, account identifiers or private environment values are included in the evidence or this report.

## Bottom line

The Phase 2A.6 first-tick anomaly is real but narrow. It is the cost of applying two large attack-move orders at once: 72 synchronous A* searches, each rebuilding a traffic mask and allocating map-sized typed arrays. The ordinary 80-unit tick, including combat and casualties, is roughly 1.5–1.9 ms locally and is dominated by recurring steering, targeting and separation work. The 10 ms per-tick target remains unverified; the synthetic first-tick burst is not evidence that normal match ticks fail it, and the steady measurements are not evidence that they meet it. A separate, narrowly scoped pathfinding optimisation (shared traffic mask and/or allocation-free heap) is the best-supported next step, with a realistic-command soak needed before any per-tick CPU claim.
