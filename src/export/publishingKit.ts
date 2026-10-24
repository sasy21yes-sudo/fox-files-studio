import type { Project } from '../types';
import { buildTimeline, formatTime, type Timeline, type VoiceTiming } from '../animation/timeline';
import { projectHook } from '../data/projectText';
import { SOURCES } from '../data/sources';
import { KIT_TEXT } from './publishingKitText';

/**
 * A plain-text publishing kit: title options, a factual description with
 * chapters computed from the real timeline, sources, tags, and the Short's
 * caption. Everything here is a starting point to edit, not a guarantee of reach
 * or monetization.
 */

const mmss = (t: number) => {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** YouTube chapters: first at 0:00, each at least 10 s (short scenes merge forward). */
export function youtubeChapters(tl: Timeline): string[] {
  const out: { start: number; end: number; title: string }[] = [];
  for (const span of tl.spans) {
    const last = out[out.length - 1];
    if (last && last.end - last.start < 10) {
      last.end = span.end;
      last.title = `${last.title} / ${span.scene.title}`;
    } else {
      out.push({ start: out.length ? span.start : 0, end: span.end, title: span.scene.title });
    }
  }
  const tail = out[out.length - 1];
  if (out.length > 1 && tail.end - tail.start < 10) {
    const prev = out[out.length - 2];
    prev.end = tail.end;
    prev.title = `${prev.title} / ${tail.title}`;
    out.pop();
  }
  return out.map((c) => `${mmss(c.start)} ${c.title}`);
}

export function buildPublishingKit(project: Project, voice?: VoiceTiming | null): string {
  const long = buildTimeline({ ...project, settings: { ...project.settings, aspect: '16:9' } }, undefined, voice);
  const short = buildTimeline({ ...project, settings: { ...project.settings, aspect: '9:16' } }, undefined, voice);
  const T = KIT_TEXT[project.settings.language ?? 'en'] ?? KIT_TEXT.en;
  const src = SOURCES.map((s) => `- ${s.title.split(' — ')[0]} (${s.date}): ${s.url}`).join('\n');
  const L: string[] = [];
  L.push(T.header);
  L.push(`${T.episode}: ${project.episodeTitle}`);
  L.push(T.editNote);
  L.push('');
  L.push('==================== YOUTUBE (16:9) ====================');
  L.push(`${T.length}: ${formatTime(long.total)}`);
  L.push('');
  L.push(T.titles);
  T.titleOptions.forEach((t, i) => L.push(`${i + 1}. ${t}`));
  L.push('');
  L.push(T.descriptionHead);
  L.push(T.description);
  L.push('');
  L.push(T.tagline);
  L.push('');
  L.push(T.chapters);
  L.push(...youtubeChapters(long));
  L.push('');
  L.push(T.sources);
  L.push(src);
  L.push('');
  L.push(T.disclaimer);
  L.push('');
  L.push(T.tagsHead);
  L.push(T.tags);
  L.push('');
  L.push('============ SHORT / REELS / TIKTOK (9:16) ============');
  L.push(`${T.length}: ${formatTime(short.total)} (${T.shortLength})`);
  L.push('');
  L.push(`${T.hook} (${short.hook ? short.hook.end.toFixed(1) : '0'} s)`);
  L.push(`"${projectHook(project, project.settings.language)?.text ?? ''}"`);
  L.push('');
  L.push(T.captionHead);
  L.push(T.caption);
  L.push('');
  L.push(T.hashtagsHead);
  L.push(T.hashtags);
  L.push('');
  L.push(T.pinned);
  L.push(`${T.source}: ${SOURCES[0].title.split(' — ')[0]}, ${SOURCES[0].date}: ${SOURCES[0].url}`);
  L.push('');
  L.push(`==================== ${T.before} ====================`);
  for (const c of T.checklist) L.push(`- ${c}`);
  return L.join('\n');
}
