"""Bring studio voice packs to explainer pace and an even level, sentence by sentence (pitch kept).

  python tools/voice_pack_pace.py public/voice/it-it_qwen_narratore.json [more packs...] [--sps 6.6] [--max 1.35]

Run it on packs as rendered (tools/render_voice.py / render_voice_qwen.py), never twice: a pack that already
has "pace" in its json is skipped. For every sentence clip:
- speed: the clip is sped up (WSOLA, audiotsm) so it speaks about --sps syllables per second (counted from its
  text, vowel groups), never slower than recorded, at most --max. One factor per sentence: a single factor for
  the whole pack left some sentences at 9.6 syllables/s and others still slow (review, 2026-10-24).
- edges: 0.15 s of silence is added around the clip before the stretch and trimmed after, then a 25 ms fade:
  stretching the exact clip lost its last frame and cut the final vowel in 10 of 49 sentences.
- level: every sentence brought to the pack's median speech level (RMS of its voiced part), so the voice no
  longer jumps 7 dB from one sentence to the next.
The breaths between sentences stay the timeline's job. The json gets the new offsets, durations, subtitle split
points and "pace" (the mean factor). Needs audiotsm + soundfile (C:/Users/Admin/AI/tts/voxcpm) and ffmpeg.
The owner found ~125-140 wpm packs "a rallentatore" (2026-10-24).
"""
import argparse
import json
import os
import re
import subprocess
import tempfile

import numpy as np
import soundfile as sf
from audiotsm import wsola
from audiotsm.io.array import ArrayReader, ArrayWriter

GAP = 0.35  # silence before each sentence in the pack's mp3, as rendered
PAD = 0.15
FADE = 0.025
VOWELS = re.compile(r'[aeiouyàèéìíòóùúâêîôûãõäëïöüœæ]+', re.I)


def syllables(text):
    return max(1, len(VOWELS.findall(text)))


def stretch(x, speed, sr):
    pad = np.zeros(int(PAD * sr), np.float32)
    y = np.concatenate([pad, x, pad])
    if speed > 1.001:
        w = ArrayWriter(1)
        wsola(1, speed=speed).run(ArrayReader(y[None, :]), w)
        y = w.data[0].astype(np.float32)
    p = int(round(PAD * sr / speed))
    y = y[p:len(y) - p] if len(y) > 2 * p else y
    f = min(int(FADE * sr), len(y) // 4)
    if f > 1:
        y[:f] *= np.linspace(0, 1, f)
        y[-f:] *= np.linspace(1, 0, f)
    return y


def speech_rms(x, sr):
    """RMS of the voiced part (frames within 30 dB of the loudest)."""
    hop = int(0.02 * sr)
    if len(x) < hop:
        return float(np.sqrt(np.mean(x * x) + 1e-12))
    fr = x[: len(x) // hop * hop].reshape(-1, hop)
    e = np.sqrt((fr * fr).mean(1) + 1e-12)
    v = e[e > e.max() * 10 ** (-30 / 20)]
    return float(np.sqrt(np.mean(v * v)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('packs', nargs='+')
    ap.add_argument('--sps', type=float, default=6.6, help='target syllables per second while speaking')
    ap.add_argument('--max', type=float, default=1.35)
    a = ap.parse_args()
    for path in a.packs:
        d = json.load(open(path, encoding='utf-8'))
        name = os.path.basename(path)
        if 'pace' in d:
            print(f'{name}: already paced (x{d["pace"]}), skipped - re-render it first')
            continue
        s = d['sentences']
        mp3 = os.path.join(os.path.dirname(path), d['audio'])
        audio, sr = sf.read(mp3, dtype='float32')
        if audio.ndim > 1:
            audio = audio.mean(1)
        clips = {t: audio[int(round(st * sr)):int(round((st + du) * sr))] for t, (st, du, _) in s.items()}
        speeds = {t: float(np.clip(a.sps / (syllables(t) / max(0.2, s[t][1])), 1.0, a.max)) for t in s}
        levels = {t: speech_rms(c, sr) for t, c in clips.items()}
        ref = float(np.median(list(levels.values())))
        parts, out, cur = [], {}, 0.0
        for text, (start, dur, splits) in s.items():
            sp = speeds[text]
            fast = stretch(clips[text], sp, sr) * min(4.0, ref / max(levels[text], 1e-6))
            parts.append(np.zeros(int(GAP * sr), np.float32))
            cur += GAP
            nd = len(fast) / sr
            out[text] = [round(cur, 4), round(nd, 4), [round(t / sp, 4) for t in splits]]
            parts.append(fast.astype(np.float32))
            cur += nd
        y = np.concatenate(parts)
        peak = float(np.abs(y).max())
        if peak > 0.98:
            y *= 0.98 / peak
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, 'pack.wav')
            sf.write(wav, y, sr, subtype='PCM_16')
            # (mono mp3 like tools/render_voice.py; a higher bitrate since this is a second encode)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', str(sr), '-c:a', 'libmp3lame', '-b:a', '128k', mp3], check=True)
        words = sum(len(t.split()) for t in s)
        before = words / sum(v[1] for v in s.values()) * 60
        after = words / sum(v[1] for v in out.values()) * 60
        spread = 20 * np.log10(max(levels.values()) / min(levels.values()))
        d['sentences'] = out
        d['duration'] = round(len(y) / sr, 3)
        d['pace'] = round(float(np.mean(list(speeds.values()))), 4)
        json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
        sp = list(speeds.values())
        print(f'{name}: {before:.0f} -> {after:.0f} wpm, speed x{min(sp):.2f}..x{max(sp):.2f} (mean {np.mean(sp):.2f}), sentence levels {spread:.1f} dB apart -> even')


if __name__ == '__main__':
    main()
