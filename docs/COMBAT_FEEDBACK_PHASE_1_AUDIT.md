# MCA — Combat Feedback Phase 1: Audit and Vertical-Slice Plan

**Status:** audit and planning only. No production source, simulation rules or gameplay data were changed.

**Repository revision inspected:** `248fabb` with the pre-existing uncommitted Phase 4, pathfinding, unit-heading and save-migration work preserved in place.

**Audit date:** 28 October 2026.

---

## 1. Executive summary

MCA already has a real combat-presentation pipeline. Firing produces a `shot` event with the actual muzzle point; projectiles are simulated as world-space entities; impacts emit `impact` or `explosion`; deaths emit `unitLost` or `buildingLost`; the renderer consumes those events into the shared particle system, screen shake and fog-filtered effects; and the audio layer plays synthesised weapon sounds plus the strategic announcer. This is not a blank slate.

It is, however, a **generic** pipeline. The event contract does not say what weapon fired, what it hit, or whether the hit was a hit at all. The renderer therefore infers spectacle from event type and, in one case, from a shooter's definition id. The result at the shipped battle zoom is:

- rifle and cannon projectiles are un-interpolated points that are visible for roughly one to three simulation ticks;
- an ATGM, a tank shell and a 76 mm anti-tank gun round do not have distinct, reliable silhouettes;
- every splash weapon produces the same explosion scale;
- a tank death produces **two** explosion sequences at the same point because the impact explosion and the `unitLost` explosion are both consumed;
- a destroyed vehicle disappears immediately; there are no wrecks or persistent battlefield evidence;
- suppression is a two-pixel bar that only appears on the selected unit;
- static anti-tank guns fire their presentation flash from the building centre at `ground + 3.5`, not from the barrel;
- enemy combat events are silent because sound dispatch is restricted to events whose `team` is exactly the local player;
- projectile trails are not fog-gated, and turning the visual fog off makes all projectiles visible even where the player has no vision.

The highest-impact first slice is therefore not “more particles”. It is: **give the existing event stream enough presentation vocabulary to be specific, make projectile flight readable, consolidate destruction, and enforce visibility consistently.**

### Three highest-priority improvements

1. **Introduce a weapon-class presentation profile and fix the duplicate death effect.** This turns the existing single generic effect path into rifle, autocannon, cannon, ATGM, artillery, SAM and naval signatures without adding a shader or render pass. It also removes the duplicated explosion that currently makes a single tank death read as two.
2. **Make projectile travel readable at zoom 36.** Interpolate projectile positions between 20 Hz ticks in the renderer, and draw a short class-specific tracer/streak instead of a single billboard point. This directly addresses the one-cover-frame readability failure in the baseline.
3. **Make hit, damage and destruction read as separate beats.** Add presentation metadata for impact surface and hit result, keep the existing hit flash, consolidate the destruction burst, and add a bounded, presentation-only wreck for vehicles. This is what lets a player understand “hit, penetrated, burning, dead” rather than only seeing a health bar.

A separate correctness gate is required before or alongside item 3: **fog must gate every derived effect, including trails, and the visual-fog toggle must not change what the player is allowed to see.**

---

## 2. Baseline and evidence

### 2.1 Capture conditions

The combat baselines use a controlled, reproducible arena rather than a live campaign, because the point is to isolate presentation from terrain and AI variation.

- Map: `96 × 64` flat grass with one command post per side, seed `9100` (`9101` for fog, `9103` for dense, `9104` for the static gun).
- Browser viewport: `1600 × 900`, Chromium desktop.
- Camera: battle zoom **36** for normal-play evidence; zoom **18** for the static-gun close view.
- HUD hidden; tactical overlay (health bars, target rings) kept visible.
- Effects on; screen shake off for stable matched stills.
- Fog off except the fog fixture.
- AI controller removed after battle start; units were stepped manually so the chosen tick and event could be captured exactly.
- No gameplay values were edited for the captures. The flat arena is a diagnostic fixture staged in the browser, not a repository map or production scenario.

The captures are at [docs/visual-audit](visual-audit/). They are baseline evidence only; they are not acceptance images for a future implementation.

| Evidence | File | What it shows |
|---|---|---|
| Rifle projectile flight | [combat-baseline-rifle-projectile.png](visual-audit/combat-baseline-rifle-projectile.png) | Two riflemen at four tiles; muzzle flashes and two tiny projectile points at tick 1. |
| ATGM projectile flight | [combat-baseline-atgm-projectile.png](visual-audit/combat-baseline-atgm-projectile.png) | An ATGM gunner and a tank; the missile and the tank's shell are both small dots, with no readable class distinction. |
| Tank projectile flight | [combat-baseline-tank-projectile.png](visual-audit/combat-baseline-tank-projectile.png) | Two MBTs exchanging fire; shell points are visible but have no tracer or direction. |
| Tank impact | [combat-baseline-tank-impact.png](visual-audit/combat-baseline-tank-impact.png) | Two simultaneous hits at tick 3. Identical yellow fireballs obscure both hulls; health bars are the clearest damage cue. |
| Tank mutual destruction | [combat-baseline-tank-mutual-destruction.png](visual-audit/combat-baseline-tank-mutual-destruction.png) | Tick 207: both tanks are removed immediately, leaving four overlapping explosion blobs at two points. |
| Dense engagement | [combat-baseline-dense.png](visual-audit/combat-baseline-dense.png) | Eight riflemen and four tanks; two tank deaths produce four bright fireballs that dominate the reading. |
| Fog incoming fire | [combat-baseline-fog-incoming.png](visual-audit/combat-baseline-fog-incoming.png) | A rifleman with seven-tile vision; an ATGM gunner eight tiles away is hidden, while the missile becomes visible only as it enters the lit area. |
| Static gun muzzle | [combat-baseline-atgun-muzzle.png](visual-audit/combat-baseline-atgun-muzzle.png) | Zoom-18 view of an Anti-Tank Gun. The muzzle flash is above the emplacement, not at the barrel. |

### 2.2 Measured baselines

All timings below are **CPU render-submission time** measured by wrapping WebGL draw calls around `Renderer.render()` for 12 frames after a warm-up and a `gl.finish()`. They are not GPU time and not total frame time. The map is deliberately small and flat, so the draw-call/triangle figures are a controlled comparison point, not a production-map budget.

| Scene | Tick | Units | Projectiles/particles at freeze | Draw calls | Triangles | CPU submission |
|---|---:|---:|---:|---:|---:|---:|
| Rifle vs rifle | 1 | 2 | 2 / 4 | 18 | 16,102 | 0.10–0.11 ms |
| ATGM vs tank | 1 | 2 | 2 / 5 | 17 | 16,956 | 0.14 ms |
| Tank vs tank | 1 | 2 | 2 / 4 | 16 | 17,598 | 0.13 ms |
| Dense, first kill | 106 | 12 → 10 | 0 / 211 | 40 | 24,116 | 0.18 ms |
| Dense, particles cleared at same frame | 106 | 10 | 0 / 0 | 38 | 23,694 | 0.25 ms |
| Fog incoming, tick 4 | 4 | 2 | 1 / 4 | 12 | 14,200 | 0.10 ms |

The particle/no-particle CPU comparison is within measurement noise on this machine; it is not evidence that particles are free. The 211-particle dense frame is below the system's `MAX_PARTICLES = 2800` cap, so the cap was not exercised by this baseline. No GPU timer-query path exists in the project, so GPU cost cannot be reported. WebGL draw calls and triangles are the only frame-cost counters available.

The controlled arena had no shader compile errors or JavaScript console errors. Audio assets returned HTTP 206 during the session; some media range requests were aborted during soundtrack changes. No listening test was performed.

### 2.3 Baseline limitations

- The flat diagnostic arena is not representative of the real Kestrel Bay or Foundry District silhouette clutter.
- The captures use a fixed tick and manually stepped simulation; they do not measure frame pacing during a live firefight.
- Human recognition of weapon class, hit/miss and suppression was **not** tested. Visual judgements in this report are code- and image-grounded, not a reviewer study.
- Audio playback was not heard through automation. The runtime logging confirms which sound names were requested; it does not confirm the mix in headphones.
- The `showFog` leak and the un-gated trail path are confirmed in source. A fully hidden missile frame could not be retained with the short-range ATGM fixture because the projectile crossed the visibility boundary before the first drawable frame. The trail issue therefore has source evidence, not a dedicated visual reproduction.

---

## 3. Verified architecture and event flow

### 3.1 Simulation tick

`Game.tick()` increments the fixed tick, processes commands, updates buildings and AI, updates units and garrisons, advances projectiles, cleans dead entities and refreshes vision on its interval (`src/sim/game.ts:2323–2346`).

`SimEvent` has a rolling 240-event buffer (`src/sim/game.ts:4635–4641`). The app and renderer each maintain an independent `lastEventSeq`, so both can consume the same stream without acknowledging it for the other (`src/app.ts:1025–1046`, `src/render/renderer.ts:845–907`).

### 3.2 Firing path

`tryFire()`:

- validates range, minimum range, line of sight and target visibility;
- consumes primary ammunition and sets cooldown;
- lays the turret on the target;
- rolls hit/miss and scatter;
- computes the muzzle point from the authored hardpoint;
- creates a `Projectile` with `weaponId`, kind, speed, splash, damage, armour multipliers, suppression and optional lob arc;
- emits one `shot` event with `entityId`, position and a `sound` name derived only from `WeaponFx` (`src/sim/game.ts:3725–3792`).

The projectile has full source data, but the **event** carries only the shooter id and position. It does not carry `weaponId`, projectile kind, calibre or intended effect scale.

`muzzlePoint()` is correct for land and air units with an authored hardpoint, but every building uses its centre at `heightAt + 3.5` (`src/sim/game.ts:3799–3812`). The controlled Anti-Tank Gun capture recorded a shot event at `y = 4.65` while the ground under the gun was `1.15`; the emplacement's barrel is not three and a half world units above its base. This is a presentation mismatch on every static weapon, even though the gameplay projectile path is unchanged.

### 3.3 Projectile and impact path

`updateProjectiles()` advances projectiles once per tick. Lobbed shells add a vertical arc; homing missiles update their target point each tick; on reaching the target point, `impact()` runs (`src/sim/game.ts:4304–4346`).

`impact()`:

- selects entities in a radius (splash or 1.6 world units);
- applies armour-multiplied damage and suppression;
- emits a single `explosion` event when `splash > 0`, otherwise an `impact` event;
- adds `sound: 'explosion' | 'impact'` (`src/sim/game.ts:4348–4384`).

There is no `hit` event, no per-target event and no surface/target metadata on the impact event. A near miss and a hit that damages a target produce the same event type; only the receiver's `lastHitTick` and health reveal the difference.

`damageEntity()` sets `lastHitTick`, applies damage, and on death sets `state = 'dead'`, emits `unitLost` or `buildingLost`, and clears orders (`src/sim/game.ts:4387–4451`). `cleanup()` removes dead entities from `byId` and `state.entities` in the same tick (`src/sim/game.ts:4488–4510`). There is no wreck, debris field, scorch decal or persistent destruction entity.

### 3.4 Presentation consumers

| Consumer | Evidence | Behaviour |
|---|---|---|
| Renderer event effects | `src/render/renderer.ts:845–907` | Fog-gates each event by the event tile, then spawns muzzle, impact, explosion, death or building effects. No weapon metadata is available. |
| Projectile trails | `src/render/renderer.ts:826–843` | Only missiles and SAMs spawn smoke. Runs over every projectile with **no visibility test**. |
| Projectile drawing | `src/render/renderer.ts:1709–1753` | Draws every projectile as two additive billboard points. Fog-gates only when `settings.showFog` is on. No interpolation, no orientation, no tracer geometry. |
| Particles | `src/render/particles.ts` | Generic fireball, smoke, dust, sparks and impact primitives. `MAX_PARTICLES = 2800`; oldest particle is shifted out when full. |
| Entity hit flash | `src/render/renderer.ts:1407`, `src/render/renderer.ts:1507–1530` | Whole-mesh additive flash for three ticks after `lastHitTick`. |
| Health/suppression overlay | `src/ui/overlay.ts:344–420` | Health bars for damaged, hovered or selected entities; suppression bar only when selected and above `0.2`. |
| Combat audio | `src/app.ts:1035`, `src/ui/audio.ts:524–590` | Synth sounds requested only for `ev.team === localPlayerId`; one global SFX bus, minimum gaps rather than spatialisation. |
| Strategic voice | `src/ui/announcer.ts:46–126` | Separate priority/cooldown channel for base/force attack, losses, sites, production and victory. |

### 3.5 Current feedback status

The table uses the requested implementation states. “Implemented and verified” means source plus a running capture or test, not a visual preference.

| Area | Status | Evidence |
|---|---|---|
| Firing source / direction | **Partially implemented** | `shot` event, muzzle position for units, muzzle particles. Static-building muzzle height is wrong; many weapon classes share the same small flash. |
| Projectile travel | **Partially implemented** | All projectile kinds are simulated and drawn. Points are un-interpolated and visually indistinguishable at battle zoom for bullets and shells. |
| Weapon impact | **Partially implemented** | Impact/explosion events and ground/water particles exist. No weapon, surface or target metadata; air impacts use ground height. |
| Hit vs near miss | **Partially implemented** | Hit flash and health reduction exist. No hit event or impact-type cue; at zoom 36 the difference is usually health-bar-only. |
| Damage communication | **Partially implemented** | Health bars, whole-mesh hit flash, damage smoke below 50% HP. No directional damage, no armour-state cue and no damage event. |
| Suppression / morale | **Partially implemented** | Simulation applies suppression to accuracy and speed. Presentation is a 2 px amber bar for selected units only; morale/rout is absent by design. |
| Destruction | **Partially implemented** | One `unitLost`/`buildingLost` event and a particle burst. No wreck, rubble, debris field or persistent change; entity disappears immediately. |
| Explosion scaling | **Partially implemented, generic** | `explosion` case always uses scale `0.85`; `unitLost` uses `1.15`; `buildingLost` uses `2.6`. No calibre or weapon class affects scale. |
| Smoke / debris | **Partially implemented** | Smoke, dust and damage smoke exist. No debris chunks or persistent smoke columns; trail particles bypass fog. |
| Tactical awareness | **Partially implemented** | Selected units draw a target ring. No incoming-fire direction, no team-coded projectile, no off-screen combat cues beyond the announcer. |
| Audio feedback | **Partially implemented** | Local synth weapon sounds and the strategic announcer work. Enemy shots/impacts are silent; no distance or pan. |
| Dense engagements | **Partially implemented** | Batched particles and a cap exist. Fireball stacking obscures units; duplicate death bursts inflate particle load and reduce readability. |
| Fog integrity | **Partially implemented** | Event effects and projectile points are gated in normal use. Trails are ungated; `showFog = false` disables projectile gating, revealing hidden projectiles. |

---

## 4. Combat-feedback coverage matrix

### 4.1 Weapon firing

**Current:** A `shot` event is emitted at the actual muzzle for units, and the renderer spawns a flash plus one smoke particle. The `big` flag is true only for `tank` and `corvette` (`src/render/renderer.ts:868`). The static-building muzzle is the building centre at `+3.5`. There is no calibre or class metadata on the event.

**Player sees:** A bright blob, often larger than a rifleman, with no reliable relationship between the flash size and the weapon. Tank and corvette are the only units that read as “large”, and even then only by definition id. The Anti-Tank Gun's flash floats above its roof.

**Shortcoming:** The firing signature does not identify the weapon class, and static guns fire from the wrong visual point.

**Owner:** simulation event contract + renderer effect mapping.

**Classification:** Confirmed correctness defect for static muzzle height; confirmed readability weakness for class signatures.

**Acceptance test:** A shot event for each class carries the source weapon or a mapped `fxClass`; the renderer's flash origin is within `0.35` world units of the authored hardpoint for units and within `0.35` of the visible barrel tip for static weapons; a tick-0 state hash is unchanged.

### 4.2 Projectile travel

**Current:** `Projectile` has kind, speed, position and target point. `drawParticles()` draws a point and a second, dimmer, trailing point. No interpolation. Smoke trails only for missiles/SAMs (`src/render/renderer.ts:1709–1753`). Bullet speed is 60 tiles/s, shell speed 38, ATGM speed 13 (`src/data/weapons.ts:4–58`).

**Player sees:** At 20 ticks/s, a rifle bullet moves three tiles per tick; a typical four-tile rifle exchange gives roughly one drawable in-flight frame. Tank shells move 1.9 tiles per tick. At zoom 36 the projectile is a tiny warm dot, and the eye is drawn to the muzzle flash instead.

**Shortcoming:** No readable line of flight; no motion continuity; no class-specific trail. ATGM and shell are visually close until the missile's smoke builds.

**Owner:** renderer presentation.

**Classification:** Confirmed readability weakness and confirmed absence of interpolation.

**Acceptance test:** At 1600×900 and zoom 36, a reviewer can follow the projectile from muzzle to impact in a replay of each class. A bullet tracer remains visible for every in-flight render frame, not only at the simulation tick. Presentation positions are interpolated from a renderer-owned previous/current pair; `stateHash()` is unchanged.

### 4.3 Weapon impact

**Current:** `impact()` emits one event with no weapon, surface, target or splash radius (`src/sim/game.ts:4348–4384`). The renderer uses `groundY + 0.5` for every impact and every explosion, ignoring the projectile's `ty`; water impacts use a separate water splash (`src/render/renderer.ts:871–886`).

**Player sees:** Dust/sparks on the ground and an orange fireball for splash. Air targets produce ground-level bursts. An impact on a building's upper floors still bursts at ground level. There is no distinction between a shell hitting soil, armour or water beyond the water splash.

**Shortcoming:** Impact point is not preserved for vertical targets; surface and weapon class are unavailable; all splash explosions look the same.

**Owner:** event contract + renderer effect mapping.

**Classification:** Confirmed correctness defect for air/high-target effects; confirmed visual weakness for surface specificity.

**Acceptance test:** A SAM hit on an aircraft produces a burst at the aircraft's impact height, not on the ground. A shell hit emits `surface: 'ground'|'armour'|'structure'|'water'` and the renderer uses the correct effect; a rifle hit and a cannon hit are distinguishable at normal zoom.

### 4.4 Successful hit vs near miss

**Current:** A successful hit sets `lastHitTick`, causing a three-tick whole-mesh flash (`src/render/renderer.ts:1407`). Health bars update. There is no `hit` event, no per-target impact and no hit marker. A miss still emits `impact` or `explosion` at the scattered endpoint.

**Player sees:** At zoom 36, a miss and a hit produce the same ground burst. The only reliable hit cue is the target's health bar or a brief flash that is often buried under the explosion.

**Shortcoming:** The player cannot consistently distinguish “my shot missed” from “my shot hit and damaged” without reading a bar.

**Owner:** event contract + renderer/overlay.

**Classification:** Confirmed readability weakness; no defect in damage resolution.

**Acceptance test:** In a fixture with both a hit and a miss, a reviewer can identify which target was hit without reading the health number. The presentation must derive the hit cue from the authoritative impact result, not from a separate random roll.

### 4.5 Damage

**Current:** Health bars, whole-mesh flash, and passive damage smoke below 50% HP, more severe below 25% (`src/render/renderer.ts:780–822`, `src/ui/overlay.ts:344–420`). No damage event, no directional indicator, no armour-penetration state.

**Player sees:** A selected/damaged unit loses health; at low HP it smokes. A hit in a dense fight is mostly a bar change and a flash.

**Shortcoming:** Damage is legible only through UI; the body does not accumulate readable damage at normal zoom until 50% HP.

**Owner:** renderer + overlay; event design.

**Classification:** Confirmed visual weakness / presentation opportunity.

**Acceptance test:** A damaged vehicle shows at least one persistent, non-text damage cue at normal zoom before 50% HP (scorch, smoke, damaged track/wheel), and the cue survives a fog transition without revealing hidden state.

### 4.6 Suppression and morale

**Current:** Suppression raises accuracy penalty and movement penalty (`src/sim/game.ts:3742`, `4060`); it decays over time. The overlay draws a 2 px amber bar only when the unit is selected and suppression is above `0.2` (`src/ui/overlay.ts:414–417`). Morale/rout is absent.

**Player sees:** A selected suppressed unit has a thin amber underline. Unselected suppressed units look and sound normal. There is no pose change, no incoming-fire flinch, and no warning that an attack is being degraded.

**Shortcoming:** A state that materially changes accuracy and speed is nearly invisible at the zoom where the player commands.

**Owner:** overlay and renderer; simulation state is already available.

**Classification:** Confirmed readability weakness; simulation itself is complete for the current design.

**Acceptance test:** A suppressed unit has a non-colour-only cue visible at zoom 36 without being selected (for example a small shield/pinned icon in the existing banner, or a body pose/flinch), and the exact simulation values remain untouched.

### 4.7 Destruction

**Current:** On death, `damageEntity()` emits `unitLost`/`buildingLost`, then `cleanup()` removes the entity in the same tick. The renderer spawns an explosion at the event point (`src/sim/game.ts:4387–4451`, `4488–4510`; `src/render/renderer.ts:884–895`). There is no wreck, corpse, rubble, debris or persistent mark.

**Player sees:** A tank vanishes inside one or two fireballs. A building disappears. The battlefield returns to clean grass after four seconds of smoke. Two tanks killed in the same volley left two bright blobs and no hulls.

**Shortcoming:** Destruction has no persistent evidence and is visually indistinguishable from a large hit. It also produces duplicate bursts for splash kills.

**Owner:** renderer presentation state; no need for a new simulation entity.

**Classification:** Confirmed visual weakness; duplicate effect is a confirmed defect.

**Acceptance test:** A vehicle death produces exactly one consolidated destruction burst and one bounded wreck/hulk per death. The wreck is presentation-only, does not enter picking, collision, fog state or saves, and is cleared on match teardown. A building death produces one destruction sequence and leaves a ruin/rubble mark consistent with the existing `ruin` visual language if one is added later.

### 4.8 Explosions

**Current:** `explosion` effect always uses `scale = 0.85`; `unitLost` uses `1.15`; `buildingLost` uses `2.6` (`src/render/renderer.ts:874–895`). `ParticleSystem.explosion` creates a white-yellow flash, fire particles, grey smoke and optional team sparks (`src/render/particles.ts:56–104`). The same generic effect is used for a 60-damage tank shell, a 105-damage heavy shell and a 58-damage strike missile.

**Player sees:** Large, bright, nearly identical fireballs for every splash weapon. At battle zoom the fireball often covers the firing/target unit and its health bar. It looks more arcade than the restrained material language established for buildings and terrain.

**Shortcoming:** No calibre/category scale; explosions are too bright/large relative to units at zoom 36; they dominate rather than clarify.

**Owner:** effect mapping and particle parameters.

**Classification:** Confirmed visual weakness; no correctness issue in damage resolution.

**Acceptance test:** A rifle impact, a tank shell, a 155 mm shell and an ATGM produce distinguishable signatures at zoom 36 in a blind side-by-side review. The largest explosion must not hide the target's health bar for more than a short, specified beat. GPU/CPU cost must remain within the measured baseline budget.

### 4.9 Smoke and debris

**Current:** Smoke, dust, water splash, track dust, damage smoke and missile trail smoke exist. Debris is limited to sparks; there are no chunks, shell casings or persistent smoke columns. Particle draw is two instanced batches, additive and normal (`src/render/particleGpu.ts:103–130`). No sorting.

**Player sees:** Smoke is soft and short-lived; it can read as a dark halo around an explosion. A missile leaves a sparse smoke trail. Wrecks and fires do not persist.

**Shortcoming:** No debris or persistent smoke to sell destruction; trail visibility breaks fog.

**Owner:** renderer particle system.

**Classification:** Confirmed visual weakness; trail fog gap is a confirmed visibility defect.

**Acceptance test:** A killed tank leaves a bounded smoke column and debris for a defined lifetime; no trail particle is drawn in an unexplored or hidden tile; particle count remains below the cap in the dense fixture.

### 4.10 Tactical awareness

**Current:** Selected units show a red target ring around their current target (`src/ui/overlay.ts:98–121`). Health bars carry a team-coloured edge; the unit body carries team colour. Projectiles do not carry a team colour or a source marker. The only off-screen cue is the announcer and alert toast.

**Player sees:** A selected unit's target, but not a clean direction of incoming fire. Projectiles are all warm-coloured, so the player cannot tell friendly from hostile flight at a glance. Enemy audio is absent.

**Shortcoming:** Incoming direction and ownership of fire are weak at normal zoom.

**Owner:** renderer projectiles + audio + overlay.

**Classification:** Confirmed visual weakness / design opportunity.

**Acceptance test:** Visible hostile and friendly projectiles remain distinguishable without relying on hue alone (for example trail shape/source marker), and enemy fire in visible ground produces an audible directional cue while hidden fire remains silent.

### 4.11 Audio feedback

**Current:** `AudioEngine` synthesises rifle, cannon, missile, SAM, explosion and impact sounds. `App.drainEvents()` calls `audio.play(ev.sound)` only when `ev.team === localPlayerId` (`src/app.ts:1030–1036`). `AudioEngine.play()` applies global minimum gaps of 55/70/60 ms for rifle/cannon/explosion (`src/ui/audio.ts:524–530`). It has no distance attenuation, stereo pan or per-unit variation. The strategic announcer has its own priority/cooldown/duck path and is working.

**Player sees/hears:** Local weapon fire and local impacts are audible; enemy fire and enemy impacts are silent even when visible. The warning voice tells the player they are under attack, but the combat itself has no incoming sound. At high unit counts, local events are coalesced by the global gap.

**Shortcoming:** The audio layer is player-only and non-spatial. The minimum gap also suppresses simultaneous local explosions without any priority or distance weighting.

**Owner:** audio dispatch + audio engine.

**Classification:** Confirmed behaviour; whether enemy audio is a defect or a deliberate clarity choice requires a design decision. The current implementation is inconsistent with “combat feedback” because visible combat is silent.

**Acceptance test:** Visible hostile fire produces a quieter, distance-attenuated sound; hidden hostile fire produces none. Local and hostile events share one mix policy, with duplicate suppression based on event id/class rather than only a global time gap. Mute/volume still suppress all combat sound.

### 4.12 Dense engagements

**Current:** Effects are batched into two particle draw calls and capped at 2,800. The controlled 12-unit fight peaked at 211 particles, 40 draw calls, 24,116 triangles and 0.18 ms CPU submission. The duplicate death bursts produced four large fireballs for two kills.

**Player sees:** A cluster of bright blobs around the dying tanks; riflemen are tiny dark figures nearby. Fireballs overlap and hide the hulls. Health bars remain readable when they are above the fireball, but the scene reads as “three explosions” rather than “two tanks died and four rifle squads are still alive”.

**Shortcoming:** Readability, not raw frame cost, is the limiting factor at this scale. Duplicate bursts amplify the problem.

**Owner:** effect mapping, event consolidation, particle parameters.

**Classification:** Confirmed readability weakness; measured cost is acceptable in this fixture.

**Acceptance test:** In the dense fixture, every surviving unit remains identifiable after the volley without moving the camera; total effect bursts equal the number of authoritative impact/destruction events; peak particles stay below `800` in this fixture; draw calls do not increase beyond the existing particle batches.

### 4.13 Fog of war

**Current:** `consumeEvents()` filters by local player or visible tile (`fogAt(team, tile) === 2`) before spawning event effects (`src/render/renderer.ts:845–860`). Entity drawing uses `visionStateOf()` and remembered buildings are dimmed. Ambient smoke uses `isVisibleTo`. However:

- `updateProjectileTrails()` has no visibility test (`src/render/renderer.ts:826–843`).
- `drawParticles()` gates projectiles only when `settings.showFog` is true (`src/render/renderer.ts:1728`). The setting is labelled “Visual fog; gameplay detection is unchanged” (`src/app.ts:1862`). With fog visuals off, hidden projectiles are drawn.
- All existing particle positions are drawn regardless of fog; a trail or smoke cloud that was spawned while visible can drift across a fog boundary.
- The fog fixture shows the intended positive case: an ATGM gunner eight tiles away is hidden, while its missile becomes visible when it enters the lit radius. It does **not** prove the trail or visual-toggle cases are safe.

**Player sees:** Normally, hidden shooters are not shown and only the visible segment of a projectile appears. If the player disables visual fog, hidden projectiles can appear in unexplored ground. Missile smoke can leak a path into fog even with visuals on.

**Shortcoming:** Presentation visibility is not derived from one shared policy.

**Owner:** renderer effect/projectile visibility.

**Classification:** Confirmed implementation defect. It does not reveal units directly, but it reveals hidden fire paths and breaks the stated meaning of the fog-toggle setting.

**Acceptance test:** With fog visuals both on and off, no projectile, trail particle or event effect is rendered in an unexplored/hidden tile. Friendly projectiles may be shown only in visible tiles. Tests should cover a projectile crossing a fog boundary and a hidden launch.

### 4.14 Performance safeguards

**Current:** Two particle batches, `MAX_PARTICLES = 2800`, entity culling by camera distance for ambient effects, event effects gated by fog, missile trail cadence 35 ms, projectile points pooled only as temporary objects (not reused). Particle objects are not pooled; when full, `Array.shift()` is O(n). The event buffer is capped at 240.

**Assessment:** The current scale is acceptable: 211 particles, 40 draw calls, 24k triangles and 0.18 ms CPU submission. There is no evidence of a frame-rate collapse in the fixture. The cap and event buffer are sensible. The remaining risk is a dense late-game fight where duplicate bursts and persistent smoke repeatedly fill the buffer.

**Classification:** Not a current defect; a measured boundary and a future risk.

**Acceptance test:** A 30-unit-per-side stress fixture remains under the project's provisional frame budget, peak particles do not sit at the cap for sustained periods, and the new profiles do not add draw calls or per-projectile allocations.

---

## 5. Prioritised findings

| ID | Finding | Evidence | Type | Priority |
|---|---|---|---|---|
| CF-01 | A splash kill emits both an `explosion` impact and a `unitLost`/`buildingLost` event; the renderer explodes both. Two tank deaths produced four large bursts and 211 particles. | `game.ts:4376`, `game.ts:4411`, `game.ts:4433`; `renderer.ts:874–895`; [mutual destruction](visual-audit/combat-baseline-tank-mutual-destruction.png) | Confirmed defect | P0 |
| CF-02 | Event contract has no weapon/calibre/surface metadata, so all splash explosions share one scale and all bullet impacts look alike. | `types.ts:524–546`; `game.ts:4376–4383`; `renderer.ts:874–886` | Confirmed architectural gap | P0 |
| CF-03 | Projectiles are un-interpolated billboards, visible for 1–3 ticks for bullets/shells at standard battle zoom. | `renderer.ts:1709–1753`; `weapons.ts:4–58`; [rifle flight](visual-audit/combat-baseline-rifle-projectile.png) | Confirmed readability defect | P0 |
| CF-04 | Static weapons fire their visual muzzle at building centre `+3.5`, not at the barrel; the AT Gun flash floats above the roof. | `game.ts:3799–3812`; [AT gun muzzle](visual-audit/combat-baseline-atgun-muzzle.png) | Confirmed correctness defect | P1 |
| CF-05 | Air/high impacts are rendered at `groundY + 0.5`; event `y` is ignored for impact and explosion effects. | `renderer.ts:871–886`; `game.ts:4365–4383` | Confirmed correctness defect | P1 |
| CF-06 | Hidden projectile trails are ungated; projectile points are ungated when `showFog` is off. | `renderer.ts:826–843`, `renderer.ts:1728`; `app.ts:1862` | Confirmed visibility defect | P0/P1 |
| CF-07 | Enemy shots, impacts and explosions are silent; only `ev.team === localPlayerId` gets `audio.play()`. | `app.ts:1030–1036`; runtime audio log | Confirmed behaviour / design decision | P1 |
| CF-08 | Hit vs miss has no event or impact cue; only health bars and a short whole-mesh flash distinguish it. | `game.ts:4376`; `renderer.ts:1407`; `overlay.ts:344–420` | Confirmed readability weakness | P1 |
| CF-09 | Suppression is a 2 px bar only on selected units, despite affecting accuracy and speed. | `overlay.ts:414–417`; `game.ts:3742`, `4060` | Confirmed readability weakness | P2 |
| CF-10 | No wrecks, rubble, scorch or persistent destruction; dead entities are removed in the same tick. | `game.ts:4488–4510`; [mutual destruction](visual-audit/combat-baseline-tank-mutual-destruction.png) | Confirmed absence | P2 |
| CF-11 | Explosions use a generic white-yellow fireball that often obscures units and health bars; same scale from tank gun to heavy artillery. | `particles.ts:56–104`; `renderer.ts:874–895`; [tank impact](visual-audit/combat-baseline-tank-impact.png) | Confirmed visual weakness | P2 |
| CF-12 | Visible enemy fire produces no audio; no spatial attenuation/pan. | `app.ts:1035`; `audio.ts:524–590` | Confirmed behaviour / design decision | P2 |
| CF-13 | Projectiles and tracers are not team-coded; target acquisition ring exists only for selected units. | `renderer.ts:1717–1750`; `overlay.ts:98–121` | Confirmed visual weakness | P3 |
| CF-14 | Dense fights have no presentation LOD: every impact gets the same effect and smoke persists for up to 4 s. | `particles.ts:56–104`; dense baseline | Confirmed readability weakness | P2 |

### What is already working and should not be rebuilt

- The simulation event stream is deterministic, presentation-neutral and already consumed by both the app and renderer.
- Projectile simulation, armour multipliers, suppression, fog selection and death transitions are correct in the existing tests.
- Unit muzzle hardpoints and turret transforms are already correct for mobile weapons, including turreted hulls.
- The particle renderer is efficiently batched into two draw submissions.
- The strategic announcer has a solid priority, cooldown and interruption model, including music ducking.
- The fog filter for event effects is directionally correct; the fix is to make it universal rather than replace it.

---

## 6. Visual design principles for combat feedback

1. **Class before unit.** A rifle, an autocannon, a tank gun, an ATGM and a howitzer should read differently because of their weapon class, not because a particular mesh id was hard-coded.
2. **Three readable beats.** Fire → flight → impact. Each must be visible at zoom 36, with the muzzle flash identifying the source, the projectile establishing direction, and the impact locating the result.
3. **Restraint over spectacle.** MCA's established look is grounded and material-led. Short low-opacity smoke, a focused flash and a small debris signature are more convincing than a large white ball.
4. **One authoritative result, one presentation event.** A death should not produce an impact explosion and a second “death” explosion for the same point. Consolidate at the source or at the renderer’s event boundary.
5. **Damage should accumulate on the body.** A hit flash is a moment; a scorch, damaged track, smoke plume or exposed structure is a state. The latter is what lets a player assess a fight without reading UI.
6. **Destruction should leave evidence.** A wreck or rubble marker is valuable not because it is realistic, but because it preserves the outcome of a fight and makes the battlefield legible.
7. **Fog is a presentation gate, not a visual effect.** Turning fog visuals off may change what the player sees of the *terrain*, but must not reveal hidden projectiles, trails or impacts.
8. **Do not rely on colour alone.** Team colour is useful, but shape, direction, timing and source markers must carry the meaning at small sizes and for colour-vision-deficient players.
9. **Density has a budget.** Define per-class particle caps and coalesce repeated impacts. The particle system should degrade by simplifying the least important effects, not by hiding units or health bars.
10. **Audio is feedback, not decoration.** Visible combat should be audible from both sides with distance attenuation; hidden combat must remain silent. Voice remains a separate command channel.
11. **No new rendering pass unless the audit proves one is necessary.** The existing instanced particle path can express all of the first slice; the only probable new data is a presentation-only wreck list.

---

## 7. Recommended first implementation vertical slice

### 7.1 Shared foundation (build first)

The slice should introduce one data-driven presentation layer, not separate bespoke code for each weapon.

**A. Add presentation-only metadata to the simulation events.**

Proposed optional fields on `SimEvent`:

- `weaponId?: string` (or a derived `fxClass: 'rifle' | 'autocannon' | 'cannon' | 'atgm' | 'artillery' | 'sam' | 'navalGun'`);
- `fxScale?: number` (presentation hint derived from calibre/splash, not a gameplay value);
- `surface?: 'ground' | 'water' | 'armour' | 'structure' | 'air'`;
- `targetId?: number` for impact attribution;
- `hit?: boolean` for hit versus near miss;
- `effectPoint?: { x: number; y: number; z: number }` for high/air impacts, or populate the existing `y` on impact/explosion events.

These fields are presentation-only, derived at the simulation boundary from existing weapon/projectile data. They must not be added to `stateHash()`, must not affect RNG, targeting, damage or save migration semantics, and must default safely for old saves and external events. The existing `SimEvent` is already optional-field-friendly and the event buffer is excluded from `stateHash()` (`game.ts:4837–4878`).

**B. Add one `CombatFxProfile` table.**

A single table keyed by weapon class defines:

| Profile | Muzzle | Flight | Impact | Destruction |
|---|---|---|---|---|
| Rifle | small warm flash, 0.1 s | 0.6–0.9 tile pale tracer, short | small dust/spark puff | none (infantry) |
| Autocannon | medium flash | 1.2-tile tracer, thin | metal/ground sparks | small |
| Cannon | larger directional blast, smoke ring | 1.5–2.5-tile orange tracer | hard flash + dust/armour sparks | medium, one burst |
| ATGM | booster puff + bright launch | persistent smoke ribbon, occasional flicker | shaped charge flash + smoke | medium |
| Artillery | large blast + ground dust ring | arcing shell with smoke trail | wide dust, delayed smoke | large |
| SAM | bright booster | thin white smoke, fast closing | airburst at target height | small |
| Naval gun | medium blast | tracer | water/ground splash | medium |

The exact numbers are implementation decisions; the table belongs in one readable file so future weapons can be added without touching gameplay code.

**C. Fix the event effect pipeline.**

- One `effect` profile per event; no renderer code path should inspect `shooter.defId === 'tank'` to decide flash size.
- Consolidate death: either do not emit the impact `explosion` when the impact kills and a `unitLost`/`buildingLost` is emitted, or make the renderer dedupe by entity/tick and keep the larger destruction effect. The authoritative damage path must not change.
- Use `surface`/`effectPoint` for impact placement, including air targets.
- Replace the building-centre muzzle for event presentation with a renderer-owned barrel mount derived from the existing building rig/turret. Do not change the projectile's simulation origin; if the visual and simulation origin must differ, document it as a visual-only offset and test that no gameplay outcome changes.

**D. Make projectile rendering continuous and class-readable.**

- Track previous and current projectile positions in a renderer-only map, keyed by projectile id.
- Interpolate positions using the frame accumulator between fixed ticks.
- Draw a short oriented streak or a chain of additive points along the flight vector. Use the profile's colour, width and length.
- Keep the existing missile smoke ribbon, but emit only at a cadence that remains below the particle budget.
- Gate both projectile and trail drawing through one visibility function, independent of `settings.showFog`.

**E. Audio.**

- Generalise sound dispatch from “local team only” to a visible-event policy: local events always; hostile events only when their presentation point is visible.
- Add a distance attenuation/pan stage to the existing Web Audio graph. Do not add a third-party audio dependency.
- Keep the current event-name minimum gaps as a last-resort limiter, but let the event id/class handle duplicates so two distinct visible explosions in one frame are not flattened into one arbitrary sound.
- Preserve master mute, effects volume and voice priority.

### 7.2 Engagement A — Rifle infantry versus infantry

**Representative fixture:** one Rifleman per side at four tiles, open ground, no cover; repeat at six tiles (maximum rifle range) and with one squad advancing.

**Expected simulation sequence:** `shot` × 2 → one `impact` per projectile → possibly no damage or 7 × 1.45 infantry damage → `unitLost` after enough hits.

**Present now:** muzzle flash, bullet point, ground impact dust, health bars, hit flash, rifle synth sound.

**Audit gap:** the bullet is visible for roughly one in-flight frame at four tiles; the muzzle flash is the largest object in the exchange; a hit and a miss look the same at zoom 36.

**Minimum changes:** rifle profile; interpolated pale tracer; impact dust/spark based on surface; hit flag from the authoritative impact; no new unit geometry. Keep the flash small enough not to obscure the rifleman.

**Cost:** no new draw calls; one extra pair of positions per projectile; a few extra particles per shot. CPU cost should be below the existing noise floor.

**Tests/screenshots:** event mapping test; hit-vs-miss fixture; matched 1600×900 zoom-36 and zoom-18 captures; determinism hash unchanged over 30 s.

### 7.3 Engagement B — Anti-tank weapon engagement

**Representative fixture:** ATGM gunner at 44,32 versus MBT at 51,32 (seven tiles); repeat with the AT Gun emplacement versus the same tank.

**Expected sequence:** ATGM `shot` → homing missile in flight for ~0.5 s → impact → 44 × heavy 1.65 damage → suppression → possibly `unitLost`.

**Present now:** missile point with a sparse smoke trail; generic explosion; unit flash/health; cannon sound for the target's return fire.

**Audit gap:** ATGM and tank shell are both small dots at first sight; the missile trail is not class-specific enough; the static AT Gun flash is at building centre height; the impact is generic; a miss and a hit share an effect.

**Minimum changes:** profiled ATGM booster/trail/impact; static muzzle anchor for the AT Gun presentation; ATGM launch audio distinct from cannon; hit/surface flags. Do not change ATGM speed, damage, guidance or hardpoints.

**Cost:** the missile trail is the main particle consumer; a bounded cadence and `MAX_PARTICLES` protection are required. No new shader or pass.

**Tests/screenshots:** event `weaponId`/`fxClass` assertions; static muzzle point within 0.35 world units of the visible barrel; missile trail stops at fog boundary; matched ATGM/AT-gun captures at zoom 36 and 18; tick-0 and 30 s hashes.

### 7.4 Engagement C — Tank versus tank

**Representative fixture:** two MBTs at five tiles, both stationary; repeat once with one tank moving.

**Expected sequence:** `shot` × 2 → shell flight ~0.1–0.2 s → impact explosion → 60 × heavy 1.85 damage and suppression → repeat until `unitLost` → one consolidated destruction.

**Present now:** tank muzzle flash, shell points, generic explosion, health bars, damage smoke, immediate removal on death.

**Audit gap:** two stacked explosions on death; no wreck; fireball obscures both hulls; no readable difference between a hit and a near miss; no persistent evidence of the engagement.

**Minimum changes:** one cannon profile; interpolated tracer; one consolidated destruction burst; bounded presentation-only wreck/hulk (reuse the existing unit mesh with a charred tint, no turret animation) for at least the vehicle classes in scope; 3–5 debris particles. Do not add a wreck entity to `GameState`, picking or saves.

**Cost:** one extra static mesh draw per wreck if a separate draw is used. The first slice should cap wrecks per match (for example 24) and clear them on restart/menu. If a zero-draw-call solution is required, reuse the existing `buildingLost` smoke budget first and defer wrecks to Phase 3.

**Tests/screenshots:** death emits one destruction effect; renderer wreck list is capped and cleared; tick-zero hash unchanged; matched zoom-36 before/after impact and after-death captures; dense fixture remains readable.

### 7.5 Explicitly out of scope for the first slice

- new gameplay mechanics, morale/rout, penetration/ricochet rules or damage-model changes;
- building/wreck collision, pathfinding or picking changes;
- artillery, air and naval full effect sets beyond the shared profile infrastructure;
- terrain scorch decals or a new decal renderer;
- a texture atlas, normal maps or new rendering passes;
- new third-party dependencies;
- a broad particle-system rewrite;
- UI redesign or new HUD panels.

---

## 8. Test and acceptance plan

### 8.1 Automated tests

Add to the existing Vitest suite, mocking no simulation behaviour:

1. **Event contract**
   - every combat weapon maps to exactly one `fxClass`;
   - `shot` carries the actual weapon class and muzzle point for rifle, ATGM, tank and AT Gun;
   - impact events carry surface/hit/effect point for ground, water and air;
   - old event objects without the new optional fields still resolve to a safe default.
2. **Duplication**
   - a splash kill produces exactly one destruction effect after consolidation;
   - two deaths in one tick produce two destruction effects, not four;
   - repeated tick/event consumption does not replay an effect.
3. **Projectile rendering**
   - interpolation is monotonic between two fixed ticks and clamps at impact;
   - an interpolated render position never changes `stateHash()` or projectile state;
   - a hidden projectile and its trail produce no draw entries; `showFog` on/off gives the same visibility result.
4. **Audio**
   - visible hostile fire requests a sound; hidden hostile fire does not;
   - local fire always requests; mute/volume suppresses;
   - duplicate events do not produce duplicate requested sounds;
   - the announcer priority path still interrupts correctly and the music ducks for voice.
5. **Determinism and regression**
   - tick-zero and 30 s `stateHash()` for the controlled rifle/ATGM/tank fixtures;
   - existing `combat`, `weapon-transform`, `air-naval`, `fog-integrity`, `garrison`, `presentation` and `perf` suites remain green;
   - save/load round-trip remains valid with presentation-only events.

### 8.2 Running-game visual checks

Use the existing dev server, the controlled fixtures above, and matched 1600×900 captures at zoom 36 and 18. Each set must include muzzle flash, in-flight projectile, impact and post-impact/death.

Acceptance for human review (not performed in this audit):

- a reviewer who has not seen the implementation can name the weapon class for rifle, ATGM and tank engagements at zoom 36;
- a reviewer can distinguish a hit from a near miss without reading the health number;
- a reviewer can tell which side is firing and where the fire is coming from;
- a reviewer can identify that two tanks died without counting explosion sprites;
- suppression is visible on an unselected unit without relying solely on a thin colour bar;
- a wreck remains identifiable after the smoke clears.

These are proposed acceptance criteria, not claimed results.

### 8.3 Performance acceptance

Use the same CPU submission protocol as the baseline. The first slice should:

- add **no new draw calls** for projectile/tracer effects (reuse the existing particle batches);
- stay under `800` peak particles in the 12-unit dense fixture;
- keep CPU submission within the measured 0.10–0.25 ms range for the controlled scenes, allowing normal run-to-run variance;
- not increase the triangle count for effects (all effects remain billboards);
- cap wreck draws; if wrecks are added, measure their extra draw calls explicitly;
- exercise a fog-on and fog-off run and compare visible draw calls, confirming hidden effects are skipped.

If wrecks require a new draw path, that cost must be measured and reported separately rather than folded into the existing particle budget.

### 8.4 Fog acceptance

No effect, projectile, trail, smoke, flash or audio cue derived from a hidden or unexplored tile may reach the presentation layer. `showFog` may change terrain shading only. Tests must cover:

- a projectile crossing from hidden to visible;
- a trail spawned while visible then drifting into fog;
- a hidden launch;
- a destroyed remembered building outside current vision;
- the existing differential fog tests, which must remain green.

---

## 9. Performance, determinism and implementation risks

### Determinism

The existing simulation has a state hash covering entities, projectiles, RNG and victory (`src/sim/game.ts:4837–4878`). Presentation changes must not alter:

- `tryFire()` timing, aim, hit roll, scatter, damage, suppression or hardpoints;
- projectile positions or impact points;
- the event order or tick of authoritative `shot`/`impact`/`unitLost` events;
- save schemas or migration paths.

Adding optional event metadata to `SimEvent` is safe only if it does not feed the state hash. If events are serialized in saves, the new fields need a migration/default and should not change replay outcomes. A saved event stream is currently kept as the last 80 events (`game.ts:4726`); avoid adding large per-event objects.

### Fog

The correct policy is event-level and trail-level gating, not a shader trick. Any visibility helper must use the local team's `fogAt()` / `visionStateOf()` and treat `showFog` as a display preference. Projectile trail particles need a creation-time visibility decision or a per-particle visibility flag; otherwise smoke will cross a fog boundary.

### Performance

The current 211-particle dense frame is below the cap, so the risk is manageable. However:

- every `explosion` and `unitLost` emits its own burst;
- every missile emits a smoke particle every 35 ms;
- the particle array is not pooled and evicts by `shift()`;
- damage smoke is emitted continuously for every damaged visible unit.

A future implementation should set per-class particle budgets and coalesce bursts. The first slice should not add a second effect system or a new pass.

### Save compatibility

Presentation metadata should be optional and ignored by older saves. If wrecks or effect state are renderer-only, they must not enter save data. If events are trimmed to 80 on save, a freshly loaded game must reset its renderer/app event cursor (already done at battle start); do not replay historical explosion events on load.

### Testing risk

The existing suite is simulation-heavy and already passes. New visual tests should not depend on screenshots or GPU state; test the event-to-effect decisions as pure functions. Screenshots are evidence, not automated assertions for colour or particle count.

---

## 10. Known unknowns and manual review required

1. **Human recognition** of weapon class, hit/miss and destruction has not been measured. The proposed acceptance thresholds are future gates.
2. **Audio mix** was not listened to. The browser session confirmed HTTP 206 asset loads and which sound names were requested, but not loudness, masking or directional perception.
3. **GPU cost** cannot be measured with the current project. Only CPU submission time and draw/triangle counts are reported.
4. The **trail fog leak** is confirmed in code but was not captured as a fully hidden missile because the ATGM fixture crossed the visibility boundary in one tick. A longer-range missile fixture is required for visual proof.
5. The **showFog projectile leak** is confirmed in code; a dedicated scene with a hidden projectile and the setting off is required to demonstrate it visually.
6. **Dense-late-game behaviour** beyond 12 units was not profiled. The particle cap and event buffer are source-confirmed, but no stress capture at 2,800 particles exists.
7. **Building muzzle hardpoints** do not exist in the simulation data. Choosing between a gameplay-hardpoint change and a renderer-only visual offset is a design decision that must be made before implementing static-gun flash fixes. The safe default for this audit is a renderer-only visual mount that does not change projectile origins.
8. **Wreck persistence** has no existing simulation representation. It must be renderer-owned and cleared on teardown; if the team wants wreck collision or salvage gameplay, that is a different phase and a simulation change, not presentation.

---

## 11. Recommended subsequent phases

1. **Phase 2 — Combat readability vertical slice (this plan).** Event metadata, class profiles, projectile interpolation/tracers, consolidated destruction, fog-safe effects, visible-combat audio, rifle/ATGM/tank validation.
2. **Phase 3 — Damage, suppression and battlefield persistence.** Directional damage cues, body damage states, unselected suppression icon/pose, wrecks, rubble, scorch and bounded smoke columns.
3. **Phase 4 — Artillery, air and naval feedback.** Distinct arcing shell trails, impact zones, airburst height, naval water columns, SAM trails and large-calibre screen shake. Reuse the same profile table.
4. **Phase 5 — Dense-combat scaling and mix.** Per-class particle budgets/coalescing, audio ducking/priority refinements, effect LOD at strategic zoom, and a stress capture near the particle cap.

The human recognition and audio-listening gates from Phase 2 should be repeated for each phase rather than replaced by automated tests.

---

## 12. Commands and results

Run from `C:\Users\aeryt\Documents\Modern Combined Arms` on 28 October 2026:

```text
npm run typecheck
  exit 0 — no TypeScript errors

npm test
  exit 0 — 60 test files, 648 tests passed
  duration 100.21 s
```

The complete test output is in `tmp/combat-audit-test.log` (local diagnostic log; not a deliverable).

No production source was modified by this audit. The only new repository content is this document and the combat baseline screenshots under `docs/visual-audit/combat-baseline-*.png`. The pre-existing working-tree modifications and untracked Phase 4 evidence were left in place.

### Baseline evidence index

- [Rifle projectile](visual-audit/combat-baseline-rifle-projectile.png)
- [ATGM projectile](visual-audit/combat-baseline-atgm-projectile.png)
- [Tank projectile](visual-audit/combat-baseline-tank-projectile.png)
- [Tank impact](visual-audit/combat-baseline-tank-impact.png)
- [Tank mutual destruction](visual-audit/combat-baseline-tank-mutual-destruction.png)
- [Dense engagement](visual-audit/combat-baseline-dense.png)
- [Fog incoming](visual-audit/combat-baseline-fog-incoming.png)
- [Static AT Gun muzzle](visual-audit/combat-baseline-atgun-muzzle.png)

### Primary source references

- `src/sim/game.ts:2323–2346` — tick order.
- `src/sim/game.ts:3725–3792` — firing and `shot` emission.
- `src/sim/game.ts:3799–3812` — muzzle point, including the building branch.
- `src/sim/game.ts:4304–4384` — projectile flight and impact.
- `src/sim/game.ts:4387–4451` — damage and death events.
- `src/sim/game.ts:4488–4510` — dead entity cleanup.
- `src/sim/game.ts:4604–4641` — event buffer and `eventsAfter()`.
- `src/sim/game.ts:4837–4878` — state hash.
- `src/sim/types.ts:459–489` — projectile state.
- `src/sim/types.ts:494–546` — event types and fields.
- `src/render/renderer.ts:780–843` — ambient effects, damage smoke and projectile trails.
- `src/render/renderer.ts:845–907` — event consumption and fog gate.
- `src/render/renderer.ts:1407` — hit flash.
- `src/render/renderer.ts:1709–1753` — projectile drawing and fog-toggle gate.
- `src/render/particles.ts:21–34` — particle cap.
- `src/render/particles.ts:56–130` — explosion, impact and muzzle primitives.
- `src/render/particleGpu.ts:103–130` — two instanced particle batches.
- `src/ui/overlay.ts:344–420` — health and suppression bars.
- `src/app.ts:1025–1046` — event-to-audio/toast dispatch.
- `src/app.ts:1862` — “Visual fog” setting label.
- `src/ui/audio.ts:524–590` — synth SFX and minimum gaps.
- `src/ui/announcer.ts:46–126` — voice manifest and event mapping.
- `tests/weapon-transform.test.ts:300–420` — muzzle/event hardpoint tests.
- `tests/combat.test.ts` — damage, suppression, death and fog acquisition coverage.
- `tests/fog-integrity.test.ts` — fog visibility and hidden-target tests.
- `tests/perf.test.ts` — simulation performance baseline.

---

**Conclusion:** the combat-presentation foundation is sound enough to extend, but the current generic signature is not sufficient for the requested “combat feels impactful, readable and tactically informative” standard. The Phase 2 slice should establish the shared vocabulary before adding more effects. No implementation has begun.
