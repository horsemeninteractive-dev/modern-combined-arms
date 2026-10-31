# Phase 2A.11 evidence index

## Identity

| Property | Value |
| --- | --- |
| Worker | `mca-multiplayer-staging` |
| Active version | `b1030bee-2c89-4a23-addd-f1567b0d818b` |
| Tag | `phase2a11` |
| Build marker | `phase2a11-staging` |
| Snapshot schema | version `2` |
| Source HEAD | `132ccc8363d5b5bc98b6518b4afd1738dedaad6a` |
| Branch | `master` |
| Deployed artifact | `b5081f68a578b1b9af1def18ff889be30620f0a4d84d7d4d7b8227ebfd02396e *dist-mp-room/roomWorker.js` |
| Production multiplayer flag | disabled (`MULTIPLAYER_FEATURE.enabled = false`) |

Source hashes at the end of the phase:

```text
c6fa0789f9ac13108a2c4feb50f2ad2434c3b0437ba2810fd4a63511a8f5f8aa *src/multiplayer/roomSnapshot.ts
601e4318aa4344b98e1ee2ae8644f71a333ce01b5771b796b720194a23ff73a2 *src/multiplayer/roomMatch.ts
f2beb9e69c450bc2b7494671c31a55224b5e531a7751696262ae69699c86c600 *src/multiplayer/roomDurableObject.ts
ff4c3fd3c2a4918ab28116f659fe816d4c66c4f7bb667163c681043feaf1abd8 *src/multiplayer/roomWorker.ts
04a368c0b770c69955c94a698d5553fbf259b14979e016de28d201200372dff1 *src/multiplayer/snapshotAssembler.ts
4f925513d1223a607b94174abe67c29454fc81c78250eae6ce552767646f365f *tests/phase2a11-recovery.test.ts
80d9f3da10ba0639a97d077814387805b33570e9ad8d839147002b3830190441 *tools/phase2a11-forced-restart.mjs
b5081f68a578b1b9af1def18ff889be30620f0a4d84d7d4d7b8227ebfd02396e *dist-mp-room/roomWorker.js
```

The `roomDurableObject.ts` hash includes an export-only test seam. The deployed
bytes and local artifact hash are identical.

## Direct measurements

| File | What it contains |
| --- | --- |
| `phase2a11-restart-2026-10-30T22-20-39-723Z/summary.json` | Machine-readable forced-restart result: epochs, start/deadline, rollback, timeline, command results, final outcomes, final ticks, reservation status |
| `phase2a11-restart-2026-10-30T22-20-39-723Z/metrics.jsonl` | Timestamped restart, close, restore, delta, command and status events |
| `phase2a11-restart-2026-10-30T22-20-39-723Z/status-before.json` | Direct room status before the forced restart (tick 334) |
| `phase2a11-restart-2026-10-30T22-20-39-723Z/status-after.json` | Direct room status after both restored seats reconnected (tick 303, processTicks 4) |
| `phase2a11-restart-2026-10-30T22-20-39-723Z/status-final.json` | Direct final status: closed, result tick 851, reservation released |
| `phase2a11-restart-2026-10-30T22-05-04-621Z/summary.json` | Pilot at a 2.1 s restart, restored tick 0; retained for checkpoint-age diagnosis |
| `phase2a11-restart-2026-10-30T22-05-04-621Z/metrics.jsonl` | Pilot timeline: epochs 1 → 1026, no live update rejections |
| `phase2a11-smoke.json` | Deployed 15-check smoke: health, 101, team isolation, authority, frame/token/origin/seat checks, resync, reconnect, delta shape, result, release, capacity |
| `phase2a11-lifecycle-results.json` | Six lifecycle checks: reconnect, abandonment, shutdown, deadline, resync, capacity |
| `phase2a11-lifecycle-events.jsonl` | Timestamped lifecycle events |
| `phase2a11-deployed-smoke.log` | Human-readable smoke output and health response |
| `phase2a11-lifecycle.log` | Human-readable lifecycle output |
| `phase2a11-forced-restart.log` | Human-readable forced-restart result |
| `phase2a11-deploy.log` | Wrangler upload and active version ID |
| `phase2a11-deployment.txt` | Final source/deployment identification, hashes and verification summary |
| `phase2a11-typecheck.log` | TypeScript result |
| `phase2a11-build.log` | Production browser build result |
| `phase2a11-vitest-focused.log` | 46 focused snapshot/room/sync/keepalive tests |
| `phase2a11-vitest-full.log` | Full suite: 959 tests / 96 files |

## Derived values

- Restart closed 105 ms after the request; the harness recorded 106 ms from
  request to its close observation.
- Seat 0 restored sync 378 ms after the request; seat 1 490 ms.
- Both seats reconnected and commanded in 434 ms.
- Rollback = pre tick 334 − restored tick 299 = 35 ticks (1.75 s at 20 Hz).
- Whole-match final tick 851 at the unchanged 45 s deadline. The theoretical
  900 ticks are not reached because the 35-tick checkpoint rollback and the
  restart gap are not replayed.
- `totalTicks 303 = restored tick 299 + processTicks 4` at the post-restart
  status snapshot.
- Final client and server ticks both `851`.
- No live post-restart sync/delta rejections. The four rejections in the
  summary are deliberate replays of the saved pre-restart sync and delta, two
  per seat; all were `epoch-mismatch`.

## Metric coverage

| Source | Coverage | Notes |
| --- | --- | --- |
| Room status polling | Before, after and final for the forced-restart room | Direct JSON, no imputation |
| Client timeline | Both seats, full restart sequence | Millisecond ISO timestamps |
| Deployed smoke | One complete room | 15/15 checks |
| Lifecycle suite | Six complete rooms | 6/6 checks |
| Local tests | 959 tests / 96 files | Includes 14 focused Phase 2A.11 tests |
| Platform CPU | **Not collected** | Not required by this phase; no CPU claim |
| Retained heap / memory | **Not collected** | No memory claim |
| 30-minute soak | **Not run** | Explicitly deferred by the phase brief |

There are no platform CPU buckets, per-invocation CPU rows, retained-heap
profiles or per-tick timings in this evidence set. The 10 ms individual-tick CPU
target remains unverified.

## Safety and hygiene

- Only the isolated staging Worker was deployed.
- Production was untouched.
- `MULTIPLAYER_FEATURE.enabled = false`.
- Two-room maximum, daily allowance and 30-minute deadline unchanged.
- No protocol message shape changed; protocol remains `mca.v2`.
- No simulation, pathfinding, navigation batching, combat or balance change.
- Seat tokens, admin tokens, reservation tokens, account identifiers and API
  credentials are not stored in these files.
- `POST /restart` requires the admin bearer token and `MP_DEV_MODE=1`; it calls
  `DurableObjectState.abort()` and is not available in production (no admin
  token, no dev mode).
- No work was staged or committed.

## Reproduction

```bash
npm run typecheck
npx vitest run
npm run build
npx vite build --config mp-room-vite.config.ts

MP_ADMIN_TOKEN="$(cat .dev/mp-admin-token)" node tools/phase2a-deployed-smoke.mjs
MP_ADMIN_TOKEN="$(cat .dev/mp-admin-token)" node tools/phase2a1-failure-tests.mjs
MP_ADMIN_TOKEN="$(cat .dev/mp-admin-token)" node tools/phase2a11-forced-restart.mjs
```
