# Phase 5 — National Matchup Verification and Counterplay Audit

Status: audit complete. No balance value, roster definition, AI decision weight or
save format was changed in this phase. The deliverable is evidence: a reproducible
national matchup harness, a full 15-pairing matrix, deterministic counterplay
tests, and a ranked list of the balance, AI and content work the evidence
supports.

The headline result is that **only three of the six national substitutions
actually reach the battlefield in AI play**, and one of those three
(`pathfinder`) is a net loss for the nation that fields it. The other three
(`mlrs`, `heavyHowitzer`, `deepReconUAV`) are correct, tested and available, but
the AI almost never buys them, so their nations are behaviourally identical to
each other in every match this audit could measure.

## 1. Method

### 1.1 Harness

`tools/nation-matchups.ts` (new) plays the real `AIController` against itself
through the public command API, with the built-in single-AI hook disabled
(`new Game(scenario, { enableAI: false })`), exactly like
`tests/ai-matchups.test.ts`. It is deliberately outside the unit suite because a
full matrix is minutes of simulation, not milliseconds.

```
MCA_SEEDS=11,555,999 npx --yes tsx tools/nation-matchups.ts [seedCount=3] [maxSeconds=600] [difficulty=veteran]
```

`MCA_SEEDS` was added in this phase so an independent seed set can be run without
editing the file. The default pool is `101, 1078, 2055, 3032, 4009`.

Fixed configuration for every run in this report:

| Setting | Value |
| --- | --- |
| Arena | `createEmptyScenario(64, 64)`, geometrically mirrored around the centre (not algorithmically symmetric — §1.4) |
| Map | 16 ore tiles per side at 600 ore each; mirrored command posts at (16,33) and (44,33) |
| Neutral relays | two, at (30,32) and (32,32), equally distant |
| Starting forces | 2 tanks, 5 riflemen, 1 engineer, 1 harvester per side, mirrored |
| Starting resources | 3000 mats, 180 req |
| Fog | on |
| Victory | `destroyHQ` |
| Time limit | none in scenario; the harness stops at `maxSeconds` and records a timeout |
| Difficulty | `veteran` |
| Max duration | 600 s (12 000 ticks) |

Each pairing is played in four combinations per seed: nation A west / nation B
east and the reverse, each with the two commander personalities swapped between
seats. Commander personality is derived from the AI seed
(`aiProfile(seed)`), so the harness gives west `seed` and east `seed + 977` in
the straight run and flips them in the rotated run. Every nation plays 50 % of
its games on each seat and with each personality, so seat effects are shared
equally across the matrix rather than falling on one nation. They are not
removed, though — see §1.4, which also explains why the conclusions below lean
on per-variant measurements rather than win rates.

Sample counts (national matches; controls are listed separately and never carry a
national variant):

- Primary matrix: **5 seeds × 2 seats × 2 personality rotations × 15 pairs = 300
  national matches**, plus 20 legacy control matches (`baltic` vs
  `expeditionary`) — 320 in the run log.
- Replication A (smaller, no personality rotation): 3 seeds × 2 seats × 15 pairs
  = 90 national matches, plus 6 controls — 96 total.
- Replication B (independent seed set `11, 555, 999`): 3 seeds × 2 seats × 2
  rotations × 15 pairs = 180 national matches, plus 12 controls — 192 total.

The two legacy presets are the control. Both resolve the shared baseline, so any
spread between them measures the harness rather than a national difference. Every
control game mirrors exactly (same winner seat in both orientations, same
duration, same score margin, mean margin 0), which confirms the runs are
deterministic. It does **not** show that the arena is neutral: with identical
rosters the two orientations are literally the same game, so the swap changes
nothing. See §1.4 for the seat effect the control cannot see.

### 1.2 What the harness records

Per side, per match: score (the material-weighted board value used by the
existing AI ladder: unit cost + 60 % of building cost + 140 per kill + 10 % of
banked mats + 8 % of gathered mats), kills, losses, gathered mats, bank, live
units and buildings, AI phase/wave/last decision, the highest simultaneous count
of each completed structure family, every unit definition produced, and a trace
for the nation's variant: queued at least once, completed count, first completion
time, maximum simultaneously alive, damage actually removed from live variant
entities, kills credited while alive, and survivors at the end.

Production is counted from **newly spawned entity ids and completed
structures**, not from the queue, so every "built" number in this report means
"reached the battlefield". Queue sightings only show that the AI requested the
variant.

### 1.3 Confidence vocabulary

Following the phase brief:

- **Observed** — recorded directly in a reproducible run in this repository.
- **Inferred** — the most likely explanation for an observation, not directly measured.
- **Untested** — plausible but not exercised by this audit.
- **Inconclusive** — the result is dominated by AI behaviour, map asymmetry, or
  too small a sample to attribute to the roster.

### 1.4 Seat asymmetry (a harness limitation that matters)

The arena is geometrically mirrored: command posts 4×4 at x = 16 and 44, starts at
x = 18 and 45, identical unit lists and mirrored ore columns, relays at x = 30 and
32. It is not *algorithmically* symmetric. Across the primary matrix the east seat
wins 153 of 230 decided matches (66 %); in the independent seed set it wins 74 of
116 (64 %). Since every nation plays half its games on each seat, this does not
bias the national comparison, but it does mean the world is not neutral and that
absolute win rates in this report should not be read as strength.

The legacy control cannot detect the bias (see above). A separate probe with
**identical AI seeds** on both sides does: at the 600 s cap east had 3–6 % more
gathered mats in both probe runs (5410 vs 5100 and 5400 vs 4800) and led on kills
in both (33–29 and 34–16, the second ending in an east victory). The sides
therefore differ despite identical commanders, which points at ordering asymmetry
inside the deterministic simulation (entity iteration, pathfinding tie-breaks or
shared RNG consumption) rather than at the map data. The mechanism was not
tracked down; it is outside this phase's scope and no balance value was changed
because of it.

Consequences, applied throughout this document:

- National win rates are comparable with each other but are not absolute measures
  of strength, and a 20-game pairing has wide uncertainty.
- Variant-level measurements (built, kills, damage absorbed, survival) do not
  depend on the seat and carry most of the weight below.
- Any future balance ladder should use an arena whose symmetry is verified rather
  than assumed.

All match results are deterministic: identical seed, nations, seats and
personality reproduce identical scores and durations. They are not a
statistically significant competitive ranking; 320 deterministic games from five
commander seed pairs is evidence about *this AI*, not about human play.

## 2. Source values verified from the tree

Read from `src/data/units.ts`, `src/data/buildings.ts` and `src/data/weapons.ts`,
not copied from `docs/PHASE_4_NATIONS.md`.

| Variant | Cost | HP | Speed | Vision | Build | Weapon (damage / range / cooldown / accuracy / armour multiplier) | Baseline it replaces |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pathfinder` (LT) | 200 | 120 | 4.2 | 16 | 8 s | none | `recon`: 260, 170 HP, 12.5 vision, 25 mm autocannon 9 / 5.5 / 0.35 / 0.74 |
| `spearhead` (PL) | 780 | 620 | 2.0 | 8 | 19 s | 130 mm: 72 / 8 / 2.8 / 0.86, heavy ×1.85 | `tank`: 720, 540 HP, 2.3 speed, 120 mm: 60 / 7.5 / 2.5 / 0.86, heavy ×1.85 |
| `mlrs` (UK) | 700 + 85 req | 210 | 2.1 | 10 | 16 s | rockets: 42 / 18 / 3.2 / 0.62, splash 2.6, structure ×1.15, indirect, **minRange 6** | `spg`: 620 + 60 req, 280 HP, 1.9 speed, 155 mm: 72 / 14 / 5.5 / 0.78, splash 2.0, minRange 4 |
| `heavyHowitzer` (RU) | 760 + 75 req | 330 | 1.6 | 9 | 20 s | 203 mm: 105 / 16 / 7.5 / 0.84, splash 2.4, structure ×1.45, indirect, minRange 5 | as above |
| `deepReconUAV` (BY) | 320 + 50 req | 70 | 6.6 | 30 | 12 s | none, fuel 90 s, home radius 8 | `uav`: 240 + 35 req, 85 HP, 7.2 speed, 22 vision, fuel 60 |
| `bunker` (HU) | 420 | 900 | — | 10 | 14 s | same `heavyMg` as the nest: 6 / 7 / 0.22 / 0.78, infantry ×1.9, structure ×0.04, heavy ×0.06, power −8 | `mgNest`: 260, 520 HP, 8 vision, 9 s, power −6, same `heavyMg` |

Family resolution uses `unitFamily` / `buildingFamily`, so the AI's `need('recon')`
and `need('spg')` demands map onto the national definitions automatically and no
nation is ever asked to buy a definition it does not own.

Two description defects were noticed while verifying values (recorded, not fixed,
because both are copy rather than behaviour):

- The bunker blurb and the Phase 4 matrix claim "a little more reach". The bunker
  uses the identical `heavyMg` (7-tile range); what it actually has is more
  **vision** (10 vs 8).
- The heavy howitzer blurb says one shell "does the work of two shared howitzer
  rounds". The ratio is 105 against 72 (1.46×), not 2×.

## 3. Matchup matrix

Primary matrix, 5 seeds, 20 games per pairing (10 per side). `W–L–TO` is from the
row nation's point of view; `margin` is its average material-weighted score
difference per game.

| Pairing | Games | W–L–TO (row nation) | Avg margin | Avg duration |
| --- | --- | --- | --- | --- |
| Lithuania vs Poland | 20 | 2–14–4 | −4804 | 331 s |
| Lithuania vs UK | 20 | 2–14–4 | −4156 | 345 s |
| Lithuania vs Russia | 20 | 2–13–5 | −4173 | 342 s |
| Lithuania vs Belarus | 20 | 3–13–4 | −3747 | 353 s |
| Lithuania vs Hungary | 20 | 0–13–7 | −5005 | 386 s |
| Poland vs UK | 20 | 9–6–5 | +1636 | 387 s |
| Poland vs Russia | 20 | 9–6–5 | +1636 | 387 s |
| Poland vs Belarus | 20 | 9–7–4 | +1222 | 366 s |
| Poland vs Hungary | 20 | 7–4–9 | +1447 | 429 s |
| UK vs Russia | 20 | 9–9–2 | −18 | 369 s |
| UK vs Belarus | 20 | 9–8–3 | +160 | 377 s |
| UK vs Hungary | 20 | 5–10–5 | −1340 | 372 s |
| Russia vs Belarus | 20 | 9–8–3 | +178 | 382 s |
| Russia vs Hungary | 20 | 5–10–5 | −1267 | 379 s |
| Belarus vs Hungary | 20 | 5–10–5 | −1266 | 373 s |

Nation aggregate, 100 games each:

| Nation | W–L–TO | Win rate (decided games) | Avg margin | Games the variant appeared in | Variant kills |
| --- | --- | --- | --- | --- | --- |
| Lithuania | 9–67–24 | 9 % (9/76) | −4377 | 100 / 100 | 0 |
| Poland | 48–25–27 | 66 % (48/73) | +2149 | 76 / 100 | 300 |
| United Kingdom | 43–38–19 | 53 % (43/81) | +264 | 7 / 100 | 10 |
| Russia | 42–38–20 | 53 % (42/80) | +293 | 5 / 100 | 19 |
| Belarus | 41–40–19 | 51 % (41/81) | +184 | 4 / 100 | 0 |
| Hungary | 47–22–31 | 68 % (47/69) | +1486 | 87 / 100 | 79 |

Variant use and survival across the 300 national matches (100 per nation):

| Variant | Completed | Games | Kills per built | Damage absorbed per built | Alive at match end | Mean first completion |
| --- | --- | --- | --- | --- | --- | --- |
| `pathfinder` | 582 | 100 | 0.00 | 101 | 13 | 38 s |
| `spearhead` | 107 | 76 | 2.80 | 446 | 38 | 73 s |
| `bunker` | 131 | 87 | 0.60 | 151 | 66 | 91 s |
| `mlrs` | 7 | 7 | 1.43 | 26 | 6 | 141 s |
| `heavyHowitzer` | 5 | 5 | 3.80 | 19 | 5 | 133 s |
| `deepReconUAV` | 4 | 4 | 0.00 | 35 | 0 | 88 s |

The control (`baltic` vs `expeditionary`, 20 games) split 8–8 with 4 timeouts and
a mean margin of exactly 0. Because both presets share the same roster, this
confirms run-to-run determinism and nothing about seats (§1.4).

## 4. Replication

Three runs, two of them larger than the other, with different commander
personalities and different seed sets. The ordering is stable at the extremes
(Lithuania down, Hungary up) and unstable in the middle (Poland), which is why
the conclusions below separate structural findings from win-rate noise:

| Run | Games per nation | Lithuania | Poland | UK | Russia | Belarus | Hungary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Primary (5 seeds, rotated) | 100 | 9–67–24 | 48–25–27 | 43–38–19 | 42–38–20 | 41–40–19 | 47–22–31 |
| Replication A (3 seeds, no rotation) | 30 | 4–23–3 | 19–8–3 | 14–14–2 | 14–14–2 | 14–14–2 | 14–6–10 |
| Replication B (independent seeds) | 60 | 16–29–15 | 11–21–28 | 18–19–23 | 18–20–22 | 22–17–21 | 31–10–19 |

Decided-game win rates across the three runs:

| Nation | Primary | Replication A | Replication B |
| --- | --- | --- | --- |
| Lithuania | 12 % | 15 % | 36 % |
| Poland | 66 % | 70 % | 34 % |
| United Kingdom | 53 % | 50 % | 49 % |
| Russia | 53 % | 50 % | 47 % |
| Belarus | 51 % | 50 % | 56 % |
| Hungary | 68 % | 70 % | 76 % |

The baseline nations (UK, Russia, Belarus in practice, because their variants
never reach the field) sit at 47–56 % in every run, which is the sanity check
that the harness is measuring roughly even armies. Hungary is above that band in
all three runs, Lithuania below it in all three, and **Poland is above in two and
below in the third** — its win-rate advantage does not replicate and is treated as
inconclusive.

In Replication A, UK and Russia produced **exactly** the same record against
identical opponents, which is the expected fingerprint of two nations whose
rosters are behaviourally identical in AI hands. Replication B differs in
scale — 64 of 180 matches (36 %) hit the cap, against 23 % in the primary — and
in personality mix (`economy`, `economy`, `infantry`, `pressure`, `armour`,
`pressure` against `infantry`, `economy`, `air`, `air`), which is why its win
rates are compressed and why it is used as a directional check rather than a
replacement for the primary matrix.

## 5. Role-specific findings

Each finding is labelled with what kind of evidence supports it.

### 5.1 Lithuania — Pathfinder

**Observed.** Lithuania fields 5.8 Pathfinders per match (582 across 100 games,
starting at 38 s) — the entire reconnaissance demand of the AI, because
`desiredUnits` asks for the `recon` family up to three vehicles while the enemy
base is unknown. The Pathfinder records **zero kills from 582 airframes**, absorbs
about 101 damage per airframe built (84 % of its 120 HP pool, i.e. it rarely
survives its first exchange), and 13 of 582 survive a match. Lithuania loses 67 of 100 games and never wins a pairing;
its best result is 3–13.

**Inferred.** The substitution removes the AI's only armed light vehicle.
`recon` carries a 25 mm autocannon and is the unit the AI uses to screen, contest
early map control and add a little anti-air; the Pathfinder does none of that, so
the AI pays 200 mats per scout for vision it does not act on and feeds six
unarmed vehicles per match into enemy fire. The optics advantage is real — 16
tiles against 12.5 — and the national vision test proves the sensor works, but the
AI has no behaviour that converts vision into fires or survival.

**Untested.** Whether a human player who escorts Pathfinders and uses the vision
deliberately would find the trade worthwhile.

**Assessment.** This is the clearest issue in the phase. It is not a values
problem that a small cost tweak would fix: the AI's scouting slot is a combat
slot in practice. Lithuania is below the baseline band in all three runs
(12 %, 15 %, 36 %) and its variant never contributes a kill; the direction is
robust even though the magnitude moves with the seed set.

### 5.2 Poland — Spearhead

**Observed.** Built in 76 of 100 games, 1.1 hulls per match, 2.8 kills each,
38 of 107 alive at the end. The AI buys the same number of armour hulls as a
baseline nation (1.1 per match) at 60 mats more each, so the cost of the variant
is opportunity cost in the bank, not a smaller armoured force. Poland wins 48 of
73 decided games in the primary matrix and beats every opponent except
Lithuania's collapse and Hungary's stalls — but in the independent seed set it
wins only 11 of 32 decided games, with 28 of 60 matches timing out, and the
Spearhead reaches the field in just 31 of 60 games there (39 hulls against 107).
**The nation-level advantage does not replicate.**

In a controlled 1v1 on open ground the Spearhead wins **9 of 12 seeds**; the
three losses leave the baseline tank alive on 7.2 HP, so the duel is decided by
one 86 %-accuracy shell either way. That matches the definition: 620 HP and
47.6 heavy DPS against 540 HP and 44.4.

**Inferred.** The duel advantage itself is real and structurally predictable
(more HP and more damage per shell, paid for with speed, turret rate and 60
mats). The AI gains it by accident — it buys the armour slot it always wanted —
rather than by exploiting reach or concentrating armour. The swing between seed
sets is most likely commander personality rather than the hull: in the primary
matrix Poland was paired mainly against `infantry`/`economy`/`air` commanders and
in the independent set against `economy`/`pressure`/`armour`, and its stalled
matches rise with the more defensive personalities.

**Untested.** The stated weaknesses — slower hull, slower turret and a longer
build — are represented in data but not observable in these matches: the AI does
not flank, kite or time pushes around turret traverse. The ATGM counter test
proves the weapon can punish a Spearhead, not that the AI does.

### 5.3 United Kingdom — MLRS

**Observed.** Built in **7 of 100 games** (7 airframes total, first at 141 s
mean), 10 kills. UK's results are indistinguishable from Russia's and Belarus's
wherever the opponent is the same: Poland vs UK and Poland vs Russia are both
9–6–5 with an identical +1636 margin, and UK vs Russia is 9–9–2 with a −18
margin, i.e. a coin flip.

**Inferred.** `desiredUnits` only requests the `spg` family when the AI has a
factory *and* has seen a garrisoned or weapon-bearing structure, at priority 96 —
below rifle (100), tank (104), ATGM (108), recon (168), harvester (190) and
engineer (240). The AI spends its bank on the army target first, so a 700-mat
battery with an 85 req price almost never clears the queue. The unit is not
broken; it is never bought.

**Untested at scale.** How oppressive 18-tile indirect fire is when it does
appear. Seven airframes is not a sample.

**Assessment.** The UK's identity is latent. A human who buys the battery gets a
real capability (`tests/national-counterplay.test.ts` shows the dead zone and the
range), but the AI does not field it, so no AI match measures it.

### 5.4 Russia — Heavy Howitzer

**Observed.** Built in 5 of 100 games, 5 airframes, 19 kills (3.8 each, the best
kills-per-hull of any variant, on a sample of five). Same behavioural identity as
the UK and Belarus in aggregate.

**Inferred.** Same production trigger and an even higher price (760 mats, 75
req), so the same starvation. The kill rate hints that the platform performs when
it appears; it is not evidence of balance.

**Untested.** The claimed weakness — a slow reload that mobile armour can punish
— is not exercised by the AI, which does not hunt artillery.

### 5.5 Belarus — Deep Recon UAV

**Observed.** Built in 4 of 100 games, 4 airframes, none alive at the end,
about 35 damage absorbed each, zero kills. Belarus is behaviourally identical to
the UK and Russia and slightly behind both (41–40–19 against 43–38 and 42–38,
same opponents).

**Inferred.** The drone requires a 240→320 mat airframe plus 50 req behind an
airfield that the AI builds around the 90 s mark, and its demand sits at priority
78 — the lowest of any unit need except recovery (72). The AI also does not need
30-tile vision: it scouts with the `recon` slot and the land scout behaviour, and
it never uses UAV vision to cue artillery because it rarely owns artillery.

**Untested.** Whether the 90-second endurance bound is a practical limit for a
human player. The SAM counter test proves air defence engages it.

### 5.6 Hungary — Bunker

**Observed.** Built in 87 of 100 games, 131 bunkers (1.3 per match, first at
91 s), 79 kills, 66 of 131 still standing at the end, only 151 damage absorbed
per bunker against 900 HP. Hungary wins 47 of 69 decided games but **31 of 100
matches hit the 600 s cap**, the highest timeout rate of any nation, and its
longest pair average is 429 s (Poland vs Hungary).

**Inferred.** The substitution behaves as designed at the unit level: the
anti-structure test shows a heavy howitzer killing an MG nest while the bunker
survives. The problem is what it does to the match: the AI's attacking
compositions are rifle-heavy and never carry artillery — per match it buys about
2.3 ATGMs and one or two new tanks on top of the five starting riflemen and two
starting tanks, and it produced a total of 12 artillery airframes across the
whole 300-match matrix — so a 900 HP position that costs the defender 420 mats
can outlast an attack wave indefinitely. Hungary therefore converts a defensive
advantage into match length rather than into a decision.

**Untested.** Whether a human opponent with artillery or armour concentration
would break bunkers cheaply. The counterplay tests say the tools exist; the AI
never uses them.

**Assessment.** Hungary's win rate is the highest in the matrix, but a quarter of
its games never finish, and the mechanism (defence that the AI cannot answer) is
the same one that produces the timeouts. Treating 68 % as "Hungary is strong" is
inconclusive.

## 6. Counterplay tests

`tests/national-counterplay.test.ts` (new, 8 tests, ~190 ms) uses small
controlled fixtures: one specialist and one answer on open ground, fog off, no
AI, an explicit initial state and assertions about range, damage or survival
rather than about who wins a large battle.

| # | Interaction | Assertion | Result |
| --- | --- | --- | --- |
| 1 | Mobile armour inside the MLRS dead zone | Tank at 5 tiles damages the MLRS; the MLRS cannot return fire (tank at full HP) | Pass |
| 2 | Bunker vs anti-structure fire | 25 s of heavy-howitzer fire kills an MG nest and leaves the bunker alive with more HP | Pass |
| 3 | Spearhead bypasses a bunker | Bunker loses HP; Spearhead above 95 % (heavy MG is nearly useless against heavy armour) | Pass |
| 4 | Armed scout vs Pathfinder | The shared recon vehicle kills the Pathfinder without taking damage | Pass |
| 5 | Spearhead head-on duel | Spearhead wins ≥ 8 of 12 seeds; every tank win leaves it under 20 HP | Pass (9/12) |
| 6 | Guided ATGM vs Spearhead | The Spearhead takes damage before it can close and the ATGM survives | Pass |
| 7 | Mobile armour vs exposed heavy howitzer | The tank kills the howitzer and survives | Pass |
| 8 | SAM battery vs Deep Recon UAV | The battery removes HP from the drone | Pass |

What the tests establish: each specialist has a working advantage and a working
counter **in the simulation**, and the values that create them are live. What
they do not establish: that the AI uses either side of the interaction, and how
often the interaction happens. Those are §7.

Deliberately not tested:

- **Counter-battery fire** — no such system exists, so the UK/Russian weakness to
  enemy artillery is the absence of a mechanic, not a measured vulnerability.
- **Flanking against turret traverse** — the simulation turns turrets at a finite
  rate, but it applies no flank or rear damage bonus, so a slow turret costs a
  unit nothing in a duel it has already joined.
- **Artillery suppression against a moving attacker** — suppression exists
  (accuracy −0.32 × suppression, speed −0.2 × suppression), but no fixture here
  measures what a 2.6-splash rocket salvo does to an advancing company.
- **Electronic warfare** — not modelled at all.

Do not read the UK or Russian weaknesses as "proven" — only their reach, damage
and dead zone are.

## 7. AI limitations vs roster balance

The phase brief asks for four distinct levels. The matrix separates them cleanly:

| Nation | Variant available | Requested by the AI | Reaches the battlefield | Used for its national purpose |
| --- | --- | --- | --- | --- |
| Lithuania | yes | 100 / 100 | 582 airframes | no — unarmed scout is not escorted and does not cue anything |
| Poland | yes | 76 / 100 | 107 hulls | partly — bought as the armour slot, not concentrated |
| UK | yes | 7 / 100 | 7 | no — appears too rarely to matter |
| Russia | yes | 5 / 100 | 5 | no |
| Belarus | yes | 4 / 100 | 4 | no |
| Hungary | yes | 87 / 100 (placed, not queued) | 131 | yes at unit level; the AI does not adapt its plan around it |

Mechanisms behind the numbers, read from `src/sim/ai.ts`:

- `desiredUnits` writes demand against baseline slots and resolves them with
  `game.unitIdFor`, so a national replacement is bought instead of the baseline
  id. This works: no nation was ever observed requesting a definition it does not
  own, and `tests/national-specialisations.test.ts` asserts it.
- Artillery demand (`spg`) is conditional on a seen fortified structure and sits
  at priority 96; the drone (`uav`) is conditional on an owned airfield and sits
  at 78. Both are the lowest-priority requests in the list. The AI's core army
  needs are satisfied first, so the two support arms are starved in a 600 s match.
- The AI's scouting need is expressed as "three `recon`-family vehicles while the
  enemy base is unknown", which for Lithuania becomes three unarmed Pathfinders.
- No nation-specific tactics exist: the AI never masses a Spearhead push, never
  keeps a battery behind a screen, never maintains a mat reserve for a 700-mat
  platform and never treats a bunker as a fixed strongpoint to garrison.

Therefore:

- **Lithuania's result is confounded with an AI limitation** (no escort, no
  vision exploitation), but the direction is unambiguous and the mechanism is
  identified.
- **UK, Russia and Belarus are inconclusive as balance questions**: their
  variants are absent from the measured matches. Their current near-identical
  records measure the shared baseline, not their rosters.
- **Hungary is measurable** at both unit and match level; the bunker is built,
  survives and changes match length.
- **Poland is measurable at unit level only.** The hull fights as designed, but
  the nation's win-rate advantage does not replicate across seed sets, so no
  claim is made that the Spearhead makes Poland stronger.
- Global caveat: 19–31 % of the matches involving a given nation hit the 600 s cap
  in the primary matrix (36 % overall in the independent seed set), so win rates
  measure "who was ahead or had not lost" as much as "who won".

## 8. Concerns, ranked by evidence strength

1. **Lithuania's substitution is a net loss** (Observed, high confidence). 9–67–24;
   zero kills from 582 airframes; every pairing lost. Root cause identified: the
   armed scout was removed and the AI has no escort or vision behaviour.
2. **Three of six national identities are invisible in AI play** (Observed, high
   confidence). UK 7/100, Russia 5/100, Belarus 4/100; identical pair margins
   prove behavioural identity. Root cause identified: production condition and
   priority, not the definitions.
3. **Defensive stalls lengthen and distort Hungarian matches** (Observed, medium
   confidence). 31 % of Hungary's matches hit the cap, 429 s average in its
   longest pairing, 66 bunkers still standing at the end, while the average AI
   attack carries no artillery.
4. **Artillery counterplay is untested at scale** (Untested). The dead zone works,
   but with 12 artillery airframes total across 320 matches there is no evidence
   about whether 18-tile rockets dominate once they appear regularly.
5. **Anti-structure counterplay for the bunker is theoretical** (Untested). The
   howitzer kills a nest and not a bunker in a controlled fixture; no AI match
   brings that weapon to a bunker on purpose.
6. **The Spearhead trade-off is data-only** (Inferred/Untested). Faster-kill and
   survivor counts show the intended upside; nothing shows the slower hull or
   turret costing Poland a fight, because the AI does not exploit either.
7. **Recon robustness**: `pathfinder` HP 120 with 16 vision against a 6-tile gun
   means a single autocannon burst removes it (Observed). If the Pathfinder is
   kept, that ratio needs a second look, but not until the AI question is settled.
8. **The harness arena favours the east seat 2:1** (Observed, §1.4). Not a
   national issue, but it caps how much any win-rate table in this document can
   mean, and it makes small national effects hard to separate from noise.

## 9. Correctness defects

**No gameplay correctness defect was found and fixed.** No balance value was
changed. Two content-copy defects were found and recorded (not fixed, to keep
this phase read-only on content):

- Bunker copy claims more weapon reach; it has more vision (see §2).
- Heavy-howitzer copy overstates its shell relative to the shared howitzer
  (1.46×, not 2×).

One test-harness defect was found and fixed: the first version of the Spearhead
duel test asserted a single deterministic winner from one seed. Three of twelve
seeds flip on a single missed shell (the tank survives on 7.2 HP), so the test
now asserts the aggregate across twelve seeds and that every tank win is a
scrape. This changed a test, not gameplay.

One unresolved observation belongs here too: the east-seat advantage in §1.4 is a
property of this arena and its deterministic ordering, not of any definition. It
may be an artefact of iteration or pathfinding order in the simulation, which
would be a genuine engine-level symmetry bug; it was not diagnosed in this phase
because it changes no measured national comparison. It is the first item to
investigate when a tuning ladder is built.

## 10. Verification

Environment: Windows, Node v24.14.0, `tsx` 4.23.15, Vitest 5.0.5, working tree
on `master` at `7989e5b` plus the uncommitted Phases 1–5 work.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean, exit 0 |
| Counterplay suite | `npx vitest run tests/national-counterplay.test.ts` | 8 passed, ~190 ms |
| Full suite | `npx vitest run` | **40 files, 430 tests passed**, 90 s |
| Build | `npm run build` | exit 0 (`tsc`, Vite, service-worker precache) |
| Primary matrix | `npx tsx tools/nation-matchups.ts 5 600` | 320 matches (300 national), 232 s |
| Independent seeds | `MCA_SEEDS=11,555,999 npx tsx tools/nation-matchups.ts 3 600` | 192 matches (180 national), 154 s |
| Replication A | `npx tsx tools/nation-matchups.ts 3 600` (older harness revision) | 96 matches (90 national), 61 s |

Test-count reconciliation: the Phase 4 reference was 38 files / 412 tests. The
working tree already carried the flag-rendering work and its
`tests/flags.test.ts` (10 tests), so the pre-Phase-5 tree was 39 files / 422
tests. This phase adds `tests/national-counterplay.test.ts` (8 tests) and no test
was removed or weakened, giving 40 / 430.

The only test that changed shape is the Spearhead duel inside the new counterplay
file (see §9). No pre-existing production test, national-specialisation test,
save/load test or determinism test was touched.

Determinism evidence: the 5-seed matrix re-ran the first three seeds of the
earlier 192-match matrix. All **192 shared matches are identical** on winner,
duration and score margin (0 differences, 0 missing) despite the two runs being
launched separately, and the all-preset control produces a mean margin of exactly
0 with mirrored pairs. Per-variant traces are therefore comparable across runs
as well.

Raw JSONL run logs are transient (`tmp/`, git-ignored). Every number in this
document is reproducible with the commands above; the seed pools and all other
settings are printed in each run's `config` line.

Not run in this phase: browser play-through of the modified files (no gameplay
file changed, so there was nothing new to observe in a match), and any tuning
ladder — the point of the phase was to measure before tuning.

## 11. Recommended next phase

**Phase 6 — National roster employment in the AI (and the Pathfinder decision).**

The evidence says the roster is not the bottleneck for three nations: the units
are defined, validated and reachable, and the AI simply does not buy or use
them. Tuning costs now would tune numbers that never appear on a battlefield,
and expanding national content would add more unused definitions.

The smallest changes that would make Phase 5's questions answerable:

1. Make the `spg` demand unconditional once a factory exists (or raise its
   priority above the army slots) so UK and Russian artillery actually appears —
   a reasonable target is at least one match in three rather than one in twenty.
   Then re-run this matrix.
2. Give the `uav` demand a real budget path (airfield → reserve → drone) and
   re-measure Belarus.
3. Decide the Pathfinder: either the AI learns to escort an unarmed scout and use
   its vision (a scouting behaviour change), or Lithuania gets a self-defence
   option. The current combination of an unarmed substitution and a
   fight-seeking scout AI is the most robust measured underperformance in the
   matrix.
4. Fix or replace the audit arena's seat asymmetry so a re-run can resolve
   smaller national effects and so future balance work is not chasing a 2:1 seat
   bias (harness work only; no gameplay change).
5. Only after 1–4, revisit numbers: artillery price/priority, bunker cost versus
   the AI's attack composition, and the 600 s stall rate.

Balance tuning, new national content, counter-battery and a research tree remain
out of scope until the above is done and this matrix has been re-run with all six
variants actually reaching the field.
