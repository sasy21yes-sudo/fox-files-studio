import type { Timeline } from '../animation/timeline';
import { rng } from '../animation/math';
import { placeBeats } from '../effects/beats';

/**
 * Cartoon sound effects for data scenes (SceneSpec.sfx): typewriter keys, a stamp, a slide whistle...
 * Synthesised sample by sample like the score (audio/ambience.ts) — nothing downloaded or licensed,
 * deterministic: the same timeline always gives the same buffer. Each hit varies a little (pitch,
 * level) with its position, so a run of keys never sounds like one sample looped.
 */

export const SFX_SOUNDS = {
  typeKey: 'one typewriter key strike (sharp metal click + platen thock)',
  typeBell: 'the typewriter bell at the end of a line (a bright "ding")',
  typeReturn: 'carriage return: a ratcheting zip ending in a thunk',
  stamp: 'a rubber stamp slammed on paper (thud + slap)',
  paper: 'paper rustle / a sheet sliding in',
  whoosh: 'a fast swish past the camera (whip pans, things flying in)',
  pop: 'a cartoon pop (a pop-up, a cork, something appearing)',
  drum: 'a bass-drum hit (an impact, a reveal)',
  cymbal: 'a crash cymbal (a big reveal, the end of a build)',
  slideUp: 'slide whistle going up (rising, surprise, a jump)',
  slideDown: 'slide whistle going down (a fall, deflation)',
  boing: 'cartoon spring boing (a bounce, a take)',
  tick: 'a clock tick',
  thud: 'a dull heavy landing (a file box, a body hitting the floor)',
  camera: 'an old camera shutter (a photo being taken)',
} as const;
export type SfxSound = keyof typeof SFX_SOUNDS;
export const isSfxSound = (s: unknown): s is SfxSound => typeof s === 'string' && s in SFX_SOUNDS;

/** One cue in a scene: `count` hits `every` seconds apart from `at` (authored seconds, like the rest of the spec). */
export interface SfxCue {
  at: number;
  sound: SfxSound;
  /** Level 0..2 (1 = normal). */
  gain?: number;
  /** Stereo position -1 (left) .. 1 (right). */
  pan?: number;
  count?: number;
  every?: number;
}

const SR = 44100;
const TAU = Math.PI * 2;

type Gen = (r: () => number, v: number) => Float32Array;

const len = (s: number) => new Float32Array(Math.max(1, Math.ceil(s * SR)));

/** Filtered noise with an exponential decay (one-pole low-pass, then high-pass). */
function noise(out: Float32Array, r: () => number, gain: number, decay: number, lp: number, hp: number, at = 0) {
  const a = 1 - Math.exp((-TAU * lp) / SR);
  const b = 1 - Math.exp((-TAU * hp) / SR);
  let y = 0;
  let h = 0;
  for (let i = Math.floor(at * SR); i < out.length; i++) {
    const t = i / SR - at;
    const x = (r() * 2 - 1) * Math.exp(-t / decay);
    y += a * (x - y);
    h += b * (y - h);
    out[i] += (y - h) * gain;
  }
}

/** A decaying sine whose pitch glides exponentially from f0 to f1 over `glide` seconds. */
function tone(out: Float32Array, gain: number, f0: number, f1: number, glide: number, decay: number, at = 0, attack = 0.002) {
  let ph = 0;
  for (let i = Math.floor(at * SR); i < out.length; i++) {
    const t = i / SR - at;
    const f = f0 * Math.pow(f1 / f0, Math.min(1, t / Math.max(1e-4, glide)));
    ph += (TAU * f) / SR;
    out[i] += Math.sin(ph) * gain * Math.min(1, t / attack) * Math.exp(-t / decay);
  }
}

const GEN: Record<SfxSound, Gen> = {
  typeKey: (r, v) => {
    const o = len(0.09);
    noise(o, r, 0.9, 0.004, 9000, 1800); // the type bar hitting
    tone(o, 0.45, 190 * v, 150 * v, 0.03, 0.022); // the platen thock
    tone(o, 0.12, 2600 * v, 2500 * v, 0.05, 0.018, 0.001); // a metal ping
    noise(o, r, 0.25, 0.012, 2500, 300, 0.012); // the key returning
    return o;
  },
  typeBell: (_r, v) => {
    const o = len(0.9);
    for (const [k, g] of [[1, 0.5], [2.76, 0.22], [5.4, 0.1], [8.9, 0.05]] as const) tone(o, g, 2050 * v * k, 2050 * v * k, 1, 0.45 / Math.sqrt(k));
    return o;
  },
  typeReturn: (r, v) => {
    const o = len(0.5);
    // Ratchet clicks speeding up, then the carriage stop.
    let t = 0;
    for (let i = 0; i < 13; i++) {
      noise(o, r, 0.35, 0.003, 7000, 1500, t);
      t += 0.032 - i * 0.0016;
    }
    tone(o, 0.6, 140 * v, 90 * v, 0.06, 0.06, t);
    noise(o, r, 0.6, 0.02, 2200, 120, t);
    return o;
  },
  stamp: (r, v) => {
    const o = len(0.3);
    tone(o, 0.9, 150 * v, 55 * v, 0.09, 0.09);
    noise(o, r, 0.8, 0.035, 1500, 80);
    noise(o, r, 0.25, 0.01, 6000, 1800, 0.004); // the rubber slap
    return o;
  },
  paper: (r) => {
    const o = len(0.45);
    // Grains of band-passed noise, denser in the middle.
    for (let g = 0; g < 22; g++) {
      const t = r() * 0.38;
      noise(o, r, 0.9 * Math.sin((Math.PI * t) / 0.38), 0.012 + r() * 0.02, 6500, 1400, t);
    }
    return o;
  },
  whoosh: (r) => {
    const o = len(0.55);
    let y = 0;
    let h = 0;
    for (let i = 0; i < o.length; i++) {
      const u = i / o.length;
      const lp = 300 + 4200 * Math.sin(Math.PI * u);
      const a = 1 - Math.exp((-TAU * lp) / SR);
      const b = 1 - Math.exp((-TAU * 150) / SR);
      y += a * (r() * 2 - 1 - y);
      h += b * (y - h);
      o[i] = (y - h) * Math.pow(Math.sin(Math.PI * u), 1.5) * 0.9;
    }
    return o;
  },
  pop: (r, v) => {
    const o = len(0.12);
    tone(o, 0.8, 500 * v, 1500 * v, 0.035, 0.04);
    noise(o, r, 0.4, 0.004, 8000, 1000);
    return o;
  },
  drum: (r, v) => {
    const o = len(0.45);
    tone(o, 1, 115 * v, 45 * v, 0.12, 0.2);
    noise(o, r, 0.35, 0.01, 3000, 200);
    return o;
  },
  cymbal: (r, v) => {
    const o = len(1.8);
    noise(o, r, 0.5, 0.7, 14000, 4500);
    for (const k of [1, 1.47, 1.93, 2.69, 3.31]) tone(o, 0.04, 3200 * v * k, 3200 * v * k, 1, 0.5);
    return o;
  },
  slideUp: (r, v) => slide(r, 520 * v, 1750 * v),
  slideDown: (r, v) => slide(r, 1750 * v, 480 * v),
  boing: (_r, v) => {
    const o = len(0.75);
    let ph = 0;
    for (let i = 0; i < o.length; i++) {
      const t = i / SR;
      const f = 230 * v * (1 + 0.35 * Math.exp(-t / 0.18) * Math.sin(TAU * 17 * t)) * (1 - 0.25 * Math.min(1, t / 0.7));
      ph += (TAU * f) / SR;
      o[i] = (Math.sin(ph) + 0.3 * Math.sin(2 * ph)) * 0.55 * Math.min(1, t / 0.004) * Math.exp(-t / 0.28);
    }
    return o;
  },
  tick: (r, v) => {
    const o = len(0.06);
    noise(o, r, 0.6, 0.0025, 9000, 3000);
    tone(o, 0.15, 3600 * v, 3600 * v, 1, 0.008);
    return o;
  },
  thud: (r, v) => {
    const o = len(0.4);
    tone(o, 0.9, 85 * v, 50 * v, 0.1, 0.13);
    noise(o, r, 0.7, 0.07, 350, 40);
    return o;
  },
  camera: (r) => {
    const o = len(0.2);
    noise(o, r, 0.7, 0.004, 9000, 1500);
    noise(o, r, 0.5, 0.006, 6000, 900, 0.07);
    return o;
  },
};

function slide(r: () => number, f0: number, f1: number): Float32Array {
  const o = len(0.6);
  let ph = 0;
  for (let i = 0; i < o.length; i++) {
    const t = i / SR;
    const u = Math.min(1, t / 0.5);
    const f = f0 * Math.pow(f1 / f0, u * u * (3 - 2 * u)) * (1 + 0.012 * Math.sin(TAU * 6 * t));
    ph += (TAU * f) / SR;
    const env = Math.min(1, t / 0.03) * (t > 0.5 ? Math.exp(-(t - 0.5) / 0.03) : 1);
    o[i] = (Math.sin(ph) * 0.5 + (r() * 2 - 1) * 0.03) * env;
  }
  return o;
}

interface Hit {
  t: number;
  sound: SfxSound;
  gain: number;
  pan: number;
  seed: number;
}

/** The sound each kind of pop-up arrives with (none of the 16 pop-ups had one - review, 2026-10-24). */
const POPUP_SOUND: Record<string, SfxSound> = {
  question: 'pop',
  count: 'pop',
  span: 'pop',
  waffle: 'pop',
  list: 'pop',
  versus: 'whoosh',
  statement: 'whoosh',
  define: 'paper',
  record: 'paper',
};
/** Pop-up sounds sit under the voice: a cue for the eye, not a gag. */
const POPUP_GAIN = 0.35;

/** Every hit of every scene's cues and pop-ups, in timeline seconds. */
export function sfxHits(tl: Timeline): Hit[] {
  const hits: Hit[] = [];
  tl.spans.forEach((span) =>
    placeBeats(tl, span.index).forEach((b, j) => {
      const sound = POPUP_SOUND[b.beat.kind];
      if (sound) hits.push({ t: b.start, sound, gain: POPUP_GAIN, pan: 0.15, seed: 900000 + span.index * 100 + j });
    }),
  );
  for (const span of tl.spans) {
    const cues = (span.scene.spec as { sfx?: SfxCue[] } | null | undefined)?.sfx;
    if (!cues?.length) continue;
    const k = span.duration / Math.max(1e-6, span.scene.authoredDuration);
    cues.forEach((c, ci) => {
      if (!isSfxSound(c.sound)) return;
      const n = Math.max(1, Math.min(64, Math.round(c.count ?? 1)));
      for (let j = 0; j < n; j++) {
        const at = c.at + j * (c.every ?? 0.12);
        if (at < 0 || at > span.scene.authoredDuration) continue;
        hits.push({ t: span.start + at * k, sound: c.sound, gain: Math.max(0, Math.min(2, c.gain ?? 1)), pan: Math.max(-1, Math.min(1, c.pan ?? 0)), seed: span.index * 1000 + ci * 64 + j });
      }
    });
  }
  return hits;
}

const cache = new Map<string, AudioBuffer | null>();

/** The effects track for the whole timeline (null when no scene has effects). */
export function renderSfx(tl: Timeline): AudioBuffer | null {
  const hits = sfxHits(tl);
  if (!hits.length || typeof AudioBuffer === 'undefined') return null;
  const key = `${tl.total.toFixed(2)}|${hits.map((h) => `${h.sound}@${h.t.toFixed(3)}*${h.gain}~${h.pan}`).join(',')}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const n = Math.ceil((tl.total + 2) * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (const h of hits) {
    const r = rng(h.seed + 17);
    const v = 1 + (r() - 0.5) * 0.12; // a little pitch variation per hit
    // (bus at 0.4: at 0.7 the scene-1 bell and drum were the loudest moment of the whole mix, over the voice)
    const g = h.gain * (0.85 + r() * 0.3) * 0.4;
    const s = GEN[h.sound](r, v);
    const gl = g * Math.cos(((h.pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const gr = g * Math.sin(((h.pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const n0 = Math.floor(h.t * SR);
    for (let i = 0; i < s.length && n0 + i < n; i++) {
      L[n0 + i] += s[i] * gl;
      R[n0 + i] += s[i] * gr;
    }
  }
  // Soft limit so a pile of hits never clips.
  for (let i = 0; i < n; i++) {
    L[i] = Math.tanh(L[i]);
    R[i] = Math.tanh(R[i]);
  }
  const buf = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: SR });
  buf.copyToChannel(L, 0);
  buf.copyToChannel(R, 1);
  if (cache.size > 8) cache.delete(cache.keys().next().value as string);
  cache.set(key, buf);
  return buf;
}
