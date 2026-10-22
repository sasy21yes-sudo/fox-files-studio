import { drawFox, type FoxPose } from '../../character/AgentFox';
import { TAU, easeInOut, envelope, lerp, seg } from '../math';
import { drawAsh, drawDesk, drawFolder, drawLamp, drawPaper, drawRoom, drawStamp } from '../props';
import { beatBounce, drawBubble, drawMotes, drawMug, drawSunburst, drawTimelineStrip, drawWallClock, elastic, impactShake, popScale } from '../../effects/cartoon';
import { camToScreen, drawWhip, resolveCam, withShot } from '../camera';
import { FONT_TITLE, type SceneRenderer } from '../stage';
import { foxHead, layout } from './layout';
import { armTrack, foxShot, insertShot, lookAt, pointAt, popAt, pulse, track, wideShot } from './helpers';

/**
 * Scene 6 — WHAT WE KNOW
 * Wide on the timeline; close-up shock as the file burns; medium for who
 * ordered it; wide for what was recovered; insert as the folder snaps shut;
 * whip to the takeaway; medium as Agent Fox tips his hat.
 */
export const sceneKnown: SceneRenderer = (s) => {
  const { g, w, h, u, k, vertical: V } = s;
  const L = layout(s);
  const bright = easeInOut(seg(k, 0.3, 3.5));
  const close = easeInOut(seg(k, 10.0, 0.6));
  const folderX = L.deskX + L.deskW * (V ? 0.38 : 0.36);
  const folderW = (V ? 250 : 230) * u;
  const folderH = (V ? 180 : 165) * u;
  const folderY = L.deskY - folderH / 2 + 4 * u;
  const shake = impactShake(k, [2.5, 10.6], 12);
  g.translate(shake.x * u, shake.y * u);

  const cam = resolveCam(s, [
    wideShot(s, 0),
    foxShot(s, L, 2.45, 'close', { sx: 0.28, sy: 0.55 }),
    foxShot(s, L, 4.6, 'medium', { sx: 0.3, sy: 0.6 }),
    wideShot(s, 8.35, 'cut'),
    insertShot(s, 9.85, folderX, folderY, { zoom: V ? 1.7 : 2.2, sy: 0.6 }),
    wideShot(s, 11.25, 'whip'),
    foxShot(s, L, 13.8, 'medium', { sx: 0.3, sy: 0.58, enter: 'push' }),
  ]);

  const docX = V ? w * 0.66 : w * 0.68;
  const docY = V ? h * 0.36 : h * 0.46;
  const target = k < 8.3 ? { x: docX, y: docY } : k < 11.3 ? { x: folderX, y: folderY } : { x: w * 0.6, y: h * 0.35 };
  const pose: FoxPose = {
    x: L.foxX,
    y: L.foxY,
    scale: L.foxS,
    time: s.time,
    ...(k > 14 ? { lookX: 0.15, lookY: 0 } : lookAt(L, target.x, target.y)),
    lean: track(k, [[0, 0], [2.5, -0.15], [3.6, 0], [10.0, 0.1], [11.0, 0]]),
    brows: lerp(-0.2, 0.35, bright) + pulse(k, 2.55, 0.8) * 0.8,
    worry: k < 8 ? 0.5 : 0,
    skeptic: k > 4.7 && k < 8.2 ? 0.6 : 0,
    surprise: pulse(k, 2.55, 0.7),
    jump: pulse(k, 2.55, 0.7) * 34,
    sweat: seg(k, 2.8, 0.3) * (1 - seg(k, 6, 0.6)),
    pop: popAt(k, [[2.55, '!']]),
    speaking: s.speaking,
    viseme: s.viseme,
    mouth: !s.speaking && k > 13.8 ? 'smile' : undefined,
    wink: k > 15.0 && k < 15.4,
    sparkle: seg(k, 14.2, 0.4),
    ...armTrack(k, [
      [0, 'rest'],
      [4.7, 'chin'],
      [8.3, 'rest'],
      [9.8, 'point'],
      [11.3, 'hips'],
      [14.1, 'tiphat'],
    ]),
    ...armTrack(k, [
      [0, 'rest'],
      [11.3, 'hips'],
    ], 'back'),
    pointAngle: pointAt(L, folderX, folderY),
    hatLift: k > 14.4 && k < 15.6 ? 18 : 0,
  };

  withShot(s, cam, () => {
    drawRoom(g, w, h, u, {
      light: lerp(0.3, 0.85, bright),
      blinds: lerp(0.2, 0.95, bright),
      floorY: L.floorY,
      windowX: L.win.x,
      windowY: L.win.y,
      windowW: L.win.w,
      windowH: L.win.h,
      time: s.time,
    });
    drawMotes(g, L.win.x - w * 0.3, L.win.y, w * 0.6, h * 0.6, u, s.time, bright);
    drawWallClock(g, V ? w * 0.18 : w * 0.43, V ? h * 0.23 : h * 0.2, u * (V ? 0.9 : 0.95), s.time);
    drawDesk(g, L.deskX, L.deskY, L.deskW, L.deskH, u);
    g.save();
    beatBounce(g, L.deskX + L.deskW * 0.82, L.deskY, s.time, 0.7, 0.3);
    drawLamp(g, L.deskX + L.deskW * 0.82, L.deskY, u * (V ? 0.85 : 1), 1 - bright * 0.5);
    g.restore();
    drawMug(g, L.deskX + L.deskW * (V ? 0.12 : 0.1), L.deskY, u * (V ? 0.9 : 1), s.time);
    g.save();
    const slam = pulse(k, 10.6, 0.35);
    g.translate(folderX, L.deskY);
    g.scale(1 + slam * 0.15, 1 - slam * 0.18);
    g.translate(-folderX, -L.deskY);
    beatBounce(g, folderX, L.deskY, s.time, 0.6, 0.6);
    drawFolder(g, folderX, folderY, folderW, folderH, -0.04, lerp(-1, 1, close), u);
    g.restore();
    drawFox(g, pose);
  });
  drawWhip(s, cam);

  drawTimelineStrip(
    g,
    w * (V ? 0.12 : 0.1),
    w * (V ? 0.88 : 0.9),
    V ? h * 0.15 : h * 0.145,
    u * (V ? 1.05 : 1),
    k,
    [
      { year: 1953, label: 'MKULTRA begins', at: 0.9 },
      { year: 1963, label: 'Inspector General report', at: 1.25 },
      { year: 1964, label: 'Unwitting tests end', at: 1.6 },
      { year: 1973, label: 'Files destroyed', at: 2.3, hot: true },
      { year: 1975, label: 'Senate inquiry', at: 3.0 },
      { year: 1977, label: 'Records found · hearing', at: 3.4 },
    ],
    1 - easeInOut(seg(k, 11.0, 0.5)),
  );

  const burnP = seg(k, 3.0, 4.6);
  const docA = envelope(k, 1.4, 8.3, 0.4, 0.8);
  if (docA > 0) {
    g.save();
    g.globalAlpha = docA;
    const pop = elastic(seg(k, 1.4, 0.6));
    g.translate(docX, docY);
    g.scale(pop, pop);
    g.translate(-docX, -docY);
    drawPaper(g, docX, docY, (V ? 340 : 320) * u, (V ? 420 : 380) * u, 0.05 + Math.sin(s.time * 3) * 0.01, u, {
      heading: 'MKULTRA FILES',
      subheading: 'Destroyed 1973 (illustration)',
      lines: 16,
      redact: true,
      seed: 61,
      burnt: 0.05 + burnP * 0.85,
      headingSize: 28,
    });
    drawStamp(g, 'DESTROYED · 1973', docX, docY + 40 * u, 42 * u, -0.14, seg(k, 2.5, 0.4));
    g.restore();
  }
  drawAsh(g, docX, docY + 120 * u, u, s.time, seg(k, 3.6, 1) * (1 - seg(k, 8.2, 1.5)));

  drawBubble(g, V ? w * 0.5 : w * 0.3, V ? h * 0.27 : h * 0.3, {
    tag: 'WHO ORDERED IT',
    lines: ['Sen. Edward Kennedy named then-CIA Director Richard Helms at the 1977 hearing.'],
    width: (V ? 0.8 : 0.34) * w,
    size: (V ? 26 : 22) * u,
    u,
    scale: popScale(k, 4.7, 8.3),
    rot: -0.03,
  });

  drawBubble(g, docX, docY, {
    tag: 'RECOVERED 1977',
    title: 'Mostly finance folders',
    lines: ['Approvals of advances, vouchers, accountings', '— per DCI Turner, 1977'],
    width: (V ? 0.8 : 0.36) * w,
    size: (V ? 28 : 24) * u,
    u,
    scale: popScale(k, 8.5, 9.85),
    rot: 0.02,
    reveal: seg(k, 8.6, 1.2),
  });

  drawBubble(g, V ? w * 0.5 : w * 0.64, V ? h * 0.25 : h * 0.36, {
    tag: 'WHAT THE RECORD SHOWS',
    lines: [
      '• 1953–1964: a CIA research program in behavioral modification',
      '• 149 subprojects; six tested drugs on unwitting subjects',
      '• Many program files destroyed in 1973',
      '• Much remains unknown',
      '',
      'Source: U.S. Senate joint hearing, Aug. 3, 1977',
    ],
    width: (V ? 0.9 : 0.56) * w,
    size: (V ? 29 : 25) * u,
    u,
    scale: popScale(k, 11.4),
    rot: -0.01,
    reveal: seg(k, 11.6, 2.6),
    tone: '#f3e8cc',
  });

  const end = seg(k, 14.4, 0.6);
  if (end > 0) {
    const x = V ? w * 0.72 : w * 0.66;
    const y = V ? h * 0.475 : h * 0.74;
    g.save();
    const r = 140 * u * elastic(end);
    g.globalAlpha = 0.6;
    g.beginPath();
    g.arc(x, y, Math.max(1, r), 0, TAU);
    g.clip();
    drawSunburst(g, x, y, r, s.time * 0.5, '#5a3315', '#8a5422', 16);
    g.restore();
    g.save();
    g.translate(x, y);
    const sc = elastic(end);
    g.scale(sc, sc);
    g.font = `900 ${(V ? 50 : 58) * u}px ${FONT_TITLE}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8 * u;
    g.strokeStyle = '#120a05';
    g.strokeText('THE FOX FILES', 0, 0);
    g.fillStyle = '#e8b866';
    g.fillText('THE FOX FILES', 0, 0);
    g.restore();
  }

  const head = foxHead(L);
  return { focus: camToScreen(s, cam, head.x, head.y), gloom: lerp(0.12, 0, bright), sepia: lerp(1, 0.85, bright) };
};
