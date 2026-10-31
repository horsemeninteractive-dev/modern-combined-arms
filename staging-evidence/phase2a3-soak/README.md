# Phase 2A.3 evidence — deployed 30-minute soak

Collected 2026-10-30 against the isolated staging Worker `mca-multiplayer-staging`
(version `610f19fa-0e1e-4535-aa68-dc38899cbffa`, 100 %). No secret is stored here:
tokens are read from the environment or `.dev/mp-admin-token`, never written to evidence.

| File | Meaning |
| --- | --- |
| `start.txt` | soak start timestamp (UTC) |
| `soak.stdout.log` | harness log: 30 s intervals, commands, snapshot bytes, entity counts |
| `platform-metrics.json` | GraphQL `durableObjectsPeriodicGroups` / `InvocationsAdaptiveGroups` / `StorageGroups` for 04:56–05:29Z; `periodic.perMinute` holds the memory series |
| `cpu-m10.pprof`, `cpu-m10-summary.json` | deployed CPU profile captured at elapsed 10 min (20 s window) |
| `heap-m6.pprof`, `heap-m6-summary.json` | deployed heap (allocation) profile at elapsed 6 m 22 s |
| `heap-m9.pprof`, `heap-m9-summary.json` | deployed heap (allocation) profile at elapsed 7 m 27 s |
| `heap-m24.pprof`, `heap-m24-summary.json` | deployed heap (allocation) profile at elapsed 24 m 32 s |
| `heap-m26.pprof`, `heap-m26-summary.json` | deployed heap (allocation) profile at elapsed 26 m 22 s |
| `heap-m1.pprof` | failed attempt: HTTP 503, error 10397 ("runtime could not start profiling") |
| `heap-m16.pprof` | failed attempt: HTTP 404, error 10393 ("no recent executions were found") |
| `graphql-accounts.json` | token-scope probe: `viewer.accounts` is not authorised for an account-scoped token, so the account id was supplied explicitly. Contains no credentials. |

The heap pprof files sample `alloc_objects`/`alloc_space` every 524,288 bytes. They measure
allocation over the profiling window, **not** retained heap. Do not read them as memory retention.

Related evidence lives one level up:

- `../phase2a3-soak-30m-2026-10-30T04-56-35-106Z/` — soak summary, per-30 s metrics, final status.
- `../phase2a1-failures-2026-10-30T05-27-50-173Z/` — reconnect, abandonment, shutdown, deadline, capacity.
- `../phase2a3-main-30m-2026-10-30T04-20-58-814Z/` — previous run on the same version: census series, heap m5/m15/m25.
- `../phase2a3-idle/`, `../observability/baseline-platform/` — control memory series.
- `../phase2a3-local/` — local workerd reference (not deployed evidence).
