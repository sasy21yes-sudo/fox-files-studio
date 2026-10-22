import { clamp, easeIn, easeInOut, easeOut, easeOutBack, easeOutBounce, lerp } from '../animation/math';
import type { Ease, Key, Num, Track } from './spec';

/** Resolve a per-format number. */
export const num = (n: Num | undefined, vertical: boolean, fallback = 0): number =>
  n === undefined ? fallback : typeof n === 'number' ? n : vertical ? n.v : n.h;

export function ease(e: Ease | undefined, p: number): number {
  switch (e ?? 'smooth') {
    case 'linear':
      return p;
    case 'smooth':
      return p * p * (3 - 2 * p);
    case 'in':
      return easeIn(p);
    case 'out':
      return easeOut(p);
    case 'inOut':
      return easeInOut(p);
    case 'back':
      return easeOutBack(p);
    case 'bounce':
      return easeOutBounce(p);
  }
}

export interface TrackDefaults {
  dur: number;
  ease: Ease;
}

/** Index of the last key at or before `k` (0 when `k` is before every key). */
function current<T>(keys: Key<T>[], k: number): number {
  let i = 0;
  for (let j = 0; j < keys.length; j++) if (k >= keys[j].at) i = j;
  return i;
}

/**
 * Keyed scalar, same rule as animation/scenes/helpers.ts `track()`: hold the
 * previous key's value until `at`, then move to this key's value over `dur`.
 */
export function evalNum(t: Track<number> | Key<Num>[] | undefined, k: number, vertical: boolean, d: TrackDefaults = { dur: 0.4, ease: 'smooth' }, fallback = 0): number {
  if (t === undefined) return fallback;
  if (typeof t === 'number') return t;
  const keys = t as Key<Num>[];
  if (!keys.length) return fallback;
  const i = current(keys, k);
  const to = num(keys[i].value, vertical);
  if (i === 0) return to;
  const from = num(keys[i - 1].value, vertical);
  const dur = keys[i].dur ?? d.dur;
  if (dur <= 0) return to;
  return lerp(from, to, ease(keys[i].ease ?? d.ease, clamp((k - keys[i].at) / dur)));
}

/** Discrete value: the last key at or before `k`. */
export function evalStep<T>(keys: Key<T>[] | undefined, k: number, fallback: T): T {
  if (!keys?.length || k < keys[0].at) return fallback;
  return keys[current(keys, k)].value;
}

/** Discrete value with a blend from the previous one (for arm poses, like `armTrack()`). */
export function evalBlend<T>(keys: Key<T>[] | undefined, k: number, fallback: T, d: TrackDefaults = { dur: 0.38, ease: 'back' }): { from: T; to: T; p: number } {
  if (!keys?.length) return { from: fallback, to: fallback, p: 1 };
  const i = current(keys, k);
  const to = keys[i].value;
  if (i === 0) return { from: to, to, p: 1 };
  const dur = keys[i].dur ?? d.dur;
  return { from: keys[i - 1].value, to, p: dur <= 0 ? 1 : ease(keys[i].ease ?? d.ease, clamp((k - keys[i].at) / dur)) };
}
