"""
Contact sheet for one generated sheet: the chosen version large on top, the
discarded attempts below, each captioned with version, size, status and the
review note from art/incoming/manifest.json. Sheets built from single pieces
(tools/comfy) also get one row per piece: the chosen render first, then every
discarded attempt with the reason.

Usage: python tools/gemini/review.py <sheet> [--manifest path] [--out path]
Output: art/incoming/review_<sheet>.jpg
"""
import argparse, json, os, textwrap
import cv2, numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
W = 1600          # contact sheet width
PAD = 16
INK = (40, 30, 25)
PAPER = (232, 240, 244)  # BGR, warm cream
COLORS = {'final': (60, 140, 40), 'approved': (60, 140, 40), 'rejected': (40, 40, 190), 'draft': (90, 90, 90)}


def caption(v, width):
    head = f"{v['version']}  {v.get('size', '')}  {v['status'].upper()}"
    if v.get('from'):
        head += f"  (from {v['from']})"
    note = v.get('review') or ''
    if v.get('corrections'):
        note = (note + '  |  corrections: ' if note else 'corrections: ') + ' / '.join(v['corrections'])
    chars = max(20, int(width / 9.5))
    return head, textwrap.wrap(note, chars)[:4]


def tile(v, width):
    img = cv2.imread(os.path.join(ROOT, v['file']))
    h = int(img.shape[0] * width / img.shape[1])
    img = cv2.resize(img, (width, h), interpolation=cv2.INTER_AREA)
    head, lines = caption(v, width)
    cap_h = 34 + 22 * len(lines)
    out = np.full((h + cap_h, width, 3), PAPER, np.uint8)
    out[:h] = img
    cv2.rectangle(out, (0, 0), (width - 1, h - 1), COLORS.get(v['status'], INK), 4)
    cv2.putText(out, head, (6, h + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, COLORS.get(v['status'], INK), 2, cv2.LINE_AA)
    for i, line in enumerate(lines):
        cv2.putText(out, line, (6, h + 48 + 22 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.5, INK, 1, cv2.LINE_AA)
    return out


def grid(tiles, cols):
    """Lay tiles (same width) out in rows of `cols`."""
    tw = tiles[0].shape[1]
    rows = []
    for i in range(0, len(tiles), cols):
        part = tiles[i:i + cols]
        rh = max(t.shape[0] for t in part)
        row = np.full((rh, W, 3), PAPER, np.uint8)
        for j, t in enumerate(part):
            row[:t.shape[0], j * (tw + PAD):j * (tw + PAD) + tw] = t
        rows.append(row)
    return rows


def label(text):
    out = np.full((40, W, 3), PAPER, np.uint8)
    cv2.line(out, (0, 4), (W - 1, 4), INK, 1)
    cv2.putText(out, text, (6, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8, INK, 2, cv2.LINE_AA)
    return out


def piece_rows(man, sheet):
    """One block per piece: chosen render first, then the discarded attempts."""
    cols = 6
    tw = (W - PAD * (cols - 1)) // cols
    rows = []
    for key, entry in man['sheets'].items():
        if not key.startswith(sheet + '/'):
            continue
        vs = [v for v in entry['versions'] if v.get('file') and os.path.exists(os.path.join(ROOT, v['file']))]
        vs.sort(key=lambda v: v['status'] not in ('approved', 'final'))
        ok = sum(v['status'] in ('approved', 'final') for v in vs)
        rows.append(label(f"{key.split('/', 1)[1]}  -  {len(vs)} attempt(s), {'chosen ' + vs[0]['version'] if ok else 'NONE APPROVED'}"))
        rows += grid([tile(v, tw) for v in vs], cols)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet')
    ap.add_argument('--manifest', default=os.path.join(ROOT, 'art', 'incoming', 'manifest.json'))
    ap.add_argument('--out')
    a = ap.parse_args()
    man = json.load(open(a.manifest, encoding='utf8'))
    vs = [v for v in man['sheets'][a.sheet]['versions'] if v.get('file')]
    chosen = [v for v in vs if v['status'] == 'final'] or [v for v in vs if v['status'] == 'approved']
    if not chosen:
        raise SystemExit(f'{a.sheet}: no final/approved version')
    top = tile(chosen[-1], W)
    rest = [v for v in vs if v is not chosen[-1]]
    cols = 3
    tw = (W - PAD * (cols - 1)) // cols
    rows = [top] + (grid([tile(v, tw) for v in rest], cols) if rest else []) + piece_rows(man, a.sheet)
    sep = np.full((PAD, W, 3), PAPER, np.uint8)
    sheet = np.vstack([x for r in rows for x in (r, sep)][:-1])
    out = a.out or os.path.join(ROOT, 'art', 'incoming', f'review_{a.sheet}.jpg')
    cv2.imwrite(out, sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
    print(os.path.relpath(out, ROOT), sheet.shape[1], 'x', sheet.shape[0])


if __name__ == '__main__':
    main()
