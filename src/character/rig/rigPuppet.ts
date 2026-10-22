/**
 * Agent Fox cut-out rig built from the rig-ready part sheets (art/parts).
 *
 * Every part is a complete drawing (round joint ends, nothing hidden is
 * missing), baked by tools/bake_rig.py into RIG px: the reference pose in
 * px x K. This module loads the sprites and draws the parts; AgentFox.ts
 * decides the pose (arm IK targets, walk, expressions) and calls in here.
 */
import rigJson from './rig.json';
import { RIG_ASSETS } from './assets';
import { MASTER_FACE } from './masterFace';
import { face as faceTweak } from './tweaks';

type G = CanvasRenderingContext2D;
export type V2 = [number, number];

interface Part {
  x: number;
  y: number;
  w: number;
  h: number;
  ax?: number;
  ay?: number;
  bx?: number;
  by?: number;
  len?: number;
  width?: number;
}
interface EyeMeta {
  white: V2;
  rx: number;
  ry: number;
  pupil: V2;
  closed: V2;
  happy: V2;
}
export const RIG = rigJson as unknown as {
  K: number;
  origin: V2;
  unit: number;
  neckPivot: V2;
  furColor: [number, number, number];
  eyes: { near: EyeMeta; far: EyeMeta };
  joints: Record<'shoulderFront' | 'shoulderBack' | 'wristFront' | 'wristBack' | 'hipNear' | 'hipFar' | 'tailBase', V2>;
  headRef: V2;
  parts: Record<string, Part>;
};

const images: Record<string, HTMLImageElement> = {};
let ready = false;
let loading: Promise<void> | null = null;

export function loadRig(): Promise<void> {
  if (loading) return loading;
  if (typeof Image === 'undefined') return Promise.resolve();
  loading = Promise.all(
    Object.entries(RIG_ASSETS).map(
      ([k, url]) =>
        new Promise<boolean>((res) => {
          const img = new Image();
          img.onload = () => {
            images[k] = img;
            res(true);
          };
          img.onerror = () => res(false);
          img.src = url;
        }),
    ),
  ).then((ok) => {
    ready = ok.every(Boolean);
  });
  return loading;
}

export function rigReady(): boolean {
  return ready;
}

export function part(name: string): Part {
  return RIG.parts[name];
}

/** A part baked in place (its x, y is its top-left in rig px). */
export function placed(g: G, name: string) {
  const p = RIG.parts[name];
  const img = images[name];
  if (img) g.drawImage(img, p.x, p.y);
}

/** A part whose x, y is its top-left relative to its own anchor; drawn with the anchor at (x, y). */
export function anchored(g: G, name: string, x: number, y: number, rot = 0, scale = 1, flipY = false) {
  const p = RIG.parts[name];
  const img = images[name];
  if (!img) return;
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  if (scale !== 1 || flipY) g.scale(scale, flipY ? -scale : scale);
  g.drawImage(img, p.x, p.y);
  g.restore();
}

/**
 * A sprite that bends instead of turning as one rigid block (no "sticker" look): drawn in vertical
 * strips; strips past `pivot` (fraction of the width, from the anchor side) turn progressively up to
 * `bend` radians around the pivot line's bottom, and the whole thing squashes (sx, sy) about the
 * anchor. Used for shoes (toe bend, landing squash) and gloves (wrist flex, grip squash).
 */
export function anchoredFlex(
  g: G,
  name: string,
  x: number,
  y: number,
  rot: number,
  o: { bend?: number; pivot?: number; sx?: number; sy?: number; scale?: number; flipY?: boolean } = {},
) {
  const p = RIG.parts[name];
  const img = images[name];
  if (!img) return;
  const bend = o.bend ?? 0;
  const sx = (o.sx ?? 1) * (o.scale ?? 1);
  const sy = (o.sy ?? 1) * (o.scale ?? 1) * (o.flipY ? -1 : 1);
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.scale(sx, sy);
  if (Math.abs(bend) < 0.004) {
    g.drawImage(img, p.x, p.y);
    g.restore();
    return;
  }
  const W = img.width;
  const H = img.height;
  const px = p.x + W * (o.pivot ?? 0.5);
  const py = p.y + H; // bend around the bottom edge (the sole / the palm side)
  const N = 14;
  const x0 = px;
  const step = (p.x + W - x0) / N;
  // Back part: unchanged.
  g.save();
  g.beginPath();
  g.rect(p.x - 2, p.y - H, x0 - p.x + 2.5, H * 3);
  g.clip();
  g.drawImage(img, p.x, p.y);
  g.restore();
  // Front strips: each rotated a little more around the running pivot, so the shape curves smoothly.
  let cx = px;
  let cy = py;
  let ang = 0;
  for (let i = 0; i < N; i++) {
    const a = (bend * (i + 0.5)) / N;
    const sxi = x0 + i * step;
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    g.translate(-(sxi), -py);
    g.beginPath();
    g.rect(sxi - 0.6, p.y - H, step + 1.2, H * 3);
    g.clip();
    g.drawImage(img, p.x, p.y);
    g.restore();
    // advance the pivot along the bent bottom edge
    cx += Math.cos(a) * step;
    cy += Math.sin(a) * step;
    ang = a;
  }
  void ang;
  g.restore();
}

/**
 * Draw a sprite as thin horizontal bands, each shifted sideways by dx(row):
 * a smooth bend of the drawing itself (spine sway, coat swing, tail wave)
 * instead of a rigid rotation. Bands overlap by a pixel so nothing tears.
 */
const scratchCanvases: Record<string, HTMLCanvasElement> = {};
const BEND_PAD = 120;

function bands(g: G, img: HTMLImageElement, ox: number, oy: number, dx: (rowY: number) => number, step: number) {
  // Bend at the sprite's own resolution (no transform: rows meet exactly, no seams),
  // then place the result with the current transform in a single draw.
  const key = img.src;
  let c = scratchCanvases[key];
  const W = img.width + BEND_PAD * 2;
  const H = img.height;
  if (!c) {
    c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    scratchCanvases[key] = c;
  }
  const x = c.getContext('2d')!;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, W, H);
  x.imageSmoothingEnabled = true;
  for (let r = 0; r < H; r += step) {
    const h = Math.min(step, H - r);
    const off = Math.max(-BEND_PAD, Math.min(BEND_PAD, dx(r + h / 2)));
    x.drawImage(img, 0, r, img.width, h, BEND_PAD + off, r, img.width, h);
  }
  g.drawImage(c, ox - BEND_PAD, oy);
}

/** A baked-in-place part, bent: dx receives the row's y in rig px. */
export function placedWarp(g: G, name: string, dx: (y: number) => number, step = 4) {
  const p = RIG.parts[name];
  const img = images[name];
  if (img) bands(g, img, p.x, p.y, (r) => dx(p.y + r), step);
}

/** An anchored part, bent: dx receives the row's y relative to the anchor (sprite px). */
export function anchoredWarp(g: G, name: string, x: number, y: number, rot: number, dx: (v: number) => number, step = 4) {
  const p = RIG.parts[name];
  const img = images[name];
  if (!img) return;
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  bands(g, img, p.x, p.y, (r) => dx(p.y + r), step);
  g.restore();
}

/** A tube (sleeve, leg) from joint a to joint b; it stretches along its length if needed. */
export function tube(g: G, name: string, a: V2, b: V2) {
  const p = RIG.parts[name];
  const img = images[name];
  if (!img) return;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  const sy = L / (p.len ?? L);
  g.save();
  g.translate(a[0], a[1]);
  g.rotate(Math.atan2(dy, dx) - Math.PI / 2);
  g.scale(1, sy);
  g.drawImage(img, -(p.ax ?? 0), -(p.ay ?? 0));
  g.restore();
}

/**
 * A rubber-hose limb: a straight tube texture laid along a quadratic curve
 * a -> c -> b with constant width, round end beyond a, cuff/end beyond b.
 * `from`/`to` (0..1) draw only part of it. Returns the end tangent angle.
 */
/** `widen(t)`: width multiplier along the limb (t 0 = top joint, 1 = end), e.g. a fuller shoulder. */
export function noodle(g: G, name: string, a: V2, c: V2, b: V2, from = 0, to = 1, widen?: (t: number) => number): number {
  const p = RIG.parts[name];
  const img = images[name];
  const pt = (t: number): V2 => {
    const m = 1 - t;
    return [m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]];
  };
  const tan = (t: number): V2 => {
    const m = 1 - t;
    const x = 2 * m * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
    const y = 2 * m * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  const endAng = Math.atan2(tan(1)[1], tan(1)[0]);
  if (!img) return endAng;
  const N = 44;
  const w = img.width;
  const half = w / 2;
  const cx = p.ax ?? half;
  const ay = p.ay ?? 0;
  const by = p.by ?? img.height;
  // Rows: [v (texture y), centre point, tangent]
  const rows: [number, V2, V2][] = [];
  const t0 = tan(0);
  const t1 = tan(1);
  rows.push([0, [a[0] - t0[0] * ay, a[1] - t0[1] * ay], t0]);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    rows.push([ay + (by - ay) * t, pt(t), tan(t)]);
  }
  const tail = img.height - by;
  rows.push([img.height, [b[0] + t1[0] * tail, b[1] + t1[1] * tail], t1]);
  const total = rows.length - 1;
  // Overlap neighbouring triangles by ~1.3 device px so no hairline seams show at any zoom.
  const m = g.getTransform();
  const growPx = 1.3 / (Math.hypot(m.a, m.b) || 1);
  const i0 = Math.floor(from * total);
  const i1 = Math.ceil(to * total);
  for (let i = i0; i < i1; i++) {
    const [v0, c0, d0] = rows[i];
    const [v1, c1, d1] = rows[i + 1];
    const k0 = widen ? widen(Math.min(1, Math.max(0, (v0 - ay) / (by - ay)))) : 1;
    const k1 = widen ? widen(Math.min(1, Math.max(0, (v1 - ay) / (by - ay)))) : 1;
    // Quad edges, perpendicular to the tangent (texture x grows to the right of the direction).
    const L0: V2 = [c0[0] + d0[1] * cx * k0, c0[1] - d0[0] * cx * k0];
    const R0: V2 = [c0[0] - d0[1] * (w - cx) * k0, c0[1] + d0[0] * (w - cx) * k0];
    const L1: V2 = [c1[0] + d1[1] * cx * k1, c1[1] - d1[0] * cx * k1];
    const R1: V2 = [c1[0] - d1[1] * (w - cx) * k1, c1[1] + d1[0] * (w - cx) * k1];
    // Clip to the quad grown along the tangent so neighbouring strips overlap (no seams).
    const gx0 = d0[0] * growPx, gy0 = d0[1] * growPx, gx1 = d1[0] * growPx, gy1 = d1[1] * growPx;
    g.save();
    g.beginPath();
    g.moveTo(L0[0] - gx0, L0[1] - gy0);
    g.lineTo(R0[0] - gx0, R0[1] - gy0);
    g.lineTo(R1[0] + gx1, R1[1] + gy1);
    g.lineTo(L1[0] + gx1, L1[1] + gy1);
    g.closePath();
    g.clip();
    // One affine per strip: texture (0,v0)->L0, (w,v0)->R0, (0,v1)->mid of L1/R1 side.
    const sv = Math.max(v1 - v0, 1e-3);
    const a_ = (R0[0] - L0[0]) / w;
    const b_ = (R0[1] - L0[1]) / w;
    const lx = ((L1[0] + R1[0]) / 2 - (L0[0] + R0[0]) / 2) / sv;
    const ly = ((L1[1] + R1[1]) / 2 - (L0[1] + R0[1]) / 2) / sv;
    g.transform(a_, b_, lx, ly, L0[0] - a_ * 0 - lx * v0, L0[1] - b_ * 0 - ly * v0);
    const y0 = Math.max(0, Math.floor(v0) - 14);
    const y1 = Math.min(img.height, Math.ceil(v1) + 14);
    g.drawImage(img, 0, y0, w, y1 - y0, 0, y0, w, y1 - y0);
    g.restore();
  }
  return endAng;
}

/** Control point for a rubber-hose limb of length L between a and b (bows out when shorter). */
export function hoseControl(a: V2, b: V2, L0: number, side: number, give = 0): { c: V2; stretch: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy) || 1;
  // `give`: how much the hose may shorten while staying straight before it starts to bow.
  const L = Math.max(d, L0 * (1 - give));
  // Bow out when the limb is shorter, but never fold into a hairpin (the hose shortens instead).
  const h = d < L ? Math.min(Math.sqrt(((L * L - d * d) * 3) / 16), L * 0.22) : 0;
  const nx = -dy / d;
  const ny = dx / d;
  return { c: [(a[0] + b[0]) / 2 + nx * 2 * h * side, (a[1] + b[1]) / 2 + ny * 2 * h * side], stretch: d > L ? d / L : 1 };
}

/** Elbow / knee position for a two-segment limb (rubber hose: stretches when out of reach). */
export function ik(s: V2, w: V2, l1: number, l2: number, side: number): { e: V2; k: number } {
  const dx = w[0] - s[0];
  const dy = w[1] - s[1];
  const d = Math.hypot(dx, dy) || 1;
  const k = d > l1 + l2 ? d / (l1 + l2) : 1;
  const L1 = l1 * k;
  const L2 = l2 * k;
  const d2 = Math.min(d, L1 + L2 - 1e-3);
  const c = (L1 * L1 + d2 * d2 - L2 * L2) / (2 * L1 * d2);
  const a = Math.acos(Math.max(-1, Math.min(1, c)));
  const base = Math.atan2(dy, dx) + side * a;
  return { e: [s[0] + Math.cos(base) * L1, s[1] + Math.sin(base) * L1], k };
}

// ------------------------------------------------------------------ face

export type MouthId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface Face {
  lookX: number;
  lookY: number;
  /** 0 open .. 1 closed (upper lid), per eye. */
  lid: [number, number];
  /** + inner corners down (angry), - inner corners up (worried). */
  lidTilt: number;
  /** Lower lid raise. */
  squint: number;
  happy: boolean;
  wink: boolean;
  eyeScale: number;
  pupil: number;
  brows: { raise: number; worry: number; angry: number; skeptic: number };
  mouth: MouthId;
}


/** Mouth and eyes (drawn under the hat). The brows go over the hat brim: see drawFaceBrows. */
export function drawFace(g: G, f: Face) {
  placed(g, `mouth_${f.mouth}`);
  const clip = (RIG as unknown as { headClip?: V2[] }).headClip;
  g.save();
  if (clip) {
    g.beginPath();
    g.moveTo(clip[0][0], clip[0][1]);
    for (const q of clip) g.lineTo(q[0], q[1]);
    g.closePath();
    g.clip();
  }
  (['near', 'far'] as const).forEach((side, i) => drawEye(g, side, i, f));
  drawUnderline(g, f);
  g.restore();
}

/** The line under the far eye (traced from the master): a tapered ink stroke that moves with the eye. */
let UNDERLINE: V2[] | null = null;
function drawUnderline(g: G, f: Face) {
  UNDERLINE ??= ((MASTER_FACE as unknown as { underline?: [number, number][] }).underline ?? []).map((p): V2 => {
    const q = unroll(p);
    return [q[0] - EYES.far.centre[0], q[1] - EYES.far.centre[1]];
  });
  if (UNDERLINE.length < 2) return;
  const k = FACE_UNIT * f.eyeScale;
  const [ex, ey] = eyeCentre('far', k);
  const P = UNDERLINE.map(([x, y]): V2 => [ex + x * k, ey + y * k]);
  const w = 0.05 * k;
  const L: V2[] = [];
  const R: V2[] = [];
  P.forEach((p, i) => {
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(P.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const t = i / (P.length - 1);
    const half = (w / 2) * Math.max(0.15, Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92)) ** 0.6);
    L.push([p[0] - (dy / l) * half, p[1] + (dx / l) * half]);
    R.push([p[0] + (dy / l) * half, p[1] - (dx / l) * half]);
  });
  g.fillStyle = EYE_INK;
  poly(g, [...L, ...R.reverse()]);
  g.fill();
}

/** Brows, drawn after the hat so the brim never hides them (as in the master drawing). */
export function drawFaceBrows(g: G, f: Face) {
  drawBrows(g, f);
}

/** Eye and brow ink of the master look: a warm near-black brown. */
const EYE_INK = '#1c0e07';
const BROW_FILL = '#3a2416';

/** Traced shapes are in units of the master's near eye-white height; this is that height in rig px. */
/**
 * The face is posed on two points the master and the rig share: the near eye and the nose tip.
 * The master's head is rolled clockwise (it looks down into the lens): the similarity that takes
 * its near-eye -> nose vector onto the rig's gives the roll to undo and the size, so the nose
 * outlines coincide and the far eye, brows and eye sizes follow the master's proportions.
 */
const NEAR_EYE = RIG.eyes.near.white;
const RIG_NOSE = (RIG as unknown as { nose: V2 }).nose;
const MASTER_ROLL =
  Math.atan2(MASTER_FACE.nose[1], MASTER_FACE.nose[0]) - Math.atan2(RIG_NOSE[1] - NEAR_EYE[1], RIG_NOSE[0] - NEAR_EYE[0]);
/** Rig px per traced unit (the master's near eye-white height). */
const FACE_UNIT = Math.hypot(RIG_NOSE[0] - NEAR_EYE[0], RIG_NOSE[1] - NEAR_EYE[1]) / Math.hypot(MASTER_FACE.nose[0], MASTER_FACE.nose[1]);
const unroll = ([x, y]: readonly [number, number]): V2 => {
  const c = Math.cos(-MASTER_ROLL);
  const s = Math.sin(-MASTER_ROLL);
  return [x * c - y * s, x * s + y * c];
};

interface EyeShape {
  /** Centre relative to the near eye's centre (traced units, upright). */
  centre: V2;
  width: number;
  height: number;
  /** Columns across the eye (upright): ink silhouette and white, top and bottom, relative to the centre. */
  silTop: V2[];
  silBot: V2[];
  whiteTop: V2[];
  whiteBot: V2[];
  pupil: { x: number; y: number; rx: number; ry: number };
  highlight: { x: number; y: number; r: number } | null;
  /** Ink thickness above the lid edge / below the white, per column (the side walls of the drawing capped). */
  lidInk: number[];
  rimInk: number[];
  /** The same, uncapped: the whole silhouette above / below the white (used while the eye is open). */
  lidInkFull: number[];
  rimInkFull: number[];
  /** The traced outlines themselves (upright, relative to the centre). */
  silhouette: V2[];
  white: V2[];
}

/** Per-column ink thickness, capped at 1.3x the median of the middle half (the eye's side walls are not lid). */
function inkBand(a: V2[], b: V2[]): number[] {
  const d = a.map((p, j) => Math.hypot(b[j][0] - p[0], b[j][1] - p[1]));
  const mid = d.slice(Math.floor(d.length / 4), Math.ceil((d.length * 3) / 4)).sort((x, y) => x - y);
  const cap = mid[Math.floor(mid.length / 2)] * 1.3;
  return d.map((v) => Math.min(v, cap));
}

interface TracedEye {
  silhouette: readonly (readonly [number, number])[];
  white: readonly (readonly [number, number])[];
  centre: readonly [number, number];
  width: number;
  height: number;
  pupil: { x: number; y: number; rx: number; ry: number };
  highlight: { x: number; y: number; r: number } | null;
  profile: { x: readonly number[]; silTop: readonly number[]; silBot: readonly number[]; whiteTop: readonly number[]; whiteBot: readonly number[] };
}

/** Top and bottom y of a closed curve at x (NaN where the curve does not reach). */
function crossings(curve: V2[], x: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < curve.length; i++) {
    const [x0, y0] = curve[i];
    const [x1, y1] = curve[(i + 1) % curve.length];
    if ((x0 - x) * (x1 - x) <= 0 && x0 !== x1) {
      const y = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  return lo === Infinity ? [NaN, NaN] : [lo, hi];
}

/**
 * Eye shapes, upright: the traced outlines are turned back by the master's head roll, then cut into
 * vertical columns HERE (not in the master's tilted frame), so the lids travel straight down on the
 * rig's head and a closed eye is a level arc.
 */
const EYES: Record<'near' | 'far', EyeShape> = (() => {
  const N = 81;
  const one = (e: TracedEye): EyeShape => {
    const c = unroll(e.centre);
    const rel = (p: readonly [number, number]): V2 => {
      const q = unroll(p);
      return [q[0] - c[0], q[1] - c[1]];
    };
    const sil = e.silhouette.map(rel);
    const white = e.white.map(rel);
    const xs0 = Math.min(...sil.map((p) => p[0])) + 0.002;
    const xs1 = Math.max(...sil.map((p) => p[0])) - 0.002;
    const xs = Array.from({ length: N }, (_, j) => (xs0 + xs1) / 2 - ((xs1 - xs0) / 2) * Math.cos((Math.PI * j) / (N - 1)));
    const S = xs.map((x) => crossings(sil, x));
    const W = xs.map((x) => crossings(white, x));
    // Where the white does not reach, both its edges sit on the line joining its two ends (inside the ink).
    const ok = W.map((w) => !Number.isNaN(w[0]));
    const first = ok.indexOf(true);
    const last = ok.lastIndexOf(true);
    const mid = (j: number) => (W[j][0] + W[j][1]) / 2;
    const closeAt = (j: number) => {
      const y = j < first ? mid(first) : j > last ? mid(last) : mid(j);
      return Math.min(Math.max(y, S[j][0]), S[j][1]);
    };
    const wt = W.map((w, j) => (ok[j] ? w[0] : closeAt(j)));
    const wb = W.map((w, j) => (ok[j] ? w[1] : closeAt(j)));
    const at = (ys: number[]): V2[] => xs.map((x, j) => [x, ys[j]]);
    const whiteTop = at(wt);
    const whiteBot = at(wb);
    const silTop = at(S.map((v) => v[0]));
    const silBot = at(S.map((v) => v[1]));
    const pc = rel([e.pupil.x, e.pupil.y]);
    const hl = e.highlight ? rel([e.highlight.x, e.highlight.y]) : null;
    const wy = white.map((p) => p[1]);
    const wx = white.map((p) => p[0]);
    return {
      centre: c,
      width: Math.max(...wx) - Math.min(...wx),
      height: Math.max(...wy) - Math.min(...wy),
      silTop,
      silBot,
      whiteTop,
      whiteBot,
      pupil: { x: pc[0], y: pc[1], rx: e.pupil.rx, ry: e.pupil.ry },
      highlight: hl && e.highlight ? { x: hl[0], y: hl[1], r: e.highlight.r } : null,
      lidInk: inkBand(whiteTop, silTop),
      rimInk: inkBand(whiteBot, silBot),
      lidInkFull: whiteTop.map((p, j) => Math.abs(silTop[j][1] - p[1])),
      rimInkFull: whiteBot.map((p, j) => Math.abs(silBot[j][1] - p[1])),
      silhouette: sil,
      white,
    };
  };
  return { near: one(MASTER_FACE.eyes.near as TracedEye), far: one(MASTER_FACE.eyes.far as TracedEye) };
})();

/** Where each eye is drawn (rig px): the near eye where the head was drawn for it, the far one at the master's spacing. */
function eyeCentre(side: 'near' | 'far', k: number): V2 {
  const n = RIG.eyes.near.white;
  if (side === 'near') return [n[0], n[1]];
  return [n[0] + EYES.far.centre[0] * k - farFit(k), n[1] + EYES.far.centre[1] * k];
}

const inside = (P: V2[], x: number, y: number) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if (P[i][1] > y !== P[j][1] > y && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  }
  return c;
};

/**
 * The rig's muzzle bridge sits further left than the master's, so at the master spacing the far eye
 * would stick out over the head outline. Slide it left (rig px) until its silhouette, grown by a few
 * px, is inside the head: it then touches the bridge as in the master drawing.
 */
const farFitCache = new Map<number, number>();
function farFit(k: number): number {
  const key = Math.round(k * 10);
  const hit = farFitCache.get(key);
  if (hit !== undefined) return hit;
  const clip = (RIG as unknown as { headClip?: V2[] }).headClip;
  let dx = 0;
  if (clip) {
    const n = RIG.eyes.near.white;
    const cx = n[0] + EYES.far.centre[0] * k;
    const cy = n[1] + EYES.far.centre[1] * k;
    const fits = (d: number) =>
      EYES.far.silhouette.every(([x, y]) => {
        const l = Math.hypot(x, y) || 1;
        return inside(clip, cx - d + x * k + (x / l) * 3, cy + y * k + (y / l) * 3);
      });
    while (dx < 200 && !fits(dx)) dx += 1;
  }
  farFitCache.set(key, dx);
  return dx;
}

const mix = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Closed smooth path through points: quadratic curves between edge midpoints (no facets). */
function poly(g: G, pts: V2[]) {
  const n = pts.length;
  const mid = (i: number): V2 => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2];
  g.beginPath();
  const m0 = mid(0);
  g.moveTo(m0[0], m0[1]);
  for (let i = 1; i <= n; i++) {
    const m = mid(i);
    g.quadraticCurveTo(pts[i % n][0], pts[i % n][1], m[0], m[1]);
  }
  g.closePath();
}

/**
 * Eyes traced from the master drawing (masterFace.ts, made by tools/trace_face.py), drawn from
 * column profiles so the lid is part of the eye: the upper lid edge slides from the top of the
 * white down to a closing curve near its bottom, bending with the eye; the heavy lid ink rides on
 * it with the master's thickness, the lower rim stays. Closed = the two ink bands meet in one arc.
 */
function drawEye(g: G, side: 'near' | 'far', i: number, f: Face) {
  const E = EYES[side];
  const k = FACE_UNIT * f.eyeScale;
  const [ex, ey] = eyeCentre(side, k);
  const w = E.width * k;
  const h = E.height * k;
  const at = (p: V2): V2 => [ex + p[0] * k, ey + p[1] * k];
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (f.happy || (f.wink && i === 0)) {
    // Happy: the lid line bends up into an arch.
    g.strokeStyle = EYE_INK;
    g.lineWidth = h * 0.09;
    g.beginPath();
    g.moveTo(ex - w * 0.5, ey + h * 0.1);
    g.quadraticCurveTo(ex, ey - h * 0.38, ex + w * 0.5, ey + h * 0.1);
    g.stroke();
    return;
  }
  // The traced heavy lid is the rest pose: the animated lid starts beyond the rig's resting value.
  const lid = Math.min(1, Math.max(0, (f.lid[i] - 0.1) / 0.9));
  const n = E.whiteTop.length;
  const tilt = f.lidTilt * faceTweak('lidTilt'); // inner corner lower when angry, higher when worried
  // 3/4 view: the inner corner (toward the nose bridge) is +x on the near eye, -x on the far eye.
  const inward = side === 'near' ? 1 : -1;
  const edge: V2[] = [];
  const bottom: V2[] = [];
  // Closing line: one gentle arc (convex down) from the outer corner to the inner corner, a little
  // below the middle of the eye. Both lids travel to it, so a closed eye is a single clean arc.
  const c0 = mix(E.whiteTop[0], E.whiteBot[0], 0.5);
  const c1 = mix(E.whiteTop[n - 1], E.whiteBot[n - 1], 0.5);
  const sag = E.height * 0.16;
  const lowLid = Math.pow(lid, 1.6) * 0.75 + f.squint * faceTweak('squint');
  for (let j = 0; j < n; j++) {
    const top = E.whiteTop[j];
    const bot = E.whiteBot[j];
    const u = j / (n - 1);
    const cy = c0[1] + (c1[1] - c0[1]) * u + sag * 4 * u * (1 - u);
    // Positions along this column (0 = top of the white, 1 = its bottom): the column is tilted once
    // the head is upright, so lids travel along it, not straight down.
    const span = bot[1] - top[1];
    const uc = span > 1e-6 ? Math.min(1, Math.max(0, (cy - top[1]) / span)) : 0.5;
    const t = ((inward * top[0]) / Math.max(1e-6, E.width)) * 2; // -1 outer .. +1 inner
    const ue = Math.min(1, Math.max(0, uc * lid + (span > 1e-6 ? (tilt * t * (1 - lid) * 0.6) / span : 0)));
    const ub = Math.max(ue, 1 - (1 - uc) * Math.min(1, lid >= 0.98 ? 1 : lowLid));
    edge.push(mix(top, bot, ue));
    bottom.push(mix(top, bot, ub));
  }
  // Everything is drawn from the exact traced outlines (smooth, true side walls); the lids only
  // decide which part shows. Ink: the silhouette between (lid edge - lid ink) and (bottom + rim ink);
  // white: the white between the lid edge and the bottom. Above and below that is the head's fur.
  const strip = (top: V2[], bot: V2[]) => {
    const T = top.map(at);
    const B = bot.map(at);
    // Widen the two ends a little so the strip never cuts the outline's own tips.
    // (the side walls of the drawing belong to the open eye: they fade out as the lids close)
    const ext = w * 0.2 * Math.max(0, 1 - lid * 1.6);
    const wide = (P: V2[]) => [[P[0][0] - ext, P[0][1]] as V2, ...P, [P[P.length - 1][0] + ext, P[P.length - 1][1]] as V2];
    const t = wide(T);
    const bb = wide(B);
    g.beginPath();
    g.moveTo(t[0][0], t[0][1]);
    for (const q of t) g.lineTo(q[0], q[1]);
    for (let j = bb.length - 1; j >= 0; j--) g.lineTo(bb[j][0], bb[j][1]);
    g.closePath();
  };
  // Open: the whole silhouette shows; as the lids move, the ink above/below eases to the lid's own
  // thickness. Offsets run along each traced column (columns are tilted once the head is turned upright).
  const along = (from: V2, to: V2, len: number): V2 => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const d = Math.hypot(dx, dy) || 1;
    return [(dx / d) * len, (dy / d) * len];
  };
  const lidTop = edge.map((ed, j): V2 => {
    const len = E.lidInkFull[j] + (E.lidInk[j] * (1 - lid * 0.25) - E.lidInkFull[j]) * Math.min(1, lid * 3);
    const v = along(E.whiteTop[j], E.silTop[j], len);
    return [ed[0] + v[0], ed[1] + v[1]];
  });
  const lowAmt = Math.min(1, (lid >= 0.98 ? 1 : lowLid) * 3);
  const rimBot = bottom.map((b, j): V2 => {
    const len = E.rimInkFull[j] + (E.rimInk[j] - E.rimInkFull[j]) * lowAmt;
    const v = along(E.whiteBot[j], E.silBot[j], len);
    return [b[0] + v[0], b[1] + v[1]];
  });
  g.save();
  strip(lidTop, rimBot);
  g.clip();
  g.fillStyle = EYE_INK;
  poly(g, E.silhouette.map(at));
  g.fill();
  g.restore();
  if (lid < 0.98) {
    g.save();
    strip(edge, bottom);
    g.clip();
    poly(g, E.white.map(at));
    g.clip();
    const sg = g.createLinearGradient(0, ey - h / 2, 0, ey + h / 2);
    sg.addColorStop(0, '#d2ccc6');
    sg.addColorStop(0.3, '#ffffff');
    sg.addColorStop(1, '#fdfbf8');
    g.fillStyle = sg;
    g.fillRect(ex - w, ey - h, w * 2, h * 2);
    const pr = E.pupil.rx * k * f.pupil;
    const pry = E.pupil.ry * k * f.pupil;
    const px = ex + f.lookX * (w / 2 - pr) * 0.85;
    const py = ey + h * 0.06 + f.lookY * (h / 2 - pry) * 0.7;
    g.fillStyle = '#2a160b';
    g.beginPath();
    g.ellipse(px, py, pr, pry, 0, 0, Math.PI * 2);
    g.fill();
    if (E.highlight) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(px + (E.highlight.x - E.pupil.x) * k, py + (E.highlight.y - E.pupil.y) * k, E.highlight.r * k, 0, Math.PI * 2);
      g.fill();
    }
    // Soft shadow of the lid on the eyeball, following the lid edge.
    const lidEdge = edge.map(at);
    const sh = g.createLinearGradient(0, Math.min(...lidEdge.map((q) => q[1])), 0, Math.min(...lidEdge.map((q) => q[1])) + h * 0.35);
    sh.addColorStop(0, 'rgba(60, 30, 15, 0.18)');
    sh.addColorStop(1, 'rgba(60, 30, 15, 0)');
    g.fillStyle = sh;
    g.fillRect(ex - w, ey - h, w * 2, h * 2);
    g.restore();
  }
}

/**
 * Brows traced from the master drawing: the near one long and arched with a dropping tip, the far
 * one short and slanted. Moods bend them: raise lifts the whole brow, angry pulls the inner end
 * (+x, toward the nose) down, worry lifts it, skeptic raises one and lowers the other.
 */
const BROWS: Record<'near' | 'far', V2[]> = {
  near: MASTER_FACE.brows.near.map((p) => unroll(p)).map((q): V2 => [q[0] - EYES.near.centre[0], q[1] - EYES.near.centre[1]]),
  far: MASTER_FACE.brows.far.map((p) => unroll(p)).map((q): V2 => [q[0] - EYES.far.centre[0], q[1] - EYES.far.centre[1]]),
};

function drawBrows(g: G, f: Face) {
  const { raise, worry, angry, skeptic } = f.brows;
  (['near', 'far'] as const).forEach((side, i) => {
    const pts = BROWS[side];
    const k = FACE_UNIT * f.eyeScale;
    const [ex, ey] = eyeCentre(side, k);
    const xs = pts.map((p) => p[0]);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const skw = faceTweak('browSkeptic');
    const sk = i === 1 ? -skeptic * skw : skeptic * skw * 0.4;
    const lift = -raise * faceTweak('browRaise') + sk;
    const inner = angry * faceTweak('browAngry') - worry * faceTweak('browWorry');
    const outer = -angry * 0.05 + worry * 0.06;
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const map = (p: V2, inset: boolean): V2 => {
      const x = inset ? cx + (p[0] - cx) * 0.9 : p[0];
      const y = inset ? cy + (p[1] - cy) * 0.62 : p[1];
      // 0 outer end .. 1 inner end (toward the nose bridge: +x on the near brow, -x on the far one)
      const t = side === 'near' ? (p[0] - xMin) / Math.max(1e-6, xMax - xMin) : (xMax - p[0]) / Math.max(1e-6, xMax - xMin);
      return [ex + x * k, ey + (y + lift + outer * (1 - t) + inner * t) * k];
    };
    g.fillStyle = EYE_INK;
    poly(g, pts.map((p) => map(p, false)));
    g.fill();
    // Dark-brown fill inside the ink outline.
    g.fillStyle = BROW_FILL;
    poly(g, pts.map((p) => map(p, true)));
    g.fill();
  });
}
