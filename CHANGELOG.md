# Changelog

All notable changes to **MCA: Modern Combined Arms** are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

The release version and stage come from `package.json`; the build number shown
in the menu is the repository commit count at build time. The same file is
rendered in game from **Changelog** in the main-menu footer.

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
