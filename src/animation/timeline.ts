import type { Project, Scene, Subtitle } from '../types';
import { projectHook } from '../data/projectText';
import type { Lang } from '../i18n/languages';

/**
 * The shared timeline model. Playback, subtitles, speech cues, the preview,
 * thumbnails and the exporter all derive their timing from `buildTimeline`.
 */

/** Average English narration pace used for estimates, in words per second at rate 1.0. */
export const WORDS_PER_SECOND = 2.55;
/** Silence before narration starts inside a scene. */
export const NARRATION_LEAD_IN = 0.7;
/** Minimum silence kept at the end of a scene. */
export const NARRATION_TAIL = 0.5;
const ABBREVIATION = /(?:^|\s)(?:Dr|Mr|Mrs|Ms|Sen|Rep|Adm|Gen|Col|Lt|St|Jr|Sr|Prof|No|vs|U\.S|D\.C)\.$/;

/** Longest subtitle cue, in words. Longer sentences are split. */
const MAX_CUE_WORDS = 13;

export interface SceneSpan {
  index: number;
  scene: Scene;
  start: number;
  end: number;
  duration: number;
  /** Estimated speaking time of this scene's narration. */
  estimatedSpeech: number;
  /** True when the estimated narration does not fit inside the scene. */
  overflow: boolean;
  /** True when the scene was lengthened to fit the recorded (neural) narration. */
  extended: boolean;
}

/** One rendered narration sentence. */
export interface VoiceClip {
  duration: number;
  /** Where the sentence's subtitle cues change, in seconds from the clip start (at the voice's pauses). */
  splits: number[];
}

/**
 * Real clip lengths from a rendered narration (the neural "studio" voice).
 * Sentences with a clip are timed exactly; scenes grow when the recorded
 * voice needs more room than the scene allows (a real voice cannot be squeezed).
 */
export interface VoiceTiming {
  sentence(text: string): VoiceClip | undefined;
  /** Mouth-opening level (0..1) `t` seconds into a sentence's clip, for lip sync. */
  level?(text: string, t: number): number;
}

export interface Timeline {
  total: number;
  spans: SceneSpan[];
  cues: Subtitle[];
  /** Narration language of this timeline (subtitles, beats and labels). */
  lang: Lang;
  /** True when cue timing comes from rendered voice clips. */
  voiced: boolean;
  /** Where each rendered sentence clip plays (studio voice). */
  clips: { text: string; start: number; duration: number }[];
  /** Voice level (0..1) at a timeline time when the narration is recorded; drives the mouth. */
  level?: (t: number) => number;
  /** Cold-open hook at the start of the 9:16 Short (scene spans start after it). */
  hook?: { start: 0; end: number; text: string; keywords: string[] };
}

/** Length of the Short's hook, in seconds. */
export const HOOK_DURATION = 5.6;
const HOOK_LEAD_IN = 0.25;

/** True when this project renders as the vertical Short with a hook. */
// The hook scene (scenes/hook.ts) is drawn for the MKUltra episode only, for now.
export const hasHook = (project: Project) =>
  project.settings.aspect === '9:16' && project.settings.shortHook !== false && project.template === 'mkultra' && !!projectHook(project, project.settings.language ?? 'en');

export const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** Split narration into sentences (abbreviations such as "Dr." or "U.S." do not end one). */
export function splitSentences(text: string): string[] {
  const pieces = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[\p{Lu}0-9“"«¿¡])/u)
    .filter(Boolean);
  const sentences: string[] = [];
  for (const piece of pieces) {
    const prev = sentences[sentences.length - 1];
    if (prev && ABBREVIATION.test(prev)) sentences[sentences.length - 1] = `${prev} ${piece}`;
    else sentences.push(piece);
  }
  return sentences;
}

/** Split one sentence into subtitle-sized cues at a clause boundary near the middle. */
export function splitSentence(sentence: string): string[] {
  const words = sentence.split(' ');
  if (words.length <= MAX_CUE_WORDS) return [sentence];
  const cues: string[] = [];
  let remaining = words;
  while (remaining.length > MAX_CUE_WORDS) {
    const mid = Math.ceil(remaining.length / 2);
    let cut = -1;
    // Only clause breaks in the middle half: a 3-word cue flashes by too fast to read.
    for (let d = 0; d <= Math.floor(remaining.length / 4) && cut < 0; d++) {
      for (const i of [mid + d, mid - d]) {
        if (i > 2 && i < remaining.length - 2 && /[,;:—–]$/.test(remaining[i - 1])) {
          cut = i;
          break;
        }
      }
    }
    if (cut < 0) cut = mid;
    cues.push(remaining.slice(0, cut).join(' '));
    remaining = remaining.slice(cut);
  }
  if (remaining.length) cues.push(remaining.join(' '));
  return cues;
}

/** Split narration into subtitle-sized cues at sentence and clause boundaries. */
export const splitIntoCues = (text: string): string[] => splitSentences(text).flatMap(splitSentence);

interface Laid {
  cues: { start: number; end: number; text: string; exact: boolean }[];
  clips: { text: string; start: number; duration: number }[];
  end: number;
}

/**
 * Lay sentences out from `t0`. A sentence with a recorded clip uses the clip's
 * real length (its cues split where the voice pauses); others are estimated
 * from word counts, one breath (`gap`) between cues.
 */
function laySentences(sentences: string[], t0: number, wps: number, gap: number, voice?: VoiceTiming | null, squeeze = 1): Laid {
  const out: Laid = { cues: [], clips: [], end: t0 };
  let t = t0;
  sentences.forEach((sentence, si) => {
    if (si > 0) t += gap * squeeze;
    const parts = splitSentence(sentence);
    const clip = voice?.sentence(sentence);
    if (clip) {
      out.clips.push({ text: sentence, start: t, duration: clip.duration });
      const bounds = [0, ...clip.splits.slice(0, parts.length - 1), clip.duration];
      parts.forEach((text, i) => out.cues.push({ start: t + bounds[i], end: t + bounds[i + 1], text, exact: true }));
      t += clip.duration;
    } else {
      parts.forEach((text, i) => {
        if (i > 0) t += gap * squeeze;
        const len = (countWords(text) / wps) * squeeze;
        out.cues.push({ start: t, end: t + len, text, exact: false });
        t += len;
      });
    }
  });
  out.end = t;
  return out;
}

export function buildTimeline(project: Project, speechRate = project.settings.speechRate, voice?: VoiceTiming | null): Timeline {
  const spans: SceneSpan[] = [];
  const cues: Subtitle[] = [];
  const clips: Timeline['clips'] = [];
  let cursor = 0;
  const wps = WORDS_PER_SECOND * Math.max(0.5, speechRate);
  const lang = project.settings.language ?? 'en';
  const hookText = projectHook(project, lang);
  let hook: Timeline['hook'];

  if (hasHook(project) && hookText) {
    const sentences = splitSentences(hookText.text);
    const voiced = !!voice && sentences.every((x) => voice.sentence(x));
    let laid = laySentences(sentences, HOOK_LEAD_IN, wps, voiced ? 0.18 : 0.12, voiced ? voice : null);
    if (voiced) cursor = Math.max(HOOK_DURATION, laid.end + 0.4);
    else {
      const squeeze = Math.min(1, (HOOK_DURATION - HOOK_LEAD_IN - 0.3) / Math.max(0.01, laid.end - HOOK_LEAD_IN));
      if (squeeze < 1) laid = laySentences(sentences, HOOK_LEAD_IN, wps, 0.12, null, squeeze);
      cursor = HOOK_DURATION;
    }
    laid.cues.forEach((c, i) => cues.push({ id: `hook-${i}`, sceneIndex: -1, start: c.start, end: c.end, text: c.text, timing: c.exact ? 'exact' : 'estimated' }));
    clips.push(...laid.clips);
    hook = { start: 0, end: cursor, text: hookText.text, keywords: hookText.keywords };
  }

  project.scenes.forEach((scene, index) => {
    const start = cursor;
    const sentences = splitSentences(scene.narration);
    const voicedScene = !!voice && sentences.some((x) => voice.sentence(x));
    // Explainer pacing: a breath between sentences (recorded clips carry a little air of their own); 0.42 s
    // read as dragging once the packs were brought to explainer pace (review, 2026-10-24).
    const gap = voicedScene ? 0.3 : 0.45;
    let laid = laySentences(sentences, start + NARRATION_LEAD_IN, wps, gap, voice);
    const estimatedSpeech = laid.end - start - NARRATION_LEAD_IN;
    let duration = scene.duration;
    let extended = false;
    if (voicedScene && estimatedSpeech > duration - NARRATION_LEAD_IN - NARRATION_TAIL - 0.3) {
      // A real voice cannot be squeezed: give the scene the room it needs.
      duration = NARRATION_LEAD_IN + estimatedSpeech + NARRATION_TAIL + 0.3;
      extended = true;
    }
    const available = Math.max(0.5, duration - NARRATION_LEAD_IN - NARRATION_TAIL);
    const overflow = estimatedSpeech > available + 0.05;
    if (overflow && !voicedScene) laid = laySentences(sentences, start + NARRATION_LEAD_IN, wps, gap, null, available / estimatedSpeech);
    laid.cues.forEach((c, i) =>
      cues.push({ id: `${scene.id}-${i}`, sceneIndex: index, start: c.start, end: c.end, text: c.text, timing: c.exact ? 'exact' : 'estimated' }),
    );
    clips.push(...laid.clips);
    spans.push({ index, scene, start, end: start + duration, duration, estimatedSpeech, overflow, extended });
    cursor += duration;
  });

  const levelOf = voice?.level?.bind(voice);
  const level =
    levelOf && clips.length
      ? (t: number) => {
          // Clips are in time order: binary search the one playing at t.
          let lo = 0;
          let hi = clips.length - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (clips[mid].start <= t) lo = mid;
            else hi = mid - 1;
          }
          const c = clips[lo];
          return t >= c.start && t < c.start + c.duration ? levelOf(c.text, t - c.start) : 0;
        }
      : undefined;
  return { total: cursor, spans, cues, hook, lang, voiced: clips.length > 0, clips, level };
}

export interface TimelinePosition {
  span: SceneSpan;
  /** Seconds since the start of the scene. */
  local: number;
}

export function locate(tl: Timeline, t: number): TimelinePosition {
  const time = Math.min(Math.max(0, t), Math.max(0, tl.total - 1e-4));
  if (time < tl.spans[0].start) return { span: tl.spans[0], local: 0 };
  for (const span of tl.spans) {
    if (time < span.end) return { span, local: time - span.start };
  }
  const last = tl.spans[tl.spans.length - 1];
  return { span: last, local: last.duration };
}

export const cueAt = (tl: Timeline, t: number): Subtitle | undefined =>
  tl.cues.find((c) => t >= c.start && t < c.end);

/** Time-stretch factor from real scene seconds to authored choreography seconds. */
export const choreoTime = (span: SceneSpan, local: number) =>
  local * (span.scene.authoredDuration / span.duration);

export function formatTime(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}

// ---------- Subtitle file export (SRT / WebVTT) ----------

const stamp = (t: number, sep: ',' | '.') => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(r).padStart(3, '0')}`;
};

export function toSRT(tl: Timeline): string {
  return tl.cues
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`)
    .join('\n');
}

export function toVTT(tl: Timeline): string {
  return (
    (tl.voiced
      ? 'WEBVTT\nNOTE Timing comes from the rendered narration clips.\n\n'
      : 'WEBVTT\nNOTE Timing is estimated from word counts (scene-level sync), not measured from audio.\n\n') +
    tl.cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n')
  );
}
