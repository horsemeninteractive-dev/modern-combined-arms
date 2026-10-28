# MCA — Combat Feedback Phase 4: Battlefield Readability and Playtest Validation

**Status:** implementation complete; typecheck, tests and production build green.
Human visual-recognition, listening and awareness tests were **not performed**.
Visual acceptance remains **open**; this document separates what was measured
from what still needs players.

Phase 3 report: [COMBAT_FEEDBACK_PHASE_3.md](COMBAT_FEEDBACK_PHASE_3.md).
Playtest procedure: [COMBAT_FEEDBACK_PLAYTEST_PROTOCOL.md](COMBAT_FEEDBACK_PLAYTEST_PROTOCOL.md).

## 1. Verified current state

The Phase 3 claims were checked against the current tree, not the report:

- continuous tracer tails and the direct-hit/explosion prominence fix are present
  in [combatFx.ts](../src/render/combatFx.ts);
- `WreckStore` is presentation-only and capped at 24;
- stereo placement is implemented in [audioSpatial.ts](../src/ui/audioSpatial.ts)
  and [audio.ts](../src/ui/audio.ts);
- the shared fog gate `eventVisibleToLocal()` governs renderer effects and audio;
- `showFog` remains a texture-only toggle and is not an input to visibility.

Baseline commit: `b4c2155`, with the uncommitted Phase 3 and camera work already
in the tree. Nothing unrelated was reverted, reformatted or staged.

## 2. Reproduced issues

### 2.1 Infantry at battle zoom

At camera zoom 36 one world unit projects to 12.49 px vertically in the test
viewport. The rifleman model is 1.2 world units tall and roughly 0.35 wide, so a
soldier occupies about **15 × 4.4 px** (≈17 × 5 px at a 1777 × 1000 camera).
The matched before frame and 6× crop show the result: dark olive figures with no
readable team cue. The 0.075-world shoulder patch is under one pixel at this
zoom, so it cannot carry ownership.

The problem is primarily **screen footprint and contrast**, not pose. The model
already has a helmet, pack, rifle and articulated legs; in the 6× crop the pose
reads. At 1× the figure is simply too thin to scan.

Candidate fixes were tested and rejected on evidence:

| Candidate | Result |
|---|---|
| Scale the body 1.2× | Breaks the authored muzzle alignment the project tests: rifle tip moves from 0.30 to 0.354 world, ATGM from 0.45 to 0.55, versus hardpoints at 0.30/0.45 |
| Scale the body 1.3× | Rifle becomes 1.59 world tall against a 1.67-world tank with turret; visually tank-height and toy-like |
| Lighten the uniform alone | Improves contrast marginally, but a 4 px-wide figure still has no ownership cue at 1× |
| Team-tinted helmet alone | Visible in the 6× crop, but only a 2 px colour cluster at 1×; insufficient alone |

### 2.2 Artillery framing

The Phase 3 claim that arcs leave the frame was re-measured by projecting every
simulated shell position through the real camera (`worldToScreen`) in the
artillery stage. Viewport 1777 × 1000, 23 samples per flight:

| Camera | Zoom | Screen X range | Screen Y range | Outside |
|---|---:|---|---|---:|
| Between firing and impact | 36 | 747–1053 | 398–542 | 0 / 23 |
| On the firing SPG | 36 | 944–1249 | 496–640 | 0 / 23 |
| On the impact | 36 | 551–856 | 300–444 | 0 / 23 |
| Impact near the top edge | 36 | 1116–1422 | 17–161 | 0 / 23 |
| On the firing SPG | 22 | 979–1478 | 494–729 | 0 / 23 |
| On the firing SPG | 14 | 1030–1816 | 490–860 | 1 / 23 |

At the normal battle zoom the arc fits in every tested framing; it grazes the
top edge only when the impact sits at the frame edge. At the closest zoom now
allowed by the uncommitted camera change (14, not a Phase 4 change) a long shot
can leave the side of the frame by one sample. This is
**framing, not a culling defect**: projectiles are world-space particles with no
screen-space rejection, and the renderer draws them wherever the simulation
puts them.

A separate defect was confirmed while tracing the same path: **own-team shells
and missile trails were fog-culled per tile**, while friendly fire events and
audio were always shown. A player's own artillery could therefore disappear
mid-flight over unseen ground, which reads exactly like an arc leaving the frame.

### 2.3 What was not reproduced

No premature culling, interpolation error or detached trail was found. The
simulation owns the projectile position; the renderer only interpolates between
the last two simulation samples.

## 3. Changes

### 3.1 Infantry presence and ownership cue

Two small cues were added; the body scale, proportions and weapon hardpoints are
unchanged.

**Helmet cover.** In [unitMeshes.ts](../src/render/unitMeshes.ts) the helmet
shell and brim carry a 0.65 team mask, and the ear covers 0.5. The shader blends
the olive cover with the alliance colour, so a rifleman shows a coloured crown
rather than a flat marker.

**Ground presence pool.** Foot units (rifle, ATGM, medic) add a soft
alliance-coloured ellipse under the normal contact shadow. `unitGroundMarker()`
returns `0.48 × 0.26` world at alpha 0.34 for rifle/medic and `0.52 × 0.28` for
ATGM. It is rotated with the unit's facing, so its long axis also hints at
facing.

The pool reuses the existing instanced shadow pass
([shadowGpu.ts](../src/render/shadowGpu.ts), [shaders.ts](../src/render/shaders.ts)):
`GpuShadow` gained an optional per-instance colour, the stride went from 7 to 10
floats and the default remains the old dark contact colour. That adds **one
shadow instance per foot unit**, not a draw call: the dense scene has 17 foot
units, so 17 extra quads in a batch that was already being submitted.

Markers are only emitted for units visible to the local team, so fog rules are
unchanged. Vehicles get no pool; the `unit-scale` test asserts that explicitly.

### 3.2 Projectile visibility

[combatFx.ts](../src/render/combatFx.ts) now exposes:

- `pointVisibleToLocal(game, x, z)` — the single gameplay-fog query;
- `projectileVisibleToLocal(game, owner, x, z)` — own-team projectiles are never
  hidden; hostile projectiles keep the per-tile gameplay-fog gate.

`eventVisibleToLocal()` uses the same point query. [renderer.ts](../src/render/renderer.ts)
uses the projectile helper for both shell drawing and missile trails. The visual
`showFog` toggle remains outside the rule.

This does not reveal enemy information: it only stops hiding the local player's
own shot, whose launch event and audio were already visible/audible by rule.
Incoming hostile shells still appear only where gameplay vision allows.

## 4. Before and after evidence

Matched scenes, camera, tick and capture path. Before = no helmet tint, no pool;
after = both cues. Live GL buffer 1599 × 899, camera CSS viewport 1777 × 1000
at zoom 36, no device-pixel-ratio upscale; images downscaled to 1000 px wide.

| Evidence | File |
|---|---|
| Battle zoom, before | [phase4-combat-infantry-before-36-1000.png](visual-audit/phase4-combat-infantry-before-36-1000.png) |
| Battle zoom, after | [phase4-combat-infantry-after-36-1000.png](visual-audit/phase4-combat-infantry-after-36-1000.png) |
| 6× crop, before | [phase4-combat-infantry-before-crop.png](visual-audit/phase4-combat-infantry-before-crop.png) |
| 6× crop, after | [phase4-combat-infantry-after-crop.png](visual-audit/phase4-combat-infantry-after-crop.png) |
| Enemy section, after | [phase4-combat-infantry-enemy-crop.png](visual-audit/phase4-combat-infantry-enemy-crop.png) |
| Artillery arc at battle zoom | [phase4-combat-artillery-arc-36.png](visual-audit/phase4-combat-artillery-arc-36.png) |

At 1× the change is deliberately restrained: a blue or orange crown and a small
ground pool per soldier. It does not make infantry large; it makes their
presence and ownership scannable without breaking model proportions. The
matched 6× crops show the mechanism clearly. Whether this is *enough* is a human
question, not an automated one.

## 5. Persistent ground effects: evaluated, not implemented

Evidence:

- The tank duel leaves two persistent wrecks. After 300 further ticks (15 s)
  both hulls are still present, particles have decayed to zero, and the wreck
  count is unchanged. Wrecks already mark where vehicles died.
- A destroyed Brick Warehouse leaves no wreck and no rubble. The loss effect
  peaks at 75 particles and decays to 3 within 60 ticks; the footprint is then
  empty.

The vehicle case is adequately covered by the bounded wreck store. The building
case is a real but modest gap: the empty footprint and the one-off collapse read
at the moment of destruction, but a player arriving later cannot tell what stood
there.

Persistent rubble was **not implemented** in this phase because:

- doing it faithfully needs per-footprint debris geometry or a new decal layer,
  which is larger than "small and compatible";
- a generic scorch ellipse under a large building would look like a shadow and
  can obscure terrain and picking cues;
- the phase forbids turning an absence into a large effects system without
  playtest evidence that players actually lose track of destroyed structures.

The recommendation is to add a bounded, presentation-only rubble/scorch pass only
if the playtest shows that building losses are forgotten or misread. The wreck
store is the pattern to copy: no entity, collision, picking or save data.

## 6. Live fog engagement

This replaces the synthetic Phase 3 check with a complete event-to-render-and-audio
engagement.

Setup: friendly rifleman at (22, 24); hidden enemy recon at (33, 24) and SPG at
(35, 24); gameplay fog on; AI off; the SPG ordered to attack the rifleman. The
recon spots for the battery while remaining outside friendly vision. The rifleman
was kept alive to observe repeated fire.

| Phase | Fog at spotter tile | Shots | Hidden shots | Audio on hidden-only steps |
|---|---|---:|---:|---:|
| A — hidden | 0 | 2 howitzer | 2 | **0 calls** |
| B — target moved to (29, 24) | 0 at first frame, 2 after one refresh | 25 (incl. recon autocannon) | 2 at the transition | visible impacts only |
| C — target back at (22, 24) | 2 at first frame, 0 after one refresh | 1 howitzer | 1 | **0 calls** |
| D — hidden, `showFog = false` | 1 (remembered) | 1 howitzer | 1 | **0 calls** |

- Hidden launches produced **no muzzle flash, no projectile and no audio**.
- Impacts on the visible rifleman were visible and audible in every phase.
- Shell samples along the hostile trajectory: 12 hidden by the gate, 24 drawn
  once the shell entered friendly vision near the target. This reveals the
  incoming round, not the hidden battery.
- The two hidden shots at the start of phase B occurred before the next vision
  refresh (≈6.7 Hz); their steps also contained visible impacts, which is where
  the audio in those steps came from.
- Turning the fog texture off changed neither visibility nor audio.

Fog rules were not modified to make this pass.

## 7. Human validation

The full procedure, questions, scoring and recording sheet are in
[COMBAT_FEEDBACK_PLAYTEST_PROTOCOL.md](COMBAT_FEEDBACK_PLAYTEST_PROTOCOL.md).
It covers weapon recognition, hit/miss/destruction, infantry presence and facing,
spatial audio, dense awareness and hidden fire, with six reviewers and explicit
pass thresholds.

It also defines how to distinguish a rendering defect from unfamiliarity: one
labelled training clip, then an unlabelled retest, then code/telemetry inspection
only if the failure repeats.

## 8. Human results

**None.** No independent reviewers or listeners were available. No recognition,
listening, awareness or fog-with-players result is claimed. The automated tests
and the measurements above are technical evidence, not perceptual evidence.

## 9. Performance

Same probe protocol as Phase 3. CPU figures are render submission, not GPU or
total frame time. Scene populations differ between phases, so compare same-phase
rows first.

| Scene | Units / projectiles / wrecks | Draw calls | Triangles | CPU submission |
|---|---|---:|---:|---:|
| Phase 3 dense (reference) | 18 / 0 / 0 | 72 | 103,639 | 1.67 ms |
| Phase 4 dense | 20 / 8 / 0 | 78 | 105,233 | 1.60 ms |
| Phase 3 barrage (reference) | 26 / 21 / 0 | 98 | 107,019 | 1.47 ms |
| Phase 4 barrage | 26 / 21 / 0 | 98 | 107,067 | 1.25 ms |
| Phase 3 dense + wrecks | 18 / 0 / 24 | 96 | 130,103 | 1.95 ms |
| Phase 4 dense + wrecks | 20 / 8 / 24 | 102 | 131,645 | 1.50 ms |

- The barrage row is the cleanest comparison: +48 triangles and the same 98
  draw calls for 17 extra shadow instances.
- The dense rows have different live populations, so the six extra draw calls
  cannot be attributed to the marker.
- Wrecks remain capped at 24; no unbounded effect was added.
- CPU samples are noisy; no speedup or regression is claimed.
- No shader, GL or console errors were observed (`gl.getError() === 0` after the
  marker frames).

## 10. Verification

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | **62 files, 678 tests passed** |
| `npm run build` | Pass, 72 modules; 572.09 kB JS (171.20 kB gzip); the pre-existing >500 kB advisory remains |

Focused tests added or updated:

- `tests/unit-scale.test.ts` — foot units have a bounded ground marker; vehicles
  return null; existing scale, muzzle and shadow invariants still pass.
- `tests/combat-feedback.test.ts` — own-team projectiles visible over unseen
  ground; hostile projectiles follow gameplay vision; fog-off behaviour;
  malformed positions; renderer uses the shared gate, not `showFog`.

No test was skipped or weakened. The production build's chunk advisory is
pre-existing.

## 11. Remaining limitations and next recommendation

- Human validation is pending; this is the largest open item.
- Infantry are still small at battle zoom. The cue improves presence and
  ownership, not body size; a larger body was rejected because it breaks the
  authored muzzle hardpoints and makes soldiers tank-height.
- Artillery arcs can still leave the frame at the new close zoom or when the
  impact sits at the frame edge. No camera follow and no off-screen marker were
  added; the presentation rule is that launch and impact signatures carry the
  class at the edge. If the playtest shows this is insufficient, a bounded
  own-team edge marker is the smallest follow-up.
- Destroyed buildings leave no persistent rubble or scorch; this was evaluated
  and deliberately deferred (section 5).
- CPU submission is not GPU or total frame time; no GPU timing was available.
- The live fog test moved a unit by hand to cross the vision boundary; a full AI
  battle crossing fog was not staged.
- The helmet/pool colours are a readability decision; the playtest should ask
  whether they look appropriate as well as whether they are visible.

**Next recommendation:** run the playtest protocol before any further combat
effect work. If artillery framing fails in Block E, implement the bounded
own-team edge marker; if building losses are misremembered, add the bounded
rubble/scorch pass; otherwise do not expand the effect roster.

## 12. Working tree

Files changed for this phase:

| File | Reason |
|---|---|
| [src/render/unitMeshes.ts](../src/render/unitMeshes.ts) | Team-tinted helmet cover; `unitGroundMarker()` for foot units |
| [src/render/shadowGpu.ts](../src/render/shadowGpu.ts) | Optional per-instance shadow colour (7 → 10 float stride) |
| [src/render/shaders.ts](../src/render/shaders.ts) | Shadow vertex colour; dark default preserved |
| [src/render/renderer.ts](../src/render/renderer.ts) | Foot-unit marker instances; shared projectile visibility |
| [src/render/combatFx.ts](../src/render/combatFx.ts) | `pointVisibleToLocal`, `projectileVisibleToLocal` |
| [tests/unit-scale.test.ts](../tests/unit-scale.test.ts) | Ground-marker bounds and vehicle exclusion |
| [tests/combat-feedback.test.ts](../tests/combat-feedback.test.ts) | Projectile fog rules and shared gate |
| [docs/COMBAT_FEEDBACK_PLAYTEST_PROTOCOL.md](COMBAT_FEEDBACK_PLAYTEST_PROTOCOL.md) | Human-validation procedure |
| [docs/COMBAT_FEEDBACK_PHASE_4.md](COMBAT_FEEDBACK_PHASE_4.md) | This report |
| `docs/visual-audit/phase4-combat-*.png` | Matched Phase 4 evidence |

Unrelated uncommitted work was preserved, including the camera close-zoom change
(`CLOSE_ZOOM = 14`) and the Phase 3 report and audio/combat-probe files. No
simulation, weapon, damage, accuracy, firing cadence, fog, save or picking data
was changed.
