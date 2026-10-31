# Phase 2A.14 evidence README

**Canonical run:** `staging-evidence/phase2a14-30m-final-2026-10-31T01-14-57-709Z/`
**Room:** `phase2a14-30m-final-mvvplakw`
**Build:** `9fd1dcf4-3046-438d-b72d-0c3880b0afc5` / tag `phase2a13`
**Artifact SHA-256:** `cfca794ca41719449fd827fcd06b13ddbdb806c2b7d54a02703e9c4959396f1a`
**Health label:** `phase2a13-staging`
**Verdict:** **CONDITIONAL** — operational soak passed; combat workload was one-sided and the deployed final snapshot bytes were not independently re-read.

The full analysis and verdict are in [`MULTIPLAYER_PHASE_2A_14_SOAK_REPORT.md`](../MULTIPLAYER_PHASE_2A_14_SOAK_REPORT.md).

---

## 1. What was run

One 30-minute, two-seat authoritative match against the isolated staging Worker:

- Target duration: 1,800,000 ms.
- Command cadence: one command every 5 s per seat.
- Production: one engineer every 180 s per seat while the Command Post queue had room.
- Bounded combat probes: 45 s probe windows every 240 s, two combat units, attack-move.
- Direct attack: attempted when a visible enemy and at least four combat units were present.
- Two controlled Durable Object restarts at 300 s and 1,080 s.
- Restart A targeted 1.5 s after an observed checkpoint; restart B targeted 12.5 s after an observed checkpoint.
- Existing 15 s checkpoint interval, 20 s keepalive, 15 s persistence and 30-minute deadline were unchanged.

The harness deliberately does not generate continuous mass-order bursts for the whole match.

### Command totals

| Seat | Accepted | Move | Attack-move | Produce | Direct attack | Rejected | Timeouts |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | 360 | 296 | 53 | 10 | 1 | 0 | 0 |
| 1 | 360 | 350 | 0 | 10 | 0 | 0 | 0 |
| **Total** | **720** | **646** | **53** | **20** | **1** | **0** | **0** |

Command volume was balanced. Combat was not: all attack-move probes and the only direct attack came from seat 0 because the harness used one global probe schedule. This is documented as a coverage limitation, not a protocol failure.

---

## 2. Canonical run files

All paths below are relative to `staging-evidence/phase2a14-30m-final-2026-10-31T01-14-57-709Z/`.

| File | Contents |
|---|---|
| `summary.json` | Harness summary: room, results, reconstruction, command counts, keepalive, transport, client memory, checkpoints |
| `metrics.jsonl` | Timestamped event stream: command send/result, checkpoints, socket closes, reconnects, 30 s intervals, state samples |
| `status-samples.jsonl` | 189 sanitized room status samples (10 s normally, 250 ms around restarts) |
| `restart-0.json` | Controlled restart A: request/close/restore timestamps, checkpoint age, rollback, per-seat sync/delta/command/resync/stale results, epoch |
| `restart-1.json` | Controlled restart B: same fields |
| `restart-0-status-before.json` | Room status immediately before A |
| `restart-0-status-restored-before-connect.json` | Room status after A restore, before reconnect; tick 5,999 |
| `restart-1-status-before.json` | Room status immediately before B |
| `restart-1-status-restored-before-connect.json` | Room status after B restore, before reconnect; tick 21,599 |
| `status-final.json` | Final room status: timing, result, diagnostics, reservation |
| `unplanned-restart.json` | Observed third restart at 01:25:56.044Z: close/reconnect/restore, rollback, first commands, client ticks |
| `phase2a14-analysis.json` | Machine-readable analysis generated from the files above; direct observations separated from derived values |
| `run.log` | Harness console log |
| `../phase2a14-analysis-console.log` | Analysis command output |

### Supporting files at `staging-evidence/`

| File | Contents |
|---|---|
| `phase2a14-platform-periodic.json` | Raw Cloudflare `durableObjectsPeriodicGroups` rows for the room object |
| `phase2a14-platform-invocations.json` | Raw Cloudflare `durableObjectsInvocationsAdaptiveGroups` groups |
| `phase2a14-platform-analysis.json` | Derived CPU/memory early/middle/late summary |
| `phase2a14-deployment-verification.json` | Active version, tag, health and artifact-hash verification |
| `phase2a14-deployments-post.log` | `wrangler deployments list` output |
| `phase2a14-version-post.log` | `wrangler versions view` output |
| `phase2a14-artifact-post.txt` | SHA-256 of local uploaded `dist-mp-room/roomWorker.js` |
| `phase2a14-health-post.json` | Health endpoint after the soak |
| `phase2a14-smoke-pre.log`, `phase2a14-smoke-post.log` | 15-check protocol/security smoke, both passed |
| `phase2a14-lifecycle-pre.log`, `phase2a14-lifecycle-post.log` | Six lifecycle/capacity checks, both passed |
| `phase2a14-typecheck-pre.log`, `phase2a14-typecheck-post.log` | TypeScript checks |
| `phase2a14-build-pre.log`, `phase2a14-build-post.log` | Production builds |
| `phase2a14-vitest-pre.log`, `phase2a14-vitest-post.log` | Full Vitest runs, 97 files / 980 tests |
| `phase2a14-bundle-scan-post.txt` | Production bundle staging-marker scan |
| `phase2a14-postchecks.json` | Machine-readable summary of all post-checks |
| `phase2a14-worker-tail.log` | Wrangler tail capture; may include adjacent room traffic, not the canonical room record |

### Preserved non-canonical runs

| Path | Note |
|---|---|
| `phase2a14-30m-2026-10-31T01-00-52-829Z/` | Earlier 30-minute attempt; aborted after restart A because seat 0 had no controllable units for the post-restart command check. Preserved, not used for the verdict. |
| `phase2a14-dry-2026-10-31T01-08-25-378Z/` | Short harness validation run |
| `phase2a14-dry2-2026-10-31T01-11-36-750Z/` | Short harness validation with both restarts |
| `phase2a14-30m-console.log` | Console output from the aborted run |
| `phase2a14-30m-final-console.log` | Console output from the canonical run |

The aborted attempt is a workload-design failure, not a recovery failure: the restart restored, but the harness required a post-restart command from both seats and seat 0 had no remaining controllable units. The final workload keeps both seats active.

---

## 3. Key observations

| Observation | Value |
|---|---|
| Match start / finish | 2026-10-31T01:14:58.524Z / 01:44:58.373Z |
| Server elapsed | 1,799,849 ms |
| Whole-match ticks | 35,477 |
| Effective rate | 19.7111 Hz |
| Expected at 20 Hz | 35,997 |
| Deficit | 520 ticks; 453 measured rollback + 67 downtime/scheduling |
| Commands | 720 accepted, 0 rejected, 0 timeouts |
| Result | seat 0 defeat, seat 1 victory, team 1, `time-limit`, tick 35,477 |
| Final reconstruction | tick 35,477 both; epoch 3,083 both; seq 17,743 both |
| Room | closed, `match-finished` |
| Reservation | `r266`, released once |
| Capacity after release | 200, 200, 503, 200 |
| Persistence failures | 0 |
| Final snapshot | 262,370 bytes, written 44 ms after finish |
| Platform CPU | 19,281.124 ms aggregate; 642.937 ms per active minute; 1.0716% of active time |
| Platform memory | 14.12 MiB first, 49.22 MiB final/peak; +35.10 MiB over the match |
| Keepalive | 89/89 per seat; no timeout or rate limit |
| Rejected legitimate updates | 0 |

### Restart summary

| Event | Checkpoint age at close | Restored tick | Rollback | First sync (seat 0 / 1) | First command (seat 0 / 1) | Epoch before -> after |
|---|---:|---:|---:|---:|---:|---|
| A | 2,064 ms | 5,999 | 39 ticks / 1,950 ms | 483 / 431 ms | tick 6,002 / 6,003 | 2 -> 1,026 |
| B | 12,796 ms | 21,599 | 255 ticks / 12,750 ms | 357 / 347 ms | tick 21,603 / 21,603 | 2,054 -> 3,079 |
| Unplanned | 10,026 ms | 12,900 | 159 ticks / 7,950 ms | not captured | tick 12,932 / 12,950 | not captured |

The unplanned restart is separate from the two controlled trials. It recovered with both seats and no rejected updates.

### Checkpoint rollback accounting

- A: pre-tick 6,038; restored 5,999; 39 ticks.
- B: pre-tick 21,854; restored 21,599; 255 ticks.
- Unplanned: last accepted command tick 13,059; restored 12,900; 159 ticks.
- Sum: 453 ticks. The remaining 67 ticks of the 520-tick whole-match deficit are restart downtime, reconnect/restore latency and tick scheduling.
- Commands accepted after the last checkpoint were lost in rollback: A tick 6,039, B tick 21,854. This is expected under the unchanged checkpoint policy.

### Snapshot integrity

- Restored playing snapshots at ticks 5,999 and 21,599 passed strict validation.
- No `Saved targetId references an unknown entity` error.
- No `A playing room snapshot cannot have a finish time` error.
- Final status is finished, with final result and finish time.
- Final snapshot write succeeded; zero persistence failures.
- The exact deployed final snapshot bytes were **not** re-read; closed rooms are intentionally not restored. The Phase 2A.13 17-test suite covers finalisation and invalid-reference rejection.

### Epoch and stale authority

- At A and B, the restored epoch was strictly greater than the pre-restart epoch for both seats.
- Replayed pre-restart sync and delta messages were rejected with `epoch-mismatch`.
- Legitimate resync was accepted; an immediate duplicate was rate-limited.
- No legitimate current-epoch update was rejected.

### Half-open connections

No half-open socket was observed. All restart-driven closes delivered a close event (no close code); both clients reconnected on the first attempt. Final closes were code `1000`, reason `match-finished`. No keepalive timeout or stale connection regained authority.

---

## 4. Metric coverage and limitations

### CPU

Cloudflare `durableObjectsPeriodicGroups` contributed 32 active object-minute rows covering 1,799.3 s. It is aggregate CPU per object-minute, not per invocation or per tick. `durableObjectsInvocationsAdaptiveGroups` contributed 241 adaptive groups / 369 requests, not an individual invocation census. No CPU-limit field was present.

**The 10 ms individual-tick CPU target is not verified.** Aggregate CPU divided by whole-match ticks is context only.

### Memory

`memoryUsageBytes` is the maximum isolate memory observed in an active object-minute bucket. It is not retained application heap. The trend is reported as observed platform memory, not as proof of application-owned growth or a leak.

### Snapshot references

The harness can validate snapshots only by restoring them. It restored the A and B snapshots and validated the finalisation code through tests, but it cannot read every persisted chunk or the final snapshot from outside the Durable Object. Continuous per-snapshot reference validation is not claimed.

### Artifact verification

Cloudflare version metadata does not expose a downloadable module digest. The active version ID, tag, creation time, health label and deployment history were checked. The local uploaded bundle still hashes to the recorded digest. This is not a byte-for-byte download of the deployed module.

### Unplanned restart

The unplanned restart was not scheduled by the harness, so its pre/post protocol epoch was not captured. Its recovery is evidenced by close/reconnect/restore times, accepted post-restart commands and both clients reaching tick 12,964. The final epoch high-water mark and the two controlled trials remain monotonic.

### Workload balance

Command volume is balanced 360/360. Combat is not: seat 0 issued 53 attack-move probes and one direct attack; seat 1 issued none. The run is a two-seat command/transport/recovery soak, not a symmetric combat stress test.

---

## 5. Reproduction

The harness and analysis tool are verification-only and do not change the deployed artifact.

### Full soak (already run)

```bash
MP_ADMIN_TOKEN=<staging-token> \
MP_SOAK_MS=1800000 \
MP_SOAK_LABEL=phase2a14-30m-final \
MP_RESTART_OFFSETS=300000,1080000 \
MP_RESTART_AGES=1500,12500 \
node tools/phase2a14-soak.mjs
```

The harness creates its own room, writes the evidence directory and never writes seat/admin tokens to evidence.

### Re-run the analysis

```bash
node tools/phase2a14-analyse.mjs \
  staging-evidence/phase2a14-30m-final-2026-10-31T01-14-57-709Z
```

### Post-checks

```bash
npm run typecheck
npm run build
npm test
MP_EXPECT_BUILD=phase2a13-staging node tools/phase2a-deployed-smoke.mjs
MP_EXPECT_BUILD=phase2a13-staging node tools/phase2a1-failure-tests.mjs
```

The smoke and lifecycle commands write their own JSON/log output; the logs in this directory are the captured results.

---

## 6. Verdict

**CONDITIONAL.** The exact Phase 2A.13 build completed the full match, recovered from both controlled restarts and an unplanned restart, preserved epochs/deadlines, wrote final state, closed the room and released the reservation once. All automated, security, lifecycle, capacity and bandwidth checks passed.

The remaining gaps are evidence coverage:

1. Combat orders were one-sided; only seat 0 exercised attack-move and direct attack.
2. The deployed final snapshot bytes were not independently re-read and strictly validated.
3. Per-checkpoint target-reference integrity was validated at the two restores, not for every persisted snapshot.
4. The unplanned restart's pre/post epoch was not captured.
5. The 10 ms individual-tick CPU target remains unverified.

No production deployment, feature-flag change, capacity increase, daily-allowance change, checkpoint change or protocol change occurred. The two-room maximum and 30-minute deadline are unchanged.
