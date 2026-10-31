# Unit voice generation

Generates the 22-unit selection / move / attack / unable-to-comply radio bark set
with local [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) ONNX speech.
The existing strategic announcer clips in `public/audio/battlesys/` are **not**
touched.

## Setup

```sh
python -m venv .dev/voice-venv
.dev/voice-venv/Scripts/pip install -r tools/unit-voice/requirements.txt
```

Download the two Kokoro model files (about 338 MB) into the git-ignored
`tmp/kokoro/` directory:

```sh
mkdir -p tmp/kokoro
curl -L -o tmp/kokoro/kokoro-v1.0.onnx \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o tmp/kokoro/voices-v1.0.bin \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

The Kokoro-82M model is Apache 2.0; `kokoro-onnx` is MIT. The generated clips are
checked in, so playing the game does not need the model or Python.

## Generate

```sh
# everything
.dev/voice-venv/Scripts/python tools/unit-voice/generate.py

# one unit while iterating
.dev/voice-venv/Scripts/python tools/unit-voice/generate.py --only tank

# after editing text, voice or speed
.dev/voice-venv/Scripts/python tools/unit-voice/generate.py --refresh
```

Output:

```
public/audio/unit-voice/
  manifest.json
  engineer/select.mp3  move.mp3  attack.mp3  unableToComply.mp3
  rifle/...
  ...
```

`manifest.json` records the spoken text, Kokoro voice, language, speed, duration
and relative file path for every cue. `src/ui/unitVoice.ts` uses the same
`defId/cue` contract at runtime; the manifest remains the authoritative record
for the generated assets.

Raw Kokoro WAVs are cached in `tmp/unit-voice-raw-kokoro/` (git-ignored) so
re-running the processing chain does not synthesize again. Use `--refresh` when
the text or voice changes.

## Processing chain

Each line is trimmed, then:

1. 200 Hz high-pass and 4.4 kHz low-pass (field-radio band).
2. +2.5 dB presence peak at 1.8 kHz.
3. 2.6:1 compression, −18 dB threshold, 6 ms attack / 100 ms release, +2.5 dB makeup.
4. Soft saturation at drive 1.0.
5. Band-limited carrier noise at −52 dBFS.
6. Peak normalisation to −2 dBFS, 5 ms edge fades.
7. 24 kHz mono MP3 at 64 kbps.

The chain is deterministic. Kokoro synthesis is deterministic for a fixed model,
voice and speed on the same runtime, but small ONNX/runtime differences can
change a sample slightly.

## Voice cast

Kokoro-82M has 28 English voices: 20 American and 8 British. Every unit gets a
different voice. British voices are used for the UK/European units, including the
British Rocket Battery.

| Unit | Voice | Accent | Speed |
|---|---|---|---:|
| Combat Engineer | `bm_george` | British | 1.00 |
| Rifleman | `am_echo` | American | 1.08 |
| ATGM Gunner | `am_michael` | American | 1.04 |
| Field Medic | `bf_emma` | British | 1.10 |
| Main Battle Tank | `am_onyx` | American | 0.98 |
| Self-Propelled Howitzer | `am_eric` | American | 0.95 |
| Recon Vehicle | `am_liam` | American | 1.06 |
| AA Vehicle | `bf_alice` | British | 1.00 |
| Field Recovery Vehicle | `bm_fable` | British | 0.98 |
| Harvester | `am_puck` | American | 0.96 |
| Strike Fighter | `bf_lily` | British | 1.12 |
| Interceptor | `af_nova` | American | 1.12 |
| Recon UAV | `af_sky` | American | 1.10 |
| Missile Corvette | `bm_lewis` | British | 1.00 |
| Missile Boat | `af_river` | American | 1.04 |
| Attack Submarine | `am_santa` | American | 1.00 |
| Escort Frigate | `af_nicole` | American | 0.98 |
| Pathfinder Recon Team | `bf_isabella` | British | 1.06 |
| Spearhead MBT | `am_fenrir` | American | 0.98 |
| Rocket Battery | `bm_daniel` | British | 0.96 |
| Heavy Howitzer | `am_adam` | American | 0.94 |
| Deep Recon UAV | `af_sarah` | American | 1.08 |

### National accents

Kokoro does not ship Lithuanian, Polish or Russian voices. The five national
variants therefore use distinct English voices: Pathfinder and Rocket Battery are
British, while Spearhead, Heavy Howitzer and Deep Recon UAV are American.

The alternative — Edge TTS with `lt-LT-LeonasNeural`, `pl-PL-MarekNeural`,
`ru-RU-DmitryNeural` or `ru-RU-SvetlanaNeural` — was tested. Those voices do not
articulate English clearly enough to use; local dictation recognition returned
transcripts such as “Hayley dance at” for “Heavy guns, ready.” and “The Scots
down enforcer John” for “Scout team, in position.” Native-accent lines would need
a multilingual voice service with accent control, not another English voice from
Kokoro. See `docs/UNIT_VOICE_SET.md` for the full note.

## Audition

`docs/unit-voice-audition.html` reads the generated manifest and plays every
clip. Serve the repository root and open it:

```sh
python -m http.server 8788 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8788/docs/unit-voice-audition.html`.

## Notes

- Synthesis is local; no network call is made after the model is downloaded.
- The lines are presentation assets. `src/ui/unitVoice.ts` maps local selection,
move, attack and refusal events to them; they never affect simulation state.
- `lines.json` is the single source of truth for text, voice and speed. Add a unit
  there and re-run; the generator writes the four cue files and manifest entry.
