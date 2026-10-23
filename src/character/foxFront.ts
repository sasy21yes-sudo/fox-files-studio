/**
 * Agent Fox, front view: the talking bust for camera cuts ("mezzo busto"), looking into the lens.
 *
 * Sprites come from tools/bake_front.py (head with a neck that goes into the collar, the coat in two
 * layers, lip-sync mouths cut from renders of the same head); eyes and brows are the traced front
 * face (frontFace.ts) drawn by the same FaceRig as the side view. Arms are the side rig's rubber-hose
 * sleeve and gloves, scaled to the front drawing. Space: front px (the head image's px); the
 * element's (x, y) is the bottom centre of the coat; at scale 1 the bust is as tall as the whole
 * side-view fox, so the heads have the same size.
 *
 * Layers: hanging arms → coat → head (neck, face, brows) → coat front (the collar over the neck) →
 * arms gesturing in front of the chest.
 */
import FRONT_JSON from './rig/front/front.json';
import { FRONT_ASSETS } from './rig/front/assets';
import { FRONT_FACE } from './rig/frontFace';
import { makeFaceRig, type Face, type TracedFace } from './rig/faceRig';
import { RIG, anchoredFlex, noodle, part as rigPart, type V2 } from './rig/rigPuppet';

type G = CanvasRenderingContext2D;

interface FrontPart {
  x: number;
  y: number;
  w: number;
  h: number;
}
const FRONT = FRONT_JSON as unknown as {
  parts: Record<string, FrontPart>;
  nose: V2;
  neckPivot: V2;
  torso: { scale: number; holeTop: number; frontY: number; bottom: number };
  shoulders: { left: V2; right: V2 };
};

const images: Record<string, HTMLImageElement> = {};
let ready = false;
let loading: Promise<void> | null = null;

export function loadFront(): Promise<void> {
  if (loading) return loading;
  if (typeof Image === 'undefined') return Promise.resolve();
  loading = Promise.all(
    Object.entries(FRONT_ASSETS).map(
      ([k, url]) =>
        new Promise<boolean>((res) => {
          const img = new Image();
          img.onload = () => {
            images[k] = img;
            res(true);
          };
          img.onerror = () => res(false);
          img.src = url;
        }),
    ),
  ).then((ok) => {
    ready = ok.every(Boolean);
  });
  return loading;
}

export function frontReady(): boolean {
  return ready;
}

function placed(g: G, name: string) {
  const p = FRONT.parts[name];
  const img = images[name];
  if (p && img) g.drawImage(img, p.x, p.y);
}

/** Front px drawn per unit at scale 1: the bust (hat to coat bottom) is ~600 units, like the side fox. */
const TOP = FRONT.parts.head.y;
const BOTTOM = FRONT.torso.bottom;
const UNIT = 600 / (BOTTOM - TOP);
const CX = FRONT.neckPivot[0];

/** Front px per side-rig px: the front head is drawn ~1.27x the side head's width. */
const F = FRONT.parts.head.w / RIG.parts.head.w;

// ------------------------------------------------------------------ face

const ANCHOR = FRONT_FACE.anchorPx as unknown as V2;
const FACE = makeFaceRig({
  traced: FRONT_FACE as unknown as TracedFace,
  roll: 0,
  unit: FRONT_FACE.unitPx,
  // Eyes grow and shrink about the point between them, so they stay symmetric on the face.
  centre: (side, k, eyes) => {
    const mid = (eyes.near.centre[0] + eyes.far.centre[0]) / 2;
    const e = eyes[side].centre;
    return [ANCHOR[0] + mid * FRONT_FACE.unitPx + (e[0] - mid) * k, ANCHOR[1] + e[1] * k];
  },
  skepticNear: 0.5,
});

/** The front mouths are cut from renders in the order of the mouth chart (tools/comfy/jobs.py MOUTH_SHAPES). */
export type FrontMouth = 'closed' | 'mbp' | 'mid' | 'open' | 'wide' | 'o' | 'u' | 'fv' | 'l' | 'th' | 'smile' | 'frown';
const MOUTH_ID: Record<FrontMouth, number> = { closed: 1, mbp: 2, mid: 3, open: 4, wide: 5, o: 6, u: 7, fv: 8, l: 9, th: 10, smile: 11, frown: 12 };
/** When a mouth has not been baked yet, the closest one that has. */
const MOUTH_FALLBACK: Record<FrontMouth, FrontMouth[]> = {
  closed: ['frown', 'mbp'],
  mbp: ['closed'],
  mid: ['wide', 'open', 'closed'],
  open: ['wide', 'mid', 'o'],
  wide: ['mid', 'open'],
  o: ['open', 'u', 'mid'],
  u: ['o', 'mbp'],
  fv: ['mbp', 'mid'],
  l: ['mid', 'open'],
  th: ['l', 'mid'],
  smile: ['closed'],
  frown: ['closed'],
};
function mouthSprite(m: FrontMouth): string | null {
  for (const c of [m, ...MOUTH_FALLBACK[m], 'closed' as FrontMouth]) {
    const name = `mouth_${MOUTH_ID[c]}`;
    if (FRONT.parts[name] && images[name]) return name;
  }
  return null;
}

// ------------------------------------------------------------------ arms

export type FrontArmMode = string;
type Side = 'left' | 'right';
interface ArmPose {
  /** Hand target relative to the shoulder (front px), glove angle (radians, null = along the arm), glove. */
  t: V2;
  rot: number | null;
  hand: string;
  /** In front of the chest (drawn over the coat and the head's neck) or hanging beside the coat. */
  front: boolean;
}
/**
 * Poses for the viewer-right arm (the side rig's far arm: it reaches, counts, points); the viewer-left
 * arm mirrors them for its own modes (chin, hold...). x grows away from the body.
 */
const ARM: Record<string, ArmPose> = {
  rest: { t: [25, 520], rot: null, hand: 'relaxed', front: false },
  notebook: { t: [25, 520], rot: null, hand: 'relaxed', front: false },
  hips: { t: [5, 400], rot: 2.6, hand: 'fist', front: true },
  point: { t: [430, 20], rot: null, hand: 'point', front: false },
  wave: { t: [150, -330], rot: -1.6, hand: 'wave', front: false },
  one: { t: [-110, 110], rot: -1.5, hand: 'n_one', front: true },
  two: { t: [-110, 110], rot: -1.5, hand: 'n_two', front: true },
  three: { t: [-110, 110], rot: -1.5, hand: 'n_three', front: true },
  stop: { t: [-130, 125], rot: -1.57, hand: 'n_stop_palm', front: true },
  knock: { t: [-90, 200], rot: -0.2, hand: 'n_knock', front: true },
  pinch: { t: [-140, 150], rot: -1.3, hand: 'n_pinch_paper_palm', front: true },
  shake: { t: [-110, 90], rot: -1.5, hand: 'n_fist_tremble', front: true },
  magnify: { t: [-60, 20], rot: -1.2, hand: 'fist', front: true },
  pencil: { t: [-140, 230], rot: -2.3, hand: 'fist', front: true },
  chin: { t: [-205, 35], rot: -1.9, hand: 'n_chin', front: true },
  hold: { t: [-170, 250], rot: -0.3, hand: 'fist', front: true },
  hatChest: { t: [-200, 230], rot: -0.4, hand: 'fist', front: true },
  scratch: { t: [-40, -400], rot: -2.4, hand: 'open', front: true },
  tiphat: { t: [-60, -420], rot: -1.2, hand: 'fist', front: true },
  shield: { t: [-150, -60], rot: -1.5, hand: 'flat', front: true },
};
const armPose = (m: string) => ARM[m] ?? ARM.rest;
const SLEEVE_W = 0.8;

export interface FrontArm {
  from: string;
  to: string;
  b: number;
}

export interface FrontInput {
  face: Face;
  mouth: FrontMouth;
  speaking: boolean;
  surprise: number;
  /** Head roll (radians): talking nods, idle sway, mood. */
  headRot: number;
  /** Body bounce on the beat (units, - is up) and the head's lag behind it. */
  bob: number;
  headLag: number;
  /** The reaching arm (viewer-right) and the other one. */
  arms: { right: FrontArm; left: FrontArm };
  time: number;
}

function drawArm(g: G, side: Side, A: FrontArm, time: number, layerFront: boolean) {
  const P0 = armPose(A.from);
  const P1 = armPose(A.to);
  const P = A.b >= 0.5 ? P1 : P0;
  if (P.front !== layerFront) return;
  const dir = side === 'right' ? 1 : -1;
  const S0 = side === 'right' ? FRONT.shoulders.right : FRONT.shoulders.left;
  // Hanging arms come out from under the coat's shoulder (drawn behind it); arms gesturing in front of
  // the chest start on the shoulder corner, the sleeve's round top over it (rubber hose: no joint).
  const S: V2 = layerFront ? [S0[0] + dir * 36, S0[1] + 25] : [S0[0] + dir * 22, S0[1] + 60];
  const t: V2 = [P0.t[0] + (P1.t[0] - P0.t[0]) * A.b, P0.t[1] + (P1.t[1] - P0.t[1]) * A.b];
  // Hanging hands sway a little and breathe; gestures keep a small life of their own.
  const sway = Math.sin(time * 1.3 + (side === 'right' ? 0 : 1.7)) * 8;
  const H: V2 = [S[0] + dir * t[0] + sway * 0.4, S[1] + t[1] + Math.sin(time * 1.6) * 4 + (P.hand === 'n_fist_tremble' ? Math.sin(time * 41) * 6 : 0)];
  // Rubber hose: one sleeve bending smoothly, the elbow bowing outward and down.
  const L = rigPart('sleeve_front').len! * F;
  const d = Math.hypot(H[0] - S[0], H[1] - S[1]);
  const slack = Math.max(0, L - d);
  const mid: V2 = [(S[0] + H[0]) / 2, (S[1] + H[1]) / 2];
  const c: V2 = [mid[0] + dir * slack * 0.55, mid[1] + slack * 0.35];
  const ang = Math.atan2(H[1] - c[1], H[0] - c[0]);
  const rot = P.rot === null ? ang : side === 'right' ? P.rot : Math.PI - P.rot;
  g.save();
  g.scale(F, F);
  const s = (p: V2): V2 => [p[0] / F, p[1] / F];
  // Glove first, the cuff of the sleeve over its wrist; the left glove is the right one mirrored.
  anchoredFlex(g, `hand_${P.hand}${side === 'right' ? '_back' : ''}`, H[0] / F + Math.cos(ang) * 10, H[1] / F + Math.sin(ang) * 10, rot, {
    bend: Math.sin(time * 1.7 + (side === 'right' ? 0 : 1.3)) * 0.05,
    pivot: 0.42,
    scale: 1.12,
    sx: 1,
    sy: 1,
    flipY: side === 'left',
  });
  // Seen from the front the hose reads thinner than in the 3/4 view.
  noodle(g, side === 'right' ? 'sleeve_back' : 'sleeve_front', s(S), s(c), s(H), 0, 1, () => SLEEVE_W);
  g.restore();
}

/** Draw the front bust; the caller has put the origin at the element's (x, y) and applied pose.scale. */
export function drawFoxFront(g: G, I: FrontInput): void {
  const time = I.time;
  g.save();
  g.scale(UNIT, UNIT);
  // Front px from here on, origin at the coat's bottom centre.
  g.translate(-CX, -BOTTOM);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const B = I.bob / UNIT;
  // Breathing: the coat swells a little from its bottom.
  const breath = Math.sin(time * 1.6) * 0.006;
  g.save();
  g.translate(CX, BOTTOM);
  g.scale(1 + breath * 0.5, 1 + breath);
  g.translate(-CX, -BOTTOM);
  g.translate(0, B * 0.6);
  // Hanging arms come out from under the coat.
  drawArm(g, 'left', I.arms.left, time, false);
  drawArm(g, 'right', I.arms.right, time, false);
  placed(g, 'torso');
  // Head on the neck: talking nods and sway turn it about the top of the neck; it lags the body's bounce.
  const N = FRONT.neckPivot;
  g.save();
  g.translate(N[0], N[1] + B * 0.4 + (I.headLag / UNIT) * 0.4);
  g.rotate(I.headRot);
  const sq = -I.surprise * 0.05;
  g.scale(1 + sq * 0.7, 1 - sq);
  g.translate(-N[0], -N[1]);
  placed(g, 'head');
  const m = mouthSprite(I.mouth);
  if (m) placed(g, m);
  (['near', 'far'] as const).forEach((side, i) => FACE.drawEye(g, side, i, I.face));
  FACE.drawBrows(g, I.face);
  g.restore();
  placed(g, 'torso_front');
  // Arms gesturing in front of the chest.
  drawArm(g, 'left', I.arms.left, time, true);
  drawArm(g, 'right', I.arms.right, time, true);
  g.restore();
  g.restore();
}
