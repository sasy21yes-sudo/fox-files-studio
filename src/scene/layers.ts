import type { Stage } from '../animation/stage';
import { hash } from '../animation/math';
import type { BlendMode, Effect, ElementBase, SceneElement, SceneSpec, Track, Wiggle } from './spec';
import { evalNum, num } from './tracks';

/**
 * After Effects-style layer features for data scenes, on top of each element's own drawing:
 * parenting (and 'null' parents), animated scale, wiggle, loopOut-style repeat, blending modes, an
 * effects stack (blur, glow, drop shadow, colour correction, tint, stroke, flicker), shape masks,
 * track mattes (alpha / luma, inverted) and motion blur.
 *
 * An element with none of the compositing features is drawn straight onto the frame as before (same
 * pixels, no cost). Otherwise it is drawn alone into a frame-sized layer canvas with the same
 * transform, processed there, and composited with its blending mode. Deterministic: everything is a
 * function of the authored time, so preview and export give the same frame.
 */

export type Paint = (el: SceneElement, st: Stage, first: boolean) => void;

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  add: 'lighter',
  colorDodge: 'color-dodge',
  colorBurn: 'color-burn',
  hardLight: 'hard-light',
  softLight: 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};
export const BLEND_MODES = Object.keys(BLEND) as BlendMode[];

// ------------------------------------------------------------------ time and motion

/** The element's own clock with its repeat (loopOut cycle / pingpong). */
export function repeatK(el: ElementBase, k: number): number {
  const r = el.repeat;
  if (!r || !(r.every > 0)) return k;
  const from = r.from ?? 0;
  if (k <= from) return k;
  const t = k - from;
  if (r.mode === 'pingpong') {
    const m = t % (2 * r.every);
    return from + (m <= r.every ? m : 2 * r.every - m);
  }
  return from + (t % r.every);
}

/** Smooth deterministic noise in -1..1 (value noise, smoothstep between hashed integer steps). */
function noise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash(i * 13.17 + seed * 101.3) * 2 - 1;
  const b = hash((i + 1) * 13.17 + seed * 101.3) * 2 - 1;
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

export function wiggleAt(w: Wiggle | undefined, k: number): { x: number; y: number; rot: number; scale: number } {
  if (!w || !(w.freq > 0)) return { x: 0, y: 0, rot: 0, scale: 0 };
  const t = k * w.freq;
  const sd = w.seed ?? 1;
  return { x: (w.x ?? 0) * noise(t, sd), y: (w.y ?? 0) * noise(t, sd + 7), rot: (w.rot ?? 0) * noise(t, sd + 13), scale: (w.scale ?? 0) * noise(t, sd + 29) };
}

const tr = (t: Track<number> | undefined, k: number, v: boolean, fb: number) => evalNum(t, k, v, undefined, fb);

/** Where an element's move is applied around: its position plus its animated offsets (world px). */
function pivot(el: ElementBase, s: Stage, k: number): [number, number] {
  return [(num(el.x, s.vertical) + tr(el.dx, k, s.vertical, 0)) * s.w, (num(el.y, s.vertical) + tr(el.dy, k, s.vertical, 0)) * s.h];
}

/**
 * The parent chain's transform: each parent's change from its resting place (its animated offsets,
 * rotation, scaleBy and wiggle) applied around that place, so a child moves, turns and scales with it.
 */
function parentMatrix(spec: SceneSpec, s: Stage, el: ElementBase, depth = 0): DOMMatrix {
  if (!el.parent || depth > 8) return new DOMMatrix();
  const p = spec.elements.find((e) => e.id === el.parent);
  if (!p || p === el) return new DOMMatrix();
  const k = repeatK(p, s.k);
  const restX = num(p.x, s.vertical) * s.w;
  const restY = num(p.y, s.vertical) * s.h;
  const [px, py] = pivot(p, s, k);
  const wg = wiggleAt(p.wiggle, k);
  const rot = tr(p.rot, k, s.vertical, 0) + wg.rot;
  const sc = tr(p.scaleBy, k, s.vertical, 1) * (1 + wg.scale);
  return parentMatrix(spec, s, p, depth + 1)
    .translate(px + wg.x * s.w, py + wg.y * s.h)
    .rotate((rot * 180) / Math.PI)
    .scale(sc, sc)
    .translate(-restX, -restY);
}

/** The element's own scaleBy and wiggle, around its position (its rotation is applied by its drawing). */
function ownMatrix(el: ElementBase, s: Stage, k: number): DOMMatrix {
  if (el.scaleBy === undefined && !el.wiggle) return new DOMMatrix();
  const [px, py] = pivot(el, s, k);
  const wg = wiggleAt(el.wiggle, k);
  const sc = tr(el.scaleBy, k, s.vertical, 1) * (1 + wg.scale);
  return new DOMMatrix()
    .translate(px + wg.x * s.w, py + wg.y * s.h)
    .rotate((wg.rot * 180) / Math.PI)
    .scale(sc, sc)
    .translate(-px, -py);
}

const needsLayer = (el: ElementBase) => !!(el.fx?.length || (el.blend && el.blend !== 'normal') || el.matte || el.mask || el.motionBlur);

// ------------------------------------------------------------------ scratch canvases

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const pool: Ctx[] = [];
function scratch(i: number, w: number, h: number): Ctx {
  let c = pool[i];
  if (!c) {
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    c = pool[i] = cv.getContext('2d') as Ctx;
  }
  if (c.canvas.width !== w || c.canvas.height !== h) {
    c.canvas.width = w;
    c.canvas.height = h;
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.filter = 'none';
  c.clearRect(0, 0, w, h);
  return c;
}

/** Copy `src` into `dst` through a canvas filter (or none). */
function through(dst: Ctx, src: Ctx, filter = 'none', alpha = 1, op: GlobalCompositeOperation = 'source-over', dx = 0, dy = 0) {
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  dst.filter = filter;
  dst.globalAlpha = alpha;
  dst.globalCompositeOperation = op;
  dst.drawImage(src.canvas, dx, dy);
  dst.restore();
}

/** A copy of `src` in one flat colour (its alpha kept). */
function silhouette(dst: Ctx, src: Ctx, color: string) {
  through(dst, src);
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  dst.globalCompositeOperation = 'source-in';
  dst.fillStyle = color;
  dst.fillRect(0, 0, dst.canvas.width, dst.canvas.height);
  dst.restore();
}

// ------------------------------------------------------------------ the layer

/**
 * Draw one element with its layer features. `paint` draws an element as the scene renderer would,
 * onto the stage it is given (`first` = the pass that reports to the editor's probe).
 */
export function drawLayer(spec: SceneSpec, s: Stage, el: SceneElement, paint: Paint): void {
  if (el.isMatte) return;
  const k = repeatK(el, s.k);
  const M = parentMatrix(spec, s, el).multiply(ownMatrix(el, s, k));
  const g = s.g;
  if (!needsLayer(el)) {
    g.save();
    g.transform(M.a, M.b, M.c, M.d, M.e, M.f);
    paint(el, { ...s, k }, true);
    g.restore();
    return;
  }
  const W = g.canvas.width;
  const H = g.canvas.height;
  const base = g.getTransform();
  const at = base.multiply(M);
  /** Device px per world px (for sizes given in u). */
  const devPerWorld = Math.hypot(base.a, base.b);
  const px = (u: number) => u * s.u * devPerWorld;
  const kv = (t: Track<number> | undefined, fb: number) => tr(t, k, s.vertical, fb);

  // 1. The element alone (averaged over the shutter for motion blur).
  const L = scratch(0, W, H);
  const samples = el.motionBlur ? Math.max(2, Math.min(16, Math.round(el.motionBlur.samples ?? 8))) : 1;
  const shutter = el.motionBlur ? (el.motionBlur.shutter ?? 0.04) : 0;
  for (let i = 0; i < samples; i++) {
    const ks = samples > 1 ? k - (shutter * i) / (samples - 1) : k;
    const T = samples > 1 ? scratch(1, W, H) : L;
    T.setTransform(at);
    paint(el, { ...s, g: T as CanvasRenderingContext2D, k: ks, time: s.time - (k - ks), probe: i === 0 ? s.probe : undefined }, i === 0);
    // Running average: sample i weighs 1/(i+1) over the mean so far.
    if (samples > 1) through(L, T, 'none', 1 / (i + 1));
  }

  // 2. Effects, in order.
  for (const fx of el.fx ?? []) applyEffect(fx, L, W, H, kv, px, k);

  // 3. Shape mask.
  if (el.mask && el.mask.points.length > 2) {
    const m = scratch(2, W, H);
    m.setTransform(base);
    m.beginPath();
    el.mask.points.forEach((p, i) => {
      const x = num(p.x, s.vertical) * s.w;
      const y = num(p.y, s.vertical) * s.h;
      if (i) m.lineTo(x, y);
      else m.moveTo(x, y);
    });
    m.closePath();
    m.fillStyle = '#fff';
    m.fill();
    if (el.mask.expand) {
      m.lineWidth = Math.abs(px(el.mask.expand)) * 2;
      m.strokeStyle = '#fff';
      m.lineJoin = 'round';
      m.stroke();
    }
    const f = el.mask.feather ? px(el.mask.feather) : 0;
    const m2 = f > 0.3 ? scratch(3, W, H) : m;
    if (f > 0.3) through(m2, m, `blur(${f.toFixed(2)}px)`);
    through(L, m2, 'none', 1, el.mask.invert ? 'destination-out' : 'destination-in');
  }

  // 4. Track matte: another element's alpha (or luminance) cuts this one.
  if (el.matte) {
    const src = spec.elements.find((e) => e.id === el.matte!.source);
    if (src && src !== el) {
      const T = scratch(4, W, H);
      T.setTransform(base.multiply(parentMatrix(spec, s, src)).multiply(ownMatrix(src, s, repeatK(src, s.k))));
      paint(src, { ...s, g: T as CanvasRenderingContext2D, k: repeatK(src, s.k), probe: undefined }, false);
      const mode = el.matte.mode ?? 'alpha';
      if (mode === 'luma' || mode === 'lumaInverted') {
        const d = T.getImageData(0, 0, W, H);
        const a = d.data;
        for (let i = 0; i < a.length; i += 4) {
          const l = (0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]) / 255;
          a[i + 3] = Math.round(a[i + 3] * (mode === 'luma' ? l : 1 - l));
        }
        T.putImageData(d, 0, 0);
        through(L, T, 'none', 1, 'destination-in');
      } else through(L, T, 'none', 1, mode === 'alphaInverted' ? 'destination-out' : 'destination-in');
    }
  }

  // 5. Onto the frame with its blending mode.
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = BLEND[el.blend ?? 'normal'] ?? 'source-over';
  g.drawImage(L.canvas, 0, 0);
  g.restore();
}

function applyEffect(fx: Effect, L: Ctx, W: number, H: number, kv: (t: Track<number> | undefined, fb: number) => number, px: (u: number) => number, k: number) {
  switch (fx.type) {
    case 'blur': {
      const r = px(kv(fx.amount, 0));
      if (r < 0.3) return;
      const T = scratch(5, W, H);
      through(T, L, `blur(${r.toFixed(2)}px)`);
      L.clearRect(0, 0, W, H);
      through(L, T);
      return;
    }
    case 'color': {
      const parts = [
        `brightness(${kv(fx.brightness, 1)})`,
        `contrast(${kv(fx.contrast, 1)})`,
        `saturate(${kv(fx.saturation, 1)})`,
        `hue-rotate(${kv(fx.hue, 0)}deg)`,
        `sepia(${kv(fx.sepia, 0)})`,
        `grayscale(${kv(fx.grayscale, 0)})`,
        `invert(${kv(fx.invert, 0)})`,
      ].join(' ');
      const T = scratch(5, W, H);
      through(T, L, parts);
      L.clearRect(0, 0, W, H);
      through(L, T);
      return;
    }
    case 'glow': {
      const r = px(kv(fx.radius, 20));
      const T = scratch(5, W, H);
      if (fx.color) silhouette(T, L, fx.color);
      else through(T, L);
      const B = scratch(6, W, H);
      through(B, T, `blur(${Math.max(0.5, r).toFixed(2)}px)`);
      through(L, B, 'none', Math.max(0, Math.min(3, kv(fx.intensity, 1))), 'lighter');
      return;
    }
    case 'shadow': {
      const T = scratch(5, W, H);
      silhouette(T, L, fx.color ?? '#000');
      const R = scratch(6, W, H);
      through(R, T, `blur(${Math.max(0, px(kv(fx.blur, 12))).toFixed(2)}px)`, Math.max(0, Math.min(1, kv(fx.opacity, 0.5))), 'source-over', px(kv(fx.x, 8)), px(kv(fx.y, 12)));
      through(R, L);
      L.clearRect(0, 0, W, H);
      through(L, R);
      return;
    }
    case 'tint': {
      L.save();
      L.setTransform(1, 0, 0, 1, 0, 0);
      L.globalCompositeOperation = 'source-atop';
      L.globalAlpha = Math.max(0, Math.min(1, kv(fx.amount, 0.5)));
      L.fillStyle = fx.color;
      L.fillRect(0, 0, W, H);
      L.restore();
      return;
    }
    case 'stroke': {
      const wd = px(kv(fx.width, 4));
      if (wd < 0.3) return;
      const T = scratch(5, W, H);
      silhouette(T, L, fx.color ?? '#1c120b');
      const R = scratch(6, W, H);
      const n = 16;
      for (let i = 0; i < n; i++) through(R, T, 'none', 1, 'source-over', Math.cos((i / n) * Math.PI * 2) * wd, Math.sin((i / n) * Math.PI * 2) * wd);
      through(R, L);
      L.clearRect(0, 0, W, H);
      through(L, R);
      return;
    }
    case 'opacityFlicker': {
      const a = 1 - Math.max(0, Math.min(1, kv(fx.amount, 0.3))) * hash(Math.floor(k * (fx.freq ?? 12)) * 7.3 + 1);
      L.save();
      L.setTransform(1, 0, 0, 1, 0, 0);
      L.globalCompositeOperation = 'destination-in';
      L.fillStyle = `rgba(0,0,0,${a})`;
      L.fillRect(0, 0, W, H);
      L.restore();
      return;
    }
  }
}
