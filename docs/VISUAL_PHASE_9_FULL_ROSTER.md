# Visual Phase 9 — Remaining Unit Roster Pass

## 1. Scope

This pass finishes the **unit** roster, excluding buildings. It covers the ten
models that still used legacy geometry, legacy presentation scales or the default
five-unit overlay anchor:

`engineer`, `spearhead`, `aa`, `recovery`, `harvester`, `fighter`,
`interceptor`, `uav`, `deepReconUAV`, `corvette`.

The Phase 6 rifleman, ATGM gunner and MBT, and the Phase 8 SPG, Recon, Pathfinder
and both artillery carriers, were used as the reference standard and were not
reworked again.

No simulation, AI, combat, economy, roster, save, fog, input or picking code was
changed. The only non-model code changes are the shared airborne-altitude
constant used by the renderer and overlay, and dev-only capture tooling.

## 2. Audit findings

| Unit | Legacy state | Inherited problem | New identity |
| --- | --- | --- | --- |
| `engineer` | scaled 0.75, single-box carrier | no readable dozer or crane; default anchor | tracked carrier with full-width blade, A-frame crane, winch and roof panels |
| `spearhead` | 0.78, last user of `buildTankBody` / `buildTankTurret` | old square hull, toy proportions | shared MBT hull plus unique wedge-armour turret, long gun and remote sight |
| `aa` | 0.78, one box with two tubes | launcher read as a tank turret | three-axle wheeled carrier, four-cell SAM pack, fixed radar mast |
| `recovery` | 0.76, four wheels and a slab | crane was a floating stick; default anchor | six-road-wheel tracked carrier, heavy A-frame, outriggers, spade and winch |
| `harvester` | 0.70, oversized track boxes and square hopper | hopper appeared to float; no structural bed | long tracked chassis, cutting drum, supported high-wall hopper and cargo fit |
| `fighter` | 0.85, one fuselage bar and two flat wings | low detail, no fuselage taper | tapered nose, cockpit, intakes, swept wings, canted tails, twin nozzles, pylons and missiles |
| `interceptor` | 0.84, near-identical construction | not distinct from strike fighter | clean delta, pointed nose, single canted fin, ventral intake and slim missiles |
| `uav` | 0.90 | no distinct variant identity | straight-wing prop drone with twin booms and sensor ball |
| `deepReconUAV` | shared `buildUav` mesh at 1.0 | identical to baseline UAV | wider 8.4-unit wing, twin pusher props, satcom fairing and larger sensor |
| `corvette` | 0.42, 12.5-unit block hull | ship read as a floating slab | flared hull, forecastle, bridge, funnel, mast, deck gun and two three-cell missile racks |

The Spearhead was the last consumer of the legacy tank hull. `buildTankBody()`
and `buildTankTurret()` were removed; the Spearhead now shares the validated MBT
hull as a genuine common component and carries a separate turret.

## 3. Shared conventions

- Every unit except the corvette is authored at **1:1 world scale**.
- The corvette keeps a **0.70** presentation multiplier because its hull is
  authored around a shipyard slip; its final envelope is 7.82 × 2.55 × 1.53
  world units.
- All models use the existing `+X` forward convention, ground-contact origin and
  body/turret transform path.
- No new draw submissions were added for body parts. A unit is still one body
  draw plus one turret draw where it has a turret, and one cargo draw when a
  harvester is carrying ore.
- Selection rings, picking radii, collision radii, muzzle hardpoints and weapon
  behaviour are unchanged.

### Team identification

Every new model carries at least one broad, masked surface, not only a thin trim
strip:

- blue/orange roof panels on engineer, recovery and harvester;
- the Spearhead turret roof;
- the AA cab roof and a retaining band across the missile pack;
- wing panels on both aircraft and both drones;
- the corvette forecastle and deck-gun roof.

The matched lineup captures show both ownership colours on the same frame.

### Airborne overlay alignment

The live renderer used altitude **13**, the overlay also used 13 but ignored
whether an aircraft was landed, and the scenario-preview path used 9. A parked
aircraft was therefore drawn on the ground while its ring and health bar floated
at 13, and preview aircraft sat at a different altitude from live ones.

`AIR_UNIT_ALTITUDE = 13` is now shared by the renderer, scenario preview and
overlay. The overlay uses altitude 0 for a landed aircraft. This is
presentation-only; simulation projectile heights and aircraft rules are
unchanged.

## 4. Files

- `src/render/unitMeshes.ts` — ten builders, scale table, shadow footprints,
  banner anchors and `AIR_UNIT_ALTITUDE`.
- `src/render/renderer.ts` — shared altitude constant in place of the local
  aircraft / scenario-preview values.
- `src/ui/overlay.ts` — airborne selection ring and health-bar altitude follow
  the shared constant and the landed state.
- `tests/roster-visual-pass.test.ts` — scale, anchor, team-mask, hardpoint,
  variant-separation and cargo-fit regressions.
- `tools/roster-lineup.js` — deterministic four-column lineup probe for this
  pass and later roster reviews.
- `tools/unit-probe.js` — single-unit capture now supports a one-unit frame,
  water placement and a forced airborne pose.
- `docs/visual-audit/p9/` — captures listed below.

## 5. Model measurements

| Unit | Triangles | Draws | Body envelope (X × Y × Z) |
| --- | ---: | ---: | --- |
| Engineer | 2,378 | 1 | 4.83 × 2.48 × 2.48 |
| Spearhead | 1,538 (1,068 body + 470 turret) | 2 | 3.56 × 0.99 × 1.83 hull |
| AA | 1,634 (1,250 + 384) | 2 | 3.85 × 2.14 × 1.77 |
| Recovery | 2,426 | 1 | 4.86 × 2.83 × 2.22 |
| Harvester | 2,620 (2,596 + 24 cargo) | 2 loaded, 1 empty | 5.72 × 2.93 × 2.63 |
| Fighter | 590 | 1 | 6.17 × 1.59 × 7.42 |
| Interceptor | 330 | 1 | 6.52 × 1.75 × 5.60 |
| UAV | 432 | 1 | 3.99 × 1.28 × 6.30 |
| Deep Recon UAV | 584 | 1 | 4.76 × 1.27 × 8.40 |
| Corvette | 1,284 (1,042 + 242) | 2 | 11.17 × 3.64 × 2.19 local; 7.82 × 2.55 × 1.53 at 0.70 |

The last recorded pre-pass count is the Spearhead at **492** triangles; it is
now 1,538 because the MBT hull and the unique turret replace the old near-square
pair. Previous counts for the other nine builders were not recorded as exact
numbers, so no reconstructed before/after claim is made for them.

### Hardpoints

- Spearhead gun tip: **2.20 / 1.20** — unchanged.
- AA missile tip: **1.80 / 1.39** — unchanged.
- Corvette deck gun tip: **3.00 / 0.90** — unchanged.
- Harvester cargo: local Y 0…1.11, now inside the hopper walls.
- Engineer and Recovery are unarmed and have no turret mesh.

## 6. Captures

All frames are **955 × 661 CSS/buffer, DPR 1**, clear Kestrel grass or harbour
water, no fog, frozen tick 0, day lighting.

| Evidence | Path |
| --- | --- |
| All ten land/support units at battle-like zoom 18 | `docs/visual-audit/p9/land-roster-lineup.png` |
| The same line at actual opening battle zoom 36 | `docs/visual-audit/p9/land-roster-battle36.png` |
| Air roster at zoom 26, both teams | `docs/visual-audit/p9/air-roster-lineup.png` |
| Engineer close | `docs/visual-audit/p9/engineer-close.png` |
| Spearhead close | `docs/visual-audit/p9/spearhead-close.png` |
| AA close | `docs/visual-audit/p9/aa-close.png` |
| Recovery close | `docs/visual-audit/p9/recovery-close.png` |
| Harvester close | `docs/visual-audit/p9/harvester-close.png` |
| Fighter close, airborne | `docs/visual-audit/p9/fighter-close.png` |
| Interceptor close, airborne | `docs/visual-audit/p9/interceptor-close.png` |
| UAV close, airborne | `docs/visual-audit/p9/uav-close.png` |
| Deep Recon UAV close, airborne | `docs/visual-audit/p9/deepReconUAV-close.png` |
| Corvette close, harbour water | `docs/visual-audit/p9/corvette-close.png` |

The land lineup alternates owners so team colour is visible on both blue and
orange vehicles. The close frames include the normal selection ring and health
bar.

## 7. Runtime and regression

- Opening Kestrel probe: **30 draw calls**, **82,818 triangles**, **0.56 ms** CPU
  submission (one sample). Before this pass it was 30 / 80,584 / 0.31 ms; the
  extra 2,234 triangles include the new engineer mesh and no extra draw call.
  The two CPU figures are single samples, so no performance claim is made from
  them.
- Tick-0 `stateHash()` prefix is unchanged:
  `t=0|r=773311|v=playing|...`.
- Selection and picking radii are untouched.
- Fog texture bindings, road-fog behaviour, terrain materials and time-of-day
  presets were not edited.
- Typecheck: clean.
- Full suite: **49 files, 532/532 tests pass**.
- Production build: clean; JS **495.92 kB / 146.29 kB gzip**.
- Difficulty contract unchanged: Recruit–Veteran **−50,005** (4–12),
  Elite–Recruit **86,251** (15–1), Elite–Veteran **36,531** (11–5).

## 8. Remaining limitations

- **No six-reviewer readability panel** was run for these ten models. The
  evidence is developer inspection plus automated geometry checks. The Phase 5
  ≥90 % criterion has not been extended to this batch.
- No neutral/silhouette-only render mode exists. The model captures always include
  the normal terrain and team colours.
- This pass captured close and lineup views, not a four-orientation contact sheet
  for every model. The eight custom turret/hull orientations were checked in
  source and hardpoint tests, but not all were separately photographed.
- The corvette is photographed in the harbour because it cannot sit on grass.
- No mobile or GPU timing was measured. CPU submission figures are desktop,
  single-sample.
- Aircraft are still simpler meshes than the support vehicles (330–590 triangles
  against 1,500–2,600). They are role-readable at battle zoom, but the air family
  is the obvious candidate for a later secondary-detail pass.
- `AIR_UNIT_ALTITUDE` is a visual constant and remains numerically separate from
  the simulation's aircraft altitude. Both are 13; the renderer does not import
  simulation code.

## 9. Next

The unit roster is now covered. The next visual batch should be **buildings**,
which this request explicitly excluded. Before expanding the roster again, a
blinded readability review of the support and air units would establish whether
the new silhouettes meet the same bar as the Phase 5 MBT test.
