# Phase 4 — National Specialisations

Status: implemented on the current working tree, and extended by the Stage 3
national-specialisation pass recorded at the end of this document. Every
playable launch nation resolves a different roster through the Phase 1
contract. This phase introduced one deliberate substitution per nation: the
alliance platform stays in the baseline, and the nation fields a registered
variant in the same production or construction slot. Stage 3 adds the second
and third differences — one exclusive unit and one structure variant per nation
— without adding a simulation subsystem. No nation loses a role, and all six
identities still use the same production, combat, AI, save and determinism
paths.

Since the alliance-baseline stage, the two coalitions no longer share one
roster: the Defender Coalition fields the canonical platforms and the Eastern
Coalition fields its own replacements for the 21 combat slots. A national
variant therefore resolves through a chain — canonical slot → alliance platform
→ national replacement — rather than a single hop. Russia's and Belarus's
substitutions sit two levels down that chain; the three Defender substitutions
remain one hop from the canonical slot they refine. See
`docs/ALLIANCE_ROSTER_AND_TECHNOLOGY_SPEC.md` §16 for the inventory.

This document records the design, the implementation contract, the verification
evidence and the work deliberately left for later phases.

## Design matrix

| Nation | Alliance | Battlefield identity | Replaces | National capability | Trade-off and counterplay | Decision it changes |
| --- | --- | --- | --- | --- | --- | --- |
| Lithuania | Defender | Reconnaissance screen | `recon` → `pathfinder` | 16-tile optics (shared scout: 12.5), cheaper, faster | No weapon, less armour. Any armed unit or aircraft kills it; it must be escorted. | Buy eyes cheaply and pair them with shooters instead of letting one scout fight. The opponent can blind the screen by hunting an unarmed vehicle. |
| Poland | Defender | Armoured spearhead | `tank` → `spearhead` | 130mm gun (more damage and reach), 620 HP | Slower hull and turret, longer build. Flanking, anti-tank missiles and artillery punish a slow concentration. | Commit to the head-on armoured fight and accept slower tempo; protect flanks rather than rely on turret agility. |
| United Kingdom | Defender | Saturation fires | `spg` → `mlrs` | 18-tile rockets, wide splash, indirect fire | Lower accuracy, six-tile dead zone, light 210 HP hull. Fast armour that closes inside the minimum range or air kills it. | Keep the battery far back and screen it; a nearer shared howitzer would be safer but cannot reach the same targets. |
| Russia | Eastern | Siege artillery | `spg` → `spgEC` → `heavyHowitzer` | 203mm shell, 105 damage, 2.4 splash, 16-tile reach | Long reload, slow hull, higher price. Fast armour, air and flanking attacks exploit the reload. | Spend more per gun and make each salvo count; do not trade batteries in a close fight. |
| Belarus | Eastern | Deep surveillance | `uav` → `uavEC` → `deepReconUAV` | 30-tile optics, 90-second endurance | Unarmed, slower, less durable, more expensive. Air defence and interceptors remove it. | Cover more of the map with fewer airframes and use the vision for fires; accept that the drone cannot defend itself. |
| Hungary | Eastern | Fortified defence | `mgNest` → `bunker` | 1350 HP, slightly more reach, same heavy machine gun | 62% higher cost, longer construction, more power draw, still static and nearly useless against armour. | Build fewer positions and hold them longer; anti-structure fire and armour bypass are the answers. |

Each alliance baseline still supplies every essential role to its nations:
infantry, anti-tank, reconnaissance, engineers, armour, artillery, anti-air,
aviation, naval units, recovery, and the full structure set. A national
substitution changes how a role is used, not whether the role exists.

## What was implemented, deferred and rejected

### Implemented

- Six registered national definitions, each with a stable id, doctrine and
  player-facing blurb.
- Two frozen alliance baselines that differ in all 21 combat slots and share
  the four utility roles (`engineer`, `harvester`, `recovery`, `medic`), with
  every platform registered as a variant of its canonical slot.
- Multi-level `variantOf` resolution (`src/data/variant.ts`), so a replacement
  of an alliance platform still answers its canonical slot.
- One substitution per nation through `NationRosterModifications`:
  - `lithuania`: `recon` → `pathfinder`
  - `poland`: `tank` → `spearhead`
  - `uk`: `spg` → `mlrs`
  - `russia`: `spg` → `spgEC` → `heavyHowitzer`
  - `belarus`: `uav` → `uavEC` → `deepReconUAV`
  - `hungary`: `mgNest` → `bunker`
- Full simulation integration for the new definitions: weapons, armour,
  movement, vision, aircraft fuel, indirect-fire minimum range, production
  facilities, construction placement, AI family counting and save/load.
- A `NATIONAL` badge in production and construction cards, plus each nation's
  doctrine in skirmish setup, mission brief and loading screen.
- Registry validation that a replacement is a real definition, declares the
  baseline slot as `variantOf`, and shares a production facility with the slot
  it replaces.

### Deferred

- **Signature abilities that need new state.** Examples considered but not
  built: a Lithuanian forward-observer mark, a Polish entrenchment stance, a UK
  precision-rocket mode, a Russian barrage order, a Belarusian electronic-warfare
  effect and a Hungarian prepared-position bonus. Each needs new activation,
  cooldown, targeting or persistence behaviour; none is justified while the
  current substitutions already give each nation a distinct decision.
- **National additions and exclusions.** The contract supports `addUnits`,
  `addBuildings`, `removeUnits` and `removeBuildings`. Stage 3 uses `addUnits`
  for every nation's exclusive. Exclusions remain unused: removing an essential
  role would need a compensating capability that does not exist.
- **National upgrades and research.** Phase 4 predated research entirely. Stage
  4A has since added the authoritative research foundation, Research Centre and
  Belarusian variant; national upgrade content is still deferred and remains a
  Stage 4B/UI task, not a Phase 4 roster change.

Separate alliance baselines were deferred in this phase and have since shipped;
they are no longer deferred.

### Rejected

- Flat national modifiers such as “+10% damage” or “−10% cost”. They change the
  numbers but not the decision, and they make every match a comparison of
  multipliers rather than tactics.
- Cosmetic reskins presented as specialisations. A different name, colour or
  portrait is not a roster difference.
- Six wholly independent rosters. They would duplicate the baseline, multiply
  the production and counterplay surface, and contradict the GDD's alliance-wide
  common roster direction.
- Cloning a baseline definition and patching a few fields. Every national
  variant is a complete registered `UnitDef` or `BuildingDef` with a unique id,
  so simulation, saves and the editor always reference one canonical record.
- Removing a role from a nation without a tested compensating option. That
  would create unreachable production paths and dead ends.

## Implementation contract

### Content registration

`src/data/units.ts` keeps `UNIT_LIST` as the canonical baseline, registers the
Eastern platforms as variants of those slots, and keeps `NATIONAL_UNIT_LIST`
separate. `src/data/buildings.ts` does the same with `BUILDING_LIST` and
`NATIONAL_BUILDING_LIST`. Both keyed registries (`UNITS`, `BUILDINGS`) contain
every definition so a save, scenario or command can reference it by id, but the
baseline arrays hold only their own alliance's platforms, so one side never
inherits the other's equipment by accident.

Each variant declares `variantOf`. `unitFamily` and `buildingFamily` walk the
whole chain (via `resolveVariantChain`) and return the canonical slot, so a
national replacement of an alliance platform still resolves to the slot its
facility and prerequisites name. The `national` marker distinguishes a
nation-specific definition from an alliance platform, which is what the
`NATIONAL` badge and roster validation key on.

### Roster resolution

`src/data/roster.ts` remains the single source of truth:

- `mergeRoster` applies additions, removals and substitutions to a frozen
  baseline.
- `unitSlotId` / `buildingSlotId` find the actual unit or structure for a
  baseline slot, following the `variantOf` chain to its canonical root.
- `productionEntries(roster, buildingId)` returns what a facility may build for
  that roster, in baseline slot order. It resolves substitutions and appends
  national additions whose `producedBy` names the facility.
- `resolveRoster(id)` caches and freezes the result for every nation and legacy
  preset.

`Game.rosterFor`, `canProduce`, `canBuild`, `unitIdFor`, `buildingIdFor` and
`productionEntries` expose the same resolution to the simulation, HUD and AI.
Production and construction validate roster membership before any other check,
so a direct command that bypasses the UI is rejected exactly like a greyed-out
card.

### AI integration

The AI keeps writing demand in baseline slots (`recon`, `tank`, `spg`, `uav`,
`barracks`, `mgNest`, …). `AIController.desiredUnits` and `buildOptions` resolve
each slot with `unitIdFor` / `buildingIdFor`, so a national variant is bought in
place of the baseline id. `counts` and `unitCounts` are keyed by family, using
`unitFamily` / `buildingFamily`, so a built `bunker` answers the `mgNest` slot
and is not requested again forever. No AI branch names a national id directly.

### Presentation

- Skirmish setup displays the nation's name, alliance, doctrine and blurb.
- The mission brief and loading screen show the doctrine.
- Production and build cards display `NATIONAL` on a variant and read their
  entries from the resolved roster, so the card list and the simulation agree.
- The HUD, selection panel, relay meter and end screen continue to use the
  Phase 3 identity path; no new hard-coded nation labels were added.

### Persistence and determinism

There is no save-format change. A save stores the player's `factionId` and the
entity `defId` values, both of which already point at the national definition.
On load, `resolveRoster(factionId)` reconstructs the same roster. A save made as
Poland therefore keeps `spearhead` units and keeps producing `spearhead` after a
reload. Legacy `baltic` and `expeditionary` saves still resolve the baseline.

## New and changed definition ids

New units:

| Id | Name | Slot |
| --- | --- | --- |
| `pathfinder` | Pathfinder Recon Team | `recon` |
| `spearhead` | Spearhead MBT | `tank` |
| `mlrs` | Rocket Battery | `spg` |
| `heavyHowitzer` | Heavy Howitzer | `spg` |
| `deepReconUAV` | Deep Recon UAV | `uav` |

New structures:

| Id | Name | Slot |
| --- | --- | --- |
| `bunker` | Reinforced Bunker | `mgNest` |

New weapons:

| Id | Name | Used by |
| --- | --- | --- |
| `spearheadGun` | 130mm smoothbore | `spearhead` |
| `mlrsRocket` | 227mm rocket salvo | `mlrs` |
| `heavyShell` | 203mm shell | `heavyHowitzer` |

Changed systems:

- `src/sim/types.ts`: `UnitDef.variantOf`, `BuildingDef.variantOf` and
  `NationRosterModifications` additions/removals/substitutions.
- `src/data/factions.ts`: nation doctrine, blurb and `roster` declarations.
- `src/data/roster.ts`: slot helpers, production entries, variant validation.
- `src/sim/game.ts`: `unitIdFor`, `buildingIdFor`, roster-backed production and
  placement checks.
- `src/sim/ai.ts`: slot-resolved production and construction; family-keyed
  counts.
- `src/ui/hud.ts` and `src/style.css`: `NATIONAL` badge on national cards.
- `src/render/unitMeshes.ts` and `src/render/buildingMeshes.ts`: procedural
  meshes for the five units and the bunker.
- `tests/national-specialisations.test.ts`: the new focused suite.

## Verification

### Re-verification after the alliance baselines (2026-11-02)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean, exit 0 |
| Roster/integration suites | `npx vitest run tests/alliance-baselines.test.ts tests/roster-variants.test.ts tests/factions.test.ts tests/national-specialisations.test.ts tests/nation-setup.test.ts tests/production.test.ts tests/combined-arms.test.ts tests/ai.test.ts` | 8 files / 151 tests passed |
| Full suite | `npx vitest run` | 117 files / 1478 tests passed |

These runs cover the distinct baselines and the two-level replacement chain.
They do not re-validate the original Phase 4 balance conclusions, and no
production build was run for this change.

### Original Phase 4 verification

Commands run on 2026-10-26:

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean, exit 0 |
| Focused suite | `npx vitest run tests/national-specialisations.test.ts` | 18 passed |
| Full suite | `npx vitest run` | **38 files / 412 tests passed**, 87.9 s (ladder 86.8 s) |
| Production build | `npm run build` | 60 modules, JS 449.00 kB / gzip 132.28 kB |

The Phase 3 reference point was 37 files / 394 tests. The new file adds 18 tests
and no existing test was weakened or removed, so 38 / 412 is the expected
baseline.

Focused coverage:

- Every nation resolves its variant and not the baseline slot; other nations and
  both legacy presets do not inherit it.
- Every variant is producible from the same facility family as its slot.
- The owning nation can build `bunker` through a real placement command; a
  non-owning nation is rejected with a roster error.
- The Pathfinder reveals a target at 15 tiles while the shared recon does not.
- The MLRS damages a 16-tile structure, cannot damage a target inside its
  six-tile dead zone, and the shared howitzer cannot reach the same 16-tile
  target.
- The heavy howitzer damages a structure at a range beyond the shared
  howitzer's 14-tile reach.
- The deep recon UAV reveals a target at 26 tiles while the shared UAV does not.
- AI matches buy `spearhead`, `deepReconUAV`, `mlrs` and `bunker` instead of
  their baseline slots for Poland, Belarus, the UK and Hungary.
- A Poland save reloads with the same roster and `spearhead` units and the same
  state hash; two identical Russian/UK battles produce the same hash.

Browser check (Chromium, 1280×800, dev server):

- Selected the United Kingdom in skirmish setup; the blurb named the Rocket
  Battery and the brief showed the UK doctrine and `United Kingdom Task Force`.
- Built a Vehicle Factory, opened LAND production and found `MLRS` with the
  `NATIONAL` badge in place of `SPG`; the card tooltip described the real
  trade-off.
- Produced the MLRS through the HUD; the unit appeared in the simulation.
- At 844×390 the `NATIONAL` badge stayed inside the production rail with no
  horizontal page overflow, and the console showed no errors.
- The AI difficulty ladder in the full suite used the legacy baseline and was
  unchanged; it is not evidence of national matchup balance.

## Balance concerns to carry forward

No human match or win-rate sample has been played with the national rosters.
The current values are provisional. Watch these specifically:

- **Bunker:** 1350 HP for 420 materials is a large survivability jump over the
  780 HP / 260-material MG nest. Static and anti-infantry only, but it may make
  Hungary's defence disproportionately hard to clear without artillery.
- **Spearhead:** more health, damage and range for a modest price increase; the
  slower hull and turret are the intended cost. If it dominates, raise the cost
  or shorten the range before touching its armour.
- **MLRS:** 18-tile indirect reach may be very strong while no counter-battery
  mechanic exists. The dead zone and light hull are the current answers.
- **Pathfinder:** 200 materials for 16-tile vision may over-reward passive
  scouting. Its lack of a weapon is the intended brake.
- **National AI behaviour:** the AI buys the correct variant but does not adopt a
  different composition or tactic for it. A Polish AI is not more armour-heavy
  than a Lithuanian AI beyond what the shared weights produce.

## Recommended next phase

**Phase 5 — cross-faction matchup verification and national counterplay.** Run
mirrored AI matchups for all six nations, add focused counter tests (for
example MLRS versus fast armour, bunker versus anti-structure fire, Pathfinder
versus armed scouts) and record win-rate direction without tuning values yet.
This should confirm that the six identities produce different, non-dominant
outcomes before any national upgrades or signature abilities expand the
surface. It also produces the evidence needed to decide whether the next content
phase should add national capabilities or close shared-roster gaps.

---

## Stage 3 — complete national specialisations (2026-11-02)

Phase 4 shipped one substitution per nation and was superseded. Every nation now
has at least three differences from its alliance baseline: one replacement, one
exclusive unit and one structure variant, and some carry further national
unlocks where the shared roster leaves a coherent gap. The design record and the full
verification evidence are in
`docs/ALLIANCE_ROSTER_AND_TECHNOLOGY_SPEC.md` §17; this section is the Phase 4
view of the same content.

| Nation | Replacement | Exclusive unit | Structure variant |
|---|---|---|---|
| Lithuania | `pathfinder` (recon) | `kestrelTeam` — barracks, shoulder-fired SAM, air only | `forwardPost` (radar) |
| Poland | `spearhead` (tank) | `wilk` — factory, autocannon + ATGM on a tracked chassis | `armourWorks` (factory) |
| United Kingdom | `mlrs` (spg) | `stormShadow` — factory, 26-tile single-missile deep strike | `expeditionaryAirfield` (airfield) |
| Russia | `heavyHowitzer` (spg) | `tosp` — factory, 9-tile thermobaric area denial | `longRangeSam` (samBattery) |
| Belarus | `deepReconUAV` (uav) | `sprut` — factory, cheap unarmed scout buggy | `signalsBureau` (researchCentre) |
| Hungary | `hedgehogTeam` (atgm) | `taszar` — barracks, 7-tile infantry mortar | `bunker` (mgNest) |

Hungary is the one nation that changed shape rather than gaining alongside its
existing difference: it previously had only the bunker. It now also carries the
Hedgehog AT replacement for the Eastern ATGM team, and the bunker is accounted
for as its structure variant rather than as its only national content.

### The Belarus decision

Stage 3 shipped `signalsBureau` provisionally as a `radar` variant because no
research building existed. **Resolved in Stage 4A:** `researchCentre` now exists,
and the bureau declares `variantOf: 'researchCentre'`, occupies that canonical
slot, remains Belarus-only, and keeps its faster research (`researchSpeed`
1.25). It is no longer a radar building, and the provisional divergence from
the design is closed.

### Integration change this stage required

`productionEntries` compared a unit's `producedBy` id with the building id
exactly. Poland's Armoured Workshop and the British Expeditionary Airfield are
new building ids, so they produced nothing: every unit they were meant to build
named `factory` or `airfield`. Production now compares the facility **family**,
which restores those two structures without loosening any other gate — a
structure of a different family still refuses.

The AI reads its own resolved roster and buys one optional copy of the nation's
exclusive once a field army exists, at a priority below every core arm. Slot
demand is unchanged, so the AI does not attempt content its roster excludes.

### Verification (Stage 3 run)

| Check | Result |
|---|---|
| Typecheck | clean, exit 0 |
| Focused national/roster/AI suites | 10 files / 188 tests passed |
| Full suite | 118 files / 1503 tests passed |
| Production build | 104 modules, JS 924.38 kB / gzip 273.85 kB |

Stage 4A re-ran the current tree: typecheck clean, production build clean, and
the full suite 1565 tests passed with only the tracked pre-existing
`tests/ai-matchups.test.ts` difficulty-ladder failure. The national suite is now
25 tests and includes the reparented Belarusian Research Centre.

The per-nation matchup matrix was **not** run. The balance risks flagged above
for the Phase 4 replacements still apply, and the new exclusives add these: massed
Kestrel teams against air, Storm Shadow with no counter-battery, TOSP against
garrisoned infantry, Poland's combination of Spearhead, Wilk and a hardened
factory, and Belarus stacking vision. Research foundations now exist, but
production is not yet gated by them, so the design's tier-2 exclusives remain
available as soon as their facility stands until the interface stage wires the
availability query into production.

Nothing was committed.
