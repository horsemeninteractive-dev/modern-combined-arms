# Changelog

All notable changes to **MCA: Modern Combined Arms** are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

The release version and stage come from `package.json`; the build number shown
in the menu is the repository commit count at build time. The same file is
rendered in game from **Changelog** in the main-menu footer.

## [0.4.1 BETA] — 2026-11-03

A patch release for the two things the 0.4.0 build got wrong in play: static
defences that did not train their weapons, and the pause before a networked
battle appeared.

### Defence

- **SAM batteries now traverse onto their target.** The launcher is no longer welded to the pad: the four ready rounds turn on a turntable at 1.6 rad/s on the shared battery and 1.1 rad/s on the Russian long-range site, so the mount visibly trains ahead of the shot instead of firing out of a fixed rack. The pad, fire-control mast, revetment and team panel stay put, the national colour moved to the rear pad corner so it no longer turns with the launch rails, and the site still returns to its own facing when no aircraft is in range.
- The Russian long-range site and the national coastal batteries keep their own train rates, so the heavier mounts still lay more slowly than the shared battery.

### Interface

- **Starting or joining an online battle shows the standard loading brief** while the room links and the first battlefield arrives, instead of a frozen frame with no explanation. The brief names the side you actually fight as, reads "Remote commander" in the opposition slot and shows a linking hint, and it is held until the room's first update has been applied rather than dropping the player onto an empty map.

### Tooling

- The deployed multiplayer smoke script was rewritten against the current lobby lifecycle: it opens a room, joins by code, starts the match, plays it out and checks the authoritative result instead of the retired protocol.

### Verification

- `npx tsc --noEmit` clean and `npm run build` clean. `npm run release -- --dry-run` confirms that `package.json`, this file and the menu footer all agree on `v0.4.1 BETA` and stamps the built bundle with it.
- The SAM traverse was verified in the running game: the site acquired an inbound fighter, its `turretFacing` turned from 0 to -0.46 rad and the rendered launcher followed the same angle, with the pad and mast unmoved.
- Full `vitest` run: 128 files, 1,684 tests, 1,683 passed. The one failure is the tracked difficulty-ladder baseline in `tests/ai-matchups.test.ts` (`recruitVsVeteran.margin` -16,547 against its < -30,000 bar), unchanged from 0.4.0; nothing was re-tuned to make it green. A first pass also caught a real regression from the launcher split — the SAM flag pole anchored to the old rack and floated 0.25 above the pad — which is fixed by mounting the pole on the rear pad corner.

## [0.4.0 BETA] — 2026-11-03

A research and roster release. The four-branch technology tree is now playable
from the production sidebar, it gates what a nation can build rather than only
what it can read, the first unit ability and the first building module are live
end to end, and the roster grows from six playable nations to ten.

### Research

- **Four branches, two tiers, eight technologies** — Manoeuvre, Fires, Air and Naval. Tier 2 requires its own tier 1 and nothing else, so no branch is a gate on another and the tree stays a set of choices rather than a ladder.
- Nodes cost 300–700 materials and 40–110 requisition and take 45–90 seconds at a standard centre. A nation's own Applied Research Centre runs one project at a time; cancelling refunds the full cost, and a centre that is unfinished, destroyed or blacked out pauses progress with the reason shown rather than silently stalling.
- **The research panel lives in the production tab strip**, not in a separate screen: four branches side by side, each node showing its name, tier, effect description, cost, duration, prerequisites and current status. A progress bar on the tab keeps the active project visible while the player is building.
- **Every technology reports why it cannot start** — available, researching, completed, locked by prerequisites, barred to the faction, another project active, unaffordable, or no operational Research Centre — instead of looking permanently researched or permanently locked.
- Technologies granted by a scenario or a saved battle display as completed and close their own prerequisites, and completing one immediately opens the production and construction cards it unlocks.
- **AI commanders research for real.** Each seat weighs its strategy, its known enemy composition, its bank and the state of the match, picks a branch priority, pauses when a low bank would starve production, and never receives a free technology or a full-tree grant.

### Abilities and modules

- **Recon Smokescreen** is the first playable unit ability. Research fits the discharger to every owned recon hull; each crew then fires its own five-tile cloud from the selection card for 60 materials and 10 requisition, with an eight-second cloud and a 45-second reload. Smoke hides what is inside it and breaks direct fire through it, while indirect fire still arcs over — so it buys a scout an escape, not immunity.
- **Advanced Turbine** is the first playable building module. Research makes it available on every power plant and the player buys it per structure for 450 materials and 25 requisition, adding 30 power to that plant's actual grid contribution. One turbine per plant, counted once, removed with the building, and never charged again on load.
- Both are bought through authoritative commands, not UI-only shortcuts: an unaffordable, unowned, un-researched, already-fitted or capacity-full request is refused without spending anything.

### Ten nations

- **Finland, Sweden, Iran and North Korea join the roster**, five nations per coalition. Each new nation brings one replacement in an existing slot, one exclusive unit and one structure variant: Finland's K9 Thunder, Spike ER team and Garrison Barracks; Sweden's CV90 and Gripen; Iran's 3rd Khordad TEL and Mohajer-6; North Korea's Bulsae-4, Koksan and entrenched AT gun.
- **Sweden and Iran also field a ship of their own**, so their fleet identity is a hull and not only a yard variant. The Visby-class corvette is the fastest and best-sighted surface combatant afloat with four anti-ship missiles and a thin composite hull; the Ghadir midget submarine is a cheap two-torpedo coastal ambusher with a short battery and a long exposure after firing. Both have bespoke procedural silhouettes — the Visby's tumblehome topside and flat radar plate, the Ghadir's oversized sail and flank torpedo bulges — rather than a rescaled shared hull.
- National equipment resolves through the existing canonical families, so a replacement still occupies its slot, an exclusive never leaks to another nation, and research gates apply to all of it. The AI fields, researches and counter-builds against the new nations through the same code path.
- Flags for all ten nations, national colours in the picker, and **62 recorded voice banks** covering every definition, including the two new hulls (744 clips).

### Interface

- The research tab carries live progress in the production strip, and hovering a card no longer rebuilds its tooltip on every refresh.
- **Locked equipment cards stay visible** and name the technology that unlocks them, while affordability and facility requirements are shown separately, so a player can read progression instead of guessing why a card is dark.
- A power report breaks down generation, draw, brownout and module contributions; the frame-rate badge moved to the bottom-right of the battlefield; the HUD hide control sits at the foot of the left rail beside the army summary and objective button.
- A construction site left without a builder pauses at its current progress and **resumes when an engineer is sent back to it**, instead of the site being stranded at one percent.

### Simulation, multiplayer and saves

- Research, module installation and abilities are simulation commands: ownership, facility, prerequisites, cost, capacity and cooldown are checked on the authoritative side, and a client that bypasses the UI is refused rather than trusted.
- Each seat's research, installed modules and per-unit cooldowns are its own: opponents see the completed unlocks they can observe, never another player's active project, and reconnecting restores the project, its progress and the resulting production options.
- Saves carry research projects, completed technologies, installed modules and ability cooldowns, with migration for battles written before any of it existed. Older saves load unchanged.

### Verification

- `npx tsc --noEmit` clean and `npm run build` clean. `npm run release -- --dry-run` confirms that `package.json`, this file and the menu footer all agree on `v0.4.0 BETA` and stamps the built bundle with it.
- Full `vitest` run for this release: 128 files, 1,684 tests, 1,683 passed. The one failure is the tracked difficulty-ladder baseline in `tests/ai-matchups.test.ts` (`recruitVsVeteran.margin` −16,547 against its < −30,000 bar); thresholds, arena and AI behaviour were not changed to make the suite green.
- New coverage for the research tree and its statuses, unlock gating in production and construction, national replacements and exclusives, both national hulls, authoritative refusals, multiplayer isolation and reconnects, save migration, Recon Smokescreen and the Advanced Turbine.

## [0.3.0 BETA] — 2026-11-01

A terrain, battlefield and atmosphere release. The map pool grows from eight
competitive maps to seventeen, the ground itself gains eight new terrains and six
surface layers that change movement, cover, concealment and sight, weather and a
running time of day now affect detection, engagement range, mobility and the sea
state, crews earn ranks by fighting, and the Scenario Forge gains symmetry tools
and an island battlefield with spans that can be shot out and re-decked.

### Terrain

- **Eight new base terrains** — marshland, mud, farmland, scrubland, rocky ground, dunes, dense urban and industrial hardstanding — appended as ids 8–15. Existing ids are untouched so every saved battle, scenario and map keeps the ground it was authored with.
- **Six surface layers** (waterlogged, crop rows, reeds, craters, hedgerows, snow cover) stacked on top of base terrain at one of three densities. Light reeds and dense reeds are the same layer at different strength, and a tile without a layer stores nothing extra, so old data stays byte-identical.
- **Movement, cover, concealment and line of sight are all terrain now.** Marsh costs wheels 1.9× their open-ground rate and tracks 1.5×; dunes and boulder fields punish wheels more than tracks; industrial hardstanding is faster than open ground for every class. Infantry in cover take up to 30% less direct fire, indirect fire still arcs over it, and vehicles never benefit because their protection is their armour.
- **Concealment is separate from cover.** Crops, reeds and hedgerows hide a squad without reducing the damage it takes once found, gate detection at 0.4+, and feed the same line-of-sight accounting as canopy and rock: three soft tiles close a sightline, a hedgerow blocks it outright.
- Buildability, ore legality, the Scenario Forge's previews and the AI all read the same `(terrain, layer)` helpers, so the plan the pathfinder accepts is the ground the mover pays for.

### Battlefields

The pool is now **seventeen competitive maps** plus the four campaign theatres, all
offered to skirmish and multiplayer and all four-way symmetric.

- The original eight were audited and reworked onto the new catalogue: Open Front gained fields and hedgerows, Woodland Divide scrub and churned tracks, Drylands dune basins, Ironworks industrial yards, Crossing Point marsh banks, High Ground scree, Littoral salt marsh, Contact Zone a dense core with an industrial rim.
- **Nine new battlefields:** Blackwater Fens (wetland causeways), Hedgerow Vale (bocage), Thorn Scrub (ambush country), Granite Steps (terraced uplands), Saffron Erg (deep desert), Ashcross Sprawl (dense city), Freight Yards (industry), Silt Delta (river delta) and **Cormorant Isle** — one island in open water with a level beach ring, four deep bays, a bridged cut and a two-step rocky centre, the first map in the pool where the sea is a flank rather than scenery.
- Sizes are deliberately distinct (64² to 136²) and every map is verified by the audit that re-derives symmetry from finished tiles: terrain, elevation, ore and surface layer across all three quarter turns, neutral structures, owned content, start slots, and reachability for foot, wheeled and tracked from all four starts.
- Ore no longer spawns under authored structures or on ground a harvester cannot stand on, which is what used to strand a harvester on an unreachable seam for the rest of a match.

### Scenario Forge

- **Symmetry tools:** single, two-way mirror and four-way rotation, with a live note saying which quarter a stroke will land in. Structures, units, ore, terrain, layers, elevation and bridges are all stamped at every reflected position.
- **Slidable sidebars:** both rails drag off screen and back, snap collapsed or open, and remember where they were left, so the canvas is usable on a laptop.
- Paint base terrain and surface layers as separate brushes, bridge authoring over channels and towpaths, the five new shelter kinds in the structure list, and the scenario's time of day shown in the editor instead of only in the battle.
- Validation reports unsupported layer/terrain pairs, misplaced spans, unreachable ore and asymmetric quarters before a map can ship.

### Weather, light and the sea

- **Seven weather profiles** — clear, overcast, fog, rain, storm, snow and blizzard — selectable in skirmish and multiplayer, with the host's choice carried to every seat.
- Each profile is a multiplier on what the simulation already computes, so weather stacks with darkness, elevation and terrain instead of replacing them: a storm cuts detection to 60%, engagement to 68% and direct-fire accuracy to 74%, slows hulls to 0.86 and aircraft to 0.78, widens artillery patterns to 1.75×, and turns the sea into a breaking 0.94 with hulls at 0.76 and watches at 0.68. A blizzard is worse again: sight at 36%, aircraft at half speed.
- **Weather is visible, not just numeric:** heavy precipitation that reads as real rain rather than horizontal lines, sheet lightning behind the clouds, darker storm skies, swaying trees and a wet-sheen ground, plus volumetric haze and fog so a fog map actually fades out. Deep water turns choppy in a gale and the swell is what slows the hulls and shortens the watch.
- **A running battlefield clock** drives ambient light, sun direction and colour grade; darkness shortens detection and caps engagement range through per-unit sensors (optical, night vision, thermal, recon, avionics) with floors so night is a disadvantage rather than an armistice.
- Illumination is derived from authoritative entities: floodlit bases, headlamps, searchlights, beacons and lit windows. Lights burn only with power, lit windows dim in a brownout and go out in a blackout, a charted-but-unseen structure's windows stay dark until it is seen again, and no graphics setting can create light the simulation does not have.
- The host chooses the map, start hour and weather for a multiplayer match; only the host may change them, the room validates and broadcasts them, and a change clears readiness so nobody starts on a configuration they did not confirm.

### Veterancy

- Crews earn experience by damaging and destroying enemies, scaled against the target's own integrity, and hold three ranks: Recruit, Veteran (+5% hit, +8% damage, quicker reload) and Elite (+10% hit, +16% damage, fastest reload). Engineers, harvesters and medics never promote — veterancy records combat, not existence.
- Rank shows as chevrons over the unit and as progress in the inspector, and it is simulation state: it is saved, projected to opponents who can see the crew, and part of the state hash.
- **Promotions are felt as well as read:** the hull pulses for about a second, the announcer plays the promotion line, and the rank-up joins the battlefield report and event log.

### Traffic and pathfinding

- A formation slot that lands on ground the hull cannot drive to is walked out to reachable ground, so a group order no longer leaves part of the force refusing to move.
- A blocked vehicle now yields: a stationary hull asked to clear the lane steps aside and does so by driving to the new tile rather than jumping to it, and two hulls with equal claim resolve the standoff deterministically instead of waiting forever.
- Map validation rejects seams and objectives that cannot be reached by every movement class, which closes the harvester-stuck-on-ore and unit-stuck-behind-buildings reports at the authoring end.

### Structures, props and spans

- **Five new garrisonable shelters** — village chapel, farmhouse, constabulary, fire lookout and freight shed — each with its own mesh, occupied variant, flag anchor, icon and firing slots, and each obeying fog of war like every other shelter.
- **Destructible, repairable bridges.** A deck is a structure, not terrain: it lays road at bank height into the navigation layer, closes when shot out (the wreckage blocks and anything standing on it walks to the nearest bank), and can be re-decked by an engineer for its owner or for a neutral span.
- Roadside signposts joined the batched props, and the shoreline stops z-fighting: coastal land sits clear of the sea plane and water is drawn with a polygon offset so the waterline reads as a line instead of a shimmer.

### Interface and audio

- In-game layout fixes: the production list no longer scrolls horizontally, the command row no longer crushes its buttons off screen at small heights, and the console keeps its four corners at every supported aspect ratio.
- Three new announcer lines: the field is established at the start of a battle, a rally point is acknowledged when one is accepted, and a crew earning a rank is announced.

### Verification

- `npm run typecheck` clean and the full `vitest` suite run for this release.
- New coverage for the terrain catalogue, layer packing and legality, class-aware movement, cover versus concealment, line of sight through canopy, scrub, rock and hedgerow, bridges, garrisonable fog, day/night sensors and lighting, weather mechanics, all seventeen maps against the four-way audit, scenario symmetry, editor rails, veterancy and promotion feedback.
- Four-way symmetry, reachability and route balance are measured from the finished tiles, not from the builder's intent: seventeen of seventeen maps pass with zero problems.

### Known gaps

- 2v2 is described by the adjacent start pairs but is not implemented: multiplayer remains 1v1.
- Naval play is supported by Cormorant Isle's water and the sea-state model, but no competitive map requires a navy and no naval balance claim is made.
- The full graphics range was verified on the development machine only; a very low-end GPU was not tested.
- The HUD's event log still surfaces as the battlefield report line rather than a scrollable review panel.

## [0.2.0 BETA] — 2026-10-31

Online 1v1, played for real. This update turns multiplayer from a server-only
validation build into a mode two people can play: host or join a room, pick a
nation and a colour, ready up, and the host starts a timed match that the room
simulates while both players command their own army. It also fixes the three
faults that made a networked battle ignore orders, and ships the deployment
configuration live hosting needed. No simulation, combat, pathfinding or balance
rule changed.

### Online 1v1

- The **Multiplayer** deck is live in the shipped build: host a room and share its room code and join code, or join with someone else's. The deck shows each seat's nation, colour, readiness and connection state, and the room's own map and match length.
- Each seat picks its own nation and colour; changing either clears that seat's readiness, so a start can never use a configuration nobody confirmed.
- Connecting is never a start. The match begins only from an explicit host action, and the room re-validates occupancy, connectivity, readiness and the remaining reserved window before it builds the simulation.
- The battlefield draws the room's team projection and nothing else: entities, players, projectiles, fog, charted structures, contacts and the result all arrive from the authoritative stream, with positions eased between updates and snapped across a resync. The client owns no simulation, so it cannot show the opponent's true opening through fog.
- Orders are intent only. Right-click, attack-move, stop, hold, stance, capture, repair, garrison, rally and production all travel to the room, which decides authority from the authenticated seat; the client never predicts and never applies an order locally.
- A dropped seat socket reconnects by itself with bounded backoff and reuses its seat token, and the room answers with a fresh baseline sync. A battle that stops receiving says so on screen and says when the link is back.

### Room lifecycle

- A room that has not started a match survives Durable Object eviction and restoration without a match snapshot, so a lobby no longer needs a running game to exist.
- The start transition is a single durable commit: the world is built and persisted, the lifecycle is committed, and only then does a seat ever see `playing`.

### Fixes

- **Commands were dropped after the start.** Sockets were opened in the lobby, and their message handler called the lobby, which the start transition had already cleared; updates flowed out while every order, keepalive and resync a seat sent was discarded. Routing is now resolved per message, so a seat's socket is handled by whichever lifecycle owns it.
- **Orders named their own authority.** Commands carried `team` for the local simulation, and the room's gate refuses any command that selects its own authority. The networked path now sends intent only (`team`, `playerId`, `owner` and `seat` are stripped), and a test pins the wire shape.
- **Right-click panned the camera instead of giving an order.** A right-button press became a camera drag on the first pixel, so hand tremor scrolled the map and any travel past six pixels silently cancelled the order. A press is now an order until it travels five pixels, and the camera does not move at all below that.
- A background tab no longer closes a healthy seat: the keepalive watchdog only escalates a keepalive the room failed to answer, and never while the tab is hidden and its timers are throttled.

### Deployment

- The production build carries the live room worker address from `.env.production`, so `npm run build` and `npm run release` ship a deck whose Multiplayer entry works with no extra steps. A build without an address still dims the entry rather than pointing players at nothing.
- Added `npm run rooms:deploy` with a dedicated live Worker config: one Durable Object namespace, development mode off (no probe page, no loopback exemption), and an allowlist for the live app plus its preview hosts.
- Added one shared origin policy for the Worker's CORS grant and the room's socket check, supporting exact origins and a single-label wildcard, so the two can never disagree about who may connect.
- A browser origin that is not allowlisted is now refused before it reaches a room. A missing CORS grant only hid the reply; the request could still create a room and spend a capacity slot.
- `connect-src` in the page's header rules now lists the room worker's `https` and `wss` origins and the app's preview hosts, matching what the worker allowlists.
- The two active-room cap, the daily capacity allowance, the 30-minute hard deadline and the zero-cost operating rule are unchanged.

### Documentation and verification

- The README documents the three settings that must agree for live play (build address, worker allowlist, page `connect-src`) and the two deploy commands.
- The GDD records the shipped build and the online 1v1 mode.
- Verified with two browser seats against a production build and a live-configured worker: host, join by code, both ready, host start, then orders accepted and units moving on both seats, with a foreign origin refused at the edge and development mode absent from the live runtime.
- Added regression coverage for the socket handoff after start, the stripped authority fields, the keepalive and reconnect behaviour, the right-click drag tolerance, the origin policy and the deployed worker surface.

### Known gaps

- Rooms are joined by code only: there is no room browser, lobby list, account system or matchmaking, and no spectators or late joiners.
- Reconnection is automatic but not resumable by hand: a refreshed tab returns to the menu and must rejoin the room by code.
- The live deployment allows exactly two active rooms and its daily allowance, and a match is hard-capped at 30 minutes.
- Verified with two seats on one machine (separate browser sessions), not across two physical devices or networks; latency was loopback and deployed-edge only.
- The 10 ms individual-tick CPU target remains unverified at platform level.

## [0.1.3 BETA] — 2026-10-31

Readability, settings, input and renderer review. This update rebuilds the
interface's type and contrast rules, makes the menu honest about what is
available, adds a settings surface for scale and graphics, and gives the
battlefield silhouettes, smoother fog, structure shadows and readable ground
cover. No simulation, combat, pathfinding or balance rule changed.

### Legibility

- Introduced a five-step type scale (11, 12, 13, 15 and 18 px) as custom properties and moved every HUD, production-sidebar, selection-panel, command-bar and left-rail declaration onto it; the previous sheet had 254 font sizes, 111 of them 8.5 px or smaller and the smallest 6 px. Resource figures now read larger than their labels, and uppercase letter-spaced styling is kept only for short headings.
- Raised `--ink-faint` to `#7f908b` and restricted it to decorative rules and borders; readable copy uses `--ink-dim`.
- Menu subtitles wrap instead of truncating, menu items and their hover and keyboard-focus states are brighter, and **Multiplayer** is clearly unavailable: dimmed, `disabled`, `aria-disabled` and still carrying its **SOON** tag.
- Unaffordable and locked production cards print the blocking reason on the card itself (`NO MATERIALS`, `NO REQUISITION`, `QUEUE FULL`, `NEEDS SHIPYARD`, `UNDER CONSTRUCTION`), separating a temporary shortage from missing technology by tone as well as dimming. The tooltip keeps the full sentence.
- Command-bar buttons show their hotkey (`A`, `S`, `H`, `C`, `G`, `R`, `D`, `B`) on desktop; the touch composition drops the hints and keeps the labels.
- While no radar is online the tactical map collapses to a slim bar that names the cause — no radar array, or a grid brownout — and the Radar Array card is flagged in the Base tab. `minimapStatus()` semantics are unchanged.
- Added WebGL context-loss handling: `webglcontextlost` is prevented from discarding the canvas, the loop pauses and the DOM stops drawing; `webglcontextrestored` rebuilds programs, buffers, textures and framebuffers and resumes. The thumbnail renderer degrades to icons if its own context cannot be rebuilt.

### Settings and input

- Added an **Interface scale** setting (80–150%, default 100%) driving a `--ui-scale` property that the rail, sidebar, console and type tokens derive from.
- Added **Graphics quality** (Low, Medium, High) and an independent **Render scale** (50–100% of the device pixel ratio, still capped at 2×). Presets set render scale, the particle ceiling (900, 1800 or 2800), flat shadows and animated water; an optional **FPS** readout shows frame, simulation and entity counts.
- Added an **Escape key** choice: pause the battle (the previous behaviour) or open the menu. A command mode still cancels first.
- Input conveniences, all routed through existing `App` commands: double-click a unit to select every visible unit of its type; `Ctrl+A` for the mobile army; `F8`/`F9` to cycle idle harvesters and engineers; `F2` to jump to the last alert, which critical toasts now also do when clicked; camera bookmarks on `Ctrl+Shift+1..4` (save) and `Shift+1..4` (recall), leaving `F1` on the briefing and `Ctrl+1..9` on control groups.
- Selections above eight units collapse to one roster card per type with a count and a combined health bar; clicking that card narrows the selection to the type.
- Deliberately deferred, with the requirements recorded in `src/ui/input.ts`: key rebinding, patrol and waypoint queues.

### Renderer

- Added a silhouette pass for friendly units hidden behind a structure: a second draw of the unit bodies with a greater-depth test, depth writes off and a flat team colour, pulled toward the eye in view depth only so a nearby wall passes but distant terrain does not. The pass runs before the units themselves, uses the same vision gate as the main draw, and has its own **Unit silhouettes** setting.
- Fog now cross-fades: the current vision mask is moved to a second texture on each update and blended over exactly one update interval, so the boundary slides instead of stepping every third tick. The three authored states are unchanged (255 visible, 112 charted, 0 unseen) but charted ground is desaturated toward luminance and cooled before it is dimmed, and ground, water, props and roads share one fog function.
- Tall structures cast a short flat projected shadow following the sun's ground direction, tipped by the authored mesh height, with strength falling from midday through dusk to night and further reduced in overcast or rain. Still no shadow maps.
- Added very low-frequency world-position drift to the terrain shading, gated to grass cover so road, ore and buildable ground keep their authored colours.
- Lifted the value of shrubs, bushes and grass tufts and added three green families — cool hedge, yellow field and deep blue-green — so thickets mix tones instead of reading as black spots. Sand keeps its dry tint.
- The camera is unchanged (45° yaw, 30° pitch). Post-processing and tone mapping were deliberately left out of this pass.

### Documentation and verification

- Reconciled the README with the shipped menu (Singleplayer, Multiplayer soon, Map Editor, Settings), the new settings and controls, the fog, presentation and interface descriptions, and the current test count.
- Retitled the GDD to **Modern Combined Arms**, recorded the shipped build and added the concrete interface state and the deliberately unimplemented list.
- Verified every documentation link resolves.
- Added regression coverage for interface scaling, graphics presets, render scale, Escape behaviour, idle cycling and roster grouping, and for the fog cross-fade, silhouette pass, structure shadows, terrain drift and vegetation variants. Two fog and terrain-material assertions were rewritten to follow the two-texture field and the shared fog function.

### Known gaps

- Tone mapping and post-processing are not implemented; the renderer still writes lit colour straight to the canvas.
- Key rebinding, patrol and waypoint queues remain unimplemented, as listed above.
- The renderer changes are verified by shader compilation, a live WebGL2 context and source-level tests; no scripted in-battle capture exercised the silhouettes or the fog cross-fade.
- The interface was checked in a Chromium viewport at desktop and landscape-mobile sizes, not on physical low-end devices or with safe-area insets.

## [0.1.2 BETA] — 2026-10-28

Battlefield-control, readability and audio follow-up to 0.1.1. This update makes
a base survivable against a rush, stops attack orders that walk unarmed units
into concrete, untangles friendly traffic, gives every unit type a radio voice,
and gives the build a proper install icon and link preview.

### Base defence and orders

- Structure hit points are up by half across the roster. A six-tank rush on a Command Post now takes about 42 s instead of 23 s, and a lone tank needs about 92 s to level a Barracks, so a defender has time to answer.
- Units that cannot meaningfully hurt a structure — rifle squads, medics and other light weapons — now hold their ground instead of advancing into it when ordered to attack. The order is refused with a message, and the ordering unit answers with its refusal voice line.
- Engineers can repair a garrisonable building whether friendly infantry hold it or it is empty, including an unclaimed shelter, so a position can be prepared before it is occupied. A shelter held by hostile infantry still has to be cleared first.
- A ground unit with a friendly in its lane now commits to a flank line and passes instead of oscillating behind the blocker. Overtaking keeps the obstacle's lane as its reference so the chosen side cannot flip mid-manoeuvre, a waypoint already driven past counts as reached, and infantry keep a shoulder-width spacing rather than a vehicle-sized one.

### Combat presentation

- Foot units now wear a team-tinted helmet cover and stand on a soft alliance-coloured presence pool that reuses the existing contact-shadow batch. Infantry presence, facing and ownership are scannable at battle zoom without scaling the bodies or adding a draw call; vehicles get no pool, and markers are only drawn for units the local team can see.
- Own-team projectiles and missile trails are no longer fog-culled per tile. Friendly fire events and audio were always shown, so the player's own artillery no longer disappears mid-flight over unseen ground. Hostile projectiles still obey gameplay fog, and the visual fog toggle remains outside the rule.
- Wrecks now burn and smoke as they settle, then stop within about half a minute so an old battlefield does not turn into a permanent bonfire. Emission uses the same gameplay-vision query as the hull and stays inside the existing 24-wreck cap.
- Tracer chains were tuned for continuity: small-arms, cannon and missile tracers are longer, wider and drawn in up to eight segments, and impact and explosion scale were raised a step per class so a tank shell still reads against massed rifle fire.
- Wheeled vehicles now leave a pair of narrow, treaded rubber marks that fade faster than steel track marks, and ground impacts from cannon, missile and artillery rounds leave a small dark crater with a disturbed-earth rim. Both reuse the bounded ground-decal batch: no collision, save entry or gameplay effect, and rifle bullets do not scar the ground.
- The camera can now be zoomed in to 14 — roughly three and a half tiles above and below the focus — to inspect a facade or a hull without the isometric pitch collapsing into a head-on view. Battle zoom is unchanged.

### Audio

- Combat sound is now stereo-panned from the camera's view: a shot left of the listener arrives on the left, a shot to the right on the right, with distance attenuation, mute, effects volume, voice priority and duplicate-cue gaps all preserved. Hidden enemy fire stays silent under gameplay fog regardless of the visual fog toggle, and an off-screen event is clamped so it cannot swing misleadingly across the field.
- Added a **Unit responses** volume, independent of the strategic announcer.

### Unit voices

- Every unit type now answers selection, movement and attack orders with its own radio-processed line, plus a separate refusal for orders it cannot carry out. All 19 types are cast, including the national substitutions; lines are trimmed, band-limited, compressed and mixed with radio noise and squelch so they sit under the battlefield.
- One bark channel with per-cue cooldowns and a global gap keeps a twenty-unit box selection to a single voice, and an announcer line still pre-empts a bark. Barks are presentation only: no combat, damage, vision, save or objective rule reads them.
- `docs/unit-voice-audition.html` plays the whole set for review.

### Identity and sharing

- The install icon set is rasterised from the MCA insignia instead of the Irontide engine mark, and the same mark serves the favicon and the maskable icon.
- Added Open Graph and Twitter card metadata plus a 1200 × 630 battlefield hero, so a pasted link previews a base under assault rather than a blank card.

### Documentation and verification

- Added the Phase 3 combat-feedback report and the Phase 4 battlefield-readability report with matched before/after captures.
- Added the unit voice set documentation and a human playtest protocol for visual recognition, spatial audio and battlefield awareness.
- Regression coverage extended for stereo panning, unit voice policy, structure durability, attack-order refusal, engineer repair of empty shelters, closer camera limits, infantry ground markers and the social/PWA card.

### Known gaps

- Human recognition, listening and awareness tests are still outstanding. The protocol and capture set exist, but no independent participant has run them.
- Unit voices are cast per unit type, not per nation. Kokoro has no Lithuanian, Polish, Russian or Belarusian voice, so the national variants use distinct English casts and the baseline units sound the same in both alliances.
- Persistent rubble and scorch marks were evaluated and deliberately not implemented; wrecks, collapse and burning hulks already mark the battlefield.

## [0.1.1 BETA] — 2026-10-28

Build-identity, control, durability and presentation release. This update
builds on the 0.1.0 beta while making the running build easier to report and
the battlefield easier to read.

### Build identity and bug reporting

- The running version, build number and commit now appear on the pause screen and in every save-slot record, so a save can always name the build that wrote it.
- **Copy diagnostics** puts the version, build, commit, map and current tick on the clipboard from the pause card.
- The main-menu **Changelog** button shows a **NEW** badge until the running build's notes have been acknowledged on that device.
- The menu footer, pause card, save sheet and in-game changelog all read the same build stamp.

### Persistence

- Save format advanced to v2. Existing v1 saves migrate forward instead of being rejected, and saves written by a newer build are refused with a clear message rather than loaded speculatively.
- Migration restores the fields added since v1: faction identity, player statistics, income history, defeated state, relay counts, projectiles, events, contacts and charted structures.
- Save-slot metadata now carries the build stamp independently of the simulation, so restarting or reloading does not disturb determinism.

### Durability and battlefield control

- Engineers and harvesters now use a **support** armour class with more durability (220 and 480 HP), rather than being treated as light or heavy fighting vehicles. Every ground-capable weapon has an explicit support multiplier.
- Direct-fire weapons do less damage to structures, leaving artillery as the dedicated siege answer instead of making tanks the best structure-killers.
- Medics can now garrison buildings for cover. The AI still keeps unarmed medics outside unless a player orders them in.
- Engineers can repair a garrisonable building that friendly infantry are holding, including a neutral shelter, while still refusing an unoccupied neutral structure.
- Harvester move orders are no longer overwritten by automatic ore-seeking on the next tick. A manual move completes before the hauler resumes its economy loop.
- Idle friendly units are treated as soft traffic during pathfinding. Movers prefer an open lane around a formation instead of relying on collision separation.
- Collision separation no longer shoves an idle unit out of position when a friendly or enemy vehicle drives into it.
- Ground vehicles steer and travel along their hull heading instead of sliding sideways toward the next waypoint; aircraft now rotate their body onto the flight heading rather than holding a stale turret angle.

### Building identity and ownership

- Rebuilt the **Anti-Tank Gun** and **Coastal Battery** around their weapons: a shielded long-barrel emplacement with split trails, and a twin-rail anti-ship launcher with blast deflector and ready rack. Both keep their existing 2×2 footprints, turret transforms, hardpoints and water requirement.
- Rebuilt the **Radar Station** and **Signals Relay** as substantial installations with dominant surveillance arrays and communications cabins, while preserving their rotors, capture rules, footprints and objective behaviour.
- Capturable Radar Stations and Relays now carry body-level team-mask ownership panels: neutral grey when uncaptured, and the correct alliance colour after capture, even with flags hidden.
- Fixed dark-glass classification so shaded window bands resolve to glass instead of track material on the Tenement and Office Block.
- Corrected roof flag anchors on the Radar Station, Foundry Works, MG Nest and Tenement so poles sit on supported geometry rather than intersecting or floating above the roof.

### Combat feedback

- Added shared weapon-class presentation profiles for small arms, cannons, missiles, artillery and air defence. Muzzle flashes, tracer colour and length, impact scale, shake and explosion size now follow the weapon class instead of a generic effect.
- Projectiles interpolate between fixed simulation ticks and draw oriented tracer chains, so rifle rounds, tank shells and ATGMs remain readable in flight instead of appearing as a single teleporting dot.
- Impact events now carry the real impact height, surface (`ground`, `water`, `armour`, `structure`, `air`), direct-hit flag and target. Air and elevated hits no longer resolve at the terrain surface.
- Static AT guns and coastal launchers draw their muzzle flash at the authored barrel tip while keeping the simulation's projectile origin unchanged.
- Destroyed ground vehicles produce one consolidated fireball plus a bounded charred wreck, rather than an impact explosion followed by a second death explosion. Wrecks are capped at 24, have no collision, picking or save state, and clear on restart or menu return.
- Direct hits now produce a distinct hit effect from a near miss, including for rifle fire.
- Projectile and missile-trail rendering now obeys gameplay fog even when the fog texture is switched off. Hidden enemy projectiles and trails cannot be revealed by the visual setting.
- Visible enemy fire is audible with distance attenuation; hidden enemy fire remains silent. Master mute, effects volume, voice priority and duplicate-cue gaps are preserved.

### Documentation and verification

- Added the building visual roster audit and Phase 4 implementation report with matched before/after evidence.
- Added the combat-feedback baseline audit with source references and baseline captures.
- Added regression coverage for save migration, support durability and control, Phase 4 building identity, and the combat presentation slice.

### Known gaps

- Independent human recognition and listening tests for the new building and combat effects have not been performed.
- The combat audio pass adds distance attenuation, not stereo panning.
- Campaign, multiplayer and full PvP networking remain out of scope for this slice.

## [0.1.0 BETA] — 2026-10-28

First public beta of the Kestrel Bay vertical slice. Everything below is
playable in this build.

### Theatre and modes

- Four skirmish theatres with a mission-brief map, per-map loading screen and mirrored ground for both commanders: **Island Assault — Kestrel Bay** (96×72 coastal ridge), **Rust Valley** (112×80 armour basin), **Kestrel Straits** (88×64 naval strait) and **Foundry District** (104×76 urban core).
- Skirmish against a seeded AI commander with Recruit, Veteran and Elite levels, plus a Scenario Forge editor that paints terrain, elevation, deposits and water; places structures, units, starts and objectives; validates the layout and deploys it straight into the simulation.
- Three browser save slots with versioned scenario data, plus restart. Determinism is fixed-step at 20 Hz with seeded randomness.

### Forces

- Six launch nations in two alliances, each with one national substitution — Pathfinder, Spearhead, MLRS, Heavy Howitzer, Deep Recon UAV or Reinforced Bunker — and nation assignment per player in the editor.
- Land roster: engineer, rifleman, medic, ATGM gunner, main battle tank, self-propelled howitzer, reconnaissance vehicle, AA vehicle, field recovery vehicle and harvester. Infantry are individual soldiers; a stationary medic treats one wounded soldier at a time.
- Air roster: strike fighter with four missiles, air-superiority interceptor and unarmed recon drone, all flying from a physical, capturable airfield with automatic return and rearm.
- Naval roster: missile corvette with six anti-ship missiles and a deck gun, water-only pathfinding and shore bombardment, plus shipyard reload and repair. A static coastal battery gives the shore an anti-ship answer.

### Economy and production

- Materials from deposits via harvesters carrying 300-material loads, requisition from command posts and captured relays, and engineer-placed, engineer-repaired structures.
- Per-facility production queues with smooth cameo progress, queue counts and drag-to-prioritise cards.
- Deadlock safeguards: a standing command post trickles materials while its owner has no harvester, a captured Forward Supply Depot adds income without a refinery, and deposits can run dry, pushing expansion instead of infinite turtling.
- Power grid, research upgrades and national equipment feed the same production and construction rules for player and AI.

### Battlefield systems

- Three-state fog of war shared by ground, roads and structures: lit, charted-but-dimmed, and unseen. Remembered buildings stay charted through fog instead of being charted for free.
- Strategic objectives captured by Combat Engineers: Signals Relays pay requisition, Forward Supply Depots pay materials, and a powered Radar Station plots hostile units within 22 tiles through terrain masking.
- Urban garrisons in tenements, warehouses, office blocks, ruins, the Civic Hall and the Foundry Works, with cover, occupant counts and structure-linked survival.
- Engineer repair that is free but suspended for a second after the structure takes a hit, indirect fire with minimum range, suppression, and a full damage, armour and weapon-type model.

### AI

- A seeded skirmish commander that picks a temperament per match, then scores construction, production, scouting and attacks against its own economy, power, damage and terrain each second.
- It never receives the player's start position: targets come from vision or a remembered contact, and a lost trail returns it to reconnaissance.
- Difficulty changes decisions only — it never grants extra resources, free vision or different combat rules.

### Presentation and audio

- 2.5D 45°-rotated, 30°-tilted orthographic view with a continuous terrain surface shared by rendering, picking, orders and the editor.
- Reworked unit and building silhouettes, team-colour ownership surfaces, roof-aware flags and mesh-height health bars, plus procedural portraits rendered from the battlefield meshes.
- Material pass over roads, coastlines and building facades: wheel wear, lane paint and drainage, a distance-field shoreline with surf and wet sand, and layered facade detail.
- Studio sting, engine beat and menu theme; in-match soundtrack rotating three tracks without back-to-back repeats; the 20-line strategic announcer wired to real gameplay events with priority, cooldowns and fog-aware detection.
- Installable PWA with an offline shell, fullscreen support and a blocking portrait gate on touch devices.

### Interface and tooling

- Desktop and mobile battle HUDs over one simulation: command rail, production sidebar, tactical map, selection and command console; mobile adds a sheet, sticky selection bar and touch control groups.
- Shared settings sheet for both the menu and the in-battle modal, with effects, announcer, ambience and music volumes, visual effects, screen shake, fog, edge panning and fullscreen — all stored on the device.
- Version stamp in the menu footer and this changelog, readable in game.

### Changed

- Ore was replaced by material deposits plus requisition, and the economy, AI, editor and saves were migrated with it.
- Fog now charts terrain, roads and structures consistently; charted structures no longer reveal their full state for free.
- Construction priority, defence priority, economic recovery and army-collapse handling were reworked after measured audits; the difficulty ladder values are unchanged.

### Known gaps

- Campaign, multiplayer and full PvP networking are not implemented; the slice is single-player skirmish and editor.
- Human readability of the newest models is documented by developer review only, not an independent panel.
- Mobile verification covers layout and touch input, not frame pacing on low-end hardware.
