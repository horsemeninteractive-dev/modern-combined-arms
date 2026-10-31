# MCA Phase 2A.2 — Deployed Resource Instrumentation and Repeat Soak

**Date:** 2026-10-30
**Scope:** isolate staging only. No production deployment, no feature-flag change, no gameplay or protocol change.
**Overall status:** **CONDITIONAL PASS.** The repeat deployed soak completed 30 minutes at 20 Hz with both seats, a team-filtered snapshot stream at 10 Hz, zero tick/serialization/send errors, a released reservation and a delivered time-limit result. Cloudflare's aggregate CPU and per-minute memory metrics were retrieved and are consistent with a low-CPU room. **Per-tick CPU headroom is still not proven**: deployed timers are frozen during CPU-only work, so the room can count ticks but cannot time them, and the platform only aggregates CPU per minute/per invocation. A memory trend of roughly +0.9 MB/minute over the 30-minute match is also unexplained and needs a dedicated investigation before longer matches or more concurrent rooms.

---

## 1. Staging deployment and configuration

| Item | Value |
| --- | --- |
| Worker | `mca-multiplayer-staging` (`https://mca-multiplayer-staging.horsemeninteractive.workers.dev`) |
| Deployed version | `4fe2ebcb-7c41-4338-b9a8-5d9c6b7718ee` (deployed 2026-10-30T02:59:06Z, 100% of traffic) |
| Compatibility date | `2026-10-01`, `nodejs_compat` |
| Durable Objects | `MatchRoomDurableObject`, `CapacityCoordinatorDurableObject` (SQLite-backed, migration `v1`) |
| Observability | Wrangler `observability.enabled = true` |
| Reservation policy | Defaults: `maxActiveRooms=2`, `maxDailyDurationGbSeconds=10,400`, `maxDailyRequests=80,000`, safety margin 1.1, stale lease 90 s, hard match cap 1,800 s |
| Room lifecycle | heartbeat 20 s, persistence 15 s, abandonment grace 30 s, hard deadline `createdAt + matchDurationMs` |
| Isolation | Separate Worker, separate DO namespace (`4c3a9ed29ce1475aae7ec0530538afca`), no production route or feature flag changed |

The same version was used for every measurement in this report. Profiling was captured against this version with `versions/latest` and the live room's actor ID.

---

## 2. Instrumentation architecture and changed files

Instrumentation is aggregate, bounded and in-memory. It never touches `GameState`, `SaveData`, `RoomSnapshotV1` or team projections, and it is never exposed to a normal client.

| File | Change |
| --- | --- |
| `src/multiplayer/roomDiagnostics.ts` | New. Fixed-bucket histograms (`BucketHistogram`) and monotonic counters for ticks, simulation time, snapshots (per seat), serialization, failures, slow clients, lifecycle, reconnects, reservation heartbeats/release, persistence operations/cycles and stored bytes. `summary()` is pure and bounded. |
| `src/multiplayer/roomMatch.ts` | Records tick wall/simulation duration and snapshot serialization/bytes; marks seat connect/disconnect/reconnect and deadline outcomes; flags whether the monotonic clock actually advanced. |
| `src/multiplayer/roomDurableObject.ts` | Records persistence reads/writes/deletes, cycle durations, chunk counts, write bytes, last success and "behind" state; persists the diagnostics blob beside room metadata; returns diagnostics only on the token-protected admin status route. |
| `tests/phase2a2-diagnostics.test.ts` | New. 4 tests: bounded aggregates and unchanged wire format; simulation identical with diagnostics on/off; persistence/reservation/lifecycle accounting; UTF-8 byte sizing without allocating an encoder result. |
| `tools/phase2a2-metrics.mjs` | New. GraphQL evidence collector for `durableObjectsPeriodicGroups`, `durableObjectsInvocationsAdaptiveGroups`, `durableObjectsStorageGroups`; now also emits memory quantiles per minute. |
| `tools/phase2a2-pprof-summary.py` | New. Dependency-free pprof reader. Fixed `Sample.value` decoding (pprof `int64` is a plain two's-complement varint, not zigzag; the first pass halved every sample). |
| `tools/phase2a2-heap-summary.py` | New. Heap/allocation pprof summary for `alloc_objects` and `alloc_space`, top self/inclusive. |
| `tools/phase2a1-soak.mjs` | Soak harness: records close code/reason, and sends a 20 s WebSocket ping per seat so a seat with no commands does not leave a one-way idle flow (see §17). |
| `tools/phase2a-raw-client.mjs` | Raw client: parse close code/reason, add `ping()`. |
| `MULTIPLAYER_PHASE_2A_2_RESOURCE_REPORT.md` | This report. |

No file under `src/sim/`, `src/render/`, `src/ui/`, the single-player save schema or the browser entry point was modified in this phase. The working tree already contained unrelated uncommitted gameplay and presentation changes; they were preserved untouched.

**Instrumentation rules enforced:** no per-tick logging, no per-tick storage writes, no client-requested diagnostics, no diagnostic fields in protocol payloads, no unbounded histories. Flushes happen only in the existing 15 s persistence cycle and at close.

---

## 3. Cloudflare datasets, fields and queries

Schema introspection evidence is in `staging-evidence/observability/` (`schema-*.json`, `filters.json`, `descriptions.json`). The collector issues three queries:

**`durableObjectsPeriodicGroups`** (per room object, per minute), filter `name`, `datetime_geq`, `datetime_lt`:

```
dimensions { datetime namespaceId name objectId coloCode }
sum { cpuTime activeTime duration inboundWebsocketMsgCount outboundWebsocketMsgCount
      rowsRead rowsWritten storageReadUnits storageWriteUnits subrequests
      exceededCpuErrors exceededMemoryErrors fatalInternalErrors }
max { memoryUsageBytes activeWebsocketConnections }
quantiles { memoryUsageBytesP50 memoryUsageBytesP90 memoryUsageBytesP99 memoryUsageBytesP999 }
```

**`durableObjectsInvocationsAdaptiveGroups`** (same filter): `dimensions { datetime namespaceId name objectId scriptVersion status type }`, `sum { requests errors responseBodySize wallTime }`, `quantiles { cpuTimeP50 cpuTimeP90 cpuTimeP95 cpuTimeP99 wallTimeP50 wallTimeP95 wallTimeP99 }`.

**`durableObjectsStorageGroups`**: `max { storedBytes }` for the namespace.

Mapping to the room:

| Room activity | Dataset representation |
| --- | --- |
| Room creation (`POST /rooms/:id`) | One `http` invocation in the invocations dataset (CPU ~3.9 ms, wall ~186 ms). |
| WebSocket upgrade and connection lifetime | A single long-lived `http` invocation per seat, holding the whole connection: wall time equals socket lifetime (1,799.8 s in the soak), `responseBodySize` equals the snapshot stream. |
| Incoming commands | `inboundWebsocketMsgCount` (443 in the soak) and request billing at the 20:1 ratio. |
| Outgoing snapshots/control frames | `outboundWebsocketMsgCount` (36,447) and `responseBodySize` (2.105 GB). Outgoing messages are not billed. |
| Heartbeats, reserve, release | `subrequests` (91) — heartbeat calls are subrequests to the capacity DO and are billed as DO requests. |
| Persistence | `rowsRead`/`rowsWritten` (840 / 1,779); the storage dataset returned no rows for this window. |

**Measurement limitations established from the account:**

- `durableObjectsPeriodicGroups` is aggregated **per minute, per object**; its `memoryUsageBytes` quantiles were identical to the minute maximum (p50 = p90 = p99 = p999), so this account cannot distinguish a distribution within a minute.
- CPU is aggregated **per minute** (`sum.cpuTime`) and **per invocation** (`quantiles.cpuTimeP*`). There is no per-tick or per-message CPU field.
- `durableObjectsStorageGroups` returned 0 rows for both the run window and the namespace window; no `storedBytes` series is available at this granularity/plan.
- `exceededCpuErrors`, `exceededMemoryErrors` and `fatalInternalErrors` were 0 for the whole soak.

---

## 4. Test topology, windows and configuration

Two independent raw WebSocket clients, seat 0 (team 0) and seat 1 (team 1), connect to one authoritative `1v1` room. The scenario is the existing seeded staging scenario; `Game.tick()` runs at 20 Hz, snapshots are projected and sent every second tick (10 Hz per seat). Commands are generated by the harness from the latest authorised snapshot through the normal `CommandGate` path.

### 4.1 Run A — aborted at 15 min 42 s (transport loss)

| Item | Value |
| --- | --- |
| Room | `phase2a2-main-mvudvtal`, created `2026-10-30T02:59:27.661Z` |
| Client socket lifetime | `02:59:27Z` – `03:15:09Z`, 941,785 ms (room closed `03:15:39Z`) |
| Server ticks | 19,434 (`Game` tick count; 19,434 / 971.8 s = 20.0 Hz until close) |
| End cause | Seat 1's TCP/WebSocket flow was closed at `03:15:09Z` (941.8 s). The room recorded the disconnect, waited the 30 s abandonment grace and finished with `reason: "abandoned"`, winner team 0. |
| Evidence | Platform invocations show the seat-1 socket invocation ending with status `clientDisconnected` after 941.9 s; the seat-0 invocation ended at 972.0 s. No slow-client event, no send failure, no CPU/memory/fatal error was recorded. |
| Interpretation | The client side of the connection ended. The harness found no controllable unit for seat 1 throughout the run, so it sent **zero** messages on that socket for its entire 941.8 s lifetime. A one-way idle flow is a plausible NAT/edge reclaim candidate, but the exact close reason was not captured before the harness was instrumented. |

Run A is preserved as evidence (`staging-evidence/phase2a2-main-2026-10-30T02-59-26-973Z/`). It is **not** counted as the 30-minute soak.

### 4.2 Run B — complete 30-minute soak

| Item | Value |
| --- | --- |
| Room | `phase2a2-main2-30m-mvuetl6l` |
| Room created / closed | `2026-10-30T03:25:43.406Z` / `2026-10-30T03:55:43.414Z` |
| Client window | `03:25:43.559Z` – `03:55:43.464Z`, 1,799,905 ms |
| Server match time | 1,799,793 ms |
| Seats | 2 connected for the entire window |
| Result | `phase: finished`, `reason: time-limit`, winner team 1 (score 5,862.4 vs 3,300.0), tick 35,995; both seats received a `result` frame; both sockets closed `1000 match-finished` |
| Harness change vs Run A | 20 s WebSocket ping per seat. Transport-level only; `mca.v1`, command rate and snapshot cadence were unchanged. |

The harness generated 443 commands (move 365, attack 58, produce 20) from seat 0. Seat 1 had no controllable units after early combat and therefore sent none; that is a scenario/workload limitation, not a server restriction — the server accepted every command it received.

---

## 5. Simulation stability

| Measurement | Run B |
| --- | --- |
| Elapsed wall time (client) | 1,799,905 ms |
| Expected ticks at 20 Hz | 36,000 |
| Actual ticks | 35,995 |
| Effective tick rate | 19.9995 Hz |
| Missing ticks over 30 min | 5 (0.014%), consistent with connection setup and the final deadline tick |
| Tick errors | 0 |
| Snapshot interval observed | 17,997 of 17,998 tick deltas were exactly 2 ticks; one was 1 |
| Snapshot gaps (seat 0 / seat 1) | p50 100 ms, p95 103 ms, p99 171 ms, max 413 / 429 ms |
| Longest sub-rate period | 429 ms (single late snapshot, immediately followed by the normal cadence) |
| Match termination | Hard deadline enforced exactly at 1,800 s; result delivered before sockets closed |
| State consistency | Both seats reported the same final tick (35,995) and the same neutral result; no desync or divergence was observed |

Measurement method: the server counts `Game.tick()` calls and the client timestamps each received snapshot, tick field and gap. The server tick count is authoritative; the client clock only measures delivery cadence. Neither proves per-tick CPU cost.

---

## 6. Tick execution duration

### 6.1 Deployed — unavailable by platform behaviour

Deployed diagnostics report `clockAdvanced: false` and `durationsAvailable: false`. `performance.now()` in Workers is frozen while CPU-only work runs (Spectre mitigation), so every tick and serialization duration reads 0. The room now labels the data as unavailable instead of publishing zeros:

```
clock: "performance.now"
clockAdvanced: false
timerNote: "Deployed Workers freeze timer APIs during CPU-only work as a Spectre mitigation.
            Zero durations mean the clock did not advance, not that the work took no time."
```

This is a **hard limitation of the runtime**, not a missing instrumentation hook. Deployed tick counts, snapshot counts and byte counts remain valid; deployed tick/serialization **durations** are not measurable this way.

### 6.2 Local `workerd` reference (not a deployed measurement)

A separate 120 s two-seat run against local `wrangler dev` (same version, same code, same 20 Hz/10 Hz cadence) produced 2,403 ticks (20.0 Hz). It is useful as an interface budget only — the machine is not Cloudflare and is not CPU-capped.

| Metric | p50 | p90 | p95 | p99 | p99.9 | max | > 10 ms | > 50 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tick wall duration (includes broadcast ticks) | 2.05 ms | 3.05 ms | 4.05 ms | 6.05 ms | 14.05 ms | 27 ms | 8 / 2,403 (0.33%) | 0 |
| Simulation portion (`Game.tick()`) | 0.05 ms | 1.05 ms | 1.05 ms | 1.05 ms | 7.05 ms | 10 ms | 0 | 0 |
| Snapshot serialization (per seat) | 0.05 ms | 1.05 ms | 1.05 ms | 1.05 ms | 2.05 ms | 3 ms | 0 | 0 |
| Persistence cycle | 1.5 ms | 8.5 ms | 9.5 ms | 15 ms | 15 ms | 15 ms | 1 / 27 | 0 |

Local bucket width is 0.1 ms for tick/serialization and 1 ms for persistence, so small values are quantised and should not be read as precise.

---

## 7. Platform CPU and invocation statistics

Run B, from `durableObjectsPeriodicGroups` (31 minute rows, `03:25:43Z`–`03:55:43Z`):

| Metric | Value |
| --- | --- |
| Durable Object CPU time | **41.37 s** |
| Active wall time | 1,800.09 s |
| CPU share of wall time | **2.30%** of one core |
| CPU per active minute | p50 1.360 s, p95 1.465 s, max 1.954 s, mean 1.335 s (first minute 1.95 s, setup only) |
| CPU per tick (aggregate) | **1.149 ms** (41.37 s / 35,995) |
| CPU per 10 Hz broadcast cycle (2 seats) | ≈ 2.3 ms aggregate (2 ticks) |
| `exceededCpuErrors` / `exceededMemoryErrors` / `fatalInternalErrors` | 0 / 0 / 0 |
| DO requests (inbound messages at 20:1 + upgrades + subrequests) | 443 msgs → 23 billed, + 2 upgrades, + 91 subrequests |
| WebSocket messages | 443 inbound, 36,447 outbound (2 × 17,999 snapshots + control frames) |
| Response body bytes (socket invocations) | 2,105,518,022 |

Invocations dataset: 3 rows, 4 requests, 2 "errors" that are the two long-lived socket invocations ending as `clientDisconnected` at close. The snapshot-sending invocation reports `cpuTimeP95 = 41.33 s` for its 1,799.8 s lifetime — the same aggregate CPU, not a per-invocation peak.

### 7.1 Deployed CPU profile (20 s, Run A window, same version)

`staging-evidence/phase2a2-run/cpu-profile-soak.pprof` (444 samples, exactly 444 ms CPU over 19.9997 s → 2.22% CPU, consistent with Run B's 2.30%):

| Self | Function |
| --- | --- |
| 51.58% | `createTeamSnapshot` (projection, including fog/entity filtering) |
| 20.05% | `sendSnapshotObject` (per-seat JSON serialization/send wrapper) |
| 6.98% | `(idle)` |
| 4.95% | `sendText` |
| 2.25% | `(garbage collector)` |
| 2.25% | `tick` (simulation) |
| 1.13% | `hasLineOfSight` |
| 1.13% | `updateBuildingSystems` |

Inclusive: `runTick` 87.8%, `broadcast` 77.5%, `createTeamSnapshot` 52.0%, `sendSnapshotObject` 25.2%, `persistSnapshot` 2.25%. Snapshot projection and serialization dominate CPU; the simulation step is a small fraction in this scenario. **No `RoomDiagnostics` frame appears in the sampled profile.**

### 7.2 The 10 ms per-tick target

What is established:

1. Aggregate CPU per tick is **1.149 ms** (all work, all ticks, averaged over 30 minutes).
2. Broadcast ticks do two projections plus two serializations; using the profile split (≈72% of CPU in projection/serialization, 10 broadcasts/s), a broadcast tick costs roughly **3–4 ms CPU** and a non-broadcast tick well under 1 ms.
3. No invocation was terminated for CPU: `exceededCpuErrors = 0` across 1,800 s. The platform's Durable Object CPU limit is 30 s per request ([Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)), so this confirms the room stayed far below the platform ceiling; it does **not** by itself prove the internal 10 ms per-tick budget.

What is **not** established:

- That *every individual tick* stayed below 10 ms CPU. The platform does not expose per-tick or per-broadcast CPU, and deployed timers cannot time a tick.
- The peak tick population during the heaviest combat minute. The maximum minute (1.954 s CPU, setup minute) is an upper bound on sustained cost, not a per-tick maximum.

The 10 ms headroom target therefore remains **unresolved**, supported only by aggregate evidence and a local profile, not proven.

---

## 8. Memory

### 8.1 Deployed isolate memory (`durableObjectsPeriodicGroups.max.memoryUsageBytes`)

| Metric | Run B |
| --- | --- |
| First minute | 21.89 MB |
| Last minute | 48.63 MB |
| Maximum | 48.63 MB |
| Change over 30 min | **+26.74 MB** (~883 KB/minute) |
| p50 / p90 / p99 / p999 | 48.63 MB each — identical to the minute maximum; the account exposes one per-minute figure, not a within-minute distribution |
| Scope | Per **isolate** as reported by Cloudflare for this object, not per request or per connection; shared 128 MB limit |

The series is linear, not saturating: `21.9, 23.0, 23.8, 24.4, 25.8, … 47.5, 48.1, 48.6`. Run A showed the same slope (22.95 → 38.63 MB in 16 minutes). At this rate a 2-hour room would approach the 128 MB isolate limit, so this is a real risk if the hard match cap is ever raised or if more rooms share an isolate. The cause is not identified in this phase and was not "fixed" during a measurement task.

### 8.2 Deployed heap/allocation profile (30 s, Run A)

`staging-evidence/phase2a2-run/heap-profile-soak.pprof` — Cloudflare heap profiles sample a stack every 524,288 bytes allocated; they measure **allocation**, not retained heap.

| Sample type | Total over 30 s |
| --- | --- |
| `alloc_space` | 566,034,024 bytes (≈18.9 MB/s) |
| `alloc_objects` | 15,653,431 (≈522k objects/s) |

Inclusive allocation: `tick` 99.0%, `broadcast` 98.0%, `createTeamSnapshot` 93.3%, `sendSnapshotObject` 4.7%. The allocation churn is dominated by building the per-seat snapshot object graph and its JSON string, which is expected at 20 snapshots/s × ~58 KB. Allocation samples do **not** say what stayed live; the upward memory trend is therefore not attributed to a specific structure here.

---

## 9. Persistence and storage

Room-side counters (Run B, diagnostics persisted with the room):

| Metric | Value |
| --- | --- |
| Snapshot persistence cycles | 121 (15 s interval → 120 expected) |
| Metadata cycles | 211 |
| Storage reads / writes / deletes | 122 / 1,059 / 720 |
| Bytes written | 30,569,580 |
| Chunks written | 726 |
| Last snapshot size / max snapshot size | 254,101 B / 261,576 B |
| Failures | 0 |
| Time since last successful persistence at close | 230 ms |
| Behind the interval | no |
| Cycle / operation durations | unavailable (frozen deployed clock) |

Platform reconciliation (`durableObjectsPeriodicGroups`): `rowsRead = 840`, `rowsWritten = 1,779`, `storageReadUnits = 0`, `storageWriteUnits = 0`, `subrequests = 91`. The row counts are slightly higher than the room's own counters because they include the capacity DO's and SQLite's internal bookkeeping and per-minute aggregation; they are the same order of magnitude. `durableObjectsStorageGroups` returned **0 rows**, so stored-byte reconciliation against the platform was not possible.

No persistence fall-behind, storage error or stale state was observed. `finalize()` persisted the final diagnostics and closed the room after releasing the reservation (`releaseSuccesses = 1`, `releaseFailures = 0`).

Deterministic restore and continuation are covered by `tests/phase1-room-snapshot.test.ts` ("restores a deterministic continuation") and `tests/phase2a-room-match.test.ts` ("restores a room snapshot and continues deterministically"); both passed in the full suite. The soak itself did not perform a live restore, so restore evidence is test-level, not deployed.

---

## 10. Snapshots and network

Run B, measured client-side in UTF-8 bytes (ASCII protocol, so byte count equals UTF-16 code units):

| Metric | Seat 0 | Seat 1 |
| --- | --- | --- |
| Snapshot count | 17,999 | 17,999 |
| Effective frequency | 9.99997 Hz | 9.99997 Hz |
| Bytes received | 1,028,490,879 | 1,076,989,134 |
| Size p50 / p95 / p99 / max | 56,912 / 57,945 / 60,172 / 62,583 B | 59,704 / 61,305 / 61,672 / 62,962 B |
| Delivery gap p50 / p95 / p99 / max | 100 / 103 / 171 / 413 ms | 100 / 103 / 171 / 429 ms |
| Serialization failures | 0 | 0 |
| Send failures / slow-client drops | 0 / 0 | 0 / 0 |

Aggregate: **2,105,480,013 bytes** over 1,800 s (≈1.17 MB/s for two seats). Platform `responseBodySize` = 2,105,518,022 B, matching the client totals plus control frames.

### 10.1 Repeated static payload

The harness decomposes each snapshot by top-level field. Average of 60 samples:

| Part | Bytes | Share |
| --- | --- | --- |
| `map` (terrain/elevation/ore arrays) | 41,797 | 71.6% |
| `fog` (per-team fog/charted arrays) | 13,825 | 23.7% |
| `entities` (own, allied, visible enemy, remembered) | 2,126 | 3.6% |
| `players` | 257 | 0.4% |
| `contacts` | 30 | 0.05% |
| `events` / `projectiles` | 2 / 2 | <0.01% |
| **Total** | **58,389** | 100% |

**≈95.3% of every snapshot is repeated static map and fog data.** Terrain, elevation and ore arrays are identical for the whole match; the fog grid only changes on vision updates. This is the largest identified network/CPU lever, but compression or static-once delivery was deliberately **not** implemented in this verification phase.

---

## 11. Instrumentation overhead

| Evidence | Result |
| --- | --- |
| CPU profile (20 s, 444 samples) | No diagnostics function appears in the sampled profile; its cost is below the 1 ms sample resolution, i.e. **< 1% of CPU / < 0.02 ms per tick average**. |
| Per-operation cost | Each tick records two histogram observations and touches a few counters; each snapshot records two histograms and a byte counter. No allocation of per-tick objects, no strings, no storage, no logging. |
| Persistence | Diagnostics are serialized once per 15 s persistence cycle with the room metadata, adding a bounded JSON object to an existing write; no extra write. |
| Memory | Fixed-size bucket arrays (≤256 buckets per histogram, 2 seats) and scalar counters; diagnostics cannot grow with match length. |
| Determinism | `tests/phase2a2-diagnostics.test.ts` runs the same seeded room with diagnostics enabled and disabled and asserts identical simulation and identical outbound payloads. |
| Comparison | Tick count (35,995), snapshot count (17,999/seat) and 10 Hz cadence are identical to Phase 2A.1, which had no instrumentation. Snapshot p50 differs by ~2.5 KB because the scenario/entity mix differed, not because of instrumentation. |

Bounded overhead estimate: **< 0.02 ms CPU per tick and < 0.5% of the measured 1.15 ms/tick aggregate**, below the resolution of the platform profile.

---

## 12. Free-tier implications (official figures)

Sources: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/). Workers Free includes 100,000 requests/day, 10 ms CPU per HTTP request and 128 MB per isolate. Durable Objects on Workers Free include 100,000 requests/day, 13,000 GB-s/day duration, 5M rows read/day, 100,000 rows written/day and 5 GB stored. Duration is billed at 128 MB per object; incoming WebSocket messages are billed at 20:1, outgoing messages and protocol pings are not billed. Exceeding any free limit fails that operation type until the 00:00 UTC reset — there is no automatic upgrade.

Measured cost of one 30-minute two-seat room:

| Resource | Measured | Free allowance | Share |
| --- | --- | --- | --- |
| Duration | **230.41 GB-s** (exactly 1,800 s × 128 MB) | 13,000 GB-s/day | 1.8% |
| DO requests | 443 messages / 20 = 23, + 2 upgrades, + 91 heartbeat/reserve/release subrequests ≈ **116** | 100,000/day | 0.12% |
| Rows written | 1,779 | 100,000/day | 1.8% |
| Rows read | 840 | 5,000,000/day | 0.02% |
| Worker requests | 4 HTTP + 2 upgrades (the socket stream is one long invocation per seat) | 100,000/day | negligible |

Capacity model, unchanged by this phase:

- 100% of the duration allowance supports **56** such rooms per day; the 80%-of-allowance policy (10,400 GB-s) supports **45** rooms/day.
- At `maxActiveRooms = 2` and a 30-minute cap, two concurrent rooms consume 460.8 GB-s/hour; the daily budget is exhausted after ~22.5 room-hours.
- Request and row limits are not binding; **duration is the binding constraint**.
- The `subrequests = 91` figure shows that heartbeats/reserve/release are a real, counted cost (≈79% of a room's billed requests here) and must stay in the admission model.

**Do not scale admission from this single soak.** One room, one scenario and one 30-minute run do not establish behaviour for two concurrent rooms, mixed durations, retries or a full day of reservations. The existing conservative policy (`maxActiveRooms = 2`, 80% daily duration) remains appropriate.

One platform risk worth recording: Cloudflare's Workers limits documentation states that during routine runtime updates, existing connections are given **up to 20 minutes** to finish. A 30-minute authoritative match can therefore have its WebSocket invocations terminated by a platform update; the room must rely on reconnect + snapshot recovery (both already tested) rather than assuming a socket survives a whole match.

---

## 13. Missing or unavailable measurements

| Measurement | Status |
| --- | --- |
| Deployed per-tick execution duration | **Unavailable** — `performance.now()` frozen during CPU-only work. Counts available; durations not. |
| Deployed per-snapshot serialization duration | **Unavailable** for the same reason. Local workerd only. |
| Deployed persistence operation duration | **Unavailable** for the same reason. Operation counts and bytes are valid. |
| Per-tick or per-invocation CPU peak | **Unavailable** — CPU is aggregated per minute/invocation; socket invocations span the whole match. |
| Durable Object isolate memory distribution (p50…p999 within a minute) | **Unavailable** — all quantiles equal the minute maximum for this account. Per-minute series is valid. |
| Stored bytes / storage operations from `durableObjectsStorageGroups` | **Unavailable** — 0 rows returned for the namespace/window. |
| Network latency and client rendering time | Not measured; out of scope. `commandLatencyMs` is application round-trip, not network RTT. |
| 30-minute run with all four seats actively commanding | Not achieved — seat 1 had no controllable units, so only seat 0 generated commands. |
| Multi-room concurrency under real load | Not measured; only the capacity-boundary test (2 rooms + rejection) was exercised. |

No GPU, network or client-frame conclusion is drawn from any server timing.

---

## 14. Comparison with Phase 2A.1

| Metric | Phase 2A.1 (no instrumentation) | Phase 2A.2 (instrumented) | Comment |
| --- | --- | --- | --- |
| Duration | 1,799.8 s | 1,799.8 s | identical |
| Ticks / rate | 35,995 / 19.9997 Hz | 35,995 / 19.9995 Hz | identical |
| Snapshots per seat | 17,999 | 17,999 | identical |
| Snapshot p50 | 60,054 / 57,548 B | 56,912 / 59,704 B | scenario/team mix differs; same order |
| Snapshot p99 | 61,757 / 61,372 B | 60,172 / 61,672 B | same |
| Delivery gap p99 / max | 179 / 841 ms | 171 / 429 ms | equal or better |
| Commands accepted / rejected | 443 / 1 | 443 / 0 | equal acceptance |
| Command latency p50 / p99 | 18 / 97 ms | 11 / 66 ms | client-side variance |
| Deployed CPU | not measured | 41.37 s (2.30%) | new |
| Deployed memory | not measured | 21.89 → 48.63 MB | new |
| Persistence counters | not measured | 121 cycles, 1,059 writes, 0 failures | new |
| Result delivery | both seats | both seats | identical |
| Overall | CONDITIONAL PASS | CONDITIONAL PASS | per-tick CPU still unresolved |

Phase 2A.1's soak was not affected by the transport loss seen in Run A here; the difference is attributed to the one-way idle flow on seat 1 and the absence of any keepalive, not to the instrumentation.

---

## 15. Post-soak lifecycle checks

Run after Run B closed and released, against the same staging Worker (`staging-evidence/phase2a1-failures-2026-10-30T03-57-29-457Z/`):

| Check | Result |
| --- | --- |
| Reconnect after disconnect | PASS — same seat reattached, room closed, reservation released |
| Permanent disconnect / abandonment | PASS — result `abandoned` observed 30,091 ms after disconnect, winner team 0, reservation released |
| Controlled shutdown | PASS — admin shutdown returned 200; client received `room-shutdown`; room closed; reservation released |
| Hard deadline (separate 10 s policy) | PASS — `draw` for both seats at server tick 196 (9.8 s), room closed, reservation released |
| Capacity boundary | PASS — two rooms created (200, 200), third rejected `capacity-full` (503), after release a new room was admitted (200) |
| Stale capacity record | None observed; release idempotent and a new room was admitted immediately after |

These are short, separate rooms; they do not constitute a multi-room concurrency soak.

## 16. Acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Instrumentation does not alter authoritative simulation or single-player behaviour | **PASS** | No `src/sim` or single-player file touched; A/B determinism test; full suite 84 files / 856 tests passed; build passed. |
| Deployed 30-minute soak completes | **PASS** | Run B: 1,799.9 s, both seats, result delivered, clean close; Run A's abort documented separately. |
| Tick execution statistics are available from the room | **FAIL (platform)** | Counts and cadence available (35,995 ticks, 2-tick snapshot deltas); deployed durations are frozen to 0 and flagged `durationsAvailable: false`. Local workerd values are reported but do not satisfy "deployed". |
| Cloudflare CPU metrics retrieved and interpreted correctly | **PASS (aggregate only)** | 41.37 s / 2.30%; per-minute p50 1.36 s, max 1.954 s; 0 exceeded-CPU errors against the 30 s platform ceiling; per-tick CPU explicitly not claimed. |
| Memory metrics retrieved and scope explained | **PASS** | 21.89 → 48.63 MB per isolate; quantile limitation documented; +0.9 MB/min trend flagged. |
| Persistence and snapshot overhead measured | **PASS (counts/bytes; durations unavailable)** | 121 cycles, 1,059 writes, 30.57 MB, 0 failures, not behind; storage dataset empty documented. |
| Reservation and cleanup remain correct | **PASS** | 89 heartbeats / 0 failures, release success, capacity boundary (200, 200, 503 `capacity-full`, 200 after release), deadline test, no stale room. |
| Instrumentation overhead bounded and documented | **PASS** | No diagnostics frames in profile; fixed histograms; no per-tick writes/logging; < 1% CPU estimate. |
| No paid service or production exposure introduced | **PASS** | Staging only, no billing, no plan change, admin-only diagnostics, secrets unprinted. |

**Overall: CONDITIONAL PASS.** The soak, projection/transport health, persistence, cleanup and aggregate CPU are demonstrated. Per-tick CPU headroom is not proven, and the memory growth trend is unexplained.

---

## 17. Errors, anomalies and test interruptions

1. **Run A transport loss (15 min 42 s).** Seat 1's client-side flow closed at 941.8 s; the room correctly applied abandonment after 30 s and finished. No server-side failure was recorded. Cause not conclusively identified (close code not captured at the time); the plausible mechanism is a one-way idle flow with no client traffic. The harness now pings every 20 s, which is a test-harness workaround, not a product fix. Run B survived the full 30 minutes with it.
2. **Deployed timer freeze** invalidated the first duration instrument design; the room now reports `durationsAvailable: false` rather than zeros. This is a measurement limitation, not a runtime defect.
3. **pprof decoding bug in the first local analysis** halved every sample (zigzag instead of plain varint). Fixed in `tools/phase2a2-pprof-summary.py`; the numbers in this report are post-fix (444 ms / 20 s, not 222 ms).
4. **`durableObjectsStorageGroups` empty** for this namespace/window; storage bytes could not be reconciled with the room's own counters.
5. **Memory growth** of ~0.9 MB/minute, linear over 30 minutes, with no identified owner. Not fixed in this phase.
6. **Seat 1 generated no commands** because it lost its controllable units early; the soak therefore exercised one active command seat. Server-side command handling, rate limits and gate rejections are covered by tests rather than by this soak.
7. **Profiling API** required `versions/latest` with `namespace_id` + `actor_id`; an explicit version UUID returned `10393 No recent executions` even while the object was live. Recorded so the next phase does not repeat the dead end.

---

## 18. Reproduction

```bash
# Staging version and deployment
npx wrangler deployments list --config mp-room-wrangler.jsonc

# 30-minute two-seat soak (writes timestamped metrics + summary + final status)
MP_SOAK_MS=1800000 MP_SOAK_LABEL=phase2a2-main2-30m node tools/phase2a1-soak.mjs

# Cloudflare GraphQL evidence for the exact window
CLOUDFLARE_API_TOKEN=... MP_ACCOUNT_ID=... \
  MP_ROOM_ID=phase2a2-main2-30m-mvuetl6l \
  MP_START=2026-10-30T03:25:00Z MP_END=2026-10-30T03:58:00Z \
  MP_OUT_DIR=staging-evidence/phase2a2-main2-30m-2026-10-30T03-25-42-737Z \
  node tools/phase2a2-metrics.mjs

# Deployed CPU and heap profiles (DO-targeted, requires namespace + actor id)
curl --request POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/workers/mca-multiplayer-staging/versions/latest/profile" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data '{"duration_ms":20000,"profile_type":"cpu","namespace_id":"...","actor_id":"..."}' \
  --output cpu.pprof
python tools/phase2a2-pprof-summary.py cpu.pprof
python tools/phase2a2-heap-summary.py heap.pprof

# Local workerd tick-duration reference (not a deployed measurement)
npx vite build --config mp-room-vite.config.ts
npx wrangler dev --config mp-room-wrangler.jsonc --port 8792 \
  --persist-to .dev/mp-room-local2a2 \
  --var MP_ADMIN_TOKEN:<local-admin> --var MCA_RESERVATION_TOKEN:<local-reservation> \
  --var MP_ALLOWED_ORIGINS:http://127.0.0.1:8792
MP_BASE=http://127.0.0.1:8792 MP_ADMIN_TOKEN=<local-admin> \
  MP_SOAK_MS=120000 MP_SOAK_LABEL=local-2m MP_EVIDENCE_ROOT=staging-evidence/phase2a2-main2/local \
  node tools/phase2a1-soak.mjs

# Post-soak lifecycle, deadline, capacity and cleanup checks
node tools/phase2a1-failure-tests.mjs

# Local suite, typecheck, production build
npx vitest run
npx tsc --noEmit
npm run build
```

**Raw evidence locations**

| Path | Contents |
| --- | --- |
| `staging-evidence/phase2a2-main-2026-10-30T02-59-26-973Z/` | Run A: run.log, metrics.jsonl, summary.json, status-final.json, platform-metrics.json |
| `staging-evidence/phase2a2-run/` | Run A profiles: `cpu-profile-soak.pprof`, `heap-profile-soak.pprof`, summaries |
| `staging-evidence/phase2a2-main2-30m-2026-10-30T03-25-42-737Z/` | Run B: 30-minute soak metrics, summary, final status, platform-metrics.json |
| `staging-evidence/phase2a2-main2/local/local-2m-2026-10-30T03-30-00-947Z/` | Local workerd tick/serialization/persistence durations |
| `staging-evidence/phase2a1-failures-2026-10-30T03-57-29-457Z/` | Post-soak reconnect, abandonment, shutdown, deadline, capacity tests |
| `staging-evidence/observability/` | GraphQL schema introspection, filters and dataset descriptions |

Secrets (admin token, reservation token, account ID) are not written to evidence or this report; account and namespace identifiers are redacted where they are not needed to reproduce.

---

## 19. Recommendation

**Do not proceed to the production lobby yet.** The evidence supports the room runtime's protocol, projection, persistence and cleanup, but not per-tick CPU headroom, and it exposes two concrete risks that a lobby would multiply.

**Recommended next phase: Phase 2A.3 — transport keepalive/reconnect hardening and memory-growth profiling.** Narrow scope:

1. Add a protocol-level keepalive/no-op (or documented client ping requirement) so a seat with no commands cannot leave a one-way idle flow; verify with a 30-minute run where one seat sends nothing. Run A's 941 s drop is the reproduction.
2. Profile the linear ~0.9 MB/minute isolate growth across a 30-minute room (heap snapshots or allocation comparison at minute 5 vs 25) and identify whether it is retained game state, diagnostics persistence, or JSON/serialization slack. Decide whether the 30-minute cap must stay and whether per-room memory needs an explicit budget in the reservation policy.
3. Keep the 10 ms target explicitly unresolved until a per-tick CPU source exists; if Cloudflare cannot provide one, define an acceptance proxy (e.g. no `exceededCpu` errors over N rooms and measured CPU/tick with margin) rather than claiming the target.

Only after those two risks are resolved should the lobby, public room discovery and account work begin; the current `maxActiveRooms = 2` admission and the 30-minute cap should stay in place until then.
