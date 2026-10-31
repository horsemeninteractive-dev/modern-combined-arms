# Phase 2A.8 local pathfinding A/B evidence

Generated 2026-10-30T18:39:46.984Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

The old variant is the reconstructed pre-optimisation source tree in `tmp/phase2a8-old`;
the new variant is the working tree. Both run the real calibration workload in the same
Node process. Each row is a block median; a block prepares fresh worlds outside the timed
window, then runs the whole batch, alternating old/new order every block. These are local
wall-clock values, not Cloudflare Worker CPU measurements.

| Task | Old median | New median | Change | Blocks | Batch |
| --- | --- | --- | --- | --- | --- |
| apply-commands-stress | 15.596 ms | 13.601 ms | -12.8% | 8 | 24 |
| first-tick-stress | 17.629 ms | 15.453 ms | -12.3% | 8 | 24 |
| first-tick-no-orders | 2.941 ms | 1.727 ms | -41.3% | 8 | 24 |
| single-order | 0.006 ms | 0.01 ms | 66.7% | 8 | 200 |
| path-scaling-9 | 2.793 ms | 2.398 ms | -14.1% | 8 | 24 |
| path-scaling-36 | 5.776 ms | 5.304 ms | -8.2% | 8 | 24 |
| traffic-mask-prep-36 | 2.063 ms | 0.198 ms | -90.4% | 8 | 36 |
| astar-dynamic-traffic | 59.66 ms/1k | 56.31 ms/1k | -5.6% | 8 | 2000 |

`apply-commands-stress`, `first-tick-*` and the scaling tasks use the real Game with the
Phase 2A.6 stress scenario. `astar-dynamic-traffic` is a pure pathfinding microbenchmark
and is not a game-frame measurement.

## Coarse allocation observation

Method: heapUsed delta across one command burst, forced GC before baseline, result retained; coarse and local. Median over 12 pairs.

| Variant | Median heap delta | Min | Max |
| --- | --- | --- | --- |
| Old | 14481252 B | 13853432 B | 15495216 B |
| New | 9749064 B | 9253984 B | 10581016 B |

This delta is dominated by retained path arrays and other command-side allocations as well
as uncollected temporary masks/nodes, so it is a direction-and-scale observation, not an
exact allocation-accounting result.
