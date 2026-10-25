import { TAU, clamp, easeOut, easeOutBack, hash, hash2, lerp, noise1, rng } from './math';
import { FONT_TITLE, FONT_TYPE, wrapText } from './stage';
import { tr } from '../i18n/labels';
import { paintWash } from '../effects/cartoon';

/**
 * Reusable illustrated props and set pieces. All sizes are expressed with a
 * layout unit `u` so the same drawing works at preview and export resolution.
 */

export const INK = '#140d08';
export const PAPER = '#e8dcbf';
export const PAPER_DARK = '#cdbb93';
export const MANILA = '#c99c5c';
export const BRASS = '#b8903f';
export const RED_STRING = '#9b3523';

type G = CanvasRenderingContext2D;

function inked(g: G, fill: string, u: number, w = 4) {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = w * u;
  g.strokeStyle = INK;
  g.stroke();
}

// ---------------------------------------------------------------- Room

export interface RoomOptions {
  light: number;
  blinds: number;
  floorY: number;
  windowX: number;
  windowY: number;
  windowW: number;
  windowH: number;
  rain?: number;
  /** Real seconds for weather and sway. */
  time: number;
  cool?: number;
}

export function drawRoom(g: G, w: number, h: number, u: number, o: RoomOptions) {
  const L = clamp(o.light);
  // Wall.
  const wall = g.createLinearGradient(0, 0, 0, o.floorY);
  wall.addColorStop(0, `rgb(${lerp(40, 118, L)}, ${lerp(26, 78, L)}, ${lerp(18, 46, L)})`);
  wall.addColorStop(1, `rgb(${lerp(62, 150, L)}, ${lerp(40, 100, L)}, ${lerp(24, 58, L)})`);
  g.fillStyle = wall;
  g.fillRect(-w * 0.2, -h * 0.2, w * 1.4, o.floorY + h * 0.2);

  // Wallpaper stripes.
  g.save();
  g.globalAlpha = 0.06 + L * 0.04;
  g.fillStyle = '#000';
  for (let x = -w * 0.2; x < w * 1.2; x += 56 * u) g.fillRect(x, -h * 0.2, 14 * u, o.floorY + h * 0.2);
  g.restore();

  // Wainscot and moulding.
  const wainTop = o.floorY - 150 * u;
  g.fillStyle = `rgba(10, 6, 4, ${0.5 - L * 0.2})`;
  g.fillRect(-w * 0.2, wainTop, w * 1.4, o.floorY - wainTop);
  g.fillStyle = `rgba(150, 110, 70, ${0.12 + L * 0.12})`;
  g.fillRect(-w * 0.2, wainTop, w * 1.4, 6 * u);
  for (let x = -w * 0.2; x < w * 1.2; x += 220 * u) {
    g.strokeStyle = `rgba(0,0,0,0.35)`;
    g.lineWidth = 3 * u;
    g.strokeRect(x + 20 * u, wainTop + 26 * u, 180 * u, 96 * u);
  }

  // Window with the night city behind venetian blinds.
  const { windowX: wx, windowY: wy, windowW: ww, windowH: wh } = o;
  g.save();
  g.beginPath();
  g.rect(wx, wy, ww, wh);
  g.clip();
  const sky = g.createLinearGradient(0, wy, 0, wy + wh);
  sky.addColorStop(0, `rgb(${lerp(18, 120, L)}, ${lerp(24, 120, L)}, ${lerp(34, 112, L)})`);
  sky.addColorStop(1, `rgb(${lerp(40, 196, L)}, ${lerp(38, 160, L)}, ${lerp(40, 110, L)})`);
  g.fillStyle = sky;
  g.fillRect(wx, wy, ww, wh);
  // Skyline (seeded, never changes).
  const r = rng(42);
  let bx = wx - 10 * u;
  while (bx < wx + ww) {
    const bw = (30 + r() * 60) * u;
    const bh = (60 + r() * 160) * u;
    g.fillStyle = `rgb(${lerp(10, 70, L)}, ${lerp(10, 58, L)}, ${lerp(14, 52, L)})`;
    g.fillRect(bx, wy + wh - bh, bw, bh);
    for (let yy = wy + wh - bh + 10 * u; yy < wy + wh - 8 * u; yy += 18 * u) {
      for (let xx = bx + 6 * u; xx < bx + bw - 8 * u; xx += 14 * u) {
        if (r() > 0.72) {
          g.fillStyle = `rgba(240, 190, 110, ${0.5 - L * 0.3})`;
          g.fillRect(xx, yy, 5 * u, 7 * u);
        }
      }
    }
    bx += bw + 4 * u;
  }
  if (o.rain && o.rain > 0) drawRain(g, wx, wy, ww, wh, u, o.time, o.rain);
  g.restore();

  // Blinds.
  const slats = 14;
  const open = clamp(o.blinds);
  for (let i = 0; i < slats; i++) {
    const y = wy + (i + 0.5) * (wh / slats);
    const th = (wh / slats) * (1 - open * 0.75);
    g.fillStyle = `rgb(${lerp(48, 150, L)}, ${lerp(38, 122, L)}, ${lerp(28, 86, L)})`;
    g.fillRect(wx - 4 * u, y - th / 2, ww + 8 * u, th);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(wx - 4 * u, y + th / 2 - 2 * u, ww + 8 * u, 2 * u);
  }
  g.lineWidth = 12 * u;
  g.strokeStyle = '#2a1c12';
  g.strokeRect(wx, wy, ww, wh);
  g.lineWidth = 3 * u;
  g.strokeStyle = INK;
  g.strokeRect(wx - 6 * u, wy - 6 * u, ww + 12 * u, wh + 12 * u);

  // Light shafts thrown by the blinds across the room.
  g.save();
  g.globalCompositeOperation = 'lighter';
  const sway = Math.sin(o.time * 0.4) * 10 * u;
  const strength = 0.035 + L * 0.05 + open * 0.03;
  for (let i = 0; i < 7; i++) {
    const y0 = wy + (i + 0.3) * (wh / 7);
    const y1 = y0 + (wh / 7) * 0.45;
    const dx = -w * 0.5;
    const dy = h * 0.42;
    g.beginPath();
    g.moveTo(wx + ww, y0);
    g.lineTo(wx + ww, y1);
    g.lineTo(wx + dx + sway, y1 + dy);
    g.lineTo(wx + dx + sway, y0 + dy);
    g.closePath();
    g.fillStyle = o.cool ? `rgba(150, 170, 200, ${strength})` : `rgba(255, 210, 150, ${strength})`;
    g.fill();
  }
  g.restore();

  // Floorboards.
  const floor = g.createLinearGradient(0, o.floorY, 0, h * 1.2);
  floor.addColorStop(0, `rgb(${lerp(70, 128, L)}, ${lerp(42, 78, L)}, ${lerp(22, 40, L)})`);
  floor.addColorStop(1, '#1e120a');
  g.fillStyle = floor;
  g.fillRect(-w * 0.2, o.floorY, w * 1.4, h * 1.2 - o.floorY);
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 2 * u;
  for (let i = -12; i < 14; i++) {
    g.beginPath();
    g.moveTo(w / 2 + i * 80 * u, o.floorY);
    g.lineTo(w / 2 + i * 190 * u, h * 1.2);
    g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(-w * 0.2, o.floorY - 4 * u, w * 1.4, 8 * u);
  paintWash(g, w, h, 1, 0.6);
}

export function drawRain(g: G, x: number, y: number, w: number, h: number, u: number, time: number, amount: number) {
  g.save();
  g.strokeStyle = `rgba(190, 205, 220, ${0.35 * amount})`;
  g.lineWidth = 1.6 * u;
  const n = Math.floor(70 * amount);
  for (let i = 0; i < n; i++) {
    const speed = 0.9 + hash(i * 3) * 0.6;
    const px = x + hash(i * 7 + 1) * w;
    const py = y + (((hash(i * 11 + 2) + time * speed) % 1) * (h + 60 * u)) - 30 * u;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px - 4 * u, py + 22 * u);
    g.stroke();
  }
  // Droplets sliding down the glass.
  for (let i = 0; i < 9; i++) {
    const px = x + hash(i * 13 + 5) * w;
    const prog = (hash(i * 17) + time * 0.08 * (0.5 + hash(i))) % 1;
    const py = y + prog * h;
    g.fillStyle = `rgba(210, 225, 235, ${0.4 * amount})`;
    g.beginPath();
    g.ellipse(px, py, 3 * u, 4.5 * u, 0, 0, TAU);
    g.fill();
    g.fillRect(px - 1 * u, py - 40 * u * prog, 2 * u, 40 * u * prog);
  }
  g.restore();
}

// ---------------------------------------------------------------- Furniture

export function drawDesk(g: G, x: number, y: number, width: number, height: number, u: number) {
  // Top.
  g.beginPath();
  g.rect(x, y, width, 26 * u);
  inked(g, '#5a3b25', u);
  g.fillStyle = 'rgba(255, 210, 150, 0.12)';
  g.fillRect(x + 4 * u, y + 3 * u, width - 8 * u, 6 * u);
  // Body with drawers.
  g.beginPath();
  g.rect(x + 18 * u, y + 26 * u, width - 36 * u, height - 26 * u);
  inked(g, '#3e2818', u);
  const dw = (width - 36 * u) / 3;
  for (let i = 0; i < 3; i++) {
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 3 * u;
    g.strokeRect(x + 18 * u + i * dw + 10 * u, y + 44 * u, dw - 20 * u, height * 0.36);
    g.fillStyle = BRASS;
    g.beginPath();
    g.arc(x + 18 * u + i * dw + dw / 2, y + 44 * u + height * 0.18, 5 * u, 0, TAU);
    g.fill();
  }
}

export function drawLamp(g: G, x: number, y: number, u: number, on: number, flipped = false) {
  g.save();
  g.translate(x, y);
  if (flipped) g.scale(-1, 1);
  if (on > 0) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const cone = g.createRadialGradient(40 * u, -150 * u, 10 * u, 40 * u, 40 * u, 420 * u);
    cone.addColorStop(0, `rgba(255, 200, 120, ${0.42 * on})`);
    cone.addColorStop(1, 'rgba(255, 200, 120, 0)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(0, -170 * u);
    g.lineTo(-260 * u, 40 * u);
    g.lineTo(360 * u, 40 * u);
    g.lineTo(90 * u, -170 * u);
    g.closePath();
    g.fill();
    g.restore();
  }
  // Base and arm.
  g.beginPath();
  g.ellipse(0, 0, 46 * u, 12 * u, 0, 0, TAU);
  inked(g, '#2f2118', u);
  g.beginPath();
  g.moveTo(0, -8 * u);
  g.lineTo(-10 * u, -130 * u);
  g.lineTo(30 * u, -170 * u);
  g.lineWidth = 10 * u;
  g.strokeStyle = INK;
  g.stroke();
  g.lineWidth = 5 * u;
  g.strokeStyle = BRASS;
  g.stroke();
  // Shade.
  g.beginPath();
  g.moveTo(10 * u, -196 * u);
  g.lineTo(96 * u, -176 * u);
  g.lineTo(110 * u, -140 * u);
  g.lineTo(-10 * u, -150 * u);
  g.closePath();
  inked(g, '#3c4a33', u);
  g.fillStyle = `rgba(255, 220, 150, ${0.2 + on * 0.75})`;
  g.beginPath();
  g.ellipse(50 * u, -145 * u, 52 * u, 8 * u, 0.06, 0, TAU);
  g.fill();
  g.restore();
}

export function drawChair(g: G, x: number, y: number, u: number, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.fillStyle = '#1a120c';
  g.strokeStyle = INK;
  g.lineWidth = 4 * u;
  g.beginPath();
  g.rect(-70 * u, -140 * u, 140 * u, 18 * u);
  g.fill();
  g.stroke();
  g.beginPath();
  g.rect(-62 * u, -320 * u, 14 * u, 190 * u);
  g.rect(48 * u, -320 * u, 14 * u, 190 * u);
  g.rect(-62 * u, -320 * u, 124 * u, 30 * u);
  g.rect(-62 * u, -250 * u, 124 * u, 14 * u);
  g.fill();
  g.stroke();
  for (const lx of [-62, 48]) {
    g.beginPath();
    g.rect(lx * u, -124 * u, 14 * u, 124 * u);
    g.fill();
    g.stroke();
  }
  g.restore();
}

export function drawHangingBulb(g: G, x: number, ceilY: number, length: number, u: number, time: number, glow: number) {
  const swing = Math.sin(time * 1.1) * 0.08;
  const bx = x + Math.sin(swing) * length;
  const by = ceilY + Math.cos(swing) * length;
  g.save();
  g.strokeStyle = INK;
  g.lineWidth = 3 * u;
  g.beginPath();
  g.moveTo(x, ceilY);
  g.lineTo(bx, by);
  g.stroke();
  g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(bx, by + 18 * u, 4 * u, bx, by + 18 * u, 520 * u);
  halo.addColorStop(0, `rgba(255, 214, 150, ${0.5 * glow})`);
  halo.addColorStop(0.3, `rgba(255, 190, 120, ${0.12 * glow})`);
  halo.addColorStop(1, 'rgba(255, 190, 120, 0)');
  g.fillStyle = halo;
  g.fillRect(bx - 520 * u, by - 520 * u, 1040 * u, 1040 * u);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#2a2016';
  g.fillRect(bx - 8 * u, by - 4 * u, 16 * u, 14 * u);
  g.beginPath();
  g.ellipse(bx, by + 22 * u, 14 * u, 17 * u, 0, 0, TAU);
  g.fillStyle = `rgba(255, 232, 180, ${0.6 + glow * 0.4})`;
  g.fill();
  g.restore();
  return { x: bx, y: by + 22 * u };
}

// ---------------------------------------------------------------- Paper

export interface PaperOptions {
  heading?: string;
  subheading?: string;
  lines?: number;
  redact?: boolean;
  seed?: number;
  /** 0..1, how much of the page is burnt away from the edges. */
  burnt?: number;
  tone?: string;
  highlightLine?: number;
  headingSize?: number;
  bodyText?: string[];
  bodySize?: number;
}

export function drawPaper(g: G, x: number, y: number, pw: number, ph: number, rot: number, u: number, o: PaperOptions = {}) {
  const r = rng(o.seed ?? 1);
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  // Drop shadow.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(-pw / 2 + 8 * u, -ph / 2 + 10 * u, pw, ph);

  const outline = () => {
    g.beginPath();
    if (o.burnt && o.burnt > 0) {
      // Ragged, burnt edge: an irregular polygon shrinking inward.
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * TAU;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        const k = Math.min(1 / Math.abs(cx || 1e-6), 1 / Math.abs(cy || 1e-6));
        const bite = o.burnt * (0.12 + hash2(o.seed ?? 1, i) * 0.22);
        const px = cx * k * (pw / 2) * (1 - bite);
        const py = cy * k * (ph / 2) * (1 - bite);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
    } else {
      g.rect(-pw / 2, -ph / 2, pw, ph);
    }
  };

  outline();
  g.fillStyle = o.tone ?? PAPER;
  g.fill();
  g.save();
  g.clip();
  // Aged paper texture.
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(120, 85, 40, ${0.05 + r() * 0.05})`;
    g.beginPath();
    g.ellipse((r() - 0.5) * pw, (r() - 0.5) * ph, (0.1 + r() * 0.3) * pw, (0.06 + r() * 0.2) * ph, r() * 3, 0, TAU);
    g.fill();
  }
  let cursor = -ph / 2 + 30 * u;
  if (o.heading) {
    const size = (o.headingSize ?? 22) * u;
    g.font = `${size}px ${FONT_TYPE}`;
    g.fillStyle = '#21140b';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    const lines = wrapText(g, o.heading, pw - 40 * u);
    for (const line of lines) {
      g.fillText(line, -pw / 2 + 20 * u, cursor);
      cursor += size * 1.2;
    }
    if (o.subheading) {
      g.font = `${size * 0.7}px ${FONT_TYPE}`;
      g.fillStyle = '#4b3420';
      for (const line of wrapText(g, o.subheading, pw - 40 * u)) {
        g.fillText(line, -pw / 2 + 20 * u, cursor);
        cursor += size * 0.85;
      }
    }
    g.fillStyle = 'rgba(33, 20, 11, 0.6)';
    g.fillRect(-pw / 2 + 20 * u, cursor + 4 * u, pw - 40 * u, 2 * u);
    cursor += 18 * u;
  }
  if (o.bodyText) {
    const size = (o.bodySize ?? 18) * u;
    g.font = `${size}px ${FONT_TYPE}`;
    g.fillStyle = '#2a1a0e';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    for (const para of o.bodyText) {
      for (const line of wrapText(g, para, pw - 40 * u)) {
        g.fillText(line, -pw / 2 + 20 * u, cursor);
        cursor += size * 1.3;
      }
      cursor += size * 0.4;
    }
  }
  const n = o.lines ?? 0;
  for (let i = 0; i < n && cursor < ph / 2 - 20 * u; i++) {
    const lw = (pw - 40 * u) * (0.55 + r() * 0.45);
    const redacted = o.redact && r() > 0.62;
    g.fillStyle = redacted ? '#0d0906' : i === o.highlightLine ? 'rgba(200, 130, 40, 0.9)' : 'rgba(60, 42, 25, 0.42)';
    g.fillRect(-pw / 2 + 20 * u, cursor, redacted ? lw * 0.8 : lw, (redacted ? 11 : 5) * u);
    cursor += 15 * u;
  }
  if (o.burnt && o.burnt > 0) {
    const edge = g.createRadialGradient(0, 0, Math.min(pw, ph) * 0.2, 0, 0, Math.max(pw, ph) * 0.62);
    edge.addColorStop(0, 'rgba(60, 25, 5, 0)');
    edge.addColorStop(1, `rgba(40, 15, 2, ${0.9 * o.burnt})`);
    g.fillStyle = edge;
    g.fillRect(-pw, -ph, pw * 2, ph * 2);
  }
  g.restore();
  outline();
  g.lineWidth = 3 * u;
  g.strokeStyle = INK;
  g.stroke();
  g.restore();
}

export function drawStamp(g: G, text: string, x: number, y: number, size: number, rot: number, p: number, color = '#9b2f1f') {
  if (p <= 0) return;
  // (translated here, so the frame is measured on the words actually drawn)
  text = tr(text);
  const s = lerp(1.8, 1, easeOutBack(clamp(p)));
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s, s);
  g.globalAlpha = clamp(p * 2.2) * 0.88;
  g.font = `700 ${size}px ${FONT_TYPE}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const tw = g.measureText(text).width;
  g.strokeStyle = color;
  g.lineWidth = size * 0.1;
  g.strokeRect(-tw / 2 - size * 0.4, -size * 0.75, tw + size * 0.8, size * 1.5);
  g.fillStyle = color;
  g.fillText(text, 0, size * 0.05);
  g.restore();
}

export interface CardOptions {
  title?: string;
  lines: string[];
  width: number;
  size: number;
  u: number;
  rot?: number;
  reveal?: number;
  tone?: string;
  accent?: string;
  align?: 'left' | 'center';
  pin?: boolean;
}

/** A typed index card. Returns its height. */
export function drawCard(g: G, x: number, y: number, o: CardOptions): number {
  const { u, size, width } = o;
  g.save();
  g.font = `${size}px ${FONT_TYPE}`;
  const wrapped = o.lines.flatMap((line) => (line ? wrapText(g, line, width - 44 * u) : ['']));
  let titleLines: string[] = [];
  if (o.title) {
    g.font = `700 ${size * 1.08}px ${FONT_TYPE}`;
    titleLines = wrapText(g, o.title, width - 44 * u);
  }
  const height = 40 * u + titleLines.length * size * 1.35 + (titleLines.length ? 14 * u : 0) + wrapped.length * size * 1.35;
  g.translate(x, y);
  g.rotate(o.rot ?? 0);
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(-width / 2 + 8 * u, -height / 2 + 10 * u, width, height);
  g.beginPath();
  g.rect(-width / 2, -height / 2, width, height);
  inked(g, o.tone ?? PAPER, u, 3);
  // Ruled lines like an index card.
  g.strokeStyle = 'rgba(155, 53, 35, 0.35)';
  g.lineWidth = 2 * u;
  g.beginPath();
  g.moveTo(-width / 2, -height / 2 + 26 * u);
  g.lineTo(width / 2, -height / 2 + 26 * u);
  g.stroke();
  const reveal = o.reveal ?? 1;
  const totalChars = [...titleLines, ...wrapped].reduce((a, l) => a + l.length, 0);
  let chars = Math.floor(totalChars * clamp(reveal));
  let cy = -height / 2 + 34 * u;
  g.textBaseline = 'top';
  g.textAlign = o.align ?? 'left';
  const tx = o.align === 'center' ? 0 : -width / 2 + 22 * u;
  if (titleLines.length) {
    g.font = `700 ${size * 1.08}px ${FONT_TYPE}`;
    g.fillStyle = o.accent ?? '#7d2a1a';
    for (const line of titleLines) {
      const part = line.slice(0, Math.max(0, chars));
      chars -= line.length;
      g.fillText(part, tx, cy);
      cy += size * 1.35;
    }
    cy += 14 * u;
  }
  g.font = `${size}px ${FONT_TYPE}`;
  g.fillStyle = '#21140b';
  for (const line of wrapped) {
    const part = line.slice(0, Math.max(0, chars));
    chars -= line.length;
    g.fillText(part, tx, cy);
    cy += size * 1.35;
  }
  if (o.pin) drawPin(g, 0, -height / 2 + 10 * u, u);
  g.restore();
  return height;
}

export function drawPin(g: G, x: number, y: number, u: number, color = '#9b3523') {
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.beginPath();
  g.ellipse(x + 5 * u, y + 6 * u, 9 * u, 6 * u, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(x, y, 10 * u, 0, TAU);
  inked(g, color, u, 2.5);
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.beginPath();
  g.arc(x - 3 * u, y - 3 * u, 3 * u, 0, TAU);
  g.fill();
  g.restore();
}

// ---------------------------------------------------------------- Folder

/** cover: 1 = closed, 0 = edge-on, -1 = fully open. */
export function drawFolder(g: G, x: number, y: number, fw: number, fh: number, rot: number, cover: number, u: number, label = 'MKULTRA') {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(-fw / 2 + 10 * u, -fh / 2 + 12 * u, fw, fh);
  // Back panel with tab.
  g.beginPath();
  g.moveTo(-fw / 2, -fh / 2);
  g.lineTo(-fw / 2 + fw * 0.08, -fh / 2 - 24 * u);
  g.lineTo(-fw / 2 + fw * 0.38, -fh / 2 - 24 * u);
  g.lineTo(-fw / 2 + fw * 0.44, -fh / 2);
  g.lineTo(fw / 2, -fh / 2);
  g.lineTo(fw / 2, fh / 2);
  g.lineTo(-fw / 2, fh / 2);
  g.closePath();
  inked(g, '#a87c43', u);
  // Papers inside.
  if (cover < 0.98) {
    drawPaper(g, 4 * u, 2 * u, fw * 0.88, fh * 0.9, -0.02, u, { lines: 14, redact: true, seed: 7, heading: 'SUBPROJECT', headingSize: 16 });
  }
  // Cover hinged on the left edge.
  if (Math.abs(cover) > 0.02) {
    g.save();
    g.translate(-fw / 2, 0);
    g.scale(cover, 1);
    g.beginPath();
    g.rect(0, -fh / 2, fw, fh);
    inked(g, cover > 0 ? MANILA : '#b58a4e', u);
    if (cover > 0.3) {
      g.save();
      g.scale(1 / Math.max(cover, 0.3), 1);
      g.fillStyle = PAPER;
      g.fillRect(fw * 0.18 * cover, -fh * 0.3, fw * 0.62 * cover, 60 * u);
      g.strokeStyle = INK;
      g.lineWidth = 2 * u;
      g.strokeRect(fw * 0.18 * cover, -fh * 0.3, fw * 0.62 * cover, 60 * u);
      g.font = `${30 * u}px ${FONT_TYPE}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#1b110a';
      g.fillText(label, fw * 0.49 * cover, -fh * 0.3 + 30 * u);
      g.restore();
      drawStamp(g, 'FOUND IN 1977', fw * 0.5, fh * 0.12, 24 * u, -0.18, 1);
    }
    g.restore();
  }
  g.restore();
}

// ---------------------------------------------------------------- Archive & map

export function drawMap(g: G, x: number, y: number, mw: number, mh: number, u: number, time: number) {
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(10 * u, 12 * u, mw, mh);
  g.beginPath();
  g.rect(0, 0, mw, mh);
  inked(g, '#d8c69c', u);
  g.save();
  g.beginPath();
  g.rect(0, 0, mw, mh);
  g.clip();
  // Grid.
  g.strokeStyle = 'rgba(80, 55, 30, 0.35)';
  g.lineWidth = 1.5 * u;
  for (let gx = 0; gx < mw; gx += mw / 8) {
    g.beginPath();
    g.moveTo(gx, 0);
    g.lineTo(gx, mh);
    g.stroke();
  }
  for (let gy = 0; gy < mh; gy += mh / 5) {
    g.beginPath();
    g.moveTo(0, gy);
    g.lineTo(mw, gy);
    g.stroke();
  }
  // Abstract landmass (stylised — not a real coastline).
  g.beginPath();
  const cx = mw * 0.5;
  const cy = mh * 0.52;
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * TAU;
    const rr = 1 + noise1(i * 0.35, 9) * 0.18 + noise1(i * 1.3, 4) * 0.06;
    const px = cx + Math.cos(a) * mw * 0.4 * rr;
    const py = cy + Math.sin(a) * mh * 0.32 * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = 'rgba(176, 140, 86, 0.55)';
  g.fill();
  g.strokeStyle = 'rgba(70, 45, 22, 0.8)';
  g.lineWidth = 2.5 * u;
  g.stroke();
  // Compass rose.
  g.translate(mw * 0.86, mh * 0.2);
  g.rotate(Math.sin(time * 0.3) * 0.04);
  g.fillStyle = 'rgba(70, 40, 20, 0.85)';
  for (let i = 0; i < 4; i++) {
    g.rotate(TAU / 4);
    g.beginPath();
    g.moveTo(0, -34 * u);
    g.lineTo(7 * u, 0);
    g.lineTo(-7 * u, 0);
    g.closePath();
    g.fill();
  }
  g.font = `${16 * u}px ${FONT_TYPE}`;
  g.textAlign = 'center';
  g.fillText('N', 0, -40 * u);
  g.restore();
  g.font = `${18 * u}px ${FONT_TYPE}`;
  g.fillStyle = '#3b2716';
  g.textAlign = 'left';
  g.fillText('ILLUSTRATIVE MAP', 14 * u, mh - 14 * u);
  g.restore();
}

/** Map pin positions, normalised to the map rectangle. Seeded and fixed. */
export const MAP_PINS = (() => {
  const r = rng(314);
  return Array.from({ length: 18 }, () => ({ x: 0.18 + r() * 0.64, y: 0.28 + r() * 0.48 }));
})();

export function drawArchiveStrip(g: G, x: number, y: number, width: number, u: number, time: number, labels: string[]) {
  const cell = 230 * u;
  const offset = time * 26 * u;
  const shift = Math.floor(offset / cell);
  g.save();
  g.beginPath();
  g.rect(x, y, width, 120 * u);
  g.clip();
  g.fillStyle = '#2c2119';
  g.fillRect(x, y, width, 120 * u);
  for (let i = 0; i < width / cell + 2; i++) {
    const idx = (i + shift) % labels.length;
    const px = x + i * cell - (offset - shift * cell);
    g.fillStyle = '#4a3828';
    g.fillRect(px + 8 * u, y + 10 * u, cell - 16 * u, 100 * u);
    g.strokeStyle = INK;
    g.lineWidth = 3 * u;
    g.strokeRect(px + 8 * u, y + 10 * u, cell - 16 * u, 100 * u);
    g.fillStyle = '#d9c89f';
    g.fillRect(px + 40 * u, y + 30 * u, cell - 80 * u, 32 * u);
    g.fillStyle = '#21140b';
    g.font = `${15 * u}px ${FONT_TYPE}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(labels[idx], px + cell / 2, y + 47 * u);
    g.fillStyle = BRASS;
    g.fillRect(px + cell / 2 - 24 * u, y + 76 * u, 48 * u, 10 * u);
  }
  g.restore();
}

// ---------------------------------------------------------------- Laboratory

export function drawLabWall(g: G, w: number, h: number, u: number, floorY: number, light: number) {
  g.fillStyle = `rgb(${lerp(46, 92, light)}, ${lerp(52, 88, light)}, ${lerp(40, 62, light)})`;
  g.fillRect(-w * 0.2, -h * 0.2, w * 1.4, floorY + h * 0.2);
  // Tiles.
  const tile = 64 * u;
  g.strokeStyle = 'rgba(0,0,0,0.28)';
  g.lineWidth = 2 * u;
  for (let x = -w * 0.2; x < w * 1.2; x += tile) {
    g.beginPath();
    g.moveTo(x, floorY - 420 * u);
    g.lineTo(x, floorY);
    g.stroke();
  }
  for (let y = floorY; y > floorY - 420 * u; y -= tile) {
    g.beginPath();
    g.moveTo(-w * 0.2, y);
    g.lineTo(w * 1.2, y);
    g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(-w * 0.2, floorY - 424 * u, w * 1.4, 8 * u);
  g.fillStyle = '#2a1c12';
  g.fillRect(-w * 0.2, floorY, w * 1.4, h);
  paintWash(g, w, h, 3, 0.55);
}

export function drawShelf(g: G, x: number, y: number, width: number, u: number, seed: number) {
  g.fillStyle = '#3a271a';
  g.strokeStyle = INK;
  g.lineWidth = 3 * u;
  g.beginPath();
  g.rect(x, y, width, 14 * u);
  g.fill();
  g.stroke();
  const r = rng(seed);
  let bx = x + 14 * u;
  while (bx < x + width - 40 * u) {
    const bw = (20 + r() * 26) * u;
    const bh = (40 + r() * 70) * u;
    const neck = bw * 0.35;
    g.beginPath();
    if (r() > 0.5) {
      g.moveTo(bx, y);
      g.lineTo(bx, y - bh * 0.6);
      g.lineTo(bx + bw / 2 - neck / 2, y - bh * 0.75);
      g.lineTo(bx + bw / 2 - neck / 2, y - bh);
      g.lineTo(bx + bw / 2 + neck / 2, y - bh);
      g.lineTo(bx + bw / 2 + neck / 2, y - bh * 0.75);
      g.lineTo(bx + bw, y - bh * 0.6);
      g.lineTo(bx + bw, y);
    } else {
      g.moveTo(bx + bw / 2 - neck / 2, y - bh);
      g.lineTo(bx + bw / 2 + neck / 2, y - bh);
      g.lineTo(bx + bw / 2 + neck / 2, y - bh * 0.55);
      g.lineTo(bx + bw, y);
      g.lineTo(bx, y);
      g.lineTo(bx + bw / 2 - neck / 2, y - bh * 0.55);
    }
    g.closePath();
    g.fillStyle = `rgba(${120 + r() * 60}, ${110 + r() * 50}, ${80 + r() * 40}, 0.35)`;
    g.fill();
    g.lineWidth = 2.5 * u;
    g.stroke();
    bx += bw + (8 + r() * 18) * u;
  }
}

export function drawVial(g: G, x: number, y: number, u: number, time: number, glow: number, label?: string) {
  g.save();
  g.translate(x, y);
  const vw = 54 * u;
  const vh = 150 * u;
  if (glow > 0) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(0, -vh * 0.4, 4 * u, 0, -vh * 0.4, 160 * u);
    gr.addColorStop(0, `rgba(240, 200, 120, ${0.4 * glow})`);
    gr.addColorStop(1, 'rgba(240, 200, 120, 0)');
    g.fillStyle = gr;
    g.fillRect(-160 * u, -vh - 120 * u, 320 * u, 320 * u);
    g.restore();
  }
  const body = () => {
    g.beginPath();
    g.moveTo(-vw / 2, -vh);
    g.lineTo(-vw / 2, -18 * u);
    g.quadraticCurveTo(-vw / 2, 0, 0, 0);
    g.quadraticCurveTo(vw / 2, 0, vw / 2, -18 * u);
    g.lineTo(vw / 2, -vh);
  };
  body();
  g.fillStyle = 'rgba(210, 225, 215, 0.22)';
  g.fill();
  // Liquid with a sloshing meniscus.
  g.save();
  body();
  g.clip();
  const level = -vh * 0.52;
  g.beginPath();
  g.moveTo(-vw, 10 * u);
  for (let i = 0; i <= 12; i++) {
    const px = -vw / 2 + (i / 12) * vw;
    g.lineTo(px, level + Math.sin(time * 3 + i * 0.7) * 3 * u);
  }
  g.lineTo(vw, 10 * u);
  g.closePath();
  g.fillStyle = 'rgba(205, 160, 80, 0.75)';
  g.fill();
  // Rising bubbles.
  for (let i = 0; i < 6; i++) {
    const p = (time * (0.25 + hash(i) * 0.3) + hash(i * 9)) % 1;
    const bx = (hash(i * 5) - 0.5) * vw * 0.6;
    const by = lerp(-6 * u, level, p);
    g.strokeStyle = 'rgba(255, 245, 220, 0.6)';
    g.lineWidth = 1.5 * u;
    g.beginPath();
    g.arc(bx + Math.sin(time * 4 + i) * 2 * u, by, (2 + hash(i * 3) * 3) * u, 0, TAU);
    g.stroke();
  }
  g.restore();
  body();
  g.lineWidth = 4 * u;
  g.strokeStyle = INK;
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(-vw / 2 + 8 * u, -vh + 10 * u, 6 * u, vh - 40 * u);
  // Stopper.
  g.beginPath();
  g.rect(-vw / 2 - 4 * u, -vh - 26 * u, vw + 8 * u, 28 * u);
  inked(g, '#5b3722', u, 3);
  if (label) {
    g.fillStyle = PAPER;
    g.fillRect(-vw / 2 + 2 * u, -vh * 0.4, vw - 4 * u, 30 * u);
    g.strokeStyle = INK;
    g.lineWidth = 2 * u;
    g.strokeRect(-vw / 2 + 2 * u, -vh * 0.4, vw - 4 * u, 30 * u);
    g.fillStyle = '#21140b';
    g.font = `${16 * u}px ${FONT_TYPE}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 0, -vh * 0.4 + 16 * u);
  }
  g.restore();
}

export function drawReelRecorder(g: G, x: number, y: number, u: number, time: number, spin: number) {
  g.save();
  g.translate(x, y);
  const bw = 260 * u;
  const bh = 170 * u;
  g.beginPath();
  g.roundRect(-bw / 2, -bh, bw, bh, 14 * u);
  inked(g, '#4a3a2c', u);
  g.fillStyle = '#2b2119';
  g.fillRect(-bw / 2 + 14 * u, -bh + 14 * u, bw - 28 * u, bh - 64 * u);
  const reels = [-62, 62];
  for (const [i, rx] of reels.entries()) {
    g.save();
    g.translate(rx * u, -bh + 66 * u);
    g.rotate(time * spin * (i === 0 ? 2.2 : 2.6));
    g.beginPath();
    g.arc(0, 0, 46 * u, 0, TAU);
    inked(g, '#8a7458', u, 3);
    g.fillStyle = '#2b2119';
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.arc(Math.cos((k * TAU) / 3) * 24 * u, Math.sin((k * TAU) / 3) * 24 * u, 11 * u, 0, TAU);
      g.fill();
    }
    g.beginPath();
    g.arc(0, 0, 7 * u, 0, TAU);
    inked(g, BRASS, u, 2);
    g.restore();
  }
  // Tape path.
  g.strokeStyle = '#1a120c';
  g.lineWidth = 3 * u;
  g.beginPath();
  g.moveTo(-62 * u, -bh + 112 * u);
  g.lineTo(0, -bh + 124 * u);
  g.lineTo(62 * u, -bh + 112 * u);
  g.stroke();
  // VU meter.
  g.fillStyle = '#e0cf9f';
  g.fillRect(-36 * u, -44 * u, 72 * u, 32 * u);
  g.strokeStyle = INK;
  g.lineWidth = 2 * u;
  g.strokeRect(-36 * u, -44 * u, 72 * u, 32 * u);
  const needle = -0.9 + (0.5 + noise1(time * 4, 2) * 0.5) * 1.8 * clamp(spin);
  g.beginPath();
  g.moveTo(0, -14 * u);
  g.lineTo(Math.sin(needle) * 26 * u, -14 * u - Math.cos(needle) * 26 * u);
  g.strokeStyle = '#8f2b1b';
  g.stroke();
  for (const kx of [-96, -70, 70, 96]) {
    g.beginPath();
    g.arc(kx * u, -26 * u, 10 * u, 0, TAU);
    inked(g, '#1f1712', u, 2);
  }
  g.restore();
}

export function drawPendulumWatch(g: G, x: number, y: number, u: number, time: number, visible: number) {
  if (visible <= 0) return;
  g.save();
  g.globalAlpha = clamp(visible);
  // Stand.
  g.strokeStyle = INK;
  g.lineWidth = 8 * u;
  g.beginPath();
  g.moveTo(x - 60 * u, y);
  g.lineTo(x - 60 * u, y - 230 * u);
  g.lineTo(x + 10 * u, y - 230 * u);
  g.stroke();
  g.strokeStyle = BRASS;
  g.lineWidth = 4 * u;
  g.stroke();
  const a = Math.sin(time * 2.1) * 0.5;
  const len = 150 * u;
  const px = x + 10 * u + Math.sin(a) * len;
  const py = y - 230 * u + Math.cos(a) * len;
  g.strokeStyle = '#d8b56a';
  g.lineWidth = 2 * u;
  g.beginPath();
  g.moveTo(x + 10 * u, y - 230 * u);
  g.lineTo(px, py);
  g.stroke();
  g.beginPath();
  g.arc(px, py + 22 * u, 24 * u, 0, TAU);
  inked(g, BRASS, u, 3);
  g.beginPath();
  g.arc(px, py + 22 * u, 17 * u, 0, TAU);
  g.fillStyle = '#efe4c8';
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 2 * u;
  g.beginPath();
  g.moveTo(px, py + 22 * u);
  g.lineTo(px, py + 10 * u);
  g.moveTo(px, py + 22 * u);
  g.lineTo(px + 8 * u, py + 25 * u);
  g.stroke();
  g.restore();
}

// ---------------------------------------------------------------- Evidence board

export function drawCorkboard(g: G, x: number, y: number, bw: number, bh: number, u: number) {
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(x + 12 * u, y + 14 * u, bw, bh);
  g.beginPath();
  g.rect(x, y, bw, bh);
  inked(g, '#5b3a22', u, 4);
  g.fillStyle = '#9c7448';
  g.fillRect(x + 22 * u, y + 22 * u, bw - 44 * u, bh - 44 * u);
  const r = rng(77);
  for (let i = 0; i < 600; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(70, 45, 22, 0.35)' : 'rgba(200, 160, 110, 0.25)';
    g.fillRect(x + 22 * u + r() * (bw - 44 * u), y + 22 * u + r() * (bh - 44 * u), 3 * u, 3 * u);
  }
  g.strokeStyle = INK;
  g.lineWidth = 3 * u;
  g.strokeRect(x + 22 * u, y + 22 * u, bw - 44 * u, bh - 44 * u);
  g.restore();
}

/** Red string drawn progressively from a to b with a slight sag. */
export function drawString(g: G, ax: number, ay: number, bx: number, by: number, p: number, u: number) {
  if (p <= 0) return;
  const q = easeOut(clamp(p));
  const steps = 24;
  g.save();
  g.strokeStyle = RED_STRING;
  g.lineWidth = 3.5 * u;
  g.beginPath();
  for (let i = 0; i <= steps * q; i++) {
    const t = i / steps;
    const px = lerp(ax, bx, t);
    const py = lerp(ay, by, t) + Math.sin(t * Math.PI) * 26 * u;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.stroke();
  g.restore();
}

export function drawRecordBox(g: G, x: number, y: number, u: number, p: number, n: number) {
  if (p <= 0) return;
  const s = easeOutBack(clamp(p));
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.beginPath();
  g.rect(-56 * u, -40 * u, 112 * u, 80 * u);
  inked(g, '#b08a55', u, 3);
  g.fillStyle = '#8c6a3e';
  g.fillRect(-56 * u, -40 * u, 112 * u, 14 * u);
  g.fillStyle = PAPER;
  g.fillRect(-28 * u, -10 * u, 56 * u, 28 * u);
  g.strokeStyle = INK;
  g.lineWidth = 2 * u;
  g.strokeRect(-28 * u, -10 * u, 56 * u, 28 * u);
  g.fillStyle = '#21140b';
  g.font = `${18 * u}px ${FONT_TYPE}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 0, 5 * u);
  g.restore();
}

export function drawCapitolSketch(g: G, x: number, y: number, s: number, u: number) {
  g.save();
  g.translate(x, y);
  g.scale(s * u, s * u);
  g.strokeStyle = '#2a1a0e';
  g.lineWidth = 2.2;
  g.fillStyle = 'rgba(42, 26, 14, 0.12)';
  // Base and colonnade.
  g.beginPath();
  g.rect(-90, -10, 180, 12);
  g.rect(-60, -40, 120, 30);
  g.fill();
  g.stroke();
  for (let i = -5; i <= 5; i++) {
    g.beginPath();
    g.moveTo(i * 10, -40);
    g.lineTo(i * 10, -12);
    g.stroke();
  }
  // Drum and dome.
  g.beginPath();
  g.rect(-34, -66, 68, 26);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(-34, -66);
  g.quadraticCurveTo(-30, -112, 0, -116);
  g.quadraticCurveTo(30, -112, 34, -66);
  g.fill();
  g.stroke();
  g.beginPath();
  g.rect(-5, -132, 10, 16);
  g.stroke();
  g.restore();
}

export function drawCameraFlash(g: G, w: number, h: number, p: number) {
  if (p <= 0 || p >= 1) return;
  const a = (1 - p) * (1 - p);
  g.save();
  g.fillStyle = `rgba(255, 250, 235, ${a * 0.75})`;
  g.fillRect(0, 0, w, h);
  g.restore();
}

// ---------------------------------------------------------------- Ash & dust

export function drawPuff(g: G, x: number, y: number, u: number, p: number, seed: number) {
  if (p <= 0 || p >= 1) return;
  g.save();
  for (let i = 0; i < 14; i++) {
    const a = Math.PI + (hash2(seed, i) - 0.5) * Math.PI * 0.9 + (i % 2 ? 0 : Math.PI);
    const d = easeOut(p) * (60 + hash2(seed, i + 30) * 140) * u;
    const px = x + Math.cos(a) * d;
    const py = y - Math.abs(Math.sin(a)) * d * 0.35 - p * 20 * u;
    g.fillStyle = `rgba(200, 180, 150, ${(1 - p) * 0.35})`;
    g.beginPath();
    g.arc(px, py, (10 + hash2(seed, i + 60) * 18) * u * (0.6 + p), 0, TAU);
    g.fill();
  }
  g.restore();
}

export function drawAsh(g: G, x: number, y: number, u: number, time: number, amount: number) {
  if (amount <= 0) return;
  g.save();
  for (let i = 0; i < 26; i++) {
    const p = (time * (0.08 + hash(i) * 0.08) + hash(i * 3)) % 1;
    const px = x + (hash(i * 7) - 0.5) * 360 * u + Math.sin(time * 1.3 + i) * 18 * u;
    const py = y - p * 420 * u;
    g.fillStyle = `rgba(${40 + hash(i) * 40}, 30, 20, ${amount * (1 - p) * 0.8})`;
    g.save();
    g.translate(px, py);
    g.rotate(time * (hash(i * 5) - 0.5) * 4);
    g.fillRect(-5 * u, -3 * u, 10 * u, 6 * u);
    if (hash(i * 11) > 0.7) {
      g.fillStyle = `rgba(230, 120, 40, ${amount * (1 - p) * 0.8})`;
      g.fillRect(-2 * u, -1 * u, 4 * u, 2 * u);
    }
    g.restore();
  }
  g.restore();
}

// ---------------------------------------------------------------- Titles

export function drawTitle(g: G, w: number, y: number, u: number, title: string, subtitle: string, pTitle: number, pSub: number, maxWidth: number) {
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (pTitle > 0) {
    const [main, rest] = title.includes(':') ? [title.split(':')[0], title.split(':').slice(1).join(':').trim()] : [title, ''];
    const s = lerp(1.6, 1, easeOutBack(clamp(pTitle)));
    g.save();
    g.translate(w / 2, y);
    g.scale(s, s);
    g.globalAlpha = clamp(pTitle * 2.5);
    let size = 150 * u;
    g.font = `900 ${size}px ${FONT_TITLE}`;
    while (g.measureText(main).width > maxWidth && size > 20) {
      size *= 0.92;
      g.font = `900 ${size}px ${FONT_TITLE}`;
    }
    g.lineWidth = size * 0.09;
    g.strokeStyle = '#120a05';
    g.strokeText(main, 0, 0);
    const grad = g.createLinearGradient(0, -size / 2, 0, size / 2);
    grad.addColorStop(0, '#f4e3b8');
    grad.addColorStop(1, '#c99a4c');
    g.fillStyle = grad;
    g.fillText(main, 0, 0);
    if (rest) {
      let rs = 54 * u;
      g.font = `italic 700 ${rs}px ${FONT_TITLE}`;
      while (g.measureText(rest).width > maxWidth && rs > 10) {
        rs *= 0.92;
        g.font = `italic 700 ${rs}px ${FONT_TITLE}`;
      }
      g.lineWidth = rs * 0.12;
      g.strokeText(rest, 0, size * 0.72);
      g.fillStyle = '#efe2c4';
      g.fillText(rest, 0, size * 0.72);
    }
    g.restore();
    if (pSub > 0) {
      const chars = Math.floor(subtitle.length * clamp(pSub));
      let ss = 30 * u;
      g.font = `${ss}px ${FONT_TYPE}`;
      while (g.measureText(subtitle).width > maxWidth && ss > 8) {
        ss *= 0.92;
        g.font = `${ss}px ${FONT_TYPE}`;
      }
      const fullW = g.measureText(subtitle).width;
      g.textAlign = 'left';
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(w / 2 - fullW / 2 - 16 * u, y + size * 1.16 - ss * 0.8, fullW + 32 * u, ss * 1.6);
      g.fillStyle = '#e8d6a8';
      g.fillText(subtitle.slice(0, chars), w / 2 - fullW / 2, y + size * 1.16);
    }
  }
  g.restore();
}

/** A bold counter label such as "149 SUBPROJECTS". */
export function drawCounter(g: G, x: number, y: number, u: number, value: number, target: number, label: string, p: number, size = 64) {
  if (p <= 0) return;
  const n = Math.round(target * easeOut(clamp(p * 1.4)));
  g.save();
  g.globalAlpha = clamp(p * 3);
  g.translate(x, y);
  const s = lerp(0.6, 1, easeOutBack(clamp(p * 2)));
  g.scale(s, s);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.font = `900 ${size * u}px ${FONT_TITLE}`;
  const num = String(value >= 0 ? n : target);
  const nw = g.measureText(num).width;
  g.lineWidth = size * 0.1 * u;
  g.strokeStyle = '#120a05';
  g.strokeText(num, 0, 0);
  g.fillStyle = '#e8b866';
  g.fillText(num, 0, 0);
  g.font = `${size * 0.36 * u}px ${FONT_TYPE}`;
  g.lineWidth = size * 0.06 * u;
  g.strokeText(label, nw + 14 * u, -size * 0.12 * u);
  g.fillStyle = '#efe2c4';
  g.fillText(label, nw + 14 * u, -size * 0.12 * u);
  g.restore();
}
