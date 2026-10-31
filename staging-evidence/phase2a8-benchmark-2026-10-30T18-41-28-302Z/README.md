# Phase 2A.8 local pathfinding A/B evidence

Generated 2026-10-30T18:43:01.244Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

The old variant is the reconstructed pre-optimisation source tree in `tmp/phase2a8-old`;
the new variant is the working tree. Both run the real calibration workload in the same
Node process. Each row is a block median; a block prepares fresh worlds outside the timed
window, then runs the whole batch, alternating old/new order every block. These are local
wall-clock values, not Cloudflare Worker CPU measurements.

| Task | Old median | New median | Change | Blocks | Batch |
| --- | --- | --- | --- | --- | --- |
| apply-commands-stress | 14.146 ms | 12.635 ms | -10.7% | 8 | 24 |
| first-tick-stress | 16.626 ms | 14.349 ms | -13.7% | 8 | 24 |
| first-tick-no-orders | 2.981 ms | 1.551 ms | -48% | 8 | 24 |
| single-order | 0.007 ms | 0.006 ms | -14.3% | 8 | 200 |
| path-scaling-9 | 2.98 ms | 2.401 ms | -19.4% | 8 | 24 |
| path-scaling-36 | 5.56 ms | 5.259 ms | -5.4% | 8 | 24 |
| traffic-mask-prep-36 | 1.67 ms | 0.244 ms | -85.4% | 8 | 36 |
| astar-dynamic-traffic | 54.824 ms/1k | 57.863 ms/1k | 5.5% | 8 | 2000 |

`apply-commands-stress`, `first-tick-*` and the scaling tasks use the real Game with the
Phase 2A.6 stress scenario. `astar-dynamic-traffic` is a pure pathfinding microbenchmark
and is not a game-frame measurement.

## Coarse allocation observation

Method: heapUsed delta across one command burst, forced GC before baseline, result retained; coarse and local. Median over 12 pairs.

| Variant | Median heap delta | Min | Max |
| --- | --- | --- | --- |
| Old | 14531392 B | 13704328 B | 15719368 B |
| New | 9930228 B | 9523504 B | 10909672 B |

This delta is dominated by retained path arrays and other command-side allocations as well
as uncollected temporary masks/nodes, so it is a direction-and-scale observation, not an
exact allocation-accounting result.

## Traffic-mask external memory

external memory delta for 36 old per-request masks versus one command batch, masks retained until read. Median over 12 pairs.

| Variant | Median external delta | Structural expectation |
| --- | --- | --- |
| Old (36 requests) | 248832 B | 248832 B |
| New (one batch) | 6912 B | 6912 B |
