"""
Generative fill for frame-by-frame drawings: what a cut-out move had to invent (a sleeve's opened edge, the
shoulder a turned arm uncovered) is redrawn by Qwen-Image-Edit in ComfyUI, only inside a mask.

  python tools/clips/genfill.py <frames dir> [--prompt "..."] [--denoise 0.75] [--seed 7] [--scale 3]

For every f####.png that has a _mask_f####.png next to it (white = redraw; written by limb_puppet.py
--fill-masks), the area around the mask is cropped, upscaled (the model draws better big), sampled with the
drawing itself as the edit reference and a latent noise mask (nothing outside the mask is regenerated),
scaled back, keyed off the green screen and blended in with a feathered edge. Same seed for every drawing,
so neighbouring drawings get the same kind of strokes (what changes reads as line boil, not flicker).
Frames are rewritten in place; the originals are kept as _orig_f####.png.
"""
import argparse, json, os, sys, time, urllib.parse, urllib.request, uuid
import cv2, numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_clip import key  # noqa: E402
from inbetween import upload, on_green  # noqa: E402

SERVER = os.environ.get('COMFY_URL', 'http://127.0.0.1:8188')
MODEL = 'qwen_image_edit_2511_fp8mixed.safetensors'
TEXT_ENCODER = 'qwen_2.5_vl_7b_fp8_scaled.safetensors'
VAE = 'qwen_image_vae.safetensors'
LIGHTNING = 'Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors'
PROMPT = ('Inside the masked area, finish the drawing: continue the brown coat sleeve and the shoulder naturally, '
          'with the same dark-brown ink outline, the same flat colours and the same soft cel shade as the rest. '
          '1930s rubber-hose cartoon with a hand-painted finish. Keep everything else exactly the same. '
          'Background: flat pure chroma-key green.')


def api(path, data=None, ctype='application/json'):
    req = urllib.request.Request(SERVER + path, data=data, headers={'Content-Type': ctype} if data else {})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read()
    return json.loads(body) if r.headers.get('Content-Type', '').startswith('application/json') else body


def graph(img, mask, prompt, seed, denoise):
    return {
        'unet': {'class_type': 'UNETLoader', 'inputs': {'unet_name': MODEL, 'weight_dtype': 'default'}},
        'lora': {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['unet', 0], 'lora_name': LIGHTNING, 'strength_model': 1.0}},
        'clip': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': TEXT_ENCODER, 'type': 'qwen_image', 'device': 'default'}},
        'vae': {'class_type': 'VAELoader', 'inputs': {'vae_name': VAE}},
        'shift': {'class_type': 'ModelSamplingAuraFlow', 'inputs': {'model': ['lora', 0], 'shift': 3.1}},
        'cfgnorm': {'class_type': 'CFGNorm', 'inputs': {'model': ['shift', 0], 'strength': 1.0}},
        'img': {'class_type': 'LoadImage', 'inputs': {'image': img}},
        'mimg': {'class_type': 'LoadImage', 'inputs': {'image': mask}},
        'mask': {'class_type': 'ImageToMask', 'inputs': {'image': ['mimg', 0], 'channel': 'red'}},
        'pos': {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': {'clip': ['clip', 0], 'vae': ['vae', 0], 'prompt': prompt, 'image1': ['img', 0]}},
        'neg': {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': {'clip': ['clip', 0], 'vae': ['vae', 0], 'prompt': '', 'image1': ['img', 0]}},
        'posref': {'class_type': 'FluxKontextMultiReferenceLatentMethod', 'inputs': {'conditioning': ['pos', 0], 'reference_latents_method': 'index_timestep_zero'}},
        'negref': {'class_type': 'FluxKontextMultiReferenceLatentMethod', 'inputs': {'conditioning': ['neg', 0], 'reference_latents_method': 'index_timestep_zero'}},
        'enc': {'class_type': 'VAEEncode', 'inputs': {'pixels': ['img', 0], 'vae': ['vae', 0]}},
        'noise': {'class_type': 'SetLatentNoiseMask', 'inputs': {'samples': ['enc', 0], 'mask': ['mask', 0]}},
        'sample': {'class_type': 'KSampler', 'inputs': {
            'model': ['cfgnorm', 0], 'positive': ['posref', 0], 'negative': ['negref', 0], 'latent_image': ['noise', 0],
            'seed': seed, 'steps': 8, 'cfg': 1.0, 'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': denoise}},
        'decode': {'class_type': 'VAEDecode', 'inputs': {'samples': ['sample', 0], 'vae': ['vae', 0]}},
        'save': {'class_type': 'SaveImage', 'inputs': {'images': ['decode', 0], 'filename_prefix': 'foxfiles_fill'}},
    }


def run(g):
    pid = api('/prompt', json.dumps({'prompt': g, 'client_id': uuid.uuid4().hex}).encode())['prompt_id']
    while True:
        time.sleep(1.5)
        h = api(f'/history/{pid}')
        if pid in h:
            st = h[pid].get('status', {})
            if st.get('status_str') == 'error':
                sys.exit('ComfyUI error: ' + json.dumps(st.get('messages', []))[-1500:])
            im = h[pid]['outputs']['save']['images'][0]
            q = urllib.parse.urlencode({'filename': im['filename'], 'subfolder': im['subfolder'], 'type': im['type']})
            return cv2.imdecode(np.frombuffer(api(f'/view?{q}'), np.uint8), cv2.IMREAD_COLOR)


def fill(frame, mask, prompt, seed, denoise, scale, ctx):
    """frame BGRA float, mask bool -> frame with the masked area redrawn."""
    H, W = frame.shape[:2]
    ys, xs = np.nonzero(mask)
    cx0, cy0 = max(0, xs.min() - ctx), max(0, ys.min() - ctx)
    cx1, cy1 = min(W, xs.max() + ctx + 1), min(H, ys.max() + ctx + 1)
    crop = on_green(frame[cy0:cy1, cx0:cx1])
    m = mask[cy0:cy1, cx0:cx1].astype(np.uint8) * 255
    tw = int(round((cx1 - cx0) * scale / 16)) * 16
    th = int(round((cy1 - cy0) * scale / 16)) * 16
    big = cv2.resize(crop, (tw, th), interpolation=cv2.INTER_LANCZOS4)
    bm = cv2.resize(cv2.dilate(m, np.ones((5, 5), np.uint8)), (tw, th), interpolation=cv2.INTER_LINEAR)
    out = run(graph(upload(big, f'gf_{uuid.uuid4().hex[:8]}.png'), upload(cv2.merge([bm, bm, bm]), f'gm_{uuid.uuid4().hex[:8]}.png'), prompt, seed, denoise))
    out = cv2.resize(out, (cx1 - cx0, cy1 - cy0), interpolation=cv2.INTER_AREA)
    patch = key(out)
    w = cv2.GaussianBlur(cv2.dilate(m, np.ones((3, 3), np.uint8)).astype(np.float32) / 255, (0, 0), 1.2)[..., None]
    res = frame.copy()
    region = res[cy0:cy1, cx0:cx1]
    # premultiplied blend of the redrawn patch over the drawing, inside the feathered mask
    pa, pr = patch[..., 3:] / 255, region[..., 3:] / 255
    rgb = (patch[..., :3] * pa * w + region[..., :3] * pr * (1 - w))
    alpha = pa * w + pr * (1 - w)
    region[..., :3] = rgb / np.maximum(alpha, 1e-4)
    region[..., 3:] = alpha * 255
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dir')
    ap.add_argument('--prompt', default=PROMPT)
    ap.add_argument('--denoise', type=float, default=0.75)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--scale', type=float, default=3)
    ap.add_argument('--context', type=int, default=48, help='px of drawing around the mask the model sees')
    ap.add_argument('--only', default='', help='redo just these drawings, e.g. f0008,f0010 (from their _orig_)')
    a = ap.parse_args()
    names = sorted(n for n in os.listdir(a.dir) if n.startswith('f') and n.endswith('.png'))
    done = 0
    only = {o if o.endswith('.png') else o + '.png' for o in a.only.split(',') if o}
    for n in names:
        if only and n not in only:
            continue
        mp = os.path.join(a.dir, f'_mask_{n}')
        if not os.path.exists(mp):
            continue
        mask = cv2.imread(mp, cv2.IMREAD_GRAYSCALE) > 127
        if mask.sum() < 20:
            continue
        src = os.path.join(a.dir, f'_orig_{n}')
        if not os.path.exists(src):
            os.replace(os.path.join(a.dir, n), src)
        frame = cv2.imread(src, cv2.IMREAD_UNCHANGED).astype(np.float32)
        t = time.time()
        res = fill(frame, mask, a.prompt, a.seed, a.denoise, a.scale, a.context)
        cv2.imwrite(os.path.join(a.dir, n), np.clip(res, 0, 255).astype(np.uint8))
        done += 1
        print(f'{n}: {int(mask.sum())} px redrawn ({time.time() - t:.0f} s)')
    print(f'{done} drawings filled in {a.dir}')


if __name__ == '__main__':
    main()
