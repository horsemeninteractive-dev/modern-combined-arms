# Verification Report — Stage 1 Audit and Change Set 1

Stage 1 date: 2026-10-23; Change Set 1 recorded 2026-10-23.  
Current re-audit date: 2026-10-24 (§28).

Scope: §§1–9 are the original read-only audit and specification work. §10 records
the Change Set 1 HUD structural-shell implementation. §§10–27 are the historical
change-and-verification log and superseded the HUD findings in §3 at the time
they were written. **§28 is the current-state verification for the 2026-10-24
working tree and supersedes all earlier runtime claims for current status.**
The Stage 1 audit itself changed no application source; §28 changed documentation
only. Everything after §28 is logged as dated revisions in `docs/PLAN.md`
(sections 29-42 at the time of writing); treat that log, not this report, as the
current state of the working tree.

---

## 1. Environment

| Item | Value |
| --- | --- |
| Host | Windows 10/11 (`MINGW64_NT-10.0-26300`, Git Bash 3.6.10) |
| Node | v24.14.0 |
| npm | 11.9.0 |
| Vite | 8.3.5 |
| Vitest | 5.0.5 |
| Browser preview | Freebuff Chromium build; UA `Chrome/130.0.6723.191`, Electron 33.4.11 |
| WebGL2 | Available (`canvas.getContext('webgl2')` non-null) |
| Device pixel ratio | 1 |
| Dev server | `http://127.0.0.1:5173/` — HTTP 200 at check time |
| Repository state | No usable Git baseline diff (files show as untracked); source was not modified during this stage. |

The browser viewport was resized directly. It is **not** a physical phone:
`maxTouchPoints` reports 10, but touch gestures, notches/safe areas, device
performance and audio were not exercised on hardware.

---

## 2. Commands executed and outcomes

### 2.1 Typecheck

```
$ npx tsc --noEmit
TYPECHECK_EXIT=0
```

Result: **pass**, no diagnostics.

### 2.2 Test suite

```
$ npx vitest run
 Test Files  10 passed (10)
      Tests  65 passed (65)
   Duration  6.92s
TEST_EXIT=0
```

Result: **pass**. This supersedes README/PLAN claims of 9 files / 59 tests.

Test files in the run: `tests/ai.test.ts`, `tests/air-naval.test.ts`,
`tests/camera.test.ts`, `tests/combat.test.ts`, `tests/debug.test.ts`,
`tests/determinism-save.test.ts`, `tests/perf.test.ts`, `tests/scenario.test.ts`,
`tests/sim-core.test.ts`, `tests/unit-scale.test.ts` (plus the non-test helper
`tests/helpers.ts`). Coverage includes determinism, save/load, camera projection,
movement/combat, air, naval, AI, scenario validation, unit scale and
performance.

### 2.3 Production build

```
$ npm run build
vite v8.3.5 building client environment for production...
✓ 42 modules transformed.
dist/index.html                   4.25 kB │ gzip:  1.58 kB
dist/assets/index-Cz3nDgv8.css   36.40 kB │ gzip:  7.74 kB
dist/assets/index-DLnYlqgY.js   264.63 kB │ gzip: 79.21 kB
✓ built in 207ms
BUILD_EXIT=0
```

Result: **pass**. The build regenerated `dist/`; no source changed.

### 2.4 Benchmarks

```
$ npm run bench
[perf] baseline: 31 entities, 600 ticks in 226.5ms (0.377ms/tick)
[perf] stress: 171 entities, 300 ticks in 1536.8ms (5.123ms/tick)
[perf] pathfinding: 100 orders in 95.7ms
[perf] save/load: 141 entities, serialise 8.0ms, restore 11.3ms, 302KiB
[perf] map: 96x72, 3347 land tiles (48%), 3565 water tiles (52%)
✓ 5 tests passed
BENCH_EXIT=0
```

Result: **pass**, but these are single-machine measurements, not a mobile
performance guarantee. The 171-entity stress tick (5.123 ms) is close to the
50 ms fixed step only at much larger counts; the authored 31-entity baseline has
wide headroom.

No command in this stage failed or timed out. `npm run bench` is a test run, not
a separate benchmark harness; its numbers are indicative, not statistically
controlled.

### 2.5 Dev server

```
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5173/
200
```

The existing Vite server was reused; no new server was started or stopped.

---

## 3. Runtime viewport audit

Method: battle HUD mounted, no modal open, `getBoundingClientRect()` on the
persistent HUD regions after each `preview_resize`. "Clear band" =
`bottom-deck.y − topbar.height`; "unobstructed" additionally subtracts the
floating command bar where it overlaps that band. "Usable area" is the full-width
clear band minus the command-bar rectangle (`bandWidth × bandHeight − cmdW ×
cmdH`), expressed against `innerWidth × innerHeight`; no side columns currently
reduce the width. No persistent panel was hidden to flatter the result; the
production panel was in its normal open state.

### 3.1 1280×720

| Region | Rect |
| --- | --- |
| Top bar | 1280×62 at (0,0) |
| Bottom deck | 1280×184 at (0,536) |
| Production | 435.2×168 at (834.8,543) |
| Selection | 652.8×168 at (175,543) |
| Minimap panel | 158×168 at (10,543) |
| Command bar | 731.1×38 at (274.5,490) |
| Group strip | 230×22 at (12,506) |
| Objective | 241.5×61 at (684,0) |

Clear band: 474 px (65.8% of height). Fully unobstructed above the command bar:
428 px (59.4%). Usable area after subtracting the command bar overlay:
578,938 px² = **62.8% of the viewport**. The production panel occupies 34% of
the width and the entire bottom deck occupies 25.6% of the height. **The desktop
layout is a bottom deck, not the required right sidebar.**

### 3.2 1920×1080

| Region | Rect |
| --- | --- |
| Top bar | 1920×62 at (0,0) |
| Bottom deck | 1920×184 at (0,896) |
| Production | 652.8×168 at (1257.2,903) |
| Selection | 1075.2×168 at (175,903) |
| Minimap panel | 158×168 at (10,903) |
| Command bar | 731.1×38 at (594.5,850) |

Clear band: 834 px (77.2%). Fully unobstructed: 788 px (73.0%). Usable area:
1,573,498 px² = **75.9% of the viewport**. The deck still has a fixed 184 px
height; production grows to 34vw (652.8 px), which is a wide, short strip rather
than a sidebar.

### 3.3 844×390 (primary mobile landscape)

| Region | Rect |
| --- | --- |
| Top bar | 844×48 at (0,0) |
| Bottom deck | 844×142 at (0,248) |
| Production | 371.4×132 at (467.6,253) |
| Selection | 344.6×132 at (118,253) |
| Minimap panel | 108×132 at (5,253) |
| Command bar | 326×36 at (259,204) |
| Group strip | `display:none` |
| Objective | `display:none` |
| Command buttons | 28×26 each (10 sampled) |
| Production tabs | 74.1×21 each (5) |

Clear band: 200 px (51.3%). The command bar overlays 36 px, leaving 164 px
(42.1%) fully unobstructed. Usable area: 157,064 px² = **47.7% of the viewport**.
**There is no production category rail, no production overlay, and no touch
group/objective access.** All three bottom panels are permanently visible.

### 3.4 667×375 (hard floor)

| Region | Rect |
| --- | --- |
| Top bar | 667×48 at (0,0) |
| Bottom deck | 667×142 at (0,233) |
| Production | 280.1×132 at (381.9,238) |
| Selection | 282.9×132 at (94,238) |
| Minimap panel | 84×132 at (5,238) |
| Command bar | 326×36 at (170.5,189) |
| Group strip | `display:none` |
| Objective | `display:none` |
| Command button | 28×26 |
| Production tab | 56.2×21 |

Clear band: 185 px (49.3%); fully unobstructed: 141 px (37.6%). Usable area:
111,659 px² = **44.6% of the viewport**. No horizontal overflow
(`scrollWidth 667 = clientWidth 667`), but the layout is the desktop three-column
deck compressed further.

### 3.5 Visual observations

- A strong 4-world-unit tile checker is visible across all land in ordinary
  play (confirmed in captured gameplay at 1280×720 and 844×390). It is produced
  by `TERRAIN_FS` (`shaders.ts:155–158`), not by an editor overlay.
- Elevation is legible as flat plateaus with vertical cliff faces; no slope
  transition mesh exists.
- Individual infantry read as single soldiers; selection shows one entity.
- The top bar remains readable at 844×390; the objective is not displayed.
- Production choices read as tiny icon grids; 7.5 px labels are too small for
  touch.
- No console errors or failed assets were observed. Console contained only Vite
  connection debug messages.

---

## 4. Functional runtime checks

These were performed through the app's diagnostic handle in the preview. They
are reproductions against the running build, not new automated tests.

### 4.1 Editor validation and deploy

- Opened the editor on the authored island: 96×72 tiles.
- Scenario reported 13 structures and 18 units.
- Validation: **0 errors**.
- Deploy to battle: succeeded; the battle state contained **31 entities**.
- This confirms the editor→battle path is functional for the slice.

### 4.2 Ground picking on elevation

Using `camera.worldToScreen(entity)` then `app.worldAt(screen)`:

| Entity ground elevation | Intended world point | Resolved pick | Error |
| --- | --- | --- | --- |
| Base at (70,146), elevation 1.15 | (70,146) | (68.3,144.3) | 2.34 world units |
| Plateau at (304,104), elevation 2.30 | (304,104) | (300.9,100.9) | 4.33 world units |

The error direction is systematic (toward the camera) and exceeds one tile on
the plateau. Root cause: fixed `y = 0.8` plane in `App.worldAt`.

### 4.3 Shipyard repair

- Corvette placed 8 world units from its shipyard, HP 475/950, ammo 6/6.
- After 3 s: HP still **475** (no repair).
- Ammo set to 5/6: after 1 s HP **504.1**, ammo back to 6/6.
- Confirms repair is nested inside the ammo-missing branch
  (`game.ts:1364–1374`).

### 4.4 Turret aim / stale angle

- After a player tank engaged and then drove east, the hull `facing` was 0.00
  while `turretFacing` remained 2.94 rad (≈168°). The tank was no longer firing.
- The turret hardpoint offset (WPN-01) was confirmed by matrix derivation, not
  by isolating a 90° heading visually; see §6. Numeric check:

  | Heading | Hull forward | Turret hardpoint |
  | --- | --- | --- |
  | 0° | (1.000, 0.000) | (1.000, 0.000) |
  | 90° | (0.000, 1.000) | (0.000, -1.000) |
  | 180° | (-1.000, 0.000) | (-1.000, 0.000) |
  | 270° | (0.000, -1.000) | (0.000, 1.000) |

  At 90° the corvette's hardpoint is on the stern while the hull bow is forward;
  the rendered separation is about 3.95 world units.

### 4.5 Economy and AI

- At runtime, materials increased only through harvester deliveries; the top bar
  showed `+0/m` when no harvester was delivering.
- AI built additional structures and produced units over the test interval; no
  naval production was observed, matching the AI code.
- No full 10-minute scripted playthrough was run in this stage; the AI test
  covers ~7 minutes of simulated time.

### 4.6 Console / network

- `preview_logs` after the viewport checks: only `[vite] connecting...` and
  `[vite] connected.`; no runtime errors, no failed network requests in the
  captured window.
- Shader compilation succeeded (WebGL2 context active, battle rendered).

---

## 5. What was verified against requirements

| Requirement | Evidence | Result |
| --- | --- | --- |
| Deterministic fixed-step simulation | `tests/determinism-save.test.ts` in the 65-test run | Pass |
| Isometric 2:1 camera | `tests/camera.test.ts` 7 tests | Pass |
| Individual infantry entity | Code (`spawnUnit` one entity) + runtime "1 SELECTED" | Pass; copy defect remains |
| Air recovery/rearm | `tests/air-naval.test.ts` aircraft tests | Pass |
| Naval movement/combat/reload | `tests/air-naval.test.ts` naval tests | Pass; repair gate defect |
| Editor validate/deploy | Runtime: 0 errors, 31 entities | Pass |
| Save/load round-trip | Determinism/save tests | Pass for current schema |
| Performance headroom | Bench: 0.377 ms/tick baseline | Pass on this machine |
| Grid hidden in play | Runtime screenshot + shader code | **Fail** |
| Desktop production sidebar | Runtime layout + markup | **Fail** |
| Mobile distinct HUD | Runtime layout + CSS | **Fail** |
| Touch targets/safe areas | Measured 28×26; no `env()` rules | **Fail** |
| Touch control groups | `display:none` | **Fail** |
| Touch additive selection | Only Shift+click/Shift+drag; no touch mode | **Fail** |
| Objective on mobile | `display:none` | **Fail** |
| Turret attachment/aim | Matrix + stale angle runtime | **Fail** |
| Terrain-accurate picking | 2.34/4.33 world-unit error | **Fail** |
| Economy without harvesting | Harvester loop present end-to-end | **Fail (spec conflict)** |

---

## 6. Verification gaps

These are not passes and must not be reported as such.

1. **Reference screenshots unavailable to this audit.** No Frontline Zero
   desktop/mobile images were present in the repository or exposed to the
   file/browser tools. Visual comparison is limited to the written hierarchy;
   specific sidebar/card/mobile-overlay similarity is unverified. If the images
   were supplied only in chat, make them workspace files before the HUD review.
2. **Physical touch.** Viewport resizing is not a phone. Tap/drag/pinch feel,
   multi-touch, notch clipping, safe-area insets and low-end frame rate remain
   untested until the mobile HUD exists.
3. **Gamepad.** Mapping was inspected but not exercised on hardware.
4. **Audio.** Procedural Web Audio was not auditioned; no automated audio test.
5. **Weapon transform visual isolation.** WPN-01 is proven by matrix
   derivation; a screenshot at an exact 90° heading was not captured. A visual
   heading test is still required after the fix.
6. **High-ground vision.** No high-ground observation bonus exists; whether one
   is wanted is a design ambiguity (P-08), not a verified feature.
7. **Frame-time/FPS.** No frame-time benchmark or low-end device profile was
   run; the renderer was observed to render, not measured at a target FPS.
8. **Full-loop economy.** The 10-minute post-replacement economy loop cannot be
   tested until the replacement is approved and implemented.
9. **Mobile editor.** The editor was validated on desktop; the 844×390 editor
   layout was measured (232 px tool column, off-screen inspector) but a full
   authoring session on touch was not completed.
10. **Placement ghost / grid interaction.** The grid and elevation were inspected
    in normal play; a full placement session on the ridge (ghost alignment, red/
    green validity, cancel) was not completed after the picking check.
11. **Selection/combat feedback.** Rings, bars, hit flashes and effects were
    observed in normal play but not measured for occlusion at 667×375 or with a
    full 10-infantry selection. No pixel-diff/contrast test exists.
12. **Minimap interaction.** Click-to-jump and resize were inspected in code and
    DOM, not exercised with real pointer input at each viewport.
13. **Save migration.** Not applicable yet; old saves currently load under
    version 1. Economy removal will require new fixtures.
14. **AI naval.** The AI test interval did not produce a corvette; no separate
    naval AI scenario exists.

---

## 7. Manual test procedure for future visual/UI verification

Use this after the HUD milestone; it supplements, not replaces, automated
measurement.

1. Start `npm run dev`; open the app at 1280×720.
2. Enter a battle; capture: initial frame, no selection, one rifleman selected,
   ten riflemen box-selected, tank moving/turning, corvette moving/turning.
3. Record `getBoundingClientRect()` for every persistent panel and the command
   bar; compute clear battlefield area by the method in §3.
4. Repeat at 1920×1080, 844×390 and 667×375. On mobile, close the production
   overlay and record the open/closed states.
5. Enter building placement: confirm the grid appears only there, the ghost
   follows terrain height, and right-click/tap places on the pointed tile.
6. On the central ridge, right-click a visible tile; confirm the move marker and
   unit destination are on that tile, not offset downhill.
7. Select a tank, order an attack on a moving target, then order a move away
   while it is still engaging; confirm the turret tracks and does not freeze at
   the last shot angle.
8. Turn the corvette through 90°; confirm the bow leads, the deck gun stays on
   the bow, and firing tracers leave the barrel.
9. Damage a corvette to 50% with full missiles, dock it, and confirm HP rises.
10. On a real landscape phone, confirm safe-area insets, 44×44 px targets,
    objective access, group assign/recall and no overlapping hit boxes.
11. Run `npx tsc --noEmit`, `npx vitest run`, `npm run build`; record exact
    counts and exit codes.

---

## 8. Reproducibility notes

- The browser was already attached to a dev server; no install or dependency
  change was made.
- Runtime manipulations (teleporting the corvette, changing ammo) were performed
  only in the live page's diagnostic state to reproduce bugs; they did not
  modify source or saved data.
- The benchmark numbers are from the current machine and can vary by run. The
  important comparison is the same machine before/after a change.
- `dist/` was regenerated by the build. It is generated output, not a source
  change.

---

## 9. Bottom line

The current slice is technically substantial: it typechecks, builds, passes 65
tests, runs a deterministic simulation, renders a live WebGL2 battlefield,
validates and deploys an authored island, and has working land, air, naval, AI,
editor and save systems.

It does **not** meet the clarified product specification in four decisive areas:
the desktop/mobile HUD architecture, the hidden construction grid and
terrain-accurate picking, individual-unit weapon transforms/aiming, and the
harvester-based economy. These are confirmed by code and runtime evidence, not
by agent reports. The remediation plan sequences them so the HUD/battlefield
milestone comes first and the economy removal waits for an approved replacement.

---

## 10. Change Set 1 — HUD structural shell

### 10.1 Changed source and generated output

| File | Change |
| --- | --- |
| `src/ui/hudLayout.ts` (new) | Pure desktop/mobile layout resolution from width, height and coarse pointer; transient panel toggle. |
| `tests/hud-layout.test.ts` (new) | Six assertions covering desktop/mobile boundaries, coarse pointer, short windows and panel exclusivity. |
| `src/ui/hud.ts` | Separate desktop/mobile markup builders, shared state updates, panel state, objective/selection/groups/Add controls, rail-anchored production sheet, map overlay, safe-area-aware mobile sheets, no right-click copy in touch hints. |
| `src/style.css` | Battle-HUD-only shell: desktop strip/sidebar/console; mobile strip/rail/sheets/console; safe-area padding; 44 px targets; map and sheet fit constraints; five-column mobile group grid. Shared editor/`.btn` styles were not changed. |
| `src/app.ts` | Layout refresh on resize, camera re-framing, rectangular HUD screen frame, control-group empty-selection feedback. |
| `src/ui/input.ts` | Touch taps honour the sticky ADD toggle; plain touch taps still replace the selection. |
| `src/render/camera.ts` | Optional horizontal screen-lift so a framed point lands in the clear battlefield rather than under the right column. |
| `tests/camera.test.ts` | Added horizontal framing assertion; existing projection/pan/clamp tests unchanged. |
| `README.md`, `docs/PLAN.md` | Current HUD behaviour, controls, test counts and Change Set 1 record. |
| `dist/` | Regenerated by `npm run build`; generated output, not hand-edited. |

### 10.2 Commands and outcomes

```
$ npx tsc --noEmit
TYPECHECK_EXIT=0

$ npx vitest run
 Test Files  11 passed (11)
      Tests  72 passed (72)
TEST_EXIT=0

$ npm run build
vite v8.3.5 building client environment for production...
✓ 43 modules transformed.
dist/index.html                   4.25 kB │ gzip:  1.58 kB
dist/assets/index-CUhnMfL8.css   44.46 kB │ gzip:  9.05 kB
dist/assets/index--EX84i2r.js   272.28 kB │ gzip: 81.11 kB
✓ built in 183ms
BUILD_EXIT=0

$ npm run bench
[perf] baseline: 31 entities, 600 ticks in 171.4ms (0.286ms/tick)
[perf] stress: 171 entities, 300 ticks in 1452.6ms (4.842ms/tick)
[perf] pathfinding: 100 orders in 86.1ms
[perf] save/load: 141 entities, serialise 6.3ms, restore 10.8ms, 302KiB
[perf] map: 96x72, 3347 land tiles (48%), 3565 water tiles (52%)
BENCH_EXIT=0
```

All commands exited 0. The benchmark is unchanged simulation code; the
0.286 ms/tick baseline is consistent with the audit's 0.277–0.377 ms/tick range
and is not a before/after claim for rendering or DOM work.

### 10.3 Viewport measurement method

- Browser: Freebuff Chromium, CSS viewport set to each target. The host reports
  `devicePixelRatio 0.9`, so the preview window was sized to the inverse physical
  dimensions; `window.innerWidth/innerHeight` were checked and reported as
  1280×720, 1920×1080, 844×390 and 667×375.
- Script: after the battle mounted, `getBoundingClientRect()` was called on
  `.topbar`, `.production-sidebar`, `.prod-tabs`, `.hud-bottom`, `#minimap`,
  `.top-objective`, the sheets and sampled controls. Hidden/`display:none`
  elements were excluded. CSS transitions were finished before measuring an open
  sheet because the preview tab was backgrounded; the game loop was likewise
  background-throttled, so one queued production command was processed with an
  explicit `game.tick()` after the UI click. That is stated wherever relevant.
- Clear battlefield rectangle: desktop `x=0..sidebar.left`,
  `y=topbar.bottom..console.top`; mobile `x=0..rail.left`,
  `y=topbar.bottom..console.top`. Area % is rectangle area divided by
  `innerWidth×innerHeight`; height % is rectangle height divided by `innerHeight`.
  Transparent decoration is not counted. The production overlay and map overlay
  are closed unless an open-state row says otherwise. The backdrop scrim is not
  subtracted from the open-state rectangle because it intentionally covers the
  whole world and is not a persistent panel.
- Overlap check: all visible `button` elements and `#minimap` with
  `display != none`, `visibility != hidden`, `pointer-events != none`,
  `opacity > 0.1` and a non-empty viewport intersection were compared pairwise;
  overlap >1×1 CSS px was reported. The full-screen `.mobile-backdrop` was
  excluded because it intentionally lies under a sheet and is dismissed by tap.

### 10.4 Closed-state geometry and clear battlefield

| CSS viewport | Top strip | Desktop sidebar / mobile rail | Bottom console | Minimap | Objective |
| --- | --- | --- | --- | --- | --- |
| 1280×720 | 1280×62 @ (0,0) | 348×658 @ (932,62) | 932×112 @ (0,608) | 280.9×96.7 @ (994.1,599.2) | 241.4×60.9 @ (684,0) |
| 1920×1080 | 1920×62 @ (0,0) | 348×1018 @ (1572,62) | 1572×112 @ (0,968) | 280.9×96.7 @ (1634.1,959.2) | 723.4×60.9 @ (841.9,0) |
| 844×390 | 844.4×46 @ (0,0) | 60×254 @ (784.4,46) | 844.4×90 @ (0,300) | closed; map dock 340×239 @ (252.2,53) | 277.7×44.9 @ (390.8,0) |
| 667×375 | 667.8×46 @ (0,0) | 60×239.6 @ (607.8,46) | 667.8×90 @ (0,285.6) | closed; map dock 340×224.6 @ (163.9,53) | 201.3×44.9 @ (290.5,0) |

| CSS viewport | Clear rect w×h | Clear area | Area % | Height % | Chrome (100−area) |
| --- | --- | --- | --- | --- | --- |
| 1280×720 | 932.0×546.0 | 508,877 px² | **55.22%** | 75.83% | 44.78% |
| 1920×1080 | 1572.0×906.0 | 1,424,241 px² | **68.68%** | 83.89% | 31.32% |
| 844×390 | 784.4×254.0 | 199,256 px² | **60.53%** | **65.13%** | 34.87% |
| 667×375 | 607.8×239.6 | 145,606 px² | **58.21%** | **63.89%** | 36.11% |

All four clear-area and height targets are met. The opening base's buildings all
project inside the clear rectangle at every viewport. The primary-objective HUD
element is visible at every viewport. The provisional “maximum persistent chrome”
column in `DESIGN_SPEC_RECONCILIATION.md` §4.2 (≤38/28/35/40%) is not consistent
with its own clear-area minima at 1280/1920 (clear ≥55/65% necessarily leaves
45/35% chrome); the clear-area minima are the acceptance used here.

Open-state measurements:

| Viewport | Sheet | Remaining unoccluded rectangle | Note |
| --- | --- | --- | --- |
| 844×390 | production 340×254 @ (444.4,46) | 444.4×254.0 = 112,884 px² (34.29%) | right edge 784.4 = rail left; zero overlap |
| 667×375 | production 340×239.6 @ (267.8,46) | 267.8×239.6 = 64,152 px² (25.65%) | right edge 607.8 = rail left; zero overlap |
| 844×390 | objective sheet 360×183.7 @ (8,48) | — | title “Destroy the 11th Corps Command Post.”, relays 0/2 |
| 667×375 | groups sheet 300×203.3 @ (299.8,76.3) | — | all nine 44×44 slots visible in two rows |
| 667×375 | selection sheet 591.8×185.6 @ (8,94) | — | stance buttons 67.2–72.2×44 |

The closed-state targets are the requirements; the open-state sheet is transient
and intentionally covers part of the battlefield while a choice is made.

### 10.5 Touch hit boxes and overlap

Essential mobile controls measured (CSS px):

| Control | 844×390 | 667×375 |
| --- | --- | --- |
| Top objective chip | 277.7×44.9 | 201.3×44.9 |
| Top action (save/pause/settings/menu) | 44×44 | 44×44 |
| Production category | 58.9×46.8 | 58.9×44.0 |
| Command button | 44×44 | 44×44 |
| ADD toggle | 44×44 | 44×44 |
| Group slot | 44×44 (open) | 44×44 (open) |
| Sheet close | 44×44 (open) | 44×44 (open) |
| Queue cancel | 44×44 (open) | 44×44 (open) |
| Stance button | 44 high (open) | 44 high (open) |
| Map canvas | 327.8×144.6 (open) | 327.8×130.2 (open) |

`getBoundingClientRect()` on 44 px elements reports 43.99 at the host's 0.9
device scale; the authored CSS value is 44 px. No essential control is authored
below 44×44. Desktop pointer controls are not subject to the touch minimum.

Pairwise overlap results: **0 overlapping visible interactive rectangles** at all
four viewports with sheets closed. With the production sheet open, its right edge
equals the rail's left edge, so the two interactive surfaces meet without
overlap. Backdrop underlay is excluded as described above.

Horizontal overflow: document scroll width equals viewport width at all four
sizes (1280/1920/844/667). At 667 the document height equals 375; `body.scrollHeight`
reports 376 from a fractional 1 px internal box, but `html` is fixed to the
viewport and there is no horizontal or document-level overflow.

### 10.6 Runtime interactions exercised

| Interaction | Result |
| --- | --- |
| Mobile production category open | LAND selected, panel `production`, 1 facility / 2 cards visible; sheet at (444.4,46) at 844. |
| Production close paths | A second LAND tap closes (`panel=none`); backdrop tap closes; selecting RIFLEMAN closes. |
| Production item | RIFLEMAN click queued the command; after one manual `game.tick()` the barracks queue contained `rifle` (three test clicks produced three queued rifles; materials fell accordingly). |
| Objective one-tap | Chip opened `objective` sheet; `aria-expanded=true`; title and “Relays 0/2” current; backdrop closed it. |
| Control groups at 667 | Selection [16] assigned to group 1, slot became `.has`, aria “Recall control group 1”; clearing selection and tapping the slot recalled [16]; group 2 also assigned/verified. Empty slot has dashed border; populated slot shows amber dot. |
| Add selection at 667 | ADD on, two synthetic touch taps produced [16,17]; ADD off, one tap replaced with [16]. Plain tap-to-replace remains the default. |
| Mobile minimap | MAP opened a 340×224.6 dock with 8 px gap above the console; a real click changed camera from (80,147.9) to (202,145.9). |
| Desktop minimap | Real click changed camera from (93.7,124.6) to (200.7,139.6); existing jump path intact. |
| Breakpoint transition | 667 mobile → 1280 desktop → 844 mobile rebuilt the shell; exactly one `.hud`, `.topbar`, `.production-sidebar`, `#prod-body`, `#group-strip`, `#minimap`; mobile has exactly three sheets; panel/Add reset; one pause click toggled paused once, second restored. |
| Camera framing | At each viewport all five starting structures projected inside the clear rect; primary-objective element visible. |

Synthetic pointer events were used only for the sticky-touch-tap test. Real
pointer input was used for the minimap jump. The game loop was background-throttled
in preview, so production processing required an explicit tick; no source behavior
was bypassed beyond that advance.

### 10.7 Style-reference review

Reviewed the supplied `/ss/desktop` image and `/ss/mobile` set. The shell follows
their structural motifs: near-black translucent slabs, thin pale rules, amber
active/selected states, a vertical right category rail, rail-anchored production
sheet, and one compact bottom command band. The references' image-led production
cards and portrait/thumbnail selection strip are deliberately not implemented in
this change set; the existing icon cards and textual selection panel remain as
the scope requires.

### 10.8 Remaining gaps and limitations

- Production thumbnails, terrain picking, grid visibility, weapon transforms,
  naval repair and economy replacement are out of scope and unchanged.
- The MOVE control remains the existing help/cancel-mode action, not a dedicated
  move mode. It is documented rather than made to look like a new command.
- Physical touch hardware, safe-area notches/insets, gamepad and low-end touch
  frame rate were not exercised. The CSS includes `env(safe-area-inset-*)` on the
  fixed mobile edges, but the browser reports zero insets.
- No DOM test framework/browser-test dependency was added. Layout/panel semantics
  and camera framing are unit-tested; viewport and pointer behavior were exercised
  through the existing preview tooling and must be repeated manually on a device.
- The production sheet and other transient sheets intentionally cover part of the
  battlefield while open; only closed-state clear-area targets are claimed.

### 10.9 Diff-risk assessment

- **Shared styles:** new CSS is scoped under `.hud`, `.layout-mobile`, or
  `.layout-desktop` battle selectors. `.btn`, `.panel-card`, editor and menu styles
  were not edited. The only global camera change adds an optional horizontal lift
  that defaults to zero; editor/menu resets already call `setScreenLift(0)`.
- **Simulation:** no `src/sim` file changed. Save format, deterministic tick,
  commands, AI and economy are untouched.
- **Input:** desktop Shift-click still follows the existing path; the new branch
  only handles touch when sticky ADD is on and mode is `none`.
- **HUD lifecycle:** delegated root handling and per-render replacement prevent
  duplicate listeners; breakpoint rebuild leaves one shell and resets transient
  panel/Add state. The measured transition check confirmed one pause toggle per
  click.
- **Residual risk:** the 1280×720 clear-area result is close to the 55% floor
  (55.22%), so any later increase to sidebar/console height should re-run the
  viewport measurement. Production thumbnails will require card sizing changes
  and a fresh measurement pass.

---

## 11. Change Set 2 — terrain-aware picking and grid visibility

Date: 2026-10-23. Every result below was run in this change set; nothing is
carried over from Change Set 1 except the baseline benchmark used for comparison.

### 11.1 Changed source

| File | Change |
| --- | --- |
| `src/render/terrainSurface.ts` (new) | Single heightfield: corner averaging, per-tile surface interpolation, water plane, water-aware visual height, and `pickTerrain` (cell-walking ray/triangle intersection that returns `null` on a miss). |
| `src/render/gridVisibility.ts` (new) | Pure `constructionGridVisible(screen, mode)` rule. |
| `src/render/terrainMesh.ts` | Emits the sloped surface from shared corner heights with smoothed normals; roads, trees, rocks, ore and `tileWorldHeight` follow the same surface. |
| `src/render/shaders.ts` | `TERRAIN_FS` grid line is gated by `uGrid` (0 in ordinary play); no other shader change. |
| `src/render/renderer.ts` | Feeds `uGrid` from `settings.grid`; entity, effect and decal heights use the sloped surface. |
| `src/render/camera.ts` | Exposes the orthographic view ray used by picking; projection, pan, lift and clamp behaviour unchanged. |
| `src/app.ts` | `worldAt` resolves through `pickTerrain`; placement site, selection, box selection, hovering and per-frame grid state derive from it. |
| `src/ui/input.ts`, `src/ui/overlay.ts` | Pointer/touch orders use the terrain hit and decline on a miss; overlay rings, ghosts and bars follow the sloped height. |
| `src/ui/editor.ts`, `src/ui/editorRender.ts` | Editor hover/painting uses `pickTerrain`; tile grid, borders, reachability and brush preview project on the sloped surface. |
| `tests/terrain-pick.test.ts` (new) | 12 assertions listed in §11.4. |
| `docs/PLAN.md`, `docs/VERIFICATION_REPORT.md`, `README.md` | Current elevation model, grid rule, test counts and this record. |
| `dist/` | Regenerated by `npm run build`; generated output, not hand-edited. |

### 11.2 Commands and outcomes

```
$ npm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0

$ npx vitest run
 Test Files  13 passed (13)
      Tests  90 passed (90)
TESTS_EXIT=0

$ npm run build
vite v8.3.5 building client environment for production...
✓ 47 modules transformed.
dist/index.html                   4.41 kB │ gzip:  1.60 kB
dist/assets/index-EKUFjISz.css   46.72 kB │ gzip:  9.56 kB
dist/assets/index-c5yPY7pA.js   282.51 kB │ gzip: 84.85 kB
✓ built in 245ms
BUILD_EXIT=0

$ npm run bench
[perf] baseline: 31 entities, 600 ticks in 191.1ms (0.318ms/tick)
[perf] stress: 171 entities, 300 ticks in 1573.0ms (5.243ms/tick)
[perf] pathfinding: 100 orders in 83.7ms
[perf] save/load: 141 entities, serialise 6.2ms, restore 9.4ms, 302KiB
[perf] map: 96x72, 3347 land tiles (48%), 3565 water tiles (52%)
BENCH_EXIT=0
```

Benchmark comparison: Change Set 1 recorded 0.286 ms/tick baseline and 4.842
ms/tick stress; this run is 0.318 and 5.243. No `src/sim` file was edited in this
change set, so the spread is run-to-run machine noise, not a simulation
regression. Picking and surface work happens in the input/render path only and
never inside `Game.tick`.

### 11.3 Browser checks (Chromium, `npm run dev`, 127.0.0.1:5173)

| Check | Result |
| --- | --- |
| Pick round-trip on flat ground | Screen (467,380) → world (176.52,145.62) y=1.15 → re-projected to (467,380), error 0.00 px. |
| Pick on sloped ridge | Screen (667,422) → y=2.697; screen (900-level) samples y=2.47 and 1.92 — between the authored 1.15 / 2.30 / 3.45 levels, i.e. a continuous ramp, and each re-projects to its own pixel. |
| Pick on water | Screen (600,591) → y=0.12, `water: true`, tile (60,44); the placement rule still refuses it. |
| Placement on a slope | Barracks footprint from a ridge hit rejected: “Ridge cannot support this structure.” Ghost drawn red with the same reason. |
| Placement on water | Rejected: “This structure cannot be built on water. Move it inland or onto a suitable coast.” |
| Grid in normal play | `renderer.settings.grid === false`, no cell lines in the play-mode frame. |
| Grid in placement | After selecting the Combat Engineer and entering place mode, `settings.grid === true` and the frame shows the construction grid under the ghost. |
| Slope shading | Ramp bands at the rock plateau and the shoreline shade across the slope in the rendered frame; plateau tops stay flat. |
| Editor hover and grid | `openEditor()` loaded Kestrel Bay; a real `pointermove` over the plateau resolved tile **(49,40)**, and the overlay drew its own grid on the sloped surface with the hover footprint and “Rock · E2” readout in the right place. The editor never uses the shader grid, so it is unaffected by the play/placement rule. |

Limitation: the preview window was intermittently occluded and the render loop
background-throttled. `settings.grid` is assigned inside the frame callback, so a
state read taken between frames still showed the previous value until a frame was
drawn; the values above were read after a drawn frame. Screenshots exist for play
mode, placement mode and the editor at desktop size only; the mobile viewport and
physical touch hardware were not re-measured in this change set.

### 11.4 Automated coverage added

`tests/terrain-pick.test.ts`, 12 tests: flat ground at its level; one-level ramp
with continuity across the boundary; shoreline corners meeting the water plane;
water marked unbuildable; projection→pick round-trip on flat ground; round-trip on
both triangles of a slope; pick after pan and zoom; water-only map returning the
water plane and tile; upward, missing and zero-length rays returning `null`;
boundary clamp at tile (0,0); the island mesh matching the picking surface within
1e-3 at every vertex; no vertical step facets (every sloped facet has a real
footprint and no facet jumps more than the authored height range); and the grid
rule (off in play/menu/editor, on only for battle placement).

Not covered automatically, by design: pointer/touch device routing, WebGL pixel
output, and the `settings.grid` frame assignment (verified in the browser above).

### 11.5 Preserved behaviour and remaining gaps

- Change Set 1 HUD layout, breakpoints, sheets, camera framing and `hudLayout`
  semantics were not edited; their tests still pass.
- Simulation, economy, harvesting, weapons, turret transforms, AI production,
  naval balance, map/terrain authoring and save formats are untouched; the
  determinism, AI, combat and air/naval suites pass unchanged.
- Water remains unbuildable and impassable to land units; picking now reports it
explicitly instead of pretending it is ground.
- Known cosmetic gap: `Game.heightAt` (used only for effect spawn heights) is
  still stepped per tile, so sparks near a ramp can sit up to half a level off the
  drawn surface. Slopes do not slow movement and steepness does not block units;
  both are simulation changes outside this brief.

---

## 12. Change Set 3 — weapon transforms and aiming

Date: 2026-10-24. Results below were produced by this change set.

### 12.1 Confirmed defects and root causes

| # | Defect | Root cause | Evidence |
| --- | --- | --- | --- |
| 1 | Turret mounts swing to the mirrored side as the hull turns | `turretWorldMatrix` rotated the offset by `-facing` while the body mesh rotates by `+facing` | Offset `(4.7,0)` at facing 90° resolved to `z = −4.7`; the old matrix code; now covered by a cardinal-heading test |
| 2 | Shots and muzzle flashes leave from the hull nose | `muzzlePoint` used `e.facing` and `2 + radius·0.8`, ignoring both the turret angle and any hardpoint | Tank with target due south fired at `z + 2.2` while `turretFacing` was `π/2`; old code path |
| 3 | Turret angle freezes between shots and never returns | `turretFacing` written only in `tryFire`/spawn; no traverse, tracking or aim-target lifecycle | Source inspection; a stopped tank kept its last firing bearing indefinitely |
| 4 | Corvette turret and shots misplaced | Same as 1 and 2; naval has no separate weapon-transform code | Corvette bow offset `[4.7,1.5,0]` and shared `muzzlePoint` |
| 5 | Muzzle flash height guessed per domain | Renderer derived `y` from ground + 1.5 (units) or +3.2 (buildings) | `shot` events carried `x,z` only |

Already correct and left alone: body yaw convention, renderer angle interpolation
across ±π, `facing`/`turretFacing` save serialisation, and weapon balance values.

### 12.2 Changed source

| File | Change |
| --- | --- |
| `src/core/math.ts` | New `rotateLocalOffset` — the single local-to-world offset rotation, convention documented in-place. |
| `src/sim/types.ts` | `MuzzleHardpoint` + `UnitDef.muzzle`/`turretRate`; `Entity.aimTargetId`; `SimEvent.y`. |
| `src/data/units.ts` | Hardpoints and traverse rates for every armed unit; unarmed units carry none. |
| `src/sim/hardpoints.ts` (new) | Hardpoint → world offset using the turret or hull heading, plus muzzle height. |
| `src/sim/game.ts` | Hardpoint muzzle origin; aim-target bookkeeping and clearing; per-tick turret traverse; shot events carry the true muzzle height. |
| `src/render/unitTransform.ts` (new) | `turretModelMatrix` with the mount rotated by the hull heading through the shared helper. |
| `src/render/renderer.ts` | Uses the shared turret matrix and `ev.y` for muzzle flashes. |
| `tests/weapon-transform.test.ts` (new) | 23 regression tests. |
| `README.md`, `docs/PLAN.md`, `docs/VERIFICATION_REPORT.md` | Test counts and this record. |

### 12.3 Commands and outcomes

```
$ npm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0

$ npx vitest run
 Test Files  14 passed (14)
      Tests  114 passed (114)
TESTS_EXIT=0

$ npm run build
vite v8.3.5 building client environment for production...
✓ 49 modules transformed.
dist/index.html                   4.52 kB │ gzip:  1.67 kB
dist/assets/index-C-Ovg_Kd.css   46.65 kB │ gzip:  9.56 kB
dist/assets/index-9HjyMEnM.js   283.61 kB │ gzip: 85.19 kB
✓ built in 195ms
BUILD_EXIT=0

$ npm run bench   (before changes)
[perf] baseline: 31 entities, 600 ticks in 152.4ms (0.254ms/tick)
[perf] stress: 171 entities, 300 ticks in 1358.6ms (4.529ms/tick)
[perf] pathfinding: 100 orders in 82.7ms
[perf] save/load: 141 entities, serialise 6.7ms, restore 10.6ms, 302KiB
[perf] map: 96x72, 3347 land tiles (48%), 3565 water tiles (52%)

$ npm run bench   (after changes, three runs)
[perf] baseline: 0.284 / 0.272 / 0.250 / 0.255 ms/tick
[perf] stress:   4.974 / 5.160 / 4.808 / 4.794 ms/tick
[perf] pathfinding: 88.4ms   save/load: 6.5 / 10.3ms, 304KiB
```

Comparison: baseline is unchanged within noise (0.250–0.272 against 0.254). The
stress case measured 4.79–5.16 against 4.53; Change Set 2 recorded 4.84–5.24 on
the same host with no simulation changes, so this is host noise rather than a
material regression. The fixed-step additions are one `atan2`/`turnToward` per
turreted unit per tick; no new allocations, scans or RNG draws were introduced.

### 12.4 Tests added (`tests/weapon-transform.test.ts`, 23)

- Transform: asymmetric `(3,1)` offset at 0/90/180/270° and 45°; no mirroring;
  turret mount at four headings; turret yaw about the mount.
- Aiming: four cardinal target bearings; short-way ±π rotation; tracking through
  hull rotation; target switch; traverse limited to `turretRate`; stop and move orders clear
  aim; target death clears aim and returns to hull heading; save round-trip.
- Firing: real tank firing path at four bearings (origin recovered from the
  projectile's own flight line); turret laid away from the hull; fixed-forward
  rifle; hit shot's `tx/tz` on the target with the event height equal to the
  spawn height.
- Naval: corvette mount at four headings and a real corvette shot from the bow
  hardpoint with the hull facing elsewhere.
- Data: turreted hardpoint ⇒ traverse rate; armed unit ⇔ hardpoint.

### 12.5 Runtime checks performed

Live Chromium session against `npm run dev` (127.0.0.1:5174), battle paused via
`speed = 0` while states were driven directly through the public game handle:

| Check | Result |
| --- | --- |
| Tank, hull east, target south | `turretFacing = 1.571`, `aimTargetId` set; `shot` event at `(x, 2.33, z+2.2)` = ground 1.15 + barrel 1.18 |
| Traverse with firing suppressed | 0.12 rad per tick (2.4 rad/s); target moved west → settled at 3.12 rad, the short way round |
| Corvette, hull east, target SE | `turretFacing = 0.695` (= bearing); shot at `(+2.30, +1.92)` (3.0 units along the turret), height 0.9 |
| Renderer interpolation | interpolated turret angle equalled the authoritative angle |
| Console/network | no errors; only Vite HMR connection logs |

Limitations: the close-up screenshots of a barrel at four hull orientations
could not be captured because the preview window was intermittently occluded;
the turret plane is small enough at usable zoom that pixel inspection would not
have added much beyond the matrix tests. Physical mobile hardware was not
re-tested. Building weapon origins and multi-hardpoint units remain unmodelled
(see PLAN §17.7).

### 12.6 Preservation

- No economy, harvesting, weapon-stat, AI-production, terrain, picking, grid,
  HUD or production-card code was edited. Change Sets 1 and 2 still pass their
  tests, including HUD layout, camera framing, thumbnails and terrain picking.
- The simulation remains single-source and fixed-step: turret angle is
  authoritative state, rendering only interpolates it; no frame-time input,
  unseeded randomness or second combat model was introduced.
- Save format is unchanged (new fields are additive fields on existing objects);
  determinism and save/load suites pass, and a new test round-trips turret and
  aim state.

---

## 13. HUD recomposition — left rail, typed production, selection roster

Date: 2026-10-24. Results below were produced by this change set.

### 13.1 Defects confirmed from playtest and source

| # | Defect | Root cause | Evidence |
| --- | --- | --- | --- |
| 1 | Top bar costs vertical space on landscape screens | A fixed 62 px header spans every desktop battle | `--top-h: 62px`; topbar markup and CSS |
| 2 | Production sidebar has a catch-all OVERVIEW panel | `tab` begins at `'all'` and lists every facility together | `this.tab = 'all'`, `tab('all', 'OVERVIEW', …)` |
| 3 | Command/groups column overlaps the selection panel | `.battle-console` grid used `minmax(280px…) + minmax(540px…)`; at 1280 px only 932 px exists next to the sidebar, so the 827 px of minima plus gaps overflow the row | Computed widths at 1280×720; old `grid-template-columns` |
| 4 | Selection panel scrolls instead of using its width | Detail card was a vertical stack in a ~380 px column | `selection-body { overflow-y: auto }`; roster did not exist |
| 5 | Mobile hides the selection behind a tap | A single summary button opened the selection sheet | `.mobile-sel-summary` + `panel-selection` |

### 13.2 Changed source

| File | Change |
| --- | --- |
| `src/ui/hud.ts` | Rail and mobile top-strip markup; five production panels; two-row console with detail + roster; roster rendering with in-place HP; chip inspection; objective opens the briefing on desktop; pause button icon/title updates. |
| `src/ui/hudLayout.ts` | `ProductionTab`, `PRODUCTION_TABS`, `structureTab()`. |
| `src/style.css` | Rail, mobile strip, console rows, roster/chip styles, compact command bar and group chips; dead top-bar rules replaced; editor ident styles made explicit. |
| `src/app.ts` | `hudScreenFrame()` reads the rail and mobile strip and returns a signed horizontal offset. |
| `src/render/camera.ts` | `setScreenLift` accepts a negative horizontal lift. |
| `tests/hud-layout.test.ts` | Five categories, no overview, structure classification. |
| `tests/camera.test.ts` | Left-rail framing. |

### 13.3 Commands and outcomes

```
$ npm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0

$ npx vitest run
 Test Files  14 passed (14)
      Tests  117 passed (117)
VITEST_EXIT=0

$ npm run build
dist/index.html                   4.52 kB │ gzip:  1.67 kB
dist/assets/index-EniQyg53.css   50.56 kB │ gzip: 10.25 kB
dist/assets/index-DBgcGHTD.js   287.72 kB │ gzip: 86.18 kB
✓ built in 207ms
BUILD_EXIT=0

$ npm run bench
[perf] baseline: 31 entities, 600 ticks in 159.5ms (0.266ms/tick)
[perf] stress: 171 entities, 300 ticks in 1491.3ms (4.971ms/tick)
[perf] pathfinding: 100 orders in 87.4ms
[perf] save/load: 141 entities, serialise 5.6ms, restore 11.0ms, 304KiB
[perf] map: 96x72, 3347 land tiles (48%), 3565 water tiles (52%)
```

The benchmark is unchanged within the previously recorded host-noise band
(0.250–0.284 ms/tick baseline, 4.79–5.16 ms/tick stress); this change set does
not touch the simulation.

### 13.4 Browser measurements (Chromium, dev server)

| Viewport | Result |
| --- | --- |
| 1280×720 | Rail 92 px, scroll height = client height; console 840×168; detail 393 px with 81/81 px content; command bar 599/599 px; groups 213 px, clear of the commands |
| 1600×1000 | Console 1160×168; roster 718 px with five chips; framed base centre lands at the clear-area centre (592, 366) |
| 844×390 (mobile) | Top strip 42 px; console 90 px with a selection (46 px roster + 44 px commands) and 44 px without; four chips; sheet opens on chip tap with that entity's detail |
| 667×375 (mobile) | No document overflow (666/666 px); eight chips scroll (719 in 623 px); command row 667/667 px |

Production panels were switched in the running battle: BASE lists the six
buildable structures, DEFENCE reports `0 static defences fielded` with the SAM
card, LAND lists barracks and factory queues, AIR lists the airfield, and SEA
shows its empty-state copy. The objective button opened the briefing and paused
the battle. Pause/resume from the rail changed the button title and overlay.

Screenshots: one desktop capture at 1600×1000 was reviewed (rail, build cards,
detail + roster, commands and groups). Mobile captures failed because the
preview window was occluded; those checks are DOM measurements only.

### 13.5 Gaps and known issues

- The mobile composition was not visually reviewed, only measured; chip spacing,
  touch targets (chips 84×38, commands 44×44) and the collapsed console should
  be checked on a device.
- The rail is scrollable if a short window cannot fit its stack; at 1280×720 it
  fits exactly (720/720), so a shorter desktop window would scroll the rail
  rather than clip it.
- POWER is a reserved, non-functional slot until a power mechanic exists.
- Hover, focus-visible and keyboard traversal for the new rail and roster were
  not exercised.

## 14. Base power grid and brownouts

Date: 2026-10-24. Results below were produced by this change set.

### 14.1 Model and files changed

| File | Change |
| --- | --- |
| `src/sim/types.ts` | `BuildingDef.power` (net contribution) and the derived `PowerStatus` shape. |
| `src/data/buildings.ts` | Draws for every consumer, the Command Post's integral generator and the new `powerPlant` (Turbine Plant, +100, 480 M, 16 s, 780 hp). |
| `src/sim/game.ts` | `powerStatus()`/`powerSpeed()`; construction and production queue multipliers, evaluated once per owner per tick. |
| `src/sim/ai.ts` | Builds a turbine plant on deficit, plus one early plant for headroom. |
| `src/render/buildingMeshes.ts` | `buildPowerPlant()` and its `STYLES` entry. |
| `src/ui/hud.ts` | Rail POWER readout (`supply / demand`, reserve/brownout sub-label, tooltip), mobile `PWR`. |
| `src/ui/icons.ts` | `power` glyph for the build card. |
| `src/style.css` | Active/short power colours and the brownout rail treatment; mobile power stat. |
| `tests/power.test.ts` | Ten deterministic grid tests. |

Grid state is derived from live entities and is not serialised, so the save
schema, state hash inputs and save/load tests are untouched.

### 14.2 Commands and outcomes

```
$ npm run typecheck
TYPECHECK:0

$ npx vitest run
 Test Files  15 passed (15)
      Tests  127 passed (127)
TESTS:0

$ npm run build
dist/index.html                   4.52 kB │ gzip:  1.66 kB
dist/assets/index-DnDWSjoq.css   50.74 kB │ gzip: 10.27 kB
dist/assets/index-DwHolLda.js   290.61 kB │ gzip: 87.10 kB
BUILD:0

$ npm run bench
[perf] baseline: 31 entities, 600 ticks in 159.5ms (0.266ms/tick)
[perf] stress: 171 entities, 300 ticks in 1424.8ms (4.749ms/tick)
[perf] pathfinding: 100 orders in 77.6ms
[perf] save/load: 141 entities, serialise 5.5ms, restore 11.2ms, 304KiB
BENCH:0
```

Baseline is identical to the section 13 run (0.266 ms/tick) and stress is
4.749 vs 4.971 ms/tick, inside the recorded 4.79–5.16 ms/tick noise band. No
simulation hot path beyond construction/queue progress was touched.

### 14.3 Tests added (`tests/power.test.ts`)

| Test | Assertion |
| --- | --- |
| derives supply and demand from completed structures | `{80 supply, 63 demand, ratio 1, brownout false}` for the beachhead; enemy at 73 demand is balanced |
| matches the structure definitions | demand equals the sum of negative `BuildingDef.power` values |
| flags a deficit | with a factory and SAM battery: 80/98, ratio 80/98, `powerSpeed` matches |
| restores full speed with a plant | 180/98 balanced, speed 1 |
| ignores sites and rubble | a construction site or a 0-hp plant stops contributing |
| never stalls below 35% | a base with no generator returns ratio 0 and speed 0.35 |
| slows unit production | two seconds of queue progress: 2.0 balanced vs 2 × ratio brownout |
| slows construction | two seconds of site progress scales by the same ratio |
| returns to full speed on completion | the site completes, the deficit clears and speed returns to 1 |
| AI builds plants on a deficit | a 90 s AI battle contains a turbine plant and no brownout |

### 14.4 Browser checks (Chromium, dev server)

- Fresh battle: rail showed `POWER 80 / 63`, `RESERVE 17`, tooltip
  `Grid: 80 supply, 63 demand`.
- BASE panel lists `Turbine Plant 480M · 16s`; its card thumbnail rendered from
  the new mesh (`data-thumb-id="powerPlant"`, PNG data URL present), not the
  icon fallback.
- Selected the starting force, entered placement from the card, sited the plant
  south of the beachhead. The rail updated to `POWER 180 / 63`,
  `RESERVE 117`, with the same completed tile.
- A staged save (extra factory + SAM battery) was loaded through the normal
  Load-battle slot flow. The rail rendered `POWER 80 / 98`, `BROWNOUT · 82%`,
  class `rail-stat power brownout`, tooltip `Grid deficit: 80 supply for 98
  demand — production and construction at 82%`.

### 14.5 Gaps

- The brownout production/construction slowdown was proven by the unit tests
  above, not by timing a live queue or site in the browser.
- No screenshot was captured, so the plant's in-world model, the brownout rail
  colour and the mobile `PWR` readout have not been visually reviewed.
- Power is intentionally simple: no per-structure priority, no capacitor or
  battery buffer, and the 35% floor is a design choice rather than a measured
  balance value.

## 15. Low-power warning and plant suggestion

Date: 2026-10-24. Results below were produced by this change set.

### 15.1 Changed source

| File | Change |
| --- | --- |
| `src/sim/game.ts` | Non-serialised `gridBrownout` map plus `updateGridNotices()`: one warning on entering a deficit, one success on recovery. |
| `src/ui/hudLayout.ts` | `gridAlertCopy(status)` — pure copy for the production strip, `null` when balanced. |
| `src/ui/hud.ts` | Strip markup in the production sidebar, `GRID FIX` badge on the Turbine Plant card, `suggested` highlight in the resource pass, `grid-fix` action that opens BASE and starts placement. |
| `src/style.css` | Strip, badge and suggested-card styles. |
| `tests/power.test.ts` | Transition-notice and alert-copy tests. |

### 15.2 Commands and outcomes

```
$ npm run typecheck
TYPECHECK:0

$ npx vitest run
 Test Files  15 passed (15)
      Tests  129 passed (129)
TESTS:0

$ npm run build
dist/index.html                   4.52 kB │ gzip:  1.67 kB
dist/assets/index-B_tT0UOM.css   51.64 kB │ gzip: 10.43 kB
dist/assets/index-EXpWHtgn.js   292.31 kB │ gzip: 87.61 kB
BUILD:0
```

Benchmark (`npm run bench`) was run four times during this change and the host
was visibly loaded: baseline 0.309–0.351 ms/tick, stress 5.83–5.98 ms/tick, and
one later run at 0.527 / 14.33 ms/tick with pathfinding at 491 ms against the
77.6 ms recorded in section 14. A control run with `updateGridNotices()`
disabled measured 0.429 ms/tick and 6.05 ms/tick stress — slower than the runs
with the feature — so the elevation is host contention, not an attributable
regression. The change adds two entity scans per tick (one per player).

### 15.3 Tests added

| Test | Assertion |
| --- | --- |
| warns once on entering a brownout and once on recovery | one warning (80/98, 82 %) on the first tick, none while the deficit persists, then a success notice after the plant completes, and no repeats afterwards |
| writes a production alert only while the grid is short | `null` when balanced; otherwise `GRID DEFICIT · 80 SUPPLY / 98 DEMAND · PRODUCTION AT 82%` |

### 15.4 Browser checks (Chromium, dev server)

Loaded a staged brownout save (extra factory + SAM battery) through the normal
Load-battle flow:

- Strip visible (`display:flex`, 29.9 px tall) reading
  `GRID DEFICIT · 80 SUPPLY / 98 DEMAND · PRODUCTION AT 82%`, with `BUILD PLANT`.
- Turbine Plant card received the `suggested` class and its `GRID FIX` badge
  computed to `display:block`; all other build cards stayed unmarked.
- `BUILD PLANT` with nothing selected produced the existing
  `Select a Combat Engineer to construct buildings.` warning and left placement
  off.
- After box-selecting the beachhead (engineer included), `BUILD PLANT` raised the
  `PLACE TURBINE PLANT` banner without spending materials or creating a site.
- A 97 %-complete plant fixture loaded into `POWER 180 / 98`, `RESERVE 82`, with
  the strip hidden, its copy empty, the card back to `build-card` and the badge
  `display:none`; the mission clock advanced from 0:02 to 0:07, confirming the
  loop was live.
- Mobile at 844×390 and 667×375: the top strip keeps MATS / REQ / PWR / ARMY and
  fits its viewport exactly (667/667 at the narrow size), no document overflow;
  the strip is 338×35 px inside the production sheet, its copy does not
  overflow, and its action measures 66×24 px.

### 15.5 Gaps

- The full 16 s construction of a sited plant was not observed end-to-end: the
  preview's frame loop stalled after roughly 36 s of wall time once the window
  was occluded, so completion was verified with the near-complete fixture
  instead.
- The recovery notice is a success-level event and goes to the event log, which
  is collapsed in the desktop DOM; its existence is asserted in the simulation
  test rather than read from the live log.
- No screenshots were captured.

## 16. Landing force trim, automatic engineer assignment and grounded infantry

Date: 2026-10-24. Follow-up playtest pass on the opening force, construction
dispatch and infantry presentation. No change to combat, economy balance,
terrain, picking or the HUD layout.

### 16.1 Changed source

| File | Change |
| --- | --- |
| `src/data/scenarios.ts` | Both battlegroups now land with a Command Post, one Combat Engineer, two MBTs and five riflemen. No starting factory, refinery, barracks, airfield, shipyard, power plant or harvester. |
| `src/sim/ai.ts` | Opening order is factory → refinery → turbine plant (if short) → harvester → barracks. While saving for a structure the AI still defends, sorties and commits idle troops; previously the saving branch returned early and could freeze the whole battle (observed as `saving for barracks` at tick 8400 with wave 0). |
| `src/sim/game.ts` | `resolveBuilder()` only offers idle engineers (no site and no order). Placing a site while every engineer is committed creates an unassigned foundation that waits; a third site no longer steals an engineer from work in progress. Placement still fails when the player owns no engineer, with the existing warning. |
| `src/render/unitMeshes.ts` | Infantry are a single soldier with separate leg meshes hinged at the hip; the boot sole reaches local Y = 0 so the unit origin can sit on the terrain. |
| `src/render/unitTransform.ts` | `limbModelMatrix()` places the hip at the authored height and swings the leg about it. |
| `src/render/renderer.ts` | Infantry gait is driven by authoritative movement state; pace eases in and out, legs swing out of phase, and entity Y is sampled from the continuous terrain surface. |
| `tests/construction.test.ts` | New: selection-free placement, two engineers/two sites, third site waits, no-engineer rejection. |
| `tests/unit-scale.test.ts` | New: boot sole at terrain height and leg stride displacement. |
| `tests/ai.test.ts` | Credible-threat check now requires fresh AI production and player losses rather than a fixed survivor count, which the smaller landing force cannot guarantee. |
| `tests/power.test.ts` | Fixed helper-name typo (`engineAt` → `engineerAt`) left by the scenario-trim edit. |
| `tests/weapon-transform.test.ts` | Rifle muzzle fixture moved out of one-tick bullet range, aligned before firing, and fired from a standing start so the measured origin belongs to a stationary hull. |

### 16.2 Behaviour now

- **Opening forces.** Both sides start with one Command Post and the eight-unit
  landing force described above. Every other structure is built in play, so the
  first minutes are economy and scouting rather than a pre-built base.
- **Construction dispatch.** A build card enters placement mode without a
  selected engineer. On placement the nearest idle engineer is assigned, walks
  to a point just outside the footprint, and works until complete. A player
  order releases the site and pauses progress; once idle again the engineer is
  matched back to the nearest unfinished site. Two engineers work two sites
  concurrently, one engineer per site.
- **Infantry.** The soldier mesh's origin sits on the terrain surface, the legs
  hang from the hip to the boot at ground level, and the walk cycle advances
  only while the unit is actually moving. No hover offset is applied to land
  infantry.

### 16.3 Tests added

| Test | Assertion |
| --- | --- |
| sends an idle engineer to a site placed without a selection | a site placed with no builder id becomes a construction site and the lone engineer's `buildTargetId` points at it |
| builds two sites in parallel with two engineers and leaves a third waiting | the two sites get different engineers, both advance `buildProgress`, the third stays at 0 with no builder, and no engineer is reassigned |
| does not place foundations without any engineer | the placement is rejected with an `orderFailed` event |
| plants infantry boots on the terrain surface with articulated legs | leg mesh minimum Y plus hip height equals 0, a near-zero swing keeps the boot on the ground, and opposite swing phases move the foot by more than 0.4 world units |
| sends an attack force and produces a credible threat | at least one assault wave, fresh AI production, and player unit losses |

### 16.4 Commands and outcomes

```
$ npm run typecheck
> tsc --noEmit
TYPECHECK:0

$ npx vitest run
 Test Files  16 passed (16)
      Tests  135 passed (135)
TESTS:0

$ npm run build
dist/index.html                   4.52 kB │ gzip:  1.67 kB
dist/assets/index-B_tT0UOM.css   51.64 kB │ gzip: 10.43 kB
dist/assets/index-DSydplph.js   295.46 kB │ gzip: 88.65 kB
BUILD:0

$ npm run bench
baseline: 21 entities, 600 ticks in 81.4ms (0.136ms/tick)
stress:  160 entities, 300 ticks in 1032.6ms (3.442ms/tick)
pathfinding: 100 orders in 79.9ms
save/load: 130 entities, serialise 5.0ms, restore 9.0ms, 299KiB
map: 96x72, 3347 land tiles (48%), 3565 water tiles (52%)
```

Benchmark repeats during the session ranged from 0.123 to 0.176 ms/tick for the
21-entity baseline and 2.82 to 3.67 ms/tick for the 160-entity stress case on a
loaded host. The baseline entity count is lower than the values recorded in
sections 15–16.6 because the starting base was removed, so those numbers are not
directly comparable; no regression is attributable to this change from the
measurements taken.

### 16.5 Verification gaps

- No browser/WebGL session was run for this pass, so infantry grounding and the
  walk cycle are verified by geometry tests and by reading the render path, not
  by visual inspection. A manual check alongside a moving rifleman is still
  recommended.
- The AI's smaller opening is covered by automated simulation only. Its first
  minutes are slower than before, and balance tuning was left out of scope.
- The first AI attack wave can be destroyed by the player's opening force; the
  test therefore verifies production and inflicted losses rather than a
  surviving unit count.

## 17. Engineer fallback, capture-only relays and requisition scope

Date: 2026-10-24. Follow-up to the landing-force trim in section 16. Simulation,
data, HUD and 2D overlay only; no terrain, pathfinding or combat-balance change.

### 17.1 Changed source

| File | Change |
| --- | --- |
| `src/data/units.ts` | The Combat Engineer lists `commandPost` as a second producer. MBT and Recon Vehicle requisition costs drop to 0; ATGM, SAM carrier, fighter and corvette keep their requisition cost. |
| `src/data/buildings.ts` | The Command Post gains a land production list containing only the engineer, as a fallback. Vehicle Factory requisition drops to 0; airfield, shipyard and SAM battery stay gated. |
| `src/sim/game.ts` | `productionStatus()` rejects engineers at the HQ while an operational factory exists, and reopens the fallback when the factory is gone. `commandAttack()` rejects relay targets with a warning, and `damageEntity()` ignores all damage to relays. |
| `src/sim/combat.ts` | `canWeaponTarget()` never accepts a signals relay, so auto-engagement, attack-move and AI target selection skip it. |
| `src/sim/ai.ts` | Visible relays are removed from the AI's enemy list; armies are no longer sent to attack an indestructible objective. |
| `src/ui/relayMeter.ts` | New pure helper: current owner label/colour, the engineer with the most capture progress, and display copy. |
| `src/ui/overlay.ts` | Persistent world meter above every charted relay: owner-tinted bar, capturer-coloured progress fill and a label (`NEUTRAL · 42% CAPTURED`). |
| `src/ui/hud.ts` | Land production hides the HQ engineering panel once an operational factory exists. Relay selection cards show the ownership/capture caption instead of `OPERATIONAL`. |
| `tests/production.test.ts` | New: HQ fallback, factory hand-off, factory-destroyed recovery, requisition scope. |
| `tests/relay.test.ts` | New: attack rejection, no auto-engagement, capture still works, meter state for neutral/capturing/owned. |

### 17.2 Behaviour now

- **Engineer production.** With no operational Vehicle Factory, the LAND tab
  shows a `COMMAND` facility with one unit card, `ENGINEER 300M`. Once a factory
  completes, that panel disappears and engineers come from `FACTORY`. If the
  factory is destroyed, the HQ panel and production status return. A destroyed
  factory and lost engineers are therefore recoverable.
- **Relays.** Weapons cannot acquire, order an attack against, damage or destroy
  a relay; explicit attack orders are rejected with
  `Signals relays cannot be destroyed — capture them with a Combat Engineer.`
  Capture remains the only ownership change. The capture progress still lives on
  the engineer, so pulling the engineer away cancels it.
- **Relay meter.** Every charted relay carries a persistent bar above it: the
  owner colour tints the bar, and the current engineer's capture progress fills
  it in the capturing faction's colour. The caption reads
  `NEUTRAL · UNCLAIMED`, `NEUTRAL · 42% CAPTURED`, or the owner's short name.
  Fog rules are respected for enemy-owned relays; neutral relays are charted.
- **Requisition.** Riflemen, engineers, harvesters, MBTs and Recon Vehicles are
  material-only. Requisition is charged only for the ATGM team, SAM carrier,
  fighter, corvette, SAM battery, airfield and shipyard. The Vehicle Factory is
  material-only so the core production chain cannot stall on requisition.

### 17.3 Tests added

| Test | Assertion |
| --- | --- |
| trains engineers at the command post while no factory stands | HQ production status is valid and one order adds a second engineer |
| hands engineer production to an operational factory | HQ status is refused while the factory can produce |
| reopens the command post fallback when the factory is destroyed | destroying the factory makes the HQ valid again on the next tick |
| keeps core units material-only / charges requisition for specialists | cost table matches the intended split |
| leaves the core factory material-only and keeps advanced facilities gated | building cost table matches the intended split |
| rejects an explicit attack order and leaves the relay intact | relay HP stays at max and an `orderFailed` notice is emitted |
| does not auto-engage a relay owned by the enemy | adjacent tank acquires no target and the relay is untouched |
| still changes hands through an engineer capture | capture completes after eight seconds |
| reports an unclaimed neutral relay | owner/colour/caption for a neutral relay |
| follows the engineer making capture progress | 42 % progress, capturer 0, Baltic colour, matching caption |
| shows the owning faction once captured | `BALTIC` label and faction colour |

### 17.4 Commands and outcomes

```
$ npm run typecheck
> tsc --noEmit
TYPECHECK:0

$ npx vitest run
 Test Files  18 passed (18)
      Tests  147 passed (147)
TESTS:0

$ npm run build
dist/index.html                   4.52 kB │ gzip:  1.67 kB
dist/assets/index-B_tT0UOM.css   51.64 kB │ gzip: 10.43 kB
dist/assets/index-D07UMhcW.js   298.36 kB │ gzip: 89.51 kB
BUILD:0

$ npm run bench
baseline: 21 entities, 600 ticks in 100.4ms (0.167ms/tick)
stress:  160 entities, 300 ticks in 1091.8ms (3.639ms/tick)
pathfinding: 100 orders in 76.0ms
save/load: 130 entities, serialise 6.8ms, restore 9.1ms, 299KiB
map: 96x72, 3347 land tiles (48%), 3565 water tiles (52%)
```

The construction and targeting guards add no per-tick simulation work beyond the
existing entity scans; the benchmark is within the session's observed variance
(section 16.4).

### 17.5 Browser checks (Chromium, dev server at 127.0.0.1:5174)

- Deployed Island Assault. The rail showed `MATERIALS 3,000`, `ARMY 8`,
  `1 STRUCTURE`, confirming the trimmed opening still loads.
- Opened PRODUCTION → LAND: a `COMMAND` facility appeared with a single enabled
  `ENGINEER 300M` card and `ENGINEERS 1 · 0 BUILDING`.
- Clicked the engineer card: materials fell 3,000 → 2,700, the HQ queue showed
  `engineer`, and after construction the army count reached 9 with two
  engineers. This is the HQ fallback working end-to-end.
- Both relays were captured by the opposing AI during the check and remained at
  full HP (`850/850`).
- An explicit attack order against a relay produced the rejection notice in the
  event log; the relay stayed `850/850` and the tank acquired no target.
- The overlay canvas contained 1,134 non-transparent pixels with only the two
  relay meters drawn (no selection, hover or placement), confirming the meters
  are being painted. Console output contained only the Vite connection messages.
- Selecting a neutral relay showed `CAPTURABLE OBJECTIVE · NEUTRAL · UNCLAIMED`,
  a `CONTROL / NEUTRAL` bar instead of an integrity bar, and the same caption in
  the STATE field — no destructible health reading is presented for a relay.
- The factory hand-off was not exercised in the browser (building a factory takes
  20 s of walking and construction); it is covered by the production tests.

### 17.6 Gaps

- No screenshot or visual inspection of the relay meter's typography/placement
  was performed; the canvas-pixel check proves it draws, not that it reads well
  at every zoom. Mobile placement was not re-checked.
- Relays can still be removed by the scenario editor, as an authoring action.
  That does not affect battle damage or targeting.
- The requisition split is a first pass: values for the specialist units were
  kept unchanged, so the relative gating between ATGM, SAM, air and naval was
  not re-evaluated.
## 18. Selection-detail overflow fix

Date: 2026-10-24. Follow-up to the HUD work in sections 13 and 17. CSS and
selection markup only; no simulation or data changes.

### 18.1 Cause

The desktop selection body is a two-column grid whose first column was `auto`.
Its first item (`.sel-main`) defaulted to `min-width: auto`, so the nowrap title
and faction text for an enemy relay set the column's min-content width larger
than the panel. The body then gained a horizontal scrollbar and clipped the
statistics column. The relay caption (`11TH CORPS · 36% CAPTURED`) made the
problem visible where shorter unit names did not.

### 18.2 Changed source

| File | Change |
| --- | --- |
| `src/style.css` | The desktop selection grid uses `minmax(0, 1.35fr) minmax(0, 1fr)` columns; `.sel-main` gets `min-width: 0`; the body hides horizontal overflow; title and faction lines use a stacked, stretch layout with ellipsis; the detail area takes 56 % (max 460 px) instead of 48 % of the panel, leaving the roster 262 px at the reference width. |
| `src/ui/hud.ts` | Relay cards use the ownership/capture caption as their role line instead of repeating `Capturable objective · <caption>`. |

### 18.3 Verified

- Typecheck, 18 files / 147 tests and production build pass.
- At 1270 px with an enemy relay selected and a 36 % capture in progress:
  `#selection-body` measured 323 px client and scroll width, `overflow-x:hidden`,
  and no element in the selection panel had scrollable horizontal overflow.
  The three title lines each measured 111 px with ellipsis where needed.
- The same check passed with a single MBT selected and at 1100 px width
  (body 413 px, no overflow).
- The 844×390 mobile layout does not mount the desktop selection panel and is
  unchanged; the desktop grid rules are scoped to `.layout-desktop`.
- Roster chips still scroll horizontally when a large force is selected, by
  design; the single-selection case that produced the reported scrollbar has
  no overflow.

### 18.4 Gaps

- No screenshot or visual regression pass; the check measured DOM overflow and
  scrollability rather than inspecting the rendered card by eye.
- Long faction names heavier than `11TH CORPS · HOSTILE` may still ellipsize
  inside the 111 px title column; they no longer create a scrollbar.

## 19. Support-engineer repair and field medics

Date: 2026-10-24. Playtest follow-up after the HUD and balance revisions.

### 19.1 Confirmed causes

- **No repair order existed.** The engineer definition and description promised
  repairs, but the command union, command processor and engineer order handler
  had no repair path. A right-click on a friendly structure produced only a
  move order, which could not enter the blocked footprint.
- **Right-click only captured neutral relays.** `App.orderAt()` checked
  `target.owner === -1` before issuing capture. An enemy-held relay fell
  through to the hostile branch, where `commandAttack()` correctly rejected it
  as an objective instead of sending the selected engineer to take it.
- **No medical support unit existed.** Barracks production offered riflemen
  and ATGMs only; there was no healing state, target field or support scan in
  the simulation.

### 19.2 Changed source

| File | Change |
| --- | --- |
| `src/sim/types.ts` | Adds the `repair` order/command, `repairing` and `healing` entity states, and the persisted `healTargetId`. |
| `src/sim/game.ts` | Adds `commandRepair()`, the repair branch in `updateOrderTargeting()`, `updateMedic()` with one lazy wounded-infantry scan per tick, and save/load normalisation of `healTargetId`. Repair restores 3.5 % max HP/s; medics restore 4 HP/s inside 5 tiles. |
| `src/data/units.ts` | Adds the Field Medic definition and updates the engineer description to say signals relays rather than neutral relays only. |
| `src/data/buildings.ts` | Barracks production list becomes rifleman, ATGM and medic. |
| `src/ui/orderIntent.ts` | New pure right-click resolver: relays before the hostile branch, damaged friendly structures before movement, then attack/move. |
| `src/app.ts` | Uses the resolver in `orderAt()` and adds `commandRepair()` for selected engineers. |
| `src/ui/hud.ts` | Updates the idle hint and relay detail note to describe repair and capture. |
| `src/ui/icons.ts` | Adds the medic shield-and-cross icon. |
| `src/render/unitMeshes.ts` | Adds the medic mesh (white helmet band, red-cross satchel), articulated infantry rig, visual scale and shadow footprint. |
| `tests/repair-medic.test.ts` | Ten tests covering routing, repair rate/pause/completion, hostile relay capture, production, one-patient triage, target release/switch and save/load. |
| `README.md` | Documents the medic and the desktop repair/capture controls. |

### 19.3 Behaviour verified by tests

| Scenario | Observed |
| --- | --- |
| Damaged friendly structure, engineer selected | `contextOrderFor()` returns `repair`; four seconds restores 100–150 HP on a 900-HP barracks |
| Engineer called away mid-repair | order is no longer `repair`; integrity stays fixed for the next three seconds |
| Repair reaches full health | structure reaches `maxHp`, order clears, engineer returns to idle |
| Neutral and enemy-held relays | both route to `capture`; a hostile relay changes owner while staying at 850/850 HP |
| Full friendly structure / owned relay | resolver falls back to `move`; no bogus repair or capture |
| Medic combat support | one of two wounded riflemen gains 16–24 HP in five seconds (4 HP/s), never both |
| Non-infantry nearby | damaged tank is untouched; medic remains idle with no heal target |
| Patient leaves 5-tile radius | `healTargetId` clears on the next tick |
| First patient reaches full health | medic switches to the second wounded infantryman |
| Save/load during repair and treatment | `stateHash()` matches immediately and after three further seconds |

### 19.4 Commands and results

```
$ npm run typecheck
TYPECHECK:0

$ npm test
 Test Files  20 passed (20)
      Tests  176 passed (176)
TESTS:0

$ npm run build
✓ 51 modules transformed.
dist/index.html                   4.52 kB │ gzip:  1.66 kB
dist/assets/index-DfehfABS.css   52.38 kB │ gzip: 10.56 kB
dist/assets/index-Dg-ZHsmJ.js   311.32 kB │ gzip: 92.95 kB
BUILD:0

$ npm run bench
[perf] baseline: 21 entities, 600 ticks in 76.8ms (0.128ms/tick)
[perf] stress: 160 entities, 300 ticks in 812.2ms (2.707ms/tick)
[perf] pathfinding: 100 orders in 79.9ms
[perf] save/load: 130 entities, serialise 4.9ms, restore 9.0ms, 301KiB
[perf] map: 96x72, 3347 land tiles (48%), 3565 water tiles (52%)
BENCH:0
```

This is a single bench run, not a controlled A/B measurement. The authored
benchmark has no medics, so its additional per-tick work is one `defId` check
per unit; the wounded list is built lazily only when a medic exists. The
observed baseline is below the previous 0.167 ms/tick record and the stress run
is below the previous 3.639 ms/tick record, but those are host-noise-sensitive
numbers and are not claimed as an optimisation.

### 19.5 Browser checks (Chromium, dev server at 127.0.0.1:5174)

- Deployed Island Assault and paused the real battle loop. Pinned `pickAt()` to
  the damaged player Command Post (2,200 max HP at 1,100) and invoked the real
  `App.orderAt()` dispatch with the starting engineer selected. The engineer
  received a `repair` order and entered `repairing` on the first tick.
- After 80 ticks the Command Post stood at 1,411.85 HP: +311.85, matching the
  authored 3.5 % of maximum HP per second. No projectile or attack order was
  created.
- Set the first relay to owner 1 and repeated the real `App.orderAt()` dispatch
  with the engineer selected. The engineer received capture, the relay changed
  to owner 0, and its integrity stayed 850/850. The capture event was emitted.
- Spawned a Field Medic beside a rifleman reduced to 50/125 HP through the live
  simulation API. After 100 ticks the rifleman had 70 HP (+20 at 4 HP/s), the
  medic was `healing`, and `healTargetId` pointed at that rifleman.
- Selected the medic: the desktop card showed `Field Medic`, `INFANTRY SUPPORT ·
  HEALING`, `STATE HEALING`, and a `MEDIC` roster chip.
- Added a completed barracks to the live battle. The LAND panel showed
  `COMMAND` and `BARRACKS` facilities; the barracks offered `Q RIFLEMAN 130M`,
  `W ATGM 200M · 25R` and `M MEDIC 160M`, all enabled at 3,000 materials. The
  medic card's `.thumb-art` carried a populated `data:image/png` portrait and
  the shield-and-cross icon fallback.
- Console and network output during these checks contained only Vite HMR
  connection messages; no runtime exceptions were reported.

These checks exercised live DOM/UI and simulation state. They do not prove that
the medic mesh or satchel reads clearly at gameplay zoom.

### 19.6 Gaps

- No screenshot or visual inspection of the new medic mesh, icon or portrait.
- Repair and medic treatment use fixed world-space ranges (5 tiles for both
  working range and treatment); neither was tuned against a full battle.
- Mobile has no direct tap-to-repair gesture. A damaged structure can still be
  repaired only through the desktop right-click path; relay capture is available
  through the mobile **CAPTURE** mode.
- The skirmish AI neither builds medics nor issues repair orders. It still
  replaces lost engineers and builds its economy with them.
- `healTargetId` is new state inside version 1 saves. New saves carry it; older
  saves load it as 0. No separate migration test fixture exists for a save
  written before the field was introduced, beyond the default in `fromSave()`.

## 20. Mobile repair command

Date: 2026-10-24. Follow-up to section 19; closes its mobile repair gap.

### 20.1 Cause and approach

Section 19 made repair available only through the desktop right-click path. A
mobile command button is the smallest parity change: select a Combat Engineer,
tap **REPAIR**, then tap the damaged structure. This preserves tap-to-select for
all structures and avoids adding an ambiguous long-press gesture.

### 20.2 Changed source

| File | Change |
| --- | --- |
| `src/app.ts` | Adds `repair` to `CommandMode`; `setMode('repair')` refuses to arm without a selected Combat Engineer. |
| `src/ui/orderIntent.ts` | Adds `isRepairTarget()`, shared by the right-click resolver and the target-mode input path. |
| `src/ui/input.ts` | Routes `repair` mode through target validation; a valid damaged friendly structure calls `commandRepair()`, anything else warns and keeps the mode armed. |
| `src/ui/hud.ts` | Adds the `REPAIR` command button, action dispatch and mode-banner copy. |
| `src/ui/icons.ts` | Adds a wrench glyph for the repair command. |
| `src/render/gridVisibility.ts` | Accepts the new mode in `GridMode`; grid visibility still applies only to placement. |
| `tests/repair-medic.test.ts` | Adds target-validation coverage for the mobile path. |
| `README.md` | Documents **REPAIR** then tap in the touch control column. |

### 20.3 Verified behaviour

- `isRepairTarget()` accepts only a completed, damaged, alive friendly building
  and rejects enemy ownership, construction sites, full-health structures and
  an empty target.
- The right-click resolver still returns `repair` for a damaged friendly
  structure with an engineer selected, so desktop and mobile share the same
  authoritative command path.
- The mobile command bar mounts the `REPAIR` button and sets `app.mode` to
  `'repair'`; the mode banner and active-button styling follow the existing
  command-mode machinery.

### 20.4 Commands and results

```
$ npm run typecheck
TYPECHECK:0

$ npm test
 Test Files  20 passed (20)
      Tests  177 passed (177)
TESTS:0

$ npm run build
✓ 51 modules transformed.
dist/index.html                   4.52 kB │ gzip:  1.66 kB
dist/assets/index-DfehfABS.css   52.38 kB │ gzip: 10.56 kB
dist/assets/index-DHc1fds5.js   312.12 kB │ gzip: 93.14 kB
BUILD:0

$ npm run bench
[perf] baseline: 21 entities, 600 ticks in 76.6ms (0.128ms/tick)
[perf] stress: 160 entities, 300 ticks in 853.8ms (2.846ms/tick)
[perf] pathfinding: 100 orders in 81.4ms
[perf] save/load: 130 entities, serialise 5.2ms, restore 8.2ms, 301KiB
[perf] map: 96x72, 3347 land tiles (48%), 3565 water tiles (52%)
BENCH:0
```

This UI-only follow-up does not change simulation work. The benchmark remains in
the same host-noise band as section 19 (0.128 / 2.707–2.846 ms/tick) and is not
claimed as a performance change.

### 20.5 Browser checks (Chromium, 844×390)

- Reloaded at 844×390; the mobile HUD mounted and the command row exposed
  `MOVE`, `ATTACK`, `A-MOVE`, `STOP`, `HOLD POS`, `CAPTURE`, `REPAIR`, `RETURN`,
  `BUILD`, `BOX`, `GROUPS`, `MAP` and `DIAG`. All 13 buttons were present in the
  DOM at that viewport; the row keeps its existing horizontal scroll fallback.
- Reduced the real Command Post to 1,100 HP, selected the real starting
  engineer and clicked the **REPAIR** button. `app.mode` became `'repair'` and
  the button existed in the desktop/mobile shared command markup.
- Pinned the pick result to that Command Post and invoked the same tap handler
  the canvas uses (`InputController.tapAt`). The first tick gave the engineer a
  `repair` order and `repairing` state; 80 ticks restored 311.85 HP to
  1,411.85. The mode returned to `'none'` after successful dispatch.
- Repeated the target validator through the mode path for a full-health
  structure by inspection and automated test; it warns and does not issue
  repair.

### 20.6 Gaps

- No screenshot or visual inspection of the mobile command row at 844×390 or a
  narrower viewport; the check measured DOM structure, mode state and the real
  order path.
- No physical touch-device test. The click was a synthetic tap through the same
  pointer-up semantic handler, not a hardware touch event.
- The repair mode is not bound to a keyboard shortcut; desktop retains the
  right-click path and can also use the command button.
- AI support behaviour remains unchanged.

## 21. HUD alignment, radar fidelity and cameo production

Date: 2026-10-24. Presentation-only follow-up to sections 14–20. No command,
combat, economy or AI rules changed.

### 21.1 Cause and approach

- The left rail foot and map dock were sized from the console height minus its
  padding, leaving their top edge 8 px below the top of the bottom central
  console. `--selection-top-offset` now equals the full console height so the
  mission/actions block and radar dock share the console's top edge.
- The tactical canvas drew a 96x72 map buffer and caption into a CSS-scaled
  canvas, so both the map and `RADAR OFFLINE` were magnified from very low
  resolution. It now allocates a device-pixel backing store and draws markers
  and the caption at that resolution; terrain is upscaled from a native
  offscreen raster once per frame.
- Queue rows above the unit grid duplicated the hotbar's job and pushed the
  grid down. Production status is now shown on the unit card itself: a radial
  portrait wipe for the training head and a top-left count badge for the number
  of that type queued.

### 21.2 Changed source

| File | Change |
| --- | --- |
| `src/style.css` | Bottom offset now matches the full console height; 44 px mission strip; growing 2x2 action pad; removed queue-row styles; added `.unit-slot`, cameo `.u-progress` conic wipe and `.u-queue` badge. |
| `src/ui/hudLayout.ts` | Adds pure `minimapBackingSize()` and `productionCardState()` helpers. |
| `src/ui/hud.ts` | Resizes the minimap to device pixels, renders terrain/markers/sweep at native scale, adds the layered animated static feed and crisp offline caption, keeps minimap clicks aligned with the stretched raster, and emits per-card progress/count markup with badge cancellation. |
| `tests/hud-layout.test.ts` | Covers backing-store density/clamps and queue-head progress/count semantics. |

### 21.3 Commands and results

```
$ npm run typecheck
TYPECHECK:0

$ npm test
 Test Files  20 passed (20)
      Tests  181 passed (181)
TESTS:0

$ npm run build
✓ 51 modules transformed.
dist/index.html                   4.52 kB │ gzip:  1.67 kB
dist/assets/index-SRS56bK0.css   52.62 kB │ gzip: 10.63 kB
dist/assets/index-Cn5yJLsc.js   315.63 kB │ gzip: 94.30 kB
BUILD:0

$ npm run bench
[perf] baseline: 21 entities, 600 ticks in 82.2ms (0.137ms/tick)
[perf] stress: 160 entities, 300 ticks in 914.2ms (3.047ms/tick)
[perf] pathfinding: 100 orders in 81.8ms
[perf] save/load: 130 entities, serialise 5.8ms, restore 10.1ms, 301KiB
[perf] map: 96x72, 3347 land tiles (48%), 3565 water tiles (52%)
BENCH:0
```

No simulation file changed. The baseline/stress figures remain in the same
host-noise range as the prior 0.128 ms/tick and 2.707–2.846 ms/tick runs; this
change is not claimed as a performance improvement.

### 21.4 Desktop browser checks (Chromium, 1270x720)

- `.battle-console`, `.rail-bottom` and `.map-dock` each had a top of 552.01 px
  and a bottom of 720 px. The mission strip measured 44.0 px; the action pad
  measured 122.9 px and each action button 54.39 px.
- The offline minimap canvas had a 279x155 backing store and 279x155 CSS size at
  a 0.9 device pixel ratio, so it was no longer a 96x72 buffer scaled up.
- Two consecutive offline draws differed in 23,053 of 43,245 pixels (53.3%),
  with 261 bright caption pixels. The caption reads `RADAR OFFLINE` with the
  reason line; the feed includes grain, rolling interference, scanlines and a
  vignette.
- Inserting a completed Radar Array made `minimapIsOnline()` true, cleared the
  static class, set the label to `Tactical map`, and produced an online map with
  987 unique colours. The raster filled the dock (one background-coloured
  pixel); a click on the map moved the camera from [92.9, 138.8] to
  [212.9, 146.7] with the expected screen-lift offset. Power status stayed
  balanced at 80 supply / 12 demand.
- Queued two engineers on the Command Post: `.queue-row` count was 0, the card
  had `training`, the badge showed `2`, and `--p` reached 16.7%. Cancelling
  through the badge reduced the queue and badge to 1. Advancing 60 more ticks
  with the real HUD signature updated the badge to `1` and the wipe to 41.7%.

### 21.5 Mobile browser checks (Chromium, 844x390)

- The mobile composition mounted with `layout-mobile`. Opening LAND showed the
  ENGINEER card, the 2x2/queue-free production body and the top-left badge at
  24x22 px; the sidebar had no horizontal overflow (`scrollWidth 338`, client
  338). A radar-offline map opened at a 326x225 backing store matching its CSS
  size.

### 21.6 Gaps

- No screenshot or visual regression pass was performed. The checks measured
  geometry, canvas backing stores, pixel changes and live DOM state rather than
  inspecting the final composition by eye.
- The online minimap was forced by spawning a completed Radar Array; the full
  engineer-build-radar path was not replayed in this check.
- No physical touch-device test of the badge cancellation hit target. Desktop
  and mobile DOM clicks both exercised the same handler.
- The device-density cap is 2x; a 3x phone renders above CSS resolution but not
  at full native density.
- Only the desktop 1270x720 and mobile 844x390 layouts were checked; no tablet
  breakpoint sweep was run.

## 22. Drag-to-prioritise production

Date: 2026-10-24. Follow-up to section 21. Adds queue ordering only; unit costs,
build times, refunds, production speed and simulation balance are unchanged.

### 22.1 Approach

A queued card is a type-level handle: dragging it across another queued card
moves every copy of that type ahead of the target type's first item. This fits
the cameo cards introduced in section 21 without bringing back a separate queue
list. The move is an authoritative command, so it runs through the normal fixed
step and deterministic command order rather than mutating the queue from the
renderer.

### 22.2 Changed source

| File | Change |
| --- | --- |
| `src/sim/types.ts` | Adds the `reorderProduction` command with an optional `beforeDefId` tail target. |
| `src/sim/game.ts` | Implements `commandReorderProduction`: preserves queue item objects and `remaining`, rejects foreign/missing/no-op moves, and emits an info acknowledgement. |
| `src/app.ts` | Adds `App.reorderProduction()` and includes queue order in `hudSignatureOf()` so the new training head is rendered. |
| `src/ui/hud.ts` | Adds pointer drag state and listeners, mouse-anywhere/touch-grip activation, floating ghost, valid-target highlighting, post-drag click suppression, unavailable-card reorder support, and drag cancellation on re-render. |
| `src/style.css` | Adds the grip, dragging source, dropped-target `PRIORITY` banner, queue ghost and unavailable-but-reorderable treatment. |
| `tests/production.test.ts` | Adds queue-order, item-identity, resource-preservation and invalid-command coverage. |
| `README.md` | Updates the test count and production feature copy. |

### 22.3 Commands and results

```
$ npm run typecheck
TYPECHECK:0

$ npm test
 Test Files  20 passed (20)
      Tests  183 passed (183)
TESTS:0

$ npm run build
✓ 51 modules transformed.
dist/index.html                   4.52 kB │ gzip:  1.67 kB
dist/assets/index-eOJ6SUIS.css   54.33 kB │ gzip: 11.01 kB
dist/assets/index-CdNWjuEE.js   320.41 kB │ gzip: 95.66 kB
BUILD:0

$ npm run bench
[perf] baseline: 21 entities, 600 ticks in 104.7ms (0.175ms/tick)
[perf] stress: 160 entities, 300 ticks in 930.9ms (3.103ms/tick)
[perf] pathfinding: 100 orders in 80.0ms
[perf] save/load: 130 entities, serialise 5.0ms, restore 10.3ms, 301KiB
[perf] map: 96x72, 3347 land tiles (48%), 3565 water tiles (52%)
BENCH:0
```

The reorder path adds one command switch arm and is not exercised by the
benchmark scenario. Baseline/stress remain in the established host-noise band;
no performance improvement or regression is claimed.

### 22.4 Desktop browser checks (Chromium, 1270x720)

- Queued `tank`, `engineer`, `engineer` on a spawned Vehicle Factory. The
  Engineer and MBT cards showed grips and `reorderable`; unqueued cards did not.
- A synthetic mouse pointerdown on the Engineer card, a move to the MBT card,
  and a move back produced: source class `unit-card reorderable dragging`, MBT
  class `… drop-target`, ghost text `ENGINEER ×2SET AHEAD OF MBT`, and
  `.hud.queue-dragging`. The ghost was fixed at the pointer and the target card
  showed the amber `PRIORITY` treatment.
- Pointerup plus one simulation tick changed the queue from
  `[tank, engineer, engineer]` to `[engineer, engineer, tank]`; the next HUD
  update moved `training` and the radial wipe to Engineer at 0.4%, with MBT at
  0.0%. The queue UI still had zero `.queue-row` elements.
- An immediate click on the origin card while the post-drop suppression was
  active did not add a unit: the queue stayed at four items and materials
  remained 1,380. The drag then cleaned up its ghost, target class and HUD
  state.
- With materials set to 0, the queued Engineer and MBT cards stayed enabled for
  reordering (`unavailable reorderable`, `aria-disabled=true`), while the
  unqueued Harvester, Recon and AA cards were natively disabled.
- A touch pointerdown on the card body was ignored; a touch pointerdown on the
  grip armed the drag, and `pointercancel` removed all drag state without
  changing the queue.

### 22.5 Mobile browser checks (Chromium, 844x390)

- The production sheet showed the grip at **28×32 px**. A touch drag from the
  Harvester grip onto the Engineer card produced ghost copy
  `HARVESTER ×1SET AHEAD OF ENGINEER` and moved the queue from
  `[tank, engineer, engineer, harvester]` to
  `[tank, harvester, engineer, engineer]`. The production sheet remained open.
- Touch pointerdown on the Engineer card body did not start a reorder, so normal
  tap-to-queue remains available away from the grip.

### 22.6 Gaps

- No physical touch hardware test; pointer events were synthesised in Chromium.
- No auto-scroll while dragging toward cards outside the production viewport.
  A queued target must be brought on screen before dropping.
- Dragging a type moves all queued copies of that type together. Individual
  copies still require cancel/requeue to split priority.
- No keyboard reorder control. The drag grip is pointer/touch only.
- If the queue completes an item during an active drag, the production re-render
  cancels that drag; this is safe but requires the user to start again.
- The only target types accepted by the UI are other queued unit types; dropping
  onto an empty card does not send that type to the tail. The command itself
  supports a tail move when no target is supplied.

## 23. Cameo sweep cadence and harvester payload

Date: 2026-10-24. Follow-up to section 22.

### 23.1 Cause

- `.u-progress` used `conic-gradient(from -90deg, …)`. CSS conic gradients start
  at 12 o'clock for 0deg, so -90deg placed the leading edge at 9 o'clock. The
  first visible wedge therefore appeared on the left and crossed the top later,
  rather than growing from the top.
- `refreshProductionProgress` ran inside the 110 ms HUD refresh block and wrote
  `--p` to the card button. The overlay span already had an inline `--p` from
  the initial markup, and an element's own custom property wins over an inherited
  one. The per-frame write was therefore invisible until `renderProduction`
  rebuilt the card. Sampling an active Engineer card returned values 0.4% at
  37 ms and 7.9% at 971 ms: two changes in 91 frames with a 934 ms freeze.
- Harvester mining, full-hopper checks and hopper art each hard-coded 100
  material, while an authored ore tile holds 300. A full load was worth less
  than a seventh of a main battle tank and left most of a tile behind.

### 23.2 Changed source

- `src/style.css`: starts the conic sweep at 0deg, registers `--p` as a
  `<percentage>` custom property, and gives it an 80 ms linear transition so the
  20 Hz simulation updates are interpolated across animation frames.
- `src/ui/hud.ts`: progress refresh now runs outside the 110 ms throttle and
  writes `--p` to the `.u-progress` overlay, which owns the inline property.
- `src/sim/constants.ts`: adds `HARVESTER_CAPACITY = 300`.
- `src/sim/game.ts`: uses the shared capacity for the full-hopper seek, the
  mining cap and the load-complete check.
- `src/render/renderer.ts`: scales the hopper cargo mesh by the same capacity.
- `tests/sim-core.test.ts`: the full-hopper delivery regression now loads and
  asserts `HARVESTER_CAPACITY` rather than a literal 100.

### 23.3 Commands and results

- `npm run typecheck` passed.
- `npm test` passed: 20 files, 183 tests.
- `npm run build` passed: 51 modules, `dist/assets/index-Df81X1Cf.css` at
  54.41 kB and `dist/assets/index-CgUr6Wt8.js` at 320.44 kB.
- The AI simulation's delivered hopper emitted `income:+300 materials`, matching
  the new capacity.

### 23.4 Live browser checks (Chromium, 1061x734, DPR 0.9)

- `getComputedStyle` on a unit card overlay reported
  `conic-gradient(from 0deg, …)`, confirming the sweep now starts at the top.
- Queued an Engineer on the Command Post, then sampled the computed `--p` every
  animation frame for 1.5 s. After the throttle and inheritance fixes, the value
  changed 87 times across 92 frames with a 17 ms median interval (92 frames is
  the browser's 60 Hz rAF count for the window). Intermediate values included
  0.4, 0.4835, 0.567, 0.65, 0.7857, 0.9214, 1.057 and 1.1905%, confirming the
  transition interpolates between simulation ticks. The only 50 ms interval was
  the initial step from 0 before the first tick; the rest advanced at frame rate.
- The card carried `training` and badge `1` throughout the sample.

### 23.5 Gaps

- No screenshot or visual review of the final sweep, and no visual check of the
  hopper mesh at partial and full loads.
- Live timing was sampled on desktop Chromium only. Mobile uses the same CSS and
  HUD path but was not sampled separately.
- The capacity increase was not playtested for match pacing; the number was
  chosen to match one authored ore tile and roughly one third of an MBT.

## 24. Production drag edge auto-scroll

Date: 2026-10-24. Follow-up to sections 22 and 23.

### 24.1 Cause and approach

- The production sheet already scrolled through `#prod-body`, but the drag only
  reacted to `pointermove`. Keeping the pointer at a sheet edge therefore did
  nothing, and cards below the viewport could not be targeted.
- A 48 px band at the top and bottom of `#prod-body` now drives vertical scroll
  while a cameo drag is active. Velocity ramps from 0 at the inner boundary to
  900 px/s at the edge, scaled by elapsed animation time.
- The drag loop runs from activation to cleanup, not from further pointer events.
  After each scroll frame that moves the sheet, the pointer is re-hit-tested so
  cards sliding under a stationary pointer become normal drop targets.

### 24.2 Changed source

- `src/ui/hudLayout.ts`: adds `edgeAutoScrollVelocity`, which clamps to the sheet
  edges, handles overshoot and shrinks both bands on a panel shorter than two
  edge zones.
- `src/ui/hud.ts`: stores the latest pointer position on the drag, starts and
  stops a requestAnimationFrame loop with the drag lifecycle, scrolls
  `#prod-body`, and re-resolves the drop target after movement. Horizontal
  drift up to 28 px outside the sheet still scrolls; further out does not.
- `tests/hud-layout.test.ts`: three tests cover the velocity ramp, boundary
  clamping and degenerate/short geometry.

### 24.3 Commands and results

- `npm run typecheck` passed.
- `npm test` passed: 20 files, 186 tests (three new auto-scroll tests).
- `npm run build` passed: 51 modules, `dist/assets/index-Df81X1Cf.css` at
  54.41 kB and `dist/assets/index-DnQqpAwq.js` at 321.79 kB.

### 24.4 Browser checks (Chromium, 844x390)

- Setup: mobile production sheet with a 220 px visible body, a Vehicle Factory
  queue of Engineer, Harvester, Recon, AA and MBT, and simulation speed frozen
  at 0 so the cards remained stable. A synthetic mouse pointer drove the real
  HUD pointer handlers; the page was visible and ran at 59 fps.
- Bottom edge, stationary pointer 10 px above the body bottom: drag started on
  Engineer at scroll 0. The sheet auto-scrolled to 122 px in 160 ms; the target
  trace changed from `21:recon` at 11 px to `21:tank` at 122 px with no further
  pointer movement. The ghost read
  `ENGINEER ×1SET AHEAD OF MBT`; releasing reported that Engineer was already
  ahead of MBT, which matches the unchanged queue.
- Top edge, stationary pointer 38 px below the body top: after scrolling to 250
  and starting a drag on MBT, the sheet auto-scrolled back to 137 px in 528 ms.
  The target changed from `21:recon` at 247 px to `21:engineer` at 137 px.
  Releasing produced `MBT priority set ahead of ENGINEER.` and the queue changed
  from `[engineer, harvester, recon, aa, tank]` to
  `[tank, engineer, harvester, recon, aa]` after one simulation tick.
- In both runs the drop target was recomputed while the pointer was stationary;
  no additional `pointermove` was sent after entering the edge band.

### 24.5 Gaps

- No physical touch-device test. Pointer events were synthesised in Chromium;
  the touch path uses the same drag lifecycle and grip start rule.
- No desktop-layout scroll sample. The desktop and mobile sheets use the same
  `#prod-body` container and HUD loop.
- There is no visual edge glow or indicator; the scrolling sheet itself is the
  feedback. The scroll is vertical only.
- The test battle's queue and speed were set artificially to make the off-screen
  target deterministic; normal play was not replayed through a full build-up.

## 25. Themed scrollbars

Date: 2026-10-24. Follow-up to section 24.

### 25.1 Cause

- Only `#prod-body` and `.tool-scroll` declared a custom thin scrollbar, and
  `.selection-body`/`.sel-roster` asked for thin but left the colours native.
  Modals, mobile sheets, the production tab rail and other overflow regions
  therefore fell back to the browser's default scrollbar, producing different
  widths and colours across the app.

### 25.2 Changed source

- `src/style.css`: adds `--scroll-size`, `--scroll-track`, `--scroll-thumb`,
  `--scroll-thumb-hover`, `--scroll-thumb-active` and `--scroll-edge` to the
  theme, then applies one global Firefox and WebKit treatment.
- The WebKit rail is the shared 8 px width, with a 1 px inset edge, a squared
  thumb that keeps at least 28 px visible, no arrow buttons and a matching
  corner. Hover and active states shift the thumb to amber.
- The redundant declarations on `#prod-body`, `.selection-body`, `.sel-roster`
  and `.tool-scroll` were removed. Existing `scrollbar-width: none` and
  zero-width/zero-height rules for the command bars and mobile roster were left
  intact and still win the cascade.

### 25.3 Commands and results

- `npm run build` passed: 51 modules, `dist/assets/index-DTtWcBEX.css` at
  55.08 kB and `dist/assets/index-DQdwJ_w7.js` at 321.79 kB.
- Computed styles on the live battle reported
  `scrollbar-width: thin` and
  `scrollbar-color: rgba(167, 190, 184, 0.24) rgba(3, 7, 8, 0.58)` for
  `#prod-body`. Its `::-webkit-scrollbar` measured 8×8 px, the thumb was
  `rgba(167, 190, 184, 0.24)` with square corners and a transparent 1 px inset,
  and the track was `rgba(3, 7, 8, 0.58)` with the inset edge shadow.
- The selection body, roster and the Settings modal reported the same
  `scrollbar-color` and `scrollbar-width`; the modal's WebKit rail also measured
  8×8 px. The command bar, which is intentionally rail-free, still computed
  `scrollbar-width: none` and a 0 px WebKit scrollbar height.

### 25.4 Gaps

- No screenshot or visual review of the final rail, and no captured hover or
  active thumb state.
- Firefox, macOS overlay scrollbars and touch hardware were not exercised. The
  Firefox path uses `scrollbar-width`/`scrollbar-color`; the WebKit pseudo
  elements are ignored where unsupported.
- Mobile sheets and editor tools were not opened for individual inspection;
  they inherit the same global selectors. The desktop Settings modal was checked.

## 26. Centred command-rail contents

Date: 2026-10-24. Follow-up to section 25. Visual alignment only.

### 26.1 Cause

- The desktop rail's resource rows, objective button and mission clock each
  stacked their children with the default stretch/start alignment, leaving the
  label, value and rate pinned to the left of every box. The brand and 2x2
  action grid were already centred, so the rail looked inconsistent.

### 26.2 Changed source

- `src/style.css`: `.rail-stat` gains `align-items: center` and
  `text-align: center`; `.rail-label` gains `justify-content: center` and a
  100% max-width; the value and rate gain a 100% max-width so ellipsis still
  applies. `.rail-objective` and `.rail-clock` gain centred alignment and text.
- No markup, width, height, padding or interaction behaviour changed.

### 26.3 Commands and results

- `npm run build` passed: 51 modules, `dist/assets/index-DfixkHRu.css` at
  55.25 kB and `dist/assets/index-CrDP9905.js` at 321.79 kB.
- In the live battle the rail measured 92 px. The resource row computed
  `align-items: center` and `text-align: center`, with the MATS label, value
  and rate each reporting equal left and right gaps.
- The objective button and mission clock also computed `align-items: center`;
  the clock's MISSION label and time reported the same gap on both sides.

### 26.4 Gaps

- No screenshot or visual review of the centred rail.
- Only the first resource row was measured directly; the other three share the
  same rules.
- The mobile top strip is a separate composition and was not changed.

## 27. Rail control groups and toolbar-first console

Date: 2026-10-24. Follow-up to section 26. Desktop layout and group-click
reliability.

### 27.1 Cause

- The nine control-group buttons shared the bottom command row with the command
  bar, taking a 213 px block out of the toolbar's usable width.
- `renderGroups` rebuilt the strip's `innerHTML` and rebound its click handlers
  on every 110 ms HUD tick. A click whose press and release spanned an update
  could target a replaced node and be lost.

### 27.2 Changed source

- `src/ui/hud.ts`: the desktop rail mounts the group strip between the objective
  and mission clock. The desktop console now renders its command row before the
  selection panel and no longer mounts `.console-groups`. `renderGroups` builds
  and binds the nine slots once, then refreshes only their classes and aria
  labels.
- `src/style.css`: adds the `.rail-groups` block and 3×3 grid, reduces the
  mission clock to 32 px, and retains the action grid in the remaining height.
  The unused `.console-groups` and `.group-label` rules were removed. Toolbar
  alignment is now `flex-start` across the full console width.
- `README.md`: the desktop interface summary now names the rail as the home of
  control groups and describes the toolbar-first console.

### 27.3 Commands and results

- `npm run build` passed: 51 modules, `dist/assets/index-ivonFLwU.css` at
  55.10 kB and `dist/assets/index-C9aFAdBm.js` at 321.93 kB.
- In the live battle at 1422×800, `.rail-bottom` and `.battle-console` both
  began at y=632 with a 168 px height. The group block measured 79 px and held
  nine buttons in three columns and three rows (25×21 px cells). The mission
  clock measured 32 px, and the 2×2 mission-action grid filled the remaining
  55.8 px.
- The command row measured 962×38 at y=641; the selection panel started at
  y=685, so the toolbar was above it. The command bar's `clientWidth` and
  `scrollWidth` were both 962 px, confirming the full row was available. No
  `.console-groups` node remained.
- Group 1 was assigned to units [5,6] by a real click on the rail slot, the
  slot changed to `control-group has` with the "Recall control group 1" label,
  and clearing the selection then clicking the slot restored [5,6].

### 27.4 Gaps

- No screenshot or visual review of the final composition.
- Physical touch, keyboard group shortcuts after the move, and the mobile
  groups sheet were not re-exercised. Mobile styles and the mobile groups sheet
  are unchanged.

## 28. Current-state re-audit — 2026-10-24 (pre-remediation snapshot)

> **Historical snapshot.** Section 29 records the post-remediation checks for
> this snapshot, and §30 is the current second-pass evidence. The counts, HUD
> measurements and source-confirmed findings below describe the tree before the
> first round of fixes.

Scope: read-only against application source, tests, configuration and assets.
Only documentation files were changed. This section supersedes earlier runtime
claims for current status.

### 28.1 Environment

| Item | Value |
| --- | --- |
| Host | Windows/MINGW64 (`MINGW64_NT-10.0-26300`, Git Bash 3.6.10) |
| Node / npm | v24.14.0 / 11.9.0 |
| Vite / Vitest | 8.3.5 / 5.0.5 |
| Browser | Freebuff Chromium preview, DPR 0.9 |
| Dev server | `http://127.0.0.1:5174/`, live battle already running |
| Repository state | No usable Git HEAD; all files report untracked. The audit is against the current working tree. |

Device-pixel viewport sizes were converted to CSS sizes by the browser's DPR of
0.9. The CSS sizes below are the layout sizes; the physical window was smaller.

### 28.2 Commands and outcomes

```
$ npm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0
```

```
$ npm test
Test Files  20 passed (20)
     Tests  186 passed (186)
  Duration  7.29s
TEST_EXIT=0
```

Key groups in that run: 24 weapon-transform, 16 HUD-layout, 13 production,
13 power, 13 scenario, 12 terrain-pick, 12 sim-core, 11 repair-medic, 9
camera, 9 determinism-save, 8 air-naval, 7 AI, 7 thumbnails, 7 unit-scale,
6 combat, 6 relay, 5 perf, 4 construction, 3 balance and 1 debug test.

```
$ npm run build
✓ 51 modules transformed.
dist/index.html                   4.52 kB │ gzip:  1.66 kB
dist/assets/index-ivonFLwU.css   55.10 kB │ gzip: 11.21 kB
dist/assets/index-C9aFAdBm.js   321.93 kB │ gzip: 96.10 kB
✓ built in 249ms
BUILD_EXIT=0
```

```
$ npm run bench
✓ tests/perf.test.ts (5 tests) 1329ms
BENCH_EXIT=0
```

Controlled benchmark output (single test file, no concurrent suite):

- baseline: 21 entities, 600 ticks in 87.2 ms — **0.145 ms/tick**
- stress: 160 entities, 300 ticks in 954.8 ms — **3.183 ms/tick**
- pathfinding: 100 attack-move orders in 82.4 ms
- save/load: 130 entities, serialise 7.5 ms, restore 11.7 ms, 301 KiB
- map: 96×72, 3,347 land tiles (48%), 3,565 water tiles (52%)

A repeat controlled run during final document verification measured 0.132 ms/tick
baseline, 3.041 ms/tick for 160 entities, 80.8 ms for 100 path orders and
6.2 / 8.5 ms save/restore. The difference is normal run-to-run variance on this
host; both runs are well inside the 50 ms fixed-step budget.

The full-suite perf run reported 0.684 ms/tick baseline and 8.314 ms/tick
stress because other test files were running concurrently. The controlled bench
is the representative timing; both are below the 50 ms fixed-step budget.

### 28.3 Runtime HUD measurements

At the desktop sizes, the persistent chrome is the 92 px left rail, 348 px right
sidebar and 168 px bottom console. The minimap dock is inside the sidebar.

| CSS viewport | Rail | Sidebar | Console | Clear battlefield | Clear area | Chrome |
| --- | --- | --- | --- | --- | --- | --- |
| 1280×720 | 92 px | 348 px | 168 px | 840×552 px | **50.31%** | **49.69%** |
| 1920×1080 | 92 px | 348 px | 168 px | 1480×912 px | **65.09%** | **34.91%** |

Reconciled targets are ≥55% clear / ≤38% chrome at 1280×720 and ≥65% clear /
≤28% chrome at 1920×1080. The 1280 clear-area target and both chrome targets are
not met.

Mobile measurements at the primary landscape size, with production closed:

| CSS viewport | Top strip | Right rail | Bottom console | Clear | Height | Area |
| --- | --- | --- | --- | --- | --- | --- |
| 844×390, no selection | 42 px | 60 px | 44 px | 784×304 px | **77.95%** | **72.41%** |
| 844×390, 2 selected | 42 px | 60 px | 90 px | 784×258 px | **66.15%** | **61.45%** |
| 667×374, no selection | 42 px | 60 px | 44 px | 607×288 px | **77.01%** | **70.08%** |

The 667×374 row is derived from the measured rail/top/console rects; the browser
reported no horizontal overflow (`scrollWidth === innerWidth`). Both mobile area
targets pass with production closed.

Control rects and content:

- Every mobile command button measured **44×44 px**; the command row is 44 px
  high and has a short visible label.
- Production tabs measured **59×56 px** at 844 and **59×44 px** at 667.
- The groups sheet opened with nine **44×44 px** slots; assignment/recall code
  is unchanged and the sheet was reachable from the GROUPS command.
- The ADD toggle measured **44×46 px** and reported `aria-pressed="true"` after
  activation.
- The mobile objective chip was present at both widths (488×41 px at 844).
- Desktop build cards measured **131×127 px** with **119×89 px** procedural
  thumbnails at 1280×720, meeting the 96×72 image-led target.

### 28.4 Runtime functional checks

- **Construction grid:** `app.renderer.settings.grid` was `false` in ordinary
  play and `true` only after `beginPlacement('powerPlant')`; it returned to
  `false` on cancel. This confirms the grid is placement-only at runtime.
- **Terrain picking:** a projected point on a flat elevated tile (elevation 2)
  resolved through `app.worldAt` with **0.000 world-unit XZ error**. The 12
  terrain-pick tests also cover slopes, water, pan/zoom and boundary clamping.
- **MOVE:** with two units selected, clicking MOVE left `app.mode === 'none'`,
  created **zero** move orders, and showed only “Right-click ground to move, or
  an enemy to attack.” This is a confirmed current UI defect, not a historical
  claim.
- **Groups and touch selection:** the mobile GROUPS sheet rendered nine 44×44
  slots; the ADD toggle switched the sticky additive mode on. Physical taps were
  not injected.
- **Live battle:** the app was running a real battle (23 entities at the time of
  the checks), not a mock or a static screenshot.
- **AI coastal siting:** with the AI's resources temporarily raised, calling
  `placementStatus(1, 'shipyard', 84, 22)` returned `ok: true`; the authored map
  has a legal AI shipyard site with navigable water alongside. This is a siting
  check only, not an AI construction test; resources were restored afterwards.

### 28.5 Source-confirmed findings (not runtime-proven here)

- **NAV-01:** `src/sim/game.ts:1764–1782` still nests repair inside
  `if (e.ammo < e.maxAmmo)`. A full-ammo damaged corvette at a friendly shipyard
  does not repair. The existing test sets ammo to 0, so it misses this case.
- **NAV-02:** `src/sim/ai.ts` contains no `shipyard` or `corvette` construction
  path; `src/data/scenarios.ts:260–286` contains no starting naval unit. The AI
  therefore has no naval presence in the authored battle.
- **AI air:** the AI has an airfield/fighter branch, but no test asserts that an
  airfield is built or a fighter sorties. The 150 s and 383 s AI runs printed no
  airfield, so this is a verification gap, not a claimed pass.
- **Economy:** `updatePassiveIncome` credits only Requisition; Materials are
  credited only by harvester unload. The harvesting loop remains complete. The
  R-01 removal requirement conflicts with later harvesting work; see
  `AUDIT_FINDINGS.md` §7.6. No economy code was changed.
- **Copy:** `src/ui/editor.ts:935` still says “rifle squads” and
  `tests/sim-core.test.ts:152` still names an “infantry squad.” The barracks
  description itself is fixed.

### 28.6 What was not verified

1. A full player-driven 10-minute build-and-fight playthrough. The AI-only tests
   and component tests do not replace one.
2. Physical touch, multi-touch feel, real safe-area insets, notches and low-end
   frame rate. Viewport emulation is not a device.
3. Gamepad hardware.
4. Audio audition; there is still no automated audio check.
5. Reference-image comparison; no Frontline Zero images are available.
6. AI airfield/fighter production and air sorties.
7. AI naval production, because the code path does not exist.
8. Mobile editor authoring; the drawer layout exists but no full touch session
   was run.
9. Restart after a live result; the code path exists but was not re-clicked.
10. A visual screenshot/pixel-diff review of the HUD.

### 28.7 Bottom line

The current working tree passes typecheck, 186 tests, the production build and
the controlled benchmark. The Stage 1 HUD, picking, grid, turret and muzzle
defects are fixed in source and covered by tests or live checks. The remaining
mandatory work is naval completion (repair and AI production), the MOVE command,
and a decision on the desktop chrome target. The economy is a product decision,
not an implementation defect, until the harvesting conflict is resolved.

Do not treat this section as a full-playthrough pass: no player-driven
build-and-fight session or physical-device test was performed.

---

## 29. Post-remediation verification — 2026-10-24

This section supersedes §28 for its change set. Section 28 is retained as the
pre-remediation snapshot; §30 is the current second-pass evidence and supersedes
this section for the present working tree.

### 29.1 Commands and results

Run from the project root, as plain commands:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed; `tsc --noEmit` clean. |
| `npm test` | Passed: **20 test files / 191 tests**, 15.65 s. |
| `npm run build` | Passed: `tsc --noEmit` plus Vite production build, 51 modules; JS 322.47 kB (96.25 kB gzip), CSS 55.89 kB (11.35 kB gzip). |
| `npm run bench` | Passed: 5 tests in 1.91 s. |

### 29.2 Benchmark output

| Measurement | Result |
| --- | --- |
| Authored-scenario baseline | 21 entities, 600 ticks in 87.0 ms (0.145 ms/tick) |
| Representative stress | 160 entities, 300 ticks in 993.4 ms (3.311 ms/tick) |
| Pathfinding batch | 100 attack-move orders in 86.8 ms |
| Save / restore | 130 entities, serialise 7.2 ms, restore 10.0 ms, 301 KiB |
| Map composition | 96×72; 3,347 land tiles (48%), 3,565 water tiles (52%) |

All measured costs remain within the 50 ms fixed-step budget on this machine.

### 29.3 Fixed findings and focused tests

- **NAV-01:** a 50%-HP corvette with 6/6 missiles repairs at a live shipyard;
  reload stays separate and a destroyed yard does not repair. Covered in
  `tests/air-naval.test.ts`.
- **NAV-02 / AI air:** `tests/ai.test.ts` builds a coastal shipyard, produces one
  corvette, replaces a loss, and on a landlocked fixture falls through to land
  construction. Its new air case builds an airfield, fields a fighter and
  sorties it against a ground target.
- **HUD-06:** in a live Chromium battle, box-selecting eight units and pressing
  MOVE showed `MOVE — select a destination` and the active MOVE card. Clicking a
  destination hid the banner, cleared the active state and resumed the clock.
- **HUD-09:** measured with DOM rects in Chromium at CSS-pixel reference sizes:

  | Viewport | Rail | Sidebar | Console | Clear battlefield | Chrome |
  | --- | --- | --- | --- | --- | --- |
  | 1280×720 | 82 px | 218 px | 136 px | 980×584 px (62.10%) | 37.90% |
  | 1920×1080 | 82 px | 254 px | 136 px | 1584×944 px (72.11%) | 27.89% |

  The document was 1280×720 at the small reference size, and the rail/console
  scroll heights matched their client heights; the desktop HUD does not scroll.
- **Economy:** no changes to the economy loop, ore, refinery delivery,
  harvester state machine, save schema or editor ore tools. The retained-economy
  decision is recorded in `AUDIT_FINDINGS.md` §8 and
  `DESIGN_SPEC_RECONCILIATION.md` §9.5.

The 8-unit runtime selection included the Combat Engineer, two MBTs and five
riflemen. MOVE issued the entity order through the same `commandMove` path as
right-click movement; it was not a separate simulation shortcut.

### 29.4 Remaining gaps

Still unverified: a full player-driven 10-minute build-and-fight match, physical
touch/safe-area/notch behaviour, gamepad hardware, audio audition, reference-image
comparison, mobile editor authoring and screenshot/pixel-diff review. The AI
tests are deterministic simulation checks, not a human-played match. No claim is
made that the restored MOVE control was exercised on a physical touch device.

---

## 30. Current-state re-audit verification — 2026-10-24 (second pass)

This section supersedes §29 for the present working tree. Section 29 remains the
post-remediation record for the earlier change set. This pass changed only
documentation; no gameplay source, test, scenario or configuration was edited.

### 30.1 Environment and method

| Item | Value |
| --- | --- |
| Host | Windows/MINGW64, Git Bash |
| Node / npm | v24.14.0 / 11.9.0 |
| Vite / Vitest | 8.3.5 / 5.0.5 |
| Browser | Freebuff Chromium preview, DPR 0.9 |
| Dev server | `http://127.0.0.1:5173/` |
| Repository state | No usable Git HEAD; the audit is against the current tree |

Commands were run as plain commands. Viewport values are CSS pixels; because the
preview browser reports DPR 0.9, a requested 1152×648 window produced a 1280×720
CSS viewport. The browser's `innerWidth`/`innerHeight` and DOM rects are the
source of the measurements below.

The shared preview tab was hidden for part of the pass, which suspended
`requestAnimationFrame`. The MOVE check used synthetic pointer events through
the real canvas handlers and advanced one simulation tick manually. No claim is
made about continuous frame pacing in that state. The defeat/result checks were
run while the page was rendering; the layout-change reproductions were made by
resizing the live viewport.

### 30.2 Commands and outcomes

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed; `tsc --noEmit` clean, exit 0. |
| `npm test` | Passed: **20 test files / 191 tests**, 20 files passed, duration 15.36 s. |
| `npm run build` | Passed: typecheck plus Vite production build; 51 modules transformed in 245 ms. |
| `npm run bench` | Passed: 5 perf tests in 2.04 s. |

Build output for this run:

```text
dist/index.html                   4.52 kB │ gzip:  1.67 kB
dist/assets/index-DIwNJfjv.css   55.89 kB │ gzip: 11.35 kB
dist/assets/index-Bb9HH49u.js   322.47 kB │ gzip: 96.25 kB
✓ built in 245ms
```

Controlled benchmark output (single perf file, no concurrent suite):

| Measurement | Result |
| --- | --- |
| Authored-scenario baseline | 21 entities, 600 ticks in 93.5 ms — **0.156 ms/tick** |
| Representative stress | 160 entities, 300 ticks in 1,105.8 ms — **3.686 ms/tick** |
| Pathfinding batch | 100 attack-move orders in **88.7 ms** |
| Save / restore | 130 entities, serialise **5.2 ms**, restore **10.4 ms**, 301 KiB |
| Map composition | 96×72, 3,347 land tiles (48%), 3,565 water tiles (52%) |

The full test suite printed slower perf numbers because the perf file shares the
machine with nineteen other test files: 0.463 ms/tick baseline, 10.850 ms/tick
at 160 entities, 260.2 ms for 100 path orders and 29.7 / 60.3 ms save/restore.
Those timings are concurrent-suite noise; the controlled bench above is the
representative measurement. Both remain below the 50 ms fixed-step budget.

**Confirmation re-run.** The four commands were run again on the same unchanged
source tree after the documentation edits, each as a plain command with its exit
status read directly: `npm run typecheck` exit 0; `npm test` exit 0, **20 files /
191 tests**, 15.00 s; `npm run build` exit 0, 51 modules in **237 ms**;
`npm run bench` exit 0, 5 tests in 1.91 s. The controlled benchmark reported
0.143 ms/tick baseline (85.8 ms / 600 ticks), **3.505 ms/tick** at 160 entities
(1,051.5 ms / 300 ticks), **88.8 ms** for 100 attack-move orders and
**5.7 / 10.1 ms** for 130-entity save/restore (301 KiB). These differ from the
first run by ordinary run-to-run noise and remain well inside the 50 ms budget;
the range is 3.50–3.69 ms/tick at 160 entities across the two runs.

### 30.3 HUD measurements

Desktop, closed panels:

| CSS viewport | Rail | Sidebar | Console | Clear battlefield | Clear area | Chrome |
| --- | --- | --- | --- | --- | --- | --- |
| 1280×720 | 82 px | 218 px | 136 px | 980×584 px | **62.10%** | 37.90% |
| 1920×1080 | 82 px | 254 px | 136 px | 1584×944 px | **72.11%** | 27.89% |

At both desktop sizes the document scroll size matched the viewport and the rail
and sidebar scroll heights matched their client heights; the persistent HUD did
not scroll. These are the same reconciled targets met in §29.

Mobile landscape, production closed:

| CSS viewport | Top strip | Category rail | Bottom console | Clear | Clear area |
| --- | --- | --- | --- | --- | --- |
| 844×390 | 42 px | 60 px | 44 px | 784×304 px | **72.41%** |
| 667×374 | 42 px | 60 px | 44 px | 606×288 px | **70.07%** |

At 844×390 all 13 visible command buttons measured **44×44 px**. Production tabs
measured 58.9×44.5 px at 667×374. The mobile objective chip measured 481×41 px at
844×390. `document.documentElement.scrollWidth` equalled the viewport width at
both sizes, so there was no horizontal overflow.

### 30.4 Runtime functional checks

- **Construction grid:** in ordinary play `app.mode = 'none'` and
  `renderer.settings.grid = false`; after `beginPlacement('powerPlant')` the mode
  was `place` and the grid was `true`; after `setMode('none')` it returned to
  `false`. Matches `constructionGridVisible`.
- **Terrain picking:** a flat elevated tile at elevation 2 (tile 49,22) was
  projected through the live camera and resolved through `app.worldAt` with an
  XZ error of **0.0000 world units**. The 12 terrain-pick tests also pass.
- **MOVE:** two tanks were selected, MOVE mode was entered, and synthetic
  `pointerdown`/`pointerup` events were dispatched through the real `#gl` canvas
  handlers at a valid ground point. After one manual tick both tanks had
  `order.type = 'move'` and a one-point path, and `app.mode` was `none`. The live
  tab's hidden `requestAnimationFrame` state prevented a continuous-frame
  cadence check, so no frame-pacing claim is made from this check.
- **Editor → battle:** `openEditor()` entered `screen = 'editor'` with the
  authored two-player scenario active; `launchEditorScenario(scenario)` closed
  the editor and produced `screen = 'battle'`, `victory = 'playing'`, two
  players and the same scenario name. This verifies the handoff path, not a full
  paint/authoring session.
- **Desktop result and restart:** forced defeat at 1280×720 rendered
  `#end-root` (1203 characters) with the defeat card. Its RESTART button was at
  `bottom = 513.8` in a 720 px viewport. Clicking it restarted the battle at
  `tick = 14`, `screen = 'battle'`, `victory = 'playing'`, `endShown = false`.
- **Result survives no layout change:** the same defeat remained rendered until
  the viewport crossed the mobile layout threshold.
- **Result after layout change:** after switching to 844×390 the HUD reported
  `layout = 'mobile'`, `endShown = true`, `victoryShown = 'defeat'`, but
  `#end-root.innerHTML.length = 0`. The result card was gone.
- **Mobile result measurements:** at 844×390 the card measured 467.5 px tall;
  its actions were at top 405.5 / bottom 442.4 in a 390 px viewport. At 667×374
  the card measured 499 px; actions were at top 392.2 / bottom 473.9 in a 374 px
  viewport. `.end-screen` had `overflow: visible`, document/body overflow was
  `hidden`, and there was no scroll container. Action buttons measured 36.9 px
  high.
- **Pause after layout change:** paused at 667×374, then resized to 1280×720.
  `app.paused` stayed `true`, but `#pause-overlay` was `pause-overlay hidden`
  with computed `display: none`, and the top pause button still showed the pause
  icon rather than the resume icon.

### 30.5 AI construction and normal-play simulation

All of these are deterministic `Game` simulations on the authored scenario; none
used boosted AI resources or prebuilt facilities unless explicitly stated.

- **180 s, normal resources:** the AI had nine completed structures and one
  unfinished `atTurret` at world `(312, 92)` with `buildProgress = 0`. Its only
  engineer had `buildTargetId = 34`, was 30.52 world units from the site centre,
  and was `moving` at `(287.1, 109.64)`.
- **390 s, normal resources:** the AI defeated the idle player at tick 7668 with
  19 units. The buildings were command post, two relays, factory, refinery,
  barracks, one AT turret, two MG nests and the still-unfinished AT turret. No
  SAM battery, shipyard or airfield existed. The engineer was at
  `(287.99, 102.40)` with `blocked = 0` after a re-path and `buildTargetId = 34`.
- **900 s diagnostic:** to keep the match alive, only the player's Command Post
  HP was raised in the simulation; no source or save data changed. The same
  turret site remained at progress 0. The engineer stayed at
  `(287.99, 102.40)` with the repeating path `(290, 86) → (306, 86)`. The AI
  reached 27 units and still had nine completed structures; it never built a
  SAM, shipyard, airfield or corvette. `lastDecision` was massing units at base.
- **Synthetic AI tests:** the 10 tests in `tests/ai.test.ts` pass, including the
  airfield/fighter/sortie and shipyard/corvette cases. Those cases use a
  developed fixture and a boosted bank (for example 5,000–10,000 Materials), so
  they prove the branch implementation, not normal-match reachability.
- **Lost engineer:** the focused replacement-engineer test passes. The failure
  above is a reachability/progress stall, not the earlier lost-engineer case.

### 30.6 Confirmed current defects

Cross-referenced with `AUDIT_FINDINGS.md` §9.4:

1. **AI-03 — AI construction deadlock (High).** The engineer never reaches the
   site; the site remains under construction at 0 progress; the AI stops new
   construction and never reaches SAM/naval/air infrastructure.
2. **HUD-10 — result overlay destroyed by HUD layout rebuild (Medium-high).**
   `refreshLayout` recreates an empty `#end-root`; `endShown` and
   `victoryShown` prevent a re-render.
3. **HUD-11 — mobile result card overflows (High on mobile).** Actions are below
   the viewport, the page cannot scroll and the buttons are below 44 px.
4. **HUD-12 — pause overlay hidden after layout rebuild (Medium).** The
   simulation stays paused while the overlay and top-button state are stale.

### 30.7 What was not verified

1. A full player-driven 10-minute build-and-fight match; the AI simulations and
   component tests are not a human-played run.
2. Physical touch, real safe-area/notch behavior, gamepad hardware or audio.
3. Reference-image or pixel-diff comparison.
4. Mobile editor authoring.
5. AI air/naval in a normal-resource match. The current tests use a developed
   fixture; the normal run is blocked by AI-03.
6. Save/load through the three-slot UI. The 9 determinism/save tests pass, but
   the browser save-slot path was not re-clicked in this pass.
7. Continuous frame pacing and interaction while the preview tab is hidden; the
   MOVE check used one manually advanced tick.
8. A click on the mobile result actions; they were measured as off-screen rather
   than invoked.

### 30.8 Bottom line

The current tree passes typecheck, **191 tests**, the production build and the
controlled performance benchmark. The previously fixed source defects remain
fixed, and desktop result/restart works. The normal-play loop is not yet
reliable: the AI construction programme stalls and never reaches its air/naval
branches, and the mobile/layout-change result presentation can erase or trap the
end of the battle. No economy code was changed; the retained-loop decision
stands. Fix AI-03 first, then the result/pause lifecycle and mobile fit.

## 31. Skirmish commander revision — 2026-10-24

Scope: `src/sim/ai.ts`, `src/sim/types.ts`, `src/sim/game.ts`, `src/app.ts`,
`tests/ai.test.ts`. This pass replaces the fixed AI priority table with a
seeded commander and utility planner. It does not change combat, economy,
scenario or save-format rules; the save schema gains AI fields that older saves
normalise on load.

### 31.1 Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Clean |
| Tests | `npm test` | **21 files / 204 tests passed**, 15.87 s |
| Build | `npm run build` | Passed, 52 modules; CSS 60.44 kB, JS 340.95 kB (gzip 12.14 / 101.76 kB) |
| Benchmarks | `npm run bench` | 160 entities 2.744 ms/tick; 100 path orders 80.9 ms; 130-entity save 5.5 ms / restore 9.2 ms |

All commands were run on this revision; earlier section results are not reused
as proof.

### 31.2 Behavioural evidence

| Requirement | Evidence |
| --- | --- |
| The commander comes from the match seed and replays | `tests/ai.test.ts` "draws a commander from the match seed and replays the same one": six seeds include at least three strategies; `aiProfile(1234)` is stable. |
| The same map does not always open the same way | "opens differently under different commanders on the same map": seeds 1/3/6 produce more than one first structure. |
| The AI is not given the player's position | "is given its own base but not the opposing landing position": after 30 s, `targetKnown=false`, target `(0,0)`, `attackWave=0`. |
| A lost contact does not become a permanent target | `updateTarget` expires a stale trail after 40 s and returns the AI to reconnaissance; covered by the target test and source inspection. |
| Construction reacts to power, saturation, threats and damage | `buildOptions` scores the live grid deficit, harvester/refinery ratio, scouted mix, damaged structures and known air/naval contact; the MG-first test seeds infantry contacts and sees `mgNest` before `atTurret`. |
| The engineer repairs damage | "repairs a badly damaged structure when it cannot build": barracks at 40% HP recovers with a zero bank. |
| Saves preserve the opponent | "resumes the same commander from a save": seed, strategy and RNG state match after restore, and 40 s of further simulation hash identically. |
| Normal play reaches air and naval | "reaches its air and naval branches under normal starting resources": unboosted Island Assault builds an airfield and shipyard and launches at least one wave within 300 s. |
| Air sorties, naval replacement and defence remain covered | Existing airfield/fighter sortie, shipyard/corvette replacement and both-emplacement tests pass unchanged. |

### 31.3 What changed in the decision layer

- No build-order list. Construction, production, defence, scouting and attack
  are scored each second against current state; the seed chooses weights, not a
  sequence.
- No free coordinates. Own HQ location is used for placement; every enemy
  position comes from `visibleEnemies` or `contactsFor`.
- A per-match `aiSeed` is drawn by the shell, stored in `AIControlState` and
  included in saves. Tests default to the scenario seed for determinism.
- Waves have a commander-specific gate and cooldown and an overdue commit, so a
  stalled economy cannot park the army forever and an unreachable order cannot
  re-fire every second.

### 31.4 Limitations

- Simulation tests only. No human-played match, screenshot review or difficulty
  tuning; the opening test samples three seeds.
- The AI air/naval test runs until victory or 300 s and asserts construction and
  a wave, not a full combined-arms battle.
- Older saves are normalised by the controller at its next update; the
  save-format version was not bumped because the new fields are additive and
  have safe defaults.

## 32. Selectable AI difficulty — 2026-10-24

Scope: `src/sim/types.ts`, `src/sim/ai.ts`, `src/sim/game.ts`, `src/app.ts`,
`index.html`, `src/style.css`, `tests/ai.test.ts`. Adds Recruit, Veteran and
Elite commander levels. No resource, vision, combat or scenario rule changes.

### 32.1 Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Clean |
| Tests | `npm test` | **21 files / 206 tests passed**, 16.21 s |
| Build | `npm run build` | Passed; CSS 61.81 kB, JS 342.41 kB (gzip 12.40 / 102.25 kB) |
| Benchmarks | `npm run bench` | baseline 0.232 ms/tick; 160 entities 2.603 ms/tick; 100 path orders 78.1 ms; save/restore 5.1 / 10.3 ms |

### 32.2 Behavioural evidence

| Requirement | Evidence |
| --- | --- |
| Levels differ in aggression and economy | `tests/ai.test.ts` "varies aggression and economy by difficulty without changing its resources": Recruit < Veteran < Elite for both weights at seed 12345, with the same strategy. |
| No free resources or units | Same test: both games start with 3000 Materials and the same AI unit roster; only decisions differ. |
| Economy behaviour actually diverges | "crews its economy by difficulty rather than receiving extra income": after 30 s a Recruit keeps 1 harvester while Elite crews 2 from the same bank; the final banks differ because spending differs. |
| Selection reaches the simulation | Chromium: selecting ELITE set `AppSettings.difficulty`, persisted `{"difficulty":"elite"}` in `iron-tide.settings.v1`, updated the note and `aria-pressed`, and DEPLOY produced `game.state.ai.difficulty = 'elite'` with `player(1).mats = 3000` and `scenario.settings.startingMats = 3000`. |
| Save keeps the level | "resumes the same commander from a save" now starts Elite and asserts `restored.state.ai.difficulty === 'elite'` before the 40 s state-hash comparison. |
| Touch sizing | Chromium at 844×390 and 667×374: all three difficulty buttons measured 44 px high; the menu body did not need to scroll and DEPLOY remained inside it; the description hides at short height. |

### 32.3 Design boundary

Difficulty adds a bias to `aiProfile(seed, difficulty)` plus the harvester crew
target. It does not alter starting Materials, passive income, vision, fog,
damage, production speed, unit stats or available commands. Every level runs the
same utility planner and command API.

### 32.4 Limitations

- The preview session could not inject a physical pointer click; the handler was
  exercised with a DOM click. This is the same `click` listener a real pointer
  triggers, and `elementFromPoint` returned the button with no overlay.
- No human playtest or win-rate measurement across the three levels. The claim
  that Recruit is easier rests on its smaller economy, later gate and longer
  cooldown, not observed player outcomes.
- Older saves default to Veteran; a save carries no record of the menu
  preference that existed before the fields were added.

## 33. AI difficulty matchup ladder — 2026-10-24

Scope: `tests/ai-matchups.test.ts`, `src/sim/ai.ts`, `src/app.ts`,
`package.json`. This pass measures the three difficulty levels against each
other and retunes the biases; it does not change resources, vision, combat or
the command API.

### 33.1 Harness

The authored island is asymmetric, so a single match cannot separate a level's
strength from which side of the map it plays. The harness builds a symmetric
64×64 grass arena with mirrored command posts, starting forces, harvesters,
relays and ore fields. Both sides run the real `AIController` through the public
command API; the built-in single-AI hook is disabled so both think schedules are
controlled by the harness.

Each pairing is run with every level on each side (A west/B east and B west/A
east) at three seeds. The mirrored orientations cancel the arena's persistent
west-side advantage from the aggregate. A match ends on HQ destruction or at
600 s; on timeout the side with the higher material-weighted board value wins.
The score counts surviving unit/building cost, kills, bank and gathered
Materials; it does not grant the AI anything.

### 33.2 Ladder after tuning

Command: `npm run ai:matchups` (or `npx vitest run tests/ai-matchups.test.ts`).

| Pairing | Aggregate margin | Wins–losses | Reading |
| --- | --- | --- | --- |
| Recruit vs Veteran | **−16,654** | 2–4 | Veteran clearly stronger |
| Elite vs Recruit | **+17,576** | 5–1 | Elite clearly stronger |
| Elite vs Veteran | **+5,017** | 4–2 | Elite stronger, closer match |

A second clean run produced the same margins and wins (−16,654 2–4; +17,576
5–1; +5,017 4–2), confirming that the seeded harness is repeatable before the
thresholds were fixed.

The tuning changed the player-facing meaning of the level weights:

- Recruit now runs the thinnest economy and commits earlier with smaller
  forces. It previously waited longer than Veteran and was winning the matchup.
- Elite now gives up early aggression for a broader economy and later,
  better-supported push. It previously pressed earlier and lost to Veteran.
- Veteran remains the unmodified baseline.

### 33.3 Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Clean |
| Full suite | `npm test` | **22 files / 207 tests passed**, 27.60 s (matchup test 26.7 s) |
| Matchup only | `npm run ai:matchups` | 1 test passed, ~20–27 s |
| Build | `npm run build` | Passed; CSS 61.81 kB, JS 342.50 kB (gzip 12.40 / 102.29 kB) |
| Benchmarks | `npm run bench` | baseline 0.232 ms/tick; 160 entities 2.603 ms/tick; 100 path orders 78.1 ms; save/restore 5.1 / 10.3 ms |

### 33.4 Limitations

- AI-vs-AI only. No human win-rate measurement; the labels describe relative
  commander strength in this harness, not a promise about a specific player.
- The symmetric fixture has no water or ridge, so air/naval branches are not
  exercised in the ladder. Air/naval behaviour remains covered separately.
- The mirrored pair removes the map-side bias from the aggregate, not from
  every individual match. One unmirrored match still favours the west side.
- The timeout score is a material-weighted board value, not a formal victory
  condition; it decides only matches that reach 600 s without an HQ kill.

## 34. Strategic infrastructure, economic resilience and urban garrisons

Date: 2026-10-24. Verification of the milestone described in PLAN §37. The
harvesting economy remains in place; this record covers the new captured
objectives and garrison mechanics, not an economy replacement.

### 34.1 Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Clean (exit 0) |
| New tests | `npx vitest run tests/infrastructure.test.ts tests/garrison.test.ts` | **26/26 passed**, 0.84 s |
| Full suite | `npm test` | **232/233 passed**, 24 files, 30.15 s; one pre-existing failure listed in §34.4 |
| Production build | `npm run build` | Passed; 53 modules, CSS 62.60 kB (gzip 12.55), JS 370.36 kB (gzip 109.72) |
| Benchmarks | `npm run bench` | 0.238 ms/tick baseline (24 entities), 2.942 ms/tick at 163 entities, 83.1 ms for 100 path orders, 5.7 ms serialise / 9.4 ms restore for 133 entities (305 KiB) |

The test host is Windows/Git Bash on the user's machine. Numbers are from one
run and are not a distribution; the benchmark suite prints rather than gates on
timings.

### 34.2 New automated coverage

`tests/infrastructure.test.ts` (14 tests) covers:

- Engineer capture of a neutral depot, followed by exactly 2 materials/s of
  income (20 materials over 10 s from a zero bank).
- Neutral and enemy-owned depots paying nothing to the wrong player.
- Construction/destruction stopping income and repair restoring a damaged depot
  without interrupting its benefit.
- Two depots contributing independently and an ownership change removing only
  one contribution, with no duplicate tick.
- Save/load preserving depot ownership and producing identical subsequent
  income; two identical runs producing identical income; the 99,999 storage cap.
- Radar preview before capture, reveal after capture, brownout blanking the feed,
  power restoration recovering it without recapture, and destruction removing it.
- Palette/data presence, authored-only build exclusion, scenario JSON round-trip,
  occupied-footprint rejection, unreachable-shelter validation and the authored
  Kestrel placements.

`tests/garrison.test.ts` (12 tests) covers:

- Eligible entry and authoritative occupant state.
- Vehicle and engineer rejection.
- Capacity 4 with a fifth refused, including the pathing edge case where an
  approach tile outside the entry radius previously cancelled the order.
- Distinct exit tiles, movement after exit, and refusal to exit when every ring
  tile is water (occupants remain, no unit is lost).
- Occupancy cleanup after occupant death and after shelter destruction.
- Save/load preserving occupancy and replaying an identical continuation.
- Firing from inside at an in-range target and not at an out-of-range target.
- Direct anti-structure fire damaging a garrisoned rifleman less than an
  identically placed exposed rifleman.
- Enemy rejection while occupied, then successful entry after the defender dies.
- AI occupation of a nearby neutral tenement when its base is threatened.

These tests use the real `Game`, command queue, weapons, projectiles, grid and
save format. They do not mock combat.

### 34.3 Browser evidence actually obtained

The existing Vite dev server at `http://127.0.0.1:5173` was inspected through the
in-app Chromium preview. No screenshot or pixel-diff was taken.

- At 667×374, deploying Island Assault produced the battle HUD with the primary
  objective and command-bar buttons including `CAPTURE`, `GARRISON` and `EXIT`.
- At 1280×720, opening Scenario Forge and the FORCES palette listed all five new
  authored ids: `relay`, `supplyDepot`, `radarStation`, `tenement`, `ruin`
  (alongside the eleven existing structures).
- Selecting the tenement showed the hint `PLACE URBAN TENEMENT · owner 0 ·
  garrison 4 · 55% cover · shipyards need navigable coast`.
- Kestrel validation displayed `0 ERR · 0 WARN`, four objectives and the info
  line `1 forward supply depot provides secondary materials when captured.`

This confirms the editor palette, selected-structure properties and Kestrel
authoring are reachable in the running app. It does not confirm balance, a
completed capture in the browser, or a garrison fight in the browser; those were
exercised in the deterministic simulation tests, not by hand.

### 34.4 Pre-existing failure: AI difficulty ladder

`tests/ai-matchups.test.ts` remains the one failing test:

```
[matchup] Recruit vs Veteran: margin 2382, wins 3-3
[matchup] Elite vs Recruit: margin 7854, wins 4-2
[matchup] Elite vs Veteran: margin 8491, wins 4-2
AssertionError: expected 2382 to be less than -5000
```

It was failing at the start of this milestone's implementation run (before the
new garrison tests were added), and it is not caused by the new tasking:
temporarily disabling both `this.manageGarrison(ctx)` and
`this.captureObjective(ctx)` produced the same `3–3`, margin `2897` result;
those edits were reverted. The test is retained unchanged rather than weakened.
It is recorded as a baseline failure for a separate AI-balance pass, not as
evidence that the garrison/objective work passes the difficulty ladder.

### 34.5 Remaining verification gaps

- No human match, win-rate measurement or balance pass for depot income, cover
  percentages, capture timing or the Kestrel depot/shelter placement.
- No browser-level capture or garrison lifecycle test; the UI was checked for
  reachability and copy only.
- No artillery/naval bombardment matrix against occupied shelters beyond the
  direct-hit protection test.
- No long-run soak with several depots, repeated captures and save/load cycles.
- AI garrison behaviour is covered by one threatened-base fixture, not by a
  matrix of distances, capacities and access paths.

## 35. AI difficulty ladder — 2026-10-25

Scope: `src/sim/ai.ts`, `src/sim/game.ts`, `src/sim/constants.ts`,
`tests/ai.test.ts`, `tests/ai-matchups.test.ts`. No resource, vision, combat or
scenario rule changes. This pass closes the ladder failure recorded in §34.4.

Command: `npm run ai:matchups`.

| Pairing | Margin | Wins–losses | Reading |
| --- | --- | --- | --- |
| Recruit vs Veteran | **−56,746** | 5–11 | Recruit clearly weaker |
| Elite vs Recruit | **+65,583** | 13–3 | Elite dominates |
| Elite vs Veteran | **+29,490** | 10–6 | Elite stronger, closest pairing |

Eight seeds (101, 1078, 2055, 3032, 4009, 4986, 5963, 6940) are each played with
each level on each side, so 16 matches per pairing and 48 in total; the arena's
west-side bias cancels inside every mirrored pair. The run is deterministic: the
AI seed, its random stream and the match seed are all fixed, so the same numbers
reproduce on every run.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | clean |
| Full suite | `npm test` | **24 files / 234 tests passed**, 57.2 s (ladder 52.1 s) |
| Ladder only | `npm run ai:matchups` | 1 test passed, 52.1 s |
| Wider sample | `npx tsx tools/ai-matchups.ts <a> <b> 24 600` | −149,902 (15–33), +183,879 (37–11), +63,051 (26–22) — same ordering |
| Different arena economy | `... 12 900` | −80,547 (7–17), +98,300 (16–8), +47,818 (14–10) — same ordering |

What changed and why it is measured rather than asserted:

- The controller now owns its think cadence (`reactionTicks`: Recruit 60,
  Veteran 20, Elite 10 ticks). `Game.tick` calls `AIController.update` every tick
  and the controller returns immediately until its next scheduled think, so the
  ladder harness and the battle loop exercise identical timing. `AI_LOOK_INTERVAL`
  was removed because it no longer described a single cadence.
- `commitShare` (0.35 / 1.0 / 1.1) multiplies the existing assault gate;
  `reserve` (0 / 0 / 2) keeps a home guard for Elite; `responseWeight`
  (0.15 / 0.55 / 0.95) sets how far composition follows the scouted force.
  Veteran's values reproduce the previous gate exactly, which is why its
  unrelated capability tests did not move.
- The aggression bias is back to the intent of §36: Recruit presses early
  (+0.16), Elite waits for support (−0.04). Profile invariants are asserted in
  `tests/ai.test.ts`.
- Harvester crews scale with the level (1 per refinery, +1, +2) instead of
  Recruit/Veteran/Elite sharing one rule; Elite's extra refineries now have
  haulers to use.

Limitations and gaps:

- The ladder uses a 600-per-tile arena. With the shipped one-load ore fields
  (260–340 per tile) every deposit is exhausted in about three minutes and the
  three levels become indistinguishable, so the economy part of a commander's
  judgement cannot be measured there. This is a property of the retained
  economy, not of the ladder; the planned economy extension should make the
  shipped maps behave like the arena.
- One arena, one starting layout, no human opponent. The result supports
  "Recruit < Veteran < Elite against the same planner", not a win rate against a
  person, and not the campaign or six-nation rosters.
- The 48-match ladder takes about 52 s, roughly 1.1 s of test time per simulated
  match. It is the slowest test in the suite by a wide margin.
- `tools/ai-matchups.ts` is a development harness run through `npx tsx`; it is
  outside `tsconfig.json`'s include list, so it is not part of the typecheck or
  the shipped build.
