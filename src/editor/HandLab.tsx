import { useEffect, useRef, useState } from 'react';
import { builtInArm, captureFox, drawFox, type ArmMode, type FoxDebug, type FoxPose } from '../character/AgentFox';
import { RIG } from '../character/rig/rigPuppet';
import { setTweaks, tweaks, type ArmTweak, type RigTweaks } from '../character/rig/tweaks';
import { ARM_MODES } from '../scene/elements';
import { HandDrawings } from './HandDrawings';
import { Slider } from './RigTuner';

type Side = 'near' | 'far';
/** Poses the left (near) arm acts in; every other pose of the near arm is a resting one. */
const NEAR_ACTS: ArmMode[] = ['rest', 'notebook', 'hips', 'chin', 'hatChest', 'hold', 'scratch'];
const NEAR_ONLY: ArmMode[] = ['chin', 'hatChest', 'hold', 'scratch'];
const MIRRORS = [
  ['auto', 'Auto (thumb rule)'],
  ['yes', 'Mirrored'],
  ['no', 'Not mirrored'],
] as const;
/** Every glove drawing in the rig (front views; the far arm uses its "_back" twin by itself). */
const GLOVES = Object.keys(RIG.parts)
  .filter((k) => k.startsWith('hand_') && !k.endsWith('_back'))
  .map((k) => k.slice(5))
  .sort();

const posesOf = (side: Side): ArmMode[] => (side === 'near' ? NEAR_ACTS : ARM_MODES.filter((m) => !NEAR_ONLY.includes(m)));

/**
 * The Hands tab of the model sheet: per arm and per pose, mirror the glove, resize it, move the point where it
 * attaches to the sleeve, turn it, or swap the drawing. Saved with the other rig tweaks (tweaks.json), so every
 * scene uses it.
 */
export function HandLab() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState<RigTweaks>(() => structuredClone(tweaks()));
  const [side, setSide] = useState<Side>('far');
  const [mode, setMode] = useState<ArmMode>('point');
  const [close, setClose] = useState(true);
  const [still, setStill] = useState(true);
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState(() => JSON.stringify(tweaks()));
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const dirty = JSON.stringify(t) !== saved;

  // Live: the rig draws with these values; leaving without saving puts the saved ones back.
  useEffect(() => setTweaks(t), [t]);
  useEffect(() => () => setTweaks(JSON.parse(savedRef.current)), []);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const sink: FoxDebug = { pose: null, face: null, arms: null, joints: {} };
    // Where the hand sits relative to the pose origin, per unit of scale (measured on the previous frame).
    let rel: [number, number] | null = null;
    const draw = () => {
      const c = ref.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      const time = still ? 0.5 : (performance.now() - t0) / 1000;
      const scale = close ? 2.2 : 0.6;
      let x = c.width * 0.45;
      let y = close ? c.height * 0.75 : c.height * 0.93;
      if (close && rel) {
        x = c.width / 2 - rel[0] * scale;
        y = c.height / 2 - rel[1] * scale;
      }
      const pose = {
        x,
        y,
        scale,
        time,
        noShadow: close,
        armFront: side === 'far' ? mode : NEAR_ONLY.includes(mode) ? mode : 'rest',
        armBack: side === 'near' && !NEAR_ONLY.includes(mode) ? mode : 'rest',
        lookX: 0.4,
        lookY: 0.2,
        bounce: still ? 0 : 1,
      } as FoxPose;
      g.fillStyle = '#2a1d12';
      g.fillRect(0, 0, c.width, c.height);
      g.setTransform(1, 0, 0, 1, 0, 0);
      sink.joints = {};
      captureFox(sink);
      drawFox(g, pose);
      captureFox(null);
      const h = sink.joints[`hand_${side}`];
      if (h) {
        rel = [(h[0] - x) / scale, (h[1] - y) / scale];
        // The attach point: where the sleeve ends and the glove hangs from.
        g.strokeStyle = '#7fe0ff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(h[0], h[1], 7, 0, Math.PI * 2);
        g.moveTo(h[0] - 14, h[1]);
        g.lineTo(h[0] + 14, h[1]);
        g.moveTo(h[0], h[1] - 14);
        g.lineTo(h[0], h[1] + 14);
        g.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [side, mode, close, still]);

  const cur: ArmTweak = t.arms[side][mode] ?? {};
  const B = builtInArm(side, mode);
  const patch = (p: Partial<ArmTweak> | null, s: Side = side, m: ArmMode = mode) =>
    setT((prev) => {
      const n = structuredClone(prev);
      if (p === null) {
        delete n.arms[s][m];
        return n;
      }
      const merged: ArmTweak = { ...(n.arms[s][m] ?? {}), ...p };
      for (const k of Object.keys(merged) as (keyof ArmTweak)[]) if (merged[k] === undefined) delete merged[k];
      if (Object.keys(merged).length) n.arms[s][m] = merged;
      else delete n.arms[s][m];
      return n;
    });
  const anchor = cur.anchor ?? [0, 0];
  const edited = (s: Side, m: ArmMode) => {
    const a = t.arms[s][m];
    return !!a && (a.mirror !== undefined || a.handScale !== undefined || a.anchor !== undefined || a.handTurn !== undefined || a.hand !== undefined);
  };
  const other: Side = side === 'far' ? 'near' : 'far';

  const save = async () => {
    setStatus('Saving…');
    try {
      const r = await fetch('/api/rig/tweaks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tweaks: t }) });
      if (!r.ok) throw new Error((await r.json()).error);
      setSaved(JSON.stringify(t));
      setStatus('Saved: every scene uses these hands now.');
    } catch (e) {
      setStatus(`Not saved: ${e instanceof Error ? e.message : String(e)} (saving needs npm run dev)`);
    }
  };

  return (
    <div className="tuner">
      <div className="tuner-stage">
        <canvas ref={ref} width={420} height={640} className="tuner-canvas" />
        <div className="row gap wrap">
          <div className="segmented compact">
            {([true, false] as const).map((z) => (
              <button key={String(z)} className={close === z ? 'on' : ''} onClick={() => setClose(z)}>
                {z ? 'Hand close-up' : 'Whole figure'}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={still} onChange={(e) => setStill(e.target.checked)} /> Hold still
          </label>
        </div>
        <p className="help small">The blue cross is the attach point: where the sleeve ends and the glove hangs from.</p>
      </div>
      <div className="tuner-controls">
        <h3>Arm</h3>
        <div className="segmented compact">
          {(['far', 'near'] as const).map((s) => (
            <button
              key={s}
              className={side === s ? 'on' : ''}
              onClick={() => {
                setSide(s);
                if (!posesOf(s).includes(mode)) setMode('rest');
              }}
            >
              {s === 'far' ? 'Right arm (acting)' : 'Left arm'}
            </button>
          ))}
        </div>
        <h3>Pose</h3>
        <div className="row gap wrap hand-poses">
          {posesOf(side).map((m) => (
            <button key={m} className={`chip ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)} title={edited(side, m) ? 'Hand adjusted' : 'Built-in hand'}>
              {m}
              {edited(side, m) ? ' •' : ''}
            </button>
          ))}
        </div>

        <h3>Glove</h3>
        <label className="tune-row">
          <span>Drawing</span>
          <select className="isel" value={cur.hand ?? ''} onChange={(e) => patch({ hand: e.target.value || undefined })}>
            <option value="">built-in: {B.hand}</option>
            {GLOVES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="tune-row">
          <span>Mirror</span>
          <div className="segmented compact">
            {MIRRORS.map(([k, label]) => (
              <button key={k} className={(cur.mirror ?? 'auto') === k ? 'on' : ''} onClick={() => patch({ mirror: k === 'auto' ? undefined : k })}>
                {label}
              </button>
            ))}
          </div>
        </label>
        <Slider label="Size" value={cur.handScale ?? 1} def={1} min={0.5} max={1.8} step={0.01} onChange={(v) => patch({ handScale: v })} />
        <Slider label="Turn (rad)" value={cur.handTurn ?? 0} def={0} min={-3.14} max={3.14} step={0.01} onChange={(v) => patch({ handTurn: v })} />

        <h3>Attach point</h3>
        <p className="help small">Moves the glove against the end of the sleeve, in the drawing's own px (along the forearm / across it).</p>
        <Slider
          label="Along the forearm"
          value={anchor[0]}
          def={0}
          min={-150}
          max={150}
          step={1}
          onChange={(v) => patch({ anchor: v === undefined && !anchor[1] ? undefined : [v ?? 0, anchor[1]] })}
        />
        <Slider
          label="Across"
          value={anchor[1]}
          def={0}
          min={-150}
          max={150}
          step={1}
          onChange={(v) => patch({ anchor: v === undefined && !anchor[0] ? undefined : [anchor[0], v ?? 0] })}
        />

        <div className="row gap wrap" style={{ marginTop: 8 }}>
          <button
            className="btn small ghost"
            disabled={!posesOf(other).includes(mode)}
            title={posesOf(other).includes(mode) ? '' : `The ${other === 'far' ? 'right' : 'left'} arm has no "${mode}" pose`}
            onClick={() => {
              const { mirror, handScale, anchor: an, handTurn, hand } = cur;
              patch({ mirror, handScale, anchor: an, handTurn, hand }, other, mode);
            }}
          >
            Copy to the {other === 'far' ? 'right' : 'left'} arm
          </button>
          <button className="btn small ghost" onClick={() => patch({ mirror: undefined, handScale: undefined, anchor: undefined, handTurn: undefined, hand: undefined })}>
            Reset this hand
          </button>
        </div>

        <div className="row gap" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
            Save hands
          </button>
          <button className="btn ghost" disabled={!dirty} onClick={() => setT(JSON.parse(saved))}>
            Discard
          </button>
          <span className="muted small">{status}</span>
        </div>
      </div>
    </div>
  );
}

/** The model sheet's Hands tab: fit each glove on its arm, or regenerate the glove drawings (like Mouths). */
export function HandsTab() {
  const [view, setView] = useState<'fit' | 'drawings'>('fit');
  return (
    <>
      <div className="segmented compact" style={{ marginBottom: 10 }}>
        {(['fit', 'drawings'] as const).map((v) => (
          <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
            {v === 'fit' ? 'Fit on the arm' : 'Drawings (regenerate)'}
          </button>
        ))}
      </div>
      {view === 'fit' ? <HandLab /> : <HandDrawings />}
    </>
  );
}
