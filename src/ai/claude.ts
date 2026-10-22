import type { Project } from '../types';
import type { SceneSpec } from '../scene/spec';
import type { Beat } from '../data/mkultraScript';
import { sceneBeats } from '../data/projectText';
import { sourceById } from '../data/sources';
import type { Timeline } from '../animation/timeline';
import { toAuthored } from '../editor/model';

/**
 * Browser side of "edit with a prompt". The request goes to the dev server
 * (tools/vite/claudeScene.ts), which asks Claude through the local Claude Code
 * (or the API key in .env); in a static build there is no such endpoint and the
 * panel says so.
 */

export interface AiStatus {
  available: boolean;
  backend?: 'claude-code' | 'api' | null;
  model?: string;
  /** False when the page is not served by `npm run dev`. */
  devServer: boolean;
}

/** What to edit: one scene (its index) or the whole episode. */
export type AiTarget = number | 'all';

export interface AiSceneChange {
  index: number;
  spec: SceneSpec | null;
  beats: Beat[] | null;
  duration: number | null;
}

export interface AiResult {
  summary: string;
  scenes: AiSceneChange[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  model: string;
  attempts: number;
}

export async function aiStatus(): Promise<AiStatus> {
  try {
    const r = await fetch('/api/claude/status');
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { available: false, devServer: false };
    const j = (await r.json()) as Omit<AiStatus, 'devServer'>;
    return { ...j, devServer: true };
  } catch {
    return { available: false, devServer: false };
  }
}

/**
 * `timeline` (optional) adds when each subtitle cue of the scenes in scope is heard, in the
 * scene's authored seconds, so Claude can time things to words.
 */
export async function editWithClaude(project: Project, target: AiTarget, prompt: string, signal?: AbortSignal, timeline?: Timeline): Promise<AiResult> {
  const lang = project.settings.language;
  // A one-scene edit still sends its neighbours' narration, so Claude knows the story around it.
  const scenes = project.scenes.map((s, index) => ({
    index,
    title: s.title,
    summary: s.summary,
    narration: s.narration,
    duration: s.duration,
    authoredDuration: s.authoredDuration,
    spec: target === 'all' || target === index ? (s.spec ?? null) : null,
    beats: target === 'all' || target === index ? sceneBeats(s, lang) : [],
    sourceIds: s.sourceIds,
    speech:
      timeline && (target === 'all' || target === index) && timeline.spans[index]
        ? timeline.cues
            .filter((c) => c.sceneIndex === index)
            .map((c) => ({
              text: c.text,
              from: Math.round(toAuthored(timeline.spans[index], c.start) * 100) / 100,
              to: Math.round(toAuthored(timeline.spans[index], c.end) * 100) / 100,
              exact: c.timing === 'exact',
            }))
        : undefined,
  }));
  const ids = [...new Set((target === 'all' ? project.scenes : [project.scenes[target]]).flatMap((s) => s.sourceIds))];
  const sources = ids
    .map((id) => project.sources?.find((s) => s.id === id) ?? sourceById(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ id: s.id, title: s.title, publisher: s.publisher, date: s.date, claims: s.claims }));
  const body = {
    prompt,
    target,
    episode: { title: project.episodeTitle, language: lang, aspect: project.settings.aspect, template: project.template },
    scenes,
    sources,
    media: (project.media ?? []).map((m) => ({ id: m.id, name: m.name, prompt: m.prompt ?? '', width: m.width, height: m.height })),
  };
  const r = await fetch('/api/claude/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as AiResult;
}
