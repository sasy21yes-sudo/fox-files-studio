"""
Lip-sync mouths for the restyled head, cut from renders of that same head.

Each approved `rig_mouthheads/m<k>` render is the approved blank head
(`rig_head/p1`) with mouth k drawn on it and nothing else changed. The mouth
sprite is the part of the render inside a muzzle mask: the union of the places
where any of the 12 renders differs from the blank head, grown and feathered.
Sprites go on a new mouth sheet at the place of the original mouth k (so
tools/bake_rig.py keeps its mouth ids), and fits.json gets the exact offset of
each sprite on the blank head (all of them were drawn on the same head), with
`exact: true` so the bake does not trim them like the old hand-fitted mouths.

Usage: python tools/comfy/rig_mouths.py [--use m6=v2 ...]
Output: art/parts_v4/mouths.jpg, art/parts_v4/fits.json (with the sprite points)
"""
import argparse, json, os
import cv2, numpy as np
from scipy import ndimage as ndi
from edit import ROOT, pieces_of

MANIFEST = os.path.join(ROOT, 'art', 'incoming', 'manifest.json')
OUT = os.path.join(ROOT, 'art', 'parts_v4')


def alpha_of(bgr):
    f = bgr.astype(np.float32)
    return np.clip((150 - (f[..., 1] - np.maximum(f[..., 0], f[..., 2]))) / 90.0, 0, 1)


def crop_origin(sheet, pt):
    """The 1x crop origin tools/bake_rig.py's cut() uses for the part under pt."""
    m = ndi.binary_closing(alpha_of(sheet) > 0.5, iterations=2)
    lab, _ = ndi.label(m)
    x, y = pt
    cid = lab[y, x]
    if not cid:
        ys, xs = np.nonzero(lab)
        i = np.argmin((xs - x) ** 2 + (ys - y) ** 2)
        cid = lab[ys[i], xs[i]]
    ys, xs = np.nonzero(ndi.binary_fill_holes(lab == cid))
    return max(int(xs.min()) - 3, 0), max(int(ys.min()) - 3, 0)


def approved(man, key, use=None):
    vs = man.get(key, {}).get('versions', [])
    pick = [v for v in vs if use and v['version'] == use] or [v for v in vs if v['status'] in ('approved', 'final')]
    return pick[-1] if pick else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--use', action='append', default=[], help='mK=vN: use this version even if not approved')
    a = ap.parse_args()
    use = dict(u.split('=') for u in a.use)
    man = json.load(open(MANIFEST, encoding='utf8'))['sheets']

    head_v = approved(man, 'rig_head/p1')
    H = cv2.imread(os.path.join(ROOT, head_v['file']))
    renders = {}
    for k in range(12):
        v = approved(man, f'rig_mouthheads/m{k}', use.get(f'm{k}'))
        if not v:
            raise SystemExit(f'rig_mouthheads/m{k}: nothing approved (use --use m{k}=vN)')
        renders[k] = cv2.resize(cv2.imread(os.path.join(ROOT, v['file'])), (H.shape[1], H.shape[0]), interpolation=cv2.INTER_AREA)

    # Muzzle mask: wherever any mouth differs from the blank head (ignoring render noise), grown and feathered.
    aH = alpha_of(H)
    diff = np.zeros(H.shape[:2], bool)
    for R in renders.values():
        d = np.abs(R.astype(int) - H.astype(int)).sum(2) > 60
        d &= (alpha_of(R) > 0.5) | (aH > 0.5)
        diff |= ndi.binary_opening(d, iterations=2)
    lab, n = ndi.label(diff)
    sizes = ndi.sum(diff, lab, range(1, n + 1))
    diff = lab == 1 + int(np.argmax(sizes))  # the mouth: render noise elsewhere (ear edge, brow area) is dropped
    mask = ndi.binary_dilation(ndi.binary_fill_holes(ndi.binary_closing(diff, iterations=8)), iterations=14)
    feather = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 6)
    ys, xs = np.nonzero(mask)
    rb = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)  # render px box of every sprite

    # Render px -> 1x head sheet px: the canvas rig_sheet.py pasted the head render on.
    head_sheet = cv2.imread(os.path.join(OUT, 'head.jpg'))
    hx, hy, hw, hh = pieces_of(cv2.imread(os.path.join(ROOT, 'art', 'parts', 'head.jpg')))[1]
    pad = int(0.25 * max(hw, hh))
    cx0, cy0 = hx - pad, hy - pad
    s = (hw + 2 * pad) / H.shape[1]
    hb_o = crop_origin(head_sheet, (790, 200))  # same point bake_rig.py cuts the blank head at
    # The bake keeps the ORIGINAL head frame: offsets are expressed in it (+ shift of the crop origin).
    o_old = crop_origin(cv2.imread(os.path.join(ROOT, 'art', 'parts', 'head.jpg')), (790, 200))
    shift = (hb_o[0] - o_old[0], hb_o[1] - o_old[1])

    # Sprites on a fresh mouth sheet, in a 4x3 grid with room between them; the bake reads the points from fits.json.
    old = cv2.imread(os.path.join(ROOT, 'art', 'parts', 'mouths.jpg'))
    bg = np.median(old[alpha_of(old) < 0.02], axis=0)
    ids = [3, 4, 2, 1, 6, 8, 7, 5, 9, 10, 11, 12]  # bake_rig.py's mouth id at each row-major position of mouths.jpg
    sw, sh_ = round((rb[2] - rb[0]) * s), round((rb[3] - rb[1]) * s)
    gap = 40
    sheet = np.empty((3 * (sh_ + gap) + gap, 4 * (sw + gap) + gap, 3), np.uint8)
    sheet[:] = bg
    fits, points, placed = {}, {}, []
    for k in range(12):
        R = renders[k][rb[1]:rb[3], rb[0]:rb[2]].astype(np.float32)
        # Hard edge on the green sheet (a soft one would mix in green); bake_rig.py feathers it after keying.
        al = ((mask[rb[1]:rb[3], rb[0]:rb[2]] * alpha_of(renders[k][rb[1]:rb[3], rb[0]:rb[2]])) > 0.5).astype(np.float32)[..., None]
        R[..., 1] = np.minimum(R[..., 1], np.maximum(R[..., 0], R[..., 2]))  # de-spill
        spr = cv2.resize(R, (sw, sh_), interpolation=cv2.INTER_AREA)
        sal = (cv2.resize(al, (sw, sh_), interpolation=cv2.INTER_AREA) > 0.5).astype(np.float32)[..., None]
        qx, qy = gap + (k % 4) * (sw + gap), gap + (k // 4) * (sh_ + gap)
        region = sheet[qy:qy + sh_, qx:qx + sw].astype(np.float32)
        sheet[qy:qy + sh_, qx:qx + sw] = (spr * sal + region * (1 - sal)).astype(np.uint8)
        placed.append((ids[k], qx, qy))

    lab, _ = ndi.label(ndi.binary_closing(alpha_of(sheet) > 0.5, iterations=2))
    for mid, qx, qy in placed:
        cell = lab[qy:qy + sh_, qx:qx + sw]
        ys, xs = np.nonzero(cell)
        if not len(xs):
            raise SystemExit(f'mouth {mid}: empty sprite')
        i = np.argmin((xs - sw / 2) ** 2 + (ys - sh_ / 2) ** 2)  # a pixel of the sprite near its middle
        pt = (int(qx + xs[i]), int(qy + ys[i]))
        points[str(mid)] = list(pt)
        mc_o = crop_origin(sheet, pt)
        # mouth crop px -> sheet px (+mc_o) -> render px -> head sheet px -> headB crop px (-hb_o)
        tx = mc_o[0] - qx + cx0 + rb[0] * s - hb_o[0] + shift[0]
        ty = mc_o[1] - qy + cy0 + rb[1] * s - hb_o[1] + shift[1]
        fits[str(mid)] = [[1.0, 0.0, tx], [0.0, 1.0, ty]]

    old_fits = json.load(open(os.path.join(ROOT, 'art', 'parts', 'fits.json')))
    json.dump({'a_to_b': old_fits['a_to_b'], 'mouths': fits, 'points': points, 'exact': True, 'b_shift': list(shift)}, open(os.path.join(OUT, 'fits.json'), 'w'), indent=1)
    cv2.imwrite(os.path.join(OUT, 'mouths.jpg'), sheet, [cv2.IMWRITE_JPEG_QUALITY, 96])
    
    print('art/parts_v4/mouths.jpg', sheet.shape[1], 'x', sheet.shape[0], '+ fits.json: 12 mouths, sprite', sw, 'x', sh_, 'px at 1x')


if __name__ == '__main__':
    main()
