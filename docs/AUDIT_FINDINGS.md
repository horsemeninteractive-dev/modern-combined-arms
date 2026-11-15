# Implementation Audit — MCA: Modern Combined Arms Vertical Slice

Status: **Stage 1 audit (historical), the 2026-10-24 re-audit (§7), the
post-audit remediation record (§8), and the current-state re-audit (§9).**
Sections 1–6 are the Stage 1 record and must not be read as claims about the
current working tree. Section 7 is the pre-remediation audit snapshot; §8
records what was fixed; **§9 supersedes §7 and §8 and is authoritative for the
present working tree.** The original audit was read-only with respect to
application source; §8 records the implementation that followed, and §9 is a
read-only second pass.

Stage 1 date: 2026-10-23  
Stage 1 baseline: `npx tsc --noEmit` clean, 10 test files / 65 tests passing,
production build succeeds. See `VERIFICATION_REPORT.md` for commands and runtime
evidence.

Re-audit date: 2026-10-24  
Re-audit baseline (historical): no usable Git HEAD (all working-tree files report
as untracked); `npm run typecheck` clean, 20 test files / 186 tests passing,
production build succeeds, and `npm run bench` passes. Evidence is in
`VERIFICATION_REPORT.md` §28.

Post-remediation baseline (§8): typecheck clean, 20 test files / **191 tests**
passing, production build succeeds (51 modules), and the benchmark passes.
Evidence is in `VERIFICATION_REPORT.md` §29.

Current-state baseline (§9): typecheck clean, 20 test files / **191 tests**
passing, production build succeeds (51 modules), and the controlled benchmark
passes. Evidence is in `VERIFICATION_REPORT.md` §30.

Legend:

- **Confirmed violation** — implementation conflicts with an authoritative
  requirement.
- **Confirmed defect** — code or reproduced behaviour is demonstrably wrong.
- **Incomplete implementation** — required behaviour is missing or partial.
- **Verification gap** — evidence is insufficient to establish correctness.
- **Design ambiguity** — authoritative sources do not settle the decision.
- **Maintainability risk** — structure invites regressions or costly iteration.

Severity reflects consequence for the intended experience, not how easy the fix
is.

---

## 1. Summary matrix

| ID | Severity | Classification | Finding | Primary evidence |
| --- | --- | --- | --- | --- |
| HUD-01 | Critical | Confirmed violation | Desktop has no persistent right production sidebar; production remains one third of a full-width bottom deck. | `hud.ts:106–173`, `style.css:258–260`; measured 1280/1920 |
| HUD-02 | Critical | Confirmed violation | Mobile is a compressed desktop HUD, not a separate battlefield-first touch design. | `style.css:418–472`; single markup `hud.ts:106–175`; measured 844/667 |
| HUD-03 | High | Confirmed violation | Mobile touch targets are below usable size and there is no safe-area handling. | `style.css:427–448`, `index.html:5`; measured 28×26 / 21 px |
| HUD-04 | High | Confirmed violation | Touch control groups are unavailable; group strip is hidden and docs claim otherwise. | `style.css:425,457`, `hud.ts:529–545`, `README.md:68` |
| HUD-05 | High | Confirmed violation | Primary objective is hidden below 1100 px with no replacement. | `style.css:422`, `hud.ts:118–122`; measured `display:none` |
| HUD-06 | Medium | Confirmed defect | MOVE button issues no move; HOLD (position) and HOLD FIRE (stance) are lexically ambiguous. | `hud.ts:140,145,250–253,496–509` |
| HUD-07 | Medium | Confirmed violation | Production choices are 18 px icons with 7.5 px text, not image-led choices. | `style.css:334–349` |
| HUD-08 | Medium | Confirmed violation | No touch additive/multi-select mode; only box select can gather multiple units. | `input.ts:197–240`, `app.ts:428` |
| CAM-01 | High | Confirmed defect | Ground picking intersects a fixed plane, missing elevated targets by 2.3–4.3 world units. | `app.ts:459–469`, `camera.ts:151–160`; reproduced |
| CAM-02 | High | Confirmed violation | The terrain shader always draws a tile grid, so ordinary play never hides it. | `shaders.ts:155–158`; reproduced visually |
| CAM-03 | Medium | Incomplete implementation | Elevation is rendered as flat terraces with vertical cliffs; no slopes/slope transitions. | `terrainMesh.ts:46–104` |
| CAM-04 | Low | Design ambiguity | High ground affects movement/pathfinding/LOS but not vision range; no stated rule. | `terrain.ts:191–217`, `combat.ts:71–94`, `game.ts:1208–1229` |
| INF-01 | Low | Confirmed defect | Barracks description and a test name still call individual infantry "squads". | `buildings.ts:35`, `tests/sim-core.test.ts:104` |
| INF-02 | Low | Design ambiguity | Control groups are cleared on load and empty-group clicks assign rather than recall; not specified. | `app.ts:209,785`, `hud.ts:538–543` |
| WPN-01 | High | Confirmed defect | Turret hardpoint offset is rotated opposite to the body; at 90° the corvette's deck gun sits at the stern instead of the bow. | `renderer.ts:1125–1168`, `unitMeshes.ts:281–302` |
| WPN-02 | High | Confirmed defect | Turrets only aim on the tick they fire; after combat they keep a stale angle while moving. | `game.ts:1852`; reproduced |
| WPN-03 | Medium | Confirmed defect | Projectiles spawn from the hull nose, not the turret barrel. | `game.ts:1895–1906` |
| ECO-01 | Critical | Confirmed violation | Harvester/ore/refinery loop is implemented end-to-end despite being outside the intended brief. | `units.ts:145–166`, `game.ts:1510–1605`, `scenarios.ts:264–291` |
| ECO-02 | High | Incomplete implementation | Materials income depends on harvesting; deleting harvesters alone leaves no material income. | `game.ts:986–1005,1590` |
| ECO-03 | High | Maintainability risk | Economy removal touches map schema, validation, editor, AI, HUD, save and tests; no migration plan exists. | `save.ts:15–22`, `scenario.ts:612–640`, `editor.ts:241,700` |
| NAV-01 | Medium | Confirmed defect | Shipyard repairs only while missiles are missing; a full-ammo damaged corvette is never repaired. | `game.ts:1364–1374`; reproduced |
| NAV-02 | Medium | Incomplete implementation | AI never builds a shipyard or produces a corvette; it only uses its starting ship. | `ai.ts:72–91,120–178` |
| SIM-01 | Low | Incomplete implementation | Weather/time-of-day affect lighting but not tactical rules. | `renderer.ts:299,317`; no gameplay reads |
| SIM-02 | Low | Incomplete implementation | Suppression slows movement but has no morale/rout consequence. | Marked partial in PLAN; not required for slice. |
| EDT-01 | Medium | Incomplete implementation | Editor is desktop-first; mobile inspector is an off-screen drawer and tools consume 232 px. | `style.css:572–588`; measured 844 |
| DOC-01 | Low | Maintainability risk | README/PLAN test counts and touch-group claim are stale; implementation reports overstate compliance. | `README.md:68,93`, `docs/PLAN.md:197,350` |
| VER-01 | High | Verification gap | Frontline Zero reference screenshots were not available to the audit in the repository/tool context; visual similarity is unverified. | Source inventory |
| VER-02 | Medium | Verification gap | Touch, gamepad, audio and real-device safe areas were not exercised on hardware. | Runtime limitations |

**Verified conforming (not findings):**

- Deterministic fixed-step simulation and batch invariance pass
  (`tests/determinism-save.test.ts`, 65-test suite).
- 2:1 isometric projection, camera focus, rotated panning and clamping pass
  (`tests/camera.test.ts`, 7 tests).
- Individual infantry runtime identity: `rifle` is one entity; production
  increments one unit; selection reports "1 SELECTED" (reproduced).
- Air loop: parked start, fuel burn, takeoff, return, rearm; SAM/AA counter tests
  pass (`tests/air-naval.test.ts`, 4 aircraft tests). Aircraft ordnance is baked
  into the fighter mesh and moves with the body; there is no separate aircraft
  turret transform.
- Naval movement/combat/reload tests pass; editor validated and deployed the
  96×72 island (13 structures, 18 units → 31 entities).
- Combined arms is architecturally real: land/air/naval units share production,
  selection, orders and combat resolution; SAM/AA hard counters and naval
  shore bombardment are exercised by tests or runtime checks.
- Infantry lifecycle: `spawnUnit` creates one entity, the generic damage/death
  path removes it, selection stores IDs, saves serialize entities, and AI counts
  individuals. Only the "squad" copy remains wrong.
- Unit/building placement relative to terrain is correct in the renderer:
  land uses `tileWorldHeight`, naval adds a water offset, aircraft use altitude,
  and buildings use their footprint centre. The separate *input* picking defect
  (CAM-01) is what makes orders/ghosts land on the wrong tile.
- Combat LOS uses elevation, rock and forest; elevation affects movement cost,
  step limits and pathfinding.
- Asset integrity: the page references only `/src/main.ts`; all meshes, terrain,
  particles and overlays are procedural. No missing external image/model/audio
  asset was observed. `src/ui/audio.ts` implements a Web Audio engine with
  master volume/mute and event-driven cues, but it has not been auditioned.

---

## 2. Detailed findings

### HUD-01 — Desktop production is still a bottom deck, not a right sidebar

- **Severity / class:** Critical / Confirmed violation.
- **Requirement:** Stage 1 desktop direction: battlefield primary, persistent
  right-side production/construction sidebar, clear category navigation,
  image-led choices, compact top strip and compact bottom selection/command
  area. Source: Stage 1 brief; GDD §13.4–13.5 for persistent selection and
  facility queues.
- **Actual behaviour:** The battle HUD is one top bar, one floating command bar
  and a full-width `.bottom-deck` split into minimap (158 px), selection
  (flexible) and production (`minmax(320px, 34vw)`). There is no `.side-panel`
  element in the battle markup; the `.side-panel` CSS rule is unused.
- **Evidence:**
  - Markup: `src/ui/hud.ts:106–175`. Production is the third `<section>` of
    `.bottom-deck` (`:154–173`); no right sidebar is created.
  - Layout: `src/style.css:258–260` fixes the deck to the bottom, full width,
    height `var(--deck-h)` and columns `158px minmax(0,1fr) minmax(320px,34vw)`.
  - Unused sidebar styles: `src/style.css:222–232`.
  - Runtime 1280×720: top bar 62 px; deck 184 px; production 435.2 px wide;
    minimap 158 px; selection 652.8 px; clear vertical band (`deck.y - top.h`)
    474 px (65.8% of height); usable area after the command bar = 62.8% of the
    viewport.
  - Runtime 1920×1080: deck still 184 px; production 652.8 px (34vw); clear
    band 834 px (77.2% of height); usable area 75.9% of the viewport.
- **Evidence type:** Confirmed from code and reproduced at runtime.
- **Consequence:** The desktop command surface does not match the intended
  reference hierarchy. The battlefield is still the majority of the screen
  (65.8% vertical band), but production consumes a third of the width in a fixed
  full-width deck and there is no persistent construction sidebar. At 1280×720
  the deck plus top bar removes 34.2% of the height before the command bar, and
  the production panel is only 168 px tall — too short for image-led cards.
- **Correction:** Build a dedicated desktop HUD: compact top strip, right
  production sidebar (categories + facility queues + image-led cards), compact
  bottom selection/command strip, minimap placed by measurement. Remove the
  full-width deck and the unused `.side-panel` CSS.
- **Dependencies / regression risk:** HUD markup, CSS grid, minimap event
  handlers (`hud.ts:204–232`), production tab/card handlers (`hud.ts:551–650`),
  and `App.frameBattleCamera` screen-lift calculation (`app.ts:710–736`) all
  assume the bottom deck. Any height change alters opening camera framing.
- **Acceptance:** At 1280×720 and 1920×1080, production is in a persistent right
  sidebar; no full-width bottom deck; desktop clear battlefield ≥55%/≥65% by the
  measurement method in `DESIGN_SPEC_RECONCILIATION.md`; production cards have a
  thumbnail ≥96×72 px; one objective location only; no duplicated production
  controls.

### HUD-02 — Mobile is a compressed desktop HUD, not a separate design

- **Severity / class:** Critical / Confirmed violation.
- **Requirement:** Mobile landscape must be battlefield-first, touch-designed,
  with compact top/edge status, a right vertical production-category rail,
  production choices in an overlay, a contextual bottom command bar, accessible
  selection and control groups, and safe areas. Source: Stage 1 brief.
- **Actual behaviour:** The same markup is reflowed by CSS. All three bottom
  panels remain permanently visible; production is a horizontal tab strip on
  the bottom right; there is no category rail or production overlay. The
  `body.touch` class is added but no `.touch` selector exists.
- **Evidence:**
  - Single markup, no mobile branch: `src/ui/hud.ts:106–175`.
  - Responsive rules: `src/style.css:418–472` (deck 174 px at ≤1100, 142 px at
    ≤820/≤560 height, 142 px at ≤640).
  - `body.classList.add('touch')` at `src/app.ts:90`; `grep` finds no `.touch`
    rule in `src/style.css`.
  - Runtime 844×390: top bar 48, deck 142 at y=248, clear band 200 px (51.3%);
    command bar 326×36 at y=204 overlays that band, leaving 164 px (42.1%) fully
    unobstructed; usable area 47.7% of the viewport; production 371.4 px wide
    (44vw), selection 344.6 px, minimap panel 108×132.
  - Runtime 667×375: top 48, deck 142, clear band 185 px (49.3%); command bar
    326×36 overlays it; usable area 44.6% of the viewport; production 280.1 px
    (42vw), selection 282.9 px.
- **Evidence type:** Confirmed from code and reproduced at runtime.
- **Consequence:** Nearly half the mobile height is permanent HUD; production
  and selection are squeezed into the same row; the design is the desktop
  layout "scaled down", exactly the outcome the brief rejects. There is no room
  for large touch production cards without hiding the battlefield.
- **Correction:** Implement the separate mobile composition in
  `DESIGN_SPEC_RECONCILIATION.md` §5: compact top strip, right category rail,
  transient production drawer, bottom contextual command bar, selection
  sheet/chip, minimap overlay, group panel. Keep the same `Game` and commands.
- **Dependencies / regression risk:** HUD mount/render timers, minimap resize,
  pointer handlers, `frameBattleCamera` lift, editor layout breakpoints, and
  landscape orientation. The command bar currently anchors above the deck
  (`style.css:353–357`); it must re-anchor to the new bottom bar.
- **Acceptance:** At 844×390 and 667×375 with production closed, clear
  battlefield height ≥65%/≥60%; no permanent three-column deck; category rail
  present and ≥44×44 px; production opens as an overlay; bottom command bar
  visible with labels; no horizontal overflow; no panel overlap.

### HUD-03 — Touch targets and safe areas are not usable

- **Severity / class:** High / Confirmed violation.
- **Requirement:** Touch targets and safe areas designed for actual use, not
  visual similarity; no tiny controls (GDD §13.1; Stage 1 brief).
- **Actual behaviour:** Mobile command buttons shrink to icon-only 28×26 px;
  production tabs are 21 px high; stance `mini-btn`s are smaller; safe-area
  insets are not applied despite `viewport-fit=cover`.
- **Evidence:**
  - `src/style.css:427–448`: command bar 4 px padding, 2 px gap; `.cmd-btn`
    5×6 px padding, 7 px font, `.lbl` hidden; production tabs 5 px padding at
    `:467`.
  - Runtime 844×390: 10 `.cmd-btn` elements each 28×26 px; 5 `.prod-tab`
    elements 74.1×21 px; production panel 371.4 px wide. Runtime 667×375:
    buttons 28×26; tabs 56×21.
  - `index.html:5` sets `viewport-fit=cover`; `grep -n 'safe-area\|env('
    src/style.css index.html` returns no matches.
  - Command bar is 326×36 px; the labels are hidden at ≤820 px, leaving
    unlabeled icons for MOVE/ATTACK/A-MOVE/STOP/HOLD/CAPTURE/RETURN/BUILD/BOX/
    DIAG.
- **Evidence type:** Confirmed from code and reproduced at runtime.
- **Consequence:** Mis-taps in combat, unreadable icon-only commands, controls
  under notches/home indicators, and production tabs that cannot be reliably
  hit. This is a direct blocker to "touch targets ... designed for actual use".
- **Correction:** Minimum 44×44 px (48 px preferred) hit areas, 8 px spacing,
  icon + short label; raise command bar height; replace tab strip with category
  rail cards; apply safe-area padding; test at 667×375 with simulated insets.
- **Dependencies / regression risk:** More vertical space competes with the
  battlefield; the mobile composition must use overlays rather than growing
  permanent bars. Test camera lift and placement ghost after re-anchoring.
- **Acceptance:** Every essential touch control has a ≥44×44 px hit box (audit
  computed rects); no overlapping hit boxes; labels visible; safe-area CSS
  covers all four edges; 667×375 remains overflow-free and usable.

### HUD-04 — Touch control groups are missing

- **Severity / class:** High / Confirmed violation.
- **Requirement:** Dedicated, accessible selection and control-group
  interactions on mobile; persistent control groups and quick group selection
  (GDD §13.2; Stage 1 brief).
- **Actual behaviour:** Group strip is hidden at ≤1100 px and again at ≤820 px.
  Groups can only be assigned/recalled with Ctrl+Digit/Digit or the hidden strip.
  README advertises "group strip" as the touch path.
- **Evidence:**
  - CSS hides `.group-strip` at `src/style.css:425` and `:457`.
  - Group strip markup and click assignment/recall: `src/ui/hud.ts:529–545`.
  - Keyboard-only group handling: `src/ui/input.ts:307–320`.
  - README contradiction: `README.md:68` ("Control groups ... group strip").
  - Runtime 844×390: computed `display: none` for `.group-strip`.
- **Evidence type:** Confirmed from code and reproduced at runtime.
- **Consequence:** A touch player cannot create or recall control groups, which
  is a core RTS interaction and explicitly required. Documentation currently
  hides the gap.
- **Correction:** Add a touch group panel/button with assign and recall steps,
  visible at all mobile widths, 44×44 px slots; update README; add a test or
  DOM-level check that the control exists at mobile width.
- **Dependencies / regression risk:** `App.groups`, HUD render cadence, selection
  changes, save/load clearing. Do not make group assignment require a keyboard
  modifier.
- **Acceptance:** At 844×390 and 667×375 a touch user can assign selected units
  to groups 1–9 and recall them without a keyboard; group state is visible;
  README matches behaviour.

### HUD-05 — Primary objective disappears on mobile/tablet widths

- **Severity / class:** High / Confirmed violation.
- **Requirement:** Clear primary objective and relevant progress must remain
  discoverable on mobile (GDD §8.9, §13.6; Stage 1 mobile direction).
- **Actual behaviour:** `.top-objective` is hidden at `max-width: 1100px`; there
  is no alternate objective chip, sheet or menu entry. The HUD markup places
  the objective only in that element.
- **Evidence:** `src/style.css:422`; `src/ui/hud.ts:118–122`; runtime 844×390
  computed `.top-objective { display: none }` and width 0.
- **Evidence type:** Confirmed from code and reproduced at runtime.
- **Consequence:** Mobile players lose the victory condition and relay progress,
  making the battle direction opaque. This is especially harmful because the
  scenario's primary objective is destroy-HQ, not annihilation.
- **Correction:** Add a compact objective chip/sheet on mobile and a persistent
  desktop objective location. Do not duplicate on desktop.
- **Dependencies / regression risk:** Objective text is computed by
  `primaryObjective(game)` in the HUD; moving it must preserve updates.
- **Acceptance:** At 844×390 and 667×375 the primary objective and relay progress
  are reachable in at most one tap, with text that updates on capture/destruction.

### HUD-06 — The MOVE button is a no-op and HOLD labels conflict

- **Severity / class:** Medium / Confirmed defect.
- **Requirement:** One command bar; no duplicated or misleading controls;
  clear contextual command model (GDD §13.3; Stage 1 "no duplicated controls").
- **Actual behaviour:** The button labelled MOVE with a move icon does not issue
  a move. It cancels the current mode and shows a toast telling the player to
  right-click. Separately, the command bar's HOLD is hold-position, while the
  selection panel's HOLD FIRE is a stance; both read as "HOLD".
- **Evidence:** `src/ui/hud.ts:140` (MOVE button), `:250–253` (only
  `cancelMode` + toast), `:145` (HOLD), `:263–265` (`commandHold`),
  `:496–509` (stance buttons including HOLD FIRE). Runtime snapshot shows both
  HOLD and HOLD FIRE.
- **Evidence type:** Confirmed from code and reproduced in the DOM.
- **Consequence:** A player who presses MOVE expects an order mode; on touch
  there is no right-click to follow the instruction. HOLD vs HOLD FIRE causes
  command errors. This is exactly the "appears to issue a command but only
  shows help" duplication the audit was asked to find.
- **Correction:** Remove MOVE as a command; make the bar show contextual
  Move/Attack-Move or a real move mode. Rename HOLD → HOLD POSITION (or STOP/
  HOLD POS.) and keep HOLD FIRE as a stance. Ensure touch feedback does not
  reference right-click.
- **Dependencies / regression risk:** HUD action switch, touch tap handling,
  mode banner, keyboard shortcuts. Keep command parity.
- **Acceptance:** Every visible command button issues its labelled command;
  "HOLD" never refers to two different commands; touch help never instructs a
  right-click.

### HUD-07 — Production choices are icon-and-text chips, not image-led

- **Severity / class:** Medium / Confirmed violation.
- **Requirement:** Image-led building/unit choices with strong hierarchy and
  readable production categories (Stage 1 desktop direction; GDD §13.8).
- **Actual behaviour:** Unit cards are 3-column cells with an 18×18 px SVG icon,
  7.5 px name and 7.5 px cost. Build cards are 2-column rows with a 24×24 px
  icon. There are no rendered unit/building images or thumbnails.
- **Evidence:** `src/style.css:334–349`; markup
  `src/ui/hud.ts:588–637`; icons are inline SVG from `src/ui/icons.ts`.
- **Evidence type:** Confirmed from code and runtime screenshots.
- **Consequence:** Choices are hard to scan, especially on mobile; the visual
  hierarchy is a dense grid rather than the reference's image-led production.
- **Correction:** Add a shared thumbnail renderer or pre-rendered isometric
  portraits for units/buildings; use ≥96×72 px cards with name/cost/state;
  keep text labels. Do not add external assets without approval; procedural
  thumbnails are acceptable if readable.
- **Dependencies / regression risk:** Renderer offscreen context, HUD update
  cadence, asset loading/fallbacks, build size. Avoid per-frame thumbnail
  rendering.
- **Acceptance:** Production cards show a recognisable unit/building image at
  ≥96×72 px; name/cost/requirement text remains readable at 1280×720 and
  mobile overlay width; no 7.5 px essential label.

### HUD-08 — Touch cannot add a unit to the current selection

- **Severity / class:** Medium / Confirmed violation.
- **Requirement:** Dedicated, accessible selection interactions on touch;
  multi-selection must not depend on a keyboard modifier (Stage 1 mobile
  direction; `DESIGN_SPEC_RECONCILIATION.md` §3.1).
- **Actual behaviour:** Tapping a friendly unit replaces the selection unless
  `shiftKey` is held. Box select also receives `shiftKey` for additive mode.
  Mobile has no add toggle, no long-press add, and no selection-sheet control.
  The only way to select multiple units on touch is a drag box, which cannot
  combine distant units.
- **Evidence:** `src/ui/input.ts:161` and `:197–240` (`additive` = `shiftKey`);
  box select `:150`; `App.toggleSelectionAt` exists at `src/app.ts:428` but no
  touch path calls it. `grep` finds no touch additive control.
- **Evidence type:** Confirmed from code.
- **Consequence:** A touch player cannot build a mixed force selection (e.g.
  tanks plus AA) without boxing them together. This blocks a core control-group
  workflow and makes the mobile HUD less capable than desktop.
- **Correction:** Add an explicit "Add" / multi-select toggle in the selection
  sheet or command bar, or a long-press add gesture with visual feedback; keep
  tap-to-replace as the default. Ensure the group assign action uses the
  resulting selection.
- **Dependencies / regression risk:** `InputController` click handling, HUD
  selection sheet, group assignment, mode banners. Do not make every tap
  additive; provide a clear mode toggle with an exit.
- **Acceptance:** At 844×390 a touch user can select a tank, then add an AA
  vehicle tapping it, and assign both to a group; tapping empty ground clears
  the selection; the mode is visibly indicated.

### CAM-01 — Ground clicks and building placement miss on elevated terrain

- **Severity / class:** High / Confirmed defect.
- **Requirement:** Correct unit placement relative to terrain height; contextual
  commands should land where the player points (Stage 1 battlefield/camera;
  GDD §13.3).
- **Actual behaviour:** `App.worldAt` projects the pointer onto a fixed
  `y = 0.8` plane. The terrain surface is at `elevation * 1.15` (1.15, 2.3,
  etc.). On raised ground the ray intersects the plane "behind" the visible
  surface, so orders and placement ghosts shift toward the camera.
- **Evidence:** `src/app.ts:459–469` (`screenToGround(..., 0.8)`);
  `src/render/camera.ts:151–160`; `src/sim/constants.ts` `ELEVATION_HEIGHT =
  1.15`. Runtime measurements at 844×390:
  - Base entity at (70,146), ground height 1.15: pick (68.3,144.3), error
    2.34 world units.
  - Plateau entity at (304,104), ground height 2.30: pick (300.9,100.9), error
    4.33 world units, just over one tile.
- **Evidence type:** Reproduced at runtime (camera projection → `worldAt`).
- **Consequence:** Right-click/tap move orders, rally points and building
  placement are systematically offset, worse on plateaus. This directly harms
  the elevation gameplay the brief asks to make meaningful.
- **Correction:** Implement terrain-aware picking: iterate from a high plane
  down, binary-search along the view ray against `game.heightAt`, or ray-march
  the heightfield. Use the resolved point for `worldAt`, placement and minimap
  jump; keep selection screen-space.
- **Dependencies / regression risk:** Camera projection tests, placement ghost,
  box selection, panning, terrain mesh height, water surface. Fix once in a
  shared `screenToTerrain` helper; add tests at elevation 0/1/2 and water.
- **Acceptance:** At screen points over elevation 1 and 2 terrain, the resolved
  point is within 0.25 world units of the visible tile centre; placement ghost
  matches the footprint under the cursor; no regression in flat-ground tests.

### CAM-02 — The tile grid is permanently visible in ordinary play

- **Severity / class:** High / Confirmed violation.
- **Requirement:** Construction grid hidden during ordinary gameplay; only in
  building placement or explicit editor/grid inspection (Stage 1 brief).
- **Actual behaviour:** The terrain fragment shader computes a checker at
  `fract(vWorld.xz / 4.0)` and darkens edges by 6%. There is no uniform or
  renderer state to disable it. Screenshots at 1280×720 and 844×390 show a
  strong 4-world-unit grid over all land.
- **Evidence:** `src/render/shaders.ts:155–158`; renderer has no grid toggle
  (`grep -rn 'grid' src/render` only finds this shader comment and editor
  overlay). Runtime screenshot at 1280×720 shows the checker across sand and
  road.
- **Evidence type:** Confirmed from code and reproduced visually.
- **Consequence:** The battlefield reads as a debug/editor map in ordinary
  play, contrary to the intended presentation. It also competes with terrain
  material variation and unit silhouettes.
- **Correction:** Remove the shader checker or gate it behind a `uShowGrid`
  uniform. Draw a placement/editor grid only when `mode === 'place'`, editor
  active, or explicit grid inspection; use a separate overlay pass so it can
  follow elevation.
- **Dependencies / regression risk:** Terrain shader compile paths, editor
  overlay (`editorRender.ts:35–51` already draws a grid), placement ghost
  (`overlay.ts:287–323`). Do not remove the editor grid.
- **Acceptance:** Ordinary battle screenshots show no tile-grid lines; entering
  placement shows a grid aligned to the footprint; editor shows its grid; a
  debug toggle can reveal it without changing gameplay.

### CAM-03 — Elevation is legible as terraces but has no slope transitions

- **Severity / class:** Medium / Incomplete implementation.
- **Requirement:** Visually obvious elevation changes including appropriate
  slopes, cliffs, height transitions and shadows (Stage 1 brief).
- **Actual behaviour:** Each land tile is a flat quad at
  `elevation * ELEVATION_HEIGHT`; vertical cliff quads are generated when a
  neighbour is lower. There is no slope mesh, no interpolated height at tile
  edges, and units snap to the new height when crossing a tile boundary.
- **Evidence:** `src/render/terrainMesh.ts:46–104` (flat top vertices, vertical
  sides); `src/render/renderer.ts:977–979` (unit y = tile height + offset);
  `src/sim/constants.ts` (1.15 per level). Runtime screenshots show distinct
  cliffs/plateaus but hard tile steps.
- **Evidence type:** Confirmed from code and visual runtime inspection.
- **Consequence:** Elevation is readable, so this is not a failure of the basic
  requirement; it is a presentation limitation. Hard steps can read as
  blocky/placeholder terrain, and units pop vertically at tile boundaries.
- **Correction:** Add chamfered/slope skirt geometry at height transitions
  (renderer only) and interpolate unit y near edges, or keep terraces and
  document the style. Do not change tile gameplay heights.
- **Dependencies / regression risk:** Terrain mesh generation, cliff normals,
  prop placement, shadows, camera occlusion. A slope mesh must not create
  invisible walkable areas.
- **Acceptance:** At normal zoom, elevation transitions show either a
  deliberate terrace/cliff edge or a lit slope; no floating tile corners; units
  do not visibly float or sink when crossing a boundary.

### CAM-04 — Elevation affects rules unevenly; high-ground observation is undefined

- **Severity / class:** Low / Design ambiguity.
- **Requirement:** Report rendering, movement, pathfinding and relevant LOS/
  combat rules separately; do not claim tactical effects without tracing them
  (Stage 1 brief; GDD §8.6 "elevation and observation").
- **Actual behaviour:**
  - Movement: `moveCost` adds uphill cost and blocks steps above
    `ELEVATION_STEP` (`terrain.ts:191–217`).
  - Pathfinding: uses the same cost/step checks (`pathfinding.ts:74–100`).
  - LOS: `hasLineOfSight` rejects intermediate tiles above
    `max(start,end)+0.4`, and rejects rocks/3+ forest tiles
    (`combat.ts:71–94`).
  - Vision: `stampVision` uses a circular radius and LOS, but no elevation
    bonus (`game.ts:1208–1229`).
  - Combat range: planar distance only; no height modifier.
- **Evidence type:** Confirmed from code.
- **Consequence:** Elevation is real for movement and LOS, but high ground does
  not improve observation or range. Players may infer a bonus that does not
  exist. The GDD's "elevation and observation" phrasing is not a concrete rule.
- **Correction:** Decide and document a rule. Default per P-08: no bonus until
  designed. If a bonus is added, show it in unit stats/tooltips and test LOS
  from high ground.
- **Dependencies / regression risk:** Fog/vision balance, AI target acquisition,
  scenario ridge design, UI tooltips.
- **Acceptance:** Documentation and UI do not imply a high-ground bonus that the
  code lacks; if added, a test proves increased vision/range and the HUD exposes
  it.

### INF-01 — Individual infantry are implemented, but copy still says "squads"

- **Severity / class:** Low / Confirmed defect.
- **Requirement:** Infantry entities represent individual soldiers; no
  automatically produced/simulated squads (Stage 1 brief).
- **Actual behaviour:** The simulation is correct: `rifle` is one `UnitDef`,
  one entity per production item, one selection entry, one health pool. But the
  barracks description says "Trains infantry squads and anti-tank teams", and a
  test name says "deploys an infantry squad".
- **Evidence:** `src/data/units.ts:30–51` (Rifleman, single soldier description);
  `src/sim/game.ts:258–320` (`spawnUnit` creates one entity);
  `src/sim/game.ts:1102–1168` (facility spawns one); `src/data/buildings.ts:35`;
  `tests/sim-core.test.ts:104`.
- **Evidence type:** Confirmed from code and test; runtime selection shows one
  Rifleman and "1 SELECTED".
- **Consequence:** The rule is implemented but the product language contradicts
  it, inviting future agents/users to reintroduce squads. This is exactly the
  "do not accept a unit called Rifleman as proof" trap; here the code passes,
  the copy does not.
- **Correction:** Change "squads" to "soldiers"/"infantry"; rename the test to
  "deploys one rifleman"; update README/PLAN if they use squad language.
- **Dependencies / regression risk:** Localisation/copy, onboarding text.
- **Acceptance:** No player-facing or test description calls a single infantry
  entity a squad; production/selection UI says one soldier and lists individual
  counts.

### INF-02 — Control-group semantics are ambiguous and not persisted

- **Severity / class:** Low / Design ambiguity.
- **Requirement:** Persistent control groups, quick group selection, clear
  mixed-selection behaviour (GDD §13.2; Stage 1).
- **Actual behaviour:** Groups are an in-memory `Map` in `App`. Loading a save
  or starting/returning clears them. Clicking an empty group slot assigns the
  current selection; clicking a populated slot recalls it. There is no visual
  distinction between "empty, click to assign" and "empty, click to do
  nothing".
- **Evidence:** `src/app.ts:58` (`groups = new Map`), `:209` and `:785` clear;
  `src/ui/hud.ts:538–543` assign-if-empty/recall-if-present.
- **Evidence type:** Confirmed from code.
- **Consequence:** Players can lose groups after loading without being told, and
  an accidental click on an empty slot can overwrite it. This is a UX risk, not
  a simulation defect.
- **Correction:** Make group assignment an explicit action (e.g. "Assign mode"
  or Shift/Ctrl semantics mirrored on touch); persist groups in the save or
  clearly label them session-only; show empty/populated state.
- **Dependencies / regression risk:** Save schema, HUD strip/panel, touch group
  UI, selection changes.
- **Acceptance:** A player cannot accidentally overwrite a group with a single
  recall click; after load, group availability is either restored or explicitly
  explained.

### WPN-01 — Turret hardpoint is rotated opposite to the hull

- **Severity / class:** High / Confirmed defect.
- **Requirement:** Weapons move with their parent, turrets rotate around
  plausible pivots and aim correctly, and offsets remain correct across all
  headings (Stage 1 weapon section).
- **Actual behaviour:** The body and turret yaw are both passed as `-facing`,
  which is correct: `modelFor` maps local +X to `(cos f, +sin f)`, matching the
  simulation. But `turretWorldMatrix` rotates the hardpoint offset with the
  inverse convention: `ox = x*cos(-f) - z*sin(-f)`, `oz = x*sin(-f) +
  z*cos(-f)`, which maps a local +X offset to `(cos f, -sin f)`. For the
  corvette's bow hardpoint `[4.7, 1.5, 0]` (scaled by 0.42), at 90° the hull bow
  is at +Z while the turret is at -Z: a separation of about **3.95 world units**
  (9.4 local mesh units), roughly one tile. At 0° and 180° the error is
  invisible. Tank/recon/AA offsets have `x = 0`, so they are centered and do not
  expose it; the corvette does.
- **Evidence:**
  - Body transform: `src/render/renderer.ts:1125–1139` (passes `-facing` to
    `modelFor`).
  - Turret transform: `src/render/renderer.ts:1141–1168`, especially the offset
    at `:1153–1154`.
  - `modelFor`: `src/render/renderer.ts:1169–1190`; its local +X column is
    `(m0, m2) = (cos f, sin f)`.
  - Corvette bow and hardpoint: `src/render/unitMeshes.ts:281–302`; corvette
    visual scale 0.42 at `:309`.
- **Matrix check (offset local +X):**

  | Heading | Body forward | Turret hardpoint |
  | --- | --- | --- |
  | 0° | (1.000, 0.000) | (1.000, 0.000) |
  | 90° | (0.000, 1.000) | (0.000, -1.000) |
  | 180° | (-1.000, 0.000) | (-1.000, 0.000) |
  | 270° | (0.000, -1.000) | (0.000, 1.000) |

- **Evidence type:** Confirmed from code (matrix derivation and numeric check).
  Visual isolation at an exact 90° heading was not captured, so the runtime
  *appearance* is inferred from the transform, not independently screenshotted.
- **Consequence:** The corvette's deck gun is placed at the stern as the ship
  turns away from 0°/180°, roughly one tile from the bow hardpoint. It reads as
  detached from the superstructure and fires from the wrong end. The same helper
  will misplace any future offset with an X component.
- **Correction:** Rotate the offset with the same matrix as the body:
  `ox = offset[0]*cos(f) - offset[2]*sin(f)` and `oz =
  offset[0]*sin(f) + offset[2]*cos(f)`. Better, build the offset by applying
  the body matrix to `[x,y,z,1]`. Use one shared helper and a heading matrix
  test. Do not add per-unit counter-offsets.
- **Dependencies / regression risk:** Corvette turret placement; any future
  turret offset with X/Z; static scenario preview; shadows (use hull facing, not
  turret offset); muzzle origin still needs the separate WPN-03 fix.
- **Acceptance:** For headings 0/90/180/270°, the turret pivot remains at the
  intended hardpoint within 0.25 world units; the corvette gun stays on the bow
  through a 90° turn; a unit test covers body and hardpoint transforms.

### WPN-02 — Turrets do not track; they snap only when firing

- **Severity / class:** High / Confirmed defect.
- **Requirement:** Turrets rotate around plausible pivots and aim; weapons remain
  attached while aiming/firing (Stage 1 weapon section).
- **Actual behaviour:** `tryFire` is the only code that assigns
  `e.turretFacing = atan2(target - e)`. There is no continuous tracking in
  `updateOrderTargeting`, `updateAutoEngagement`, idle, or movement. After a
  fight, the turret keeps its last firing angle while the hull drives elsewhere.
  Note: WPN-01 separately places the corvette's gun at the wrong hardpoint, so
  fix the offset transform first, then continuous tracking.
- **Evidence:** `src/sim/game.ts:1835–1852` (assignment only inside `tryFire`);
  `grep turretFacing` finds no other mutation except spawn/base. Runtime: after
  the player tank drove east and combat ended, `facing` was 0.00 while
  `turretFacing` remained 2.94 rad; the tank was idle/moving with the turret
  pointing backwards.
- **Evidence type:** Confirmed from code and reproduced at runtime.
- **Correction:** Track the current target/aim point every tick at a bounded turn
  rate, separate from the hull; hold a rest angle when idle; update when an
  attack order is issued, not just when cooldown reaches zero.
- **Dependencies / regression risk:** Determinism (turret angle must not affect
  damage/aim unless explicitly used), renderer interpolation, save state,
  projectile origin. Keep turret aim presentation-only unless a rule uses it.
- **Acceptance:** While a tank/corvette is engaging a target, its turret points
  within a small angle of the target and follows it; while moving without a
  target, it holds a defined rest/forward angle; no stale 180° turret after
  combat.

### WPN-03 — Projectiles spawn from the hull, not the barrel

- **Severity / class:** Medium / Confirmed defect.
- **Requirement:** Barrels remain attached while aiming and firing; combat
  feedback should read correctly (Stage 1 weapon section).
- **Actual behaviour:** `muzzlePoint` computes a point `2 + radius*0.8` world
  units forward of the hull centre along `e.facing`, at `height + 1.5`. It
  ignores `turretFacing` and the turret offset. A tank firing sideways while
  driving forward emits its shell from the front of the hull, not the barrel;
  on the corvette, WPN-01 puts the gun at the stern while the shell starts at
  the bow, which makes the attachment error look worse.
- **Evidence:** `src/sim/game.ts:1895–1906`; usage at `:1859`; turret angle at
  `:1852`.
- **Evidence type:** Confirmed from code (runtime projectile tracing not
  isolated).
- **Consequence:** Tracers/shells appear to come from the wrong point, weakening
  combat readability and making the turret look detached from its fire.
- **Correction:** Compute the muzzle from the active hardpoint in turret space,
  transformed by the same parent/turret matrices used by the renderer; for
  aircraft use hardpoints or nose; for buildings use the weapon mount.
- **Dependencies / regression risk:** Renderer/simulation shared convention,
  projectile visuals, accuracy/spread origin, save state.
- **Acceptance:** At a 90° turret bearing, the projectile/tracer origin lies at
  the barrel tip (within 0.5 world units), not the hull nose; visual and
  simulation origins agree.

### ECO-01 — Harvester/ore/refinery loop is implemented end-to-end

- **Severity / class:** Critical / Confirmed violation.
- **Requirement:** The RA2-style harvesting loop was not part of the intended
  brief. Harvester units, ore fields, refinery delivery and automated mining
  must not be treated as required features (Stage 1; supersedes GDD §10.1 and
  §16.3 recommendations).
- **Actual behaviour:** A complete economy loop exists:
  - `harvester` unit with cost, HP, speed, production source and description.
  - `refinery` building with `refinery: true`, `reqPerSec: 0.1`, drop-off copy.
  - Ore values in scenario tiles/runtime map; two starting harvesters, ore fields
    and refineries in Kestrel Bay.
  - `HarvesterState` phase machine: seek → toOre → mining → toRefinery →
    unloading; 22 material/s mining, 100-unit loads, 1.2 s unload.
  - AI builds a second refinery and excludes harvesters from combat; economy
    checks use harvested materials.
  - Editor has an ORE brush, ore summary, ore validation and ore-aware placement
    checks.
  - HUD shows harvester states (MINING/DELIVERING/HARVESTING) and income.
  - Save schema contains `ore` and `maxOre`; runtime map contains ore.
  - Tests and performance stress filter/expect harvesters.
- **Evidence:**
  - `src/data/units.ts:145–166`; `src/data/buildings.ts:51,58–73`;
    `src/sim/types.ts:96–97,233` (`refinery`, `harvester`);
    `src/sim/game.ts:278–287,1510–1605`;
    `src/data/scenarios.ts:264,272,282,291`;
    `src/sim/ai.ts:52,73–85,217`;
    `src/ui/editor.ts:241,700–704`; `src/sim/scenario.ts:612–640`;
    `src/sim/save.ts:15–22`; `src/ui/hud.ts:42–45`;
    `tests/sim-core.test.ts:45–50`, `tests/perf.test.ts:76`.
- **Evidence type:** Confirmed from code; economy was also observed at runtime
  (materials increased from harvesting, 31→34 entities, AI produced units).
- **Consequence:** The slice is built around a mechanic the product explicitly
  does not want. Every economy balance decision, AI behaviour, map, HUD label
  and save depends on it. This is the largest scope/spec violation in the
  project.
- **Correction:** Treat removal as a separate, dependency-ordered milestone after
  the replacement economy is approved (see `REMEDIATION_PLAN.md`). Do not delete
  only the unit; remove ore/deposit/drop-off/AI/editor/save dependencies and add
  the replacement income.
- **Dependencies / regression risk:** Units/buildings data, scenario schema and
  authored map, runtime map, AI construction/production, editor tools and
  validation, HUD rates/states, save format, tests, performance scenarios,
  documentation. High regression risk; requires fixtures and a migration.
- **Acceptance:** No required harvester/ore/refinery loop remains; replacement
  economy funds a complete build-and-fight loop; AI economy works; scenario and
  save format are versioned/migrated; no HUD/editor/test references imply
  harvesting is required.

### ECO-02 — Materials income has no non-harvester source

- **Severity / class:** High / Incomplete implementation.
- **Requirement:** After removing harvesting, a confirmed/provisional replacement
  must fund construction and production. Deleting harvesters alone is a
  regression (Stage 1 economy).
- **Actual behaviour:** `updatePassiveIncome` only adds Requisition from
  `reqPerSec` buildings. It does not add Materials. Materials are credited only
  in the harvester unload branch (`player.mats += h.ore`). Starting materials are
  scenario-configurable, but there is no ongoing Materials income once they are
  spent.
- **Evidence:** `src/sim/game.ts:986–1005` (passive income loop only `p.req`),
  `:1590` (only `player.mats += h.ore`), `:742`-context (starting resources);
  `matsPerMinute` reads `stats.matsGathered`, which is harvester-only
  (`:1015–1019`). `reqRate` separately sums `reqPerSec`.
- **Evidence type:** Confirmed from code.
- **Consequence:** Any naive harvester deletion leaves the player and AI unable
  to replace losses or expand. The economy silently dead-ends, violating the
  complete-loop quality gate.
- **Correction:** Implement the approved replacement (P-02 map-control income or
  another approved model) before or with removal; add a rate/source API and HUD
  breakdown; ensure AI uses it.
- **Dependencies / regression risk:** Income UI, AI affordability, construction
  costs, scenario starting resources, balance, save state. Must be tuned against
  a full loop, not just a unit test.
- **Acceptance:** With no harvester in the roster, a player can build a facility,
  produce a small force and replace losses over at least 10 minutes; AI does the
  same; HUD shows the income source and rate; no negative/NaN resources.

### ECO-03 — Economy removal has no schema/editor/AI migration plan

- **Severity / class:** High / Maintainability risk.
- **Requirement:** Removal must be end-to-end; save/scenario versioning and
  migrations must be defined (Stage 1 economy; GDD §15).
- **Actual behaviour:** Ore is a first-class scenario field and runtime map
  field, saved in `SerializedMap`, validated for reachability, painted in the
  editor, counted in map summaries, and consumed by AI/perf tests. There is no
  migration path for old saves/scenarios and no alternate economy validation.
- **Evidence:** `src/sim/save.ts:15–22`; `src/sim/types.ts:96–97,233`;
  `src/sim/scenario.ts:612–640` (ore validation), `:698–738` (ore placement
  checks); `src/ui/editor.ts:241,468,700–704`; `src/data/scenarios.ts:264–291`;
  `tests/scenario.test.ts:110` (ore reachability test); `tests/perf.test.ts:76`.
- **Evidence type:** Confirmed from code and test suite.
- **Consequence:** A partial removal will leave dead schema, misleading editor
  tools, invalid validation rules, stale tests and saves that either fail
  obscurely or resurrect removed content. This is a maintenance trap.
- **Correction:** Define a version bump and migration: strip `ore`/`maxOre`
  (and harvester entities) from old saves/scenarios or fail with a clear
  incompatibility message; remove/rename editor tools and summaries; replace ore
  validation with replacement-income validation; update perf/test fixtures;
  update docs.
- **Dependencies / regression risk:** Save fixtures, editor UI, scenario parser,
  map stats, AI build plans, acceptance of old user maps. Do this in one
  dependency-ordered change set with tests.
- **Acceptance:** Loading an old v1 save after the change either migrates
  deterministically or reports a clear version error; new scenarios contain no
  ore/harvester requirements; editor has no dead ORE tool; all tests pass.

### NAV-01 — Shipyard repair is incorrectly gated on missing ammunition

- **Severity / class:** Medium / Confirmed defect.
- **Requirement:** Naval vessels repair at a shipyard; repairs are a meaningful
  operational constraint (GDD §9.3; Stage 1 naval).
- **Actual behaviour:** The repair line is nested inside
  `if (e.ammo < e.maxAmmo)`. A corvette docked at full missile load does not
  repair, even at 50% HP. A corvette with one missile missing repairs normally.
- **Evidence:** `src/sim/game.ts:1364–1374`; runtime at 844×390:
  - Teleported corvette to 8 units from its shipyard, HP 475/950, ammo 6/6;
    after 3 s HP remained 475.
  - Set ammo to 5/6; after 1 s HP rose to 504.1 and ammo returned to 6/6.
- **Evidence type:** Reproduced at runtime; code confirms.
- **Consequence:** A damaged ship that survived a fight with full missiles cannot
  repair, contradicting the intended port/repair loop. Players must waste a
  missile or leave the ship damaged.
- **Correction:** Move repair outside the ammo condition; while docked and
  operational, repair at a defined rate regardless of ammo. Keep reload as a
  separate timer.
- **Dependencies / regression risk:** Balance, HUD repair state, tests
  (`tests/air-naval.test.ts` sets ammo 0, so it missed this), AI return logic.
- **Acceptance:** A docked corvette at any ammo level repairs over time; a test
  covers full-ammo repair; HUD shows repairing state.

### NAV-02 — AI does not build or produce naval power

- **Severity / class:** Medium / Incomplete implementation.
- **Requirement:** AI should meaningfully use the available domains; land, air
  and naval are core (Stage 1; GDD §9.4, §16.5).
- **Actual behaviour:** The AI construction chain builds SAM, airfield, a second
  refinery, barracks and factory — never a shipyard. Production desires engineer,
  fighter, tank, ATGM, AA, rifle — never a corvette. The only naval behaviour is
  ordering the starting corvette at visible targets within 34 tiles.
- **Evidence:** `src/sim/ai.ts:72–91` (build types), `:120–145` (production
  types), `:161–178` (uses existing ship only); scenario gives AI a starting
  shipyard/corvette (`src/data/scenarios.ts:273`, `:296`).
- **Evidence type:** Confirmed from code. The AI branches contain no shipyard or
  corvette entry, and the scenario supplies both as pre-placed assets; a 150 s AI
  run shows a corvette only because it starts on the map. No AI naval production
  path exists to test yet.
- **Consequence:** The AI's naval presence is a static starting unit; it cannot
  replace losses or contest the bay over time. This undercuts "all three domains
  meaningfully represented" on the AI side.
- **Correction:** Add a bounded naval branch: if the AI owns/needs a shipyard and
  has water access, build/produce one corvette and use it for coastal attack or
  defence. Do not build a full naval strategy.
- **Dependencies / regression risk:** Build-site search for water, economy,
  production queues, AI tests, performance. Shipyard placement requires coastal
  validation.
- **Acceptance:** In a 7–10 minute AI test with water, the AI has produced or
  replaced at least one corvette and used it in a naval/coastal order; no AI
  stall or invalid placement.

### SIM-01 — Weather/time-of-day are lighting settings, not tactical systems

- **Severity / class:** Low / Incomplete implementation.
- **Requirement:** Tactical weather/time effects where they add useful choices;
  effects must be communicated (GDD §8.8, §19.1). The GDD allows staging.
- **Actual behaviour:** Scenario settings validate `clear/overcast/rain` and
  `dawn/day/dusk/night`; the renderer uses them for sun/ambient/water palette.
  No simulation system reads weather or time for vision, movement, aircraft,
  weapons or accuracy.
- **Evidence:** `src/sim/scenario.ts:61–62,234–249`;
  `src/render/renderer.ts:299,317`; `grep` finds no gameplay reads in `src/sim`.
- **Evidence type:** Confirmed from code.
- **Consequence:** The settings imply tactical effects that do not exist. This is
  acceptable only if the slice explicitly labels them as presentation; otherwise
  it is misleading.
- **Correction:** Either label weather/time as visual-only in the editor/help, or
  add one bounded, communicated rule (e.g. rain reduces aircraft accuracy) with
  tests. Do not add a broad weather simulation in this milestone.
- **Dependencies / regression risk:** Lighting, balance, AI, UI tooltips.
- **Acceptance:** Documentation/editor accurately describes the effect; any
  gameplay effect is visible and tested.

### SIM-02 — Suppression has no morale/rout consequence

- **Severity / class:** Low / Incomplete implementation.
- **Requirement:** Light suppression; a full morale model is not required for
  the slice (GDD §8.3; PLAN marks partial).
- **Actual behaviour:** Suppression reduces accuracy and movement speed; it
  decays over time. There is no morale state, rout, pinning or surrender.
- **Evidence:** `src/sim/game.ts` suppression decay/accuracy penalties; overlay
  suppression bar; PLAN §3 marks §8.3 "Partial".
- **Evidence type:** Confirmed from code and documentation.
- **Consequence:** Combat is simpler than the long-term design, but this is an
  accepted slice limitation, not a violation. Report it so it is not mistaken
  for a complete morale system.
- **Correction:** No action in the HUD/economy milestone. If expanded, design a
  readable morale rule and test it.
- **Acceptance:** Documentation does not claim a morale/rout system.

### EDT-01 — Editor is desktop-first; mobile editing is cramped

- **Severity / class:** Medium / Incomplete implementation.
- **Requirement:** Editor is a core product feature; the slice must author,
  validate and deploy. Mobile parity is desirable but the brief focuses on the
  battle HUD (GDD §12; Stage 1).
- **Actual behaviour:** At 844×390 the editor keeps a 232 px left tool column and
  moves the 300 px inspector off-screen as a drawer. The battlefield is ~612 px
  wide, tool buttons are 63×44 px, and the top bar is 58 px. The inspector is
  only reachable via INSPECT. At 667×375 the left column is 210 px.
- **Evidence:** `src/style.css:572–588`; runtime at 844×390:
  `.editor-tools` x=0 w=232 h=332; `.editor-side` x=846 (off-screen), transform
  translateX(302px); tool buttons 63×44; top bar 58. Screenshot shows dense
  three-column tool grid.
- **Evidence type:** Confirmed from code and reproduced at runtime.
- **Consequence:** The editor is usable on desktop but not designed for touch;
  small tool labels and a hidden inspector make mobile authoring awkward. This
  is lower priority than the battle HUD but should be acknowledged.
- **Correction:** Provide a mobile editor layout with a collapsible tool drawer
  and a bottom sheet inspector; enlarge tool hit areas. Do not block the battle
  HUD milestone on it.
- **Dependencies / regression risk:** Editor render/canvas sizing, input,
  validation panel, save/load.
- **Acceptance:** At 844×390 and 667×375 a user can open tools, paint, inspect,
  validate and deploy without an off-screen undiscoverable panel; controls meet
  the same touch target baseline.

### DOC-01 — README/PLAN claims are stale and overstate verification

- **Severity / class:** Low / Maintainability risk.
- **Requirement:** Reports must not claim tests passed unless run; documentation
  must match implementation (Stage 1 evidence rules).
- **Actual behaviour:** README and PLAN say 59 tests / 9 files; current suite is
  10 files / 65 tests. README claims touch control groups use the group strip,
  but the strip is hidden at mobile widths. PLAN's GDD matrix marks UI groups
  "Done" without a mobile caveat. Several "Done" labels predate the new
  requirements (separate HUD, hidden grid) and are now inaccurate.
- **Evidence:** `README.md:68,93`; `docs/PLAN.md:109,197,350`; actual test run in
  `VERIFICATION_REPORT.md`.
- **Evidence type:** Confirmed from documentation and test run.
- **Consequence:** Future work and reviewers can trust a false completion claim.
  This is precisely the "do not claim success based on an agent-generated
  report" risk.
- **Correction:** Update counts after every run; separate "implemented" from
  "meets Stage 1 spec"; remove the touch group claim or implement it; link to
  the audit/reconciliation.
- **Dependencies / regression risk:** None functionally; keep docs in the same
  change as behavior.
- **Acceptance:** README/PLAN test counts match a fresh run; no control/UI claim
  contradicts CSS/JS; known limitations include touch group absence until fixed.

### VER-01 — Reference screenshots were unavailable

- **Severity / class:** High / Verification gap.
- **Requirement:** Use the supplied Frontline Zero desktop/mobile screenshots as
  visual/interaction references (Stage 1).
- **Actual behaviour:** No Frontline Zero reference image files were present in
  the repository or exposed to the audit's file/browser tools (no PNG/JPG/WebP
  reference assets other than generated screenshots). The audit could compare
  against the written hierarchy only.
- **Evidence:** `find` for image assets returned none; `MCA.zip` contains source
  and docs, not reference screenshots.
- **Evidence type:** Unverified.
- **Consequence:** Claims about matching the reference's specific sidebar,
  card art, density and mobile overlay are unsupported. The specification uses
  the brief's verbal direction and must be checked against the images when
  available.
- **Correction:** Add the reference screenshots to the repository (or provide a
  path) and run a visual comparison pass; record differences explicitly.
- **Dependencies / regression risk:** HUD design approvals.
- **Acceptance:** The reference images are available and each major HUD region
  has a documented comparison (match/acceptable difference/rejected).

### VER-02 — Touch, gamepad, audio and real-device safe areas are unverified

- **Severity / class:** Medium / Verification gap.
- **Requirement:** Keyboard/mouse, touch and gamepad paths; safe areas for real
  devices (GDD §13.1; Stage 1).
- **Actual behaviour:** Runtime checks used a resized Chromium viewport, not a
  physical touch device. The gamepad path was exercised in Chromium with a
  synthetic standard-mapping pad: menu focus, selection, additive selection,
  group assign/recall and production tabs all passed. It has not been run on a
  physical controller. Audio was not auditioned. Frame rate was sampled in the
  preview browser (60 fps at 844×390), but not on a low-end mobile device.
- **Evidence:** Chromium synthetic-pad run (2026-11-15), `tests/gamepad.test.ts`;
  no hardware/audio logs.
- **Evidence type:** Emulated for gamepad; unverified on hardware.
- **Consequence:** Touch target sizes and overflow were measured, and the
  standard gamepad mapping now works in software, but gesture feel, multi-touch,
  notch clipping and physical-controller mappings remain unproven.
- **Correction:** Add an automated DOM/layout test for target sizes/overflow and
  a manual device matrix; exercise a physical controller and record its mapping.
  Do not claim hardware parity until exercised.
- **Acceptance:** At least one real landscape phone and one gamepad are tested;
  safe-area insets are simulated and real; audio cues have visual equivalents.

---

## 3. Control-ownership audit

This distinguishes intentional contextual shortcuts from accidental duplication.

| Command | Desktop paths | Mobile paths | Verdict |
| --- | --- | --- | --- |
| Select | LMB, double-click select-type | Tap, double-tap (inherited) | Intentional parity; double-tap is undiscoverable but not conflicting. |
| Add to selection | Shift+click / Shift+drag | **None** | **Missing** (HUD-08); box select is not a substitute. |
| Box select | LMB drag | Drag, BOX mode | Intentional parity; BOX mode is a deliberate explicit alternative. |
| Move | RMB ground, MOVE button (no-op), tap empty | Tap ground, MOVE button (no-op) | **Conflict:** MOVE is a help button, not a command. |
| Attack | RMB enemy, ATTACK mode | Tap enemy, ATTACK mode | Intentional contextual + explicit override. |
| Attack-move | A, A-MOVE button | A-MOVE button | Intentional parity. |
| Stop | S, STOP, gamepad Y | STOP | Intentional parity. |
| Hold position | H, HOLD button, gamepad D-pad down | HOLD button | **Ambiguous label** vs hold fire. |
| Hold fire | Stance panel only | Stance panel | Same command concept, no duplicate path; tiny target on mobile. |
| Capture | C, CAPTURE mode, RMB relay with engineer | CAPTURE mode + relay | Touch lacks the contextual relay shortcut; explicit mode is acceptable but requires two steps. |
| Return | R, RETURN | RETURN | Intentional parity. |
| Build | B, BUILD button/tab, engineer + card | BUILD tab + card | Multiple entry points but same mode; acceptable if visual hierarchy is clear. |
| Control groups | Ctrl+digits assign, digits recall, strip | **None** (strip hidden) | **Missing**, not duplicate. |
| Stance | Panel | Panel | Same; needs larger touch controls. |

No evidence was found of two independent gameplay command systems; the
duplication is UI/entry-point duplication. The only command that is actively
misleading is MOVE. The two HOLD labels are a naming conflict, not two systems.

---

## 4. System-by-system audit summary

| System | Meets spec? | Evidence / gap |
| --- | --- | --- |
| Bootstrap/lifecycle | Yes for slice | `src/main.ts` exposes app for diagnostics; menu/battle/editor transitions work; runtime editor deploy produced 31 entities. |
| Desktop HUD | No | HUD-01, HUD-05, HUD-07. |
| Mobile HUD | No | HUD-02–HUD-05. |
| Input/mouse | Mostly | Selection, box, commands tested; ground pick offset CAM-01; MOVE no-op HUD-06. |
| Input/touch | Partial | Tap/drag/pinch code exists; targets, additive selection, group access and safe areas fail. |
| Input/gamepad | Emulated pass | Menu focus, selection/add, groups and production verified with a synthetic standard-mapping pad; no hardware test. |
| Camera | Yes | 2:1 projection tests; focus/pan/clamp tests; pick defect separate. |
| Terrain rendering | Partial | Elevation terraces/cliffs; permanent grid; no slopes. |
| Water/naval rendering | Yes for slice | Water shader/port; corvette mesh; turret offset defect. |
| Unit/building data | Mostly | Individual infantry; harvesting data to remove; "squad" copy. |
| Unit rendering | Partial | Procedural meshes/scales; turret transform/aiming/muzzle defects. |
| Simulation tick | Yes | Fixed 20 Hz; 65 tests; determinism/save tests pass. |
| Pathfinding | Yes | Terrain/elevation costs; naval/land; performance measured. |
| Combat | Yes for slice | Target classes, armour, range/LOS, ammo, suppression; high-ground observation undefined. |
| AI | Partial | Builds/produces/attacks; no naval production; air only after airfield. |
| Economy | Violates spec | ECO-01/02/03. |
| Air | Yes for slice | Tests pass; recovery/rearm; SAM/AA counters. |
| Naval | Partial | Movement/combat/reload tests pass; repair gating; AI no production. |
| Editor | Yes for desktop | Validation/deploy verified; ore tools to remove; mobile cramped. |
| Save/load | Yes for current schema | Versioned, strict; economy schema migration outstanding. |
| Audio | Implemented, unverified | `src/ui/audio.ts` Web Audio engine with volume/mute and event cues; no audition. |
| Alerts | Partial | Toasts/world markers/acks; no event log (accepted). |
| Accessibility | Partial | Colours/labels/toggles; no scaling/remap; touch/safe-area blockers. |
| Tests | Strong but incomplete | 65 pass; no HUD layout/touch/turret/pick tests. |
| Documentation | Stale | 59 vs 65 tests; touch group claim false. |

---

## 5. Positive evidence worth preserving

These should not be rewritten during remediation:

- The fixed-step simulation, seeded RNG, command queue and save/restore
  contracts (`tests/determinism-save.test.ts`, 9 tests).
- The isometric camera contract (`tests/camera.test.ts`, 7 tests).
- Individual infantry production/selection (code + runtime; fix only copy).
- The air recovery loop and SAM/AA counter tests.
- Naval movement, combat and reload tests (extend for repair).
- Editor validation and editor→battle deploy (runtime: 96×72, 13 structures,
  18 units → 31 entities, 0 errors).
- Performance headroom (recorded 2026-10-23): baseline 0.377 ms/tick for 31
  entities, 171-entity stress 5.123 ms/tick, 100-order path batch 95.7 ms, save
  8.0 ms / restore 11.3 ms at 141 entities on this machine.
- No console or shader errors in the preview session.

---

## 6. Recommended fix order (summary)

1. **Specification approval** for the replacement economy and HUD layout
   targets; no source changes yet.
2. **HUD architecture + battlefield presentation milestone** (desktop sidebar,
   mobile overlay/rail, touch/safe areas, objective/group access, grid hidden,
   terrain picking, turret transforms/aiming/muzzle, selection feedback).
3. **Economy removal + replacement**, after approval, with schema migration and
   AI/tests.
4. **Naval/AI polish**: repair independence, AI shipyard/corvette, mobile editor
   and accessibility follow-ups.

The detailed dependency-ordered plan is in `REMEDIATION_PLAN.md`. The current
state and next-phase plan are in §7 below and in `NEXT_PHASE_PLAN.md`.

---

## 7. Current-state re-audit — 2026-10-24 (pre-remediation snapshot)

> **Historical snapshot.** This section records the tree before the remediation
> in §8. Its “current” counts and defect statuses are not claims about the
> present build. Use §8 for current status.

### 7.1 Executive summary

The working tree is materially different from the Stage 1 build. It typechecks,
passes **20 test files / 186 tests**, builds **51 modules**, and meets the
measured simulation/save/pathfinding budgets on this machine. The Stage 1
critical HUD, terrain-picking, construction-grid, turret-transform, aiming and
muzzle-origin defects are fixed. The battle HUD now has separate desktop and
mobile compositions; mobile exposes the objective, control groups, an Add
toggle, 44×44 px targets and safe-area rules.

The build is not yet a reliable complete combined-arms slice. The remaining
mandatory work is concentrated in four places:

1. **Naval is player-only.** A damaged corvette at full missile load never
   repairs (`src/sim/game.ts:1764–1782`), and the AI has no shipyard or corvette
   construction branch (`src/sim/ai.ts:140–290`). The authored scenario no longer
   starts with any naval unit, so the AI currently has **no naval presence at
   all** (`src/data/scenarios.ts:260–286`).
2. **One visible command is still misleading.** The MOVE button only cancels the
   current mode and shows a toast; it issues no move order
   (`src/ui/hud.ts:463–469`). HOLD POS is now correctly named.
3. **Desktop clear-area targets are missed.** At 1280×720 the measured clear
   battlefield is **50.3%** of the viewport (target ≥55%) and persistent chrome
   is **49.7%** (target ≤38%). At 1920×1080 the clear area is 65.1% (target ≥65%)
   but chrome is **34.9%** (target ≤28%).
4. **The economy direction is unresolved.** The specification says harvesting,
   ore and refinery delivery were superseded (`DESIGN_SPEC_RECONCILIATION.md`
   R-01), but later product work deliberately strengthened that loop. The code
   is a working harvester/ore/refinery economy with **no non-harvester
   Materials source** (`src/sim/game.ts:1289–1318, 1997`). No removal has been
   approved. This audit does not silently choose either direction; §7.6 records
   the decision and its dependencies.

Land, production, objectives, victory/defeat, save/load and determinism are
covered by passing tests. Air is tested as a player loop; the AI's air branch is
present but was not observed building an airfield or fighter in this audit. A
full player-driven 10-minute build-and-fight run was **not** executed. The AI
can defeat an idle player in about 6.4 minutes in the logged 420 s
`tests/ai.test.ts` run; that test asserts production, damage and attack waves,
not the victory result itself.

### 7.2 Baseline and method

- The checkout has no usable Git HEAD; `git rev-parse --short HEAD` fails and
  every project file reports as untracked. The audit is against the current
  working tree, not a commit.
- Host: Windows/MINGW64, Node 24.14.0, npm 11.9.0, Vite 8.3.5, Vitest 5.0.5.
- Commands: `npm run typecheck`, `npm test`, `npm run build`, `npm run bench`.
  Exact outputs are in `VERIFICATION_REPORT.md` §28.
- Runtime checks used the existing Vite dev server at `127.0.0.1:5174` and a
  live battle. Viewport sizes below are CSS px; the browser reported DPR 0.9,
  so device-pixel window sizes differ.
- Documentation-only changes were made during this re-audit. No gameplay source,
  tests or configuration were changed.

### 7.3 Historical finding disposition

Statuses use the requested classes: **Fixed**, **Partially fixed**, **Still
reproducible**, **Unable to verify**, plus **Design ambiguity / unresolved** where
the requirement itself is not settled.

| ID | Stage 1 finding | Current status | Current evidence |
| --- | --- | --- | --- |
| HUD-01 | No persistent desktop production sidebar | **Partially fixed** | Desktop now has a 92 px left rail plus a persistent 348 px right sidebar (`hud.ts:328`, `style.css:366`). The composition defect is fixed, but the measured 1280×720 clear-area target is not: see HUD-09. |
| HUD-02 | Mobile was compressed desktop HUD | **Fixed** | Separate `layout-mobile` markup and CSS branch; 60 px category rail; 340 px production sheet; bottom command bar; map overlay (`hud.ts:348`, `style.css:560–680`). At 844×390 clear height is 77.95% (72.41% area) with no selection, 66.15% (61.45% area) with a selection. |
| HUD-03 | Touch targets too small; no safe areas | **Fixed in emulation** | 44×44 command buttons, 59×44 production tabs, 44×44 group slots; `env(safe-area-inset-*)` on top, right, bottom and left (`style.css:564–572, 638–660`). Physical notches and low-end touch hardware remain unverified. |
| HUD-04 | Touch control groups missing | **Fixed** | GROUPS opens a sheet with nine 44×44 slots; runtime assign/recall works (`hud.ts:364, 1029–1058`). |
| HUD-05 | Primary objective hidden on mobile | **Fixed** | Mobile objective chip plus objective sheet; present at 844×390 (488×41 chip) and 667×375 (`hud.ts:255, 356`). |
| HUD-06 | MOVE no-op; HOLD labels conflict | **Partially fixed** | HOLD is now HOLD POS. MOVE still issues no order: runtime left `app.mode === 'none'`, created zero move orders and showed only the help toast. |
| HUD-07 | Production choices not image-led | **Fixed** | At 1280×720 build cards measure 131×127 px with 119×89 px procedural thumbnails; unit cards use the same thumbnail system (`style.css:490–520`, `hud.ts:1116`). |
| HUD-08 | No touch additive selection | **Fixed** | ADD toggle is 44×46 px and sets `additiveSelection`; runtime `aria-pressed` changed to true (`hud.ts:371`, `style.css:651`). Physical touch not exercised. |
| CAM-01 | Ground picking missed elevated terrain | **Fixed** | `App.worldAt` resolves through `pickTerrain` (`app.ts:476`, `terrainSurface.ts:139`); 12 terrain-pick tests pass; live elevated flat-tile pick error measured 0 world units. |
| CAM-02 | Grid permanently visible | **Fixed** | `renderer.settings.grid` was false in ordinary play and true only during placement (`app.ts:276`, `gridVisibility.ts:8`). |
| CAM-03 | No slope transitions | **Fixed** | Terrain uses a continuous corner-averaged slope surface shared by mesh and picking (`terrainMesh.ts:30–95`, `terrainSurface.ts:27–72`); geometry/picking tests pass. |
| CAM-04 | High-ground observation undefined | **Design ambiguity** | High ground affects movement/LOS but grants no vision or range bonus. This remains the documented default (P-08), not a defect. |
| INF-01 | Copy still says squads | **Partially fixed** | Barracks copy now says riflemen, but `src/ui/editor.ts:935` still says “Starter engineer and rifle squads added.” and `tests/sim-core.test.ts:152` still says “deploys an infantry squad.” |
| INF-02 | Group semantics ambiguous / not persisted | **Design ambiguity** | Groups remain an in-memory `Map`, cleared on load; empty-slot click assigns and populated-slot click recalls. The mobile sheet explains the two-step action, but group state is still session-only (`app.ts:58, 209, 785`). |
| WPN-01 | Turret hardpoint rotated opposite hull | **Fixed** | Shared `turretModelMatrix` and heading tests; 24 weapon-transform tests pass (`unitTransform.ts:52`, `tests/weapon-transform.test.ts`). |
| WPN-02 | Turrets did not track | **Fixed** | Continuous `updateTurret` and static-emplacement traverse, bounded by `turretRate`; tests cover ordered and idle behaviour (`game.ts:2319, 2444`). |
| WPN-03 | Projectiles spawned from hull | **Fixed** | `muzzlePoint` uses authored hardpoints and turret bearing; tests cover cardinal bearings and the corvette bow (`game.ts:2424`, `hardpoints.ts:24`). |
| ECO-01 | Harvesting loop is outside intended brief | **Design ambiguity / unresolved** | The loop is still complete: harvester unit, ore tiles, refinery delivery, auto-hauler on refinery completion, AI harvester production, editor ore tools and save fields. Later product requests added hopper animation, auto-gather and a 300-unit load, which conflict with R-01. See §7.6. |
| ECO-02 | No non-harvester Materials income | **Conditional** | `updatePassiveIncome` credits only Requisition; Materials are credited only on harvester unload (`game.ts:1289–1318, 1997`). This is a blocker if harvesting is removed, and intended if it is retained. |
| ECO-03 | No economy migration plan | **Conditional** | No save/scenario migration exists. It is required only if the removal branch in §7.6 is chosen; the dependency list is recorded there. |
| NAV-01 | Repair gated on missing ammunition | **Still reproducible** | Repair remains inside `if (e.ammo < e.maxAmmo)` (`game.ts:1764–1782`). The existing test sets ammo to 0, so it does not cover a full-ammo damaged ship (`tests/air-naval.test.ts:145`). |
| NAV-02 | AI never builds or produces naval | **Still reproducible (worse)** | `ai.ts` has no shipyard-construction or corvette-production branch, and `createIslandAssault` no longer starts with a shipyard or corvette, so the AI has no naval unit to use at all. |
| SIM-01 | Weather/time affect only lighting | **Still incomplete** | Renderer settings only; no gameplay system reads weather/time (`renderer.ts`). Low severity for this slice. |
| SIM-02 | Suppression has no morale/rout consequence | **Still incomplete** | Suppression slows movement/accuracy but has no morale state. Low severity and explicitly not required for the slice. |
| EDT-01 | Editor is desktop-first | **Still partial** | At ≤900 px the inspector becomes an off-screen drawer and the tool column remains 232–288 px. No full touch authoring session was run. |
| DOC-01 | README/PLAN counts and copy stale | **Partially fixed** | README test counts were corrected during this audit; the editor toast and test name still say “squad.” Historical PLAN sections retain old counts as a record. |
| VER-01 | Reference screenshots unavailable | **Unable to verify** | No Frontline Zero reference images are present in the workspace or exposed to the audit. |
| VER-02 | Physical touch/gamepad/audio unverified | **Unable to verify** | Viewport emulation is not a device; no hardware, audio audition or real safe-area test. |

### 7.4 Confirmed current defects and gaps

Ordered by severity, not by fix effort.

1. **NAV-02 / AI-01 — no AI naval programme (High).** The AI builds land
   facilities, defences, air defence and (conditionally) an airfield, but never a
   shipyard or corvette. The current scenario gives neither side a starting
   naval unit. The requirement that the AI meaningfully use naval power is
   therefore unmet, and the sea is a player-only theatre. The map is not the
   blocker: with sufficient resources, a shipyard at tile (84, 22) passes
   `placementStatus` for the AI and has navigable water alongside; the missing
   piece is the AI branch.
2. **NAV-01 — full-ammo ships never repair (Medium).** Repair is nested under the
   reload condition. A corvette at 50% HP and 6/6 missiles remains damaged at a
   friendly shipyard. The fix is small but the existing test misses it.
3. **HUD-06 — MOVE is a no-op (Medium).** Every visible command should issue its
   labelled command. MOVE only shows a toast; the command bar still has a button
   that cannot do what it says.
4. **HUD-09 — desktop clear-area target missed (Medium).** At 1280×720 the
   persistent rail (92), sidebar (348) and bottom console (168) leave 840×552
   px, or 50.31% of the viewport. The reconciled target is ≥55% clear / ≤38%
   chrome; measured chrome is 49.69%. At 1920×1080 the clear area is 65.09% but
   chrome is 34.91% against a ≤28% target. This is a measured layout gap, not a
   functional regression.
5. **INF-01 — “squad” copy remains (Low).** The model and simulation are
   individual-soldier correct; the editor success toast and one test description
   still use squad language.
6. **DOC-01 — documentation drift (Low).** README counts are corrected now, but
   the historical PLAN and reconciliation documents still contain old counts; the
   audit labels them as historical rather than rewriting them.

**Verification gaps, not confirmed defects:** AI airfield/fighter production was
not observed or asserted; the AI branch exists but may not be reached before the
battle ends. The full player-driven build-and-fight loop, physical touch, real
safe areas, gamepad, audio and reference-image comparison remain unverified.

### 7.5 Gameplay-loop assessment

| Step | Status | Evidence / blocker |
| --- | --- | --- |
| 1. Start or create a scenario | **Pass with a gap** | Menu deploy, editor validation and editor→battle handoff exist (`app.ts:176–231`, `editor.ts:884–890`). The live battle was re-entered; a full authoring session was not rerun. |
| 2. Establish an economy | **Conditional** | Harvester/ore/refinery loop works and is tested; refinery completion auto-spawns a hauler; a full load is 300 Materials. There is no non-harvester Materials income, and depletion/inaccessibility can stall the economy. Direction is unresolved (§7.6). |
| 3. Construct production facilities | **Pass** | Engineer auto-dispatch, pause-on-call-away, HQ engineer fallback, power/brownout and per-facility queues are implemented and tested (`tests/construction.test.ts`, `tests/power.test.ts`, `tests/production.test.ts`). |
| 4. Produce and command units | **Pass with one UI defect** | Barracks/factory/airfield/shipyard queues and orders are tested; MOVE is the one misleading command. |
| 5. Expand and contest objectives | **Pass** | Relays are capture-only, show ownership/capture meters, and AI engineers capture them; tests cover attack rejection and capture. |
| 6. Land combat | **Pass** | Movement, LOS, armour, damage, repair, medics and static defences have focused tests. |
| 7. Air combat | **Pass (player), unverified (AI)** | Parked/fuel/rearm/strike/SAM tests pass; AI has an airfield/fighter branch but no test observed it building or using one. |
| 8. Naval combat | **Partial** | Player movement, combat, reload and return are tested; full-ammo repair is broken; AI has no naval production. The sea is not a contested combined-arms domain yet. |
| 9. Victory or defeat | **Pass** | Destroy-HQ and defeat paths are tested and freeze the simulation after the result (`tests/determinism-save.test.ts:126–160`). |
| 10. Restart and save/load | **Pass with a gap** | Save/load round-trip and determinism pass; restart is wired through `App.restart` and the end screen but was not re-exercised in this audit. |

Softlock and stall risks found:

- If all ore is depleted or unreachable, no further Materials can be earned. The
  map has finite deposits and no passive Materials source.
- If the AI loses its harvester/factory, its economy can stall; it does replace
  a lost engineer, but not a lost harvester through a non-harvester source.
- If a corvette is damaged with full missiles, the player must waste a missile or
  live with the damage.
- If the AI has no shipyard, it cannot contest the sea or replace a naval loss;
  currently it starts with no naval unit at all.

### 7.6 Economy decision reconciliation

**The sources conflict.** `DESIGN_SPEC_RECONCILIATION.md` R-01 (2026-10-23)
records a user clarification that the RA2-style harvesting loop was never
intended and is superseded. The current source instead implements a complete
loop, and later product requests explicitly strengthened it: auto-harvester on
refinery completion, a 300-unit hopper, hopper animation and a higher payload.
The current README also presents harvesting as part of the slice. The
reconciliation's map-control replacement (P-01/P-02) was never approved or
implemented.

This audit does not treat ECO-01 as a current “confirmed violation” because that
would silently reverse the later product work. It also does not declare the
economy accepted, because R-01 has not been withdrawn. The decision is a
**product gate**:

- **Option A — retain harvesting for the skirmish slice.** Withdraw R-01,
  retire the P-02 replacement model and the economy-removal milestone, and keep
  the current harvester/ore/refinery loop. The two-resource P-01 already matches
  the current build. Then ECO-01/02/03 close as not-required, and the remaining
  economy work is balance and stall prevention (ore depletion, harvester loss,
  AI recovery). This is the smaller, lower-risk path and matches the most recent
  product requests.
- **Option B — enforce R-01 and replace the economy.** Approve map-control
  Materials (Command Post baseline plus held strategic sites) and Requisition
  from command infrastructure/relays, then remove the loop end-to-end. This is a
  high-risk milestone; the dependency list is below.

Neither option is adopted here. If the project wants the next implementation
milestone to be economy work, the user must select A or B first.

**Dependencies if Option B is approved:**

| Area | Current dependency | Required change |
| --- | --- | --- |
| Unit/building data | `harvester` unit, `refinery` building, `refinery: true`, `reqPerSec` | Remove or redefine; ensure replacement income is visible. |
| Runtime map | `ore`/`maxOre` arrays, harvester state machine | Remove or leave inert for one migration window; no silent reinterpretation. |
| Scenario schema | Ore tiles, ore validation, starting refinery/harvester expectations | Version bump; strip/migrate ore; validate replacement income sites. |
| Editor | ORE brush, ore summary, ore reachability warnings | Remove dead tools; add replacement-income inspection if useful. |
| AI | Refinery/harvester build order, harvester count target, economy checks | Replace with map-control affordability; keep the same command API; no stall. |
| HUD | Harvester states, Materials/min from harvested totals, refinery copy | Show income source breakdown and current rate. |
| Save | `ore`/`maxOre` and harvester state | Bump version; migrate old saves or fail clearly; fixture test. |
| Balance/tests | Ore reachability, harvester delivery, 300-unit load, AI economy | New 10-minute full-loop test; remove/rewrite harvesting fixtures. |

**Tests required before Option B ships:** no-harvester Materials income funds a
facility and a small force for 10 minutes; AI builds/produces/attacks without a
harvester; old save/scenario either migrates deterministically or fails with a
clear version message; editor has no dead ore tool; HUD breakdown matches the
actual credit; performance and determinism unchanged.

### 7.7 Verification gaps

1. No full player-driven 10-minute build-and-fight run; component tests and live
   HUD checks are not a substitute.
2. Physical touch, pinch/drag feel, real safe-area insets and low-end frame rate
   were not exercised on hardware.
3. The standard gamepad mapping was exercised in Chromium with a synthetic pad,
   but not on physical hardware.
4. Audio was not auditioned; no automated audio test.
5. Reference screenshots remain unavailable; visual similarity is unverified.
6. AI airfield/fighter production and air sorties are not asserted by a test.
7. AI naval production is absent by code, so no naval AI runtime check exists.
8. Desktop 1920×1080 was measured, but the 1280×720 chrome target needs a design
   decision: shrink the rail/sidebar/console or revise the reconciled target.
9. Editor mobile authoring was measured previously but not completed on touch.
10. No screenshot or pixel-diff review was performed in this re-audit.

### 7.8 Current priority

The detailed roadmap is in `NEXT_PHASE_PLAN.md`. The short version:

1. **Decide the economy direction** (product gate; no code until chosen).
2. **Complete the naval loop** (repair independent of ammo; AI coastal shipyard
   and one corvette; tests). This is the highest-value unblocked implementation.
3. **Fix the MOVE command and close or revise the desktop chrome target** (small,
   visible acceptance gaps).
4. **Clean up squad copy and docs; validate AI air** (low-risk follow-through).
5. **Only after Option B approval:** the economy replacement/removal milestone.

### 7.9 Bottom line

The current build is a substantial, test-backed vertical slice, not the Stage 1
build described above. Land, production, objectives, saves, determinism and the
player air/naval loops work. The two clear functional gaps are naval repair and
the AI's missing naval programme; the two clear presentation/acceptance gaps are
MOVE and the 1280×720 desktop chrome measurement. The economy is a product
decision, not a defect to fix by assumption. The next implementation should not
touch harvesting until that decision is recorded.

---

## 8. Post-audit remediation — 2026-10-24

### 8.1 Scope and product decision

The findings above were remediated without changing the economy. The product
decision is: **retain the current harvester/ore/refinery loop for this slice.**
The economy will be extended later, after the current work is complete; no
replacement, map-control income or ore removal is approved here. ECO-01/02/03
close as not-required for this slice. The future-extension dependencies remain
recorded in §7.6 and `DESIGN_SPEC_RECONCILIATION.md` §9.

### 8.2 Fixed findings

| ID | Previous finding | Current state | Evidence |
| --- | --- | --- | --- |
| NAV-01 | Repair gated on missing ammunition | **Fixed.** A docked friendly corvette repairs at 1.2% max HP/s regardless of missile count; reload remains a separate 2.5 s timer and requires a live, completed shipyard. | `src/sim/game.ts` `updateNaval`; `tests/air-naval.test.ts` full-rack repair and destroyed-yard cases. |
| NAV-02 | AI never built or produced naval units | **Fixed.** The AI searches for a legal coastal site, builds a shipyard, produces exactly one corvette, replaces a loss, and keeps its existing engagement/return behaviour. It falls through to land/air priorities when no coast exists. | `src/sim/ai.ts`; `tests/ai.test.ts` shipyard/corvette/rebuild and landlocked-map cases. |
| AI-01 | AI air production unverified | **Fixed as a verification gap.** The AI now has a test that builds an airfield, fields a fighter and sorties it against a ground target. | `tests/ai.test.ts`. |
| HUD-06 | MOVE was a help-only no-op | **Fixed.** MOVE enters a real move mode; the next ground click issues a move or rally order and exits the mode. The stale active-card highlight after the order was also fixed. | `src/ui/hud.ts` `updateMode`; `src/app.ts` `setMode`; `src/ui/input.ts` move-mode click; live Chromium check. |
| HUD-09 | Desktop clear-area targets missed | **Fixed at the reference sizes.** 1280×720: clear 62.10%, chrome 37.90% (targets ≥55% / ≤38%). 1920×1080: clear 72.11%, chrome 27.89% (targets ≥65% / ≤28%). | CSS rail/sidebar/console variables; Chromium DOM measurements in `VERIFICATION_REPORT.md` §29. |
| INF-01 | "Squad" copy remained | **Fixed.** The editor adds riflemen and its success toast says "riflemen"; the test name says individual rifleman. | `src/ui/editor.ts`; `tests/sim-core.test.ts`. |
| DOC-01 | README/docs stale | **Fixed for current-state documents.** README counts, limitations, economy decision and AI capabilities are updated; §7 remains labelled as a historical snapshot. | `README.md`; this section; `VERIFICATION_REPORT.md` §29. |
| ECO-01/02/03 | Economy conflict and missing migration | **Closed as not-required for this slice** by the retained-economy decision. Reopen only when the extension is designed. | §7.6; `DESIGN_SPEC_RECONCILIATION.md` §9.5. |

### 8.3 Current verification

- `npm run typecheck` — clean.
- `npm test` — 20 files, 191 tests passed.
- `npm run build` — 51 modules, production bundle succeeds.
- `npm run bench` — 160 entities at 3.311 ms/tick, 100 path orders in 86.8 ms,
  130-entity save 7.2 ms / restore 10.0 ms; all within the 50 ms fixed-step
  budget.
- Desktop HUD at 1280×720: rail 82 px, sidebar 218 px, console 136 px, clear
  980×584 CSS px (62.10%); no document or rail overflow. At 1920×1080: rail
  82 px, sidebar 254 px, console 136 px, clear 1584×944 CSS px (72.11%).
- Live Chromium check: selecting eight units and clicking MOVE showed the move
  banner and active button; clicking a destination issued the order, hid the
  banner and cleared the active state.

### 8.4 Remaining verification gaps

These are evidence gaps, not confirmed defects: a full player-driven 10-minute
build-and-fight run, physical touch/safe-area/notch behaviour, gamepad hardware,
audio audition, reference-image comparison, mobile editor authoring and a
screenshot/pixel-diff review. The AI tests are deterministic simulation checks,
not a human-played match.

---

## 9. Current-state re-audit — 2026-10-24 (second pass)

> **Current snapshot.** This section supersedes §7 and §8 for the present
> working tree. Sections 7 and 8 are retained as the pre-remediation and
> post-remediation records. This pass changed documentation only: no gameplay
> source, tests, scenario data or configuration were modified.
>
> **Post-audit update:** §10 records the AI commander revision that closed
> AI-01, AI-03 and NAV-02 after this snapshot. The AI findings in §9.4 and the
> AI rows in the §9.3 table are retained as the historical reproduction; the
> HUD findings in §9.4–§9.5 remain current.

### 9.1 Executive summary

The tree still passes its mechanical baseline: TypeScript, **20 test files /
191 tests**, the production build and the controlled benchmark. The previously
reported HUD, terrain-picking, construction-grid, turret, muzzle-origin, naval
repair, MOVE, copy and desktop-chrome findings remain fixed in source, focused
tests or runtime checks.

Two new blockers were confirmed at runtime, and they change the next priority:

> **2026-11-15 update:** HUD-10, HUD-11 and HUD-12 are fixed. The result card
> fits both phone viewports, and a layout rebuild now restores both the verdict
> and the pause overlay. The original reproductions below are retained as
> history.

1. **The AI construction programme deadlocks after its first expansion.** On a
   normal-resource Island Assault run, the AI places a second anti-tank turret
   at world `(312, 92)` around 120–180 s, then its only engineer never reaches
   the site. The site remains at 0 progress and `construction = true`; the AI's
   `underConstruction` guard then stops every later building. At 390 s the
   normal run ends with **nine completed structures, one stalled turret site,
   19 ground units and no SAM battery, shipyard or airfield**. Extending the
   match to 900 s with a diagnostic invulnerable player HQ did not change the
   site progress or produce air/naval infrastructure.
2. **The battle-result presentation failed on mobile and across layout
   changes.** At audit time the 844×390 result card measured **467.5 px** in a
   390 px viewport and the 667×374 card measured **499 px** in a 374 px
   viewport. HUD-11 fixed the fit, and HUD-10/HUD-12 fixed the lifecycle: the
   rebuilt HUD now restores the verdict and the pause overlay from app state.
   The historical failure and current evidence are recorded below.

The desktop result screen itself works: at 1280×720 it fits, and **RESTART
SCENARIO** returned to a fresh battle at tick 14. Save/load determinism, turret
transforms, terrain picking, construction-grid visibility, naval repair and the
player air/naval loops remain covered and passing. A full player-driven match
and physical-device verification were still not performed.

**Highest-priority next task: repair AI construction progression.** It has the
largest gameplay impact because it currently prevents the AI from reaching SAM,
naval or air infrastructure in a normal match. The remaining layout-transition
defects (HUD-10/HUD-12) affect the end of the loop but do not alter the
simulation; the mobile fit defect (HUD-11) is closed.

### 9.2 Baseline and method

Environment:

| Item | Value |
| --- | --- |
| Host | Windows/MINGW64, Git Bash |
| Node / npm | v24.14.0 / 11.9.0 |
| Vite / Vitest | 8.3.5 / 5.0.5 |
| Browser | Freebuff Chromium preview, DPR 0.9; Vite dev server at `127.0.0.1:5173` |
| Repository state | No usable Git HEAD; audit is against the current working tree |

Commands were run as plain commands from the project root. Exact outputs are in
`VERIFICATION_REPORT.md` §30. The controlled benchmark is reported separately
from the full-suite perf file because the full suite runs it concurrently with
other tests and inflates its timings.

Viewport values below are CSS pixels. The Chromium preview reports a device
pixel ratio of 0.9, so a requested 1152×648 window reports a 1280×720 CSS
viewport; the CSS sizes are the layout sizes.

Browser checks used a live battle, the existing HUD and a real WebGL2 canvas.
For part of the pass the shared preview tab was hidden and its
`requestAnimationFrame` loop was suspended. The MOVE check therefore injected
pointer events through the real canvas handlers and advanced one simulation
tick manually; no claim is made about continuous frame pacing in that state.
All other reported runtime checks were performed while the page was rendering
normally, unless noted.

### 9.3 Finding disposition

Statuses use the requested classes: **Fixed**, **Still reproducible**,
**Partially fixed** and **Unable to verify**. Items that are settled product or
scope decisions are marked separately rather than called defects.

| ID | Finding | Current status | Evidence |
| --- | --- | --- | --- |
| HUD-01 | Desktop production was a bottom deck | **Fixed** | Persistent right sidebar; 82 px rail, 218–254 px sidebar, 136 px console. |
| HUD-02 | Mobile was a compressed desktop HUD | **Fixed for battle composition** | Separate mobile markup/CSS, category rail and production sheet; 844×390 and 667×374 measured. Result presentation is HUD-11. |
| HUD-03 | Touch targets and safe areas | **Fixed** | All 13 mobile command buttons measured 44×44; tabs 58.9×44.5; safe-area CSS present. Result actions are 44 px and outside the scrolling report. |
| HUD-04 | Touch control groups | **Fixed (emulation)** | Nine-slot groups sheet; 44×44 slots in source/tests. No physical tap. |
| HUD-05 | Primary objective hidden on mobile | **Fixed** | Objective chip 481×41 at 844×390; objective sheet present. |
| HUD-06 | MOVE was a no-op | **Fixed** | Mode enters MOVE; injected pointer events through the canvas path issued two move orders and cleared the mode. |
| HUD-07 | Production choices not image-led | **Fixed** | Procedural thumbnail system and cache; thumbnail/framing tests pass. No new pixel review. |
| HUD-08 | No touch additive selection | **Fixed (source/emulation)** | Sticky ADD toggle and additive selection path; physical tap not injected. |
| HUD-09 | Desktop clear-area target missed | **Fixed at reference sizes** | 62.10% clear at 1280×720; 72.11% at 1920×1080; no document or rail/console scroll. |
| HUD-10 | **New:** result overlay destroyed by HUD layout rebuild | **Fixed 2026-11-15** | `renderShell()` restores the remembered `endResult`; victory card survived mobile→desktop→mobile with all four actions and mobile RESTART returned to tick 0. See §9.4. |
| HUD-11 | **New:** mobile result card overflows; actions unreachable | **Fixed 2026-11-15** | 844×390: card bottom ≤376.6 px, actions 44 px; 667×374: card bottom ≤361.5 px, report scrolls, actions 44 px; no document scroll. See §9.4. |
| HUD-12 | **New:** pause overlay hidden after HUD layout rebuild | **Fixed 2026-11-15** | Paused at 667×374, rebuilt desktop: overlay `display: grid`, `paused=true`, top control reads “Resume battle”. See §9.4. |
| CAM-01 | Ground picking missed elevated terrain | **Fixed** | `App.worldAt`/`pickTerrain`; 12 tests; live elevated flat tile at elevation 2 returned 0.000 world-unit error. |
| CAM-02 | Construction grid permanently visible | **Fixed** | Live: `grid=false` in play, `true` during placement, `false` after cancel. |
| CAM-03 | No slope transitions | **Fixed** | Continuous surface shared by mesh/picking; terrain tests pass. |
| CAM-04 | High-ground observation undefined | **Documented default, not a defect** | No vision/range bonus; movement/LOS remain real. P-08. |
| INF-01 | Squad copy remained | **Fixed** | Editor copy says riflemen; individual-soldier rules/tests retained. |
| INF-02 | Control groups session-only | **Documented default, not a defect** | Groups still clear on load. P-09. |
| WPN-01 | Turret hardpoint rotated opposite hull | **Fixed** | Shared `turretModelMatrix`; 24 weapon-transform tests pass. |
| WPN-02 | Turrets did not track | **Fixed** | Continuous traverse for units and static defences; source and tests. |
| WPN-03 | Projectiles spawned from hull | **Fixed** | Authored hardpoint/muzzle transforms; cardinal headings and corvette bow tests. |
| ECO-01 | Harvesting outside intended brief | **Product decision: retained for this slice** | User decision recorded; no removal/replacement. Future extension deferred. |
| ECO-02 | No non-harvester Materials income | **Consequence of the retained loop, not a defect** | Materials only from harvester unload; extension is a separate design. |
| ECO-03 | No economy migration plan | **Not required unless the extension is approved** | Dependencies/tests recorded in §7.6 and §9.6. |
| NAV-01 | Repair gated on missing ammunition | **Fixed** | Full-rack 50%-HP corvette repairs; destroyed-yard rejection; tests pass. |
| NAV-02 | AI never built or produced naval | **Fixed in §10** | Normal-resource Island Assault builds a shipyard and replaces a corvette; regression test added. |
| AI-01 | AI air production unverified | **Fixed in §10** | Normal-resource Island Assault builds an airfield, fields a fighter and sorties it; regression test added. |
| AI-03 | AI construction deadlock | **Fixed in §10** | The utility planner abandons a site after 45 s without measurable progress; a normal 300 s run reaches air/naval and launches a wave. |
| SIM-01 | Weather/time are lighting only | **Still reproducible; low severity** | No tactical rule reads weather/time. Documented. |
| SIM-02 | Suppression has no morale consequence | **Still reproducible; not required** | Suppression affects accuracy/speed; no morale/rout in the slice. |
| EDT-01 | Editor is desktop-first | **Partially fixed / unverified** | Mobile drawer CSS exists; no touch authoring session was run in this pass. |
| DOC-01 | README/docs stale or overclaimed | **Fixed in this update** | AI limitations, result-screen defects and current evidence are now stated; §7/§8 remain labelled historical. |
| VER-01 | Reference screenshots unavailable | **Unable to verify** | No Frontline Zero reference images in the workspace. |
| VER-02 | Physical touch/gamepad/audio/safe areas | **Unable to verify** | Viewport emulation only; no hardware, audio audition or notch test. |

### 9.4 Confirmed current defects

#### AI-03 — AI construction deadlocks on an unreachable site (High) — fixed in §10

> Retained as the historical reproduction. The current planner is recorded in
> §10; this behaviour is no longer reproducible.

Reproduction on the authored scenario with the normal starting resources (no
boosted AI bank and no prebuilt facilities):

- At 180 s the AI has nine completed structures and one unfinished
  `atTurret` at world `(312, 92)` with `buildProgress = 0`.
- Its only engineer has `buildTargetId = 34`, is 30.52 world units from the site
  centre, and is in `moving` state at `(287.1, 109.64)`. It never reaches work
  range.
- At 390 s the match ends in AI victory over the idle player with 19 ground
  units and the same stalled site. No SAM battery, shipyard or airfield exists.
- A diagnostic run that raised only the player HQ hit points to keep the match
alive for 900 s left the site at progress 0. The engineer sat at
  `(287.99, 102.40)` with a repeating two-waypoint path `(290, 86) → (306, 86)`;
  its blocked counter reset on each re-path without regaining movement. The AI
  reached 27 units, still had nine completed structures, and still had no SAM,
  shipyard or airfield.

The relevant flow is source-confirmed:

- `AIController.update` treats any `construction` entity as `underConstruction`
  and suppresses every later construction decision while it exists.
- `AIController.findBuildSite` validates footprint, slope, build radius, water
  and cost, but not whether the selected engineer can actually reach the site
  or a working position beside it.
- `Game.walkEngineerToSite` chooses a radial approach point and asks the path
  solver for a route. `Game.updateEngineerAssignments` only re-walks a builder
  whose state is already `building`; a builder stuck in `moving` is never
  reconsidered.
- `Game.moveAlongPath` repeatedly re-paths when the next position is blocked,
  resets `blockedTicks`, and can cycle forever on the same unreachable segment
  instead of declaring failure or requesting a new site.

The consequence is not just a visual stall. The AI never fields a SAM battery,
shipyard, corvette, airfield or fighter in a normal match, despite the branches
existing and the synthetic tests passing. It can still win with its initial
ground army, which is why the defect was not caught by the current AI test
suite. This also means the prior “AI uses air and naval infrastructure” claim is
only a developed-fixture result, not normal-play evidence.

#### HUD-10 — Result screen disappears when the HUD layout changes (Medium-high) — fixed 2026-11-15

**Current state:** `HUD` remembers the verdict in `endResult`; `renderShell()`
re-renders it after replacing `#end-root`, without replaying the sting. A live
Chromium check kept the victory card, heading and four actions through
mobile→desktop→mobile rebuilds; mobile **RESTART SCENARIO** returned to a fresh
battle at tick 0.

Historical reproduction at the desktop reference size:

1. Start a battle, destroy the player Command Post, wait for the defeat screen.
2. Confirm `#end-root` contains the result card (1203 characters at the time of
   the check) and `endShown = true`.
3. Change the viewport across the mobile threshold (for example to 844×390).
4. The HUD now reports `layout = mobile`, `endShown = true`,
   `victoryShown = 'defeat'`, but `#end-root.innerHTML.length = 0`; no result is
   rendered.

The old `HUD.refreshLayout()` called `renderShell()`, which replaced the DOM
including `#end-root`, but did not retain the known result or re-render it.
`App.checkVictory()` then saw `victoryShown === result` and returned without
calling `showEnd()` again. The battle remained over, but the restart/save/editor/
menu actions were gone. The desktop equivalent worked; this was a lifecycle bug,
not a simulation bug.

#### HUD-11 — Mobile result screen is taller than the viewport (High on mobile) — fixed 2026-11-15

**Current state:** `.end-screen` respects safe-area insets, `.end-card` is
bounded by `min(88dvh, 100%)`, only `.end-body` scrolls, phone/mobile actions
are at least 44×44, and the entrance animation no longer pushes the card below
the viewport or scales its buttons down. A live Chromium sweep measured:

| CSS viewport | Card top–bottom | Actions | Button height | Document scroll |
| --- | --- | --- | --- | --- |
| 844×390 | 33.4–376.6 px entrance; 23.4–366.6 settled | 238.6–351.6 entrance; 228.6–341.6 settled | 44 px | none |
| 667×374 | 32.4–361.5 px entrance; settles inside | 223.5–336.5 px | 44 px | none |
| 1280×720 | 148.8–623.2 px | 493.2–588.7 px | 35.5 px (desktop) | none |
| 1920×1080 | 328.8–803.2 px | 673.2–768.7 px | 35.5 px (desktop) | none |

**Historical reproduction (before the fix):** the result card was not
height-constrained and the overlay was not scrollable:

| CSS viewport | Card height | Action buttons | Viewport | Result |
| --- | --- | --- | --- | --- |
| 844×390 | 467.5 px | top 405.5, bottom 442.4 | 390 px | below the viewport |
| 667×374 | 499 px | top 392.2, bottom 473.9 | 374 px | below the viewport |

The `.end-screen` had `overflow: visible`, the document/body were `overflow:
hidden`, and there was no scroll container. The action buttons also measured
36.9 px high, below the 44×44 touch target. A player who lost on a phone could
not reach **RESTART SCENARIO**, **SAVE BATTLE**, **SCENARIO EDITOR** or **RETURN
TO MENU** without reloading the page. This was a hard end-of-loop failure on the
mobile target, even though the underlying defeat state and desktop result card
were correct.

#### HUD-12 — Pause overlay is hidden after a HUD layout change (Medium) — fixed 2026-11-15

**Current state:** `renderShell()` calls `syncPauseState(true)` so the rebuilt
shell immediately mirrors `app.paused`. Paused at 667×374 and rebuilt to
1280×720, Chromium showed `#pause-overlay` with `display: grid`, `paused=true`
and the top control labelled “Resume battle”.

Historical reproduction: with a battle paused at 667×374, resizing to 1280×720
rebuilt the desktop HUD. `app.paused` remained `true`, but `#pause-overlay` was
left with the `hidden` class and `display: none`, and the top pause button still
showed the pause icon. The HUD's `pausedCache` was not reset by `renderShell()`,
so its update loop saw no change to apply. The simulation was paused with no
visible indication or resume prompt in the newly built layout.

### 9.5 Complete gameplay-loop assessment

| Step | Status | Evidence / blocker |
| --- | --- | --- |
| 1. Start or create a scenario | **Pass** | Menu deploy and editor path work; editor opened and `launchEditorScenario` produced a fresh battle with two players. |
| 2. Establish an economy | **Pass, with a stall risk** | Harvester/ore/refinery loop works and is retained. Refinery completion auto-spawns a hauler; a load is 300 Materials. No passive Materials source; losing all harvesting capacity with too little bank can still stall. |
| 3. Construct production facilities | **Player pass / AI fail** | Player construction, power and engineer fallback tests pass. AI construction stalls at AI-03. |
| 4. Produce and command units | **Pass** | Production, queue and combat tests pass. MOVE mode and the canvas pointer-to-order path issued real move orders. |
| 5. Expand and contest objectives | **Pass** | Relay capture, AI engineer capture and territory/requisition rules are tested. |
| 6. Land combat | **Pass** | Combat, armour multipliers, static defences, repair/medic and balance tests pass; tank duels and AT-gun TTK are within the tuned windows. |
| 7. Air combat | **Player pass / AI fail in normal play** | Player parked/fuel/strike/return/rearm/SAM tests pass. AI airfield/fighter test is a developed-fixture test; normal AI never builds an airfield. |
| 8. Naval combat | **Player pass / AI fail in normal play** | Player movement, combat, reload and full-ammo repair pass. AI shipyard/corvette test is a developed-fixture test; normal AI never builds a shipyard. |
| 9. Victory or defeat | **Pass** | Destroy-HQ and HQ-loss freeze tests pass. The result card fits desktop and phone landscape and survives layout rebuilds (HUD-10/HUD-11 fixed). |
| 10. Restart and play again | **Pass** | Desktop result RESTART returned to a fresh battle at tick 14; mobile RESTART returned to a fresh battle at tick 0 after a rebuild. Save/load determinism tests pass. |

Softlocks, stalls and failure modes found:

- **AI-03** freezes AI expansion after roughly 2–3 minutes and prevents SAM,
  naval and air infrastructure. This is the dominant failure mode.
- **HUD-10/HUD-12** lost transient overlays when the responsive composition was
  rebuilt; both were fixed on 2026-11-15 and are no longer failure modes.
- The economy has no non-harvester Materials income. If all harvesters and the
  refinery/factory are lost with insufficient funds, recovery can require a
  pre-existing engineer and careful rebuilding. This is retained by product
  decision, not a new defect.
- AI air/naval cannot be counted as working in a normal match until AI-03 is
  fixed and a normal-resource regression run exists.

### 9.6 Economy decision and extension dependencies

**Decision (unchanged): retain the current harvester/ore/refinery loop for this
slice.** This audit changed no economy code, data, ore tools or save schema. The
map-control replacement remains deferred; it is not approved by this audit.

For the future extension, the proposed model is: baseline Materials from the
Command Post, additional Materials from strategic sites/relays, and Requisition
from command infrastructure and captured relays. It is a coupled change, not a
HUD-only credit:

| Area | Current dependency | Required work if the extension is approved |
| --- | --- | --- |
| Unit/building data | `harvester`, `refinery`, `refinery: true`, harvest costs and income | Define/remove the hauler and refinery roles; keep a clear income source and feedback. |
| Runtime map | `ore`/`maxOre` arrays, harvester state machine, ore reachability | Add map-control income sites; remove or leave ore inert for one migration window. |
| Scenario format | Scenario `o` per tile, ore validation, authored refinery/harvester expectations | Bump scenario version; migrate or reject old maps explicitly; validate income sources. |
| Editor | ORE brush, ore summary, ore reachability warnings | Remove dead tools or replace with income-site inspection; keep validation truthful. |
| AI | Refinery/harvester build order, harvester target, `needsHarvester` gate | Replace with map-control affordability and construction priorities; no economic stall. |
| HUD | Harvester states, Materials/min, refinery copy | Show an income-source breakdown that reconciles with actual credits. |
| Save | `SAVE_FORMAT_VERSION = 1`, embedded scenario, ore/harvester state | Bump save version; provide deterministic migration or a clear incompatibility error; fixture old saves. |
| Balance/tests | 300-Material loads, ore depletion, AI economy and the 10-minute loop | New no-harvester income test, AI-without-harvester test, migration test, full-loop test and performance/determinism checks. |

Decision gate: implement the extension only after the AI-03 and result-screen
corrections are closed and the user approves the map-control rules. Do not
reinterpret existing ore saves silently.

### 9.7 Verification gaps

1. No full player-driven 10-minute build-and-fight match. The AI simulations and
   component tests are not a substitute.
2. No physical touch device, real safe-area/notch test, gamepad hardware or
   audio audition.
3. No reference-image or pixel-diff comparison.
4. Mobile editor authoring was not run.
5. AI air/naval have not been observed in a normal-resource match; the current
   tests use a developed fixture and boosted bank.
6. The browser tab was hidden for part of the pass, suspending animation frames;
   one MOVE command was exercised through the real handlers with a manual tick.
   No continuous-frame-performance claim is made from that state.
7. Save/load was verified by the 9 determinism/save tests, not re-run through the
   save-slot UI in this pass.
8. The desktop result card and RESTART were clicked and verified; the mobile
   result card was measured but could not be clicked because its actions are
   off-screen.
9. The AI-03 diagnostic used a temporarily invulnerable player HQ to extend the
   match. It did not change source or save data, and the normal 390 s run shows
   the same stall without that diagnostic.

### 9.8 Priority and next task

Ranked in `NEXT_PHASE_PLAN.md` §5. The short version:

1. **AI-03 (P0):** repair AI construction progression; add a normal-resource
   regression proving no site stalls and later construction continues.
2. **AI air/naval normal-play verification:** after AI-03, prove the AI actually
   reaches and uses its air/naval branches rather than only the synthetic
   fixture.
3. **Full player-driven match and physical evidence:** run and record the loop,
   then close the remaining hardware/reference gaps.

HUD-10, HUD-11 and HUD-12 are closed (2026-11-15). The historical copyable brief
is in [NEXT_TASK_PROMPT.md](NEXT_TASK_PROMPT.md).

### 9.9 Bottom line

The mechanical baseline is healthy and the previously fixed defects remain
fixed. The build is not yet a reliable complete loop because the AI's
construction programme deadlocks in normal play. The mobile result fit and the
layout-rebuild overlay lifecycle are now fixed. Fix the AI construction
deadlock first, then verify AI air/naval use in normal play. The economy remains
retained as decided and was not touched.

## 10. Post-audit AI revision — 2026-10-24

> **Current for AI findings.** This section supersedes the AI defects and the
> AI portions of §9.1, §9.4, §9.5, §9.7 and §9.8. HUD-10, HUD-11 and HUD-12 are
> fixed (2026-11-15). The economy remains retained by product decision.

### 10.1 What was wrong

The prior AI had no literal build-order array, but its planner assigned
absolute scores (`factory` 200 → `refinery` 190 → `powerPlant` 185 →
`barracks` 124 → defence → air/naval), and its personality was derived from
`scenario.settings.seed`, which is constant for an authored scenario. Every
match therefore opened the same way and fielded the same commander. The AI was
never given the player's starting position (`targetKnown` starts false), but a
lost contact never expired, so stale coordinates could keep a wave pointed at
an empty position.

### 10.2 Current decision model

- `GameOptions.aiSeed` selects a commander per battle; the shell draws a fresh
  seed for each new game. `AIControlState` stores the seed, strategy, random
  stream and contact/scout timestamps, and saves restore them.
- `aiProfile` chooses `armour`, `infantry`, `air`, `economy` or `pressure` and
  weights aggression, economy, tech and defence. A menu-selected Recruit,
  Veteran or Elite level biases those weights and also sets how often the
  commander thinks, how far its composition follows the scouted force, how much
  of its army it insists on before attacking, whether it keeps a home guard and
  how many harvesters it crews. It never changes resources, vision or combat
  rules.
- Construction, production, defence, scouting and attacks are utility-scored
  each second from the AI's bank, power gap, harvester saturation, damaged
  structures, scouted force mix, known air/naval contact and terrain.
- Enemy coordinates come only from `visibleEnemies` or `contactsFor`; a trail
  older than 40 s is dropped and reconnaissance resumes.
- The engineer repairs a structure below 60% before new construction, uses the
  repair order when nothing is affordable, and abandons a stalled site after
  45 s without progress.

### 10.3 Verification

`npm run typecheck` clean; `npm test` **24 files / 234 tests passed** (suite-wide;
the cases below are the AI slice, including the retuned difficulty ladder);
build passes; bench 0.241 ms/tick baseline, 3.007 ms/tick at 163 entities, 85.1 ms
for 100 path orders. Relevant cases:

| Case | Current result |
| --- | --- |
| Seeded commander replay and strategy spread | Pass — six seeds yield at least three strategies |
| Different openings on the same map | Pass — seeds 1/3/6 produce more than one first structure |
| No opposing start position at tick zero | Pass — `targetKnown=false`, target `(0,0)`, wave 0 after 30 s |
| Emergency repair with a zero bank | Pass — 40% barracks recovers |
| Save/load commander continuity | Pass — seed, strategy, RNG and 40 s state hash match |
| Normal-resource air and naval | Pass — airfield and shipyard built, at least one wave inside 300 s |
| Air sortie, naval replacement, defence mix | Pass — existing cases unchanged |
| Difficulty profile and no-cheat invariants | Pass — Recruit commits earlier, decides slower, plans a smaller army and crews fewer haulers than Veteran, which sits below Elite on the same axes; equal starting bank and roster |
| Difficulty economy and save persistence | Pass — Elite crews more harvesters than Recruit; Elite save reloads as Elite |
| Difficulty ladder | Pass — mirrored AI-vs-AI matchups over eight seeds: Recruit −56,746 against Veteran (5–11), Elite +65,583 against Recruit (13–3) and +29,490 against Veteran (10–6) (VERIFICATION §35) |

Full commands and limitations are in `docs/VERIFICATION_REPORT.md` §31 and
`docs/PLAN.md` §35.

### 10.4 Remaining current work

AI-01, AI-03 and NAV-02 close. HUD-11 (mobile result card height/actions) and
HUD-10/HUD-12 (result and pause overlays after a layout rebuild) also close. A
human-played match, physical-device touch and a physical safe-area test remain
verification gaps; difficulty has been tuned in AI-vs-AI matchups but not
against human players.
