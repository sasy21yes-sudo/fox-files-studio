import { hash, hash2, rng } from '../animation/math';

/**
 * Vintage film treatment: colour grade, vignette, gate flicker, grain,
 * dust specks and vertical scratches. Every random value is seeded by the
 * frame index so a given timestamp always renders identically.
 */

const GRAIN_TILE = 192;
const GRAIN_TILES = 6;
let grainCache: HTMLCanvasElement[] | null = null;

function grainTiles(): HTMLCanvasElement[] {
  if (grainCache) return grainCache;
  grainCache = [];
  for (let k = 0; k < GRAIN_TILES; k++) {
    const c = document.createElement('canvas');
    c.width = c.height = GRAIN_TILE;
    const g = c.getContext('2d')!;
    const img = g.createImageData(GRAIN_TILE, GRAIN_TILE);
    const r = rng(1000 + k * 77);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(128 + (r() + r() + r() - 1.5) * 120);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainCache.push(c);
  }
  return grainCache;
}

export interface FilmOptions {
  grain: boolean;
  /** 0..1 strength of the warm sepia grade. */
  sepia?: number;
  /** Extra darkening for sombre scenes, 0..1. */
  gloom?: number;
}

/** Frame index at the 24 fps "projector" rate, used for flicker and dust. */
const filmFrame = (time: number) => Math.floor(time * 24);

export function applyFilm(g: CanvasRenderingContext2D, w: number, h: number, time: number, opts: FilmOptions): void {
  const f = filmFrame(time);
  const u = Math.min(w, h) / 1080;
  g.save();

  // Warm grade.
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = `rgba(196, 140, 72, ${0.32 * (opts.sepia ?? 1)})`;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';

  if (opts.gloom) {
    g.fillStyle = `rgba(8, 10, 14, ${0.35 * opts.gloom})`;
    g.fillRect(0, 0, w, h);
  }

  // Vignette.
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) * 0.58);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.72)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);

  if (opts.grain) {
    // Gate flicker.
    const flick = (hash(f * 3 + 1) - 0.5) * 0.07;
    g.fillStyle = flick > 0 ? `rgba(255, 238, 205, ${flick})` : `rgba(0, 0, 0, ${-flick})`;
    g.fillRect(0, 0, w, h);

    // Grain: a tiled noise texture, re-offset every projector frame.
    const tiles = grainTiles();
    const tile = tiles[((f % tiles.length) + tiles.length) % tiles.length];
    const pattern = g.createPattern(tile, 'repeat');
    if (pattern) {
      const ox = Math.floor(hash(f * 5 + 2) * GRAIN_TILE);
      const oy = Math.floor(hash(f * 7 + 3) * GRAIN_TILE);
      const scale = Math.max(1, u * 1.6);
      g.save();
      g.globalCompositeOperation = 'overlay';
      g.globalAlpha = 0.22;
      g.translate(-ox * scale, -oy * scale);
      g.scale(scale, scale);
      g.fillStyle = pattern;
      g.fillRect(0, 0, w / scale + GRAIN_TILE * 2, h / scale + GRAIN_TILE * 2);
      g.restore();
    }

    // Dust specks and hairs.
    const dust = 4 + Math.floor(hash(f * 11) * 7);
    for (let i = 0; i < dust; i++) {
      const x = hash2(f, i * 3) * w;
      const y = hash2(f, i * 3 + 1) * h;
      const r = (0.8 + hash2(f, i * 3 + 2) * 2.6) * u * 2;
      const light = hash2(f, i + 50) > 0.6;
      g.fillStyle = light ? 'rgba(255, 244, 220, 0.5)' : 'rgba(10, 6, 2, 0.55)';
      g.beginPath();
      if (hash2(f, i + 90) > 0.82) {
        g.strokeStyle = g.fillStyle;
        g.lineWidth = Math.max(1, u * 1.6);
        g.moveTo(x, y);
        g.quadraticCurveTo(x + r * 6, y - r * 4, x + r * 10, y + r * 3);
        g.stroke();
      } else {
        g.ellipse(x, y, r, r * (0.6 + hash2(f, i) * 0.6), 0, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Vertical scratches that persist for a few frames.
    const block = Math.floor(f / 5);
    const scratches = hash(block * 13 + 7) > 0.45 ? 1 + Math.floor(hash(block * 17) * 2) : 0;
    for (let i = 0; i < scratches; i++) {
      const x = hash2(block, i + 200) * w + Math.sin(f * 0.9 + i) * 3 * u;
      const top = hash2(block, i + 300) * h * 0.4;
      const len = h * (0.4 + hash2(block, i + 400) * 0.6);
      g.strokeStyle = `rgba(255, 246, 225, ${0.18 + hash2(f, i + 500) * 0.2})`;
      g.lineWidth = Math.max(1, u * (1 + hash2(block, i + 600) * 1.5));
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x + (hash2(block, i + 700) - 0.5) * 6 * u, top + len);
      g.stroke();
    }
  }
  g.restore();
}
