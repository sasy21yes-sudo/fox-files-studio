import { drawFox, type ArmMode, type FoxPose, type MouthShape } from '../character/AgentFox';
import { TAU, clamp, easeOut, easeOutBounce, hash, seg } from '../animation/math';
import { drawTitle } from '../animation/props';
import { beatBounce, drawSunburst, elastic, impactShake } from '../effects/cartoon';
import { camToScreen, drawWhip, framing, resolveCam, withShot, type Shot } from '../animation/camera';
import type { SceneOutput, Stage } from '../animation/stage';
import type { Layout } from '../animation/scenes/layout';
import { lookAt, pointAt, pulse } from '../animation/scenes/helpers';
import { ELEMENTS, type ElCtx } from './elements';
import type { ElementBase, FoxElement, Key, LookTarget, SceneElement, SceneSpec, ShotSpec, TitleOverlay } from './spec';
import { evalBlend, evalNum, evalStep, num } from './tracks';

/** Scene light 0..1 at `k` (with an optional flickering stretch, as the lamp in scene 1). */
export function sceneLight(spec: SceneSpec, k: number): number {
  const L = spec.light;
  if (!L) return 1;
  if (L.flicker && k >= L.flicker.from && k < L.flicker.to) return hash(Math.floor(k * 16)) > 0.4 ? 1 : 0.1;
  return evalNum(L.keys, k, false, { dur: 0, ease: 'linear' }, 1);
}

/** Resting placement of an element (no enter animation), as its draw context. */
function placeElement(el: ElementBase, s: Stage, light: number): ElCtx {
  const { g, w, h, u, k, vertical: V } = s;
  return {
    g,
    w,
    h,
    u,
    vertical: V,
    k,
    time: s.time,
    light,
    x: (num(el.x, V) + evalNum(el.dx, k, V, undefined, 0)) * w,
    y: (num(el.y, V) + evalNum(el.dy, k, V, undefined, 0)) * h,
    scale: num(el.scale, V, 1),
    rot: evalNum(el.rot, k, V, undefined, 0),
    params: el.params ?? {},
    from: el.from ?? 0,
    to: el.to ?? s.authored,
  };
}

const isFox = (el: SceneElement): el is FoxElement => el.type === 'fox';

interface FoxPlace {
  x: number;
  y: number;
  S: number;
  L: Layout;
}

function foxPlace(fox: FoxElement, s: Stage, k = s.k): FoxPlace {
  const { w, h, u, vertical: V } = s;
  const x = (fox.xTrack?.length ? evalNum(fox.xTrack, k, V, { dur: 0, ease: 'linear' }) : num(fox.x, V)) * w;
  const y = num(fox.y, V) * h;
  const S = num(fox.scale, V, 1) * u;
  // The scene helpers (lookAt, pointAt) only read the fox fields of a Layout.
  return { x, y, S, L: { foxX: x, foxY: y, foxS: S } as Layout };
}

/** World point of a target: an element's focus point, 'fox' (his head) or a frame point. */
function targetPoint(spec: SceneSpec, s: Stage, light: number, target: string | { x: unknown; y: unknown }): { x: number; y: number } | null {
  if (typeof target !== 'string') {
    return { x: num(target.x as number, s.vertical) * s.w, y: num(target.y as number, s.vertical) * s.h };
  }
  const el = spec.elements.find((e) => e.id === target);
  if (!el) return null;
  if (isFox(el)) {
    const f = foxPlace(el, s);
    return { x: f.x + 14 * f.S, y: f.y - 392 * f.S };
  }
  const c = placeElement(el, s, light);
  const def = ELEMENTS[el.type as keyof typeof ELEMENTS];
  return def?.focus ? def.focus(c) : { x: c.x, y: c.y };
}

function toShot(spec: SceneSpec, s: Stage, light: number, shot: ShotSpec, fox: FoxElement | undefined): Shot {
  const { w, h, vertical: V } = s;
  const base = { at: shot.at, enter: shot.enter, locked: shot.locked };
  if (shot.kind === 'wide') return { ...base, zoom: shot.zoom ?? 1, ax: w / 2, ay: h / 2, drift: shot.drift ?? 0.01 };
  const target = shot.target ?? 'fox';
  if (target === 'fox' && fox) {
    // Same framing as animation/scenes/helpers.ts foxShot().
    const f = foxPlace(fox, s, shot.at);
    const fx = shot.foxX !== undefined ? num(shot.foxX, V) * w : f.x;
    const face = shot.kind !== 'medium';
    return {
      ...base,
      zoom: shot.zoom ?? framing(s, shot.kind),
      ax: fx + (face ? 70 : 40) * f.S,
      ay: f.y - (face ? 400 : 330) * f.S,
      sx: num(shot.sx, V, V ? 0.5 : 0.36),
      sy: num(shot.sy, V, V ? (face ? 0.56 : 0.52) : face ? 0.5 : 0.48),
      drift: shot.drift ?? 0.015,
    };
  }
  const p = targetPoint(spec, s, light, target) ?? { x: w / 2, y: h / 2 };
  return {
    ...base,
    zoom: shot.zoom ?? framing(s, shot.kind),
    ax: p.x,
    ay: p.y,
    sx: num(shot.sx, V, 0.5),
    sy: num(shot.sy, V, 0.5),
    drift: shot.drift ?? 0.02,
  };
}

let measureCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
/** Draw something alone on a transparent copy of the frame and return its pixel bbox (canvas px). */
function measureDraw(g: CanvasRenderingContext2D, draw: (o: CanvasRenderingContext2D) => void): [number, number, number, number] | undefined {
  const W = g.canvas.width;
  const H = g.canvas.height;
  if (!measureCanvas || measureCanvas.width !== W || measureCanvas.height !== H) {
    measureCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  }
  const o = measureCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!o) return undefined;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.clearRect(0, 0, W, H);
  o.setTransform(g.getTransform());
  draw(o);
  const d = o.getImageData(0, 0, W, H).data;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y += 2) {
    const row = y * W * 4;
    for (let x = 0; x < W; x += 2) {
      if (d[row + x * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? undefined : [x0, y0, x1 + 2, y1 + 2];
}

function drawElement(s: Stage, light: number, el: ElementBase) {
  const def = ELEMENTS[el.type as keyof typeof ELEMENTS];
  if (!def) return;
  const { g, w, h, k } = s;
  const c = placeElement(el, s, light);
  if (s.probe) {
    const bbox = s.probe.measure ? measureDraw(s.g, (o) => drawElement({ ...s, g: o, probe: undefined }, light, el)) : undefined;
    s.probe.anchors.push({ id: el.id, x: c.x, y: c.y, box: def.bounds?.(c), bbox });
  }
  const base = def.base ? def.base(c) : { x: c.x, y: c.y };
  const enter = el.enter && el.enter.kind !== 'none' ? el.enter : null;
  const p = enter ? seg(k, enter.at, enter.dur) : 1;
  if (enter && p <= 0) return;
  const opacity = clamp(evalNum(el.opacity, k, s.vertical, undefined, 1));
  if (opacity <= 0) return;

  g.save();
  if (opacity < 1) g.globalAlpha *= opacity;
  if (enter) {
    switch (enter.kind) {
      case 'drop': {
        // Falls in from above the frame, bounces, squashes on landing (scene 1's folder).
        const e = easeOutBounce(p);
        const land = pulse(k, enter.at + enter.dur - 0.05, 0.35);
        g.translate(base.x, base.y);
        g.scale(1 + land * 0.18, 1 - land * 0.22);
        g.translate(-base.x, -base.y);
        const restY = def.focus ? def.focus(c).y : c.y;
        c.rot += (1 - e) * 0.85;
        if (p >= 1 && el.bounce) beatBounce(g, base.x, base.y, s.time, el.bounce.amt, el.bounce.phase);
        g.translate(0, (1 - e) * (-0.4 * h - restY));
        break;
      }
      case 'pop': {
        const e = elastic(p);
        g.translate(base.x, base.y);
        g.scale(Math.max(0.001, e), Math.max(0.001, e));
        g.translate(-base.x, -base.y);
        break;
      }
      case 'fade':
        g.globalAlpha *= p;
        break;
      case 'slideLeft':
      case 'slideRight': {
        const dir = enter.kind === 'slideLeft' ? -1 : 1;
        g.translate(dir * (1 - easeOut(p)) * 0.6 * w, 0);
        break;
      }
    }
    if (enter.kind !== 'drop' && p >= 1 && el.bounce) beatBounce(g, base.x, base.y, s.time, el.bounce.amt, el.bounce.phase);
  } else if (el.bounce) {
    beatBounce(g, base.x, base.y, s.time, el.bounce.amt, el.bounce.phase);
  }
  if (c.rot && !NATIVE_ROT.has(el.type)) {
    // Elements whose drawing ignores rotation turn around their base point here.
    g.translate(base.x, base.y);
    g.rotate(c.rot);
    g.translate(-base.x, -base.y);
    def.draw({ ...c, rot: 0 });
  } else def.draw(c);
  g.restore();
}

/** Element types that apply `rot` themselves (folder, paper, stamp, picture). */
const NATIVE_ROT = new Set(['folder', 'paper', 'stamp', 'picture']);

function foxPose(spec: SceneSpec, s: Stage, light: number, fox: FoxElement, place: FoxPlace): FoxPose {
  const { k, vertical: V } = s;
  const acts = fox.actions ?? [];
  let walking = 0;
  let cadence = 1.7;
  let skid = 0;
  let take = 0;
  let hop = 0;
  let sweat = 0;
  let sparkle = 0;
  for (const a of acts) {
    if (a.kind === 'walk' && k > a.at && k < a.at + a.len) {
      walking = 1;
      cadence = a.cadence ?? 1.7;
    } else if (a.kind === 'skid') skid += pulse(k, a.at, a.len);
    else if (a.kind === 'take') take += pulse(k, a.at, a.len);
    else if (a.kind === 'hop') hop += pulse(k, a.at, a.len);
    else if (a.kind === 'sweat') sweat += pulse(k, a.at, a.len);
    else if (a.kind === 'sparkle') sparkle += pulse(k, a.at, a.len);
  }
  // '!' / '?' symbol pops, like popAt(): the first one running wins.
  const pop = acts.reduce<FoxPose['pop']>(
    (cur, a) => cur ?? (a.kind === 'pop' && k >= a.at && k < a.at + a.len ? { symbol: a.symbol ?? '!', p: (k - a.at) / a.len } : null),
    null,
  );

  const v = evalStep<LookTarget | null>(fox.look, k, null);
  let look: Partial<FoxPose> = {};
  if (v) {
    if ('target' in v) {
      const p = targetPoint(spec, s, light, v.target);
      if (p) look = lookAt(place.L, p.x, p.y, place.x);
    } else look = { lookX: v.x, lookY: v.y };
  }

  const face: Partial<FoxPose> = {};
  for (const [name, keys] of Object.entries(fox.face ?? {})) {
    (face as Record<string, number>)[name] = evalNum(keys, k, V);
  }
  if (sparkle) face.sparkle = (face.sparkle ?? 0) + sparkle;
  if (sweat) face.sweat = (face.sweat ?? 0) + sweat;

  const front = evalBlend(fox.armFront as Key<ArmMode>[] | undefined, k, 'rest');
  const back = evalBlend(fox.armBack as Key<ArmMode>[] | undefined, k, 'rest');
  let pointAngle: number | undefined;
  if (fox.pointAt) {
    const p = 'target' in fox.pointAt ? targetPoint(spec, s, light, fox.pointAt.target) : targetPoint(spec, s, light, fox.pointAt);
    if (p) pointAngle = pointAt(place.L, p.x, p.y, place.x);
  }
  const mouth = evalStep(fox.mouth, k, '');

  return {
    x: place.x,
    y: place.y,
    scale: place.S,
    facing: fox.facing,
    view: evalStep(fox.view, k, 'side'),
    time: s.time,
    walk: walking,
    walkPhase: k * TAU * cadence,
    speedLines: walking * 0.7 + skid * 0.6,
    skid,
    lean: walking * 0.12 - skid * 0.3 - take * 0.1,
    squash: skid * 0.12,
    jump: take * 46 + hop * 60,
    ...look,
    surprise: take,
    pop,
    ...face,
    speaking: s.speaking && take < 0.2,
    viseme: s.viseme,
    mouth: mouth && !s.speaking ? (mouth as MouthShape) : undefined,
    eyes: evalStep(fox.eyes, k, 'open'),
    armFront: front.to,
    armFrontFrom: front.from,
    armFrontBlend: front.p,
    armBack: back.to,
    armBackFrom: back.from,
    armBackBlend: back.p,
    pointAngle,
  };
}

function drawTitleOverlay(s: Stage, o: TitleOverlay) {
  const { g, w, h, u, k, vertical: V } = s;
  const y = num(o.y, V) * h;
  const tp = seg(k, o.at, 0.55);
  if (tp > 0 && o.sunburst !== false) {
    const r = (V ? 420 : 380) * u * elastic(tp);
    g.save();
    g.globalAlpha = 0.55 * clamp(tp * 3);
    g.beginPath();
    g.arc(w / 2, y + 20 * u, Math.max(1, r), 0, TAU);
    g.clip();
    drawSunburst(g, w / 2, y + 20 * u, r, s.time * 0.4, '#5a3315', '#8a5422', 20);
    g.restore();
  }
  drawTitle(g, w, y, u * (V ? 0.95 : 1), o.title ?? s.project.episodeTitle, o.subtitle ?? s.project.episodeSubtitle, tp, seg(k, o.subAt, 1.2), num(o.maxWidth, V) * w);
}

/** Draw one frame of a data scene. Same contract as the hand-coded scene renderers. */
export function renderSpec(spec: SceneSpec, s: Stage): SceneOutput {
  const { g, w, h, u, k } = s;
  const light = sceneLight(spec, k);
  if (spec.shake) {
    const sh = impactShake(k, spec.shake.times, spec.shake.strength);
    g.translate(sh.x * u, sh.y * u);
  }
  const fox = spec.elements.find(isFox);
  const place = fox ? foxPlace(fox, s) : null;
  const cam = resolveCam(
    s,
    (spec.camera.length ? spec.camera : [{ at: 0, kind: 'wide' as const }]).map((shot) => toShot(spec, s, light, shot, fox)),
  );

  const visible = (el: SceneElement) => !(el.hidden || (el.from !== undefined && k < el.from) || (el.to !== undefined && k >= el.to));
  const onScreen = (el: SceneElement) => el.params?.layer === 'screen';
  withShot(s, cam, () => {
    if (s.probe) s.probe.matrix = g.getTransform();
    for (const el of spec.elements) {
      if (!visible(el) || onScreen(el)) continue;
      if (isFox(el)) {
        const p = el === fox && place ? place : foxPlace(el, s);
        const pose = foxPose(spec, s, light, el, p);
        if (s.probe) s.probe.anchors.push({ id: el.id, x: p.x, y: p.y, bbox: s.probe.measure ? measureDraw(g, (o) => drawFox(o, pose)) : undefined });
        drawFox(g, pose);
      } else drawElement(s, light, el);
    }
  });
  drawWhip(s, cam);

  // Screen-layer elements (cutaway pictures): above the scene, outside the camera.
  if (s.probe) s.probe.screen = g.getTransform();
  const anchors = s.probe?.anchors.length ?? 0;
  for (const el of spec.elements) if (visible(el) && onScreen(el) && !isFox(el)) drawElement(s, light, el);
  if (s.probe) for (const a of s.probe.anchors.slice(anchors)) a.screen = true;

  for (const o of spec.overlays ?? []) if (o.kind === 'title') drawTitleOverlay(s, o);

  const centre = { x: w / 2, y: h * 0.45 };
  const focus =
    place && (!spec.focus || k >= spec.focus.foxFrom) ? camToScreen(s, cam, place.x + 14 * place.S, place.y - 392 * place.S) : centre;
  return { focus, gloom: (spec.gloom ?? 0) * (1 - light), sepia: spec.sepia ?? 1 };
}

