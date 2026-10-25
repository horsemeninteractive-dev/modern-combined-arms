# MCA: Modern Combined Arms — implementation plan and verification record

Status: vertical slice implemented and verified against the supplied GDD
(`Modern_Combined_Arms_RTS_GDD_v0.1.md`). This is a chronological
implementation log, not the current acceptance record. For the 2026-10-24
working-tree state and remaining defects, read
[`AUDIT_FINDINGS.md`](AUDIT_FINDINGS.md) §7,
[`VERIFICATION_REPORT.md`](VERIFICATION_REPORT.md) §28 and
[`NEXT_PHASE_PLAN.md`](NEXT_PHASE_PLAN.md) first; earlier test counts and status
claims below are historical. Change Set 1 (the desktop/mobile HUD structural
shell) is implemented; its evidence is in §13 and
[`VERIFICATION_REPORT.md`](VERIFICATION_REPORT.md) §10. Change Set 2
(reference-style production thumbnails and selected-asset portraits) is
implemented; its evidence is in §14. This document records the starting
assessment, architecture, the GDD requirements matrix, milestones, measurements,
verification evidence, deliberate deviations and the remaining work.

---

## 1. Repository assessment (before implementation)

| Item | Finding |
| --- | --- |
| Starting contents | Only the GDD. No source, package manifest, tooling, tests, assets or history to preserve. |
| Framework | None. Chosen: TypeScript 5.7 + Vite 8, no runtime framework or game engine. |
| Baseline checks | Not applicable: no scripts or tests existed. `node`/`npm` present. |
| Rendering | None. Chosen per GDD §3.2: custom WebGL2, Canvas2D for overlay/minimap/HUD. |
| Platforms | Web-first; desktop and landscape mobile browsers. |
| Simulation | None. Built from scratch as an authoritative, fixed-step, seeded simulation. |
| Existing editor | None. Built with the same scenario format and map rules as battle. |
| Gaps vs GDD | Everything; see the matrix below. |
| Principal risks | Custom-renderer time sink; naval/ground pathfinding on one tile map; determinism drift from iteration order or frame timing; mobile HUD density; scope across three domains. |

The repository was greenfield, so the foundation was established directly rather
than adapting existing systems. No working functionality was replaced.

---

## 2. Architecture

```
ui / input ──commands──▶ Game (sim) ──events──▶ HUD, overlay, audio
     ▲                      │
     └──── reads state ─────┘
renderer ── reads state + interpolation ──▶ WebGL2
editor ── writes Scenario ──validate──▶ startBattle(Scenario)
```

### Layers and contracts

- **Scenario** (`src/sim/scenario.ts`): versioned authored data — dimensions,
  tiles (`terrain`, `elevation`, `ore`), players/starts, structures, units,
  objectives, settings. Parsed and validated at the boundary; invalid data
  raises `ScenarioFormatError` or validation errors, never silent bad state.
- **Map** (`src/sim/map.ts`): runtime arrays derived from the scenario (terrain,
  elevation, ore, occupancy/blocked, fog, vision).
- **Game** (`src/sim/game.ts`): authoritative state — players, entities,
  projectiles, events, RNG state, contacts, AI control, victory. Public API:
  `enqueueCommand`, `tick`, `advance`, `toSave`, `fromSave`, `stateHash`.
- **Commands** (`src/sim/types.ts`): `move` (with attack-move flag), `attack`,
  `stop`, `hold`, `stance`, `return`, `capture`, `produce`,
  `cancelProduction`, `placeBuilding`, `setRally`. Player and AI use this one
  model; the AI cannot mutate entities directly.
- **Combat** (`src/sim/combat.ts`): weapon/target compatibility, range, line of
  sight, armour, ammunition, suppression.
- **Pathfinding** (`src/sim/pathfinding.ts`): per-move-class A* over tiles with
  shared blocked grid, plus reachability flood fill for editor previews.
- **AI** (`src/sim/ai.ts`): economy, construction, production, defence, waves;
  reports `lastDecision`, `phase`, `attackWave` for diagnostics.
- **Save** (`src/sim/save.ts`): `iron-tide-save` v1 with scenario, full runtime
  state, RNG state, fog, contacts, player stats; version mismatch is rejected.
- **Renderer** (`src/render/`): WebGL2 programs for mesh/terrain/water/props/
  particles; procedural unit and building meshes; camera with zoom, shake,
  edge pan; fog and shore textures.
- **UI** (`src/ui/`): HUD, modal system, drag-box/minimap overlay, input
  controller (pointer, touch, gamepad), audio, editor and editor preview.

### Determinism and ordering

- Fixed 20 Hz tick (`TICK_RATE = 20`), independent of requestAnimationFrame.
- Renderer accumulates frame time and interpolates presentation only.
- Seeded mulberry32 RNG; state persists `seed` and `rngState` in saves.
- Commands are queued and drained in submission order; entity lists are stable
  arrays, not hash iteration.
- Tests compare `stateHash()` after identical seeds/commands and across
  different `advance()` batch sizes.

---

## 3. GDD requirements → implementation matrix

| GDD area | Status | Where / notes |
| --- | --- | --- |
| §3.2 Custom WebGL renderer | Done | `src/render/*`; six programs, procedural meshes, water, shore, fog, particles. |
| §3.3 Performance philosophy | Measured | See §6; provisional 50 ms tick budget, measured 0.2–9.5 ms. |
| §4 Setting/narrative | Slice only | Fictional Baltic task force vs 11th Expeditionary Corps; no campaign. |
| §5 Six nations | Seam only | `src/data/factions.ts` defines Baltic + Expeditionary; data-driven ids. |
| §7 Skirmish loop | Done | Economy → production → combat → victory/defeat, restart. |
| §7.2 Skirmish AI | Stage 1 | Economy, facilities, ground/air/AA production, defence, waves; same rules. |
| §7.3 Victory conditions | Partial | `destroyHQ` and `annihilation` in data/validation; scenario uses destroyHQ + relays objective. |
| §8.1 Orders/responsiveness | Done | Context orders, attack-move, stop/hold, capture, return, formation spacing, failure events. |
| §8.2 Combat | Done | Weapon compatibility, range/LOS, armour, reload, ammo, suppression, projectiles. |
| §8.3 Suppression/morale | Partial | Suppression affects speed and is shown; no morale rout. |
| §8.4 Recon/fog | Done | Per-team fog, vision stamps, contacts, visibility checks, fog rendering. |
| §8.5 EW/air defence | Partial | SAM/AA hard counters; no jamming/EW. |
| §8.6 Terrain/movement | Done | Move classes, elevations, roads, forests, rocks, water, chokepoint ridge. |
| §8.7 Infrastructure/destruction | Done | Structures have footprints, HP, construction, destruction, capture relays. |
| §8.8 Weather/time | Data only | Settings stored (clear/overcast/rain, time of day); no gameplay effect yet. |
| §9.1 Land roster | Done | Engineer, rifle, ATGM, tank, recon, AA, harvester. |
| §9.2 Aircraft | Done | Controllable fighter, fuel/ammo, airfield recovery/rearm, SAM/AA counters. |
| §9.3 Naval | Done | Corvette, water pathfinding, missiles/gun, shipyard reload/repair, shore role. |
| §9.4 Cross-domain | Done | Naval bay approach, air strikes over SAM coverage, ground ridge/relay fight. |
| §10 Economy | Done | Materials + requisition; deposits, passive income, relays, engineer construction, per-facility queues, overview. |
| §11 Map model | Done | Shared tile scenario, elevation, water, ore, starts, structures, units, metadata. |
| §11.3 Navigable water | Done | Water move class, shipyard validation, naval reachability preview. |
| §11.4 Scale | Deviation | 96×72 chosen to prove systems; large-map target deferred pending perf evidence. |
| §12 Editor | Done (initial) | Paint, raise/lower, ore, erase, starts, structures, units, objectives, validation, reach preview, save/load, deploy. |
| §13.1 Input parity | Partial | Mouse, touch and gamepad paths exist; gamepad untested on hardware. |
| §13.2 Selection/groups | Done | Click, shift-add, drag box, BOX control, control groups, group strip. |
| §13.4 Unit panel | Done | Persistent selection panel with role, HP, state, ammo/fuel, description, stances. |
| §13.5 Production UI | Done | Facility queues by domain, central overview, build tab, hotkeys, cancel. |
| §13.6 Alerts | Partial | Layered toasts, command acknowledgement, mode banner, world markers. The separate field-log panel was removed at product direction; there is no reviewable event history yet. |
| §13.7 Accessibility | Partial | Team colours plus text labels, high-contrast HUD, effects/shake/fog toggles; no subtitles (no speech). |
| §14 Audio | Implemented, unaudited | Procedural Web Audio SFX/ambience with volume settings. |
| §15 Save/determinism | Done | Versioned slots, strict load errors, repeated-run and batch-size tests. |
| §16 Slice content | Done | Island Assault, representative roster, editor-to-battle, full loop. |
| §17 Phases 0–4 | Done | Foundation, editor, land loop, air/naval, island slice. |
| §17 Phases 5–7 | Out of scope | Skirmish breadth/polish, campaign, release ecosystem. |
| Multiplayer/modding/store | Out of scope | Seams only (data-driven defs, stable serialisation). |

---

## 4. Milestones, dependencies, acceptance criteria

| # | Milestone | Depends on | Acceptance | State |
| --- | --- | --- | --- | --- |
| M0 | Foundation, fixed-step sim, RNG, map, commands | — | Typecheck, determinism test | Done |
| M1 | Scenario format, validation, shared rules | M0 | Parse/serialise round-trip, invalid data rejected | Done |
| M2 | Land loop: movement, combat, economy, production | M0–M1 | Full loop in tests and browser | Done |
| M3 | Air and naval domains | M2 | Takeoff/rearm, water pathing, counters | Done |
| M4 | Skirmish AI through command API | M2–M3 | Builds, produces, defends, attacks in tests | Done |
| M5 | WebGL2 renderer, HUD, input parity | M2 | 60 fps presentation, no sim coupling | Done |
| M6 | Editor with validation and deploy | M1, M5 | Authored map validates and launches | Done |
| M7 | Island Assault, save/load, victory/defeat, measurements | M2–M6 | End-to-end browser run + perf record | Done |

---

## 5. First-slice scenario and roster

**Kestrel Bay**, 96×72 tiles (384×288 world units, 4 units/tile), 48 % land /
52 % water.

- West: player beachhead — command post, refinery, barracks, airfield, shipyard,
  engineer, harvester, rifles, ATGM, tank, fighter, corvette.
- Centre: ridge with a single road pass; forested northern flank; village; two
  neutral signals relays that grant requisition when captured.
- East: AI base on a low plateau — command post, factory, barracks, refinery,
  shipyard, SAM battery, tanks, AA, ATGM, corvette.
- South: open sea and a bay that reaches the enemy coastal flank.

Roster (9 units): engineer (builds/captures), rifleman, ATGM gunner, main battle
tank, recon vehicle, AA vehicle, harvester, strike fighter, missile corvette.
Buildings (8): command post, barracks, factory, refinery, airfield, shipyard, SAM
battery, signals relay. All costs, times, weapons, armour and speeds live in
`src/data/`.

---

## 6. Determinism and performance

### Method

`tests/perf.test.ts` measures warm simulation cost on the authored scenario and
on a generated 171-entity stress battle (70 extra units per side, attack-moving
into contact), a 100-order pathfinding batch, save/load, and map composition.
Timings are wall-clock on the development machine (Windows, Node 22, Vitest,
Chromium); they vary with host load and are not framerate claims.

### Latest measurements (two runs, same build)

| Metric | Run A | Run B | Provisional target |
| --- | --- | --- | --- |
| Baseline tick, 31 entities incl. AI | 0.229 ms | 0.979 ms | < 5 ms |
| Stress tick, 171 entities in contact | 3.278 ms | 9.529 ms | < 25 ms (25 % of 50 ms tick) |
| 100-order attack-move path batch | 75.8 ms | 126.9 ms | < 400 ms one-off |
| Save serialise, 141 entities / 302 KiB | 6.3 ms | 6.7 ms | < 100 ms |
| Save restore | 9.6 ms | 20.0 ms | < 200 ms |
| Browser frame time | 16.5–16.7 ms (60 fps) | — | ≥ 50 fps desktop |
| Browser sim cost per frame | 0–0.3 ms | — | < 5 ms |
| Map | 3 347 land / 3 565 water tiles | — | both > 30 % |

At 20 Hz the tick budget is 50 ms; the 171-entity stress case used at most ~19 %
of it under load. The 96×72 map was chosen because these numbers leave headroom
for the large-map target rather than assuming it.

### Determinism evidence

- Identical seed + command sequence → identical `stateHash()` after 600 ticks.
- Same simulation advanced in 1-tick, 7-tick and 100-tick batches → identical hash.
- Save → restore mid-battle → identical tick, entities, resources and hash.
- Aircraft/ ship timers, RNG state, cooldowns and queues are part of save data.

---

## 7. Automated tests

`npm test` → **12 files, 78 tests, all passing** (latest run). Change Set 2
adds `tests/thumbnails.test.ts` (6 tests) for orthographic framing and cache
keys.

| File | Coverage |
| --- | --- |
| `tests/scenario.test.ts` (13) | Format parse/serialise, version rejection, validation (starts, HQ, water, terrain, ore, relays, victory feasibility), placement rules, island statistics |
| `tests/sim-core.test.ts` (10) | Startup, one minute autonomous stability, movement/blocked paths, orders, economy, production, save |
| `tests/combat.test.ts` (6) | Damage/destruction, structures, ammo, target classes, suppression |
| `tests/air-naval.test.ts` (8) | Parked start, takeoff/fuel/return/rearm, strike missions, SAM/AA counters, naval pathing and land rejection, ship combat, reload/repair |
| `tests/ai.test.ts` (2) | AI construction/production via shared rules; attack wave by 7 minutes |
| `tests/determinism-save.test.ts` (9) | Repeatability, batch invariance, exact save/load, corrupt/version rejection |
| `tests/debug.test.ts` (1) | Naval/contact diagnostics |
| `tests/camera.test.ts` (8) | 2:1 isometric projection, focus, vertical/horizontal HUD lift, rotated panning, map clamping |
| `tests/unit-scale.test.ts` (4) | Individual-infantry entity scale and selection/visibility rules |
| `tests/hud-layout.test.ts` (6) | Desktop/mobile boundary selection, coarse pointer, short window, panel exclusivity |
| `tests/thumbnails.test.ts` (6) | Orthographic framing fit/centring, portrait aspect, empty geometry, thumbnail cache-key separation |
| `tests/perf.test.ts` (5) | Measurements above |

Not covered automatically: browser input devices, audio output, visual pixels.

---

## 8. Browser verification (executed, not inferred)

Served with `npm run dev` (Vite, 127.0.0.1:5173), driven through the running
Chromium tab and the app's own public API.

- Menu → **Deploy Island Assault** → battle screen, 31 entities, HUD resources,
  objectives, production panels; no console errors.
- Selection of three units → panel shows “3 units”; move order moved the tank
  29 world units and reported “Moving”.
- Barracks production of a rifleman → 8 → 9 player units, cost deducted.
- Fighter starts parked (`landed: true`, fuel 80). Ordered to (200,140): reached
  (198.9, 139.6), fuel 76, `landed: false`. RETURN → landed and rearmed to fuel
  80 / 4 missiles. (This also caught and fixed aircraft being unable to leave
  their own airfield footprint.)
- Corvette moved from (38,170) to (127.6,218) over deep water (terrain 0); an
  inland order produced “No route to that location for the selected force.”
- Save slot 2: 256 595 bytes, tick 1196, 35 entities. Page reload → load slot 2
  → identical tick 1196, 35 entities, 3040 materials, HUD remounted.
- Editor: loaded Kestrel Bay (96×72, 13 structures, 18 units), validation
  “0 ERR · 0 WARN — Scenario is valid and ready to deploy”, DEPLOY launched a
  real 31-entity battle.
- Victory: enemy command post destroyed → “Island Secured” end screen with
  restart/save/editor/menu. Defeat: player command post destroyed → “Beachhead
  Lost”. Restart returns to a fresh battle.
- AI in-app after 60 s: 10 → 13 units, 6 structures, decision
  “massing 11/4 units at base”; automated 7-minute test reaches attack wave ≥ 1.
- Keyboard: `P` paused/resumed; `A` armed attack-move with mode banner; `S`
  stopped selected units. (Found and fixed `A`/`S` being swallowed by WASD pan.)
- Landscape-mobile viewport (844×390): no horizontal overflow; top bar 52 px,
  command bar and 142 px bottom deck fit inside the viewport with no horizontal
  overflow; minimap, selection and production panels all remain visible.
- 60 fps frame pacing with 0–0.3 ms simulation per frame at 31 entities.

### Defects found and fixed during verification

1. Water shader used `uEye` without declaring it → shader compile failure; then a
   duplicate declaration. Fixed in `src/render/shaders.ts`.
2. Starting fighter was marked airborne while parked, burning fuel on the pad.
   Fixed to start landed/grounded; tests updated to the intended spec.
3. Aircraft could not fly over their own airfield because building tiles counted
   as blocked; `canOccupy` now short-circuits for air movement.
4. Force readout showed `units / structures` (“8 / 5”), which read like a broken
   capacity. Now “8 units” with structures in the tooltip.
5. `A`/`S` orders were unreachable because WASD panning intercepted them. Arrow
   keys/edge/drag/wheel now pan; briefing updated.

---

## 9. Deliberate deviations and rationale

- **96×72 map, not the eventual large island.** The GDD asks to prove systems
  first and scale after measurement (§8, §16). Current tick cost leaves headroom;
  map size can grow without architectural change, but AI/pathfinding behaviour at
  larger scale has not yet been measured.
- **Camera pan uses arrows/edge/drag, not WASD.** The GDD advertises both WASD
  panning and A/S orders (§13.1). Commands win because they are essential and
  panning has several alternatives; the briefing was corrected.
- **Two factions, one AI opponent.** Six nations are a data seam, not slice
  content (§5, §16.6).
- **Weather/time-of-day stored but not simulated.** Kept as scenario fields to
  avoid unverified gameplay coupling in the slice.
- **No morale rout.** Suppression exists and affects movement; full morale is
  explicitly future work.
- **AI produces no corvettes.** It uses its starting corvette defensively; naval
  production strategy is deferred rather than faked.
- **HUD event delegation.** The HUD binds a single delegated click handler so a
  remount can never double-toggle a command.
- **True 2.5D isometric presentation.** The camera is orthographic with a 45° map
  yaw and a 30° pitch, producing a classic 2:1 diamond ground projection instead
  of the earlier north-up view. Screen-space panning follows the rotated axes.
- **No field log, no duplicated controls.** The event-log sidebar was removed and
  the separate touch button cluster and selection-panel order duplicates were
  deleted. One command bar serves mouse, touch and gamepad.
- **Single-soldier infantry.** The rifle unit is a Rifleman and the ATGM unit an
  ATGM Gunner, each rendered as one soldier, matching the reference RTS scale.

---

## 10. In scope / out of scope

**In:** authored island, editor + validation, land/air/naval simulation, economy,
production, AI, HUD/input (mouse, touch, gamepad code), save/load/restart,
victory/defeat, determinism and performance tests, WebGL presentation.

**Out (per GDD §13/§16.6):** full six-nation rosters, campaign and branching,
advanced naval/EW/logistics, component damage, general mission scripting,
multiplayer, mod SDK, community library, store packaging.

---

## 11. Known limitations and next milestone

- Gamepad mapping is implemented but untested on physical hardware.
- Audio is procedural and un-auditioned in automation.
- Renderer correctness is evidenced by live GL, shader compilation, draw cost and
  DOM state, not screenshot comparison.
- AI is a single-wave stage-1 opponent; it does not build a second attack group
  composition or produce naval units.
- Save storage is browser-local; no cloud/replay export yet.

**Next milestone (Phase 5):** scale the map and army counts, instrument AI and
pathfinding percentiles at larger scale, add the second AI attack composition
(including naval production), and then broaden skirmish options (map selection,
difficulty, factions) without changing the simulation contracts.

---

## 12. Revision — interface, isometric and infantry pass

Product feedback rejected the first presentation: the view was not a true 2.5D
isometric battlefield, the bottom deck and minimap could extend off screen, the
field log was unnecessary, controls were duplicated across three clusters, and
infantry were modelled and named as squads. The following was changed and
re-verified:

- **Isometric camera.** Orthographic 45° yaw / 30° pitch. Measured projection:
  +4 world units on X maps to `(+35, +17)` screen pixels and +4 on Z to
  `(-35, +17)` — equal mirrored axes with a 1:2 rise/run, i.e. true 2:1 diamond
  tiles. Focus and screen-to-ground picking still agree at screen centre.
- **Layout.** Removed the operation/field-log sidebar, the duplicated touch
  button cluster, and the order buttons inside the selection panel. Objectives
  and relay progress now live in the top bar. The bottom deck has an explicit
  `minmax(0, 1fr)` row and internal scrolling, so its panels can no longer
  overflow the viewport.
- **Measured layouts.** 1366×768: deck 184 px, minimap 158×168, all panels inside
  the viewport, no horizontal overflow. 844×390: deck 142 px, no overflow.
  640×360-class CSS: minimap 84 px, selection 308 px, production 299 px, all
  132 px tall and fully visible; the command bar sits above the deck.
- **Presentation.** Battle lighting switched to clear day; water palette raised
  for a brighter coastal read; production cards compacted so facilities and
  their units fit without clipping.
- **Infantry.** `Rifle Squad` → `Rifleman`, `ATGM Team` → `ATGM Gunner`; meshes
  rebuilt as one soldier each (the ATGM gunner carries a shoulder tube) and the
  rifle icon reduced to a single figure.
- **New regression tests.** `tests/camera.test.ts` covers the 2:1 projection,
  focus, rotated panning and map clamping. Suite is now 9 files / 59 tests.

Remaining known issue: the automated preview bridge occasionally dispatches a
pointer click twice (e.g. toggling pause twice); keyboard and single DOM clicks
were used to confirm the handlers themselves behave once per activation.

---

## 13. Revision — Change Set 1 HUD structural shell

Date: 2026-10-23. Scope: HUD structure only; no thumbnails, terrain, shader,
weapon, economy, naval or editor changes.

- **One shell, two compositions.** `src/ui/hudLayout.ts` selects desktop or mobile
  from CSS viewport width, viewport height and `(pointer: coarse)`. `HUD.mount`,
  `refreshLayout` and the update loop remain one state subscription. A breakpoint
  change rebuilds the shell, resets transient panels/Add mode and re-frames the
  camera; the delegated root click handler cannot accumulate listeners.
- **Desktop.** Compact 62 px top strip; persistent 348 px right sidebar with
  category rail, production queues and a tactical-map footer; compact bottom
  selection/command console to the left of the sidebar. Production appears only
  in the sidebar. The old 184 px full-width deck and unused `.side-panel` are gone.
- **Mobile landscape.** 46 px top strip with one-tap objective chip, 60 px right
  category rail, production sheet anchored to the rail, bottom 90 px selection and
  command area, objective/selection/groups sheets, collapsible tactical map fitted
  between top strip and command bar, safe-area padding on fixed edges. Production
  sheet closes on item selection, a second category tap or backdrop tap.
- **Touch accessibility.** Command, top-action, category, Add, group, stance and
  queue-cancel controls are authored at 44×44 CSS px or larger. An explicit sticky
  ADD toggle adds/removes tapped friendly units while a plain tap still replaces
  the selection and taps ground/enemy to order. Control groups assign and recall
  from the groups sheet without a keyboard. Empty and populated slots differ by
  dashed border/amber indicator and by aria-label.
- **Objective.** One visible primary-objective element per composition. On mobile
  the chip opens a details sheet; it is absent from no layout.
- **Camera framing.** `Camera.setScreenLift` now accepts a horizontal offset.
  `App.hudScreenFrame` derives the clear battlefield centre from the top strip,
  bottom console and right column. The opening base's structures project inside
  the clear rectangle at all four target viewports, and the primary-objective
  element is visible at all four.
- **Measured.** Clear battlefield 55.22% / 68.68% desktop at 1280×720 / 1920×1080;
  65.13% height & 60.53% area at 844×390; 63.89% height & 58.21% area at 667×375.
  No horizontal overflow and no overlapping visible control rectangles. Full
  numbers and commands are in the verification report.
- **Tests.** 11 files / 72 tests pass; `tsc --noEmit` and production build pass.
  New coverage: layout/panel selection and horizontal camera framing.
- **Reference styling.** The supplied `ss/` screenshots were reviewed against the
  shell: dark translucent slabs, thin light rules, amber active states, vertical
  right category rail, rail-anchored production sheet and a single bottom command
  band. Image-led production thumbnails in the references remain deferred to the
  next change set.

Deferred: production thumbnails, terrain-aware picking, construction-grid
visibility, weapon transforms/aiming, naval repair, economy replacement and
the mobile editor. The MOVE control remains the pre-existing help/cancel-mode
action rather than a dedicated move mode; ground-order and A-MOVE paths are
unchanged.

---

## 14. Revision — Change Set 2 HUD portraits and thumbnails

Date: 2026-10-23. Scope: production/build cards and the selected-asset portrait.
No simulation, input, economy, editor or battle-camera changes.

- **Shared art pipeline.** `src/render/thumbnails.ts` renders unit and building
  meshes in a second offscreen WebGL2 context using the same mesh shaders,
  lighting and team masks as the battlefield. `src/render/thumbnailFrame.ts`
  provides a pure orthographic three-quarter framing function and cache keys.
- **Cards.** Production cards use 4:3 art for every producible unit; BUILD cards
  use the same treatment for every buildable structure. Text, costs, hotkeys and
  disabled states remain in their existing order. Selected assets get a square
  portrait, with a count badge when a group is selected.
- **Fallbacks and caching.** Each image is cached by kind, definition, shape and
  team colour. On first battle start the 16 local unit/building card images and
  35 selectable portraits are pre-rendered synchronously while the loading screen
  is up, so neither the shell's first paint nor the first selection shows an icon
  fallback. The portrait set covers every unit and structure for each faction
  colour in the scenario, plus the neutral relay, so friendly, hostile and
  captured assets all have their own art (164 ms in the preview; 0 ms when the
  cache is already warm). Later card refreshes and cache misses queue after the
  current task and drain one image at a time through `canvas.toBlob`/object URLs,
  so they never block a HUD update. If WebGL2 or the offscreen context fails, the
  existing inline icons remain visible.
- **Verified.** `tsc --noEmit`, 12 files / 78 tests and the production build pass.
  Browser DOM checks in the desktop and mobile preview layouts confirmed 4
  production cards and 7 build cards with art, a 48 px selected portrait, group
  badge, and no console or network errors. Production art measures 118×88 CSS px
  at desktop (119×89 for structures), above the 96×72 reference floor; the mobile
  two-column sheet is larger still. A mutation probe around a fresh deployment
  found 0 art slots painted without art; the synchronous prewarm built 16 cards
  and 35 portraits with no failures in 164 ms on the first battle and 0 ms with a
  warm cache. Selecting each friendly unit, structure and neutral relay, plus a
  group, produced its portrait immediately with no queued renders, and every unit
  and structure portrait also exists for the opposing faction colour. Nine later
  cache misses queued in 0.2 ms and completed asynchronously in about 250 ms.
  Generated art was inspected for all 7 buildable structures and the rifleman,
  ATGM, fighter, tank and corvette.
- **Remaining.** Thumbnails are procedural low-poly renders, not authored art;
  the offscreen context count and object-URL lifetime have only been exercised
  in Chromium, and physical mobile performance was not measured.

---

## 15. Revision — Brand: MCA: Modern Combined Arms

Date: 2026-10-23. Scope: title, menu wordmark and in-game naming. No simulation,
input, layout or save-format changes.

- **Name and logo.** The game is titled **MCA: Modern Combined Arms**. The menu
  header now leads with a condensed, heavy **MCA** wordmark set in Bahnschrift
  with DIN Alternate / Roboto Condensed / Arial Narrow fallbacks, locked up with
  the stacked full name and the `COMBINED-ARMS COMMAND · 2037` tagline. The battle
  topbar uses the MCA plate and the full game name; the editor keeps its `SF`
  plate and now reads `SCENARIO FORGE` / `MCA AUTHORING`.
- **Copy.** Document title, menu footer, fatal-start copy, renderer error, save
  error, diagnostics heading, scenario author, README and plan headings use the
  new name.
- **Insignia and favicon.** `public/insignia.svg` is the MCA crest: a square
  amber-ruled plate on near-black carrying a condensed stencil **MCA** monogram
  drawn as paths (no font dependency), so the same artwork serves the menu
  lockup and the browser tab. The menu's old text mark is now that image at
  64–76 px (48 px on the compact breakpoint) with the stacked name beside it; the
  page declares it as the SVG favicon.
- **Top-bar crest.** The battle topbar and the editor topbar now show that same
  artwork at 30 px (26 px on the mobile breakpoint) through the shared
  `.brand-mark` rule, replacing the old `MCA` and `SF` text plates, so the menu
  lockup, the battle HUD and the editor all carry one insignia. Verified in
  Chromium: both `<img>` elements load `/insignia.svg` and render at 30 × 30 in
  the desktop layout and 26 × 26 beside a 34 px ident in the mobile layout, with
  no topbar overflow (`scrollWidth === clientWidth`), and the monogram still
  resolves M · C · A when rasterised at both sizes. The preview window was
  occluded, so the new top bars could not be screenshotted.
- **Compatibility.** Browser storage keys, the `iron-tide-scenario` and
  `iron-tide-save` formats and the `ironTide` development handle are unchanged,
  so existing saves and scenarios still load. `dist/insignia.svg` is copied from
  `public/` by the build.
- **Verified.** The MCA plate renders at 67 px in the desktop menu and 48 px at
  844×390, with the full name stacked beside it and no overlap with the build
  status or menu body; no horizontal overflow at either width. `tsc --noEmit`,
  13 files / 90 tests and the production build pass, and `/insignia.svg` is served
  as `image/svg+xml` (HTTP 200) with the host reporting it as the page favicon.
  Measured in Chromium; other platform font fallbacks and the browser's own tab
  chrome were not visually reviewed, and no PNG/ICO favicon is supplied.

---

## 16. Revision — Change Set 2: terrain-aware picking and grid visibility

Date: 2026-10-23. Scope: screen-to-world picking, terrain surface presentation and
construction-grid visibility. No simulation rules, economy, weapons, AI, naval
balance, map layout or HUD-structure changes.

### 16.1 Root causes confirmed in source

1. **Screen picking used a constant ground plane.** `worldAt` converted the pointer
   to a world point on one fixed height for the whole map, so any point over
   elevated ground resolved several world units too far down-screen. Move orders,
   attack-move destinations and building sites inherited that error.
2. **Terrain was drawn as one flat quad per tile at its quantized level.** Adjacent
   elevation levels met in a vertical step, so the map read as stacked plates
   instead of terrain, and the rendered surface did not exist as a queryable
   function at all. This is the mismatch behind the report that differing tile
   heights do not read as realistic terrain.
3. **The construction grid was unconditional.** `TERRAIN_FS` always dimmed cell
   edges, so ordinary play carried permanent grid clutter.

### 16.2 Elevation model (Red Alert 2 behaviour, continuous surface)

Elevation stays authored as an integer level per tile, exactly as the scenario
format and the editor already store it. One function turns those levels into the
rendered surface: `terrainCornerHeight` averages the up-to-four tiles meeting a
grid corner, and `terrainSurfaceHeight` interpolates the two triangles of the
tile. The result is the classic RTS read the user asked for — flat tops at a
level, a single tile-wide ramp band wherever levels change, and shore corners
that meet the fixed water plane instead of leaving a cliff gap — but with a
slope rather than a vertical wall at every level change. Nothing else may define
height:

- the terrain mesh (`buildTerrainGeometry`) emits those exact corner heights and
  smoothed normals, so shading falls off across a ramp;
- props (trees, rocks, ore), road decals, dust and projectile effects
  (`tileWorldHeight`) sit on the same surface;
- units, structures, selection rings, health bars and the placement ghost use it;
- the editor's tile grid, borders, reachability dots, brush preview and hover all
  project through it;
- `pickTerrain` ray-marches the same triangles, so clicking cannot disagree with
  what is drawn.

Water keeps its previous meaning: water tiles are never buildable, the water
surface stays at a single level (`WATER_LEVEL`), and picking reports `water: true`
for those hits so callers keep applying the existing rules.

### 16.3 Picking

`pickTerrain(scenario, ray)` clips the orthographic view ray to the map's XZ
rectangle and to the height band the map actually occupies, then walks cells in
Amanatides–Woo order and tests the two triangles of each candidate cell. Cost is
proportional to the cells a ray crosses, not to the tile count: no per-move
allocation of a height grid and no whole-map scan. A ray that starts above the
chosen height band and never meets the surface returns `null`; callers decline
the order rather than inventing a position. `App.worldAt` is the single battle
entry point for that, and `placementAtScreen` derives the build site from the
same hit, so the ghost and the submitted `placeBuilding` command cannot drift.

### 16.4 Grid visibility

`constructionGridVisible(screen, mode)` is the only rule: the shader grid is on
for `battle` in `place` mode and off everywhere else. The frame loop assigns the
result to `renderer.settings.grid`, which feeds `uGrid`; ordinary play, menus and
the attack/box/capture modes therefore render clean by default. Placement keeps
the guidance while the ghost, its footprint and the invalid-placement label stay
on top. The editor never used the shader grid; it draws its own surface-following
tile grid in the 2D overlay, which is unchanged and still available.

### 16.5 Tests

`tests/terrain-pick.test.ts` (12 tests) covers: flat ground, one-level and
multi-level ramps with continuity across a boundary, shoreline meeting the water
plane, round-trip projection→pick on flat ground and on both slope triangles,
panned and zoomed cameras, water-only maps returning the water plane, upward /
missing / degenerate rays returning `null`, boundary clamping, the full island
mesh matching the picking surface vertex-for-vertex, no vertical step facets, and
the grid-visibility rule.

### 16.6 Verified

```
$ npm run typecheck                     -> exit 0
$ npx vitest run     13 files, 90 tests passed -> exit 0
$ npm run build                        -> exit 0 (dist/index.html 4.41 kB,
                                          index.css 46.72 kB, index.js 282.51 kB)
$ npm run bench
  baseline 31 entities, 600 ticks   0.318 ms/tick   (Change Set 1: 0.286)
  stress 171 entities, 300 ticks    5.243 ms/tick   (Change Set 1: 4.842)
  pathfinding 100 orders            83.7 ms
  save/load 141 entities            6.2 ms / 9.4 ms, 302 KiB
  map                               3347 land / 3565 water tiles
```

No simulation file changed, so the benchmark differences are machine noise, not
a picking or rendering regression.

Browser checks in Chromium against the running dev server: `worldAt` round-tripped
six screen points back to their own pixels with 0.00 px error, resolving flat
base ground at y=1.15, ridge slope points at y=1.92, 2.47 and 2.697 (between the
authored 1.15/2.30/3.45 levels, so the ramp is real) and sea at y=0.12 with
`water: true`. With a Combat Engineer selected, placement reported the sloped
ground correctly, rejected ridge tiles (“Ridge cannot support this structure.”)
and sea tiles (“This structure cannot be built on water…”), and the grid turned
on for placement and off again in normal play. The editor was opened on Kestrel
Bay and a real pointer move over the rock plateau resolved tile (49,40) with the
“Rock · E2” readout while its own slope-following grid drew in the overlay.

Limitation: the preview window was intermittently occluded, so the frame loop
that derives `settings.grid` could only be observed after a drawn frame; screenshots
were taken in play and placement modes at desktop size only. Mobile re-measurement
was not part of this change set.

### 16.7 Known issues

- Simulation-side effect heights (`Game.heightAt`) remain quantized per tile;
  impact sparks and dust near a ramp can sit up to one half level off the drawn
  surface. They are cosmetic and are the only remaining consumer of the stepped
  height.
- Slopes do not slow movement and cliffs are still only blocked by terrain rules,
  not by steepness. Changing that is a simulation change and was out of scope.
- Extreme one-tile pillars would render as a tent rather than a cliff. The shipped
  map has no such feature; the editor can author one.

---

## 17. Revision — Change Set 3: weapon transforms and aiming

Date: 2026-10-24. Scope: turret mount geometry, muzzle origins and aim state.
No changes to damage, accuracy, cooldowns, ranges, targeting priorities,
projectile speed, economy, production or terrain.

### 17.1 Confirmed root causes

1. **Turret mounts rotated the wrong way.** `turretWorldMatrix` in
   `src/render/renderer.ts` transformed the hardpoint offset with
   `ox = x·cos(−f) − z·sin(−f)`, which is a rotation by **−facing**, while the
   body itself is drawn with a rotation by **+facing**. Only the corvette has a
   non-zero lateral offset in practice (`[4.7, 1.5, 0]`), so as the hull turned
   its bow gun swung to the mirrored side of the hull. Tank/recon/AA offsets are
   purely vertical, which is why the defect was not visible on land units.
2. **Muzzle origins ignored the turret and the weapon hardpoint.** `muzzlePoint`
   used `e.facing` plus `2 + radius · 0.8` for every unit, so a turret laid to
   the side still fired from the hull nose, and no unit fired from its barrel.
   The `shot` effect inherited the same point.
3. **Aim state only existed on the firing tick.** `turretFacing` was written
   only inside `tryFire` (and at spawn). Between shots it froze at the last
   bearing, and after a target died or an order was cleared it never returned to
   the hull heading. There was no traverse rate, no target tracking and no
   lifecycle cleanup for the aim target.
4. **Naval symptoms were the same two defects**, not a separate implementation:
   the corvette's turret sat on the wrong side once it turned, and its missiles
   and gun both left from the hull nose.

Already correct before this change: the body rotation convention (`modelFor`
with `-facing`), the renderer's angle interpolation across the ±π boundary
(`normalizeDiff`), and entity `facing`/`turretFacing` save serialisation.

### 17.2 Conventions (now stated in code)

- World `+X` is east and world `+Z` is south; a heading points along
  `(cos θ, sin θ)`; positive rotation turns east toward south. Radians at every
  boundary; degrees appear only in UI labels.
- Every unit mesh is built nose-forward on local `+X` with local `+Z` to its
  right. Local offsets are converted with `rotateLocalOffset(localX, localZ,
  heading)` in `src/core/math.ts`, the one shared transform used by renderer,
  simulation and tests.
- `facing` is the authoritative hull heading; `turretFacing` is the
  authoritative turret heading; `aimTargetId` is the entity the turret is laid
  on (presentation-facing combat state, cleared when that entity is gone).
  The renderer keeps its own interpolated angle for display only.

### 17.3 What changed

| File | Purpose |
| --- | --- |
| `src/core/math.ts` | Added `rotateLocalOffset`, the shared local-to-world offset rotation, with the convention documented. |
| `src/sim/types.ts` | Added `UnitDef.muzzle` (forward/lateral/height/turreted), `UnitDef.turretRate`, `Entity.aimTargetId`, and optional `SimEvent.y` for effect height. |
| `src/data/units.ts` | Authored hardpoints for every armed unit: rifle/ATGM fixed-forward, tank/recon/AA/corvette turreted, fighter nose rail; traverse rates 3.6/3.0/2.4/1.0 rad/s. |
| `src/sim/hardpoints.ts` (new) | `muzzleWorldOffset` / `muzzleHeight`: turns a hardpoint into a world offset using the turret heading for turreted weapons and the hull heading otherwise. |
| `src/sim/game.ts` | `muzzlePoint` now uses the authored hardpoint (buildings keep their centre origin); `tryFire` records the aim target and leaves the barrel exactly on bearing; new `updateTurret` traverses toward the aim target or back to the hull; aim state is cleared on stop/hold/target loss/cleanup; the `shot` event carries the real muzzle height. |
| `src/render/unitTransform.ts` (new) | `turretModelMatrix`: mount offset rotated by the hull heading with the shared helper, then the turret yawed by its own aim angle. |
| `src/render/renderer.ts` | Uses `turretModelMatrix` and the event's `y` for muzzle flashes. |
| `tests/weapon-transform.test.ts` (new) | 24 tests covering transforms, aiming, firing geometry, persistence and data integrity. |
| `README.md`, `docs/PLAN.md`, `docs/VERIFICATION_REPORT.md` | Test counts and this record. |

### 17.4 How the pieces now relate

A unit's body is drawn at `(x, z)` rotated by `facing`. The turret mount is the
authored style offset rotated by the **same** `facing`, then the turret yaws by
`turretFacing` about that mount. The simulation spawns shots at
`(x, z) + rotateLocalOffset(muzzle.forward, muzzle.lateral, turretFacing or
facing)` at `heightAt(x, z) + muzzle.height`, and `tryFire` has already set
`turretFacing` to the bearing of the target it is firing at. The rendered barrel
and the projectile origin therefore share one heading and one mount. Muzzle
flashes use the same `shot` event position, height included.

Aim behaviour: every tick a turreted unit turns its turret toward `aimTargetId`
at `turretRate`, or back toward the hull heading when there is no valid target.
Firing is never gated on alignment — that would change combat timing — so a shot
sets the turret exactly on bearing on its firing tick, and the renderer smooths
the visual angle to it.

### 17.5 Tests added

`tests/weapon-transform.test.ts`, 24 tests:

- **Transforms:** asymmetric offset `(3, 1)` at 0/90/180/270° and 45°; a
  non-mirroring bow-offset assertion; turret mount matrices at four headings;
  turret yaw about its mount rather than the hull origin.
- **Aiming:** ordered target bearings in four cardinal directions; short-way
  rotation across ±π; tracking while the hull turns; target switch to the other
  side; traverse limited to `turretRate`; stop and move orders clear aim; target
  death clears aim and returns to the hull heading.
- **Firing:** real firing path for tank rounds at four bearings with the spawn
  point recovered from the projectile's own flight line; turret laid away from
  the hull; fixed-forward rifle; hit shot flying at the target point with the
  event height matching the muzzle; save round-trip of turret and aim state.
- **Naval:** corvette mount on the bow for four headings and a real corvette
  shot from that hardpoint with the hull facing elsewhere.
- **Data integrity:** every turreted hardpoint has a traverse rate; every armed
  unit has a hardpoint and unarmed units do not.

### 17.6 Verified

```
$ npm run typecheck                    -> exit 0
$ npx vitest run   14 files, 114 tests passed -> exit 0
$ npm run build                        -> exit 0 (dist/assets/index-9HjyMEnM.js 283.61 kB)
$ npm run bench
  before: baseline 0.254 ms/tick | stress 4.529 ms/tick | pathfinding 82.7 ms
          save 6.7 / 10.6 ms | map 3347 land tiles
  after:  baseline 0.250–0.284 ms/tick | stress 4.79–5.16 ms/tick
          pathfinding 88.4 ms | save 6.5 / 10.3 ms, 304 KiB
```

Four after-change runs measured 0.284/4.974, 0.272/5.160, 0.250/4.808 and
0.255/4.794. Change Set 2's runs without simulation changes spanned
0.254–0.318 and 4.53–5.24, so the stress delta is inside this host's noise band
and the added work (one traverse calculation per turreted unit per tick) is in
the order of a few microseconds per tick.

Live browser checks (Chromium against the dev server): a paused battle had a
tank hull facing east with a target to the south; `turretFacing` reached 1.571
and the `shot` event was at `(x, 2.33, z + 2.2)` — ground 1.15 + barrel 1.18 —
i.e. the barrel tip, not the hull nose. With cooldown held it traversed
0.12 rad per tick (2.4 rad/s) and settled at 3.12 rad after the target crossed
to the west. A corvette with hull east firing at a target 0.695 rad away put
`turretFacing = 0.695` and its shot at `(+2.30, +1.92)` from the hull centre
(3.0 units along the turret) at height 0.9. The renderer's interpolated turret
angle equalled the authoritative angle. No console errors.

### 17.7 Limitations and open questions

- Muzzle flashes now use the simulation's muzzle height, but the visual preview
  window was intermittently occluded, so the close-up turret/barrel screenshots
  planned for four orientations could not be captured. The mount geometry,
  rendered angle and shot origins were verified numerically (unit tests plus the
  live state above); the barrel's pixel appearance was not re-reviewed.
- A shot snaps the turret exactly on bearing on its firing tick instead of
  waiting for the turret to traverse. Gating fire on alignment would delay
  shots, so firing rates are preserved and the renderer smooths the visual turn.
  This is the smallest correct compromise; a "wait for gun" rule would need its
  own balance pass.
- Buildings still fire from their centre at +3.5 units; they have no turret
  mesh or authored hardpoint. Changing that would need building-level weapon
  mounts, which the current building defs do not model.
- No unit carries two independent hardpoints (only one turret mesh each), so
  "multiple hardpoints on the same unit" is not exercised by content. The
  corvette's missile and gun share the same mount.
- Aircraft keep a fixed-forward nose rail and fly at a constant altitude; their
  shot height remains `AIRCRAFT_ALTITUDE` rather than a barrel offset.

---

## 18. Revision — HUD recomposition: left rail, typed production, selection roster

Date: 2026-10-24. Scope: the battle HUD only. No simulation, input, scenario,
save-format or balance changes.

- **Desktop rail.** The 62 px top bar is gone. A 92 px full-height rail on the
  left carries the crest and faction name, MATERIALS and REQUISITION with their
  rates, a POWER slot reading `— / OFFLINE`, ARMY with a structure count, the
  primary objective (click opens the briefing), mission time and the
  SAVE / PAUSE / SETUP / MENU actions. The rail is the only vertical chrome; the
  battlefield now spans rail to sidebar and the camera frames for that clear
  region.
- **Production panels.** OVERVIEW is removed. The rail is BASE, DEFENCE, LAND,
  AIR and SEA; `structureTab()` splits buildable structures by whether they
  carry weapons, so BASE sites infrastructure and DEFENCE sites the SAM battery,
  while LAND / AIR / SEA list only their own facilities. An empty panel names the
  panel to build from rather than showing a catch-all list.
- **Selection console.** The old console was a two-column grid with hard
  minimums (280 px + 540 px). Below roughly 1168 px of console width those
  minima overran the row, so the command/groups column sat on top of the
  selection panel. The console now spans rail to sidebar as a detail column plus
  a horizontal roster, with the command bar and control groups in their own
  38 px row. The roster shows one chip per selected entity (art, name, HP) and
  scrolls sideways; clicking a chip inspects that entity and clicking it again
  returns to the group summary. HP updates in place so a scrolled strip does not
  jump on every refresh.
- **Mobile.** The 44 px summary button that hid the selection behind a tap is
  replaced by an always-visible 46 px roster row (art, name, HP); tapping a chip
  opens the existing selection sheet for full stats. With nothing selected the
  console collapses to the 44 px command row, and the top strip is 42 px.
- **Power.** The game still has no power mechanic. The rail reserves the slot and
  labels it `OFFLINE`; no simulation value is read or written.
- **Camera.** `hudScreenFrame()` measures the rail, the mobile top strip and the
  production column and returns a signed horizontal offset; `Camera` keeps a
  negative horizontal lift instead of clamping it to zero, so a rail on the left
  is framed correctly.
- **Verified (Chromium, dev server).** `tsc --noEmit`, 14 files / 117 tests and
  the production build pass. At 1280×720 the rail is 92 px with no overflow
  (clock 594–637 px, actions to 720), the console is 840×168, the detail column
  393 px with 81 px of content in 81 px (no scroll), and the command bar is
  599/599 px with the control groups clear of it. At 1600×1000 five selected
  units show in one roster row and the framed base centre projects to the clear
  area's centre (592, 366). At 844×390 the chrome is 42 + 90 = 132 px with a
  selection and 42 + 44 = 86 px without; at 667×375 the document does not
  overflow and eight roster chips scroll (719 px of chips in 623 px).
- **Limitations.** The mobile and phone-size screenshots could not be captured
  because the preview window was occluded; those sizes were measured through the
  DOM instead. Hover, focus and touch-drag states of the new rail and roster were
  not reviewed visually. The power slot is presentational until a power system
  exists.

## 19. Revision — Base power grid and brownouts

Date: 2026-10-24. Scope: a first power mechanic behind the rail slot added in
section 18, plus its structure, mesh and HUD readout. No changes to combat,
economy rates, map generation or save format.

- **Grid model.** `BuildingDef.power` is net grid contribution: positive
  generates, negative draws, absent means zero. The Command Post carries an
  integral generator (80), refineries draw 10, barracks 8, factories 15,
  airfields 25, shipyards 20 and SAM batteries 20. `Game.powerStatus(owner)`
  sums the live, completed, owned structures into `{ supply, demand, ratio,
  brownout }`; it is derived on demand and never stored, so save files and
  hash comparisons are unchanged. Sites under construction and destroyed
  structures contribute nothing.
- **Brownouts.** `Game.powerSpeed(owner)` returns 1 when demand is covered and
  `supply / demand` otherwise, floored at 0.35 so a cut grid slows the base
  instead of freezing it. The multiplier is applied to construction progress
  and to production queue countdowns in `updateBuildingSystems`, evaluated once
  per owner per tick. It is deliberately not applied to combat, movement or
  harvesting.
- **Turbine Plant.** New `powerPlant` building: 3×3 footprint, 780 hp,
  480 materials, 16 s, +100 supply, hotkey P, BASE panel. Its generator hall,
  twin stacks and transformer yard are authored in `buildingMeshes.ts`, so the
  placement ghost, in-world model and production-card thumbnail all come from
  one mesh.
- **HUD.** The rail POWER slot now reads `supply / demand`, with `RESERVE n`,
  `NO DRAW` or `BROWNOUT · nn%` beneath it; a deficit adds a red rail
  background, red supply figure and a tooltip explaining the production and
  construction penalty. Mobile gains a `PWR` readout in the top strip.
- **AI.** The skirmish AI builds a turbine plant when its grid is in deficit,
  and seeds one early plant (after 30 s) so its growing base has headroom. It
  uses the same placement command and resource costs as the player.
- **Starting balance.** Player beachhead: 80 supply / 63 demand (17 reserve).
  Enemy base with its SAM battery: 80 / 73 (7 reserve). Adding a factory and a
  SAM battery tips the player into deficit until a plant is built.
- **Verified.** Typecheck, 15 files / 127 tests (10 new in `tests/power.test.ts`)
  and the production build pass; benchmark unchanged within the recorded band.
  In Chromium a turbine plant was sited through the production card and
  placement flow, taking the rail from `80 / 63 · RESERVE 17` to
  `180 / 63 · RESERVE 117`; a staged save with an extra factory and SAM battery
  loaded as `80 / 98 · BROWNOUT · 82%` with the deficit tooltip.
- **Limitations.** The brownout slowdown was measured in deterministic tests,
  not timed in the live browser. The mobile `PWR` readout and the plant's
  in-world model were not visually reviewed; no screenshots were taken in this
  change set.

## 20. Revision — low-power warning and plant suggestion

Date: 2026-10-24. Follow-up to section 19, simulation and HUD only.

- **Transition notices.** `Game` tracks the last announced grid state per owner
  in a private, non-serialised map. `updateGridNotices()` emits one `notice`
  (warning, "alert" sound) when a grid enters deficit — naming supply, demand
  and the resulting speed — and one success notice when it recovers. Transitions
  only, so a long brownout produces a single warning rather than a stream.
- **Production strip.** The production sidebar carries a low-power strip that
  appears only during a deficit: `GRID DEFICIT · 80 SUPPLY / 98 DEMAND ·
  PRODUCTION AT 82%` with a `BUILD PLANT` action. The copy comes from
  `gridAlertCopy()` in `hudLayout.ts`, so the HUD never formats power itself.
- **Mobile.** The top strip now carries MATS / REQ / PWR / ARMY (the PWR stat
  sits beside the army count rather than replacing it) and still fits 667 px.
  The strip lives inside the production sheet, so it is only in view when the
  player is choosing what to build.
- **Suggested structure.** While the grid is short, the Turbine Plant card is
  outlined in red and carries a `GRID FIX` badge. `BUILD PLANT` selects the BASE
  panel and starts placement mode without placing anything; if no Combat
  Engineer is selected the existing "select an engineer" warning is shown.
  On mobile the production sheet closes so the battlefield is tappable.
- **No new state.** The strip and badge are derived from `powerStatus()` each
  HUD tick; nothing about them enters the save file, the state hash or the
  simulation.
- **Verified.** Typecheck and build pass; 15 files / 129 tests (two new).
  In Chromium a brownout save showed the strip, its copy and the highlighted
  card; `BUILD PLANT` without a selected engineer produced the warning, and with
  the engineer selected it raised `PLACE TURBINE PLANT` without spending
  materials. A near-complete plant fixture cleared the strip on load
  (`180 / 98 · RESERVE 82`) and removed the card highlight.
- **Limitations.** The benchmark host was heavily loaded during this run, so the
  absolute tick numbers are elevated relative to section 19 and an A/B run with
  the notice pass disabled was slower still; no regression can be attributed to
  the change from these numbers. The full 16 s construction of a sited plant was
  not watched end-to-end in the browser (the preview's frame loop stalled once
  it was occluded), so completion was checked with a 97 %-complete fixture.

## 21. Revision — landing force, automatic builders, infantry grounding

Date: 2026-10-24. Playtest follow-up; supersedes the construction notes in
section 20 where they refer to selecting an engineer.

- **Opening forces.** `createIslandAssault()` now fields only a Command Post,
  one Combat Engineer, two MBTs and five riflemen per side. The factory,
  refinery, barracks, airfield, shipyard, power plant and harvester that used to
  be pre-placed are now built during play. Neutral relays remain authored.
- **Engineer dispatch.** `placeBuilding` no longer needs a builder id: the
  nearest idle engineer is assigned automatically, walks to the site and builds.
  `resolveBuilder()` will not take an engineer off another site, so with two
  engineers two positions progress at once and a third foundation waits. A
  player order releases the site (progress pauses) and the engineer is
  re-matched to the nearest unfinished site once free. Placement is rejected
  only when the player owns no engineer at all.
- **AI opening.** The skirmish AI builds factory → refinery → turbine plant (on
  deficit) → harvester → barracks. The "save for the next structure" branch no
  longer returns before defence, air and assault logic; without that, the
  trimmed base left the AI saving for a barracks forever with no income.
- **Infantry.** Riflemen and ATGM gunners use one soldier mesh with legs as a
  separate mesh hinged at the hip. The boot sole is at local Y = 0, so the
  soldier's origin sits on the terrain surface, and the renderer advances the
  walk cycle from movement state with out-of-phase leg swing.
- **Verified.** Typecheck and build pass; 16 files / 135 tests, including new
  construction-dispatch and infantry-grounding tests. Benchmark ranges recorded
  in `VERIFICATION_REPORT.md` section 16.4.
- **Not verified.** No browser visual pass in this change; grounding and gait
  are covered by geometry tests and render-path inspection.

## 22. Revision — engineer fallback, relay objectives, requisition scope

Date: 2026-10-24. Follow-up to section 21.

- **Engineer fallback.** `units.ts` adds `commandPost` to the engineer's
  producers and the Command Post exposes a one-card LAND production list. The
  HQ card is hidden and `productionStatus()` refuses HQ engineers while an
  operational Vehicle Factory exists; destroying the factory reopens the
  fallback on the next tick. A lost factory plus lost engineers is no longer a
  dead end.
- **Relays are capture-only.** `canWeaponTarget()` rejects relays, so auto-
  engagement and AI target selection skip them; `commandAttack()` emits a
  warning for explicit orders; `damageEntity()` discards all damage, including
  splash. Capture remains the only ownership change.
- **Relay meter.** `relayMeterState()` supplies owner label/colour and the
  furthest-along capturing engineer. The 2D overlay draws a persistent bar over
  each charted relay with the owner tint and the capturer's progress fill; the
  selection card uses the same caption. Enemy-owned relays respect fog.
- **Requisition.** Material-only: rifleman, engineer, harvester, MBT, Recon
  Vehicle, barracks, refinery, turbine plant and Vehicle Factory. Requisition-
  gated: ATGM team, SAM carrier, fighter, corvette, SAM battery, airfield and
  shipyard.
- **Verified.** Typecheck, 18 files / 147 tests, production build and benchmark
  pass; live browser check confirmed the HQ engineer card, a produced second
  engineer, relay attack rejection at full HP, and relay meters painting on the
  overlay. Details in `VERIFICATION_REPORT.md` section 17.
- **Not verified.** Relay meter legibility at all zooms and on mobile was not
  visually inspected; the factory-to-HQ panel hand-off was exercised by tests
  rather than in the browser.
## 23. Revision — selection detail fits without horizontal scrolling

Date: 2026-10-24. Follow-up to section 22.

- **Cause.** The desktop selection body used an `auto` first grid column with a
  `min-width:auto` `.sel-main`, so an enemy relay's nowrap faction/capture text
  made the column wider than the panel and produced a horizontal scrollbar.
- **Fix.** The grid is now `minmax(0, 1.35fr) minmax(0, 1fr)`; `.sel-main`
  shrinks; the body clips horizontal overflow; title and faction stack with
  ellipsis; the detail area takes 56 % of the selection panel (max 460 px), up
  from 48 %, and the roster keeps the remainder.
- **Relay card copy.** The role line shows the ownership/capture caption once
  instead of repeating `Capturable objective` in front of it.
- **Verified.** Typecheck, 147 tests and build pass. At 1270 px with an enemy
  relay at 36 % capture, the selection body and every descendant have no
  scrollable horizontal overflow; the same holds for a single MBT and at
  1100 px. Mobile layout is unaffected. Details in `VERIFICATION_REPORT.md`
  section 18.
- **Not verified.** No visual screenshot pass; long faction names can still
  ellipsize, but they no longer force a scrollbar.

## 24. Revision — support-engineer repair and field medics

Date: 2026-10-24. Playtest follow-up. Adds the two support behaviours that were
advertised in copy but missing from the simulation, and one new infantry unit.

- **Repair orders.** A right-click on a damaged friendly structure now routes
  selected Combat Engineers to a `repair` order. The engineer approaches the
  footprint edge, restores 3.5 % of maximum HP per second, and clears the order
  at full health. Any later move or explicit order releases the job, so calling
  an engineer away pauses repair just like construction. Construction sites,
  full structures and enemy structures are rejected.
- **Right-click relay routing.** The relay branch runs before the hostile
  branch: neutral and enemy-held relays both become capture orders whenever a
  Combat Engineer is selected. Previously only neutral relays did, so an
  enemy-held relay fell through to attack and was rejected. The rule lives in
  the pure `contextOrderFor()` helper; `App.orderAt()` consumes it.
- **Field Medic.** New barracks infantry: 160 materials, 7 s, hotkey `M`,
  unarmed, light infantry armour. While stationary with no active order it
  treats one friendly wounded infantryman within 5 tiles at 4 HP/s, choosing
  the lowest health fraction and then the nearest. Moving, receiving another
  order or losing the patient ends treatment; the medic then acquires a new
  patient. It cannot treat vehicles, structures or itself.
- **Presentation.** The medic uses the articulated infantry rig with a white
  helmet band and red-cross satchel, its own icon, visual scale and contact
  shadow. The production card and selection card therefore use the same
  procedural portrait path as other infantry.
- **Persistence.** `healTargetId` is authoritative state and is saved with the
  entity; older saves default it to 0. The existing order object carries repair
  assignments, so the save format version is unchanged.
- **Verified.** Typecheck, 20 files / 176 tests and the production build pass.
  In Chromium the real `App.orderAt()` dispatch created a repair order
  (311.85 HP restored over 80 ticks), routed an enemy-held relay to capture
  (owner changed, relay still 850/850), and a medic restored exactly 20 HP to
  one rifleman over 100 ticks. The LAND panel showed `MEDIC 160M` with rendered
  portrait art. Details in `VERIFICATION_REPORT.md` section 19.
- **Not verified.** No screenshot pass for the medic mesh or its red-cross
  satchel at gameplay zoom. Mobile has no direct tap-to-repair gesture; relay
  capture remains available through **CAPTURE**. The skirmish AI does not build
  medics or issue repair orders yet.

## 25. Revision — mobile repair command

Date: 2026-10-24. Closes the mobile gap recorded in section 24.

- **Repair mode.** The command bar now has a `REPAIR` button in both layouts.
  With a Combat Engineer selected, pressing it arms a target mode; tapping a
  damaged friendly structure issues the same `repair` order as the desktop
  right-click. The mobile command row is horizontally scrollable, and all 13
  buttons fit at 844×390 without scrolling.
- **Validation.** `setMode('repair')` refuses to arm without a selected
  engineer. The input path validates the picked entity with `isRepairTarget()`
  (friendly, building, alive, below maximum HP, completed) and rejects anything
  else with a warning. Successful dispatch leaves the mode.
- **Presentation.** Adds a wrench `repair` icon and the mode banner copy
  `REPAIR — select a damaged friendly structure`. `GridMode` accepts the new
  mode but construction grid visibility remains placement-only.
- **Verified.** Typecheck, 20 files / 177 tests and production build pass. In
  the 844×390 mobile layout the `REPAIR` button was visible in the command bar;
  clicking it with the engineer selected set `app.mode = 'repair'`, a simulated
  touch target over the damaged Command Post issued the repair order, and 80
  ticks restored 311.85 HP. Details in `VERIFICATION_REPORT.md` section 20.
- **Not verified.** No screenshot or visual pass of the mobile command row; the
  check measured DOM presence and exercised the live mode/tap path. AI support
  behaviour is unchanged.

## 26. Revision — HUD alignment, radar fidelity and cameo production

Date: 2026-10-24. Desktop and mobile presentation only; no simulation rules,
unit data or balance changed.

- **Bottom alignment and rail proportions.** The rail's mission/actions block
  and the production map dock now share `--selection-top-offset` equal to the
  full console height, so their top edge is flush with the bottom central
  console. The mission box is fixed at 44 px; the action pad fills the rest as
  a 2x2 grid, growing the save/pause/settings/menu buttons from 34 px to about
  54 px tall at 1270x720.
- **Minimap resolution.** The tactical canvas now has a device-pixel backing
  store (`minimapBackingSize`, minimum CSS density, capped at 2x) instead of a
  96x72 buffer stretched over the dock. Terrain renders once into an offscreen
  native raster, is smoothly upscaled, and markers, viewport and radar sweep
  are drawn at native device scale. The raster still fills the dock, so click
  mapping stays aligned with what is displayed.
- **Offline radar.** The dead feed now combines regenerated analogue grain at
  one-third resolution, a rolling interference band, scanlines, a vignette and
  a crisp device-pixel caption (`RADAR OFFLINE` plus the no-radar or brownout
  reason). It remains presentation-only and never touches simulation state.
- **Production cameo feedback.** Per-facility queue rows are gone. Every unit
  card keeps a radial conic wipe on its portrait, driven by a CSS custom
  property and advanced every HUD refresh. The queued count sits in a badge at
  the card's top-left; pressing the badge cancels and refunds one copy of that
  type. The queue head alone contributes progress, matching the simulation.
- **Verified.** Typecheck, 20 files / 181 tests and the production build pass.
  At 1270x720 the console, rail-bottom and map-dock tops all measured 552.01
  px; the mission box measured 44 px and action buttons 54.39 px. Offline grain
  changed 53.3% of canvas pixels between draws at a 279x155 backing store that
  matched its CSS size. A queued engineer showed badge `2` and a 16.7% radial
  wipe, then badge `1` and 41.7% after advancing the queue. Mobile 844x390 kept
  the badge at 24x22 with no horizontal overflow. Details in
  `VERIFICATION_REPORT.md` section 21.
- **Not verified.** No screenshot or visual regression pass. The online minimap
  was exercised by inserting a completed Radar Array directly rather than
  walking an engineer through construction. No physical touch-device test of
  the small cancel badge; the desktop and mobile DOM click paths were used.
  Benchmark ranges remain in the existing host-noise band.

## 27. Revision — drag-to-prioritise production

Date: 2026-10-24. Follow-up to section 26. Adds queue ordering control without
changing costs, build times, training rates or cancellation semantics.

- **Authoritative command.** `reorderProduction` moves every queued copy of one
  unit type ahead of the first copy of a target type (or to the tail when no
  target is supplied). Queue item objects keep their paid cost and `remaining`
  progress; the command never refunds or charges resources. Foreign facilities,
  absent targets and no-op moves are rejected.
- **Card drag.** Reorderable cameo cards show a dotted grip. Mouse drags may
  start anywhere on the card; touch drags must start on the grip so ordinary
  taps and panel scrolling still queue units. While dragging, the source card
  dims, the floating ghost names the type and count, and valid target cards gain
  an amber frame plus a `PRIORITY` banner. Dropping checks whether the dragged
  type is already ahead of the target; otherwise it issues the reorder and
  reports the move, or reports an `already ahead` notice.
- **Continuity.** Click events synthesised after a drag are suppressed so the
  drop cannot accidentally queue another unit or cancel a copy. HUD signatures
  now include queue order rather than only queue length, so the radial wipe
  follows the new training head after the command is processed. A production
  re-render during a drag safely cancels the drag instead of leaving a dangling
  ghost.
- **Unavailable cards.** A queued type remains enabled for reordering when
  materials or requisition are insufficient; it carries `unavailable` and
  `aria-disabled` styling while unqueued cards keep native `disabled`.
- **Verified.** Typecheck and production build pass. Test count is 20 files /
  183 tests. A live mouse drag on ENGINEER ×2 over MBT produced the ghost and
  target treatment, then changed the queue from `[tank, engineer, engineer]` to
  `[engineer, engineer, tank]`; the next HUD update moved the radial wipe to
  Engineer at 0.4%. An immediate click after the drop added no extra unit and
  left materials unchanged. Touch pointerdown on the card body was ignored,
  pointerdown on the grip armed the drag, and pointer-cancel cleaned up.
  Details in `VERIFICATION_REPORT.md` section 22.
- **Not verified.** No physical touch-device drag, no keyboard reorder path and
  no auto-scroll while dragging toward off-screen cards. Dragging a type moves
  all its queued copies together; selecting individual copies still requires
  cancel/requeue. A production completion mid-drag cancels that drag.

## 28. Revision — cameo sweep and harvester payload

Date: 2026-10-24. Follow-up to section 27. Corrects the production sweep's
start angle and update path, and raises a full harvester load without changing
mining rate, travel speed or unit costs.

- **Top-anchored sweep.** The cameo used `conic-gradient(from -90deg, …)`. CSS
  conic gradients place 0deg at 12 o'clock, so -90deg began the wipe at 9
  o'clock. The sweep now starts at 0deg and fills clockwise from the top.
- **Smooth progress.** `refreshProductionProgress` was inside the 110 ms HUD
  throttle, and it wrote `--p` to the card while the overlay carried its own
  inline `--p`. An element's own custom property overrides inheritance, so the
  visible sweep only moved when the whole production DOM re-rendered. Updates
  now target the overlay and run every animation frame. `--p` is registered as a
  `<percentage>` property with an 80 ms linear transition, bridging the 20 Hz
  simulation tick to a continuous sweep.
- **Harvester payload.** `HARVESTER_CAPACITY = 300` is now the single shared
  value, replacing the three hard-coded `100` limits in mining/full checks and
  the renderer's hopper fill. An authored ore tile also holds 300 material, so
  one full load clears one tile and is worth roughly a third of a 720-material
  main battle tank.
- **Verified.** Typecheck, 20 test files / 183 tests and the production build
  pass. The AI simulation reports `income:+300 materials` for a delivered full
  hopper. In a live Chromium sample, the old write path changed the visible
  sweep only twice in 91 frames with a 934 ms freeze between changes; after the
  fix it changed 87 times in 92 frames with a 17 ms median interval. The
  computed gradient starts `from 0deg`. Details in `VERIFICATION_REPORT.md`
  section 23.
- **Not verified.** No screenshot or visual review of the final sweep or the
  hopper mesh fill. The live sample was desktop Chromium only; mobile inherits
  the same CSS and HUD update path but was not sampled separately.

## 29. Revision — production drag edge auto-scroll

Date: 2026-10-24. Follow-up to sections 27 and 28. Closes the "no auto-scroll"
limitation without changing the reorder command or queue semantics.

- **Edge bands.** While a cameo drag is active, the production sheet scrolls when
  the pointer enters a 48 px band at its top or bottom. Speed ramps linearly
  from 0 at the inner boundary to 900 px/s at the edge, using elapsed animation
  time rather than a fixed jump per event. The pointer may drift up to 28 px
  outside the sheet horizontally and still scroll.
- **Continuous loop.** The drag now keeps its latest pointer position and runs a
  requestAnimationFrame scroll loop from activation until drop, cancellation,
  production re-render or HUD unmount. It does not depend on further
  `pointermove` events, so a stationary pointer at an edge keeps scrolling.
- **Moving targets.** After every scroll frame that actually moves the sheet,
  the drop target is recomputed from the pointer position. Cards sliding under
  a stationary pointer gain the normal amber target treatment and the ghost
  updates, so releasing immediately drops on the newly revealed card.
- **Shared maths and tests.** `edgeAutoScrollVelocity` in `hudLayout.ts` is a
  pure helper for the band ramp, including short panels where the bands meet in
  the middle. Three tests cover ramp direction, clamping and degenerate or short
  geometry.
- **Verified.** Typecheck, 20 test files / 186 tests and the production build
  pass. In a live 844x390 Chromium production sheet (220 px visible body, a
  five-type factory queue), dragging Engineer toward the bottom edge scrolled
  from 0 to 122 px in 160 ms and switched the target from Recon to the initially
  off-screen MBT. Dragging MBT toward the top edge scrolled from 250 to 137 px
  in 528 ms, switched the target from Recon to Engineer, and dropping reordered
  the queue to `[tank, engineer, harvester, recon, aa]` with the notification
  "MBT priority set ahead of ENGINEER." Details in `VERIFICATION_REPORT.md`
  section 24.
- **Not verified.** No physical touch-device drag; pointer events were
  synthesised in Chromium. No desktop-layout scroll sample (same container and
  loop). There is no visual edge indicator, and the scroll is vertical only.

## 30. Revision — one themed scrollbar treatment

Date: 2026-10-24. Follow-up to section 29. Visual consistency only; no scroll
ranges, panel sizes or interaction behaviour changed.

- **Shared tokens.** `--scroll-size: 8px`, a near-black inset track
  (`rgba(3,7,8,0.58)`), a muted metal thumb (`rgba(167,190,184,0.24)`), and
  amber hover/active thumb states now live beside the other theme variables.
- **Global rules.** `scrollbar-width`/`scrollbar-color` cover Firefox, while
  `::-webkit-scrollbar` rules set the squared 8 px rail, 1 px inset edge, a
  28 px minimum thumb, hidden arrow buttons and a themed corner. Every scrolling
  panel inherits the same treatment, including the production sheet, selection
  detail, roster, modals, mobile sheets and editor tools.
- **Intentional exclusions preserved.** The command bars and mobile roster still
  override with `scrollbar-width: none` and zero-height WebKit scrollbars; they
  remain swipe/scroll regions without a visible rail.
- **Removed one-offs.** The separate thin/transparent declarations on
  `#prod-body`, `.selection-body`, `.sel-roster` and `.tool-scroll` were removed
  so those panels cannot drift from the shared treatment.
- **Verified.** Production build passes: 51 modules, `dist/assets/index-DTtWcBEX.css`
  at 55.08 kB and `dist/assets/index-DQdwJ_w7.js` at 321.79 kB. Computed styles
  reported an 8×8 px rail, the muted thumb and dark track on `#prod-body`, and
  the same `scrollbar-color` on the selection body and roster. The hidden
  command bar still computed to a 0 px WebKit scrollbar height.
- **Not verified.** No screenshot or visual review of the final rail, and no
  captured hover/active state. Firefox, macOS overlay scrollbars and physical
  touch hardware were not exercised; those rely on the shared colour tokens and
  the hidden-scrollbar overrides.

## 31. Revision — centred command-rail contents

Date: 2026-10-24. Visual alignment only; rail width, row heights and hit areas
are unchanged.

- **Resource rows.** `.rail-stat` now centres its column (label, value and
  rate) and sets `text-align: center`; `.rail-label` centres its swatch and
  text cluster. Children are capped at the content width so long values still
  ellipsize rather than pushing out of the 92 px rail.
- **Objective and clock.** `.rail-objective` and `.rail-clock` centre their
  children and text. The objective keeps its five-line clamp, so the title
  still truncates inside the same button.
- **Already centred.** The brand block and the 2x2 mission-button grid were
  left untouched; both already centre their contents.
- **Verified.** Production build passes: 51 modules,
  `dist/assets/index-DfixkHRu.css` at 55.25 kB and
  `dist/assets/index-CrDP9905.js` at 321.79 kB. Live computed styles report
  `align-items: center` on the resource row, objective and clock, with equal
  left/right gaps for the MATS label, value and rate and for the MISSION clock.
- **Not verified.** No screenshot or visual review. The mobile top strip is a
  separate composition and was intentionally left unchanged.

## 32. Revision — rail control groups, toolbar-first console

Date: 2026-10-24. Follow-up to section 31. Desktop layout and control lifetime.

- **Groups in the rail.** The nine control-group slots moved out of the bottom
  console into `.rail-bottom`, directly above the MISSION clock, as a 3×3 grid.
  The existing 21 px slots now fill 25×21 px cells across three columns, so all
  nine fit within the 92 px rail without scrolling.
- **Bottom band stays flush.** `.rail-bottom` keeps its full
  `--selection-top-offset` (168 px) height and top alignment with the battle
  console. Inside it the group block takes 79 px, the mission clock is reduced
  from 44 to 32 px, and the 2×2 save/pause/settings/menu grid takes the
  remaining 56 px.
- **Toolbar first.** The desktop console is now ordered command toolbar then
  selection panel, so the floating toolbar sits above the selection box. With
  the group block gone from that row, the command bar receives the console's
  full width instead of sharing it with group slots.
- **Stable group slots.** `renderGroups` builds and binds its nine buttons once
  per mounted strip, then only updates `has`/`empty` and the aria label on each
  HUD tick. Replacing the buttons' `innerHTML` every 110 ms could lose a click
  that spanned an update; it also needlessly churned focus.
- **Dead chrome removed.** The orphaned `.console-groups`, `.group-label` and
  their child rules are gone. The mobile groups sheet is unchanged.
- **Verified.** Build passes: 51 modules, `dist/assets/index-ivonFLwU.css` at
  55.10 kB and `dist/assets/index-C9aFAdBm.js` at 321.93 kB. At 1422×800 the
  rail bottom and console both begin at y=632 with height 168; the group grid
  renders 3 columns × 3 rows, the toolbar occupies y=641–679, and the selection
  panel starts at y=685. The command bar fills 962 px with no overflow. Group 1
  assigned units [5,6], cleared selection, then recalled them by clicking the
  rail slot.
- **Not verified.** No screenshot or visual review. Physical touch input and
  the mobile groups sheet were not exercised; mobile keeps its 5×44 sheet grid.

## 33. Revision — post-audit fixes and retained economy

Date: 2026-10-24. Follow-up to sections 28–32, closing the mandatory findings in
`AUDIT_FINDINGS.md` §7 without changing the economy.

- **Economy decision.** The harvester/ore/refinery loop is retained for this
  slice. No replacement, ore removal or map-control income was implemented; the
  extension remains a later product decision. ECO-01/02/03 close as not-required
  for this slice, and `DESIGN_SPEC_RECONCILIATION.md` §9 now records the
  supersession instead of claiming removal is required.
- **Naval repair.** `updateNaval` repairs any damaged friendly corvette docked at
  a live, completed shipyard at 1.2% max HP/s regardless of missile count.
  Reloading remains a separate 2.5 s cadence and still requires missing ammo.
- **AI naval.** The AI searches for a legal coastal site before selecting a
  shipyard, builds it after its core land defences, produces exactly one corvette,
  replaces a loss and uses the existing engagement/return loop. On a landlocked
  map it falls through to land and air construction rather than retrying forever.
  It also builds an airfield, produces a fighter and sorties it when a ground
  target is visible.
- **MOVE.** The command now enters a real move/rally mode. The next ground click
  issues the order through `commandMove`, exits the mode and clears the active
  card. The stale active highlight after that order was fixed in `updateMode`.
- **Desktop chrome.** The persistent rail is 82 px, the production sidebar is
  `clamp(218px, 13.23vw, 254px)` and the bottom console is 136 px. The group
  selector remains a 3×3 rail grid above the mission clock, the 2×2 mission
  buttons remain, and the rail/console do not scroll.
- **Copy.** The editor reports “riflemen” rather than squads, and the production
  test names an individual rifleman.
- **Verified.** Typecheck clean; `npm test` 20 files / 191 tests passed; build 51
  modules; `npm run bench` stress 160 entities at 3.311 ms/tick, 100 path orders
  in 86.8 ms, 130-entity save 7.2 ms / restore 10.0 ms. Live Chromium at 1280×720
  measured 62.10% clear battlefield (37.90% chrome); at 1920×1080, 72.11% clear
  (27.89% chrome). Full results are in `VERIFICATION_REPORT.md` §29.
- **Not verified.** No full player-driven 10-minute match, physical-device touch,
  gamepad hardware, audio audition, reference-image comparison or mobile editor
  authoring. AI air/naval results are deterministic simulation tests, not a
  human-played match.

## 34. Revision — touch scenario editor

Date: 2026-10-24. Follow-up to section 33, making the editor usable without a
right mouse button or a wide desktop window.

- **Layout switch.** `src/ui/editorLayout.ts` selects the touch composition for
  coarse pointers up to 1200 px, windows up to 900 px and viewports up to 480 px
  high. Desktop keeps the permanent tools column and settings panel.
- **Tools drawer.** On touch the tool column becomes a left drawer opened from a
  44 px TOOLS button in the topbar. Tabs are 44 px high; tool buttons and terrain
  swatches are 48 px high; topbar actions and close controls are 44×44. Selecting
  a tool closes the drawer so the map is visible, and the hint names the active
  tool.
- **Bottom-sheet inspector.** Scenario settings slide up from the bottom instead
  of off the right edge. Height is 68% of the viewport, clamped to 220–460 px;
  the contents scroll. The sheet closes from a 44 px close button, the backdrop,
  or a downward drag past the smaller of 96 px or a quarter of its height.
  Backdrop opacity and ARIA expanded state follow the open panel.
- **Touch navigation.** PAN mode makes a one-finger drag pan instead of paint;
  selecting an editing tool exits PAN. The toolbar also adds 44 px zoom-out and
  zoom-in buttons, because touch has no wheel. The off-canvas controls previously
  assumed right/middle drag and wheel input.
- **Scroll and overflow.** The topbar labels collapse to icons on touch, the
  title is dropped below 520 px, and the toolbar compresses to icon buttons so
  the editor fits a 390 px-wide portrait viewport without page scrolling.
- **Verified.** Typecheck clean; `npm test` 21 files / 198 tests passed; build 52
  modules, CSS 60.44 kB and JS 328.79 kB.
  - 667×374: topbar 56 px; seven 44 px-high actions end at 658.7 in a 666.7 px
    viewport (TOOLS 76.8 px, DEPLOY 88.9 px, the other five 44 px wide); drawer
    340 px wide; tool buttons 98.2×48; tabs and close 44; sheet 254 px tall with
    a 44 px close and 44 px inputs; the inspector's 800 px content scrolls inside
    187 px.
  - 844×390: actions end at 836.5 in an 844 px viewport; sheet 265 px tall.
  - 390×844: seven 44 px-high actions end at 353.9 inside 390 (TOOLS label
    68.8 px, title hidden, DEPLOY icon-only); sheet clamps to 460 px; toolbar
    374 px with no horizontal document overflow.
  - 1280×720 desktop: tools 288 px, settings 330 px, toolbar 258.7 px ending at
    562.7; no change to the persistent composition.
  - Interaction: TOOLS opens the drawer; choosing RAISE closes it and clears
    PAN; INSPECT opens the sheet; a 110 px drag closes it; backdrop click closes
    the drawer; close returns focusable 44 px controls.
- **Not verified.** Physical touch hardware, a real notch/safe-area inset, iOS
  text-size zoom, or a visual screenshot review. Measurements are Chromium
  emulation at the sizes above.

## 35. Revision — seeded skirmish commanders, no scripted opening

Date: 2026-10-24. Follow-up to sections 33–34. Replaces the skirmish AI's
fixed priority table with a seeded commander and a state-driven utility planner.

- **What was still scripted.** There was no literal build-order array, but the
  old planner assigned absolute scores (`factory` 200, `refinery` 190,
  `powerPlant` 185, `barracks` 124, then air/naval) and the personality came
  from `scenario.settings.seed`, which is constant for an authored scenario.
  Every match therefore opened the same way and fielded the same commander. The
  AI was never given the player's start position — `targetKnown` begins false
  and targets come only from vision or contacts — but a lost contact never
  expired, so it could keep assaulting stale coordinates.
- **Match seed.** `GameOptions.aiSeed` selects a commander for the battle.
  `AIControlState` stores that seed, the chosen `strategy`, the AI's own random
  stream and the last contact/scout ticks. The app draws a fresh seed for each
  new battle; tests and saves default to the scenario seed. `fromSave` restores
  the commander, so a reload neither re-rolls its temperament nor changes its
  decisions.
- **Temperament, not timetable.** `aiProfile` maps the seed to one of `armour`,
  `infantry`, `air`, `economy` or `pressure`, with aggression, economy, tech and
  defence weights. Opening preferences are utility scores, not a sequence:
  economy opens refinery-first, infantry and pressure open barracks-first,
  armour and air open factory-first, and the planner still changes its mind for
  a brownout, a threat or an unaffordable bank.
- **State-driven decisions.** Construction scores its own bank, power gap,
  harvester saturation, scouted force mix, damaged structures, known air/naval
  contact and available terrain. Production fills deficits against the
  commander's preferred army blended with the scouted enemy mix. The engineer
  repairs a structure below 60% before laying new concrete and uses the repair
  order when nothing is affordable. A stalled site is abandoned after 45
  seconds without measurable progress.
- **No free intelligence.** Targets are only contacts or visible enemies; the
  old contact expires after 40 seconds without a fresh report and the AI
  resumes reconnaissance. Recon sweeps the fog rather than walking to authored
  coordinates, and three scouts are queued while the enemy is missing.
- **Commitment rules.** A wave requires the commander's gate or an overdue
  build-up, plus a per-temperament cooldown; the gate and cooldown prevent both
  one-unit trickles and the old every-second re-fire on an unreachable order.
  Aggressive commanders commit at roughly 55% of the desired army, cautious
  ones near 90%.
- **Verified.** `npm run typecheck` clean; `npm test` 21 files / **204 tests**
  passed; production build 52 modules, CSS 60.44 kB and JS 340.95 kB;
  `npm run bench` 160 entities at **2.744 ms/tick**, 100 path orders in
  **80.9 ms**, 130-entity save/restore **5.5 / 9.2 ms**. New tests cover seed
  replay, three different openings on the same map, no opposing start position
  at tick zero, emergency repair, save/load commander continuity, and
  normal-resource AI airfield/shipyard construction. `docs/VERIFICATION_REPORT.md`
  §31 records the runs.
- **Not verified.** No human-played match, browser visual pass or difficulty
  tuning session. Three seeds were used for the opening test, not a broad
  distribution; the air/naval test is simulation-only.

## 36. Revision — selectable AI difficulty

Date: 2026-10-24. Follow-up to section 35. Adds Recruit, Veteran and Elite
opponent levels without giving the AI extra resources, vision or combat power.

- **Selection.** The menu's `OPPOSING COMMANDER` control offers RECRUIT,
  VETERAN and ELITE. The choice is stored in `AppSettings.difficulty`, applied
  by `App.startBattle` as `GameOptions.aiDifficulty`, and therefore also used
  when the editor deploys a battle. The briefing and in-battle settings are
  unchanged; a loaded save keeps the level it was fought at.
- **What changes.** `aiProfile(seed, difficulty)` adds a bias to aggression,
  economy, tech and defence. A Recruit runs the thinnest economy and commits
  small forces early; a Veteran balances both; an Elite crews the extra
  harvesters, expands further and waits for a better-supported push. Aggression
  moves the wave gate and cooldown; economy changes expansion, power headroom
  and how many harvesters the AI crews — a recruit keeps one hauler per
  refinery, Veteran and Elite add the next, capped at four. Tech moves air/naval
  appetite; defence moves perimeter urgency. Opening strategy still comes from
  the match seed, so difficulty does not collapse into one predictable build.
- **What does not change.** No resource multiplier, free income, extra starting
  units, map reveal, vision range, combat bonus or rule exemption. Both sides
  start from the same scenario bank and use the same command API. This is a
  decision-quality level, not a handicap switch.
- **Save and replay.** `AIControlState.difficulty` is serialised with the seed,
  strategy and random stream. `fromSave` restores it; older saves default to
  Veteran. Changing the menu after loading does not rewrite an in-progress
  opponent.
- **UI.** The selector is a three-button segmented control with `aria-pressed`
  state and a description line. On touch layouts the buttons are 44 px high.
  At `max-height: 560px` the description is hidden and the menu body scrolls if
  needed, keeping DEPLOY reachable.
- **Matchup ladder.** `tests/ai-matchups.test.ts` runs both sides with the real
  `AIController` on a symmetric 64×64 arena. Each pairing plays both sides at
  three seeds; the mirrored orientations cancel the map's west-side advantage.
  Over 18 matches the current ladder is Recruit −16,654 against Veteran (2 wins,
  4 losses), Elite +17,576 against Recruit (5–1), and Elite +5,017 against
  Veteran (4–2), where the margin is material-weighted board value. The levels
  were tuned from this data: Recruit lost economy and gained early commitment,
  while Elite traded early aggression for economy and tech.
- **Verified.** `npm run typecheck` clean; `npm test` 22 files / **207 tests**
  passed; build 52 modules, CSS 61.81 kB and JS 342.50 kB. New tests compare
  Recruit/Veteran/Elite profiles at one seed, prove the same starting Materials
  and unit roster, prove the hauler crew differs after 30 s, reload an Elite
  save, and run the mirrored matchup ladder. In Chromium at 844×390 and
  667×374 the three buttons measured 44 px, the menu fit without document
  scroll, selecting Elite persisted in `localStorage`, and deploying produced
  `aiDifficulty = 'elite'` with the same 3000 starting Materials. Details in
  `docs/VERIFICATION_REPORT.md` §32–§33.
- **Not verified.** No human-played comparison of the three levels and no
  win-rate measurement against human players. The ladder is AI-vs-AI only; the
  arena is a purpose-built symmetric fixture, not the authored island.

## 37. Revision — strategic infrastructure and urban garrisons

Date: 2026-10-24. Follow-up to section 36. Adds capturable material and
reconnaissance objectives, a secondary material income path, and infantry
garrisons, without changing the retained harvesting economy or rewriting the AI.

- **Signals Relay.** Remains capturable by a Combat Engineer, immune to fire and
  worth +1.1 requisition/s while owned. It is now marked `capturable` in data
  instead of relying on the relay id in capture code, so the capture order,
  progress bar, AI value and benefit all use one objective model.
- **Forward Supply Depot.** Authored-only, neutral by default, 900 HP. An owned,
  complete, surviving depot pays **2 materials/s** (120/min) with no harvester
  or refinery required. Multiple depots stack; neutral, enemy-owned, building,
  destroyed and construction states pay nothing. It can be damaged, repaired and
  destroyed. The rate is deliberately supplementary: a full 300-material
  harvester load takes 13.6 s of mining before travel and unloading.
- **Radar Station.** Authored-only, 800 HP, 22-tile scan. While owned, complete,
  powered and on a non-brownout grid it reveals hostile units and structures
  through terrain concealment and keeps the tactical map online. It grants no
  weapon line of sight. The feed stops on ownership loss, destruction or
  brownout and resumes when power is restored.
- **Shared capture model.** `BUILDINGS[defId].capturable` drives validation, AI
  valuation, command validation and HUD copy. An engineer must be within 4.5
  tiles for 5 seconds; another order clears progress. Ownership changes only at
  completion, so every effect starts and stops on authoritative state.
- **Garrisons.** `BuildingDef.garrison` supplies capacity, protection, exposure
  and firing slots. Tenements hold 4 (55% cover, 2 slots); ruins hold 2 (35%
  cover, 1 slot). Only riflemen and ATGM teams are eligible; vehicles and
  engineers are rejected. Entry uses ordinary pathfinding to a reachable tile
  inside a footprint-derived entry radius (candidates outside that radius are
  filtered, which fixed an order-cancelling edge case found by the tests).
  Occupants remain individual entities but leave the exposed unit layer.
- **Garrison combat.** A direct anti-structure hit selects one occupant
  deterministically and applies `(1 - protection)` before the normal infantry
  armour multiplier; this makes the HUD's protection number truthful. Exposure
  now only scales suppression. Occupants fire with their own weapons, range and
  line of sight from the shelter centre, up to the configured firing slots, with
  no accuracy, range or damage bonus. Splash does not select an extra occupant.
- **Contested shelters.** A neutral shelter occupied by hostile infantry is a
  legal target, so a tank, ATGM team or other anti-structure weapon can clear it;
  once empty it is neutral again. Enemy infantry cannot enter until the
  occupants leave or die. Destroying the shelter kills every occupant with it.
  Exit is atomic: if a distinct safe tile cannot be found for every occupant,
  the order is refused and everyone stays inside.
- **AI.** `captureObjective` values relays when requisition is low, depots when
  hauling/passive income is scarce and radar when no reconnaissance feed exists.
  It sends a free engineer only without a waiting construction site or immediate
  threat, inside 48 tiles, on a 15 s retry floor. `manageGarrison` occupies up to
  two nearby neutral/friendly shelters when defending, respects capacity and
  releases occupants for an assault or a shelter below 40% health.
- **Editor and scenario.** All five authored roles are in the normal structure
  palette: relay, supply depot, radar station, tenement and ruin. The tool hint
  now reports the selected structure's role (for example `garrison 4 · 55%
  cover`). Validation checks tracked access for every capturable objective and
  foot access for every shelter, and reports the authored depot/radar counts.
  Kestrel Island gains the central depot at (44,32), a tenement at (39,29) and a
  ruin at (62,33); the existing relays, victory condition and starting forces are
  unchanged.
- **HUD.** Objective cards and the building inspector show owner/neutral state,
  capture progress, operational state, benefit, garrison occupancy and radar
  contact count. Direct **GARRISON** and **EXIT BUILDING** controls sit in the
  selection panel and command bar, so the feature is reachable by touch.
- **Tests and checks.** Typecheck clean. Full suite **232 of 233 pass** across 24
  files. The 26 new tests cover all capture states, income accounting, multiple
  depots, brownout, save/load, entry, capacity, exit blocking, protection versus
  exposed infantry, firing, enemy clearing, destruction and AI occupation. The
  single failure is the pre-existing Recruit-vs-Veteran ladder assertion; it
  reproduces with the new AI objective/garrison tasking disabled (see
  VERIFICATION §34.4). Build 53 modules, CSS 62.60 kB, JS 370.36 kB. Benchmarks:
  0.238 ms/tick baseline, 2.942 ms/tick at 163 entities, 83.1 ms for 100 path
  orders, 5.7/9.4 ms save/restore.
- **Browser evidence.** Chromium at 1280×720: editor palette exposes all five
  authored structure ids; selecting the tenement shows `garrison 4 · 55% cover`;
  Kestrel validation reports `0 ERR · 0 WARN`, 4 objectives and the depot info
  line. At 667×374 the battle command bar exposes GARRISON and EXIT. No visual
  pixel-diff or human balance pass was performed.
- **Not verified.** Depot/cover balance against human opponents, long-match
  economic pressure, garrison behaviour under artillery-heavy AI compositions,
  and the AI matchup ladder (pre-existing failure).

## 38. Revision — tunable difficulty ladder

Date: 2026-10-25. Follow-up to section 36. The selectable levels existed but the
mirrored AI-vs-AI ladder did not order them: Recruit traded wins with Veteran and
Elite finished within noise of it. This pass makes each level a statement about
how a commander *decides*, then tunes the three levels until the ladder says so.

- **Judgement, not income.** No level receives extra Materials, Requisition,
  vision or unit stats. `aiProfile(seed, difficulty)` still derives a seeded
  personality, and the difficulty bias now also carries four decision-quality
  fields:
  - `reactionTicks` — how often the controller thinks (Recruit 60, Veteran 20,
    Elite 10 ticks). The controller schedules itself, so the battle loop and the
    matchup harness share the same cadence; a recruit notices a raid, a finished
    queue or a new contact later.
  - `responseWeight` — how far its army composition bends toward the force it
    scouted (0.15 / 0.55 / 0.95).
  - `commitShare` — the fraction of the desired army it insists on before
    attacking (0.35 / 1.0 / 1.1). A recruit feeds units in as they finish; an
    elite waits for the wave.
  - `reserve` — combat units left at home while a wave is away (0 / 0 / 2).
    Elite alone keeps a home guard, so a counter-attack does not walk into an
    empty base.
- **Aggression direction.** The personality bias for aggression was inverted
  relative to the intent in section 36: a recruit was the patient masser.
  Recruit now commits earlier with a smaller force (+0.16), Elite later with a
  supported one (-0.04). Veteran remains the unmodified baseline, which is why
  the existing air/naval and construction tests still pass unchanged.
- **Economy.** Recruit crews one hauler per refinery (cap 2), Veteran one extra
  (cap 3), Elite two extra (cap 5). Elite's broader refinery/factory investment
  now has the hauling capacity to pay for itself; the crew is still limited by
  ore, so this is not a resource bonus.
- **Ladder arena.** `tests/ai-matchups.test.ts` keeps the symmetric arena and
  mirrored pairings, but authored ore is now 600 per tile instead of 300. At one
  harvester load per tile both sides exhaust every deposit after roughly three
  minutes, after which the bank alone decides the match and all three levels
  play identically. Two loads per tile keep the economy decision live for the
  whole 600 s match; the ladder's ordering does not change at 900.
- **Measured ladder.** Eight seeds × both sides = 16 matches per pairing:
  Recruit vs Veteran margin **−56,746** (5–11), Elite vs Recruit **+65,583**
  (13–3), Elite vs Veteran **+29,490** (10–6). The wider sample in
  `tools/ai-matchups.ts` reads −149,902 (15–33), +183,879 (37–11) and +63,051
  (26–22) over 24 seeds, and −80,547 (7–17), +98,300 (16–8), +47,818 (14–10)
  over 12 seeds at 900 ore per tile, so neither the ordering nor the sign of the
  margins depends on the eight-seed sample or on the arena's ore figure.
- **Tests.** `tests/ai.test.ts` asserts the new profile invariants (aggression,
  economy, army scale, reaction, commitment and response ordering, and that
  income and roster are untouched). `tests/ai-matchups.test.ts` asserts the
  ladder with margins and win counts measured above; the test prints the table
  so a future tuning pass can compare directly.
- **Not verified.** No human opponent was used. The ladder measures one arena
  and one starting layout; it does not prove that Elite is harder for a person
  to beat, only that it beats the same planner playing Veteran.

## 39. Revision — objective integrity, occupied shelters, rally points

Date: 2026-10-25. Follow-up to section 37. Makes the forward supply depot a
capture-only objective like the relay, gives occupied shelters a distinct model
and a damage rule, and finishes the production loop around rally points.

- **Depots are objectives, not targets.** `supplyDepot` now carries
  `indestructible: true` alongside `relay`. `canWeaponTarget` refuses both, the
  damage model drops every hit (including splash), and an explicit attack order
  is answered with "cannot be destroyed — capture it with a Combat Engineer."
  The selection card shows the same control/capture meter as a relay and no
  integrity bar; the world overlay skips the integrity strip for both.
- **Occupied shelters.** A garrisonable building with infantry inside swaps to
  a dressed model: concertina wire around the footprint, sandbag firing steps on
  the roof, a flag and a team-masked trim band. Team colour is carried by masked
  vertices, so the dressing is recoloured from the occupants' owner (not the
  structure owner) and one mesh serves both sides. Empty shelters keep the plain
  model.
- **Shelter damage.** Occupied buildings are fully damageable. A direct hit on
  the structure passes `1 − protection` of its damage through the cover to one
  occupant (chosen deterministically from the projectile id and tick, so a save
  replay hits the same soldier); splash only suppresses. Below 25% integrity
  every occupant is expelled through the ordinary exits and the shelter cannot
  be re-entered until it is repaired.
- **Rally points.** Finished units appear on the apron beside their facility and
  receive a move order to the building's rally point, instead of spawning on the
  rally tile. Aircraft still leave under their own recovery logic. Selecting a
  producer draws a dashed tether and a flag at the rally point so the destination
  is legible before the next unit finishes.
- **Right-click garrison.** A right-click on a garrisonable building with
  eligible infantry selected resolves to the garrison order rather than a move
  onto its footprint (`contextOrderFor`, already the shared resolver used by the
  HUD and the pointer).
- **Selection band.** The desktop selection panel is a fixed-height grid:
  identity, live values and status across one row, every command on a second
  scrolling row. Objective and garrison notes collapse to a single line each on
  desktop, so no card in the slice needs a vertical scrollbar.
- **Tests.** `tests/infrastructure.test.ts` covers the depot's attack rejection,
  auto-acquire skip and capture meter; `tests/garrison.test.ts` covers structure
  damage under occupation, expulsion at a quarter integrity and the right-click
  garrison resolution; `tests/production.test.ts` covers the apron spawn and the
  walk to the rally point; `tests/thumbnails.test.ts` asserts the dressed shelter
  models add geometry and team-mask vertices only in the occupied variant.
  `tests/ai.test.ts` holds the landing Command Post together while it measures
  the AI's normal-resource build order, because a passive player now loses the
  map before the air branch is affordable.
- **Not verified.** No human playtest of the new shelter rule, and the occupied
  dressing was checked through mesh invariants rather than a rendered browser
  capture.

## 40. Revision — naval production tab and sea rally points

Date: 2026-10-25. Follow-up to section 39.

- **SEA tab.** The unit rail compared a facility's `produces` domain directly
  against the tab id, so `sea` never matched `naval` and an operational shipyard
  still read "No SEA production facility". `productionDomain(tab)` in
  `src/ui/hudLayout.ts` is now the single mapping (SEA → naval, LAND/AIR pass
  through, BASE/DEFENCE → null); `renderProduction` filters on it.
- **Default sea rally.** `spawnStructure` seeds a naval structure's rally onto
  the nearest adjacent navigable tile (distance, then tile order, so it is
  deterministic and save-safe) instead of two tiles of beach behind the yard.
- **Rally validation.** `Game.rallyStatus(buildingId, x, z)` answers whether a
  drop is legal for the building's force: naval facilities require navigable
  water and everything else accepts any point. The `setRally` command rejects an
  illegal drop with an `orderFailed` notice, the HUD asks the same method before
  confirming, and `sendToRally` skips a hull whose saved rally is dry so a legacy
  save cannot beach a corvette.
- **Tests.** `tests/hud-layout.test.ts` pins the tab-to-domain mapping;
  `tests/air-naval.test.ts` checks that a yard's default rally is on water, that a
  dry drop is refused and reported (rally unchanged), that a water drop is
  accepted, and that a produced hull ends up on navigable water.
- **Not verified.** The SEA tab was confirmed through the mapping test and the
  shared filter rather than a rendered browser capture of a built shipyard.

## 41. Revision — tactical map fills the sidebar corner

Date: 2026-10-25. Follow-up to section 40.

- **Map dock.** The production sidebar is a two-column grid (content, 56px tab
  strip) with the map dock in row 2. The dock used to stop at the content
  column, leaving the 56 × console-height corner under the last tab as dead
  chrome. `.map-dock` now spans `1 / -1` and `.prod-tabs` occupies row 1 only, so
  the tab strip ends where the map begins and the minimap reaches the window
  edge: the canvas grows from 151 × 125 to 207 × 125 at a 1440 × 900 window. The
  map keeps its top edge flush with the bottom console, and the mobile layout is
  untouched (both elements are positioned outside the desktop grid there).
- **Verified.** Measured in the running dev server at 1440 × 900 and 390 × 844:
  the dock's right edge equals the sidebar's right edge, the dock's top equals
  the tab strip's bottom and the console's top, and the mobile sheet layout still
  hides the dock until the map panel opens. Typecheck, build and the HUD layout
  tests pass.

## 42. Revision — doorways, traffic and the selection band

Date: 2026-10-25. Follow-up to section 41.

- **Doors measured from the wall.** `findGarrisonApproach` used to pick candidate
  tiles by distance from the building *centre* and reject anything outside a
  centre radius that grew with the footprint, while `updateGarrisonOrder` gated
  entry on the same radius. The two disagreed by one arrival radius
  (`max(2.5, radius * 0.4)` world units), so a unit that stopped a step short of
  the door was cancelled with "could not reach" — the island tenement failed
  from half the map. `structureClearance()` now measures the gap to the footprint
  edge, candidates must be within 1.5 tiles of a wall, entry is allowed within
  1.75 tiles, and garrison routes use a 0.9-unit arrival radius so the last step
  is walked. A unit that arrives outside the gate re-runs the approach search
  under a 60-tick no-progress budget instead of dropping the order, and a failed
  garrison repath hands the decision back to that handler rather than emitting
  the generic "cannot reach its destination".
- **Traffic.** Movers bias their heading around a *stationary friendly* unit in
  the lane ahead (hostiles are targets, not obstacles; moving columns are left
  to sort themselves out). Separation is asymmetric inside a force — the mover
  yields, the unit holding position keeps its ground — and stays a shared push
  against the enemy, because that is combat. When a step is blocked, units now
  slide along the blocking axis instead of stopping dead, which clears the
  corners that a smoothed path can cut across.
- **AI difficulty.** Cleaner movement compressed the Elite/Veteran pairing from a
  +23,407 margin to between +508 and +8,110 across variants, so Elite's
  `armyScale` went 1.2 → 1.3 and `reactionTicks` 10 → 8. Measured after the
  change: Elite vs Veteran +37,155 (10-6), Elite vs Recruit +75,033 (13-3),
  Recruit vs Veteran -34,293 (3-13) — the label guarantees in
  `tests/ai-matchups.test.ts` hold with unchanged thresholds.
- **Selection band.** The desktop panel is now one band: identity and vitals side
  by side on the left, values in the middle, notes on the right, commands on the
  bottom row. The vitals column is a grid cell rather than a block, so the second
  bar (control + integrity on objectives) no longer painted over the command row.
  `.infra-head` / `.infra-parts` shrink with ellipsis instead of overrunning their
  column, the selection body takes the leftover width (`flex: 1 1 0`) and the
  roster sizes to its chips with a `min(42%, 320px)` cap and its own horizontal
  scroll. At a 1440 × 900 window (879px console) a building card measures 95px of
  identity, 60px of bars and a 16px command row with no overlapping boxes; an
  eight-unit selection gives the body 537px and the roster its 320px cap.
- **Tests.** `tests/garrison.test.ts` gained an approach block: entry from ten
  clear sides with no `orderFailed`, the chosen door sitting inside the entry
  gate, and a shelter whose near side is drowned still reached from another
  door. `tests/sim-core.test.ts` gained the traffic invariants: a mover walks
  around an idle rifleman (closest approach > 0.9 tiles, idle unit moved < 0.5
  tiles) and a mover leaves an overlap without displacing the unit that holds
  still (< 0.05 tiles). Both fail against the old steering/sharing.
- **Not verified.** No human playtest of the new door or traffic feel; the
  selection band was measured through DOM rects (synthetic building card at the
  real console size plus a live eight-unit selection), not a visual capture.

## 43. Revision — field reports replace the toast cards

Date: 2026-10-25. Follow-up to section 42.

- **Placement and shape.** Notifications were centred cards (240–460px wide, dark
  panel, border, shadow, icon and a `WARNING` tag) sitting 76px below the top
  edge — directly over the middle of the battlefield. They are now plain lines of
  12px text at the top-left of the viewport, offset past the 82px command rail
  (`left: 94px; top: 12px`), with a 2px colour-coded rule, a soft text shadow and
  no panel at all. The level is carried by the rule colour (info blue, warning
  amber, critical red, success green) instead of a redundant label. On the touch
  layout the same log sits under the 42px top bar at `left: 8px`, clear of the
  safe areas.
- **Typed in.** `App.notify` writes the message a character at a time (8–22ms per
  character, whole line inside ~420ms) behind a blinking caret, then drops the
  caret and the `typing` class. The interval is cleared when the toast expires so
  a disappearing report cannot keep writing. The finished sentence is duplicated
  into a visually hidden node and the animated text is `aria-hidden`, so a screen
  reader hears the whole message once through the root's `aria-live="polite"`
  region instead of character by character.
- **Timing.** Reports live 4s (5.6s for critical), up from 3.6/5.2s, because the
  typing animation now eats into the reading time; the stack still caps at four.
- **Verified in the running dev server.** A failed move order produced
  `No route to that location for the selected force.`: sampled at ~200ms it read
  "No route to that loca" with the caret visible and the `typing` class, and at
  ~1.1s the full sentence with the caret hidden. Box was `x 94, y 12` on desktop
  and `x 8, y 50` on the 390px touch layout, with computed background
  transparent and a 2px amber left rule. Typecheck, build and the full 251-test
  suite pass.
- **Not verified.** No screenshot comparison against the reference and no check
  of the typing animation at unusual frame rates; the report order under a burst
  of simultaneous warnings was only spot-checked.
