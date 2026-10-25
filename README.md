# MCA: Modern Combined Arms

A playable vertical slice of a modern combined-arms real-time strategy game: author
an island, launch it into a real battle, build an economy, command land, air and
naval forces against a skirmish AI, and win or lose the island.

The design reference is [Modern_Combined_Arms_RTS_GDD_v0.1.md](Modern_Combined_Arms_RTS_GDD_v0.1.md).
The implementation history, GDD gap matrix, architecture notes and verification
log live in [docs/PLAN.md](docs/PLAN.md). The current audit and next-phase plan are
in [docs/AUDIT_FINDINGS.md](docs/AUDIT_FINDINGS.md),
[docs/VERIFICATION_REPORT.md](docs/VERIFICATION_REPORT.md) and
[docs/NEXT_PHASE_PLAN.md](docs/NEXT_PHASE_PLAN.md).

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # typecheck + production bundle in dist/
npm test           # 233 Vitest tests (232 pass; see Known limitations)
npm run bench      # measured simulation/save/pathfinding performance
```

No framework, no runtime dependencies: TypeScript modules, a hand-written WebGL2
renderer, Canvas2D overlay/minimap, and a fixed-step simulation. Requires a
WebGL2-capable browser (desktop, or landscape mobile).

## What is in the slice

- **Island Assault — Kestrel Bay**, a 96×72-tile authored island: western
  beachhead, central ridge with one road pass, forested northern flank, contested
  signals relays, eastern expeditionary base, and a deep bay reaching the enemy
  coast.
- **Economy**: materials from deposits via harvesters carrying 300-material
  loads, requisition from command posts and captured relays, engineer-placed and
  engineer-repaired structures, per-facility queues with smooth cameo progress,
  counts and drag-to-prioritise cards that auto-scroll near the sheet edges.
  A captured Forward Supply Depot adds 2 materials/s without a harvester or
  refinery, so losing the hauling economy is a setback rather than an
  unrecoverable deadlock.
- **Strategic objectives**: neutral Signals Relays, Forward Supply Depots and
  Radar Stations are authored in the editor and captured by Combat Engineers.
  Relays pay requisition, depots pay supplementary materials, and a powered
  Radar Station plots hostile units within 22 tiles through terrain masking.
  Ownership, capture progress and the benefit are authoritative simulation
  state; neutral, enemy-owned, unpowered and destroyed structures pay nothing.
- **Urban garrisons**: riflemen and ATGM teams can occupy authored tenements and
  ruins (4 and 2 occupants, 55% and 35% cover). Occupants fight from the
  building, are harder to kill with direct anti-structure fire, cannot be run
  over by vehicles, and die with the structure if it is destroyed. A neutral
  shelter occupied by hostile infantry becomes a legal target, so cover is a
  tactical position rather than an invulnerable box.
- **Land**: engineer, rifleman, medic, ATGM gunner, main battle tank, recon
  vehicle, AA vehicle, harvester. Infantry are individual soldiers, not squads;
  a stationary medic slowly treats one wounded infantryman at a time.
- **Air**: strike fighter with four missiles and limited fuel, parked at a
  physical airfield, automatic return/rearm loop, countered by SAM batteries and
  AA vehicles.
- **Sea**: missile corvette with six anti-ship missiles and a deck gun, water-only
  pathfinding, shipyard reload/repair, shore bombardment.
- **Presentation**: a 2.5D 45°-rotated, 30°-tilted orthographic isometric view with
  2:1 diamond ground projection, procedural meshes and day-lit battlefield. Tile
  elevation levels are drawn as one continuous surface — flat tops with a ramp band
  wherever the level changes and sloped shorelines — and that same surface is what
  pointer picking, orders, placement ghosts and the editor's hover all resolve
  against. The construction grid appears only while placing a structure; the
  editor draws its own grid.
- **AI**: a seeded skirmish commander, not a script. The match seed picks a
  temperament (armour, infantry, air, economy or pressure), then a utility
  planner scores construction, production, scouting and attacks against its own
  economy, power grid, damage and terrain each second. It never receives the
  player's start position: every target comes from vision or a remembered
  contact, and a lost trail sends it back to reconnaissance. It builds and
  reaches air and naval branches under normal starting resources, replaces lost
  units, repairs badly damaged structures, values relays/depots/radar according
  to its shortages, garrisons nearby cover when defending and commits waves
  through the same command API as the player. A fresh battle draws a new seed,
  so the same map does not always open the same way; saves keep the seed and
  replay the same opponent.
- **AI difficulty**: the menu offers Recruit, Veteran and Elite. Recruit thinks
  slowly, runs the thinnest economy, ignores what it scouted and feeds units in
  as they finish. Veteran balances expansion and timing. Elite decides every
  half second, builds the broadest economy, counters the force it scouted,
  masses a supported wave and keeps a home guard. The level changes decisions
  only — it never grants extra resources, free vision or different combat
  rules. The mirrored AI-vs-AI ladder orders them clearly (Recruit is 5–11
  against Veteran, Elite is 13–3 against Recruit and 10–6 against Veteran over
  eight seeds); the numbers and limits are in
  [docs/VERIFICATION_REPORT.md](docs/VERIFICATION_REPORT.md) §35. The choice is
  saved for new battles; a loaded save keeps the level it was fought at.
- **Interface**: two battle HUD compositions over one simulation. Desktop uses a
  compact left command rail with resources, objective, control groups and mission
  actions, a persistent right production sidebar with tactical map, and a bottom
  console with its command toolbar above the selection panel. Mobile landscape
  uses a compact top strip with objective chip, right production rail that opens
  a sheet, collapsible
  tactical-map overlay, a bottom selection/command bar with a sticky Add toggle,
  and touch-accessible control groups. Both use the same `App` commands. Unit and
  structure cards show procedural three-quarter portraits rendered from the same
  meshes as the battlefield; the selection panel shows the selected asset's
  portrait, with a count badge for a group.
- **Editor**: terrain/elevation/ore painting, water authoring, structures, units,
  player starts, objectives, ground/naval reachability previews, validation, JSON
  save/load, and one-click deploy into the real simulation. On touch and short
  screens the tools become a 44 px drawer, settings open in a draggable bottom
  sheet, and PAN plus zoom buttons replace the right-drag/wheel controls.
- **Persistence**: three browser save slots with versioned save and scenario
  data, plus restart. Deterministic fixed-step simulation (20 Hz) with seeded
  randomness.

## Controls

| Action | Desktop | Touch | Gamepad |
| --- | --- | --- | --- |
| Select / box select | LMB click / drag | Tap / drag, or **BOX** | A on cursor |
| Add to selection | Shift | **ADD** toggle, then tap | — |
| Move / attack / rally | RMB | Tap destination / **ATTACK** | A / X |
| Attack-move | `A` | **A-MOVE** command bar | X |
| Stop / hold | `S` / `H` | **STOP** / command bar | Y |
| Repair damaged structure | RMB with a Combat Engineer selected | **REPAIR**, then tap the structure | — |
| Capture objective | RMB relay/depot/radar, or `C` | **CAPTURE** | — |
| Garrison / exit | RMB a shelter with infantry, or **GARRISON** / **EXIT** | **GARRISON** / **EXIT BUILDING** | — |
| Return aircraft/ship | `R` | **RETURN** | — |
| Construction | `B`, or engineer + **BUILD** | **BUILD** tab | — |
| Control groups | `Ctrl+1..9`, `1..9` | group strip | — |
| Pan / zoom | Arrow keys, screen edge, RMB/middle drag, wheel | one-finger pan, pinch | left/right stick |
| Pause / speed | `P` / `+` `-` | **PAUSE** | Start |
| Debug overlay | `F3` | **DIAG** | — |

Attack-move and stop deliberately own `A` and `S`; camera panning uses the arrow
keys, screen edge, drag and the wheel so keyboard orders never conflict.

## Layout

```
src/sim/       authoritative simulation: map, scenario, pathfinding, combat, AI, save
src/data/      unit, weapon, building, faction and scenario data
src/render/    WebGL2 renderer, camera, procedural meshes, terrain, water, effects
src/ui/        HUD, input (mouse/touch/gamepad), overlay, minimap, audio, editor
tests/         determinism, movement, combat, economy, air, naval, AI, editor, perf
```

The simulation never reads rendering state. Rendering interpolates entity
presentation but gameplay outcomes come only from `Game.tick()` at a fixed
50 ms step. Commands are queued and processed in stable order; random draws use
the save-persisted seeded generator.

## Tests and measurements

`npm test` runs 234 tests across 24 files, including two-run state-hash
determinism, batch-size invariance, save/load round-trip, blocked paths,
aircraft recovery, naval navigation and reload, full-ammo ship repair, AI
shipyard/corvette and airfield/fighter production, scenario validation,
terrain-surface picking and measured performance. The infrastructure suite
covers relay/depot/radar capture, passive income, brownout, multiple depots and
save/load; the garrison suite covers entry, capacity, exit, protection, firing,
enemy clearing, destruction and AI occupation. `npm run ai:matchups` runs the
mirrored, eight-seed Recruit/Veteran/Elite ladder on its own and prints the
margins; `npx tsx tools/ai-matchups.ts <levelA> <levelB> [seeds] [ore]` runs a
wider sample for a tuning pass. `npm run bench` prints the performance numbers;
the latest runs are recorded in
[docs/VERIFICATION_REPORT.md](docs/VERIFICATION_REPORT.md) §34–§35.

## Known limitations

- Gamepad support is implemented but was not exercised on physical hardware.
- The desktop/mobile HUD structure and touch targets are measured in a Chromium
  viewport; physical notches, safe-area insets and low-end touch devices were not
  exercised. Thumbnails are generated at runtime from the low-poly meshes (no
  pre-rendered artwork); the first battle start prewarms every card and selection
  portrait in about 0.16 s behind the loading screen, and later cache misses
  queue off-frame. Icons remain the fallback if WebGL is unavailable.
- Audio is generated with Web Audio and has not been auditioned in automated runs.
- The renderer is validated by shader compilation, a live WebGL2 context, frame
  timing and DOM checks, not pixel-diff screenshots.
- One AI opponent on one authored map; no multiplayer, campaign, six-nation
  roster or mod SDK yet. A full player-driven 10-minute build-and-fight run has
  not been rerun.
- AI difficulty is tuned by mirrored AI-vs-AI matchups, not human win rates.
  The symmetric ladder arena has no water or ridges, so air and naval branches
  are verified separately; the levels describe relative commander strength in
  the ladder, not a promised outcome against a particular player.
- **The mobile result screen is not usable yet.** At 844×390 the card is taller
  than the viewport and all four actions are below the visible area; at 667×374
  the card is 499 px tall in a 374 px viewport. The page does not scroll and the
  action buttons are 36.9 px high. Rotating or resizing after a result also
  removes the result card, and resizing while paused hides the pause overlay
  while the simulation stays paused. See [docs/AUDIT_FINDINGS.md](docs/AUDIT_FINDINGS.md)
  §9.4 (HUD-10, HUD-11, HUD-12).
- At 1280×720 the persistent desktop HUD leaves 62.1% clear battlefield (chrome
  37.9%), and at 1920×1080 it leaves 72.1% (chrome 27.9%). These are CSS-pixel
  measurements from a Chromium viewport, not a pixel-diff review.
- The harvesting/ore/refinery economy is retained for this slice. A later
  extension will build on it; R-01's removal model is deferred, not implemented.
- The infrastructure/garrison balance is first-pass. Depot income is fixed at
  2 materials/s and the tenement/ruin cover at 55%/35%; these are tested for
  correctness and rough proportion, not settled by human matches.
- Garrison combat is a restrained building-envelope model, not room-by-room
  interiors or directional firing ports. Occupants fire from the shelter centre
  with their normal weapons, range and line of sight; at most the configured
  firing slots engage per update.
- The AI difficulty ladder is measured on a symmetric arena with two harvester
  loads per ore tile. On the shipped maps a deposit holds one load, so the ore
  runs out after about three minutes and the three levels stop separating;
  fixing that belongs to the deferred economy extension, not the ladder.
- Saves live in `localStorage` and are tied to this browser profile.
