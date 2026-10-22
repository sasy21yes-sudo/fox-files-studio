import type { Hook, MkSceneId, Project, Scene } from '../types';
import type { Beat } from './mkultraScript';
import { scriptFor, type LocalizedScene } from '../i18n/scripts';
import type { Lang } from '../i18n/languages';

/**
 * Where a scene's texts come from. Custom episodes keep everything in the
 * project; the MKUltra episode falls back to its translated script
 * (i18n/scripts.ts) for anything the user has not edited.
 */

export const MK_SCENE_IDS: readonly MkSceneId[] = ['file', 'question', 'experiments', 'cost', 'revelation', 'known'];

export const isMkScene = (id: string): id is MkSceneId => (MK_SCENE_IDS as readonly string[]).includes(id);

/** The original MKUltra text of a scene, if it is one of the six. */
export const mkScene = (id: string, lang: Lang): LocalizedScene | undefined => (isMkScene(id) ? scriptFor(lang).scenes[id] : undefined);

/** Explainer pop-ups of a scene in a language. */
export function sceneBeats(scene: Scene, lang: Lang): Beat[] {
  return scene.beatsByLang?.[lang] ?? scene.beats ?? mkScene(scene.id, lang)?.beats ?? [];
}

/** The Short's cold-open hook in a language (null when the episode has none). */
export function projectHook(project: Project, lang: Lang): Hook | null {
  if (project.template === 'mkultra') {
    const custom = project.hooks?.[lang];
    return custom ?? scriptFor(lang).hook;
  }
  return project.hooks?.[lang] ?? project.hooks?.en ?? null;
}
