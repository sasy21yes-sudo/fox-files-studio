"""
In-betweens for a frame-by-frame clip: key drawings in, every drawing of the move out.

  python tools/clips/inbetween.py <out dir> --keys k0.png k2.png k3.png --steps 6,4
         [--lock-below 0.79] [--motion euclidean] [--back]

1. Keys are brought to one size and registered on the feet (sub-pixel ECC, like build_clip.py).
2. Lock: everything below --lock-below (fraction of the height, e.g. legs and shoes) is taken from the
   FIRST key in every key, feathered at the cut, so what must not move cannot change between keys.
3. In-betweens: FILM (ComfyUI's native frame interpolation, film_net_fp16) computes the drawings between
   each pair of keys; --steps gives how many drawings each segment gets (the keys included once).
4. --back appends the move in reverse (a tip of the hat that comes back down), sharing the end key.
Writes <out dir>/f0000.png ... on the green screen, ready for build_clip.py.
"""
import argparse, json, os, sys, time, urllib.parse, urllib.request, uuid
import cv2, numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_clip import key, register  # noqa: E402

SERVER = os.environ.get('COMFY_URL', 'http://127.0.0.1:8188')
GREEN = np.array([24, 224, 24], np.float32)


def api(path, data=None, ctype='application/json'):
    req = urllib.request.Request(SERVER + path, data=data, headers={'Content-Type': ctype} if data else {})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read()
    return json.loads(body) if r.headers.get('Content-Type', '').startswith('application/json') else body


def upload(bgr, name):
    ok, png = cv2.imencode('.png', bgr)
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n').encode() + png.tobytes() + \
           f'\r\n--{b}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{b}--\r\n'.encode()
    return api('/upload/image', body, f'multipart/form-data; boundary={b}')['name']


def film(a, b, n):
    """n drawings from a to b inclusive (FILM), as BGR images."""
    mult = n - 1
    g = {
        'm': {'class_type': 'FrameInterpolationModelLoader', 'inputs': {'model_name': 'film_net_fp16.safetensors'}},
        'a': {'class_type': 'LoadImage', 'inputs': {'image': upload(a, f'ib_a_{uuid.uuid4().hex[:6]}.png')}},
        'b': {'class_type': 'LoadImage', 'inputs': {'image': upload(b, f'ib_b_{uuid.uuid4().hex[:6]}.png')}},
        'batch': {'class_type': 'ImageBatch', 'inputs': {'image1': ['a', 0], 'image2': ['b', 0]}},
        'interp': {'class_type': 'FrameInterpolate', 'inputs': {'interp_model': ['m', 0], 'images': ['batch', 0], 'multiplier': mult}},
        'save': {'class_type': 'SaveImage', 'inputs': {'images': ['interp', 0], 'filename_prefix': 'foxfiles_ib'}},
    }
    pid = api('/prompt', json.dumps({'prompt': g, 'client_id': uuid.uuid4().hex, 'front': True}).encode())['prompt_id']
    while True:
        time.sleep(1.5)
        h = api(f'/history/{pid}')
        if pid in h:
            st = h[pid].get('status', {})
            if st.get('status_str') == 'error':
                sys.exit('ComfyUI error: ' + json.dumps(st.get('messages', []))[-1500:])
            out = []
            for im in h[pid]['outputs']['save']['images']:
                q = urllib.parse.urlencode({'filename': im['filename'], 'subfolder': im['subfolder'], 'type': im['type']})
                out.append(cv2.imdecode(np.frombuffer(api(f'/view?{q}'), np.uint8), cv2.IMREAD_COLOR))
            return out


def on_green(f):
    a = f[..., 3:] / 255
    return (f[..., :3] * a + GREEN * (1 - a)).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out')
    ap.add_argument('--keys', nargs='+', required=True)
    ap.add_argument('--steps', default='', help='drawings per segment, keys included (e.g. 6,4)')
    ap.add_argument('--lock-below', type=float, default=0.79)
    ap.add_argument('--motion', default='euclidean', choices=['translation', 'euclidean', 'affine'])
    ap.add_argument('--back', action='store_true')
    a = ap.parse_args()

    imgs = [cv2.imread(k) for k in a.keys]
    H, W = imgs[1].shape[:2] if len(imgs) > 1 else imgs[0].shape[:2]
    keys = [key(cv2.resize(im, (W, H), interpolation=cv2.INTER_AREA if im.shape[0] > H else cv2.INTER_CUBIC)) for im in imgs]
    # Feet: the bottom 12% of the first key's figure.
    al = keys[0][..., 3] > 128
    ys, xs = np.nonzero(al)
    y1 = ys.max() + 1
    y0 = int(y1 - (y1 - ys.min()) * 0.12)
    cols = np.nonzero(al[y0:y1].any(0))[0]
    box = (int(cols.min()) - 6, y0 - 6, int(cols.max()) + 7, y1 + 6)
    keys, warps = register(keys, box, a.motion)
    for i, w in enumerate(warps):
        print(f'key {i}: registered ({w[0, 2]:+.2f}, {w[1, 2]:+.2f}) px')
    # Lock what must not move to the first key.
    cut = a.lock_below * H
    yy = np.arange(H, dtype=np.float32)[:, None, None]
    m = np.clip((yy - cut) / 24 + 0.5, 0, 1)
    for i in range(1, len(keys)):
        keys[i] = keys[i] * (1 - m) + keys[0] * m
    greens = [on_green(k) for k in keys]
    steps = [int(s) for s in a.steps.split(',')] if a.steps else [6] * (len(keys) - 1)
    frames = []
    for i in range(len(keys) - 1):
        seg = film(greens[i], greens[i + 1], steps[i])
        seg = [cv2.resize(s, (W, H)) if s.shape[:2] != (H, W) else s for s in seg]
        frames += seg if not frames else seg[1:]
        print(f'segment {i}: {len(seg)} drawings')
    if a.back:
        frames += frames[-2::-1]
    os.makedirs(a.out, exist_ok=True)
    for f in os.listdir(a.out):
        if f.startswith('f') and f.endswith('.png'):
            os.remove(os.path.join(a.out, f))
    for i, f in enumerate(frames):
        cv2.imwrite(os.path.join(a.out, f'f{i:04d}.png'), f)
    print(f'{len(frames)} drawings in {a.out}')


if __name__ == '__main__':
    main()
