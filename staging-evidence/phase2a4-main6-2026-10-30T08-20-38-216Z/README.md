# Phase 2A.4 final soak evidence

- Worker: `mca-multiplayer-staging`
- Deployed version: `a4a5d9cd-87d6-4078-8ed7-3f677d87c03b`
- Room: `phase2a4-main6-mvupcv34`
- Window: `2026-10-30T08:20:39.141Z` – `2026-10-30T08:50:38.981Z` (1,799.84 s)
- Topology: 1v1, two raw WebSocket clients, 20 Hz simulation, 10 Hz updates, seat 0 commands every 5 s and production every 180 s, seat 1 completely idle except keepalive.
- Result: PASS. 35,994 ticks (19.9995 Hz), both seats received `victory`/`defeat` at tick 35,994, socket close 1000 `match-finished`, reservation `r93` released.

## Files

| File | Contents |
| --- | --- |
| `summary.json` | Harness summary: protocol/byte/tick/gap/command/reconstruction/reservation counts |
| `status-final.json` | Authoritative final room status and diagnostics |
| `metrics.jsonl` | Timestamped command, ack, keepalive, interval, assembly and socket events |
| `run.log` | Human-readable timestamped run log |
| `room.json` | Sanitised room handle (seat tokens removed) |
| `../phase2a4-main6-platform-metrics.json` | Cloudflare GraphQL evidence for this exact room/window |

## Key measurements

- Updates: 7 syncs and 17,992 deltas per seat; 0 rejected assembly updates, 0 resyncs.
- First sync: 58,975 B (seat 0), 58,969 B (seat 1); static map 41,797 B sent once per seat.
- Delta size p50: 397 B / 411 B; p95: 1,427 B / 412 B; p99: 1,757 B / 413 B; max: 3,235 B / 413 B.
- Total outbound: 17,497,285 B (16.69 MiB) versus 2,159,214,532 B in the Phase 2A.3 baseline.
- Update gaps: p50 100 ms, p95 102 ms, p99 123 ms, max 257 ms.
- Commands: 358 accepted, 0 rejected, 0 timeouts; ack latency p50 14 ms, p95 19 ms, p99 50 ms.
- Keepalive: 89 sent and 89 acked per seat, 0 rate-limited.
- Persistence: 121 snapshot cycles, 211 meta cycles, 726 chunks, 31,300,626 B written, max snapshot 262,101 B, 0 failures.
- Reservation: 89 heartbeat successes, 0 failures, 1 release, 0 release failures.
- Platform: 19,697,594 µs CPU, 230.411 GB-s, 536 inbound / 36,540 outbound WebSocket messages, 0 CPU/memory/fatal errors.
- Platform memory: 6.90 MB first, 34.72 MB peak at 20 m, 17.10 MB after a heap drop at 27 m, 18.80 MB last.

Seat tokens and the admin token are not stored here.
