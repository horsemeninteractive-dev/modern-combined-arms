# Phase 2A.8 local pathfinding A/B evidence

Generated 2026-10-30T18:24:33.401Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

The old variant is the reconstructed pre-optimisation source tree in `tmp/phase2a8-old`;
the new variant is the working tree. Both run the real calibration workload in the same
Node process, alternating order every repetition. These are local wall-clock values, not
Cloudflare Worker CPU measurements.

| Task | Old median (ms) | New median (ms) | Change | Old p10-p90 | New p10-p90 |
| --- | --- | --- | --- | --- | --- |
| apply-commands-stress | 14.489 | 12.247 | -15.5% | 12.756-21.522 | 10.971-16.24 |
| first-tick-stress | 21.457 | 18.67 | -13% | 15.532-38.662 | 15.73-29.36 |
| first-tick-no-orders | 1.715 | 1.595 | -7% | 1.452-2.83 | 1.364-2.436 |
| path-scaling-36 | 6.995 | 5.607 | -19.8% | 4.883-12.711 | 4.16-17.412 |

## Coarse allocation observation

Method: heapUsed delta across one command burst, forced GC before baseline, result retained; coarse and local. Median over 12 pairs.

| Variant | Median heap delta | Min | Max |
| --- | --- | --- | --- |
| Old | 15710216 B | 12064568 B | 17275648 B |
| New | 10524284 B | 8974736 B | 12360152 B |

This delta is dominated by retained path arrays and other command-side allocations as well
as uncollected temporary masks/nodes, so it is a direction-and-scale observation, not an
exact allocation-accounting result.
