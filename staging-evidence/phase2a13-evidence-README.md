# Phase 2A.13 evidence README

**Phase:** MCA Multiplayer — snapshot integrity and finalisation ordering  
**Captured:** 31 October 2026  
**Staging Worker:** `mca-multiplayer-staging`  
**Deployed version:** `9fd1dcf4-3046-438d-b72d-0c3880b0afc5`  
**Tag:** `phase2a13`  
**Build label:** `phase2a13-staging`

This directory contains the raw deployed evidence for Phase 2A.13. It
distinguishes observed platform data from derived values. No seat token, admin
token or API secret is stored here.

---

## 1. Deployment identity

| File | Contents |
|---|---|
| `phase2a13-deployment.json` | Machine-readable version, artifact and source hashes |
| `phase2a13-deployment.txt` | Human-readable deployment and safety record |
| `phase2a13-deploy.log` | Wrangler upload/version output |

The local `dist-mp-room/roomWorker.js` SHA-256 at upload was:

```
cfca794ca41719449fd827fcd06b13ddbdb806c2b7d54a02703e9c4959396f1a
```

The active Worker health endpoint reports `build: "phase2a13-staging"` and
`snapshotVersion: 2`. Production was not deployed to. The feature flag remains
`enabled: false`.

---

## 2. Local verification

| File | Result |
|---|---|
| `phase2a13-typecheck.log` | `tsc --noEmit` passed |
| `phase2a13-vitest-focused.log` | 44/44 focused tests passed (4 files) |
| `phase2a13-vitest-full.log` | 980/980 tests passed (97 files) |
| `phase2a13-build.log` | Production build passed; 13 assets precached |

The new file `tests/phase2a13-integrity.test.ts` contains 17 tests:

- nine target-reference tests, including the exact Phase 2A.12
  target-removal/move-order sequence;
- a negative test proving the unchanged strict validator still rejects the
  stale reference;
- six finalisation tests (playing, abort, repeated abort, completed match,
  restored finished room, write-straddling-finalisation);
- one combined persistence/restore/finish regression.

The production bundle was scanned for `phase2a13-staging`, `MP_ADMIN_TOKEN`,
`MCA_RESERVATION_TOKEN`, `mp-admin-token` and `/api/multiplayer/rooms`; no
staging markers were found in `dist`.

---

## 3. Deployed protocol, security and lifecycle checks

### 15-check protocol/security smoke

`phase2a13-smoke-post.json` is the raw JSON output. It passed 15/15 checks:

1. deployed 101 upgrade
2. two seats connected
3. team projections isolated
4. valid command accepted
5. forged authority rejected
6. oversized frame rejected
7. wrong token 401
8. foreign origin 403
9. duplicate seat 409
10. resync checkpoint applied
11. reconnect accepted on a new epoch
12. delta carried no map or full state
13. result delivered to both seats
14. reservation released
15. deployed global capacity boundary enforced

The smoke also observed the capacity sequence `200, 200, 503, 200`.

### Six lifecycle/capacity checks

`phase2a13-lifecycle-results.json` and `phase2a13-lifecycle-events.jsonl`
record:

| Check | Result |
|---|---|
| Reconnect | PASS, new epoch, sync + next delta |
| Permanent disconnect / abandonment | PASS, 30,099 ms, victory for survivor |
| Controlled shutdown | PASS, `room-shutdown`, released |
| Hard deadline | PASS, both seats draw, 193 ticks, released |
| Resync | PASS, checkpoint sync, next delta base matches |
| Capacity | PASS, statuses `200, 200, 503, 200` |

All six reservations were released.

---

## 4. Phase 2A.12 `dry5` reproduction attempts

### 4.1 Attempt 1 — aborted by a client transport half-open

Directory: `phase2a13-dry5-repro-2026-10-31T00-05-06-948Z/`  
Console: `phase2a13-dry5-repro.log`

Restart A recovered normally. Before restart B, seat 1 stopped receiving
deltas (last observed tick 1002 while seat 0 reached 1180) and a command timed
out. The raw client never observed a close frame for seat 1, so the harness's
"both sockets closing for restart" wait timed out. Only seat 0's close event
was observed after the abort request. The Worker remained healthy and the room
was later shut down and its reservation released.

This run did not reach restoration at restart B, so it is evidence of a
raw-client/edge half-open connection, not of a snapshot or finalisation
failure. It is preserved and is not counted as a recovery pass.

### 4.2 Attempt 2 — both restarts and full match pass

Directory: `phase2a13-dry5-repro2-2026-10-31T00-07-56-570Z/`  
Console: `phase2a13-dry5-repro2.log`

The same 80 s synthetic mass-order harness, fresh room, same restart targets:

| Measurement | Restart A | Restart B |
|---|---:|---:|
| Checkpoint age at request | 1,605 ms | 12,573 ms |
| Last checkpoint tick | 300 | 902 |
| Last authoritative tick | 332 | 1,153 |
| Restored snapshot tick | 299 | 900 |
| Rollback | 33 ticks / 1,650 ms | 253 ticks / 12,650 ms |
| First sync after close | 398 / 409 ms | 363 / 343 ms |
| First delta after sync | 41 / 36 ms | 80 / 101 ms |
| First command accepted | both seats | both seats |
| Resync | accepted, duplicate rate-limited | accepted, duplicate rate-limited |
| Stale sync/delta | `epoch-mismatch` | `epoch-mismatch` |
| Match start | unchanged | unchanged |
| Hard deadline | unchanged | unchanged |

Final observed state:

- Both seats reconstructed tick `1495` and phase `finished`.
- Both received the same result: winner team 1, `time-limit`, tick `1495`.
- `rejectedUpdates` was `0`; `lastReject` was `null`.
- Seat epochs progressed `1 → 1026 → 2052 → 2054`.
- Persistence failures: `0`; `behind: false`.
- Final snapshot write succeeded 40 ms after `finishedAtMs`
  (`lastSnapshotBytes: 254469`).
- Room closure reason: `match-finished`.
- Reservation `r249`: `released`; release failures `0`.
- No Worker snapshot or finalisation errors were logged.

The whole-match effective rate of 16.64 ticks/s is the arithmetic effect of
the 286 rolled-back ticks across two restarts; it is not a sustained cadence
measurement and is not used as one.

### 4.3 Worker log scan

`phase2a13-worker-tail-repro2.log` and
`phase2a13-worker-tail-completion.log` are raw `wrangler tail --format json`
captures. They contain only the deliberate
`Application called abort() to reset Durable Object.` exceptions from the
staging restart route. No `RoomSnapshotError`, no
`A playing room snapshot cannot have a finish time`, no
`Saved targetId references an unknown entity`, and no
`MP room final snapshot failed` entries are present.

---

## 5. Match-completion corroboration

`phase2a13-completion-room-status.json` is the durable post-match status of
room `restart-mvvn9dl5`, exercised by the established Phase 2A.11 forced-restart
harness. That harness's own timing assertion fired during sequential client
reconnect, so its console result is **not** counted as a pass (see
`phase2a11-restart-2026-10-31T00-09-42-503Z/` and
`phase2a13-completion-trial.log`). The room nevertheless continued to its
original deadline and completed:

- start `1793405383468`; finish `1793405428150`;
- final result `finished`, winner team 0, `time-limit`, tick 848;
- persistence `lastSuccessAt` 41 ms after finish, `lastSnapshotBytes: 258121`,
  failures `0`;
- reservations: one success, one release, zero failures;
- lifecycle: two connections, two reconnects, one deadline hit, no abnormal
  shutdowns;
- closure `match-finished`, reservation `released`.

Both-seat result delivery at completion is directly evidenced by the
`dry5-repro2` run, where both reducers reached tick 1495 and both result
messages agreed.

---

## 6. Raw platform data and derived values

The values in this evidence set are either:

- direct Worker status values (`matchTiming`, `stats`, diagnostics,
  reservation status, start/finish timestamps); or
- derived by the harness from those values (rollback ticks, rollback
  milliseconds, reconnect latency, effective Hz).

No Cloudflare platform CPU or memory samples were collected in this phase;
Phase 2A.13 is a correctness and persistence-integrity phase. The unverified
10 ms individual-tick CPU target from earlier phases is unchanged by this
evidence.

---

## 7. File map

```
MULTIPLAYER_PHASE_2A_13_INTEGRITY_REPORT.md
staging-evidence/
  phase2a13-evidence-README.md
  phase2a13-deployment.json
  phase2a13-deployment.txt
  phase2a13-deploy.log
  phase2a13-smoke-post.json
  phase2a13-lifecycle-post.log
  phase2a13-lifecycle-results.json
  phase2a13-lifecycle-events.jsonl
  phase2a13-dry5-repro.log
  phase2a13-dry5-repro-2026-10-31T00-05-06-948Z/
  phase2a13-dry5-repro2.log
  phase2a13-dry5-repro2-2026-10-31T00-07-56-570Z/
  phase2a13-worker-tail-repro2.log
  phase2a13-worker-tail-completion.log
  phase2a13-completion-trial.log
  phase2a13-completion-room-status.json
  phase2a11-restart-2026-10-31T00-09-42-503Z/
  phase2a13-typecheck.log
  phase2a13-vitest-focused.log
  phase2a13-vitest-full.log
  phase2a13-build.log
```

No paid observability service, billing change, production deployment or
capacity change was used.
