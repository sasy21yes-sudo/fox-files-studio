"""
Assemble the approved pieces of a sheet (art/incoming/pieces/<sheet>/) into
art/incoming/<sheet>_vN.png, in the order and grid of art/GEMINI_PROMPTS.md.

Every piece is re-keyed from its own render (soft key + de-spill, as in
tools/bake_rig.py) and laid on flat #00FF00, so the green is uniform and no
piece touches another or the border by construction. One scale factor per
sheet keeps the pieces' relative sizes; it is chosen so the median piece has
the same size, relative to the sheet width, as on the reference sheet.

Usage: python tools/comfy/compose.py <sheet> [--width 2048] [--allow-missing]
"""
import argparse, json, os, time
import cv2, numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, 'art', 'incoming', 'manifest.json')

HANDS = ['one', 'two', 'three', 'pinch_paper', 'pencil', 'magnifier', 'stop', 'chin', 'fist_tremble', 'relaxed', 'snap', 'knock']
SHEETS = {
    # pieces in reading order, columns, median piece size / sheet width (from the reference sheets, see check.py)
    'heads_turnaround': (['hat_front', 'hat_34', 'hat_side', 'bare_front', 'bare_34', 'bare_side'], 3, 0.24),
    'hands_new_back': (HANDS, 4, 0.19),
    'hands_new_front': (HANDS, 4, 0.19),
    'mouths_emotions': (['scream', 'gasp', 'whisper', 'smirk', 'gritted', 'laugh', 'frown', 'disgust', 'nervous', 'grin', 'blow', 'jawdrop'], 4, 0.21),
    'poses_key': (['take', 'crouch', 'run', 'point', 'magnifier', 'slumped', 'triumph', 'tiphat'], 4, 0.2),
}
GREEN = np.array([0, 255, 0], np.float32)  # BGR


def cutout(path):
    """Piece from a render: BGR (de-spilled) + alpha, cropped to its drawing."""
    bgr = cv2.imread(os.path.join(ROOT, path)).astype(np.float32)
    # edit.py scales every source crop to ~1 MP before editing; bring copied originals
    # (still at their sheet resolution) to the same scale so relative sizes hold.
    f = (1e6 / (bgr.shape[0] * bgr.shape[1])) ** 0.5
    if abs(f - 1) > 0.1:
        bgr = cv2.resize(bgr, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC if f > 1 else cv2.INTER_AREA)
    dom = bgr[..., 1] - np.maximum(bgr[..., 0], bgr[..., 2])
    alpha = np.clip((150 - dom) / 90.0, 0, 1)
    bgr[..., 1] = np.minimum(bgr[..., 1], np.maximum(bgr[..., 0], bgr[..., 2]))
    fg = cv2.morphologyEx((alpha > 0.5).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n < 2:
        raise SystemExit(f'{path}: nothing drawn')
    biggest = st[1:, 4].max()
    keep = [i for i in range(1, n) if st[i][4] >= 0.02 * biggest]   # the drawing plus props it holds; drop specks
    mask = np.isin(lab, keep)
    alpha = alpha * (cv2.dilate(mask.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
    ys, xs = np.nonzero(alpha > 0.02)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return bgr[y0:y1, x0:x1], alpha[y0:y1, x0:x1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet')
    ap.add_argument('--width', type=int, default=2048)
    ap.add_argument('--allow-missing', action='store_true', help='leave empty cells for pieces not approved yet')
    a = ap.parse_args()
    names, cols, rel = SHEETS[a.sheet]
    man = json.load(open(MANIFEST, encoding='utf8'))

    chosen = {}
    for n in names:
        vs = man['sheets'].get(f'{a.sheet}/{n}', {}).get('versions', [])
        ok = [v for v in vs if v['status'] in ('approved', 'final')]
        if ok:
            chosen[n] = ok[-1]
        elif not a.allow_missing:
            raise SystemExit(f'{a.sheet}/{n}: no approved version')

    cuts = {n: cutout(v['file']) for n, v in chosen.items()}
    W = a.width
    H = W * 9 // 16
    rows = -(-len(names) // cols)
    cell_w, cell_h = W / cols, H / rows
    sizes = [max(c[0].shape[:2]) for c in cuts.values()]
    k = rel * W / float(np.median(sizes))
    # never let a piece leave its cell (keeps >= 10% of the cell as green margin)
    k = min([k] + [min(0.8 * cell_w / c[0].shape[1], 0.8 * cell_h / c[0].shape[0]) for c in cuts.values()])

    canvas = np.empty((H, W, 3), np.float32)
    canvas[:] = GREEN
    for i, n in enumerate(names):
        if n not in cuts:
            continue
        bgr, alpha = cuts[n]
        w, h = max(1, round(bgr.shape[1] * k)), max(1, round(bgr.shape[0] * k))
        bgr = cv2.resize(bgr, (w, h), interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
        alpha = np.clip(cv2.resize(alpha, (w, h), interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC), 0, 1)[..., None]
        cx, cy = (i % cols + 0.5) * cell_w, (i // cols + 0.5) * cell_h
        x, y = int(cx - w / 2), int(cy - h / 2)
        region = canvas[y:y + h, x:x + w]
        canvas[y:y + h, x:x + w] = bgr * alpha + region * (1 - alpha)

    entry = man['sheets'].setdefault(a.sheet, {'versions': []})
    version = 'v%d' % (max([int(v['version'][1:]) for v in entry['versions']] or [0]) + 1)
    out = os.path.join(ROOT, 'art', 'incoming', f'{a.sheet}_{version}.png')
    cv2.imwrite(out, np.clip(canvas, 0, 255).astype(np.uint8))
    entry['versions'].append({
        'version': version, 'file': os.path.relpath(out, ROOT).replace('\\', '/'), 'status': 'draft',
        'model': 'composed from local Qwen-Image-Edit-2511 pieces', 'size': f'{W}x{H}',
        'pieces': {n: v['file'] for n, v in chosen.items()}, 'missing': [n for n in names if n not in chosen],
        'scale': round(k, 4), 'created': time.strftime('%Y-%m-%dT%H:%M:%S'),
    })
    with open(MANIFEST, 'w', encoding='utf8') as f:
        json.dump(man, f, indent=2)
        f.write('\n')
    print(os.path.relpath(out, ROOT), f'{W}x{H}', 'scale', round(k, 3), 'missing:', entry['versions'][-1]['missing'])


if __name__ == '__main__':
    main()
