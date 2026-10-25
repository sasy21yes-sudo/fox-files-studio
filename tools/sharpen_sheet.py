"""
Put the full-resolution render of a rig piece back into its 4x sheet (art/parts_v4/up/<sheet>.png).

The bake cuts pieces from the 4x sheets, which are Real-ESRGAN upscales of the 1x sheets the pieces were
pasted on, shrunk: a 1024 px render ends up ~240 px tall and comes back soft. This aligns the original
render onto its piece in the 4x sheet (bounding box guess, then an ECC affine fit on the image) and
pastes it there, so the bake gets the render's own lines; every coordinate of the sheet stays valid.

  python tools/sharpen_sheet.py <sheet> <x> <y> <render.png>
      sheet: name in art/parts_v4 (head, ...); x, y: a 1x sheet point inside the piece (as bake_rig.py cuts it)
The ESRGAN sheet is kept once as up/<sheet>_esrgan.png: the alignment is always measured on it (the
original geometry); the paste goes into the current sheet, so pieces pasted before stay.
"""
import os, shutil, sys
import cv2, numpy as np
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS = os.path.join(ROOT, 'art', 'parts_v4')


def alpha(bgr):
    f = bgr.astype(np.float32)
    return np.clip((150 - (f[..., 1] - np.maximum(f[..., 0], f[..., 2]))) / 90.0, 0, 1)


def main(name, x, y, render_path):
    s1 = cv2.imread(os.path.join(PARTS, name + '.jpg'))
    up = os.path.join(PARTS, 'up', name + '.png')
    keep = os.path.join(PARTS, 'up', name + '_esrgan.png')
    if not os.path.exists(keep):
        shutil.copy(up, keep)
    s4 = cv2.imread(keep)
    cur = cv2.imread(up)
    r = cv2.imread(render_path)
    # The piece on the 1x sheet (the component under x, y), in 4x px.
    lab, _ = ndi.label(ndi.binary_closing(alpha(s1) > 0.5, iterations=2))
    m = ndi.binary_fill_holes(lab == lab[y, x])
    ys, xs = np.nonzero(m)
    px0, py0, px1, py1 = xs.min() * 4, ys.min() * 4, (xs.max() + 1) * 4, (ys.max() + 1) * 4
    ra = alpha(r) > 0.5
    lab_r, n = ndi.label(ra)
    big = lab_r == 1 + int(np.argmax(ndi.sum(ra, lab_r, range(1, n + 1))))
    rys, rxs = np.nonzero(big)
    rx0, ry0, rx1, ry1 = rxs.min(), rys.min(), rxs.max() + 1, rys.max() + 1
    s = ((px1 - px0) / (rx1 - rx0) + (py1 - py0) / (ry1 - ry0)) / 2
    W = np.float32([[s, 0, px0 - rx0 * s], [0, s, py0 - ry0 * s]])
    # Refine on the image itself (grey levels, in a box round the piece).
    pad = 60
    bx0, by0 = max(px0 - pad, 0), max(py0 - pad, 0)
    bx1, by1 = min(px1 + pad, s4.shape[1]), min(py1 + pad, s4.shape[0])
    tmpl = cv2.cvtColor(s4[by0:by1, bx0:bx1], cv2.COLOR_BGR2GRAY).astype(np.float32)
    Wb = W.copy()
    Wb[:, 2] -= (bx0, by0)
    # ECC wants the warp from template to input: invert ours (render -> box).
    inv = cv2.invertAffineTransform(Wb).astype(np.float32)
    src = cv2.cvtColor(r, cv2.COLOR_BGR2GRAY).astype(np.float32)
    try:
        _, inv = cv2.findTransformECC(tmpl, src, inv, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), None, 5)
        Wb = cv2.invertAffineTransform(inv)
        how = 'ECC'
    except cv2.error:
        how = 'bounding box'
    W = Wb.copy()
    W[:, 2] += (bx0, by0)
    warped = cv2.warpAffine(r, W, (s4.shape[1], s4.shape[0]), flags=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC, borderValue=(24, 224, 24))
    wa = cv2.warpAffine(big.astype(np.float32), W, (s4.shape[1], s4.shape[0]))
    region = np.zeros(wa.shape, np.float32)
    region[py0 - 20:py1 + 20, px0 - 20:px1 + 20] = 1
    # The render (drawing and its own green round it) replaces the piece's whole box, so nothing of the
    # old piece (a bristle, a halo past the new outline) survives; feathered at the box edge.
    k = cv2.GaussianBlur(region, (0, 0), 3)[..., None]
    out = (warped.astype(np.float32) * k + cur.astype(np.float32) * (1 - k)).astype(np.uint8)
    cv2.imwrite(up, out)
    # Check: how well the old and the new piece line up (mean difference of their outlines).
    e_old = cv2.Canny(cv2.cvtColor(s4[py0:py1, px0:px1], cv2.COLOR_BGR2GRAY), 60, 150) > 0
    e_new = cv2.Canny(cv2.cvtColor(out[py0:py1, px0:px1], cv2.COLOR_BGR2GRAY), 60, 150) > 0
    dt = ndi.distance_transform_edt(~e_old)
    print(f'{name}: render pasted ({how}), scale {s:.3f}, outline offset {dt[e_new].mean():.2f} px (4x)')


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4])
