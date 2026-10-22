import type { Project, Scene, TransitionType } from '../types';
import { MKULTRA_SCRIPT } from './mkultraScript';
import { SPECS } from './specs';
import { scriptFor } from '../i18n/scripts';
import type { Lang } from '../i18n/languages';
import { PROJECT_SCHEMA_VERSION, defaultSettings } from './project';

export { MIN_SCENE_DURATION, MAX_SCENE_DURATION, restoreProject, switchLanguage } from './project';

/** Length the scene choreography (scenes/*.ts) was keyed for; it time-stretches to the real duration. */
const CHOREOGRAPHY_LENGTH: Record<string, number> = { file: 9, question: 14, experiments: 14, cost: 18, revelation: 18, known: 17 };
/** Where schema v7 kept the single project (migrated into the library on first load). */
export const STORAGE_KEY = 'fox-files-studio:mkultra-project';
export const MKULTRA_PROJECT_ID = 'mkultra-secret-experiments';

const TRANSITIONS: TransitionType[] = ['iris', 'ink', 'flash', 'fade', 'ink', 'iris'];

export function createMkultraScenes(lang: Lang): Scene[] {
  const script = scriptFor(lang);
  return MKULTRA_SCRIPT.map((entry, i) => ({
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
    ...(SPECS[entry.id] ? { spec: structuredClone(SPECS[entry.id]) } : {}),
  }));
}

export function createMkultraProject(lang: Lang = 'en'): Project {
  const script = scriptFor(lang);
  return {
    id: MKULTRA_PROJECT_ID,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    template: 'mkultra',
    title: 'The Fox Files',
    episodeTitle: script.episodeTitle,
    episodeSubtitle: script.episodeSubtitle,
    scenes: createMkultraScenes(lang),
    settings: defaultSettings(lang),
  };
}
