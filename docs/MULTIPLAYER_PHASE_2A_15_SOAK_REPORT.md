# MCA — Phase 2A.15: Two-Sided Combat and Snapshot Integrity Soak

**Verdict: CONDITIONAL**

The exact Phase 2A.13 artifact completed a full 30-minute two-seat match, recovered
from both planned runtime restarts inside the 15-second checkpoint policy, kept
seat epochs monotonic, rejected stale authority, delivered zero rejected updates,
persisted 123 snapshots with no failures, and finished, closed and released its
reservation correctly. Both seats now demonstrate real combat: attack-move and
direct-attack orders, observed hits, and target destruction.

Two evidence requirements are not met:

1. **The exact final persisted snapshot was not independently read and validated.**
   The deployed 2A.13 artifact exposes no route that returns stored snapshot bytes,
   and the phase forbids changing the artifact under test. The final snapshot was
   written successfully and passed the room's own lifecycle/timing validation on
   the write path, but `validateRoomSnapshot` was not run against the stored bytes.
2. **Combat did not continue to the end of the match.** The harness exhausted each
   seat's combat units by restart B, so the last 11.7 minutes contain commands,
   snapshots and ticks but no hits or destructions. Combat is proven on both sides
   and after restart A, but not after restart B.

Neither gap is a server-side recovery, authority, persistence or lifecycle failure.
Detail and the two remediation options are in §10 and §17.

---

## 1. Exact deployed artifact verification

Observed, before any test traffic:

| Check | Value | Result |
| --- | --- | --- |
| Worker | `mca-multiplayer-staging` | — |
| Active version (`wrangler deployments list`, 100% of traffic) | `9fd1dcf4-3046-438d-b72d-0c3880b0afc5` | matches |
| Deployment message / tag | "Phase 2A.13: snapshot target integrity and finalisation ordering" / `phase2a13` | matches |
| Version created | `2026-10-31T00:02:04.043Z` | matches the 2A.13 record |
| Health `build` | `phase2a13-staging` | matches |
| Health protocol / snapshot version | `mca.v2` / `2` | unchanged |
| Local bundle `dist-mp-room/roomWorker.js` SHA-256 | `cfca794ca41719449fd827fcd06b13ddbdb806c2b7d54a02703e9c4959396f1a` | matches the recorded artifact |

The health document also reports `onlineEnabled: true`, `devMode: true`,
`adminConfigured: true`, `reservationConfigured: true`. No artifact was deployed,
rebuilt or replaced at any point in this phase.

## 2. Match duration and whole-match authoritative tick count

Room `phase2a15-30m-mvwngsja`, mode `1v1`, requested match duration 1,800,000 ms.

| Measure | Value | Source |
| --- | --- | --- |
| Match start (`startedAtMs`) | `2026-10-31T17:03:15.398Z` | room status |
| Match finished (`finishedAtMs`) | `2026-10-31T17:33:15.229Z` | room status |
| Measured elapsed | 1,799,831 ms (29 min 59.83 s) | derived |
| Whole-match ticks (`totalTicks`) | **35,683** | durable counter |
| Process-local ticks after final restore | 14,083 | process counter |
| Theoretical ticks at 20 Hz | 35,997 | derived |
| Whole-match effective rate | **19.826 Hz** | derived |
| Harness wall clock to summary | 1,799,793 ms | harness |

Derived: the 314-tick shortfall against the ideal 20 Hz is the two restarts'
rollback (37 + 260 ticks = 297) plus roughly 17 ticks of wall time lost while the
object reloaded and the seats reconnected. It is not a sustained rate deficiency:
interval sampling shows 600 ticks per 30 s step throughout the match.

The hard deadline was `1793467995229` (17:33:15.229Z), which is 169 ms *earlier*
than start + 1,800,000 ms. The deadline comes from the reservation's hard
deadline, which is created before the match starts, so it is conservative by that
169 ms and can never extend the match. It was identical before and after both
restarts.

## 3. Per-seat command and combat activity

Harness workload: a move/attack-move order every 5 s per seat, production every
180 s, a bounded attack-move probe every 240 s per seat (45 s window, two combat
units), and a direct attack every 240 s per seat against a visible enemy combat
unit when at least two combat units are available. Every probe clock, probe
target, attack cooldown and replacement counter is now **per seat**.

| Measure | Seat 0 | Seat 1 |
| --- | --- | --- |
| Commands sent | 361 | 360 |
| Commands accepted (client-observed) | 361 | 360 |
| Commands rejected | 0 | 0 |
| Command timeouts | 0 | 0 |
| Accepted `move` | 350 | 348 |
| Accepted `produce` | 10 | 10 |
| Accepted direct `attack` | 1 | 2 |
| Accepted attack-move (`probe`) | 27 | 25 |
| Order replacements (combat order → move/attack-move within 120 s) | 22 | 44 |

Command acknowledgement latency over both seats: n=721, p50 13 ms, p95 18 ms,
p99 44 ms, max 101 ms, min 10 ms. Server-side rejection counters are zero; the
client never saw a `commandRejected`.

Process-local server counters reset at each restart, which is why the server's
`commandsAccepted` (281) is smaller than the whole-match client count (721). The
two are reported separately and are not compared as if they were the same window.

## 4. Evidence of actual combat and target destruction

Combat is counted from each seat's **delivered projection event stream**, not from
command acknowledgements: an `impact` event carrying `hit` and that seat's team,
and `unitLost` / `buildingLost` events naming the other team. Each event is
counted once by `seq`.

| Measure | Seat 0 | Seat 1 |
| --- | --- | --- |
| Observed hits on enemies | **77** | **33** |
| Enemy units destroyed (witnessed) | **5** | **6** |
| Enemy structures destroyed | 0 | 0 |
| Own units lost | 6 | 5 |

At restart A (17:08:17.865Z) the live counters were 66/29 hits, 4/2 enemy units
destroyed and 13/9 attack-move orders. At restart B (17:21:31.343Z) they were
77/33 hits, 5/6 enemy units destroyed, 27/25 attack-move orders, 1/2 direct
attacks and 22/44 order replacements. Those are the final values as well: no hit
or destruction is recorded after 17:21:31.

So both seats independently issued attack-moves *and* direct attacks, both landed
damage, both destroyed enemy units, and both replaced combat orders with movement
after doing so — the Phase 2A.13 target-cleanup path. Combat continued **after
restart A** and grew across that boundary. It did not continue after restart B;
see §16.2.

`visibleEnemies` in the 60-second state samples is 0 from roughly minute 6 until
the end, which is consistent with the counters: after the last probe window the
seats had no contact, so there was nothing to shoot at.

## 5. Timestamped restart timeline

| Event | Restart A | Restart B |
| --- | --- | --- |
| Planned offset from start | 300,000 ms | 1,080,000 ms |
| Fresh checkpoint observed | 17:08:15.590Z (tick 6,005) | 17:21:17.937Z (tick 21,607) |
| Last persistence success | 17:08:15.420Z | 17:21:17.720Z |
| Restart requested | 17:08:17.179Z | 17:21:30.600Z |
| Restart accepted | 17:08:17.218Z | 17:21:30.641Z |
| Sockets closed (seat 0 / 1) | 17:08:17.274Z / 17:08:17.270Z | 17:21:30.691Z / 17:21:30.693Z |
| Object reloaded from storage | 17:08:17.541Z | 17:21:30.971Z |
| Restored snapshot tick | 5,999 | 21,600 |
| First sync delivered (seat 0 / 1) | 17:08:17.648Z / 17:08:17.640Z | 17:21:31.086Z / 17:21:31.091Z |
| Recovery record complete | 17:08:17.869Z | 17:21:31.343Z |
| First command accepted | tick 6,002 / 6,003 | after restore, both seats |
| Room resumed state tick | 6,004 / 6,004 | 21,604 / 21,604 |

No other socket close appeared outside those two windows: the four null-code
closes in the run are exactly the two restarts × two seats, and the two final
closes are `1000 match-finished`. `unplannedCloses` is empty, so **no unplanned
restart occurred** in this run. No half-open socket was observed: every seat
acknowledged 89 keepalives (server received and acked 70, rate-limited 0).

## 6. Checkpoint age and rollback measurements

Observed (`restart-N.json`, status immediately before the restart):

| Measure | Restart A | Restart B | Policy |
| --- | --- | --- | --- |
| Actual checkpoint age at request | **1,759 ms** | **12,880 ms** | ≤ 15,000 ms |
| Harness checkpoint age at request | 1,589 ms | 12,663 ms | ≤ 15,000 ms |
| Age within 15 s | yes | yes | required |
| Last authoritative tick before restart | 6,036 | 21,860 | — |
| Restored snapshot tick | 5,999 | 21,600 | — |
| Tick rollback | **37** | **260** | — |
| Rollback in elapsed time | **1,850 ms** | **13,000 ms** | ≤ 15 s |
| Rollback within interval | yes | yes | required |
| Restored snapshot lag from the observed checkpoint tick | 6 ticks | 7 ticks | — |
| Persistence failures before/after | null / null | null / null | none |

Restart A sits in the intended 1–2 s band; restart B sits in the intended
12–14 s band and is the closest measured approach to the 15-second interval
(13,000 ms of rollback, 2,000 ms of headroom). Both restores landed on the
persisted checkpoint, not on a later state, and the 6–7 tick difference between
the sampled checkpoint tick and the restored tick is the chunked index's write
order, measured rather than assumed.

## 7. Epoch continuity for both seats across every restart

The protocol `epoch` is the seat/sync generation the client must exceed before
accepting an update; it is persisted and must advance on restore.

| Point | Seat 0 | Seat 1 |
| --- | --- | --- |
| Before restart A | 2 | 2 |
| Durable generation after restore A | **1,026** | **1,026** |
| Before restart B | 1,029 | 1,029 |
| Durable generation after restore B | **2,054** | **2,054** |
| End of match | 2,058 | 2,058 |
| Monotonic across every restart | yes | yes |

Because only two planned restarts occurred, the unplanned-restart epoch gap that
2A.14 could not capture does not arise in this run; every restart in this match
has before/after values for both seats.

The harness replayed a pre-restart `sync` and `delta` on both seats after each
restore. Both were rejected `epoch-mismatch` ("Sync epoch did not advance." /
"Delta belongs to another sync generation."), so saved pre-restart messages cannot
regain authority. Legitimate current-generation traffic was accepted on the first
attempt: first delta 36–88 ms after first sync. Nothing in the client's
strictly-newer rule was relaxed.

## 8. Reconnect, resync and first-valid-update latency

| Measure | Restart A seat 0 | A seat 1 | Restart B seat 0 | B seat 1 |
| --- | --- | --- | --- | --- |
| Handshake to 101 | 109 ms | 101 ms | 117 ms | 119 ms |
| First sync after socket close | 374 ms | 366 ms | 393 ms | 398 ms |
| First delta after sync | 36 ms | 46 ms | 88 ms | 81 ms |
| First command accepted | yes (tick 6,002) | yes (tick 6,003) | yes | yes |
| First command latency after sync | 73 ms | 96 ms | — | — |
| First sync carried full map | yes | yes | yes | yes |
| Resync accepted | yes | yes | yes | yes |
| Immediate duplicate resync rate-limited | yes | yes | yes | yes |

Both seats received a full restored snapshot (map and fog, 6,912 tiles each)
before deltas, and both issued accepted commands within ~100 ms of that sync. The
four `resync-rate-limited` errors in the run are the harness's deliberate
duplicate-resync probe — two seats × two restarts — and are marked `expected:
true`. No other server error occurred.

## 9. Snapshot-reference integrity

Directly observed:

- `assemblyRejects` = 0 over both seats for the whole match; no update was
  rejected by the client, for epoch, sequence or base reasons.
- Both restores ran the room's strict restore path (`restoreRoomSnapshot` →
  `validateRoomSnapshot`) against the persisted bytes and succeeded. A snapshot
  containing an invalid `targetId`, `buildTargetId`, `repairTargetId` or `homeId`
  would have failed the restore and aborted the match; it did not.
- 123 snapshot cycles were written across the three processes with
  `failures: 0`, `serialization: 0`, `send: 0`, `controlSend: 0`, `slowClient: 0`.
- The match issued 22 (seat 0) and 44 (seat 1) order replacements immediately
  after accepted combat orders, which is exactly the 2A.13 cleanup sequence, and
  no snapshot write or restore failed afterwards.
- The final snapshot (261,506 bytes) was the most recent successful write when
  the final status was taken: `lastSuccessAt` 1793467995281, `ageSinceSuccessMs`
  54, `behind: false`.

Not directly observed: a per-field read of any persisted snapshot's entity
references. The room exposes no such read path (§10), so this section is
inference from strict restore validation and clean persistence, not a byte-level
reference audit.

## 10. Exact final persisted snapshot — blocked

Required: read the stored final snapshot bytes and pass **those** through
`validateRoomSnapshot`.

What exists in the deployed artifact:

- `SnapshotIndex` (version 1) stores only `generation`, `chunks`, `length`,
  `tick`, `updatedAt` — no hash, no copy of the payload.
- The payload is stored as chunks under `snapshot:<generation>:<index>` in the
  Durable Object's storage.
- The room's only actions are `create`, `status`, `shutdown`, `restart` and `ws`.
  The compiled artifact `dist-mp-room/roomWorker.js` contains exactly
  `internal/create`, `internal/restart`, `internal/shutdown`, `internal/status`
  and no snapshot route (grep for `snapshot=`, `internal/snapshot`, `?snapshot`
  returns 0 matches).
- `status` returns diagnostics, timing, lifecycle, reservation and result, but not
  snapshot bytes.
- Durable Object storage is not reachable from outside the object; there is no
  D1/R2 binding to read and no wrangler command that reads a DO's storage.

Consequences:

- Reading the exact bytes **requires a code change and a new deployment** (a
  narrowly scoped, admin-token + dev-mode gated, read-only action such as
  `status?snapshot=stored`, returning the assembled persisted string with its
  SHA-256, byte length and index fields). That deployment would no longer be the
  exact 2A.13 artifact, and this phase forbids altering the artifact under test
  without stopping first.
- Therefore this report claims only: the final snapshot **was written
  successfully** (persistence `lastSuccessAt` 54 ms before status, 261,506 bytes,
  zero failures) and **passed the write path's own validation** — room id, seat
  table and `validateTiming` (which is what rejects a playing room carrying a
  finish time, and a finished room without one). It does **not** claim that
  `validateRoomSnapshot` accepted the stored bytes.
- No room was reopened and no restore was performed for evidence collection. The
  final snapshot is exactly what the normal close wrote.

## 11. Finalisation and room closure

Observed in `status-final.json`:

| Field | Value |
| --- | --- |
| `closed` / `closedReason` | true / `match-finished` |
| `match.phase` | `finished` |
| `finalResult.reason` | `time-limit` |
| `finalResult.winnerTeam` | 0 |
| `finalResult.tick` | 35,683 |
| `matchTiming.finishedAtMs` | 1793467995229 (equals the deadline) |
| `matchTiming.startedAtDerived` | false |
| Reservation | `r292`, status `released`, hard deadline 1793467995229 |
| Reservation heartbeat successes / failures | 35 / 0 |
| Reservation release successes / failures | **1 / 0** |
| Persistence failures | 0, `behind: false` |

Both seats received a `result` message with the same tick and the matched
outcome: seat 0 `victory` (team 0), seat 1 `defeat`, both `time-limit`, tick
35,683. Final server scores: team 0 = 6,021.3, team 1 = 5,820.1, neither defeated.
The room then closed both sockets with code 1000, reason `match-finished`.

There is no evidence of a double release, an unguarded release, or a release
failure, and the final snapshot was not written with a playing-room finish time
(the write path's timing validator would have thrown and the persistence cycle
would have failed; it did not).

## 12. Persistence, CPU, memory and transport metrics

Persistence, summed over the three processes (each restarts its own diagnostic
counters):

| Measure | Value |
| --- | --- |
| Snapshot cycles | 123 (22 before A, 53 before B, 48 after B) |
| Meta cycles | 210 |
| Storage reads / writes / deletes | 140 / 1,072 / 732 |
| Read bytes / write bytes | 1,022,720 / 31,704,771 |
| Chunks written | 738 |
| Snapshot bytes (last) / max | 261,506 / 261,506 |
| Persistence failures (all kinds) | **0** |
| Cycle duration histograms | present but all zeros — the runtime freezes timer APIs during CPU-only work, so durations are unavailable (`durationsAvailable: false`) |

Checkpoint cadence, derived from 187 status samples (10 s polling): p50 10,022 ms,
p95 20,006 ms, p99 20,023 ms, max 20,027 ms. These values are quantised by the
polling interval, so 10 s and 20 s bins are sampling artefacts, not missed
checkpoints; the room's configured interval is unchanged at 15 s and every
recorded persistence attempt succeeded.

Transport:

| Measure | Seat 0 | Seat 1 |
| --- | --- | --- |
| Sync messages (client-observed) | 11 | 11 |
| Delta messages | 17,985 | 17,985 |
| Sync bytes | 410,329 | 413,248 |
| Delta bytes | 20,610,431 | 23,652,041 |
| Total bytes | 21,020,760 | 24,065,289 |
| Delta size p50 / p95 / p99 / max | 947 / 2,236 / 2,933 / 5,436 B | 1,127 / 2,460 / 2,799 / 4,715 B |
| Fog entries in deltas | 31,775 | 33,559 |
| Longest gap between updates | 505 ms | 505 ms |
| Delta messages carrying map data | 0 (both seats) | 0 |

The first sync is 58,974 / 58,968 bytes and includes the map; across the five
map-bearing syncs per seat the map portion sums to 208,985 bytes, so one map
serialisation is roughly 41.8 kB. Steady state is ~1–1.3 kB deltas at 10 Hz with
no map payload at all. Client-observed sync messages (11 per seat) and the
server's own sync counter (5 per seat) count different lifetimes and are not
expected to match; the client count includes the deliberate duplicate resync.

CPU and memory: **not captured for this run.** The GraphQL collector
(`tools/phase2a2-metrics.mjs`) needs `CLOUDFLARE_API_TOKEN` and `MP_ACCOUNT_ID`,
neither of which is present in this environment. No platform series was
imputed. For reference only, Phase 2A.14's `durableObjectsPeriodicGroups` capture
for the same artifact showed the object below the free-plan envelope; that is a
different run and is not presented as this run's measurement. The 10 ms
individual-tick CPU target remains unverified, and the room's own per-tick
durations are all zero because the runtime froze the clock.

## 13. Snapshot reconstruction and fog-delta validation

| Measure | Seat 0 | Seat 1 |
| --- | --- | --- |
| Assembler ready | true | true |
| Final epoch | 2,058 | 2,058 |
| Final sequence | 17,845 | 17,845 |
| Reconstructed tick | 35,683 | 35,683 |
| Reconstructed phase | finished | finished |
| Map tiles / fog tiles | 6,912 / 6,912 | 6,912 / 6,912 |
| Entities in the final projection | 17 | 20 |
| Tick matches server | yes | yes |
| Outcome matches expected | yes | yes |

Both seats reconstructed the same authoritative tick and phase as the server, and
the same outcome. The initial sync delivered the static map once (208,985 bytes
per seat); every later delta carried no map payload (`deltaMapBytes = 0`), and
fog changes arrived as 31,775 / 33,559 delta entries with no assembly rejection.
No reconnect log shows a missing map: `firstSyncHadMap` is true on all four
post-restart syncs, and `firstSyncFogTiles` is 6,912 on each.

## 14. Final result and guarded reservation release

Covered in §11. In addition, the post-soak lifecycle suite re-ran the capacity
boundary and freed-slot admission: `[200, 200, 503, 200]` with
`rejectedCode: capacity-full`, `aReservation: released`, `freedStatus: 200`. A
fresh room was admitted after the soak's room released, so release is both guarded
(idempotent, one success, zero failures) and effective at the capacity boundary.

## 15. Capacity, security, lifecycle and automated results

All commands run against the verified staging artifact; nothing was deployed.

| Check | Result |
| --- | --- |
| Pre-soak TypeScript typecheck | pass (exit 0) |
| Post-soak typecheck | pass (exit 0) |
| Pre-soak full suite | **98 files, 997 tests, 0 failures** |
| Post-soak full suite | **98 files, 997 tests, 0 failures** |
| Pre-soak deployed smoke | **15/15 checks** (`ok: true`) |
| Post-soak deployed smoke | **15/15 checks** (`ok: true`) |
| Pre-soak lifecycle/capacity | 6/6 checks pass, capacity `[200,200,503,200]` |
| Post-soak lifecycle/capacity | 6/6 checks pass, capacity `[200,200,503,200]` |
| Production build (pre/post) | success, 116.0 kB CSS / 687.5 kB JS, service worker precaches 13 files |
| Staging-only tooling in production bundle | 0 matches for `calibrate`, `calibration`, `runBatchCalibration`, `MP_ADMIN_TOKEN`, `phase2a13-staging`, `dev/assembler` |
| Phase 2A.13 regression tests present | `tests/phase2a13-integrity.test.ts`, **17 tests, passing** |

The smoke's 15 checks: deployed 101 upgrade, two seats connected, team projections
isolated, valid command accepted, forged authority rejected, oversized frame
rejected, wrong token 401, foreign origin 403, duplicate seat 409, resync
checkpoint applied, reconnect accepted on a new epoch, delta carried no map or
full state, result delivered to both seats, reservation released, deployed global
capacity boundary enforced.

The two-room maximum, the daily allowance and the 30-minute deadline were not
changed. `MULTIPLAYER_FEATURE.enabled` remains `false` in the application.

## 16. Remaining limitations

1. **Exact final snapshot validation is blocked** (§10). It needs a staging-only
   read-only snapshot action, which means a new artifact and therefore a fresh run
   to be meaningful.
2. **Combat stopped before the deadline.** The harness lost its combat units: hits
   and destructions are unchanged from 17:21:31 to the end, and `visibleEnemies`
   is 0 in every sample from minute ~6. Commands, snapshots and ticks continued
   normally, so this is a workload-coverage gap, not a stability finding. Combat
   across restart A is proven; combat across restart B is not.
3. **Platform CPU, invocation and memory series are missing** for this run (§12):
   no Cloudflare API token in the environment. Aggregate CPU-per-tick is not
   claimed, and the 10 ms individual-tick target remains unverified.
4. **Checkpoint age is sampled**, not instrumented: the harness reads the room's
   last-success timestamp every 10 s and every 250 ms around a restart, so the
   actual age at the instant of the restart carries up to ~250 ms of uncertainty
   (1,759 vs 1,589 ms and 12,880 vs 12,663 ms are the two clocks).
5. **Per-field snapshot reference audit was not performed**; §9 rests on strict
   restore validation succeeding twice and on zero persistence/assembly failures.
6. **The harness is new code** (`tools/phase2a15-soak.mjs`,
   `tools/phase2a15-analyse.mjs`). Its per-seat fix was validated by a 90-second
   dry run before the soak (both seats produced probes, attacks, hits and
   destructions; both restarts recovered at 1,606 ms and 12,636 ms).
7. **The automated checks describe the current tree, not the artifact.** The local
   tree has advanced past the 2A.13 bundle (the 0.1.3 interface/renderer release).
   Those suites prove the multiplayer code, protocol and validation rules are
   unchanged and green; they are not a build-identity check of the deployed
   worker. The build-identity check for the artifact is §1.

## 17. Verdict and recommended next decision

**CONDITIONAL.**

Passing: exact artifact, full 30-minute completion (35,683 ticks, 19.83 Hz), two
planned restarts recovered inside the policy (1,759 ms / 12,880 ms checkpoint age;
37 / 260-tick rollback, 1,850 / 13,000 ms), monotonic epochs on both seats for
every restart (2 → 1,026 → 2,054 → 2,058), stale messages rejected, first
resync accepted and duplicates rate-limited, zero rejected updates, zero
persistence failures, both seats reconstructing the same tick and outcome,
continuous start time and deadline, correct final result on both seats, clean
closure, single guarded reservation release, admission after release, capacity
`[200,200,503,200]`, 15/15 security checks, 6/6 lifecycle checks, 997 tests,
typecheck and production build green, and no staging tooling in the production
bundle.

Failing the phase's own evidence bar: exact final snapshot validation (§10), and
combat not continuing to the deadline (§16.2).

Recommended next decision — one deployment closes both gaps:

1. Add a staging-only, admin-token + `MP_DEV_MODE` gated, **read-only**
   `status?snapshot=stored` action that assembles the persisted chunks, returns
   them with SHA-256 and byte length, and never mutates, reopens or restores the
   room. Keep it out of the production bundle.
2. Keep combat alive for the full match in the harness: produce a combat unit
   whenever the seat has fewer than three, or widen the probe pool so losses do
   not end contact, and assert `hits` and destructions grow after **every**
   restart.
3. Re-run one 30-minute soak with two restarts on that build, and validate the
   exact final snapshot on the same run.

That build would be a new artifact (it must be, to expose the read path), so it
should be tagged `phase2a16` and treated as the verification build for this
evidence. Do not proceed to production activation, checkpoint redesign or wider
concurrency testing on the strength of this report.
