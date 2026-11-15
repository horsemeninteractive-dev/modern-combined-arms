# Phase 5A — Battlefield Roster & Capability Gap Audit

**Status:** audit originally written before implementation. Phase 5C added the
shared APC, Phase 5D added the shared utility transport helicopter, and the
Stage A arsenal expansion added the shared MANPADS team, EW vehicle and loitering
munition; the
roster and gap figures below are updated, while the original recommendations are
retained as the historical audit record. No commit, reset, stash or revert was
performed.

**Method.** Every statement marked *verified* below was read from the current
source in this working tree, not from an earlier report. Section 11 lists the
judgements that are recommendations rather than facts, and the design decisions
that need the owner's approval before Phase 5B.

**Headline result.** The roster is broad and, for what it contains, functional:
71 registered unit definitions (28 shared, 21 Eastern alliance platforms, 22
national), 49 registered structures (39 shared, 10 national), four research
branches with a coherent unlock graph, and working air, naval, garrison,
detection and AI production systems. At the time of the audit the decisive gap
was not a missing unit but a missing **simulation capability**: no passenger or
cargo system existed, so land, air and naval infantry transport were absent.
Phase 5B supplied the shared container contract, Phase 5C shipped the first land
consumer and Phase 5D ships the first air consumer. Naval transport remains
future work.

---

## 0. What is actually registered

| Registry | Count | Source |
| --- | --- | --- |
| Shared baseline units (`UNIT_LIST`) | 24 | `src/data/units.ts` (`ROSTER`) |
| Eastern alliance platforms | 18 | `src/data/units.ts` (`ALLIANCE_UNITS`) |
| National units (replacements, exclusives, naval hulls) | 22 | `src/data/units.ts` (`NATIONAL_UNITS`) |
| **Total registered units (`UNITS`)** | **64** | `.dev` count of `id:` entries in `units.ts` |
| Shared baseline structures (`BUILDING_LIST`) | 39 | `src/data/buildings.ts` (`ROSTER`) |
| National structures (`NATIONAL_BUILDINGS`) | 10 | `src/data/buildings.ts` |
| **Total registered structures (`BUILDINGS`)** | **49** | count of `id:` entries in `buildings.ts` |
| Playable nations | 10 (5 + 5) | `src/data/factions.ts` (`NATION_DATA`) |
| Technologies | 18 (8 branch + 10 strategic authority) | `src/data/research.ts` (`TECH_LIST`) |

Movement is `foot | wheeled | tracked | naval | air` and domain is
`land | air | naval` (`src/sim/types.ts`). There is **no** `amphibious`, `hover`,
`swim` or passenger move class. That single omission is why the "Amphibious IFV"
below is amphibious in name only.

---

## 1. Canonical unit catalogue

### 1.1 Shared baseline (23)

All are available to a nation unless its roster substitutes the slot. "Gate" is
the technology required in addition to the producing structure; `tier 0` means
no technology. AI support is via canonical-slot demand in `src/sim/ai.ts`
(`SLOT_BASE`, `slotDemand`), and every one of these is produced, saved and
replicated as an ordinary `Entity`.

| ID | Name | Domain / move | Primary role | Armament (actual) | Produced by | Gate | Completeness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `engineer` | Combat Engineer | land / tracked | Construction, repair, capture | none | factory, commandPost (fallback) | tier 0 | Complete |
| `rifle` | Rifleman | land / foot | Line infantry | `rifle` | barracks | tier 0 | Complete |
| `atgm` | ATGM Gunner | land / foot | Anti-armour | `atgm` | barracks | tier 0 | Complete |
| `medic` | Field Medic | land / foot | Healing support | none (heals one infantry at a time) | barracks | tier 0 | Complete |
| `tank` | Main Battle Tank | land / tracked | Armour | `tankGun` | factory | manoeuvre1 | Complete |
| `spg` | Self-Propelled Howitzer | land / tracked | Indirect fire | `howitzer` (min range 4) | factory | fires1 | Complete |
| `recon` | Recon Vehicle | land / wheeled | Reconnaissance | `autocannon` (can hit air) | factory | tier 0 | Complete |
| `aa` | AA Vehicle | land / wheeled | Air defence | `samVehicle` (air only) | factory | tier 0 | Complete |
| `recovery` | Field Recovery Vehicle | land / tracked | Repair | none; repairs vehicles only | factory | tier 0 | Partial — repair, no tow/recovery |
| `apc` | Armoured Personnel Carrier | land / wheeled | Infantry transport | `apcMg` (light defensive MG) | factory | tier 0 | Complete — four passengers, unload, kill-on-destruction |
| `harvester` | Harvester | land / tracked | Economy | none | factory, commandPost (fallback) | tier 0 | Complete |
| `fighter` | Strike Fighter | air / air | Strike | `strikeMissile` ×4, fuel | airfield | air2 | Complete |
| `interceptor` | Interceptor | air / air | Air superiority | `airMissile` ×6, fuel | airfield | air1 | Complete |
| `uav` | Recon UAV | air / air | Reconnaissance | none, fuel | airfield | air1 | Complete |
| `missileBoat` | Missile Boat | naval / naval | Fast attack | `skiffMissile` ×2 + `navalGun` | shipyard | naval1 | Complete |
| `corvette` | Missile Corvette | naval / naval | Naval combatant | `navalMissile` ×6 + `navalGun` | shipyard | naval1 | Complete |
| `frigate` | Escort Frigate | naval / naval | Fleet escort / ASW | `navalMissile` ×4, `navalSam`, `navalGun`, `depthCharge`; sonar 12 | shipyard | naval2 | Complete |
| `submarine` | Attack Submarine | naval / naval | Subsurface raider | `torpedo` ×4, battery/dive state | shipyard | naval2 | Complete |
| `navalSupport` | Fire Support Ship | naval / naval | Shore bombardment | `bombardmentGun` (cannot target ships) | shipyard | naval2 | Complete (intended specialist) |
| `ifv` | Infantry Fighting Vehicle | land / tracked | Mechanised fire support | `autocannon` + `atgm` | factory | manoeuvre1 | Complete as a fighting platform; **no transport** |
| `td` | Tank Destroyer | land / wheeled | Anti-armour | `atgm` | factory | manoeuvre2 | Complete |
| `rocketArtillery` | Multiple Rocket Launcher | land / tracked | Rocket artillery | `rocketSalvo` (min range 5) | factory | fires2 | Complete |
| `attackHelo` | Attack Helicopter | air / rotary | Rotary attack | `autocannon` + `atgm` ×6, fuel | heliport | air2 | Complete; **no transport** |
| `transportHelo` | Utility Transport Helicopter | air / rotary | Infantry transport | none (unarmed) | heliport | air2 | Complete — four passengers, landed boarding/unload, kill-on-destruction |

Notable verified facts:

- The original audit found **no** `transport`, `passenger`, `cargo`, `embark`,
  `board` or `unload` field on `UnitDef` (`src/sim/types.ts`). Phase 5B added
  `UnitDef.transport?: TransportDef` and the shared `ContainerDef`; Phase 5C's
  `apc` and Phase 5D's `transportHelo` are the shipped definitions that set it.
  `Entity` still carries only
  `garrisonId`, and the harvester's visual fill level is still presentation-only
  (`src/render/unitMeshes.ts`, `src/multiplayer/projection.ts`).
- `recovery` is labelled "Repair / recovery" but implements repair only
  (`repair: { radius: 8, hpPerSec: 18 }`); it cannot tow or carry a hull.
- `navalSupport` is a bombardment ship, not a repair/support ship: its weapon
  targets `ground` and `structure`, not `naval`, and its own description says it
  "cannot fight other ships at all".

### 1.2 Eastern Coalition platforms (18)

They fill the same canonical slots as the Defender baseline and are selected by
`EASTERN_PLATFORMS` (`src/data/factions.ts`). A national replacement resolves
`national → alliance platform → canonical slot`.

| ID | Slot | Name | Actual capability | Note |
| --- | --- | --- | --- | --- |
| `rifleEC` | `rifle` | Motor Rifleman | `rifle` | cheaper, less vision/HP |
| `atgmEC` | `atgm` | Heavy Missile Team | `atgm` | slower |
| `reconEC` | `recon` | Recon BRM | `autocannon` | tougher, shorter optics |
| `ifvEC` | `ifv` | **Amphibious IFV** | `autocannon` only | **no amphibious movement exists** — name overstates capability |
| `tankEC` | `tank` | Main Battle Tank | `eastTankGun` | cheaper, less accurate |
| `tdEC` | `td` | Assault Gun | `assaultGun` | casemate, fixed gun |
| `spgEC` | `spg` | Self-Propelled Howitzer | `howitzer` | slower reload |
| `rocketArtilleryEC` | `rocketArtillery` | Heavy Rocket Battery | `heavyRocketSalvo` | wider, less accurate |
| `aaEC` | `aa` | SAM Vehicle | `samVehicle` | no gun |
| `uavEC` | `uav` | Recon UAV | unarmed, fuel | longer loiter |
| `interceptorEC` | `interceptor` | Interceptor | `airMissile` | thinner airframe |
| `fighterEC` | `fighter` | Strike Fighter | `strikeMissile` | tougher, worse vs fighters |
| `attackHeloEC` | `attackHelo` | Attack Helicopter | `autocannon` + `strikeMissile` | no transport |
| `missileBoatEC` | `missileBoat` | Missile Boat | `skiffMissile` + `navalGun` | tougher, slower |
| `corvetteEC` | `corvette` | Missile Corvette | `navalMissile` + `navalGun` | no area AD |
| `frigateEC` | `frigate` | Escort Frigate | `navalMissile`, `navalGun`, `depthCharge`; sonar 9 | **no naval SAM** |
| `submarineEC` | `submarine` | Attack Submarine | `torpedo` ×5, longer battery | noisier |
| `navalSupportEC` | `navalSupport` | Fire Support Ship (monitor) | `bombardmentGun` | tougher, slower |

### 1.3 National units (22)

Each nation has at least one replacement, one exclusive and one structure variant
(plus a national naval hull for Sweden and Iran, and further national units where
documented), verified by
`tests/national-roster-complete.test.ts`.

| ID | Nation | Kind | Replaces | Armament | Gate | Completeness |
| --- | --- | --- | --- | --- | --- | --- |
| `pathfinder` | Lithuania | replacement | `recon` | none, vision 16 | tier 0 (inherits `recon`) | Complete |
| `kestrelTeam` | Lithuania | exclusive | — | `manpads` (air only) | manoeuvre1 | Complete, infantry-entity |
| `spearhead` | Poland | replacement | `tank` | `spearheadGun` | manoeuvre1 | Complete |
| `wilk` | Poland | exclusive | — | `autocannon` + `atgm` | manoeuvre2 | Complete |
| `mlrs` | UK | replacement | `spg` | `mlrsRocket` | fires1 | Complete |
| `stormShadow` | UK | exclusive | — | `stormMissile` (26 tiles) | fires2 | Complete |
| `k9Thunder` | Finland | replacement | `spg` | `k9Shell` | fires1 | Complete |
| `spikeTeam` | Finland | exclusive | — | `spikeEr` (12 tiles) | fires1 | Complete, infantry-entity |
| `cv90` | Sweden | replacement | `ifv` | `bofors40` + `atgm` | manoeuvre1 | Complete |
| `gripen` | Sweden | exclusive | — | `airMissile` + `gripenStrike` | air2 | Complete |
| `visby` | Sweden | naval hull | — | `navalMissile` + `navalGun` | naval1 | Complete |
| `heavyHowitzer` | Russia | replacement | `spgEC` | `heavyShell` | fires1 (slot `spg`) | Complete |
| `tosp` | Russia | exclusive | — | `thermobaric` | fires2 | Complete |
| `deepReconUAV` | Belarus | replacement | `uavEC` | none, vision 30 | air1 | Complete |
| `sprut` | Belarus | exclusive | — | none, vision 11.5 | tier 0 | Complete |
| `hedgehogTeam` | Hungary | replacement | `atgmEC` | `hedgehogAtgm` | tier 0 (slot `atgm`) | Complete, infantry-entity |
| `taszar` | Hungary | exclusive | — | `lightMortar` | fires1 | Complete, infantry-entity |
| `khordadSam` | Iran | replacement | `aaEC` | `khordadMissile` | tier 0 (slot `aa`) | Complete |
| `mohajer6` | Iran | exclusive | — | `sadidBomb` ×4, fuel | air1 | Complete |
| `ghadir` | Iran | naval hull | — | `torpedo` ×2, battery | naval2 | Complete |
| `bulsae4` | North Korea | replacement | `tdEC` | `bulsaeMissile` | manoeuvre2 (slot `td`) | Complete |
| `koksan` | North Korea | exclusive | — | `koksanShell` (19 tiles) | fires2 | Complete |

Verified naming risks (not defects in behaviour):

- `pathfinder` is called a "Recon Team" but is a **wheeled vehicle**
  (`moveClass: 'wheeled'`), so it does not fill a foot-reconnaissance role.
- `ifvEC` is called "Amphibious IFV" but no amphibious movement exists; it
  crosses water only on a bridge.
- `kestrelTeam`, `spikeTeam`, `hedgehogTeam` and `taszar` are single entities
  representing a crew/team, consistent with the individual-entity model; they
  are not squads and must not be turned into squads.

---

## 2. Canonical building catalogue

### 2.1 Shared structures (39)

| ID | Name | Role | Mechanical effect / unlocks | Power | Gate | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `commandPost` | Command Post | HQ / victory objective | trains `engineer`/`harvester` when no factory; +0.4 req/s; material backstop | +50 | tier 0 | Complete |
| `strategicOps` | Strategic Operations Centre | Superweapon coordination | authorises national call-ins; no production | −20 | requires HQ + research | Complete |
| `barracks` | Field Barracks | Infantry production | `rifle`, `atgm`, `medic` | −8 | tier 0 | Complete |
| `factory` | Vehicle Factory | Vehicle production | `engineer`, `harvester`, `apc`, `recon`, `aa`, `tank`, `spg`, `recovery` | −15 | tier 0 | Complete |
| `refinery` | Material Refinery | Drop-off | 2 delivery bays, +0.1 req/s | −10 | tier 0 | Complete |
| `researchCentre` | Applied Research Centre | Research | one project at a time | −30 | requires factory | Complete |
| `airfield` | Forward Airfield | Air production / recovery | `fighter`, `interceptor`, `uav`; docks 4 fixed-wing + 1 temporary helo | −25 | air1 | Complete |
| `heliport` | Heliport | Rotary production / basing | `attackHelo`; docks 2 helo | −20 | air2 | Complete |
| `shipyard` | Naval Shipyard | Naval production / repair | `missileBoat`, `corvette`, `submarine`, `frigate` (+`navalSupport` via `producedBy`); water adjacency | −20 | naval1 | Complete |
| `powerPlant` | Turbine Plant | Power | +60 | +60 | tier 0 | Complete |
| `radar` | Radar Array | Detection / minimap | vision 15, minimap while powered | −12 | requires barracks | Complete |
| `samBattery` | SAM Battery | Static air defence | `samBattery` (air only) | −20 | requires factory | Complete |
| `mgNest` | Heavy MG Nest | Static anti-infantry | `heavyMg` | −6 | tier 0 | Complete |
| `atTurret` | Anti-Tank Gun | Static anti-armour | `atTurretGun` | −10 | tier 0 | Complete |
| `coastalBattery` | Coastal Battery | Static anti-ship | `coastalMissile` | −12 | requires factory + water | Complete |
| `bridge` | Road Bridge | Crossing | authored span, walkable, repairable, destructible | — | authored only | Complete |
| `relay` | Signals Relay | Capturable objective | +1.1 req/s, indestructible | — | authored only | Complete |
| `supplyDepot` | Forward Supply Depot | Capturable material objective | +2 mats/s, indestructible | — | authored only | Complete |
| `radarStation` | Radar Station | Capturable recon objective | `scanRadius` 22, minimap | — | authored only | Complete |
| `tenement` | Urban Tenement | Garrison strongpoint | garrison 4, 55% protection, 2 firing slots | — | authored only | Complete |
| `warehouse` | Brick Warehouse | Garrison strongpoint | 4 / 45% / 2 | — | authored only | Complete |
| `officeBlock` | Office Block | Garrison strongpoint | 5 / 50% / 3 | — | authored only | Complete |
| `freightShed` | Freight Shed | Garrison strongpoint | 5 / 45% / 2 | — | authored only | Complete |
| `civicHall` | Civic Hall | Landmark strongpoint | 6 / 60% / 3 | — | authored only | Complete |
| `foundryWorks` | Foundry Works | Landmark strongpoint | 5 / 50% / 2 | — | authored only | Complete |
| `ruin` | Ruined House | Garrison position | 2 / 35% / 1 | — | authored only | Complete |
| `chapel` | Village Chapel | Landmark observer | 3 / 50% / 2, vision 11 | — | authored only | Complete |
| `farmhouse` | Farmhouse | Rural strongpoint | 3 / 38% / 2 | — | authored only | Complete |
| `constabulary` | Constabulary | Urban strongpoint | 4 / 50% / 3 | — | authored only | Complete |
| `watchtower` | Fire Lookout | Observation post | 2 / 30% / 1, vision 13 | — | authored only | Complete |
| `schoolhouse` | Schoolhouse | Civic strongpoint | 4 / 40% / 2 | — | authored only | Complete |
| `apartmentBlock` | Apartment Block | Dense residential | 6 / 55% / 3 | — | authored only | Complete |
| `motelBlock` | Roadside Motel | Roadside strongpoint | 4 / 42% / 2 | — | authored only | Complete |
| `cinema` | Picture House | Landmark strongpoint | 5 / 45% / 2 | — | authored only | Complete |
| `bankHouse` | Bank House | Civic strongpoint | 4 / 58% / 2 | — | authored only | Complete |
| `stationHouse` | Rail Station | "Transport strongpoint" | 4 / 40% / 2, vision 7 | — | authored only | **Name implies transport; mechanically only a garrison shelter** |
| `autoGarage` | Garage Works | Industrial strongpoint | 3 / 45% / 2 | — | authored only | Complete |
| `coldStore` | Cold Store | Industrial strongpoint | 5 / 50% / 2 | — | authored only | Complete |
| `townhouseTerrace` | Terrace Row | Residential strongpoint | 3 / 45% / 2 | — | authored only | Complete |

### 2.2 National structures (10)

| ID | Nation | Variant of | Effect | Status |
| --- | --- | --- | --- | --- |
| `forwardPost` | Lithuania | `radar` | cheaper, shorter vision | Complete |
| `armourWorks` | Poland | `factory` | +40% HP, same production | Complete |
| `expeditionaryAirfield` | UK | `airfield` | cheaper/faster, same docks and production | Complete |
| `garrisonBarracks` | Finland | `barracks` | cheaper/weaker, same production | Complete |
| `kockumsYard` | Sweden | `shipyard` | tougher/expensive, same production | Complete |
| `longRangeSam` | Russia | `samBattery` | longer range, slower reload | Complete |
| `signalsBureau` | Belarus | `researchCentre` | faster research, lower HP | Complete |
| `bunker` | Hungary | `mgNest` | nearly double HP, same weapon | Complete |
| `noorBattery` | Iran | `coastalBattery` | cheaper/weaker, `noorMissile` | Complete |
| `entrenchedAtGun` | North Korea | `atTurret` | tougher, slower mount | Complete |

**No building provides passenger loading, landing, port or beach infrastructure.**
The shipyard builds and repairs hulls; it is not a port that loads troops.

---

## 3. Battlefield role matrix

Status key: **C** complete, **P** partial, **M** missing, **N/R** not required,
**D** needs a decision.

### A. Infantry

| Role | Status | Evidence / gap |
| --- | --- | --- |
| General-purpose rifle infantry | **C** | `rifle` / `rifleEC`; `rifle` weapon and armour multipliers |
| Anti-tank infantry | **C** | `atgm`, `hedgehogTeam`, `spikeTeam` |
| Anti-air infantry | **C** | shared `manpadsTeam` / `manpadsTeamEC` (`lightManpads`); Lithuania's longer-ranged `kestrelTeam` remains its national exclusive |
| Engineers / combat engineering | **P** | `engineer` is a tracked vehicle: builds, repairs, captures; no bridging, breaching, mine-clearing or obstacle construction |
| Medical support | **C** | `medic` heals one infantry at a time (`game.ts`); no medevac |
| Reconnaissance infantry | **M** | `recon` and `pathfinder` are vehicles; no foot scout |
| Snipers / specialist marksmen | **M** | none |
| Heavy weapons / infantry fire support | **P** | `atgm` only; no HMG/AGL team |
| Mortar / indirect infantry | **P** | `taszar` is Hungary-only; no shared mortar |
| Special operations / infiltration | **D** | none; decide whether the individual-entity model wants it |
| Detection / counter-recon | **P** | vision, radar, UAV, sonar; no dedicated ground sensor team |
| Garrison / building clearing | **P** | garrison and `ungarrison` exist; no explicit room-clearing action |
| **Infantry transport / mechanised deployment** | **M** | **no passenger state, command or capacity anywhere** |

### B. Land vehicles

| Role | Status | Evidence |
| --- | --- | --- |
| Main battle tank | **C** | `tank`, `tankEC`, `spearhead` |
| Light tank / recon vehicle | **P** | `recon`, `reconEC`, `pathfinder`, `sprut`; no light tank |
| Infantry fighting vehicle | **C** | `ifv`, `ifvEC`, `cv90`, `wilk` (fighting platforms) |
| Armoured personnel carrier | **M** | none |
| Tank destroyer | **C** | `td`, `tdEC`, `bulsae4` |
| Self-propelled artillery | **C** | `spg`, `spgEC`, `k9Thunder`, `heavyHowitzer`, `koksan` |
| Rocket artillery | **C** | `rocketArtillery`, `rocketArtilleryEC`, `mlrs` |
| Mobile indirect fire (mortar carrier) | **M** | none |
| Short-range air defence | **C** | `aa`, `aaEC`, `khordadSam` |
| Medium/long-range air defence | **P** | national `longRangeSam` only; no shared long-range system |
| EW / command vehicles | **M** | superweapon effects are off-map call-ins; no vehicle |
| Recon / surveillance vehicles | **C** | `recon` family, `sprut` |
| Engineering / obstacle clearing | **P** | `engineer` repairs/builds; no breach or clear |
| Recovery / towing | **P** | `recovery` repairs; no tow |
| Logistics / utility | **N/R** | harvester + engineer cover the economy; no fuel/ammo chain recommended |
| Mine clearing / laying | **M** | no mines at all |
| **Infantry transport / protected mobility** | **M** | none; all IFVs are non-transport |

### C. Fixed-wing aircraft

| Role | Status | Evidence |
| --- | --- | --- |
| Air superiority / interceptor | **C** | `interceptor`, `interceptorEC` |
| Multirole fighter | **P** | `gripen` is the only true multirole; shared `fighter` is strike |
| Ground attack / CAS | **C** | `fighter`, `fighterEC` |
| Bomber / heavy strike | **P** | `stormShadow` is a ground launcher, not an aircraft |
| Reconnaissance aircraft | **P** | `uav`/`deepReconUAV`/`mohajer6`; no fixed-wing recon |
| Electronic warfare aircraft | **M** | none |
| AEW&C / airborne surveillance | **M** | none |
| Maritime patrol / ASW aircraft | **M** | none |
| Transport aircraft | **D** | scale probably does not justify it; decide |
| SEAD / air-defence suppression | **M** | no anti-radar mission or weapon |

### D. Helicopters

| Role | Status | Evidence |
| --- | --- | --- |
| Attack helicopter | **C** | `attackHelo`, `attackHeloEC` |
| Armed reconnaissance | **P** | attack helo can scout; no dedicated armed scout |
| Utility helicopter | **C** | `transportHelo` |
| **Troop transport helicopter** | **C** | `transportHelo` — four infantry, landed boarding/unload |
| Medical evacuation | **M** | none |
| Anti-tank helicopter | **C** | `attackHelo` carries `atgm` |
| ASW / maritime support | **M** | no naval helicopter |
| Search and rescue / extraction | **M** | none |

**Facility constraints verified**, not assumed:

- `BUILDINGS.airfield.docks = { fixedWing: 4, helo: 1, heloTemporary: true }`;
  `heliport.docks = { fixedWing: 0, helo: 2 }` (`src/data/buildings.ts`).
- Capacity is enforced by `productionStatus` ("No free flight-line position
  (4/4)"), and a temporary pad cannot produce (`tests/aircraft-docks.test.ts`).
- There is **no permanent take-off lockout**: a hull that lands with every
  position occupied sets down on an authored holding point beside the field
  (`dockHoldPose`, `src/sim/docks.ts`), and take-off keeps its assigned berth
  while airborne. The Phase 5D transport helicopter uses the same berth rules;
  a battlefield landing never replaces its permanent berth.

### E. Naval forces

| Role | Status | Evidence |
| --- | --- | --- |
| Fast attack craft | **C** | `missileBoat`, `missileBoatEC` |
| Corvette | **C** | `corvette`, `corvetteEC`, `visby` |
| Frigate / destroyer | **P** | `frigate`, `frigateEC`; no destroyer class |
| Submarine | **C** | `submarine`, `submarineEC`, `ghadir` |
| Anti-submarine warfare | **P** | frigate sonar + `depthCharge`; no ASW aircraft/helo |
| Naval air defence | **P** | frigate `navalSam` only; `frigateEC` has none |
| Anti-ship warfare | **C** | `navalMissile`, `skiffMissile`, `noorMissile`, `coastalMissile` |
| Shore bombardment | **C** | `navalSupport` / `bombardmentGun` |
| Maritime reconnaissance | **M** | no naval scout aircraft |
| Mine warfare / mine countermeasures | **M** | none |
| Naval electronic warfare | **M** | none |
| Coastal defence | **C** | `coastalBattery`, `noorBattery` |
| **Landing craft** | **M** | none |
| **Troop transport vessel** | **M** | none |
| **Amphibious assault / beach landing** | **M** | no beaching, ramp, landing zone or embark/disembark |
| Naval support / repair | **P** | shipyard services hulls; `navalSupport` is bombardment, not repair |

### F. Defensive structures

| Role | Status | Evidence |
| --- | --- | --- |
| Bunkers / garrisons | **P** | `mgNest` + Hungary's `bunker`; authored shelters; no buildable bunker for most nations |
| Anti-tank positions | **C** | `atTurret`, `entrenchedAtGun` |
| Anti-air positions | **C** | `samBattery`, `longRangeSam` |
| Artillery / mortar positions | **M** | no static indirect-fire structure |
| Radar / surveillance | **C** | `radar`, `radarStation`, `forwardPost` |
| Command / communications | **P** | `commandPost` + `strategicOps`; no forward command post |
| Engineering / repair structures | **M** | no repair depot or field workshop |
| Field fortifications | **M** | no trenches, wire, sandbags |
| Barriers / obstacles / roadblocks | **P** | `bridge` is authored; no buildable obstacle |
| Minefields / countermeasures | **M** | none |
| Coastal defence | **C** | `coastalBattery` |
| Airfield / helicopter infrastructure | **C** | `airfield`, `heliport`, docks and servicing |
| Naval ports / landing infrastructure | **P** | `shipyard` builds/repairs; no port/landing pier |

### G. Economic and support infrastructure

| System | Status | Evidence |
| --- | --- | --- |
| Material economy | **C** | harvester, refinery, supply depot, HQ backstop |
| Requisition economy | **C** | relays, HQ/refinery trickle, captured objectives |
| Power grid | **C** | `powerPlant`, module effects, brownout |
| Repair | **P** | `engineer`, `recovery`; no repair structure |
| Medical | **P** | `medic` only; no hospital |
| Fuel / ammunition logistics | **N/R** | aircraft/hulls reload at their facility; adding a supply chain would change pacing for little gain |
| Personnel / transport logistics | **M** | this is the infantry-transport gap, not a separate economy |

---

## 4. Functional completeness matrix

| Capability | Status | Verification |
| --- | --- | --- |
| Movement classes and terrain | **C** | `MoveClass` foot/wheeled/tracked/naval/air; `isNavigable`; bridges walkable |
| Water access and coastal navigation | **C** | `shipyard.requiresWater`, `coastalBattery.requiresWater`; naval pathing suite |
| Road / bridge traversal | **C** | `BUILDINGS.bridge.walkable`; `tests/bridge.test.ts` |
| Air movement, hovering, landing | **C** | aircraft state, runway runs, docks, rotor spool |
| Collision and formation movement | **C** | existing pathing/stand clearance suites |
| Embarkation / disembarkation | **M** | no state, command, UI or test |
| Weapon compatibility and target lanes | **C** | `WEAPONS` target classes; `tests/combat.test.ts` |
| Armour interactions | **C** | armour multipliers per weapon |
| Range, line of sight, indirect fire | **C** | `hasLineOfSight`, `indirect`, `minRange` |
| Countermeasures / APS | **C** | `research.ts` upgrades; ability layer |
| Detection and stealth | **C** | vision, radar/sonar, submarine state, smoke |
| Garrison interactions | **C** | capacity, protection, firing slots, `garrison`/`ungarrison` |
| Combined-arms bonuses | **N/R** | none found in the simulation: roles interact through weapon target lanes, armour multipliers, vision and support units, not a bonus term |
| Production, queue, cost, build time | **C** | `productionStatus`, queues, power |
| Research gating and national inheritance | **C** | `requiredTechnologiesForUnit`, variant chains |
| Unlock presentation | **C** | research panel and production reasons |
| AI production of land/air/naval | **C** | `SLOT_BASE`, `slotDemand`, `airfield`/`heliport`/`shipyard` build plans |
| AI tactical use (defend, garrison, release) | **C** | `ai.ts` garrison release, defence priority suites |
| AI use of transport | **M** | nothing to use |
| Selection, orders, control groups | **C** | HUD/commands; no transport orders |
| Cargo / passenger presentation | **M** | no UI concept |
| Audio / voice / tooltips | **C** | unit voice sets and tooltips exist |
| Save / load | **C** | `entities: Entity[]` serialized wholesale; migrations |
| Authoritative simulation / snapshots / reconnect | **C** | command gate, projection, snapshot assembler |
| Transport commands over the network | **M** | `commandGate.ts` handles move/attack/stop/return/capture/garrison/ungarrison only |
| Scenario Forge / campaign placement | **C** | authored units/structures; campaign maps declare their own forces |

---

## 5. National roster assessment

Baseline: every nation inherits its alliance's 18 canonical slots plus shared
utility units; the three declared differences are a replacement, an exclusive and
a structure variant. Verified by `tests/national-roster-complete.test.ts`
(declarations, chains, isolation, trade-offs).

| Nation | Replacement | Exclusive(s) | Structure | Identity | Missing / counterplay risk |
| --- | --- | --- | --- | --- | --- |
| Lithuania | `pathfinder` | `kestrelTeam` | `forwardPost` | Recon screen, hidden MANPADS | No foot recon; MANPADS cannot fight ground; weak armour |
| Poland | `spearhead` | `wilk` | `armourWorks` | Armoured spearhead | Slower hulls; susceptible to ATGM stand-off |
| UK | `mlrs` | `stormShadow` | `expeditionaryAirfield` | Saturation + deep strike | Fragile airfield; Storm Shadow needs external spotting |
| Finland | `k9Thunder` | `spikeTeam` | `garrisonBarracks` | Territorial defence, long-range AT | Slow infantry; no shared AA infantry |
| Sweden | `cv90` | `gripen`, `visby` | `kockumsYard` | Mobile combined arms, littoral | Few missiles per airframe; thin naval hull |
| Russia | `heavyHowitzer` | `tosp` | `longRangeSam` | Siege artillery, thermobaric | Short-range TOSP; slow guns |
| Belarus | `deepReconUAV` | `sprut` | `signalsBureau` | Deep surveillance | Fragile eyes; weak armour |
| Hungary | `hedgehogTeam` | `taszar` | `bunker` | Fortified defence | Short missile range; no armour punch |
| Iran | `khordadSam` | `mohajer6`, `ghadir` | `noorBattery` | Unmanned strike, coastal ambush | No naval SAM; slow midget boats |
| North Korea | `bulsae4` | `koksan` | `entrenchedAtGun` | Siege fires, stand-off AT | Slow reloads; no air defence vehicle upgrade |

Assessment: differentiation is coherent and mechanically real for all ten —
every replacement changes a stat or weapon, every exclusive adds a capability
with a genuine trade, and every structure variant changes durability, cost or
reach. None of the ten has a **transport** identity, and none has a practical
counter to an airborne insertion because no insertion exists. Recommend a
**shared baseline transport** plus at most two national variants later, rather
than ten bespoke platforms.

---

## 6. Building and research unlock graph

Tier 0 units: `engineer`, `harvester`, `rifle`, `atgm`, `medic`, `recon`, `aa`,
`recovery`.
Tier 0 structures: `commandPost`, `barracks`, `factory`, `refinery`,
`powerPlant`, `mgNest`, `atTurret`, `radar`, `researchCentre`, `strategicOps`,
`samBattery`, `coastalBattery`.

```
manoeuvre1 ── tank, ifv            + recon smokescreen, emergency power,
   │                               advanced turbine, assembly line
   └─ manoeuvre2 ── td             + hullDown, apsBurst
fires1 ────── spg                  + fire preparation, radar relay net
   └─ fires2 ── rocketArtillery
air1 ──────── airfield, uav, interceptor  + flightline maintenance
   └─ air2 ── fighter, attackHelo, heliport + countermeasures
naval1 ────── shipyard, missileBoat, corvette + sonar sweep, harbour sonar
   └─ naval2 ─ frigate, submarine, navalSupport
```

National replacements inherit the canonical slot's technology. National
exclusives use `EXCLUSIVE_UNIT_TECH`: `kestrelTeam` manoeuvre1, `wilk`
manoeuvre2, `stormShadow`/`tosp`/`koksan` fires2, `taszar`/`spikeTeam` fires1,
`gripen` air2, `mohajer6` air1, `visby` naval1, `ghadir` naval2, `sprut` none.

Audit result: **no unreachable unit or orphaned unlock was found.** Every
registered unit resolves to a producing facility that is either tier 0 or
granted by a technology; every technology grants at least one effect or is a
declared strategic authority node; national variants inherit their family gate.
The only data smell is that `shipyard.productionList` omits `navalSupport` even
though `navalSupport.producedBy` names the shipyard; the roster layer resolves
the union, and `tests/naval-roster.test.ts` pins the result, but the two lists
should not be allowed to drift.

---

## 7. Infantry transport: dedicated gap analysis

> Phase 5B implemented the shared passenger-container foundation described
> here; Phase 5C shipped the APC and Phase 5D shipped the utility transport
> helicopter. See `docs/PHASE_5D_TRANSPORT_HELO.md`. The original absence notes
> below are retained as the historical audit record.

### 7.1 Verified absence

`UnitDef` has no capacity field; `Entity` has no passenger list; there is no
`transport`, `board`, `embark`, `load`, `unload` or `disembark` command in the
simulation, the HUD or `commandGate.ts`; `save.ts` serializes entities wholesale
and has no cargo record; `snapshotAssembler.ts` validates only harvester phases.
The words "transport" and "cargo" appear only in names/descriptions and the
harvester's visual load. **There is no general-purpose passenger system.**

### 7.2 Land transport — armoured personnel carrier

Recommended because it is the cheapest fix with the largest tactical effect:
infantry currently either walks or garrisons, so every advance is a walking
advance and every withdrawal is a casualty.

| Decision | Recommendation |
| --- | --- |
| Sharing | One shared APC baseline; optionally Poland/Russia national variants later |
| Capacity | 4 individual infantry entities |
| Eligible | `canGarrison` infantry: rifle, atgm, medic, and national infantry teams; no vehicles |
| Boarding | Order `board`; move within 2 tiles of the transport; transport must be stopped or below a slow threshold |
| While embarked | Passengers keep identity, owner, HP, veterancy; removed from collision, targeting and their own vision; transport's vision only |
| Passenger fire | **No** firing while embarked (keeps the APC a carrier, not a bunker) |
| Transport fire | May fire its own defensive weapon while loaded |
| Movement effect | Capacity does not change speed; loaded APC is slightly easier to hit (larger signature) |
| Destruction | Passengers take spill damage and die with the hull, or eject to the nearest safe tiles at low HP — **needs owner decision** |
| Transfer/capture | No transfer between transports in 5B; boarding an enemy transport impossible |
| AI | Load infantry when the front is more than N tiles away; unload before contact; never drive a loaded APC into ATGM range |
| Unload | `unload` at a clicked point; search outward for free tiles; refuse water/buildings/cliffs; never leave a passenger inside the hull if the transport dies |

Keep the APC distinct from the IFV: shared `ifv` stays a fighting platform with
no capacity unless a later, individually justified variant says otherwise.

### 7.3 Air transport — utility helicopter

| Decision | Recommendation |
| --- | --- |
| Sharing | One shared utility helicopter; national variant only where a real trade exists |
| Capacity | 4 infantry |
| Basing | **heliport only** (2 pads); airfield's single pad remains recovery-only |
| Boarding | Land or hover low; load within 2 tiles; requires a clear landing zone |
| Deployment | Land to unload (5D); hover-rope insertion deferred (needs a new rule and animation) |
| Vulnerability | Slow, unarmed; insertion is the risk the player chooses |
| Destruction | Same policy as the APC (decision needed) |
| Armament | Optional door gun at reduced capacity (e.g. 4 → 3); decide after 5C balance |
| AI | Insert infantry onto a flank or objective, extract a damaged squad, reinforce a threatened building; never hover over SAM coverage |

Do not model this as a fixed-wing variant: rotary uses the heliport, the
temporary pad and its own landing geometry.

### 7.4 Naval transport — landing craft

| Decision | Recommendation |
| --- | --- |
| Initial scope | **Small landing craft only** (capacity 4); larger assault shipping deferred |
| Why | One beach-capable hull delivers the amphibious option at the map scale MCA uses; a second, larger ship adds cost and AI complexity without a new decision |
| Loading | At a shipyard/coast; `board` in shallow water adjacent to land |
| Unloading | Beach landing: move to navigable shallow water, `unload` onto adjacent walkable land; refuse cliffs, buildings, deep water |
| Capacity | 4 infantry |
| Combat | Minimal self-defence; not a support ship |
| Destruction | Passengers die or are lost overboard (decision needed); no swimming |
| AI | Plan a beach landing only when a suitable undefended coast exists; otherwise use the shipyard for conventional hulls |
| Maps | Existing `isNavigable` + coast authoring can support this; verify each competitive map has a legal beach before shipping |

A dedicated troop transport ship and an amphibious assault ship are **not**
recommended for the first pass. They would duplicate the landing craft's job at
a scale the maps do not need.

### 7.5 Shared passenger architecture (recommended)

One system, three domain rules:

- **Data:** `transport?: { capacity, allowed: 'infantry', boardingRadius,
  requiresStopped, canFireEmbarked, unloadSpread, domain: 'land'|'air'|'naval' }`
  on `UnitDef`; `cargo?: { unitIds: number[] }` and `seat` on the transport
  `Entity`; `transportId` and `seat` on the passenger `Entity`.
- **State:** passengers remain entities (identity, owner, HP, veterancy) but are
  flagged `embarked`; they are excluded from collision, vision, targeting and
  selection in the world, and rendered only as cargo pips.
- **Commands:** `board`, `unload`, `unloadAll`; validated for ownership, range,
  capacity, eligibility, domain, terrain and transport state.
- **Damage:** damage to the transport does not hit passengers until destruction;
  on destruction apply the agreed policy (kill or eject) and place survivors
  deterministically on free tiles.
- **Fog:** enemy players see the transport, not its cargo; unloading reveals the
  passengers.
- **Persistence:** cargo ids/seat in `Entity`, validated in
  `snapshotAssembler.ts` and migrated in `saveMigrations.ts`; a save from before
  the feature loads with empty cargo.
- **Multiplayer:** authoritative on the room; `board`/`unload` rejected by
  `commandGate.ts` for the wrong owner, range, capacity or terrain; snapshots
  carry cargo ids; reconnect restores the same assignments.
- **AI:** transport demand, load/unload decisions, route avoidance of AA/ATGM,
  and no idle loaded transports.
- **UI:** capacity pips, load/unload buttons, cargo panel, tooltips, gamepad and
  mobile equivalents; selection of an occupied transport shows its passengers.
- **Rendering/audio:** passenger markers, ramp/door animation, rotor downwash,
  embark/disembark audio, destruction cue.

---

## 8. Critical gap list (ranked)

1. **No passenger/cargo simulation at all** — blocks every transport role and
   is the dependency for 5C–5E. *Critical.*
2. **No land infantry transport (APC)** — infantry cannot be projected under
   armour; every advance walks. *Critical to combined arms.*
3. **No air assault / airborne insertion** — `transportHelo` now carries four
   infantry, but rope insertion, air drops and full transport AI remain
   deferred. *Important, not a blocker for conventional air mobility.*
4. **No landing craft / beach deployment** — naval play cannot put troops
   ashore; "Amphibious IFV" is a name, not a capability. *Critical for naval
   combined arms.*
5. **No foot reconnaissance / forward observer** — `pathfinder` and `sprut` are
   vehicles; infantry has no stealthy eye. *Important.*
6. **No shared mortar team** — the shared MANPADS gap is closed, but `taszar`
   remains Hungary's exclusive and nine nations still lack infantry organic
   indirect fire. *Important.*
7. **No SEAD/EW/AEW/maritime-patrol aircraft** — the air game is strike,
   intercept and recon only. *Important, but a later phase.*
8. **No mines, obstacles, field fortifications or mine countermeasures** —
   defensive play is static turrets and authored shelters. *Optional.**
9. **No recovery towing or repair structure** — `recovery` repairs in place.
   *Optional.*
10. **No static artillery/mortar position** — indirect fire is vehicle-only.
    *Optional.*
11. **No ASW aviation** — ASW is frigate sonar and submarine ambush only.
    *Optional.*
12. **No transport aircraft** — likely outside the map scale. *Not required
    unless the owner wants airborne operations.*

---

## 9. Recommended Phase 5 structure

### 5B — Passenger transport simulation architecture (first, blocking)

- **Scope:** data model, entity state, `board`/`unload`/`unloadAll`, damage and
  destruction policy, save/load, snapshots, command gate, AI hooks, UI
  scaffolding, deterministic tile placement. No new unit.
- **Dependencies:** none beyond the current simulation.
- **Source areas:** `src/sim/types.ts`, `game.ts`, `save.ts`,
  `saveMigrations.ts`, `src/multiplayer/commandGate.ts`, `snapshotAssembler.ts`,
  `projection.ts`, `src/ui/hud.ts`, `src/sim/ai.ts`.
- **Data:** `TransportDef`, `cargo`/`seat`/`transportId`.
- **Simulation:** embark/disembark, exclusion from collision/targeting/vision,
  destruction spill, deterministic placement.
- **UI/rendering:** cargo pips, commands, selection panel, animations.
- **AI:** API to ask "is this unit loaded", "find a transport", "unload here".
- **Multiplayer/persistence:** authoritative validation, snapshot fields,
  reconnect.
- **Tests:** capacity, ownership, range, terrain, destruction, save round-trip,
  command-gate rejection, snapshot projection.
- **Risks:** stranding passengers, double-occupancy, desync, AI deadlock.
- **Exclusions:** no new units, no balance changes.

### 5C — Land infantry transport

- **Scope:** shared APC (capacity 4), national variant only if justified.
- **Dependencies:** 5B.
- **Source areas:** `src/data/units.ts`, `buildings.ts` (factory list),
  `research.ts` (gate), `src/render/unitMeshes.ts`, AI transport logic.
- **Data:** APC definition, `transport` block, production/research entry.
- **Simulation:** loading/unloading under fire, transport damage.
- **UI:** APC cargo display.
- **AI:** load/unload and route avoidance.
- **Tests:** embark/disembark in combat, destruction, AI use, MP.
- **Risks:** APC becoming a free bunker; keep passenger fire off.
- **Exclusions:** no IFV capacity by default.

### 5D — Air-mobile transport

- **Scope:** shared utility helicopter, heliport-based, land-to-unload.
- **Dependencies:** 5B, 5C patterns.
- **Source areas:** `units.ts`, `buildings.ts` heliport list, `docks.ts`,
  `game.ts` aircraft lifecycle, `research.ts`.
- **Data:** transport helo, capacity 4, optional door gun decision.
- **Simulation:** landing zone validation, hover/land unload, destruction.
- **UI:** LZ feedback, cargo pips.
- **AI:** insertion/extraction.
- **Tests:** heliport capacity, LZ refusal, destruction, save/MP.
- **Risks:** pathing into cliffs/buildings; SAM lethality; pad contention.
- **Exclusions:** no fixed-wing transport, no rope insertion in 5D.

### 5E — Naval landing and amphibious transport

- **Scope:** shared landing craft (capacity 4), beach loading/unloading.
- **Dependencies:** 5B; 5C for shared infantry eligibility.
- **Source areas:** `units.ts`, `shipyard` list, `src/sim/terrain.ts`
  (`isNavigable`), `src/sim/pathfinding.ts`, map data.
- **Data:** landing craft, shallow-water/beach rules.
- **Simulation:** beaching, ramp unload, refusal on cliffs/buildings.
- **UI:** beach target feedback.
- **AI:** amphibious planning only when a coast is viable.
- **Tests:** beach unload, blocked tiles, destruction, map audit.
- **Risks:** maps without a legal beach; naval pathing near shore.
- **Exclusions:** no assault shipping, no swim mechanics.

### 5F — AI, UX and integration

- **Scope:** transport demand, load/unload tactics, HUD, tooltips, gamepad,
  save/load UX, Scenario Forge validation, campaign compatibility.
- **Dependencies:** 5C–5E.
- **Tests:** AI employment suites, UI shell tests, save/reconnect.
- **Risks:** AI wasting transports or passengers; UI overload.
- **Exclusions:** no new roster content beyond transport.

### 5G — Roster completion verification

- **Scope:** role-coverage matrix as tests, balance pass, regression suite,
  documentation.
- **Dependencies:** 5B–5F.
- **Tests:** every role has a functional test, not just an id assertion.
- **Exclusions:** no new capabilities.

**Other critical capability recommendation:** infantry reconnaissance and a
shared mortar team are real gaps but do not block transport. The shared MANPADS
team has since shipped. Recommend the remaining roles for a later content phase;
mines, fortifications, SEAD and ASW aviation should be deferred.

---

## 10. Test coverage recommendations (functional, not catalogue)

1. `transport-boarding.test.ts` — capacity, eligibility, ownership, range,
   stopped requirement; a full transport refuses a fifth passenger.
2. `transport-unload.test.ts` — unload placement avoids water, buildings,
   cliffs; a blocked LZ returns the transport rather than deleting passengers.
3. `transport-destruction.test.ts` — passengers die or eject exactly once; no
   orphan entities; deterministic placement.
4. `transport-persistence.test.ts` — save/load restores cargo, seats and owner;
   a pre-feature save loads with empty cargo.
5. `transport-multiplayer.test.ts` — command gate rejects foreign, out-of-range
   and over-capacity board/unload; snapshot round-trip; reconnect.
6. `transport-ai.test.ts` — AI loads, moves, unloads and does not idle loaded;
   it avoids AA/ATGM envelopes.
7. `apc-combat.test.ts` — passengers cannot fire while embarked; the APC can;
   damage spill behaves as specified.
8. `helo-insertion.test.ts` — heliport capacity, LZ validation, temporary pad
   remains recovery-only, no permanent lockout.
9. `landing-craft.test.ts` — beaching, ramp unload, deep-water refusal, map
   beach audit.
10. `roster-role-coverage.test.ts` — every role in this audit is either
    implemented with a functional assertion or explicitly marked
    not-required/needs-decision, so a catalogue entry alone cannot pass.

---

## 11. Verified facts vs recommendations vs decisions

**Verified (source-read):** counts, ids, nations, gates, weapons, docks,
capacity, AI production of air/naval, garrison model, command set, save shape,
absence of passenger state.

**Recommendations (not implemented):** APC capacity 4, transport helo capacity
4, landing craft capacity 4, no passenger fire, heliport-only basing, beach-only
naval deployment, shared baseline plus at most two national variants.

**Decisions needed before 5B:**
1. On transport destruction, do passengers **die** or **eject at low HP**?
2. May passengers fire while embarked? (Recommend no.)
3. Does the transport helo get a door gun at reduced capacity?
4. Is the APC shared only, or shared + national variants?
5. Is infantry recon / shared mortar in Phase 5 or deferred? (Shared MANPADS was
   approved and shipped in the Stage A arsenal expansion.)
6. Are mines/fortifications/SEAD/ASW aviation explicitly out of scope?

**Not audited in depth:** campaign-specific roster restrictions
(`tests/campaign-restrictions.test.ts` enforces something specific) and the
balance consequences of adding capacity. Both should be checked in 5C.
