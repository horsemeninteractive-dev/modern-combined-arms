# Unit Voice Bark Set — Kokoro-82M

**Status:** generated, integrated into gameplay and technically verified. Human
listening and recognition tests have **not** been performed. The audition page is
ready for that review.

- Engine: Kokoro-82M ONNX (`kokoro-onnx` 0.4.7), fully local.
- Coverage: 19 unit types, 4 cues each, 76 clips.
- Cast: 19 distinct voices — 8 British, 11 American.
- Format: 24 kHz mono MP3, 64 kbps, field-radio processing.
- Location: `public/audio/unit-voice/`.
- Contract: `public/audio/unit-voice/manifest.json`.
- Total size: 809 KiB.

The existing strategic announcer in `public/audio/battlesys/` is untouched.

## 1. Cue set

| Cue | File | Meaning |
|---|---|---|
| `select` | `select.mp3` | The unit answers selection. |
| `move` | `move.mp3` | The unit acknowledges a movement order. |
| `attack` | `attack.mp3` | The unit acknowledges an attack order, or reports that it is unarmed. |
| `unableToComply` | `unableToComply.mp3` | The unit cannot carry out the order. |

Unarmed units use “Unarmed, cannot engage.” for `attack` and a separate refusal
for `unableToComply`, so the two states remain distinguishable.

## 2. Voice cast and lines

| Unit | Voice | Select | Move | Attack | Unable |
|---|---|---|---|---|---|
| Combat Engineer | bm_george | Engineer, standing by. | Moving out. | Unarmed, cannot engage. | Cannot comply. |
| Rifleman | am_echo | Rifle squad, ready. | On the way. | Target acquired. | Negative, unable. |
| ATGM Gunner | am_michael | Missile team, ready. | Missile team moving. | Tank in sight. | No shot. |
| Field Medic | bf_emma | Medic, ready. | Medic moving up. | Unarmed, cannot engage. | Cannot comply. |
| Main Battle Tank | am_onyx | Main battle tank, ready. | Rolling out. | Target acquired. | Negative. |
| Self-Propelled Howitzer | am_eric | Gun battery, ready. | Gun battery moving. | Fire mission. | Cannot fire. |
| Recon Vehicle | am_liam | Scout vehicle, ready. | Scout vehicle moving out. | Target acquired. | Negative. |
| AA Vehicle | bf_alice | Air defence, ready. | Air defence moving. | Target acquired. | No target. |
| Field Recovery Vehicle | bm_fable | Recovery, standing by. | Recovery moving. | Unarmed, cannot engage. | Cannot comply. |
| Harvester | am_puck | Harvester, ready. | Harvester moving. | Unarmed, cannot engage. | Negative. |
| Strike Fighter | bf_lily | Strike flight, ready. | Course set. | Missiles armed. | Unable. |
| Interceptor | af_nova | Air cover, ready. | Course set. | Target locked. | Unable. |
| Recon UAV | af_sky | Drone, on station. | Climbing to station. | Unarmed, cannot engage. | Unable. |
| Missile Corvette | bm_lewis | Warship, standing by. | Under way. | Target acquired. | Unable. |
| Pathfinder Recon Team | bf_isabella | Scout team, ready. | Scout team moving. | Unarmed, cannot engage. | Negative. |
| Spearhead MBT | am_fenrir | Main battle tank, ready. | Tank rolling. | Target acquired. | Negative. |
| Rocket Battery | bm_daniel | Rocket battery, standing by. | Rocket battery moving. | Fire mission. | Cannot fire. |
| Heavy Howitzer | am_adam | Heavy guns, ready. | Heavy battery moving. | Fire mission. | Cannot fire. |
| Deep Recon UAV | af_sarah | Recon drone, on station. | Drone moving to station. | Unarmed, cannot engage. | Unable. |

### Delivery speeds

| Unit | Speed | Unit | Speed |
|---|---:|---|---:|
| Combat Engineer | 1.00 | Strike Fighter | 1.12 |
| Rifleman | 1.08 | Interceptor | 1.12 |
| ATGM Gunner | 1.04 | Recon UAV | 1.10 |
| Field Medic | 1.10 | Missile Corvette | 1.00 |
| Main Battle Tank | 0.98 | Pathfinder Recon Team | 1.06 |
| Self-Propelled Howitzer | 0.95 | Spearhead MBT | 0.98 |
| Recon Vehicle | 1.06 | Rocket Battery | 0.96 |
| AA Vehicle | 1.00 | Heavy Howitzer | 0.94 |
| Field Recovery Vehicle | 0.98 | Deep Recon UAV | 1.08 |
| Harvester | 0.96 | | |

## 3. Processing chain

Each Kokoro line is trimmed to speech, then:

1. 200 Hz high-pass and 4.4 kHz low-pass.
2. +2.5 dB presence peak at 1.8 kHz (Q 0.9).
3. 2.6:1 compression, −18 dB threshold, 6 ms attack / 100 ms release, +2.5 dB makeup.
4. Soft saturation at drive 1.0.
5. Band-limited carrier noise at −52 dBFS.
6. Peak normalisation to −2 dBFS and 5 ms edge fades.
7. 24 kHz mono MP3 at 64 kbps.

This is a radio *texture*, not a heavy distortion chain: the band limit,
compression and low noise bed carry the radio character while keeping consonants
intelligible. An earlier, more aggressive chain (3.2 kHz low-pass, 3.4:1
compression, drive 1.45, −44 dB noise) was rejected because it smeared short
lines.

## 4. National accents

Kokoro-82M ships 28 English voices (20 American, 8 British) plus Japanese,
Mandarin, Spanish, French, Hindi, Italian and Portuguese. It has **no
Lithuanian, Polish, Russian or Belarusian voices**. The five national variants
therefore use distinct English voices:

| Variant | Nation | Voice | Accent |
|---|---|---|---|
| Pathfinder Recon Team | Lithuania | `bf_isabella` | British (European approximation) |
| Spearhead MBT | Poland | `am_fenrir` | American |
| Rocket Battery | United Kingdom | `bm_daniel` | British (accurate) |
| Heavy Howitzer | Russia | `am_adam` | American |
| Deep Recon UAV | Belarus | `af_sarah` | American |

The alternative was tested with Edge TTS native voices. They do not articulate
English clearly enough for a radio bark; local dictation returned, for example:

- `lt-LT-LeonasNeural`, “Scout team, in position.” → “The Scots down enforcer John” (13%).
- `pl-PL-MarekNeural`, “Main battle tank, ready.” → “The main battle tank their the” (22%).
- `ru-RU-DmitryNeural`, “Heavy guns, ready.” → “Hayley dance at” (14%).
- `ru-RU-SvetlanaNeural`, “Recon drone, on station.” → “Finally ended on once the sun” (16%).

Those native clips were not shipped. True national accents need a multilingual
voice service with accent control; that is a separate provider decision, not a
Kokoro voice choice.

## 5. Reproduction

Kokoro runs locally; no network call is made after the model is downloaded.

```sh
python -m venv .dev/voice-venv
.dev/voice-venv/Scripts/pip install -r tools/unit-voice/requirements.txt

mkdir -p tmp/kokoro
curl -L -o tmp/kokoro/kokoro-v1.0.onnx \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o tmp/kokoro/voices-v1.0.bin \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

.dev/voice-venv/Scripts/python tools/unit-voice/generate.py
```

The model files are 338 MB and stay in the git-ignored `tmp/kokoro/`. The
generated clips are checked in, so playing the game does not need the model or
Python. Kokoro-82M is Apache 2.0; `kokoro-onnx` is MIT.

`tools/unit-voice/lines.json` is the single source of truth for text, voice and
speed. `tools/unit-voice/generate.py` caches raw Kokoro WAVs in
`tmp/unit-voice-raw-kokoro/`; pass `--refresh` after changing text or voice.

## 6. Manifest

`public/audio/unit-voice/manifest.json` is version 2:

```json
{
  "version": 2,
  "engine": "kokoro-82m-onnx",
  "preset": "field",
  "sampleRate": 24000,
  "bitrateKbps": 64,
  "cues": ["select", "move", "attack", "unableToComply"],
  "units": {
    "engineer": {
      "name": "Combat Engineer",
      "role": "Construction / capture",
      "voice": "bm_george",
      "lang": "en-gb",
      "speed": 1.0,
      "lines": {
        "select": {
          "text": "Engineer, standing by.",
          "file": "engineer/select.mp3",
          "durationMs": 1650
        }
      }
    }
  }
}
```

The runtime layer resolves the same `defId/cue` path through
`src/ui/unitVoice.ts`; it does not parse the manifest on every bark.

## 7. Audition

Serve the repository root and open the audition page:

```sh
python -m http.server 8788 --bind 127.0.0.1
```

`http://127.0.0.1:8788/docs/unit-voice-audition.html`

The page supports search, role filtering, per-line playback and “Play all four”.
It reports 19 units, 76 clips and 19 distinct voices directly from the manifest.

## 8. Verification

| Check | Result |
|---|---|
| Clip count | 76 (19 units × 4 cues) |
| Distinct voices | 19 |
| Voice split | 8 British, 11 American |
| Missing/zero-byte files | none |
| Shortest/longest clip | 0.72 s / 2.39 s |
| Peak range | −2.7 to −2.1 dBFS |
| RMS range | −22.0 to −15.8 dBFS |
| Total size | 809 KiB |
| Manifest engine/version | `kokoro-82m-onnx` / 2 |
| Automated completeness test | `tests/unit-voice.test.ts` — 14 tests pass |

`tests/unit-voice.test.ts` checks that every registered `UNITS` entry — including
national variants — has all four files, that paths are unique, that files are
non-empty, that the manifest metadata matches the unit definitions, and that no
two units share a voice. It also covers the event-to-cue mapping, local-team
gating, cooldowns, priority interruption and the stuck-line watchdog.

### What was not verified

- **No human listening test.** The audition page exists but has not been used by
  reviewers. Perceived clarity, accent fit and fatigue are unmeasured.
- A local Windows SpeechRecognition dictation pass was used only as a smoke test.
  It recognized “Engineer, standing by”, “Recovery, standing by”, “Rocket battery,
  standing by” and “Heavy guns, ready”, and returned noisy transcripts for
  several short lines. It is not a quality score and is not treated as one.
- Kokoro synthesis can vary slightly with ONNX runtime/model versions; the
  checked-in MP3s are the authoritative audio.

## 9. Integration status

The clips are wired into gameplay. `src/ui/unitVoice.ts` owns the policy and
`src/ui/audio.ts` owns the single shared media channel.

- **Selection.** `App.setSelection()` and `App.addToSelection()` play the first
  locally owned mobile unit's `select` line. A mixed group or a structure gives
  the structures no voice; the first unit answers for the group.
- **Move.** `commandMove()` emits a new `moveOrder` code with the first ordered
  unit's `defId`; the app maps it to `move`.
- **Attack.** `commandAttack()` emits `attackOrder` with the first capable
  attacker's `defId`; the app maps it to `attack`.
- **Refusal.** Local `orderFailed` events without an announcer code map to
  `unableToComply`. Production failures such as `queueFull` keep their existing
  announcer line and do not double-fire a bark.
- **Gating.** Only local-team events are considered, so hidden enemy orders
  cannot produce audio. The bark channel also never starts while the strategic
  announcer is speaking; an announcer line pre-empts a bark.
- **Throttling.** One bark channel, priority selection < move < attack < refusal,
  2.6 s / 1.4 s / 1.6 s / 1.6 s per-cue cooldowns, a 160 ms global gap and a
  6 s watchdog. Box-selecting 20 units cannot fire 20 lines.
- **Volume and mute.** The new `unitVoice` setting (default 0.7) is independent
  of the strategic `voice` setting. Master mute, master volume, battle teardown
  and a new battle all clear the bark channel.
- **Simulation boundary.** The barks are presentation-only. No combat, damage,
  visibility, save or objective rule reads them; the new event fields are
  optional annotations on existing order events.

### Live verification performed

In the running game (dev server 5175), selecting a Pathfinder Recon Team caused
`/audio/unit-voice/pathfinder/select.mp3` to be fetched and played. A move order
produced `pathfinder/move.mp3`, an unarmed attack order produced
`pathfinder/unableToComply.mp3`, and a Main Battle Tank attack order produced
`tank/attack.mp3`. All requests returned HTTP 206 and the bark channel reported
the expected cue and `defId` at each step.

Human listening remains unverified: no reviewer has judged clarity, accent fit
or fatigue, and the browser probe cannot prove perceived loudness.

## 10. Known limitations

- No genuine Lithuanian, Polish, Russian or Belarusian accent is available in
  Kokoro; see section 4.
- Some selection lines deliberately use role names rather than model names
  (“Warship” for the Missile Corvette, “Missile team” for the ATGM Gunner,
  “Air cover” for the Interceptor) because the model names were less
  intelligible over the radio filter.
- The set uses one voice per unit type, not per nation. Shared baseline units
  therefore sound the same for both alliances. Faction-specific casts would need
  a second voice map and another 76 clips.
- Human acceptance is pending; the current result is an implementation-complete
  asset set, not a validated sound design.
