"""
Trace Agent Fox's eyes and brows from the master drawing into code.

Input: art/reference/trace/face_4x.png (the master's face, cropped from
art/reference/agent-fox-master.png and upscaled 4x with tools/upscale.py).
For each eye it extracts, by colour:
  - the eye's ink silhouette (white + rim + heavy upper lid, filled),
  - the white (the inside of the rim),
  - the pupil (an ellipse) and its catch-light,
and the two brows as filled shapes. Points are expressed relative to the near
eye's white centre, in units of the near white's height, so the rig can draw
them at any size and the two eyes keep the master's spacing and proportions.

Usage: python tools/trace_face.py [--ts path/to/masterFace.ts]
Output: the TypeScript module + art/reference/trace/trace_debug.png (overlay to check by eye)
"""
import argparse, json, os
import cv2, numpy as np
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art', 'reference', 'trace', 'face_4x.png')


def contour(mask, eps=1.2):
    """Largest outer contour of a mask, lightly simplified, as float points."""
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, eps, True)
    return c.reshape(-1, 2).astype(np.float64)


def fourier(pts, keep):
    """Smooth closed curve: resample by arc length, keep the lowest `keep` harmonics (harmonious curves)."""
    p = np.vstack([pts, pts[:1]])
    seg = np.hypot(*np.diff(p, axis=0).T)
    t = np.concatenate([[0], np.cumsum(seg)])
    u = np.linspace(0, t[-1], 256, endpoint=False)
    z = np.interp(u, t, p[:, 0]) + 1j * np.interp(u, t, p[:, 1])
    F = np.fft.fft(z)
    F[keep + 1:len(F) - keep] = 0
    z = np.fft.ifft(F)
    return np.column_stack([z.real, z.imag])


def profile(curve, xs):
    """Top and bottom y of a closed curve at each x (nan where the curve does not reach)."""
    top, bot = np.full(len(xs), np.nan), np.full(len(xs), np.nan)
    c = np.vstack([curve, curve[:1]])
    for i, x in enumerate(xs):
        ys = []
        for (x0, y0), (x1, y1) in zip(c[:-1], c[1:]):
            if (x0 - x) * (x1 - x) <= 0 and x0 != x1:
                ys.append(y0 + (y1 - y0) * (x - x0) / (x1 - x0))
        if ys:
            top[i], bot[i] = min(ys), max(ys)
    return top, bot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ts', default=None)
    a = ap.parse_args()
    img = cv2.imread(SRC)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(int)
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    # Eye whites are near-neutral (the cream muzzle is warmer); only the eye band of the crop is searched.
    white = (V > 200) & (S < 28)
    white[int(img.shape[0] * 0.72):] = False
    dark = V < 100

    # The two eye whites: the two largest white blobs (the catch-lights are small).
    lab, n = ndi.label(ndi.binary_opening(white, iterations=2))
    sizes = ndi.sum(white, lab, range(1, n + 1))
    order = np.argsort(sizes)[::-1][:2] + 1
    blobs = sorted((lab == i for i in order), key=lambda m: np.nonzero(m)[1].mean())  # left = near eye
    eyes = {}
    for side, blob in zip(('near', 'far'), blobs):
        hull = cv2.convexHull(contour(blob).astype(np.int32))
        inside = np.zeros(blob.shape, np.uint8)
        cv2.fillPoly(inside, [hull], 1)
        inside = inside.astype(bool)
        # Ink silhouette: the white plus the dark rim around it (thick upper lid included).
        ring = ndi.binary_dilation(inside, iterations=34) & ~inside
        rim = ring & dark
        rim_lab, rn = ndi.label(rim)
        touching = set(np.unique(rim_lab[ndi.binary_dilation(inside, iterations=3) & rim])) - {0}
        rim = np.isin(rim_lab, list(touching))
        sil = ndi.binary_fill_holes(ndi.binary_closing(inside | rim, iterations=3))
        # The eye's inside is everything within the rim (the white AND the pupil where it meets the rim).
        inside = ndi.binary_opening(sil & ~ndi.binary_dilation(rim, iterations=1), iterations=2)
        il, inn = ndi.label(inside)
        inside = il == 1 + int(np.argmax(ndi.sum(inside, il, range(1, inn + 1))))
        # Pupil: dark inside the white; catch-light: white inside the pupil.
        pup = ndi.binary_opening(dark & inside, iterations=2)
        pl, pn = ndi.label(pup)
        pup = pl == 1 + int(np.argmax(ndi.sum(pup, pl, range(1, pn + 1))))
        (pcx, pcy), (pa, pb), pang = cv2.fitEllipse(contour(pup).astype(np.float32))
        # Where the pupil meets the rim the dark pixels merge: the inside is the convex shape holding the
        # white and the whole fitted pupil ellipse, kept within the silhouette.
        ell = cv2.ellipse2Poly((int(pcx), int(pcy)), (int(pa / 2), int(pb / 2)), int(pang), 0, 360, 5)
        pts = np.vstack([np.column_stack(np.nonzero(blob)[::-1]), ell]).astype(np.int32)
        inside = np.zeros(blob.shape, np.uint8)
        cv2.fillPoly(inside, [cv2.convexHull(pts)], 1)
        inside = inside.astype(bool) & ndi.binary_erosion(sil, iterations=3)
        hl = white & ndi.binary_fill_holes(pup) & ~pup
        hl_c = (np.nonzero(hl)[1].mean(), np.nonzero(hl)[0].mean(), np.sqrt(hl.sum() / np.pi)) if hl.any() else None
        ys, xs = np.nonzero(inside)
        eyes[side] = dict(inside=inside, sil=sil, white=fourier(contour(inside, 0.5), 7), silhouette=fourier(contour(sil, 0.5), 9),
                          centre=(xs.mean(), ys.mean()), height=float(np.ptp(ys)), width=float(np.ptp(xs)),
                          pupil=(pcx, pcy, pa / 2, pb / 2, pang), hl=hl_c)

    # Brows: their dark-brown fill (darker and more saturated than the hat, lighter than the ink lines,
    # which also join them to the hat and the head outline), grown back over their own ink outline.
    eye_zone = ndi.binary_dilation(eyes['near']['sil'] | eyes['far']['sil'], iterations=6)
    brow_fill = (V > 15) & (V < 56) & (S > 100)
    cand = ndi.binary_opening(brow_fill & ~eye_zone, iterations=3)
    bl, bn = ndi.label(cand)
    brows = {}
    for side in ('near', 'far'):
        cx, cy = eyes[side]['centre']
        h = eyes[side]['height']
        best, score = None, None
        for i in range(1, bn + 1):
            m = bl == i
            ys, xs = np.nonzero(m)
            if m.sum() < 400 or ys.min() < 20:  # specks, or anything reaching the top of the crop
                continue
            if not (cy - 1.6 * h < ys.mean() < cy - 0.35 * h):
                continue
            d = abs(xs.mean() - cx)
            if score is None or d < score:
                best, score = m, d
        best = ndi.binary_dilation(best, iterations=4) & (dark | brow_fill)  # its ink outline
        brows[side] = fourier(contour(ndi.binary_fill_holes(best), 0.5), 12)

    # Normalise: origin = near white centre, unit = near white height.
    ox, oy = eyes['near']['centre']
    unit = eyes['near']['height']
    norm = lambda pts: [[round((x - ox) / unit, 4), round((y - oy) / unit, 4)] for x, y in pts]
    out = {'source': 'art/reference/agent-fox-master.png (face, upscaled 4x)', 'eyes': {}, 'brows': {}}
    for side, e in eyes.items():
        pcx, pcy, pa, pb, pang = e['pupil']
        out['eyes'][side] = {
            'centre': norm([e['centre']])[0],
            'width': round(e['width'] / unit, 4),
            'height': round(e['height'] / unit, 4),
            'white': norm(e['white']),
            'silhouette': norm(e['silhouette']),
            # Pupil as drawn (the master looks down and to the right) + its size.
            'pupil': {'x': round((pcx - ox) / unit, 4), 'y': round((pcy - oy) / unit, 4), 'rx': round(min(pa, pb) / unit, 4),
                      'ry': round(max(pa, pb) / unit, 4)},
            'highlight': ({'x': round((e['hl'][0] - ox) / unit, 4), 'y': round((e['hl'][1] - oy) / unit, 4), 'r': round(e['hl'][2] / unit, 4)}
                          if e['hl'] else None),
        }
    for side, b in brows.items():
        out['brows'][side] = norm(b[::4])
    # Eye profiles for the animated lid: at N columns across the silhouette, the silhouette's and the
    # white's top and bottom (where the white does not reach, its top = bottom = the lid's closing line).
    N = 33
    for side, e in eyes.items():
        sil, wh = e['silhouette'], e['white']
        xs = np.linspace(sil[:, 0].min() + 0.5, sil[:, 0].max() - 0.5, N)
        st, sb = profile(sil, xs)
        wt, wb = profile(wh, xs)
        ok = ~np.isnan(wt)
        mid = (wt + wb) / 2
        # Outside the white: close on the line joining its two corners, kept inside the silhouette.
        idx = np.nonzero(ok)[0]
        cl = np.interp(xs, xs[idx], mid[idx])
        cl = np.clip(cl, st, sb)
        wt = np.where(ok, wt, cl)
        wb = np.where(ok, wb, cl)
        nx = lambda v: [round((x - ox) / unit, 4) for x in v]
        ny = lambda v: [round((y - oy) / unit, 4) for y in v]
        out['eyes'][side]['profile'] = {'x': nx(xs), 'silTop': ny(st), 'silBot': ny(sb), 'whiteTop': ny(wt), 'whiteBot': ny(wb)}
        out['eyes'][side]['white'] = norm(wh[::4])
        out['eyes'][side]['silhouette'] = norm(sil[::4])

    # Debug overlay.
    dbg = img.copy()
    for side, e in eyes.items():
        cv2.polylines(dbg, [e['silhouette'].astype(np.int32)], True, (255, 0, 255), 2)
        cv2.polylines(dbg, [e['white'].astype(np.int32)], True, (255, 255, 0), 2)
        pcx, pcy, pa, pb, pang = e['pupil']
        cv2.ellipse(dbg, ((pcx, pcy), (pa * 2, pb * 2), pang), (0, 0, 255), 2)
    for b in brows.values():
        cv2.polylines(dbg, [b.astype(np.int32)], True, (0, 255, 255), 2)
    # Grid every 0.1 unit (near eye-white height) centred on the near eye, to check the fit by eye.
    for v in np.arange(-3, 3.01, 0.1):
        for p_ in ((int(ox + v * unit), 0, int(ox + v * unit), dbg.shape[0]), (0, int(oy + v * unit), dbg.shape[1], int(oy + v * unit))):
            cv2.line(dbg, p_[:2], p_[2:], (90, 90, 90) if abs(v) > 1e-6 else (0, 0, 255), 1)
    cv2.imwrite(os.path.join(ROOT, 'art', 'reference', 'trace', 'trace_debug.png'), dbg)

    if a.ts:
        with open(a.ts, 'w', encoding='utf8') as f:
            f.write('// Generated by tools/trace_face.py from the master drawing — do not edit by hand.\n')
            f.write('// Points: origin = centre of the near eye white, unit = its height.\n')
            f.write('export const MASTER_FACE = ' + json.dumps(out) + ' as const;\n')
    print({s: (len(e['white']), len(e['silhouette'])) for s, e in out['eyes'].items()}, {s: len(b) for s, b in out['brows'].items()})


if __name__ == '__main__':
    main()
