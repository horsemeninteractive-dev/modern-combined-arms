# Phase 2A.12 evidence README

**Verdict:** FAIL  
**Prepared:** 30 October 2026  
**Report:** [MULTIPLAYER_PHASE_2A_12_SOAK_REPORT.md](../MULTIPLAYER_PHASE_2A_12_SOAK_REPORT.md)

This directory preserves the direct evidence for the Phase 2A.12 restart trials. No secret, seat token, admin token or Cloudflare credential is stored here.

---

## 1. Deployment identity

| Item | Value |
|---|---|
| Worker | `mca-multiplayer-staging` |
| Origin | `https://mca-multiplayer-staging.horsemeninteractive.workers.dev` |
| Version ID | `b1030bee-2c89-4a23-addd-f1567b0d818b` |
| Tag | `phase2a11` |
| Deployment message | `Phase 2A.11: durable epochs and continuous match timing (start-preservation)` |
| Build label | `phase2a11-staging` |
| Artifact SHA-256 | `b5081f68a578b1b9af1def18ff889be30620f0a4d84d7d4d7b8227ebfd02396e` |
| Local artifact | `dist-mp-room/roomWorker.js`, same SHA-256 |
| Artifact verified | 2026-10-30T22:58:39Z and rechecked after the test suite |

Source state:

- Branch: `master`
- HEAD: `132ccc8363d5b5bc98b6518b4afd1738dedaad6a`
- Working tree: 152 modified/untracked paths, 0 staged paths
- No deployed source or configuration change was made for this phase
- The Phase 2A.12 evidence harness was adjusted before the recorded trials to reduce status polling; its hash is listed below and it is not part of the production bundle
- `MULTIPLAYER_FEATURE.enabled = false`
- Two-room maximum, daily allowance and 30-minute deadline unchanged

Source hashes used by the deployed build:

```text
c6fa0789f9ac13108a2c4feb50f2ad2434c3b0437ba2810fd4a63511a8f5f8aa  src/multiplayer/roomSnapshot.ts
1450fb913285b3a9ae7f1d037de65db0abbe10b52ef5a647b82ce87bb77842ef  src/sim/game.ts
f2beb9e69c450bc2b7494671c31a55224b5e531a7751696262ae69699c86c600  src/multiplayer/roomDurableObject.ts
a0eed242ac7f3e0ed9232ddd56476212629613e730037026ede2e203cff2acb8  tools/phase2a12-soak.mjs
```

The harness changed before the trials to reduce status polling from 1 Hz to 10 s normally and 250 ms only around restarts. This was necessary because 1 Hz polling for the whole match added diagnostic load that did not belong in the recovery evidence. The final harness hash above is the version used for both recorded trials.

---

## 2. What was and was not run

### Run

Two short two-seat trials, each with two forced Durable Object restarts:

| Label | Room ID | Started | Ended | Restart A | Restart B | Outcome |
|---|---|---|---|---|---|---|
| `phase2a12-dry5` | `phase2a12-dry5-mvvkfozt` | 2026-10-30T22:50:39.226Z | 2026-10-30T22:51:45.853Z | Passed at 1,633 ms checkpoint age | **Restore failed at 12,633 ms** | FAIL |
| `phase2a12-dry6` | `phase2a12-dry6-mvvkj37a` | 2026-10-30T22:53:17.572Z | 2026-10-30T22:54:47.463Z | Passed at 1,583 ms | Passed at 12,596 ms | PASS, short trial only |

Each trial used 90 s match duration (80 s target plus harness allowance), two connected seats, balanced move/produce/attack commands every 5 s, real authoritative simulation and 15 s checkpoints.

### Not run

- **No 30-minute soak.** The phase was stopped after the confirmed restore defect. A state-dependent recovery failure means a single 30-minute pass could not establish reliability, and changing the deployed artifact would have invalidated the build under test.
- **No restart at 13–14 s checkpoint age.** Restart B occurred at ~12.6 s. The 13–14 s extreme and a restart during an in-flight snapshot write remain untested.
- **No direct post-reconnect stale-command replay.** Stale sync/delta rejection is evidenced; command-level stale authority is covered by local tests but not directly replayed on staging.

---

## 3. Failure evidence

### `phase2a12-failure.json`

Machine-readable capture of the `dry5` failure:

- Restart A success and rollback.
- Restart B checkpoint age, pre-tick, expected rollback and socket close times.
- `503 room-state-unavailable`.
- Worker error `Saved targetId references an unknown entity.`
- Secondary final-snapshot error.
- Capacity recovery after the lease expired.

### `phase2a12-failed-room-status.json`

Direct status response from the failed room:

```json
{"ok":false,"code":"room-state-unavailable","message":"Room snapshot could not be restored."}
```

### `phase2a12-tail-errors.txt`

Worker log excerpt containing the restore and final-snapshot errors. The raw Worker tail is `phase2a12-tail.log`.

### `phase2a12-dry5-2026-10-30T22-50-38-375Z/`

| File | Content |
|---|---|
| `run.log` | Timestamped match and restart timeline |
| `restart-0.json` | Full Restart A recovery record (epochs, syncs, deltas, commands, stale rejection) |
| `restart-0-status-*.json` | Status before and immediately after Restart A restore |
| `restart-1-status-before.json` | Status immediately before Restart B; tick 1,156, epoch 1,027 |
| `summary.json` | Aborted trial summary; `server: null`, no final result |
| `metrics.jsonl` | Per-event harness metrics |
| `status-samples.jsonl` | Bounded status samples |
| `room.json` | Created room identity |

There is no `restart-1.json` because the room never restored.

---

## 4. Passing short trial evidence

### `phase2a12-dry6-2026-10-30T22-53-16-754Z/`

| File | Content |
|---|---|
| `run.log` | Timestamped full short-match timeline |
| `summary.json` | Match, restart, recovery, transport and reconstruction summary |
| `restart-0.json` | Restart A timing, epoch, sync/delta/command latencies, stale rejection |
| `restart-1.json` | Restart B timing, epoch, sync/delta/command latencies, stale rejection |
| `restart-0-status-before.json` | Pre-restart A authoritative status |
| `restart-1-status-before.json` | Pre-restart B authoritative status |
| `restart-*-status-restored-before-connect.json` | Restored state before clients reconnect |
| `status-final.json` | Final result, closure, reservation and diagnostics |
| `metrics.jsonl` | Per-event metrics |
| `status-samples.jsonl` | Bounded status polling samples |
| `room.json` | Created room identity |

Key values:

- Restart A: age 1,583 ms, rollback 32 ticks / 1,600 ms, epochs 1,026.
- Restart B: age 12,596 ms, rollback 253 ticks / 12,650 ms, epochs 2,052.
- Final epoch: 2,054 on both seats.
- Start and deadline unchanged at both restarts.
- First sync 389–408 ms after socket close; first delta 30–91 ms later; first commands accepted.
- Stale sync and delta rejected with `epoch-mismatch`.
- First resync accepted; duplicate rate-limited.
- Zero valid-update rejections.
- Final tick 1,496 on both clients; victory/defeat both delivered.
- Reservation `r223` released; room closed `match-finished`.

### `phase2a12-summary.json`

Compact machine-readable summary of both trials, the defect, automated verification and limitations.

---

## 5. Platform metric capture

Platform data came from the Cloudflare GraphQL API, not from elapsed-time inference.

### Datasets

1. `durableObjectsPeriodicGroups`
   - Filter: room name, window
   - Dimensions: `datetime`, `namespaceId`, `name`, `objectId`, `coloCode`
   - Sums: `cpuTime`, `activeTime`, `duration`, WebSocket message counts, rows read/written, subrequests, `exceededCpuErrors`, `exceededMemoryErrors`, `fatalInternalErrors`
   - Max: `memoryUsageBytes`, `activeWebsocketConnections`
   - Quantiles: memory p50/p90/p99/p999

2. `durableObjectsInvocationsAdaptiveGroups`
   - Filter: room name, window
   - Dimensions: `datetime`, `namespaceId`, `name`, `objectId`, `scriptVersion`, `status`, `type`
   - Sums: `requests`, `errors`, `responseBodySize`, `wallTime`
   - Quantiles: CPU and wall p50/p90/p95/p99

3. `durableObjectsStorageGroups`
   - Namespace and window filter
   - Returned no rows for this namespace/window; no platform stored-byte series is available.

### Captured files

| File | Content |
|---|---|
| `phase2a12-platform-periodic.json` | Raw periodic rows for `dry5` and `dry6`, totals and peak memory |
| `phase2a12-platform-invocations.json` | 61 invocation groups / 178 requests, status breakdown and CPU quantile range |

### Coverage and resolution

- `dry6`: 3 active periodic minute buckets (22:53:17, 22:53:34, 22:54:17).
- `dry5`: 5 periodic buckets.
- `dry6`: 61 adaptive invocation groups, 178 requests.
- CPU is **aggregate per object-minute**, not per tick.
- CPU per tick is a derived aggregate average only.
- Memory is a per-minute maximum, not retained heap.
- No isolate heap profile or allocation attribution was available.
- `fatalInternalErrors` counts include the deliberate staging restarts; they are not simulation failures.
- No CPU or memory limit events occurred.

**The 10 ms individual-tick CPU target remains unverified.**

### Re-querying

The GraphQL windows were:

- `dry5`: `2026-10-30T22:50:00Z` to `2026-10-30T22:52:30Z`
- `dry6`: `2026-10-30T22:53:00Z` to `2026-10-30T22:55:10Z`

The queries use the room `name` and the staging account. The account tag is redacted in the evidence files. No API token is stored in this directory. A re-query requires a Cloudflare credential with Workers observability access.

---

## 6. Automated verification evidence

| File | Result |
|---|---|
| `phase2a12-typecheck-pre.log` | Pass |
| `phase2a12-vitest-pre.log` | 96 files / 959 tests pass |
| `phase2a12-build-pre.log` | Pass |
| `phase2a12-smoke.json` | 15/15 deployed checks pass |
| `phase2a12-lifecycle-pre-results.json` | 6/6 lifecycle/capacity checks pass; `200,200,503,200` |
| `phase2a12-typecheck-post.log` | Pass |
| `phase2a12-vitest-post.log` | 96 files / 959 tests pass |
| `phase2a12-build-post.log` | Pass |
| `phase2a12-smoke-post.json` | 15/15 deployed checks pass |
| `phase2a12-lifecycle-post-results.json` | 6/6 lifecycle/capacity checks pass; `200,200,503,200` |
| `phase2a12-bundle-scan.txt` | No staging markers in production bundle |
| `phase2a12-deploy-status-before.log` | Active version and deployment identity |

The test suite count is unchanged because this phase added evidence tooling, not production behaviour. That is not proof of unchanged behaviour; the focused recovery checks above are the relevant evidence.

---

## 7. Safety and preservation

- Staging only; production was not deployed to.
- `MULTIPLAYER_FEATURE.enabled` remains false.
- Two-room maximum and daily allowance unchanged.
- 30-minute configured maximum unchanged.
- No paid service, billing change, plan upgrade or paid observability.
- No simulation, combat, pathfinding or protocol change.
- No commit, stage, reset or clean was performed.
- The pre-existing 152-path working tree was left intact.
- The failed room's reservation was not force-deleted; the later capacity check passed after its lease stopped blocking admission.
