import type { SceneSpec } from '../../scene/spec';

/**
 * Scene 1 — THE FILE, as data. A one-to-one port of animation/scenes/sceneFile.ts
 * (numbers from scenes/layout.ts, landscape / vertical): the lamp flickers on,
 * Agent Fox struts in and skids, the folder drops, double take, insert on the
 * folder, whip to the title slam.
 */
export const FILE_SPEC: SceneSpec = {
  version: 1,
  light: { keys: [{ at: 0, value: 0 }, { at: 1.9, value: 1, dur: 0 }], flicker: { from: 1.1, to: 1.9 } },
  shake: { times: [4.2, 6.0], strength: 16 },
  focus: { foxFrom: 1.2 },
  sepia: 1,
  gloom: 0.12,
  elements: [
    {
      id: 'room',
      type: 'room',
      label: 'Office',
      x: 0,
      y: 0,
      params: {
        floorY: { h: 0.79, v: 0.58 },
        winX: { h: 0.63, v: 0.56 },
        winY: { h: 0.08, v: 0.2 },
        winW: { h: 0.23, v: 0.34 },
        winH: { h: 0.34, v: 0.2 },
        blinds: 0.25,
        lightBase: 0.25,
        lightGain: 0.3,
      },
    },
    { id: 'motes', type: 'motes', x: { h: 0.33, v: 0.26 }, y: { h: 0.08, v: 0.2 }, params: { w: 0.5, h: 0.6, amtBase: 0.4, amtGain: 0.6 } },
    { id: 'clock', type: 'wallClock', x: { h: 0.43, v: 0.18 }, y: { h: 0.16, v: 0.23 }, scale: { h: 0.95, v: 0.9 } },
    { id: 'desk', type: 'desk', x: { h: 0.5, v: 0.56 }, y: { h: 0.63, v: 0.53 }, params: { w: { h: 0.36, v: 0.5 }, h: { h: 0.27, v: 0.19 } } },
    { id: 'lamp', type: 'lamp', x: { h: 0.788, v: 0.96 }, y: { h: 0.63, v: 0.53 }, scale: { h: 1, v: 0.85 }, bounce: { amt: 0.7, phase: 0.3 } },
    { id: 'mug', type: 'mug', x: { h: 0.5468, v: 0.62 }, y: { h: 0.63, v: 0.53 }, scale: { h: 1, v: 0.9 } },
    {
      id: 'folder',
      type: 'folder',
      label: 'MKULTRA folder',
      x: { h: 0.644, v: 0.74 },
      y: { h: 0.63, v: 0.53 },
      rot: -0.05,
      enter: { kind: 'drop', at: 3.7, dur: 0.55 },
      bounce: { amt: 0.6, phase: 0.6 },
      params: { w: { h: 230, v: 250 }, h: { h: 165, v: 180 }, label: 'MKULTRA' },
    },
    { id: 'puff', type: 'puff', x: { h: 0.644, v: 0.74 }, y: { h: 0.63, v: 0.53 }, params: { at: 4.2, len: 1.1, seed: 11 } },
    {
      id: 'fox',
      type: 'fox',
      label: 'Agent Fox',
      x: { h: 0.25, v: 0.29 },
      y: { h: 0.915, v: 0.72 },
      scale: { h: 1.1, v: 1.36 },
      xTrack: [
        { at: 0, value: -0.25 },
        { at: 0.9, value: { h: 0.21, v: 0.2468 }, dur: 1.785, ease: 'linear' },
        { at: 2.685, value: { h: 0.25, v: 0.29 }, dur: 0.315, ease: 'out' },
      ],
      actions: [
        { kind: 'walk', at: 0.9, len: 1.806, cadence: 1.7 },
        { kind: 'skid', at: 2.85, len: 0.7 },
        { kind: 'take', at: 4.25, len: 0.8 },
        { kind: 'pop', at: 4.25, len: 1.2, symbol: '!?' },
      ],
      look: [
        { at: 0, value: { x: 0.8, y: 0 } },
        { at: 3.0, value: { x: 0.6, y: 0.2 } },
        { at: 4.0, value: { target: 'folder' } },
      ],
      face: {
        brows: [{ at: 0, value: 0 }, { at: 5.4, value: 0.35 }, { at: 7.6, value: 0.6 }],
        skeptic: [{ at: 0, value: 0 }, { at: 4.9, value: 0.8, dur: 0 }, { at: 5.9, value: 0, dur: 0 }],
        sparkle: [{ at: 0, value: 0 }, { at: 6.0, value: 1, dur: 0.3, ease: 'linear' }, { at: 7.4, value: 0, dur: 0.6, ease: 'linear' }],
      },
      mouth: [{ at: 6.3, value: 'grin' }],
      eyes: [{ at: 0, value: 'open' }, { at: 7.9, value: 'happy' }, { at: 8.5, value: 'open' }],
      armFront: [{ at: 0, value: 'rest' }, { at: 2.9, value: 'stop' }, { at: 4.55, value: 'one' }, { at: 4.95, value: 'magnify' }, { at: 5.8, value: 'point' }, { at: 6.7, value: 'chin' }, { at: 7.6, value: 'hips' }],
      armBack: [{ at: 0, value: 'rest' }, { at: 7.4, value: 'hips' }],
      pointAt: { x: 0.5, y: { h: 0.2, v: 0.15 } },
    },
  ],
  camera: [
    { at: 0, kind: 'wide' },
    { at: 2.8, kind: 'medium', foxX: { h: 0.25, v: 0.29 }, sx: { h: 0.4, v: 0.5 } },
    { at: 3.55, kind: 'wide' },
    { at: 4.22, kind: 'close', sx: { h: 0.45, v: 0.5 }, enter: 'push' },
    { at: 5.0, kind: 'insert', target: 'folder', sy: { h: 0.55, v: 0.5 } },
    { at: 5.85, kind: 'wide', enter: 'whip', locked: true },
    { at: 7.5, kind: 'medium', sx: { h: 0.35, v: 0.5 }, sy: { h: 0.68, v: 0.52 }, enter: 'push' },
  ],
  overlays: [{ kind: 'title', at: 5.95, subAt: 6.8, y: { h: 0.2, v: 0.15 }, maxWidth: { h: 0.8, v: 0.86 }, sunburst: true }],
};
