import { ARM_MODES, ELEMENTS, FACE_KEYS } from './elements';
import type { SceneSpec } from './spec';

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
    });
  };

  if (!isObj(raw)) return ['scene spec must be an object'];
  if (raw.version !== 1) errs.push('version must be 1');
  if (!Array.isArray(raw.elements)) errs.push('elements must be a list');
  if (!Array.isArray(raw.camera)) errs.push('camera must be a list');
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
    for (const t of ['dx', 'dy', 'rot', 'opacity'] as const) if (el[t] !== undefined && !isNum(el[t])) keys(el[t], `${p}.${t}`, isNum);
    if (el.type === 'fox') {
      keys(el.xTrack, `${p}.xTrack`, isNumOrHV);
      keys(el.armFront, `${p}.armFront`, (v) => (ARM_MODES as readonly unknown[]).includes(v));
      keys(el.armBack, `${p}.armBack`, (v) => (ARM_MODES as readonly unknown[]).includes(v));
      keys(el.look, `${p}.look`, (v) => isObj(v) && ((isNum(v.x) && isNum(v.y)) || typeof v.target === 'string'));
      keys(el.mouth, `${p}.mouth`, (v) => typeof v === 'string');
      keys(el.eyes, `${p}.eyes`, (v) => v === 'open' || v === 'happy');
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
  (Array.isArray(raw.camera) ? raw.camera : []).forEach((s, i) => {
    if (!isObj(s) || !isNum(s.at) || !['wide', 'medium', 'close', 'extreme', 'insert'].includes(s.kind as string))
      errs.push(`camera[${i}]: needs at and kind (wide|medium|close|extreme|insert)`);
    else if (typeof s.target === 'string' && s.target !== 'fox' && !ids.has(s.target)) errs.push(`camera[${i}]: unknown target "${s.target}"`);
  });
  return errs;
}

export const isSceneSpec = (raw: unknown): raw is SceneSpec => validateSpec(raw).length === 0;
