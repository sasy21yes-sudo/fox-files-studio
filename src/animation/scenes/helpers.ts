import type { Shot, ShotEnter } from '../camera';
import { framing } from '../camera';
import type { Stage } from '../stage';
import type { Layout } from './layout';
import { clamp, easeOutBack, seg } from '../math';
import { FOX_FRONT_SHOULDER, FOX_HEAD, type ArmMode, type FoxPose } from '../../character/AgentFox';

/** Angle for the fox's pointing arm (facing right) toward a screen point. */
export function pointAt(L: Layout, tx: number, ty: number, foxX = L.foxX, foxY = L.foxY): number {
  const sx = foxX + FOX_FRONT_SHOULDER.x * L.foxS;
  const sy = foxY + FOX_FRONT_SHOULDER.y * L.foxS;
  return clamp(Math.atan2(ty - sy, tx - sx), -1.45, 0.9);
}

/** Pupil direction toward a screen point. */
export function lookAt(L: Layout, tx: number, ty: number, foxX = L.foxX, foxY = L.foxY): { lookX: number; lookY: number } {
  const hx = foxX + (FOX_HEAD.x + 24) * L.foxS;
  const hy = foxY + FOX_HEAD.y * L.foxS;
  const dx = tx - hx;
  const dy = ty - hy;
  const d = Math.hypot(dx, dy) || 1;
  return { lookX: clamp(dx / d), lookY: clamp((dy / d) * 1.3, -1, 1) };
}

/** A short spike that rises quickly at `at` and decays over `len` seconds. */
export const pulse = (k: number, at: number, len: number) => seg(k, at, 0.1) * (1 - seg(k, at + 0.1, len));

/**
 * Keyframed arm poses with a springy blend between them.
 * `keys` is a list of [time, mode]; returns the props for drawFox.
 */
export function armTrack(k: number, keys: [number, ArmMode][], which: 'front' | 'back' = 'front', dur = 0.38): Partial<FoxPose> {
  let i = 0;
  for (let j = 0; j < keys.length; j++) if (k >= keys[j][0]) i = j;
  const to = keys[i][1];
  const from = i > 0 ? keys[i - 1][1] : to;
  const b = i > 0 ? easeOutBack(seg(k, keys[i][0], dur)) : 1;
  return which === 'front' ? { armFront: to, armFrontFrom: from, armFrontBlend: b } : { armBack: to, armBackFrom: from, armBackBlend: b };
}

/** A cartoon symbol pop: [time, symbol] events, each lasting `len` seconds. */
export function popAt(k: number, events: [number, '!' | '?' | '!?'][], len = 1.3): FoxPose['pop'] {
  for (const [t, symbol] of events) {
    if (k >= t && k < t + len) return { symbol, p: (k - t) / len };
  }
  return null;
}

/** Keyframed scalar with smooth easing between values. */
export function track(k: number, keys: [number, number][], dur = 0.4): number {
  let i = 0;
  for (let j = 0; j < keys.length; j++) if (k >= keys[j][0]) i = j;
  if (i === 0) return keys[0][1];
  const p = seg(k, keys[i][0], dur);
  const e = p * p * (3 - 2 * p);
  return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * e;
}

// ------------------------------------------------------------------ shot helpers

/** A shot framed on Agent Fox: 'medium' frames the torso, 'close'/'extreme' the face. */
export function foxShot(
  s: Stage,
  L: Layout,
  at: number,
  kind: 'medium' | 'close' | 'extreme',
  opts: { foxX?: number; sx?: number; sy?: number; enter?: ShotEnter; drift?: number } = {},
): Shot {
  const fx = opts.foxX ?? L.foxX;
  const S = L.foxS;
  const face = kind !== 'medium';
  return {
    at,
    zoom: framing(s, kind),
    ax: fx + (face ? 70 : 40) * S,
    ay: L.foxY - (face ? 400 : 330) * S,
    sx: s.vertical ? 0.5 : opts.sx ?? 0.36,
    sy: s.vertical ? (face ? 0.56 : 0.52) : opts.sy ?? (face ? 0.5 : 0.48),
    enter: opts.enter,
    drift: opts.drift ?? 0.015,
  };
}

export function wideShot(s: Stage, at: number, enter?: ShotEnter, drift = 0.01): Shot {
  return { at, zoom: 1, ax: s.w / 2, ay: s.h / 2, enter, drift };
}

export function insertShot(s: Stage, at: number, x: number, y: number, opts: { zoom?: number; sx?: number; sy?: number; enter?: ShotEnter; drift?: number } = {}): Shot {
  return {
    at,
    zoom: opts.zoom ?? framing(s, 'insert'),
    ax: x,
    ay: y,
    sx: opts.sx ?? 0.5,
    sy: opts.sy ?? 0.5,
    enter: opts.enter,
    drift: opts.drift ?? 0.02,
  };
}
