import { useState } from 'react';
import type { Project } from '../types';
import type { BlendMode, Effect, MatteMode, SceneElement, SceneSpec, Track } from '../scene/spec';
import { BLEND_MODES } from '../scene/layers';
import { validateSpec } from '../scene/validate';
import { updateElement, updateSpec } from './model';
import { Check, Field, Group, NumberInput, Select } from './fields';

type Change = (fn: (p: Project) => Project, key?: string) => void;

/** New effects start from these (After Effects-like defaults; sizes in u). */
const FX_NEW: Record<Effect['type'], Effect> = {
  blur: { type: 'blur', amount: 6 },
  glow: { type: 'glow', radius: 18, intensity: 1, color: '#ffd27a' },
  shadow: { type: 'shadow', x: 8, y: 12, blur: 12, opacity: 0.5, color: '#000000' },
  color: { type: 'color', brightness: 1, contrast: 1, saturation: 1, hue: 0 },
  tint: { type: 'tint', color: '#c0392b', amount: 0.5 },
  stroke: { type: 'stroke', width: 4, color: '#1c120b' },
  opacityFlicker: { type: 'opacityFlicker', amount: 0.3, freq: 12 },
};
const FX_LABEL: Record<Effect['type'], string> = {
  blur: 'Gaussian blur',
  glow: 'Glow',
  shadow: 'Drop shadow',
  color: 'Colour correction',
  tint: 'Tint',
  stroke: 'Stroke (outline)',
  opacityFlicker: 'Flicker',
};

/**
 * After Effects-style layer controls (scene/layers.ts) for any element of a data scene, Agent Fox
 * included: parent, blending, animated scale, wiggle, repeat, motion blur, track matte, effects, and
 * the whole element as JSON for anything else (mask points, keys, Bézier eases).
 */
export function LayerPanel({ el, spec, scene, onChange }: { el: SceneElement; spec: SceneSpec; scene: number; onChange: Change }) {
  const set = (patch: Partial<SceneElement>, key: string) =>
    onChange((p) => updateElement(p, scene, el.id, (x) => ({ ...x, ...patch }) as SceneElement), `el:${el.id}:layer:${key}`);
  const others = spec.elements.filter((e) => e.id !== el.id).map((e) => e.id);
  const fx = el.fx ?? [];
  const setFx = (list: Effect[], key: string) => set({ fx: list.length ? list : undefined }, `fx:${key}`);
  const numOf = (t: Track<number> | undefined, fb: number) => (typeof t === 'number' ? t : t === undefined ? fb : null);

  return (
    <>
      <Group title="Layer (After Effects)">
        <Field label="Parent" hint="follows that element's move, turn, scale and wiggle (a Null element is an invisible parent)">
          <select className="isel" value={el.parent ?? ''} onChange={(e) => set({ parent: e.target.value || undefined }, 'parent')}>
            <option value="">— none —</option>
            {others.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Blending">
          <Select<BlendMode> value={el.blend ?? 'normal'} options={BLEND_MODES} onChange={(b) => set({ blend: b === 'normal' ? undefined : b }, 'blend')} />
        </Field>
        {numOf(el.scaleBy, 1) !== null ? (
          <Field label="Scale ×" hint="extra scale around the element's position (key it in the JSON below)">
            <NumberInput value={numOf(el.scaleBy, 1)!} step={0.05} min={0} onChange={(v) => set({ scaleBy: v === 1 ? undefined : v }, 'scaleBy')} />
          </Field>
        ) : (
          <p className="help small">Scale × is keyed ({(el.scaleBy as unknown[]).length} keys): edit it in the JSON below.</p>
        )}

        <Check value={!!el.wiggle} onChange={(on) => set({ wiggle: on ? { freq: 3, x: 0.004, y: 0.004, rot: 0.02 } : undefined }, 'wiggle')} label="Wiggle (AE wiggle)" />
        {el.wiggle && (
          <>
            {(['freq', 'x', 'y', 'rot', 'scale', 'seed'] as const).map((f) => (
              <Field key={f} label={f === 'freq' ? 'Wiggles / s' : f === 'x' || f === 'y' ? `${f} (frame fraction)` : f === 'rot' ? 'Rotation (rad)' : f === 'scale' ? 'Scale (fraction)' : 'Seed'}>
                <NumberInput value={el.wiggle![f] ?? 0} step={f === 'freq' || f === 'seed' ? 0.5 : 0.002} onChange={(v) => set({ wiggle: { ...el.wiggle!, [f]: v } }, `wiggle:${f}`)} />
              </Field>
            ))}
          </>
        )}

        <Check value={!!el.repeat} onChange={(on) => set({ repeat: on ? { every: 1, mode: 'cycle' } : undefined }, 'repeat')} label="Repeat its keys (AE loopOut)" />
        {el.repeat && (
          <>
            <Field label="Every (s)">
              <NumberInput value={el.repeat.every} step={0.05} min={0.05} onChange={(every) => set({ repeat: { ...el.repeat!, every } }, 'repeat:every')} />
            </Field>
            <Field label="From (s)">
              <NumberInput value={el.repeat.from ?? 0} step={0.05} min={0} onChange={(from) => set({ repeat: { ...el.repeat!, from } }, 'repeat:from')} />
            </Field>
            <Field label="Mode">
              <Select value={el.repeat.mode ?? 'cycle'} options={['cycle', 'pingpong'] as const} onChange={(mode) => set({ repeat: { ...el.repeat!, mode } }, 'repeat:mode')} />
            </Field>
          </>
        )}

        <Check value={!!el.motionBlur} onChange={(on) => set({ motionBlur: on ? { shutter: 0.04, samples: 8 } : undefined }, 'mb')} label="Motion blur" />
        {el.motionBlur && (
          <>
            <Field label="Shutter (s)" hint="how much of the motion is smeared">
              <NumberInput value={el.motionBlur.shutter ?? 0.04} step={0.01} min={0.005} onChange={(shutter) => set({ motionBlur: { ...el.motionBlur!, shutter } }, 'mb:s')} />
            </Field>
            <Field label="Samples">
              <NumberInput value={el.motionBlur.samples ?? 8} step={1} min={2} max={16} onChange={(samples) => set({ motionBlur: { ...el.motionBlur!, samples } }, 'mb:n')} />
            </Field>
          </>
        )}

        <Field label="Track matte" hint="show this element only through another one">
          <select className="isel" value={el.matte?.source ?? ''} onChange={(e) => set({ matte: e.target.value ? { source: e.target.value, mode: el.matte?.mode ?? 'alpha' } : undefined }, 'matte')}>
            <option value="">— none —</option>
            {others.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </Field>
        {el.matte && (
          <Field label="Matte mode">
            <Select<MatteMode> value={el.matte.mode ?? 'alpha'} options={['alpha', 'alphaInverted', 'luma', 'lumaInverted']} onChange={(mode) => set({ matte: { ...el.matte!, mode } }, 'matte:mode')} />
          </Field>
        )}
        <Check value={!!el.isMatte} onChange={(isMatte) => set({ isMatte: isMatte || undefined }, 'isMatte')} label="Used only as a matte (not drawn)" />
        {el.mask && (
          <p className="help small">
            Shape mask: {el.mask.points.length} points{el.mask.feather ? `, feather ${el.mask.feather}` : ''}
            {el.mask.invert ? ', inverted' : ''}.{' '}
            <button className="btn small ghost" onClick={() => set({ mask: undefined }, 'mask')}>
              Remove
            </button>
          </p>
        )}
        {!el.mask && (
          <button
            className="btn small ghost"
            onClick={() => {
              const x = typeof el.x === 'number' ? el.x : el.x.h;
              const y = typeof el.y === 'number' ? el.y : el.y.h;
              set({ mask: { points: [{ x: x - 0.15, y: y - 0.15 }, { x: x + 0.15, y: y - 0.15 }, { x: x + 0.15, y: y + 0.15 }, { x: x - 0.15, y: y + 0.15 }], feather: 12 } }, 'mask');
            }}
          >
            Add a shape mask
          </button>
        )}
      </Group>

      <Group title="Effects">
        {fx.length === 0 && <p className="help small">No effects. They apply in order, top first.</p>}
        {fx.map((f, i) => (
          <div key={i} className="fx-item">
            <div className="row gap">
              <strong>{FX_LABEL[f.type]}</strong>
              <button className="btn icon ghost small" title="Earlier" disabled={i === 0} onClick={() => setFx(swap(fx, i, i - 1), `up${i}`)}>
                ↑
              </button>
              <button className="btn icon ghost small" title="Later" disabled={i === fx.length - 1} onClick={() => setFx(swap(fx, i, i + 1), `down${i}`)}>
                ↓
              </button>
              <button className="btn icon ghost small" title="Remove" onClick={() => setFx(fx.filter((_, j) => j !== i), `rm${i}`)}>
                ✕
              </button>
            </div>
            {Object.entries(f)
              .filter(([k]) => k !== 'type')
              .map(([k, v]) =>
                k === 'color' ? (
                  <Field key={k} label="Colour">
                    <input type="color" value={String(v)} onChange={(e) => setFx(fx.map((x, j) => (j === i ? ({ ...x, color: e.target.value } as Effect) : x)), `${i}:${k}`)} />
                  </Field>
                ) : typeof v === 'number' ? (
                  <Field key={k} label={k}>
                    <NumberInput value={v} step={k === 'hue' ? 5 : 0.05} onChange={(n) => setFx(fx.map((x, j) => (j === i ? ({ ...x, [k]: n } as Effect) : x)), `${i}:${k}`)} />
                  </Field>
                ) : (
                  <p key={k} className="help small">
                    {k}: keyed (edit in the JSON below)
                  </p>
                ),
              )}
          </div>
        ))}
        <select className="isel" value="" onChange={(e) => e.target.value && setFx([...fx, structuredClone(FX_NEW[e.target.value as Effect['type']])], `add${fx.length}`)}>
          <option value="">+ Add an effect…</option>
          {(Object.keys(FX_NEW) as Effect['type'][]).map((t) => (
            <option key={t} value={t}>
              {FX_LABEL[t]}
            </option>
          ))}
        </select>
      </Group>

      <JsonEditor el={el} spec={spec} scene={scene} onChange={onChange} />
    </>
  );
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const b = [...a];
  [b[i], b[j]] = [b[j], b[i]];
  return b;
}

/** The whole element as JSON: anything the panels do not show (mask points, keys, Bézier eases...). */
function JsonEditor({ el, spec, scene, onChange }: { el: SceneElement; spec: SceneSpec; scene: number; onChange: Change }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Group title="Advanced (JSON)">
      {!open ? (
        <button
          className="btn small ghost"
          onClick={() => {
            setText(JSON.stringify(el, null, 2));
            setErr(null);
            setOpen(true);
          }}
        >
          Edit this element as JSON
        </button>
      ) : (
        <>
          <textarea className="itext mono" rows={16} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
          {err && <p className="warn-text small">{err}</p>}
          <div className="row gap">
            <button
              className="btn small primary"
              onClick={() => {
                let next: SceneElement;
                try {
                  next = JSON.parse(text);
                } catch (e) {
                  return setErr(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
                }
                const trial = { ...spec, elements: spec.elements.map((x) => (x.id === el.id ? next : x)) };
                const problems = validateSpec(trial);
                if (problems.length) return setErr(problems.slice(0, 4).join(' · '));
                onChange((p) => updateSpec(p, scene, () => trial), `el:${el.id}:json`);
                setOpen(false);
              }}
            >
              Apply
            </button>
            <button className="btn small ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Group>
  );
}
