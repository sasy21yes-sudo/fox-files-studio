import { TAU, clamp, easeOut, hash, lerp } from '../animation/math';
import { RIG, anchored, anchoredWarp, drawFace as drawRigFace, drawFaceBrows, hoseControl, noodle, part as rigPart, placed, placedWarp, rigReady, type Face, type MouthId, type V2 } from './rig/rigPuppet';
export { loadRig as loadPuppet } from './rig/rigPuppet';

/**
 * Agent Fox — character rig, version 3.
 *
 * An original fox detective built as a clean cartoon model: every part is a
 * closed shape with one outline weight, one flat base colour and one flat
 * shadow tone (cel shading, light from the upper right). Parts are layered in
 * a fixed order so joints are always hidden behind the part in front of them:
 *
 *   back arm (when behind) → tail → legs → coat → arms in front of the body
 *   → head (ears → skull → cheeks → muzzle → mouth → nose → eyes → brows → hat)
 *   → arms that pass over the face (chin, tip hat, shield)
 *
 * No line jitter, no inner seams where shapes meet. Body space: origin between
 * the feet, y grows downward, the character faces +x (3/4 view) and is about
 * 600 units tall including the hat.
 */

export type ArmMode =
  | 'rest'
  | 'point'
  | 'magnify'
  | 'notebook'
  | 'pencil'
  | 'hold'
  | 'hips'
  | 'tiphat'
  | 'hatChest'
  | 'chin'
  | 'shield'
  | 'scratch'
  | 'wave';

/** Mouth chart. The first group are speech shapes (visemes). */
export type MouthShape =
  | 'closed'
  | 'mbp'
  | 'mid'
  | 'open'
  | 'wide'
  | 'o'
  | 'u'
  | 'fv'
  | 'l'
  | 'smile'
  | 'grin'
  | 'frown';

export type HandShape = 'open' | 'fist' | 'point' | 'flat';

export const BPM = 104;
export const BEAT = 60 / BPM;

/** Head scale relative to head space; head space has a skull radius of ~92. */
const HEAD_SCALE = 0.95;
export const FOX_HEAD = { x: 16, y: -418 };
export const FOX_FRONT_SHOULDER = { x: 48, y: -302 };
const BACK_SHOULDER = { x: -46, y: -302 };
const NECK = { x: 12, y: -350 };

export interface FoxPose {
  x: number;
  y: number;
  scale: number;
  facing?: 1 | -1;
  time: number;
  bounce?: number;
  walk?: number;
  walkPhase?: number;
  lean?: number;
  squash?: number;
  jump?: number;
  lookX?: number;
  lookY?: number;
  brows?: number;
  worry?: number;
  skeptic?: number;
  /** Angry/determined brows, 0..1. */
  angry?: number;
  surprise?: number;
  speaking?: boolean;
  /** Explicit viseme from the narration text; used while speaking. */
  viseme?: MouthShape;
  mouth?: MouthShape;
  /** 'happy' draws closed smiling eyes. */
  eyes?: 'open' | 'happy';
  armFront?: ArmMode;
  armBack?: ArmMode;
  armFrontFrom?: ArmMode;
  armFrontBlend?: number;
  armBackFrom?: ArmMode;
  armBackBlend?: number;
  pointAngle?: number;
  headTilt?: number;
  earDroop?: number;
  hatLift?: number;
  lids?: number;
  wink?: boolean;
  pop?: { symbol: '!' | '?' | '!?'; p: number } | null;
  sweat?: number;
  sparkle?: number;
  speedLines?: number;
  skid?: number;
  /** Hide the ground shadow (used on model sheets and title cards). */
  noShadow?: boolean;
}

// ------------------------------------------------------------------ palette

export const FOX_COLORS = {
  ink: '#1a100a',
  fur: '#d4722e',
  furShade: '#a9531c',
  cream: '#f7ecd3',
  creamShade: '#ddc79e',
  earInner: '#f2dcc0',
  earTip: '#2a1a12',
  coat: '#6e4a2d',
  coatShade: '#4c321e',
  coatLight: '#86603e',
  trousers: '#30231a',
  trousersShade: '#211810',
  hat: '#2f261e',
  hatShade: '#1e1813',
  band: '#7d522e',
  brass: '#d6a445',
  brassHi: '#f7de97',
  glove: '#fdf9ee',
  gloveShade: '#e2d6bb',
  shoe: '#1c130d',
  shoeHi: '#4a3628',
  shirt: '#f2e7cd',
  tie: '#a63e20',
  eye: '#fffdf6',
  mouth: '#3b1309',
  tongue: '#c9573c',
};
const C = FOX_COLORS;

const OUT = 5;
const IN = 3.5;

// ------------------------------------------------------------------ timing helpers

export function blinkAmount(time: number, seed = 1): number {
  const period = 3.2;
  const cycle = Math.floor(time / period);
  const offset = 0.3 + hash(cycle * 31 + seed) * 2.5;
  const p = time - cycle * period - offset;
  if (p < 0 || p > 0.16) return 0;
  return 1 - Math.abs(p / 0.08 - 1);
}

/** Fallback lip-sync when no narration text is available. */
export function speakingMouth(time: number): MouthShape {
  const step = Math.floor(time * 10);
  if (hash(Math.floor(time * 2.3) * 13 + 5) < 0.12) return 'closed';
  const shapes: MouthShape[] = ['mid', 'open', 'wide', 'o', 'mbp', 'open', 'fv', 'mid', 'u', 'wide'];
  return shapes[Math.floor(hash(step * 3 + 1) * shapes.length)];
}

/**
 * Viseme for a position inside a line of narration: maps the letter being
 * spoken to one of the mouth-chart shapes. Approximate by design: timing is
 * estimated from the subtitle cue, not measured from audio.
 */
export function visemeFromText(text: string, progress: number): MouthShape {
  if (!text) return 'closed';
  const i = Math.min(text.length - 1, Math.max(0, Math.floor(progress * text.length)));
  const ch = text[i].toLowerCase();
  const next = (text[i + 1] ?? '').toLowerCase();
  if (/[.,;:!?—–]/.test(ch)) return 'closed';
  if (ch === ' ') return /[mbp]/.test(next) ? 'mbp' : 'mid';
  if (/[mbp]/.test(ch)) return 'mbp';
  if (/[fv]/.test(ch)) return 'fv';
  if (ch === 'o') return 'o';
  if (/[uwq]/.test(ch)) return 'u';
  if (ch === 'a') return 'open';
  if (/[eiy]/.test(ch)) return 'wide';
  if (/[lt dn]/.test(ch)) return 'l';
  if (/[0-9]/.test(ch)) return 'open';
  return 'mid';
}

/**
 * Viseme driven by the recorded voice: the audio level decides when the mouth
 * is shut (pauses, breaths) and how wide it opens; the text picks the shape.
 */
export function visemeFromVoice(text: string, progress: number, level: number): MouthShape {
  if (level < 0.12) return 'closed';
  const shape = visemeFromText(text, progress);
  if (shape === 'closed') return level > 0.45 ? 'mid' : 'closed';
  if (level > 0.7 && (shape === 'mid' || shape === 'l')) return 'open';
  if (level < 0.3 && (shape === 'open' || shape === 'wide' || shape === 'o')) return 'mid';
  return shape;
}

export const beatLift = (time: number) => Math.abs(Math.sin((Math.PI * time) / BEAT));

// ------------------------------------------------------------------ primitive helpers

type G = CanvasRenderingContext2D;

function stroke(g: G, w = OUT) {
  g.lineWidth = w;
  g.strokeStyle = C.ink;
  g.stroke();
}
function fill(g: G, color: string) {
  g.fillStyle = color;
  g.fill();
}
function ellipse(g: G, x: number, y: number, rx: number, ry: number, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
}
/** Fill a shape, shade part of it through a clip, then outline it. */
function celShape(g: G, path: () => void, base: string, shade?: () => void, shadeColor?: string, w = OUT) {
  path();
  fill(g, base);
  if (shade && shadeColor) {
    g.save();
    path();
    g.clip();
    g.fillStyle = shadeColor;
    shade();
    g.restore();
  }
  path();
  stroke(g, w);
}
function shine(g: G, x: number, y: number, rx: number, ry: number, rot = 0, a = 0.9) {
  g.fillStyle = `rgba(255, 253, 245, ${a})`;
  ellipse(g, x, y, rx, ry, rot);
  g.fill();
}

// ------------------------------------------------------------------ main entry

export type FoxStyle = 'painted' | 'vector';
let foxStyle: FoxStyle = 'painted';
/** Pick the character look: the painted puppet (default) or the vector rig. */
export function setFoxStyle(style: FoxStyle) {
  foxStyle = style;
}
export function getFoxStyle(): FoxStyle {
  return foxStyle === 'painted' && rigReady() ? 'painted' : 'vector';
}

export function drawFox(g: G, pose: FoxPose): void {
  if (foxStyle === 'painted' && rigReady()) return drawFoxSheetRig(g, pose);
  const time = pose.time;
  const facing = pose.facing ?? 1;
  const walk = clamp(pose.walk ?? 0);
  const phase = pose.walkPhase ?? time * TAU * 1.6;
  const surprise = clamp(pose.surprise ?? 0);

  // Rubber-hose bounce on the beat (paused while walking).
  const bounceAmt = (pose.bounce ?? 1) * (1 - walk);
  const lift = beatLift(time);
  const landing = Math.pow(1 - lift, 6);
  const walkBob = Math.abs(Math.sin(phase)) * 14 * walk;
  const bob = -(lift * 8 * bounceAmt + walkBob) - surprise * 10;
  const kneeBend = landing * 10 * bounceAmt + (1 - Math.abs(Math.sin(phase))) * 6 * walk;
  const squash = (pose.squash ?? 0) + landing * 0.03 * bounceAmt - surprise * 0.05;
  const lean = (pose.lean ?? 0) + walk * 0.07;
  const jump = pose.jump ?? 0;
  // Secondary motion: the head and ears trail the body.
  const headBob = -(beatLift(time - 0.07) * 8 * bounceAmt + Math.abs(Math.sin(phase - 0.4)) * 14 * walk) - surprise * 12;
  const earSwing = (beatLift(time - 0.14) - lift) * 0.22 * bounceAmt + Math.sin(phase * 2 - 0.8) * 0.1 * walk;

  g.save();
  g.translate(pose.x, pose.y);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  if (!pose.noShadow) {
    g.save();
    g.scale(pose.scale, pose.scale);
    const k = 1 / (1 + jump / 160 + lift * 0.08 * bounceAmt);
    g.fillStyle = 'rgba(10, 5, 2, 0.4)';
    ellipse(g, 0, 4, 125 * k, 18 * k);
    g.fill();
    g.restore();
  }

  g.scale(pose.scale * facing, pose.scale);
  drawSpeedLines(g, pose.speedLines ?? 0, time);
  drawSkid(g, pose.skid ?? 0, time);
  drawFootDust(g, walk, phase);

  g.translate(0, -jump);
  g.rotate(lean);
  g.scale(1 + squash * 0.8, 1 - squash);

  const arms = resolveArms(pose);
  const backT = armTarget(arms.back, false, pose, bob);
  const frontT = armTarget(arms.front, true, pose, bob);

  if (backT.layer === 'behind') drawArm(g, backT, false, pose, bob);
  drawTail(g, time, bob, walk, phase, surprise);
  drawLegs(g, phase, walk, kneeBend);
  drawCoat(g, bob, walk, phase, time);
  if (backT.layer === 'front') drawArm(g, backT, false, pose, bob);
  if (frontT.layer !== 'over') drawArm(g, frontT, true, pose, bob);
  drawHead(g, pose, headBob, surprise, earSwing, arms.front.hatChest);
  if (frontT.layer === 'over') drawArm(g, frontT, true, pose, bob);
  if (arms.front.hatChest > 0) drawLooseHat(g, pose, headBob, arms.front.hatChest, frontT);
  drawPop(g, pose, headBob);
  g.restore();
}

// ------------------------------------------------------------------ effects around the body

function drawSpeedLines(g: G, amt: number, time: number) {
  if (amt <= 0) return;
  g.save();
  g.strokeStyle = `rgba(26, 16, 10, ${0.65 * amt})`;
  g.lineWidth = 5;
  for (let i = 0; i < 6; i++) {
    const y = -90 - i * 75 + Math.sin(time * 20 + i) * 6;
    const len = 80 + hash(i * 7) * 120;
    const x0 = -120 - hash(i * 3) * 50;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x0 - len * amt, y);
    g.stroke();
  }
  g.restore();
}

function drawSkid(g: G, amt: number, time: number) {
  if (amt <= 0) return;
  g.save();
  for (let i = 0; i < 7; i++) {
    const a = hash(i * 5 + 1);
    g.fillStyle = `rgba(230, 210, 175, ${amt * 0.55})`;
    ellipse(g, 44 + i * 22 + time * 30 * (1 - amt), -10 - a * 30 - (1 - amt) * 30, 16 + a * 16, 12 + a * 10);
    g.fill();
  }
  g.restore();
}

function drawFootDust(g: G, walk: number, phase: number) {
  if (walk <= 0) return;
  const cyc = (((phase / Math.PI) % 1) + 1) % 1;
  const a = (1 - cyc) * walk * 0.5;
  g.save();
  g.fillStyle = `rgba(220, 200, 165, ${a})`;
  for (let i = 0; i < 3; i++) {
    ellipse(g, -40 - i * 18 - cyc * 30, -8 - i * 6 - cyc * 18, 12 + cyc * 14, 8 + cyc * 8);
    g.fill();
  }
  g.restore();
}

// ------------------------------------------------------------------ tail

function drawTail(g: G, time: number, bob: number, walk: number, phase: number, surprise: number) {
  const wag = Math.sin(time * 3) * 10 + Math.sin(phase) * 8 * walk - surprise * 18;
  const up = surprise * 24;
  g.save();
  g.translate(0, bob * 0.6);
  // A bushy S-curve that rises behind the coat; its root is hidden by the coat.
  const path = () => {
    g.beginPath();
    g.moveTo(-40, -205);
    g.bezierCurveTo(-120, -215, -170 + wag * 0.5, -250 - up, -196 + wag, -318 - up);
    g.bezierCurveTo(-214 + wag, -270 - up, -206 + wag * 0.6, -190, -150, -150);
    g.bezierCurveTo(-110, -128, -70, -132, -40, -140);
    g.closePath();
  };
  celShape(
    g,
    path,
    C.fur,
    () => {
      g.beginPath();
      g.moveTo(-210 + wag, -260);
      g.bezierCurveTo(-200, -200, -150, -150, -40, -138);
      g.lineTo(-40, -110);
      g.lineTo(-240, -110);
      g.closePath();
      g.fill();
      // Cream tip.
      g.fillStyle = C.cream;
      ellipse(g, -198 + wag, -300 - up, 40, 46, -0.4);
      g.fill();
    },
    C.furShade,
  );
  g.restore();
}

// ------------------------------------------------------------------ legs

function drawLegs(g: G, phase: number, walk: number, kneeBend: number) {
  // Back leg first, then front leg.
  for (const side of [-1, 1] as const) {
    const s = side === 1 ? Math.sin(phase) : -Math.sin(phase);
    const cs = side === 1 ? Math.cos(phase) : -Math.cos(phase);
    const stride = s * 32 * walk;
    const lift = Math.max(0, cs) * 26 * walk;
    const hipX = side * 22;
    const hipY = -130;
    const ankleX = side * 24 + stride;
    const ankleY = -22 - lift;
    const cx = (hipX + ankleX) / 2 + 14 + kneeBend * 1.4;
    const cy = (hipY + ankleY) / 2 + kneeBend * 0.4;
    const color = side === 1 ? C.trousers : C.trousersShade;
    g.beginPath();
    g.moveTo(hipX, hipY);
    g.quadraticCurveTo(cx, cy, ankleX, ankleY);
    g.lineWidth = 30;
    g.strokeStyle = C.ink;
    g.stroke();
    g.lineWidth = 30 - OUT * 2 + 2;
    g.strokeStyle = color;
    g.stroke();
    drawShoe(g, ankleX + 10, ankleY + 4, -s * 0.16 * walk - Math.max(0, cs) * 0.14 * walk, side === 1);
  }
}

function drawShoe(g: G, x: number, y: number, rot: number, front: boolean) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  const path = () => {
    g.beginPath();
    g.moveTo(-26, 12);
    g.quadraticCurveTo(-32, -14, -6, -16);
    g.quadraticCurveTo(36, -20, 48, 2);
    g.quadraticCurveTo(50, 15, 30, 15);
    g.lineTo(-20, 15);
    g.closePath();
  };
  celShape(g, path, front ? C.shoe : '#140d08', () => g.fillRect(-40, 6, 100, 20), '#0c0806');
  shine(g, 20, -8, 11, 4, -0.15, 0.35);
  g.restore();
}

// ------------------------------------------------------------------ coat

function coatPath(g: G, flap: number) {
  g.beginPath();
  g.moveTo(-30, -340);
  g.quadraticCurveTo(-64, -334, -72, -296);
  g.quadraticCurveTo(-80, -210, -92 - flap * 0.6, -114);
  g.quadraticCurveTo(-4, -100 + flap * 0.3, 90 + flap, -114);
  g.quadraticCurveTo(80, -210, 76, -296);
  g.quadraticCurveTo(70, -334, 46, -340);
  g.closePath();
}

function drawCoat(g: G, bob: number, walk: number, phase: number, time: number) {
  const flap = Math.sin(phase * 2) * 8 * walk + Math.sin(time * 2.4) * 1.5;
  g.save();
  g.translate(0, bob);
  celShape(
    g,
    () => coatPath(g, flap),
    C.coat,
    () => {
      // Shadow down the back of the coat and under the belt.
      g.beginPath();
      g.moveTo(-110, -360);
      g.lineTo(-34, -360);
      g.quadraticCurveTo(-40, -230, -46, -96);
      g.lineTo(-110, -96);
      g.closePath();
      g.fill();
      g.fillRect(-120, -198, 240, 12);
      g.fillStyle = C.coatLight;
      g.fillRect(60, -330, 40, 200);
    },
    C.coatShade,
  );

  // Front opening, pocket flaps (inner lines, thinner).
  g.beginPath();
  g.moveTo(24, -252);
  g.quadraticCurveTo(28, -180, 32, -104);
  g.moveTo(-60, -168);
  g.lineTo(-24, -171);
  g.moveTo(50, -170);
  g.lineTo(78, -166);
  stroke(g, IN);

  // Belt and buckle.
  g.beginPath();
  g.rect(-84, -222, 166, 22);
  g.save();
  coatPath(g, flap);
  g.clip();
  g.beginPath();
  g.rect(-120, -222, 240, 22);
  fill(g, C.coatShade);
  g.beginPath();
  g.moveTo(-120, -222);
  g.lineTo(120, -222);
  g.moveTo(-120, -200);
  g.lineTo(120, -200);
  stroke(g, IN);
  g.restore();
  g.beginPath();
  g.roundRect(18, -226, 28, 30, 4);
  fill(g, C.brass);
  stroke(g, IN);
  g.beginPath();
  g.rect(25, -218, 14, 14);
  fill(g, C.coatShade);
  shine(g, 22, -222, 3, 2);

  // Buttons.
  for (const by of [-172, -138]) {
    ellipse(g, 44, by, 6, 6);
    fill(g, C.brass);
    stroke(g, 2.5);
  }

  // Shirt and tie inside the V.
  g.beginPath();
  g.moveTo(-16, -340);
  g.lineTo(36, -340);
  g.lineTo(10, -262);
  g.closePath();
  fill(g, C.shirt);
  stroke(g, IN);
  g.beginPath();
  g.moveTo(5, -336);
  g.lineTo(16, -336);
  g.lineTo(15, -296);
  g.lineTo(10, -282);
  g.lineTo(5, -296);
  g.closePath();
  fill(g, C.tie);
  stroke(g, 2.5);

  // Lapels with a popped collar.
  const lapel = (pts: [number, number][], color: string) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
    g.closePath();
    fill(g, color);
    stroke(g, IN + 0.5);
  };
  lapel(
    [
      [-18, -342],
      [-56, -366],
      [-46, -300],
      [8, -258],
    ],
    C.coatShade,
  );
  lapel(
    [
      [38, -342],
      [74, -366],
      [64, -300],
      [12, -258],
    ],
    C.coatLight,
  );
  g.restore();
}

// ------------------------------------------------------------------ head

function drawHead(g: G, pose: FoxPose, bob: number, surprise: number, earSwing: number, hatGone: number) {
  g.save();
  // Pivot at the neck so tilts read as nods.
  g.translate(NECK.x, NECK.y + bob);
  g.rotate((pose.headTilt ?? 0) + clamp(pose.lookY ?? 0, -1, 1) * 0.05 - surprise * 0.04);
  g.translate(FOX_HEAD.x - NECK.x, FOX_HEAD.y - NECK.y);
  g.scale(HEAD_SCALE, HEAD_SCALE);
  drawHeadParts(g, pose, surprise, earSwing, hatGone <= 0);
  g.restore();
}

/** Head in head space (skull centre at the origin, facing right). Exported for the model sheet. */
export function drawHeadParts(g: G, pose: FoxPose, surprise: number, earSwing: number, withHat: boolean) {
  const droop = clamp(pose.earDroop ?? 0);
  const perk = surprise;

  // --- Ears (behind the head; roots hidden by the head and the hat brim).
  drawEar(g, { bx: -54, by: -46, len: 110, base: 54, ang: -2.08 - droop * 0.75 + earSwing - perk * 0.12 }, true);
  drawEar(g, { bx: 26, by: -66, len: 114, base: 56, ang: -1.12 + droop * 0.75 - earSwing + perk * 0.12 }, false);

  // --- Mouth state decides how far the jaw drops.
  let shape: MouthShape = pose.mouth ?? 'closed';
  if (pose.speaking && !pose.mouth) shape = pose.viseme ?? speakingMouth(pose.time);
  if (surprise > 0.5) shape = 'o';
  const jaw = JAW_DROP[shape];

  // --- One continuous head silhouette: skull flowing into the muzzle, cheek fur at the back.
  const head = () => headPath(g, jaw);
  head();
  fill(g, C.fur);
  g.save();
  head();
  g.clip();
  // Cream mask: lower muzzle, chin and cheeks.
  g.fillStyle = C.cream;
  g.beginPath();
  g.moveTo(-120, 34);
  g.bezierCurveTo(-60, 14, -10, 30, 34, 14);
  g.bezierCurveTo(80, -2, 140, -4, 200, -6);
  g.lineTo(200, 140);
  g.lineTo(-120, 140);
  g.closePath();
  g.fill();
  // Shadow on the back of the head and under the brow.
  g.fillStyle = C.furShade;
  g.beginPath();
  g.moveTo(-110, -90);
  g.bezierCurveTo(-60, -60, -64, 10, -40, 40);
  g.lineTo(-120, 60);
  g.closePath();
  g.fill();
  g.fillStyle = C.creamShade;
  g.beginPath();
  g.moveTo(-120, 60);
  g.bezierCurveTo(-40, 50, 20, 70, 70, 50 + jaw);
  g.bezierCurveTo(120, 40 + jaw * 0.6, 160, 20 + jaw * 0.3, 200, 14);
  g.lineTo(200, 160);
  g.lineTo(-120, 160);
  g.closePath();
  g.fill();
  // Hat-brim shadow across the forehead.
  if (withHat) {
    g.fillStyle = 'rgba(90, 30, 6, 0.38)';
    g.beginPath();
    g.ellipse(-8, -70, 122, 20, -0.05, 0, TAU);
    g.fill();
  }
  // Muzzle-top highlight.
  g.fillStyle = 'rgba(255, 210, 160, 0.35)';
  g.beginPath();
  g.ellipse(112, -24, 44, 6, -0.18, 0, TAU);
  g.fill();
  g.restore();
  head();
  stroke(g, OUT);

  // Inner construction lines (tapered): cheek fur, muzzle crease, whisker dots.
  taperQ(g, -66, 30, -50, 44, -30, 40, 3.2);
  taperQ(g, -48, 52, -34, 62, -16, 56, 3);
  taperQ(g, 40, 6, 56, 0, 72, 4, 2.6);
  g.fillStyle = C.ink;
  for (const [x, y] of [
    [104, 6],
    [118, 2],
    [112, 14],
    [128, 9],
  ]) {
    ellipse(g, x, y, 2.4, 2.4);
    g.fill();
  }

  // --- Mouth interior, teeth, tongue and lower jaw.
  drawMouth(g, shape, jaw);

  // --- Nose: a rounded wedge with a highlight.
  g.beginPath();
  g.moveTo(160, -16);
  g.bezierCurveTo(172, -26, 192, -18, 190, -4);
  g.bezierCurveTo(188, 8, 172, 12, 162, 6);
  g.bezierCurveTo(154, 0, 154, -10, 160, -16);
  g.closePath();
  fill(g, C.ink);
  shine(g, 176, -14, 7, 3.5, -0.2, 0.75);

  // --- Eyes and brows.
  drawEyes(g, pose, surprise);
  drawBrows(g, pose, surprise);

  // --- Hat.
  if (withHat) drawHat(g, 0, -(pose.hatLift ?? 0) - surprise * 30, -0.05 - surprise * 0.12);

  // Sweat drop.
  const sweat = clamp(pose.sweat ?? 0);
  if (sweat > 0) {
    const sy = -30 + ((pose.time * 0.8) % 1) * 50;
    g.save();
    g.globalAlpha = sweat;
    g.beginPath();
    g.moveTo(-104, sy - 24);
    g.quadraticCurveTo(-90, sy, -94, sy + 6);
    g.quadraticCurveTo(-106, sy + 14, -114, sy + 2);
    g.quadraticCurveTo(-114, sy - 8, -104, sy - 24);
    fill(g, '#cfe7f2');
    stroke(g, 2.5);
    g.restore();
  }
}

/** How far the lower jaw drops for each mouth shape (head units). */
const JAW_DROP: Record<MouthShape, number> = {
  closed: 0,
  mbp: 0,
  smile: 0,
  frown: 0,
  mid: 9,
  fv: 6,
  l: 15,
  u: 12,
  o: 20,
  wide: 16,
  open: 24,
  grin: 18,
};

/** The head outline. `jaw` lowers the chin and under-muzzle line. */
function headPath(g: G, jaw: number) {
  g.beginPath();
  // Neck at the back, up around the skull.
  g.moveTo(-34, 72);
  g.bezierCurveTo(-60, 70, -96, 50, -100, 6);
  g.bezierCurveTo(-104, -50, -70, -88, -18, -90);
  // Crown to forehead to the brow stop.
  g.bezierCurveTo(30, -92, 64, -72, 74, -46);
  // Bridge of the muzzle to the nose.
  g.bezierCurveTo(100, -34, 140, -24, 168, -14);
  g.lineTo(184, 4);
  // Under the muzzle, back to the jaw (drops when the mouth opens).
  g.bezierCurveTo(160, 18 + jaw * 0.3, 112, 30 + jaw * 0.8, 74, 44 + jaw);
  g.bezierCurveTo(56, 52 + jaw, 40, 60 + jaw * 0.6, 26, 62);
  // Cheek fur tufts back to the neck.
  g.lineTo(16, 76);
  g.lineTo(2, 64);
  g.lineTo(-10, 82);
  g.lineTo(-20, 66);
  g.closePath();
}

/** A tapered ink stroke along a quadratic curve — thick in the middle, thin at the ends. */
function taperQ(g: G, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w: number, color = C.ink) {
  const N = 14;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    const dx = 2 * mt * (cx - x0) + 2 * t * (x1 - cx);
    const dy = 2 * mt * (cy - y0) + 2 * t * (y1 - cy);
    const len = Math.hypot(dx, dy) || 1;
    const half = (w / 2) * Math.max(0.12, Math.pow(Math.sin(Math.PI * t), 0.7));
    left.push([x - (dy / len) * half, y + (dx / len) * half]);
    right.push([x + (dy / len) * half, y - (dx / len) * half]);
  }
  g.beginPath();
  g.moveTo(left[0][0], left[0][1]);
  for (const [x, y] of left) g.lineTo(x, y);
  for (const [x, y] of right.reverse()) g.lineTo(x, y);
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

function drawEar(g: G, e: { bx: number; by: number; len: number; base: number; ang: number }, back: boolean) {
  g.save();
  g.translate(e.bx, e.by);
  g.rotate(e.ang + Math.PI / 2);
  const hb = e.base / 2;
  const path = () => {
    g.beginPath();
    g.moveTo(-hb, 12);
    g.bezierCurveTo(-hb * 1.05, -e.len * 0.45, -hb * 0.35, -e.len * 0.85, 0, -e.len);
    g.bezierCurveTo(hb * 0.35, -e.len * 0.85, hb * 1.05, -e.len * 0.45, hb, 12);
    g.closePath();
  };
  path();
  fill(g, back ? C.furShade : C.fur);
  g.save();
  path();
  g.clip();
  g.fillStyle = C.earTip;
  g.beginPath();
  g.moveTo(-hb, -e.len * 0.62);
  g.quadraticCurveTo(0, -e.len * 0.7, hb, -e.len * 0.62);
  g.lineTo(hb, -e.len - 20);
  g.lineTo(-hb, -e.len - 20);
  g.closePath();
  g.fill();
  // Inner ear.
  g.fillStyle = back ? C.creamShade : C.earInner;
  g.beginPath();
  g.moveTo(-hb * 0.55, 6);
  g.bezierCurveTo(-hb * 0.55, -e.len * 0.35, -hb * 0.2, -e.len * 0.55, 0, -e.len * 0.62);
  g.bezierCurveTo(hb * 0.2, -e.len * 0.55, hb * 0.55, -e.len * 0.35, hb * 0.55, 6);
  g.closePath();
  g.fill();
  g.restore();
  path();
  stroke(g, OUT);
  // Inner-ear fur tufts.
  taperQ(g, -hb * 0.3, -6, -hb * 0.15, -e.len * 0.25, 0, -e.len * 0.42, 2.6);
  taperQ(g, hb * 0.32, -4, hb * 0.2, -e.len * 0.2, hb * 0.05, -e.len * 0.32, 2.2);
  g.restore();
}

function drawEyes(g: G, pose: FoxPose, surprise: number) {
  const lookX = clamp(pose.lookX ?? 0, -1, 1);
  const lookY = clamp(pose.lookY ?? 0, -1, 1);
  // A relaxed, slightly heavy upper lid is the character's resting look.
  const restLid = 0.16 * (1 - surprise);
  const blink = Math.max(blinkAmount(pose.time), clamp((pose.lids ?? 0) + restLid));
  const pop = 1 + surprise * 0.2;
  const eyes = [
    { x: 10, y: -26, rx: 24, ry: 30, rot: -0.05 },
    { x: 56, y: -30, rx: 19, ry: 27, rot: 0.08 },
  ];
  eyes.forEach((e, i) => {
    const rx = e.rx * (1 + surprise * 0.08);
    const ry = e.ry * pop;
    const ey = e.y - surprise * 6;
    if (pose.eyes === 'happy' || (pose.wink && i === 0)) {
      taperQ(g, e.x - rx, ey + 6, e.x, ey - ry * 0.8, e.x + rx, ey + 6, 7);
      taperQ(g, e.x - rx * 0.6, ey + 14, e.x, ey + 8, e.x + rx * 0.6, ey + 14, 2.5);
      return;
    }
    const path = () => ellipse(g, e.x, ey, rx, ry, e.rot);
    path();
    fill(g, C.eye);
    g.save();
    path();
    g.clip();
    // Soft shading at the top of the eyeball.
    g.fillStyle = 'rgba(160, 140, 120, 0.25)';
    g.fillRect(e.x - rx, ey - ry, rx * 2, ry * 0.5);
    const px = e.x + 5 + lookX * rx * 0.42;
    const py = ey + 4 + lookY * ry * 0.34;
    ellipse(g, px, py, rx * (0.38 - surprise * 0.1), ry * (0.44 - surprise * 0.12), e.rot);
    fill(g, C.ink);
    shine(g, px - rx * 0.1, py - ry * 0.18, rx * 0.13, ry * 0.1);
    shine(g, px + rx * 0.12, py + ry * 0.16, rx * 0.05, ry * 0.04, 0, 0.6);
    // Upper lid: fur-coloured cap with a heavy, curved lid line.
    if (blink > 0) {
      const lidY = ey - ry + ry * 2 * blink;
      g.fillStyle = C.fur;
      g.beginPath();
      g.moveTo(e.x - rx - 6, ey - ry - 6);
      g.lineTo(e.x + rx + 6, ey - ry - 6);
      g.lineTo(e.x + rx + 6, lidY - 4);
      g.quadraticCurveTo(e.x, lidY + 6, e.x - rx - 6, lidY + 2);
      g.closePath();
      g.fill();
      g.fillStyle = C.furShade;
      g.fillRect(e.x - rx - 6, lidY - 8, rx * 2 + 12, 6);
    }
    g.restore();
    path();
    stroke(g, OUT - 1.5);
    if (blink > 0) {
      const lidY = ey - ry + ry * 2 * blink;
      taperQ(g, e.x - rx - 2, lidY + 1, e.x, lidY + 9, e.x + rx + 2, lidY - 3, 6);
    }
  });
  // Lower-lid creases under the near eye for volume.
  taperQ(g, -8, 8, 10, 14, 28, 8, 2.4);
}

function drawBrows(g: G, pose: FoxPose, surprise: number) {
  const raise = (pose.brows ?? 0) + surprise * 1.3;
  const worry = pose.worry ?? 0;
  const skeptic = pose.skeptic ?? 0;
  const angry = pose.angry ?? 0;
  const y = -66 - raise * 11;
  // Near brow (outer end left, inner end toward the muzzle).
  taperQ(g, -20, y + 8 + skeptic * 10, 0, y - 6 + skeptic * 8 - worry * 4, 30, y + 4 - worry * 18 + angry * 20 + skeptic * 10, 10);
  // Far brow (inner end left).
  taperQ(g, 44, y - 2 - worry * 18 + angry * 20 - skeptic * 16, 62, y - 12 - skeptic * 16, 80, y + 2 - skeptic * 10 + worry * 6 - angry * 4, 9);
}

function drawMouth(g: G, shape: MouthShape, jaw: number) {
  // The mouth line runs along the under-muzzle contour into a cheek crease.
  const cornerX = 54;
  const cornerY = 38;
  if (shape === 'o' || shape === 'u') {
    // Rounded vowels: the mouth line closes up and a rounded opening sits under the muzzle.
    const o = shape === 'o';
    const mx = o ? 112 : 128;
    const my = (o ? 32 : 26) + jaw * 0.5;
    const rx = o ? 24 : 12;
    const ry = (o ? 9 : 5) + jaw * 0.5;
    taperQ(g, 50, 38, 70, 40, mx - rx + 2, my - 2, 3.4);
    const hole = () => ellipse(g, mx, my, rx, ry, -0.22);
    hole();
    fill(g, C.mouth);
    g.save();
    hole();
    g.clip();
    g.fillStyle = C.tongue;
    ellipse(g, mx + 2, my + ry * 0.75, rx * 0.8, ry * 0.55);
    g.fill();
    g.restore();
    hole();
    stroke(g, OUT - 1.5);
    // Pursed-lip rim.
    taperQ(g, mx - rx - 4, my + 4, mx, my + ry + 10, mx + rx + 2, my + 2, 3);
    if (!o) taperQ(g, mx - rx - 6, my - 6, mx - rx - 10, my, mx - rx - 6, my + 6, 2.4);
    return;
  }
  if (jaw <= 0) {
    if (shape === 'mbp') {
      // Lips pressed together: a heavier line with a small rolled lower lip.
      taperQ(g, 48, 36, 96, 36, 140, 24, 7);
      taperQ(g, 136, 24, 156, 18, 170, 12, 3);
      taperQ(g, 78, 44, 100, 50, 122, 40, 3);
      taperQ(g, 42, 30, 44, 36, 50, 40, 3);
      return;
    }
    if (shape === 'smile') {
      taperQ(g, 44, 26, 64, 46, 104, 34, 5);
      taperQ(g, 100, 34, 140, 26, 168, 14, 4);
      taperQ(g, 38, 18, 40, 24, 46, 30, 3);
      return;
    }
    if (shape === 'frown') {
      taperQ(g, 52, 44, 80, 30, 120, 30, 4.5);
      taperQ(g, 118, 30, 150, 22, 168, 14, 3.5);
      return;
    }
    taperQ(g, 50, 36, 96, 34, 138, 24, 4.5);
    taperQ(g, 136, 24, 156, 18, 170, 12, 3);
    taperQ(g, 44, 28, 46, 34, 52, 38, 3);
    return;
  }
  // Open mouth: dark interior between the muzzle line and the dropped jaw.
  const endX = 160;
  const endY = 16;
  const interior = () => {
    g.beginPath();
    g.moveTo(cornerX, cornerY);
    g.bezierCurveTo(100, 30, 140, 22, endX, endY);
    g.bezierCurveTo(150, 18 + jaw * 0.35, 116, 28 + jaw * 0.85, 84, 38 + jaw);
    g.bezierCurveTo(70, 42 + jaw * 0.9, cornerX - 2, 40, cornerX, cornerY);
    g.closePath();
  };
  interior();
  fill(g, C.mouth);
  g.save();
  interior();
  g.clip();
  // Tongue.
  g.fillStyle = C.tongue;
  ellipse(g, 106, 40 + jaw * (shape === 'l' ? 0.4 : 0.9), 30, 12 + jaw * 0.3);
  g.fill();
  // Upper teeth with a small fang.
  {
    g.fillStyle = C.eye;
    g.beginPath();
    g.moveTo(cornerX, cornerY);
    g.bezierCurveTo(100, 30, 140, 22, endX, endY);
    g.lineTo(endX, endY + 7);
    g.bezierCurveTo(130, 30, 104, 36, 88, 40);
    g.lineTo(82, 48);
    g.lineTo(76, 40);
    g.lineTo(cornerX, cornerY + 4);
    g.closePath();
    g.fill();
  }
  g.restore();
  interior();
  stroke(g, OUT - 1.5);
  // Lower-jaw and cheek creases.
  taperQ(g, cornerX - 10, cornerY - 10, cornerX - 8, cornerY - 2, cornerX, cornerY, 3);
  taperQ(g, 70, 46 + jaw, 90, 52 + jaw, 110, 44 + jaw * 0.8, 2.5);
}

function drawHat(g: G, x: number, y: number, rot: number) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  // Brim top (seen from slightly above), behind the crown.
  const brimTop = () => ellipse(g, -8, -98, 120, 21);
  celShape(g, brimTop, C.hat, () => g.fillRect(-140, -100, 280, 30), C.hatShade);
  taperQ(g, -100, -102, -8, -116, 84, -104, 2.4, 'rgba(255,240,220,0.18)');

  // Crown: tapered, with a centre dent and side pinches.
  const crown = () => {
    g.beginPath();
    g.moveTo(-60, -100);
    g.bezierCurveTo(-66, -130, -62, -160, -48, -176);
    g.quadraticCurveTo(-30, -186, -12, -176);
    g.quadraticCurveTo(-4, -170, 4, -178);
    g.quadraticCurveTo(26, -190, 42, -176);
    g.bezierCurveTo(54, -158, 58, -130, 52, -100);
    g.closePath();
  };
  crown();
  fill(g, C.hat);
  g.save();
  crown();
  g.clip();
  g.fillStyle = C.hatShade;
  g.beginPath();
  g.moveTo(-80, -200);
  g.lineTo(-24, -200);
  g.bezierCurveTo(-34, -160, -40, -130, -30, -96);
  g.lineTo(-80, -96);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255, 238, 215, 0.13)';
  g.beginPath();
  g.moveTo(20, -186);
  g.bezierCurveTo(34, -160, 38, -130, 36, -100);
  g.lineTo(46, -100);
  g.bezierCurveTo(50, -130, 46, -160, 30, -190);
  g.closePath();
  g.fill();
  // Band.
  g.fillStyle = C.band;
  g.fillRect(-80, -128, 160, 26);
  g.fillStyle = 'rgba(40, 20, 8, 0.35)';
  g.fillRect(-80, -108, 160, 6);
  g.fillRect(-80, -128, 50, 26);
  g.restore();
  crown();
  stroke(g, OUT);
  taperQ(g, -62, -128, -6, -124, 55, -129, 3);
  taperQ(g, -61, -103, -6, -100, 53, -103, 2.2);
  // Dent and pinches.
  taperQ(g, -6, -172, -10, -160, -4, -144, 3.4);
  taperQ(g, -44, -168, -36, -152, -42, -136, 2.6);
  taperQ(g, 38, -172, 32, -154, 38, -138, 2.6);
  // Brass pin (the costume's one bright accent).
  g.beginPath();
  g.moveTo(26, -115);
  g.lineTo(36, -126);
  g.lineTo(46, -115);
  g.lineTo(36, -104);
  g.closePath();
  fill(g, C.brass);
  stroke(g, 2.5);
  shine(g, 34, -118, 3, 2.5);

  // Front lip of the brim, curling up at the sides, over the crown's base.
  const lip = () => {
    g.beginPath();
    g.moveTo(-130, -104);
    g.quadraticCurveTo(-122, -82, -62, -77);
    g.quadraticCurveTo(-8, -71, 50, -77);
    g.quadraticCurveTo(106, -82, 114, -104);
    g.quadraticCurveTo(72, -90, -8, -90);
    g.quadraticCurveTo(-88, -90, -130, -104);
    g.closePath();
  };
  lip();
  fill(g, C.hatShade);
  g.save();
  lip();
  g.clip();
  g.fillStyle = C.hat;
  g.fillRect(-140, -100, 280, 12);
  g.restore();
  lip();
  stroke(g, OUT);
  g.restore();
}

// ------------------------------------------------------------------ cartoon symbols

function drawPop(g: G, pose: FoxPose, bob: number) {
  const sparkle = clamp(pose.sparkle ?? 0);
  if (sparkle > 0) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + pose.time * 1.5;
      const r = 140 + Math.sin(pose.time * 4 + i) * 10;
      star(g, FOX_HEAD.x + Math.cos(a) * r, FOX_HEAD.y + bob + Math.sin(a) * r * 0.7 - 20, 11 + sparkle * 8, pose.time * 3 + i, sparkle);
    }
  }
  const pop = pose.pop;
  if (!pop || pop.p <= 0 || pop.p >= 1) return;
  const p = pop.p;
  const inP = clamp(p / 0.18);
  const outP = clamp((p - 0.8) / 0.2);
  const s = (inP < 1 ? lerp(0.2, 1.25, easeOut(inP)) : 1 + Math.sin(p * 30) * 0.05 * (1 - p)) * (1 - outP);
  g.save();
  g.translate(FOX_HEAD.x + 80, FOX_HEAD.y + bob - 230);
  g.rotate(Math.sin(p * 18) * 0.12 * (1 - p));
  g.scale(s, s);
  const glyphs = pop.symbol === '!?' ? ['!', '?'] : [pop.symbol];
  glyphs.forEach((sym, i) => {
    g.save();
    g.translate((i - (glyphs.length - 1) / 2) * 54, 0);
    g.rotate(i ? 0.18 : -0.08);
    if (sym === '!') {
      g.beginPath();
      g.moveTo(-14, -72);
      g.lineTo(16, -72);
      g.lineTo(8, 4);
      g.lineTo(-6, 4);
      g.closePath();
      fill(g, C.brassHi);
      stroke(g);
      ellipse(g, 1, 30, 14, 14);
      fill(g, C.brassHi);
      stroke(g);
    } else {
      g.beginPath();
      g.moveTo(-26, -40);
      g.quadraticCurveTo(-24, -80, 6, -80);
      g.quadraticCurveTo(38, -78, 36, -46);
      g.quadraticCurveTo(34, -22, 10, -12);
      g.lineTo(8, 6);
      g.lineTo(-8, 6);
      g.lineTo(-10, -22);
      g.quadraticCurveTo(14, -30, 14, -46);
      g.quadraticCurveTo(14, -60, 4, -60);
      g.quadraticCurveTo(-6, -60, -6, -40);
      g.closePath();
      fill(g, C.brassHi);
      stroke(g);
      ellipse(g, 0, 30, 13, 13);
      fill(g, C.brassHi);
      stroke(g);
    }
    g.restore();
  });
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = -2.6 + i * 0.5;
    g.moveTo(Math.cos(a) * 82, Math.sin(a) * 82 - 20);
    g.lineTo(Math.cos(a) * 106, Math.sin(a) * 106 - 20);
  }
  stroke(g, 5);
  g.restore();
}

function star(g: G, x: number, y: number, r: number, rot: number, a: number) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.globalAlpha = a;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.38 : r;
    const ang = (i / 8) * TAU;
    if (i) g.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    else g.moveTo(rr, 0);
  }
  g.closePath();
  fill(g, C.brassHi);
  stroke(g, 3);
  g.restore();
}

// ------------------------------------------------------------------ arms and hands

type Layer = 'behind' | 'front' | 'over';

interface ArmState {
  from: ArmMode;
  to: ArmMode;
  b: number;
  hatChest: number;
}

interface ArmTarget {
  sx: number;
  sy: number;
  hx: number;
  hy: number;
  bend: number;
  hand: HandShape;
  handRot: number;
  layer: Layer;
  prop: ArmMode;
  front: boolean;
}

function resolveArms(pose: FoxPose): { front: ArmState; back: ArmState } {
  const to = pose.armFront ?? 'rest';
  const from = pose.armFrontFrom ?? to;
  const b = pose.armFrontBlend ?? 1;
  const toB = pose.armBack ?? 'rest';
  const fromB = pose.armBackFrom ?? toB;
  const bb = pose.armBackBlend ?? 1;
  let hatChest = 0;
  if (from === 'hatChest' && to === 'hatChest') hatChest = 1;
  else if (to === 'hatChest') hatChest = clamp(b);
  else if (from === 'hatChest') hatChest = 1 - clamp(b);
  return { front: { from, to, b, hatChest }, back: { from: fromB, to: toB, b: bb, hatChest: 0 } };
}

interface Raw {
  hx: number;
  hy: number;
  bend: number;
  hand: HandShape;
  handRot: number;
  layer: Layer;
}

function rawTarget(mode: ArmMode, front: boolean, pose: FoxPose, bob: number): Raw {
  const t = pose.time;
  const walk = clamp(pose.walk ?? 0);
  const phase = pose.walkPhase ?? t * TAU * 1.6;
  const sh = front ? FOX_FRONT_SHOULDER : BACK_SHOULDER;
  const sy = sh.y + bob;
  const swing = Math.sin(phase + (front ? 0 : Math.PI)) * 32 * walk + Math.sin((t * Math.PI) / BEAT) * 4 * (1 - walk);
  const L = (layer: Layer): Layer => layer;
  switch (mode) {
    case 'rest':
      return { hx: (front ? 76 : -70) + swing, hy: -180 + bob + Math.abs(swing) * 0.3, bend: front ? 26 : -26, hand: 'open', handRot: 0.2, layer: front ? 'front' : 'behind' };
    case 'hips':
      return { hx: front ? 94 : -92, hy: -222 + bob, bend: front ? -50 : 50, hand: 'fist', handRot: front ? 1.2 : -1.2, layer: front ? 'front' : 'behind' };
    case 'point': {
      const a = pose.pointAngle ?? -0.35;
      return { hx: sh.x + Math.cos(a) * 172, hy: sy + Math.sin(a) * 172 + Math.sin(t * 6) * 3, bend: 12, hand: 'point', handRot: 0, layer: L('front') };
    }
    case 'magnify':
      return { hx: 186 + Math.sin(t * 1.9) * 8, hy: -300 + Math.cos(t * 1.4) * 6 + bob, bend: 30, hand: 'fist', handRot: -0.5, layer: 'front' };
    case 'notebook':
      return { hx: front ? 40 : 18, hy: -252 + bob, bend: front ? 30 : -46, hand: 'fist', handRot: 0, layer: 'front' };
    case 'pencil':
      return { hx: 80 + Math.sin(t * 10) * 5, hy: -268 + Math.cos(t * 8) * 3 + bob, bend: 40, hand: 'fist', handRot: -0.3, layer: 'front' };
    case 'hold':
      return front
        ? { hx: 96, hy: -268 + bob, bend: 44, hand: 'fist', handRot: 0, layer: 'front' }
        : { hx: -2, hy: -268 + bob, bend: -40, hand: 'fist', handRot: Math.PI, layer: 'front' };
    case 'tiphat':
      return { hx: 112, hy: -506 + bob, bend: 90, hand: 'fist', handRot: -0.8, layer: 'over' };
    case 'hatChest':
      return { hx: 44, hy: -238 + bob, bend: 52, hand: 'fist', handRot: -0.4, layer: 'front' };
    case 'chin':
      return { hx: 118 + Math.sin(t * 5) * 2, hy: -366 + bob, bend: 84, hand: 'fist', handRot: -1.6, layer: 'over' };
    case 'shield':
      return { hx: 128, hy: -486 + bob, bend: 80, hand: 'flat', handRot: 0.1, layer: 'over' };
    case 'scratch':
      return { hx: front ? 40 : -78, hy: -478 + bob + Math.sin(t * 22) * 6, bend: front ? 84 : -84, hand: 'open', handRot: -1.6, layer: front ? 'over' : 'behind' };
    case 'wave':
      return { hx: 150 + Math.sin(t * 9) * 18, hy: -470 + bob, bend: 40, hand: 'open', handRot: -1.4, layer: 'front' };
  }
}

function armTarget(st: ArmState, front: boolean, pose: FoxPose, bob: number, shoulders?: { front: { x: number; y: number }; back: { x: number; y: number } }): ArmTarget {
  const A = rawTarget(st.from, front, pose, bob);
  const B = rawTarget(st.to, front, pose, bob);
  const b = st.b;
  const dom = b >= 0.5 ? B : A;
  const sh = shoulders ? (front ? shoulders.front : shoulders.back) : front ? FOX_FRONT_SHOULDER : BACK_SHOULDER;
  // While blending between layers, the arm stays in the layer of the pose it is closest to.
  return {
    sx: sh.x,
    sy: sh.y + bob,
    hx: lerp(A.hx, B.hx, b),
    hy: lerp(A.hy, B.hy, b),
    bend: lerp(A.bend, B.bend, clamp(b)),
    hand: dom.hand,
    handRot: lerp(A.handRot, B.handRot, clamp(b)),
    layer: dom.layer,
    prop: b >= 0.5 ? st.to : st.from,
    front,
  };
}

function drawArm(g: G, T: ArmTarget, front: boolean, _pose: FoxPose, bob: number) {
  const { sx, sy, hx, hy, bend } = T;
  const dx = hx - sx;
  const dy = hy - sy;
  const len = Math.hypot(dx, dy) || 1;
  const cx = (sx + hx) / 2 + (-dy / len) * bend;
  const cy = (sy + hy) / 2 + (dx / len) * bend;
  const sleeve = front ? C.coat : C.coatShade;
  // Sleeve tube: ink pass, then colour pass (one clean outline, no seams).
  g.beginPath();
  g.moveTo(sx, sy);
  g.quadraticCurveTo(cx, cy, hx, hy);
  g.lineWidth = 36;
  g.strokeStyle = C.ink;
  g.stroke();
  g.lineWidth = 36 - OUT * 2 + 1;
  g.strokeStyle = sleeve;
  g.stroke();
  const ang = Math.atan2(hy - cy, hx - cx);
  // Fabric creases at the elbow, on the inside of the bend.
  if (Math.abs(bend) > 20) {
    const mx = 0.25 * sx + 0.5 * cx + 0.25 * hx;
    const my = 0.25 * sy + 0.5 * cy + 0.25 * hy;
    const ux = dx / len;
    const uy = dy / len;
    const side = bend > 0 ? -1 : 1;
    const nx = -uy * side;
    const ny = ux * side;
    for (const o of [-9, 7]) {
      const bx = mx + ux * o;
      const by = my + uy * o;
      taperQ(g, bx + nx * 15, by + ny * 15, bx + nx * 6 + ux * 4, by + ny * 6 + uy * 4, bx - nx * 2 + ux * 2, by - ny * 2 + uy * 2, 2.6);
    }
  }

  // Props behind the glove.
  if (T.prop === 'magnify' && front) drawMagnifier(g, hx, hy, 0.6);
  if (T.prop === 'pencil' && front) drawPencil(g, hx, hy);
  if (T.prop === 'notebook' && !front) drawNotebook(g, hx + 30, hy - 30);
  if (T.prop === 'hold' && front) drawHeldPaper(g, 46, -284 + bob);

  // Cuff band at the wrist.
  g.save();
  g.translate(hx, hy);
  g.rotate(ang);
  g.beginPath();
  g.roundRect(-26, -17, 12, 34, 4);
  fill(g, C.coatShade);
  stroke(g, IN);
  g.restore();
  drawHand(g, hx, hy, ang + T.handRot, T.hand);
}

/** Cartoon glove in one of four shapes. Exported for the model sheet. */
export function drawHand(g: G, x: number, y: number, angle: number, shape: HandShape) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  const W = OUT - 1;

  // Flared cuff, behind the hand.
  const cuff = new Path2D();
  cuff.moveTo(-2, -14);
  cuff.lineTo(-24, -20);
  cuff.quadraticCurveTo(-31, 0, -24, 20);
  cuff.lineTo(-2, 14);
  cuff.closePath();
  inkUnion(g, cuff, W);
  taperQ(g, -9, -15, -11, 0, -9, 15, 2.6);

  // The hand is one silhouette: every part is unioned, so only the outer contour is inked.
  const hand = new Path2D();
  const part = (px: number, py: number, len: number, wid: number, rot: number) => {
    const f = new Path2D();
    f.roundRect(0, -wid / 2, len, wid, wid / 2);
    hand.addPath(f, new DOMMatrix().translate(px, py).rotate((rot * 180) / Math.PI));
  };
  const blob = (px: number, py: number, rx: number, ry: number) => {
    const f = new Path2D();
    f.ellipse(px, py, rx, ry, 0, 0, TAU);
    hand.addPath(f);
  };
  const box = (px: number, py: number, bw: number, bh: number, r: number) => {
    const f = new Path2D();
    f.roundRect(px, py, bw, bh, r);
    hand.addPath(f);
  };
  // Thumb drawn on top with its own outline when it crosses the palm.
  let thumbOver: (() => void) | null = null;

  if (shape === 'open') {
    blob(13, 0, 18, 17);
    part(22, -12, 27, 12, -0.4);
    part(25, -1, 29, 12.5, -0.04);
    part(22, 10, 25, 11.5, 0.34);
    part(6, -11, 22, 12, -1.45);
  } else if (shape === 'flat') {
    box(0, -15, 50, 30, 14);
    part(4, -10, 22, 12, -0.62);
  } else {
    box(-2, -18, 32, 36, 13);
    blob(30, 9, 7.5, 7.5);
    blob(31, -1, 7.5, 7.5);
    if (shape === 'point') part(24, -11, 36, 12, -0.03);
    else blob(29, -11, 7.5, 7.5);
    thumbOver = () => {
      const t = new Path2D();
      t.roundRect(0, -6, 27, 12, 6);
      const tt = new Path2D();
      tt.addPath(t, new DOMMatrix().translate(-1, -11).rotate(16));
      inkUnion(g, tt, W - 1);
    };
  }
  inkUnion(g, hand, W);

  // Interior construction: tapered creases instead of overlapping outlines.
  const crease = (x0: number, y0: number, x1: number, y1: number, w = 2.6) => taperQ(g, x0, y0, (x0 + x1) / 2, (y0 + y1) / 2 + 0.6, x1, y1, w);
  if (shape === 'open') {
    crease(28, -7, 40, -11);
    crease(30, 4, 42, 6.5);
    taperQ(g, 4, -4, 12, 4, 6, 11, 2.4); // thumb-base palm crease
  } else if (shape === 'flat') {
    crease(30, -5, 49, -5);
    crease(30, 5, 49, 5);
    crease(8, -3, 18, -5, 2.2);
  } else {
    crease(23, 4, 37, 4);
    if (shape !== 'point') crease(23, -6, 36, -6);
    crease(6, 8, 18, 10, 2.2); // back-of-glove stitch
  }
  thumbOver?.();
  shine(g, 6, -9, 5, 2.4, -0.4, 0.75);
  g.restore();
}

/** Ink a (possibly multi-part) glove path: outline under, fill over, cel shade inside. */
function inkUnion(g: G, path: Path2D, W: number) {
  g.lineJoin = 'round';
  g.lineWidth = W * 2;
  g.strokeStyle = C.ink;
  g.stroke(path);
  g.fillStyle = C.glove;
  g.fill(path);
  g.save();
  g.clip(path);
  g.fillStyle = C.gloveShade;
  g.beginPath();
  g.ellipse(14, 26, 60, 18, 0, 0, TAU);
  g.fill();
  g.restore();
}

function drawMagnifier(g: G, hx: number, hy: number, angle: number) {
  g.save();
  g.translate(hx, hy);
  g.rotate(angle);
  g.beginPath();
  g.roundRect(-7, -66, 14, 78, 6);
  fill(g, '#4a2b18');
  stroke(g, IN + 0.5);
  g.translate(0, -104);
  g.beginPath();
  g.arc(0, 0, 40, 0, TAU);
  g.fillStyle = 'rgba(214, 232, 226, 0.28)';
  g.fill();
  g.lineWidth = 12;
  g.strokeStyle = C.brass;
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 46, 0, TAU);
  stroke(g, IN + 0.5);
  g.beginPath();
  g.arc(0, 0, 34, 0, TAU);
  stroke(g, IN + 0.5);
  g.strokeStyle = 'rgba(255,252,240,0.85)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(0, 0, 25, -2.5, -1.6);
  g.stroke();
  g.restore();
}

function drawPencil(g: G, hx: number, hy: number) {
  g.save();
  g.translate(hx, hy);
  g.rotate(-2.3);
  g.beginPath();
  g.rect(-4, -5, 52, 10);
  fill(g, C.brass);
  stroke(g, IN - 0.5);
  g.beginPath();
  g.moveTo(48, -5);
  g.lineTo(62, 0);
  g.lineTo(48, 5);
  g.closePath();
  fill(g, '#efd9b0');
  stroke(g, 2.5);
  g.restore();
}

function drawNotebook(g: G, x: number, y: number) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.25);
  g.beginPath();
  g.roundRect(-38, -48, 76, 96, 6);
  fill(g, '#6b3420');
  stroke(g, IN + 1);
  g.fillStyle = '#efe4c8';
  g.fillRect(-31, -41, 64, 84);
  g.strokeStyle = 'rgba(60,40,25,0.5)';
  g.lineWidth = 2.5;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.moveTo(-24, -28 + i * 12);
    g.lineTo(24 - (i % 3) * 6, -28 + i * 12);
    g.stroke();
  }
  g.restore();
}

function drawHeldPaper(g: G, x: number, y: number) {
  g.save();
  g.translate(x, y);
  g.rotate(0.06);
  g.beginPath();
  g.rect(-50, -70, 108, 136);
  fill(g, '#efe4c8');
  stroke(g, IN + 1);
  g.fillStyle = 'rgba(40,25,15,0.7)';
  g.fillRect(-36, -56, 66, 8);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = i === 3 ? C.ink : 'rgba(70,50,30,0.45)';
    g.fillRect(-36, -38 + i * 13, 76 - ((i * 17) % 30), 5);
  }
  g.restore();
}

function drawLooseHat(g: G, pose: FoxPose, headBob: number, p: number, T: ArmTarget) {
  // The hat travels from the head to the hand at the chest, in an arc.
  const q = easeOut(clamp(p));
  const headX = FOX_HEAD.x;
  const headY = FOX_HEAD.y + headBob - (pose.hatLift ?? 0);
  const handX = T.hx + 30;
  const handY = T.hy + 70;
  g.save();
  g.translate(lerp(headX, handX, q), lerp(headY, handY, q) - Math.sin(q * Math.PI) * 60);
  g.rotate(lerp(0, -0.7, q));
  g.scale(HEAD_SCALE, HEAD_SCALE);
  drawHat(g, 0, 0, -0.05);
  g.restore();
  if (q > 0.6) drawHand(g, T.hx, T.hy, -0.4, 'fist');
}



/** A glove in the current style (used by the model sheet). */
export function drawGlove(g: G, x: number, y: number, angle: number, shape: HandShape) {
  if (getFoxStyle() === 'painted') anchored(g, 'hand_' + (shape === 'open' ? 'open' : shape), x - 40, y, angle, 0.3);
  else drawHand(g, x, y, angle, shape);
}

// ================================================================== model-sheet puppet
//
// The painted look: the drawings from the Agent Fox model sheet, used as they
// were drawn. FoxPose picks the drawing (key pose), the expression head, the
// mouth (lip-sync) and blinks; bounce, squash, lean, jumps, head bob and tilt
// are applied on top as in classic limited animation.

// ------------------------------------------------------------------ painted cut-out rig
//
// Rig units in here: RIG px (the baked sprites' space; the reference pose in
// px times RIG.K). The vector rig's units are converted with toRig().

const RK = RIG.K;
const RO = RIG.origin;
const J = RIG.joints;

const VISEME_MOUTH: Record<MouthShape, MouthId> = {
  closed: 3,
  mbp: 4,
  mid: 9,
  open: 1,
  wide: 2,
  o: 8,
  u: 7,
  fv: 5,
  l: 10,
  smile: 11,
  grin: 2,
  frown: 12,
};



/** Hand targets for the painted rig, in reference px (the rig pose drawing), per arm mode. */
// Physical arms in the 3/4 view (facing right): the NEAR arm is on the left of the
// picture, drawn in front of the coat with the lighter sleeve; the FAR arm is on the
// right, normally behind the coat, darker. Gestures that happen in front of the face or
// chest are done by the near arm; reaching out to the right (point, lens, wave) by the far arm.
type Phys = 'near' | 'far';
interface ArmDef {
  t: V2;
  hand: string;
  rot?: number;
  flip?: boolean;
  layer: Layer;
}
const NEAR_MODES: ArmMode[] = ['chin', 'hatChest', 'hold', 'scratch'];
const FAR_T: Partial<Record<ArmMode, ArmDef>> = {
  rest: { t: [604, 350], hand: 'relaxed', layer: 'behind' },
  point: { t: [0, 0], hand: 'point', layer: 'behind' },
  magnify: { t: [646, 246], hand: 'fist', rot: -0.55, layer: 'over' },
  wave: { t: [656, 74], hand: 'wave', rot: -0.2, layer: 'behind' },
  shield: { t: [640, 124], hand: 'flat', rot: -1.5, layer: 'over' },
  hips: { t: [604, 322], hand: 'fist', rot: 2.6, layer: 'behind' },
  tiphat: { t: [612, 118], hand: 'fist', rot: -1.2, layer: 'over' },
  pencil: { t: [566, 276], hand: 'fist', rot: -2.3, layer: 'front' },
  notebook: { t: [604, 350], hand: 'relaxed', layer: 'behind' },
};
const NEAR_T: Partial<Record<ArmMode, ArmDef>> = {
  rest: { t: [452, 354], hand: 'relaxed', flip: true, layer: 'front' },
  notebook: { t: [500, 296], hand: 'fist', rot: -0.6, layer: 'front' },
  hips: { t: [452, 325], hand: 'fist', rot: 0.5, flip: true, layer: 'front' },
  chin: { t: [574, 228], hand: 'fist', rot: -1.9, layer: 'over' },
  hatChest: { t: [540, 300], hand: 'fist', rot: -0.4, layer: 'front' },
  hold: { t: [512, 300], hand: 'fist', rot: -0.3, layer: 'front' },
  scratch: { t: [500, 64], hand: 'open', rot: -2.4, layer: 'over' },
};
const SHOULDER: Record<Phys, V2> = { near: J.shoulderBack, far: J.shoulderFront };
const SLEEVE: Record<Phys, string> = { near: 'sleeve_front', far: 'sleeve_back' };
const GLOVE_SUFFIX: Record<Phys, string> = { near: '', far: '_back' };
const CAP: Record<Phys, string> = { near: 'cap_back', far: 'cap_front' };

// Body bend, set per frame: the drawing of the torso bends along the spine.
const BELT_Y = 1076; // rig px
const TORSO_TOP = 613;
const HEM_Y = 1465;
const spine = { top: 0, hem: 0 };
function spineDX(y: number): number {
  if (y < BELT_Y) return spine.top * Math.pow(Math.max(0, Math.min(1, (BELT_Y - y) / (BELT_Y - TORSO_TOP))), 1.6);
  return spine.hem * Math.pow(Math.max(0, Math.min(1, (y - BELT_Y) / (HEM_Y - BELT_Y))), 2);
}

interface RigArm {
  phys: Phys;
  hand: V2;
  handName: string;
  handRot: number | null;
  flip: boolean;
  layer: Layer;
  prop: ArmMode;
}

/** Split the choreography (front/back arm modes) onto the near and far arms. */
function physStates(arms: { front: ArmState; back: ArmState }): Record<Phys, ArmState> {
  const f = arms.front;
  const bk = arms.back;
  const nf = NEAR_MODES.includes(f.from);
  const nt = NEAR_MODES.includes(f.to);
  const far: ArmState = { from: nf ? 'rest' : f.from, to: nt ? 'rest' : f.to, b: f.b, hatChest: 0 };
  const near: ArmState = nf || nt ? { from: nf ? f.from : bk.to, to: nt ? f.to : bk.to, b: f.b, hatChest: 0 } : { ...bk, hatChest: 0 };
  return { far, near };
}

function armDef(phys: Phys, mode: ArmMode): ArmDef {
  const T = phys === 'far' ? FAR_T : NEAR_T;
  return T[mode] ?? T.rest!;
}

function rigArm(st: ArmState, phys: Phys, pose: FoxPose): RigArm {
  const t = pose.time;
  const walk = clamp(pose.walk ?? 0);
  const phase = pose.walkPhase ?? t * TAU * 1.6;
  const target = (mode: ArmMode): V2 => {
    const D = armDef(phys, mode);
    if (mode === 'point' && phys === 'far') {
      const a = pose.pointAngle ?? -0.35;
      const S = SHOULDER.far;
      return [S[0] + Math.cos(a) * 128 * RK, S[1] + Math.sin(a) * 128 * RK + Math.sin(t * 6) * 6];
    }
    let p: V2 = [D.t[0] * RK, D.t[1] * RK];
    if (mode === 'rest' || (phys === 'far' && mode === 'notebook')) {
      // Arms swing opposite to the legs while walking, sway a little on the beat otherwise.
      const swing = Math.sin(phase + (phys === 'far' ? 0 : Math.PI)) * 34 * walk + Math.sin((t * Math.PI) / BEAT) * 3 * (1 - walk);
      // Overlapping action: hanging hands lag the body's bounce and follow its bend.
      const bounce = (pose.bounce ?? 1) * (1 - walk);
      const lagY = (beatLift(t) - beatLift(t - 0.12)) * 12 * bounce;
      p = [p[0] + swing * RK + spineDX(p[1]) * 0.7, p[1] - Math.abs(swing) * 0.25 * RK + lagY * RK];
    }
    if (mode === 'magnify') p = [p[0] + Math.sin(t * 1.9) * 18, p[1] + Math.cos(t * 1.4) * 14];
    if (mode === 'pencil') p = [p[0] + Math.sin(t * 10) * 10, p[1] + Math.cos(t * 8) * 6];
    if (mode === 'chin') p = [p[0] + Math.sin(t * 5) * 4, p[1]];
    if (mode === 'scratch') p = [p[0], p[1] + Math.sin(t * 22) * 14];
    if (mode === 'wave') p = [p[0] + Math.sin(t * 9) * 40, p[1]];
    return p;
  };
  const A = target(st.from);
  const B = target(st.to);
  const b = st.b;
  const mode = b >= 0.5 ? st.to : st.from;
  const D = armDef(phys, mode);
  return {
    phys,
    hand: [lerp(A[0], B[0], b), lerp(A[1], B[1], b)],
    handName: D.hand,
    handRot: D.rot ?? null,
    flip: !!D.flip,
    layer: D.layer,
    prop: mode,
  };
}

/** Where the glove goes and how it turns, for an arm drawn as a rubber hose.
 *  The elbow always bows down and outward, like a real arm. */
function hoseHand(A: RigArm) {
  const S0 = SHOULDER[A.phys];
  const S: V2 = [S0[0] + spineDX(S0[1]), S0[1]];
  const L = rigPart(SLEEVE[A.phys]).len!;
  const dx = A.hand[0] - S[0];
  const dy = A.hand[1] - S[1];
  const d = Math.hypot(dx, dy) || 1;
  const out = A.phys === 'far' ? 1 : -1;
  const side = (-dy / d) * out * 0.6 + (dx / d) * 1 >= 0 ? 1 : -1;
  const { c } = hoseControl(S, A.hand, L, side);
  const ang = Math.atan2(A.hand[1] - c[1], A.hand[0] - c[0]);
  const hx = A.hand[0] + Math.cos(ang) * 10;
  const hy = A.hand[1] + Math.sin(ang) * 10;
  return { S, c, ang, hx, hy, rot: A.handRot ?? ang };
}

function drawGloveRig(g: G, A: RigArm, alpha = 1) {
  const h = hoseHand(A);
  if (alpha < 1) g.globalAlpha = alpha;
  anchored(g, `hand_${A.handName}${GLOVE_SUFFIX[A.phys]}`, h.hx, h.hy, h.rot, 1, A.flip);
  if (alpha < 1) g.globalAlpha = 1;
}

/** A rubber-hose arm: one continuous sleeve from the shoulder to the glove, plus held props. */
function drawRigArm(g: G, A: RigArm) {
  const h = hoseHand(A);
  const gx = h.hx + Math.cos(h.rot) * 70;
  const gy = h.hy + Math.sin(h.rot) * 70;
  if (A.prop === 'magnify' && A.phys === 'far') anchored(g, 'prop_magnifier', gx, gy, 0.15);
  if (A.prop === 'pencil' && A.phys === 'far') anchored(g, 'prop_pencil', gx, gy, -0.9);
  if (A.prop === 'hold' && A.phys === 'near') drawHeldPaper(g, h.hx + 60, h.hy - 120);
  drawGloveRig(g, A);
  noodle(g, SLEEVE[A.phys], h.S, h.c, A.hand);
  if (A.phys === 'far' && A.layer !== 'behind') placed(g, CAP.far);
  if (A.prop === 'notebook' && A.phys === 'near') anchored(g, 'prop_notebook', h.hx + 95, h.hy - 75, -0.12);
}

/** Old-cartoon "multiples": ghost gloves trailing a fast change of pose. */
function drawMultiples(g: G, st: ArmState, phys: Phys, pose: FoxPose) {
  if (st.from === st.to || st.b <= 0.05 || st.b >= 0.9) return;
  for (const [lag, al] of [[0.22, 0.18], [0.11, 0.32]] as const) drawGloveRig(g, rigArm({ ...st, b: Math.max(0, st.b - lag) }, phys, pose), al);
}

/** Rig px the hat sits above its baked place (master look: brows clear of the brim). */
const HAT_RAISE = 34;

function drawFoxSheetRig(g: G, pose: FoxPose): void {
  const time = pose.time;
  const facing = pose.facing ?? 1;
  const walk = clamp(pose.walk ?? 0);
  const phase = pose.walkPhase ?? time * TAU * 1.6;
  const surprise = clamp(pose.surprise ?? 0);
  const bounceAmt = (pose.bounce ?? 1) * (1 - walk);
  const lift = beatLift(time);
  const landing = Math.pow(1 - lift, 6);
  const walkBob = Math.abs(Math.cos(phase)) * 12 * walk;
  const bob = -(lift * 12 * bounceAmt + walkBob) + landing * 4 * bounceAmt - surprise * 8;
  const squash = (pose.squash ?? 0) + landing * 0.045 * bounceAmt - lift * 0.02 * bounceAmt - surprise * 0.05 - Math.sin(time * 1.9) * 0.006 * (1 - walk);
  const lean = (pose.lean ?? 0) * 0.7 + walk * 0.05;
  const jump = pose.jump ?? 0;
  const headLag = -(beatLift(time - 0.08) * 6 * bounceAmt + Math.abs(Math.sin(phase - 0.4)) * 10 * walk) - surprise * 10;

  // Expression.
  const speaking = !!pose.speaking && !pose.mouth;
  let shape: MouthShape = pose.mouth ?? 'closed';
  if (speaking) shape = pose.viseme ?? speakingMouth(time);
  if (surprise > 0.5) shape = 'o';
  const worry = pose.worry ?? 0;
  const angry = pose.angry ?? 0;
  const skeptic = pose.skeptic ?? 0;
  const happy = pose.eyes === 'happy';
  const seg = Math.floor(time / 0.9);
  const sx = (hash(seg * 3.1 + 1) - 0.5) * 0.3;
  const sy = (hash(seg * 5.7 + 2) - 0.5) * 0.2;
  const prevX = (hash((seg - 1) * 3.1 + 1) - 0.5) * 0.3;
  const prevY = (hash((seg - 1) * 5.7 + 2) - 0.5) * 0.2;
  const dart = Math.min(1, (time - seg * 0.9) / 0.06);
  const blink = blinkAmount(time);
  const lids = clamp(pose.lids ?? 0) * 0.7;
  const baseLid = 0.04 + angry * 0.22 + worry * 0.1 - surprise * 0.2;
  const face: Face = {
    lookX: clamp((pose.lookX ?? 0.3) + lerp(prevX, sx, dart) * (1 - surprise), -1, 1),
    lookY: clamp((pose.lookY ?? 0) + lerp(prevY, sy, dart) * (1 - surprise), -1, 1),
    lid: [Math.max(blink, clamp(baseLid + lids + skeptic * 0.35)), Math.max(blink, clamp(baseLid + lids - skeptic * 0.05))],
    lidTilt: angry * 0.6 - worry * 0.55,
    squint: angry * 0.22 + skeptic * 0.18,
    happy,
    wink: !!pose.wink,
    eyeScale: 1 + surprise * 0.12,
    pupil: 1 - surprise * 0.25,
    brows: { raise: (pose.brows ?? 0) + surprise * 1.2, worry, angry, skeptic },
    mouth: happy && !speaking ? 11 : VISEME_MOUTH[shape],
  };

  // Head motion: beat lag, talking nods, idle sway, mood, gaze.
  const talkNod = speaking ? Math.sin(time * 6.3) * 0.025 + Math.sin(time * 2.7) * 0.018 : 0;
  const idle = (Math.sin(time * 1.1) * 0.02 + Math.sin(time * 0.53 + 1) * 0.012) * (1 - walk);
  const headRot = (pose.headTilt ?? 0) + clamp(pose.lookY ?? 0, -1, 1) * 0.05 + talkNod + idle - surprise * 0.06 + angry * 0.03 + beatLift(time - 0.08) * 0.03 * bounceAmt;

  // Arms.
  const arms = resolveArms(pose);
  const ps = physStates(arms);
  const far = rigArm(ps.far, 'far', pose);
  const near = rigArm(ps.near, 'near', pose);
  const hatOff = arms.front.hatChest;

  // Tail and legs.
  const tailRot = Math.sin(time * 2.4) * 0.08 + Math.sin(time * 5.1) * 0.02 + Math.sin(phase) * 0.1 * walk - surprise * 0.2 + Math.sin(time * 18) * 0.04 * surprise;

  g.save();
  g.translate(pose.x, pose.y);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (!pose.noShadow) {
    g.save();
    g.scale(pose.scale, pose.scale);
    const k = 1 / (1 + jump / 160 + lift * 0.08 * bounceAmt);
    g.fillStyle = 'rgba(10, 5, 2, 0.4)';
    ellipse(g, 0, 4, 112 * k, 16 * k);
    g.fill();
    g.restore();
  }
  g.scale(pose.scale * facing, pose.scale);
  drawSpeedLines(g, pose.speedLines ?? 0, time);
  drawSkid(g, pose.skid ?? 0, time);
  drawFootDust(g, walk, phase);
  g.translate(0, -jump);
  g.rotate(lean);
  g.scale(1 + squash * 0.8, 1 - squash);
  // From here on: rig px.
  g.scale(1 / RK, 1 / RK);
  g.translate(-RO[0], -RO[1]);

  // Rubber-hose legs: hips ride the body, feet stay planted (or step), knees bow forward.
  const B = bob * RK;
  const stride = 30 * RK * walk;
  const leg = (name: 'near' | 'far', ph: number) => {
    const hip0 = name === 'near' ? J.hipNear : J.hipFar;
    const L = rigPart(`leg_${name}`).len!;
    const hip: V2 = [hip0[0], hip0[1] + B];
    const liftAmt = Math.max(0, Math.cos(ph)) * walk;
    const ankle: V2 = [hip0[0] + Math.sin(ph) * stride, hip0[1] + L - liftAmt * 26 * RK];
    const { c } = hoseControl(hip, ankle, L, -1);
    // Shoe first: the trouser hem falls over the top of the shoe instead of the shoe sitting on it.
    anchored(g, `shoe_${name}`, ankle[0], ankle[1], -liftAmt * 0.35 + (walk ? Math.sin(ph) * 0.08 : 0));
    noodle(g, `leg_${name}`, hip, c, ankle);
  };
  // Spine: idle sway, talking emphasis, recoil on a take, lean toward a reach; the coat hem trails.
  const reach = ['point', 'magnify', 'wave'].includes(far.prop) ? 1 : 0;
  spine.top = (Math.sin(time * 1.1) * 9 + Math.sin(time * 0.47 + 2) * 5) * (1 - walk) + (speaking ? Math.sin(time * 3.3) * 7 : 0) - surprise * 34 + reach * 16 + walk * 10;
  spine.hem = Math.sin(phase - 0.7) * 18 * walk + (beatLift(time - 0.12) - 0.5) * 8 * bounceAmt - (pose.lean ?? 0) * 60;
  g.save();
  g.translate(0, B);
  // Tail: a travelling wave from the base to the tip (the drawing bends, it doesn't just pivot).
  const wagAmp = 46 + walk * 30 + surprise * 50;
  anchoredWarp(g, 'tail', J.tailBase[0], J.tailBase[1], tailRot * 0.35, (v) => {
    const d = Math.max(0, Math.min(1, -v / 470));
    return wagAmp * Math.sin(time * 2.6 - d * 2.4) * Math.pow(d, 1.4) + Math.sin(time * 18) * 14 * surprise * d;
  }, 3);
  if (near.layer === 'behind') drawRigArm(g, near);
  g.restore();
  leg('far', phase + Math.PI);
  leg('near', phase);
  g.save();
  g.translate(0, B);
  if (far.layer === 'behind') {
    drawMultiples(g, ps.far, 'far', pose);
    drawRigArm(g, far);
  }
  placedWarp(g, 'neck', spineDX);
  placedWarp(g, 'torso', spineDX, 3);
  if (near.layer === 'front') {
    drawMultiples(g, ps.near, 'near', pose);
    drawRigArm(g, near);
  }
  if (far.layer === 'front') {
    drawMultiples(g, ps.far, 'far', pose);
    drawRigArm(g, far);
  }

  // Head (with hat), turning on the neck.
  const N = RIG.neckPivot;
  g.save();
  g.translate(N[0] + spineDX(N[1]), N[1] + headLag * RK * 0.4);
  g.rotate(headRot - spine.top * 0.0012);
  // Squash & stretch of the head: squashes on the landing of each bounce, stretches on a take.
  const hsq = landing * 0.035 * bounceAmt - lift * 0.015 * bounceAmt - surprise * 0.06;
  g.scale(1 + hsq * 0.7, 1 - hsq);
  g.translate(-N[0], -N[1]);
  placed(g, 'head');
  drawRigFace(g, face);
  const hatLift = (pose.hatLift ?? 0) * RK * 1.6 + surprise * 70;
  if (hatOff <= 0) {
    const hp = rigPart('hat');
    g.save();
    const pivot: V2 = [hp.x + hp.w * 0.5, hp.y + hp.h * 0.85];
    // Follow-through: the hat lags the head's bounce a little and settles.
    const hatLag = (beatLift(time - 0.16) - beatLift(time - 0.08)) * 14 * bounceAmt * RK;
    // Master look: the hat sits a little higher, leaving fur between the brows and the brim.
    g.translate(pivot[0], pivot[1] - hatLift + hatLag - HAT_RAISE);
    g.rotate(-0.1 * clamp(hatLift / 60) - surprise * 0.08 + (beatLift(time - 0.2) - 0.5) * 0.025 * bounceAmt);
    g.translate(-pivot[0], -pivot[1]);
    placed(g, 'hat');
    g.restore();
  }
  // Master look: the far ear stands in front of the hat brim, the brows are never hidden by it.
  if (RIG.parts.ear_over) placed(g, 'ear_over');
  drawFaceBrows(g, face);
  // Sweat drop.
  const sweat = clamp(pose.sweat ?? 0);
  if (sweat > 0) {
    const e = RIG.eyes.near.white;
    const x = e[0] - 150;
    const y = e[1] - 40 + ((time * 0.8) % 1) * 120;
    g.save();
    g.globalAlpha = sweat;
    g.beginPath();
    g.moveTo(x, y - 40);
    g.quadraticCurveTo(x + 24, y, x + 16, y + 10);
    g.quadraticCurveTo(x - 4, y + 24, x - 18, y + 4);
    g.quadraticCurveTo(x - 18, y - 12, x, y - 40);
    fill(g, '#cfe7f2');
    stroke(g, 5);
    g.restore();
  }
  g.restore();

  if (far.layer === 'over') {
    drawMultiples(g, ps.far, 'far', pose);
    drawRigArm(g, far);
  }
  if (near.layer === 'over') {
    drawMultiples(g, ps.near, 'near', pose);
    drawRigArm(g, near);
  }
  if (hatOff > 0) {
    // The hat travels from the head to the hand at the chest.
    const q = easeOut(clamp(hatOff));
    const hp = rigPart('hat');
    const from: V2 = [hp.x + hp.w / 2, hp.y + hp.h / 2];
    const to: V2 = [near.hand[0] + 30, near.hand[1] + 40];
    g.save();
    g.translate(lerp(from[0], to[0], q), lerp(from[1], to[1], q) - Math.sin(q * Math.PI) * 140);
    g.rotate(lerp(0, -0.6, q));
    g.translate(-from[0], -from[1]);
    placed(g, 'hat');
    g.restore();
    if (q > 0.6) anchored(g, 'hand_fist', near.hand[0], near.hand[1], -0.4);
  }
  g.restore();
  g.restore();

  // Pops (!, ?) above the hat.
  g.save();
  g.translate(pose.x, pose.y);
  g.scale(pose.scale * facing, pose.scale);
  g.translate(0, -jump);
  drawPop(g, pose, headLag);
  g.restore();
}
