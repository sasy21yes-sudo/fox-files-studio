import { ARM_MODES, ELEMENTS, FACE_KEYS } from './elements';
import type { SceneSpec } from './spec';
import { SFX_SOUNDS, isSfxSound } from '../audio/sfx';
import { BLEND_MODES } from './layers';

const EASES = ['linear', 'smooth', 'in', 'out', 'inOut', 'back', 'bounce', 'hold'];
const FX_TYPES = ['blur', 'glow', 'shadow', 'color', 'tint', 'stroke', 'opacityFlicker'];

/**
 * Structural check of a scene document (from storage, an import or Claude).
 * Returns human-readable problems; an empty list means it can be rendered.
 */
export function validateSpec(raw: unknown): string[] {
  const errs: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const isNumOrHV = (v: unknown) => isNum(v) || (isObj(v) && isNum(v.h) && isNum(v.v));
  const keys = (v: unknown, path: string, value: (x: unknown) => boolean) => {
    if (v === undefined) return;
    if (!Array.isArray(v)) return errs.push(`${path}: must be a list of keys`);
    v.forEach((key, i) => {
      if (!isObj(key) || !isNum(key.at)) errs.push(`${path}[${i}]: needs a numeric "at"`);
      else if (!value(key.value)) errs.push(`${path}[${i}].value is not valid`);
      else if (key.ease !== undefined && !isEase(key.ease))
        errs.push(`${path}[${i}].ease must be one of ${EASES.join(', ')} or a Bézier [x1, y1, x2, y2] with x in 0..1`);
    });
  };

  const isEase = (e: unknown) =>
    (typeof e === 'string' && EASES.includes(e)) || (Array.isArray(e) && e.length === 4 && e.every(isNum) && e[0] >= 0 && e[0] <= 1 && e[2] >= 0 && e[2] <= 1);
  const numOrKeys = (v: unknown, path: string) => {
    if (v !== undefined && !isNum(v)) keys(v, path, isNum);
  };
  if (!isObj(raw)) return ['scene spec must be an object'];
  if (raw.version !== 1) errs.push('version must be 1');
  if (!Array.isArray(raw.elements)) errs.push('elements must be a list');
  if (!Array.isArray(raw.camera)) errs.push('camera must be a list');
  if (raw.sfx !== undefined) {
    if (!Array.isArray(raw.sfx)) errs.push('sfx must be a list');
    else
      raw.sfx.forEach((c, i) => {
        const p = `sfx[${i}]`;
        if (!isObj(c) || !isNum(c.at)) return errs.push(`${p}: needs a numeric "at"`);
        if (!isSfxSound(c.sound)) errs.push(`${p}: unknown sound "${String(c.sound)}" (one of ${Object.keys(SFX_SOUNDS).join(', ')})`);
        for (const f of ['gain', 'pan', 'count', 'every'] as const) if (c[f] !== undefined && !isNum(c[f])) errs.push(`${p}.${f} must be a number`);
      });
  }
  const ids = new Set<string>();
  (Array.isArray(raw.elements) ? raw.elements : []).forEach((el, i) => {
    const p = `elements[${i}]`;
    if (!isObj(el)) return errs.push(`${p}: must be an object`);
    if (typeof el.id !== 'string' || !el.id) errs.push(`${p}: needs an id`);
    else if (ids.has(el.id)) errs.push(`${p}: duplicate id "${el.id}"`);
    else ids.add(el.id);
    if (el.type !== 'fox' && !(typeof el.type === 'string' && el.type in ELEMENTS)) errs.push(`${p}: unknown type "${String(el.type)}"`);
    if (!isNumOrHV(el.x) || !isNumOrHV(el.y)) errs.push(`${p}: x and y must be numbers or {h,v}`);
    if (el.scale !== undefined && !isNumOrHV(el.scale)) errs.push(`${p}: bad scale`);
    if (el.enter !== undefined && !(isObj(el.enter) && typeof el.enter.kind === 'string' && isNum(el.enter.at) && isNum(el.enter.dur)))
      errs.push(`${p}: enter needs kind, at, dur`);
    for (const t of ['dx', 'dy', 'rot', 'opacity', 'scaleBy'] as const) numOrKeys(el[t], `${p}.${t}`);
    // After Effects-style layer features (scene/layers.ts).
    if (el.parent !== undefined && typeof el.parent !== 'string') errs.push(`${p}.parent must be an element id`);
    if (el.wiggle !== undefined && !(isObj(el.wiggle) && isNum(el.wiggle.freq) && ['x', 'y', 'rot', 'scale', 'seed'].every((f) => (el.wiggle as Record<string, unknown>)[f] === undefined || isNum((el.wiggle as Record<string, unknown>)[f]))))
      errs.push(`${p}.wiggle needs a numeric freq (and numeric x, y, rot, scale, seed)`);
    if (el.repeat !== undefined && !(isObj(el.repeat) && isNum(el.repeat.every) && (el.repeat.every as number) > 0 && (el.repeat.mode === undefined || el.repeat.mode === 'cycle' || el.repeat.mode === 'pingpong')))
      errs.push(`${p}.repeat needs every > 0 (mode cycle | pingpong)`);
    if (el.blend !== undefined && !(BLEND_MODES as readonly unknown[]).includes(el.blend)) errs.push(`${p}.blend must be one of ${BLEND_MODES.join(', ')}`);
    if (el.fx !== undefined) {
      if (!Array.isArray(el.fx)) errs.push(`${p}.fx must be a list`);
      else
        el.fx.forEach((f, j) => {
          if (!isObj(f) || !FX_TYPES.includes(f.type as string)) return errs.push(`${p}.fx[${j}]: type must be one of ${FX_TYPES.join(', ')}`);
          for (const [name, v] of Object.entries(f)) if (name !== 'type' && name !== 'color' && name !== 'freq') numOrKeys(v, `${p}.fx[${j}].${name}`);
          if ((f.type === 'tint' || f.color !== undefined) && typeof (f.color ?? '') !== 'string') errs.push(`${p}.fx[${j}].color must be a CSS colour`);
          if (f.type === 'tint' && typeof f.color !== 'string') errs.push(`${p}.fx[${j}]: tint needs a color`);
        });
    }
    if (el.matte !== undefined && !(isObj(el.matte) && typeof el.matte.source === 'string' && [undefined, 'alpha', 'alphaInverted', 'luma', 'lumaInverted'].includes(el.matte.mode as string)))
      errs.push(`${p}.matte needs a source element id (mode alpha | alphaInverted | luma | lumaInverted)`);
    if (el.isMatte !== undefined && typeof el.isMatte !== 'boolean') errs.push(`${p}.isMatte must be true or false`);
    if (el.mask !== undefined && !(isObj(el.mask) && Array.isArray(el.mask.points) && el.mask.points.length >= 3 && el.mask.points.every((q) => isObj(q) && isNumOrHV(q.x) && isNumOrHV(q.y))))
      errs.push(`${p}.mask needs at least 3 points {x, y}`);
    if (el.motionBlur !== undefined && !(isObj(el.motionBlur) && (el.motionBlur.shutter === undefined || isNum(el.motionBlur.shutter)) && (el.motionBlur.samples === undefined || isNum(el.motionBlur.samples))))
      errs.push(`${p}.motionBlur is {shutter?, samples?}`);
    if (el.type === 'sprite' && !(isObj(el.params) && typeof el.params.clip === 'string')) errs.push(`${p}: a sprite needs params.clip (an animation clip id)`);
    if (el.type === 'fox') {
      keys(el.xTrack, `${p}.xTrack`, isNumOrHV);
      keys(el.armFront, `${p}.armFront`, (v) => (ARM_MODES as readonly unknown[]).includes(v));
      keys(el.armBack, `${p}.armBack`, (v) => (ARM_MODES as readonly unknown[]).includes(v));
      keys(el.look, `${p}.look`, (v) => isObj(v) && ((isNum(v.x) && isNum(v.y)) || typeof v.target === 'string'));
      keys(el.mouth, `${p}.mouth`, (v) => typeof v === 'string');
      keys(el.eyes, `${p}.eyes`, (v) => v === 'open' || v === 'happy');
      keys(el.view, `${p}.view`, (v) => v === 'side' || v === 'front');
      if (el.face !== undefined) {
        if (!isObj(el.face)) errs.push(`${p}.face must be an object`);
        else
          for (const [name, k] of Object.entries(el.face)) {
            if (!(FACE_KEYS as readonly string[]).includes(name)) errs.push(`${p}.face: unknown value "${name}"`);
            keys(k, `${p}.face.${name}`, isNum);
          }
      }
      if (el.actions !== undefined && !Array.isArray(el.actions)) errs.push(`${p}.actions must be a list`);
    }
  });
  // References between elements (they may point forward in the list).
  (Array.isArray(raw.elements) ? raw.elements : []).forEach((el, i) => {
    if (!isObj(el)) return;
    const p = `elements[${i}]`;
    if (typeof el.parent === 'string' && !ids.has(el.parent)) errs.push(`${p}.parent: unknown element "${el.parent}"`);
    if (el.parent === el.id) errs.push(`${p}.parent: an element cannot be its own parent`);
    if (isObj(el.matte) && typeof el.matte.source === 'string' && !ids.has(el.matte.source)) errs.push(`${p}.matte: unknown element "${el.matte.source}"`);
  });
  (Array.isArray(raw.camera) ? raw.camera : []).forEach((s, i) => {
    if (!isObj(s) || !isNum(s.at) || !['wide', 'medium', 'close', 'extreme', 'insert'].includes(s.kind as string))
      errs.push(`camera[${i}]: needs at and kind (wide|medium|close|extreme|insert)`);
    else if (typeof s.target === 'string' && s.target !== 'fox' && !ids.has(s.target)) errs.push(`camera[${i}]: unknown target "${s.target}"`);
  });
  return errs;
}

export const isSceneSpec = (raw: unknown): raw is SceneSpec => validateSpec(raw).length === 0;
