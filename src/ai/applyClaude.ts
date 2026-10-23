import type { Hook, MediaItem, Project, ProjectSettings, Scene, Source } from '../types';
import type { AiResult } from './claude';
import { MAX_SCENE_DURATION, MIN_SCENE_DURATION, newScene } from '../data/project';
import { withBeats } from '../editor/Inspector';
import { addMedia } from '../media/store';
import { generateImage, type ImageAspect, type ImageStyle } from './localImage';

/**
 * Applies a checked "Ask Claude" answer (tools/vite/claudeScene.ts) to the project: scene edits, new
 * scenes, the scene order (scenes left out are deleted), episode settings and the pictures Claude asked
 * the local image model for. The caller applies it as ONE edit, so a single Undo restores everything.
 */

/** Paint the pictures Claude asked for, one at a time. Returns key -> library item; failures are listed, not thrown. */
export async function paintImages(
  r: AiResult,
  onProgress: (done: number, total: number, prompt: string) => void,
  signal?: AbortSignal,
): Promise<{ items: Record<string, MediaItem>; failed: string[] }> {
  const items: Record<string, MediaItem> = {};
  const failed: string[] = [];
  const list = r.images ?? [];
  for (const [i, im] of list.entries()) {
    onProgress(i, list.length, im.prompt);
    try {
      const out = await generateImage({ prompt: im.prompt, style: im.style as ImageStyle, aspect: im.aspect as ImageAspect }, signal);
      items[im.key] = await addMedia(out.blob, { name: im.key.replace(/-/g, ' '), source: 'generated', prompt: im.prompt, style: im.style, seed: out.seed });
    } catch (e) {
      if (signal?.aborted) throw e;
      failed.push(`${im.key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  onProgress(list.length, list.length, '');
  return { items, failed };
}

/** Swap "new:<key>" image references for the painted images' ids (missing ones fall back to no image). */
function resolveImages<T>(x: T, painted: Record<string, MediaItem>): T {
  if (x === null || x === undefined) return x;
  const text = JSON.stringify(x).replace(/"new:([a-z0-9-]+)"/g, (_, key: string) => JSON.stringify(painted[key]?.id ?? ''));
  return JSON.parse(text) as T;
}

const clampDuration = (d: number) => Math.min(MAX_SCENE_DURATION, Math.max(MIN_SCENE_DURATION, d));

export function applyClaudeResult(p: Project, r0: AiResult, painted: Record<string, MediaItem> = {}): Project {
  const r = resolveImages(r0, painted);
  const lang = p.settings.language;

  // 1. Edits to existing scenes.
  const base: Scene[] = p.scenes.map((s, index) => {
    const c = r.scenes.find((x) => x.index === index);
    if (!c) return s;
    let next: Scene = {
      ...s,
      ...(c.spec ? { spec: c.spec } : {}),
      ...(c.narration ? { narration: c.narration } : {}),
      ...(c.fields ?? {}),
    };
    if (c.beats) next = { ...next, ...withBeats(next, lang, c.beats) };
    if (c.duration && Math.abs(c.duration - s.duration) > 0.05) {
      const d = clampDuration(c.duration);
      next.duration = d;
      // Custom scenes are authored in real seconds: keep the choreography unstretched.
      if (Math.abs(s.authoredDuration - s.duration) < 0.05) next.authoredDuration = d;
    }
    return next;
  });

  // 2. New scenes, then the order (scenes left out of it are deleted).
  const added: Record<string, Scene> = {};
  for (const n of r.newScenes ?? []) {
    const d = clampDuration(n.duration);
    const s: Scene = { ...newScene(n.title, n.narration), summary: n.summary, duration: d, authoredDuration: d, transition: n.transition, spec: n.spec, beats: [] };
    added[n.ref] = { ...s, ...withBeats(s, lang, n.beats) };
  }
  let scenes: Scene[];
  if (r.order?.length) {
    scenes = r.order.map((x) => (typeof x === 'number' ? base[x] : added[x])).filter((s): s is Scene => !!s);
    for (const [ref, s] of Object.entries(added)) if (!r.order.includes(ref)) scenes.push(s);
  } else scenes = [...base, ...Object.values(added)];
  if (!scenes.length) scenes = base;
  scenes = scenes.map((s, i) => ({ ...s, number: i + 1 }));

  // 3. The episode.
  const e = (r.episode ?? {}) as {
    episodeTitle?: string;
    episodeSubtitle?: string;
    hook?: Hook;
    settings?: Partial<Omit<ProjectSettings, 'studioVoice' | 'subtitles'>> & { studioVoice?: string; subtitles?: Partial<ProjectSettings['subtitles']> };
    sources_add?: Source[];
  };
  let settings = p.settings;
  if (e.settings) {
    const { studioVoice, subtitles, ...rest } = e.settings;
    settings = {
      ...settings,
      ...rest,
      ...(subtitles ? { subtitles: { ...settings.subtitles, ...subtitles } } : {}),
      ...(studioVoice ? { studioVoice: { ...settings.studioVoice, [lang]: studioVoice } } : {}),
    };
  }
  const sources = e.sources_add?.length
    ? [...(p.sources ?? []).filter((s) => !e.sources_add!.some((n) => n.id === s.id)), ...e.sources_add.map((s) => ({ ...s, publisher: s.publisher ?? '', date: s.date ?? '' }))]
    : p.sources;

  return {
    ...p,
    ...(e.episodeTitle ? { episodeTitle: e.episodeTitle } : {}),
    ...(e.episodeSubtitle !== undefined ? { episodeSubtitle: e.episodeSubtitle } : {}),
    ...(e.hook ? { hooks: { ...(p.hooks ?? {}), [lang]: { text: e.hook.text, keywords: e.hook.keywords } } } : {}),
    settings,
    sources,
    scenes,
    media: Object.keys(painted).length ? [...(p.media ?? []), ...Object.values(painted)] : p.media,
  };
}

/** Whether an answer changes anything at all. */
export const changesAnything = (r: AiResult) =>
  r.scenes.length > 0 || !!r.newScenes?.length || !!r.order?.length || !!r.episode || !!r.images?.length;
