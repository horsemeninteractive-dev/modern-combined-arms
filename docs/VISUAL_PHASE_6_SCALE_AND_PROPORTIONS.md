# Visual Phase 6 — Cross-Unit Scale, Proportions and Silhouette Correction

## 1. Scope and evidence

This phase audited the existing unit presentation path before changing geometry. It is a
presentation-only pass: no simulation, AI, combat, economy, roster, input, picking, fog or save
code was changed.

Evidence used:

- `src/render/unitMeshes.ts`, `src/render/unitTransform.ts` and the unit draw path in
  `src/render/renderer.ts`.
- `tests/unit-scale.test.ts`, `tests/weapon-transform.test.ts` and `tests/presentation.test.ts`.
- The deterministic Kestrel Bay probe (`tools/visual-probe.js`) at tick 0.
- Browser captures from the shipped renderer. The model-isolation captures use a diagnostic
  clear-fog view and temporarily clear decorative props; those are runtime-only capture aids,
  not production changes. The normal fog path was not modified.

There was no six-reviewer readability panel in this phase. Statements below are developer
visual inspection plus automated geometry checks, not a human recognition result.

## 2. What actually controls visual size

The complete path for a land unit is:

1. `unitVisualScale(id)` in `unitMeshes.ts` supplies one uniform multiplier.
2. `renderer.drawStaticMesh()` / the unit draw path calls
   `modelFor(x, y, z, -facing, vs * verticalScale, vs * verticalScale)`.
3. A turreted unit's turret is placed by `turretModelMatrix()` with the same visual scale and the
   model-space `turretOffset`; the body keeps the hull heading and the turret gets its own yaw.
4. `unitShadowRadius()` supplies the soft contact-shadow footprint, independent of the mesh.
5. `unitBannerHeight()` supplies the health-bar anchor in `src/ui/overlay.ts`.
6. Collision radius and other `UNITS` fields are gameplay quantities. They are not a physical
   model size and were not changed.

The three target models are all authored at `unitVisualScale = 1`. The earlier apparent mismatch
was therefore **not** a case of infantry using a larger per-unit multiplier than the tank. The
important causes were:

- The old MBT hull was **3.56 × 2.00** world units (1.78:1), with a full-width track/fender box
  and a **1.35 × 1.02 × 0.28** rectangular turret slab. From the isometric camera its mass read as
  a broad low box rather than a 7 m armoured vehicle.
- The infantry was already deliberately enlarged: **1.20 world units = 2.4 m** at the project's
  2 m/world reference. That is a readability exaggeration over a 1.8 m human, and it reduces the
  infantry:tank ratio from a real ≈3.9:1 to ≈2.96:1.
- The infantry helmet, head, limbs and equipment were built almost entirely from equal-weight
  cuboids. At gameplay resolution that blockiness, not the absolute scale, made the two roles feel
  closer in mass.

The correction therefore keeps the shared scale reference coherent and fixes the forms that made
the tank read small and the infantry read like a stack of boxes. It does not add a new hidden or
arbitrary per-unit multiplier.

## 3. Shared scale reference

Reference values are approximate and use the project convention **1 world unit = 2 m**. Real-world
figures are defensible approximations, not a claim of measured research.

| Item | Real reference (approx.) | Model dimensions (world) | At 2 m/unit | Visual scale | Note |
| --- | --- | --- | --- | --- | --- |
| Standing rifleman, boots to helmet crown | 1.8 m | 1.225 tall | 2.45 m | 1 | Deliberate readability exaggeration; boots at y = 0 |
| Rifle, stock to muzzle | 0.9–1.0 m | 0.495 long; tip x = 0.295 | 0.99 m | 1 | Tip remains on `muzzle.forward` |
| ATGM tube, rear to front cap | 1.2–1.5 m | 0.85 long; tip x = 0.48 | 1.70 m | 1 | Carried at shoulder; larger than rifle by design |
| MBT hull, track envelope | 7.1–7.8 m long, 3.5–3.8 m wide | 3.56 × 1.825 | 7.12 × 3.65 m | 1 | 1.95:1 hull ratio |
| MBT hull height to deck | 1.7–2.0 m | 0.9925 | 1.99 m | 1 | Excludes turret and antenna |
| MBT turret base / roof | 2.3–2.8 m long, 2.2–2.5 m wide | 1.30 / 1.08 long; 1.00 / 0.84 wide | 2.6 / 2.16 m; 2.0 / 1.68 m | 1 | Tapered from base to roof |
| MBT overall height including cupola/antenna | 2.4–3.0 m | ≈1.67 | ≈3.34 m | 1 | Antenna-inclusive envelope |
| Legacy SPG hull (unchanged) | — | 3.29 × 2.39 × 1.24 after 0.70 scale | 6.58 × 4.78 m | 0.70 | P0 follow-up: old hull is almost square |

Deliberate readability choices:

- The 2.4 m infantry silhouette is retained rather than silently shrinking soldiers below the
  battle-zoom readability floor. The tank's real proportions are kept, so the pair reads as people
  beside a full-size vehicle; the tank remains roughly three infantry heights long in world space.
- The tank's roof/cupola/antenna height is slightly generous so the turret silhouette survives the
  isometric projection.
- No distance-dependent or camera-dependent unit resizing was added.

## 4. Geometry changes

### Rifleman

- Replaced the square helmet box with a low-segment rounded helmet shell plus separate brim, ear
  covers, NVG mount and goggle strip.
- Retained the existing articulated legs, boots, chest rig, pouches, pack and two-handed rifle
  pose. The rifle stock, receiver, handguard, magazine, optic and muzzle remain a single connected
  silhouette at the existing hardpoint.
- The support hand and rear hand remain at the handguard and pistol grip; no weapon transform was
  changed.

### ATGM gunner

- Kept the same shared infantry anatomy as the rifleman, deliberately, so the two roles share body
  proportions rather than becoming unrelated models.
- Retained the shoulder-carried tube, sight block, grip and support hand. The tube's front cap is
  the orange warning tip and remains at x = 0.48, under the existing `muzzle.forward = 0.45`
  alignment convention.
- The longer tube and orange cap remain the role cue at battle zoom; the body does not copy the
  rifle pose.

### Main battle tank

- Narrowed the track centres from z = ±0.78 to ±0.70 and the track width from 0.30 to 0.28.
- Narrowed the lower hull to 1.30, upper hull to 1.42 and glacis/rear plates accordingly. The
  complete track/stowage envelope is now **1.825** wide rather than 2.0.
- Replaced the rectangular turret box with a **tapered turret**: 1.30 × 1.00 at the base, 1.08 ×
  0.84 at the roof, 0.29 high, with the roof panel, mantlet, bustle, cupola, hatches, optics,
  smoke dischargers, antenna and side trim repositioned to the new surfaces.
- Retained the existing hull length, track wheel spacing, engine deck, side skirts, headlights,
  tow hooks, stowage, gun thermal sleeve, muzzle brake and the authored 2.20 muzzle hardpoint.
- No SPG, MLRS, recon or other vehicle using the legacy `buildTankBody()` hull was changed. The
  MBT uses `buildMbtBody()` / `buildMbtTurret()`, which are separate from those legacy meshes.

## 5. Wider-roster audit

This was an inspection, not a roster conversion.

| Priority | Finding | Action |
| --- | --- | --- |
| P0 — scale-breaking | The MBT's old 2.0-wide, square-ish track box and slab turret reduced its apparent size. | Fixed in this phase. |
| P0 — scale-breaking | Legacy SPG hull is 3.29 × 2.39 world units after its 0.70 multiplier (ratio 1.38); the old family hull is visibly broader than the new MBT. | Recorded, not changed. It needs a deliberate legacy-hull separation, not an MBT edit. |
| P1 — silhouette | SPG/recon-family vehicles still use the old box hull and old turret language. | Recorded for a later tracked-vehicle pass. |
| P1 — overlay | Only rifle/atgm/medic/tank have custom banner heights. The SPG's health bar uses the legacy default 5 world-unit anchor and floats well above the vehicle (visible in the selection-overlay capture). | Recorded. Changing overlay heights is outside the three-model geometry scope. |
| P2 — detail | All unit meshes remain untextured vertex-coloured geometry with no UVs. | Unchanged; a material/UV pipeline is a separate phase. |
| P2 — polish | Micro-detail on the new models is intentionally restrained; hatches, smoke dischargers and stowage read more at close zoom than at battle zoom. | Accepted for this phase. |

## 6. Captures and inspection

All paths are relative to `docs/visual-audit/p6/`.

| Capture | Conditions | What it shows |
| --- | --- | --- |
| `p6-after-rifle-close-4.png` | Camera half-height 4.2, diagnostic clear stage | Rounded helmet, rifle/arms, boots and ground contact |
| `p6-after-atgm-close-2.png` | Same | Shoulder tube, orange front cap, support hand, human proportions |
| `p6-after-tank-close-2.png` | Same; hull 0.3 rad, turret 0.9 rad | Tapered turret, narrow track envelope, attached barrel and muzzle brake |
| `p6-rifle-orientations-2x2.png` | Four facings in one frame | Rifle silhouette from front/side/rear/opposite side |
| `p6-atgm-orientations-2x2.png` | Four facings | Tube remains attached and readable from all sides |
| `p6-tank-orientations-four.png` | Four facings in one line, turret traversed separately | Hull/turret relationship and barrel attachment |
| `p6-after-lineup-battle-2.png` | Closest gameplay zoom (22) | Infantry/tank relative scale in one composition |
| `p6-after-lineup-actual-battle-zoom.png` | Real opening half-height (36) | Actual battle-zoom readability: two small infantry and one larger tank |
| `p6-scale-with-existing-spg.png` | MBT beside legacy SPG | Wider legacy hull is visible; scale comparison |
| `p6-selection-overlays-3.png` | Normal HUD, selection rings and health bars | Tank ring/bar fit the new model; SPG bar is visibly high (P1) |

Phase 4's `p4-04-after-*` close-ups and `p4-03-after-*` zoom-22 frames are the closest available
“before” references. They were captured on a different showroom path and are not pixel-matched
against these frames; the comparison is qualitative.

Developer inspection result:

- The tank now has a clear long-hull, narrower-track, tapered-turret form. The barrel remains
  attached to the turret at all shown traverses.
- Infantry read as people rather than near-tank-sized blocks. The rifle and ATGM tube remain
  distinct from one another, and the ATGM's orange cap survives the battle camera.
- Boots sit on the terrain; the tank shadow is under the track envelope; selection rings and
  health bars remain centered on the units.
- At the real opening zoom (36) the infantry is only a few pixels tall. That is the honest
  gameplay-scale result: the relative scale is clear from motion, team flags and selection, but
  fine equipment detail is not a battle-zoom identification cue.

## 7. Measurements and regression

Deterministic Kestrel probe, tick 0, 23 entities, 1279 × 799 buffer, DPR 0.9:

| Measure | Phase 4/5 baseline | Phase 6 | Change |
| --- | ---: | ---: | --- |
| Draw calls | 30 | **30** | 0 |
| Triangles | 79,990 | **80,584** | +594 (+0.74 %) |
| CPU render submission | 0.60 ms (Phase 5 sample) | **0.67 ms** | +0.07 ms; single sample, not a GPU timing |
| Tick-0 `stateHash()` | `t=0\|r=773311\|v=playing\|p0:3000.00:180.00…` | same prefix | visual-only; no simulation change |

The triangle increase is the tapered turret/fenders and the rounded helmet. There is no new draw
call per part: the tank body, turret, tracks and details remain in their existing two unit meshes,
and infantry details remain in the body mesh plus the shared leg mesh.

Focused validation run after the edits:

- `tests/unit-scale.test.ts`: **11/11 pass** (new hull/turret proportion test included).
- `tests/weapon-transform.test.ts` + `tests/presentation.test.ts` + `tests/unit-scale.test.ts`:
  **59/59 pass**.
- `tests/repair-medic.test.ts`: **13/13 pass** after replacing its stale
  `unitVisualScale('medic') > 1.2` expectation with the shared human scale of 1. This is a
  correction to a test that encoded the old arbitrary inflation, not a weakened assertion: the
  same test still requires the medic's infantry rig and production path.
- Typecheck: clean.
- Full suite: **47 files / 517 tests passed**.
- Production build: clean; JS **469.90 kB / 139.06 kB gzip**.
- Difficulty contract unchanged: Elite–Recruit 86 251 (15–1); Elite–Veteran 36 531 (11–5).

The new test checks the MBT hull's length-to-width ratio and that the turret width stays inside
the hull width. It does not replace a human readability panel.

## 8. Unchanged systems and risks

Unchanged:

- Simulation coordinates, movement, collision, ranges, projectile origins, weapon hardpoints,
  turret aiming, picking radii and selection rules.
- Unit statistics, costs, national rosters, legacy faction presets, AI, economy and saves.
- Fog-of-war, terrain materials, selection-ring semantics, renderer shader/texture-unit contracts.
- Legacy SPG/MLRS/recon geometry and their visual multipliers.

Remaining risks:

- **Human validation is still pending.** The Phase 5 six-reviewer ≥90 % criterion was not run; this
  phase does not claim it passed.
- At the true opening zoom the models are small; the improvement is primarily proportion and
  silhouette, not new per-pixel detail.
- The legacy tracked hulls remain wide and boxy; the SPG health-bar anchor remains high. Both are
  recorded as follow-ups rather than silently folded into this pass.
- The tank's height envelope includes its antenna; no physical height or hitbox was changed.
- All measurements are desktop Chromium/ANGLE CPU submission. No mobile or GPU claim is made.

## 9. Files changed

- `src/render/unitMeshes.ts` — rounded rifleman helmet; narrower MBT tracks/hull; tapered MBT
  turret and repositioned turret details.
- `tests/unit-scale.test.ts` — added the MBT hull-ratio and turret-width check; existing scale,
  leg, hardpoint and shadow tests retained.
- `tests/repair-medic.test.ts` — replaced the obsolete medic visual-inflation expectation with the
  shared scale assertion.
- `docs/visual-audit/p6/*.png` — the captures listed in §6.
- This document and the Phase 6 appendix in `docs/VISUAL_AUDIT_PHASE_1.md`.

**Phase conclusion:** the shared scale path is coherent for the three representative models; the
perceived “infantry and tank are too similar” problem was a wide, square tank hull plus blocky
infantry forms rather than an unexplained global scale multiplier. The three models now read as a
soldier, a specialist carrying a long launcher, and a full-size tracked vehicle. The next smallest
justified step is the still-pending independent readability panel, not a roster-wide conversion.
