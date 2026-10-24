"""
Big limb moves for a frame-by-frame clip, from ONE finished drawing: the limb is cut out of the drawing and
posed like a two-bone puppet, so the art stays the drawing's own (no AI redraw, no cross-fade ghost).

  python tools/clips/limb_puppet.py <out dir> --key pose.png --body pose_without_limb.png \
         --joints 738,330,760,408,805,372 --poses "-8,85;-10,95;-6,60;0,0" --holds 8,2,2,14

--key    the drawing (green screen), e.g. an approved pose from art/incoming/pieces/poses_key
--body   the same drawing without that limb (Qwen: "remove his right arm ... as if hidden behind his back")
--joints shoulder, elbow, wrist of the limb in --key px
--poses  one "upper,fore" pair of degrees per drawing: the upper bone turns by `upper` around the
         shoulder, the forearm by `upper + fore` around the moved elbow (clockwise positive, 0,0 = as drawn);
         the hand and whatever it holds ride on the forearm
--holds  ticks of each drawing (written to holds.txt for build_clip.py --holds)

Why: Qwen does not draw in-between poses of an arm (asked for "halfway" it keeps the pose, or switches arm),
and FILM cross-fades a hand that travels more than ~40 px. The limb here is the drawing's own pixels:
the limb is where the drawing differs from its limb-less twin, skinned to the two bones with a soft
blend at the elbow (linear blend skinning, inverse-mapped per pixel, Lanczos on premultiplied alpha).
"""
import argparse, os, sys
import cv2, numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_clip import key, register  # noqa: E402

INK = np.array([22, 24, 30], np.float32)  # BGR: the drawings' dark-brown outline


def seg_dist(px, py, a, b):
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / max(vx * vx + vy * vy, 1e-9), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


def rot(deg):
    t = np.radians(deg)
    return np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])


def fill_holes(m):
    m = m.astype(np.uint8)
    ff = m.copy()
    cv2.floodFill(ff, np.zeros((m.shape[0] + 2, m.shape[1] + 2), np.uint8), (0, 0), 1)
    return (m | (1 - ff)).astype(bool)


def over(top, bot):
    a, ab = top[..., 3:] / 255, bot[..., 3:] / 255
    oa = a + ab * (1 - a)
    rgb = (top[..., :3] * a + bot[..., :3] * ab * (1 - a)) / np.maximum(oa, 1e-4)
    return np.dstack([rgb, oa * 255])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out')
    ap.add_argument('--key', required=True)
    ap.add_argument('--body', required=True)
    ap.add_argument('--joints', required=True)
    ap.add_argument('--poses', required=True)
    ap.add_argument('--holds', default='')
    ap.add_argument('--reach', type=float, default=1.0, help='how far from the bones (x their length) the limb may reach (props)')
    ap.add_argument('--blend', type=float, default=10, help='softness of the elbow blend (px)')
    ap.add_argument('--cover', type=float, default=0, help='radius (px) around the shoulder where the body covers the turned limb root (0 = off)')
    ap.add_argument('--ink', type=int, default=3, help='outline width (px) drawn where a bend opens the edge')
    ap.add_argument('--debug', action='store_true')
    a = ap.parse_args()

    k = key(cv2.imread(a.key))
    b = key(cv2.imread(a.body))
    H, W = k.shape[:2]
    b = register([k, b], (0, 0, W, H), 'translation')[0][1]
    j = [float(v) for v in a.joints.split(',')]
    S, E, Wr = np.array(j[0:2]), np.array(j[2:4]), np.array(j[4:6])

    # The limb: where the drawing differs from its limb-less twin, in the pieces that touch the bones.
    pk, pb = k[..., :3] * k[..., 3:] / 255, b[..., :3] * b[..., 3:] / 255
    d = np.maximum(np.abs(pk - pb).max(2), np.abs(k[..., 3] - b[..., 3]))
    m = ((d > 60) & (k[..., 3] > 128)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    du0 = seg_dist(xx, yy, S, E)
    df0 = seg_dist(xx, yy, E, Wr)
    near = np.minimum(du0, df0) < 30
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = [i for i in range(1, n) if st[i, 4] > 80 and near[lab == i].any()]
    m = np.isin(lab, keep).astype(np.uint8)
    m = fill_holes(cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)))
    m &= k[..., 3] > 8
    # Under the limb: the drawing itself, and the limb-less twin only where the limb was (a redrawn head or
    # coat would boil against the drawing's own frame).
    # (wide enough that the limb's own outline is fully replaced: a blend there left its ghost)
    mv = cv2.GaussianBlur(cv2.dilate(m.astype(np.uint8), np.ones((17, 17), np.uint8)).astype(np.float32), (0, 0), 2)[..., None]
    # (the twin's faint leftovers where the limb was, e.g. grey ghost lines on the background, go)
    bt = b.copy()
    bt[..., 3] = np.where(bt[..., 3] > 150, bt[..., 3], bt[..., 3] * np.clip((bt[..., 3] - 60) / 90, 0, 1))
    b = bt * mv + k * (1 - mv)
    coat = b.copy()
    limb = k.copy()
    limb[..., 3] *= np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.7) * 1.3 - 0.15, 0, 1)
    pre = limb.copy()
    pre[..., :3] *= pre[..., 3:] / 255
    if a.debug:
        os.makedirs(a.out, exist_ok=True)
        dbg = k[..., :3].copy()
        dbg[m] = dbg[m] * 0.5 + np.array([255, 0, 255]) * 0.5
        for p, q in ((S, E), (E, Wr)):
            cv2.line(dbg, tuple(int(v) for v in p), tuple(int(v) for v in q), (0, 0, 255), 2)
        cv2.imwrite(os.path.join(a.out, '_limb.png'), np.clip(dbg, 0, 255).astype(np.uint8))

    Lu = float(np.hypot(*(E - S)))
    # Skin weights, on the drawing as drawn: 0 = upper bone, 1 = forearm (and everything past the wrist).
    wsrc = (1 / (1 + np.exp(np.clip((seg_dist(xx, yy, E, Wr + (Wr - E) * 4) - du0) / a.blend, -30, 30)))).astype(np.float32)
    poses = [tuple(float(v) for v in p.split(',')) for p in a.poses.split(';')]

    def drawing(au, af):
        if abs(au) < 1e-6 and abs(af) < 1e-6:
            return k
        Ru, Rf = rot(au), rot(au + af)
        E2 = S + Ru @ (E - S)
        W2 = E2 + Rf @ (Wr - E)
        # Destination weights from the posed bones; the forearm owns everything past the elbow (hand, prop).
        du = seg_dist(xx, yy, S, E2)
        df = seg_dist(xx, yy, E2, W2 + (W2 - E2) * 4)
        wf = 1 / (1 + np.exp(np.clip((df - du) / a.blend, -30, 30)))
        # Inverse maps of the two bones.
        Ui, Fi = Ru.T, Rf.T
        qx, qy = xx - S[0], yy - S[1]
        ux = S[0] + Ui[0, 0] * qx + Ui[0, 1] * qy
        uy = S[1] + Ui[1, 0] * qx + Ui[1, 1] * qy
        rx, ry = xx - E2[0], yy - E2[1]
        fx = E[0] + Fi[0, 0] * rx + Fi[0, 1] * ry
        fy = E[1] + Fi[1, 0] * rx + Fi[1, 1] * ry
        # Start each pixel from the bone whose own part of the drawing it lands on (forearm first: it is in
        # front where the two overlap), then refine.
        wfa = cv2.remap(wsrc, fx.astype(np.float32), fy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        afa = cv2.remap(pre[..., 3], fx.astype(np.float32), fy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        use_f = (wfa > 0.5) & (afa > 1)
        px = np.where(use_f, fx, ux).astype(np.float32)
        py = np.where(use_f, fy, uy).astype(np.float32)
        del wf
        # That guess weighs the bones where the pixel lands; the skin's weights belong to where it comes FROM.
        # Invert the forward skinning exactly (fixed point): a place no part of the limb reaches stays empty,
        # instead of copying the forearm's old pixels through the upper bone.
        for _ in range(14):
            w = cv2.remap(wsrc, px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            ax_, ay_ = px - S[0], py - S[1]
            bx_, by_ = px - E[0], py - E[1]
            gx = (1 - w) * (S[0] + Ru[0, 0] * ax_ + Ru[0, 1] * ay_) + w * (E2[0] + Rf[0, 0] * bx_ + Rf[0, 1] * by_)
            gy = (1 - w) * (S[1] + Ru[1, 0] * ax_ + Ru[1, 1] * ay_) + w * (E2[1] + Rf[1, 0] * bx_ + Rf[1, 1] * by_)
            # Newton step: the error is turned back by the local rotation (a plain p += q - f(p) diverges past
            # ~60 degrees, the forearm then vanished).
            j00 = (1 - w) * Ru[0, 0] + w * Rf[0, 0]
            j01 = (1 - w) * Ru[0, 1] + w * Rf[0, 1]
            j10 = (1 - w) * Ru[1, 0] + w * Rf[1, 0]
            j11 = (1 - w) * Ru[1, 1] + w * Rf[1, 1]
            det = j00 * j11 - j01 * j10
            det = np.where(np.abs(det) < 0.05, 0.05, det)
            ex_, ey_ = xx - gx, yy - gy
            px = (px + (j11 * ex_ - j01 * ey_) / det).astype(np.float32)
            py = (py + (-j10 * ex_ + j00 * ey_) / det).astype(np.float32)
        miss = np.hypot(xx - gx, yy - gy) > 0.75
        w = cv2.remap(pre, px, py, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        w[miss] = 0
        # (the faint fringe of the cut-out, reached from far away through a bone, would draw ghost lines)
        w[w[..., 3] < 24] = 0
        w = np.clip(w, 0, 255)
        w[..., :3] /= np.maximum(w[..., 3:] / 255, 1e-4)
        w = np.clip(w, 0, 255)
        out = over(reink(w), b)
        if a.cover > 0:
            # The limb's root goes under the body's own edge there (a turned arm otherwise shows the cut end
            # of its sleeve): the twin's coat is laid back over a disc around the shoulder, more as it turns.
            st_ = min(1.0, abs(au) / 12)
            disc = np.clip((a.cover - np.hypot(xx - S[0], yy - S[1])) / 6, 0, 1) * st_
            c2 = coat.copy()
            c2[..., 3] = np.where(coat[..., 3] > 230, 255, 0) * disc
            out = over(c2, out)
        return out

    def reink(w):
        """Where a bend opened the limb's edge (a cut through the fill, no ink), ink it like the drawing."""
        la = w[..., 3] > 128
        if not la.any():
            return w
        lum = w[..., :3].mean(2)
        inner = la & ~cv2.erode(la.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2).astype(bool)
        # (an edge that already has the drawing's ink close by is not a cut)
        dark = inner & (lum < 60)
        cut = inner & (lum > 70) & ~cv2.dilate(dark.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))).astype(bool)
        ring = cv2.dilate(la.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * a.ink + 1, 2 * a.ink + 1))).astype(bool) & ~la
        need = ring & cv2.dilate(cut.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * a.ink + 3, 2 * a.ink + 3))).astype(bool)
        if not need.any():
            return w
        ink = np.zeros_like(w)
        ink[..., :3] = INK
        ink[..., 3] = cv2.GaussianBlur(need.astype(np.float32), (0, 0), 0.6) * 255
        return over(w, ink)

    os.makedirs(a.out, exist_ok=True)
    for f in os.listdir(a.out):
        if f.startswith('f') and f.endswith('.png'):
            os.remove(os.path.join(a.out, f))
    for i, (au, af) in enumerate(poses):
        cv2.imwrite(os.path.join(a.out, f'f{i:04d}.png'), np.clip(drawing(au, af), 0, 255).astype(np.uint8))
    holds = a.holds or ','.join(['2'] * len(poses))
    with open(os.path.join(a.out, 'holds.txt'), 'w') as f:
        f.write(holds)
    print(f'limb: upper arm {Lu:.0f} px, {int(m.sum())} px of drawing; {len(poses)} drawings in {a.out} (holds {holds})')


if __name__ == '__main__':
    main()
