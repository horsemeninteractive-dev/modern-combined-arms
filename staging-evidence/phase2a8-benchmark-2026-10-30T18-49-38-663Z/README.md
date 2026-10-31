# Phase 2A.8 local pathfinding A/B evidence

Generated 2026-10-30T18:51:25.743Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

The old variant is the reconstructed pre-optimisation source tree in `tmp/phase2a8-old`;
the new variant is the working tree. Both run the real calibration workload in the same
Node process. Each row is a block median; a block prepares fresh worlds outside the timed
window, then runs the whole batch, alternating old/new order every block. These are local
wall-clock values, not Cloudflare Worker CPU measurements.

| Task | Old median | New median | Change | Blocks | Batch |
| --- | --- | --- | --- | --- | --- |
| apply-commands-stress | 15.692 ms | 15.138 ms | -3.5% | 8 | 24 |
| first-tick-stress | 17.408 ms | 14.989 ms | -13.9% | 8 | 24 |
| first-tick-no-orders | 2.758 ms | 2.008 ms | -27.2% | 8 | 24 |
| single-order | 0.012 ms | 0.009 ms | -25% | 8 | 200 |
| path-scaling-9 | 3.372 ms | 2.907 ms | -13.8% | 8 | 24 |
| path-scaling-36 | 6.436 ms | 6.027 ms | -6.4% | 8 | 24 |
| traffic-mask-prep-36 | 1.653 ms | 0.267 ms | -83.8% | 8 | 36 |
| astar-dynamic-traffic | 61.977 ms/1k | 60.98 ms/1k | -1.6% | 8 | 2000 |

`apply-commands-stress`, `first-tick-*` and the scaling tasks use the real Game with the
Phase 2A.6 stress scenario. `astar-dynamic-traffic` is a pure pathfinding microbenchmark
and is not a game-frame measurement.

## Coarse allocation observation

Method: heapUsed delta across one command burst, forced GC before baseline, result retained; coarse and local. Median over 12 pairs.

| Variant | Median heap delta | Min | Max |
| --- | --- | --- | --- |
| Old | 14403644 B | 13781608 B | 15836896 B |
| New | 9939644 B | 9371072 B | 10782552 B |

This delta is dominated by retained path arrays and other command-side allocations as well
as uncollected temporary masks/nodes, so it is a direction-and-scale observation, not an
exact allocation-accounting result.

## Traffic-mask external memory

external memory delta for 36 old per-request masks versus one command batch, masks retained until read. Median over 12 pairs.

| Variant | Median external delta | Structural expectation |
| --- | --- | --- |
| Old (36 requests) | 248832 B | 248832 B |
| New (one batch) | 6912 B | 6912 B |
