import { TAU, clamp, easeInOut, easeOutBounce, lerp, seg } from '../math';
import { drawFox, type FoxPose } from '../../character/AgentFox';
import { drawCameraFlash, drawCapitolSketch, drawCard, drawCorkboard, drawPin, drawRecordBox, drawRoom, drawString } from '../props';
import { drawBubble, drawCaseHud, drawMotes, drawNewspaper, drawSlamNumber, impactShake, popScale } from '../../effects/cartoon';
import { camToScreen, drawWhip, resolveCam, withShot } from '../camera';
import type { SceneRenderer } from '../stage';
import { foxHead, layout } from './layout';
import { armTrack, foxShot, insertShot, lookAt, pointAt, popAt, pulse, track, wideShot } from './helpers';

/**
 * Scene 5 — THE REVELATION
 * A spinning newspaper; close-up reaction; inserts on each record as it goes
 * up on the board (committee card, seven boxes, hearing card); a close-up of
 * Agent Fox shielding his eyes from the press flashes; whip back to wide.
 */
export const sceneRevelation: SceneRenderer = (s) => {
  const { g, w, h, u, k, vertical: V } = s;
  const L = layout(s);
  const board = V ? { x: w * 0.04, y: h * 0.03, w: w * 0.92, h: h * 0.37 } : { x: w * 0.36, y: h * 0.06, w: w * 0.6, h: h * 0.7 };
  const at = (fx: number, fy: number) => ({ x: board.x + board.w * fx, y: board.y + board.h * fy });
  const A = at(V ? 0.3 : 0.27, 0.27);
  const B = at(0.74, 0.3);
  const C = at(V ? 0.6 : 0.52, V ? 0.76 : 0.74);
  const cardW = (V ? 420 : 380) * u;
  const size = (V ? 22 : 21) * u;
  const boxTimes = Array.from({ length: 7 }, (_, i) => 8.6 + i * 0.18 + 0.32);
  const shake = impactShake(k, [...boxTimes, 9.9], 6);
  g.translate(shake.x * u, shake.y * u);

  const walkP = seg(k, 0.5, 1.5);
  const foxX = lerp(L.foxX - 300 * u, L.foxX - (V ? 30 : 60) * u, easeInOut(walkP));
  const restFoxX = L.foxX - (V ? 30 : 60) * u;

  const paperIn = seg(k, 1.3, 1.0);
  const fly = easeInOut(seg(k, 4.6, 0.7));
  const npX = lerp(w / 2, A.x, fly);
  // (9:16: high and smaller, so the newspaper never sits on Agent Fox's head while he talks)
  const npY = lerp(V ? h * 0.22 : h * 0.42, A.y, fly);
  const npW = lerp((V ? 0.72 : 0.36) * w, cardW, fly);

  const cam = resolveCam(s, [
    wideShot(s, 0),
    foxShot(s, L, 1.55, 'close', { foxX: restFoxX, sx: 0.22, sy: 0.55 }),
    foxShot(s, L, 2.9, 'medium', { foxX: restFoxX, sx: 0.24, sy: 0.55 }),
    wideShot(s, 4.5, 'whip'),
    insertShot(s, 5.4, A.x, A.y, { zoom: V ? 1.4 : 1.7, sy: V ? 0.3 : 0.45 }),
    insertShot(s, 8.45, B.x, B.y, { zoom: V ? 1.4 : 1.6, sy: V ? 0.3 : 0.42 }),
    wideShot(s, 11.0, 'whip'),
    insertShot(s, 12.75, C.x, C.y, { zoom: V ? 1.35 : 1.55, sy: V ? 0.35 : 0.5 }),
    foxShot(s, L, 13.9, 'close', { foxX: restFoxX, sx: 0.32 }),
    wideShot(s, 15.7, 'whip'),
  ]);

  const target = k < 4.6 ? { x: npX, y: npY } : k < 8.4 ? A : k < 12.7 ? B : C;
  const flashes = [14.0, 14.4, 15.2];
  const flashHit = Math.max(...flashes.map((f) => pulse(k, f, 0.4)));
  const pose: FoxPose = {
    x: foxX,
    y: L.foxY,
    scale: L.foxS,
    time: s.time,
    walk: walkP > 0 && walkP < 1 ? 1 : 0,
    walkPhase: k * TAU * 1.6,
    speedLines: walkP > 0 && walkP < 1 ? 0.5 : 0,
    ...lookAt(L, target.x, target.y, foxX),
    lean: track(k, [[0, 0], [2.3, 0.1], [4.6, 0]]),
    brows: 0.35 + flashHit * 0.6,
    lids: flashHit * 0.8,
    surprise: pulse(k, 1.6, 0.6) * 0.8,
    pop: popAt(k, [
      [1.6, '!'],
      [9.9, '!?'],
    ]),
    speaking: s.speaking,
    viseme: s.viseme,
    mouth: !s.speaking && k > 16.2 ? 'smile' : undefined,
    ...armTrack(k, [
      [0, 'rest'],
      [5.2, 'point'],
      [13.9, 'shield'],
      [15.8, 'point'],
    ]),
    ...armTrack(k, [
      [0, 'rest'],
      [2.3, 'hips'],
      [13.9, 'rest'],
      [15.8, 'hips'],
    ], 'back'),
    pointAngle: pointAt(L, target.x, target.y, foxX),
  };

  withShot(s, cam, () => {
    drawRoom(g, w, h, u, { light: 0.42, blinds: 0.4, floorY: L.floorY, windowX: -w, windowY: -h, windowW: 1, windowH: 1, time: s.time });
    drawCorkboard(g, board.x, board.y, board.w, board.h, u);
    drawString(g, A.x, A.y - 40 * u, B.x, B.y - 60 * u, seg(k, 11.2, 1.0), u);
    drawString(g, B.x, B.y - 60 * u, C.x, C.y - 50 * u, seg(k, 13.6, 1.0), u);
    drawString(g, A.x, A.y - 40 * u, C.x, C.y - 50 * u, seg(k, 14.6, 1.0), u);
    if (seg(k, 5.2, 0.3) > 0) {
      drawCard(g, A.x, A.y, {
        title: 'SENATE SELECT COMMITTEE',
        lines: ['Created Jan. 27, 1975', 'Chairman: Sen. Frank Church', 'Final report: April 1976'],
        width: cardW,
        size,
        u,
        rot: -0.04,
        reveal: 1,
        pin: true,
      });
    }
    for (let i = 0; i < 7; i++) {
      const row = i < 4 ? 0 : 1;
      const col = row === 0 ? i - 1.5 : i - 5;
      const bx = B.x + col * 104 * u * (V ? 0.9 : 1);
      const by = B.y + 70 * u - row * 70 * u;
      const p = seg(k, 8.6 + i * 0.18, 0.5);
      if (p <= 0) continue;
      drawRecordBox(g, bx, by + (1 - easeOutBounce(p)) * -h * 0.5, u * (V ? 0.85 : 0.9), 1, i + 1);
    }
    const pB = seg(k, 10.6, 0.5);
    if (pB > 0) {
      g.save();
      g.globalAlpha = clamp(pB * 2);
      drawCard(g, B.x, B.y - 96 * u, {
        title: '7 BOXES · FOUND 1977',
        lines: ['MKULTRA financial records at a retired-records center'],
        width: cardW * 0.95,
        size,
        u,
        rot: 0.03,
        reveal: seg(k, 10.7, 1.4),
        pin: true,
      });
      g.restore();
    }
    const pC = seg(k, 12.8, 0.5);
    if (pC > 0) {
      g.save();
      g.globalAlpha = clamp(pC * 2);
      drawCard(g, C.x, C.y, {
        title: 'JOINT HEARING · AUG. 3, 1977',
        lines: ['U.S. Senate: Select Committee on Intelligence and the Subcommittee on Health and Scientific Research', 'Witness: DCI Adm. Stansfield Turner'],
        width: cardW * 1.15,
        size,
        u,
        rot: -0.015,
        reveal: seg(k, 12.9, 2.2),
        pin: true,
      });
      drawCapitolSketch(g, C.x - cardW * 0.78, C.y + 40 * u, V ? 0.8 : 0.9, u);
      g.restore();
    }
    drawPin(g, board.x + board.w * 0.08, board.y + board.h * 0.1, u, '#c99a3e');
    drawMotes(g, 0, 0, w, h * 0.8, u, s.time, 0.5);
    drawFox(g, pose);
  });
  drawWhip(s, cam);

  // The "7" slam follows the boxes on screen.
  const bScreen = camToScreen(s, cam, B.x, B.y + (V ? 150 : 170) * u);
  drawSlamNumber(g, bScreen.x, Math.min(bScreen.y, h * 0.7), u, '7', 'BOXES OF RECORDS', k, 9.9, V ? 90 : 100);

  if (paperIn > 0 && fly < 1) {
    drawNewspaper(g, npX + (V ? 0 : w * 0.08) * (1 - fly), npY, npW, u * lerp(V ? 1.0 : 1.1, 0.5, fly), paperIn, {
      masthead: 'THE FOX FILES GAZETTE',
      date: '1975  ·  ILLUSTRATED EDITION',
      headline: 'SENATE SETS UP INTELLIGENCE PROBE',
      deck: 'Sen. Frank Church to chair the select committee',
    });
  }

  drawBubble(g, V ? w * 0.68 : w * 0.2, V ? h * 0.5 : h * 0.13, {
    tag: 'THE WITNESS',
    lines: ['Director of Central Intelligence Adm. Stansfield Turner'],
    width: (V ? 0.58 : 0.34) * w,
    size: size * 1.1,
    u,
    scale: popScale(k, 15.9),
    rot: 0.02,
  });

  for (const f of flashes) drawCameraFlash(g, w, h, seg(k, f, 0.35));

  drawCaseHud(g, w, h, u, k, [
    { at: 1.0, year: '1975', note: 'Senate inquiry' },
    { at: 8.1, year: '1977', note: 'Records found' },
    { at: 12.8, year: 'AUG 3', note: '1977 hearing' },
  ]);

  const head = foxHead(L, foxX);
  return { focus: camToScreen(s, cam, head.x, head.y), gloom: 0.02 };
};
