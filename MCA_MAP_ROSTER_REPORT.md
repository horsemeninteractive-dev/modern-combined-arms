# MCA — Competitive Map Roster Report

Status: implemented, tested, **not deployed** and **not committed**.
Scope: one shared scenario format, mode-based availability, eight competitive
four-way maps, reusable validation tooling, catalogue-driven map selection for
skirmish and multiplayer, and server-side multiplayer scenario validation.

---

## 1. Audit of the existing implementation

### 1.1 Scenario format

- One format already existed in [scenario.ts](src/sim/scenario.ts):
  `format/version`, `meta`, `width/height`, packed `tiles` (`t` terrain,
  `e` elevation, `o` ore), `structures`, `units`, `players[]`, `objectives`,
  `settings`, plus `parseScenario`, `scenarioToJson`, `validateScenario`,
  `canLaunch`, `cloneScenario`, `reachableFrom`.
- Terrain is a 0–7 enum (deep water, shallows, beach, open ground, forest,
  ridge, road, urban) with per-move-class costs, cover, concealment,
  `blocksSight` and buildability ([terrain.ts](src/sim/terrain.ts)).
  `ridge` and deep water are impassable to land classes; forest/sand/urban are
  passable but cost more; `ELEVATION_STEP` is `foot: 2`, `wheeled/tracked: 1`.
- Ore is a per-tile quantity; strategic sites are owner `-1` structures
  (relays, supply depots, radar); bases are owned structures; starting forces
  are `units[]` with `owner`.
- Starting positions were carried only by `players[i].startX/startZ`; there was
  **no representation of four start slots**, and therefore no way to express
  "1v1 uses this opposite pair of a four-way map".

### 1.2 The four existing theatres

| id | name | size | focus | notes |
|---|---|---|---|---|
| `island-assault` | Island Assault — Kestrel Bay | 96×72 | Combined | vertical-slice island; naval |
| `rust-valley` | Rust Valley | 112×80 | Armour | central massif, two wide passes |
| `kestrel-straits` | Kestrel Straits | 88×64 | Naval | deep strait, two islands |
| `foundry-district` | Foundry District | 104×76 | Urban | city core, garrisonable blocks |

These were declared in `BUILTIN_SCENARIOS` in [scenarios.ts](src/data/scenarios.ts),
which was also the list the skirmish selector rendered and the only allowlist
the multiplayer lobby validated against.

### 1.3 How maps reached the game

- Skirmish: `app.ts` built `.map-card` buttons from `BUILTIN_SCENARIOS`, painted
  each card with a real terrain raster (`drawBriefMap`), and persisted the
  chosen `mapId` in settings.
- Campaign: missions reference `mission.mapId` directly; `campaignScenario()`
  built that scenario.
- Simulation: `Game` takes a `Scenario`; multiplayer built it in
  `buildLobbyScenario()` and the room started from that.
- Multiplayer: lobby config carried `mapId`, validated by
  `isPlayableMapId()` against `BUILTIN_SCENARIOS`. The map was fixed at room
  creation — the host could not choose it.

### 1.4 Architectural limitations found

1. **No start-slot metadata.** Four starts could not be declared, so 1v1/2v2
   assignments could not be explicit or deterministic from map data.
2. **No availability metadata.** Campaign and skirmish shared one list, so
   campaign theatres appeared as skirmish ground and were accepted by
   multiplayer lobbies.
3. **Map sets duplicated across screens.** Skirmish, multiplayer and the
   campaign each carried their own reference to the builtin list.
4. **No symmetry or accessibility validation.** `validateScenario` covers
   structure/bounds/footprint/start sanity only; nothing compared quadrants,
   deposits, objectives or per-class reachability.
5. **No host map selection.** The battlefield was decided implicitly by the
   lobby default, not by an explicit, validated host action.

No blocker prevented the work; all five were addressed additively.

---

## 2. Architecture changes

### 2.1 One catalogue, one format

New [scenarioCatalog.ts](src/data/scenarioCatalog.ts) is the single source of
map availability and display metadata:

- `ScenarioEntry`: `id`, `name`, `description`, `focus`, `tags`, `domains`,
  `targetSize`, `width`, `height`, `playerCounts`, `modes`, optional `start`,
  `create()`.
- `SCENARIOS` = four campaign entries + eight competitive entries.
- `scenariosForMode(mode)`, `isScenarioAvailable(id, mode)`,
  `scenarioById(id)`, `requireScenario(id)`, `defaultScenarioId(mode)`.
- `scenarioSlots(entry)`, `duelStartSlots(entry)` (slots 0 and 2),
  `teamStartSlots(entry)` (adjacent pairs 0+1 vs 2+3), `scenarioSummary(entry)`
  (display data without generating tiles).

`sim/scenario.ts` gained one additive field, `slots?: ScenarioSlot[]`, parsed
and validated in `parseScenario`/`validateScenario` (bounds, not water).
Campaign and editor scenarios simply omit it, so there is still exactly one
scenario format.

No screen defines availability: skirmish, the lobby and campaign all read the
catalogue.

### 2.2 Mode separation

- `island-assault`, `rust-valley`, `kestrel-straits`, `foundry-district` →
  `modes: ['campaign']`. Layouts, names, forces and campaign references are
  unchanged; they are now excluded from skirmish and multiplayer.
- The eight new maps → `modes: ['skirmish', 'multiplayer']`, not available to
  the campaign until a mission names one.

### 2.3 Authoring model for four-way maps

[competitiveMaps.ts](src/data/competitiveMaps.ts) builds each map from a
**quarter**: terrain, elevation, ore, roads, cover and neutral objectives are
painted in the top-left quadrant and stamped at 0°/90°/180°/270° by
`Field.set`/`rect`/ore helpers. Consequences:

- Four-way symmetry holds **by construction** for all gameplay content, and is
  re-derived from the finished tiles by the validator (which does not trust the
  authoring model).
- Owned content (command posts and starting forces) exists for two seats only:
  seat 0 in quadrant 1, seat 1 in the opposite quadrant. A half turn maps one
  to the other with ownership swapped. The two unused quadrants stay neutral
  ground with their own rotationally equivalent ore and sites.
- All maps are square, because a 90° rotation of a W×H grid is only meaningful
  when `W === H`.

During authoring two classes of defects were found and fixed by the new tests:
even-width route bands (a 2-tile band is not centred on its line, so a quarter
turn shifted it) and four objective/structure placements that landed on
ridge/forest/water.

### 2.4 Multiplayer scenario validation

- `lobbyConfig.isPlayableMapId(id, mode = 'multiplayer')` → catalogue query.
  `buildLobbyScenario()` resolves the entry from the catalogue and **throws**
  rather than falling back if the id is not multiplayer-available.
- `RoomLobby.setMapId(seatId, id)`: host-only, catalogue-validated, clears both
  ready states, broadcasts the new lobby state and triggers the room's persist
  callback. The room never accepts a client-supplied scenario, only an id it
  resolves itself.
- Wire: `lobbySet` gained an optional `mapId` (string, whitelisted fields,
  rejected if malformed). `LobbyClient.setMap()` sends it.
- Worker/DO defaults (`roomDurableObject`, `roomMatch`) now use
  `defaultScenarioId('multiplayer')` (Open Front) instead of the campaign
  island, including the legacy-metadata restore path.
- Both seats receive the same authority-built scenario: the room builds it once
  from the persisted config and runs the snapshot/sync path as before.

### 2.5 Presentation

- Skirmish selector ([app.ts](src/app.ts)) lists `scenariosForMode('skirmish')`
  with raster preview, name, focus, size and two tags; the brief gained
  `STRATEGIC` tags and `PLAYERS`.
- Lobby ([multiplayerPanel.ts](src/ui/multiplayerPanel.ts)) has a **Battlefield**
  card: a raster preview painted from the catalogue's own scenario
  (`drawBriefMap`), a host-only `<select>` of the eight maps, size/player/tag
  detail, and an explicit note that changing the map clears both ready states.
  Guests see the chosen map and its detail, not a picker.
- Campaign screens still read `mission.mapId`; the mission rail is unchanged.

---

## 3. Final catalogue

| id | name | modes | size | players | identity |
|---|---|---|---|---|---|
| `island-assault` | Island Assault — Kestrel Bay | campaign | 96×72 | 2 | legacy vertical slice |
| `rust-valley` | Rust Valley | campaign | 112×80 | 2 | legacy armour passes |
| `kestrel-straits` | Kestrel Straits | campaign | 88×64 | 2 | legacy naval strait |
| `foundry-district` | Foundry District | campaign | 104×76 | 2 | legacy urban core |
| `open-front` | Open Front | skirmish, multiplayer | 84×84 | 2 or 4 | reference combined-arms |
| `woodland-divide` | Woodland Divide | skirmish, multiplayer | 88×88 | 2 or 4 | infantry, concealment |
| `drylands` | Drylands | skirmish, multiplayer | 112×112 | 2 or 4 | armour, long range |
| `ironworks` | Ironworks | skirmish, multiplayer | 80×80 | 2 or 4 | industrial close quarters |
| `crossing-point` | Crossing Point | skirmish, multiplayer | 96×96 | 2 or 4 | river crossings, chokepoints |
| `high-ground` | High Ground | skirmish, multiplayer | 104×104 | 2 or 4 | elevation, artillery |
| `littoral` | Littoral | skirmish, multiplayer | 120×120 | 2 or 4 | coast, flanking, supply |
| `contact-zone` | Contact Zone | skirmish, multiplayer | 64×64 | 2 or 4 | fast, aggressive |

### 3.1 Starting positions

Every competitive map declares `start` (first quadrant). The other three are
pure rotations:

| map | slot 0 | slot 1 (90°) | slot 2 (180°) | slot 3 (270°) | 1v1 pair |
|---|---|---|---|---|---|
| open-front | 14,14 | 69,14 | 69,69 | 14,69 | 0 vs 2 |
| woodland-divide | 13,13 | 74,13 | 74,74 | 13,74 | 0 vs 2 |
| drylands | 16,16 | 95,16 | 95,95 | 16,95 | 0 vs 2 |
| ironworks | 13,13 | 66,13 | 66,66 | 13,66 | 0 vs 2 |
| crossing-point | 16,16 | 79,16 | 79,79 | 16,79 | 0 vs 2 |
| high-ground | 16,16 | 87,16 | 87,87 | 16,87 | 0 vs 2 |
| littoral | 42,18 | 101,42 | 77,101 | 18,77 | 0 vs 2 |
| contact-zone | 16,16 | 47,16 | 47,47 | 16,47 | 0 vs 2 |

`players[0]` deploys on slot 0 and `players[1]` on slot 2 on every map, so 1v1
always uses the opposite pair (slot 2 is the 180° rotation of slot 0, i.e. equal
distance to the centre and identical ground). Future 2v2 is described by
adjacent pairs 0+1 vs 2+3 in `teamStartSlots()`, deterministically; no 2v2
networking exists.

### 3.2 Measured map data

Values are from `auditCompetitiveMap` (see §4). "Route cost" is the cheapest
movement cost from a start to the central objective area (the tiles within
1.5 tiles of the map centre) using the
simulation's own `moveCost`; all four slots produce the same value.

| map | elevation | forest | ridge | urban | road | water | ore/slot | sites/slot | start→centre | route foot / wheeled / tracked |
|---|---|---|---|---|---|---|---|---|---|---|
| open-front | 1–2 | 316 | 84 | 0 | 140 | 0 | 252 | 9 | 38.9 | 36.5 / 33.8 / 36.8 |
| woodland-divide | 1–2 | 1200 | 84 | 0 | 220 | 0 | 240 | 9 | 43.1 | 35.4 / 33.1 / 35.7 |
| drylands | 1–2 | 0 | 740 | 0 | 196 | 0 | 360 | 9 | 55.9 | 53.0 / 49.6 / 53.6 |
| ironworks | 1–2 | 0 | 20 | 720 | 900 | 0 | 252 | 21 | 37.5 | 35.2 / 35.1 / 37.0 |
| crossing-point | 0–1 | 0 | 0 | 0 | 124 | 576 | 240 | 9 | 44.5 | 37.4 / 35.0 / 38.0 |
| high-ground | 1–3 | 296 | 132 | 0 | 152 | 0 | 316 | 9 | 50.2 | 45.1 / 42.4 / 45.5 |
| littoral | 0–2 | 148 | 0 | 0 | 284 | 1404 | 168 | 9 | 45.0 | 40.7 / 38.9 / 41.3 |
| contact-zone | 1–2 | 52 | 168 | 496 | 108 | 0 | 236 | 9 | 21.9 | 17.9 / 19.1 / 18.5 |

### 3.3 The eight maps

1. **Open Front (84×84)** — open centre, two low ridges and scattered treelines,
   four broad approaches. Roads let a wheeled column reach the middle cheaper
   than a cross-country line (33.8 vs 36.5), so road control matters without
   roads being mandatory. Reference map.
2. **Woodland Divide (88×88)** — 1 200 forest tiles in overlapping belts that
   break sightlines but leave tracked and wheeled corridors. Tracks pay more
   than boots to cross (35.7 vs 35.4) and concealment favours infantry ambushes;
   no single wood decides the match.
3. **Drylands (112×112)** — the largest open ground, split by long ridges with
   wide gaps; 740 ridge tiles and 360 ore make map control the economy. Long
   sightlines reward ranged armour, flanking corridors punish a single push.
4. **Ironworks (80×80)** — a dense grid of 720 urban tiles and 900 road tiles:
   the highest strategic-site density (21 reachable neutral sites) and the
   longest tracked route relative to its size. Infantry cover everywhere,
   vehicles confined to streets by cost and building footprints.
5. **Crossing Point (96×96)** — a shallow river diamond closes the centre, with
   one road bridge and one ford per side. Every approach crosses water, so
   route timing and crossing control matter; no quadrant has a cheaper crossing.
6. **High Ground (104×104)** — a terraced massif (elevation up to 3) over the
   centre, ringed by forested slopes and shared ramps. Foot can climb two levels
   at once, vehicles one, so the summit is reachable by all arms but the ramps
   are the artillery positions worth fighting for.
7. **Littoral (120×120)** — coastal plains with a sheltered sea in each outer
   corner and 1 404 water tiles; flanking beaches and the lowest ore per slot
   (168), so expansion is contested. Ground and air only: no naval unit is
   required and no balance claim is made about naval play.
8. **Contact Zone (64×64)** — compact urban core: 17.9 foot-cost to the centre,
   half the Drylands figure, three routes around the central relay and enough
   blocks to manoeuvre rather than collide head-on.

---

## 4. Validation tooling

[mapValidation.ts](src/data/mapValidation.ts) exports `auditCompetitiveMap(entry,
scenario?)` and `auditCompetitiveRoster()`. It is reusable for any future
square, four-way scenario and never mutates the scenario.

Checks (a failure is a `problem` with a stable code):

- **Structure** — every error from the game's own `validateScenario`, square
  footprint, catalogue size agreement.
- **Four-way terrain symmetry** — for 90°, 180°, 270°, each tile's terrain,
  elevation and ore must match its rotation (reports up to four examples per
  rotation).
- **Neutral objectives** — each neutral structure's *covered cells* must exist
  as the same `defId` at all three rotations (cells, not origins, so footprint
  rotation is tested).
- **Owned content** — each seat's structures and units must have an opposing
  counterpart at the 180° position with ownership swapped; both seats must have
  a command post and identical starting forces.
- **Start slots** — exactly four; slots 1–3 must be exact rotations of slot 0; no
  duplicate 1v1 pair; each slot in bounds, on land and on buildable ground; seat
  starts must equal slots 0 and 2; the catalogue `start` must match.
- **Accessibility** — for `foot`, `wheeled` and `tracked`: reachable area from
  each of the four slots must agree within 1 %, every neutral strategic site must
  be reachable from every slot, and ore must be reachable. Uses the game's own
  `reachableFrom`, so elevation steps and per-class costs are the real rules.
- **Diagnostics** (reported, never a pass): slot→centre distance, class-aware
  cheapest route cost to the centre (Dijkstra over the pathfinder's eight
  neighbours and `moveCost`), reachable ore and sites per slot, passable area and
  reach per class, centre-ring approach count, and terrain counts.

Deliberate limitations of the validator: building footprints are excluded from
the accessibility graph (each base exists in two quadrants only, so including
them would compare unlike ground), and it tests rotational symmetry only — it
does not claim competitive balance.

### 4.1 Results

All eight maps: **zero problems** — structure, symmetry, starts, access and
force parity all pass. Every competitive map is `validateScenario`-clean and
`canLaunch`-true, and both seats start with identical forces.

- Symmetry is verified by mutation, not assertion: `tests/map-roster.test.ts`
  paints one ridge tile into a single quadrant, shifts one relay by two tiles,
  zeroes one ore deposit and removes one starting unit; the audit reports
  `asymmetric-terrain`, `asymmetric-objective`, `asymmetric-terrain` and
  `asymmetric-force`/`force-mismatch` respectively.
- Accessibility: on all eight maps, 100 % of terrain-passable tiles are
  reachable from every slot by every land class, and all neutral sites and ore
  are reachable from every slot by every class.
- Reach counts are equal across `foot`/`wheeled`/`tracked` by design: this
  engine hard-blocks only ridge and deep water for land units, so the movement
  classes differ in **cost**, not in the set of standable tiles. The class-aware
  route-cost diagnostic is therefore the discriminating measure (e.g. Drylands
  53.0 foot vs 49.6 wheeled; Ironworks 37.0 tracked vs 35.2 foot).
- Ore and site counts are identical for all four slots on every map
  (`orePerSlot` and `sitesPerSlot` sets have size 1), so no quadrant has a
  better economy.

---

## 5. Testing and builds

| check | result |
|---|---|
| Full suite `npx vitest run` | **105 files, 1 202 tests passed** |
| `npx tsc --noEmit` | clean |
| `npm run build` (tsc + vite + service worker) | success, `dist/assets/index-*.js` 760.75 kB / 227.20 kB gzip |
| Worker build `vite build --config mp-room-vite.config.ts` | success, `dist-mp-room/roomWorker.js` 608.70 kB / 151.84 kB gzip |
| Live UI check (dev server, browser) | skirmish deck renders 8 catalogue cards, each with a painted raster, correct focus/size/tags; selecting Crossing Point updates the title, lede, `96 × 96 tiles` and brief tags |

New tests in [map-roster.test.ts](tests/map-roster.test.ts) (86 cases) cover:

- catalogue uniqueness, count (12), campaign/competitive split, mode filtering,
  strict availability answers for junk ids, display summary without tile
  generation, eight distinct names/focuses/footprints, campaign references;
- four derived slots per map, 1v1 opposite pair, explicit 2v2 pairs, seat starts
  on slots 0 and 2;
- roster-wide audit with zero problems, plus mutation tests proving the audit
  detects one-quadrant terrain, moved objective, altered deposit and unequal
  force;
- per map: valid and launchable, square with four buildable starts, both seats
  have a base, ≥ 8 units and ore, no unit inside a structure footprint, byte
  identical regeneration, scenario JSON round trip preserving slots, a live
  120-tick `Game` run, and levelled ground under both command posts;
- class-aware route cost: finite, equal for all four slots, tracks slower than
  boots in woodland, and Contact Zone less than half of Drylands;
- multiplayer: campaign-only ids, unknown ids, malformed ids rejected; all eight
  competitive ids accepted and built with both seats human and the requested
  duration; both seats byte-identical; direct construction from a campaign id
  throws; nation/colour stamping leaves the layout untouched;
- host map selection on the wire: host switch clears both ready states and
  broadcasts, guest refused (`host-only`), unavailable ids refused
  (`invalid-map`), malformed `mapId` refused (`malformed-message`), and the
  lobby config thereafter builds the new map;
- campaign separation: all four legacy maps still load, validate, launch, keep
  two authored starts and declare no four-way slots; every campaign mission's
  `mapId` is campaign-available;
- wiring: skirmish and lobby source read `scenariosForMode(...)` and no longer
  reference `BUILTIN_SCENARIOS`.

Updated existing tests: `campaign.test.ts` and `maps.test.ts` read `SCENARIOS`
(the legacy mirror-symmetry tests now name their three maps explicitly, since
the competitive roster is four-way, not mirrored); `phase2b1`/`phase2b2`/`phase2b3`
use `open-front` as the default multiplayer map instead of the campaign island.

---

## 6. Safety constraints observed

- No deployment of any kind; production configuration untouched.
- No commit, no reset, no stash, no discarded work. The pre-existing
  uncommitted multiplayer/lobby work was extended, not overwritten.
- `MULTIPLAYER_FEATURE` remains disabled and multiplayer room capacity, daily
  allowance and match deadlines are unchanged.
- No paid services, quotas or fallbacks added; the Worker bundle grew only by
  the competitive scenario data it must own to build an authoritative match.
- Authoritative simulation, combat rules, networking protocol, snapshot schema,
  checkpoint interval and room lifecycle semantics are unchanged. The only
  simulation-module edits are the additive `slots` metadata (parse/validate) and
  two objective strings that said "secure the island" on every map.

---

## 7. Known limitations and unverified items

- **Fairness is not proven.** Symmetry, equal ore/site access and equal route
  cost per slot are necessary, not sufficient. Nothing here proves that a map
  plays well; playtesting is still required, and the report does not claim
  balance.
- **Class differentiation is economic, not hard.** Land classes share
  passability (ridge/deep water block all of them), so "armour routes" and
  "infantry cover" are expressed through movement cost, cover, concealment,
  sight blocking and building footprints. Ironworks does not hard-forbid
  vehicles anywhere; it makes them slow and exposed.
- **No sightline or artillery-firing-line model.** Line-of-sight is not
  simulated in the validator; the elevation range (High Ground up to 3) and
  forest/ridge counts are reported as proxies only.
- **No chokepoint metric.** Centre-ring passable tiles are counted, but that
  number is 32/32/32 on every map because passability is uniform; it is kept as
  a structural sanity check, not a chokepoint measure.
- **The two unused 1v1 quadrants are neutral, not removed.** They carry
  symmetric ore and sites that both players can expand into. Both players reach
  them equally, but their presence does make 1v1 expansions less contested than
  a purpose-built two-player map would be.
- **2v2 is metadata only.** Slot pairing exists and is tested; there is no 2v2
  lobby, networking or matchmaking, and none is claimed.
- **Littoral declares naval in its domains** because its water is navigable, but
  no naval balance claim is made and no naval unit is required.
- **The lobby battlefield card was not exercised against a live room in this
  session.** The local dev app is pointed at a pre-existing worker on
  `127.0.0.1:8795` built as `phase2b4-live` whose origin allowlist rejects the
  dev page (403 on preflight); that worker is the user's own process and was
  left untouched. The panel's rendering path, catalogue wiring and host map
  intent are covered by typecheck plus the protocol/lobby tests above, but the
  visual preview inside a live lobby is unverified here. The skirmish selector
  was verified in the browser.

---

## 8. Files changed

**New**

- [src/data/scenarioCatalog.ts](src/data/scenarioCatalog.ts) — catalogue, modes, slots, defaults.
- [src/data/competitiveMaps.ts](src/data/competitiveMaps.ts) — eight four-way maps.
- [src/data/mapValidation.ts](src/data/mapValidation.ts) — reusable audit and diagnostics.
- [tests/map-roster.test.ts](tests/map-roster.test.ts) — catalogue, symmetry, access, lobby, separation.
- [MCA_MAP_ROSTER_REPORT.md](MCA_MAP_ROSTER_REPORT.md) — this report.

**Modified**

- [src/sim/scenario.ts](src/sim/scenario.ts) — optional `slots`, parse and validation.
- [src/data/scenarios.ts](src/data/scenarios.ts) — builtin list moved to the catalogue.
- [src/app.ts](src/app.ts) — catalogue-driven skirmish selection, tags/players in the brief.
- [index.html](index.html) — brief rows for strategic tags and player count; skirmish copy.
- [src/style.css](src/style.css) — lobby battlefield preview.
- [src/ui/multiplayerPanel.ts](src/ui/multiplayerPanel.ts) — battlefield card, host map picker, preview, detail.
- [src/multiplayer/lobbyConfig.ts](src/multiplayer/lobbyConfig.ts) — catalogue validation, defensive build.
- [src/multiplayer/protocol.ts](src/multiplayer/protocol.ts) — `lobbySet.mapId`.
- [src/multiplayer/roomLobby.ts](src/multiplayer/roomLobby.ts) — host-only `setMapId`, readiness reset.
- [src/multiplayer/lobbyClient.ts](src/multiplayer/lobbyClient.ts) — `setMap`.
- [src/multiplayer/roomDurableObject.ts](src/multiplayer/roomDurableObject.ts) — multiplayer default map.
- [src/multiplayer/roomMatch.ts](src/multiplayer/roomMatch.ts) — multiplayer default map.
- [src/sim/game.ts](src/sim/game.ts), [src/ui/hud.ts](src/ui/hud.ts) — objective copy no longer says "the island".
- [tests/campaign.test.ts](tests/campaign.test.ts), [tests/maps.test.ts](tests/maps.test.ts),
  [tests/phase2b1-lobby-lifecycle.test.ts](tests/phase2b1-lobby-lifecycle.test.ts),
  [tests/phase2b2-lobby-client.test.ts](tests/phase2b2-lobby-client.test.ts),
  [tests/phase2b3-network-battle.test.ts](tests/phase2b3-network-battle.test.ts) — follow the catalogue.

All changes are uncommitted, as requested.
