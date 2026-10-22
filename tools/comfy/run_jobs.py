"""
Render the pieces of a sheet from tools/comfy/jobs.py, skipping pieces that
already have an approved version in art/incoming/manifest.json.

Usage: python tools/comfy/run_jobs.py <sheet> [--pieces a,b] [--count 3] [--correction "..."]
"""
import argparse, os, subprocess, sys, time
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from jobs import JOBS  # noqa: E402
from edit import ROOT, load_manifest, load_spec, save_manifest  # noqa: E402


def copy_original(sheet, piece, spec):
    """Use one of Salvatore's own drawings as the piece (no generation)."""
    out_dir = os.path.join(ROOT, 'art', 'incoming', 'pieces', sheet)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f'{piece}_v1.png')
    cv2.imwrite(out, load_spec(spec))
    man = load_manifest()
    man['sheets'][f'{sheet}/{piece}'] = {'versions': [{
        'version': 'v1', 'file': os.path.relpath(out, ROOT).replace('\\', '/'), 'status': 'approved',
        'model': 'original drawing (not generated)', 'image': spec, 'review': 'existing rig drawing, used as is',
        'created': time.strftime('%Y-%m-%dT%H:%M:%S'),
    }]}
    save_manifest(man)
    print(f'{sheet}/{piece}: copied from {spec}', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet')
    ap.add_argument('--pieces', help='comma-separated subset')
    ap.add_argument('--count', type=int, default=3)
    ap.add_argument('--correction', action='append', default=[])
    a = ap.parse_args()
    jobs = JOBS[a.sheet]
    names = a.pieces.split(',') if a.pieces else list(jobs)
    man = load_manifest()
    for n in names:
        done = [v for v in man['sheets'].get(f'{a.sheet}/{n}', {}).get('versions', []) if v['status'] in ('approved', 'final')]
        if done and not a.pieces:
            print(f'{a.sheet}/{n}: already approved ({done[-1]["version"]}), skipped', flush=True)
            continue
        j = jobs[n]
        if 'copy' in j:
            copy_original(a.sheet, n, j['copy'])
            continue
        image = j['image']
        if image.startswith('approved:'):
            src = [v for v in man['sheets'].get(image[9:], {}).get('versions', []) if v['status'] in ('approved', 'final')]
            if not src:
                print(f'{a.sheet}/{n}: {image[9:]} not approved yet, skipped', flush=True)
                continue
            image = src[-1]['file']
        cmd = [sys.executable, os.path.join(HERE, 'edit.py'), a.sheet, n, '--image', image,
               '--prompt', j['prompt'], '--count', str(a.count)]
        for r in j.get('refs', []):
            cmd += ['--ref', r]
        for c in a.correction:
            cmd += ['--correction', c]
        print(f'== {a.sheet}/{n}', flush=True)
        subprocess.run(cmd, check=True)


if __name__ == '__main__':
    main()
