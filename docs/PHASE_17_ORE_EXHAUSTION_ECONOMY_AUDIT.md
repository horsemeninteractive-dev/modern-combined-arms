# Phase 17 — Ore Exhaustion and Knowledge-Aware Economic Recovery

**Verdict.** The commander-local defect is confirmed and fixed narrowly. A side
with a completed drop-off and live haulers kept ordering **more haulers and
saturation refineries** even when every hauler was standing idle because it could
not find a reachable deposit. The planner now withholds only those two expansion
demands while hauling is idle. It does not read `map.ore`, does not restore
income, and does not add a resource mechanic. Complete ore exhaustion remains
economically terminal under the shipped resource rules; that boundary is
documented below rather than patched with a new source of income.

The 540-match Phase 16 diagnostic replay is **outcome-neutral**: 540/540 matches
keep the same winner/timeout classification and timeout category, and the
timeout count is unchanged at 137. The material effect is confined to the
controlled exhausted-economy states: a useless hauler replacement is withheld
and the bank goes to the army. No general match-strength improvement is claimed.

---

## 1. The actual resource model versus what the commander knows

### 1.1 Ore is finite

Ore is authored per tile in `Scenario.tiles[].o` and copied into
`RuntimeMap.ore`/`maxOre` (`src/sim/map.ts`). The only runtime write is mining:

```ts
// src/sim/game.ts, updateHarvester -> mining
h.ore += take;
this.state.map.ore[idx] = Math.max(0, available - take);
```

There is no regeneration, no new deposit discovery, and no team-specific
resource knowledge. Every map has the deposits it was authored with; the
diagnostic arena starts with **19,200** (32 tiles × 600), while shipped maps vary.
`oreLeft` in the audit is therefore the actual remaining world total, not a
commander estimate.

### 1.2 How a hauler becomes idle

`updateHarvester` has five phases:

| Phase | Meaning | Can it earn? |
| --- | --- | --- |
| `seek` | asking `findOreForHarvester` for a reachable tile | no |
| `toOre` | path to a chosen tile | no |
| `mining` | removing ore at 22 M/s into a 300 M hopper | not until delivered |
| `toRefinery` | carrying a full hopper to a drop-off | no |
| `unloading` | 1.2 s transfer, then `seek` | at the end |

`findOreForHarvester` scans **the whole map**, sorts by distance, and tries the
nearest 14 tiles until a path exists. It is a unit action, not an AI query. The
commander does not receive the tile, the total, or a list of deposits; it only
sees the resulting `phase` and hopper on its own hauler. That is the same state
the HUD shows.

A hauler is idle only when it is in `seek` with an empty hopper. After an
unload it is in `seek` for one tick before it finds the next tile, so a
single-tick `seek` is not evidence that the map is exhausted. The gate therefore
also requires three seconds of zero material income (§3); it is used only to
withhold **expansion** decisions, never to cancel an order or pause combat
production.

### 1.3 The AI's economy checks

`desiredUnits` asks for:

```ts
if (refineries > 0 && !ctx.haulingIdle) {
  const haulerTarget =
    recruit ? Math.min(2, refineries)
    : elite  ? Math.min(5, refineries + 2)
    :          Math.min(3, refineries + 1);
  need('harvester', haulerTarget, 190);
}
```

`buildOptions` asks for a **saturation** refinery only while hauling is not idle:

```ts
if (!refinery) add('refinery', opening.refinery + jitter(), 'material drop-off', true);
else if (!ctx.haulingIdle) {
  const saturation = harvesters / Math.max(1, refinery);
  if (refinery < 3 && saturation >= 1.75 && bank > 550) {
    add('refinery', 58 + ctx.profile.economy * 30 + jitter(), 'saturated harvester round trips');
  }
}
```

The **first** refinery is never gated: with no drop-off, the commander must still
build the only structure that can turn a load into income, and the Phase 15
drop-off reserve remains in charge of that purchase. The **engineer** demand and
the Phase 16 engineer reserve are also untouched.

### 1.4 The lifeline's existing boundary

`passiveMatsFor` pays the headquarters life-line only when `hauling` is false:

```ts
const hauling =
  harvesters > 0 &&
  (refineries > 0 || (player?.mats ?? 0) >= REFINERY_REPLACEMENT_COST);
```

A completed drop-off plus a live hauler is treated as a working economy even when
every hauler is idle on an empty map, so the 1 M/s lifeline is withheld. This is
the Phase 15 rule and is **not changed here**: deciding that a drop-off is not
working because the map has no ore would require the game to read the global ore
field, which is exactly the kind of unrestricted world knowledge this phase must
not introduce into commander decisions. It would also be a change to the
resource/lifeline mechanic, not an AI information fix. The consequence is
documented in §4 and §7, not hidden.

---

## 2. The failure boundary, measured

Fixture: a frozen 64×64 world with a command post, factory and barracks, one
completed refinery (unless stated), one or two haulers, an optional engineer, a
fixed bank, and an optional ore field under the base. No opponent acts. Each
world runs 180 s with the real `AIController`; “before” is the Phase 16 planner
with the new gate forced off, “after” is the shipped gate.

| World | Before | After | What changed |
| --- | --- | --- | --- |
| A: ore 600, 2 haulers, bank 2000 | 1 refinery, 2 haulers, 9 combat, bank 350 | identical | Healthy economy untouched. The raw all-seek state occurred for **1 tick in 3,600** (an unload transition), but the 3 s zero-income confirmation kept the gate off; no purchase changed. |
| D: no ore, **1** hauler, bank 2000 | 1 refinery, **2** haulers, 4 combat, bank 90 | 1 refinery, **1** hauler, 7 combat, bank 130 | No second hauler; 300 M redirected to combat. |
| H: no ore, 2 haulers, bank 5000 | **2** refineries, **3** haulers, 10 combat, bank 220 | **1** refinery, **2** haulers, 10 combat, bank 50 | No 600 M saturation refinery and no 300 M third hauler; 900 M not spent on capacity that cannot earn. |
| J: no ore, 2 haulers, no engineer, bank 5000 | **2** refineries, **3** haulers, 9 combat, bank 50 | **1** refinery, **2** haulers, **10** combat, bank 380 | Same 900 M withheld; one more combat unit. |
| I: ore 600, **1** hauler, bank 2000 | 2 haulers, gathered 300 | identical | The normal “buy the second hauler” decision is preserved. |
| G: no ore, **0** haulers, bank 2000 | builds 2 haulers, gathered 15 | identical | No hauler means no local evidence; rebuilding one is a legitimate bet, and the signal does not fire until one exists. |
| B/C: no ore, 2 haulers, with/without engineer, bank 2000 | 1 refinery, 2 haulers, 7 combat | identical | Already at the veteran target; no extra purchase to suppress. |
| E: no ore, bank 0 | no purchase | identical | No bank to spend; the gate is not a hidden grant. |
| F: no ore, no refinery, 2 haulers, bank 0 | no refinery; lifeline 1 M/s; gathered 180 | identical | The Phase 15 lifeline and the Phase 16 engineer path are outside the gate. |

The **D/H/J** rows are the demonstrated defect: the old planner treated a
completed drop-off and a live hauler as evidence of a working economy and bought
more of the same. The **A/I** rows are the control that matters: while a hauler is
cycling, the same code path buys the second hauler normally. The **G** row
prevents an over-broad fix: “no hauler” is uncertainty, not proof of exhaustion.

### 2.1 The healthy transient

The raw all-seek condition was true for **1 sample out of 3,600** in world A,
where two haulers cycle continuously. That is the one-tick window after an unload.
The shipped gate also requires the existing income history to be zero for six
samples (3 s), so that sample did not fire it; the before/after rows are
identical. The field is deliberately **not** called “ore exhausted”; it is
`haulingIdle`, and its own comment says it is evidence, not proof.

### 2.2 The reserve interactions

The new gate cannot duplicate or cancel either existing reserve:

- **Phase 15 drop-off reserve** runs only when no drop-off exists or one is under
  construction; the gate requires a **completed** drop-off, so they never overlap.
- **Phase 16 engineer reserve** runs only when there is no engineer **and** (no
  completed refinery **or** no hauler). The gate requires both a completed
  refinery and a live hauler, so they are mutually exclusive.
- When the engineer/refinery sequence completes and ore is already gone, the gate
  can fire afterwards. It then withholds only new haulers/saturation refineries;
  it does not undo the engineer or the drop-off.

---

## 3. The signal and its scope

Derived on every think in `AIController.update`, from own entities only:

```ts
const haulers = own.filter(
  (e) => e.kind === 'unit' && e.hp > 0 && unitFamily(e.defId) === 'harvester',
);
const hasDropOff = complete.some((b) => BUILDINGS[b.defId]?.refinery);
// Six 0.5 s samples = 3 s of no material income, using the HUD's existing
// history. A hauler is `seek` for one tick after unloading; that must not fire.
const noRecentIncome = ai.incomeHistory.slice(-6).every((v) => v === 0);
const haulingIdle =
  hasDropOff &&
  haulers.length > 0 &&
  noRecentIncome &&
  haulers.every((e) => {
    const h = e.harvester;
    return !!h && h.phase === 'seek' && h.ore === 0;
  });
```

It is a **derived boolean**, not saved state: no `AIControlState` field, no save
schema change, no new persistent subsystem. It is recomputed from the same phase
the HUD displays. It reads no map ore, no enemy entity, no fog grid, and no team
total. A new deposit or a resumed cycle changes the hauler's `phase`; the gate
releases on the next think. Fixture “restore” proves this: a deposit made
reachable at 60 s produces gathered material and the second hauler again.

### 3.1 State classification

| State from the commander's view | Signal | Behaviour |
| --- | --- | --- |
| At least one hauler is mining/travelling/unloading | false | Normal economy; buy the target crew. |
| All haulers `seek`, completed drop-off, live haulers, no income for 3 s | true | Withhold **new** haulers and **saturation** refineries. |
| No hauler | false | Keep the hauler demand; a replacement is a legitimate bet. |
| No completed drop-off | false | Keep the first refinery / drop-off reserve path. |
| Hauler full or delivering | false | It is producing; no suppression. |
| New reachable ore / resumed cycle | false next think | Demand returns automatically. |
| All ore gone, no new source | true | No further capacity is bought; army spending continues. |

This is deliberately **not** a claim that the map is exhausted. It is the
strongest commander-local statement available without reading the world: “nothing
I own is currently hauling.” The measurable behavior change is confined to
expansion, so a transient cannot freeze combat production.

---

## 4. Why the zero-income state was not “fixed” by restoring income

A completed drop-off and a live hauler with no usable ore still has **0 M/s**
hauling income, and the lifeline remains off under the Phase 15 rule. That is a
real economic dead end for the side, but it is not a legal AI information fix:

- the only way to distinguish “drop-off with a hauler” from “drop-off with a
  hauler and no ore” at the **game** level is to read the global ore field;
- the only way to add income would be a new resource source or a lifeline rule
  change, both explicitly out of scope;
- the Phase 15 report already records **43 of 108** zero-refinery stranded sides
  with no ore at all, and the 540-match arena ends with **774/1,080 sides at
  `oreLeft = 0`**. Complete exhaustion is the normal late state of this diagnostic
  arena, not a rare bug.

The justified correction is therefore the **spending** side: do not buy
additional capacity that the commander's own haulers show cannot be worked, and
do not suppress the army in the process. The alternative routes that remain are
documented, not invented: a captured supply depot's passive 2 M/s, the
headquarters lifeline when the drop-off condition genuinely qualifies, and
existing army/score victory. No ore regeneration, no free materials, no new
deposit source.

If the product decision is that complete exhaustion should always leave a
minimum income, that is a separate economy design change and needs its own
approved phase; it is not smuggled in here.

---

## 5. The production change

`src/sim/ai.ts` only:

1. add `haulingIdle` to `AIContext`, derived in `update` from own haulers;
2. gate the **saturation** refinery branch in `buildOptions`;
3. gate the **harvester** demand in `desiredUnits`.

No unit/building stat, cost, income, power, repair rule, difficulty weight,
roster, movement, fog, assault, renderer, victory condition or save format is
touched. The first refinery, engineer demand, and every combat demand keep their
old behavior.

The temporary before/after fixture run forced the gate off with a one-line
experiment and restored the shipped file byte-for-byte (`cmp` verified); the
experiment is in `tmp/`, not production.

---

## 6. Test coverage

New: `tests/ore-exhaustion.test.ts` — **7 tests**:

1. no second hauler while the only one idles on an empty map;
2. no saturation refinery or extra haulers in an idle base;
3. healthy ore still buys the second hauler;
4. a healthy economy is not treated as exhausted;
5. zero haulers keeps the rebuild demand (uncertainty is not exhaustion);
6. a deposit made reachable at 60 s releases the gate and the second hauler is
   bought;
7. identical exhausted runs have identical `stateHash()` and decisions.

Existing fixtures that had **no ore** and asserted a second refinery were given a
working deposit (`tests/construction-priority.test.ts`,
`tests/defence-priority.test.ts`). Their assertions are unchanged; without ore
the new rule correctly withholds a drop-off, so the old fixture no longer tested
the saturated-economy decision it names. The hidden-enemy control in
`construction-priority` was also given the same forest as the hidden-tank world;
previously the “clear” arm had no forest, so terrain was an unintended second
variable. This is a control fix, not a weakened assertion.

Full suite: **46 files, 502 tests passed**. Typecheck and production build pass.
The Elite–Veteran contract reports margin **36,531** (threshold >15,000, wins
11–5), Recruit–Veteran −50,005, Elite–Recruit 86,251.

`npm run build` output: 61 modules, 460.74 kB JS, 90.07 kB CSS, precache 13
files.

---

## 7. 540-match diagnostic replay

Same arena, seeds `101,1078,2055,11,555,999,1234,2468,3690`, 600 s, veteran,
`MCA_REPAIR_RULE=control`, identical seats and personality rotation as
`tmp/p16-540-final.jsonl`. Phase 17 output: `tmp/p17-540b.jsonl`.

| Measure | Phase 16 baseline | Phase 17 | Paired difference |
| --- | --- | --- | --- |
| Matches | 540 | 540 | — |
| Outcomes | 157 victory / 246 defeat / 137 timeout | identical | 540/540 same classification |
| Timeout categories | 84 army-collapse, 21 siege-out-repaired, 18 defensive-stalemate, 9 other, 4 artillery-standoff, 1 targeting | identical | 0 category changes |
| Decisive mean | 289.29 s | 289.29 s | 0 |
| Units built (sides) | 18,600 | 18,600 | 0 |
| Gathered | 5,053,215 | 5,053,215 | 0 |
| End bank | 158,541 | 158,541 | 0 |
| End force value | 2,108,005 | 2,108,005 | 0 |
| End harvesters | 1,501 | 1,501 | 0 |
| End refineries | 1,197 | 1,197 | 0 |
| Sides at `oreLeft=0` | 774 | 774 | 0 |
| Sides at `oreLeft=0` + refinery + hauler | 445 | 445 | 0 |
| Matches with such a side at end | 367 | 367 | 0 |

All **540 match records are byte-for-byte identical** to the Phase 16 baseline
when keyed by pairing, seed, seat and personality rotation. The end-state cohort
of 367 matches is identical in outcomes, gathered, units, harvester/refinery
totals and force value. The gate therefore does not change this arena at all:
those sides had already made their purchases before exhaustion, had no bank or
producer left, or were already past the point where another drop-off could be
placed.

That is a null result for match strength, reported as such. It does **not**
retract the controlled defect: the fixture states in §2 are reachable states with
a completed drop-off, idle live haulers and an unspent bank, and the old planner
spent it on capacity that could never earn. The arena simply does not visit the
1-refinery/2-hauler/high-bank exhausted cell often enough to change a match. The
controlled fixtures, not the arena, are the evidence for the correction.

---

## 8. Explicitly unchanged

- Unit and building statistics, costs, power, income rates, construction times.
- Ore placement, finite reserves, no regeneration, no new resource source.
- The Phase 15 drop-off reserve and the Phase 16 engineer reserve.
- The headquarters lifeline condition and all passive income.
- Difficulty weights and the Elite–Veteran contract.
- Assault destinations, `knownBlockage`, `aimIsOpen`, Phase 11 behavior.
- Phase 12/13 fog boundaries, `knownForCrowding`, build-site scoring.
- Defensive priority, `defenceTargets`, `nextDefenceBuild`, repair suppression.
- Movement, pathfinding, collision, placement, combat, victory conditions.
- Rosters, national substitutions, legacy presets, save schema and serialization.
- Renderer and all presentation code.

## 9. Remaining risks and unresolved states

1. **Complete ore exhaustion is still zero-income** with a standing drop-off and
   hauler; the fix makes the AI stop buying capacity, not recover. A future
   economy-design phase would need to decide whether that is acceptable.
2. **Transient**: a healthy unload can make every hauler `seek` for one planning
   tick. The 3 s zero-income confirmation excludes it; measured at 1/3,600 ticks
   in the healthy fixture, with no purchase change. A longer interruption while
   income is still arriving is also excluded, by design.
3. **No hauler** is treated as uncertainty and still buys a replacement. If the
   map is already exhausted, that 300 M is still spent; the commander has no local
   evidence to do otherwise, and suppressing it would be a guess, not knowledge.
4. **A killed hauler replacement can be withheld** when the survivor has been
   idle with no income for three seconds. The one-tick case that appeared in the
   earlier replay trace was excluded by the confirmation window and the full
   replay is now identical; a sustained case would still withhold the
   replacement. That is
   the intended boundary, but a future tactical review may decide a minimum
   one-hauler replacement is worth the risk.
5. A captured supply depot's passive 2 M/s counts in `incomeHistory`, so the
   gate stays off while that income arrives even if no ore remains. That is not a
   zero-income deadlock, and the commander has a legitimate income source; it is
   left unchanged rather than special-cased.
6. The diagnostic matrix is a 64×64 synthesized arena with a fixed 19,200 ore
   field; it is not evidence about shipped-map economy or mobile performance.
7. No save-field was added, so an old save can be loaded and resumed; the signal
   is recomputed on the first think after load. The save/load suite passes.
