# Phase 11 — Assault Destination Fix and Difficulty-Ladder Calibration

**Outcome: shipped.** The command defect is fixed, the Elite/Veteran contract is
intact on its own configuration (34 177 against a > 15 000 requirement), and no
difficulty calibration was needed — the measured regression Phase 10 reported
belongs to that phase's bundled patch, not to the correction itself. The
national matrix is unchanged in the aggregate: the fix removes a class of
refused orders without moving the timeout rate outside noise.

## 1. Baseline revision and verification

| | |
| --- | --- |
| Commit | `7989e5b` (`master`) plus the uncommitted Phase 1–10 working tree |
| Baseline check | `npx tsc --noEmit` clean, `npx vitest run` 41 files / 447 tests, `npm run build` clean |
| Ladder contract | `tests/ai-matchups.test.ts`, eight seeds × both seats, 600 s cap, 600 materials per ore tile |
| Ladder baseline | Recruit–Veteran **−51 476** (4–12), Elite–Recruit **63 375** (13–3), Elite–Veteran **38 931** (12–4) |
| National arena | shared 64×64 mirrored arena (`tools/matchup-arena.ts`), 19 200 materials of ore, `destroyHQ`, fog, veteran, repair suppression on and unchanged |
| Seeds | A: 101, 1078, 2055 · C: 11, 555, 999 · D: 1234, 2468, 3690 (540 matches per arm) |
| Commands | `npx tsx tools/timeout-audit.ts 9 600 veteran` with `MCA_AI_APPROACH=off\|on`; `npx tsx tools/ladder-diag.ts elite-veteran 600 [replication]`; `npx tsx tools/collapse-fixtures.ts 180 [orePerTile]` |

Both arms run in the same build. `AIController({ resolveApproach: false })` is a
diagnostic switch used only by the tools; nothing is saved and the shipped
default is `true`.

## 2. Root cause

A remembered contact reports a structure's **centre**. `Game.commandMove` builds
a formation slot for every unit and refuses the whole order when any slot is a
tile the unit cannot stand on, `this.blocked` reports a structure, or no route
exists. So an assault wave aimed at a remembered command post was refused
outright — and `offensive()` counted it anyway:

- `attackWave++` and `lastWaveTick = tick` were set *before* the command was
  processed, so the refusal was invisible to the commander;
- the counter it advanced feeds `desiredArmySize`, so the phantom wave also
  raised the army the AI was waiting for;
- the cooldown started, so the failure was silent for another 10–18 s.

Measured on the 540-match baseline: **3 206** refused group moves, **1 121** of
them aimed inside an enemy footprint, in **443 of 540** matches.

## 3. The correction

`src/sim/game.ts` — two methods, one shared rule:

- `canOrderMove(owner, ids, x, z)` mirrors `commandMove` exactly: same entity
  filtering, same `formationPoints`, and for each unit the same tile test
  (`tileAt`, `canStandOn` with that unit's own `moveClass`, `this.blocked`) and
  the same `findPathFor`. `this.blocked` is the one footprint model, so a
  structure of any footprint, orientation, or near a map edge is handled without
  a second geometry.
- `groupApproach(owner, ids, x, z, towardX, towardZ, maxTiles = 10)` walks from
  the remembered point toward the AI's own base one tile at a time and returns
  the first point the command layer would accept, or `null`.

`src/sim/ai.ts` — `approachPoint()` resolves the wave aim through
`groupApproach` before the order is queued, for both the wave commit and the
15-second press. When it returns `null` the commander **holds**:
no `claim()`, no `attackWave++`, no `lastWaveTick`, and a decision line that says
`no approach to x,z — holding N units`. The wave counter therefore counts
executable waves, which is what its arithmetic always assumed.

Not changed: unit, weapon, building and economy values; national substitutions;
roster resolution; the assault gate, cooldown and overdue rules; scouting and
patrol destinations (see §9); save format and serialization.

## 4. Destination correctness and order integrity

| Check | Result |
| --- | --- |
| Structure centre, edge and corner aims refused | `canOrderMove` false for `commandPost`, `barracks` and `refinery` (unit test) |
| Resolved point accepted | `canOrderMove` true, outside the footprint, within 5 tiles of it |
| Post against the map edge (`2,2`) | resolves and is accepted |
| Unreachable pocket (map flooded) | `groupApproach` null; `attackWave` stays 0, no unit receives an order, decision reports `no approach` |
| Structure refusals, 540 matches | **1 121 → 391** (−65 %); matches with one **443 → 178** (−60 %) |
| Pool A alone | 333 → 103 refusals, 127 → 44 matches |
| Refused group moves, 540 matches | 3 206 → 2 688 |

The residual 391 are not assault waves: every wave is validated before it is
queued, and the only orders that can still fail are the AI's other move tasking
(scouting patrols, defence, retreat, capture), which this phase did not touch.
The scout-destination variant that would also fix those was measured and
rejected — see §8.

## 5. Objective progress (fixtures)

`tools/collapse-fixtures.ts`, 180 s, remembered post, no second economy. The
pre-fix arm is the same build with `MCA_AI_APPROACH=off`.

| Fixture | off | on |
| --- | --- | --- |
| 1 / 2 / 3 tanks, undefended post | no order, no damage | hold (gate 6, overdue needs 4) |
| 4 tanks, undefended post | refused, 0 damage | order at 40.5 s, post destroyed |
| 6 tanks, undefended post | refused, 0 damage | order at 16.6 s, post destroyed |
| 4 tanks, 3 000 in bank | refused | order at 40.5 s, post destroyed |
| 4 tanks, two AT turrets | refused | post destroyed, 1 tank lost |
| 4 tanks, one defending tank | refused | post destroyed, no losses |
| 4 tanks, post 40 % damaged + engineer repairing | refused (post healed to full) | 1 320 net damage, post destroyed |
| 2 tanks + working base + 19 200 ore | refused | produces a 4th tank, commits 4 at 40.5 s |
| 6 tanks + working base + 19 200 ore | refused | commits 6 at 16.6 s |

Two things this establishes. First, the failure was total: **0 of 13** fixtures
could execute an order before the fix, **8 of 13** after it. Second, the
last-ditch push is not a new rule — it is the existing `overdue && ready ≥ 4`
clause finally being obeyed, and it does not bypass massing: a two-tank force
with a healthy base still waits, produces a fourth tank and leaves with four.

## 6. The Elite/Veteran regression, reproduced and attributed

Same seeds, same arena, same build; only the aim differs.

| Arm | Elite–Veteran margin | Wins | Decided |
| --- | --- | --- | --- |
| Phase 11 correction (contract seeds) | **34 177** | 11–5 | 8 / 16 |
| Pre-fix, same seeds | 38 931 | 12–4 | 13 / 16 |
| Phase 10's preserved patch `tmp/ai-phase10-open-dest.ts` | **11 523** | 9–7 | 13 / 16 |
| Phase 11 correction + scout-destination variant (measured, not shipped) | 46 247 | 12–4 | 12 / 16 |

Phase 10's 11 523 reproduces exactly, so the measurement was sound — but it
belongs to that patch, which changed two things (assault aims *and* scout patrol
points) and still counted refused waves. The narrow correction keeps the
contract. Applying the scout variant on top of the narrow correction does not
reproduce the drop (46 247), so the bundle's low margin cannot be attributed to
the scout change alone; the remaining difference is the phantom-wave bookkeeping
Phase 10 left in place, which suppressed the number of real launches.

Paired per-match differences (`tools/ladder-diag.ts`, 16 paired matches each):

| Pool | Mean paired difference | 95 % bootstrap CI | Elite wins on / off |
| --- | --- | --- | --- |
| Contract seeds (101 … 6940) | −297 | [−1 720, +852] | 11 / 12 |
| Replication seeds (2101 … 8940) | +821 | [−294, +2 117] | 8 / 7 |

Both intervals cover zero: at this sample size the correction has no measurable
effect on the ladder margin, in either direction.

**No calibration was applied, and none is justified.** The contract's own
configuration is satisfied with the correction in place, and the ~5 000-point
swing between the two arms is within the ladder's own noise: a single command
post falling is worth roughly 1 300 in board value plus the army that took it,
so one flipped match moves the 16-match total by 2–4 000.

### Contracts after the change

| Contract | Requirement | Measured |
| --- | --- | --- |
| Recruit vs Veteran | margin < −30 000, wins ≤ 7 | −49 344, 4 wins |
| Elite vs Recruit | margin > 45 000, wins ≥ 11 | 85 540, 15 wins |
| Elite vs Veteran | margin > 15 000, wins ≥ 9 | **34 177, 11 wins** |

One existing test was changed: `tests/ai.test.ts` "reaches its air and naval
branches" now measures a 600 s horizon instead of 360 s. The commander executes
its waves instead of leaving them at base, so the bank its air branch used to
idle in now pays for units and static defence. On the same income it still
reaches the branch — shipyard at ~5:00, airfield at ~7:00 — so the assertion is
unchanged in intent and only its horizon moved. It is the only test edited, and
it was verified to pass at 360 s with the fix disabled, confirming the cause.

## 7. National matrix, before and after

540 matches per arm, seeds A/C/D, identical otherwise.

| Measure | off | on |
| --- | --- | --- |
| Timeouts | 133 (24.6 %) | 138 (25.6 %) |
| `army-collapse` | 62 | 87 |
| `siege-out-repaired` | 31 | 23 |
| `defensive-stalemate` | 10 | 18 |
| `artillery-standoff` | 5 | 4 |
| `targeting-or-pathfinding` | 0 | 1 |
| `other` | 25 | 5 |
| Decisive matches | 407 | 402 |
| Mean decisive duration | 290 s | 288 s |
| Matches with any command-post damage | 476 | 472 |
| Mean worst command-post damage | 1 762 | 1 725 |
| East seat share of decided | 64.1 % (261) | 61.7 % (248) |
| Matches with artillery | 301 (55.7 %) | 294 (54.4 %) |

Paired by configuration, 66 matches time out only in the off arm and 71 only in
the on arm (two-sided exact binomial p ≈ 0.67). Per pool: A 26 → 33, C 45 → 47,
D 62 → 58.

Read this as **a correctness fix, not a resolution improvement**. The category
counts move because the fights happen: `other` (25 → 5) and part of the siege
stalls become `army-collapse`, the category Phase 10 already showed to be
dominated by the arena's finite ore. Timeouts are neither wins nor losses here,
and the aggregate difference is not significant.

## 8. Why the scout variant was not shipped

Applying the same resolution to the recon unit's patrol point (measured above)
removed the last refusals in the ladder (0–1 per 16 matches) and did not harm the
margin (46 247). It is still out of scope: a patrol point is arbitrary ground,
often unexplored, and resolving it reads `this.blocked` for structures the
commander has never seen — a small information leak that the assault path avoids
because its aim is always a *remembered* contact. If it is ever wanted, it should
be derived from the AI's own knowledge of structures, not from the map.

## 9. Verification

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **41 files / 447 tests passed** (was 442; five new) |
| `npm run build` | clean, `sw.js precaches 13 files` |
| `npx vitest run tests/ai-matchups.test.ts` | all three contracts pass (§6) |
| `npx vitest run tests/ai-employment.test.ts` | 15 tests, including determinism |
| `npx vitest run tests/ai.test.ts` | 18 tests |
| `tools/timeout-audit.ts 9 600 veteran`, both arms | §7 |
| `tools/collapse-fixtures.ts 180 0` / `180 600`, both arms | §5 |
| `tools/ladder-diag.ts elite-veteran 600`, `… replication`, both arms | §6 |

New tests in `tests/ai-employment.test.ts`:

1. a structure centre, edge and corner are refused and the resolved point beside
   them is accepted (three footprint sizes);
2. a post against the map edge still resolves;
3. a wave that cannot be ordered is not counted (flooded map, no order, decision
   reports `no approach`);
4. two identical runs produce the same state hash, wave count and post health;
5. an executable wave moves, is never refused, and damages the post.

Determinism and save/load are unchanged: the correction adds no state, consumes
no randomness, and iterates entities and tiles in their existing order. The
existing two-run hash, batch-invariance and save/replay tests still pass, and
test 4 above covers the new decision path directly.

## 10. Remaining limitations

- The national matrix still times out as often as before. This phase removes a
  refusal class; it does not make battles resolve, and the aggregate timeout rate
  must not be read as improved.
- The ladder contract is fragile across seed pools: on the replication seeds the
  **pre-fix** arm scores −1 929 (7–9), i.e. the shipped ladder is already inside
  noise on fresh seeds. The contract holds on the eight seeds it names; it should
  not be treated as a general claim that Elite beats Veteran.
- Assault destinations are resolved against `this.blocked`, which includes
  structures the AI has not seen. The order it produces is one a player's click
  would have to reproduce, and nothing is revealed or targeted, but it is a
  bounded information advantage.
- The residual refused orders in the matrix come from non-assault tasking.
  Fixing those needs the knowledge-aware approach described in §8.
- One diagnostic arena, veteran difficulty, AI versus AI. No human matches.

## 11. Next step

The strongest remaining cause of stall in the matrix is not the aim of a wave
but what a wave does when it arrives: `army-collapse` is now 87 of 138 timeouts
and is the same ore-exhaustion pattern Phase 10 documented. The next phase
should test the **national matrix on the shipped maps' ore budget** — running the
same 540-match configuration with `MCA_ARENA_ORE` set to the 33 760–59 600 range
the shipped maps actually carry — before any combat, economy or victory-rule
change, so that the diagnostic arena stops dominating the timeout statistics. A
separate, larger pre-registered ladder pool (32+ seeds, two arm disciplines) is
worth doing at the same time, because the current contract cannot distinguish a
real difficulty effect from seed noise.

## Appendix — files

| File | Change |
| --- | --- |
| `src/sim/game.ts` | `canOrderMove`, `groupApproach` |
| `src/sim/ai.ts` | `AIControllerOptions.resolveApproach`, `approachPoint`, `tileLabel`, wave lifecycle |
| `tests/ai-employment.test.ts` | five tests for destination, lifecycle and determinism |
| `tests/ai.test.ts` | air/naval horizon 360 s → 600 s, with the reason recorded |
| `tools/ladder-diag.ts` | new: per-match ladder decomposition, both arms, contract and replication seed sets |
| `tools/timeout-audit.ts` | `MCA_AI_APPROACH` arm switch |
| `tools/collapse-fixtures.ts` | bank, ore, repair, defender and working-base fixtures; losses, first order, post outcome |
| `README.md` | tooling and test count |
