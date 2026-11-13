# Day/Night Warfare

MCA's battlefield clock. Every match runs an authoritative time of day that drives
the light level, which in turn drives detection, target acquisition and practical
engagement range. It is one shared system: the renderer, the HUD and the simulation
all read the same clock.

## The clock

`src/sim/dayNight.ts` derives the time of day from the authoritative tick and the
scenario's authored start. Nothing reads the wall clock, the frame delta or the
client's local time, so every peer, every reconnect and every restored snapshot
agree without exchanging time messages.

| Setting | Meaning | Default |
| --- | --- | --- |
| `settings.startHour` | In-game hour the match starts at, 0–24 | authored by phase (noon for a plain scenario) |
| `settings.dayLengthMinutes` | Real minutes one in-game day takes; `0` freezes the clock | 240 (one in-game hour = ten real minutes) |

A four-hour day means a standard skirmish lives inside one phase, and a long
30-minute battle crosses dusk into darkness near its end rather than being plunged
into night three minutes in. Campaign missions can freeze the clock at an hour that
suits the mission.

`timeOfDay` (`dawn` / `day` / `dusk` / `night`) is retained as the authored intent:
a scenario file or builder that predates the clock is read as starting at
`PHASE_START_HOURS[timeOfDay]`, so old maps keep the light they were designed for.

Daily light: full daylight 07:00–16:30, a ramp down to dusk, a night floor of `0.06`
(never pitch black), and a mirrored ramp up through dawn after 04:00.

## Darkness, and why dusk is free

The tactical layer uses *gameplay darkness*, not the clock label:

```ts
darkness = 0 while ambient light >= 0.5, then ramps linearly to 1 at full night
```

Above that threshold nothing changes at all: vision, engagement range, accuracy and
acquisition time are exactly what they were before the clock existed. Dusk is
visibly dim but fights like daylight, which keeps every map and balance fixture that
was authored at dusk intact, and makes night a phase a match moves *into* rather
than a penalty applied from the first tick.

## Sensors

`src/data/sensors.ts` describes what each unit and structure carries; combat code
never tests a `defId`. `src/sim/sensors.ts` turns a profile plus the light into
three separate quantities:

- **Detection** — how far a unit can see. Multiplies the authored vision radius.
- **Acquisition** — how far a crew can identify and hold a target, which caps the
  range at which a direct-fire weapon is actually used, and costs ticks before the
  first shot on a new target.
- **Accuracy** — a small hit-probability modifier once a shot is fired.

A weapon's physical range never changes; a tank gun throws a shell the same distance
at midnight. Indirect fire is exempt from the acquisition cap: it is aimed at a
coordinate a spotter already reported.

Floors keep darkness a disadvantage rather than an armistice: detection never drops
below 45% and engagement range never below 70% of the daytime value, and the
accuracy penalty is capped at 15%.

| Capability | Detection | Acquisition | Example |
| --- | --- | --- | --- |
| Optical sights | 0.45 | 0.50 | Rifleman, medic, engineer |
| Night-vision optics | 0.60 | 0.62 | ATGM, SPG, MLRS, howitzer |
| Thermal imaging | 0.82–0.86 | 0.86–0.90 | Tank, Spearhead, AA |
| Recon thermal + searchlight | 0.92 | 0.90 | Recon vehicle |
| Avionics / radar | 0.70–0.85 | 0.75–0.85 | Aircraft, warships |

A rifleman's six-tile rifle reaches 4.2 tiles at midnight while a thermal tank keeps
almost its full reach, which is the tactical difference between the two.

## Battlefield lighting

`src/sim/illumination.ts` derives a bounded set of lights (`MAX_LIGHTS`) from
authoritative entities: floodlit bases, lit windows, signals beacons, vehicle
headlights and searchlights. A light burns only when the owner has power, and a
vehicle has to be moving (or holding a searchlight on a target) for its lamp to be
on.

Illumination does two things, both deterministic:

- It raises the local light level, which lets an optical observer reach further
  against a target standing in a lit pool (`ILLUMINATED_TARGET_BONUS`, up to 40%).
- A vehicle showing its own light gives itself away to anyone close enough to see
  that light.

`Game.lights` and `Game.illumination` expose the same data to the renderer, so a
floodlit yard means the same thing on screen and in the detection model, and no
graphics setting can conjure a light the simulation does not have.

## Presentation

- The scene's ambient, sun direction and colour run continuously from the clock;
  dusk warms and darkens, night goes blue and desaturated.
- **Lit windows are the model.** Every structure already carries its glazing as
  glass material, so the mesh shader makes that glass emissive after dark through a
  `uNightGlow` uniform that the renderer raises for building draws only. The pane
  that glows is the pane that is in the wall; a vehicle windscreen shares the
  material and is never lit by it. The glow scales with the clock, and the **Night
  lights** setting dims it rather than blacking it out.
- **Windows draw on the grid.** Glazing is part of a compound's own electrical
  load, so it follows the rule the wall lamps already use: a brownout dims the
  windows in step with production, and a grid with no supply at all leaves them
  dark. A site still under construction has no supply, so it has no lit glass
  either. A neutral structure, or one whose owner draws nothing, has no deficit to
  share and keeps its glow.
- **A charted structure's windows are dark.** The glow is gated by the same vision
  state as the mesh: a building drawn from memory shows the shape that was
  recorded, and memory does not carry whether anyone is home, so it stays dark
  until it is seen again. `structureWindowGlow` in `src/render/lightView.ts` is the
  one place that rule lives.
- **Lamps sit where the model puts them.** `src/render/lightAnchors.ts` reads each
  vehicle's body mesh for its front face, half-width and height, and each
  structure's mesh for its walls and wall height (an 82nd-percentile height, so a
  flag mast does not lift the wall lamps into the air). Headlamps mount at the front
  corners of the hull; wall lamps hang at the corners of the structure.
- **Headlight beams are projected, not painted.** Each lamp is a cone in world
  space — position at the hull's lamp anchor, aim along its facing with a 0.22
  downward tilt, an outer edge at `cos(0.62)`, a reach of three tiles — carried on
  the light as `spot` (`src/render/lightGpu.ts`). No beam geometry is drawn at
  all. `TERRAIN_FS` evaluates the cones per fragment in `groundSpots()`, using the
  scene's own world position and normal, and adds them as reflectance of the
  ground's albedo (`lit += base * groundSpots(vWorld, n)`). The consequence is
  what a lamp should do: the light lands on whatever surface is actually under it,
  follows a slope without a seam, cannot clip through a crest, and has no
  piecewise banding because there are no pieces. The renderer resolves the lamps
  before the terrain pass and uploads up to `MAX_GROUND_SPOTS` of them as three
  packed `vec4` arrays (origin/reach, aim/edge, colour/strength). They come from
  the *rendered* pose, so they move with the eased hull rather than the 20 Hz tick.
  The lamp's own lens still uses the additive light batch as a small glow.
  The road deck is a mesh drawn above the terrain, so it evaluates the same
  `groundSpots()` field in `MESH_FS`; otherwise the pool would be painted only on
  the ground hidden under the road. `uSpotGate` keeps that loop off every other
  mesh pass, so units and buildings pay nothing for it. Bridge spans are the one
  entity exception: the mesh gate opens for a walkable deck, so a pool follows a
  crossing over water instead of ending at the bank. Ground decals (tracks, tyre
  marks, scorch, craters) sample the same field in `DECAL_FS` with their flat
  normal, so a track through a lamp pool is lit rather than left as a dark band.
- **A lamp does not shine through a wall.** The sun's shadow map cannot answer a
  lamp's question, because a lamp points sideways, so `renderLampOccluders()`
  renders a second 256² depth map straight down over the camera footprint:
  terrain, trees, bushes, shrubs, rocks, ore, fences, lamps, signs, rubble, decor,
  structures, hulls and wrecks, all at their drawn poses. Grass tufts and reeds
  are deliberately excluded — too short to read as a shadow, they would only add
  taps. Each shader
  probe marches the receiver-to-lamp segment through that map (`lampVisibility`),
  so a pool fades where a crest or a building stands in the beam instead of
  lighting the ground on the far side. Four probes with a soft depth compare keep
  the edge a fade rather than a staircase, and the map is rebuilt only on a night
  frame that actually has lamps.
- `src/render/lightGpu.ts` draws one instanced additive batch, split into two passes:
  ground pools under the models, so a hull occludes the pool it stands in, and wall
  lamps, lens glows and beacons over them, so a building cannot cover the light it
  carries. Depth still hides the lights on a building's far side.
- **Material deposits are gold crystals that light themselves.** The deposit mesh
  is a cluster of faceted shards rather than a fan of cones: a tall central spire
  with shorter crystals leaning out of the ground, every face shaded separately so
  the shards read as cut mineral. Glass material gives them a hard highlight. After
  dark the prop shader adds a cyan self-glow (`uGlow`) scaled by each facet's own
  brightness, so the faces stay readable instead of flooding into one flat colour,
  and each seam lays a cyan pool on the ground it stands on.
- **Night lighting follows the fog of war.** The light pass is built from what the
  local team can currently see, using the same `visionStateOf` gate the entity
  draw uses: an enemy compound or vehicle outside vision casts nothing at all, and
  a remembered (charted but unseen) structure keeps its dim silhouette and no
  lamps. Crystal pools are gated on the fog field in the same way, so a seam the
  player has not found does not glow through unexplored ground. Own structures are
  always in their team's vision, so a player's own base is unaffected.
- The rail clock shows the mission stopwatch with the battlefield time and phase
  underneath; the phase is colour-coded for transition and night.
- The unit inspector lists the selected unit's sensor capability.
- **Night lights** and **Light glow** are presentation settings. Turning the lights
  off removes the additive pass and dims the windows: detection is unaffected.

## Multiplayer

The match's start hour travels with the lobby configuration. Only the host may set
it, the room validates it and broadcasts it, and both seats lose readiness when it
changes. The hour is part of the scenario the room builds, so both clients simulate
the same clock from the same tick — no time messages are exchanged, and a restored
room resumes the hour it was snapshotted at.

## Tests

`tests/day-night.test.ts` covers the clock's purity and wrapping, the light curve,
the daylight-neutrality guarantee, the sensor ordering, a night engagement that is
refused where daylight opens fire, night detection loss, deterministic night
matches, the lighting pass, and the presentation layer: headlamp anchors taken from
the hull meshes, beams that follow the drawn pose at model scale, wall-anchored
lamps, and emissive window glass that is lit only after dark and only on
structures. It also pins the crystal seam: a faceted cluster in glass material, a
cyan night glow on the prop shader, pools that appear only near the camera and only
on explored ground, and a light pass that emits nothing for an entity the local
team cannot see.
