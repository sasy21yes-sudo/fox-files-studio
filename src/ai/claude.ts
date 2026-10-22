import type { Project } from '../types';
import type { SceneSpec } from '../scene/spec';
import type { Beat } from '../data/mkultraScript';
import { sceneBeats } from '../data/projectText';
import { sourceById } from '../data/sources';

/**
 * Browser side of "edit a scene with a prompt". The request goes to the dev
 * server (tools/vite/claudeScene.ts), which holds the API key and calls Claude;
 * in a static build there is no such endpoint and the panel says so.
 */

export interface AiStatus {
  available: boolean;
  model?: string;
  /** False when the page is not served by `npm run dev`. */
  devServer: boolean;
}

export interface AiResult {
  summary: string;
  spec: SceneSpec;
  beats: Beat[] | null;
  duration: number | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  model: string;
  attempts: number;
}

export async function aiStatus(): Promise<AiStatus> {
  try {
    const r = await fetch('/api/claude/status');
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { available: false, devServer: false };
    const j = (await r.json()) as { available: boolean; model: string };
    return { ...j, devServer: true };
  } catch {
    return { available: false, devServer: false };
  }
}

export async function editSceneWithClaude(project: Project, index: number, prompt: string, signal?: AbortSignal): Promise<AiResult> {
  const scene = project.scenes[index];
  const lang = project.settings.language;
  const sources = scene.sourceIds
    .map((id) => project.sources?.find((s) => s.id === id) ?? sourceById(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ id: s.id, title: s.title, claims: s.claims }));
  const body = {
    prompt,
    episode: { title: project.episodeTitle, language: lang, aspect: project.settings.aspect, template: project.template },
    scene: {
      index,
      title: scene.title,
      summary: scene.summary,
      narration: scene.narration,
      duration: scene.duration,
      authoredDuration: scene.authoredDuration,
      spec: scene.spec ?? null,
      beats: sceneBeats(scene, lang),
    },
    sources,
  };
  const r = await fetch('/api/claude/scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as AiResult;
}
