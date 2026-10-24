import type { Project } from '../types';
import { bumpMedia } from './store';

/**
 * Frame-by-frame animation clips ("sprite" elements): full drawings played one after another, Cuphead
 * style, next to the puppet rig. Built offline by tools/clips/build_clip.py into public/clips/<id>/:
 *   clip.json  frames (rects in the atlas + their offset in the clip's common canvas), timing, anchor
 *   atlas.webp every frame, trimmed, packed
 * The frames are registered offline (every frame already sits where it belongs in the common canvas),
 * so playing a clip is copying rectangles to fixed places: nothing at runtime can make a frame drift.
 */

export interface ClipFrame {
  /** Rect in the atlas (px). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where that rect sits in the clip's common canvas (px). */
  ox: number;
  oy: number;
  /** How many ticks of 1/fps this drawing stays on screen (1 = on ones, 2 = on twos). */
  hold: number;
}

export interface Clip {
  version: 1;
  id: string;
  label: string;
  /** Ticks per second (24 = cinema; a drawing held 2 ticks is "on twos"). */
  fps: number;
  /** Common canvas size (px) and the point of it placed on the element's x, y (e.g. between the feet). */
  width: number;
  height: number;
  anchor: [number, number];
  /** Canvas px that make 1 u on screen at scale 1 (the canvas height is the character's drawn height). */
  pxPerU: number;
  loop: 'once' | 'loop' | 'pingpong';
  frames: ClipFrame[];
  atlas: string;
  /** What the build measured: the worst registration error left (px of the source drawings). */
  report?: { maxError: number; meanError: number; source: string };
}

export interface ClipInfo {
  id: string;
  label: string;
  frames: number;
  fps: number;
  /** Seconds of one pass (all holds). */
  duration: number;
}

const base = 'clips/';
const loaded = new Map<string, { clip: Clip; atlas: ImageBitmap | HTMLImageElement }>();
const pending = new Map<string, Promise<void>>();
let index: ClipInfo[] | null = null;
let indexPromise: Promise<ClipInfo[]> | null = null;

/** Every clip in the library (public/clips/index.json). */
export function loadClipIndex(): Promise<ClipInfo[]> {
  indexPromise ??= fetch(`${base}index.json`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
    .then((j: ClipInfo[]) => (index = Array.isArray(j) ? j : []));
  return indexPromise;
}
export const clipIndex = (): ClipInfo[] => index ?? [];

/** The clip, or undefined while it loads (the renderer draws a placeholder meanwhile). */
export function getClip(id: string): { clip: Clip; atlas: ImageBitmap | HTMLImageElement } | undefined {
  const c = loaded.get(id);
  if (!c) void loadClip(id);
  return c;
}

export function loadClip(id: string): Promise<void> {
  if (!id || loaded.has(id)) return Promise.resolve();
  let p = pending.get(id);
  if (!p) {
    p = (async () => {
      const clip = (await (await fetch(`${base}${id}/clip.json`, { cache: 'no-store' })).json()) as Clip;
      const blob = await (await fetch(`${base}${id}/${clip.atlas}`)).blob();
      const atlas = typeof createImageBitmap === 'function' ? await createImageBitmap(blob) : await blobImage(blob);
      loaded.set(id, { clip, atlas });
      bumpMedia();
    })()
      .catch(() => undefined)
      .finally(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}

function blobImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(blob);
  });
}

/** Load every clip the project's scenes use (before rendering frames for output). */
export async function loadProjectClips(project: Project): Promise<void> {
  const ids = new Set<string>();
  for (const s of project.scenes)
    for (const el of s.spec?.elements ?? []) if (el.type === 'sprite' && typeof el.params?.clip === 'string') ids.add(el.params.clip as string);
  await Promise.all([...ids].map(loadClip));
}

/**
 * Which drawing shows at `t` seconds into the clip. Ticks are counted exactly (integer arithmetic on a
 * rounded tick number), so a frame boundary never wobbles between two renders of the same time.
 */
export function clipFrameAt(clip: Clip, t: number, loop: Clip['loop'] = clip.loop): number {
  const ticks = clip.frames.reduce((a, f) => a + Math.max(1, f.hold), 0);
  let tick = Math.floor(t * clip.fps + 1e-6);
  if (tick < 0) return 0;
  if (loop === 'once') tick = Math.min(tick, ticks - 1);
  else if (loop === 'loop') tick = tick % ticks;
  else {
    const period = Math.max(1, 2 * ticks - 2);
    tick = tick % period;
    if (tick >= ticks) tick = period - tick;
  }
  let acc = 0;
  for (let i = 0; i < clip.frames.length; i++) {
    acc += Math.max(1, clip.frames[i].hold);
    if (tick < acc) return i;
  }
  return clip.frames.length - 1;
}

export const clipDuration = (clip: Clip) => clip.frames.reduce((a, f) => a + Math.max(1, f.hold), 0) / clip.fps;
