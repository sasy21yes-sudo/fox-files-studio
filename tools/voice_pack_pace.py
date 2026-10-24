"""Bring studio voice packs to explainer pace: every sentence clip sped up (WSOLA, pitch kept) so the pack speaks
--wpm words per minute while it speaks; the breaths between sentences stay the timeline's job.

  python tools/voice_pack_pace.py public/voice/it-it_qwen_narratore.json [more packs...] [--wpm 168] [--max 1.35]

Packs already at or above --wpm are left alone. The pack's mp3 is rewritten (ffmpeg, libmp3lame), the json gets the
new offsets, durations and subtitle split points, plus "pace": the factor applied (so it is never applied twice:
the tool measures the pack as it is). Run with a venv that has audiotsm + soundfile (C:/Users/Admin/AI/tts/voxcpm)
and ffmpeg on PATH. The owner found ~125-140 wpm packs "a rallentatore" (2026-10-24).
"""
import argparse
import json
import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf
from audiotsm import wsola
from audiotsm.io.array import ArrayReader, ArrayWriter

GAP = 0.35  # silence before each sentence in the pack's mp3, as rendered


def stretch(x, speed):
    if speed <= 1.001:
        return x
    w = ArrayWriter(1)
    wsola(1, speed=speed).run(ArrayReader(x[None, :]), w)
    return w.data[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('packs', nargs='+')
    ap.add_argument('--wpm', type=float, default=168)
    ap.add_argument('--max', type=float, default=1.35)
    a = ap.parse_args()
    for path in a.packs:
        d = json.load(open(path, encoding='utf-8'))
        s = d['sentences']
        words = sum(len(k.split()) for k in s)
        speech = sum(v[1] for v in s.values())
        wpm = words / speech * 60
        speed = min(a.max, a.wpm / wpm)
        name = os.path.basename(path)
        if speed <= 1.01:
            print(f'{name}: {wpm:.0f} wpm, left as it is')
            continue
        mp3 = os.path.join(os.path.dirname(path), d['audio'])
        audio, sr = sf.read(mp3, dtype='float32')
        if audio.ndim > 1:
            audio = audio.mean(1)
        parts, out, cur = [], {}, 0.0
        for text, (start, dur, splits) in s.items():
            seg = audio[int(round(start * sr)):int(round((start + dur) * sr))]
            fast = stretch(seg, speed).astype(np.float32)
            parts.append(np.zeros(int(GAP * sr), np.float32))
            cur += GAP
            nd = len(fast) / sr
            out[text] = [round(cur, 4), round(nd, 4), [round(t / speed, 4) for t in splits]]
            parts.append(fast)
            cur += nd
        y = np.concatenate(parts)
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, 'pack.wav')
            sf.write(wav, y, sr, subtype='PCM_16')
            # (encoded like tools/render_voice.py does, so offsets mean the same thing)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', str(sr), '-c:a', 'libmp3lame', '-b:a', '128k', mp3], check=True)
        d['sentences'] = out
        d['duration'] = round(len(y) / sr, 3)
        d['pace'] = round(speed * d.get('pace', 1.0), 4)
        json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
        print(f'{name}: {wpm:.0f} -> {words / (speech / speed) * 60:.0f} wpm (x{speed:.2f}), {d["duration"]:.1f} s')


if __name__ == '__main__':
    main()
