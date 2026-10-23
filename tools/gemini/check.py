"""
Automatic checks for generated Agent Fox sheets (art/incoming/*.png).

For each sheet it measures:
  - green screen: how close the background is to #00FF00, how uniform it is
    across the frame (gradients), and dark-green cast shadows;
  - spill: green tint on the inner edge of every piece (halos);
  - pieces: connected components vs the count the sheet should have, small
    isolated marks (often stray text or numbers), pieces touching the border,
    pieces too close to each other or merged together;
  - scale: piece height relative to the sheet width, compared with the same
    measure on the reference sheet, and size consistency inside the sheet.

The result is printed and, when the image is listed in art/incoming/manifest.json,
stored on that version as "check".

Usage:
  python tools/gemini/check.py art/incoming/hands_new_back_v1.png [...]
  python tools/gemini/check.py --sheet hands_new_back art/parts/hands.jpg   # calibrate on a reference
"""
import argparse, json, os, re, sys
import numpy as np, cv2

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, 'art', 'incoming', 'manifest.json')

# expected piece count, reference sheet, how many of the reference's largest pieces to measure
SHEETS = {
    'heads_turnaround': dict(expect=6, ref='art/parts/head.jpg', ref_top=2),
    'hats_turnaround': dict(expect=6, ref=None),
    'hands_new_back': dict(expect=12, ref='art/parts/hands.jpg', ref_top=8),
    'hands_new_front': dict(expect=12, ref='art/parts/hands.jpg', ref_top=8),
    'mouths_emotions': dict(expect=12, ref='art/parts/mouths.jpg', ref_top=12),
    'brows_lids': dict(expect=None, ref='art/parts/brows.jpg', ref_top=None),
    'poses_key': dict(expect=8, ref='art/parts/fullbody.jpg', ref_top=1),
    'anim_take': dict(expect=8, ref='art/parts/fullbody.jpg', ref_top=1),
    'anim_run': dict(expect=8, ref='art/parts/fullbody.jpg', ref_top=1),
    'anim_think': dict(expect=6, ref='art/parts/fullbody.jpg', ref_top=1),
    'props': dict(expect=15, ref=None),
    'fx': dict(expect=None, ref=None),
}

GREEN = np.array([0, 255, 0], np.float32)  # RGB


def sheet_id(path):
    m = re.match(r'(.+?)_v\d+$', os.path.splitext(os.path.basename(path))[0])
    return m.group(1) if m else os.path.splitext(os.path.basename(path))[0]


def load_rgb(path):
    bgr = cv2.imread(path, cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f'cannot read {path}')
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)


def masks(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dom = g - np.maximum(r, b)              # same key as tools/bake_rig.py
    fg = dom < 60
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) > 0
    return dom, fg


def pieces(fg, w, h):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fg.astype(np.uint8), 8)
    min_area = 0.0015 * w * h
    big, small = [], []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        (big if area >= min_area else small).append(dict(id=i, x=int(x), y=int(y), w=int(bw), h=int(bh), area=int(area)))
    return lab, big, [s for s in small if s['area'] >= 0.00003 * w * h]


def piece_heights(path, top):
    rgb = load_rgb(path)
    h, w = rgb.shape[:2]
    _, fg = masks(rgb)
    _, big, _ = pieces(fg, w, h)
    big.sort(key=lambda p: -p['area'])
    big = big[:top] if top else big
    return [max(p['h'], p['w']) / w for p in big]


def analyse(path, sid, expect=None):
    rgb = load_rgb(path)
    h, w = rgb.shape[:2]
    cfg = SHEETS.get(sid, {})
    expect = expect if expect is not None else cfg.get('expect')
    dom, fg = masks(rgb)
    out = dict(file=os.path.relpath(path, ROOT).replace('\\', '/'), sheet=sid, size=[w, h], issues=[])
    issue = out['issues'].append

    if sid.startswith('bg_') and sid.endswith('_back'):
        green = float((dom > 60).mean() * 100)
        out['green_pct'] = round(green, 2)
        if green > 0.5:
            issue(f'back layer has {green:.1f}% green pixels (must be fully painted)')
        return out

    # --- background: pixels clearly away from any piece
    near = cv2.dilate(fg.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
    bg = (~near) & (dom > 60)
    bgpx = rgb[bg]
    if len(bgpx) < 100:
        issue('no usable green background found')
        return out
    mean = bgpx.mean(0)
    dev = np.abs(bgpx - GREEN).max(1)
    out['bg_mean_rgb'] = [round(float(c)) for c in mean]
    out['bg_offkey_pct'] = round(float((dev > 40).mean() * 100), 2)        # far from #00FF00
    if np.abs(mean - GREEN).max() > 30:
        issue(f'background is not #00FF00 (mean {out["bg_mean_rgb"]})')
    if out['bg_offkey_pct'] > 1:
        issue(f'{out["bg_offkey_pct"]}% of background pixels are >40 levels off #00FF00')

    # gradient: compare 8x8 cell means
    cells = []
    for cy in range(8):
        for cx in range(8):
            sl = (slice(cy * h // 8, (cy + 1) * h // 8), slice(cx * w // 8, (cx + 1) * w // 8))
            m = bg[sl]
            if m.sum() > 0.3 * m.size:
                cells.append(rgb[sl][m].mean(0))
    if cells:
        cells = np.array(cells)
        spread = float((cells.max(0) - cells.min(0)).max())
        out['bg_cell_spread'] = round(spread, 1)
        if spread > 25:
            issue(f'background gradient: cell means differ by {spread:.0f} levels')

    # cast shadows: green-dominant but clearly darker than the key, outside the piece edges
    ring = cv2.dilate(fg.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    shadow = (~ring) & (dom > 25) & (rgb[..., 1] < mean[1] - 45)
    out['shadow_pct'] = round(float(shadow.mean() * 100), 3)
    if out['shadow_pct'] > 0.15:
        issue(f'dark green shadows on the background ({out["shadow_pct"]}% of the image)')

    # spill: green tint just inside each piece's edge (skip the 1 px antialias row)
    fg8 = fg.astype(np.uint8)
    inner = (cv2.erode(fg8, np.ones((3, 3), np.uint8)) > 0) & ~(cv2.erode(fg8, np.ones((9, 9), np.uint8)) > 0)
    px = rgb[inner]
    spill = (px[:, 1] - np.maximum(px[:, 0], px[:, 2])) > 20
    out['edge_spill_pct'] = round(float(spill.mean() * 100), 2) if len(px) else 0.0
    if out['edge_spill_pct'] > 3:
        issue(f'green halo on piece edges ({out["edge_spill_pct"]}% of edge pixels)')

    # --- pieces
    lab, big, small = pieces(fg, w, h)
    out['pieces'] = len(big)
    out['small_marks'] = len(small)
    if expect is not None and len(big) != expect:
        issue(f'{len(big)} pieces found, {expect} expected')
    if small:
        issue(f'{len(small)} small isolated marks (stray text, numbers or specks?) e.g. at ' +
              ', '.join(f'({s["x"]},{s["y"]})' for s in small[:5]))
    margin = max(3, w // 300)
    edge = [p for p in big if p['x'] <= margin or p['y'] <= margin or p['x'] + p['w'] >= w - margin or p['y'] + p['h'] >= h - margin]
    if edge:
        issue(f'{len(edge)} piece(s) touch the image border')
    if big:
        areas = np.array([p['area'] for p in big])
        merged = [p for p in big if p['area'] > 1.9 * np.median(areas)] if len(big) >= 4 else []
        if merged and expect and len(big) < expect:
            issue(f'{len(merged)} piece(s) look like two drawings stuck together')
        # minimal gap between pieces (pixels), via distance to every other piece
        gaps = []
        for p in big:
            own = (lab == p['id']).astype(np.uint8)
            others = ((lab > 0) & (lab != p['id']) & np.isin(lab, [q['id'] for q in big])).astype(np.uint8)
            if others.any():
                dist = cv2.distanceTransform(1 - others, cv2.DIST_L2, 3)
                gaps.append(float(dist[own > 0].min()))
        if gaps:
            out['min_gap_px'] = round(min(gaps), 1)
            if min(gaps) < 0.012 * w:
                issue(f'pieces nearly touch (min gap {min(gaps):.0f}px)')

        # scale
        hs = np.array([max(p['h'], p['w']) / w for p in big])
        out['piece_size_rel'] = round(float(np.median(hs)), 4)
        out['size_cv'] = round(float(hs.std() / hs.mean()), 3)
        if cfg.get('ref'):
            ref = piece_heights(os.path.join(ROOT, cfg['ref']), cfg.get('ref_top'))
            if ref:
                ratio = float(np.median(hs) / np.median(ref))
                out['scale_vs_ref'] = round(ratio, 2)
                if not 0.7 <= ratio <= 1.4:
                    issue(f'pieces are {ratio:.2f}x the reference size (relative to sheet width)')
    return out


def store(result):
    if not os.path.exists(MANIFEST):
        return
    man = json.load(open(MANIFEST, encoding='utf8'))
    for v in man.get('sheets', {}).get(result['sheet'], {}).get('versions', []):
        if v.get('file') == result['file']:
            v['check'] = {k: x for k, x in result.items() if k not in ('file', 'sheet')}
            json.dump(man, open(MANIFEST, 'w', encoding='utf8'), indent=2)
            open(MANIFEST, 'a', encoding='utf8').write('\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--sheet', help='sheet id (default: from the file name)')
    ap.add_argument('--expect', type=int, help='override the expected piece count')
    a = ap.parse_args()
    bad = 0
    for f in a.files:
        r = analyse(os.path.abspath(f), a.sheet or sheet_id(f), a.expect)
        store(r)
        keys = [k for k in r if k not in ('file', 'sheet', 'issues')]
        print(f"{r['file']}  [{r['sheet']}]  " + '  '.join(f'{k}={r[k]}' for k in keys))
        for i in r['issues']:
            print('   ! ' + i)
        print('   PASS' if not r['issues'] else f"   {len(r['issues'])} issue(s)")
        bad += bool(r['issues'])
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
