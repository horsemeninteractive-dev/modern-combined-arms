# Phase 3 — campaign audit and runtime completion

This is the audit deliverable for the Phase 3 campaign work, written from the
current source rather than from earlier reports. It records what exists, what
was completed, and what is still outstanding.

## 1. Existing campaign architecture

| Layer | Location | Role |
| --- | --- | --- |
| Mission document | `src/mission/types.ts` | `mca-mission` v1: objectives, variables, regions, triggers, AI groups, reinforcements, entities, cinematics, consequences, carryover |
| Parser | `src/mission/parse.ts` | Closed-union parse; unknown condition/action kinds are refused |
| Validator | `src/mission/validate.ts` | Reference, bounds, dependency, reachability and policy checks |
| Runtime | `src/mission/runtime.ts` | Authoritative objective/variable/trigger state, dependencies, outcome, canonical save and hash |
| Trigger evaluator | `src/mission/triggers.ts` | Pure evaluation over a world snapshot; ordered by priority then id |
| Result capture | `src/mission/result.ts` | `MissionResult` built once, from authoritative state |
| Campaign data | `src/data/campaign.ts`, `opsBaltic.ts`, `opsEastern.ts` | Two campaigns, one module per campaign, catalogue in one place |
| Campaign kit | `src/data/campaign/missionKit.ts` | `buildOperation` scaffolding; theatres in `theatre.ts`, `mapsBaltic.ts`, `mapsEastern.ts` |
| Campaign state | `src/campaign/state.ts`, `store.ts`, `types.ts` | Commander identity, accepted records, variables, veterans, snapshot/retry, save envelope |
| Campaign launch | `src/campaign/scenario.ts` | Built-in theatre + command pair keys + deployed veterans → ordinary `Scenario` |
| Presentation | `src/ui/missionBriefing.ts`, `missionDebrief.ts`, `missionObjectiveView.ts`, `missionLibrary.ts` | Brief/debrief, objective panel, library |
| Authoring | `src/ui/missionWorkbench.ts`, `src/mission/authoring.ts`, `library.ts`, `draft.ts` | Scenario Forge mission workbench, authoring helpers, library, draft recovery |
| Simulation | `src/sim/game.ts` | Drives the runtime once per tick; supplies messages, objective events, group release, wave placement and endings |

The campaign is not a second engine: a campaign battle is an ordinary scenario
with a `MissionDoc`, run by the same `Game` and the same runtime as skirmish.

## 2. Trigger conditions and actions

Conditions implemented and executed: `elapsed`, `variable` (eq/ne/lt/lte/gt/gte),
`objective`, `entityAlive`, `entityDead`, `regionOccupied`.

Actions before this change: `setObjective`, `setVariable`, `message` executed;
`activateAiGroup`, `spawnReinforcement`, `endMission` were declared, parsed and
validated but **not executed** — the validator emitted `action-not-executed`
warnings, the workbench labelled them unavailable, and the evaluator ignored
them.

Actions now: all six execute. `activateAiGroup` and `spawnReinforcement` are
latched in the runtime (`groups[]`, `waves[]`), so neither can repeat, and both
latch state is serialised, hashed and restored. `endMission` commits a verdict
through `MissionRuntime.forceOutcome`, after which the ordinary `finish` path
captures the result; a later trigger cannot run and a second verdict is refused.

## 3. Mission count and completion

- Baltic Line: `baltic-01..12` — 12 operations, all with briefing, objectives,
  regions, triggers, opening/in-mission/ending cinematics, consequences,
  carryover and a bespoke theatre.
- Eastern Corridor: `corridor-01..12` — 12 operations, same shape.
- Total: 24 authored operations. **The 14-per-campaign target is not met.**
- Similarity: the chains share structural patterns (secure a region, break the
  command post, one secondary, one clean-sweep bonus). Objectives and ground
  differ, but every operation currently ends on the enemy command post, which is
  the repetitive pattern the Phase 3 brief asks to break up.
- No operation uses AI groups or reinforcements, because neither executed.

## 4. Gaps found

1. Three deferred actions (fixed in this change).
2. No authored use of groups or waves anywhere in either campaign.
3. The workbench has no AI-group or reinforcement section: the fields exist in
   the schema, parser and validator, but an author can only create them by
   importing JSON. Trigger rows can now reference them.
4. `MissionReinforcementDoc.triggerId` is descriptive only; the wave arrives from
   its action or its timer. Validation warns when the named trigger does not
   request the wave.
5. Cross-campaign consequences are not representable: campaign runs are
   independent, so a Baltic outcome cannot set an Eastern variable.
6. Mission count is 12 per campaign, not 14.

## 5. Save/load and carryover

- Mission state (variables, objectives, trigger latches, group/wave latches,
  outcome, result) serialises canonically and is restored by
  `normalizeMissionRuntimeState`; unknown ids are dropped, once-triggers are
  clamped, and stale pending delays are discarded.
- Campaign state restores from a pre-mission snapshot on retry, so a retry
  cannot duplicate rewards, veterans or flags.
- `missionHold` is an entity field, so a dormant group survives save/load.
- Veterans carry only identity and service history — no stat block — and are
  placed by `buildCampaignScenario` only when the roster check passes.

## 6. Recommended order (and what is done)

| Stage | Status |
| --- | --- |
| 1. Audit | Done — this document |
| 2. Runtime completion | Done — three actions, latches, effects, persistence, tests |
| 3. Persistence/continuity | Verified for the new latches; no campaign schema change was needed |
| 4. Authoring capabilities | Partial — trigger actions selectable and validated; no AI-group/reinforcement section yet |
| 5. Narrative structure | Not started for the additional operations |
| 6. Mission authoring (28) | Not started; 24 exist |
| 7. Campaign-wide validation | Applies to the 24 that exist and passes |
| 8. Campaign playtesting | Not performed |
| 9. Documentation | This document and the conventions update |

## 7. Tests added

`tests/mission-runtime-actions.test.ts` covers group hold and release, release
latches across save/load, wave placement (count, owner, roster), timer arrival,
wave latches across save/load, scripted endings (verdict, no overwrite, no later
trigger) and the new validator diagnostics. `tests/mission-triggers.test.ts` now
asserts that an action is no longer reported as deferred.
