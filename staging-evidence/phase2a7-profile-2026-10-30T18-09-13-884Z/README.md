# Phase 2A.7 local profiling evidence

Generated 2026-10-30T18:10:13.127Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

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
| setup-baseline | 0 | 20 | 204 | 10.2 | 6.142 | 1 |
| setup-stress | 0 | 20 | 268 | 13.4 | 8.311 | 1 |
| apply-commands-stress | 0 | 20 | 644 | 32.2 | 18.777 | 1 |
| first-tick-baseline | 1 | 20 | 5 | 0.25 | 0.044 | 1 |
| first-tick-stress | 1 | 30 | 1097 | 36.567 | 20.504 | 1 |
| first-tick-stress-no-commands | 1 | 30 | 114 | 3.8 | 1.945 | 1 |
| second-tick-stress | 1 | 40 | 144 | 3.6 | 2.101 | 1 |
| steady-tick-31-stress | 1 | 40 | 119 | 2.975 | 1.6 | 1 |
| steady-batch-20-stress | 20 | 10 | 679 | 3.395 | 45.035 | 1 |
| combat-batch-20-stress | 20 | 8 | 487 | 3.044 | 36.292 | 1 |
| steady-tick-31-baseline | 1 | 20 | 4 | 0.2 | 0.053 | 1 |
| result-collection-stress | 0 | 10 | 2 | 0.2 | 0.028 | 1 |
| path-scaling-9 | 0 | 30 | 115 | 3.833 | 2.047 | 1 |
| path-scaling-18 | 0 | 30 | 208 | 6.933 | 3.982 | 1 |
| path-scaling-27 | 0 | 30 | 336 | 11.2 | 6.355 | 1 |
| path-scaling-36 | 0 | 30 | 369 | 12.3 | 7.137 | 1 |

## Pathfinding scaling probe (local, path requests only)

| Ordered ground units | Samples | Samples/rep | Local elapsed median (ms) |
| --- | --- | --- | --- |
| 9 | 115 | 3.8 | 2.047 |
| 18 | 208 | 6.9 | 3.982 |
| 27 | 336 | 11.2 | 6.355 |
| 36 | 369 | 12.3 | 7.137 |

## Attribution for key stages

### first-tick-stress

Samples: 1097 across 30 repetitions.

| Category | % of samples |
| --- | --- |
| pathfinding | 73.66% |
| units | 12.31% |
| GC | 3.37% |
| other | 3.28% |
| terrain-queries | 3.01% |
| line-of-sight | 2.1% |
| command-application | 1.91% |
| projectiles-combat | 0.27% |
| buildings-economy | 0.09% |

| Function | % of samples | Samples |
| --- | --- | --- |
| findPath | 41.11% | 451 |
| diagonalBlocked | 6.75% | 74 |
| navFor | 6.2% | 68 |
| stepCost | 6.02% | 66 |
| findPathFor | 5.38% | 59 |
| steerAroundUnits | 3.46% | 38 |
| acquireAutoTarget | 3.37% | 37 |
| (garbage collector) | 3.37% | 37 |
| stepCost | 2.83% | 31 |
| hasLineOfSight | 2.1% | 23 |
| push | 1.91% | 21 |
| pop | 1.73% | 19 |

### steady-batch-20-stress

Samples: 679 across 10 repetitions.

| Category | % of samples |
| --- | --- |
| units | 77.76% |
| line-of-sight | 8.39% |
| other | 6.33% |
| vision | 4.71% |
| buildings-economy | 1.18% |
| terrain-queries | 0.88% |
| projectiles-combat | 0.59% |
| cleanup | 0.15% |

| Function | % of samples | Samples |
| --- | --- | --- |
| steerAroundUnits | 27.69% | 188 |
| acquireAutoTarget | 12.22% | 83 |
| moveAlongPath | 11.05% | 75 |
| hasLineOfSight | 8.39% | 57 |
| separateUnits | 6.48% | 44 |
| updateAutoEngagement | 5.45% | 37 |
| updateUnits | 4.86% | 33 |
| canOccupy | 2.95% | 20 |
| unitDef | 2.8% | 19 |
| refreshVision | 2.36% | 16 |
| stampVision | 1.91% | 13 |
| tick | 1.62% | 11 |

### combat-batch-20-stress

Samples: 487 across 8 repetitions.

| Category | % of samples |
| --- | --- |
| units | 75.36% |
| line-of-sight | 8.01% |
| other | 6.78% |
| vision | 4.93% |
| projectiles-combat | 1.85% |
| buildings-economy | 1.64% |
| terrain-queries | 1.23% |
| GC | 0.21% |

| Function | % of samples | Samples |
| --- | --- | --- |
| steerAroundUnits | 28.75% | 140 |
| moveAlongPath | 11.91% | 58 |
| acquireAutoTarget | 9.03% | 44 |
| hasLineOfSight | 8.01% | 39 |
| updateAutoEngagement | 6.57% | 32 |
| separateUnits | 6.37% | 31 |
| updateUnits | 3.7% | 18 |
| canOccupy | 3.29% | 16 |
| unitDef | 2.87% | 14 |
| stampVision | 2.46% | 12 |
| tick | 1.85% | 9 |
| refreshVision | 1.85% | 9 |

## Refactor equivalence

All 14 baseline/stress batch records match the Phase 2A.6 deployed checksums exactly.

Raw profiles: `cpu-profiles/*.cpuprofile` for the first-tick stress/no-command, steady and combat batches.
