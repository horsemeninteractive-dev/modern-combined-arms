# Phase 2A.8 local pathfinding A/B evidence

Generated 2026-10-30T18:34:31.610Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

The old variant is the reconstructed pre-optimisation source tree in `tmp/phase2a8-old`;
the new variant is the working tree. Both run the real calibration workload in the same
Node process. Each row is a block median; a block prepares fresh worlds outside the timed
window, then runs the whole batch, alternating old/new order every block. These are local
wall-clock values, not Cloudflare Worker CPU measurements.

| Task | Old median | New median | Change | Blocks | Batch |
| --- | --- | --- | --- | --- | --- |
| apply-commands-stress | 16.55 ms | 16.061 ms | -3% | 8 | 24 |
| first-tick-stress | 19.698 ms | 17.232 ms | -12.5% | 8 | 24 |
| first-tick-no-orders | 2.907 ms | 1.943 ms | -33.2% | 8 | 24 |
| single-order | 0.011 ms | 0.011 ms | 0% | 8 | 200 |
| path-scaling-9 | 3.407 ms | 3.105 ms | -8.9% | 8 | 24 |
| path-scaling-36 | 6.967 ms | 6.191 ms | -11.1% | 8 | 24 |
| astar-dynamic-traffic | 65.167 ms/1k | 65.813 ms/1k | 1% | 8 | 2000 |

`apply-commands-stress`, `first-tick-*` and the scaling tasks use the real Game with the
Phase 2A.6 stress scenario. `astar-dynamic-traffic` is a pure pathfinding microbenchmark
and is not a game-frame measurement.

## Coarse allocation observation

Method: heapUsed delta across one command burst, forced GC before baseline, result retained; coarse and local. Median over 12 pairs.

| Variant | Median heap delta | Min | Max |
| --- | --- | --- | --- |
| Old | 14553376 B | 9508688 B | 15367472 B |
| New | 9821704 B | 9587352 B | 10865736 B |

This delta is dominated by retained path arrays and other command-side allocations as well
as uncollected temporary masks/nodes, so it is a direction-and-scale observation, not an
exact allocation-accounting result.
