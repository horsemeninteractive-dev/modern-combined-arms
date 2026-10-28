# Phase 14 — Construction Priority and Economic Opportunity Audit

**Verdict: no construction-priority defect. The Phase 13 flip was a fallback
ordering, not a preference inversion — the AI wanted a second machine-gun nest
because it had scouted two rifle squads against one nest, and the refinery was
third on the list, not first. No production change was made.**

Phase 13 removed hidden-enemy influence from the build-site score, and one
measured outcome changed: a defensive emplacement was built where a refinery had
been, and the match collapsed economically. That looked like the economy losing
to the perimeter. It is not what the rules do. This phase reconstructs the
decision, traces the priority path, and tests the rules under controlled
conditions.

## 1. The reported decision, reconstructed

Configuration exactly as in Phase 13: `hungary (west) vs uk (east)`, seed 3690,
personalities unrotated, `repairSuppression` on, 600 s cap, arena ore 600/tile.
The build-site gate is the shipped one; the pre-Phase-13 arm is produced by
forcing the crowd score to count every entity.

```bash
# temporary instrumentation, removed before the tree was finalised
npx tsx tmp/p14-decisions.ts   # per-decision option list, bank and resulting site
```

**First divergence between the arms is not in Hungary's decision.** Hashing the
world every tick puts it at tick 2351, and the differing entity is the *UK*
commander's machine-gun nest: `55:1:mgNest` at tile `(160,164)` in the gated arm
versus `(148,140)` in the pre-fix arm. The Phase 13 change moved the opponent's
base layout too, because both commanders were counting hidden occupancy.

Hungary's decision at tick 2530 — the sixth structure it ordered — in both arms:

| | Shipped gate | Pre-Phase-13 |
| --- | --- | --- |
| Bank / req | 668 / 139 | 668 / 139 |
| Complete buildings | `atTurret 1, barracks 1, factory 1, mgNest 1, refinery 1, relay 1` | identical |
| Scouted mix | **armour 1, infantry 2** | **armour 1, infantry 1** |
| Known threats | 3 | 3 |
| Perimeter needed | `mgNest` (2 nests vs 1 standing) | none (1/1 answered) |
| Options and scores | `bunker 194.65`, `airfield 145.11`, `refinery 88.16` | `airfield 142.91`, `refinery 90.35` |
| Ordered | `bunker@27,38` — "anti-infantry perimeter" | `refinery@14,28` |

(Phase 13 recorded this as the fifth site: its site log could be overwritten by the
opponent's decision in the same tick. The decision log used here is written inside
the ordering path and records all six orders.)

The two arms differ in exactly one input: **one scouted rifle squad**, which
existed in one world and not the other. `defenceTargets` asks for a second
machine-gun nest only when `mix.infantry > mix.armour`, so with `1 vs 1` the
perimeter is answered and no emplacement is offered at all; with `2 vs 1` it is,
and it outscores the refinery by 106 points. The refinery was not outranked — in
the pre-fix arm it had no competitor.

Both arms agree about the bank, the building counts, the threat count and the
refinery's own score (88.16 vs 90.35, ordinary jitter). Nothing about the choice
depends on hidden information; the difference is one sighting.

## 2. Where the priority is actually decided

Two stages, and Phase 13 touched neither:

1. **Building type** — `AIController.buildOptions` scores every structure the
   roster can field and sorts by score. Prerequisites (`!factory`, `!refinery`,
   `!barracks`) are marked `essential`, and `manageConstruction` will hold the
   bank for an essential option rather than spend it on a cheap optional one.
2. **Build site** — `findBuildSite` ranks tiles *for the chosen type*, with the
   Phase 13 knowledge gate. Its score never influences which type is chosen.

The options that matter here, with their rules:

| Option | Condition | Score |
| --- | --- | --- |
| Refinery | `!refinery` (essential) or `refinery < 3 && harvesters/refinery >= 1.75 && bank > 550` | `58 + economy * 30 + jitter` |
| Perimeter | `nextDefenceBuild(mix, counts)` returns a kind, and the core is ready or something was seen/hit | `78 + 38 (scouted) + 55 (threat) + 35 (damaged) + defence * 28 + jitter` |
| Radar | no radar, `bank > 1400`, `economy > 0.55` | `34 + economy * 22 + jitter` |
| Power | brownout (essential) or `powerGap < 24` | `260` or `96 + economy * 24 + jitter` |

`nextDefenceBuild` targets two of the dominant scouted arm and one of the other
(`mix.armour > mix.infantry → two turrets`, and the mirror for nests). That is a
rule about an *unanswered* force, not a standing appetite for emplacements.

The harvester loop closes the economy side: a veteran commander crews
`min(3, refineries + 1)` haulers, so one refinery is worked by two haulers
(saturation 2.0 → a second drop-off is requested) and two refineries by three
(1.5 → it is not). With a single hauler the AI buys the hauler first and the
refinery returns once the drop-off is actually saturated — there is no deadlock
in which a one-refinery base can never grow.

## 3. Controlled conditions

Seven fixtures in `tests/construction-priority.test.ts`. Every world is frozen to
the same complete core — command post, factory, barracks, one turret, one nest,
one airfield, two generators, one refinery, an engineer and two haulers — so the
only remaining wants are a second refinery, a second emplacement or a radar.

| Condition | Options offered (score) | Ordered |
| --- | --- | --- |
| 1 refinery, 2 haulers (2.0 per) | `refinery 83.9`, `radar 54.2` | **refinery** |
| 2 refineries, 3 haulers (1.5 per) | `radar 53.8` | radar — a third drop-off would stand idle |
| 2 refineries, 4 haulers (2.0 per) | `refinery 83.9`, `radar 54.2` | **refinery** (third) |
| 1 refinery, 1 hauler (1.0 per) | `radar 53.8` | radar — buys the hauler instead |
| 2 rifle squads scouted, 1 nest | `bunker 188.5`, `refinery 83.9`, `radar 55.1` | **bunker** |
| 2 rifle squads scouted, 2 nests | `refinery 83.9`, `radar 54.2` | **refinery** |
| 2 tanks scouted, 1 turret | `atTurret 188.5`, `refinery 83.9`, `radar 55.1` | **atTurret** |
| 1 tank + 1 rifle scouted (tie) | `refinery 83.9`, `radar 54.2` | **refinery** |
| Quiet, 600 mats | `refinery 83.9` | **refinery** |

The pattern is consistent: the perimeter answers an *unbalanced* scouting report
and stops the moment the imbalance is covered; the economy is otherwise the
highest-scoring option; cost, power and prerequisites behave as documented.

The motivating case is rows five and six: the emplacement is chosen when the
scouted force calls for a second nest, and the refinery is chosen as soon as the
force is answered — with identical banks and identical buildings. That is the
whole difference between the two Phase 13 arms, expressed as a rule.

Two further fixtures cover the rest of the phase brief:

- **Information independence** — the same world plus four enemy tanks hidden in
  forest produces the identical decision and the identical site, and the tanks are
  still `isVisibleTo` false when the order is given.
- **Determinism** — the same fixture twice gives the same decision, and two
  independently constructed worlds finish with the same `stateHash()`.

## 4. Classification

| Question | Answer |
| --- | --- |
| Was the bunker a priority defect? | **No — legitimate trade-off.** It answers a scouted force that outnumbers the armament the commander holds, which is the rule's stated purpose, and it does so only while the force is unanswered. |
| Was the refinery suppressed? | **No.** It was offered in both arms, at 88–90 points. In the gated arm it simply had a competitor. |
| Is the outcome a decision defect? | **No — scenario-specific outcome.** The Phase 13 gate changed the opponent's layout at tick 2351, the scouted mix at 2530 differed by one rifle squad, and the match diverged from there. |
| Does the AI rely on knowledge it does not have? | **No.** The only inputs that differed are `visibleEnemies`/`contactsFor` (the scouted mix), bank, building counts and threat count. |

**No production change.** The phase found no defect that would justify one, and
the brief forbids tuning priorities to make the reported match come out better.

## 5. What the changed match actually cost

For the record, and explicitly not as evidence of a defect — the two arms of the
reconstructed game, at 600 s:

| | Shipped gate | Pre-Phase-13 |
| --- | --- | --- |
| Materials gathered (west) | 4 800 | 5 100 |
| Units built (west / east) | 20 / 21 | 21 / 26 |
| Kills (west / east) | 31 / 29 | 38 / 19 |
| Refineries standing at the end (west) | 0 | 2 |
| Outcome | `army-collapse` timeout | `siege-out-repaired` timeout |

The extra drop-off was worth about 6% of gathered materials. The larger factor in
the divergence is that the shipped-gate commander *lost its only refinery* and had
no bank to rebuild it, while the pre-fix commander had two. That is a downstream
consequence of the world change, not of the priority rules, and it is recorded
here as an observation rather than a proven cause.

## 6. Verification

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean |
| New fixtures | `npx vitest run tests/construction-priority.test.ts` | 7 / 7 pass |
| Phase 12/13 fog fixtures | `npx vitest run tests/fog-integrity.test.ts` | 13 / 13 pass |
| Full suite | `npx vitest run` | **43 files, 467 tests pass** |
| Difficulty contract | inside `tests/ai-matchups.test.ts` | Recruit–Veteran **−49 344** (4–12), Elite–Recruit **85 540** (15–1), Elite–Veteran **34 177** (11–5) — unchanged |
| Production build | `npm run build` | clean |
| Determinism / save | `tests/determinism-save.test.ts` + the new determinism fixture | pass; no serialisation change |
| National rosters, legacy presets | `tests/national-specialisations.test.ts`, `tests/nation-setup.test.ts` | pass (6 nations) |

Because production behaviour did not change, the Phase 13 540-match matrix and its
footprint-refusal count (391) remain the current baseline; re-running them would
reproduce the same numbers and is not evidence of anything new. The Phase 11
assault correction is untouched: `canOrderMove`, `groupApproach`, `aimIsOpen`,
`knownBlockage` and `knownForCrowding` are all byte-identical to the Phase 13
tree.

## 7. Explicitly unchanged

Unit, building and weapon statistics; costs, build and production times; income
and power values; the crowd coefficient and every build-site score term; site
selection; `knownForCrowding` and the whole Phase 12/13 information boundary;
difficulty profiles, weights and openings; `defenceTargets`/`nextDefenceBuild`;
national and legacy rosters; repair suppression; victory conditions; the
diagnostic arena's ore default; save format and persistence.

## 8. Remaining risks and next step

- **Hypothesis, not finding:** losing *every* refinery appears close to
  unrecoverable — with no drop-off there is no income, so the essential refinery
  rebuilding option can never be afforded. This is a plausible contributor to the
  gated arm's collapse and would be worth its own narrow audit with a dedicated
  fixture (one refinery, one harvester, refinery destroyed, bank below the rebuild
  cost).
- **Design question, not defect:** a second emplacement outranks a second
  refinery by roughly 105 points whenever the scouted force is unbalanced. That is
  the intended trade-off, but it is a *reasoned* balance choice rather than a
  measured one; if the project ever wants evidence about defensive-versus-economic
  spending, the smallest experiment is a paired build-order change with the
  information boundary held fixed, not a change to this rule.
- The reconstruction depends on the arena's 600 ore/tile and 600 s cap, where the
  economy is short. Shipped maps carry 260–340 per tile, so the economics of a
  second drop-off differ there; nothing in this phase should be read as a claim
  about long matches on a shipped map.
