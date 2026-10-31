# Phase 2A.8 local pathfinding A/B evidence

Generated 2026-10-30T18:26:14.683Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

The old variant is the reconstructed pre-optimisation source tree in `tmp/phase2a8-old`;
the new variant is the working tree. Both run the real calibration workload in the same
Node process, alternating order every repetition. These are local wall-clock values, not
Cloudflare Worker CPU measurements.

| Task | Old median (ms) | New median (ms) | Change | Old p10-p90 | New p10-p90 |
| --- | --- | --- | --- | --- | --- |
| apply-commands-stress | 15.709 | 13.317 | -15.2% | 12.954-19.928 | 11.682-16.73 |
| first-tick-stress | 15.928 | 15.842 | -0.5% | 14.04-20.273 | 13.759-23.504 |
| first-tick-no-orders | 1.661 | 2.002 | 20.5% | 1.359-2.958 | 1.438-2.942 |
| single-order | 0.015 | 0.059 | 293.3% | 0.011-0.021 | 0.047-0.123 |
| path-scaling-9 | 1.707 | 1.795 | 5.2% | 1.438-2.852 | 1.422-3.018 |
| path-scaling-36 | 6.096 | 4.914 | -19.4% | 4.609-10.047 | 4.141-9.198 |

## Coarse allocation observation

Method: heapUsed delta across one command burst, forced GC before baseline, result retained; coarse and local. Median over 12 pairs.

| Variant | Median heap delta | Min | Max |
| --- | --- | --- | --- |
| Old | 15537376 B | 10395184 B | 17226008 B |
| New | 10293652 B | 8217920 B | 12336672 B |

This delta is dominated by retained path arrays and other command-side allocations as well
as uncollected temporary masks/nodes, so it is a direction-and-scale observation, not an
exact allocation-accounting result.
