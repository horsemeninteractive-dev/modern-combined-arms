# MCA — Multiplayer Phase 2A.1 Deployed 30-Minute Soak Report

**Date:** 2026-10-30  
**Test window:** 2026-10-30 01:18:16 UTC to 01:48:17 UTC  
**Status:** **PASS for the deployed 30-minute soak.** **Production readiness is not established** because deployed CPU, memory and per-tick duration telemetry are unavailable, and one successful room does not prove multi-room support.

---

## 1. Environment and test integrity

### 1.1 Staging deployment

| Item | Value |
|---|---|
| Worker | `mca-multiplayer-staging` |
| URL | `https://mca-multiplayer-staging.horsemeninteractive.workers.dev` |
| Deployed version | `d4630908-5343-4d58-b941-944d9dc27f50` |
| Deployment timestamp | `2026-10-29T21:33:18.913Z` |
| Health at test start | `ok: true`, `onlineEnabled: true`, `devMode: true`, protocol `mca.v1`, build `phase2a-staging` |
| Production | Not modified; no production route, binding, flag or deployment was changed. |
| Code changes during test | None to game, server or deployment code. Only the two test harnesses and this report/evidence were added. |

The latest deployment listed before and after the soak is still `d4630908-5343-4d58-b941-944d9dc27f50`. No new Worker code was deployed for this task.

### 1.2 Isolation and incoming test state

- The staging Worker is a separate deployment from the production Pages site. It has its own Durable Object namespaces and SQLite storage.
- The only active test harness during the soak was the one described in this report. The pre-soak Phase 2A/2A.1 probes had closed and released before the main room was created.
- The main room was created successfully, proving at least one capacity slot was free. The later capacity test confirmed both slots can be filled and the third request is rejected.
- No other test was started during the main 30 minutes.
- Admin and reservation tokens are Worker secrets. None are present in the harness source, logs, evidence or this report.

### 1.3 Configuration in force

| Setting | Value |
|---|---|
| Seats / mode | 2 seats, 1v1 only |
| Simulation | Fixed 20 Hz, 50 ms scheduler, bounded catch-up |
| Snapshots | 10 Hz per seat |
| Command gate | 1 batch per 100 ms per seat; 4 KiB inbound message cap; 64 entity IDs |
| Message rate cap | 20 inbound messages/s/seat |
| Lease heartbeat | 20 seconds |
| Persistence timer | 15 seconds |
| Abandonment grace | 30 seconds |
| Match hard cap | 30 minutes (`1,800,000 ms`) |
| Capacity policy | 2 active rooms; 10,400 GB-s/day; 80,000 requests/day |
| Online kill switch | `MP_ONLINE_ENABLED=1` on staging; not toggled during this test |

### 1.4 Abort procedure

The harness was designed to stop, not restart, on an unexpected socket close, missing result, heartbeat/finalization failure, capacity rejection or operator interrupt. It would write partial evidence, attempt the admin status, and exit non-zero. No abort was triggered. Both seats remained connected for the entire match.

---

## 2. Test topology and scenario

```text
Two independent Node 24 raw RFC 6455 clients
        │  WSS + mca.v1 / seat token subprotocol
        ▼
mca-multiplayer-staging Worker
        ▼
MatchRoomDurableObject
        ├── authoritative Game (20 Hz)
        ├── CommandGate
        └── team-filtered snapshots (10 Hz)
        ▼
CapacityCoordinatorDurableObject ('global')
```

- Scenario: `createIslandAssault()` (Kestrel Bay), fog enabled, the two shipped players with AI disabled on the server.
- One room, exactly two seats, no AI-controlled third party.
- Both clients issued commands every 5 seconds per seat, with one command in flight per seat.
- Commands were a mix of:
  - `move` with `attackMove: true` toward the central objective;
  - `attack` when an enemy unit was visible;
  - `produce` from the player's Command Post every 180 seconds, producing a Combat Engineer when the queue had room.
- Accepted commands: 443 of 444. One `attack` was rejected with `no-capable-attacker` when the visible target type could not be engaged by the selected force. This was a valid gate rejection, not a transport failure.
- Activity observed: both teams made contact in the first minute; visible enemy units were present at the 30-second interval and the entity count fell as combat resolved. Production then raised the surviving side's unit count from 5 to 15 over the match. The final state had no visible enemies and the result was decided at the time limit.

Timestamps:

| Event | UTC |
|---|---|
| Room created | 2026-10-30T01:18:16.854Z |
| Server match start | 2026-10-30T01:18:17.076Z |
| Client soak start | 2026-10-30T01:18:17.099Z |
| Server hard deadline / finish | 2026-10-30T01:48:16.854Z |
| Client result observed | 2026-10-30T01:48:16.851Z (seat 0 and seat 1) |
| Client soak end | 2026-10-30T01:48:17.027Z |
| Wall-clock elapsed | 1,799,928 ms (29 min 59.9 s) |
| Server simulation elapsed | 1,799,778 ms |

The client duration is slightly shorter than 30 minutes only because the server hard deadline is measured from room creation, about one second before both clients finished connecting.

---

## 3. Simulation stability

### 3.1 Aggregate tick result

| Metric | Result |
|---|---:|
| Server match elapsed | 1,799,778 ms |
| Expected ticks at 20 Hz | 35,996 |
| Actual server ticks | **35,995** |
| Effective tick rate | **19.99969 Hz** |
| Tick deficit | **1 tick (0.0028%)** |
| Tick overruns reported | Not instrumented |
| Tick skips reported | Not instrumented |
| Simulation exceptions / room errors | **0 observed** |
| Socket disconnects before result | **0** |
| Final result tick, both clients | **35,995** |

The one-tick difference is a boundary-scheduling difference at the hard deadline: the server stopped at `finishedAtMs` equal to the reserved deadline, and the tick count is one below the mathematical 20 Hz expectation. It is not a sustained rate degradation.

Both clients ended on tick 35,995. The result was identical from the server and from both seat perspectives:

```json
{
  "phase": "finished",
  "winnerTeam": 0,
  "reason": "time-limit",
  "tick": 35995
}
```

Seat 0 received `victory`; seat 1 received `defeat`. This is the intended neutral result projected per seat.

### 3.2 Client-observed tick progression

Each seat received 17,999 snapshots. Snapshots are sent every two game ticks. The tick-delta histogram was identical for both seats:

| Tick delta between consecutive snapshots | Count |
|---|---:|
| 1 | 1 |
| 2 | 17,997 |
| > 2 | **0** |

The single delta of 1 is the final snapshot/result boundary. No client-observed snapshot skipped more than one two-tick interval, so there is no evidence of a missed snapshot cadence.

### 3.3 Tick-duration limitation

**Per-tick duration p50/p95/p99/maximum and tick-overrun counts are not exposed by the deployed Phase 2A room.** The room reports aggregate tick and snapshot counters but does not record per-tick execution time or an overrun counter. The client sees snapshot inter-arrival gaps, not server tick execution time. Therefore:

- The aggregate 20 Hz rate is measured and passes.
- A claim that the 10 ms Cloudflare CPU headroom was met is **not** supported.
- A claim that there were zero tick overruns is **not** supported. The correct statement is: no simulation exceptions, no tick deficit beyond one boundary tick, and no client-observed tick-delta gap greater than two.
- Client snapshot delivery p99 was 179 ms (seat 0) and 187 ms (seat 1); the longest delivery gaps were 505 ms and 841 ms. These are network/scheduler delivery gaps, not server tick durations. They recovered without a lost tick interval.

---

## 4. Snapshot and network behaviour

### 4.1 Per-seat snapshot counters

| Metric | Seat 0 | Seat 1 |
|---|---:|---:|
| Snapshot messages | 17,999 | 17,999 |
| Effective frequency | 9.99984 Hz | 9.99984 Hz |
| Total snapshot bytes | 1,083,273,417 | 1,041,234,186 |
| Payload p50 | 60,054 B | 57,548 B |
| Payload p95 | 61,715 B | 59,352 B |
| Payload p99 | 61,757 B | 61,372 B |
| Payload maximum | 63,343 B | 62,969 B |
| Payload minimum | 58,524 B | 57,532 B |
| Mean payload | 60,185 B | 57,850 B |
| Inter-arrival p50 | 100 ms | 100 ms |
| Inter-arrival p95 | 104 ms | 103 ms |
| Inter-arrival p99 | 179 ms | 187 ms |
| Longest inter-arrival gap | 505 ms | 841 ms |

Aggregate outbound bytes from the room counter: **2,124,537,809 B (2.125 GB)** for the 30-minute room. This includes hello/snapshot/result/ack traffic; snapshots dominate. Per-seat totals above sum to 2,124,507,603 B, with the remainder being small control messages.

No send failure surfaced as a socket close or client error, and the status endpoint does not report a send-failure counter. No client connection dropped. `bufferedAmount`/queue depth is not exported by the deployed status endpoint, so **unbounded queued work cannot be positively excluded**, but the stable 10 Hz arrival rate, bounded gaps and absence of disconnects are consistent with no persistent queue growth.

### 4.2 Static payload repetition

The 60-second state samples show why the payload is approximately 58–60 KB:

| Average component | Seat 0 | Seat 1 |
|---|---:|---:|
| Total snapshot | ~60,059 B | ~57,775 B |
| `map` (terrain + elevation + ore) | 41,797 B | 41,797 B |
| `fog` | 13,825 B | 13,825 B |
| `entities` | ~3,821 B | ~1,366 B |
| `players` | ~249 B | ~264 B |
| `events` / `projectiles` / `contacts` | ~2 B / ~2 B / small | ~2 B / ~2 B / up to 452 B |
| Map share of payload | **69.59%** | **72.34%** |
| Map + fog share | **92.61%** | **96.27%** |

`terrain`, `elevation` and `ore` each contain **6,912 tiles** (96 × 72), and `fog` contains 6,912 entries. The static map alone is 41.8 KB on every snapshot; fog is another 13.8 KB. Entity state is a minority of the payload. This confirms the Phase 2A observation that the repeated static/fog data is the dominant network and serialization cost, not the number of units in this scenario.

The payload stayed below the phase's 64 KB per-seat budget, but 2.125 GB per 30-minute room is a material client-bandwidth and serialization load. No compression or protocol change was made during this verification, as required.

### 4.3 Information boundary during the soak

The harness did not add a new per-snapshot leak assertion and did not inspect every player/queue field over the 30 minutes. The server's `createTeamSnapshot` was the only game payload used; the Phase 2A deployed smoke and projection tests remain the authoritative leak evidence. This soak adds a 30-minute live-traffic observation, not a replacement for those tests.

---

## 5. CPU and memory evidence

### 5.1 What was available

The staging deployment exposes the room's application counters through the admin status endpoint:

- tick count;
- snapshot count;
- outbound bytes;
- inbound messages;
- accepted/rejected commands;
- heartbeat count;
- approximate request count;
- match start/finish and reservation status.

It does **not** expose:

- per-invocation CPU time;
- Durable Object memory use;
- isolate memory limit events;
- storage read/write timing;
- per-tick execution duration;
- `bufferedAmount` or queue depth.

The available tooling did not provide a Cloudflare dashboard/GraphQL metrics query for this staging Worker. No local `workerd` timing is substituted for deployed CPU or memory.

### 5.2 Observed execution-limit evidence

- No CPU-limit, memory-limit, isolate-reset or Durable Object failure was reported in room status or the client streams.
- No `room-state-unavailable`, reservation failure, heartbeat failure or unexpected close occurred.
- The match ran for the full 1,800-second hard cap with both clients connected.
- Client Node heap stayed between 34.7 MB and 86.9 MB over the run; this is **client harness memory**, not server memory, and is reported only to show the harness itself was stable.

**Conclusion:** there is no observed resource-limit failure, but there is **no deployed CPU or memory measurement** and therefore no evidence that 10 ms CPU headroom or a specific memory ceiling is satisfied. This remains an unresolved production gate.

---

## 6. Persistence and recovery

### 6.1 What the implementation does

- The room initializes metadata and a room snapshot before returning the create response.
- A 15-second timer writes a room snapshot and metadata during play.
- The room snapshot is chunked into Durable Object storage and validated on load.
- The finalization path writes a final snapshot and final metadata before/after releasing the reservation.

### 6.2 What was observed

- No persistence failure surfaced in room status or the client stream; the deployment does not expose a storage-operation counter, so this is an absence of observed failure, not a measured write audit.
- Heartbeats continued for the whole run: **89 heartbeats** at the 20-second interval.
- The final room status is valid: `closed: true`, phase `finished`, final result present, reservation `released`, `finishedAtMs` equal to the hard deadline.
- The final result was delivered to both seats.

### 6.3 What was not observable

- Actual number of storage writes; by code the 15-second timer implies approximately **120 periodic persistence attempts** over 30 minutes, plus initial and final writes. This is an implementation-derived estimate, not a deployed count.
- Actual persistence duration and snapshot chunk count/size. The room snapshot is not included in the admin status response.
- Whether a persistence write ever fell behind the simulation. No lag or error was observed, but there is no persistence-lag metric.
- A forced Durable Object eviction/recovery during the deployed match. The deterministic restore path is covered by `tests/phase2a-room-match.test.ts` and the Phase 1 room-snapshot tests; it was not exercised against the deployed staging object during this task. A focused rerun after the soak
  (`npx vitest run tests/phase2a-room-match.test.ts tests/phase1-room-snapshot.test.ts`) passed **13/13**, including the 40-tick deterministic continuation and room-snapshot validation tests.

**Persistence verdict:** no failure observed and the final state is valid; **recovery and persistence timing are not proven on the deployed object.** This is a conditional result, not a PASS for production recovery.

---

## 7. Reservation and lifecycle

### 7.1 Main soak

| Item | Result |
|---|---|
| Reservation id | `r16` |
| Status after close | `released` |
| Heartbeats | 89 |
| Heartbeat interval | 20,000 ms |
| Hard deadline | 2026-10-30T01:48:16.854Z |
| Room closed | `true` |
| Close reason | match finished at time limit |
| Result delivery | seat 0 `victory`, seat 1 `defeat` |
| Final socket close | both closed after result; raw client does not surface the close code |
| Stale active record | None indicated; capacity was reusable afterward |

### 7.2 Post-soak lifecycle tests

Evidence: `staging-evidence/phase2a1-failures-2026-10-30T01-50-06-771Z/results.json`.

| Test | Result | Detail |
|---|---|---|
| Reconnect | **PASS** | Seat 0 disconnected and reconnected with the same token; `hello` returned seat 0, team 0, phase `playing`; room later shut down and released. |
| Permanent disconnect | **PASS** | Seat 1 closed; seat 0 received `victory` after **30.085 s**, reason `abandoned`; room closed and released. |
| Controlled shutdown | **PASS** | Admin shutdown returned 200; client received `roomClosed` with `room-shutdown`; room closed and reservation released. |
| Hard deadline | **PASS** | Separate 10-second room; both seats received `draw`; server tick 196; closed and released. |
| Capacity boundary | **PASS** | Two rooms created (200, 200); third creation returned **503 `capacity-full`**; after releasing one, a new room returned **200**. |
| Abnormal server shutdown | **NOT REPRODUCED** | No server crash or forced eviction was induced. Client abandonment is covered; server-side crash reconciliation was not. |

A final independent capacity probe after the failure tests again returned 200, 200, 503 `capacity-full`, then 200 after release. This supports the absence of a stale active-room record, although the coordinator's raw ledger status is not a public endpoint; the create/reject/release behaviour is the observable proof.

---

## 8. Free-tier accounting

### 8.1 Measured request components

| Component | Count |
|---|---:|
| Accepted connections | 2 |
| Inbound WebSocket messages | 444 |
| Billed inbound requests (20:1) | `ceil(444/20)` = 23 |
| Lease heartbeats | 89 |
| Create/release/lifecycle allowance | 4 |
| In-room approximate requests | **118** |

This matches the server's `stats.approxRequests = 118`. It excludes admin status/health calls made by the harness.

### 8.2 Duration and budget comparison

```text
One 30-minute room at 128 MB:
  1,800 s × 0.128 GB = 230.4 GB-s

Against the Phase 2A policy (80% of published free allowances):
  duration: 230.4 / 10,400 = 2.22% of the daily admission budget
  requests: 118 / 80,000 = 0.15% of the daily admission budget
  raw free duration: 230.4 / 13,000 = 1.77%
```

The measured request count is far below the conservative worst-case model:

```text
Worst-case commands: 2 seats × 10/s × 1,800 s = 36,000
Billed: 36,000 / 20 = 1,800
+ 2 upgrades + 8 lifecycle = 1,810
× 1.1 safety margin = 1,991 requests per room
```

At 80,000 requests/day, the policy still admits only **~40 full 30-minute rooms/day**, and duration admits **~45**, with **2 active rooms**. The actual 118-request measurement must not be used to raise those limits: this run used one command every 5 seconds per seat, not the 10 Hz worst case, and it did not include snapshot acknowledgements.

Outbound traffic was **2.125 GB per room**, mostly the 17,999 snapshots per seat. Outgoing WebSocket messages are not billed as Durable Object requests on the published model, but that is not a reason to ignore client bandwidth or serialization cost. A public room directory with several concurrent rooms would multiply both bandwidth and the unmeasured CPU risk.

### 8.3 What is measured vs estimated

**Measured:** room lifetime, ticks, snapshots, payload sizes and inter-arrival gaps, inbound messages, accepted/rejected commands, heartbeats, aggregate outbound bytes, final result, close, reservation status, capacity acceptance/rejection.

**Estimated / unavailable:** Cloudflare-billed CPU time, memory, request billing, Durable Object storage operation count/timing, snapshot chunk sizes, per-tick durations, dashboard request counters. The 230.4 GB-s and 118-request figures are application estimates under the published model, not a Cloudflare invoice. No paid plan, billing activation or paid fallback exists.

---

## 9. Errors, anomalies and interruptions

| Observation | Detail |
|---|---|
| Command rejection | 1 of 444, code `no-capable-attacker`; a visible target could not be engaged by the selected force. Not a transport or authority failure. |
| Command timeouts | 0 |
| Ack anomalies | 0 |
| Command latency | p50 18 ms, p95 33 ms, p99 97 ms, max 306 ms |
| Socket closes before result | 0 |
| Simulation exceptions | 0 observed |
| Persistence errors | 0 observed |
| Heartbeat failures | 0 |
| Snapshot cadence gaps | p99 179/187 ms; longest 505 ms / 841 ms; recovered; no tick delta > 2 |
| Test interruption / restart | None; the match was not restarted |
| Deployment change during test | None |
| Production impact | None |

The 841 ms snapshot delivery gap is the largest anomaly. It did not produce a skipped two-tick interval or a disconnect, and both clients recovered; it remains a client delivery observation, not proof of a server tick overrun.

---

## 10. Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Simulation sustains intended 20 Hz for the full test, or deviations quantified | **PASS (aggregate)** | 35,995 ticks / 1,799.778 s = 19.99969 Hz; one boundary tick below the 35,996 expected. |
| No unexplained tick loss, simulation errors or state corruption | **PASS (aggregate)** | No simulation errors; both clients ended on tick 35,995; identical neutral result. Per-tick timing is not instrumented. |
| Both clients receive authorised snapshots throughout | **PASS** | 17,999 snapshots each over 1,799.9 s, 9.99984 Hz, no disconnect. |
| No cross-team information leakage | **PASS (observed/prior tests)** | Team projection only; Phase 2A leak tests and deployed smoke cover the boundary; this soak observed no opposing totals. |
| Snapshot delivery stable, no unbounded queued work | **CONDITIONAL PASS** | Stable rate and bounded gaps; queue depth not exported, so unbounded queueing cannot be positively excluded. |
| Persistence continues throughout; final state valid | **CONDITIONAL PASS** | No persistence errors; final state/result valid; write count/timing not observable. |
| No unreleased or stale reservation after cleanup | **PASS** | `released`; capacity create/reject/release probes returned 200/200/503 then 200. |
| No deployed CPU/memory/execution-limit failure | **CONDITIONAL PASS** | No failure observed; CPU/memory telemetry unavailable, so headroom is unproven. |
| Unavailable telemetry clearly identified | **PASS** | Section 5 lists unavailable CPU, memory, storage timing and per-tick data. |
| Both clients receive final result | **PASS** | Seat 0 `victory`, seat 1 `defeat`, winnerTeam 0, reason `time-limit`, tick 35,995. |
| Room closes correctly | **PASS** | `closed: true`; sockets closed after result; final status valid. |
| Global reservation released and accounting reconciles | **PASS** | Reservation `released`; 89 heartbeats; capacity reusable. |
| Single successful soak does not establish support for multiple concurrent public rooms | **ACKNOWLEDGED** | Only one room was soaked; capacity tests cover admission, not sustained multi-room load. |

**Overall:** the 30-minute soak itself **passes**. The phase is **not a production-readiness certificate**. The open gates are deployed CPU/memory measurement, per-tick instrumentation or equivalent, persistence/recovery observability, queue-depth observability, and a multi-room soak.

---

## 11. Reproduction and evidence

### 11.1 Main soak

```bash
MP_SOAK_LABEL=main-30m \
MP_ADMIN_TOKEN=<staging-admin-token> \
node tools/phase2a1-soak.mjs
```

The harness refuses to run without `MP_ADMIN_TOKEN`, creates a 1,800,000 ms room, connects two raw clients, records every 30 seconds, and does not restart an ended match.

### 11.2 Post-soak lifecycle tests

```bash
MP_ADMIN_TOKEN=<staging-admin-token> \
node tools/phase2a1-failure-tests.mjs
```

### 11.3 Raw evidence

| Path | Contents |
|---|---|
| `staging-evidence/main-30m-2026-10-30T01-18-16-334Z/summary.json` | Full soak summary, tick/snapshot/command statistics, final result. |
| `staging-evidence/main-30m-2026-10-30T01-18-16-334Z/metrics.jsonl` | 59 interval records plus 444 command records and result/socket events. |
| `staging-evidence/main-30m-2026-10-30T01-18-16-334Z/status-final.json` | Sanitized final admin status. |
| `staging-evidence/main-30m-2026-10-30T01-18-16-334Z/room.json` | Sanitized room metadata (no seat tokens). |
| `staging-evidence/main-30m-2026-10-30T01-18-16-334Z/run.log` | Timestamped harness log. |
| `staging-evidence/phase2a1-failures-2026-10-30T01-50-06-771Z/results.json` | Reconnect, abandonment, shutdown, deadline and capacity results. |
| `staging-evidence/phase2a1-failures-2026-10-30T01-50-06-771Z/events.jsonl` | Timestamped lifecycle events. |
| `tools/phase2a1-soak.mjs` | Soak harness. |
| `tools/phase2a1-failure-tests.mjs` | Post-soak lifecycle/capacity harness. |

The evidence directories were searched for `token`, `authorization` and `bearer`; no secret values are present. No files were staged or committed.

### 11.4 Measurement method and limits

- Tick count and effective rate come from the server's authoritative `stats.ticks` and `startedAtMs`/`finishedAtMs` in the final status.
- Snapshot counts, payload bytes and inter-arrival gaps come from the two independent clients' parsed WebSocket messages. Payload size is UTF-8 byte length of the raw snapshot text.
- Snapshot frequency is count divided by client wall-clock elapsed; it is not a server timer measurement.
- Command latency is time from client send to the server's accepted/rejected message.
- Per-tick duration, tick overruns, CPU, memory, storage timing and queue depth are not exposed by the deployment and are not inferred from local `workerd`.
- The harness is Node, not the browser renderer. It validates transport, authority and simulation stability, not GPU/rendering performance or browser UI integration.

---

## 12. Recommendation

Do not treat this successful soak as proof of production readiness or as a reason to raise the 2-room/daily admission limits.

The smallest next remediation task should:

1. Add non-intrusive deployed instrumentation for per-tick duration/overrun counts and persistence operation counts/durations, or use a platform metrics query that actually exposes them.
2. Measure deployed CPU/memory during a repeat soak before claiming 10 ms headroom.
3. Reduce the repeated static map/fog payload (send static map once per connection) before public rooms; the current 2.125 GB per room is dominated by 41.8 KB of map plus 13.8 KB of fog on every send.
4. Repeat with two concurrent rooms and with the kill switch and forced eviction/recovery exercised separately.
5. Keep the current conservative capacity policy and no-paid-fallback design unchanged until those measurements exist.
