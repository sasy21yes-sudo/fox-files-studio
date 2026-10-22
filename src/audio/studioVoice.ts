import type { Lang } from '../i18n/languages';
import { spokenText } from '../i18n/scripts';
import { splitSentence, type Timeline, type VoiceClip, type VoiceTiming } from '../animation/timeline';

/**
 * The neural "studio" narrator.
 *
 * A voice pack is one compressed track holding every sentence of the script,
 * rendered offline with Kokoro-82M by tools/render_voice.py, plus an index of
 * where each sentence sits. Sentences the user has rewritten are not in the
 * pack; when the local voice server (tools/voice_server.py) is running they
 * are rendered on the fly with the same voice, otherwise the browser voice
 * reads just those lines in the preview.
 *
 * Because the clips are real audio, they drive the timeline exactly:
 * subtitles, pop-ups and lip sync follow the voice, and the narration is
 * mixed into exported videos.
 */

export const STUDIO_RATE = 44100;
/** Lip-sync level frames per second. */
const LEVEL_FPS = 100;

interface Clip extends VoiceClip {
  buffer: AudioBuffer;
  /** Offset of the sentence inside `buffer`. */
  offset: number;
  /** Mouth-opening level, 0..1, at LEVEL_FPS from the sentence start. */
  level: Float32Array;
}

export interface StudioPack {
  lang: Lang;
  voice: string;
  clips: Map<string, Clip>;
}

interface PackIndex {
  version: number;
  lang: Lang;
  voice: string;
  audio: string;
  duration: number;
  sentences: Record<string, [number, number, number[]]>;
}

let decoder: OfflineAudioContext | null = null;
const decodeCtx = () => (decoder ??= new OfflineAudioContext(1, 1, STUDIO_RATE));

// Relative to the page, so it works from the dev server, a static folder or the published artifact.
const packUrl = (file: string) => `voice/${file}`;

/** Mouth level from the audio: RMS envelope, normalised to the voice's loud speech. */
function levels(buffer: AudioBuffer, offset: number, dur: number, norm?: number): { level: Float32Array; p95: number } {
  const d = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const hop = Math.round(sr / LEVEL_FPS);
  const n = Math.max(1, Math.ceil((dur * sr) / hop));
  const out = new Float32Array(n);
  const a = Math.round(offset * sr);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const from = a + i * hop;
    const to = Math.min(d.length, from + hop * 2);
    for (let j = from; j < to; j++) s += d[j] * d[j];
    out[i] = Math.sqrt(s / Math.max(1, to - from));
  }
  const sorted = Float32Array.from(out).sort();
  const p95 = norm ?? (sorted[Math.floor(sorted.length * 0.95)] || 1);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, out[i] / p95);
  return { level: out, p95 };
}

export async function loadStudioPack(lang: Lang, voice: string, signal?: AbortSignal): Promise<StudioPack> {
  const res = await fetch(packUrl(`${lang}-${voice}.json`), { signal });
  if (!res.ok) throw new Error(`voice pack ${lang}-${voice} not found (${res.status})`);
  const index = (await res.json()) as PackIndex;
  const audio = await fetch(packUrl(index.audio), { signal });
  if (!audio.ok) throw new Error(`voice audio ${index.audio} not found (${audio.status})`);
  const buffer = await decodeCtx().decodeAudioData(await audio.arrayBuffer());
  const clips = new Map<string, Clip>();
  // One loudness reference for the whole pack keeps the mouth consistent across lines.
  const ref = levels(buffer, 0, buffer.duration).p95;
  for (const [text, [start, duration, splits]] of Object.entries(index.sentences)) {
    clips.set(text, { buffer, offset: start, duration, splits, level: levels(buffer, start, duration, ref).level });
  }
  return { lang, voice, clips };
}

// ------------------------------------------------------------------ local voice server

export const VOICE_SERVER = 'http://127.0.0.1:8765';

export interface VoiceServerInfo {
  engine: string;
}

/** Is tools/voice_server.py running on this machine? */
export async function probeVoiceServer(timeoutMs = 900): Promise<VoiceServerInfo | null> {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${VOICE_SERVER}/health`, { signal: ac.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.ok ? { engine: String(j.engine ?? 'Kokoro') } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

/** Render one sentence with the local Kokoro server (same voice as the pack). */
export async function renderSentence(text: string, lang: Lang, voice: string, kokoroLang: string, speed: number): Promise<Clip> {
  const body = {
    text,
    say: spokenText(text, lang),
    parts: splitSentence(text).map((p) => spokenText(p, lang)),
    voice,
    lang: kokoroLang,
    speed,
  };
  const r = await fetch(`${VOICE_SERVER}/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`voice server: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { wav: string; duration: number; splits: number[] };
  const bytes = Uint8Array.from(atob(j.wav), (c) => c.charCodeAt(0));
  const buffer = await decodeCtx().decodeAudioData(bytes.buffer);
  return { buffer, offset: 0, duration: buffer.duration, splits: j.splits, level: levels(buffer, 0, buffer.duration).level };
}

// ------------------------------------------------------------------ timing + track

/** Timing source for buildTimeline: the pack first, then sentences rendered live. */
export function studioTiming(pack: StudioPack | null, live: Map<string, Clip>): VoiceTiming & { clip(text: string): Clip | undefined } {
  const clip = (text: string) => pack?.clips.get(text) ?? live.get(text);
  return {
    clip,
    sentence: (text) => clip(text),
    level(text, t) {
      const c = clip(text);
      if (!c) return 0;
      const i = Math.floor(t * LEVEL_FPS);
      return i >= 0 && i < c.level.length ? c.level[i] : 0;
    },
  };
}

/** The whole narration as one track, each sentence placed where the timeline plays it. */
export function renderStudioTrack(tl: Timeline, timing: ReturnType<typeof studioTiming>): AudioBuffer | null {
  if (!tl.clips.length) return null;
  const length = Math.ceil(tl.total * STUDIO_RATE);
  const track = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: STUDIO_RATE });
  const out = track.getChannelData(0);
  for (const placed of tl.clips) {
    const c = timing.clip(placed.text);
    if (!c) continue;
    const src = c.buffer.getChannelData(0);
    const ratio = c.buffer.sampleRate / STUDIO_RATE;
    const a = Math.round(placed.start * STUDIO_RATE);
    const n = Math.round(c.duration * STUDIO_RATE);
    const so = c.offset * c.buffer.sampleRate;
    for (let i = 0; i < n && a + i < length; i++) {
      // Nearest-sample read; the pack is decoded at STUDIO_RATE so ratio is 1.
      const v = src[Math.round(so + i * ratio)] ?? 0;
      // 6 ms fades so a cut can never click.
      const fade = Math.min(1, i / 264, (n - i) / 264);
      out[a + i] += v * fade;
    }
  }
  return track;
}

export const missingSentences = (timing: ReturnType<typeof studioTiming>, sentences: string[]) =>
  sentences.filter((s) => !timing.clip(s));
