import type { Project } from '../types';
import type { Timeline } from '../animation/timeline';
import { renderFrame } from '../animation/renderScene';
import { toAuthored } from '../editor/model';

/** A rendered frame Claude looks at: what the viewer sees at that moment (subtitles included). */
export interface AiFrame {
  /** Scene index. */
  scene: number;
  /** Authored second within the scene (the time base of the spec). */
  at: number;
  label: string;
  /** JPEG data URL. */
  data: string;
}

/** Longest side of a frame sent to Claude (px): enough to read pop-ups and subtitles (~300 tokens a frame). */
const FRAME_SIZE = 640;

/**
 * Frames of the given scenes, rendered by the same renderFrame as the preview and the export, so Claude
 * judges placement, overlaps and legibility on the real picture instead of numbers alone. `perScene` frames
 * spread over each scene (never on its first or last instant, which are transitions), capped at `max`.
 */
export function renderFramesForClaude(project: Project, tl: Timeline, scenes: number[], perScene: number, max = 24): AiFrame[] {
  const vertical = project.settings.aspect === '9:16';
  const w = vertical ? Math.round((FRAME_SIZE * 9) / 16) : FRAME_SIZE;
  const h = vertical ? FRAME_SIZE : Math.round((FRAME_SIZE * 9) / 16);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const out: AiFrame[] = [];
  const per = Math.max(1, Math.min(perScene, Math.floor(max / Math.max(1, scenes.length))));
  for (const i of scenes) {
    const span = tl.spans[i];
    if (!span) continue;
    for (let k = 0; k < per; k++) {
      const t = span.start + span.duration * ((k + 0.5) / per);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, w, h);
      renderFrame(g, w, h, project, tl, t, {
        filmGrain: false,
        subtitles: project.settings.subtitles,
        burnSubtitles: true,
      });
      const at = Math.round(toAuthored(span, t) * 100) / 100;
      out.push({ scene: i, at, label: `Scene ${i + 1} (index ${i}), authored ${at.toFixed(2)} s (video ${t.toFixed(1)} s)`, data: c.toDataURL('image/jpeg', 0.82) });
    }
  }
  return out;
}
