# MCA Multiplayer — Phase 2A.13: Snapshot Integrity and Finalisation Ordering

**Prepared:** 31 October 2026  
**Build under test:** Phase 2A.13 staging, `9fd1dcf4-3046-438d-b72d-0c3880b0afc5`  
**Deployed artifact:** `cfca794ca41719449fd827fcd06b13ddbdb806c2b7d54a02703e9c4959396f1a`  
**Verdict:** **PASS**

---

## 1. Verdict and scope

Both defects identified by Phase 2A.12 were confirmed in the current source and
fixed at their source of truth:

1. A direct `targetId` could survive a move or attack-move order that replaced
   the unit's attack order. If the old target was then removed, the strict room
   snapshot validator correctly rejected the checkpoint with
   `Saved targetId references an unknown entity`.
2. A failed or aborted room stamped a match finish time while its neutral result
   still said `playing`. The final snapshot then failed its own timing
   validator with `A playing room snapshot cannot have a finish time`.

The fixes are narrow. Snapshot validation was not weakened. The Phase 2A.4
protocol, the Phase 2A.11 epoch/timing work, seat authority, CommandGate, rate
limits and the 15-second checkpoint interval are unchanged.

The corrected build passed the deployed 15-check smoke, all six lifecycle and
capacity checks, two controlled Durable Object restarts in a fresh two-seat
mass-order trial, and a completed match with a final snapshot write and a
guarded reservation release. Both clients reconstructed the same final tick and
outcome.

The 10 ms individual-tick CPU target remains **unverified**. This phase made no
CPU or memory-drift claim and did not start another 30-minute soak.

---

## 2. Exact build and source

| Item | Value |
|---|---|
| Worker | `mca-multiplayer-staging` |
| URL | `https://mca-multiplayer-staging.horsemeninteractive.workers.dev` |
| Active version | `9fd1dcf4-3046-438d-b72d-0c3880b0afc5` |
| Tag | `phase2a13` |
| Message | `Phase 2A.13: snapshot target integrity and finalisation ordering` |
| Version created | `2026-10-31T00:02:04.043Z` |
| Deployment created | `2026-10-31T00:02:05.643Z` |
| Local uploaded bundle | `cfca794ca41719449fd827fcd06b13ddbdb806c2b7d54a02703e9c4959396f1a` |
| Health build label | `phase2a13-staging` |
| Snapshot version | `2` |
| Feature flag | `MULTIPLAYER_FEATURE.enabled = false` |
| Repository | `master`, HEAD `132ccc8363d5b5bc98b6518b4afd1738dedaad6a` |
| Working tree | 156 modified/untracked paths, 0 staged; pre-existing work preserved |

Source hashes:

```
83b19d865ae8f2f3ba93d3875ae5cda07fb369e4a90da89fe0afdf9008c277fe  src/sim/game.ts
ddb9646e3bf1b8d3facebbaec18cf9231b9e5ab3d0bc7c0dd9184f5b55b17b74  src/multiplayer/roomMatch.ts
85dfc17c60bb52eb60f61cb8a42159ff157702fe3279ee07cb6da21e7d731997  src/multiplayer/roomWorker.ts
f94a908ef26c72d0db408fe83b2f9a52cf806f5535a8aaa78c7809755c3b3dfc  tests/phase2a13-integrity.test.ts
```

All staging runs used this artifact. No deployed-source change was made after
the trials.

---

## 3. Root cause A — direct target outlives its order

### 3.1 Confirmed source path

`commandMove()` in `src/sim/game.ts` replaces a unit's order with `move` or
`attackMove` and clears `aimTargetId` and capture state, but before this phase
it did not clear the separate direct `targetId`.

The leak had several branches:

- air units assigned a move order without touching `targetId` or
  `aimTargetId`;
- a ground move that was rejected for terrain or path failure cleared the
  order but left the direct target;
- a harvester redirected to a refinery left the old direct target;
- a successful ground move cleared aim and capture but not `targetId`.

Combat cleanup in `cleanup()` only cleared `targetId` when
`e.order?.targetId` still referenced a removed entity. A move order has no
`order.targetId`, so a stale direct target survived cleanup. The next room
checkpoint serialised it, and `validateReferences()` in
`src/multiplayer/roomSnapshot.ts` rejected it because the id was no longer in
the saved entity set. The validator was correct; the authoritative state was
not.

### 3.2 Intended reference semantics

| Field | Intended meaning | Authority |
|---|---|---|
| `order.targetId` | Target carried by the current attack/capture/repair/garrison order. Drives order execution and is replaced with the order. | Authoritative order state |
| `aimTargetId` | Turret/presentation aim. It does not affect damage, range or target selection, and is cleared when its entity disappears. | Presentation state, saved |
| `targetId` | Direct combat target reference set by a direct attack or a garrison firing solution. It is not a movement destination and is not the order's target. | Authoritative reference, saved and projected |

The invariant now enforced is: **`targetId` must either be zero or identify a
live entity, and a move or attack-move order invalidates any direct target
belonging to the combat order it replaces.** Target removal clears the
reference regardless of the unit's current order.

### 3.3 Fix

In `commandMove()` the direct target and aim are cleared for every selected
unit immediately after `releaseBuildTarget()`, before any air, harvester,
path-failure or ground branch (`src/sim/game.ts`, around line 722). This is the
single order-replacement point, so all branches receive the same invariant.

`cleanup()` now also clears:

- `targetId` when it no longer exists in `byId`;
- `buildTargetId` through the existing `releaseBuildTarget()` helper;
- `repairTargetId`, returning a repairing unit to idle;
- `homeId` when its home structure has been removed.

Existing cleanup of `order.targetId`, `aimTargetId`, `healTargetId`,
`captureTargetId`, `garrisonId`, contacts and charted entries is unchanged.

No validation was removed. The negative regression test deliberately restores
the old stale reference in an otherwise valid snapshot and confirms that
`validateRoomSnapshot()` still rejects it with `invalid-references`.

---

## 4. Root cause B — abort fabricated a match finish

### 4.1 Confirmed ordering

The Durable Object finalisation path was:

1. `doFinalize()` observed a room still in `playing`.
2. It called `match.fail('room-stopped', ...)`.
3. `RoomMatch.fail()` set `phase = 'closed'` and `finishedAtMs = now`, but left
   `this.result` as the last playing result.
4. `doFinalize()` then persisted a snapshot.
5. `RoomMatch.snapshot()` passed both `result.phase === 'playing'` and
   `timing.finishedAtMs === now` to `createRoomSnapshot()`.
6. The snapshot validator rejected the mixed lifecycle state:
   `A playing room snapshot cannot have a finish time`.

The same invalid pair could be produced by any caller that failed a playing
room before final persistence, including operator shutdown and reservation
failure. The error was therefore repeated across finalisation attempts.

The defect was not asynchronous storage corruption and not simply a wrong call
order inside one function: `fail()` was manufacturing a match finish time for a
match that had no finished result. Snapshot timing and result phase must come
from one lifecycle transition.

### 4.2 Fix

`RoomMatch.fail()` is now explicitly an abort, not a match finish
(`src/multiplayer/roomMatch.ts`, around line 569). It sets the closed phase and
reason, ends the command gate and notifies clients, but it does not set
`finishedAtMs`. Room closure time remains durable in the Durable Object's
`meta.closedAt`.

This makes every snapshot valid by construction:

- while playing: result `playing`, finish time `null`;
- after a genuine match completion: `finish()` sets phase, result and finish
  time together, then finalisation writes a coherent finished snapshot;
- after an abort: result remains whatever the last tick produced (`playing`),
  finish time remains `null`, and the room's closure is recorded in metadata
  rather than being misrepresented as a competitive finish.

The `RoomMatch` constructor now also refuses a `finished` phase carrying a
`playing` result, and only assigns a finish time to a closed room when its
result is genuinely finished. This closes the same mixed-state door on
restoration/construction.

`finish()` remains the only transition that sets `result.phase = 'finished'`
together with `finishedAtMs` and sends final results. Concurrent or repeated
`fail()`/`finishAtDeadline()` calls remain idempotent through the existing
closed guard; reservation release remains in the Durable Object's guarded,
idempotent lease path.

Because abort no longer creates a finish time, a persistence write queued
before or during finalisation cannot capture an invalid playing/finished pair.
A queued write observes either a valid playing state or a valid aborted state;
a genuine finish writes both fields in one synchronous transition.

---

## 5. Automated regression coverage

New file: `tests/phase2a13-integrity.test.ts` — **17 tests**.

### Target-reference tests

1. Move order replaces a combat order and clears the direct target.
2. Attack-move order replaces a combat order and clears the direct target.
3. A direct attack order keeps its target functional.
4. Target removal under a move order clears the stale direct target.
5. Target removal under an attack-move order clears the stale direct target.
6. Target removal under a direct attack order clears order, target and aim.
7. Order replacement leaves no `targetId`, `aimTargetId` or `order.targetId`.
8. A snapshot after move replacement passes strict validation and restores.
9. The Phase 2A.12 target-removal + move-order sequence restores successfully.
10. The strict validator still rejects the old stale reference (negative test).

The reproduction sequence is the one from Phase 2A.12: establish a direct
attack, remove the target in the same authoritative tick as a replacement move
order, then serialise and restore. Before the fix the direct target survived
order replacement and the snapshot failed with `invalid-references`. With the
fix the target is zero and the snapshot restores with an identical state hash.

### Finalisation tests

1. A playing snapshot has no finish time.
2. Aborting an active room produces a valid playing checkpoint.
3. Repeated abort finalisation is idempotent and still valid.
4. Match completion produces one coherent finished result and finish time.
5. A finished room restores with its result, lifecycle and timing intact.
6. A write straddling finalisation sees only valid playing/aborted checkpoints.
7. Existing deadline-driven completion tests remain green.

### Combined regression

One integration test starts an authoritative room, creates a valid attack
target, removes that target, issues a move order, persists and restores the
playing snapshot, completes the match, persists the finished state and restores
that finished state. It asserts no stale target reference and no mixed
finalisation snapshot at any step.

### Results

| Check | Result |
|---|---|
| Focused suite (4 files) | **44/44 passed** |
| Full suite | **980/980 passed across 97 files** |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| Production bundle staging-marker scan | No markers |
| Strict snapshot validation | Enabled and exercised by negative test |

Test count rose from 979 to 980 because of the one new file; existing tests were
not weakened or skipped.

---

## 6. Deployed verification

### 6.1 Protocol and security smoke — 15/15

`staging-evidence/phase2a13-smoke-post.json` records all 15 checks, including
deployed 101 upgrade, both seats, team projection isolation, accepted command,
forged authority rejection, oversized frame rejection, wrong token 401, foreign
origin 403, duplicate seat 409, resync checkpoint, reconnect on a new epoch,
delta without map/full state, results to both seats, reservation release and
capacity enforcement.

### 6.2 Lifecycle and capacity — 6/6

`staging-evidence/phase2a13-lifecycle-results.json` records reconnect,
abandonment, controlled shutdown, hard deadline, resync and capacity checks.
All passed. The capacity sequence was:

```
200, 200, 503, 200
```

Every room in the sequence released its reservation.

### 6.3 Exact `dry5` reproduction — attempt 1 (not a pass)

Room: `phase2a13-dry5-repro-mvvn3h0g`  
Evidence: `staging-evidence/phase2a13-dry5-repro-2026-10-31T00-05-06-948Z/`

Restart A recovered. Before restart B, seat 1's raw client stopped receiving
deltas at tick 1002 while seat 0 reached 1170; a seat-1 command timed out and
no close frame arrived. The restart abort closed seat 0 but the harness waited
for both and timed out after 8 seconds. The Worker remained healthy, the room
was shut down and its reservation was released.

This attempt never requested a restore at restart B. It is preserved as a
transport/harness failure, not reclassified as a recovery pass.

### 6.4 Exact `dry5` reproduction — attempt 2 (pass)

Room: `phase2a13-dry5-repro2-mvvn73wc`  
Evidence: `staging-evidence/phase2a13-dry5-repro2-2026-10-31T00-07-56-570Z/`

Expected checkpoints were observed before each restart; restart ages were
computed from the observed checkpoint time, not an assumed schedule.

| Measurement | Restart A | Restart B |
|---|---:|---:|
| Checkpoint age at request | 1,605 ms | 12,573 ms |
| Last successful checkpoint tick | 300 | 902 |
| Last authoritative tick before restart | 332 | 1,153 |
| First restored tick | 299 | 900 |
| Rollback | 33 ticks / 1,650 ms | 253 ticks / 12,650 ms |
| First sync after socket close | 398 ms / 409 ms | 363 ms / 343 ms |
| First delta after sync | 41 ms / 36 ms | 80 ms / 101 ms |
| First command accepted | both seats | both seats |
| Resync | accepted; duplicate rate-limited | accepted; duplicate rate-limited |
| Stale pre-restart sync/delta | `epoch-mismatch` both | `epoch-mismatch` both |
| Match start | unchanged | unchanged |
| Hard deadline | unchanged | unchanged |

Both rollbacks were inside the unchanged 15-second checkpoint interval. Seat
epochs progressed `1 → 1026 → 2052 → 2054`; no epoch reset or rejection window
appeared. `rejectedUpdates` was zero.

Final state:

- Both clients reconstructed tick `1495` and phase `finished`.
- Both received the same result: winner team 1, reason `time-limit`, tick
  `1495`.
- Server phase `finished`, total ticks `1495`, process ticks `595`
  (`900` restored + `595` post-restart).
- Persistence: 3 snapshot cycles, 0 failures, `behind: false`, final snapshot
  written 40 ms after finish (`lastSnapshotBytes: 254469`).
- Room closure: `match-finished`; reservation `r249` released once; release
  failures `0`.
- No `RoomSnapshotError`, stale-target error or final-snapshot error was logged.

The whole-match average of 16.64 ticks/s is the arithmetic effect of the 286
rolled-back ticks; it is not a sustained tick-rate measurement.

### 6.5 Match completion evidence

`staging-evidence/phase2a13-completion-room-status.json` records room
`restart-mvvn9dl5`, which was restored and then completed at its original
deadline:

- start `1793405383468`, finish `1793405428150`;
- final result `finished`, winner team 0, `time-limit`, tick 848;
- final persistence success 41 ms after finish, `lastSnapshotBytes: 258121`,
  zero failures;
- one reservation heartbeat success, one release success, zero failures;
- two connections and two successful reconnects; one deadline hit; no abnormal
  shutdowns;
- closure `match-finished`, reservation `released`.

The Phase 2A.11 harness that drove this room stopped on a timing-sensitive
assertion during sequential reconnect (`|server tick - first client tick| <= 3`)
before it waited for the result. That assertion is not treated as a pass. The
durable post-match status above proves the room completed correctly; the
`dry5-repro2` run independently proves both client reducers received the same
final tick and outcome.

---

## 7. Security, capacity and safety state

- Staging only; production was not deployed to.
- `MULTIPLAYER_FEATURE.enabled = false`.
- Two-room maximum, daily allowance and 30-minute hard deadline unchanged.
- CommandGate, seat authority, stale-epoch rejection, resync rate limiting,
  team projection and hidden-information checks remain green.
- Static-map delivery once per baseline, deltas without map payloads, and fog
  baselines remain intact.
- No paid service, billing change or automatic upgrade.
- 15-second checkpoint interval unchanged.
- No simulation/combat/pathfinding redesign; only target-reference cleanup,
  order replacement and room finalisation fields changed.
- No commit, push, reset or clean was performed.

The production bundle scan found no staging-only calibration markers, admin
token names or room routes.

---

## 8. Remaining limitations

1. **Exact staging sequence not forced.** The staging harness exercises real
   combat, target destruction and repeated move/attack orders, but it cannot
   directly construct the precise unit/order/target state. That exact sequence
   is deterministically reproduced by the local regression and rejected by the
   validator if the reference remains.
2. **Attempt 1 transport half-open.** One raw-client connection stopped
   receiving and never delivered a close frame, so the restart never reached
   restoration. Attempt 2 passed on a fresh room. This is a raw-client/edge
   limitation, not evidence of a Worker restore defect.
3. **Completion-harness assertion.** One established harness stopped on a
   timing tolerance after successful restore; the room later completed and
   released, and the full two-seat completion is covered by `dry5-repro2`.
4. **No post-finish restore on staging.** Closed rooms are intentionally not
   restored by the Durable Object. Finished-snapshot restore is covered by the
   local combined test; staging proves the final snapshot bytes were written
   successfully after the finished result.
5. **No CPU/memory soak.** This phase did not collect platform CPU or memory
   series. The 10 ms individual-tick CPU target remains unverified.
6. **30-minute soak not started.** A further sustained soak is a separate
   decision after this integrity fix.

---

## 9. Evidence index

All raw files are under `staging-evidence/`:

- `phase2a13-evidence-README.md` — file-by-file evidence guide
- `phase2a13-deployment.json` / `.txt` / `phase2a13-deploy.log`
- `phase2a13-smoke-post.json`
- `phase2a13-lifecycle-results.json` and `phase2a13-lifecycle-events.jsonl`
- `phase2a13-dry5-repro-2026-10-31T00-05-06-948Z/` — aborted transport attempt
- `phase2a13-dry5-repro2-2026-10-31T00-07-56-570Z/` — passing two-restart run
- `phase2a13-worker-tail-repro2.log`,
  `phase2a13-worker-tail-completion.log`
- `phase2a13-completion-trial.log`,
  `phase2a13-completion-room-status.json`
- `phase2a11-restart-2026-10-31T00-09-42-503Z/` — harness assertion evidence
- `phase2a13-typecheck.log`, `phase2a13-vitest-focused.log`,
  `phase2a13-vitest-full.log`, `phase2a13-build.log`

---

## 10. Verdict

**PASS.**

The target-integrity and finalisation-ordering defects are fixed at source,
covered by deterministic regression tests, and verified against the deployed
staging Worker. Strict snapshot validation remains enabled. The deployed build
recovered both seats through two controlled restarts, completed a match with
matching client/server state, wrote a valid final snapshot, and released its
reservation exactly once. Security, lifecycle and capacity regressions are
green.

**The 10 ms individual-tick CPU target remains unverified.** A further
30-minute recovery soak should be a separate decision; it was not started here.
