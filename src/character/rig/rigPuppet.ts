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
export function noodle(g: G, name: string, a: V2, c: V2, b: V2, from = 0, to = 1): number {
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
    // Quad edges, perpendicular to the tangent (texture x grows to the right of the direction).
    const L0: V2 = [c0[0] + d0[1] * cx, c0[1] - d0[0] * cx];
    const R0: V2 = [c0[0] - d0[1] * (w - cx), c0[1] + d0[0] * (w - cx)];
    const L1: V2 = [c1[0] + d1[1] * cx, c1[1] - d1[0] * cx];
    const R1: V2 = [c1[0] - d1[1] * (w - cx), c1[1] + d1[0] * (w - cx)];
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
export function hoseControl(a: V2, b: V2, L: number, side: number): { c: V2; stretch: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy) || 1;
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

const INK = '#170d07';

function fur(k = 1) {
  const [r, g_, b] = RIG.furColor;
  return `rgb(${Math.round(r * k)}, ${Math.round(g_ * k)}, ${Math.round(b * k)})`;
}

export function drawFace(g: G, f: Face) {
  placed(g, `mouth_${f.mouth}`);
  (['near', 'far'] as const).forEach((side, i) => drawEye(g, side, i, f));
  drawBrows(g, f);
}

function drawEye(g: G, side: 'near' | 'far', i: number, f: Face) {
  const e = RIG.eyes[side];
  const [cx, cy0] = e.white;
  // Master look (art/reference/agent-fox-master.png): smaller upright ovals with a fine rim,
  // a solid round pupil and a round catch-light (the old pie-cut eye had a heavy ink rim and a wedge).
  const rx = e.rx * 0.76 * f.eyeScale;
  const ry = e.ry * 0.98 * f.eyeScale;
  const cy = cy0 - e.ry * 0.1;
  const lw = Math.max(4, e.rx * 0.13);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (f.happy || (f.wink && i === 0)) {
    // Happy closed eye: a thick upward arc.
    g.strokeStyle = INK;
    g.lineWidth = lw * 1.3;
    g.beginPath();
    g.moveTo(cx - rx * 0.9, cy + ry * 0.2);
    g.quadraticCurveTo(cx, cy - ry * 0.75, cx + rx * 0.9, cy + ry * 0.2);
    g.stroke();
    return;
  }
  const lid = Math.min(1, f.lid[i]);
  if (lid > 0.88) {
    // Closed: fur lid with a thick lash arc.
    g.fillStyle = fur(0.96);
    g.beginPath();
    g.ellipse(cx, cy, rx + lw * 0.6, ry + lw * 0.6, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = lw * 1.3;
    g.beginPath();
    g.moveTo(cx - rx * 0.95, cy + ry * 0.05);
    g.quadraticCurveTo(cx, cy + ry * 0.6, cx + rx * 0.95, cy + ry * 0.05);
    g.stroke();
    g.lineWidth = lw * 0.6;
    g.beginPath();
    g.moveTo(cx + rx * 0.8, cy + ry * 0.12);
    g.lineTo(cx + rx * 1.1, cy - ry * 0.05);
    g.stroke();
    return;
  }
  // White with a fine ink rim.
  g.fillStyle = INK;
  g.beginPath();
  g.ellipse(cx, cy, rx + lw * 0.3, ry + lw * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  const sg = g.createLinearGradient(0, cy - ry, 0, cy + ry);
  sg.addColorStop(0, '#ece6dc');
  sg.addColorStop(0.3, '#ffffff');
  sg.addColorStop(1, '#fbf8f1');
  g.fillStyle = sg;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.clip();
  // Solid pupil with a round catch-light (upper right) and a small second one.
  const px = cx + f.lookX * rx * 0.4 + rx * 0.06;
  const py = cy + f.lookY * ry * 0.3 + ry * 0.08;
  const pr = rx * 0.62 * f.pupil;
  const pry = ry * 0.64 * f.pupil;
  g.fillStyle = '#120a06';
  g.beginPath();
  g.ellipse(px, py, pr, pry, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(px + pr * 0.32, py - pry * 0.38, pr * 0.3, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(px - pr * 0.3, py + pry * 0.38, pr * 0.12, 0, Math.PI * 2);
  g.fill();
  // Upper lid (fur) with a lash line; tilted for moods. Inner corner is +x.
  const tilt = f.lidTilt * ry * 0.5;
  if (lid > 0.02 || Math.abs(tilt) > 0.5) {
    const base = cy - ry - 3 + (ry * 2 + 6) * lid;
    const yl = base - tilt;
    const yr = base + tilt;
    const ctrl = (yl + yr) / 2 + ry * 0.16;
    g.fillStyle = fur();
    g.beginPath();
    g.moveTo(cx - rx - 8, cy - ry - 20);
    g.lineTo(cx + rx + 8, cy - ry - 20);
    g.lineTo(cx + rx + 8, yr);
    g.quadraticCurveTo(cx, ctrl, cx - rx - 8, yl);
    g.closePath();
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = lw * 0.95;
    g.beginPath();
    g.moveTo(cx - rx - 8, yl);
    g.quadraticCurveTo(cx, ctrl, cx + rx + 8, yr);
    g.stroke();
  }
  if (f.squint > 0.02) {
    const yb = cy + ry + 3 - ry * 0.7 * f.squint;
    g.fillStyle = fur(1.03);
    g.beginPath();
    g.moveTo(cx - rx - 8, cy + ry + 20);
    g.lineTo(cx + rx + 8, cy + ry + 20);
    g.lineTo(cx + rx + 8, yb);
    g.quadraticCurveTo(cx, yb - ry * 0.2, cx - rx - 8, yb);
    g.closePath();
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = lw * 0.7;
    g.beginPath();
    g.moveTo(cx - rx - 8, yb);
    g.quadraticCurveTo(cx, yb - ry * 0.2, cx + rx + 8, yb);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = INK;
  g.lineWidth = lw * 0.7;
  g.beginPath();
  g.ellipse(cx, cy, rx + lw * 0.15, ry + lw * 0.15, 0, 0, Math.PI * 2);
  g.stroke();
}

function taper(g: G, a: V2, c: V2, b: V2, w: number) {
  const N = 18;
  const L: V2[] = [];
  const R: V2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    const x = mt * mt * a[0] + 2 * mt * t * c[0] + t * t * b[0];
    const y = mt * mt * a[1] + 2 * mt * t * c[1] + t * t * b[1];
    const dx = 2 * mt * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
    const dy = 2 * mt * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
    const l = Math.hypot(dx, dy) || 1;
    const half = (w / 2) * Math.max(0.25, Math.pow(Math.sin(Math.PI * (0.12 + t * 0.8)), 0.55));
    L.push([x - (dy / l) * half, y + (dx / l) * half]);
    R.push([x + (dy / l) * half, y - (dx / l) * half]);
  }
  g.beginPath();
  g.moveTo(L[0][0], L[0][1]);
  for (const p of L) g.lineTo(p[0], p[1]);
  for (const p of R.reverse()) g.lineTo(p[0], p[1]);
  g.closePath();
}

function drawBrows(g: G, f: Face) {
  const { raise, worry, angry, skeptic } = f.brows;
  (['near', 'far'] as const).forEach((side, i) => {
    const e = RIG.eyes[side];
    const [cx, cy] = e.white;
    const w = e.rx * 2.1;
    const h = e.ry;
    const y0 = cy - e.ry * 1.5 - raise * h * 0.3;
    const innerDy = (angry * 0.42 - worry * 0.42) * h;
    const outerDy = (-angry * 0.08 + worry * 0.16) * h;
    const sk = i === 1 ? -skeptic * h * 0.35 : skeptic * h * 0.12;
    const a: V2 = [cx - w * 0.5, y0 + outerDy + sk + h * 0.1];
    const c: V2 = [cx - w * 0.02, y0 - h * 0.22 + (innerDy + outerDy) * 0.3 + sk];
    const b: V2 = [cx + w * 0.5, y0 + innerDy + sk];
    taper(g, a, c, b, e.rx * 0.46);
    g.fillStyle = INK;
    g.fill();
  });
}
