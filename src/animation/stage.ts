import type { Project } from '../types';
import type { MouthShape } from '../character/AgentFox';
import { tr } from '../i18n/labels';

export const FONT_TITLE = '"Playfair Display", "Didot", "Bodoni 72", Georgia, "Times New Roman", serif';
export const FONT_TYPE = '"Special Elite", "American Typewriter", "Courier New", Courier, monospace';
export const FONT_SANS = '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif';

/**
 * Filled by the renderer when the editor asks (preview only): where each
 * element of a data scene landed, so the preview can draw handles on it.
 * Points are world (pre-camera) pixels; `matrix` maps them to canvas pixels.
 */
export interface RenderProbe {
  scene: number;
  matrix: DOMMatrix | null;
  /** Transform of screen-layer elements (no camera). */
  screen?: DOMMatrix | null;
  anchors: { id: string; x: number; y: number; box?: { w: number; h: number; rot: number }; screen?: boolean }[];
}

/** Everything a scene needs to draw one frame. */
export interface Stage {
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Layout unit: 1 unit = 1px at 1080 on the short side. */
  u: number;
  vertical: boolean;
  /** Real seconds since the scene started. */
  t: number;
  /** Choreography seconds (time-stretched to the authored duration). */
  k: number;
  dur: number;
  authored: number;
  /** Global seconds since the start of the episode. */
  time: number;
  /** True while a narration cue is active, used for lip-sync. */
  speaking: boolean;
  /** Mouth shape for the letter being narrated right now (text-driven lip-sync). */
  viseme?: MouthShape;
  project: Project;
  probe?: RenderProbe;
}

export interface SceneOutput {
  /** Where the iris transition centres. */
  focus: { x: number; y: number };
  /** Extra darkening applied by the film pass. */
  gloom?: number;
  sepia?: number;
}

export type SceneRenderer = (s: Stage) => SceneOutput;

/** Apply a camera move around the frame centre, run `draw`, then restore. */
export function withCamera(s: Stage, zoom: number, panX: number, panY: number, draw: () => void) {
  const { g, w, h, u } = s;
  g.save();
  g.translate(w / 2, h / 2);
  g.scale(zoom, zoom);
  g.translate(-w / 2 + panX * u, -h / 2 + panY * u);
  draw();
  g.restore();
}

/** Word-wrap text to a maximum width using the current font. */
export function wrapText(g: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = tr(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
