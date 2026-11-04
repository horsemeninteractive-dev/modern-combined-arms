#!/usr/bin/env python3
"""Render one real narrator line in every plausible male voice.

The narrator voice is a judgement call, not a measurement, so this tool exists to
make the choice cheap: it synthesises the same cue with each candidate through the
same processing chain the narrator generator uses, writes the clips under
`tmp/narrator-voice-candidates/`, and prints a table of duration and level.

Pick a name from the table, put it in `lines.json` (and `src/data/narrators.ts`),
then re-run `generate.py --refresh` to rebuild the shipping set.

Usage:
  .dev/voice-venv/Scripts/python tools/narrator-voice/candidates.py
  .dev/voice-venv/Scripts/python tools/narrator-voice/candidates.py --cue victory
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate import (  # noqa: E402  (path set above)
    DEFAULT_LINES,
    DEFAULT_MODEL,
    DEFAULT_VOICES,
    ROOT,
    encode_mp3,
    measure,
    process,
    synth,
)

CANDIDATES = (
    'am_michael',
    'am_onyx',
    'am_adam',
    'am_eric',
    'am_liam',
)
DEFAULT_OUT = ROOT / 'tmp' / 'narrator-voice-candidates'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lines', type=Path, default=DEFAULT_LINES)
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    parser.add_argument('--cue', default='enemyDetected')
    parser.add_argument('--model', type=Path, default=DEFAULT_MODEL)
    parser.add_argument('--voices', type=Path, default=DEFAULT_VOICES)
    parser.add_argument('--voice', action='append', default=[], help='limit to a voice (repeatable)')
    args = parser.parse_args()

    if not args.model.exists() or not args.voices.exists():
        print('Kokoro model files are missing. See tools/unit-voice/README.md.', file=sys.stderr)
        return 1

    source = json.loads(args.lines.read_text(encoding='utf-8'))
    eastern = source['narrators']['eastern']
    preset = source['presets'][eastern['voice']['preset']]
    text = eastern['lines'].get(args.cue)
    if not text:
        print(f'unknown cue "{args.cue}" for the eastern narrator', file=sys.stderr)
        return 1

    wanted = tuple(args.voice) or CANDIDATES
    kokoro = None
    args.out.mkdir(parents=True, exist_ok=True)
    print(f'{args.cue}: "{text}"')
    for voice in wanted:
        raw = args.out / f'{voice}.wav'
        if not raw.exists():
            if kokoro is None:
                from kokoro_onnx import Kokoro

                kokoro = Kokoro(str(args.model), str(args.voices))
            synth(kokoro, text, voice, float(eastern['voice']['speed']), raw)
        samples = process(np.asarray(soundfile.read(str(raw), dtype='float32')[0]), preset)
        mp3 = args.out / f'{voice}.mp3'
        encode_mp3(mp3, samples)
        metrics = measure(mp3)
        print(
            f'  {voice:12} {metrics["seconds"]:>5.2f}s  peak {metrics["peakDb"]:>6.2f} dBFS  '
            f'rms {metrics["rmsDb"]:>6.2f} dBFS  -> {mp3.relative_to(ROOT)}'
        )
    print(f'\nAudition page: docs/narrator-voice-candidates.html (serve the dev server)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
