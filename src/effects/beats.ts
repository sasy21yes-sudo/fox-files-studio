import type { Timeline } from '../animation/timeline';
import type { Beat } from '../data/mkultraScript';
import { sceneBeats } from '../data/projectText';
import { FONT_SANS, FONT_TITLE, FONT_TYPE, wrapText } from '../animation/stage';
import { TAU, clamp, easeOut, hash } from '../animation/math';
import { drawSunburst, elastic } from './cartoon';

/**
 * Explainer pop-ups synced to the narration ("beats"): question cards, year
 * spans, counters, definitions, waffle charts, stamped lists, highlighted
 * record cards and kinetic statements, drawn as 1930s cartoon inserts.
 *
 * Each beat starts on the exact word where its phrase is spoken (estimated
 * from the subtitle cues) and holds a little after, without overlapping the
 * next beat or the scene's end.
 */

type G = CanvasRenderingContext2D;

const INK = '#170d07';
const CREAM = '#f3e6c8';
const PAPER = '#efe2c2';
const RED = '#b0301c';
const GOLD = '#e9b844';

interface Placed {
  beat: Beat;
  start: number;
  end: number;
}

/** Words a viewer has to read on a card (every text field of the beat). */
function beatWords(beat: Beat): number {
  let n = 0;
  for (const [k, v] of Object.entries(beat)) {
    if (k === 'cue' || k === 'kind') continue;
    for (const x of Array.isArray(v) ? v : [v]) if (typeof x === 'string') n += (x.match(/\S+/g) ?? []).length;
  }
  return n;
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');

/** Where (in time) each beat of a scene starts and ends. */
export function placeBeats(tl: Timeline, sceneIndex: number): Placed[] {
  const span = tl.spans[sceneIndex];
  if (!span) return [];
  const beats = sceneBeats(span.scene, tl.lang);
  if (!beats.length) return [];
  const cues = tl.cues.filter((c) => c.sceneIndex === sceneIndex);
  let text = '';
  const offs: number[] = [];
  for (const c of cues) {
    offs.push(text.length);
    text += norm(c.text) + ' ';
  }
  const placed: Placed[] = [];
  for (const beat of beats) {
    const at = text.indexOf(norm(beat.cue));
    if (at < 0) continue;
    let ci = 0;
    while (ci + 1 < cues.length && offs[ci + 1] <= at) ci++;
    const c = cues[ci];
    const len = Math.max(1, norm(c.text).length);
    const start = c.start + ((at - offs[ci]) / len) * (c.end - c.start) - 0.15;
    // Up until its sentence is over (plus a beat) and long enough to read: 0.3 s per word of the card + 1 s.
    // (cue end + 1.2 s closed cards mid-sentence and left the Kennedy record 4.8 s for 13 words - review.)
    let se = ci;
    while (se + 1 < cues.length && !/[.!?…]["»”)]*$/.test(cues[se].text.trim())) se++;
    placed.push({ beat, start, end: Math.max(cues[se].end + 0.8, start + 0.3 * beatWords(beat) + 1.0, start + 2.4) });
  }
  placed.sort((a, b) => a.start - b.start);
  for (let i = 0; i < placed.length; i++) {
    const next = placed[i + 1];
    if (next) placed[i].end = Math.min(placed[i].end, next.start - 0.05);
    placed[i].end = Math.min(placed[i].end, span.end - 0.6);
  }
  return placed.filter((p) => p.end - p.start > 0.6);
}

const cache = new WeakMap<Timeline, Map<number, Placed[]>>();
function beatsFor(tl: Timeline, idx: number): Placed[] {
  let m = cache.get(tl);
  if (!m) cache.set(tl, (m = new Map()));
  let b = m.get(idx);
  if (!b) m.set(idx, (b = placeBeats(tl, idx)));
  return b;
}

/** Draw the active beat (if any) for the current time. */
export function renderBeats(g: G, w: number, h: number, tl: Timeline, sceneIndex: number, time: number) {
  const active = beatsFor(tl, sceneIndex).find((p) => time >= p.start && time < p.end);
  if (!active) return;
  const t = time - active.start;
  const len = active.end - active.start;
  const inP = clamp(t / 0.42);
  const outP = clamp((len - t) / 0.28);
  const env = Math.min(inP, outP);
  const V = h > w;
  const u = Math.min(w, h) / 1080;
  // Dim the scene behind the insert so it reads at a glance.
  g.save();
  g.fillStyle = `rgba(14, 8, 4, ${0.6 * Math.min(1, inP * 2) * outP})`;
  g.fillRect(0, 0, w, h);
  g.restore();
  const cx = V ? w * 0.5 : w * 0.62;
  // 9:16: in the top band, above the character's head (at a third of the height the cards sat on his face in
  // half the pop-ups - review, 2026-10-24).
  const cy = V ? h * (active.beat.kind === 'question' || active.beat.kind === 'count' ? 0.17 : 0.21) : h * 0.42;
  const W = V ? w * 0.9 : w * 0.56;
  const s = elastic(inP) * (outP < 1 ? 0.6 + 0.4 * outP : 1);
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.globalAlpha = Math.min(1, env * 1.6);
  const D: Draw = { g, u, W, t, time, seed: Math.floor(active.start * 10), V };
  switch (active.beat.kind) {
    case 'question':
      drawQuestion(D, active.beat);
      break;
    case 'span':
      drawSpan(D, active.beat);
      break;
    case 'count':
      drawCount(D, active.beat);
      break;
    case 'versus':
      drawVersus(D, active.beat);
      break;
    case 'define':
      drawDefine(D, active.beat);
      break;
    case 'waffle':
      drawWaffle(D, active.beat);
      break;
    case 'list':
      drawList(D, active.beat);
      break;
    case 'record':
      drawRecord(D, active.beat);
      break;
    case 'statement':
      drawStatement(D, active.beat);
      break;
  }
  g.restore();
}

interface Draw {
  g: G;
  u: number;
  W: number;
  t: number;
  time: number;
  seed: number;
  V: boolean;
}

// ------------------------------------------------------------------ shared drawing

function card(g: G, x: number, y: number, w: number, h: number, u: number, fill = PAPER, rot = 0, radius = 14) {
  g.save();
  g.rotate(rot);
  g.fillStyle = 'rgba(10, 5, 2, 0.55)';
  g.beginPath();
  g.roundRect(x + 10 * u, y + 12 * u, w, h, radius * u);
  g.fill();
  g.fillStyle = fill;
  g.strokeStyle = INK;
  g.lineWidth = 6 * u;
  g.beginPath();
  g.roundRect(x, y, w, h, radius * u);
  g.fill();
  g.stroke();
  // 1930s double rule.
  g.lineWidth = 2 * u;
  g.beginPath();
  g.roundRect(x + 10 * u, y + 10 * u, w - 20 * u, h - 20 * u, Math.max(2, radius - 6) * u);
  g.stroke();
  g.restore();
}

function outlined(g: G, text: string, x: number, y: number, size: number, font: string, fill: string, u: number, stroke = INK, weight = '900') {
  g.font = `${weight} ${size}px ${font}`;
  g.lineJoin = 'round';
  g.lineWidth = Math.max(4 * u, size * 0.16);
  g.strokeStyle = stroke;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

function fitSize(g: G, text: string, font: string, weight: string, want: number, maxW: number) {
  g.font = `${weight} ${want}px ${font}`;
  const w = g.measureText(text).width;
  return w > maxW ? (want * maxW) / w : want;
}

function popAt(t: number, at: number, dur = 0.35) {
  return elastic(clamp((t - at) / dur));
}

// ------------------------------------------------------------------ beat kinds

function drawQuestion(D: Draw, b: Extract<Beat, { kind: 'question' }>) {
  const { g, u, W, t, time } = D;
  // (9:16: smaller, the sunburst covered the whole head and reached the platform's top band)
  const R = W * (D.V ? 0.32 : 0.42);
  g.save();
  g.globalAlpha *= 0.85;
  drawSunburst(g, 0, 0, R * 1.25, time * 0.5, '#5a1f10', '#7a2c14', 20);
  g.restore();
  // Badge.
  g.fillStyle = 'rgba(10,5,2,0.5)';
  g.beginPath();
  g.ellipse(10 * u, 14 * u, R, R * 0.62, 0, 0, TAU);
  g.fill();
  g.fillStyle = CREAM;
  g.strokeStyle = INK;
  g.lineWidth = 7 * u;
  g.beginPath();
  g.ellipse(0, 0, R, R * 0.62, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const words = b.text.toUpperCase().split(' ');
  g.font = `900 ${60 * u}px ${FONT_TITLE}`;
  const lines = wrapText(g, b.text.toUpperCase(), R * 1.45);
  const size = fitSize(g, lines.reduce((a, l) => (l.length > a.length ? l : a), ''), FONT_TITLE, '900', (D.V ? 74 : 64) * u, R * 1.5);
  let wi = 0;
  lines.forEach((line, li) => {
    const y = (li - (lines.length - 1) / 2) * size * 1.12;
    g.font = `900 ${size}px ${FONT_TITLE}`;
    const parts = line.split(' ');
    const total = g.measureText(line).width;
    let x = -total / 2;
    for (const p of parts) {
      const pw = g.measureText(p).width;
      const k = popAt(t, 0.15 + wi * 0.09, 0.3);
      if (k > 0) {
        g.save();
        g.translate(x + pw / 2, y);
        g.scale(k, k);
        outlined(g, p, 0, 0, size, FONT_TITLE, wi === words.length - 1 ? RED : INK, u, CREAM);
        g.restore();
      }
      x += pw + g.measureText(' ').width;
      wi++;
    }
  });
  // Bouncing question mark.
  const q = popAt(t, 0.5, 0.4);
  if (q > 0) {
    g.save();
    g.translate(R * 0.98, -R * 0.42 + Math.sin(time * 6) * 8 * u);
    g.rotate(0.18 + Math.sin(time * 3) * 0.06);
    g.scale(q, q);
    outlined(g, '?', 0, 0, 170 * u, FONT_TITLE, GOLD, u);
    g.restore();
  }
}

function drawSpan(D: Draw, b: Extract<Beat, { kind: 'span' }>) {
  const { g, u, W, t } = D;
  const w = W * 0.92;
  const h = 250 * u;
  card(g, -w / 2, -h / 2, w, h, u, PAPER, -0.012);
  const y = 26 * u;
  const x0 = -w * 0.38;
  const x1 = w * 0.38;
  const p = easeOut(clamp((t - 0.35) / 0.9));
  // Ruler.
  g.strokeStyle = INK;
  g.lineWidth = 4 * u;
  g.beginPath();
  g.moveTo(x0, y);
  g.lineTo(x1, y);
  g.stroke();
  for (let i = 0; i <= 11; i++) {
    const x = x0 + ((x1 - x0) * i) / 11;
    g.beginPath();
    g.moveTo(x, y - (i % 11 === 0 ? 18 : 9) * u);
    g.lineTo(x, y + (i % 11 === 0 ? 18 : 9) * u);
    g.stroke();
  }
  // Filling bar.
  g.fillStyle = RED;
  g.strokeStyle = INK;
  g.lineWidth = 4 * u;
  g.beginPath();
  g.roundRect(x0, y - 13 * u, (x1 - x0) * p, 26 * u, 13 * u);
  g.fill();
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.font = `700 ${34 * u}px ${FONT_TYPE}`;
  g.fillStyle = INK;
  // Keep longer labels ("Rapporto 1963") inside the card.
  const edge = w / 2 - 22 * u;
  const fw = g.measureText(b.from).width / 2;
  const tw = g.measureText(b.to).width / 2;
  g.fillText(b.from, Math.max(x0, -edge + fw), y + 30 * u);
  if (p > 0.95) g.fillText(b.to, Math.min(x1, edge - tw), y + 30 * u);
  const k = popAt(t, 1.15, 0.4);
  if (k > 0) {
    g.save();
    g.translate(0, -62 * u);
    g.rotate(-0.04);
    g.scale(k, k);
    g.textBaseline = 'middle';
    const size = fitSize(g, b.label, FONT_TITLE, '900', 76 * u, w * 0.85);
    outlined(g, b.label, 0, 0, size, FONT_TITLE, GOLD, u);
    g.restore();
  }
}

function drawCount(D: Draw, b: Extract<Beat, { kind: 'count' }>) {
  const { g, u, W, t, time } = D;
  const R = W * (D.V ? 0.24 : 0.3);
  g.save();
  g.globalAlpha *= 0.9;
  drawSunburst(g, 0, -10 * u, R * 1.35, time * 0.6, '#6e2a12', '#9a4418', 16);
  g.restore();
  const v = Math.round(b.value * easeOut(clamp((t - 0.2) / 1.0)));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const thump = 1 + 0.12 * Math.max(0, 1 - Math.abs(t - 1.25) / 0.15);
  g.save();
  g.translate(0, -30 * u);
  g.scale(thump, thump);
  outlined(g, String(v), 0, 0, (D.V ? 230 : 200) * u, FONT_TITLE, CREAM, u);
  g.restore();
  // Ribbon label.
  const k = popAt(t, 0.9, 0.35);
  if (k > 0) {
    g.save();
    g.translate(0, 95 * u);
    g.scale(k, k);
    g.font = `900 ${40 * u}px ${FONT_SANS}`;
    const lw = Math.min(W * 0.95, g.measureText(b.label).width + 90 * u);
    g.fillStyle = RED;
    g.strokeStyle = INK;
    g.lineWidth = 5 * u;
    g.beginPath();
    g.moveTo(-lw / 2 - 30 * u, -34 * u);
    g.lineTo(lw / 2 + 30 * u, -34 * u);
    g.lineTo(lw / 2 + 6 * u, 0);
    g.lineTo(lw / 2 + 30 * u, 34 * u);
    g.lineTo(-lw / 2 - 30 * u, 34 * u);
    g.lineTo(-lw / 2 - 6 * u, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = CREAM;
    g.fillText(b.label, 0, 2 * u);
    if (b.note) {
      g.font = `400 ${28 * u}px ${FONT_TYPE}`;
      outlined(g, b.note, 0, 66 * u, 28 * u, FONT_TYPE, CREAM, u, INK, '400');
    }
    g.restore();
  }
}

function drawVersus(D: Draw, b: Extract<Beat, { kind: 'versus' }>) {
  const { g, u, W, t, time } = D;
  const cw = W * 0.42;
  const ch = 170 * u;
  const kl = popAt(t, 0.05, 0.4);
  const kr = popAt(t, 0.45, 0.4);
  const side = (k: number, x: number, rot: number, fill: string, text: string, color: string) => {
    if (k <= 0) return;
    g.save();
    g.translate(x, 0);
    g.scale(k, k);
    card(g, -cw / 2, -ch / 2, cw, ch, u, fill, rot);
    g.rotate(rot);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = fitSize(g, text, FONT_TITLE, '900', 56 * u, cw * 0.82);
    outlined(g, text, 0, 4 * u, size, FONT_TITLE, color, u, CREAM);
    g.restore();
  };
  side(kl, -cw * 0.56, -0.04, '#e3ead0', b.left, '#2e5a2a');
  side(kr, cw * 0.56, 0.04, '#f0d8cc', b.right, RED);
  const kv = popAt(t, 0.8, 0.35);
  if (kv > 0) {
    g.save();
    g.scale(kv, kv);
    g.rotate(Math.sin(time * 4) * 0.08);
    g.fillStyle = GOLD;
    g.strokeStyle = INK;
    g.lineWidth = 6 * u;
    g.beginPath();
    g.arc(0, 0, 54 * u, 0, TAU);
    g.fill();
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    outlined(g, 'VS', 0, 3 * u, 50 * u, FONT_TITLE, CREAM, u);
    g.restore();
  }
  if (b.caption && t > 1.0) {
    g.globalAlpha *= clamp((t - 1.0) / 0.3);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    outlined(g, b.caption, 0, ch / 2 + 34 * u, 30 * u, FONT_TYPE, CREAM, u, INK, '400');
  }
}

function drawDefine(D: Draw, b: Extract<Beat, { kind: 'define' }>) {
  const { g, u, W, t } = D;
  const w = W * 0.9;
  g.font = `400 ${40 * u}px ${FONT_TYPE}`;
  const lines = wrapText(g, b.meaning, w * 0.82);
  const h = (190 + lines.length * 52) * u;
  card(g, -w / 2, -h / 2, w, h, u, '#f6efdc', 0.015, 8);
  // Index-card ruling.
  g.save();
  g.rotate(0.015);
  g.strokeStyle = 'rgba(176, 48, 28, 0.55)';
  g.lineWidth = 2.5 * u;
  g.beginPath();
  g.moveTo(-w / 2 + 14 * u, -h / 2 + 96 * u);
  g.lineTo(w / 2 - 14 * u, -h / 2 + 96 * u);
  g.stroke();
  g.strokeStyle = 'rgba(70, 110, 160, 0.35)';
  for (let i = 0; i < lines.length + 1; i++) {
    const y = -h / 2 + (148 + i * 52) * u;
    g.beginPath();
    g.moveTo(-w / 2 + 14 * u, y);
    g.lineTo(w / 2 - 14 * u, y);
    g.stroke();
  }
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const x = -w / 2 + 44 * u;
  const size = fitSize(g, b.word, FONT_TITLE, '900', 56 * u, w * 0.6);
  g.font = `900 ${size}px ${FONT_TITLE}`;
  g.fillStyle = INK;
  g.fillText(b.word, x, -h / 2 + 78 * u);
  const ww = g.measureText(b.word).width;
  g.font = `italic 700 ${30 * u}px ${FONT_TITLE}`;
  g.fillStyle = RED;
  g.fillText(b.pos, x + ww + 18 * u, -h / 2 + 76 * u);
  // Typewriter reveal of the meaning.
  const total = lines.join(' ').length;
  let shown = Math.floor(clamp((t - 0.35) / 1.3) * total);
  g.font = `400 ${40 * u}px ${FONT_TYPE}`;
  g.fillStyle = '#2a1a10';
  lines.forEach((line, i) => {
    if (shown <= 0) return;
    const part = line.slice(0, shown);
    shown -= line.length + 1;
    g.fillText(part, x, -h / 2 + (140 + i * 52) * u);
  });
  g.restore();
}

function drawWaffle(D: Draw, b: Extract<Beat, { kind: 'waffle' }>) {
  const { g, u, W, t, time } = D;
  const cols = b.total > 100 ? 15 : 10;
  const rows = Math.ceil(b.total / cols);
  const w = W * 0.9;
  const cell = Math.min((w * 0.86) / cols, ((D.V ? 520 : 400) * u) / rows);
  const gw = cell * cols;
  const gh = cell * rows;
  const h = gh + 190 * u;
  card(g, -w / 2, -h / 2, w, h, u, PAPER, -0.01);
  const x0 = -gw / 2;
  const y0 = -h / 2 + 110 * u;
  // Hit squares are spread through the grid so the eye has to find them.
  const hits = new Set<number>();
  for (let i = 0; hits.size < b.hit && i < 200; i++) hits.add(Math.floor(hash(i * 13.7 + 3) * b.total));
  const red = clamp((t - 1.2) / 0.4);
  for (let i = 0; i < b.total; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const appear = clamp((t - 0.15 - (c + r) * 0.025) / 0.25);
    if (appear <= 0) continue;
    const isHit = hits.has(i);
    const s = elastic(appear) * (isHit && red > 0 ? 1 + 0.25 * Math.sin(time * 8) * red : 1);
    g.save();
    g.translate(x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell);
    g.scale(s, s);
    g.fillStyle = isHit && red > 0 ? RED : `rgba(60, 40, 25, ${1 - red * 0.6})`;
    g.strokeStyle = INK;
    g.lineWidth = Math.max(1.5, 2 * u);
    g.beginPath();
    g.roundRect(-cell * 0.4, -cell * 0.4, cell * 0.8, cell * 0.8, cell * 0.15);
    g.fill();
    if (isHit && red > 0) g.stroke();
    g.restore();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const k = popAt(t, 0.05, 0.35);
  if (k > 0) {
    g.save();
    g.translate(0, -h / 2 + 58 * u);
    g.scale(k, k);
    const size = fitSize(g, b.label, FONT_TITLE, '900', 54 * u, w * 0.85);
    outlined(g, b.label, 0, 0, size, FONT_TITLE, red > 0 ? RED : INK, u, CREAM);
    g.restore();
  }
  if (b.note && red > 0) {
    g.globalAlpha *= red;
    g.font = `400 ${fitSize(g, b.note, FONT_TYPE, '400', 30 * u, w * 0.9)}px ${FONT_TYPE}`;
    g.fillStyle = INK;
    g.fillText(b.note, 0, h / 2 - 42 * u);
  }
}

function drawList(D: Draw, b: Extract<Beat, { kind: 'list' }>) {
  const { g, u, W, t } = D;
  const n = b.items.length;
  const rowH = (D.V ? 96 : 84) * u;
  const top = b.title ? 70 * u : 0;
  const h = n * rowH + top + 40 * u;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (b.title) {
    const k = popAt(t, 0, 0.3);
    g.save();
    g.translate(0, -h / 2 + 30 * u);
    g.scale(k, k);
    outlined(g, b.title, 0, 0, 44 * u, FONT_SANS, CREAM, u, INK, '900');
    g.restore();
  }
  b.items.forEach((item, i) => {
    const at = 0.15 + i * 0.42;
    const k = clamp((t - at) / 0.22);
    if (k <= 0) return;
    // Stamp: comes down big and slams.
    const s = 1 + (1 - easeOut(k)) * 1.2;
    const rot = (hash(i * 3.3 + D.seed) - 0.5) * 0.14;
    const y = -h / 2 + top + (i + 0.5) * rowH + 20 * u;
    g.save();
    g.translate((hash(i * 7.1 + D.seed) - 0.5) * W * 0.12, y);
    g.rotate(rot);
    g.scale(s, s);
    g.globalAlpha *= k;
    const size = fitSize(g, item, FONT_TITLE, '900', 58 * u, W * 0.8);
    g.font = `900 ${size}px ${FONT_TITLE}`;
    const tw = g.measureText(item).width + 50 * u;
    g.fillStyle = 'rgba(243, 230, 200, 0.95)';
    g.strokeStyle = RED;
    g.lineWidth = 6 * u;
    g.beginPath();
    g.roundRect(-tw / 2, -rowH * 0.4, tw, rowH * 0.8, 8 * u);
    g.fill();
    g.stroke();
    g.fillStyle = RED;
    g.fillText(item, 0, 3 * u);
    g.restore();
  });
}

function drawRecord(D: Draw, b: Extract<Beat, { kind: 'record' }>) {
  const { g, u, W, t } = D;
  const w = W * 0.95;
  const pad = 46 * u;
  const size = (D.V ? 42 : 40) * u;
  g.font = `400 ${size}px ${FONT_TYPE}`;
  const lines = wrapText(g, b.text, w - pad * 2);
  const lh = size * 1.45;
  // (236: header 134 + the note's own line under the text; with 190 the "paraphrased" note sat on the last line)
  const h = 236 * u + lines.length * lh;
  card(g, -w / 2, -h / 2, w, h, u, '#f2e8d2', -0.008, 4);
  g.save();
  g.rotate(-0.008);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const x = -w / 2 + pad;
  let y = -h / 2 + 64 * u;
  g.font = `700 ${26 * u}px ${FONT_TYPE}`;
  g.fillStyle = RED;
  g.fillText(b.tag, x, y);
  y += 48 * u;
  g.font = `900 ${36 * u}px ${FONT_TITLE}`;
  g.fillStyle = INK;
  g.fillText(b.who, x, y);
  y += 22 * u;
  // Highlighter sweep behind the key phrase.
  const hl = easeOut(clamp((t - 0.9) / 0.8));
  g.font = `400 ${size}px ${FONT_TYPE}`;
  const full = lines.join(' ');
  const hs = full.toLowerCase().indexOf(b.highlight.toLowerCase());
  const he = hs + b.highlight.length;
  let pos = 0;
  lines.forEach((line, i) => {
    const ly = y + (i + 1) * lh;
    const ls = pos;
    const le = pos + line.length;
    if (hs >= 0 && hl > 0 && he > ls && hs < le) {
      const a = Math.max(hs, ls) - ls;
      const bnd = Math.min(he, le) - ls;
      const xa = g.measureText(line.slice(0, a)).width;
      const xb = g.measureText(line.slice(0, bnd)).width;
      // Sweep progresses through the phrase in reading order.
      const phraseLen = he - hs;
      const before = Math.max(0, ls - hs);
      const segLen = bnd - a;
      const local = clamp((hl * phraseLen - before) / Math.max(1, segLen));
      g.fillStyle = 'rgba(245, 205, 60, 0.75)';
      g.fillRect(x + xa - 4 * u, ly - size * 0.9, (xb - xa + 8 * u) * local, size * 1.15);
    }
    g.fillStyle = '#21140c';
    g.fillText(line, x, ly);
    pos = le + 1;
  });
  g.font = `italic 400 ${fitSize(g, b.note, FONT_TITLE, 'italic 400', 24 * u, w * 0.85)}px ${FONT_TITLE}`;
  g.fillStyle = 'rgba(40, 25, 15, 0.75)';
  g.fillText(b.note, x, h / 2 - 34 * u);
  g.restore();
}

function drawStatement(D: Draw, b: Extract<Beat, { kind: 'statement' }>) {
  const { g, u, W, t, time } = D;
  const n = b.lines.length;
  const want = (D.V ? 86 : 74) * u;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Title-card sunburst behind, clipped to a wide oval with an ink rim.
  const k0 = popAt(t, 0, 0.3);
  const R = W * 0.5;
  const ry = want * (0.9 + 0.62 * n);
  g.save();
  g.scale(k0, k0);
  g.fillStyle = 'rgba(10,5,2,0.5)';
  g.beginPath();
  g.ellipse(10 * u, 12 * u, R, ry, 0, 0, TAU);
  g.fill();
  g.save();
  g.beginPath();
  g.ellipse(0, 0, R, ry, 0, 0, TAU);
  g.clip();
  drawSunburst(g, 0, 0, R * 1.2, time * 0.4, '#5a1f10', '#7a2c14', 22);
  g.restore();
  g.strokeStyle = INK;
  g.lineWidth = 7 * u;
  g.beginPath();
  g.ellipse(0, 0, R, ry, 0, 0, TAU);
  g.stroke();
  g.restore();
  b.lines.forEach((line, i) => {
    const k = popAt(t, 0.12 + i * 0.32, 0.32);
    if (k <= 0) return;
    const size = fitSize(g, line, FONT_TITLE, '900', want, W * 0.95);
    g.save();
    g.translate(0, (i - (n - 1) / 2) * want * 1.18);
    g.scale(k, k);
    g.rotate((i % 2 ? 1 : -1) * 0.02);
    outlined(g, line, 0, 0, size, FONT_TITLE, i === n - 1 && n > 1 ? GOLD : CREAM, u);
    g.restore();
  });
}
