# Design Specification Reconciliation — MCA: Modern Combined Arms

Status: **Stage 1 specification plus the 2026-10-24 economy supersession**. This
document does not replace `Modern_Combined_Arms_RTS_GDD_v0.1.md`; it records where
the GDD, the explicit product corrections and the current implementation
disagree, and which reading is authoritative.

Date: 2026-10-23; economy revision: 2026-10-24  
Repository: MCA: Modern Combined Arms vertical slice  
Scope: specification and audit only. No application source was changed in this
stage.

---

## 1. Purpose and precedence

This is the authoritative requirement baseline for the remediation work that
follows. When a requirement here conflicts with the GDD, the implementation,
`README.md`, `docs/PLAN.md` or an agent-written report, this document wins.

Precedence applied:

1. Explicit decisions made during the original design interview and later
   clarified by the user.
2. Explicit user clarifications in the Stage 1 brief.
3. Other explicit requirements in the GDD.
4. Clearly labelled provisional recommendations in the GDD.
5. Existing implementation choices and agent assumptions.

A requirement is only marked **Confirmed** when it can be traced to source 1 or
2, or to an explicit non-provisional statement in the GDD. Recommendations that
were adopted merely to avoid another interview loop remain **Provisional**.

### 1.1 Source inventory and confidence

| Source | What it is | Authority | Notes |
| --- | --- | --- | --- |
| `Modern_Combined_Arms_RTS_GDD_v0.1.md` | 1,034-line design document | Mixed: confirmed direction plus labelled recommendations | §19.1 claims to record interview decisions; §10.1 and §19.2 explicitly call economy details recommendations. |
| Stage 1 user brief | Explicit corrections and audit scope | Authoritative | Supersedes the GDD where stated, especially the separate desktop/mobile HUD. Its harvester-removal reading was itself superseded on 2026-10-24 (§9.5). |
| `docs/PLAN.md` | Agent implementation and verification record | Non-authoritative evidence | Useful as a claim list; stale in places (historical sections report 9 files / 59 tests). The current suite is 20 files / 191 tests; see `AUDIT_FINDINGS.md` §9. |
| `README.md` | Product-facing implementation summary | Non-authoritative evidence | Updated 2026-10-24: 20 files / 191 tests, current touch control groups and the known AI/result limitations. Non-authoritative for requirements; its claims are checked in `AUDIT_FINDINGS.md` §9. |
| Frontline Zero reference screenshots | Intended visual/interaction reference | Reference only | **Not available to this audit in the repository or tool context.** Their detailed visual comparison is therefore unverified; see VER-01. |
| Original interview transcript or notes | Intended source of confirmed decisions | Not found | **Unverified.** No separate transcript, minutes or notes file exists in the checkout. This document relies on the GDD §19.1 self-report and does not invent missing decisions. |

Where the brief says "the original interview decisions", the only available
record is GDD §19.1. That record is treated as a reasonable secondary source,
not as independently proven history. It must not be quoted as proof of a
decision that the GDD itself labels provisional.

### 1.2 The central rule

The project must not keep adding systems on top of an incorrect assumption. In
particular:

- Harvester/ore/refinery automation is **retained for the current slice** by the
  2026-10-24 product decision. Removing it is deferred; a future extension will
  build on the loop rather than silently replacing it.
- Desktop and mobile are **two distinct HUD designs** over one simulation, not
  one responsive HUD squeezed into two sizes.
- The construction grid is **not** permanently visible during ordinary play.
- Infantry are **individual soldiers**, not squads.
- Elevation is not satisfied by a stored integer; it must be legible and must
  affect the rules that claim to use it.
- A unit name or a code comment is not evidence that a requirement is met.

---

## 2. Reconciliation decisions

This section resolves every known contradiction. The "Decision" column is the
requirement; the "Reason" column records why the lower-priority source loses.

| ID | Conflict | Decision | Reason |
| --- | --- | --- | --- |
| R-01 | GDD §10.1 and §16.3 recommend two resources with harvesting/controllable income; implementation has harvester, ore fields and refineries; an earlier clarification said the RA2-style harvesting loop was never intended. | **Harvesting, ore fields, harvester units and refinery delivery are retained for the current slice.** The 2026-10-24 product decision keeps the loop as-is and plans an extension later; the removal model is deferred. | The later explicit product decision supersedes the earlier clarification for this slice. It does not approve a new economy or remove the future extension. |
| R-02 | GDD §13.6 requires a searchable/reviewable event log; an earlier product direction removed the field log. | **The old persistent sidebar is not required, but the GDD requirement is now met by a non-modal field-report overlay** opened with `L` / **LOG** (roadmap P1-1). It has text search, severity filters and click-to-jump, and does not reintroduce a permanent side panel. | The 2026-11 roadmap and implementation supersede the earlier removal decision; the overlay preserves the clean battlefield. |
| R-03 | GDD §13 describes one interface with a persistent bottom panel; implementation has a single responsive bottom deck; user requires distinct desktop and mobile landscape designs. | **Two HUD architectures are required.** They share state, simulation, command semantics and visual language; they do not share one panel layout. | Stage 1 brief is authoritative over both GDD layout prose and implementation. |
| R-04 | Implementation always draws a tile-scale checker/grid in the terrain shader; user requires a grid hidden in ordinary gameplay. | **Ordinary gameplay has no construction grid.** The grid may appear during building placement, in the editor, or through an explicit debug/grid-inspection mode. | Stage 1 brief; the current always-on checker is a presentation choice, not a requirement. |
| R-05 | GDD calls for elevation and observation, but the current renderer shows flat tile tops with vertical cliff faces. | **Elevation must be visually legible and mechanically real.** Terraced plateaus with cliffs are acceptable; slopes or slope skirts are preferred where they improve readability. High-ground observation is a provisional rule, not yet confirmed. | Stage 1 brief accepts 2.5D, not a flat map. Elevation must be traced separately through rendering, movement, pathfinding, LOS and vision. |
| R-06 | Implementation once modelled/name infantry as squads; GDD uses "infantry" role categories; implementation now has individual Rifleman and ATGM Gunner. | **Each infantry entity is one soldier.** Control groups group individuals; they do not create squads. | Stage 1 brief and product correction in `docs/PLAN.md` §12. |
| R-07 | GDD allows a custom WebGL renderer; implementation uses an orthographic 45° yaw / 30° pitch 2:1 isometric view. | **A controlled 2.5D/isometric-style camera is accepted.** A flat 2D renderer is not required. The camera must remain consistent, readable and terrain-aware. | Stage 1 brief. |
| R-08 | GDD's campaign, six nations, EW, weather coupling and full roster are long-term scope; implementation is a two-faction slice. | **Keep the slice deliberately small.** Do not expand roster, campaign or advanced simulation before the current land/air/naval slice is coherent. | GDD §16.6 and Stage 1 brief. |
| R-09 | `README.md` says touch control groups use the group strip; the strip is hidden at `max-width: 1100px`. | **Touch control-group access is required and currently missing.** Documentation must not claim the hidden strip is a touch path. | Stage 1 brief requires dedicated accessible selection and control-group interactions; code and CSS contradict the README. |
| R-10 | GDD §13.4 bottom unit panel vs user desktop direction for compact bottom selection area and right production sidebar. | **Desktop uses a persistent right production sidebar and a compact bottom selection/command area.** GDD's "along the bottom" wording is retained for selection information, not for production. | Stage 1 brief is more specific and later. |

### 2.1 Confirmed requirements (must hold)

These are not optional polish. They are the acceptance baseline for the next
milestone.

**Product and architecture**

- One authoritative deterministic simulation shared by desktop, mobile, editor
  test battles and saves.
- Web-first, desktop and landscape mobile browsers.
- 2.5D/isometric presentation, not a flat top-down map.
- Land, air and naval are all architecturally supported and represented in the
  vertical slice; the initial roster stays small.
- No new campaign, six-nation roster, multiplayer, mod SDK or advanced EW work
  in the HUD/battlefield milestone.

**Desktop HUD**

- Battlefield is the primary visual focus.
- Persistent right-side production/construction sidebar.
- Clear production category navigation and image-led building/unit choices, not
  a single row of tiny text/icon cards.
- Compact top resource/status strip.
- Compact bottom selection and contextual command area.
- Minimap and secondary information placed without unnecessarily reducing the
  battlefield.
- No duplicated controls, redundant panels or unnecessarily tall UI regions.

**Mobile landscape HUD**

- Battlefield-first presentation designed for touch; not a shrunken desktop
  layout.
- Compact resource/status information around the top/edges.
- Accessible vertical production-category rail on the right; detailed production
  choices open in a panel or overlay.
- Contextual bottom command bar for selected units and relevant commands.
- Dedicated, accessible selection and control-group interactions.
- Touch targets, safe areas and overlays designed for real use.
- Not every desktop panel remains visible; essential commands and discoverability
  take priority.

**Battlefield and camera**

- Consistent isometric perspective and readable terrain shapes/material
  variation.
- Obvious elevation changes with cliffs and, where appropriate, slopes.
- Readable buildings, vehicles, individual infantry and naval units.
- Units sit at the correct terrain height.
- Construction grid hidden in ordinary gameplay, shown for placement/editor or
  explicit inspection.
- Combat effects and selection feedback must not obscure terrain or the selected
  force.

**Infantry and control groups**

- One entity per soldier; production creates one soldier per completed item.
- Individual selection, box selection, control-group assignment and recall,
  movement, targeting, damage, death, rendering, saves and AI all operate on
  individuals.
- A control group is a player-defined collection of individuals, not a squad
  entity and not a substitute for identity.

**Weapons**

- Vehicle, aircraft and naval weapons remain attached to their parent.
- Turrets rotate around plausible pivots.
- Barrels remain attached while aiming and firing.
- Naval weapons remain attached during movement and turning.
- Offsets are correct for every heading, not only the initial heading.

**Economy (retained for this slice; replacement deferred)**

- Classic RTS base-building/production economy with resources that gate
  production and construction.
- Clear costs, income, affordability reasons and feedback.
- Scenario-configurable starting resources.
- The harvester/ore/refinery loop is retained by the 2026-10-24 decision and
  remains a supported part of the slice.
- Any future extension or replacement must be end-to-end, including data,
  scenario/map schema, editor, AI, HUD/tooltips, saves and tests; it must not be
  a silent removal.

**Grid and elevation**

- Grid hidden in ordinary play; available in placement/editor/debug contexts.
- Elevation visually legible; it must affect movement/pathfinding and relevant
  line-of-sight rules. Vision-range bonuses and combat-height modifiers are not
  confirmed and must not be claimed without a rule.

**Editor, save, determinism**

- Editor can author/validate/deploy a scenario that loads unchanged in battle.
- Versioned scenario and save formats; incompatible versions fail clearly.
- Fixed-step deterministic simulation with seeded randomness.
- Save/restore preserves authoritative state, including aircraft/ship timers,
  queues and RNG.

### 2.2 Confirmed corrections to the current implementation

These are not design preferences; each is a traced conflict between the current
code and a confirmed requirement. Detailed evidence is in
`AUDIT_FINDINGS.md`.

| Correction | Current state | Required state |
| --- | --- | --- |
| C-01 Desktop production architecture | Production is the right-hand third of a full-width 184 px bottom deck; no right sidebar exists in the battle markup. | Persistent right sidebar with production categories and image-led choices; compact bottom selection/command area. |
| C-02 Mobile architecture | Mobile is CSS compaction of the same three-column bottom deck; all panels remain visible; no touch-specific production overlay or category rail. | Separate mobile landscape HUD: top/edge resources, right vertical category rail, overlay/drawer for production, bottom contextual commands, accessible groups. |
| C-03 Mobile objective information | `.top-objective` is hidden at `max-width: 1100px` with no replacement. | Mobile must still expose the primary objective and relevant progress in a compact, discoverable form. |
| C-04 Touch control groups | Group strip is hidden at `max-width: 1100px`; only keyboard/group-strip code exists; README claims a touch path. | Dedicated accessible group assign/recall interaction on touch. |
| C-05 Touch target sizes | Command buttons measure 28×26 px; production tabs 21 px high; stance buttons are smaller still. | Minimum 44×44 px touch targets with spacing; no essential action on a 21 px-high control. |
| C-06 Safe areas | `viewport-fit=cover` is set, but no `env(safe-area-inset-*)` rules exist. | Safe-area padding for top, bottom, left and right HUD regions on notched devices. |
| C-07 Grid | Terrain fragment shader always draws a tile checker (`fract(vWorld.xz / 4.0)`); no toggle. | No grid in ordinary play; grid only for placement/editor/debug. |
| C-08 Ground picking | `worldAt` intersects a fixed `y = 0.8` plane; measured pick error is 2.34 world units at base elevation and 4.33 on the plateau. | Pick against the actual terrain height (iterative solve or heightfield), so orders and placement land under the cursor. |
| C-09 Turret hardpoint offset | Body yaw is correct, but `turretWorldMatrix` rotates the hardpoint offset with the inverse sign: a local +X offset maps to `(cos f, -sin f)` while the hull's +X maps to `(cos f, +sin f)`. The corvette's bow gun moves to the stern at headings away from 0°/180°. | Turret hardpoint offset rotates with the same parent matrix as the hull; the corvette gun stays on the bow at every heading. |
| C-10 Turret aiming | `turretFacing` is only assigned inside `tryFire`; a tank that fought and then drove away keeps its last turret angle. | Continuous plausible turret tracking while engaging; defined rest/stow behaviour when idle. |
| C-11 Muzzle origin | Projectiles spawn from a point along the hull facing, not from the turret barrel. | Muzzle point follows the active weapon/turret. |
| C-12 Shipyard repair | Repair is nested inside `if (e.ammo < e.maxAmmo)`; a full-ammo damaged corvette is not repaired. | Repair any damaged docked vessel, independently of reload state. |
| C-13 Economy coupling | Harvester/ore/refinery concepts are present in units, buildings, map schema, scenario, AI, editor, HUD, save and tests. | **Retained for the current slice.** Any replacement or extension must design the full coupling set and migration deliberately; no silent removal. |
| C-14 Documentation drift | Stage 1 found README/PLAN stale (59 tests / 9 files), a false touch-group claim and "squad" copy. | **Closed 2026-10-24 for current-state documents:** they report 20 files / 191 tests, touch groups, individual soldiers and the actual AI/result limitations. Historical PLAN/audit sections are labelled as history; keep counts current as behaviour changes. |
| C-15 Touch additive selection | Tapping a friendly unit replaces the selection; additive selection requires Shift, which touch does not provide. | An explicit Add/multi-select control in the touch selection sheet, with a visible mode and an exit. |

### 2.3 Provisional recommendations (not yet requirements)

These are the defaults this document recommends where the user has not made a
final decision. They are labelled so implementation does not quietly turn them
into "confirmed" facts.

| ID | Recommendation | Status |
| --- | --- | --- |
| P-01 | Retain two resources for identity: **Materials** (construction/units) and **Requisition** (advanced units/capabilities). | Provisional. GDD originally recommended two; user has not rejected the count, only the harvesting loop. |
| P-02 | Replace harvesting with a **map-control economy**: a modest Materials income from the Command Post, plus Materials from captured/held strategic sites and scenario-authored supply objectives; Requisition from relays and command infrastructure. No mobile harvester. | **Deferred.** Not approved for this slice; retained only as a future-extension option. |
| P-03 | Do not add a new "resource node" unit or building family in the first correction. Reuse existing capturable relays/objectives where possible; decide the refinery's fate only after P-02 is approved. | **Deferred.** Applies only if P-02 is selected later. |
| P-04 | Desktop right sidebar width 320–380 px; production categories as a vertical rail; image-led cards at least 96×72 px with name, cost and requirement state. | Provisional layout target; exact width to be tuned against 1280×720 and 1920×1080. |
| P-05 | Mobile production uses a 56–64 px right category rail plus a transient 300–340 px overlay; no permanent minimap in the main battle view. | Provisional; must be validated on 844×390 and 667×375 plus real safe areas. |
| P-06 | Minimum touch target 44×44 px, 8 px spacing, icon plus short label; 48 px bottom command bar height before labels. | Provisional, based on standard touch accessibility practice; not a GDD number. |
| P-07 | Keep 2.5D terraces with visible cliff faces; add slope skirts only where elevation steps read ambiguously. Do not convert to a full heightfield renderer in this milestone. | Provisional; preserves the existing renderer architecture. |
| P-08 | High ground grants no extra vision or range until a rule is designed and shown in the UI. Document the absence rather than implying a bonus. | Provisional; current code has no high-ground observation rule. |
| P-09 | Control groups persist for the session and survive save/load if cheap to serialize; if not, clear them explicitly on load and document that they are session-only. | Provisional. Current groups are cleared on load (`src/app.ts`). |
| P-10 | AI builds at least one shipyard and produces one corvette when it owns suitable water, rather than only using its starting corvette. | **Partially met.** The coastal shipyard/corvette and airfield/fighter branches pass from a developed fixture, but normal-resource AI construction stalls before reaching them (AI-03). See `AUDIT_FINDINGS.md` §9.4; normal-play reachability remains unverified. |

### 2.4 Open questions and recommended defaults

These cannot be settled from the available evidence. They are recorded rather
than hidden, with a default so work is not blocked.

| ID | Question | Recommended default |
| --- | --- | --- |
| Q-01 | Exact replacement economy: two resources or one? Which sites generate Materials? | P-01/P-02: two resources, map-control Materials, no harvester. |
| Q-02 | Is the Material Refinery converted to a logistics/income structure, or removed? | Remove from the required slice until a replacement is approved; do not keep it as a decorative harvester drop-off. |
| Q-03 | Do refineries still provide the 0.1 requisition trickle if retained? | No special-case income until the replacement economy is approved. |
| Q-04 | Are control groups persisted across save/load? | Session-only unless serialization is added; document it in the UI. |
| Q-05 | Does high ground grant observation/vision or only block LOS? | No bonus for now; revisit with a designed, visible rule. |
| Q-06 | Is the target mobile minimum 667×375 CSS px, or a larger safe-area-adjusted minimum? | Use 667×375 as the hard layout floor and test 844×390 as the primary landscape size. |
| Q-07 | Do the Frontline Zero screenshots require specific visual motifs (sidebar width, card art, top strip density)? | Follow the verbal hierarchy in this document; verify against the reference images when they are made available. |
| Q-08 | Is a searchable event history needed later for competitive review? | **Yes, and it is now implemented** as the field-report overlay (P1-1), retaining the last 240 local events with search, severity filters and jump targets. |
| Q-09 | Should aircraft/naval hardpoints be authored as named attachment transforms rather than numeric offsets? | Yes eventually; the current fix can stay numeric but must use one shared transform convention. |

---

## 3. Shared game model (both HUDs)

Desktop and mobile are **presentation variants**, not separate games.

- One `Game`, one command queue, one scenario, one save format, one AI.
- Selection is a list of entity IDs; a control group is a list of entity IDs.
- Commands have identical semantics on both HUDs: move, attack, attack-move,
  stop, hold position, hold fire, capture, return, produce, cancel, place
  building, set rally.
- Input method changes the gesture, not the command or its validation.
- No mobile-only combat rules, no desktop-only production rules.

This is already the architecture; the correction is to stop letting the shared
DOM/CSS layout dictate a single visual design.

### 3.1 Canonical command ownership

| Command | Desktop | Mobile landscape | Notes |
| --- | --- | --- | --- |
| Select one | LMB / tap | Tap | Individual units and buildings. |
| Add/remove | Shift+click | Selection panel multi-select mode or explicit add toggle | Touch needs a discoverable additive mode; do not rely on modifier keys. |
| Box select | LMB drag | Drag, or BOX mode | BOX must remain a dedicated, labelled control. |
| Move | RMB ground / contextual tap | Tap ground with units selected | Contextual, not a separate "MOVE" button. |
| Attack | RMB enemy / ATTACK mode | Tap enemy / ATTACK mode | Same target validation. |
| Attack-move | A / command | A-MOVE command | Same order flag. |
| Stop | S / command | STOP command | One command path. |
| Hold position | H / command | HOLD POS command | Rename from "HOLD" to avoid collision with hold fire. |
| Hold fire | Stance control | Stance control in selection sheet | Stance, not a movement order. |
| Capture | C / context on relay with engineer | CAPTURE mode + relay | Touch must not require a right-click-only contextual rule. |
| Return | R / command | RETURN command | Aircraft/ships only. |
| Build | B / BUILD / engineer + card | BUILD category + card | Placement mode with grid and ghost. |
| Control groups | Ctrl+1..9 assign; 1..9 recall; strip | Dedicated group button/panel | No hidden strip; no keyboard-only requirement. |
| Stance | Selection panel | Selection sheet | Aggressive / defensive / hold fire. |

The only acceptable duplication is **input parity**: the same command reachable
by a shortcut, a command-bar button and a gesture. The unacceptable duplication
is a control that appears to issue a command but only shows help text, or two
different concepts sharing one label.

---

## 4. Desktop HUD specification

### 4.1 Composition

1. **Top status strip (56–64 px).** Faction/operation identity, Materials,
   Requisition, force count, primary objective/progress, mission clock, pause,
   settings, menu. No duplicate objective card elsewhere.
2. **Right production sidebar (320–380 px, full height below top strip).**
   - Vertical category rail: Overview, Land, Air, Naval, Build.
   - Image-led cards for each available unit/building; thumbnail at least
     96×72 px, name, cost, queue/requirement state, hotkey.
   - Facility queue section with progress and cancel; jump-to-facility on click.
   - Engineer/build availability at the bottom of the Build category.
   - Sidebar is persistent, not a modal, and scrolls internally.
3. **Battlefield.** Fills the remaining width and height. No full-width bottom
   deck across the battlefield.
4. **Bottom selection/command strip (96–120 px) over the battlefield width.**
   - Left: minimap (or minimap docked at the bottom of the sidebar if it gives
     more clear battlefield; choose by measurement, not preference).
   - Centre: selected unit identity, role, health, state, ammo/fuel, stance.
   - Right: contextual commands for the current selection, plus a control-group
     strip.
   - No repeated production cards here.
5. **Transient layers.** Mode banner, placement ghost, drag box, alerts and
   world markers. They must not permanently occupy battlefield area.

### 4.2 Measured targets

These are targets, not claims about the current build. Measure with
`getBoundingClientRect()` after all persistent panels are laid out.

| Viewport | Minimum clear battlefield (no persistent panel over it) | Maximum persistent chrome | Notes |
| --- | --- | --- | --- |
| 1280×720 | ≥55% of viewport area | ≤38% | Right sidebar + top strip + compact bottom strip. |
| 1920×1080 | ≥65% of viewport area | ≤28% | Sidebar should not scale its width with 34vw. |
| 844×390 | ≥65% of viewport height and ≥55% of area with production closed | ≤35% height | Sidebar is an overlay, not permanent column; command bar excluded from clear area. |
| 667×375 | ≥60% of viewport height and ≥50% of area with production closed | ≤40% height | Hard layout floor; test safe-area padding separately. |

"Clear battlefield" means the rectangular area not covered by top strip,
persistent sidebars, bottom strips or permanent minimap. Transient command
overlays count only when open. Do not count decoration gradients as usable
battlefield.

### 4.3 Desktop constraints

- No duplicated objective panel (top strip only).
- No permanent event-log sidebar; toasts and world markers carry alerts.
- No 184 px full-width deck. The current deck is 25.6% of a 1280×720 screen and
  34.2% including the top bar; that is the region the new layout must replace.
- Production cards must not be 18 px icons with 7.5 px labels.
- The selected-unit panel must remain readable at 1280×720 without horizontal
  scrolling of identity/health/commands.

---

## 5. Mobile landscape HUD specification

### 5.1 Composition

1. **Top/edge status (44–52 px).** Materials, Requisition, force count, clock;
   objective accessible through a compact chip or the selection sheet, not
   silently removed.
2. **Right production category rail (56–64 px wide).** Always reachable; buttons
   at least 44×44 px, icon + 8–9 px label. Tapping a category opens a production
   overlay/drawer (300–340 px) anchored to the right; tapping again or outside
   closes it.
3. **Bottom contextual command bar (64–76 px).** Up to six large actions for the
   current selection (move/attack context, attack-move, stop, hold position,
   capture, return, build). Icons plus short labels; 44×44 px minimum; no
   essential command hidden only in an unlabeled icon row.
4. **Selection sheet / chip.** A compact selected-unit header above the command
   bar (name, count, health, stance); expanding it opens a sheet with full stats,
   ammo/fuel, stance, group controls and an explicit Add/multi-select toggle. It
   must not permanently consume the battlefield.
5. **Minimap.** A toggle that opens an overlay; do not permanently reserve
   96–108 px of width for a 72–96 px minimap on a 667 px-wide screen.
6. **Control groups.** A visible group button/panel with assign and recall. A
   two-step interaction is acceptable ("hold group button + choose slot" or
   "Groups → slot → Assign/Recall"); keyboard-only access is not.
7. **Safe areas.** Apply `env(safe-area-inset-top/right/bottom/left)` padding to
   the top strip, right rail, bottom bar and overlays. Test with a simulated
   notch and with `viewport-fit=cover`.
8. **Orientation.** Landscape only for the battle; portrait shows a clear
   "rotate device" message rather than a broken layout.

### 5.2 Mobile constraints

- No permanent three-column bottom deck. At 844×390 the current deck is 142 px
  (36.4% of the screen) and the top bar 48 px, leaving a 200 px band (51.3%)
  before the command bar overlays 36 px of it. At 667×375 the band is 185 px
  (49.3%). These are the measurements the new design must improve, not targets.
- No 28×26 px command buttons, 21 px production tabs or 8 px labels.
- Do not hide the primary objective at ≤1100 px without a replacement.
- Do not hide control groups at ≤1100 px.
- Do not rely on hover, right-click, Shift, Ctrl or a physical keyboard.
- Production choices open in an overlay; they are not permanently visible.
- A single tap selects; a tap on ground with a unit selection moves; a tap on an
  enemy attacks. Explicit ATTACK/A-MOVE/CAPTURE modes remain available and
  visible.
- Destructive or mode-changing overlays must have a visible close/cancel path
  that is at least 44×44 px.

### 5.3 Shared visual language

Both HUDs use the same palette, typography, icon family, unit silhouettes and
team colours. The mobile HUD is not a different art direction; it is the same
command system with fewer simultaneous panels and larger hit areas.

---

## 6. Battlefield, camera and terrain specification

### 6.1 Camera

- Orthographic projection, 45° map yaw, 30° pitch, 2:1 ground diamond. Existing
  `tests/camera.test.ts` proves the projection and screen-space panning; keep
  these contracts.
- Opening frame centres the player base in the clear battlefield region above
  the bottom strip (or the mobile command bar), not the geometric screen centre.
- Zoom range remains clamped; wheel, pinch, edge and keyboard panning continue to
  share the camera contract.
- Screen-to-ground picking must use the actual terrain height. A fixed plane is a
  defect, not a simplification, because it produces repeatable order/placement
  errors.

### 6.2 Terrain and elevation

- Terrain remains a tile-authoritative grid; the renderer may be richer than the
  simulation.
- Elevation must be visible as shape: raised plateaus, cliff faces and readable
  transitions. Flat colour differences alone are insufficient.
- Cliff faces must be lit consistently with the sun; no z-fighting or gaps at
  tile boundaries.
- Unit/building placement must sit at the tile height. Air units use altitude;
  naval units use the water surface.
- Shadows should ground props, units and buildings; they must not substitute for
  elevation legibility.
- **Grid:** hidden in ordinary gameplay. Show it only for building placement,
  editor mode or an explicit debug/grid inspection toggle. The terrain shader's
  always-on checker must be removed or made conditional.
- **Elevation rules audit (each separately):**
  - Rendering: terraces/cliffs exist; slopes are a readability improvement, not a
    requirement for a tile game.
  - Movement: elevation step limits and uphill/downhill costs exist.
  - Pathfinding: elevation is part of step cost/blocking.
  - LOS: ridges/rocks/forest block; elevation ceiling is used.
  - Vision radius: currently no high-ground bonus (P-08).
  - Combat range/accuracy: no height modifier (not required).

### 6.3 Selection and combat feedback

- Selection rings, health bars, stance/suppression indicators and hit flashes
  must remain readable against sand, grass, forest and water.
- Combat effects must not permanently obscure terrain or hide the selected unit.
- Overlay elements (rings, bars, markers) are drawn after terrain/props and must
  not be occluded by terrain geometry.
- Air shadows are presentation only; they do not imply detection or LOS.

---

## 7. Infantry and control groups

### 7.1 Entity rule

- `rifle` = one Rifleman; `atgm` = one ATGM Gunner; `engineer` = one Combat
  Engineer vehicle. No hidden squad count, no automatic multi-spawn.
- Production completion creates exactly one unit entity and increments
  `unitsBuilt` by one. Costs and build times are per soldier/vehicle.
- Selection, box selection, health, death, suppression, stance, ammo/fuel,
  pathfinding, targeting, save/load and AI operate on the individual entity.
- The UI must say "1 selected" for one soldier and list counts by type for a
  mixed group; it must not say "squad" unless a future design explicitly adds
  squad entities (not approved).
- Icons/descriptions must match individual soldiers; "trains infantry squads"
  is a text defect to correct.

### 7.2 Control groups

- A control group is an ordered set of individual entity IDs.
- Assignment and recall must be available on desktop (Ctrl+1..9, 1..9, strip)
  and mobile (dedicated group panel/button).
- Empty-group activation must not silently assign the current selection unless
  the UI clearly presents that two-step action. Current strip behaviour
  (assign-if-empty, recall-if-populated) is ambiguous.
- Recalling a group should select the living members and give clear feedback
  when some members are dead. It must not create new units or merge squads.
- Group membership is UI/session state; if not saved, clear it on load and say
  so. Do not serialize group IDs into the authoritative simulation unless they
  affect gameplay.

### 7.3 Formations and stances

- Movement uses simple, deterministic spacing (the existing grid formation is
  acceptable). No formation editor is required.
- Group stance is allowed; individual overrides are allowed.
- Rename "HOLD" (position) and "HOLD FIRE" (stance) so they cannot be confused.
- The UI must state when only part of a mixed selection can perform an action.

---

## 8. Weapon attachment specification

### 8.1 Coordinate convention

Define and document one convention in code comments and tests:

- Local +X = forward (bow/nose/barrel direction).
- Local +Y = up.
- Local +Z = the lateral axis; define its sign once and keep it consistent.
- Parent yaw rotates local X/Z into world X/Z using the same matrix as the body.
- A hardpoint offset is applied in parent-local space, then the turret is rotated
  around its own pivot.

`modelFor` and the turret's own yaw use the same `-facing` convention as the
simulation, so the hull and barrel point correctly. The defect is narrower:
`turretWorldMatrix` rotates the hardpoint offset with the opposite sign.
`modelFor` maps a local +X offset to `(cos f, +sin f)`; the offset code maps it
to `(cos f, -sin f)`. Apply the body matrix to the offset (or use the same
formula) and do not compensate with per-unit offsets. See
`AUDIT_FINDINGS.md` WPN-01.

### 8.2 Behaviour

- Tank/recon/AA turrets rotate toward the current target while engaging. The
  barrel remains attached at the pivot; no gap between hull and turret.
- The muzzle/projectile origin follows the active turret/barrel, not the hull
  centreline.
- The corvette's deck gun remains at the bow at every heading; missile canisters
  and aircraft hardpoints are baked into the body or attached with the same
  parent transform.
- Aircraft weapons move with the aircraft during turns and altitude changes.
- When idle, turrets hold a defined rest angle (forward or last aim); they do
  not snap to an unrelated angle between shots.
- No arbitrary per-unit offset patches. Fix the shared transform and verify it
  with a heading matrix test.

### 8.3 Acceptance (measurement)

For each turreted unit, at headings 0°, 90°, 180° and 270°:

- The computed turret pivot is within 0.25 world units of the intended hardpoint
  in the parent's local frame.
- The turret's rendered base overlaps the hull deck (no visible gap) from the
  default isometric angle.
- Firing while the hull turns produces a projectile/tracer from the barrel end,
  not from the hull nose.
- The corvette's gun remains on the bow through a 90° turn; it does not jump to
  the stern.

---

## 9. Economy specification after harvester removal

**Superseded for the current slice (2026-10-24).** Sections 9.1–9.4 are retained
as the dependency checklist for a future economy extension. They are not current
requirements, and no removal, replacement or map-control income is approved. The
current build keeps the harvesting loop described in §9.5.

### 9.1 What is confirmed

- Classic RTS resource, base-building and production economy.
- Resources gate construction and units; the player must understand why
  something is unavailable.
- Per-facility production queues with a central overview; facility-specific
  rules for land/air/naval.
- Engineer/deployable builder construction with placement validation.
- Scenario-configurable starting resources.
- No harvester, ore field, refinery delivery loop or automated mining state
  machine is required. The RA2-style loop was not part of the intended brief.

### 9.2 What is not confirmed

- The exact number of resources.
- The exact income sources and rates.
- Whether refineries remain as a structure.
- How expansion/map control produces Materials.
- Whether passive income alone is sufficient.

GDD §10.1's two-resource/hybrid-income recommendation is **superseded** as a
requirement. It may be retained only as a provisional proposal (P-01/P-02).

### 9.3 Recommended provisional replacement

Pending approval, use **map-control income with no mobile harvester**:

- **Materials:** a modest baseline from the Command Post, plus income from
  capturable/held strategic sites. The existing two neutral signals relays can
  remain Requisition sites; a later, explicitly approved content pass can add
  Materials-bearing objectives. Do not add a new worker unit.
- **Requisition:** command infrastructure and capturable relays, as today.
- **Expansion:** capturing/holding sites, not driving trucks. Infrastructure
  (factories, airfields, shipyards) still constrains what can be built.
- **Starting income:** tune so the opening 3–5 minutes can fund one production
  facility and a small force without a harvester. Use scenario-configurable
  rates.
- **Feedback:** HUD shows current rate and source breakdown; a tooltip explains
  how to increase it. No "no reachable material deposit" harvester warnings.

This is deliberately a **proposal**, not a hidden implementation mandate. The
remediation plan's first economy task is to get approval for P-01/P-02 before
touching data.

### 9.4 Removal acceptance (end-to-end, deferred)

If a future extension chooses removal rather than extension, that implementation
is complete only when all of these are true:

- `harvester` is absent from unit definitions, production lists, starting
  forces, AI logic, icons, descriptions and tests that require it.
- `ore` is absent from the runtime map, scenario schema/version, editor tools,
  validation, save schema and map statistics, or is explicitly documented as
  inert legacy data during one migration window.
- `refinery` is either removed or redefined by an approved economy decision; it
  is not a required harvester drop-off.
- Material income has a replacement source; deleting harvesters alone is a
  regression, not a fix.
- AI still builds, produces and attacks; it does not stall because its economy
  assumed harvesting.
- HUD top strip/rates/tooltips/help text contain no harvesting copy.
- Save format version is bumped; old saves either migrate (ore stripped, economy
  mapped) or fail with a clear incompatibility message.
- Scenario validation no longer errors on missing ore/refineries; new validation
  checks the replacement income sources.
- Tests cover: no harvester production, replacement income, AI economy without
  harvesters, save/load with the new schema, editor validation, and a full
  build-and-fight loop.

### 9.5 Current product decision (2026-10-24)

**Retain the current harvester/ore/refinery loop for this slice.** It is the
working economy and remains fully supported. The next economy change will be an
extension planned after the current work is complete; it is not a removal task
and must not be smuggled into HUD, AI or balance changes.

Implications for the current work:

- ECO-01/02/03 are closed as not-required for this slice.
- The AI keeps producing harvesters and the refinery completion keeps spawning a
  hauler.
- The HUD keeps its Materials rate and harvester feedback.
- Any future extension still needs the dependency and test review in §9.1–9.4
  before it changes data, schema, editor tools, AI or saves.

The 2026-10-24 second re-audit found no economy code, ore data or save-schema
change and retains this decision. The extension remains deferred behind the
mandatory AI-03 and result-screen corrections; see `AUDIT_FINDINGS.md` §9.6.

---

## 10. Land, air and naval requirements

The slice remains deliberately small, but all three domains must be real.

### 10.1 Land

- Individual infantry, engineer, tank, recon, AA and (until removed) harvester
  are data-driven. After economy removal, land roster should remain coherent;
  do not replace the harvester with another economy vehicle without approval.
- Movement classes, terrain costs, elevation steps, pathfinding and collision
  remain authoritative in the simulation.
- Production is facility-specific; barracks and factory queues work.
- Combat uses weapon/target compatibility, armour multipliers, range, LOS,
  reload, ammo and suppression. Suppression may remain light.

### 10.2 Air

- Directly controllable aircraft with persistent fuel and ammunition.
- Parked state at a physical airfield; takeoff on order; automatic return at low
  fuel/no ammo; landing, repair, rearm and refuel at the airfield.
- SAM/AA hard counters; ground-only weapons cannot damage aircraft.
- Aircraft weapons remain attached and fire from the aircraft.
- AI uses fighters when it has an airfield; no requirement for a full air
  campaign.

### 10.3 Naval

- Fully controllable on-map vessels on navigable water.
- Water-only pathfinding, land destination rejection, turning space and
  shoreline interaction.
- Anti-ship missiles and deck gun; reload/repair at a physical shipyard.
- Repair must work regardless of ammunition state.
- Naval weapons stay attached through movement and turning.
- AI must meaningfully use naval power: at minimum, keep its starting corvette
  active and, if it owns/builds a shipyard with water access, produce/replace a
  corvette. A single defensive starting ship is not "naval use" by itself.
- No submarines, mines, naval aviation or amphibious transports in this
  milestone.

### 10.4 Cross-domain

- At least one meaningful interaction per pair:
  - Land ↔ air: SAM/AA vs aircraft; aircraft strikes ground.
  - Land ↔ sea: coastal guns/ATGM vs ships; naval bombardment of shore.
  - Air ↔ sea: aircraft strike missiles vs ships; ship air defence is not
    required unless added deliberately.
- Ports/airfields are physical, capturable/destroyable assets with operational
  consequences.
- Do not claim a counter exists unless a weapon's `targets`/multipliers and a
  test/reproduction show it.

---

## 11. Alerts, feedback and accessibility

### 11.1 Alerts

Required:

- Critical toast/banner for immediate threats (unit lost, base under attack,
  aircraft returning, low fuel/ammo).
- World markers for important locations/tasks.
- Command acknowledgement and failure messages with a reason.
- A route to the relevant unit/location where practical.

Required now:

- A searchable, filterable field-report overlay (roadmap P1-1). It opens over the
  battle and is not a permanent side panel; do not reintroduce the old sidebar.

### 11.2 Accessibility baseline

- Team colours plus text/shape labels; never colour alone.
- Reduced camera shake and configurable effects (existing).
- Clear contrast and readable type at 1280×720 and 667×375.
- Touch targets and safe areas (Section 5).
- Do not rely on sound alone for critical feedback.
- UI scaling and input remapping are desirable but not confirmed; treat them as
  provisional follow-ups, not blockers.

---

## 12. Save, scenario and determinism

- One versioned scenario format (`iron-tide-scenario`, version 1 currently) and
  one save format (`iron-tide-save`, version 1).
- Save/restore preserves tick, seed, RNG state, entities, queues, aircraft/ship
  timers, projectiles, fog, contacts, player resources/stats and AI state.
- Incompatible versions fail clearly; if a migration is added, it must be
  deterministic and covered by a fixture.
- Economy removal is deferred. If a future extension changes the schema, it
  requires an explicit migration decision: strip ore on load with a version
  bump, or preserve inert fields for one migration window. Do not silently
  reinterpret old ore as a new resource.
- Determinism tests remain: same seed/commands → same state hash; same
  simulation advanced in different batch sizes → same hash; save→load→same hash.
- Rendering and UI state (selection, control groups, camera) may be non-
  authoritative; if saved, they must not change simulation outcomes.

---

## 13. Milestone boundary

The first remediation milestone is **HUD architecture and battlefield
presentation**, because those define the intended experience and the space
available for play. It must not begin with simulation refactors or economy
removal.

The milestone is complete only when:

- Desktop and mobile HUDs are separate layouts over the same state.
- The mobile HUD meets the touch/safe-area/control-group requirements.
- The grid is hidden in ordinary play.
- Ground picking is terrain-accurate.
- Turret/hardpoint transforms and aiming are correct.
- The measured battlefield/clear-area targets are met or explicitly revised
  with evidence.
- Existing tests pass and new HUD/camera/turret tests cover the corrections.

Economy removal or extension is deferred to a later dependency-ordered
milestone, after a separate product decision. Do not delete the harvester while
the HUD still shows harvesting income or the AI still depends on it.

---

## 14. Traceability summary

> **Historical Stage 1 traceability.** Several rows below describe the
> pre-remediation tree (for example the always-on grid and missing sidebar).
> Use `AUDIT_FINDINGS.md` §9 and `NEXT_PHASE_PLAN.md` §2 for the current status.

| Requirement area | Primary evidence in current repo | Status |
| --- | --- | --- |
| Isometric camera | `src/render/camera.ts`; `tests/camera.test.ts` | Meets projection contract; ground picking defect. |
| Elevation rendering | `src/render/terrainMesh.ts` | Terraces/cliffs, no slopes; legible but not rich. |
| Elevation movement/pathfinding | `src/sim/terrain.ts`, `src/sim/pathfinding.ts` | Implemented. |
| Elevation LOS | `src/sim/combat.ts` | Implemented; no high-ground vision bonus. |
| Grid hidden | `src/render/shaders.ts` | Violated: always-on checker. |
| Individual infantry | `src/data/units.ts`, `src/sim/game.ts`, tests | Met; copy still says "squads". |
| Control groups desktop | `src/app.ts`, `src/ui/hud.ts` | Met. |
| Control groups mobile | CSS hides group strip | Missing. |
| Desktop production sidebar | `src/ui/hud.ts`, `src/style.css` | Missing; bottom deck instead. |
| Mobile distinct HUD | CSS media queries only | Missing; responsive compaction. |
| Turret attachment | `src/render/renderer.ts`, `src/render/unitMeshes.ts` | Corvette hardpoint offset sign defect; aiming/muzzle defects. |
| Air loop | `src/sim/game.ts`, `tests/air-naval.test.ts` | Implemented and tested. |
| Naval loop | `src/sim/game.ts`, `tests/air-naval.test.ts`, `tests/ai.test.ts` | Player full-ammo repair covered; AI shipyard/corvette passes from a developed fixture, but normal reachability is blocked by AI-03 (see §9.4 of the audit). |
| Economy harvesting | `src/data/*`, `src/sim/*`, `src/ui/*`, tests | Retained for the current slice by the 2026-10-24 decision; extension deferred. |
| Save/determinism | `src/sim/save.ts`, tests | Met; migration needed for economy change. |
| Editor/validation | `src/ui/editor.ts`, `src/sim/scenario.ts` | Met for slice; ore tools remain while harvesting is retained. |
| Alerts | `src/ui/hud.ts`, overlay | Layered alerts present; field-report overlay with search, filters and jump targets. |
| Accessibility | settings + HUD | Partial; touch/safe-area failures are blocking. |

---

## 15. Approval record

| Decision | Owner | State |
| --- | --- | --- |
| Harvester/ore/refinery loop is retained for this slice | User decision, 2026-10-24 | **Confirmed.** Replacement/removal deferred; see §9.5. |
| Harvester/ore/refinery loop is not intended | User (Stage 1 brief) | **Superseded 2026-10-24** by the retained-loop decision. |
| Separate desktop/mobile HUDs | User (Stage 1 brief) | **Confirmed** |
| Grid hidden in ordinary play | User (Stage 1 brief) | **Confirmed** |
| Individual soldiers | User (Stage 1 brief) | **Confirmed** |
| Two-resource map-control replacement economy | This document | **Provisional — needs approval** |
| Desktop sidebar width / card art / mobile rail dimensions | This document | **Provisional — validate by measurement** |
| High-ground observation bonus | This document | **Not approved** |
| Event log | This document | **Implemented (P1-1) as a non-modal overlay** |

No implementation should treat a provisional row as confirmed until the user
approves it. The remediation plan identifies which tasks are blocked on that
approval and which can proceed independently.
