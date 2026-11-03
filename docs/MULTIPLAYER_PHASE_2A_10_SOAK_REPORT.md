# MCA — Phase 2A.10: Optimised Staging Stability Soak

**Status: CONDITIONAL — the 30-minute match completed and the authoritative state recovered, but the run does not pass cleanly. A runtime restart at 17 m 34 s caused 363 rejected sync/delta updates, a 20.13 s client recovery window and approximately 72–79 lost authoritative ticks. The restart also reset the room's diagnostics counters and `startedAtMs`. No simulation, pathfinding or protocol code was changed in this phase.**

**The 10 ms individual-tick CPU target remains UNVERIFIED.**

## 1. Summary

The deployed Phase 2A.9 Build B (`d23e416c-c755-4ec4-bfb3-373ec216c275`, tag `phase2a9-b`) completed a 30-minute two-seat staging match:

| Item | Result |
| --- | --- |
| Room | `phase2a10-30m-mvvfbtvq` |
| Match window | `2026-10-30T20:27:57.702Z` – `2026-10-30T20:57:57.702Z` |
| Authoritative ticks | **35,921** |
| Whole-match effective rate | **19.956 Hz** (79 ticks, 0.22%, below 36,000) |
| Platform CPU | **20,014.378 ms** |
| Aggregate CPU per completed tick | **0.5572 ms** (derived) |
| Peak reported memory | **33.6966 MiB** |
| Final results | seat 0 **victory**, seat 1 **defeat**, `time-limit`, tick 35,921 |
| Final client reconstruction | tick 35,921, 6,912 map tiles, 6,912 fog tiles, both seats |
| Reservation | `r164`, **released** |
| Post-soak capacity boundary | `200, 200, 503, 200` |
| Production multiplayer flag | **disabled** |

The primary stability result is mixed:

- The authoritative simulation continued at 20 Hz within each uninterrupted segment, both seats received the correct final result, the client reconstructed the final tick exactly, keepalives completed 89/89 per seat, and persistence reported no failures.
- At `20:45:31Z` both sockets closed with no close code and the room restarted from persistence. Reconnection completed in 462/469 ms, but the clients then rejected 363 updates for 20.13 s before resynchronising. One resync request was rejected as `resync-rate-limited`.
- The last pre-restart command acknowledgement was tick 21,015; the first post-restart acknowledgement was tick 21,043. That is approximately 72 ticks (3.6 s) lost across the restart. The final 35,921 ticks are 79 below the 36,000 expected over the fixed 1,800 s match.
- Memory rose to 31.46 MiB before the restart, reached 33.70 MiB afterwards, then fell to 6.64 MiB at `20:51:31Z` with the same object id and no socket close. This is evidence of runtime heap reclamation, not a monotonic application leak, but Cloudflare exposes no retained-heap metric.
- CPU per minute was higher after the restart (post-restart full-minute mean 777.4 ms versus 582.5 ms before). There is no continuing upward trend in the post-restart segment, but the level shift is unexplained and cannot be attributed to the Phase 2A.8 pathfinding change from this run.

Completion alone is not treated as a clean stability pass. The restart recovery defect is the main operational finding of Phase 2A.10.

## 2. Starting point and deployment

The active staging version was checked before the soak and again after it:

| Property | Value |
| --- | --- |
| Worker | `mca-multiplayer-staging` |
| URL | `https://mca-multiplayer-staging.horsemeninteractive.workers.dev` |
| Active version | `d23e416c-c755-4ec4-bfb3-373ec216c275` |
| Tag | `phase2a9-b` |
| Version message | Phase 2A.9 B: Phase 2A.8 optimised pathfinding |
| Version created | `2026-10-30T19:40:59.463Z` |
| Deployment created | `2026-10-30T19:50:59.829Z` |
| Source HEAD | `132ccc8363d5b5bc98b6518b4afd1738dedaad6a` |
| Worker build marker | `phase2a6-staging` |

The deployed room artifact is still the Phase 2A.9 B artifact:

```text
05b2b2465d639852f24d1561c6d300362bf8aae9bcc464c0e1607c46717b87c7 *dist-mp-room/roomWorker.js
```

It matches `tmp/phase2a9-builds/B/roomWorker.js` and contains `NavBatch`. The pathfinding source hashes still match the Phase 2A.9 B record:

```text
6bd4cb4ecac8c2f39f53a39e8d0b13ec091cffd41ea6f08896667b78f759faaf *src/sim/pathfinding.ts
1c2417c57543c4cfb66b4a039d0d0cff0dbe596d2c13b28e99f0f16e85ec2469 *src/sim/navBatch.ts
1450fb913285b3a9ae7f1d037de65db0abbe10b52ef5a647b82ce87bb77842ef *src/sim/game.ts
```

No deployment or version upload was performed in Phase 2A.10. The working tree contains 146 pre-existing modified or untracked paths; Phase 2A.10 added evidence and this report only.

The safety configuration was unchanged:

- `MULTIPLAYER_FEATURE.enabled = false`, `roomDiscovery = false`, `accountLinking = false`.
- `maxActiveRooms = 2`.
- `maxDailyDurationGbSeconds = 10,400` (80% of 13,000).
- `maxDailyRequests = 80,000` (80% of 100,000).
- `maxMatchDurationMs = 1,800,000` (30 minutes).
- `durationMb = 128`.
- No production deployment, capacity increase, paid service, billing change or automatic upgrade.

## 3. Soak configuration and workload

The established Phase 2A.3/2A.4 soak harness was used without protocol or simulation changes:

- `island-assault`, fixed seed, 1v1, fog enabled, AI disabled.
- 20 Hz authoritative simulation, 10 Hz snapshot/delta target.
- 30-minute hard match deadline.
- Two seats were present at the start and remained connected from the 462/469 ms recovery until the final result. The runtime restart disconnected both sockets for about 0.47 s, and their clients rejected updates for the following 20.13 s while epochs caught up.
- Application keepalives every 20 s from both seats.
- Commands every 5 s where a controllable unit existed; production every 180 s.
- The initial orders contained seven unit ids, crossing the Phase 2A.8 four-unit batching threshold; later orders used one or two units, with some larger attack orders.

| Command metric | Value |
| --- | ---: |
| Commands sent | 453 |
| — seat 0 / seat 1 | 359 / 94 |
| Move / attack / produce | 392 / 41 / 20 |
| Accepted | 447 |
| Rejected | 6 |
| — `no-capable-attacker` | 5 |
| — `not-your-entity` | 1 |
| Timeouts | 0 |
| Acknowledgement latency p50 / p95 / p99 / max | 21 / 26 / 111 / 910 ms |
| Move orders by unit count | 64 × 1, 321 × 2, 7 × 7 |
| Attack orders by unit count | 2 × 1, 25 × 2, 3 × 3, 1 × 4, 2 × 5, 8 × 6 |

Both seats issued commands throughout the match, but not equally: seat 0 sent about 79% of commands and the larger share of units. This is therefore a two-seat connection and two-seat command workload, not an equal two-sided pressure test.

This run did **not** include the 80-unit mass-order burst used in Phase 2A.6/2A.7/2A.9. That burst is exercised through the calibration route, not the normal room harness. The opening seven-unit orders do exercise the command-scoped pathfinding batch, but the run is not a replay of the synthetic 80-unit stress case. No air or naval units were exercised, so the all-air bypass and separate movement domains were not covered.

## 4. Measurement sources and coverage

### 4.1 Direct platform measurements

Cloudflare GraphQL, dataset `durableObjectsPeriodicGroups`:

- One row per minute for this room and object.
- `sum.cpuTime` in microseconds.
- `sum.activeTime` and `sum.duration`.
- `max.memoryUsageBytes` and memory quantiles.
- WebSocket message, row-read/write, subrequest and error counters.

31 minute buckets were returned for the room window. The first bucket is `20:27:40Z`; the last is `20:57:31Z`. No bucket is missing. The object id and `coloCode` were constant:

```text
objectId: e631799e08be0cb21e9e241fcc6b8044ee5a030ae6ca609641a323e4ffac001b
coloCode: AMS
```

Cloudflare GraphQL, dataset `durableObjectsInvocationsAdaptiveGroups`:

- 6 rows only.
- The long-lived WebSocket requests are collapsed into connection-lifetime rows, not per-message or per-tick rows.
- The original socket rows end with `responseStreamDisconnected` and `errors = 1` at the restart.
- There are no `fatalInternalErrors`, CPU-limit or memory-limit errors in the periodic data.
- These rows are retained as supporting evidence but are not used as per-tick CPU measurements.

### 4.2 Client and room measurements

The harness recorded:

- Sync/delta counts, bytes, sizes, epoch and sequence.
- Snapshot gaps and tick deltas.
- Command acknowledgements and latencies.
- Keepalive send/ack counts.
- Socket closes and reconnect attempts.
- A final reconstruction of both team views.
- Room status before and after completion.

The room's own diagnostics supplied command, persistence, sync/delta and keepalive counters. Those counters reset at the restart.

### 4.3 Resolution and limitations

- `sum.cpuTime` is **aggregate CPU per one-minute object bucket**, not a per-tick timeline.
- `max.memoryUsageBytes` is the reported isolate maximum for the bucket. Its p50/p90/p99/p999 values were identical to the maximum in every row.
- No per-tick CPU, per-tick maximum or per-tick percentile exists in this runtime. The deployed timer APIs remain frozen for synchronous CPU-only work.
- The 14,922-tick figure in the post-restart diagnostics is **post-restart only**, not the whole-match count.
- The full-match persistence byte total is unavailable after the restart reset. It is not imputed.

## 5. CPU results

### 5.1 Platform totals

These are direct platform measurements:

| Measurement | Value |
| --- | ---: |
| CPU buckets | 31 |
| Total platform CPU | **20,014.378 ms** |
| CPU as share of 1,800 s wall time | **1.112%** |
| Mean CPU per minute | 667.24 ms |
| First bucket (room creation and initial connection) | 1,195.138 ms |
| Pre-restart CPU, 18 buckets | 10,332.532 ms |
| Post-restart CPU, 13 buckets | 9,681.846 ms |
| CPU-limit errors | 0 |
| Memory-limit errors | 0 |
| Fatal internal errors | 0 |

The aggregate CPU is **20.014 s** for 35,921 authoritative ticks:

```text
20,014.378 ms / 35,921 ticks = 0.5572 ms per completed tick
```

This is a derived aggregate. It includes room setup, command handling, simulation, projection, snapshot serialisation, persistence work, socket handling and the restart recovery. It is not simulation-only CPU and it is not an individual tick measurement.

### 5.2 Early, middle and late behaviour

Full-minute buckets, excluding partial first and last buckets:

| Segment | Full buckets | Mean CPU per minute | CPU per minute range |
| --- | ---: | ---: | ---: |
| Pre-restart, 20:27–20:44 | 17 | **582.5 ms** | 448.6–1,195.1 ms |
| Post-restart, 20:45–20:56 | 12 | **777.4 ms** | 683.8–932.0 ms |

The first bucket is an outlier because it includes room creation and the initial connection. The post-restart segment shows a **level shift** of about +33.5% in CPU per minute, not a continuing upward trend: the post-restart range is 683.8–932.0 ms, the last full minute is 761.4 ms and the restart minute itself is 807.1 ms.

Dividing the pre- and post-restart totals by their approximate authoritative tick counts gives:

```text
pre-restart:  10,332.532 ms / 21,015 ticks = 0.4917 ms/tick
post-restart:  9,681.846 ms / 14,906 ticks = 0.6495 ms/tick
```

These are boundary-approximate derived values. The post-restart workload had more live entities (13–17 versus 9–13), reset projection baselines, recovery traffic and a fresh isolate. The level shift cannot be attributed to the Phase 2A.8 pathfinding change, a leak or a specific subsystem from this evidence. It is reported as an unexplained operational observation.

### 5.3 Comparison with previous phases

| Run | Duration | Ticks | Platform CPU | CPU/tick (derived) | Peak memory |
| --- | ---: | ---: | ---: | ---: | ---: |
| Phase 2A.3 pre-delta soak | 1,800 s | 35,996 | 38,708 ms | 1.075 ms | 47.61 MiB |
| Phase 2A.4 delta soak | 1,800 s | 35,994 | 19,698 ms | 0.5472 ms | 33.12 MiB |
| **Phase 2A.10 Build B** | **1,800 s** | **35,921** | **20,014.378 ms** | **0.5572 ms** | **33.6966 MiB** |

Phase 2A.10 used 1.6% more CPU and 1.8% more CPU per tick than Phase 2A.4, with 0.2% fewer ticks, 24.9% more accepted commands and 45.9% more network bytes. These are different runs and workloads, so the comparison is descriptive, not controlled.

The ordinary room cost is essentially unchanged from the pre-Phase 2A.8 Phase 2A.4 soak. That is not evidence against the Phase 2A.8 optimisation: Phase 2A.8 targets the burst of path requests from a mass order, and Phase 2A.9 measured that case directly. It does mean this soak provides no independent evidence of a sustained ordinary-room CPU reduction.

Phase 2A.9's controlled A/B result remains the only CPU-improvement evidence:

- 100-tick stress batch, setup-subtracted: 214.1 ms → 141.3 ms (34.0% lower).
- Warm first-tick excess: 15.75 ms → 11.75 ms (25.4% lower).
- All 216 authoritative comparisons matched.

Phase 2A.10 did not repeat that experiment and does not extend it.

## 6. Memory results

These are direct `max.memoryUsageBytes` values, converted to MiB:

| Time | Reported memory |
| --- | ---: |
| 20:27:40 (first bucket) | 10.78 MiB |
| 20:35:40 | 18.50 MiB |
| 20:43:40 | 29.67 MiB |
| 20:44:40 | 31.46 MiB |
| 20:45:31 (restart bucket) | 31.55 MiB |
| 20:47:31 (peak) | **33.70 MiB** |
| 20:48:31 | 30.29 MiB |
| 20:50:31 | 31.65 MiB |
| **20:51:31** | **6.64 MiB** |
| 20:52:31 | 8.00 MiB |
| 20:56:31 | 5.73 MiB |
| 20:57:31 (last bucket) | 6.96 MiB |

Before the restart, the series rose from 10.78 MiB to 31.46 MiB over 17 minutes, a fitted slope of about **+1.25 MiB/min**. That slope alone would be concerning if the series had continued unchanged.

It did not. At 20:51:31 the same object id, still with two active WebSocket connections and no socket-close event, reported **6.64 MiB** — a 26.7 MiB fall. The final buckets remain between 5.73 and 8.00 MiB. There is no monotonic rise across the whole room.

Interpretation:

- The fall is consistent with runtime heap commitment and garbage collection, not a growing application object graph.
- The pre-restart rise could still represent runtime heap growth or temporary allocation slack; the platform does not expose retained heap.
- The room's application-owned state remained small: the final projections were 17 and 6 entities, and the scenario, fog and map sizes are fixed.
- `NavBatch` is command-scoped and has no module-level cache; it is not stored in the room snapshot or client projection. The observed memory pattern does not suggest retained navigation-batch state, but there is no direct retained-heap measurement.

Peak memory is similar to Phase 2A.4 (33.70 MiB versus 33.12 MiB) and below Phase 2A.3 (47.61 MiB). The 30-minute and two-room caps remain justified.

## 7. Restart and recovery event

This is the main operational finding.

### 7.1 What happened

At `20:45:31Z`, 17 minutes 34 seconds into the match:

- Seat 0 socket closed at `20:45:31.140Z` with no close code.
- Seat 1 socket closed at `20:45:31.136Z` with no close code.
- Both clients opened a reconnect within 5 ms and completed it in **462 ms** (seat 0) and **469 ms** (seat 1).
- The room object id did not change.
- The room's diagnostics tick count and `startedAtMs` reset to the reconnect time.
- The authoritative state restored and continued: the last pre-restart command acknowledgement was tick 21,015; the first post-restart acknowledgement was tick 21,043.
- The clients rejected **363** sync/delta updates between `20:45:31.609Z` and `20:45:51.739Z`.
- The first rejections were `epoch-mismatch` (`Sync epoch did not advance`, `Delta belongs to another sync generation`), followed by `sequence-stale` (`Delta sequence 202 is older than 10532`).
- At `20:45:46.761Z` the server returned `resync-rate-limited`.
- The clients requested 5 and 4 resyncs; the server accepted 8 and rejected 1.
- The clients finally resynchronised at about `20:45:51.739Z`, a **20.13 s** recovery window.
- The longest accepted-snapshot gaps were 20,663 ms (seat 0) and 15,762 ms (seat 1). The next accepted tick deltas were 340 and 242 ticks.
- The match continued to the fixed deadline and finished correctly.

No CPU-limit, memory-limit or fatal platform error accompanied the restart. The original invocation rows end with `responseStreamDisconnected`; the cause is not established from the available telemetry. It is consistent with a runtime isolate/object restart, not an application exception.

### 7.2 Why recovery took 20 seconds

The protocol recovery defect is visible in the source:

- `RoomSnapshotV1` stores the simulation, result and seat metadata, but not each seat's live `epoch` or `seq` (`src/multiplayer/roomSnapshot.ts`).
- A new `RoomMatch` initialises every seat at `epoch: 0` (`src/multiplayer/roomMatch.ts:302`).
- `restoreRoomMatch` rebuilds the match but does not restore a per-seat epoch or sequence (`src/multiplayer/roomMatch.ts:1036`).
- Every `sendSync` increments the seat epoch (`src/multiplayer/roomMatch.ts:771`).
- The client assembler requires a sync epoch strictly newer than its current epoch and rejects deltas from another generation.

After a restart, the server therefore resumes at a **lower** epoch than the client had already observed. The client can only accept a sync once repeated sync openings have incremented the server epoch past its previous value; the client's resync requests accelerated that process. In this run it took multiple full syncs and about 20 seconds, with one request rate-limited along the way.

This is a deterministic protocol recovery defect. It is not caused by the Phase 2A.8 pathfinding changes. The clean reconnect path, where the same object increments the existing epoch, passes in 82 ms (section 11). The failure is specific to restore after a runtime restart.

A second recovery metadata issue is visible: `restoreRoomMatch` does not carry `startedAtMs`, so the reloaded match is constructed with `Date.now()` as its start. The final room status consequently reports `startedAtMs = 20:45:31.600Z` and `elapsedMs = 746,102` for a match that actually began at `20:27:57.702Z`. The hard deadline and final tick remain correct; the diagnostic timing does not.

### 7.3 Recovery traffic

The post-restart server diagnostics recorded **16 sync messages / 695,173 bytes** across both seats. The clients accepted 8 syncs per seat over the whole run; only two accepted syncs per seat carried a map (initial baseline and recovery). Rejected resync responses are not included in the client's accepted map-byte total, so the recovery's full-sync traffic is larger than the accepted 83,594 bytes of map per seat.

The one-minute CPU bucket containing the restart is 807.1 ms, above the surrounding pre-restart buckets. The subsequent post-restart buckets remain higher than the pre-restart level, but they do not continue rising. The extra recovery work is a plausible contributor to the first post-restart bucket; it does not explain the entire level shift.

## 8. Pathfinding and navigation validation

### 8.1 What was exercised

The soak used the real `Game.tick()` path and the Phase 2A.8 implementation. It exercised:

- Single-unit movement orders: 64 moves with one id.
- Two-unit movement orders: 321 moves with two ids.
- Orders above the four-unit batching threshold: 7 moves with seven ids.
- Attack orders with four to six ids: 11 orders.
- Repeated commands after units moved.
- Commands after unit destruction and changing occupancy.
- One `not-your-entity` rejection and five `no-capable-attacker` rejections, both normal command-domain outcomes.

The seven-unit opening orders cross the `entities.length >= 4` threshold and therefore use the shared `NavBatch`. The all-air bypass was not exercised because no air units were present. No naval domain was exercised.

### 8.2 Boundedness

Source inspection confirms the intended lifetime:

- `NavBatch` is created inside `Game.commandMove` or `Game.canOrderMove`.
- It is passed only to that command's path requests and then dropped.
- There is no module-level cache.
- It is not included in `SaveData`, `RoomSnapshotV1`, team projections or wire messages.
- The room's memory did not show a monotonic post-command rise; it fell sharply at 20:51 without a restart.

Direct navigation-batch creation and traffic-mask counters are not exposed by the room diagnostics. This soak therefore establishes sustained use and no observed retained growth, not a counted number of batch creations. The Phase 2A.8 allocations and equivalence tests remain the direct evidence for the batch implementation.

### 8.3 Determinism and equivalence

Phase 2A.10 made no simulation, pathfinding or protocol changes, so it did not rerun the Phase 2A.9 216-case A/B equivalence suite. The soak's client reconstruction matched the server tick at completion for both seats. The existing Phase 2A.8 equivalence tests and full suite remain the deterministic evidence for the pathfinding change; this room is an operational soak, not a new equivalence experiment.

## 9. Transport and protocol

### 9.1 Delivery

| Measurement | Seat 0 | Seat 1 |
| --- | ---: | ---: |
| Accepted snapshots/deltas | 17,793 | 17,842 |
| Snapshot bytes | 14,888,870 | 10,643,425 |
| Syncs | 8 | 8 |
| Accepted map-bearing syncs | 2 | 2 |
| Accepted map bytes | 83,594 | 83,594 |
| Map-less checkpoint syncs | 6 | 6 |
| Deltas | 17,785 | 17,834 |
| Delta p50 | 399 B | 410 B |
| Delta p99 | 2,391 B | 2,732 B |
| Delta max | 3,633 B | 4,339 B |
| Snapshot gap p50 / p95 / p99 | 100 / 103 / 134 ms | 100 / 103 / 133 ms |
| Longest gap | 20,663 ms | 15,762 ms |
| Final epoch / seq | 8 / 7,467 | 8 / 7,467 |

Total accepted network payload: **25,532,295 bytes** (24.35 MiB).

The map is 41,797 bytes. Each seat's accepted map total is exactly two maps, corresponding to the initial baseline and the recovery baseline. The other six accepted syncs per seat were map-less checkpoints. `deltaMapBytes` is **0**.

The tick-delta histogram is almost entirely 2 ticks, consistent with 10 Hz snapshots over a 20 Hz simulation. The single 340-tick and 242-tick gaps are the recovery interval, not a change in simulation step.

### 9.2 Recovery rejects

The 363 rejected updates are the one transport failure in this soak. They were all in the 20.13 s restart-recovery window. Outside that window, there were no rejected deltas, no sequence anomalies and no map-bearing deltas.

The final reconstruction proves that recovery eventually converged:

- Both assemblers ready.
- Epoch 8 for both.
- Final tick 35,921 for both.
- 6,912 map tiles and 6,912 fog tiles for both.
- Outcomes `victory` / `defeat`, matching the server result.

The deployed 15-check smoke separately confirms team projection isolation: no hidden enemy ids or coordinates, no opposing economy, and no map or full state in a delta.

### 9.3 Keepalive

- Sent/acked: **89/89** seat 0, **89/89** seat 1.
- Server after restart: 74 received, 74 acked, 0 rate-limited.
- No keepalive failure or timeout.
- Both seats remained connected from their recovery at 20:45:31 until the final result.

The keepalive protocol behaved as designed; the recovery delay was an epoch/sync issue, not a liveness failure.

## 10. Persistence and recovery

### 10.1 Post-restart diagnostics

The restart reset the in-process persistence counters, so the following figures cover the final 12.4-minute segment only:

| Measurement | Value |
| --- | ---: |
| Snapshot cycles | 50 |
| Meta cycles | 87 |
| Writes | 437 |
| Deletes | 300 |
| Bytes written | 12,752,519 |
| Chunks written | 300 |
| Maximum snapshot | 256,312 B |
| Last snapshot | 254,735 B |
| Failures | 0 |
| Behind | false |
| Durations available | false |

### 10.2 Whole-room evidence

The platform reported 1,779 rows written and 848 rows read for the room. This matches the Phase 2A.4 row-write count exactly and is consistent with roughly 120 snapshot cycles over the full 30 minutes. The exact full-room byte total is **not available** because the restart reset the byte counters; 12.75 MB is a lower bound, not a total. No value is imputed.

The recovery snapshot remains a complete room snapshot, and the largest observed snapshot is 256,312 B. That is unchanged in kind from the 262 KB Phase 2A.4 recovery snapshot. This phase did not optimise persistence.

### 10.3 Recovery outcome

The room restored the authoritative game from the last persisted snapshot, not from a client or a projection. The save codec and server-authoritative snapshot path are unchanged. The restored tick continued from approximately 21,030; the clients' first post-restart acknowledgements advanced to 21,043. Approximately 72 ticks (3.6 s) were lost, within the 15 s persistence interval.

No persistence failure, queue backlog or stale-write condition was observed. The recovery defect is in the transport generation, not in the simulation snapshot.

## 11. Match completion and lifecycle

At the fixed deadline:

- Both seats received `result`: seat 0 victory, seat 1 defeat, reason `time-limit`, tick 35,921.
- Both sockets closed with code `1000` and reason `match-finished`.
- The room reports `closed: true`, `closedReason: match-finished`.
- The reservation is `released`; release succeeded once and failed zero times.
- A subsequent capacity test succeeded with statuses `[200, 200, 503, 200]`.
- No abandoned seat, deadline miss or abnormal shutdown occurred.

The post-soak lifecycle harness passed all six tests:

| Test | Result |
| --- | --- |
| Clean reconnect | pass — epoch 2, recovery 82 ms, reservation released |
| Permanent disconnect / abandonment | pass — abandoned, victory, observed after 30.1 s, released |
| Controlled shutdown | pass — HTTP 200, `room-shutdown`, released |
| Hard deadline | pass — draw/draw, 195 ticks in 9.8 s, released |
| Explicit resync | pass — epoch 2, 39 ms, released |
| Capacity boundary | pass — `200, 200, 503, 200`, `capacity-full`, released, slot reusable |

The deployed 15-check smoke passed:

- 101 upgrade and two seats connected.
- Team projections isolated.
- Valid command accepted; forged authority and oversized frames rejected.
- Wrong token 401, foreign origin 403, duplicate seat 409.
- Resync checkpoint applied; reconnect accepted on a new epoch.
- Delta carried no map or full state.
- Result delivered to both seats; reservation released; capacity boundary enforced.

The clean reconnect and explicit resync tests pass because the same live object increments its existing epoch. They do not cover the restart case, where the restored object resets its epoch to zero and also loses `startedAtMs`. That is why the soak's restart recovery is not contradicted by the green lifecycle suite.

### 11.1 Local verification

| Check | Result |
| --- | --- |
| TypeScript typecheck | **PASS** — `tsc --noEmit` |
| Full Vitest suite | **PASS** — 95 files, 943 tests |
| Production build | **PASS** — Vite build and service-worker precache |
| Calibration/profiling markers in the production bundle | **0** |
| `MULTIPLAYER_FEATURE.enabled` | **false** |
| Source changes in Phase 2A.10 | **none** |

The production build emitted the existing chunk-size warning (662.43 kB JavaScript); it did not fail. Logs are in `staging-evidence/phase2a10-typecheck.log`, `phase2a10-vitest.log` and `phase2a10-build.log`.

## 12. Comparison with previous evidence

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Phase 2A.4 delta soak | 30-minute stability, map-once transport, 0.547 ms/tick aggregate, peak 33.12 MiB | Per-tick CPU, retained heap, restart recovery |
| Phase 2A.3 keepalive/memory | Keepalive design, memory growth pattern, 47.61 MiB peak | The current transport generation |
| Phase 2A.8 local benchmark | Allocation and local wall-clock reduction for mass orders | Deployed Worker CPU |
| Phase 2A.9 A/B | Controlled deployed CPU reduction for the 80-unit burst | Ordinary-room sustained CPU, per-tick CPU |
| **Phase 2A.10** | 30-minute Build B stability, 20,014 ms CPU, 33.70 MiB peak, restart-recovery defect | Symmetric two-sided load, air/naval pathfinding, 80-unit burst, 10 ms target |

The ordinary-room CPU is essentially unchanged from Phase 2A.4. That is compatible with the optimisation targeting a mass-order burst that this room does not generate at 80-unit scale. It is not a controlled comparison and should not be presented as evidence of a sustained ordinary-room gain.

The memory peak is similar to Phase 2A.4 and lower than Phase 2A.3. The 20:51 drop is stronger evidence against a monotonic application leak than the earlier minute-27 drop, because it occurred with the same object id, two live sockets and continuous diagnostics. It still does not measure retained heap.

## 13. Acceptance assessment

| Criterion | Status | Evidence |
| --- | --- | --- |
| 1. Correct Build B completes a 30-minute staging match | **PASS** | Version `d23e416c`, 1,799.7 s, 35,921 ticks, final results |
| 2. Expected 20 Hz cadence, deviations documented | **PASS with deviation** | 19.956 Hz whole-match; 20.000 Hz post-restart; 72–79 ticks lost at restart (0.22%) |
| 3. Both seats receive final results | **PASS** | `victory` / `defeat`, tick 35,921, both sockets `1000 match-finished` |
| 4. No unexpected tick, serialization, transport or persistence errors | **NOT MET** | 363 rejected updates and one `resync-rate-limited`; tick, serialization and persistence error counters are zero |
| 5. Navigation-batch state remains bounded | **PASS, indirect** | Command-scoped class with no module cache; no retained growth; no direct batch counter |
| 6. No unexpected CPU or memory drift | **NOT MET / PARTIAL** | CPU per minute level shift +33.5% after restart; memory rises then falls 26.7 MiB; no continuing rise, no attribution |
| 7. Snapshot/delta delivery remains correct | **PASS with interruption** | Two accepted map baselines per seat, zero map bytes in deltas, exact final reconstruction |
| 8. Keepalive, reconnect and lifecycle checks pass | **CONDITIONAL** | Keepalive 89/89 and clean lifecycle pass; restart recovery took 20.13 s with 363 rejects |
| 9. Reservation released and subsequent admission succeeds | **PASS** | `r164` released; capacity `200, 200, 503, 200` |
| 10. Raw evidence preserved and independently reviewable | **PASS** | Evidence directory, platform JSON, analysis JSON and README |

**Overall: CONDITIONAL.** The match completed and the authoritative state recovered, but the run does not satisfy a clean stability pass because of the restart-recovery transport failure and the unexplained post-restart CPU level shift. The result is useful precisely because it exposed a recovery defect that the clean lifecycle tests do not cover.

## 14. What is measured, derived and unproven

### Directly measured

- 35,921 authoritative ticks and the final result tick.
- 20,014.378 ms of platform CPU over 31 one-minute buckets.
- 232.559 GB-s of platform duration and 1,779 rows written.
- 33.6966 MiB peak reported memory and the 20:51:31 6.64 MiB reading.
- 25,532,295 bytes of accepted client payload.
- 363 rejected updates, 20.13 s recovery, 89/89 keepalives, 447 accepted commands.
- Final reconstructed tick, map and fog.
- Reservation release and capacity statuses.

### Derived estimates

- 0.5572 ms aggregate CPU per completed tick.
- 19.956 Hz whole-match effective rate.
- 72 ticks lost from adjacent command acknowledgements; 79 ticks below 36,000.
- Pre/post-restart CPU per minute means and the +33.5% level shift.
- 1.25 MiB/min pre-restart memory slope.

### Not established

- Individual tick CPU, per-tick maximum or percentile.
- The 10 ms per-tick CPU target.
- Retained-heap attribution.
- Exact full-match persistence bytes after the diagnostics reset.
- Navigation-batch creation count, path-request count and search-failure count.
- A controlled sustained CPU improvement from Phase 2A.8.
- That the room represents a symmetric two-sided or 80-unit workload.

## 15. Risks and recommended next steps

1. **Fix restart epoch continuity before relying on recovery.** A separate implementation phase should persist the per-seat epoch/sequence, or derive a globally monotonic generation that survives restore, and add a deterministic restart test. A client must never need 20 seconds of rejected baselines to recover. This is a protocol/recovery change and was deliberately not made in Phase 2A.10.
2. **Restore or derive `startedAtMs`.** The post-restart status currently reports a false match start and a 746 s elapsed time. This corrupts diagnostic cadence and any summary that trusts it. The hard deadline and final tick are unaffected.
3. **Reduce duplicate recovery syncs.** A rejected resync currently causes another full sync. The server recorded 695 KB of sync traffic in the recovery segment. A future protocol change should avoid re-sending a full baseline until the client can accept a new generation.
4. **Re-run a symmetric sustained workload.** This match had 359 seat-0 commands and 94 seat-1 commands, and no air/naval units. A future soak should keep both seats producing and commanding, and separately exercise the 80-unit burst through the existing calibration path.
5. **Do not raise the 2-room or 30-minute caps.** This one room used 232.56 GB-s and 1,779 rows, about 1.8% of each daily free allowance. One successful room is not evidence for concurrent 30-minute rooms.
6. **Keep the 10 ms target unverified.** No evidence in this phase measures an individual tick.

## 16. Reproduction

```bash
# Confirm the active staging version and feature state.
npx wrangler deployments status --config mp-room-wrangler.jsonc

# 30-minute two-seat soak.
MP_SOAK_MS=1800000 MP_SOAK_LABEL=phase2a10-30m \
  node tools/phase2a1-soak.mjs

# Post-soak lifecycle, abandonment, shutdown, deadline, resync and capacity.
node tools/phase2a1-failure-tests.mjs

# Deployed protocol/security smoke.
node tools/phase2a-deployed-smoke.mjs

# Local verification.
npm run typecheck
npx vitest run
npm run build
```

The deployed Worker URL is `https://mca-multiplayer-staging.horsemeninteractive.workers.dev`. Do not deploy this configuration to production or enable `MULTIPLAYER_FEATURE`.

## 17. Evidence index

| Path | Contents |
| --- | --- |
| `staging-evidence/phase2a10-30m-2026-10-30T20-27-39-949Z/summary.json` | Full soak summary: protocol, commands, gaps, reconstruction, reconnects, keepalives |
| `.../status-final.json` | Final room status, result, closed state and released reservation |
| `.../status-mid.json` | Post-restart playing status: epoch, tick, diagnostics, persistence |
| `.../metrics.jsonl` | Timestamped commands, socket closes, reconnect events, 363 assembly rejects and interval records |
| `.../run.log` | Human-readable progress and interval log |
| `.../room.json` | Sanitised room handle; tokens removed |
| `staging-evidence/phase2a10-platform-periodic.json` | 31 exact one-minute platform CPU, memory, duration and counter buckets |
| `staging-evidence/phase2a10-platform-invocations.json` | Sparse invocation groups and their coverage limitation |
| `staging-evidence/phase2a10-analysis.json` | Derived analysis with direct measurements separated from estimates |
| `staging-evidence/phase2a10-evidence-README.md` | One-page evidence index, metric coverage and reproduction |
| `staging-evidence/phase2a10-deployment.txt` | Deployment, source revision, hashes and unchanged safety limits |
| `staging-evidence/phase2a10-lifecycle.log` | Post-soak lifecycle and capacity results |
| `staging-evidence/phase2a10-deployed-smoke.log` | 15-check deployed protocol/security smoke |
| `staging-evidence/phase2a10-typecheck.log` | `tsc --noEmit` |
| `staging-evidence/phase2a10-vitest.log` | Full Vitest run |
| `staging-evidence/phase2a10-build.log` | Production build |

Seat tokens, admin tokens, account identifiers and API credentials are not stored in these files.

## 18. Bottom line

Phase 2A.10 confirms that the Phase 2A.9 Build B can run a full 30-minute room, sustain the authoritative simulation, deliver a correct result and release its reservation. It also shows that a runtime restart exposes a real transport recovery defect: seat epochs reset on restore, so the client rejects valid baselines until repeated resyncs catch up, losing about 20 seconds of usable state and 72–79 authoritative ticks. Peak memory remained bounded at 33.70 MiB and then fell sharply with the same object, which argues against a monotonic application leak, but retained heap is still unmeasurable.

The ordinary-room CPU total, 20.014 s, is essentially unchanged from the pre-Phase 2A.8 Phase 2A.4 soak. That is consistent with the optimisation targeting mass-order bursts, not with a claim of sustained ordinary-room improvement. The controlled Phase 2A.9 A/B result remains the CPU evidence for Phase 2A.8. This phase does not prove the 10 ms per-tick target, symmetric two-sided load, or concurrent-room capacity.
