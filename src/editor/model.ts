import type { MediaItem, Project, Scene } from '../types';
import type { SceneSpan } from '../animation/timeline';
import type { FoxElement, Key, SceneElement, SceneSpec, ShotSpec } from '../scene/spec';
import { newScene, renumber } from '../data/project';
import { pictureSpec } from '../data/specs';

/** What the inspector is showing. Scene-level items are addressed by scene index. */
export type Selection =
  | { kind: 'scene'; scene: number }
  | { kind: 'element'; scene: number; id: string }
  | { kind: 'shot'; scene: number; index: number }
  | { kind: 'action'; scene: number; index: number }
  | { kind: 'key'; scene: number; track: FoxTrack; index: number }
  | { kind: 'beat'; scene: number; index: number };

/** Keyed tracks of Agent Fox shown on the timeline. */
export type FoxTrack = 'armFront' | 'armBack' | 'look' | 'mouth' | 'eyes' | 'view' | `face.${string}`;

// ------------------------------------------------------------------ time mapping

/** Authored choreography seconds → global timeline seconds. */
export const toGlobal = (span: SceneSpan, k: number) => span.start + (k * span.duration) / Math.max(1e-6, span.scene.authoredDuration);
/** Global timeline seconds → authored seconds of that scene. */
export const toAuthored = (span: SceneSpan, t: number) => ((t - span.start) * span.scene.authoredDuration) / Math.max(1e-6, span.duration);

// ------------------------------------------------------------------ immutable edits

export function updateScene(p: Project, index: number, patch: Partial<Scene> | ((s: Scene) => Partial<Scene>)): Project {
  return { ...p, scenes: p.scenes.map((s, i) => (i === index ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)) };
}

export function updateSpec(p: Project, index: number, fn: (spec: SceneSpec) => SceneSpec): Project {
  return updateScene(p, index, (s) => (s.spec ? { spec: fn(s.spec) } : {}));
}

export function updateElement(p: Project, index: number, id: string, fn: (el: SceneElement) => SceneElement): Project {
  return updateSpec(p, index, (spec) => ({ ...spec, elements: spec.elements.map((e) => (e.id === id ? fn(e) : e)) }));
}

export function updateFox(p: Project, index: number, fn: (fox: FoxElement) => FoxElement): Project {
  return updateSpec(p, index, (spec) => ({ ...spec, elements: spec.elements.map((e) => (e.type === 'fox' ? fn(e as FoxElement) : e)) }));
}

export function updateShot(p: Project, index: number, shot: number, patch: Partial<ShotSpec> | null): Project {
  return updateSpec(p, index, (spec) => {
    const camera = patch === null ? spec.camera.filter((_, i) => i !== shot) : spec.camera.map((s, i) => (i === shot ? { ...s, ...patch } : s));
    return { ...spec, camera: [...camera].sort((a, b) => a.at - b.at) };
  });
}

export const foxOf = (spec: SceneSpec | undefined): FoxElement | undefined => spec?.elements.find((e): e is FoxElement => e.type === 'fox');

/** Read a keyed fox track by name. */
export function foxTrack(fox: FoxElement, track: FoxTrack): Key<unknown>[] {
  if (track.startsWith('face.')) return (fox.face?.[track.slice(5)] ?? []) as Key<unknown>[];
  return ((fox as unknown as Record<string, unknown>)[track] as Key<unknown>[] | undefined) ?? [];
}

/** Write a keyed fox track (keys kept sorted by time). */
export function setFoxTrack(fox: FoxElement, track: FoxTrack, keys: Key<unknown>[]): FoxElement {
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  if (track.startsWith('face.')) return { ...fox, face: { ...(fox.face ?? {}), [track.slice(5)]: sorted as Key<number>[] } };
  return { ...fox, [track]: sorted } as FoxElement;
}

// ------------------------------------------------------------------ scenes

export function insertScene(p: Project, at: number, scene: Scene): Project {
  const scenes = [...p.scenes];
  scenes.splice(at, 0, scene);
  return { ...p, scenes: renumber(scenes) };
}

export function deleteScene(p: Project, index: number): Project {
  if (p.scenes.length <= 1) return p;
  return { ...p, scenes: renumber(p.scenes.filter((_, i) => i !== index)) };
}

export function moveScene(p: Project, from: number, to: number): Project {
  if (from === to || to < 0 || to >= p.scenes.length) return p;
  const scenes = [...p.scenes];
  const [s] = scenes.splice(from, 1);
  scenes.splice(to, 0, s);
  return { ...p, scenes: renumber(scenes) };
}

const rid = () => Math.random().toString(36).slice(2, 6);

export function duplicateScene(p: Project, index: number): Project {
  const s = p.scenes[index];
  return insertScene(p, index + 1, { ...structuredClone(s), id: `scene-${rid()}${rid()}`, title: `${s.title} (copy)` });
}

/** A unique element id inside a spec ("lamp", "lamp-2", ...). */
export function uniqueId(spec: SceneSpec, base: string): string {
  const ids = new Set(spec.elements.map((e) => e.id));
  if (!ids.has(base)) return base;
  for (let i = 2; ; i++) if (!ids.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** A cutaway scene made of one library image (inserted after `after`). */
export function insertPictureScene(p: Project, after: number, item: MediaItem): Project {
  const scene = { ...newScene(item.name), duration: 6, authoredDuration: 6, transition: 'fade' as const, chapterCard: false, spec: pictureSpec(item.id) };
  return insertScene(p, after + 1, scene);
}

/** A full-frame picture inside a data scene, from authored time `k` for 3 s, fading in, in front of everything. */
export function addPictureElement(p: Project, scene: number, k: number, item: MediaItem): { project: Project; id: string } {
  const spec = p.scenes[scene]?.spec;
  if (!spec) return { project: p, id: '' };
  const id = uniqueId(spec, 'picture');
  const len = p.scenes[scene].authoredDuration;
  const from = Math.max(0, Math.min(len - 0.5, Math.round(k * 100) / 100));
  const el: SceneElement = {
    id,
    type: 'picture',
    label: item.name,
    x: 0.5,
    y: 0.5,
    from: from || undefined,
    to: Math.min(len, from + 3) >= len ? undefined : Math.min(len, from + 3),
    enter: { kind: 'fade', at: from, dur: 0.4 },
    params: { media: item.id, zoomFrom: 1, zoomTo: 1.1, layer: 'screen' },
  };
  return { project: updateSpec(p, scene, (sp) => ({ ...sp, elements: [...sp.elements, el] })), id };
}
