# Phase 2A.7 local profiling evidence

Generated 2026-10-30T18:22:21.118Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

Method: V8 sampling CPU profiler around exact calibration stages, loaded through
Vite's SSR module loader. Precise coverage supplied call counts. Repetitions are prepared
before each profiling window, so only measured work is sampled; hashing and checksums are
computed after the window. Samples whose top frame is the inspector transport are excluded.

**Local evidence only.** These are not Cloudflare Worker CPU measurements. Sample shares are
relative main-thread attribution for a synchronous workload, not CPU time or a per-tick
distribution. Local elapsed values are wall-clock context and are not CPU time either.

## Command

```bash
node tools/phase2a7-first-tick-profile.mjs
```

## Stage totals

| Stage | Ticks/rep | Reps | Samples | Samples/tick | Local elapsed median (ms) | Unique checksums |
| --- | --- | --- | --- | --- | --- | --- |
| setup-baseline | 0 | 20 | 204 | 10.2 | 6.389 | 1 |
| setup-stress | 0 | 20 | 245 | 12.25 | 7.222 | 1 |
| apply-commands-stress | 0 | 20 | 507 | 25.35 | 15.534 | 1 |
| first-tick-baseline | 1 | 20 | 2 | 0.1 | 0.041 | 1 |
| first-tick-stress | 1 | 30 | 959 | 31.967 | 17.392 | 1 |
| first-tick-stress-no-commands | 1 | 30 | 96 | 3.2 | 1.704 | 1 |
| second-tick-stress | 1 | 40 | 132 | 3.3 | 1.863 | 1 |
| steady-tick-31-stress | 1 | 40 | 101 | 2.525 | 1.409 | 1 |
| steady-batch-20-stress | 20 | 10 | 560 | 2.8 | 33.027 | 1 |
| combat-batch-20-stress | 20 | 8 | 491 | 3.069 | 41.97 | 1 |
| steady-tick-31-baseline | 1 | 20 | 6 | 0.3 | 0.056 | 1 |
| result-collection-stress | 0 | 10 | 2 | 0.2 | 0.064 | 1 |
| path-scaling-9 | 0 | 30 | 92 | 3.067 | 1.686 | 1 |
| path-scaling-18 | 0 | 30 | 228 | 7.6 | 4.14 | 1 |
| path-scaling-27 | 0 | 30 | 227 | 7.567 | 4.224 | 1 |
| path-scaling-36 | 0 | 30 | 276 | 9.2 | 5.088 | 1 |

## Pathfinding scaling probe (local, path requests only)

| Ordered ground units | Samples | Samples/rep | Local elapsed median (ms) |
| --- | --- | --- | --- |
| 9 | 92 | 3.1 | 1.686 |
| 18 | 228 | 7.6 | 4.14 |
| 27 | 227 | 7.6 | 4.224 |
| 36 | 276 | 9.2 | 5.088 |

## Attribution for key stages

### first-tick-stress

Samples: 959 across 30 repetitions.

| Category | % of samples |
| --- | --- |
| pathfinding | 69.24% |
| units | 13.24% |
| terrain-queries | 7.92% |
| GC | 2.92% |
| other | 2.5% |
| command-application | 1.46% |
| line-of-sight | 1.36% |
| projectiles-combat | 0.94% |
| buildings-economy | 0.21% |
| runtime | 0.21% |

| Function | % of samples | Samples |
| --- | --- | --- |
| findPath | 44.11% | 423 |
| stepCost | 9.49% | 91 |
| moveCost | 5.63% | 54 |
| findPathFor | 3.44% | 33 |
| stepCost | 3.34% | 32 |
| (garbage collector) | 2.92% | 28 |
| acquireAutoTarget | 2.71% | 26 |
| diagonalBlocked | 2.4% | 23 |
| steerAroundUnits | 2.29% | 22 |
| updateUnits | 1.88% | 18 |
| pop | 1.67% | 16 |
| grow | 1.36% | 13 |

### steady-batch-20-stress

Samples: 560 across 10 repetitions.

| Category | % of samples |
| --- | --- |
| units | 75.36% |
| line-of-sight | 8.93% |
| other | 6.43% |
| vision | 5.54% |
| buildings-economy | 1.25% |
| projectiles-combat | 1.07% |
| GC | 1.07% |
| terrain-queries | 0.36% |

| Function | % of samples | Samples |
| --- | --- | --- |
| steerAroundUnits | 29.64% | 166 |
| moveAlongPath | 11.79% | 66 |
| acquireAutoTarget | 10.36% | 58 |
| hasLineOfSight | 8.93% | 50 |
| separateUnits | 5.89% | 33 |
| updateUnits | 4.46% | 25 |
| updateAutoEngagement | 3.93% | 22 |
| canOccupy | 2.86% | 16 |
| refreshVision | 2.68% | 15 |
| unitDef | 2.32% | 13 |
| stampVision | 2.32% | 13 |
| entityTargetClass | 1.79% | 10 |

### combat-batch-20-stress

Samples: 491 across 8 repetitions.

| Category | % of samples |
| --- | --- |
| units | 75.56% |
| line-of-sight | 8.35% |
| other | 6.11% |
| vision | 5.91% |
| buildings-economy | 1.22% |
| GC | 1.02% |
| projectiles-combat | 1.02% |
| terrain-queries | 0.61% |
| cleanup | 0.2% |

| Function | % of samples | Samples |
| --- | --- | --- |
| steerAroundUnits | 28.11% | 138 |
| moveAlongPath | 11.41% | 56 |
| acquireAutoTarget | 8.76% | 43 |
| hasLineOfSight | 8.35% | 41 |
| updateUnits | 8.15% | 40 |
| separateUnits | 5.7% | 28 |
| stampVision | 3.67% | 18 |
| updateAutoEngagement | 3.46% | 17 |
| canOccupy | 3.05% | 15 |
| unitDef | 2.85% | 14 |
| refreshVision | 1.83% | 9 |
| entityTargetClass | 1.43% | 7 |

## Refactor equivalence

All 14 baseline/stress batch records match the Phase 2A.6 deployed checksums exactly.

Raw profiles: `cpu-profiles/*.cpuprofile` for the first-tick stress/no-command, steady and combat batches.
