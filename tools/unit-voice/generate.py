#!/usr/bin/env python3
"""Generate the unit radio-bark set with local Kokoro-82M ONNX speech.

Pipeline per line:
  Kokoro-82M (24 kHz) -> trim -> radio EQ -> compression -> saturation
  -> carrier noise -> peak normalise -> 24 kHz mono MP3

The text, voice and delivery settings live in lines.json. Generated clips are
written as public/audio/unit-voice/<unit>/<cue>.mp3 together with a manifest.
Raw Kokoro WAVs are cached under tmp/unit-voice-raw-kokoro so the processing
chain can be re-run without synthesising again.

Setup:
  python -m venv .dev/voice-venv
  .dev/voice-venv/Scripts/pip install -r tools/unit-voice/requirements.txt
  # download the two model files described in tools/unit-voice/README.md
  .dev/voice-venv/Scripts/python tools/unit-voice/generate.py

Usage:
  # one unit only
  .dev/voice-venv/Scripts/python tools/unit-voice/generate.py --only tank

  # regenerate speech after editing lines.json
  .dev/voice-venv/Scripts/python tools/unit-voice/generate.py --refresh
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from array import array
from pathlib import Path

try:
    import lameenc
    import soundfile
    from kokoro_onnx import Kokoro
except ImportError:  # pragma: no cover - environment guidance
    sys.exit(
        "Missing voice-generation dependencies. Install them with:\n"
        "  python -m pip install -r tools/unit-voice/requirements.txt"
    )

SAMPLE_RATE = 24_000
BITRATE_KBPS = 64
CUES = ("select", "move", "attack", "unableToComply")

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LINES = Path(__file__).with_name("lines.json")
DEFAULT_OUT = ROOT / "public" / "audio" / "unit-voice"
RAW_DIR = ROOT / "tmp" / "unit-voice-raw-kokoro"
DEFAULT_MODEL = ROOT / "tmp" / "kokoro" / "kokoro-v1.0.onnx"
DEFAULT_VOICES = ROOT / "tmp" / "kokoro" / "voices-v1.0.bin"

PRESETS = {
    "field": {
        "highpass": 200.0,
        "lowpass": 4400.0,
        "presence": 1800.0,
        "presence_gain": 2.5,
        "presence_q": 0.9,
        "comp_threshold": -18.0,
        "comp_ratio": 2.6,
        "comp_attack_ms": 6.0,
        "comp_release_ms": 100.0,
        "makeup_db": 2.5,
        "drive": 1.0,
        "noise_db": -52.0,
        "target_peak_db": -2.0,
    }
}


def db_to_gain(db: float) -> float:
    return 10.0 ** (db / 20.0)


def biquad_coeffs(
    kind: str, sample_rate: int, freq: float, q: float, gain_db: float = 0.0
) -> tuple[float, float, float, float, float]:
    """RBJ cookbook coefficients, normalised by a0."""
    w0 = 2.0 * math.pi * freq / sample_rate
    cos_w = math.cos(w0)
    sin_w = math.sin(w0)
    alpha = sin_w / (2.0 * q)
    if kind == "highpass":
        b0 = (1.0 + cos_w) / 2.0
        b1 = -(1.0 + cos_w)
        b2 = (1.0 + cos_w) / 2.0
        a0 = 1.0 + alpha
        a1 = -2.0 * cos_w
        a2 = 1.0 - alpha
    elif kind == "lowpass":
        b0 = (1.0 - cos_w) / 2.0
        b1 = 1.0 - cos_w
        b2 = (1.0 - cos_w) / 2.0
        a0 = 1.0 + alpha
        a1 = -2.0 * cos_w
        a2 = 1.0 - alpha
    elif kind == "peaking":
        amp = 10.0 ** (gain_db / 40.0)
        b0 = 1.0 + alpha * amp
        b1 = -2.0 * cos_w
        b2 = 1.0 - alpha * amp
        a0 = 1.0 + alpha / amp
        a1 = -2.0 * cos_w
        a2 = 1.0 - alpha / amp
    else:
        raise ValueError(kind)
    return (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)


def apply_biquad(
    samples: list[float], coeffs: tuple[float, float, float, float, float]
) -> list[float]:
    b0, b1, b2, a1, a2 = coeffs
    x1 = x2 = y1 = y2 = 0.0
    out: list[float] = []
    for x in samples:
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        out.append(y)
        x2, x1 = x1, x
        y2, y1 = y1, y
    return out


def trim_silence(
    samples: list[float],
    sample_rate: int,
    relative_db: float = -38.0,
    pre_ms: float = 45.0,
    post_ms: float = 80.0,
) -> list[float]:
    frame = max(1, int(sample_rate * 0.01))
    frames: list[float] = []
    for start in range(0, len(samples), frame):
        chunk = samples[start : start + frame]
        frames.append(math.sqrt(sum(v * v for v in chunk) / max(1, len(chunk))))
    peak = max(frames, default=0.0)
    if peak <= 1e-9:
        return samples
    threshold = peak * db_to_gain(relative_db)
    first = next((i for i, value in enumerate(frames) if value >= threshold), 0)
    last = len(frames) - 1 - next(
        (i for i, value in enumerate(reversed(frames)) if value >= threshold), 0
    )
    start = max(0, first * frame - int(sample_rate * pre_ms / 1000.0))
    end = min(len(samples), (last + 1) * frame + int(sample_rate * post_ms / 1000.0))
    return samples[start:end]


def compress(
    samples: list[float],
    sample_rate: int,
    threshold_db: float,
    ratio: float,
    attack_ms: float,
    release_ms: float,
    makeup_db: float,
) -> list[float]:
    attack = math.exp(-1.0 / (sample_rate * attack_ms / 1000.0))
    release = math.exp(-1.0 / (sample_rate * release_ms / 1000.0))
    env = 0.0
    makeup = db_to_gain(makeup_db)
    out: list[float] = []
    for sample in samples:
        level = abs(sample)
        coeff = attack if level > env else release
        env = coeff * env + (1.0 - coeff) * level
        env_db = 20.0 * math.log10(max(env, 1e-6))
        over = max(0.0, env_db - threshold_db)
        gain = 10.0 ** ((-over * (1.0 - 1.0 / ratio)) / 20.0)
        out.append(sample * gain * makeup)
    return out


def saturate(samples: list[float], drive: float) -> list[float]:
    norm = math.tanh(drive)
    return [math.tanh(sample * drive) / norm for sample in samples]


def band_noise(length: int, seed: int, highpass: float, lowpass: float) -> list[float]:
    rng = random.Random(seed)
    noise = [rng.uniform(-1.0, 1.0) for _ in range(length)]
    noise = apply_biquad(noise, biquad_coeffs("highpass", SAMPLE_RATE, highpass, 0.707))
    noise = apply_biquad(noise, biquad_coeffs("lowpass", SAMPLE_RATE, lowpass, 0.707))
    return noise


def add_carrier_noise(samples: list[float], level_db: float) -> list[float]:
    noise = band_noise(len(samples), 0x4D4341, 420.0, 2800.0)
    rms = math.sqrt(sum(v * v for v in noise) / max(1, len(noise)))
    scale = db_to_gain(level_db) / max(rms, 1e-9)
    return [sample + n * scale for sample, n in zip(samples, noise)]


def normalize_peak(samples: list[float], target_db: float) -> list[float]:
    peak = max((abs(v) for v in samples), default=0.0)
    if peak <= 1e-9:
        return samples
    gain = db_to_gain(target_db) / peak
    return [sample * gain for sample in samples]


def fade_edges(samples: list[float], sample_rate: int, ms: float = 5.0) -> list[float]:
    count = min(len(samples) // 2, int(sample_rate * ms / 1000.0))
    for i in range(count):
        gain = i / count
        samples[i] *= gain
        samples[-1 - i] *= gain
    return samples


def process(raw: list[float], preset: dict[str, float | str]) -> list[float]:
    samples = trim_silence(raw, SAMPLE_RATE)
    samples = apply_biquad(
        samples, biquad_coeffs("highpass", SAMPLE_RATE, float(preset["highpass"]), 0.707)
    )
    samples = apply_biquad(
        samples, biquad_coeffs("lowpass", SAMPLE_RATE, float(preset["lowpass"]), 0.707)
    )
    samples = apply_biquad(
        samples,
        biquad_coeffs(
            "peaking",
            SAMPLE_RATE,
            float(preset["presence"]),
            float(preset["presence_q"]),
            float(preset["presence_gain"]),
        ),
    )
    samples = compress(
        samples,
        SAMPLE_RATE,
        float(preset["comp_threshold"]),
        float(preset["comp_ratio"]),
        float(preset["comp_attack_ms"]),
        float(preset["comp_release_ms"]),
        float(preset["makeup_db"]),
    )
    samples = saturate(samples, float(preset["drive"]))
    samples = add_carrier_noise(samples, float(preset["noise_db"]))
    samples = normalize_peak(samples, float(preset["target_peak_db"]))
    return fade_edges(samples, SAMPLE_RATE)


def decode_wav(path: Path) -> list[float]:
    data, rate = soundfile.read(path, dtype="float32", always_2d=True)
    if rate != SAMPLE_RATE:
        raise ValueError(f"{path} is {rate} Hz, expected {SAMPLE_RATE}")
    channels = data.shape[1]
    if channels == 1:
        return [float(v) for v in data[:, 0]]
    return [float(v) for v in data.mean(axis=1)]


def encode_mp3(path: Path, samples: list[float]) -> None:
    pcm = array(
        "h",
        (
            max(-32768, min(32767, int(round(sample * 32767.0))))
            for sample in samples
        ),
    )
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


def synth_line(
    kokoro: Kokoro, text: str, voice: str, speed: float, destination: Path
) -> None:
    samples, rate = kokoro.create(
        text, voice=voice, speed=speed, lang=voice_language(voice)
    )
    if rate != SAMPLE_RATE:
        raise ValueError(f"Kokoro returned {rate} Hz, expected {SAMPLE_RATE}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    soundfile.write(destination, samples, rate, subtype="PCM_16")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lines", type=Path, default=DEFAULT_LINES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--voices", type=Path, default=DEFAULT_VOICES)
    parser.add_argument("--only", action="append", default=[], help="unit id (repeatable)")
    parser.add_argument("--refresh", action="store_true", help="regenerate cached speech")
    args = parser.parse_args()

    source = json.loads(args.lines.read_text(encoding="utf-8"))
    preset_name = source.get("preset", "field")
    preset = PRESETS[preset_name]
    units: dict[str, dict] = source["units"]
    selected = set(args.only)
    if selected:
        unknown = selected - set(units)
        if unknown:
            parser.error(f"unknown unit id(s): {', '.join(sorted(unknown))}")

    if not args.model.exists() or not args.voices.exists():
        parser.error(
            "Kokoro model files are missing. See tools/unit-voice/README.md for the "
            f"download commands. Expected:\n  {args.model}\n  {args.voices}"
        )

    pending: list[tuple[str, str, str, float, Path]] = []
    for unit_id, unit in units.items():
        if selected and unit_id not in selected:
            continue
        for cue in CUES:
            text = unit["cues"].get(cue)
            if not text:
                parser.error(f"{unit_id} is missing cue {cue}")
            raw = args.raw_dir / unit_id / f"{cue}.wav"
            if args.refresh or not raw.exists() or raw.stat().st_size == 0:
                pending.append((unit_id, text, unit["voice"], float(unit.get("speed", 1.0)), raw))

    if pending:
        print(f"Synthesising {len(pending)} line(s) with Kokoro-82M...")
        kokoro = Kokoro(str(args.model), str(args.voices))
        for index, (unit_id, text, voice, speed, raw) in enumerate(pending, 1):
            synth_line(kokoro, text, voice, speed, raw)
            print(f"  [{index}/{len(pending)}] {unit_id}/{raw.stem}")
    else:
        print("Using cached speech (pass --refresh to regenerate).")

    out_manifest: dict = {
        "version": 2,
        "engine": "kokoro-82m-onnx",
        "preset": preset_name,
        "sampleRate": SAMPLE_RATE,
        "bitrateKbps": BITRATE_KBPS,
        "cues": list(CUES),
        "processing": preset,
        "units": {},
    }

    processed_count = 0
    for unit_id, unit in units.items():
        if selected and unit_id not in selected:
            continue
        voice = unit["voice"]
        entry: dict = {
            "name": unit["name"],
            "role": unit["role"],
            "voice": voice,
            "lang": voice_language(voice),
            "speed": float(unit.get("speed", 1.0)),
            "lines": {},
        }
        for cue in CUES:
            raw = args.raw_dir / unit_id / f"{cue}.wav"
            if not raw.exists() or raw.stat().st_size == 0:
                raise FileNotFoundError(f"missing raw line: {raw}")
            samples = process(decode_wav(raw), preset)
            destination = args.out / unit_id / f"{cue}.mp3"
            encode_mp3(destination, samples)
            entry["lines"][cue] = {
                "text": unit["cues"][cue],
                "file": f"{unit_id}/{cue}.mp3",
                "durationMs": round(len(samples) / SAMPLE_RATE * 1000),
            }
            processed_count += 1
        out_manifest["units"][unit_id] = entry
        print(f"  {unit_id}: {len(entry['lines'])} clips")

    manifest_path = args.out / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(out_manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote {processed_count} clip(s) and {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
