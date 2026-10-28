# Visual Phase 8A — Rocket Artillery and Heavy Howitzer Identity

## 1. Scope and baseline

This phase replaced the shared tank-like upper structures on the British **Rocket Battery**
(`mlrs`) and Russian **Heavy Howitzer** (`heavyHowitzer`) with dedicated artillery silhouettes.
It is presentation-only: no simulation, AI, combat, economy, roster, save or fog changes.

Both units previously used the legacy SPG recipe:

- `mlrs`: `buildTankBody()` + `buildSpgTurret()`, visual scale **0.72**
- `heavyHowitzer`: `buildTankBody()` + `buildSpgTurret()`, visual scale **0.76**

They therefore shared one low, near-square hull and one casemate with a long gun. The difference
between the two national units was almost entirely a tint and a scale multiplier. That is the
source of the “reads like a tank” problem, not a shortage of small details.

The M270 reference material shows two distinct states:

- **Travelling:** the launcher pack is **flat**, sitting on the rear deck, and its roof is level
  with the cab roof. The pack is not permanently elevated.
- **Deployed:** the pack is raised on its rear hinge and yawed toward the firing bearing. It only
  rises while the battery is laying on a target.

The first pass got the flat/deployed distinction right but left the cab cantilevered beyond the
rear-deck-only running gear, and the cab was noticeably taller than the pack. The correction
below fixes both, and brings the model up to the detail and ownership-marking standard of the
reworked MBT.

## 2. What changed

Files changed:

- [`src/render/unitMeshes.ts`](../src/render/unitMeshes.ts)
- [`src/render/unitTransform.ts`](../src/render/unitTransform.ts)
- [`src/render/renderer.ts`](../src/render/renderer.ts)
- [`tests/artillery-identity.test.ts`](../tests/artillery-identity.test.ts)
- [`tests/unit-scale.test.ts`](../tests/unit-scale.test.ts)

No shared legacy mesh was edited. `buildTankBody()`, `buildTankTurret()`, `buildSpgTurret()`,
`buildMbtBody()` and `buildMbtTurret()` remain the geometry used by `spg`, `spearhead`, `tank`
and the other legacy vehicles.

### British Rocket Battery — corrected chassis and cab

- Dedicated `addRocketCarrierGear()`: the track run now starts at local X **−2.04** and ends at
  **+3.54**, under the cab and level with the front bumper. Six road wheels, a front sprocket,
  rear idler, separate lower/return track belts, track shoes, fenders and mudflaps are visible.
- The cab is a three-ring faceted shell with a raked windscreen and slightly tapered sides, not a
  single upright box. It meets the forward hull/deck and sits over the front track section.
- Cab roof and stowed pack are **level** (roof envelope approximately **2.04**, pack envelope
  approximately **2.08** including its sight; the thin antenna is excluded).
- The front face has layered glazing, wipers, framed side windows and doors, mirrors, steps,
  headlights, blackout markers, a bumper and a brush bar.
- The rear has stabilising spades, taillights, tow points, a cable reel, stowage and pioneer tools.

### British Rocket Battery — launcher

- The pack is a **bevelled prism** rather than a raw box: flanks lean in at the shoulder and the
  front/rear faces carry the same chamfer.
- Side frame rails, seven vertical ribs, panel seams, tie-down lugs, warning patches, top
  stiffeners, access covers and lifting lugs break up the long flat surfaces.
- Six 227 mm cells sit in two rows of three. The tube rims finish on the authored **2.30**
  hardpoint.
- The pack remains a separate moving part. `launcherPivot` at **[-1.35, 1.14, 0]** and
  `launcherElevation` of **0.42 rad (24°)** raise it only while the battery has a target.
- `VisualEntity.elevation` eases from 0 to 1 when `aimTargetId` is set or the unit is attacking,
  then back to 0. This remains render-only.

### Ownership markings

Team colour was previously absent from the Rocket Battery and Heavy Howitzer, and the UAV family
had no team-marked geometry at all. All units now carry at least one team-masked surface:

- MLRS: cab doors, roof strip, pack side bands, pack roof panel and rear plate.
- Heavy Howitzer: engine-deck bands, gun-house flank panels and roof strip.
- UAV / deep-recon UAV: painted upper-wing panels.
- Existing markings on the other units are unchanged.

A regression test now checks that every unit in `UNITS` has a team-mask value of at least 0.5 on
its body or turret. This is geometry, not a renderer-only overlay, so it survives fog, thumbnails
and all time-of-day presets.

### Russian Heavy Howitzer

- Dedicated `buildHeavyHowitzerBody()`: engine-forward deck, driver's cab, six road wheels,
  rear spade and outriggers.
- Dedicated `buildHeavyHowitzerTurret()`: tall slab-sided gun house, sloped front plate, heavy
  breech, recoil cylinders and a 203 mm tube.
- The tube finishes at the authored **2.40** hardpoint; existing turret traverse is used.
- Visual scale is **1.0**; health-bar anchor is **2.35**.

### Shared conventions

- Mesh nose remains local **+X**, right side **+Z**, ground contact at local **Y = 0**.
- Each vehicle still submits **one body draw plus one turret draw** per entity.
- No new textures, UVs, materials or runtime dependencies were introduced.

## 3. Measurements

### Mesh cost

| Mesh | Triangles | Draw submissions |
| --- | ---: | ---: |
| Legacy `spg` body + turret (pre-8A recipe) | 492 | 2 |
| `heavyHowitzer` body + turret (with team panels) | 1,128 | 2 |
| `mlrs` body + launcher, before cab correction | 1,570 | 2 |
| **`mlrs` body + launcher, corrected** | **5,006** | **2** |
| Reference `tank` body + turret (not changed) | 1,510 | 2 |

The corrected MLRS adds **+3,436 triangles** over the first 8A pass but still uses the same two
draw submissions. Most of the increase is launcher frame/rib geometry, full-length running gear
and the layered cab; it does not add a per-part draw.

### World-space bounds (before visual scale)

| Unit | Body envelope (X × Y × Z) | Launcher envelope |
| --- | --- | --- |
| `mlrs` stowed | **6.03 × 2.26 × 1.94** | 3.84 × 1.11 × 1.75; rim tip at **2.30**, top ≈ 2.08 |
| `heavyHowitzer` | 4.47 × 1.19 × 2.0 | 4.10 × 1.37 (plus 0.85 mount) |

The MLRS body envelope includes the antenna, mirrors, brush bar and rear spades; the cab roof and
stowed pack themselves are level.

### Kestrel Bay opening probe

Same probe, camera, fog and tick-0 state as the Phase 6 baseline:

| Metric | Phase 6 baseline | Corrected 8A |
| --- | ---: | ---: |
| Draw calls | 30 | **30** |
| Triangles | 80,584 | **80,584** |
| CPU submission | 0.67 ms | **1.14 ms (one sample)** |
| Tick-0 `stateHash()` prefix | `t=0\|r=773311\|v=playing\|p0:3000.00:180.00...` | **identical** |
| Fog view | — | **475 visible / 0 charted / 1,595 hidden** |

The opening Kestrel scenario contains no `mlrs` or `heavyHowitzer`, so its draw and triangle
counts cannot change from this work. The CPU figure is a single submission sample, not a GPU
timing and not a stable cost claim.

The 163-entity stress target remains unresolved. The corrected model is materially heavier per
vehicle; a full 163-unit stress rerun with these units was not performed.

## 4. Capture set

All captures use the deterministic unit showroom at 1061 × 734 CSS (954 × 660 buffer, DPR 0.9),
clear Kestrel grass, fixed lighting and no fog. Two copies are shown where ownership is the point.

**Before (shared SPG mesh):**

- [Old close view](visual-audit/p8a/p8a-before-shared-close.png)
- [Old battle zoom](visual-audit/p8a/p8a-before-shared-zoom22.png)

**Corrected Rocket Battery:**

- [Stowed 3/4 close](visual-audit/p8a/p8a-mlrs-cab-pass-05.png)
- [Stowed side profile](visual-audit/p8a/p8a-mlrs-cab-pass-08-side-final.png)
- [Deployed, rear-hinged and yawed](visual-audit/p8a/p8a-mlrs-cab-pass-07-deployed.png)
- [Battle zoom with friendly and enemy ownership markings](visual-audit/p8a/p8a-mlrs-cab-pass-06-battle.png)

**Heavy Howitzer (geometry unchanged, now team-marked):**

- [Close 3/4 with ownership panels](visual-audit/p8a/p8a-heavy-team-marking.png)

## 5. Findings

- **Cab support:** the front track now extends under the cab to the bumper. The old visual gap
  below the cab is gone.
- **Height relationship:** the cab roof and flat pack are level within a few centimetres. The
  pack only rises when deployed.
- **Detail level:** camo panels, ribs, glazing frames, running gear, stowage and deck fittings put
  the Rocket Battery in the same visual band as the reworked MBT, without adding draw calls.
- **Ownership:** friendly and enemy carriers are distinguishable at battle zoom by painted
  surfaces on the cab, pack flank and pack roof — not only by the selection ring or flag.
- **Battle-zoom readability:** the six cells are clear when deployed and in close views. At the
  widest gameplay zoom the vehicle still reads primarily as a long launcher pack, and individual
  tube mouths are below pixel resolution. That is an LOD/resolution limit, not a hardpoint error.

### Known visual dependency

The authored MLRS hardpoint remains **2.30 forward / 1.30 high**. At full deployment the visible
bores rise above 1.30, while the projectile and muzzle flash still originate at the authored
hardpoint. Exact launch-point alignment during deployment would require a simulation-aware muzzle
offset and was deliberately not changed in this visual phase. The flat/stowed pose keeps the
lower cell row at 1.30.

## 6. Validation

- Focused mesh suites: `tests/artillery-identity.test.ts` and `tests/unit-scale.test.ts`,
  **17/17 pass**.
- Full suite: **48 files, 523/523 tests pass**.
- Typecheck: clean.
- Production build: clean (`tsc --noEmit`, Vite build, service-worker precache).
- Tick-0 `stateHash()`: identical prefix to the Phase 6/8A baseline.
- Kestrel opening probe: **30 draw calls / 80,584 triangles**, unchanged because the scenario
  contains no MLRS.
- Difficulty ladder (unchanged by this visual work):
  - Recruit–Veteran **−50,005** (4–12)
  - Elite–Recruit **86,251** (15–1)
  - Elite–Veteran **36,531** (11–5)
- Weapon hardpoints: MLRS **2.30 / 1.30 / turreted**; howitzer **2.40 / 1.35 / turreted** —
  unchanged data and unchanged simulation path.
- Team-marking regression: every unit in `UNITS` has at least one masked surface ≥ 0.5.
- Fog integrity, selection/picking, save/determinism tests: all pass; no fog or picking code was
  touched.
- Shared-geometry checks: dedicated mesh references differ from `spg` and `tank`; legacy
  `spg`/`spearhead`/`tank`/`recon` tests are unaffected.

## 7. Limitations and next step

- No independent human readability panel was run. The conclusions above are developer
  inspection of matched captures, not a ≥90% recognition claim.
- No mobile, GPU-timing or 163-entity stress validation was performed. The CPU figure is a
  submission sample, not a frame time.
- The deployed tube face and the fixed simulation hardpoint still differ vertically.
- The corrected Rocket Battery is triangle-heavy relative to the MBT. If it becomes common in
  large late-game armies, measure the 163-entity stress scene before expanding similar detail to
  every remaining vehicle.
- The ≤250 draw-call target for 163 entities is still unresolved and was not attempted here.

**Recommended next unit family:** the APC/IFV family, after the same shared-geometry audit used
here. It is the largest remaining group of legacy vehicle silhouettes and should benefit from the
established world-scale, component-proportion and team-marking conventions without touching
simulation.
