# Phase 2A.5 clock-probe evidence (corrected build)

- Worker: `mca-multiplayer-staging`
- Version: `b164b42c-dba1-493f-b6f5-8a203f5ba750`
- Build marker: `phase2a5-staging`
- Room: `phase2a5-clock-mvuzarhj`
- Probe window: `2026-10-30T12:58:56Z` – `2026-10-30T12:59:00Z`
- Route: admin-only `GET /status?probe=timing` (existing status route, no new public endpoint)

## Result

Five probe calls ran three synchronous workloads of 100,000 / 200,000 / 400,000 deterministic arithmetic iterations.

- `performance.now()`: available, **0 ms delta** for every workload.
- `Date.now()`: available, **0 ms delta** for every workload.
- `process.hrtime.bigint()`: available, **0 ns delta** for every workload.
- `process.cpuUsage()`: throws `ERR_METHOD_NOT_IMPLEMENTED`.
- All three available clocks also reported **0** across the timer turn used as an idle comparison.
- Unauthenticated probe: **403**.
- Unknown probe name: **400 `invalid-probe`**.
- Plain `/status`: **200**, no `timingProbe` field.
- Room shutdown: **200**; final status `closed: true`, `closedReason: shutdown`, reservation `r125` **released**.

The absence of a clock delta means the clock did not advance; it does not mean the CPU loop did no work. Distinct checksums for the three workload sizes prove the loops executed.

## Files

- `probe.json` — sanitised five-call result.
- `events.jsonl` — timestamped health, authorization, probe and shutdown events.
- `status-final.json` — final closed/released lifecycle state.
- `../phase2a5-tail3/summary.json` — `wrangler tail` per-invocation CPU: 0 ms and 5 ms for the probe request; integer-ms resolution.
- `../phase2a5-platform-metrics.json` — introspection and GraphQL invocation CPU rows; per-invocation quantiles only.
