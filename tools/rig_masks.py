"""
Neck masks of Agent Fox's side rig, drawn by hand in the tracer (tracer.html?part=neck) over the rig's
own sprites, instead of the bake's automatic ones:

  mask.shirt      the torso area that goes OVER the head and the mouths (shirt and collar in front of the fur)
  mask.shirt2     its other side (the shirt collar has two)
  mask.neck       where the cream neck piece shows (outside it the piece is cut away)
  mask.headErase  parts of the head (and of every mouth) to remove, e.g. a neck stub under the ruff

  python tools/rig_masks.py --image --rig <rig dir>   compose the rig's sprites around the neck
        -> art/reference/trace/neck_rig.png (+ neck_rig.json: its origin in rig px) and neck_auto.json
           (the bake's current masks, to start from)
  python tools/rig_masks.py --apply --rig <rig dir>   neck.json (tracer, image px) -> rig px polygons in
        art/parts_v4/rig_masks.json, then re-bake the rig (tools/bake_rig.py) and refresh the image
"""
import argparse, json, os, subprocess, sys
import cv2, numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trace_face import shape_points  # noqa: E402  (samples a traced Bézier path)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACE = os.path.join(ROOT, 'art', 'reference', 'trace')
PARTS = os.path.join(ROOT, 'art', 'parts_v4')
# The neck area of the rig (rig px): head bottom, ruff, neck piece, collar.
WINDOW = (1450, 380, 2150, 1080)
KEYS = {'mask.shirt': 'shirt', 'mask.shirt2': 'shirt2', 'mask.neck': 'neck', 'mask.headErase': 'headErase'}


def compose(rig):
    meta = json.load(open(os.path.join(rig, 'rig.json')))
    P = meta['parts']
    x0, y0, x1, y1 = WINDOW
    c = np.zeros((y1 - y0, x1 - x0, 3), np.float32)
    c[:] = (24, 224, 24)
    # Drawing order of the rig (AgentFox.ts): neck, torso, head with its rest mouth.
    for name in ['neck', 'torso', 'head', 'mouth_3']:
        if name not in P:
            continue
        im = cv2.imread(os.path.join(rig, name + '.webp'), cv2.IMREAD_UNCHANGED).astype(np.float32)
        x, y = int(round(P[name]['x'])) - x0, int(round(P[name]['y'])) - y0
        h, w = im.shape[:2]
        sx, sy, dx, dy = max(0, -x), max(0, -y), max(0, x), max(0, y)
        ww, hh = min(w - sx, c.shape[1] - dx), min(h - sy, c.shape[0] - dy)
        if ww <= 0 or hh <= 0:
            continue
        sub = im[sy:sy + hh, sx:sx + ww]
        a = sub[..., 3:] / 255
        c[dy:dy + hh, dx:dx + ww] = c[dy:dy + hh, dx:dx + ww] * (1 - a) + sub[..., :3] * a
    return c.astype(np.uint8)


def image(rig):
    x0, y0 = WINDOW[:2]
    cv2.imwrite(os.path.join(TRACE, 'neck_rig.png'), compose(rig))
    json.dump({'originRig': [x0, y0]}, open(os.path.join(TRACE, 'neck_rig.json'), 'w'))
    # Starting shapes: the masks the bake used (rig_masks_auto.json, written by bake_rig.py), in image px.
    auto = {}
    src = os.path.join(PARTS, 'rig_masks_auto.json')
    if os.path.exists(src):
        for key, poly in json.load(open(src)).items():
            if poly:
                auto[f'mask.{key}'] = [[round(x - x0, 1), round(y - y0, 1)] for x, y in poly]
    json.dump(auto, open(os.path.join(TRACE, 'neck_auto.json'), 'w'), indent=1)
    print('wrote neck_rig.png and', ', '.join(auto) or 'no automatic masks')


def apply(rig):
    x0, y0 = WINDOW[:2]
    shapes = json.load(open(os.path.join(TRACE, 'neck.json'), encoding='utf8'))
    masks = {}
    for key, name in KEYS.items():
        raw = shapes.get(key)
        pts = shape_points(raw, closed=True) if raw else None
        if pts is None or len(pts) < 3:
            continue
        masks[name] = [[round(float(x) + x0, 1), round(float(y) + y0, 1)] for x, y in np.asarray(pts, float)]
    json.dump(masks, open(os.path.join(PARTS, 'rig_masks.json'), 'w'), indent=1)
    print('masks:', ', '.join(f'{k} ({len(v)} pts)' for k, v in masks.items()) or 'none (the bake uses its own)', flush=True)
    env = {**os.environ, 'FOX_PARTS': PARTS, 'FOX_RIG_OUT': rig}
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'bake_rig.py')], cwd=ROOT, env=env, capture_output=True, text=True)
    print(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else '', flush=True)
    if r.returncode != 0:
        raise SystemExit(r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'bake failed')
    image(rig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rig', required=True, help='the rig folder of the editor (src/character/rig)')
    ap.add_argument('--image', action='store_true')
    ap.add_argument('--apply', action='store_true')
    a = ap.parse_args()
    if a.apply:
        apply(a.rig)
    elif a.image:
        image(a.rig)


if __name__ == '__main__':
    main()
