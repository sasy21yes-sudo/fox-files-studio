"""Bring a narration take to explainer pace: shorter pauses, then speech sped up without changing its pitch.

  python tools/voice_pace.py in.wav out.wav --words 45 [--wpm 170] [--pause 0.18] [--sentence-pause 0.32]

Pauses (RMS under -40 dBFS for more than --pause s) are cut down to --pause, or to --sentence-pause when
they are the longest ones (sentence ends); then WSOLA (audiotsm, made for speech) stretches the rest so
the take lands at --wpm words per minute for its --words words (never slower than it was, at most 1.35x).
Run with a TTS venv that has audiotsm (C:/Users/Admin/AI/tts/voxcpm).
"""
import argparse

import numpy as np
import soundfile as sf


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--words', type=int, required=True)
    ap.add_argument('--wpm', type=float, default=170)
    ap.add_argument('--pause', type=float, default=0.18)
    ap.add_argument('--sentence-pause', type=float, default=0.32)
    a = ap.parse_args()

    x, sr = sf.read(a.src, dtype='float32')
    if x.ndim > 1:
        x = x.mean(1)
    hop = int(sr * 0.01)
    rms = np.sqrt(np.convolve(x * x, np.ones(hop * 3) / (hop * 3), mode='same')[::hop] + 1e-12)
    quiet = 20 * np.log10(rms + 1e-9) < -40
    # Runs of quiet 10 ms frames.
    runs, i = [], 0
    while i < len(quiet):
        if quiet[i]:
            j = i
            while j < len(quiet) and quiet[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    inner = [(s, e) for s, e in runs if s > 0 and e < len(quiet) and (e - s) * 0.01 > a.pause]
    long_ones = sorted(inner, key=lambda r: r[1] - r[0], reverse=True)[: max(1, len(inner) // 3)]
    keep, cur = [], 0
    for s, e in inner:
        target = a.sentence_pause if (s, e) in long_ones else a.pause
        mid = (s + e) // 2
        half = int(target * sr / 2)
        keep.append(x[cur:mid * hop - half])
        cur = mid * hop + half
    keep.append(x[cur:])
    y = np.concatenate(keep)
    # Lead-in / tail silence trimmed to 0.1 s.
    lead = next((k for k, q in enumerate(quiet) if not q), 0)
    tail = next((k for k, q in enumerate(quiet[::-1]) if not q), 0)
    y = y[max(0, lead * hop - int(0.1 * sr)): len(y) - max(0, tail * hop - int(0.1 * sr)) or None]

    want = a.words / a.wpm * 60
    speed = float(np.clip(len(y) / sr / want, 1.0, 1.35))
    if speed > 1.001:
        from audiotsm import wsola
        from audiotsm.io.array import ArrayReader, ArrayWriter
        reader = ArrayReader(y[None, :])
        writer = ArrayWriter(1)
        wsola(1, speed=speed).run(reader, writer)
        y = writer.data[0]
    peak = np.abs(y).max()
    if peak > 0.98:
        y = y * (0.98 / peak)
    sf.write(a.dst, y, sr)
    print(f'{len(x) / sr:.1f}s -> {len(y) / sr:.1f}s ({len(inner)} pauses shortened, speech x{speed:.2f}, {a.words / (len(y) / sr) * 60:.0f} words/min)')


if __name__ == '__main__':
    main()
