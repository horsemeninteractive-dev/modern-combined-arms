# MCA — Terrain Expansion, Scenario Forge Upgrade & Competitive Map Pool Expansion

Report for the terrain catalogue, surface-layer, simulation, editor, rendering and
map-pool work. Every number below is either read from the code or measured in this
tree; measured figures are labelled as such.

---

## 1. Baseline architecture audit

What existed before this work:

| Area | Existing implementation | Verdict |
| --- | --- | --- |
| Terrain | `src/sim/terrain.ts`: `Terrain` enum 0–7 (`DeepWater`, `ShallowWater`, `Sand`, `Grass`, `Forest`, `Rock`, `Road`, `Urban`), one `TERRAIN` props table with costs per `MoveClass`, `buildable`, `water`, `deep`, `cover`, `concealment`, `blocksSight`, `oreAllowed`, plus `moveCost`/`canStandOn`. | Extended, not replaced. |
| Tile data | `ScenarioTile { t, e, o }` — terrain, elevation, ore. Parsed strictly in `parseScenario`, fixed `MAP_FORMAT_VERSION`. | Extended with one optional field. |
| Runtime map | `RuntimeMap { terrain, elevation, ore, maxOre }` typed arrays, built by `createRuntimeMap`. | Extended with one optional typed array. |
| Forge | Single flat palette of eight swatches, paint/raise/lower/ore/erase/start tools, brush radius 0–4, symmetry (1/2/4-way), validation panel. | Palette grouped, surface brushes added. |
| Pathfinding | `findPath` A* over `NavGrid`, `moveCost` for costs, `ELEVATION_STEP` for climbing, soft traffic in `NavBatch`. | Reused unchanged apart from an optional overlay layer. |
| LOS | `hasLineOfSight`: hard-coded `Terrain.Rock` block plus "3+ forest tiles" using a skyline ceiling from elevation. | Made data-driven. |
| Concealment | `TERRAIN[t].concealment > 0.5` gated a close-range detection radius. | Made data-driven and graded. |
| Cover | `TERRAIN[t].cover` was **defined but never read by the simulation**. | Wired into direct fire against infantry. |
| Construction | `checkPlacement`/`validateScenario` read `TERRAIN[t].buildable`. | Now reads base terrain + surface layer. |
| Maps | `src/data/competitiveMaps.ts` (8 maps), `src/data/scenarioCatalog.ts` (4 campaign + 8 competitive), audited by `src/data/mapValidation.ts`. | Eight reworked, eight added, catalogue widened to 16. |
| Multiplayer map projection | `ProjectedMap { width, height, tileSize, terrain, elevation, ore }`, strictly validated. | Extended with the packed surface layer (`overlay`). |

The key audit finding: there was **one** terrain model, one movement table and one
scenario format, and no second map system. Everything here extends those rather
than adding a parallel implementation.

---

## 2. Terrain catalogue

Eight new base terrains were appended (ids 8–15). Ids 0–7 are untouched, because the
number is what scenarios, saves and the multiplayer projection carry — renumbering
would silently repaint existing content.

| Id | Terrain | Identity | Buildable | Ore | Cover | Concealment | Sight |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Deep water | open water | no | no | 0 | 0 | clear |
| 1 | Shallows | wadeable water | no | no | 0 | 0 | clear |
| 2 | Beach | firm sand/shingle | yes | yes | 0.05 | 0.02 | clear |
| 3 | Open ground | baseline going | yes | yes | 0.10 | 0.05 | clear |
| 4 | Forest | canopy | no | no | 0.35 | 0.75 | soft (3 tiles block) |
| 5 | Ridge | impassable rock line | no | no | 0.25 | 0.05 | hard block |
| 6 | Road | metalled, fastest | yes | no | 0 | 0 | clear |
| 7 | Rubble / urban | broken masonry | yes | no | 0.30 | 0.25 | clear |
| 8 | **Marshland** | reed beds, saturated ground | no | no | 0.05 | 0.55 | soft |
| 9 | **Mud** | waterlogged earth | no | no | 0 | 0.05 | clear |
| 10 | **Farmland** | cultivated fields | yes | yes | 0.05 | 0.15 | clear |
| 11 | **Scrubland** | brush and rough grass | no | no | 0.15 | 0.50 | soft |
| 12 | **Rocky ground** | boulders, exposed stone | no | no | 0.35 | 0.10 | soft |
| 13 | **Dunes** | deep wind-blown sand | no | yes | 0.05 | 0.05 | clear |
| 14 | **Dense urban** | built-up blocks | no | no | 0.35 | 0.35 | clear |
| 15 | **Industrial ground** | concrete hardstanding | yes | no | 0.20 | 0.10 | clear |

Movement costs (`foot / wheeled / tracked`; naval and air handled as before):

| Terrain | Foot | Wheeled | Tracked | Note |
| --- | --- | --- | --- | --- |
| Open ground | 1.00 | 1.25 | 1.05 | reference |
| Road | 0.80 | 0.70 | 0.80 | fastest |
| Industrial | 0.95 | 0.85 | 0.90 | faster than open ground for every class |
| Farmland | 1.05 | 1.30 | 1.10 | good going |
| Beach | 1.15 | 1.55 | 1.25 | — |
| Shallows | 1.90 | 2.40 | 1.70 | wadeable |
| Dunes | 1.35 | 2.30 | 1.90 | deep sand |
| Mud | 1.45 | 2.10 | 1.75 | waterlogged |
| Marshland | 1.75 | 3.40 | 2.60 | wetland |
| Scrubland | 1.40 | 2.00 | 1.55 | brush |
| Forest | 1.65 | 2.60 | 1.85 | — |
| Rocky ground | 1.80 | 3.20 | 1.90 | rough |
| Rubble / urban | 1.05 | 1.15 | 1.20 | — |
| Dense urban | 1.10 | 1.35 | 1.50 | tight streets |
| Ridge | ∞ | ∞ | ∞ | impassable |

Deliberate class differences that the tests pin: marsh costs wheeled 1.9× their open
ground, tracked 1.5× and foot 1.75× (ratio wheeled:foot > 1.6); dune and rocky ground
punish wheels more than tracks while tracks stay measurably worse than on open ground;
industrial hardstanding is faster than open ground for every class.

## 3. Movement, cover, concealment and visibility rules

- **Movement** is still a single `moveCost` call. It now optionally takes the map's
  surface layer and multiplies the base cost by the overlay's density-scaled
  multiplier. Pathfinding, reachability, the AI and the Forge's previews all call the
  same function, so a route the planner accepts is a route the mover can pay for.
- **Cover** (physical protection) reduces incoming direct fire against **infantry
  only**, by up to 30 % at full cover — masonry 0.35, boulders 0.35, a dense hedgerow
  bank, a crater scrape. Indirect fire ignores cover (it arcs over). Vehicles are
  excluded on purpose: their protection is their armour class, which the damage model
  already models, so a tank duel is still decided by guns and plating (the existing
  tank-duel timing test is unchanged).
- **Concealment** (being hard to find) never reduces damage. It stacks base terrain
  with the surface layer (crops +0.45, reeds +0.30, hedgerow +0.35, per density step)
  and gates detection: a unit on a tile with 0.4+ concealment can only be picked out
  inside a close radius, and full concealment (dense reeds, deep canopy) tightens it
  by a further 45 %. Darkness still tightens it; illumination still loosens it.
- **Line of sight** is data-driven. A tile either hard-blocks (ridge, hedgerow) or
  contributes its soft obscuration; three soft tiles close the line. Canopy, scrub,
  boulder fields, crop rows and reed beds all feed that same accounting, so a new
  terrain cannot forget to be seen through. Elevation ceiling logic is unchanged.
- **Detection** stays inside the existing authoritative vision pass: nothing about
  terrain bypasses fog, team projection or charted structures.

## 4. Base terrain and overlay architecture

A tile carries **base terrain** (`t`) and, optionally, a **packed surface layer**
(`v`). The layer never replaces the ground: `t` keeps exactly the meaning it always
had, so buildability, movement, ore legality and rendering all read a
`(terrain, overlay)` pair through small helpers in `terrain.ts`
(`tileCover`, `tileConcealment`, `tileSight`, `tileBuildable`, `tileOreAllowed`,
`overlayCostMul`, `overlayAllowedOn`).

Layer ids and their mechanics:

| Id | Layer | Cover | Concealment | Sight | Movement | Foundations | Allowed on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Waterlogged | 0 | 0 | 0 | wheels ×1.4, tracks ×1.3, foot ×1.15 | blocked | grass, road, farmland, sand, urban, industrial, mud |
| 2 | Crop rows | 0 | +0.45 | soft | foot ×1.05 | allowed | farmland, grass |
| 3 | Reeds | 0 | +0.30 | soft | foot ×1.10, tracks ×1.10 | blocked | marsh, shallows, mud, grass |
| 4 | Crater | +0.15 | +0.10 | 0 | wheels ×1.15, tracks ×1.10 | allowed | anywhere |
| 5 | Hedgerow | +0.35 | +0.35 | **hard** | all ×1.2–1.35 | blocked | grass, farmland, scrub, mud |
| 6 | Snow cover | 0 | 0 | 0 | wheels ×1.15, tracks ×1.10 | allowed | anywhere |

Density is 1–3 per layer, packed as `id * 4 + density` in one byte, so "light reeds"
and "dense reeds" are the same id at different strength. Unsupported combinations are
rejected by the Forge, skipped by the map builder and reported as a warning by
`validateScenario` (`overlay-unsupported`).

Format compatibility: `v` is **absent** on every tile that has no layer, so existing
scenarios, saves and campaign content parse byte-for-byte as before; the field is only
written when it is used.

## 5. Scenario Forge changes

- Palette is grouped: **Natural** (beach, open ground, forest, ridge, marsh, scrub,
  rocky ground, dunes), **Agricultural** (farmland), **Surface conditions** (mud),
  **Built environment** (road, rubble, dense urban, industrial), **Water** (shallows,
  deep water). Groups come from `TERRAIN_GROUPS`, so the UI and the catalogue cannot
  drift apart.
- Every swatch carries a tooltip with its mechanical note (`TerrainProps.note`).
- New **surface layer** section: layer swatches, a density slider (1–3) and a live
  note. Two brushes: `overlay` paints the layer, `UNLAY` strips it. Repainting ground
  that cannot carry the layer under it drops the layer instead of leaving "crops on
  deep water".
- The `erase` brush now clears a unit/structure, then the surface layer, then ore, in
  that order, so a layer cannot hide what is underneath it.
- The brush preview is drawn in the layer's own colour, and the cursor readout names
  the layer (`Farmland under dense crop rows · E1 · ore 300`).
- Validation in the Forge reports layer/ground mismatches as warnings, and structure
  placement agrees with the simulation because both call the same `tileBuildable`.
- Symmetry (1/2/4-way) applies to the layer exactly as it does to terrain, structures
  and starts.

## 6. Rendering changes

- New terrains take their colour, variation and ground-material weights from the same
  catalogue the simulation uses (`groundCover` gained weights for scrub, marsh,
  farmland, mud, rocky ground, dense urban and industrial), so a new terrain cannot
  render as a default colour.
- The surface layer is a **tint over the ground colour**, blended per corner with the
  layer's strength, tint and density (`surfaceColor` in `terrainMesh.ts`). Because the
  mesh already averages colours on shared grid corners, a crop field fades into the
  field beside it instead of ending in a hard square.
- Water quads, road surfaces, shading, shadow and the day/night lighting path are
  untouched: the layer changes the diffuse colour that was already being lit.
- Thumbnails and map previews render the same geometry, so they pick the new palette up
  for free.

## 7. Existing eight-map audit and rework

Each map was read from its builder, not from its name. All eight kept their ids,
dimensions, layouts, base pads, ore and objectives.

| Map | Dimensions | Identity before | Change made |
| --- | --- | --- | --- |
| Open Front | 84² | open ground, scattered treelines, one low outcrop | Farmland belt with crops and two hedgerow banks on the outer approach: the reference map now has fields as well as trees. |
| Woodland Divide | 88² | overlapping woods, clearings, low rock | Scrub fills the gaps between woods, the logging track is churned mud, one belt has craters. |
| Drylands | 112² | sand basins, long ridges, raised plateau | Dune seas beside the lanes and broken rock where the ridges decay; craters on the basin floor. |
| Ironworks | 80² | industrial grid of rubble and warehouses | Concrete yard blocks and a dense tenement core inside the district, plus cratered hardstanding. |
| Crossing Point | 96² | river diamond, one bridge, one ford | Marsh and reed banks line the inner bank; mud on the ford approach. |
| High Ground | 104² | terraced massif, forested slopes | Rocky scree at the foot of the massif and cultivated terraces on the low ground. |
| Littoral | 120² | corner seas, beaches, dune ridges | Dune belts on the seaward flank, salt-marsh and reeds behind the shore. |
| Contact Zone | 64² | compact urban core | Dense built-up core and industrial rim replace plain rubble; craters at the intersections. |

Every rework is stamped through the same four-way `Field`, so the symmetry that the
audit verifies is preserved by construction.

## 8. The eight new maps

| Map | Size | Primary identity | Principal terrain | Tactical intent |
| --- | --- | --- | --- | --- |
| Blackwater Fens | 72² | wetland | marsh, reeds, shallow channels, mud | Short map where the direct line is the slowest; causeways decide it. |
| Hedgerow Vale | 100² | bocage | farmland, crop rows, hedgerows, scrub | Field-by-field infantry fighting; armour funnelled along lanes. |
| Thorn Scrub | 76² | scrub brawl | scrub, forest, craters | Shortest sight lines in the pool; ambush country. |
| Granite Steps | 108² | rocky uplands | ridge lines, rocky ground, terraces | Three terraces; worn rock punishes wheels; guns want the top step. |
| Saffron Erg | 128² | deep desert | dunes, sand basins, rock outcrops | Largest map; observation and manoeuvre, room to lose contact. |
| Ashcross Sprawl | 92² | dense city | dense urban blocks, streets, rubble | Street grid where infantry holds the blocks and armour owns the roads. |
| Freight Yards | 116² | industrial | industrial hardstanding, rail roads, urban blocks | Fast, open middle; buildable yards make forward expansion viable. |
| Silt Delta | 136² | river delta | shallow channels, marsh, reeds, causeways | Every crossing is wadeable and every crossing is exposed. |

New dimensions were chosen deliberately (64–136²) and never coincide with an existing
map's footprint; the roster test asserts all sixteen are distinct in size, name and
focus.

## 9. Final competitive catalogue (16)

| # | Id | Name | Size | Focus | Terrain identity |
| --- | --- | --- | --- | --- | --- |
| 1 | `open-front` | Open Front | 84² | Combined | open countryside, fields, hedgerows |
| 2 | `woodland-divide` | Woodland Divide | 88² | Woodland | forest, scrub, churned tracks |
| 3 | `drylands` | Drylands | 112² | Armour | sand basins, dunes, ridges |
| 4 | `ironworks` | Ironworks | 80² | Forge | industrial yards, dense blocks, rubble |
| 5 | `crossing-point` | Crossing Point | 96² | River | deep river, bridges, marsh banks |
| 6 | `high-ground` | High Ground | 104² | Elevation | terraced massif, scree, farmland |
| 7 | `littoral` | Littoral | 120² | Coastal | coastal sea, dunes, salt marsh |
| 8 | `contact-zone` | Contact Zone | 64² | Assault | dense core, industrial rim |
| 9 | `blackwater-fens` | Blackwater Fens | 72² | Wetland | marsh, reeds, shallow channels |
| 10 | `hedgerow-vale` | Hedgerow Vale | 100² | Bocage | farmland, hedgerows, crops |
| 11 | `thorn-scrub` | Thorn Scrub | 76² | Scrub | brush, forest, craters |
| 12 | `granite-steps` | Granite Steps | 108² | Uplands | granite ridges, rocky passes |
| 13 | `saffron-erg` | Saffron Erg | 128² | Desert | dunes, sand, outcrops |
| 14 | `ashcross-sprawl` | Ashcross Sprawl | 92² | City | dense urban blocks, streets |
| 15 | `freight-yards` | Freight Yards | 116² | Industry | hardstanding, rail spurs, yards |
| 16 | `silt-delta` | Silt Delta | 136² | Delta | shallow channels, silt, reeds |

All sixteen are offered to **skirmish** and **multiplayer** only, declare four start
slots, and support 1v1 on the opposite pair (`duelStartSlots`) with adjacent pairs
available for a future 2v2 (`teamStartSlots`). 2v2 was not implemented, as instructed.

## 10. Campaign content

The four campaign theatres remain separate and untouched: `island-assault`
(96×72), `rust-valley` (112×80), `kestrel-straits` (88×64) and `foundry-district`
(104×76). They are campaign-only in the catalogue, keep their ids, layouts, briefings
and starting forces, and are not counted towards the sixteen.

## 11. Four-way symmetry validation

`auditCompetitiveMap` re-derives symmetry from the finished tiles rather than trusting
the builder. It now compares the surface layer as well as terrain, elevation and ore
(`asymmetric-terrain` reports `v`), and it checks:

- terrain/elevation/ore/layer symmetry across all three quarter turns,
- neutral structures, owned structures and starting forces,
- slot reachability and area balance per movement class,
- strategic sites and ore reachable from every slot,
- slot ground buildability (now layer-aware),
- scenario structural validity and catalogue footprint agreement.

Result: **16/16 maps pass with zero problems** (`tests/terrain-expansion.test.ts`,
`tests/map-roster.test.ts`). One failure was caught and fixed during the work: Granite
Steps' inner ridge originally enclosed the centre relay, and its centre block was a
two-step pedestal no wheeled or tracked unit could climb — both are now correct, and
the audit is what found them.

## 12. Test and performance evidence

Test runs in this tree:

- `tests/terrain-expansion.test.ts` — **33/33 passing** (catalogue completeness, layer
  packing and legality, movement differences by class and terrain, cover vs
  concealment, LOS through canopy/scrub/rock/hedgerow, buildability and ore rules,
  scenario round-trip, validation warning, Forge wiring, roster breadth, per-map audit).
- `tests/map-roster.test.ts` — **143/143 passing** (20 battlefields, 16 competitive, 4
  campaign, unique ids/names/focus/sizes, four slots per map, full audit of all 16).
- `tests/maps.test.ts` — **27/27 passing** (campaign theatres load and simulate).
- `npm run typecheck` — clean.
- `npm run build` (tsc + vite + service worker) — succeeds.

Measured on this machine (single-threaded, Node 24, vitest):

| Measurement | Result |
| --- | --- |
| Scenario build for all 16 competitive maps | 159.6 ms total (1.2–77 ms each; the 77 ms outlier is first-call JIT on Littoral) |
| Terrain mesh build for all 16 maps | 1 564.8 ms total, 34–196 ms each |
| Largest map mesh (Silt Delta, 136², 69 904 vertices) | 122.7 ms |
| `createRuntimeMap` (largest map) | 0.36 ms |
| Reachability from one slot on Silt Delta, all three classes | 48.9 ms per run (validation only, not per tick) |
| Full audit of the roster (symmetry + access, 16 maps) | 3.4 s total, 67–515 ms each |

No per-frame terrain work was added: the layer is baked into the corner colours at mesh
build time and never sampled during rendering, and movement/concealment reads are single
array lookups.

Pre-existing failures in this working tree, not introduced by this task:

- `tests/phase2a7-first-tick-profiling.test.ts` and
  `tests/phase2a8-simulation-equivalence.test.ts` fail on frozen checksum/path fixtures
  (`87f80cac6f36c97b` and friends). These fixtures were captured before the uncommitted
  pathfinding/combat work already present in this tree. I verified this by restoring the
  eight simulation files from git `HEAD` and re-running: phase2a7 still fails (4/4
  assertions), so the fixture is not a valid baseline for the current code either way.
  I did not overwrite the fixture, because `tools/phase2a8-capture-baseline.mjs`
  documents it as a frozen pre-change reference.
- `tests/ai-matchups.test.ts` fails its AI-tier ordering (`Elite vs Recruit` margin
  28 906 vs a 35 000 floor, and `Elite vs Veteran` currently negative). This also
  predates the task: with the new cover rule disabled the ordering is still wrong
  (`Elite vs Veteran` −19 642). Infantry cover does compress the margins further, and
  the tier ordering needs re-baselining by someone who owns AI difficulty tuning.

## 13. Known limitations and deferred work

- **Surface layers ship through the projection (resolved).** `ProjectedMap` now
  carries `overlay`, `snapshotAssembler` validates it (tile count, 0–31 per tile) and a
  networked client adopts the room's layers into its display map, so both seats paint
  the same crops, reeds and hedgerows. A sync from a build without the layer is still
  accepted and the client then paints base terrain as before.
- **Weather is presentation.** Snow is an authorable layer with a small wheel penalty;
  it is not a weather simulation, as instructed.
- **2v2 is not implemented.** The maps are authored and validated for four seats, and
  the seat-pairing helpers exist, but no lobby or match code changed.
- **Reworked maps are data edits within their existing layouts.** No map was
  regenerated, and no campaign map was touched.
- Cover applies to infantry only. Tanks, boats and aircraft get no terrain damage
  reduction by design; if vehicles should benefit, that is a balance decision that
  needs its own matchup audit.

## 14. Files changed and migrations

Simulation and data:

- `src/sim/terrain.ts` — 16-terrain catalogue, palette groups, overlays, tile helpers,
  overlay-aware `moveCost`.
- `src/sim/scenario.ts` — `ScenarioTile.v`, parse/serialization, layer-aware placement
  and validation, layer-aware reachability, `overlay-unsupported` warning.
- `src/sim/map.ts`, `src/sim/types.ts`, `src/sim/save.ts` — optional `overlay` layer in
  the runtime map and saves.
- `src/sim/combat.ts` — data-driven LOS obscuration, `coverFactor`.
- `src/sim/pathfinding.ts` — overlay carried on `NavGrid`.
- `src/sim/game.ts` — graded concealment, infantry cover in `damageEntity`, overlay in
  `navFor`.
- `src/data/mapValidation.ts` — layer-aware slot buildability and layer symmetry.
- `src/data/competitiveMaps.ts` — eight reworked maps, three new maps, layer stamping,
  `repairStructureGround`, shared builder exports.
- `src/data/expansionMaps.ts` — five new maps (12–16).
- `src/data/scenarioCatalog.ts` — sixteen-entry competitive catalogue.

Editor and rendering:

- `src/ui/editor.ts`, `src/ui/editorRender.ts` — grouped palette, surface brushes,
  density, tooltips, layer-aware preview and readout.
- `src/render/terrainMesh.ts` — ground-material weights and `surfaceColor` layer tint.

Multiplayer:

- `src/multiplayer/projection.ts` — `ProjectedMap.overlay`, shipped with the immutable
  map in `projectMap`.
- `src/multiplayer/snapshotAssembler.ts` — validates the layer (tile count, 0–31) and
  keeps it on the reconstructed map; a map without it still verifies.
- `src/sim/game.ts` — `adoptNetworkMap` copies the room's layers into the display
  runtime map and authored tiles and reports whether anything changed.
- `src/render/renderer.ts` — `rebuildTerrain` rebuilds map-derived GPU resources after
  adoption while preserving the camera and the event cursor.
- `src/app.ts` — adopts the room's map before applying each sync and rebuilds the
  terrain only when a layer actually changed.

Tests: `tests/terrain-expansion.test.ts` (new), `tests/map-roster.test.ts` (roster size
and per-map coverage now 16), `tests/multiplayer-map-layers.test.ts` (new: projection,
validation and client adoption of the surface layer).

**Migrations: none required.** `MAP_FORMAT_VERSION` and `SAVE_FORMAT_VERSION` are
unchanged: the layer is additive and optional, terrain ids 0–7 keep their meaning, and
every existing scenario, save and campaign reference loads unchanged.

---

## 11. World flavour pass: shelters, props, spans and the island

Follow-up work on the same catalogue. Everything below is additive; the sixteen
existing battlefields keep their identities.

### 11.1 Garrisonable structure kinds

Four new authored shelters joined the existing four (`tenement`, `warehouse`,
`officeBlock`, `civicHall`, `foundryWorks`, `ruin`):

| Kind | Tiles | Capacity | Protection | Firing slots | Vision | Role |
| --- | --- | --- | --- | --- | --- | --- |
| Village Chapel | 4×4 | 3 | 50% | 2 | 11 | Landmark observer (bell tower) |
| Farmhouse | 3×3 | 3 | 38% | 2 | 5 | Rural strongpoint |
| Constabulary | 4×4 | 4 | 50% | 3 | 8 | Urban strongpoint |
| Fire Lookout | 2×2 | 2 | 30% | 1 | 13 | Observation post |
| Freight Shed | 4×4 | 5 | 45% | 2 | 5 | Industrial strongpoint |

Each has its own mesh, an occupied (`garrisoned`) variant with wire, sandbags and
team trim, a Phase 4 flag anchor and an icon. **Every authored shelter footprint
is square**: an authored structure is stamped at all four rotations of a
competitive quadrant, and the runtime footprint has no rotation of its own, so a
rectangular shelter cannot be placed on four-way ground without mismatching its
own blocked tiles. That is why `freightShed` (4×4) replaced the 5×4 `warehouse`
on Freight Yards instead of the other way round.

### 11.2 Props

Roadside direction signs were added as a batched prop (`buildSignPostMesh`,
instanced in the renderer): a post with two angled destination blades, standing
on the verge of any road tile that has open ground beside it. They are
deterministic from the scenario, cost one draw call for the whole map, and
participate in the existing prop shadow rebuild.

### 11.3 Destructible, repairable bridges

New structure kind `bridge` with a rule that did not exist before:
`BuildingDef.walkable`. Its footprint is *deck*, not masonry.

- **Traffic.** `Game.rebuildDecks()` builds navigation copies of the map's
  terrain and elevation with every standing deck laid as road at bank height, so
  `navFor`, `canOccupy` and the A* grid all agree the span is crossable. The raw
  map is never mutated — a deck is a structure, and rewriting tiles would
  desynchronise every client that projected the same ground.
- **Destruction.** Anti-structure fire drops the span: the entity survives at
  zero hit points as wreckage (`buildBridgeRuin` mesh), its tiles block, its
  deck leaves the navigation layer, and any unit standing on it is walked to the
  nearest bank by a deterministic ring search.
- **Repair.** Engineers can re-deck a dropped span (`isRepairableBy` accepts a
  walkable structure at zero hit points, for its owner or for a neutral span).
  The blocked tiles are released the moment the deck carries traffic again, with
  both transitions announced as notices.
- **Targeting.** A neutral span is attackable by either side: it is shared
  infrastructure, not a protected objective.
- **Audit.** `withDecks()` in `mapValidation.ts` lays the same decks into the
  copy it measures reachability on, so an anchor span is not reported as
  unreachable water, and route costs stay equal across all four slots.
- **Authoring.** `Field.bridge(x, z)` stamps a span at all four rotations with
  its facing turned across the channel; the Scenario Forge lists bridges with
  every other structure, and `checkPlacement`/`validateScenario` treat a deck as
  legal over channel, towpath or bank.

Cormorant Isle carries the first pair in the pool: a deep cut from the north bay
runs into the island, the base road is carried over it by a bridge, and the road
resumes on the far bank. Close the span and the crossing — and the flank it
serves — closes with it.

### 11.4 Seventeenth battlefield: Cormorant Isle

The pool had coastlines but no island: every map joined its starts by land and
left the sea as scenery. `cormorant-isle` (132×132) is one island in open water:

- a level beach ring, so a shipyard or coastal battery can be founded anywhere on
  the coast instead of hunting for a flat plot;
- four deep bays, each reaching inland, so hulls can bombard the shore road and a
  yard can sit in a bay head with land on three sides;
- the deep cut and its bridge, the one place armour cannot simply drive around;
- a rocky centre at two steps of elevation with the relay on the middle step —
  wheeled movement climbs one step at a time, so the centre has to be approached
  through the ring rather than dropped into from sea level.

The roster is now **17 competitive maps** (plus the four campaign theatres).
`Saffron Erg`'s catalogue line changed from "the largest battlefield in the pool"
to "one of the widest", because Cormorant Isle is now 132 tiles to its 128.

### 11.5 Shoreline z-fighting

Two separate causes, both fixed:

- flat coastal land was drawn only four centimetres above the sea plane, which is
  inside the depth buffer's own error at battle zoom, so beaches and water
  interleaved along the whole coast. `MIN_LAND_LEVEL` is now a fifth of a unit
  above the water plane.
- the sea is a single quad across the map, so every coastal triangle meets it at
  a grazing angle. `drawWater` now enables a polygon offset while drawing it, so
  land always wins the boundary and the waterline reads as a line.

### 11.6 Verification

- `tests/bridge.test.ts` (new): a wheeled column crosses a channelled map over
  the span; deck tiles are not in the blocked grid; shooting the span out leaves
  the wreckage, closes the crossing and blocks both deck tiles; an engineer's
  repair reopens it.
- `tests/map-roster.test.ts`, `tests/terrain-expansion.test.ts`: roster size 17,
  all 17 maps pass the structural, symmetry and access audit, and every map's
  travel cost is equal from all four slots for foot, wheeled and tracked.
- `tests/building-phase4.test.ts`, `tests/flags.test.ts`,
  `tests/building-presentation.test.ts`: flag anchors, roof mounts and materials
  exist for every registered structure, including the two new kinds.
- `npm run typecheck` clean.

### 11.7 Anchor re-baselining and the AI ladder

The Phase 2A.7 / 2A.8 fixtures and the AI difficulty-ordering check were the only
remaining red tests. Each was traced to its cause rather than updated blind:

- The equivalence anchors were confirmed healthy at the previous commit and made
  red by this tree. Bisecting the changed files inside a throwaway worktree
  isolated `src/sim/game.ts`: the opening order now walks each formation slot out
  to ground the hull can reach, so the 80-unit stress run reports two acknowledg-
  ed orders instead of one ack and one refusal. The battle itself is unchanged in
  character — at tick 1 the entity ids, projectile count and RNG state match the
  old capture exactly, and the 100-tick summaries show the same armies suffering
  comparable losses — so `tests/fixtures/phase2a8-path-baseline.json` and the
  Phase 2A.7 first-tick constant were regenerated, with the setup checksum (tick
  0) still matching the deployment. `method` in the fixture records why.
- The AI check was **not** a stale threshold: Elite vs Veteran had genuinely
  inverted to a coin flip. The cause was the fixture, not the brain. Harvesters
  now reach every seam, so the arena's 600 materials per tile were mined out
  inside the time limit and both economies flattened. A controlled sweep showed
  the ordering returning as the field deepened:

  | Ore per tile | Recruit–Veteran | Elite–Recruit | Elite–Veteran |
  | --- | --- | --- | --- |
  | 600 | −10 674 | 28 906 | −1 658 |
  | 1800 | −27 387 | 96 890 | 37 395 |
  | 3600 | −67 681 | 106 267 | 43 045 |

  At 3600 the arena is rate-limited again, so the thresholds went back to their
  original values instead of being loosened.

Final state: `npx vitest run` 111 files / 1376 tests pass, `npm run build`
(typecheck + bundle + service worker) clean.
