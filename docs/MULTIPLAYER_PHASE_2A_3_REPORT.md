# MCA — Phase 2A.3: Transport Keepalive, Reconnect Hardening and Memory Retention Investigation

**Date:** 2026-10-30
**Scope:** isolated staging Worker only. Production traffic untouched; `MULTIPLAYER_FEATURE.enabled` remains `false`.
**Overall status:** **CONDITIONAL PASS.** Application-level keepalive is implemented, tested and proven in a deployed 30-minute soak with one completely idle seat. The ~0.9 MiB/minute Durable Object memory trend is reproducible and characterised, and every application-owned structure measured stayed bounded, but the runtime exposes no retained-heap measurement, so the trend cannot be conclusively attributed to a specific cause. No speculative memory change was made. The existing conservative limits (2 active rooms, 30-minute hard cap, 80 % daily budget) are retained.

This report distinguishes four evidence classes throughout: **[deployed]**, **[local]**, **[automated test]**, **[hypothesis]**. Nothing unmeasured is presented as proven.

---

## 1. Initial implementation and architecture findings

### 1.1 Deployed baseline

| Item | Value |
| --- | --- |
| Worker | `mca-multiplayer-staging` (`https://mca-multiplayer-staging.horsemeninteractive.workers.dev`) |
| Version tested | `610f19fa-0e1e-4535-aa68-dc38899cbffa` at 100 % (deployed `2026-10-30T04:20:45Z`, deployment record `04:20:48Z`) |
| Config | `mp-room-wrangler.jsonc`, `compatibility_date = 2026-10-01`, `compatibility_flags = ["nodejs_compat"]`, observability on |
| Policy | `maxActiveRooms = 2`, `maxDailyDurationGbSeconds = 10,400`, `maxDailyRequests = 80,000`, `maxMatchDurationMs = 1,800,000`, `staleAfterMs = 90,000` |
| Heartbeat | 20 s lease heartbeat (`DEFAULT_HEARTBEAT_MS`), 15 s persistence interval (`PERSIST_MS`) |
| Isolation | separate Worker, separate namespace, staging-only secrets; production app and `MULTIPLAYER_FEATURE` untouched |

The Phase 2A.2 baseline report and its evidence were read before changing anything. Pre-existing, unrelated working-tree changes (renderer, HUD, voice, docs) were left untouched; this phase only edited multiplayer modules, its tests and its evidence tooling (section 3).

### 1.2 How a seat was detected as inactive before this phase

- A seat is **disconnected** when its socket closes or a send throws; the DO records `disconnectedAt` and the room ticks on.
- Abandonment is evaluated in `RoomMatch.checkAbandonment`: a seat with `disconnectedAt !== null` and no reconnect after `abandonAfterMs` (staging: 30 s) is marked abandoned and the match finishes with `reason: 'abandoned'`.
- Nothing in that path requires client traffic, so a **live but silent** seat was never abandoned. The Phase 2A.1 failure was therefore not a lifecycle bug: the *transport* dropped an idle WebSocket (seat 1 disconnected at 941.9 s in the 2A.1/2A.2 runs), and the 20 s WebSocket ping in the soak harness was a test workaround, not a protocol feature.
- Keepalive must therefore exist at the **application protocol** level so any client, including a browser, can hold a seat without sending gameplay commands.

### 1.3 What the existing profiles measure

`POST /accounts/{id}/workers/workers/{worker}/versions/latest/profile` returns `cpu` or `heap` pprof. The heap profile's sample types are `alloc_objects` and `alloc_space` with a 524,288-byte sampling period: it measures **allocation over the profiling window**, not retained heap, and provides no live-object or heap-snapshot view. This is the central measurement limitation of this phase.

---

## 2. Keepalive protocol and lifecycle design

Protocol version stays `mca.v1` (`ROOM_PROTOCOL_VERSION = 1`).

| Direction | Message | Constraints |
| --- | --- | --- |
| client → server | `{"type":"keepalive","v":1}` | dedicated type; only `type` and `v` allowed; ≤ 256 bytes (`MAX_KEEPALIVE_MESSAGE_BYTES`); ≤ 1 per seat per 5 s (`KEEPALIVE_MIN_INTERVAL_MS`); also subject to the existing 20 msg/s per-seat cap |
| server → client | `{"type":"keepaliveAck","v":1}` | carries only the protocol version; no tick, no diagnostics, no game state |

Lifecycle guarantees:

- **Not a command.** `RoomMatch.receive` handles `keepalive` *before* the `waiting`-phase check and before `CommandGate`. No keepalive ever enters the gate, the command queue or a tick.
- **No game or hidden state.** Neither message carries a seat, team, player, entity or coordinate.
- **Bounded state.** Each seat stores `lastKeepaliveAt` and `lastAckAt` only. No history, no per-heartbeat recording beyond three monotonic counters.
- **No persistence write per keepalive.** The only persistence in the room is the pre-existing 15 s snapshot cycle and the pre-existing meta write after a successful 20 s lease heartbeat.
- **Activity semantics.** A keepalive becomes seat activity only after its acknowledgement is actually queued (`sendJson` returned success). An undeliverable ack is a control-send failure: the seat is dropped (`1011 send-failed`) and `lastActivityAt` is not advanced, so a half-open socket cannot keep a match alive.
- **Deadline unchanged.** `matchDeadlineAt` is set from the reservation; a keepalive never touches it. Rejected after `finished`/`closed` with `room-closed`, and after shutdown with `seat-inactive`.
- **Abandonment unchanged.** A keepalive implies a live socket; abandonment still requires a lost socket plus the 30 s grace.
- **Client cadence.** 20 s, well inside common NAT idle windows. The development client also tracks ack gaps and closes the socket with code `4001 keepalive-timeout` after 45 s without an ack, so the UI cannot show a half-open connection as healthy. That 45 s guard is not yet exercised in a browser and is not in the deployed dev page: version `610f19fa` was built before this one-file addition (the 20 s keepalive it does contain is what the soak used). It ships with the next staging rebuild; no production code is affected.

Accepts-while-waiting is deliberate: a seat that arrives first can stay warm until the second seat connects.

---

## 3. Files changed and reasons

| File | Change | Reason |
| --- | --- | --- |
| `src/multiplayer/protocol.ts` | `ClientKeepaliveMessage`, `KeepaliveAckMessage`, `KEEPALIVE_INTERVAL_MS` (20 s), `KEEPALIVE_MIN_INTERVAL_MS` (5 s), `MAX_KEEPALIVE_MESSAGE_BYTES` (256), per-type field allowlist, `keepaliveMs` in `hello` | Versioned, allowlisted transport message; no reuse of gameplay commands |
| `src/multiplayer/roomMatch.ts` | `handleKeepalive`; seat fields `lastKeepaliveAt`/`lastAckAt`; ack only after a successful send; activity not advanced on failure; census counts in `status()` | Server-side aliveness without gate/tick/persistence side effects |
| `src/multiplayer/roomDiagnostics.ts` | `keepalive.{received,acked,rateLimited}` plus bounded census counters (`entities`, `units`, `buildings`, `projectiles`, `contacts`, `charted`, `events`, `pendingCommands`, `fogTiles`, per-seat buffered bytes) | Aggregate, bounded evidence for the memory investigation; never exposed to normal clients |
| `src/multiplayer/devRoomClient.js` | 20 s automatic keepalive; ack tracking; 45 s ack-gap close with code 4001 | Development client must hold an idle seat and report a dead transport honestly |
| `tests/phase2a3-keepalive.test.ts` | 10 focused tests (section 4) | Transport, authority and lifecycle coverage |
| `tools/phase2a1-soak.mjs` | `MP_IDLE_SEAT=0|1` mode (idle seat sends only keepalives); keepalive sent/acked counters in samples and summary; payload breakdown in state samples | Reproduce the exact 2A.1/2A.2 failure condition while measuring payload composition |
| `tools/phase2a3-memory-probe.mjs`, `tools/phase2a3-idle-memory.mjs` | local reference probes (workerd) for heap/RSS behaviour | Local reference only; never presented as deployed memory evidence |
| `tools/phase2a3-profile-schedule.sh` | scheduled deployed heap/CPU profile capture | Documented, reproducible profiling attempt (partial success, section 5.2) |
| `MULTIPLAYER_PHASE_2A_3_REPORT.md`, `staging-evidence/phase2a3-*` | report and raw evidence | Deliverables |

No simulation, fog, AI, victory, save, renderer, HUD or single-player module was modified by this phase. No dependency was added. Nothing was staged or committed.

---

## 4. Tests added and results

`tests/phase2a3-keepalive.test.ts` — **10 / 10 pass**:

1. dedicated keepalive parses; command or extra fields (`command`, `seat`) rejected `unknown-field`; version 2 rejected; > 4,096-byte frame rejected `payload-too-large`; 256-byte budget accepted.
2. idle-seat ack does not change the tick, the pending queue or `commandsAccepted`; ack object contains exactly `{type,v}`.
3. keepalive accepted while waiting for the second seat; phase unchanged.
4. rate limit: a keepalive inside 5 s is rejected `keepalive-rate-limited` and does **not** update `lastAckAt`; the next one after the interval is acked.
5. malformed / oversized keepalives are rejected and never acknowledged.
6. one seat's keepalives do not delay abandonment of the other (abandoned at 30 s, `winnerTeam: 0`).
7. keepalives never move `matchDeadlineAt`; after the deadline the kill is `time-limit`/`draw` and post-finish keepalives get `seat-inactive`/`room-closed`, no ack.
8. 100 keepalives keep diagnostics below 8 KB and the seat reconnects cleanly; a duplicate socket for a connected seat is rejected `seat-occupied` (no duplicate seat ownership).
9. **missing acknowledgement:** ack send throws → no activity, `lastAckAt` null, `acked: 0`, `controlSend: 1`, seat dropped `1011 send-failed`.
10. **controlled shutdown:** ack works, then `fail('operator-shutdown')` emits `roomClosed`; a later keepalive is rejected and never acked.

Existing coverage reused: `tests/phase2a-room-match.test.ts` (reconnect, duplicate seat, abandonment, shutdown, result delivery), `tests/phase2a-capacity.test.ts` (capacity boundary), `tests/phase2a2-diagnostics.test.ts` (bounded diagnostics).

Full verification, all run after the final source edit:

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | pass (exit 0) |
| Full suite | `npx vitest run` | **85 files / 866 tests passed**, 133 s |
| Production build | `npx vite build` | pass (exit 0; existing >500 kB chunk warning only) |
| Staging Worker bundle | `npx vite build --config mp-room-vite.config.ts` | pass to `dist-mp-room-check` (453.8 kB, 113.9 kB gzip) |

The Worker bundle's default `outDir` (`dist-mp-room`) could not be emptied because an **earlier local `wrangler dev` process still holds the file** (`EPERM` on `dist-mp-room/roomWorker.js`). The same build succeeds to an alternate `outDir`, so this is a local file lock, not a source failure; no deployment was made from this build.

---

## 5. Memory investigation

### 5.1 Deployed measurements (30-minute soak, `610f19fa`)

Cloudflare `durableObjectsPeriodicGroups`, per minute, scope = this Durable Object's isolate **[deployed]**. Values are MiB (1 MiB = 1,048,576 B), the unit the collector prints; the platform reports bytes.

| Elapsed | Minute | Isolate memory |
| --- | --- | --- |
| start | 04:56:35 | 21.15 MiB |
| **minute 5** | 05:01:35 | **25.86 MiB** |
| **minute 15** | 05:11:35 | **35.05 MiB** |
| **minute 25** | 05:21:35 | **43.99 MiB** |
| last sampled | 05:25:35 | 47.61 MiB (peak) |

- Linear fit over 30 minutes: **+0.910 MiB/min** (intercept 21.36 MiB). Per-minute deltas: mean 0.913, p50 0.84, min 0.59, max 1.34 MiB.
- No 30-minute row contains a downward jump: the slope is monotonic at one-minute granularity.
- **Memory resets with the isolate.** In the immediately preceding run the series fell from 49.4 MiB to **3.93 MiB** at 04:51:27 with zero active sockets — a fresh isolate reporting its own footprint. Growth is per-isolate lifetime, not stored room data.
- Reproducibility across five runs: **0.90–0.93 MiB/min** in every two-seat snapshotting room (≈22 → 48.6/49.4 MiB over 30 min), regardless of command volume (0 vs ~350 commands).
- Control: a room with **one socket and ~3 outbound messages/min** (no tick loop, no snapshots) still grew **0.43 MiB/min** from a 4.9 MiB baseline.

### 5.2 Allocation and CPU profiles (what they do and do not show)

Four deployed heap (allocation) profiles, each a 20 s sampling window **[deployed]**:

| Elapsed | `alloc_space` | `alloc_objects` |
| --- | --- | --- |
| 6 m 22 s | 419.5 MiB | 12.76 M |
| 7 m 27 s | 399.0 MiB | 12.24 M |
| 24 m 32 s | 414.6 MiB | 12.61 M |
| 26 m 22 s | 438.4 MiB | 13.31 M |

- The range is 399–438 MiB (±5 %) with **no upward trend** across 20 minutes: the room does not start walking a growing live object graph as the match ages. Allocation per unit of work is flat.
- Implied allocation: ~1,200–1,315 MiB/min, ≈ **36 GiB** over the match, against **26.5 MiB** of committed growth (47.61 − 21.15): **0.072 %** of allocated bytes stayed resident.
- CPU profile at elapsed 10 m: 414 ms CPU in 19.9998 s (2.07 %), matching the GraphQL aggregate (2.15 %). Self time: `createTeamSnapshot` 50 %, `sendSnapshotObject` 18 %, `(idle)` 6 %, **garbage collector 3.6 %**, `tick` 2.2 %, `sendText` 3.4 %.
- Profiling availability was intermittent: one request returned `10397` ("runtime could not start profiling"), and the minute-16 request returned `10393` ("no recent executions were found"). Both failed bodies and the successful profiles are kept in the evidence directory; samples are labelled by **actual elapsed time**, not by the requested minute.

### 5.3 Application-owned structures — measured, not assumed

From the deployed room's own census over 30 minutes (61 samples from the 04:20 run on the same version `610f19fa`) and this soak's payload breakdown **[deployed]**:

| Structure | Observed | Bounded? |
| --- | --- | --- |
| entities | 0–25 | yes (scenario/history) |
| units / buildings | ≤ 18 / ≤ 7 | yes |
| projectiles | ≤ 1 | yes |
| contacts | ≤ 9 | yes |
| charted tiles | ≤ 8 | yes |
| `state.events` | grows to **240 then stays** (cap in `Game.emit`) | yes |
| pending commands | 0 | yes |
| fog tiles | 13,824 constant | yes |
| WebSocket `bufferedAmount` | 0, max 0, both seats, entire run | yes |
| persisted snapshot | 244–262 KB, replaced by generation | yes |
| diagnostics | counters + fixed histograms, < 8 KB serialised | yes |
| payload bytes / seat | 58,849 → 58,902 (idle seat), 58,855 → 62,659 (active seat, because it built units) | yes |

Code audit of long-lived collections: `Game.byId` is bounded by entity count; `chartedIndex` by map tiles; `visible` sets are rebuilt per tick; `gridBrownout` is rebuilt per tick; the AI's only instance collection (`claimed`) holds entity ids; `RoomMatch` has no long-lived `Map`/`Set`; the DO keeps no per-message arrays. Snapshot payload composition is stable: **map 41,797 B + fog 13,825 B = 55,622 B of a ~59 KB payload (94.5 %)**, dynamic team state ≈ 3.3 KB.

### 5.4 Conclusion and remaining hypotheses

The trend is **real, deployed and reproducible**, but it is **not explained by any application-owned structure**: nothing that the room owns grows with ticks, snapshots, reconnects, persistence cycles or match duration, and the payload itself does not grow.

Strongest remaining hypotheses, in order **[hypothesis]**:

1. **Runtime heap commitment / GC slack in workerd.** 35.9 GiB allocated against 26.5 MiB retained (0.072 %), GC visible in the profile, and growth that scales with work (0.43 MiB/min with almost no messages, 0.91 MiB/min with 1,218 outbound messages/min) fit a committed-heap/allocator pattern rather than a leak.
2. **Per-isolate runtime bookkeeping for long-lived WebSockets and per-message send paths** (a few hundred bytes per outbound message would account for the difference between the idle and active slopes), which is platform code, not project code.
3. **Cloudflare memory accounting semantics** — the periodic metric's p50/p90/p99/p999 are all equal to the minute maximum for this account, so the metric cannot distinguish instantaneous peaks from a resident baseline.

What would settle it (next measurement, not done here): a retained-heap snapshot (unavailable on this plan/tooling), or a >60-minute room to see whether the slope plateaus — deliberately not run, because it exceeds the current product cap and the daily duration budget.

Because no cause was established, **no code was changed for memory**; memory limits, match duration and diagnostics were not weakened.

### 5.5 Safety assessment of the current limits

At 47.6 MiB peak after 30 minutes against the 128 MB allocation billed and enforced per object, the 30-minute cap uses ~39 % of the allocation. Extrapolating the measured slope linearly would reach 128 MB in roughly two hours **[hypothesis, not a licence to extend]**. The 2-room cap and 30-minute hard deadline are therefore retained; neither longer matches nor more concurrent rooms are justified by this evidence.

---

## 6. Full deployed 30-minute soak

Configuration: same as 2A.1/2A.2 — 1v1, `matchDurationMs = 1,800,000`, 20 Hz tick, 10 Hz snapshots, seat 0 sending normal commands every 5 s plus production every 180 s, **seat 1 sending no gameplay commands at all**, both seats keepaliving every 20 s. Room `phase2a3-soak-30m-mvui2g89`, start `2026-10-30T04:56:35.737Z`, end `05:26:35.720Z` **[deployed]**.

| Metric | Result |
| --- | --- |
| Wall elapsed | 1,799,983 ms (30.00 min) |
| Server ticks | **35,996 actual / 35,996 expected**, effective **20.000 Hz** |
| Tick errors | 0; no state transition anomalies |
| Snapshots per seat | **18,000 each** (10.000 Hz); tick deltas strictly 2 ticks |
| Snapshot gaps | p50 100 ms, p95 102 ms, p99 170 ms, max **414 ms** (seat 0) / **496 ms** (seat 1) |
| Snapshot size | seat 0 p50 61,096 B / p99 62,660 / max 63,047; seat 1 p50 58,901 / max 58,907 |
| Outbound | 2,159,214,532 UTF-16 code units total (≈1.10 GB seat 0, 1.06 GB seat 1) |
| Keepalives | **sent/acked 89/89 seat 0, 89/89 seat 1**; server received 178, acked 178, rate-limited 0 |
| Commands | 358 sent, **358 accepted**, 0 rejected, 0 timeouts (348 `move`, 10 `produce`); ack latency p50 13 ms, p95 21, p99 52, max 244 |
| Socket closes | both `1000 match-finished`, 05:26:35.53 |
| Result delivery | seat 0 **victory**, seat 1 **defeat**, `reason: time-limit`, tick 35,996, at 1,799,788 ms — both received |
| Reservation | `r57`, status **released**; heartbeat 89 success / 0 failure; release 1 success / 0 failure |
| Room | `closed: true`; the freed capacity slot was immediately reusable (section 8) |
| Client errors | none |

The idle seat stayed connected for the entire match with keepalives as its only traffic: the 2A.1/2A.2 failure mode is resolved by the protocol change, not by more frequent pings.

---

## 7. CPU, persistence and network observations

**CPU [deployed]:** 38,708 ms over 1,800 s = **2.15 % of wall time**, mean 1,290 ms/min; 0 `exceededCpuErrors`, 0 memory errors, 0 fatal errors. This is aggregate per-minute data plus one 20 s profile; it does **not** prove per-tick CPU headroom.

**Tick execution duration — unavailable.** Room diagnostics report `durationsAvailable: false` and all tick/serialisation percentiles are zero: deployed Workers freeze timer APIs during CPU-only work, so the room can count ticks but cannot time them. The 10 ms per-tick target therefore **remains unproven**, exactly as in 2A.2. Aggregate evidence is consistent with a low-cost tick (profile: `tick` 2.2 % of 2.07 % CPU ≈ 0.45 ms/s of wall time), but it is not per-tick proof.

**Persistence [deployed]:** 121 snapshot cycles, 211 meta cycles, 833 rows read, 1,764 rows written, 0 failures, 0 cycles behind; chunks written 726, snapshot 262,129 B max, 31,308,030 B written; read bytes not reported by SQLite backend. Cycle and operation durations are frozen (same timer limitation). Meta writes occur after each successful 20 s lease heartbeat — pre-existing lifecycle behaviour, unrelated to keepalives, and a candidate for a later, separately scoped reduction.

**Network accounting [deployed]:** 536 inbound WebSocket messages = **358 commands + 178 keepalives exactly**; 36,534 outbound = 36,000 snapshots + 178 acks + 358 command acks + hello/result/closed. No unexplained traffic, no slow-client event, no send failure, no serialisation failure.

**Payload repetition:** map + fog are byte-identical for the whole match and are 94.5 % of the baseline ~59 KB payload (88.8 % of the largest active-seat payload); dynamic team state is ~3.3 KB. Quantified, but deliberately not optimised in this phase.

---

## 8. Lifecycle, cleanup and capacity checks

Post-soak harness `tools/phase2a1-failure-tests.mjs` against the same staging Worker **[deployed]**, evidence `staging-evidence/phase2a1-failures-2026-10-30T05-27-50-173Z/`:

| Test | Result |
| --- | --- |
| Reconnect after transport loss | pass — `hello` seat 0 team 0 `playing`, room closed, reservation released |
| Permanent disconnect / abandonment | pass — `reason: abandoned`, `winnerTeam: 0`, observed after 30,120 ms, released |
| Controlled shutdown | pass — HTTP 200, client code `room-shutdown`, closed, released |
| Hard deadline (separate 10 s policy) | pass — 196 ticks in 9,826 ms, `draw`/`draw`, closed, released |
| Capacity boundary (two-room policy) | pass — statuses `[200, 200, 503, 200]`, rejection `capacity-full`, first room released, slot reusable |

Cleanup is immediate on normal completion, abandonment and operator shutdown. Stale-lease reconciliation (90 s) was not force-triggered; its unit coverage from Phase 1 remains unchanged.

---

## 9. Free-tier and capacity implications

Official Workers Free limits (Cloudflare Durable Objects pricing, read 2026-10-30): **100,000 requests/day** (includes WebSocket messages and alarm invocations, incoming WebSocket messages billed at **20:1**; outgoing messages free), **13,000 GB-s duration/day**, SQLite **5 M rows read/day**, **100,000 rows written/day**, 5 GB storage; exceeding a limit fails that operation type, daily limits reset 00:00 UTC; duration is billed at the full **128 MB** allocation per object, and accepting a WebSocket incurs duration for as long as it is connected.

Measured per 30-minute two-seat room **[deployed]**:

- Duration: 230.4 GB-s = **1.77 %** of the free daily allowance; the 80 % policy budget allows **45** such rooms/day (theoretical maximum 56).
- Requests: 2 upgrades + 536/20 ≈ 27 message-request equivalents + ~89 heartbeats + ~122 lifecycle/status + connectivity checks ≈ **240 request-equivalents = 0.24 %** of the daily allowance.
- Rows: 1,764 written (**1.8 %**), 833 read (0.02 %) of the daily allowances.
- Memory: 47.6 MiB peak, billed at the 128 MB allocation regardless.
- Policy request model (10 Hz/seat command cap, `requestsPerIncomingMessage = 20`) yields 80,000 / (1,800 + 2 + 8) / 1.1 ≈ **40 rooms/day**, so duration remains the binding constraint at ~45 rooms/day with 2 concurrent rooms.

This is one successful soak, not proof of multi-room production behaviour: two concurrent rooms were only exercised at the reservation boundary, not for 30 minutes each. No admission limit was raised, no billing was activated and no paid fallback exists.

---

## 10. Remaining risks and unresolved questions

1. **Memory retention is unattributed.** Application structures are bounded and payload size is flat, but the platform exposes no retained-heap metric. A >30-minute room is untested and would extrapolate beyond the current cap.
2. **Per-tick CPU headroom is still unproven.** Deployed timers are frozen; only aggregate CPU and one 20 s profile exist.
3. **Snapshot cost is dominated by static data.** 55.6 KB of every ~59 KB payload is the map + fog, repeated 20 times per second across seats — the largest identifiable inefficiency, and the next scoped task.
4. **Profiling API is unreliable** (503 `10397`, 404 `10393`). Deployed profile coverage in future phases should assume retries and record failures rather than treat a missing profile as a pass.
5. **Meta persistence per heartbeat** does ~90 extra writes per match; harmless at this scale but worth a separate, measured change.
6. **Single room only.** No deployed evidence yet for 2 concurrent 30-minute rooms or for 4-seat rooms.
7. **Client ack-timeout is unit-untested and not deployed.** It is browser-only code; the server-side missing-ack path is tested (section 4, test 9).

---

## 11. Reproduction

```bash
# 1. Deployed version and 100% split
npx wrangler versions list   --config mp-room-wrangler.jsonc
npx wrangler deployments status --config mp-room-wrangler.jsonc

# 2. Build and typecheck
npx tsc --noEmit
npx vitest run                                   # 85 files / 866 tests
npx vite build
npx vite build --config mp-room-vite.config.ts --outDir dist-mp-room-check

# 3. 30-minute two-seat soak, seat 1 idle (keepalives only)
MP_SOAK_MS=1800000 MP_SOAK_LABEL=phase2a3-soak-30m MP_IDLE_SEAT=1 \
  node tools/phase2a1-soak.mjs

# 4. Platform metrics for the exact window
CLOUDFLARE_API_TOKEN=... MP_ACCOUNT_ID=... \
  MP_ROOM_ID=phase2a3-soak-30m-mvui2g89 \
  MP_START=2026-10-30T04:56:00Z MP_END=2026-10-30T05:29:00Z \
  MP_OUT_DIR=staging-evidence/phase2a3-soak \
  node tools/phase2a2-metrics.mjs

# 5. Deployed profiles (CPU/heap; retry on 10397/10393)
bash tools/phase2a3-profile-schedule.sh    # needs MP_ACTOR_ID, MP_NAMESPACE_ID, MP_ACCOUNT_ID, MP_SOAK_START_EPOCH
python tools/phase2a2-heap-summary.py staging-evidence/phase2a3-soak/heap-m9.pprof
python tools/phase2a2-pprof-summary.py staging-evidence/phase2a3-soak/cpu-m10.pprof

# 6. Post-soak lifecycle and capacity tests (reads .dev/mp-admin-token; never printed)
node tools/phase2a1-failure-tests.mjs
```

---

## 12. Evidence index (secrets redacted)

| Path | Contents |
| --- | --- |
| `staging-evidence/phase2a3-soak-30m-2026-10-30T04-56-35-106Z/` | soak `metrics.jsonl` (30 s samples), `summary.json`, `status-final.json`, `room.json`, `run.log` |
| `staging-evidence/phase2a3-soak/` | `soak.stdout.log`, `platform-metrics.json` (GraphQL, per-minute), `cpu-m10.pprof` + summary, `heap-m6` / `heap-m9` / `heap-m24` / `heap-m26` pprof + summaries, failed attempts `heap-m1.pprof` (503/10397) and `heap-m16.pprof` (404/10393), `README.md` (file-by-file semantics), `graphql-accounts.json` (token scope probe, no token) |
| `staging-evidence/phase2a1-failures-2026-10-30T05-27-50-173Z/` | reconnect / abandonment / shutdown / deadline / capacity results |
| `staging-evidence/phase2a3-main-30m-2026-10-30T04-20-58-814Z/` | previous run: census series, heap m5/m15/m25, platform metrics (comparison baseline) |
| `staging-evidence/phase2a3-idle/`, `observability/baseline-platform/` | idle-room and earlier baseline memory series (controls) |
| `staging-evidence/phase2a3-local/local-keepalive-2026-10-30T04-15-23-357Z/` | **local** workerd reference: 70 s, 19.99 Hz, 6/6 keepalives, reservation released |
| `staging-evidence/phase2a3-tests.log`, `phase2a3-build.log`, `phase2a3-worker-build-check.log` | full suite, app build, successful Worker bundle build |
| `staging-evidence/phase2a3-worker-build.log` | failed default-`outDir` Worker build: local `EPERM` from a stale `wrangler dev` holding `dist-mp-room/roomWorker.js` (same source builds successfully to an alternate `outDir`) |

No token, session credential or account secret is present in any report or log; the account tag is only used in the local metrics command.

---

## 13. Acceptance gates

| Gate | Verdict | Basis |
| --- | --- | --- |
| Application keepalive works for an entirely idle seat | **PASS** | Deployed soak: seat 1, 89/89 acks, zero commands, connected 30 min |
| 30-minute deployed soak completes with both seats connected | **PASS** | 1,799,983 ms, 35,996/35,996 ticks, both sockets closed only at `match-finished` |
| Both seats receive the final result | **PASS** | victory/defeat, `time-limit`, tick 35,996, delivered before close |
| Reservation release and room cleanup | **PASS** | `r57` released, 89/89 heartbeats, room closed, capacity slot reusable |
| No protocol, authority, projection or determinism regression | **PASS** | 866/866 tests, 0 rejected commands, keepalive outside the gate, no new client-authority field |
| Memory growth explained and, if application-caused, corrected | **CONDITIONAL** | Reproducible +0.91 MiB/min; all application structures bounded; retained heap unmeasurable; no cause established, so no speculative change |
| Per-tick CPU headroom (10 ms) | **UNPROVEN (unchanged)** | Deployed timers frozen; aggregate CPU 2.15 % |
| Free-tier safety | **PASS WITH MARGIN, SINGLE ROOM** | 230.4 GB-s and ~240 request-equivalents per room; 2-room cap and 30-min cap retained |

**Overall: CONDITIONAL PASS** under the phase's own definition — keepalive proven, soak and lifecycle proven, memory retention unattributed because of platform measurement limits, conservative capacity limits retained.

---

## 14. Recommended next phase

**Phase 2A.4 — snapshot delivery redesign (static map/fog once per seat, delta or keyframe snapshots thereafter), measured against this baseline.**

Rationale from this evidence: 94.5 % of the baseline 59 KB, 10 Hz, two-seat payload is byte-identical terrain and fog (55.6 KB), and snapshot projection/serialisation is 68 % of measured CPU (`createTeamSnapshot` 50 %, `sendSnapshotObject` 18 %). Reducing that cost lowers CPU, outbound bytes and per-minute memory churn at once — the only lever this evidence supports that improves all measured budgets simultaneously. It must be a separate phase with its own soak, so transport and memory evidence stay interpretable.

Do not start lobby, accounts or discovery work until (a) snapshot cost is reduced and re-measured, and (b) either a retained-heap measurement or a longer controlled duration run resolves the memory trend well enough to justify more than two concurrent 30-minute rooms.
