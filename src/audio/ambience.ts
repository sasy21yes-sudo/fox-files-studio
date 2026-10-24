import type { Timeline } from '../animation/timeline';
import { rng } from '../animation/math';
import { BEAT } from '../character/AgentFox';

/**
 * Original 1930s "hot jazz" score, synthesised offline with Web Audio — written
 * for this project, nothing downloaded or licensed:
 *
 *   - a catchy muted-trumpet hook (8-bar A tune in D minor) that keeps coming back,
 *   - a clarinet blues riff answering it, brass "hits" on the off-beats,
 *   - stride piano (oom-pah), walking upright bass, swung brushes and ride,
 *   - a drum fill + crash + brass stab into every chapter card, a "ta-daa" ending,
 *   - a quiet, drumless chorale under scene 4 (the human cost),
 *   - automatic ducking under every narration line, record crackle on top.
 *
 * It sits on the fox's bounce tempo (BEAT), so the character dances on the beat.
 * Deterministic: the same timeline always produces the same buffer.
 */

export const AMBIENCE_SAMPLE_RATE = 44100;

const cache = new Map<string, Promise<AudioBuffer>>();

export function ambienceKey(tl: Timeline): string {
  return (
    (tl.hook ? `hook${tl.hook.end}|` : '') +
    tl.spans.map((s) => s.duration.toFixed(2)).join('|') +
    '|' +
    tl.cues.map((c) => c.start.toFixed(1)).join(',')
  );
}

export function renderAmbience(tl: Timeline): Promise<AudioBuffer> {
  const key = ambienceKey(tl);
  let p = cache.get(key);
  if (!p) {
    p = synthesize(tl);
    cache.set(key, p);
    if (cache.size > 6) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// ------------------------------------------------------------------ the tune

type Chord = { root: number; minor: boolean; voicing: number[] };
const DM: Chord = { root: 38, minor: true, voicing: [57, 59, 62, 65] }; // Dm6: A B D F
const A7: Chord = { root: 45, minor: false, voicing: [55, 57, 61, 64] }; // A7: G A C# E
const GM: Chord = { root: 43, minor: true, voicing: [55, 58, 62, 64] }; // Gm6: G Bb D E
/** 8-bar loop. */
const PROGRESSION: Chord[] = [DM, A7, DM, A7, DM, GM, A7, DM];

/** The hook: [beat in phrase, length in beats, midi]. Swung eighths sit at .66. */
const MELODY: [number, number, number][] = [
  // bar 1 (Dm)
  [0, 0.66, 69], [0.66, 0.34, 74], [1, 0.66, 77], [1.66, 0.34, 76], [2, 1, 74],
  // bar 2 (A7)
  [4, 0.66, 73], [4.66, 0.34, 76], [5, 0.66, 79], [5.66, 0.34, 77], [6, 1.5, 76], [7.66, 0.34, 69],
  // bar 3 (Dm) — the hook again
  [8, 0.66, 69], [8.66, 0.34, 74], [9, 0.66, 77], [9.66, 0.34, 76], [10, 1, 74],
  // bar 4 (A7) — up the octave answer
  [12, 0.66, 73], [12.66, 0.34, 76], [13, 0.66, 81], [13.66, 0.34, 79], [14, 1.5, 76],
  // bar 5 (Dm) — climb
  [16, 0.66, 77], [16.66, 0.34, 81], [17, 1, 86], [18, 0.66, 84], [18.66, 0.34, 81], [19, 1, 77],
  // bar 6 (Gm)
  [20, 0.66, 79], [20.66, 0.34, 82], [21, 1, 86], [22, 0.66, 82], [22.66, 0.34, 79], [23, 1, 76],
  // bar 7 (A7)
  [24, 1, 73], [25, 0.66, 76], [25.66, 0.34, 79], [26, 1, 77], [27, 1, 76],
  // bar 8 (Dm) — home
  [28, 0.66, 74], [28.66, 0.34, 69], [29, 0.66, 74], [29.66, 0.34, 77], [30, 1.5, 74],
];

/** Clarinet blues riff, relative to the chord root (one bar). */
const RIFF: [number, number, number][] = [
  [0, 0.66, 0], [0.66, 0.34, 3], [1, 0.66, 5], [1.66, 0.34, 6], [2, 0.9, 7], [3.34, 0.32, 3], [3.66, 0.34, 5],
];

// ------------------------------------------------------------------ direct synthesis
//
// Every voice is computed sample by sample into two Float32Arrays (much faster
// than building thousands of Web Audio nodes), then ducked under the narration,
// soft-limited and copied into an AudioBuffer.

const SR = 44100;

interface Mix {
  L: Float32Array;
  R: Float32Array;
}

interface Voice {
  f: number;
  t: number;
  len: number;
  gain: number;
  pan?: number; // -1..1
  saw?: number;
  square?: number;
  tri?: number;
  sine?: number;
  h2?: number; // 2nd harmonic (sine)
  h3?: number;
  attack?: number;
  decay?: number; // time constant of the exponential decay (s); Infinity = sustain
  release?: number;
  lpFrom?: number;
  lpTo?: number;
  hp?: number;
  vibRate?: number;
  vibCents?: number;
  vibDelay?: number;
  scoopCents?: number;
  sweepTo?: number; // pitch sweep target (Hz), exponential over len
}

function voice(mx: Mix, v: Voice) {
  const n0 = Math.max(0, Math.floor(v.t * SR));
  const rel = v.release ?? 0.04;
  const n1 = Math.min(mx.L.length, Math.floor((v.t + v.len + rel) * SR));
  if (n1 <= n0) return;
  const pan = v.pan ?? 0;
  const gl = v.gain * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  const gr = v.gain * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  const att = v.attack ?? 0.005;
  const dec = v.decay ?? Infinity;
  const saw = v.saw ?? 0;
  const sq = v.square ?? 0;
  const tri = v.tri ?? 0;
  const sine = v.sine ?? 0;
  const h2 = v.h2 ?? 0;
  const h3 = v.h3 ?? 0;
  const lpFrom = v.lpFrom ?? 0;
  const lpTo = v.lpTo ?? lpFrom;
  const hpA = v.hp ? 1 - Math.exp((-2 * Math.PI * v.hp) / SR) : 0;
  const vibW = ((v.vibRate ?? 0) * 2 * Math.PI) / SR;
  const vibC = v.vibCents ?? 0;
  const vibD = v.vibDelay ?? 0.15;
  const scoop = v.scoopCents ?? 0;
  let ph = 0;
  let y1 = 0;
  let y2 = 0;
  let hpY = 0;
  for (let n = n0; n < n1; n++) {
    const tt = n / SR - v.t;
    // Pitch: optional sweep, scoop into the note, delayed vibrato.
    let f = v.sweepTo ? v.f * Math.pow(v.sweepTo / v.f, Math.min(1, tt / v.len)) : v.f;
    let cents = 0;
    if (scoop) cents += scoop * Math.max(0, 1 - tt / 0.06);
    if (vibC) cents += vibC * Math.min(1, Math.max(0, (tt - vibD) / 0.2)) * Math.sin(n * vibW);
    if (cents) f *= Math.pow(2, cents / 1200);
    ph += f / SR;
    const p = ph - Math.floor(ph);
    let x = 0;
    if (saw) x += saw * (2 * p - 1);
    if (sq) x += sq * (p < 0.5 ? 1 : -1);
    if (tri) x += tri * (4 * Math.abs(p - 0.5) - 1);
    if (sine) x += sine * Math.sin(2 * Math.PI * p);
    if (h2) x += h2 * Math.sin(4 * Math.PI * p);
    if (h3) x += h3 * Math.sin(6 * Math.PI * p);
    // Envelope.
    let e = tt < att ? tt / att : 1;
    if (dec !== Infinity) e *= Math.exp(-(tt - att > 0 ? tt - att : 0) / dec);
    if (tt > v.len) e *= Math.max(0, 1 - (tt - v.len) / rel);
    x *= e;
    // Two-pole low-pass with a cutoff sweep; optional one-pole high-pass.
    if (lpFrom) {
      const fc = lpFrom + (lpTo - lpFrom) * Math.min(1, tt / Math.max(0.05, v.len));
      const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
      y1 += a * (x - y1);
      y2 += a * (y1 - y2);
      x = y2;
    }
    if (hpA) {
      hpY += hpA * (x - hpY);
      x -= hpY;
    }
    mx.L[n] += x * gl;
    mx.R[n] += x * gr;
  }
}

/** A filtered noise burst, computed once and mixed in many times. */
function noiseSample(seed: number, len: number, decay: number, lp: number, hp: number): Float32Array {
  const out = new Float32Array(Math.ceil(len * SR));
  const r = rng(seed);
  const a = 1 - Math.exp((-2 * Math.PI * lp) / SR);
  const b = 1 - Math.exp((-2 * Math.PI * hp) / SR);
  let y = 0;
  let h = 0;
  for (let i = 0; i < out.length; i++) {
    const x = (r() * 2 - 1) * Math.exp(-i / (SR * decay));
    y += a * (x - y);
    h += b * (y - h);
    out[i] = y - h;
  }
  return out;
}

function addSample(mx: Mix, s: Float32Array, t: number, gain: number, pan = 0) {
  const n0 = Math.floor(t * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  for (let i = 0; i < s.length; i++) {
    const n = n0 + i;
    if (n < 0) continue;
    if (n >= mx.L.length) break;
    mx.L[n] += s[i] * gl;
    mx.R[n] += s[i] * gr;
  }
}

async function synthesize(tl: Timeline): Promise<AudioBuffer> {
  const total = Math.max(1, tl.total + 0.6);
  const N = Math.ceil(total * SR);
  const mx: Mix = { L: new Float32Array(N), R: new Float32Array(N) };
  const beat = BEAT;
  const bar = beat * 4;
  const sceneAt = (t: number) => tl.spans.findIndex((s) => t < s.end);
  const endBand = tl.total - 3.1;

  const brush = noiseSample(3, 0.25, 0.06, 5000, 1200);
  const rideS = noiseSample(5, 0.45, 0.14, 14000, 5500);
  const hatS = noiseSample(7, 0.07, 0.018, 15000, 7000);
  const crashS = noiseSample(9, 2.2, 0.75, 14000, 3500);

  const kick = (t: number, g = 0.5) => voice(mx, { f: 110, sweepTo: 40, t, len: 0.28, gain: g, sine: 1, attack: 0.002, decay: 0.09 });
  const snare = (t: number, g = 0.32) => addSample(mx, brush, t, g, 0.1);
  const ride = (t: number, g = 0.1) => addSample(mx, rideS, t, g, 0.35);
  const hat = (t: number, g = 0.12) => addSample(mx, hatS, t, g, -0.2);
  const crash = (t: number, g = 0.22) => addSample(mx, crashS, t, g, 0.25);
  const bassNote = (m: number, t: number, len: number) =>
    voice(mx, { f: mtof(m), t, len, gain: 0.34, tri: 1, h2: 0.25, attack: 0.006, decay: 0.28, lpFrom: 900, release: 0.05, pan: -0.1 });
  const pianoNote = (m: number, t: number, len: number, vel = 1) =>
    voice(mx, { f: mtof(m), t, len, gain: 0.1 * vel, tri: 1, h2: 0.35, h3: 0.12, attack: 0.003, decay: len * 0.45, lpFrom: 3400, release: 0.08, pan: 0.15 });
  const trumpet = (m: number, t: number, len: number, vel = 1) =>
    voice(mx, {
      f: mtof(m),
      t,
      len,
      gain: 0.13 * vel,
      saw: 0.6,
      square: 0.3,
      attack: 0.025,
      lpFrom: 3000,
      lpTo: 1500,
      hp: 380,
      vibRate: 5.6,
      vibCents: len > 0.4 ? 10 : 0,
      vibDelay: 0.18,
      scoopCents: -45,
      release: 0.05,
      pan: 0.2,
    });
  const clarinet = (m: number, t: number, len: number) =>
    voice(mx, { f: mtof(m), t, len, gain: 0.07, square: 1, attack: 0.03, lpFrom: 2000, vibRate: 6, vibCents: 7, vibDelay: 0.1, release: 0.04, pan: -0.3 });
  const stab = (t: number, chord: Chord, vel = 0.7, len = 0.22) => {
    for (const m of chord.voicing) trumpet(m + 12, t, len, vel * 0.5);
  };

  // ---- Arrangement.
  const t0 = tl.hook ? tl.hook.end : 0;
  const nBars = Math.ceil((endBand - t0) / bar);
  for (let b = 0; b < nBars; b++) {
    const barStart = t0 + b * bar;
    if (barStart > endBand) break;
    const sIdx = sceneAt(barStart + 0.01);
    const span = tl.spans[Math.max(0, sIdx)];
    const chord = PROGRESSION[b % 8];
    const next = PROGRESSION[(b + 1) % 8];
    const phrase = Math.floor(b / 8);
    const inCard = (t: number) => t >= span.start && t < span.start + 1.4;

    if (sIdx === 3) {
      // Scene 4, the human cost: no drums, a quiet chorale.
      for (const m of chord.voicing) pianoNote(m, barStart, bar * 1.1, 0.75);
      bassNote(chord.root, barStart, bar * 0.95);
      if (b % 2 === 0) trumpet(chord.voicing[3] + 12, barStart + beat, bar * 1.6, 0.35);
      continue;
    }
    for (let i = 0; i < 4; i++) {
      const t = barStart + i * beat;
      if (t > endBand) break;
      const third = chord.minor ? 3 : 4;
      const walk = [chord.root, chord.root + third, chord.root + 7, next.root + (next.root > chord.root ? -1 : 1)];
      bassNote(walk[i], t, beat * 0.92);
      if (i % 2 === 0) pianoNote(chord.root + 12, t, beat * 0.9, 0.9);
      else for (const m of chord.voicing) pianoNote(m, t, beat * 0.55, 0.55);
      if (i % 2 === 0) kick(t, sIdx === 4 ? 0.55 : 0.45);
      if (i % 2 === 1) {
        snare(t);
        hat(t);
      }
      ride(t, 0.09);
      ride(t + beat * 0.66, 0.06);
    }
    if (phrase % 2 === 0 || sIdx === 0) {
      const pb = (b % 8) * 4;
      for (const [nb, len, m] of MELODY) {
        if (nb < pb || nb >= pb + 4) continue;
        const t = barStart + (nb - pb) * beat;
        if (t > endBand || inCard(t)) continue;
        trumpet(m, t, len * beat * 0.95, 0.9);
      }
    } else {
      for (const [nb, len, iv] of RIFF) {
        const t = barStart + nb * beat;
        if (t > endBand || inCard(t)) continue;
        clarinet(chord.root + 24 + iv, t, len * beat * 0.9);
      }
      if (b % 2 === 1) {
        stab(barStart + beat * 1.66, chord, 0.6, 0.16);
        stab(barStart + beat * 3, chord, 0.7, 0.2);
      }
    }
  }

  // ---- Into every chapter card: drum fill, crash + brass stab on the cut.
  tl.spans.forEach((s, i) => {
    if (i === 0 && !tl.hook) return;
    const t = s.start;
    if (i !== 3) for (let k = 0; k < 6; k++) snare(t - beat + (k * beat) / 6, 0.12 + k * 0.04);
    crash(t, i === 3 ? 0.12 : 0.24);
    kick(t, 0.6);
    stab(t, i === 3 ? GM : DM, i === 3 ? 0.4 : 0.85, 0.5);
  });

  // ---- Ending: snare roll, then a big major "ta-daa".
  {
    const roll0 = tl.total - 3.0;
    for (let t = roll0; t < tl.total - 1.85; t += 0.055) snare(t, 0.08 + ((t - roll0) / 1.2) * 0.22);
    const hitT = tl.total - 1.8;
    crash(hitT, 0.3);
    kick(hitT, 0.7);
    for (const m of [62, 66, 69, 71, 74]) trumpet(m + 12, hitT, 1.5, 0.45);
    for (const m of [50, 62, 66, 69]) pianoNote(m, hitT, 1.8, 1);
    bassNote(38, hitT, 1.6);
  }

  // ---- Short hook: hit on the smash cut, rising roll, clarinet pickup.
  if (tl.hook) {
    const end = tl.hook.end;
    kick(0.02, 0.7);
    crash(0.02, 0.3);
    stab(0.02, DM, 1, 0.35);
    for (let t = 0.6; t < end - 0.1; t += Math.max(0.05, 0.22 - t * 0.035)) snare(t, 0.06 + (t / end) * 0.2);
    for (let k = 0; k < 4; k++) clarinet(62 + [0, 3, 5, 6][k] + 12, 1.2 + k * 0.42, 0.36);
  }

  // ---- Duck under narration, fade in/out, soft-limit, add crackle.
  const duck = duckTarget(tl, N, SR);
  const aDown = 1 - Math.exp(-1 / (0.06 * SR));
  const aUp = 1 - Math.exp(-1 / (DUCK_RELEASE * SR));
  let d = 1;
  const r = rng(2024);
  const fadeIn = tl.hook ? 0.03 : 0.6;
  for (let n = 0; n < N; n++) {
    const target = duck[n];
    d += (target < d ? aDown : aUp) * (target - d);
    const t = n / SR;
    const fade = Math.min(1, t / fadeIn, Math.max(0, (tl.total + 0.4 - t) / 1.2));
    let c = (r() * 2 - 1) * 0.004;
    if (r() < 0.0003) c += (r() * 2 - 1) * 0.2;
    const k = d * fade * 1.15;
    mx.L[n] = Math.tanh(mx.L[n] * k) * 0.92 + c * fade;
    mx.R[n] = Math.tanh(mx.R[n] * k) * 0.92 + c * fade;
  }

  const buf = new AudioBuffer({ length: N, numberOfChannels: 2, sampleRate: SR });
  buf.copyToChannel(mx.L, 0);
  buf.copyToChannel(mx.R, 1);
  return buf;
}

/** Music level under the voice: 0.25 = -12 dB (at 0.42, -7.5 dB, the voice was only ~11.6 dB over the music). */
const DUCK_LEVEL = 0.25;
/** Lines closer than this share one duck: the music stays down through a breath instead of pumping up in it. */
const DUCK_BRIDGE = 0.8;
/** How long the music takes to come back up after the voice (s). */
const DUCK_RELEASE = 0.5;

/** Per-sample target gain of the music: DUCK_LEVEL while a line is spoken (and across short breaths), else 1. */
function duckTarget(tl: Timeline, N: number, sr: number): Float32Array {
  const duck = new Float32Array(N).fill(1);
  const spans: [number, number][] = [];
  for (const c of [...tl.cues].sort((x, y) => x.start - y.start)) {
    const last = spans[spans.length - 1];
    if (last && c.start - last[1] < DUCK_BRIDGE) last[1] = Math.max(last[1], c.end);
    else spans.push([c.start, c.end]);
  }
  for (const [s0, s1] of spans) {
    const a = Math.max(0, Math.floor((s0 - 0.12) * sr));
    const z = Math.min(N, Math.floor((s1 + 0.05) * sr));
    duck.fill(DUCK_LEVEL, a, z);
  }
  return duck;
}

/**
 * Fit a music track the user loaded (e.g. from the YouTube Audio Library) to the
 * episode: loop it to the timeline length with a short crossfade, duck it under
 * every narration line and fade in/out — the same treatment as the built-in score.
 */
export function fitMusicTrack(src: AudioBuffer, tl: Timeline): AudioBuffer {
  const sr = src.sampleRate;
  const N = Math.ceil((tl.total + 0.6) * sr);
  const out = new AudioBuffer({ length: N, numberOfChannels: 2, sampleRate: sr });
  const xf = Math.min(Math.floor(sr * 1.5), Math.floor(src.length / 4));
  const loopLen = Math.max(1, src.length - xf);
  const duck = duckTarget(tl, N, sr);
  const aDown = 1 - Math.exp(-1 / (0.06 * sr));
  const aUp = 1 - Math.exp(-1 / (DUCK_RELEASE * sr));
  for (let ch = 0; ch < 2; ch++) {
    const inp = src.getChannelData(Math.min(ch, src.numberOfChannels - 1));
    const o = out.getChannelData(ch);
    let d = 1;
    for (let n = 0; n < N; n++) {
      const i = n % loopLen;
      let v = inp[i];
      // Crossfade the loop seam: the head of the next pass blends with the tail.
      if (n >= loopLen && i < xf) {
        const k = i / xf;
        v = v * k + inp[loopLen + i] * (1 - k);
      }
      d += (duck[n] < d ? aDown : aUp) * (duck[n] - d);
      const t = n / sr;
      const fade = Math.min(1, t / 0.5, Math.max(0, (tl.total + 0.4 - t) / 2));
      o[n] = v * d * fade;
    }
  }
  return out;
}
