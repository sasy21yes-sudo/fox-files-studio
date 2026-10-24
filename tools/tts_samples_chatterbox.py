"""Italian narration samples from Chatterbox Multilingual (Resemble AI, MIT), to compare by ear.

Run with its own venv (torch 2.6 CUDA + chatterbox-tts):
    C:/Users/Admin/AI/tts/chatterbox/Scripts/python.exe tools/tts_samples_chatterbox.py [out_dir]
Writes <out>/chatterbox_<variant>.wav for the same text as tools/tts_samples.py (scene 1, speakable Italian):
the model's own voice, the same pushed to a more expressive read, and a clone of the Qwen narrator's timbre
(a 9 s clip of public/voice/it-it_qwen_narratore.mp3), to hear whether the timbre or the delivery is what
does not convince.
"""
import sys
import time
from pathlib import Path

import soundfile as sf
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from voice_it import speakable_it  # noqa: E402
from chatterbox.mtl_tts import ChatterboxMultilingualTTS  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
TEXT = ("Nel 1977, il Senato degli Stati Uniti tenne un'audizione su un programma segreto della CIA. "
        "La maggior parte dei suoi documenti era stata distrutta anni prima. Ma non tutti. "
        "Il programma si chiamava MKUltra. Quindi, che cos'era? E come facciamo a saperlo?")
out = Path(sys.argv[1] if len(sys.argv) > 1 else 'voice_samples')
out.mkdir(parents=True, exist_ok=True)
text = speakable_it(TEXT)
print(text)

# A reference clip of the designed Qwen narrator (Italian, so the clone keeps an Italian accent).
ref = out / 'ref_qwen_narratore.wav'
if not ref.exists():
    audio, sr = sf.read(str(ROOT / 'public/voice/it-it_qwen_narratore.mp3'), dtype='float32')
    if audio.ndim > 1:
        audio = audio.mean(1)
    sf.write(ref, audio[int(0.3 * sr):int(9.3 * sr)], sr)

t0 = time.time()
model = ChatterboxMultilingualTTS.from_pretrained(device='cuda')
torch.manual_seed(7)
for name, kw in {
    'default': {},
    'espressiva': {'exaggeration': 0.7, 'cfg_weight': 0.3},
    'clone_qwen': {'audio_prompt_path': str(ref), 'exaggeration': 0.55, 'cfg_weight': 0.4},
}.items():
    wav = model.generate(text, language_id='it', **kw)
    sf.write(out / f'chatterbox_{name}.wav', wav.squeeze(0).cpu().numpy(), model.sr)
    print(name, f'{wav.shape[-1] / model.sr:.1f}s audio', f'{time.time() - t0:.0f}s', flush=True)
