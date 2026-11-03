# MCA Multiplayer — Phase 2A.12: Recovery-Enabled Stability and Restart Soak

**Prepared:** 30 October 2026  
**Build under test:** Phase 2A.11 staging, `b1030bee-2c89-4a23-addd-f1567b0d818b`  
**Verdict:** **FAIL**

---

## 1. Verdict and scope

The exact Phase 2A.11 artifact was verified and exercised with two controlled Durable Object restarts in independent two-seat trials. One trial failed at the second restart: the room could not be restored because its persisted snapshot contained a stale entity reference. The strict restore validator correctly rejected the snapshot, and the room returned `room-state-unavailable`.

A later trial recovered both restarts and completed its short match correctly. That second result does not erase the first: the defect is state-dependent, and recovery is not reliable.

**No 30-minute soak was started.** The phase instructions require stopping and documenting when a defect prevents the required verification, rather than expanding scope or changing the deployed artifact. Consequently, this report cannot establish 30-minute sustained stability, CPU drift, memory drift or navigation-batch retention.

The Phase 2A.11 epoch and timing changes themselves behaved correctly in every restoration that succeeded:

- Seat epochs were restored and advanced monotonically (`1026`, then `2052`, final `2054`).
- The match start time and hard deadline were unchanged across both restarts.
- Stale syncs and deltas from earlier epochs were rejected with `epoch-mismatch`.
- Legitimate post-restart commands were accepted.
- Duplicate resyncs were rate-limited; the first resync succeeded.
- No valid update was rejected in the passing trial.

The failure is in snapshot reference integrity, not in epoch issuance or timing continuity.

---

## 2. Exact deployed artifact

Verified before the trials and rechecked after the test suite:

| Item | Value |
|---|---|
| Worker | `mca-multiplayer-staging` |
| URL | `https://mca-multiplayer-staging.horsemeninteractive.workers.dev` |
| Active version | `b1030bee-2c89-4a23-addd-f1567b0d818b` |
| Tag | `phase2a11` |
| Deployment message | `Phase 2A.11: durable epochs and continuous match timing (start-preservation)` |
| Deployed build label | `phase2a11-staging` |
| Deployed artifact SHA-256 | `b5081f68a578b1b9af1def18ff889be30620f0a4d84d7d4d7b8227ebfd02396e` |
| Local `dist-mp-room/roomWorker.js` SHA-256 | `b5081f68a578b1b9af1def18ff889be30620f0a4d84d7d4d7b8227ebfd02396e` |
| Repository branch / HEAD | `master` / `132ccc8363d5b5bc98b6518b4afd1738dedaad6a` |
| Feature flag | `MULTIPLAYER_FEATURE.enabled = false` |

The deployed artifact still matches the local artifact after the trials. No deployed source, configuration or deployment change was made during this phase. The Phase 2A.12 evidence harness was adjusted before the recorded trials to reduce status polling; its final hash is recorded in the deployment note and it is not part of the production bundle. The working tree contained 152 modified or untracked paths and zero staged paths; all pre-existing work was left untouched.

The production frontend was rebuilt to confirm build health. A scan of `dist/assets`, `dist/index.html` and `dist/sw.js` found no staging-only calibration markers or admin token names.

---

## 3. Why the full 30-minute soak was not run

The restart validation was performed first, on a short match, to avoid committing 30 minutes to a build whose recovery path was unproven. Trial `phase2a12-dry5` failed at restart B with a Worker-side `RoomSnapshotError`. The exact same artifact was then retried in `phase2a12-dry6`, which passed both restarts.

That pair is enough to establish a state-dependent recovery defect but not a reliable recovery path. The phase says:

> If a defect is found, stop, document it and propose a narrowly scoped follow-up rather than silently expanding scope.

Changing the deployed artifact would have invalidated the build under test, and rerunning until a pass would have hidden the defect. The correct verdict is therefore **FAIL**, with the 30-minute stability questions explicitly left unverified.

---

## 4. Test design actually executed

Two independent short trials were run against the same deployed artifact. They used the real authoritative Durable Object simulation, two raw WebSocket seats, real movement, combat, projectiles and casualties.

| Setting | Value |
|---|---|
| Trial target duration | 80 s |
| Match duration | 90 s (80 s target + 10 s harness allowance) |
| Seats | 2, one per team |
| Commands | Balanced `move`, `produce` and `attack` from both seats every 5 s |
| Restart A target checkpoint age | ~1.5 s |
| Restart B target checkpoint age | ~12.5 s |
| Restart offsets | 10 s and 40 s after match start |
| Status polling | 10 s normally; 250 ms only around a restart |
| Checkpoint interval | 15 s, unchanged |
| Match deadline | 30 min configured maximum, unchanged; these trials used a 90 s room duration |

The 90 s room duration is a harness validation setting. It does not change the staging Worker's 30-minute maximum or its production policy.

### Trial results

| Trial | Room | Restart A | Restart B | Outcome |
|---|---|---|---|---|
| `dry5` | `phase2a12-dry5-mvvkfozt` | Passed | **Failed restore** | Aborted at 66.6 s |
| `dry6` | `phase2a12-dry6-mvvkj37a` | Passed | Passed | 90 s match completed |

---

## 5. Failure at restart B — `dry5`

### 5.1 Timeline

| Time (UTC) | Event |
|---|---|
| 22:50:39.226 | Both seats connected; match started |
| 22:50:56.601 | Restart A recovered; checkpoint age 1,633 ms; rollback 36 ticks / 1,800 ms |
| 22:51:26.536 | Fresh checkpoint observed: tick 903, snapshot cycle 3 |
| 22:51:26.537 | Restart B scheduled for 12,500 ms checkpoint age |
| 22:51:39.170 | Restart B requested; computed checkpoint age 12,633 ms |
| 22:51:39.204 | Runtime restart accepted |
| 22:51:39.251–253 | Both WebSockets closed |
| 22:51:39 onward | Restore attempt failed: `room-state-unavailable` |
| 22:51:45.852 | Harness stopped waiting; `restart 1 did not restore the room` |

The room had been tick 1,156 immediately before restart B. The last successful checkpoint was tick 903. Had restoration succeeded, the expected rollback was 253 ticks, about 12,650 ms.

### 5.2 Worker error

Captured in the staging Worker log and preserved in [phase2a12-tail-errors.txt](staging-evidence/phase2a12-tail-errors.txt):

```text
MP room restore failed RoomSnapshotError: Saved targetId references an unknown entity.
```

The room status endpoint returned:

```json
{"ok":false,"code":"room-state-unavailable","message":"Room snapshot could not be restored."}
```

Both seats therefore had no authoritative room to reconnect to. There was no first valid restored snapshot, no accepted post-restart command and no final result for this trial. The reservation could not be released through the normal completed-match path; the later capacity sequence passed only after the lease stopped blocking admission.

### 5.3 Restart A in the same trial

Restart A passed and provides a useful control:

- Checkpoint age: 1,633 ms.
- Pre-restart tick: 335.
- Restored snapshot tick: 299.
- Rollback: 36 ticks / 1,800 ms.
- First sync per seat: 347 ms and 373 ms after socket close, at tick 301.
- First delta: 70 ms and 45 ms after the sync.
- First commands: accepted for both seats.
- Resync: accepted; immediate duplicate rate-limited.
- Stale sync and delta: rejected with `epoch-mismatch`.
- Start time and deadline: unchanged.

The failure is therefore tied to a particular persisted state, not to the restart mechanism or to the epoch/timing code.

---

## 6. Passing short trial — `dry6`

### 6.1 Match result

| Item | Value |
|---|---|
| Match start | `2026-10-30T22:53:17.572Z` |
| Match finish | `2026-10-30T22:54:47.463Z` |
| Durable match start | `1793400797556` |
| Durable deadline | `1793400887420` |
| Elapsed | 89.864 s |
| Final authoritative tick | 1,496 |
| Final result | Seat 0 victory, seat 1 defeat, `time-limit` |
| Room closure | `match-finished` |
| Reservation | `r223`, `released` |
| Both clients reconstructed tick | 1,496 |
| Both clients agreed on outcome | Yes |

The whole-match average was 16.65 ticks/s against a 20 Hz target. This is not evidence of a sustained 16.65 Hz cadence. It is the arithmetic effect of two restarts and 14.25 s of total checkpoint rollback:

- Start to restart A: approximately 20 Hz.
- Restored A to restart B: approximately 20 Hz.
- Restored B to finish: approximately 20 Hz.
- Rollback removed 32 ticks at A and 253 ticks at B from the match timeline.

The 20 Hz target therefore held during the intervals in which the simulation was running. The whole-match tick count is necessarily lower when rollback is counted.

### 6.2 Restart A

| Measurement | Result |
|---|---|
| Checkpoint age at request | 1,583 ms |
| Last checkpoint tick | 300 |
| Pre-restart tick | 331 |
| Restored snapshot tick | 299 |
| Rollback | 32 ticks / 1,600 ms |
| Checkpoint bound | Within 15 s |
| First sync after close | 390 ms, 408 ms |
| First sync tick | 301 |
| Restored epoch | 1,026 |
| First delta after sync | 46 ms, 30 ms |
| First command accepted | Both seats (tick 302 / 303) |
| Resync | Accepted; duplicate `resync-rate-limited` |
| Stale sync / delta | `epoch-mismatch` |
| Start time before/after | `1793400797556` / `1793400797556` |
| Deadline before/after | `1793400887420` / `1793400887420` |
| Rejected updates | 0 |

### 6.3 Restart B

| Measurement | Result |
|---|---|
| Checkpoint age at request | 12,596 ms |
| Last checkpoint tick | 901 |
| Pre-restart tick | 1,153 |
| Restored snapshot tick | 900 |
| Rollback | 253 ticks / 12,650 ms |
| Checkpoint bound | Within 15 s (2.404 s margin) |
| First sync after close | 389 ms, 397 ms |
| First sync tick | 902 |
| Restored epoch | 2,052 |
| First delta after sync | 91 ms, 82 ms |
| First command accepted | Both seats (tick 904 / 905) |
| Resync | Accepted; duplicate `resync-rate-limited` |
| Stale sync / delta | `epoch-mismatch` |
| Start time before/after | `1793400797556` / `1793400797556` |
| Deadline before/after | `1793400887420` / `1793400887420` |
| Rejected updates | 0 |

The checkpoint age at B was 12.6 s, not the intended 13–14 s upper target. The harness scheduled from the observed checkpoint but the restart request landed 96 ms after the target. The trial therefore characterises a late-interval rollback, but it does **not** test the 13–14 s extreme or a restart immediately before the 15 s write. That remains a limitation.

---

## 7. Recovery invariants

| Requirement | `dry5` | `dry6` | Evidence |
|---|---|---|---|
| Both seats reconnect | Restart A only | A and B | Harness restart records |
| Restored epochs valid and monotonic | A: 1,026 | A: 1,026; B: 2,052; final 2,054 | Sync epochs |
| Stale pre-restart authority rejected | A yes; B no room | A and B yes | `epoch-mismatch` on stale sync/delta |
| Legitimate post-restart commands accepted | A both seats | A and B both seats | Command records |
| First resync succeeds | A yes | A and B yes | `resyncAcceptedAt` |
| Duplicate resync rate-limited | A yes | A and B yes | `resync-rate-limited` |
| Both clients reconstruct same state | Not reached after B | Yes, tick 1,496 | Reconstruction block |
| Static map sent once per baseline | A yes | A and B yes | `firstSyncHadMap`, `deltaMapBytes: 0` |
| Fog baseline/delta correct | A yes | A and B yes | 6,912 fog tiles per sync; no map in deltas |
| No prolonged rejection of valid updates | A 0 | A and B 0 | Protocol counters |
| Original start/deadline unchanged | A yes | A and B yes | Status before/after |

A direct replay of a pre-restart **command** was not issued in this phase. The deployed evidence covers stale syncs and deltas; local Phase 2A.11 tests cover command-level stale authority. The deployed command-replay case should be included in the follow-up verification.

---

## 8. Root cause of the restore failure

The failure is a mismatch between what the snapshot writer persists and what the restore validator accepts.

### 8.1 The validator is correct

[roomSnapshot.ts:428](src/multiplayer/roomSnapshot.ts#L428) requires every non-zero `entity.targetId` to reference an entity present in the snapshot:

```ts
if (entity.targetId) requireEntity(entity.targetId, 'targetId');
```

Rejecting the snapshot is the safe behaviour. Defaulting the reference to zero would silently alter authoritative state and could grant a unit a target that no longer exists.

### 8.2 The writer persists a stale reference

The simulation's combat cleanup only clears `targetId` inside the branch that handles an order still pointing at a removed target:

[game.ts:4959-4967](src/sim/game.ts#L4959-L4967)

```ts
// Clear orders pointing at dead entities.
for (const e of this.state.entities) {
  if (e.order?.targetId && !this.byId.has(e.order.targetId)) {
    e.order = null;
    e.targetId = 0;
    e.aimTargetId = 0;
    e.state = 'idle';
  }
  if (e.aimTargetId && !this.byId.has(e.aimTargetId)) e.aimTargetId = 0;
  ...
}
```

A move order does not carry a `targetId`. [game.ts:777-779](src/sim/game.ts#L777-L779) creates the new move order and clears the aim, but never clears the direct target:

```ts
// A new move order drops the old aim; the turret settles onto the hull
// rather than tracking a target the unit has left behind.
e.aimTargetId = 0;
```

The direct `targetId` survives the move order. When the old target later dies, cleanup sees no `e.order.targetId`, so it does not enter the clearing branch. The stale `targetId` is then serialised by `createRoomSnapshot` and rejected on restore.

This code path is consistent with the exact error, which names `targetId` rather than `aimTargetId` or `order.targetId`. The trial workload issued both `attack` and `move` commands, so it exercised the transition that creates the stale state.

### 8.3 Why it is intermittent

The defect requires a specific sequence:

1. A unit acquires or is given a target.
2. The unit receives a move or attack-move order before that target dies.
3. The target dies while the unit survives.
4. A checkpoint is written before any later action clears the direct reference.

Only some matches reach that state at a checkpoint boundary. That explains why `dry6` recovered both times while `dry5` failed. The deployed evidence proves the state occurs; it does not prove a frequency.

### 8.4 Secondary persistence error

The same Worker log contains repeated:

```text
MP room final snapshot failed RoomSnapshotError: A playing room snapshot cannot have a finish time.
```

This occurred when active rooms were shut down: the final snapshot carried a finish time while the result was still `playing`. It is a separate persistence-schema/ordering defect. It did not cause the restart-B failure, but it means shutdown final snapshots are not reliable and should be included in the follow-up.

---

## 9. Checkpoint rollback and command loss

| Restart | Checkpoint age | Pre-restart tick | Restored tick | Rollback | Within 15 s |
|---|---:|---:|---:|---:|---|
| `dry5` A | 1,633 ms | 335 | 299 | 36 ticks / 1,800 ms | Yes |
| `dry5` B | 12,633 ms | 1,156 | — | No restore | — |
| `dry6` A | 1,583 ms | 331 | 299 | 32 ticks / 1,600 ms | Yes |
| `dry6` B | 12,596 ms | 1,153 | 900 | 253 ticks / 12,650 ms | Yes |

The checkpoint interval remained 15 s. Every successful rollback stayed inside that interval. The observed B age was 12.6 s, not 13–14 s.

### Were commands accepted after the last checkpoint lost?

**Yes, on the evidence available.** In `dry6` restart B, commands were accepted at tick 1,153 after the last checkpoint at tick 901. Restoration resumed at tick 900, so those post-checkpoint commands do not exist in the restored authoritative state. This is expected rollback under the existing policy, not a protocol error. The same rollback must be reported to clients rather than hidden; in this trial both clients resynchronised to the restored state.

The exact command-by-command effect on unit destinations after rollback was not reconstructed. The trial confirms the accepted-tick gap; it does not enumerate each lost order.

---

## 10. Platform CPU and memory

### 10.1 Passing trial `dry6`

Cloudflare's `durableObjectsPeriodicGroups` returned only three active minute buckets for the 90 s room:

| Minute (UTC) | CPU (ms) | Peak memory (bytes) | Active sockets | Inbound msgs | Outbound msgs | Fatal internal errors |
|---|---:|---:|---:|---:|---:|---:|
| 22:53:17 | 400.054 | 10,871,037 | 2 | 8 | 344 | 1 |
| 22:53:34 | 783.687 | 17,916,072 | 2 | 30 | 888 | 1 |
| 22:54:17 | 529.274 | 8,070,956 | 2 | 20 | 624 | 0 |
| **Total** | **1,713.015** | **17,916,072 peak** | 2 max | 58 | 1,856 | 2 |

- Total platform CPU: **1,713.015 ms**.
- Aggregate CPU per completed tick: **1.145 ms/tick** (1,713.015 / 1,496). This is an aggregate average, not a per-tick measurement. It includes room setup, restart recovery, snapshot generation, WebSocket work and persistence.
- CPU per invocation cannot be computed as a total because Cloudflare exposes only per-minute CPU quantiles, not a per-invocation CPU sum. Across 61 adaptive groups / 178 requests, the successful-invocation minute median CPU ranged from 0.430 ms to 143.979 ms, with a maximum p99 of 197.583 ms. These are broad buckets, not individual records.
- Peak memory: **17.9 MB** in the 22:53:34 minute. The next minute fell to 8.1 MB. That pattern is consistent with isolate replacement at the deliberate restart, but the platform does not provide retained-heap attribution. No growth trend can be inferred from three buckets.
- `exceededCpuErrors` and `exceededMemoryErrors`: 0.
- `fatalInternalErrors`: 2, both aligned with the two forced restarts. They are lifecycle artefacts of the abort, not simulation exceptions. The room diagnostics recorded zero tick errors.

### 10.2 Failed trial `dry5`

| Item | Value |
|---|---|
| Periodic buckets | 5 |
| Total CPU | 2,028.914 ms |
| Peak memory | 12,152,684 bytes |
| Exceeded CPU / memory | 0 / 0 |
| Fatal internal errors | 2 |

The failed trial is not a valid CPU comparison. It ran a different amount of work and ended without a match.

### 10.3 Metric coverage and limits

- `durableObjectsPeriodicGroups` gave 3 buckets for `dry6` and 5 for `dry5`; several minutes had no active bucket.
- `durableObjectsInvocationsAdaptiveGroups` gave 61 aggregated groups, not 178 individual invocation records.
- `durableObjectsStorageGroups` returned no rows for the namespace/window, so platform stored-byte evidence is unavailable. Persistence byte counts come from room diagnostics, not platform storage metrics.
- No per-tick CPU, no isolate heap profile and no retained-memory attribution are available.
- **The 10 ms individual-tick CPU target remains unverified.**

The Phase 2A.9 A/B CPU result (8,513 ms → 5,742 ms for the synthetic 80-unit workload) is not re-tested here. This phase's short CPU figures are not comparable to that workload.

---

## 11. Transport and protocol

`dry6` used the existing protocol v2, static-map baseline and fog deltas. No protocol code changed.

### Server diagnostics (final process after restart B)

These counters are process-local and cover only the final restoration segment, not the whole match:

| Counter | Value |
|---|---:|
| Snapshots | 600 (300 / seat) |
| Snapshot bytes | 961,925 |
| Full syncs | 6 (3 / seat) |
| Sync bytes | 280,216 |
| Deltas | 594 (297 / seat) |
| Delta bytes | 681,709 |
| Delta p50 / p95 / p99 | 800 / 2,464 / 2,848 bytes |
| Outbound bytes | 964,087 |
| Inbound messages | 20 |
| Commands accepted / rejected | 13 / 1 |

### Client full-match observations

| Counter | Seat 0 | Seat 1 |
|---|---:|---:|
| Deltas received | 890 | 890 |
| Delta bytes | 1,485,582 | 1,351,767 |
| Syncs received | 6 | 6 |
| Sync bytes | 318,252 | 318,912 |
| Map bytes inside deltas | 0 | 0 |
| Delta p50 / p95 / p99 | 1,697 / 3,048 / 3,375 | 1,436 / 3,100 / 3,916 |
| First sync bytes | 58,975 | 58,969 |
| Final epoch | 2,054 | 2,054 |
| Rejected updates | 0 | 0 |

- The static map was sent in the initial sync and in each post-restart baseline; deltas carried no map bytes.
- Fog baseline was delivered in the sync; fog changes arrived as deltas.
- Stale syncs and deltas from the previous epoch were rejected.
- No update was rejected during normal post-restart flow.
- The 15-check smoke covers team-projection isolation; the soak itself did not perform an additional hidden-information audit.
- The server's 13 accepted commands are only the final process segment; the client's full-match counts (22 sent / 22 accepted for seat 0, 21 accepted for seat 1) are the whole-match figures.

One command was rejected with `no-capable-attacker`. That is a legitimate gameplay rejection from the balanced workload, not an authority or protocol failure.

Keepalive: clients sent and acked 3 each. The final server process recorded 2 received and 2 acked, consistent with the final process segment; the rest occurred before the last restart. No rate-limit or keepalive failure was recorded.

---

## 12. Persistence

The persistence mechanism remained the existing 15 s full-snapshot checkpoint. It was not optimised or altered.

| Observation | `dry5` | `dry6` |
|---|---|---|
| Snapshot write failures reported by diagnostics | 0 | 0 |
| Restore validation failures | 1 (`targetId`) | 0 |
| Final snapshot failures | 1 (`finish time`) | 0 |
| Last successful checkpoint tick before B | 903 | 901 |
| Checkpoint age at B | 12.633 s | 12.596 s |
| Snapshot size (max observed) | 260,321 bytes | 260,474 bytes |
| Reservation release | Not through normal closure | `releaseSuccesses: 1` |

The zero write-failure count in `dry5` is important: the writer successfully stored a snapshot that the restore validator later rejected. Writing and validating must agree. A write-failure metric alone does not prove snapshot integrity.

No persistence backlog was observed (`behind: false`, age since last success small) in the passing trial. This says nothing about a 30-minute run.

---

## 13. Lifecycle, capacity and security

All checks were run before and after the restart trials on the same staging Worker.

| Check | Pre | Post |
|---|---|---|
| 15-check deployed protocol/security smoke | Pass | Pass |
| Reconnect | Pass | Pass |
| Abandonment | Pass | Pass |
| Controlled shutdown | Pass | Pass |
| Hard deadline | Pass | Pass |
| Resync | Pass | Pass |
| Capacity sequence | `200, 200, 503, 200` | `200, 200, 503, 200` |

- The two-room maximum is unchanged.
- The daily capacity allowance is unchanged.
- The 30-minute match deadline is unchanged.
- Production was not deployed to.
- `MULTIPLAYER_FEATURE.enabled` remains `false`.
- No paid service, billing change or plan upgrade was introduced.

The post-trial capacity check passed after the failed `dry5` room's reservation lease stopped blocking admission. The failed room could not be shut down through the normal admin route because its snapshot could not be restored; the release timing is therefore an inference from the successful later capacity sequence, not a direct exactly-once release observation for that room.

---

## 14. Automated verification

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | **96 files, 959 tests, all pass** (pre and post) |
| `npm run build` | Pass |
| Production bundle staging-marker scan | No matches |
| Deployed 15-check smoke | Pass (pre and post) |
| Six lifecycle/capacity checks | Pass (pre and post) |

The test suite was rerun after the restart trials. Test count was unchanged, which is expected because this phase added evidence tooling only; it is not proof that behaviour is unchanged. The restart harness change from this phase is not part of the production bundle.

Logs: [phase2a12-vitest-pre.log](staging-evidence/phase2a12-vitest-pre.log), [phase2a12-vitest-post.log](staging-evidence/phase2a12-vitest-post.log), [phase2a12-build-post.log](staging-evidence/phase2a12-build-post.log), [phase2a12-smoke-post.json](staging-evidence/phase2a12-smoke-post.json), [phase2a12-lifecycle-post-results.json](staging-evidence/phase2a12-lifecycle-post-results.json).

---

## 15. Acceptance criteria

| # | Criterion | Result |
|---:|---|---|
| 1 | Exact Phase 2A.11 artifact completes the full 30-minute match | **Not run** — stopped at confirmed defect |
| 2 | Both controlled restart recoveries complete successfully | **FAIL** — `dry5` restart B did not restore |
| 3 | Both seats retain valid authority and resume command/update flow | **PARTIAL** — pass in `dry6`; no room after `dry5` B |
| 4 | No unexplained post-restart update rejection | **PARTIAL** — 0 in `dry6`; failure prevented recovery in `dry5` |
| 5 | Checkpoint rollback measured and within 15 s | **PARTIAL** — 1.6 s and 12.65 s where restored; `dry5` B had no restore to measure |
| 6 | Match start and original deadline continuous | **PASS where restored** |
| 7 | Persistence and transport stable across the match | **FAIL** — invalid persisted reference prevented restore |
| 8 | Both seats receive consistent final results | **PASS in `dry6`; not reached in `dry5`** |
| 9 | Room closure and guarded reservation release succeed | **PASS in `dry6`; `dry5` could not close normally** |
| 10 | Capacity, security, lifecycle and bandwidth intact | **PASS on the available checks** |
| 11 | Typecheck, production build and full test suite pass | **PASS** |
| 12 | 30-minute CPU/memory drift established | **Not measured** |

**Overall verdict: FAIL.** The phase cannot pass while a persisted authoritative snapshot can be rejected on restore.

---

## 16. Remaining limitations

1. **No 30-minute soak.** Sustained stability, CPU drift, memory drift, isolate replacement over 30 minutes and navigation-batch retention are unverified.
2. **No extreme checkpoint-age test.** Restart B occurred at ~12.6 s, not 13–14 s. A restart at 14.9 s or during an in-flight snapshot write was not tested.
3. **No direct stale-command replay.** Stale sync/delta rejection is proven; stale command injection after reconnect was not directly exercised on staging.
4. **Aggregate CPU only.** No per-tick CPU and no individual invocation CPU sum. The 10 ms target is unverified.
5. **Limited memory resolution.** Three minute buckets; no retained-heap attribution.
6. **State-dependent defect frequency.** One failure in two trials does not estimate a rate. The code path is clear, but the deployed snapshot's exact entity was not reconstructed.
7. **Secondary final-snapshot error.** `A playing room snapshot cannot have a finish time` remains unaddressed.
8. **Single colo.** Both trials ran in LHR; no cross-colo comparison.

---

## 17. Recommended narrow follow-up

Do not redesign persistence or protocol. Fix the reference invariant and re-run this phase:

1. Clear the direct `targetId` whenever a unit transitions to a move or attack-move order, and make combat cleanup clear any surviving direct reference unconditionally (`targetId`, `aimTargetId`, `buildTargetId`, `repairTargetId`, `homeId`), not only when `order.targetId` is present.
2. Add a regression test that attacks a target, orders the attacker to move, kills the original target, writes a room snapshot and restores it. The test must fail on the current build with `invalid-references`.
3. Fix the final-snapshot timing order so a playing room never persists a finish time; add a shutdown-while-playing snapshot test.
4. Consider a pre-persist reference audit that fails the write loudly rather than storing a snapshot the reader will reject. Do not make the validator lenient.
5. Rerun the 90 s two-restart trial enough times to reproduce both branches, then run the full 30-minute soak with at least one restart near 14 s checkpoint age.

---

## 18. Evidence index

| Artifact | Purpose |
|---|---|
| [phase2a12-summary.json](staging-evidence/phase2a12-summary.json) | Machine-readable trial and metric summary |
| [phase2a12-failure.json](staging-evidence/phase2a12-failure.json) | Failure capture for `dry5` |
| [phase2a12-deployment.txt](staging-evidence/phase2a12-deployment.txt) | Build, artifact and source identity |
| [phase2a12-platform-periodic.json](staging-evidence/phase2a12-platform-periodic.json) | Raw periodic CPU/memory rows |
| [phase2a12-platform-invocations.json](staging-evidence/phase2a12-platform-invocations.json) | Invocation coverage and quantiles |
| `phase2a12-dry5-2026-10-30T22-50-38-375Z/` | Failed trial logs, statuses and Restart A record |
| `phase2a12-dry6-2026-10-30T22-53-16-754Z/` | Passing short trial summary, restarts and metrics |
| [phase2a12-tail-errors.txt](staging-evidence/phase2a12-tail-errors.txt) | Worker restore and final-snapshot errors |
| [phase2a12-vitest-post.log](staging-evidence/phase2a12-vitest-post.log) | Post-trial 959-test run |
| [phase2a12-build-post.log](staging-evidence/phase2a12-build-post.log) | Post-trial production build |
| [phase2a12-bundle-scan.txt](staging-evidence/phase2a12-bundle-scan.txt) | Staging-marker scan |

**The 10 ms individual-tick CPU target remains unverified.**
