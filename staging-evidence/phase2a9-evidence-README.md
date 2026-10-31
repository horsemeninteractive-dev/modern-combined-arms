# Phase 2A.9 evidence — staging A/B CPU comparison

## Scope

- Worker: `mca-multiplayer-staging` (isolated staging only).
- A: `e5aef673-bf6f-461c-8539-5605c5ddf908`, tag `phase2a9-a`, pre-Phase 2A.8 pathfinding.
- B: `d23e416c-c755-4ec4-bfb3-373ec216c275`, tag `phase2a9-b`, Phase 2A.8 optimised pathfinding.
- Production multiplayer flag: **false** (`MULTIPLAYER_FEATURE.enabled = false`).
- No production deployment, capacity change, paid observability, billing change or commit.
- Staging limits retained: two active rooms, existing daily allowance, 30-minute hard deadline.

The A and B build inputs differ only in `src/sim/game.ts`, `src/sim/pathfinding.ts` and `src/sim/navBatch.ts`. The reconstructed A tree at `tmp/phase2a8-old` is byte-identical to the current working tree outside those three files. Source and artifact hashes are in `phase2a9-deployment.txt`.

## Workload

Both builds ran the exact Phase 2A.6/2A.7 calibration workload:

| Profile | Units | Commands |
| --- | ---: | --- |
| `baseline` | 16 scenario units | 0 |
| `stress` | 80 units (16 scenario + 64 fixed) | 2 full-force attack-move commands, 72 accepted slots |

Batch sizes: `0, 1, 5, 20, 100` authoritative `Game.tick()` calls. Batch `0` is setup only. Each session also ran 12 additional `stress` batch-1 invocations to increase warm first-tick observations.

Each session:

1. Creates a 10 s room and immediately shuts it down.
2. Verifies unauthenticated calibration is `403`, invalid profiles/batches are `400`, and plain status contains no calibration data.
3. Runs two unmeasured warmups.
4. Runs 6 repetitions of every profile × batch in alternating profile order.
5. Runs 12 extra stress batch-1 invocations.
6. Verifies the temporary room is closed and its reservation is `released`.

72 measured calibration invocations per session; 216 per build.

## Session order

The experiment was interleaved as A1, B1, B2, A2, A3, B3.

| Session | Version | Start (UTC) | End (UTC) | Room | Samples | Reservation |
| --- | --- | --- | --- | --- | ---: | --- |
| A1 | A | 19:46:43.419 | 19:47:10.234 | `p2a9-a1-mvvdv6ff` | 72 | released |
| B1 | B | 19:48:19.051 | 19:48:44.429 | `p2a9-b1-mvvdx86i` | 72 | released |
| B2 | B | 19:48:57.611 | 19:49:22.525 | `p2a9-b2-mvvdy1yr` | 72 | released |
| A2 | A | 19:49:43.310 | 19:50:08.975 | `p2a9-a2-mvvdz17p` | 72 | released |
| A3 | A | 19:50:13.103 | 19:50:38.907 | `p2a9-a3-mvvdzo7l` | 72 | released |
| B3 | B | 19:51:02.396 | 19:51:27.603 | `p2a9-b3-mvve0qc6` | 72 | released |

## Measurement source

Cloudflare Workers Observability:

`POST /accounts/{account_id}/workers/observability/telemetry/query`

- `view: events`
- filter `$workers.event.request.url includes "run=p2a9-A"` or `"run=p2a9-B"`
- filter `$workers.executionModel eq "durableObject"`
- fields `$workers.cpuTimeMs`, `$workers.wallTimeMs`, `$workers.scriptVersion.id`, request URL, event timestamp
- resolution: **integer milliseconds per Durable Object invocation**
- A query run id: `xydv2qtrpwt0nmb3zua3vcu3`
- B query run id: `5o4job4n19nrgvk6kfzkuhbe`

Coverage:

- A: 216/216 measured samples matched; 222/222 invocations including 6 warmups.
- B: 216/216 measured samples matched; 222/222 invocations including 6 warmups.
- No sample was missing and no value was imputed.
- All events carried the expected script version.

Platform aggregate cross-check:

- `POST .../telemetry/query`, `view: calculations`, `sum($workers.cpuTimeMs)`, grouped by `$workers.scriptVersion.id` and `$workers.durableObjectId`.
- A: 72 + 72 + 72 events, 2,895 + 2,502 + 3,116 = **8,513 ms**.
- B: 72 + 72 + 72 events, 1,981 + 1,648 + 2,113 = **5,742 ms**.
- These sums exactly match the per-invocation sample sums.

`wrangler tail` was tested as a secondary source. Its Durable Object record coverage was incomplete and its process lingered long enough to mix later sessions, so it was discarded and is not used in any result.

## Files

| File | Contents |
| --- | --- |
| `phase2a9-evidence-README.md` | This document |
| `phase2a9-deployment.txt` | Current deployment, tags, source/artifact hashes and A/B tree difference |
| `phase2a9-observability-extract.json` | Exact `cpuTimeMs` values in run-index order, with query ids, timeframes and coverage |
| `phase2a9-platform-aggregate.json` | Raw platform aggregate group totals and cross-check |
| `phase2a9-analysis/analysis.json` | Determinism validation, cells, derived estimates, fits, session pairs |
| `phase2a9-analysis/analysis.log` | Human-readable analysis output |
| `phase2a9-A1-.../` etc. | Per-session `requests.jsonl`, `samples.json`, `session.json` |
| `phase2a9-deployed-smoke.log` | 15-check two-seat deployed lifecycle/security validation |
| `phase2a9-typecheck.log` | `tsc --noEmit` |
| `phase2a9-vitest.log` | Full Vitest run |
| `phase2a9-build.log` | Production build |

## Reproduction

```bash
node tools/phase2a9-ab-calibration.mjs   # one session; requires MP_PHASE2A9_SESSION and MP_PHASE2A9_VERSION_ID
node tools/phase2a9-analyse.mjs
node tools/phase2a-deployed-smoke.mjs
npx tsc --noEmit
npx vitest run
npm run build
```

The admin token is read from `MP_ADMIN_TOKEN` or `.dev/mp-admin-token`; it is not written to evidence.

## Caveats

- `$workers.cpuTimeMs` is invocation CPU, not tick CPU. It includes fresh `Game` construction, command setup, ticks, state hashing, response serialisation and routing.
- Batch 1 is setup plus one tick. Batch 0 is setup only. The first-tick excess is a difference between independent invocations, not a clock around one tick.
- No per-tick CPU timeline, maximum or percentile exists in the available metric.
- The 80-unit stress workload is synthetic and deliberately more demanding than a normal match.
- A/B absolute levels declined across sessions (host/JIT/platform drift). B was lower in every interleaved pair, but the percentage uncertainty is wide.
- The baseline profile is a near-resolution negative control. Its A/B difference is about 1–2 ms and its confidence interval includes zero; it cannot explain the much larger stress difference, but it prevents exact attribution of every millisecond.
- The 10 ms individual-tick CPU target remains **UNVERIFIED**.
- A single short real-room validation does not establish concurrent-room capacity.
