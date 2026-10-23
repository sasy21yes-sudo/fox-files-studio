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
}

export interface FaceRig {
  eyes: Record<Side, EyeShape>;
  /** Turn a traced point upright. */
  unroll(p: P): V2;
  centre(side: Side, k: number): V2;
  drawEye(g: G, side: Side, i: number, f: Face): void;
  drawBrows(g: G, f: Face): void;
}

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
  const centre = (side: Side, k: number) => cfg.centre(side, k, EYES);

  /**
   * Eyes drawn from column profiles so the lid is part of the eye: the upper lid edge slides from the
   * top of the white down to a closing curve near its bottom, bending with the eye; the heavy lid ink
   * rides on it with the drawing's thickness, the lower rim stays. Closed = the two ink bands meet in one arc.
   */
  function drawEye(g: G, side: Side, i: number, f: Face) {
    const E = EYES[side];
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
    // The traced heavy lid is the rest pose: the animated lid starts beyond the rig's resting value.
    const lid = Math.min(1, Math.max(0, (f.lid[i] - 0.1) / 0.9));
    const n = E.whiteTop.length;
    const tilt = f.lidTilt * faceTweak('lidTilt'); // inner corner lower when angry, higher when worried
    // The inner corner (toward the nose) is +x on the near eye, -x on the far eye.
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
      // Positions along this column (0 = top of the white, 1 = its bottom).
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
    // thickness. Offsets run along each traced column.
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
