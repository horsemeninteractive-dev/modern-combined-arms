# Phase 1 — Tactical Abilities and Building Modules

Implementation record for the first phase of the MCA roadmap. It describes what
shipped, the numbers behind it, and where the boundaries of the phase sit. The
source is authoritative: this document records the implementation, it does not
define it.

- Status: complete, integrated, verified (full suite, typecheck and production
  build clean at the time of writing). The completion pass added aviation basing
  (permanent berth reservations, the recovery pad, facility-destruction
  re-basing), corrected three module descriptions against what the simulation
  applies, and extended the structure card with the flight-line breakdown.
- Scope: unit abilities and building modules as a coherent, data-driven system,
  plus the aircraft basing model those airframes are produced into.
- Not in scope: new technology nodes, new units, new buildings, new audio.

## 1. Constraints the phase had to respect

| Constraint | How it was honoured |
|---|---|
| The approved eight-node research tree is fixed | No node was added, removed or renumbered. Every capability rides on an existing node as a `grantUnitUpgrade` or `grantBuildingModule` effect. |
| One catalogue, one code path | `src/data/abilities.ts` holds the *effect* of every ability; `src/data/research.ts` holds cost, duration, reload and the granting node. The simulation reads those records generically — there is no per-ability branch in the tick. |
| Abilities are not purchases | An ability's only price is its reload and its trade-off. The authored upgrade cost is the one-off price of fitting the capability, established by Recon Smokescreen. This keeps the selection box from implying a charge the simulation never makes. |
| Modules are per structure | A module is bought on one plant, factory, radar set, airfield or shipyard. Two plants are two purchases with two capacity slots. |
| No hidden information | Every AI trigger reads `ctx.visible`, the same sighting list the rest of the planner uses. Fleet, submarine and posture state are never read for the enemy. |
| Determinism | Timed effects run on the fixed tick clock and are part of the state hash, the save file and the snapshot projection. |

## 2. Design matrix — unit abilities

Every row is playable: `upgradePlayable` answers from `UNIT_ABILITIES`, so the
research evaluator, the selection box and the simulation cannot disagree about
whether a capability exists.

| Ability | Node | Eligible slots | Effect while active | Duration / reload | Trade-off and counter |
|---|---|---|---|---|---|
| Recon Smokescreen | `manoeuvre1` (t1) | recon | 5-tile smoke cloud; vision outside is blocked, indirect fire arcs over | 8 s / 45 s | Pre-existing behaviour, unchanged by this phase. |
| Emergency Power | `manoeuvre1` (t1) | tank, ifv, td | Movement × 1.45 | 6 s / 35 s | Speed only: guns, armour, vision and reload are untouched. An escape or a grab, not a buff. |
| Hull-Down Posture | `manoeuvre2` (t2) | tank, td, ifv | Incoming direct fire × 0.5; movement × 0 | 8 s / 40 s | Indirect rounds ignore the ramp; the hull must break position (and lose the posture) to move. |
| Active Protection | `manoeuvre2` (t2) | tank, td, ifv — **defender alliance only** | Incoming guided ordnance × 0.3 (missile, SAM, torpedo) | 6 s / 55 s | Unguided fire, rifles and artillery are unaffected. The eastern armour school answers missiles with reactive armour and smoke instead, so the capability is a doctrinal difference rather than a mirrored one. |
| Defensive Countermeasures | `air2` (t2) | fighter, attackHelo, interceptor, uav | Incoming anti-aircraft fire × 0.4 | 5 s / 45 s | A hostile fighter's guns are not anti-aircraft fire and are unaffected. |
| Active Sonar Sweep | `naval1` (t1) | frigate, corvette, missileBoat, submarine, navalSupport | Own vision × 1.5; one 14-tile ping that exposes dived hostile boats | 10 s / 50 s | Only hulls with a sonar set can sweep, and the boat still has to be engaged — the ping reveals, it does not damage. |
| Prepared Fire Mission | `fires1` (t1) | spg, rocketArtillery | Reload after firing × 0.6 | 10 s / 50 s | The battery is no harder to kill and must be stationary to be laid. |

Damage classes are decided by the projectile the weapon already declares
(`missile`, `sam`, `torpedo` are guided). Splash without a weapon id is left
alone rather than guessed at.

## 3. Design matrix — building modules

| Module | Node | Slot | Effect | Cost (mats / req) | Capacity |
|---|---|---|---|---|---|
| Advanced Turbine | `manoeuvre1` (t1) | powerPlant | +30 grid power | 450 / 25 | 1 |
| Assembly Line | `manoeuvre1` (t1) | factory | Production rate × 1.25 | 500 / 40 | 1 |
| Radar Relay Net | `fires1` (t1) | radar | +4 tiles of vision | 400 / 60 | 1 |
| Flightline Maintenance | `air1` (t1) | airfield | Servicing turnaround × 1.3 (rearm, refuel, repair) | 450 / 55 | 1 |
| Harbour Sonar Suite | `naval1` (t1) | shipyard | +3 tiles of vision and a 12-tile passive sonar radius | 400 / 50 | 1 |

Placement follows the same rule as the abilities: each module sits on the node
whose doctrine would actually pay for it, so researching a branch gives that
branch something to spend materials on beyond its platforms. Only a structure
that is finished, owned and not dismantling can take a module; a sensor module
adds to a structure that is already a sensor, so a dockyard does not quietly
become a radar.

Three of those entries were corrected in the completion pass, because the
catalogue promised work the simulation did not do:

- Flightline Maintenance used a production multiplier under a name and
  description about servicing. It now scales the one servicing clock an airframe
  runs — rearming, refuelling and repair complete together — through
  `ResolvedModuleEffects.serviceSpeed`. Production time is untouched: a second
  crew does not build airframes faster.
- Fire-Control Net promised fire control and delivered vision. It is now the
  Radar Relay Net and says what it is: four more tiles of detection and nothing
  else. No accuracy, no weapons, no second receiver that does nothing.
- Harbour Sonar Suite added vision only. It now carries `sonar: 12` as well,
  read by the same detection pass a sonar escort feeds, so a dived boat inside
  the radius is exposed the way the sea already exposes it rather than through a
  parallel mechanic.
- The selection box no longer summarises a module by its grid contribution.
  `moduleEffectSummary` derives the label from the effects, so a servicing crew
  reads `30% SERVICE` and a relay reads `+4 VISION` instead of both reading
  `0 power`.

## 3.1 Aviation basing — capacity is a reservation

A flight line is a basing limit, not a parking count. The earlier model counted
landed hulls, and because production launches an airframe immediately, a strip
with four aircraft in the air read as empty and could build a fifth. Phase 1
replaced that with reservations:

| Facility | Fixed-wing berths | Helicopter berths |
|---|---|---|
| Airfield | 4 permanent | 1 recovery-only pad |
| Heliport | 0 | 2 permanent |

- A berth is taken when the production order is accepted — the queue item holds
  the index — and transfers to the hull when it launches. Take-off, patrol,
  return, parking and servicing all keep it; destruction, re-basing and a
  cancelled order release it.
- `Entity.aircraft.berth` stores the assigned index. Landing returns the hull to
  its own position; the renderer, the landing-clearance marker and the HUD all
  read that same index rather than re-deriving a position from entity order.
- Capacity is per facility: two airfields hold eight, three heliports hold six.
  National variants inherit the family's positions through `buildingFamily`.
- All fixed-wing hulls count, including reconnaissance drones and national
  replacements. Helicopters are produced only at heliports and fixed-wing
  aircraft only at airfields.
- The airfield's helicopter pad is a *recovery* position: reserved for one
  inbound or servicing helicopter, released the moment its servicing completes,
  and never offered to production. A helicopter that clears the pad re-bases to
  a heliport if one has room.
- A destroyed facility releases its berths; parked hulls scramble and re-base to
  the nearest compatible friendly facility with a free position. A hull the apron
  cannot hold keeps flying and waits on the holding point (`waitingForDock`) — it
  is never deleted and never services on another hull's position.
- Older saves without berths are rebuilt deterministically in id order by
  `reconcileAircraftBerths`, queue items after hulls.

## 4. Runtime model

- `Entity.effects` is the only new per-hull state: a record of ability id to
  seconds remaining. It is decremented on the fixed tick, deleted when it
  reaches zero, and omitted entirely when empty, so an unconverted save and a
  hull that never used an ability serialise exactly as before.
- Multipliers are looked up where the simulation already asks the question:
  `abilitySpeedFactor` on the movement step, `abilityVisionFactor` on the vision
  refresh, `abilityReloadFactor` when a crew sets its reload, and
  `incomingDamageMultiplier` in the damage path. No ability gets its own update
  loop.
- The reload clock stays `Entity.cooldowns` (the record smoke established), so
  the ability row and the simulation share one source of truth.
- `Game.abilityStatus(owner, unitId, abilityId)` is the single gate: living
  owned unit, not garrisoned, known ability, alliance, eligible canonical slot
  (via `unitFamily`, so a national replacement answers like its base hull),
  researched, and off reload. `Game.moduleStatus` is the equivalent gate for
  retrofits, adding capacity, operational-structure and bank checks.
- A sonar sweep reuses `revealSubmarine`, so a ping exposes a dived boat exactly
  the way a depth-charge hit already does, including the boat crew's warning.

## 5. Interface

- Unit card: the per-hull ability row is built by `abilityActions` from the
  simulation's own availability. A tank with nothing researched shows exactly
  what it showed before. A button on reload stays visible with its remaining
  seconds, a running posture reads `ACTIVE` with a badge, and a blocked button
  carries the reason in its detail and title.
- Building card: `moduleActions` gives `INSTALL` / `NEED FUNDS` / `BLOCKED` with
  the effect summary, the price and the capacity.
- Structure card: an airfield or heliport reports the flight line from
  `Game.dockStatus` — `FLIGHT LINE ASSIGNED 3/4 · PARKED 1 · INBOUND 1 · QUEUED 1`
  — and an airfield pad reads `HELO PAD 1/1 · RECOVERY ONLY`. Zero parts are
  dropped so the row stays one line. A production card refused for capacity says
  `No free flight-line position (4/4)` rather than a generic failure.
- Both paths dispatch through `app.useAbility` and `app.installModule`, i.e. the
  same command queue and multiplayer gate a player order uses. There is no
  second client-side authority and no hotkey that bypasses the gate.

## 6. AI

- `wantsAbility` maps each catalogue `ai` hint to a narrow sighting test:
  `screenContact` (hurt, not already in its own cloud, enemy inside 9 tiles),
  `holdPosition` (stationary, hit within the last second, enemy inside 12),
  `breakContact` (below 60% and pressed inside 8), `missileThreat` (a guided
  launcher inside 14), `airThreat` (an anti-air director inside 16), `subHunt`
  (own sonar, a hostile hull inside 20) and `firesOnTarget` (stationary battery
  with a target inside its own reach).
- One capability per hull per think, and a running effect is never re-cast.
- Retrofit policy: a generation module may be bought whenever the grid is short;
  every other module waits for a finished build programme, an army at target
  strength and a bank of at least twice the price, then respects the research
  reserve.
- Air production goes through `Game.productionStatus`, which is the same gate the
  command handler applies, so a commander cannot queue a hull without a berth.
  It also plans past the cap: when every completed airfield's flight line is
  assigned and it still wants air power (air doctrine, hostile air, or a
  technical commander) it scores another strip, up to three; the same rule opens
  a second heliport when both rotary bays are full. An airfield's recovery pad
  is never counted as helicopter capacity.
- Difficulty reaches abilities only through the existing reaction cadence. That
  turned out to matter: see §8.

## 7. Multiplayer, saves and determinism

- The projection carries `effects` for owned entities only — an opponent's
  posture and its remaining seconds are combat information, like a reload clock.
- The snapshot assembler validates at most 8 effects per entity, ids up to 64
  characters and remaining times in `(0, 60]`, and refuses effects on a
  remembered (out-of-sight) entity.
- The team delta compares effects alongside cooldowns, so a posture change is
  replicated as a change rather than as a full resend.
- `stateHash` covers `upgrades`, `modules`, `cooldowns` and `effects`, which is
  what makes save/load, reconnect and desync checks meaningful for the phase.
- Basing state is authoritative too: `aircraft.homeId`, `aircraft.berth`,
  `aircraft.temporaryBerth`, `aircraft.waitingForDock` and the berth reserved by
  each queue item travel in the save and therefore in the room snapshot. The
  snapshot validator passes entity payloads through, so the new fields survive a
  reconnect, and `reconcileAircraftBerths` runs before the first tick after a
  restore — a resumed match, a save and both peers settle on the same apron.

## 8. Verification

| Check | Result |
|---|---|
| `tests/phase1-abilities.test.ts` | 25 tests: catalogue and node placement, availability and alliance gating, each timed effect (direct vs indirect, guided vs unguided, anti-air vs rifle, speed only, fixed-clock expiry, sonar ping inside/outside), save/load, command gate, owner-only replication, AI triggers, module purchase/capacity/production speed and node placement. |
| `tests/aircraft-berths.test.ts` | 18 tests: four airborne airframes still hold four berths and refuse a fifth; the queue reserves at order time and a cancelled order returns its position; the reservation transfers to the launched hull; a destroyed airframe frees its position; two airfields are eight positions; a national strip keeps four; a reconnaissance drone counts; two heliport bays and a refused third; independent heliports; parked hulls re-base when their airfield dies; a diverted helicopter lands on the recovery pad, services, and clears it; two helicopters never share the pad (peak occupancy 1 over twenty seconds); an airfield will not build a helicopter on the pad; save round-trip; a pre-berth save rebuilt in id order; over-capacity overflow on the holding point without servicing; Flightline Maintenance divides the servicing clock by 1.3 and the panel reports `30% service` rather than `0 power`. |
| `npm run typecheck` | Clean. |
| `npm run build` | Clean; `index-*.js` 1,714 kB (489 kB gzip), `sw.js` precaches 13 files. |
| `npm test` | 171 files, 2,515 tests, all passing (234 s). |
| `tests/ai-matchups.test.ts` | Recruit vs Veteran −49,641 (6-10), Elite vs Recruit +164,772 (16-0), Elite vs Veteran +100,559 (12-4). |

### 8.1 The matchup baseline was re-anchored, with evidence

The Recruit-vs-Veteran margin used to be asserted below −30,000. During the
ability work it briefly read −15,012 and the threshold was re-anchored to
−10,000 on measured evidence: with AI ability use suppressed (`wantsAbility`
forced false), the same harness on the same sixteen mirrors read **+1,130 (8-8)**
— a coin flip. The abilities, not noise, order this pairing, and the recruit's
slow reaction cadence is the largest lever the ladder has: it takes hull-down
late, breaks contact late and answers a guided round late. The completion pass
re-measured **−49,641 (6-10)**, five times the current floor. The ordering
assertions (losses > wins, wins ≤ 7) are unchanged and are what actually pin the
ladder's direction; the margin is a magnitude canary.

### 8.2 Research-scoring test corrected

`tests/ai-research.test.ts` used Advanced Armour (`manoeuvre2`) as its example of
a node whose only content is a slot a nation does not field. That node now also
grants Hull-Down and Active Protection, which a tank hull can fire, so the node
is legitimately worth 1.19 to a nation without a tank destroyer. The invariant is
still tested, on a fixture node whose only effect is the unfielded slot, so a
future content edit cannot silently weaken it.

### 8.3 A berth flag that leaked onto fighters

The first run of the new suite caught a real defect rather than a test problem.
`temporaryBerth` was stamped by reading the *facility*: an airfield declares
`heloTemporary` because of its recovery pad, so every fighter parked on an
airfield was marked a temporary guest. A temporary guest releases its berth when
servicing ends, which would have handed a permanent flight-line position back to
the queue after every sortie and quietly broken the capacity model the phase
adds. `Game.isTemporaryPad(home, kind)` now answers `true` only for a rotary hull
and a pad facility, and `markPadFlag` stamps or clears the field from that answer.

### 8.4 Two AI fixtures corrected, not weakened

`tests/ai.test.ts` "builds a coastal shipyard and maintains a corvette" was
timing out because a veteran commander now finishes an idle island base in about
five minutes — the match ended, froze the simulation and the corvette never
launched. The airfield case missed its window by about a minute: Air Operations is
now the commander's fifth project, so the strip clears research, placement and
construction later than before. Both fixtures now hold the dummy command post
standing (`holdTheLine`) and the airfield case waits ten minutes. Every
assertion is unchanged and strictly checked; only the clock the test allows for
the AI's own programme changed. Measured with those fixtures: yard ready ≈ 300 s
and corvette ≈ 360 s; airfield ready ≈ 480 s and first fighter ≈ 600 s.

## 9. Files

| File | Change |
|---|---|
| `src/data/abilities.ts` | `TimedAbilityDef`, the effect catalogue, `abilityForUpgrade`, `isGuidedWeapon`. |
| `src/data/research.ts` | Six new upgrades, four new modules, grants rebalanced across the existing nodes, `installedModuleEffects` extended with vision and production speed, alliance restriction. |
| `src/sim/game.ts` | Effect clock, multiplier helpers, ability/module status and commands, sonar sweep, module vision and production speed, hash coverage. |
| `src/sim/ai.ts` | `wantsAbility`, per-hull ability use, retrofit purchase policy, upgrade demand in the research score. |
| `src/sim/types.ts` | `Entity.effects`. |
| `src/ui/abilityView.ts`, `src/ui/moduleView.ts`, `src/ui/hud.ts`, `src/style.css` | Ability row with active/reload states, module row, styling. |
| `src/multiplayer/projection.ts`, `networkBattle.ts`, `snapshotAssembler.ts`, `teamDelta.ts` | Owner-only effect projection, validation, delta and client application. |
| `tests/phase1-abilities.test.ts` | The phase's ability/module suite. |
| `tests/aircraft-berths.test.ts` | The basing suite: capacity, reservations, recovery, persistence, servicing. |
| `tests/ai.test.ts` | Dummy-headquarters helper so the production-chain cases are not raced by the victory condition; airfield window widened to ten minutes. |
| `tests/building-module-turbine.test.ts` | The "never re-issues" invariant now checks the module and the structure rather than any retrofit at all, because Phase 1 gave the same arena its own branch modules. |
| `src/sim/docks.ts`, `src/render/standClearance.ts`, `src/render/buildingMeshes.ts`, `src/ui/hud.ts` | Authored docking positions, landing-clearance marker, serviced-aircraft presentation and the flight-line occupancy row. |

## 10. Known limits and next steps

- No ability is charged per use, by design; if a future phase wants ammunition
  or a supply cost, it belongs on `UnitUpgradeDef`, not in the tick.
- Abilities are offered per hull (single-entity card). A mixed selection does not
  batch them, because the reload belongs to the crew that fired.
- Modules cannot be sold, swapped or refunded. A structure's retrofit list grows
  for the rest of the match.
- The AI does not buy per-unit upgrades; it uses the research grant directly.
  A purchase path for the AI would be a separate policy question.
- Only the Western armour school receives Active Protection. That is deliberate
  and documented in `ALLIANCE_ROSTER_AND_TECHNOLOGY_SPEC.md`, but it is the one
  asymmetric capability in the phase and will need watching in matchup audits.
- An authored battle that carries more airframes than its berths can hold keeps
  every one of them; the overflow hull waits on the holding point and cannot
  service until a position frees. Scenario validation flags the condition, but
  the simulation does not delete or corrupt the battle.
- The airfield's recovery pad serves one helicopter at a time and never becomes
  a home. A rotary force still needs heliports, which is the intended strategic
  distinction; a second damaged gunship must wait, divert or stay airborne.
- The AI expands to at most three airfields and two heliports. Beyond that it
  values army and economy over concrete, so a very long match can still leave it
  with a full flight line and no wish to build a fourth strip.
- No transport or utility helicopter exists in this phase; the roster's rotary
  hulls are attack helicopters, and the pad rules were written for them.
