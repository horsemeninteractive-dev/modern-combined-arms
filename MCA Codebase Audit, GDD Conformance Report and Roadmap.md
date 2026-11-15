# MCA: Codebase Audit, GDD Conformance Report and Roadmap

**Build audited:** 0.8.2 BETA (13 November 2026) plus the working-tree changes released as 0.9.0 | **Design reference:** GDD v0.1.3 (15 November 2026, reconciled to build 0.9.0) | **Prepared:** 14 November 2026 | **Re-verified:** 15 November 2026 against the full workspace

---

## 1. Executive summary

**The build has comfortably outrun the design document.** Everything in the GDD's first vertical slice (§16) is in place and test-covered, and the project is operating well into what the GDD calls Phases 5 and 6 (skirmish breadth, campaign foundation). It also contains whole systems the GDD never mentions: accounts and career, achievements, cosmetics, superweapons, commander doctrine, veterancy, day/night warfare, transports and amphibious operations, and live 1v1 multiplayer.

**Code health is strong.** About 134,000 lines of TypeScript in `src/` (another ~62,000 in `tests/`), no TODO/FIXME markers, three `as any` in all of `src/`, 225 `.test.ts` files (with the long AI ladder and perf file excluded, Vitest collects 223: 222 pass, 1 skipped) and 3,062 passing tests plus 3 skipped. `tsc --noEmit` is clean and the two `phase0` suites that were previously reported as a red build now pass (12 tests): the `phase0/` folder is present in the full workspace. State-hash determinism, batch-size invariance, save/load round-trip, the multiplayer command gate and per-seat fog projection are all covered.

**Three things need action now:**

1. **Cross-engine determinism passed its first spike, but remains unguarded.** A 7,200-tick seeded AI-vs-AI run produced identical hashes in Chromium, Firefox and WebKit at all 72 samples (`docs/DETERMINISM_SPIKE.md`). The simulation still calls `Math.sin/cos/atan2/hypot/pow` at about 65 sites, so a different browser version or code path can still diverge; the deterministic math module and ban test remain P2-1 (F-03).
2. **The multiplayer architecture does not match your free-hosting lockstep goal.** The current room worker runs the full simulation server-side inside a Durable Object and sends fog-projected snapshots. That is a good anti-cheat design but the most expensive one to host for free (F-04, §7).
3. **The first CI run remains.** CI and the docs index now exist, and the cross-browser determinism spike passed; confirm the workflows on `main` (F-11).

**Your multiplayer goals (free to host, free to play, deterministic lockstep, ranked later) are achievable, but they are not what is built today.** Lockstep needs three things the codebase is close to having: deterministic math, a command-log primitive (which doubles as replays, spectating and ranked verification), and a thin relay. Section 7 and the roadmap lay this out, including an explicit trust-model decision for ranked, because lockstep cannot hide fogged information from clients.

**Biggest remaining design gaps against the GDD:** a victory-condition library beyond destroy-HQ and annihilation, team skirmish, national upgrade trees, campaign consequences beyond tokens and veterans, mines and AEW aircraft, and store packaging.

**Roadmap in one line:** stand up CI and run the cross-browser determinism spike (week of 16 Nov), close the slice-level gaps and deterministic-math work in parallel (to mid-Dec), build lockstep multiplayer (mid-Dec to end-Jan), ranked and public-launch hardening (Feb), content depth throughout, platform packaging from March 2027. Dates are indicative and calibrated to the pace in your changelog (see §8).

---

## 2. Scope and method

**What I did**

- Read the full GDD (1,156 lines), README, the changelog from 0.1.0 to 0.8.2, and the inventory of `docs/` (98 files).
- Ran `tsc --noEmit`, the two focused `phase0` suites, `vitest list` for the collected test set, and the Vitest suite with `tests/ai-matchups.test.ts` and `tests/perf.test.ts` excluded. The perf file is reported separately. Audio assets are present in `public/audio/`, so the audio-asset tests ran in-suite rather than being re-run after extraction.
- Probed the source for each GDD requirement (grep and targeted reading of `sim/`, `multiplayer/`, `accounts/`, `ui/input.ts`, `data/`).
- Checked current Cloudflare free-tier Durable Object limits and billing rules for the multiplayer analysis.

**What I did not do (read these caveats)**

- I did not read all 134k source lines. Conformance is judged from documentation, executed tests and targeted probes, not a line-by-line review.
- I did not run the game in a browser, so UI/UX and visual quality are out of scope here. No live multiplayer session, gamepad hardware, or `ai-matchups` ladder was run.
- The `docs/` folder (98 files), `.env.production` and `scripts/` are present in the workspace. I read the audit, baseline and multiplayer reports but not all 98 documents; a missing `docs/INDEX.md` is the only structural gap I found.
- Performance numbers come from this machine, not your target hardware or Cloudflare's. Treat them as orders of magnitude.

---

## 3. Verification results

| Check | Result |
| --- | --- |
| Source size | 134,381 lines of TypeScript in `src/`; 61,711 in `tests/`; 227,621 across `src`, `tests`, `tools`, `scripts` and `functions` (sim 23.8k lines; `game.ts` alone 11,993) |
| `tsc --noEmit` | **Pass**, 0 errors |
| Vitest, AI ladder and perf excluded | 222 files passed, 1 skipped; **3,062 tests passed, 3 skipped** in 164.3 s |
| `phase0` command gate and projection | **Pass**, 12 tests in 2 files (the former F-01 failure is gone) |
| Audio-asset tests | Pass in the main run; assets are present under `public/audio/` |
| Determinism, save/load, save-migration, maps, command gate, projection, room snapshot, fog integrity | All pass |
| `tests/perf.test.ts` (5 tests) | Pass. 0.292 ms/tick at 24 entities; **7.95 ms/tick at 163 entities**; 100-order attack-move pathfinding 64.9 ms; save 6.3 ms, restore 13.6 ms (309 KiB) |
| `npm run build` | Pass; `sw.js` precaches 18 files |
| Not run | `ai-matchups` ladder, browser rendering, live multiplayer, gamepad hardware |

**Strengths worth protecting:** a deterministic 20 Hz fixed step with a serialisable Mulberry32 RNG; mirror-symmetric competitive maps verified tile-by-tile; the AI information boundary is audited by tests (`fog-integrity`); versioned save migrations; an account service with an Origin allow-list, a second CSRF lock, `SameSite=Lax` session cookies and rate limiting; signed identity tickets for room seats.

---

## 4. GDD conformance matrix (against build 0.8.2)

**Key:** Met = implemented and tested. Partial = implemented with named gaps. Gap = not implemented. Beyond = built, but absent from or larger than the GDD.

### Platform and simulation

| Area (GDD ref) | Status | Evidence and notes |
| --- | --- | --- |
| Fixed-step deterministic sim, seeded RNG, command queue (§3.2, §15) | **Met** | 20 Hz tick, RNG state saved, state-hash tests, batch-size invariance. Cross-engine hashes matched in the 7,200-tick spike; transcendental calls still need deterministic math (F-03). |
| Versioned saves and migration (§15) | **Met** | `saveMigrations.ts`, migration tests. Browser `localStorage` only; no cloud save. |
| Replay recording (§15, "future") | **Gap** | No recorder or player. Seed-replay exists only inside tests. |
| Performance instrumentation and budgets (§3.3) | **Partial** | Bench and FPS/DIAG tools exist. Scaling beyond \~160 entities unmeasured (F-06). |
| Custom WebGL2 renderer (§3.1) | **Met** | Shadow maps (`render/shadowMap.ts`), fog, decals, particles. README wrongly says "no shadow maps". |
| Store packaging: Steam, Play, App Store (§3.1) | **Gap** | PWA only. |

### World, editor and data

| Area | Status | Evidence and notes |
| --- | --- | --- |
| Tile grid, elevation, navigable water (§11) | **Met** | 45 scenario entries (28 campaign, 17 competitive); mirror and reachability tests. |
| Editor with validation and one-click deploy (§12) | **Met** | Scenario Forge, mission workbench, mission library, JSON import/export. |
| Shared authored / runtime / save format (§12.4) | **Met** | One versioned scenario format across editor, skirmish, campaign. |
| Mod SDK, community library (§3.4) | **Gap** | Deferred by design; mission JSON is a reasonable foundation. |

### Gameplay systems

| Area | Status | Evidence and notes |
| --- | --- | --- |
| Economy: two resources, hybrid income (§10) | **Met** | Materials plus requisition; relays, depots and radar capturable. Unit, building and research costs all carry `req`; 59 of 71 unit definitions cost requisition as well as materials, so advanced units are gated by the scarce resource as intended. |
| Combat, armour, light suppression (§8.2-8.3) | **Met** | Suppression reduces accuracy and speed and decays over time. |
| Recon, sensors, fog states (§8.4) | **Partial** | Three fog states; contacts go detected, then last-known (8 s / 30 s windows). Classification is coarse (five bands). |
| Electronic warfare, air defence (§8.5) | **Partial** | SAM/AA solid. A mobile EW vehicle now cuts hostile vision and engagement reach inside its aura, alongside the offensive superweapon and research effects; no AEW aircraft or dedicated counter-jamming yet. |
| Terrain, infrastructure, destruction (§8.6-8.7) | **Partial** | Bridges, garrison buildings, repair, destructible structures. No mines or field obstacles. |
| Weather and time of day (§8.8) | **Met** | `weather.ts`, `dayNight.ts`, `illumination.ts` (headlamp cones). |
| Dynamic opportunities (§8.9) | **Partial** | Mission triggers yes; no dynamic opportunities in skirmish. |
| Urban garrisons (§8.10) | **Met** | Twenty garrisonable building definitions with capacity, protection and firing slots. |
| Aircraft (§9.2) | **Met** | Fuel, ammunition, recovery, airfield and heliport berths. No AEW or EW aircraft. |
| Naval (§9.3) | **Met** | Four-hull line, landing craft, coastal battery. No mines, MCM, convoys or naval aviation. |
| Transport and amphibious play | **Met** | APC, utility helicopter, landing craft and transport AI shipped in 0.7.0; GDD §0 now lists them. |
| Victory conditions (§7.3) | **Partial** | Skirmish supports `destroyHQ` and `annihilation` (`scenario.ts`), and campaign missions use the objective tree with victory/defeat outcomes. No capture-and-hold, timed-survival, infrastructure-denial or evacuation library, and the AI does not plan for those. |
| Skirmish AI stages 1-4 (§7.2) | **Partial** | Stages 1-2 and much of 3 (transport ops, doctrine, adaptive production); three difficulties plus commander catalogue. Weak on team and combined-arms coordination. |
| Skirmish team modes | **Gap** | Maps declare four start slots ("future 2v2") and reservation policy has a 2v2 shape, but the room endpoint accepts only `mode: '1v1'` and there is no team or free-for-all simulation. |
| Nations (§5) | **Beyond** | Ten nations versus six planned. No national upgrade trees or signature abilities. |
| Research | **Partial** | Per-nation projects exist; the deep branch tree is design-only. |

### Campaign

| Area | Status | Evidence and notes |
| --- | --- | --- |
| Two campaigns, 12-15 missions each (§6.1) | **Met** | 12 + 12 authored operations with briefing, cinematics, debrief. |
| Selective persistence (§6.4) | **Met** | Veterans persist into authored slots. GDD §0 mentions operation tokens but not veterans; its gap note correctly reserves deeper consequences for design. |
| Consequences and optional objectives (§6.3) | **Partial** | Awards and tokens; limited effect on later missions. Linear by design. |
| Second-theatre trigger (§4.4) | **Open** | Black Sea incident still an undecided candidate. |

### Controls, UI, accessibility, audio

| Area | Status | Evidence and notes |
| --- | --- | --- |
| Input parity: keyboard/mouse, touch, gamepad (§13.1) | **Met in emulation** | Touch has BOX/ADD. Standard-mapping pad passes menu focus, virtual-cursor selection, RB+A additive selection, group assign/recall and production-tab changes in Chromium; a physical controller is still unverified. |
| Selection, groups, stances, formation slots (§13.2) | **Met** | Control groups, double-click type select, camera bookmarks. |
| Patrol, guard and waypoint queues | **Met.** `T` / **PATROL** alternates between two endpoints; `F` / **GUARD** follows a friendly unit; Shift + right-click queues up to eight authoritative waypoints. Save v4, room-snapshot validation, gate rejection of a full queue and guard-target validation are covered by `tests/phase1-patrol-queue.test.ts` and `tests/phase1-guard.test.ts`. |
| Selected-unit panel, production overview (§13.4-13.5) | **Met** | Per-facility queues with printed block reasons. |
| Layered alerts (§13.6) | **Met.** Critical toasts, F2 jump, world markers and a searchable field-report history with severity filters and click-to-jump. Periodic summaries remain optional and are not implemented. |
| Accessibility (§13.7) | **Partial** | UI scale, reduced shake, effect toggles, remappable battle hotkeys with conflict detection, gamepad stick sensitivity, and Standard plus three colour-vision palettes. Ownership, health and alert signals carry a line-shape or hatch as well as hue. Missing: a physical gamepad and human palette-on-map pass. |
| Audio and subtitles (§14) | **Met / Partial** | Procedural Web Audio is the live path; recorded ambience (CC0) ships but `RECORDED_AMBIENCE_ENABLED = false`; two recorded narrator sets (TTSMaker 2403 and ElevenLabs v4) and six music tracks (26 MB). Captions exist for cinematics only. Never auditioned in automated runs. |
| Mobile result screen and overlay lifecycle | **Met** | Live Chromium sweep: 844×390 card bottom ≤376.6 px (settled 366.6), 667×374 bottom ≤361.5 px; all four actions 44 px and outside the scrolling report; no document scroll. The victory card survived mobile→desktop→mobile, the paused overlay survived 667×374→1280×720, and mobile RESTART returned to tick 0. Desktop at 1280×720 and 1920×1080 unchanged. |

### Multiplayer and accounts

| Area | Status | Evidence and notes |
| --- | --- | --- |
| Online 1v1 (§3.4, §16.6) | **Beyond** | `MULTIPLAYER_FEATURE.enabled` is true; live on the staging worker named in `.env.production`: rooms by code, lobby lifecycle, command gate, per-seat fog projection, reconnect, results reported to the account service. GDD §16.6 still says it is disabled and unshipped. |
| Room browser, matchmaking, ranked, team modes, spectating, replays | **Gap** | `roomDiscovery` and `accountLinking` flags are off. |
| Accounts, career, 42 achievements, cosmetics, player flags | **Beyond** | Google/Discord sign-in, D1, guests, camo and frames. Not in the GDD. |

---

## 5. Built but not yet absorbed into the design sections (design-document debt)

These are shipped and now appear in GDD §0; the design sections and, in several cases, a balance decision still need to absorb them:

- **Superweapons**, five families (hypersonic strike, saturation missile strike, electronic warfare offensive, autonomous drone swarm, directed-energy defence). They sit awkwardly with the "grounded, readable" pillars (§2.3, §2.4) and need a balance and counterplay statement.
- **Commander doctrine catalogue** and adaptive AI (`data/commanders.ts`), **veterancy**, **day/night warfare** with real headlamp cones, **weather**.
- **Transport system**: APC, utility helicopter, landing craft, and the AI that plans amphibious operations.
- **Accounts and meta-progression**: career XP, 42 commendations, cosmetics (frames, backgrounds, unit camo), player-designed flags (`flagEditor.ts`, migration 0004).
- **Ten nations, 45 scenario entries (28 campaign, 17 competitive), 71 unit definitions, 49 building definitions** versus the GDD's six first-slice nations and one slice map.
- **Multiplayer infrastructure**: Durable Object rooms, reservation and capacity coordinators, identity tickets, batch calibration tooling.
- **Studio-grade tooling**: trailer stage, voice generation pipelines, visual/readability probes.

---

## 6. Findings and risks

| ID | Severity | Finding | Recommendation | Effort |
| --- | --- | --- | --- | --- |
| F-01 | **Resolved** | The earlier audit saw a red build because its upload omitted `phase0/`. In the full workspace the folder exists; `tsc --noEmit` is clean, both `phase0` suites pass (12 tests), and `npm run build` passes. | No code action. Keep `phase0/` in release packaging and CI checkout. | — |
| F-02 | **Low** | `docs/` (98 files), `.env.production` and `scripts/` are all present; `.env.production` names the staging room worker. The only structural gap is a missing `docs/INDEX.md`, so a newcomer has no map of the reports. | Add `docs/INDEX.md` grouping the baseline, audits, multiplayer phases and content specs. | S |
| F-03 | **Medium** | The cross-browser spike passed: 72/72 hashes matched across Chromium, Firefox and WebKit over 7,200 ticks (`docs/DETERMINISM_SPIKE.md`). Residual risk remains because \~65 call sites (46 in `game.ts`, 11 in `ai.ts`, 2 each in transport AI and superweapons, 1 in pathfinding, 3 in `core/math`) still use engine-approximated `sin/cos/atan2/hypot/pow`; `Math.sqrt` is exact. | Keep the spike as the regression probe, replace those calls with a deterministic math module and add a test that bans them in `src/sim` (P2-1). | M |
| F-04 | **High** (strategic) | Multiplayer architecture does not match the free-and-lockstep goal: server-side sim ticking every 50 ms via `setInterval` in a Durable Object, no WebSocket hibernation. See §7 for capacity. | Run the decision gate in the roadmap (G1), then build the lockstep relay. | L-XL |
| F-05 | **Resolved** | GDD §0 and §16.6 now describe 0.8.2 (45 battlefields, transport, veterans, live 1v1); README now says 45 battlefields, 225 test files (223 excluding the long runs) and shadow maps, and corrects the transport limitation. | Keep counts generated from code where possible; re-run this reconciliation when the version changes. | S |
| F-06 | Medium | Scaling risk: tick cost rises from 0.292 ms (24 entities) to 7.95 ms (163), roughly n^1.5. Extrapolating, the 50 ms budget is gone around 400-500 entities on this machine. 100 attack-move orders take 64.9 ms, more than a frame. | Profile; add a spatial index for acquisition and vision; spread path requests; add bench thresholds to CI. | M |
| F-07 | Medium | Monolith files: `game.ts` 11,993 lines, `app.ts` 5,817, `ai.ts` 5,059, `renderer.ts` 4,563, `buildingMeshes.ts` 4,183, `hud.ts` 3,926. Merge risk, slow review, and hard to hand to AI tools without context loss. | Extract systems one at a time behind an unchanged state-hash test. | L (continuous) |
| F-08 | Medium | Accessibility and input gaps against GDD §13.7: gamepad hardware untested. Colour-vision palettes, remapping, gamepad sensitivity, menu focus, selection/groups/production gamepad paths, the mobile result-screen fit and overlay lifecycle restoration are implemented and emulated. | See roadmap Phase 1. | M |
| F-09 | Medium | Privacy and user-generated content. Sign-in (Google/Discord) stores accounts in D1, and I found no account deletion or export route in `accounts/router.ts`. Player-designed flags are user-generated content with no visible reporting or moderation path. | Add deletion/export, reporting and size/content limits before public ranked. I am not a lawyer; get proper advice on UK GDPR and age rules. | M |
| F-10 | Medium | Asset provenance is now inventoried in `docs/ASSET_PROVENANCE.md`: ambience is documented CC0, narrator sources are recorded, and the unit-voice model/tool licences are known. Still unresolved: the six Suno-generated music tracks (plan/commercial terms), narrator TTS terms, flag image sources, font licences, and the studio/OG media. The MIT licence still sits over the whole repository without an asset carve-out. | Record the missing licences and terms, add a separate asset licence/notice, and link it from `LICENSE` and the README before store submission. | S |
| F-11 | **Resolved** | CI is configured: `.github/workflows/ci.yml` runs typecheck, the non-ladder suite, build and release dry-run on every push/PR; `.github/workflows/nightly.yml` runs the AI ladder and bench with retained logs. Awaiting the first green run on `main`. | Confirm the first green `main` run and the nightly artifact. | S-M |
| F-12 | Low | Known evidence gaps the project already admits: no pixel-diff tests, audio never auditioned, gamepad hardware. | Add a small visual-regression set; run a human audio and gamepad pass. | M |
| F-13 | Info | `package.json` name is `iron-tide`; product is MCA. Cosmetic. | Rename when convenient. | S |

---

## 7. Additions the GDD does not cover but the project now needs

### 7.1 Multiplayer: current architecture versus your stated goals

You want multiplayer that is **free to host, free to play, deterministic lockstep, with ranked later**. Current free-tier Cloudflare facts (from Cloudflare's published pricing, checked today): Durable Objects on the free plan require the SQLite backend, with **100,000 requests/day** and **13,000 GB-s/day** of duration. Each object is billed as 128 MB. Incoming WebSocket messages are billed at **20:1**, outgoing messages are free, and an object that is idle and eligible for hibernation is not billed for duration. An accepted WebSocket without the Hibernation API accrues duration for the whole connection. Workers on the free plan get 10 ms CPU per invocation.

| Option | How it works | Rough free-tier capacity (my estimate) | Main risk |
| --- | --- | --- | --- |
| **A. Authoritative server (current)** | DO runs the full sim at 20 Hz and sends snapshots | 128 MB x 600 s = 76.8 GB-s per 10-minute match, so about **170 matches/day** from duration alone, less lobby time | Per-tick CPU: this machine shows 7.95 ms/tick at 163 entities against a 10 ms free cap (how timers count is something your own calibration data should settle) |
| **B. Lockstep relay** | DO only forwards turn bundles; clients simulate. Hibernation API, no server timers | 2 players x 5 turns/s x 600 s = 6,000 incoming messages = **\~300 billable requests/match**, so roughly **330 matches/day**; fewer, longer turns (2.5/s) double that | Needs cross-engine determinism and desync handling |
| **C. Lockstep over WebRTC** | DO is signalling only; data channels peer to peer, free STUN, relay fallback | Tens of requests per match, effectively request-limit-free | Exposes player IPs; fallback relay quota; hardest NAT edge cases |

**Lockstep trade-off you should decide on knowingly:** every client holds the full simulation state, so fog of war becomes presentation only. A modified client could read hidden units. Your current design (per-seat projection) prevents that. For casual play this is the normal industry trade. For **ranked**, mitigate with periodic state-hash exchange, dual-signed results, and re-simulation of sampled replays outside the Worker (for example a scheduled GitHub Action: a 10-minute match is about 12,000 ticks, which is well within a free CI job at the measured tick costs). The residual risk (maphack) should be stated in the ranked rules rather than hidden.

### 7.2 Other additions

- **Telemetry and human balance feedback** (opt-in): GDD §0 admits balance is ladder- and fixture-validated, not human-validated. Match-result events and a small dashboard close that loop.
- **Release safety**: staging versus live environments, rollback procedure, a smoke test after deploy (you already have deployed-smoke scripts to build on).
- **Legal, privacy and safety**: privacy policy, terms, deletion/export, consent for telemetry, age handling for third-party sign-in, reporting for player flags. Sequence these before public ranked.
- **Store readiness**: asset provenance, trademark check on real equipment names (K9 Thunder, CV90 and similar), and a policy pre-read for a fictional war between real nations on Apple and Google review.
- **Onboarding metrics**: a tutorial exists; add funnel measurement before investing more.
- **Localisation scaffolding**: strings are in TypeScript data today; plan extraction before content grows further.
- **Cloud save** through the account service, since D1 and identity already exist.

---

## 8. Roadmap

### 8.1 Planning assumptions

- **Calendar** starts Monday 16 November 2026. Reduced capacity is assumed between 21 December and 4 January.
- **Effort sizes** are calibrated to the pace visible in your changelog (eight minor releases between 28 October and 13 November): **S** = up to a day, **M** = 2-4 days, **L** = 1-2 weeks, **XL** = 2-4 weeks. Treat dates as indicative, not commitments.
- **Priority:** P0 = do first, P1 = needed for your stated goals, P2 = valuable, P3 = later or optional.
- **Refactor rule:** any code extraction must leave the determinism state-hash test unchanged.
- **Content freeze recommendation:** no new unit types or nations during Phases 3 and 4 (balance and bug fixes only), so replay and command formats stay stable while multiplayer lands.

### 8.2 Timeline at a glance

| Phase | Window | Theme | Exit criterion |
| --- | --- | --- | --- |
| **0. Stabilise** | 16-22 Nov 2026 | CI, docs index, determinism spike | `npm run build` and `release --dry-run` pass in CI; cross-browser hash result recorded |
| **1. Slice gaps and UX** | 23 Nov - 20 Dec | Patrol and waypoints, event log, remapping, colour-vision palettes, victory-condition library, 2v2, mobile and gamepad | Every remaining section 4 gap is Met or consciously deferred |
| **2. Determinism and replay** | 23 Nov - 13 Dec (parallel) | Deterministic math, replay format, performance work | Same replay gives the same hash in Chromium, Firefox and WebKit; replay viewer works |
| **3. Lockstep multiplayer** | 14 Dec - 31 Jan | Relay, lockstep core, reconnect, browser, soak testing | 20 consecutive cross-browser matches, zero desyncs in soak; free-tier capacity measured |
| **4. Ranked and public hardening** | 1-28 Feb 2027 | Rating, matchmaking, attestation, integrity checks, privacy and legal | Ranked beta open to signed-in players; account deletion and export live |
| **5. Content depth** | Dec 2026 - Mar 2027 (rolling) | National trees, campaign consequences, AI stages 3-4, EW and mines | Per feature |
| **6. Platform and release** | Mar - May 2027 | Desktop and mobile wrappers, store readiness, telemetry | Public beta, then store submission checklist |

**Critical path:** P0-2 (CI) and P0-4 (cross-browser determinism) > G1 (architecture decision) > P2-1 (deterministic math) > P2-3 (replay format) > P3-1 (lockstep core) > P3-3 (desync detection) > P4-3 (result attestation). P0-1 is already done. Phase 1 is independent of multiplayer, but **any Phase 1 change to simulation state or orders (patrol, waypoints, victory conditions, 2v2) must land before the replay format is frozen, or the format must be versioned.**

---

### 8.3 Phase 0: Stabilise and re-baseline (16-22 Nov)

| ID | Task | Pri | Size | Done when |
| --- | --- | --- | --- | --- |
| P0-1 | ~~Delete or port the two `phase0` tests~~ **Done.** Both files resolve against the present `phase0/` folder and pass | Done | — | 12 tests pass; `tsc --noEmit` clean |
| P0-2 | **Implemented; first green run pending.** `.github/workflows/ci.yml` runs typecheck, the suite excluding `ai-matchups`/`perf`, build and release dry-run; `.github/workflows/nightly.yml` runs the AI ladder and bench and retains both logs | P0 | S-M | Green on `main`; nightly report stored |
| P0-3 | ~~Recover `docs/`, `.env.production`, `scripts/`~~ **Done.** `docs/INDEX.md` links all 93 reports by area | Done | — | `docs/INDEX.md` exists; a fresh clone builds with the staging room URL already set |
| P0-4 | ~~Cross-browser determinism spike~~ **Done.** Playwright runs the seeded AI-vs-AI harness in Chromium, Firefox and WebKit at 100-tick hash intervals; 72/72 samples matched over 7,200 ticks | Done | — | Report: identical; recorded in `docs/DETERMINISM_SPIKE.md` |
| P0-5 | ~~GDD/README reconciliation~~ **Done.** §0 and §16.6 describe 0.8.2; README map/test/transport/shadow-map counts corrected | Done | — | Section 0 describes 0.8.2 and section 16.6 no longer contradicts it |
| P0-6 | **In progress.** `docs/ASSET_PROVENANCE.md` inventories the shipped families and records the known CC0/Kokoro sources; music (Suno terms), narrator TTS terms, flags, fonts and studio/OG media still need owner confirmation | P1 | S | Every shipped asset has a source and licence line |
| P0-7 | ~~`release --dry-run` added to CI~~ **Done.** It is the final step of `ci.yml`; the local dry-run passes | Done | — | Dry-run passes on a clean checkout |

### 8.4 Phase 1: Close slice-level gaps (23 Nov - 20 Dec)

| ID | Task | Pri | Size | Notes |
| --- | --- | --- | --- | --- |
| P1-1 | ~~Event log and alert history~~ **Done.** `L` / **LOG** opens the last 240 local reports; text search, ALL/ALERTS/ROUTINE filters and click-to-jump share the existing alert/F2 coordinates | Done | — | Search, filter and jump work on the same events that drive toasts |
| P1-2 | ~~Patrol, guard and shift-queued waypoints~~ **Done.** `T` / **PATROL** alternates endpoints; `F` / **GUARD** follows a friendly unit and releases when it is lost; Shift + RMB appends up to eight queued moves. Authoritative queue and guard orders, gate `queue-full` and target validation, save v4 migration and snapshot validation cover every seat. | Done | — | `orderQueue` and the guard target are simulation state and are included in the state hash; a fresh order replaces them |
| P1-3 | ~~Key rebinding with conflict detection; control sensitivity~~ **Done.** Settings → Controls records one key per battle action, refuses reserved keys and duplicates, persists the action map, and updates command keycaps; gamepad stick sensitivity is on the same tab. | Done | — | Coverage: `tests/input-bindings.test.ts` and the settings/HUD suites |
| P1-4 | ~~Colour-vision palettes (three presets) plus a shape/pattern audit of ownership, health and alerts~~ **Done.** Settings → Display offers Standard plus Deuteranopia, Protanopia and Tritanopia, persisted with the other presentation settings. CSS and canvas share one palette source; renderer team masks and objective meters remap in a preset. Ownership rings and health rails change line style, critical health adds hatch, and toast severity rules are solid/dashed/double/dotted; event labels keep their text tags. | Done | — | Coverage: `tests/color-vision.test.ts`, settings/HUD suites; human palette-on-map pass still open |
| P1-5 | ~~Mobile result screen defect and a small-viewport sweep~~ **Done.** `.end-screen` respects safe-area insets; the card is bounded by `min(88dvh, 100%)`; only the report scrolls; phone/mobile actions are at least 44×44; the entrance animation no longer pushes the card or shrinks its buttons. The rebuilt shell restores the remembered verdict and the held pause state, and does not replay the verdict sting. Live Chromium sweep at 844×390, 667×374, 1280×720 and 1920×1080; victory survived mobile→desktop→mobile; pause survived 667×374→1280×720; mobile RESTART returned to tick 0. | Done | — | Coverage: `tests/modal-layout.test.ts`, `tests/hud-shell.test.ts`, live rect/overlay measurements |
| P1-6 | ~~Gamepad pass: menu focus, selection, groups, production~~ **Done in software.** Standard-mapping pad moves focus through menu levels, activates/backs with A/B, selects with the virtual cursor, adds with RB+A, assigns with LB+D-pad, recalls populated groups with D-pad, and changes production tabs with LB/RB and D-pad up. Chromium emulation covered all four areas. | Done (emulation) | — | `tests/gamepad.test.ts` plus live synthetic-pad run; physical controller remains an evidence gap |
| P1-7 | Victory-condition library: capture and hold, timed survival, infrastructure denial, evacuation. Editor authoring, validation, AI awareness. Destroy-HQ stays the default; annihilation exists already. | P1 | L | Section 7.3 of the GDD; shapes mission design later |
| P1-8 | Team skirmish (2v2) against AI on the maps that already declare four start slots; allied vision and HUD; AI team targeting | P1 | L | Also the prerequisite for team multiplayer |
| P1-9 | ~~Decide whether requisition should gate advanced units~~ **Done.** 59 of 71 unit definitions carry a requisition cost | Done | — | Balance, not a system gap |
| P1-10 | Close the evidence gaps: a small visual-regression screenshot set; a human audio audition | P2 | M | Both admitted limits in README |

### 8.5 Phase 2: Determinism and replay foundations (23 Nov - 13 Dec)

| ID | Task | Pri | Size | Done when |
| --- | --- | --- | --- | --- |
| P2-1 | Deterministic math module (`core/dmath`): table or polynomial `sin`/`cos`, `atan2`, explicit `hypot` and `pow` replacements across about 65 sites; add a test that forbids `Math.sin/cos/tan/atan2/pow/exp/log/hypot` in `src/sim` | P0 | M | Goldens regenerated once; ban-test green; spike result (P0-4) re-run clean |
| P2-2 | Ordering audit: Map/Set iteration, the 33 `.sort(` calls in `game.ts` (every comparator needs an id tie-break), no wall-clock reads in the sim (today only save metadata uses `Date`) | P1 | S-M | Audit note plus tests for any fixes |
| P2-3 | Replay format v1: header (build and scenario hash, seed, settings, nations, difficulty), command log by tick, hash checkpoints; in-app recorder | P1 | M | A recorded match replays to an identical final hash |
| P2-4 | Replay viewer: speed control, skip, free camera, fog toggle | P1 | M | Usable for bug reports and balance review |
| P2-5 | Performance: profile at 150-400 entities; spatial index for target acquisition and vision; amortise path requests; set a budget (for example 20 ms/tick at 400 entities on a reference device) and enforce it in the nightly bench | P1 | M-L | Budget met or documented trade-off |
| P2-6 | Continuous: extract `game.ts` into systems (economy, production, combat, movement, garrison, aviation, naval, capture) behind the state-hash test; target under 6,000 lines by end of Phase 4 | P2 | L (spread) | Line counts tracked per release |

### 8.6 Phase 3: Lockstep multiplayer on free hosting (14 Dec - 31 Jan)

**Gate G1, architecture decision (target 29 November).** Inputs: the P0-4 result, the P2-1 scope, and a live free-tier calibration of the existing authoritative room (your `phase2a6`/`phase2a9` calibration tools exist for this). Options: (1) lockstep over a hibernating relay, (2) lockstep over WebRTC, (3) keep authoritative for now. **Recommended default: option 1**, because it keeps NAT and IP-privacy problems away and roughly doubles free capacity over today's design, while option 2 remains a later escape hatch.

| ID | Task | Pri | Size | Depends |
| --- | --- | --- | --- | --- |
| P3-1 | Lockstep core in the client: turn scheduler (suggest 4 ticks = 200 ms turns at 20 Hz), adaptive input delay of 2-3 turns, barrier on both players' bundles, stall handling with timeout and drop policy | P1 | L | P2-1, P2-3 |
| P3-2 | `LockstepRoom` Durable Object: WebSocket Hibernation API, barrier and forward only, per-match command log in DO SQLite, no simulation and no `setInterval` | P1 | M | G1 |
| P3-3 | State-hash exchange about every 2 s; on mismatch halt and upload both logs and checkpoints for diagnosis | P1 | M | P3-1 |
| P3-4 | Reconnect and late catch-up: fetch the log and fast-forward deterministically | P1 | M | P3-2, P2-3 |
| P3-5 | Port existing lobby, join codes, identity tickets and capacity coordinator to the new room type | P1 | S-M | P3-2 |
| P3-6 | Room browser and quick play (enable the existing `roomDiscovery` flag) | P2 | M | P3-5 |
| P3-7 | Chaos tests: latency, jitter, loss, reordering, mobile tab throttling; cross-browser soak | P1 | M | P3-1 |
| P3-8 | Spectating via a read-only log stream | P3 | M | P3-2 |
| P3-9 | Optional WebRTC transport with Durable Object signalling | P3 | L | Only if G1 or capacity demands |

**Mobile caveat:** a backgrounded tab stalls a lockstep peer. Plan a clear 'waiting for player' state and automatic pause rules in P3-1 rather than discovering this in the soak.

### 8.7 Phase 4: Ranked and public-launch hardening (1-28 Feb 2027)

**Gate G2, ranked trust model (target 16 January).** Choose one: (a) lockstep ranked with hash audits, dual-signed results and sampled replay re-simulation, accepting and stating the maphack residual; (b) hybrid, with ranked on authoritative rooms while free capacity allows; (c) defer ranked until paid hosting is acceptable. **Recommended: (a) for a labelled ranked beta**, revisiting (b) or (c) if cheating appears.

| ID | Task | Pri | Size | Depends |
| --- | --- | --- | --- | --- |
| P4-1 | Rating system (Glicko-2 suits few-game players) in D1 with a new migration; seasons and placement games | P1 | M | P3-3 |
| P4-2 | Matchmaking queue Durable Object (hibernation plus alarms), rating windows that widen with wait, map pool and nation rules | P1 | M | P3-5 |
| P4-3 | Result attestation: both clients submit a signed result and final hash; a mismatch makes the game unrated and flags the replay | P1 | M | P3-3 |
| P4-4 | Replay storage and a scheduled re-simulation job outside the Worker (for example a scheduled CI job) | P2 | M | P2-3 |
| P4-5 | Anti-abuse: leaver penalties, win-trading limits, report button | P1 | M | P4-3 |
| P4-6 | Leaderboards and profile rating display, tied into the existing 42 commendations | P2 | S-M | P4-1 |
| P4-7 | Privacy and legal: policy, terms, account deletion and export, telemetry consent, age handling, reporting and limits for player flags | **P0 for public ranked** | M | none |
| P4-8 | Opt-in match telemetry and a balance dashboard | P2 | M | P4-3 |

**Gate G3, public beta readiness (end of February):** legal items complete, capacity monitored with a kill-switch, rollback rehearsed, nightly ladder and bench green.

### 8.8 Phase 5: Content depth (rolling, December to March)

| ID | Task | Pri | Size | Notes |
| --- | --- | --- | --- | --- |
| P5-1 | National upgrade branches and signature abilities; pilot with two nations, then expand | P2 | XL | Closes the largest roster gap in GDD section 0 |
| P5-2 | Campaign: optional objectives that change later missions; extend to 15 operations per side; choose the second-theatre trigger; subtitles for all mission-critical speech | P2 | XL | GDD 4.4 and 6.3 |
| P5-3 | AI stages 3-4: team AI, combined-arms coordination, deeper doctrine | P2 | L | Builds on P1-8 |
| P5-4 | Superweapon design statement and balance pass against the readability pillars | P2 | M | Section 5 debt |
| P5-5 | Tutorial and onboarding review with funnel metrics | P2 | M | Needs P4-8 telemetry |
| P5-6 | AEW aircraft and deeper sensor contest; the mobile EW aura is shipped | P3 | M | GDD 8.5 |
| P5-7 | Mines and countermeasures, convoys, naval aviation | P3 | L | GDD 9.3 |
| P5-8 | Localisation scaffolding | P3 | M | Before content grows further |
| P5-9 | Cloud save through the account service | P3 | M | D1 and identity already exist |
| P5-10 | Modding groundwork: mission-pack sharing and a versioned content manifest | P3 | L | GDD 3.4 |

### 8.9 Phase 6: Platform and release (March to May 2027)

| ID | Task | Pri | Size | Notes |
| --- | --- | --- | --- | --- |
| P6-1 | Store and licence readiness: provenance done, trademark check on real equipment names, policy pre-read for a fictional war between real nations | P1 | S-M | Before any submission |
| P6-2 | Desktop wrapper and Steamworks integration; Steam page | P2 | L | Electron bundles Chromium, which keeps WebGL2 behaviour consistent; Tauri uses the system WebView, so it varies by OS (my judgement, worth a quick spike) |
| P6-3 | Mobile wrappers (Capacitor) and a mobile performance profile | P2 | L | Safe-area work already done |
| P6-4 | Performance tiers, minimum spec, asset streaming (about 37 MB of audio plus the bundle) | P2 | M |  |
| P6-5 | Opt-in crash and performance telemetry | P2 | M |  |
| P6-6 | Launch checklist and rollback plan | P1 | S |  |

---

### 8.10 Risks to the roadmap

- **Determinism divergence beyond math.** The spike may find state that depends on something other than the listed calls. Mitigation: hash by subsystem so the first divergence is attributable.
- **Format churn.** Phase 1 simulation changes can invalidate replays and logs. Mitigation: version the replay format and freeze it only after Phase 1.
- **Free-tier limits change or are exceeded.** Mitigation: the existing capacity coordinator as a kill-switch, a configurable turn rate, and a monitored daily budget.
- **Mobile backgrounding** stalls lockstep matches. Mitigation: explicit pause rules and UX in P3-1.
- **Solo-developer bandwidth.** High AI-assisted velocity raises review cost. Mitigation: CI, hash-gated refactors and the content freeze.
- **Content pulling focus** from multiplayer. Mitigation: the Phase 3-4 content freeze above.

### 8.11 This week (16-22 November)

1. Confirm the first green `main` run of CI and the nightly measurement workflow (P0-2, P0-7).
2. Close the open provenance gaps in `docs/ASSET_PROVENANCE.md` (P0-6), then add the separate asset licence.
3. Scope P2-1 deterministic math and the ban test now that P0-4 has passed.

### 8.12 Decisions needed from you

1. **Ranked trust model (G2):** are you comfortable with a stated maphack residual for a ranked beta, or must ranked be server-authoritative?
2. **Superweapons:** core feature in every match, or an optional ruleset?
3. **Repository and licence:** is the repo public, and should audio, art and music fall under the same MIT licence as the code?
4. **First store target:** Steam first, or mobile first?

---

## Appendix A: Evidence pointers

- Former build failure, now resolved: `tests/phase0-command-gate.test.ts` and `tests/phase0-projection.test.ts` resolve `../phase0/*`; 12 tests pass and `npm run build` succeeds.
- Transcendental math in the sim: `src/sim/game.ts` (46 sites), `src/sim/ai.ts` (11), `src/sim/transportAI.ts` (2), `src/sim/superweapons.ts` (2), `src/sim/pathfinding.ts` (1), `src/core/math.ts` (3). `Math.sqrt` has four sites, one of them only `ceil(sqrt(n))` for a grid.
- Unit requisition gating: `src/data/units.ts` (`cost: { mats, req }`; 59 of 71 units have `req > 0`), enforced by `canProduce` in `src/sim/game.ts`.
- Authoritative room tick: `src/multiplayer/roomDurableObject.ts` (`TICK_WAKE_MS = 50`, `setInterval`); `mp-room-wrangler.live.jsonc` (`new_sqlite_classes`). `MULTIPLAYER_FEATURE.enabled = true` in `src/multiplayer/featureFlag.ts`.
- Input gaps (rebinding): header comment in `src/ui/input.ts`.
- Victory: `src/sim/types.ts` (`VictoryState`), `src/sim/scenario.ts` (`VictoryType = 'destroyHQ' | 'annihilation'`), mission objective outcomes in `src/mission/runtime.ts`.
- Contact windows: `src/sim/contacts.ts` (8 s detected, 30 s expiry).
- Test counts: `npx vitest run --exclude tests/ai-matchups.test.ts --exclude tests/perf.test.ts` → 223 files collected: 222 passed, 1 skipped; 3,062 tests passed, 3 skipped.
- Benchmarks: `tests/perf.test.ts` output on this machine, 14 November 2026.
- Cloudflare figures: Durable Objects pricing and limits documentation (free plan requests, duration, 20:1 WebSocket billing, hibernation billing), checked 14 November 2026.
