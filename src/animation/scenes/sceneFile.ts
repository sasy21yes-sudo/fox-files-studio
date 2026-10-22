import { drawFox, type FoxPose } from '../../character/AgentFox';
import { TAU, clamp, easeOut, easeOutBounce, hash, lerp, seg } from '../math';
import { drawDesk, drawFolder, drawLamp, drawPuff, drawRoom, drawTitle } from '../props';
import { beatBounce, drawMotes, drawMug, drawSunburst, drawWallClock, elastic, impactShake } from '../../effects/cartoon';
import { camToScreen, drawWhip, resolveCam, withShot } from '../camera';
import type { SceneRenderer } from '../stage';
import { foxHead, layout } from './layout';
import { armTrack, foxShot, insertShot, lookAt, pointAt, popAt, pulse, track, wideShot } from './helpers';

/**
 * Scene 1 — THE FILE
 * Wide: the lamp flickers on and Agent Fox struts in. Cut to a medium shot as
 * he skids to a stop; wide again as a folder drops onto the desk; push into a
 * close-up double take; insert on the folder; whip to the title slam.
 */
export const sceneFile: SceneRenderer = (s) => {
  const { g, w, h, u, k, vertical: V } = s;
  const L = layout(s);

  const lamp = k < 1.1 ? 0 : k < 1.9 ? (hash(Math.floor(k * 16)) > 0.4 ? 1 : 0.1) : 1;
  const shake = impactShake(k, [4.2, 6.0], 16);
  g.translate(shake.x * u, shake.y * u);

  const walkP = seg(k, 0.9, 2.1);
  const foxX = lerp(-0.25 * w, L.foxX, walkP < 0.85 ? (walkP / 0.85) * 0.92 : 0.92 + easeOut((walkP - 0.85) / 0.15) * 0.08);
  const walking = walkP > 0 && walkP < 0.86 ? 1 : 0;
  const skid = pulse(k, 2.85, 0.7);

  const folderX = L.deskX + L.deskW * (V ? 0.36 : 0.4);
  const folderW = (V ? 250 : 230) * u;
  const folderH = (V ? 180 : 165) * u;
  const restY = L.deskY - folderH / 2 + 4 * u;
  const drop = seg(k, 3.7, 0.55);
  const folderY = lerp(-0.4 * h, restY, easeOutBounce(drop));
  const folderRot = lerp(0.8, -0.05, easeOutBounce(drop));
  const surprise = pulse(k, 4.25, 0.8);

  const cam = resolveCam(s, [
    wideShot(s, 0),
    foxShot(s, L, 2.8, 'medium', { foxX: L.foxX, sx: 0.4 }),
    wideShot(s, 3.55),
    foxShot(s, L, 4.22, 'close', { sx: 0.45, enter: 'push' }),
    insertShot(s, 5.0, folderX, restY, { sy: V ? 0.5 : 0.55 }),
    { ...wideShot(s, 5.85, 'whip'), locked: true },
    foxShot(s, L, 7.5, 'medium', { sx: 0.35, sy: 0.68, enter: 'push' }),
  ]);

  const pose: FoxPose = {
    x: foxX,
    y: L.foxY,
    scale: L.foxS,
    time: s.time,
    walk: walking,
    walkPhase: k * TAU * 1.7,
    speedLines: walking * 0.7 + skid * 0.6,
    skid,
    lean: walking * 0.12 - skid * 0.3 - surprise * 0.1,
    squash: skid * 0.12,
    jump: surprise * 46,
    ...(k > 4.0 ? lookAt(L, folderX, restY, foxX) : k > 3.0 ? { lookX: 0.6, lookY: 0.2 } : { lookX: 0.8, lookY: 0 }),
    surprise,
    pop: popAt(k, [[4.25, '!?']], 1.2),
    brows: track(k, [[0, 0], [5.4, 0.35], [7.6, 0.6]]),
    skeptic: k > 4.9 && k < 5.9 ? 0.8 : 0,
    speaking: s.speaking && surprise < 0.2,
    viseme: s.viseme,
    mouth: k > 6.3 && !s.speaking ? 'grin' : undefined,
    eyes: k > 7.9 && k < 8.5 ? 'happy' : 'open',
    sparkle: seg(k, 6.0, 0.3) * (1 - seg(k, 7.4, 0.6)),
    ...armTrack(k, [
      [0, 'rest'],
      [4.9, 'magnify'],
      [5.8, 'point'],
      [7.4, 'hips'],
    ]),
    ...armTrack(k, [
      [0, 'rest'],
      [7.4, 'hips'],
    ], 'back'),
    pointAngle: pointAt(L, w / 2, L.titleY, foxX),
  };

  withShot(s, cam, () => {
    drawRoom(g, w, h, u, {
      light: 0.25 + lamp * 0.3,
      blinds: 0.25,
      floorY: L.floorY,
      windowX: L.win.x,
      windowY: L.win.y,
      windowW: L.win.w,
      windowH: L.win.h,
      time: s.time,
    });
    drawMotes(g, L.win.x - w * 0.3, L.win.y, w * 0.5, h * 0.6, u, s.time, 0.4 + lamp * 0.6);
    drawWallClock(g, V ? w * 0.18 : w * 0.43, V ? h * 0.23 : h * 0.16, u * (V ? 0.9 : 0.95), s.time);
    drawDesk(g, L.deskX, L.deskY, L.deskW, L.deskH, u);
    g.save();
    beatBounce(g, L.deskX + L.deskW * 0.8, L.deskY, s.time, 0.7, 0.3);
    drawLamp(g, L.deskX + L.deskW * 0.8, L.deskY, u * (V ? 0.85 : 1), lamp);
    g.restore();
    drawMug(g, L.deskX + L.deskW * (V ? 0.12 : 0.13), L.deskY, u * (V ? 0.9 : 1), s.time);
    if (drop > 0) {
      g.save();
      const land = pulse(k, 4.2, 0.35);
      g.translate(folderX, restY + folderH / 2);
      g.scale(1 + land * 0.18, 1 - land * 0.22);
      g.translate(-folderX, -(restY + folderH / 2));
      if (drop >= 1) beatBounce(g, folderX, restY + folderH / 2, s.time, 0.6, 0.6);
      drawFolder(g, folderX, folderY, folderW, folderH, folderRot, 1, u);
      g.restore();
    }
    drawPuff(g, folderX, L.deskY, u, seg(k, 4.2, 1.1), 11);
    drawFox(g, pose);
  });
  drawWhip(s, cam);

  // Title slam with a rotating sunburst (screen space).
  const tp = seg(k, 5.95, 0.55);
  if (tp > 0) {
    const r = (V ? 420 : 380) * u * elastic(tp);
    g.save();
    g.globalAlpha = 0.55 * clamp(tp * 3);
    g.beginPath();
    g.arc(w / 2, L.titleY + 20 * u, Math.max(1, r), 0, TAU);
    g.clip();
    drawSunburst(g, w / 2, L.titleY + 20 * u, r, s.time * 0.4, '#5a3315', '#8a5422', 20);
    g.restore();
  }
  drawTitle(g, w, L.titleY, u * (V ? 0.95 : 1), s.project.episodeTitle, s.project.episodeSubtitle, tp, seg(k, 6.8, 1.2), L.textW);

  const head = foxHead(L, foxX);
  return { focus: k < 1.2 ? { x: w / 2, y: h * 0.45 } : camToScreen(s, cam, head.x, head.y), gloom: 0.12 * (1 - lamp), sepia: 1 };
};
