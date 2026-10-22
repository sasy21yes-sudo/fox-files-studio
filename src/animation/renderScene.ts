import type { Project, SceneId, Subtitle, SubtitleStyle } from '../types';
import { applyFilm } from '../effects/filmGrain';
import { setFoxStyle } from '../character/AgentFox';
import { cueViseme } from './lipSync';
import { CHAPTER_LEN, drawChapterCard, drawGate, gateWeave } from '../effects/cartoon';
import { TRANSITION_IN, TRANSITION_OUT, applyTransition } from '../effects/transitions';
import { lerp } from './math';
import { FONT_SANS, type SceneRenderer, type Stage } from './stage';
import { choreoTime, cueAt, locate, type Timeline } from './timeline';
import { sceneFile } from './scenes/sceneFile';
import { sceneQuestion } from './scenes/sceneQuestion';
import { sceneExperiments } from './scenes/sceneExperiments';
import { sceneCost } from './scenes/sceneCost';
import { sceneRevelation } from './scenes/sceneRevelation';
import { sceneKnown } from './scenes/sceneKnown';
import { renderHook } from './scenes/hook';
import { renderBeats } from '../effects/beats';
import { renderSpec } from '../scene/renderSpec';
import { localizeContext, setLabelLang } from '../i18n/labels';

export const SCENE_RENDERERS: Record<SceneId, SceneRenderer> = {
  file: sceneFile,
  question: sceneQuestion,
  experiments: sceneExperiments,
  cost: sceneCost,
  revelation: sceneRevelation,
  known: sceneKnown,
};

export interface RenderOptions {
  filmGrain: boolean;
  subtitles: SubtitleStyle;
  /** Draw subtitles into the frame (preview and export both burn them in). */
  burnSubtitles: boolean;
  /** Preview-only overlay showing the subtitle safe area. Never exported. */
  showSafeArea?: boolean;
}

/** Final iris-out length at the very end of the episode. */
const ENDING_IRIS = 1.3;

/**
 * Render one frame of the episode at global time `time`.
 * This single function is used by the preview player, the scene thumbnails
 * and both export pipelines, so what you preview is what you export.
 */
export function renderFrame(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  project: Project,
  tl: Timeline,
  time: number,
  opts: RenderOptions,
): void {
  time = Number.isFinite(time) ? Math.max(0, time) : 0;
  setFoxStyle(project.settings.characterStyle === 'vector' ? 'vector' : 'painted');
  setLabelLang(tl.lang);
  localizeContext(g);

  // The Short's cold-open hook has its own kinetic captions.
  if (tl.hook && time < tl.hook.end) {
    const u0 = Math.min(w, h) / 1080;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#050302';
    g.fillRect(0, 0, w, h);
    g.restore();
    g.save();
    const weave = gateWeave(time, u0);
    g.translate(weave.x, weave.y);
    renderHook(g, w, h, tl, time);
    g.restore();
    applyFilm(g, w, h, time, { grain: opts.filmGrain, sepia: 0.6, gloom: 0 });
    drawGate(g, w, h, u0);
    if (opts.showSafeArea) drawSafeArea(g, w, h);
    return;
  }

  const { span, local } = locate(tl, time);
  const vertical = h > w;
  const u = Math.min(w, h) / 1080;
  const cue = cueAt(tl, time);

  const stage: Stage = {
    g,
    w,
    h,
    u,
    vertical,
    t: local,
    k: choreoTime(span, local),
    dur: span.duration,
    authored: span.scene.authoredDuration,
    time,
    speaking: !!cue && cue.sceneIndex === span.index,
    // Hold each mouth shape for at least two film frames (12 changes per second max).
    viseme: cueViseme(tl, cue, time),
    project,
  };

  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#050302';
  g.fillRect(0, 0, w, h);
  g.restore();

  // Projector gate weave: the whole picture jumps a hair every film frame.
  const weave = gateWeave(time, u);
  g.save();
  g.translate(weave.x, weave.y);
  const out = span.scene.spec ? renderSpec(span.scene.spec, stage) : SCENE_RENDERERS[span.scene.id](stage);
  g.restore();

  // Explainer pop-ups synced to the narration.
  renderBeats(g, w, h, tl, span.index, time);

  // Chapter intertitle (or a plain transition) at the start of each scene.
  const chapters = project.settings.chapterCards !== false;
  if (chapters && local < CHAPTER_LEN) {
    drawChapterCard(g, w, h, u, local, time, span.index + 1, span.scene.title, span.index === 0);
  } else if (!chapters && local < TRANSITION_IN) {
    applyTransition(g, w, h, span.scene.transition, local / TRANSITION_IN, out.focus, true);
  }
  const next = tl.spans[span.index + 1];
  const remaining = span.duration - local;
  if (next && remaining < TRANSITION_OUT) {
    applyTransition(g, w, h, next.scene.transition, remaining / TRANSITION_OUT, out.focus, false);
  } else if (!next && remaining < ENDING_IRIS) {
    applyTransition(g, w, h, 'iris', remaining / ENDING_IRIS, out.focus, false);
  }

  const onCard = chapters && local < CHAPTER_LEN * 0.65;
  applyFilm(g, w, h, time, { grain: opts.filmGrain, sepia: onCard ? 1 : out.sepia ?? 1, gloom: onCard ? 0 : out.gloom ?? 0 });
  drawGate(g, w, h, u);

  if (opts.burnSubtitles && opts.subtitles.enabled && cue) {
    drawSubtitle(g, w, h, cue, project.scenes[cue.sceneIndex]?.keywords ?? [], opts.subtitles);
  }
  if (opts.showSafeArea) drawSafeArea(g, w, h);
}

// ------------------------------------------------------------ Subtitles

export interface SafeArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Title-safe margins. Vertical video reserves extra room at the bottom and
 * right, where social apps overlay captions and buttons.
 */
export function safeArea(w: number, h: number): SafeArea {
  if (h > w) return { left: w * 0.07, right: w * 0.13, top: h * 0.12, bottom: h * 0.2 };
  return { left: w * 0.06, right: w * 0.06, top: h * 0.07, bottom: h * 0.07 };
}

/** Character ranges of the cue text that match any keyword (case-insensitive). */
export function keywordMask(text: string, keywords: string[]): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  const lower = text.toLowerCase();
  for (const raw of keywords) {
    const kw = raw.trim().toLowerCase();
    if (!kw) continue;
    let i = lower.indexOf(kw);
    while (i >= 0) {
      for (let j = i; j < i + kw.length; j++) mask[j] = true;
      i = lower.indexOf(kw, i + kw.length);
    }
  }
  return mask;
}

export function drawSubtitle(g: CanvasRenderingContext2D, w: number, h: number, cue: Subtitle, keywords: string[], style: SubtitleStyle) {
  const vertical = h > w;
  const u = Math.min(w, h) / 1080;
  const safe = safeArea(w, h);
  const size = (vertical ? 50 : 44) * u * style.fontScale;
  const maxWidth = w - safe.left - safe.right;
  const mask = style.highlightKeywords ? keywordMask(cue.text, keywords) : [];

  g.save();
  g.font = `600 ${size}px ${FONT_SANS}`;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';

  // Tokenise with character offsets so highlighting survives wrapping.
  const tokens: { text: string; hi: boolean; width: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cue.text))) {
    const hi = mask.slice(m.index, m.index + m[0].length).some(Boolean);
    tokens.push({ text: m[0], hi, width: g.measureText(m[0]).width });
  }
  const space = g.measureText(' ').width;
  const lines: (typeof tokens)[] = [];
  let line: typeof tokens = [];
  let lw = 0;
  for (const tk of tokens) {
    const add = (line.length ? space : 0) + tk.width;
    if (line.length && lw + add > maxWidth) {
      lines.push(line);
      line = [tk];
      lw = tk.width;
    } else {
      line.push(tk);
      lw += add;
    }
  }
  if (line.length) lines.push(line);

  const lineH = size * 1.28;
  const blockH = lines.length * lineH;
  const lowest = h - safe.bottom;
  const highest = safe.top + blockH + h * 0.05;
  const bottom = lerp(lowest, highest, Math.min(1, Math.max(0, style.position)));
  const top = bottom - blockH;
  const centerX = safe.left + maxWidth / 2;

  lines.forEach((ln, i) => {
    const width = ln.reduce((a, t, j) => a + t.width + (j ? space : 0), 0);
    const x0 = centerX - width / 2;
    const yBase = top + (i + 1) * lineH - size * 0.3;
    // Backing plate.
    const padX = size * 0.4;
    g.fillStyle = 'rgba(12, 8, 5, 0.72)';
    g.beginPath();
    g.roundRect(x0 - padX, yBase - size * 1.02, width + padX * 2, size * 1.3, size * 0.18);
    g.fill();
    let x = x0;
    ln.forEach((tk, j) => {
      if (j) x += space;
      g.lineWidth = size * 0.12;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.lineJoin = 'round';
      g.strokeText(tk.text, x, yBase);
      g.fillStyle = tk.hi ? '#f0b85c' : '#f3ead6';
      g.fillText(tk.text, x, yBase);
      if (tk.hi) {
        g.fillStyle = 'rgba(240, 184, 92, 0.85)';
        g.fillRect(x, yBase + size * 0.12, tk.width, Math.max(1, size * 0.06));
      }
      x += tk.width;
    });
  });
  g.restore();
}

function drawSafeArea(g: CanvasRenderingContext2D, w: number, h: number) {
  const s = safeArea(w, h);
  g.save();
  g.setLineDash([10, 8]);
  g.lineWidth = Math.max(1, Math.min(w, h) / 400);
  g.strokeStyle = 'rgba(120, 220, 255, 0.85)';
  g.strokeRect(s.left, s.top, w - s.left - s.right, h - s.top - s.bottom);
  g.fillStyle = 'rgba(120, 220, 255, 0.12)';
  g.fillRect(0, h - s.bottom, w, s.bottom);
  g.setLineDash([]);
  g.font = `${Math.max(10, Math.min(w, h) / 40)}px ${FONT_SANS}`;
  g.fillStyle = 'rgba(160, 230, 255, 0.95)';
  g.fillText('SAFE AREA (preview only)', s.left + 6, s.top + Math.min(w, h) / 30);
  g.restore();
}
