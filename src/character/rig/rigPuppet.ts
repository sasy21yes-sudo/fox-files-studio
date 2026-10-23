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
import faceLayoutJson from './faceLayout.json';
import { makeFaceRig, inside, poly, EYE_INK, type EyeShape, type Face, type TracedFace } from './faceRig';

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

/** A baked-in-place part drawn again inside a polygon (rig px): e.g. an ear over the hat. */
export function placedClip(g: G, name: string, poly: readonly V2[]) {
  const p = RIG.parts[name];
  const img = images[name];
  if (!img) return;
  g.save();
  g.beginPath();
  g.moveTo(poly[0][0], poly[0][1]);
  for (const q of poly) g.lineTo(q[0], q[1]);
  g.closePath();
  g.clip();
  g.drawImage(img, p.x, p.y);
  g.restore();
}

/**
 * The hat as worn (master look): the brim bends DOWN at the front and curls UP at the back, the crown
 * stays as drawn. Vertical strips of the brim's two ends turn in a chain around the brim line, a little
 * more each, so it curves instead of folding. droop/curl in radians at the tips; 0, 0 = the flat hat.
 * front/back: where the bend starts (fractions of the width from the back edge); lineY: the brim line
 * (fraction of the height).
 */
export function placedHatBend(g: G, name: string, droop: number, curl: number, front = 0.8, back = 0.21, lineY = 0.82) {
  const p = RIG.parts[name];
  const img = images[name];
  if (!img) return;
  if (Math.abs(droop) < 0.003 && Math.abs(curl) < 0.003) {
    g.drawImage(img, p.x, p.y);
    return;
  }
  const W = img.width;
  const H = img.height;
  const xf = p.x + W * front;
  const xb = p.x + W * back;
  const ly = p.y + H * lineY;
  const strip = (sx: number, w: number, cx: number, cy: number, a: number, fromX: number) => {
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    g.translate(-fromX, -ly);
    g.beginPath();
    g.rect(sx, p.y - H, w, H * 3);
    g.clip();
    g.drawImage(img, p.x, p.y);
    g.restore();
  };
  // Middle (the crown and the brim under it): unchanged, a little wider than the bent ends so the
  // first strips' turn never opens a wedge of background between them.
  g.save();
  g.beginPath();
  g.rect(xb - 3, p.y - H, xf - xb + 6, H * 3);
  g.clip();
  g.drawImage(img, p.x, p.y);
  g.restore();
  const N = 12;
  // Front: strips rightwards, each turned a little more (down).
  let cx = xf;
  let cy = ly;
  const fs = (p.x + W - xf) / N;
  for (let i = 0; i < N; i++) {
    const a = (droop * (i + 1)) / N;
    const sx = xf + i * fs;
    strip(sx - 0.6, fs + 4, cx, cy, a, sx);
    cx += Math.cos(a) * fs;
    cy += Math.sin(a) * fs;
  }
  // Back: strips leftwards, each turned a little more (up).
  cx = xb;
  cy = ly;
  const bs = (xb - p.x) / N;
  for (let i = 0; i < N; i++) {
    const a = (curl * (i + 1)) / N;
    const sx = xb - (i + 1) * bs;
    strip(sx - 4, bs + 4.6, cx, cy, a, sx + bs);
    cx -= Math.cos(a) * bs;
    cy -= Math.sin(a) * bs;
  }
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

export type { Face, MouthId } from './faceRig';

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
  (['near', 'far'] as const).forEach((side, i) => SIDE_FACE.drawEye(g, side, i, f));
  drawUnderline(g, f);
  g.restore();
}

/**
 * The cheek tuft on the far side (master look): a spike of fur sticking out of the head's outline where
 * the forehead meets the snout bridge, right of the far eye. Fur-coloured, inked only outside the head,
 * so it grows out of the outline. Its shape is set in the eye editor (faceLayout.json "tuft", rig px).
 */
export function drawCheekTuft(g: G) {
  const P = cheekTuft();
  const clip = (RIG as unknown as { headClip?: V2[] }).headClip;
  if (P.length < 3) return;
  const path = () => {
    g.beginPath();
    g.moveTo(P[0][0], P[0][1]);
    for (const q of P) g.lineTo(q[0], q[1]);
    g.closePath();
  };
  g.save();
  g.lineJoin = 'round';
  if (clip) {
    // Ink only outside the head: everything but the head's inside (even-odd).
    g.beginPath();
    g.rect(-1e5, -1e5, 2e5, 2e5);
    g.moveTo(clip[0][0], clip[0][1]);
    for (const q of clip) g.lineTo(q[0], q[1]);
    g.closePath();
    g.clip('evenodd');
  }
  path();
  g.strokeStyle = EYE_INK;
  g.lineWidth = TUFT_INK * 2;
  g.stroke();
  g.restore();
  const [r, gg, b] = RIG.furColor;
  g.fillStyle = `rgb(${Math.round(r * TUFT_SHADE)}, ${Math.round(gg * TUFT_SHADE)}, ${Math.round(b * TUFT_SHADE)})`;
  path();
  g.fill();
}
/** Half the tuft's outline width (rig px, like the head's own outline) and its fur colour vs the base fur. */
const TUFT_INK = 4.5;
const TUFT_SHADE = 0.96;
/** Default tuft (face units): its height above the muzzle line's end, how far it juts out, its tip's lift. */
const TUFT_H = 0.5;
const TUFT_REACH = 0.24;
const TUFT_TIP_UP = 0.03;

/** The tuft as set in the eye editor, else one shaped like the master's, grown from the head's outline. */
let TUFT: V2[] | null = null;
function cheekTuft(): V2[] {
  if (TUFT) return TUFT;
  if (FACE_LAYOUT.tuft?.length) return (TUFT = FACE_LAYOUT.tuft.map((p): V2 => [p[0], p[1]]));
  const clip = (RIG as unknown as { headClip?: V2[] }).headClip;
  const k = FACE_UNIT;
  const c = SIDE_FACE.centre('far', k);
  // Where the head's outline is at a height (the first crossing right of the eye).
  const edgeAt = (y: number): number => {
    let best = Infinity;
    if (clip)
      for (let i = 0; i < clip.length; i++) {
        const [x0, y0] = clip[i];
        const [x1, y1] = clip[(i + 1) % clip.length];
        if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) {
          const x = x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
          if (x > c[0] && x < best) best = x;
        }
      }
    return Number.isFinite(best) ? best : c[0] + 0.3 * k;
  };
  // As in the master: a wedge of fur whose lower edge is the line under the far eye (the muzzle line):
  // it leaves the outline under the eye, juts out to a point and comes back to that line's end.
  const ul = underlinePoints().map(([x, y]): V2 => [c[0] + x * k, c[1] + y * k]);
  const end = ul.length ? ul.reduce((a, p) => (p[0] > a[0] ? p : a)) : ([edgeAt(c[1] + 0.5 * k), c[1] + 0.5 * k] as V2);
  const B: V2 = [Math.min(end[0], edgeAt(end[1])) - 4, end[1]];
  const ay = end[1] - TUFT_H * k;
  const A: V2 = [edgeAt(ay) - 8, ay];
  const T: V2 = [Math.max(A[0], B[0]) + TUFT_REACH * k, end[1] - TUFT_TIP_UP * k];
  const mid = (a: V2, b: V2, t: number, bow: number): V2 => {
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [x + ((b[1] - a[1]) / l) * bow, y - ((b[0] - a[0]) / l) * bow];
  };
  // Slightly concave sides (a flick of fur); the inner side closes over the head.
  const inner: V2 = [Math.min(A[0], B[0]) - 0.12 * k, (A[1] + B[1]) / 2];
  return (TUFT = [A, mid(A, T, 0.5, -0.03 * k), T, mid(T, B, 0.5, -0.025 * k), B, inner]);
}

/** Brows, drawn after the hat so the brim never hides them (as in the master drawing). */
export function drawFaceBrows(g: G, f: Face) {
  SIDE_FACE.drawBrows(g, f);
}

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

/**
 * The rig's muzzle bridge sits further left than the master's, so at the master spacing the far eye
 * would stick out over the head outline. Slide it left (rig px) until its silhouette, grown by a few
 * px, is inside the head: it then touches the bridge as in the master drawing.
 */
const farFitCache = new Map<number, number>();
function farFit(k: number, far: EyeShape): number {
  const key = Math.round(k * 10);
  const hit = farFitCache.get(key);
  if (hit !== undefined) return hit;
  const clip = (RIG as unknown as { headClip?: V2[] }).headClip;
  let dx = 0;
  if (clip) {
    const n = RIG.eyes.near.white;
    const cx = n[0] + far.centre[0] * k;
    const cy = n[1] + far.centre[1] * k;
    const fits = (d: number) =>
      far.silhouette.every(([x, y]) => {
        const l = Math.hypot(x, y) || 1;
        return inside(clip, cx - d + x * k + (x / l) * 3, cy + y * k + (y / l) * 3);
      });
    while (dx < 200 && !fits(dx)) dx += 1;
  }
  farFitCache.set(key, dx);
  return dx;
}

/** Eyes and brows traced from the master drawing (masterFace.ts, made by tools/trace_face.py). */
const SIDE_FACE = makeFaceRig({
  closeStyle: 'wrap',
  traced: MASTER_FACE as unknown as TracedFace,
  roll: MASTER_ROLL,
  unit: FACE_UNIT,
  // The near eye where the head was drawn for it, the far one at the master's spacing; each moved by
  // the offset set in the eye editor (tracer.html?part=eyes, faceLayout.json; brows follow).
  centre: (side, k, eyes) => {
    const n = RIG.eyes.near.white;
    const o = side === 'near' ? FACE_LAYOUT.nearOffset : FACE_LAYOUT.farOffset;
    if (side === 'near') return [n[0] + o[0], n[1] + o[1]];
    return [n[0] + eyes.far.centre[0] * k - farFit(k, eyes.far) + o[0], n[1] + eyes.far.centre[1] * k + o[1]];
  },
});

/** Eye positions and the muzzle line as set in the eye editor (rig px offsets; the line in face units from the far eye). */
const FACE_LAYOUT = faceLayoutJson as unknown as {
  nearOffset: [number, number];
  farOffset: [number, number];
  underline: [number, number][] | null;
  tuft?: [number, number][] | null;
};

/** For the eye editor: where the eyes and the muzzle line are now on the rig (rig px, at eyeScale 1). */
export function faceLayout() {
  const k = FACE_UNIT;
  const at = (side: 'near' | 'far') => {
    const c = SIDE_FACE.centre(side, k);
    return { centre: c, outline: SIDE_FACE.eyes[side].silhouette.map(([x, y]): V2 => [c[0] + x * k, c[1] + y * k]) };
  };
  const far = at('far');
  const line = underlinePoints().map(([x, y]): V2 => [far.centre[0] + x * k, far.centre[1] + y * k]);
  return { near: at('near'), far, underline: line, tuft: cheekTuft(), unit: k, offsets: { near: FACE_LAYOUT.nearOffset, far: FACE_LAYOUT.farOffset } };
}

/** The line under the far eye (traced from the master): a tapered ink stroke that moves with the eye. */
let UNDERLINE: V2[] | null = null;
/** The muzzle line in face units from the far eye: the eye editor's, else the master's trace. */
function underlinePoints(): V2[] {
  UNDERLINE ??=
    FACE_LAYOUT.underline?.map((p): V2 => [p[0], p[1]]) ??
    ((MASTER_FACE as unknown as { underline?: [number, number][] }).underline ?? []).map((p): V2 => {
      const q = SIDE_FACE.unroll(p);
      return [q[0] - SIDE_FACE.eyes.far.centre[0], q[1] - SIDE_FACE.eyes.far.centre[1]];
    });
  return UNDERLINE;
}
function drawUnderline(g: G, f: Face) {
  const UL = underlinePoints();
  if (UL.length < 2) return;
  const k = FACE_UNIT * f.eyeScale;
  const [ex, ey] = SIDE_FACE.centre('far', k);
  const P = UL.map(([x, y]): V2 => [ex + x * k, ey + y * k]);
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
