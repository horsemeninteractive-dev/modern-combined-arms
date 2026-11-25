# Outbreak — Phase 1 audit (0.11.0 baseline)

Read-only audit of the shipped Outbreak mode, plus the two critical defects it
turned up. Everything below was established from the current source and from
running the wave planner, not from the roadmap's description of it.

**Method.** Read `src/outbreak/*` (config, director, match, maps, pickups,
scenario, types), `src/data/zombies.ts`, the music catalogue and controller, the
Outbreak paths in `src/app.ts`, and the five Outbreak test files. Wave plans and
spawn orders were printed for all four difficulties at waves 1–60 with a fixed
seed. `npx vitest run tests/outbreak-*.test.ts` covers 64 tests.

**Not done.** No human play sessions, no two-client co-op session, no browser
frame-time or memory measurements, no visual review. Those are 1D and 1E and
remain open; 1E's headless half is in section 3.

## 1. What is genuinely implemented

| System | Where | State |
| --- | --- | --- |
| Difficulty table | `src/outbreak/config.ts` | Population, growth, cap, groups, spawn interval, prep decay, warning, per-archetype first wave and share. Verified live. |
| Wave director | `src/outbreak/director.ts` | preparation → warning → assault → cleanup → complete → next wave, on the 20 Hz sim clock, seeded, saveable. |
| Wave host bridge | `src/outbreak/match.ts` | Field counts in, spawns out, retarget every 24 ticks staggered by entity id, stats from the event bus. |
| Four maps | `src/outbreak/maps.ts` | Distinct terrain, entry regions, objectives, ore. Structures sit on graded pads. |
| Six archetypes | `src/data/zombies.ts` | Ordinary units with their own armour and weapons; flyer on `air`, crawler `lowProfile`. |
| Drops | `src/outbreak/pickups.ts` | 7% per kill, 75 s lifetime, four kinds, mat/req/XP/speed. |
| Results + boards | `src/app.ts` (`showOutbreakResults`), `src/accounts/outbreakBoard.ts` | Wave, kills by archetype, losses, resources, duration, map, difficulty, nation, commanders. Board per map/difficulty/mode. |
| Music | `src/ui/musicCatalogue.ts`, `src/ui/matchMusic.ts` | One mode-only track on repeat; menu cue on the Outbreak routes. |
| Co-op | `src/multiplayer/projection.ts` (`hudState`), `src/app.ts` (`updateOutbreakHud`), `src/outbreak/notices.ts` | Room publishes wave state and drops; the remote seat renders them, derives the wave notices from two consecutive samples, and rolls nothing. |

## 2. Critical defects — fixed in this pass

### D1. Difficulty's approach count did nothing (`plan.groups` was dead data)

`planWave` computed `groups` from `groupsBase`, `groupsEveryWaves` and
`groupsMax`, and the plan was published and tested — but `spawnOrder` ignored it
and cycled **every** entry region on **every** wave. Measured before the fix:
`regionsUsed=6/6` at every wave on every difficulty, and Easy wave 1 placed six
zombies one per road, i.e. an opening that surrounds the base.

That contradicted the mode's own tuning comments ("Assault groups (approach
directions)"), Easy's blurb ("a long opening and small hordes: room to learn"),
Hard's ("several approach axes"), and three of the four difficulty levers in the
table. It also removed the only wave-shape variation the mode had.

Fixed in `spawnOrder`: the region list is shuffled from the director's seeded
stream and the first `plan.groups` approaches are used, one group per approach.

Measured after the fix (Relay Basin, seed 1234):

| Wave | Easy bodies / axes | Normal | Hard | Nightmare |
| --- | --- | --- | --- | --- |
| 1 | 6 / 1 | 7 / 1 | 8 / 2 | 9 / 2 |
| 5 | 21 / 1 | 25 / 2 | 28 / 3 | 32 / 4 |
| 10 | 41 / 2 | 48 / 3 | 56 / 5 | 64 / 6 |
| 20 | 83 / 3 | 98 / 4 | 113 / 5 | 128 / 6 |
| 30 | 125 / 3 | 148 / 4 | 172 / 5 | 195 / 6 |
| 40 | 170 / 3 | 200 / 4 | 231 / 5 | 261 / 6 |

Covered by two new tests: the approach count never exceeds `plan.groups`, and
Easy's first wave is a single road.

### D2. Survival duration was 33% short everywhere

`match.collectStats()` stored `game.state.tick / 30`. The simulation ticks at
`TICK_RATE = 20` (`src/sim/constants.ts`), and every other duration in the engine
divides by it. A ten-minute run reported 6m 40s on the results card and posted
the same short number to the leaderboard.

Fixed to `game.state.tick / TICK_RATE`. This is a data correction, verified by
inspection and typecheck; the value now matches the clock the rest of the engine
uses.

## 3. Prioritised defect list

### P1 — balance and mode integrity

1. **Specialists arrive later than the table claims. — fixed.** `firstWave` gates
   the share, but the share was then multiplied by a ramp and floored, so the
   first body missed by several waves. Measured before the fix (Normal): brute
   configured 12, first fielded 16; bloater 16 → 19; flyer 9 → 11. Easy: 15 → 18,
   18 → 20, 12 → 14. Nightmare: 8 → 10, 10 → 12, 6 → 7. `waveComposition` now
   forces the arrival body at `firstWave` and holds it, so an introduced archetype
   cannot drop back out while its share catches up, and the shambler absorbs the
   difference from its remainder. One test per difficulty in
   `tests/outbreak-waves.test.ts` asserts nothing before `firstWave`, a body on it,
   and a body on every wave through 60, with each wave still adding up to
   `plan.total`.
2. **A stranded body can stop the run. — fixed.** `director.update` left `cleanup`
   only when `aliveInfected === 0`, and nothing timed that phase out, so a zombie
   that could not path anywhere (blocked approach, island of ground, a body left
   behind the wire) kept the wave open forever and no further wave was planned.
   Cleanup now ends on progress: the director tracks the lowest living count since
   the assault ended and closes the wave once that count has not fallen for
   `CLEANUP_STALL_SECONDS` (45 s). A slow kill resets the window, so a long fight
   against the last brute is never mistaken for a stall. Two tests in
   `tests/outbreak-waves.test.ts` cover it: a body nothing can reach no longer
   hangs the wave, and a fight that keeps killing past 45 s is not cut short.
   The director still schedules waves rather than deleting bodies, so the host
   removes them: `OutbreakMatch` sweeps the field and takes off any body that has
   held neither a route nor a target for `STRANDED_DESPAWN_SECONDS` (20 s). The
   rule is deliberately narrow — a body with a route, a target, or one that has
   arrived where it was sent is never touched, however slowly it is doing it — and
   the removal goes through `Game.despawn`, so the body leaves the field without a
   `unitLost`: the survival tally scores no kill and no drop is rolled for it. Two
   tests in `tests/outbreak-combat.test.ts` cover it: a body sealed into a pocket
   of water is gone after the window and uncounted, and a body with a clean route
   is still on the field at the same moment.
3. **Co-op survival stats read one seat. — audit correction: not a defect.**
   The item claimed `stats.matsGathered` reads `game.player(0)` only, and that
   `players` is hard-coded to 2 even for a room that ran with one commander.
   Neither holds against the source. `createOutbreakScenario` builds exactly two
   players — the defending army (id 0) and the Infected (id 1) — and never a
   second defender slot, solo or co-op. A co-op room puts both commanders on
   that same army (`roomDurableObject.ts` gives seat 1 `playerId: 0` for an
   Outbreak room), so both seats gather into one pool and `player(0)` *is* the
   pair's total, not one seat's share. And `players: 2` is not an assumption
   about who showed up: `startConditions` refuses a start unless both seats are
   joined and connected (`lobbyConfig.ts`), and the room provisions both seats at
   creation, so a co-op run cannot begin with one commander. The service derives
   the same number from the mode (`router.ts`), so card, record and board agree.
   No code change: the flag was an audit error, now retired.
4. **Wave shape was uniform. — fixed.** Confirmed against the source first: with
   D1 fixed there were 1–6 axes, but `planWave` still cut `spawnIntervalSeconds`
   into `ceil(total / 18)` batches and that was the entire repertoire. Preparation
   bottoms out around wave 26 on Normal, the interval around wave 28, the axis
   count at wave 13, and the composition ramp is complete by wave 30, so past
   roughly wave 30 the body count was the only variable left.

   Two scripted shapes now alternate from `shapesFromWave` on — Easy 24, Normal
   20, Hard 16, Nightmare 14, so a harder run meets the change sooner, as it
   already does with specials:

   - **`sprint`** multiplies the fast archetypes' composition weights (runners
     ×2.0, crawlers ×1.6) and leaves the schedule untouched. Same number of
     bodies, a visibly quicker mix — and the shambler still leads it, so a sprint
     stays a horde rather than becoming a different faction.
   - **`push`** keeps the mix and changes the arrival: `pushAt` bodies trickle in,
     then `pushSize` land in one instant, then a short tail. The wall still obeys
     `maxAlive` and the ground — a block that cannot be placed is retried on the
     next batch and never dropped — and it is released once per wave.

   Hit points, totals, ceilings, approaches and the preparation curve are all
   untouched; the shape decides which bodies turn up and when. It is derived from
   the wave number alone (`waveShapeFor`), so both seats of a co-op room and a
   reloaded save agree without a new field on the wire, and the director persists
   `pushOpen` so a reload cannot land the same wall twice. Six cases in
   `tests/outbreak-waves.test.ts` cover the shape table, the sprint reweighting,
   a cross-difficulty check that every shaped wave still adds up with its
   shambler backbone and carries a wall only when it is a push, the wall's
   proportions, the one-instant landing (measured per tick), and the reload. Not covered: nothing tells the player which shape is coming — the
   panel shows the wave and the bodies, and a shape notice would need the plan on
   the wire for a remote seat.

### P2 — presentation, records and robustness

5. **The results card omits the map. — fixed.** It printed difficulty, nation and
   commanders but not the battlefield, while the board it posts to is filtered by
   map. The card now has a `MAP` row. The post and the card resolve the battlefield
   through one helper, `outbreakRunMapId()`, which reads the scenario that actually
   ran and falls back to the setup selection, so the two can no longer disagree
   about which board a run belongs to.
6. **`outbreak` save state is written by nothing. — audit correction: it was
   already wired.** `Game.toSave()` writes
   `outbreak: this.outbreak ? this.outbreak.toSave() : null`, and `Game.fromSave`
   restores it last, once the battlefield and its vision are in place. Both lines
   are in HEAD, so an Outbreak run could already be saved and resumed; the item
   described a gap that did not exist. What was missing was the proof, and that
   now exists: a case in `tests/determinism-save.test.ts` plays a Nightmare run
   until a drop is lying on the field, saves through JSON, reloads, and asserts
   the wave, the phase, the whole statistics block and the drops come back — then
   advances both worlds 30 s and asserts wave, phase, kills, gathered materials
   and drops still match. One genuine gap sat beside the save format rather than
   in it: `loadFromSlot` did not clear `outbreakPosted`, so a save loaded after an
   earlier run had posted would have skipped its own leaderboard entry when it
   ended. That per-run flag is now reset with the rest of the loaded-run state.
7. **No Outbreak achievements or lifetime records.** No `outbreak` reference in
   `src/accounts/achievements.ts`; personal progression is the leaderboard's
   `own` row only (Phase 5D is new work).
8. **`wave-cleared` is never announced. — fixed.** The director emits the event at
   the moment its last planned body leaves the arrival window, and
   `updateOutbreakHud` now handles `warning`, `assault`, `wave-cleared` and
   `wave-complete`. The arrival that ended the spawns used to be silent, leaving the
   panel's change to `CLEAR THE FIELD` as the only signal that nothing else was
   coming; it now announces "Wave N deployed — clear the field."
9. **Remote seats get no wave notices. — fixed.** Announcements were drained
   only on the simulating seat, so a co-op partner's only signal was the HUD
   panel. Nothing new is sent to fix it: the room already publishes the wave
   state, and `src/outbreak/notices.ts` turns two consecutive published samples
   into the same four beats — `warning`, `assault`, `wave-cleared`,
   `wave-complete`. `updateOutbreakHud` feeds them through the same announcement
   loop the local seat uses, so both seats in a room now get the same toasts and
   the same incoming-wave radio call. Each beat fires on the transition into it
   and never while it holds, so any frame rate yields one notice per event; the
   first sample after connecting is silent rather than replaying history; a
   restarted room is a reset, not a notice; and a wave that finished between two
   samples still gets its "held" beat. Five cases in
   `tests/outbreak-coop.test.ts` cover the transitions, the restart, the skipped
   wave, and an equivalence run that compares a real match's own event stream
   beat for beat with what a remote seat derives from the state it publishes.
10. **`HOSTILES` named the wrong thing. — fixed in the label.** The number is
    right and stays. `aliveInfected` is every living unit the Infected faction
    owns, which is exactly the field count a player reads it as, and clamping it
    to `maxAlive` would hide live bodies: a wave can close with bodies still
    standing (the stall bound above), and those bodies stay on the map, counted
    in the HUD and against the next wave's ceiling before it has spawned
    anything. `maxAlive` is not a count at all — it is a pacing rule that holds
    bodies in `pending` — so showing it, or matching the field count down to it,
    would trade a true number for a rule. What was wrong was the label's scope:
    `HOSTILES` read as "this wave's force", i.e. something a ceiling governs.
    The panel now says `INFECTED`, naming the population it counts and matching
    the vocabulary of `aliveInfected` and `spawnInfected`. A headless case in
    `tests/outbreak-waves.test.ts` pins the distinction: a stalled wave leaves
    its bodies on the field, the next wave's ceiling equals that field count, and
    none of its own bodies can arrive.

### P3 — performance, unmeasured

These are structural observations only; nothing here is benchmarked.

- `OutbreakMatch.update()` walks the entity list for `commandPost()` and
  `issueOrders()` calls it again in the same tick.
- `aliveInfected` is a full scan and is read twice per spawn batch and once per
  frame by the HUD.
- `hudState()`/`statistics` deep-copy the kill table on every call; the HUD calls
  it every frame on a networked seat.
- `collectStats()` allocates the event slice every tick.
- `chooseTarget` is O(entities) per retargeting zombie; with 150 bodies and
  `RETARGET_TICKS = 24` that is ~6 full scans per tick at the cap.

**Measured (1E, headless).** `tests/perf.test.ts` now places the horde on the
map's own approaches and times 300 ticks of a Nightmare run whose plan sits at
the 150-body ceiling, with the wave director still running its clock beside them.
These were taken on the development host with the rest of that file in flight,
so they are upper bounds rather than idle numbers:

| Living bodies | ms/tick | Share of a 20 Hz tick (50 ms) |
| --- | --- | --- |
| 30 | 1.18 | 2% |
| 90 | 3.04 | 6% |
| 150 | 4.78 | 10% |

The readout paths the HUD calls every frame, timed at 143 living bodies:
`hudState()` 0.009 ms/call and `aliveInfected` 0.003 ms/call, three orders of
magnitude below a tick. For scale, the 163-entity two-army stress case in the
same file measures 3.76 ms/tick.

So none of the five observations above is a problem yet: the full horde costs
under a tenth of a 20 Hz tick, and the per-frame copies are noise. They stay
listed as structural notes — they will matter if the cap rises or if Outbreak
runs without a frame budget — but there is no measured reason to change them
now. What 1E has not covered is frame time with rendering and memory on a real
client.

## 4. Balance read against the four intended identities

- **Easy** now opens on one road with 6 bodies and 105 s, and does not widen past
  three approaches. It reads as the learning difficulty for the first time.
- **Normal** is single-axis until wave 5, four axes by wave 15, 30 s recovery
  floor by wave 27. Close to the stated "pressure builds, recovery shortens".
- **Hard** opens on two axes and reaches five by wave 10, with 1.3 s spawn
  intervals and 24 s recovery late. Genuinely different from Normal.
- **Nightmare** is the whole perimeter from wave 10, specials from the opening,
  18 s recovery. It is not "Normal with more hit points" — hit points are
  identical by design.

Shape risk now replaces the old uniformity: from wave 14–24 on, late waves
change in kind and not only in size, so the *pressure curve* keeps moving. What
is still thin is the vocabulary — two shapes alternate, so a long run learns the
rhythm and the third late wave is predictable again. A single-sector
breakthrough (one approach, everything at once) and a shape cue in the HUD are
the obvious next entries; neither is required for the mode to change shape.

## 5. Next batch (recommended)

1. 1E in the browser: the headless tick baseline is measured and shows headroom
   (section 3, P3), so what is left is frame time with rendering and memory on a
   real client.
2. The cheap items are done; P2.10 and P1.4 were the last of them. What remains
   is design work rather than repairs: P2.7/5D (Outbreak achievements and
   lifetime records), and P1.4's follow-ups — a third shape (single-sector
   breakthrough) and a way to tell the player which shape a wave is bringing.
