# Phase 2A.10 evidence index

Room: `phase2a10-30m-mvvfbtvq`
Match window: `2026-10-30T20:27:57.702Z` – `2026-10-30T20:57:57.702Z`
Harness wall time: 1,799,747 ms
Worker: `mca-multiplayer-staging`
Deployed version: `d23e416c-c755-4ec4-bfb3-373ec216c275` (`phase2a9-b`)
Source HEAD: `132ccc8363d5b5bc98b6518b4afd1738dedaad6a`
Reservation: `r164` — released

## What happened

The Phase 2A.9 Build B completed a 30-minute two-seat match at the hard deadline.
Both seats received a result (`victory` / `defeat`, `time-limit`, tick 35,921).
The final reconstructed state matched the server tick, map and fog.

At `20:45:31Z` both WebSocket connections closed with no close code. The room
restarted from persistence. The object id stayed the same, but its diagnostics
counters and `startedAtMs` reset. The clients reconnected in 462/469 ms, then
rejected 363 sync/delta updates for 20.13 s while the restarted room's seat
epochs caught up with the clients' previous epochs. One resync request was
rate-limited. Both clients eventually resynchronised; the final states matched.

The authoritative tick at the last pre-restart acknowledgement was 21,015.
The next acknowledgement after the restart was 21,043, so approximately 72
ticks (3.6 s) were lost. The final tick, 35,921, is 79 ticks (0.22%) below the
36,000 expected over the exact 1,800 s match.

## Direct platform measurements

- `staging-evidence/phase2a10-platform-periodic.json` — 31 one-minute
  `durableObjectsPeriodicGroups` buckets with CPU, active time, duration,
  memory, WebSocket message, row and error counters.
- `staging-evidence/phase2a10-platform-invocations.json` — 6
  `durableObjectsInvocationsAdaptiveGroups` rows. These are sparse and mostly
  long-lived WebSocket/status invocations; they are not per-tick observations.
- `staging-evidence/phase2a10-30m-2026-10-30T20-27-39-949Z/status-final.json`
  — final room status, result and released reservation.
- `.../status-mid.json` — status while the room was playing, after the restart.

Platform CPU total: **20,014.378 ms** across 31 buckets.
Aggregate CPU per completed authoritative tick: **0.5572 ms** (derived).
Peak reported memory: **33.6966 MiB**; value at the last bucket: **6.9578 MiB**.
Duration: **232.559 GB-s** (1.79% of the 13,000 GB-s daily free allowance).

No CPU-limit, memory-limit or fatal internal errors were reported.
The 10 ms individual-tick CPU target remains unverified; no per-tick CPU
dataset exists for this runtime.

## Client and room evidence

- `.../summary.json` — soak summary: ticks, command results, sync/delta bytes,
  reconstruction, keepalives, reconnects, snapshot gaps.
- `.../metrics.jsonl` — timestamped command, reconnect, assembly-reject,
  server-error and interval records.
- `.../run.log` — human-readable progress and interval log.
- `.../room.json` — sanitised room handle; seat tokens removed.
- `phase2a10-lifecycle.log` — post-soak reconnect, abandonment, shutdown,
  deadline, resync and capacity tests (all passed).
- `phase2a10-deployed-smoke.log` — 15 deployed protocol/security checks.
- `phase2a10-analysis.json` — derived analysis, with direct measurements and
  estimates separated.
- `phase2a10-deployment.txt` — source and deployment identity.

## Metric coverage

- Periodic CPU/memory: 31/31 minute buckets returned, covering the whole room.
- Invocation groups: 6 rows; not a complete invocation census. The original
  long-lived WebSocket rows end at the restart with
  `responseStreamDisconnected`. The post-restart rows are grouped by connection
  lifetime, so they cannot be used as per-tick samples.
- Room diagnostics: post-restart only. The restart reset all in-process
  counters, including persistence byte counts and the 14,922 post-restart tick
  count. The 14,922 figure is **not** the whole-match tick count.
- The platform per-minute object id and `coloCode` remained constant.
- No value was imputed for missing samples.

## Reproduction

```bash
# 1. Confirm the active staging version and keep the feature flag off.
npx wrangler deployments status --config mp-room-wrangler.jsonc

# 2. Run the established 30-minute two-seat soak.
MP_SOAK_MS=1800000 MP_SOAK_LABEL=phase2a10-30m \
  node tools/phase2a1-soak.mjs

# 3. Run the post-soak lifecycle and capacity checks.
node tools/phase2a1-failure-tests.mjs

# 4. Run the deployed 15-check protocol/security smoke.
node tools/phase2a-deployed-smoke.mjs

# 5. Local verification.
npm run typecheck
npx vitest run
npm run build
```

Seat tokens, admin tokens, account identifiers and API credentials are not
stored in these files.
