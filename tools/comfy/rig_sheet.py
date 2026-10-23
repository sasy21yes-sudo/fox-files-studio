"""
Rebuild a rig part sheet with restyled pieces, keeping the original layout.

For every piece k of art/parts/<name>.jpg that has an approved render under
`rig_<name>/p<k>` in art/incoming/manifest.json, the original piece is
removed and the render is put back on the same padded canvas edit.py cut it
from (25% green margin around the piece's box), so place, size and angle stay
what tools/bake_rig.py measured. Pieces without an approved render are kept.

Usage: python tools/comfy/rig_sheet.py <name> [--use p1=v2 ...] [--out art/parts_v4]
Output: <out>/<name>.jpg and <out>/compare_<name>.jpg (before | after)
"""
import argparse, json, os
import cv2, numpy as np
from edit import ROOT, pieces_of

MANIFEST = os.path.join(ROOT, 'art', 'incoming', 'manifest.json')


def soft_alpha(bgr):
    f = bgr.astype(np.float32)
    dom = f[..., 1] - np.maximum(f[..., 0], f[..., 2])
    return np.clip((150 - dom) / 90.0, 0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('name')
    ap.add_argument('--use', action='append', default=[], help='pK=vN: use this version even if not approved')
    ap.add_argument('--out', default=os.path.join(ROOT, 'art', 'parts_v4'))
    ap.add_argument('--fit', action='append', default=[],
                    help='pK=factor[:right|left|center]: scale the render so the drawing fits the original box times factor, '
                         'anchored on that side (where the part attaches)')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    src_path = os.path.join(a.out, a.name + '.jpg')
    base = cv2.imread(os.path.join(ROOT, 'art', 'parts', a.name + '.jpg'))
    # Restyle on top of earlier restyles of the same sheet (pieces are replaced one by one).
    sheet = cv2.imread(src_path) if os.path.exists(src_path) else base.copy()
    man = json.load(open(MANIFEST, encoding='utf8'))['sheets']
    use = dict(u.split('=') for u in a.use)
    fit = {}
    for f in a.fit:
        k_, spec = f.split('=')
        fac, _, side = spec.partition(':')
        fit[k_] = (float(fac), side or 'center')
    bg = np.median(base[(soft_alpha(base) < 0.02)], axis=0)

    done = []
    for k, (x, y, w, h) in enumerate(pieces_of(base)):
        key = f'rig_{a.name}/p{k}'
        vs = man.get(key, {}).get('versions', [])
        pick = [v for v in vs if v['version'] == use.get(f'p{k}')] or [v for v in vs if v['status'] in ('approved', 'final')]
        if not pick:
            continue
        v = pick[-1]
        pad = int(0.25 * max(w, h))
        cx0, cy0, cw, ch = x - pad, y - pad, w + 2 * pad, h + 2 * pad
        new = cv2.resize(cv2.imread(os.path.join(ROOT, v['file'])), (cw, ch), interpolation=cv2.INTER_AREA)
        # Keep only the drawing: glare blobs and specks detached from the main piece go back to green.
        al_new = soft_alpha(new)
        n_, lab_, st_, _ = cv2.connectedComponentsWithStats((al_new > 0.5).astype(np.uint8), 8)
        if n_ > 1:
            main_ = 1 + int(np.argmax(st_[1:, 4]))
            keep = cv2.dilate((lab_ == main_).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
            new[~keep] = (0, 255, 0)
        if f'p{k}' in fit:
            # Rescale the drawing into the original piece's box (times factor), anchored on one side.
            fac, side = fit[f'p{k}']
            ys_, xs_ = np.nonzero(soft_alpha(new) > 0.5)
            bx0, by0, bx1, by1 = xs_.min(), ys_.min(), xs_.max() + 1, ys_.max() + 1
            sc = min(w * fac / (bx1 - bx0), h * fac / (by1 - by0))
            draw = cv2.resize(new[by0:by1, bx0:bx1], (max(1, round((bx1 - bx0) * sc)), max(1, round((by1 - by0) * sc))), interpolation=cv2.INTER_AREA)
            dh, dw = draw.shape[:2]
            canvas = np.empty_like(new)
            canvas[:] = (0, 255, 0)
            ox = pad + (w - dw if side == 'right' else 0 if side == 'left' else (w - dw) // 2)
            oy = pad + (h - dh) // 2
            ox, oy = min(max(ox, 0), cw - dw), min(max(oy, 0), ch - dh)
            canvas[oy:oy + dh, ox:ox + dw] = draw
            new = canvas
        # Remove the original piece (its own pixels inside its box), then lay the render on the same canvas.
        old = (soft_alpha(base[y:y + h, x:x + w]) > 0.02).astype(np.uint8)
        old = cv2.dilate(old, np.ones((7, 7), np.uint8))
        sheet[y:y + h, x:x + w][old > 0] = bg
        X0, Y0 = max(cx0, 0), max(cy0, 0)
        X1, Y1 = min(cx0 + cw, sheet.shape[1]), min(cy0 + ch, sheet.shape[0])
        part = new[Y0 - cy0:Y1 - cy0, X0 - cx0:X1 - cx0].astype(np.float32)
        al = soft_alpha(part)[..., None]
        part[..., 1] = np.minimum(part[..., 1], np.maximum(part[..., 0], part[..., 2]))  # de-spill
        region = sheet[Y0:Y1, X0:X1].astype(np.float32)
        sheet[Y0:Y1, X0:X1] = (part * al + region * (1 - al)).astype(np.uint8)
        done.append(f'p{k}={v["version"]}')

    cv2.imwrite(src_path, sheet, [cv2.IMWRITE_JPEG_QUALITY, 96])
    cmp_ = np.hstack([base, np.full((base.shape[0], 12, 3), 235, np.uint8), sheet])
    cv2.imwrite(os.path.join(a.out, f'compare_{a.name}.jpg'), cmp_, [cv2.IMWRITE_JPEG_QUALITY, 88])
    print(os.path.relpath(src_path, ROOT), 'restyled:', ', '.join(done) or 'nothing approved yet')


if __name__ == '__main__':
    main()
