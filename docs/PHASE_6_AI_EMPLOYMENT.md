# Phase 6 — National Roster Employment, Pathfinder Scouting and Matchup Integrity

Status: implemented and measured on the current working tree (uncommitted Phase 1–6
work on `master`). This phase changes **AI decision-making only**: no national
unit or building statistics, costs, roster substitutions, save fields or engine
rules were changed. The shared baseline remains the common foundation for all six
nations.

## 1. Baseline

| Item | Value |
| --- | --- |
| Working tree | `master`, Phase 5 report present, Phase 1–6 changes uncommitted |
| Baseline run | `tmp/phase6-baseline-3seed.jsonl` (Phase 5 AI, current harness) |
| Seeds | 101, 1078, 2055 |
| Arena | mirrored 64×64, ore 600/tile, 3000 mats / 180 req, veteran, east seed +977 |
| Matches | 192 (15 national pairs + legacy control, 2 seats × 2 personality rotations × 3 seeds) |
| Timeouts | 38 / 192 (20 %) |
| Artillery | 52 of 384 sides (14 %); UK MLRS 2/60, Russian heavy howitzer 2/60 (3 %) |
| Airfields | 27 / 384 sides (7 %); Belarus Deep Recon UAV 4/60 sides |
| Lithuania Pathfinder | 340 built, 5.7 per side, 0 kills |
| Hungary bunker | 49/60 sides, 18/60 timeouts |
| Tests at Phase 5 | 38 files / 412 tests (Phase 5 report) |

The harness was not changed during this phase. It already recorded completed
spawns (`produced`), first completion, damage taken, kills, alive seconds,
airborne seconds, near-friendly seconds and fresh contacts sighted by the
variant. A like-for-like re-run of the Phase 5 AI on seeds 101 and 1078
(`tmp/phase6-baseline-telemetry.jsonl`) was used wherever the 3-seed file lacks a
field.

## 2. Implementation by stage

### Stage 1 — Artillery without starving the army

The existing `spg` demand only arose after an enemy fortified structure or
weapon platform had been scouted, and its price was never saved for, so a
620-material gun was almost never completed.

- The family demand is now planned as well as reactive: with a factory, six core
  units (tank + ATGM + rifle), two harvesters and no threat at the base, the
  battery is requested at priority 112. A scouted strongpoint still makes it
  urgent (priority 128).
- The bank is held for the battery only while the army's own line demands are
  already met (core deficit ≤ 2) and the bank is at least 85 % of the price. A
  commander missing armour buys armour first.
- At most one battery is alive or queued; the demand resolves through
  `Game.unitIdFor(aiId, 'spg')`, so the UK receives `mlrs`, Russia
  `heavyHowitzer` and the legacy presets `spg` without a nation branch.

### Stage 2 — UAV employment

- The reconnaissance drone is requested at priority 106 (78 when unplanned) once
  an airfield exists, the planned army is at least six, the base is quiet and two
  harvesters are crewed. It keeps the existing single-drone cap and its price
  hold is subject to the same core-deficit guard as artillery.
- Nothing else changed: the airfield, fuel/endurance, home radius and
  visibility rules are untouched, and the roster family supplies `deepReconUAV`
  for Belarus and `uav` for the baseline.
- **The binding constraint is the airfield, not the demand.** An airfield costs
  1250 materials; across the measured matrix no side ever ended a match with
  more than 780, and only the high-tech/air personalities ever built one (27 of
  640 sides in the final run). Two bounded attempts to bank for the strip (a
  shortfall reserve and a "surplus only" score bonus) produced no airfields in a
  2-seed run and the first one delayed unrelated construction, so both were
  removed. Making 1250 affordable needs an economy decision, not a demand tweak,
  and is left for a later phase.

### Stage 3 — Pathfinder employment

- An unarmed recon unit is now bought as a single protected eye (`reconTarget`
  1) instead of a triad of free kills.
- Its patrol point is clamped to nine tiles from the nearest friendly ground
  combat unit, and it withdraws nine tiles directly away from an armed enemy
  within twelve tiles unless a friendly combat unit is within six.
- The withdrawal is evaluated on every think, including while a patrol order is
  still running, so a sighting does not wait out the route. The unit's
  statistics, vision and lack of weapons are unchanged; only its exposure is.

### Stage 4 — Seat asymmetry

`tools/seat-symmetry.ts` (kept outside the unit suite) isolates the engine from
roster and AI:

- **1v1 identical duel, four configurations.** The unit created first (lower
  entity id) wins every time with full health (96 HP remaining), on either seat
  and at either distance. Sequential entity updates apply damage immediately, so
  the lower id fires first every tick and the target dies before replying.
  Confirmed, reproducible.
- **Scripted mirrored advance.** Two identical three-unit formations ordered to
  mirrored points on the same tick diverge at tick 30 (1.50 s), worst mirror
  error 0.44 px, at the first movement tick. The final survivor count is not
  mirrored. Pathing tie-breaking and share RNG consumption are the plausible
  sources; the mechanism is inferred, not proven.
- **Matrix share.** The east seat won 64 % of decided matches in both the Phase 5
  matrix and this phase's 5-seed matrix, but the same AI on seeds 101 and 1078
  produced 54 % before and 44 % after the AI changes. The arena's seat share is
  therefore not a stable engine constant and cannot be attributed to the duel
  effect (which favours the first-created, i.e. western, seat in the harness).
  No engine fix was attempted: the duel effect needs simultaneous damage
  resolution, which is a broad combat change, not a narrow defect fix.

## 3. Files and decision paths

| File | Change |
| --- | --- |
| `src/sim/ai.ts` | Planned artillery demand; core-deficit guard on the support-arm bank hold; single unarmed scout target; nine-tile screen lead and `withdrawScout`; UAV planned demand/priority. |
| `tests/ai-employment.test.ts` | New: planned battery without a strongpoint, army-short guard (no hold while the line is short), one-battery cap, national artillery resolution, drone flight/cap, Pathfinder screen and contact break. |
| `tools/seat-symmetry.ts` | Diagnostic harness (duels + scripted mirrored advance); not part of the test suite. |
| `README.md` | Test count/command note and Phase 6 link. |

No save, serialization, roster, unit or building definition changed. The AI's
hold is released by existing per-tick facts (threats, deficits), so no new
persistent state was needed and saves are untouched.

## 4. Before/after employment (measured)

Baseline is the Phase 5 AI, 3 seeds, 192 matches. Final is this AI, 5 seeds
(101, 1078, 2055, 3032, 4009), 320 matches. Phase 5's own 5-seed run is shown
for a size-matched timeout comparison.

| Metric | Phase 5 (3 seeds) | Phase 5 (5 seeds) | Phase 6 (5 seeds) |
| --- | --- | --- | --- |
| Matches | 192 | 320 | 320 |
| Timeouts | 38 (20 %) | 74 (23 %) | 116 (36 %) |
| Median duration | 315 s | — | 368 s |
| Sides with any artillery | 52/384 (14 %) | — | 238/640 (37 %) |
| UK MLRS completed | 2/60 sides | — | 20/100 sides (21 built) |
| Russian heavy howitzer completed | 2/60 sides | — | 18/100 sides (18 built) |
| Airfields | 27/384 (7 %) | — | 27/640 (4 %) |
| Belarus Deep Recon UAV | 4/60 sides | — | 5/100 sides |
| Hungary timeouts | 18/60 (30 %) | — | 30/100 (30 %) |
| East share of decided | 69 % | 64 % | 64 % |

Per-nation final records (100 sides each, 20 legacy control sides):

| Nation | W–L–T | Variant completed | Variant alive | Notable |
| --- | --- | --- | --- | --- |
| Lithuania | 15–39–46 | 303 Pathfinders | 174 s/side | 96 s/side near friendlies, 20.0 contacts/side |
| Poland | 38–25–37 | 87 Spearheads | 74 s/side | 264 kills |
| United Kingdom | 34–34–32 | 21 MLRS | 17 s/side | 38 kills |
| Russia | 35–35–30 | 18 heavy howitzers | 15 s/side | 67 kills |
| Belarus | 29–34–37 | 5 Deep Recon UAVs | 3 s/side airborne | too few to assess |
| Hungary | 43–27–30 | 140 bunkers | 243 s/side | 109 kills |

Artillery employment by duration: UK 21 % of matches lasting at least 300 s,
Russia 18 %. The experimental one-in-three target was **not met** (one in five).
The production path was diagnosed rather than pushed: in a near-zero-bank
economy a 620-material gun competes with 720-material tanks, and the measured
cost of more artillery is a higher timeout rate (see §9). Employment is still
roughly twenty times the Phase 5 rate and enough to measure (38 completed
national variants).

## 5. Pathfinder evidence

Like-for-like, seeds 101 and 1078, 128 matches each (Phase 5 AI with the current
telemetry vs this AI):

| Metric | Before | After |
| --- | --- | --- |
| Pathfinders built per Lithuanian side | 4.50 | 3.20 |
| Alive seconds per side | 65 | 156 |
| Seconds per side within 14 tiles of friendly arms | 43 | 89 |
| Fresh contacts sighted per side | 20.3 | 20.4 |
| Damage taken per side | 437 | 314 |

Fewer replacements, more than twice the time alive, more time under friendly
cover, and unchanged reconnaissance output: the unit is not hiding so well that
it stops finding the enemy, and it receives no artificial protection. The
baseline armed Recon Vehicle keeps its combat role and its statistics are
untouched.

## 6. UAV evidence and its limit

The demand path is covered by tests: with an operational airfield the AI requests
exactly one drone, flies it, resolves the national variant through the roster and
keeps the baseline `uav` for legacy presets. In the matrix, however, only 5 of
100 Belarusian sides ever had an airfield, and those drones accumulated 3 s of
airborne time per side with no measurable contact contribution. This is
**inconclusive**, not evidence that 30-tile optics are worthless: the facility
gate, not the demand, prevented observation.

## 7. Reproducibility

```
npx tsc --noEmit
npx vitest run
npm run build
npx tsx tools/nation-matchups.ts 5 600            # final matrix, seeds 101..4009
MCA_SEEDS=101,1078 npx tsx tools/nation-matchups.ts 2 600   # like-for-like pairs
npx tsx tools/seat-symmetry.ts                   # duel + mirrored advance
```

The harness writes one JSON line per match (nation, pairing, seat, seed,
personality rotation, winner, duration, per-side production, variant telemetry).
All runs are deterministic: identical seed/nation/seat inputs produce identical
matches. Timeouts are recorded separately from wins, losses and draws and are
never counted as wins.

## 8. Tests and build

- `npx tsc --noEmit`: clean.
- `npx vitest run`: 41 files / 439 tests passing (Phase 5 reference 38/412).
- `npm run build`: TypeScript, Vite and service-worker precache succeed.
- Determinism, state-hash, batch-size, save/load and legacy scenario tests remain
  green; no test was weakened or removed.

## 9. Risks and unresolved findings

1. **Timeouts rose from 20–23 % to 36 %.** Matches where either side completed
   artillery time out at 42 %, matches without artillery at 25 %. Inferred:
   artillery suppresses pushes and harvesters, so a 600-second cap is reached
   before an HQ falls. This is the main cost of making artillery observable and
   is *not* a reason to hide the guns again; it is evidence for a later
   counter-battery or economy-durability pass.
2. **Artillery employment is one in five UK/Russian sides, below the one-in-three
   diagnostic target.** Raising it further would worsen risk 1. Reported as a
   measured shortfall, not silently tuned.
3. **UAV employment is unmeasurable in this arena** (5 sides, 3 s airborne per
   side) because 1250-material airfields are not reached. Inconclusive.
4. **Belarus 29–34–37 and Lithuania 15–39–46** remain the weakest records. With
   one battery and a fragile scout, these are consistent with the Phase 5
   concerns and are left to a balance/AI phase.
5. **Seat asymmetry:** first-created unit wins an identical duel outright
   (confirmed); the mirrored advance diverges at the first movement tick
   (confirmed); the mechanism behind path divergence is inferred. The arena's
   east share moved from 54 % to 44 % on the same two seeds under AI changes, so
   it is not a stable constant and the 64 % 5-seed figure should not be read as
   a property of the engine.
6. **Hungary's stall pattern is unchanged** (30 % timeouts before and after,
   bunkers at 243 s alive per side). No bunker statistic was changed.

## 10. Ranked recommendation for the next phase

1. **Indirect-fire interaction and match resolution** (highest value): investigate
   why artillery matches stall — counter-battery is out of scope, but target
   selection, harvester survival and the AI's willingness to assault under
   shellfire are not. This addresses the only measured regression.
2. **Air facility economics** so the long-range reconnaissance identity can be
   observed at all; the demand path is already in place and tested.
3. **Seat-symmetry correctness:** simultaneous damage resolution in identical
   duels, with the existing diagnostic as the regression harness.
4. Only then national balance tuning, using a larger independent seed set and the
   telemetry added in this phase.
