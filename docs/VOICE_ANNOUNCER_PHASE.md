# Strategic Voice Announcer — Integration Phase

Status: implemented and verified in the running development build (28 October 2026).

## 1. What was built

The twenty authored MP3 files in `public/audio/battlesys/` were already present and
manually checked. They were not renamed, re-encoded or regenerated. The integration
adds one presentation service between the simulation's existing event stream and a
dedicated HTML media voice channel.

```
Game.emit()  ->  GameState.events  ->  App.drainEvents()
                                          |
                                          +-> announcementForEvent()  (pure mapping)
                                          +-> AudioEngine.announce()
                                                -> Announcer policy
                                                      -> one active voice element
```

Key files:

- `src/ui/announcer.ts` — typed cue ids, the event-to-asset manifest, priorities,
  cooldowns, one-shot rules, the pending slot and the `Announcer` channel.
- `src/ui/audio.ts` — owns the media element, volume/mute gates, playback failure
  handling and battle teardown. It does not add a second audio engine.
- `src/app.ts` — invokes the mapping at the existing event drain boundary, adds the
  persisted announcer volume and resets the channel on battle start/menu return.
- `src/sim/types.ts` / `src/sim/game.ts` — add presentation-only `code` fields to
  existing events so the announcer never has to parse display strings.
- `tests/announcer.test.ts` — manifest, mapping, policy and simulation transition
  tests.

Simulation ownership is unchanged: voice playback never runs inside the tick, and
events are not part of `stateHash()`. No gameplay code calls an MP3 path directly.

## 2. Event-to-asset mapping

| Cue | Asset | Simulation transition | State |
|---|---|---|---|
| `constructionComplete` | `constructioncomplete.mp3` | `buildingComplete` for the local team | Wired |
| `buildingUnderConstruction` | `buildingunderconstruction.mp3` | `buildingPlaced` after a valid local placement | Wired |
| `buildingSold` | `buildingsold.mp3` | None — the game has no sell command | **Unwired** |
| `structureLost` | `structurelost.mp3` | `buildingLost` owned by the local player | Wired |
| `unitReady` | `unitready.mp3` | `unitBuilt` for the local team | Wired |
| `productionUnderway` | `productionunderway.mp3` | Empty queue becoming active (`productionStarted`) | Wired |
| `productionCancelled` | `productioncancelled.mp3` | Cancellation of the active (first) queue item | Wired |
| `queueFull` | `queuefull.mp3` | Real queue-capacity rejection (`queueFull`) | Wired |
| `reinforcementsAvailable` | `reinforcementsavailable.mp3` | None — no reinforcement mechanic | **Unwired** |
| `upgradeComplete` | `upgradecomplete.mp3` | None — no upgrade mechanic | **Unwired** |
| `siteSecured` | `sitesecured.mp3` | Local team completes a capture | Wired |
| `siteContested` | `sitecontested.mp3` | None — no contested-site state | **Unwired** |
| `siteLost` | `sitelost.mp3` | Local site captured by a hostile team | Wired |
| `powerRestored` | `powerrestored.mp3` | Genuine brownout-to-balanced transition | Wired |
| `technologyUnlocked` | `technologyunlocked.mp3` | None — no research/technology system | **Unwired** |
| `baseUnderAttack` | `baseunderattack.mp3` | Damage to a local building by a hostile | Wired |
| `forcesUnderAttack` | `forcesunderattack.mp3` | Damage to a local unit by a hostile | Wired |
| `unitLost` | `unitlost.mp3` | `unitLost` for the local player | Wired |
| `enemyDetected` | `enemydetected.mp3` | A hostile becomes visible after fog/concealment checks | Wired |
| `victory` | `victory.mp3` | Confirmed local mission victory | Wired |

Fifteen of the twenty lines are wired. The five unwired files stay registered in the
manifest and are deliberately not attached to invented gameplay. Their assets ship
but are silent until the corresponding mechanic exists.

### Deliberate distinctions

- Placement and completion are separate events; `constructioncomplete.mp3` never
  plays when a foundation is laid.
- `productionunderway.mp3` fires only on the empty-to-active queue transition, not
  when appending later items.
- `unitready.mp3` follows the actual spawn event, not the queue acknowledgement.
- A site capture emits `siteSecured` only for the local team. A lost site uses the
  capturing enemy's team but is identified by the `siteLost` transition code, so the
  loss warning is not filtered out with unrelated enemy captures.
- `enemyDetected` is emitted by the vision pass after fog and forest concealment
  have approved the sighting. Hidden units cannot produce it.
- Defeat and draws never map to `victory`.

## 3. Priority, cooldowns and duplicate suppression

All policy is in `VOICE_MANIFEST` and `Announcer`; gameplay code only names a cue.

Priority bands, highest first:

1. `victory` (100, one-shot).
2. Base attack, structure loss (90/85).
3. Site lost, unit lost, site secured, site contested (80–65).
4. Forces attack, enemy detected (65/60).
5. Construction, queue, power, upgrades, unit ready, production (45–25).

Behaviour:

- **One channel.** A new line either starts, replaces a lower-priority line, waits
  in one bounded pending slot behind a low-priority line, or is dropped.
- **Critical lines do not queue chatter.** At priority 60 or above, lower-priority
  lines are discarded instead of held.
- **Per-cue cooldowns.** Examples: base attack 15 s, structure lost 10 s, unit ready
  5 s, queue full 4 s. A repeated state or damage tick within the window is silent.
- **One-shot lines.** `victory` plays at most once per battle and is cleared only by
  an explicit battle reset.
- **Stale queued lines expire.** A pending informational line older than 4 s is not
  played late.
- **Watchdog.** A media element that never reports `ended` is force-finished after
  12 s so the channel cannot remain stuck.
- **Failure-safe.** Throwing or rejecting media playback clears the active line and
  never propagates into gameplay.

The simulation also coalesces under-attack alerts to one per category per ten
seconds and site-loss events occur only on actual ownership changes, so the service
does not have to reconstruct those rules from damage ticks.

## 4. Settings and browser behaviour

- New persisted `voice` setting (0–1, default 0.8) with an **Announcer volume**
  slider in the existing settings view. It uses the existing
  `iron-tide.settings.v1` storage record.
- Playback volume is `master volume × announcer volume`.
- Muting the game or setting announcer volume to zero stops the current line,
  clears queued/cooldown state and rejects new playback.
- `AudioEngine.announce()` requires the existing gesture-initialised audio session;
  voice lines never force playback before the game's normal audio unlock.
- Rejected `play()` promises are swallowed. Muting does not repeatedly retry.
- Starting a battle, loading a save and returning to the menu call
  `resetAnnouncer()`, stopping a line and clearing one-shot/cooldown state so a
  restart cannot replay stale audio. Loading a save also stops the menu theme.

## 5. Verification

### Automated

- `npm run typecheck` — passed.
- `npx vitest run tests/announcer.test.ts` — 19 tests passed.
- `npm test` — 52 files, 568 tests passed on the final tree.
- `npm run build` — passed; Vite production bundle built and `sw.js` precached 13
  files. The only build notice is the project's existing >500 kB chunk advisory.

Test coverage includes:

- Every registered asset exists under `public/audio/battlesys/` and paths are unique.
- Player construction/production/site/attack/loss/victory mappings.
- Enemy and AI-only events never map to player announcements.
- A lost site is announced even though its event carries the enemy team.
- Per-line cooldown, same-priority suppression, critical interruption, pending queue
  expiry and one-shot victory.
- Throwing and stuck playback do not break the channel.
- Simulation emits one construction completion, one unit-ready, one queue rejection
  and one base-attack alert under repeated ticks.
- A hidden enemy produces no detection event.
- Audio settings gate the announcer both before playback and in the media path.

### Running-game checks

Driven through the development build at `http://127.0.0.1:5173/` with a real battle.
Playback requests were recorded by wrapping `HTMLMediaElement.play`; the checks below
confirm the game requested the authored file, not that a human heard it through the
host speakers.

| Check | Observed request |
|---|---|
| Queue an engineer, then complete it | `productionunderway.mp3`, then `unitready.mp3` |
| Place a Turbine Plant, then finish it | `buildingunderconstruction.mp3`, then `constructioncomplete.mp3` only |
| Local engineer captures a neutral relay | `sitesecured.mp3` |
| Enemy captures the same relay | `sitelost.mp3` (plus a legitimate `enemydetected.mp3`) |
| Enemy tank damages a local power plant | `baseunderattack.mp3` |
| Enemy tank engages a local tank | `forcesunderattack.mp3` |
| Destroy the enemy command post | `victory.mp3` once; 20 further ticks produced no replay |
| Move a hostile into unexplored fog | No `enemydetected.mp3` |
| Mute audio, then inject a completion transition | No playback request |
| Change and persist announcer volume | Stored `0.25`, applied to the engine, restored to `0.8` |

Enemy production, enemy completion and enemy unit-ready events did not produce any
voice requests during the same session. No console errors or failed asset requests
were observed.

### Determinism

`stateHash()` excludes presentation events and audio state. Island Assault tick zero
under matched conditions:

```
t=0|r=773311|v=playing|p0:3000.00:180.00:0:0|p1:3000.00:180.00:0:0|...
```

The full determinism/save suite passed unchanged.

## 6. Remaining limitations

- **No independent human listening test.** The running-game checks verify media
  requests and the absence of failed requests. Actual audibility, mix balance and
  intelligibility at gameplay volume require a manual listen.
- **Five assets are unwired:** building sold, reinforcements available, upgrade
  complete, site contested and technology unlocked. Each needs a real gameplay
  mechanic before the line can fire without inventing behaviour.
- The announcer is one channel by design; two simultaneous mid-priority events may
  drop the second rather than overlapping voices.
- Cooldowns are tuned as sensible starting values, not from playtest telemetry.
  They are centralised for later tuning.
