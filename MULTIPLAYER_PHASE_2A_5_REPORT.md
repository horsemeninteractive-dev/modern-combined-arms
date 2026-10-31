# MCA — Phase 2A.5: Deployed Per-Tick CPU Measurement Investigation

**Overall status: PASS for the measurement investigation; the 10 ms per-tick CPU-headroom target remains UNVERIFIED.** The deployed staging runtime provides no clock that advances during CPU-only JavaScript, no usable in-isolate CPU counter, and no per-tick platform metric. A bounded admin-only probe reproduced the frozen-clock behaviour directly: `performance.now()` and `Date.now()` returned **0 ms**, and `process.hrtime.bigint()` returned **0 ns**, around 100,000 / 200,000 / 400,000 deterministic arithmetic iterations; `process.cpuUsage()` threw `ERR_METHOD_NOT_IMPLEMENTED`. Cloudflare's finest CPU data is per invocation or per minute, not per 50 ms simulation tick. No favourable per-tick number was manufactured, and no 30-minute soak was run because it could not produce the missing measurement.

- Staging Worker: `mca-multiplayer-staging`
- Deployed version: `b164b42c-dba1-493f-b6f5-8a203f5ba750` (100% of staging traffic)
- Deployed at: `2026-10-30T12:58:45.821Z`; version created `2026-10-30T12:58:44.466Z`
- Build marker: `phase2a5-staging`
- Probe room: `phase2a5-clock-mvuzarhj`
- Probe window: `2026-10-30T12:58:56Z` – `2026-10-30T12:59:00Z`
- Production multiplayer flag: **disabled** (`MULTIPLAYER_FEATURE.enabled === false`)
- No production deployment, no plan change, no paid observability service, no staged or committed files.

## 1. Question and scope

Phase 2A.4 established an aggregate CPU cost of **19.698 s over 35,994 ticks = 0.547 ms/tick** using Cloudflare's per-minute Durable Object CPU metric. That is an average, not a distribution. It cannot show that every tick stayed below the 10 ms target, nor how often a tick approached the 50 ms interval.

This phase asked whether the deployed runtime can measure the CPU cost of an individual authoritative tick directly. The answer is no with the currently available Cloudflare APIs. The work therefore focused on proving that limitation rather than replacing it with a misleading estimate.

The authoritative tick path, `CommandGate`, team projections, snapshots, persistence and lifecycle behaviour were not changed. The only runtime addition is an admin-only capability probe that runs synchronous arithmetic outside the game loop.

## 2. Deployed clock probe

`src/multiplayer/clockProbe.ts` takes four clock readings around three synchronous workloads of 100,000, 200,000 and 400,000 iterations of a deterministic xorshift-style loop. It returns each clock's delta, availability and error. It also takes a reading around one timer turn (`setTimeout(0)`) as an idle comparison. The workload checksums are returned so a zero delta cannot be confused with a loop that did not execute.

The probe is reachable only through the existing admin-only room status route:

```text
GET /api/multiplayer/rooms/<roomId>/status?probe=timing
Authorization: Bearer <MP_ADMIN_TOKEN>
```

There is no new public route, no client-supplied iteration count, no persistence write and no per-tick logging. The probe name is fixed; any other value returns `400 invalid-probe`.

### 2.1 Deployed result

Five probe calls were made against version `b164b42c` in room `phase2a5-clock-mvuzarhj`.

| Clock | Available | 100k delta | 200k delta | 400k delta | Result |
| --- | --- | ---: | ---: | ---: | --- |
| `performance.now()` | yes | 0 ms | 0 ms | 0 ms | frozen during CPU work |
| `Date.now()` | yes | 0 ms | 0 ms | 0 ms | frozen during CPU work |
| `process.hrtime.bigint()` | yes | 0 ns | 0 ns | 0 ns | frozen during CPU work |
| `process.cpuUsage()` | **no** | — | — | — | throws `ERR_METHOD_NOT_IMPLEMENTED` |

The timer-turn comparison also returned **0 ms** for both available clocks. Distinct workload checksums were produced:

- 100,000: `1439422740`
- 200,000: `608761662`
- 400,000: `3348093114`

This is direct deployed evidence that the loops executed while the clocks did not advance. It is not a local `workerd` result and it is not inferred from documentation.

### 2.2 Security checks on the probe route

| Check | Result |
| --- | --- |
| Unauthenticated `?probe=timing` | **403** |
| Unknown probe name | **400 `invalid-probe`** |
| Plain `/status` (no probe) | **200**, no `timingProbe` field |
| Probe response contains game state, seat tokens or credentials | **no** |
| Room shutdown after probe | **200**, `closed: true`, `closedReason: shutdown` |
| Reservation `r125` after shutdown | **released** |

The probe does not reveal hidden entity data, capacity values or diagnostics beyond the existing admin status response.

## 3. Candidate measurement methods

| Candidate | What it measures | Deployed finding | Suitable for one 50 ms tick? |
| --- | --- | --- | --- |
| `performance.now()` | elapsed timer time | frozen during CPU-only work; 0 ms around all workloads | **No** |
| `Date.now()` | wall-clock timer | frozen during CPU work; 0 ms around all workloads | **No** |
| `process.hrtime.bigint()` | high-resolution timer | available, but 0 ns around all workloads | **No** |
| `process.cpuUsage()` | process CPU time | throws `ERR_METHOD_NOT_IMPLEMENTED` | **No** |
| WebAssembly/WASI `clock_time_get` | host clock | Cloudflare's published WASI implementation uses `Date.now()`; same freeze | **No** |
| `wrangler tail` `cpuTime` | CPU per invocation | integer milliseconds; probe invocations reported **0 ms** and **5 ms** | **No** — too coarse and invocation-scoped |
| `durableObjectsInvocationsAdaptiveGroups.quantiles.cpuTime*` | CPU quantiles per invocation group | exists; probe rows p50 **2.530 ms**, p90/p99 **22.349 ms** | **No** — invocation-level, not tick-level |
| `durableObjectsPeriodicGroups.sum.cpuTime` | CPU per minute per object | the Phase 2A.4 aggregate; 60 s granularity | **No** — aggregate only |
| Workers production CPU profiler | function-frame CPU attribution over a 1–50 s capture | documented as available; not a timeline | **No** — cannot isolate each tick or its maximum |
| Instrumented tick counter with frozen clock | zero durations | existing diagnostics report `durationsAvailable: false` | **No** — already known invalid |

`durableObjectsPeriodicGroups` has no per-tick CPU field or CPU quantile. `durableObjectsInvocationsAdaptiveGroups` does expose `cpuTimeP25` through `cpuTimeP999`, but those quantiles describe Durable Object **invocations**. The room's two long-lived WebSocket invocations aggregate an entire connection, and an HTTP status probe aggregates its whole request. Neither is a simulation tick.

The production profiler is useful for finding expensive functions, but it samples a capture and presents self/total CPU per frame. It is explicitly "not a timeline" in Cloudflare's documentation and does not report an exact per-tick maximum. It was not used as a substitute measurement.

## 4. Platform CPU evidence and granularity

Cloudflare GraphQL introspection against this account confirms the following fields:

- `durableObjectsPeriodicGroups.sum.cpuTime` — microseconds of CPU per **minute per Durable Object**.
- `durableObjectsInvocationsAdaptiveGroups.quantiles.cpuTimeP25/P50/P75/P90/P95/P99/P999` — CPU per **invocation group**. The dataset also exposes `sum.requests`, `sum.errors`, `sum.wallTime` and `sum.responseBodySize`, but no tick field.
- `workersInvocationsAdaptive.quantiles.cpuTimeP50/P99` — Worker request quantiles, not Durable Object tick quantiles.

The probe room's invocation rows for `2026-10-30T12:58:00Z`–`13:02:00Z` show how coarse this remains:

| Minute row | Requests | CPU p50 | CPU p90 / p99 | Wall p50 |
| --- | ---: | ---: | ---: | ---: |
| `12:58:56Z` | 1 | 70.207 ms | 70.207 ms | 253.612 ms |
| `12:58:57Z` | 5 | 2.530 ms | 22.349 ms | 146.232 ms |
| `12:58:58Z` | 3 | 4.467 ms | 4.943 ms | 297.646 ms |
| `12:58:59Z` | 1 | 14.190 ms | 14.190 ms | 95.655 ms |
| `13:00:00Z` | 1 | 5.893 ms | 5.893 ms | 8.880 ms |

The first row includes room load and the first admin probe; later rows contain a mix of status checks and three-workload probes. The spread is real invocation-level variance, not tick variance. A per-invocation CPU number cannot prove that a 0.547 ms average tick never exceeded 10 ms, and `wrangler tail` rounds to whole milliseconds, so it cannot even resolve the 0.547 ms average.

### 4.1 Correlation with Phase 2A.4

Phase 2A.4's aggregate remains the only defensible CPU figure for a real match:

- **19,697,594 µs (19.698 s)** over 1,799.749 s, or **1.094% of wall time**.
- **0.547 ms per tick** on average across 35,994 ticks.
- **0 CPU-limit, memory-limit or fatal errors** reported by the platform.
- This phase did not repeat the 30-minute soak. Doing so would reproduce the same aggregate and would not add a per-tick distribution; it would consume another 230 GB-s and 30 minutes without answering the question.

No claim is made that the 10 ms budget is met. The only defensible statement is that the observed **average** is far below 10 ms and that the platform reported no CPU-limit failures during the Phase 2A.4 match.

## 5. Instrumentation architecture and changed files

| File | Change | Reason |
| --- | --- | --- |
| `src/multiplayer/clockProbe.ts` | New bounded clock-capability probe: four clocks, three fixed workloads, timer-turn comparison, error capture. | Establish what the deployed runtime actually exposes without adding a fake tick timer. |
| `src/multiplayer/roomDurableObject.ts` | Imports the probe and handles `?probe=timing` on the existing admin status route. | Keep the probe behind the existing admin token and avoid a new public endpoint. |
| `src/multiplayer/roomWorker.ts` | Build marker changed to `phase2a5-staging`. | Make the deployed version identifiable in evidence. |
| `tests/phase2a5-clock-probe.test.ts` | Three focused tests for workload bounds, clock availability/deltas, I/O comparison and data leakage. | Prove the probe is bounded and returns no game/credential data. |
| `tools/phase2a5-clock-probe.mjs` | Deployed harness: room creation, 403/400 checks, five probes, sanitised evidence, shutdown. | Reproducible deployed evidence without printing tokens. |
| `tools/phase2a-deployed-smoke.mjs` | Build assertion advanced from `phase2a4-staging` to `phase2a5-staging`. | The only stale assertion caused by the new build marker; no protocol assertion changed. |

The probe is not in `GameState`, `SaveData`, `RoomSnapshotV1`, team projections or any snapshot. It does not write storage, does not log per tick and does not run during normal room operation. Its cost is incurred only when an administrator explicitly requests the probe. The production bundle contains no `timingProbe`, `synchronous-cpu-workload` or `phase2a5-staging` string; the production JS hash remained `index-DjlmK8Hv.js`.

## 6. Local verification

| Check | Result |
| --- | --- |
| Full suite | **PASS** — 88 files, 894 tests (3 new) |
| Focused Phase 2A.5 tests | **PASS** — 3 tests |
| Existing diagnostics A/B test | **PASS** — enabled/disabled rooms produce identical `stateHash()`; disabled diagnostics remain inert |
| TypeScript | **PASS** — `npx tsc --noEmit` |
| Production build | **PASS** — `npm run build`; 79 modules, no multiplayer probe references |
| Staging Worker build | **PASS** — `npx vite build --config mp-room-vite.config.ts`; 497.02 kB / 123.83 kB gzip |

The A/B test is the existing `tests/phase2a2-diagnostics.test.ts` check: a room with diagnostics enabled and a room with diagnostics disabled are ticked through the same 120 deterministic steps and must produce the same authoritative state hash. This phase did not add any work to `RoomMatch.tick`; the probe runs only from the admin status handler.

## 7. Deployed validation

The probe and build marker were deployed only to the isolated staging Worker. The production application was not deployed and the production feature flag remains false.

### 7.1 Deployed smoke

`node tools/phase2a-deployed-smoke.mjs` passed all 15 checks against `b164b42c`:

- 101 upgrade; two seats; isolation; valid command accepted; forged authority rejected; oversized frame rejected; wrong token 401; foreign origin 403; duplicate seat 409.
- Resync checkpoint applied in **22 ms**; reconnect on a new epoch; delta carried no map or full state.
- Result delivered to both seats; reservation released; global capacity boundary enforced.
- Initial sync **58,967 B**; first delta **365 B**.

### 7.2 Lifecycle and capacity

`node tools/phase2a1-failure-tests.mjs` passed all six groups against the same version:

| Test | Result |
| --- | --- |
| Reconnect | PASS — recovery **101 ms**, new epoch, reservation released |
| Permanent disconnect / abandonment | PASS — observed after **30.156 s**, `victory` by `abandoned`, released |
| Controlled shutdown | PASS — client `room-shutdown`, closed, released |
| Hard deadline | PASS — 10 s match, **194 ticks**, **9.723 s**, draw/draw, released |
| Resync | PASS — **20 ms**, epoch advance, next delta applied |
| Capacity boundary | PASS — `200, 200, 503, 200`; third room `capacity-full`; slot freed after release |

The probe room itself closed with `closedReason: shutdown` and reservation `r125` status `released`.

## 8. Comparison with Phase 2A.4

| Measure | Phase 2A.4 | Phase 2A.5 |
| --- | --- | --- |
| Deployed version | `a4a5d9cd` | `b164b42c` |
| Match outcome | 30-minute 1v1 soak, 35,994 ticks | No match soak; measurement investigation only |
| Aggregate CPU | 19.698 s / 0.547 ms per tick average | Not re-measured; no new match |
| Per-tick CPU distribution | unavailable | still unavailable, now with direct deployed evidence of why |
| Snapshot/network behaviour | unchanged | unchanged |
| Persistence/lifecycle | pass | pass on short deployed checks |
| Production bundle | `index-DjlmK8Hv.js` | same hash; probe absent |

The absence of a second soak is deliberate. The acceptance criteria permit a documented platform limitation when per-tick CPU cannot be measured. A soak would repeat known aggregate data, not close the gap, and would consume the global daily duration budget.

## 9. Why the 10 ms target cannot be verified here

1. The runtime freezes `performance.now()` and `Date.now()` during synchronous JavaScript, including across a timer turn. Reading either before and after a tick returns zero regardless of how much CPU the tick used.
2. `process.hrtime.bigint` is available but returns the same frozen time, while `process.cpuUsage` throws in this deployment. Neither can be substituted for a real CPU clock.
3. Cloudflare's per-invocation CPU quantiles are scoped to an invocation. The room's tick loop runs inside long-lived WebSocket invocations, so the metric aggregates the entire connection. HTTP probes are separate invocations and do not execute the authoritative tick.
4. Cloudflare's per-minute Durable Object metric is an aggregate. It can establish an average, and it did: 0.547 ms/tick. It cannot establish a maximum or a p99.
5. The production profiler is a sampling capture with function-frame attribution. It is not a per-tick timeline and does not expose a maximum tick cost.
6. No supported API returns a per-tick CPU counter to the Worker itself. Adding asynchronous yields around tick sections would change scheduling and simulation behaviour, which this phase explicitly must not do.

Therefore the 10 ms per-tick headroom target remains **unverified**. The 19.698 s aggregate and zero CPU-limit errors are consistent with headroom, but consistency is not proof.

## 10. Safety, privacy and free-tier impact

- No production deployment, route, lobby, account or feature-flag change.
- No paid Cloudflare plan, paid observability product, billing activation or automatic upgrade.
- No third-party telemetry dependency.
- The probe is admin-only and returns no tokens, account IDs, hidden entities, room capacity or game state.
- No persistence write is caused by a probe; it runs in memory and returns a response.
- The probe room was a short 10 s room and released reservation `r125`. No capacity limit or match duration was increased.
- The staging bundle grew by the probe module; normal status requests do not execute it. No per-tick overhead was added.
- No files were staged or committed.

## 11. Acceptance assessment

| Criterion | Result | Evidence |
| --- | --- | --- |
| Timing-method investigation documented with deployed evidence | **PASS** | Five deployed probe calls; 0 ms/0 ns deltas, `ERR_METHOD_NOT_IMPLEMENTED` cpuUsage |
| Instrumentation bounded and non-invasive | **PASS** | Fixed 100k/200k/400k workloads; no tick-path changes; admin-only status route |
| Deterministic A/B proves no simulation change | **PASS** | Existing enabled/disabled diagnostics `stateHash()` test; probe not in `RoomMatch.tick` |
| All existing tests, typecheck and production build pass | **PASS** | 88 files / 894 tests; `tsc`; `npm run build`; production bundle hash unchanged |
| Staging security, lifecycle and capacity checks pass | **PASS** | 15-check smoke; six lifecycle/capacity groups; 403/400 probe checks; reservation released |
| 30-minute soak if a reliable deployed method exists | **N/A** | No reliable per-tick method exists; a soak would not produce one |
| Report distinguishes direct, aggregate and estimated CPU | **PASS** | Direct clock result, per-invocation quantiles and per-minute aggregate separated explicitly |
| No production deployment, feature activation, staging or commit | **PASS** | Staging-only deploy; `MULTIPLAYER_FEATURE.enabled === false`; `git diff --cached` empty |

**Overall: PASS for the investigation, with the per-tick target explicitly unresolved.** This is not a claim of production readiness. It is a statement that the available platform cannot support the requested proof, and that the existing conservative limits should remain.

## 12. Reproduction

```bash
# 1. Local checks
npx tsc --noEmit
npx vitest run
npm run build

# 2. Build and deploy only the isolated staging Worker
npx vite build --config mp-room-vite.config.ts
npx wrangler deploy --config mp-room-wrangler.jsonc

# 3. Deployed clock probe (room is created and shut down by the harness)
node tools/phase2a5-clock-probe.mjs

# 4. Existing deployed security and lifecycle checks
node tools/phase2a-deployed-smoke.mjs
node tools/phase2a1-failure-tests.mjs
```

The deployed Worker URL is `https://mca-multiplayer-staging.horsemeninteractive.workers.dev`. Do not deploy this configuration to production or enable `MULTIPLAYER_FEATURE`.

## 13. Evidence index

| Path | Contents |
| --- | --- |
| `staging-evidence/phase2a5-clock-probe-2026-10-30T12-58-56-308Z/probe.json` | Five sanitised probe results, room ID, 403/400 checks |
| `.../events.jsonl` | Timestamped health, authorization, probe and shutdown events |
| `.../README.md` | One-page evidence summary |
| `staging-evidence/phase2a5-tail3/summary.json` | Per-invocation `wrangler tail` CPU: 0 ms and 5 ms; integer-ms resolution |
| `staging-evidence/phase2a5-tail3/tail.jsonl` | Raw tail records with authorization redacted |
| `staging-evidence/phase2a5-platform-metrics.json` | GraphQL introspection, invocation CPU rows, interpretation |
| `staging-evidence/phase2a5-deployment.txt` | Latest staging deployment/version listing |
| `staging-evidence/phase2a1-failures-2026-10-30T13-04-03-713Z/` | Final reconnect, abandonment, shutdown, deadline, resync and capacity results |

## 14. Bottom line

The deployed runtime cannot provide a defensible per-tick CPU measurement. `performance.now()`, `Date.now()` and `process.hrtime.bigint()` all return zero deltas during CPU-only work, and `process.cpuUsage` is not implemented. Cloudflare's usable CPU data is per invocation or per minute. The 10 ms per-tick target therefore remains unverified; the Phase 2A.4 aggregate of 0.547 ms/tick is the strongest available evidence and must not be presented as a per-tick maximum. The probe, its deployed evidence and all existing security, lifecycle, test and build checks are complete. Retain the current two-room and 30-minute staging limits.
