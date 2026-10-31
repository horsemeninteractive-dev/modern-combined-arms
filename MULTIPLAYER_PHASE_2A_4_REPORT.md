# MCA — Phase 2A.4: Static Map/Fog Initialisation and Delta Snapshot Protocol

**Overall status: PASS, with two retained measurement limitations.** The staging room no longer repeats the ~59 KB full snapshot at 10 Hz. Each seat receives the 41,797-byte static map once, then ordered deltas that change only what that team can see. A 30-minute deployed 1v1 soak completed with two connected seats, 35,994 authoritative ticks, 16.69 MiB of total outbound traffic versus 2.01 GiB in the Phase 2A.3 baseline, and a released global reservation. Full tests, typecheck, production build and the deployed lifecycle/security checks pass. Per-tick CPU headroom remains unproven because deployed Workers freeze timing APIs, and retained-heap attribution remains platform-limited.

- Final staging Worker: `mca-multiplayer-staging`
- Final deployed version: `a4a5d9cd-87d6-4078-8ed7-3f677d87c03b`
- Final soak room: `phase2a4-main6-mvupcv34`
- Soak window: `2026-10-30T08:20:39.141Z` – `2026-10-30T08:50:38.981Z`
- Production multiplayer flag: **disabled** (`MULTIPLAYER_FEATURE.enabled === false`)
- No production deployment, no plan change, no paid service, no staged or committed files.

## 1. What changed

The Phase 2A.3 room sent a complete `TeamSnapshot` to each seat every 100 ms. That payload was ~58.9 KB, of which 41,797 B was immutable map data and 13,825 B was the full fog array. Phase 2A.4 replaces the repeated full projection with a versioned `sync`/`delta` stream:

1. A seat connects and receives one `sync` containing the immutable map, complete team fog and complete dynamic state.
2. Every 100 ms the room projects the team's current dynamic state once and compares it with that seat's last acknowledged baseline.
3. Only changed entities, removals, projectiles, fog tiles, contacts, charted structures, events, player rows and result changes are serialised.
4. A periodic checkpoint every 3,000 deltas prevents an unbounded delta chain. It is still a full *dynamic* checkpoint, but **omits the map** because the seat already holds it.
5. Reconnect and explicit resync create a new epoch and deliberately include the map again, because the client may have no baseline.
6. A client that detects a gap, epoch mismatch or invalid checkpoint requests a full resync rather than guessing.

The authoritative simulation, `CommandGate`, team projection and neutral-result logic are unchanged. The delta stream is built from the existing projection; there is no second simulation or client-authoritative state path.

## 2. Protocol contract (wire version 2)

### 2.1 Client to server

| Type | Shape | Purpose |
| --- | --- | --- |
| `command` | `{ "type": "command", "v": 2, "command": { ... } }` | One gameplay command body. It carries no seat, team, player or owner authority. |
| `keepalive` | `{ "type": "keepalive", "v": 2 }` | Transport aliveness only; never enters `CommandGate` or the tick queue. |
| `resync` | `{ "type": "resync", "v": 2 }` | Requests a new full sync generation after a detected gap. |

The server resolves the acting seat from the authenticated socket/seat table before it constructs the gate envelope. Unknown fields are rejected, not ignored. The existing `mca.v2` WebSocket subprotocol and `mca.token.<seat-token>` credential are unchanged.

### 2.2 Server to client

| Type | Purpose |
| --- | --- |
| `hello` | Confirms seat, player, team, phase, tick rate, snapshot rate, keepalive interval and hard deadline. |
| `sync` | Starts an epoch. Carries complete dynamic state; carries `state.map` only when the recipient needs a new static baseline. |
| `delta` | Ordered change against an exact `base` sequence. |
| `keepaliveAck` | Acknowledges a keepalive without exposing the server tick or diagnostics. |
| `commandAccepted` / `commandRejected` | Stable command result with explicit rejection code. |
| `result` | Team-relative final outcome plus the projected result. |
| `error` | Structured non-sensitive error. |
| `roomClosed` | Controlled shutdown or match-expiry notification. |

A `sync` has `epoch`, `seq`, `tick`, `team`, `roomId`, `checkpoint` and `state`. A `delta` has `epoch`, `seq`, `base`, `tick`, `team`, `roomId` and `changes`. `seq` is per seat and monotonic; `base` must equal the client's last applied sequence. A delta with another epoch, a duplicate/stale sequence, a sequence gap or a base mismatch is rejected in full and forces a resync.

### 2.3 Delta fields

`changes` is an allowlisted object. Every field is optional and present only when that recipient's view changed:

- `fog: { set: [[tileIndex, level], ...] }` — changed tiles only; values `0` unexplored, `1` explored, `2` visible.
- `entities: { upsert: ProjectedEntity[], remove: number[] }` — complete projected records, including a `remembered` replacement when visibility is lost.
- `projectiles: { upsert: ProjectedProjectile[], remove: number[] }`.
- `contacts`, `charted`, `players.upsert`, `events`, `result` — only when the projected value differs.

The immutable map is never a delta field. A delta never contains `state`, `scenario`, `ai`, an opposing player row, opposing fog/contacts or a hidden entity id. A checkpoint sync omits `map`; an initial, reconnect or resync sync includes it.

### 2.4 Bounds and recovery

| Bound | Value | Behaviour |
| --- | --- | --- |
| Client text frame | 4,096 B | Rejected with `payload-too-large`. |
| Keepalive frame | 256 B | Rejected above the limit; one accepted per 5 s per seat. |
| Resync frame | 128 B | Rate-limited to one per 5 s per seat. |
| Client messages | 20/s per seat | Excess closes the seat with `1008`. |
| Full sync | 256 KB | Serialisation failure closes the seat rather than sending an unbounded frame. |
| Delta chain | 3,000 updates | Checkpoint sync; map omitted. |
| Snapshot cadence | 10 Hz | Fixed by the authoritative tick, not network timing. |
| Tick cadence | 20 Hz | Fixed step; network arrival never changes step size. |

Reconnect keeps the same seat token and creates a new epoch with a full map-bearing sync. A stale socket's close cannot clear a newer replacement socket. A map-less checkpoint received without a verified baseline is rejected as `not-ready` and the client requests a resync.

## 3. Files changed

| File | Change | Reason |
| --- | --- | --- |
| `src/multiplayer/protocol.ts` | Added `SyncState` with optional `map`, sync/delta contracts, checkpoint semantics, bounds and resync/keepalive limits. | One versioned transport contract, no implicit full-state message. |
| `src/multiplayer/projection.ts` | Added `projectMap`; `createTeamState` can omit full fog for the delta path; `createTeamSnapshot` remains the full sync form. | Build dynamic state once per team and avoid materialising 13,824 fog numbers every 100 ms. |
| `src/multiplayer/teamDelta.ts` | New per-seat `SyncBaseline` and `buildDelta`; compares projected entities, projectiles, players, fog, contacts, charted, events and result. | Send only changes, with a private baseline per seat. |
| `src/multiplayer/snapshotAssembler.ts` | New client reducer with field allowlists, bounds, epoch/sequence/base validation, atomic apply and retained-map support. | A client can prove it reconstructed the same team view; no renderer visibility assumption. |
| `src/multiplayer/roomMatch.ts` | Per-seat epoch/seq/chain/baseline; sync on connect/reconnect, checkpoint after 3,000 deltas, resync handling, map only when needed. | Wire the protocol into the existing authoritative room without changing simulation authority. |
| `src/multiplayer/roomDiagnostics.ts` | Sync/delta counts and byte distributions; aggregate only. | Measure protocol cost without per-message logs or authoritative-state fields. |
| `src/multiplayer/roomWorker.ts` | Staging health/build marker and served assembler source. | Keep the development probe on the same reducer as the tests and soak harness. |
| `src/multiplayer/devRoomClient.js` | Applies sync/delta, requests resync on a rejected update, and logs reconstruction status. | Development-only end-to-end transport probe. |
| `mp-room-vite.config.ts` | Serves the tested `snapshotAssembler.ts` as browser ESM for the dev probe. | Avoid a second client reducer. |
| `tools/phase2a1-soak.mjs` | Sync/delta accounting, per-field byte accounting, automatic seat reconnection, map-once accounting. | Reconstruct the wire stream and survive a short transport loss without restarting the match. |
| `tools/phase2a-deployed-smoke.mjs` | Delta assertions: no map/full state in a delta, resync epoch, reconnect epoch. | Deployed protocol/security smoke. |
| `tests/phase2a4-delta.test.ts` | 15 tests for delta encoding, fog, removals, validation and reconstruction. | Unit-level protocol correctness. |
| `tests/phase2a4-room-sync.test.ts` | 9 room-level tests for map-once, exact reconstruction, leakage, reconnect, resync, checkpoint, sequence wrap, final result. | Integration-level room behaviour. |
| `tests/phase2a4-helpers.ts` | Shared assembler/sync/delta/canonical-state helpers. | Deterministic comparison of reconstructed and authoritative team views. |

No production entry point imports these modules. `src/multiplayer/featureFlag.ts` remains `enabled: false`; the staging Worker is a separate deployment.

## 4. Projection and security boundaries

- `CommandGate` still receives a server-built envelope, never a client-supplied seat/team/player identity. The network adapter only supplies the command body; the seat table supplies authority.
- `createTeamState` includes own/allied entities, currently visible enemies, remembered structures without live hp/queue/state, that team's fog/contacts/charted, that team's player rows, visible projectiles and team-filtered events.
- Opposing resources, queues, fog, contacts, AI state, the original scenario and hidden enemy coordinates/ids are absent. A hidden enemy projectile is omitted unless its shooter or impact point is visible; a hidden shooter id is replaced with `0` on a visible projectile.
- Remembered structures carry identity, position and facing only. A remembered entity must have `hp`, `maxHp`, `state` and `buildProgress` null and no queue; the assembler enforces this.
- The assembler validates the entire sync/delta before mutating its baseline. Any unknown field, wrong version, wrong room/team, bad grid/fog length, duplicate id, malformed queue, out-of-bounds position, unknown delta field or illegal result shape rejects the whole message.
- A checkpoint cannot smuggle the map back in; a delta cannot carry `map` or `state`. This is enforced both by the server builder and the assembler allowlist.
- Error and acknowledgement messages expose only a stable code and a short human message. They do not echo hidden entity ids, coordinates, opposing resources or diagnostics.

## 5. Tests

### 5.1 Local automated checks

| Check | Result |
| --- | --- |
| Full suite | **PASS** — 87 files, 891 tests |
| Focused Phase 2A.4 suite | **PASS** — 31 tests across delta, room-sync and room-match |
| TypeScript | **PASS** — `npx tsc --noEmit` |
| Production build | **PASS** — `npm run build` (Vite + service-worker precache) |
| Staging Worker build | **PASS** — `npx vite build --config mp-room-vite.config.ts` |

New coverage includes:

- Initial sync required before a delta; late delta rejected `not-ready`.
- Unsupported version, short fog/map, smuggled `scenario`, unknown fields rejected.
- Exact reconstruction of both teams through movement, combat, fog changes, production and removal.
- Map absent from every delta; delta bytes below one third of the initial sync.
- Hidden enemies, opposing economy, hidden projectiles and scenario/AI data absent from both seats' serialised streams.
- Duplicate, stale, gap and wrong-base sequences rejected without partial apply.
- Epoch mismatch; a new generation must advance the epoch.
- Checkpoint after the chain limit omits `map`; the connected client retains its map.
- A map-less checkpoint without a baseline is rejected `not-ready`.
- Reconnect creates a new epoch and exact state; resync creates a checkpoint and exact state.
- Sequence wrap forces a new sync generation.
- Final result reaches both seats after the final team checkpoint.

### 5.2 Deployed smoke and lifecycle

- `tools/phase2a-deployed-smoke.mjs` passed all 15 checks against `a4a5d9cd`: 101 upgrade, two seats, team isolation, valid command accepted, forged authority rejected `forbidden-field`, oversized frame rejected `payload-too-large`, wrong token 401, foreign origin 403, duplicate seat 409, resync checkpoint, reconnect on a new epoch, delta carried no map/full state, result to both seats, reservation released, global capacity boundary enforced. Initial sync 58,967 B; first delta 365 B; resync 26 ms.
- `tools/phase2a1-failure-tests.mjs` passed all six groups against the same version: reconnect (91 ms), permanent disconnect/abandonment (30.12 s), controlled shutdown, 10 s hard deadline (9.766 s), resync (44 ms), and capacity `[200, 200, 503, 200]` with `capacity-full` on the third room and a freed slot after release.

## 6. Deployed 30-minute soak

### 6.1 Topology and version

- Worker `mca-multiplayer-staging`, version `a4a5d9cd-87d6-4078-8ed7-3f677d87c03b`.
- Room `phase2a4-main6-mvupcv34`, 1v1, `matchDurationMs = 1,800,000`.
- Start `2026-10-30T08:20:39.141Z`; end `2026-10-30T08:50:38.981Z`; wall clock 1,799.84 s.
- Two independent raw WebSocket clients, 20 Hz authoritative tick, 10 Hz updates.
- Seat 0: normal move commands every 5 s plus production every 180 s. Seat 1: no gameplay commands for the entire match; keepalive only. Both seats sent application keepalive every 20 s.
- Normal hard-deadline completion at tick 35,994; no restart, no abandonment, no reconnect.

### 6.2 Result

- Server ticks: **35,994**; expected 35,995 at 20 Hz over 1,799.749 s; effective **19.9995 Hz**. The one-tick difference is the startup boundary, not a lost update.
- Both seats received `result`: seat 0 `victory`, seat 1 `defeat`, winner team 0, reason `time-limit`, tick 35,994.
- Both sockets closed with code `1000`, reason `match-finished`.
- Room closed; reservation `r93` status `released`; no stale room record.
- Client reconstruction: both assemblers ready, epoch 7, seq 17,999, tick 35,994, phase `finished`; 6,912 map tiles and 6,912 fog tiles on both seats; tick and outcomes match the server.
- Commands: 358 sent, 358 accepted, 0 rejected, 0 timeouts. Ack latency p50 14 ms, p95 19 ms, p99 50 ms, max 105 ms.
- Keepalive: 89 sent and 89 acked per seat; server received 178, acked 178, rate-limited 0.
- Errors: none in the harness, no protocol rejection, no assembly rejection, no resync request.

### 6.3 Tick and snapshot cadence

Tick execution duration percentiles are **unavailable**: deployed Workers freeze timer APIs during CPU-only work, so the room's `performance.now()`-based measurements report zero. The tick count and effective rate are authoritative; individual tick wall durations are not claimed.

| Measure | Seat 0 | Seat 1 |
| --- | ---: | ---: |
| Updates received | 17,999 | 17,999 |
| Frequency | 10.0003 Hz | 10.0003 Hz |
| Gap p50 / p95 / p99 | 100 / 102 / 123 ms | 100 / 102 / 122 ms |
| Longest gap | 257 ms | 225 ms |
| Syncs | 7 | 7 |
| Deltas | 17,992 | 17,992 |
| Sync bytes | 176,712 | 162,312 |
| First sync bytes | 58,975 | 58,969 |
| Map bytes (all syncs) | 41,797 | 41,797 |
| Delta bytes | 9,746,332 | 7,382,284 |

A 300-second checkpoint probe on the same version produced 2 syncs and 3,302 deltas per seat, with `syncMapBytes = 41,797` and 0 rejected updates. This proves the five-minute checkpoint is map-less and the client retains its baseline map.

## 7. Payload and network comparison

The Phase 2A.3 baseline was the same 30-minute, two-seat, 20 Hz/10 Hz workload on version `610f19fa`: 36,000 full snapshots, mean 61,054 B (seat 0) and 58,900 B (seat 1), total outbound 2,159,214,532 B. Phase 2A.4 replaces those 36,000 full snapshots with 7 syncs and 17,992 deltas per seat.

| Measure | Phase 2A.3 baseline | Phase 2A.4 final | Change |
| --- | ---: | ---: | ---: |
| Total outbound | 2,159,214,532 B (2.01 GiB) | 17,497,285 B (16.69 MiB) | **−99.19% (123.4× lower)** |
| Mean per-seat update | 61,054 B / 58,900 B | 551 B / 419 B | **−99.10% / −99.29%** |
| Full snapshots | 36,000 | 14 syncs | 7 per seat |
| Static map bytes per seat | 41,797 × 36,000 | 41,797 × 1 | **−99.997%** |
| Delta/update p50 | — | 397 B / 411 B | — |
| Delta p95 / p99 | — | 1,427 / 1,757 B (seat 0), 412 / 413 B (seat 1) | — |
| Delta max | — | 3,235 B (seat 0), 413 B (seat 1) | — |
| Update gaps p99 | — | 123 ms | — |

Seat 0's larger deltas come from its own movement, production and fog changes; seat 1 is idle and its deltas are almost entirely its own entity/player state at ~411 B. `deltaMapBytes = 0`; no delta contained the map. The static map is present once in the first sync, once again on a reconnect/resync (none occurred in the final soak), and absent from all six periodic checkpoints per seat.

## 8. CPU, memory and persistence

### 8.1 Platform CPU

Cloudflare `durableObjectsPeriodicGroups`, 31 minute rows, exact room/window **[deployed]**:

- CPU time: **19,697,594 µs (19.698 s)** over 1,799.749 s = **1.094% of wall time**.
- Phase 2A.3 baseline: 38,708 ms = 2.151%. Reduction: **49.1%**, or 1.97× lower.
- Mean aggregate CPU per tick: **0.547 ms** (19.698 s / 35,994). This is an average, not a per-tick distribution.
- `exceededCpuErrors`, `exceededMemoryErrors`, `fatalInternalErrors`: **0 / 0 / 0**.

`durableObjectsInvocationsAdaptiveGroups` reports 4 requests: one create, two long-lived WebSocket invocations and one final status. The two WebSocket entries carry 19.63 s of CPU between them (p50 5.6 ms, p95 19.63 s), which is total invocation cost, not per-message or per-tick cost. The **10 ms per-tick headroom target remains unproven**; the available data cannot show that every individual tick stayed below 10 ms.

### 8.2 Isolate memory

Memory is the Durable Object isolate reported by Cloudflare, not retained heap:

| Point | Bytes | MiB |
| --- | ---: | ---: |
| First minute | 6,902,828 | 6.58 |
| Minute 10 | 18,825,772 | 17.95 |
| Minute 20 | 34,723,835 | 33.12 (peak) |
| Minute 27 | 17,100,588 | 16.31 |
| Last minute | 18,799,148 | 17.93 |

Peak 34.72 MB (33.12 MiB) is **30.4% below** the Phase 2A.3 peak of 47.61 MiB. More importantly, memory **fell by ~16.5 MB at minute 27 while both WebSocket connections remained active**, with the same object id, full 60 s active time and no restart. That is consistent with runtime heap commitment/GC rather than a monotonic application leak. It does not prove the absence of a slow leak, and Cloudflare exposes no retained-heap measurement on this plan. The existing 30-minute and two-room caps remain.

### 8.3 Persistence

Persistence intentionally still stores a complete room snapshot, not a delta stream:

- 121 snapshot cycles, 211 meta cycles, 726 chunks, 1,059 writes, 720 deletes.
- 31,300,626 B written; maximum snapshot 262,101 B; 0 failures; 0 cycles behind.
- Cycle and operation duration percentiles are zero/unavailable for the same frozen-timer reason.
- Reconciliation: platform rows read/written 840/1,779 versus room reads/writes 122/1,059; the platform includes SQLite bookkeeping and per-minute aggregation. `durableObjectsStorageGroups` returned 0 rows, so stored-byte reconciliation is unavailable.

This phase reduces network and projection cost, not persistence bytes. A future phase should decide whether the recovery snapshot can reuse the same delta/static split.

## 9. Free-tier accounting

Measured against the deployed staging object **[deployed]**:

| Resource | This room | Free daily allowance | Share |
| --- | ---: | ---: | ---: |
| Duration | 230.411 GB-s | 13,000 GB-s | 1.77% |
| Request-equivalents | 122 | 100,000 | 0.12% |
| Rows written | 1,779 | 100,000 | 1.78% |
| CPU | 19.698 s | — (per-invocation limit, no daily CPU charge) | — |
| Outbound WebSocket messages | 36,540 | outbound messages free | — |
| Inbound WebSocket messages | 536 (billed at 20:1) | included in request-equivalents | — |

The 80% daily duration budget supports approximately **45** rooms of this shape per day (`13,000 × 0.8 ÷ 230.4`); the 80% row-write budget supports approximately **44.9**. The existing conservative policy remains 2 active rooms, 30-minute hard limit, 80% daily duration budget, reservation-before-allocation, idempotent release and fail-closed admission. No admission limit was increased from this single soak. No paid plan, billing activation, automatic upgrade or paid fallback was introduced.

## 10. Incidents and anomalies

1. **Earlier pre-fix run (`main4`) lost both sockets at 27 m 20 s.** The Durable Object restarted and restored from its persisted snapshot; both clients closed with no close code. The harness at that time had no reconnect path, so it aborted. This was a transport/runtime restart, not a protocol rejection: no delta was rejected and the room state restored to the correct tick. The harness now reconnects a seat within the 30 s abandonment window and records attempts/failures. The final soak required zero reconnects.
2. **Two `clientDisconnected` invocation statuses** appear in the platform invocation dataset for the long-lived WebSocket requests. They are the expected terminal statuses when the room closes the sockets after the result; there were no application exceptions and no `fatalInternalErrors`.
3. **Memory is not monotonic.** The minute-27 drop from ~31.35 MB to ~17.10 MB occurred with both sockets active and the same object id. This is evidence against an application-owned monotonic leak, but it is not a retained-heap proof.
4. **Per-tick durations remain unavailable.** No claim is made that every tick is under 10 ms. The aggregate 0.547 ms/tick is consistent with headroom but is not a per-tick measurement.

## 11. Remaining risks and recommended next phase

- **Per-tick CPU headroom is unproven.** Deployed timing APIs are frozen; use invocation CPU plus a dedicated profile if this must be closed.
- **Retained heap is unmeasurable on this plan.** The observed drop supports a runtime/GC explanation, but a slow leak over multiple rooms cannot be excluded. Keep 30 minutes / 2 rooms.
- **Recovery persistence is still full-state.** 262 KB per 15 s and ~31.3 MB written per room are unchanged. It may be the next largest avoidable cost after network.
- **One successful 30-minute room is not evidence for concurrent rooms.** The capacity boundary is proven separately (`200, 200, 503, 200`), but two simultaneous 30-minute rooms have not been soaked.
- **Map-less checkpoints require a verified baseline.** The assembler rejects a map-less checkpoint with `not-ready` and forces a resync; that path is tested locally. A reconnect or explicit resync always includes the map.

Recommended next phase: **recovery-snapshot efficiency / retained-heap measurement**, separately from any lobby or account work. Do not raise the 2-room or 30-minute limits on this evidence.

## 12. Acceptance assessment

| Criterion | Result | Evidence |
| --- | --- | --- |
| Static map sent once per seat | **PASS** | 41,797 B map in first sync only; six map-less checkpoints; 300 s checkpoint probe; 0 rejected updates |
| Subsequent updates are dynamic only | **PASS** | `deltaMapBytes = 0`; deltas p50 397/411 B; no `state`/`map`/`scenario` |
| Exact client reconstruction | **PASS** | Both seats tick 35,994, epoch 7, seq 17,999; 6,912 map/fog tiles; full test suite |
| Team projection isolation | **PASS** | Unit leak tests and deployed smoke: team 0/1 only, no hidden ids/coords, opposing economy null |
| Reconnect / resync / checkpoint | **PASS** | Lifecycle reconnect 91 ms, resync 44 ms, map-less checkpoint retained map; epoch advances |
| 30-minute deployed soak | **PASS** | 35,994 ticks, 19.9995 Hz, both results, both sockets 1000 `match-finished` |
| Reservation and cleanup | **PASS** | 89 heartbeats, 0 failures, release 1/0 failures, status `released`; capacity freed and re-admitted |
| Network/payload reduction | **PASS** | 2,159,214,532 B → 17,497,285 B; −99.19% |
| CPU improvement | **PASS (aggregate)** | 38,708 ms → 19,698 ms; −49.1%; per-tick 10 ms headroom **UNPROVEN** |
| Memory bounded | **CONDITIONAL** | Peak 47.61 MiB → 33.12 MiB; minute-27 drop; no retained-heap metric; caps retained |
| Persistence valid | **PASS** | 121 snapshot cycles, 31.3 MB, 0 failures, final state valid |
| Full suite / typecheck / build | **PASS** | 87 files / 891 tests; `tsc`; production build |
| Single-player unaffected | **PASS** | Production build contains no multiplayer import; full suite unchanged |
| Production flag / no paid service | **PASS** | `MULTIPLAYER_FEATURE.enabled = false`; staging-only; no billing/upgrade |
| No stage/commit | **PASS** | Working tree left uncommitted and unstaged by this phase |

## 13. Reproduction

```bash
# 1. Local checks
npx tsc --noEmit
npx vitest run
npm run build

# 2. Build the isolated staging Worker
npx vite build --config mp-room-vite.config.ts
npx wrangler deploy --config mp-room-wrangler.jsonc

# 3. Final 30-minute soak (admin token read from .dev/mp-admin-token)
MP_IDLE_SEAT=1 MP_WS_PING_MS=20000 MP_SOAK_LABEL=phase2a4-main6 \
  node tools/phase2a1-soak.mjs

# 4. Short map-less checkpoint probe
MP_SOAK_MS=330000 MP_IDLE_SEAT=1 MP_SOAK_LABEL=phase2a4-checkpoint \
  node tools/phase2a1-soak.mjs

# 5. Post-soak lifecycle and capacity
node tools/phase2a1-failure-tests.mjs

# 6. Deployed security/protocol smoke
node tools/phase2a-deployed-smoke.mjs

# 7. Platform metrics for a room/window (token/account from the operator environment)
CLOUDFLARE_API_TOKEN=... MP_ACCOUNT_ID=... \
  MP_ROOM_ID=phase2a4-main6-mvupcv34 \
  MP_START=2026-10-30T08:20:30Z MP_END=2026-10-30T08:51:30Z \
  MP_OUT_DIR=staging-evidence/phase2a4-main6-platform \
  node tools/phase2a2-metrics.mjs
```

The deployed Worker URL is `https://mca-multiplayer-staging.horsemeninteractive.workers.dev`. Do not deploy this configuration to production or enable `MULTIPLAYER_FEATURE`.

## 14. Evidence index

| Path | Contents |
| --- | --- |
| `staging-evidence/phase2a4-main6-2026-10-30T08-20-38-216Z/summary.json` | Final soak summary, protocol/byte/tick/gap/reconstruction/reservation counters |
| `.../status-final.json` | Authoritative final room status |
| `.../metrics.jsonl` | Timestamped command, keepalive, interval, assembly and socket events |
| `.../run.log` | Human-readable run log |
| `.../room.json` | Sanitised room handle (tokens removed) |
| `.../README.md` | One-page evidence index and key numbers |
| `staging-evidence/phase2a4-main6-platform-metrics.json` | Exact Cloudflare GraphQL periodic/invocation/storage rows |
| `staging-evidence/phase2a4-checkpoint-2026-10-30T08-14-59-895Z/` | 300 s map-once checkpoint probe |
| `staging-evidence/phase2a1-failures-2026-10-30T08-55-32-419Z/` | Final reconnect, abandonment, shutdown, deadline, resync, capacity results |
| `staging-evidence/phase2a4-deployed-smoke.log` | Deployed 15-check security/protocol smoke |
| `staging-evidence/phase2a4-main5-...` | Earlier 30 m pass with map-bearing checkpoints (intermediate; superseded by main6 for map-once) |
| `staging-evidence/phase2a4-main4-...` | Pre-reconnect abort at 27 m 20 s, retained for incident evidence |

Seat tokens, admin tokens and account identifiers are not stored in these files.

## 15. Bottom line

Phase 2A.4 meets its primary objective: the repeated static map/fog payload is gone, the wire stream is versioned and reconstructible, both teams' projections remain isolated, reconnect/resync/checkpoint recovery are tested, and the deployed 30-minute room completed with both results and a released reservation. The remaining caveats are measurement limitations, not observed protocol or authority regressions: per-tick CPU headroom is still unproven, retained heap is not directly observable, recovery persistence remains full-state, and a single room does not justify raising capacity limits.

