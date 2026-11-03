# MCA: Modern Combined Arms

A playable vertical slice of a modern combined-arms real-time strategy game: author
an island, launch it into a real battle, build an economy, command land, air and
naval forces against a skirmish AI, and win or lose the island.

Runs on the **Irontide Engine** — the fixed-step simulation, WebGL2 renderer and
scenario tooling in this repository. Its mark is a hex plate carrying a tide
crest: the simulation lattice under the water line. It is the second beat of the
launch sequence, after the studio sting, and the game's own lockup then flies
from the intro plate into the menu header.

The design reference is [Modern_Combined_Arms_RTS_GDD_v0.1.md](Modern_Combined_Arms_RTS_GDD_v0.1.md).
The implementation history, GDD gap matrix, architecture notes and verification
log live in [docs/PLAN.md](docs/PLAN.md). The current audit and next-phase plan are
in [docs/AUDIT_FINDINGS.md](docs/AUDIT_FINDINGS.md),
[docs/VERIFICATION_REPORT.md](docs/VERIFICATION_REPORT.md) and
[docs/NEXT_PHASE_PLAN.md](docs/NEXT_PHASE_PLAN.md). The faction and roster work
is recorded in [docs/PHASE_2_ROSTER.md](docs/PHASE_2_ROSTER.md),
[docs/PHASE_3_NATIONS.md](docs/PHASE_3_NATIONS.md) and
[docs/PHASE_4_NATIONS.md](docs/PHASE_4_NATIONS.md); the national matchup evidence,
counterplay tests and the ranked follow-up list are in
[docs/PHASE_5_MATCHUP_AUDIT.md](docs/PHASE_5_MATCHUP_AUDIT.md). The AI
employment work (planned artillery, single protected Pathfinder, drone demand,
seat-symmetry diagnostic) and its measurements are in
[docs/PHASE_6_AI_EMPLOYMENT.md](docs/PHASE_6_AI_EMPLOYMENT.md). The indirect-fire
and match-resolution audit — why AI battles stall, what artillery actually does,
and the measurements behind both — is in
[docs/PHASE_7_INDIRECT_FIRE_AUDIT.md](docs/PHASE_7_INDIRECT_FIRE_AUDIT.md).

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # typecheck + production bundle in dist/
npm test           # 1116 Vitest tests
npm run bench      # measured simulation/save/pathfinding performance
```

No framework, no runtime dependencies: TypeScript modules, a hand-written WebGL2
renderer, Canvas2D overlay/minimap, and a fixed-step simulation. Requires a
WebGL2-capable browser (desktop, or landscape mobile).

### Network play

A 1v1 room is two processes: the game client and an isolated room worker.

```bash
npm run rooms:dev                              # room worker on 127.0.0.1:8791
npm run dev                                    # client on 127.0.0.1:5173
```

In development the deck dials `http://127.0.0.1:8791` automatically. A
production build takes its address from the build environment, and
[.env.production](.env.production) supplies the live one, so `npm run build` and
`npm run release` ship a deck that can host and join rooms with no extra steps.
Override it for a different worker:

```bash
VITE_MULTIPLAYER_URL=https://your-room-worker.example npm run build
```

A build with no address leaves Multiplayer disabled — the menu entry stays
dimmed, so an unconfigured bundle can never point players at nothing.

### Ship the live room worker

The app and the room worker are two deployments of one project. The app is the
Pages site; the worker is a separate Worker with the room and capacity Durable
Objects. Live play needs both, and three things must agree:

| What | Where | Value |
| --- | --- | --- |
| Room address the deck dials | `.env.production` | `VITE_MULTIPLAYER_URL` |
| Origin allowed to reach the worker | [mp-room-wrangler.live.jsonc](mp-room-wrangler.live.jsonc) | `MP_ALLOWED_ORIGINS` |
| Origin allowed to open a socket | [public/_headers](public/_headers) | `connect-src` |

All three already name `https://mca-multiplayer-staging.horsemeninteractive.workers.dev`
and `https://moderncombinedarms.pages.dev`. Moving either deployment means
editing all three in the same commit; the worker refuses an unlisted browser
origin before it touches a room, and the browser refuses an unlisted socket
before it opens one.

```bash
npx wrangler secret put MP_ADMIN_TOKEN     # once per worker
npx wrangler secret put MCA_RESERVATION_TOKEN
npm run rooms:deploy                       # build the worker and deploy it live
npm run release                            # build the app and publish it to Pages
```

`npm run rooms:deploy` uses the live config, which has development mode off: no
probe page, no loopback exemption. `npm run rooms:dev` keeps using
[mp-room-wrangler.jsonc](mp-room-wrangler.jsonc) with development mode on, which
is what admits a loopback page during local play.

The deck is: host a room (the room reserves capacity, so it must be started
before the reservation runs out), share the room code and join code, the guest
claims the second seat, both players pick a nation and a colour, both ready up,
and the host starts. Nothing starts automatically: connecting is never a start,
and the room re-validates occupancy, connectivity, readiness and the remaining
reserved window before it builds the authoritative match.

The deck is: host a room (the room reserves capacity, so it must be started
before the reservation runs out), share the room code and join code, the guest
claims the second seat, both players pick a nation and a colour, both ready up,
and the host starts. Nothing starts automatically: connecting is never a start,
and the room re-validates occupancy, connectivity, readiness and the remaining
reserved window before it builds the authoritative match.

## Install it

The build is a PWA: a manifest, an icon set and a service worker that caches the
shell. Run `npm run build && npm run preview`, open the preview over `localhost`
(or any HTTPS host) and use the browser's install action, or the address-bar
install button. Installed, it launches fullscreen in landscape; the page and its
hashed assets load from cache when the host is unreachable.

The worker is registered only in production builds, so `npm run dev` never pins
stale modules. Regenerate the icons with `node tools/make-icons.mjs` after
editing [public/insignia.svg](public/insignia.svg).

## Release it

`npm run release` is the whole release. It checks that `package.json`, the
`## [x.y.z BETA]` heading in [CHANGELOG.md](CHANGELOG.md) and the `#menu-build`
footer in [index.html](index.html) agree on the version, refuses a dirty tree
(the build stamp is the commit count), runs the test suite, builds, uploads
`dist/` to the `moderncombinedarms` Pages project, and then waits until the live
site is serving the new bundle.

So the order is: bump the version in those three places, write the notes,
commit, then `npm run release`. The upload needs Cloudflare credentials once
(`npx wrangler login`); `--dry-run` stops before the upload, `--skip-tests`
skips the suite, and `--allow-dirty` ships an uncommitted tree under the
previous commit's build number. `PAGES_PROJECT`, `PAGES_BRANCH` and `PAGES_URL`
override the project, branch and verification URL.

## What is in the slice

- **Front end**: a click-to-start gate takes the gesture browsers need for
  sound and fullscreen, then the studio sting plays (skippable, with a static
  plate when playback is refused), the engine beat follows, then the game's
  emblem alone. It flies
  into the menu header, where the rule draws and the three words type in like a
  field report. The menu opens with nothing selected over the drifting island,
  read through a field monitor (scanlines, a slow refresh roll, and a jamming
  burst every few seconds that kicks the picture and tears the downlink).
  Choosing a deck breaks the signal once and swaps the deck; the header and
  footer hold still. The menu is four entries: **Singleplayer** (tutorial,
  campaign and skirmish, with a live mission-brief map and saved battles),
  **Multiplayer**, **Map Editor** and **Settings**. The shipped build carries a
  room worker address (see *Network play* below), so Multiplayer opens a working
  1v1 lobby; a build with no address marks it SOON, dimmed and `aria-disabled`
  instead of pointing players at nothing. One shared settings sheet
  feeds both the menu view and the in-battle settings modal — audio volumes,
  fullscreen, interface scale, graphics quality and render scale, an FPS
  readout, Escape behaviour, unit silhouettes and the visual-effect and
  camera-comfort switches. Its Fullscreen switch follows the browser state,
  including leaving with Esc, and its Music volume rides the looping menu theme
  (Four-Note Motif) from the first menu frame, fading out for battle and the
  editor.
  Touch devices held upright get a blocking rotate prompt instead of a broken
  portrait battlefield.
- **Four theatres with a selector**: the Skirmish screen lists every built-in
  map as a card carrying its own terrain raster, focus and size. Selecting one
  repaints the brief, retitles the deck and swaps the battlefield behind the
  menu. Deploying shows a full loading screen over that same render, with the
  theatre, command, opposition, domains and opposing commander, and holds it
  long enough to read.
- **Island Assault — Kestrel Bay** (96×72): western beachhead, central ridge with
  one road pass, forested northern flank, contested signals relays, eastern
  expeditionary base, and a deep bay reaching the enemy coast.
- **Rust Valley** (112×80, armour): a landlocked basin split by an eight-tile
  massif with two wide passes; no navy, so tanks and flank routes decide it.
- **Kestrel Straits** (88×64, naval): two coasts across a deep strait, with two
  island strongpoints joined to each shore by shallow fords, so ground forces
  meet on the islands while the sea decides the flanks.
- **Foundry District** (104×76, urban): a dense mirrored city core of
  warehouses, offices, tenements and ruins, built for house-to-house fighting.
  Each commander starts on open outskirts with a wide clear yard for production
  and defences, then pushes in through the ring road toward the central square.
  The square itself is anchored by two mirrored landmarks: the domed **Civic
  Hall** (six occupants, three firing positions) and the **Foundry Works** under
  its twin chimneys (five occupants), with the relay, radar and depot objectives
  laid out around them.
  The three new maps are authored on the western half and mirrored across the
  centre line, so both commanders get identical ground, deposits, objectives
  and starting forces (`tests/maps.test.ts` compares every tile and entity with
  its mirror).
- **Economy**: materials from deposits via harvesters carrying 300-material
  loads, requisition from command posts and captured relays, engineer-placed and
  engineer-repaired structures (repair is free but suspended for a second after
  the structure takes a hit, so a crew works between bombardments, not through
  them), per-facility queues with smooth cameo progress,
  counts and drag-to-prioritise cards that auto-scroll near the sheet edges.
  A standing Command Post trickles 1 material/s while its owner has no
  harvester left, and a captured Forward Supply Depot adds 2 more without a
  harvester or refinery, so losing the hauling economy is a setback rather than
  an unrecoverable deadlock.
- **Strategic objectives**: neutral Signals Relays, Forward Supply Depots and
  Radar Stations are authored in the editor and captured by Combat Engineers.
  Relays pay requisition, depots pay supplementary materials, and a powered
  Radar Station plots hostile units within 22 tiles through terrain masking.
  Ownership, capture progress and the benefit are authoritative simulation
  state; neutral, enemy-owned, unpowered and destroyed structures pay nothing.
- **Urban garrisons**: riflemen and ATGM teams can occupy authored tenements,
  warehouses, office blocks, ruins, the civic hall and the foundry works (4, 4,
  5, 2, 6 and 5 occupants; 55%, 45%, 50%, 35%, 60% and 50% cover). Occupants fight from the
  building, are harder to kill with direct anti-structure fire, cannot be run
  over by vehicles, and die with the structure if it is destroyed. A neutral
  shelter occupied by hostile infantry becomes a legal target, so cover is a
  tactical position rather than an invulnerable box.
- **Fog of war**: three states, shared by ground, roads and structures. Ground
  under vision is lit; ground the team has charted before is desaturated and
  cooled before it is dimmed, so memory reads as memory rather than night;
  ground it has never seen is dark. The vision mask is cross-faded over one
  update interval, so a moving boundary slides instead of stepping every third
  tick, and ground, water, props and roads sample the same two masks through one
  fog function. Roads are charted the same way as the buildings on them — bright
  under vision, faded where the team has been before, and lost again in the dark
  — so a remembered street reads like a remembered block instead of a lit strip
  through the fog.
- **Land**: engineer, rifleman, medic, ATGM gunner, main battle tank,
  self-propelled howitzer, recon vehicle, AA vehicle, field recovery vehicle and
  harvester. Infantry are individual soldiers, not squads; a stationary medic
  slowly treats one wounded infantryman at a time. The howitzer lobs shells over
  cover with a four-tile minimum range, and the unarmed recovery vehicle patches
  nearby vehicles at a material cost.
- **Air**: strike fighter with four missiles, air-superiority interceptor and
  unarmed recon drone, all parked at a physical airfield with the automatic
  return/rearm loop. Interceptors answer hostile aircraft; the drone provides
  22-tile vision for the army and artillery; SAM batteries and AA vehicles remain
  the ground answer to air.
- **Sea**: a four-hull shipyard line — cheap two-missile fast attack craft, a
  six-missile corvette with a deck gun, a torpedo submarine that runs dived on a
  battery, and an escort frigate whose naval SAM box screens the group against
  aircraft while its sonar and depth charges hunt the submarine. All use
  water-only pathfinding, shipyard reload/repair and shore bombardment; a static
  coastal battery gives the shore a dedicated anti-ship missile answer on maps
  with navigable water.
- **Presentation**: a 2.5D 45°-rotated, 30°-tilted orthographic isometric view with
  2:1 diamond ground projection, procedural meshes and day-lit battlefield. Tile
  elevation levels are drawn as one continuous surface — flat tops with a ramp band
  wherever the level changes and sloped shorelines — and that same surface is what
  pointer picking, orders, placement ghosts and the editor's hover all resolve
  against. The construction grid appears only while placing a structure; the
  editor draws its own grid. A friendly unit hidden behind a structure draws a
  flat team-coloured silhouette (unless its own hull is visible), tall
  structures cast a short flat shadow along the sun, the ground carries a very
  low-frequency drift that breaks up large grass fields without touching road,
  ore or buildable colours, and shrubs, bushes and tufts are drawn from three
  green families at a lifted value so cover reads as vegetation rather than dark
  spots. No shadow maps, no post-processing and no camera change.
- **AI**: a seeded skirmish commander, not a script. The match seed picks a
  temperament (armour, infantry, air, economy or pressure), then a utility
  planner scores construction, production, scouting and attacks against its own
  economy, power grid, damage and terrain each second. It never receives the
  player's start position: every target comes from vision or a remembered
  contact, and a lost trail sends it back to reconnaissance. It builds and
  reaches air and naval branches under normal starting resources, replaces lost
  units, repairs badly damaged structures, values relays/depots/radar according
  to its shortages, garrisons nearby cover when defending and commits waves
  through the same command API as the player. A fresh battle draws a new seed,
  so the same map does not always open the same way; saves keep the seed and
  replay the same opponent.
- **AI difficulty**: the menu offers Recruit, Veteran and Elite. Recruit thinks
  slowly, runs the thinnest economy, ignores what it scouted and feeds units in
  as they finish. Veteran balances expansion and timing. Elite decides every
  half second, builds the broadest economy, counters the force it scouted,
  masses a supported wave and keeps a home guard. The level changes decisions
  only — it never grants extra resources, free vision or different combat
  rules. It also fields the completed baseline: a drone for reconnaissance,
  interceptors against hostile air, artillery against static defences and
  recovery support after vehicles take damage. The mirrored AI-vs-AI ladder
  still orders the levels clearly; the current numbers and limits are in
  [docs/VERIFICATION_REPORT.md](docs/VERIFICATION_REPORT.md) §35–§38. The choice is
  saved for new battles; a loaded save keeps the level it was fought at.
- **Nation setup**: a skirmish starts with one of the ten nations. The picker
  groups them by alliance, the mission brief and loading screen name both sides,
  and the HUD, selection panel, relay meter and end screen read the same registry
  identity (never a hard-coded side). The opposing AI is the other alliance's
  default nation. Each nation fields one national substitution, one exclusive
  unit and one structure variant — Pathfinder, Spearhead, MLRS, K9 Thunder, CV90,
  Heavy Howitzer, 3rd Khordad, Bulsae-4 and their structures among them — shown
  with a NATIONAL badge in production and construction, alongside a second,
  nation-only unit the shared baseline never lists. Legacy
  `baltic`/`expeditionary` scenarios and saves keep working, and the editor can
  assign any nation or preset per player.
- **Interface**: two battle HUD compositions over one simulation. Desktop uses a
  compact left command rail with resources, objective, control groups and mission
  actions, a persistent right production sidebar with tactical map, and a bottom
  console with its command toolbar above the selection panel. Mobile landscape
  uses a compact top strip with objective chip, right production rail that opens
  a sheet, collapsible
  tactical-map overlay, a bottom selection/command bar with a sticky Add toggle,
  and touch-accessible control groups. Both use the same `App` commands. Unit and
  structure cards show procedural three-quarter portraits rendered from the same
  meshes as the battlefield; the selection panel shows the selected asset's
  portrait, with a count badge for a group.
  HUD type comes from one scale (`--fs-xs` to `--fs-xl`, 11–18 px) multiplied
  by an interface-scale property, and resource figures are set larger than their
  labels. Command buttons carry their hotkey on desktop and drop it on touch.
  Unaffordable and locked production and construction cards print the reason on
  the card itself (`NO MATERIALS`, `NEEDS SHIPYARD`, `QUEUE FULL`) and separate a
  temporary shortage from missing technology by colour. While no radar is
  online the tactical map collapses to a slim bar that names the reason, and the
  Radar Array card is flagged in the Base tab. A selection of more than eight
  units collapses to one card per type with a count; clicking that card narrows
  the selection to the type.
- **Editor**: terrain/elevation/ore painting, water authoring, structures, units,
  player starts, objectives, ground/naval reachability previews, validation, JSON
  save/load, and one-click deploy into the real simulation. On touch and short
  screens the tools become a 44 px drawer, settings open in a draggable bottom
  sheet, and PAN plus zoom buttons replace the right-drag/wheel controls.
- **Persistence**: three browser save slots with versioned save and scenario
  data, plus restart. Deterministic fixed-step simulation (20 Hz) with seeded
  randomness.

## Controls

| Action | Desktop | Touch | Gamepad |
| --- | --- | --- | --- |
| Select / box select | LMB click / drag | Tap / drag, or **BOX** | A on cursor |
| Add to selection | Shift | **ADD** toggle, then tap | — |
| Move / attack / rally | RMB | Tap destination / **ATTACK** | A / X |
| Attack-move | `A` | **A-MOVE** command bar | X |
| Stop / hold | `S` / `H` | **STOP** / command bar | Y |
| Repair damaged structure | RMB with a Combat Engineer selected | **REPAIR**, then tap the structure | — |
| Capture objective | RMB relay/depot/radar, or `C` | **CAPTURE** | — |
| Garrison / exit | RMB a shelter with infantry, or **GARRISON** / **EXIT** | **GARRISON** / **EXIT BUILDING** | — |
| Return aircraft/ship | `R` | **RETURN** | — |
| Dive / surface submarine | `D` | **DIVE** | — |
| Construction | `B`, or engineer + **BUILD** | **BUILD** tab | — |
| Control groups | `Ctrl+1..9`, `1..9` | group strip | — |
| Pan / zoom | Arrow keys, screen edge, RMB/middle drag, wheel | one-finger pan, pinch | left/right stick |
| Pause / speed | `P` / `+` `-` | **PAUSE** | Start |
| Debug overlay | `F3` | **DIAG** | — |
| Select all army | `Ctrl+A` | — | — |
| Select every visible unit of a type | double-click it | double-tap | — |
| Next idle harvester / engineer | `F8` / `F9` | — | — |
| Jump to last alert | `F2`, or click a critical toast | tap the toast | — |
| Camera bookmarks | `Ctrl+Shift+1..4` save, `Shift+1..4` recall | — | — |

Attack-move and stop deliberately own `A` and `S`; camera panning uses the arrow
keys, screen edge, drag and the wheel so keyboard orders never conflict. The
briefing stays on `F1` and the debug overlay on `F3`, so camera bookmarks use
`Shift+1..4` rather than the function row, and `Ctrl+1..9` remain control groups.
Escape pauses the battle or opens the menu, according to the setting; an active
command mode always cancels first.

## Layout

```
src/sim/       authoritative simulation: map, scenario, pathfinding, combat, AI, save
src/data/      unit, weapon, building, faction/nation roster and scenario data
src/render/    WebGL2 renderer, camera, procedural meshes, terrain, water, effects
src/ui/        HUD, input (mouse/touch/gamepad), overlay, minimap, audio, editor
tests/         determinism, movement, combat, economy, air, naval, AI, editor, perf
```

The simulation never reads rendering state. Rendering interpolates entity
presentation but gameplay outcomes come only from `Game.tick()` at a fixed
50 ms step. Commands are queued and processed in stable order; random draws use
the save-persisted seeded generator.

### Faction content model

`src/data/factions.ts` defines the two alliance baselines, the ten playable
nations — the six launch nations plus Finland, Sweden, Iran and North Korea — and
the legacy `baltic`/`expeditionary` presets. The presets stay valid for existing
maps and saves; new playable identities are the nations.
`src/data/roster.ts` resolves either one to a frozen roster, with national
additions, exclusions and substitutions declared as data. A substitution maps a
baseline id to another registered definition with a unique id, so a national
variant can keep the baseline production slot without cloning simulation code.
Skirmish setup selects one of the ten nations, stamps it (and the opposing
alliance's default nation) into the scenario and carries it through battle
state, save/load and every side label. `Game.rosterFor` resolves the acting
player's roster and gates production and construction, so a later national
roster change needs no second code path in the simulation, UI or AI. Every
nation still inherits the shared combined-arms baseline and replaces exactly one
slot with its national variant: Lithuania's unarmed Pathfinder scout, Poland's
Spearhead MBT, the UK's MLRS battery, Russia's Heavy Howitzer, Belarus's Deep
Recon UAV and Hungary's Reinforced Bunker. These are full registered definitions
with a `variantOf` family link, not cloned or patched baseline records; the
legacy presets, old maps and existing saves keep the unmodified baseline. See
[docs/PHASE_4_NATIONS.md](docs/PHASE_4_NATIONS.md).

## Tests and measurements

`npm test` runs 1116 tests across 104 files, including nation identity, roster
gating and national substitutions, national counterplay fixtures, two-run
state-hash determinism, batch-size
invariance, save/load round-trip, blocked paths,
aircraft recovery, naval navigation, reload and the three-hull fleet, full-ammo
ship repair, AI shipyard/naval and airfield/fighter production, indirect-fire minimum range
and lobbed-projectile round-trip, recovery repair, interceptor/drone/coastal
roles, scenario validation, terrain-surface picking and measured performance. The infrastructure suite
covers relay/depot/radar capture, passive income, brownout, multiple depots and
save/load; the garrison suite covers entry, capacity, exit, protection, firing,
enemy clearing, destruction and AI occupation. `npm run ai:matchups` runs the
mirrored, eight-seed Recruit/Veteran/Elite ladder on its own and prints the
margins; `npx tsx tools/ai-matchups.ts <levelA> <levelB> [seeds] [ore]` runs a
wider sample for a tuning pass. `npx tsx tools/nation-matchups.ts [seeds] [seconds]
[difficulty]` plays the six-nation round robin with seat swaps and personality
rotation and prints per-match, per-pair and per-nation JSON; set `MCA_SEEDS` to
run an independent seed set. It is deliberately outside the unit suite because a
full matrix is minutes of simulation; the current evidence is in
[docs/PHASE_5_MATCHUP_AUDIT.md](docs/PHASE_5_MATCHUP_AUDIT.md) and
[docs/PHASE_6_AI_EMPLOYMENT.md](docs/PHASE_6_AI_EMPLOYMENT.md). `npx tsx
tools/seat-symmetry.ts` prints the duel/mirrored-advance diagnostic. `npx tsx
tools/timeout-audit.ts [seeds] [seconds] [difficulty] [nations]` runs the same
arena and classifies every match that reaches the cap — objective damage,
repair, artillery duty cycle, phase time, force concentration — against the
rules in [docs/PHASE_7_INDIRECT_FIRE_AUDIT.md](docs/PHASE_7_INDIRECT_FIRE_AUDIT.md);
`npx tsx tools/indirect-fire-experiments.ts [seeds] [seconds]` plays the six
controlled artillery/bunker fixtures. `npx tsx tools/siege-duels.ts [seconds]`
plays a defended command post against a stated attacker set with each candidate
repair rule; the results and the decision behind the shipped rule are in
[docs/PHASE_8_SIEGE_REPAIR_DESIGN.md](docs/PHASE_8_SIEGE_REPAIR_DESIGN.md). The
replication of that rule on three disjoint seed pools, including the
`MCA_REPAIR_RULE=off` experiment-only control that disables suppression on the
current tree, is in
[docs/PHASE_9_REPAIR_SUPPRESSION_REPLICATION.md](docs/PHASE_9_REPAIR_SUPPRESSION_REPLICATION.md).
`npx tsx tools/collapse-fixtures.ts [seconds] [orePerTile]` plays the
deterministic army-collapse fixtures (a remembered post, a fixed force, an
optional bank, repair crew or working base), and `MCA_ARENA_ORE=1200` changes the
arena's ore field for an economy experiment; set `MCA_AI_APPROACH=off` to run
any of these arms with the pre-Phase-11 assault aim. The findings are in
[docs/PHASE_10_ARMY_COLLAPSE_AUDIT.md](docs/PHASE_10_ARMY_COLLAPSE_AUDIT.md).
`npx tsx tools/ladder-diag.ts [levelA-levelB] [seconds] [replication]` reruns the
difficulty ladder with the aim on and off and prints per-match waves, refused
orders, casualties and objective damage; the assault-destination fix and its
ladder evidence are in
[docs/PHASE_11_ASSAULT_DESTINATION_AND_DIFFICULTY.md](docs/PHASE_11_ASSAULT_DESTINATION_AND_DIFFICULTY.md).
The AI's information boundary is audited by `tests/fog-integrity.test.ts` — an
unseen structure may refuse an order but may not steer a destination, a capture
or a construction site — with the findings, the two corrections and the remaining
build-site dependency in
[docs/PHASE_12_FOG_OF_WAR_AUDIT.md](docs/PHASE_12_FOG_OF_WAR_AUDIT.md); that
dependency is closed in
[docs/PHASE_13_BUILD_SITE_INFORMATION_AUDIT.md](docs/PHASE_13_BUILD_SITE_INFORMATION_AUDIT.md);
the construction-priority fixtures that followed it — a second drop-off only when
the haulers have saturated the drop-offs, the perimeter only while the scouted
force outnumbers the armament — are in `tests/construction-priority.test.ts`, with
the audit in
[docs/PHASE_14_CONSTRUCTION_PRIORITY_AUDIT.md](docs/PHASE_14_CONSTRUCTION_PRIORITY_AUDIT.md).
The economy's recovery rules are pinned by `tests/economic-recovery.test.ts` — an
idle bank climbs at the headquarters' 1 mat/s when no drop-off exists and none is
affordable — and the perimeter's request surface by
`tests/defence-priority.test.ts`; both audits, the recovery fix and the unchanged
defensive priorities are in
[docs/PHASE_15_ECONOMIC_RECOVERY_AND_DEFENCE_PRIORITY_AUDIT.md](docs/PHASE_15_ECONOMIC_RECOVERY_AND_DEFENCE_PRIORITY_AUDIT.md).
The no-engineer deadlock that followed it — a stranded base spending its one-per-second
lifeline on riflemen — is closed by a production reserve for the engineer's authoritative
300; the fixtures and the measured limits of that fix (it does not rescue the 111
end-of-loss sides from the Phase 15 matrix) are in
[docs/PHASE_16_NO_ENGINEER_ECONOMIC_RECOVERY.md](docs/PHASE_16_NO_ENGINEER_ECONOMIC_RECOVERY.md).
The renderer and the art pipeline are audited in
[docs/VISUAL_AUDIT_PHASE_1.md](docs/VISUAL_AUDIT_PHASE_1.md), with twelve reference
captures under `docs/visual-audit/`, the measured frame budget and one recommended
first slice. Phase 2 fixes the road fog binding, records the matched before/after
luminance and adds `tools/visual-probe.js`, the deterministic Kestrel Bay baseline.
The interface and renderer suites pin the review's pure logic: type scale and
layout resolution, interface scaling, graphics presets and render scale, Escape
behaviour, idle cycling and roster grouping in `tests/ui-settings.test.ts` and
`tests/hud-layout.test.ts`, and the fog cross-fade, silhouette pass, structure
shadows and vegetation variants in `tests/presentation.test.ts` and
`tests/terrain-props.test.ts`. `npm run bench` prints the performance numbers; the
latest runs are recorded in
[docs/VERIFICATION_REPORT.md](docs/VERIFICATION_REPORT.md) §34–§38.

## Known limitations

- Gamepad support is implemented but was not exercised on physical hardware.
- The desktop/mobile HUD structure and touch targets are measured in a Chromium
  viewport; physical notches, safe-area insets and low-end touch devices were not
  exercised. Thumbnails are generated at runtime from the low-poly meshes (no
  pre-rendered artwork); the first battle start prewarms every card and selection
  portrait in about 0.16 s behind the loading screen, and later cache misses
  queue off-frame. Icons remain the fallback if WebGL is unavailable.
- Audio is generated with Web Audio and has not been auditioned in automated runs.
- The renderer is validated by shader compilation, a live WebGL2 context, frame
  timing and DOM checks, not pixel-diff screenshots.
- One AI opponent. The campaign is a short linear prologue over the built-in
  theatres rather than a full campaign; online play is 1v1 only, joined by room
  code with no room browser, accounts or matchmaking (`MULTIPLAYER_FEATURE`
  keeps `roomDiscovery` and `accountLinking` off); there is no mod SDK. All ten nations are selectable in skirmish and each substitutes one shared baseline
  slot with a national variant, adds one exclusive unit and one structure
  variant, and Sweden and Iran also add a national naval hull of their own; but
  they have no national-only upgrades or signature abilities yet;
  every shared slot is common. The national values are not balance-tuned against
  human play, and no human match has been played with each of the ten nations.
- The shared baseline has no mechanised transport or IFV: the simulation still
  lacks passenger/load/unload state. Recovery is a repair vehicle, not a
  recovery-and-tow system. Attack helicopters, field obstacles and a second
  buildable naval hull remain future roles. See
  [docs/PHASE_2_ROSTER.md](docs/PHASE_2_ROSTER.md).
- AI difficulty is tuned by mirrored AI-vs-AI matchups, not human win rates.
  The symmetric ladder arena has no water or ridges, so air and naval branches
  are verified separately; the levels describe relative commander strength in
  the ladder, not a promised outcome against a particular player.
- **The mobile result screen is not usable yet.** At 844×390 the card is taller
  than the viewport and all four actions are below the visible area; at 667×374
  the card is 499 px tall in a 374 px viewport. The page does not scroll and the
  action buttons are 36.9 px high. Rotating or resizing after a result also
  removes the result card, and resizing while paused hides the pause overlay
  while the simulation stays paused. See [docs/AUDIT_FINDINGS.md](docs/AUDIT_FINDINGS.md)
  §9.4 (HUD-10, HUD-11, HUD-12).
- At 1280×720 the persistent desktop HUD leaves 62.1% clear battlefield (chrome
  37.9%), and at 1920×1080 it leaves 72.1% (chrome 27.9%). These are CSS-pixel
  measurements from a Chromium viewport, not a pixel-diff review, and they were
  taken before the type-scale and interface-scale pass changed the panel sizes.
- The interface and renderer changes were verified by typecheck, the full suite,
  a production build, shader compilation and a live WebGL2 context. No scripted
  in-battle capture exercised the silhouettes or the fog cross-fade; the shared
  browser tab was under manual control during the check.
- The harvesting/ore/refinery economy is retained for this slice. A later
  extension will build on it; R-01's removal model is deferred, not implemented.
- The infrastructure/garrison balance is first-pass. Depot income is fixed at
  2 materials/s and the tenement/ruin cover at 55%/35%; these are tested for
  correctness and rough proportion, not settled by human matches.
- Garrison combat is a restrained building-envelope model, not room-by-room
  interiors or directional firing ports. Occupants fire from the shelter centre
  with their normal weapons, range and line of sight; at most the configured
  firing slots engage per update.
- The AI difficulty ladder is measured on a symmetric arena with two harvester
  loads per ore tile. On the shipped maps a deposit holds one load, so the ore
  runs out after about three minutes and the three levels stop separating;
  fixing that belongs to the deferred economy extension, not the ladder.
- Saves live in `localStorage` and are tied to this browser profile.
