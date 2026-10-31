# MCA Multiplayer Phase 1 — Server Interfaces and Reservation Invariants

This is the implementation note for the Phase 1 server boundary. It is not a
production deployment guide. The feature flag remains disabled and no browser
code imports these modules.

## 1. Module map

| Module | Entry point | Purpose |
|---|---|---|
| `src/multiplayer/commandGate.ts` | `new CommandGate(game, seats, options)` | Validate a raw command against a trusted seat and enqueue it. |
| `src/multiplayer/projection.ts` | `createTeamSnapshot(game, team, sinceSeq?, result?)` | Build the only wire state a team may receive. |
| `src/multiplayer/matchResult.ts` | `evaluateMatchResult(game, { abandonedTeams? })` | Derive the authoritative neutral result. |
| `src/multiplayer/roomSnapshot.ts` | `createRoomSnapshot` / `restoreRoomSnapshot` | Server recovery record with strict validation. |
| `src/multiplayer/reservationPolicy.ts` | `DEFAULT_RESERVATION_POLICY`, `policyFromEnv` | Budget values and cost model. |
| `src/multiplayer/reservation.ts` | `ReservationLedger` | Atomic global reserve/heartbeat/release/reconcile/status. |
| `src/multiplayer/reservationDurableObject.ts` | `CapacityCoordinator`, `CAPACITY_COORDINATOR_NAME` | HTTP adapter and the one global object name. |
| `src/multiplayer/reservationClient.ts` | `CapacityClient`, `ReservationLease`, `activateReservedRoom` | Room-side calls and reserve-before-activate. |

## 2. Trusted seat contract

The transport owns seat authentication and passes only a `SeatAuthority`:

```ts
interface SeatAuthority {
  seatId: number;
  playerId: number;
  team: number;
  active: boolean;
}
```

Rules:

- `playerId` and `team` come from the room's seat table, never from a command.
- The gate re-reads the player's team and defeat state on every submission.
- Every selected entity must have `owner === seat.playerId`.
- Commands after `endMatch()` or a non-`playing` game state are rejected.
- A socket must call `submitText(seatId, rawText)`; bypassing the byte cap with a
  pre-parsed object is only for tests and trusted adapters.
- Rate limiting is per seat, at one batch per 100 ms by default.
- Missing, dead and foreign entity ids are one `not-your-entity` response.
  Missing and hidden attack targets are one `target-hidden` response. Do not
  split these codes; they become an entity-existence oracle.

## 3. Wire protocol

Command envelope (`v = 1`):

```json
{ "v": 1, "command": { "type": "move", "ids": [12], "x": 640, "z": 512 } }
```

The command body must contain only fields listed for its type in
`ALLOWED_FIELDS`. Envelope keys other than `v` and `command` are rejected.
`team`, `playerId`, `owner` and `seat` are explicitly forbidden.

Snapshot (`TeamSnapshot`, protocol 1) contains only:

- map terrain/elevation/ore;
- the recipient team's players, fog, contacts and charted ids;
- own/allied entities and currently visible enemies;
- charted enemy structures as remembered silhouettes;
- visible projectiles (hidden shooter id becomes `0`);
- visibility-filtered events;
- a team-relative result.

Do not add the authoritative `GameState`, `Scenario`, `state.ai` or the opposing
team's memory to this payload “for convenience”.

## 4. Result contract

`evaluateMatchResult` returns one result for the room:

```ts
{
  phase: 'playing' | 'finished',
  winnerTeam: 0 | 1 | null,
  reason: 'elimination' | 'time-limit' | 'draw' | 'abandoned' | null,
  teams: [{ team, playerIds, defeated, score }],
  tick
}
```

Each seat interprets it with `resultForTeam`, which returns
`playing`/`victory`/`defeat`/`draw`. The room stores this result in the snapshot;
it must not be accepted from a client. Existing single-player presentation still
uses `Game.evaluateVictory()` and is deliberately untouched.

## 5. Room snapshot contract

`RoomSnapshotV1` has format `mca-room-snapshot`, version `1`, source
`server-authoritative`, and a `simulation` payload in the existing `SaveData`
format. The envelope is separate from single-player saves; no multiplayer fields
are added to `SaveData`.

Restore rules:

- validate the entire envelope before constructing a `Game`;
- reject unsupported versions rather than guessing;
- require map dimensions/arrays, player/entity/projectile ids, references, fog
  arrays, seat/player/team relationships and result tick to agree;
- restore with `localPlayerId = -1` and `enableAI = false`;
- only the authoritative room object may call restore. Schema validation is not
  a signature or a substitute for storage access control;
- a future v2 must add a migration path.

## 6. Reservation invariants

### One ledger

All rooms address **one** Durable Object:

```ts
const id = env.CAPACITY.idFromName(CAPACITY_COORDINATOR_NAME); // 'global'
```

A room must not create a per-room or random capacity object. Doing so creates
independent ledgers and silently defeats the global cap.

### Reserve before activation

A room must use `activateReservedRoom(client, request, activate)` or perform the
same sequence:

1. `reserve(request)` succeeds;
2. construct/load the room and its game;
3. start accepting sockets;
4. persist the returned `ReservationRecord` for recovery.

If activation throws, release the lease with the conservative default charge.

### Heartbeat and hard stop

- Heartbeat at an interval comfortably below `staleAfterMs` (90 s default). A
  practical room should heartbeat every 20–30 s.
- The authoritative game must stop at `hardDeadlineAt` (30-minute default) and
  release the lease immediately.
- The coordinator rejects a heartbeat at/after the hard deadline with
  `match-expired`; the room must treat that as a shutdown instruction, not a
  retryable network error.

### Idempotent release

Release in a `finally`/shutdown path, including normal completion, abandonment,
quota failure and error shutdown. Repeating release returns
`alreadyReleased: true`; do not retry to “make sure” if the first call succeeded.

### Fail closed

If `reserve` returns any failure, or the transport throws, the room does not
activate and does not fall back to a local counter or a paid service. If
`heartbeat` fails with `reservation-store-unavailable`, the room must stop
accepting new online play until it can confirm state; single-player remains
usable independently.

### Accounting

- Duration uses 128 MB per active object.
- Incoming WebSocket messages are billed at 20:1; outgoing snapshots are not.
- The request projection applies the 10% safety margin after adding upgrades and
  lifecycle requests.
- Daily duration and request budgets are both checked.
- Stale/crashed reservations are charged conservatively to the observation day.
- Never call a billing API, purchase capacity or auto-upgrade on exhaustion.
  Exhaustion is an `online unavailable` condition.

## 7. Isolation

`MULTIPLAYER_FEATURE` remains disabled. The browser startup graph
(`src/main.ts`, `src/app.ts`, `vite.config.ts`) must not import these modules.
Phase 1 adds no lobby route, account flow, room directory, chat, invitation or
matchmaking UI, and performs no deployment.

## 8. Known limitation

The atomicity guarantee depends on Cloudflare Durable Object input gates and
`transactionSync` on the single global object. It has been exercised in local
`workerd` and in adapter tests, but not against a deployed free-tier namespace.
The next phase must test that property at deployment before online rooms are
exposed.
