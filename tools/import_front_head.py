"""
Bring a front head drawn or picked by Salvatore (any green background) into the front rig pipeline:
re-key its background to the renders' standard green (only the background itself and a thin band of
anti-aliased edge around it, never colours inside the drawing), align it on the approved head's nose,
and write art/incoming/pieces/front/head_v<N>.png (register it in the manifest and run bake_front.py).

  python tools/import_front_head.py <image> <out png>
"""
import sys
import cv2, numpy as np
from scipy import ndimage as ndi
sys.path.insert(0, __import__('os').path.dirname(__file__))
from bake_front import nose_of, approved, ROOT  # noqa: E402

STD = np.array([24, 224, 24], np.float32)  # BGR of the renders' green screen


def main(src, out):
    u = cv2.imread(src).astype(np.float32)
    corners = np.concatenate([u[:40, :40].reshape(-1, 3), u[:40, -40:].reshape(-1, 3), u[-40:, :40].reshape(-1, 3), u[-40:, -40:].reshape(-1, 3)])
    bg = np.median(corners, 0)
    dist = np.abs(u - bg).max(2)
    # The background: pixels of its colour connected to the image border.
    lab, _ = ndi.label(dist < 40)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    back = np.isin(lab, list(border))
    band = ndi.binary_dilation(back, iterations=4) & ~back
    t = np.ones(dist.shape, np.float32)
    t[back] = 0
    t[band] = np.clip((dist[band] - 25) / 70, 0, 1)
    t3 = t[..., None]
    fg = np.where(t3 > 0, (u - (1 - t3) * bg) / np.maximum(t3, 1e-3), u)
    img = (np.clip(fg, 0, 255) * t3 + STD * (1 - t3)).astype(np.uint8)
    head = cv2.imread(f'{ROOT}/{approved("front/head")}')
    d = nose_of(head, near=(515, 712))[0] - nose_of(img, near=(img.shape[1] // 2, int(img.shape[0] * 0.7)))[0]
    img = cv2.warpAffine(img, np.float32([[1, 0, d[0]], [0, 1, d[1]]]), (head.shape[1], head.shape[0]), flags=cv2.INTER_CUBIC,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=tuple(int(v) for v in STD))
    cv2.imwrite(out, img)
    print('background', bg.round(), '-> standard green; shifted by', d.round(2))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
