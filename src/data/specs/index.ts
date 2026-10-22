import type { SceneSpec } from '../../scene/spec';
import { FILE_SPEC } from './file';

/** Hand-coded scenes that also exist as data (scene/spec.ts), by scene id. */
export const SPECS: Record<string, SceneSpec> = {
  file: FILE_SPEC,
};

/** Drawn for a scene with neither a spec nor a hand-coded renderer. */
export const EMPTY_SPEC: SceneSpec = {
  version: 1,
  elements: [{ id: 'room', type: 'room', x: 0, y: 0 }],
  camera: [{ at: 0, kind: 'wide' }],
};

/**
 * A new scene: the office at night, Agent Fox beside the desk looking at the
 * viewer, a wide shot then a slow push to a medium shot. Meant to be edited
 * (by hand or by prompt).
 */
export function starterSpec(): SceneSpec {
  return {
    version: 1,
    light: { keys: [{ at: 0, value: 1 }] },
    focus: { foxFrom: 0 },
    sepia: 1,
    gloom: 0.12,
    elements: [
      { id: 'room', type: 'room', label: 'Office', x: 0, y: 0, params: { blinds: 0.25 } },
      { id: 'motes', type: 'motes', x: { h: 0.33, v: 0.26 }, y: { h: 0.08, v: 0.2 } },
      { id: 'clock', type: 'wallClock', x: { h: 0.43, v: 0.18 }, y: { h: 0.16, v: 0.23 }, scale: { h: 0.95, v: 0.9 } },
      { id: 'desk', type: 'desk', x: { h: 0.5, v: 0.56 }, y: { h: 0.63, v: 0.53 } },
      { id: 'lamp', type: 'lamp', x: { h: 0.788, v: 0.96 }, y: { h: 0.63, v: 0.53 }, scale: { h: 1, v: 0.85 }, bounce: { amt: 0.7, phase: 0.3 } },
      { id: 'mug', type: 'mug', x: { h: 0.5468, v: 0.62 }, y: { h: 0.63, v: 0.53 }, scale: { h: 1, v: 0.9 } },
      {
        id: 'fox',
        type: 'fox',
        label: 'Agent Fox',
        x: { h: 0.25, v: 0.29 },
        y: { h: 0.915, v: 0.72 },
        scale: { h: 1.1, v: 1.36 },
        look: [{ at: 0, value: { x: 0.3, y: 0.1 } }],
        face: { brows: [{ at: 0, value: 0.2 }] },
        armFront: [{ at: 0, value: 'rest' }, { at: 2.0, value: 'chin' }],
        armBack: [{ at: 0, value: 'rest' }],
      },
    ],
    camera: [
      { at: 0, kind: 'wide' },
      { at: 3.0, kind: 'medium', enter: 'push' },
    ],
  };
}

/**
 * A cutaway made of one library image: full frame, a slow Ken Burns push and
 * drift over the whole scene, camera locked so only the picture moves.
 */
export function pictureSpec(media: string): SceneSpec {
  return {
    version: 1,
    sepia: 0.7,
    elements: [
      { id: 'picture', type: 'picture', label: 'Picture', x: 0.5, y: 0.5, params: { media, zoomFrom: 1.02, zoomTo: 1.14, panX: 0.03, panY: -0.01 } },
    ],
    camera: [{ at: 0, kind: 'wide', locked: true, drift: 0 }],
  };
}
