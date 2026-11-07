# Launch trailer

`trailer/out/modern-combined-arms-trailer.mp4` — 47.5 s, 1920×1080, 30 fps,
H.264 High / AAC 48 kHz stereo, 24.9 MB. Companion `poster.jpg` is a frame from
the finished film (19.8 s) and `timeline.json` is the edit decision list the
render used.

Nothing in the trailer is a mock-up: every shot is the shipped game running its
own maps, units, buildings, weather, time-of-day and audio, captured through
Chrome's screencast while the real renderer draws frames.

## What is game, and what is authored

| Element | Source |
| --- | --- |
| Maps, terrain, buildings, units, weapons, weather, lighting | The game, via `src/data` factories |
| Motion, combat, tracer fire, smoke, gunfire and engine audio | The simulation itself, played in real time |
| Camera moves, staging of forces, titles | `tools/trailer/script.js` (shot list) and `stage.js` (director) |
| Music | `public/audio/music/Forward Command.mp3`, the game's own battle track |
| Narration | Kokoro-82M, the model and processing chain behind the in-game narrator |

The staging is deliberate — the trailer places a company of tanks on a road and
tells it to advance, exactly as a player could — but nothing is faked with
particles or post effects.

## Pipeline

```
node tools/trailer/capture.mjs stills          # framing checks -> trailer/raw/*.png
node tools/trailer/capture.mjs record          # all takes     -> trailer/raw/clip-*.webm
.dev/voice-venv/Scripts/python tools/trailer/voice.py   # narration -> trailer/audio/vo-*.mp3
node tools/trailer/render.mjs                  # the film      -> trailer/out/
```

`capture.mjs` starts Vite and Chrome on a private profile, opens the game, and
imports `stage.js` into the page. The director stages a shot, drives the camera
from the shot's keys, records `canvas.captureStream()` plus a tap on the game's
audio master bus with `MediaRecorder`, and posts the result to a loopback file
sink (a page cannot write files). Takes are variable-frame-rate WebM.

`voice.py` synthesises each line in `narration.json`, runs it through the
narrator preset (`command-east` from `tools/narrator-voice/lines.json`) and
writes mono MP3s plus a manifest of durations. Speech is cached in
`tmp/trailer-voice-raw`; `--refresh` re-synthesises.

`render.mjs` normalises every take to CFR 30 fps limited-range BT.709, cuts it to
the shot's authored duration with a 0.16 s dip at each cut, concatenates the
beats, muxes gameplay audio against the music bed and the narration, compresses
the bus, and masters to delivery loudness.

## Mix decisions

The game's own mix is quiet: engine beds and gunfire measure about -42 LUFS
integrated, roughly 28 dB under the mastered music track. That is correct in
play — music is optional and ducks — but in a trailer the gameplay would vanish.
So each stem is lifted to a **measured** target instead of a guessed constant:

* gameplay -25 LUFS, music -28 LUFS, narration left at the level its own chain
  produces (peaks at -3.2 dBFS);
* stems summed at 0.75 headroom, then a 1.8:1 bus compressor at -16 dB to even
  narration peaks against the beds;
* master gain computed from an `ebur128` measurement, clamped so true peak never
  exceeds -1.5 dBFS — a quieter film is better than a squashed one.

Measured on the delivered file: **-17.2 LUFS integrated, true peak -1.9 dBFS,
LRA 7.0 LU.** Narration windows sit around -17 dB RMS against -22.8 dB RMS for
the loudest gameplay-only stretch, so speech leads the mix by about 5 dB without
burying the guns.

If a take is re-recorded and the game's levels change, the measured targets keep
the balance automatically. Use `--game-lufs`, `--music-lufs`, `--vo-gain`,
`--lufs` and `--poster-at` to override.

## Shot list

| # | Beat | Map | Length |
| --- | --- | --- | --- |
| 01 | First light over the beachhead | Kestrel Straits | 7.5 s |
| 02 | Armour column on the move | Kestrel Straits | 6.5 s |
| 03 | Contact at the bridge | Kestrel Straits | 8.0 s |
| 04 | Street fighting | Ashcross Sprawl | 6.5 s |
| 05 | Night assault on the bunker line | Drylands | 7.0 s |
| 06 | Attack helicopters over the advance | Kestrel Straits | 6.5 s |
| 07 | End card | Kestrel Straits | 5.5 s |

Narration marks are written against `shot` + `at` in `narration.json`, so
re-timing a shot in `script.js` moves its line with it; `render.mjs` prints a
warning if a line would run past the end of the film.

## Re-shooting

Stills are the fast loop: change camera keys in `script.js`, run
`capture.mjs stills <shot-id>` and look at `trailer/raw/still-*.png`. Only record
once the framing is right — a full recording pass is a few minutes and every take
carries the live simulation, so a bad cut is cheaper to find in a still.

`trailer/raw/`, `trailer/segments/`, `trailer/audio/` and `trailer/preview/` are
gitignored: they are large and fully regenerable from the two source files and
the voice script.
