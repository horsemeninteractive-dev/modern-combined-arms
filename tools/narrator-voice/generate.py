#!/usr/bin/env python3
"""Generate and validate the battlefield narrator voice sets with Kokoro-82M.

One catalogue (`lines.json`) holds every narrator's identity, Kokoro voice,
processing preset and spoken text. The tool synthesises the narrators marked
`"generation": "kokoro"`, writes their clips and a manifest that records the
line id, narrator, spoken text, voice, speed, asset path, duration and status for
every cue. Narrators marked `"generation": "legacy"` are existing recordings:
their files are verified and recorded but never rewritten.

Pipeline per line:
  Kokoro-82M (24 kHz) -> trim -> highpass -> lowpass -> presence lift
  -> compression -> light saturation -> peak normalise -> fades -> 24 kHz mono MP3

Setup (the Kokoro model files and venv already used by tools/unit-voice):
  python -m venv .dev/voice-venv
  .dev/voice-venv/Scripts/pip install -r tools/unit-voice/requirements.txt
  # model files in tmp/kokoro/ — see tools/unit-voice/README.md

Usage:
  # synthesise every Kokoro narrator (cached speech is reused)
  .dev/voice-venv/Scripts/python tools/narrator-voice/generate.py

  # ignore cached speech after editing a line, voice or preset
  .dev/voice-venv/Scripts/python tools/narrator-voice/generate.py --refresh

  # validate the shipped assets without synthesising anything
  .dev/voice-venv/Scripts/python tools/narrator-voice/generate.py --verify

  # one narrator
  .dev/voice-venv/Scripts/python tools/narrator-voice/generate.py --narrator eastern
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from array import array
from pathlib import Path

try:
    import lameenc
    import numpy as np
    import soundfile
    from kokoro_onnx import Kokoro
except ImportError:  # pragma: no cover - environment guidance
    sys.exit(
        "Missing voice-generation dependencies. Install them with:\n"
        "  python -m pip install -r tools/unit-voice/requirements.txt"
    )

SAMPLE_RATE = 24_000
BITRATE_KBPS = 64
MANIFEST_VERSION = 1
# A battlefield line is one or two short sentences; anything outside this range
# is a synthesised artefact rather than a report.
MIN_SECONDS = 0.4
MAX_SECONDS = 8.0
MIN_RMS_DB = -40.0
MAX_PEAK_DB = -0.2

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LINES = Path(__file__).with_name("lines.json")
DEFAULT_MANIFEST = ROOT / "public" / "audio" / "narrator" / "manifest.json"
RAW_DIR = ROOT / "tmp" / "narrator-raw-kokoro"
DEFAULT_MODEL = ROOT / "tmp" / "kokoro" / "kokoro-v1.0.onnx"
DEFAULT_VOICES = ROOT / "tmp" / "kokoro" / "voices-v1.0.bin"


def db_to_gain(db: float) -> float:
    return 10.0 ** (db / 20.0)


def biquad(kind: str, freq: float, q: float, gain_db: float = 0.0) -> tuple[float, ...]:
    """RBJ cookbook coefficients, normalised by a0."""
    w0 = 2.0 * math.pi * freq / SAMPLE_RATE
    cos_w = math.cos(w0)
    sin_w = math.sin(w0)
    alpha = sin_w / (2.0 * q)
    if kind == "highpass":
        b0, b1, b2 = (1.0 + cos_w) / 2.0, -(1.0 + cos_w), (1.0 + cos_w) / 2.0
        a0, a1, a2 = 1.0 + alpha, -2.0 * cos_w, 1.0 - alpha
    elif kind == "lowpass":
        b0, b1, b2 = (1.0 - cos_w) / 2.0, 1.0 - cos_w, (1.0 - cos_w) / 2.0
        a0, a1, a2 = 1.0 + alpha, -2.0 * cos_w, 1.0 - alpha
    elif kind == "peaking":
        amp = 10.0 ** (gain_db / 40.0)
        b0, b1, b2 = 1.0 + alpha * amp, -2.0 * cos_w, 1.0 - alpha * amp
        a0, a1, a2 = 1.0 + alpha / amp, -2.0 * cos_w, 1.0 - alpha / amp
    else:
        raise ValueError(kind)
    return (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)


def apply_biquad(samples: np.ndarray, coeffs: tuple[float, ...]) -> np.ndarray:
    b0, b1, b2, a1, a2 = coeffs
    out = np.empty_like(samples)
    x1 = x2 = y1 = y2 = 0.0
    for i, x in enumerate(samples):
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        out[i] = y
        x2, x1 = x1, x
        y2, y1 = y1, y
    return out


def trim_silence(
    samples: np.ndarray, relative_db: float = -40.0, pre_ms: float = 35.0, post_ms: float = 70.0
) -> np.ndarray:
    frame = max(1, int(SAMPLE_RATE * 0.01))
    count = len(samples) // frame
    if count == 0:
        return samples
    rms = np.sqrt(np.mean(samples[: count * frame].reshape(count, frame) ** 2, axis=1))
    peak = float(rms.max())
    if peak <= 1e-9:
        return samples
    loud = np.flatnonzero(rms >= peak * db_to_gain(relative_db))
    if loud.size == 0:
        return samples
    start = max(0, int(loud[0]) * frame - int(SAMPLE_RATE * pre_ms / 1000.0))
    end = min(len(samples), (int(loud[-1]) + 1) * frame + int(SAMPLE_RATE * post_ms / 1000.0))
    return samples[start:end]


def compress(
    samples: np.ndarray, threshold_db: float, ratio: float, attack_ms: float, release_ms: float, makeup_db: float
) -> np.ndarray:
    attack = math.exp(-1.0 / (SAMPLE_RATE * attack_ms / 1000.0))
    release = math.exp(-1.0 / (SAMPLE_RATE * release_ms / 1000.0))
    env = 0.0
    gain = np.empty_like(samples)
    for i, sample in enumerate(samples):
        level = abs(float(sample))
        coeff = attack if level > env else release
        env = coeff * env + (1.0 - coeff) * level
        over = max(0.0, 20.0 * math.log10(max(env, 1e-6)) - threshold_db)
        gain[i] = 10.0 ** ((-over * (1.0 - 1.0 / ratio)) / 20.0)
    return samples * gain * db_to_gain(makeup_db)


def normalize_peak(samples: np.ndarray, target_db: float) -> np.ndarray:
    peak = float(np.max(np.abs(samples)))
    if peak <= 1e-9:
        return samples
    return samples * (db_to_gain(target_db) / peak)


def fade_edges(samples: np.ndarray, ms: float = 5.0) -> np.ndarray:
    count = min(len(samples) // 2, int(SAMPLE_RATE * ms / 1000.0))
    if count <= 0:
        return samples
    ramp = np.linspace(0.0, 1.0, count, dtype=np.float32)
    samples[:count] *= ramp
    samples[-count:] *= ramp[::-1]
    return samples


def process(raw: np.ndarray, preset: dict) -> np.ndarray:
    samples = trim_silence(raw.astype(np.float32))
    samples = apply_biquad(samples, biquad("highpass", float(preset["highpass"]), 0.707))
    samples = apply_biquad(samples, biquad("lowpass", float(preset["lowpass"]), 0.707))
    samples = apply_biquad(
        samples,
        biquad(
            "peaking",
            float(preset["presence"]),
            float(preset["presence_q"]),
            float(preset["presence_gain"]),
        ),
    )
    samples = compress(
        samples,
        float(preset["comp_threshold"]),
        float(preset["comp_ratio"]),
        float(preset["comp_attack_ms"]),
        float(preset["comp_release_ms"]),
        float(preset["makeup_db"]),
    )
    drive = float(preset.get("drive", 1.0))
    if drive != 1.0:
        samples = np.tanh(samples * drive) / math.tanh(drive)
    samples = normalize_peak(samples, float(preset["target_peak_db"]))
    return fade_edges(samples)


def encode_mp3(path: Path, samples: np.ndarray) -> None:
    pcm = array("h")
    pcm.frombytes(np.clip(samples * 32767.0, -32768, 32767).astype("<i2").tobytes())
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(BITRATE_KBPS)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    data = encoder.encode(pcm.tobytes()) + encoder.flush()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def voice_language(voice: str) -> str:
    return "en-gb" if voice.startswith(("bm_", "bf_")) else "en-us"


def raw_path(raw_dir: Path, narrator_id: str, line_id: str, voice: str) -> Path:
    """Cache key for one line.

    The voice is part of the name: a cache keyed only by narrator and cue would
    silently reuse the previous voice's speech after a voice change, which looks
    exactly like the change not having been applied.
    """
    return raw_dir / narrator_id / voice / f"{line_id}.wav"


def synth(kokoro: Kokoro, text: str, voice: str, speed: float, destination: Path) -> None:
    samples, rate = kokoro.create(text, voice=voice, speed=speed, lang=voice_language(voice))
    if rate != SAMPLE_RATE:
        raise ValueError(f"Kokoro returned {rate} Hz, expected {SAMPLE_RATE}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    soundfile.write(destination, np.asarray(samples, dtype=np.float32), rate, subtype="PCM_16")


def measure(path: Path) -> dict:
    data, rate = soundfile.read(str(path), dtype="float32", always_2d=True)
    mono = data.mean(axis=1) if data.shape[1] > 1 else data[:, 0]
    peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    rms = float(np.sqrt(np.mean(mono**2))) if mono.size else 0.0
    return {
        "sampleRate": int(rate),
        "channels": int(data.shape[1]),
        "seconds": round(len(mono) / rate, 3) if rate else 0.0,
        "peakDb": round(20.0 * math.log10(peak), 2) if peak > 1e-9 else -120.0,
        "rmsDb": round(20.0 * math.log10(rms), 2) if rms > 1e-9 else -120.0,
    }


def problems(metrics: dict, *, kokoro_generated: bool) -> list[str]:
    found: list[str] = []
    if metrics["sampleRate"] != SAMPLE_RATE:
        found.append(f"{metrics['sampleRate']} Hz, expected {SAMPLE_RATE}")
    if metrics["channels"] != 1:
        found.append(f"{metrics['channels']} channels, expected mono")
    if not (MIN_SECONDS <= metrics["seconds"] <= MAX_SECONDS):
        found.append(f"{metrics['seconds']}s outside {MIN_SECONDS}-{MAX_SECONDS}s")
    if metrics["peakDb"] > MAX_PEAK_DB:
        found.append(f"peak {metrics['peakDb']} dBFS clips")
    if metrics["rmsDb"] < MIN_RMS_DB:
        found.append(f"rms {metrics['rmsDb']} dBFS is effectively silent")
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lines", type=Path, default=DEFAULT_LINES)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--voices", type=Path, default=DEFAULT_VOICES)
    parser.add_argument("--narrator", action="append", default=[], help="narrator id (repeatable)")
    parser.add_argument("--refresh", action="store_true", help="regenerate cached speech")
    parser.add_argument("--verify", action="store_true", help="validate assets only")
    args = parser.parse_args()

    source = json.loads(args.lines.read_text(encoding="utf-8"))
    presets: dict[str, dict] = source["presets"]
    narrators: dict[str, dict] = source["narrators"]
    selected = set(args.narrator)
    if selected:
        unknown = selected - set(narrators)
        if unknown:
            parser.error(f"unknown narrator id(s): {', '.join(sorted(unknown))}")

    synthesise = [
        (narrator_id, entry)
        for narrator_id, entry in narrators.items()
        if entry.get("generation") == "kokoro" and (not selected or narrator_id in selected)
    ]

    if not args.verify and synthesise and (not args.model.exists() or not args.voices.exists()):
        parser.error(
            "Kokoro model files are missing. See tools/unit-voice/README.md for the "
            f"download commands. Expected:\n  {args.model}\n  {args.voices}"
        )

    if not args.verify and synthesise:
        pending: list[tuple[str, str, str, float, Path]] = []
        for narrator_id, entry in synthesise:
            voice = entry["voice"]
            for line_id, text in entry["lines"].items():
                raw = raw_path(args.raw_dir, narrator_id, line_id, voice["voice"])
                if args.refresh or not raw.exists() or raw.stat().st_size == 0:
                    pending.append((narrator_id, text, voice["voice"], float(voice["speed"]), raw))
        if pending:
            print(f"Synthesising {len(pending)} narrator line(s) with Kokoro-82M...")
            kokoro = Kokoro(str(args.model), str(args.voices))
            for index, (narrator_id, text, voice, speed, raw) in enumerate(pending, 1):
                synth(kokoro, text, voice, speed, raw)
                print(f"  [{index}/{len(pending)}] {narrator_id}/{raw.stem}")
        else:
            print("Using cached speech (pass --refresh to regenerate).")

    manifest: dict = {
        "version": MANIFEST_VERSION,
        "engine": "kokoro-82m-onnx",
        "sampleRate": SAMPLE_RATE,
        "bitrateKbps": BITRATE_KBPS,
        "narrators": {},
    }
    # A single-narrator run keeps the other record: the manifest is the audit of
    # both voices, and dropping the untouched one would make `--narrator eastern`
    # look like the Defender set had disappeared.
    if selected and args.manifest.exists():
        try:
            previous = json.loads(args.manifest.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            previous = {}
        if previous.get("version") == MANIFEST_VERSION:
            manifest["narrators"].update(
                {key: value for key, value in previous.get("narrators", {}).items() if key not in selected}
            )
    failures: list[str] = []

    for narrator_id, entry in narrators.items():
        if selected and narrator_id not in selected:
            continue
        voice = entry["voice"]
        generated = entry.get("generation") == "kokoro"
        # The catalogue records public URLs; the files live under public/.
        root = ROOT / "public" / entry["assetRoot"].lstrip("/")
        record: dict = {
            "label": entry.get("label", narrator_id),
            "generation": entry.get("generation"),
            "assetRoot": entry["assetRoot"],
            "voice": voice,
            # A legacy narrator is described by the voice that actually made its
            # files, not by the Kokoro fallback recorded for future lines.
            "assetVoice": entry.get("assetVoice", f"Kokoro-82M {voice['voice']}"),
            "notes": entry.get("notes", ""),
            "lines": {},
        }
        # Both narrators declare their cue list, so a legacy folder is recorded
        # under the same ids as a generated one and cannot silently drift.
        for line_id in entry.get("cues") or sorted(entry["lines"]):
            text = entry["lines"].get(line_id) if generated else None
            # The runtime cue table owns the filename (`VOICE_MANIFEST[id].file`),
            # and every existing recording is named after its cue id in lower case
            # (`unitlost.mp3`). Writing `unitLost.mp3` here would 404 in a browser
            # while still resolving on a case-insensitive filesystem.
            path = root / f"{line_id.lower()}.mp3"
            if generated:
                raw = raw_path(args.raw_dir, narrator_id, line_id, voice["voice"])
                if not raw.exists():
                    failures.append(f"{narrator_id}/{line_id}: no cached speech")
                    continue
                samples = process(soundfile.read(str(raw), dtype="float32")[0], presets[voice["preset"]])
                encode_mp3(path, samples)
            if not path.exists() or path.stat().st_size == 0:
                failures.append(f"{narrator_id}/{line_id}: missing asset {path}")
                continue
            metrics = measure(path)
            issues = problems(metrics, kokoro_generated=generated)
            if issues:
                failures.append(f"{narrator_id}/{line_id}: {'; '.join(issues)}")
            record["lines"][line_id] = {
                "status": "failed" if issues else "ok",
                "text": text,
                "voice": voice["voice"],
                "speed": voice["speed"],
                "preset": voice["preset"],
                "path": f"{entry['assetRoot']}/{line_id.lower()}.mp3",
                **metrics,
            }
            print(
                f"  {narrator_id}/{line_id}: {metrics['seconds']}s peak {metrics['peakDb']} dBFS "
                f"{'FAILED' if issues else 'ok'}"
            )
        manifest["narrators"][narrator_id] = record

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Manifest written to {args.manifest.relative_to(ROOT)}")

    if failures:
        print(f"\n{len(failures)} validation problem(s):")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("All narrator assets validated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
