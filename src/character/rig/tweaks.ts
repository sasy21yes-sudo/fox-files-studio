import saved from './tweaks.json';

/**
 * Hand-tuned rig values, edited live in the model sheet's "Tune" panel and saved to tweaks.json
 * (dev server). Everything has a default here; tweaks.json only holds what was changed.
 */
export interface ArmTweak {
  /** Hand target in reference px (as FAR_T / NEAR_T in AgentFox.ts). */
  t?: [number, number];
  rot?: number | null;
  hand?: string;
  layer?: 'behind' | 'front' | 'over';
  flip?: boolean;
  /** Glove (Hands tab): mirror ('auto' = the thumb rule), size factor, attach point in sprite px, extra turn (rad). */
  mirror?: 'auto' | 'yes' | 'no';
  handScale?: number;
  anchor?: [number, number];
  handTurn?: number;
}

export const MOTION_DEFAULTS = {
  /** Hop on the music beat (0 = still). */
  bounce: 1,
  /** Walk: stride length and how much the arms swing. */
  walkStride: 36,
  armSwing: 34,
  /** Tail wag amplitude and speed. */
  tailWag: 46,
  tailSpeed: 2.6,
  /** Idle head sway and the nod while talking. */
  headSway: 1,
  talkNod: 1,
  /** Body sway (spine) while idle and talking. */
  spineSway: 1,
  /** Seconds between blinks, and how long a blink lasts. */
  blinkPeriod: 3.2,
  blinkLength: 0.16,
};

export const FACE_DEFAULTS = {
  /** How far the brows lift with "raise" / surprise. */
  browRaise: 0.12,
  /** Inner end of the brows: down when angry, up when worried. */
  browAngry: 0.32,
  browWorry: 0.18,
  /** Skeptic: one brow up, the other down. */
  browSkeptic: 0.16,
  /** Upper lid slant for angry/worried, and how much a squint lifts the lower lid. */
  lidTilt: 0.22,
  squint: 0.45,
  /** Pupil size and eye size multipliers. */
  pupil: 1,
  eyeScale: 1,
};

/** A shoe (Shoes tab): attach point [along the foot, up/down] in sprite px, size factor, extra turn (rad). */
export interface ShoeTweak {
  anchor?: [number, number];
  shoeScale?: number;
  shoeTurn?: number;
}

export interface RigTweaks {
  arms: { near: Record<string, ArmTweak>; far: Record<string, ArmTweak> };
  /** Per leg; missing in older tweaks.json files. */
  legs?: { near?: ShoeTweak; far?: ShoeTweak };
  motion: Partial<typeof MOTION_DEFAULTS>;
  face: Partial<typeof FACE_DEFAULTS>;
}

// (JSON infers mirror as string and anchor as number[]: the editor only writes valid values)
let current: RigTweaks = structuredClone(saved as unknown as RigTweaks);
const listeners = new Set<() => void>();

export const tweaks = () => current;
export const motion = <K extends keyof typeof MOTION_DEFAULTS>(k: K) => current.motion[k] ?? MOTION_DEFAULTS[k];
export const face = <K extends keyof typeof FACE_DEFAULTS>(k: K) => current.face[k] ?? FACE_DEFAULTS[k];

/** Replace the live values (the tuner calls this while you drag; nothing is saved until Save). */
export function setTweaks(t: RigTweaks) {
  current = t;
  listeners.forEach((f) => f());
}
export function onTweaks(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}
