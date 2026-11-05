# Battlefield ambience — sound credits

The engines, the base's plant noise and the marching boots are recorded. Every
file below is **CC0 1.0** (public domain dedication), taken from
[OpenGameArt](https://opengameart.org). CC0 asks for no attribution; this file
credits the recordists anyway, and `manifest.json` carries the same rows so the
game data and this page cannot drift apart.

| File | Sound | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| `tank-loop.ogg` | Deep engine rumble, used for heavy tracked hulls | gmason | CC0 1.0 | <https://opengameart.org/content/underwater-or-space-engine-rumble> |
| `jeep-loop.ogg` | Small petrol engine loop, used for wheeled scouts | GGBotNet | CC0 1.0 | <https://opengameart.org/content/car-sound-effects-pack-low-quality> |
| `diesel-loop.ogg` | Larger engine loop, used for light tracks and laden trucks | GGBotNet | CC0 1.0 | <https://opengameart.org/content/car-sound-effects-pack-low-quality> |
| `generator-loop.mp3` | Generator hum, used for working structures | YCbCr | CC0 1.0 | <https://opengameart.org/content/generator-loop> |
| `steps/cloth-1.ogg` … `steps/leather-2.ogg` | Single bootfalls, cut into a stride loop for infantry | HaelDB | CC0 1.0 | <https://opengameart.org/content/footsteps-leather-cloth-armor> |

## What was changed

- Loops are trimmed to at most 12 s when they load, and the seam is closed with
  a 60 ms equal-power crossfade, so a recording that does not loop cleanly
  (the generator, for one) still loops without a click.
- Step one-shots are assembled into a four-step stride at load time, alternating
  variants so the march does not repeat the same footfall.
- Nothing else is altered: pitch, rate and distance shaping happen live in the
  audio graph, per hull, so a parked tank and a rolling one are the same
  recording at different speeds.

Sounds the game still synthesises — rotors, jets, ships, weapons, UI — are
generated in `src/ui/audio.ts` and are not sourced from any recording.
