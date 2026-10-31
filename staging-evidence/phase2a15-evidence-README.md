# Phase 2A.15 evidence

All evidence here was produced against the unchanged Phase 2A.13 staging artifact:

- Worker `mca-multiplayer-staging`, version `9fd1dcf4-3046-438d-b72d-0c3880b0afc5`
- Tag `phase2a13`, health build `phase2a13-staging`
- Bundle SHA-256 `cfca794ca41719449fd827fcd06b13ddbdb806c2b7d54a02703e9c4959396f1a`
  (`dist-mp-room/roomWorker.js` on disk matches this hash)

Nothing was deployed, rebuilt or replaced during the phase.

## Main run

`phase2a15-30m-2026-10-31T17-03-14-627Z/` — one full 30-minute two-seat match.

| File | Contents |
| --- | --- |
| `room.json` | Room identity, mode, requested duration, seat ids (tokens absent) |
| `summary.json` | Harness summary: ticks, results, per-seat transport, commands, **combat counters**, reconstruction, restarts, state samples |
| `phase2a15-analysis.json` | Derived analysis: restart rollback, checkpoint ages, epoch continuity, reconstruction, limitations, merged combat block |
| `status-final.json` | Room status after closure: lifecycle, timing, final result, reservation, persistence |
| `restart-0.json`, `restart-1.json` | Per-restart record: checkpoint age, pre/restored tick, rollback, per-seat epoch continuity, reconnect/sync/delta latency, first accepted command, stale-message rejections, start/deadline continuity, `combatAtRestart` |
| `restart-N-status-before.json` | Status sampled immediately before each restart (persistence, timing, lifecycle) |
| `restart-N-status-restored-before-connect.json` | Status after the object reloaded from storage and before the seats reconnected |
| `metrics.jsonl` | Harness event stream (commands, assembly rejects, socket closes, resync outcomes) |
| `status-samples.jsonl` | Room status samples, 10 s normally and 250 ms around restarts |
| `run.log` | Timestamped harness console log |

Key measured values: 35,683 whole-match ticks at 19.826 Hz; restart A checkpoint
age 1,759 ms with a 37-tick / 1,850 ms rollback; restart B checkpoint age
12,880 ms with a 260-tick / 13,000 ms rollback; epochs 2 → 1,026 → 2,054 → 2,058
on both seats; zero rejected updates; zero persistence failures; result
`time-limit`, team 0 victory at tick 35,683; reservation `r292` released once.

Combat: seat 0 — 27 attack-moves, 1 direct attack, 77 hits, 5 enemy units
destroyed, 22 order replacements; seat 1 — 25 attack-moves, 2 direct attacks,
33 hits, 6 enemy units destroyed, 44 order replacements. No hit or destruction is
recorded after 17:21:31Z (restart B).

## Harness validation run

`phase2a15-dry-2026-10-31T16-55-26-626Z/` and `phase2a15-dry-run.log` — a
90-second run used only to prove the per-seat probe fix and the evidence hooks.
Both seats produced probes and attacks, both landed hits, both destroyed enemies,
and both restarts recovered (1,606 ms and 12,636 ms checkpoint age). It is not
stability evidence.

## Regression logs

| File | Command |
| --- | --- |
| `phase2a15-typecheck-pre.log` / `-post.log` | `npm run typecheck` |
| `phase2a15-vitest-pre.log` / `-post.log` | `npx vitest run` — 98 files, 997 tests, both times |
| `phase2a15-smoke-pre.log` / `-post.log` | `MP_EXPECT_BUILD=phase2a13-staging node tools/phase2a-deployed-smoke.mjs` — 15/15 checks |
| `phase2a15-lifecycle-pre.log` / `-post.log` | `node tools/phase2a1-failure-tests.mjs` — 6/6 checks, capacity `[200,200,503,200]` |
| `phase2a15-build-pre.log` / `-post.log` | `npm run build` |

## Reproduction

```bash
# main soak (30 min, two restarts at 5 min and 18 min, ages 1.5 s and 12.5 s)
MP_SOAK_LABEL=phase2a15-30m node tools/phase2a15-soak.mjs

# analysis + combat merge
node tools/phase2a15-analyse.mjs staging-evidence/phase2a15-30m-<stamp>
```

The admin token is read from `.dev/mp-admin-token` and is never written to
evidence. Seat tokens are not recorded.

## What is not here

- **The exact final persisted snapshot.** The artifact has no read path for stored
  bytes (`create`, `status`, `shutdown`, `restart`, `ws` only), so it could not be
  captured or validated. See the report §10.
- **Platform CPU, invocation and memory series.** `tools/phase2a2-metrics.mjs`
  requires `CLOUDFLARE_API_TOKEN` and `MP_ACCOUNT_ID`; neither was available, and
  no values were imputed.
- **Per-field reference audit of a persisted snapshot.** Strict restore validation
  ran on the two persisted snapshots that were restored; the final snapshot was
  only validated by the write path's timing check.
