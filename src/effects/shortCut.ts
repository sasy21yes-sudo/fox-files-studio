import { FONT_TITLE, FONT_TYPE } from '../animation/stage';
import { clamp, easeOut } from '../animation/math';

/**
 * How the Short's own cut joins its clips, so a fast summary still reads: a new topic gets the scene's own wipe,
 * a whoosh and a tag with its chapter ("3 · THE HUMAN COST"); a jump inside the same scene gets a punch-in (a
 * quick zoom that settles, with a flash) instead of a jump that looks like a glitch. The cut ends on a card.
 */
export const SHORT_IN = 0.35;
export const SHORT_OUT = 0.4;
export const PUNCH = 0.4;
const TAG_HOLD = 2.3;

/** Zoom of a punch-in, local seconds into the clip (1 = none). */
export const punchZoom = (local: number) => (local < PUNCH ? 1 + 0.1 * (1 - easeOut(clamp(local / PUNCH))) : 1);

/** White flash on the frame of a jump cut. */
export function drawPunchFlash(g: CanvasRenderingContext2D, w: number, h: number, local: number) {
  const a = 0.45 * (1 - clamp(local / 0.14));
  if (a <= 0) return;
  g.save();
  g.fillStyle = `rgba(255,246,225,${a})`;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/** The chapter tag of a new topic: slides in at the top left, holds, fades. */
export function drawTopicTag(g: CanvasRenderingContext2D, w: number, h: number, u: number, n: number, title: string, local: number) {
  if (local > TAG_HOLD + 0.3) return;
  const inP = easeOut(clamp((local - 0.12) / 0.28));
  const out = 1 - clamp((local - TAG_HOLD) / 0.3);
  if (inP <= 0 || out <= 0) return;
  const V = h > w;
  const size = (V ? 52 : 40) * u;
  const label = title.toUpperCase();
  g.save();
  g.globalAlpha = out;
  g.font = `700 ${size}px ${FONT_TITLE}`;
  const tw = g.measureText(label).width;
  const nSize = size * 0.9;
  const padX = 18 * u;
  const badge = nSize * 1.5;
  const bw = badge + padX * 2 + tw;
  const bh = size * 1.7;
  const x = (V ? 40 : 56) * u - (1 - inP) * (bw + 60 * u);
  const y = h * (V ? 0.055 : 0.07);
  // Card: cream paper, brown ink outline, the number on a brass disc.
  g.fillStyle = 'rgba(20,12,6,0.35)';
  roundRect(g, x + 5 * u, y + 6 * u, bw, bh, 10 * u);
  g.fill();
  g.fillStyle = '#efe2c2';
  g.strokeStyle = '#3a2414';
  g.lineWidth = 4 * u;
  roundRect(g, x, y, bw, bh, 10 * u);
  g.fill();
  g.stroke();
  g.fillStyle = '#b8903f';
  g.beginPath();
  g.arc(x + padX + badge / 2, y + bh / 2, badge / 2, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#1a140e';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${nSize}px ${FONT_TYPE}`;
  g.fillText(String(n), x + padX + badge / 2, y + bh / 2 + 1 * u);
  g.textAlign = 'left';
  g.font = `700 ${size}px ${FONT_TITLE}`;
  g.fillStyle = '#2a170a';
  g.fillText(label, x + padX * 1.6 + badge, y + bh / 2 + 2 * u);
  g.restore();
}

/** Closing card over the last clip: where to see the whole episode. */
export function drawEndCard(g: CanvasRenderingContext2D, w: number, h: number, u: number, since: number) {
  const p = easeOut(clamp(since / 0.45));
  if (p <= 0) return;
  const V = h > w;
  g.save();
  g.fillStyle = `rgba(16,10,5,${0.62 * p})`;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = p;
  g.translate(w / 2, h * (V ? 0.42 : 0.45));
  g.scale(0.85 + 0.15 * p, 0.85 + 0.15 * p);
  const cw = (V ? 0.84 : 0.56) * w;
  const ch = (V ? 0.22 : 0.34) * h;
  g.fillStyle = '#efe2c2';
  g.strokeStyle = '#3a2414';
  g.lineWidth = 6 * u;
  roundRect(g, -cw / 2, -ch / 2, cw, ch, 16 * u);
  g.fill();
  g.stroke();
  g.fillStyle = '#7a1f14';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${(V ? 40 : 32) * u}px ${FONT_TYPE}`;
  g.fillText('THE FOX FILES', 0, -ch * 0.22);
  g.fillStyle = '#2a170a';
  g.font = `800 ${(V ? 64 : 54) * u}px ${FONT_TITLE}`;
  g.fillText('FULL EPISODE ON THE CHANNEL', 0, ch * 0.12, cw * 0.9);
  g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
