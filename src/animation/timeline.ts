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
/** Extra air before a reveal sentence (Scene.breaths), on top of the usual breath between sentences. */
export const REVEAL_BREATH = 0.6;
const ABBREVIATION = /(?:^|\s)(?:Dr|Mr|Mrs|Ms|Sen|Rep|Adm|Gen|Col|Lt|St|Jr|Sr|Prof|No|vs|U\.S|D\.C)\.$/;

/** Longest subtitle cue, in words. Longer sentences are split. (10: at 13 the 9:16 captions ran to 3 lines.) */
const MAX_CUE_WORDS = 10;
const MAX_CUE_CHARS = 52;

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
  /** Short cut only: where the clip starts inside the scene (real s) and the scene's full length, so the
   *  choreography plays exactly as in the episode. */
  offset?: number;
  fullDuration?: number;
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
  /** True for the Short's own cut (buildShortTimeline): no chapter cards, spans are clips of scenes. */
  short?: boolean;
  /** Short cut: when its closing card starts. */
  endCard?: number;
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

// Cues never end on these (articles, prepositions, conjunctions of the five languages): "un employé de | la CIA"
// and "en pisos | francos" read badly and gave 1-second cues (localization review, 2026-10-25).
const FUNCTION_WORDS = new Set(
  ('a an the of to in on at by for and or that ' +
    'un une le la les de du des à au aux en dans sur par pour et ou que qui ' +
    'una el los las del al por para y o ' +
    'uno lo il i gli di della dello dei delle alla al su per e che ' +
    'um uma os as do da dos das em no na nos nas ' +
    // auxiliaries and possessives: "avaient été | détruites", "à leur | insu"
    'has have had was were ont avaient avait été leur leurs ses son sa ces ce se había habían propia sus su sua suoi seus ' +
    'six sept seven siete seis sette sei sete').split(' '),
);
// Two-word terms of this script that must not be split across cues.
const KEEP_TOGETHER = new Set([
  'safe houses', 'case sicure', 'pisos francos', 'casas seguras', 'programma segreto', 'inspecteur général',
  'ispettore generale', 'cia director',
]);
// A cut just before these opens a clause, so it is preferred.
const CLAUSE_STARTS = new Set('that which when who que qui dont lors quand donde cuando sin che dove senza onde sem'.split(' '));

/**
 * Split one sentence into subtitle-sized cues, recursively, so every cue has at most MAX_CUE_WORDS words and
 * MAX_CUE_CHARS characters (ten French words did not fit two lines in 9:16) and, where it can, at least 4 words.
 * The cut goes near the middle, preferably at a clause break, never after a function word or a number, inside a
 * name ("Frank Church") or inside a KEEP_TOGETHER term.
 */
export function splitSentence(sentence: string): string[] {
  const words = sentence.split(' ');
  if ((words.length <= MAX_CUE_WORDS && sentence.length <= MAX_CUE_CHARS) || words.length < 8) return [sentence];
  const mid = words.length / 2;
  const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}']/gu, '');
  const cap = (w: string) => /^[\p{Lu}]/u.test(w);
  let cut = -1;
  let best = Infinity;
  for (let i = 3; i <= words.length - 3; i++) {
    const before = words[i - 1];
    if (FUNCTION_WORDS.has(bare(before)) && !/[,;:—–]$/.test(before)) continue;
    if (cap(before) && cap(words[i]) && !/[,;:—–]$/.test(before)) continue;
    if (/^\d+$/.test(before) || KEEP_TOGETHER.has(`${bare(before)} ${bare(words[i])}`)) continue;
    let score = Math.abs(i - mid) + (i < 4 || i > words.length - 4 ? 2 : 0);
    if (/[,;:—–]$/.test(before)) score -= words.length / 4;
    else if (CLAUSE_STARTS.has(bare(words[i]))) score -= 1.5;
    if (score < best) {
      best = score;
      cut = i;
    }
  }
  if (cut < 0) {
    if (words.length <= MAX_CUE_WORDS) return [sentence];
    cut = Math.round(mid);
  }
  return [...splitSentence(words.slice(0, cut).join(' ')), ...splitSentence(words.slice(cut).join(' '))];
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
function laySentences(sentences: string[], t0: number, wps: number, gap: number, voice?: VoiceTiming | null, squeeze = 1, breath?: (s: string) => boolean): Laid {
  const out: Laid = { cues: [], clips: [], end: t0 };
  let t = t0;
  sentences.forEach((sentence, si) => {
    if (si > 0) t += (gap + (breath?.(sentence) ? REVEAL_BREATH : 0)) * squeeze;
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
    // A breath between sentences (recorded clips carry a little air of their own): 0.3 s at explainer pace was
    // "too fast, too much information, easy to get lost" (Salvatore, 2026-10-25); 0.42 s had read as dragging.
    const gap = voicedScene ? 0.5 : 0.55;
    const marks = (scene.breaths ?? []).map((b) => b.trim().toLowerCase()).filter(Boolean);
    const breath = marks.length ? (s: string) => marks.some((b) => s.trim().toLowerCase().startsWith(b)) : undefined;
    let laid = laySentences(sentences, start + NARRATION_LEAD_IN, wps, gap, voice, 1, breath);
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
    if (overflow && !voicedScene) laid = laySentences(sentences, start + NARRATION_LEAD_IN, wps, gap, null, available / estimatedSpeech, breath);
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
  // A caption stays up until the next one when the gap is short (the breath between sentences): no flicker of an
  // empty bottom for 0.3 s, and more time to read each line.
  for (let i = 0; i + 1 < cues.length; i++) {
    const gap = cues[i + 1].start - cues[i].end;
    if (cues[i + 1].sceneIndex === cues[i].sceneIndex && gap > 0 && gap < 0.8) cues[i].end = cues[i + 1].start;
  }
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
  (local + (span.offset ?? 0)) * ((span.scene.choreoEnd ?? span.scene.authoredDuration) / (span.fullDuration ?? span.duration));

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

// ---------- The Short's own cut ----------

/** Lead-in before a Short clip's first word and breath after its last (real s); the last clip holds longer. */
const SHORT_PRE = 0.35;
const SHORT_POST = 0.6;
const SHORT_END = 1.4;
/** The closing card's length (real s). */
export const SHORT_END_CARD = 2.4;

/** When sentences from..to of a scene are heard in a timeline: from the voice clips, else from the cues. */
function sentenceRange(tl: Timeline, span: SceneSpan, from: number, to: number): [number, number] | null {
  const sentences = splitSentences(span.scene.narration);
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(sentences.length - 1, Math.max(from, to));
  if (lo > hi) return null;
  const inSpan = (t: number) => t >= span.start - 1e-3 && t < span.end;
  const voiced = sentences.slice(lo, hi + 1).map((s) => tl.clips.find((c) => c.text === s && inSpan(c.start)));
  if (voiced.every(Boolean)) return [voiced[0]!.start, voiced[voiced.length - 1]!.start + voiced[voiced.length - 1]!.duration];
  // No recording: walk the scene's cues, which are the sentences' parts in order.
  const norm = (s: string) => s.replace(/\s+/g, '').length;
  const cues = tl.cues.filter((c) => c.sceneIndex === span.index);
  let si = 0;
  let acc = 0;
  let start: number | null = null;
  let end: number | null = null;
  for (const c of cues) {
    if (si >= lo && si <= hi) {
      start ??= c.start;
      end = c.end;
    }
    acc += norm(c.text);
    if (si < sentences.length && acc >= norm(sentences[si]) - 1) {
      si++;
      acc = 0;
    }
  }
  return start !== null && end !== null ? [start, end] : null;
}

/**
 * The Short as its own cut (project.short): the hook, then each clip - a run of sentences of one scene, cut from
 * the 9:16 episode with its picture, voice, pop-ups and sounds - back to back, without chapter cards. Null when
 * the project has no enabled cut. The editor keeps working on the whole episode's timeline.
 */
export function buildShortTimeline(project: Project, voice?: VoiceTiming | null): Timeline | null {
  const cut = project.short;
  if (!cut?.enabled || !cut.clips.length) return null;
  const long = buildTimeline({ ...project, settings: { ...project.settings, aspect: '9:16' } }, undefined, voice);
  let cursor = long.hook?.end ?? 0;
  const spans: SceneSpan[] = [];
  const cues: Subtitle[] = long.cues.filter((c) => c.sceneIndex < 0);
  const clips = long.clips.filter((c) => c.start < cursor);
  const map: { start: number; end: number; from: number; said: number }[] = [];
  cut.clips.forEach((clip, n) => {
    const L = long.spans.find((s) => s.scene.id === clip.scene);
    const range = L && sentenceRange(long, L, clip.from, clip.to);
    if (!L || !range) return;
    const last = n === cut.clips.length - 1;
    const a = Math.max(L.start, range[0] - SHORT_PRE);
    const b = Math.min(L.end, range[1] + (last ? SHORT_END : SHORT_POST));
    const k = spans.length;
    const shift = cursor - a;
    const lead = Math.max(-(a - L.start), Math.min(L.duration - (b - a), clip.lead ?? 0));
    spans.push({ ...L, index: k, start: cursor, end: cursor + (b - a), duration: b - a, offset: a - L.start + lead, fullDuration: L.duration, overflow: false, extended: false });
    // Only the chosen sentences speak: the breath after the last one shows the picture, not the next line.
    const said = (t: number) => t >= range[0] - 0.05 && t < range[1] - 0.05;
    for (const c of long.cues)
      if (c.sceneIndex === L.index && said(c.start)) cues.push({ ...c, id: `short-${k}-${c.id}`, sceneIndex: k, start: c.start + shift, end: Math.min(c.end, b) + shift });
    for (const c of long.clips) if (said(c.start)) clips.push({ ...c, start: c.start + shift });
    map.push({ start: cursor, end: cursor + (b - a), from: a, said: range[1] });
    cursor += b - a;
  });
  if (!spans.length) return null;
  // Closing card: the last clip's picture runs on under it.
  let endCard: number | undefined;
  if (cut.endCard !== false) {
    const last = spans[spans.length - 1];
    last.end += SHORT_END_CARD;
    last.duration += SHORT_END_CARD;
    endCard = cursor;
    cursor += SHORT_END_CARD;
  }
  const longLevel = long.level;
  const level = longLevel
    ? (t: number) => {
        const m = map.find((x) => t >= x.start && t < x.end);
        if (!m) return t < (long.hook?.end ?? 0) ? longLevel(t) : 0;
        const lt = t - m.start + m.from;
        return lt < m.said ? longLevel(lt) : 0;
      }
    : undefined;
  return { total: cursor, spans, cues, hook: long.hook, lang: long.lang, voiced: long.voiced, clips, level, short: true, endCard };
}
