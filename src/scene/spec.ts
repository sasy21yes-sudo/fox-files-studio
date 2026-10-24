import type { SfxCue } from '../audio/sfx';
/**
 * Scene documents: a scene described as data instead of code, so the editor
 * timeline, the inspector and Claude can all read and change it.
 *
 * Conventions (shared with the hand-coded scenes in animation/scenes/):
 * - Times are choreography seconds ("authored" time, `k`), stretched to the
 *   scene's real duration like every other scene.
 * - Positions are fractions of the frame (0..1) in the WIDE composition
 *   ("world" coordinates, before the camera). Sizes in `u` are layout units:
 *   1 u = 1 px at 1080 on the short side.
 * - Any number marked `Num` may differ between 16:9 and 9:16: either a plain
 *   number or `{ h, v }` (horizontal / vertical value).
 * - Tracks follow the hold-then-transition rule of `track()`/`armTrack()`: a
 *   value holds until a key's `at`, then moves to the key's value over `dur`
 *   seconds with `ease` (dur 0 = a cut).
 */

export type Num = number | { h: number; v: number };

/** A named curve, or a cubic Bézier [x1, y1, x2, y2] like After Effects' speed graph / CSS (y may overshoot). */
export type Ease = 'linear' | 'smooth' | 'in' | 'out' | 'inOut' | 'back' | 'bounce' | 'hold' | [number, number, number, number];

export interface Key<T> {
  at: number;
  value: T;
  /** Transition length into this value; 0 or missing = instant (for scalars: `defaultDur` of the track). */
  dur?: number;
  ease?: Ease;
}

/** A keyframed value. A plain value means constant. */
export type Track<T> = T | Key<T>[];

export interface Point {
  x: Num;
  y: Num;
}

// ------------------------------------------------------------------ elements

/** Drawing blocks available to a scene, from animation/props.ts and effects/cartoon.ts. */
export type ElementType =
  | 'room'
  | 'labWall'
  | 'motes'
  | 'rain'
  | 'wallClock'
  | 'desk'
  | 'lamp'
  | 'mug'
  | 'chair'
  | 'hangingBulb'
  | 'folder'
  | 'paper'
  | 'shelf'
  | 'vial'
  | 'reelRecorder'
  | 'corkboard'
  | 'capitolSketch'
  | 'puff'
  | 'stamp'
  | 'picture'
  | 'text'
  | 'null'
  | 'sprite'
  | 'fox';

export type EnterKind = 'none' | 'drop' | 'pop' | 'fade' | 'slideLeft' | 'slideRight';

export interface Enter {
  kind: EnterKind;
  at: number;
  dur: number;
}

export interface ElementBase {
  id: string;
  type: ElementType;
  /** Shown in the editor ("Desk lamp"). */
  label?: string;
  x: Num;
  y: Num;
  /** Extra scale on top of the element's natural size. */
  scale?: Num;
  /** Seconds (authored) the element appears / disappears. */
  from?: number;
  to?: number;
  enter?: Enter;
  /** Hop on the score's beat (beatBounce): amount and phase. Starts after the enter animation. */
  bounce?: { amt: number; phase: number };
  /** Element-specific parameters (see scene/elements.ts for each type). */
  params?: Record<string, unknown>;
  /** Animated offsets in frame fractions, rotation in radians, opacity 0..1. */
  dx?: Track<number>;
  dy?: Track<number>;
  rot?: Track<number>;
  opacity?: Track<number>;
  /** Hidden in the editor (kept in the document). */
  hidden?: boolean;

  // ---- After Effects-style layer features (scene/layers.ts) ----
  /** Follows another element's animated move, turn, scale and wiggle (AE parenting); a 'null' element is an invisible parent. */
  parent?: string;
  /** Animated scale multiplier on top of `scale` (AE Scale keyframes), around the element's position. */
  scaleBy?: Track<number>;
  /** Deterministic jitter (AE wiggle(freq, amp)): x, y in frame fractions, rot in radians, scale as a fraction. */
  wiggle?: Wiggle;
  /** Loop the element's own keyed values every `every` authored seconds from `from` (AE loopOut cycle / pingpong). */
  repeat?: { every: number; from?: number; mode?: 'cycle' | 'pingpong' };
  /** How the element mixes with what is under it (AE blending modes). */
  blend?: BlendMode;
  /** Effects, applied in order (AE effects stack). */
  fx?: Effect[];
  /** Shown only through another element (AE track matte). */
  matte?: { source: string; mode?: MatteMode };
  /** Used only as another element's matte: not drawn by itself. */
  isMatte?: boolean;
  /** Shape mask (AE mask): a closed path of world points (frame fractions), softened by `feather` (u). */
  mask?: { points: Point[]; feather?: number; invert?: boolean; expand?: number };
  /** Motion blur (AE): the element averaged over `shutter` authored seconds before each frame, in `samples` steps. */
  motionBlur?: { shutter?: number; samples?: number };
}

export interface Wiggle {
  /** Wiggles per second. */
  freq: number;
  x?: number;
  y?: number;
  rot?: number;
  scale?: number;
  seed?: number;
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'add'
  | 'colorDodge'
  | 'colorBurn'
  | 'hardLight'
  | 'softLight'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type MatteMode = 'alpha' | 'alphaInverted' | 'luma' | 'lumaInverted';

/** One effect. Number fields may be keyed (tracks). Sizes in u, colours as CSS colours. */
export type Effect =
  | { type: 'blur'; amount: Track<number> }
  | { type: 'glow'; radius: Track<number>; intensity?: Track<number>; color?: string }
  | { type: 'shadow'; x?: Track<number>; y?: Track<number>; blur?: Track<number>; color?: string; opacity?: Track<number> }
  | {
      type: 'color';
      brightness?: Track<number>;
      contrast?: Track<number>;
      saturation?: Track<number>;
      hue?: Track<number>;
      sepia?: Track<number>;
      grayscale?: Track<number>;
      invert?: Track<number>;
    }
  | { type: 'tint'; color: string; amount?: Track<number> }
  | { type: 'stroke'; width: Track<number>; color?: string }
  | { type: 'opacityFlicker'; amount: Track<number>; freq?: number };

// ------------------------------------------------------------------ Agent Fox

export type FoxActionKind = 'walk' | 'skid' | 'take' | 'pop' | 'sparkle' | 'sweat' | 'hop';

/** A timed piece of acting. Actions add up on top of the fox's keyed values. */
export interface FoxAction {
  kind: FoxActionKind;
  at: number;
  /** walk: length of the walk; others: length of the pulse. */
  len: number;
  /** walk: steps per second; pop: '!' | '?' | '!?'. */
  cadence?: number;
  symbol?: '!' | '?' | '!?';
}

export type LookTarget = { x: number; y: number } | { target: string };

export interface FoxElement extends ElementBase {
  type: 'fox';
  /** Horizontal position over time (frame fraction). Overrides `x` when present. */
  xTrack?: Key<Num>[];
  actions?: FoxAction[];
  armFront?: Key<string>[];
  armBack?: Key<string>[];
  /** Where the pointing arm aims (world point or an element id). */
  pointAt?: Point | { target: string };
  look?: Key<LookTarget>[];
  /** Keyed scalar acting values: brows, worry, skeptic, angry, headTilt, earDroop, hatLift, lids, ... */
  face?: Record<string, Key<number>[]>;
  /** Mouth override while not speaking ('grin', 'smile', 'frown', ...). Use '' for none. */
  mouth?: Key<string>[];
  eyes?: Key<'open' | 'happy'>[];
  facing?: 1 | -1;
  /** Camera-facing talk: 'front' draws the waist-up front view (a cut, no turn), 'side' the usual 3/4 figure. */
  view?: Key<'side' | 'front'>[];
}

export type SceneElement = ElementBase | FoxElement;

// ------------------------------------------------------------------ camera

export type ShotKind = 'wide' | 'medium' | 'close' | 'extreme' | 'insert';

export interface ShotSpec {
  at: number;
  kind: ShotKind;
  /** 'fox', an element id, or a world point. Wide shots ignore it. */
  target?: string | Point;
  enter?: 'cut' | 'push' | 'whip';
  /** Where the target lands on screen (0..1). */
  sx?: Num;
  sy?: Num;
  /** Number or {h, v}: one zoom per format (a 9:16 insert often needs less to keep the character whole). */
  zoom?: Num;
  drift?: number;
  locked?: boolean;
  /** For fox shots: frame the fox at this x instead of where he is at `at`. */
  foxX?: Num;
}

// ------------------------------------------------------------------ screen overlays

export interface TitleOverlay {
  kind: 'title';
  at: number;
  /** When the subtitle line starts writing on. */
  subAt: number;
  y: Num;
  maxWidth: Num;
  sunburst?: boolean;
  /** Defaults to the project's episode title / subtitle. */
  title?: string;
  subtitle?: string;
}

export type Overlay = TitleOverlay;

// ------------------------------------------------------------------ the scene

export interface SceneSpec {
  version: 1;
  /** Scene light 0..1 (rooms, lamps, motes and the film gloom follow it). */
  light?: { keys: Key<number>[]; flicker?: { from: number; to: number } };
  /** Impact shakes: times (authored s) and strength in u. */
  shake?: { times: number[]; strength: number };
  elements: SceneElement[];
  camera: ShotSpec[];
  overlays?: Overlay[];
  /** Iris focus: the screen centre until `foxFrom`, then Agent Fox's head. */
  focus?: { foxFrom: number };
  sepia?: number;
  /** Film darkening when the light is off. */
  gloom?: number;
  /** Sound effects (authored s): audio/sfx.ts synthesises them, mixed in the preview and the export. */
  sfx?: SfxCue[];
}
