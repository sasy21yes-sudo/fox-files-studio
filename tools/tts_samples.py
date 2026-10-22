"""Italian narration samples from Qwen3-TTS (Apache-2.0), to compare by ear with Kokoro.

Run with the TTS venv (C:/Users/Admin/AI/tts/.venv): python tools/tts_samples.py [out_dir]
Writes <out>/qwen_<variant>.wav for the same text (scene 1, made speakable by voice_it.py).
"""
import sys
import time
from pathlib import Path

import soundfile as sf
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from voice_it import speakable_it  # noqa: E402
from qwen_tts import Qwen3TTSModel  # noqa: E402

TEXT = ("Nel 1977, il Senato degli Stati Uniti tenne un'audizione su un programma segreto della CIA. "
        "La maggior parte dei suoi documenti era stata distrutta anni prima. Ma non tutti. "
        "Il programma si chiamava MKUltra. Quindi, che cos'era? E come facciamo a saperlo?")
out = Path(sys.argv[1] if len(sys.argv) > 1 else 'voice_samples')
out.mkdir(parents=True, exist_ok=True)
text = speakable_it(TEXT)
print(text)

t0 = time.time()
design = Qwen3TTSModel.from_pretrained('Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', device_map='cuda:0', dtype=torch.bfloat16)
for name, desc in {
    'narratore': 'Narratore italiano maschile di documentari, voce calda e profonda, dizione perfetta, accento italiano neutro, '
                 'ritmo pacato con pause naturali, tono coinvolgente e misterioso come un racconto investigativo.',
    'narratrice': 'Narratrice italiana di documentari, voce calda e chiara, dizione perfetta, accento italiano neutro, '
                  'ritmo pacato con pause naturali, tono coinvolgente e curioso.',
}.items():
    wavs, sr = design.generate_voice_design(text=text, language='Italian', instruct=desc)
    sf.write(out / f'qwen_design_{name}.wav', wavs[0], sr)
    print(name, f'{len(wavs[0]) / sr:.1f}s audio', f'{time.time() - t0:.0f}s', flush=True)
