"""4x anime-style upscaler (Real-ESRGAN x4plus_anime_6B weights, RRDBNet), CPU.
Usage: python3 upscale.py WEIGHTS in.png out.png"""
import sys, numpy as np, torch, torch.nn as nn, torch.nn.functional as F
import cv2


class RDB(nn.Module):
    def __init__(self, nf=64, gc=32):
        super().__init__()
        self.conv1 = nn.Conv2d(nf, gc, 3, 1, 1)
        self.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1)
        self.conv3 = nn.Conv2d(nf + 2 * gc, gc, 3, 1, 1)
        self.conv4 = nn.Conv2d(nf + 3 * gc, gc, 3, 1, 1)
        self.conv5 = nn.Conv2d(nf + 4 * gc, nf, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(0.2, True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    def __init__(self, nf, gc=32):
        super().__init__()
        self.rdb1, self.rdb2, self.rdb3 = RDB(nf, gc), RDB(nf, gc), RDB(nf, gc)

    def forward(self, x):
        return self.rdb3(self.rdb2(self.rdb1(x))) * 0.2 + x


class RRDBNet(nn.Module):
    def __init__(self, nb=6, nf=64):
        super().__init__()
        self.conv_first = nn.Conv2d(3, nf, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(nf) for _ in range(nb)])
        self.conv_body = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_hr = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_last = nn.Conv2d(nf, 3, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(0.2, True)

    def forward(self, x):
        feat = self.conv_first(x)
        feat = feat + self.conv_body(self.body(feat))
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode='nearest')))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode='nearest')))
        return self.conv_last(self.lrelu(self.conv_hr(feat)))


_net = None


def load(weights):
    global _net
    if _net is None:
        net = RRDBNet()
        sd = torch.load(weights, map_location='cpu')
        sd = sd.get('params_ema', sd.get('params', sd))
        net.load_state_dict(sd, strict=True)
        net.eval()
        _net = net
    return _net


def upscale_bgr(weights, bgr, tile=192, pad=12):
    net = load(weights)
    img = bgr[:, :, ::-1].astype(np.float32) / 255.0
    h, w = img.shape[:2]
    out = np.zeros((h * 4, w * 4, 3), np.float32)
    t = torch.from_numpy(img.transpose(2, 0, 1)).unsqueeze(0)
    with torch.no_grad():
        for y in range(0, h, tile):
            for x in range(0, w, tile):
                y0, x0 = max(y - pad, 0), max(x - pad, 0)
                y1, x1 = min(y + tile + pad, h), min(x + tile + pad, w)
                o = net(t[:, :, y0:y1, x0:x1]).clamp(0, 1)[0].numpy().transpose(1, 2, 0)
                oy, ox = (y - y0) * 4, (x - x0) * 4
                th, tw = min(tile, h - y) * 4, min(tile, w - x) * 4
                out[y * 4:y * 4 + th, x * 4:x * 4 + tw] = o[oy:oy + th, ox:ox + tw]
    return (out[:, :, ::-1] * 255 + 0.5).astype(np.uint8)


if __name__ == '__main__':
    torch.set_num_threads(max(1, torch.get_num_threads()))
    src = cv2.imread(sys.argv[2])
    cv2.imwrite(sys.argv[3], upscale_bgr(sys.argv[1], src))
