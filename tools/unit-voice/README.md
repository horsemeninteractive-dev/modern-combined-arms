# Unit voice generation

Generates the selection / move / attack / unable-to-comply radio bark set for all
64 unit definitions — canonical slots, Eastern platforms, national replacements,
national exclusives and the two national naval hulls — with local
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) ONNX speech. Each cue has
three takes, so 768 clips in total, and every unit's twelve lines are unique.
The existing strategic announcer clips in `public/audio/narrator/defender/` are **not**
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

# one unit while iterating (keeps the other 51 manifest entries)
.dev/voice-venv/Scripts/python tools/unit-voice/generate.py --only tank

# after editing text, voice or speed
.dev/voice-venv/Scripts/python tools/unit-voice/generate.py --refresh
```

Output:

```
public/audio/unit-voice/
  manifest.json
  engineer/select-1.mp3  select-2.mp3  select-3.mp3  move-1.mp3  ...
  rifle/...
  ...
```

`manifest.json` is version 3. For every unit and cue it records an array of
three takes, each with the spoken text, relative file path and duration, plus the
Kokoro voice, language and speed. `src/ui/unitVoice.ts` uses the same
`defId/<cue>-<take>.mp3` contract at runtime; the manifest remains the
authoritative record for the generated assets.

A full run deletes single-take files and cast directories that no longer exist
in `lines.json`, so re-running after this schema change leaves no orphan clips.

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

Kokoro-82M has 28 English voices: 20 American and 8 British. There are 64 unit
definitions, so the cast is reused across campaign families while the spoken text
is unique per unit. British voices carry the UK and most Defender infantry and
armour; Eastern platforms reuse American voices at different delivery speeds so a
T-72-style hull does not sound identical to its Defender counterpart. The full
per-unit table is in `docs/UNIT_VOICE_SET.md`; `lines.json` is authoritative.

### National accents

Kokoro does not ship Lithuanian, Polish, Russian or Belarusian voices. National
replacements and exclusives therefore use English voices fitted to their
coalition: Pathfinder, Kestrel and Rocket Battery are British, while Spearhead,
Heavy Howitzer, Hedgehog, TOS-P and Deep Recon UAV are American.

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
- `lines.json` is the single source of truth for text, voice and speed. Each cue
  must be a three-element array. Add a unit there and re-run; the generator writes
  twelve files and the manifest entry. `tests/unit-voice.test.ts` fails if a
  registered unit is missing from the manifest or repeats another unit's line.
