"""
Local, free asset generation: Qwen-Image-Edit-2511 through a running ComfyUI
(http://127.0.0.1:8188). One PIECE per generation: we edit one of Salvatore's
own drawings (a glove, a head, a muzzle cut from the art/parts sheets) so the
line, palette and proportions stay his, and add up to two more references.
Approved pieces are assembled into sheets by tools/comfy/compose.py.

Image arguments:
  path                 the whole image
  path#k               k-th piece of a green part sheet (row-major, from 0)
  path@x,y,w,h         a rectangle (e.g. a panel of the model sheet)

Usage:
  python tools/comfy/edit.py <sheet> <piece> --image art/parts/hands.jpg#3 \
      --prompt "..." [--ref art/agent-fox-model-sheet-painted.png@20,640,340,360]
      [--correction "..."]... [--from vN] [--steps 8|40] [--seed N] [--count N] [--mp 1.0]
  python tools/comfy/edit.py --mark <sheet>/<piece> vN approved|rejected [--note "..."]

Output: art/incoming/pieces/<sheet>/<piece>_vN.png, logged in
art/incoming/manifest.json under "<sheet>/<piece>".
"""
import argparse, json, os, random, re, time, urllib.parse, urllib.request, uuid
import cv2, numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, 'art', 'incoming', 'manifest.json')
SERVER = os.environ.get('COMFY_URL', 'http://127.0.0.1:8188')
MODEL = 'qwen_image_edit_2511_fp8mixed.safetensors'
TEXT_ENCODER = 'qwen_2.5_vl_7b_fp8_scaled.safetensors'
VAE = 'qwen_image_vae.safetensors'
LIGHTNING = 'Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors'
GREEN = (0, 255, 0)  # BGR

# Appended to every edit: the STYLE block of GEMINI_PROMPTS.md, condensed for an edit model.
STYLE = ('Keep exactly the drawing style of image 1: 1930s rubber-hose cartoon with a hand-painted finish, '
         'one single dark-brown ink outline weight, flat colours with one soft cel shade, light from the top-left, '
         'same palette, same proportions and same size. Do not redesign the character. '
         'Background: flat pure chroma-key green (#00FF00), no shadow, no gradient, no text, no numbers.')


# ------------------------------------------------------------------ images

def pieces_of(bgr):
    f = bgr.astype(np.float32)
    dom = f[..., 1] - np.maximum(f[..., 0], f[..., 2])
    fg = cv2.morphologyEx((dom < 60).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, _, st, _ = cv2.connectedComponentsWithStats(fg, 8)
    boxes = [tuple(int(v) for v in st[i][:4]) for i in range(1, n) if st[i][4] > 0.0015 * fg.size]
    # row-major: group by vertical centre, rows separated by more than half a piece height
    boxes.sort(key=lambda b: b[1] + b[3] / 2)
    rows, cur = [], []
    for b in boxes:
        if cur and (b[1] + b[3] / 2) - (cur[-1][1] + cur[-1][3] / 2) > 0.5 * max(c[3] for c in cur):
            rows.append(cur); cur = []
        cur.append(b)
    rows.append(cur)
    return [b for r in rows for b in sorted(r, key=lambda b: b[0])]


def load_spec(spec):
    """Resolve an image argument to a BGR array (pieces padded on pure green)."""
    m = re.match(r'^(.*?)(?:#(\d+)|@(\d+),(\d+),(\d+),(\d+))?$', spec)
    path = os.path.join(ROOT, m.group(1))
    bgr = cv2.imread(path)
    if bgr is None:
        raise SystemExit(f'cannot read {path}')
    if m.group(2) is not None:
        x, y, w, h = pieces_of(bgr)[int(m.group(2))]
        pad = int(0.25 * max(w, h))
        crop = bgr[y:y + h, x:x + w].astype(np.float32)
        dom = crop[..., 1] - np.maximum(crop[..., 0], crop[..., 2])
        a = np.clip((150 - dom) / 90.0, 0, 1)[..., None]           # same soft key as bake_rig
        crop[..., 1] = np.minimum(crop[..., 1], np.maximum(crop[..., 0], crop[..., 2]))  # de-spill
        canvas = np.empty((h + 2 * pad, w + 2 * pad, 3), np.float32)
        canvas[:] = GREEN
        canvas[pad:pad + h, pad:pad + w] = crop * a + np.array(GREEN, np.float32) * (1 - a)
        return canvas.astype(np.uint8)
    if m.group(3) is not None:
        x, y, w, h = (int(m.group(i)) for i in range(3, 7))
        return bgr[y:y + h, x:x + w]
    return bgr


# ------------------------------------------------------------------ ComfyUI

def api(path, data=None, ctype='application/json'):
    req = urllib.request.Request(SERVER + path, data=data, headers={'Content-Type': ctype} if data else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
    return json.loads(body) if r.headers.get('Content-Type', '').startswith('application/json') else body


def upload(bgr, name):
    ok, png = cv2.imencode('.png', bgr)
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
            f'Content-Type: image/png\r\n\r\n').encode() + png.tobytes() + \
           f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{boundary}--\r\n'.encode()
    return api('/upload/image', body, f'multipart/form-data; boundary={boundary}')['name']


def workflow(images, prompt, seed, steps, mp):
    """Qwen-Image-Edit-2511 API graph: image 1 is edited, images 2-3 are references."""
    lightning = steps <= 8
    g = {
        'unet': {'class_type': 'UNETLoader', 'inputs': {'unet_name': MODEL, 'weight_dtype': 'default'}},
        'clip': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': TEXT_ENCODER, 'type': 'qwen_image', 'device': 'default'}},
        'vae': {'class_type': 'VAELoader', 'inputs': {'vae_name': VAE}},
        'shift': {'class_type': 'ModelSamplingAuraFlow', 'inputs': {'model': ['lora' if lightning else 'unet', 0], 'shift': 3.1}},
        'cfgnorm': {'class_type': 'CFGNorm', 'inputs': {'model': ['shift', 0], 'strength': 1.0}},
        'scale': {'class_type': 'ImageScaleToTotalPixels', 'inputs': {'image': ['img0', 0], 'upscale_method': 'lanczos', 'megapixels': mp, 'resolution_steps': 16}},
        'pos': {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': {'clip': ['clip', 0], 'vae': ['vae', 0], 'prompt': prompt}},
        'neg': {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': {'clip': ['clip', 0], 'vae': ['vae', 0], 'prompt': ''}},
        'posref': {'class_type': 'FluxKontextMultiReferenceLatentMethod', 'inputs': {'conditioning': ['pos', 0], 'reference_latents_method': 'index_timestep_zero'}},
        'negref': {'class_type': 'FluxKontextMultiReferenceLatentMethod', 'inputs': {'conditioning': ['neg', 0], 'reference_latents_method': 'index_timestep_zero'}},
        'latent': {'class_type': 'VAEEncode', 'inputs': {'pixels': ['scale', 0], 'vae': ['vae', 0]}},
        'sample': {'class_type': 'KSampler', 'inputs': {
            'model': ['cfgnorm', 0], 'positive': ['posref', 0], 'negative': ['negref', 0], 'latent_image': ['latent', 0],
            'seed': seed, 'steps': steps, 'cfg': 1.0 if lightning else 4.0, 'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': 1.0}},
        'decode': {'class_type': 'VAEDecode', 'inputs': {'samples': ['sample', 0], 'vae': ['vae', 0]}},
        'save': {'class_type': 'SaveImage', 'inputs': {'images': ['decode', 0], 'filename_prefix': 'foxfiles'}},
    }
    if lightning:
        g['lora'] = {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['unet', 0], 'lora_name': LIGHTNING, 'strength_model': 1.0}}
    for i, name in enumerate(images):
        g[f'img{i}'] = {'class_type': 'LoadImage', 'inputs': {'image': name}}
        src = ['scale', 0] if i == 0 else [f'img{i}', 0]
        g['pos']['inputs'][f'image{i + 1}'] = src
        g['neg']['inputs'][f'image{i + 1}'] = src
    return g


def run(graph, front=False):
    """Queue a graph (front=True: ahead of everything already waiting) and return the PNG."""
    pid = api('/prompt', json.dumps({'prompt': graph, 'client_id': uuid.uuid4().hex, 'front': front}).encode())['prompt_id']
    while True:
        time.sleep(2)
        h = api(f'/history/{pid}')
        if pid in h:
            st = h[pid].get('status', {})
            if st.get('status_str') == 'error':
                raise SystemExit('ComfyUI error: ' + json.dumps(st.get('messages', []))[-1500:])
            img = h[pid]['outputs']['save']['images'][0]
            q = urllib.parse.urlencode({'filename': img['filename'], 'subfolder': img['subfolder'], 'type': img['type']})
            return api(f'/view?{q}')


# ------------------------------------------------------------------ manifest

def load_manifest():
    if os.path.exists(MANIFEST):
        return json.load(open(MANIFEST, encoding='utf8'))
    return {'budget': {'limit': 40, 'generated': 0}, 'sheets': {}}


def save_manifest(man):
    with open(MANIFEST, 'w', encoding='utf8') as f:
        json.dump(man, f, indent=2)
        f.write('\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet', nargs='?')
    ap.add_argument('piece', nargs='?')
    ap.add_argument('rest', nargs='*')
    ap.add_argument('--image')
    ap.add_argument('--ref', action='append', default=[])
    ap.add_argument('--prompt')
    ap.add_argument('--correction', action='append', default=[])
    ap.add_argument('--from', dest='from_')
    ap.add_argument('--steps', type=int, default=8)
    ap.add_argument('--seed', type=int, help='first seed (consecutive with --count); random if omitted')
    ap.add_argument('--count', type=int, default=1, help='variants to render with different seeds')
    ap.add_argument('--mp', type=float, default=1.0)
    ap.add_argument('--front', action='store_true', help='queue ahead of renders already waiting in ComfyUI')
    ap.add_argument('--mark', action='store_true')
    ap.add_argument('--note')
    a = ap.parse_args()
    man = load_manifest()

    if a.mark:
        key, version, status = a.sheet, a.piece, a.rest[0]
        v = next(x for x in man['sheets'][key]['versions'] if x['version'] == version)
        v['status'] = status
        if a.note:
            v['review'] = a.note
        save_manifest(man)
        print(key, version, '->', status)
        return

    key = f'{a.sheet}/{a.piece}'
    entry = man['sheets'].setdefault(key, {'versions': []})
    image, refs, prompt, corrections = a.image, a.ref, a.prompt, list(a.correction)
    if a.from_:
        src = next(x for x in entry['versions'] if x['version'] == a.from_)
        image = image or src['image']
        refs = refs or src['refs']
        prompt = prompt or src['instruction']
        corrections = src['corrections'] + corrections
    if not (image and prompt):
        raise SystemExit('--image and --prompt are required (or --from vN)')
    if len(refs) > 2:
        raise SystemExit('at most 2 --ref images (Qwen-Image-Edit takes 3 images in total)')

    text = prompt.rstrip('.') + '. ' + ' '.join(c.rstrip('.') + '.' for c in corrections) + ' ' + STYLE
    names = [upload(load_spec(s), f'fox_{i}_{uuid.uuid4().hex[:8]}.png') for i, s in enumerate([image] + refs)]
    out_dir = os.path.join(ROOT, 'art', 'incoming', 'pieces', a.sheet)
    os.makedirs(out_dir, exist_ok=True)
    for n in range(a.count):
        seed = a.seed + n if a.seed is not None else random.randrange(2**31)
        t0 = time.time()
        png = run(workflow(names, text, seed, a.steps, a.mp), a.front)
        # a render takes minutes: re-read so reviews marked meanwhile are not overwritten
        man = load_manifest()
        versions = man['sheets'].setdefault(key, {'versions': []})['versions']
        version = 'v%d' % (max([int(x['version'][1:]) for x in versions] or [0]) + 1)
        out = os.path.join(out_dir, f'{a.piece}_{version}.png')
        open(out, 'wb').write(png)
        h, w = cv2.imread(out).shape[:2]
        versions.append({
            'version': version, 'file': os.path.relpath(out, ROOT).replace('\\', '/'), 'status': 'draft',
            'model': 'qwen-image-edit-2511 fp8 (local ComfyUI)' + (' + lightning 8-step' if a.steps <= 8 else ''),
            'image': image, 'refs': refs, 'instruction': prompt, 'corrections': corrections, 'prompt': text,
            'seed': seed, 'steps': a.steps, 'megapixels': a.mp, 'from': a.from_, 'width': w, 'height': h,
            'seconds': round(time.time() - t0, 1), 'created': time.strftime('%Y-%m-%dT%H:%M:%S'),
        })
        save_manifest(man)
        print(f'{os.path.relpath(out, ROOT)}  {w}x{h}  seed={seed}  {time.time() - t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
