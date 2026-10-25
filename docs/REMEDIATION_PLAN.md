# Remediation Plan — Stage 1 Output

Status: **Historical Stage 1 plan. No application source was changed by this
plan.** Several milestones below have since been implemented. For the current
working-tree state, verified evidence and dependency-ordered next phase, read
[AUDIT_FINDINGS.md](AUDIT_FINDINGS.md) §8, [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md)
§29 and [NEXT_PHASE_PLAN.md](NEXT_PHASE_PLAN.md) first. This file is retained as
the original sequencing record, not as current status.

This plan turns the reconciled specification and audit into bounded, dependency-
ordered work. It deliberately does not add roster, campaign, multiplayer or
advanced simulation features. The first implementation milestone is the HUD
architecture and battlefield presentation, because those define the intended
experience and how much battlefield the player actually gets.

Requirements are labeled **CONFIRMED**, **CORRECTION** or **PROVISIONAL** to
match `DESIGN_SPEC_RECONCILIATION.md`. Items requiring user approval are marked
**GATE**.

Workstreams are deliberately separated so a specification decision is not mixed
with a UI rewrite or a simulation change:

| Workstream | Where it is handled |
| --- | --- |
| Specification corrections | Phase 0 (documents only) |
| Architecture (shared state, HUD regions, transforms) | 1A, task 15 |
| Visual/UI (layout, touch, thumbnails, feedback) | 1A–1C, tasks 7–10 |
| Simulation/systems (aiming, muzzle, economy, AI, repair) | Milestones 2–4 |

---

## 0. Rules for every milestone

- One authoritative simulation (`src/sim`); desktop and mobile HUDs are views
  and command surfaces over the same `Game`.
- Keep the fixed-step simulation, seeded RNG, save version discipline and the
  existing module boundaries unless a task explicitly says otherwise.
- Do not add a framework, runtime dependency or external art pipeline for the
  HUD without approval. Procedural thumbnails are acceptable.
- Every behavior change gets a focused test; every UI layout claim gets a
  measured viewport check at 1280×720, 1920×1080, 844×390 and 667×375.
- Update `README.md`/`docs/PLAN.md` in the same change; never claim a test or
  control that was not exercised.
- No broad refactor. Touch only the files named for a task plus necessary
  imports.

---

## 1. Phase 0 — Approve the fork in the road (no code)

**GATE E-1: replacement economy.** Choose one of the provisional models in
`DESIGN_SPEC_RECONCILIATION.md` §6. Recommended default: map-control income
(P-02), because it preserves construction/production decisions and reuses the
capture loop without a new unit micro-loop. Approval is required before any
economy removal.

**GATE V-1: reference screenshots.** Provide the Frontline Zero desktop/mobile
images (or confirm they are unavailable). Until then, HUD work follows the
written hierarchy, and visual comparison remains a verification gap.

**GATE H-1: layout targets.** Approve the measurable targets in
`DESIGN_SPEC_RECONCILIATION.md` §5.4 (desktop ≥55%/≥65% clear battlefield;
mobile ≥65%/≥60% with production closed; 44×44 px touch targets).

**Specification corrections (documentation only, separate from code):**

1. Mark GDD §10.1/§16.3 harvester economy as **superseded** by the user
   clarification; link to this plan.
2. Mark GDD §13 HUD requirements as **replaced** by the separate desktop/mobile
   specification.
3. Add the confirmed rule that the construction grid is hidden in ordinary play
   and shown only for placement/editor/inspection.
4. Add the confirmed rule that infantry are individual entities; remove "squad"
   language from player-facing copy.
5. Add the confirmed camera/render convention: one forward axis shared by
   simulation and rendering.
6. Replace the GDD's provisional elevation/weather claims with the implemented
   facts (movement/LOS yes, vision/range no) or approve a rule.

**Acceptance for Phase 0:** the four documents are approved or marked with
decisions; no source files changed; open questions have an owner.

---

## 2. Milestone 1 — HUD architecture and battlefield presentation

This is the first implementation milestone. It is split into 1A (structure),
1B (battlefield readability) and 1C (feedback/accessibility), but 1A and 1B are
one review unit because camera framing depends on HUD geometry.

### 1A. HUD information architecture

**Goal:** separate desktop and mobile compositions over one game state.

**Tasks:**

1. **Define HUD regions and state** in `src/ui/hud.ts`.
   - Extract region builders: `renderTopStrip`, `renderDesktopSidebar`,
     `renderSelectionStrip`, `renderCommandArea`, `renderMinimap`,
     `renderMobileRail`, `renderMobileProductionSheet`,
     `renderMobileCommandBar`.
   - Keep one `render()`/update loop; no duplicate game subscriptions.
   - Add a `layout: 'desktop' | 'mobile'` decision based on available width and
     input capability, not user-agent.
   - Files: `src/ui/hud.ts`, `src/style.css`, `index.html` (only if a container
     element is genuinely required).
   - Acceptance: at 1280×720 and 1920×1080 the desktop composition has a right
     sidebar and no bottom production deck; at 844×390 and 667×375 the mobile
     composition has a category rail/overlay and a bottom command bar; both
     issue the same `App` commands.

2. **Desktop right sidebar** (`src/ui/hud.ts`, `src/style.css`).
   - Compact top resource/status strip: materials, requisition, income, power/
     population if retained, objective chip, pause/speed.
   - Right sidebar: category navigation (Build / Infantry / Vehicles / Air /
     Naval as applicable), facility queues, image-led cards, costs, disabled
     reasons.
   - Bottom strip: selection summary, stance, contextual commands; minimap in
     the sidebar footer or a compact lower-left region.
   - Remove the unused `.side-panel` rule and the `.bottom-deck` production
     column.
   - Acceptance: one sidebar; no duplicated production controls; production card
     thumbnail ≥96×72 px; minimap remains clickable; at 1280×720 clear
     battlefield ≥55%; at 1920×1080 ≥65%.

3. **Mobile composition** (`src/ui/hud.ts`, `src/style.css`).
   - Compact top strip: resources, objective chip, pause; collapse secondary
     stats into an expandable sheet.
   - Right vertical category rail (44×44 px minimum) with icons + labels.
   - Production choices open in a bottom/side sheet with large cards; sheet
     closes on selection or backdrop tap.
   - Contextual bottom command bar with icon + short label; move/attack modes
     show a clear "tap target" banner.
   - Selection chip opens a selection sheet with an explicit Add/multi-select
     toggle (tap-to-replace remains default); group panel with assign/recall.
   - Minimap becomes a collapsible overlay or small corner map, not a permanent
     third column.
   - Use `env(safe-area-inset-*)` on all fixed edges; `body.touch` gets real
     rules or is removed.
   - Acceptance: production closed gives clear battlefield height ≥65% and area
     ≥55% at 844×390, height ≥60% and area ≥50% at 667×375 (command bar
     excluded); no overflow; no overlapping hit boxes; every essential control
     ≥44×44 px; groups usable without a keyboard; additive selection works by
     tapping the Add toggle then a second unit.

4. **Production thumbnails** (`src/ui/hud.ts`, new helper under `src/ui/` or
   `src/render/`).
   - Render unit/building meshes once to an offscreen canvas at a fixed
     isometric angle, cache by `defId`, fall back to the existing icon if WebGL
     is unavailable.
   - Do not render per frame; do not add external assets.
   - Acceptance: every producible item has a recognisable thumbnail; card text
     remains legible at 1280×720 and in the mobile sheet; no measurable frame
     regression.

5. **Command cleanup** (`src/ui/hud.ts`, `src/app.ts`).
   - Remove the MOVE no-op button; either make it a real move mode or remove it
     (recommended: remove and rely on tap/right-click plus A-MOVE).
   - Rename HOLD → HOLD POSITION / HOLD POS.; keep HOLD FIRE as stance.
   - Ensure no touch help text says "right-click".
   - Acceptance: every visible command performs its label; no duplicate HOLD
     meaning; a DOM test asserts command labels and that MOVE is absent or
     functional.

6. **Objective and group access** (`src/ui/hud.ts`, `src/style.css`).
   - One objective location per layout; mobile chip opens a detail sheet.
   - Group panel visible on mobile; empty vs populated state distinct.
   - Acceptance: objective and relay progress reachable in one tap; assign and
     recall work at 844×390 and 667×375.

**Risk / regression for 1A:**

- HUD mount/render is called from `App` with dirty flags; duplicating it for
  two layouts can cause lost updates. Keep a single source of truth and force a
  full render on breakpoint change.
- `frameBattleCamera` uses HUD height to lift the camera; update it with the new
  bottom bar height and test the opening base framing.
- Minimap canvas sizing depends on its CSS box; moving it requires a resize hook.
- Editor styles share `.btn`/`.panel` classes; scope new rules to battle HUD to
  avoid changing the editor.

### 1B. Battlefield presentation

7. **Terrain-aware picking** (`src/app.ts`, `src/render/camera.ts`; optional
   shared helper).
   - Add `screenToTerrain(px, py): {x,z,y}` that marches or binary-searches the
     view ray against `game.heightAt` (fallback to water height).
   - Replace the fixed `screenToGround(..., 0.8)` in `App.worldAt` used by
     selection, orders, placement, rally and minimap.
   - Tests: at elevations 0/1/2, projected tile centers resolve within 0.25
     world units; water clicks resolve to water; no regression to flat-ground
     camera tests.
   - Acceptance: placement ghost is under the cursor on the central ridge;
     right-click move lands on the intended tile.

8. **Grid visibility** (`src/render/shaders.ts`, `src/render/renderer.ts`,
   placement/editor paths).
   - Remove the unconditional checker from `TERRAIN_FS`; add `uShowGrid` (or
     draw the grid in a separate overlay pass) and default off.
   - Show only when `App.mode === 'place'`, editor is active, or explicit grid
     inspection is enabled.
   - Keep the editor grid (`editorRender.ts:35–51`).
   - Acceptance: ordinary battle has no tile-grid lines at 1280×720 and
     844×390; placement shows a footprint-aligned grid; editor still shows its
     grid; shader compiles on WebGL2.

9. **Elevation presentation** (`src/render/terrainMesh.ts`,
   `src/render/renderer.ts`).
   - Add chamfer/slope skirts at height transitions or document the terrace
     style; interpolate unit ground height near tile edges to eliminate snapping.
   - Do not change simulation heights or walkability.
   - Acceptance: no floating tile corners; units do not visibly pop at elevation
     boundaries; ridge and cliffs remain readable at default zoom.

10. **Selection and combat readability** (`src/ui/overlay.ts`,
    `src/render/renderer.ts`).
    - Consistent selection ring/bracket for individual infantry, vehicles and
      ships; selected-group count; health/suppression bars that do not obscure
      terrain.
    - Ensure effects (muzzle, impact, smoke) are distinguishable by domain.
    - Acceptance: single infantry and 10-infantry selections are readable at
      default zoom; selection feedback never covers the whole unit; no
      regression in overlay hit-testing.

11. **Camera framing and zoom** (`src/render/camera.ts`, `src/app.ts`).
    - Recompute `BATTLE_ZOOM`/`setScreenLift` against the new HUD so the opening
      base is framed, not hidden behind the command area.
    - Acceptance: opening base and first objective visible at all four
      viewports; camera focus lands in the clear battlefield area.

**Risk / regression for 1B:** terrain picking uses `Camera.screenToGround` in
tests; keep the old API but add the height-aware one. Shader changes can break
WebGL1 fallbacks (none supported) or precision; compile-check on the live
context. Terrain mesh changes affect prop shadows and placement previews.

### 1C. Accessibility and touch foundation

12. Add focus-visible states, 44×44 px minimum hit areas, `aria-label`s for
    icon-only buttons, and a reduced-motion setting for camera shake.
13. Add a HUD scale option (100/115/130%) if it does not complicate the first
    milestone; if deferred, record it as a gap.
14. Add a DOM layout smoke test using a headless viewport (if the project gains
    a browser test dependency approved for this purpose) or a small Playwright
    script under `tests/` that checks overflow, target sizes and visibility at
    the four viewports. Do not add a dependency without approval.

**Milestone 1 exit criteria:**

- Desktop and mobile compositions exist and are structurally distinct.
- All measured targets in `DESIGN_SPEC_RECONCILIATION.md` §5.4 pass, with
  numbers recorded in `VERIFICATION_REPORT.md`.
- Grid hidden in ordinary play; terrain picking correct on elevation.
- Objective/group/production access works on touch.
- `tsc`, full Vitest suite and production build pass; no console errors.

---

## 3. Milestone 2 — Unit/weapon transform correctness

**Depends on:** none technically, but do it after 1B so camera/pick work is not
confounded by moving models. This milestone is small and high-value.

15. **Canonical transform** (`src/render/renderer.ts`, `src/render/math.ts`).
    - Fix `WPN-01`: rotate the hardpoint offset with the same parent matrix as
      the hull, not the inverse sign. Use one `entityMatrix` and one
      `turretMatrix` helper.
    - Add a unit test comparing the transformed local +X of the hull and the
      hardpoint offset with `(cos facing, sin facing)` at 0/90/180/270°.
    - Acceptance: hull and turret hardpoint agree; corvette gun stays on the bow;
      a 90° turn does not move it to the stern.

16. **Continuous turret tracking** (`src/sim/game.ts`, `src/render/renderer.ts`).
    - Track current target/aim point each tick at a bounded rate; hold a rest
      angle when idle; do not tie aiming to cooldown.
    - Keep turret angle presentation-only unless a rule explicitly uses it.
    - Acceptance: turret follows a moving target within a small angular error;
      no stale 180° turret after combat; deterministic replay unchanged.

17. **Muzzle from the barrel** (`src/sim/game.ts`, shared transform helper).
    - Compute the muzzle in turret space from the active hardpoint; use the
      same parent/turret transform as the renderer. For aircraft/buildings use
      their mount points.
    - Acceptance: projectile origin is within 0.5 world units of the barrel tip
      at 0/90/180° turret bearings; visual tracer and simulation agree.

**Risk:** changing rendering yaw will rotate every unit; this is intended.
Check shadows, static scenario preview, aircraft, and turret offsets. Do not
"fix" the corvette with an arbitrary counter-offset.

---

## 4. Milestone 3 — Economy replacement and harvesting removal

**Depends on:** GATE E-1 approval and Milestone 1 (HUD income display).
**Do not start before approval.** Removal is not just deleting the harvester.

### 3A. Replacement economy

18. Implement the approved model behind one income API
    (`src/sim/game.ts`, `src/sim/types.ts`, data).
    - Recommended default: map-control income (P-02): a baseline materials/
      requisition rate plus captured relays/objectives; no ore fields.
    - Expose `incomeBreakdown(player)` for HUD/tooltips/AI.
    - Update `updatePassiveIncome` to credit materials and requisition from
      explicit sources; remove `matsGathered`-only accounting.
    - Acceptance: a player with no harvester can build a facility, produce a
      force and replace losses for 10 minutes; income breakdown matches actual
      credits; no NaN/negative.

19. Update AI economy (`src/sim/ai.ts`).
    - Replace harvester/refinery logic with the approved income model; keep the
      same command API and affordability checks.
    - Acceptance: AI builds, produces and attacks for 10 minutes without a
      harvester; no stall; measurable unit/building count growth.

### 3B. End-to-end removal

20. Remove harvester/ore/refinery dependencies in this order:
    1. Scenario/schema: `src/sim/scenario.ts`, `src/sim/types.ts`,
       `src/sim/map.ts`, `src/sim/save.ts` — remove ore fields, ore validation,
       harvester serialization; bump save/scenario version; add migration or a
       clear error.
    2. Data: `src/data/units.ts`, `src/data/buildings.ts`,
       `src/data/scenarios.ts` — remove harvester unit, refinery, ore fields,
       harvester starts; replace refinery role with approved economy structure
       if needed.
    3. Simulation: `src/sim/game.ts` — remove harvester state machine,
       `updateHarvesters`, ore accounting, refinery repair/drop-off branches.
    4. AI: `src/sim/ai.ts` — remove harvester/refinery build and production
       logic.
    5. Editor: `src/ui/editor.ts`, `src/ui/editorRender.ts` — remove ORE brush,
       ore summary, ore-aware validation; add replacement-income inspection if
       useful.
    6. HUD: `src/ui/hud.ts`, `src/ui/overlay.ts` — remove harvester states and
       ore labels; show approved income sources.
    7. Renderer: `src/render/renderer.ts`, `src/render/geometry.ts`,
       `src/render/terrainMesh.ts` — remove ore mesh/instances/refresh.
    8. Tests/perf/docs: replace ore/harvester fixtures; update README/PLAN.
    - Acceptance: no required harvester/ore/refinery references in `src/` or
      `tests/`; old saves either migrate or fail with a clear version message;
      editor has no dead ORE tool; full loop still works.

**Risk:** high. Save/scenario fixtures, AI build order, balance, editor
reachability, and tests all move together. Do this as an ordered change set with
a version bump, not a series of half-removals. Keep a migration test with a v1
save fixture.

---

## 5. Milestone 4 — Naval, AI and editor follow-through

21. **Ship repair** (`src/sim/game.ts`): move repair outside the ammo gate; add
    a full-ammo repair test; show repairing state in HUD.
22. **AI naval branch** (`src/sim/ai.ts`): build/repair a shipyard when needed,
    produce one corvette, use it for coastal attack/defence; add a 7–10 minute
    AI test. Bounded, not a full naval strategy.
23. **Mobile editor** (`src/style.css`, `src/ui/editor.ts`): collapsible tool
    drawer and bottom-sheet inspector; 44×44 px tools; test at 844×390 and
    667×375.
24. **Weather/time clarity** (`src/ui/editor.ts`, help/docs): label as
    visual-only, or add one tested rule (not both silently). Acceptance:
    no implied effect that does not exist.
25. **Copy cleanup** (`src/data/buildings.ts`, tests, README): remove "squad"
    language; correct control-group instructions.
26. **Docs truth pass** (`README.md`, `docs/PLAN.md`): current test counts,
    known limitations, links to the reconciliation/audit; separate "implemented"
    from "meets Stage 1 spec".

---

## 6. Dependency graph

```
Phase 0 approval
   │
   ├── E-1 economy model ──────────────┐
   ├── V-1 reference images            │
   └── H-1 layout targets              │
                                       ▼
Milestone 1A HUD structure ──► 1B battlefield ──► 1C accessibility
        │                          │
        │                          └──► Milestone 2 transforms/aiming
        │
        └──► Milestone 3A replacement economy ──► 3B removal ──► Milestone 4
```

Milestone 2 can run in parallel with 3A after 1B. Milestone 3B must wait for
3A and the save migration design. Milestone 4 is independent after 1A.

---

## 7. Verification strategy

For every milestone:

- `npx tsc --noEmit` (no errors).
- `npx vitest run` (all tests; add focused tests for each behavior).
- `npm run build` (bundle succeeds).
- `npm run bench` for simulation/economy/path changes; compare against the
  baseline in `VERIFICATION_REPORT.md` (0.277 ms/tick baseline, 5.283 ms/tick
  171-entity stress on this machine).
- Runtime viewport checks at 1280×720, 1920×1080, 844×390, 667×375, with
  measured clear battlefield area and control rects.
- No console/shader errors; WebGL2 context present.
- For economy: a 10-minute automated or scripted full-loop playthrough.
- For transforms: matrix unit test + visual heading check at 0/90/180/270°.
- For picking: projected elevation test + placement ghost check.

Record all commands and outcomes in `VERIFICATION_REPORT.md`; do not claim a
pass that was not run.

---

## 8. Explicitly out of scope

- Full six-nation roster, campaign, multiplayer, mod SDK or new maps beyond
  migration fixtures.
- Replacing the WebGL2 renderer or simulation architecture.
- A full morale/rout model, advanced weather simulation or naval strategy AI.
- New external art/audio assets or a UI framework.
- Deleting systems/assets beyond the approved economy removal.

---

## 9. Recommended first change set

**Change set 1 (after approvals): HUD measurement and structural shell only.**

- Add the desktop/mobile region builders and CSS grid without changing command
  behavior.
- Remove the unused `.side-panel` rule; keep both layouts behind one render
  path.
- Add the objective chip and group panel visibility.
- Measure and record the four viewports.
- No thumbnails, no camera/grid changes yet.

This proves the layout assumptions before the more invasive battlefield and
economy work. The second change set then adds the sidebar content, touch
targets and production thumbnails; the third hides the grid and fixes terrain
picking. That sequence keeps each change reviewable and gives measurable
evidence at every step.
