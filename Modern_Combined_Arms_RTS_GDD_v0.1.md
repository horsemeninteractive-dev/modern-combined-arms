# Modern Combined Arms — Game Design Document

**Document status:** Consolidated working design, reconciled against the shipped build  
**Version:** 0.1.2  
**Date:** 5 November 2026  
**Project title:** Modern Combined Arms (MCA)  
**Shipped build:** 0.5.4 BETA — every competitive battlefield, selectable weather and a running time of day, unit veterancy, garrisonable shelters and bridges, the Scenario Forge and mission workbench, two twelve-operation campaigns, ten playable nations and online 1v1. Release notes are in [CHANGELOG.md](CHANGELOG.md); the verification baseline is in [docs/PHASE_0_RECONCILIATION_AND_BASELINE.md](docs/PHASE_0_RECONCILIATION_AND_BASELINE.md).  
**Important status note:** This document consolidates the current interview decisions and fills unanswered details with recommended defaults where the user authorised recommendations. It is a working baseline, not a claim that every narrative or balance detail is permanently locked. Explicitly provisional ideas are labelled as such. The first playable slice should validate the core experience before the design is expanded into a full production specification.

**How to read it:** §0 states what the build actually does today. Everything
after it is design intent — the target the build is measured against — and is
only marked *implemented* where §0 says so.

---

## 0. Implementation status (5 November 2026, build 0.5.4)

This section is separated from the design text on purpose. The sections below
record what the game is meant to be; this table records what it is. Where the two
differ, §0 is the truth about the build and the later section is the intent, and
the gap is named rather than quietly closed.

| Area | What ships now | Gap against the design text |
| --- | --- | --- |
| **Economy** | Harvester → Material Refinery loop on an authored ore field; deposits exhaust. The Command Post pays nothing until a materials plant stands, then 1 mat/s, or the 4 mat/s stripped rate once no hauler and no production line remain. Captured forward supply depots pay 2 mat/s. Ore is scaled per map so a field outlasts the opening. | Intended richer logistics (supply lines, multiple resource classes) is not designed in yet. Balance is fixture- and ladder-validated, not human-player validated. |
| **Combined arms** | Land, air and naval are all simulated with movement, detection and weapons: tracked/wheeled/foot movement, aircraft with fuel and ammunition and recovery, a three-hull navy including submarines. Artillery is indirect-fire with minimum range and lobbed projectiles. | No mechanised transport or IFV (no passenger load/unload), no recovery-and-tow, no field obstacles, no second buildable naval hull. |
| **Roster and nations** | Ten playable nations over two alliance baselines, each substituting exactly one baseline slot with a national variant and adding one exclusive unit and one structure variant; Sweden and Iran add a national naval hull. | No national-only upgrade trees or signature abilities; one shared tech tree. National values are not tuned against human play. |
| **Research** | Applied Research Centre with per-nation projects, research gating production and abilities, and AI research demand. | The intended deep branch-per-nation technology tree is design-only. |
| **Skirmish** | Twenty-one battlefields in the scenario catalogue (island, competitive and expansion rosters), selectable weather and a running time of day, three AI difficulty levels, mirror-symmetric ladder measurement. | One AI opponent; no team skirmish against AI. |
| **Campaign** | Two campaign tracks, each twelve authored operations over the built-in theatres (Baltic Line, Eastern Corridor), with mission briefing, mid-mission cinematic overlays, objectives and a debrief; operation tokens persist between operations. | The intended interwoven, branching two-faction narrative with persistent consequences beyond tokens is design-only. Missions are linear within a track. |
| **Editor and mission tooling** | Scenario Forge (terrain, structures, ore, objectives, symmetry tools), a mission workbench with JSON import/export and validation, a mission library, and a validated scenario/mission format. | No mod SDK, no scripting language for third parties; authored operations are TypeScript data. |
| **Multiplayer** | Online 1v1 through a Cloudflare Worker with Durable Objects; rooms joined by code and join code; authoritative room simulation with snapshot projection, command gating and per-seat fog. | No room browser, no matchmaking, no ranked play, no team modes; a seat is not tied to an account, so room results are not written to a career. |
| **Accounts** | Google/Discord sign-in through an account Worker with D1, HttpOnly first-party session cookies, a guest path, and a career record (rank, service record) for local battles. | Career progression is single-player only; no cross-device save sync from a room. |
| **Presentation** | Hand-written WebGL2 renderer with shadow maps, fog of war, ground decals, particle combat feedback, building construction and deconstruction animation, unit silhouettes, thumbnails rendered from meshes. | Validated by shader compilation, a live context and frame timing, not by pixel-diff captures. |
| **Audio** | Procedural Web Audio: fire, explosion, per-unit-family movement and idle beds, engine start/spool, building ambience, spatial mix by camera position and zoom, UI sounds, announcer and narrator voices. | Recorded ambience is shipped in the manifest but disabled (synthesis is the live path); audio has never been auditioned in an automated run. |
| **Input and platforms** | Keyboard/mouse, touch controls, gamepad mapping; PWA install; landscape mobile layout with a rotate prompt. | Gamepad is untested on hardware; the mobile result screen is unusable at small viewports (known defect). No Steam/Play/App Store packaging. |
| **Persistence** | Saves in `localStorage` with versioned migrations and build stamps, settings, campaign progress, mission library. | No cloud saves; saves are tied to the browser profile. |

---

## 1. Executive summary

The project is a modern evolution of classic real-time strategy games such as *Command & Conquer* and *Red Alert 2*: immediately readable, responsive base-building and battlefield command, deepened by modern combined-arms warfare, more convincing battlefield behaviour, and grounded cinematic presentation.

The game is set in a plausible near-future global conflict, approximately five to fifteen years ahead of the present. It uses real-world nations, equipment and alliance histories as its starting context, but the central crisis and the resulting war are fictional. The story is designed around escalation, miscalculation, competing national interests, contested intelligence and morally complicated decisions rather than a simple heroic side against an irredeemably evil side.

Land, air and sea are all first-class parts of the game’s intended design. Their importance varies with geography and mission: an inland battle may centre on ground manoeuvre and air support, while an island or coastal operation can involve naval movement, maritime access, amphibious landings, aircraft, ports and ground forces. Air and naval assets are not merely off-map special powers. Units that appear in the tactical world should have movement, detection, weapons, limitations and consequences, with appropriate automation for recovery and logistics.

The eventual product has two equally important pillars:

- **Skirmish:** replayable battles, faction identities, combined-arms tactics, map variety and competitive-but-readable asymmetry.
- **Campaign:** two interwoven but separately selectable faction campaigns, authored narrative beats, tactical freedom, optional objectives and mission outcomes that affect later conditions.

Development is **skirmish-first**, because the shared simulation, map format, controls, combat, economy, AI and end-to-end match loop must be reliable before a large campaign is built on top of them.

The first vertical slice is an **island-assault scenario** on a large intended map, featuring a representative force from two opposing factions, a classic resource/base-building economy, deployable construction, production, basic skirmish AI and a victory condition based on destroying the opposing force or base. It must prove a complete editor-to-battle workflow. The first implementation should use a small representative island and scale toward the intended large scenario only after the systems work together.

The game is intended to be web-first, using a custom WebGL renderer, and later packaged for Steam, Google Play and the Apple App Store. Keyboard/mouse, touch and gamepad support are design requirements from the outset, sharing the same underlying command semantics. The architecture should leave room for modding, user-created maps and scenarios, and future multiplayer, without making those long-term systems block the first playable slice.

---

## 2. Design pillars

### 2.1 Classic RTS immediacy, modern combined arms

The game should feel familiar to players of classic base-building RTS games: gather resources, establish a base, construct production facilities, build forces, scout, manoeuvre, attack and defend. Orders should be responsive, and the player should spend their attention making meaningful decisions rather than fighting the interface.

Depth comes from modern combined-arms interactions: reconnaissance, air defence, aircraft fuel and ammunition, naval access, sensors, electronic warfare, logistics, terrain, infrastructure and mission geography. These systems should create interesting decisions without turning the game into an opaque military staff simulator.

### 2.2 Land, air and sea are core systems

All three domains must be considered in the simulation architecture, map model, command model, content model and long-term roster design from the beginning.

- **Land** provides the main focus for many local objectives, territorial control, ground manoeuvre, assaults and defence.
- **Air** provides interception, air superiority, reconnaissance, strike, close support, transport and other mission-dependent capabilities.
- **Sea** shapes maritime access, coastal support, supply, amphibious operations and control of navigable approaches. On-map vessels are fully controllable units.

Not every battle needs every domain. A map’s geography and scenario determine which are relevant. A first slice may have a deliberately small roster, but it must prove that the shared systems can accommodate all three domains.

### 2.3 Readability before simulation theatre

The simulation should be credible enough to produce meaningful tactical choices, but the player must understand what is happening and why. Important combat feedback should be clear, with deeper statistics available optionally. Sensors and reconnaissance should provide useful uncertainty rather than confusing or misleading UI.

### 2.4 Grounded cinematic presentation

The presentation should feel like a modern military conflict: convincing unit motion, weapon effects, explosions, damage, weather, sound and battlefield atmosphere. Cinematic effects should not hide units, orders, threats or tactical state. Visual fidelity may be reduced before simulation fidelity when performance is constrained.

### 2.5 Authoring tools are part of the game

The map/scenario editor is not a late accessory. It is a central tool for producing and testing skirmish maps, campaign missions and eventually community content. The editor and simulation must share the same world format so that a map created in the editor is a real playable scenario, not a separate mock-up.

### 2.6 Build the complete loop early

The first milestone is not a beautiful isolated battlefield or a large collection of units. It is a small but representative experience that can be created, validated, loaded, played, won or lost, and restarted reliably. Each system should be introduced in service of that loop.

---

## 3. Product and platform direction

### 3.1 Initial delivery strategy

- Browser-first game using a custom WebGL rendering layer.
- Later distribution through Steam, Google Play and the Apple App Store.
- Landscape-first mobile presentation.
- Keyboard/mouse, touch and gamepad support planned from the outset.
- Shared game commands and simulation behaviour across all input methods.
- No critical interaction should depend on mouse hover.
- UI layouts should adapt to the available screen rather than treating mobile as a scaled-down desktop.

### 3.2 Technical direction

The selected rendering direction is a **custom WebGL renderer**. This needs an early technical validation phase; it should not be treated as proven merely because it has been selected.

Recommended architecture:

- TypeScript for the simulation, world model and application logic.
- A deterministic fixed-step simulation, separated from rendering and presentation.
- A shared command layer that converts keyboard/mouse, touch and gamepad actions into the same game commands.
- A shared versioned map/scenario representation for editor, skirmish and campaign.
- Explicit separation between authored map data and runtime battle state.
- Seeded and controlled random-number generation for repeatable simulation tests.
- Rendering interpolation and effects separated from authoritative simulation state.
- Versioned save data and migration rules.
- Instrumentation for simulation cost, rendering cost, entity counts and frame pacing.

These are recommended implementation defaults to support the stated goals. Exact libraries, folder structure and engine implementation should be decided through a technical prototype and codebase audit rather than assumed here.

### 3.3 Performance philosophy

The game should support substantial combined-arms forces and potentially hundreds of meaningful entities. Performance targets must be measured early rather than guessed. When a performance budget is exceeded, reduce visual effects, animation detail, distant simulation frequency or other presentation costs before compromising important local tactical simulation.

The simulation should support different levels of detail for nearby and distant entities where appropriate, while preserving coherent outcomes. Any approximation must be tested for strategic fairness and consistency.

### 3.4 Future multiplayer and modding

Multiplayer is not required for the first slice, but the architecture should avoid unnecessary assumptions that make deterministic command processing, state replication or authoritative simulation impossible later.

A broad modding ecosystem is a long-term goal, not a launch requirement. The eventual ecosystem may include:

- User-created maps and scenarios.
- Structured data definitions for units, factions and buildings.
- Controlled mission scripting.
- Import/export and sharing.
- Custom visual/audio assets under explicit format and compatibility rules.
- Community libraries and curated discovery.
- Version compatibility and clear warnings for content requiring unavailable assets or features.

Do not implement a fully general scripting sandbox or integrated community platform before the basic editor and battle loop are dependable.

---

## 4. Setting and narrative premise

### 4.1 Time and tone

The main timeline is a plausible near future, approximately **2034–2038** as a working setting window. This remains provisional. The world starts from recognisable real-world nations, equipment and alliances, but the political crisis and war are fictional.

Tone: grounded, tense and cinematic, with uncertainty and moral complexity. The game should not present a simple conflict between entirely virtuous defenders and uniformly villainous aggressors. States, commanders and populations have conflicting incentives, imperfect information and political constraints.

### 4.2 The strategic fracture

The wider geopolitical background involves a weakening of established collective-security structures. A crisis outside Europe exposes US reluctance to intervene directly. European partners disagree over burden-sharing and the future of common defence; a major EU departure contributes to wider fragmentation and competing regional security arrangements. These changes are part of the alternate fictional timeline, not predictions or claims about real-world outcomes.

Russia has quietly encouraged and exploited fractures between European states. The extent of the operation is not immediately known. Evidence accumulates through intelligence, sabotage, political pressure and battlefield events, but the full scope remains contested. The narrative should allow characters and players to disagree about what the evidence proves.

Belarus has been formally integrated into Russia in this timeline following mass unrest and Russian intervention publicly framed as restoring order. This creates a deeper political and military relationship than a simple temporary alliance.

### 4.3 Opening European war

The provisional opening theatre is the Baltic region.

Russia launches a limited operation against Lithuania, publicly justified as a restricted security action. One strategic objective is to secure a land corridor to Kaliningrad, a goal that creates a direct threat to Lithuania and a risk of immediate escalation with Poland. The opening is deliberately limited in stated scope, but miscalculation and retaliation broaden the conflict.

Poland intervenes quickly because of immediate security concerns, prior commitments and political choice. The UK initially provides indirect support before escalating its involvement. The crisis exposes the absence of a clear, unified continental security structure and creates difficult decisions for countries whose interests overlap without being identical.

The Russian campaign should not be represented as a perfectly controlled master plan. Strategic intent, opportunism, domestic politics, misinformation and battlefield miscalculation can coexist. The corridor objective is a clear operational driver, while the wider war expands through choices and reactions.

### 4.4 Connected second theatre

A second European crisis opens a connected front, forcing countries to divide attention, resources and political capital. The current direction is a critical-infrastructure attack and a connected European theatre, with a mix of direct combatants, supporters, reluctant participants and neutrals. Russian external support becomes more overt over time, with some states moving from indirect assistance toward co-belligerent involvement for different reasons.

A Black Sea infrastructure and maritime incident has been suggested as one possible trigger, including ambiguous attribution and casualties. This is a **recommended candidate, not a confirmed plot point**. The final trigger should be selected when the mission outline is written, and should connect naturally to the game’s air, land and sea mechanics.

### 4.5 Narrative principles

- Both sides should be morally complicated.
- Political claims, public justifications and intelligence assessments can conflict.
- Escalation should emerge from decisions, miscalculation and competing objectives.
- The conspiracy or influence campaign should be uncovered gradually; evidence should not instantly settle every dispute.
- The campaign outcome can remain broadly consistent for scope control, while mission results meaningfully change local consequences.
- Optional objectives should reveal context, preserve assets, improve intelligence or change later conditions without making the main mission unreadable.
- Non-playable nations should still feel like actors with agency rather than decorative flags.

---

## 5. Nations and factions

### 5.1 Six launch nations for skirmish

The current provisional launch roster is six nations, three associated with each side:

| Side | Nation | Intended role in the setting |
|---|---|---|
| Defender-aligned | Lithuania | Front-line defender in the opening Baltic crisis; local knowledge and defensive urgency |
| Defender-aligned | Poland | Major regional military actor; immediate intervention and substantial ground capability |
| Defender-aligned | United Kingdom | Expeditionary and specialist contribution, initially indirect and later more direct |
| Russia-aligned | Russia | Principal aggressor in the opening crisis; broad conventional capabilities |
| Russia-aligned | Belarus | Closely integrated with Russia in the alternate timeline; supports the eastern campaign |
| Russia-aligned | Hungary | Limited specialist involvement; politically significant, but not portrayed as contributing an equal mass conventional force |

This is a working faction framework, not a final order of battle. The role and degree of involvement of Hungary require particular care: it is included as the third skirmish nation on the Russia-aligned side, but its campaign combat role should remain limited and plausible within the fictional setting.

### 5.2 Playable versus non-playable nations

The six launch nations are the six nations playable in initial skirmish. They are **not** a limit on the countries that may appear in the campaign.

The campaign can include additional real-world nations as:

- Direct combatants in specific operations.
- Providers of equipment, logistics, intelligence or basing.
- Diplomatic actors or mediators.
- Reluctant participants under domestic or alliance pressure.
- Neutrals whose territory, ports, airspace or political decisions matter.
- Countries affected by the second theatre or wider conflict.

These nations can offer support, create complications and shape the narrative without needing complete player-controlled skirmish rosters at launch. Later expansions may make additional nations playable.

### 5.3 Faction design and balance

The recommended roster model is a **shared capability foundation with substantial national specialisations**. Nations should share enough familiar battlefield functions for players to understand them, while differing in equipment, unit performance, cost, logistics, sensors, doctrine, availability and specialist capabilities.

The factions should be asymmetrical in character but competitively balanced in skirmish. Balance should not require identical units or identical unit counts. It should be evaluated through battlefield roles, map context, costs, counters, timing and reliable playtesting.

Potential dimensions of national identity include:

- Equipment and platform choices.
- Reconnaissance and sensor capabilities.
- Air-defence and electronic-warfare strengths.
- Logistics and sustainment.
- Infantry and mechanised doctrine.
- Naval access and maritime capabilities.
- Specialist forces and support options.
- Production cost, build time and availability.

These are design dimensions, not yet approved nation-by-nation stat differences. Exact unit rosters, equipment variants and national bonuses should be developed only after the shared unit-role matrix and core combat model are defined. Earlier draft roster ideas omitted air and sea and should not be treated as complete.

### 5.4 Faction readability

The player should be able to identify a unit’s broad role and threat quickly, while nation-specific details reward familiarity. Visual silhouettes, markings, audio, UI iconography and selection information should reinforce recognition. Colour-vision accessibility must be supported; team identity cannot rely on colour alone.

---

## 6. Campaign structure

### 6.1 Two campaigns

The intended campaign consists of two interwoven but separately selectable linear campaigns, one for each principal side. Each is provisionally planned for **12–15 missions**.

Both campaigns are equally important to the final product. They should present different perspectives on the same escalating conflict, with overlapping events, incomplete intelligence and contrasting political constraints.

### 6.2 Mission variety

Campaign missions should mix:

- Large conventional RTS battles.
- Smaller-scale operations with narrower force sets.
- Defensive actions and delaying operations.
- Reconnaissance, raids and infrastructure objectives.
- Coastal, island and maritime operations.
- Air-defence, logistics and reinforcement challenges.
- Missions shaped by intelligence, political restrictions or limited support.

The exact mission list is not locked. It should be developed around the narrative escalation and the game’s actual combined-arms capabilities, rather than forcing every mission to use every domain.

### 6.3 Authored beats with tactical freedom

Missions should have authored story beats and clear primary objectives, while allowing the player freedom to approach combat through different tactical choices. Optional objectives can change later support, intelligence, reinforcements, access, starting conditions or mission difficulty.

Mission results should have **meaningful local consequences** without requiring a branching narrative so extensive that it becomes unmanageable. The overall conflict may converge on a broadly consistent outcome, while the route, losses, available information and battlefield circumstances differ.

### 6.4 Persistence

Key veterans, named personnel or mission-specific assets may persist across selected missions. The player’s entire army should not need to persist intact across a long campaign; main forces can be rebuilt between operations. Persistence should be selective and narratively justified, with clear feedback about which assets and outcomes carry forward.

### 6.5 Briefings and presentation

Use a mix of cinematic briefings and operational briefings. A cinematic briefing establishes stakes, character and atmosphere; an operational briefing clearly communicates objectives, available intelligence, known threats, force restrictions and uncertainties. The player should not have to infer the actual mission goal from cinematic dialogue alone.

### 6.6 Difficulty

Use recognisable preset difficulty levels, with room for accessibility and gameplay customisation. Difficulty should adjust challenge through AI decisions, resource pressure, reinforcement timing, enemy composition, intelligence and mission conditions—not merely inflated enemy health or unfair hidden bonuses.

---

## 7. Skirmish mode

Skirmish is the first development priority and a core pillar of the final product.

### 7.1 Core loop

1. Select map, factions, teams and match settings.
2. Load the shared map/scenario format.
3. Establish or expand a base.
4. Secure resources, territory and useful infrastructure.
5. Construct buildings and production facilities.
6. Build, scout and combine land, air and naval forces as geography permits.
7. Contest reconnaissance, movement routes, airspace, coastlines and objectives.
8. Adapt production and tactics to the opponent.
9. Win by fulfilling the configured victory condition, beginning with destruction of the opposing force or base.

### 7.2 Skirmish AI

The first slice needs a basic opponent capable of establishing an economy, constructing a functional base, producing a useful force, scouting or responding to contact, attacking and defending. It does not need a sophisticated strategic planner.

The AI should use the same core simulation rules as the player. It should not cheat by ignoring visibility, travel time, resource constraints or unit limitations unless a future difficulty setting explicitly and transparently changes a rule.

Recommended staged AI development:

- **Stage 1:** Build economy and production, assemble forces, attack and defend.
- **Stage 2:** Respond to scouting, threats, counters and base pressure.
- **Stage 3:** Coordinate combined arms and use terrain, infrastructure and objectives.
- **Stage 4:** Difficulty profiles, strategic planning and faction-specific doctrine.

### 7.3 Victory conditions

Initial slice: destroy the opposing force or base. The map/scenario model should later support other conditions such as control points, survival, convoy or evacuation objectives, infrastructure denial, capture/hold, timed objectives and mission-specific scripted outcomes.

Victory conditions should be explicit in the UI and validated in the editor. Dynamic opportunities may appear during play, but the primary goal must remain clear.

---

## 8. Core gameplay systems

### 8.1 Orders and responsiveness

Orders should be accepted responsively, while unit actions retain plausible execution time. A vehicle may need to turn and accelerate; a weapon may need to acquire a target and reload; an aircraft may need to reach a target, expend ordnance and recover. Responsiveness means the game acknowledges and schedules orders immediately—not that every unit instantly performs physically impossible actions.

Orders should provide understandable feedback when they cannot be carried out, such as an unreachable destination, invalid target, blocked route, insufficient range or lack of suitable access.

### 8.2 Combat model

Use unit-specific armour and damage zones where those distinctions create meaningful choices; simplify damage elsewhere. Do not simulate every component merely for complexity’s sake.

The combat model should account for relevant factors such as:

- Weapon type and target class.
- Range and accuracy.
- Armour and impact direction where appropriate.
- Line of sight and concealment.
- Detection and target acquisition.
- Reload and firing cycles.
- Movement and firing constraints.
- Cover and terrain.
- Suppression.
- Unit damage and destruction.
- Domain-specific constraints for aircraft and vessels.

The player needs clear feedback about hits, misses, damage, suppression, kills and important status changes. Deeper weapon and unit statistics can be available through optional detail panels.

### 8.3 Suppression and morale

Use **light suppression effects**. Incoming fire can reduce effectiveness, discourage exposed movement or degrade accuracy temporarily, but suppression should not routinely remove player control or create long periods where units are helpless. Morale can be expanded later if it supports clear and useful decisions.

### 8.4 Reconnaissance, sensors and fog of war

Use a hybrid model: meaningful reconnaissance and sensor differences, with simplified rules and readable feedback.

Possible information states include:

- Confirmed visible units.
- Detected but imperfect contacts.
- Stale last-known positions.
- Uncertain contact classifications.
- Hidden or concealed units.
- Sensor coverage and gaps.

Terrain, weather, range, elevation, emissions and electronic warfare can affect detection. The UI must distinguish “not detected” from “known to be absent.” Do not flood the screen with false precision or make the player guess whether a contact is current.

### 8.5 Electronic warfare and air defence

Electronic warfare and air defence are intended as part of deeper combined-arms gameplay, but their exact implementation should be staged. EW may affect detection, tracking, communications or weapon effectiveness in defined and readable ways. Air defence should create meaningful coverage, threat zones, interception and suppression/destruction decisions without making aircraft either invulnerable or unusable.

### 8.6 Terrain and movement

Terrain mobility should combine realistic-feeling constraints with simplified, predictable rules. Relevant terrain properties may include:

- Movement cost and speed modifiers.
- Vehicle and unit class restrictions.
- Cover and concealment.
- Line of sight.
- Elevation and observation.
- Chokepoints.
- Road benefits.
- Bridge and crossing constraints.
- Water depth, navigability and shore access.
- Amphibious access where supported.

The rules should be legible in the editor and during play. If a unit cannot cross or reach an area, the map and UI should communicate why.

### 8.7 Infrastructure and destruction

Key infrastructure can be selectively damaged or destroyed. Examples include bridges, radar sites, airfields, depots, ports, power or communications facilities, and other scenario-relevant objects.

Infrastructure damage can create persistent consequences. Repairs should cost time and resources. Destroying a bridge might change routes; damaging a radar installation could alter detection; losing a port may restrict naval operations or resupply. Not every decorative object needs a complex destruction model.

The map format should separate an authored structure’s original state from its runtime condition. Mission scripts may react to destruction, repair or capture events.

### 8.8 Weather and time

Weather and time of day should have tactical effects where they add useful choices. Candidate effects include visibility, sensor performance, aircraft operations, movement, weapon effectiveness and environmental presentation. Effects should be consistent and communicated, not random punishments that players cannot anticipate.

### 8.9 Objectives and opportunities

Use dynamic objectives and opportunities alongside clear primary goals. Opportunities might arise from newly discovered intelligence, a vulnerable supply route, an exposed radar site or an enemy reinforcement window. The player should understand what has changed and why it matters.

### 8.10 Urban garrisons

Infantry can occupy explicitly garrisonable neutral buildings. A garrison is a tactical position, not a transport or an invulnerable bunker.

- **Eligibility.** Only units whose data marks them as garrison-capable may enter. In the current roster that is the rifleman and ATGM gunner. Engineers can capture strategic infrastructure but cannot garrison; vehicles cannot enter buildings.
- **Capacity and protection.** Each shelter defines a capacity, a protection fraction, an exposure fraction for suppression and a number of firing slots. A tenement holds four infantry with 55% protection and two firing slots; a ruined house holds two with 35% protection and one firing slot. These values are data, not combat-code branches.
- **Entry.** The player issues an explicit garrison order to eligible infantry. The unit walks to a reachable tile within the shelter's entry radius (footprint half-width plus 2.2 tiles from the centre) through ordinary pathfinding. Full, destroyed, ineligible, unreachable or enemy-held shelters are rejected with a message. Capacity is enforced by the simulation when each occupant arrives; it is not reserved only by the UI. Occupants leave the exposed unit layer, remain individual entities and are represented by their shelter.
- **Exit.** An explicit ungarrison order returns all of the ordering player's occupants to distinct nearest walkable tiles outside the footprint. The check is atomic: if a safe tile cannot be found for every occupant, the order is refused and everyone remains inside rather than being teleported or lost. Exited infantry resume ordinary movement and combat.
- **Protection.** A direct hit on an occupied shelter passes damage to one occupant, chosen deterministically, at `(1 - protection)` of the hit before the normal infantry armour multiplier. Protection is therefore the exact fraction the HUD reports. Exposure controls how much suppression reaches the occupied space. Splash does not select an additional occupant. The structure itself takes full structural damage, so anti-structure fire remains the counterplay; garrisoning never grants immunity.
- **Combat from inside.** Occupants retain their own weapons, ammunition, range, accuracy and target restrictions. Up to the shelter's firing slots may engage per update, rotating fairly between occupants. Shots use normal visibility, line of sight and projectile resolution from the shelter centre. There are no room interiors, directional firing ports, extra range or accuracy bonuses.
- **Contested occupation.** Enemy infantry cannot enter a shelter held by hostile occupants. A neutral shelter occupied by hostile infantry becomes a legal target for anti-structure fire; once it is empty it is neutral again. Clearing requires the occupants to leave or be eliminated; there is no separate room-clearing simulation.
- **Destruction.** Destroying an occupied shelter kills every occupant with it. Occupancy and combat state are cleared in the same authoritative step, so nobody remains sealed inside a removed building, and repair or restoration cannot resurrect dead occupants. Unit death, scenario reset and save/load clear stale occupancy.
- **AI.** The commander may occupy nearby neutral or friendly shelters when its base is threatened or it is defending, and releases garrisons when it switches to the assault or the shelter is badly damaged. It does not garrison every building or make long journeys for marginal cover.

Garrisoning is independent of strategic-objective ownership: occupying a building does not capture a nearby relay, depot or radar station.

---

## 9. Land, air and naval design

### 9.1 Land forces

Land forces are the principal local tool for many objectives: holding ground, clearing positions, taking facilities, protecting infrastructure, screening advances and establishing a beachhead.

The shared roster should cover recognisable tactical roles before adding numerous variants. Potential roles include infantry, reconnaissance, transport, anti-armour, direct-fire support, armoured manoeuvre, indirect fire, engineers, air defence, logistics and command/support units. These are role categories for roster planning, not a final launch unit list.

### 9.2 Aircraft

Aircraft are real units with movement and operational constraints, not just instant off-map abilities. The intended design includes direct player control plus automated recovery and logistics.

Potential roles include:

- Fighters and interceptors.
- Multirole aircraft.
- Air-to-ground strike.
- Close air support.
- Transport and utility helicopters.
- Attack helicopters.
- Reconnaissance aircraft.
- Uncrewed aerial vehicles.
- Electronic-warfare or sensor-support aircraft.

Aircraft should have persistent state, including fuel and ammunition where appropriate. Recovery, rearming and refuelling should be automated enough to avoid tedious micromanagement, while remaining tactically meaningful. Bases, airfields, access, damage and air-defence threats should matter.

**Implementation status (0.5.4).** Aviation is a two-tier operational model rather than a single airfield. An airfield bases four fixed-wing aircraft on four authored parking positions and offers one recovery-only helicopter pad; a heliport bases two helicopters on two of its own. A position is assigned when the airframe is ordered and is held through take-off, patrol, return, parking and servicing, so the cap is on aircraft assigned to a facility, not on hulls currently parked — a fifth order is refused. National variants inherit the family's capacity. The recovery pad lets a damaged helicopter divert to the nearest strip, but it is never a home and cannot produce: expanding a rotary force still requires heliports, which preserves the strategic distinction while avoiding the frustration of a helicopter with nowhere to land. Losing a facility releases its positions and re-bases surviving hulls to the nearest compatible friendly facility.

The exact abstraction level—such as individual weapon stores, sortie planning and maintenance—should be staged. The core loop needs clear limits and consequences without demanding a detailed flight simulator.

### 9.3 Naval forces

Naval assets are primarily strategic in their overall role, but vessels that appear on the tactical map are **fully controllable units on navigable water**. This resolves the apparent tension between strategic naval importance and direct unit control: fleets or distant assets may be abstracted at the scenario level, while on-map vessels move, detect, attack, take damage and respond to orders directly.

Potential naval roles and systems include:

- Surface combatants.
- Submarines.
- Naval aviation.
- Maritime reconnaissance and drones.
- Amphibious operations.
- Mines and mine countermeasures.
- Maritime logistics and convoys.
- Port access, repair and resupply.
- Coastal fire support and sea-lane control.

These are long-term scope areas, not a requirement that every one appear in the first slice. Initial slice naval content should prove the core movement, targeting, combat, navigability and interaction with land/air systems.

Ships need persistent operational state and meaningful constraints. Not every vessel can navigate every waterway. Water depth, channel width, obstacles, turning space, port access and mission-defined restrictions should matter. A shipyard should be a physical facility at a suitable port; port access and harbour vulnerability are part of the intended model. Some distant fleet support or repairs can be abstracted.

### 9.4 Cross-domain interaction

The depth should be **deep but readable**. Combined-arms decisions should arise from interaction between systems:

- Reconnaissance enables more effective land, air and naval attacks.
- Air defence threatens aircraft and can be suppressed or bypassed.
- Air superiority affects freedom of action and reconnaissance.
- Naval forces can influence coastal access, landing support and maritime logistics.
- Ports and airfields create operational opportunities and vulnerabilities.
- EW and sensors affect target awareness.
- Supply, fuel, ammunition and recovery limit prolonged operations.
- Weather and geography alter which domain has an advantage.

No domain should be a cosmetic add-on. At the same time, the first slice should use a representative number of interactions rather than implementing every advanced system at full depth.

---

## 10. Economy, construction and production

### 10.1 Working direction

The first slice uses a **classic RTS resource, base-building and production economy**. This is a confirmed direction; the detailed economy questions were still open when the interview was paused, and the user has authorised recommendations for unanswered questions.

Recommended defaults for the first slice:

- **Resources:** Two resources. One primary resource pays for most construction and unit production; a secondary strategic resource is scarcer and reserved for advanced units, specialist equipment or key upgrades. Keep the first implementation simple enough to tune.
- **Income:** Hybrid income. Players harvest or secure designated resource deposits, capture relevant facilities, and may receive limited passive income from controlled infrastructure. Do not make passive income so strong that map control and expansion become irrelevant.
- **Construction:** Deployable builder/construction unit or vehicle places buildings, pays the cost and waits for construction to finish. Building placement must validate terrain, spacing, access and scenario restrictions.
- **Production:** Each production building has its own queue, with a central overview for management. Land, air and naval production still obey facility-specific rules: shipyards require suitable navigable water and ports; aircraft require suitable air facilities; land units require relevant factories or structures.
- **Naval construction:** Physical shipyards at suitable ports. Port access, damage and vulnerability matter. Repairs can be represented in a simplified way initially.
- **Expansion:** A hybrid of territorial opportunity and infrastructure capacity. Resource access and strategic ground matter, while factories, airfields and shipyards constrain what can be produced or deployed.
- **Starting conditions:** Scenario-configurable. The island-assault preset begins with an established but limited beachhead, command structure, a small force and limited infrastructure. This provides immediate playability while leaving the player meaningful work to do.

These defaults are recommendations accepted in place of further interview questions, not evidence that the details had been previously decided.

### 10.2 Economy principles

- The economy should encourage scouting, expansion, defence and tactical choices.
- Resources should have clear uses and visible income/cost feedback.
- A player should understand why a unit or building is unavailable.
- Production should create meaningful trade-offs between immediate defence, expansion and long-term force composition.
- Avoid excessive queue micromanagement; use a central overview without hiding the individual facility queues.
- Economy balance must be tested on different map sizes and domain mixes.
- A map must not become unwinnable because a required resource was placed behind an inaccessible terrain feature or in an invalid area; editor validation should catch such issues.

### 10.3 Future logistics

Fuel and ammunition are especially relevant to aircraft and naval units and may later apply to selected land systems. Avoid applying detailed consumable logistics to every unit before it produces worthwhile gameplay. The initial slice should demonstrate persistent aircraft/ship operational limits at a representative level, with recovery, rearming or resupply that is understandable and not excessively tedious.

### 10.4 Strategic infrastructure and passive income

The first slice uses three authored-only, capturable strategic structures. They supplement the harvester/refinery loop; they do not replace it and cannot be constructed from the player build menu.

| Structure | Role | Benefit while owned and operational | Capture |
| --- | --- | --- | --- |
| Signals Relay | Requisition objective | **+1.1 requisition/s** | Combat Engineer, 5 s |
| Forward Supply Depot | Material objective | **+2 materials/s** (120/min) | Combat Engineer, 5 s |
| Radar Station | Reconnaissance objective | Plots hostile units within **22 tiles** through terrain masking and keeps the tactical map online | Combat Engineer, 5 s |

The depot's 2/s is deliberately a supplement: a full 300-material harvester load takes 13.6 seconds of mining before travel and unloading, so a depot adds roughly a fifth of a short-loop harvester's income without making hauling or refineries irrelevant. It is enough to fund infantry and repairs while ordinary production is disrupted, but not enough to replace a working economy. Multiple depots add independently.

Shared rules:

- **Ownership.** Structures start neutral or with an authored owner. Only the owner receives the benefit. Neutral, enemy-owned and destroyed structures pay nothing. Effects start at the tick ownership completes and stop when ownership changes, construction makes the structure non-operational or `hp` reaches zero.
- **Capture.** The existing Combat Engineer capture order is the only capture path. The engineer must reach 4.5 tiles of the structure and remain there for 5 seconds. Progress is discarded when the engineer is given another order, dies or the target becomes friendly/destroyed. Capture cannot target a construction site. Ownership changes only at completion, in the fixed-step simulation.
- **Damage and repair.** Signals Relays are capture-only and immune to fire. Depots and radar stations are ordinary structures: they take structural damage, can be repaired by an engineer and can be destroyed. A damaged but living structure remains operational; destruction removes the entity and its effect immediately.
- **Radar.** The reconnaissance scan requires an owned, complete, surviving station and a grid without a brownout. It reveals hostile units and structures inside 22 tiles regardless of forest concealment, but does not grant weapon line of sight. The feed returns automatically when the grid recovers; no recapture is needed. A neutral station is charted but scans for nobody.
- **Persistence and authoring.** All three structures are placed in the editor (including neutral ownership), saved in the scenario, and captured through ordinary runtime ownership. Scenario saves preserve the authored placement; battle saves preserve runtime ownership, damage, capture progress and the station's operational state.
- **AI.** The commander values a relay when requisition is low, a depot when harvesters or passive materials are scarce, and a radar station when it has no reconnaissance feed. It sends a free engineer only when the base is not under threat, no construction site is waiting, and the objective is within 48 tiles; a failed or impossible capture does not re-fire every tick.

Not every building is capturable: the capture set is the structures above. Airfields and ports exist and are operational, but are not captured by this rule, and bridges, additional depot types and a general buff framework remain future work.

---

## 11. Maps, world model and geography

### 11.1 Map model

Use a **classic tile grid** as the authoritative gameplay map model. A grid supports editor usability, predictable movement rules, map validation and efficient authoring. The renderer can still provide elevation, lighting, atmospheric effects and polished transitions; a tile-based simulation does not require a visually flat or crude presentation.

Each tile may encode:

- Terrain type.
- Elevation.
- Movement and traversal properties.
- Cover and concealment.
- Visibility/line-of-sight properties.
- Road, river, bridge or other feature data.
- Water depth or navigability.
- Ownership or scenario control data where appropriate.
- Buildability and placement restrictions.

Do not force every environmental detail into the tile record; larger structures and authored objects should be represented as entities or placed features as appropriate.

### 11.2 Map types

The full game should support a broad range of geographic settings, including:

- Inland rural and open terrain.
- Urban and industrial areas.
- Forested or broken terrain.
- River crossings and bridge networks.
- Coastal battles.
- Islands and amphibious approaches.
- Ports and maritime approaches.
- Airfield and infrastructure-centred maps.

Not every map needs all three domains. The scenario and geography should make the intended force composition and routes understandable.

### 11.3 Navigable water

Water is gameplay space, not merely a visual tile type. Maps should encode connected navigable areas, depth or vessel access classes, channels, shorelines, ports, obstacles and restrictions. Vessels should have class-specific access. Validation should identify isolated water pockets, inaccessible shipyards, blocked channels and objectives that cannot be reached by any intended unit class.

### 11.4 Scale

The island-assault slice is intended to reach a large-map experience, but development should start with a smaller representative island that proves the systems. Scale up after pathfinding, domain interaction, AI, economy and rendering costs have been measured. A large empty map is not a substitute for meaningful geography: ports, airfields, landing areas, inland routes, resource locations, chokepoints and enemy positions should all support tactical decisions.

---

## 12. In-game map and scenario editor

### 12.1 Role and schedule

The editor is a core product feature and should be developed in parallel with the simulation. It will expand in stages, but the first editor should already create maps that can be validated and loaded into a real battle.

### 12.2 Initial scope

Recommended first editor tools:

- Create/load/save a map.
- Set map dimensions and scenario metadata.
- Paint terrain tiles.
- Edit elevation.
- Place water, coastlines, rivers and navigable channels.
- Place roads, bridges and key infrastructure.
- Place player starts and initial units.
- Place resource sources and production/strategic sites.
- Place ports, shipyards and airfields.
- Set teams and basic victory conditions.
- Preview movement, navigation and important reachability.
- Run automated validation.
- Launch a test battle directly from the editor.

The initial editor should be small and extensible. Do not block the first playable slice on a polished general-purpose mission scripting system.

### 12.3 Validation

The editor should issue actionable warnings or errors for problems such as:

- Invalid or missing player starts.
- Unreachable objectives.
- Unreachable resource sources or required infrastructure.
- Invalid building placement.
- Shipyards without valid water access.
- Disconnected or impassable water routes where naval movement is expected.
- Inaccessible ports or airfields.
- Missing required victory-condition entities.
- Unbalanced or unintended deployment zones.
- Maps with no plausible route between opposing forces.
- Scenario settings that conflict with placed content.

Warnings should distinguish fatal problems from recommendations. The validation result should identify the offending object or area and, where possible, suggest a correction.

### 12.4 Shared format

Use one shared versioned map/scenario format for skirmish and campaign, with optional mission scripting. Separate:

1. **Authored data:** terrain, structures, starts, placements, metadata, scenario rules and mission-authored triggers.
2. **Runtime state:** current damage, ownership, unit positions, resource stocks, destroyed objects and other battle changes.
3. **Save state:** runtime state plus the information needed to resume a session safely.

The same map should load in the editor, test mode, skirmish and campaign without manual conversion. Import/export should arrive before an integrated community map library. Future content compatibility needs version identifiers and useful error messages.

---

## 13. Controls and user interface

### 13.1 Input parity

Keyboard/mouse, touch and gamepad should be supported from the outset. They should issue the same conceptual commands, even if the physical interactions differ.

- **Keyboard/mouse:** precise selection, drag-box selection, contextual commands, hotkeys and quick group management.
- **Touch:** direct selection and drag selection, plus a dedicated **BOX** selection button for deliberate box-selection mode. Do not rely on hover or tiny controls.
- **Gamepad:** focus/navigation model, contextual actions and reliable selection/group commands that do not require a mouse.

All modes need clear selection feedback, order previews where useful, command acknowledgement and consistent cancellation behaviour.

### 13.2 Selection and groups

Support:

- Selecting an individual unit.
- Drag-box selection.
- Persistent control groups.
- Quick group selection.
- Specialist selection for relevant unit roles.
- Clear mixed-selection behaviour.
- Contextual actions based on selected unit capabilities.

Formation use should remain minimal, with a few understandable presets rather than a complex formation editor. Group-level stance commands should be possible, with individual unit overrides where appropriate.

### 13.3 Contextual command model

Clicking/tapping ground, an enemy or a site should issue the likely contextual command for the selected unit: move, attack, interact, capture or another supported action. Specialist actions and explicit overrides must remain available, so contextual simplicity does not remove tactical control.

The UI should communicate when the selected units cannot perform an action or when only part of a mixed group can do so.

### 13.4 Persistent unit information

A persistent selected-unit information panel along the bottom of the screen is part of the intended interface. It should show identity, role, health/condition, key operational state and relevant commands. It must remain useful on mobile without obscuring too much battlefield space.

### 13.5 Production interface

Use a central production overview while preserving each facility’s own queue. Players should be able to see what is being produced, queue or cancel production where allowed, understand facility requirements and jump to the relevant facility. Specialist rules still apply to aircraft and naval production.

### 13.6 Alerts and information hierarchy

Use layered alerts:

- **Critical:** immediate, reserved for threats or state changes needing rapid response.
- **World markers:** quieter, persistent visual indicators for important locations, contacts or tasks.
- **Event log:** searchable/reviewable record of notable events.
- **Optional summaries:** configurable periodic or end-of-phase summaries.

Do not make every event a modal interruption. Alerts should prioritise urgency and provide a route to the relevant unit, location or information.

### 13.7 Accessibility

Support, at minimum:

- Colour-vision-friendly palettes and redundant team/ownership indicators.
- Subtitles for voiced content.
- Reduced camera shake.
- Configurable visual effects.
- Clear text and icon contrast.
- Scalable interface elements where feasible.
- Input remapping and adjustable control sensitivity where applicable.
- Important feedback that does not rely on sound alone.

The shipped build implements colour-redundant team identity, an 80–150% interface
scale, a graphics-quality and render-scale setting, an optional frame-rate
readout, a choice of Escape behaviour, reduced camera shake and configurable
visual effects. Input remapping and adjustable control sensitivity are not
implemented.

### 13.8 Visual direction

Avoid a bland collection of panels over a battlefield. The interface should feel like a polished military command system, with strong hierarchy, high-quality unit/building imagery or renders where useful, map intelligence, event presentation and clear faction identity. Visual richness should make information more engaging, not bury it in decoration.

---

### 13.9 Shipped interface state (v0.3.0 BETA)

The implemented interface follows the sections above with these concrete choices:

- **Type and scale.** Every HUD, production-sidebar, selection-panel and command-bar
  size comes from five tokens (11, 12, 13, 15 and 18 px) multiplied by an interface
  scale of 80–150%. Resource figures are set larger than their labels; uppercase
  letter-spaced styling is reserved for short headings.
- **Selection.** Click, box-select, additive select, control groups, double-click (or
  double-tap) for every visible unit of a type, and `Ctrl+A` for the whole mobile
  army. Above eight units the roster collapses to one card per type with a count, and
  that card narrows the selection to the type.
- **Commands.** Contextual right-click plus explicit attack-move, stop, hold, capture,
  garrison, return, dive and construction commands, each with a desktop hotkey shown
  on the button and a touch command-bar equivalent. Escape cancels an active command
  mode first, then either pauses the battle or opens the menu, according to the
  setting.
- **Wayfinding.** `F2` (or a click on a critical toast) jumps to the last alert,
  `F8`/`F9` cycle idle harvesters and engineers, and `Ctrl+Shift+1..4` / `Shift+1..4`
  save and recall camera bookmarks. `F1` remains the briefing, `F3` the debug overlay
  and `Ctrl+1..9` the control groups.
- **Production feedback.** Facility cards print the blocking reason (`NO MATERIALS`,
  `NEEDS SHIPYARD`, `QUEUE FULL`) on the card, distinguish a temporary shortage from
  missing technology by colour, and keep the full explanation in the tooltip.
- **Radar.** While the tactical map is offline it collapses to a slim bar that names
  the cause (no radar array, or a grid brownout), and the Radar Array card is flagged
  in the Base tab.
- **Alerts.** Critical toasts are clickable; world markers and the event log remain
  non-modal.

### 13.10 Deliberately not implemented

- **Key rebinding** needs a persisted action map, conflict detection, key-cap
  rendering read from that map, and a settings editor for it.
- **Patrol** needs the simulation to consume the order's second destination (the
  order type already carries it) plus command, command-gate and HUD wiring on every
  seat.
- **Waypoint queues** need a per-unit queue in authoritative state, snapshot and save
  migration, and modifier-order input; that is a simulation change, not an interface
  one.

## 14. Audio and presentation

The intended tone is grounded and cinematic. Audio should reinforce unit identity, movement, weapons, detection, damage, air and naval operations, weather and mission atmosphere.

Recommended principles:

- Positional audio where it helps identify nearby activity.
- Distinct but restrained weapon and vehicle sound signatures.
- Clear audio cues for important events, with visual equivalents.
- Radio and briefing presentation that supports narrative without making essential information hard to understand.
- Adjustable music, effects, dialogue and ambience.
- Subtitles for all mission-critical spoken information.
- Reduced-shake and visual-effect controls to preserve comfort and tactical clarity.

The renderer and effects pipeline should be designed to degrade gracefully on weaker devices. Visual spectacle is valuable, but combat state and input response must remain reliable.

---

## 15. Save, replay and determinism

A deterministic fixed-step simulation is a foundational requirement. The authoritative simulation should be separate from rendering and visual effects.

Recommended rules:

- Use fixed simulation ticks independent of rendering frame rate.
- Route player and AI actions through a well-defined command queue.
- Control random-number generation with explicit seeds and state.
- Define stable processing order for simulation systems and entities where needed.
- Avoid making gameplay outcomes depend on animation timing or browser frame pacing.
- Store enough state to resume a battle correctly, including capture progress, runtime structure ownership and garrison occupancy.

- Version save files and define migration or incompatibility behaviour.
- Build repeatability tests early.

For identical map/scenario data, initial state, seed and command sequence, the simulation should produce equivalent authoritative outcomes. Visual effects may differ slightly without affecting gameplay.

Replay recording is a useful future capability because it can help debugging, AI testing, balance review and multiplayer readiness, but it should not delay the first complete slice.

---

## 16. Recommended first vertical slice

### 16.1 Objective

Prove that the project’s core systems work together in a real playable battle created through the in-game editor. The slice should be representative rather than broad: it must include land, air and sea, but only a small roster and a controlled set of interactions.

### 16.2 Scenario

**Working scenario:** Island Assault.

- Large-map target, developed initially from a smaller representative island.
- Two opposing factions selected from the launch framework.
- A player beachhead with a command structure, small starting force and limited infrastructure.
- Enemy base and forces inland or across a contested route.
- A port or usable coastal approach.
- An airfield or aircraft recovery point.
- Navigable water and at least one controllable naval unit.
- Resource sites and a meaningful expansion route.
- Clear terrain chokepoints and tactical options.
- Victory by destroying the enemy force or base.

The exact fictional island, terrain layout, starting roster and story framing remain to be authored. The map should demonstrate cross-domain decisions rather than merely place one aircraft and one ship on the map.

### 16.3 Minimum representative content

- One player faction and one opposing faction, with the architecture able to represent the wider six-nation model.
- A compact but useful selection of land units with distinct roles.
- At least one controllable aircraft with fuel/ammunition and a recovery/rearm loop at a representative level.
- At least one controllable naval vessel that can navigate, detect/attack and interact with the battle.
- Basic air-defence or another credible counter that demonstrates cross-domain vulnerability.
- A deployable builder/construction capability.
- A command structure and a small set of required production buildings.
- Two-resource economy with harvestable/controllable income sources.
- Basic AI economy, production, attack and defence.
- Destruction of the opposing force/base as victory condition.
- Defeat, restart and save/load.
- Automated map validation.
- Keyboard/mouse, touch and gamepad paths through essential gameplay.

### 16.4 End-to-end workflow

The slice must prove:

1. Create or open the map in the editor.
2. Paint terrain and place starts, resources, facilities and objectives.
3. Run validation and receive actionable feedback.
4. Launch the same map in a real battle.
5. Establish/expand the base and collect income.
6. Construct facilities and produce units.
7. Issue orders using each supported input method.
8. Use land, air and naval units in meaningful ways.
9. Face an AI opponent that can develop and attack.
10. Reach victory or defeat.
11. Restart and load a saved battle.
12. Repeat a deterministic test with the same seed and commands.

### 16.5 Quality gates

The slice is not complete merely because a unit can move around a map. It should meet these gates:

**Gameplay**
- Orders are responsive and understandable.
- Core movement, targeting, damage and destruction work reliably.
- The economy supports a complete build-and-fight loop.
- The AI can field a credible force and threaten the player.
- All three domains have at least one meaningful interaction.
- Victory and defeat are reliably detected.

**Editor and data**
- A map created in the editor loads unchanged in battle.
- Validation catches known invalid configurations.
- Terrain and water navigation rules are consistent between editor previews and simulation.
- Save/load does not corrupt map or battle state.

**Controls and UX**
- Essential actions are available by keyboard/mouse, touch and gamepad.
- No essential action depends on hover.
- Selection, orders, production and alerts are understandable.
- The UI remains usable at target desktop and landscape-mobile sizes.

**Simulation**
- Fixed-step simulation is separated from rendering.
- Repeatability tests pass for defined deterministic scenarios.
- Simulation and rendering performance are measured at representative unit counts.
- Errors and invalid states are diagnosable rather than silently ignored.

**Presentation**
- Unit identity, health, orders and important combat outcomes are legible.
- Visual effects can be reduced without losing critical feedback.
- Audio has visual equivalents for critical events.

### 16.6 Deliberately out of scope for the first slice

- Full campaign and all 24–30 campaign missions.
- Complete launch rosters for all six nations.
- Full strategic AI.
- Every advanced naval role (submarines, mines, maritime logistics, naval aviation) at production depth.
- Comprehensive EW and sensor simulation.
- Full destruction simulation for all structures.
- General-purpose mission scripting.
- Integrated community map library.
- Full modding SDK and custom asset pipeline.
- Multiplayer implementation. (A staging build exists behind a disabled feature
  flag and is verified by the multiplayer phase reports; it is not part of this
  slice and is not switched on in any shipped build.)
- Complete platform store packaging and certification.

The architecture should leave room for these systems, but they should not prevent a complete, testable vertical slice.

---

## 17. Development roadmap

The sequence below is a recommended plan, subject to evidence from technical prototypes.

### Phase 0 — Technical proof

- Confirm custom WebGL renderer feasibility on desktop and mobile browsers.
- Render the tile grid, elevation, water and a few representative units.
- Validate input latency and camera performance.
- Prototype fixed-step simulation and rendering separation.
- Test basic land movement and navigable water.
- Measure performance with representative entity counts.
- Confirm the toolchain and build/deployment workflow.

**Exit criterion:** The chosen technical foundation can render and simulate a small mixed-domain scene at acceptable performance, with a clear path to scaling.

### Phase 1 — Shared world and editor foundation

- Define the versioned map/scenario data model.
- Build terrain painting, elevation, water and placement tools.
- Add player starts, resources, structures, ports and airfields.
- Add validation and test-battle launch.
- Create initial save/load and version handling.

**Exit criterion:** A map can be authored, validated, saved and loaded into the simulation without manual conversion.

### Phase 2 — Core land RTS loop

- Implement selection and movement orders.
- Add pathfinding and terrain constraints.
- Add targeting, weapons, health, damage and destruction.
- Add builder, structures, economy and production queues.
- Add basic UI, combat feedback and victory/defeat.
- Add simple AI.

**Exit criterion:** A complete land-focused base-building skirmish can be won or lost.

### Phase 3 — Representative air and naval integration

- Add aircraft movement, targeting, operational limits and recovery.
- Add navigable water, vessel movement and targeting.
- Add ports/shipyards and air facilities.
- Add representative air-defence and cross-domain interactions.
- Test coastal pathing and island geography.
- Integrate these systems into the same economy and battle loop.

**Exit criterion:** Air and naval units are meaningful, controllable and constrained by the same authoritative simulation.

### Phase 4 — Island-assault vertical slice

- Build the representative island scenario.
- Complete the two-resource economy and expansion loop.
- Integrate AI base-building, production, attack and defence.
- Complete all input modes for essential commands.
- Implement victory/defeat, restart, save/load and deterministic tests.
- Add enough sound and visual polish to evaluate the intended feel.
- Run quality gates and fix high-impact issues.

**Exit criterion:** The full editor-to-battle loop passes the gates in Section 16.

### Phase 5 — Skirmish breadth and polish

- Expand unit roles and national specialisations.
- Improve AI tactics and difficulty profiles.
- Add additional map types and victory conditions.
- Improve balance, performance, accessibility and presentation.
- Add map import/export and compatibility checks.
- Add scenario setup and quality-of-life features.

### Phase 6 — Campaign foundation

- Finalise the story outline and mission sequence.
- Add briefing/debriefing systems and mission scripting.
- Implement optional objectives and persistent mission consequences.
- Add campaign state and selective veteran/asset persistence.
- Build one representative campaign mission before producing the full mission set.

### Phase 7 — Release and long-term ecosystem

- Package for Steam and mobile stores.
- Add platform-specific UX and performance profiles.
- Expand campaign content and faction rosters.
- Grow the editor, import/export and modding capabilities.
- Consider integrated content discovery and multiplayer after the core game is stable.

---

## 18. Risks and mitigation

### 18.1 Scope across three domains

**Risk:** Land, air and sea together can overwhelm the first implementation.

**Mitigation:** Keep the architecture domain-complete but the first content set representative. Build a single controllable unit per air/naval role initially and prove interactions before expanding the roster.

### 18.2 Custom renderer risk

**Risk:** A custom WebGL renderer can absorb time in low-level technology rather than gameplay.

**Mitigation:** Set an early technical proof gate. Measure rendering, input latency, mobile compatibility and entity scale before committing to advanced effects or a large content pipeline.

### 18.3 Map and navigation complexity

**Risk:** Tile movement, aircraft operations and vessel-specific water access can create inaccessible maps and confusing pathfinding.

**Mitigation:** Make navigation data explicit, provide editor previews, validate reachability and use test maps designed to expose edge cases.

### 18.4 Simulation performance

**Risk:** Hundreds of entities and combined-arms interactions may cause frame drops or slow simulation.

**Mitigation:** Separate simulation and rendering, profile early, use fixed-step updates, measure authoritative simulation cost and degrade visuals before compromising tactical fidelity.

### 18.5 Determinism

**Risk:** Browser timing, unordered processing or uncontrolled randomness can make tests unreliable and undermine future multiplayer.

**Mitigation:** Use seeded randomness, stable command processing, explicit simulation ticks and repeatability tests from the beginning.

### 18.6 UI complexity

**Risk:** Deep mechanics could produce a cluttered, text-heavy interface or poor mobile controls.

**Mitigation:** Keep a clear information hierarchy, persistent selected-unit panel, contextual commands, layered alerts, central production overview and dedicated touch selection affordances. Test with all three input modes throughout development.

### 18.7 Campaign scope

**Risk:** Two 12–15 mission campaigns plus branching consequences can multiply content requirements.

**Mitigation:** Use authored linear campaigns with controlled local consequences, reusable mission systems and selective persistence. Prove one mission end-to-end before scaling content production.

### 18.8 Narrative plausibility and sensitivity

**Risk:** A near-future story using real nations can accidentally imply certainty about real events or reduce complex populations to stereotypes.

**Mitigation:** Clearly frame the conflict as fictional, portray governments and factions with internal tensions, avoid presenting speculation as fact, and give non-playable countries their own interests and constraints.

### 18.9 Economy and map balance

**Risk:** Resource placement, facility access or naval constraints can make maps unfair or unwinnable.

**Mitigation:** Validate access, expose resource/income information, test different starting conditions and use automated scenario checks alongside human playtesting.

---

## 19. Decisions, recommendations and unresolved details

### 19.1 Established direction from the interview

- Modern evolution of classic Command & Conquer / Red Alert 2.
- Near-future fictional global war grounded in real-world nations and equipment.
- Two separately selectable, interwoven campaigns, provisionally 12–15 missions each.
- Skirmish-first development; campaign and skirmish equally important in the final product.
- Six launch skirmish nations: Lithuania, Poland and UK versus Russia, Belarus and Hungary.
- Hungary has limited specialist involvement on the Russia-aligned side.
- Shared roster foundation with substantial national specialisations; asymmetrical but balanced.
- Land, air and sea are core design pillars.
- Aircraft are directly controllable with automated recovery/logistics.
- On-map naval units are fully controllable; wider naval assets may be strategically abstracted.
- Persistent fuel/ammunition/recovery considerations for air and naval assets.
- Deep but readable cross-domain interaction.
- Classic tile-grid gameplay map.
- Powerful in-game editor developed in stages and in parallel with simulation.
- Automated map validation and warnings.
- Shared versioned map/scenario format with optional mission scripting.
- Import/export before an integrated map library.
- Selective destruction of key structures and persistent consequences; repairs cost time/resources.
- Hybrid terrain mobility and reconnaissance/sensor rules.
- Tactical weather/time effects and dynamic opportunities alongside clear core objectives.
- Responsive orders with realistic execution time.
- Unit-specific armour/damage zones where useful; simplified elsewhere.
- Clear combat feedback with optional deeper stats.
- Light suppression.
- Deterministic fixed-step simulation from the outset.
- Web-first custom WebGL renderer; later Steam, Google Play and Apple App Store.
- Keyboard/mouse, touch and gamepad support from the outset.
- Persistent selected-unit information panel; dedicated touch BOX selection.
- Contextual commands, control groups, limited formation presets, group stances and individual overrides.
- Central production overview with facility-specific queues.
- Layered alerts and broad accessibility settings.
- First slice: island assault, large-map target, two factions, land/air/naval units, classic economy, basic AI, destroy enemy force/base, complete editor-to-battle loop.

### 19.2 Recommended defaults adopted to avoid another interview loop

These details were not all explicitly settled, so they are recommended baseline choices:

- Two resources: primary and secondary strategic.
- Hybrid income: deposits/harvesting, capturable facilities and limited passive income.
- Deployable builder and placed construction.
- Individual production-building queues plus central overview.
- Physical shipyards at suitable ports.
- Expansion driven by both territory/resource access and infrastructure capacity.
- Scenario-configurable starts; island assault starts with a limited established beachhead.
- Small representative island first, scaling toward the intended large island.
- Basic AI begins with economy, production, attack and defence before advanced strategy.
- Campaign mission results change support, intelligence, reinforcements and conditions, while the broad overall story may converge.
- One shared simulation and map format should be authoritative for editor, skirmish and campaign.

### 19.3 Open details that can be decided during implementation

These are not blockers for beginning the vertical slice:

- Final faction naming and branding details. The project title is settled:
  **Modern Combined Arms** (MCA).
- Exact 2034–2038 timeline.
- Final narrative trigger for the connected second theatre.
- Final nation-by-nation unit rosters and equipment variants.
- Exact unit statistics, costs, build times and faction-specific advantages.
- Final resource names, rates and values.
- Exact construction and production building list.
- Detailed aircraft fuel/rearm model and naval repair abstraction.
- Precise pathfinding and vessel navigation implementation.
- Final renderer/library choices after technical validation.
- Exact performance targets and minimum supported devices.
- Full victory-condition library.
- Final campaign mission order and named characters.
- Multiplayer, modding and community-library implementation scope.
- Final store-release schedule.

These should be resolved when a concrete system, prototype or content task needs them. They do not justify repeating broad interview questions that have already been answered.

---

## 20. Final guiding principle

Build a **complete, playable, testable combined-arms RTS loop** before building a huge game around it.

The first slice must feel like the beginning of the intended product—not a generic terrain demo with a few units—but it should prove that vision through a tightly controlled scenario: a base and economy worth managing, land forces worth commanding, aircraft worth protecting and recovering, naval units that matter to geography, an opponent that reacts, a map that can be authored and validated, and controls that work across desktop and mobile.

Once that foundation is reliable, expand the roster, map variety, AI, campaign and community systems on top of the same authoritative simulation.
