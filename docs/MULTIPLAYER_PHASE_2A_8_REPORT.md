# MCA — Phase 2A.8: Pathfinding Allocation Optimisation

**Overall status: PASS for the local optimisation milestone. Both changes preserve exact pathfinding and authoritative simulation behaviour. The 10 ms deployed per-tick CPU target remains UNVERIFIED. No deployment, staging change, feature activation or commit was made.**

Phase 2A.7 showed that the expensive first tick of the synthetic 80-unit workload is a command-application burst: two attack-move orders produce 72 accepted formation routes, and those routes dominate the tick. This phase removed two pieces of avoidable work from that burst:

1. **Optimisation A — one traffic-mask scan per command**, instead of one full entity scan and full-map soft mask per path request.
2. **Optimisation B — a typed-array A\* heap**, removing the object allocated for every heap push while preserving the old heap ordering and tie behaviour exactly.

The changes are small and local: a new `NavBatch`, a rewritten `MinHeap`, integration at `commandMove`/`canOrderMove`, and tests. No movement, combat, formation, command-acceptance, tick-rate, protocol, snapshot, reservation or feature-flag rule changed.

- Git HEAD: `132ccc8363d5b5bc98b6518b4afd1738dedaad6a` (`master`)
- Working tree: uncommitted; nothing staged or committed
- Production multiplayer flag: **disabled** (`MULTIPLAYER_FEATURE.enabled === false`)
- Staging deployment: **none**
- Production deployment: **none**
- Production bundle: no calibration, clock-probe or profiling module markers

---

## 1. Workload and source revision

The equivalence workload is the exact Phase 2A.6/2A.7 calibration workload, not a simplified pathfinding substitute.

| Property | Value |
| --- | --- |
| Scenario | `island-assault` (“Kestrel Bay”), 96 × 72 tiles, fog enabled |
| Units | 80 ground units (16 scenario + 64 deterministic added, 32 per side) |
| Orders | Two attack-move commands; team 0 → `(44,44)`, team 1 → `(36,44)` |
| Accepted routes | 72; 8 formation slots rejected or unreachable and left idle |
| AI | Disabled in calibration |
| Initial checksum | `6304954b1abca61b` |
| First-tick checksum | `87f80cac6f36c97b` |
| Tick-100 checksum | `f2ebf1b38061a80f` |

The pre-optimisation reference was reconstructed from the working tree in `tmp/phase2a8-old` by reversing only this phase’s edits. That tree reproduces every prior calibration checksum and the Phase 2A.7 path-scaling checksums, so it is a valid old-versus-new oracle. The frozen fixture at `tests/fixtures/phase2a8-path-baseline.json` was captured from that tree. `tests/pathfinding-reference.ts` is a verbatim copy of the old A\* and object-node heap for direct comparison.

Final source hashes:

| File | SHA-256 |
| --- | --- |
| `src/sim/game.ts` | `1450fb913285b3a9ae7f1d037de65db0abbe10b52ef5a647b82ce87bb77842ef` |
| `src/sim/pathfinding.ts` | `6bd4cb4ecac8c2f39f53a39e8d0b13ec091cffd41ea6f08896667b78f759faaf` |
| `src/sim/navBatch.ts` | `1c2417c57543c4cfb66b4a039d0d0cff0dbe596d2c13b28e99f0f16e85ec2469` |

---

## 2. Optimisation A — command-scoped traffic mask

### Design

`src/sim/navBatch.ts` builds the soft-traffic data once for a command:

- One pass over `state.entities`, preserving the old filters: live, non-garrisoned units that are not hostile to the ordering owner.
- One `Uint8Array` mask per movement domain, because land and sea requests genuinely use different masks. Air is omitted: `Game.findPathFor` returns before reading traffic for aircraft.
- Values are `0` absent, `1` holding position, `2` moving, matching the old `navFor`.
- Units are linked per tile in entity iteration order. The old scan used **last-writer-wins** when entities shared a tile; the batch stores the per-tile list so a later state change can recover the same last writer rather than substituting a “highest traffic wins” rule.
- `refresh(id, moving)` recomputes only the changed unit’s tile when `commandMove` marks it moving (or refuses its route). Other units and tiles are not rescanned.

`Game.commandMove` and `Game.canOrderMove` create one batch for a command with at least four non-air selected units. Below that threshold the batch bookkeeping costs more than the one mask it replaces, so the old per-request path is used. An all-air command does not create a batch at all.

### Lifetime and invalidation

The batch is a local variable in one synchronous command call. It is created after formation points are computed, used for that command’s path requests, updated in the same entity order as the old scan, then dropped. There is no module-level cache, static state, timer or asynchronous work. A later command, tick, match or `Game` instance cannot see it. Entity positions do not change inside `commandMove`; only `state`/`path` flags change, and those are the flags `refresh` tracks. This is the complete invalidation requirement.

### One deliberate difference

The old per-request mask skipped `other === e`. The shared mask necessarily includes the requesting unit on its own origin tile. This cannot change a route:

- A\* closes the origin before expanding neighbours, so the origin’s soft value is never charged.
- `nearestWalkable` does not read soft traffic.
- `lineClear` treats soft traffic as a cost preference, never as passability, so its boolean result is unaffected.

The exact path tests confirm the claim rather than relying on the argument.

---

## 3. Optimisation B — allocation-efficient A\* heap

`MinHeap` now stores node indices in an `Int32Array` and priorities in a `Float64Array`, with a logical count and doubling growth. The previous object node is gone.

The ordering is intentionally unchanged:

- Push bubbles only while `parent.f > child.f` (strict), so equal priorities do not bubble.
- Pop sifts with strict `<` comparisons, so equal priorities do not sink.
- The heap is not stable-sorted and no insertion counter was added; the exact old pop order for equal priorities is preserved by preserving the same tree comparisons and swaps.
- `pop()` returns `-1` when empty; callers already stop on an empty open set.
- Each A\* search owns its heap. No heap or scratch array is shared between searches, so nested or interleaved path requests cannot corrupt one another.
- The heap is bounded by the open set and grows only by doubling; the map itself bounds the number of distinct tile nodes.

A\* costs, heuristic, diagonal rules, neighbour order, node limit, path reconstruction and smoothing are unchanged.

---

## 4. Exact equivalence evidence

### 4.1 Path equality

`tests/phase2a8-path-equivalence.test.ts` compares the optimised `findPath` with both the frozen fixture and `tests/pathfinding-reference.ts`.

Covered cases:

1. Open terrain.
2. Obstacle with a gap.
3. Diagonal movement and diagonal corner blocking.
4. Narrow corridor.
5. Unreachable wall.
6. Multiple equal-cost detours.
7. Foot, tracked, wheeled and naval movement profiles.
8. Forest and road terrain costs, elevation limits.
9. Dynamic soft traffic.
10. Blocked goal / nearest walkable tile.
11. Start equal to goal.
12. Node limit / incomplete search.
13. Forty-eight deterministic fuzz maps mixing obstacles, terrain, elevation and traffic.

For every case the ordered coordinate list, existence/null result and `pathLength` match the old implementation exactly. Because the ordered path is identical, the step-cost total is identical as well. Five repeated searches on each fixture produce the same result, and separate calls do not leak heap state.

### 4.2 Stress and baseline simulation

`tests/phase2a8-simulation-equivalence.test.ts` checks the whole authoritative state, not only paths:

- Initial, tick 1, 2, 3, 10, 30, 60 and 100 checksums for the 80-unit stress run.
- All 72 first-tick unit paths, states, orders and destinations.
- Tick-100 paths and a summary containing live units, buildings, projectiles, next entity/projectile ids, event sequence, RNG state, victory, casualties, kills and event counts.
- Two independent stress runs produce identical hashes, paths and summaries.
- The 16-unit baseline at ticks 0, 1, 2, 10, 30 and 100.
- The 9, 18, 27 and 36 ordered-unit scaling probe: exact paths, checksum and summary. The old fixture produced 6, 16, 21 and 29 non-empty paths respectively; the new code produces the same.

Recorded stress checksums all match:

| Tick | Checksum |
| --- | --- |
| 0 | `6304954b1abca61b` |
| 1 | `87f80cac6f36c97b` |
| 2 | `ca4d3026c33411f5` |
| 3 | `9522a707e3d71df7` |
| 10 | `eafac198ac5ef0be` |
| 30 | `7e9b851a20ad796f` |
| 60 | `35094cc41c5b778b` |
| 100 | `f2ebf1b38061a80f` |

The 16-unit baseline also matches (`edf2025e4e6158c8`, `abb91c76fc8af3e3`, `cc19b919581d1d61`, `d53cf1b67430683f` at ticks 0, 1, 10 and 100). The 80-unit first tick still has 72 ordered units and at least 8 idle rejected slots.

### 4.3 Determinism tests

`tests/phase2a8-nav-batch.test.ts` covers last-writer-wins on shared tiles, domain isolation, the case where an earlier writer changes but does not own the tile, unknown ids, empty batches and no state sharing between batches.

The complete suite result after the final source change:

- **933 tests passed, 93 files** (`npm test`)
- **TypeScript typecheck passed** (`npx tsc --noEmit`)
- **Production build passed** (`npm run build`)
- Bundle scan found no `batchCalibration`, `clockProbe`, `phase2a*`, `MULTIPLAYER_FEATURE` or `roomDiagnostics` markers in `dist/assets/*.js`.

---

## 5. Performance evidence

All numbers in this section are **local Node wall-clock measurements**, not Cloudflare Worker CPU time. The local host is Node `v24.14.0`, `win32 x64`, AMD Custom APU 0405.

### 5.1 Interleaved old/new benchmark

`tools/phase2a8-pathfinding-benchmark.mjs` loads the reconstructed old tree and the current tree in one process. Each block prepares fresh worlds outside the timed window, runs a batch of real commands or ticks, alternates old/new order, and forces a GC before the timed window. Four runs were taken. The latest:

| Task | Old | New | Change |
| --- | --- | --- | --- |
| Apply both stress orders (80 units) | 15.692 ms | 15.138 ms | −3.5% |
| First stress tick | 17.408 ms | 14.989 ms | **−13.9%** |
| First tick, no orders | 2.758 ms | 2.008 ms | −27.2% (no path work; treated as harness variance) |
| Single-unit order | 0.012 ms | 0.009 ms | noise; batch is disabled below 4 units |
| Path scaling, 9 units | 3.372 ms | 2.907 ms | −13.8% |
| Path scaling, 36 units | 6.436 ms | 6.027 ms | −6.4% |
| Traffic-mask prep, 36 requests | 1.653 ms | 0.267 ms | **−83.8%** |
| Pure A\* (dynamic-traffic fixture, 2,000 searches) | 61.977 ms/1k | 60.980 ms/1k | −1.6% |

Across the four runs the ranges were:

- Command application: **−3.5% to −12.8%**
- First stress tick: **−12.3% to −13.9%**
- 9-unit path scaling: **−11.6% to −19.4%**
- 36-unit path scaling: **−5.4% to −8.3%**
- Mask preparation: **−80.9% to −90.4%**
- Pure A\*: **−5.6% to +5.5%**

The command-application stage is only a few milliseconds of A\* work and is the noisiest game-level row. The first-tick, scaling and mask-preparation results are consistent in direction and magnitude. The pure A\* row does not show a reliable CPU win: the heap change is primarily an allocation change, and on the small dynamic-traffic fixture search cost is dominated by tile evaluation rather than heap operations. That is reported as a neutral performance result, not a claimed speedup.

### 5.2 V8 profiler stages

The same Phase 2A.7 harness was run against the pre-optimisation tree and the final source. Medians over the harness’s repeated preparations:

| Stage | Before | After | Change |
| --- | --- | --- | --- |
| Apply both stress orders | 18.777 ms | 15.459 ms | **−17.7%** |
| First stress tick | 20.504 ms | 17.098 ms | **−16.6%** |
| First tick, no orders | 1.945 ms | 1.706 ms | −12.3% |
| Path scaling, 9 | 2.047 ms | 1.680 ms | −17.9% |
| Path scaling, 18 | 3.982 ms | 3.471 ms | −12.8% |
| Path scaling, 27 | 6.355 ms | 4.154 ms | −34.6% |
| Path scaling, 36 | 7.137 ms | 5.125 ms | **−28.2%** |
| Steady batch, 20 ticks | 45.035 ms | 33.739 ms | −25.1% |
| Combat batch, 20 ticks | 36.292 ms | 36.882 ms | +1.6% |

The first-tick sample share attributed to pathfinding fell from 73.66% to 69.14%, and the GC share fell from 3.37% to 2.99%. Combat-batch work is unchanged in source, so its +1.6% is treated as run variance.

**Profiler variance.** One intermediate post-change profiler run measured the first stress tick at 20.53 ms, while the final run measured 17.10 ms against the same 20.50 ms pre-change result. The profiler is not a stable per-stage timer across process runs. The interleaved A/B benchmark is the primary performance evidence; the profiler is corroborating for command application, scaling and allocation direction.

### 5.3 Allocation

**Traffic masks (direct external-memory measurement).** A 96 × 72 soft mask is 6,912 bytes. The benchmark measured the external-memory delta for 36 old per-request masks and one new batch:

| Variant | Measured external delta | Structural expectation |
| --- | --- | --- |
| Old, 36 requests | **248,832 B** | 36 × 6,912 B |
| New, one batch | **6,912 B** | 1 × 6,912 B |

For the full 80-unit order, 72 old requests would allocate 497,664 B of masks. The two commands now allocate two domain masks (13,824 B) plus small per-command maps/lists. This is the ~0.5 MB per burst attributed in Phase 2A.7.

**Heap nodes (derived from old coverage and code structure).** Phase 2A.7 coverage recorded 4,218 heap `push` calls and 2,927 `pop` calls for the first stress tick. The old implementation allocated one `{ index, f }` object for every push. The new heap allocates two typed arrays per A\* search: 64 indices (256 B) and 64 Float64 scores (512 B), growing by doubling only if the open set exceeds 64. Across 72 searches the initial typed-array backing stores are about 55 KB, with growth copies rather than per-node objects. This is a derived allocation estimate, not a direct byte measurement of every heap.

**Coarse heap delta.** The one-burst `heapUsed` observation after forced GC was about **14.4 MB old vs 9.9 MB new** across four runs. This delta includes retained path arrays, command events and unreclaimed setup/JIT state; it is a direction-and-scale check only, not an allocation-accounting result.

---

## 6. Comparison with Phase 2A.7 and Phase 2A.6

Phase 2A.7’s recorded local baseline was 17.78 ms for the first stress tick and 14.62 ms for order application. A fresh pre-change run on this host measured 20.50 ms and 18.78 ms, so the comparison uses the fresh before/after pair rather than mixing machines or runs.

- The first stress tick measured **17.10 ms** after the change, down from **20.50 ms** in the fresh pre-change run.
- Order application measured **15.46 ms** after, down from **18.78 ms**.
- Phase 2A.7’s deployed-runtime context remains: 19.698 s aggregate platform CPU over 35,994 ticks, about 0.547 ms per tick. Nothing in this local phase changes that figure or proves a deployed per-tick maximum.

The 10 ms individual-tick CPU target is still unverified. This phase did not measure deployed Worker CPU, did not run a staging soak, and did not claim that local wall-clock improvements translate one-for-one into Cloudflare CPU.

---

## 7. Scope, regression and safety

- No movement, combat, targeting, formation layout, slot assignment, command acceptance/rejection, RNG consumption, entity ordering, tick frequency or pathfinding quality rule changed.
- No multiplayer protocol, snapshot, delta, keepalive, reconnect, abandonment, deadline or reservation behaviour changed.
- No room capacity, daily allowance or feature flag changed; `MULTIPLAYER_FEATURE.enabled` remains `false`.
- No paid service, dependency, observability product or billing change.
- Single-player uses the same `Game` and passed the full suite, including AI, campaign, construction, combat, save/determinism and performance tests.
- The production bundle contains no calibration or profiling code.
- No staging or production deployment was performed; no file was staged or committed.

The only production-code files touched are `src/sim/game.ts`, `src/sim/pathfinding.ts` and the new `src/sim/navBatch.ts`. The rest are tests, fixture and local tools/evidence.

---

## 8. Limitations

1. **No deployed measurement.** Every timing here is local Node wall-clock. The Phase 2A.5 clock finding still applies: the deployed Durable Object clocks do not provide per-tick CPU, and no new deployed profiling method was introduced in this phase.
2. **No 10 ms proof.** Individual tick maxima and percentiles remain unmeasured. The aggregate deployed 0.547 ms/tick figure is not a maximum.
3. **A\* CPU is not reliably improved.** The heap change removes per-push objects, but the pure A\* microbenchmark ranged from −5.6% to +5.5%. The allocation reduction is real; the CPU benefit on short searches is not established.
4. **Benchmark variance.** Command application is the noisiest game-level row (3.5–12.8% improvement). First-tick, mask preparation and scaling rows are consistent. Profiler stage medians vary enough between runs that only the interleaved A/B is used for the primary claim.
5. **Coarse heap numbers.** The 14.4 → 9.9 MB heap delta is not exact allocation accounting; typed-array backing stores are external memory, and retained path/event arrays differ by workload.
6. **Batch threshold.** Commands below four non-air units retain the old per-request mask. All-air commands create no batch. This intentionally avoids a small-command regression but means the optimisation does not cover every possible path request.
7. **Reference tree is local.** `tmp/phase2a8-old` is a reconstructed pre-optimisation tree used by the benchmark; it is not part of the product build. The frozen fixture and `tests/pathfinding-reference.ts` are the durable oracles.

---

## 9. Acceptance criteria

| Criterion | Result |
| --- | --- |
| 1. Traffic-mask construction shared safely across equivalent requests | **Pass.** One scan per command, one mask per domain, call-scoped lifetime. |
| 2. Repeated entity scans reduced | **Pass.** 36-request mask prep measured 248,832 B → 6,912 B external and 1.65 ms → 0.27 ms. |
| 3. Per-node heap object allocation removed or materially reduced | **Pass.** Object nodes replaced by parallel typed arrays; exact tie behaviour preserved. |
| 4. Exact path equality across the test matrix | **Pass.** 14 named cases, 48 fuzz maps, scaling probes. |
| 5. 80-unit stress produces identical authoritative results | **Pass.** Paths, summaries and checksums through tick 100. |
| 6. Deterministic checksums match | **Pass.** All recorded stress and baseline hashes. |
| 7. Allocation and performance show reproducible improvement | **Pass for allocation and first-tick/mask preparation; command application is smaller and noisier.** |
| 8. No meaningful regression in baseline or other scenarios | **Pass in the full suite; combat-batch profiler row was +1.6% and is treated as variance.** |
| 9. Full tests, typecheck and build pass | **Pass.** 933 tests, typecheck, production build. |
| 10. No production, protocol, capacity or feature-flag changes | **Pass.** No deployment; flag false; no protocol/capacity edits. |

**Conclusion: both optimisations meet exact behavioural equivalence. Optimisation A gives a large, repeatable reduction in traffic-mask construction and allocation. Optimisation B removes per-node heap objects and preserves A\* results exactly, but its CPU benefit is not reliably measurable on this workload. The deployed 10 ms per-tick target remains unverified.**

---

## 10. Files and evidence

Implementation:

- `src/sim/navBatch.ts` — command-scoped traffic batch.
- `src/sim/pathfinding.ts` — typed-array heap, same A\* comparisons.
- `src/sim/game.ts` — batch creation, refresh after command state changes, threshold and air guard.

Tests and oracle:

- `tests/phase2a8-path-equivalence.test.ts`
- `tests/phase2a8-nav-batch.test.ts`
- `tests/phase2a8-simulation-equivalence.test.ts`
- `tests/pathfinding-reference.ts`
- `tests/fixtures/phase2a8-path-baseline.json`
- `tests/pathfinding-fixtures.ts` (extended fixture matrix)

Local tools and evidence:

- `tools/phase2a8-pathfinding-benchmark.mjs`
- `tools/phase2a8-capture-baseline.mjs` (writes only a `tmp/` current snapshot; never overwrites the frozen fixture)
- `staging-evidence/phase2a7-profile-2026-10-30T18-09-13-884Z` — pre-change profiler run
- `staging-evidence/phase2a7-profile-2026-10-30T18-51-59-046Z` — final post-change profiler run
- `staging-evidence/phase2a8-benchmark-2026-10-30T18-36-02-618Z`
- `staging-evidence/phase2a8-benchmark-2026-10-30T18-38-06-155Z`
- `staging-evidence/phase2a8-benchmark-2026-10-30T18-41-28-302Z`
- `staging-evidence/phase2a8-benchmark-2026-10-30T18-49-38-663Z` (latest, includes external-memory mask measurement)
- `tmp/phase2a8-old` — reconstructed pre-optimisation tree used only by the A/B benchmark.
