import { drawFox, type FoxPose } from '../../character/AgentFox';
import { easeInOut, easeOutBack, lerp, seg } from '../math';
import { MAP_PINS, drawArchiveStrip, drawDesk, drawMap, drawPaper, drawPin, drawRoom } from '../props';
import { drawBubble, drawCaseHud, drawMotes, drawSlamNumber, drawTally, impactShake, popScale } from '../../effects/cartoon';
import { camToScreen, drawWhip, resolveCam, withShot } from '../camera';
import type { SceneRenderer } from '../stage';
import { foxHead, layout } from './layout';
import { armTrack, foxShot, insertShot, lookAt, pointAt, popAt, pulse, track, wideShot } from './helpers';

const ARCHIVE_LABELS = ['MKULTRA · SUBPROJECT', 'FINANCE FOLDERS', 'RETIRED RECORDS', 'BEHAVIORAL RESEARCH', 'VOUCHERS · ADVANCES', 'MKULTRA · 1953–1964'];

/**
 * Scene 2 — THE QUESTION
 * Medium on Agent Fox while the witness is introduced; insert on the map as
 * 1953 → 1964 slams in; close-up as he reads; whip wide for the counts and
 * the pins; medium again beside the bar chart of institutions.
 */
export const sceneQuestion: SceneRenderer = (s) => {
  const { g, w, h, u, k, vertical: V } = s;
  const L = layout(s);
  const shake = impactShake(k, [4.4, 5.3, 7.3, 8.9], 12);
  g.translate(shake.x * u, shake.y * u);

  const map = V ? { x: w * 0.06, y: h * 0.05, w: w * 0.88, h: h * 0.27 } : { x: w * 0.42, y: h * 0.07, w: w * 0.5, h: h * 0.44 };
  const stripY = V ? h * 0.335 : L.floorY - 150 * u;

  const cam = resolveCam(s, [
    wideShot(s, 0),
    foxShot(s, L, 1.3, 'medium', { sx: 0.32, sy: 0.55 }),
    insertShot(s, 4.3, map.x + map.w / 2, map.y + map.h / 2, { zoom: V ? 1.25 : 1.3, sx: V ? 0.5 : 0.67, sy: V ? 0.2 : 0.3 }),
    foxShot(s, L, 6.55, 'close', { sx: 0.42 }),
    wideShot(s, 7.22, 'whip'),
    foxShot(s, L, 10.05, 'medium', { sx: 0.24, sy: 0.55 }),
    foxShot(s, L, 12.1, 'close', { sx: 0.3, sy: 0.58, enter: 'push' }),
  ]);

  const target = k > 10.2 ? { x: V ? w * 0.5 : w * 0.67, y: V ? h * 0.15 : h * 0.24 } : { x: w * 0.65, y: h * 0.3 };
  const pose: FoxPose = {
    x: L.foxX,
    y: L.foxY,
    scale: L.foxS,
    time: s.time,
    ...(k < 7 ? { lookX: 0.7 + Math.sin(s.time * 0.9) * 0.3, lookY: 0.1 + Math.cos(s.time * 0.7) * 0.2 } : lookAt(L, target.x, target.y)),
    lean: track(k, [[0, 0], [1.2, 0.08], [7.2, -0.05], [8.0, 0.06], [10.2, 0]]),
    brows: track(k, [[0, 0.1], [7.2, 0.8], [8.4, 0.35]]),
    skeptic: k > 10.3 && k < 12.2 ? 0.7 : 0,
    surprise: pulse(k, 7.35, 0.6),
    jump: pulse(k, 7.35, 0.6) * 30,
    pop: popAt(k, [
      [7.35, '!'],
      [10.4, '?'],
    ]),
    speaking: s.speaking,
    viseme: s.viseme,
    ...armTrack(k, [
      [0, 'magnify'],
      [7.3, 'rest'],
      [10.3, 'chin'],
      [12.3, 'point'],
    ]),
    ...armTrack(k, [
      [0, 'rest'],
      [10.3, 'hips'],
    ], 'back'),
    pointAngle: pointAt(L, V ? w * 0.5 : w * 0.7, V ? h * 0.36 : h * 0.66),
  };

  withShot(s, cam, () => {
    drawRoom(g, w, h, u, { light: 0.4, blinds: 0.2, floorY: L.floorY, windowX: -w, windowY: -h, windowW: 1, windowH: 1, time: s.time });
    drawMap(g, map.x, map.y, map.w, map.h, u, s.time);
    MAP_PINS.forEach((pin, i) => {
      const p = seg(k, 8.9 + i * 0.12, 0.35);
      if (p <= 0) return;
      const px = map.x + pin.x * map.w;
      const py = map.y + pin.y * map.h - (1 - easeOutBack(p)) * 60 * u;
      drawPin(g, px, py, u * 0.95, i % 4 === 0 ? '#c99a3e' : '#a5301c');
    });
    drawArchiveStrip(g, -w * 0.1, stripY, w * 1.2, u * (V ? 0.8 : 1), s.time, ARCHIVE_LABELS);
    drawDesk(g, L.deskX, L.deskY, L.deskW, L.deskH, u);
    drawMotes(g, 0, 0, w, h * 0.7, u, s.time, 0.6);
    drawFox(g, pose);
  });
  drawWhip(s, cam);

  // Declassified pages fly in (overlay).
  const pages = [
    { at: 1.2, x: V ? 0.68 : 0.62, y: V ? 0.5 : 0.62, rot: -0.1, seed: 21 },
    { at: 1.6, x: V ? 0.84 : 0.8, y: V ? 0.49 : 0.62, rot: 0.08, seed: 22 },
    { at: 2.0, x: V ? 0.75 : 0.71, y: V ? 0.46 : 0.57, rot: -0.02, seed: 23 },
  ];
  const pagesOut = easeInOut(seg(k, 6.5, 0.3)) * (1 - easeInOut(seg(k, 10.0, 0.4)));
  pages.forEach((p, i) => {
    const q = easeOutBack(seg(k, p.at, 0.6));
    if (q <= 0) return;
    const x = lerp(w * 1.25, w * p.x, q) + pagesOut * w * 0.5;
    drawPaper(g, x, h * p.y + Math.sin(s.time * 2 + i) * 3 * u, (V ? 300 : 260) * u, (V ? 390 : 340) * u, p.rot * q + (1 - q) * 0.8, u, {
      heading: i === 2 ? 'MKULTRA' : 'SUBPROJECT',
      subheading: i === 2 ? 'Finance record (illustration)' : undefined,
      lines: 16,
      redact: true,
      seed: p.seed,
      highlightLine: i === 2 && k > 7 ? 4 : undefined,
      headingSize: 24,
    });
  });

  const fs = (V ? 28 : 24) * u;
  drawBubble(g, V ? w * 0.5 : w * 0.7, V ? h * 0.14 : h * 0.2, {
    tag: 'WITNESS',
    title: 'ADM. STANSFIELD TURNER',
    lines: ['Director of Central Intelligence', 'U.S. Senate hearing · Aug. 3, 1977'],
    width: (V ? 0.8 : 0.36) * w,
    size: fs,
    u,
    scale: popScale(k, 1.3, 4.3),
    rot: -0.03,
    reveal: seg(k, 1.4, 1.2),
  });

  const yA = V ? h * 0.17 : h * 0.24;
  // (9:16: further apart and a size smaller - the two stamps' captions overlapped, reading "1953 ... PROGRAM ENDS")
  const xA = V ? w * 0.22 : w * 0.54;
  const xB = V ? w * 0.78 : w * 0.82;
  const yearsOut = 1 - easeInOut(seg(k, 6.45, 0.3));
  if (yearsOut > 0) {
    g.save();
    g.globalAlpha = yearsOut;
    const bar = easeInOut(seg(k, 4.6, 0.8));
    if (bar > 0) {
      g.lineWidth = 14 * u;
      g.strokeStyle = '#140d08';
      g.beginPath();
      g.moveTo(xA, yA);
      g.lineTo(lerp(xA, xB, bar), yA);
      g.stroke();
      g.lineWidth = 7 * u;
      g.strokeStyle = '#f0d38a';
      g.stroke();
    }
    drawSlamNumber(g, xA, yA, u, '1953', 'PROGRAM BEGINS', k, 4.4, V ? 82 : 104);
    drawSlamNumber(g, xB, yA, u, '1964', 'PROGRAM ENDS', k, 5.3, V ? 82 : 104);
    g.restore();
  }
  const countsOut = 1 - easeInOut(seg(k, 10.0, 0.4));
  if (countsOut > 0) {
    g.save();
    g.globalAlpha = countsOut;
    drawSlamNumber(g, xA, yA, u, '149', 'SUBPROJECTS', k, 7.3, V ? 110 : 118);
    drawSlamNumber(g, xB, yA, u, '80', 'INSTITUTIONS', k, 8.9, V ? 110 : 118);
    g.restore();
  }

  drawTally(
    g,
    V ? w * 0.5 : w * 0.7,
    V ? h * 0.055 : h * 0.14,
    (V ? 0.88 : 0.42) * w,
    u * (V ? 1.05 : 1),
    k,
    10.1,
    'THE INSTITUTIONS NAMED',
    [
      { label: 'Colleges & universities', value: 44, hot: true },
      { label: 'Foundations & drug firms', value: 15 },
      { label: 'Hospitals & clinics', value: 12 },
      { label: 'Penal institutions', value: 3 },
    ],
    'Turner’s 1977 breakdown (74 of the 80 institutions itemized)',
    1,
  );

  drawBubble(g, V ? w * 0.5 : w * 0.7, V ? h * 0.36 : h * 0.66, {
    tag: 'ALSO NAMED',
    lines: ['185 outside researchers and assistants'],
    width: (V ? 0.7 : 0.34) * w,
    size: fs,
    u,
    scale: popScale(k, 12.2),
    rot: 0.04,
  });

  drawCaseHud(g, w, h, u, k, [
    { at: 4.4, year: '1953', note: 'Program begins' },
    { at: 5.3, year: '1964', note: 'Program ends' },
  ], V ? 1 - seg(k, 9.8, 0.3) : 1);

  const head = foxHead(L);
  return { focus: camToScreen(s, cam, head.x, head.y), gloom: 0.04 };
};
