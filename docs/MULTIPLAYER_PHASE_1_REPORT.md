# MCA — Multiplayer Phase 1 Report

**Project:** Modern Combined Arms (MCA)  
**Phase:** 1 — server-safe core, command gate, neutral results, room snapshots and global capacity reservations  
**Date:** 2026-10-29  
**Status:** **PASS for the local, testable implementation.** Nothing is deployed, no online
traffic is enabled, and no production atomicity or authentication claim is made.

---

## 1. Result in one paragraph

Phase 1 adds a transport-independent command boundary, default-deny team projection,
neutral two-team results, a separately versioned server snapshot and a global
Durable Object capacity ledger. All existing single-player and rendering paths are
untouched; the new modules are not imported by the browser application and remain
behind `MULTIPLAYER_FEATURE.enabled = false`. The focused Phase 1 suite (**46 tests**)
and the full repository suite (**836 tests in 80 files**) pass. `npm run build`,
which includes `tsc --noEmit`, the Vite production build and the service-worker
build, also passes. The reservation adapter was exercised in local `workerd`
through a real SQLite-backed Durable Object namespace, not only in a mock.

The remaining uncertainty is deliberate and explicitly reported: the atomic
guarantee is the documented single-object/input-gate/`transactionSync` property of
Cloudflare Durable Objects, not something this phase could prove on a deployed
Worker. No Pages/Workers deployment, production secret or free-tier billing
counter was used.

---

## 2. Baseline and preservation of the working tree

The repository was already a large uncommitted working tree on `master`. At the
start of the phase it contained gameplay, visual, audio, campaign, tutorial,
service-worker, `_headers`, unit-voice and Phase 0 changes. They were retained.
Nothing was staged, committed, reverted or cleaned. No Phase 0 prototype file was
imported into production code.

Baseline evidence:

- `git status --short` showed 43 modified tracked files and a large set of
  untracked files, including `phase0/`, `src/multiplayer/` (Phase 0 boundary work
  and this phase), campaign/tutorial files, and new tests.
- `MULTIPLAYER_PHASE_0_REPORT.md` was read and used as the source of the measured
  single-room workload and the published free-tier figures.
- `SECURITY-REVIEW.md` and `docs/MULTIPLAYER_READINESS_AUDIT.md` were read for the
  shell-hardening and multiplayer constraints.
- The existing simulation, command queue, fog memory, AI, victory evaluation,
  save/load, deterministic fixtures and service-worker tests were inspected and
  left unchanged.

The stale assertion in `tests/match-music.test.ts` was preserved. It now checks
for `response.status === 206`, while `public/sw.js` implements the equivalent
guard inside `isCacheable()` (`if (!response.ok || response.status === 206) return false`).
That is a correct assertion against the hardened worker, not a weakened test.
The edit pre-dates Phase 1 and was not reverted.

---

## 3. Files added or changed

### 3.1 New server-boundary modules

| File | Responsibility |
|---|---|
| `src/multiplayer/commandGate.ts` | Trusted-seat command ingress, allowlist, bounds, ownership, target knowledge, command preconditions and rate limit. |
| `src/multiplayer/projection.ts` | Default-deny `createTeamSnapshot()` for one team, including fog, contacts, charted memory and filtered events/projectiles. |
| `src/multiplayer/matchResult.ts` | Neutral team result (`evaluateMatchResult`) and per-seat interpretation (`resultForTeam`). |
| `src/multiplayer/roomSnapshot.ts` | Versioned server recovery envelope, validation and deterministic restore. |
| `src/multiplayer/reservation.ts` | Global capacity ledger: reserve, heartbeat, release, reconcile and status. |
| `src/multiplayer/reservationPolicy.ts` | Conservative cost model, policy validation and environment parsing. |
| `src/multiplayer/reservationClient.ts` | Room-side transport client, lease and reserve-before-activate helper. |
| `src/multiplayer/reservationDurableObject.ts` | Durable Object HTTP adapter and single global coordinator name. |
| `src/multiplayer/featureFlag.ts` | Explicit disabled feature state; browser code does not import it. |

### 3.2 New tests and fixtures

| File | Coverage |
|---|---|
| `tests/phase1-command-gate.test.ts` | Forged authority, ownership, hidden targets, unknown fields/types, bounds, rate limits, match end, placement/production/rally, oversized payload, existence-oracle regression. |
| `tests/phase1-projection.test.ts` | Own/visible entities, hidden enemy absence, resources/queues, charted structures, events/projectiles, both teams, 2v2 allies. |
| `tests/phase1-match-result.test.ts` | 1v1 and 2v2 elimination, both winners, draw, abandonment, time limit. |
| `tests/phase1-room-snapshot.test.ts` | Deterministic continuation, version/format/source rejection, map/entity/reference/seat validation. |
| `tests/phase1-reservation.test.ts` | Cost model, capacity boundary, idempotent retry/release, stale reclaim, store failure, daily budgets, duration cap, activation ordering and transport failure. |
| `tests/phase1-reservation-do.test.ts` | Token/config failure, HTTP reserve/status, concurrent boundary attempts, ledger-transaction failure, malformed input. |
| `tests/phase1-isolation.test.ts` | Feature flag disabled and no browser startup import of the server modules. |
| `tests/phase1-helpers.ts` | Authoritative no-local-player fixtures, hidden-entity helpers and 2v2 scenario extension. |

### 3.3 Documentation and local harness

- `MULTIPLAYER_PHASE_1_REPORT.md` — this report.
- `docs/MULTIPLAYER_PHASE_1_INTERFACES.md` — short implementation note covering server interfaces and reservation invariants.
- `tmp/phase1-workerd/` — untracked local `workerd` harness (`wrangler.jsonc`, `worker.mjs`, state, logs and response JSON). It is evidence, not a production deployment file.

No existing production source, dependency manifest, lockfile, deployment
configuration or single-player startup file was edited by Phase 1.

---

## 4. Implemented boundaries

### 4.1 Command gate

`CommandGate` accepts only this versioned envelope:

```json
{ "v": 1, "command": { "type": "stop", "ids": [12, 13] } }
```

The room supplies `SeatAuthority` from its own session/room table. The payload
cannot contain `team`, `playerId`, `owner` or `seat`; those produce
`forbidden-field` before parsing. A command's team is always copied from the
trusted seat.

Enforced limits and checks:

- no unknown envelope or command fields;
- allowlisted types only: `move`, `attack`, `stop`, `hold`, `stance`, `return`,
  `dive`, `capture`, `repair`, `garrison`, `ungarrison`, `produce`,
  `cancelProduction`, `reorderProduction`, `placeBuilding`, `setRally`;
- raw text payload at most **4 KiB**, measured before JSON parsing;
- at most **64** unique positive entity ids;
- finite, non-negative coordinates and map bounds;
- one accepted/attempted batch per seat per **100 ms**;
- every selected entity must be owned by the exact assigned player, not merely
  the same team;
- training, placement and rally preconditions are checked against the live
  authoritative game (`productionStatus`, `placementStatus`, `rallyStatus`);
- attack targets must be alive and visible; capture/repair/garrison targets must
  be known to the seat's team;
- command ingress closes after `endMatch()` or a non-playing victory;
- defeated players, mismatched seats, missing players and inactive seats are
  rejected.

Rejections use stable codes and safe messages. Missing, dead and foreign entity
ids deliberately share `not-your-entity`; a missing attack target and a hidden
live target share `target-hidden`. Without that unification, a client could
enumerate hidden entities by comparing rejection codes. This is covered by the
“cannot use rejection codes to discover hidden entities” test.

The gate is transport-independent and has no WebSocket, cookie, account or room
UI code. A future transport must call `submitText()` so the byte cap is applied
before parsing, and must pass the raw text rather than a pre-parsed object.

### 4.2 Team projection

`createTeamSnapshot(game, team, sinceSeq, result)` allocates a fresh
`TeamSnapshot`; it never serialises `GameState`, the `Scenario`, `state.ai`,
`rngState` or the opposing team's memory.

Included:

- static map dimensions, terrain, elevation and ore;
- only players on the recipient team;
- own/allied entities, and enemy entities currently visible to that team;
- charted enemy structures as remembered silhouettes with `hp`, `maxHp`, queue,
  state and construction set to `null`/absent;
- own/allied production queues and rally points only;
- own team's fog, contacts and charted ids only;
- visible projectiles; a hidden shooter's id is replaced by `0`;
- events filtered by team visibility, with hidden `entityId`/`targetId` removed;
- a team-relative result where the opponent's exact score is `null`.

Hidden enemy ids, coordinates, names, resources, queues and AI state are absent
from the serialised payload. The tests check the JSON string, not just object
fields, so a renderer that “would hide” an entity cannot rescue a leaked payload.

This is a projection of authoritative state. It is not authentication, and it is
not a client replica update protocol.

### 4.3 Neutral match results

`evaluateMatchResult()` derives `phase`, `winnerTeam`, `reason` and per-team
`playerIds`, `defeated` and `score` from authoritative players/entities. It does
not mutate `game.state.victory`, so the existing local-player victory/defeat
presentation is unchanged.

- A team is defeated only when every member is defeated, or the room has
  explicitly passed it as abandoned after reconnect grace.
- One defeated ally in 2v2 does not end the team or the match.
- Both teams defeated produces a draw.
- A scenario time limit uses remaining team hit points; ties are draws.
- Every seat can call `resultForTeam(result, team)` for a consistent
  `victory`/`defeat`/`draw`/`playing` value.

The authoritative result is computed by the room and stored in the room
snapshot. It is not accepted from a client.

### 4.4 Room snapshots

`RoomSnapshotV1` is a separate envelope:

```text
format: "mca-room-snapshot"
version: 1
source: "server-authoritative"
roomId, createdAt, tick
seats: [{ seatId, playerId, team, connected, abandoned }]
result: NeutralMatchResult
simulation: SaveData
```

The outer envelope has its own version. It deliberately reuses the existing
`SaveData` codec for the inner simulation state so simulation serialisation is
not forked; no multiplayer field is added to the single-player save schema or
scenario schema. The snapshot is only for authoritative room recovery; clients
never receive it.

Validation rejects:

- wrong format/version/source, malformed room id or timestamp;
- unsupported save versions or an incomplete scenario;
- map arrays with the wrong dimensions;
- malformed or duplicate player/entity/projectile ids;
- unknown definitions or owners;
- entity/projectile positions outside the map;
- invalid hit points, build progress, construction or queue state;
- dangling target/order/garrison/home references and invalid fog/contact/charted state;
- seat/player/team mismatches and result/team inconsistencies.

`restoreRoomSnapshot()` constructs `Game.fromSave(..., { localPlayerId: -1,
enableAI: false })`, clears the local player and AI controller, and leaves the
clock and command ingress to the room. A test saves/restores mid-match and
verifies identical state hashes after another 40 ticks of identical commands.

Version upgrades are not implemented yet. A future v2 must add an explicit
migration path; v1 validation rejects unknown versions instead of guessing.

### 4.5 Global capacity ledger

The ledger is a single global Durable Object addressed through
`CAPACITY_COORDINATOR_NAME = 'global'`. It is not a per-room counter and has no
in-memory fallback. Every read/check/write is inside
`storage.transactionSync()`, and Durable Object input gates serialise events for
the one object. If the transaction throws, the result is
`reservation-store-unavailable`; the room must not start.

Operations:

| Operation | Behaviour |
|---|---|
| `reserve` | Validates request, deduplicates `requestId`, rejects a reused id for a different fingerprint, rejects an already active room, enforces active-room, daily duration and daily request budgets, then writes one active record. |
| `heartbeat` | Rejects missing/released reservations, a hard-expired match, or an expired lease; otherwise renews the lease. |
| `release` | Idempotent. Charges actual duration/requests when supplied, otherwise the conservative reserved values. Frees the active slot. |
| `reconcile` | Releases reservations whose last heartbeat is older than `staleAfterMs`, or whose lease has expired; charges the conservative full reservation to the observation day. |
| `status` | Reconciles, then reports active rooms, reserved totals, used totals and remaining daily budgets. |

The HTTP adapter requires an `x-mca-reservation-token` header. Missing token is
a **503 configuration failure**, a wrong token is **403**, malformed input is
**400** and unknown routes are **404**. It never enables billing, upgrades an
account or calls a paid service. `nowMs` supplied in a request is overwritten by
the coordinator clock for reservation accounting.

---

## 5. Reservation budget assumptions

Values are defaults in `reservationPolicy.ts`; every one can be overridden by an
explicit environment variable and malformed overrides fail closed.

| Value | Default | Basis |
|---|---:|---|
| `maxActiveRooms` | 2 | Conservative operational cap, not a measured production guarantee. |
| `maxDailyDurationGbSeconds` | 10,400 | 80% of the published 13,000 GB-s/day free allowance used by Phase 0. |
| `maxDailyRequests` | 80,000 | 80% of the shared 100,000 requests/day Workers/Pages allowance used by Phase 0. |
| `maxMatchDurationMs` | 1,800,000 | 30-minute hard match cap. |
| `safetyMargin` | 1.1 | Adds 10% to projected request cost. |
| `staleAfterMs` | 90,000 | Missed-heartbeat reclaim window; the room must heartbeat well inside it. |
| `commandHzPerSeat` | 10 | 100 ms command-batch cap. |
| `snapshotHz` | 10 | Documented outgoing rate; outgoing snapshots are not billed. |
| `durationMb` | 128 | Cloudflare's 128 MB per-object duration allocation. |
| `upgradeRequestsPerSeat` | 1 | One WebSocket upgrade per connected seat. |
| `lifecycleRequests` | 8 | Reserve/heartbeat/release/lifecycle allowance. |
| `requestsPerIncomingMessage` | 20 | Cloudflare's 20:1 incoming WebSocket message billing. |

Projection formula for one room:

```text
incoming messages = seats × 10 Hz × duration seconds
billed requests   = ceil(incoming / 20) + upgrades + lifecycle
projected         = ceil((billed requests) × 1.1)
```

For a 30-minute four-seat room:

```text
duration = 1,800 s × 0.128 GB/s = 230.4 GB-s
requests = ceil(((4 × 10 × 1,800) / 20 + 4 + 8) × 1.1) = 3,974
```

Two active rooms therefore reserve 460.8 GB-s and 7,948 requests, leaving most
of the daily envelope. The default cap of two is intentionally below what the
daily arithmetic alone might allow; the daily ledger is the second gate. The
number two is a policy choice for an undeployed service, not a claim that two
production rooms have been measured.

A four-hour, two-room example (not measured) would reserve about 3,686 GB-s and
63,368 requests, still inside the 80% daily envelope. Sequential rooms continue
to be checked against the same day's used totals.

---

## 6. Verification

### 6.1 Automated tests

```text
npm test
Test Files  80 passed (80)
Tests       836 passed (836)
Duration    113.51 s
```

```text
npx vitest run tests/phase1-command-gate.test.ts tests/phase1-projection.test.ts \
  tests/phase1-room-snapshot.test.ts tests/phase1-reservation.test.ts \
  tests/phase1-reservation-do.test.ts tests/phase1-match-result.test.ts \
  tests/phase1-isolation.test.ts
Test Files  7 passed (7)
Tests       46 passed (46)
```

```text
npm run build
tsc --noEmit && vite build && node tools/build-sw.mjs
BUILD_EXIT=0
```

The Vite build reports the pre-existing chunk-size warning (650.61 kB main JS);
it is not a failure and is unrelated to Phase 1.

### 6.2 Local `workerd` reservation run

A dedicated local Worker imported `CapacityCoordinator` and routed every request
to `env.CAPACITY.idFromName('global')`. It ran under Wrangler 4.156.0, local mode,
SQLite-backed Durable Object storage, compatibility date `2026-10-01`.

| Step | Observed |
|---|---|
| Reserve 1v1 room | `r1`, active rooms 1, reserved 230.4 GB-s / 1,991 requests |
| Retry same request | `created: false`, same `r1` |
| Reserve 2v2 room | `r2`, active rooms 2, reserved 460.8 GB-s / 5,965 requests |
| Reserve third room | `capacity-full` |
| Release `r1` (60,000 ms, 500 requests) | `alreadyReleased: false`, used 7.68 GB-s / 500 requests, active rooms 1 |
| Status after release | active rooms 1; remaining 10,161.92 GB-s / 75,526 requests |

This proves the adapter and synchronous SQLite storage contract run in actual
`workerd`, not only in the unit-test storage mock. The concurrent-boundary test
is in the Durable Object adapter test; the local HTTP run itself was sequential.
No deployed Cloudflare account was involved.

The ephemeral harness and response files are in `tmp/phase1-workerd/`. The
server was stopped after the run.

### 6.3 Checks not performed

- No deploy, no Pages Function, no production service binding and no production
  account/billing counter were used.
- No WebSocket transport for `CommandGate` exists yet.
- No room object calls `CapacityClient` yet; the reserve-before-activate helper
  is tested, not wired to a live room.
- No actual free-tier quota exhaustion was induced; store failure and budget
  exhaustion are tested through explicit policy and a throwing storage mock.
- No multi-minute soak was repeated in Phase 1. Phase 0's 30-minute single-room
  evidence remains the runtime benchmark.

---

## 7. Acceptance matrix

| Requirement | Status | Evidence |
|---|---|---|
| Inspect and preserve baseline | **PASS** | Baseline recorded; no revert/stage/commit; unrelated changes retained. |
| Versioned CommandGate with trusted seat authority | **PASS (local)** | 12 tests: forged authority, ownership, hidden target, bounds, payload, rate limit, match end, preconditions. |
| Reject unknown fields and malformed payloads | **PASS** | Envelope allowlist, command allowlist, JSON/object checks, 4 KiB pre-parse cap. |
| Validate exact player ownership | **PASS** | Ownership is by `playerId`, not team; foreign ids rejected. |
| Validate target knowledge / visibility | **PASS** | Attack visible; capture/repair/garrison known; existence-oracle regression. |
| Stable rejection codes without hidden information | **PASS** | Missing/hidden selection and target cases share codes; serialized error messages omit ids. |
| Per-team projection | **PASS** | 6 projection tests both teams, 2v2, hidden payload checks. |
| Remembered structures and filtered events/projectiles | **PASS** | Charted silhouettes with no live state; hidden events/projectiles absent; hidden shooter id redacted. |
| Neutral 1v1/2v2 results | **PASS** | 6 result tests, each team perspective, abandonment, draw, time limit. |
| Server-owned versioned snapshot | **PASS (design + local)** | Strict v1 validation; deterministic continuation test; separate envelope. |
| Client cannot overwrite authoritative room state | **PASS (schema boundary)** | `source`/format validation rejects client-shaped envelopes; only the room object is intended to write snapshots. This is not a cryptographic signature. |
| Global capacity/duration reservation | **PASS (local design)** | Single named DO, transactionSync, reserve/heartbeat/release/reconcile/status; local workerd run. |
| Atomic boundary under concurrency | **PASS (adapter test) / INCONCLUSIVE (deployed)** | Concurrent adapter test accepts exactly 2 of 4; production atomicity relies on Cloudflare's single-object input gates and is not deployed-verified. |
| Duplicate retry and idempotent release | **PASS** | Dedup by request id/fingerprint; release returns `alreadyReleased`. |
| Stale/crash reconciliation | **PASS (local)** | Reconcile releases beyond stale lease; test reclaims capacity and charges the conservative reservation. |
| Fail closed on store/quota failure | **PASS (local)** | Throwing storage -> `reservation-store-unavailable`; daily budgets -> explicit rejection; DO token missing -> 503. |
| Hard maximum match duration | **PASS** | Reservation rejects > 30 min and heartbeat rejects at the hard deadline. The room must also stop at that deadline; no production room loop exists yet. |
| No paid fallback or automatic upgrade | **PASS (structural)** | No billing client, paid binding or account-upgrade call in the new code; failures reject online activity. |
| Single-player unaffected | **PASS** | No browser import of multiplayer modules; isolation test; full suite and build pass. |
| Existing checks pass | **PASS** | 836/836 tests, typecheck, build. |
| Deployment/integration boundaries respected | **PASS** | No deploy, no production route, no lobby/account UI, feature flag disabled. |

### Completion gate

The local Phase 1 completion gate is **PASS**: the command gate, projection,
neutral results, snapshots and global reservation design are implemented and
tested; the single-player path is intact; all checks pass. This is explicitly a
**local implementation pass**, not a production-security or free-tier-atomicity
certification. A future deployment phase must verify the same invariants against
the deployed Durable Object namespace before exposing online rooms.

---

## 8. Risks and unresolved questions

1. **Production atomicity is unproven.** The design requires one global object
   name, Durable Object input gates and `transactionSync`. A future room Worker
   that creates its own object name or bypasses the coordinator would defeat the
   limit. The name is now exported as `CAPACITY_COORDINATOR_NAME`, but a code
   review and deployment test are still required.
2. **The coordinator token is service authentication, not user authentication.**
   It is not a substitute for guest sessions or account identity. Never expose it
   to a browser.
3. **No room object exists in production.** Heartbeat cadence, hard-deadline
   shutdown, release-in-finally and reconnect grace are documented obligations,
   not integrated behavior. `activateReservedRoom()` is the tested reserve-first
   helper; the eventual room must use it and release on every exit path.
4. **Stale reconciliation is conservative.** A crashed room is charged its full
   reserved match duration and requests, which protects the budget but can
   under-count a room that ran longer than requested. The hard deadline prevents
   a room from extending its reservation indefinitely.
5. **Daily accounting uses coordinator wall-clock UTC days.** A room crossing
   midnight is reserved against the observation day on stale release. This is
   conservative but not a substitute for Cloudflare's actual billing-day
   observation.
6. **Snapshot validation lacks a signature.** It proves schema integrity and
   server authorship intent, not origin. Only the authoritative room object must
   be allowed to read or write its storage.
7. **Free-tier figures are inherited, not re-measured.** The budget inputs come
   from the official pages cited in the Phase 0 report, accessed 2026-10-29.
   Free-plan terms can change; no paid overflow is configured.
8. **No production performance measurement.** Phase 0's single-room figures
   remain the evidence for shape of load. Two concurrent production rooms were
   not measured.
9. **Snapshot inner state reuses `SaveData`.** If the single-player save format
   changes, the room snapshot version must adopt an explicit migration or stay
   on a compatible save version; otherwise v1 restore fails closed.
10. **Command UX revalidation.** The gate validates against authoritative state
    at ingress, but the simulation may still reject a command due to a race in
    the same tick. That is a normal authoritative rejection, not a security
    failure, and should be represented by an acknowledgement in the transport.

---

## 9. Recommendation

**Proceed to Phase 2: a single-room Worker integration that uses this gate,
projection, neutral result and reservation lease behind the disabled feature
flag.** Do not build the public directory or account UI yet.

The next phase must demonstrate, against a deployed Worker:

1. one global capacity object name and a deployment-time test that two room
   starts cannot both take the last slot;
2. reserve-before-activate, periodic heartbeat, hard-deadline shutdown and
   idempotent release in the real room lifecycle;
3. a WebSocket transport that calls `submitText()`, authenticates seats before
   assignment and never accepts a client-supplied player/team;
4. the same team-projection leak tests over the actual wire, plus reconnect and
   snapshot recovery;
5. graceful `online unavailable` behavior when the coordinator or quota fails,
   with single-player still loadable.

Only after those gates pass should Phase 3 add room discovery, invitations and
optional accounts.
