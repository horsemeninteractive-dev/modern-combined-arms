# Phase 2A.5 clock-probe evidence

- Worker: `mca-multiplayer-staging`
- Version: `79874609-6adf-48fe-86fa-e32696ffda54`
- Build marker: `phase2a5-staging`
- Room: `phase2a5-clock-mvuyl9s6`
- Captured: `2026-10-30T12:39:07Z` – `2026-10-30T12:39:09Z`
- Route: admin-only `GET /status?probe=timing` (existing status route, no new public endpoint)

## Result

Five probe calls ran three synchronous workloads of 100,000 / 200,000 / 400,000 deterministic arithmetic iterations.

- `performance.now()`: available, **0 ms delta** for every workload.
- `Date.now()`: available, **0 ms delta** for every workload.
- `process.hrtime.bigint()`: unavailable.
- `process.cpuUsage()`: throws `ERR_METHOD_NOT_IMPLEMENTED`.
- The same clocks also reported **0 ms** across the timer turn used as an idle comparison.
- Unauthenticated probe: **403**.
- Unknown probe name: **400 `invalid-probe`**.
- Plain `/status`: **200**, no `timingProbe` field.
- Room shutdown: **200**; final status `closed: true`, `closedReason: shutdown`, reservation `r112` **released**.

The absence of a clock delta means the clock did not advance; it does not mean the CPU loop did no work. Distinct checksums for the three workload sizes prove the loops executed.

## Files

- `probe.json` — sanitised five-call result.
- `events.jsonl` — timestamped health, authorization, probe and shutdown events.
- `../phase2a5-tail2/summary.json` — `wrangler tail` per-invocation CPU: 1 ms and 3 ms for the probe request; integer-ms resolution.
- `../phase2a5-platform-metrics.json` — introspection and GraphQL invocation CPU rows; per-invocation quantiles only.
