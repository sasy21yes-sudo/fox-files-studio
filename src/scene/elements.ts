import {
  drawCapitolSketch,
  drawChair,
  drawCorkboard,
  drawDesk,
  drawFolder,
  drawHangingBulb,
  drawLabWall,
  drawLamp,
  drawPaper,
  drawPuff,
  drawRain,
  drawReelRecorder,
  drawRoom,
  drawShelf,
  drawStamp,
  drawVial,
} from '../animation/props';
import { drawMotes, drawMug, drawWallClock } from '../effects/cartoon';
import type { ElementType, Num } from './spec';
import { num } from './tracks';

/** What an element's draw function gets: the resolved frame state and its own placement. */
export interface ElCtx {
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  u: number;
  vertical: boolean;
  /** Choreography seconds. */
  k: number;
  /** Global seconds (weather, sway, flicker). */
  time: number;
  /** Scene light 0..1. */
  light: number;
  /** World position in px. */
  x: number;
  y: number;
  scale: number;
  rot: number;
  params: Record<string, unknown>;
}

/** Numeric parameter (plain or per format). */
export const pn = (c: ElCtx, name: string, fallback: number): number => num(c.params[name] as Num | undefined, c.vertical, fallback);
const ps = (c: ElCtx, name: string, fallback: string): string => (typeof c.params[name] === 'string' ? (c.params[name] as string) : fallback);

export interface ParamInfo {
  desc: string;
  default: unknown;
}

export interface ElementDef {
  label: string;
  category: 'set' | 'prop' | 'effect' | 'character';
  /** One line for the editor's library and for Claude. */
  description: string;
  params: Record<string, ParamInfo>;
  /** Point the element rests on (beat bounce and landing squash pivot). */
  base?(c: ElCtx): { x: number; y: number };
  /** Point shots and looks aim at. */
  focus?(c: ElCtx): { x: number; y: number };
  draw(c: ElCtx): void;
}

const FRAC = '(frame fraction, or {h,v})';
const U = '(layout units, or {h,v})';

/** Folder centre: it lies on the surface at y. */
const folderCentre = (c: ElCtx) => ({ x: c.x, y: c.y - (pn(c, 'h', 165) * c.u) / 2 + 4 * c.u });

export const ELEMENTS: Record<Exclude<ElementType, 'fox'>, ElementDef> = {
  room: {
    label: 'Office room',
    category: 'set',
    description: "Detective's office backdrop: wall, floor, a window with venetian blinds (moonlight stripes, optional rain). Draw it first.",
    params: {
      floorY: { desc: `floor line ${FRAC}`, default: { h: 0.79, v: 0.58 } },
      winX: { desc: `window left ${FRAC}`, default: { h: 0.63, v: 0.56 } },
      winY: { desc: `window top ${FRAC}`, default: { h: 0.08, v: 0.2 } },
      winW: { desc: `window width ${FRAC}`, default: { h: 0.23, v: 0.34 } },
      winH: { desc: `window height ${FRAC}`, default: { h: 0.34, v: 0.2 } },
      blinds: { desc: 'blinds closed 0..1', default: 0.25 },
      lightBase: { desc: 'room light with the scene light off', default: 0.25 },
      lightGain: { desc: 'extra room light with the scene light on', default: 0.3 },
      rain: { desc: 'rain on the window 0..1', default: 0 },
      cool: { desc: 'cold (blue) tint 0..1', default: 0 },
    },
    draw(c) {
      const { g, w, h, u } = c;
      drawRoom(g, w, h, u, {
        light: pn(c, 'lightBase', 0.25) + c.light * pn(c, 'lightGain', 0.3),
        blinds: pn(c, 'blinds', 0.25),
        floorY: pn(c, 'floorY', c.vertical ? 0.58 : 0.79) * h,
        windowX: pn(c, 'winX', c.vertical ? 0.56 : 0.63) * w,
        windowY: pn(c, 'winY', c.vertical ? 0.2 : 0.08) * h,
        windowW: pn(c, 'winW', c.vertical ? 0.34 : 0.23) * w,
        windowH: pn(c, 'winH', c.vertical ? 0.2 : 0.34) * h,
        rain: pn(c, 'rain', 0) || undefined,
        cool: pn(c, 'cool', 0) || undefined,
        time: c.time,
      });
    },
  },
  labWall: {
    label: 'Lab wall',
    category: 'set',
    description: '1950s laboratory backdrop: white tiled wall and floor. Draw it first.',
    params: { floorY: { desc: `floor line ${FRAC}`, default: { h: 0.79, v: 0.58 } } },
    draw(c) {
      drawLabWall(c.g, c.w, c.h, c.u, pn(c, 'floorY', c.vertical ? 0.58 : 0.79) * c.h, c.light);
    },
  },
  motes: {
    label: 'Dust motes',
    category: 'effect',
    description: 'Dust floating in a beam of light; x,y is the top-left of the area.',
    params: {
      w: { desc: `area width ${FRAC}`, default: 0.5 },
      h: { desc: `area height ${FRAC}`, default: 0.6 },
      amtBase: { desc: 'amount with the light off', default: 0.4 },
      amtGain: { desc: 'extra amount with the light on', default: 0.6 },
    },
    draw(c) {
      drawMotes(c.g, c.x, c.y, pn(c, 'w', 0.5) * c.w, pn(c, 'h', 0.6) * c.h, c.u, c.time, pn(c, 'amtBase', 0.4) + c.light * pn(c, 'amtGain', 0.6));
    },
  },
  rain: {
    label: 'Rain',
    category: 'effect',
    description: 'Rain streaks inside an area (e.g. a window); x,y is the top-left.',
    params: { w: { desc: `width ${FRAC}`, default: 0.2 }, h: { desc: `height ${FRAC}`, default: 0.3 }, amount: { desc: '0..1', default: 1 } },
    draw(c) {
      drawRain(c.g, c.x, c.y, pn(c, 'w', 0.2) * c.w, pn(c, 'h', 0.3) * c.h, c.u, c.time, pn(c, 'amount', 1));
    },
  },
  wallClock: {
    label: 'Wall clock',
    category: 'prop',
    description: 'Round wall clock with ticking hands.',
    params: {},
    draw(c) {
      drawWallClock(c.g, c.x, c.y, c.u * c.scale, c.time);
    },
  },
  desk: {
    label: 'Desk',
    category: 'prop',
    description: "Heavy wooden desk; x,y is the top-left of the desk top, other props sit on y.",
    params: { w: { desc: `width ${FRAC}`, default: { h: 0.36, v: 0.5 } }, h: { desc: `height ${FRAC}`, default: { h: 0.27, v: 0.19 } } },
    draw(c) {
      drawDesk(c.g, c.x, c.y, pn(c, 'w', 0.36) * c.w, pn(c, 'h', 0.27) * c.h, c.u);
    },
  },
  lamp: {
    label: 'Desk lamp',
    category: 'prop',
    description: "Green banker's lamp standing on y; it glows with the scene light.",
    params: { flipped: { desc: 'mirror it', default: false } },
    draw(c) {
      drawLamp(c.g, c.x, c.y, c.u * c.scale, c.light, c.params.flipped === true);
    },
  },
  mug: {
    label: 'Coffee mug',
    category: 'prop',
    description: 'Steaming coffee mug standing on y.',
    params: {},
    draw(c) {
      drawMug(c.g, c.x, c.y, c.u * c.scale, c.time);
    },
  },
  chair: {
    label: 'Wooden chair',
    category: 'prop',
    description: 'An empty wooden chair standing on y.',
    params: {},
    draw(c) {
      drawChair(c.g, c.x, c.y, c.u * c.scale);
    },
  },
  hangingBulb: {
    label: 'Hanging bulb',
    category: 'prop',
    description: 'A bare bulb hanging from the ceiling at x; y is the ceiling, it glows with the scene light.',
    params: { length: { desc: `cord length ${FRAC}`, default: 0.3 } },
    draw(c) {
      drawHangingBulb(c.g, c.x, c.y, pn(c, 'length', 0.3) * c.h, c.u * c.scale, c.time, c.light);
    },
  },
  folder: {
    label: 'Case folder',
    category: 'prop',
    description: 'Manila case folder lying on the surface at y, with a label on the cover.',
    params: {
      w: { desc: `width ${U}`, default: { h: 230, v: 250 } },
      h: { desc: `height ${U}`, default: { h: 165, v: 180 } },
      label: { desc: 'cover label (translated on screen)', default: 'MKULTRA' },
      cover: { desc: 'cover closed 1 / open 0', default: 1 },
    },
    base: (c) => ({ x: c.x, y: c.y + 4 * c.u }),
    focus: folderCentre,
    draw(c) {
      const ctr = folderCentre(c);
      drawFolder(c.g, ctr.x, ctr.y, pn(c, 'w', 230) * c.u * c.scale, pn(c, 'h', 165) * c.u * c.scale, c.rot, pn(c, 'cover', 1), c.u, ps(c, 'label', 'MKULTRA'));
    },
  },
  paper: {
    label: 'Typed page',
    category: 'prop',
    description: 'A typed document page (heading, lines, optional redaction or burnt edges), centred on x,y.',
    params: {
      w: { desc: `width ${U}`, default: 260 },
      h: { desc: `height ${U}`, default: 340 },
      heading: { desc: 'heading text', default: '' },
      lines: { desc: 'number of typed lines', default: 8 },
      redact: { desc: 'black redaction bars', default: false },
      burnt: { desc: 'burnt edges 0..1', default: 0 },
      seed: { desc: 'layout seed', default: 1 },
    },
    draw(c) {
      drawPaper(c.g, c.x, c.y, pn(c, 'w', 260) * c.u * c.scale, pn(c, 'h', 340) * c.u * c.scale, c.rot, c.u, {
        heading: ps(c, 'heading', '') || undefined,
        lines: pn(c, 'lines', 8),
        redact: c.params.redact === true,
        burnt: pn(c, 'burnt', 0),
        seed: pn(c, 'seed', 1),
      });
    },
  },
  shelf: {
    label: 'Shelf',
    category: 'prop',
    description: 'A wall shelf with bottles and boxes; x,y is its left end.',
    params: { width: { desc: `width ${FRAC}`, default: 0.3 }, seed: { desc: 'contents seed', default: 1 } },
    draw(c) {
      drawShelf(c.g, c.x, c.y, pn(c, 'width', 0.3) * c.w, c.u * c.scale, pn(c, 'seed', 1));
    },
  },
  vial: {
    label: 'Lab vial',
    category: 'prop',
    description: 'A glass vial with glowing liquid standing on y.',
    params: { glow: { desc: '0..1', default: 0.6 }, label: { desc: 'label text', default: '' } },
    draw(c) {
      drawVial(c.g, c.x, c.y, c.u * c.scale, c.time, pn(c, 'glow', 0.6), ps(c, 'label', '') || undefined);
    },
  },
  reelRecorder: {
    label: 'Reel-to-reel recorder',
    category: 'prop',
    description: 'A reel-to-reel tape recorder standing on y; the reels spin.',
    params: { spin: { desc: 'reel speed', default: 1 } },
    draw(c) {
      drawReelRecorder(c.g, c.x, c.y, c.u * c.scale, c.time, pn(c, 'spin', 1));
    },
  },
  corkboard: {
    label: 'Corkboard',
    category: 'prop',
    description: 'An evidence corkboard; x,y is its top-left.',
    params: { w: { desc: `width ${FRAC}`, default: 0.4 }, h: { desc: `height ${FRAC}`, default: 0.4 } },
    draw(c) {
      drawCorkboard(c.g, c.x, c.y, pn(c, 'w', 0.4) * c.w, pn(c, 'h', 0.4) * c.h, c.u);
    },
  },
  capitolSketch: {
    label: 'Capitol sketch',
    category: 'prop',
    description: 'A framed ink sketch of the Capitol dome, centred on x,y.',
    params: {},
    draw(c) {
      drawCapitolSketch(c.g, c.x, c.y, c.scale, c.u);
    },
  },
  puff: {
    label: 'Dust puff',
    category: 'effect',
    description: 'A puff of dust when something lands, at x,y.',
    params: { at: { desc: 'start (authored s)', default: 0 }, len: { desc: 'length (s)', default: 1.1 }, seed: { desc: 'shape seed', default: 11 } },
    draw(c) {
      const at = pn(c, 'at', 0);
      const len = pn(c, 'len', 1.1);
      drawPuff(c.g, c.x, c.y, c.u, Math.min(1, Math.max(0, (c.k - at) / Math.max(1e-6, len))), pn(c, 'seed', 11));
    },
  },
  stamp: {
    label: 'Rubber stamp mark',
    category: 'effect',
    description: 'A rubber-stamp word slammed onto the frame (e.g. CLASSIFIED), centred on x,y.',
    params: {
      text: { desc: 'stamped word (translated on screen)', default: 'CLASSIFIED' },
      size: { desc: `size ${U}`, default: 90 },
      at: { desc: 'slam time (authored s)', default: 0 },
      color: { desc: 'ink colour', default: '#9b2f1f' },
    },
    draw(c) {
      const p = Math.min(1, Math.max(0, (c.k - pn(c, 'at', 0)) / 0.35));
      if (p <= 0) return;
      drawStamp(c.g, ps(c, 'text', 'CLASSIFIED'), c.x, c.y, pn(c, 'size', 90) * c.u * c.scale, c.rot || -0.12, p, ps(c, 'color', '#9b2f1f'));
    },
  },
};

export const FOX_DEF = {
  label: 'Agent Fox',
  category: 'character' as const,
  description:
    'The narrator-detective. x is his feet (frame fraction), y the ground line; acting is keyed: xTrack (walks), actions (walk, skid, take, pop, sparkle, sweat, hop), armFront/armBack poses, look, face values, mouth, eyes.',
};

export const ARM_MODES = ['rest', 'point', 'magnify', 'notebook', 'pencil', 'hold', 'hips', 'tiphat', 'hatChest', 'chin', 'shield', 'scratch', 'wave'] as const;
export const FACE_KEYS = ['brows', 'worry', 'skeptic', 'angry', 'headTilt', 'earDroop', 'hatLift', 'lids', 'sweat', 'sparkle'] as const;
export const MOUTHS = ['', 'closed', 'smile', 'grin', 'frown', 'open', 'wide', 'o'] as const;

