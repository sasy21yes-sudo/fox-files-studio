import { drawFox, type FoxPose } from '../../character/AgentFox';
import { clamp, easeInOut, envelope, lerp, seg } from '../math';
import { drawChair, drawHangingBulb, drawRoom, drawStamp } from '../props';
import { drawBubble, drawCaseHud, drawSlamNumber, elastic, popScale } from '../../effects/cartoon';
import { camToScreen, resolveCam, withShot } from '../camera';
import { FONT_SANS, type SceneRenderer } from '../stage';
import { foxHead, layout } from './layout';
import { armTrack, foxShot, insertShot, track, wideShot } from './helpers';

/** A small inked town-house icon with a lit window, for the safe-house call-outs. */
function drawHouse(g: CanvasRenderingContext2D, x: number, y: number, u: number, p: number, label: string, time: number) {
  const s = elastic(clamp(p));
  if (s <= 0) return;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineWidth = 4 * u;
  g.strokeStyle = '#140d08';
  g.beginPath();
  g.moveTo(-60 * u, 0);
  g.lineTo(-60 * u, -80 * u);
  g.lineTo(0, -130 * u);
  g.lineTo(60 * u, -80 * u);
  g.lineTo(60 * u, 0);
  g.closePath();
  g.fillStyle = '#3a2a20';
  g.fill();
  g.stroke();
  const flick = 0.75 + Math.sin(time * 9 + x) * 0.1;
  g.fillStyle = `rgba(255, 205, 120, ${flick})`;
  g.fillRect(-36 * u, -66 * u, 26 * u, 26 * u);
  g.fillRect(10 * u, -66 * u, 26 * u, 26 * u);
  g.strokeRect(-36 * u, -66 * u, 26 * u, 26 * u);
  g.strokeRect(10 * u, -66 * u, 26 * u, 26 * u);
  g.fillStyle = '#1d140e';
  g.fillRect(-12 * u, -34 * u, 24 * u, 34 * u);
  g.font = `700 ${20 * u}px ${FONT_SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.lineWidth = 6 * u;
  g.strokeText(label, 0, 10 * u);
  g.fillStyle = '#f3e6c8';
  g.fillText(label, 0, 10 * u);
  g.restore();
}

/**
 * Scene 4 — THE HUMAN COST
 * The bounce stops. Slow, quiet coverage: medium on Agent Fox for the six
 * subprojects, wide for the safe houses, close-up on his face for "no
 * informed consent", medium as he takes off his hat for Frank Olson, and a
 * slow push on the empty chair.
 */
export const sceneCost: SceneRenderer = (s) => {
  const { g, w, h, u, k, vertical: V } = s;
  const L = layout(s);
  const sombre = seg(k, 7.5, 3);
  const chairX = w * 0.76;
  const chairY = L.floorY + (V ? 80 : 60) * u;

  const cam = resolveCam(s, [
    wideShot(s, 0, undefined, 0.02),
    foxShot(s, L, 1.15, 'medium', { sx: 0.3, sy: 0.56, drift: 0.02 }),
    wideShot(s, 4.25, 'cut', 0.015),
    foxShot(s, L, 7.85, 'close', { sx: 0.32, sy: 0.52, drift: 0.025 }),
    foxShot(s, L, 10.35, 'medium', { sx: 0.3, sy: 0.56, drift: 0.02 }),
    // The empty chair (16:9 only; in 9:16 we stay on Agent Fox).
    V ? foxShot(s, L, 14.4, 'close', { enter: 'push', drift: 0.02 }) : insertShot(s, 14.4, chairX, chairY - 160 * u, { zoom: 1.7, sx: 0.62, sy: 0.62, enter: 'push', drift: 0.03 }),
  ]);

  const pose: FoxPose = {
    x: L.foxX,
    y: L.foxY,
    scale: L.foxS,
    time: s.time,
    bounce: lerp(0.35, 0, seg(k, 3, 3)),
    lookX: k < 8 ? 0.6 : 0.2,
    lookY: k < 8 ? 0.2 : 0.7,
    brows: lerp(-0.1, -0.6, sombre),
    worry: lerp(0.4, 1, sombre),
    earDroop: lerp(0.1, 0.85, sombre),
    headTilt: track(k, [[0, 0], [10.6, 0.16]], 1.2),
    lean: track(k, [[0, 0], [10.6, 0.08]], 1.2),
    lids: lerp(0.05, 0.45, sombre),
    speaking: s.speaking,
    viseme: s.viseme,
    mouth: s.speaking ? undefined : 'frown',
    ...armTrack(k, [
      [0, 'rest'],
      [2.2, 'chin'],
      [7.6, 'rest'],
      [10.6, 'hatChest'],
    ], 'front', 0.9),
    ...armTrack(k, [[0, 'rest']], 'back'),
  };

  withShot(s, cam, () => {
    drawRoom(g, w, h, u, {
      light: lerp(0.22, 0.12, sombre),
      blinds: 0.6,
      floorY: L.floorY,
      windowX: V ? w * 0.12 : w * 0.38,
      windowY: V ? h * 0.08 : h * 0.07,
      windowW: V ? w * 0.42 : w * 0.24,
      windowH: V ? h * 0.24 : h * 0.4,
      rain: 1,
      cool: 1,
      time: s.time,
    });
    drawHangingBulb(g, chairX, -h * 0.05, V ? h * 0.33 : h * 0.4, u, s.time, lerp(0.9, 0.55, sombre));
    drawChair(g, chairX, chairY, u * (V ? 0.95 : 1), 0.92);
    drawFox(g, pose);
  });

  const cx = V ? w * 0.5 : w * 0.66;
  const cy = V ? h * 0.17 : h * 0.26;
  const fs = (V ? 30 : 26) * u;

  const sixOut = 1 - easeInOut(seg(k, 3.6, 0.4));
  if (sixOut > 0) {
    g.save();
    g.globalAlpha = sixOut;
    drawSlamNumber(g, cx, cy, u, '6', 'SUBPROJECTS', k, 1.2, V ? 130 : 140, 'tested drugs on unwitting people');
    g.restore();
  }

  const housesA = 1 - easeInOut(seg(k, 7.8, 0.4));
  if (housesA > 0) {
    g.save();
    g.globalAlpha = housesA;
    drawHouse(g, cx - (V ? 0.22 : 0.1) * w, cy + 60 * u, u * 1.1, seg(k, 4.6, 0.6), 'SAN FRANCISCO', s.time);
    drawHouse(g, cx + (V ? 0.22 : 0.1) * w, cy + 60 * u, u * 1.1, seg(k, 5.9, 0.6), 'NEW YORK CITY', s.time);
    drawBubble(g, cx, cy - 150 * u, {
      tag: 'SAFE HOUSES',
      lines: ['Some unwitting tests took place here'],
      width: (V ? 0.78 : 0.34) * w,
      size: fs * 0.85,
      u,
      scale: popScale(k, 4.4),
      rot: -0.02,
    });
    g.restore();
  }

  const nic = envelope(k, 8.0, 10.4, 0.2, 0.5);
  if (nic > 0) {
    g.save();
    g.globalAlpha = nic;
    drawStamp(g, 'NO INFORMED CONSENT', cx, cy + 20 * u, (V ? 54 : 56) * u, -0.12, seg(k, 8.05, 0.45), '#a5301c');
    g.restore();
  }

  drawBubble(g, cx, cy + (V ? 20 : 30) * u, {
    tag: '1953',
    title: 'DR. FRANK OLSON',
    lines: ['Army civilian employee at Fort Detrick.', 'Died about a week after unknowingly taking LSD at a meeting called by the CIA.', '— DCI Turner, 1977 testimony'],
    width: (V ? 0.86 : 0.4) * w,
    size: fs * 0.95,
    u,
    scale: easeInOut(seg(k, 10.4, 0.6)),
    rot: 0.012,
    reveal: seg(k, 10.6, 3.6),
    tone: '#e4d6b4',
  });

  // Faint rain streaks across the whole frame.
  g.save();
  g.strokeStyle = 'rgba(190, 205, 220, 0.08)';
  g.lineWidth = 1.2 * u;
  for (let i = 0; i < 40; i++) {
    const px = ((i * 97.3) % w) + Math.sin(i) * 20 * u;
    const py = ((s.time * (500 + (i % 7) * 40) * u + i * 133) % (h + 80 * u)) - 40 * u;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px - 6 * u, py + 34 * u);
    g.stroke();
  }
  g.restore();

  drawCaseHud(g, w, h, u, k, [{ at: 10.4, year: '1953', note: 'Frank Olson dies' }]);

  const head = foxHead(L);
  return { focus: camToScreen(s, cam, head.x, head.y), gloom: lerp(0.3, 0.5, sombre), sepia: 0.6 };
};
