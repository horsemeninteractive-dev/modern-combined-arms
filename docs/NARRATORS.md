# Battlefield narrators

Modern Combined Arms has two battlefield AI narrators, one per alliance. The
simulation reports the same facts to every seat; the alliance decides which voice
delivers them.

| Alliances | Narrator | Voice | Character |
|---|---|---|---|
| Defender Coalition — Lithuania, Poland, United Kingdom, Finland, Sweden | `defender` | TTSMaker **2403** (Jennifer, UK English female) | Precise, clipped, matter-of-fact reporting |
| Eastern Coalition — Russia, Belarus, Hungary, Iran, North Korea | `eastern` | ElevenLabs **v4** recording (Kokoro `am_adam` only as fallback) | Composed and procedural; one short sentence per cue |

Both narrators read the same cue table, so a line cannot exist in one voice and
be missing in the other.

## Resolution

```
game.player(localSeat).factionId
        │
        ▼
narratorForFaction()            src/data/narrators.ts
        │  identityDef(factionId).allianceId
        ▼
narratorIdForAlliance()         'defender' | 'eastern'
        │
        ▼
AudioEngine.setNarrator(id)     src/ui/audio.ts
        │
        ▼
Announcer.setNarrator(id)       src/ui/announcer.ts
        │
        ▼
narratorVoicePath(id, cue)      ${root}/${cue.file}
```

`App.applyNarrator(game)` is called on every battle-entry path — a fresh
deployment, a networked handoff and a loaded save — immediately after the game is
assigned and before the opening line. It is the only faction check in the voice
path: `announcementForEvent()` stays faction-blind, and no trigger site knows a
voice exists.

Resolution is by **alliance**, not by nation. A new nation inside an existing
alliance needs no narrator change; a new alliance needs one entry in
`NARRATORS`. Unknown, empty or malformed faction ids fall back to the Defender
voice rather than going silent.

The `baltic` and `expeditionary` map presets resolve through the same identity
layer to their alliance narrator, so a legacy map and a named nation of the same
side never disagree.

## Assets

| Narrator | Directory | Format | Provenance |
|---|---|---|---|
| `defender` | `public/audio/narrator/defender/` | 24 kHz mono, 48 kbps MP3 | Existing recording, TTSMaker voice 2403. Authoritative; **not** regenerated. |
| `eastern` | `public/audio/narrator/eastern/` | 24 kHz mono, 64 kbps MP3 | Recorded with ElevenLabs (v4) as one take, split with `tools/narrator-voice/split.py`. Authoritative; **not** regenerated. |

A cue carries one filename (`VOICE_MANIFEST[id].file`, lower case: `unitlost.mp3`)
and the narrator carries the directory, so one cue table covers both voices and
adding a third narrator is a new folder plus one catalogue entry. The generator
writes the same file name for every narrator, because a cue table that asked for
`unitlost.mp3` while the folder held `unitLost.mp3` would 404 in a browser and
still resolve on a case-insensitive filesystem. `tests/narrators.test.ts`
compares the directory listing rather than calling `existsSync` for exactly that
reason.

Both sets were produced outside the Kokoro pipeline and are treated as fixed
assets: the generator reads and validates them but never writes over them, because
both catalogue entries declare a recorded generation. The Defender clips predate
the catalogue and have no recorded script, so their spoken wording is not in the
source tree; `docs/narrator-audition.html` is the listening record for them. The
Eastern wording is catalogued, because the take was made from it.

### Level matching

The two sets were produced by different engines, so the pipeline matches them by
RMS rather than peak. Median loudness across the shipped sets is -20.36 dBFS
(Defender) and -20.35 dBFS (Eastern), so the voices sit within 0.01 dB despite
different engines and very different crest factors.

### Splitting a recorded take

The Eastern set also comes from a single recording session. `split.py` decodes
the take, treats pauses of at least 0.3 s as line breaks, cuts on their midpoints
and runs each line through the narrator's preset before writing the cue files:

```
.dev/voice-venv/Scripts/python tools/narrator-voice/split.py \
  --input tmp/eastern-takes.mp3 --narrator eastern
```

It expects exactly one fewer pause than the narrator has cues and refuses to
write anything otherwise, printing every pause it found so the threshold can be
adjusted; a take with a stray long pause inside a line will not silently shift
the rest of the set. Pauses are detected on the real audio rather than on
ElevenLabs break tags: v3/v4 change pacing when break tags are used. The set is
levelled as a whole to the Defender median, and the narrator's manifest record is
rewritten from the shipped files.

### Reporting register

The two voices differ in wording as well as identity. The Defender AI reports in
two clauses ("Hostile contacts detected. Updating tactical picture."); the Eastern
AI states the fact and stops ("Enemy elements identified."). Eastern lines are one
sentence, median 2.0 s against the Defender set's 1.9 s (1.3–2.5 s), so both land
inside the event they report. `tests/narrators.test.ts` enforces the one-sentence rule.

### Replacing the Eastern voice

The shipped clips are a recording, so replacing the voice means recording the cue
lines in order as one take and re-running `split.py` (above). The cue order comes
from `cues` in `lines.json`; the tool refuses a take whose pause count does not
match, so a missed or merged line cannot ship silently.

The Kokoro path stays available as a fallback. `docs/narrator-voice-candidates.html`
auditions the five plausible male voices on one real cue through the same chain;
render it with `tools/narrator-voice/candidates.py`, listen, then change `voice`
in `tools/narrator-voice/lines.json` and `src/data/narrators.ts`, set the Eastern
entry to `"generation": "kokoro"` and run
`generate.py --refresh --narrator eastern`. That deliberately replaces the
recorded clips, which is why the generation value is the switch rather than a
separate flag. `am_adam` is the current fallback, picked by ear from that page; the
other four remain one edit away.

## Line catalogue

`tools/narrator-voice/lines.json` is the single source for narrator identity,
generation mode, Kokoro fallback voice, processing preset, cue list and spoken
text. It records, per cue:

- the cue id used by `announcementForEvent()`;
- the narrator it belongs to;
- the spoken text (Eastern only — the Defender script is not recorded);
- the Kokoro fallback voice, speed and processing preset;
- the asset path, sample rate, channels, duration, peak and RMS, and a status.

`public/audio/narrator/manifest.json` is the generated audit record of the same
data. `tests/narrators.test.ts` asserts that both narrators cover exactly the
cues the announcer knows, that every referenced file exists and is non-trivial,
and that every manifest entry validated.

Current coverage: 23 cues, 23 Defender clips and 23 Eastern clips. Five cues have
no simulation mechanic yet (`buildingSold`, `reinforcementsAvailable`,
`upgradeComplete`, `siteContested`, `technologyUnlocked`); they stay registered in
both voices and silent until the mechanic exists.

## Generating lines

Kokoro-82M is already installed for `tools/unit-voice`; the narrator tool reuses
that environment and the same model files. Both shipped sets are recorded, so a
run synthesises nothing unless a narrator is switched back to
`"generation": "kokoro"`; by default it validates the assets and refreshes the
manifest.

```sh
# synthesise every Kokoro narrator, reusing cached speech
.dev/voice-venv/Scripts/python tools/narrator-voice/generate.py

# after editing text, voice or preset
.dev/voice-venv/Scripts/python tools/narrator-voice/generate.py --refresh

# assets only: no synthesis, just validation and a manifest refresh
.dev/voice-venv/Scripts/python tools/narrator-voice/generate.py --verify

# one narrator
.dev/voice-venv/Scripts/python tools/narrator-voice/generate.py --narrator eastern
```

Speech is cached under `tmp/narrator-raw-kokoro/<narrator>/<voice>/<cue>.wav`, so
the processing chain can be retuned without synthesising again, and changing the
voice forces fresh speech instead of quietly reusing the previous take.

The tool fails the run if any clip is missing, empty, silent (RMS below -40 dBFS),
clipping (peak above -0.2 dBFS), the wrong sample rate or channel count, or
outside 0.4–8 s. A failed cue is recorded as `status: "failed"` in the manifest
and the process exits non-zero.

## Adding or replacing a narrator

1. Add the narrator to `NARRATORS` in `src/data/narrators.ts` with its alliance,
   asset directory, Kokoro fallback voice, character note and `legacyAssets`.
2. Add the matching entry to `tools/narrator-voice/lines.json` — generation mode,
   voice, speed, preset, the full cue list and the text for every cue.
3. Synthesise it (`generation: "kokoro"`), or record it and run `split.py`
   (`generation: "recorded"`), then run `tests/narrators.test.ts`.
4. Listen to both voices in `docs/narrator-audition.html`.

Replacing a voice keeps the cue ids and asset names, so nothing in the simulation
or the HUD moves: re-record and re-split a recorded set, or switch a Kokoro
narrator's `voice` value and regenerate.

To add a line, add the cue to `AnnouncementId` and `VOICE_MANIFEST`, to
`NARRATOR_CUE_IDS`, and to both narrators' text. The tests fail until every voice
has the cue, which is the point.

## Extension points kept open

Narrator identity (this file's table), spoken content (`lines.json`), audio
playback (`AudioEngine`/`Announcer`) and event mapping (`announcementForEvent`) are
separate. A future visual avatar, extra voices or contextual dialogue can be added
at the presentation layer without touching the simulation event stream.

## Known limitations

- The Defender narrator is an external recording: its script and generation
  settings are unknown, so it cannot be re-synthesised identically. `af_bella` is
  the closest Kokoro female by measured pitch and brightness and is configured for
  any future Defender line, but it will not be a spectral match.
- The Eastern narrator is a recorded take; its Kokoro entries are a fallback for
  new lines, not a way to reproduce the shipped clips. Only a new recording plus
  `split.py` replaces them faithfully.
- The Eastern fallback voice, `am_adam`, is also the voice of two unit bark sets.
  If a future line is synthesised with it, narrator clips are mixed as a clean
  command channel and unit barks as field radio, which keeps them distinguishable
  by treatment rather than voice. `docs/narrator-voice-candidates.html` offers four
  alternates whose takes can be swapped in by name.
- Kokoro has no dedicated "military AI" voice; the two narrators are separated by
  voice identity and reporting register, not by an effect chain.
- Automated checks validate the assets; they cannot judge delivery. The audition
  page exists because that judgement needs a listener.
