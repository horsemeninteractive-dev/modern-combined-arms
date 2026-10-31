# Phase 2A.7 local profiling evidence

Generated 2026-10-30T16:32:42.749Z on win32 x64, Node v24.14.0, CPU AMD Custom APU 0405.

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
| setup-baseline | 0 | 20 | 181 | 9.05 | 5.144 | 1 |
| setup-stress | 0 | 20 | 272 | 13.6 | 8.644 | 1 |
| apply-commands-stress | 0 | 20 | 486 | 24.3 | 14.623 | 1 |
| first-tick-baseline | 1 | 20 | 4 | 0.2 | 0.041 | 1 |
| first-tick-stress | 1 | 30 | 886 | 29.533 | 17.781 | 1 |
| first-tick-stress-no-commands | 1 | 30 | 84 | 2.8 | 1.616 | 1 |
| second-tick-stress | 1 | 40 | 130 | 3.25 | 1.858 | 1 |
| steady-tick-31-stress | 1 | 40 | 99 | 2.475 | 1.524 | 1 |
| steady-batch-20-stress | 20 | 10 | 562 | 2.81 | 36.575 | 1 |
| combat-batch-20-stress | 20 | 8 | 397 | 2.481 | 31.895 | 1 |
| steady-tick-31-baseline | 1 | 20 | 3 | 0.15 | 0.066 | 1 |
| result-collection-stress | 0 | 10 | 1 | 0.1 | 0.016 | 1 |
| path-scaling-9 | 0 | 30 | 116 | 3.867 | 2.247 | 1 |
| path-scaling-18 | 0 | 30 | 197 | 6.567 | 3.547 | 1 |
| path-scaling-27 | 0 | 30 | 254 | 8.467 | 5.002 | 1 |
| path-scaling-36 | 0 | 30 | 299 | 9.967 | 5.401 | 1 |

## Pathfinding scaling probe (local, path requests only)

| Ordered ground units | Samples | Samples/rep | Local elapsed median (ms) |
| --- | --- | --- | --- |
| 9 | 116 | 3.9 | 2.247 |
| 18 | 197 | 6.6 | 3.547 |
| 27 | 254 | 8.5 | 5.002 |
| 36 | 299 | 10.0 | 5.401 |

## Attribution for key stages

### first-tick-stress

Samples: 886 across 30 repetitions.

| Category | % of samples |
| --- | --- |
| pathfinding | 76.41% |
| units | 10.95% |
| terrain-queries | 4.06% |
| line-of-sight | 2.6% |
| GC | 2.03% |
| command-application | 1.58% |
| other | 1.13% |
| projectiles-combat | 0.79% |
| buildings-economy | 0.34% |
| runtime | 0.11% |

| Function | % of samples | Samples |
| --- | --- | --- |
| findPath | 43.68% | 387 |
| diagonalBlocked | 7.56% | 67 |
| stepCost | 5.87% | 52 |
| navFor | 4.63% | 41 |
| findPathFor | 4.29% | 38 |
| steerAroundUnits | 3.72% | 33 |
| stepCost | 3.27% | 29 |
| pop | 2.82% | 25 |
| hasLineOfSight | 2.6% | 23 |
| moveCost | 2.48% | 22 |
| acquireAutoTarget | 2.37% | 21 |
| push | 2.37% | 21 |

### steady-batch-20-stress

Samples: 562 across 10 repetitions.

| Category | % of samples |
| --- | --- |
| units | 76.87% |
| line-of-sight | 8.19% |
| other | 5.87% |
| vision | 5.34% |
| buildings-economy | 1.42% |
| terrain-queries | 1.07% |
| projectiles-combat | 1.07% |
| runtime | 0.18% |

| Function | % of samples | Samples |
| --- | --- | --- |
| steerAroundUnits | 27.94% | 157 |
| moveAlongPath | 14.41% | 81 |
| acquireAutoTarget | 12.1% | 68 |
| hasLineOfSight | 8.19% | 46 |
| separateUnits | 6.76% | 38 |
| updateUnits | 3.91% | 22 |
| canOccupy | 3.91% | 22 |
| updateAutoEngagement | 3.02% | 17 |
| stampVision | 2.31% | 13 |
| refreshVision | 1.96% | 11 |
| unitDef | 1.6% | 9 |
| tick | 1.42% | 8 |

### combat-batch-20-stress

Samples: 397 across 8 repetitions.

| Category | % of samples |
| --- | --- |
| units | 74.81% |
| line-of-sight | 8.56% |
| other | 8.06% |
| vision | 5.29% |
| projectiles-combat | 1.26% |
| buildings-economy | 1.01% |
| cleanup | 0.5% |
| terrain-queries | 0.5% |

| Function | % of samples | Samples |
| --- | --- | --- |
| steerAroundUnits | 30.98% | 123 |
| moveAlongPath | 11.59% | 46 |
| acquireAutoTarget | 9.32% | 37 |
| hasLineOfSight | 8.56% | 34 |
| separateUnits | 6.05% | 24 |
| updateUnits | 5.79% | 23 |
| updateAutoEngagement | 5.29% | 21 |
| refreshVision | 3.53% | 14 |
| unitDef | 2.02% | 8 |
| canOccupy | 2.02% | 8 |
| tick | 2.02% | 8 |
| stampVision | 1.26% | 5 |

## Refactor equivalence

All 14 baseline/stress batch records match the Phase 2A.6 deployed checksums exactly.

Raw profiles: `cpu-profiles/*.cpuprofile` for the first-tick stress/no-command, steady and combat batches.

## Verification

- Focused tests: 4/4 passed (`tests/phase2a7-first-tick-profiling.test.ts`).
- Full suite: 90 files / 904 tests passed (`full-test-suite.log`).
- Typecheck and production build passed (`build.log`).
- Production bundle contains no calibration/profiling identifiers.
- Local profiling only; no deployment, no capacity change, production flag false.

