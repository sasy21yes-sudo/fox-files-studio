"""Shared Kokoro-82M helpers for the studio narrator (render_voice.py, voice_server.py).

Kokoro-82M is an open-weight (Apache-2.0) text-to-speech model. kokoro-onnx runs
it on the CPU with onnxruntime and phonemizes with espeak-ng, which covers
English, Italian, Spanish, French and Brazilian Portuguese.

    pip install kokoro-onnx soundfile numpy

The model files (~330 MB) are downloaded once from the kokoro-onnx GitHub
release into voice/models/ unless --model-dir points somewhere else.
"""
from __future__ import annotations

import os
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "voice" / "models"
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")
SAMPLE_RATE = 24000


def ensure_model(model_dir: Path = MODEL_DIR) -> tuple[Path, Path]:
    model_dir.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        target = model_dir / name
        if not target.exists() or target.stat().st_size < 1_000_000:
            print(f"downloading {name} …", flush=True)
            tmp = target.with_suffix(".part")
            urllib.request.urlretrieve(RELEASE + name, tmp)
            os.replace(tmp, target)
    return model_dir / FILES[0], model_dir / FILES[1]


_engine = None


def engine(model_dir: Path = MODEL_DIR):
    global _engine
    if _engine is None:
        from kokoro_onnx import Kokoro

        model, voices = ensure_model(model_dir)
        _engine = Kokoro(str(model), str(voices))
    return _engine


def synth(text: str, voice: str, lang: str, speed: float = 1.0, model_dir: Path = MODEL_DIR) -> np.ndarray:
    """Speak one sentence. Returns mono float32 at 24 kHz, edges trimmed."""
    samples, sr = engine(model_dir).create(text, voice=voice, speed=speed, lang=lang)
    assert sr == SAMPLE_RATE, sr
    return trim(np.asarray(samples, dtype=np.float32))


def frame_rms(x: np.ndarray, hop: int = 240) -> np.ndarray:
    n = len(x) // hop
    if n == 0:
        return np.zeros(1, dtype=np.float32)
    f = x[: n * hop].reshape(n, hop)
    return np.sqrt((f * f).mean(axis=1) + 1e-12)


def trim(x: np.ndarray, pad: float = 0.04) -> np.ndarray:
    """Cut leading/trailing silence, keeping a short natural pad."""
    rms = frame_rms(x)
    thr = max(rms.max() * 0.02, 1e-4)
    on = np.nonzero(rms > thr)[0]
    if len(on) == 0:
        return x
    hop = 240
    a = max(0, on[0] * hop - int(pad * SAMPLE_RATE))
    b = min(len(x), (on[-1] + 1) * hop + int(pad * SAMPLE_RATE))
    return x[a:b]


def find_splits(x: np.ndarray, parts: list[str]) -> list[float]:
    """Where the subtitle parts of a sentence change: the voice's pause nearest
    the point proportional to the text length (long sentences split at commas)."""
    if len(parts) < 2:
        return []
    hop = 240  # 10 ms
    rms = frame_rms(x, hop)
    dur = len(x) / SAMPLE_RATE
    lens = np.array([len(p) + 1 for p in parts], dtype=np.float64)
    cum = np.cumsum(lens)[:-1] / lens.sum()
    quiet = rms < max(rms.max() * 0.06, 1e-4)
    splits: list[float] = []
    for c in cum:
        target = c * dur
        win = max(0.35, dur * 0.18)
        lo, hi = int((target - win) * 100), int((target + win) * 100)
        lo, hi = max(1, lo), min(len(rms) - 1, hi)
        best, best_score = target, -1e9
        i = lo
        while i < hi:
            if quiet[i]:
                j = i
                while j < hi and quiet[j]:
                    j += 1
                mid = (i + j) / 2 / 100
                score = (j - i) / 100 * 2.0 - abs(mid - target)  # long pauses near the target win
                if score > best_score:
                    best, best_score = mid, score
                i = j
            else:
                i += 1
        if splits and best <= splits[-1] + 0.2:
            best = max(target, splits[-1] + 0.3)
        splits.append(round(float(min(best, dur - 0.1)), 3))
    return splits


def loudness_normalize(clips: list[np.ndarray], target_db: float = -19.0) -> list[np.ndarray]:
    """One gain for the whole narration (keeps natural dynamics), then a soft peak limit."""
    active = np.concatenate([c[np.abs(c) > 1e-3] for c in clips if len(c)]) if clips else np.zeros(1)
    rms = float(np.sqrt((active**2).mean() + 1e-12))
    gain = 10 ** (target_db / 20) / max(rms, 1e-6)
    out = []
    for c in clips:
        y = c * gain
        y = np.tanh(y / 0.89) * 0.89  # peaks stay under -1 dBFS
        out.append(y.astype(np.float32))
    return out
