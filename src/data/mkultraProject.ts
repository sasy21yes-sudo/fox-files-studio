import type { Project, Scene, TransitionType } from '../types';
import { MKULTRA_SCRIPT } from './mkultraScript';
import { scriptFor } from '../i18n/scripts';
import { isLang, type Lang } from '../i18n/languages';

export const PROJECT_SCHEMA_VERSION = 7;

/** Length the scene choreography (scenes/*.ts) was keyed for; it time-stretches to the real duration. */
const CHOREOGRAPHY_LENGTH: Record<string, number> = { file: 9, question: 14, experiments: 14, cost: 18, revelation: 18, known: 17 };
export const STORAGE_KEY = 'fox-files-studio:mkultra-project';

const TRANSITIONS: TransitionType[] = ['iris', 'ink', 'flash', 'fade', 'ink', 'iris'];

export function createMkultraProject(lang: Lang = 'en'): Project {
  const script = scriptFor(lang);
  const scenes: Scene[] = MKULTRA_SCRIPT.map((entry, i) => ({
    id: entry.id,
    number: i + 1,
    title: script.scenes[entry.id].title,
    summary: entry.summary,
    duration: entry.duration,
    authoredDuration: CHOREOGRAPHY_LENGTH[entry.id] ?? entry.duration,
    transition: TRANSITIONS[i],
    narration: script.scenes[entry.id].narration,
    keywords: [...script.scenes[entry.id].keywords],
    sourceIds: [...entry.sourceIds],
  }));

  return {
    id: 'mkultra-secret-experiments',
    schemaVersion: PROJECT_SCHEMA_VERSION,
    title: 'The Fox Files',
    episodeTitle: script.episodeTitle,
    episodeSubtitle: script.episodeSubtitle,
    scenes,
    settings: {
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
    },
  };
}

export const MIN_SCENE_DURATION = 5;
export const MAX_SCENE_DURATION = 60;

/** Validate and merge a stored project onto the defaults. Returns null if unusable. */
export function restoreProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const stored = raw as Partial<Project>;
  if (stored.schemaVersion !== PROJECT_SCHEMA_VERSION || !Array.isArray(stored.scenes)) return null;
  const lang = isLang(stored.settings?.language) ? stored.settings!.language : 'en';
  const base = createMkultraProject(lang);
  const scenes = base.scenes.map((scene) => {
    const s = stored.scenes!.find((x) => x && x.id === scene.id);
    if (!s) return scene;
    return {
      ...scene,
      duration: clampNum(s.duration, MIN_SCENE_DURATION, MAX_SCENE_DURATION, scene.duration),
      transition: (['iris', 'fade', 'flash', 'ink'] as const).includes(s.transition as TransitionType)
        ? (s.transition as TransitionType)
        : scene.transition,
      narration: typeof s.narration === 'string' ? s.narration : scene.narration,
      keywords: Array.isArray(s.keywords) ? s.keywords.filter((k) => typeof k === 'string') : scene.keywords,
      narrations: s.narrations && typeof s.narrations === 'object' ? s.narrations : undefined,
    };
  });
  return {
    ...base,
    scenes,
    settings: {
      ...base.settings,
      ...(stored.settings ?? {}),
      language: lang,
      studioVoice: { ...(stored.settings?.studioVoice ?? {}) },
      subtitles: { ...base.settings.subtitles, ...(stored.settings?.subtitles ?? {}) },
    },
  };
}

/**
 * Switch the narration language. The current text is kept under the old
 * language (so edits survive a round trip) and the new language's text is
 * restored — the user's edit if there is one, otherwise the translation.
 */
export function switchLanguage(project: Project, lang: Lang): Project {
  const old = project.settings.language ?? 'en';
  if (old === lang) return project;
  const script = scriptFor(lang);
  const oldScript = scriptFor(old);
  return {
    ...project,
    episodeTitle: script.episodeTitle,
    episodeSubtitle: script.episodeSubtitle,
    scenes: project.scenes.map((s) => {
      const narrations = { ...(s.narrations ?? {}) };
      if (s.narration !== oldScript.scenes[s.id].narration) narrations[old] = s.narration;
      else delete narrations[old];
      const loc = script.scenes[s.id];
      return { ...s, title: loc.title, narration: narrations[lang] ?? loc.narration, keywords: [...loc.keywords], narrations };
    }),
    settings: { ...project.settings, language: lang },
  };
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
