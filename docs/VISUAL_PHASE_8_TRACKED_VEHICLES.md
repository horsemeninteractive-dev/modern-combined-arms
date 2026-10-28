# Visual Phase 8 — Legacy Tracked Vehicles and Roster Consistency

## 1. Scope and audit method

This phase brings the first legacy combat vehicles up to the Phase 6 modelling standard:
the shared **SPG**, the **Recon Vehicle**, and its national variant, the **Pathfinder**.
The **MLRS** was audited because it shares the tracked-carrier construction, then left
behaviourally and visually unchanged from its corrected Phase 8A form.

It is presentation-only. No simulation, AI, combat, economy, roster, save, fog, input or
picking code was changed.

The audit read the actual source rather than the previous summaries:

- `src/data/units.ts` — the real 19-unit roster and national variants.
- `src/render/unitMeshes.ts` — all builders, shared helpers, visual scales, shadow footprints
  and banner anchors.
- `src/render/renderer.ts` — body/turret submission and unit draw path.
- `src/render/unitTransform.ts` — turret and limb matrices.
- `docs/VISUAL_AUDIT_PHASE_1.md` and `docs/VISUAL_PHASE_6_SCALE_AND_PROPORTIONS.md` — the
  scale reference and the recorded P0/P1 findings.
- Phase 4/5 captures and the Phase 6 comparison frames.
- The deterministic Kestrel Bay probe and the unit showroom.

## 2. Roster inventory

There are **14 shared units** and **5 national variants** implemented.

| Unit | Builder | Shared dependency | Visual scale | Banner | Status |
| --- | --- | --- | ---: | ---: | --- |
| `engineer` | `buildEngineer` | — | 0.75 | default 5 | P1: legacy support vehicle, old anchor |
| `rifle` | `buildRifle` | infantry legs | 1.00 | 1.35 | Phase 6 reference |
| `atgm` | `buildAtgm` | infantry legs | 1.00 | 1.45 | Phase 6 reference |
| `medic` | `buildMedic` | infantry legs | 1.00 | 1.30 | Phase 6 reference |
| `tank` | `buildMbtBody` / `buildMbtTurret` | — | 1.00 | 1.55 | Phase 6 reference |
| `spg` | **`buildSpgBody` / `buildSpgTurret`** | `addTrackedRunningGear` | **1.00** | **2.20** | Reworked here |
| `recon` | **`buildRecon` / `buildReconTurret`** | `RECON_BODY` | **1.00** | **2.00** | Reworked here |
| `aa` | `buildAA` / `buildAATurret` | — | 0.78 | default 5 | P1: legacy box, old anchor |
| `recovery` | `buildRecovery` | — | 0.76 | default 5 | P1: support vehicle, old anchor |
| `harvester` | `buildHarvester` / load | — | 0.70 | default 5 | P1: economy vehicle, old anchor |
| `fighter` | `buildFighter` | — | 0.85 | default 5 | P1/P2: airframe, old anchor |
| `interceptor` | `buildInterceptor` | — | 0.84 | default 5 | P1/P2: airframe, old anchor |
| `uav` | `buildUav` | `buildUav` | 0.90 | default 5 | P2: air, team-marked |
| `corvette` | `buildCorvetteBody` / Turret | — | 0.42 | default 5 | P1: naval silhouette, old anchor |
| `pathfinder` | **`RECON_BODY`** | shared with `recon` | **1.00** | **2.00** | Reworked here |
| `spearhead` | `buildTankBody` / `buildTankTurret` | legacy tank hull | 0.78 | default 5 | **P0 follow-up: last user of the old near-square hull** |
| `mlrs` | `buildMlrsBody` / `buildMlrsLauncher` | `addTrackedRunningGear` | 1.00 | 2.35 | Phase 8A; verified unchanged |
| `heavyHowitzer` | `buildHeavyHowitzerBody` / Turret | `addArtilleryRunningGear` | 1.00 | 2.35 | Dedicated artillery |
| `deepReconUAV` | `buildUav` | shared with `uav` | 1.00 | default 5 | P2: air, team-marked |

### P0 findings fixed

- The old SPG used `buildTankBody()` at **0.70**, giving a **3.29 × 2.39** world hull
  (roughly 1.38:1) — almost square, and wider than the reworked MBT.
- The old Recon was a **3.4 × 2.0** box with four oversized wheels and a flat olive roof slab.
- Both SPG and Recon/Pather used the default **5 world-unit** health-bar anchor, far above their
  roofs.

### P1/P2 findings recorded, not changed

- `spearhead` is now the only remaining user of the legacy near-square tank hull. It is a separate
  national variant and needs its own identity pass rather than being silently folded into the MBT.
- `engineer`, `recovery`, `harvester`, `aa` and `corvette` remain legacy silhouettes with old
  default anchors.
- Aircraft lack custom banner anchors.
- All meshes remain untextured vertex-coloured geometry; no UV/material pipeline exists.

## 3. Shared-geometry decisions

### New shared tracked gear

`addTrackedRunningGear()` now owns the track construction used by both the MLRS and the SPG:
separate lower and return belts, track shoes, road wheels on swing arms, front sprocket, rear
idler, fenders and mudflaps. The dimensions are parameters, so the two vehicles do not have to
share proportions.

The MLRS call was migrated to the shared helper with its previous dimensions. Its triangle count
and captures are unchanged.

### SPG separation

The SPG no longer uses `buildTankBody()`. It has a dedicated `buildSpgBody()` with a long,
narrow tracked chassis, engine-forward deck, driver's station, rear spade and outriggers. Its
`buildSpgTurret()` is a faceted 155 mm casemate with a fixed mantlet, recoil cylinders, bore
evacuator, muzzle brake and a local 2.60 tube tip. The turret mount offset is `[-0.30, 0.95, 0]`,
so the tip lands on the authored **2.30 / 1.30** hardpoint.

This deliberately leaves `buildTankBody()` and `buildTankTurret()` untouched for the Spearhead.

### Shared scout hull

The Recon and Pathfinder now use the same `RECON_BODY` instance. The Pathfinder has no turret;
its rear optics mast remains visible, which is its role cue. The armed Recon keeps its low
autocannon turret. This avoids two nearly identical scout meshes drifting apart while preserving
the armed/unarmed distinction.

### MLRS

The MLRS has no shared legacy hull or turret. Its Phase 8A geometry was retained. The shared
tracked-gear refactor preserved its previous body and launcher triangle counts (3,044 + 1,962).

## 4. Model changes

### SPG

- Track envelope **4.42 × 1.74** world (including brush bar and rear spade) at 1:1, giving a long
  artillery profile instead of the old 1.38:1 box.
- Six road wheels, front sprocket, rear idler, separate track runs and mudflaps.
- Sloped glacis, engine deck, driver's hatch, vision blocks, headlights, brush bar, side stowage,
  pioneer tools, rear spade, outriggers, taillights and tow points.
- Tall faceted casemate with sloped front plate, recoil cylinders, bore evacuator and muzzle brake.
- Team panels on both hull flanks and the casemate sides.
- Turret traverse remains the existing simulation contract; the gun tip is on the authored
  hardpoint.

### Recon / Pathfinder

- New four-wheel scout hull, **3.26 × 1.65** world, with visible wheels, hubs, fenders, sloped
  glacis, front cab, framed windscreen, side doors, mirrors, brush bar, spare wheel and stowage.
- Rear optics mast with sensor head and two glazing faces; shared by both variants.
- Armed Recon: low autocannon turret with slim 25 mm tube, muzzle brake, sight head, hatch,
  smoke dischargers and team panel. Tip lands on the authored **1.25 / 1.20** hardpoint.
- Unarmed Pathfinder: same hull and mast, no turret. Its roof is intentionally cleaner so the
  mast reads as the primary sensor.

## 5. Presentation anchors

Anchors were changed separately from geometry:

- `spg`: **5 → 2.20**
- `recon`: **5 → 2.00**
- `pathfinder`: **5 → 2.00**

These clear the new turret/casemate and mast without the old five-unit float. Picking radii,
selection rules, ring placement and overlay semantics are unchanged. The close overlay capture
shows bars just above the roof/mast and rings still centred on the units.

## 6. Captures

All new captures are in `docs/visual-audit/p8/`, 1061 × 734 CSS / 954 × 660 buffer / DPR 0.9,
clear Kestrel grass, fixed lighting, no fog, tick 0.

| Vehicle | Close | Side | Four orientations | Battle-like (22) |
| --- | --- | --- | --- | --- |
| SPG | `spg-01-close.png` | `spg-02-side.png` | `spg-04-orientations.png` | `spg-03-battle.png` |
| Recon | `recon-01-close.png` | `recon-02-side.png` | `recon-04-orientations.png` | `recon-03-battle.png` |
| Pathfinder | `pathfinder-01-close.png` | `pathfinder-03-side.png` | shares Recon body | `pathfinder-02-battle.png` |

Scale and overlay evidence:

- `roster-comparison-overlay.png` — MBT, SPG, Recon, Pathfinder and two infantry at zoom 16 with
  selection rings and health bars.
- `roster-comparison-battle36.png` — the same composition at the actual opening battle zoom 36.
- `anchors-close.png` — close overlay check for SPG, Recon, Pathfinder and MBT.
- `mlrs-00-gear-check.png` — MLRS after the shared tracked-gear refactor; compare with
  `docs/visual-audit/p8a/p8a-mlrs-cab-pass-05.png`.

Direct before/after comparison:

- SPG before: `docs/visual-audit/p6/p6-scale-with-existing-spg.png` (MBT beside the legacy SPG).
- SPG after: `spg-01-close.png`, `spg-04-orientations.png`.
- No matched pre-change Recon capture existed in the repository. The old Recon state is recorded
  in the Phase 6 audit and in the source diff; no “before” image is claimed.

There is no neutral/silhouette-only render mode in the renderer. The four-orientation frames and
the normal-colour close views are the available substitute; no silhouette-only result is claimed.

## 7. Measurements

### Mesh cost

| Model | Before triangles | After triangles | Draws before → after |
| --- | ---: | ---: | ---: |
| `spg` body + turret | 492 | **2,730** (2,226 + 504) | 2 → 2 |
| `recon` body + turret | 384 | **1,416** (1,126 + 290) | 2 → 2 |
| `pathfinder` body | 340 | **1,126** | 1 → 1 |
| `mlrs` body + launcher | 5,006 | **5,006** | 2 → 2 |
| `tank` body + turret | 1,510 | **1,510** | 2 → 2 |
| `spearhead` body + turret | 492 | **492** | 2 → 2 |

The increase is geometry inside the existing body and turret buffers; there are no new
per-part submissions. The old SPG and Recon counts are reconstructed from the builders recorded
in Phase 6 and the pre-change source. They are mesh triangle counts, not GPU timings.

### Scale path

- `spg`: visual scale **0.70 → 1.00**
- `recon`: **0.78 → 1.00**
- `pathfinder`: **0.70 → 1.00**

The new meshes are authored at 1:1 in world units, matching the MBT convention. Collision radii
and movement scale are untouched. The collision radii remain larger than the visual footprints,
as before.

| Model | World envelope (X × Y × Z) | At 2 m/unit |
| --- | --- | --- |
| SPG body | 4.42 × 1.14 × 1.74 | 8.8 × 2.3 × 3.5 m |
| SPG casemate + tube | 4.16 × 1.05 × 1.36 | overall height ≈ 2.02 |
| Recon body | 3.26 × 1.79 × 1.65 | 6.5 × 3.6 × 3.3 m |
| Recon turret | 1.71 × 0.57 × 0.92 | tip at 1.25 / 1.20 |
| MLRS | 6.03 × 2.26 × 1.94 | unchanged Phase 8A envelope |

### Runtime

- Kestrel opening probe: **30 draw calls / 80,584 triangles**, identical to Phase 6/8A.
- Tick-0 `stateHash()` prefix: `t=0|r=773311|v=playing|p0:3000.00:180.00...` — unchanged.
- Six-unit showroom + seven scenario structures: **33 draw calls / 84,956 triangles**,
  0.77 ms CPU submission (single sample, includes all fixed passes).
- Opening probe CPU submission: **0.31 ms** (single sample). No GPU timing was captured and no
  mobile claim is made.

## 8. Validation

- Focused mesh/renderer suites: `unit-scale`, `artillery-identity`, `presentation`,
  `weapon-transform` — **68/68 pass**.
- Full suite: **48 files, 525/525 tests pass**.
- Typecheck: clean.
- Production build: clean; JS **484.86 kB / 143.46 kB gzip**.
- Difficulty contract unchanged: Recruit–Veteran **−50,005** (4–12);
  Elite–Recruit **86,251** (15–1); Elite–Veteran **36,531** (11–5).
- Hardpoints: SPG turret tip after mount offset **2.30 / 1.30**; Recon **1.25 / 1.20**.
  Existing weapon-transform and presentation tests pass.
- Team marking: every unit in `UNITS` still has at least one masked surface ≥ 0.5.
- Determinism/save/fog tests: all pass; no fog, save or simulation code was touched.
- SPG no longer shares the legacy tank hull; Spearhead still does, and is unchanged.
- MLRS body and launcher triangle counts are unchanged after adopting the shared track helper.

## 9. Remaining issues and next batch

- **No six-reviewer readability panel was run.** These are developer inspections and automated
  geometry checks. The Phase 5 ≥90 % criterion has not been extended to these models.
- **Spearhead remains P0.** It is the last user of the old near-square tank hull, at 0.78 scale
  with the default five-unit anchor. It needs a dedicated national-variant pass on the MBT
  standard; it was outside the named SPG/Recon/MLRS batch.
- **Support and naval vehicles remain P1.** Engineer, recovery, harvester, AA and corvette still
  use legacy proportions and default anchors.
- **Aircraft remain P2.** No custom banner anchors; no airframe pass.
- No neutral/silhouette-only mode exists.
- No matched pre-change Recon capture exists.
- The 163-entity stress target and mobile/GPU validation remain unresolved.

**Next batch:** the **Spearhead MBT**, because it is the last vehicle on the legacy tank hull and
therefore the largest remaining P0/roster-consistency gap. Keep its Polish identity through a
distinct turret/equipment treatment rather than copying the shared MBT.

## 10. Files changed

- `src/render/unitMeshes.ts` — shared tracked gear; new SPG body/turret; new shared Recon body;
  new Recon turret; scale, shadow and banner tables; shared RECON_BODY instance.
- `tests/unit-scale.test.ts` — SPG/legacy-hull separation, hardpoint and anchor checks; shared
  Recon/Pathfinder hull and role-cue checks.
- `tests/artillery-identity.test.ts` — explicit separation from the SPG and MBT meshes.
- `docs/VISUAL_PHASE_8_TRACKED_VEHICLES.md` — this report.
- `docs/visual-audit/p8/*.png` — capture set.
