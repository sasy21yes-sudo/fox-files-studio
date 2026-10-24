"""
Build a frame-by-frame animation clip (Cuphead-style full drawings) for the studio's "sprite" element.

  python tools/clips/build_clip.py <frames folder | sheet image> --id tiphat --label "Tips his hat"
         [--grid 4x3] [--fps 24] [--hold 2] [--holds 1,1,2,...] [--loop once|loop|pingpong]
         [--lock feet|none|x0,y0,x1,y1] [--motion translation|euclidean|affine]
         [--height-u 600] [--max-error 0.35] [--out public/clips]

1. Frames: every image of the folder in name order, or the cells of a grid sheet (--grid CxR).
   Green screen is keyed (and de-spilled) like the rig pieces; PNGs with alpha are used as they are.
2. Registration, like the peg holes of an animation desk: each frame is aligned to the first one on a
   LOCKED region that must not move (default "feet": the bottom 12% of the first drawing's silhouette),
   with a sub-pixel ECC fit (translation, or + rotation, or + scale). The drawing's own motion outside
   that region is kept. --lock none skips it (the frames are already registered).
3. Check: after alignment, a fresh sub-pixel fit between each frame's locked region and frame 0's must
   find (almost) no shift left: the worst residual must stay under --max-error px, or the build stops.
4. Output (<out>/<id>/): atlas.webp (frames trimmed and packed), clip.json (rects, offsets in a common
   canvas, holds, anchor = bottom centre of frame 0's locked region), and <out>/index.json updated.
   QA sheets in qa-out/clips/<id>/: contact.png (every drawing with its number and error) and onion.png
   (all drawings over each other, frame 0 in red: anything that should stand still shows as one line).
"""
import argparse, json, os, sys
import cv2, numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def key(bgr):
    """Green screen -> BGRA (same keying as tools/bake_rig.py), de-spilled."""
    f = bgr.astype(np.float32)
    dom = f[..., 1] - np.maximum(f[..., 0], f[..., 2])
    a = np.clip((150 - dom) / 90.0, 0, 1)
    f[..., 1] = np.minimum(f[..., 1], np.maximum(f[..., 0], f[..., 2]))
    return np.dstack([f, a * 255]).astype(np.float32)


def load_frames(src, grid):
    if os.path.isdir(src):
        names = sorted(n for n in os.listdir(src) if n.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')))
        imgs = [cv2.imread(os.path.join(src, n), cv2.IMREAD_UNCHANGED) for n in names]
    else:
        sheet = cv2.imread(src, cv2.IMREAD_UNCHANGED)
        cols, rows = (int(v) for v in grid.lower().split('x'))
        h, w = sheet.shape[0] // rows, sheet.shape[1] // cols
        imgs = [sheet[r * h:(r + 1) * h, c * w:(c + 1) * w] for r in range(rows) for c in range(cols)]
    out = []
    for im in imgs:
        if im is None:
            continue
        if im.ndim == 3 and im.shape[2] == 4:
            out.append(im.astype(np.float32))
        else:
            out.append(key(im[..., :3] if im.ndim == 3 else cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)))
    # One canvas size for all (padded centred), so coordinates are comparable.
    H = max(f.shape[0] for f in out)
    W = max(f.shape[1] for f in out)
    pad = []
    for f in out:
        c = np.zeros((H, W, 4), np.float32)
        y, x = (H - f.shape[0]) // 2, (W - f.shape[1]) // 2
        c[y:y + f.shape[0], x:x + f.shape[1]] = f
        pad.append(c)
    return pad


def lock_box(f0, lock):
    a = f0[..., 3] > 128
    ys, xs = np.nonzero(a)
    if lock == 'feet':
        y1 = ys.max() + 1
        y0 = int(y1 - (y1 - ys.min()) * 0.12)
        cols = np.nonzero(a[y0:y1].any(0))[0]
        return int(cols.min()) - 6, y0 - 6, int(cols.max()) + 7, y1 + 6
    x0, y0, x1, y1 = (int(v) for v in lock.split(','))
    return x0, y0, x1, y1


def signal(f):
    """What registration looks at: the drawing's ink and silhouette (grey on alpha), smoothed a little."""
    grey = cv2.cvtColor(f[..., :3].astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    a = f[..., 3] / 255
    return cv2.GaussianBlur((1 - grey) * a + a * 0.5, (0, 0), 1.0)


def register(frames, box, motion):
    mode = {'translation': cv2.MOTION_TRANSLATION, 'euclidean': cv2.MOTION_EUCLIDEAN, 'affine': cv2.MOTION_AFFINE}[motion]
    x0, y0, x1, y1 = box
    H, W = frames[0].shape[:2]
    mask = np.zeros((H, W), np.uint8)
    mask[max(0, y0):y1, max(0, x0):x1] = 255
    ref = signal(frames[0])
    out = [frames[0]]
    warps = [np.eye(2, 3, dtype=np.float32)]
    for f in frames[1:]:
        warp = np.eye(2, 3, dtype=np.float32)
        try:
            _, warp = cv2.findTransformECC(ref, signal(f), warp, mode, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 500, 1e-7), mask, 5)
        except cv2.error:
            print('  ECC did not converge on a frame: left unaligned (check it in onion.png)')
        # warp maps reference coords -> this frame: sample the frame with it (Lanczos, premultiplied).
        pre = f.copy()
        pre[..., :3] *= pre[..., 3:] / 255
        al = cv2.warpAffine(pre, warp, (W, H), flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        al = np.clip(al, 0, 255)
        al[..., :3] /= np.maximum(al[..., 3:] / 255, 1e-4)
        out.append(np.clip(al, 0, 255))
        warps.append(warp)
    return out, warps


def residual(a, b, box):
    """How far frame b still is from frame a in the locked region after registration (px): a fresh
    sub-pixel ECC fit between the two; also the 98th percentile of the mismatch there (ink difference)."""
    x0, y0, x1, y1 = box
    H, W = a.shape[:2]
    mask = np.zeros((H, W), np.uint8)
    mask[max(0, y0):y1, max(0, x0):x1] = 255
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv2.findTransformECC(signal(a), signal(b), warp, cv2.MOTION_TRANSLATION, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-7), mask, 5)
    except cv2.error:
        return float('inf')
    return float(np.hypot(warp[0, 2], warp[1, 2]))


def pack(frames):
    """Trim every frame to its drawing and shelf-pack them; returns atlas BGRA and rects."""
    trims = []
    for f in frames:
        ys, xs = np.nonzero(f[..., 3] > 1)
        if not len(xs):
            trims.append((f[:1, :1] * 0, 0, 0))
            continue
        x0, y0 = max(0, xs.min() - 2), max(0, ys.min() - 2)
        x1, y1 = min(f.shape[1], xs.max() + 3), min(f.shape[0], ys.max() + 3)
        trims.append((f[y0:y1, x0:x1], x0, y0))
    maxw = max(t[0].shape[1] for t in trims)
    side = max(maxw, int(np.ceil(np.sqrt(sum(t[0].shape[0] * t[0].shape[1] for t in trims)) * 1.15)))
    side = min(side, 8192)
    x = y = shelf = 0
    rects = []
    for t, ox, oy in trims:
        h, w = t.shape[:2]
        if x + w > side:
            x, y, shelf = 0, y + shelf + 2, 0
        rects.append((x, y, w, h, ox, oy))
        x += w + 2
        shelf = max(shelf, h)
    atlas = np.zeros((y + shelf + 2, side, 4), np.float32)
    for (t, _, _), (ax, ay, w, h, _, _) in zip(trims, rects):
        atlas[ay:ay + h, ax:ax + w] = t
    return atlas, rects


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src')
    ap.add_argument('--id', required=True)
    ap.add_argument('--label', default=None)
    ap.add_argument('--grid', default='1x1')
    ap.add_argument('--fps', type=int, default=24)
    ap.add_argument('--hold', type=int, default=2, help='ticks each drawing stays (2 = on twos)')
    ap.add_argument('--holds', default='', help='per-drawing holds, comma separated (overrides --hold)')
    ap.add_argument('--loop', default='once', choices=['once', 'loop', 'pingpong'])
    ap.add_argument('--lock', default='feet')
    ap.add_argument('--motion', default='translation', choices=['translation', 'euclidean', 'affine'])
    ap.add_argument('--height-u', type=float, default=600, help='on-screen height (u) of the first drawing at scale 1 (Agent Fox: 600)')
    ap.add_argument('--max-error', type=float, default=0.25, help='worst registration residual allowed in the locked region (px)')
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'clips'))
    a = ap.parse_args()

    frames = load_frames(a.src, a.grid)
    if len(frames) < 2:
        sys.exit('need at least 2 drawings')
    print(f'{len(frames)} drawings, {frames[0].shape[1]}x{frames[0].shape[0]} px')
    errs = []
    if a.lock != 'none':
        box = lock_box(frames[0], a.lock)
        frames, warps = register(frames, box, a.motion)
        for f in frames:
            r = residual(frames[0], f, box)
            errs.append((r, r))
        worst = max(e[1] for e in errs)
        print(f'registration on {a.lock} ({a.motion}): residual mean {np.mean([e[0] for e in errs]):.3f} px, worst {worst:.3f} px')
        for i, w in enumerate(warps[1:], 1):
            print(f'  frame {i}: shift ({w[0, 2]:+.2f}, {w[1, 2]:+.2f}) px, error {errs[i][1]:.3f}')
        if worst > a.max_error:
            sys.exit(f'REJECTED: a drawing is still {worst:.2f} px off in the locked region (max {a.max_error}). Check qa-out onion/contact, or try --motion euclidean/affine or another --lock.')
    else:
        box = lock_box(frames[0], 'feet')
        errs = [(0.0, 0.0)] * len(frames)

    # Common canvas: the union of every drawing, plus a margin; the anchor is frame 0's locked bottom centre.
    alpha = np.max([f[..., 3] for f in frames], axis=0) > 1
    ys, xs = np.nonzero(alpha)
    cx0, cy0 = max(0, xs.min() - 4), max(0, ys.min() - 4)
    cx1, cy1 = min(alpha.shape[1], xs.max() + 5), min(alpha.shape[0], ys.max() + 5)
    frames = [f[cy0:cy1, cx0:cx1] for f in frames]
    a0 = frames[0][..., 3] > 128
    fy, fx = np.nonzero(a0)
    bx0, by0, bx1, by1 = box
    anchor = [round((max(bx0, cx0) + min(bx1, cx1)) / 2 - cx0, 2), round(float(fy.max() + 1), 2)]
    first_h = float(fy.max() - fy.min() + 1)

    atlas, rects = pack(frames)
    holds = [int(v) for v in a.holds.split(',')] if a.holds else [a.hold] * len(frames)
    holds = (holds + [holds[-1]] * len(frames))[: len(frames)]
    out_dir = os.path.join(a.out, a.id)
    os.makedirs(out_dir, exist_ok=True)
    cv2.imwrite(os.path.join(out_dir, 'atlas.webp'), np.clip(atlas, 0, 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 101])
    clip = {
        'version': 1, 'id': a.id, 'label': a.label or a.id, 'fps': a.fps,
        'width': int(cx1 - cx0), 'height': int(cy1 - cy0), 'anchor': anchor,
        'pxPerU': round(first_h / a.height_u, 5), 'loop': a.loop, 'atlas': 'atlas.webp',
        'frames': [{'x': x, 'y': y, 'w': w, 'h': h, 'ox': int(ox), 'oy': int(oy), 'hold': hd} for (x, y, w, h, ox, oy), hd in zip(rects, holds)],
        'report': {'maxError': round(max(e[1] for e in errs), 4), 'meanError': round(float(np.mean([e[0] for e in errs])), 4),
                   'source': os.path.relpath(a.src, ROOT).replace('\\', '/') if os.path.isabs(a.src) else a.src},
    }
    json.dump(clip, open(os.path.join(out_dir, 'clip.json'), 'w'), indent=1)

    # Library index.
    idx_path = os.path.join(a.out, 'index.json')
    idx = json.load(open(idx_path)) if os.path.exists(idx_path) else []
    idx = [c for c in idx if c['id'] != a.id] + [{'id': a.id, 'label': clip['label'], 'frames': len(frames), 'fps': a.fps, 'duration': round(sum(holds) / a.fps, 4)}]
    json.dump(sorted(idx, key=lambda c: c['id']), open(idx_path, 'w'), indent=1)

    # QA sheets.
    qa = os.path.join(ROOT, 'qa-out', 'clips', a.id)
    os.makedirs(qa, exist_ok=True)
    bg = np.full(frames[0].shape[:2] + (3,), (110, 125, 140), np.float32)
    tiles = []
    for i, f in enumerate(frames):
        al = f[..., 3:] / 255
        t = (f[..., :3] * al + bg * (1 - al)).astype(np.uint8)
        cv2.rectangle(t, (int(bx0 - cx0), int(by0 - cy0)), (int(bx1 - cx0), int(by1 - cy0)), (0, 200, 255), 1)
        cv2.putText(t, f'{i}  err {errs[i][1]:.2f}px  hold {holds[i]}', (6, 22), 0, 0.6, (0, 0, 0), 3)
        cv2.putText(t, f'{i}  err {errs[i][1]:.2f}px  hold {holds[i]}', (6, 22), 0, 0.6, (255, 255, 255), 1)
        tiles.append(t)
    cols = min(6, len(tiles))
    while len(tiles) % cols:
        tiles.append(np.zeros_like(tiles[0]))
    contact = np.vstack([np.hstack(tiles[r:r + cols]) for r in range(0, len(tiles), cols)])
    cv2.imwrite(os.path.join(qa, 'contact.png'), contact)
    onion = np.full(frames[0].shape[:2] + (3,), 255, np.float32)
    for i, f in enumerate(frames):
        ink = (f[..., 3] / 255) * (1 - cv2.cvtColor(f[..., :3].astype(np.uint8), cv2.COLOR_BGR2GRAY) / 255 * 0.6)
        col = np.array([40, 40, 220] if i == 0 else [120, 110, 100], np.float32)
        k = (ink * (0.9 if i == 0 else 0.25))[..., None]
        onion = onion * (1 - k) + col * k
    cv2.imwrite(os.path.join(qa, 'onion.png'), onion.astype(np.uint8))
    print(f'wrote {out_dir} ({len(frames)} drawings, {sum(holds) / a.fps:.2f} s) and qa-out/clips/{a.id}/contact.png, onion.png')


if __name__ == '__main__':
    main()
