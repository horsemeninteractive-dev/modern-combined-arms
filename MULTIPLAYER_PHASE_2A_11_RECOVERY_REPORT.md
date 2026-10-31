# MCA — Phase 2A.11: Durable Restart Recovery and Epoch Continuity

**Status: PASS — the targeted restart-recovery defects are fixed and verified on the isolated staging Worker. Seat generations survive restoration, stale pre-restart messages are rejected, start time and the hard deadline remain continuous, both seats recover without a live rejection window, and the match completes with a released reservation.**

**The 10 ms individual-tick CPU target remains UNVERIFIED.** No CPU or per-tick profiling was performed in this phase.

## 1. Summary

Phase 2A.10 exposed two deterministic recovery defects after a Durable Object runtime restart:

1. `RoomSnapshotV1` did not persist each seat's sync generation (`epoch`/`seq`), so a restored room started at epoch `0`. The client requires a strictly newer epoch and rejected 363 valid sync/delta updates for about 20.13 seconds. One client also received `resync-rate-limited`.
2. The match start time was not restored, so the restarted room reported a start time near the restart and diagnostics showed only the post-restart tick count (`14,922`, not the whole match).

Phase 2A.11 fixes both and closes the adjacent consistency gaps found while tracing the lifecycle:

| Area | Before | After |
| --- | --- | --- |
| Seat generation | Reset to `0` on restore | Persisted in snapshot v2; occupied seats restore above their previous high-water mark |
| Stale authority | A pre-restart socket could not be distinguished from a restored one by generation | Seats restore above the old generation; socket identity is still checked on every message |
| Match start | Reset to restore time | Persisted in snapshot timing and room metadata; original start restored |
| Hard deadline | Already anchored to the reservation | Unchanged; restoration cannot move or extend it |
| Tick diagnostics | Post-restart `this.ticks` reported as the tick total | `ticks` = whole authoritative `game.state.tick`; `processTicks` = ticks since load |
| Snapshot writes | Could overlap across awaits | Serialized through one write chain, so a newer generation cannot be overwritten by an older writer |
| Persisted metadata | Loosely checked | Explicit validation of timing, seats, reservation and tick fields before use |
| Recovery failure | Snapshot write failure after restore was logged and sockets were still admitted | A restore whose fenced generation cannot be persisted fails closed before admission |

The final deployed forced-restart run recovered both seats in **434 ms**. Both preserved client reducers accepted the restored baseline and the next delta immediately. The only rejected updates were four deliberately replayed pre-restart messages, all rejected as `epoch-mismatch`:

| Measurement | Result |
| --- | ---: |
| Pre-restart seat epochs | `1, 1` |
| Restored seat epochs | `1026, 1026` |
| Restart requested → sockets closed | 105 ms |
| Restart requested → seat 0 restored sync | 378 ms |
| Restart requested → seat 1 restored sync | 490 ms |
| Restored sync → next accepted delta, seat 0 / seat 1 | 7 ms / 31 ms |
| Both seats reconnected and commanded | 434 ms |
| Live post-restart update rejections | **0** |
| Deliberately replayed stale messages rejected | **4** (2 per seat) |
| Match start before / after | `1793398840606` / `1793398840606` |
| Deadline before / after | `1793398885348` / `1793398885348` |
| Final result | seat 0 `victory`, seat 1 `defeat`, `time-limit`, tick 851 |
| Final client / server tick | `851 / 851` |
| Reservation | **released** |

## 2. Root cause confirmation

### 2.1 Epoch reset

Confirmed in the Phase 2A.10 source and retained as the initial condition for this phase:

- `RoomSnapshotV1` stored only `seatId`, `playerId`, `team`, `connected` and `abandoned` for each seat.
- The old `RoomMatch` constructor initialised each seat with `epoch: 0`.
- `restoreRoomMatch` rebuilt the match from the snapshot but had no durable per-seat generation to apply.
- `sendSync` increments the generation once per sync. The client assembler requires `message.epoch > currentEpoch`; a restored sync at a lower epoch is rejected, and deltas from another generation are rejected as well.
- Repeated full syncs eventually climbed past the client's old epoch, producing the 20.13 s recovery window and the resync rate-limit collision.

The fix does **not** relax the client check. It restores a durable high-water mark and opens a fenced generation above it.

### 2.2 Start-time reset

Confirmed:

- `restoreRoomMatch` constructed the room with `now` as the effective start because no start was persisted.
- `handleStatus` reported that reconstructed `startedAtMs`, and `RoomMatch.status().stats.ticks` used the in-process tick counter rather than `game.state.tick`.

The hard deadline was already the reservation's `hardDeadlineAt` and was not moved by the old code. The defect was diagnostic continuity: elapsed time and the whole-match tick count were wrong after a restart, even though the deadline and final result were correct.

## 3. Recovery schema and migration

### 3.1 Version 2 schema

`src/multiplayer/roomSnapshot.ts` now defines:

```ts
interface RoomSeatSnapshot {
  seatId; playerId; team;
  connected; abandoned;
  everConnected: boolean;
  disconnectedAt: number | null;
  epoch: number;
  seq: number;
}

interface RoomTimingSnapshot {
  startedAtMs: number | null;
  finishedAtMs: number | null;
}
```

The envelope is `mca-room-snapshot` version `2`. `version: 1` remains an explicit migration input; other versions are rejected with `unsupported-version`.

### 3.2 Migration from version 1

`validateRoomSnapshot` detects v1 and converts it to the v2 in-memory shape:

- A seat that was connected, abandoned, or belongs to a match that had started is treated as occupied.
- An occupied migrated seat receives `epoch = 100_000_000` (`LEGACY_EPOCH_FLOOR`) and `seq = 1`. This is deliberately far above any v1-era generation, so a v1 client cannot collide with it.
- A never-occupied seat remains `epoch = 0`, `seq = 0`.
- v1 has no disconnect timestamp; an unconnected but occupied migrated seat is stamped with the snapshot `createdAt`.
- A v1 playing snapshot has `startedAtMs = null`; the Durable Object derives the planned start from the durable reservation deadline minus the fixed match duration and marks `startedAtDerived = true`.
- A v1 finished snapshot derives `finishedAtMs` from its `createdAt`.
- The next checkpoint writes version 2.

The migration is intentionally one-way. A v2 room never writes v1 fields.

### 3.3 Validation and fail-closed rules

The snapshot validator now rejects, among other cases:

- missing or malformed `timing`, seats or epochs;
- an occupied seat at epoch `0`;
- an epoch with a zero sequence;
- a connected seat with `everConnected: false` or a disconnect timestamp;
- a never-connected seat carrying recovery state;
- negative, non-integer or out-of-range epochs or sequences;
- a playing result with a finish time, or a finished result without one;
- a finish before the start;
- a start after the supplied durable deadline;
- a tick that does not match the simulation state or the snapshot index;
- an unsupported format/version or malformed simulation/result payload.

`MatchRoomDurableObject` separately validates the persisted room envelope before it can supply a deadline or start fallback. It rejects malformed reservation deadlines, a released reservation on an open room, invalid seat identities/tokens, a start after the deadline, a finish before the start, and negative tick totals.

## 4. Epoch lifecycle and stale authority

### 4.1 Restore fence

`src/multiplayer/roomMatch.ts` defines `RESTORE_EPOCH_ADVANCE = 1024`.

- The persisted snapshot is a high-water mark, not the live generation.
- Each occupied seat is restored at `snapshotEpoch + 1024`.
- The first `connect` then opens a sync and increments once more. In the deployed run, snapshot epoch `1` became `1026`.
- The 1024 gap is many times the number of syncs that can be issued inside the 15 s persistence interval at the protocol's 10 Hz update limit.
- A repeated restart applies the fence again to the newly persisted generation. The local repeated-restart test verifies this.
- If `epoch + 1024 + 1` would exceed the protocol's 31-bit maximum, restoration fails closed instead of wrapping or reusing a generation.

### 4.2 No default authority for an occupied seat

If a snapshot says a seat is part of an active room but has no durable generation, `RoomMatch` now throws rather than restoring it at `0`. The Durable Object marks the room unavailable. This is covered by a negative test.

### 4.3 Stale sockets and delayed messages

- `RoomMatch.receive` still checks `seat.socket === socket`. A pre-restart socket object cannot issue commands after restore.
- A pre-restart sync is rejected by the client as `epoch-mismatch`; a pre-restart delta is also rejected as `epoch-mismatch`.
- Duplicate and out-of-order deltas remain rejected by the assembler's sequence rules.
- The deployed forced-restart run replayed the saved pre-restart sync and delta through each preserved client reducer. All four were rejected as `epoch-mismatch`; no live restored update was rejected.

### 4.4 Persistence consistency

`MatchRoomDurableObject.persistSnapshot` now queues writes through a single promise chain. This prevents two overlapping writers from indexing generations out of order after an `await`. The restore checkpoint is awaited before timers and sockets are admitted; if it fails, the room reports `room-state-unavailable` rather than running with an unpersisted fence.

## 5. Match timing and deadline semantics

### 5.1 Durable start

- The first authoritative start is written to the snapshot `timing.startedAtMs` and to `PersistedMeta.startedAtMs` at the start checkpoint.
- `RoomMatch` keeps `startedAtMs` for the life of the room and writes it on every snapshot.
- `restoreRoomMatch` prefers the snapshot start, falls back to validated room metadata, and only derives `deadline - duration` when neither exists (the v1 path). `startedAtDerived` records that fallback in status.
- The deployed run reported the same start before and after restart: `1793398840606` (`2026-10-30T22:20:40.606Z`), with `startedAtDerived: false`.

### 5.2 Deadline

- `matchDeadlineAt` comes only from the reservation's `hardDeadlineAt`.
- Restore never recomputes or extends it.
- The deadline timer is armed from the durable deadline after restoration.
- The deployed run's deadline was `1793398885348` before and after the restart and the final result arrived at that deadline.
- A restored room already past its deadline closes on the next request or timer.
- `RoomMatch` rejects a restored start after the deadline.

### 5.3 Grace periods and abandonment

- A seat that was connected at snapshot time has no persisted disconnect time; the restart begins its reconnect grace at `restoredAtMs`.
- A seat that was already disconnected keeps its durable `disconnectedAt`, so a pending grace period continues rather than restarting.
- The local test restores a room with a 500 ms abandonment grace and verifies the match remains playing before expiry and finishes as `abandoned` at expiry.
- The existing 30 s production grace is unchanged.

### 5.4 Tick diagnostics

`RoomMatch.status()` now reports:

- `stats.ticks` = `game.state.tick` — the whole authoritative match.
- `stats.processTicks` = `this.ticks` — ticks executed by the current object process since load.

`handleStatus` exposes both under `matchTiming.totalTicks` and `matchTiming.processTicks`. The post-restart run reported `totalTicks: 303` and `processTicks: 4`; the old code would have reported `4` as the tick total.

## 6. Implementation map

| File | Change |
| --- | --- |
| `src/multiplayer/roomSnapshot.ts` | Version 2 snapshot schema, v1 migration, strict seat/timing validation, deadline/start consistency |
| `src/multiplayer/roomMatch.ts` | Durable restored seats, 1024-generation fence, overflow/missing-generation fail-closed, start/finish timing, whole-match tick status, restore start resolution |
| `src/multiplayer/roomDurableObject.ts` | Durable meta timing/tick fields, meta validation, restore checkpoint before admission, serialized snapshot writes, status timing fields |
| `src/multiplayer/roomWorker.ts` | Staging-only `POST /restart` route for forced-restart verification, build marker `phase2a11-staging` |
| `src/multiplayer/snapshotAssembler.ts` | **Unchanged** strictly-newer epoch and sequence validation |
| `tests/phase2a11-recovery.test.ts` | 14 focused recovery, migration, stale-authority and metadata tests |
| `tools/phase2a11-forced-restart.mjs` | Deployed two-seat forced-restart verification harness |

The wire protocol remains `mca.v2`. No snapshot, delta, result, keepalive or command message shape changed. The snapshot envelope is an internal persistence record, not a client protocol message.

## 7. Automated verification

### 7.1 Focused recovery suite

`tests/phase2a11-recovery.test.ts`: **14 / 14 passed**.

Covered:

1. Create, assign both seats, persist, restore and reconnect both seats.
2. Restored epochs are valid and strictly above the pre-restart generation.
3. A stale pre-restart socket cannot issue an accepted command.
4. A delayed pre-restart sync or delta cannot mutate client state.
5. Legitimate post-restart commands are accepted.
6. Snapshot and delta sequencing after restore (`base === sync.seq`).
7. Fog, static map and exact team-view reconstruction after restore.
8. The original match start survives restoration.
9. The hard deadline is not extended.
10. Restoration near the deadline produces the correct result lifecycle.
11. Reconnect and abandonment grace retain their semantics.
12. v1 migration and malformed/unsupported snapshot handling.
13. Repeated restarts advance the generation again without resetting start time; corrupt room metadata is rejected.
14. A waiting-room restore with a durable start cannot move that start when its seats connect.

The suite also checks:
- active seat with no durable generation → fail closed;
- exhausted generation → fail closed;
- first legitimate resync after restore is accepted, immediate repeat is `resync-rate-limited`, a later resync is accepted.

### 7.2 Regression suites

| Check | Result |
| --- | --- |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** (production browser build; 82 modules, 665.08 kB JS) |
| `npx vitest run` | **959 passed / 959 tests, 96 files** |
| Focused recovery + snapshot + room + sync + keepalive set | **46 passed / 46 tests** |

The full suite includes the existing Phase 2A protocol, projection, delta, capacity, reservation, keepalive, CommandGate and fog-integrity tests. No simulation, pathfinding, combat, balance, protocol or UI test was changed to accommodate this phase.

## 8. Staging deployment identity

| Property | Value |
| --- | --- |
| Worker | `mca-multiplayer-staging` |
| URL | `https://mca-multiplayer-staging.horsemeninteractive.workers.dev` |
| Active version | `b1030bee-2c89-4a23-addd-f1567b0d818b` |
| Tag | `phase2a11` |
| Message | Phase 2A.11: durable epochs and continuous match timing (start-preservation) |
| Version created | `2026-10-30T22:19:03.297Z` |
| Deployment created | `2026-10-30T22:19:04.614Z` |
| Worker build marker | `phase2a11-staging` |
| Health snapshot version | `2` |
| Source HEAD | `132ccc8363d5b5bc98b6518b4afd1738dedaad6a` |
| Branch | `master` |
| Working tree | 151 modified/untracked paths; pre-existing work preserved, nothing staged or committed |
| Deployed artifact | `b5081f68a578b1b9af1def18ff889be30620f0a4d84d7d4d7b8227ebfd02396e *dist-mp-room/roomWorker.js` |

The final source file hashes are recorded in `staging-evidence/phase2a11-deployment.txt`. The deployed bytes match the local artifact.

Safety state was unchanged:

- `MULTIPLAYER_FEATURE.enabled = false`, `roomDiscovery = false`, `accountLinking = false`.
- Maximum active rooms remains `2`.
- Daily capacity allowance unchanged.
- 30-minute hard match deadline unchanged.
- No production deployment, capacity increase, public lobby, account path, paid service, billing change or plan upgrade.
- No change to the authoritative simulation, combat, pathfinding, navigation batching or game balance.

## 9. Deployed verification

### 9.1 Fifteen-check protocol/security smoke

`node tools/phase2a-deployed-smoke.mjs`: **15 / 15 checks passed**.

- 101 upgrade; two seats connected.
- Team projections isolated; valid command accepted; forged authority rejected.
- Oversized frame rejected; wrong token 401; foreign Origin 403; duplicate seat 409.
- Resync checkpoint applied in 18 ms.
- Reconnect accepted on a new epoch.
- Delta carried no map or full state.
- Result delivered to both seats.
- Reservation released.
- Global capacity boundary enforced.

Bandwidth samples from the same run:

| Measurement | Value |
| --- | ---: |
| Initial sync | 58,967 B |
| First delta | 365 B |
| Resync | 18 ms |
| Static map repeated in delta | **No** |

This preserves the Phase 2A.4 static-map/fog-delta optimisation.

### 9.2 Lifecycle and capacity

`node tools/phase2a1-failure-tests.mjs`: **6 / 6 checks passed**.

| Check | Result |
| --- | --- |
| Reconnect | PASS — epoch 2, recovery 89 ms, reservation released |
| Permanent disconnect / abandonment | PASS — `victory`, `abandoned` after 30,091 ms, released |
| Controlled shutdown | PASS — `room-shutdown`, released |
| Hard deadline | PASS — both seats `draw`, tick 194, elapsed 9,742 ms, released |
| Explicit resync | PASS — epoch 2, recovery 21 ms, next delta base correct |
| Capacity boundary | PASS — statuses `200, 200, 503, 200`, `capacity-full`, released slot reused |

This is the required established `200, 200, 503, 200` sequence.

## 10. Forced restart evidence

### 10.1 Method

`tools/phase2a11-forced-restart.mjs`:

1. Creates a 45 s two-seat staging room.
2. Connects both raw clients and preserves each `SnapshotAssembler` across the restart.
3. Issues one accepted move command per seat.
4. Waits 16.5 s so at least one 15 s periodic checkpoint exists.
5. Calls the staging-only admin `POST /restart`, which invokes `DurableObjectState.abort()`.
6. Reconnects both seats with a bounded retry loop.
7. Applies the restored sync, the next delta and a post-restart command to the **preserved** reducer.
8. Replays the saved pre-restart sync and delta to prove stale rejection.
9. Waits for the original deadline and verifies both results, final ticks and reservation release.

### 10.2 Timeline

| Event | UTC | Delta |
| --- | --- | ---: |
| Match start | `22:20:40.606` | — |
| Pre-restart status (tick 334) | `22:20:57.352` | — |
| Restart requested | `22:20:57.354` | 0 ms |
| Both sockets closed | `22:20:57.459` | +105 ms after request (106 ms in harness record) |
| Seat 0 restored sync | `22:20:57.732` | +378 ms after request |
| Seat 0 next delta accepted | `22:20:57.739` | +7 ms |
| Seat 0 command accepted | `22:20:57.755` | +16 ms |
| Seat 1 restored sync | `22:20:57.844` | +490 ms after request |
| Seat 1 next delta accepted | `22:20:57.875` | +31 ms |
| Seat 1 command accepted | `22:20:57.893` | +18 ms |
| Both seats reconnected and commanded | — | **434 ms** from post-close reconnect start |
| Final result | `22:21:25.342` | original deadline `22:21:25.348` |

### 10.3 State continuity

| Property | Before restart | After first restored sync | Delta |
| --- | ---: | ---: | --- |
| Start | `1793398840606` | `1793398840606` | 0 |
| Deadline | `1793398885348` | `1793398885348` | 0 |
| `startedAtDerived` | false | false | — |
| Room tick | 334 | 299 | −35 |
| Seat 0 epoch | 1 | 1026 | +1025 |
| Seat 1 epoch | 1 | 1026 | +1025 |
| Restored sync seq | — | 151 | — |
| Next delta seq / base | — | 152 / 151 | — |

- The 35-tick rollback (1.75 s) is the age of the latest 15 s periodic checkpoint. It is bounded by the unchanged snapshot interval, not by the epoch/timing fix.
- The server reported `totalTicks: 303` and `processTicks: 4` after the restored process had advanced. Before the fix, `303` would have been reported as `4`.
- Both restored clients ended at tick `851`; the server closed at tick `851`. Both seats received `victory` / `defeat`, `time-limit`, tick `851`.
- The final room status reported `closed: true`, `match-finished`, `reservation.status: released`.

### 10.4 Diagnostic early-restart run

A first pilot restarted the room only ~2.1 s after creation, before any periodic checkpoint. It restored the initial tick-0 snapshot, rolled back 33 ticks, and still completed the epoch recovery correctly:

- pre epochs `1, 1`; restored epochs `1026, 1026`;
- preserved client reducers accepted the restored sync;
- no live update rejections;
- rollback 33 ticks, consistent with initial-checkpoint age.

The pilot was not used for the pass verdict because the cleanup assertion expected a periodic checkpoint. Its evidence is retained at `staging-evidence/phase2a11-restart-2026-10-30T22-05-04-621Z/`.

## 11. Acceptance assessment

| Criterion | Status | Evidence |
| --- | --- | --- |
| 1. Seat epochs survive restoration and remain monotonically valid | **PASS** | Local tests + deployed epochs `1 → 1026` |
| 2. Stale pre-restart authority is rejected | **PASS** | Old socket command rejected; 4 replayed messages `epoch-mismatch` |
| 3. Legitimate post-restart connections resume | **PASS** | Both seats synced and commanded within 434 ms |
| 4. Clients accept restored state and subsequent updates without prolonged rejection | **PASS** | 0 live rejections; first delta 7/31 ms after sync |
| 5. Resynchronisation works without weakening protections | **PASS** | First post-restore resync accepted; immediate repeat rate-limited |
| 6. Match elapsed time and original hard deadline survive restoration | **PASS** | Identical start and deadline before/after; final at deadline |
| 7. Snapshot migration and invalid-data handling covered by tests | **PASS** | v1 migration, malformed, unsupported, missing generation, overflow, metadata tests |
| 8. Both seats complete deployed staging lifecycle correctly | **PASS** | Forced-restart room: both results, tick 851, closed |
| 9. Reservations released exactly once | **PASS** | Final status released; release is guarded and ledger idempotent; existing reservation tests pass |
| 10. Security, capacity and bandwidth intact | **PASS** | 15/15 smoke; 6/6 lifecycle; `200, 200, 503, 200`; delta 365 B, no map |
| 11. TypeScript, production build and full test suite pass | **PASS** | typecheck, build, 959/959 tests |

**Overall: PASS.** The previously observed 20.13 s epoch-rejection window did not recur. The remaining snapshot-age rollback is a known, bounded persistence property and is documented below rather than presented as eliminated.

## 12. Limitations and unverified properties

1. **Snapshot-age rollback remains.** Persistence is still every 15 s. A restart can restore up to one checkpoint interval behind the live tick. The final run rolled back 35 ticks (1.75 s). The pilot at 2.1 s restored tick 0. This phase did not change `PERSIST_MS`, snapshot size or write accounting; increasing frequency would materially increase storage writes.
2. **Final results are not replayed to a client that reconnects after the room has closed.** The result is delivered to connected seats at finish. A post-close reconnect receives `room-closed`. This is unchanged protocol behaviour.
3. **No 30-minute soak was run.** The task explicitly defers that decision until the targeted recovery checks pass. This report does not claim sustained 30-minute behaviour.
4. **No CPU or memory measurement.** No per-tick CPU, platform CPU, retained heap or memory drift claim is made. The 10 ms target remains unverified.
5. **One deployed forced restart.** Repeated-restart monotonicity is covered locally, not by repeated deployed restarts.
6. **Legacy v1 migration limitations.** v1 has no durable disconnect timestamp; an unconnected occupied seat is stamped with the snapshot `createdAt`. No active v1 room existed in staging during this phase.
7. **Metadata validation is local.** The deployed object exercises the same code, but corrupt persisted metadata was not injected into the deployed staging storage.
8. **Release count is not directly exported.** The status shows `released`, the release path is guarded, and the ledger release is idempotent. The coordinator's released-at value was not independently queried by this harness.

## 13. Reproduction

```bash
# Local verification
npm run typecheck
npx vitest run
npm run build
npx vite build --config mp-room-vite.config.ts

# Staging identity and safety
npx wrangler deployments status --config mp-room-wrangler.jsonc
curl -sS https://mca-multiplayer-staging.horsemeninteractive.workers.dev/api/multiplayer/health

# Deployed checks
MP_ADMIN_TOKEN="$(cat .dev/mp-admin-token)" node tools/phase2a-deployed-smoke.mjs
MP_ADMIN_TOKEN="$(cat .dev/mp-admin-token)" node tools/phase2a1-failure-tests.mjs
MP_ADMIN_TOKEN="$(cat .dev/mp-admin-token)" node tools/phase2a11-forced-restart.mjs
```

## 14. Evidence index

See `staging-evidence/phase2a11-evidence-README.md` for file-by-file descriptions and metric coverage.

Key raw evidence:

- `staging-evidence/phase2a11-restart-2026-10-30T22-20-39-723Z/summary.json`
- `.../metrics.jsonl`
- `.../status-before.json`
- `.../status-after.json`
- `.../status-final.json`
- `staging-evidence/phase2a11-smoke.json`
- `staging-evidence/phase2a11-lifecycle-results.json`
- `staging-evidence/phase2a11-vitest-full.log`
- `staging-evidence/phase2a11-deployment.txt`

No seat token, admin token, account identifier or API credential is stored in the evidence.
