# In-Match Music — Integration Phase

Status: implemented and verified in the running development build (28 October 2026).

## 1. What was built

The three authored tracks were already present and were not modified:

- `/audio/in-game-theme1.mp3`
- `/audio/in-game-theme2.mp3`
- `/audio/in-game-theme3.mp3`

A small rotation controller now selects them, and the existing `AudioEngine` owns
their single media channel, volume, mute and lifecycle. The menu theme and the
strategic announcer remain separate channels.

```
App match lifecycle
  -> AudioEngine.startMatchMusic()
     -> MatchMusic (selection + rotation)
        -> one reusable <audio> element
           -> /audio/in-game-themeN.mp3
```

### Files

- `src/ui/matchMusic.ts` — new three-track rotation controller and exported track
  manifest. No general playlist framework.
- `src/ui/audio.ts` — match media channel, volume/mute integration, short music
  ducking for voice lines, autoplay recovery and teardown.
- `src/app.ts` — starts and stops music at real match lifecycle boundaries and
  updates the existing music setting label.
- `tests/match-music.test.ts` — 19 focused tests.

## 2. Track selection and rotation

`MatchMusic` builds a shuffled cycle of all three tracks and plays one at a time.
Every track is heard once before a new cycle is drawn. The first track of a new
cycle is swapped with the next when it would equal the last completed track, so a
track is never repeated back-to-back. The shuffle is fresh for each match; the
previous match's final track is also avoided as the next opening.

One reusable `<audio>` element means transitions replace the source rather than
creating overlapping players. A stale completion from a previous track or an
earlier match is ignored by a generation check. Duplicate `startMatchMusic()`
calls are inert while a match is already running.

A failed track is marked unavailable for that match and skipped. The controller
attempts each of the three at most once; if all fail it stops rather than retrying
in a loop.

## 3. Match lifecycle

| State | Music behaviour |
|---|---|
| Main menu | Menu theme only; match music stopped and its source released |
| Battle loading/briefing | Music stopped until the battle is active |
| Battle active | Starts once after the match scene is mounted |
| Paused battle | Continues; no extra playback is created |
| Victory / defeat | Stopped when the end screen is first shown |
| Save loaded into an undecided battle | Starts once after the battle is mounted |
| Save loaded after the battle was decided | No soundtrack |
| Return to menu | Stopped, source released, menu theme starts |
| Restart / new match | Previous channel stopped before the new match starts |

The application calls these methods at the authoritative transitions in
`startBattle`, `loadFromSlot`, `checkVictory`, `showMenu` and `openEditor`; music
does not poll rendered UI or simulation state.

## 4. Volume, mute and autoplay

- The existing persisted **Music volume** setting now applies to the menu theme and
  the in-match soundtrack. The settings label was updated accordingly.
- Default volume remains `0.45`, sitting below the default announcer volume of
  `0.8`.
- Volume changes apply immediately to the currently playing track.
- Global mute sets the active music track's volume to zero, pauses the menu
  theme, and restores the configured music volume when unmuted.
- Voice playback remains independently gated by its own volume and the global mute.
- Start-up is attempted inside the match lifecycle after the game's existing
  gesture-driven audio initialisation.
- A `NotAllowedError` playback rejection does **not** skip the track and does not
  retry on frames or timers. One pointer/key gesture is armed to retry the current
  track; a second refusal arms the next gesture instead of looping. Any other
  playback error skips to the next eligible track.

## 5. Coexistence with the announcer

When a strategic voice line starts, the soundtrack target volume drops to 32% for
180 ms and holds there. The track keeps playing at its position. When the line
ends, is interrupted, is reset, or audio is muted, the music fades back to the
configured volume over 180 ms. No track is restarted to duck it.

Voice volume remains `master × announcer volume`; music volume is unaffected by the
duck after the voice line finishes. This is a volume fade, not a full mixer or a
crossfade between music tracks.

## 6. Automated verification

New tests (`tests/match-music.test.ts`, 19):

- All three authored paths are registered and exist.
- Partial `206` media responses are not stored in the runtime cache.
- Duplicate lifecycle notifications start one player only.
- Completion advances to the next track.
- No adjacent repetition across repeated cycles.
- All three tracks stay eligible over many transitions.
- A different random seed produces a different opening order.
- A failed track is skipped without retry.
- All tracks failing stops the controller cleanly.
- A completion queued before stop is ignored.
- Duplicate callbacks from a finished track are ignored.
- Stop then start reuses one channel without overlap.
- The playback element is reused across transitions.
- Broken tracks advance a second track.
- Music volume and mute apply immediately to match music.
- Global mute also silences and later resumes the menu theme.
- Voice playback ducks and restores the track without restarting it.
- Autoplay rejection waits for a gesture and does not spin.
- App lifecycle wiring includes start, load, victory, exit and editor paths.

Focused result:

```
tests/match-music.test.ts   19 passed
tests/music.test.ts          3 passed
tests/announcer.test.ts     19 passed
```

`npm run typecheck` and `npm run build` passed. The full suite passed with 53
files and 587 tests. The build reports only the project's existing >500 kB chunk
advisory.

## 7. Running-game verification

Performed in the development build at `http://127.0.0.1:5173/`, using the real MP3
files and a recorded `HTMLMediaElement.play` call log.

| Check | Observed |
|---|---|
| Start a match | `in-game-theme2.mp3`, playing, `readyState 4`, volume `0.45` |
| Duplicate start calls | No additional playback call |
| Five simulated completions | `2 → 1 → 3 → 2 → 3 → 1`; all three tracks used; no adjacent repeat |
| Element reuse | Same `<audio>` element throughout; still one player |
| Music volume | `0.45 → 0.3` immediately |
| Mute / unmute | `0 → 0.3` immediately |
| Voice line during music | `victory.mp3` requested; music ducked to `0.144` (`0.45 × 0.32`) |
| Voice line end | Music restored to `0.45`; track play count unchanged |
| Victory screen | Music paused, source emptied, current track `null` |
| Restart | One new track started; previous channel paused; no overlap |
| Return to menu | Music paused, source emptied, current track `null` |

Network inspection showed `206 (Media)` responses for all three in-game themes and
the announcer line. No named asset failed to load. The source-replacement and
teardown paths produced expected `ERR_ABORTED` network entries for superseded media
requests; there were no console errors.

## 8. Known limitations

- Track completion was simulated with the real element's `ended` callback rather
  than waiting through the full-length tracks. Actual MP3 loading and playback were
  confirmed in the browser.
- Automated autoplay-recovery tests use a mocked media element. The live session
  started after the game's audio channel had already been unlocked by interaction,
  so a first-visit browser-policy refusal was not reproduced live.
- There is no crossfade between tracks; the next track starts after the current one
  ends. Match end is a clean pause rather than a musical fade-out.
- Ducking is a volume fade on the existing media element, not a full mix bus.
- No independent human listening pass was performed; mix balance and intelligibility
  still need a manual listen.
- Track files are not pre-cached in the install shell, to avoid adding roughly
  13 MB to first install. The service worker now avoids storing `206` partial
  media responses, which would otherwise make later range requests unreliable.
