"""
Bake Agent Fox's FRONT rig (the talking bust) from the approved front pieces:

  head   art/incoming/pieces/front/head_v6.png   blank head (hat, ears, nose, ruff, neck; no eyes, no mouth)
  torso  art/incoming/pieces/front/torso_v6.png  sleeveless coat, shirt and tie, dark collar opening
  mouths art/incoming/pieces/front_mouths/m<k>_v<n>.png  the same head with one lip-sync mouth each

Front px = head-image px. The neck is extended into a straight tube so the collar can hold it; the
collar opening becomes a hole; the torso is split into the whole coat (drawn behind the head) and its
front half (drawn over the neck), so the neck goes INTO the shirt. Each mouth is the part of its render
that differs from the blank head below the nose, aligned on the nose and feathered.

Output (FOX_FRONT_OUT, default ../fox-files-studio-editor/src/character/rig/front):
  <part>.webp, front.json (parts, nose, neck pivot, shoulders), assets.ts
Usage: python tools/bake_front.py [--pick 3=v2,5=v1]
"""
import argparse, json, os
import cv2, numpy as np
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIECES = os.path.join(ROOT, 'art', 'incoming', 'pieces')
OUT = os.environ.get('FOX_FRONT_OUT') or os.path.join(os.path.dirname(ROOT), 'fox-files-studio-editor', 'src', 'character', 'rig', 'front')
MANIFEST = os.path.join(ROOT, 'art', 'incoming', 'manifest.json')

NECK_ROW = 890        # head px: a neck row above its rounded bottom, repeated downwards
NECK_TO = 1240        # head px: where the extended neck ends (well inside the coat)
HOLE_TOP_Y = 800      # head px where the collar opening's top edge sits (the chin overlaps it)
FRONT_Y = 875         # head px: the coat's front layer starts just under the chin (the neck shows only in the opening below it)
TUBE_SHADE = 0.72     # the tube darkens to this inside the collar
HEAD_TO_TORSO = 1.35  # head width / coat width, as on the side rig (688 / 478 rig px ~ 1.44): a big cartoon head


def key(bgr):
    f = bgr.astype(np.float32)
    a = np.clip((150 - (f[..., 1] - np.maximum(f[..., 0], f[..., 2]))) / 90.0, 0, 1)
    f[..., 1] = np.minimum(f[..., 1], np.maximum(f[..., 0], f[..., 2]))
    return f.astype(np.uint8), a


def main_part(a):
    """Alpha restricted to the biggest drawing (drops the green screen's light glow and specks)."""
    m = ndi.binary_closing(a > 0.5, iterations=2)
    lab, n = ndi.label(m)
    if n == 0:
        return a
    big = np.argmax(ndi.sum(m, lab, range(1, n + 1))) + 1
    keep = ndi.binary_dilation(ndi.binary_fill_holes(lab == big), iterations=3)
    return a * keep


def bgra(bgr, a):
    return np.dstack([bgr, np.clip(a * 255, 0, 255).astype(np.uint8)])


def crop(img):
    ys, xs = np.nonzero(img[..., 3] > 2)
    x0, y0 = max(int(xs.min()) - 2, 0), max(int(ys.min()) - 2, 0)
    return img[y0:int(ys.max()) + 3, x0:int(xs.max()) + 3], (x0, y0)


def nose_of(bgr, near=(515, 712)):
    """The black nose: the big compact dark blob nearest to where the front head draws it (thin lines
    such as the philtrum and the mouth are opened away so they do not join it)."""
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    dark = cv2.morphologyEx((bgr.astype(int).max(2) < 70).astype(np.uint8), cv2.MORPH_OPEN, k)
    n, lab, st, cen = cv2.connectedComponentsWithStats(dark)
    ok = [i for i in range(1, n) if st[i, 4] > 1500 and st[i, 2] < st[i, 3] * 3]
    i = min(ok, key=lambda i: np.hypot(cen[i][0] - near[0], cen[i][1] - near[1]))
    return np.array(cen[i]), int(st[i, 1] + st[i, 3]), lab == i


def approved(key_):
    m = json.load(open(MANIFEST, encoding='utf8'))['sheets']
    return [v for v in m[key_]['versions'] if v['status'] == 'approved'][-1]['file']


META = {'parts': {}}
HEAD_W = 0


def save(name, img, origin, **extra):
    img, (cx, cy) = crop(img)
    cv2.imwrite(os.path.join(OUT, name + '.webp'), img, [cv2.IMWRITE_WEBP_QUALITY, 92])
    META['parts'][name] = {'x': round(origin[0] + cx, 2), 'y': round(origin[1] + cy, 2), 'w': int(img.shape[1]), 'h': int(img.shape[0]), **extra}


def head():
    bgr, a = key(cv2.imread(os.path.join(ROOT, approved('front/head'))))
    a = main_part(a)
    H, W = a.shape
    # Neck tube: repeat one neck row down to NECK_TO (the coat hides its end).
    big = np.zeros((NECK_TO, W, 3), np.uint8)
    ba = np.zeros((NECK_TO, W), np.float32)
    big[:H], ba[:H] = bgr, a
    row, ra = bgr[NECK_ROW], a[NECK_ROW]
    big[NECK_ROW:], ba[NECK_ROW:] = row, ra
    # Inside the collar the neck is in shadow.
    shade = np.clip((np.arange(NECK_ROW, NECK_TO) - NECK_ROW) / 120.0, 0, 1) * (1 - TUBE_SHADE)
    big[NECK_ROW:] = (big[NECK_ROW:].astype(np.float32) * (1 - shade)[:, None, None]).astype(np.uint8)
    xs = np.nonzero(ra > 0.5)[0]
    nose, nose_bot, _ = nose_of(bgr)
    global HEAD_W
    HEAD_W = int(np.ptp(np.nonzero(a.max(0) > 0.5)[0])) + 1
    META['nose'] = [round(float(nose[0]), 2), round(float(nose[1]), 2)]
    META['noseBottom'] = nose_bot
    META['neck'] = {'x0': int(xs.min()), 'x1': int(xs.max()), 'row': NECK_ROW, 'end': NECK_TO}
    # Nods turn the head about the top of the neck, between the ears of the ruff.
    META['neckPivot'] = [round((xs.min() + xs.max()) / 2, 2), 850.0]
    return bgr, big, ba, nose, nose_bot, (int(xs.min()), int(xs.max()))


NECK_INK = 6          # px: outline drawn along the narrowed neck


def narrow_neck(head_bgr, big, ba, nose_bot, cx, half):
    """The drawn neck is wider than the collar opening: below the chin outline, keep a column as wide
    as the opening (plus its ink) and outline it, so the neck goes cleanly into the collar."""
    H = head_bgr.shape[0]
    xs = np.arange(big.shape[1])
    for x in xs[np.abs(xs - cx) > half - NECK_INK]:
        col = head_bgr[nose_bot + 40:H, x].max(1) < 80
        hit = np.nonzero(col)[0]
        y0 = nose_bot + 40 + (int(hit[0]) + 8 if len(hit) else 0)   # just past the chin's outline
        if abs(x - cx) > half:
            ba[y0:, x] = 0
        else:
            ba[y0:, x] = np.maximum(ba[y0:, x], 1.0)
            big[y0:, x] = (28, 16, 10)
    return big, ba


def torso(neck):
    src = os.path.join(ROOT, approved('front/torso'))
    up = os.path.join(PIECES, 'front', 'up', os.path.basename(src)[:-4] + '_x4.png')
    raw = cv2.imread(src)
    f_src = 1.0
    if os.path.exists(up):
        hi = cv2.imread(up)
        f_src = hi.shape[1] / raw.shape[1]
        raw_hi = hi
    else:
        raw_hi = raw
    bgr0, a0 = key(raw)
    a0 = main_part(a0)
    # The collar opening: the biggest near-black blob inside the coat.
    dark = (raw.max(2) < 45) & (a0 > 0.5)
    lab, n = ndi.label(dark)
    hole = lab == (np.argmax(ndi.sum(dark, lab, range(1, n + 1))) + 1)
    hy, hx = np.nonzero(hole)
    hole_w = hx.max() - hx.min() + 1
    coat_w = np.ptp(np.nonzero(a0.max(0) > 0.5)[0]) + 1
    s = HEAD_W / HEAD_TO_TORSO / coat_w                     # head px per torso px
    # Work at the upscaled resolution, then resample to head px.
    bgr, a = key(raw_hi)
    a = np.minimum(a, cv2.resize(a0, (raw_hi.shape[1], raw_hi.shape[0]), interpolation=cv2.INTER_LINEAR))
    hole_hi = cv2.resize(hole.astype(np.uint8) * 255, (raw_hi.shape[1], raw_hi.shape[0]), interpolation=cv2.INTER_LINEAR) / 255.0
    hole_hi = cv2.GaussianBlur(cv2.dilate(hole_hi, np.ones((3, 3), np.uint8)), (5, 5), 0)
    a = a * (1 - np.clip(hole_hi * 1.4, 0, 1))
    k = s / f_src
    size = (int(round(raw_hi.shape[1] * k)), int(round(raw_hi.shape[0] * k)))
    bgr = cv2.resize(bgr, size, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
    a = cv2.resize(a, size, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR)
    # Place: the opening's top centre under the neck's centre, at HOLE_TOP_Y.
    hcx = (hx.min() + hx.max()) / 2 * s
    htop = hy.min() * s
    ox = (neck[0] + neck[1]) / 2 - hcx
    oy = HOLE_TOP_Y - htop
    front_row = FRONT_Y - oy
    save('torso', bgra(bgr, a), (ox, oy))
    hole_half = (hx.max() - hx.min() + 1) * s / 2
    # Front part: from low in the opening down (the collar's front and the shirt hide the neck).
    rows = np.arange(a.shape[0])[:, None]
    fa = a * np.clip((rows - front_row) / 3.0 + 0.5, 0, 1)
    save('torso_front', bgra(bgr, fa), (ox, oy))
    # Shoulders: the coat's top corners (its widest rows near the top), for the arms.
    ab = a > 0.5
    ys = np.nonzero(ab.any(1))[0]
    top = ys.min()
    band = ab[top: top + int(0.25 * (ys.max() - top))]
    r = int(np.argmax(band.sum(1)))
    xs = np.nonzero(band[r])[0]
    sy = oy + top + r
    META['torso'] = {'scale': round(s, 4), 'holeTop': round(oy + htop, 2), 'frontY': FRONT_Y,
                     'bottom': round(oy + ys.max(), 2)}
    META['shoulders'] = {'left': [round(ox + xs.min() + 0.08 * len(xs), 2), round(sy, 2)],
                         'right': [round(ox + xs.max() - 0.08 * len(xs), 2), round(sy, 2)]}
    return hole_half


def mouths(head_bgr, nose, nose_bot, picks):
    """Mouth k+1 from render m<k> (mouth 1: the approved front face): the ink, teeth and tongue under the nose."""
    m = json.load(open(MANIFEST, encoding='utf8'))['sheets']
    done = []
    _, _, hnose = nose_of(head_bgr)
    for k in range(12):
        if k == 0:
            # Rest: the approved front face's own closed smile.
            r = cv2.imread(os.path.join(ROOT, approved('front/face')))
            pick = [{'version': 'face'}]
        else:
            sheet = m.get(f'front_mouths/m{k}', {}).get('versions', [])
            want = picks.get(k + 1)
            pick = [v for v in sheet if want and v['version'] == want] or [v for v in sheet if v['status'] == 'approved']
        if k and not pick:
            pick = [v for v in sheet if v['status'] != 'rejected'][:1]
        if not pick:
            continue
        if k:
            r = cv2.imread(os.path.join(ROOT, pick[-1]['file']))
        # Align on the nose, unless the render's nose blob has merged with its mouth (then trust the canvas:
        # the renders are edits of the same head image).
        rn, _, rmask = nose_of(r)
        d = nose - rn if 0.6 < rmask.sum() / hnose.sum() < 1.5 else np.zeros(2)
        r = cv2.warpAffine(r, np.float32([[1, 0, d[0]], [0, 1, d[1]]]), (r.shape[1], r.shape[0]), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        box = np.zeros(r.shape[:2], bool)
        x0, x1, y0 = int(nose[0] - 200), int(nose[0] + 200), nose_bot - 4
        # Down to just above the head's chin outline, column by column.
        for x in range(x0, x1):
            col = np.nonzero(head_bgr[nose_bot + 40: 900, x].max(1) < 80)[0]
            box[y0: (nose_bot + 40 + int(col[0]) - 5) if len(col) else 885, x] = True
        # The muzzle's cream on the blank head, and the render's own nose (left out: the head keeps its nose).
        cream = np.median(head_bgr[nose_bot + 10: nose_bot + 30, int(nose[0]) - 60: int(nose[0]) + 60].reshape(-1, 3), 0)
        f = r.astype(float)
        orange = (f[..., 2] > 170) & (f[..., 0] < 110) & (f[..., 1] > 70) & (f[..., 1] < 175)   # cheek fur, not mouth
        ink = (np.abs(f - cream).max(2) > 55) & box & ~orange & ~ndi.binary_dilation(hnose, iterations=4)
        lab, n = ndi.label(ink)
        keep = []
        for i, sl in enumerate(ndi.find_objects(lab), 1):
            ys_, xs_ = sl
            if xs_.start <= x0 + 1 or xs_.stop >= x1 - 1:
                continue  # ruff fur reaching the box's sides
            if (lab[sl] == i).sum() < 25:
                continue
            keep.append(i)
        if not keep:
            print(f'mouth {k + 1}: no mouth found under the nose, skipped')
            continue
        ch = ndi.binary_fill_holes(ndi.binary_closing(np.isin(lab, keep), iterations=3))
        # An open mouth drops the jaw below the blank head's chin: keep the render's lowered jaw (where it
        # differs from the head under the chin, next to the mouth), column by column down to its own chin
        # outline, so the bottom of the mouth is never cut flat; the neck under it stays the head's.
        cols = np.nonzero(ch.any(0))[0]
        low = np.zeros_like(box)
        for x in range(max(x0, cols.min() - 30), min(x1, cols.max() + 31)):
            yb = int(np.nonzero(box[:, x])[0].max()) if box[:, x].any() else 885
            low[yb - 6: yb + 120, x] = True
        dl, dn = ndi.label((np.abs(f - head_bgr.astype(float)).max(2) > 45) & low)
        touch = set(np.unique(dl[ndi.binary_dilation(ch, iterations=8) & (dl > 0)]))
        jaw = np.isin(dl, list(touch)) if touch else np.zeros_like(box)
        dark = f.max(2) < 90
        for x in np.nonzero(jaw.any(0))[0]:
            ys_ = np.nonzero(jaw[:, x] & dark[:, x])[0]
            if len(ys_):
                jaw[ys_.max() + 4:, x] = False
            else:
                jaw[:, x] = False
        jaw = ndi.binary_fill_holes(ndi.binary_closing(jaw | ch, iterations=3)) & (jaw | ch | low) & ~ch
        frac = (ch | jaw).sum() / (box | jaw).sum()
        soft = cv2.GaussianBlur(cv2.dilate(ch.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32), (0, 0), 2.5)
        # The lowered jaw fades out sideways into the head's own chin (no vertical edge where they meet).
        xs = np.arange(jaw.shape[1])
        taper = np.clip((xs - (cols.min() - 25)) / 40.0, 0, 1) * np.clip(((cols.max() + 25) - xs) / 40.0, 0, 1)
        jsoft = cv2.GaussianBlur(jaw.astype(np.float32), (0, 0), 2.5) * taper[None, :]
        soft = np.maximum(soft, jsoft)
        _, ka = key(r)
        save(f'mouth_{k + 1}', bgra(r, soft * ka), (0, 0))
        done.append((k + 1, pick[-1]['version'], round(float(frac), 3)))
    print('mouths', done)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pick', default='', help='mouth versions, e.g. 4=v2,6=v1 (MouthId=version)')
    a = ap.parse_args()
    picks = {int(p.split('=')[0]): p.split('=')[1] for p in a.pick.split(',') if p}
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.webp'):
            os.remove(os.path.join(OUT, f))
    hb, big, ba, nose, nose_bot, neck = head()
    half = torso(neck) + NECK_INK
    big, ba = narrow_neck(hb, big, ba, nose_bot, (neck[0] + neck[1]) / 2, half)
    save('head', bgra(big, ba), (0, 0))
    mouths(hb, nose, nose_bot, picks)
    with open(os.path.join(OUT, 'front.json'), 'w', encoding='utf8') as fh:
        json.dump(META, fh, indent=1)
    files = sorted(f for f in os.listdir(OUT) if f.endswith('.webp'))
    with open(os.path.join(OUT, 'assets.ts'), 'w', encoding='utf8') as fh:
        fh.write('// Generated by tools/bake_front.py — do not edit.\n')
        for i, f in enumerate(files):
            fh.write(f"import a{i} from './{f}';\n")
        fh.write('\nexport const FRONT_ASSETS: Record<string, string> = {\n')
        for i, f in enumerate(files):
            fh.write(f"  '{f[:-5]}': a{i},\n")
        fh.write('};\n')
    print('ok', len(files), 'sprites', round(sum(os.path.getsize(os.path.join(OUT, f)) for f in files) / 1e6, 2), 'MB')


if __name__ == '__main__':
    main()
