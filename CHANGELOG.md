# Changelog

All notable changes to **MCA: Modern Combined Arms** are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

The release version and stage come from `package.json`; the build number shown
in the menu is the repository commit count at build time. The same file is
rendered in game from **Changelog** in the main-menu footer.

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
