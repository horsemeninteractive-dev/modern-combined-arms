# MCA — Multiplayer Phase 2A Report

**Date:** 2026-10-30  
**Scope:** deployed, authoritative 1v1 room transport; no lobby, accounts, discovery or production route.  
**Overall status:** **CONDITIONAL PASS** — the vertical slice works locally and on the isolated staging Worker; production/public-room approval remains blocked by unmeasured CPU headroom and the missing 30-minute deployed soak.

---

## 1. Executive summary

Phase 2A adds one real server-authoritative room runtime on Cloudflare Workers/Durable Objects and proves it through two independent clients:

- One `Game` instance per room, ticked at a fixed 20 Hz by the Durable Object scheduler.
- Every client command passes through the existing Phase 1 `CommandGate`.
- Every outbound game payload is built by `createTeamSnapshot`; no raw `GameState`, scenario or opposing projection is broadcast.
- The global `CapacityCoordinatorDurableObject` is reserved before a room allocates a `Game`, and released idempotently on finish, deadline, abandonment, shutdown and error paths.
- A versioned WebSocket protocol (v1) carries hello, snapshots, command acknowledgements/rejections, neutral results, errors and room-closed notices.
- The isolated Worker is deployed at `https://mca-multiplayer-staging.horsemeninteractive.workers.dev`, with production traffic untouched.
- A real deployed match completed with both seats receiving a neutral result, then closed with the reservation released. A third room was rejected with `capacity-full` while two rooms held the capacity slots.

No paid service, billing fallback, automatic upgrade or production lobby was added. The production browser bundle still has `MULTIPLAYER_FEATURE.enabled === false` and imports none of the server modules.

---

## 2. Architecture and changed files

### 2.1 Topology

```text
Browser / raw test client
        │  WSS + mca.v1, mca.token.<seat-token>
        ▼
mca-multiplayer-staging Worker
        ├── /api/multiplayer/rooms/:roomId        POST  create
        ├── /api/multiplayer/rooms/:roomId/ws     GET   WebSocket upgrade
        ├── /api/multiplayer/rooms/:roomId/status GET   admin status
        ├── /api/multiplayer/rooms/:roomId/shutdown POST admin shutdown
        ├── /api/multiplayer/dev[/client.js]      dev probe page
        └── /api/multiplayer/health               public readiness
                    │
                    ▼
        MatchRoomDurableObject (one per room, SQLite-backed)
                    │  capacity service binding
                    ▼
        CapacityCoordinatorDurableObject ('global', SQLite-backed)
```

The Worker and both Durable Object classes are one isolated staging script. It does not share a route, binding, migration or deployment with the Pages build. The capacity namespace always addresses the single object name `global`; there is no per-room counter.

### 2.2 Files added

| File | Purpose |
|---|---|
| `src/multiplayer/protocol.ts` | Protocol v1 constants, client message parser, server message types, team-relative result message. |
| `src/multiplayer/roomMatch.ts` | Transport-independent authoritative room: seat table, command gate, 20 Hz tick, 10 Hz snapshots, reconnection, abandonment, deadline, neutral result, in-room counters. |
| `src/multiplayer/roomDurableObject.ts` | Durable Object lifecycle: create/reserve, socket upgrade, timers, heartbeat, chunked persistence, restore, finalization, release. |
| `src/multiplayer/roomWorker.ts` | Isolated staging Worker routes, admin token boundary, origin checks, kill switch, dev probe page. |
| `src/multiplayer/devRoomClient.js` | Development-only browser probe for seat connection, snapshots, commands and status. |
| `src/multiplayer/cloudflare.d.ts` | Minimal Workers/Durable Object declarations for the server modules. |
| `mp-room-vite.config.ts` | Builds only `roomWorker.ts` into `dist-mp-room/`; normal Vite build untouched. |
| `mp-room-wrangler.jsonc` | Isolated Worker deployment, SQLite DO migration, staging vars and bindings. |
| `tests/phase2a-room-match.test.ts` | 7 room-runtime tests. |
| `tests/phase2a-protocol.test.ts` | 3 protocol tests. |
| `tests/phase2a-capacity.test.ts` | 6 global activation/capacity tests. |
| `tools/phase2a-raw-client.mjs` | Minimal RFC 6455 client used to observe real 401/403/409/101 handshake status. |
| `tools/phase2a-local-smoke.mjs` | Real local `workerd` two-seat transport, heartbeat and capacity smoke. |
| `tools/phase2a-deployed-smoke.mjs` | Deployed two-seat transport, isolation, command, reconnect, result and capacity smoke. |
| `docs/MULTIPLAYER_PHASE_2A_PLAN.md` | Pre-implementation plan and capability check. |
| `MULTIPLAYER_PHASE_2A_REPORT.md` | This report. |

### 2.3 Files changed

| File | Change |
|---|---|
| `.gitignore` | Ignore `dist-mp-room/`, `.wrangler/`, `.dev.vars`. |
| `tsconfig.json` | Typecheck `mp-room-vite.config.ts` as well as the browser config. |
| `src/multiplayer/featureFlag.ts` | Reason string updated from Phase 1 to Phase 2A; the flag remains disabled. |

No simulation, rendering, input, fog, save, campaign, tutorial or single-player startup file was changed for Phase 2A. The existing uncommitted working tree was preserved; nothing was staged or committed.

### 2.4 Integration reuse

| Concern | Reused module |
|---|---|
| Simulation | `Game.tick()` in `src/sim/game.ts`; one `Game` with `localPlayerId = -1`, `enableAI = false`. |
| Commands | `CommandGate` in `src/multiplayer/commandGate.ts`; room builds the envelope from its trusted seat table. |
| Team state | `createTeamSnapshot` in `src/multiplayer/projection.ts`; the only game payload sent to a seat. |
| Result | `evaluateMatchResult` in `src/multiplayer/matchResult.ts`; neutral result, projected per team. |
| Recovery | `createRoomSnapshot` / `restoreRoomSnapshot` in `src/multiplayer/roomSnapshot.ts`; separate from single-player saves. |
| Capacity | `CapacityClient`, `ReservationLease`, `activateReservedRoom`, `CapacityCoordinatorDurableObject`. |

---

## 3. Protocol and lifecycle

### 3.1 Protocol v1

Client to server, only:

```json
{ "type": "command", "v": 1, "command": { "type": "stop", "ids": [12] } }
```

The envelope rejects unknown top-level fields. The command body is the existing Phase 1 command shape. A client cannot send `team`, `playerId`, `owner` or `seat` as authority; those are added from the room's seat table after the message is parsed.

Server to client:

| Message | Contents |
|---|---|
| `hello` | `v`, room, seat, player, team, mode, phase, tick, tick Hz, snapshot Hz, deadline. |
| `snapshot` | Existing `TeamSnapshot`: static map, own/allied entities, visible enemies, remembered structures, that team's resources, fog, contacts, filtered events and projectiles. |
| `commandAccepted` | Command type and current tick. |
| `commandRejected` | Stable code and safe message; no hidden entity IDs. |
| `result` | Team-relative `victory` / `defeat` / `draw` plus projected neutral result. |
| `error` | Structured, non-sensitive protocol/size/rate errors. |
| `roomClosed` | Reason and code for shutdown/expiry. |

Hard limits:

- 2 seats, 1v1 only.
- 1 socket per seat.
- 4 KiB maximum inbound text message.
- 20 inbound messages per second per seat before disconnect.
- Command gate: one batch per 100 ms per seat, maximum 64 entity IDs.
- 20 Hz simulation, 10 Hz snapshots.
- 30-minute hard maximum match duration.
- 2 active rooms and daily `10,400 GB-s` / `80,000` request admission ceiling in the reservation policy.

The seat token is sent in the WebSocket subprotocol list (`mca.v1, mca.token.<128-bit token>`), not in the URL. The Worker requires same-origin by default or an explicit `MP_ALLOWED_ORIGINS` entry; missing `Origin` is rejected unless the separate staging-only `MP_ALLOW_NO_ORIGIN=1` is set. It is not set on staging.

### 3.2 Lifecycle

1. Admin `POST` creates a room; Worker forwards to the named Durable Object.
2. Room reserves global capacity; only after a successful reservation does it create the `Game`, seats and snapshot.
3. Metadata and a chunked room snapshot are persisted before the create response.
4. Both seats connect with their tokens. The match phase changes to `playing` only when both seats are connected.
5. The Durable Object scheduler calls `RoomMatch.tick()` on a fixed 50 ms schedule with bounded catch-up; network timing never sets step size.
6. Snapshots are broadcast every two game ticks. Commands go to `CommandGate`; accepted commands enter the authoritative queue.
7. A 20-second lease heartbeat updates the reservation. A 15-second persistence timer writes a snapshot and metadata.
8. Finish on neutral elimination, configured time limit, seat abandonment after the grace period, hard reservation deadline, reservation failure, or admin shutdown.
9. Final snapshot and team-relative result are sent, sockets close cleanly, the reservation is released once, and final metadata is persisted.
10. After eviction, the room loads metadata plus snapshot chunks and restores the `Game`; all seats start disconnected and must reconnect with their original tokens.

The room's scheduler and persistence timers are re-armed when a WebSocket is accepted, because timers armed during a create request can be cleared when that request finishes in `workerd`.

---

## 4. Security boundaries and test evidence

### 4.1 Authority

- Seat identity is resolved from the room's persisted seat table and token.
- The token is 128-bit random, compared without early exit.
- A socket is bound to one seat; `receive(seatId, socket, ...)` rejects a socket that is not the seat's current socket (`seat-inactive`).
- Client-supplied `team`, `playerId` or `owner` is rejected by `CommandGate` with `forbidden-field` before the queue.
- Entity ownership and visibility are checked by the existing gate, not by the renderer.
- Duplicate sockets for one seat receive HTTP 409; reconnect after close is accepted with the same token.
- Commands after finish/close are rejected and no longer enter the queue.

### 4.2 Information boundary

- Only `createTeamSnapshot` payloads are sent for game state.
- The final result is projected per recipient: opposing score is `null`, and each seat receives its own `victory`/`defeat`/`draw` interpretation.
- Hidden enemy units and buildings are absent from serialized snapshots, not merely hidden by a renderer.
- Hidden target IDs are not echoed in rejection messages; the room test asserts the hidden ID is absent from the rejection JSON.
- Opposing player names, resource totals and queues are absent from snapshots; the room test mutates the opponent to `SECRET OPPONENT` / `777777` and asserts neither appears in either socket stream.
- AI state and the original scenario are not included in any room message.

### 4.3 Transport and administration

- Admin create/status/shutdown require `MP_ADMIN_TOKEN` with a constant-time comparison.
- `MP_ONLINE_ENABLED=1` is required for room routes; setting it to `0` is the kill switch and returns `online-disabled` (HTTP 503) for new room/socket requests.
- API responses use `Cache-Control: no-store`, `nosniff`, `no-referrer`, `same-origin` resource policy and frame denial.
- The dev probe page has a restrictive CSP and is enabled only with `MP_DEV_MODE=1`.
- No token, snapshot or full authoritative state is logged by the room.
- The staging Worker is separate from the production Pages deployment; no production route was changed.

### 4.4 Focused test coverage

New Phase 2A tests: **16** (7 room, 3 protocol, 6 capacity).

Covered:

- Seat assignment from the server table; forged `team` and `playerId`.
- Cross-seat socket submission.
- Hidden target rejection without leaking the hidden ID.
- Opposing name/resource exclusion from both team streams.
- Duplicate seat 409 and clean reconnect with late old-close events.
- Abandonment grace and surviving-team victory.
- Hard deadline and result for every connected seat; post-finish command rejection.
- Room snapshot restore and deterministic 40-tick continuation.
- Concurrent activation at the final capacity slot.
- Duplicate reservation retries and idempotent release.
- Reservation-store failure fails closed without activation.
- Capacity exhaustion and too-long match rejection.
- Protocol unknown fields, versions, types, arrays, malformed JSON, size cap, result perspective.

Not covered by an automated test: slow-client `bufferedAmount` disconnect, kill-switch request through the Worker, and a deployed reservation-store failure. These are code-inspected only.

---

## 5. Local integration results

Environment:

- Windows, Node `v24.14.0`, Wrangler `4.156.0`, local `workerd`.
- Isolated Worker on `http://127.0.0.1:8791`, separate Durable Object persistence.
- `MP_ONLINE_ENABLED=1`, `MP_DEV_MODE=1`, exact local origin allowlisted.
- No `MP_ALLOW_NO_ORIGIN`; the harness sends a real `Origin` header.

Command:

```bash
MP_BASE=http://127.0.0.1:8791 \
MP_ORIGIN=http://127.0.0.1:8791 \
MP_ADMIN_TOKEN=<local-admin-token> \
node tools/phase2a-local-smoke.mjs
```

Result: `LOCAL_SMOKE_EXIT=0`.

```json
{
  "ok": true,
  "base": "http://127.0.0.1:8791",
  "heartbeat": 1,
  "finalReservation": "released",
  "finalStats": {
    "ticks": 296,
    "snapshots": 296,
    "outboundBytes": 17435409,
    "inboundMessages": 3,
    "connectionsAccepted": 3,
    "commandsAccepted": 1,
    "commandsRejected": 1,
    "heartbeatCount": 0,
    "approxRequests": 8
  },
  "capacityRejected": "capacity-full",
  "checks": [
    "two seats connected",
    "team projections isolated",
    "valid command accepted",
    "forged authority rejected",
    "oversized frame rejected",
    "wrong token 401",
    "foreign origin 403",
    "duplicate seat 409",
    "reconnect accepted",
    "result delivered to both seats",
    "reservation released",
    "20s heartbeat observed",
    "global capacity boundary enforced"
  ]
}
```

The 15-second match produced 296 ticks (approximately 19.7 Hz including the short start/stop edges), 296 snapshot sends, 3 inbound messages (one accepted command, one forged rejection, one oversized frame), and 3 accepted connections (initial two plus one reconnect). A separate 30-second room observed one lease heartbeat. Two 15-second rooms filled the global slot; a third room was rejected with `capacity-full`; releasing one allowed a new room to reserve.

---

## 6. Deployed verification

### 6.1 Environment

| Item | Value |
|---|---|
| Worker | `mca-multiplayer-staging` |
| Origin | `https://mca-multiplayer-staging.horsemeninteractive.workers.dev` |
| Deployment | Version `d4630908-5343-4d58-b941-944d9dc27f50`; deployed `2026-10-29T21:33:18.913Z` (version created `21:33:17.604Z`). |
| Compatibility | `2026-10-01`, `nodejs_compat` (staging only). |
| Durable Objects | `MatchRoomDurableObject`, `CapacityCoordinatorDurableObject`; migration `v1`, SQLite classes. |
| Secrets | `MP_ADMIN_TOKEN`, `MCA_RESERVATION_TOKEN` set with `wrangler secret put`; values are not in the repository, report or client bundle. |
| Staging vars | `MP_ONLINE_ENABLED=1`, `MP_DEV_MODE=1`, 60 s default / 1800 s max match, 30 s abandonment, exact staging origin allowlist. |
| Production | Not modified; no Pages route, binding or deployment. |

`/api/multiplayer/health` returned:

```json
{
  "ok": true,
  "onlineEnabled": true,
  "devMode": true,
  "adminConfigured": true,
  "reservationConfigured": true,
  "protocol": "mca.v1",
  "build": "phase2a-staging"
}
```

### 6.2 Deployed smoke

Command:

```bash
MP_BASE=https://mca-multiplayer-staging.horsemeninteractive.workers.dev \
MP_ADMIN_TOKEN=<staging-admin-token> \
node tools/phase2a-deployed-smoke.mjs
```

Result: exit code 0.

Deployed checks actually executed:

- WebSocket upgrade returned 101 through the deployed Worker to the Durable Object.
- Both seats connected and received `hello` plus a team-filtered initial snapshot.
- Team 0 and team 1 snapshots contained only players of their own team.
- A valid `stop` command was accepted through `CommandGate`.
- A forged `team: 1` field was rejected with `forbidden-field` after the rate window.
- A 5,000-byte message was rejected with `payload-too-large`.
- Wrong seat token: **401**.
- Foreign `Origin`: **403**.
- Duplicate connected seat: **409**.
- Disconnect and reconnect with the same seat token succeeded.
- Both seats received a neutral `result`; the room closed and the reservation status became `released`.
- With two 20-second rooms holding the shared capacity slots, a third create returned **503 `capacity-full`**. Shutting one room down allowed the next create to return 200. The remaining rooms were shut down and released.

The functional room used a 14-second match. This proves the deployed transport and lifecycle; it is not a 30-minute soak.

### 6.3 Deployed workload counters

A separate 12-second deployed room (two seats, no commands) was measured through the admin status endpoint after close:

| Counter | Value |
|---|---:|
| Match duration (start → finish) | 11,790 ms |
| Game ticks | 235 |
| Snapshot sends | 238 |
| Outbound bytes | 14,018,688 |
| Inbound WebSocket messages | 0 |
| Connections accepted | 2 |
| Commands accepted / rejected | 0 / 0 |
| Heartbeats | 0 (shorter than the 20 s interval) |
| In-room approximate requests | 6 |
| Result | draw |
| Reservation | released |

Derived:

- Effective tick rate: **19.9 Hz**.
- Snapshot rate: **238 / 11.79 s ≈ 20.2 sends/s** total (two seats, 10 Hz each).
- Average snapshot payload: **14,018,688 / 238 ≈ 58,902 bytes per seat snapshot**.
- Per-seat snapshot bandwidth: **≈ 589 KB/s**.
- Room snapshot bandwidth: **≈ 1.18 MB/s**.
- The 58.9 KB payload is materially larger than the Phase 0 prototype's 2–3 KB projection because Phase 1's `TeamSnapshot` includes the static map/terrain on every send. It is below the 64 KB per-seat budget adopted for this phase, but it is a clear optimization target before public rooms.

No deployed 30-minute room was run.

---

## 7. Observed versus estimated free-tier usage

### 7.1 Published allowances used

Accessed 2026-10-29 from official Cloudflare pages (same sources as the Phase 0 report):

| Product | Free allowance | Source |
|---|---|---|
| Durable Objects requests | 100,000/day; incoming WebSocket messages at 20:1; outgoing messages and protocol pings not charged | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Durable Objects duration | 13,000 GB-s/day; active object at 128 MB | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Durable Objects SQLite | 5M rows read/day, 100,000 rows written/day, 5 GB total | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Workers Free | 100,000 requests/day, 10 ms CPU per invocation, 128 MB memory | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Pages Functions | Shares the Workers Free request allowance; static assets free | [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/) |
| D1 Free | 5M rows read/day, 100,000 rows written/day, 5 GB total | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |

Free limits reset at 00:00 UTC and fail closed rather than automatically upgrading. The Phase 2A reservation policy deliberately uses 80% of the published duration and request allowances: **10,400 GB-s/day** and **80,000 requests/day**.

### 7.2 Per-room model

For one 1v1 room at the 30-minute hard cap:

```text
Duration = 1,800 s × 128 MB / 1 GB = 230.4 GB-s
Worst-case commands = 2 seats × 10 commands/s × 1,800 s = 36,000
Billed incoming requests = 36,000 / 20 = 1,800
Upgrades = 2
Lifecycle/coordinator = 8
Subtotal = 1,810
With 1.1 safety margin = 1,991 requests
```

Daily admission:

```text
Duration: 10,400 / 230.4 = 45.1  → 45 full rooms/day
Requests: 80,000 / 1,991 = 40.2 → 40 full rooms/day
Active room cap: 2
```

The conservative planning number is therefore **40 full 30-minute rooms/day, at most 2 active**, i.e. 20 room-hours/day. Request budget, not duration, is the tighter limit under worst-case command traffic. Actual command traffic in the deployed short room was zero; normal play will be below the 10 Hz per-seat cap. No snapshot acknowledgements are implemented, so the request model does not include them; adding per-snapshot ACKs would break this budget.

### 7.3 What is measured versus estimated

**Measured on staging:** connection outcomes, handshake statuses, team filtering, command gate outcomes, reconnect, result delivery, close, reservation release, capacity rejection, tick count, snapshot count, outbound bytes, inbound message count, connections and in-room approximate requests (the detailed counter table is the 12-second metrics room above).

**Estimated, not measured:** Cloudflare-billed duration, CPU time, memory, and the dashboard's request accounting. The toolchain did not expose per-object Cloudflare analytics. The 230.4 GB-s and 1,991-request figures are policy projections from published allowances, not a bill. The 30-minute deployed workload and four-seat workload were not run.

**Risk:** Workers Free has a 10 ms CPU limit per invocation. The 10 Hz broadcast serializes two ~58.9 KB snapshots in one timer invocation; local Phase 0 data showed projection p99 around 1 ms for much smaller payloads, but Phase 2A has no deployed CPU measurement. This is the main reason the phase is conditional rather than approved for public rooms.

---

## 8. Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Two clients complete a real authoritative online match through the deployed room runtime | **PASS** | Deployed 14 s match; both seats got `result`; room closed and reservation released. |
| Every command passes through the existing command gate | **PASS** | Deployed accepted `stop`, rejected forged field and oversized frame; room tests assert gate path and queue. |
| Every client receives only its authorised team projection | **PASS** | Deployed team-filtered snapshots; unit tests cover hidden units/buildings, names, resources, queues, AI state and hidden IDs. |
| Global capacity coordinator used before activation | **PASS** | Room reserves before creating `Game`; deployed third room returned 503 `capacity-full`; local concurrent test allows exactly one of two at the final slot. |
| Concurrent reservation behaviour tested and documented accurately | **PASS (local)** | `Promise.all` activation at the last slot; duplicate retry/idempotent release; deployed test was sequential, not concurrent. |
| Hard deadlines, cleanup and failure handling exercised | **CONDITIONAL PASS** | Deployed deadline close/release; local abandonment, shutdown, heartbeat and reservation-failure tests. Slow-client and deployed reservation-store failure are code-inspected only. |
| Resource usage measured or explicitly bounded by conservative documented estimates | **CONDITIONAL PASS** | In-room counters and 80% policy; Cloudflare CPU/memory/request billing not observable. |
| Complete existing test suite, typecheck and production build pass | **PASS** | 83 test files, 852 tests; `tsc --noEmit` exit 0; `npm run build` exit 0. |
| Single-player remains unaffected | **PASS** | No simulation/rendering/save/startup change; `MULTIPLAYER_FEATURE.enabled` false; full suite includes single-player coverage. |
| No paid service, automatic upgrade or billing fallback | **PASS** | No billing API, paid binding or upgrade path; capacity failure returns 503. |
| Kill switch prevents new online sessions | **PASS (code-inspected)** | `MP_ONLINE_ENABLED=0` rejects room routes with `online-disabled`; staging is currently `1` and was not toggled during the test. |
| Four-seat / 2v2 support | **N/A** | Phase 2A deliberately implements 1v1 only; `2v2` is not advertised. |
| Production lobby/discovery/accounts | **OUT OF SCOPE** | Not built. |

**Overall Phase 2A:** **CONDITIONAL PASS** for an isolated staging vertical slice. Do not route production users to it yet.

---

## 9. Remaining failure modes and blockers

1. **CPU headroom is unproven.** Two 58.9 KB snapshots at 10 Hz per room must fit the invocation CPU budget. Measure with Cloudflare analytics or a CPU-limited workerd build before public admission.
2. **No deployed 30-minute soak.** Phase 0 proved 30 minutes locally with the prototype projection; Phase 2A's larger team projection and Durable Object persistence path have only been run for 12–15 seconds on staging.
3. **Snapshot bandwidth is high.** Static terrain is repeated in every snapshot (58.9 KB/seat). A future protocol should send static map data once per connection, then deltas or entities only.
4. **No four-seat/2v2 room.** The protocol and seat table are fixed at two seats; `RoomMode` has a 2v2 policy type but the room rejects anything except `1v1`.
5. **No browser end-to-end match test.** The dev probe exists and is served, but the deployed verification used the raw protocol client and HTTP admin calls. The browser probe was not driven through a full match.
6. **Slow-client disconnect is untested.** `bufferedAmount > 512 KiB` drops the seat, but no automated test exercises it.
7. **Kill switch not toggled on staging.** The code path is present and returns 503; it was not deployed with `MP_ONLINE_ENABLED=0` during this phase.
8. **Durable Object eviction/recovery not exercised on staging.** Unit tests restore room snapshots deterministically; a real eviction during a live deployed match was not forced.
9. **Dev mode is public on the staging Worker.** `/api/multiplayer/dev` is reachable; it has no embedded token and creation still needs the admin token, but `MP_DEV_MODE=0` must be set for any shared deployment.
10. **No account identity.** Seat tokens are per-room development handles, not accounts or persistent identity. Guest/account linking is intentionally deferred.

None of these is a production regression; they are gates before a lobby or public room directory.

---

## 10. Reproduction commands

### 10.1 Focused Phase 2A tests

```bash
npx vitest run tests/phase2a-room-match.test.ts tests/phase2a-protocol.test.ts tests/phase2a-capacity.test.ts
```

### 10.2 Local Worker and smoke

```bash
npx vite build --config mp-room-vite.config.ts

npx wrangler dev --config mp-room-wrangler.jsonc --port 8791 \
  --persist-to .dev/mp-room-local \
  --var MP_ADMIN_TOKEN:<local-admin-token> \
  --var MCA_RESERVATION_TOKEN:<local-reservation-token> \
  --var MP_ALLOWED_ORIGINS:http://127.0.0.1:8791

MP_BASE=http://127.0.0.1:8791 \
MP_ORIGIN=http://127.0.0.1:8791 \
MP_ADMIN_TOKEN:<local-admin-token> \
node tools/phase2a-local-smoke.mjs
```

The local worker should report `Ready on http://127.0.0.1:8791`; the smoke exits 0 only after the two-seat match, reconnect, result, heartbeat and capacity checks pass.

### 10.3 Staging deployment

```bash
npx vite build --config mp-room-vite.config.ts
npx wrangler deploy --config mp-room-wrangler.jsonc
npx wrangler secret put MP_ADMIN_TOKEN --config mp-room-wrangler.jsonc
npx wrangler secret put MCA_RESERVATION_TOKEN --config mp-room-wrangler.jsonc
```

Secrets are entered interactively and never placed in a config file, report or bundle. Verify:

```bash
curl -sS https://mca-multiplayer-staging.horsemeninteractive.workers.dev/api/multiplayer/health
```

### 10.4 Deployed smoke

```bash
MP_BASE=https://mca-multiplayer-staging.horsemeninteractive.workers.dev \
MP_ADMIN_TOKEN:<staging-admin-token> \
node tools/phase2a-deployed-smoke.mjs
```

### 10.5 Repository checks

```bash
npm test
npx tsc --noEmit
npm run build
```

Results from this run:

- `npm test`: **83 files passed, 852 tests passed** (202.31 s).
- `npx tsc --noEmit`: exit 0.
- `npm run build`: exit 0; Vite emitted the pre-existing >500 kB chunk-size warning, no build failure.
- `npx vite build --config mp-room-vite.config.ts`: exit 0; `dist-mp-room/roomWorker.js` 429.58 kB (108.28 kB gzip).

### 10.6 Interface note

The Phase 1 server interfaces are unchanged. Phase 2A adds:

- `RoomMatch` (`src/multiplayer/roomMatch.ts`) as the transport-independent authoritative room API.
- Protocol v1 in `src/multiplayer/protocol.ts`; client messages are command envelopes only.
- `MatchRoomDurableObject` and `CapacityCoordinatorDurableObject` bindings in `mp-room-wrangler.jsonc`.
- Room snapshot chunks in Durable Object storage; the single-player save schema is untouched.

The existing `MULTIPLAYER_FEATURE` flag remains false. A future Phase 2B client adapter must consume `TeamSnapshot` and send command envelopes through the same seat-token connection; it must not import the Durable Object modules into the browser bundle.

---

## 11. Recommendation

**Proceed to Phase 2B only after measuring CPU and running a deployed 30-minute, two-seat soak.** The smallest next phase should:

1. Instrument and measure the deployed room's CPU per 10 Hz broadcast, then either reduce the snapshot payload (send static terrain once) or lower snapshot frequency if the 10 ms headroom is not comfortable.
2. Run the existing Phase 2A room for 30 minutes on staging with two real clients and verify tick rate, heartbeat, persistence, memory and clean close.
3. Exercise the kill switch and a forced Durable Object eviction/recovery on staging.
4. Add the slow-client and deployed reservation-failure tests that are currently only code-inspected.
5. Only then wire the browser client and add the first lobby/discovery surface.

The evidence supports the architecture: the existing simulation runs unchanged inside a Durable Object, commands are gated server-side, team projections are isolated, the global capacity ledger enforces its boundary, and the deployed transport completes a real match without paid services. The missing evidence is resource headroom and long-duration deployed stability, not a failure of the room design.
