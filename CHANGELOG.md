# Changelog

All notable changes to **MCA: Modern Combined Arms** are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

The release version and stage come from `package.json`; the build number shown
in the menu is the repository commit count at build time. The same file is
rendered in game from **Changelog** in the main-menu footer.

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
