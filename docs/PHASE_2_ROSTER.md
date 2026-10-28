# Phase 2 — Shared Combined-Arms Baseline

Status: implemented on the current working tree. This document describes the
shared roster all six nations resolve to. National additions, exclusions and
substitutions remain empty until the national-specialisation phase.

## What existed before Phase 2

Both alliances shared the same registered content:

| Role | Unit / structure |
| --- | --- |
| Construction / capture | `engineer` |
| Line infantry | `rifle` |
| Anti-armour infantry | `atgm` |
| Infantry support | `medic` |
| Main battle tank | `tank` |
| Reconnaissance | `recon`, `radar`, `radarStation` |
| Mobile air defence | `aa` |
| Economy | `harvester`, `refinery`, `supplyDepot` |
| Strike aviation | `fighter` |
| Naval combatant | `corvette` |
| Static defence | `mgNest`, `atTurret`, `samBattery` |
| Air / naval bases | `airfield`, `shipyard` |

The verified gaps were indirect fire, air-to-air combat, reconnaissance
aviation, field recovery, dedicated coastal defence and mechanised transport.

## Added shared content

All entries are ordinary `UnitDef`, `BuildingDef` and `WeaponDef` records with
stable ids. They are included in both alliance baselines and therefore resolve
for all six nations through `resolveRoster`.

| Id | Name | Role | Produced by | Cost | Counter / vulnerability |
| --- | --- | --- | --- | --- | --- |
| `spg` | Self-Propelled Howitzer | Indirect fire | `factory` | 620 M / 60 R | Outranges static guns and garrisons; minimum range 4 tiles, slow, thin armour, cannot fire while moving, needs a spotter |
| `recovery` | Field Recovery Vehicle | Repair / recovery | `factory` | 420 M / 25 R | Restores nearby vehicles at 18 HP/s and 0.45 M/HP; unarmed, cannot heal infantry or structures, must stand still |
| `interceptor` | Interceptor | Air superiority | `airfield` | 700 M / 160 R | Six air-to-air missiles; cannot attack ground or naval targets; SAM/AA and its own fuel/ammo recovery limit it |
| `uav` | Recon UAV | Reconnaissance aviation | `airfield` | 240 M / 35 R | 22-tile vision and long endurance; unarmed, fragile, cannot spot for itself once shot down |
| `coastalBattery` | Coastal Battery | Static anti-ship defence | Engineer-built | 480 M / 40 R | 16-tile anti-ship missiles; naval targets only, immobile, needs a buildable coastline, vulnerable to ground assault |

New weapons: `howitzer` (indirect, min range, heavy splash), `airMissile`
(air targets only) and `coastalMissile` (naval targets only).

## Production progression

- **Opening:** existing rifle, ATGM, medic, engineer, recon, tank and AA paths
  are unchanged.
- **Mid game:** the factory adds `spg` for breaking static defences and
  `recovery` for sustaining a vehicle force. The airfield adds `interceptor`
  as a counter to hostile air and `uav` as a cheap spotter.
- **Late game:** a powered airfield can support a mixed strike/interceptor/drone
  wing; a coast can add `coastalBattery` to deny naval approaches. No new
  research building or upgrade tree was introduced in this phase.

Every new unit has exactly one production path and no prerequisites beyond the
existing facility and power rules. `spg` and `recovery` are factory units;
`interceptor` and `uav` are airfield units. `coastalBattery` is a normal
engineer-placed structure under the defence tab.

## Simulation support

### Indirect fire

`WeaponDef.indirect` marks a weapon that does not require line of sight.
`WeaponDef.minRange` prevents it firing at point-blank targets. The firing team
must still have the target visible, so radar, a land scout or a UAV is required.
Shells are non-homing, land at the aimed coordinates, use the normal splash and
armour-multiplier damage path, and follow a visible ballistic arc. A howitzer
holds its position rather than chasing a target inside its minimum range, and
cannot fire while moving.

### Field recovery

`UnitDef.repair` defines a passive repair radius, rate and material cost. A
stationary recovery vehicle chooses the most damaged friendly mechanical land
unit in range, repairs it over time and deducts materials from its owner. It
resumes the same job after save/load through `Entity.repairTargetId`. Infantry
remain the medic's role and structures remain the engineer's role.

### Air superiority and reconnaissance

`interceptor` and `uav` use the existing airfield, fuel, rearm and home-aircraft
loop. The interceptor's `airMissile` only targets `air`; the strike fighter's
`strikeMissile` still cannot target aircraft. All aircraft are visible over
forest concealment and only auto-engage when explicitly ordered, preventing
suicide sorties. UAVs use their 22-tile vision to reveal ground for the army,
artillery and the AI's own targeting.

### Coastal defence

`coastalBattery` reuses placement's `requiresWater` rule, the static turret
traversal path and the normal projectile/damage model. Its `coastalMissile` has
`targets: ['naval']`, so it is a dedicated sea-denial asset rather than another
general-purpose AT gun.

## AI integration

- Airfields produce a UAV for reconnaissance and an interceptor when hostile air
  is known; strike fighters retain their ground-attack sorties.
- A factory produces a recovery vehicle after one of its own vehicles has
  actually been damaged, not as an opening purchase.
- Indirect fire is bought after contact identifies a static defence or a
  garrisonable strongpoint, and the howitzer uses the existing attack and
  auto-engagement paths.
- A coastal battery is considered when the AI has water access and has seen a
  hostile naval unit.
- Recovery, artillery and drones use the same deterministic production,
  targeting, pathfinding and command queues as the existing roster.

## Compatibility and scope

- `baltic` and `expeditionary` still resolve to the shared baseline. Nation ids
  still resolve through Phase 1's roster contract.
- Existing maps and saved battles load unchanged. New entities use optional
  save fields, and lobbed projectiles are ordinary serialised projectiles.
- No faction-selection UI, national production gating, upgrade tree, new
  alliance baseline or national unit was added.
- **Deferred:** mechanised transport / IFV. The simulation still has no
  passenger, load/unload or transported-unit state; adding it would be a
  separate subsystem rather than a single unit definition. The baseline keeps
  its infantry mobility unchanged until that phase.
- **Deferred:** attack helicopters, obstacles/field fortifications and a
  dedicated anti-tank missile vehicle. They are not needed to make the current
  roles functional.
- **Deferred:** a second naval hull. The coastal battery now gives the naval
  layer a shore counter, but the corvette remains the only buildable ship.

## Verification

New focused coverage is in `tests/combined-arms.test.ts`:

- production references and the new role definitions;
- every new unit reachable through a real facility;
- weapon target lanes (air, naval, indirect);
- indirect fire over a blocked line of sight, minimum range, lobbed-projectile
  save/load round-trip;
- recovery repair, material cost and save/load;
- interceptor-versus-fighter combat;
- UAV vision;
- coastal battery engagement and ground-target immunity;
- AI production of interceptors, drones, artillery and recovery support.

The existing determinism, save, air/naval, production, AI and unit-scale suites
remain the regression baseline.

## Files changed

| File | Change |
| --- | --- |
| `src/data/units.ts` | `spg`, `recovery`, `interceptor`, `uav` definitions. |
| `src/data/buildings.ts` | `coastalBattery`; `spg`/`recovery` on the factory list, `interceptor`/`uav` on the airfield list. |
| `src/data/weapons.ts` | `howitzer` (indirect, minimum range), `airMissile` (air only), `coastalMissile` (naval only). |
| `src/sim/types.ts` | `WeaponDef.indirect` / `minRange`, `UnitDef.repair`, `Entity.repairTargetId`, lobbed projectile field. |
| `src/sim/game.ts` | Indirect-fire gating, repair tick, lobbed-projectile flight and impact, save/load field. |
| `src/sim/ai.ts` | Drone/interceptor, artillery and recovery decisions, coastal-battery consideration. |
| `src/render/` | Procedural meshes and building mesh for the five new ids. |
| `src/ui/icons.ts` | Vector icons for the five new ids. |
| `tests/combined-arms.test.ts` | New suite (11 tests). |
| `README.md`, this document | Roster, roles and limitations. |

No Phase 1 contract file (`factions.ts`, `roster.ts`) changed: the new ids flow
into every nation because they are registered units and buildings on the shared
baseline.

## Verification results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | pass, exit 0 |
| Full suite | `npx vitest run` | **36 files / 378 tests passed**, 77.9 s |
| Production build | `npm run build` | pass, 59 modules, `dist/assets/index-*.js` 433.77 kB |

Phase 1's reference point was 35 files / 367 tests; the 11 new tests are the
combined-arms suite, and no existing test was edited to accommodate the new
content.

Difficulty ladder on the unchanged symmetric arena, with both sides now able to
field the new roles:

| Pairing | Margin | Record |
| --- | --- | --- |
| Recruit vs Veteran | −41,847 | 4–12 |
| Elite vs Recruit | +87,061 | 14–2 |
| Elite vs Veteran | +42,100 | 11–5 |

The ordering and the assertion thresholds from before this phase still hold, so
the added roles did not flatten commander differences. These are AI-vs-AI board
evaluations, not balance targets.

Compatibility: `tests/determinism-save.test.ts` (two-run hash, batch-size
invariance, save round-trip), `tests/scenario.test.ts` and `tests/maps.test.ts`
pass unchanged, so legacy `baltic`/`expeditionary` scenarios and existing saves
still load. No save-format version bump was needed: the new entity and
projectile fields are optional and absent from older documents.

## Recommended next phase

Phase 3 should add **faction selection and nation-aware match setup**: let the
player pick one of the six nations (or a legacy preset) in skirmish setup, carry
that id through `ScenarioPlayer`, show it in the loading screen and HUD, and let
production read `resolveRoster` for the acting player. Nation rosters stay empty
for now, so the phase changes identity plumbing and not balance. It is the
prerequisite for national specialisations: without a selected nation in
`GameState`, a national variant cannot be validated, saved or used by the AI.
