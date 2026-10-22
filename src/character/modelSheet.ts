import { FONT_SANS, FONT_TITLE, FONT_TYPE } from '../animation/stage';
import { FOX_COLORS, drawFox, drawGlove, drawHeadParts, getFoxStyle, type FoxPose, type HandShape, type MouthShape } from './AgentFox';

/**
 * Agent Fox model sheet: proportions, turnaround (left/right 3/4), expression
 * set, mouth chart, hand shapes and key poses — all drawn by the same rig the
 * episode uses, so the sheet can never drift from the animation.
 */

export const SHEET_W = 2400;
export const SHEET_H = 1560;

type G = CanvasRenderingContext2D;

function label(g: G, text: string, x: number, y: number, size = 20, color = '#3b2a1c', align: CanvasTextAlign = 'center') {
  g.font = `600 ${size}px ${FONT_SANS}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'top';
  g.fillText(text, x, y);
}

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

function head(g: G, x: number, y: number, s: number, pose: Partial<FoxPose>, surprise = 0, mouthCrop = false) {
  if (getFoxStyle() === 'painted') {
    // The painted puppet: draw the whole figure and keep only the head.
    const k = mouthCrop ? 1.9 : s * 1.05;
    const fx = mouthCrop ? x + 140 - 52 * k : x - 18 * k;
    const fy = mouthCrop ? 762 + 372 * k : y + 400 * k;
    g.save();
    if (!mouthCrop) {
      g.beginPath();
      g.rect(x - 150 * s, y - 250 * s, 330 * s, 360 * s);
      g.clip();
    }
    drawFox(g, { x: fx, y: fy, scale: k, time: 0.4, bounce: 0, noShadow: true, ...pose, surprise } as FoxPose);
    g.restore();
    return;
  }
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  drawHeadParts(g, { x: 0, y: 0, scale: 1, time: 0.4, ...pose }, surprise, 0, true);
  g.restore();
}

export function drawModelSheet(g: G, time = 0.4): void {
  const W = SHEET_W;
  const H = SHEET_H;
  g.save();
  g.fillStyle = '#d9cbb0';
  g.fillRect(0, 0, W, H);

  // Title.
  g.font = `900 64px ${FONT_TITLE}`;
  g.fillStyle = '#2a1c12';
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText('AGENT FOX', 40, 28);
  g.font = `600 24px ${FONT_SANS}`;
  g.fillStyle = '#5a4430';
  g.fillText(getFoxStyle() === 'painted' ? 'Model sheet · cut-out rig from the part sheets · The Fox Files' : 'Model sheet · rig v4 (vector) · The Fox Files — original character', 44, 102);

  // Palette swatches.
  const swatches: [string, string][] = [
    ['Fur', FOX_COLORS.fur],
    ['Fur shade', FOX_COLORS.furShade],
    ['Cream', FOX_COLORS.cream],
    ['Coat', FOX_COLORS.coat],
    ['Coat shade', FOX_COLORS.coatShade],
    ['Hat', FOX_COLORS.hat],
    ['Brass', FOX_COLORS.brass],
    ['Tie', FOX_COLORS.tie],
    ['Ink', FOX_COLORS.ink],
  ];
  swatches.forEach(([name, col], i) => {
    const x = 980 + i * 150;
    g.fillStyle = col;
    g.strokeStyle = '#1a100a';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(x, 40, 54, 54, 8);
    g.fill();
    g.stroke();
    label(g, name, x + 27, 100, 16);
  });

  // ---- Turnaround with height lines.
  panel(g, 30, 150, 760, 820, 'PROPORTIONS · 3/4 RIGHT & LEFT');
  const baseY = 900;
  const s = 0.88;
  g.strokeStyle = 'rgba(138, 58, 30, 0.35)';
  g.lineWidth = 2;
  g.setLineDash([10, 8]);
  const unit = 150 * s;
  for (let i = 0; i <= 4; i++) {
    const y = baseY - i * unit;
    g.beginPath();
    g.moveTo(50, y);
    g.lineTo(770, y);
    g.stroke();
    label(g, `${i}`, 62, y - 26, 16, '#8a3a1e', 'left');
  }
  g.setLineDash([]);
  drawFox(g, { x: 222, y: baseY, scale: s, time, bounce: 0, lookX: 0.3, noShadow: true });
  drawFox(g, { x: 598, y: baseY, scale: s, time: time + 1, bounce: 0, facing: -1, lookX: 0.3, noShadow: true });
  label(g, 'Height ≈ 4 head units (skull + hat). Big head, small body: reads in close-up.', 410, 920, 17);

  // ---- Expressions.
  panel(g, 810, 150, 1560, 400, 'EXPRESSIONS');
  const exprs: [string, Partial<FoxPose>, number][] = [
    ['Neutral', { lookX: 0.4 }, 0],
    ['Happy', { eyes: 'happy', mouth: 'grin', brows: 0.4 }, 0],
    ['Surprised', { lookX: 0.2 }, 1],
    ['Worried', { worry: 1, brows: 0.1, mouth: 'frown', lookY: 0.6, lookX: -0.2, earDroop: 0.8 }, 0],
    ['Sceptical', { skeptic: 1, mouth: 'frown', lookX: -0.5, lids: 0.32, headTilt: -0.05 }, 0],
    ['Determined', { angry: 1, mouth: 'mbp', lookX: 0.8, lids: 0.24 }, 0],
  ];
  exprs.forEach(([name, pose], i) => {
    const x = 930 + i * 250;
    head(g, x, 392, 0.9, pose, exprs[i][2]);
    label(g, name, x + 30, 506, 20);
  });

  // ---- Mouth chart.
  panel(g, 810, 570, 1560, 400, 'MOUTH CHART · LIP-SYNC (driven by the narration text)');
  const mouths: [MouthShape, string][] = [
    ['closed', 'Rest'],
    ['mbp', 'M B P'],
    ['mid', 'Consonant'],
    ['open', 'A'],
    ['wide', 'E I'],
    ['o', 'O'],
    ['u', 'U W'],
    ['fv', 'F V'],
    ['l', 'L T D N'],
    ['smile', 'Smile'],
  ];
  mouths.forEach(([shape, name], i) => {
    const x = 892 + i * 152;
    g.save();
    g.beginPath();
    g.roundRect(x - 66, 650, 140, 220, 10);
    g.clip();
    g.fillStyle = '#f6efde';
    g.fillRect(x - 66, 650, 140, 220);
    // Framed on the muzzle so the mouth shape reads clearly.
    head(g, x - 100, 762, 0.9, { mouth: shape, lookX: 0.5 }, 0, true);
    g.restore();
    g.strokeStyle = 'rgba(42, 28, 18, 0.25)';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(x - 66, 650, 140, 220, 10);
    g.stroke();
    label(g, name, x + 4, 900, 18);
  });

  // ---- Hands.
  panel(g, 30, 990, 520, 540, 'HANDS');
  const hands: [HandShape, string][] = [
    ['open', 'Open'],
    ['fist', 'Fist / hold'],
    ['point', 'Point'],
    ['flat', 'Flat'],
  ];
  hands.forEach(([shape, name], i) => {
    const x = 150 + (i % 2) * 250;
    const y = 1120 + Math.floor(i / 2) * 210;
    g.save();
    g.translate(x, y);
    g.scale(2, 2);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    drawGlove(g, 0, 0, -0.3, shape);
    g.restore();
    label(g, name, x + 20, y + 70, 18);
  });

  // ---- Key poses.
  panel(g, 570, 990, 1800, 540, 'KEY POSES · rubber-hose arms blend between these');
  const poses: [string, Partial<FoxPose>][] = [
    ['Walk A', { walk: 1, walkPhase: 0.3 }],
    ['Walk B', { walk: 1, walkPhase: Math.PI / 2 + 0.3 }],
    ['Point', { armFront: 'point', pointAngle: -0.4, lookX: 1 }],
    ['Magnifier', { armFront: 'magnify', lookX: 1 }],
    ['Thinking', { armFront: 'chin', skeptic: 0.8, lookX: -0.3, lookY: -0.4 }],
    ['Notes', { armFront: 'pencil', armBack: 'notebook', lookY: 0.6 }],
    ['Tip hat', { armFront: 'tiphat', hatLift: 18, mouth: 'smile', wink: true }],
    ['Hat off', { armFront: 'hatChest', worry: 1, earDroop: 0.8, lookY: 0.6, mouth: 'frown' }],
    ['Take!', { surprise: 1, jump: 40, pop: { symbol: '!', p: 0.4 } }],
  ];
  poses.forEach(([name, pose], i) => {
    const x = 690 + i * 186 + (i >= 4 ? 44 : 0);
    drawFox(g, { x, y: 1460, scale: 0.6, time: time + i * 0.37, bounce: 0, noShadow: false, ...pose } as FoxPose);
    label(g, name, x + 10, 1480, 18);
  });

  // Small construction note.
  g.font = `16px ${FONT_SANS}`;
  g.fillStyle = '#5a4430';
  g.textAlign = 'right';
  g.fillText(getFoxStyle() === 'painted' ? 'Cut-out rig: complete parts, bone IK arms, 12 lip-sync mouths, live eyes and brows' : 'Clean ink contour · tapered inner lines · two-tone cel shading · no seams where parts meet', W - 40, 120);
  g.restore();
}
