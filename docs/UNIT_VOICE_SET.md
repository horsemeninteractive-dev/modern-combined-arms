# Unit Voice Bark Set — Kokoro-82M

**Status:** generated, integrated into gameplay and technically verified. Human
listening and recognition tests have **not** been performed. The audition page is
ready for that review.

- Engine: Kokoro-82M ONNX (`kokoro-onnx` 0.4.7), fully local.
- Coverage: **62 unit definitions**, 4 cues each, **3 takes per cue**, **744 clips**.
- Cast: 62 recorded casts drawing on the 28 English Kokoro voices.
- Text: every unit's 12 lines are unique, and no line is shared between units.
- Format: 24 kHz mono MP3, 64 kbps, field-radio processing.
- Location: `public/audio/unit-voice/`.
- Contract: `public/audio/unit-voice/manifest.json` (version 3).

The 62 definitions are the 22 canonical slots, the 18 Eastern alliance platforms,
the 10 national replacements, the 10 national exclusives and the 2 national naval
hulls (`visby`, `ghadir`) — the launch six plus Finland, Sweden, Iran and North
Korea. The existing strategic announcer in `public/audio/narrator/defender/` is untouched.

## 1. Cue set

| Cue | Files | Meaning |
|---|---|---|
| `select` | `select-1.mp3` … `select-3.mp3` | The unit answers selection. |
| `move` | `move-1.mp3` … `move-3.mp3` | The unit acknowledges a movement order. |
| `attack` | `attack-1.mp3` … `attack-3.mp3` | The unit acknowledges an attack order, or reports that it is unarmed. |
| `unableToComply` | `unableToComply-1.mp3` … `-3.mp3` | The unit cannot carry out the order. |

Unarmed units use an `attack` line that states they carry no weapon, and a
separate `unableToComply` refusal for a rejected order, so the two states remain
distinguishable. The three takes are different sentences, not three readings of
one sentence: the bark channel picks one at random, so repeated orders do not
sound like a stuck loop.

## 2. Voice cast

`src/ui/unitVoice.ts` resolves a definition to its own cast. There is no
borrowed-crew fallback: a unit without recorded lines would be silent, and
`tests/unit-voice.test.ts` fails instead.

### Defender coalition — canonical slots

| Unit | Id | Voice | Speed |
|---|---|---|---:|
| Combat Engineer | `engineer` | `bm_george` | 1.00 |
| Rifleman | `rifle` | `am_echo` | 1.08 |
| ATGM Gunner | `atgm` | `am_michael` | 1.04 |
| Field Medic | `medic` | `bf_emma` | 1.10 |
| Main Battle Tank | `tank` | `am_onyx` | 0.98 |
| Self-Propelled Howitzer | `spg` | `am_eric` | 0.95 |
| Recon Vehicle | `recon` | `am_liam` | 1.06 |
| AA Vehicle | `aa` | `bf_alice` | 1.00 |
| Field Recovery Vehicle | `recovery` | `bm_fable` | 0.98 |
| Harvester | `harvester` | `am_puck` | 0.96 |
| Strike Fighter | `fighter` | `bf_lily` | 1.12 |
| Interceptor | `interceptor` | `af_nova` | 1.12 |
| Recon UAV | `uav` | `af_sky` | 1.10 |
| Missile Boat | `missileBoat` | `af_river` | 1.04 |
| Missile Corvette | `corvette` | `bm_lewis` | 1.00 |
| Attack Submarine | `submarine` | `am_santa` | 1.00 |
| Escort Frigate | `frigate` | `af_nicole` | 0.98 |
| Infantry Fighting Vehicle | `ifv` | `am_liam` | 1.02 |
| Tank Destroyer | `td` | `am_michael` | 1.00 |
| Multiple Rocket Launcher | `rocketArtillery` | `am_eric` | 1.00 |
| Attack Helicopter | `attackHelo` | `bf_lily` | 1.06 |
| Fire Support Ship | `navalSupport` | `af_nicole` | 0.96 |

### National replacements and exclusives

| Unit | Id | Nation | Voice | Speed |
|---|---|---|---|---:|
| Pathfinder Recon Team | `pathfinder` | Lithuania | `bf_isabella` | 1.06 |
| Spearhead MBT | `spearhead` | Poland | `am_fenrir` | 0.98 |
| Rocket Battery | `mlrs` | United Kingdom | `bm_daniel` | 0.96 |
| Heavy Howitzer | `heavyHowitzer` | Russia | `am_adam` | 0.94 |
| Deep Recon UAV | `deepReconUAV` | Belarus | `af_sarah` | 1.08 |
| Hedgehog AT Team | `hedgehogTeam` | Hungary | `am_michael` | 0.98 |
| Kestrel Air Team | `kestrelTeam` | Lithuania | `bf_alice` | 1.08 |
| Wilk Heavy IFV | `wilk` | Poland | `am_onyx` | 1.02 |
| Storm Shadow Battery | `stormShadow` | United Kingdom | `bm_daniel` | 0.94 |
| TOSP Thermobaric Launcher | `tosp` | Russia | `am_eric` | 0.92 |
| Sprut Recon Buggy | `sprut` | Belarus | `af_sky` | 1.06 |
| Taszar Mortar Team | `taszar` | Hungary | `am_echo` | 1.02 |

### Eastern coalition platforms

| Unit | Id | Voice | Speed |
|---|---|---|---:|
| Motor Rifleman | `rifleEC` | `am_adam` | 1.06 |
| Heavy Missile Team | `atgmEC` | `am_fenrir` | 1.02 |
| Recon BRM | `reconEC` | `af_alloy` | 1.04 |
| Amphibious IFV | `ifvEC` | `am_liam` | 1.00 |
| Main Battle Tank | `tankEC` | `am_onyx` | 0.96 |
| Assault Gun | `tdEC` | `am_santa` | 0.98 |
| Self-Propelled Howitzer | `spgEC` | `af_kore` | 0.96 |
| Heavy Rocket Battery | `rocketArtilleryEC` | `af_heart` | 1.02 |
| SAM Vehicle | `aaEC` | `af_aoede` | 1.02 |
| Recon UAV | `uavEC` | `af_jessica` | 1.10 |
| Interceptor | `interceptorEC` | `af_kore` | 1.14 |
| Strike Fighter | `fighterEC` | `am_puck` | 1.10 |
| Attack Helicopter | `attackHeloEC` | `am_fenrir` | 1.04 |
| Missile Boat | `missileBoatEC` | `af_bella` | 1.06 |
| Missile Corvette | `corvetteEC` | `af_heart` | 0.98 |
| Escort Frigate | `frigateEC` | `af_alloy` | 0.98 |
| Attack Submarine | `submarineEC` | `af_aoede` | 0.98 |
| Fire Support Ship | `navalSupportEC` | `af_bella` | 1.00 |

The full script — all 744 sentences — is in `tools/unit-voice/lines.json`, and the
generated manifest records the text that was actually synthesized.

## 3. Uniqueness policy

- Each unit has three distinct lines for each of the four cues, twelve in total.
- No line is used by another unit, including the generic-sounding ones
  ("Negative", "Cannot fire"). A shared hull class still speaks in its own voice.
- The automated test enforces both rules against the manifest, so adding a unit
  with copied lines fails the suite rather than shipping a duplicate bark.

## 4. National accents

Kokoro-82M ships 28 English voices (20 American, 8 British) plus Japanese,
Mandarin, Spanish, French, Hindi, Italian and Portuguese. It has **no
Lithuanian, Polish, Russian, Belarusian, Finnish, Swedish, Persian or Korean
voices**. National units therefore use English voices chosen for coalition fit:
Lithuanian, British, Finnish and Swedish units are British; Russian, Belarusian,
Polish, Hungarian, Iranian and North Korean units are American.

The alternative was tested with Edge TTS native voices. They do not articulate
English clearly enough for a radio bark; local dictation returned, for example:

- `lt-LT-LeonasNeural`, “Scout team, in position.” → “The Scots down enforcer John” (13%).
- `pl-PL-MarekNeural`, “Main battle tank, ready.” → “The main battle tank their the” (22%).
- `ru-RU-DmitryNeural`, “Heavy guns, ready.” → “Hayley dance at” (14%).
- `ru-RU-SvetlanaNeural`, “Recon drone, on station.” → “Finally ended on once the sun” (16%).

Those native clips were not shipped. True national accents need a multilingual
voice service with accent control; that is a separate provider decision, not a
Kokoro voice choice.

## 5. Processing chain

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

## 6. Reproduction

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
speed. Raw Kokoro WAVs are cached in `tmp/unit-voice-raw-kokoro/`; pass
`--refresh` after changing text or voice. `--only <unit>` regenerates one cast and
preserves the other manifest entries.

## 7. Manifest

`public/audio/unit-voice/manifest.json` is version 3. Each cue maps to an array of
three takes:

```json
{
  "version": 3,
  "engine": "kokoro-82m-onnx",
  "preset": "field",
  "sampleRate": 24000,
  "bitrateKbps": 64,
  "cues": ["select", "move", "attack", "unableToComply"],
  "takesPerCue": 3,
  "units": {
    "engineer": {
      "name": "Combat Engineer",
      "role": "Construction / capture",
      "voice": "bm_george",
      "lang": "en-gb",
      "speed": 1.0,
      "lines": {
        "select": [
          {
            "text": "Engineer section, standing by.",
            "file": "engineer/select-1.mp3",
            "durationMs": 1650
          }
        ]
      }
    }
  }
}
```

The runtime layer resolves `defId/<cue>-<take>.mp3` through `src/ui/unitVoice.ts`;
it does not parse the manifest on every bark.

## 8. Audition

Serve the repository root and open the audition page:

```sh
python -m http.server 8788 --bind 127.0.0.1
```

`http://127.0.0.1:8788/docs/unit-voice-audition.html`

The page supports search, role filtering, per-take playback and “Play all
twelve”. It reports the unit, clip and distinct-voice counts directly from the
manifest.

## 9. Verification

| Check | Result |
|---|---|
| Unit definitions covered | 62 |
| Clip count | 744 (62 units × 4 cues × 3 takes) |
| Distinct sentences | 744 |
| Shared sentences | 0 |
| Distinct voices used | 28 |
| Missing/zero-byte files | none |
| Shortest/longest clip | 0.76 s / 2.90 s |
| Total size | 9.2 MB |
| Manifest engine/version | `kokoro-82m-onnx` / 3 |
| Automated completeness test | `tests/unit-voice.test.ts` — 18 tests pass |

`tests/unit-voice.test.ts` checks that every registered `UNITS` entry — canonical,
alliance platform, national replacement and exclusive — has its own cast and all
twelve files, that paths are unique, that files are non-empty, that manifest
metadata matches the unit definitions, that each cue has three distinct takes and
that no sentence is shared between units. It also covers the event-to-cue
mapping, local-team gating, take selection, cooldowns, priority interruption and
the stuck-line watchdog.

### What was not verified

- **No human listening test.** The audition page exists but has not been used by
  reviewers. Perceived clarity, accent fit and fatigue are unmeasured.
- Kokoro synthesis can vary slightly with ONNX runtime/model versions; the
  checked-in MP3s are the authoritative audio.

## 10. Integration status

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
- **Take choice.** Each bark picks one of the three takes at random, so the same
  order repeated after its cooldown can sound different. `speak()` accepts an
  explicit take for deterministic tests.
- **Gating.** Only local-team events are considered, so hidden enemy orders
  cannot produce audio. The bark channel also never starts while the strategic
  announcer is speaking; an announcer line pre-empts a bark.
- **Throttling.** One bark channel, priority selection < move < attack < refusal,
  2.6 s / 1.4 s / 1.6 s / 1.6 s per-cue cooldowns, a 160 ms global gap and a
  6 s watchdog. Box-selecting 20 units cannot fire 20 lines.
- **Volume and mute.** The `unitVoice` setting (default 0.7) is independent of the
  strategic `voice` setting. Master mute, master volume, battle teardown and a
  new battle all clear the bark channel.
- **Simulation boundary.** The barks are presentation-only. No combat, damage,
  visibility, save or objective rule reads them; the event fields are optional
  annotations on existing order events.

## 11. Known limitations

- No genuine Lithuanian, Polish, Russian, Belarusian, Hungarian, Finnish,
  Swedish, Persian or Korean accent is available in Kokoro; see section 4.
- 62 casts share 28 English voices. Different delivery speeds and completely
  different writing keep platforms distinguishable, but two units can share a
  speaker.
- Some selection lines deliberately use role names rather than model names
  (“Warship” for the Missile Corvette, “Missile team” for the ATGM Gunner, “Air
  cover” for the Interceptor) because the model names were less intelligible over
  the radio filter.
- Human acceptance is pending; the current result is an implementation-complete
  asset set, not a validated sound design.
