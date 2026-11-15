#!/usr/bin/env python3
"""Split one recorded narrator take into the catalogue's individual cue clips.

The ElevenLabs take is a single file: every line spoken in the order of the
narrator's `cues` list in `lines.json`, separated only by short natural pauses.
This tool finds those pauses, cuts on their midpoints, runs each line through
the narrator's existing processing preset and writes it over the cue's asset
(`public/audio/narrator/<narrator>/<cue>.mp3`), then refreshes the manifest's
record for that narrator.

Usage:
  .dev/voice-venv/Scripts/python tools/narrator-voice/split.py \
    --input tmp/eastern-takes.mp3 --narrator eastern

The cut count is checked against the cue list: the tool refuses to guess when
the number of pauses does not match, and prints every silence it found so the
threshold can be adjusted.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import statistics
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate as catalogue  # noqa: E402  (same directory, shared pipeline)

ROOT = catalogue.ROOT
DEFAULT_LINES = catalogue.DEFAULT_LINES
DEFAULT_MANIFEST = catalogue.DEFAULT_MANIFEST


def ffmpeg_binary() -> str:
    bundled = ROOT / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"
    if bundled.exists():
        return str(bundled)
    found = shutil.which("ffmpeg")
    if not found:
        raise SystemExit("ffmpeg not found: install ffmpeg-static or put ffmpeg on PATH.")
    return found


def decode(path: Path) -> np.ndarray:
    """Decode to the pipeline's 24 kHz mono float samples."""
    result = subprocess.run(
        [
            ffmpeg_binary(),
            "-hide_banner",
            "-v",
            "error",
            "-i",
            str(path),
            "-f",
            "f32le",
            "-ac",
            "1",
            "-ar",
            str(catalogue.SAMPLE_RATE),
            "-",
        ],
        capture_output=True,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.decode("utf-8", "replace")[:800])
    return np.frombuffer(result.stdout, dtype="<f4").astype(np.float32)


def silent_runs(samples: np.ndarray, threshold_db: float, min_seconds: float) -> list[dict]:
    """Contiguous runs below `threshold_db`, ignoring lead-in and lead-out."""
    frame = max(1, int(catalogue.SAMPLE_RATE * 0.01))
    count = len(samples) // frame
    if count == 0:
        return []
    rms = np.sqrt(np.mean(samples[: count * frame].reshape(count, frame) ** 2, axis=1))
    quiet = 20.0 * np.log10(np.maximum(rms, 1e-9)) < threshold_db
    runs: list[dict] = []
    index = 0
    while index < count:
        if not quiet[index]:
            index += 1
            continue
        start = index
        while index < count and quiet[index]:
            index += 1
        seconds = (index - start) * frame / catalogue.SAMPLE_RATE
        if seconds >= min_seconds:
            runs.append(
                {
                    "start": start * frame / catalogue.SAMPLE_RATE,
                    "end": index * frame / catalogue.SAMPLE_RATE,
                    "seconds": seconds,
                }
            )
    # A pause that touches either end of the file is not a boundary between two
    # lines: it is the take's own head or tail.
    edge = 0.05
    return [run for run in runs if run["start"] > edge and run["end"] < len(samples) / catalogue.SAMPLE_RATE - edge]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="single take with every line in cue order")
    parser.add_argument("--narrator", default="eastern")
    parser.add_argument("--lines", type=Path, default=DEFAULT_LINES)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--threshold-db", type=float, default=-35.0)
    parser.add_argument("--min-gap", type=float, default=0.3, help="shortest pause counted as a line break")
    parser.add_argument(
        "--target-rms-db",
        type=float,
        default=-20.4,
        help="median loudness for the set, matching the Defender clips (docs/NARRATORS.md)",
    )
    parser.add_argument("--dry-run", action="store_true", help="print the cuts without writing any audio")
    args = parser.parse_args()

    source = json.loads(args.lines.read_text(encoding="utf-8"))
    entry = source["narrators"][args.narrator]
    cues: list[str] = list(entry["cues"])
    preset = source["presets"][entry["voice"]["preset"]]
    expected = len(cues) - 1

    samples = decode(args.input)
    total = len(samples) / catalogue.SAMPLE_RATE
    runs = silent_runs(samples, args.threshold_db, args.min_gap)
    print(f"{args.input.name}: {total:.2f}s, {len(cues)} cues, {len(runs)} pause(s) >= {args.min_gap}s at {args.threshold_db:g} dBFS")
    for index, run in enumerate(runs, 1):
        print(f"  {index:2d}. {run['start']:.2f}-{run['end']:.2f}s ({run['seconds']:.2f}s)")

    if len(runs) != expected:
        print(
            f"\nExpected {expected} pauses for {len(cues)} cues, found {len(runs)}. "
            "Adjust --threshold-db or --min-gap, or fix the take; nothing was written.",
            file=sys.stderr,
        )
        return 1

    cuts = [int(round(((run["start"] + run["end"]) / 2) * catalogue.SAMPLE_RATE)) for run in runs]
    bounds = [0, *cuts, len(samples)]
    segments = [samples[bounds[i] : bounds[i + 1]] for i in range(len(bounds) - 1)]

    asset_root = ROOT / "public" / entry["assetRoot"].lstrip("/")
    manifest = json.loads(args.manifest.read_text(encoding="utf-8")) if args.manifest.exists() else None
    processed = [(cue, catalogue.process(raw, preset)) for cue, raw in zip(cues, segments)]

    # A different engine arrives at a different crest factor. The set is levelled
    # as a whole rather than per clip, so relative emphasis between lines survives
    # while the narrator stays matched to the Defender recordings.
    levels = [20.0 * math.log10(max(float(np.sqrt(np.mean(line**2))), 1e-9)) for _, line in processed]
    median = statistics.median(levels)
    gain = catalogue.db_to_gain(args.target_rms_db - median)
    print(f"Level before encoding: median {median:.2f} dBFS, applying {20.0 * math.log10(gain):+.2f} dB")

    if args.dry_run:
        for cue, samples in processed:
            print(f"  {cue:<26} {len(samples) / catalogue.SAMPLE_RATE:5.2f}s")
        print("\nDry run: no audio or manifest written.")
        return 0

    def write_set(level_gain: float) -> tuple[dict[str, dict], list[str]]:
        written: dict[str, dict] = {}
        found: list[str] = []
        for cue, samples in processed:
            scaled = samples * level_gain
            peak = float(np.max(np.abs(scaled))) if scaled.size else 0.0
            if peak > catalogue.db_to_gain(catalogue.MAX_PEAK_DB):
                scaled = catalogue.normalize_peak(scaled, -3.2)
            path = asset_root / f"{cue.lower()}.mp3"
            catalogue.encode_mp3(path, scaled)
            metrics = catalogue.measure(path)
            issues = catalogue.problems(metrics, kokoro_generated=True)
            status = "failed" if issues else "ok"
            if issues:
                found.append(f"{cue}: {'; '.join(issues)}")
            written[cue] = {
                "status": status,
                "text": entry["lines"].get(cue),
                "voice": entry["voice"]["voice"],
                "speed": entry["voice"]["speed"],
                "preset": entry["voice"]["preset"],
                "path": f"{entry['assetRoot']}/{cue.lower()}.mp3",
                **metrics,
            }
            print(f"  {cue:<26} {metrics['seconds']:5.2f}s peak {metrics['peakDb']:6.2f} dBFS {status}")
        return written, found

    results, failures = write_set(gain)
    encoded_median = statistics.median(line["rmsDb"] for line in results.values())
    correction = catalogue.db_to_gain(args.target_rms_db - encoded_median)
    if abs(20.0 * math.log10(correction)) > 0.1:
        # MP3 encoding and the edge fades shift measured loudness slightly; one
        # correction pass lands the shipped files on the target, not the samples.
        gain *= correction
        print(f"Level correction after encoding: {20.0 * math.log10(correction):+.2f} dB")
        results, failures = write_set(gain)
        encoded_median = statistics.median(line["rmsDb"] for line in results.values())
    print(f"Level: median {encoded_median:.2f} dBFS (target {args.target_rms_db:.2f} dBFS)")

    if manifest is not None and "narrators" in manifest and args.narrator in manifest["narrators"]:
        manifest["narrators"][args.narrator]["lines"] = results
        args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(f"Manifest updated: {args.manifest.relative_to(ROOT)}")

    if failures:
        print(f"\n{len(failures)} problem(s):", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print(f"Wrote {len(cues)} cue(s) to {asset_root.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
