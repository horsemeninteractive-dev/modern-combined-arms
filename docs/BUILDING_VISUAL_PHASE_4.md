# MCA — Building Visual Phase 4: Defensive and Captured-Objective Identity

**Status:** implementation complete; automated verification green; independent human
recognition and ownership recognition tests **not performed**. Visual acceptance is
therefore **open**, not claimed.

Source audit: [BUILDING_VISUAL_ROSTER_AUDIT.md](BUILDING_VISUAL_ROSTER_AUDIT.md).
The audit and its before-captures were retained unchanged.

## 1. Scope and working tree

The phase implemented the four approved identities and the two shared corrections:

| Scope | Building / system | Result |
|---|---|---|
| A | `atTurret` — Anti-Tank Gun | Weapon-forward anti-armour emplacement |
| A | `coastalBattery` — Coastal Battery | Raised twin-rail fixed anti-ship launcher |
| B | `radarStation` — Radar Station | Operations block, tower, swept array, body ownership plate |
| B | `relay` — Signals Relay | Communications cabin, lattice mast, secondary dish, body ownership plate |
| C | Shared glass classification | Shaded dark glazing remains glass; genuine dark track remains track |
| D | Flag anchors | `radarStation` and `foundryWorks` corrected; 22-building scan passes |

No other building was remodelled. `src/data/buildings.ts`, capture/garrison rules,
weapons, health, armour, footprints, collision, pathfinding, picking, economy,
vision, save schemas and victory logic were not changed.

The working tree already contained unrelated simulation, pathfinding,
unit-heading, save-migration and presentation changes. Those changes were not
reset, reverted, reformatted or staged by this phase.

## 2. Implementation by model

### 2.1 Anti-Tank Gun (`atTurret`)

The old silhouette was a low 2×2 concrete pad with a small traversing mount. The
new body keeps the footprint but reduces the visual weight of the pad and makes
the weapon the primary form:

- low concrete revetment with sandbag walls on three sides;
- distinct steel gun deck inside the revetment;
- two split trails running back to steel spades;
- ready-rack box with the ownership panel on its lid;
- shield cheeks, sight slit, pintle block and breech;
- one long barrel with muzzle brake, extending beyond the pad centre.

The result reads as a towed anti-armour gun in a prepared pit, not a generic
defensive pad. The shield and single barrel are the dominant cues; the pad is
deliberately subordinate.

Preserved: 2×2 data footprint, `atTurretGun` weapon, `turretOffset = [0, 1.3, 0]`,
existing muzzle hardpoint, construction and balance.

### 2.2 Coastal Battery (`coastalBattery`)

The old model was too close to the Anti-Tank Gun in composition. The new body
keeps the coastal requirement and establishes a different weapon system:

- low concrete deck and landward blast wall with side wing walls;
- open seaward edge, with the launcher raised above the deck;
- fire-control box with a dark sight window on the seaward edge;
- covered ready rack carrying two upright anti-ship rounds;
- rotating pedestal and turntable;
- two clearly separated launch rails on visible pylons;
- sloped blast deflector behind the rails;
- sight unit on the outer rail.

At zoom 36 the pair reads as one long anti-armour gun versus a twin-rail
anti-ship launcher. The raised rails and blast deflector define the coastal
silhouette; the pad does not.

Preserved: 2×2 data footprint, `coastalMissile` weapon, water-placement
requirement, `turretOffset = [0, 1.35, 0]`, existing hardpoint and all gameplay
data.

### 2.3 Radar Station (`radarStation`)

The former low shed, thin mast and small dish were replaced with a surveillance
installation whose mass is organised around the array:

- 7.2 × 3.5 × 6.8 operations block with a projecting roof slab;
- front-right roof ownership plate, placed clear of the array silhouette;
- glazed operations face and warning marker;
- stepped equipment annex with a small fixed dish;
- four-leg sensor tower with visible bracing;
- broad swept array with backing frame, horizontal stiffeners and counterweight.

The array now defines the roofline and the operations block supports it. It
remains distinct from the player-buildable `radar` Radar Array: the station is a
larger fixed facility, not a compact mast on a small base.

Preserved: 3×3 footprint, `.45 rad/s` rotor, vision/scan/capture rules and all
gameplay data.

### 2.4 Signals Relay (`relay`)

The former thin mast on a pad was replaced with a field communications node:

- 4.2 × 2.9 × 3.4 equipment cabin with glazing, door, warning plate and roof;
- integrated ownership plate on the cabin roof;
- lattice mast rising through a service platform;
- rotating uplink dish, aerial and warning beacon;
- secondary fixed dish on the cabin roof;
- generator cabinet and cable drum at ground level;
- low sandbag wall on the approach side.

The cabin provides a functional mass and the two dishes give the structure a
communications role without resembling the larger Radar Station array.

Preserved: 2×2 footprint, `1.2 rad/s` rotor, requisition rate, capture rules,
indestructible-objective behaviour and all gameplay data.

### 2.5 Captured-objective ownership

Both `relay` and `radarStation` now use the existing vertex team-mask pipeline
through `ownershipPanel()`. The bodies carry **48 team-masked vertices each**.
The same mask resolves through the shared ownership colour path:

- neutral owner `-1` → neutral grey;
- defender ownership `0` → owning defender faction colour;
- eastern ownership `1` → owning eastern faction colour.

Hiding the flag does not remove the body cue. Faulted/remembered states retain
the existing team mask and fog presentation; no new presentation path was added.
The Supply Depot remains the positive control and still uses the same pattern.

Ownership tint resolution was centralised in `teamColorForOwner()` so neutral
grey and owned faction colours have one source of truth shared by the renderer
and the tests. The fallback colour for an owned player with no resolved faction
identity remains the previous renderer slate; no live ownership color changed.

### 2.6 Shared glass classification

`materialForColor()` previously classified the already-shaded vertex colour and
returned `MATERIAL.track` for any value below `0.135`. Shaded `glassDark` faces
therefore became rubber. The shared fix tests neutrality before the dark-value
shortcut:

```ts
const max = Math.max(color[0], color[1], color[2]);
const min = Math.min(color[0], color[1], color[2]);
if (max < 0.135 && max - min < max * 0.2) {
  return max < 0.1 ? MATERIAL.track : MATERIAL.bareMetal;
}
```

A blue-green shaded window keeps its hue separation and falls through to the
normal chromaticity classification, so it remains glass. Genuine near-neutral
dark tracks and tyres stay `track`; dark metal edges become `bareMetal`. The Ruin
has no glass or track material assignments, so its cavities are unchanged.

Measured body track-material share:

| Building | Before | After |
|---|---:|---:|
| Tenement | 53.2% | **0.0%** |
| Office Block | 42.7% | **0.0%** |
| Ruin (negative control) | 0% | **0.0%** |

All blue-green building vertices across the roster resolve to `MATERIAL.glass`.

### 2.7 Flag and health-bar anchors

The Radar Station pole moved from the raised platform to the operations roof:

- before: `(-0.9, 3.40, -0.8)`, pole passing through the platform;
- after: `(-3.9, 4.44, -2.4)`, supported at `y = 4.42`.

The Foundry Works pole moved clear of the sawtooth roof:

- before: `(4.8, 7.60, 3.2)`, inside the roof;
- after: `(4.8, 8.76, 3.2)`, supported at `y = 8.75`.

The other anchors were re-validated against the changed geometry. The two known
P2 floats were corrected by anchor-only edits: MG Nest `1.95 → 1.67` and
Tenement `8.90 → 8.62`. The AT Gun, Coastal Battery and Relay anchors moved with
their new bodies. No model was cut to accommodate an anchor. Health bars remain
on the existing mesh-bound contract; every one clears its rendered top by
`0.45` world units.

## 3. Geometry and draw submissions

Triangle counts exclude the flag rig, matching the audit's body/combined
convention. "Combined" is body plus turret or rotor.

| Model | Body tris | Turret / rotor tris | Combined | Ceiling | Team-masked body verts | Draw submissions |
|---|---:|---:|---:|---:|---:|---|
| Anti-Tank Gun | 372 | 172 | **544** | 1,100 | 48 | body + turret + flag = 3 |
| Coastal Battery | 216 | 258 | **474** | 1,100 | 48 | body + turret + flag = 3 |
| Radar Station | 464 | 144 | **608** | 1,400 | 48 | body + rotor + flag = 3 |
| Signals Relay | 412 | 80 | **492** | 1,000 | 48 | body + rotor + flag = 3 |

All four are below their ceilings. No draw call, material pass, texture, shader,
dependency or post-processing pass was added. The existing one-body draw plus
moving-part and flag submissions is preserved.

## 4. Matched scene performance

Protocol: 1599 × 899 drawing buffer, DOM overlays cleared, five warm-up frames,
20 measured frames, CPU submission measured before `gl.finish()`. These are CPU
submission values, **not GPU time or total frame time**.

| Scene | Draw calls | Triangles | CPU submission | Comparison |
|---|---:|---:|---:|---|
| Kestrel opening, tick 0, fog on | **30** | **90,759** | 0.36 ms | audit: 30 calls / 82,818 tris / 0.21 ms |
| Foundry District, 48 buildings, zoom 30 | **103** | **153,505** | 0.76 ms | audit: 103 calls / 134,248 tris / 0.83 ms |

Draw calls are unchanged in both matched scenes. The triangle totals are higher
than the audit's comparison points. The four Phase 4 meshes account for only
`+184` triangles in the Kestrel scene (Relay) and `+584` across the two Relay and
two Radar Station instances in Foundry. The remaining scene delta is not
attributable to this phase; the working tree contains other pre-existing
presentation changes. It was not isolated by reverting unrelated work.

No shader compilation errors or unexpected console errors appeared while
capturing. The only failed network requests in the capture session were expected
aborted range requests during match-music rotation.

Per-model draw submissions are static: one body, one moving part where present,
one flag. Construction-state passes remain the existing ones.

## 5. Verification

### Commands and results

| Command | Result |
|---|---|
| `npx vitest run tests/building-phase4.test.ts tests/flags.test.ts tests/building-presentation.test.ts tests/material-pipeline.test.ts` | **4 files, 37 tests passed** |
| `npm test` | **60 files, 648 tests passed** (90.42 s) |
| `npm run typecheck` | **passed**, exit 0 |
| `npm run build` | **passed**, exit 0; Vite 8.3.5, 70 modules, 557.03 kB JS / 165.84 kB gzip, service worker precaches 13 files |

New coverage is in [tests/building-phase4.test.ts](../tests/building-phase4.test.ts):
model separation, footprint containment, mounting transforms, rotor retention,
triangle ceilings, body team-mask presence and range, neutral/defender/eastern
ownership resolution, shaded and unshaded glass classification, Tenement/Office
track shares, Ruin negative control, all-22 flag support/clearance and health-bar
clearance.

Updated coverage in [tests/building-presentation.test.ts](../tests/building-presentation.test.ts)
retains the roster-wide ownership and banner contracts.

### Determinism

No simulation, scenario, weapon, save or AI source was changed by this phase.

- Kestrel tick-zero hash prefix:
  `t=0|r=773311|v=playing|p0:3000.00:180.00:0`
  — matches the audit's recorded tick-zero prefix exactly.
- Kestrel SHA-256 fingerprint:
  `f44b9405ec5a9fb232851e951f046a8b0a7bb138272e452e3ccd1a511222d331`
  (full hash length 1919 characters).
- Foundry tick-zero hash prefix:
  `t=0|r=550211|v=playing|p0:3000.00:180.00:0`
- Foundry SHA-256 fingerprint:
  `cfc8113ee7d9ef4c6252bd446e35892c92de776741ce41de05dc02ec05462635`
  (full hash length 5372 characters).

The audit did not record a full pre-phase Foundry hash, so a byte-for-byte
before/after comparison against a stored value is not available. The full
simulation suite and save/determinism tests pass. The Kestrel prefix match is
positive evidence; the Foundry fingerprint is recorded for the next phase.

### Flag support scan — all 22 buildings

`gap = flag anchor Y − highest triangle surface at that XZ`. Positive is above
the local surface; negative is a small recess within the test tolerance.

| Building | Anchor Y | Local support | Gap | Health-bar gap |
|---|---:|---:|---:|---:|
| `commandPost` | 7.75 | 7.78 | −0.03 | 0.45 |
| `barracks` | 5.65 | 5.68 | −0.03 | 0.45 |
| `factory` | 6.55 | 6.53 | +0.02 | 0.45 |
| `refinery` | 6.05 | 6.00 | +0.05 | 0.45 |
| `airfield` | 0.45 | 0.44 | +0.01 (apron exception) | 0.45 |
| `shipyard` | 0.95 | 0.94 | +0.01 (apron exception) | 0.45 |
| `powerPlant` | 4.25 | 4.22 | +0.03 | 0.45 |
| `radar` | 3.12 | 3.05 | +0.07 | 0.45 |
| `samBattery` | 2.65 | 2.63 | +0.02 | 0.45 |
| `mgNest` | 1.67 | 1.65 | +0.02 | 0.45 |
| `atTurret` | 0.53 | 0.52 | +0.01 | 0.45 |
| `coastalBattery` | 1.61 | 1.58 | +0.03 | 0.45 |
| `relay` | 3.56 | 3.54 | +0.02 | 0.45 |
| `supplyDepot` | 3.95 | 3.90 | +0.05 | 0.45 |
| `radarStation` | 4.44 | 4.42 | +0.02 | 0.45 |
| `tenement` | 8.62 | 8.60 | +0.02 | 0.45 |
| `warehouse` | 7.15 | 7.10 | +0.05 | 0.45 |
| `officeBlock` | 12.90 | 12.85 | +0.05 | 0.45 |
| `civicHall` | 9.35 | 9.30 | +0.05 | 0.45 |
| `foundryWorks` | 8.76 | 8.75 | +0.01 | 0.45 |
| `ruin` | 3.75 | 3.70 | +0.05 | 0.45 |
| `bunker` | 3.00 | 2.98 | +0.02 | 0.45 |

Result: **22/22 supported**. The Airfield and Shipyard remain the only
intentional ground/apron mounts. No P2 floating-anchor exceptions remain; the MG
Nest and Tenement were corrected within the allowance in the phase brief.

## 6. Visual evidence

The before-images are the audit's originals and were not overwritten. The native
after-frames are in [docs/visual-audit](visual-audit/). Downscaled review copies
are aids only; native frames are the evidence.

### Defensive pair

Before: [audit-defence-pair-valid.png](visual-audit/audit-defence-pair-valid.png),
[audit-aturret-crop.png](visual-audit/audit-aturret-crop.png),
[audit-coastal-valid-crop.png](visual-audit/audit-coastal-valid-crop.png).

After:

- [phase4-defence-pair-battle-36.png](visual-audit/phase4-defence-pair-battle-36.png) — side-by-side pair at battle zoom 36.
- [phase4-defence-pair-close-18.png](visual-audit/phase4-defence-pair-close-18.png) — matched close pair.
- [phase4-defence-pair-crop-36.png](visual-audit/phase4-defence-pair-crop-36.png) — native-pixel crop.
- [phase4-at-battle-36.png](visual-audit/phase4-at-battle-36.png), [phase4-at-close-18.png](visual-audit/phase4-at-close-18.png).
- [phase4-coastal-close-18.png](visual-audit/phase4-coastal-close-18.png).
- Four orientations each: `phase4-at-facing-{000,090,180,270}-close.png` and
  `phase4-coastal-facing-{000,090,180,270}-close.png`.
- Flag-hidden silhouette review: [phase4-at-neutral-flagless-close.png](visual-audit/phase4-at-neutral-flagless-close.png),
  [phase4-coastal-neutral-flagless-close.png](visual-audit/phase4-coastal-neutral-flagless-close.png),
  [phase4-silhouettes.png](visual-audit/phase4-silhouettes.png),
  [phase4-silhouettes-review.png](visual-audit/phase4-silhouettes-review.png).

The pair capture shows the long single gun/trails against the raised twin rails
and blast deflector. The flags are visible but are not required to identify
either weapon.

### Radar Station and Signals Relay

Before: [audit-radar-station-close.png](visual-audit/audit-radar-station-close.png),
[audit-radar-station-neutral.png](visual-audit/audit-radar-station-neutral.png),
[audit-relay-close.png](visual-audit/audit-relay-close.png),
[audit-relay-neutral.png](visual-audit/audit-relay-neutral.png).

After:

- Radar Station: [neutral close](visual-audit/phase4-radar-neutral-close.png),
  [defender close](visual-audit/phase4-radar-defender-close.png),
  [eastern close](visual-audit/phase4-radar-eastern-close.png),
  [defender flagless](visual-audit/phase4-radar-defender-flagless.png),
  [eastern flagless](visual-audit/phase4-radar-eastern-flagless.png),
  [rear three-quarter](visual-audit/phase4-radar-rear-3q.png),
  [battle zoom 36 neutral](visual-audit/phase4-radar-neutral-battle-36.png),
  [battle zoom 36 defender](visual-audit/phase4-radar-defender-battle-36.png).
- Signals Relay: [neutral close](visual-audit/phase4-relay-neutral-close.png),
  [defender close](visual-audit/phase4-relay-defender-close.png),
  [eastern close](visual-audit/phase4-relay-eastern-close.png),
  [defender flagless](visual-audit/phase4-relay-defender-flagless.png),
  [eastern flagless](visual-audit/phase4-relay-eastern-flagless.png),
  [rear three-quarter](visual-audit/phase4-relay-rear-3q.png),
  [battle zoom 36 neutral](visual-audit/phase4-relay-neutral-battle-36.png),
  [battle zoom 36 eastern](visual-audit/phase4-relay-eastern-battle-36.png).

The flagless close views show the body ownership plate resolving to neutral grey
and to the defender/eastern colours. The neutral views do not carry a permanent
faction panel. The plates are integrated roof panels; at zoom 36 the Radar
Station plate is clearly visible and the Relay plate is small but present. No HUD
marker or flag is used to make the captured state work.

### Shared glazing and negative control

Before: [audit-office-close.png](visual-audit/audit-office-close.png),
[audit-tenement-flag-crop.png](visual-audit/audit-tenement-flag-crop.png).

After: [phase4-office-glazing-close.png](visual-audit/phase4-office-glazing-close.png),
[phase4-tenement-glazing-close.png](visual-audit/phase4-tenement-glazing-close.png),
[phase4-ruin-dark-control-close.png](visual-audit/phase4-ruin-dark-control-close.png).

The window bands now resolve as glass rather than matte rubber. The Ruin remains
a negative control: its dark cavities are not glass and are not track.

### Anchors

[phase4-radar-flag-anchor.png](visual-audit/phase4-radar-flag-anchor.png) shows
the Radar Station pole base on the operations roof, clear of the platform.
[phase4-foundry-flag-anchor.png](visual-audit/phase4-foundry-flag-anchor.png)
shows the Foundry pole clear of the sawtooth surface.

### Roster regression

- Full after-thumbnail sheet: [phase4-thumbnails.png](visual-audit/phase4-thumbnails.png) (3200 × 2700),
  review copy [phase4-thumbnails-small.png](visual-audit/phase4-thumbnails-small.png).
- [phase4-kestrel-opening.png](visual-audit/phase4-kestrel-opening.png) — tick-zero Kestrel opening, fog on.
- [phase4-foundry-district.png](visual-audit/phase4-foundry-district.png) — Foundry District, 48 buildings.
- [phase4-silhouettes-review.png](visual-audit/phase4-silhouettes-review.png) — objective silhouettes without flags.

The successful core, Airfield, Shipyard, Refinery, Turbine Plant, Warehouse,
Civic Hall, Bunker and urban landmarks were not re-authored. The thumbnail sheet
is the roster regression reference; the four changed models are visibly
different and the unchanged models retain their previous silhouettes.

Capture protocol: authored scenarios and the audit showroom, day/clear lighting,
fixed tick-zero simulation, renderer clock frozen, HUD/overlay hidden for
inspection frames, fog off for showroom close-ups and flagless ownership views,
fog on for the Kestrel opening, flags suppressed through the renderer's existing
draw call rather than by editing meshes. Close views use zoom 18 or 11 as
recorded by the capture helper; battle views use zoom 36. Native buffers are
1599 × 899 or the recorded crop sizes in the file list.

## 7. Acceptance status

| Criterion | Status |
|---|---|
| Four models remodelled within scope and ceilings | **Met** |
| Relay/Radar Station body ownership in neutral, defender and eastern states | **Met in geometry/material tests and authored flagless captures** |
| Shared glass classification corrected; Tenement/Office <5% track | **Met (0.0% each)** |
| Ruin and genuine dark surfaces retain their classifications | **Met** |
| Radar Station and Foundry Works anchors supported and clear | **Met** |
| All 22 flag anchors supported; apron exceptions valid | **Met** |
| Health bars ≥0.4 above rendered top | **Met (0.45)** |
| Tick-zero determinism / save compatibility | **No simulation changes; suite passes; Kestrel prefix matches audit** |
| Typecheck / full test suite / production build | **Met** |
| Matched before/after evidence at required views | **Captured** |
| Independent silhouette recognition (≥85% each, ≥90% overall) | **Not performed — unverified** |
| Independent ownership recognition (≥90%, neutral included) | **Not performed — unverified** |
| GPU or mobile performance | **Not measured** |

### Human recognition test

The phase brief requires six independent reviewers for silhouette-only images
and six independent reviewers for captured ownership, with flags, labels and team
tint removed. No independent reviewers were available in this session. **No
human recognition test was run; no observations or percentages are reported.**
Author inspection of the captures is not a substitute and is not counted as
acceptance evidence.

The acceptance criteria therefore remain open:

- silhouette recognition for `atTurret`, `coastalBattery`, `radarStation`,
  `relay`: target ≥85% per building and ≥90% overall over 48 observations;
- captured ownership for the two objectives against neutral: target ≥90% over 36
  observations, including correct neutral identification, with the Supply Depot
  as positive control.

## 8. Known limitations and follow-ups

1. **Human visual acceptance is outstanding.** Arrange the independent tests
   described above before declaring the phase accepted.
2. **Relay ownership plate is subtle at zoom 36.** It passes the body-mask and
   flagless-recognition contract and is visible in close captures, but it is
   smaller than the Radar Station plate. Reviewers may judge it insufficient at
   battle zoom. The next pass should assess this before enlarging it, rather than
   adding an arbitrary bright rectangle.
3. **Matched-scene triangle totals are above the audit comparison points**
   (+7,941 Kestrel, +19,257 Foundry) while draw calls are unchanged. Only a small
   fraction is attributable to the four Phase 4 meshes. Isolate the pre-existing
   working-tree presentation changes before using these totals as a phase
   regression metric.
4. **CPU submission is not GPU performance.** The single-session numbers
   (0.36 ms Kestrel, 0.76 ms Foundry) do not establish frame time, thermals or
   mobile compatibility.
5. **Full pre-phase Foundry hash was not stored.** The Foundry fingerprint above
   is the new reference. Repeat it at the start of Phase 5 before editing
   simulation-adjacent code.
6. **No next building roster work was started.** Airfield/Shipyard, defensive
   family, Radar Array and urban-building overhauls remain out of scope, as
   required.

## 9. Files changed

| File | Change |
|---|---|
| `src/render/buildingMeshes.ts` | AT Gun, Coastal Battery, Radar Station and Relay bodies/turrets/arrays; shared sloped-plate helper |
| `src/render/geometry.ts` | Shared `materialForColor()` glass/track classification correction |
| `src/render/flags.ts` | Anchor table corrections and new body-compatible mounts |
| `src/render/teamColor.ts` | Shared neutral/faction ownership tint helper used by the renderer and tests |
| `tests/building-phase4.test.ts` | New focused geometry, ownership, material, anchor and material-buffer tests |
| `tests/building-presentation.test.ts` | Roster presentation contract retained/aligned |
| `tools/building-audit.js` | Phase 4 capture helpers for flagless ownership and review frames |
| `docs/BUILDING_VISUAL_PHASE_4.md` | This evidence record |
| `docs/visual-audit/phase4-*.png` | New after-evidence; audit before-images untouched |

The unrelated working-tree changes in `src/data/units.ts`, `src/data/weapons.ts`,
`src/render/unitTransform.ts`, the motion/heading portions of
`src/render/renderer.ts`, `src/sim/ai.ts`, `src/sim/constants.ts`,
`src/sim/game.ts`, `src/sim/pathfinding.ts`, `src/sim/types.ts`,
`src/sim/saveMigrations.ts` and their tests remain uncommitted and were not
modified as part of this phase. The renderer's ownership-tint calls were moved
to the shared helper described above; its unrelated motion changes were left
intact.
