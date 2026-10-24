import type { Project, Scene, TransitionType } from '../types';
import type { SceneSpec } from '../scene/spec';
import type { Beat } from '../data/mkultraScript';
import { projectHook, sceneBeats } from '../data/projectText';
import { SOURCES } from '../data/sources';
import { STUDIO_VOICES } from '../audio/studioVoices';
import { IMAGE_STYLES, imageStatus } from './localImage';
import { loadClipIndex } from '../media/clips';
import type { Timeline } from '../animation/timeline';
import { toAuthored } from '../editor/model';
import type { AiFrame } from './frames';

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
  /** New narration (the studio voice records the new sentences), or null to keep it. */
  narration?: string | null;
  /** Other scene fields to change. */
  fields?: Partial<Pick<Scene, 'title' | 'summary' | 'transition' | 'chapterCard' | 'keywords' | 'sourceIds'>> | null;
}

/** A scene Claude adds (whole-video edits). */
export interface AiNewScene {
  ref: string;
  title: string;
  summary: string;
  narration: string;
  duration: number;
  transition: TransitionType;
  spec: SceneSpec;
  beats: Beat[];
}

/** A picture Claude asks the local image model for; specs refer to it as "new:<key>". */
export interface AiImage {
  key: string;
  prompt: string;
  style: string;
  aspect: string;
}

export interface AiResult {
  summary: string;
  scenes: AiSceneChange[];
  newScenes?: AiNewScene[];
  /** Final scene order (current indices and new-scene refs); scenes left out are deleted. */
  order?: (number | string)[] | null;
  /** Episode changes: episodeTitle, episodeSubtitle, hook, settings, sources_add. */
  episode?: Record<string, unknown> | null;
  images?: AiImage[];
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
export async function editWithClaude(
  project: Project,
  target: AiTarget,
  prompt: string,
  signal?: AbortSignal,
  timeline?: Timeline,
  extra?: {
    /** Rendered frames of the scenes in scope (Claude looks at them). */
    frames?: AiFrame[];
    /** A check of an edit Claude just made: the original instruction and its summary; frames show the result. */
    review?: { request: string; summary: string };
  },
): Promise<AiResult> {
  const lang = project.settings.language;
  // A one-scene edit still sends its neighbours' narration, so Claude knows the story around it.
  const scenes = project.scenes.map((s, index) => ({
    index,
    title: s.title,
    summary: s.summary,
    narration: s.narration,
    transition: s.transition,
    chapterCard: s.chapterCard,
    keywords: s.keywords,
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
  // Every source of the episode (Claude may attach them to scenes); the MKUltra episode uses data/sources.ts.
  const sources = (project.template === 'mkultra' ? SOURCES : (project.sources ?? [])).map((s) => ({
    id: s.id,
    title: s.title,
    publisher: s.publisher,
    date: s.date,
    claims: s.claims,
  }));
  const st = project.settings;
  const images = await imageStatus();
  const body = {
    prompt,
    target,
    episode: {
      title: project.episodeTitle,
      subtitle: project.episodeSubtitle,
      language: lang,
      aspect: st.aspect,
      template: project.template,
      hook: projectHook(project, lang),
      settings: {
        filmGrain: st.filmGrain,
        music: st.music,
        musicVolume: st.musicVolume,
        chapterCards: st.chapterCards,
        shortHook: st.shortHook,
        characterStyle: st.characterStyle,
        narrationMode: st.narrationMode,
        speechRate: st.speechRate,
        studioVoice: st.studioVoice?.[lang] ?? STUDIO_VOICES[lang][0]?.id,
        subtitles: st.subtitles,
      },
      voices: STUDIO_VOICES[lang].map((v) => ({ id: v.id, label: v.label })),
      images: images.available,
      imageStyles: IMAGE_STYLES,
    },
    scenes,
    sources,
    media: (project.media ?? []).map((m) => ({ id: m.id, name: m.name, prompt: m.prompt ?? '', width: m.width, height: m.height })),
    clips: (await loadClipIndex()).map((c) => ({ id: c.id, label: c.label, frames: c.frames, fps: c.fps, duration: c.duration })),
    frames: extra?.frames?.map((f) => ({ scene: f.scene, at: f.at, label: f.label, data: f.data })),
    review: extra?.review ?? null,
  };
  const r = await fetch('/api/claude/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as AiResult;
}
