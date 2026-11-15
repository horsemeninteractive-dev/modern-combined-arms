# Documentation Index

This is the map of MCA's written record: 97 Markdown reports plus the visual and
audio evidence they cite. The current release is **0.9.0 BETA**. The
[GDD](../Modern_Combined_Arms_RTS_GDD_v0.1.md) §0 is the authoritative
implementation snapshot, and the
[codebase audit](<../MCA Codebase Audit, GDD Conformance Report and Roadmap.md>)
records the latest external assessment.

Most documents below are dated records. Where a phase report says "implemented"
or gives a count, read it as the state at that phase, not necessarily today's
build. The baseline, audit and current-status entries are the places to start.

## Start here

| Document | Purpose |
| --- | --- |
| [README](../README.md) | Feature tour, commands, controls, deployment and known limitations. |
| [Game Design Document](../Modern_Combined_Arms_RTS_GDD_v0.1.md) | Design intent; §0 is the build-status table. |
| [Codebase audit, conformance report and roadmap](<../MCA Codebase Audit, GDD Conformance Report and Roadmap.md>) | Findings, GDD conformance, measurements and prioritised work. |
| [CHANGELOG](../CHANGELOG.md) | Release history and shipped changes. |

## Baseline, plans and verification

| Document | Focus |
| --- | --- |
| [Phase 0 — Reconciliation and quality baseline](PHASE_0_RECONCILIATION_AND_BASELINE.md) | The 0.5.4 baseline of build, test, asset and documentation state. Historical; later phase reports supersede its counts. |
| [Verification Report — Stage 1](VERIFICATION_REPORT.md) | Verification record for the first audit and change set. Historical. |
| [Design Specification Reconciliation](DESIGN_SPEC_RECONCILIATION.md) | Stage 1 specification reconciliation and the economy supersession. Historical. |
| [Implementation plan and verification record](PLAN.md) | Original vertical-slice implementation plan and its verification trail. Historical. |
| [Next Phase Plan](NEXT_PHASE_PLAN.md) | The 24 October 2026 next-phase plan. Historical. |
| [Next Task Prompt — mobile result screen](NEXT_TASK_PROMPT.md) | Completed 2026-11-15; retained as the HUD-11 and HUD-10/HUD-12 implementation brief. |
| [Remediation Plan — Stage 1](REMEDIATION_PLAN.md) | Historical Stage 1 remediation sequencing. |

## Audits and reconciliation

### Whole project, security and integration

| Document | Focus |
| --- | --- |
| [Implementation Audit — vertical slice](AUDIT_FINDINGS.md) | Stage 1 audit, its 24 October 2026 re-audit and remediation status. |
| [Security Review](SECURITY-REVIEW.md) | Accounts, room worker, deployment surface and security findings. |
| [Asset provenance ledger](ASSET_PROVENANCE.md) | Known sources and open licence questions for music, voices, flags, fonts and marks. |
| [Multiplayer Readiness Audit](MULTIPLAYER_READINESS_AUDIT.md) | Readiness assessment and the $0 hosting architecture. |
| [Phase 4E — Identity, career and multiplayer integration audit](PHASE_4E_AUDIT.md) | Audit of the account, career and online-result integration. |

### Simulation, AI, economy and roster

| Document | Focus |
| --- | --- |
| [Phase 5 — National matchup verification](PHASE_5_MATCHUP_AUDIT.md) | National matchup verification and counterplay audit. |
| [Phase 5A — Battlefield roster and capability gaps](PHASE_5A_ROSTER_AUDIT.md) | Roster and capability-gap audit that seeded the transport work. |
| [Ten-nation arsenal audit](NATION_ARSENAL_AUDIT.md) | Selective expansion record: the shipped shared MANPADS, EW and loitering-munition roles, plus national candidate triage and deferred Stage B. |
| [Phase 7 — Indirect-fire interaction](PHASE_7_INDIRECT_FIRE_AUDIT.md) | Indirect-fire interaction and match-resolution audit. |
| [Phase 10 — Army-collapse timeout diagnosis](PHASE_10_ARMY_COLLAPSE_AUDIT.md) | Diagnosis of the army-collapse timeout and the AI defect found. |
| [Phase 11 — Assault destination and difficulty](PHASE_11_ASSAULT_DESTINATION_AND_DIFFICULTY.md) | Assault destination fix and Elite/Veteran calibration. |
| [Phase 12 — Fog-of-war integrity](PHASE_12_FOG_OF_WAR_AUDIT.md) | Fog-of-war integrity and AI information boundaries. |
| [Phase 13 — Build-site information integrity](PHASE_13_BUILD_SITE_INFORMATION_AUDIT.md) | Build-site information leak: reproduction and fix. |
| [Phase 14 — Construction priority](PHASE_14_CONSTRUCTION_PRIORITY_AUDIT.md) | Construction priority and economic-opportunity audit. |
| [Phase 15 — Economic recovery and defence priority](PHASE_15_ECONOMIC_RECOVERY_AND_DEFENCE_PRIORITY_AUDIT.md) | Economic recovery and defensive-priority findings. |
| [Phase 16 — No-engineer economic recovery](PHASE_16_NO_ENGINEER_ECONOMIC_RECOVERY.md) | No-engineer economic deadlock and the narrow production reserve. |
| [Phase 17 — Ore exhaustion economy](PHASE_17_ORE_EXHAUSTION_ECONOMY_AUDIT.md) | Ore exhaustion and knowledge-aware economic recovery. |
| [Faction and roster completeness audit](FACTION_ROSTER_AUDIT.md) | Faction and roster completeness at the 26 October 2026 baseline. |
| [Ten-nation Elite ladder — 900-match sweep](NATION_LADDER_ELITE_SWEEP.md) | Mirrored AI-vs-AI nation sweep and measured margins. |
| [Cross-browser determinism spike](DETERMINISM_SPIKE.md) | Chromium/Firefox/WebKit hash comparison over a seeded AI-vs-AI run. |

### Campaign, maps and terrain

| Document | Focus |
| --- | --- |
| [Phase 3 — Campaign audit](PHASE_3_CAMPAIGN_AUDIT.md) | Campaign audit and runtime completion. |
| [Competitive map roster report](MCA_MAP_ROSTER_REPORT.md) | The competitive map roster, validation and deployment status at the time. |
| [Terrain and map expansion report](MCA_TERRAIN_AND_MAP_EXPANSION_REPORT.md) | Terrain catalogue, surface layer, Scenario Forge upgrade and map-pool expansion. |
| [Kestrel Bay terrain correction](KESTREL_BAY_TERRAIN_CORRECTION.md) | Inverted beach classifier: correction and remeasurement. |

### Visual, building and combat feedback

| Document | Focus |
| --- | --- |
| [Visual Audit — Phase 1](VISUAL_AUDIT_PHASE_1.md) | Read-only renderer and running-game visual audit. |
| [Visual Building Audit — Phase 1](VISUAL_BUILDING_AUDIT_PHASE_1.md) | Read-only audit of every implemented building and structure. |
| [Building visual roster audit](BUILDING_VISUAL_ROSTER_AUDIT.md) | Building visual roster completeness at the 28 October 2026 baseline. |
| [Combat Feedback — Phase 1 audit](COMBAT_FEEDBACK_PHASE_1_AUDIT.md) | Combat-feedback audit and vertical-slice plan. |

## Multiplayer and online play

The [multiplayer readiness audit](MULTIPLAYER_READINESS_AUDIT.md) predates the
phase reports and sets out the hosting architecture. The implementation record
then runs in phase order.

| Document | Focus |
| --- | --- |
| [Phase 0 report](MULTIPLAYER_PHASE_0_REPORT.md) | Scope, protocol and architecture before implementation. |
| [Phase 1 — server interfaces](MULTIPLAYER_PHASE_1_INTERFACES.md) | Server boundary, interfaces and reservation invariants. |
| [Phase 1 report](MULTIPLAYER_PHASE_1_REPORT.md) | Phase 1 delivery and verification report. |
| [Phase 2A plan](MULTIPLAYER_PHASE_2A_PLAN.md) | Staging, soak and CPU-investigation plan. |
| [Phase 2A report](MULTIPLAYER_PHASE_2A_REPORT.md) | Phase 2A delivery report. |
| [Phase 2B plan](MULTIPLAYER_PHASE_2B_PLAN.md) | Playable human 1v1 implementation map. |
| [Phase 2B.1 — persistent lobby lifecycle](MULTIPLAYER_PHASE_2B_1_LIFECYCLE_REPORT.md) | Persistent lobby lifecycle and explicit match start. |
| [Phase 2B.1 lifecycle diagram](phase2b1-lifecycle.svg) | Diagram accompanying the Phase 2B.1 report. |

### Phase 2A soak and hardening sequence

| Report | Focus |
| --- | --- |
| [2A.1 — deployed 30-minute soak](MULTIPLAYER_PHASE_2A_1_SOAK_REPORT.md) | First deployed 30-minute stability soak. |
| [2A.2 — resource instrumentation](MULTIPLAYER_PHASE_2A_2_RESOURCE_REPORT.md) | Resource instrumentation and repeat soak. |
| [2A.3 — keepalive and reconnect hardening](MULTIPLAYER_PHASE_2A_3_REPORT.md) | Transport keepalive, reconnect hardening and memory retention. |
| [2A.4 — static map/fog and delta snapshots](MULTIPLAYER_PHASE_2A_4_REPORT.md) | Static map/fog initialisation and the delta-snapshot protocol. |
| [2A.5 — per-tick CPU measurement](MULTIPLAYER_PHASE_2A_5_REPORT.md) | Deployed per-tick CPU measurement investigation. |
| [2A.6 — batch CPU calibration](MULTIPLAYER_PHASE_2A_6_REPORT.md) | Batch-calibration milestone. |
| [2A.7 — first-engagement profiling](MULTIPLAYER_PHASE_2A_7_REPORT.md) | First engagement tick profiling. |
| [2A.8 — pathfinding allocation optimisation](MULTIPLAYER_PHASE_2A_8_REPORT.md) | Pathfinding allocation optimisation with exact behaviour preserved. |
| [2A.9 — staging CPU impact](MULTIPLAYER_PHASE_2A_9_REPORT.md) | Controlled staging comparison of the Phase 2A.8 changes. |
| [2A.10 — optimised staging stability soak](MULTIPLAYER_PHASE_2A_10_SOAK_REPORT.md) | Conditional 30-minute stability soak. |
| [2A.11 — durable restart recovery](MULTIPLAYER_PHASE_2A_11_RECOVERY_REPORT.md) | Durable restart recovery and epoch continuity. |
| [2A.12 — recovery-enabled soak](MULTIPLAYER_PHASE_2A_12_SOAK_REPORT.md) | Recovery-enabled stability and restart soak. |
| [2A.13 — snapshot integrity](MULTIPLAYER_PHASE_2A_13_INTEGRITY_REPORT.md) | Snapshot integrity and finalisation ordering. |
| [2A.14 — full recovery-enabled soak](MULTIPLAYER_PHASE_2A_14_SOAK_REPORT.md) | Full 30-minute recovery-enabled stability soak. |
| [2A.15 — two-sided combat soak](MULTIPLAYER_PHASE_2A_15_SOAK_REPORT.md) | Two-sided combat and snapshot integrity soak. |

## Accounts, career and deployment

| Document | Focus |
| --- | --- |
| [Accounts Stage 0 — audit and architecture](ACCOUNTS_STAGE_0_ARCHITECTURE.md) | Account system audit and architecture. |
| [Phase 2 — persistent career and identity](PHASE_2_CAREER_AND_IDENTITY.md) | Career, player identity and authoritative online results. |
| [Phase 4C — service progression and insignia](phase4c-progression.md) | Account-wide career, XP ledger, ranks and insignia proposal. |
| [Deployment runbook](DEPLOYMENT_RUNBOOK.md) | Ordered deployment of the account Worker, room Worker and Pages app. |

## Content and systems

### Rules, AI and campaign

| Document | Focus |
| --- | --- |
| [Phase 1 — tactical abilities and building modules](PHASE_1_ABILITIES_AND_MODULES.md) | First roadmap phase: abilities and building modules. |
| [Phase 8 — siege, repair and objective resolution](PHASE_8_SIEGE_REPAIR_DESIGN.md) | Design pass and the implemented repair-suppression rule. |
| [Phase 9 — repair-suppression replication](PHASE_9_REPAIR_SUPPRESSION_REPLICATION.md) | Independent replication experiment for the Phase 8 rule. |
| [Phase 6 — AI employment and matchup integrity](PHASE_6_AI_EMPLOYMENT.md) | National roster employment, Pathfinder scouting and matchup integrity. |
| [Adaptive Commander AI — national doctrine](ADAPTIVE_COMMANDER_AI_PHASE_1_NATIONAL_DOCTRINE.md) | Design specification for national AI doctrine. |
| [Campaign operation conventions](CAMPAIGN_OPERATION_CONVENTIONS.md) | Conventions for the two twelve-operation campaign chains. |
| [Day/night warfare](DAY_NIGHT_WARFARE.md) | Authoritative battlefield clock and its gameplay effects. |
| [Strategic superweapons](STRATEGIC_SUPERWEAPONS.md) | Nation-specific strategic capabilities and infrastructure. |
| [Submarine and frigate ASW](SUBMARINE_ASW_PHASE.md) | Tactical submarine and frigate anti-submarine warfare. |

### Roster, nations and technology

| Document | Focus |
| --- | --- |
| [Phase 2 — shared combined-arms baseline](PHASE_2_ROSTER.md) | Shared baseline roster. |
| [Phase 3 — nation selection](PHASE_3_NATIONS.md) | Nation selection and nation-aware match setup. |
| [Phase 4 — national specialisations](PHASE_4_NATIONS.md) | National variants, exclusive units and structure variants. |
| [Alliance roster and technology specification](ALLIANCE_ROSTER_AND_TECHNOLOGY_SPEC.md) | Alliance rosters, national differentiation and technology. |

### Transport and containers

| Document | Focus |
| --- | --- |
| [Phase 5B — garrison and passenger containers](PHASE_5B_CONTAINER_ARCHITECTURE.md) | Shared container architecture behind garrisons and transports. |
| [Phase 5C — APC and land transport](PHASE_5C_APC_TRANSPORT.md) | Shared APC and land infantry transport. |
| [Phase 5D — utility transport helicopter](PHASE_5D_TRANSPORT_HELO.md) | Shared utility transport helicopter. |
| [Phase 5E — landing craft](PHASE_5E_LANDING_CRAFT.md) | Shared naval landing craft. |
| [Phase 5F — transport AI](PHASE_5F_TRANSPORT_AI.md) | Transport AI and amphibious coordination. |
| [Phase 5G — transport recovery](PHASE_5G_TRANSPORT_RECOVERY.md) | Transport recovery and hardening. |

### Audio and voice

| Document | Focus |
| --- | --- |
| [Battlefield narrators](NARRATORS.md) | The two narrator voices and their provenance. |
| [Unit voice bark set](UNIT_VOICE_SET.md) | Kokoro-82M unit voice set, integration and verification. |
| [Strategic voice announcer](VOICE_ANNOUNCER_PHASE.md) | Announcer integration phase. |
| [In-match music](IN_MATCH_MUSIC_PHASE.md) | In-match music integration phase. |

### Visuals, buildings and combat feedback

| Document | Focus |
| --- | --- |
| [Building visual Phase 2 — core base identities](VISUAL_BUILDING_PHASE_2.md) | Ownership anchors and the first building batch. |
| [Building visual Phase 3 — airfield and shipyard](VISUAL_BUILDING_PHASE_3.md) | Airfield/shipyard visual identity split. |
| [Building visual Phase 4 — defences and objectives](BUILDING_VISUAL_PHASE_4.md) | Defensive and captured-objective identity. |
| [Visual material pipeline](VISUAL_MATERIAL_PIPELINE_PHASE.md) | Material pipeline and environment coherence. |
| [Visual environment coherence](VISUAL_ENVIRONMENT_COHERENCE_PHASE.md) | Roads, coast and facade coherence. |
| [Visual Phase 6 — scale and proportions](VISUAL_PHASE_6_SCALE_AND_PROPORTIONS.md) | Cross-unit scale, proportions and silhouette correction. |
| [Visual Phase 8 — tracked vehicles](VISUAL_PHASE_8_TRACKED_VEHICLES.md) | Legacy tracked-vehicle modelling pass. |
| [Visual Phase 8A — artillery identity](VISUAL_PHASE_8A_ARTILLERY_IDENTITY.md) | Rocket artillery and heavy howitzer identity. |
| [Visual Phase 9 — full roster](VISUAL_PHASE_9_FULL_ROSTER.md) | Remaining unit roster pass. |
| [Combat Feedback Phase 3 — recognition and audio](COMBAT_FEEDBACK_PHASE_3.md) | Recognition, spatial audio and polish. |
| [Combat Feedback Phase 4 — readability and validation](COMBAT_FEEDBACK_PHASE_4.md) | Battlefield readability and playtest validation. |
| [Combat feedback playtest protocol](COMBAT_FEEDBACK_PLAYTEST_PROTOCOL.md) | Procedure and evidence required for a human playtest; not yet performed. |

## Evidence

- [Visual audit images](visual-audit/) — screenshots, closeups and before/after
  crops cited by the visual and combat-feedback reports; subfolders cover phases
  5, 6, 8, 8A and 9.
- [Narrator audition page](narrator-audition.html) and
  [narrator voice candidates](narrator-voice-candidates.html) — browser previews
  for the narrator voice selection.
- [Unit voice audition page](unit-voice-audition.html) — browser preview for the
  Kokoro-82M unit barks.
