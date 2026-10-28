# MCA — Combat Feedback Phase 3: Recognition, Spatial Audio and Polish

**Status:** implementation complete; typecheck, tests and production build green.
Independent human recognition and listening tests were **not performed**, so visual
and audio acceptance remains **open**, not claimed.

Baseline commit: `b4c2155` (`Release 0.1.1 BETA…`). Phase 3 changes are in the
working tree; no unrelated files were reverted, reformatted or staged.

## 1. Executive summary

The Phase 2 presentation layer is connected correctly, but the live review found
three concrete readability problems and one missing audio feature:

1. **Tracer tails read as isolated dots.** At battle zoom 36, a cannon or rifle
   shot was a row of separated bright specks with no readable direction. The
   projectile head was visible, but the tail did not read as a shot.
2. **Direct hits were visually weaker than misses for several classes.** Cannon
   `explosionScale` was `0.78` against `impactScale` `0.9`; missile and SAM had
   the same inversion. A direct hit could therefore produce a smaller fireball
   than a nearby ground miss.
3. **Infantry fire was hard to attribute.** Rifle sections are very small at
   battle zoom; with dotted tracers, their fire looked like unattached sparks.
   The tuned overlapping tail now gives each shot a direction, though infantry
   silhouette scale itself was not changed.
4. **Combat audio was mono.** Distance attenuation existed, but no cue was placed
   left or right of the camera.

Phase 3 addresses (1), (2) and (4) with the smallest changes that fit the existing
renderer and audio graph. It also extracts the shared fog gate and makes the wreck
cap a testable, presentation-only store. Dense combat, barrage, fog and wreck
pressure were exercised in the running browser.

## 2. Reproducible review setup

The development server was the running Vite session on
`http://127.0.0.1:5175/`. A new dev-only probe,
[tools/combat-probe.js](../tools/combat-probe.js), stages deterministic, AI-free
combat from the shipped island scenario. It is never imported by the game and
does not change balance or simulation data.

```js
// Browser console, development build only.
const probe = await import('/tools/combat-probe.js');
await probe.stage('tank');        // rifle | atgm | tank | artillery | antiAir
                                  // | staticAt | coastal | destruction | dense
                                  // | barrage | miss | structure | fog
window.__combatProbe.step(20);    // simulation + presentation, 20 ticks
await probe.capture('name.png', 1000);
```

The probe hides the HUD and menu, freezes the presentation clock behind explicit
`step()` calls, and keeps the real renderer update behind the probe so effects
age at simulation time. `measure()` uses the same draw-call / triangle /
CPU-submission protocol as [tools/visual-probe.js](../tools/visual-probe.js).
`capture()` reads the committed WebGL framebuffer through the existing local
capture sink, so it records the live renderer rather than a separate mesh viewer.

Capture conditions: 1600 × 900 CSS viewport, 1599 × 899 WebGL buffer, no device
pixel-ratio upscale, camera pitch 30°, zoom 36 for battle frames, 22 for close
frames and 30 for the class spot-checks below. Evidence PNGs are downscaled to
1000 px wide for review; the frame and camera data above still describe the
tested scene.

## 3. Readability findings and changes

### 3.1 Tracer continuity

**Finding (confirmed):** the tail was drawn as a small number of billboards
spaced far apart. `tankGun` used 3 segments over 2.6 units and `rifle` used 2 over
1.2 units. At battle zoom the gaps were larger than the billboard width, so each
shot was a dotted line. This was visible in the pre-change tank frame and is
quantified by the new continuity test.

**Change:** [src/render/combatFx.ts](../src/render/combatFx.ts) now overlaps the
tail dots and increases segment count while keeping the same additive particle
path:

| Profile | Length | Width | Segments | Tail gap |
|---|---:|---:|---:|---:|
| Small arms | 1.6 | 0.085 | 6 | 0.096 |
| Direct-fire cannon | 2.8 | 0.19 | 7 | 0.020 |
| Guided missile | 3.4 | 0.22 | 8 | −0.015 |
| Artillery | 3.6 | 0.24 | 8 | −0.030 |
| Air defence | 2.4 | 0.16 | 6 | 0.080 |
| Unknown fallback | 2.0 | 0.15 | 6 | 0.033 |

Tail gap is `length / segments − 2 × width`, using the nominal (un-tapered) width;
the dots taper and fade toward the tail, so the measured gap is slightly
pessimistic. A negative value means neighbouring dots overlap. The colours, class
mapping, muzzle-smoke policy, trail-smoke policy and projectile sizes are
unchanged. No new draw call, shader, texture or particle type was added; all
tracer dots continue to batch through the existing instanced particle renderer.

### 3.2 Direct hit versus near miss

**Finding (confirmed):** for `tankGun`, `atgm` and `samVehicle`, the direct-hit
explosion was smaller than the miss impact for the same profile. The first slice
also produced a soft round flash that grew into a single bright orb.

**Change:** direct-hit explosion scales now meet or exceed the miss scale:

| Weapon class | Miss `impactScale` | Before hit | After hit |
|---|---:|---:|---:|
| Cannon | 0.90 | 0.78 | 1.00 |
| Missile | 1.05 | 0.95 | 1.15 |
| Artillery | 1.30 | 1.30 | 1.40 |
| Air defence | 0.95 | 0.90 | 1.05 |

The hit spark scale is unchanged. The result is a larger, brighter direct-hit
burst while the ground miss remains a dust/spark puff rather than a fireball.
This is a profile correction, not a new effect system.

### 3.3 Observed but unchanged

These were inspected and are recorded as limitations, not silently accepted as
complete:

- **Infantry silhouette scale.** Rifle sections remain very small at battle zoom
  36. The continuous tracer now locates the firing pair, but unit identity still
  depends on shape and the selection/health overlay. Changing infantry scale is a
  unit-visual decision, not a combat-feedback tuning change.
- **Building destruction.** `buildingLost` produces a fireball plus dust/smoke,
  but no persistent rubble or scorch. The collapse reads at the moment of death
  and then leaves an empty footprint. The Phase 3 scope did not add a persistent
  aftermath system.
- **Artillery arc at battle zoom.** The 8-segment tail and larger explosion make
  the shell more visible, but a long indirect arc can leave the framed area. The
  class remains distinguishable mainly by its launch signature and larger
  impact.
- **Explosion shape.** The explosion is still built from additive circular
  billboards, so a close-up hit reads as a soft bright orb rather than a
  textured debris burst. No texture atlas or new particle geometry was added.

### 3.4 Remaining weapon classes inspected

No further tuning was needed for these classes; the Phase 2 profiles plus the
continuity change above carried them. Each was staged and captured in the
running game at zoom 30.

- **Air defence.** The AA vehicle fired a SAM at tick 26 from its turret, in the
  blue-white class colour. The launch read as a bright head with a short
  continuous tail, clearly unlike the orange cannon tracer in the adjacent tank
  frame. The aircraft's own `strikeMissile` was in the air at the same time and
  the two remained distinguishable by origin and colour.
- **Static anti-tank gun.** The emplacement fired at tick 58. The simulation
  event originated at the building centre, and the rendered flash appeared on
  the weapon rather than at the pad centre — the existing `staticMuzzleAnchor`
  presentation offset — so the authoritative event position was not moved. The
  enemy tank's round and its impact orb were visible in the same frame, which
  made the two firing directions readable.
- **Coastal battery.** The battery fired a `coastalMissile` at tick 102. The
  raised-rail launch produced a smoke plume and a rising tracer over water,
  which is a different signature from the flat anti-tank gun shot and from a
  tank's direct-fire cannon.

These are class-recognition observations from still frames, not a timed human
recognition test. The reviewer procedure in section 10 still applies.

## 4. Stereo combat audio

### 4.1 Implementation

[src/ui/audioSpatial.ts](../src/ui/audioSpatial.ts) adds pure mix helpers:

- the listener frame is the camera focus (`cx`, `cz`) and its ground-projected
  screen-right vector;
- `combatMix()` preserves the previous enemy distance attenuation
  (`max(0.12, 1 − distance/reach) × 0.55`) and adds a lateral pan;
- pan reaches ±0.9 at 65% of the attenuation reach, then clamps. It never
  hard-pans or increases the gain of a farther event;
- malformed positions and missing listener data return centre pan instead of
  inventing a direction.

[src/ui/audio.ts](../src/ui/audio.ts) creates a short-lived `StereoPannerNode`
per positioned cue and connects the existing synthesised sources through it into
the existing `sfx` gain. Centred cues allocate no panner. `createStereoPanner`
absence falls back to the existing mono path. The panner is disconnected after
1.5 s, and `dispose()` clears every pending timer.

[src/app.ts](../src/app.ts) now derives the listener from the real renderer
camera and calls `audio.play(sound, gain, pan)`. UI, production and announcer
cues remain centred. The music bus, master mute and voice element are untouched.

### 4.2 Directional behaviour verified

| Check | Method | Result |
|---|---|---|
| Left source pans left | `combatMix` at 20 world units left of focus | pan −0.55 |
| Right source pans right | mirrored source | pan +0.55 |
| Ahead/behind stays centred | points on the view axis | pan 0 |
| Camera rotation | right vector turned 90° | side follows camera, not world X |
| Pan clamped | huge lateral input | within ±0.9 |
| Gain independent of bearing | equal distance, different bearing | identical gain |
| Enemy attenuation preserved | 10 vs 40 units | 0.44 → 0.11 before the 0.55 mix |
| Friendly fire full gain | same point as listener | gain 1 |
| Positioned cue uses panner | fake Web Audio context | pan value −0.6 / +0.45 |
| Centred cue stays direct | UI/queue cue | no panner allocated |
| Mono fallback | context without `createStereoPanner` | cue does not throw; no panner |
| Mute and effects volume | fake context | master 0, sfx 0.25; panner routes into sfx |
| Panner cleanup | fake timers | disconnected after 1.5 s; dispose clears timers |

Browser spot checks (running game, real camera, re-measured against the final
working tree). Synthetic `shot` events were fed through the real `drainEvents`
gate, so the fog rule, the camera frame and the audio call path were the shipped
ones:

| Case | Gain | Pan |
|---|---:|---:|
| Friendly rifle, 24 world units screen-left | 1.000 | −0.355 |
| Friendly rifle, 24 world units screen-right | 1.000 | +0.355 |
| Friendly rifle on the view axis | 1.000 | 0 |
| Visible enemy rifle, 12 units from the focus | 0.513 | −0.084 |
| Enemy rifle at (160, 96), hidden by gameplay fog | **no call** | — |
| Same hidden shot with the visual fog toggle off | **no call** | — |

The hidden case produced zero `audio.play` calls with the fog texture on or off.
A 3-second barrage yielded 201 positioned calls with pan values from `−0.732` to
`+0.422`, while the existing per-cue throttle remained in place. The live
Chromium `AudioContext` (48 kHz, `running`) created both `StereoPannerNode`s with
`pan = −0.6` and `pan = +0.45`. Master gain was held at zero during that API
check, so it proves routing support, not audible output.

**Not verified by listening.** No independent listener or calibrated playback
environment was available. The tests verify signal parameters and routing, not
perceived direction, headphone comfort, or equal-loudness balance.

## 5. Fog and presentation integrity

The renderer and app previously duplicated the fog check. Both now call
`eventVisibleToLocal()` in [src/render/combatFx.ts](../src/render/combatFx.ts):

- friendly events are always visible to the local player;
- with gameplay fog off, enemy events are visible;
- with gameplay fog on, an enemy event is visible only where `game.fogAt` returns
  `2` (currently visible);
- a spectator with no team sees all events;
- the renderer's `showFog` texture toggle is not an input to the rule.

The renderer uses the helper before consuming any event, and the app uses it
before playing combat audio. Turning off the visual fog texture therefore cannot
reveal a hidden projectile, muzzle flash, impact or sound.

Checked in the running game by emitting shots at a known hidden tile and a known
visible tile:

| Condition | Hidden enemy | Visible enemy |
|---|---:|---:|
| Gameplay fog on, fog texture on | 0 muzzle particles / 0 audio calls | 1 muzzle particle / 1 audio call |
| Gameplay fog on, fog texture off | 0 muzzle particles | — |

This used synthetic simulation events through the real event gate, not a staged
AI artillery duel behind the fog line. The live hidden-fire case remains a
methodological limitation.

Presentation-only state remains separate from the simulation:

- [src/render/combatFx.ts](../src/render/combatFx.ts) now owns `WreckStore`, which
  holds only `defId`, position and facing, and enforces the 24-hull cap;
- [src/render/renderer.ts](../src/render/renderer.ts) clears the store on
  scenario/game replacement and draws it only from the existing unit body mesh;
- no wreck is added to `game.state.entities`, picking, collision, saves or the
  damage model.

## 6. Performance

Measurements use the existing draw-call/triangle hook and `measureFrame` protocol.
CPU numbers are **CPU render submission**, not GPU time and not total frame time.
They were taken after warm-up on the same running browser session and are noisy
between samples; draw calls and triangles are the stable comparison.

| Scene | Conditions | Draw calls | Triangles | CPU submission |
|---|---|---:|---:|---:|
| Kestrel audit baseline (Phase 1, reference only) | opening frame | 30 | 82,818 | 0.21 ms |
| Dense engagement | 21 staged units / 18 surviving, 3 s / 60 ticks, no projectiles at sample | 72 | 103,639 | 1.67 ms |
| Barrage peak | 21 simultaneous projectiles, 26 units, tick 1 | 98 | 107,019 | 1.47 ms |
| Dense + 24 wrecks | 18 surviving units + 24 wrecks, cap reached by 30 kills | 96 | 130,103 | 1.95 ms |
| Barrage, 60 s | 1,200 ticks, 5 survivors | 34 | 90,515 | 0.82 ms |
| 60 wreck kills | pressure run after the 60 s session | 59 | 117,825 | 1.17 ms |

The Kestrel baseline is the Phase 1 audit figure measured under its own camera and
scene; it is not a like-for-like budget for the staged firefights. The dense and
wreck rows are directly comparable to each other.

**Presentation CPU per frame.** With 21 projectiles in flight, 60 consecutive
presentation updates plus render submissions cost p50 1.0 ms, p95 4.0 ms and a
5.7 ms maximum. This is CPU work inside the presented frame (effect ageing plus
draw submission), not total frame time, and no GPU timing was available. Wall-clock
`requestAnimationFrame` intervals were not used because the test tab is not a
controlled presentation environment.

**Wreck cost:** the 24-hull cap adds exactly 24 draw submissions and approximately
26,500 triangles over the dense scene. CPU samples for the same wreck scene ranged
from 0.80 ms to 1.95 ms across runs, so no consistent CPU regression could be
attributed to wrecks. The bounded per-wreck draw was retained; batching was not
introduced without a measured frame-time problem.

**Effect lifetime and audio load:** after 1,200 ticks the scene had 14 live
particles and no stale projectiles. A 60-kill wreck pressure run held exactly 24
wrecks and 853 particles, below the 2,800-particle cap. The 3-second barrage
produced 201 positioned audio calls (about 67 calls/s at the event layer); the
audio engine's existing per-name minimum gap continues to throttle synthesis, and
the visible/hidden gate remains in force.

## 7. Files changed

| File | Change |
|---|---|
| [src/render/combatFx.ts](../src/render/combatFx.ts) | Tracer/direct-hit profile tuning; shared `eventVisibleToLocal()`; `WreckStore` + 24-hull cap |
| [src/render/renderer.ts](../src/render/renderer.ts) | Consumes the shared fog gate; uses `WreckStore` for presentation-only hulls |
| [src/ui/audioSpatial.ts](../src/ui/audioSpatial.ts) | New pure listener/pan/distance mix helpers |
| [src/ui/audio.ts](../src/ui/audio.ts) | Positioned cue panner, fallback, timer cleanup, `play(sound, gain, pan)` |
| [src/app.ts](../src/app.ts) | Camera-derived listener frame, shared event gate and panned combat cues |
| [tests/audio-spatial.test.ts](../tests/audio-spatial.test.ts) | 11 pan, fallback, routing, mute/volume and cleanup tests |
| [tests/combat-feedback.test.ts](../tests/combat-feedback.test.ts) | Tracer continuity, hit/miss prominence, fog gate and wreck-cap tests |
| [tools/combat-probe.js](../tools/combat-probe.js) | New deterministic combat staging, stepping, measurement and capture probe |
| [tools/visual-probe.js](../tools/visual-probe.js) | Exported the existing `measureFrame` for the combat probe |

No gameplay data, weapon stats, damage, accuracy, target rules, simulation step,
save schema, fog rules, building data or HUD layout was changed. The simulation
still owns projectile positions, hit results and impact heights; the new code
only consumes its events.

## 8. Evidence set

All images are live-renderer captures under `docs/visual-audit/`. Before/after
pairs use the same staged scene, camera, zoom, tick-zero disposition and capture
path. The before files were taken before the profile tuning; they are not
regenerated after-images.

| Evidence | File |
|---|---|
| Tank shot, before tuning (dotted tail) | [phase3-tank-open-1000.png](visual-audit/phase3-tank-open-1000.png) |
| Tank shot, after tuning (continuous tail) | [phase3-tank-inflight-after.png](visual-audit/phase3-tank-inflight-after.png) |
| Tank direct hit, before | [phase3-tank-explosion.png](visual-audit/phase3-tank-explosion.png) |
| Tank direct hit, after, impact tick | [phase3-tank-explosion-after.png](visual-audit/phase3-tank-explosion-after.png) |
| Tank direct hit, after, 0.15 s later | [phase3-tank-explosion-after-3ticks.png](visual-audit/phase3-tank-explosion-after-3ticks.png) |
| Rifle firing, before | [phase3-rifle-flight.png](visual-audit/phase3-rifle-flight.png) |
| Rifle firing, after, tick 1 | [phase3-rifle-flight-after.png](visual-audit/phase3-rifle-flight-after.png) |
| Rifle in flight, after, tick 2 | [phase3-rifle-inflight-after.png](visual-audit/phase3-rifle-inflight-after.png) |
| ATGM firing, before | [phase3-atgm-flight.png](visual-audit/phase3-atgm-flight.png) |
| ATGM firing, after | [phase3-atgm-flight-after.png](visual-audit/phase3-atgm-flight-after.png) |
| Artillery firing, after | [phase3-artillery-flight.png](visual-audit/phase3-artillery-flight.png) |
| 21-projectile barrage, after | [phase3-barrage-peak.png](visual-audit/phase3-barrage-peak.png) |
| Air-defence SAM launch, after | [phase3-antiair-shot.png](visual-audit/phase3-antiair-shot.png) |
| Static anti-tank gun firing, after | [phase3-static-at-shot.png](visual-audit/phase3-static-at-shot.png) |
| Coastal battery launch, after | [phase3-coastal-shot.png](visual-audit/phase3-coastal-shot.png) |
| Rifle ground miss, close | [phase3-rifle-miss-close.png](visual-audit/phase3-rifle-miss-close.png) |
| Dense engagement, before | [phase3-dense-before.png](visual-audit/phase3-dense-before.png) |
| Dense engagement, after | [phase3-dense-after.png](visual-audit/phase3-dense-after.png) |
| 24-wreck cap | [phase3-wrecks-24.png](visual-audit/phase3-wrecks-24.png) |
| Wrecks one second after death | [phase3-wrecks-persist.png](visual-audit/phase3-wrecks-persist.png) |
| Static building loss, impact tick | [phase3-building-destroyed.png](visual-audit/phase3-building-destroyed.png) |

Scenario summaries for reproduction:

- `stage('tank')`: one MBT per side at open-grass tiles (19, 24) and (26, 24),
  camera centre (22.5, 24) × 4 world units, zoom 36.
- `stage('rifle')`: three riflemen per side around (20–21, 23–25) and
  (25–26, 23–25), same camera family.
- `stage('atgm')`: ATGM team at (19, 24), MBT at (25, 24).
- `stage('artillery')`: SPG at (18, 24), two riflemen at (28–29, 24–25).
- `stage('antiAir')`: AA vehicle at (21, 24), strike aircraft at (35, 38); the
  first SAM left the launcher on tick 26.
- `stage('staticAt')`: player anti-tank gun at (27, 23), enemy MBT at (21, 23);
  the gun fired on tick 58.
- `stage('coastal')`: coastal battery at (15, 51), corvette at (9, 48); the first
  `coastalMissile` left the rails on tick 102.
- `stage('barrage')`: 12 riflemen per side plus one MBT each; peak was 21
  simultaneous projectiles on tick 1.
- `stage('dense')`: 16 riflemen, 3 MBTs, one ATGM and one SPG; 21 units.
- `stage('fog')`: friendly rifleman at (22, 24), enemy at (40, 24), gameplay fog
  on.
- `stage('structure')`: player MBT at (22, 24) against an enemy warehouse at
  (27, 24); building lost at tick 820.
- `stage('miss')`: six riflemen against an MBT; first ground miss at tick 19.
- `stage('destruction')`: MBT duel; both hulls destroyed at tick 207.

## 9. Verification results

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | **62 files, 674 tests passed** |
| `npm run build` | Pass, 72 modules; 571.54 kB JS (171.04 kB gzip); Vite's existing >500 kB chunk advisory remains |

All three commands were re-run against the final working tree after the last test
edit, not carried over from an earlier revision.

Focused tests added or extended:

- `tests/audio-spatial.test.ts` — 11 tests covering pan sign, clamping, rotated
  camera frame, malformed positions, attenuation without gain increase, panner
  routing, mono fallback, mute/effects volume and timer cleanup.
- `tests/combat-feedback.test.ts` — tracer continuity, hit/miss prominence, shared
  gameplay-fog gate and the bounded `WreckStore`.

No test was weakened or skipped to obtain these results. The production build's
chunk-size advisory is pre-existing.

## 10. Human recognition and listening gate — not performed

No independent reviewers or listeners were available in this environment. No
human results are recorded here, and no recognition threshold is claimed as met.

The proposed procedure for the follow-up review:

1. **Weapon recognition.** Six reviewers who have not read this document. Present
   six two-second clips or matched still sequences per class (rifle/MG, ATGM, tank
   gun, artillery), with HUD, labels and team tint hidden. 24 observations per
   reviewer, 144 total. Ask for the weapon class, not the model id. Target: ≥85%
   correct per class and ≥90% overall.
2. **Hit, miss, destruction.** Six reviewers view matched pairs or short clips of
   a direct hit, a ground miss and a vehicle destruction in both orientations.
   Ask whether the round hit, missed or destroyed the target. Target: ≥90%
   correct.
3. **Spatial audio.** Six listeners on headphones, with the camera fixed. Present
   left, right, front and rear cues plus visible and fog-hidden enemy fire at
   matched gain. Ask for the side and whether the sound is audible. Target: ≥90%
   correct side identification and 100% silence for hidden fire.
4. Record the actual responses, disagreements and any failed class. Do not
   substitute the automated parameter tests for these observations.

## 11. Remaining limitations

- Human recognition, hit/miss and listening tests are unresolved.
- CPU submission times are noisy and are not GPU or total-frame measurements.
- The fog-hidden audio check used synthetic events through the real gate; a live
  AI engagement behind the fog line was not staged.
- Infantry scale at battle zoom remains a readability constraint outside this
  phase.
- Building destruction has no persistent rubble/scorch; the static-building
  capture is the brief loss effect, not an aftermath.
- The artillery arc can leave the battle-zoom frame; class recognition relies on
  its launch and impact signatures.
- Stereo panning is a two-channel mix. There is no HRTF, occlusion, reverb or
  Doppler; none is needed for the current camera model.
- Wrecks cost one draw submission each, capped at 24. No batching was added
  because the matched CPU samples did not show a consistent regression.

## 12. Next recommendation

Run the six-reviewer recognition and listening gate before adding more combat
effects. If that gate cannot be arranged, the next implementation task should be
**persistent building-destruction aftermath** — rubble, scorch and a bounded
smoke column for `buildingLost` — because it is the largest remaining gap between
the current brief fireball and a battlefield that records what happened. Do not
expand the weapon roster or add new effect categories before that gate is closed.
