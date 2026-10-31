# MCA — Phase 2A.14: Full 30-Minute Recovery-Enabled Stability Soak

**Build under test:** Phase 2A.13 staging, Worker version `9fd1dcf4-3046-438d-b72d-0c3880b0afc5`
**Artifact SHA-256:** `cfca794ca41719449fd827fcd06b13ddbdb806c2b7d54a02703e9c4959396f1a`
**Run:** `phase2a14-30m-final`, room `phase2a14-30m-final-mvvplakw`
**Source revision:** `132ccc8363d5b5bc98b6518b4afd1738dedaad6a` (branch `master`)
**Verdict:** **CONDITIONAL** — the full match and both controlled restarts passed, but the combat workload was one-sided and the deployed final snapshot bytes could not be independently re-read and validated.

---

## 1. Summary

A complete 30-minute, two-seat authoritative match ran against the isolated staging Worker from **2026-10-31T01:14:58.524Z** to **2026-10-31T01:44:58.373Z**.

- **35,477** whole-match authoritative ticks at **19.711 Hz** (expected 35,997 at 20 Hz; 1.44% deficit).
- **720/720 commands accepted** (360 per seat), **0 rejected**, **0 timeouts**.
- Both seats reconstructed the same final tick and outcome: seat 0 `defeat`, seat 1 `victory`, winner team 1, reason `time-limit`, tick `35,477`.
- Two controlled Durable Object restarts recovered successfully at checkpoint ages **2.064 s** and **12.796 s** (measured at socket close; request ages 1.962 s and 12.712 s), both inside the 15-second checkpoint policy.
- An **unplanned third runtime restart** occurred at **01:25:56.044Z**. It also recovered through the existing lifecycle with no rejected updates. It is recorded separately and is not counted as one of the two controlled trials.
- Final result delivery, room closure and guarded reservation release succeeded. Reservation `r266` was released once; the subsequent capacity sequence was `200, 200, 503, 200`.
- TypeScript, production build and the full suite passed before and after the soak: **97 test files, 980 tests, 0 failures**.
- The Phase 2A.13 17-test integrity suite and the Phase 2A.11 14-test recovery suite both remained green.

The operational recovery objective was met. The verdict is **CONDITIONAL** rather than PASS for two evidence reasons:

1. **Combat activity was not seat-balanced.** Seat 0 issued all 53 attack-move probes and the only direct attack. Seat 1 issued 360 accepted commands but no attack-move or direct attack. Command volume was balanced; combat exposure was not.
2. **The deployed final snapshot was written but not re-read.** Closed rooms are intentionally not restored, so the exact final bytes did not pass through `validateRoomSnapshot` in this run. Strict finalisation validation is covered by the Phase 2A.13 integrity tests and the write recorded zero persistence failures, but that is indirect evidence for this match’s final artifact.

Neither issue is an observed recovery, authority, deadline or data-integrity failure. They are coverage limitations, which is why the verdict is CONDITIONAL.

---

## 2. Exact build verification

| Item | Observed |
|---|---|
| Worker | `mca-multiplayer-staging` |
| URL | `https://mca-multiplayer-staging.horsemeninteractive.workers.dev` |
| Active version | `9fd1dcf4-3046-438d-b72d-0c3880b0afc5` |
| Version tag | `phase2a13` |
| Version created | `2026-10-31T00:02:04.043Z` |
| Deployment created | `2026-10-31T00:02:05.643Z` |
| Health build label | `phase2a13-staging` |
| Local uploaded artifact | `dist-mp-room/roomWorker.js` |
| Artifact SHA-256 | `cfca794ca41719449fd827fcd06b13ddbdb806c2b7d54a02703e9c4959396f1a` |
| Source HEAD | `132ccc8363d5b5bc98b6518b4afd1738dedaad6a` |
| Feature flag | `MULTIPLAYER_FEATURE.enabled = false` |
| Uncommitted work | 159 modified/untracked paths, none staged; preserved |

`wrangler deployments list` and `wrangler versions view` were run after the soak. The active version and tag still match Phase 2A.13; the health endpoint still returns `build: "phase2a13-staging"`. No deployment occurred after Phase 2A.13 before or during this soak.

**Artifact-hash limitation.** Cloudflare’s version metadata does not expose a downloadable module digest. The version ID, tag, creation time, health label and deployment history were checked, and the local uploaded bundle still hashes to the digest recorded at deployment. This is not a byte-for-byte download of the deployed module. Raw evidence: [`phase2a14-deployment-verification.json`](staging-evidence/phase2a14-deployment-verification.json), [`phase2a14-deployments-post.log`](staging-evidence/phase2a14-deployments-post.log), [`phase2a14-version-post.log`](staging-evidence/phase2a14-version-post.log), [`phase2a14-artifact-post.txt`](staging-evidence/phase2a14-artifact-post.txt).

---

## 3. Test design and workload

One room, two seats, one authoritative Durable Object simulation. The harness was the Phase 2A.12/2A.14 raw-WebSocket soak client, with a revised bounded-combat workload.

### 3.1 Configuration

| Setting | Value |
|---|---|
| Match target | 1,800,000 ms |
| Command interval | 5,000 ms per seat |
| Production interval | 180,000 ms per seat |
| Status polling | 10,000 ms normally, 250 ms around restarts |
| Keepalive | Existing versioned protocol, 20 s interval |
| Checkpoint interval | 15,000 ms (unchanged) |
| Restart offsets | 300,000 ms, 1,080,000 ms |
| Restart target ages | 1,500 ms, 12,500 ms |
| Authoritative target | 20 Hz |
| Snapshot/delta target | 10 Hz |

The harness does not generate continuous mass-order bursts. Movement orders are small, bounded groups. Combat probes are limited to a 45 s window every 240 s, with two combat units leaving the base and a direct attack attempted only when a visible enemy is present and at least four combat units are available.

### 3.2 Per-seat commands

| Seat | Accepted | Move | Attack-move | Produce | Direct attack | Rejected | Timeouts |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | 360 | 296 | 53 | 10 | 1 | 0 | 0 |
| 1 | 360 | 350 | 0 | 10 | 0 | 0 | 0 |
| **Total** | **720** | **646** | **53** | **20** | **1** | **0** | **0** |

Command acceptance rate was **1.000**; command latency was p50 **17 ms**, p95 **21 ms**, p99 **48 ms**, max **118 ms**.

**Balance assessment.** Command volume is exactly balanced (360/360), and both seats produced engineers. Combat exposure is not balanced: the global probe scheduler allowed seat 0 to start every probe, so all 53 attack-move orders and the single direct attack belong to seat 0. Seat 1 moved and produced throughout, and was attacked, but never issued an attack-move or direct attack. This is a workload-design limitation, not a protocol failure. It means this run is a two-seat command/transport/recovery soak, not a symmetric combat stress test.

### 3.3 Gameplay evidence

- Casualties and entity removal are visible in the 30 s client samples: seat 0 entity count fell from 15 to 13 and own units from 9 to 8; seat 1 fell from 9 to 8 and own units from 8 to 7 during the early probes.
- A later contact at 01:24:58 shows 1 and 4 visible enemies, non-empty projectile state (139 bytes of projectile data), and a large event window.
- The one explicit attack order was issued at **01:20:34.308Z** by seat 0: units `9,10` attacked target `22`.
- Ten engineers were produced per seat over the match; final reconstructed entities were 19 for seat 0 and 14 for seat 1, with 13 own units each.
- Projectile activity is evidenced by the non-empty projectile payload at 01:24:58. Exact per-projectile counts and exact kill attribution were not recorded by the harness.

The workload exercised movement, pathfinding, bounded attack-move probes, one direct attack, entity removal, casualties, production, fog projection, snapshots/deltas and checkpointing. It did **not** exercise symmetric combat from both seats.

---

## 4. Match completion and tick accounting

| Item | Observed |
|---|---|
| Match start | `2026-10-31T01:14:58.524Z` (`1793409298524`) |
| Match finish | `2026-10-31T01:44:58.373Z` (`1793411098373`) |
| Hard deadline | `2026-10-31T01:44:58.373Z` |
| Elapsed match time | 1,799,849 ms |
| Nominal duration | 1,800,000 ms |
| Whole-match ticks | 35,477 |
| Expected ticks at 20 Hz | 35,997 |
| Effective whole-match rate | 19.7111 Hz |
| Tick deficit | 520 ticks (1.44%) |
| Final process-local ticks | 13,878 (post-restart only) |
| Final result | seat 0 `defeat`, seat 1 `victory`, winner team 1, `time-limit` |
| Final tick in both clients | 35,477 |
| Room closed | true, `match-finished` |
| Reservation | `r266`, released |

The match ended 151 ms before a nominal 1,800,000 ms interval measured from the observed start. The deadline was not extended.

### Tick-loss accounting

Measured checkpoint rollback from the last authoritative tick before each restart:

- Restart A: **39 ticks** (1,950 ms).
- Restart B: **255 ticks** (12,750 ms).
- Unplanned restart: **159 ticks** (7,950 ms).

Total measured rollback: **453 ticks** (22.65 s). The remaining **67 ticks** (3.35 s) of the 520-tick deficit are restart downtime, reconnect/restore latency and tick scheduling. They are not individually separable because process-local tick counters reset at each restart. This is an inference from measured intervals, not a per-tick trace.

`processTicks` is post-restart only. `totalTicks` is the durable whole-match counter. The final diagnostics snapshot was taken in the post-B process and shows 13,878 process ticks and 35,477 total ticks; those must not be conflated.

---

## 5. Controlled restart A — near the start of the checkpoint interval

**Room:** `phase2a14-30m-final-mvvplakw`
**Target age:** 1,500 ms
**Measured age at restart request:** 1,962 ms
**Measured age at socket close:** 2,064 ms
**Within 15 s policy:** yes

### Timeline

| Time (UTC) | Event |
|---|---|
| 01:19:58.538 | Last successful persistence timestamp |
| 01:19:58.712 | Status sampled: tick 6,004, 22 snapshot cycles, 0 failures |
| 01:20:00.500 | Admin restart requested |
| 01:20:00.549 | Restart response returned |
| 01:20:00.602 / .605 | Both sockets closed with no close code |
| 01:20:00.934 | Room restored before reconnect: tick 5,999, process tick 0, snapshot cycles 1, 0 failures |
| 01:20:01.037 / .089 | Seat 1 / seat 0 first restored sync (`epoch 1026`, `seq 3001`, tick 6,001, map included) |
| 01:20:01.075 / .093 | First post-restart delta for seat 1 / seat 0 (tick 6,002) |
| 01:20:01.115 / .136 | First post-restart command accepted for seat 0 / seat 1 (ticks 6,002 / 6,003) |
| 01:20:01.219 / .268 | First resync accepted for seat 0 / seat 1 |
| 01:20:01.239 / .289 | Immediate duplicate resync rate-limited for seat 0 / seat 1 |
| 01:20:01.6xx | Both clients at tick 6,006 after recovery checks |

### Measurements

| Measurement | Seat 0 | Seat 1 |
|---|---:|---:|
| Socket connect latency | 159 ms | 108 ms |
| First sync after close | 483 ms | 431 ms |
| First sync tick | 6,001 | 6,001 |
| First delta after sync | 4 ms | 38 ms |
| First delta tick | 6,002 | 6,002 |
| First accepted command | tick 6,002, 26 ms after sync | tick 6,003, 99 ms after sync |
| Stale sync result | `epoch-mismatch` | `epoch-mismatch` |
| Stale delta result | `epoch-mismatch` | `epoch-mismatch` |
| Resync accepted | yes | yes |
| Immediate duplicate resync | rate-limited | rate-limited |
| State tick after checks | 6,006 | 6,006 |

### Checkpoint rollback

| Measurement | Value |
|---|---:|
| Last authoritative tick before restart | 6,038 |
| Restored snapshot tick | 5,999 |
| Absolute rollback | 39 ticks |
| Equivalent elapsed rollback | 1,950 ms |
| Observed success tick at last persistence | 6,004 |
| Restored snapshot lag from that observation | 5 ticks |
| Pre-restart epoch | 2 (both seats) |
| First restored epoch | 1,026 (both seats) |
| Epoch monotonic | yes |

Commands accepted after the last checkpoint were lost: the post-checkpoint commands at tick 6,039 were accepted before the restart but the room resumed at 5,999. That is expected under the existing 15 s checkpoint policy. The rollback was within the documented bound.

---

## 6. Controlled restart B — near the end of the checkpoint interval

**Target age:** 12,500 ms
**Measured age at restart request:** 12,712 ms
**Measured age at socket close:** 12,796 ms
**Within 15 s policy:** yes

### Timeline

| Time (UTC) | Event |
|---|---|
| 01:33:11.414 | Last successful persistence timestamp |
| 01:33:11.568 | Status sampled: tick 21,603, 30 snapshot cycles, 0 failures |
| 01:33:24.126 | Admin restart requested |
| 01:33:24.160 | Restart response returned |
| 01:33:24.210 / .212 | Both sockets closed with no close code |
| 01:33:24.480 | Room restored before reconnect: tick 21,599, process tick 0, snapshot cycles 1, 0 failures |
| 01:33:24.561 / .571 | Seat 1 / seat 0 first restored sync (`epoch 3079`, `seq 10803`, tick 21,601, map included) |
| 01:33:24.601 / .602 | First post-restart delta for seat 0 / seat 1 (tick 21,602) |
| 01:33:24.651 / .669 | First post-restart command accepted for seat 0 / seat 1 (tick 21,603) |
| 01:33:24.694 / .746 | First resync accepted for seat 0 / seat 1 |
| 01:33:24.716 / .764 | Immediate duplicate resync rate-limited for seat 0 / seat 1 |
| 01:33:24.8xx | Both clients at tick 21,604 after recovery checks |

### Measurements

| Measurement | Seat 0 | Seat 1 |
|---|---:|---:|
| Socket connect latency | 98 ms | 80 ms |
| First sync after close | 357 ms | 347 ms |
| First sync tick | 21,601 | 21,601 |
| First delta after sync | 30 ms | 41 ms |
| First delta tick | 21,602 | 21,602 |
| First accepted command | tick 21,603, 80 ms after sync | tick 21,603, 108 ms after sync |
| Stale sync result | `epoch-mismatch` | `epoch-mismatch` |
| Stale delta result | `epoch-mismatch` | `epoch-mismatch` |
| Resync accepted | yes | yes |
| Immediate duplicate resync | rate-limited | rate-limited |
| State tick after checks | 21,604 | 21,604 |

### Checkpoint rollback

| Measurement | Value |
|---|---:|
| Last authoritative tick before restart | 21,854 |
| Restored snapshot tick | 21,599 |
| Absolute rollback | 255 ticks |
| Equivalent elapsed rollback | 12,750 ms |
| Observed success tick at last persistence | 21,603 |
| Restored snapshot lag from that observation | 4 ticks |
| Pre-restart epoch | 2,054 (both seats) |
| First restored epoch | 3,079 (both seats) |
| Epoch monotonic | yes |

Commands accepted after the last checkpoint were lost: post-checkpoint commands at tick 21,854 were accepted before the restart but the room resumed at 21,599. This is the expected upper end of the 15 s rollback window.

---

## 7. Authority, epoch and resynchronisation

### 7.1 Epoch continuity

The protocol `epoch` is the sync generation. It is durable across restoration and is not the process-local tick counter.

| Event | Seat 0 before | Seat 0 after | Seat 1 before | Seat 1 after | Monotonic |
|---|---:|---:|---:|---:|---|
| Restart A | 2 | 1,026 | 2 | 1,026 | yes |
| Restart B | 2,054 | 3,079 | 2,054 | 3,079 | yes |
| Final client state | — | 3,083 | — | 3,083 | yes |

The restored epochs are strictly greater than the pre-restart epochs. Both seats ended on the same final epoch and sequence (`3083`, `17743`).

### 7.2 Stale messages

For each controlled restart, the harness deliberately retained a pre-restart sync and delta and replayed them after reconnection.

| Event | Stale sync | Stale delta |
|---|---|---|
| Restart A, both seats | rejected `epoch-mismatch` — “Sync epoch did not advance.” | rejected `epoch-mismatch` — “Delta belongs to another sync generation.” |
| Restart B, both seats | rejected `epoch-mismatch` — “Sync epoch did not advance.” | rejected `epoch-mismatch` — “Delta belongs to another sync generation.” |

There were **0 rejected updates** in the client protocol stream and **0 unexpected assembly rejects**. The stale messages were deliberately synthesized probes, not legitimate updates.

### 7.3 Resynchronisation

Final room diagnostics: resync requested **4**, accepted **2**, rejected **2**, last rejection `resync-rate-limited`.

At each controlled restart, both seats:

1. Received a valid restored sync with the static map and 6,912 fog tiles.
2. Accepted a legitimate resync.
3. Had an immediate duplicate resync rejected by the existing rate limit, about 20 ms later.

No prolonged resync failure or rate-limit loop occurred. Resync protection remains active.

### 7.4 Room diagnostics note

Room diagnostics reset at every runtime restart. The final status shows process-local values (for example 276 accepted commands, 68 keepalives, 48 snapshot cycles) after the last restart. Whole-match values come from the harness (`360` commands per seat, `89` keepalives per seat, 35,477 ticks). They are not interchangeable.

---

## 8. Unplanned third restart and half-open observations

An unplanned Durable Object restart occurred at **01:25:56.044Z**, between the two controlled events. There was no admin restart request.

| Item | Observation |
|---|---|
| Last persistence success | 01:25:46.018Z |
| Status at 01:25:52.209 | tick 13,024, 24 snapshot cycles, 0 failures |
| Last accepted commands | seat 0 tick 13,039 at 01:25:52.986; seat 1 tick 13,059 at 01:25:53.982 |
| Sockets closed | 01:25:56.044 / .048, no close code |
| Reconnects | 01:25:56.442 / .446, first attempt, 396 / 397 ms |
| Restored timestamp | 01:25:56.414 |
| Restored snapshot tick | 12,900 (derived: 13,014 total − 114 process ticks at 01:26:02.139) |
| Checkpoint age at close | 10,026 ms |
| Rollback from observed checkpoint | 124 ticks / 6,200 ms |
| Rollback from last accepted command | 159 ticks / 7,950 ms |
| First accepted post-restart commands | seat 0 tick 12,932 at 01:25:58.022; seat 1 tick 12,950 at 01:25:58.944 |
| Both client intervals | tick 12,964 at 01:25:59.649 |
| Rejected updates in the 14 s window | 0 |
| Resync requests | 0 |
| Original start / deadline | unchanged |

The unplanned restart recovered through the existing lifecycle without a rejected-update storm. Its pre/post protocol epoch was not captured because the harness did not schedule it. The final epoch high-water mark (3,083) and the pre-B epoch (2,054) remain monotonic around it, but this event is not counted as one of the two controlled epoch-continuity trials.

### Half-open connections

No half-open socket was observed. All six restart-driven closes produced a close event with no code; both clients reconnected on the first attempt. The final closes were code `1000`, reason `match-finished`. There was no keepalive timeout, no `rateLimited` keepalive, and no undetected stale connection.

Keepalive totals: **89/89 sent/acked per seat**; final process-local server counts 68/68, rate-limited 0. The Phase 2A.13 half-open condition did not recur.

---

## 9. Snapshot and persistence integrity

### 9.1 Persistence results

| Metric | Value |
|---|---:|
| Final persistence reads | 56 |
| Final process writes | 418 |
| Final process deletes | 288 |
| Snapshot cycles (final process) | 48 |
| Metadata cycles (final process) | 81 |
| Load cycles | 1 |
| Persistence failures | 0 |
| Last failure | null |
| Behind | false |
| Last snapshot bytes | 262,370 |
| Maximum snapshot bytes | 262,370 |
| Last persistence success | 01:44:58.417Z (44 ms after finish) |
| Platform object rows written | 1,816 |
| Platform object rows read | 885 |

There were no persistence errors, missed checkpoints, oversized snapshot failures, or delayed-write warnings in the final room diagnostics. The final snapshot was written after finalisation, with the finished result present.

### 9.2 Snapshot growth

Snapshot size grew from approximately **257,144 bytes** at restart A to **260,175 bytes** at restart B and **262,370 bytes** at the finish: **+5,226 bytes (+2.0%)**. That is small and consistent with bounded entity/production growth, not unbounded persistence-state accumulation.

### 9.3 Playing/finished consistency

- Both restored playing snapshots passed strict validation. No `A playing room snapshot cannot have a finish time` error occurred.
- The final status is `phase: finished`, `finishedAtMs` set, `closedReason: match-finished`, with a finished result.
- The final snapshot write succeeded with zero persistence failures.
- Phase 2A.13’s 17-test integrity suite passed, including playing/finished snapshot consistency, repeated finalisation, persistence ordering and invalid-reference rejection.

**Limitation.** Closed rooms are intentionally not restored by the Durable Object, so this run did not re-read the exact final snapshot bytes through `validateRoomSnapshot`. The final write is observed; strict validation of the deployed final artifact is inferred from the unchanged Phase 2A.13 tests, not demonstrated for this match.

### 9.4 Target-reference integrity

The two restored snapshots at ticks 5,999 and 21,599 passed strict restoration. No `Saved targetId references an unknown entity` error occurred. The Phase 2A.13 tests covering move/attack-move target cleanup, entity removal, stale `order.targetId`/`aimTargetId`, strict rejection and combined restore/finalisation all remained green.

**Limitation.** The harness cannot read every persisted chunk from outside the Durable Object. Target-reference integrity was directly exercised on the restored snapshots at A and B, not on every checkpoint or on the final snapshot. No invalid reference surfaced, but continuous per-snapshot validation is not claimed.

---

## 10. CPU and invocation metrics

Source: Cloudflare GraphQL `durableObjectsPeriodicGroups` and `durableObjectsInvocationsAdaptiveGroups`, scoped to the room object.

### 10.1 Coverage

- 32 active object-minute rows, first `01:14:58Z`, last `01:44:24Z`.
- Active time sum **1,799.3 s**, essentially the full 1,799.85 s match.
- One partial row at each restart boundary; the final partial row covers the close.
- CPU is aggregate per object-minute, not per tick. Invocation rows are adaptive groups, not individual invocations.

### 10.2 Aggregate CPU

| Window | CPU ms | Active s | CPU ms per active minute |
|---|---:|---:|---:|
| Early (first 10 min) | 7,487.700 | 602.256 | 745.966 |
| Middle (10–20 min) | 6,081.527 | 623.085 | 585.620 |
| Late (20–30 min) | 5,711.897 | 574.006 | 597.056 |
| **Whole match** | **19,281.124** | **1,799.347** | **642.937** |

CPU was **1.0716%** of active time. There is no increasing trend across the match. Early CPU is higher, consistent with opening pathfinding, first combat and restart A; middle and late are stable (585–597 ms per active minute).

Fatal platform errors: **2**, both in the controlled-restart buckets (01:19:58 and 01:32:56). The unplanned restart bucket reported 0. These are forced-restart lifecycle artefacts, not simulation, serialization or persistence failures; room diagnostics recorded zero tick, persistence and serialization failures.

Invocation dataset: 241 adaptive groups, 369 requests, 8 errors. The errors comprise 4 `internalError`, 2 `responseStreamDisconnected` and 2 `clientDisconnected` requests, all associated with restart/socket lifecycle. The largest adaptive-group CPU p99 was **255,401 µs**, which is not an individual-tick measurement.

**The 10 ms individual-tick CPU target remains unverified.** Aggregate CPU divided by 35,477 ticks (0.5435 ms) is context only and is not evidence for that target, because it includes idle, transport, persistence and sampling overhead across the whole object.

---

## 11. Memory

Source: `memoryUsageBytes` from the object-minute buckets. This is the maximum isolate memory observed per bucket, not retained application heap.

| Metric | Observed |
|---|---:|
| First memory | 14,800,940 bytes (14.12 MiB) |
| Final memory | 51,606,156 bytes (49.22 MiB) |
| Peak memory | 51,606,156 bytes (49.22 MiB) |
| Growth | 36,805,216 bytes (35.10 MiB) |
| Growth rate | 1.17 MiB/min |
| Max active WebSockets | 2 |
| OOM / allocation failure | none observed |

Memory rose steadily, without a reset to the initial value at any restart:

- Before A: 19.91 MiB; after A: 30.34 MiB (new isolate, restore and startup).
- Before B: 42.41 MiB; after B: 42.44 MiB.
- Unplanned restart: 34.37 MiB before, 35.79 MiB after.
- Finish: 49.22 MiB.

The final snapshot is only 262,370 bytes and grew 2.0% over the match. Final reconstructed entity counts were 19 and 14, with 13 own units each. There is no evidence of unbounded application-state growth, but the platform does not provide retained-heap attribution. The increase is consistent with runtime heap commitment, allocator behaviour and restored isolate baselines; it is not proof of a leak.

### Navigation-batch state

The Phase 2A.8 navigation batch is command-scoped. `NavBatch` is created by `Game.commandMove`/`Game.canOrderMove`, used for that command’s path requests, and dropped; there is no module-level cache (`src/sim/navBatch.ts`, header and class lifetime comments). It is not part of `RoomSnapshotV1` and cannot accumulate across ticks, commands or matches by design. This run did not add navigation diagnostics, so it cannot measure the internal batch count directly; the absence of retained batch state is established by source inspection and the simulation-equivalence tests, not by platform memory attribution.

---

## 12. Transport, fog and bandwidth

| Metric | Seat 0 | Seat 1 |
|---|---:|---:|
| Full syncs | 12 | 12 |
| Deltas | 17,981 | 17,981 |
| Delivery frequency | 9.997 Hz | 9.997 Hz |
| Sync bytes | 476,960 | 465,211 |
| Delta bytes | 27,843,951 | 25,117,386 |
| First sync bytes | 58,980 | 58,974 |
| Delta size p50 | 1,448 B | 1,446 B |
| Delta size p95 | 2,340 B | 2,464 B |
| Delta size max | 9,406 B | 11,967 B |
| Longest gap | 999 ms | 581 ms |
| Fog entries | 35,470 | 28,089 |

- Total client-observed transport: **53,903,508 bytes** over the match.
- Every delta carried **0 map bytes**. The static map was delivered with the full sync; deltas carried dynamic state and fog changes only. The Phase 2A.4 bandwidth optimisation is preserved.
- Initial fog baseline was 6,912 tiles per seat; final reconstruction had 6,912 fog tiles and 6,912 map tiles on both clients.
- Both clients reconstructed the same tick (35,477), phase (`finished`) and outcome; entity counts differed by team (19 vs 14) as expected.
- No serialization failures, send failures, slow-client drops, socket backpressure or rejected legitimate updates were recorded. Final buffered bytes were 0/0 per seat.
- Resync: 4 requested, 2 accepted, 2 rate-limited. Stale sync/delta probes were rejected with `epoch-mismatch`.
- Keepalive: 89/89 per seat; server final-process 68/68; 0 rate-limited.

---

## 13. Final result, closure and reservation

| Item | Observed |
|---|---|
| Seat 0 result | `defeat` |
| Seat 1 result | `victory` |
| Winner | team 1 |
| Reason | `time-limit` |
| Result tick | 35,477 |
| Final client tick | 35,477 both |
| Final client phase | `finished` both |
| Final epoch | 3,083 both |
| Final sequence | 17,743 both |
| Room closed | true |
| Close reason | `match-finished` |
| Reservation | `r266` |
| Reservation status | `released` |
| Release successes | 1 |
| Release failures | 0 |
| Deadline hits | 1 |
| Abnormal shutdowns | 0 |

The reservation release path was guarded and idempotent; no duplicate release was recorded. A subsequent admission succeeded after release (capacity sequence `200, 200, 503, 200`). Scores were 5,914.7 for team 0 and 6,637.5 for team 1; time limit decided the result.

---

## 14. Security, capacity and lifecycle regression

### 14.1 Deployed 15-check smoke

Both before and after the soak:

- 15/15 checks passed.
- Build label `phase2a13-staging`.
- `101` WebSocket upgrade; two seats connected; team projections isolated.
- Valid command accepted; forged authority rejected; oversized frame rejected.
- Wrong token `401`; foreign origin `403`; duplicate seat `409`.
- Resync checkpoint applied; reconnect accepted on a new epoch.
- Delta carried no map or full state.
- Result delivered to both seats; reservation released.
- Deployed global capacity boundary enforced.

### 14.2 Lifecycle checks

Both before and after the soak, all six checks passed:

| Check | Result |
|---|---|
| Reconnect | pass |
| Abandon | pass |
| Shutdown | pass |
| Deadline | pass, draw/draw at 195 ticks |
| Resync | pass |
| Capacity | pass, statuses `200, 200, 503, 200`, rejection `capacity-full` |

The two-room maximum, daily allowance and 30-minute deadline were not changed.

### 14.3 Automated verification

| Check | Pre-soak | Post-soak |
|---|---|---|
| TypeScript `npm run typecheck` | pass | pass |
| Production `npm run build` | pass | pass |
| Vitest files | 97 passed | 97 passed |
| Vitest tests | 980 passed | 980 passed |
| Phase 2A.11 recovery tests | 14 pass | 14 pass |
| Phase 2A.13 integrity tests | 17 pass | 17 pass |
| Phase 2A.4 room/delta tests | 24 pass | 24 pass |
| Phase 2A.3 keepalive tests | 10 pass | 10 pass |
| Phase 1 room snapshot tests | 6 pass | 6 pass |

Production bundle scan: `batchCalibration`, `phase2a`, `MP_ADMIN_TOKEN`, `calibration`, `MULTIPLAYER_FEATURE`, `adminToken` and `staging` each returned **0** matches in `dist/assets/index-D2t9Wdf0.js`. The production bundle does not expose staging-only diagnostics or calibration tooling.

Build output: 82 modules transformed; `index.html` 26.03 kB; CSS 114.54 kB; JS 666.16 kB (198.55 kB gzip). The existing >500 kB chunk warning is unchanged.

---

## 15. Limitations and verdict

### 15.1 Observed limitations

1. **Combat workload was one-sided.** Seat 0 issued 53 attack-move probes and the one direct attack; seat 1 issued 350 normal moves and 10 production orders but no attack-move or direct attack. Command volume was balanced (360/360), but symmetric combat was not exercised. This is a harness scheduling limitation: the probe scheduler used one global `nextProbeAt`, so seat 0 always started the probe.
2. **Final deployed snapshot was not re-read.** The final snapshot write succeeded with zero failures, but closed rooms are intentionally not restored. Strict finalisation validation is covered by the Phase 2A.13 17-test suite, not by a direct restore of this match’s final bytes.
3. **Per-checkpoint reference validation is not continuous.** The restored snapshots at A and B passed strict validation, but the harness cannot read every persisted chunk from outside the Durable Object. No invalid reference surfaced; continuous per-snapshot validation is not claimed.
4. **Unplanned third restart.** It recovered cleanly, but its pre/post protocol epoch was not captured because it was not scheduled. The controlled restarts provide the epoch-continuity evidence.
5. **Tick-loss attribution is partial.** Measured rollback accounts for 453 of 520 missing ticks; the remaining 67 are downtime/reconnect/scheduling and are not individually isolated.
6. **The 10 ms individual-tick CPU target remains unverified.** Platform CPU is aggregate per object-minute; no individual invocation CPU distribution was available.
7. **Memory is not retained-heap attribution.** Platform memory is maximum per active bucket, not a heap profile.
8. **Exact deployed artifact digest is not downloadable.** Version ID, tag, health label, deployment history and the local uploaded bundle hash match, but Cloudflare does not expose the deployed module bytes for a second hash.

### 15.2 What passed

- Exact Phase 2A.13 staging version and health label.
- Full 1,799.8 s match; 35,477 ticks; 19.711 Hz.
- 720/720 commands accepted; 0 rejected; 0 timeouts.
- Both controlled restarts recovered.
- Both seats reconnected, received valid restored syncs, accepted post-restart commands and updates.
- Epochs monotonic across both controlled restarts.
- Stale pre-restart sync/delta rejected.
- No legitimate current-epoch updates rejected.
- Checkpoint rollback within 15 s (1.95 s and 12.75 s measured).
- No invalid snapshot observed at either restore; no persistence failures.
- Final result consistent across seats and server.
- Room closed; reservation released exactly once; capacity restored.
- Security, lifecycle, capacity and bandwidth regressions clear.
- Typecheck, build and 980 tests pass.

### 15.3 Verdict

**CONDITIONAL.**

The recovery-enabled build completed the full match, survived two controlled restarts and one unplanned restart, preserved authority and deadlines, and finished cleanly. No observed failure contradicts the Phase 2A.13 fixes.

It is not marked PASS because the run does not provide a symmetric combat workload or direct strict validation of the deployed final snapshot bytes. Those are verification-coverage gaps, not demonstrated defects.

### 15.4 Recommended next decision

Do not start production activation or checkpoint redesign. The next verification step should be narrowly scoped:

1. Change the soak harness probe scheduler to be per-seat so both seats issue attack-move and direct-attack orders, then repeat the 30-minute soak if symmetric combat evidence is required.
2. Add a staging-only read-only final-snapshot validation path (or a supported closed-room validation diagnostic) so the final bytes can be run through the strict validator without restoring the room for play. This would close the remaining final-snapshot evidence gap.
3. Keep the 10 ms individual-tick target as a separate performance investigation requiring per-invocation or per-tick profiling, not aggregate platform CPU.

No production deployment, feature flag change, capacity increase, daily allowance change, checkpoint change or protocol change was made.

---

## 16. Evidence index

Canonical run directory: `staging-evidence/phase2a14-30m-final-2026-10-31T01-14-57-709Z/`

| File | Purpose |
|---|---|
| `summary.json` | Harness summary: commands, results, reconstruction, transport, keepalive, client memory |
| `metrics.jsonl` | Timestamped client events, commands, socket closes, reconnects, intervals |
| `status-samples.jsonl` | 189 room status samples, including fast polling around restarts |
| `restart-0.json` / `restart-1.json` | Controlled restart timelines, checkpoint ages, rollback, epoch, resync and stale-message results |
| `restart-*-status-before.json` | Room status immediately before each controlled restart |
| `restart-*-status-restored-before-connect.json` | Restored status before reconnect |
| `status-final.json` | Final room diagnostics, timing, result and reservation |
| `unplanned-restart.json` | Observed third restart, timings and recovery evidence |
| `phase2a14-analysis.json` | Machine-readable analysis of the canonical run |
| `phase2a14-platform-periodic.json` | Raw Cloudflare periodic CPU/memory rows |
| `phase2a14-platform-invocations.json` | Raw Cloudflare invocation groups |
| `phase2a14-platform-analysis.json` | Early/middle/late CPU and memory summary |

Supporting files at `staging-evidence/`:

- `phase2a14-deployment-verification.json`
- `phase2a14-deployments-post.log`
- `phase2a14-version-post.log`
- `phase2a14-artifact-post.txt`
- `phase2a14-health-post.json`
- `phase2a14-smoke-pre.log`, `phase2a14-smoke-post.log`
- `phase2a14-lifecycle-pre.log`, `phase2a14-lifecycle-post.log`
- `phase2a14-typecheck-pre.log`, `phase2a14-typecheck-post.log`
- `phase2a14-build-pre.log`, `phase2a14-build-post.log`
- `phase2a14-vitest-pre.log`, `phase2a14-vitest-post.log`
- `phase2a14-bundle-scan-post.txt`
- `phase2a14-postchecks.json`
- `phase2a14-analysis-console.log`
- `phase2a14-30m-final-console.log`
- `phase2a14-30m-console.log`
- `phase2a14-worker-tail.log`

See [`staging-evidence/phase2a14-evidence-README.md`](staging-evidence/phase2a14-evidence-README.md) for raw-file notes, reproduction commands and coverage caveats.
