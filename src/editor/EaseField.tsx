import type { Ease } from '../scene/spec';
import { ease as easeAt } from '../scene/tracks';

type Bez = [number, number, number, number];

/** Named curves and After Effects' keyframe assistants (as Bézier handles). */
const PRESETS: { label: string; value: Ease }[] = [
  { label: 'Linear', value: 'linear' },
  { label: 'Smooth', value: 'smooth' },
  { label: 'Ease in', value: 'in' },
  { label: 'Ease out', value: 'out' },
  { label: 'Ease in-out', value: 'inOut' },
  { label: 'Back (overshoot)', value: 'back' },
  { label: 'Bounce', value: 'bounce' },
  { label: 'Hold (jump at the end)', value: 'hold' },
  { label: 'AE Easy Ease', value: [0.33, 0, 0.67, 1] },
  { label: 'AE Easy Ease In', value: [0.33, 0, 1, 1] },
  { label: 'AE Easy Ease Out', value: [0, 0, 0.67, 1] },
  { label: 'Snappy (fast out, long settle)', value: [0.1, 0.9, 0.2, 1] },
  { label: 'Anticipate (pulls back first)', value: [0.6, -0.4, 0.7, 1] },
  { label: 'Overshoot', value: [0.3, 1.4, 0.6, 1] },
];

const same = (a: Ease, b: Ease) => JSON.stringify(a) === JSON.stringify(b);

/** Easing picker: presets, or the four Bézier handle values, with the curve drawn. */
export function EaseField({ value, onChange }: { value: Ease; onChange(e: Ease): void }) {
  const preset = PRESETS.findIndex((p) => same(p.value, value));
  const bez: Bez | null = Array.isArray(value) ? (value as Bez) : null;
  const W = 120;
  const H = 70;
  const pts = Array.from({ length: 41 }, (_, i) => {
    const t = i / 40;
    const y = easeAt(value, t);
    return `${(t * W).toFixed(1)},${(H - 10 - y * (H - 20)).toFixed(1)}`;
  }).join(' ');
  return (
    <div className="ease-field">
      <select
        className="isel"
        value={preset >= 0 ? String(preset) : 'custom'}
        onChange={(e) => (e.target.value === 'custom' ? onChange(bez ?? [0.33, 0, 0.67, 1]) : onChange(PRESETS[Number(e.target.value)].value))}
      >
        {PRESETS.map((p, i) => (
          <option key={p.label} value={i}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom Bézier…</option>
      </select>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="ease-graph" aria-hidden="true">
        <line x1="0" y1={H - 10} x2={W} y2={H - 10} stroke="currentColor" opacity="0.25" />
        <line x1="0" y1="10" x2={W} y2="10" stroke="currentColor" opacity="0.25" />
        <polyline points={pts} fill="none" stroke="#d9b465" strokeWidth="2" />
      </svg>
      {bez && (
        <div className="row gap">
          {bez.map((v, i) => (
            <input
              key={i}
              className="itext"
              style={{ width: 52 }}
              type="number"
              step={0.05}
              value={v}
              title={['x1 (out handle time)', 'y1 (out handle value)', 'x2 (in handle time)', 'y2 (in handle value)'][i]}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                const next = [...bez] as Bez;
                next[i] = i % 2 === 0 ? Math.min(1, Math.max(0, n)) : n;
                onChange(next);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
