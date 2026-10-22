import type { ReactNode } from 'react';
import type { Num } from '../scene/spec';

/** Small form controls shared by the inspector panels. */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="ifield">
      <span className="ifield-label" title={hint}>
        {label}
      </span>
      <span className="ifield-ctl">{children}</span>
    </label>
  );
}

export function NumberInput({ value, onChange, step = 0.01, min, max }: { value: number; onChange(v: number): void; step?: number; min?: number; max?: number }) {
  return (
    <input
      type="number"
      className="inum"
      value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onChange(min !== undefined || max !== undefined ? Math.min(max ?? v, Math.max(min ?? v, v)) : v);
      }}
    />
  );
}

/**
 * A number that may differ per format ({h, v}). Edits apply to the format on
 * screen; the link button splits / joins the two values.
 */
export function NumField({ label, value, fallback, vertical, onChange, step = 0.01, hint }: {
  label: string;
  value: Num | undefined;
  fallback: number;
  vertical: boolean;
  onChange(v: Num): void;
  step?: number;
  hint?: string;
}) {
  const split = typeof value === 'object';
  const cur = value === undefined ? fallback : typeof value === 'number' ? value : vertical ? value.v : value.h;
  return (
    <Field label={label} hint={hint}>
      <NumberInput
        value={cur}
        step={step}
        onChange={(v) => onChange(split ? { ...(value as { h: number; v: number }), [vertical ? 'v' : 'h']: v } : v)}
      />
      <button
        type="button"
        className={`ilink ${split ? 'split' : ''}`}
        title={split ? `Separate values for 16:9 and 9:16 (editing ${vertical ? '9:16' : '16:9'}). Click to use one value for both.` : 'Same value in 16:9 and 9:16. Click to set them separately.'}
        onClick={() => onChange(split ? cur : { h: cur, v: cur })}
      >
        {split ? (vertical ? '9:16' : '16:9') : '⇔'}
      </button>
    </Field>
  );
}

export function Select<T extends string>({ value, options, onChange, labels }: { value: T; options: readonly T[]; onChange(v: T): void; labels?: Partial<Record<T, string>> }) {
  return (
    <select className="isel" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? (o || '—')}
        </option>
      ))}
    </select>
  );
}

export function Text({ value, onChange, area, placeholder }: { value: string; onChange(v: string): void; area?: boolean; placeholder?: string }) {
  return area ? (
    <textarea className="itext" rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className="itext" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

export function Check({ value, onChange, label }: { value: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <label className="icheck">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Group({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="igroup">
      <header>
        <span>{title}</span>
        {actions}
      </header>
      <div className="igroup-body">{children}</div>
    </section>
  );
}
