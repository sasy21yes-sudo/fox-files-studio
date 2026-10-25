import { captureFox, drawFox, type FoxDebug, type FoxPose } from '../character/AgentFox';
import { drawSunburst } from '../effects/cartoon';
import { FONT_TITLE, FONT_TYPE } from '../animation/stage';
import { drawMaster, masterImage } from './thumbnails';

/**
 * The channel's art, drawn by the studio itself from the episode's own parts (sunburst, Agent Fox's rig, the
 * series fonts), so channel and videos match: the YouTube banner (2560x1440, everything that matters inside the
 * 1546x423 area every device shows) and the round channel icon (800x800).
 */
export const BANNER = { w: 2560, h: 1440, safe: { w: 1546, h: 423 } };
export const ICON = 800;

const INK = '#170d07';
const CREAM = '#f3e6c8';
const BRASS = '#d9b465';

/** Agent Fox placed so that one of his joints lands on (x, y) at `scale` (measured with a first, hidden draw). */
function foxAt(g: CanvasRenderingContext2D, joint: string, x: number, y: number, scale: number, pose: Partial<FoxPose>) {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 8;
  const sink: FoxDebug = { pose: null, face: null, arms: null, joints: {} };
  const base = { x: 0, y: 0, scale, time: 0.5, bounce: 0, noShadow: true, lookX: 0.35, lookY: 0.1, ...pose } as FoxPose;
  captureFox(sink);
  drawFox(probe.getContext('2d')!, base);
  captureFox(null);
  const j = sink.joints[joint] ?? [0, 0];
  drawFox(g, { ...base, x: x - j[0], y: y - j[1] });
}

function outlinedText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, font: string, fill: string, weight = '900') {
  g.font = `${weight} ${size}px ${font}`;
  g.lineJoin = 'round';
  g.lineWidth = size * 0.14;
  g.strokeStyle = INK;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

/** The YouTube banner: sunburst, Agent Fox tipping his hat, the series name and the tagline. */
export function drawBanner(g: CanvasRenderingContext2D, name: string, tagline: string) {
  const { w, h, safe } = BANNER;
  g.save();
  g.fillStyle = '#2a170a';
  g.fillRect(0, 0, w, h);
  drawSunburst(g, w * 0.56, h / 2, w * 0.75, 0, '#5a3315', '#7a4a1e', 28);
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(10,5,2,0.75)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  const sx = (w - safe.w) / 2;
  const sy = (h - safe.h) / 2;
  // Agent Fox on the left of the safe area, feet on its bottom edge.
  // The master Agent Fox (await loadMaster() first); the rig until it is loaded.
  if (masterImage()) drawMaster(g, sx + 230, sy + safe.h - 4, safe.h * 0.97);
  else foxAt(g, 'ankle_near', sx + 250, sy + safe.h + 40, 0.62, { armFront: 'tiphat' } as Partial<FoxPose>);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const tx = sx + 470;
  outlinedText(g, name.toUpperCase(), tx, sy + 235, 150, FONT_TITLE, BRASS);
  g.font = `700 54px ${FONT_TYPE}`;
  g.fillStyle = CREAM;
  g.fillText(tagline, tx + 6, sy + 330);
  g.restore();
}

/**
 * The round channel icon: the master Agent Fox (hat, face and lens - public/brand/master.png, await loadMaster()
 * first) on a brass sunburst; the rig's face until the master is loaded. YouTube crops it to a circle.
 */
export function drawIcon(g: CanvasRenderingContext2D) {
  const s = ICON;
  g.save();
  g.fillStyle = '#7a4a1e';
  g.fillRect(0, 0, s, s);
  drawSunburst(g, s / 2, s / 2, s * 0.75, 0, '#b8903f', '#d9b465', 20);
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  g.clip();
  const m = masterImage();
  if (m) {
    // Crop chosen on the master (Salvatore, 2026-10-25): from 30% of its width, a square 72% wide, a hair above.
    const side = m.width * 0.72;
    g.drawImage(m, m.width * 0.3, -m.height * 0.03, side, side, 0, 0, s, s);
  } else foxAt(g, 'eye_near', s * 0.56, s * 0.48, 2.6, {});
  g.restore();
  g.save();
  g.strokeStyle = INK;
  g.lineWidth = s * 0.03;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - s * 0.015, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}
