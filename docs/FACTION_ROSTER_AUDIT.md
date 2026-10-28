# MCA — Faction & Roster Completeness Audit

Date: 2026-10-26  
Scope: read-only audit of the working tree at commit `7989e5b` plus uncommitted changes.  
Deliverable: this report only. No source, test, configuration, asset or existing document was modified.

---

## 1. Executive summary

**MCA does not have factions yet. It has two coloured team labels over one shared roster.**

The simulation, economy, production, AI, editor, save format and HUD are all built around
"player 0 versus player 1". The chosen faction changes a name, a short name and an accent
colour. It does not change a single unit, structure, cost, upgrade or behaviour.

| Question | Finding |
| --- | --- |
| Faction records defined | 2 (`baltic`, `expeditionary`) in `src/data/factions.ts` |
| Faction record content | Name, short name, two colours, blurb, and `units`/`buildings` arrays that are **never read** |
| Nations modelled | 0. No nation, alliance, variant or specialisation type exists |
| Units implemented | 10 (1 engineer, 3 infantry, 4 land vehicles, 1 aircraft, 1 warship) |
| Weapons implemented | 11 |
| Structures implemented | 20 (11 player-buildable, 9 authored-only) |
| Upgrades / research / tech tree | 0. No upgrade definition, prerequisite graph, research action or unlock state |
| Faction-specific conditionals in code | 1 cosmetic (`src/ui/overlay.ts:361` picks the red health tick by testing `factionId === 'expeditionary'`) |
| Player faction selection | None. `App.startBattle` always uses `localPlayerId: 0`, and every built-in map authors player 0 as `baltic` |
| AI faction selection | None. In every built-in map the AI is player 1 (`expeditionary`), and the AI planner has no faction input |
| Faction-aware tests | None. The only test that names a faction is a relay-caption test |
| Battle-ready roster roles | 13 of 26 audited roles covered, 6 partial, 7 missing |

The seam is real but thin: ids are strings, definitions live in static registries, scenarios
carry `factionId`, and saves round-trip it. That is a useful starting point. It is not a
data-driven faction system, because nothing consumes the roster lists and every player can
build every unit and structure.

### What is missing for "complete, selectable, differentiated launch factions"

1. **A content model** for alliances, nations, variants, substitutions and upgrades.
2. **Roster gating** in production, building placement, the build menu, the editor palette,
   scenario validation and AI planning. Without this, a selection screen is decoration.
3. **A match-setup path** that lets the player choose a nation (and optionally a side)
   before deployment, then applies it to the scenario's player entry.
4. **The shared baseline roster's missing roles**: indirect fire, mechanised transport,
   air-to-air, reconnaissance aviation, recovery/logistics, coastal defence, and a
   late-game technology layer.
5. **Six national identities** with real substitutions and one or two mechanics each.
6. **Faction-aware AI** and a faction-pair matchup harness.
7. **Save/format migration** that keeps existing maps and saves loadable while faction
   schema changes land.

### Recommended next phase

**Phase 1 — faction content model and roster plumbing** (section 10). Do not start with a
nation-picker screen. A picker placed on top of the current model would change a label and
nothing else, and would have to be rewritten when gating arrives. Build the model and the
gating contract first, prove it with two test factions, then build the picker.

### Current verification baseline (this audit)

- `npx tsc --noEmit` — clean (no output).
- `npx vitest run` — **34 test files, 342 tests, all passing**, 72 s.
- AI ladder in that run: Recruit vs Veteran margin **−63,772** (3–13),
  Elite vs Recruit **+87,382** (14–2), Elite vs Veteran **+15,560** (10–6).
- `npm run build` was **not** run: it writes `dist/`, and this task permits only the report.
- No browser session was opened. UI findings below come from source, markup and the existing
  presentation/layout tests.

---

## 2. Actual current implementation state

### 2.1 The working tree

The repository is on `master` at `7989e5b` with a large uncommitted front-end/map/audio
milestone: the intro and menu shell, PWA assets, four theatres, music, the Irontide engine
beat, garage/slipway animations, fog repairs and the symmetric map set. The audit treats the
working tree as the source of truth; it does not reset or clean anything.

### 2.2 What exists and works

- **Fixed-step deterministic simulation** at 20 Hz (`TICK_RATE` in `src/sim/constants.ts`),
  seeded RNG, command queue, state hash and save/load round-trip.
- **Two-resource economy**: materials from ore/harvesters/refineries plus a backstop trickle
  from the Command Post; requisition from the HQ, refineries and capturable relays.
- **Construction**: engineer-placed structures, per-structure build progress, power grid with
  brownout penalties, capture and repair.
- **Production**: per-facility queues (max 5), rally points, land/air/naval production, air
  rearm/refuel and naval reload/repair loops.
- **Combat**: armour classes, weapon multipliers, range and line of sight, projectiles,
  suppression, garrisons, static defences, SAM/AA hard counters.
- **Fog of war**: three-state vision (visible / remembered / hidden) with charted structures
  and contacts.
- **AI**: a seeded commander with five strategies, three difficulties, scouted-force counters,
  defensive siting, air/naval branches, objective capture and wave attacks.
- **Editor**: terrain, elevation, ore, starts, structures, units, objectives, validation,
  reachability preview, import/export and test-battle launch.
- **Front end**: intro gate, studio sting, engine mark, animated menu lockup, four-map
  skirmish selector, loading screen, settings, PWA install and menu music.

### 2.3 What does not exist

- No faction/nation choice at match setup.
- No side swap: the human is always scenario player 0.
- No roster filtering by faction anywhere.
- No national units, variants or substitutions.
- No upgrade, research, prerequisite graph or tech level.
- No faction-specific structure or production difference.
- No faction-aware AI, editor palette or scenario validation.
- No multiplayer or team-of-nations support: vision/fog arrays are hard-coded to two teams
  (`src/sim/game.ts:173-175`), and one `AIControlState` drives the first AI player
  (`src/sim/ai.ts:394-398`).

### 2.4 Documentation versus reality

`docs/PLAN.md:97` describes the six-nation requirement as "**Seam only** — `src/data/factions.ts`
defines Baltic + Expeditionary; data-driven ids". The first half is accurate; "data-driven ids"
is generous. The ids are data, but no behaviour consumes the lists, `factionDef()` is dead
code, and both factions list every unit and building. `README.md:241` is honest: "no
multiplayer, campaign, six-nation roster or mod SDK yet." See section 13 for the full
inconsistency list.

---

## 3. Architecture map

### 3.1 The faction path, end to end

| Step | Where | What actually happens |
| --- | --- | --- |
| 1. Faction representation | `src/sim/scenario.ts:28` (`ScenarioPlayer.factionId`), `src/sim/types.ts` (`PlayerState.factionId`), `src/sim/types.ts:183` (`FactionDef`) | A free-form string id, validated against `FACTIONS` when a scenario is parsed |
| 2. Definition registry | `src/data/factions.ts:8-31` | Two records: `baltic`, `expeditionary` |
| 3. Selection (player) | `src/app.ts:742` (`startBattle`), line 767 | No selection. `localPlayerId: 0` is hard-coded; player 0's faction comes from the map |
| 4. Selection (AI) | `src/data/scenarios.ts:258-280`, `src/data/maps.ts:218-235` | Authored: player 1 is `expeditionary`, `isAI: true` |
| 5. Starting force | `src/sim/game.ts:179-233` | Spawns exactly the authored structures and units; both players get `settings.startingMats` / `startingReq` |
| 6. Definition lookup | `src/data/units.ts`, `buildings.ts`, `weapons.ts` | Module-level `ROSTER` arrays turned into `Record<string, Def>`; no runtime registration, no mod path |
| 7. Production availability | `src/sim/game.ts:1609-1669` (`productionStatus`) | `BuildingDef.productionList` must include the unit **and** `UnitDef.producedBy` must include the building id. No player/faction term |
| 8. Build availability | `src/data/buildings.ts:414` (`BUILDABLE_BY_PLAYER`), `src/ui/hud.ts:1562`, `src/app.ts:1346` (`placementStatus`) | Every player sees the same 11 buildable structures |
| 9. Upgrades/tech | — | No system. `Cost.req` is a currency check only. Three hard-coded special cases exist: engineer fallback at the HQ, fighter requires an airfield, corvette requires a shipyard (`game.ts:1638-1650`) |
| 10. Combat consumption | `src/sim/combat.ts`, `src/sim/game.ts`, `src/data/weapons.ts` | Weapons are looked up by id from the unit definition; armour multipliers, domain/target class, ammo and fuel are per-definition |
| 11. AI consumption | `src/sim/ai.ts:394` (`update`), `1039-1094` (`desiredUnits`), `1097` (`manageProduction`) | Hard-coded unit ids and role weights; no faction parameter; production is attempted through `productionStatus` |
| 12. Identity in UI | `src/ui/hud.ts:98,216,1054`, `src/render/renderer.ts:743-751`, `src/ui/relayMeter.ts:21-30`, `src/ui/overlay.ts:361,380`, `src/ui/editor.ts:619` | Short name, colour and dot only |
| 13. Persistence | `src/sim/save.ts`, `src/sim/game.ts:4191` (`toSave`), `4231` (`fromSave`) | Scenario plus runtime `PlayerState[]`, including `factionId`. `parseScenario` rejects unknown faction ids (`scenario.ts:202-203`) |
| 14. Maps and editor | `src/data/maps.ts`, `src/data/scenarios.ts`, `src/ui/editor.ts` | Every authored map fixes player 0 to `baltic` and player 1 to `expeditionary`; the editor can move starts but cannot change faction, name or AI flag |
| 15. Determinism assumptions | `src/sim/game.ts`, `tests/determinism-save.test.ts` | Seeded RNG, ordered command application, state hash. Content additions are safe as long as ids and iteration order are stable; the AI's production tie-break already sorts by `defId` (`ai.ts:1096-1102`) |

### 3.2 The FactionDef shell

```ts
// src/sim/types.ts:183
export interface FactionDef {
  id: string;
  name: string;
  shortName: string;
  color: string;
  accent: string;
  blurb: string;
  units: string[];      // never read outside src/data/factions.ts
  buildings: string[];  // never read outside src/data/factions.ts
}
```

Both records do `units: [...allUnits]` and `buildings: [...allBuildings]`, so even if the
lists were consumed the two factions would still be identical. `factionDef(id)` is exported
but imported nowhere.

There is no `faction` field on `UnitDef` or `BuildingDef`, no `variantOf`, no `nationality`,
no `techLevel`, and no availability list. The only content gate is the intersection of a
producer's `productionList` with a unit's `producedBy`.

### 3.3 Two-team assumptions that matter for factions

- Vision and fog are allocated as exactly two teams: `this.visible = [[], []]` and
  `this.state.fog = [0, 1].map(...)` (`game.ts:173-175`).
- One `AIControlState` and one controller: `AIController.update` picks
  `players.find((p) => p.isAI && !p.defeated)` (`ai.ts:394-398`), so a second AI player is
  never driven.
- `MAX_TEAMS = 2` (`constants.ts:21`).
- The HUD hard-codes friendly/enemy tinting and an `expeditionary` special case
  (`overlay.ts:361`).

Six nations therefore fit as **player identities inside a 1v1, two-alliance match**. Team-of-
nations skirmish (3v3) is a separate, much larger change and should stay out of scope.

---

## 4. Complete unit matrix

Ten units exist, all in `src/data/units.ts`. No unit is faction-gated: both factions list
every one. "Test files" is the number of files under `tests/` containing the unit id as a
whole word (some are fixtures, not assertions), followed by the most relevant files.

### 4.1 Identity, production, economy and mobility

| ID | Name / role | Produced by | Cost M / R | Time | Domain / move | Speed | HP / armour | Vision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `engineer` | Combat Engineer — construction / capture | `factory`, `commandPost` (fallback) | 300 / 0 | 12 s | land / tracked | 1.7 | 180 / light | 6 |
| `rifle` | Rifleman — infantry | `barracks` | 130 / 0 | 6 s | land / foot | 1.35 | 125 / infantry | 7 |
| `atgm` | ATGM Gunner — anti-armour | `barracks` | 200 / 25 | 9 s | land / foot | 1.0 | 105 / infantry | 8.5 |
| `medic` | Field Medic — infantry support | `barracks` | 160 / 0 | 7 s | land / foot | 1.45 | 105 / infantry | 7 |
| `tank` | Main Battle Tank — armour | `factory` | 720 / 0 | 18 s | land / tracked | 2.3 | 540 / heavy | 8 |
| `recon` | Recon Vehicle — reconnaissance | `factory` | 260 / 0 | 9 s | land / wheeled | 3.7 | 170 / light | 12.5 |
| `aa` | AA Vehicle — air defence | `factory` | 380 / 45 | 12 s | land / wheeled | 2.7 | 280 / light | 10 |
| `harvester` | Harvester — economy | `factory` | 500 / 0 | 14 s | land / tracked | 2.2 | 420 / heavy | 5 |
| `fighter` | Strike Fighter — strike aircraft | `airfield` | 760 / 170 | 22 s | air / air | 9.5 | 210 / air | 14 |
| `corvette` | Missile Corvette — naval combatant | `shipyard` | 920 / 210 | 26 s | naval / naval | 3.4 | 950 / naval | 12 |

### 4.2 Weapons, abilities, AI use and coverage

| ID | Armament | Targets / key multipliers | Special mechanics | AI use | Test files (examples) | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `engineer` | none | — | Builds and repairs structures; captures relays, depots and radar stations; unarmed | Exactly 1, highest priority (240); builds every AI structure | 16 — `construction`, `production`, `combat`, `infrastructure` | Fully implemented |
| `rifle` | 5.56 mm rifles: 7 dmg, 6 range, 0.9 s, 82 % | infantry ×1.45; heavy ×0.12; air 0 | Can garrison authored shelters | Weighted by strategy and scouted mix; at least 1 | 13 — `combat`, `garrison`, `production`, `balance` | Fully implemented |
| `atgm` | Guided ATGM: 44 dmg, 10 range, 3.4 s, 90 % | heavy ×1.65; naval ×1.25; infantry ×0.22 | Can garrison; outranges the MBT (10 vs 7.5) | Weighted by strategy and scouted armour; at least 1 | 5 — `combat`, `balance`, `garrison` | Fully implemented |
| `medic` | none | — | Stationary healing of one wounded infantry unit at a time | 1 after 4 riflemen exist | 2 — `repair-medic`, `production` | Fully implemented |
| `tank` | 120 mm: 60 dmg, 7.5 range, 2.5 s, 86 %, 0.9 splash | heavy ×1.85; infantry ×0.4; air 0 | Rotating turret (2.4 rad/s) | Weighted by strategy and scouted mix; at least 1 | 17 — `combat`, `balance`, `production`, `ai` | Fully implemented |
| `recon` | 25 mm autocannon: 9 dmg, 5.5 range, 0.35 s, 74 % | air ×0.75; light ×1.1; heavy ×0.32 | Anti-air capable; best vision of any land unit (12.5) | 1 when the enemy base is known, 3 when it is not | 2 — `ai`, `balance` | Fully implemented |
| `aa` | Short-range SAM: 50 dmg, 10.5 range, 3.6 s, 92 % | air ×1.65; cannot hit ground | Anti-air only; rotates turret | 1–3, only after hostile air is scouted | 2 — `air-naval`, `ai` | Fully implemented |
| `harvester` | none | — | Automated ore mining and refinery delivery; 300 capacity | Per refinery, by difficulty (2/3/5 at one refinery) | 9 — `infrastructure`, `ai`, `production` | Fully implemented |
| `fighter` | Precision strike missile: 58 dmg, 9 range, 4.5 s, 90 % | structure ×1.45; heavy ×1.35; air 0 | 4 missiles, 80 s fuel, home radius 8, auto-return, rearm/refuel at airfield | 1 if an airfield exists | 4 — `air-naval`, `ai`, `balance` | Fully implemented |
| `corvette` | Anti-ship missile: 62 dmg, 15 range, 6.5 s, 88 %; 76 mm gun: 17 dmg, 9 range, 0.8 s | naval ×1.5 / ×1.1; structure ×1.3 | 6 missiles, home radius 7, reload/repair at shipyard, water-only navigation | 1 if a shipyard exists | 8 — `air-naval`, `ai`, `shipyard-facing` | Fully implemented |

### 4.3 Weapon reference

| Weapon | Damage | Range | Cooldown | Accuracy | Targets | Notable multipliers |
| --- | --- | --- | --- | --- | --- | --- |
| `rifle` | 7 | 6 | 0.9 | 0.82 | ground | infantry 1.45, heavy 0.12 |
| `autocannon` | 9 | 5.5 | 0.35 | 0.74 | ground, air | air 0.75, heavy 0.32 |
| `atgm` | 44 | 10 | 3.4 | 0.90 | ground, structure, naval | heavy 1.65, naval 1.25 |
| `tankGun` | 60 | 7.5 | 2.5 | 0.86 | ground, structure | heavy 1.85, infantry 0.40 |
| `samVehicle` | 50 | 10.5 | 3.6 | 0.92 | air | air 1.65 only |
| `heavyMg` | 6 | 7 | 0.22 | 0.78 | ground | infantry 1.90, heavy 0.06 |
| `atTurretGun` | 80 | 10.5 | 2.8 | 0.90 | ground, structure, naval | heavy 2.00 |
| `samBattery` | 58 | 12 | 3.2 | 0.94 | air | air 1.70 only |
| `strikeMissile` | 58 | 9 | 4.5 | 0.90 | ground, structure, naval | structure 1.45 |
| `navalMissile` | 62 | 15 | 6.5 | 0.88 | naval, ground, structure | naval 1.50 |
| `navalGun` | 17 | 9 | 0.8 | 0.82 | naval, ground, structure | light 1.20 |

### 4.4 Unit-level observations

- **No unit has a faction field.** Variants cannot be expressed without new definitions.
- **No aircraft can fight aircraft.** No airframe mounts an air-targeting weapon: every
  aircraft weapon has an air multiplier of 0. Only `samVehicle`, `samBattery` and
  `autocannon` can damage air, and all three are ground platforms.
- **No indirect-fire weapon exists.** Every weapon is direct-fire; `tankGun` and
  `strikeMissile` have splash but still require line of sight.
- **No transport capacity or passenger state exists** on `UnitDef` or `Entity`.
- **No unit repair mechanic exists.** Engineers repair structures (`OrderType 'repair'`
  targets structures); medics heal infantry; airfields and shipyards service their own
  domains. Vehicles and ships have no field recovery.
- **No veterancy, ammunition variants, mines, smoke or abilities** exist beyond the
  hard-coded air/naval service loops.
- **Two units are single-purpose specialists** (`aa` for air defence, `medic` for healing).
  Both are correctly implemented, but they are the only representatives of their roles.
- **Economy is faction-neutral.** Harvester capacity and refinery income are identical for
  both sides; there is no national logistics identity.

---

## 5. Complete building, upgrade and technology matrix

Twenty structures exist in `src/data/buildings.ts`. Eleven are player-buildable
(`BUILDABLE_BY_PLAYER`, `buildings.ts:414`); nine are authored-only. No structure has a
faction field or a faction restriction.

### 5.1 Player-buildable structures (11)

| ID | Role | Footprint | Cost M / R | Time | Power | Vision | Effect / production | Prerequisites | Test files |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `commandPost` | Headquarters, victory objective | 4×4 | 1400 / 0 | 34 s | +80 | 10 | Ends the match if destroyed; +0.4 req/s; +1 mat/s **only while the owner has no harvester**; can train an engineer while no operational factory exists | none | 12 |
| `barracks` | Infantry production | 3×3 | 520 / 0 | 15 s | −8 | 7 | `rifle`, `atgm`, `medic` | none | 9 |
| `factory` | Vehicle production | 4×3 | 840 / 0 | 20 s | −15 | 7 | `engineer`, `harvester`, `recon`, `aa`, `tank` | none | 6 |
| `refinery` | Material drop-off | 4×3 | 600 / 0 | 16 s | −10 | 7 | Harvester unload point; +0.1 req/s | none | 6 |
| `airfield` | Air production and recovery | 6×5 | 1250 / 120 | 26 s | −25 | 9 | `fighter`; rearms, refuels and repairs aircraft | `req` 120 | 6 |
| `shipyard` | Naval production and repair | 5×5 | 1050 / 150 | 28 s | −20 | 9 | `corvette`; reloads and repairs ships; slipway faces water | `req` 150, adjacent navigable water | 9 |
| `powerPlant` | Power generation | 3×3 | 480 / 0 | 16 s | +100 | 6 | Grid supply | none | 3 |
| `radar` | Detection / tactical map | 2×2 | 420 / 0 | 12 s | −12 | 15 | Keeps the minimap online while powered and unblanked | none | 4 |
| `samBattery` | Static air defence | 2×2 | 420 / 40 | 12 s | −20 | 11 | `samBattery` weapon: 58 dmg, 12 range, air only | `req` 40 | 3 |
| `mgNest` | Static anti-infantry | 2×2 | 260 / 0 | 9 s | −6 | 8 | `heavyMg`: 6 dmg, 7 range, infantry ×1.9 | none | 4 |
| `atTurret` | Static anti-armour | 2×2 | 430 / 30 | 13 s | −10 | 10 | `atTurretGun`: 80 dmg, 10.5 range, heavy ×2.0 | `req` 30 | 5 |

### 5.2 Authored-only structures (9)

| ID | Category | Footprint | HP | Vision | Effect | Ownership | Test files |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `relay` | Capturable objective | 2×2 | 850 | 9 | +1.1 req/s; capture-only, indestructible | Engineer capture | 10 |
| `supplyDepot` | Capturable objective | 3×3 | 900 | 7 | +2 mats/s; capture-only, indestructible | Engineer capture | 2 |
| `radarStation` | Capturable reconnaissance | 3×3 | 800 | 10 | `radar`, `scanRadius` 22 reveals hostiles through terrain masking; capturable **and** destructible | Engineer capture | 2 |
| `tenement` | Garrison strongpoint | 4×4 | 720 | 5 | 4 occupants, 55 % protection, 45 % exposure, 2 firing slots | Neutral / authored | 3 |
| `warehouse` | Garrison strongpoint | 5×4 | 640 | 5 | 4 occupants, 45 % protection, 55 % exposure, 2 slots | Neutral / authored | 1 |
| `officeBlock` | Garrison strongpoint | 4×5 | 680 | 7 | 5 occupants, 50 % protection, 50 % exposure, 3 slots | Neutral / authored | 1 |
| `civicHall` | Landmark strongpoint | 5×5 | 1500 | 8 | 6 occupants, 60 % protection, 40 % exposure, 3 slots | Neutral / authored | 1 |
| `foundryWorks` | Landmark strongpoint | 5×4 | 1600 | 6 | 5 occupants, 50 % protection, 50 % exposure, 2 slots | Neutral / authored | 1 |
| `ruin` | Garrison position | 3×3 | 420 | 4 | 2 occupants, 35 % protection, 70 % exposure, 1 slot | Neutral / authored | 2 |

Coverage note: the last four garrison structures are referenced by only one test file each, and
`warehouse`/`officeBlock`/`civicHall`/`foundryWorks` may only be exercised through map
validation or AI garrison tests rather than dedicated combat assertions. That is adequate for
a slice but thin for six factions that are supposed to differ in urban doctrine.

All twenty structures are fully implemented; none is a placeholder. AI support is uneven:

| AI behaviour | Structures |
| --- | --- |
| Builds during a match | `powerPlant`, `factory`, `refinery`, `barracks`, `mgNest`, `atTurret`, `airfield`, `shipyard`, `samBattery`, `radar` |
| Starts with, never rebuilds | `commandPost` (no construction entry in `ai.ts`) |
| Captures by engineer | Capturable objectives, weighted by value and scan radius |
| Garrisons | Any structure with a `garrison` definition, when infantry is nearby and the position is useful |
| Never uses | none |

### 5.3 Technology and upgrades

The technology matrix is empty. There is no research, upgrade unlock, prerequisite graph,
tech level, faction bonus or structure upgrade. The nearest mechanisms are:

- **Currency thresholds** (`Cost.req`) on ATGM, AA, fighter, corvette, airfield, shipyard,
  SAM battery and AT gun. These are affordability checks, not prerequisites.
- **Facility dependencies**: a fighter also needs an operational airfield; a corvette also
  needs an operational shipyard (`game.ts:1638-1650`).
- **HQ engineer fallback**: the Command Post can train an engineer only while no operational
  factory exists (`game.ts:1622-1636`).
- **Power grid**: a deficit slows construction and production; it is an economic constraint,
  not a tech tree.

This is the single largest architectural gap after factions themselves. Almost every national
identity a designer would want (better ammunition, reactive armour, networked sensors,
conscription, naval doctrine) needs an upgrade or modifier layer that does not exist.

### 5.4 Ownership categories (do not conflate)

| Category | Structures | Notes |
| --- | --- | --- |
| Player-buildable | `commandPost`, `barracks`, `factory`, `refinery`, `airfield`, `shipyard`, `powerPlant`, `radar`, `samBattery`, `mgNest`, `atTurret` | Same list for every player; placement gated by terrain, water, footprint and engineer presence only |
| Map-authored objectives | `relay`, `supplyDepot`, `radarStation` | Capturable; relay and depot are indestructible; radar station is destructible |
| Map-authored shelters | `tenement`, `warehouse`, `officeBlock`, `civicHall`, `foundryWorks`, `ruin` | Garrisonable by infantry; not capturable, not buildable |
| Scenario-only / victory | Command Post ownership | Destruction of the enemy HQ wins a `destroyHQ` match |

There is no faction-specific structure, no structure upgrade, and no capturable production
facility.

---

## 6. Faction selection and persistence audit

### 6.1 What the player can choose today

| Surface | What is selectable | Faction effect |
| --- | --- | --- |
| Intro / menu | Skirmish, Map Editor, Settings | none |
| Skirmish view | Theatre card (`mapId`), difficulty | none |
| Loading screen | Nothing (read-only brief) | none |
| Battle | Nothing | The map decides both factions |
| Editor | Terrain, starts, structures, units, objectives, settings | Player entries are fixed at two, with fixed names and factions |

`AppSettings` (`src/app.ts:46-60`) has `sfx`, `ambient`, `music`, `effects`, `shake`,
`fogVisual`, `edgePan`, `difficulty` and `mapId`. There is no `factionId`, `nationId`, `side`
or `opponentFactionId`, and no migration slot for one.

### 6.2 The match-setup path in detail

1. `App.showMenu` restores the selected `mapId`, paints cards and the brief.
2. `App.startBattle(scenario)` validates and launches `new Game(cloneScenario(scenario), {
   localPlayerId: 0, ... })` (`app.ts:742-776`). The scenario is not rewritten.
3. `Game.initialize` creates `PlayerState` from `ScenarioPlayer` (`game.ts:179-198`), so the
   human's faction is whatever the map authored for id 0.
4. Every built-in map authors id 0 as `baltic` and id 1 as `expeditionary`
   (`scenarios.ts:258-280`, `maps.ts:218-235`).
5. The AI receives player 1 via `AIController.update`'s `find(p => p.isAI...)`.
6. `restart()` clones the running scenario, so restart preserves the same factions.
7. `Game.fromSave` restores `PlayerState[]` and `localPlayerId` from the save, so a save
   already preserves whichever faction was authored. It cannot represent a post-hoc choice.

### 6.3 Persistence and compatibility

- `SaveData` (`src/sim/save.ts:42`) stores the full `scenario` plus serialized state; the
  scenario carries `players[].factionId`, and `PlayerState` also carries it.
- `parseScenario` validates every `factionId` against `FACTIONS` and fails on an unknown id
  (`scenario.ts:202-203`). Removing or renaming a faction id therefore **invalidates old
  saves and old map files** with no migration. Adding ids is safe.
- `MAP_FORMAT_VERSION` and `SAVE_FORMAT_VERSION` are both `1` (`constants.ts:10,12`). New
  faction fields (nation, variant, upgrades, research state) require a version bump and an
  explicit migration path, or old saves will silently lose the new data.
- Settings are stored under `iron-tide.settings.v1`; adding a nation selection needs a
  default for existing users (recommended: the current `baltic`/Lithuania mapping).

### 6.4 Gap between selection and simulation

| Capability | Present | Evidence |
| --- | --- | --- |
| Faction id reaches the simulation | Yes | `PlayerState.factionId`, `Game.initialize` |
| Faction affects available units | No | `productionStatus` has no faction term |
| Faction affects available buildings | No | `BUILDABLE_BY_PLAYER` is global |
| Faction affects upgrades/tech | No system | — |
| Faction affects starting force | No | Authored scenario only |
| Faction affects AI choices | No | `desiredUnits` is hard-coded |
| Faction affects editor palette | No | Editor lists every unit/structure |
| Faction affects scenario validation | No | Validation checks ownership and placement, not roster |
| Faction survives save/load | Id only | `toSave`/`fromSave` |
| Player can pick a faction | No | No UI, no settings field |
| Player can play the other side | No | `localPlayerId: 0`; no side swap |

A selection screen added today would pass items 1 and 9 and fail every other row. That is the
definition of a label-only faction system.

---

## 7. Intended launch faction structure

### 7.1 Canon from the GDD

The GDD §5.1 is explicit and is the only current source of nation canon:

| Side | Nation | GDD role | Currently represented? |
| --- | --- | --- | --- |
| Defender-aligned | **Lithuania** | Front-line defender in the opening Baltic crisis; local knowledge and defensive urgency | No. "Baltic Task Force" is described as Lithuanian-led but is a coalition label, not a nation |
| Defender-aligned | **Poland** | Major regional military actor; immediate intervention, substantial ground capability | No |
| Defender-aligned | **United Kingdom** | Expeditionary and specialist contribution, initially indirect and later more direct | No |
| Russia-aligned | **Russia** | Principal aggressor; broad conventional capabilities | No. "11th Expeditionary Corps" is a formation label |
| Russia-aligned | **Belarus** | Closely integrated with Russia; supports the eastern campaign | No |
| Russia-aligned | **Hungary** | Limited specialist involvement; politically significant, not an equal mass conventional force | No |

GDD §5.2: the six are the six **playable skirmish** nations; the campaign may feature other
nations as support, intelligence, neutral or reluctant actors. GDD §5.3: shared capability
foundation with substantial national specialisations; asymmetrical in character, balanced in
skirmish. GDD §5.4: readable roles, with national detail rewarding familiarity and colour not
carrying team identity alone.

Campaign-only nations should not get full skirmish rosters at launch. Recommended treatment:
they reuse an alliance baseline for AI/scripted appearances, with a named commander and
briefing identity, and are not offered in the skirmish selector. This keeps the playable six
as the only rosters that need completeness and matchup testing.

The GDD also warns (§5.3) that exact national rosters and bonuses should follow the shared
unit-role matrix and core combat model. That matrix has never been written. Section 8 is the
first version of it.

### 7.2 Two layers, not six independent armies

Recommended model:

1. **Alliance layer** — two sides, each with a shared baseline roster, shared structures and
   shared economy rules. This is where the current roster belongs.
2. **Nation layer** — six nations, each declaring one alliance and inheriting the baseline,
   then adding 2–3 national units or substitutions, 1–2 national upgrades or mechanics, and
   at most one national structure/production difference.

This gives designers a manageable content budget (one baseline plus 12–18 national entries)
and keeps matchups learnable. Six wholly independent armies would multiply every balance and
AI problem by six before the core roster is even complete.

Keep the existing `baltic` and `expeditionary` ids as **alliance-level presets**. Existing
maps, saves and tests use them; deleting them would break compatibility for no design gain.
New nation ids resolve to an alliance and inherit its baseline. A map may keep an alliance
preset ("coalition task force") or name a nation.

### 7.3 Provisional nation framework (recommendation, not canon)

Everything in this table beyond the nation names and sides is a **proposal**. It is constrained
to the mechanics that already exist or that section 8 recommends adding; it is not a GDD
commitment.

| Nation | Alliance | Proposed identity | Baseline access | National entries (provisional) | Mechanic / upgrade | Deliberate limitation |
| --- | --- | --- | --- | --- | --- | --- |
| Lithuania | Defender | Defensive infantry, local knowledge, concealment | Full baseline | Home Guard rifle variant (cheaper, lower HP); long-range ATGM team; forward observer vehicle | Prepared positions: cheaper/faster static defences and engineer construction | No heavy MBT variant; weaker naval branch |
| Poland | Defender | Armoured manoeuvre and mechanised infantry | Full baseline | Heavy MBT variant; IFV/APC; self-propelled artillery | Autoloader or improved fire control (reload/accuracy) | Costlier air branch |
| United Kingdom | Defender | Expeditionary air and naval reach | Full baseline | Strike fighter variant (more missiles/range); naval variant; reconnaissance UAV | Carrier/expeditionary support: faster aircraft turnaround and naval repair | Expensive armour; smaller army ceiling |
| Russia | Eastern | Layered air defence and heavy armour | Full baseline | Heavy MBT; long-range SAM vehicle; self-propelled artillery | Integrated air defence: SAM range/accuracy or shared detection | Slower, costlier economy |
| Belarus | Eastern | Mass infantry and mechanised support | Full baseline | Cheaper rifle variant; APC/IFV; mortar team | Mobilisation: infantry build time or population cap | No heavy MBT; limited air |
| Hungary | Eastern | Niche specialist contingent | Full baseline | Recon variant; ATGM variant; support vehicle | Civil-defence/expeditionary support: cheaper recon and repairs | **No heavy MBT variant and no naval upgrade**; narrow national additions, per GDD's limited-role constraint |

If a lighter-weight alternative is preferred, drop the national *units* and express identity
through 2–3 national upgrades on shared platforms. That is cheaper to build and balance, but
it is less visible on the battlefield and harder for a new player to read.

### 7.4 What "shared baseline" must include

The baseline has to be a complete combined-arms army before nations can specialise. Today it
is not (section 8). The minimum baseline contract should be:

- One line infantry, one anti-armour infantry, one support infantry.
- One main battle tank and one light/recon vehicle.
- One mechanised transport or IFV (currently absent).
- One mobile and one static air-defence system (present).
- One indirect-fire system (currently absent).
- One static anti-tank and one static anti-infantry emplacement (present).
- One engineer, one economy hauler, one recovery/repair capability (partially present).
- One strike aircraft and one air-superiority/interceptor (the latter absent).
- One naval combatant, with anti-ship reach (present, single hull).
- One reconnaissance aviation asset (absent).
- One capturable economy objective and one capturable sensor objective (present).

---

## 8. Combined-arms capability and counter gap analysis

### 8.1 Role coverage

Status is relative to a launch combined-arms RTS, not to the old vertical slice. Every provider
listed below is available to **both** current factions, and would be alliance-baseline content
shared by all six nations; no role is nation-exclusive today. National entries would add
variants or substitutes, not replace the baseline contract.

| # | Role | Current provider(s) | Countered by | Status |
| --- | --- | --- | --- | --- |
| 1 | Rifle infantry | `rifle` | MG nest, autocannon, tanks, artillery (absent) | Covered |
| 2 | Specialist infantry | `atgm`, `medic` | Rifles, suppression, armour | Partial — no MG team, grenadier, man-portable SAM, sniper or combat engineer infantry |
| 3 | Anti-armour infantry | `atgm` | Rifles, suppression, indirect fire | Covered |
| 4 | Reconnaissance and scouting | `recon`, `radar`, `radarStation` | Autocannon, SAM, fighters | Covered (ground) |
| 5 | Engineers and capture/logistics | `engineer` | Anything armed; unarmed | Covered |
| 6 | Main battle tanks | `tank` | ATGM, AT gun, tanks, strike missiles | Covered |
| 7 | Light/recon vehicles | `recon` | Autocannon, rifles, ATGM | Covered |
| 8 | IFV/APC and transport | — | — | **Missing** |
| 9 | Mobile air defence | `aa` | Anti-tank, tanks, aircraft | Covered |
| 10 | Static air defence | `samBattery` | Artillery, tanks, strike missiles | Covered |
| 11 | Field artillery / long-range fires | — | — | **Missing** |
| 12 | Anti-tank weapons and tank destroyers | `atgm`, `atTurret` | Infantry, indirect fire | Partial — no dedicated tank destroyer or ATGM vehicle |
| 13 | Mortars / short-range indirect fire | — | — | **Missing** |
| 14 | Supply, repair, recovery, transport | `engineer` (structures), airfield, shipyard, `medic` | — | Partial — no unit repair, recovery vehicle, supply truck or transport |
| 15 | Command, sensor and EW | `commandPost`, `radar`, `radarStation`, vision | Strike missiles, ATGM, tanks | Partial — no command vehicle, no EW/jamming, no shared sensor network |
| 16 | Attack helicopters | — | — | **Missing** |
| 17 | Air superiority / interceptors | — | — | **Missing** |
| 18 | Strike aircraft | `fighter` | SAM/AA only | Covered |
| 19 | Reconnaissance aviation / UAV | — | — | **Missing** |
| 20 | Airbase, rearming, fuel | `airfield` | Ground assault | Covered |
| 21 | Naval combatants | `corvette` | Corvettes, ATGM, AT gun, strike missiles | Partial — one hull, no screening or submarine role |
| 22 | Anti-ship capability | `corvette`, `atgm`, `atTurret`, `strikeMissile` | Air defence, submarines (absent) | Covered |
| 23 | Coastal defence | `atTurret`, `samBattery`, corvette | Artillery, naval missiles | Partial — no dedicated coastal battery or minefield |
| 24 | Defensive emplacements and fortifications | `mgNest`, `atTurret`, `samBattery` | Artillery, tanks, strike missiles | Covered (no walls/obstacles) |
| 25 | Garrison interactions | Six authored shelters, `rifle`/`atgm` | Anti-structure fire, being bypassed | Covered (authored maps only) |
| 26 | Late-game / high-tech layer | — | — | **Missing** |

Tally: **13 covered, 6 partial, 7 missing**.

### 8.2 Counter relationships that actually work

- **Armour versus infantry**: tanks dominate infantry in the open (rifle ×0.4 against heavy,
  tank gun ×1.85 against heavy); rifles and MG nests punish unsupported tanks.
- **Anti-armour versus armour**: ATGM teams outrange tanks and punish overextension; the
  static AT gun is a hard stop to a single MBT (`tests/balance.test.ts`).
- **Air versus ground**: strike missiles trade well into structures and heavy vehicles, but
  SAM/AA are lethal and ground weapons cannot answer aircraft.
- **Air defence versus air**: mobile SAM and static batteries are the only answer; scouting
  hostile air is what makes the AI build AA and SAM.
- **Naval versus shore**: corvette missiles outrange most shore weapons; ATGM, AT guns and
  strike missiles can still punish a close approach.
- **Garrison versus direct fire**: cover multiplies survivability; anti-structure fire and
  splash are the answer.
- **Economy versus raiding**: harvesters are unarmed and weakly protected; the HQ income
  backstop prevents a total dead end but not a collapse.

### 8.3 Counter and role gaps that will distort faction balance

1. **No indirect fire.** Static defences, garrisons and ridge lines can only be reduced by
   direct fire. Any nation given stronger static defences gains value that cannot be punished
   by the intended counter, so defensive national identities cannot be balanced yet.
2. **No air-to-air.** Air superiority is decided entirely by ground SAM. A nation with better
   aircraft cannot be answered in the air, and a nation with weak SAM loses its air branch
   outright.
3. **No transport.** Infantry nations cannot convert numerical advantage into map pressure,
   and mechanised nations (Poland, Belarus) have no mechanical identity to express.
4. **No recovery or supply.** Attrition is permanent for vehicles and ships outside their
   service structures. National logistics bonuses have nothing to modify.
5. **One naval hull.** Naval identity can only be expressed as a corvette stat tweak unless
   more hulls or shore defences arrive.
6. **No late-game tech.** Every match converges on the same five land units; national
   identities would be visible only in the opening minutes.
7. **Redundancy is low.** No unit is currently redundant; the roster is thin rather than
   bloated. The problem is missing roles, not duplicated ones.
8. **The AI cannot express a faction.** It hard-codes `tank`, `atgm`, `rifle`, `recon`, `aa`,
   `medic`, `fighter`, `corvette` and the two static defences. A faction without one of those
   ids would simply under-produce, and its planner would retry the missing unit every think.

### 8.4 Data that exists but is not usable in a faction context

- `FactionDef.units` and `.buildings` — populated and ignored.
- `factionDef()` — exported and unused.
- `accent` — stored, never read.
- `blurb` — stored, never read.
- `waterStructure` — declared on `BuildingDef` and read only by placement validation
  (`scenario.ts:866,890`); no content uses it.
- `stabilised` — declared on `WeaponDef`, unused by content.

These are harmless today but should be either wired up or removed before the faction model is
frozen, so the model does not accumulate decorative fields that look authoritative.

---

## 9. AI and test infrastructure gap analysis

### 9.1 How the AI is built

| Concern | Implementation | Faction impact |
| --- | --- | --- |
| Controller | `AIController` (`src/sim/ai.ts:380+`), one shared instance created by `Game` (`game.ts:176`) | `update` drives only the first undefeated AI player (`ai.ts:394-398`); no faction input |
| Personality | Seeded `aiProfile` picks one of five strategies (`armour`, `infantry`, `air`, `economy`, `pressure`) and difficulty biases | Strategy is random per seed, not national doctrine |
| Difficulty | `DIFFICULTY_BIAS` changes reaction time, economy, response weight, army scale, reserve; never income or vision rules | Same for every faction |
| Economy | Harvester targets scale with refinery count and difficulty; refinery and power headroom scored | No national economy identity |
| Construction | Utility scoring of `powerPlant`, `factory`, `refinery`, `barracks`, defences, `airfield`, `shipyard`, `samBattery`, `radar` (`ai.ts:737-808`) | Hard-coded ids; no roster or tech query; never rebuilds a destroyed `commandPost` |
| Defence choice | `scoutedForceMix` → `defenceTargets` → `nextDefenceBuild` (`ai.ts:23-67`) | Hard-coded `atTurret`/`mgNest` |
| Production | `desiredUnits` hard-codes `engineer`, `harvester`, `recon`, `aa`, `fighter`, `corvette`, `medic`, `tank`, `atgm`, `rifle`; `manageProduction` asks `productionStatus` for a facility | A missing national id would be retried every think and that role would never be filled |
| Composition | `STRATEGY_ARMY` weights blended with `armyWeights(scouted mix)` and `responseWeight` | No national preference, no variant choice |
| Air/naval | One fighter if an airfield exists; one corvette if a shipyard exists | No national air or naval doctrine |
| Objectives | Captures relays/depots/radar stations by value (`ai.ts:1200-1220`) | Faction-neutral |
| Garrison | Uses authored shelters when useful | No urban-doctrine differences |

**Key risk:** `desiredUnits` filters nothing by availability. If a faction cannot build `tank`,
`manageProduction` walks past it to the next deficit, so the commander does not hard-stall —
but it re-derives and re-tests the unavailable entry every think, and the missing role is
never substituted. A faction without one of the hard-coded ids would silently under-produce
and never field that arm. Gating must be accompanied by a roster-aware `desiredUnits` (skip
unavailable entries and score national substitutes).

### 9.2 Determinism and content registration

- Fixed 20 Hz step, seeded RNG, command queue and state hash are already covered.
- Definitions are static module constants. Adding ids does not consume RNG, so it does not
  perturb determinism by itself.
- AI tie-breaks sort by `defId` (`ai.ts:1092-1094`), and production queues iterate entity order;
  new content must keep those sorts explicit or replays will diverge across content versions.
- Save compatibility is the sharper risk: unknown unit/building/faction ids fail parsing, and
  both format versions are still `1`.
- There is no netcode, no lockstep transport and no remote-player state. Determinism is a
  foundation for future multiplayer, not evidence that faction content is multiplayer-ready.

### 9.3 Existing tests that constrain faction work

| Area | Files | What they already protect |
| --- | --- | --- |
| Determinism and saves | `determinism-save.test.ts` | Same seed, batch-size invariance, round-trip hash, save restore |
| Production and construction | `production.test.ts`, `construction.test.ts`, `power.test.ts` | Queues, HQ engineer fallback, prerequisites by currency, brownout, placement |
| Combat and counters | `combat.test.ts`, `balance.test.ts`, `weapon-transform.test.ts`, `air-naval.test.ts` | Damage, armour multipliers, fog acquisition, turret facing, air/naval loops, SAM counters |
| Economy and objectives | `infrastructure.test.ts`, `relay.test.ts` | Harvesting, refineries, passive income, relay/depot/radar capture, save/load |
| Garrisons and support | `garrison.test.ts`, `repair-medic.test.ts` | Entry, capacity, protection, clearing, medic healing, engineer repair |
| Maps and editor | `maps.test.ts`, `scenario.test.ts`, `editor-layout.test.ts`, `shipyard-facing.test.ts`, `road-network.test.ts` | Symmetry, validation, serialization, editor layout, slipway facing, roads |
| AI | `ai.test.ts`, `ai-matchups.test.ts` | Construction recovery, air/naval production, difficulty ladder |
| Presentation/PWA | `presentation.test.ts`, `hud-layout.test.ts`, `thumbnails.test.ts`, `pwa.test.ts`, `first-paint.test.ts`, `music.test.ts` | Menu copy, HUD layout, thumbnails, service worker, intro gate, music |

**No test asserts any faction behaviour.** The only faction reference is a relay caption test
(`tests/relay.test.ts:84`). There is no test that a faction's roster differs, that an off-
roster unit is rejected, that a nation choice survives a save, or that the AI can field a
national roster.

### 9.4 Test helpers that will interact with gating

`tests/helpers.ts` builds scenarios by pushing `scenario.units` directly. If roster validation
is added to `validateScenario`, hundreds of fixtures could fail even though the simulation
still works. Recommendation: enforce roster validity as a **scenario authoring error** only
for player-owned content in new maps, and keep direct unit injection legal in fixtures via an
internal bypass, or validate only ids that resolve to a faction with a declared roster. Decide
this in Phase 1 before writing tests.

### 9.5 Tests to add

1. **Registry contract** (`tests/factions.test.ts`): every faction/nation resolves; every unit
   and building id exists; every nation's roster contains one entry for each baseline role;
   no duplicate ids; deterministic resolution.
2. **Gating** (`tests/faction-gating.test.ts`): an off-roster unit is rejected by
   `productionStatus`; an off-roster building is rejected by placement; every roster entry is
   producible by a structure the faction can build.
3. **Selection** (`tests/match-setup.test.ts`): choosing a nation rewrites both players'
   faction ids, starting names and (if applicable) starting forces; the choice persists in
   settings; a save reopens with the same nations.
4. **AI** (`tests/ai.test.ts` extension): a faction with a missing role never retries it
   forever; an AI on a national roster produces at least one of each baseline role within a
   time budget.
5. **Save migration** (`tests/determinism-save.test.ts` extension): an old save with an
   alliance preset still loads; a new save round-trips nation and upgrade state; an unknown
   faction id fails with a clear message.
6. **Editor** (`tests/editor-layout.test.ts` or a new editor-content test): the palette is
   filtered by the selected player's nation, and assigning a nation is possible.
7. **Counter matrix** (new): for each role pair that is supposed to counter another, a seeded
   fight produces the expected winner within a bound; this is a mechanical-possibility test,
   not a balance target.
8. **Roster snapshot**: a checked-in expected matrix of nation × role × unit id, so accidental
   deletions or substitutions fail loudly.

---

## 10. Prioritised implementation roadmap

Dependencies are explicit. Each phase must leave the existing 342 tests passing (or update a
test only when the contract genuinely changed, with the reason recorded).

### Phase 1 — Faction content model and roster registry

**Why first:** every later phase reads this contract. A picker before this is a label.

- **Files:** `src/sim/types.ts` (new `AllianceDef`, `NationDef`, `RosterDef`, `VariantDef`;
  extend `FactionDef` or replace it with an alias), `src/data/factions.ts`,
  new `src/data/nations.ts`, new `src/data/roster.ts`, `src/sim/scenario.ts` (validation),
  `tests/factions.test.ts`, `tests/scenario.test.ts`.
- **Model decisions:** every unit/building variant is a **full definition with a unique id**
  registered in `UNITS`/`BUILDINGS`; a nation roster lists ids. This avoids touching combat,
  rendering, saving or AI lookup code, which all key on `defId`. Duplication is contained by
  data builders (`variantOf(base, overrides)`) rather than hand-copied objects.
- **Compatibility:** keep `baltic` and `expeditionary` as valid alliance presets. Add nation
  ids that resolve to them. Existing maps and saves keep loading.
- **Deliverables:** faction/nation registry with alliance membership; per-nation unit and
  building lists that are actually read; a `rosterFor(factionId)` resolver with memoization;
  integrity validation at module load or in a test; documentation of the contract.
- **Acceptance:** both current presets and six nations resolve; every roster id exists; every
  baseline role is present in both alliance baselines; no hard-coded faction ids outside data;
  `tsc` clean; new registry tests pass; existing tests untouched and green.
- **Tests:** unit — registry integrity, alliance inheritance, roster uniqueness, baseline role
  closure; regression — every existing unit/building id still resolves and every current map
  still parses; no browser test is needed at this phase.
- **Risks:** over-modelling. Resist adding per-nation stat fields before gating works; use
  full variant definitions instead of a modifier language until a second use case appears.
- **Exit gate:** a test can ask "what can Lithuania build?" and get a different, complete
  answer from "what can Russia build?" without any UI existing yet.

### Phase 2 — Roster gating through simulation, UI and AI

**Depends on:** Phase 1.

- **Files:** `src/sim/game.ts` (`productionStatus`, `placementStatus`/`commandPlaceBuilding`),
  `src/ui/hud.ts` (`buildMarkup`, production panel around line 1265), `src/sim/ai.ts`
  (`desiredUnits`, `manageProduction`, construction candidates), `src/ui/editor.ts` (palette
  filter only; full editor support is Phase 8), `tests/production.test.ts`,
  new `tests/faction-gating.test.ts`.
- **Deliverables:** the chosen faction determines production lists, build cards, placement
  legality and AI requests. Rejection reasons name the faction, not just the building.
- **Acceptance:** an off-roster unit/building is impossible for a player and for the AI; every
  on-roster entry has a producer the faction can build; the build menu shows exactly the
  roster; the AI never retries an unavailable id; all existing production/editor fixtures
  still pass.
- **Tests:** unit — production and placement gating, per-faction build-menu contents, AI
  availability filtering; integration — a seeded match where each side produces only its
  roster; regression — all production, construction, power and editor tests; browser — one
  manual/preview check that the build tab shows different cards for two factions.
- **Risks:** the AI's hard-coded planner needs a generic "role" fallback now, not later.
  Add a role tag to `UnitDef` (e.g. `role: 'infantry' | 'antiArmour' | ...`) and have the AI
  resolve ids from roles through the roster, so national variants work without new branches.
- **Exit gate:** swapping two factions' rosters changes what each side can produce in a real
  match, with no UI rewrite.

### Phase 3 — Match setup, nation selection and starting conditions

**Depends on:** Phase 1; benefits from Phase 2.

- **Files:** `index.html` (skirmish nation/side selector), `src/style.css`, `src/app.ts`
  (settings field, selection handler, `startBattle`, loading brief), `src/data/scenarios.ts`
  (default/alliance presets), `tests/match-setup.test.ts`, `tests/presentation.test.ts`.
- **Deliverables:** the Skirmish view offers six nations grouped by alliance, shows a one-line
  identity and the map's naval/air suitability; the choice rewrites player 0 (and optionally
  player 1) in a cloned scenario before `Game` construction; the loading screen names the
  nation and commander; the choice persists in settings; a "play as defender/eastern" side
  toggle is decided here (recommended: include it, because the symmetric maps make it cheap
  and the faction framework is meaningless if the player can only ever be one side).
- **Acceptance:** selecting each nation changes the starting roster and production options in
  a launched battle; restart preserves the choice; reloading the menu preserves it; a save
  reopens with it; keyboard, touch and narrow-landscape layouts are usable; the brief and
  loading screen agree with the selection.
- **Tests:** unit — applying a nation to a cloned scenario, settings persistence, side swap,
  save round-trip; integration — launch each nation and assert its roster reaches
  `productionStatus`; regression — existing map/brief/loading tests; browser — selector at
  desktop and 844×390 landscape, keyboard focus, touch targets and no portrait layout break.
- **Risks:** map compatibility. A landlocked theatre cannot support a naval branch; show a
  warning rather than silently removing units. Do not filter maps by faction unless the
  design wants hard compatibility.
- **Exit gate:** the player can launch the same map as at least two nations and observe
  different build menus without editing files.

### Phase 4 — Complete the shared alliance baseline roster

**Depends on:** Phases 1–2. Can run in parallel with Phase 3.

This is content plus mechanics, not polish. Recommended order by design value:

1. **Indirect fire** (mortar/SPG): new firing mode with minimum range, arcing projectile or
   area impact, no direct line-of-sight requirement, and counter-battery vulnerability.
2. **Mechanised transport / IFV**: passenger capacity, load/unload commands, transported
   infantry immunity while mounted, and a destruction rule for passengers.
3. **Air superiority / interceptor**: air-targeting weapon on an airframe, plus a reason for
   strike aircraft to need escort.
4. **Reconnaissance UAV**: cheap air unit with high vision, no weapon, fragile, used to spot
   for artillery.
5. **Recovery/repair vehicle or field repair**: restore vehicle HP at a material cost; gives
   logistics nations something to modify.
6. **Coastal defence / anti-ship battery**: static or towed anti-ship weapon for maps without
   shipyards.
7. **Attack helicopter** (optional for launch): a third air role; only if the air layer has
   room after interceptors and UAVs.
8. **Fortification/obstacle** (optional): a cheap engineer-placed obstacle or trench that
   interacts with the new indirect-fire layer.
- **Files:** `src/data/units.ts`, `src/data/weapons.ts`, `src/data/buildings.ts`,
  `src/sim/game.ts` (transport, indirect fire, repair, new orders), `src/sim/types.ts`
  (new order/state fields), `src/ui/hud.ts` and `src/ui/input.ts` (load/unload, new orders),
  render meshes/thumbnails, `src/sim/ai.ts` (use the new roles), tests for each mechanic.
- **Acceptance:** each new role is buildable, controllable, counterable and used by the AI in
  a real match; each has at least one focused test and one counter test; save/load round-trips
  the new state; existing air/naval/garrison systems still pass.
- **Tests:** unit — each mechanic in isolation (indirect-fire minimum range, transport
  capacity/load/unload/death, interceptor targeting, UAV vision, recovery cost); integration —
  a combined-arms match using every new role; regression — air/naval, garrison, pathfinding,
  determinism and save suites; browser — new order buttons and tooltips at desktop and mobile
  sizes; performance — entity count with transport passengers and artillery.
- **Risks:** this is the largest phase. Do not bundle it with nation content; a broken
  transport or indirect-fire mechanic would block all six factions.
- **Exit gate:** the baseline roster satisfies the contract in §7.4, with no nation selected.

### Phase 5 — Upgrade, prerequisite and research system

**Depends on:** Phases 1–2. Must precede national specialisations that use upgrades.

- **Files:** `src/sim/types.ts` (`UpgradeDef`, research state), new `src/data/upgrades.ts`,
  `src/sim/game.ts` (research queue, prerequisite checks, modifier application),
  `src/ui/hud.ts` (research/build tabs), `src/sim/ai.ts` (research priorities),
  `src/sim/save.ts` (research state), tests.
- **Deliverables:** upgrades with cost, time, prerequisites, faction restriction and an
  explicit effect (weapon/armour/speed/vision/cost modifier, or a new ability); at most one
  research structure per faction initially; upgrades visible in the HUD and used by the AI.
- **Acceptance:** an upgrade unlocks exactly its declared effect, cannot be bought twice or
  out of order; the AI buys it when its strategy calls for it; save/load restores it; the
  effect is deterministic and visible in the state hash.
- **Tests:** unit — prerequisite ordering, double-purchase rejection, each modifier type,
  faction restriction; integration — research queue under brownout and save/load; regression —
  determinism state hash and production costs; browser — research card state and affordability.
- **Risks:** modifier sprawl. Keep the first effect vocabulary small (weapon damage/cooldown,
  armour multiplier, vision, speed, cost) and test each one. Do not build a scripting language.
- **Exit gate:** a faction can buy one national upgrade and observe a measured change.

### Phase 6 — Six national specialisations

**Depends on:** Phases 4–5.

- **Files:** `src/data/nations.ts`, `src/data/units.ts`, `src/data/buildings.ts`,
  `src/data/weapons.ts`, `src/data/upgrades.ts`, `src/data/factions.ts`, the four map builders
  in `src/data/maps.ts`/`scenarios.ts` (default nations), tests.
- **Deliverables:** 2–3 national entries and 1–2 national upgrades per nation, following the
  provisional framework in §7.3 (or the user's chosen alternative); each nation's roster
  contract tested; each alliance baseline complete.
- **Acceptance:** every nation can field every baseline role; national entries have a clear
  counter and a clear cost; no nation is strictly better in every dimension; the roster
  snapshot is updated and reviewed; all six launch from every built-in map.
- **Tests:** unit — roster snapshot per nation, national entry production, upgrade effect;
  integration — each nation builds every baseline role and its national entries; regression —
  existing maps, saves and AI; browser — selection cards and build menus for all six; balance
  — record, do not yet assert, nation-pair results.
- **Risks:** content explosion and superficial differentiation. Reject any "national" entry
  that is only a renamed shared unit with a cost tweak unless it changes a decision.
- **Exit gate:** the six-nation matrix is complete and mechanically testable.

### Phase 7 — Faction-aware AI and matchup harness

**Depends on:** Phases 2, 4 and 6.

- **Files:** `src/sim/ai.ts`, `tests/ai.test.ts`, `tests/ai-matchups.test.ts`,
  `tools/ai-matchups.ts`.
- **Deliverables:** role-based unit resolution from the faction roster; national preferences
  (e.g. Russia values SAM, Poland values armour, Hungary values recon) expressed as weights,
  not hard-coded ids; AI construction filtered by its own building roster; AI research
  choices; matchup harness able to run nation-vs-nation and mirrored sides.
- **Acceptance:** every AI faction produces at least one of each baseline role inside a time
  budget; no AI retries an unavailable unit; the Recruit/Veteran/Elite ordering still holds
  when both sides use the same nation; faction-pair results are recorded, not asserted as
  balanced yet.
- **Tests:** unit — role-to-unit resolution per nation, no unavailable-id retries, national
  weight selection; integration — AI-vs-AI nation pairs over multiple seeds; regression — the
  existing Recruit/Veteran/Elite ladder and construction-recovery tests; performance — AI think
  time with six rosters loaded.
- **Risks:** difficulty tuning and faction strength become entangled. Keep difficulty biases
  separate from national modifiers and test them separately.
- **Exit gate:** an AI-controlled Lithuania and an AI-controlled Russia can complete a match
  with their own rosters and no missing-role stall.

### Phase 8 — Save/load, editor and scenario compatibility

**Continuous, with a final gate here.** Every schema change in Phases 1–6 touches this.

- **Files:** `src/sim/constants.ts` (format versions), `src/sim/save.ts`, `src/sim/scenario.ts`,
  `src/ui/editor.ts`, built-in map data, `tests/determinism-save.test.ts`,
  `tests/scenario.test.ts`, `tests/editor-layout.test.ts`.
- **Deliverables:** explicit migration for old saves and maps; nation assignment in the
  editor; palette filtered by the selected player's nation; scenario validation that names
  the faction when an off-roster unit is authored; map format documentation.
- **Acceptance:** a save written before the faction work still loads into the new build; a
  new save round-trips nations and upgrades; an editor map can assign nations to both players
  and validate them; old maps open without edits.
- **Tests:** unit — parser acceptance/rejection, migration of an old save and map fixture,
  editor nation assignment and palette filter; integration — load every built-in map and a
  pre-faction save; regression — determinism-save and scenario suites; browser — editor
  inspector and palette at desktop and mobile sizes.
- **Risks:** silent data loss. Version the save and scenario formats before the first schema
  change, and fail loudly with a migration message rather than dropping fields.

### Phase 9 — Player-facing presentation and production UX

**Depends on:** Phases 3 and 6.

- **Files:** `src/ui/hud.ts`, `src/ui/thumbnails.ts`, `src/ui/icons.ts`,
  `src/render/renderer.ts`, `src/ui/mapPreview.ts`, `src/style.css`, intro/menu markup.
- **Deliverables:** nation badge/flag treatment that does not rely on colour alone; distinct
  silhouettes or markings for national variants; build cards and tooltips with national
  identity; briefing copy; loading-screen identity; a roster browser in the menu (optional).
- **Acceptance:** a player can identify nation and role from the HUD without opening a
  tooltip; colour-blind team identification still works; mobile landscape layout still passes
  its measurements.
- **Tests:** unit — identity markup and icon fallbacks; integration — brief, loading screen and
  build cards agree with the selected nation; regression — presentation, thumbnails, HUD layout,
  first paint, orientation and PWA tests; browser — desktop and 844×390 screenshots for visual
  review, plus a colour-blind spot check.
- **Risks:** art cost. Prefer palette/marking/role-icon differentiation over new meshes until
  the roster is stable.

### Phase 10 — Counter, matchup and balance gates

**Depends on:** Phases 4, 6 and 7.

- **Files:** `tests/balance.test.ts`, `tests/weapon-transform.test.ts`, new counter-matrix
  tests, `tests/ai-matchups.test.ts`, `tools/ai-matchups.ts`, `docs/VERIFICATION_REPORT.md`
  (verification log only; this audit does not edit it).
- **Deliverables:** a mechanical counter matrix; faction-pair matchup runs; cost/TTK snapshot;
  a documented balance baseline.
- **Acceptance:** every intended counter works at least once in a seeded test; no faction has
  a structural auto-win; AI can use every role; difficulty ordering still holds.
- **Tests:** unit — one seeded counter pair per role; integration — mirrored nation-pair AI
  matches over multiple seeds; regression — the existing balance, combat and matchup suites;
  performance — heavy artillery/air matches stay inside the tick budget.
- **Risks:** treating current numbers as final. Record them as a baseline, not a target.

### Roadmap summary

| Phase | Depends on | Can run in parallel with |
| --- | --- | --- |
| 1 — model + registry | — | — |
| 2 — gating | 1 | — |
| 3 — selection | 1, ideally 2 | 4 |
| 4 — baseline roster | 1, 2 | 3 |
| 5 — upgrades | 1, 2 | 4 |
| 6 — national specialisations | 4, 5 | 7 (after 2) |
| 7 — faction-aware AI | 2, 4, 6 | 9 (after 3, 6) |
| 8 — save/editor compatibility | continuous | every phase |
| 9 — presentation/UX | 3, 6 | 7 |
| 10 — counter matrix + balance | 4, 6, 7 | — |

Phase 8 is not a late clean-up: version the save/scenario schema before Phase 1 lands and
add migration tests with each change. The final Phase 8 gate runs before Phase 10 begins.

---

## 11. Balance strategy: validate now, tune later

### 11.1 Invariants to validate before any roster tuning

| Invariant | Existing evidence | Action |
| --- | --- | --- |
| Damage and armour resolve consistently | `combat.test.ts`, `weapon-transform.test.ts`, `balance.test.ts` | Extend to every new armour/weapon pair; keep multiplier tests mechanical |
| Each intended counter is mechanically possible | partial (`balance.test.ts`, `air-naval.test.ts`) | Build a role-pair counter matrix; one seeded test per pair |
| Production and prerequisites are correct | `production.test.ts`, `power.test.ts` | Add faction gating and roster-closure assertions |
| Resource income and spend behave correctly | `infrastructure.test.ts`, sim-core | Add national economy modifiers only after the baseline is frozen |
| Units navigate, attack and accept orders | `sim-core`, `pathfinding`, `air-naval`, `shipyard-facing` | Re-run for every new role; transport and indirect fire need new path/order tests |
| AI can build, deploy and use every essential role | `ai.test.ts`, `ai-matchups.test.ts` | Add per-faction role-completion test |
| Faction content loads deterministically and survives save/load | `determinism-save.test.ts` | Add nation/upgrade round-trip and old-save migration |
| Garrisons, objectives, radar, aircraft, naval, logistics remain compatible | `garrison`, `relay`, `infrastructure`, `air-naval`, `repair-medic` | Run the full suite after each phase; no phase may skip it |

### 11.2 Deferred until the roster freezes

- Final unit costs and build times.
- Final HP, damage, armour and accuracy across the complete roster.
- National strength and win-rate targets.
- AI composition weights and build-order tuning per nation.
- Long-match economic and tech pacing.
- Map-specific faction matchups (naval maps favour naval nations by design).
- Final attack-wave sizes and difficulty deltas across factions.

### 11.3 How to keep current baselines without mistaking them for targets

1. Record the current AI ladder and the tank/AT-gun TTK as a **regression sentinel** in the
   verification log. A future run that breaks the sentinel is a signal, not automatically a
   bug.
2. Separate architecture tests from balance tests. Architecture tests assert "this counter is
   possible"; balance tests assert a margin. Only the first should block a content merge.
3. Keep the mirrored AI matchup harness, but run it nation-vs-same-nation until all six
   rosters are complete. Cross-nation margins before that point measure missing content, not
   faction strength.
4. Freeze the baseline roster contract (§7.4) before adding national modifiers; otherwise a
   missing role will be mistaken for a national weakness.
5. Snapshot costs and TTK in a checked-in table (not prose) when Phase 4 ends, and diff it
   deliberately in review.

---

## 12. Open design questions requiring a decision

1. **Is the skirmish choice a nation or an alliance?** The GDD says six playable nations;
   the current data model is alliance-shaped. Recommendation: choose the nation, derive the
   alliance, and keep the two alliance presets for old maps.
2. **Can the player choose the side?** Every map currently makes the human the western
   defender. Symmetric maps make a side toggle cheap; without it half the nations are only
   playable as the AI. Recommendation: add the toggle in Phase 3.
3. **Is Hungary a full 1v1 nation or a deliberately narrow specialist?** GDD §5.1 says
   limited involvement. Recommendation: playable with the full baseline so it is never locked
   out of a domain, but without a heavy-MBT variant or a naval upgrade, and with stronger
   recon/infantry; document the limitation in the selection card.
4. **Are the current `baltic`/`expeditionary` labels kept?** Recommendation: keep them as
   alliance presets; do not rename existing ids, to avoid breaking saves and maps.
5. **What are the alliance names?** The GDD only says "defender-aligned" and
   "Russia-aligned". Recommendation: use descriptive working labels (e.g. Defender
   Coalition / Eastern Coalition) until narrative naming is approved; do not invent canon in
   code comments.
6. **Which missing roles are launch-critical?** Recommendation: indirect fire, transport/IFV,
   air superiority, recon UAV, recovery, coastal defence. Attack helicopters and obstacles can
   follow if schedule allows.
7. **Do all six nations share one baseline, or does each alliance get its own baseline?**
   Recommendation: one shared baseline first; alliance-level differences are a second lever
   and multiply the balance surface.
8. **Upgrades: shared plus national, or national-only?** Recommendation: a small shared
   upgrade set for the baseline, plus one national upgrade per nation, so the tech system is
   exercised even before national content lands.
9. **Should the AI be allowed to play any nation?** Recommendation: yes; it should select the
   opposing nation (or mirror the player's) and use that roster. This is also the cheapest
   source of matchup data.
10. **Will skirmish ever be team-based (3v3 nations)?** Recommendation: no for launch. Vision,
    fog and AI state are hard-coded to two teams; that is a separate architecture project.

---

## 13. Documentation inconsistencies and stale claims

| Document | Claim | Reality | Severity |
| --- | --- | --- | --- |
| `README.md:26,215` | "325 Vitest tests" / "325 tests across 32 files" | 342 tests in 34 files on this tree | Low (stale count) |
| `README.md:241` | "no ... six-nation roster" | Accurate today, but the strategic direction now prioritises completing it; the limitation should become a roadmap pointer | Medium |
| `docs/PLAN.md:97` | "§5 Six nations — Seam only ... data-driven ids" | The ids are data; the roster lists are unread and both factions are identical. "Seam" overstates readiness | High |
| `docs/PLAN.md:287` | "Two factions, one AI opponent. Six nations are a data seam, not slice" | Still true of the code, but conflicts with the new goal of completing factions before balance | Medium |
| `docs/PLAN.md` §9.1 | "Land roster — Done" | Done for the vertical slice (7 land units), not for a launch combined-arms roster; missing IFV, artillery, recovery, etc. | Medium |
| `docs/NEXT_PHASE_PLAN.md:22,29` | Suite is "22 test files / 207 tests", while the header note says "24 files / 234 tests" | Both stale and internally inconsistent; 34 files / 342 tests now. Also names HUD-11 as the next mandatory task after later front-end work has landed | High (stale plan) |
| `docs/NEXT_PHASE_PLAN.md:161,195` | Six-nation roster, campaign and multiplayer are out of scope | Superseded by the new faction-first direction; needs a dated revision | High |
| `docs/DESIGN_SPEC_RECONCILIATION.md:82,99` | R-08: keep the slice small; no six-nation roster | A reasonable decision for the slice, now superseded. Leaving it unqualified will cause the next agent to refuse the work | High |
| GDD §16.6 | Complete launch rosters for all six nations are out of scope for the first slice | Correct for the slice; the project is now at GDD Phase 5 ("expand unit roles and national specialisations") and the GDD itself schedules that work | Informational |
| GDD §17 Phase 5 | "Expand unit roles and national specialisations" | Never entered; the project has been polishing the slice instead | Informational |
| GDD §5.1 vs `factions.ts` | Six launch nations | Only two coalition labels exist; no nation records, no alliance mapping | High |
| GDD §5.3 | National rosters should follow a shared unit-role matrix | That matrix was never written; §8 of this audit is its first draft | Medium |
| GDD §8/§9 | Transport, indirect fire, logistics and varied air roles are expected role categories | None exist in data or simulation | High |
| `docs/VERIFICATION_REPORT.md:2865` | "...not the campaign or six-nation rosters" | Historically accurate; the statement should not be read as a current scope decision | Low |

No source comments were found that assert a faction system exists; the code is honest about being
a two-faction slice. The stale claims are in planning and summary documents, not in the
simulation.

Implemented-but-undocumented features: none material were found. The intro, Irontide beat, PWA,
music, four theatres, urban garrisons, capturable infrastructure and fog memory are all
described in `README.md` or `docs/PLAN.md`. The drift is in counts, scope decisions and roster
completeness, not in hidden functionality.

Documented-but-unimplemented features: transport, indirect fire, electronic warfare, weather
effects, campaign, multiplayer and modding are all described in the GDD. Most are explicitly
long-term or optional there, so they are gaps rather than contradictions — except transport
and indirect fire, which the GDD lists among the role categories a shared roster should cover
(§8.1) and which the baseline currently lacks.

---

## Appendix A — Evidence and verification performed

Commands (read-only):

```
npx tsc --noEmit                 # clean
npx vitest run                   # 34 files / 342 tests passed, 72.29 s
grep -rlw <unit-or-building-id> tests/*.ts   # per-definition test reference inventory
```

Not run: `npm run build` (writes `dist/`; out of scope for this report), browser/preview
sessions, `npm run bench`, physical-device checks. No dependency installation was needed.

Primary files read for this audit:

- `Modern_Combined_Arms_RTS_GDD_v0.1.md` — §5, §8–§9, §16–§17, §19.
- `README.md`, `docs/PLAN.md`, `docs/NEXT_PHASE_PLAN.md`,
  `docs/DESIGN_SPEC_RECONCILIATION.md`, `docs/VERIFICATION_REPORT.md` (references only),
  `docs/AUDIT_FINDINGS.md` (references only).
- `src/data/units.ts`, `weapons.ts`, `buildings.ts`, `factions.ts`, `scenarios.ts`, `maps.ts`.
- `src/sim/types.ts`, `game.ts`, `scenario.ts`, `save.ts`, `ai.ts`, `constants.ts`.
- `src/app.ts`, `src/ui/hud.ts`, `editor.ts`, `overlay.ts`, `relayMeter.ts`,
  `src/render/renderer.ts`.
- `tests/` inventory and the production, combat, air-naval, balance, infrastructure,
  garrison, relay, scenario, determinism-save, ai and ai-matchups suites.

## Appendix B — Counts used in this report

| Item | Count | Source |
| --- | --- | --- |
| Units | 10 | `UNIT_LIST` |
| Weapons | 11 | `WEAPONS` keys |
| Structures | 20 | `BUILDING_LIST` |
| Player-buildable structures | 11 | `BUILDABLE_BY_PLAYER` |
| Authored-only structures | 9 | `authoredOnly: true` |
| Faction records | 2 | `FACTIONS` |
| Nations | 0 | no nation type or data |
| Upgrades | 0 | no upgrade system |
| Built-in theatres | 4 | `BUILTIN_SCENARIOS` |
| Test files / tests | 34 / 342 | `npx vitest run` |
| Role coverage | 13 covered / 6 partial / 7 missing | §8.1 |

## Appendix C — Recommended first implementation prompt

> Implement Phase 1 of `docs/FACTION_ROSTER_AUDIT.md`: add the faction/nation content model and
> roster registry, keep `baltic` and `expeditionary` as alliance presets, expand the six launch
> nations as data with shared baselines, and add registry-contract tests. Do not add UI,
> upgrades or national units yet; do not change existing map or save behaviour. Finish with
> `tsc --noEmit` and the full test suite green.

Do not start this phase until explicitly asked.
