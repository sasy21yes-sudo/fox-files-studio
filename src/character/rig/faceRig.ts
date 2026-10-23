/**
 * Traced eyes and brows, shared by the side rig (masterFace.ts) and the front rig (frontFace.ts).
 * Both traces come from tools/trace_face.py: outlines in units of the near eye-white height, relative
 * to the near eye's centre. A FaceRig turns them upright (undoing the drawing's head roll), cuts the
 * eyes into columns and draws them with lids, pupils and moods; the caller says where the eyes sit.
 */
import { face as faceTweak } from './tweaks';

type G = CanvasRenderingContext2D;
type V2 = [number, number];
type P = readonly [number, number];

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

export type Side = 'near' | 'far';

export interface TracedEye {
  silhouette: readonly P[];
  white: readonly P[];
  centre: P;
  width: number;
  height: number;
  pupil: { x: number; y: number; rx: number; ry: number };
  highlight: { x: number; y: number; r: number } | null;
}

export interface TracedFace {
  eyes: { near: TracedEye; far: TracedEye };
  brows: { near: readonly P[]; far: readonly P[] };
}

export interface EyeShape {
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

export interface FaceRigConfig {
  traced: TracedFace;
  /** The drawing's head roll (radians): traced points are turned back by it. */
  roll: number;
  /** Px per traced unit at eyeScale 1. */
  unit: number;
  /** Where an eye's centre is drawn (px) at k px per unit. */
  centre(side: Side, k: number, eyes: Record<Side, EyeShape>): V2;
  /** Share of the skeptic raise the near brow takes (the far one takes all of it, the other way). */
  skepticNear?: number;
  /**
   * How a closed eye lies. 'level' (front view): one nearly level arc across the eye. 'wrap' (3/4 view):
   * the upper lid comes all the way down onto the eye's lower outline; closed, the ink lies along its
   * lower-right stretch (under the middle, round the corner and up the right side).
   */
  closeStyle?: 'level' | 'wrap';
}

export interface FaceRig {
  eyes: Record<Side, EyeShape>;
  /** Turn a traced point upright. */
  unroll(p: P): V2;
  centre(side: Side, k: number): V2;
  drawEye(g: G, side: Side, i: number, f: Face): void;
  drawBrows(g: G, f: Face): void;
}

/** 'wrap' closing: the closed line starts this much of the eye's width before its lowest point and runs to its right end. */
const CLOSE_BEFORE_LOW = 0.25;
const CLOSE_FROM_FAR = 0.08;
/** ...up to this far below the eye's centre (share of its height). */
const CLOSE_TOP = 0.18;
const CLOSE_TOP_FAR = 0.3;

/** Eye and brow ink of the master look: a warm near-black brown. */
export const EYE_INK = '#1c0e07';
const BROW_FILL = '#3a2416';

/** Per-column ink thickness, capped at 1.3x the median of the middle half (the eye's side walls are not lid). */
function inkBand(a: V2[], b: V2[]): number[] {
  const d = a.map((p, j) => Math.hypot(b[j][0] - p[0], b[j][1] - p[1]));
  const mid = d.slice(Math.floor(d.length / 4), Math.ceil((d.length * 3) / 4)).sort((x, y) => x - y);
  const cap = mid[Math.floor(mid.length / 2)] * 1.3;
  return d.map((v) => Math.min(v, cap));
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

export const inside = (P: V2[], x: number, y: number) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if (P[i][1] > y !== P[j][1] > y && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  }
  return c;
};

const mix = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Closed smooth path through points: quadratic curves between edge midpoints (no facets). */
export function poly(g: G, pts: V2[]) {
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

export function makeFaceRig(cfg: FaceRigConfig): FaceRig {
  const unroll = ([x, y]: P): V2 => {
    const c = Math.cos(-cfg.roll);
    const s = Math.sin(-cfg.roll);
    return [x * c - y * s, x * s + y * c];
  };

  /**
   * Eye shapes, upright: the traced outlines are turned back by the drawing's head roll, then cut into
   * vertical columns HERE (not in the drawing's tilted frame), so the lids travel straight down on the
   * rig's head and a closed eye is a level arc.
   */
  const N = 81;
  const one = (e: TracedEye): EyeShape => {
    const c = unroll(e.centre);
    const rel = (p: P): V2 => {
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
  const EYES: Record<Side, EyeShape> = { near: one(cfg.traced.eyes.near), far: one(cfg.traced.eyes.far) };
  /**
   * 3/4: each eye leans (its long axis is not vertical). The lid closes along that axis, not straight
   * down the screen: the eye is cut into columns in its own upright frame (EYES_UP, turned by -TILT) and
   * drawn turned back by TILT.
   */
  const tiltOf = (E: EyeShape): number => {
    const P = E.silhouette;
    const mx = P.reduce((a, p) => a + p[0], 0) / P.length;
    const my = P.reduce((a, p) => a + p[1], 0) / P.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of P) {
      sxx += (x - mx) ** 2;
      syy += (y - my) ** 2;
      sxy += (x - mx) * (y - my);
    }
    const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy); // long axis, from +x
    let t = phi - Math.PI / 2;
    while (t > Math.PI / 2) t -= Math.PI;
    while (t < -Math.PI / 2) t += Math.PI;
    return t;
  };
  const turnTraced = (e: TracedEye, a: number): TracedEye => {
    const c = Math.cos(a);
    const s_ = Math.sin(a);
    const r = (p: P): [number, number] => {
      const dx = p[0] - e.centre[0];
      const dy = p[1] - e.centre[1];
      return [e.centre[0] + dx * c - dy * s_, e.centre[1] + dx * s_ + dy * c];
    };
    const pp = r([e.pupil.x, e.pupil.y]);
    const hp = e.highlight ? r([e.highlight.x, e.highlight.y]) : null;
    return {
      ...e,
      silhouette: e.silhouette.map(r),
      white: e.white.map(r),
      pupil: { ...e.pupil, x: pp[0], y: pp[1] },
      highlight: e.highlight && hp ? { ...e.highlight, x: hp[0], y: hp[1] } : null,
    };
  };
  const TILT: Record<Side, number> = { near: 0, far: 0 };
  const EYES_UP: Record<Side, EyeShape> = { ...EYES };
  if (cfg.closeStyle === 'wrap') {
    for (const sd of ['near', 'far'] as const) {
      TILT[sd] = tiltOf(EYES[sd]);
      EYES_UP[sd] = one(turnTraced(cfg.traced.eyes[sd], -TILT[sd]));
    }
  }
  const centre = (side: Side, k: number) => cfg.centre(side, k, EYES);

  /**
   * Eyes: the traced drawing seen through a window between the two lids. The upper lid slides from the
   * top of the outline down to a closing arc, the lower one rises a little to meet it; each carries a
   * tapered ink band. Closed = one clean ink arc.
   */
  function drawEye(g: G, side: Side, i: number, f: Face) {
    let E = EYES[side];
    const k = cfg.unit * f.eyeScale;
    const [ex, ey] = centre(side, k);
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
    const wrap = cfg.closeStyle === 'wrap';
    // 3/4: work in the eye's own upright frame (see EYES_UP), turned back on the canvas.
    const th = wrap ? TILT[side] : 0;
    if (wrap) E = EYES_UP[side];
    g.save();
    if (th) {
      g.translate(ex, ey);
      g.rotate(th);
      g.translate(-ex, -ey);
    }
    // The traced heavy lid is the rest pose: the animated lid starts beyond the rig's resting value.
    const lid = Math.min(1, Math.max(0, (f.lid[i] - 0.1) / 0.9));
    const n = E.silTop.length;
    const tilt = f.lidTilt * faceTweak('lidTilt'); // inner corner lower when angry, higher when worried
    // The inner corner (toward the nose) is +x on the near eye, -x on the far eye.
    const inward = side === 'near' ? 1 : -1;
    // (3/4: the eye closes down onto its own lower outline, the lower lid stays put)
    const lowLid = Math.min(1, (wrap ? 0 : Math.pow(lid, 1.6) * 0.75) + f.squint * faceTweak('squint'));
    // Closing line: one gentle arc (convex down) across the eye, from the middle of its outer end to the
    // middle of its inner end. Both lids travel to it, so a closed eye is a single clean arc whatever
    // the eye's shape (the narrow, tilted far eye included).
    const m0 = mix(E.silTop[0], E.silBot[0], 0.5);
    const m1 = mix(E.silTop[n - 1], E.silBot[n - 1], 0.5);
    // Nearly level, even on a tilted eye (a closed eye reads as a resting line, not a slash).
    const lvl = (m0[1] + m1[1]) / 2;
    const c0: V2 = [m0[0], lvl + (m0[1] - lvl) * 0.3];
    const c1: V2 = [m1[0], lvl + (m1[1] - lvl) * 0.3];
    const sag = E.height * 0.14;
    const close: V2[] = [];
    const edge: V2[] = [];
    const bottom: V2[] = [];
    for (let j = 0; j < n; j++) {
      const u = j / (n - 1);
      const x = E.silTop[j][0];
      // (3/4: the closing line is the eye's own lower outline)
      const cy = wrap
        ? E.silBot[j][1]
        : Math.min(E.silBot[j][1], Math.max(E.silTop[j][1], c0[1] + (c1[1] - c0[1]) * u + sag * 4 * u * (1 - u)));
      const t = ((inward * x) / Math.max(1e-6, E.width)) * 2; // -1 outer .. +1 inner
      const top = E.silTop[j][1] + tilt * t * 0.3 * E.height * (1 - lid);
      const ye = wrap ? top + (cy - top) * lid : Math.min(cy, Math.max(E.silTop[j][1], top + (cy - top) * lid));
      const yb = Math.max(ye, E.silBot[j][1] + (cy - E.silBot[j][1]) * (lid >= 0.98 ? 1 : lowLid));
      close.push([x, cy]);
      edge.push([x, ye]);
      bottom.push([x, yb]);
    }
    // The eye as drawn (ink silhouette, white, pupil), clipped between the two lids: above and below
    // them is the head's fur. The lids are not columns of the drawing but a window over it, so the
    // drawing never breaks into stubs or tilts as it closes.
    const lidThick = (E.lidInk[Math.floor(n / 2)] || E.height * 0.08) * k;
    const rimThick = (E.rimInk[Math.floor(n / 2)] || E.height * 0.05) * k;
    if (lid < 0.98) {
      g.save();
      g.beginPath();
      const T = edge.map(at);
      const B = bottom.map(at);
      g.moveTo(T[0][0], T[0][1]);
      for (const q of T) g.lineTo(q[0], q[1]);
      for (let j = B.length - 1; j >= 0; j--) g.lineTo(B[j][0], B[j][1]);
      g.closePath();
      g.clip();
      g.fillStyle = EYE_INK;
      poly(g, E.silhouette.map(at));
      g.fill();
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
      // Gaze in screen terms (turned into the eye's frame on a 3/4 eye, the pupil kept upright on screen).
      const gx = f.lookX * (w / 2 - pr) * 0.85;
      // The iris is pulled down a little by the closing lid.
      const gy = h * 0.06 + f.lookY * (h / 2 - pry) * 0.7 + (wrap ? lid * h * 0.12 : 0);
      const px = ex + gx * Math.cos(-th) - gy * Math.sin(-th);
      const py = ey + gx * Math.sin(-th) + gy * Math.cos(-th);
      g.fillStyle = '#2a160b';
      g.beginPath();
      g.ellipse(px, py, pr, pry, -th, 0, Math.PI * 2);
      g.fill();
      if (E.highlight) {
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(px + (E.highlight.x - E.pupil.x) * k, py + (E.highlight.y - E.pupil.y) * k, E.highlight.r * k, 0, Math.PI * 2);
        g.fill();
      }
      // Soft shadow of the lid on the eyeball, following the lid edge.
      const top = Math.min(...T.map((q) => q[1]));
      const sh = g.createLinearGradient(0, top, 0, top + h * 0.35);
      sh.addColorStop(0, 'rgba(60, 30, 15, 0.18)');
      sh.addColorStop(1, 'rgba(60, 30, 15, 0)');
      g.fillStyle = sh;
      g.fillRect(ex - w, ey - h, w * 2, h * 2);
      g.restore();
    }
    // The lids' own ink: a tapered stroke riding each lid edge, thickening in as the lid moves (at rest
    // the drawing's outline is the lid). Closed, the upper one lies on the closing arc.
    const band = (P: V2[], thick: number, below: boolean) => {
      if (thick < 0.4) return;
      const S = P.map(at);
      const L: V2[] = [];
      const R: V2[] = [];
      S.forEach((p, j) => {
        const a = S[Math.max(0, j - 1)];
        const b = S[Math.min(S.length - 1, j + 1)];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        const tt = j / (S.length - 1);
        const half = (thick / 2) * Math.max(0.25, Math.sin(Math.PI * tt) ** 0.45);
        // The band hangs from the edge into the visible eye (below the upper lid, above the lower one).
        const off = below ? half : -half;
        const nx = -dy / l;
        const ny = dx / l;
        L.push([p[0] + nx * (off - half), p[1] + ny * (off - half)]);
        R.push([p[0] + nx * (off + half), p[1] + ny * (off + half)]);
      });
      g.fillStyle = EYE_INK;
      poly(g, [...L, ...R.reverse()]);
      g.fill();
    };
    // 3/4 (as Salvatore drew it): the closed eye is the lower-right stretch of its outline, from under
    // the middle of the eye round the lower corner and up its right side.
    const xs0 = E.silTop[0][0];
    const xs1 = E.silTop[n - 1][0];
    // It starts a little before the lowest point of the outline.
    let low = 0;
    for (let j = 1; j < n; j++) if (E.silBot[j][1] > E.silBot[low][1]) low = j;
    // (the narrow, tilted far eye bottoms out at its corner: there it starts at a fixed share of the width)
    const from =
      side === 'far' ? CLOSE_FROM_FAR : Math.max(0, (E.silBot[low][0] - xs0) / Math.max(1e-6, xs1 - xs0) - CLOSE_BEFORE_LOW);
    // ...and climbs the right side only up to a little below the eye's middle.
    const yMin = E.height * (side === 'far' ? CLOSE_TOP_FAR : CLOSE_TOP);
    const closed = wrap ? close.filter((p) => p[0] >= xs0 + (xs1 - xs0) * from && p[1] >= yMin) : close;
    // While it closes, the left part of the lid's ink gives way so the stroke ends on that stretch.
    const keep = Math.min(1, Math.max(0, (lid - 0.45) / 0.55));
    const edgeInk = wrap ? edge.filter((p) => p[0] >= xs0 + (xs1 - xs0) * from * keep && p[1] >= yMin * keep - E.height * (1 - keep)) : edge;
    if (lid >= 0.98) band(closed, lidThick, false);
    else {
      band(edgeInk, lidThick * Math.min(1, lid * 4), true);
      band(bottom, rimThick * Math.min(1, lowLid * 4), false);
    }
    g.restore();
  }

  /**
   * Traced brows. Moods bend them: raise lifts the whole brow, angry pulls the inner end (toward the
   * nose: +x on the near brow, -x on the far one) down, worry lifts it, skeptic raises one and lowers the other.
   */
  const BROWS: Record<Side, V2[]> = {
    near: cfg.traced.brows.near.map((p) => unroll(p)).map((q): V2 => [q[0] - EYES.near.centre[0], q[1] - EYES.near.centre[1]]),
    far: cfg.traced.brows.far.map((p) => unroll(p)).map((q): V2 => [q[0] - EYES.far.centre[0], q[1] - EYES.far.centre[1]]),
  };
  const skepticNear = cfg.skepticNear ?? 0.4;

  function drawBrows(g: G, f: Face) {
    const { raise, worry, angry, skeptic } = f.brows;
    (['near', 'far'] as const).forEach((side, i) => {
      const pts = BROWS[side];
      const k = cfg.unit * f.eyeScale;
      const [ex, ey] = centre(side, k);
      const xs = pts.map((p) => p[0]);
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      const skw = faceTweak('browSkeptic');
      const sk = i === 1 ? -skeptic * skw : skeptic * skw * skepticNear;
      const lift = -raise * faceTweak('browRaise') + sk;
      const inner = angry * faceTweak('browAngry') - worry * faceTweak('browWorry');
      const outer = -angry * 0.05 + worry * 0.06;
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const map = (p: V2, inset: boolean): V2 => {
        const x = inset ? cx + (p[0] - cx) * 0.9 : p[0];
        const y = inset ? cy + (p[1] - cy) * 0.62 : p[1];
        // 0 outer end .. 1 inner end
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

  return { eyes: EYES, unroll, centre, drawEye, drawBrows };
}
