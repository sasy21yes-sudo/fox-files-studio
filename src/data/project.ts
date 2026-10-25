import type { Hook, MediaItem, Project, ProjectSettings, Scene, ShortCut, Source, TransitionType } from '../types';
import type { Beat } from './mkultraScript';
import { createMkultraProject } from './mkultraProject';
import { starterSpec } from './specs';
import { isSceneSpec } from '../scene/validate';
import { scriptFor } from '../i18n/scripts';
import { isLang, type Lang } from '../i18n/languages';
import { isMkScene, mkScene } from './projectText';

/**
 * Projects (episodes): creation, validation of stored/imported data and
 * language switching. v8 adds custom episodes, scene ids beyond the six
 * MKUltra ones, data scenes (scene/spec.ts) and per-scene pop-ups.
 */
export const PROJECT_SCHEMA_VERSION = 8;

export const MIN_SCENE_DURATION = 3;
export const MAX_SCENE_DURATION = 90;
const TRANSITIONS: readonly TransitionType[] = ['iris', 'fade', 'flash', 'ink'];

export function defaultSettings(lang: Lang): ProjectSettings {
  return {
    aspect: '16:9',
    filmGrain: true,
    previewSpeed: 1,
    subtitles: { enabled: true, fontScale: 1, position: 0.15, highlightKeywords: true },
    music: true,
    musicVolume: 0.55,
    language: lang,
    studioVoice: {},
    voiceURI: null,
    speechRate: 0.9,
    narrationMode: 'studio',
    showSafeArea: false,
    chapterCards: true,
    shortHook: true,
    characterStyle: 'painted',
  };
}

const rid = () => Math.random().toString(36).slice(2, 8);

/** A new data scene (office, Agent Fox, two shots) ready to be edited. */
export function newScene(title = 'New scene', narration = ''): Scene {
  return {
    id: `scene-${rid()}`,
    number: 0,
    title,
    summary: '',
    duration: 8,
    authoredDuration: 8,
    transition: 'iris',
    narration,
    keywords: [],
    sourceIds: [],
    spec: starterSpec(),
    beats: [],
  };
}

/** An empty custom episode with one starter scene. */
export function createBlankProject(lang: Lang = 'en', title = 'New episode'): Project {
  const scene = newScene('Cold open', 'Write this scene’s narration here.');
  return {
    id: `episode-${rid()}${rid()}`,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    template: 'custom',
    updated: Date.now(),
    title: 'The Fox Files',
    episodeTitle: title,
    episodeSubtitle: '',
    scenes: [{ ...scene, number: 1 }],
    settings: { ...defaultSettings(lang), narrationMode: 'speech' },
    hooks: {},
    sources: [],
  };
}

/** Renumber scenes after an insert, delete or move. */
export const renumber = (scenes: Scene[]): Scene[] => scenes.map((s, i) => (s.number === i + 1 ? s : { ...s, number: i + 1 }));

// ------------------------------------------------------------------ validation

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const strs = (v: unknown, fallback: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fallback);
function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
const isBeat = (b: unknown): b is Beat => isObj(b) && typeof b.cue === 'string' && typeof b.kind === 'string';
const beatList = (v: unknown): Beat[] | undefined => (Array.isArray(v) ? v.filter(isBeat) : undefined);
function perLang<T>(v: unknown, ok: (x: unknown) => x is T): Partial<Record<Lang, T>> | undefined {
  if (!isObj(v)) return undefined;
  const out: Partial<Record<Lang, T>> = {};
  for (const [k, x] of Object.entries(v)) if (isLang(k) && ok(x)) out[k] = x;
  return out;
}
const isString = (x: unknown): x is string => typeof x === 'string';
const isBeatList = (x: unknown): x is Beat[] => Array.isArray(x) && x.every(isBeat);
const isHook = (x: unknown): x is Hook => isObj(x) && typeof x.text === 'string' && Array.isArray(x.keywords);

function restoreScene(raw: unknown, base: Scene | undefined, index: number): Scene | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const fallback = base ?? { ...newScene(), id: raw.id };
  const duration = clampNum(raw.duration, MIN_SCENE_DURATION, MAX_SCENE_DURATION, fallback.duration);
  return {
    ...fallback,
    number: index + 1,
    // MKUltra titles follow the script language; custom titles are the user's.
    title: base && isMkScene(raw.id) ? base.title : str(raw.title, fallback.title),
    summary: str(raw.summary, fallback.summary),
    duration,
    // A coded MKUltra scene keeps its built-in choreography length; a data scene (spec) keeps its own, which its
    // times are authored against (the longer typewriter intro was reset to 9 s on load).
    authoredDuration: base && isMkScene(raw.id) && !isObj(raw.spec) ? base.authoredDuration : clampNum(raw.authoredDuration, 0.5, MAX_SCENE_DURATION, duration),
    choreoEnd: typeof raw.choreoEnd === 'number' && raw.choreoEnd > 0 ? raw.choreoEnd : undefined,
    transition: TRANSITIONS.includes(raw.transition as TransitionType) ? (raw.transition as TransitionType) : fallback.transition,
    chapterCard: raw.chapterCard === false ? false : undefined,
    narration: str(raw.narration, fallback.narration),
    keywords: strs(raw.keywords, fallback.keywords),
    sourceIds: strs(raw.sourceIds, fallback.sourceIds),
    narrations: perLang(raw.narrations, isString),
    titles: perLang(raw.titles, isString),
    spec: isSceneSpec(raw.spec) ? raw.spec : fallback.spec,
    beats: beatList(raw.beats) ?? fallback.beats,
    beatsByLang: perLang(raw.beatsByLang, isBeatList),
  };
}

/**
 * Validate and merge a stored or imported project onto the defaults.
 * Schema v7 (the single MKUltra project) is migrated. Returns null if unusable.
 */
export function restoreProject(raw: unknown): Project | null {
  if (!isObj(raw) || !Array.isArray(raw.scenes)) return null;
  const version = raw.schemaVersion;
  if (version !== PROJECT_SCHEMA_VERSION && version !== 7) return null;
  const stored = raw as Partial<Project> & Record<string, unknown>;
  const lang: Lang = isLang(stored.settings?.language) ? stored.settings!.language : 'en';
  const template = version === 7 || stored.template !== 'custom' ? 'mkultra' : 'custom';
  const base = template === 'mkultra' ? createMkultraProject(lang) : createBlankProject(lang);
  const scenes = (stored.scenes as unknown[])
    .map((s, i) => restoreScene(s, isObj(s) ? base.scenes.find((b) => b.id === s.id) : undefined, i))
    .filter((s): s is Scene => !!s);
  if (!scenes.length) return null;
  const sources = Array.isArray(stored.sources) ? (stored.sources.filter((s) => isObj(s) && typeof s.id === 'string') as Source[]) : base.sources;
  /** The Short's own cut: kept only with well-formed clips. */
  function restoreShort(v: unknown): ShortCut | undefined {
    if (!isObj(v) || !Array.isArray(v.clips)) return undefined;
    const clips = v.clips.filter(
      (c): c is ShortCut['clips'][number] => isObj(c) && typeof c.scene === 'string' && Number.isInteger(c.from) && Number.isInteger(c.to),
    );
    return { enabled: v.enabled !== false, clips };
  }
  return {
    ...base,
    id: typeof stored.id === 'string' && stored.id ? stored.id : base.id,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    template,
    updated: typeof stored.updated === 'number' ? stored.updated : Date.now(),
    title: str(stored.title, base.title),
    episodeTitle: template === 'mkultra' ? base.episodeTitle : str(stored.episodeTitle, base.episodeTitle),
    episodeSubtitle: template === 'mkultra' ? base.episodeSubtitle : str(stored.episodeSubtitle, base.episodeSubtitle),
    hooks: perLang(stored.hooks, isHook) ?? base.hooks,
    media: Array.isArray(stored.media)
      ? (stored.media.filter((m) => isObj(m) && typeof m.id === 'string' && typeof m.width === 'number' && typeof m.height === 'number') as MediaItem[])
      : undefined,
    sources,
    scenes,
    short: restoreShort(stored.short),
    settings: {
      ...base.settings,
      ...(isObj(stored.settings) ? stored.settings : {}),
      language: lang,
      studioVoice: { ...(stored.settings?.studioVoice ?? {}) },
      subtitles: { ...base.settings.subtitles, ...(stored.settings?.subtitles ?? {}) },
    },
  };
}

/**
 * Switch the narration language. The current texts are kept under the old
 * language (so edits survive a round trip) and the new language's are
 * restored: the user's edit if there is one, else the MKUltra translation,
 * else (custom scenes without a translation yet) the current text.
 */
export function switchLanguage(project: Project, lang: Lang): Project {
  const old = project.settings.language ?? 'en';
  if (old === lang) return project;
  const mk = project.template === 'mkultra';
  const script = scriptFor(lang);
  return {
    ...project,
    episodeTitle: mk ? script.episodeTitle : project.episodeTitle,
    episodeSubtitle: mk ? script.episodeSubtitle : project.episodeSubtitle,
    scenes: project.scenes.map((s) => {
      const narrations = { ...(s.narrations ?? {}) };
      const beatsByLang = { ...(s.beatsByLang ?? {}) };
      const titles = { ...(s.titles ?? {}) };
      const was = mkScene(s.id, old);
      const now = mkScene(s.id, lang);
      if (was && now) {
        if (s.narration !== was.narration) narrations[old] = s.narration;
        else delete narrations[old];
        return { ...s, title: now.title, narration: narrations[lang] ?? now.narration, keywords: [...now.keywords], narrations };
      }
      narrations[old] = s.narration;
      titles[old] = s.title;
      if (s.beats) beatsByLang[old] = s.beats;
      return {
        ...s,
        title: titles[lang] ?? s.title,
        narration: narrations[lang] ?? s.narration,
        beats: beatsByLang[lang] ?? s.beats,
        narrations,
        titles,
        beatsByLang,
      };
    }),
    settings: { ...project.settings, language: lang },
  };
}
