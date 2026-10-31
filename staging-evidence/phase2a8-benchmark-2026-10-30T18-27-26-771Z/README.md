# Phase 2A.8 local pathfinding A/B evidence

Generated 2026-10-30T18:28:06.072Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

The old variant is the reconstructed pre-optimisation source tree in `tmp/phase2a8-old`;
the new variant is the working tree. Both run the real calibration workload in the same
Node process, alternating order every repetition. These are local wall-clock values, not
Cloudflare Worker CPU measurements.

| Task | Old median (ms) | New median (ms) | Change | Old p10-p90 | New p10-p90 |
| --- | --- | --- | --- | --- | --- |
| apply-commands-stress | 12.577 | 13.128 | 4.4% | 11.142-17.636 | 11.004-17.286 |
| first-tick-stress | 16.274 | 15.072 | -7.4% | 14.097-24.67 | 13.713-22.804 |
| first-tick-no-orders | 1.713 | 1.509 | -11.9% | 1.411-3.083 | 1.382-2.482 |
| single-order | 0.015 | 0.013 | -13.3% | 0.011-0.023 | 0.009-0.017 |
| path-scaling-9 | 1.657 | 1.728 | 4.3% | 1.444-2.302 | 1.369-3.387 |
| path-scaling-36 | 5.387 | 5.367 | -0.4% | 4.575-9.774 | 4.329-8.595 |

## Coarse allocation observation

Method: heapUsed delta across one command burst, forced GC before baseline, result retained; coarse and local. Median over 12 pairs.

| Variant | Median heap delta | Min | Max |
| --- | --- | --- | --- |
| Old | 15302976 B | 9926656 B | 17216440 B |
| New | 10509508 B | 8499016 B | 12236704 B |

This delta is dominated by retained path arrays and other command-side allocations as well
as uncollected temporary masks/nodes, so it is a direction-and-scale observation, not an
exact allocation-accounting result.
