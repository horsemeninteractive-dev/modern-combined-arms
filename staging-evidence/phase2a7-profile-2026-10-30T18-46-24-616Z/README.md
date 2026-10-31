# Phase 2A.7 local profiling evidence

Generated 2026-10-30T18:47:09.896Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

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
| setup-baseline | 0 | 20 | 235 | 11.75 | 7.774 | 1 |
| setup-stress | 0 | 20 | 243 | 12.15 | 7.175 | 1 |
| apply-commands-stress | 0 | 20 | 493 | 24.65 | 14.83 | 1 |
| first-tick-baseline | 1 | 20 | 4 | 0.2 | 0.05 | 1 |
| first-tick-stress | 1 | 30 | 1004 | 33.467 | 20.527 | 1 |
| first-tick-stress-no-commands | 1 | 30 | 90 | 3 | 1.663 | 1 |
| second-tick-stress | 1 | 40 | 126 | 3.15 | 1.757 | 1 |
| steady-tick-31-stress | 1 | 40 | 97 | 2.425 | 1.412 | 1 |
| steady-batch-20-stress | 20 | 10 | 560 | 2.8 | 33.243 | 1 |
| combat-batch-20-stress | 20 | 8 | 466 | 2.913 | 37.427 | 1 |
| steady-tick-31-baseline | 1 | 20 | 2 | 0.1 | 0.036 | 1 |
| result-collection-stress | 0 | 10 | 1 | 0.1 | 0.017 | 1 |
| path-scaling-9 | 0 | 30 | 100 | 3.333 | 1.815 | 1 |
| path-scaling-18 | 0 | 30 | 231 | 7.7 | 4.449 | 1 |
| path-scaling-27 | 0 | 30 | 237 | 7.9 | 4.221 | 1 |
| path-scaling-36 | 0 | 30 | 288 | 9.6 | 5.22 | 1 |

## Pathfinding scaling probe (local, path requests only)

| Ordered ground units | Samples | Samples/rep | Local elapsed median (ms) |
| --- | --- | --- | --- |
| 9 | 100 | 3.3 | 1.815 |
| 18 | 231 | 7.7 | 4.449 |
| 27 | 237 | 7.9 | 4.221 |
| 36 | 288 | 9.6 | 5.22 |

## Attribution for key stages

### first-tick-stress

Samples: 1004 across 30 repetitions.

| Category | % of samples |
| --- | --- |
| pathfinding | 68.33% |
| units | 10.66% |
| terrain-queries | 9.06% |
| other | 3.49% |
| GC | 3.19% |
| command-application | 2.59% |
| line-of-sight | 1.59% |
| projectiles-combat | 0.7% |
| buildings-economy | 0.4% |

| Function | % of samples | Samples |
| --- | --- | --- |
| findPath | 43.82% | 440 |
| stepCost | 10.36% | 104 |
| moveCost | 6.77% | 68 |
| stepCost | 3.69% | 37 |
| (garbage collector) | 3.19% | 32 |
| findPathFor | 2.99% | 30 |
| diagonalBlocked | 2.49% | 25 |
| acquireAutoTarget | 2.29% | 23 |
| steerAroundUnits | 1.99% | 20 |
| commandMove | 1.69% | 17 |
| hasLineOfSight | 1.59% | 16 |
| moveAlongPath | 1.49% | 15 |

### steady-batch-20-stress

Samples: 560 across 10 repetitions.

| Category | % of samples |
| --- | --- |
| units | 73.93% |
| other | 8.75% |
| line-of-sight | 8.57% |
| vision | 6.43% |
| terrain-queries | 1.07% |
| projectiles-combat | 0.54% |
| buildings-economy | 0.54% |
| GC | 0.18% |

| Function | % of samples | Samples |
| --- | --- | --- |
| steerAroundUnits | 25% | 140 |
| acquireAutoTarget | 11.61% | 65 |
| moveAlongPath | 11.07% | 62 |
| hasLineOfSight | 8.57% | 48 |
| separateUnits | 6.96% | 39 |
| updateUnits | 5.54% | 31 |
| canOccupy | 3.75% | 21 |
| updateAutoEngagement | 3.75% | 21 |
| stampVision | 3.04% | 17 |
| refreshVision | 2.68% | 15 |
| tick | 2.5% | 14 |
| unitDef | 1.96% | 11 |

### combat-batch-20-stress

Samples: 466 across 8 repetitions.

| Category | % of samples |
| --- | --- |
| units | 76.18% |
| line-of-sight | 7.94% |
| vision | 6.44% |
| other | 5.36% |
| buildings-economy | 1.5% |
| projectiles-combat | 1.5% |
| cleanup | 0.64% |
| GC | 0.21% |
| terrain-queries | 0.21% |

| Function | % of samples | Samples |
| --- | --- | --- |
| steerAroundUnits | 27.25% | 127 |
| moveAlongPath | 13.52% | 63 |
| acquireAutoTarget | 11.37% | 53 |
| hasLineOfSight | 7.94% | 37 |
| updateUnits | 6.87% | 32 |
| updateAutoEngagement | 5.15% | 24 |
| separateUnits | 4.94% | 23 |
| stampVision | 3.86% | 18 |
| canOccupy | 2.15% | 10 |
| refreshVision | 2.15% | 10 |
| unitDef | 1.72% | 8 |
| impact | 1.29% | 6 |

## Refactor equivalence

All 14 baseline/stress batch records match the Phase 2A.6 deployed checksums exactly.

Raw profiles: `cpu-profiles/*.cpuprofile` for the first-tick stress/no-command, steady and combat batches.
