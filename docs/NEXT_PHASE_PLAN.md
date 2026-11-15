# Next Phase Plan — MCA Current-State Audit

Date: 2026-10-24  
Status: **Historical plan after the second current-state re-audit (2026-10-24).**
HUD-10, HUD-11 and HUD-12 were fixed on 2026-11-15; the HUD items below are
retained as the historical ordering.

Superseded status: **Current plan after the second current-state re-audit,
updated after the AI commander revision.** [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md)
§7–§8 and [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) §28–§29 remain the
historical pre-remediation and post-remediation records; §9–§10 and §30–§31 are
the current evidence for the working tree.

> **Update:** the AI commander revision closed AI-01, AI-03 and NAV-02. The AI
> text below is retained as the audit snapshot; see AUDIT_FINDINGS §10 and
> VERIFICATION_REPORT §31. The next mandatory work starts at HUD-11.
>
> **Milestone update (2026-10-24):** the strategic-infrastructure and urban-
> garrison milestone has since been implemented ([PLAN.md](PLAN.md) §37,
> [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) §34). HUD-11 remains the next
> audit-ordered task and is not affected by that milestone.
>
> **Difficulty update (2026-10-25):** the Recruit-vs-Veteran matchup assertion
> that failed during the milestone is closed by retuning the commander levels
> ([PLAN.md](PLAN.md) §38, [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md)
> §35). The suite is now 24 files / 234 tests, all passing.

## 1. Executive summary

The build still passes the mechanical baseline:

- `npm run typecheck` — clean.
- `npm test` — **22 test files / 207 tests passed** (current tree).
- `npm run build` — passed, 52 modules.
- `npm run bench` — 160 entities at **2.603 ms/tick**, 100 path orders in
  **78.1 ms**, 130-entity save/restore **5.1 / 10.3 ms**, all inside the 50 ms
  fixed-step budget on this machine.

The Stage 1 HUD, terrain-picking, construction-grid, turret, muzzle-origin,
naval-repair, MOVE and desktop-chrome corrections remain fixed in source,
focused tests or runtime checks. The economy is retained by product decision and
was not touched.

One blocker remains current; the other was closed after this snapshot:

1. **AI construction deadlocks in normal play (AI-03) — fixed.** The seeded
   commander revision replaces the fixed priority table, abandons a site after
   45 s without measurable progress, and reaches air/naval under normal
   resources. See AUDIT_FINDINGS §10 and VERIFICATION_REPORT §31.
2. **The result screen is not robust on mobile or across layout changes.**
   At 844×390 the result card is 467.5 px tall in a 390 px viewport; at 667×374
   it is 499 px in 374 px. The actions are below the viewport, the page does not
   scroll, and the buttons are 36.9 px high. Switching layouts after a result
   erases the result card, and switching layouts while paused hides the pause
   overlay while the simulation remains paused.

**Current priority: HUD-11, then HUD-10/HUD-12.** The result-screen corrections
are the remaining defects that prevent a mobile player from finishing or
resuming a battle. The AI work that previously led this plan is complete; its
brief in [NEXT_TASK_PROMPT.md](NEXT_TASK_PROMPT.md) is retained as historical.

## 2. Requirements traceability matrix

Statuses: **Meets**, **Partial**, **Unmet**, **Unverified** or **Deferred**. The
evidence column names the implementation, test or runtime measurement; it does
not treat a historical report as proof of the current tree.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | One deterministic, fixed-step simulation shared by battle, editor and saves | **Meets** | `Game.tick` at 20 Hz; seeded RNG; 9 determinism/save tests cover same-seed, batch-size and save/load hashes. |
| 2 | Desktop HUD keeps the battlefield primary; persistent right production sidebar; image-led choices | **Meets** | 82 px rail, 218–254 px sidebar, 136 px console; clear area 62.10% at 1280×720 and 72.11% at 1920×1080; no document/rail/console scroll. |
| 3 | Mobile landscape is a separate battlefield-first touch composition | **Meets (emulation)** | `resolveHudLayout` mobile branch; 60 px category rail, production sheet, bottom command bar, map overlay; measured at 844×390 and 667×374. |
| 4 | Mobile targets at least 44×44 px; no essential action on a tiny control | **Partial** | 13 battle command buttons measured 44×44; tabs 58.9×44.5; groups 44×44. Result actions are 36.9 px high and off-screen (HUD-11). |
| 5 | Safe areas for top, right, bottom and left | **Meets (CSS) / Unverified (hardware)** | `env(safe-area-inset-*)` on top strip, rail, console and sheets. No notch or real-device check. |
| 6 | Primary objective remains discoverable on mobile | **Meets** | Objective chip 481×41 at 844×390; objective sheet present. |
| 7 | Control groups are assignable and recallable on desktop and touch | **Meets (desktop/emulated)** | Desktop 3×3 rail grid; mobile nine-slot 44×44 sheet; desktop assign/recall verified previously. Physical touch not injected. |
| 8 | Construction grid hidden in ordinary play, shown for placement/editor | **Meets** | Live: `renderer.settings.grid=false` in play, `true` during placement, `false` after cancel. |
| 9 | Screen-to-world picking follows terrain elevation | **Meets** | `App.worldAt` → `pickTerrain`; 12 tests; live elevation-2 flat tile returned 0.000 world-unit error. |
| 10 | Elevation is visually legible and mechanically real | **Meets** | Continuous slope surface shared by mesh and picking; movement/LOS/elevation tests. No high-ground vision bonus (P-08). |
| 11 | Turrets rotate on plausible pivots; barrels/muzzles stay attached; shots leave the barrel | **Meets** | 24 weapon-transform tests cover cardinal headings, traverse, corvette bow and muzzle origins. |
| 12 | Each infantry entity is one soldier; copy matches | **Meets** | Simulation/production are individual; barracks/editor copy and test names say rifleman. |
| 13 | Economy funds a complete build-and-fight loop; clear sources and feedback | **Meets (current slice)** | Harvester/ore/refinery loop works, refinery auto-spawns a hauler, 300-Material load; retained by decision. No passive Materials. |
| 14 | Land production and combat work across the roster | **Meets** | Production, construction, power, repair/medic, combat and balance tests pass; tank/AT TTK tests pass. |
| 15 | Player air loop: parked, fuel, strike, return, rearm, SAM/AA counter | **Meets** | `tests/air-naval.test.ts` covers parked start, fuel burn, strike, return, rearm and air defence. |
| 16 | AI uses air and naval infrastructure meaningfully | **Meets (simulation)** | Normal-resource Island Assault builds an airfield and shipyard and launches a wave inside 300 s; fighter sortie and corvette replacement tests pass. No SAM is asserted in that run. |
| 17 | Player naval loop: movement, combat, reload, repair | **Meets** | Movement, combat, reload, full-ammo repair and destroyed-yard rejection pass. |
| 18 | AI establishes an economy, builds, defends, produces and attacks | **Meets (simulation)** | Seeded commander opens with different strategies, reacts to power/contact/damage, repairs, masses and attacks; normal 300 s run reaches air/naval. No human-piloted match yet. |
| 19 | Victory/defeat detected; battle freezes after result | **Meets (simulation)** | Destroy-HQ, HQ-loss and post-result freeze tests pass. Presentation is row 26. |
| 20 | Save/load preserves simulation; incompatible versions fail clearly | **Meets (current schema)** | Exact state-hash round-trip, batch invariance, corrupted/unsupported saves; save and scenario versions checked. |
| 21 | Editor authors, validates and deploys the same map into battle | **Meets (automated and handoff)** | Scenario validation/deploy tests pass; live editor opened and `launchEditorScenario` produced a fresh two-player battle. Full authoring session not rerun. |
| 22 | Alerts and accessibility baseline | **Partial** | Toasts, world markers, command acknowledgements and team colours exist; no scaling/remapping or physical accessibility test. Event log intentionally absent. |
| 23 | Performance at representative entity counts | **Meets** | Controlled bench across two runs: 0.14–0.16 ms/tick baseline, 3.51–3.69 ms/tick at 160 entities, 88.7–88.8 ms/100 path orders, 5.2–5.7 / 10.1–10.4 ms save/restore; under 50 ms. |
| 24 | Documentation matches the build | **Meets after this update** | README, this plan, audit §9 and verification §30 now state the AI and result-screen defects; historical sections remain labelled. |
| 25 | Reference-image and physical-device verification | **Unverified** | No reference images, phone/notch, gamepad hardware or audio audition. |
| 26 | Result and pause overlays survive layout changes and fit mobile landscape | **Unmet** | HUD-10/HUD-11/HUD-12 reproduced at 844×390, 667×374 and desktop↔mobile transitions. |
| 27 | AI construction completes or abandons unreachable sites without stalling its plan | **Meets** | A site with no measurable progress for 45 s is abandoned for half cost and the planner chooses again; normal 300 s run builds through air/naval. |

## 3. Mandatory corrections vs optional improvements

### Mandatory corrections

1. ~~**AI-03 — repair AI construction progression (P0).**~~ **Closed** by the
   seeded utility planner and the 45 s stalled-site abandonment; the
   normal-resource air/naval test is the regression. Historical brief in
   [NEXT_TASK_PROMPT.md](NEXT_TASK_PROMPT.md).
2. **HUD-11 — make the result screen fit mobile landscape (P1).** The card must
   be height-constrained and scrollable when necessary; all four actions must be
   reachable and at least 44 px high at 844×390 and 667×374.
3. **HUD-10 / HUD-12 — preserve result and pause overlays across layout rebuilds
   (P1).** Re-render the known battle result and re-apply the paused state after
   `refreshLayout`; do not rely on a cache that survives the DOM replacement.
4. ~~**AI air/naval normal-play verification (P1, after AI-03).**~~ **Closed:**
   the normal-resource test reaches an airfield and shipyard and launches a wave
   within 300 s. SAM construction remains situational, not asserted.
5. **End-to-end evidence (P1, after 1–3).** Run a player-driven match from deploy
   to result and restart; repeat the result flow on mobile landscape. This is
   the verification that the full loop is actually playable.

### Optional / lower priority

- **Mobile editor authoring.** The drawer CSS exists, but no touch authoring
  session was run. Add a collapsible tool drawer and touch-sized controls only
  if authoring on mobile is in scope.
- **Reference-image and hardware verification.** Required evidence, not a code
  feature.
- **Weather/time clarity.** Label as visual-only or add one tested rule; do not
  imply a tactical effect.
- **Suppression depth.** Morale/rout is not required for the slice.
- **Control-group persistence.** Session-only is documented; persisting groups
  would be a UI-state schema decision.
- **High-ground observation.** Keep the documented no-bonus default until a
  visible rule is designed.
- **Further performance profiling** on low-end hardware or larger maps; current
  headroom is adequate on this host.

## 4. Economy decision — retained

**Decision (unchanged): retain the current harvester/ore/refinery loop for this
slice.** The second audit found no economy change and did not approve a
replacement. The map-control model remains deferred until the mandatory
corrections are closed and a separate extension is designed.

Proposed future model: baseline Materials from the Command Post, additional
Materials from strategic sites, and Requisition from command infrastructure and
relays. It is coupled across data, scenario/map schema, runtime, editor, AI,
HUD, saves and balance:

- unit/building data for the harvester, refinery and income roles;
- scenario `o` fields, ore reachability validation and version bump;
- runtime `ore`/`maxOre` map and harvester state machine;
- AI refinery/harvester build order and affordability;
- HUD income-source breakdown and Materials/min accounting;
- save version, migration and old-save fixtures;
- balance and a 10-minute no-harvester loop test.

**Tests required before any extension ships:** no-harvester income funds a
facility and a small force for 10 minutes; AI builds/produces/attacks without a
harvester; old saves either migrate deterministically or fail clearly; editor
has no dead ore tools; HUD credits reconcile; determinism and performance are
unchanged. Until then, keep and test the current loop as-is.

## 5. Dependency-ordered roadmap

Ranked by gameplay impact, severity, dependencies, regression risk and
verification effort. The campaign, six-nation roster, multiplayer and mod SDK
remain out of scope.

| Rank | Work | Impact | Severity | Dependencies | Regression risk | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ~~**AI-03:** fix construction deadlock; reachable sites, stuck-progress handling, normal-resource regression~~ | High: restores AI expansion and unlocks combined arms | P0 | None | Medium — pathing, site selection, AI build guard | 300 s normal-resource run reaches air/naval; full suite/build/bench pass | **Done** |
| 2 | **HUD-11:** fit and scroll the result card; 44 px actions | High on mobile: restores restart/return | P1 | None | Low — CSS/HUD layout | DOM rects at 844×390 and 667×374; action clicks; full suite | **Pending** |
| 3 | **HUD-10/HUD-12:** re-apply result and pause overlays after layout rebuild | High for rotation/resizing; prevents invisible paused/ended state | P1 | None | Low — HUD lifecycle | Defeat and pause, resize across breakpoint in both directions | **Pending** |
| 4 | ~~**AI air/naval normal-play verification**~~ | High evidence: proves claimed combined arms | P1 | 1 | Low–medium — AI timing, affordability | Normal-resource test asserts airfield, shipyard and a launched wave | **Done** |
| 5 | **Full player-driven match and physical evidence** | High: closes the loop and device gaps | P1 | 1–3 | None | Recorded playthrough; touch/safe-area/gamepad/audio/reference checks | **Pending** |
| 6 | **Mobile editor authoring** (optional) | Medium: touch authoring completeness | P2 | None | Medium | Touch session at 844×390/667×375 | **Pending** |
| 7 | **Deferred economy extension** | Future scope | Deferred | Separate design/approval; 1–3 closed | High — data, schema, AI, HUD, save, balance | Migration fixture + 10-minute no-harvester loop | **Deferred** |

Order rationale: HUD-11 is the only remaining defect that makes the mobile loop
impossible to finish. HUD-10/HUD-12 are lower-frequency lifecycle bugs but cheap
to fix alongside it. AI-03 and the AI air/naval evidence are complete; a full
playthrough is now meaningful after 2–3.

## 6. Next task

**Fit the result screen to a mobile landscape viewport (HUD-11).** The copyable
implementation brief is in [NEXT_TASK_PROMPT.md](NEXT_TASK_PROMPT.md). It
contains the measurements, required behaviour, expected touch points, tests and
acceptance criteria.

Do not combine this with the HUD-10/HUD-12 lifecycle work. HUD-11 is layout and
reachability; HUD-10/HUD-12 are overlay re-application after a layout rebuild.
Keeping them separate preserves attribution and makes regressions easier to
isolate.

## 7. Explicitly out of scope

- Economy replacement or removal; the current harvesting loop is retained and
  any extension is separately designed.
- Campaign, six-nation roster, multiplayer, mod SDK, new maps beyond test
  fixtures.
- Full naval strategy, submarines, mines, naval aviation or amphibious
  transports.
- Renderer replacement, framework adoption or external art/audio pipeline.
- New morale/rout or weather systems.
- Rewriting historical verification sections to claim they tested the current
  build.

## 8. Evidence index

- [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md) §7 — pre-remediation historical snapshot.
- [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md) §8 — post-remediation outcome.
- [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md) §9 — second re-audit snapshot;
  §10 — AI revision that closed AI-01, AI-03 and NAV-02.
- [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) §30 — audit commands and
  gaps; §31 — AI commander revision evidence.
- [README.md](../README.md) — current test count and known limitations.
- [NEXT_TASK_PROMPT.md](NEXT_TASK_PROMPT.md) — historical AI-03 brief.

---

## Update — Phase 4E close-out (2026-11-09)

The identity, career and multiplayer integration audit is complete in source;
see [PHASE_4E_AUDIT.md](PHASE_4E_AUDIT.md). It fixes the guest-migration race and
the room default-duration mismatch and adds regressions for both.

The next phase should start from the audit's external list rather than from new
features: apply the pending account migrations to the deployed database, confirm
or rotate the five Worker secrets, deploy the account and room Workers with the
Pages bundle, and play a real two-account match (identity ticket, lobby display,
reconnect, result delivery). Only after that can Phase 4 be called released.
