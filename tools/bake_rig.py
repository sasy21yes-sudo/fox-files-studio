"""
Agent Fox cut-out rig from the rig-ready part sheets (art/parts/*.jpg).

Pipeline
  1. Each sheet is upscaled 4x (tools/upscale.py) -> art/parts/up/<name>.png
  2. Parts are found on the 1x sheet (green key + connected components), then
     cut from the 4x sheet with a soft key, de-spilled, and resampled into
     RIG space: the reference pose (fullbody.jpg) in px, times K.
  3. Head parts (blank head, hat, eyes, pupils, closed/happy eyes, 12 mouths)
     are aligned in the blank head's own frame, then placed with the head.
  4. Sleeves and legs are straightened and their middle compressed so the
     joint-to-joint lengths match the reference pose (round ends untouched).

Output: src/character/rig/<part>.webp + rig.json + assets.ts

Usage: python3 tools/bake_rig.py
Env: FOX_PARTS = a folder of restyled sheets (e.g. art/parts_v4, with up/ inside) used
     instead of art/parts sheet by sheet where present; FOX_RIG_OUT = output folder.
"""
import json, math, os
import numpy as np, cv2
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'art', 'parts')
UP = os.path.join(ART, 'up')
ALT = os.environ.get('FOX_PARTS')  # restyled sheets override the originals one by one
OUT = os.environ.get('FOX_RIG_OUT') or os.path.join(ROOT, 'src', 'character', 'rig')


def sheet_paths(name):
    if ALT and os.path.exists(os.path.join(ALT, name + '.jpg')):
        return os.path.join(ALT, name + '.jpg'), os.path.join(ALT, 'up', name + '.png')
    return os.path.join(ART, name + '.jpg'), os.path.join(UP, name + '.png')
os.makedirs(OUT, exist_ok=True)

K = 3.364            # rig px per reference px (figure ~1800 px tall)
ORIGIN = (543.0, 553.0)  # reference px of the point between the feet on the ground

# ------------------------------------------------------------------ keying & cutting


def key(bgr):
    bgr = bgr.astype(np.float32)
    b, g, r = bgr[:, :, 0], bgr[:, :, 1], bgr[:, :, 2]
    dom = g - np.maximum(r, b)
    a = np.clip((150 - dom) / 90.0, 0, 1)
    out = bgr.copy()
    out[:, :, 1] = np.minimum(g, np.maximum(r, b))
    return out.astype(np.uint8), a


_cache = {}


def sheet(name):
    if name not in _cache:
        p1, p4 = sheet_paths(name)
        s1, s4 = cv2.imread(p1), cv2.imread(p4)
        if s4 is None:
            raise SystemExit(f'missing 4x sheet {p4}: run tools/upscale.py on {p1}')
        b1, a1 = key(s1)
        m = ndi.binary_closing(a1 > 0.5, iterations=2)
        lab, n = ndi.label(m)
        _cache[name] = (s1, s4, lab)
    return _cache[name]


def comp_at(name, x, y):
    """Component id under (or nearest to) a 1x sheet point."""
    _, _, lab = sheet(name)
    if lab[y, x]:
        return int(lab[y, x])
    ys, xs = np.nonzero(lab)
    i = np.argmin((xs - x) ** 2 + (ys - y) ** 2)
    return int(lab[ys[i], xs[i]])


def cut(name, x, y):
    """Cut the part containing 1x point (x, y). Returns BGRA at 4x and its 1x origin."""
    s1, s4, lab = sheet(name)
    cid = comp_at(name, x, y)
    m = ndi.binary_fill_holes(lab == cid)
    ys, xs = np.nonzero(m)
    x0, y0, x1, y1 = xs.min() - 3, ys.min() - 3, xs.max() + 4, ys.max() + 4
    x0, y0 = max(x0, 0), max(y0, 0)
    m = ndi.binary_dilation(m, iterations=2)[y0:y1, x0:x1]
    m4 = cv2.resize(m.astype(np.float32), ((x1 - x0) * 4, (y1 - y0) * 4), interpolation=cv2.INTER_LINEAR)
    m4 = cv2.GaussianBlur(m4, (0, 0), 2) > 0.5
    b4, a4 = key(s4[y0 * 4:y1 * 4, x0 * 4:x1 * 4])
    a4 = np.clip((a4 * m4 - 0.12) / 0.88, 0, 1)
    return np.dstack([b4, (a4 * 255).astype(np.uint8)]), (x0, y0)


def premul(img):
    f = img.astype(np.float32)
    f[:, :, :3] *= f[:, :, 3:4] / 255
    return f


def unpremul(f):
    out = f.copy()
    a = np.maximum(out[:, :, 3:4], 1e-3) / 255
    out[:, :, :3] = np.where(out[:, :, 3:4] > 0.5, out[:, :, :3] / a, 0)
    return np.clip(out, 0, 255).astype(np.uint8)


def warp(img, A, pad=4):
    """Warp a BGRA image with affine A (src px -> dst px); returns sprite + its dst top-left.
    Downscaling is done with area filtering first so nothing aliases."""
    A = np.asarray(A, np.float64)
    s = math.sqrt(abs(np.linalg.det(A[:, :2])))
    src = premul(img)
    if s < 0.95:
        f = s
        src = cv2.resize(src, (max(1, round(img.shape[1] * f)), max(1, round(img.shape[0] * f))), interpolation=cv2.INTER_AREA)
        fx = img.shape[1] / src.shape[1]
        fy = img.shape[0] / src.shape[0]
        A = A @ np.array([[fx, 0, 0], [0, fy, 0], [0, 0, 1]])
    h, w = src.shape[:2]
    corners = np.array([[0, 0, 1], [w, 0, 1], [0, h, 1], [w, h, 1]], np.float64)
    pts = corners @ A.T
    ox, oy = math.floor(pts[:, 0].min()) - pad, math.floor(pts[:, 1].min()) - pad
    W, H = math.ceil(pts[:, 0].max()) - ox + pad, math.ceil(pts[:, 1].max()) - oy + pad
    B = A.copy()
    B[0, 2] -= ox
    B[1, 2] -= oy
    out = cv2.warpAffine(src, B, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    out = unpremul(np.clip(out, 0, 255 * 255))
    return trim(out, (ox, oy))


def trim(img, origin, pad=2):
    ys, xs = np.nonzero(img[:, :, 3] > 2)
    x0, y0 = max(xs.min() - pad, 0), max(ys.min() - pad, 0)
    x1, y1 = min(xs.max() + pad + 1, img.shape[1]), min(ys.max() + pad + 1, img.shape[0])
    return img[y0:y1, x0:x1].copy(), (origin[0] + x0, origin[1] + y0)


def sim(s, deg, src_pt, dst_pt):
    """Similarity: rotate by deg, scale s, mapping src_pt -> dst_pt."""
    r = math.radians(deg)
    c, si = math.cos(r) * s, math.sin(r) * s
    return np.array([[c, -si, dst_pt[0] - (c * src_pt[0] - si * src_pt[1])], [si, c, dst_pt[1] - (si * src_pt[0] + c * src_pt[1])]])


def compose(P, Q):
    """P after Q (2x3)."""
    P3 = np.vstack([P, [0, 0, 1]])
    Q3 = np.vstack([Q, [0, 0, 1]])
    return (P3 @ Q3)[:2]


def inv(A):
    return cv2.invertAffineTransform(np.asarray(A, np.float64))


def at4(A1, origin1):
    """Affine for a 4x crop whose 1x crop origin is origin1, given A1 (1x sheet px -> dst)."""
    S = np.array([[0.25, 0, origin1[0]], [0, 0.25, origin1[1]]])
    return compose(A1, S)


def to_rig(A_ref):
    """1x-px->reference-px affine, followed by reference->rig px (scale K)."""
    return compose(np.array([[K, 0, 0], [0, K, 0]]), A_ref)


def ref2rig(p):
    return [p[0] * K, p[1] * K]


SPRITES = {}
META = {'K': K, 'origin': ref2rig(ORIGIN), 'unit': 1.0 / K, 'parts': {}}


def save(name, img, origin, **extra):
    if name in globals().get('PARAMS', {}).get('mirror', []):
        # Mirrored left-right (e.g. the far sleeve, so its light and cuff face the other way); anchors follow.
        img = cv2.flip(img, 1)
        for k in ('ax', 'bx'):
            if k in extra:
                extra[k] = float(img.shape[1] - extra[k])
    cv2.imwrite(os.path.join(OUT, name + '.webp'), img, [cv2.IMWRITE_WEBP_QUALITY, 92])
    META['parts'][name] = {'x': float(origin[0]), 'y': float(origin[1]), 'w': int(img.shape[1]), 'h': int(img.shape[0]), **extra}


def darken(img, k):
    out = img.copy()
    out[:, :, :3] = (out[:, :, :3].astype(np.float32) * k).astype(np.uint8)
    return out


def blob(img, reg, thr=55):
    lum = cv2.cvtColor(img[:, :, :3], cv2.COLOR_BGR2GRAY)
    dark = (lum < thr) & (img[:, :, 3] > 200) & reg
    lab, n = ndi.label(ndi.binary_opening(dark, iterations=2))
    sz = ndi.sum(dark, lab, range(1, n + 1))
    ys, xs = np.nonzero(lab == int(np.argmax(sz)) + 1)
    return xs.mean(), ys.mean()


# ------------------------------------------------------------------ head (head space = blank head 1x crop px)

headB, oB = cut('head', 790, 200)    # blank head without hat
headA, oA = cut('head', 260, 190)    # head with hat (for the hat and alignment)
# Restyled sheets come with art/parts_v4/rig_params.json: tail anchor/turn, joint offsets, mirrored
# sprites and the polygon of the ear drawn over the hat (head crop px of the restyled sheet).
PARAMS = json.load(open(os.path.join(ALT, 'rig_params.json'))) if ALT and os.path.exists(os.path.join(ALT, 'rig_params.json')) else {}
FITS = os.path.join(ALT, 'fits.json') if ALT and os.path.exists(os.path.join(ALT, 'fits.json')) else os.path.join(ART, 'fits.json')
fits = json.load(open(FITS))
A_to_B = np.array(fits['a_to_b'])     # headA crop px -> headB crop px (1x)
MOUTH_FITS = {int(k): np.array(v) for k, v in fits['mouths'].items()}  # mouth crop px -> headB crop px
# A restyled blank head can have a different crop origin (taller ears...). The head frame stays the
# original one: SHIFT = new crop origin - original crop origin (1x px), written by tools/comfy/rig_mouths.py.
SHIFT = np.array(fits.get('b_shift', [0, 0]), float)
RESTYLED_HEAD = 'b_shift' in fits
# headA crop px -> reference px (landmarks: nose, crown, brim).
A_to_ref = sim(0.628, 0.0, (310.0, 225.0), (616.7, 151.7))
B_to_ref = compose(A_to_ref, inv(A_to_B))
B_to_rig = to_rig(B_to_ref)

# Blank head: the neck stub under the ruff is removed (the torso's collar takes over).
hb = headB.copy()
h4, w4 = hb.shape[:2]
hsv = cv2.cvtColor(hb[:, :, :3], cv2.COLOR_BGR2HSV).astype(int)
orange = (hsv[:, :, 0] >= 4) & (hsv[:, :, 0] <= 24) & (hsv[:, :, 1] > 120)
yy = np.mgrid[0:h4, 0:w4][0]
# Below the ruff (headB 1x px, original frame); the restyled head's neck also has a cream stripe.
cream_neck = (hsv[:, :, 2] > 170) & (hsv[:, :, 1] < 110) if RESTYLED_HEAD else np.zeros_like(orange)
stub = (orange | cream_neck) & (yy > (268 - SHIFT[1]) * 4)
stub = ndi.binary_opening(stub, iterations=3)
keep = 1 - cv2.GaussianBlur(ndi.binary_dilation(stub, iterations=2).astype(np.float32), (0, 0), 2)
hb[:, :, 3] = (hb[:, :, 3] * keep).astype(np.uint8)
MUZZLE = os.path.join(ALT, 'muzzle_mask.png') if ALT else ''
if EXACT_MOUTHS := bool(fits.get('exact')) and os.path.exists(MUZZLE):
    # Restyled mouths carry the whole muzzle: take it out of the head so there is only ever one nose.
    mm = cv2.imread(MUZZLE, cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    h1, w1 = hb.shape[0] // 4, hb.shape[1] // 4
    crop = np.zeros((h1, w1), np.float32)
    sub = mm[oB[1]:oB[1] + h1, oB[0]:oB[0] + w1]
    crop[:sub.shape[0], :sub.shape[1]] = sub
    m4 = cv2.resize(crop, (hb.shape[1], hb.shape[0]), interpolation=cv2.INTER_LINEAR)
    hb[:, :, 3] = (hb[:, :, 3] * (1 - m4)).astype(np.uint8)
img, o = warp(hb, at4(B_to_rig, SHIFT))
save('head', img, o)

# Inside of the head outline (alpha eroded past the ink line), in rig px: the eyes are clipped to it,
# so the far eye tucks behind the bridge of the muzzle as in a 3/4 view.
_a = (headB[:, :, 3] > 128).astype(np.uint8)
_a = cv2.erode(_a, np.ones((15, 15), np.uint8))
_cs, _ = cv2.findContours(_a, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
_c = cv2.approxPolyDP(max(_cs, key=cv2.contourArea), 2.0, True).reshape(-1, 2).astype(np.float64)
_A = at4(B_to_rig, SHIFT)
META['headClip'] = [[round(float(v), 1) for v in (_A @ np.array([x, y, 1.0]))] for x, y in _c]

# The nose tip (centre of the black nose blob), in rig px: the face is posed against it.
_d = ((headB[:, :, :3].max(2) < 60) & (headB[:, :, 3] > 200)).astype(np.uint8)
_d = cv2.morphologyEx(_d, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
_n, _l, _st, _c = cv2.connectedComponentsWithStats(_d)
_i = max(range(1, _n), key=lambda i: (_st[i, 0] + _st[i, 2]) if _st[i, 4] > 2000 and _st[i, 2] < _st[i, 3] * 3 else -1)
META['nose'] = [float(v) for v in (at4(B_to_rig, SHIFT) @ np.array([_c[_i][0], _c[_i][1], 1.0]))]

if 'ear_over' in PARAMS:
    # The far ear stands in front of the hat (master look): the same head pixels inside a polygon,
    # feathered, drawn again after the hat.
    em = np.zeros(hb.shape[:2], np.uint8)
    cv2.fillPoly(em, [np.array(PARAMS['ear_over'], np.float32).reshape(-1, 2).__mul__(4).astype(np.int32)], 1)
    em = cv2.GaussianBlur(em.astype(np.float32), (0, 0), 3)
    ear = hb.copy()
    ear[:, :, 3] = (ear[:, :, 3] * em).astype(np.uint8)
    img, o = warp(ear, at4(B_to_rig, SHIFT))
    save('ear_over', img, o)

# Neck pivot (where the head turns): centre of the collar, in rig px.
NECK_REF = (532.0, 205.0)
META['neckPivot'] = ref2rig(NECK_REF)

# Hat from the hatted head, with the brass pin as a diamond (as on the model sheet).
ha = headA.copy()
H, W = ha.shape[:2]
hsv = cv2.cvtColor(ha[:, :, :3], cv2.COLOR_BGR2HSV).astype(int)
Hh, Ss, Vv = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
orange = (Hh >= 4) & (Hh <= 24) & (Ss > 150) & (Vv > 110)
cream = (Vv > 170) & (Ss < 110)
gold = (Hh > 15) & (Hh < 35) & (Ss > 120) & (Vv > 150)
hatpx = ((~orange & ~cream) | gold) & (ha[:, :, 3] > 128)
hatpx[int(H * 0.52):] = False
core = ndi.binary_opening(hatpx, iterations=16)
lab, n = ndi.label(core)
sz = ndi.sum(core, lab, range(1, n + 1))
core = ndi.binary_fill_holes(lab == int(np.argmax(sz)) + 1)
ring = ndi.binary_dilation(core, iterations=16) & ~core
ink = (Vv < 75) & (Ss < 200)
m = core | (ring & ink & hatpx)
lab, n = ndi.label(m)
sz = ndi.sum(m, lab, range(1, n + 1))
m = ndi.binary_fill_holes(lab == int(np.argmax(sz)) + 1)
m = ndi.binary_opening(m, iterations=3) | core
hat = ha.copy()
hat[:, :, 3] = (255 * cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.6)).astype(np.uint8)
# The pin: the compact gold blob nearest to where it sits on the 1x sheet.
labg, ng = ndi.label(ndi.binary_opening(gold & m, iterations=2))
best = None
for i in range(ng):
    yy_, xx_ = np.nonzero(labg == i + 1)
    if len(xx_) < 60 or np.ptp(xx_) > 120 or np.ptp(yy_) > 120:
        continue
    dd = (xx_.mean() - 808) ** 2 + (yy_.mean() - 368) ** 2
    if best is None or dd < best[0]:
        best = (dd, i + 1)
gm = ndi.binary_dilation(labg == best[1], iterations=6)
ys, xs = np.nonzero(gm)
cx, cy, r = xs.mean(), ys.mean(), max(np.ptp(xs), np.ptp(ys)) / 2 + 4
R = r * 1.3
pts = np.array([[cx, cy - R], [cx + R * 0.82, cy], [cx, cy + R], [cx - R * 0.82, cy]], np.int32)
cv2.fillPoly(hat, [pts], (40, 150, 214, 255), cv2.LINE_AA)
inner = np.array([[cx, cy - R * 0.62], [cx + R * 0.42, cy - R * 0.05], [cx, cy + R * 0.25], [cx - R * 0.42, cy - R * 0.05]], np.int32)
cv2.fillPoly(hat, [inner], (120, 215, 245, 255), cv2.LINE_AA)
cv2.polylines(hat, [pts], True, (12, 22, 34, 255), 7, cv2.LINE_AA)
A_hat = compose(B_to_rig, A_to_B)  # headA crop px -> rig
img, o = warp(hat, at4(A_hat, (0, 0)))
save('hat', img, o)

# Eyes: whites, pupils, closed and happy eyes, sized and placed in head space.
EYES = {
    'near': {'white': (170, 152), 'pupil': (363, 151), 'closed': (202, 393), 'happy': (186, 502), 'x': 164, 'y': 148, 'w': 58},
    'far': {'white': (663, 150), 'pupil': (835, 151), 'closed': (694, 395), 'happy': (805, 497), 'x': 210, 'y': 144, 'w': 38},
}
eyes_meta = {}
for side, e in EYES.items():
    info = {}
    for kind in ('white', 'pupil', 'closed', 'happy'):
        piece, o1 = cut('eyes', *e[kind])
        pw = piece.shape[1] / 4
        if kind == 'white':
            s = e['w'] / pw
            wscale = s
        elif kind == 'pupil':
            s = wscale
        else:
            s = e['w'] * 1.05 / pw
        ph = piece.shape[0] / 4
        centre_head = (e['x'], e['y'] + (6 if kind in ('closed', 'happy') else 0))
        A = compose(B_to_rig, sim(s, 0, (pw / 2, ph / 2), centre_head))
        img, o = warp(piece, at4(A, (0, 0)))
        save(f'eye_{side}_{kind}', img, o)
        c = A @ np.array([pw / 2, ph / 2, 1])
        info[kind] = [float(c[0]), float(c[1])]
        if kind == 'white':
            # Ellipse of the white for clipping the pupil (rig px).
            a = piece[:, :, 3] > 128
            ys, xs = np.nonzero(a)
            sc = math.sqrt(abs(np.linalg.det(A[:, :2]))) / 4
            info['rx'] = float(np.ptp(xs) * sc / 2 * 0.86)
            info['ry'] = float(np.ptp(ys) * sc / 2 * 0.88)
    eyes_meta[side] = info
META['eyes'] = eyes_meta

# Fur colour around the eyes (for animated lids), sampled from the blank head.
hsvB = cv2.cvtColor(headB[:, :, :3], cv2.COLOR_BGR2HSV)
ring = np.zeros(headB.shape[:2], bool)
for e in EYES.values():
    cv2.circle(ring.view(np.uint8), (int((e['x'] - SHIFT[0]) * 4), int((e['y'] - SHIFT[1]) * 4)), int(e['w'] * 4 * 0.85), 1, -1)
furm = ring & (hsvB[:, :, 1] > 140) & (hsvB[:, :, 2] > 150)
fur = np.median(headB[:, :, :3][furm], 0)
META['furColor'] = [int(fur[2]), int(fur[1]), int(fur[0])]

# Mouths: the 12 lip-sync pieces, each fitted to the blank head's muzzle.
MOUTHS = {  # id on the 1x mouth sheet -> a point inside it
    3: (150, 120), 4: (400, 120), 2: (640, 120), 1: (880, 120),
    6: (150, 290), 8: (400, 290), 7: (640, 290), 5: (870, 290),
    9: (140, 460), 10: (360, 460), 11: (590, 460), 12: (820, 460),
}
# Restyled mouths (tools/comfy/rig_mouths.py) were cut from renders of the blank head itself:
# their points come with the fits and they are used as they are.
EXACT = bool(fits.get('exact'))
META['emotionMouths'] = {v: int(k) for k, v in fits.get('emotions', {}).items()}
if 'points' in fits:
    MOUTHS = {int(k): tuple(v) for k, v in fits['points'].items()}
for mid, pt in MOUTHS.items():
    piece, o1 = cut('mouths', *pt)
    if EXACT:
        # Hard-edged sprite cut from the head render: feather it inwards so it melts into the head.
        a = piece[:, :, 3].astype(np.float32) / 255
        a = cv2.GaussianBlur(cv2.erode(a, np.ones((13, 13), np.uint8)), (0, 0), 7)
        piece[:, :, 3] = (np.minimum(a, piece[:, :, 3] / 255) * 255).astype(np.uint8)
    else:
        # The piece's upper outline duplicates the head's own muzzle outline: drop it.
        a = piece[:, :, 3].astype(np.float32) / 255
        k = 28
        sh = np.zeros_like(a)
        sh[k:] = a[:-k]
        a = a * sh
        w = a.shape[1]
        ramp = np.clip((np.arange(w) / w - 0.12) / 0.22, 0, 1)
        a = cv2.GaussianBlur(a * ramp[None, :], (0, 0), 1.6)
        piece[:, :, 3] = (a * 255).astype(np.uint8)
    A = compose(B_to_rig, MOUTH_FITS[mid])
    img, o = warp(piece, at4(A, (0, 0)))
    save(f'mouth_{mid}', img, o)

# ------------------------------------------------------------------ torso & neck

torso, o1 = cut('torso', 290, 300)
T_ref = sim(0.525, 0, (337.0, 315.0), (551.0, 324.0))  # torso sheet px -> ref px
# The dark inside of the collar becomes a hole so the neck shows through.
lum = cv2.cvtColor(torso[:, :, :3], cv2.COLOR_BGR2GRAY)
hole = np.zeros(lum.shape, bool)
hx0, hy0 = (240 - o1[0]) * 4, (50 - o1[1]) * 4
hx1, hy1 = (370 - o1[0]) * 4, (120 - o1[1]) * 4
hole[hy0:hy1, hx0:hx1] = True
hole &= lum < 70
lab, n = ndi.label(hole)
if n:
    sz = ndi.sum(hole, lab, range(1, n + 1))
    hole = ndi.binary_fill_holes(lab == int(np.argmax(sz)) + 1)
    hole = ndi.binary_erosion(hole, iterations=6)
    torso[:, :, 3] = (torso[:, :, 3] * (1 - cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 2))).astype(np.uint8)
img, o = warp(torso, at4(to_rig(T_ref), o1))
save('torso', img, o)

neck, o1 = cut('torso', 740, 260)
nh, nw = neck.shape[0] / 4, neck.shape[1] / 4
N_ref = sim(0.30, 0, (o1[0] + nw / 2, o1[1] + nh * 0.12), (533.0, 160.0))
img, o = warp(neck, at4(to_rig(N_ref), o1))
save('neck', img, o)

# ------------------------------------------------------------------ tubes (sleeves, legs)


def tube(name, pt, width_ref, length_ref, keep_bottom=0.0):
    """Straighten a tube piece, keep its round ends, compress its middle so the distance
    between the centres of its two round ends equals length_ref. Returns sprite in rig px
    with the top joint at (w/2, top) offsets recorded."""
    piece, o1 = cut(name, *pt)
    a = piece[:, :, 3] > 128
    ys, xs = np.nonzero(a)
    pts = np.stack([xs, ys], 1).astype(np.float64)
    mu = pts.mean(0)
    _, _, vt = np.linalg.svd(pts - mu, full_matrices=False)
    d = vt[0] if vt[0][1] > 0 else -vt[0]
    ang = math.degrees(math.atan2(d[1], d[0])) - 90
    h, w = piece.shape[:2]
    M = cv2.getRotationMatrix2D((mu[0], mu[1]), ang, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    nw, nh = int(h * sin + w * cos) + 8, int(h * cos + w * sin) + 8
    M[0, 2] += nw / 2 - mu[0]
    M[1, 2] += nh / 2 - mu[1]
    st = unpremul(cv2.warpAffine(premul(piece), M, (nw, nh), flags=cv2.INTER_CUBIC, borderValue=(0, 0, 0, 0)))
    st, _ = trim(st, (0, 0), 0)
    sh, sw = st.shape[:2]
    rows = np.nonzero(st[:, :, 3].max(1) > 128)[0]
    top, bot = rows.min(), rows.max()
    # Width = median opaque width in the middle third.
    mid = st[top + (bot - top) // 3: bot - (bot - top) // 3, :, 3] > 128
    width = float(np.median(mid.sum(1)))
    # Round-end centres sit half a width in from each end.
    j0, j1 = top + width / 2, bot - width / 2
    s = width_ref * K / width  # 4x px -> rig px
    target = length_ref * K / s  # joint distance in 4x px
    cur = j1 - j0
    # Piecewise-linear vertical remap: ends (and an optional cuff) keep their scale.
    end0 = j0 + width * 0.35
    end1 = j1 - width * 0.35 - keep_bottom * width
    out_h = int(round(sh - (cur - target)))
    out_rows = np.arange(out_h, dtype=np.float32)
    k = (end1 - end0 - (cur - target)) / max(end1 - end0, 1)
    src = np.where(out_rows < end0, out_rows,
                   np.where(out_rows < end0 + (end1 - end0) * k, end0 + (out_rows - end0) / k, out_rows + (cur - target)))
    mapx = np.tile(np.arange(sw, dtype=np.float32), (out_h, 1))
    mapy = np.tile(src[:, None], (1, sw)).astype(np.float32)
    rem = unpremul(cv2.remap(premul(st), mapx, mapy, cv2.INTER_CUBIC, borderValue=(0, 0, 0, 0)))
    # Scale to rig px.
    fw, fh = max(1, round(sw * s)), max(1, round(out_h * s))
    img = unpremul(cv2.resize(premul(rem), (fw, fh), interpolation=cv2.INTER_AREA))
    cx = sw / 2 * s
    return img, {'ax': float(cx), 'ay': float(j0 * s), 'bx': float(cx), 'by': float((j0 + target) * s), 'len': float(target * s), 'width': float(width_ref * K)}


ARM_W = 38.0
for nm, pt, cuff in [('arm_front_upper', (210, 280), 0), ('arm_front_lower', (410, 250), 0.6),
                     ('arm_back_upper', (610, 280), 0), ('arm_back_lower', (815, 250), 0.6)]:
    img, info = tube('arms', pt, ARM_W, 62.0 if 'upper' in nm else 58.0, keep_bottom=cuff)
    save(nm, img, (0, 0), **info)

# Continuous rubber-hose sleeves: one tube from shoulder to wrist (round top, cuff at the wrist).
for nm, pt in [('sleeve_front', (410, 250)), ('sleeve_back', (815, 250))]:
    img, info = tube('arms', pt, ARM_W, 124.0, keep_bottom=0.6)
    save(nm, img, (0, 0), **info)

LEG_W = 47.0
for nm, pt in [('leg_near', (100, 200)), ('leg_far', (405, 200))]:
    img, info = tube('legs9', pt, LEG_W, 142.0)
    save(nm, img, (0, 0), **info)

# Shoulder caps: the coat's shoulders, redrawn over the arms so sleeves come out from under them.
tor = cv2.imread(os.path.join(OUT, 'torso.webp'), cv2.IMREAD_UNCHANGED)
tp = META['parts']['torso']
for nm, j, r_ref, cut_up in [('cap_front', (585.0, 230.0), 30.0, 214.0), ('cap_back', (462.0, 232.0), 32.0, 214.0)]:
    cx_, cy_ = j[0] * K - tp['x'], j[1] * K - tp['y']
    yy_, xx_ = np.mgrid[0:tor.shape[0], 0:tor.shape[1]]
    d = np.hypot(xx_ - cx_, yy_ - cy_)
    m = np.clip((r_ref * K - d) / (6 * K), 0, 1)
    m *= np.clip((yy_ - (cut_up * K - tp['y'])) / (4 * K), 0, 1)
    cap = tor.copy()
    cap[:, :, 3] = (cap[:, :, 3] * m).astype(np.uint8)
    img, o = trim(cap, (tp['x'], tp['y']))
    save(nm, img, o)

# ------------------------------------------------------------------ shoes, hands, tail, props


def part_at(name, pt, scale_ref, anchor_frac=None, anchor_px=None, rot=0.0, dark=1.0):
    """Cut a part, scale to rig px; anchor given as fraction of the 1x bbox or 1x sheet px."""
    piece, o1 = cut(name, *pt)
    w1, h1 = piece.shape[1] / 4, piece.shape[0] / 4
    if anchor_px is not None:
        ax, ay = anchor_px[0] - o1[0], anchor_px[1] - o1[1]
    else:
        ax, ay = anchor_frac[0] * w1, anchor_frac[1] * h1
    A = sim(scale_ref * K, rot, (ax, ay), (0, 0))
    if dark != 1.0:
        piece = darken(piece, dark)
    img, o = warp(piece, at4(A, (0, 0)))
    return img, o


SHOE_S = 0.52
img, o = part_at('legs9', (130, 470), SHOE_S, anchor_px=(103, 432))
save('shoe_near', img, o)
if PARAMS.get('far_shoe_from_near'):
    # The far shoe drawing reads as pointing backwards (big heel, short toe): use the near shoe, a bit
    # smaller and darker, so both feet clearly point forward.
    img, o = part_at('legs9', (130, 470), SHOE_S * 0.94, anchor_px=(103, 432), dark=0.82)
else:
    img, o = part_at('legs9', (350, 465), SHOE_S, anchor_px=(320, 428), dark=0.85)
save('shoe_far', img, o)

HAND_S = 0.37
HANDS = {  # name -> (point inside on 1x sheet, wrist on 1x sheet, axis angle of the hand in degrees)
    'open': ((150, 130), (52, 150), 0),
    'relaxed': ((400, 140), (312, 110), 25),
    'fist': ((640, 135), (565, 140), 0),
    'point': ((880, 130), (786, 140), 0),
    'flat': ((150, 425), (44, 430), 0),
    'grip': ((400, 420), (322, 430), 0),
    'thumb': ((640, 420), (565, 455), 0),
    'wave': ((890, 420), (858, 505), -80),
}
for nm, (pt, wrist, axis) in HANDS.items():
    img, o = part_at('hands', pt, HAND_S, anchor_px=wrist, rot=-axis)
    save('hand_' + nm, img, o)
    img, o = part_at('hands', pt, HAND_S, anchor_px=wrist, rot=-axis, dark=0.86)
    save('hand_' + nm + '_back', img, o)

# New gloves (art/incoming hands_new_back / hands_new_front, approved renders): the glove is cut
# from its render without the short brown cuff (the restyled sleeve has its own), anchored at the
# wrist (where glove and cuff meet) and turned so its axis is +x, like the sheet gloves; the cuff's
# thickness sets the scale so every glove matches the sleeve's width.
NEW_GLOVES = ['one', 'two', 'three', 'pinch_paper', 'pencil', 'magnifier', 'stop', 'chin', 'fist_tremble', 'relaxed', 'knock']
def new_glove(path):
    bgr = cv2.imread(path)
    f = bgr.astype(np.float32)
    dom = f[..., 1] - np.maximum(f[..., 0], f[..., 2])
    alpha = np.clip((150 - dom) / 90.0, 0, 1)
    f[..., 1] = np.minimum(f[..., 1], np.maximum(f[..., 0], f[..., 2]))
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(int)
    fg = alpha > 0.5
    # The cuff's brown fabric (the ink lines are darker, the brass button brighter and more yellow).
    cuff = fg & (hsv[..., 0] >= 5) & (hsv[..., 0] <= 22) & (hsv[..., 1] > 110) & (hsv[..., 2] > 70) & (hsv[..., 2] < 175)
    cuff = ndi.binary_opening(cuff, iterations=4)
    lab, n = ndi.label(cuff)
    if not n:
        return None
    cuff = ndi.binary_fill_holes(lab == 1 + int(np.argmax(ndi.sum(cuff, lab, range(1, n + 1)))))  # with its button
    glove = fg & (hsv[..., 2] > 150) & (hsv[..., 1] < 70)
    gl, gn = ndi.label(ndi.binary_opening(glove, iterations=2))
    glove = gl == 1 + int(np.argmax(ndi.sum(glove, gl, range(1, gn + 1))))
    # Keep everything but the cuff (and the button/ink inside it), grown a little to take its outline.
    # Wrist: the white pixels (glove + shirt cuff) closest to the brown cuff, across its ink line.
    dcuff = ndi.distance_transform_edt(~cuff)
    near = glove & (dcuff < dcuff[glove].min() + 14)
    ys, xs = np.nonzero(near)
    wrist = (float(xs.mean()), float(ys.mean()))
    gy, gx = np.nonzero(glove)
    axis = math.degrees(math.atan2(gy.mean() - wrist[1], gx.mean() - wrist[0]))
    # Remove the whole cuff (fabric, shade, ink outline, button): the brown-or-dark region joined to the
    # cuff that lies behind the wrist along the hand's axis.
    fabric = fg & (hsv[..., 0] >= 4) & (hsv[..., 0] <= 24) & (hsv[..., 1] > 100) & (hsv[..., 2] > 45) & (hsv[..., 2] < 180)
    fl, fn = ndi.label(ndi.binary_opening(fabric, iterations=2))
    ids = np.unique(fl[cuff & (fl > 0)])
    region = ndi.binary_dilation(ndi.binary_fill_holes(np.isin(fl, ids) | cuff), iterations=14)
    ax, ay = math.cos(math.radians(axis)), math.sin(math.radians(axis))
    yy, xx = np.mgrid[0:bgr.shape[0], 0:bgr.shape[1]]
    behind = (xx - wrist[0]) * ax + (yy - wrist[1]) * ay < 6
    alpha = alpha * ~(region & behind)
    # Drop whatever is left detached from the glove (bits of outline, the button); held props stay.
    keep = alpha > 0.5
    kl, kn = ndi.label(keep)
    sizes = ndi.sum(keep, kl, range(1, kn + 1))
    big = [i + 1 for i, v in enumerate(sizes) if v > 0.08 * sizes.max()]
    alpha = alpha * (cv2.dilate(np.isin(kl, big).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)
    # Scale: the white glove's area matches the rig's own fist glove (its inner ink lines make the
    # palm-circle measure unreliable).
    s = math.sqrt(FIST_AREA / max(float(ndi.binary_fill_holes(glove).sum()), 1.0))
    img = np.dstack([np.clip(f, 0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
    A = sim(s, -axis, wrist, (0, 0))
    return warp(img, A)

def _glove_area(name):
    im = cv2.imread(os.path.join(OUT, name + '.webp'), cv2.IMREAD_UNCHANGED)
    h = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2HSV).astype(int)
    m = (im[:, :, 3] > 128) & (h[..., 2] > 150) & (h[..., 1] < 70)
    return float(ndi.binary_fill_holes(m).sum())

if PARAMS.get('new_gloves'):
    FIST_AREA = _glove_area('hand_fist') * 1.1
    _man = json.load(open(os.path.join(ROOT, 'art', 'incoming', 'manifest.json'), encoding='utf8'))['sheets']
    def _approved(key):
        vs = [v for v in _man.get(key, {}).get('versions', []) if v['status'] in ('approved', 'final')]
        return os.path.join(ROOT, vs[-1]['file']) if vs else None
    for nm in NEW_GLOVES:
        for sheet_, suffix in (('hands_new_back', ''), ('hands_new_front', '_palm')):
            src = _approved(f'{sheet_}/{nm}')
            r = new_glove(src) if src else None
            if r is None:
                continue
            img, o = r
            save(f'hand_n_{nm}{suffix}', img, o)
            save(f'hand_n_{nm}{suffix}_back', darken(img, 0.86), o)

# Tail: base on the right end of the piece; turned so it rises behind the back as in the reference.
TAIL = PARAMS.get('tail', {})
img, o = part_at('legs9', (820, 200), 0.48 * TAIL.get('scale', 1.0), anchor_px=tuple(TAIL.get('anchor', (955, 115))), rot=TAIL.get('rot', 92))
save('tail', img, o)

img, o = part_at('legs9', (660, 400), 0.42, anchor_px=(608, 505))
save('prop_magnifier', img, o)
img, o = part_at('legs9', (800, 440), 0.36, anchor_frac=(0.5, 0.5))
save('prop_notebook', img, o)
img, o = part_at('legs9', (935, 450), 0.34, anchor_frac=(0.5, 0.85))
save('prop_pencil', img, o)

# ------------------------------------------------------------------ joints in rig px (reference pose)

J = {
    'shoulderFront': (585.0, 230.0), 'shoulderBack': (462.0, 232.0),
    'wristFront': (606.0, 348.0), 'wristBack': (453.0, 353.0),
    'hipNear': (490.0, 363.0), 'hipFar': (553.0, 356.0),
    'tailBase': (445.0, 360.0),
}
for k, (dx, dy) in PARAMS.get('joints', {}).items():  # reference px offsets for restyled parts
    J[k] = (J[k][0] + dx, J[k][1] + dy)
META['joints'] = {k: ref2rig(v) for k, v in J.items()}
META['headRef'] = ref2rig((545.0, 140.0))

# Snout bridge after the master (art/reference/trace, tools/trace_face.py writes masterFace.ts): the head
# sprite is stretched row by row so its upper muzzle outline, from the far eye to the nose, lies on the
# master's outline, posed like the face is at runtime (near eye + nose similarity). Then the eye clip is
# rebuilt from the stretched head.
FACE_TS = os.path.join(OUT, 'masterFace.ts')
if RESTYLED_HEAD and os.path.exists(FACE_TS) and PARAMS.get('stretch_bridge'):  # off: not what the master needs
    _t = open(FACE_TS, encoding='utf8').read()
    MF = json.loads(_t[_t.index('{'):_t.rindex('}') + 1])
    ne = np.array(META['eyes']['near']['white'])
    rn = np.array(META['nose'])
    mn = np.array(MF['nose'])
    roll = math.atan2(mn[1], mn[0]) - math.atan2(rn[1] - ne[1], rn[0] - ne[0])
    kf = np.linalg.norm(rn - ne) / np.linalg.norm(mn)
    c_, s_ = math.cos(-roll), math.sin(-roll)
    tgt = np.array([ne + kf * np.array([x * c_ - y * s_, x * s_ + y * c_]) for x, y in MF['bridge']])
    tgt = tgt[np.argsort(tgt[:, 1])]
    hp = META['parts']['head']
    img = cv2.imread(os.path.join(OUT, 'head.webp'), cv2.IMREAD_UNCHANGED)
    PADR = 140
    img = cv2.copyMakeBorder(img, 0, 0, 0, PADR, cv2.BORDER_CONSTANT, value=(0, 0, 0, 0))
    H_, W_ = img.shape[:2]
    y0, y1 = int(tgt[0, 1] - hp['y']), int(tgt[-1, 1] - hp['y'])
    dx = np.zeros(H_)
    xc = np.zeros(H_)
    for y in range(max(0, y0), min(H_, y1)):
        cols = np.nonzero(img[y, :, 3] > 128)[0]
        if not len(cols):
            continue
        xc[y] = cols.max()
        dx[y] = np.interp(y + hp['y'], tgt[:, 1], tgt[:, 0]) - hp['x'] - xc[y]
    rows = np.arange(H_)
    on = (rows >= y0) & (rows < y1) & (xc > 0)
    # Smooth over rows and fade in/out over 40 rows at both ends of the bridge.
    dx = ndi.gaussian_filter1d(np.where(on, dx, 0.0), 6)
    fade = np.clip(np.minimum(rows - y0, y1 - rows) / 40.0, 0, 1)
    dx *= fade
    xc = np.where(on, xc, np.interp(rows, rows[on], xc[on]) if on.any() else 0)
    Wz = 130.0  # stretch zone inside the outline
    xs = np.arange(W_, dtype=np.float32)[None, :].repeat(H_, 0)
    mx = xs.copy()
    for y in range(H_):
        if abs(dx[y]) < 0.3:
            continue
        a0 = xc[y] - Wz
        e1 = xc[y] + dx[y]
        z = (xs[y] >= a0) & (xs[y] <= e1)
        mx[y, z] = a0 + (xs[y, z] - a0) * Wz / max(1.0, Wz + dx[y])
        mx[y, xs[y] > e1] = xs[y, xs[y] > e1] - dx[y]
    my = np.arange(H_, dtype=np.float32)[:, None].repeat(W_, 1)
    pm = premul(img)
    out = cv2.remap(pm, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    al = out[:, :, 3:4]
    out[:, :, :3] = np.where(al > 0, out[:, :, :3] * 255 / np.maximum(al, 1e-3), 0)
    img = np.clip(out, 0, 255).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, 'head.webp'), img, [cv2.IMWRITE_WEBP_QUALITY, 92])
    META['parts']['head']['w'] = int(W_)
    _a = cv2.erode((img[:, :, 3] > 128).astype(np.uint8), np.ones((9, 9), np.uint8))
    _cs, _ = cv2.findContours(_a, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    _c = cv2.approxPolyDP(max(_cs, key=cv2.contourArea), 2.0, True).reshape(-1, 2)
    META['headClip'] = [[round(float(x + hp['x']), 1), round(float(y + hp['y']), 1)] for x, y in _c]
    print('snout bridge: max stretch', round(float(np.abs(dx).max()), 1), 'rig px')

json.dump(META, open(os.path.join(OUT, 'rig.json'), 'w'), indent=1)
files = sorted(f for f in os.listdir(OUT) if f.endswith('.webp'))
with open(os.path.join(OUT, 'assets.ts'), 'w') as fh:
    fh.write('// Generated by tools/bake_rig.py — do not edit.\n')
    for i, f in enumerate(files):
        fh.write(f"import a{i} from './{f}';\n")
    fh.write('\nexport const RIG_ASSETS: Record<string, string> = {\n')
    for i, f in enumerate(files):
        fh.write(f"  '{f[:-5]}': a{i},\n")
    fh.write('};\n')
tot = sum(os.path.getsize(os.path.join(OUT, f)) for f in files)
print('ok', len(files), 'sprites', round(tot / 1e6, 2), 'MB')
