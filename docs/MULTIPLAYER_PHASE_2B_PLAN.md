# Phase 2B — Playable Human 1v1 Multiplayer: implementation map

Status: audit complete; the two lifecycle blockers are resolved in Phase 2B.1
(see `MULTIPLAYER_PHASE_2B_1_LIFECYCLE_REPORT.md`). Client work — room discovery,
lobby configuration editing, nation/colour controls and the browser integration —
is still not started and remains the scope below.
Scope of this document: what already works, what is reusable, what must be built,
and the two lifecycle decisions that must be made before any client work starts.

Every claim below is from the current tree, not from earlier phase reports.

## 1. What already works (do not rebuild)

| Capability | Where | State |
| --- | --- | --- |
| Capacity reservation, two-room cap, daily allowance | `src/multiplayer/reservation*.ts`, `CapacityCoordinatorDurableObject` | Verified in Phase 2A, `200,200,503,200` |
| Room lifecycle, deadline, closure, guarded release | `src/multiplayer/roomDurableObject.ts` | Verified over five 30-minute soaks |
| Authoritative tick, CommandGate, rate limits | `src/multiplayer/roomMatch.ts`, `commandGate.ts` | Verified |
| Seat identity and bearer tokens | `PersistedMeta.seats[].token`, `authorizeSeat` | Verified |
| Team-filtered projection, fog, contacts, deltas | `projection.ts`, `teamDelta.ts`, `snapshotAssembler.ts` | Verified |
| Reconnect, epochs, resync, keepalive | `roomMatch.ts`, `protocol.ts` | Verified, including 12.6 s checkpoint-age recovery |
| Persistence and strict restore | `roomSnapshot.ts`, `snapshotReadback.ts` | Verified, including exact read-back validation |
| Match result, timeout, abandonment | `matchResult.ts` | Verified |
| Per-team colour override | `PlayerDef.color` (`scenario.ts:40`), `teamColorForOwner(owner, factionId, override)` (`render/teamColor.ts`) | **Already supported end to end** |
| Nation catalogue | `FACTIONS` (`data/factions.ts:147`), `isKnownFactionId` | Already used by skirmish |
| Map catalogue | `BUILTIN_SCENARIOS` (`data/scenarios.ts:370`), `builtinScenario(id)` | Already used by skirmish |
| Menu shell with a multiplayer panel | `index.html:191` (disabled nav item), `index.html:301` (`data-menu-panel="multiplayer"`), `MenuView` includes `'multiplayer'` (`app.ts:101`) | **Placeholder exists, empty** |

The colour and nation requirements of Phase 2B therefore need no new data model:
a lobby choice becomes `scenario.players[i].color` and `factionId`, and the
renderer already tints by them.

## 2. What is reusable directly by a browser client

`src/multiplayer/snapshotAssembler.ts` is plain TypeScript with no Worker
dependency and is already imported by Node tools. It is the client's
reconstruction reducer: `new SnapshotAssembler({ roomId, team })`,
`apply(message)`, `state()`. `tools/phase2a-raw-client.mjs` and
`src/multiplayer/devRoomClient.js` show the full client-side protocol loop
(connect with `mca.v2` + `mca.token.<seat token>`, keepalive with a 45 s ack
watchdog, resync on assembler rejection).

What does **not** exist: any browser code that renders a projected match.
The whole client currently renders a local `Game`. The renderer and HUD call
`game.state` 47 times plus ~17 query methods (`player`, `teamOf`,
`visionStateOf`, `isVisibleTo`, `isHostile`, `getEntity`, `entitiesOf`,
`contactsFor`, `garrisonOccupants`, `powerStatus`, `productionStatus`,
`productionEntries`, `stats`, `passiveMatsRate`, `matsPerMinute`, `reqRate`,
`radarNetwork`, `eventsAfter`). A `RemoteGame` adapter over the assembled
`TeamSnapshot` that implements exactly that surface is the cheapest path to a
playable in-browser match; it is roughly 250 lines and touches no renderer code.

## 3. What genuinely needs building

1. **Lobby state in the room.** Nothing exists. A room is created already
   playing-capable and the Game is constructed at creation
   (`roomMatch.ts:303-317`, `createIslandAssault()` hard-coded unless
   `options.game` is supplied).
2. **Lobby wire messages.** `protocol.ts` admits only `command`, `keepalive`,
   `resync` (`parseClientMessage` allowlist). Lobby needs a fourth client type
   and a server `lobby` message; the parser is field-allowlisted per type, so
   this is an additive change, but it is a **protocol version bump**.
3. **Public room discovery.** No directory exists. Needs a new Durable Object
   (no KV binding today, no paid service) holding `roomId -> {name, mapId,
   players, max, phase, public, updatedAt}`, written on create/lobby change/
   start/close and read by `GET /api/multiplayer/rooms`.
4. **Join-by-code and seat assignment for browsers.** Today the only way to get
   a seat token is an admin-token `POST /rooms/:id`, which returns both seats'
   tokens. A browser must receive exactly one seat token and never see the
   other's.
5. **Lobby UI.** Fill `data-menu-panel="multiplayer"` and enable the nav item:
   create, browse, join by code, host/guest seats, nation, colour, ready,
   host map/duration controls, start button, error states.
6. **In-match client.** `RemoteGame` adapter, command routing from the existing
   input path, result screen, and a safe return to the menu.

## 4. The two blockers that need a decision first

### Blocker A — a lobby room is not restorable

`MatchRoomDurableObject.load()` (`roomDurableObject.ts:333-360`) treats a
non-closed room as a started room: it calls `loadSnapshot()`, and a missing or
invalid snapshot sets `fatal`, permanently refusing sockets. A pre-match lobby
has no snapshot to load. So the moment a lobby room is evicted between create
and start, the room is dead — and that is the *normal* case, because a lobby is
idle by nature.

Any lobby therefore needs one of:

- **A1 (recommended).** Persist lobby state in metadata and make `load()`
  branch on `meta.started`: a not-started room restores its lobby and admits
  sockets in phase `waiting` without a snapshot. The first `persistSnapshot`
  happens at match start. This keeps the strict-restore path untouched for
  started rooms.
- A2. Keep creating the Game at room creation and rebuild it when the host
  starts. Rejected: it persists and restores a full simulation for a match that
  has not started, costs a snapshot per idle lobby, and makes "no state leaks
  before start" harder to prove.

### Blocker B — the first connect currently starts the match

`connect()` sets the phase to `playing` and the room stamps `startedAtMs`
(`roomDurableObject.ts:780-800`). Phase 2B requires: both seats connected,
both ready, valid config, then a host-triggered start, and the *deadline is
derived from the configured duration at start*. So start must become an
explicit, idempotent, server-authoritative transition that:

- validates occupancy, readiness, nations, distinct colours, map and settings;
- builds the scenario from the lobby configuration and passes it as
  `RoomMatchOptions.game` (the existing seam at `roomMatch.ts:303`);
- sets `startedAtMs` and the deadline from the chosen duration, never later
  than the reservation's hard deadline;
- persists the start (snapshot + meta) before either seat receives `playing`,
  mirroring the existing "persist before admitting" rule at
  `roomDurableObject.ts:352-368`.

Both blockers touch invariants that five soak phases were spent proving. They
are small, testable changes, but they are changes to the *shape* of the room
lifecycle, so they must land with regression tests before any UI is wired to
them.

## 5. Ordered plan

1. **Lobby phase in the room** (blockers A and B) with tests: create → lobby →
   both seats connect → config change → start → play → finish, plus
   evict-during-lobby recovery and close-during-lobby release.
2. **Lobby protocol** (version 3): client `lobby` (`{seatName, nation, color,
   ready}` / host `{mapId, durationMs, public}` / host `{start: true}`), server
   `lobby` snapshot. Server-side validation of every field against the
   catalogues, per-seat ownership, and a state vector so both clients converge.
3. **Room directory** Durable Object + `GET /api/multiplayer/rooms`, public-only,
   no tokens, no seat ids, TTL sweep on close.
4. **Browser entry and lobby UI** against the placeholder panel.
5. **`RemoteGame` adapter and in-match view**, command routing, result screen.
6. **Two-session playable verification**: two browser sessions, real lobby, real
   match, correct result.

## 6. Deliberate non-goals

- No changes to simulation, combat, balance, nations or their bonuses.
- No new paid services, no KV namespace, no external matchmaking.
- No change to the 30-minute hard maximum, the two-room cap or the daily
  allowance.
- No reuse of the admin token by browsers; host authority is a server-side role
  on seat 0, not a client claim.
- Colour is presentation only; it never alters vision, ownership or balance.
