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


def catmull(pts, closed, per=24):
    """Centripetal Catmull-Rom through control points (what the tracer page draws)."""
    P = np.asarray(pts, float)
    if closed:
        P = np.vstack([P[-1:], P, P[:2]])
    else:
        P = np.vstack([P[:1], P, P[-1:]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-6) ** 0.5
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-6) ** 0.5
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-6) ** 0.5
        for t in np.linspace(t1, t2, per, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    if not closed:
        out.append(P[-2])
    return np.array(out)


def bezier_path(path, per=40):
    """Dense points of a pen path from the tracer page: {closed, a: [{p, i, o}]} (cubic Béziers)."""
    A = path['a']
    n = len(A)
    segs = n if path.get('closed') else n - 1
    out = []
    for k in range(segs):
        a, b = A[k], A[(k + 1) % n]
        p0, p3 = np.array(a['p'], float), np.array(b['p'], float)
        p1 = np.array(a['o'] if a.get('o') else a['p'], float)
        p2 = np.array(b['i'] if b.get('i') else b['p'], float)
        for t in np.linspace(0, 1, per, endpoint=False):
            u = 1 - t
            out.append(u ** 3 * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t ** 3 * p3)
    if not path.get('closed'):
        out.append(np.array(A[-1]['p'], float))
    return np.array(out)


def shape_points(v, closed):
    """A shape from manual.json: a pen path (dict) or an older list of Catmull-Rom points."""
    return bezier_path(v) if isinstance(v, dict) else catmull(v, closed)


def control(curve, n):
    """n evenly spaced points along a dense curve (start points for the tracer page)."""
    seg = np.hypot(*np.diff(np.vstack([curve, curve[:1]]), axis=0).T)
    t = np.concatenate([[0], np.cumsum(seg)])[:-1]
    u = np.linspace(0, t[-1], n, endpoint=False)
    return [[round(float(np.interp(v, t, curve[:, 0])), 1), round(float(np.interp(v, t, curve[:, 1])), 1)] for v in u]


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
        # Where the pupil touches the rim the dark merges: fit the ellipse only on its free outline.
        pc_ = contour(pup, 0.5)
        far_from_rim = ndi.distance_transform_edt(ndi.binary_fill_holes(sil))
        free = np.array([q for q in pc_ if far_from_rim[int(q[1]), int(q[0])] > 14])
        (pcx, pcy), (pa, pb), pang = cv2.fitEllipse((free if len(free) >= 8 else pc_).astype(np.float32))
        # Where the pupil meets the rim the dark pixels merge: the inside is the convex shape holding the
        # white and the whole fitted pupil ellipse, kept within the silhouette.
        ell = cv2.ellipse2Poly((int(pcx), int(pcy)), (int(pa / 2), int(pb / 2)), int(pang), 0, 360, 5)
        pts = np.vstack([np.column_stack(np.nonzero(blob)[::-1]), ell]).astype(np.int32)
        inside = np.zeros(blob.shape, np.uint8)
        cv2.fillPoly(inside, [cv2.convexHull(pts)], 1)
        # The ink rim is ~10-12 px thick all round (4x px): keep the white that far inside the silhouette.
        inside = inside.astype(bool) & ndi.binary_erosion(sil, iterations=10)
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

    # The nose: the dark blob at the tip of the muzzle (bottom right of the crop).
    nb = ndi.binary_opening(dark[595:700, 480:600], iterations=2)
    nl, nn = ndi.label(nb)
    ys_, xs_ = np.nonzero(nl == 1 + int(np.argmax(ndi.sum(nb, nl, range(1, nn + 1)))))
    nose = (xs_.mean() + 480, ys_.mean() + 595)
    # The line under the far eye (master: from below the far eye down to the cheek spike): per column,
    # the dark pixel nearest the far eye's bottom, outside the eye.
    fz = ndi.binary_dilation(eyes['far']['sil'], iterations=8)
    fy0 = int(np.nonzero(eyes['far']['sil'])[0].max())
    ux, uy = [], []
    for x in range(int(eyes['far']['centre'][0]) - 10, int(eyes['far']['centre'][0]) + 110):
        ys = np.nonzero(dark[fy0 - 40:fy0 + 60, x] & ~fz[fy0 - 40:fy0 + 60, x])[0]
        if not len(uy) and len(ys):
            ys = ys[ys + fy0 - 40 >= fy0 - 6]  # start just under the eye
        ys = ys + fy0 - 40
        if len(uy):
            ys = ys[np.abs(ys - uy[-1]) < 8]  # follow the same line, not the head outline above it
        if len(ys):
            ux.append(x)
            uy.append(ys.min())
    underline = np.column_stack([ux, ndi.median_filter(np.array(uy, float), 9)]) if ux else np.zeros((0, 2))

    # Hand-drawn shapes (art/reference/trace/manual.json, from the studio's tracer page) replace the
    # automatic ones; the automatic ones are written to auto.json as the page's starting point.
    auto = {
        'near.silhouette': control(eyes['near']['silhouette'], 20), 'near.white': control(eyes['near']['white'], 18),
        'far.silhouette': control(eyes['far']['silhouette'], 16), 'far.white': control(eyes['far']['white'], 14),
        'brow.near': control(brows['near'], 18), 'brow.far': control(brows['far'], 12),
        'near.pupil': control(cv2.ellipse2Poly((int(eyes['near']['pupil'][0]), int(eyes['near']['pupil'][1])), (int(eyes['near']['pupil'][2]), int(eyes['near']['pupil'][3])), int(eyes['near']['pupil'][4]), 0, 360, 4).astype(float), 10),
        'far.pupil': control(cv2.ellipse2Poly((int(eyes['far']['pupil'][0]), int(eyes['far']['pupil'][1])), (int(eyes['far']['pupil'][2]), int(eyes['far']['pupil'][3])), int(eyes['far']['pupil'][4]), 0, 360, 4).astype(float), 10),
        'far.underline': [[round(float(x), 1), round(float(y), 1)] for x, y in underline[:: max(1, len(underline) // 6)]],
    }
    TRACE = os.path.dirname(SRC)
    json.dump(auto, open(os.path.join(TRACE, 'auto.json'), 'w'), indent=1)
    man_path = os.path.join(TRACE, 'manual.json')
    if os.path.exists(man_path):
        man = json.load(open(man_path, encoding='utf8'))
        man = {k: v for k, v in man.items() if len(v['a'] if isinstance(v, dict) else v) >= (2 if k == 'far.underline' else 3)}
        for side in ('near', 'far'):
            if f'{side}.silhouette' in man:
                eyes[side]['silhouette'] = shape_points(man[f'{side}.silhouette'], True)
            if f'{side}.white' in man:
                wh = shape_points(man[f'{side}.white'], True)
                eyes[side]['white'] = wh
                eyes[side]['centre'] = (wh[:, 0].mean(), wh[:, 1].mean())
                eyes[side]['height'] = float(np.ptp(wh[:, 1]))
                eyes[side]['width'] = float(np.ptp(wh[:, 0]))
            if f'{side}.pupil' in man:
                pp = shape_points(man[f'{side}.pupil'], True).astype(np.float32)
                (pcx, pcy), (pa, pb), pang = cv2.fitEllipse(pp)
                eyes[side]['pupil'] = (pcx, pcy, pa / 2, pb / 2, pang)
            if f'brow.{side}' in man:
                brows[side] = shape_points(man[f'brow.{side}'], True)
        ul = man.get('far.underline')
        if ul and len(ul['a'] if isinstance(ul, dict) else ul) >= 2:
            underline = shape_points(ul, False)
        print('manual shapes used:', ', '.join(sorted(man)))

    # Normalise: origin = near white centre, unit = near white height.
    ox, oy = eyes['near']['centre']
    unit = eyes['near']['height']
    norm = lambda pts: [[round((x - ox) / unit, 4), round((y - oy) / unit, 4)] for x, y in pts]
    out = {'source': 'art/reference/agent-fox-master.png (face, upscaled 4x)', 'eyes': {}, 'brows': {},
           'nose': [round((nose[0] - ox) / unit, 4), round((nose[1] - oy) / unit, 4)]}
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
                      'ry': round(max(pa, pb) / unit, 4),
                      # Angle of the long axis from vertical, degrees (clockwise), in the master's (rolled) frame.
                      'angle': round(float(pang if pa <= pb else pang - 90), 2)},
            'highlight': ({'x': round((e['hl'][0] - ox) / unit, 4), 'y': round((e['hl'][1] - oy) / unit, 4), 'r': round(e['hl'][2] / unit, 4)}
                          if e['hl'] else None),
        }
    for side, b in brows.items():
        out['brows'][side] = norm(b[::2])
    out['underline'] = norm(underline[:: max(1, len(underline) // 40)]) if len(underline) else []
    # Eye profiles for the animated lid: at N columns across the silhouette, the silhouette's and the
    # white's top and bottom (where the white does not reach, its top = bottom = the lid's closing line).
    N = 81
    for side, e in eyes.items():
        sil, wh = e['silhouette'], e['white']
        # Cosine spacing: columns dense at the two ends, where the outline turns fast.
        x0, x1 = sil[:, 0].min() + 0.5, sil[:, 0].max() - 0.5
        xs = (x0 + x1) / 2 - (x1 - x0) / 2 * np.cos(np.linspace(0, np.pi, N))
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
        out['eyes'][side]['white'] = norm(wh[::2])
        out['eyes'][side]['silhouette'] = norm(sil[::2])

    # Snout bridge: the head's outer outline (last non-green pixel before the green) from the top of the
    # far eye down to the top of the nose, scanning right from the far eye's centre.
    green = (H > 40) & (H < 80) & (S > 120)
    fcx, fcy = eyes['far']['centre']
    ftop = int(np.nonzero(eyes['far']['sil'])[0].min())
    bridge = []
    for y in range(ftop, int(nose[1]) - 20):
        row = green[y, int(fcx):590].astype(int)
        run = np.convolve(row, np.ones(6, int), 'valid')  # a real run of green, not an anti-aliased pixel
        g = np.nonzero(run == 6)[0]
        if len(g):
            bridge.append((int(fcx) + g[0] - 1, y))
    bridge = np.array(bridge, float)
    # Smooth outline x(y): median over 31 rows (drops the cheek spike), then a quartic fit.
    xm = ndi.median_filter(bridge[:, 0], size=31, mode='nearest')
    keep = np.abs(bridge[:, 0] - xm) < 5  # rows of the cheek spike stick out: fit on the true outline only
    cf = np.polyfit(bridge[keep, 1], bridge[keep, 0], 5)
    bridge = np.column_stack([np.polyval(cf, bridge[:, 1]), bridge[:, 1]])
    out['bridge'] = norm(bridge[::6])

    # Debug overlay.
    dbg = img.copy()
    for side, e in eyes.items():
        cv2.polylines(dbg, [e['silhouette'].astype(np.int32)], True, (255, 0, 255), 2)
        cv2.polylines(dbg, [e['white'].astype(np.int32)], True, (255, 255, 0), 2)
        pcx, pcy, pa, pb, pang = e['pupil']
        cv2.ellipse(dbg, ((pcx, pcy), (pa * 2, pb * 2), pang), (0, 0, 255), 2)
    for b in brows.values():
        cv2.polylines(dbg, [b.astype(np.int32)], True, (0, 255, 255), 2)
    cv2.polylines(dbg, [bridge.astype(np.int32)], False, (255, 0, 0), 3)
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
