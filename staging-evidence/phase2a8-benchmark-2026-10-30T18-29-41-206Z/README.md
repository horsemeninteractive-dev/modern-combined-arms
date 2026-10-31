# Phase 2A.8 local pathfinding A/B evidence

Generated 2026-10-30T18:31:22.601Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

The old variant is the reconstructed pre-optimisation source tree in `tmp/phase2a8-old`;
the new variant is the working tree. Both run the real calibration workload in the same
Node process. Each row is a block median; a block prepares fresh worlds outside the timed
window, then runs the whole batch, alternating old/new order every block. These are local
wall-clock values, not Cloudflare Worker CPU measurements.

| Task | Old median | New median | Change | Blocks | Batch |
| --- | --- | --- | --- | --- | --- |
| apply-commands-stress | 15.415 ms | 15.215 ms | -1.3% | 8 | 24 |
| first-tick-stress | 17.35 ms | 16.916 ms | -2.5% | 8 | 24 |
| first-tick-no-orders | 1.922 ms | 2.096 ms | 9.1% | 8 | 24 |
| single-order | 0.006 ms | 0.009 ms | 50% | 8 | 200 |
| path-scaling-9 | 3.244 ms | 2.886 ms | -11% | 8 | 24 |
| path-scaling-36 | 6.15 ms | 6.459 ms | 5% | 8 | 24 |
| astar-dynamic-traffic | 67.397 ms/1k | 62.064 ms/1k | -7.9% | 8 | 2000 |

`apply-commands-stress`, `first-tick-*` and the scaling tasks use the real Game with the
Phase 2A.6 stress scenario. `astar-dynamic-traffic` is a pure pathfinding microbenchmark
and is not a game-frame measurement.

## Coarse allocation observation

Method: heapUsed delta across one command burst, forced GC before baseline, result retained; coarse and local. Median over 12 pairs.

| Variant | Median heap delta | Min | Max |
| --- | --- | --- | --- |
| Old | 14548560 B | 13167816 B | 15278792 B |
| New | 9937876 B | 9731608 B | 10954056 B |

This delta is dominated by retained path arrays and other command-side allocations as well
as uncollected temporary masks/nodes, so it is a direction-and-scale observation, not an
exact allocation-accounting result.
