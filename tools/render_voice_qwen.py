"""Render an Italian studio narration pack with Qwen3-TTS (Apache-2.0), in the same format as
render_voice.py (public/voice/<lang>-<voice>.mp3 + .json), so the app plays it like the Kokoro packs.

The voice is designed once from a description (VoiceDesign model) into a reference clip, then every
sentence is cloned from that clip with the Base model, so the narrator sounds the same throughout.
Text goes through tools/voice_it.py first (numbers, acronyms and names spelled as they are said).

Needs the TTS venv (torch CUDA + qwen-tts):
    C:/Users/Admin/AI/tts/.venv/Scripts/python.exe tools/render_voice_qwen.py --voice it_qwen_narratore
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torchaudio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kokoro_voice as kv  # noqa: E402  (only its numpy helpers: find_splits, loudness_normalize)
from voice_it import speakable_it  # noqa: E402
from qwen_tts import Qwen3TTSModel  # noqa: E402

GAP = 0.35
VOICES = {
    'it_qwen_narratore': 'Narratore italiano maschile di documentari, voce calda e profonda, dizione perfetta, accento italiano '
                         'neutro, ritmo pacato con pause naturali, tono coinvolgente e misterioso come un racconto investigativo.',
    'it_qwen_narratrice': 'Narratrice italiana di documentari, voce calda e chiara, dizione perfetta, accento italiano neutro, '
                          'ritmo pacato con pause naturali, tono coinvolgente e curioso.',
}
REF_TEXT = ("Nel millenovecentosettantasette il Senato degli Stati Uniti tenne un'audizione su un programma segreto. "
            "La maggior parte dei documenti era stata distrutta. Ma non tutti.")


def to_24k(w: np.ndarray, sr: int) -> np.ndarray:
    w = np.asarray(w, dtype=np.float32)
    if sr == kv.SAMPLE_RATE:
        return w
    return torchaudio.functional.resample(torch.from_numpy(w), sr, kv.SAMPLE_RATE).numpy()


def trim(w: np.ndarray) -> np.ndarray:
    """Cut leading/trailing silence (keeps 40 ms)."""
    idx = np.nonzero(np.abs(w) > 0.01)[0]
    if not len(idx):
        return w
    pad = int(0.04 * kv.SAMPLE_RATE)
    return w[max(0, idx[0] - pad): idx[-1] + pad]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', default='it_qwen_narratore', choices=list(VOICES))
    ap.add_argument('--cues', type=Path, default=kv.ROOT / 'voice' / 'cues.json')
    ap.add_argument('--out', type=Path, default=kv.ROOT / 'public' / 'voice')
    ap.add_argument('--ref', type=Path, help='use this reference clip instead of designing one')
    ap.add_argument('--redo', action='append', default=[], help='re-render sentences containing this text (others come from the cache)')
    a = ap.parse_args()
    sentences = json.loads(a.cues.read_text(encoding='utf8'))['languages']['it']['sentences']
    t0 = time.time()

    ref_dir = kv.ROOT / 'voice' / 'refs'
    ref_dir.mkdir(parents=True, exist_ok=True)
    ref_path = a.ref or ref_dir / f'{a.voice}.wav'
    if not ref_path.exists():
        design = Qwen3TTSModel.from_pretrained('Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', device_map='cuda:0', dtype=torch.bfloat16)
        wavs, sr = design.generate_voice_design(text=REF_TEXT, language='Italian', instruct=VOICES[a.voice])
        sf.write(ref_path, wavs[0], sr)
        del design
        torch.cuda.empty_cache()
        print('designed reference', ref_path, flush=True)

    # Every sentence is cached by its text: re-runs only render new or --redo sentences, and the model is
    # loaded only when there is one (the studio calls this after every narration edit).
    import hashlib
    cache = kv.ROOT / 'voice' / 'cache' / a.voice
    cache.mkdir(parents=True, exist_ok=True)
    clone = prompt = None
    clips = []
    for i, s in enumerate(sentences):
        text = speakable_it(s['say'])
        f = cache / (hashlib.sha1(text.encode('utf8')).hexdigest()[:16] + '.wav')
        if f.exists() and not any(r in s['text'] for r in a.redo):
            clips.append(sf.read(f, dtype='float32')[0])
            continue
        if clone is None:
            print('loading the voice model', flush=True)
            clone = Qwen3TTSModel.from_pretrained('Qwen/Qwen3-TTS-12Hz-1.7B-Base', device_map='cuda:0', dtype=torch.bfloat16)
            prompt = clone.create_voice_clone_prompt(ref_audio=str(ref_path), ref_text=REF_TEXT)
        wavs, sr = clone.generate_voice_clone(text=text, language='Italian', voice_clone_prompt=prompt)
        clips.append(trim(to_24k(wavs[0], sr)))
        sf.write(f, clips[-1], kv.SAMPLE_RATE)
        print(f'  {i + 1}/{len(sentences)} {len(clips[-1]) / kv.SAMPLE_RATE:5.2f}s  {text[:70]}', flush=True)

    clips = kv.loudness_normalize(clips)
    gap = np.zeros(int(GAP * kv.SAMPLE_RATE), dtype=np.float32)
    pieces, index, cursor = [gap], {}, len(gap)
    for s, audio in zip(sentences, clips):
        dur = len(audio) / kv.SAMPLE_RATE
        index[s['text']] = [round(cursor / kv.SAMPLE_RATE, 4), round(dur, 4), kv.find_splits(audio, s['parts'])]
        pieces += [audio, gap]
        cursor += len(audio) + len(gap)
    track = np.concatenate(pieces)
    name = f'it-{a.voice}'
    a.out.mkdir(parents=True, exist_ok=True)
    sf.write(a.out / f'{name}.mp3', track, kv.SAMPLE_RATE, format='MP3')
    meta = {
        'version': 1, 'lang': 'it', 'voice': a.voice, 'engine': 'Qwen3-TTS 1.7B (VoiceDesign reference + Base clone)',
        'sampleRate': kv.SAMPLE_RATE, 'audio': f'{name}.mp3', 'duration': round(len(track) / kv.SAMPLE_RATE, 3), 'sentences': index,
    }
    (a.out / f'{name}.json').write_text(json.dumps(meta, ensure_ascii=False, indent=0), encoding='utf8')
    print(f'wrote {name}: {meta["duration"]:.1f}s of audio in {time.time() - t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
