"""Render the studio narration packs (neural voice) for the app.

    node tools/export_cues.mjs              # writes voice/cues.json from the script
    python tools/render_voice.py            # every language and voice
    python tools/render_voice.py --only it:im_nicola,en:am_michael

Each pack is public/voice/<lang>-<voice>.mp3 (all sentences back to back) plus
public/voice/<lang>-<voice>.json (where each sentence starts, how long it is and
where its subtitle cues change). The app plays the pack in preview and mixes it
into the exported video, and times subtitles, pop-ups and lip sync from it.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kokoro_voice as kv  # noqa: E402

GAP = 0.35  # silence between sentences inside a pack


def render_pack(lang: str, voice: dict, sentences: list[dict], out_dir: Path, bitrate: str, model_dir: Path):
    vid = voice["id"]
    t0 = time.time()
    clips, metas = [], []
    for i, s in enumerate(sentences):
        audio = kv.synth(s["say"], vid, voice["kokoroLang"], voice.get("speed", 1.0), model_dir)
        clips.append(audio)
        metas.append(s)
        print(f"  [{lang}:{vid}] {i + 1}/{len(sentences)} {len(audio) / kv.SAMPLE_RATE:5.2f}s  {s['text'][:60]}", flush=True)
    clips = kv.loudness_normalize(clips)
    gap = np.zeros(int(GAP * kv.SAMPLE_RATE), dtype=np.float32)
    pieces, index, cursor = [gap], {}, len(gap)
    for s, audio in zip(metas, clips):
        dur = len(audio) / kv.SAMPLE_RATE
        index[s["text"]] = [round(cursor / kv.SAMPLE_RATE, 4), round(dur, 4), kv.find_splits(audio, s["parts"])]
        pieces += [audio, gap]
        cursor += len(audio) + len(gap)
    track = np.concatenate(pieces)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"{lang}-{vid}"
    if shutil.which("ffmpeg") is None:
        # No ffmpeg (e.g. the studio's own PC): libsndfile writes the MP3 itself.
        sf.write(out_dir / f"{name}.mp3", track, kv.SAMPLE_RATE, format="MP3")
    else:
        with tempfile.TemporaryDirectory() as td:
            wav = Path(td) / "pack.wav"
            sf.write(wav, track, kv.SAMPLE_RATE, subtype="PCM_16")
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-ar", str(kv.SAMPLE_RATE),
                 "-c:a", "libmp3lame", "-b:a", bitrate, str(out_dir / f"{name}.mp3")],
                check=True,
            )
    meta = {
        "version": 1,
        "lang": lang,
        "voice": vid,
        "engine": "Kokoro-82M v1.0 (kokoro-onnx)",
        "sampleRate": kv.SAMPLE_RATE,
        "audio": f"{name}.mp3",
        "duration": round(len(track) / kv.SAMPLE_RATE, 3),
        "sentences": index,
    }
    (out_dir / f"{name}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=0), encoding="utf8")
    print(f"wrote {name}: {meta['duration']:.1f}s of audio in {time.time() - t0:.0f}s", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cues", type=Path, default=kv.ROOT / "voice" / "cues.json")
    ap.add_argument("--out", type=Path, default=kv.ROOT / "public" / "voice")
    ap.add_argument("--only", default="", help="comma list of lang:voice (default: all)")
    ap.add_argument("--bitrate", default="56k")
    ap.add_argument("--model-dir", type=Path, default=kv.MODEL_DIR)
    a = ap.parse_args()
    data = json.loads(a.cues.read_text(encoding="utf8"))
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    for lang, entry in data["languages"].items():
        for voice in entry["voices"]:
            if only and f"{lang}:{voice['id']}" not in only and lang not in only:
                continue
            render_pack(lang, voice, entry["sentences"], a.out, a.bitrate, a.model_dir)


if __name__ == "__main__":
    main()
