"""
In-betweens for a move where the character handles a rigid prop (a hat tipped, a magnifier raised):
the body is interpolated, the prop is carried exactly.

  python tools/clips/prop_inbetween.py <out dir> --a A.png --b B.png --bare-a A_noprop.png --bare-b B_noprop.png
         [--times 0,.12,.4,.75,1] [--back .8,.45,.15,0] [--holds 6,2,2,2,8,2,2,2,6] [--fine 24] [--lock-below 0.6]

Why: an optical-flow interpolator (FILM) cannot invent what a moving prop uncovers (the ears under a lifted
hat): it melts the prop. So
1. the keys WITHOUT the prop (bare-a / bare-b, same drawings with the prop removed, e.g. by
   tools/comfy/edit.py) are interpolated by FILM: nothing is hidden there, the arm and hand move cleanly;
2. the prop is cut out of each key (where the key differs from its bare twin) and laid over every
   in-between as a rigid sprite: its pivot follows the hand (centroid of the white glove in that very
   in-between), its turn and scale go from key A to key B (polar decomposition of the A->B fit), and the
   drawing swaps from A's prop to B's halfway; the glove is laid back on top of the prop;
3. the first and last drawings are the keys themselves, untouched.
--times are the drawings of the move (0 = key A, 1 = key B; eased spacing = timing), --back the way
back, --holds the ticks of every drawing (written to holds.txt for build_clip.py --holds).
"""
import argparse, os, sys
import cv2, numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_clip import key, register, signal  # noqa: E402
from inbetween import film, on_green  # noqa: E402


def largest(m):
    n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    if n < 2:
        return m.astype(bool)
    return lab == 1 + int(np.argmax(st[1:, 4]))


def fill_holes(m):
    m = m.astype(np.uint8)
    ff = m.copy()
    cv2.floodFill(ff, np.zeros((m.shape[0] + 2, m.shape[1] + 2), np.uint8), (0, 0), 1)
    return (m | (1 - ff)).astype(bool)


def prop_cut(k, bare):
    """The prop: where the key is drawn and differs from its bare twin (colour or coverage). Dark details
    that match by chance (an ear tip under a dark brim) can split it: every sizeable piece is kept."""
    pk, pb = k[..., :3] * k[..., 3:] / 255, bare[..., :3] * bare[..., 3:] / 255
    d = np.maximum(np.abs(pk - pb).max(2), np.abs(k[..., 3] - bare[..., 3]))
    m = ((d > 60) & (k[..., 3] > 128)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    big = st[1:, 4].max() if n > 1 else 0
    m = np.isin(lab, [i for i in range(1, n) if st[i, 4] > 0.03 * big])
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    return fill_holes(m & (k[..., 3] > 128))


def prop_sprite(k, m, glove_mask):
    """The prop cut out of the key, continued under the hand that holds it (the glove is laid back on top,
    so a slightly different hand in an in-between never shows a gap)."""
    hull = np.zeros(m.shape, np.uint8)
    cv2.fillConvexPoly(hull, cv2.convexHull(np.argwhere(m)[:, ::-1].astype(np.int32)), 1)
    under = glove_mask & hull.astype(bool) & ~m
    soft = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.8)
    out = k.copy()
    out[..., 3] = 255 * np.clip(soft * 1.4 - 0.2, 0, 1) * (k[..., 3] / 255)
    # Bits of the character redrawn under the prop (orange fur of an ear: G/R ~0.55, unlike the gold
    # badge ~0.8) must not ride with it.
    b, g, r = k[..., 0], k[..., 1], k[..., 2]
    fur = cv2.dilate(((r > 170) & (b < 75) & (g < 0.66 * r)).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    out[fur & ~glove_mask, 3] = 0
    if under.any():
        rgb = cv2.inpaint(np.clip(k[..., :3], 0, 255).astype(np.uint8), (~m).astype(np.uint8) * 255 & cv2.dilate(under.astype(np.uint8), np.ones((9, 9), np.uint8)) * 255, 7, cv2.INPAINT_TELEA)
        out[under, :3] = rgb[under]
        out[under, 3] = 255
    return out


def solid(m):
    """A shape without pinholes (the grey folds of a glove are neither white nor ink)."""
    return fill_holes(cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)))


def axis(m):
    """Orientation (rad) and area of a shape, from its second moments."""
    mo = cv2.moments(m.astype(np.uint8), True)
    return 0.5 * np.arctan2(2 * mo['mu11'], mo['mu20'] - mo['mu02']), mo['m00']


def glove(f, near):
    """The white glove holding the prop (the biggest white shape within `near` of it: not the shirt or the
    other hand), with its ink outline: (layer mask, centroid)."""
    b = f[..., :3]
    white = ((b.min(2) > 165) & (b.max(2) - b.min(2) < 28) & (f[..., 3] > 200)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(white, 8)
    hits = [(st[i, 4], i) for i in range(1, n) if st[i, 4] > 150 and near[lab == i].any()]
    if not hits:
        return None, None
    main = max(hits)[1]
    # The finger lines cut a glove into several white pieces: all the pieces around the main one.
    reach = cv2.dilate((lab == main).astype(np.uint8), np.ones((31, 31), np.uint8)).astype(bool)
    white = np.isin(lab, [i for i in range(1, n) if st[i, 4] > 12 and reach[lab == i].any()])
    dark = b.max(2) < 110
    grow = cv2.dilate(white.astype(np.uint8), np.ones((13, 13), np.uint8)).astype(bool)
    ys, xs = np.nonzero(white)
    return white | (grow & dark), np.array([xs.mean(), ys.mean()])


def rot(t):
    return np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])


def over(top, bot):
    """Straight-alpha BGRA 'over'."""
    a, ab = top[..., 3:] / 255, bot[..., 3:] / 255
    oa = a + ab * (1 - a)
    rgb = (top[..., :3] * a + bot[..., :3] * ab * (1 - a)) / np.maximum(oa, 1e-4)
    return np.dstack([rgb, oa * 255])


def warp_sprite(s, A, W, H):
    pre = s.copy()
    pre[..., :3] *= pre[..., 3:] / 255
    w = cv2.warpAffine(pre, A.astype(np.float32), (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    w = np.clip(w, 0, 255)
    w[..., :3] /= np.maximum(w[..., 3:] / 255, 1e-4)
    return np.clip(w, 0, 255)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out')
    ap.add_argument('--a', required=True)
    ap.add_argument('--b', required=True)
    ap.add_argument('--bare-a', required=True)
    ap.add_argument('--bare-b', required=True)
    ap.add_argument('--times', default='0,.12,.4,.75,1')
    ap.add_argument('--back', default='')
    ap.add_argument('--holds', default='')
    ap.add_argument('--fine', type=int, default=16, help='FILM drawings between the bare keys (the spacing grid; ComfyUI allows up to 16)')
    ap.add_argument('--debug', action='store_true', help='also write prop_masks.png')
    ap.add_argument('--lock-below', type=float, default=0.72, help='fraction of the height below which every drawing is key A (legs)')
    a = ap.parse_args()

    imgs = [cv2.imread(p) for p in (a.a, a.b, a.bare_a, a.bare_b)]
    H, W = imgs[0].shape[:2]
    ks = [key(cv2.resize(im, (W, H), interpolation=cv2.INTER_CUBIC) if im.shape[:2] != (H, W) else im) for im in imgs]
    al = ks[0][..., 3] > 128
    ys, xs = np.nonzero(al)
    y1 = ys.max() + 1
    y0 = int(y1 - (y1 - ys.min()) * 0.12)
    cols = np.nonzero(al[y0:y1].any(0))[0]
    feet = (int(cols.min()) - 6, y0 - 6, int(cols.max()) + 7, y1 + 6)
    ks, warps = register(ks, feet, 'euclidean')
    for n, w in zip(('B', 'bare A', 'bare B'), warps[1:]):
        print(f'{n}: registered ({w[0, 2]:+.2f}, {w[1, 2]:+.2f}) px')
    kA, kB, bA, bB = ks
    # Each bare twin on its own key (a redrawn key may sit a few px off): otherwise every outline of the
    # body would differ and leak into the prop.
    whole = (0, 0, W, H)
    bA = register([kA, bA], whole, 'translation')[0][1]
    bB = register([kB, bB], whole, 'translation')[0][1]
    # Legs locked to key A in every drawing (they must not boil while only the arm moves).
    cut = a.lock_below * H
    m = np.clip((np.arange(H, dtype=np.float32)[:, None, None] - cut) / 24 + 0.5, 0, 1)
    bA, bB, kB = (x * (1 - m) + kA * m for x in (bA, bB, kB))

    os.makedirs(a.out, exist_ok=True)
    mA = prop_cut(kA, bA)
    mB = prop_cut(kB, bB)
    near = cv2.dilate((mA | mB).astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)
    if a.debug:
        cv2.imwrite(os.path.join(a.out, 'prop_masks.png'), np.dstack([mA * 255, mB * 255, near * 120]).astype(np.uint8))
    gA, cA = glove(kA, near)
    gB, cB = glove(kB, near)
    if cA is None or cB is None:
        sys.exit('no glove found next to the prop in a key')
    # The hand that holds the prop rides with it, as drawn in the key: two different hands would only
    # be cross-faded by FILM (a ghost glove).
    pA, pB = prop_sprite(kA, solid(mA | gA), gA), prop_sprite(kB, solid(mB | gB), gB)
    # The prop's own A -> B turn and scale: its long axis (a brim, a handle) and its area.
    (tA, aA), (tB, aB) = axis(mA), axis(mB)
    theta = float((tB - tA + np.pi / 2) % np.pi - np.pi / 2)
    sc = float(np.sqrt(aB / aA))
    print(f'prop A->B: turn {np.degrees(theta):+.1f} deg, scale {sc:.3f}, glove travel ({cB[0] - cA[0]:+.1f}, {cB[1] - cA[1]:+.1f}) px')

    def lin(s):
        return rot(theta * s) * sc ** s

    fine = [key(f) for f in film(on_green(bA), on_green(bB), a.fine + 1)]
    fine = [cv2.resize(f, (W, H)) if f.shape[:2] != (H, W) else f for f in fine]
    fine[0], fine[-1] = bA, bB
    # What does not move is key A's own drawing in every drawing (a redrawn torso would boil): only the
    # moving part (where the bare keys differ, and the prop with its hand) comes from the in-betweens.
    pa, pb = bA[..., :3] * bA[..., 3:] / 255, bB[..., :3] * bB[..., 3:] / 255
    d = (np.maximum(np.abs(pa - pb).max(2), np.abs(bA[..., 3] - bB[..., 3])) > 50).astype(np.uint8)
    d = cv2.morphologyEx(d, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) | (mA | mB | gA | gB).astype(np.uint8)
    mv = solid(cv2.dilate(d, np.ones((41, 41), np.uint8)))
    mv = cv2.GaussianBlur(mv.astype(np.float32), (0, 0), 8)[..., None]
    fine = [f * mv + kA * (1 - mv) for f in fine]
    kB = kB * mv + kA * (1 - mv)
    if a.debug:
        cv2.imwrite(os.path.join(a.out, 'moving.png'), (mv[..., 0] * 255).astype(np.uint8))

    def drawing(s):
        if s <= 0:
            return kA
        if s >= 1:
            return kB
        i = int(round(s * a.fine))
        s = i / a.fine
        base = fine[i]
        gm, c = glove(base, near)
        if c is None:
            sys.exit(f'no glove in the in-between at {s:.2f}')
        # The prop rides on the hand; its drawing swaps from A's to B's halfway, where it moves fastest.
        if s < 0.5:
            L, spr, piv = lin(s), pA, cA
        else:
            L, spr, piv = lin(s) @ np.linalg.inv(lin(1)), pB, cB
        base = base.copy()
        # Remove the in-between's own (cross-faded) glove, light parts only: the sleeve stays.
        ghost = solid(gm) & (base[..., :3].min(2) > 140)
        bb = base[..., :3]
        sleeve = (base[..., 3] > 200) & (bb.max(2) > 50) & (bb.min(2) < 120) & (bb[..., 2] < 170)
        ghost &= ~cv2.dilate(sleeve.astype(np.uint8), np.ones((11, 11), np.uint8)).astype(bool)
        base[..., 3] *= 1 - cv2.GaussianBlur(cv2.dilate(ghost.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32), (0, 0), 1.0)
        return over(warp_sprite(spr, np.hstack([L, (c - L @ piv)[:, None]]), W, H), base)

    times = [float(v) for v in a.times.split(',')] + ([float(v) for v in a.back.split(',')] if a.back else [])
    os.makedirs(a.out, exist_ok=True)
    for f in os.listdir(a.out):
        if f.startswith('f') and f.endswith('.png'):
            os.remove(os.path.join(a.out, f))
    for i, s in enumerate(times):
        cv2.imwrite(os.path.join(a.out, f'f{i:04d}.png'), np.clip(drawing(s), 0, 255).astype(np.uint8))
    holds = a.holds or ','.join(['2'] * len(times))
    with open(os.path.join(a.out, 'holds.txt'), 'w') as f:
        f.write(holds)
    print(f'{len(times)} drawings in {a.out} (holds {holds})')


if __name__ == '__main__':
    main()
