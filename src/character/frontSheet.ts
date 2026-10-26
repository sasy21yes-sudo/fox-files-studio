import { drawFox, type FoxPose } from './AgentFox';
import { FONT_SANS, FONT_TITLE, FONT_TYPE } from '../animation/stage';
import { SHEET_H, SHEET_W } from './modelSheet';

type G = CanvasRenderingContext2D;

/**
 * Agent Fox's model sheet in FRONT view (the bust that talks into the lens, foxFront.ts), laid out like the 3/4
 * sheet: proportions, expressions, the front mouths, every arm pose, and in-betweens of pose changes - the frames
 * where arms cross the coat or the face, for checking interpenetration. Drawn live by the front rig.
 */
const MOODS: [string, Partial<FoxPose>][] = [
  ['neutral', {}],
  ['happy', { eyes: 'happy', mouth: 'smile' } as Partial<FoxPose>],
  ['angry', { angry: 1 } as Partial<FoxPose>],
  ['worried', { worry: 1 } as Partial<FoxPose>],
  ['skeptic', { skeptic: 1 } as Partial<FoxPose>],
  ['surprised', { surprise: 0.9 } as Partial<FoxPose>],
];
const MOUTHS = ['closed', 'mbp', 'mid', 'open', 'wide', 'o', 'u', 'fv', 'l', 'th', 'smile', 'frown'];
const POSES = ['rest', 'hips', 'point', 'wave', 'one', 'two', 'three', 'stop', 'knock', 'pinch', 'shake', 'magnify', 'pencil', 'chin', 'hold', 'hatChest', 'scratch', 'tiphat', 'shield'];
const MOVES: [string, string][] = [
  ['rest', 'one'],
  ['one', 'point'],
  ['rest', 'chin'],
  ['rest', 'tiphat'],
  ['hips', 'stop'],
  ['shake', 'rest'],
];
const BLENDS = [0, 0.33, 0.66, 1];

function panel(g: G, x: number, y: number, w: number, h: number, title: string) {
  g.fillStyle = '#efe5cf';
  g.strokeStyle = '#2a1c12';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(x, y, w, h, 14);
  g.fill();
  g.stroke();
  g.font = `700 22px ${FONT_TYPE}`;
  g.fillStyle = '#8a3a1e';
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText(title, x + 18, y + 14);
}

function label(g: G, text: string, x: number, y: number, size = 16) {
  g.font = `600 ${size}px ${FONT_SANS}`;
  g.fillStyle = '#3b2a1c';
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillText(text, x, y);
}

/** The front bust, coat bottom centre at (x, y), `h` px from the head's top to the coat's bottom. */
function bust(g: G, x: number, y: number, h: number, pose: Partial<FoxPose>, clip?: [number, number, number, number]) {
  g.save();
  if (clip) {
    g.beginPath();
    g.rect(...clip);
    g.clip();
  }
  drawFox(g, { x, y, scale: h / 600, time: 0.4, bounce: 0, noShadow: true, view: 'front', lookX: 0, lookY: 0, ...pose } as FoxPose);
  g.restore();
}

export function drawFrontSheet(g: G): void {
  const W = SHEET_W;
  g.save();
  g.fillStyle = '#d9cbb0';
  g.fillRect(0, 0, W, SHEET_H);
  g.font = `900 64px ${FONT_TITLE}`;
  g.fillStyle = '#2a1c12';
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText('AGENT FOX · FRONT', 40, 28);
  g.font = `600 24px ${FONT_SANS}`;
  g.fillStyle = '#5a4430';
  g.fillText('Model sheet · front bust (talking into the lens) · The Fox Files', 44, 102);

  // Proportions.
  panel(g, 30, 150, 620, 820, 'PROPORTIONS · FRONT');
  g.strokeStyle = 'rgba(138, 58, 30, 0.35)';
  g.lineWidth = 2;
  g.setLineDash([10, 8]);
  for (let i = 0; i <= 4; i++) {
    const y = 940 - i * 165;
    g.beginPath();
    g.moveTo(50, y);
    g.lineTo(630, y);
    g.stroke();
  }
  g.setLineDash([]);
  bust(g, 340, 940, 660, {});

  // Expressions: heads only.
  panel(g, 670, 150, 900, 400, 'EXPRESSIONS');
  MOODS.forEach(([name, p], i) => {
    const cx = 670 + 150 + (i % 3) * 300;
    const top = 195 + Math.floor(i / 3) * 175;
    bust(g, cx, top + 340, 340, p, [cx - 140, top, 280, 150]);
    label(g, name, cx, top + 150);
  });

  // Mouths: the lower face.
  panel(g, 1590, 150, 780, 400, 'MOUTHS · FRONT');
  MOUTHS.forEach((m, i) => {
    const cx = 1590 + 70 + (i % 6) * 128;
    const top = 200 + Math.floor(i / 6) * 170;
    bust(g, cx, top + 590, 760, { mouth: m } as Partial<FoxPose>, [cx - 60, top, 120, 120]);
    label(g, m, cx, top + 124);
  });

  // Arm poses.
  panel(g, 670, 570, 1700, 560, 'ARM POSES · FRONT');
  POSES.forEach((m, i) => {
    const cx = 670 + 90 + (i % 10) * 168;
    const base = 600 + 250 + Math.floor(i / 10) * 270;
    bust(g, cx, base, 220, { armFront: m } as Partial<FoxPose>, [cx - 84, base - 250, 168, 252]);
    label(g, m, cx, base + 4);
  });

  // In-betweens of pose changes (interpenetration check).
  panel(g, 30, 1150, 2340, 390, 'POSE CHANGES · IN-BETWEENS (0 · 33 · 66 · 100%)');
  MOVES.forEach(([from, to], k) => {
    const gx = 50 + (k % 3) * 780;
    const gy = 1190 + Math.floor(k / 3) * 175;
    BLENDS.forEach((b, j) => {
      const cx = gx + 95 + j * 165;
      bust(g, cx, gy + 150, 150, { armFront: to, armFrontFrom: from, armFrontBlend: b } as Partial<FoxPose>, [cx - 82, gy, 164, 152]);
    });
    g.font = `700 16px ${FONT_TYPE}`;
    g.fillStyle = '#8a3a1e';
    g.textAlign = 'left';
    g.fillText(`${from} → ${to}`, gx + 12, gy + 152);
  });
  g.restore();
}
