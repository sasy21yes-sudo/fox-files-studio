"""Italian narration samples from VoxCPM2 (OpenBMB, Apache-2.0), to compare by ear.

Run with its own venv (torch CUDA + voxcpm):
    C:/Users/Admin/AI/tts/voxcpm/Scripts/python.exe tools/tts_samples_voxcpm.py [out_dir] [variant,variant...]
Writes <out>/voxcpm_<variant>.wav for the same text as tools/tts_samples.py (scene 1, speakable Italian):
two voices designed from a description (no reference audio), and a clone of the Qwen narrator's timbre.
"""
import sys
import time
from pathlib import Path

import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from voice_it import speakable_it  # noqa: E402
from voxcpm import VoxCPM  # noqa: E402

TEXT = ("Nel 1977, il Senato degli Stati Uniti tenne un'audizione su un programma segreto della CIA. "
        "La maggior parte dei suoi documenti era stata distrutta anni prima. Ma non tutti. "
        "Il programma si chiamava MKUltra. Quindi, che cos'era? E come facciamo a saperlo?")
out = Path(sys.argv[1] if len(sys.argv) > 1 else 'voice_samples')
out.mkdir(parents=True, exist_ok=True)
text = speakable_it(TEXT)
print(text)

t0 = time.time()
model = VoxCPM.from_pretrained('openbmb/VoxCPM2', load_denoiser=False)
sr = model.tts_model.sample_rate
only = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else None
for name, kw in {
    'narratore': {'text': '(Narratore italiano maschile di documentari, voce calda e profonda, dizione perfetta, '
                          'ritmo pacato con pause naturali, tono coinvolgente e misterioso)' + text},
    'narratrice': {'text': '(Narratrice italiana di documentari, voce calda e chiara, dizione perfetta, '
                           'ritmo pacato, tono curioso e coinvolgente)' + text},
    'clone_qwen': {'text': text, 'reference_wav_path': str(out / 'ref_qwen_narratore.wav')},
    # Explainer pace (the plain designs came out ~140 words/min, "slow motion"; YouTube explainers ~170).
    'narratore_veloce': {'text': '(Narratore italiano maschile da video divulgativo su YouTube, voce calda e profonda, dizione perfetta, '
                                 'ritmo veloce e incalzante, energico e coinvolgente, pause brevi)' + text},
    'narratrice_veloce': {'text': '(Narratrice italiana da video divulgativo su YouTube, voce calda e chiara, dizione perfetta, '
                                  'ritmo veloce e incalzante, energica e curiosa, pause brevi)' + text},
}.items():
    if only and name not in only:
        continue
    if 'reference_wav_path' in kw and not Path(kw['reference_wav_path']).exists():
        continue
    wav = model.generate(cfg_value=2.0, inference_timesteps=10, **kw)
    sf.write(out / f'voxcpm_{name}.wav', wav, sr)
    print(name, f'{len(wav) / sr:.1f}s audio', f'{time.time() - t0:.0f}s', flush=True)
