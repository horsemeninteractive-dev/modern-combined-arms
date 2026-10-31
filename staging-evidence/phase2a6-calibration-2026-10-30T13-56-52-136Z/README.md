# Phase 2A.6 evidence — batch CPU calibration

## Scope

- Worker: `mca-multiplayer-staging`
- Version: `febd117e-8d8e-481e-ba88-c212df262073` (100% of staging traffic)
- Deployed: `2026-10-30T13:42:47.065Z`
- Build marker: `phase2a6-staging`
- Calibration room: `phase2a6-cal-mvv1d9jg` (1v1, 10 s hard limit, shut down before calibration)
- Run: `2026-10-30T13:56:52Z` – `2026-10-30T13:57:15Z`
- Production multiplayer flag: **false** (`MULTIPLAYER_FEATURE.enabled`)
- No production deployment, no plan/billing change, no paid observability service.

## Workloads

| Profile | Units | Commands | Purpose |
| --- | ---: | ---: | --- |
| `baseline` | 16 scenario units | 0 | Low-activity control; near the 1 ms measurement resolution |
| `stress` | 80 units (16 scenario + 64 fixed added) | 2 attack-move commands | Real pathfinding, fire, projectiles and casualties |

Batch sizes: `0, 1, 5, 10, 20, 50, 100` authoritative `Game.tick()` calls. Batch `0` is setup only. Ten repetitions per profile and batch (140 attempts).

## Measurement source

Cloudflare Workers Observability:

`POST /accounts/{account_id}/workers/observability/telemetry/query`

- `view: events`
- filter `$workers.event.request.url includes "run=p2a6-"`
- filter `$workers.durableObjectId exists`
- fields `$workers.cpuTimeMs`, `$workers.wallTimeMs`, request URL, `eventTimestamp`
- resolution: **1 ms per invocation**, not per tick

The Worker request is forwarded to a Durable Object, so each calibration request can produce a stateless router event and a durable-object event. Only the `durableObject` event contains the calibration work. The exported CSV contains one exact run-id match per observed calibration invocation.

Workers Observability on the Free plan did not return every invocation with the staging Worker's observability enabled:

- 140 attempts, **132 exact run-id matches** (94.29%).
- Platform aggregate metadata for the sample filter: `sampleInterval = 1.06818`, estimated 141 events, estimated 10,295 ms CPU. This is a weighted estimate, not an exact sum.
- Eight sample runs are absent: `stress-5-6`, `stress-50-6`, `baseline-10-7`, `baseline-20-7`, `stress-10-7`, `baseline-5-8`, `baseline-10-8`, `stress-10-8`.
- Missing values are **not imputed**. All estimates use exact matched records only.
- The same limitation affected `wrangler tail` (Durable Object records were incomplete), so tail is retained only as a cross-check.

See `observability-query.json` for the query and sampling metadata.

## Files

| File | Contents |
| --- | --- |
| `requests.jsonl` | Timestamped harness events: health, room lifecycle, unauthorised/invalid checks, every sample, final status |
| `samples.json` | All 140 sample descriptors: run id, profile, batch, rep, completed ticks, checksums, workload counters, response bytes |
| `summary.json` | Tail-based summary; CPU fields are null because this run used the Observability export |
| `observability-10rep.csv` | **Raw matched CPU/wall/timestamp rows** (132 rows) |
| `observability-10rep.csv.b64` | Base64 copy used for transfer; decodes byte-for-byte |
| `observability-query.json` | Query definition, platform sampling metadata, export checksum |
| `analysis.json` | Coverage, per-batch statistics, fits, per-repetition slopes, determinism checks |
| `analysis.log` | Human-readable analysis output |
| `calibration-10rep.log` | Harness stdout |
| `../phase2a6-verification/deployment.txt` | Wrangler deployment/version listing |
| `../phase2a6-verification/deployed-smoke.log` | 15-check deployed smoke test |
| `../phase2a6-verification/both-diagnostics.log` | `probe` + `calibrate` rejected with 400 |
| `../phase2a6-verification/failure-tests.log` | Reconnect, abandonment, shutdown, deadline, resync and capacity tests |
| `../phase2a6-verification/{tsc-final,vitest-final,build-final}.log` | Local verification |

## Integrity

- CSV: 4,950 bytes, 132 data rows, header `run,cpu_ms,wall_ms,timestamp`.
- SHA-256: `9da78c99251c31b5f98bd63d400e415c52cef9bb48cd0f7744fc012ad2ce4805`
- Verify:

```bash
base64 -d observability-10rep.csv.b64 > /tmp/phase2a6.csv
sha256sum /tmp/phase2a6.csv
```

## Reproduction

```bash
# 1. Local checks
npx tsc --noEmit
npx vitest run
npm run build

# 2. Calibration (staging only; 10 reps, paced)
MP_CALIBRATION_REPS=10 MP_SAMPLE_INTERVAL_MS=500 \
  node tools/phase2a6-batch-calibration.mjs

# 3. Export exact run-id CPU records from Workers Observability, then:
node tools/phase2a6-analyse.mjs \
  staging-evidence/phase2a6-calibration-<stamp>/samples.json \
  staging-evidence/phase2a6-observability-10rep.csv \
  staging-evidence/phase2a6-calibration-<stamp>

# 4. Deployed regression checks
node tools/phase2a-deployed-smoke.mjs
node tools/phase2a1-failure-tests.mjs
```

Tokens are read from `.dev/mp-admin-token` or `MP_ADMIN_TOKEN` and are not written to evidence.

## Caveats

- `cpuTimeMs` is invocation CPU. It includes scenario/`Game` construction, command setup, checksum/response serialisation and routing, not just ticks. Batch `0` isolates the setup control.
- The stress profile starts with a deliberately heavy 80-unit mass engagement. Its first tick is not a normal match tick. The derived first-tick delta is an estimate, not a direct per-tick CPU measurement.
- No per-tick maximum, per-tick percentile distribution or proof of 10 ms headroom is available from this data.
- A single calibration run does not establish concurrent-room capacity.
