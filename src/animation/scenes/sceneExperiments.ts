import { drawFox, type FoxPose } from '../../character/AgentFox';
import { easeInOut, easeOut, easeOutBack, lerp, seg } from '../math';
import { drawDesk, drawLabWall, drawPaper, drawPendulumWatch, drawReelRecorder, drawShelf, drawVial } from '../props';
import { beatBounce, drawBubble, drawMotes, drawTally, impactShake, popScale } from '../../effects/cartoon';
import { camToScreen, drawWhip, resolveCam, withShot } from '../camera';
import type { SceneRenderer } from '../stage';
import { foxHead, layout } from './layout';
import { armTrack, foxShot, insertShot, lookAt, popAt, pulse, track, wideShot } from './helpers';

/** Category tags with Turner's 1977 subproject counts (where he gave one). */
const TAGS = [
  { at: 1.8, text: 'DRUGS & ALCOHOL', count: '56 subprojects' },
  { at: 3.0, text: 'HYPNOSIS', count: '8 subprojects' },
  { at: 3.9, text: 'SLEEP & BEHAVIOUR', count: '9 subprojects' },
  { at: 4.8, text: 'POLYGRAPH', count: '3 subprojects' },
  { at: 5.9, text: 'INTERROGATION AIDS', count: 'in the hearing record' },
];

/**
 * Scene 3 — THE EXPERIMENTS
 * Medium on Agent Fox taking notes while the category tags pop; insert on
 * the spinning recorder; a push-in on the LSD vial; medium beside the chart
 * of volunteers vs unwitting subjects; close-up as he looks to camera.
 */
export const sceneExperiments: SceneRenderer = (s) => {
  const { g, w, h, u, k, vertical: V } = s;
  const L = layout(s);
  const dim = seg(k, 11.2, 1.2);
  const light = lerp(0.85, 0.5, dim);
  const shake = impactShake(k, [6.9], 10);
  g.translate(shake.x * u, shake.y * u);

  const benchX = V ? w * 0.42 : w * 0.43;
  const benchY = V ? h * 0.53 : h * 0.64;
  const benchW = V ? w * 0.66 : w * 0.56;
  const vialX = lerp(w * 1.2, benchX + benchW * (V ? 0.12 : 0.08), easeOut(seg(k, 0.6, 1.1)));
  const recX = lerp(w * 1.35, benchX + benchW * (V ? 0.72 : 0.84), easeOutBack(seg(k, 3.2, 1.2)));
  const spin = seg(k, 4.4, 0.8);
  const vialGlow = seg(k, 6.9, 0.6) * (0.75 + Math.sin(s.time * 3) * 0.25) * (1 - dim * 0.5);
  const vialFinalX = benchX + benchW * (V ? 0.12 : 0.08);

  const cam = resolveCam(s, [
    wideShot(s, 0),
    foxShot(s, L, 1.7, 'medium', { sx: 0.3, sy: 0.6 }),
    insertShot(s, 4.5, benchX + benchW * (V ? 0.72 : 0.84), benchY - 80 * u, { zoom: V ? 1.6 : 2.0, sy: 0.6 }),
    wideShot(s, 5.75, 'whip'),
    // Over-the-shoulder: Agent Fox at the edge of frame, the vial in focus.
    insertShot(s, 6.7, vialFinalX, benchY - 90 * u, { zoom: V ? 1.9 : 2.3, sx: V ? 0.74 : 0.68, sy: 0.6, enter: 'push', drift: 0.03 }),
    foxShot(s, L, 9.3, 'medium', { sx: 0.26, sy: 0.58 }),
    foxShot(s, L, 11.25, 'close', { sx: 0.3, sy: 0.55, enter: 'push' }),
  ]);

  const target =
    k < 2 ? { x: vialX, y: benchY - 80 * u } : k < 6.7 ? { x: w * 0.5, y: h * 0.12 } : k < 9.4 ? { x: vialX, y: benchY - 80 * u } : { x: w * 0.7, y: h * 0.2 };
  const pose: FoxPose = {
    x: L.foxX,
    y: L.foxY,
    scale: L.foxS,
    time: s.time,
    bounce: 1 - dim * 0.7,
    ...(k > 11.3 ? { lookX: 0.05, lookY: 0.05 } : lookAt(L, target.x, target.y)),
    lean: track(k, [[0, 0.04], [6.9, -0.16], [8.2, 0.05], [11.3, 0]]),
    brows: k > 11.3 ? -0.5 : track(k, [[0, 0.2], [6.9, 0.9], [8.4, 0.3]]),
    worry: k > 11.3 ? 0.9 : 0,
    surprise: pulse(k, 6.95, 0.9),
    sweat: seg(k, 7.2, 0.3) * (1 - seg(k, 9.4, 0.5)) + (k > 11.4 ? 0.8 : 0),
    pop: popAt(k, [[6.95, '!']]),
    speaking: s.speaking,
    viseme: s.viseme,
    mouth: !s.speaking && k > 11.3 ? 'frown' : undefined,
    ...armTrack(k, [
      [0, 'notebook'],
      [6.9, 'rest'],
      [9.5, 'hips'],
      [11.3, 'rest'],
    ], 'back'),
    ...armTrack(k, [
      [0, 'pencil'],
      [6.9, 'rest'],
      [9.5, 'point'],
      [11.3, 'chin'],
    ]),
    pointAngle: -0.8,
  };

  withShot(s, cam, () => {
    drawLabWall(g, w, h, u, L.floorY, light);
    if (V) {
      drawShelf(g, w * 0.05, h * 0.22, w * 0.9, u, 5);
      drawShelf(g, w * 0.05, h * 0.32, w * 0.9, u, 6);
    } else {
      drawShelf(g, w * 0.36, h * 0.25, w * 0.6, u, 5);
      drawShelf(g, w * 0.36, h * 0.42, w * 0.6, u, 6);
    }
    drawDesk(g, benchX, benchY, benchW, V ? h * 0.19 : h * 0.26, u);
    drawPendulumWatch(g, benchX + benchW * (V ? 0.36 : 0.6), V ? h * 0.32 : benchY, u * (V ? 0.9 : 1), s.time, seg(k, 3.0, 0.6));
    g.save();
    beatBounce(g, vialX, benchY, s.time, 0.8, 0.2);
    drawVial(g, vialX, benchY, u * (V ? 0.95 : 1), s.time, vialGlow, k > 6.8 ? 'LSD' : undefined);
    g.restore();
    g.save();
    beatBounce(g, recX, benchY, s.time, spin, 0.6);
    drawReelRecorder(g, recX, benchY, u * (V ? 0.8 : 1), s.time, spin);
    g.restore();
    drawMotes(g, 0, 0, w, h * 0.65, u, s.time, 0.5);
    drawFox(g, pose);
  });
  drawWhip(s, cam);

  // Paperwork flies in and out (overlay).
  for (let i = 0; i < 3; i++) {
    const p = easeOutBack(seg(k, 2.1 + i * 0.35, 0.7));
    if (p <= 0) continue;
    const out = easeInOut(seg(k, 4.4, 0.4));
    const tx = V ? w * (0.66 + i * 0.09) : w * (0.62 + i * 0.05);
    const ty = V ? h * (0.44 - i * 0.008) : h * (0.6 - i * 0.012);
    const x = lerp(w * 1.1, tx, p) + out * w * 0.7;
    const y = lerp(-h * 0.3, ty, p);
    drawPaper(g, x, y, 170 * u, 220 * u, lerp(0.9, -0.12 + i * 0.1, p), u, { lines: 10, seed: 31 + i, heading: i === 2 ? 'TEST LOG' : undefined, headingSize: 18 });
  }

  const slots = V
    ? [
        [0.27, 0.075],
        [0.73, 0.075],
        [0.27, 0.15],
        [0.73, 0.15],
        [0.5, 0.225],
      ]
    : [
        [0.6, 0.12],
        [0.82, 0.12],
        [0.6, 0.27],
        [0.82, 0.27],
        [0.71, 0.42],
      ];
  TAGS.forEach((tag, i) => {
    const [sx, sy] = slots[i];
    drawBubble(g, w * sx, h * sy, {
      title: tag.text,
      lines: [tag.count],
      width: (V ? 0.43 : 0.2) * w,
      size: (V ? 24 : 21) * u,
      u,
      scale: popScale(k, tag.at, 6.6, 0.55, 0.25),
      rot: (i % 2 ? 0.035 : -0.03) + Math.sin(s.time * 2 + i) * 0.01,
      align: 'center',
      accent: i === 4 ? '#a5301c' : '#5a3a20',
    });
  });

  // LSD call-out, pointing at the vial in the push-in.
  drawBubble(g, V ? w * 0.5 : w * 0.5, V ? h * 0.2 : h * 0.16, {
    tag: 'LSD',
    title: 'Among the drugs tested',
    lines: ['Given unknowingly in some tests, per the 1977 hearing'],
    width: (V ? 0.8 : 0.36) * w,
    size: (V ? 28 : 24) * u,
    u,
    scale: popScale(k, 7.0, 9.25),
    rot: -0.03,
    tail: { x: V ? w * 0.72 : w * 0.66, y: V ? h * 0.45 : h * 0.42 },
  });

  drawTally(
    g,
    V ? w * 0.5 : w * 0.7,
    V ? h * 0.05 : h * 0.08,
    (V ? 0.9 : 0.46) * w,
    u * (V ? 1.05 : 1),
    k,
    9.4,
    'DRUG & ALCOHOL SUBPROJECTS: 56',
    [
      { label: 'Probably no human testing', value: 17 },
      { label: 'Human volunteers', value: 14 },
      { label: 'Probably volunteers (maybe not all)', value: 19 },
      { label: 'Unwitting subjects', value: 6, hot: true },
    ],
    'Categories as listed by DCI Turner, Senate hearing, Aug. 3, 1977',
    1,
  );

  const head = foxHead(L);
  return { focus: camToScreen(s, cam, head.x, head.y), gloom: 0.04 + dim * 0.25, sepia: 0.75 };
};
