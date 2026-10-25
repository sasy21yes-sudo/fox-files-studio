import { drawSunburst } from '../effects/cartoon';
import { FONT_TITLE, FONT_TYPE } from '../animation/stage';
import { tr } from '../i18n/labels';

/**
 * Thumbnails for the channel, composed from the episode's own pictures and the master Agent Fox
 * (public/brand/master.png, the definitive look, cut out of its green screen). Three house layouts for the video
 * (1280x720) and one for the Short's cover (1080x1920); the words are the channel's thumbnail words, 2-3 that are
 * not in the title.
 */
export const THUMB = { w: 1280, h: 720 };
export const COVER = { w: 1080, h: 1920 };
export type ThumbLayout = 'dossier' | 'sunburst' | 'scene';
export const LAYOUTS: { id: ThumbLayout; label: string }[] = [
  { id: 'dossier', label: 'Dossier' },
  { id: 'sunburst', label: 'Sunburst' },
  { id: 'scene', label: 'Scene' },
];

const INK = '#170d07';
const CREAM = '#f3e6c8';
const BRASS = '#d9b465';
const RED = '#b0301c';

let master: HTMLImageElement | null = null;
let loading: Promise<HTMLImageElement | null> | null = null;
/** The master Agent Fox (transparent PNG), loaded once. */
export function loadMaster(): Promise<HTMLImageElement | null> {
  loading ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve((master = img));
    img.onerror = () => resolve(null);
    img.src = `${import.meta.env.BASE_URL ?? './'}brand/master.png`;
  });
  return loading;
}
export const masterImage = () => master;

/** Draw the master Agent Fox with its height = h, feet (bottom) at (x, y); flip mirrors him. */
export function drawMaster(g: CanvasRenderingContext2D, x: number, y: number, h: number, flip = false) {
  if (!master) return;
  const w = (master.width / master.height) * h;
  g.save();
  g.translate(x, y);
  if (flip) g.scale(-1, 1);
  g.shadowColor = 'rgba(10,5,2,0.55)';
  g.shadowBlur = h * 0.03;
  g.shadowOffsetX = h * 0.012;
  g.shadowOffsetY = h * 0.012;
  g.drawImage(master, -w / 2, -h, w, h);
  g.restore();
}

/** Big words in the series font, outlined, fitted to maxW, one or two lines. */
function bigWords(g: CanvasRenderingContext2D, words: string, x: number, y: number, maxW: number, size: number, align: CanvasTextAlign, fill = CREAM) {
  const parts = words.trim().split(/\s+/);
  const lines = parts.length > 2 ? [parts.slice(0, Math.ceil(parts.length / 2)).join(' '), parts.slice(Math.ceil(parts.length / 2)).join(' ')] : parts.length === 2 && words.length > 12 ? parts : [words.trim()];
  g.save();
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  let s = size;
  g.font = `900 ${s}px ${FONT_TITLE}`;
  const widest = Math.max(...lines.map((l) => g.measureText(l).width));
  if (widest > maxW) s = (s * maxW) / widest;
  g.font = `900 ${s}px ${FONT_TITLE}`;
  lines.forEach((l, i) => {
    const ly = y + i * s * 1.02;
    g.lineWidth = s * 0.2;
    g.strokeStyle = INK;
    g.strokeText(l, x, ly);
    g.fillStyle = fill;
    g.fillText(l, x, ly);
  });
  g.restore();
  return lines.length * s * 1.02;
}

function stamp(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, rot: number) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.font = `700 ${size}px ${FONT_TYPE}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const t = tr(text);
  const w = g.measureText(t).width;
  g.strokeStyle = RED;
  g.lineWidth = size * 0.12;
  g.strokeRect(-w / 2 - size * 0.4, -size * 0.75, w + size * 0.8, size * 1.5);
  g.fillStyle = RED;
  g.fillText(t, 0, size * 0.05);
  g.restore();
}

function vignette(g: CanvasRenderingContext2D, w: number, h: number, a = 0.7) {
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, w * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(10,5,2,${a})`);
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}

function cover(g: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  g.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
}

/**
 * One video thumbnail (1280x720). frame: a rendered frame of the episode (any size, 16:9); words: the thumbnail
 * words; tag: a small typewriter line (the series or the episode, e.g. "MKULTRA").
 */
export function drawThumbnail(g: CanvasRenderingContext2D, layout: ThumbLayout, frame: HTMLCanvasElement | null, words: string, tag: string) {
  const { w, h } = THUMB;
  g.save();
  g.fillStyle = '#2a170a';
  g.fillRect(0, 0, w, h);
  if (layout === 'dossier') {
    if (frame) cover(g, frame, 0, 0, w * 0.68, h);
    g.fillStyle = 'rgba(20,10,4,0.35)';
    g.fillRect(0, 0, w * 0.68, h);
    // The torn-paper edge between the frame and the panel.
    g.fillStyle = '#e9d9b2';
    g.beginPath();
    g.moveTo(w * 0.64, 0);
    for (let i = 0; i <= 12; i++) g.lineTo(w * (0.64 + (i % 2 ? 0.012 : -0.006)), (h * i) / 12);
    g.lineTo(w, h);
    g.lineTo(w, 0);
    g.closePath();
    g.fill();
    drawSunburst(g, w * 0.84, h * 0.55, w * 0.5, 0, '#d6c193', '#e9d9b2', 18);
    drawMaster(g, w * 0.83, h * 1.06, h * 1.12);
    vignette(g, w, h, 0.45);
    bigWords(g, words, 34, 120, w * 0.62, 118, 'left');
    stamp(g, 'SECRET', w * 0.2, h * 0.8, 52, -0.12);
  } else if (layout === 'sunburst') {
    drawSunburst(g, w * 0.3, h * 0.62, w * 0.95, 0, '#8a5422', '#b8903f', 22);
    vignette(g, w, h, 0.6);
    drawMaster(g, w * 0.26, h * 1.04, h * 1.08);
    bigWords(g, words, w * 0.97, h * 0.42, w * 0.56, 150, 'right', BRASS);
  } else {
    if (frame) cover(g, frame, 0, 0, w, h);
    vignette(g, w, h, 0.75);
    drawMaster(g, w * 0.86, h * 1.08, h * 1.0, true);
    bigWords(g, words, 36, 128, w * 0.7, 124, 'left');
  }
  // The series tag, the same corner on every thumbnail.
  g.font = `700 ${30}px ${FONT_TYPE}`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const tw = g.measureText(tag).width;
  g.fillStyle = 'rgba(23,13,7,0.85)';
  g.fillRect(24, h - 66, tw + 28, 44);
  g.fillStyle = CREAM;
  g.fillText(tag, 38, h - 34);
  g.restore();
}

/** The Short's cover (1080x1920): sunburst, the master Agent Fox, the words, the hook line. */
export function drawShortCover(g: CanvasRenderingContext2D, frame: HTMLCanvasElement | null, words: string, line: string) {
  const { w, h } = COVER;
  g.save();
  if (frame) {
    cover(g, frame, 0, 0, w, h);
    g.fillStyle = 'rgba(20,10,4,0.45)';
    g.fillRect(0, 0, w, h);
  } else {
    g.fillStyle = '#2a170a';
    g.fillRect(0, 0, w, h);
  }
  drawSunburst(g, w / 2, h * 0.62, h * 0.7, 0, 'rgba(138,84,34,0.75)', 'rgba(184,144,63,0.75)', 22);
  vignette(g, w, h, 0.6);
  drawMaster(g, w * 0.5, h * 0.98, h * 0.6);
  const used = bigWords(g, words, w / 2, h * 0.17, w * 0.9, 170, 'center');
  g.font = `700 ${46}px ${FONT_TYPE}`;
  g.textAlign = 'center';
  g.fillStyle = CREAM;
  g.fillText(line, w / 2, h * 0.17 + used + 30, w * 0.9);
  g.restore();
}
