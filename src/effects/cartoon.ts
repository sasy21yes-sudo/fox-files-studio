import { TAU, clamp, easeInOut, easeOut, hash, hash2, lerp, rng, seg } from '../animation/math';
import { FONT_SANS, FONT_TITLE, FONT_TYPE, wrapText } from '../animation/stage';
import { BEAT, beatLift, drawFox } from '../character/AgentFox';

/**
 * 1930s cartoon film language: bouncy pop-up fact cards, slammed numbers,
 * chapter intertitles with rotating sunbursts, a spinning newspaper,
 * a flip-digit case plaque, painted watercolour backdrops, film-gate weave,
 * rounded projector corners and impact shakes. All deterministic.
 */

type G = CanvasRenderingContext2D;

const INK = '#140d08';
const CREAM = '#f3e6c8';
const PAPER = '#efe2c0';
const BRASS = '#c99a3e';
const BRASS_HI = '#f0d38a';
const RED = '#a5301c';

// ------------------------------------------------------------------ easing

/** Springy overshoot that settles, 0 → 1. */
export function elastic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.cos(t * Math.PI * 4.2) * Math.exp(-t * 6.5);
}

/** Pop-in scale: springs in, holds, then shrinks away near `outAt`. */
export function popScale(k: number, inAt: number, outAt = Infinity, inDur = 0.55, outDur = 0.3): number {
  const a = elastic(seg(k, inAt, inDur));
  const b = 1 - easeInOut(seg(k, outAt - outDur, outDur));
  return a * b;
}

/** Sum of decaying impact shakes, in layout units. */
export function impactShake(k: number, times: number[], strength = 14): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const t of times) {
    const d = k - t;
    if (d < 0 || d > 0.45) continue;
    const a = strength * Math.exp(-d * 9);
    x += Math.sin(d * 70) * a;
    y += Math.cos(d * 55) * a * 0.7;
  }
  return { x, y };
}

/** Squash a prop on every beat around its base point, rubber-hose style. */
export function beatBounce(g: G, x: number, baseY: number, time: number, amt = 1, phase = 0) {
  const lift = beatLift(time + phase * BEAT);
  const land = Math.pow(1 - lift, 6);
  const sq = (land * 0.05 - lift * 0.02) * amt;
  g.translate(x, baseY - lift * 6 * amt);
  g.scale(1 + sq, 1 - sq);
  g.translate(-x, -baseY);
}

// ------------------------------------------------------------------ shapes

function inked(g: G, fill: string, w: number) {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = w;
  g.strokeStyle = INK;
  g.stroke();
}

function starPath(g: G, r: number, points = 8, inner = 0.42) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = (i / (points * 2)) * TAU - Math.PI / 2;
    if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
}

export function drawSunburst(g: G, cx: number, cy: number, r: number, rot: number, a: string, b: string, rays = 18) {
  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  g.fillStyle = a;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  g.fillStyle = b;
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * TAU;
    const a1 = a0 + TAU / rays / 2;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, r, a0, a1);
    g.closePath();
    g.fill();
  }
  g.restore();
}

// ------------------------------------------------------------------ fact bubbles

export interface BubbleOptions {
  /** Small ribbon label, e.g. "FACT" or "SOURCE". */
  tag?: string;
  title?: string;
  lines: string[];
  width: number;
  size: number;
  u: number;
  /** 0..1 pop scale (use popScale). */
  scale: number;
  rot?: number;
  /** Typewriter reveal 0..1. */
  reveal?: number;
  tone?: string;
  accent?: string;
  /** Tail pointing toward a screen point (speech-bubble style). */
  tail?: { x: number; y: number };
  align?: 'left' | 'center';
  titleFont?: 'type' | 'display';
}

/** A bouncy cartoon fact card with a hard ink shadow. Returns its height. */
export function drawBubble(g: G, x: number, y: number, o: BubbleOptions): number {
  if (o.scale <= 0.001) return 0;
  const { u, size, width } = o;
  g.save();
  g.font = `${size}px ${FONT_TYPE}`;
  const lines = o.lines.flatMap((l) => (l ? wrapText(g, l, width - 48 * u) : ['']));
  const titleSize = size * (o.titleFont === 'display' ? 1.5 : 1.15);
  const titleFont = o.titleFont === 'display' ? `900 ${titleSize}px ${FONT_TITLE}` : `700 ${titleSize}px ${FONT_TYPE}`;
  g.font = titleFont;
  const tLines = o.title ? wrapText(g, o.title, width - 48 * u) : [];
  const lh = size * 1.32;
  const height = 44 * u + tLines.length * titleSize * 1.15 + (tLines.length && lines.length ? 10 * u : 0) + lines.length * lh;

  g.translate(x, y);
  g.rotate(o.rot ?? 0);
  // Squash-and-stretch on the way in.
  const s = o.scale;
  g.scale(s * (1 + (1 - Math.min(1, s)) * 0.15), s);

  const r = 18 * u;
  const path = () => {
    g.beginPath();
    g.roundRect(-width / 2, -height / 2, width, height, r);
  };
  // Hard cartoon shadow.
  g.save();
  g.translate(9 * u, 11 * u);
  path();
  g.fillStyle = 'rgba(12, 7, 3, 0.75)';
  g.fill();
  g.restore();
  if (o.tail) {
    const tx = (o.tail.x - x) / s;
    const ty = (o.tail.y - y) / s;
    g.beginPath();
    g.moveTo(-26 * u, height / 2 - 4 * u);
    g.quadraticCurveTo(tx * 0.4, ty * 0.6, tx, ty);
    g.quadraticCurveTo(tx * 0.3, ty * 0.5, 26 * u, height / 2 - 4 * u);
    inked(g, o.tone ?? PAPER, 5 * u);
  }
  path();
  inked(g, o.tone ?? PAPER, 5 * u);
  // Inner deco rule.
  g.beginPath();
  g.roundRect(-width / 2 + 9 * u, -height / 2 + 9 * u, width - 18 * u, height - 18 * u, r * 0.6);
  g.lineWidth = 1.6 * u;
  g.strokeStyle = 'rgba(20, 13, 8, 0.45)';
  g.stroke();

  if (o.tag) {
    g.font = `700 ${size * 0.72}px ${FONT_SANS}`;
    const tw = g.measureText(o.tag).width + 24 * u;
    g.save();
    g.translate(-width / 2 + 22 * u, -height / 2 - 14 * u);
    g.rotate(-0.04);
    g.beginPath();
    g.rect(0, 0, tw, size * 1.15);
    inked(g, o.accent ?? RED, 3.5 * u);
    g.fillStyle = CREAM;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(o.tag, 12 * u, size * 0.6);
    g.restore();
  }

  const all = [...tLines, ...lines];
  let chars = Math.floor(all.reduce((a, l) => a + l.length, 0) * clamp(o.reveal ?? 1));
  let cy = -height / 2 + 26 * u;
  const align = o.align ?? 'left';
  const tx = align === 'center' ? 0 : -width / 2 + 24 * u;
  g.textAlign = align;
  g.textBaseline = 'top';
  g.font = titleFont;
  g.fillStyle = o.accent ?? RED;
  for (const l of tLines) {
    g.fillText(l.slice(0, Math.max(0, chars)), tx, cy);
    chars -= l.length;
    cy += titleSize * 1.15;
  }
  if (tLines.length && lines.length) cy += 10 * u;
  g.font = `${size}px ${FONT_TYPE}`;
  g.fillStyle = '#20140b';
  for (const l of lines) {
    g.fillText(l.slice(0, Math.max(0, chars)), tx, cy);
    chars -= l.length;
    cy += lh;
  }
  g.restore();
  return height * s;
}

// ------------------------------------------------------------------ slammed numbers

/** A big number that slams in with a starburst behind it. */
export function drawSlamNumber(g: G, x: number, y: number, u: number, value: string, label: string, k: number, at: number, size = 120, sub?: string) {
  const p = seg(k, at, 0.5);
  if (p <= 0) return;
  const s = lerp(2.6, 1, Math.min(1, elastic(p)));
  const a = clamp(p * 4);
  g.save();
  g.translate(x, y);
  g.globalAlpha = a;
  // Starburst.
  g.save();
  g.rotate(k * 0.6);
  g.scale(s * 0.9, s * 0.9);
  starPath(g, size * 0.95 * u, 12, 0.72);
  inked(g, BRASS, 4 * u);
  g.restore();
  g.scale(s, s);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${size * u}px ${FONT_TITLE}`;
  g.lineJoin = 'round';
  g.lineWidth = size * 0.14 * u;
  g.strokeStyle = INK;
  g.strokeText(value, 0, -size * 0.06 * u);
  const grad = g.createLinearGradient(0, -size * 0.5 * u, 0, size * 0.4 * u);
  grad.addColorStop(0, '#fff3cf');
  grad.addColorStop(1, '#e9b45a');
  g.fillStyle = grad;
  g.fillText(value, 0, -size * 0.06 * u);
  // Label ribbon.
  g.font = `700 ${size * 0.2 * u}px ${FONT_SANS}`;
  const lw = g.measureText(label).width + 30 * u;
  g.beginPath();
  g.rect(-lw / 2, size * 0.42 * u, lw, size * 0.3 * u);
  inked(g, RED, 3.5 * u);
  g.fillStyle = CREAM;
  g.fillText(label, 0, size * 0.575 * u);
  if (sub) {
    g.font = `${size * 0.15 * u}px ${FONT_TYPE}`;
    g.lineWidth = 5 * u;
    g.strokeStyle = INK;
    g.strokeText(sub, 0, size * 0.88 * u);
    g.fillStyle = CREAM;
    g.fillText(sub, 0, size * 0.88 * u);
  }
  g.restore();
}

// ------------------------------------------------------------------ case plaque (HUD)

export interface HudKey {
  at: number;
  year: string;
  note: string;
}

/** Brass plaque in the corner showing the year under discussion; digits flip on change. */
export function drawCaseHud(g: G, w: number, h: number, u: number, k: number, keys: HudKey[], show = 1) {
  if (!keys.length || show <= 0) return;
  let i = -1;
  for (let j = 0; j < keys.length; j++) if (k >= keys[j].at) i = j;
  if (i < 0) return;
  const key = keys[i];
  const prev = keys[i - 1];
  const flip = seg(k, key.at, 0.45);
  const appear = elastic(seg(k, keys[0].at, 0.6)) * show;
  const vertical = h > w;
  const pw = (vertical ? 300 : 280) * u;
  const ph = 92 * u;
  // Vertical video keeps the top band clear for app overlays, so the plaque sits above the desk.
  const x = w - pw - (vertical ? 0.06 * w : 30 * u);
  const y = vertical ? h * 0.6 : 26 * u;
  g.save();
  g.translate(x + pw, y);
  g.scale(appear, appear);
  g.translate(-pw, 0);
  g.fillStyle = 'rgba(12,7,3,0.7)';
  g.beginPath();
  g.roundRect(7 * u, 9 * u, pw, ph, 12 * u);
  g.fill();
  g.beginPath();
  g.roundRect(0, 0, pw, ph, 12 * u);
  const grad = g.createLinearGradient(0, 0, 0, ph);
  grad.addColorStop(0, '#e2bb63');
  grad.addColorStop(1, '#a87b2c');
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = 4 * u;
  g.strokeStyle = INK;
  g.stroke();
  // Screws.
  for (const sx of [12, pw / u - 12]) {
    g.beginPath();
    g.arc(sx * u, 14 * u, 4 * u, 0, TAU);
    inked(g, '#7a5a22', 1.5 * u);
  }
  // Year window with a flip.
  const wx = 14 * u;
  const wy = 12 * u;
  const ww = 116 * u;
  const wh = ph - 24 * u;
  g.beginPath();
  g.rect(wx, wy, ww, wh);
  inked(g, '#1d140e', 3 * u);
  g.save();
  g.beginPath();
  g.rect(wx, wy, ww, wh);
  g.clip();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fs = key.year.length > 4 ? 32 : 46;
  g.font = `900 ${fs * u}px ${FONT_TITLE}`;
  const roll = easeOut(flip);
  if (prev && flip < 1) {
    g.fillStyle = CREAM;
    g.fillText(prev.year, wx + ww / 2, wy + wh / 2 - roll * wh);
  }
  g.fillStyle = '#ffe9b0';
  g.fillText(key.year, wx + ww / 2, wy + wh / 2 + (prev ? (1 - roll) * wh : 0));
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(wx, wy, ww, wh / 2);
  // Note.
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = '#20140b';
  g.font = `700 ${15 * u}px ${FONT_SANS}`;
  const nl = wrapText(g, key.note.toUpperCase(), pw - ww - 40 * u).slice(0, 3);
  nl.forEach((l, j) => g.fillText(l, wx + ww + 12 * u, ph / 2 + (j - (nl.length - 1) / 2) * 18 * u));
  g.restore();
}

// ------------------------------------------------------------------ chapter intertitle

export const CHAPTER_LEN = 1.35;

export function drawChapterCard(
  g: G,
  w: number,
  h: number,
  u: number,
  local: number,
  time: number,
  num: number,
  title: string,
  opening: boolean,
) {
  if (local >= CHAPTER_LEN) return;
  const vertical = h > w;
  const reveal = easeInOut(seg(local, 0.85, CHAPTER_LEN - 0.85));
  const cx = w / 2;
  const cy = vertical ? h * 0.42 : h / 2;
  const maxR = Math.hypot(w, h);
  g.save();
  // The card world sits outside a growing iris hole that reveals the scene.
  g.beginPath();
  g.rect(0, 0, w, h);
  if (reveal > 0) g.arc(cx, cy, maxR * reveal, 0, TAU, true);
  g.clip('evenodd');
  drawSunburst(g, cx, cy, maxR, time * 0.35, '#3a2414', '#4f321c', 22);
  const vg = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.2, cx, cy, maxR * 0.6);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.75)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);

  // Card spins in, holds, then zooms toward the camera.
  const spin = elastic(seg(local, 0, 0.6));
  const away = easeInOut(seg(local, 0.85, 0.5));
  const s = spin * (1 + away * 0.8);
  const cw = Math.min(w * 0.82, 900 * u);
  const ch = cw * (opening ? 0.62 : 0.5);
  g.translate(cx, cy);
  g.rotate((1 - spin) * -2.4 + Math.sin(local * 5) * 0.012);
  g.scale(s, s);
  g.globalAlpha = 1 - away;
  // Deco frame.
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.beginPath();
  g.roundRect(-cw / 2 + 12 * u, -ch / 2 + 14 * u, cw, ch, 26 * u);
  g.fill();
  g.beginPath();
  g.roundRect(-cw / 2, -ch / 2, cw, ch, 26 * u);
  inked(g, '#1f150e', 6 * u);
  g.beginPath();
  g.roundRect(-cw / 2 + 16 * u, -ch / 2 + 16 * u, cw - 32 * u, ch - 32 * u, 18 * u);
  inked(g, PAPER, 4 * u);
  g.beginPath();
  g.roundRect(-cw / 2 + 28 * u, -ch / 2 + 28 * u, cw - 56 * u, ch - 56 * u, 12 * u);
  g.lineWidth = 2 * u;
  g.strokeStyle = BRASS;
  g.stroke();
  // Corner fans.
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    g.save();
    g.translate(sx * (cw / 2 - 28 * u), sy * (ch / 2 - 28 * u));
    g.scale(sx, sy);
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc(0, 0, (18 + i * 12) * u, 0, Math.PI / 2);
      g.lineWidth = 3 * u;
      g.strokeStyle = i % 2 ? BRASS : INK;
      g.stroke();
    }
    g.restore();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (opening) {
    // Emblem: Agent Fox inside a medallion.
    const er = ch * 0.2;
    g.save();
    g.translate(0, -ch * 0.18);
    g.beginPath();
    g.arc(0, 0, er, 0, TAU);
    inked(g, '#b9832f', 5 * u);
    g.save();
    g.beginPath();
    g.arc(0, 0, er - 4 * u, 0, TAU);
    g.clip();
    drawSunburst(g, 0, 0, er, -time * 0.5, '#d9a54a', '#c48a34', 14);
    drawFox(g, { x: -er * 0.05, y: er * 2.6, scale: (er / 170), time, bounce: 1, mouth: 'smile', lookX: 0.2, brows: 0.4 });
    g.restore();
    g.restore();
    g.font = `700 ${22 * u}px ${FONT_TYPE}`;
    g.fillStyle = '#5a3a20';
    g.fillText('AGENT FOX  ·  IN', 0, ch * 0.07);
    fitText(g, 'THE FOX FILES', cw * 0.8, 92 * u, `900 italic`, FONT_TITLE);
    g.lineWidth = 9 * u;
    g.strokeStyle = INK;
    g.strokeText('THE FOX FILES', 0, ch * 0.24);
    g.fillStyle = '#d9a54a';
    g.fillText('THE FOX FILES', 0, ch * 0.24);
  } else {
    g.font = `700 ${24 * u}px ${FONT_TYPE}`;
    g.fillStyle = '#5a3a20';
    g.fillText(`CASE FILE  №  ${num}`, 0, -ch * 0.22);
    fitText(g, title.toUpperCase(), cw * 0.8, 100 * u, '900', FONT_TITLE);
    g.lineWidth = 10 * u;
    g.strokeStyle = INK;
    g.strokeText(title.toUpperCase(), 0, ch * 0.03);
    const grad = g.createLinearGradient(0, -50 * u, 0, 50 * u);
    grad.addColorStop(0, '#f6d58c');
    grad.addColorStop(1, '#c7862f');
    g.fillStyle = grad;
    g.fillText(title.toUpperCase(), 0, ch * 0.03);
    g.font = `${20 * u}px ${FONT_TYPE}`;
    g.fillStyle = '#5a3a20';
    g.fillText('— THE FOX FILES —', 0, ch * 0.27);
  }
  g.restore();
}

function fitText(g: G, text: string, maxW: number, size: number, weight: string, family: string) {
  let s = size;
  g.font = `${weight} ${s}px ${family}`;
  while (g.measureText(text).width > maxW && s > 10) {
    s *= 0.94;
    g.font = `${weight} ${s}px ${family}`;
  }
}

// ------------------------------------------------------------------ spinning newspaper

/** The classic spinning-newspaper insert. The paper is the show's own illustration. */
export function drawNewspaper(
  g: G,
  x: number,
  y: number,
  pw: number,
  u: number,
  p: number,
  o: { masthead: string; date: string; headline: string; deck: string },
) {
  if (p <= 0) return;
  const spin = easeOut(clamp(p));
  const ph = pw * 1.25;
  g.save();
  g.translate(x, y);
  g.rotate((1 - spin) * TAU * 2.5);
  g.scale(lerp(0.05, 1, spin), lerp(0.05, 1, spin));
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(-pw / 2 + 12 * u, -ph / 2 + 14 * u, pw, ph);
  g.beginPath();
  g.rect(-pw / 2, -ph / 2, pw, ph);
  inked(g, '#ece0c3', 4 * u);
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillStyle = INK;
  fitText(g, o.masthead, pw - 40 * u, 46 * u, '900', FONT_TITLE);
  g.fillText(o.masthead, 0, -ph / 2 + 20 * u);
  g.fillRect(-pw / 2 + 18 * u, -ph / 2 + 78 * u, pw - 36 * u, 3 * u);
  g.font = `${15 * u}px ${FONT_TYPE}`;
  g.fillText(o.date, 0, -ph / 2 + 86 * u);
  g.fillRect(-pw / 2 + 18 * u, -ph / 2 + 108 * u, pw - 36 * u, 2 * u);
  g.font = `900 ${50 * u}px ${FONT_TITLE}`;
  const hl = wrapText(g, o.headline, pw - 40 * u);
  let cy = -ph / 2 + 122 * u;
  for (const l of hl) {
    g.fillText(l, 0, cy);
    cy += 54 * u;
  }
  g.font = `italic 700 ${22 * u}px ${FONT_TITLE}`;
  for (const l of wrapText(g, o.deck, pw - 60 * u)) {
    g.fillText(l, 0, cy + 6 * u);
    cy += 28 * u;
  }
  // Column filler.
  const r = rng(99);
  const colW = (pw - 60 * u) / 3;
  for (let c = 0; c < 3; c++) {
    for (let yy = cy + 30 * u; yy < ph / 2 - 30 * u; yy += 11 * u) {
      g.fillStyle = 'rgba(40,28,18,0.4)';
      g.fillRect(-pw / 2 + 24 * u + c * (colW + 6 * u), yy, colW * (0.7 + r() * 0.3), 4 * u);
    }
  }
  g.font = `${12 * u}px ${FONT_SANS}`;
  g.fillStyle = 'rgba(40,28,18,0.8)';
  g.textBaseline = 'bottom';
  g.fillText('Illustration · paraphrase of the Senate record', 0, ph / 2 - 8 * u);
  g.restore();
}

// ------------------------------------------------------------------ timeline strip

export interface TimelineMark {
  year: number;
  label: string;
  at: number;
  hot?: boolean;
}

export function drawTimelineStrip(g: G, x0: number, x1: number, y: number, u: number, k: number, marks: TimelineMark[], alpha = 1) {
  if (alpha <= 0) return;
  const minY = marks[0].year;
  const maxY = marks[marks.length - 1].year;
  const X = (yr: number) => lerp(x0, x1, (yr - minY) / (maxY - minY));
  const lineP = clamp(seg(k, marks[0].at - 0.4, (marks[marks.length - 1].at - marks[0].at) + 0.8));
  g.save();
  g.globalAlpha = alpha;
  // Backing plate.
  g.fillStyle = 'rgba(15, 9, 5, 0.72)';
  g.beginPath();
  g.roundRect(x0 - 50 * u, y - 96 * u, x1 - x0 + 100 * u, 196 * u, 16 * u);
  g.fill();
  g.lineWidth = 8 * u;
  g.strokeStyle = INK;
  g.beginPath();
  g.moveTo(x0, y);
  g.lineTo(lerp(x0, x1, lineP), y);
  g.stroke();
  g.lineWidth = 4 * u;
  g.strokeStyle = BRASS_HI;
  g.stroke();
  marks.forEach((m, i) => {
    const p = elastic(seg(k, m.at, 0.5));
    if (p <= 0) return;
    const mx = X(m.year);
    g.save();
    g.translate(mx, y);
    g.scale(p, p);
    g.beginPath();
    g.arc(0, 0, (m.hot ? 15 : 11) * u, 0, TAU);
    inked(g, m.hot ? RED : BRASS_HI, 3.5 * u);
    g.textAlign = 'center';
    const up = i % 2 === 0;
    g.font = `900 ${32 * u}px ${FONT_TITLE}`;
    g.lineWidth = 6 * u;
    g.strokeStyle = INK;
    g.textBaseline = up ? 'bottom' : 'top';
    const yy = up ? -20 * u : 20 * u;
    g.strokeText(String(m.year), 0, yy);
    g.fillStyle = '#ffe2a0';
    g.fillText(String(m.year), 0, yy);
    g.font = `600 ${19 * u}px ${FONT_SANS}`;
    g.fillStyle = CREAM;
    const ll = wrapText(g, m.label, 170 * u);
    ll.forEach((l, j) => g.fillText(l, 0, up ? yy - 36 * u - (ll.length - 1 - j) * 21 * u : yy + 38 * u + j * 21 * u));
    g.restore();
  });
  g.restore();
}

// ------------------------------------------------------------------ tally chart

export interface TallyRow {
  label: string;
  value: number;
  hot?: boolean;
}

/** Ink bar chart drawn to one scale; rows grow in sequence. */
export function drawTally(g: G, x: number, y: number, width: number, u: number, k: number, at: number, title: string, rows: TallyRow[], note: string, scale = 1) {
  const p0 = seg(k, at, 0.4);
  if (p0 <= 0 || scale <= 0) return;
  const max = Math.max(...rows.map((r) => r.value));
  const rowH = 46 * u;
  const labelW = width * 0.46;
  const barW = width - labelW - 70 * u;
  const height = 70 * u + rows.length * rowH + 30 * u;
  g.save();
  g.translate(x, y);
  g.scale(elastic(p0) * scale, elastic(p0) * scale);
  g.fillStyle = 'rgba(12,7,3,0.75)';
  g.beginPath();
  g.roundRect(-width / 2 + 9 * u, 11 * u, width, height, 16 * u);
  g.fill();
  g.beginPath();
  g.roundRect(-width / 2, 0, width, height, 16 * u);
  inked(g, PAPER, 5 * u);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = `700 ${22 * u}px ${FONT_TYPE}`;
  g.fillStyle = RED;
  g.fillText(title, -width / 2 + 22 * u, 34 * u);
  rows.forEach((r, i) => {
    const p = easeOut(seg(k, at + 0.3 + i * 0.35, 0.6));
    const ry = 70 * u + i * rowH;
    g.font = `${18 * u}px ${FONT_SANS}`;
    g.fillStyle = '#20140b';
    g.textAlign = 'left';
    g.fillText(r.label, -width / 2 + 22 * u, ry + rowH / 2 - 4 * u);
    const bx = -width / 2 + labelW;
    const bw = (barW * r.value) / max;
    g.beginPath();
    g.rect(bx, ry + 6 * u, Math.max(2 * u, bw * p), rowH - 22 * u);
    inked(g, r.hot ? RED : BRASS, 3 * u);
    g.font = `900 ${24 * u}px ${FONT_TITLE}`;
    g.fillStyle = r.hot ? RED : '#20140b';
    g.fillText(String(Math.round(r.value * p)), bx + bw * p + 10 * u, ry + rowH / 2 - 4 * u);
  });
  g.font = `${13 * u}px ${FONT_SANS}`;
  g.fillStyle = '#5a4630';
  g.fillText(note, -width / 2 + 22 * u, height - 18 * u);
  g.restore();
}

// ------------------------------------------------------------------ set dressing

export function drawWallClock(g: G, x: number, y: number, u: number, time: number) {
  g.save();
  g.translate(x, y);
  beatBounce(g, 0, 60 * u, time, 0.6, 0.5);
  // Case.
  g.beginPath();
  g.roundRect(-46 * u, -60 * u, 92 * u, 190 * u, 40 * u);
  inked(g, '#5b3a22', 4 * u);
  g.beginPath();
  g.arc(0, -10 * u, 36 * u, 0, TAU);
  inked(g, CREAM, 4 * u);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.fillStyle = INK;
    g.fillRect(Math.cos(a) * 28 * u - 2 * u, -10 * u + Math.sin(a) * 28 * u - 2 * u, 4 * u, 4 * u);
  }
  // Hands spin in cartoon time.
  for (const [len, speed, wdt] of [
    [24, 0.6, 5],
    [30, 3.2, 3],
  ]) {
    const a = time * speed - Math.PI / 2;
    g.beginPath();
    g.moveTo(0, -10 * u);
    g.lineTo(Math.cos(a) * len * u, -10 * u + Math.sin(a) * len * u);
    g.lineWidth = wdt * u;
    g.strokeStyle = INK;
    g.stroke();
  }
  // Pendulum on the beat.
  const sw = Math.sin((Math.PI * time) / BEAT) * 0.35;
  g.save();
  g.translate(0, 34 * u);
  g.rotate(sw);
  g.strokeStyle = BRASS;
  g.lineWidth = 3 * u;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, 66 * u);
  g.stroke();
  g.beginPath();
  g.arc(0, 72 * u, 12 * u, 0, TAU);
  inked(g, BRASS_HI, 3 * u);
  g.restore();
  g.restore();
}

export function drawMug(g: G, x: number, y: number, u: number, time: number) {
  g.save();
  g.translate(x, y);
  beatBounce(g, 0, 0, time, 0.8, 0.25);
  // Steam curls.
  g.strokeStyle = 'rgba(240, 230, 210, 0.5)';
  g.lineWidth = 4 * u;
  for (let i = 0; i < 2; i++) {
    g.beginPath();
    for (let j = 0; j <= 12; j++) {
      const t = j / 12;
      const px = i * 16 * u - 8 * u + Math.sin(t * 6 + time * 3 + i * 2) * 8 * u;
      const py = -54 * u - t * 70 * u;
      if (j) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.stroke();
  }
  g.beginPath();
  g.arc(32 * u, -26 * u, 14 * u, -Math.PI / 2, Math.PI / 2);
  g.lineWidth = 7 * u;
  g.strokeStyle = INK;
  g.stroke();
  g.beginPath();
  g.roundRect(-28 * u, -52 * u, 56 * u, 52 * u, 8 * u);
  inked(g, '#e9dcc0', 4 * u);
  g.fillStyle = RED;
  g.fillRect(-28 * u, -36 * u, 56 * u, 10 * u);
  g.restore();
}

/** Dust motes drifting through a beam of light. */
export function drawMotes(g: G, x: number, y: number, w: number, h: number, u: number, time: number, amt = 1) {
  g.save();
  for (let i = 0; i < 40; i++) {
    const px = x + ((hash(i * 3) * w + time * (6 + hash(i) * 10) * u) % w);
    const py = y + ((hash(i * 5 + 1) * h + Math.sin(time * 0.7 + i) * 20 * u) % h);
    const tw = 0.5 + 0.5 * Math.sin(time * 3 + i * 1.7);
    g.fillStyle = `rgba(255, 236, 196, ${0.35 * tw * amt})`;
    g.beginPath();
    g.arc(px, py, (1.5 + hash(i * 7) * 2.5) * u, 0, TAU);
    g.fill();
  }
  g.restore();
}

// ------------------------------------------------------------------ painted look and film gate

const washCache = new Map<string, HTMLCanvasElement>();

/** A seeded watercolour wash texture, multiplied over painted backdrops. */
export function paintWash(g: G, w: number, h: number, seed = 1, strength = 0.5) {
  const key = `${Math.round(w)}x${Math.round(h)}:${seed}`;
  let tex = washCache.get(key);
  if (!tex) {
    tex = document.createElement('canvas');
    const scale = 0.5;
    tex.width = Math.max(1, Math.round(w * scale));
    tex.height = Math.max(1, Math.round(h * scale));
    const t = tex.getContext('2d')!;
    t.fillStyle = '#fff';
    t.fillRect(0, 0, tex.width, tex.height);
    const r = rng(seed * 101);
    for (let i = 0; i < 90; i++) {
      const cx = r() * tex.width;
      const cy = r() * tex.height;
      const rad = (0.05 + r() * 0.25) * Math.max(tex.width, tex.height);
      const gr = t.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const tone = r() > 0.5 ? '150, 95, 45' : '95, 70, 50';
      gr.addColorStop(0, `rgba(${tone}, ${0.05 + r() * 0.07})`);
      gr.addColorStop(0.7, `rgba(${tone}, ${0.02 + r() * 0.03})`);
      gr.addColorStop(1, `rgba(${tone}, 0)`);
      t.fillStyle = gr;
      t.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    // Paper fibres.
    t.strokeStyle = 'rgba(90, 60, 30, 0.08)';
    for (let i = 0; i < 260; i++) {
      const x = r() * tex.width;
      const y = r() * tex.height;
      const a = r() * TAU;
      const l = 4 + r() * 14;
      t.beginPath();
      t.moveTo(x, y);
      t.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      t.stroke();
    }
    washCache.set(key, tex);
    if (washCache.size > 12) washCache.delete(washCache.keys().next().value as string);
  }
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = strength;
  g.drawImage(tex, -w * 0.1, -h * 0.1, w * 1.2, h * 1.2);
  g.restore();
}

/** Projector gate weave: a tiny jump per film frame. */
export function gateWeave(time: number, u: number): { x: number; y: number } {
  const f = Math.floor(time * 12);
  return { x: (hash2(f, 1) - 0.5) * 2.2 * u, y: (hash2(f, 2) - 0.5) * 3 * u };
}

/** Rounded projector-gate corners framing the picture. */
export function drawGate(g: G, w: number, h: number, u: number) {
  const r = 46 * u;
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.roundRect(5 * u, 5 * u, w - 10 * u, h - 10 * u, r);
  g.fillStyle = '#060302';
  g.fill('evenodd');
  g.restore();
}

/** Ink-splat wipe transition (p = 1 clear, 0 covered). */
let wipeCanvas: HTMLCanvasElement | null = null;
export function drawInkWipe(g: G, w: number, h: number, p: number, seed: number) {
  const q = clamp(p);
  if (q >= 1) return;
  if (!wipeCanvas) wipeCanvas = document.createElement('canvas');
  const c = wipeCanvas;
  if (c.width !== Math.round(w) || c.height !== Math.round(h)) {
    c.width = Math.round(w);
    c.height = Math.round(h);
  }
  const t = c.getContext('2d')!;
  t.globalCompositeOperation = 'source-over';
  t.clearRect(0, 0, w, h);
  t.fillStyle = '#0b0705';
  t.fillRect(0, 0, w, h);
  t.globalCompositeOperation = 'destination-out';
  const maxR = Math.hypot(w, h) * 0.75;
  for (let i = 0; i < 5; i++) {
    const cx = hash2(seed, i) * w;
    const cy = hash2(seed, i + 9) * h;
    const r = maxR * easeInOut(q) * (0.6 + hash2(seed, i + 20) * 0.6);
    if (r <= 0.5) continue;
    t.beginPath();
    for (let a = 0; a <= 24; a++) {
      const ang = (a / 24) * TAU;
      const rr = r * (0.85 + hash2(seed * 7 + i, a % 24) * 0.3);
      if (a) t.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      else t.moveTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
    }
    t.closePath();
    t.fill();
  }
  g.drawImage(c, 0, 0, w, h);
}
