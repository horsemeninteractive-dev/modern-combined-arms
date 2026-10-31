# MCA — Multiplayer Phase 2A Implementation Plan

**Date:** 2026-10-29  
**Scope:** smallest deployed, authoritative 1v1 room, not a lobby.

## 1. Current baseline

- Phase 1 server boundary exists in `src/multiplayer/`: `CommandGate`,
  `createTeamSnapshot`, neutral `evaluateMatchResult`, room snapshots and the
  global reservation ledger/client.
- The Phase 0 prototype in `phase0/` proves the existing `Game` runs in local
  `workerd` at 20 Hz with four sockets. It uses its own JS gate/projection and is
  not a production room.
- The game is deployed as a static Pages site. There is no existing multiplayer
  route, room object, session identity or staging Worker.
- The working tree has large unrelated uncommitted changes. They will be kept.
- Wrangler is authenticated to the account for Workers writes. A new staging
  Worker can be deployed without touching the Pages project.

## 2. Cloudflare capability check

Verified against official documentation on 2026-10-29:

- Free plan supports SQLite-backed Durable Objects; `storage.kv` and
  `transactionSync` are supported for those classes.
- Durable Object requests: 100,000/day; WebSocket upgrade is a request; incoming
  messages bill at 20:1; outgoing messages/protocol pings are not billed.
- Durable Object duration: 13,000 GB-s/day, charged at 128 MB per object.
- Workers Free: 100,000 requests/day, 10 ms CPU per invocation, 128 MB isolate.
- Static assets and service bindings are available on the Free plan.
- Free limits fail closed rather than auto-upgrading the account.

This supports the Phase 1 capacity model; it does not prove the workload.

## 3. Integration points

| Requirement | Existing module/API | Planned integration |
|---|---|---|
| Authoritative simulation | `Game.tick()` in `src/sim/game.ts` | Room owns one `Game` with `localPlayerId = -1`, `enableAI = false`, and calls one tick per 50 ms schedule. |
| Command authority | `CommandGate` in `src/multiplayer/commandGate.ts` | Every decoded command goes through `submitText(seat, ...)`; no direct `enqueueCommand` from the transport. |
| Team wire state | `createTeamSnapshot` in `src/multiplayer/projection.ts` | The only payload sent to a seat. |
| Result | `evaluateMatchResult` in `src/multiplayer/matchResult.ts` | Evaluated by the room and included in the final result message. |
| Recovery | `createRoomSnapshot` / `restoreRoomSnapshot` | Snapshot chunks persisted to the room Durable Object. |
| Capacity | `CapacityClient`, `ReservationLease`, `CapacityCoordinator` | Room reserves before allocating its `Game` and releases on every close path. |
| Fixed-step clock | Phase 0 `runTick` pattern | Reuse the measured 50 ms wake-up with bounded catch-up; network timing never sets tick size. |

## 4. Topology

```text
Browser / Node client
        │  WSS + protocol subprotocol token
        ▼
mca-mp-dev Worker (separate staging, no production route)
        ├── /api/mp/rooms/:roomId/ws ──► MatchRoomDurableObject (one Game)
        ├── /api/mp/dev/rooms/* ───────► protected dev admin API
        └── static /  ─────────────────► development test client

MatchRoomDurableObject ──► CapacityCoordinator Durable Object ('global')
```

The Worker and both Durable Object classes are in one staging script. The
capacity namespace still has exactly one named object, `global`; the room never
uses a per-room counter.

## 5. Protocol (v1, minimal)

Client to server:

- `{"type":"command","v":1,"command":{...}}` — command body is the Phase 1 shape.
- No client-selected `team`, `playerId`, `owner` or `seat`.

Server to client:

- `hello` — room, seat, player, team, tick, phase, rates, deadline.
- `snapshot` — existing `TeamSnapshot` (`protocol: 1`).
- `commandAccepted` / `commandRejected` — stable code and safe message.
- `result` — team-relative projected result and outcome.
- `error` / `roomClosed` — structured, non-sensitive termination.

Limits: 4 KiB message cap, one command batch per 100 ms per seat, 20 messages/s
per seat, two seats, one socket per seat, 10 Hz snapshots, 20 Hz simulation.

## 6. Identity and auth (development scope)

This is not the production account system.

- Each seat gets an opaque 128-bit token when the dev room is created.
- Tokens are delivered to the client through the WebSocket subprotocol list, not
  the URL, so the room token is not in request paths/logs.
- The room resolves the seat and player/team from its persistent seat table.
  A token only grants one seat.
- Admin room creation/status/shutdown requires `MP_ADMIN_TOKEN`, never exposed in
  a browser bundle.
- `MP_ONLINE_ENABLED` is the kill switch: when not `1`, all new room/socket
  requests are rejected without affecting single-player.
- Origin is same-origin by default. `MP_ALLOW_NO_ORIGIN` exists only to let the
  Node validation harness connect; it is a staging setting, not production.

## 7. Lifecycle

1. Admin creates a room.
2. Room reserves global capacity and writes metadata/snapshot before replying.
3. Both clients connect; room starts the 20 Hz clock only when all seats are
   present.
4. Commands go through `CommandGate`; snapshots are built per team at 10 Hz.
5. Room heartbeats the lease every 20 s and persists a snapshot periodically.
6. Finish on neutral elimination, the configured time limit, seat abandonment,
   hard reservation deadline or reservation failure.
7. Send the final team-relative result, close sockets cleanly, persist the final
   snapshot and release the reservation exactly once.
8. Restore from persisted metadata/snapshot after object restart; all seats start
   disconnected and must reconnect with their original tokens.

## 8. Client integration decision

The production 3D renderer expects a complete local `Game` and an `App` session;
feeding it a projected snapshot would require a separate client simulation layer
that is outside this infrastructure milestone. Phase 2A therefore ships a
**dev-only tactical canvas client** served by the staging Worker. It uses the
authoritative snapshot for terrain, fog, entities, selection and commands, and
shows connection/ack/result state. It is not added to the production entry point.

This deliberately does not implement the lobby, account flow, public directory,
invites, chat, matchmaking, 2v2, or production rendering.

## 9. Test and deployment gates

- Unit/integration: room protocol, seat token/duplicate socket, forged authority,
  oversized messages, rate limits, hidden-payload checks, reconnect, abandonment,
  completion/deadline, persistence restore, reservation boundary.
- Local: actual `wrangler dev` Worker + two Node clients.
- Deployed: separate `mca-mp-dev` Worker; two clients complete a configured
  short match; concurrent create boundary; heartbeat/release; status counters.
- Full suite, typecheck and build.
- Report PASS / CONDITIONAL PASS / FAIL per acceptance criterion, with exact
  measured-vs-estimated resource accounting.

## 10. Known risks and blockers

- `MatchRoomDurableObject` is only reachable through the staging Worker; no
  production deployment is authorized by this phase.
- Exact Cloudflare dashboard request/duration accounting may not be exposed to
  the local tool; if unavailable, in-room counters plus published rates will be
  reported as estimates, not billed measurements.
- The room snapshot may be larger than one Durable Object value; persistence will
  be chunked and validated before use.
- 2v2 and account identity are intentionally out of scope.
