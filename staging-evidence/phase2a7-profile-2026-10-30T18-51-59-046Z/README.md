# Phase 2A.7 local profiling evidence

Generated 2026-10-30T18:52:46.229Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

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
| setup-baseline | 0 | 20 | 230 | 11.5 | 7.112 | 1 |
| setup-stress | 0 | 20 | 249 | 12.45 | 6.875 | 1 |
| apply-commands-stress | 0 | 20 | 512 | 25.6 | 15.459 | 1 |
| first-tick-baseline | 1 | 20 | 4 | 0.2 | 0.049 | 1 |
| first-tick-stress | 1 | 30 | 904 | 30.133 | 17.098 | 1 |
| first-tick-stress-no-commands | 1 | 30 | 93 | 3.1 | 1.706 | 1 |
| second-tick-stress | 1 | 40 | 116 | 2.9 | 1.727 | 1 |
| steady-tick-31-stress | 1 | 40 | 102 | 2.55 | 1.472 | 1 |
| steady-batch-20-stress | 20 | 10 | 534 | 2.67 | 33.739 | 1 |
| combat-batch-20-stress | 20 | 8 | 462 | 2.888 | 36.882 | 1 |
| steady-tick-31-baseline | 1 | 20 | 2 | 0.1 | 0.04 | 1 |
| result-collection-stress | 0 | 10 | 2 | 0.2 | 0.066 | 1 |
| path-scaling-9 | 0 | 30 | 90 | 3 | 1.68 | 1 |
| path-scaling-18 | 0 | 30 | 188 | 6.267 | 3.471 | 1 |
| path-scaling-27 | 0 | 30 | 229 | 7.633 | 4.154 | 1 |
| path-scaling-36 | 0 | 30 | 273 | 9.1 | 5.125 | 1 |

## Pathfinding scaling probe (local, path requests only)

| Ordered ground units | Samples | Samples/rep | Local elapsed median (ms) |
| --- | --- | --- | --- |
| 9 | 90 | 3.0 | 1.68 |
| 18 | 188 | 6.3 | 3.471 |
| 27 | 229 | 7.6 | 4.154 |
| 36 | 273 | 9.1 | 5.125 |

## Attribution for key stages

### first-tick-stress

Samples: 904 across 30 repetitions.

| Category | % of samples |
| --- | --- |
| pathfinding | 69.14% |
| units | 14.05% |
| terrain-queries | 6.53% |
| GC | 2.99% |
| command-application | 2.88% |
| other | 2.21% |
| line-of-sight | 1.44% |
| projectiles-combat | 0.44% |
| buildings-economy | 0.22% |
| runtime | 0.11% |

| Function | % of samples | Samples |
| --- | --- | --- |
| findPath | 43.03% | 389 |
| stepCost | 10.62% | 96 |
| moveCost | 3.87% | 35 |
| stepCost | 3.54% | 32 |
| steerAroundUnits | 3.32% | 30 |
| acquireAutoTarget | 2.99% | 27 |
| (garbage collector) | 2.99% | 27 |
| pop | 2.54% | 23 |
| findPathFor | 2.54% | 23 |
| diagonalBlocked | 2.43% | 22 |
| moveAlongPath | 1.88% | 17 |
| commandMove | 1.66% | 15 |

### steady-batch-20-stress

Samples: 534 across 10 repetitions.

| Category | % of samples |
| --- | --- |
| units | 75.09% |
| line-of-sight | 8.8% |
| vision | 6.18% |
| other | 5.06% |
| buildings-economy | 1.69% |
| projectiles-combat | 1.5% |
| GC | 0.94% |
| terrain-queries | 0.75% |

| Function | % of samples | Samples |
| --- | --- | --- |
| steerAroundUnits | 25.84% | 138 |
| acquireAutoTarget | 13.48% | 72 |
| moveAlongPath | 11.05% | 59 |
| hasLineOfSight | 8.8% | 47 |
| separateUnits | 5.81% | 31 |
| updateUnits | 5.43% | 29 |
| updateAutoEngagement | 4.12% | 22 |
| refreshVision | 3% | 16 |
| canOccupy | 3% | 16 |
| unitDef | 2.62% | 14 |
| stampVision | 2.43% | 13 |
| canWeaponTarget | 0.94% | 5 |

### combat-batch-20-stress

Samples: 462 across 8 repetitions.

| Category | % of samples |
| --- | --- |
| units | 73.59% |
| line-of-sight | 8.23% |
| other | 7.58% |
| vision | 4.98% |
| projectiles-combat | 2.16% |
| buildings-economy | 1.3% |
| GC | 1.3% |
| terrain-queries | 0.87% |

| Function | % of samples | Samples |
| --- | --- | --- |
| steerAroundUnits | 27.71% | 128 |
| moveAlongPath | 12.77% | 59 |
| acquireAutoTarget | 9.96% | 46 |
| hasLineOfSight | 8.23% | 38 |
| separateUnits | 5.84% | 27 |
| updateUnits | 4.76% | 22 |
| updateAutoEngagement | 4.11% | 19 |
| stampVision | 3.25% | 15 |
| unitDef | 3.03% | 14 |
| canOccupy | 1.95% | 9 |
| tick | 1.73% | 8 |
| refreshVision | 1.52% | 7 |

## Refactor equivalence

All 14 baseline/stress batch records match the Phase 2A.6 deployed checksums exactly.

Raw profiles: `cpu-profiles/*.cpuprofile` for the first-tick stress/no-command, steady and combat batches.
