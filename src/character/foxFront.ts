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
import { RIG, anchoredFlex, ik, noodle, part as rigPart, type V2 } from './rig/rigPuppet';

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

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const mixV = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** Glove angle of a pose for the viewer-right arm; hanging hands point down, a little outward. */
const restRot = Math.PI / 2 - 0.12;
const poseRot = (P: ArmPose) => P.rot ?? restRot;
/** Most a wrist bends away from the forearm: beyond this a glove looks stuck on a stick (puppet). */
const WRIST_MAX = 0.55;

/**
 * One rubber-hose arm. The glove leads: its angle comes from the pose, the forearm continues it (the
 * elbow sits behind the wrist along the hand's axis) so the hand never sits on the arm like a puppet's
 * hand on a stick. Changes of pose: the hand travels on an arc out to the side when the arm changes
 * layer (it passes the coat's edge outside the coat, where the layer switches unseen), the glove turns
 * continuously and trails the move (wrist drag), then settles with the blend's overshoot.
 */
function armState(side: Side, A: FrontArm, time: number) {
  const P0 = armPose(A.from);
  const P1 = armPose(A.to);
  const b = A.b;
  const bc = clamp01(b);
  const dir = side === 'right' ? 1 : -1;
  const S0 = side === 'right' ? FRONT.shoulders.right : FRONT.shoulders.left;
  // Hanging arms come out from under the coat's shoulder (drawn behind it); arms in front of the chest
  // start on the shoulder corner, the sleeve's round top over it (rubber hose: no joint).
  const shoulder = (front: boolean): V2 => (front ? [S0[0] + dir * 36, S0[1] + 25] : [S0[0] + dir * 22, S0[1] + 60]);
  const f0 = P0.front ? 1 : 0;
  const f1 = P1.front ? 1 : 0;
  const frontness = f0 + (f1 - f0) * smooth(clamp01((bc - 0.3) / 0.4));
  const S = mixV(shoulder(false), shoulder(true), frontness);
  const handAt = (P: ArmPose): V2 => {
    const Sp = shoulder(P.front);
    return [Sp[0] + dir * P.t[0], Sp[1] + P.t[1]];
  };
  const H = mixV(handAt(P0), handAt(P1), b);
  // Arc: out to the side when the layer changes (round the coat's edge), a gentle swing otherwise.
  const swing = Math.sin(Math.PI * bc);
  H[0] += dir * swing * (f0 !== f1 ? 150 : 40);
  H[1] += swing * (f0 !== f1 ? -40 : 0);
  // Life at rest: hanging hands sway a little, out of step with each other; gestures breathe.
  const ph = side === 'right' ? 0 : 1.7;
  H[0] += Math.sin(time * 1.3 + ph) * 3;
  H[1] += Math.sin(time * 1.6 + ph) * 4;
  const P = b >= 0.5 ? P1 : P0;
  if (P.hand === 'n_fist_tremble') {
    H[0] += Math.sin(time * 41) * 5;
    H[1] += Math.sin(time * 37) * 4;
  }
  // Glove angle (viewer-right terms, then mirrored): turns continuously, a beat behind the hand (drag).
  const r0 = poseRot(P0);
  const turn = wrapA(poseRot(P1) - r0);
  const lag = clamp01(b - 0.18 * swing);
  const rotR = r0 + turn * lag;
  const rot0 = side === 'right' ? rotR : Math.PI - rotR;
  // Elbow behind the wrist along the hand's axis; the upper arm reaches it from the shoulder.
  const L = rigPart('sleeve_front').len! * F;
  const L1 = L * 0.53;
  const L2 = L * 0.47;
  let E: V2 = [H[0] - Math.cos(rot0) * L2, H[1] - Math.sin(rot0) * L2];
  const dx = E[0] - S[0];
  const dy = E[1] - S[1];
  const d = Math.hypot(dx, dy) || 1;
  if (d > L1) E = [S[0] + (dx / d) * L1, S[1] + (dy / d) * L1];
  else if (d < L1 * 0.45) E = [E[0] + dir * (L1 * 0.45 - d), E[1]];
  // Mid-move the elbow is a plain IK elbow bowing outward and down (no loops while the glove turns).
  if (swing > 0.01) {
    const e1 = ik(S, H, L1, L2, 1).e;
    const e2 = ik(S, H, L1, L2, -1).e;
    const score = (e: V2) => dir * (e[0] - S[0]) + 0.6 * (e[1] - S[1]);
    E = mixV(E, score(e1) >= score(e2) ? e1 : e2, smooth(swing) * (f0 !== f1 ? 1 : 0.25));
  }
  // One smooth sleeve passing through the elbow at its middle.
  const c: V2 = [2 * E[0] - (S[0] + H[0]) / 2, 2 * E[1] - (S[1] + H[1]) / 2];
  // The wrist bends only so far from the forearm's direction at the hand.
  const fore = Math.atan2(H[1] - c[1], H[0] - c[0]);
  const rot = fore + Math.max(-WRIST_MAX, Math.min(WRIST_MAX, wrapA(rot0 - fore)));
  // Follow-through: the fingers trail the turn, then curl back.
  const drag = -Math.sign(turn) * (side === 'right' ? 1 : -1) * swing * 0.35;
  const bend = drag + Math.sin(time * 1.7 + ph) * 0.05;
  return { S, c, H, rot, fore, bend, glove: P.hand, front: frontness >= 0.5 };
}

function drawArm(g: G, side: Side, A: FrontArm, time: number, layerFront: boolean) {
  const st = armState(side, A, time);
  if (st.front !== layerFront) return;
  g.save();
  g.scale(F, F);
  const s = (p: V2): V2 => [p[0] / F, p[1] / F];
  // Glove first, the cuff of the sleeve over its wrist; the left glove is the right one mirrored.
  anchoredFlex(g, `hand_${st.glove}${side === 'right' ? '_back' : ''}`, st.H[0] / F + Math.cos(st.fore) * 10, st.H[1] / F + Math.sin(st.fore) * 10, st.rot, {
    bend: st.bend,
    pivot: 0.42,
    scale: 1.12,
    sx: 1,
    sy: 1,
    flipY: side === 'left',
  });
  // Seen from the front the hose reads thinner than in the 3/4 view.
  noodle(g, side === 'right' ? 'sleeve_back' : 'sleeve_front', s(st.S), s(st.c), s(st.H), 0, 1, () => SLEEVE_W);
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
